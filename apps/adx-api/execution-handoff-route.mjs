import { listAgentSpecTemplates } from "./agent-spec-templates.mjs";
import { renderExecutionHandoffPage } from "./execution-handoff-page.mjs";
import { changeCaseBasePath, changeCaseResource } from "./change-case-route-utils.mjs";

export function handleExecutionHandoffRoute({
  response,
  traceId,
  session,
  current,
  execution,
  governance,
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
  const handoffUrl = `${base}/execution-handoff`;
  return writeHtml(
    response,
    200,
    renderExecutionHandoffPage(current, {
      projectRepository: governance?.intent?.targetRepository ?? null,
      canSubmit: writeDecision.outcome === "ALLOW",
      submitReason:
        writeDecision.outcome === "ALLOW" ? null : writeDecision.reason,
      execution,
      signedInRoles: membershipRoles,
      dispatchEndpoint,
      statusEndpoint,
      evidenceReviewUrl,
      candidateUrl,
      handoffUrl,
      providers,
      templates: listAgentSpecTemplates("coding"),
    }),
    traceId,
    session.principal,
  );
}