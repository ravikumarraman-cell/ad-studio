import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { handleExecutionApiRoute } from "../execution-api-route.mjs";

const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const changeCaseId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const session = {
  principal: { id: "human:author" },
  memberships: [{ organizationId: "org", workspaceId }],
};

function request({ method = "GET", body = null } = {}) {
  const stream = body === null ? new Readable({ read() { this.push(null); } }) : Readable.from([JSON.stringify(body)]);
  stream.method = method;
  stream.headers = { "idempotency-key": "request-1" };
  return stream;
}

function harness(overrides = {}) {
  const writes = [];
  const calls = [];
  return {
    writes,
    calls,
    input: {
      response: {},
      session,
      traceId: "trace-1",
      changeCases: {
        get: async () => ({ id: changeCaseId, projectionVersion: 4 }),
        intakeView: async () => ({ intent: {} }),
      },
      executions: {
        view: async () => ({ runs: [] }),
        issueLease: async (input) => { calls.push(["issueLease", input]); return { leaseId: "lease-1" }; },
        revokeLease: async (input) => { calls.push(["revokeLease", input]); return { leaseId: input.leaseId, status: "REVOKED" }; },
      },
      codingAgentExecution: {
        start: async (input) => { calls.push(["start", input]); return { runId: "run-1", status: "LEASED" }; },
      },
      executionUiRevision: "ui-v1",
      decisionFor: () => ({ outcome: "ALLOW" }),
      changeCaseResource: (current) => current,
      executionTask: () => ({ objective: "Patch" }),
      commandError: async () => { throw new Error("unexpected command error"); },
      write: async (_response, status, body, traceId) => { writes.push({ status, body, traceId }); },
      ...overrides,
    },
  };
}

test("execution route declines unrelated paths without writing a response", async () => {
  const { input, writes } = harness();
  const handled = await handleExecutionApiRoute({
    ...input,
    request: request(),
    url: new URL("http://adx.test/v1/unrelated"),
  });

  assert.equal(handled, false);
  assert.deepEqual(writes, []);
});

test("execution route exposes the public run view with its UI revision", async () => {
  const { input, writes } = harness();
  const handled = await handleExecutionApiRoute({
    ...input,
    request: request(),
    url: new URL(`http://adx.test/v1/workspaces/${workspaceId}/change-cases/${changeCaseId}/execution`),
  });

  assert.equal(handled, true);
  assert.deepEqual(writes, [{ status: 200, body: { runs: [], uiRevision: "ui-v1" }, traceId: "trace-1" }]);
});

test("execution dispatch builds the governed task and starts the configured execution service", async () => {
  const { input, calls, writes } = harness();
  await handleExecutionApiRoute({
    ...input,
    request: request({ method: "POST", body: { provider: "UHG_AZURE_OPENAI", expectedVersion: 4, templateId: "safe" } }),
    url: new URL(`http://adx.test/v1/workspaces/${workspaceId}/change-cases/${changeCaseId}/execution/dispatch`),
  });

  assert.equal(calls[0][0], "start");
  assert.equal(calls[0][1].provider, "UHG_AZURE_OPENAI");
  assert.equal(calls[0][1].idempotencyKey, "request-1");
  assert.deepEqual(writes[0], { status: 202, body: { runId: "run-1", status: "LEASED" }, traceId: "trace-1" });
});

test("execution dispatch forwards a bounded verification intensity into the governed task", async () => {
  const taskCalls = [];
  const { input, calls } = harness({
    executionTask: (...args) => {
      taskCalls.push(args);
      return { objective: "Patch", verificationIntensity: args.at(-1) };
    },
  });
  await handleExecutionApiRoute({
    ...input,
    request: request({ method: "POST", body: { provider: "UHG_AZURE_OPENAI", expectedVersion: 4, verificationIntensity: 25 } }),
    url: new URL(`http://adx.test/v1/workspaces/${workspaceId}/change-cases/${changeCaseId}/execution/dispatch`),
  });

  assert.equal(taskCalls[0].at(-1), 25);
  assert.equal(calls[0][1].task.verificationIntensity, 25);
});

test("execution route preserves workspace isolation before it reads execution state", async () => {
  const { input, writes } = harness({ session: { principal: session.principal, memberships: [] } });
  await handleExecutionApiRoute({
    ...input,
    request: request(),
    url: new URL(`http://adx.test/v1/workspaces/${workspaceId}/change-cases/${changeCaseId}/execution`),
  });

  assert.deepEqual(writes, [{ status: 403, body: { code: "WORKSPACE_ACCESS_DENIED" }, traceId: "trace-1" }]);
});
