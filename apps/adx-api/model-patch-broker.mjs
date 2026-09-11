import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { ChangeCaseError, sha256 } from "./change-case-ledger.mjs";
import { validateCodingAgentAdapter } from "./coding-agent-adapters.mjs";

const maxContextBytes = 160 * 1024;
const maxFileBytes = 24 * 1024;
const maxPriorityFileBytes = 8 * 1024;
const maxCompactContextBytes = 48 * 1024;
const maxCompactFileBytes = 4 * 1024;
const maxInspectableFileBytes = 512 * 1024;
const maxPatchBytes = 64 * 1024;
const maxPatches = 12;
const maxVerifierResponseAttempts = 3;
const maxPatchResponseAttempts = 3;
const maxSemanticFindings = 20;
const maxCandidateRepairRounds = 3;
const maxStoriesPerBatch = 1;
const ignoredDirectories = new Set([
  ".git",
  "node_modules",
  "venv",
  ".venv",
  ".venv-smoke",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".tox",
  "dist",
  "build",
  ".output",
  ".vinxi",
  "coverage",
]);
const transientCandidateDirectories = Object.freeze([
  ".output",
  ".vinxi",
  "apps/health-x/.output",
  "apps/health-x/.vinxi",
]);
const sensitiveFileNames = new Set([".env", ".npmrc"]);
const validationCommands = Object.freeze({
  "node --test": Object.freeze({
    executable: "node",
    arguments: Object.freeze(["--test"]),
  }),
  "npm --prefix frontend test -- --runInBand": Object.freeze({
    executable: "npm",
    arguments: Object.freeze(["--prefix", "frontend", "test", "--", "--runInBand"]),
  }),
  "cloud-asset-inventory verify": Object.freeze([
    Object.freeze({
      executable: "python3",
      arguments: Object.freeze(["-m", "compileall", "-q", "backend", "jobs"]),
    }),
    Object.freeze({
      executable: "npm",
      arguments: Object.freeze(["--prefix", "frontend", "test", "--", "--runInBand"]),
    }),
  ]),
  "npm run verify:health-x": Object.freeze({
    executable: "npm",
    arguments: Object.freeze(["run", "verify:health-x"]),
  }),
  "npm run verify:production": Object.freeze({
    executable: "npm",
    arguments: Object.freeze(["run", "verify:production"]),
  }),
});
const executionStateCache = new Map();

export class ModelPatchBroker {
  constructor({
    enabled = false,
    sourceRoot,
    candidateRoot,
    gateway,
    allowedValidationCommands = ["node --test"],
    readOnlyContextPaths = [],
    linkSourceDependencies = false,
    semanticVerification = false,
    candidateVerifiers = [],
    validate = runValidation,
  } = {}) {
    this.enabled = enabled;
    this.sourceRoot = sourceRoot;
    this.candidateRoot = candidateRoot;
    this.gateway = gateway;
    this.allowedValidationCommands = Object.freeze([
      ...new Set(allowedValidationCommands),
    ]);
    this.readOnlyContextPaths = normalizeReadOnlyContextPaths(
      readOnlyContextPaths,
    );
    this.linkSourceDependencies = Boolean(linkSourceDependencies);
    this.semanticVerification = Boolean(semanticVerification);
    this.candidateVerifiers = normalizeCandidateVerifiers(candidateVerifiers);
    this.validate = validate;
  }

  configured() {
    return Boolean(
      this.enabled &&
      this.sourceRoot &&
      this.candidateRoot &&
      this.gateway?.status?.().configured,
    );
  }

