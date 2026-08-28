export function changeCaseBasePath(workspaceId, changeCaseId) {
  return `/v1/workspaces/${encodeURIComponent(workspaceId)}/change-cases/${encodeURIComponent(changeCaseId)}`;
}

export function changeCaseResource(changeCase, scope) {
  return {
    id: changeCase.id,
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    type: "change-case",
    version: changeCase.projectionVersion,
    riskTier: changeCase.riskTier,
  };
}