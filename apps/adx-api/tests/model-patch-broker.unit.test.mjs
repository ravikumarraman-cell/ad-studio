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
import { dirname, join } from "node:path";
import { createCodingAgentAdapter } from "../coding-agent-adapters.mjs";
import { ChangeCaseError, sha256 } from "../change-case-ledger.mjs";
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

test("model-patch broker retains an underspecified external API as a provisional developer warning", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "marker.js"), 'export const marker = "before"\n');
  let modelCalls = 0;
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true, model: "gpt-5.6-terra" }),
      complete: async () => {
        modelCalls += 1;
        return {
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches: [{ path: "src/marker.js", content: 'export const marker = "after"\n' }],
            featureSpotlight: null,
          }),
        };
      },
    },
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });

  const result = await broker.execute({
    adapter,
    task: { ...task, objective: "Read funding status from the Account Manager Financial API." },
    repository,
  });
  assert.equal(modelCalls, 1);
  assert.equal(result.promoted, true);
  assert.deepEqual(result.provisionalExternalContracts, [{
    capability: "Account Manager Financial API",
    missingContract: ["endpoint", "authentication", "responseContract"],
    status: "PROVISIONAL_DEVELOPER_ACTION_REQUIRED",
    warning: "Provisional contract created for Account Manager Financial API. A developer must replace it with the authoritative endpoint, authentication, response mapping, and failure semantics before release.",
  }]);
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker recognizes a qualified API backed by a source-owned integration contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "account-manager-client.js"), [
    'const ACCOUNT_MANAGER_BASE_API_URL = "https://accounts.example.test";',
    'async function loadFunding(token) {',
    '  const response = await fetch(ACCOUNT_MANAGER_BASE_API_URL, { headers: { authorization: `Bearer ${token}` } });',
    '  return response.json();',
    '}',
    'export { loadFunding };',
  ].join("\n"));
  await writeFile(join(source, "src", "marker.js"), 'export const marker = "before"\n');
  let modelCalls = 0;
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async () => {
        modelCalls += 1;
        return {
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches: [{ path: "src/marker.js", content: 'export const marker = "after"\n' }],
            featureSpotlight: null,
          }),
        };
      },
    },
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });

  const result = await broker.execute({
    adapter,
    task: {
      ...task,
      objective: "Read funding status from the Account Manager Financial API.",
    },
    repository,
  });

  assert.equal(modelCalls, 1);
  assert.equal(result.promoted, true);
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker rejects incomplete owner coverage for a three-story batch before semantic verification", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src", "frontend"), { recursive: true });
  await mkdir(join(source, "src", "api"), { recursive: true });
  await mkdir(join(source, "src", "actions"), { recursive: true });
  await writeFile(join(source, "src", "frontend", "Funding.jsx"), 'export const Funding = () => null\n');
  await writeFile(join(source, "src", "api", "funding.js"), 'export const funding = () => null\n');
  await writeFile(join(source, "src", "actions", "follow-up.js"), 'export const followUp = () => null\n');
  await writeFile(join(source, "src", "funding.test.js"), 'test("existing", () => {})\n');
  const prompts = [];
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        prompts.push(JSON.parse(request.prompt));
        const repaired = prompts.length === 2;
        const response = {
          schema: "adx-model-patch-response-v1",
          patches: repaired
            ? [{ path: "src/actions/follow-up.js", content: 'export const followUp = () => "recorded"\n' }]
            : [
                { path: "src/frontend/Funding.jsx", content: 'export const Funding = () => "funded"\n' },
                { path: "src/api/funding.js", content: 'export const funding = () => "funded"\n' },
                { path: "src/funding.test.js", content: 'test("STORY-1 STORY-2 STORY-3", () => {})\n' },
              ],
          featureSpotlight: null,
          storyCoverage: [
            { storyKey: "STORY-1", implementationPaths: ["src/frontend/Funding.jsx"], testPaths: ["src/funding.test.js"] },
            { storyKey: "STORY-2", implementationPaths: ["src/api/funding.js"], testPaths: ["src/funding.test.js"] },
            { storyKey: "STORY-3", implementationPaths: repaired ? ["src/actions/follow-up.js"] : ["src/api/funding.js"], testPaths: ["src/funding.test.js"] },
          ],
        };
        return { text: JSON.stringify(response) };
      },
    },
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });

  const result = await broker.execute({
    adapter,
    task: {
      ...task,
      stories: [
        { key: "STORY-1", title: "View funding", narrative: "Display funding on the onboarding page.", scenarios: [{ given: "a tenant", when: "the page is viewed", then: "funding is visible" }] },
        { key: "STORY-2", title: "Validate extracted funding", narrative: "Validate extracted account data through the funding integration.", scenarios: [{ given: "account data", when: "it is extracted", then: "funding is validated" }] },
        { key: "STORY-3", title: "Create follow-up action", narrative: "Persist a follow-up action for an unfunded tenant.", scenarios: [{ given: "an unfunded tenant", when: "validation completes", then: "an action is recorded" }] },
      ],
    },
    repository,
  });

  assert.equal(result.promoted, true);
  assert.equal(prompts.length, 2);
  assert.equal(prompts[1].previousResponseIssue, "STORY_COVERAGE_OWNER_MISSING");
  assert.match(prompts[1].previousResponseCorrection, /STORY-3:action persistence owner/);
  assert.deepEqual(prompts[1].ownerCorrection, [{
    storyKey: "STORY-3",
    owner: "action persistence owner",
    suppliedCandidatePaths: ["src/actions/follow-up.js"],
    acceptanceProof: "Patch the production validation-completion caller through the action writer; test the public workflow creating the persisted action.",
  }]);
  assert.deepEqual(prompts[1].requiredResponsePatchPaths, ["src/actions/follow-up.js"]);
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker requires the established public Lambda owner test instead of an alias", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  const handlerPath = "backend/inventory/lambda/tenant_workflow_rules/handler.py";
  const ownerTestPath = "backend/inventory/tests/test_funding_owner_paths.py";
  await mkdir(join(source, "backend/inventory/lambda/tenant_workflow_rules"), { recursive: true });
  await mkdir(join(source, "backend/inventory/tests"), { recursive: true });
  await writeFile(join(source, handlerPath), "def lambda_handler(event, context):\n    return {'status': 'before'}\n");
  await writeFile(join(source, ownerTestPath), [
    "def test_reachable_workflow_owner():",
    "    handler = load_module('workflow_owner', 'lambda/tenant_workflow_rules/handler.py')",
    "    event = {'tenant_id': 'tenant-1'}",
    "    result = handler.lambda_handler(event, None)",
    "    assert result['status'] is True",
  ].join("\n"));
  const prompts = [];
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        prompts.push(JSON.parse(request.prompt));
        return { text: JSON.stringify({
          schema: "adx-model-patch-response-v1",
          patches: [
            {
              path: handlerPath,
              content: null,
              replacements: [{
                oldText: "    return {'status': 'before'}",
                newText: "    return {'status': True}",
              }],
            },
            {
              path: ownerTestPath,
              content: null,
              replacements: [{
                oldText: "    assert result['status'] is True",
                newText: "    assert result['status'] is True\n    assert result == {'status': True}",
              }],
            },
          ],
          featureSpotlight: null,
          storyCoverage: [{
            storyKey: "STORY-1",
            implementationPaths: [handlerPath],
            testPaths: [ownerTestPath],
          }],
        }) };
      },
    },
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });

  const result = await broker.execute({
    adapter,
    task: {
      ...task,
      stories: [{
        key: "STORY-1",
        title: "Workflow funding",
        narrative: "Run the workflow Lambda.",
        scenarios: [{
          given: "a tenant workflow event",
          when: "the workflow Lambda runs",
          then: "it returns the workflow result",
        }],
      }],
      mandatoryOwnerPaths: { "STORY-1": [handlerPath] },
    },
    repository: { writePaths: ["backend/**"] },
  });

  assert.equal(result.promoted, true);
  assert.ok(prompts[0].requiredResponsePatchPaths.includes(ownerTestPath), JSON.stringify(prompts[0]));
  assert.deepEqual(prompts[0].lambdaOwnerTestContracts, [{
    ownerPath: handlerPath,
    testPath: ownerTestPath,
    invocation: "lambda_handler(event, context)",
    observable: "a blocked response, persisted write, or delivery result",
  }]);
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker repairs a helper-only Lambda test with the public handler contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  const handlerPath = "backend/inventory/lambda/tenant_workflow_rules/handler.py";
  const testPath = "backend/inventory/tests/test_workflow_funding.py";
  await mkdir(join(source, "backend/inventory/lambda/tenant_workflow_rules"), { recursive: true });
  await mkdir(join(source, "backend/inventory/tests"), { recursive: true });
  await writeFile(join(source, handlerPath), "def lambda_handler(event, context):\n    return {'status': False}\n");
  await writeFile(join(source, testPath), [
    "def test_story_3_workflow_result():",
    "    handler = load_module('workflow_owner', 'lambda/tenant_workflow_rules/handler.py')",
    "    event = {'tenant_id': 'tenant-1'}",
    "    result = funding_helper(event)",
    "    assert result['status'] is True",
  ].join("\n"));
  const prompts = [];
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        prompts.push(JSON.parse(request.prompt));
        const repaired = prompts.length === 2;
        return { text: JSON.stringify({
          schema: "adx-model-patch-response-v1",
          patches: repaired
            ? [{
                path: testPath,
                content: null,
                replacements: [{
                  oldText: "    result = funding_helper(event)",
                  newText: "    result = handler.lambda_handler(event, None)",
                }],
              }]
            : [
                {
                  path: handlerPath,
                  content: null,
                  replacements: [{ oldText: "    return {'status': False}", newText: "    return {'status': True}" }],
                },
                {
                  path: testPath,
                  content: null,
                  replacements: [{ oldText: "    assert result['status'] is True", newText: "    assert result['status'] is True" }],
                },
              ],
          featureSpotlight: null,
          storyCoverage: [{
            storyKey: "STORY-3",
            implementationPaths: [handlerPath],
            testPaths: [testPath],
          }],
        }) };
      },
    },
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });

  const result = await broker.execute({
    adapter,
    task: {
      ...task,
      stories: [{
        key: "STORY-3",
        title: "Deliver workflow funding result",
        narrative: "Run the workflow Lambda for a funding event.",
        scenarios: [{ given: "a workflow event", when: "the Lambda runs", then: "a result is delivered" }],
      }],
      mandatoryOwnerPaths: { "STORY-3": [handlerPath] },
    },
    repository: { writePaths: ["backend/**"] },
  });

  assert.equal(result.promoted, true, JSON.stringify(result));
  assert.equal(prompts.length, 2);
  assert.equal(prompts[1].previousResponseIssue, "LAMBDA_OWNER_TEST_NOT_BEHAVIORAL");
  assert.deepEqual(prompts[1].ownerTestRepair, {
    storyKey: "STORY-3",
    testPath,
    ownerPath: handlerPath,
    publicEntryPoint: "lambda_handler",
    callerInput: "a caller-shaped event",
    observable: "the owner-visible blocked, persisted, or delivered result",
    requiredStatements: [
      `import lambda_handler from ${handlerPath}`,
      "create a caller-shaped event object",
      "lambda_handler(event, context)",
      "assert the response status or an observable persisted, blocked, or delivered result",
      "mock only external boundaries; never mock lambda_handler",
    ],
  });
  assert.deepEqual(prompts[1].requiredResponsePatchPaths, [testPath]);
  assert.ok(prompts[1].rules.some((rule) => rule.includes("define a caller-shaped event variable")));
  await rm(root, { recursive: true, force: true });
});