  async execute({ adapter, task, timeoutMs = 900_000, repository, onProgress }) {
    const startedAt = Date.now();
    const timings = {};
    if (!this.configured())
      throw new ChangeCaseError(
        "MODEL_PATCH_EXECUTOR_NOT_CONFIGURED",
        "The model-patch executor requires an enabled server-owned model gateway, source checkout, and candidate path.",
      );
    const provider = validateCodingAgentAdapter(adapter);
    if (provider.executionKind !== "MODEL_PATCH")
      throw new ChangeCaseError(
        "MODEL_PATCH_ADAPTER_REQUIRED",
        "This executor accepts only a registered model-patch adapter.",
      );
    const source = await checkedOutRoot(this.sourceRoot);
    const candidate = resolve(this.candidateRoot);
    if (
      candidate === resolve("/") ||
      source === candidate ||
      source.startsWith(`${candidate}/`)
    )
      throw new ChangeCaseError(
        "MODEL_PATCH_CANDIDATE_INVALID",
        "The execution candidate must be a separate server-configured checkout path.",
      );
    const normalizedTask = normalizeTask(task, this.allowedValidationCommands);
    const writePaths = normalizeWritePaths(repository?.writePaths);
    await reportProgress(onProgress, "CONTEXT_COLLECTION");
    const contextStartedAt = Date.now();
    const executionState = getExecutionState({
      source,
      candidate,
      writePaths,
      readOnlyContextPaths: this.readOnlyContextPaths,
      linkSourceDependencies: this.linkSourceDependencies,
    });
    try {
      const workspaceReadyPromise = prepareCandidateWorkspace({
        source,
        candidate,
        state: executionState,
        shouldLinkSourceDependencies: this.linkSourceDependencies,
        timings,
      });
      await workspaceReadyPromise;
      const contextCatalog = await createContextCatalog(
        candidate,
        writePaths,
        this.readOnlyContextPaths,
      );
      const sourceDigestPromise = digestTree(source);
      let validation = null;
      let completion = null;
      let featureSpotlight = null;
      let previousValidationIssue = null;
      let storyCoverage = Object.freeze([]);
      let touchedPaths = new Set();
      const coverage = [];
      const completions = [];
      const storyEvidence = new Map();
      let requestedStories = normalizedTask.stories;
      for (let validationAttempt = 1; validationAttempt <= 2; validationAttempt += 1) {
        for (const batchTask of storyBatchTasks({
          ...normalizedTask,
          stories: requestedStories,
        })) {
          const batchContextStartedAt = Date.now();
          const context = await collectContext(
            candidate,
            contextCatalog,
            batchTask,
          );
          timings.contextMs = Number(timings.contextMs ?? 0) + elapsed(batchContextStartedAt);
          const modelStartedAt = Date.now();
          await reportProgress(onProgress, "MODEL_REQUEST");
          const response = await requestValidatedPatches({
            gateway: this.gateway,
            task: batchTask,
            context,
            candidate,
            writePaths,
            previousValidationIssue,
            timeoutMs,
          });
          timings.modelMs = Number(timings.modelMs ?? 0) + elapsed(modelStartedAt);
          completions.push(response.completion);
          mergeStoryCoverage(coverage, response.storyCoverage);
          featureSpotlight ??= response.featureSpotlight;
          await reportProgress(onProgress, "MODEL_RESPONSE");

          const patchStartedAt = Date.now();
          const previousTestContent = await readCandidateFiles(
            candidate,
            response.storyCoverage.flatMap((entry) => entry.testPaths),
          );
          for (const patch of response.patches) {
            await writePatch(candidate, patch);
            touchedPaths.add(patch.path);
            contextCatalog.set(patch.path, true);
            executionState.lastTouchedPaths = new Set(touchedPaths);
          }
          await captureStoryEvidence(candidate, response.storyCoverage, previousTestContent, storyEvidence);
          timings.patchMs = Number(timings.patchMs ?? 0) + elapsed(patchStartedAt);
        }
        storyCoverage = Object.freeze([...coverage]);
        executionState.lastTouchedPaths = new Set(touchedPaths);

        const finalEvidenceIssue = await finalCandidateEvidenceIssue({
          source,
          candidate,
          stories: normalizedTask.stories,
          storyCoverage,
          storyEvidence,
          touchedPaths,
        });
        if (finalEvidenceIssue) {
          validation = failedValidation(finalEvidenceIssue);
          previousValidationIssue = finalEvidenceIssue;
          if (validationAttempt < 2) {
            requestedStories = storiesForValidationIssue(
              finalEvidenceIssue,
              normalizedTask.stories,
              storyCoverage,
            );
            continue;
          }
          break;
        }

        const candidateVerifiers = [
          ...(this.semanticVerification
            ? [{
                id: "model-semantic",
                verify: (input) => verifyCandidateSemantics({
                  gateway: this.gateway,
                  ...input,
                }),
              }]
            : []),
          ...this.candidateVerifiers,
        ];
        let candidateBlocked = false;
        for (
          let verificationRound = 0;
          candidateVerifiers.length &&
            normalizedTask.stories.length &&
            verificationRound <= maxCandidateRepairRounds;
          verificationRound += 1
        ) {
          const verifierContextStartedAt = Date.now();
          const verifierContext = await collectContext(
            candidate,
            contextCatalog,
            normalizedTask,
            new Set([
              ...touchedPaths,
              ...storyCoverage.flatMap((entry) => [
                ...entry.implementationPaths,
                ...entry.testPaths,
              ]),
            ]),
          );
          timings.contextMs = Number(timings.contextMs ?? 0) + elapsed(verifierContextStartedAt);
          const verifierStartedAt = Date.now();
          await reportProgress(onProgress, "MODEL_REQUEST");
          const verification = await runCandidateVerifiers({
            verifiers: candidateVerifiers,
            task: normalizedTask,
            context: verifierContext,
            storyCoverage,
            touchedPaths,
            timeoutMs,
          });
          timings.modelMs = Number(timings.modelMs ?? 0) + elapsed(verifierStartedAt);
          await reportProgress(onProgress, "MODEL_RESPONSE");
          if (verification.passed) break;

          const verificationIssue = semanticVerificationIssue(verification);
          validation = failedValidation(verificationIssue);
          previousValidationIssue = Object.freeze({
            validationCommand: "candidate verifier pipeline",
            validationCategory: "STORY_ACCEPTANCE_FAILED",
            validationOutputExcerpt: verificationIssue,
            validationFailureReason: null,
            verifierFindings: verification.findings,
          });
          if (verificationRound === maxCandidateRepairRounds) {
            candidateBlocked = true;
            break;
          }

          const failedStoryKeys = new Set(
            verification.findings.map((finding) => finding.storyKey),
          );
          const repairStories = normalizedTask.stories.filter((story) =>
            failedStoryKeys.has(story.key),
          );
          for (const repairTask of storyBatchTasks({
            ...normalizedTask,
            stories: repairStories,
          })) {
            const repairContextStartedAt = Date.now();
            const repairStoryKeys = new Set(repairTask.stories.map((story) => story.key));
            const repairFindings = verification.findings.filter((finding) =>
              repairStoryKeys.has(finding.storyKey),
            );
            const repairPriorityPaths = new Set([
              ...repairFindings.flatMap((finding) => finding.evidencePaths),
              ...storyCoverage
                .filter((entry) => repairStoryKeys.has(entry.storyKey))
                .flatMap((entry) => [
                  ...entry.implementationPaths,
                  ...entry.testPaths,
                ]),
            ]);
            const repairContext = await collectContext(
              candidate,
              contextCatalog,
              repairContextTask(repairTask, repairFindings),
              repairPriorityPaths,
            );
            timings.contextMs = Number(timings.contextMs ?? 0) + elapsed(repairContextStartedAt);
            const repairModelStartedAt = Date.now();
            await reportProgress(onProgress, "MODEL_REQUEST");
            const response = await requestValidatedPatches({
              gateway: this.gateway,
              task: repairTask,
              context: repairContext,
              candidate,
              writePaths,
              previousValidationIssue: verifierIssueForFindings(repairFindings),
              timeoutMs,
            });
            timings.modelMs = Number(timings.modelMs ?? 0) + elapsed(repairModelStartedAt);
            completions.push(response.completion);
            featureSpotlight ??= response.featureSpotlight;
            await reportProgress(onProgress, "MODEL_RESPONSE");

            const repairPatchStartedAt = Date.now();
            const previousTestContent = await readCandidateFiles(
              candidate,
              response.storyCoverage.flatMap((entry) => entry.testPaths),
            );
            for (const patch of response.patches) {
              await writePatch(candidate, patch);
              touchedPaths.add(patch.path);
              contextCatalog.set(patch.path, true);
              executionState.lastTouchedPaths = new Set(touchedPaths);
            }
            for (const repairedCoverage of response.storyCoverage) {
              mergeStoryCoverage(coverage, [repairedCoverage]);
            }
            await captureStoryEvidence(
              candidate,
              response.storyCoverage,
              previousTestContent,
              storyEvidence,
            );
            timings.patchMs = Number(timings.patchMs ?? 0) + elapsed(repairPatchStartedAt);
          }
          storyCoverage = Object.freeze([...coverage]);
          executionState.lastTouchedPaths = new Set(touchedPaths);
          const repairEvidenceIssue = await finalCandidateEvidenceIssue({
            source,
            candidate,
            stories: normalizedTask.stories,
            storyCoverage,
            storyEvidence,
            touchedPaths,
          });
          if (repairEvidenceIssue) {
            validation = failedValidation(repairEvidenceIssue);
            candidateBlocked = true;
            break;
          }
        }
        if (candidateBlocked) break;
        completion = combinedCompletion(completions);

        const validationStartedAt = Date.now();
        await reportProgress(onProgress, "VALIDATION");
        validation = await this.validate({
          cwd: candidate,
          allowedCommands: normalizedTask.allowedCommands,
          timeoutMs,
        });
        timings.validationMs = Number(timings.validationMs ?? 0) + elapsed(validationStartedAt);
        if (validation.code === 0 && !validation.timedOut) break;
        previousValidationIssue = validationIssueFor(validation, normalizedTask.allowedCommands[0]);
        requestedStories = storiesForValidationIssue(
          [validation.outputExcerpt, validationFailureReason(validation)]
            .filter(Boolean)
            .join("\n"),
          normalizedTask.stories,
          storyCoverage,
        );
      }
      if (validation.code !== 0 || validation.timedOut)
        return Object.freeze({
          accepted: false,
          promoted: false,
          provider: provider.provider,
          code: validation.code,
          signal: validation.signal,
          timedOut: validation.timedOut,
          quotaExceeded: false,
          outputBytes: validation.outputBytes,
          outputDigest: validation.outputDigest,
          errorCode: validation.timedOut
            ? "MODEL_PATCH_VALIDATION_TIMED_OUT"
            : validation.signal
              ? "MODEL_PATCH_VALIDATION_SIGNALED"
              : "MODEL_PATCH_VALIDATION_FAILED",
          errorDetails: {
            failureStage: "VALIDATION",
            validationCommand: normalizedTask.allowedCommands[0],
            validationCategory: validation.timedOut
              ? "TIMED_OUT"
              : validation.signal
                ? "SIGNALED"
                : "CHECK_FAILED",
            validationOutputExcerpt: validation.outputExcerpt ?? null,
            validationFailureReason: validationFailureReason(validation),
          },
          candidateDigest: null,
          timings: finalizedTimings(timings, startedAt),
        });
      const promotionStartedAt = Date.now();
      await removeTransientCandidateOutputs(candidate);
      const [sourceDigest, workspaceDigest] = await Promise.all([
        sourceDigestPromise,
        digestTree(candidate),
      ]);
      if (workspaceDigest === sourceDigest)
        return Object.freeze({
          accepted: false,
          promoted: false,
          provider: provider.provider,
          code: 1,
          signal: null,
          timedOut: false,
          quotaExceeded: false,
          outputBytes: validation.outputBytes,
          outputDigest: validation.outputDigest,
          errorCode: "MODEL_PATCH_NO_CHANGES",
          errorDetails: {
            failureStage: "EXECUTION",
            validationCommand: normalizedTask.allowedCommands[0],
            validationCategory: "CHECK_FAILED",
            validationOutputExcerpt: validation.outputExcerpt ?? null,
            validationFailureReason: "The validated candidate did not change the source checkout.",
          },
          candidateDigest: null,
          timings: finalizedTimings(timings, startedAt),
        });
      await reportProgress(onProgress, "CANDIDATE_PROMOTION");
      const candidateDigest = workspaceDigest;
      timings.promotionMs = elapsed(promotionStartedAt);
      return Object.freeze({
        accepted: true,
        promoted: true,
        provider: provider.provider,
        code: 0,
        signal: null,
        timedOut: false,
        quotaExceeded: false,
        outputBytes: validation.outputBytes,
        outputDigest: validation.outputDigest,
        candidateDigest,
        model: completion.model,
        responseDigest: completion.responseDigest,
        featureSpotlight,
        storyCoverage,
        timings: finalizedTimings(timings, startedAt),
      });
    } catch (error) {
      if (error && typeof error === "object")
        error.executionTimings = finalizedTimings(timings, startedAt);
      throw error;
    }
  }
}

