import { basename, resolve } from "node:path";

export function createApplicationPreviewProfiles({
  sourceRoot,
  candidateRoot,
  repositoryId,
  dockerfilePath = "Dockerfile",
  dockerfileRoot = null,
  contextPath = "",
  containerPort = 3000,
  buildArgs = {},
  hostName = "127.0.0.1",
  hostPort = null,
  previewRevision = null,
}) {
  if (
    typeof sourceRoot !== "string" ||
    !sourceRoot ||
    typeof candidateRoot !== "string" ||
    !candidateRoot
  )
    return new Map();
  const dockerfile = normalizeDockerfilePath(dockerfilePath);
  const applicationPath = normalizeContextPath(contextPath);
  const resolvedRepositoryId =
    typeof repositoryId === "string" && repositoryId.trim()
      ? repositoryId.trim()
      : basename(String(sourceRoot).replace(/[\\/]+$/, ""));
  const profile = ({ id, label, root, comparisonRole, candidateBound }) =>
    Object.freeze({
      id,
      label,
      repositoryId: resolvedRepositoryId,
      comparisonRole,
      candidateBound,
      // ADX may own a preview-only Dockerfile while always building the
      // application from the selected source or retained candidate context.
      dockerfile: dockerfileRoot
        ? resolve(dockerfileRoot, dockerfile)
        : resolve(root, applicationPath, dockerfile),
      context: resolve(root, applicationPath),
      digestRoot: root,
      npmRegistry:
        "https://edgeinternal1uhg.optum.com/artifactory/api/npm/tenant-compass-npm-vir/",
      npmrcSecretPath: process.env.ADX_PREVIEW_NPMRC_FILE,
      npmrcSecretRequired: true,
      requiredDockerfileMarkers: ["ARG NPM_REGISTRY", "id=npmrc"],
      buildArgs: Object.freeze({ ...buildArgs }),
      containerPort,
      hostName,
      hostPort,
      previewRevision,
      readinessPath: "/",
    });
  return new Map([
    [
      "health-x-before",
      profile({
        id: "health-x-before",
        label: "Before implementation",
        root: sourceRoot,
        comparisonRole: "BEFORE",
        candidateBound: false,
      }),
    ],
    [
      "health-x-after",
      profile({
        id: "health-x-after",
        label: "After implementation (verified candidate)",
        root: candidateRoot,
        comparisonRole: "AFTER",
        candidateBound: true,
      }),
    ],
  ]);
}

function normalizeContextPath(value) {
  const path = typeof value === "string" ? value.trim() : "";
  if (!path) return "";
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("LOCAL_PREVIEW_CONTEXT_PATH_INVALID");
  return path;
}

function normalizeDockerfilePath(value) {
  const path = typeof value === "string" ? value.trim() : "";
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("LOCAL_PREVIEW_DOCKERFILE_PATH_INVALID");
  return path;
}