test("demo-only runs relax Lambda owner-test evidence while retaining the owner patch", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  const handlerPath = "backend/inventory/lambda/sbl/example/handler.py";
  const testPath = "backend/inventory/lambda/sbl/example/test_guard.py";
  await mkdir(join(source, "backend/inventory/lambda/sbl/example"), { recursive: true });
  await writeFile(join(source, handlerPath), "def lambda_handler(event, context):\n    return {'blocked': False}\n");
  await writeFile(join(source, testPath), "def test_guard_helper():\n    assert guard_unfunded({'status': 'UNFUNDED'})\n");
  const prompts = [];
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        prompts.push(JSON.parse(request.prompt));
        return { text: JSON.stringify({
          schema: "adx-model-patch-response-v1",
          patches: [
            { path: handlerPath, content: null, replacements: [{ oldText: "    return {'blocked': False}", newText: "    return {'blocked': True}" }] },
            { path: testPath, content: null, replacements: [{ oldText: "    assert guard_unfunded({'status': 'UNFUNDED'})", newText: "    assert guard_unfunded({'status': 'UNFUNDED'})  # demo-only evidence" }] },
          ],
          featureSpotlight: null,
          storyCoverage: [{ storyKey: "STORY-6", implementationPaths: [handlerPath], testPaths: [testPath] }],
        }) };
      },
    },
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });

  const result = await broker.execute({
    adapter,
    task: {
      ...task,
      skipExecutableValidation: true,
      stories: [{
        key: "STORY-6",
        title: "Block the SBL operation",
        narrative: "Block an unfunded tenant before the SBL Lambda operation.",
        scenarios: [{ given: "an unfunded tenant", when: "the SBL Lambda runs", then: "the operation is blocked" }],
      }],
      mandatoryOwnerPaths: { "STORY-6": [handlerPath] },
    },
    repository: { writePaths: ["backend/**"] },
  });

  assert.equal(result.promoted, true);
  assert.equal(result.outputDigest, "sha256:demo-executable-validation-skipped");
  assert.equal(prompts[0].demoOnly, true);
  assert.deepEqual(prompts[0].lambdaOwnerTestContracts, []);
  assert.ok(prompts[0].rules.some((rule) => rule.includes("Demo-only evidence policy")));
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker requires an exact supplied notification owner instead of a generic workflow helper", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  const actionPath = "backend/inventory/lambda/tenant_action/account_field_log.py";
  const senderPath = "backend/inventory/lambda/integration_readiness_report/ms_graph_email_service.py";
  const helperPath = "backend/inventory/lambda/tenant_workflow_rules/funding.py";
  const testPath = "backend/inventory/lambda/tenant_action/tests/test_funding_notification.py";
  for (const path of [actionPath, senderPath, helperPath, testPath]) await mkdir(dirname(join(source, path)), { recursive: true });
  await writeFile(join(source, actionPath), "from ms_graph_email_service import send_email\ndef record_action(): return send_email()\n");
  await writeFile(join(source, senderPath), "def send_email(recipient): return recipient\n");
  await writeFile(join(source, helperPath), "def evaluate_funding(): return 'UNKNOWN'\n");
  await writeFile(join(source, testPath), "def test_existing(): pass\n");
  const prompts = [];
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        prompts.push(JSON.parse(request.prompt));
        const repaired = prompts.length === 2;
        return { text: JSON.stringify({
          schema: "adx-model-patch-response-v1",
          patches: [
            ...(repaired ? [{ path: actionPath, content: "from ms_graph_email_service import send_email\ndef record_action(): return send_email('ops@example.test')\n" }] : []),
            { path: repaired ? senderPath : helperPath, content: repaired ? "def send_email(recipient): return 'sent'\n" : "def evaluate_funding(): return 'UNKNOWN'\n" },
            { path: testPath, content: "def test_STORY_4_notification_delivery(): assert True\n" },
          ],
          featureSpotlight: null,
          storyCoverage: [{ storyKey: "STORY-4", implementationPaths: repaired ? [actionPath, senderPath] : [helperPath], testPaths: [testPath] }],
        }) };
      },
    },
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });
  const result = await broker.execute({
    adapter,
    task: { ...task, stories: [{ key: "STORY-4", title: "Notify operations", narrative: "Send an email notification after the funding follow-up action persists.", scenarios: [{ given: "an unfunded account", when: "the action persists", then: "the recipient is notified" }] }] },
    repository: { writePaths: ["backend/**"] },
  });
  assert.equal(result.promoted, true);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1].previousResponseCorrection, /STORY-4:notification delivery owner/);
  const notificationOwner = prompts[0].requiredOwnerContext.find((owner) => owner.owner === "notification delivery owner");
  assert.deepEqual(notificationOwner.suppliedCandidatePaths, [actionPath, senderPath]);
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker rejects an active-unfunded action test that omits the active fixture", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  const actionPath = "backend/inventory/lambda/tenant_action/account_field_log.py";
  const testPath = "backend/inventory/tests/test_funding_owner_paths.py";
  await mkdir(dirname(join(source, actionPath)), { recursive: true });
  await mkdir(dirname(join(source, testPath)), { recursive: true });
  await writeFile(join(source, actionPath), "def updateTenantActionTable(tenant_id, is_active=False):\n    if not is_active:\n        return None\n    return put_tenant_action_item(tenant_id)\n");
  await writeFile(join(source, testPath), "def test_existing(): pass\n");
  const prompts = [];
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        prompts.push(JSON.parse(request.prompt));
        const repaired = prompts.length === 2;
        return { text: JSON.stringify({
          schema: "adx-model-patch-response-v1",
          patches: [
            { path: actionPath, content: "def updateTenantActionTable(tenant_id, is_active=False):\n    if not is_active:\n        return None\n    return put_tenant_action_item(tenant_id)\n" },
            { path: testPath, content: repaired
              ? "from unittest.mock import Mock\ndef test_STORY_3_active_unfunded_action():\n    put_tenant_action_item = Mock()\n    updateTenantActionTable('tenant-1', is_active=True)\n    assert put_tenant_action_item\n"
              : "from unittest.mock import Mock\ndef test_STORY_3_active_unfunded_action():\n    put_tenant_action_item = Mock()\n    updateTenantActionTable('tenant-1')\n    assert put_tenant_action_item\n" },
          ],
          featureSpotlight: null,
          storyCoverage: [{ storyKey: "STORY-3", implementationPaths: [actionPath], testPaths: [testPath] }],
        }) };
      },
    },
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });
  const result = await broker.execute({
    adapter,
    task: { ...task, stories: [{ key: "STORY-3", title: "Record active unfunded follow-up", narrative: "Create an action for an active unfunded tenant.", scenarios: [{ given: "an active unfunded tenant", when: "funding completes", then: "the action is recorded" }] }] },
    repository: { writePaths: ["backend/**"] },
  });
  assert.equal(result.promoted, true);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1].previousResponseCorrection, /explicitly active/);
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker retries account-discovery coverage with an explicit owner-test contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  const accountDiscoveryPath = "backend/inventory/lambda/tenant_workflow_rules/account_discovery.py";
  const fundingValidationPath = "backend/inventory/lambda/tenant_workflow_rules/funding_validation.py";
  const testPath = "backend/inventory/tests/test_account_discovery_funding_validation.py";
  for (const path of [accountDiscoveryPath, fundingValidationPath, testPath]) await mkdir(dirname(join(source, path)), { recursive: true });
  await writeFile(join(source, accountDiscoveryPath), "def process_account_discovery(extracted_accounts):\n    return extracted_accounts\n");
  await writeFile(join(source, fundingValidationPath), "def validate_funding():\n    return 'unknown'\n");
  await writeFile(join(source, testPath), "# process_account_discovery(\ndef test_funding():\n    assert True\n");
  const prompts = [];
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        prompts.push(JSON.parse(request.prompt));
        const testReplacement = prompts.length === 1
          ? { oldText: "# process_account_discovery(", newText: "# detached helper test" }
          : { oldText: "# process_account_discovery(", newText: [
            "from tenant_workflow_rules.account_discovery import process_account_discovery",
            "from tenant_workflow_rules import funding_validation",
            "",
            "def test_story_1_persists_extracted_account_funding():",
            "    extracted_accounts = [{'tenant_id': 'tenant-1', 'aide_id': 'aide-1'}]",
            "    tenant_table = Mock()",
            "    process_account_discovery(extracted_accounts)",
            "    tenant_table.update_item.assert_called()",
          ].join("\n") };
        return { text: JSON.stringify({
          schema: "adx-model-patch-response-v1",
          patches: prompts.length === 1 ? [
            { path: accountDiscoveryPath, content: null, replacements: [{ oldText: "    return extracted_accounts", newText: "    return list(extracted_accounts)" }] },
            { path: testPath, content: null, replacements: [testReplacement] },
          ] : [
            { path: fundingValidationPath, content: null, replacements: [{ oldText: "    return 'unknown'", newText: "    return 'UNKNOWN'" }] },
            { path: testPath, content: null, replacements: [testReplacement] },
          ],
          featureSpotlight: null,
          storyCoverage: [{
            storyKey: "STORY-1",
            implementationPaths: prompts.length === 1
              ? [accountDiscoveryPath]
              : [accountDiscoveryPath, fundingValidationPath],
            testPaths: [testPath],
          }],
        }) };
      },
    },
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });

  const result = await broker.execute({
    adapter,
    task: {
      ...task,
      stories: [{
        key: "STORY-1",
        title: "Validate extracted account funding",
        narrative: "Validate extracted account data through account discovery.",
        scenarios: [{ given: "extracted account data", when: "account discovery runs", then: "a tenant funding decision is persisted" }],
      }],
      mandatoryOwnerPaths: { "STORY-1": [accountDiscoveryPath] },
    },
    repository: { writePaths: ["backend/**"] },
  });

  assert.equal(result.promoted, true);
  assert.equal(prompts.length, 2);
  assert.equal(prompts[1].ownerTestRepair, null);
  assert.deepEqual(prompts[1].authoritativeAdapterRepair, {
    storyKey: "STORY-1",
    adapterPath: fundingValidationPath,
    testPath,
    ownerPath: accountDiscoveryPath,
  });
  assert.deepEqual(
    [...prompts[1].requiredResponsePatchPaths].sort(),
    [fundingValidationPath, testPath].sort(),
  );
  assert.deepEqual(prompts[1].authoritativeAdapterRecovery, {
    patchPaths: [fundingValidationPath, testPath],
    retainStagedProductionPatches: true,
    patchCount: 2,
  });
  assert.deepEqual(
    prompts[1].files.map((file) => file.path).sort(),
    [accountDiscoveryPath, fundingValidationPath, testPath].sort(),
  );
  assert.match(prompts[1].previousResponseCorrection, /Emit only missing owner or evidence patches/);
  assert.ok(prompts[1].rules.some((rule) => rule.includes("authoritativeAdapterRepair.adapterPath")));
  assert.ok(prompts[1].rules.some((rule) => rule.includes("Return exactly two patches")));
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker does not bind a response to an undiscovered owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "funding.js"), "export const funding = 'before'\n");
  await writeFile(join(source, "src", "funding.test.js"), "test('before', () => {})\n");
  let prompt;
  const broker = new ModelPatchBroker({
    enabled: true, sourceRoot: source, candidateRoot: candidate,
    gateway: { status: () => ({ configured: true }), complete: async (request) => {
      prompt = JSON.parse(request.prompt);
      return { text: JSON.stringify({ schema: "adx-model-patch-response-v1", patches: [
        { path: "src/funding.js", content: "export const funding = 'after'\n" },
        { path: "src/funding.test.js", content: "test('STORY-4', () => {})\n" },
      ], featureSpotlight: null, storyCoverage: [{ storyKey: "STORY-4", implementationPaths: ["src/funding.js"], testPaths: ["src/funding.test.js"] }] }) };
    } },
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });
  const result = await broker.execute({
    adapter, repository,
    task: { ...task, stories: [{ key: "STORY-4", title: "Notify operations", narrative: "Notify the recipient.", scenarios: [{ given: "funding", when: "it changes", then: "an email is sent" }] }] },
  });
  assert.equal(result.promoted, true);
  assert.deepEqual(prompt.requiredOwnerContext.find((owner) => owner.owner === "notification delivery owner"), {
    storyKey: "STORY-4", owner: "notification delivery owner",
    acceptanceProof: "Patch the production action path through the notification sender with a resolved recipient; test notification as an outcome of that public action path.",
    requiredInThisResponse: false, acceptedPaths: [], suppliedCandidatePaths: [], ownerDiscovery: "NO_SUPPLIED_PRODUCTION_OWNER",
  });
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker applies only a validated writable-file replacement in a disposable candidate", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(
    join(source, "src", "marker.js"),
    'export const marker = "before"\n',
  );
  await mkdir(join(source, "src", "nested", "node_modules"), { recursive: true });
  await writeFile(
    join(source, "src", "nested", "node_modules", "ignored.js"),
    "ignored\n",
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

test("model-patch broker prioritizes task-relevant files before applying the context byte budget", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  for (let index = 0; index < 8; index += 1) {
    await writeFile(join(source, "src", `early-${index}.js`), "x".repeat(22 * 1024));
  }
  await writeFile(join(source, "src", "tenant-search.js"), 'export const marker = "before"\n');
  await writeFile(join(source, "src", "tenant-search.test.js"), 'export const expected = "before"\n');
  const requests = [];
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        requests.push(request);
        return {
          model: "gpt-5.6-terra",
          responseDigest: "sha256:response",
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches: [
              { path: "src/tenant-search.js", content: 'export const marker = "after"\n' },
              { path: "src/tenant-search.test.js", content: 'export const expected = "after"\n' },
            ],
            featureSpotlight: {
              featureId: "tenant-search",
              title: "Tenant search",
              summary: "Tenant search behavior is available.",
            },
          }),
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

  await broker.execute({
    adapter,
    task: { ...task, objective: "Implement tenant search behavior." },
    repository,
  });

  const paths = JSON.parse(requests[0].prompt).files.map((file) => file.path);
  assert.deepEqual(paths.slice(0, 2), ["src/tenant-search.js", "src/tenant-search.test.js"]);
  assert.equal(paths.includes("src/early-7.js"), false);
});