async function reportProgress(onProgress, phase) {
  if (typeof onProgress === "function") await onProgress(phase);
}

function getExecutionState({
  source,
  candidate,
  writePaths,
  readOnlyContextPaths,
  linkSourceDependencies,
}) {
  const key = sha256({
    source,
    candidate,
    writePaths,
    readOnlyContextPaths,
    linkSourceDependencies,
  });
  let state = executionStateCache.get(key);
  if (!state) {
    state = {
      lastTouchedPaths: new Set(),
      workspaceSeeded: false,
      seedPromise: null,
    };
    executionStateCache.set(key, state);
  }
  return state;
}

async function prepareCandidateWorkspace({
  source,
  candidate,
  state,
  shouldLinkSourceDependencies,
  timings,
}) {
  if (state.lastTouchedPaths.size) {
    await restoreCandidateWorkspacePaths({
      source,
      workspace: candidate,
      paths: state.lastTouchedPaths,
    });
    state.lastTouchedPaths = new Set();
    return;
  }
  if (state.workspaceSeeded) return;
  if (!state.seedPromise) {
    state.seedPromise = copyCandidateWorkspace({
      source,
      workspace: candidate,
      shouldLinkSourceDependencies,
      timings,
    }).then(() => {
      state.workspaceSeeded = true;
    });
  }
  await state.seedPromise;
}

function elapsed(startedAt) {
  return Math.max(0, Math.round(Date.now() - startedAt));
}

function validationFailureReason(validation) {
  if (!validation || typeof validation !== "object") return null;
  if (typeof validation.outputExcerpt === "string" && validation.outputExcerpt.trim())
    return null;
  if (validation.timedOut) return "Validation timed out without output.";
  if (validation.signal) return `Validation exited on ${validation.signal} without output.`;
  const code = Number.isInteger(validation.code) ? validation.code : 1;
  return `Validation exited with code ${code} and produced no output.`;
}

function validationIssueFor(validation, validationCommand) {
  return Object.freeze({
    validationCommand,
    validationCategory: validation.timedOut
      ? "TIMED_OUT"
      : validation.signal
        ? "SIGNALED"
        : "CHECK_FAILED",
    validationOutputExcerpt: validation.outputExcerpt ?? null,
    validationFailureReason: validationFailureReason(validation),
  });
}

function mergeStoryCoverage(target, entries) {
  for (const entry of entries) {
    const index = target.findIndex((candidate) => candidate.storyKey === entry.storyKey);
    if (index >= 0) target.splice(index, 1, entry);
    else target.push(entry);
  }
}

function storiesForValidationIssue(issue, stories, storyCoverage) {
  const normalizedIssue = String(issue ?? "").toLowerCase();
  const matchedKeys = new Set();
  for (const story of stories) {
    if (normalizedIssue.includes(story.key.toLowerCase())) matchedKeys.add(story.key);
  }
  for (const coverage of storyCoverage) {
    const paths = [...coverage.implementationPaths, ...coverage.testPaths];
    if (paths.some((path) =>
      normalizedIssue.includes(path.toLowerCase()) ||
      normalizedIssue.includes(basename(path).toLowerCase())
    ))
      matchedKeys.add(coverage.storyKey);
  }
  const matchedStories = stories.filter((story) => matchedKeys.has(story.key));
  return Object.freeze(matchedStories.length ? matchedStories : [...stories]);
}

function repairContextTask(task, findings) {
  return {
    ...task,
    objective: [task.objective, ...findings.map((finding) => finding.message)].join(" "),
  };
}

function verifierIssueForFindings(findings) {
  return Object.freeze({
    validationCommand: "candidate verifier pipeline",
    validationCategory: "STORY_ACCEPTANCE_FAILED",
    validationOutputExcerpt: semanticVerificationIssue({ findings }),
    validationFailureReason: null,
    verifierFindings: Object.freeze([...findings]),
  });
}

function normalizeCandidateVerifiers(verifiers) {
  if (!Array.isArray(verifiers))
    throw new TypeError("candidateVerifiers must be an array.");
  const ids = new Set();
  return Object.freeze(verifiers.map((verifier) => {
    const id = typeof verifier?.id === "string" ? verifier.id.trim() : "";
    if (!id || ids.has(id) || typeof verifier?.verify !== "function")
      throw new TypeError("Each candidate verifier requires a unique id and verify function.");
    ids.add(id);
    return Object.freeze({ id, verify: verifier.verify });
  }));
}

async function copyCandidateWorkspace({ source, workspace, shouldLinkSourceDependencies, timings }) {
  const copyStartedAt = Date.now();
  const staleWorkspace = `${workspace}.stale-${randomUUID()}`;
  const rotated = await rename(workspace, staleWorkspace)
    .then(() => true)
    .catch((error) => {
      if (error?.code === "ENOENT") return false;
      throw error;
    });
  await mkdir(workspace, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    const sourcePath = join(source, entry.name);
    if (!shouldCopyCandidatePath(source, sourcePath)) return;
    await cp(sourcePath, join(workspace, entry.name), {
      recursive: entry.isDirectory(),
      dereference: false,
      verbatimSymlinks: true,
      mode: process.platform === "darwin" ? fsConstants.COPYFILE_FICLONE : 0,
      filter: (path) => shouldCopyCandidatePath(source, path),
    });
  }));
  await pruneCandidateWorkspace(workspace, source);
  if (shouldLinkSourceDependencies) await linkSourceDependencies(source, workspace);
  timings.workspaceCopyMs = Number(timings.workspaceCopyMs ?? 0) + elapsed(copyStartedAt);
  if (rotated) void rm(staleWorkspace, { recursive: true, force: true }).catch(() => {});
}

async function restoreCandidateWorkspacePaths({ source, workspace, paths }) {
  for (const path of paths) {
    const sourcePath = join(source, path);
    const candidatePath = join(workspace, path);
    const sourceStat = await stat(sourcePath).catch(() => null);
    if (!sourceStat) {
      await rm(candidatePath, { recursive: true, force: true });
      continue;
    }
    await mkdir(dirname(candidatePath), { recursive: true });
    await cp(sourcePath, candidatePath, {
      recursive: sourceStat.isDirectory(),
      dereference: false,
      verbatimSymlinks: true,
      force: true,
    });
  }
}
function finalizedTimings(timings, startedAt) {
  return Object.freeze({
    contextMs: Number(timings.contextMs ?? 0),
    workspaceCopyMs: Number(timings.workspaceCopyMs ?? 0),
    modelMs: Number(timings.modelMs ?? 0),
    patchMs: Number(timings.patchMs ?? 0),
    validationMs: Number(timings.validationMs ?? 0),
    promotionMs: Number(timings.promotionMs ?? 0),
    totalMs: elapsed(startedAt),
  });
}

function normalizeTask(task, approvedCommands) {
  if (
    !task ||
    typeof task.objective !== "string" ||
    !task.objective.trim() ||
    typeof task.changeDigest !== "string" ||
    !task.changeDigest.startsWith("sha256:")
  )
    throw new ChangeCaseError(
      "MODEL_PATCH_TASK_INVALID",
      "A model-patch task requires a retained objective and change digest.",
    );
  const allowedCommands = Array.isArray(task.allowedCommands)
    ? [
        ...new Set(
          task.allowedCommands
            .map((command) => String(command).trim())
            .filter(Boolean),
        ),
      ]
    : [];
  if (
    allowedCommands.length !== 1 ||
    !approvedCommands.includes(allowedCommands[0]) ||
    !validationCommands[allowedCommands[0]]
  )
    throw new ChangeCaseError(
      "MODEL_PATCH_COMMAND_DENIED",
      "The requested validation command is not approved for this project execution profile.",
    );
  return Object.freeze({
    objective: task.objective.trim(),
    changeDigest: task.changeDigest,
    allowedCommands: Object.freeze(allowedCommands),
    stories: normalizeTaskStories(task.stories),
  });
}

