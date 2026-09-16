import { ChangeCaseError } from "./change-case-ledger.mjs";

const milestonePath = /^\/v1\/workspaces\/([0-9a-f-]+)\/github-(public|private)\/(milestones|milestone-import)$/i;

/** Handles public and private GitHub milestone reads/imports with shared authorization. */
export async function handleGitHubMilestoneApiRoute({ request, response, url, session, traceId, changeCases, publicGitHubMilestones, privateGitHubMilestones, decisionFor, workspaceResource, importFeatures, commandError, write }) {
  const match = url.pathname.match(milestonePath);
  if (!match) return false;
  const [, workspaceId, visibility, operation] = match;
  const membership = session.memberships.find((item) => item.workspaceId === workspaceId);
  if (!membership) return respond(write, response, 403, { code: "WORKSPACE_ACCESS_DENIED" }, traceId);
  if (!changeCases) return respond(write, response, 503, { code: "CHANGE_CASE_LEDGER_NOT_CONFIGURED" }, traceId);
  const client = visibility === "private" ? privateGitHubMilestones : publicGitHubMilestones;
  if (!client) return respond(write, response, 503, { code: "GITHUB_PRIVATE_REPOSITORY_READ_NOT_CONFIGURED" }, traceId);
  const scope = { organizationId: membership.organizationId, workspaceId: membership.workspaceId };
  const action = operation === "milestones" && request.method === "GET"
    ? "workspace.read"
    : operation === "milestone-import" && request.method === "POST"
      ? "workspace.manage"
      : null;
  if (!action) return respond(write, response, 405, { code: "METHOD_NOT_ALLOWED" }, traceId);
  const decision = decisionFor({ session, resource: workspaceResource(workspaceId, membership.organizationId), action });
  if (decision.outcome !== "ALLOW") return respond(write, response, 403, { code: decision.reason }, traceId);
  try {
    if (operation === "milestones")
      return respond(write, response, 200, {
        milestones: await client.listMilestones({
          owner: url.searchParams.get("owner"),
          repository: url.searchParams.get("repository"),
        }),
      }, traceId);
    const body = await readJson(request);
    if (visibility === "private" && ["token", "accessToken", "githubToken"].some((key) => Object.hasOwn(body ?? {}, key)))
      throw new ChangeCaseError(
        "GITHUB_PRIVATE_BROWSER_CREDENTIAL_REJECTED",
        "GitHub credentials must remain server-side and cannot be supplied by the browser.",
        { retryable: false, severity: "warning" },
      );
    const features = await client.featuresFromMilestone({
      owner: body?.owner,
      repository: body?.repository,
      milestone: body?.milestone,
      featureOwner: body?.featureOwner,
      targetRepository: body?.targetRepository,
      riskTier: body?.riskTier,
    });
    return respond(write, response, 200, await importFeatures({
      scope,
      principal: session.principal,
      importId: body?.importId,
      features,
      correlationId: traceId,
    }), traceId);
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