test("model-patch broker reserves initial context for routed owners before semantic verification", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src", "pages"), { recursive: true });
  for (let index = 0; index < 8; index += 1) {
    await writeFile(
      join(source, "src", `tenant-onboarding-funding-${index}.js`),
      "x".repeat(22 * 1024),
    );
  }
  await writeFile(
    join(source, "src", "pages", "TenantManagement.jsx"),
    'export const TenantManagement = "before"\n',
  );
  const requests = [];
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        requests.push(JSON.parse(request.prompt));
        return {
          finishReason: "stop",
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches: [{
              path: "src/pages/TenantManagement.jsx",
              content: 'export const TenantManagement = "after"\n',
            }],
            featureSpotlight: null,
            storyCoverage: [],
          }),
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

  await broker.execute({
    adapter,
    task: { ...task, objective: "Render tenant AIDE funding during onboarding." },
    repository,
  });

  const paths = requests[0].files.map((file) => file.path);
  assert.equal(paths.includes("src/pages/TenantManagement.jsx"), true);
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker reserves and identifies authoritative owner context ahead of lexical distractors", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src", "api"), { recursive: true });
  await mkdir(join(source, "src", "workflows"), { recursive: true });
  for (let index = 0; index < 14; index += 1) {
    await writeFile(
      join(source, "src", "workflows", `tenant-aide-funding-extracted-account-data-${index}.js`),
      "x".repeat(22 * 1024),
    );
  }
  await writeFile(join(source, "src", "api", "accounts.py"), "def funding_status():\n    return False\n");
  await writeFile(join(source, "src", "api", "test_accounts.py"), "def test_before():\n    assert False\n");
  const requests = [];
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        const prompt = JSON.parse(request.prompt);
        requests.push(prompt);
        return {
          finishReason: "stop",
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches: [
              { path: "src/api/accounts.py", content: "def funding_status():\n    return True\n" },
              { path: "src/api/test_accounts.py", content: "def test_story_account():\n    assert 'STORY-ACCOUNT'\n" },
            ],
            featureSpotlight: null,
            storyCoverage: [{
              storyKey: "STORY-ACCOUNT",
              implementationPaths: ["src/api/accounts.py"],
              testPaths: ["src/api/test_accounts.py"],
            }],
          }),
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
  const storyTask = {
    ...task,
    objective: "Confirm tenant AIDE funding during onboarding from authoritative account data.",
    stories: [{
      key: "STORY-ACCOUNT",
      title: "Confirm AIDE funding from extracted account data",
      narrative: "Use the authoritative account API during tenant onboarding.",
      scenarios: [{
        given: "an extracted account with an AIDE ID",
        when: "onboarding checks its source data",
        then: "the funded status is confirmed",
      }],
    }],
  };

  await broker.execute({ adapter, task: storyTask, repository });

  const suppliedPaths = requests[0].files.map((file) => file.path);
  assert.equal(suppliedPaths[0], "src/api/accounts.py");
  assert.deepEqual(requests[0].requiredOwnerContext, [{
    storyKey: "STORY-ACCOUNT",
    owner: "authoritative API or extracted-account data owner",
    acceptanceProof: "Patch the real adapter or retrieval call and its workflow persistence path; invoke the public workflow with caller-shaped data in the test.",
    requiredInThisResponse: true,
    acceptedPaths: [],
    suppliedCandidatePaths: ["src/api/accounts.py"],
    ownerDiscovery: "SUPPLIED_PRODUCTION_OWNER",
  }]);
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker implements capacity-bounded story batches before final validation", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  for (let index = 1; index <= 6; index += 1) {
    await writeFile(join(source, "src", `story-${index}.js`), `export const value = "before-${index}"\n`);
    await writeFile(join(source, "src", `story-${index}.test.js`), `export const expected = "before-${index}"\n`);
  }
  const requests = [];
  let validationCount = 0;
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        const prompt = JSON.parse(request.prompt);
        requests.push(prompt);
        const storyNumbers = prompt.stories.map((story) => story.key.split("-").at(-1));
        return {
          model: "gpt-5.6-terra",
          responseDigest: `sha256:batch-${requests.length}`,
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches: storyNumbers.flatMap((number) => [
              { path: `src/story-${number}.js`, content: `export const value = "after-${number}"\n` },
              { path: `src/story-${number}.test.js`, content: `export const expected = "after-${number}"\n` },
            ]),
            featureSpotlight: null,
            storyCoverage: storyNumbers.map((number) => ({
              storyKey: `STORY-${number}`,
              implementationPaths: [`src/story-${number}.js`],
              testPaths: [`src/story-${number}.test.js`],
            })),
          }),
        };
      },
    },
    validate: async ({ cwd }) => {
      validationCount += 1;
      assert.equal(await readFile(join(cwd, "src", "story-1.js"), "utf8"), 'export const value = "after-1"\n');
      assert.equal(await readFile(join(cwd, "src", "story-6.js"), "utf8"), 'export const value = "after-6"\n');
      return {
        code: 0,
        signal: null,
        timedOut: false,
        outputBytes: 0,
        outputDigest: "sha256:test",
      };
    },
  });
  const stories = [1, 2, 3, 4, 5, 6].map((number) => ({
    key: `STORY-${number}`,
    title: `Maintain behavior ${number}`,
    narrative: `As an operator, I want behavior ${number} maintained, so that the workflow is complete.`,
    scenarios: [{ given: `state ${number}`, when: "the workflow runs", then: "the behavior completes" }],
  }));

  const result = await broker.execute({ adapter, task: { ...task, stories }, repository });

  assert.deepEqual(requests.map((request) => request.stories.map((story) => story.key)), [
    ["STORY-1", "STORY-2", "STORY-3"],
    ["STORY-4", "STORY-5", "STORY-6"],
  ]);
  assert.deepEqual(result.storyCoverage.map((entry) => entry.storyKey), stories.map((story) => story.key));
  assert.equal(validationCount, 1);
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker parallelizes independent affinity batches", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  const ownerPaths = [
    "src/frontend/pages/TenantManagement.jsx",
    "src/api/account-funding.js",
    "src/tenant-action/action-writer.js",
    "src/notification/email-sender.js",
    "src/frontend/pages/Report.jsx",
    "src/frontend/components/sbl/ServiceBasedLaunchpad.jsx",
  ];
  for (let number = 1; number <= 6; number += 1) {
    await mkdir(dirname(join(source, ownerPaths[number - 1])), { recursive: true });
    await writeFile(join(source, ownerPaths[number - 1]), `export const owner = "before-${number}"\n`);
    await writeFile(join(source, "src", `owner-${number}.test.js`), `test("before-${number}", () => {})\n`);
  }
  const batches = [];
  let activeModelCalls = 0;
  let peakModelCalls = 0;
  let validationCount = 0;
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        activeModelCalls += 1;
        peakModelCalls = Math.max(peakModelCalls, activeModelCalls);
        await new Promise((resolve) => setTimeout(resolve, 10));
        const prompt = JSON.parse(request.prompt);
        const storyNumbers = prompt.stories.map((story) => Number(story.key.split("-").at(-1)));
        batches.push(prompt.stories.map((story) => story.key));
        if (storyNumbers.includes(6)) {
          assert.deepEqual(
            prompt.requiredOwnerContext.filter((owner) => owner.storyKey === "STORY-6"),
            [
              {
                storyKey: "STORY-6",
                owner: "SBL owner",
                acceptanceProof: "Patch the invoked SBL operation guard and its blocked response or state; test an attempted public SBL operation.",
                requiredInThisResponse: true,
                acceptedPaths: [],
                suppliedCandidatePaths: [ownerPaths[5]],
                ownerDiscovery: "SUPPLIED_PRODUCTION_OWNER",
              },
              {
                storyKey: "STORY-6",
                owner: "tooling owner",
                acceptanceProof: "Patch the invoked tooling operation guard and its blocked response or state; test an attempted public tooling operation.",
                requiredInThisResponse: true,
                acceptedPaths: [],
                suppliedCandidatePaths: [ownerPaths[5]],
                ownerDiscovery: "SUPPLIED_PRODUCTION_OWNER",
              },
            ],
          );
        }
        const response = {
          finishReason: "stop",
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches: storyNumbers.flatMap((number) => [
              { path: ownerPaths[number - 1], content: `export const owner = "after-${number}"\n` },
              { path: `src/owner-${number}.test.js`, content: `test("STORY-${number}", () => {})\n` },
            ]),
            featureSpotlight: null,
            storyCoverage: storyNumbers.map((number) => ({
              storyKey: `STORY-${number}`,
              implementationPaths: number === 4
                ? [ownerPaths[2], ownerPaths[3]]
                : [ownerPaths[number - 1]],
              testPaths: [`src/owner-${number}.test.js`],
            })),
          }),
        };
        activeModelCalls -= 1;
        return response;
      },
    },
    validate: async () => {
      validationCount += 1;
      return { code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" };
    },
  });
  const storyDefinitions = [
    [1, "Render onboarding funding page", "onboarding funding visibility"],
    [2, "Validate onboarding funding API", "onboarding funding validation"],
    [3, "Record funding follow-up action", "funding follow-up action persistence"],
    [4, "Notify funding follow-up recipient", "funding follow-up notification email"],
    [5, "View historical funding gaps report", "visible historical funding report dashboard"],
    [6, "Block funding tooling", "funding control SBL tooling enforcement"],
  ];
  const stories = storyDefinitions.map(([number, title, phrase]) => ({
    key: `STORY-${number}`,
    title,
    narrative: `As an operator, I want ${phrase}, so that the workflow is complete.`,
    scenarios: [{ given: phrase, when: "the workflow runs", then: `${phrase} is observable` }],
  }));

  const result = await broker.execute({ adapter, task: { ...task, stories }, repository });

  assert.equal(result.promoted, true);
  assert.deepEqual(batches, [
    ["STORY-1", "STORY-5"],
    ["STORY-2", "STORY-6"],
    ["STORY-3", "STORY-4"],
  ]);
  assert.equal(peakModelCalls, 2);
  assert.equal(validationCount, 1);
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker expands owner-heavy stories into the minimum feasible batches", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src", "frontend", "pages"), { recursive: true });
  const stories = [];
  for (let number = 1; number <= 4; number += 1) {
    await writeFile(join(source, "src", "frontend", "pages", `Report${number}.jsx`), `export const report = "before-${number}"\n`);
    await writeFile(join(source, "src", `report-${number}.test.js`), `test("before-${number}", () => {})\n`);
    stories.push({
      key: `STORY-${number}`,
      title: `View report ${number}`,
      narrative: `Display historical report ${number} on its page.`,
      scenarios: [{ given: "report data", when: "I view the page", then: "the report is displayed" }],
    });
  }
  const batches = [];
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        const prompt = JSON.parse(request.prompt);
        const story = prompt.stories[0];
        const number = Number(story.key.split("-").at(-1));
        batches.push(prompt.stories.map(({ key }) => key));
        return {
          finishReason: "stop",
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches: [
              { path: `src/frontend/pages/Report${number}.jsx`, content: `export const report = "after-${number}"\n` },
              { path: `src/report-${number}.test.js`, content: `test("${story.key}", () => {})\n` },
            ],
            featureSpotlight: null,
            storyCoverage: [{
              storyKey: story.key,
              implementationPaths: [`src/frontend/pages/Report${number}.jsx`],
              testPaths: [`src/report-${number}.test.js`],
            }],
          }),
        };
      },
    },
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });

  const result = await broker.execute({ adapter, task: { ...task, stories }, repository });

  assert.equal(result.promoted, true);
  assert.deepEqual(batches, stories.map(({ key }) => [key]));
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker corrects collapsed multi-story coverage before semantic verification", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "funding.js"), 'export const funding = "before"\n');
  await writeFile(join(source, "src", "owner.js"), 'export const owner = "before"\n');
  await writeFile(join(source, "src", "funding.test.js"), 'test("before", () => {})\n');
  const prompts = [];
  const stories = [1, 2, 3].map((number) => ({
    key: `STORY-${number}`,
    title: `Funding workflow ${number}`,
    narrative: `As an operator, I want funding workflow ${number}, so that it is reachable.`,
    scenarios: [{ given: "funding data", when: "the workflow runs", then: `outcome ${number} is observable` }],
  }));
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        const prompt = JSON.parse(request.prompt);
        prompts.push(prompt);
        const corrected = prompts.length === 2;
        const implementationPaths = corrected ? ["src/funding.js", "src/owner.js"] : ["src/funding.js"];
        return {
          finishReason: "stop",
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches: [
              { path: "src/funding.js", content: 'export const funding = "after"\n' },
              ...(corrected ? [{ path: "src/owner.js", content: 'export const owner = "wired"\n' }] : []),
              { path: "src/funding.test.js", content: stories.map((story) => `test("${story.key}", () => {})`).join("\n") + "\n" },
            ],
            featureSpotlight: null,
            storyCoverage: stories.map((story) => ({
              storyKey: story.key,
              implementationPaths,
              testPaths: ["src/funding.test.js"],
            })),
          }),
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

  const result = await broker.execute({ adapter, task: { ...task, stories }, repository });

  assert.equal(result.promoted, true);
  assert.equal(prompts.length, 2);
  assert.equal(prompts[1].previousResponseIssue, "STORY_COVERAGE_COLLAPSED");
  assert.match(prompts[1].previousResponseCorrection, /reachable owning page, route, handler/);
  await rm(root, { recursive: true, force: true });
});

test("semantic verification rejects an isolated component and requires a reachable repair before validation", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "app.js"), 'export const app = "existing"\n');
  const requests = [];
  let codingAttempt = 0;
  let semanticAttempt = 0;
  let validationCount = 0;
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    semanticVerification: true,
    gateway: {
      status: () => ({ configured: true, model: "gpt-5.6-terra" }),
      complete: async (request) => {
        const prompt = JSON.parse(request.prompt);
        requests.push({ name: request.responseSchema.name, prompt });
        if (request.responseSchema.name === "adx_candidate_semantic_verification") {
          semanticAttempt += 1;
          return {
            model: "gpt-5.6-terra",
            responseDigest: `sha256:semantic-${semanticAttempt}`,
            text: JSON.stringify(
              codingAttempt === 1
                ? {
                    schema: "adx-candidate-semantic-verification-v1",
                    passed: false,
                    findings: [{
                      storyKey: "STORY-1",
                      code: "UI_NOT_REACHABLE",
                      message: "FundingStatus is tested but app.js never imports or renders it.",
                      evidencePaths: ["src/FundingStatus.js"],
                    }],
                  }
                : {
                    schema: "adx-candidate-semantic-verification-v1",
                    passed: true,
                    findings: [],
                  },
            ),
          };
        }
        codingAttempt += 1;
        const patches = [
          { path: "src/FundingStatus.js", content: 'export const FundingStatus = "funded"\n' },
          { path: "src/FundingStatus.test.js", content: `// STORY-1\nexport const expected = "funded-${codingAttempt}"\n` },
        ];
        if (codingAttempt === 2)
          patches.push({
            path: "src/app.js",
            content: 'import { FundingStatus } from "./FundingStatus.js"\nexport const app = FundingStatus\n',
          });
        return {
          model: "gpt-5.6-terra",
          responseDigest: `sha256:coding-${codingAttempt}`,
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches,
            featureSpotlight: null,
            storyCoverage: [{
              storyKey: "STORY-1",
              implementationPaths: codingAttempt === 1
                ? ["src/FundingStatus.js"]
                : ["src/FundingStatus.js", "src/app.js"],
              testPaths: ["src/FundingStatus.test.js"],
            }],
          }),
        };
      },
    },
    validate: async ({ cwd }) => {
      validationCount += 1;
      assert.match(await readFile(join(cwd, "src", "app.js"), "utf8"), /FundingStatus/);
      return {
        code: 0,
        signal: null,
        timedOut: false,
        outputBytes: 0,
        outputDigest: "sha256:test",
      };
    },
  });
  const storyTask = {
    ...task,
    objective: "Show funding status in the application.",
    stories: [{
      key: "STORY-1",
      title: "Show funding status",
      narrative: "As an operator, I want to see funding status, so that I can act.",
      scenarios: [{ given: "a funded tenant", when: "the app opens", then: "funding status is visible" }],
    }],
  };

  const result = await broker.execute({ adapter, task: storyTask, repository });

  assert.equal(result.promoted, true);
  assert.equal(codingAttempt, 2);
  assert.equal(semanticAttempt, 1);
  assert.equal(validationCount, 1);
  const repairPrompt = requests.filter((request) => request.name === "adx_model_patch_response")[1].prompt;
  assert.equal(repairPrompt.previousValidationIssue.validationCommand, "candidate verifier pipeline");
  assert.match(repairPrompt.previousValidationIssue.validationOutputExcerpt, /IMPLEMENTATION_NOT_REACHABLE/);
  assert.match(repairPrompt.objective, /test the reachable routed owner itself/);
  assert.ok(repairPrompt.files.some((file) => file.path === "src/app.js"));
  await rm(root, { recursive: true, force: true });
});

