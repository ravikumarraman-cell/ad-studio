import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import { patchResponseError } from "../model-patch-contract.mjs";
import { createModelPatchMaterializer } from "../model-patch-materializer.mjs";

test("materializer returns a small-anchor correction for a broad existing component replacement", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-materializer-test-"));
  const path = "frontend/src/components/tenantDetails/TenantOnboardingFundingStatus.jsx";
  const oldContent = `export function FundingStatus() {\n  const decision = "${"a".repeat(1_100)}";\n  return <span>{decision}</span>;\n}\n`;
  const newContent = `export function FundingStatus() {\n  const decision = "${"b".repeat(1_100)}";\n  return <span>{decision}</span>;\n}\n`;
  await writeFile(join(root, "TenantOnboardingFundingStatus.jsx"), oldContent);
  const materializer = createModelPatchMaterializer({ maxAnchoredOldTextBytes: 1024, patchResponseError });

  await assert.rejects(
    materializer.materializeValidatedPatches(root, [{
      path: "TenantOnboardingFundingStatus.jsx",
      content: null,
      replacements: [{ oldText: oldContent, newText: newContent }],
    }], { finishReason: "stop" }),
    (error) => {
      assert.equal(error.code, "MODEL_PATCH_RESPONSE_INVALID");
      assert.equal(error.details.responseIssue, "PATCH_REPLACEMENT_TOO_BROAD");
      assert.match(error.details.responseCorrection, /two or more independent exact anchors/);
      assert.match(error.details.responseCorrection, /current candidate excerpt/);
      assert.deepEqual(error.details.requiredResponsePatchPaths, ["TenantOnboardingFundingStatus.jsx"]);
      assert.equal(error.details.broadAnchorRepair.path, "TenantOnboardingFundingStatus.jsx");
      assert.equal(error.details.broadAnchorRepair.maxOldTextBytes, 1024);
      assert.equal(error.details.broadAnchorRepair.rejectedOldText, oldContent.slice(0, 500));
      assert.match(error.details.broadAnchorRepair.currentExcerpt, /FundingStatus/);
      return true;
    },
  );
  await rm(root, { recursive: true, force: true });
});

test("materializer returns a focused anchor repair for a destructive full-file rewrite", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-materializer-test-"));
  const path = "frontend/src/pages/TenantWorkflow.jsx";
  const oldContent = [
    "import React from 'react';",
    `const retained = '${"x".repeat(1_100)}';`,
    "export default function TenantWorkflow() { return <main>{retained}</main>; }",
    "",
  ].join("\n");
  await mkdir(join(root, "frontend", "src", "pages"), { recursive: true });
  await writeFile(join(root, path), oldContent);
  const materializer = createModelPatchMaterializer({ maxAnchoredOldTextBytes: 1024, patchResponseError });

  await assert.rejects(
    materializer.materializeValidatedPatches(root, [{
      path,
      content: "export default function TenantWorkflow() { return <main />; }\n",
      replacements: [],
    }], { finishReason: "stop" }),
    (error) => {
      assert.equal(error.details.responseIssue, "PATCH_DESTRUCTIVE_REWRITE");
      assert.match(error.details.responseCorrection, /Return exactly one patch/);
      assert.deepEqual(error.details.requiredResponsePatchPaths, [path]);
      assert.equal(error.details.broadAnchorRepair.path, path);
      return true;
    },
  );
  await rm(root, { recursive: true, force: true });
});

test("materializer normalizes a standalone new test emitted as an anchored patch", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-materializer-test-"));
  const path = "backend/inventory/lambda/sbl/sbl_account_inactive_daily/test_funding_tooling_operation_guard.py";
  const materializer = createModelPatchMaterializer({ maxAnchoredOldTextBytes: 1024, patchResponseError });

  const [patch] = await materializer.materializeValidatedPatches(root, [{
    path,
    content: null,
    replacements: [{ oldText: "def test_guard():", newText: "def test_guard():\n    assert True" }],
  }], { finishReason: "stop" });
  assert.equal(patch.content, "def test_guard():\n    assert True\n");
  assert.deepEqual(patch.replacements, []);
  await rm(root, { recursive: true, force: true });
});

test("materializer still rejects an anchored patch for a new implementation file", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-materializer-test-"));
  const path = "backend/inventory/lambda/sbl/sbl_account_inactive_daily/handler.py";
  const materializer = createModelPatchMaterializer({ maxAnchoredOldTextBytes: 1024, patchResponseError });

  await assert.rejects(
    materializer.materializeValidatedPatches(root, [{
      path,
      content: null,
      replacements: [{ oldText: "def handler():", newText: "def handler():\n    return {}" }],
    }], { finishReason: "stop" }),
    (error) => {
      assert.equal(error.details.responseIssue, "PATCH_ANCHOR_TARGET_MISSING");
      assert.deepEqual(error.details.requiredResponsePatchPaths, [path]);
      assert.deepEqual(error.details.newFilePatchRepair, { path });
      return true;
    },
  );
  await rm(root, { recursive: true, force: true });
});

