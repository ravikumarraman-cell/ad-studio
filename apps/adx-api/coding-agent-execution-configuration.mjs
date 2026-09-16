import { ChangeCaseError, sha256 } from "./change-case-ledger.mjs";
import { CodingAgentExecutionService } from "./coding-agent-execution-service.mjs";
import {
  createCodingAgentAdapter,
  codingAgentProviders,
} from "./coding-agent-adapters.mjs";

const executionCapabilities = Object.freeze({
  shell: true,
  gitRead: true,
  gitWrite: true,
  browser: false,
  network: false,
  secrets: false,
  deploy: false,
});

export function resolveModelPatchProfile(environment) {
  const profile = String(environment.ADX_CODING_MODEL_EXECUTION_PROFILE ?? "legacy")
    .trim()
    .toLowerCase();
  if (profile === "health-x")
    return Object.freeze({
      id: "health-x",
      sourceRoot: environment.ADX_HEALTH_X_MODEL_SOURCE_ROOT ?? environment.ADX_CODING_MODEL_SOURCE_ROOT,
      candidateRoot: environment.ADX_HEALTH_X_MODEL_CANDIDATE_ROOT ?? environment.ADX_CODING_MODEL_CANDIDATE_ROOT,
      repositoryId: String(environment.ADX_HEALTH_X_MODEL_REPOSITORY_ID ?? "local:health-x").trim(),
      ref: String(environment.ADX_HEALTH_X_MODEL_REF ?? "refs/heads/main").trim(),
      writePaths: configuredWritePaths(environment.ADX_HEALTH_X_MODEL_WRITE_PATHS, ["app/**"]),
      readOnlyContextPaths: Object.freeze(["scripts/verify-production.mjs"]),
      validationCommand: "npm run verify:production",
      linkSourceDependencies: true,
    });
  return Object.freeze({
    id: profile === "cloud-asset-inventory" ? profile : "legacy",
    sourceRoot: environment.ADX_CODING_MODEL_SOURCE_ROOT ?? environment.ADX_LOCAL_CODING_AGENT_SOURCE_ROOT,
    candidateRoot: environment.ADX_CODING_MODEL_CANDIDATE_ROOT ?? environment.ADX_LOCAL_VERIFIER_CANDIDATE_ROOT,
    repositoryId: String(environment.ADX_CODING_MODEL_REPOSITORY_ID ?? environment.ADX_LOCAL_CODING_AGENT_REPOSITORY_ID ?? "").trim(),
    ref: String(environment.ADX_CODING_MODEL_REF ?? environment.ADX_LOCAL_CODING_AGENT_REF ?? "").trim(),
    writePaths: configuredWritePaths(environment.ADX_CODING_MODEL_WRITE_PATHS ?? environment.ADX_LOCAL_CODING_AGENT_WRITE_PATHS, []),
    readOnlyContextPaths: Object.freeze([]),
    validationCommand: profile === "cloud-asset-inventory"
      ? "cloud-asset-inventory verify"
      : "npm --prefix frontend test -- --runInBand",
    linkSourceDependencies: true,
  });
}

export function createLocalCodingAgentExecution({
  executions,
  changeCases,
  broker,
  environment,
}) {
  const provider = String(environment.ADX_LOCAL_CODING_AGENT_PROVIDER ?? "").trim().toUpperCase();
  const version = String(environment.ADX_LOCAL_CODING_AGENT_VERSION ?? "").trim();
  const repositoryId = String(environment.ADX_LOCAL_CODING_AGENT_REPOSITORY_ID ?? "").trim();
  const ref = String(environment.ADX_LOCAL_CODING_AGENT_REF ?? "").trim();
  const writePaths = configuredWritePaths(environment.ADX_LOCAL_CODING_AGENT_WRITE_PATHS, []);
  if (!isConfiguredExecution({ executions, changeCases, broker, provider, version, repositoryId, ref, writePaths })) return null;
  const adapter = createCodingAgentAdapter({ provider, version, capabilities: executionCapabilities, enabled: true });
  const service = createExecutionService({
    executions,
    changeCases,
    broker,
    adapter,
    provider,
    policyVersion: "adx-local-coding-agent-v1",
    repository: { repositoryId, ref, writePaths },
    durationSeconds: 900,
    maxToolCalls: 100,
    allowedCommands: ["node --test"],
  });
  return Object.freeze({
    service,
    provider: Object.freeze({
      id: provider,
      label: provider === "CLAUDE_CODE" ? "Claude Code CLI" : provider === "GITHUB_COPILOT" ? "GitHub Copilot CLI" : "Codex CLI",
      description: "Server-configured CLI implementation runner. ADX issues a signed lease and produces a disposable candidate.",
    }),
  });
}

