import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { handleGitHubMilestoneApiRoute } from "../github-milestone-api-route.mjs";

const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const session = { principal: { id: "human:author" }, memberships: [{ organizationId: "org", workspaceId }] };

function request({ method = "GET", body = null } = {}) {
  const stream = body === null ? new Readable({ read() { this.push(null); } }) : Readable.from([JSON.stringify(body)]);
  stream.method = method;
  return stream;
}

function harness(overrides = {}) {
  const writes = [];
  const calls = [];
  const client = {
    listMilestones: async (input) => { calls.push(["list", input]); return [{ number: 1 }]; },
    featuresFromMilestone: async (input) => { calls.push(["features", input]); return [{ title: "Funding" }]; },
  };
  return {
    writes,
    calls,
    input: {
      response: {}, session, traceId: "trace-1", changeCases: {}, publicGitHubMilestones: client, privateGitHubMilestones: client,
      decisionFor: () => ({ outcome: "ALLOW" }), workspaceResource: () => ({ id: workspaceId }),
      importFeatures: async (input) => { calls.push(["import", input]); return { imported: 1 }; },
      commandError: async (_response, error) => { calls.push(["error", error.code]); },
      write: async (_response, status, body, traceId) => writes.push({ status, body, traceId }),
      ...overrides,
    },
  };
}

test("GitHub milestone route lists public milestones through the authorized owner", async () => {
  const { input, calls, writes } = harness();
  const handled = await handleGitHubMilestoneApiRoute({
    ...input,
    request: request(),
    url: new URL(`http://adx.test/v1/workspaces/${workspaceId}/github-public/milestones?owner=adx&repository=studio`),
  });

  assert.equal(handled, true);
  assert.deepEqual(calls, [["list", { owner: "adx", repository: "studio" }]]);
  assert.deepEqual(writes, [{ status: 200, body: { milestones: [{ number: 1 }] }, traceId: "trace-1" }]);
});

test("GitHub milestone route imports public milestone features into the authorized workspace", async () => {
  const { input, calls, writes } = harness();
  await handleGitHubMilestoneApiRoute({
    ...input,
    request: request({ method: "POST", body: { owner: "adx", repository: "studio", milestone: 1, importId: "import-1" } }),
    url: new URL(`http://adx.test/v1/workspaces/${workspaceId}/github-public/milestone-import`),
  });

  assert.equal(calls[0][0], "features");
  assert.equal(calls[1][0], "import");
  assert.equal(calls[1][1].scope.workspaceId, workspaceId);
  assert.deepEqual(writes[0], { status: 200, body: { imported: 1 }, traceId: "trace-1" });
});

test("private GitHub imports reject browser-supplied credentials before feature retrieval", async () => {
  const { input, calls, writes } = harness();
  await handleGitHubMilestoneApiRoute({
    ...input,
    request: request({ method: "POST", body: { token: "browser-secret" } }),
    url: new URL(`http://adx.test/v1/workspaces/${workspaceId}/github-private/milestone-import`),
  });

  assert.deepEqual(calls, [["error", "GITHUB_PRIVATE_BROWSER_CREDENTIAL_REJECTED"]]);
  assert.deepEqual(writes, []);
});