test("materializer permits a whole replacement only for a single-purpose test file", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-materializer-test-"));
  const path = "backend/inventory/tests/test_funding_owner.py";
  const testRegion = [
    '"""Funding owner test."""',
    "",
    "from unittest.mock import Mock",
    "",
    "def test_funding_owner():",
    "    assert Mock()",
    "",
  ].join("\n");
  const oldContent = `${testRegion}# retained test-module metadata\n`;
  const newContent = [
    '"""Funding owner test."""',
    "",
    "from unittest.mock import Mock",
    "",
    "def test_funding_owner():",
    "    owner = Mock()",
    "    owner.update_item()",
    "    owner.update_item.assert_called_once()",
    "",
  ].join("\n");
  await mkdir(join(root, "backend", "inventory", "tests"), { recursive: true });
  await writeFile(join(root, path), oldContent);
  const materializer = createModelPatchMaterializer({ maxAnchoredOldTextBytes: 1024, patchResponseError });
  const [patch] = await materializer.materializeValidatedPatches(root, [{
    path,
    content: null,
    replacements: [{ oldText: testRegion, newText: newContent }],
  }], { finishReason: "stop" });
  assert.equal(patch.content, `${newContent}# retained test-module metadata\n`);
  await rm(root, { recursive: true, force: true });
});

test("materializer permits an exact replacement for a one-case frontend test", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-materializer-test-"));
  const path = "frontend/src/components/TenantOnboardingFundingStatus.behavior.test.jsx";
  const oldContent = [
    "import React from 'react';",
    "import { render } from '@testing-library/react';",
    "",
    "describe('TenantOnboardingFundingStatus', () => {",
    "  it('shows a decision', () => render(<span>Unknown</span>));",
    "});",
    "",
  ].join("\n");
  const newContent = oldContent.replace("Unknown", "Funded");
  await mkdir(join(root, "frontend", "src", "components"), { recursive: true });
  await writeFile(join(root, path), oldContent);
  const materializer = createModelPatchMaterializer({ maxAnchoredOldTextBytes: 64, patchResponseError });
  const [patch] = await materializer.materializeValidatedPatches(root, [{
    path,
    content: null,
    replacements: [{ oldText: oldContent, newText: newContent }],
  }], { finishReason: "stop" });
  assert.equal(patch.content, newContent);
  await rm(root, { recursive: true, force: true });
});

test("materializer rebases a stale anchor correction on a unique current-file excerpt", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-materializer-test-"));
  const path = "TenantWorkflow.jsx";
  await writeFile(join(root, path), [
    "import { FundingStatus } from './FundingStatus';",
    "",
    "function TenantWorkflow() {",
    "  return <FundingStatus />;",
    "}",
    "",
    "export default TenantWorkflow;",
  ].join("\n"));
  const materializer = createModelPatchMaterializer({ maxAnchoredOldTextBytes: 1024, patchResponseError });

  await assert.rejects(
    materializer.materializeValidatedPatches(root, [{
      path,
      content: null,
      replacements: [{ oldText: "export {TenantWorkflow};\n", newText: "export { TenantWorkflow };\n" }],
    }], { finishReason: "stop" }),
    (error) => {
      assert.equal(error.details.responseIssue, "PATCH_ANCHOR_NOT_UNIQUE");
      assert.match(error.details.responseCorrection, /Do not reuse that exact oldText/);
      assert.match(error.details.responseCorrection, /export default TenantWorkflow;/);
      assert.deepEqual(error.details.requiredResponsePatchPaths, [path]);
      assert.deepEqual(error.details.anchorRepair, {
        path,
        rejectedOldText: "export {TenantWorkflow};\n",
        matchCount: 0,
        currentExcerpt: [
          "import { FundingStatus } from './FundingStatus';",
          "",
          "function TenantWorkflow() {",
          "  return <FundingStatus />;",
          "}",
          "",
          "export default TenantWorkflow;",
        ].join("\n"),
      });
      return true;
    },
  );
  await rm(root, { recursive: true, force: true });
});

test("materializer rejects overlapping replacements before either can invalidate the other anchor", async () => {
  const root = await mkdtemp(join(tmpdir(), "adx-materializer-test-"));
  const path = "TenantWorkflow.jsx";
  await writeFile(join(root, path), "export function TenantWorkflow() { return null; }\n");
  const materializer = createModelPatchMaterializer({ maxAnchoredOldTextBytes: 1024, patchResponseError });

  await assert.rejects(
    materializer.materializeValidatedPatches(root, [{
      path,
      content: null,
      replacements: [
        { oldText: "TenantWorkflow() { return null", newText: "TenantWorkflow() { return <main" },
        { oldText: "function TenantWorkflow()", newText: "function TenantWorkflowView()" },
      ],
    }], { finishReason: "stop" }),
    (error) => {
      assert.equal(error.details.responseIssue, "PATCH_REPLACEMENT_COLLISION");
      assert.deepEqual(error.details.requiredResponsePatchPaths, [path]);
      return true;
    },
  );
  await rm(root, { recursive: true, force: true });
});
