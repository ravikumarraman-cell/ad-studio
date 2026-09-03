import { ChangeCaseError } from "./change-case-ledger.mjs";

const apiOrigin = "https://api.github.com";

export function createGitHubDraftPrClient({
  token,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof token !== "string" || !token.trim())
    throw new Error("GITHUB_DRAFT_PR_TOKEN_REQUIRED");
  return Object.freeze({
    async create({ plan, exported }) {
      const repository = parseRepository(plan?.repository?.canonicalRemote);
      validatePlan(plan, exported);
      const baseCommit = await request(
        fetchImpl,
        token,
        repository,
        `/git/commits/${encodeURIComponent(exported.baseCommit)}`,
        { allowNotFound: true },
      );
      if (!baseCommit)
        throw new ChangeCaseError(
          "GITHUB_DRAFT_PR_BASE_COMMIT_NOT_FOUND",
          "The preview plan's source commit does not exist in the registered GitHub repository. Update the server-owned source checkout to a commit available on that remote, then rebuild the preview plan and retry.",
          { retryable: true, severity: "warning", details: { baseCommit: exported.baseCommit } },
        );
      const marker = `<!-- adx-preview:${plan.pullRequest.digest} -->`;
      const existing = await request(
        fetchImpl,
        token,
        repository,
        `/pulls?state=open&head=${encodeURIComponent(`${repository.owner}:${plan.branch}`)}`,
      );
      if (Array.isArray(existing) && existing.length) {
        const pullRequest = existing.find(
          (item) =>
            item?.draft === true &&
            typeof item.body === "string" &&
            item.body.includes(marker),
        );
        if (!pullRequest)
          throw new ChangeCaseError(
            "GITHUB_DRAFT_PR_BRANCH_CONFLICT",
            "The registered preview branch already has a pull request without matching ADX provenance.",
          );
        return externalPullRequest(pullRequest, true);
      }
      const existingRef = await request(
        fetchImpl,
        token,
        repository,
        `/git/ref/heads/${encodeURIComponent(plan.branch)}`,
        { allowNotFound: true },
      );
      if (existingRef)
        throw new ChangeCaseError(
          "GITHUB_DRAFT_PR_BRANCH_CONFLICT",
          `The isolated preview branch ${plan.branch} already exists without matching ADX pull-request provenance. Delete that unmerged preview branch, then retry.`,
        );
      await request(fetchImpl, token, repository, "/git/refs", {
        method: "POST",
        body: { ref: `refs/heads/${plan.branch}`, sha: exported.baseCommit },
      });
      try {
        for (const change of exported.changes)
          await writeChange({
            fetchImpl,
            token,
            repository,
            change,
            branch: plan.branch,
            baseCommit: exported.baseCommit,
          });
        const pullRequest = await request(
          fetchImpl,
          token,
          repository,
          "/pulls",
          {
            method: "POST",
            body: {
              title: plan.pullRequest.title,
              head: plan.branch,
              base: plan.baseRef.slice("refs/heads/".length),
              draft: true,
              body: `${marker}\n\n${plan.pullRequest.body}`,
            },
          },
        );
        return externalPullRequest(pullRequest, false);
      } catch (error) {
        await request(
          fetchImpl,
          token,
          repository,
          `/git/refs/heads/${encodeURIComponent(plan.branch)}`,
          { method: "DELETE", allowNotFound: true },
        ).catch(() => null);
        throw error;
      }
    },
    async workflowRuns({ plan }) {
      const repository = parseRepository(plan?.repository?.canonicalRemote);
      const payload = await request(
        fetchImpl,
        token,
        repository,
        `/actions/runs?branch=${encodeURIComponent(plan.branch)}&per_page=100`,
      );
      if (!Array.isArray(payload?.workflow_runs))
        throw new ChangeCaseError(
          "GITHUB_ACTIONS_RESPONSE_INVALID",
          "GitHub returned invalid workflow run data.",
          { retryable: true, severity: "warning" },
        );
      return Object.freeze(
        payload.workflow_runs.map((run) => workflowRun(run)),
      );
    },
  });
}

async function writeChange({
  fetchImpl,
  token,
  repository,
  change,
  branch,
  baseCommit,
}) {
  const path = `/contents/${change.path.split("/").map(encodeURIComponent).join("/")}`;
  const current = await request(
    fetchImpl,
    token,
    repository,
    `${path}?ref=${encodeURIComponent(baseCommit)}`,
    { allowNotFound: true },
  );
  if (change.operation === "DELETE") {
    if (!current) return;
    await request(fetchImpl, token, repository, path, {
      method: "DELETE",
      body: {
        message: `ADX preview: delete ${change.path}`,
        sha: current.sha,
        branch,
      },
    });
    return;
  }
  await request(fetchImpl, token, repository, path, {
    method: "PUT",
    body: {
      message: `ADX preview: ${change.operation.toLowerCase()} ${change.path}`,
      content: change.content,
      branch,
      ...(current ? { sha: current.sha } : {}),
    },
  });
}

