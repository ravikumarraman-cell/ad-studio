import assert from "node:assert/strict";
import test from "node:test";
import { createApplicationPreviewProfiles } from "../application-preview-profiles.mjs";

test("Health-X preview profiles use the standalone repository Dockerfile by default", () => {
  const profiles = createApplicationPreviewProfiles({
    sourceRoot: "/projects/health-x",
    candidateRoot: "/candidates/health-x",
  });

  assert.equal(
    profiles.get("health-x-before").dockerfile,
    "/projects/health-x/Dockerfile",
  );
  assert.equal(
    profiles.get("health-x-after").dockerfile,
    "/candidates/health-x/Dockerfile",
  );
});

test("Health-X preview profiles permit a canonical nested Dockerfile override", () => {
  const profiles = createApplicationPreviewProfiles({
    sourceRoot: "/projects/ad-studio",
    candidateRoot: "/candidates/ad-studio",
    dockerfilePath: "apps/health-x/Dockerfile",
  });

  assert.equal(
    profiles.get("health-x-before").dockerfile,
    "/projects/ad-studio/apps/health-x/Dockerfile",
  );
});

test("Health-X preview profiles reject unsafe Dockerfile paths", () => {
  assert.throws(
    () =>
      createApplicationPreviewProfiles({
        sourceRoot: "/projects/health-x",
        candidateRoot: "/candidates/health-x",
        dockerfilePath: "../Dockerfile",
      }),
    { message: "LOCAL_PREVIEW_DOCKERFILE_PATH_INVALID" },
  );
});