import { intakeGatePage } from "./intake-gate-page.mjs";
import { storyWorkshopPageWithModelSelector } from "./story-workshop-page.mjs";
import { changeCaseResource } from "./change-case-route-utils.mjs";

export async function handleIntakeWorkshopRoute({
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
  const writeDecision = decisionFor({
    session,
    resource: changeCaseResource(current, scope),
    action: "resource.write",
  });
  const classifyEndpoint = `/v1/workspaces/${encodeURIComponent(workspaceId)}/change-cases/${encodeURIComponent(changeCaseId)}/classify`;
  const storyWorkshopUrl = `/v1/workspaces/${encodeURIComponent(workspaceId)}/change-cases/${encodeURIComponent(changeCaseId)}/story-workshop`;
  return writeHtml(
    response,
    200,
    intakeGatePage(
      current,
      await changeCases.intakeView(scope, changeCaseId),
      {
        canWrite: writeDecision.outcome === "ALLOW",
        classifyEndpoint,
        storyWorkshopUrl,
      },
    ),
    traceId,
    session.principal,
  );
}

export async function handleStoryWorkshopRoute({
  response,
  traceId,
  session,
  current,
  scope,
  workspaceId,
  changeCaseId,
  changeCases,
  storyDecompositionAgent,
  homeUrl,
  decisionFor,
  writeHtml,
}) {
  const authorDecision = decisionFor({
    session,
    resource: changeCaseResource(current, scope),
    action: "resource.write",
  });
  const governance = await changeCases.intakeView(scope, changeCaseId);
  const storiesEndpoint = `/v1/workspaces/${encodeURIComponent(workspaceId)}/change-cases/${encodeURIComponent(changeCaseId)}/stories`;
  const storySuggestionsEndpoint = `/v1/workspaces/${encodeURIComponent(workspaceId)}/change-cases/${encodeURIComponent(changeCaseId)}/story-suggestions`;
  const storyReviewUrl = `/v1/workspaces/${encodeURIComponent(workspaceId)}/change-cases/${encodeURIComponent(changeCaseId)}/story-review`;
  return writeHtml(
    response,
    200,
    storyWorkshopPageWithModelSelector(current, governance, {
      canAuthor: authorDecision.outcome === "ALLOW",
      storiesEndpoint,
      storySuggestionsEndpoint,
      storyReviewUrl,
      aiStatus: storyDecompositionAgent.status(),
      homeUrl,
    }),
    traceId,
    session.principal,
  );
}