test("deterministic verification rejects a swallowed tenant-action scope error before model semantics", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  const actionPath = "backend/inventory/lambda/tenant_action/account_field_log.py";
  const testPath = "backend/inventory/lambda/tenant_action/test_account_field_log.py";
  await mkdir(dirname(join(source, actionPath)), { recursive: true });
  await writeFile(join(source, actionPath), "def updateTenantActionTable(tenant_id):\n    return tenant_id\n");
  const requests = [];
  let codingAttempt = 0;
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    semanticVerification: true,
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        const prompt = JSON.parse(request.prompt);
        requests.push({ name: request.responseSchema.name, prompt });
        if (request.responseSchema.name === "adx_candidate_semantic_verification")
          return { text: JSON.stringify({ schema: "adx-candidate-semantic-verification-v1", passed: true, findings: [] }) };
        codingAttempt += 1;
        const invalid = codingAttempt === 1;
        return { text: JSON.stringify({
          schema: "adx-model-patch-response-v1",
          patches: [
            {
              path: actionPath,
              content: null,
              replacements: [{
                oldText: invalid
                  ? "def updateTenantActionTable(tenant_id):\n    return tenant_id"
                  : "def updateTenantActionTable(tenant_id):\n    try:\n        return tenant.get('tenant_status')\n    except Exception:\n        return None",
                newText: invalid
                  ? "def updateTenantActionTable(tenant_id):\n    try:\n        return tenant.get('tenant_status')\n    except Exception:\n        return None"
                  : "def updateTenantActionTable(tenant_id):\n    return tenant_id",
              }],
            },
            { path: testPath, content: "def test_follow_up():\n    assert True\n", replacements: [] },
          ],
          featureSpotlight: null,
          storyCoverage: [{ storyKey: "STORY-3", implementationPaths: [actionPath], testPaths: [testPath] }],
        }) };
      },
    },
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });
  const result = await broker.execute({
    adapter,
    task: {
      ...task,
      stories: [{
        key: "STORY-3",
        title: "Record an active-unfunded follow-up action",
        narrative: "Persist the action before notifying operations.",
        scenarios: [{ given: "an unfunded tenant", when: "the action owner runs", then: "the action is recorded before notification" }],
      }],
      mandatoryOwnerPaths: { "STORY-3": [actionPath] },
    },
    repository: { writePaths: ["backend/**"] },
  });
  assert.equal(result.promoted, true);
  assert.equal(codingAttempt, 2);
  const repairPrompt = requests.filter((request) => request.name === "adx_model_patch_response")[1].prompt;
  assert.match(repairPrompt.previousValidationIssue.validationOutputExcerpt, /ACTION_OWNER_SCOPE_ERROR/);
  assert.match(repairPrompt.objective, /action owner executable before notification/);
  await rm(root, { recursive: true, force: true });
});

test("deterministic verification rejects tenant-shaped funding validation input", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  const ownerPath = "backend/inventory/lambda/tenant_workflow_rules/account_discovery.py";
  const testPath = "backend/inventory/tests/test_account_discovery_funding.py";
  await mkdir(dirname(join(source, ownerPath)), { recursive: true });
  await writeFile(join(source, ownerPath), "def process_account_discovery(extracted_accounts):\n    return extracted_accounts\n");
  const requests = [];
  let codingAttempt = 0;
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    semanticVerification: true,
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        const prompt = JSON.parse(request.prompt);
        requests.push({ name: request.responseSchema.name, prompt });
        if (request.responseSchema.name === "adx_candidate_semantic_verification")
          return { text: JSON.stringify({ schema: "adx-candidate-semantic-verification-v1", passed: true, findings: [] }) };
        codingAttempt += 1;
        const invalid = codingAttempt === 1;
        return { text: JSON.stringify({
          schema: "adx-model-patch-response-v1",
          patches: [
            {
              path: ownerPath,
              content: null,
              replacements: [{
                oldText: invalid
                  ? "def process_account_discovery(extracted_accounts):\n    return extracted_accounts"
                  : "def process_account_discovery(extracted_accounts):\n    return validate_tenant_funding(tenants)",
                newText: invalid
                  ? "def process_account_discovery(extracted_accounts):\n    return validate_tenant_funding(tenants)"
                  : "def process_account_discovery(extracted_accounts):\n    return validate_tenant_funding(extracted_accounts)",
              }],
            },
            {
              path: testPath,
              content: "import account_discovery\n\ndef test_STORY_2():\n    accounts = [{'aide_id': 'AIDE-1'}]\n    account_discovery.process_account_discovery(accounts)\n    assert 'update_item' or 'put_item'\n",
              replacements: [],
            },
          ],
          featureSpotlight: null,
          storyCoverage: [{ storyKey: "STORY-2", implementationPaths: [ownerPath], testPaths: [testPath] }],
        }) };
      },
    },
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });
  const result = await broker.execute({
    adapter,
    task: {
      ...task,
      stories: [{
        key: "STORY-2",
        title: "Validate extracted account funding",
        narrative: "Use extracted account data for funding validation.",
        scenarios: [{ given: "an extracted AIDE ID", when: "account discovery runs", then: "the decision is persisted" }],
      }],
    },
    repository: { writePaths: ["backend/**"] },
  });
  assert.equal(result.promoted, true);
  assert.equal(codingAttempt, 2);
  const repairPrompt = requests.filter((request) => request.name === "adx_model_patch_response")[1].prompt;
  assert.match(repairPrompt.previousValidationIssue.validationOutputExcerpt, /EXTRACTED_ACCOUNT_DATA_NOT_USED_FOR_VALIDATION/);
  await rm(root, { recursive: true, force: true });
});

test("semantic UI repair selects a routed page owner, never a colocated status leaf", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "frontend", "src", "pages"), { recursive: true });
  await writeFile(join(source, "frontend", "src", "pages", "TenantWorkflow.jsx"), 'export const TenantWorkflow = "before"\n');
  await writeFile(join(source, "frontend", "src", "pages", "TenantDetails.jsx"), 'export const TenantDetails = "before"\n');
  await writeFile(join(source, "frontend", "src", "pages", "TenantOnboardingFundingStatus.jsx"), 'export const FundingStatus = "leaf"\n');
  const codingPrompts = [];
  let codingAttempt = 0;
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    semanticVerification: true,
    gateway: {
      status: () => ({ configured: true, model: "gpt-5.6-terra" }),
      complete: async (request) => {
        const prompt = JSON.parse(request.prompt);
        if (request.responseSchema.name === "adx_candidate_semantic_verification") {
          return {
            text: JSON.stringify(codingAttempt === 1
              ? { schema: "adx-candidate-semantic-verification-v1", passed: false, findings: [{
                storyKey: "STORY-1", code: "UI_NOT_REACHABLE",
                message: "The funding-status leaf is not rendered by Tenant Onboarding.",
                evidencePaths: ["frontend/src/pages/TenantOnboardingFundingStatus.jsx"],
              }] }
              : { schema: "adx-candidate-semantic-verification-v1", passed: true, findings: [] }),
          };
        }
        codingAttempt += 1;
        codingPrompts.push(prompt);
        return {
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches: codingAttempt === 1
              ? [
                { path: "frontend/src/pages/TenantOnboardingFundingStatus.jsx", content: 'export const FundingStatus = "changed-leaf"\n' },
                { path: "frontend/src/pages/TenantOnboardingFundingStatus.test.jsx", content: 'export const testLeaf = true\n' },
              ]
              : [
                { path: "frontend/src/pages/TenantWorkflow.jsx", content: 'export const TenantWorkflow = "wired"\n' },
                { path: "frontend/src/pages/TenantWorkflow.funding.test.jsx", content: 'import { render } from "@testing-library/react";\nimport { TenantWorkflow } from "./TenantWorkflow";\nconst fetchFunding = jest.fn().mockResolvedValue({ status: "FUNDED" });\ntest("renders the funding response", () => render(<TenantWorkflow />));\n' },
              ],
            featureSpotlight: null,
            storyCoverage: [{ storyKey: "STORY-1", implementationPaths: codingAttempt === 1
              ? ["frontend/src/pages/TenantOnboardingFundingStatus.jsx"]
              : ["frontend/src/pages/TenantWorkflow.jsx"], testPaths: codingAttempt === 1
                ? ["frontend/src/pages/TenantOnboardingFundingStatus.test.jsx"]
                : ["frontend/src/pages/TenantWorkflow.funding.test.jsx"] }],
          }),
        };
      },
    },
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });
  const result = await broker.execute({
    adapter,
    repository: { writePaths: ["frontend/src/**"] },
    task: {
      ...task,
      objective: "Show the funding decision on the Tenant Onboarding page.",
      stories: [{
        key: "STORY-1", title: "Funding visibility",
        narrative: "As an onboarding operator, I need the persisted funding decision on the routed page.",
        scenarios: [{ given: "a tenant has a persisted decision", when: "the onboarding route renders", then: "the decision is visible" }],
      }],
    },
  });

  assert.equal(result.promoted, true);
  assert.equal(codingPrompts.length, 2);
  assert.ok(codingPrompts[1].requiredOwnerContext.some((entry) =>
    entry.suppliedCandidatePaths.includes("frontend/src/pages/TenantWorkflow.jsx") &&
    entry.owner === "frontend/page owner"), JSON.stringify(codingPrompts[1].requiredOwnerContext));
  assert.equal(codingPrompts[1].requiredOwnerContext.some((entry) =>
    entry.suppliedCandidatePaths.includes("frontend/src/pages/TenantOnboardingFundingStatus.jsx") &&
    entry.owner === "frontend/page owner"), false);
  assert.ok(codingPrompts[1].rules.some((rule) => /actual onboarding\/workflow routed page/.test(rule)));
  assert.ok(codingPrompts[1].rules.some((rule) => /complete production edge/.test(rule)));
  await rm(root, { recursive: true, force: true });
});

test("semantic repair preserves previously accepted owner coverage without repatching it", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src", "actions"), { recursive: true });
  await mkdir(join(source, "src", "notifications"), { recursive: true });
  await mkdir(join(source, "src", "tests"), { recursive: true });
  await writeFile(join(source, "src", "actions", "follow-up.js"), 'export const action = "before"\n');
  await writeFile(join(source, "src", "notifications", "email-sender.js"), 'export const notification = "before"\n');
  await writeFile(join(source, "src", "tests", "story-4.test.js"), 'test("before", () => {})\n');
  let codingAttempt = 0;
  let verifierAttempt = 0;
  const codingPrompts = [];
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    candidateVerifiers: [{
      id: "story-4-contract",
      verify: async () => {
        verifierAttempt += 1;
        return verifierAttempt === 1
          ? {
              passed: false,
              findings: [{
                storyKey: "STORY-4",
                code: "ACTION_NOT_WIRED",
                message: "The follow-up action is not wired through its public handler.",
                evidencePaths: ["src/actions/follow-up.js"],
              }],
            }
          : { passed: true, findings: [] };
      },
    }],
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        codingAttempt += 1;
        codingPrompts.push(JSON.parse(request.prompt));
        const repair = codingAttempt === 2;
        return {
          finishReason: "stop",
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches: repair
              ? [{ path: "src/actions/follow-up.js", content: 'export const action = "repaired"\n' }]
              : [
                  { path: "src/actions/follow-up.js", content: 'export const action = "after"\n' },
                  { path: "src/notifications/email-sender.js", content: 'export const notification = "after"\n' },
                  { path: "src/tests/story-4.test.js", content: 'test("STORY-4 initial", () => {})\n' },
                ],
            featureSpotlight: null,
            storyCoverage: [{
              storyKey: "STORY-4",
              implementationPaths: repair
                ? ["src/actions/follow-up.js"]
                : ["src/actions/follow-up.js", "src/notifications/email-sender.js"],
              testPaths: ["src/tests/story-4.test.js"],
            }],
          }),
        };
      },
    },
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });

  const result = await broker.execute({
    adapter,
    task: {
      ...task,
      stories: [{
        key: "STORY-4",
        title: "Record and notify funding follow-up",
        narrative: "Persist a follow-up action and notify the recipient by email.",
        scenarios: [{ given: "an unfunded AIDE ID", when: "an action is recorded", then: "the recipient is notified" }],
      }],
    },
    repository,
  });

  assert.equal(result.promoted, true);
  assert.equal(codingAttempt, 2);
  const repairNotificationOwner = codingPrompts[1].requiredOwnerContext.find(
    (owner) => owner.owner === "notification delivery owner",
  );
  assert.equal(repairNotificationOwner.requiredInThisResponse, false);
  assert.deepEqual(repairNotificationOwner.acceptedPaths, ["src/notifications/email-sender.js"]);
  assert.deepEqual(result.storyCoverage, [{
    storyKey: "STORY-4",
    implementationPaths: ["src/actions/follow-up.js", "src/notifications/email-sender.js"],
    testPaths: ["src/tests/story-4.test.js"],
  }]);
  await rm(root, { recursive: true, force: true });
});

test("semantic verification stops when the same findings recur without progress", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "feature.js"), 'export const feature = "before"\n');
  let codingCalls = 0;
  let semanticCalls = 0;
  const stories = [1, 2].map((number) => ({
    key: `STORY-${number}`,
    title: `Story ${number}`,
    narrative: `As a user, I want behavior ${number}, so that it is available.`,
    scenarios: [{ given: `state ${number}`, when: "it is viewed", then: "the behavior is shown" }],
  }));
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    semanticVerification: true,
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        if (request.responseSchema.name === "adx_candidate_semantic_verification") {
          semanticCalls += 1;
          return {
            finishReason: "stop",
            text: JSON.stringify({
              schema: "adx-candidate-semantic-verification-v1",
              passed: false,
              findings: stories.map((story) => ({
                storyKey: story.key,
                code: "BEHAVIOR_MISSING",
                message: `${story.key} is not integrated.`,
                evidencePaths: ["src/feature.js"],
              })),
            }),
          };
        }
        codingCalls += 1;
        return {
          finishReason: "stop",
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches: [
              { path: "src/feature.js", content: 'export const feature = "after"\n' },
              { path: "src/feature.test.js", content: "// STORY-1\n// STORY-2\nexport const expected = true\n" },
            ],
            featureSpotlight: null,
            storyCoverage: stories.map((story) => ({
              storyKey: story.key,
              implementationPaths: ["src/feature.js"],
              testPaths: ["src/feature.test.js"],
            })),
          }),
        };
      },
    },
  });

  const result = await broker.execute({
    adapter,
    task: { ...task, stories },
    repository,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.errorCode, "MODEL_PATCH_VALIDATION_FAILED");
  assert.equal(result.errorDetails.validationCommand, "candidate semantic verifier");
  assert.equal(result.errorDetails.validationCategory, "SEMANTIC_VERIFICATION_FAILED");
  assert.equal(codingCalls, 2);
  assert.equal(semanticCalls, 2);
  await rm(root, { recursive: true, force: true });
});