function normalizeTaskStories(value) {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value))
    throw new ChangeCaseError(
      "MODEL_PATCH_TASK_INVALID",
      "Model-patch task stories must be an array.",
    );
  const keys = new Set();
  const stories = value.map((story) => {
    const key = typeof story?.key === "string" ? story.key.trim() : "";
    const title = typeof story?.title === "string" ? story.title.trim() : "";
    const narrative =
      typeof story?.narrative === "string" ? story.narrative.trim() : "";
    const scenarios = Array.isArray(story?.scenarios)
      ? story.scenarios.map((scenario) => ({
          given: String(scenario?.given ?? "").trim(),
          when: String(scenario?.when ?? "").trim(),
          then: String(scenario?.then ?? "").trim(),
        }))
      : [];
    if (
      !key ||
      !title ||
      !narrative ||
      !scenarios.length ||
      scenarios.some((scenario) => !scenario.given || !scenario.when || !scenario.then) ||
      keys.has(key)
    )
      throw new ChangeCaseError(
        "MODEL_PATCH_TASK_INVALID",
        "Every model-patch story requires a unique key, title, narrative, and complete Given/When/Then scenarios.",
      );
    keys.add(key);
    return Object.freeze({
      key,
      title,
      narrative,
      scenarios: Object.freeze(scenarios.map(Object.freeze)),
    });
  });
  return Object.freeze(stories);
}

function storyBatchTasks(task) {
  if (!task.stories.length) return Object.freeze([task]);
  const batches = [];
  for (let index = 0; index < task.stories.length; index += maxStoriesPerBatch) {
    batches.push(Object.freeze({
      ...task,
      stories: Object.freeze(task.stories.slice(index, index + maxStoriesPerBatch)),
    }));
  }
  return Object.freeze(batches);
}

function combinedCompletion(completions) {
  const last = completions.at(-1);
  return Object.freeze({
    ...last,
    responseDigest: sha256(completions.map((completion) => completion.responseDigest)),
  });
}

function normalizeWritePaths(paths) {
  if (!Array.isArray(paths) || !paths.length)
    throw new ChangeCaseError(
      "MODEL_PATCH_WRITE_PATHS_REQUIRED",
      "The model-patch executor requires a non-empty writable path allowlist.",
    );
  const normalized = paths.map((path) => String(path).trim());
  if (
    normalized.some(
      (path) =>
        !path ||
        path.startsWith("/") ||
        path.includes("\\") ||
        path.split("/").includes(".."),
    )
  )
    throw new ChangeCaseError(
      "MODEL_PATCH_WRITE_PATHS_INVALID",
      "Writable paths must be relative canonical paths.",
    );
  return Object.freeze(normalized);
}

function normalizeReadOnlyContextPaths(paths) {
  if (!Array.isArray(paths))
    throw new ChangeCaseError(
      "MODEL_PATCH_CONTEXT_PATHS_INVALID",
      "Read-only context paths must be a server-configured array.",
    );
  const normalized = [...new Set(paths.map((path) => String(path).trim()))];
  if (
    normalized.some(
      (path) =>
        !path ||
        path.startsWith("/") ||
        path.includes("\\") ||
        path.includes("*") ||
        path.split("/").includes(".."),
    )
  )
    throw new ChangeCaseError(
      "MODEL_PATCH_CONTEXT_PATHS_INVALID",
      "Read-only context paths must be canonical relative file paths.",
    );
  return Object.freeze(normalized);
}

async function checkedOutRoot(value) {
  if (typeof value !== "string" || !value.trim())
    throw new ChangeCaseError(
      "MODEL_PATCH_SOURCE_REQUIRED",
      "A server-configured source checkout is required for model-patch execution.",
    );
  const root = await realpath(value).catch(() => null);
  if (!root)
    throw new ChangeCaseError(
      "MODEL_PATCH_SOURCE_REQUIRED",
      "The server-configured source checkout does not exist.",
    );
  return root;
}

async function createContextCatalog(root, writePaths, readOnlyContextPaths) {
  const catalog = new Map();
  for (const path of await expandContextPaths(root, writePaths)) catalog.set(path, true);
  for (const path of readOnlyContextPaths) if (!catalog.has(path)) catalog.set(path, false);
  return catalog;
}

async function collectContext(root, contextCatalog, task, priorityPaths = new Set()) {
  let bytes = 0;
  const files = [];
  const rankedPaths = rankContextPaths(contextCatalog, task).sort((left, right) =>
    Number(priorityPaths.has(right[0])) - Number(priorityPaths.has(left[0])),
  );
  for (const [path, writable] of rankedPaths) {
    const content = await readFile(join(root, path), "utf8").catch(() => null);
    if (content === null || content.includes("\u0000")) continue;
    const contentBytes = Buffer.byteLength(content);
    if (contentBytes > maxInspectableFileBytes) continue;
    const priority = priorityPaths.has(path);
    const fileLimit = priority ? maxPriorityFileBytes : maxFileBytes;
    const truncated = contentBytes > fileLimit;
    const suppliedContent = truncated ? contextExcerpt(content, task, fileLimit) : content;
    const size = Buffer.byteLength(suppliedContent);
    if (bytes + size > maxContextBytes) {
      if (priority)
        throw new ChangeCaseError(
          "MODEL_PATCH_VERIFIER_CONTEXT_EXCEEDED",
          "Changed implementation and test evidence exceeded the bounded verifier context.",
        );
      break;
    }
    bytes += size;
    files.push({ path, content: suppliedContent, writable, ...(truncated ? { truncated: true } : {}) });
  }
  if (!files.length)
    throw new ChangeCaseError(
      "MODEL_PATCH_CONTEXT_EMPTY",
      "No readable files matched the model-patch writable path allowlist.",
    );
  return Object.freeze(files);
}

function contextExcerpt(content, task, byteLimit = maxFileBytes) {
  const lines = content.split("\n");
  const terms = contextSearchTerms(task);
  const ranges = [[0, 35], [Math.max(0, lines.length - 140), lines.length]];
  for (const term of terms) {
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].toLowerCase().includes(term)) ranges.push([index - 6, index + 7]);
    }
  }
  let excerpt = "";
  const included = new Set();
  for (const [rawStart, rawEnd] of ranges) {
    const blockLines = [];
    for (let index = Math.max(0, rawStart); index < Math.min(lines.length, rawEnd); index += 1) {
      if (!included.has(index)) blockLines.push(lines[index]);
    }
    if (!blockLines.length) continue;
    const current = blockLines.join("\n");
    const addition = `${excerpt ? "\n\n[... omitted unchanged lines ...]\n\n" : ""}${current}`;
    if (Buffer.byteLength(excerpt + addition) > byteLimit) continue;
    excerpt += addition;
    for (let index = Math.max(0, rawStart); index < Math.min(lines.length, rawEnd); index += 1)
      included.add(index);
  }
  return excerpt;
}

function rankContextPaths(allowedPaths, task) {
  const terms = contextSearchTerms(task);
  return [...allowedPaths.entries()].sort((left, right) => {
    const scoreDifference = contextPathScore(right[0], terms) - contextPathScore(left[0], terms);
    return scoreDifference || left[0].localeCompare(right[0]);
  });
}

function contextSearchTerms(task) {
  const text = [
    task.objective,
    ...task.stories.flatMap((story) => [
      story.title,
      story.narrative,
      ...story.scenarios.flatMap((scenario) => [scenario.given, scenario.when, scenario.then]),
    ]),
  ].join(" ");
  const ignored = new Set([
    "about", "after", "before", "being", "every", "given", "implement", "into",
    "must", "should", "story", "that", "their", "then", "these", "this", "when",
    "where", "with", "without",
  ]);
  return [...new Set((text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((term) => term.length >= 4 && !ignored.has(term)))];
}

function contextPathScore(path, terms) {
  const normalizedPath = path.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  return terms.reduce(
    (score, term) => score + (normalizedPath.includes(term) ? term.length : 0),
    0,
  );
}

async function expandContextPaths(root, writePaths) {
  const collected = new Set();
  for (const pattern of writePaths) {
    if (pattern.endsWith("/**")) {
      const directory = join(root, pattern.slice(0, -3));
      if (await stat(directory).catch(() => null)) await collectContextFiles(directory, root, collected);
      continue;
    }
    const target = join(root, pattern);
    const targetStat = await stat(target).catch(() => null);
    if (!targetStat) continue;
    if (targetStat.isDirectory()) await collectContextFiles(target, root, collected);
    else if (targetStat.isFile()) collected.add(relative(root, target));
  }
  return [...collected].filter((path) => path && !isSensitivePath(path)).sort();
}

async function collectContextFiles(directory, root, collected) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const fullPath = join(directory, entry.name);
    const relativePath = relative(root, fullPath);
    if (entry.isDirectory()) await collectContextFiles(fullPath, root, collected);
    else if (entry.isFile() && relativePath && !isSensitivePath(relativePath)) collected.add(relativePath);
  }
}

