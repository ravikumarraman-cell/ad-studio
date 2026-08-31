import assert from "node:assert/strict";
import test from "node:test";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodingAgentAdapter } from "../coding-agent-adapters.mjs";
import { ModelPatchBroker } from "../model-patch-broker.mjs";

const adapter = createCodingAgentAdapter({
  provider: "UHG_AZURE_OPENAI",
  version: "gpt-5.6-terra_2026-07-09",
  capabilities: {
    shell: true,
    gitRead: true,
    gitWrite: true,
    browser: false,
    network: false,
    secrets: false,
    deploy: false,
  },
  enabled: true,
});
const task = {
  objective: "Replace the marker.",
  changeDigest: "sha256:case-digest",
  allowedCommands: ["node --test"],
};
const repository = { writePaths: ["src/**"] };

function gateway(response) {
  return {
    status: () => ({ configured: true, model: "gpt-5.6-terra" }),
    complete: async () => ({
      model: "gpt-5.6-terra",
      responseDigest: "sha256:response",
      text: JSON.stringify(response),
    }),
  };
}

test("model-patch broker applies only a validated writable-file replacement in a disposable candidate", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(
    join(source, "src", "marker.js"),
    'export const marker = "before"\n',
  );
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: gateway({
      schema: "adx-model-patch-response-v1",
      patches: [
        { path: "src/marker.js", content: 'export const marker = "after"\n' },
      ],
      featureSpotlight: {
        featureId: "marker-status",
        title: "Marker status",
        summary: "The updated marker is highlighted in the after preview.",
      },
    }),
    validate: async ({ cwd, allowedCommands }) => {
      assert.equal(cwd.endsWith("/candidate"), true);
      assert.deepEqual(allowedCommands, ["node --test"]);
      return {
        code: 0,
        signal: null,
        timedOut: false,
        outputBytes: 0,
        outputDigest: "sha256:test",
      };
    },
  });
  const result = await broker.execute({ adapter, task, repository });
  assert.equal(result.promoted, true);
  assert.deepEqual(result.featureSpotlight, {
    featureId: "marker-status",
    title: "Marker status",
    summary: "The updated marker is highlighted in the after preview.",
  });
  assert.equal(Number.isInteger(result.timings.totalMs), true);
  assert.equal(Number.isInteger(result.timings.modelMs), true);
  assert.equal(Number.isInteger(result.timings.validationMs), true);
  assert.equal(
    await readFile(join(candidate, "src", "marker.js"), "utf8"),
    'export const marker = "after"\n',
  );
  assert.equal(
    await readFile(join(source, "src", "marker.js"), "utf8"),
    'export const marker = "before"\n',
  );
});

test("model-patch broker retries one malformed model response with deterministic structured output", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(
    join(source, "src", "marker.js"),
    'export const marker = "before"\n',
  );
  const calls = [];
  const response = {
    schema: "adx-model-patch-response-v1",
    patches: [
      { path: "src/marker.js", content: 'export const marker = "after"\n' },
    ],
  };
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        calls.push(request);
        return calls.length === 1
          ? {
              text: "not json",
              providerRequestId: "provider-1",
              finishReason: "stop",
            }
          : {
              text: JSON.stringify(response),
              providerRequestId: "provider-2",
              finishReason: "stop",
            };
      },
    },
    validate: async () => ({
      code: 0,
      signal: null,
      timedOut: false,
      outputBytes: 0,
      outputDigest: "sha256:test",
    }),
  });
  const result = await broker.execute({ adapter, task, repository });
  assert.equal(result.promoted, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].temperature, 0);
  assert.equal(calls[0].responseSchema.strict, true);
  assert.match(calls[1].prompt, /"previousResponseIssue":"NON_JSON"/);
});

test("model-patch broker classifies a failed validation command", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(
    join(source, "src", "marker.js"),
    'export const marker = "before"\n',
  );
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: gateway({
      schema: "adx-model-patch-response-v1",
      patches: [
        { path: "src/marker.js", content: 'export const marker = "after"\n' },
      ],
    }),
    validate: async () => ({
      code: 1,
      signal: null,
      timedOut: false,
      outputBytes: 27,
      outputDigest: "sha256:test",
      outputExcerpt: "test failure summary\n",
    }),
  });
  const result = await broker.execute({ adapter, task, repository });
  assert.equal(result.errorCode, "MODEL_PATCH_VALIDATION_FAILED");
  assert.equal(result.promoted, false);
  assert.equal(result.candidateDigest, null);
  assert.equal(result.outputDigest, "sha256:test");
  assert.equal(result.outputBytes, 27);
  assert.deepEqual(result.errorDetails, {
    failureStage: "VALIDATION",
    validationCommand: "node --test",
    validationCategory: "CHECK_FAILED",
    validationOutputExcerpt: "test failure summary\n",
    validationFailureReason: null,
  });
  assert.equal(
    await readFile(join(source, "src", "marker.js"), "utf8"),
    'export const marker = "before"\n',
  );
  await assert.rejects(
    () => readFile(join(candidate, "src", "marker.js"), "utf8"),
    { code: "ENOENT" },
  );
  await rm(root, { recursive: true, force: true });
});

