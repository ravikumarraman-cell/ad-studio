import { randomUUID } from "node:crypto";
import { ChangeCaseError, sha256 } from "./change-case-ledger.mjs";

/** Stage 7 starts with a provider-neutral, non-mutating delivery boundary. */
export function createPreviewGitProvider({ providerId, repositories }) {
  if (
    typeof providerId !== "string" ||
    !providerId.trim() ||
    !Array.isArray(repositories) ||
    !repositories.length
  )
    throw new ChangeCaseError(
      "GIT_PROVIDER_INVALID",
      "A provider identifier and registered repositories are required.",
    );
  const registered = new Map();
  for (const repository of repositories) {
    const repositoryId =
      typeof repository?.repositoryId === "string"
        ? repository.repositoryId.trim()
        : "";
    const canonicalRemote =
      typeof repository?.canonicalRemote === "string"
        ? repository.canonicalRemote.trim()
        : "";
    const defaultBaseRef =
      typeof repository?.defaultBaseRef === "string"
        ? repository.defaultBaseRef.trim()
        : "";
    const projectPath = normalizeProjectPath(repository?.projectPath);
    if (
      !repositoryId ||
      !canonicalRemote.startsWith("https://") ||
      !defaultBaseRef.startsWith("refs/heads/")
    )
      throw new ChangeCaseError(
        "GIT_REPOSITORY_REGISTRATION_INVALID",
        "Registered repositories require an ID, canonical HTTPS remote, and heads base ref.",
      );
    if (registered.has(repositoryId))
      throw new ChangeCaseError(
        "GIT_REPOSITORY_REGISTRATION_DUPLICATE",
        "Preview provider repository IDs must be unique after normalization.",
      );
    registered.set(
      repositoryId,
      Object.freeze({
        repositoryId,
        canonicalRemote,
        defaultBaseRef,
        projectPath,
      }),
    );
  }
  return Object.freeze({
    providerId: providerId.trim(),
    mode: "PREVIEW_ONLY",
    capabilities: Object.freeze({
      branchPreview: true,
      commitPreview: true,
      pullRequestPreview: true,
      ciTrigger: false,
      reviewFindingIngestion: false,
      merge: false,
    }),
    repository(repositoryId) {
      const requestedId =
        typeof repositoryId === "string" ? repositoryId.trim() : "";
      const repository = registered.get(requestedId);
      if (!repository)
        throw new ChangeCaseError(
          "GIT_REPOSITORY_DENIED",
          `The retained Intake target repository ${requestedId || "(missing)"} is not registered for this preview provider. Add that exact repositoryId to ADX_PREVIEW_GIT_REPOSITORIES_JSON.`,
          { details: { repositoryId: requestedId || null } },
        );
      return repository;
    },
  });
}

export function createPreviewDeliveryPlan({
  provider,
  changeCaseId,
  repositoryId,
  baseRef,
  candidateDigest,
  evidenceDigest,
  changes,
  title,
  pullRequestBody,
}) {
  if (provider?.mode !== "PREVIEW_ONLY")
    throw new ChangeCaseError(
      "GIT_PREVIEW_PROVIDER_REQUIRED",
      "Stage 7 plans require a preview-only provider.",
    );
  if (
    !changeCaseId ||
    !candidateDigest?.startsWith("sha256:") ||
    !evidenceDigest?.startsWith("sha256:") ||
    typeof title !== "string" ||
    !title.trim() ||
    typeof pullRequestBody !== "string" ||
    !pullRequestBody.trim()
  )
    throw new ChangeCaseError(
      "GIT_DELIVERY_INPUT_INVALID",
      "Change Case, candidate, evidence, title, and retained pull-request description are required for a preview delivery plan.",
    );
  const repository = provider.repository(repositoryId);
  const requestedBaseRef = baseRef ?? repository.defaultBaseRef;
  if (requestedBaseRef !== repository.defaultBaseRef)
    throw new ChangeCaseError(
      "GIT_BASE_REF_DENIED",
      "Preview delivery must use the registered repository base ref.",
    );
  const normalizedChanges = normalizeChanges(changes);
  const changeDigest = sha256(normalizedChanges);
  const branch = `adx/preview/${changeCaseId}`;
  const commitDigest = sha256({
    schema: "adx-preview-commit-v1",
    repository: repository.canonicalRemote,
    projectPath: repository.projectPath,
    baseRef: requestedBaseRef,
    candidateDigest,
    evidenceDigest,
    changes: normalizedChanges,
  });
  const body = pullRequestBody.trim();
  const pullRequestDigest = sha256({
    schema: "adx-preview-pr-v1",
    repository: repository.canonicalRemote,
    branch,
    baseRef: requestedBaseRef,
    commitDigest,
    title: title.trim(),
    body,
  });
  return Object.freeze({
    planId: randomUUID(),
    mode: "PREVIEW_ONLY",
    providerId: provider.providerId,
    repository,
    changeCaseId,
    baseRef: requestedBaseRef,
    branch,
    candidateDigest,
    evidenceDigest,
    changes: normalizedChanges,
    changeDigest,
    commitDigest,
    pullRequest: Object.freeze({
      title: title.trim(),
      body,
      digest: pullRequestDigest,
      externalReference: `preview:${pullRequestDigest.slice(7, 31)}`,
    }),
  });
}

export class PreviewDeliveryRegistry {
  #plans = new Map();
  submit(plan) {
    if (plan?.mode !== "PREVIEW_ONLY" || !plan.pullRequest?.digest)
      throw new ChangeCaseError(
        "GIT_PREVIEW_PLAN_INVALID",
        "A valid preview plan is required.",
      );
    const existing = this.#plans.get(plan.pullRequest.digest);
    if (existing)
      return Object.freeze({
        accepted: true,
        deduplicated: true,
        plan: existing,
      });
    this.#plans.set(plan.pullRequest.digest, plan);
    return Object.freeze({ accepted: true, deduplicated: false, plan });
  }
  assertCandidateCurrent(plan, candidateDigest) {
    if (candidateDigest !== plan?.candidateDigest)
      throw new ChangeCaseError(
        "GIT_CANDIDATE_STALE",
        "The candidate digest no longer matches the preview branch plan.",
      );
    return true;
  }
}

function normalizeChanges(changes) {
  if (!Array.isArray(changes) || !changes.length)
    throw new ChangeCaseError(
      "GIT_CHANGESET_REQUIRED",
      "A preview delivery requires at least one candidate change.",
    );
  const seen = new Set();
  return Object.freeze(
    changes
      .map((change) => {
        if (
          !change ||
          typeof change.path !== "string" ||
          !change.path.trim() ||
          change.path.startsWith("/") ||
          change.path.includes("..") ||
          typeof change.digest !== "string" ||
          !change.digest.startsWith("sha256:")
        )
          throw new ChangeCaseError(
            "GIT_CHANGESET_INVALID",
            "Preview changes require canonical relative paths and content digests.",
          );
        if (seen.has(change.path))
          throw new ChangeCaseError(
            "GIT_CHANGESET_DUPLICATE_PATH",
            "A preview change path may appear only once.",
          );
        seen.add(change.path);
        return Object.freeze({ path: change.path, digest: change.digest });
      })
      .sort((left, right) => left.path.localeCompare(right.path)),
  );
}
function normalizeProjectPath(value) {
  if (value === undefined || value === null || value === "") return null;
  const path = typeof value === "string" ? value.trim() : "";
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new ChangeCaseError(
      "GIT_REPOSITORY_REGISTRATION_INVALID",
      "A registered project path must be a canonical relative directory path.",
    );
  return path;
}
