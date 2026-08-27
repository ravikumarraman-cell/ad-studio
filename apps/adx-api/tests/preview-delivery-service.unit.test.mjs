import assert from "node:assert/strict";
import test from "node:test";
import { createPreviewDeliveryService } from "../preview-delivery-service.mjs";

const scope = { organizationId: "org", workspaceId: "workspace" };
const changeCase = {
  id: "case-1",
  title: "Care day workspace",
  state: "READY_FOR_DELIVERY",
};
const binding = {
  candidateDigest: "sha256:candidate",
  evidenceDigest: "sha256:evidence",
};

function service({
  evidence = [
    {
      status: "PASS",
      command: ["npm", "run", "verify:health-x"],
      verifierId: "health-x-production",
      verifierVersion: "1.0.0",
      ...binding,
    },
  ],
  timeline = [
    { eventType: "ChangeCaseVerificationCompleted.v1", payload: binding },
  ],
  repositories = [
    {
      repositoryId: "health-x",
      canonicalRemote: "https://example.test/health-x.git",
      defaultBaseRef: "refs/heads/main",
      projectPath: "apps/health-x",
    },
  ],
  targetRepository = "health-x",
} = {}) {
  const retained = [];
  const exports = [];
  return {
    retained,
    exports,
    prepare: createPreviewDeliveryService({
      providerId: "local-preview",
      repositories,
      deliveryRepository: {
        retain: async (input) => {
          retained.push(input);
          return { accepted: true, previewPlanId: "plan-1" };
        },
      },
      evidenceRepository: { list: async () => evidence },
      changeCaseRepository: {
        intakeView: async () => ({
          intent: {
            targetRepository,
            acceptanceCriteria: "Members can track care tasks.",
          },
          stories: {
            storyDigest: "sha256:stories",
            stories: [{ key: "STORY-1", title: "Track a care task" }],
          },
        }),
      },
      storyRepository: {
        view: async () => ({
          syncs: [
            {
              storyKey: "STORY-1",
              issueUrl: "https://github.com/example/ad-studio/issues/8",
              milestoneNumber: 2,
            },
          ],
        }),
      },
      servicePrincipal: { type: "service", id: "delivery-preview-service" },
      sourceRoot: "/source",
      candidateRoot: "/candidate",
      createExport: async (input) => {
        exports.push(input);
        return {
          baseCommit: "a".repeat(40),
          exportDigest: "sha256:export",
          changes: [
            {
              path: "apps/health-x/src/feature.js",
              afterDigest: "sha256:feature",
            },
          ],
        };
      },
    }).prepare({ scope, changeCase, timeline }),
  };
}

test("prepares a server-owned preview-only plan from the exact Gate D binding", async () => {
  const prepared = service();
  const result = await prepared.prepare;
  assert.equal(result.previewPlanId, "plan-1");
  assert.equal(prepared.retained[0].principal.type, "service");
  assert.equal(prepared.retained[0].plan.mode, "PREVIEW_ONLY");
  assert.equal(
    prepared.retained[0].plan.candidateDigest,
    binding.candidateDigest,
  );
  assert.equal(
    prepared.retained[0].plan.evidenceDigest,
    binding.evidenceDigest,
  );
  assert.equal(prepared.retained[0].plan.repository.repositoryId, "health-x");
  assert.match(prepared.retained[0].plan.pullRequest.body, /## What changed/);
  assert.match(prepared.retained[0].plan.pullRequest.body, /Track a care task/);
  assert.match(prepared.retained[0].plan.pullRequest.body, /verify:health-x/);
  assert.deepEqual(prepared.retained[0].plan.sourceExport, {
    baseCommit: "a".repeat(40),
    exportDigest: "sha256:export",
  });
  assert.deepEqual(prepared.exports, [
    {
      sourceRoot: "/source",
      candidateRoot: "/candidate",
      candidateDigest: binding.candidateDigest,
      canonicalRemote: "https://example.test/health-x.git",
      projectPath: "apps/health-x",
    },
  ]);
});

test("rejects a plan when Gate D evidence is no longer retained", async () => {
  const prepared = service({ evidence: [] });
  await assert.rejects(prepared.prepare, {
    code: "DELIVERY_PREVIEW_EVIDENCE_STALE",
  });
});

test("reports the exact retained Intake repository required by a mismatched provider registration", async () => {
  const prepared = service({
    targetRepository: "health-x",
    repositories: [
      {
        repositoryId: " ad-studio ",
        canonicalRemote: "https://example.test/ad-studio.git",
        defaultBaseRef: "refs/heads/main",
      },
    ],
  });
  await assert.rejects(
    prepared.prepare,
    (error) =>
      error.code === "GIT_REPOSITORY_DENIED" &&
      error.details.repositoryId === "health-x" &&
      error.message.includes("health-x"),
  );
});

test("normalizes whitespace around a registered repository ID", async () => {
  const prepared = service({
    repositories: [
      {
        repositoryId: " health-x ",
        canonicalRemote: " https://example.test/health-x.git ",
        defaultBaseRef: " refs/heads/main ",
      },
    ],
  });
  const result = await prepared.prepare;
  assert.equal(result.previewPlanId, "plan-1");
  assert.equal(prepared.retained[0].plan.repository.repositoryId, "health-x");
});
