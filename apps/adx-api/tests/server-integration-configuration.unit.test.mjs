import assert from "node:assert/strict";
import test from "node:test";
import {
  createConfiguredGitHubDraftPrExecution,
  createConfiguredPreviewDeliveryPreparation,
  createConfiguredPrivateGitHubMilestones,
  createConfiguredStoryMilestones,
  validatePreviewRuntimeConfiguration,
} from "../server-integration-configuration.mjs";

test("server integration configuration distinguishes disabled and incomplete preview delivery", () => {
  const disabled = createConfiguredPreviewDeliveryPreparation({
    changeCases: null,
    evidenceRepository: null,
    previewDeliveries: null,
    storyRepository: null,
    environment: {},
  });
  const incomplete = createConfiguredPreviewDeliveryPreparation({
    changeCases: {},
    evidenceRepository: {},
    previewDeliveries: {},
    storyRepository: {},
    environment: { ADX_PREVIEW_GIT_PROVIDER_ID: "github" },
  });

  assert.deepEqual(disabled, { service: null, code: "GIT_PREVIEW_DELIVERY_NOT_CONFIGURED" });
  assert.deepEqual(incomplete, { service: null, code: "GIT_PREVIEW_DELIVERY_CONFIGURATION_INCOMPLETE" });
});

test("server integration configuration keeps GitHub integrations disabled without server-owned credentials", () => {
  assert.deepEqual(
    createConfiguredGitHubDraftPrExecution({ previewDeliveries: null, previewCi: null, environment: {} }),
    { service: null, code: "GITHUB_DRAFT_PR_NOT_CONFIGURED" },
  );
  assert.deepEqual(
    createConfiguredStoryMilestones({ repository: null, environment: {} }),
    { service: null, code: "GITHUB_MILESTONE_NOT_CONFIGURED" },
  );
  assert.equal(createConfiguredPrivateGitHubMilestones({}), null);
});

test("preview runtime validation accepts profiles that require no private npm configuration", async () => {
  await validatePreviewRuntimeConfiguration(new Map([
    ["safe", { npmrcSecretRequired: false }],
  ]));
  await assert.rejects(
    validatePreviewRuntimeConfiguration(new Map([["private", { npmrcSecretRequired: true }]])),
    /API_START_PREVIEW_NPMRC_FILE_MISSING/,
  );
});