test("standalone Health-X permits only its production verifier and links read-only dependencies into the disposable workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "app"), { recursive: true });
  await mkdir(join(source, "scripts"), { recursive: true });
  await mkdir(join(source, "node_modules"), { recursive: true });
  await writeFile(
    join(source, "app", "marker.js"),
    'export const marker = "before"\n',
  );
  await writeFile(
    join(source, "scripts", "verify-production.mjs"),
    "// The product progress label must match the two canonical action lists.\n",
  );
  const healthXTask = {
    objective: "Replace the marker.",
    changeDigest: "sha256:case-digest",
    allowedCommands: ["npm run verify:production"],
  };
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    allowedValidationCommands: ["npm run verify:production"],
    readOnlyContextPaths: ["scripts/verify-production.mjs"],
    linkSourceDependencies: true,
    gateway: {
      status: () => ({ configured: true, model: "gpt-5.6-terra" }),
      complete: async (request) => {
        const context = JSON.parse(request.prompt).files;
        assert.deepEqual(
          context.find((file) => file.path === "scripts/verify-production.mjs"),
          {
            path: "scripts/verify-production.mjs",
            content:
              "// The product progress label must match the two canonical action lists.\n",
            writable: false,
          },
        );
        assert.equal(
          context.find((file) => file.path === "app/marker.js").writable,
          true,
        );
        return {
          model: "gpt-5.6-terra",
          responseDigest: "sha256:response",
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches: [
              {
                path: "app/marker.js",
                content: 'export const marker = "after"\n',
              },
            ],
          }),
        };
      },
    },
    validate: async ({ cwd, allowedCommands }) => {
      assert.deepEqual(allowedCommands, ["npm run verify:production"]);
      assert.equal(
        (await lstat(join(cwd, "node_modules"))).isSymbolicLink(),
        true,
      );
      await mkdir(join(cwd, ".output"), {
        recursive: true,
      });
      await writeFile(
        join(cwd, ".output", "server.mjs"),
        "generated",
      );
      return {
        code: 0,
        signal: null,
        timedOut: false,
        outputBytes: 0,
        outputDigest: "sha256:test",
      };
    },
  });
  const result = await broker.execute({
    adapter,
    task: healthXTask,
    repository: { writePaths: ["app/**"] },
  });
  assert.equal(result.promoted, true);
  assert.equal(
    await readFile(join(candidate, "app", "marker.js"), "utf8"),
    'export const marker = "after"\n',
  );
  await assert.rejects(
    () => stat(join(candidate, ".output")),
    { code: "ENOENT" },
  );
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker emits a fallback reason when validation is silent", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "marker.js"), 'export const marker = "before"\n');
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: gateway({
      schema: "adx-model-patch-response-v1",
      patches: [{ path: "src/marker.js", content: 'export const marker = "after"\n' }],
    }),
    validate: async () => ({
      code: 1,
      signal: null,
      timedOut: false,
      outputBytes: 0,
      outputDigest: "sha256:test",
      outputExcerpt: null,
    }),
  });
  const result = await broker.execute({ adapter, task, repository });
  assert.equal(result.errorCode, "MODEL_PATCH_VALIDATION_FAILED");
  assert.deepEqual(result.errorDetails, {
    failureStage: "VALIDATION",
    validationCommand: "node --test",
    validationCategory: "CHECK_FAILED",
    validationOutputExcerpt: null,
    validationFailureReason: "Validation exited with code 1 and produced no output.",
  });
  await rm(root, { recursive: true, force: true });
});

test("default profile rejects the Health-X verifier instead of allowing a caller-selected command", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(
    join(source, "src", "marker.js"),
    'export const marker = "before"\n',
  );
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: gateway({ schema: "adx-model-patch-response-v1", patches: [] }),
  });
  await assert.rejects(
    () =>
      broker.execute({
        adapter,
        task: { ...task, allowedCommands: ["npm run verify:health-x"] },
        repository,
      }),
    { code: "MODEL_PATCH_COMMAND_DENIED" },
  );
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker rejects a model edit outside the lease write allowlist", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(
    join(source, "src", "marker.js"),
    'export const marker = "before"\n',
  );
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: gateway({
      schema: "adx-model-patch-response-v1",
      patches: [{ path: "package.json", content: "{}" }],
    }),
    validate: async () => ({
      code: 0,
      signal: null,
      timedOut: false,
      outputBytes: 0,
      outputDigest: "sha256:test",
    }),
  });
  await assert.rejects(() => broker.execute({ adapter, task, repository }), {
    code: "MODEL_PATCH_RESPONSE_INVALID",
  });
});

test("model-patch broker accepts a strictly fenced JSON response", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(
    join(source, "src", "marker.js"),
    'export const marker = "before"\n',
  );
  const response = {
    schema: "adx-model-patch-response-v1",
    patches: [
      { path: "src/marker.js", content: 'export const marker = "after"\n' },
    ],
  };
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async () => ({
        text: `\`\`\`json\n${JSON.stringify(response)}\n\`\`\``,
        model: "gpt-5.6-terra",
        responseDigest: "sha256:response",
        finishReason: "stop",
      }),
    },
    validate: async () => ({
      code: 0,
      signal: null,
      timedOut: false,
      outputBytes: 0,
      outputDigest: "sha256:test",
    }),
  });
  const result = await broker.execute({ adapter, task, repository });
  assert.equal(result.promoted, true);
});
