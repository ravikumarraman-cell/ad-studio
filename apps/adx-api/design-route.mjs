import { renderDesignCapturePage } from "./design-capture-page.mjs";
import { renderDesignReviewPage } from "./design-review-workbench.mjs";
import { changeCaseResource } from "./change-case-route-utils.mjs";

export async function handleDesignWorkbenchRoute({
  response,
  traceId,
  session,
  current,
  scope,
  workspaceId,
  changeCaseId,
  decisionFor,
  writeHtml,
}) {
  const writeDecision = decisionFor({
    session,
    resource: changeCaseResource(current, scope),
    action: "resource.write",
  });
  const designEndpoint = `/v1/workspaces/${encodeURIComponent(workspaceId)}/change-cases/${encodeURIComponent(changeCaseId)}/design`;
  const designReviewUrl = `/v1/workspaces/${encodeURIComponent(workspaceId)}/change-cases/${encodeURIComponent(changeCaseId)}/design-review`;
  return writeHtml(
    response,
    200,
    renderDesignCapturePage(current, {
      canWrite: writeDecision.outcome === "ALLOW",
      designEndpoint,
      designReviewUrl,
    }),
    traceId,
    session.principal,
  );
}

export async function handleDesignReviewRoute({
  response,
  traceId,
  session,
  current,
  scope,
  workspaceId,
  changeCaseId,
  changeCases,
  decisionFor,
  writeHtml,
}) {
  const view = await changeCases.designView(scope, changeCaseId);
  const reviewDecision = decisionFor({
    session,
    resource: changeCaseResource(current, scope),
    action: "resource.review",
  });
  const writeDecision = decisionFor({
    session,
    resource: changeCaseResource(current, scope),
    action: "resource.write",
  });
  const decisionEndpoint = `/v1/workspaces/${encodeURIComponent(workspaceId)}/change-cases/${encodeURIComponent(changeCaseId)}/design-decision`;
  const designCaptureUrl = `/v1/workspaces/${encodeURIComponent(workspaceId)}/change-cases/${encodeURIComponent(changeCaseId)}/design-workbench`;
  const releasePlanningUrl = `/v1/workspaces/${encodeURIComponent(workspaceId)}/change-cases/${encodeURIComponent(changeCaseId)}/story-release-planning`;
  return writeHtml(
    response,
    200,
    renderDesignReviewPage(current, view, {
      canReview: reviewDecision.outcome === "ALLOW",
      canWrite: writeDecision.outcome === "ALLOW",
      isDesignAuthor: view.design?.authoredBy === session.principal.id,
      decisionEndpoint,
      designCaptureUrl,
      releasePlanningUrl,
    }),
    traceId,
    session.principal,
  );
}