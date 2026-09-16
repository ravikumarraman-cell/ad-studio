import assert from "node:assert/strict";
import test from "node:test";
import {
  createLocalCodingAgentExecution,
  createUhgModelCodingExecution,
  resolveModelPatchProfile,
} from "../coding-agent-execution-configuration.mjs";

const dependencies = {
  executions: {},
  changeCases: {},
  broker: { configured: () => true },
};

test("model execution profiles keep profile-specific roots, write paths, and validation commands", () => {
  const healthX = resolveModelPatchProfile({
    ADX_CODING_MODEL_EXECUTION_PROFILE: "health-x",
    ADX_HEALTH_X_MODEL_SOURCE_ROOT: "/source",
    ADX_HEALTH_X_MODEL_CANDIDATE_ROOT: "/candidate",
  });
  const inventory = resolveModelPatchProfile({
    ADX_CODING_MODEL_EXECUTION_PROFILE: "cloud-asset-inventory",
    ADX_CODING_MODEL_WRITE_PATHS: "backend/**,frontend/**",
  });

  assert.equal(healthX.validationCommand, "npm run verify:production");
  assert.deepEqual(healthX.writePaths, ["app/**"]);
  assert.equal(inventory.validationCommand, "cloud-asset-inventory verify");
  assert.deepEqual(inventory.writePaths, ["backend/**", "frontend/**"]);
});

test("local execution is created only for a registered, complete provider configuration", () => {
  const incomplete = createLocalCodingAgentExecution({
    ...dependencies,
    environment: { ADX_LOCAL_CODING_AGENT_PROVIDER: "UNKNOWN" },
  });
  const configured = createLocalCodingAgentExecution({
    ...dependencies,
    environment: {
      ADX_LOCAL_CODING_AGENT_PROVIDER: "CODEX",
      ADX_LOCAL_CODING_AGENT_VERSION: "1.2.3",
      ADX_LOCAL_CODING_AGENT_REPOSITORY_ID: "repo",
      ADX_LOCAL_CODING_AGENT_REF: "refs/heads/main",
      ADX_LOCAL_CODING_AGENT_WRITE_PATHS: "src/**",
    },
  });

  assert.equal(incomplete, null);
  assert.equal(configured.provider.id, "CODEX");
  assert.equal(configured.service.policy.durationSeconds, 900);
  assert.throws(
    () => configured.service.resolveAdapter("CLAUDE_CODE"),
    { code: "CODING_AGENT_PROVIDER_NOT_ENABLED" },
  );
});

test("UHG execution uses the profile validation command and requires a configured gateway", () => {
  const profile = resolveModelPatchProfile({
    ADX_CODING_MODEL_EXECUTION_PROFILE: "health-x",
    ADX_HEALTH_X_MODEL_REPOSITORY_ID: "repo",
    ADX_HEALTH_X_MODEL_REF: "refs/heads/main",
  });
  const gateway = { status: () => ({ configured: true, model: "gpt-test" }) };
  const configured = createUhgModelCodingExecution({
    ...dependencies,
    gateway,
    modelPatchProfile: profile,
    environment: { ADX_CODING_MODEL_VERSION: "2026-01-01" },
  });
  const unavailable = createUhgModelCodingExecution({
    ...dependencies,
    gateway: { status: () => ({ configured: false }) },
    modelPatchProfile: profile,
    environment: { ADX_CODING_MODEL_VERSION: "2026-01-01" },
  });

  assert.equal(configured.provider.label, "gpt-test (UHG)");
  assert.deepEqual(configured.service.policy.taskFor({ id: "case", projectionVersion: 1 }).allowedCommands, ["npm run verify:production"]);
  assert.equal(unavailable, null);
});
