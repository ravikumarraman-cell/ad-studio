import { ChangeCaseError } from "./change-case-ledger.mjs";

const executionPath = /^\/v1\/workspaces\/([0-9a-f-]+)\/change-cases\/([0-9a-f-]+)\/execution(?:\/(leases)(?:\/([0-9a-f-]+)\/(revoke))?|\/(dispatch))?$/i;

/** Handles only the execution-governance API surface; returns false when the path is unrelated. */
export async function handleExecutionApiRoute({ request, response, url, session, traceId, changeCases, executions, codingAgentExecution, executionUiRevision, decisionFor, changeCaseResource, executionTask, commandError, write }) {
  const match = url.pathname.match(executionPath);
  if (!match) return false;
  const [, workspaceId, changeCaseId, collection, leaseId, command, dispatch] = match;
  const membership = session.memberships.find((item) => item.workspaceId === workspaceId);
  if (!membership) return respond(write, response, 403, { code: "WORKSPACE_ACCESS_DENIED" }, traceId);
  if (!changeCases || !executions)
    return respond(write, response, 503, { code: "EXECUTION_GOVERNANCE_NOT_CONFIGURED" }, traceId);
  const scope = { organizationId: membership.organizationId, workspaceId: membership.workspaceId };
  const current = await changeCases.get(scope, changeCaseId);
  if (!current) return respond(write, response, 404, { code: "CHANGE_CASE_NOT_FOUND" }, traceId);
  const action = request.method === "GET" ? "resource.read" : "resource.write";
  const decision = decisionFor({ session, resource: changeCaseResource(current, scope), action });
  if (decision.outcome !== "ALLOW") return respond(write, response, 403, { code: decision.reason }, traceId);
  if (request.method === "GET" && !collection)
    return respond(write, response, 200, { ...(await executions.view(scope, changeCaseId)), uiRevision: executionUiRevision }, traceId);
  const body = await readJson(request);
  try {
    if (request.method === "POST" && dispatch === "dispatch") {
      if (!codingAgentExecution)
        throw new ChangeCaseError(
          "CODING_AGENT_EXECUTOR_NOT_CONFIGURED",
          "Coding-agent execution is not configured for this ADX server.",
        );
      const governance = await changeCases.intakeView(scope, changeCaseId);
      return respond(write, response, 202, await codingAgentExecution.start({
        scope,
        principal: session.principal,
        changeCase: current,
        provider: body?.provider,
        task: executionTask(current, governance, body?.templateId, body?.verificationIntensity, body?.skipExecutableValidation),
        expectedVersion: body?.expectedVersion,
        idempotencyKey: request.headers["idempotency-key"],
      }), traceId);
    }
    if (request.method === "POST" && collection === "leases" && !leaseId)
      return respond(write, response, 201, await executions.issueLease({
        scope, principal: session.principal, changeCaseId, request: body,
      }), traceId);
    if (request.method === "POST" && collection === "leases" && leaseId && command === "revoke")
      return respond(write, response, 200, await executions.revokeLease({
        scope, principal: session.principal, leaseId, reason: body?.reason,
      }), traceId);
    return respond(write, response, 400, {
      error: {
        code: "EXECUTION_COMMAND_INVALID",
        message: "The execution governance command is invalid.",
        retryable: false,
        severity: "warning",
        correlationId: traceId,
      },
    }, traceId);
  } catch (error) {
    await commandError(response, error, traceId);
    return true;
  }
}

async function respond(write, response, status, body, traceId) {
  await write(response, status, body, traceId);
  return true;
}

function readJson(request) {
  return new Promise((resolve) => {
    let data = "";
    request.on("data", (chunk) => { data += chunk; });
    request.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve(null); }
    });
  });
}