test("semantic verification retries malformed verdicts with explicit schema correction", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "marker.js"), 'export const marker = "before"\n');
  await writeFile(join(source, "src", "marker.test.js"), '// existing\n');
  const verifierPrompts = [];
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    semanticVerification: true,
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        if (request.responseSchema.name === "adx_candidate_semantic_verification") {
          verifierPrompts.push(JSON.parse(request.prompt));
          const attempt = verifierPrompts.length;
          return {
            model: "gpt-5.6-terra",
            responseDigest: `sha256:verifier-${attempt}`,
            text: attempt === 1
              ? "not json"
              : JSON.stringify(attempt === 2
                ? { schema: "adx-candidate-semantic-verification-v1", passed: true, findings: [{ storyKey: "STORY-1" }] }
                : { schema: "adx-candidate-semantic-verification-v1", passed: true, findings: [] }),
          };
        }
        return {
          model: "gpt-5.6-terra",
          responseDigest: "sha256:coding",
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches: [
              { path: "src/marker.js", content: 'export const marker = "after"\n' },
              { path: "src/marker.test.js", content: '// STORY-1\n' },
            ],
            featureSpotlight: null,
            storyCoverage: [{
              storyKey: "STORY-1",
              implementationPaths: ["src/marker.js"],
              testPaths: ["src/marker.test.js"],
            }],
          }),
        };
      },
    },
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });
  const result = await broker.execute({
    adapter,
    task: {
      ...task,
      stories: [{
        key: "STORY-1",
        title: "Show marker",
        narrative: "As a user, I want a marker, so that status is visible.",
        scenarios: [{ given: "a marker", when: "it is viewed", then: "status is visible" }],
      }],
    },
    repository,
  });

  assert.equal(result.promoted, true, JSON.stringify(result));
  assert.equal(verifierPrompts.length, 3);
  assert.equal(verifierPrompts[1].previousResponseIssue, "SEMANTIC_VERIFICATION_NON_JSON");
  assert.equal(verifierPrompts[2].previousResponseIssue, "SEMANTIC_VERIFICATION_SCHEMA_INVALID");
  assert.match(verifierPrompts[2].previousResponseCorrection, /passed:true with findings:\[\]/);
  await rm(root, { recursive: true, force: true });
});

test("semantic verification compacts all evidence files after an unclassified gateway 400", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "marker.js"), 'export const marker = "before"\n');
  await writeFile(join(source, "src", "marker.test.js"), '// existing\n');
  const semanticPrompts = [];
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    semanticVerification: true,
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        if (request.responseSchema.name === "adx_candidate_semantic_verification") {
          semanticPrompts.push(JSON.parse(request.prompt));
          if (semanticPrompts.length === 1)
            throw new ChangeCaseError(
              "AZURE_OPENAI_GATEWAY_REQUEST_FAILED",
              "Rejected.",
              { details: { providerStatus: 400 } },
            );
          return {
            model: "gpt-5.6-terra",
            responseDigest: "sha256:semantic-compact",
            text: JSON.stringify({
              schema: "adx-candidate-semantic-verification-v1",
              passed: true,
              findings: [],
            }),
          };
        }
        return {
          model: "gpt-5.6-terra",
          responseDigest: "sha256:coding",
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches: [
              { path: "src/marker.js", content: 'export const marker = "after"\n' },
              { path: "src/marker.test.js", content: '// STORY-1\n' },
            ],
            featureSpotlight: null,
            storyCoverage: [{
              storyKey: "STORY-1",
              implementationPaths: ["src/marker.js"],
              testPaths: ["src/marker.test.js"],
            }],
          }),
        };
      },
    },
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });
  const result = await broker.execute({
    adapter,
    task: {
      ...task,
      stories: [{
        key: "STORY-1",
        title: "Show marker",
        narrative: "As a user, I want a marker, so that status is visible.",
        scenarios: [{ given: "a marker", when: "it is viewed", then: "status is visible" }],
      }],
    },
    repository,
  });

  assert.equal(result.promoted, true, JSON.stringify(result));
  assert.equal(semanticPrompts.length, 2);
  assert.equal(semanticPrompts[1].compactContext, true);
  assert.deepEqual(
    semanticPrompts[1].files.map((file) => file.path),
    semanticPrompts[0].files.map((file) => file.path),
  );
  await rm(root, { recursive: true, force: true });
});

test("semantic verification fits changed evidence and integration owners within its context budget", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src", "routes"), { recursive: true });
  const filler = `${"// preserve integration context ".padEnd(100, ".")}\n`.repeat(70);
  for (let number = 0; number < 12; number += 1) {
    const evidencePath = number === 11
      ? join(source, "src", `evidence-${number}.test.js`)
      : join(source, "src", `evidence-${number}.js`);
    await writeFile(evidencePath, `${filler}export const marker${number} = "before";\n`);
    await writeFile(join(source, "src", "routes", `owner-${number}.js`), `${filler}export const owner${number} = "marker";\n`);
  }
  let semanticFiles = [];
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    semanticVerification: true,
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        if (request.responseSchema.name === "adx_candidate_semantic_verification") {
          semanticFiles = JSON.parse(request.prompt).files;
          return {
            model: "gpt-5.6-terra",
            responseDigest: "sha256:semantic-budget",
            text: JSON.stringify({
              schema: "adx-candidate-semantic-verification-v1",
              passed: true,
              findings: [],
            }),
          };
        }
        const patches = Array.from({ length: 12 }, (_, number) => ({
          path: `src/evidence-${number}${number === 11 ? ".test" : ""}.js`,
          content: null,
          replacements: [{
            oldText: `export const marker${number} = "before";`,
            newText: number === 11
              ? `// STORY-1\nexport const marker${number} = "after";`
              : `export const marker${number} = "after";`,
          }],
        }));
        return {
          model: "gpt-5.6-terra",
          responseDigest: "sha256:coding-budget",
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches,
            featureSpotlight: null,
            storyCoverage: [{
              storyKey: "STORY-1",
              implementationPaths: patches.slice(0, -1).map((patch) => patch.path),
              testPaths: [patches.at(-1).path],
            }],
          }),
        };
      },
    },
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });

  const result = await broker.execute({
    adapter,
    task: {
      ...task,
      stories: [{
        key: "STORY-1",
        title: "Show marker",
        narrative: "As a user, I want a marker, so that status is visible.",
        scenarios: [{ given: "a marker", when: "it is viewed", then: "status is visible" }],
      }],
    },
    repository,
  });

  assert.equal(result.promoted, true, JSON.stringify(result));
  assert.equal(semanticFiles.length, 24);
  assert.equal(
    semanticFiles.reduce((total, file) => total + Buffer.byteLength(file.content), 0) <= 160 * 1024,
    true,
  );
  assert.equal(semanticFiles.some((file) => file.path === "src/routes/owner-0.js"), true);
  assert.equal(semanticFiles.some((file) => file.content.includes('marker0 = "after"')), true);
  await rm(root, { recursive: true, force: true });
});

test("candidate verifier plugins repair only failed stories and preserve accepted story changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  for (let number = 1; number <= 3; number += 1) {
    await writeFile(join(source, "src", `story-${number}.js`), `export const value = "before-${number}"\n`);
    await writeFile(join(source, "src", `story-${number}.test.js`), `export const expected = "before-${number}"\n`);
  }
  const codingStoryKeys = [];
  const codingPrompts = [];
  let verifierCalls = 0;
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    candidateVerifiers: [{
      id: "repository-contract",
      verify: async () => {
        verifierCalls += 1;
        return verifierCalls === 1
          ? {
              passed: false,
              findings: [{
                storyKey: "STORY-2",
                code: "OWNER_NOT_WIRED",
                message: "Story 2 is not connected to its owning workflow.",
                evidencePaths: ["src/story-2.js"],
              }, {
                storyKey: "STORY-3",
                code: "DATA_FLOW_MISSING",
                message: "Story 3 is not connected to OwnerWorkflow.",
                evidencePaths: ["src/story-3.js"],
              }],
            }
          : { passed: true, findings: [] };
      },
    }],
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        const prompt = JSON.parse(request.prompt);
        const storyKeys = prompt.stories.map((story) => story.key);
        codingStoryKeys.push(storyKeys);
        codingPrompts.push(prompt);
        const repaired = codingStoryKeys.length > 1;
        return {
          model: "gpt-5.6-terra",
          responseDigest: `sha256:${storyKeys.join("+")}-${repaired}`,
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches: storyKeys.flatMap((storyKey) => {
              const number = storyKey.split("-").at(-1);
              return [
                { path: `src/story-${number}.js`, content: `export const value = "${repaired ? "repaired" : "after"}-${number}"\n` },
                { path: `src/story-${number}.test.js`, content: `// ${storyKey}\nexport const expected = "${repaired ? "repaired" : "after"}-${number}"\n` },
              ];
            }),
            featureSpotlight: null,
            storyCoverage: storyKeys.map((storyKey) => {
              const number = storyKey.split("-").at(-1);
              return {
                storyKey,
                implementationPaths: [`src/story-${number}.js`],
                testPaths: [`src/story-${number}.test.js`],
              };
            }),
          }),
        };
      },
    },
    validate: async ({ cwd }) => {
      assert.equal(await readFile(join(cwd, "src", "story-1.js"), "utf8"), 'export const value = "after-1"\n');
      assert.equal(await readFile(join(cwd, "src", "story-2.js"), "utf8"), 'export const value = "repaired-2"\n');
      assert.equal(await readFile(join(cwd, "src", "story-3.js"), "utf8"), 'export const value = "repaired-3"\n');
      return {
        code: 0,
        signal: null,
        timedOut: false,
        outputBytes: 0,
        outputDigest: "sha256:test",
      };
    },
  });
  const stories = [1, 2, 3].map((number) => ({
    key: `STORY-${number}`,
    title: `Story ${number}`,
    narrative: `As a user, I want behavior ${number}, so that it is available.`,
    scenarios: [{ given: `state ${number}`, when: "it is viewed", then: "the behavior is shown" }],
  }));

  const result = await broker.execute({ adapter, task: { ...task, stories }, repository });

  assert.equal(result.promoted, true);
  assert.deepEqual(codingStoryKeys, [
    ["STORY-1", "STORY-2", "STORY-3"],
    ["STORY-2", "STORY-3"],
  ]);
  assert.match(codingPrompts[1].previousValidationIssue.validationOutputExcerpt, /STORY-2 OWNER_NOT_WIRED/);
  assert.match(codingPrompts[1].previousValidationIssue.validationOutputExcerpt, /STORY-3 DATA_FLOW_MISSING/);
  assert.equal(verifierCalls, 2);
  assert.equal(result.responseDigest, sha256([
    "sha256:STORY-1+STORY-2+STORY-3-false",
    "sha256:STORY-2+STORY-3-true",
  ]));
  await rm(root, { recursive: true, force: true });
});

test("candidate verifier plugins execute concurrently", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "marker.js"), 'export const marker = "before"\n');
  await writeFile(join(source, "src", "marker.test.js"), '// existing\n');
  const pending = [];
  const concurrentVerifier = (id) => ({
    id,
    verify: () => new Promise((resolve) => {
      pending.push(resolve);
      if (pending.length === 2)
        queueMicrotask(() => pending.forEach((complete) => complete({ passed: true, findings: [] })));
    }),
  });
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    candidateVerifiers: [concurrentVerifier("contract-a"), concurrentVerifier("contract-b")],
    gateway: gateway({
      schema: "adx-model-patch-response-v1",
      patches: [
        { path: "src/marker.js", content: 'export const marker = "after"\n' },
        { path: "src/marker.test.js", content: '// STORY-1\n' },
      ],
      featureSpotlight: null,
      storyCoverage: [{
        storyKey: "STORY-1",
        implementationPaths: ["src/marker.js"],
        testPaths: ["src/marker.test.js"],
      }],
    }),
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });
  const result = await broker.execute({
    adapter,
    task: {
      ...task,
      stories: [{
        key: "STORY-1",
        title: "Show marker",
        narrative: "As a user, I want a marker, so that status is visible.",
        scenarios: [{ given: "a marker", when: "it is viewed", then: "status is visible" }],
      }],
    },
    repository,
    timeoutMs: 100,
  });

  assert.equal(result.promoted, true);
  assert.equal(pending.length, 2);
  await rm(root, { recursive: true, force: true });
});

test("candidate verifier deadlines fail closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "marker.js"), 'export const marker = "before"\n');
  await writeFile(join(source, "src", "marker.test.js"), '// existing\n');
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    candidateVerifiers: [{ id: "stalled", verify: () => new Promise(() => {}) }],
    gateway: gateway({
      schema: "adx-model-patch-response-v1",
      patches: [
        { path: "src/marker.js", content: 'export const marker = "after"\n' },
        { path: "src/marker.test.js", content: '// STORY-1\n' },
      ],
      featureSpotlight: null,
      storyCoverage: [{
        storyKey: "STORY-1",
        implementationPaths: ["src/marker.js"],
        testPaths: ["src/marker.test.js"],
      }],
    }),
  });
  const storyTask = {
    ...task,
    stories: [{
      key: "STORY-1",
      title: "Show marker",
      narrative: "As a user, I want a marker, so that status is visible.",
      scenarios: [{ given: "a marker", when: "it is viewed", then: "status is visible" }],
    }],
  };

  await assert.rejects(
    broker.execute({ adapter, task: storyTask, repository, timeoutMs: 10 }),
    (error) => error.code === "CANDIDATE_VERIFIER_TIMED_OUT",
  );
  await rm(root, { recursive: true, force: true });
});

