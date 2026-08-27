import { resolve } from "node:path";

export function createApplicationPreviewProfiles({
  sourceRoot,
  candidateRoot,
}) {
  if (
    typeof sourceRoot !== "string" ||
    !sourceRoot ||
    typeof candidateRoot !== "string" ||
    !candidateRoot
  )
    return new Map();
  const profile = ({ id, label, context, comparisonRole, candidateBound }) =>
    Object.freeze({
      id,
      label,
      comparisonRole,
      candidateBound,
      dockerfile: resolve(context, "apps/health-x/Dockerfile"),
      context,
      npmRegistry:
        "https://edgeinternal1uhg.optum.com/artifactory/api/npm/tenant-compass-npm-vir/",
      npmrcSecretPath: process.env.ADX_PREVIEW_NPMRC_FILE,
      npmrcSecretRequired: true,
      requiredDockerfileMarkers: ["ARG NPM_REGISTRY", "id=npmrc"],
      containerPort: 3000,
      readinessPath: "/",
    });
  return new Map([
    [
      "health-x-before",
      profile({
        id: "health-x-before",
        label: "Before implementation",
        context: sourceRoot,
        comparisonRole: "BEFORE",
        candidateBound: false,
      }),
    ],
    [
      "health-x-after",
      profile({
        id: "health-x-after",
        label: "After implementation (verified candidate)",
        context: candidateRoot,
        comparisonRole: "AFTER",
        candidateBound: true,
      }),
    ],
  ]);
}
