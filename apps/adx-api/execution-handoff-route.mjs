import { listAgentSpecTemplates } from "./agent-spec-templates.mjs";
import { renderExecutionHandoffPage } from "./execution-handoff-page.mjs";
import { changeCaseBasePath, changeCaseResource } from "./change-case-route-utils.mjs";

export function handleExecutionHandoffRoute({
  response,
  traceId,
  session,
  current,
  scope,
  workspaceId,
  changeCaseId,
  membershipRoles,
  providers,
  decisionFor,
  writeHtml,
}) {
  const writeDecision = decisionFor({
    session,
    resource: changeCaseResource(current, scope),
    action: "resource.write",
  });
  const base = changeCaseBasePath(workspaceId, changeCaseId);
  const dispatchEndpoint = `${base}/execution/dispatch`;
  const statusEndpoint = `${base}/execution`;
  const evidenceReviewUrl = `${base}/evidence-review`;
  const candidateUrl = `${base}/generated-candidate`;
  return writeHtml(
    response,
    200,
    renderExecutionHandoffPage(current, {
      canSubmit: writeDecision.outcome === "ALLOW",
      submitReason:
        writeDecision.outcome === "ALLOW" ? null : writeDecision.reason,
      signedInRoles: membershipRoles,
      dispatchEndpoint,
      statusEndpoint,
      evidenceReviewUrl,
      candidateUrl,
      providers,
      templates: listAgentSpecTemplates("coding"),
    }),
    traceId,
    session.principal,
  );
}