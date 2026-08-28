import { renderApplicationPreviewPage } from "./application-preview-page.mjs";
import { changeCaseBasePath, changeCaseResource } from "./change-case-route-utils.mjs";
import { featureSpotlightFromEvents } from "./feature-spotlight.mjs";

export async function handleApplicationPreviewRoute({
  response,
  traceId,
  session,
  current,
  scope,
  workspaceId,
  changeCaseId,
  evidenceRepository,
  localPreviewManager,
  executions,
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
  const base = changeCaseBasePath(workspaceId, changeCaseId);
  return writeHtml(
    response,
    200,
    renderApplicationPreviewPage(current, {
      profiles: [...localPreviewManager.profiles.values()].map(({ id, label }) => ({ id, label })),
      evidence: await evidenceRepository.list(scope, changeCaseId),
      previews: localPreviewManager.list().filter((preview) => preview.changeCaseId === changeCaseId),
      spotlight: executions
        ? featureSpotlightFromEvents((await executions.view(scope, changeCaseId)).events)
        : null,
      canManage: writeDecision.outcome === "ALLOW",
      startEndpoint: `${base}/application-preview-start`,
      stopEndpoint: `${base}/application-preview-stop`,
    }),
    traceId,
    session.principal,
  );
}