import assert from "node:assert/strict";
import test from "node:test";
import { buildDraftPrDescription } from "../draft-pr-description.mjs";

test("builds a retained, review-friendly description with story and evidence traceability", () => {
  const body = buildDraftPrDescription({
    changeCase: { id: "case-17", title: "Care-day status" },
    governance: {
      intent: {
        acceptanceCriteria:
          "Members can see their next task.\nCare teams can update status.",
      },
      stories: {
        storyDigest: "sha256:stories",
        stories: [{ key: "STORY-1", title: "See next task" }],
      },
    },
    storyPublication: {
      syncs: [
        {
          storyKey: "STORY-1",
          milestoneNumber: 2,
          issueUrl: "https://github.com/example/ad-studio/issues/17",
        },
      ],
    },
    evidence: {
      candidateDigest: "sha256:candidate",
      evidenceDigest: "sha256:evidence",
      commandDigest: "sha256:command",
      command: ["npm", "run", "verify:health-x"],
      verifierId: "health-x",
      verifierVersion: "1.0.0",
    },
    exported: {
      baseCommit: "a".repeat(40),
      exportDigest: "sha256:export",
      changes: [
        { path: "apps/health-x/app/routes/index.tsx", operation: "MODIFY" },
      ],
    },
  });
  assert.match(body, /## What changed/);
  assert.match(body, /STORY-1/);
  assert.match(body, /## Why/);
  assert.match(body, /## Scope/);
  assert.match(body, /verify:health-x/);
  assert.match(body, /issues\/17/);
  assert.match(body, /<details>/);
  assert.match(body, /sha256:evidence/);
});
