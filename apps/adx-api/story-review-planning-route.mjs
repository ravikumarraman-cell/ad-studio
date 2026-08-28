import { renderStoryReviewPage } from "./story-review-page.mjs";
import { renderStoryReleasePlanningPage } from "./story-release-planning-page.mjs";
import { changeCaseBasePath, changeCaseResource } from "./change-case-route-utils.mjs";

export async function handleStoryReviewRoute({
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
  const reviewDecision = decisionFor({
    session,
    resource: changeCaseResource(current, scope),
    action: "resource.write",
  });
  const decisionEndpoint = `/v1/workspaces/${encodeURIComponent(workspaceId)}/change-cases/${encodeURIComponent(changeCaseId)}/story-decision`;
  const designReviewUrl = `/v1/workspaces/${encodeURIComponent(workspaceId)}/change-cases/${encodeURIComponent(changeCaseId)}/design-review`;
  const releasePlanningUrl = `/v1/workspaces/${encodeURIComponent(workspaceId)}/change-cases/${encodeURIComponent(changeCaseId)}/story-release-planning`;
  const storyWorkshopUrl = `/v1/workspaces/${encodeURIComponent(workspaceId)}/change-cases/${encodeURIComponent(changeCaseId)}/story-workshop`;
  const governance = await changeCases.intakeView(scope, changeCaseId);
  return writeHtml(
    response,
    200,
    renderStoryReviewPage(current, governance, {
      canReview: reviewDecision.outcome === "ALLOW",
      isStoryAuthor: governance.stories?.authoredBy === session.principal.id,
      decisionEndpoint,
      designReviewUrl,
      releasePlanningUrl,
      storyWorkshopUrl,
    }),
    traceId,
    session.principal,
  );
}

export async function handleStoryReleasePlanningRoute({
  response,
  traceId,
  session,
  current,
  scope,
  workspaceId,
  changeCaseId,
  storyMilestones,
  configuredStoryMilestones,
  decisionFor,
  write,
  writeHtml,
}) {
  if (!storyMilestones)
    return write(
      response,
      503,
      { code: "STORY_RELEASE_PLANNING_NOT_CONFIGURED" },
      traceId,
    );
  const writeDecision = decisionFor({
    session,
    resource: changeCaseResource(current, scope),
    action: "resource.write",
  });
  const base = changeCaseBasePath(workspaceId, changeCaseId);
  const view = await storyMilestones.workspaceView(scope);
  return writeHtml(
    response,
    200,
    renderStoryReleasePlanningPage(current, view, {
      canPlan: writeDecision.outcome === "ALLOW",
      publisherConfigured: Boolean(configuredStoryMilestones.service),
      designReviewUrl: `${base}/design-review`,
      endpoints: {
        priorityEndpoint: `${base}/story-priority-plan`,
        milestonesEndpoint: `${base}/story-milestones`,
        publishEndpoint: `${base}/story-milestone-publish`,
        storyDigest: "workspace",
      },
    }),
    traceId,
    session.principal,
  );
}