export function createUhgModelCodingExecution({
  executions,
  changeCases,
  broker,
  gateway,
  environment,
  modelPatchProfile,
}) {
  const provider = "UHG_AZURE_OPENAI";
  const version = String(environment.ADX_CODING_MODEL_VERSION ?? "").trim();
  const { repositoryId, ref, writePaths, validationCommand, id: profileId } = modelPatchProfile;
  if (!isConfiguredExecution({ executions, changeCases, broker, provider, version, repositoryId, ref, writePaths }) || !gateway?.status?.().configured) return null;
  const adapter = createCodingAgentAdapter({ provider, version, capabilities: executionCapabilities, enabled: true });
  const service = createExecutionService({
    executions,
    changeCases,
    broker,
    adapter,
    provider,
    policyVersion: `adx-uhg-model-patch-${profileId}-v1`,
    repository: { repositoryId, ref, writePaths },
    durationSeconds: 1800,
    maxToolCalls: 2,
    allowedCommands: [validationCommand],
  });
  const model = gateway.status().model ?? "UHG model";
  return Object.freeze({
    service,
    validationCommand,
    provider: Object.freeze({
      id: provider,
      label: `${model} (UHG)`,
      description: `Health-X bounded runner · validates with ${validationCommand}.`,
    }),
  });
}

function configuredWritePaths(value, fallback) {
  if (typeof value !== "string" || !value.trim()) return Object.freeze(fallback);
  return Object.freeze(value.split(",").map((path) => path.trim()).filter(Boolean));
}

function isConfiguredExecution({ executions, changeCases, broker, provider, version, repositoryId, ref, writePaths }) {
  return Boolean(executions && changeCases && broker.configured() && codingAgentProviders.includes(provider) && version && repositoryId && ref.startsWith("refs/") && writePaths.length);
}

function createExecutionService({ executions, changeCases, broker, adapter, provider, policyVersion, repository, durationSeconds, maxToolCalls, allowedCommands }) {
  const policy = {
    version: policyVersion,
    agentPrincipal: { id: `agent:${adapter.adapterId}` },
    repository,
    capabilities: executionCapabilities,
    limits: {
      maxDurationSeconds: durationSeconds,
      maxToolCalls,
      maxCostUsd: 0,
      maxNetworkBytes: 0,
      maxOutputBytes: 64 * 1024,
      maxWorkspaceBytes: 64 * 1024 * 1024,
    },
    durationSeconds,
    taskFor: (changeCase) => ({
      objective: changeCase.title,
      changeDigest: sha256({ changeCaseId: changeCase.id, projectionVersion: changeCase.projectionVersion }),
      allowedCommands,
    }),
  };
  return new CodingAgentExecutionService({
    executionRepository: executions,
    changeCaseRepository: changeCases,
    broker,
    resolveAdapter: (requestedProvider) => {
      if (requestedProvider !== provider)
        throw new ChangeCaseError(
          "CODING_AGENT_PROVIDER_NOT_ENABLED",
          "The requested coding-agent provider is not enabled on this ADX server.",
        );
      return adapter;
    },
    policy,
  });
}
