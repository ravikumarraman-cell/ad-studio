import assert from "node:assert/strict";
import test from "node:test";
import { createLeasedExecutionRunner } from "../leased-execution-runner.mjs";

test("leased execution runner dispatches a bounded broker request and forwards progress", async () => {
  const calls = [];
  const runner = createLeasedExecutionRunner({
    heartbeatIntervalMs: 1_000,
    executionRepository: {
      dispatchContext: async (input) => {
        calls.push(["dispatch", input]);
        return { limits: { maxDurationSeconds: 30 } };
      },
      heartbeatRun: async () => true,
      recordProgress: async (input) => calls.push(["progress", input]),
    },
    broker: {
      execute: async (input) => {
        await input.onProgress("PATCHING", { files: 1 });
        assert.equal(input.timeoutMs, 30_000);
        return { accepted: true, promoted: true, candidateDigest: "sha256:candidate" };
      },
    },
    toFailureResult: (error) => ({ accepted: false, errorCode: error.code }),
  });

  const result = await runner({
    scope: { organizationId: "org" },
    issued: { leaseId: "lease-1", runId: "run-1" },
    adapter: { provider: "LOCAL_TEST" },
    task: { objective: "Patch" },
    repository: { repositoryId: "repo" },
  });

  assert.equal(result.candidateDigest, "sha256:candidate");
  assert.deepEqual(calls.map(([name]) => name), ["dispatch", "progress"]);
  assert.equal(calls[1][1].runId, "run-1");
});

test("leased execution runner fails closed when dispatch fails", async () => {
  const runner = createLeasedExecutionRunner({
    heartbeatIntervalMs: 1_000,
    executionRepository: {
      dispatchContext: async () => { throw Object.assign(new Error("no lease"), { code: "LEASE_EXPIRED" }); },
      heartbeatRun: async () => true,
      recordProgress: async () => true,
    },
    broker: { execute: async () => { throw new Error("should not run"); } },
    toFailureResult: (error) => ({ accepted: false, errorCode: error.code }),
  });

  const result = await runner({
    scope: {},
    issued: { leaseId: "lease-1", runId: "run-1" },
    adapter: {},
    task: {},
    repository: {},
  });

  assert.deepEqual(result, { accepted: false, errorCode: "LEASE_EXPIRED" });
});