test("candidate verifier findings cannot cite context that was not supplied", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "marker.js"), 'export const marker = "before"\n');
  await writeFile(join(source, "src", "marker.test.js"), '// existing\n');
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    candidateVerifiers: [{
      id: "unsupported-evidence",
      verify: async () => ({
        passed: false,
        findings: [{
          storyKey: "STORY-1",
          code: "UNSUPPORTED",
          message: "The finding cites evidence outside the supplied context.",
          evidencePaths: ["src/not-supplied.js"],
        }],
      }),
    }],
    gateway: gateway({
      schema: "adx-model-patch-response-v1",
      patches: [
        { path: "src/marker.js", content: 'export const marker = "after"\n' },
        { path: "src/marker.test.js", content: '// STORY-1\n' },
      ],
      featureSpotlight: null,
      storyCoverage: [{
        storyKey: "STORY-1",
        implementationPaths: ["src/marker.js"],
        testPaths: ["src/marker.test.js"],
      }],
    }),
  });
  const storyTask = {
    ...task,
    stories: [{
      key: "STORY-1",
      title: "Show marker",
      narrative: "As a user, I want a marker, so that status is visible.",
      scenarios: [{ given: "a marker", when: "it is viewed", then: "status is visible" }],
    }],
  };

  await assert.rejects(
    broker.execute({ adapter, task: storyTask, repository }),
    (error) => error.code === "CANDIDATE_VERIFIER_INVALID" && /not-supplied/.test(error.message),
  );
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker applies exact anchored replacements to oversized files", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  const anchor = 'export const tenantStatus = "before";';
  await writeFile(join(source, "src", "large-tenant.js"), `${"// tenant context\n".repeat(1800)}${anchor}\n`);
  await writeFile(join(source, "src", "large-tenant.test.js"), 'test("existing", () => {})\n');
  let observedTruncatedContext = false;
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        const prompt = JSON.parse(request.prompt);
        observedTruncatedContext = prompt.files.some((file) =>
          file.path === "src/large-tenant.js" && file.truncated === true && file.content.includes(anchor));
        return {
          model: "gpt-5.6-terra",
          responseDigest: "sha256:anchored",
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches: [
              {
                path: "src/large-tenant.js",
                content: null,
                replacements: [{ oldText: anchor, newText: 'export const tenantStatus = "after";' }],
              },
              {
                path: "src/large-tenant.test.js",
                content: 'test("STORY-1 tenant status", () => {})\n',
                replacements: [],
              },
            ],
            featureSpotlight: null,
            storyCoverage: [{
              storyKey: "STORY-1",
              implementationPaths: ["src/large-tenant.js"],
              testPaths: ["src/large-tenant.test.js"],
            }],
          }),
        };
      },
    },
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });
  const storyTask = {
    ...task,
    stories: [{
      key: "STORY-1",
      title: "Show tenant status",
      narrative: "As a user, I want tenant status, so that readiness is visible.",
      scenarios: [{ given: "a tenant", when: "it is viewed", then: "status is shown" }],
    }],
  };

  const result = await broker.execute({ adapter, task: storyTask, repository });

  assert.equal(result.promoted, true, JSON.stringify(result));
  assert.equal(observedTruncatedContext, true);
  const candidateContent = await readFile(join(candidate, "src", "large-tenant.js"), "utf8");
  assert.equal(candidateContent.includes('tenantStatus = "after"'), true);
  assert.equal(candidateContent.includes("// tenant context"), true);
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker applies the whitespace-equivalent anchor accepted during validation", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(
    join(source, "src", "tenant-status.js"),
    'export function tenantStatus() {\n  return "before";\n}\n',
  );
  await writeFile(join(source, "src", "tenant-status.test.js"), 'test("existing", () => {})\n');
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: gateway({
      schema: "adx-model-patch-response-v1",
      patches: [
        {
          path: "src/tenant-status.js",
          content: null,
          replacements: [{
            oldText: '    return "before";',
            newText: '  return "after";',
          }],
        },
        {
          path: "src/tenant-status.test.js",
          content: 'test("STORY-1 tenant status", () => {})\n',
          replacements: [],
        },
      ],
      featureSpotlight: null,
      storyCoverage: [{
        storyKey: "STORY-1",
        implementationPaths: ["src/tenant-status.js"],
        testPaths: ["src/tenant-status.test.js"],
      }],
    }),
    validate: async ({ cwd }) => {
      assert.equal(
        await readFile(join(cwd, "src", "tenant-status.js"), "utf8"),
        'export function tenantStatus() {\n  return "after";\n}\n',
      );
      return { code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" };
    },
  });

  const result = await broker.execute({
    adapter,
    task: {
      ...task,
      stories: [{
        key: "STORY-1",
        title: "Show tenant status",
        narrative: "As a user, I want tenant status, so that readiness is visible.",
        scenarios: [{ given: "a tenant", when: "it is viewed", then: "status is shown" }],
      }],
    },
    repository,
  });

  assert.equal(result.promoted, true);
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker normalizes harmless paths and collapses identical duplicate patches locally", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "marker.js"), 'export const marker = "before"\n');
  await writeFile(join(source, "src", "marker.test.js"), 'test("existing", () => {})\n');
  let modelCalls = 0;
  const implementationPatch = { path: "./src/marker.js", content: 'export const marker = "after"\n', replacements: [] };
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async () => {
        modelCalls += 1;
        return {
          finishReason: "stop",
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches: [
              implementationPatch,
              { ...implementationPatch, path: "src\\marker.js" },
              { path: "src\\marker.test.js", content: 'test("STORY-1 marker", () => {})\n', replacements: [] },
            ],
            featureSpotlight: null,
            storyCoverage: [{
              storyKey: "STORY-1",
              implementationPaths: ["./src/marker.js"],
              testPaths: ["src\\marker.test.js"],
            }],
          }),
        };
      },
    },
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });

  const result = await broker.execute({
    adapter,
    task: {
      ...task,
      stories: [{
        key: "STORY-1",
        title: "Show marker",
        narrative: "As a user, I want a marker, so that status is visible.",
        scenarios: [{ given: "a marker", when: "it is viewed", then: "status is visible" }],
      }],
    },
    repository,
  });

  assert.equal(result.promoted, true);
  assert.equal(modelCalls, 1);
  assert.equal(await readFile(join(candidate, "src", "marker.js"), "utf8"), 'export const marker = "after"\n');
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker gives conflicting duplicate paths a precise retry correction", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "marker.js"), 'export const marker = "before"\n');
  await writeFile(join(source, "src", "marker.test.js"), 'test("existing", () => {})\n');
  const prompts = [];
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        prompts.push(JSON.parse(request.prompt));
        const implementationPatches = prompts.length === 1
          ? [
              { path: "src/marker.js", content: 'export const marker = "first"\n', replacements: [] },
              { path: "src/marker.js", content: 'export const marker = "second"\n', replacements: [] },
            ]
          : [{ path: "src/marker.js", content: 'export const marker = "after"\n', replacements: [] }];
        return {
          finishReason: "stop",
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches: [
              ...implementationPatches,
              { path: "src/marker.test.js", content: 'test("STORY-1 marker", () => {})\n', replacements: [] },
            ],
            featureSpotlight: null,
            storyCoverage: [{
              storyKey: "STORY-1",
              implementationPaths: ["src/marker.js"],
              testPaths: ["src/marker.test.js"],
            }],
          }),
        };
      },
    },
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });

  const result = await broker.execute({
    adapter,
    task: {
      ...task,
      stories: [{
        key: "STORY-1",
        title: "Show marker",
        narrative: "As a user, I want a marker, so that status is visible.",
        scenarios: [{ given: "a marker", when: "it is viewed", then: "status is visible" }],
      }],
    },
    repository,
  });

  assert.equal(result.promoted, true);
  assert.equal(prompts.length, 2);
  assert.equal(prompts[1].previousResponseIssue, "PATCH_PATH_DUPLICATE");
  assert.match(prompts[1].previousResponseCorrection, /Emit "src\/marker\.js" exactly once/);
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker stops after an unchanged precise response defect repeats", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "marker.js"), 'export const marker = "before"\n');
  let modelCalls = 0;
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async () => {
        modelCalls += 1;
        return {
          finishReason: "stop",
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches: [{ path: "src/marker.js", content: null, replacements: [] }],
            featureSpotlight: null,
            storyCoverage: [],
          }),
        };
      },
    },
  });

  await assert.rejects(
    broker.execute({ adapter, task, repository }),
    (error) =>
      error.code === "MODEL_PATCH_RESPONSE_INVALID" &&
      error.details?.responseIssue === "PATCH_MODE_INVALID" &&
      error.details?.modelAttempts === 2,
  );
  assert.equal(modelCalls, 2);
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker retries a non-unique anchor before writing the batch", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  const uniqueAnchor = '// tenant context\nexport const tenantStatus = "before";';
  await writeFile(
    join(source, "src", "large-tenant.js"),
    `${"// repeated\n".repeat(2200)}${uniqueAnchor}\n`,
  );
  await writeFile(join(source, "src", "large-tenant.test.js"), 'test("existing", () => {})\n');
  const requests = [];
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        requests.push(JSON.parse(request.prompt));
        const oldText = requests.length === 1 ? "// repeated" : uniqueAnchor;
        return {
          model: "gpt-5.6-terra",
          responseDigest: `sha256:anchor-${requests.length}`,
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches: [
              {
                path: "src/large-tenant.js",
                content: null,
                replacements: [{ oldText, newText: '// tenant context\nexport const tenantStatus = "after";' }],
              },
              {
                path: "src/large-tenant.test.js",
                content: 'test("STORY-1 tenant status", () => {})\n',
                replacements: [],
              },
            ],
            featureSpotlight: null,
            storyCoverage: [{
              storyKey: "STORY-1",
              implementationPaths: ["src/large-tenant.js"],
              testPaths: ["src/large-tenant.test.js"],
            }],
          }),
        };
      },
    },
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });
  const result = await broker.execute({
    adapter,
    task: {
      ...task,
      stories: [{
        key: "STORY-1",
        title: "Show tenant status",
        narrative: "As a user, I want tenant status, so that readiness is visible.",
        scenarios: [{ given: "a tenant", when: "it is viewed", then: "status is shown" }],
      }],
    },
    repository,
  });

  assert.equal(result.promoted, true, JSON.stringify(result));
  assert.equal(requests.length, 2);
  assert.equal(requests[1].previousResponseIssue, "PATCH_ANCHOR_NOT_UNIQUE");
  assert.equal(
    requests[1].previousResponseCorrection.includes('rejected oldText "// repeated" matched 2200 times'),
    true,
  );
  assert.match(requests[1].previousResponseCorrection, /Do not reuse that exact oldText/);
  assert.deepEqual(requests[1].requiredResponsePatchPaths, ["src/large-tenant.js"]);
  assert.deepEqual(requests[1].anchorRepair, {
    path: "src/large-tenant.js",
    rejectedOldText: "// repeated",
    matchCount: 2200,
    currentExcerpt: null,
  });
  assert.ok(requests[1].rules.some((rule) => rule.includes("stale or non-unique anchor correction")));
  assert.equal(
    (await readFile(join(candidate, "src", "large-tenant.test.js"), "utf8")),
    'test("STORY-1 tenant status", () => {})\n',
  );
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker accepts a standalone new test emitted with an unnecessary anchor", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  const testPath = "backend/inventory/lambda/sbl/sbl_account_inactive_daily/test_funding_tooling_operation_guard.py";
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "marker.js"), 'export const marker = "before"\n');
  const requests = [];
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        requests.push(JSON.parse(request.prompt));
        return {
          model: "gpt-5.6-terra",
          responseDigest: `sha256:new-file-${requests.length}`,
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches: [
              { path: "src/marker.js", content: 'export const marker = "after"\n', replacements: [] },
              { path: testPath, content: null, replacements: [{ oldText: "def test_guard():", newText: "def test_guard():\n    assert True" }] },
            ],
            featureSpotlight: null,
            storyCoverage: [{
              storyKey: "STORY-1",
              implementationPaths: ["src/marker.js"],
              testPaths: [testPath],
            }],
          }),
        };
      },
    },
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });
  const result = await broker.execute({
    adapter,
    task: {
      ...task,
      stories: [{
        key: "STORY-1",
        title: "Persist marker",
        narrative: "Persist a marker.",
        scenarios: [{ given: "a marker", when: "the change runs", then: "the marker is persisted" }],
      }],
    },
    repository: { writePaths: ["src/**", "backend/**"] },
  });

  assert.equal(result.promoted, true, JSON.stringify(result));
  assert.equal(requests.length, 1);
  assert.equal(await readFile(join(candidate, testPath), "utf8"), "def test_guard():\n    assert True\n");
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker corrects a destructive replacement before writing the batch", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  const existing = `${"// preserve existing behavior\n".repeat(180)}export const tenantStatus = "before"\n`;
  await writeFile(join(source, "src", "tenant.js"), existing);
  await writeFile(join(source, "src", "tenant.test.js"), 'test("existing", () => {})\n');
  const requests = [];
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        requests.push(JSON.parse(request.prompt));
        const implementation = requests.length === 1
          ? 'export const tenantStatus = "after"\n'
          : existing.replace('tenantStatus = "before"', 'tenantStatus = "after"');
        return {
          model: "gpt-5.6-terra",
          responseDigest: `sha256:rewrite-${requests.length}`,
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches: [
              { path: "src/tenant.js", content: implementation, replacements: [] },
              { path: "src/tenant.test.js", content: 'test("STORY-1 tenant status", () => {})\n', replacements: [] },
            ],
            featureSpotlight: null,
            storyCoverage: [{
              storyKey: "STORY-1",
              implementationPaths: ["src/tenant.js"],
              testPaths: ["src/tenant.test.js"],
            }],
          }),
        };
      },
    },
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });

  const result = await broker.execute({
    adapter,
    task: {
      ...task,
      stories: [{
        key: "STORY-1",
        title: "Show tenant status",
        narrative: "As a user, I want tenant status, so that readiness is visible.",
        scenarios: [{ given: "a tenant", when: "it is viewed", then: "status is shown" }],
      }],
    },
    repository,
  });

  assert.equal(result.promoted, true, JSON.stringify(result));
  assert.equal(requests.length, 2);
  const suppliedTenantFile = requests[0].files.find((file) => file.path === "src/tenant.js");
  assert.equal(suppliedTenantFile.existing, true);
  assert.equal(suppliedTenantFile.fullContentSupplied, true);
  assert.equal(
    requests[0].rules.some((rule) => rule.includes("Never return a partial snippet as complete file content")),
    true,
  );
  assert.equal(requests[1].previousResponseIssue, "PATCH_DESTRUCTIVE_REWRITE");
  assert.match(requests[1].previousResponseCorrection, /Preserve unrelated behavior/);
  assert.match(await readFile(join(candidate, "src", "tenant.js"), "utf8"), /tenantStatus = "after"/);
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker corrects destructive anchored replacements before candidate validation", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  const existing = `${"// preserve existing behavior\n".repeat(180)}export const tenantStatus = "before"\n`;
  await writeFile(join(source, "src", "tenant.js"), existing);
  await writeFile(join(source, "src", "tenant.test.js"), 'test("existing", () => {})\n');
  let attempts = 0;
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async () => {
        attempts += 1;
        const replacement = attempts === 1
          ? { oldText: existing, newText: 'export const tenantStatus = "after"\n' }
          : { oldText: 'export const tenantStatus = "before"', newText: 'export const tenantStatus = "after"' };
        return {
          model: "gpt-5.6-terra",
          responseDigest: `sha256:anchored-rewrite-${attempts}`,
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches: [
              { path: "src/tenant.js", content: null, replacements: [replacement] },
              { path: "src/tenant.test.js", content: 'test("STORY-1 tenant status", () => {})\n', replacements: [] },
            ],
            featureSpotlight: null,
            storyCoverage: [{ storyKey: "STORY-1", implementationPaths: ["src/tenant.js"], testPaths: ["src/tenant.test.js"] }],
          }),
        };
      },
    },
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });

  const result = await broker.execute({
    adapter,
    task: { ...task, stories: [{ key: "STORY-1", title: "Show tenant status", narrative: "As a user, I want tenant status, so that readiness is visible.", scenarios: [{ given: "a tenant", when: "it is viewed", then: "status is shown" }] }] },
    repository,
  });

  assert.equal(result.promoted, true, JSON.stringify(result));
  assert.equal(attempts, 2);
  assert.match(await readFile(join(candidate, "src", "tenant.js"), "utf8"), /preserve existing behavior/);
  assert.match(await readFile(join(candidate, "src", "tenant.js"), "utf8"), /tenantStatus = "after"/);
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker rejects later bounded batches that remove earlier story test evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "feature.js"), 'export const value = "before"\n');
  await writeFile(join(source, "src", "owner.js"), 'export const owner = "before"\n');
  await writeFile(join(source, "src", "feature.test.js"), 'test("existing", () => {})\n');
  let requestCount = 0;
  let validationCount = 0;
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        requestCount += 1;
        const storyKeys = JSON.parse(request.prompt).stories.map((story) => story.key);
        return {
          model: "gpt-5.6-terra",
          responseDigest: `sha256:${storyKeys.join("+")}-${requestCount}`,
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches: [
              { path: "src/feature.js", content: `export const value = "${storyKeys.join("+")}"\n` },
              { path: "src/owner.js", content: `export const owner = "${storyKeys.join("+")}"\n` },
              { path: "src/feature.test.js", content: `${storyKeys.map((storyKey) => `test("${storyKey}", () => {})`).join("\n")}\n` },
            ],
            featureSpotlight: null,
            storyCoverage: storyKeys.map((storyKey) => ({
              storyKey,
              implementationPaths: ["src/feature.js", "src/owner.js"],
              testPaths: ["src/feature.test.js"],
            })),
          }),
        };
      },
    },
    validate: async () => {
      validationCount += 1;
      return { code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" };
    },
  });
  const stories = [1, 2, 3, 4, 5, 6, 7].map((number) => ({
    key: `STORY-${number}`,
    title: `Story ${number}`,
    narrative: `As a user, I want behavior ${number}, so that it remains available.`,
    scenarios: [{ given: "a feature", when: "it changes", then: `behavior ${number} remains` }],
  }));

  const result = await broker.execute({ adapter, task: { ...task, stories }, repository });

  assert.equal(result.promoted, false);
  assert.equal(result.errorCode, "MODEL_PATCH_VALIDATION_FAILED");
  assert.match(JSON.stringify(result.errorDetails), /STORY-4.*removed/i);
  assert.equal(requestCount, 4);
  assert.equal(validationCount, 0);
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker requires implementation and test patches for every approved story", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "marker.js"), 'export const marker = "before"\n');
  await writeFile(join(source, "src", "marker.test.js"), 'export const expected = "before"\n');
  const requests = [];
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        requests.push(request);
        return {
          model: "gpt-5.6-terra",
          responseDigest: "sha256:response",
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches: [
              { path: "src/marker.js", content: 'export const marker = "after"\n' },
              { path: "src/marker.test.js", content: 'export const expected = "after"\n' },
            ],
            featureSpotlight: null,
            storyCoverage: [
              {
                storyKey: "STORY-1",
                implementationPaths: ["src/marker.js"],
                testPaths: ["src/marker.test.js"],
              },
            ],
          }),
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
  const storyTask = {
    ...task,
    stories: [
      {
        key: "STORY-1",
        title: "Show marker",
        narrative: "As a user, I want to see the marker, so that I know its state.",
        scenarios: [{ given: "a marker", when: "it is viewed", then: "its state is shown" }],
      },
    ],
  };

  const result = await broker.execute({ adapter, task: storyTask, repository });

  assert.equal(result.promoted, true);
  assert.deepEqual(result.storyCoverage, [{
    storyKey: "STORY-1",
    implementationPaths: ["src/marker.js"],
    testPaths: ["src/marker.test.js"],
  }]);
  assert.match(requests[0].prompt, /"stories":\[\{"key":"STORY-1"/);
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker rejects implementation files relabeled as story tests", async () => {
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
      featureSpotlight: null,
      storyCoverage: [{
        storyKey: "STORY-1",
        implementationPaths: ["src/marker.js"],
        testPaths: ["src/marker.js"],
      }],
    }),
    validate: async () => ({
      code: 0,
      signal: null,
      timedOut: false,
      outputBytes: 0,
      outputDigest: "sha256:test",
    }),
  });

  await assert.rejects(
    broker.execute({
      adapter,
      task: {
        ...task,
        stories: [{
          key: "STORY-1",
          title: "Show marker",
          narrative: "As a user, I want to see the marker, so that I know its state.",
          scenarios: [{ given: "a marker", when: "it is viewed", then: "its state is shown" }],
        }],
      },
      repository,
    }),
    (error) => error.code === "MODEL_PATCH_RESPONSE_INVALID" &&
      error.details?.responseIssue === "STORY_COVERAGE_PATH_OVERLAP",
  );
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker accepts standard Python test filenames outside a tests directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "marker.py"), 'marker = "before"\n');
  await writeFile(join(source, "src", "test_marker.py"), 'def test_marker():\n    assert True\n');
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: gateway({
      schema: "adx-model-patch-response-v1",
      patches: [
        { path: "src/marker.py", content: 'marker = "after"\n' },
        { path: "src/test_marker.py", content: 'def test_marker():\n    assert "after" == "after"\n' },
      ],
      featureSpotlight: null,
      storyCoverage: [{
        storyKey: "STORY-1",
        implementationPaths: ["src/marker.py"],
        testPaths: ["src/test_marker.py"],
      }],
    }),
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });

  const result = await broker.execute({
    adapter,
    task: {
      ...task,
      stories: [{
        key: "STORY-1",
        title: "Show marker",
        narrative: "As a user, I want to see the marker, so that I know its state.",
        scenarios: [{ given: "a marker", when: "it is viewed", then: "its state is shown" }],
      }],
    },
    repository,
  });

  assert.equal(result.promoted, true);
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker skips executable validation only when demo mode is explicit", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "marker.js"), 'export const marker = "before"\n');
  let validationCalls = 0;
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async () => ({ text: JSON.stringify({
        schema: "adx-model-patch-response-v1",
        patches: [
          { path: "src/marker.js", content: 'export const marker = "after"\n', replacements: [] },
          { path: "src/marker.test.js", content: 'test("STORY-1", () => {})\n', replacements: [] },
        ],
        featureSpotlight: null,
        storyCoverage: [{ storyKey: "STORY-1", implementationPaths: ["src/marker.js"], testPaths: ["src/marker.test.js"] }],
      }) }),
    },
    validate: async () => {
      validationCalls += 1;
      return { code: 1, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:should-not-run" };
    },
  });
  const result = await broker.execute({
    adapter,
    task: { ...task, skipExecutableValidation: true },
    repository,
  });
  assert.equal(result.promoted, true);
  assert.equal(validationCalls, 0);
  assert.equal(result.outputDigest, "sha256:demo-executable-validation-skipped");
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker records model-request and model-response phases before validation", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "marker.js"), 'export const marker = "before"\n');
  const phases = [];
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: gateway({
      schema: "adx-model-patch-response-v1",
      patches: [{ path: "src/marker.js", content: 'export const marker = "after"\n' }],
      featureSpotlight: null,
    }),
    validate: async () => ({
      code: 0,
      signal: null,
      timedOut: false,
      outputBytes: 0,
      outputDigest: "sha256:test",
    }),
  });
  await broker.execute({
    adapter,
    task,
    repository,
    onProgress: async (phase) => phases.push(phase),
  });
  assert.deepEqual(phases, [
    "CONTEXT_COLLECTION",
    "CONTEXT_READY",
    "MODEL_REQUEST",
    "MODEL_RESPONSE",
    "PATCH_APPLIED",
    "VALIDATION",
    "VALIDATION_RESULT",
    "CANDIDATE_PROMOTION",
  ]);
  await rm(root, { recursive: true, force: true });
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
  assert.match(calls[1].prompt, /Return exactly one JSON object matching responseSchema/);
  assert.match(calls[1].prompt, /This is a JSON-format recovery/);
  assert.match(calls[1].prompt, /featureSpotlight:null/);
});