async function request(
  fetchImpl,
  token,
  repository,
  path,
  { method = "GET", body, allowNotFound = false } = {},
) {
  let response;
  try {
    response = await fetchImpl(
      `${apiOrigin}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}${path}`,
      {
        method,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "user-agent": "adx-draft-pr-delivery",
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
  } catch {
    throw new ChangeCaseError(
      "GITHUB_DRAFT_PR_UNAVAILABLE",
      "GitHub could not be reached. Try again shortly.",
      { retryable: true, severity: "warning" },
    );
  }
  const payload = await response.json().catch(() => null);
  if (response.ok) return payload;
  if (allowNotFound && response.status === 404) return null;
  if (response.status === 401 || response.status === 403)
    throw new ChangeCaseError(
      "GITHUB_DRAFT_PR_FORBIDDEN",
      "The server GitHub credential cannot create the requested draft pull request.",
      { retryable: false, severity: "warning" },
    );
  if (response.status === 409 || response.status === 422)
    throw new ChangeCaseError(
      "GITHUB_DRAFT_PR_CONFLICT",
      `GitHub rejected the request while trying to ${githubOperation(method, path)}: ${githubValidationReason(payload)}.`,
      {
        retryable: false,
        severity: "warning",
        details: {
          providerStatus: response.status,
          operation: githubOperation(method, path),
          providerMessage: githubValidationReason(payload),
        },
      },
    );
  throw new ChangeCaseError(
    "GITHUB_DRAFT_PR_REQUEST_FAILED",
    "GitHub could not create the draft pull request.",
    {
      retryable: response.status >= 500 || response.status === 429,
      severity: "warning",
      details: { providerStatus: response.status },
    },
  );
}

function githubOperation(method, path) {
  if (method === "POST" && path === "/git/refs") return "create the preview branch";
  if (["PUT", "DELETE"].includes(method) && path.startsWith("/contents/")) return "write a candidate file to the preview branch";
  if (method === "POST" && path === "/pulls") return "create the draft pull request";
  return "apply the retained preview plan";
}

function githubValidationReason(payload) {
  const message = safeProviderText(payload?.message);
  const details = Array.isArray(payload?.errors)
    ? payload.errors
      .map((item) => safeProviderText(item?.message) || [safeProviderText(item?.field), safeProviderText(item?.code)].filter(Boolean).join(": "))
      .filter(Boolean)
      .slice(0, 3)
    : [];
  return [message, ...details.filter((detail) => detail !== message)].join("; ") || "GitHub did not provide a validation reason";
}

function safeProviderText(value) {
  return typeof value === "string"
    ? value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 300)
    : "";
}

function parseRepository(remote) {
  const match =
    typeof remote === "string"
      ? remote.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i)
      : null;
  if (!match)
    throw new ChangeCaseError(
      "GITHUB_DRAFT_PR_REPOSITORY_INVALID",
      "Draft pull requests require a registered github.com HTTPS repository.",
    );
  return Object.freeze({ owner: match[1], name: match[2] });
}

function validatePlan(plan, exported) {
  if (!plan?.pullRequest?.body)
    throw new ChangeCaseError(
      "GITHUB_DRAFT_PR_DESCRIPTION_MISSING",
      "This retained preview plan predates the reviewer-ready PR description. Prepare a fresh preview plan from the current Gate D evidence before creating a draft pull request.",
      { retryable: false, severity: "warning" },
    );
  if (
    plan?.mode !== "PREVIEW_ONLY" ||
    !plan.branch?.startsWith("adx/preview/") ||
    !plan.baseRef?.startsWith("refs/heads/") ||
    !plan.pullRequest?.digest?.startsWith("sha256:") ||
    !plan.pullRequest?.title ||
    !plan.pullRequest?.body ||
    !plan.candidateDigest?.startsWith("sha256:") ||
    !plan.evidenceDigest?.startsWith("sha256:") ||
    !exported?.baseCommit ||
    !exported?.exportDigest?.startsWith("sha256:") ||
    !Array.isArray(exported.changes)
  )
    throw new ChangeCaseError(
      "GITHUB_DRAFT_PR_INPUT_INVALID",
      "A complete retained preview plan and verified source export are required.",
    );
}

function externalPullRequest(value, deduplicated) {
  if (!Number.isInteger(value?.number) || typeof value.html_url !== "string")
    throw new ChangeCaseError(
      "GITHUB_DRAFT_PR_RESPONSE_INVALID",
      "GitHub returned an invalid draft pull request response.",
      { retryable: true, severity: "warning" },
    );
  return Object.freeze({
    deduplicated,
    number: value.number,
    url: value.html_url,
    nodeId: value.node_id ?? null,
  });
}

function workflowRun(value) {
  if (!Number.isInteger(value?.id) || typeof value.status !== "string")
    throw new ChangeCaseError(
      "GITHUB_ACTIONS_RESPONSE_INVALID",
      "GitHub returned an invalid workflow run.",
      { retryable: true, severity: "warning" },
    );
  const status =
    value.status === "completed"
      ? value.conclusion === "success"
        ? "PASSED"
        : "FAILED"
      : value.status === "queued"
        ? "QUEUED"
        : "RUNNING";
  return Object.freeze({
    externalRunId: String(value.id),
    deliveryId: `github-actions:${value.id}:${value.updated_at ?? value.run_started_at ?? value.created_at ?? ""}`,
    status,
  });
}