function buildPatchPrompt(
  task,
  files,
  attempt = 1,
  previousResponseIssue = null,
  previousResponseCorrection = null,
  previousValidationIssue = null,
) {
  return JSON.stringify({
    schema: "adx-model-patch-request-v1",
    objective: task.objective,
    changeDigest: task.changeDigest,
    stories: task.stories,
    validation: task.allowedCommands,
    responseSchema: {
      schema: "adx-model-patch-response-v1",
      patches: [
        {
          path: "relative writable path",
          content: "complete replacement file content, or null for anchored replacements",
          replacements: [{ oldText: "exact existing text", newText: "replacement text" }],
        },
      ],
      featureSpotlight: {
        featureId:
          "lowercase feature identifier used only in data-adx-feature attributes",
        title: "short user-visible feature title",
        summary: "short description of what to look for",
      },
      storyCoverage: [
        {
          storyKey: "approved story key",
          implementationPaths: ["patched implementation path"],
          testPaths: ["patched test path"],
        },
      ],
    },
    attempt,
    previousResponseIssue,
    previousResponseCorrection,
    previousValidationIssue,
    rules: [
      "Return JSON only.",
      "Modify existing files only when they are supplied with writable:true. You may create a new file under an approved writable root when necessary, especially a domain-local test file. Files marked writable:false are read-only verification context and must never be included in patches.",
      "For files marked truncated:false, use complete replacement content and an empty replacements array.",
      "For files marked truncated:true, set content to null and use minimal exact anchored replacements copied from one contiguous supplied excerpt. Each oldText must occur exactly once in the current file.",
      "Implement every supplied approved story and all of its Given/When/Then scenarios.",
      "Implement only the story supplied in this request. Do not anticipate, claim, or implement stories that are not present in this request; later stories are handled by separate requests against the accumulated candidate.",
      "For every supplied story, include exactly one storyCoverage entry whose implementationPaths and testPaths refer only to files in this patch response.",
      "Each testPaths entry must be distinct from implementationPaths and use a recognizable test path: a test/tests/__tests__ directory, test_*.py, *_test.py, *.test.*, or *.spec.*.",
      "Create or extend a test beside the owning implementation or in its established domain test directory. Never repurpose an unrelated test suite merely to satisfy storyCoverage.",
      "Include the exact supplied story key in a test name or assertion message so final accumulated evidence can be verified after later story requests.",
      "When previousValidationIssue reports a reachability, invocation, or data-flow defect, patch the existing application owner that closes that defect and test the owning integration. Cited evidence paths identify the failed evidence; they do not limit which supplied writable files may be patched.",
      "A repair response must close the exact reported defect. Do not return another isolated helper or direct helper test when the finding requires a reachable UI owner, route, handler, job, workflow owner, notification sender, or authoritative data source.",
      "When a user-visible feature is added, include featureSpotlight and mark its visible root element with data-adx-feature equal to featureSpotlight.featureId. Otherwise set featureSpotlight to null.",
      "Do not add dependencies, run commands, request secrets, create commits, or claim verification.",
    ],
    files,
  });
}

async function requestValidatedPatches({ gateway, task, context, candidate, writePaths, previousValidationIssue = null, timeoutMs = 900_000 }) {
  let lastError;
  for (let attempt = 1; attempt <= maxPatchResponseAttempts; attempt += 1) {
    const request = {
      system:
        "You are a bounded code-editing worker. Return only valid JSON matching the requested schema. Never include markdown, explanations, credentials, commands, or files outside the supplied writable context.",
      prompt: buildPatchPrompt(
        task,
        context,
        attempt,
        lastError?.details?.responseIssue,
        lastError?.details?.responseCorrection,
        previousValidationIssue,
      ),
      correlationId: randomUUID(),
      maxTokens: 8192,
      temperature: 0,
      responseSchema: modelPatchResponseSchema,
      timeoutMs,
    };
    const completion = await completeWithCompactContextFallback({
      gateway,
      request,
      task,
    });
    try {
      const parsed = parseModelResponse(
        completion.text,
        writePaths,
        completion,
        task.stories,
      );
      await validatePatchAnchors(candidate, parsed.patches, completion);
      return Object.freeze({
        completion,
        ...parsed,
      });
    } catch (error) {
      if (
        error?.code !== "MODEL_PATCH_RESPONSE_INVALID" ||
        attempt === maxPatchResponseAttempts
      )
        throw withAttempts(error, attempt);
      lastError = error;
    }
  }
  throw lastError;
}

async function validatePatchAnchors(root, patches, completion) {
  for (const patch of patches) {
    if (patch.content !== null) continue;
    let content = await readFile(join(root, patch.path), "utf8").catch(() => null);
    if (content === null)
      throw patchResponseError(
        "PATCH_ANCHOR_TARGET_MISSING",
        `Anchored replacement target ${patch.path} does not exist.`,
        completion,
        `Emit complete replacement content for new file ${patch.path}; anchored replacements are only valid for existing files.`,
      );
    for (const replacement of patch.replacements) {
      const first = content.indexOf(replacement.oldText);
      const last = content.lastIndexOf(replacement.oldText);
      if (first < 0 || first !== last)
        throw patchResponseError(
          "PATCH_ANCHOR_NOT_UNIQUE",
          `Anchored replacement for ${patch.path} must match exactly once.`,
          completion,
          `For ${patch.path}, copy a larger exact oldText block from one supplied excerpt so it occurs exactly once in the current file. Do not shorten, paraphrase, or combine separate excerpts.`,
        );
      content = `${content.slice(0, first)}${replacement.newText}${content.slice(first + replacement.oldText.length)}`;
    }
  }
}

async function verifyCandidateSemantics({
  gateway,
  task,
  context,
  storyCoverage,
  touchedPaths,
  timeoutMs = 900_000,
}) {
  let lastError;
  for (let attempt = 1; attempt <= maxVerifierResponseAttempts; attempt += 1) {
    const request = {
      system:
        "You are an independent code-change verifier. Evaluate repository evidence only. Return strict JSON and never propose patches, commands, credentials, or markdown.",
      prompt: JSON.stringify({
        schema: "adx-candidate-semantic-verification-request-v1",
        objective: task.objective,
        stories: task.stories,
        storyCoverage,
        touchedPaths: [...touchedPaths].sort(),
        attempt,
        previousResponseIssue:
          lastError?.details?.responseIssue ?? lastError?.code ?? null,
        previousResponseCorrection:
          lastError?.details?.responseCorrection ??
          (lastError
            ? "Return exactly one schema-valid verifier object. passed=true requires findings=[]; passed=false requires at least one finding with an approved storyKey and evidencePaths drawn only from supplied files."
            : null),
        rules: [
          "Pass only when every supplied Given/When/Then scenario is implemented in the combined candidate.",
          "A new UI component must be imported and rendered by an existing reachable application owner; isolated components and isolated tests fail.",
          "Backend behavior must be invoked by an existing route, handler, job, or workflow owner; unused helpers fail.",
          "Tests must exercise the owning integration or a contract that proves the new behavior is reachable, not only a new helper in isolation.",
          "Verify data flow from an existing source through the implementation to the observable outcome.",
          "Reject storyCoverage claims that are unsupported by the supplied repository files.",
          "Every finding must cite concrete evidencePaths from the supplied files and provide a concise actionable correction.",
          "Do not require unrelated infrastructure or persistence when the existing repository contract can satisfy the story.",
        ],
        files: context,
      }),
      correlationId: randomUUID(),
      maxTokens: 4096,
      temperature: 0,
      responseSchema: semanticVerificationResponseSchema,
      timeoutMs,
    };
    const completion = await completeWithCompactContextFallback({ gateway, request, task });
    try {
      return parseSemanticVerification(
        completion.text,
        task.stories,
        new Set(context.map((file) => file.path)),
        completion,
      );
    } catch (error) {
      if (
        error?.code !== "MODEL_PATCH_RESPONSE_INVALID" ||
        attempt === maxVerifierResponseAttempts
      )
        throw withAttempts(error, attempt);
      lastError = error;
    }
  }
  throw lastError;
}

function isUnclassifiedGatewayBadRequest(error) {
  return error?.code === "AZURE_OPENAI_GATEWAY_REQUEST_FAILED" &&
    error?.details?.providerStatus === 400 &&
    !error?.details?.gatewayError;
}

