import { renderApplicationPreviewPage } from "./application-preview-page.mjs";
import { changeCaseBasePath, changeCaseResource } from "./change-case-route-utils.mjs";
import { featureSpotlightFromEvents } from "./feature-spotlight.mjs";

export async function handleApplicationPreviewRoute({
  response,
  traceId,
  session,
  current,
  governance,
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
  const selectedRepository = normalizeRepositoryId(governance?.intent?.targetRepository);
  const profiles = [...localPreviewManager.profiles.values()]
    .filter(
      (profile) =>
        !selectedRepository || normalizeRepositoryId(profile.repositoryId) === selectedRepository,
    )
    .map(({ id, label, repositoryId }) => ({ id, label, repositoryId }));
  const previews = localPreviewManager
    .list()
    .filter(
      (preview) =>
        preview.changeCaseId === changeCaseId &&
        (!selectedRepository || normalizeRepositoryId(preview.repositoryId) === selectedRepository),
    );
  return writeHtml(
    response,
    200,
    renderApplicationPreviewPage(current, {
      projectRepository: governance?.intent?.targetRepository ?? null,
      profiles,
      evidence: await evidenceRepository.list(scope, changeCaseId),
      previews,
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

function normalizeRepositoryId(value) {
  return String(value ?? "").trim().toLowerCase();
}