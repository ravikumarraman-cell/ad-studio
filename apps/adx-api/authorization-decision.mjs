export function createDecisionFor({ authorize, createAuthorizationSnapshot, audit }) {
  return function decisionFor({ session, resource, action }) {
    const decision = authorize({
      principal: session.principal,
      memberships: session.memberships,
      resource,
      action,
    });
    const membership =
      decision.membership ??
      session.memberships.find(
        (item) =>
          item.workspaceId === resource.workspaceId &&
          item.organizationId === resource.organizationId,
      );
    const snapshot = createAuthorizationSnapshot({
      principal: session.principal,
      membership,
      resource,
      action,
      decision,
    });
    audit({ type: "authorization.decision", snapshot });
    return decision;
  };
}