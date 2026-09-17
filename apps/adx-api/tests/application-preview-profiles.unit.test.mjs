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

test("preview profiles preserve the configured repository identity", () => {
  const profiles = createApplicationPreviewProfiles({
    sourceRoot: "/projects/cloud-asset-inventory/frontend",
    candidateRoot: "/candidates/cloud-asset-inventory",
    repositoryId: "cloud-asset-inventory",
  });

  assert.equal(profiles.get("health-x-before").repositoryId, "cloud-asset-inventory");
  assert.equal(profiles.get("health-x-after").repositoryId, "cloud-asset-inventory");
});

test("preview profiles derive the canonical repository identity from the source checkout", () => {
  const profiles = createApplicationPreviewProfiles({
    sourceRoot: "/projects/cloud-asset-inventory",
    candidateRoot: "/candidates/cloud-asset-inventory",
  });

  assert.equal(profiles.get("health-x-before").repositoryId, "cloud-asset-inventory");
  assert.equal(profiles.get("health-x-after").repositoryId, "cloud-asset-inventory");
});

test("nested application profiles keep whole-candidate verification with a server-managed Dockerfile", () => {
  const profiles = createApplicationPreviewProfiles({
    sourceRoot: "/projects/cloud-asset-inventory",
    candidateRoot: "/candidates/cloud-asset-inventory",
    contextPath: "frontend",
    containerPort: 80,
    hostName: "localhost",
    hostPort: 5173,
    buildArgs: {
      NODE_IMAGE: "node:22-alpine",
      NGINX_IMAGE: "nginx:alpine",
      environment: "stage",
    },
  });
  const after = profiles.get("health-x-after");

  assert.equal(after.context, "/candidates/cloud-asset-inventory/frontend");
  assert.equal(after.digestRoot, "/candidates/cloud-asset-inventory");
  assert.equal(after.dockerfile, "/candidates/cloud-asset-inventory/frontend/Dockerfile");
  assert.equal(after.containerPort, 80);
  assert.equal(after.hostName, "localhost");
  assert.equal(after.hostPort, 5173);
  assert.deepEqual(after.buildArgs, {
    NODE_IMAGE: "node:22-alpine",
    NGINX_IMAGE: "nginx:alpine",
    environment: "stage",
  });
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

test("preview-only Dockerfiles remain server-owned while their context stays candidate-bound", () => {
  const profiles = createApplicationPreviewProfiles({
    sourceRoot: "/projects/cloud-asset-inventory",
    candidateRoot: "/candidates/cloud-asset-inventory",
    contextPath: "frontend",
    dockerfileRoot: "/projects/ad-studio/apps/adx-api/preview-assets",
    dockerfilePath: "cloud-asset-inventory-preview.Dockerfile",
  });

  assert.equal(
    profiles.get("health-x-after").dockerfile,
    "/projects/ad-studio/apps/adx-api/preview-assets/cloud-asset-inventory-preview.Dockerfile",
  );
  assert.equal(
    profiles.get("health-x-after").context,
    "/candidates/cloud-asset-inventory/frontend",
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
