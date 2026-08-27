import assert from "node:assert/strict";
import test from "node:test";
import {
  createPreviewDeliveryPlan,
  createPreviewGitProvider,
} from "../git-delivery-preview.mjs";

function plan(projectPath) {
  const provider = createPreviewGitProvider({
    providerId: "preview",
    repositories: [
      {
        repositoryId: "health-x",
        canonicalRemote: "https://example.test/ad-studio.git",
        defaultBaseRef: "refs/heads/main",
        projectPath,
      },
    ],
  });
  return createPreviewDeliveryPlan({
    provider,
    changeCaseId: "case-1",
    repositoryId: "health-x",
    candidateDigest: "sha256:candidate",
    evidenceDigest: "sha256:evidence",
    title: "Scoped preview",
    pullRequestBody: "## What changed\n\nScoped preview.",
    changes: [
      { path: `${projectPath}/src/feature.js`, digest: "sha256:feature" },
    ],
  });
}

test("binds the registered project path into preview plan provenance", () => {
  const healthX = plan("apps/health-x");
  const api = plan("apps/adx-api");
  assert.equal(healthX.repository.projectPath, "apps/health-x");
  assert.notEqual(healthX.commitDigest, api.commitDigest);
  assert.notEqual(healthX.pullRequest.digest, api.pullRequest.digest);
});