async function completeWithCompactContextFallback({ gateway, request, task }) {
  try {
    return await gateway.complete(request);
  } catch (error) {
    if (!isUnclassifiedGatewayBadRequest(error)) throw error;
    return gateway.complete({
      ...request,
      prompt: buildCompactContextPrompt(request.prompt, task),
      correlationId: randomUUID(),
    });
  }
}

function buildCompactContextPrompt(prompt, task) {
  const request = JSON.parse(prompt);
  const fileLimit = Math.min(
    maxCompactFileBytes,
    Math.max(256, Math.floor(maxCompactContextBytes / request.files.length)),
  );
  const files = request.files.map((file) => {
    if (Buffer.byteLength(file.content) <= fileLimit) return file;
    const excerpt = contextExcerpt(file.content, task, fileLimit);
    return {
      ...file,
      content: excerpt || file.content.slice(0, fileLimit),
      truncated: true,
    };
  });
  return JSON.stringify({ ...request, compactContext: true, files });
}

async function runCandidateVerifiers({ verifiers, timeoutMs, ...input }) {
  const findings = [];
  const storyKeys = new Set(input.task.stories.map((story) => story.key));
  const contextPaths = new Set(input.context.map((file) => file.path));
  const results = await Promise.all(verifiers.map((verifier) =>
    runCandidateVerifier(verifier, { ...input, timeoutMs }, timeoutMs),
  ));
  for (const { verifier, result } of results) {
    if (!result || typeof result.passed !== "boolean" || !Array.isArray(result.findings))
      throw new ChangeCaseError(
        "CANDIDATE_VERIFIER_INVALID",
        `Candidate verifier ${verifier.id} returned an invalid result.`,
      );
    const normalizedFindings = result.findings.map((finding) => ({
      storyKey: typeof finding?.storyKey === "string" ? finding.storyKey.trim() : "",
      code: typeof finding?.code === "string" ? finding.code.trim() : "",
      message: typeof finding?.message === "string" ? finding.message.trim() : "",
      evidencePaths: normalizeCoveragePaths(finding?.evidencePaths),
    }));
    const unsupportedEvidencePath = normalizedFindings
      .flatMap((finding) => finding.evidencePaths)
      .find((path) => !contextPaths.has(path));
    if (unsupportedEvidencePath)
      throw new ChangeCaseError(
        "CANDIDATE_VERIFIER_INVALID",
        `Candidate verifier ${verifier.id} cited evidence path ${unsupportedEvidencePath}, which was not supplied in its context.`,
      );
    if (
      normalizedFindings.length > maxSemanticFindings ||
      normalizedFindings.some((finding) =>
        !storyKeys.has(finding.storyKey) ||
        !finding.code ||
        !finding.message ||
        !finding.evidencePaths.length
      ) ||
      (result.passed && normalizedFindings.length) ||
      (!result.passed && !normalizedFindings.length)
    )
      throw new ChangeCaseError(
        "CANDIDATE_VERIFIER_INVALID",
        `Candidate verifier ${verifier.id} returned an inconsistent or unsupported finding.`,
      );
    for (const finding of normalizedFindings) {
      findings.push(Object.freeze({ ...finding, verifierId: verifier.id }));
    }
  }
  return Object.freeze({
    passed: findings.length === 0,
    findings: Object.freeze(findings),
  });
}

function runCandidateVerifier(verifier, input, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      rejectPromise(new ChangeCaseError(
        "CANDIDATE_VERIFIER_TIMED_OUT",
        `Candidate verifier ${verifier.id} exceeded its execution deadline.`,
      ));
    }, timeoutMs);
    Promise.resolve(verifier.verify({ ...input, signal: controller.signal }))
      .then((result) => resolvePromise({ verifier, result }), rejectPromise)
      .finally(() => clearTimeout(timeout));
  });
}

const semanticVerificationResponseSchema = Object.freeze({
  name: "adx_candidate_semantic_verification",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["schema", "passed", "findings"],
    properties: {
      schema: {
        type: "string",
        enum: ["adx-candidate-semantic-verification-v1"],
      },
      passed: { type: "boolean" },
      findings: {
        type: "array",
        maxItems: maxSemanticFindings,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["storyKey", "code", "message", "evidencePaths"],
          properties: {
            storyKey: { type: "string", minLength: 1, maxLength: 120 },
            code: { type: "string", minLength: 2, maxLength: 80 },
            message: { type: "string", minLength: 2, maxLength: 500 },
            evidencePaths: {
              type: "array",
              minItems: 1,
              maxItems: 8,
              items: { type: "string", minLength: 1, maxLength: 500 },
            },
          },
        },
      },
    },
  },
});

function parseSemanticVerification(text, stories, contextPaths, completion = {}) {
  let response;
  try {
    response = JSON.parse(unwrapJsonFence(text));
  } catch {
    throw patchResponseError(
      "SEMANTIC_VERIFICATION_NON_JSON",
      "The semantic verifier returned a non-JSON response.",
      completion,
    );
  }
  const storyKeys = new Set(stories.map((story) => story.key));
  const findings = Array.isArray(response?.findings)
    ? response.findings.map((finding) => ({
        storyKey: typeof finding?.storyKey === "string" ? finding.storyKey.trim() : "",
        code: typeof finding?.code === "string" ? finding.code.trim() : "",
        message: typeof finding?.message === "string" ? finding.message.trim() : "",
        evidencePaths: normalizeCoveragePaths(finding?.evidencePaths),
      }))
    : null;
  if (
    response?.schema !== "adx-candidate-semantic-verification-v1" ||
    typeof response?.passed !== "boolean" ||
    !findings ||
    findings.length > maxSemanticFindings ||
    findings.some((finding) =>
      !storyKeys.has(finding.storyKey) ||
      !finding.code ||
      !finding.message ||
      !finding.evidencePaths.length ||
      finding.evidencePaths.some((path) => !contextPaths.has(path))
    ) ||
    (response.passed && findings.length) ||
    (!response.passed && !findings.length)
  )
    throw patchResponseError(
      "SEMANTIC_VERIFICATION_SCHEMA_INVALID",
      "The semantic verifier response must provide a consistent verdict with evidence-backed findings.",
      completion,
    );
  return Object.freeze({
    passed: response.passed,
    findings: Object.freeze(findings.map((finding) => Object.freeze(finding))),
  });
}

function semanticVerificationIssue(verification) {
  return verification.findings
    .map((finding) =>
      `${finding.storyKey} ${finding.code}${finding.verifierId ? ` [${finding.verifierId}]` : ""}: ${finding.message} Evidence: ${finding.evidencePaths.join(", ")}`,
    )
    .join("\n")
    .slice(0, 8 * 1024);
}

const modelPatchResponseSchema = Object.freeze({
  name: "adx_model_patch_response",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["schema", "patches", "featureSpotlight", "storyCoverage"],
    properties: {
      schema: { type: "string", enum: ["adx-model-patch-response-v1"] },
      patches: {
        type: "array",
        minItems: 1,
        maxItems: maxPatches,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["path", "content", "replacements"],
          properties: {
            path: { type: "string" },
            content: { anyOf: [{ type: "string" }, { type: "null" }] },
            replacements: {
              type: "array",
              maxItems: 20,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["oldText", "newText"],
                properties: {
                  oldText: { type: "string", minLength: 1 },
                  newText: { type: "string" },
                },
              },
            },
          },
        },
      },
      featureSpotlight: {
        anyOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: ["featureId", "title", "summary"],
            properties: {
              featureId: { type: "string", minLength: 2, maxLength: 64 },
              title: { type: "string", minLength: 2, maxLength: 120 },
              summary: { type: "string", minLength: 2, maxLength: 280 },
            },
          },
        ],
      },
      storyCoverage: {
        type: "array",
        maxItems: 50,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["storyKey", "implementationPaths", "testPaths"],
          properties: {
            storyKey: { type: "string", minLength: 1, maxLength: 120 },
            implementationPaths: {
              type: "array",
              minItems: 1,
              items: { type: "string", minLength: 1 },
            },
            testPaths: {
              type: "array",
              minItems: 1,
              items: { type: "string", minLength: 1 },
            },
          },
        },
      },
    },
  },
});

