import { ChangeCaseError, sha256 } from "./change-case-ledger.mjs";
import {
  createPreviewDeliveryPlan,
  createPreviewGitProvider,
} from "./git-delivery-preview.mjs";
import { createCandidateGitExport } from "./candidate-git-export.mjs";
import { buildDraftPrDescription } from "./draft-pr-description.mjs";

export function createPreviewDeliveryService({
  providerId,
  repositories,
  deliveryRepository,
  evidenceRepository,
  changeCaseRepository,
  storyRepository = null,
  servicePrincipal,
  sourceRoot,
  candidateRoot,
  createExport = createCandidateGitExport,
}) {
  if (
    !deliveryRepository ||
    !evidenceRepository ||
    !changeCaseRepository ||
    servicePrincipal?.type !== "service" ||
    !servicePrincipal.id
  )
    throw new Error("PREVIEW_DELIVERY_SERVICE_CONFIGURATION_REQUIRED");
  const provider = createPreviewGitProvider({ providerId, repositories });
  return Object.freeze({
    async prepare({ scope, changeCase, timeline }) {
      const legacyDeliveryReview = changeCase?.state === "READY_FOR_DELIVERY" && !timeline.some((event) => event.eventType === "ChangeCaseDeliveryApproved.v1")
      if (changeCase?.state !== "AWAITING_DELIVERY_REVIEW" && !legacyDeliveryReview)
        throw new ChangeCaseError(
          "DELIVERY_PREVIEW_NOT_READY",
          "A preview plan may be prepared only after Gate D independent verification completes.",
        );
      const completion = [...timeline]
        .reverse()
        .find(
          (event) => event.eventType === "ChangeCaseVerificationCompleted.v1",
        );
      const candidateDigest = completion?.payload?.candidateDigest;
      const evidenceDigest = completion?.payload?.evidenceDigest;
      if (
        !candidateDigest?.startsWith("sha256:") ||
        !evidenceDigest?.startsWith("sha256:")
      )
        throw new ChangeCaseError(
          "DELIVERY_PREVIEW_BINDING_MISSING",
          "The Gate D completion event does not contain a verified candidate and evidence binding.",
        );
      const evidence = await evidenceRepository.list(scope, changeCase.id);
      const passingEvidence = evidence.find(
        (item) =>
          item.status === "PASS" &&
          item.candidateDigest === candidateDigest &&
          item.evidenceDigest === evidenceDigest,
      );
      if (!passingEvidence)
        throw new ChangeCaseError(
          "DELIVERY_PREVIEW_EVIDENCE_STALE",
          "The retained passing evidence no longer matches the Gate D candidate binding.",
        );
      const governance = await changeCaseRepository.intakeView(
        scope,
        changeCase.id,
      );
      const repositoryId = governance.intent?.targetRepository;
      if (typeof repositoryId !== "string" || !repositoryId.trim())
        throw new ChangeCaseError(
          "DELIVERY_PREVIEW_REPOSITORY_MISSING",
          "The retained intake contract must name a registered target repository.",
        );
      const repository = provider.repository(repositoryId);
      const exported = await createExport({
        sourceRoot,
        candidateRoot,
        candidateDigest,
        canonicalRemote: repository.canonicalRemote,
        projectPath: repository.projectPath,
      });
      const storyPublication = storyRepository?.view
        ? await storyRepository.view(scope, changeCase.id)
        : null;
      const pullRequestBody = buildDraftPrDescription({
        changeCase,
        governance,
        storyPublication,
        evidence: passingEvidence,
        exported,
      });
      const basePlan = createPreviewDeliveryPlan({
        provider,
        changeCaseId: changeCase.id,
        repositoryId,
        candidateDigest,
        evidenceDigest,
        title: changeCase.title,
        pullRequestBody,
        changes: exported.changes.map(({ path, afterDigest }) => ({
          path,
          digest: afterDigest ?? sha256({ path, deleted: true }),
        })),
      });
      const provenance = Object.freeze({
        baseCommit: exported.baseCommit,
        exportDigest: exported.exportDigest,
      });
      const plan = Object.freeze({ ...basePlan, sourceExport: provenance });
      return deliveryRepository.retain({
        scope,
        principal: servicePrincipal,
        plan,
      });
    },
  });
}