test("model-patch broker gives a story-key-specific correction when coverage is omitted", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "marker.js"), 'export const marker = "before"\n');
  await writeFile(join(source, "src", "marker.test.js"), 'test("before", () => {})\n');
  const calls = [];
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        calls.push(request);
        return { text: JSON.stringify(calls.length === 1 ? {
          schema: "adx-model-patch-response-v1",
          patches: [{ path: "src/marker.js", content: 'export const marker = "after"\n' }],
          featureSpotlight: null,
        } : {
          schema: "adx-model-patch-response-v1",
          patches: [
            { path: "src/marker.js", content: 'export const marker = "after"\n' },
            { path: "src/marker.test.js", content: 'test("STORY-1", () => {})\n' },
          ],
          featureSpotlight: null,
          storyCoverage: [{
            storyKey: "STORY-1",
            implementationPaths: ["src/marker.js"],
            testPaths: ["src/marker.test.js"],
          }],
        }) };
      },
    },
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });
  const result = await broker.execute({
    adapter,
    task: {
      ...task,
      stories: [{
        key: "STORY-1",
        title: "Update marker",
        narrative: "Update the marker with a regression test.",
        scenarios: [{ given: "a marker", when: "it is updated", then: "the test proves the update" }],
      }],
    },
    repository,
  });
  assert.equal(result.promoted, true);
  assert.equal(calls.length, 2);
  assert.match(calls[1].prompt, /"previousResponseIssue":"STORY_COVERAGE_MISSING"/);
  assert.match(calls[1].prompt, /STORY-1/);
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker tells a retry when a story has no patched test evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "marker.js"), 'export const marker = "before"\n');
  await writeFile(join(source, "src", "marker.test.js"), 'export const expected = "before"\n');
  const calls = [];
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        calls.push(request);
        const completingTestPatch = calls.length === 2;
        return {
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches: [
              completingTestPatch
                ? { path: "src/marker.test.js", content: 'export const expected = "after"\n' }
                : { path: "src/marker.js", content: 'export const marker = "after"\n' },
            ],
            featureSpotlight: null,
            storyCoverage: [{
              storyKey: "STORY-1",
              implementationPaths: ["src/marker.js"],
              testPaths: ["src/marker.test.js"],
            }],
          }),
          finishReason: "stop",
        };
      },
    },
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });
  const result = await broker.execute({
    adapter,
    task: {
      ...task,
      stories: [{
        key: "STORY-1",
        title: "Show marker",
        narrative: "As a user, I want to see the marker, so that I know its state.",
        scenarios: [{ given: "a marker", when: "it is viewed", then: "its state is shown" }],
      }],
    },
    repository,
  });

  assert.equal(result.promoted, true);
  assert.equal(calls.length, 2);
  assert.match(calls[1].prompt, /"previousResponseIssue":"STORY_COVERAGE_PATCHED_EVIDENCE_MISSING"/);
  assert.match(calls[1].prompt, /Missing implementation patches: none/);
  assert.match(calls[1].prompt, /Missing test patches: src\/marker\.test\.js/);
  assert.match(calls[1].prompt, /"requiredResponsePatchPaths":\["src\/marker\.test\.js"\]/);
  assert.match(calls[1].prompt, /Mandatory correction patch paths: src\/marker\.test\.js/);
  assert.match(calls[1].prompt, /Exact emitted patch paths: src\/marker\.js/);
  assert.match(calls[1].prompt, /Previously accepted patches are retained transactionally/);
  assert.equal(await readFile(join(candidate, "src", "marker.js"), "utf8"), 'export const marker = "after"\n');
  assert.equal(await readFile(join(candidate, "src", "marker.test.js"), "utf8"), 'export const expected = "after"\n');
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker retains one unclaimed emitted test when coverage cites a stale test path", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "marker.js"), 'export const marker = "before"\n');
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async () => ({ text: JSON.stringify({
        schema: "adx-model-patch-response-v1",
        patches: [
          { path: "src/marker.js", content: 'export const marker = "after"\n', replacements: [] },
          { path: "src/funding-status-owner.test.js", content: 'test("STORY-6", () => {})\n', replacements: [] },
        ],
        featureSpotlight: null,
        storyCoverage: [{
          storyKey: "STORY-6",
          implementationPaths: ["src/marker.js"],
          testPaths: ["src/stale-tooling-guard.test.js"],
        }],
      }) }),
    },
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });
  const result = await broker.execute({
    adapter,
    task: {
      ...task,
      stories: [{
        key: "STORY-6",
        title: "Retain patched funding owner evidence",
        narrative: "Keep the emitted behavioral test attached to the story.",
        scenarios: [{ given: "a patch", when: "coverage is returned", then: "the emitted test is retained" }],
      }],
    },
    repository,
  });
  assert.equal(result.promoted, true);
  assert.deepEqual(result.storyCoverage[0].testPaths, ["src/funding-status-owner.test.js"]);
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker retains valid patches for one focused owner correction", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src", "reports"), { recursive: true });
  await mkdir(join(source, "src", "frontend", "pages"), { recursive: true });
  await writeFile(join(source, "src", "reports", "funding-report.js"), 'export const report = "before"\n');
  await writeFile(join(source, "src", "frontend", "pages", "Funding.jsx"), 'export const page = "before"\n');
  await writeFile(join(source, "src", "funding.test.js"), 'test("before", () => {})\n');
  await writeFile(join(source, "src", "marker.js"), 'export const marker = "before"\n');
  await writeFile(join(source, "src", "marker.test.js"), 'test("before", () => {})\n');
  const calls = [];
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        calls.push(JSON.parse(request.prompt));
        if (calls.length === 2)
          return { finishReason: "stop", text: '{"schema":"adx-model-patch-response-v1","patches":[}' };
        const corrected = calls.length === 3;
        return {
          finishReason: "stop",
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches: corrected
              ? [{ path: "src/frontend/pages/Funding.jsx", content: 'export const page = "after"\n' }]
              : [
                  { path: "src/reports/funding-report.js", content: 'export const report = "after"\n' },
                  { path: "src/funding.test.js", content: 'test("STORY-REPORT", () => {})\n' },
                  { path: "src/marker.js", content: 'export const marker = "after"\n' },
                  { path: "src/marker.test.js", content: 'test("STORY-MARKER", () => {})\n' },
                ],
            featureSpotlight: null,
            storyCoverage: [
              {
                storyKey: "STORY-REPORT",
                implementationPaths: corrected
                  ? ["src/reports/funding-report.js", "src/frontend/pages/Funding.jsx"]
                  : ["src/reports/funding-report.js"],
                testPaths: ["src/funding.test.js"],
              },
              {
                storyKey: "STORY-MARKER",
                implementationPaths: ["src/marker.js"],
                testPaths: ["src/marker.test.js"],
              },
            ],
          }),
        };
      },
    },
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });

  const result = await broker.execute({
    adapter,
    task: {
      ...task,
      stories: [
        {
          key: "STORY-REPORT",
          title: "View historical funding report",
          narrative: "Show the report on a visible page.",
          scenarios: [{ given: "funding history", when: "I view the report", then: "the report is displayed" }],
        },
        {
          key: "STORY-MARKER",
          title: "Maintain marker behavior",
          narrative: "Keep marker behavior available.",
          scenarios: [{ given: "a marker", when: "it changes", then: "the behavior remains" }],
        },
      ],
    },
    repository,
  });

  assert.equal(result.promoted, true);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].previousResponseIssue, "NON_JSON");
  assert.equal(calls[1].previousResponseIssue, "STORY_COVERAGE_OWNER_MISSING");
  assert.deepEqual(calls[1].requiredResponsePatchPaths, ["src/frontend/pages/Funding.jsx"]);
  assert.match(calls[1].rules.join("\n"), /Mandatory correction patch paths: src\/frontend\/pages\/Funding\.jsx/);
  assert.match(calls[1].previousResponseCorrection, /Previously accepted patches are retained transactionally/);
  assert.equal(await readFile(join(candidate, "src", "reports", "funding-report.js"), "utf8"), 'export const report = "after"\n');
  assert.equal(await readFile(join(candidate, "src", "frontend", "pages", "Funding.jsx"), "utf8"), 'export const page = "after"\n');
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker removes extra unpatched references from valid story evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "marker.js"), 'export const marker = "before"\n');
  await writeFile(join(source, "src", "marker.test.js"), 'export const expected = "before"\n');
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: gateway({
      schema: "adx-model-patch-response-v1",
      patches: [
        { path: "src/marker.js", content: 'export const marker = "after"\n' },
        { path: "src/marker.test.js", content: 'export const expected = "after"\n' },
      ],
      featureSpotlight: null,
      storyCoverage: [{
        storyKey: "STORY-1",
        implementationPaths: ["src/marker.js", "src/existing-helper.js"],
        testPaths: ["src/marker.test.js", "src/existing-helper.test.js"],
      }],
    }),
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });

  const result = await broker.execute({
    adapter,
    task: {
      ...task,
      stories: [{
        key: "STORY-1",
        title: "Show marker",
        narrative: "As a user, I want to see the marker, so that I know its state.",
        scenarios: [{ given: "a marker", when: "it is viewed", then: "its state is shown" }],
      }],
    },
    repository,
  });

  assert.deepEqual(result.storyCoverage, [{
    storyKey: "STORY-1",
    implementationPaths: ["src/marker.js"],
    testPaths: ["src/marker.test.js"],
  }]);
  await rm(root, { recursive: true, force: true });
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
  assert.equal(
    await readFile(join(candidate, "src", "marker.js"), "utf8"),
    'export const marker = "after"\n',
  );
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker forwards the execution timeout to the model gateway", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "marker.js"), 'export const marker = "before"\n');
  let timeoutMs = null;
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true, model: "gpt-5.6-terra" }),
      complete: async (request) => {
        timeoutMs = request.timeoutMs;
        return {
          model: "gpt-5.6-terra",
          responseDigest: "sha256:response",
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches: [
              { path: "src/marker.js", content: 'export const marker = "after"\n' },
            ],
          }),
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
  const result = await broker.execute({ adapter, task, repository, timeoutMs: 4321 });
  assert.equal(result.promoted, true);
  assert.equal(timeoutMs, 4321);
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker fails a non-settling model call at its bounded deadline", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "marker.js"), 'export const marker = "before"\n');
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: { status: () => ({ configured: true }), complete: () => new Promise(() => {}) },
  });
  await assert.rejects(
    broker.execute({ adapter, task, repository, timeoutMs: 20 }),
    (error) => error.code === "MODEL_PATCH_GATEWAY_TIMEOUT" && error.details.timeoutMs === 20,
  );
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker classifies an invalid gateway completion instead of leaking an unstructured runner failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "marker.js"), 'export const marker = "before"\n');
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: { status: () => ({ configured: true }), complete: async () => ({}) },
  });
  await assert.rejects(
    broker.execute({ adapter, task, repository, timeoutMs: 20 }),
    (error) => error.code === "MODEL_PATCH_GATEWAY_RESPONSE_INVALID",
  );
  await rm(root, { recursive: true, force: true });
});