function parseModelResponse(
  text,
  writePaths,
  completion = {},
  requiredStories = [],
) {
  const finishReason = completion.finishReason ?? null;
  let response;
  try {
    response = JSON.parse(unwrapJsonFence(text));
  } catch {
    throw patchResponseError(
      "NON_JSON",
      "The model-patch executor received a non-JSON response.",
      completion,
    );
  }
  if (
    response?.schema !== "adx-model-patch-response-v1" ||
    !Array.isArray(response.patches) ||
    !response.patches.length ||
    response.patches.length > maxPatches
  )
    throw patchResponseError(
      "SCHEMA_INVALID",
      "The model-patch response must contain a bounded non-empty patch list.",
      completion,
    );
  const seen = new Set();
  const patches = response.patches.map((patch) => {
    const path = typeof patch?.path === "string" ? patch.path.trim() : "";
    const content = typeof patch?.content === "string" ? patch.content : null;
    const replacements = Array.isArray(patch?.replacements)
      ? patch.replacements.map((replacement) => ({
          oldText: typeof replacement?.oldText === "string" ? replacement.oldText : "",
          newText: typeof replacement?.newText === "string" ? replacement.newText : null,
        }))
      : [];
    const usesReplacement = content !== null;
    const usesAnchors = replacements.length > 0;
    if (
      !path ||
      path.startsWith("/") ||
      path.includes("\\") ||
      path.split("/").includes("..") ||
      !isWritable(path, writePaths) ||
      isSensitivePath(path) ||
      usesReplacement === usesAnchors ||
      (usesReplacement && (content.includes("\u0000") || Buffer.byteLength(content) > maxPatchBytes)) ||
      (usesAnchors && replacements.some((replacement) =>
        !replacement.oldText || replacement.newText === null || replacement.oldText.includes("\u0000") ||
        replacement.newText.includes("\u0000") ||
        Buffer.byteLength(replacement.oldText) + Buffer.byteLength(replacement.newText) > maxPatchBytes
      )) ||
      seen.has(path)
    )
      throw patchResponseError(
        "PATCH_INVALID",
        "The model-patch response contains an invalid or unauthorized file replacement.",
        completion,
      );
    seen.add(path);
    return Object.freeze({ path, content, replacements: Object.freeze(replacements.map(Object.freeze)) });
  });
  const storyCoverage = parseStoryCoverage(
    response.storyCoverage,
    requiredStories,
    new Set(patches.map((patch) => patch.path)),
    completion,
  );
  return Object.freeze({
    patches: Object.freeze(patches),
    storyCoverage,
    featureSpotlight: parseFeatureSpotlight(
      response.featureSpotlight,
      completion,
    ),
  });
}

function parseStoryCoverage(value, requiredStories, patchedPaths, completion) {
  if (!requiredStories.length) return Object.freeze([]);
  if (!Array.isArray(value))
    throw patchResponseError(
      "STORY_COVERAGE_MISSING",
      "The model-patch response must include coverage for every approved story.",
      completion,
    );
  const requiredKeys = new Set(requiredStories.map((story) => story.key));
  const seen = new Set();
  const coverage = value.map((entry) => {
    const storyKey = typeof entry?.storyKey === "string" ? entry.storyKey.trim() : "";
    const declaredImplementationPaths = normalizeCoveragePaths(entry?.implementationPaths);
    const declaredTestPaths = normalizeCoveragePaths(entry?.testPaths);
    if (!requiredKeys.has(storyKey))
      throw patchResponseError(
        "STORY_COVERAGE_KEY_INVALID",
        "Story coverage must use an approved story key.",
        completion,
      );
    if (seen.has(storyKey))
      throw patchResponseError(
        "STORY_COVERAGE_KEY_DUPLICATE",
        "Story coverage must contain exactly one entry per approved story key.",
        completion,
      );
    if (!declaredImplementationPaths.length || !declaredTestPaths.length)
      throw patchResponseError(
        "STORY_COVERAGE_PATHS_MISSING",
        "Every approved story must map to implementation and test paths.",
        completion,
      );
    const implementationPathSet = new Set(declaredImplementationPaths);
    if (declaredTestPaths.some((path) => implementationPathSet.has(path)))
      throw patchResponseError(
        "STORY_COVERAGE_PATH_OVERLAP",
        "Story implementation and test paths must be distinct.",
        completion,
      );
    if (declaredTestPaths.some((path) => !isTestPath(path)))
      throw patchResponseError(
        "STORY_COVERAGE_TEST_PATH_INVALID",
        "Story test paths must follow a recognized test-file convention.",
        completion,
      );
    const implementationPaths = declaredImplementationPaths.filter((path) => patchedPaths.has(path));
    const testPaths = declaredTestPaths.filter((path) => patchedPaths.has(path));
    if (!implementationPaths.length || !testPaths.length) {
      const missingImplementationPaths = declaredImplementationPaths.filter(
        (path) => !patchedPaths.has(path),
      );
      const missingTestPaths = declaredTestPaths.filter((path) => !patchedPaths.has(path));
      throw patchResponseError(
        "STORY_COVERAGE_PATCHED_EVIDENCE_MISSING",
        "Every approved story must retain patched implementation and test evidence.",
        completion,
        `Your next response MUST emit at least one implementation patch and one test patch for ${storyKey}. Missing implementation patches: ${missingImplementationPaths.join(", ") || "none"}. Missing test patches: ${missingTestPaths.join(", ") || "none"}. A path named in storyCoverage does not count unless that exact path is also present in patches. Exact emitted patch paths: ${[...patchedPaths].join(", ")}.`,
      );
    }
    seen.add(storyKey);
    return Object.freeze({ storyKey, implementationPaths, testPaths });
  });
  if (seen.size !== requiredKeys.size || [...requiredKeys].some((key) => !seen.has(key)))
    throw patchResponseError(
      "STORY_COVERAGE_INCOMPLETE",
      "The model-patch response omitted one or more approved stories.",
      completion,
    );
  return Object.freeze(coverage);
}

function normalizeCoveragePaths(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze([
    ...new Set(value.map((path) => String(path).trim()).filter(Boolean)),
  ]);
}

function isTestPath(path) {
  return /(^|\/)(__tests__\/|tests?\/)|(^|\/)(?:test_[^/]+|[^/]+_tests?)\.py$|(^|\/)[^/]+\.(?:test|spec)\.[^/]+$/i.test(path);
}

function parseFeatureSpotlight(value, completion) {
  if (value === undefined || value === null) return null;
  const featureId =
    typeof value?.featureId === "string" ? value.featureId.trim() : "";
  const title = typeof value?.title === "string" ? value.title.trim() : "";
  const summary =
    typeof value?.summary === "string" ? value.summary.trim() : "";
  if (
    !/^[a-z][a-z0-9-]{1,63}$/.test(featureId) ||
    !title ||
    title.length > 120 ||
    !summary ||
    summary.length > 280
  )
    throw patchResponseError(
      "SPOTLIGHT_INVALID",
      "The feature spotlight must contain a safe feature ID, title, and summary.",
      completion,
    );
  return Object.freeze({ featureId, title, summary });
}

function unwrapJsonFence(text) {
  const trimmed = String(text ?? "").trim();
  const match = trimmed.match(/^```json\s*\n?([\s\S]*?)\n?```$/i);
  return match ? match[1].trim() : trimmed;
}

function patchResponseError(responseIssue, message, completion, responseCorrection = null) {
  const finishReason = completion?.finishReason ?? null;
  const safeFinishReason = ["stop", "length", "content_filter"].includes(
    finishReason,
  )
    ? finishReason
    : null;
  const providerRequestId =
    typeof completion?.providerRequestId === "string" &&
    completion.providerRequestId.length <= 256
      ? completion.providerRequestId
      : null;
  return new ChangeCaseError("MODEL_PATCH_RESPONSE_INVALID", message, {
    details: {
      responseIssue,
      responseCorrection:
        typeof responseCorrection === "string" && responseCorrection.length <= 2048
          ? responseCorrection
          : null,
      modelFinishReason: safeFinishReason,
      providerRequestId,
    },
  });
}

function withAttempts(error, attempts) {
  if (!(error instanceof ChangeCaseError)) return error;
  return new ChangeCaseError(error.code, error.message, {
    details: { ...error.details, modelAttempts: attempts },
  });
}

