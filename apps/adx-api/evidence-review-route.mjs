import { renderVerificationReviewPage } from "./verification-review-page.mjs";
import { changeCaseBasePath, changeCaseResource } from "./change-case-route-utils.mjs";

export async function handleEvidenceReviewRoute({
  response,
  traceId,
  session,
  current,
  scope,
  workspaceId,
  changeCaseId,
  evidenceRepository,
  localIndependentVerifier,
  decisionFor,
  writeHtml,
  write,
}) {
  if (!evidenceRepository)
    return write(
      response,
      503,
      { code: "EVIDENCE_REPOSITORY_NOT_CONFIGURED" },
      traceId,
    );

  const writeDecision = decisionFor({
    session,
    resource: changeCaseResource(current, scope),
    action: "resource.write",
  });
  const reviewDecision = decisionFor({
    session,
    resource: changeCaseResource(current, scope),
    action: "resource.review",
  });
  const base = changeCaseBasePath(workspaceId, changeCaseId);
  const handoffUrl = `${base}/execution-handoff`;
  const candidateUrl = `${base}/generated-candidate`;
  const runEndpoint = `${base}/verification-run`;
  const decisionEndpoint = `${base}/verification-decision`;
  const previewUrl = `${base}/application-preview`;
  const verifierReadiness = localIndependentVerifier
    ? await localIndependentVerifier.readiness()
    : { ready: false, code: "LOCAL_VERIFIER_NOT_CONFIGURED" };

  return writeHtml(
    response,
    200,
    renderVerificationReviewPage(
      current,
      await evidenceRepository.list(scope, changeCaseId),
      {
        canRun: writeDecision.outcome === "ALLOW",
        canReview: reviewDecision.outcome === "ALLOW",
        handoffUrl,
        candidateUrl,
        runEndpoint,
        decisionEndpoint,
        previewUrl,
        verifierConfigured: verifierReadiness.ready,
        verifierIssue: verifierReadiness.code,
      },
    ),
    traceId,
    session.principal,
  );
}