test("model-patch coding requests compact all context paths after an unclassified gateway 400", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "marker.js"), 'export const marker = "before"\n');
  await writeFile(join(source, "src", "marker.test.js"), '// existing\n');
  const prompts = [];
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true }),
      complete: async (request) => {
        prompts.push(JSON.parse(request.prompt));
        if (prompts.length === 1)
          throw new ChangeCaseError(
            "AZURE_OPENAI_GATEWAY_REQUEST_FAILED",
            "Rejected.",
            { details: { providerStatus: 400 } },
          );
        return {
          model: "gpt-5.6-terra",
          responseDigest: "sha256:compact-coding",
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches: [
              { path: "src/marker.js", content: 'export const marker = "after"\n' },
              { path: "src/marker.test.js", content: '// STORY-1\n' },
            ],
            featureSpotlight: null,
            storyCoverage: [{
              storyKey: "STORY-1",
              implementationPaths: ["src/marker.js"],
              testPaths: ["src/marker.test.js"],
            }],
          }),
        };
      },
    },
    validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: "sha256:test" }),
  });
  const result = await broker.execute({
    adapter,
    task: {
      ...task,
      stories: [{
        key: "STORY-1",
        title: "Show marker",
        narrative: "As a user, I want a marker, so that status is visible.",
        scenarios: [{ given: "a marker", when: "it is viewed", then: "status is visible" }],
      }],
    },
    repository,
  });

  assert.equal(result.promoted, true, JSON.stringify(result));
  assert.equal(prompts.length, 2);
  assert.equal(prompts[1].compactContext, true);
  assert.deepEqual(
    prompts[1].files.map((file) => file.path),
    prompts[0].files.map((file) => file.path),
  );
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker rejects a validated no-op run that leaves the source unchanged", async () => {
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
        { path: "src/marker.js", content: 'export const marker = "before"\n' },
      ],
    }),
    validate: async () => ({
      code: 0,
      signal: null,
      timedOut: false,
      outputBytes: 0,
      outputDigest: "sha256:test",
    }),
  });
  const result = await broker.execute({ adapter, task, repository });
  assert.equal(result.errorCode, "MODEL_PATCH_NO_CHANGES");
  assert.equal(result.promoted, false);
  assert.equal(result.candidateDigest, null);
  await rm(root, { recursive: true, force: true });
});

test("model-patch broker retries from pristine source after a failed validation and carries the failure context into the repair prompt", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "marker.js"), 'export const marker = "before"\n');
  const calls = [];
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true, model: "gpt-5.6-terra" }),
      complete: async (request) => {
        calls.push(JSON.parse(request.prompt));
        const attempt = calls.length;
        return {
          model: "gpt-5.6-terra",
          responseDigest: `sha256:response-${attempt}`,
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches: [
              {
                path: "src/marker.js",
                content:
                  attempt === 1
                    ? 'export const marker = "needs-fix"\n'
                    : 'export const marker = "fixed"\n',
              },
            ],
          }),
        };
      },
    },
    validate: async ({ cwd }) => {
      const current = await readFile(join(cwd, "src", "marker.js"), "utf8");
      if (current.includes("needs-fix")) {
        return {
          code: 1,
          signal: null,
          timedOut: false,
          outputBytes: 21,
          outputDigest: "sha256:attempt-1",
          outputExcerpt: "expected fixed marker\n",
        };
      }
      assert.equal(current, 'export const marker = "fixed"\n');
      return {
        code: 0,
        signal: null,
        timedOut: false,
        outputBytes: 0,
        outputDigest: "sha256:attempt-2",
      };
    },
  });
  const result = await broker.execute({ adapter, task, repository });
  assert.equal(result.promoted, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].previousValidationIssue, null);
  assert.deepEqual(calls[1].previousValidationIssue, {
    validationCommand: "node --test",
    validationCategory: "CHECK_FAILED",
    validationOutputExcerpt: "expected fixed marker\n",
    validationFailureReason: null,
  });
  await rm(root, { recursive: true, force: true });
});

test("standalone Health-X permits only its production verifier and links read-only dependencies into the disposable workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "app"), { recursive: true });
  await mkdir(join(source, "scripts"), { recursive: true });
  await mkdir(join(source, "docs"), { recursive: true });
  await mkdir(join(source, "node_modules"), { recursive: true });
  await mkdir(join(source, "venv"), { recursive: true });
  await mkdir(join(source, ".venv-smoke"), { recursive: true });
  await mkdir(join(source, ".pytest_cache"), { recursive: true });
  await mkdir(join(source, "app", "__pycache__"), { recursive: true });
  await mkdir(join(source, "app", "node_modules"), { recursive: true });
  await mkdir(join(source, "app", "nested", "node_modules"), { recursive: true });
  await mkdir(join(source, "app", "nested", "dist"), { recursive: true });
  await writeFile(
    join(source, "app", "marker.js"),
    'export const marker = "before"\n',
  );
  await writeFile(
    join(source, "scripts", "verify-production.mjs"),
    "// The product progress label must match the two canonical action lists.\n",
  );
  await writeFile(join(source, "docs", "ignored.md"), "ignored\n");
  await writeFile(join(source, "venv", "python"), "ignored\n");
  await writeFile(join(source, ".venv-smoke", "python"), "ignored\n");
  await writeFile(join(source, ".pytest_cache", "state"), "ignored\n");
  await writeFile(join(source, "app", "__pycache__", "module.pyc"), "ignored\n");
  await writeFile(join(source, "app", "nested", "node_modules", "dependency.js"), "ignored\n");
  await writeFile(join(source, "app", "nested", "dist", "bundle.js"), "ignored\n");
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
        assert.equal(
          context.some((file) => file.path === "docs/ignored.md"),
          false,
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
      assert.equal(
        (await lstat(join(cwd, "app", "node_modules"))).isSymbolicLink(),
        true,
      );
      assert.equal(await stat(join(cwd, "app", "nested", "node_modules")).catch(() => null), null);
      assert.equal(await stat(join(cwd, "app", "nested", "dist")).catch(() => null), null);
      assert.equal(await stat(join(cwd, "venv")).catch(() => null), null);
      assert.equal(await stat(join(cwd, ".venv-smoke")).catch(() => null), null);
      assert.equal(await stat(join(cwd, ".pytest_cache")).catch(() => null), null);
      assert.equal(await stat(join(cwd, "app", "__pycache__")).catch(() => null), null);
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

test("model-patch broker restores the warmed candidate workspace before a fresh run", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-model-broker-test-"));
  const source = join(root, "source");
  const candidate = join(root, "candidate");
  await mkdir(join(source, "src"), { recursive: true });
  await writeFile(join(source, "src", "marker.js"), 'export const marker = "before"\n');
  let promptCount = 0;
  let validationPhase = 1;
  const broker = new ModelPatchBroker({
    enabled: true,
    sourceRoot: source,
    candidateRoot: candidate,
    gateway: {
      status: () => ({ configured: true, model: "gpt-5.6-terra" }),
      complete: async (request) => {
        promptCount += 1;
        const files = JSON.parse(request.prompt).files;
        const marker = files.find((file) => file.path === "src/marker.js");
        if (promptCount === 3) {
          assert.equal(marker.content, 'export const marker = "before"\n');
        }
        return {
          model: "gpt-5.6-terra",
          responseDigest: `sha256:response-${promptCount}`,
          text: JSON.stringify({
            schema: "adx-model-patch-response-v1",
            patches: [
              {
                path: "src/marker.js",
                content:
                  validationPhase === 1
                    ? 'export const marker = "first"\n'
                    : 'export const marker = "second"\n',
              },
            ],
          }),
        };
      },
    },
    validate: async ({ cwd }) => {
      const current = await readFile(join(cwd, "src", "marker.js"), "utf8");
      if (validationPhase === 1) {
        return {
          code: 1,
          signal: null,
          timedOut: false,
          outputBytes: 0,
          outputDigest: "sha256:test",
          outputExcerpt: "first run should fail\n",
        };
      }
      return {
        code: current.includes("second") ? 0 : 1,
        signal: null,
        timedOut: false,
        outputBytes: 0,
        outputDigest: "sha256:test",
        outputExcerpt: current.includes("second") ? null : "second run should reset to source\n",
      };
    },
  });
  const first = await broker.execute({ adapter, task, repository });
  assert.equal(first.promoted, false);
  assert.equal(
    await readFile(join(candidate, "src", "marker.js"), "utf8"),
    'export const marker = "first"\n',
  );
  validationPhase = 2;
  const second = await broker.execute({ adapter, task, repository });
  assert.equal(second.promoted, true);
  assert.equal(
    await readFile(join(candidate, "src", "marker.js"), "utf8"),
    'export const marker = "second"\n',
  );
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