async function writePatch(root, patch) {
  const target = resolve(root, patch.path);
  if (!target.startsWith(`${root}/`))
    throw new ChangeCaseError(
      "MODEL_PATCH_PATH_ESCAPE",
      "A model-patch path escaped the disposable candidate.",
    );
  await mkdir(dirname(target), { recursive: true });
  if (patch.content !== null) {
    await writeFile(target, patch.content, "utf8");
    return;
  }
  let content = await readFile(target, "utf8").catch(() => null);
  if (content === null)
    throw new ChangeCaseError("MODEL_PATCH_ANCHOR_INVALID", "Anchored replacements require an existing candidate file.");
  for (const replacement of patch.replacements) {
    const first = content.indexOf(replacement.oldText);
    const last = content.lastIndexOf(replacement.oldText);
    if (first < 0 || first !== last)
      throw new ChangeCaseError("MODEL_PATCH_ANCHOR_INVALID", "Every anchored replacement must match exactly once in the current candidate file.");
    content = `${content.slice(0, first)}${replacement.newText}${content.slice(first + replacement.oldText.length)}`;
  }
  await writeFile(target, content, "utf8");
}

async function readCandidateFiles(root, paths) {
  return new Map(await Promise.all([...new Set(paths)].map(async (path) => [
    path,
    await readFile(join(root, path), "utf8").catch(() => ""),
  ])));
}

async function captureStoryEvidence(candidate, coverageEntries, previousContent, storyEvidence) {
  for (const coverage of coverageEntries) {
    const evidence = [];
    for (const path of coverage.testPaths) {
      const beforeLines = new Set((previousContent.get(path) ?? "").split("\n"));
      const after = await readFile(join(candidate, path), "utf8").catch(() => "");
      const addedLines = after.split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length >= 8 && !beforeLines.has(line));
      evidence.push({ path, addedLines });
    }
    storyEvidence.set(coverage.storyKey, evidence);
  }
}

async function finalCandidateEvidenceIssue({ source, candidate, stories, storyCoverage, storyEvidence, touchedPaths }) {
  for (const story of stories) {
    const coverage = storyCoverage.find((entry) => entry.storyKey === story.key);
    if (!coverage) return `Final candidate coverage is missing ${story.key}.`;
    const evidence = storyEvidence.get(story.key) ?? [];
    const retained = await Promise.all(evidence.map(async ({ path, addedLines }) => {
      const content = await readFile(join(candidate, path), "utf8").catch(() => "");
      return addedLines.length > 0 && addedLines.some((line) => content.includes(line));
    }));
    if (!retained.some(Boolean)) return `Final test evidence added for ${story.key} was removed by a later story batch.`;
  }
  for (const path of touchedPaths) {
    const [before, after] = await Promise.all([
      readFile(join(source, path), "utf8").catch(() => null),
      readFile(join(candidate, path), "utf8").catch(() => null),
    ]);
    if (before !== null && after !== null && Buffer.byteLength(before) >= 4 * 1024 && Buffer.byteLength(after) < Buffer.byteLength(before) * 0.85)
      return `Existing file ${path} lost more than 15 percent of its content; preserve unrelated behavior with a minimal edit.`;
  }
  return null;
}

function failedValidation(reason) {
  return Object.freeze({
    code: 1,
    signal: null,
    timedOut: false,
    outputBytes: Buffer.byteLength(reason),
    outputDigest: sha256(reason),
    outputExcerpt: reason,
  });
}

function isWritable(path, writePaths) {
  return writePaths.some((pattern) =>
    pattern.endsWith("/**")
      ? path.startsWith(pattern.slice(0, -3))
      : path === pattern,
  );
}

function isSensitivePath(path) {
  return path
    .split("/")
    .some(
      (part) =>
        sensitiveFileNames.has(part) ||
        part.endsWith(".pem") ||
        part.endsWith(".key"),
    );
}

function shouldCopyCandidatePath(root, path) {
  const relativePath = relative(root, path);
  if (!relativePath) return true;
  const parts = relativePath.split("/");
  return (
    !parts.some((part) => ignoredDirectories.has(part)) &&
    !isSensitivePath(relativePath)
  );
}

async function runValidation({ cwd, allowedCommands, timeoutMs }) {
  const configured = validationCommands[allowedCommands?.[0]];
  if (!configured)
    throw new ChangeCaseError(
      "MODEL_PATCH_COMMAND_DENIED",
      "Validation requires an approved project command.",
    );
  const commands = Array.isArray(configured) ? configured : [configured];
  const startedAt = Date.now();
  let outputBytes = 0;
  let outputExcerpt = "";
  for (const command of commands) {
    const result = await runValidationCommand({
      cwd,
      command,
      timeoutMs: Math.max(1, timeoutMs - elapsed(startedAt)),
    });
    outputBytes = Math.min(64 * 1024, outputBytes + result.outputBytes);
    outputExcerpt = appendOutputExcerpt(outputExcerpt, result.outputExcerpt ?? "");
    if (result.code !== 0 || result.signal || result.timedOut)
      return Object.freeze({ ...result, outputBytes, outputExcerpt: outputExcerpt || null });
  }
  return Object.freeze({
    code: 0,
    signal: null,
    timedOut: false,
    outputBytes,
    outputDigest: sha256({ commandCount: commands.length, outputBytes }),
    outputExcerpt: outputExcerpt || null,
  });
}

function runValidationCommand({ cwd, command, timeoutMs }) {
  return new Promise((resolvePromise) => {
    const child = spawn(command.executable, command.arguments, {
      cwd,
      env: {
        PATH: process.env.PATH,
        LANG: "C",
        npm_config_audit: "false",
        npm_config_fund: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let outputBytes = 0;
    let outputExcerpt = "";
    const capture = (chunk) => {
      outputBytes += chunk.length;
      outputExcerpt = appendOutputExcerpt(outputExcerpt, chunk);
    };
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolvePromise(
        Object.freeze({
          code: code ?? 1,
          signal,
          timedOut,
          outputBytes: Math.min(outputBytes, 64 * 1024),
          outputDigest: sha256({
            code,
            signal,
            outputBytes: Math.min(outputBytes, 64 * 1024),
          }),
            outputExcerpt: outputExcerpt || null,
        }),
      );
    });
  });
}

function appendOutputExcerpt(current, chunk) {
  const next = `${current}${chunk.toString("utf8")}`;
  const maxExcerptBytes = 4096;
  if (Buffer.byteLength(next) <= maxExcerptBytes) return next;
  return next.slice(-maxExcerptBytes);
}

async function linkSourceDependencies(source, workspace) {
  let linked = 0;
  async function linkFrom(relativePath) {
    for (const entry of await readdir(join(source, relativePath || "."), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      const nextRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (entry.name === "node_modules") {
        if (relativePath.split("/").filter(Boolean).length > 1) continue;
        await mkdir(dirname(join(workspace, nextRelativePath)), { recursive: true });
        await symlink(join(source, nextRelativePath), join(workspace, nextRelativePath), "dir");
        linked += 1;
        continue;
      }
      if (ignoredDirectories.has(entry.name)) continue;
      await linkFrom(nextRelativePath);
    }
  }
  await linkFrom("");
  if (!linked)
    throw new ChangeCaseError(
      "MODEL_PATCH_DEPENDENCIES_MISSING",
      "The execution profile requires dependencies in the server source checkout. Install them before starting a bounded run.",
      { retryable: false, severity: "warning" },
    );
}

async function removeTransientCandidateOutputs(workspace) {
  await Promise.all(
    transientCandidateDirectories.map((path) =>
      rm(join(workspace, path), { recursive: true, force: true }),
    ),
  );
}

async function pruneCandidateWorkspace(workspace, source) {
  await Promise.all(
    Array.from(ignoredDirectories, (directory) =>
      rm(join(workspace, directory), { recursive: true, force: true }),
    ),
  );
  await pruneSensitiveFiles(workspace, source, "");
}

async function pruneSensitiveFiles(workspace, source, relativePath) {
  for (const entry of await readdir(join(source, relativePath || "."), {
    withFileTypes: true,
  })) {
    const nextRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) continue;
      await pruneSensitiveFiles(workspace, source, nextRelativePath);
      continue;
    }
    if (!entry.isFile() || !isSensitivePath(nextRelativePath)) continue;
    await rm(join(workspace, nextRelativePath), { force: true });
  }
}

async function digestTree(root) {
  const files = [];
  async function collect(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (!shouldCopyCandidatePath(root, fullPath)) continue;
      if (entry.isDirectory()) await collect(fullPath);
      else if (entry.isFile()) {
        const bytes = await readFile(fullPath);
        files.push({
          path: relative(root, fullPath),
          bytes: bytes.length,
          digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        });
      }
    }
  }
  await collect(root);
  return sha256(
    files.sort((left, right) => left.path.localeCompare(right.path)),
  );
}
