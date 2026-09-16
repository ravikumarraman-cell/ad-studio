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
const maxPatchResponseAttempts = 4;
const maxSemanticFindings = 20;
// Semantic findings can span separate production owners. Keep repairs bounded,
// but allow each focused repair/verification cycle to close one dependency
// chain rather than abandoning the candidate after a single broad attempt.
// One owner-focused repair follows the full deterministic verification. Any
// remaining defect is returned with evidence rather than starting another
// speculative model cycle.
const maxCandidateRepairRounds = 1;
const maxCandidateValidationAttempts = 2;
const maxCandidateEvidenceRepairAttempts = 1;
const maxStoriesPerBatch = 3;
const maxAffinityPartitionStories = 12;
const maxOwnerRequirementsPerBatch = 3;
const maxConcurrentImplementationBatches = 2;
// A model request that has not settled promptly is not useful progress. Keep
// the execution lease longer for recovery, but cap each upstream call so a
// closed or half-open gateway connection cannot pin a run for fifteen minutes.
const maxModelRequestTimeoutMs = 90_000;
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
    const modelTimeoutMs = boundedModelRequestTimeout(timeoutMs);
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
    let normalizedTask = normalizeTask(task, this.allowedValidationCommands);
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
      // Capability evidence must come from the immutable source checkout, never
      // from a warmed candidate that may contain patches from an earlier run.
      // Otherwise the same request can be accepted or rejected based on
      // disposable workspace residue.
      const provisionalExternalContracts = await assertRepositoryCapabilities(source, contextCatalog, normalizedTask);
      if (provisionalExternalContracts.length)
        normalizedTask = Object.freeze({ ...normalizedTask, provisionalExternalContracts });
      await reportProgress(onProgress, "CONTEXT_READY", {
        activity: "WORKSPACE_PREPARATION",
        durationMs: elapsed(contextStartedAt),
        fileCount: contextCatalog.size,
      });
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
      let evidenceRepairAttempts = 0;
      for (
        let validationAttempt = 1;
        validationAttempt <= maxCandidateValidationAttempts;
        validationAttempt += 1
      ) {
        const implementationBatches = storyBatchTasks({
          ...normalizedTask,
          stories: requestedStories,
        });
        const batchDescriptors = implementationBatches.map((batchTask, batchIndex) => {
          const priorityPaths = repairIntegrationPriorityPaths(
            contextCatalog,
            batchTask,
            new Set(),
          );
          return {
            batchTask,
            batchIndex,
            priorityPaths,
            ownerPaths: implementationOwnerPaths(contextCatalog, batchTask),
          };
        });
        for (const wave of implementationBatchWaves(batchDescriptors)) {
          const preparedWave = await Promise.all(wave.map(async (descriptor) => {
            const { batchTask, batchIndex, priorityPaths } = descriptor;
            const batchContextStartedAt = Date.now();
            const context = await collectContext(candidate, contextCatalog, batchTask, priorityPaths);
            const contextMs = elapsed(batchContextStartedAt);
            return { ...descriptor, context, contextMs };
          }));
          const waveResults = await Promise.all(preparedWave
            .sort((left, right) => left.batchIndex - right.batchIndex)
            .map(async (descriptor) => {
            const { batchTask, batchIndex, context, contextMs } = descriptor;
            const modelStartedAt = Date.now();
            const operation = validationAttempt === 1 && evidenceRepairAttempts === 0
              ? "IMPLEMENTATION"
              : "EVIDENCE_REPAIR";
            const operationDetails = {
              activity: operation,
              batchStrategy: wave.length > 1 ? "AFFINITY_CAPACITY_CONCURRENT" : "AFFINITY_CAPACITY",
              operationIndex: batchIndex + 1,
              operationCount: implementationBatches.length,
              storyKeys: batchTask.stories.map((story) => story.key),
            };
            await reportProgress(onProgress, "MODEL_REQUEST", operationDetails);
            let response;
            try {
              response = await requestValidatedPatches({
                gateway: this.gateway,
                task: batchTask,
                context,
                candidate,
                writePaths,
                previousValidationIssue,
                timeoutMs: modelTimeoutMs,
              });
            } finally {
              descriptor.modelMs = elapsed(modelStartedAt);
            }
            await reportProgress(onProgress, "MODEL_RESPONSE", {
              ...operationDetails,
              durationMs: descriptor.modelMs,
            });
            return { ...descriptor, response, contextMs, operationDetails };
          }));
          const applyBatchResponse = async ({ response, contextMs, operationDetails }) => {
            timings.contextMs = Number(timings.contextMs ?? 0) + contextMs;
            completions.push(response.completion);
            featureSpotlight ??= response.featureSpotlight;
            mergeStoryCoverage(coverage, response.storyCoverage);
            const patchStartedAt = Date.now();
            const previousTestContent = await readCandidateFiles(
              candidate,
              response.storyCoverage.flatMap((entry) => entry.testPaths),
            );
            for (const patch of response.patches) {
              await writeMaterializedPatch(candidate, patch);
              touchedPaths.add(patch.path);
              contextCatalog.set(patch.path, true);
              executionState.lastTouchedPaths = new Set(touchedPaths);
            }
            await captureStoryEvidence(candidate, response.storyCoverage, previousTestContent, storyEvidence);
            const patchMs = elapsed(patchStartedAt);
            timings.patchMs = Number(timings.patchMs ?? 0) + patchMs;
            await reportProgress(onProgress, "PATCH_APPLIED", {
              ...operationDetails,
              durationMs: patchMs,
              patchCount: response.patches.length,
            });
          };
          const collisionPaths = batchResponseCollisionPaths(waveResults);
          if (collisionPaths.length) {
            // No files have been written yet. Preserve the first valid result,
            // then replay every remaining descriptor against the materialized
            // candidate. This turns an unpredictable parallel overlap into a
            // deterministic, bounded serial continuation instead of failing
            // the entire change case.
            const ordered = waveResults.sort((left, right) => left.batchIndex - right.batchIndex);
            timings.modelMs = Number(timings.modelMs ?? 0) + Math.max(0, ...ordered.map(({ modelMs }) => modelMs));
            await reportProgress(onProgress, "MODEL_REQUEST", {
              activity: "COLLISION_SERIAL_FALLBACK",
              batchStrategy: "COLLISION_SERIAL_FALLBACK",
              collisionPaths,
              operationCount: ordered.length,
              operationIndex: 1,
              storyKeys: ordered.flatMap(({ batchTask }) => batchTask.stories.map((story) => story.key)),
            });
            await applyBatchResponse(ordered[0]);
            for (let index = 1; index < ordered.length; index += 1) {
              const descriptor = ordered[index];
              const contextStartedAt = Date.now();
              const replayContext = await collectContext(candidate, contextCatalog, descriptor.batchTask, descriptor.priorityPaths);
              const replayContextMs = elapsed(contextStartedAt);
              const replayStartedAt = Date.now();
              const replayOperationDetails = {
                ...descriptor.operationDetails,
                batchStrategy: "COLLISION_SERIAL_FALLBACK",
                operationIndex: descriptor.batchIndex + 1,
              };
              const response = await requestValidatedPatches({
                gateway: this.gateway,
                task: descriptor.batchTask,
                context: replayContext,
                candidate,
                writePaths,
                previousValidationIssue,
                timeoutMs: modelTimeoutMs,
              });
              const replayMs = elapsed(replayStartedAt);
              timings.modelMs = Number(timings.modelMs ?? 0) + replayMs;
              await reportProgress(onProgress, "MODEL_RESPONSE", { ...replayOperationDetails, durationMs: replayMs });
              await applyBatchResponse({
                ...descriptor,
                response,
                contextMs: replayContextMs,
                operationDetails: replayOperationDetails,
              });
            }
            continue;
          }
          timings.modelMs = Number(timings.modelMs ?? 0) + Math.max(
            0,
            ...waveResults.map(({ modelMs }) => modelMs),
          );
          for (const result of waveResults.sort((left, right) => left.batchIndex - right.batchIndex))
            await applyBatchResponse(result);
        }
        storyCoverage = orderedStoryCoverage(coverage, normalizedTask.stories);
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
          validation = failedValidation(finalEvidenceIssue, {
            validationCommand: "candidate evidence gate",
            validationCategory: "STORY_EVIDENCE_FAILED",
          });
          previousValidationIssue = finalEvidenceIssue;
          if (evidenceRepairAttempts < maxCandidateEvidenceRepairAttempts) {
            evidenceRepairAttempts += 1;
            requestedStories = storiesForValidationIssue(
              finalEvidenceIssue,
              normalizedTask.stories,
              storyCoverage,
            );
            validationAttempt -= 1;
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
        let previousSemanticFindingSignature = null;
        let nextVerificationStoryKeys = null;
        for (
          let verificationRound = 0;
          candidateVerifiers.length &&
            normalizedTask.stories.length &&
            verificationRound <= maxCandidateRepairRounds;
          verificationRound += 1
        ) {
          const verificationTask = nextVerificationStoryKeys
            ? { ...normalizedTask, stories: normalizedTask.stories.filter((story) => nextVerificationStoryKeys.has(story.key)) }
            : normalizedTask;
          const deterministicVerification = await verifyDeterministicCandidateSemantics({
            source,
            candidate,
            task: verificationTask,
            storyCoverage,
          });
          const verifierContextStartedAt = Date.now();
          const verifierEvidencePaths = new Set([
            ...touchedPaths,
            ...storyCoverage.flatMap((entry) => [
              ...entry.implementationPaths,
              ...entry.testPaths,
            ]),
          ]);
          const verifierPriorityPaths = repairIntegrationPriorityPaths(
            contextCatalog,
            verificationTask,
            verifierEvidencePaths,
          );
          const verifierContext = await collectContext(
            candidate,
            contextCatalog,
            verificationTask,
            verifierPriorityPaths,
          );
          timings.contextMs = Number(timings.contextMs ?? 0) + elapsed(verifierContextStartedAt);
          const verifierStartedAt = Date.now();
          const verificationDetails = {
            activity: "SEMANTIC_VERIFICATION",
            operationIndex: verificationRound + 1,
            operationCount: maxCandidateRepairRounds + 1,
            storyKeys: verificationTask.stories.map((story) => story.key),
          };
          let verification = deterministicVerification;
          if (deterministicVerification.passed) {
            await reportProgress(onProgress, "MODEL_REQUEST", verificationDetails);
            verification = await runCandidateVerifiers({
              verifiers: candidateVerifiers,
              task: verificationTask,
              context: verifierContext,
              storyCoverage,
              touchedPaths,
              timeoutMs: modelTimeoutMs,
            });
            timings.modelMs = Number(timings.modelMs ?? 0) + elapsed(verifierStartedAt);
            await reportProgress(onProgress, "MODEL_RESPONSE", {
              ...verificationDetails,
              durationMs: elapsed(verifierStartedAt),
            });
          }
          if (verification.passed) break;

          const findingSignature = semanticFindingSignature(verification.findings);
          if (findingSignature === previousSemanticFindingSignature) {
            candidateBlocked = true;
            break;
          }
          previousSemanticFindingSignature = findingSignature;

          const verificationIssue = semanticVerificationIssue(verification);
          validation = failedValidation(verificationIssue, {
            validationCommand: "candidate semantic verifier",
            validationCategory: "SEMANTIC_VERIFICATION_FAILED",
          });
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
          nextVerificationStoryKeys = verificationStoryKeysAfterRepair(normalizedTask.stories, storyCoverage, failedStoryKeys);
          const repairStories = normalizedTask.stories.filter((story) =>
            failedStoryKeys.has(story.key),
          );
          // Split only an owner-heavy repair. Small related repairs retain
          // affinity batching; a page + workflow + action + report repair is
          // partitioned before it can exceed the hard 12-patch response cap.
          const repairOwnerTargets = semanticRepairOwnerPaths(
            contextCatalog,
            { ...normalizedTask, stories: repairStories },
            verification.findings.filter((finding) => failedStoryKeys.has(finding.storyKey)),
          );
          const repairOwnerCount = Object.values(repairOwnerTargets)
            .reduce((count, paths) => count + paths.length, 0);
          const repairBatches = repairOwnerCount > 4
            ? ownerBudgetedRepairBatches(normalizedTask, repairStories, repairOwnerTargets)
            : storyBatchTasks({ ...normalizedTask, stories: repairStories });
          const repairDescriptors = repairBatches.map((repairTask, batchIndex) => {
            const repairStoryKeys = new Set(repairTask.stories.map((story) => story.key));
            const repairFindings = verification.findings.filter((finding) => repairStoryKeys.has(finding.storyKey));
            const repairEvidencePaths = new Set([
              ...repairFindings.flatMap((finding) => finding.evidencePaths),
              ...storyCoverage.filter((entry) => repairStoryKeys.has(entry.storyKey)).flatMap((entry) => [
                ...entry.implementationPaths, ...entry.testPaths,
              ]),
            ]);
            const mandatoryOwnerPaths = semanticRepairOwnerPaths(
              contextCatalog,
              repairTask,
              repairFindings,
            );
            const repairContextTaskValue = repairContextTask(
              repairTask,
              repairFindings,
              mandatoryOwnerPaths,
            );
            return {
              batchIndex,
              repairTask,
              repairStoryKeys,
              repairFindings,
              repairContextTaskValue,
              repairPriorityPaths: repairIntegrationPriorityPaths(contextCatalog, repairContextTaskValue, new Set([...repairEvidencePaths, ...Object.values(mandatoryOwnerPaths).flat()])),
              ownerPaths: implementationOwnerPaths(contextCatalog, repairContextTaskValue),
            };
          });
          // Repair prompts are allowed to modify shared domain files even when
          // their initially inferred owners differ. Run them transactionally in
          // order; initial implementation remains safely parallelized, while a
          // semantic repair can never end in an overlapping-write collision.
          for (const wave of implementationBatchWaves(repairDescriptors, false)) {
            const preparedWave = await Promise.all(wave.map(async (descriptor) => {
              const contextStartedAt = Date.now();
              const context = await collectContext(candidate, contextCatalog, descriptor.repairContextTaskValue, descriptor.repairPriorityPaths);
              return { ...descriptor, context, contextMs: elapsed(contextStartedAt) };
            }));
            timings.contextMs = Number(timings.contextMs ?? 0) + preparedWave.reduce((total, descriptor) => total + descriptor.contextMs, 0);
            const results = await Promise.all(preparedWave.sort((left, right) => left.batchIndex - right.batchIndex).map(async (descriptor) => {
              const startedAt = Date.now();
              const repairDetails = {
                activity: "SEMANTIC_REPAIR",
                batchStrategy: wave.length > 1 ? "AFFINITY_CAPACITY_CONCURRENT" : "AFFINITY_CAPACITY",
                operationIndex: descriptor.batchIndex + 1,
                operationCount: repairBatches.length,
                repairRound: verificationRound + 1,
                storyKeys: descriptor.repairTask.stories.map((story) => story.key),
              };
              await reportProgress(onProgress, "MODEL_REQUEST", repairDetails);
              const response = await requestValidatedPatches({
                gateway: this.gateway, task: descriptor.repairContextTaskValue, context: descriptor.context,
                candidate, writePaths,
                acceptedStoryCoverage: storyCoverage.filter((entry) => descriptor.repairStoryKeys.has(entry.storyKey)),
                previousValidationIssue: verifierIssueForFindings(descriptor.repairFindings), timeoutMs: modelTimeoutMs,
              });
              const durationMs = elapsed(startedAt);
              await reportProgress(onProgress, "MODEL_RESPONSE", { ...repairDetails, durationMs });
              return { ...descriptor, response, repairDetails, durationMs };
            }));
            assertDisjointBatchResponses(results);
            timings.modelMs = Number(timings.modelMs ?? 0) + results.reduce((total, result) => total + result.durationMs, 0);
            for (const result of results.sort((left, right) => left.batchIndex - right.batchIndex)) {
              completions.push(result.response.completion);
              featureSpotlight ??= result.response.featureSpotlight;
              const patchStartedAt = Date.now();
              const previousTestContent = await readCandidateFiles(candidate, result.response.storyCoverage.flatMap((entry) => entry.testPaths));
              for (const patch of result.response.patches) {
                await writeMaterializedPatch(candidate, patch);
                touchedPaths.add(patch.path);
                contextCatalog.set(patch.path, true);
                executionState.lastTouchedPaths = new Set(touchedPaths);
              }
              for (const repairedCoverage of result.response.storyCoverage) mergeStoryCoverage(coverage, [repairedCoverage]);
              await captureStoryEvidence(candidate, result.response.storyCoverage, previousTestContent, storyEvidence);
              const durationMs = elapsed(patchStartedAt);
              timings.patchMs = Number(timings.patchMs ?? 0) + durationMs;
              await reportProgress(onProgress, "PATCH_APPLIED", { ...result.repairDetails, durationMs, patchCount: result.response.patches.length });
            }
          }
          storyCoverage = orderedStoryCoverage(coverage, normalizedTask.stories);
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
            validation = failedValidation(repairEvidenceIssue, {
              validationCommand: "candidate evidence gate",
              validationCategory: "STORY_EVIDENCE_FAILED",
            });
            candidateBlocked = true;
            break;
          }
        }
        if (candidateBlocked) break;
        completion = combinedCompletion(completions);

        const validationStartedAt = Date.now();
        await reportProgress(onProgress, "VALIDATION", {
          activity: "EXECUTABLE_VALIDATION",
          operationIndex: validationAttempt,
          operationCount: maxCandidateValidationAttempts,
          commandCount: normalizedTask.allowedCommands.length,
        });
        validation = await this.validate({
          cwd: candidate,
          allowedCommands: normalizedTask.allowedCommands,
          timeoutMs,
        });
        timings.validationMs = Number(timings.validationMs ?? 0) + elapsed(validationStartedAt);
        await reportProgress(onProgress, "VALIDATION_RESULT", {
          activity: "EXECUTABLE_VALIDATION",
          operationIndex: validationAttempt,
          operationCount: maxCandidateValidationAttempts,
          durationMs: elapsed(validationStartedAt),
          exitCode: validation.code,
          timedOut: Boolean(validation.timedOut),
        });
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
            validationCommand:
              validation.validationCommand ?? normalizedTask.allowedCommands[0],
            validationCategory: validation.validationCategory ?? (validation.timedOut
              ? "TIMED_OUT"
              : validation.signal
                ? "SIGNALED"
                : "CHECK_FAILED"),
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
        provisionalExternalContracts: normalizedTask.provisionalExternalContracts ?? Object.freeze([]),
        timings: finalizedTimings(timings, startedAt),
      });
    } catch (error) {
      if (error && typeof error === "object")
        error.executionTimings = finalizedTimings(timings, startedAt);
      throw error;
    }
  }
}

async function reportProgress(onProgress, phase, details = {}) {
  if (typeof onProgress === "function") await onProgress(phase, details);
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

function boundedModelRequestTimeout(timeoutMs) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) return maxModelRequestTimeoutMs;
  return Math.min(timeoutMs, maxModelRequestTimeoutMs);
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
    if (index >= 0) target.splice(index, 1, Object.freeze({
      storyKey: entry.storyKey,
      implementationPaths: Object.freeze([
        ...new Set([
          ...target[index].implementationPaths,
          ...entry.implementationPaths,
        ]),
      ]),
      testPaths: Object.freeze([
        ...new Set([
          ...target[index].testPaths,
          ...entry.testPaths,
        ]),
      ]),
    }));
    else target.push(entry);
  }
}

function orderedStoryCoverage(coverage, stories) {
  const storyOrder = new Map(stories.map((story, index) => [story.key, index]));
  return Object.freeze([...coverage].sort((left, right) =>
    (storyOrder.get(left.storyKey) ?? Number.MAX_SAFE_INTEGER) -
    (storyOrder.get(right.storyKey) ?? Number.MAX_SAFE_INTEGER)
  ));
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

function verificationStoryKeysAfterRepair(stories, coverage, repairedKeys) {
  const repairedPaths = new Set(coverage.filter((entry) => repairedKeys.has(entry.storyKey)).flatMap((entry) => entry.implementationPaths));
  return new Set(stories.filter((story) => {
    if (repairedKeys.has(story.key)) return true;
    const entry = coverage.find((candidate) => candidate.storyKey === story.key);
    return entry?.implementationPaths.some((path) => repairedPaths.has(path));
  }).map((story) => story.key));
}

function repairContextTask(task, findings, mandatoryOwnerPaths = {}) {
  return {
    ...task,
    mandatoryOwnerPaths,
    objective: [
      task.objective,
      ...findings.flatMap((finding) => [
        finding.message,
        repairDirectiveForFinding(finding),
      ]),
    ].filter(Boolean).join(" "),
  };
}

function semanticRepairOwnerPaths(contextCatalog, task, findings) {
  const available = [...contextCatalog.keys()].filter((path) => !isTestPath(path));
  // A file's directory is not evidence that it owns a route.  Feature leaf
  // components are often colocated under src/pages; choosing one of those for
  // a reachability repair creates an attractive but invalid helper-only fix.
  // Restrict this class of repair to files that are plausible application
  // owners and prefer names that conventionally identify a routed surface.
  const isFrontendRouteOwner = (path) => {
    if (!/(?:^|\/)frontend\/src\/(?:pages?|routes?)\//i.test(path)) return false;
    const basename = path.split("/").at(-1)?.replace(/\.[^.]+$/, "") ?? "";
    return /(?:page|route|workflow|onboard|tenant|detail|dashboard|report)/i.test(basename) &&
      !/(?:status|card|panel|widget|component|view|display)$/i.test(basename);
  };
  const pathsFor = (pattern, limit = 2) => available
    .filter((path) => pattern.test(path))
    .sort((left, right) =>
      contextPathScore(right, contextSearchTerms(task)) - contextPathScore(left, contextSearchTerms(task)) ||
      left.localeCompare(right),
    )
    .slice(0, limit);
  const required = {};
  for (const finding of findings) {
    const text = `${finding.code} ${finding.message}`.toLowerCase();
    const add = (paths) => {
      const current = new Set(required[finding.storyKey] ?? []);
      for (const path of paths) current.add(path);
      required[finding.storyKey] = [...current];
    };
    if (/ui|frontend|reachab|render/.test(text)) {
      const routeOwners = available
        .filter(isFrontendRouteOwner)
        .sort((left, right) =>
          contextPathScore(right, contextSearchTerms(task)) - contextPathScore(left, contextSearchTerms(task)) ||
          left.localeCompare(right),
        )
        .slice(0, 1);
      // Do not silently fall back to a leaf component. If no real route owner
      // is in the supplied context, omit the forced path and let the normal
      // coverage diagnostic request an owner instead of generating a fake one.
      add(routeOwners);
    }
    // A funding view is only reachable when the routed page *and* the surface
    // it renders change together. This prevents a repeated leaf-component
    // repair from being accepted as page wiring.
    if (/onboarding.*funding.*ui|funding.*ui.*unreach|unreachable.*funding.*ui/.test(text)) {
      add(pathsFor(/frontend\/src\/pages\/TenantDetails\.jsx$/i, 1));
      add(pathsFor(/frontend\/src\/components\/tenantDetails\/IntegrationReadiness\.jsx$/i, 1));
      add(pathsFor(/api\/routes\/v1\/entity\/knowledgegraph(?:_service)?\.py$/i, 2));
    }
    if (/extract|funding.*validation|authoritative|stale.*funding|workflow/.test(text))
      add(pathsFor(/tenant_workflow_rules\/(?:handler|account_discovery|funding_validation)\.py$/i, 3));
    // Financial-contract findings require the real extracted-account caller
    // and adapter boundary together; mocking the adapter alone is not proof.
    if (/financial.*api.*contract|contract.*unverified|extracted.*account.*financial/.test(text))
      add(pathsFor(/tenant_workflow_rules\/(?:account_discovery|funding_validation|handler)\.py$/i, 3));
    if (/projection|funding.*read|route|api response|page-loading|client request/.test(text))
      add(pathsFor(/api\/routes\/v1\/entity\/(?:knowledgegraph(?:_service)?|reports)\.py$/i, 2));
    if (/follow.?up|action|notification/.test(text))
      add(pathsFor(/tenant_action\/(?:account_field_log|handler|action_writer)\.py$/i, 2));
    if (/sbl|tooling|guard/.test(text))
      add(pathsFor(/lambda\/sbl\/.*\/handler\.py$/i, 2));
    if (/report|historical|dashboard/.test(text))
      add(pathsFor(/api\/routes\/.*\/reports?\.py$/i, 1));
  }
  return required;
}

function ownerBudgetedRepairBatches(task, stories, ownerTargets, maxOwners = 4) {
  const batches = [];
  let current = [];
  let currentWeight = 0;
  const flush = () => {
    if (current.length) batches.push({ ...task, stories: current });
    current = [];
    currentWeight = 0;
  };
  for (const story of stories) {
    // A concrete owner usually needs both production and behavioral-test edits.
    // Four owners therefore stays comfortably inside the twelve-patch contract
    // while avoiding the one-story-per-request slowdown.
    const weight = Math.max(1, new Set(ownerTargets[story.key] ?? []).size);
    if (current.length && currentWeight + weight > maxOwners) flush();
    current.push(story);
    currentWeight += weight;
    if (currentWeight >= maxOwners) flush();
  }
  flush();
  return batches;
}

function repairDirectiveForFinding(finding) {
  const text = `${finding.code} ${finding.message}`.toLowerCase();
  if (/test_not_behavioral|source text|syntax without exercising|parse[sd]? the file/.test(text))
      return `Repair directive: replace the non-behavioral test at ${finding.evidencePaths.filter(isTestPath).join(", ") || "the cited test path"}. The replacement must import and invoke the named public production owner with mocked infrastructure boundaries, then assert its observable blocked result or absence of downstream writes. Reading source text, parsing syntax/ASTs, extracting a helper, or asserting substrings is prohibited.`;
  if (/projection|unreachable.*funding.*read|unused.*sbl.*guard|historical.*ui.*unverified/.test(text))
    return `Repair directive: patch the named production owner chain end to end. A projection must be invoked by a registered API route and consumed by the routed page's client-loading path; do not inject its value as a test prop. A guard must be called by each named public lambda_handler before any downstream read or write, and each handler must be invoked in its own behavioral test. A historical report must be rendered and asserted in the reachable page/component test.`;
  if (/reachab|routed|rendered|owner/.test(text))
    return "Repair directive: patch and test the reachable routed owner itself, including its real data-loading path; a direct leaf/helper render or synthetic wrapper is not acceptance evidence.";
  if (/workflow|handler|invok|caller|unreachable|guard/.test(text))
    return `Repair directive: trace the exact caller payload through the public handler before every early guard, and add a regression that invokes that public handler with the caller-shaped event. For a finding that names multiple implementation owners, close and integration-test every named owner; testing a shared helper alone is insufficient. Named evidence paths: ${finding.evidencePaths.join(", ")}.`;
  return "Repair directive: add an owner-level regression that reproduces the exact reported failure before changing the implementation.";
}

function repairIntegrationPriorityPaths(contextCatalog, task, evidencePaths) {
  const evidenceDirectories = [...evidencePaths].map((path) => dirname(path).split("/"));
  const integrationPathPattern = /(?:^|\/)(?:app|config|handlers?|index|pages?|routes?|services?|workflows?)(?:[/.]|$)/i;
  const ownerPaths = task.stories.flatMap((story) =>
    requiredStoryOwnerRequirements(story).flatMap((requirement) =>
      [...contextCatalog.keys()]
        .filter((path) => requirement.pathPattern.test(path) && !isTestPath(path))
        .sort((left, right) =>
          contextPathScore(right, contextSearchTerms({ ...task, stories: [story] })) -
            contextPathScore(left, contextSearchTerms({ ...task, stories: [story] })) ||
          left.localeCompare(right)
        )
        .slice(0, 2)
    )
  );
  const candidates = [...contextCatalog.keys()]
    .filter((path) => !evidencePaths.has(path))
    .map((path) => {
      const pathParts = dirname(path).split("/");
      const sharedDepth = evidenceDirectories.reduce((best, evidenceParts) => {
        let depth = 0;
        while (depth < pathParts.length && pathParts[depth] === evidenceParts[depth]) depth += 1;
        return Math.max(best, depth);
      }, 0);
      const score = contextPathScore(path, contextSearchTerms(task)) +
        sharedDepth * 12 +
        (integrationPathPattern.test(path) ? 20 : 0) -
        (isTestPath(path) ? 24 : 0);
      return { path, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, 12)
    .map(({ path }) => path);
  return new Set([...evidencePaths, ...ownerPaths, ...candidates]);
}

function implementationOwnerPaths(contextCatalog, task) {
  return new Set(task.stories.flatMap((story) =>
    requiredStoryOwnerRequirements(story).flatMap((requirement) =>
      [...contextCatalog.keys()]
        .filter((path) => requirement.pathPattern.test(path) && !isTestPath(path))
        .sort((left, right) => left.localeCompare(right))
        .slice(0, 2)
    )
  ));
}

function implementationBatchWaves(descriptors, allowConcurrency = true) {
  if (!allowConcurrency) return descriptors.map((descriptor) => [descriptor]);
  const remaining = [...descriptors];
  const waves = [];
  while (remaining.length) {
    const wave = [remaining.shift()];
    while (remaining.length && wave.length < maxConcurrentImplementationBatches) {
      const candidate = remaining[0];
      const independent = candidate.ownerPaths.size > 0 && wave.every((descriptor) =>
        descriptor.ownerPaths.size > 0 && setsAreDisjoint(descriptor.ownerPaths, candidate.ownerPaths)
      );
      if (!independent) break;
      wave.push(remaining.shift());
    }
    waves.push(wave);
  }
  return waves;
}

function setsAreDisjoint(left, right) {
  for (const value of left) if (right.has(value)) return false;
  return true;
}

function batchResponseCollisionPaths(results) {
  if (results.length < 2) return [];
  const owners = new Map();
  const collisions = new Set();
  for (const result of results) {
    for (const patch of result.response.patches) {
      if (owners.has(patch.path))
        collisions.add(patch.path);
      owners.set(patch.path, result.batchIndex);
    }
  }
  return [...collisions].sort();
}

// Semantic-repair batches are intentionally serialized. Retain this guard for
// that path so an accidental future parallelization cannot silently overwrite
// a repair, while initial implementation batches use the replay fallback.
function assertDisjointBatchResponses(results) {
  const collisionPaths = batchResponseCollisionPaths(results);
  if (collisionPaths.length)
    throw new ChangeCaseError(
      "MODEL_PATCH_BATCH_PATH_COLLISION",
      "Concurrent semantic-repair batches selected the same patch path; no candidate files were written.",
      { severity: "warning", details: { collisionPath: collisionPaths[0] } },
    );
}

async function verifyDeterministicCandidateSemantics({ source, candidate, task, storyCoverage }) {
  const findings = [];
  for (const story of task.stories) {
    const coverage = storyCoverage.find((entry) => entry.storyKey === story.key);
    if (!coverage) continue;
    const existingImplementationPaths = [];
    for (const path of coverage.implementationPaths) {
      if (await lstat(join(source, path)).catch(() => null)) existingImplementationPaths.push(path);
    }
    if (!existingImplementationPaths.length) {
      findings.push(Object.freeze({
        storyKey: story.key,
        code: "IMPLEMENTATION_NOT_REACHABLE",
        message: "The story changes only newly created implementation files and does not patch a pre-existing production owner.",
        evidencePaths: Object.freeze([...coverage.implementationPaths]),
      }));
      continue;
    }

    const sourceInspectionTests = [];
    for (const path of coverage.testPaths) {
      const content = await readFile(join(candidate, path), "utf8").catch(() => "");
      if (
        /\b(?:readFile|readFileSync|parse|ast|sourceText)\b/.test(content) &&
        /\b(?:includes|match|regex|source|syntax|text)\b/i.test(content)
      ) sourceInspectionTests.push(path);
    }
    if (sourceInspectionTests.length === coverage.testPaths.length) {
      findings.push(Object.freeze({
        storyKey: story.key,
        code: "TEST_NOT_BEHAVIORAL",
        message: "The supplied tests inspect source text or syntax without exercising the owning runtime behavior.",
        evidencePaths: Object.freeze(sourceInspectionTests),
      }));
    }
  }
  return Object.freeze({
    passed: findings.length === 0,
    findings: Object.freeze(findings.slice(0, maxSemanticFindings)),
  });
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
  for (let index = 0; index < task.stories.length; index += maxAffinityPartitionStories) {
    const storyWindow = task.stories.slice(index, index + maxAffinityPartitionStories);
    for (const stories of partitionStoriesByAffinity(storyWindow)) batches.push(Object.freeze({
      ...task,
      stories: Object.freeze(stories),
    }));
  }
  return Object.freeze(batches);
}

function partitionStoriesByAffinity(stories) {
  const batchCapacity = storyBatchCapacity(stories);
  if (stories.length <= batchCapacity) return Object.freeze([Object.freeze([...stories])]);
  const termSets = stories.map((story) => new Set(contextSearchTerms({ objective: "", stories: [story] })));
  const documentFrequency = new Map();
  for (const terms of termSets)
    for (const term of terms) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  const affinity = termSets.map((_, leftIndex) => termSets.map((__, rightIndex) =>
    leftIndex === rightIndex
      ? 0
      : storyTermAffinity(
          termSets[leftIndex],
          termSets[rightIndex],
          documentFrequency,
          stories.length,
          Math.abs(leftIndex - rightIndex),
        )
  ));
  const minimumBatchCount = Math.ceil(stories.length / batchCapacity);
  const fullMask = (1 << stories.length) - 1;
  const memo = new Map();

  function solve(mask, batchesRemaining) {
    if (!mask) return batchesRemaining === 0 ? { score: 0, groups: [] } : null;
    if (!batchesRemaining) return null;
    const storyCount = countBits(mask);
    if (storyCount < batchesRemaining || storyCount > batchesRemaining * batchCapacity) return null;
    const key = `${mask}:${batchesRemaining}`;
    if (memo.has(key)) return memo.get(key);
    const firstIndex = firstSetBit(mask);
    const available = [];
    for (let candidateIndex = firstIndex + 1; candidateIndex < stories.length; candidateIndex += 1)
      if (mask & (1 << candidateIndex)) available.push(candidateIndex);
    let best = null;
    for (let groupSize = 1; groupSize <= batchCapacity; groupSize += 1) {
      for (const tail of combinations(available, groupSize - 1)) {
        const group = [firstIndex, ...tail];
        if (
          group.length > 1 &&
          group.reduce(
            (count, storyIndex) =>
              count + requiredStoryOwnerRequirements(stories[storyIndex]).length,
            0,
          ) > maxOwnerRequirementsPerBatch
        )
          continue;
        const groupMask = group.reduce((value, storyIndex) => value | (1 << storyIndex), 0);
        const remainder = solve(mask ^ groupMask, batchesRemaining - 1);
        if (!remainder) continue;
        const candidate = {
          score: storyGroupAffinity(group, affinity) + remainder.score,
          groups: [group, ...remainder.groups],
        };
        if (!best || candidate.score > best.score + Number.EPSILON ||
          (Math.abs(candidate.score - best.score) <= Number.EPSILON &&
            storyGroupSignature(candidate.groups) < storyGroupSignature(best.groups)))
          best = candidate;
      }
    }
    memo.set(key, best);
    return best;
  }

  let partition = null;
  for (
    let batchCount = minimumBatchCount;
    batchCount <= stories.length && !partition;
    batchCount += 1
  )
    partition = solve(fullMask, batchCount);
  return Object.freeze((partition?.groups ?? []).map((group) =>
    Object.freeze(group.map((storyIndex) => stories[storyIndex]))
  ));
}

function storyBatchCapacity(stories) {
  const ownerDomains = new Set(stories.flatMap(storyOwnerDomains));
  return stories.length >= 4 && ownerDomains.size >= 4 ? 2 : maxStoriesPerBatch;
}

function storyOwnerDomains(story) {
  const text = [
    story.title,
    story.narrative,
    ...story.scenarios.flatMap((scenario) => [scenario.given, scenario.when, scenario.then]),
  ].join(" ").toLowerCase();
  const domains = [];
  const patterns = [
    ["USER_INTERFACE", /\b(?:page|screen|view|visible|visibility|render|display|frontend|onboarding)\b/],
    ["DATA_API", /\b(?:api|extract|extracted|validate|validation|financial|source data)\b/],
    ["ACTION_PERSISTENCE", /\b(?:action|follow[ -]?up|record|persist|capture)\b/],
    ["NOTIFICATION", /\b(?:notify|notification|email|recipient|operations)\b/],
    ["REPORTING", /\b(?:report|reporting|historical|history|dashboard)\b/],
    ["ENFORCEMENT", /\b(?:block|blocked|reject|deny|enforce|sbl|tooling)\b/],
  ];
  for (const [domain, pattern] of patterns) if (pattern.test(text)) domains.push(domain);
  return domains;
}

function storyTermAffinity(leftTerms, rightTerms, documentFrequency, storyCount, distance) {
  const union = new Set([...leftTerms, ...rightTerms]);
  let sharedWeight = 0;
  let unionWeight = 0;
  for (const term of union) {
    const weight = 1 + Math.log2((storyCount + 1) / ((documentFrequency.get(term) ?? 0) + 1));
    unionWeight += weight;
    if (leftTerms.has(term) && rightTerms.has(term)) sharedWeight += weight;
  }
  const semanticAffinity = unionWeight ? sharedWeight / unionWeight : 0;
  return semanticAffinity + 0.001 / (distance + 1);
}

function storyGroupAffinity(group, affinity) {
  let score = 0;
  for (let left = 0; left < group.length; left += 1)
    for (let right = left + 1; right < group.length; right += 1)
      score += affinity[group[left]][group[right]];
  return score;
}

function combinations(values, size, start = 0, selected = []) {
  if (selected.length === size) return [selected];
  const combinationsFound = [];
  for (let index = start; index <= values.length - (size - selected.length); index += 1)
    combinationsFound.push(...combinations(values, size, index + 1, [...selected, values[index]]));
  return combinationsFound;
}

function countBits(value) {
  let count = 0;
  for (let remaining = value; remaining; remaining &= remaining - 1) count += 1;
  return count;
}

function firstSetBit(mask) {
  for (let index = 0; index < 31; index += 1) if (mask & (1 << index)) return index;
  return -1;
}

function storyGroupSignature(groups) {
  return groups.map((group) => group.join(",")).join("|");
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

async function assertRepositoryCapabilities(root, contextCatalog, task) {
  const taskText = taskSearchText(task);
  const requiredApis = [
    ...new Set(
      taskText.match(/\b(?:[A-Z][A-Za-z0-9'-]*\s+){1,6}API\b/g) ?? [],
    ),
  ];
  if (!requiredApis.length) return Object.freeze([]);

  const unresolved = [];
  for (const capability of requiredApis) {
    if (await repositoryContainsCapability(root, contextCatalog, capability)) continue;
    const missingContract = missingExternalContractFields(taskText);
    if (!missingContract.length) continue;
    unresolved.push({ capability, missingContract });
  }
  // Missing contracts are provisional inputs, not a reason to abandon an
  // otherwise useful implementation candidate. They remain explicit retained
  // warnings and must never be mistaken for a verified live integration.
  return Object.freeze(unresolved.map(({ capability, missingContract }) =>
    Object.freeze({
      capability,
      missingContract: Object.freeze([...missingContract]),
      status: "PROVISIONAL_DEVELOPER_ACTION_REQUIRED",
      warning: `Provisional contract created for ${capability}. A developer must replace it with the authoritative endpoint, authentication, response mapping, and failure semantics before release.`,
    })
  ));
}

function taskSearchText(task) {
  return [
    task.objective,
    ...task.stories.flatMap((story) => [
      story.title,
      story.narrative,
      ...story.scenarios.flatMap((scenario) => [
        scenario.given,
        scenario.when,
        scenario.then,
      ]),
    ]),
  ].join("\n");
}

async function repositoryContainsCapability(root, contextCatalog, capability) {
  const needle = normalizedCapabilityText(capability);
  const source = [];
  for (const path of contextCatalog.keys()) {
    if (normalizedCapabilityText(path).includes(needle)) return true;
    const content = await readFile(join(root, path), "utf8").catch(() => null);
    if (content === null || content.includes("\u0000")) continue;
    if (normalizedCapabilityText(content).includes(needle)) return true;
    source.push({ path, content: normalizedCapabilityText(content) });
  }
  return repositoryContainsCompatibleNamedApi(source, capability);
}

function normalizedCapabilityText(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function repositoryContainsCompatibleNamedApi(source, capability) {
  // Feature language often adds a business qualifier (for example,
  // "Account Manager Financial API") to an already-configured integration
  // named "Account Manager" in source. Permit that only when the stable
  // two-word identity is present and the repository itself proves endpoint,
  // authentication, and response handling. A single keyword is never enough.
  const ignored = new Set(["api", "service", "system", "data", "status"]);
  const terms = normalizedCapabilityText(capability)
    .split(" ")
    .filter((term) => term && !ignored.has(term));
  const identity = terms.slice(0, 2).join(" ");
  if (identity.split(" ").length < 2) return false;

  const integrationSources = source.filter(({ path, content }) =>
    normalizedCapabilityText(path).includes(identity) || content.includes(identity),
  );
  if (!integrationSources.length) return false;

  const repositoryText = source.map(({ path, content }) => `${path}\n${content}`).join("\n");
  return Boolean(
    /https? |endpoint|base api url/.test(repositoryText) &&
      /auth|oauth|token|credential|client secret/.test(repositoryText) &&
      /response|payload|schema|mapping/.test(repositoryText),
  );
}

function missingExternalContractFields(taskText) {
  const missing = [];
  if (!/https?:\/\/|\bendpoint\b|\bbase[ _-]?url\b/i.test(taskText))
    missing.push("endpoint");
  if (!/\bauth(?:entication|orization)?\b|\boauth\b|\btoken\b|\bcredential/i.test(taskText))
    missing.push("authentication");
  if (!/\bresponse\b|\bschema\b|\bpayload\b|\bmapping\b/i.test(taskText))
    missing.push("responseContract");
  return missing;
}

async function collectContext(root, contextCatalog, task, priorityPaths = new Set()) {
  let bytes = 0;
  const files = [];
  const priorityFileLimit = Math.max(
    1024,
    Math.min(
      maxPriorityFileBytes,
      Math.floor((maxContextBytes * 0.9) / Math.max(1, priorityPaths.size)),
    ),
  );
  const priorityOrder = new Map(
    [...priorityPaths].map((path, index) => [path, index]),
  );
  const rankedPaths = rankContextPaths(contextCatalog, task).sort((left, right) => {
    const priorityDifference =
      Number(priorityPaths.has(right[0])) - Number(priorityPaths.has(left[0]));
    if (priorityDifference) return priorityDifference;
    if (priorityPaths.has(left[0]))
      return priorityOrder.get(left[0]) - priorityOrder.get(right[0]);
    return 0;
  });
  for (const [path, writable] of rankedPaths) {
    const content = await readFile(join(root, path), "utf8").catch(() => null);
    if (content === null || content.includes("\u0000")) continue;
    const contentBytes = Buffer.byteLength(content);
    if (contentBytes > maxInspectableFileBytes) continue;
    const priority = priorityPaths.has(path);
    const fileLimit = priority ? priorityFileLimit : maxFileBytes;
    const truncated = contentBytes > fileLimit;
    const suppliedContent = truncated ? contextExcerpt(content, task, fileLimit) : content;
    const size = Buffer.byteLength(suppliedContent);
    if (bytes + size > maxContextBytes) {
      break;
    }
    bytes += size;
    files.push({
      path,
      content: suppliedContent,
      writable,
      ...(writable ? { existing: true, fullContentSupplied: !truncated } : {}),
      ...(truncated ? { truncated: true } : {}),
    });
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
  // Anchors must be literal source text. One contiguous excerpt prevents the
  // model from joining distant sections across an omission marker.
  let matchedLine = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (terms.some((term) => lines[index].toLowerCase().includes(term))) {
      matchedLine = index;
      break;
    }
  }
  const start = Math.max(0, (matchedLine < 0 ? 0 : matchedLine) - 24);
  const selected = [];
  let usedBytes = 0;
  for (let index = start; index < lines.length; index += 1) {
    const lineBytes = Buffer.byteLength(`${selected.length ? "\n" : ""}${lines[index]}`);
    if (usedBytes + lineBytes > byteLimit) break;
    selected.push(lines[index]);
    usedBytes += lineBytes;
  }
  return selected.join("\n");
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
  acceptedStoryCoverage = [],
) {
  const ownerContext = requiredOwnerContext(task, files, acceptedStoryCoverage);
  const ownerCorrection = focusedOwnerCorrection(ownerContext, previousResponseIssue, previousResponseCorrection);
  const repairDeltaStoryKeys = [...new Set((previousValidationIssue?.verifierFindings ?? [])
    .map((finding) => finding?.storyKey)
    .filter((storyKey) => task.stories.some((story) => story.key === storyKey)))];
  const focusedRepairPaths = focusedRepairFiles(files, ownerContext, acceptedStoryCoverage, previousValidationIssue, repairDeltaStoryKeys).map((file) => file.path);
  return JSON.stringify({
    schema: "adx-model-patch-request-v1",
    objective: task.objective,
    changeDigest: task.changeDigest,
    stories: task.stories,
    provisionalExternalContracts: task.provisionalExternalContracts ?? [],
    acceptedStoryCoverage,
    requiredResponsePatchPaths: task.requiredResponsePatchPaths ?? [],
    requiredOwnerContext: ownerContext,
    ownerCorrection,
    repairDeltaStoryKeys,
    focusedRepairPaths,
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
      `Emit at most ${maxPatches} patches. Combine every change to a shared file into one patch and cite that same path from each applicable storyCoverage entry.`,
      ...(ownerCorrection.length ? [
        "This is an owner-only correction. Retain prior staged patches; patch and cite every exact ownerCorrection.suppliedCandidatePaths target. Do not substitute a new component, generic helper, or a different similarly named file.",
        "For each ownerCorrection entry, its storyCoverage implementationPaths must contain one of its suppliedCandidatePaths exactly. Return the owner patch and an owner-level behavioral test before any optional work.",
      ] : []),
      ...(repairDeltaStoryKeys.length ? [
        `Repair delta required for: ${repairDeltaStoryKeys.join(", ")}. For each listed story, emit at least one new implementation or owner-level test patch that closes its verifier finding. Previously accepted paths may be cited as supporting coverage only; they cannot be the entire repair delta.`,
      ] : []),
      ...(task.requiredResponsePatchPaths?.length ? [
        `Mandatory correction patch paths: ${task.requiredResponsePatchPaths.join(", ")}. This response is invalid unless patches contains every one of these exact paths. Do not substitute a different test file, cite an unpatched path, or spend a patch slot on optional work before these paths are emitted.`,
      ] : []),
      "Modify existing files only when they are supplied with writable:true. You may create a new file under an approved writable root when necessary, especially a domain-local test file. Files marked writable:false are read-only verification context and must never be included in patches.",
      "Every supplied file is annotated existing:true. For an existing file, use minimal exact anchored replacements: set content to null and copy each oldText from one contiguous supplied excerpt so it occurs exactly once. Never return a partial snippet as complete file content.",
      "Anchored replacements are mandatory for files marked truncated:true. Each oldText must be copied from one contiguous supplied excerpt only; an omission marker is explanatory, never source text, and must never appear in oldText. A complete replacement is permitted only for existing:true + fullContentSupplied:true when it retains all unrelated behavior and the complete supplied file; otherwise use anchors. For a new file, provide complete content and an empty replacements array.",
      "Emit each patch path exactly once. When multiple stories change the same file, combine all changes into one patch and reference that shared path from each applicable storyCoverage entry.",
      "Implement every supplied approved story and all of its Given/When/Then scenarios.",
      "For every provisionalExternalContracts entry, create a source-owned adapter boundary that makes the provisional state visible to developers and returns an explicit UNKNOWN result when authoritative data is unavailable. Do not invent an endpoint, credential, response field, or funded/unfunded value. Preserve the retained warning for developer follow-up.",
      "Implement only the stories supplied in this request. Treat them as one coherent feature, reuse shared integration points, and do not anticipate or claim stories that are not present.",
      "Do not collapse stories for distinct workflows into one isolated helper and one direct helper test. When stories require different reachable UI owners, routes, handlers, jobs, notification senders, reports, or enforcement points, patch and integration-test each required owner; a shared helper is supplemental evidence only.",
      "For a batch of three stories, storyCoverage must collectively reference at least two distinct patched implementation paths. Include the shared domain logic and at least one reachable owning page, route, handler, job, report, notification sender, or enforcement point.",
      "For each story in an owner-diverse pair, storyCoverage implementationPaths must include patched files for every explicit boundary in that story: frontend/page visibility, authoritative API or extracted-account data, action persistence, notification delivery, reporting, SBL, and tooling. A generic workflow helper does not satisfy a named boundary.",
      "Treat requiredOwnerContext as a binding implementation contract. For every entry with requiredInThisResponse:true, patch one exact suppliedCandidatePaths production owner and cite it in that story's implementationPaths. Entries with ownerDiscovery:NO_SUPPLIED_PRODUCTION_OWNER are not implementation targets: do not invent a similarly named helper, route, or sender; preserve the existing owner and let a later evidence-backed verifier finding identify it. Entries with requiredInThisResponse:false and acceptedPaths are already accepted and must not be regenerated unless the verifier finding directly requires changing them. One combined owner may satisfy multiple entries when the same supplied path is listed for them.",
      "Satisfy every requiredOwnerContext.acceptanceProof through production code and an owner-level behavioral test. Tests that only read source text, parse an AST, inspect symbols, or invoke an isolated helper are not acceptance evidence.",
      "For every supplied story, include exactly one storyCoverage entry. On initial implementation, implementationPaths and testPaths must refer to files in this patch response. On repair, they may also cite paths in acceptedStoryCoverage, but every repaired story must still cite at least one path newly emitted in this response.",
      "Each testPaths entry must be distinct from implementationPaths and use a recognizable test path: a test/tests/__tests__ directory, test_*.py, *_test.py, *.test.*, or *.spec.*.",
      "Create or extend a test beside the owning implementation or in its established domain test directory. Never repurpose an unrelated test suite merely to satisfy storyCoverage.",
      "Include the exact supplied story key in a test name or assertion message so final accumulated evidence can be verified after later story requests.",
      "When previousValidationIssue reports a reachability, invocation, or data-flow defect, patch the existing application owner that closes that defect and test the owning integration. Cited evidence paths identify the failed evidence; they do not limit which supplied writable files may be patched.",
      "A repair response must close the exact reported defect. Do not return another isolated helper or direct helper test when the finding requires a reachable UI owner, route, handler, job, workflow owner, notification sender, or authoritative data source.",
      "When previousValidationIssue reports a test-runtime or import failure, repair the test harness using existing repository conventions: mock unsupported static assets or modules before importing the owner, define a missing web global with a restorable mock instead of spying on an absent property, and do not change production behavior merely to satisfy the harness.",
      "For Babel/Jest errors saying a jest.mock module factory cannot reference an out-of-scope variable, do not capture test helpers or fixtures in that factory. Use an inline jest.fn(), require values inside the factory when permitted, or declare a stable mock-prefixed variable before the factory according to the repository's Jest transform rules, then assert through the resulting mock.",
      "When a user-visible feature is added, include featureSpotlight and mark its visible root element with data-adx-feature equal to featureSpotlight.featureId. Otherwise set featureSpotlight to null.",
      "Do not add dependencies, run commands, request secrets, create commits, or claim verification.",
    ],
    files,
  });
}

function focusedRepairFiles(files, ownerContext, acceptedCoverage, issue, repairStoryKeys) {
  if (!repairStoryKeys.length) return files;
  const paths = new Set((issue?.verifierFindings ?? []).flatMap((finding) => finding.evidencePaths ?? []));
  for (const owner of ownerContext)
    if (repairStoryKeys.includes(owner.storyKey)) for (const path of owner.suppliedCandidatePaths) paths.add(path);
  for (const entry of acceptedCoverage)
    if (repairStoryKeys.includes(entry.storyKey))
      for (const path of [...entry.implementationPaths, ...entry.testPaths]) paths.add(path);
  const selected = files.filter((file) => paths.has(file.path));
  // Never make a repair blind: retain its complete already-collected context if
  // the precise evidence set is too small to explain an owner-level data flow.
  return selected.length >= 2 ? selected : files;
}

function requiredOwnerContext(task, files, acceptedStoryCoverage = []) {
  const inferred = task.stories.flatMap((story) =>
    requiredStoryOwnerRequirements(story).map((requirement) => {
      const candidates = files
        .filter((file) => !isTestPath(file.path) && isConcreteOwnerCandidate(requirement, file))
        .map((file) => file.path);
      // SBL and tooling are separate production boundaries. Give the model one
      // precise, ranked handler for each instead of a broad interchangeable
      // list that invites it to patch a helper or satisfy both with one path.
      const exactOwner = ["SBL owner", "tooling owner"].includes(requirement.label);
      const suppliedCandidatePaths = rankOwnerCandidates(requirement, candidates)
        .slice(0, exactOwner ? 1 : 4);
      const acceptedPaths = acceptedStoryCoverage
        .find((entry) => entry.storyKey === story.key)
        ?.implementationPaths.filter((path) => suppliedCandidatePaths.includes(path)) ?? [];
      return {
        storyKey: story.key,
        owner: requirement.label,
        acceptanceProof: ownerAcceptanceProof(requirement.label),
        // Never ask the model to satisfy an owner that the repository scan did
        // not actually supply. That creates invented files and a repeat-token
        // repair loop. A later semantic finding can nominate real evidence.
        requiredInThisResponse: acceptedPaths.length === 0 && suppliedCandidatePaths.length > 0,
        acceptedPaths,
        suppliedCandidatePaths,
        ownerDiscovery: suppliedCandidatePaths.length ? "SUPPLIED_PRODUCTION_OWNER" : "NO_SUPPLIED_PRODUCTION_OWNER",
      };
    })
  );
  const mandatory = Object.entries(task.mandatoryOwnerPaths ?? {}).flatMap(([storyKey, paths]) =>
    [...new Set(paths)].filter((path) => files.some((file) => file.path === path)).map((path) => ({
      storyKey,
      owner: "semantic repair production owner",
      acceptanceProof: "Patch this exact production owner and invoke its reachable behavior in an owner-level regression.",
      requiredInThisResponse: true,
      acceptedPaths: [],
      suppliedCandidatePaths: [path],
      ownerDiscovery: "SEMANTIC_FINDING_OWNER",
    })),
  );
  return [...inferred, ...mandatory];
}

function rankOwnerCandidates(requirement, candidates) {
  if (!["frontend/page owner", "report owner", "action persistence owner", "SBL owner", "tooling owner"].includes(requirement.label))
    return [...candidates];
  const score = (path) => {
    const normalized = path.toLowerCase();
    if (requirement.label === "frontend/page owner") {
      if (/\/frontend\/src\/(?:pages?|routes?)\//.test(normalized)) return 100;
      if (/(?:^|\/)(?:pages?|routes?)\//.test(normalized)) return 90;
      if (/\/components?\//.test(normalized)) return 10;
    }
    if (requirement.label === "report owner") {
      if (/\/api\/routes?\/.*\/reports?\.(?:py|m?js|ts)$/.test(normalized)) return 100;
      if (/\/frontend\/src\/(?:pages?|routes?)\//.test(normalized)) return 90;
      if (/\/reports?\.(?:py|m?js|ts)$/.test(normalized)) return 80;
    }
    if (requirement.label === "action persistence owner") {
      if (/\/tenant_action\/handler\.(?:py|m?js|ts)$/.test(normalized)) return 100;
      if (/\/tenant_action\/.*(?:field_log|action_writer)\.(?:py|m?js|ts)$/.test(normalized)) return 90;
    }
    if (requirement.label === "SBL owner") {
      if (/sbl_tenant_service_mapping[^/]*\/handler\./.test(normalized)) return 100;
      if (/\/sbl\/.*\/handler\./.test(normalized)) return 80;
    }
    if (requirement.label === "tooling owner") {
      if (/sbl_service_account_request_daily\/handler\./.test(normalized)) return 100;
      if (/\/tooling\/.*\/handler\./.test(normalized)) return 95;
      if (/\/sbl\/.*\/handler\./.test(normalized)) return 70;
    }
    return 0;
  };
  return candidates
    .map((path, index) => ({ path, index }))
    .sort((left, right) => score(right.path) - score(left.path) || left.index - right.index)
    .map(({ path }) => path);
}

function focusedOwnerCorrection(ownerContext, issue, correction) {
  if (issue !== "STORY_COVERAGE_OWNER_MISSING") return Object.freeze([]);
  const text = String(correction ?? "");
  return Object.freeze(ownerContext.filter((owner) =>
    owner.requiredInThisResponse &&
    owner.suppliedCandidatePaths.length &&
    text.includes(`${owner.storyKey}:${owner.owner}`)
  ).map((owner) => Object.freeze({
    storyKey: owner.storyKey,
    owner: owner.owner,
    // A correction must be executable, not another choice set. The ranking
    // already puts a reachable production page/route/handler first.
    suppliedCandidatePaths: [owner.suppliedCandidatePaths[0]],
    acceptanceProof: owner.acceptanceProof,
  })));
}

function isConcreteOwnerCandidate(requirement, file) {
  if (requirement.label === "SBL owner" || requirement.label === "tooling owner") {
    const path = file.path.toLowerCase();
    if (/\/sbl\/.*\/handler\.(?:py|m?js|ts)$/i.test(path)) return true;
    // Keep a supplied non-handler SBL owner available for repositories whose
    // production boundary is a routed component or service rather than Lambda.
    if (requirement.pathPattern.test(file.path)) return true;
  } else if (requirement.pathPattern.test(file.path)) return true;
  const content = String(file.content ?? "");
  if (requirement.label === "notification delivery owner")
    return /\b(?:send|deliver|dispatch|notify)\w*\b[\s\S]{0,100}\b(?:email|mail|notification|message)\b|\b(?:ms[ _-]?graph|graph.*mail)\b/i.test(content);
  if (requirement.label === "action persistence owner")
    return /\b(?:create|update|write|persist)\w*\b[\s\S]{0,100}\b(?:action|follow[ _-]?up)\b/i.test(content);
  if (requirement.label === "report owner")
    return /\b(?:report|historical)\b[\s\S]{0,100}\b(?:route|endpoint|response|render)\b/i.test(content);
  if (requirement.label === "SBL owner" || requirement.label === "tooling owner")
    return /\b(?:sbl|service[ _-]?based[ _-]?launchpad|tooling)\b[\s\S]{0,100}\b(?:handler|guard|block|deny|reject)\b/i.test(content);
  return false;
}

function ownerAcceptanceProof(label) {
  const proofs = {
    "frontend/page owner": "Patch the reachable page or route that renders the behavior and its production data-loading path; render that owner in the test.",
    "authoritative API or extracted-account data owner": "Patch the real adapter or retrieval call and its workflow persistence path; invoke the public workflow with caller-shaped data in the test.",
    "action persistence owner": "Patch the production validation-completion caller through the action writer; test the public workflow creating the persisted action.",
    "notification delivery owner": "Patch the production action path through the notification sender with a resolved recipient; test notification as an outcome of that public action path.",
    "report owner": "Patch a registered endpoint, scheduled job, or reachable UI consumer for the report; test the public observable report surface.",
    "SBL owner": "Patch the invoked SBL operation guard and its blocked response or state; test an attempted public SBL operation.",
    "tooling owner": "Patch the invoked tooling operation guard and its blocked response or state; test an attempted public tooling operation.",
  };
  return proofs[label];
}

async function requestValidatedPatches({ gateway, task, context, candidate, writePaths, acceptedStoryCoverage = [], previousValidationIssue = null, timeoutMs = 900_000 }) {
  let lastError;
  let ownerCorrectionAttempts = 0;
  let requiredResponsePatchPaths = [];
  const stagedPatches = new Map();
  // Resolve owners before asking the model.  Coverage must be checked against
  // real, supplied production paths—not guessed filename conventions after a
  // response has already been generated.
  const ownerContext = requiredOwnerContext(task, context, acceptedStoryCoverage);
  for (let attempt = 1; attempt <= maxPatchResponseAttempts; attempt += 1) {
    const request = {
      system:
        "You are a bounded code-editing worker. Return only valid JSON matching the requested schema. Never include markdown, explanations, credentials, commands, or files outside the supplied writable context.",
      prompt: buildPatchPrompt(
        requiredResponsePatchPaths.length
          ? { ...task, requiredResponsePatchPaths }
          : task,
        context,
        attempt,
        lastError?.details?.responseIssue,
        lastError?.details?.responseCorrection,
        previousValidationIssue,
        acceptedStoryCoverage,
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
      const responseText = mergeStagedPatchResponse(completion.text, stagedPatches);
      const parsed = parseModelResponse(
        responseText,
        writePaths,
        completion,
        task.stories,
        acceptedStoryCoverage,
        ownerContext,
      );
      const materializedPatches = await materializeValidatedPatches(
        candidate,
        parsed.patches,
        completion,
      );
      return Object.freeze({
        completion,
        ...parsed,
        patches: materializedPatches,
      });
    } catch (error) {
      const ownerCoverageMissing =
        error?.details?.responseIssue === "STORY_COVERAGE_OWNER_MISSING";
      if (ownerCoverageMissing) {
        ownerCorrectionAttempts += 1;
        const missingOwners = focusedOwnerCorrection(
          ownerContext,
          error?.details?.responseIssue,
          error?.details?.responseCorrection,
        );
        if (missingOwners.length) {
          // Owner corrections are not merely a coverage hint. Carry the
          // exact supplied production path into the same mandatory-patch
          // channel used for missing test evidence.
          error.details.requiredResponsePatchPaths = [
            ...(error.details.requiredResponsePatchPaths ?? []),
            ...missingOwners.flatMap((owner) => owner.suppliedCandidatePaths),
          ];
          error.details.responseCorrection = `${error.details.responseCorrection} Exact required repair: ${missingOwners.map((owner) => `${owner.storyKey}:${owner.owner} => ${owner.suppliedCandidatePaths[0]}`).join("; ")}. The next response must emit a patch for every listed path and cite that same path in the matching storyCoverage implementationPaths; a component, helper, or direct helper test is not an acceptable substitute.`;
        }
      }
      const repeatedUnchangedIssue =
        lastError?.details?.responseIssue === error?.details?.responseIssue &&
        lastError?.details?.responseCorrection === error?.details?.responseCorrection;
      if (
        error?.code !== "MODEL_PATCH_RESPONSE_INVALID" ||
        attempt === maxPatchResponseAttempts ||
        repeatedUnchangedIssue ||
        // Initial response plus two path-explicit owner repairs. This is the
        // smallest bounded allowance that can recover when the first repair
        // repeats the generic diagnostic instead of changing the named owner.
        ownerCorrectionAttempts > 2
      )
        throw withAttempts(error, attempt);
      if (
        error?.details?.responseIssue === "STORY_COVERAGE_PATCHED_EVIDENCE_MISSING" ||
        ownerCoverageMissing
      ) {
        const partial = parseModelResponse(completion.text, writePaths, completion, [], [], ownerContext);
        for (const patch of partial.patches) stagedPatches.set(patch.path, patch);
        requiredResponsePatchPaths = [...new Set([
          ...requiredResponsePatchPaths,
          ...(error?.details?.requiredResponsePatchPaths ?? []),
        ])];
        const requiredPatchInstruction = requiredResponsePatchPaths.length
          ? ` Required emitted patch paths for the next response: ${requiredResponsePatchPaths.join(", ")}. Each exact path must occur in patches; do not merely cite it in storyCoverage.`
          : "";
        error.details.responseCorrection = `${error.details.responseCorrection} Previously accepted patches are retained transactionally for the next attempt. Emit only missing owner or evidence patches, but return complete storyCoverage citing both retained and new patch paths.${requiredPatchInstruction}`;
      }
      lastError = error;
    }
  }
  throw lastError;
}

function mergeStagedPatchResponse(text, stagedPatches) {
  if (!stagedPatches.size) return text;
  const response = JSON.parse(unwrapJsonFence(text));
  if (!Array.isArray(response?.patches)) return text;
  const merged = new Map(stagedPatches);
  for (const patch of response.patches) {
    const path = typeof patch?.path === "string" ? patch.path.trim() : "";
    if (path) merged.set(path, patch);
  }
  return JSON.stringify({ ...response, patches: [...merged.values()] });
}

async function materializeValidatedPatches(root, patches, completion) {
  const materialized = [];
  for (const patch of patches) {
    let content = await readFile(join(root, patch.path), "utf8").catch(() => null);
    if (patch.content !== null) {
      if (
        content !== null &&
        isDestructiveReplacement(content, patch.content)
      )
        throw patchResponseError(
          "PATCH_DESTRUCTIVE_REWRITE",
          `Replacement for ${patch.path} would remove unrelated existing behavior.`,
          completion,
          `Preserve unrelated behavior in ${patch.path}. Use content:null with exact anchored replacements copied from the supplied content. Do not return a partial function, class, or snippet as a complete file. A complete replacement is allowed only when it retains the whole supplied file plus the minimal change.`,
        );
      materialized.push(patch);
      continue;
    }
    if (content === null)
      throw patchResponseError(
        "PATCH_ANCHOR_TARGET_MISSING",
        `Anchored replacement target ${patch.path} does not exist.`,
        completion,
        `Emit complete replacement content for new file ${patch.path}; anchored replacements are only valid for existing files.`,
      );
    for (const replacement of patch.replacements) {
      let first = content.indexOf(replacement.oldText);
      let last = content.lastIndexOf(replacement.oldText);
      let replacedLength = replacement.oldText.length;
      if (first < 0) {
        const whitespaceMatch = whitespaceEquivalentAnchorRange(content, replacement.oldText);
        if (whitespaceMatch) {
          first = whitespaceMatch.start;
          last = whitespaceMatch.start;
          replacedLength = whitespaceMatch.end - whitespaceMatch.start;
        }
      }
      if (first < 0 || first !== last)
        throw patchResponseError(
          "PATCH_ANCHOR_NOT_UNIQUE",
          `Anchored replacement for ${patch.path} must match exactly once.`,
          completion,
          anchorCorrection(patch.path, content, replacement.oldText),
        );
      content = `${content.slice(0, first)}${replacement.newText}${content.slice(first + replacedLength)}`;
    }
    materialized.push(Object.freeze({
      path: patch.path,
      content,
      replacements: Object.freeze([]),
    }));
  }
  return Object.freeze(materialized);
}

function isDestructiveReplacement(existingContent, replacementContent) {
  const existingBytes = Buffer.byteLength(existingContent);
  // Very small files are often intentionally replaced in full. Larger files
  // must retain both their overall size and most non-empty source lines.
  if (existingBytes < 1024) return false;
  if (Buffer.byteLength(replacementContent) < existingBytes * 0.85) return true;
  const sourceLines = existingContent.split("\n").map((line) => line.trim()).filter(Boolean);
  if (sourceLines.length < 8) return false;
  const replacementCounts = new Map();
  for (const line of replacementContent.split("\n").map((line) => line.trim()).filter(Boolean))
    replacementCounts.set(line, (replacementCounts.get(line) ?? 0) + 1);
  let retained = 0;
  for (const line of sourceLines) {
    const available = replacementCounts.get(line) ?? 0;
    if (!available) continue;
    replacementCounts.set(line, available - 1);
    retained += 1;
  }
  return retained / sourceLines.length < 0.75;
}

function whitespaceEquivalentAnchorRange(content, oldText) {
  const anchorLines = oldText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (anchorLines.length < 2) return null;
  const contentLines = [];
  const linePattern = /.*(?:\n|$)/g;
  for (const match of content.matchAll(linePattern)) {
    const text = match[0].endsWith("\n") ? match[0].slice(0, -1) : match[0];
    if (!text.trim()) continue;
    contentLines.push({ text: text.trim(), start: match.index, end: match.index + text.length });
  }
  const matches = [];
  for (let index = 0; index <= contentLines.length - anchorLines.length; index += 1) {
    if (anchorLines.every((line, offset) => contentLines[index + offset].text === line)) {
      matches.push({
        start: contentLines[index].start,
        end: contentLines[index + anchorLines.length - 1].end,
      });
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function anchorCorrection(path, content, oldText) {
  const matchCount = oldText
    ? content.split(oldText).length - 1
    : 0;
  const rejectedAnchor = JSON.stringify(oldText.slice(0, 500));
  const currentExcerpt = matchCount === 0
    ? currentAnchorExcerpt(content, oldText)
    : null;
  const excerptCorrection = currentExcerpt
    ? ` Copy oldText exactly from this current candidate excerpt: ${JSON.stringify(currentExcerpt)}.`
    : "";
  return `For ${path}, the rejected oldText ${rejectedAnchor} matched ${matchCount} times. Do not reuse that exact oldText.${excerptCorrection} Select the intended occurrence and copy a larger contiguous block including adjacent unchanged lines until it occurs exactly once. Do not shorten, paraphrase, or combine separate excerpts.`;
}

function currentAnchorExcerpt(content, oldText) {
  const contentLines = content.split("\n");
  const anchorLines = [...new Set(oldText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean))];
  const normalizedContent = contentLines.map((line) => line.trim());
  const candidates = [];
  for (const anchorLine of anchorLines) {
    for (let lineIndex = 0; lineIndex < normalizedContent.length; lineIndex += 1) {
      if (normalizedContent[lineIndex] !== anchorLine) continue;
      const neighborhood = new Set(
        normalizedContent.slice(
          Math.max(0, lineIndex - 12),
          Math.min(normalizedContent.length, lineIndex + 13),
        ),
      );
      const score = anchorLines.reduce(
        (total, line) => total + (neighborhood.has(line) ? line.length + 1 : 0),
        0,
      );
      candidates.push({ lineIndex, score, anchorLength: anchorLine.length });
    }
  }
  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      right.anchorLength - left.anchorLength ||
      left.lineIndex - right.lineIndex,
  );
  if (!candidates.length) return null;
  const lineIndex = candidates[0].lineIndex;
  const start = Math.max(0, lineIndex - 7);
  const end = Math.min(contentLines.length, lineIndex + 10);
  return contentLines.slice(start, end).join("\n");
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
        provisionalExternalContracts: task.provisionalExternalContracts ?? [],
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
          "For a listed provisional external contract, do not fail solely because its authoritative endpoint, authentication, or response schema is intentionally absent. Verify instead that the reachable implementation exposes an explicit UNKNOWN state and does not fabricate a funded or unfunded result; retain any other reachability, invocation, or data-flow finding.",
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
    return await completeGatewayWithinDeadline(gateway, request);
  } catch (error) {
    if (!isUnclassifiedGatewayBadRequest(error)) throw error;
    return completeGatewayWithinDeadline(gateway, {
      ...request,
      prompt: buildCompactContextPrompt(request.prompt, task),
      correlationId: randomUUID(),
    });
  }
}

async function completeGatewayWithinDeadline(gateway, request) {
  const timeoutMs = boundedModelRequestTimeout(request.timeoutMs);
  let timeout;
  try {
    const completion = await Promise.race([
      Promise.resolve(gateway.complete(request)),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new ChangeCaseError(
          "MODEL_PATCH_GATEWAY_TIMEOUT",
          "The coding-model gateway did not settle within the bounded request deadline.",
          { retryable: true, severity: "warning", details: { timeoutMs } },
        )), timeoutMs);
      }),
    ]);
    // Do not let an adapter's empty or malformed result become an
    // unclassified TypeError during response parsing.
    if (!completion || typeof completion !== "object" || typeof completion.text !== "string")
      throw new ChangeCaseError(
        "MODEL_PATCH_GATEWAY_RESPONSE_INVALID",
        "The coding-model gateway returned an invalid completion envelope.",
        { retryable: true, severity: "warning" },
      );
    return completion;
  } finally {
    if (timeout) clearTimeout(timeout);
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

function semanticFindingSignature(findings) {
  return sha256((findings ?? []).map((finding) => ({
    storyKey: finding.storyKey,
    code: finding.code,
    message: finding.message,
    evidencePaths: [...finding.evidencePaths].sort(),
  })).sort((left, right) =>
    `${left.storyKey}:${left.code}:${left.message}`.localeCompare(`${right.storyKey}:${right.code}:${right.message}`)
  ));
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
  acceptedStoryCoverage = [],
  ownerContext = [],
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
    !response.patches.length
  )
    throw patchResponseError(
      "SCHEMA_INVALID",
      "The model-patch response must contain a bounded non-empty patch list.",
      completion,
    );
  if (response.patches.length > maxPatches)
    throw patchResponseError(
      "PATCH_COUNT_EXCEEDED",
      `The model-patch response contained ${response.patches.length} patches; the limit is ${maxPatches}.`,
      completion,
      `Return at most ${maxPatches} patches. Combine changes to shared files into one patch and reference the same path from multiple storyCoverage entries.`,
    );
  const patchesByPath = new Map();
  for (const patch of response.patches) {
    const path = normalizeModelPatchPath(patch?.path);
    const content = typeof patch?.content === "string" ? patch.content : null;
    const replacements = Array.isArray(patch?.replacements)
      ? patch.replacements.map((replacement) => ({
          oldText: typeof replacement?.oldText === "string" ? replacement.oldText : "",
          newText: typeof replacement?.newText === "string" ? replacement.newText : null,
        }))
      : [];
    const usesReplacement = content !== null;
    const usesAnchors = replacements.length > 0;
    if (!path || path.startsWith("/") || /^[a-z]:\//i.test(path) || path.split("/").includes(".."))
      throw patchResponseError(
        "PATCH_PATH_INVALID",
        "A model-patch path was not a safe relative path.",
        completion,
        `Use an exact relative path from the supplied files. Rejected path: ${safePatchPath(patch?.path)}.`,
      );
    if (!isWritable(path, writePaths))
      throw patchResponseError(
        "PATCH_PATH_NOT_WRITABLE",
        "A model-patch path was outside the authorized writable roots.",
        completion,
        `Do not emit ${safePatchPath(path)}. Use only supplied files marked writable:true or create a file under these writable roots: ${writePaths.join(", ")}.`,
      );
    if (isSensitivePath(path))
      throw patchResponseError(
        "PATCH_PATH_SENSITIVE",
        "A model-patch path targeted a sensitive file.",
        completion,
        `Do not emit ${safePatchPath(path)} or any credential, environment, token, key, or package-manager authentication file.`,
      );
    if (usesReplacement === usesAnchors)
      throw patchResponseError(
        "PATCH_MODE_INVALID",
        "A patch must use exactly one replacement mode.",
        completion,
        `For ${safePatchPath(path)}, provide either string content with replacements:[] or content:null with one or more anchored replacements, never both and never neither.`,
      );
    if (usesReplacement && content.includes("\u0000"))
      throw patchResponseError(
        "PATCH_CONTENT_INVALID",
        "Complete replacement content contained an unsupported null byte.",
        completion,
        `Remove null bytes from the complete content for ${safePatchPath(path)}, or use anchored replacements.`,
      );
    if (usesReplacement && Buffer.byteLength(content) > maxPatchBytes)
      throw patchResponseError(
        "PATCH_CONTENT_TOO_LARGE",
        `Complete replacement content for ${path} exceeded ${maxPatchBytes} bytes.`,
        completion,
        `Use minimal anchored replacements for ${safePatchPath(path)} instead of returning the complete file.`,
      );
    if (usesAnchors && replacements.some((replacement) =>
      !replacement.oldText || replacement.newText === null || replacement.oldText.includes("\u0000") || replacement.newText.includes("\u0000")
    ))
      throw patchResponseError(
        "PATCH_REPLACEMENT_INVALID",
        "An anchored replacement was incomplete or contained an unsupported null byte.",
        completion,
        `For ${safePatchPath(path)}, every replacement must contain non-empty oldText copied from one contiguous supplied excerpt and string newText.`,
      );
    if (usesAnchors && replacements.some((replacement) =>
      Buffer.byteLength(replacement.oldText) + Buffer.byteLength(replacement.newText) > maxPatchBytes
    ))
      throw patchResponseError(
        "PATCH_REPLACEMENT_TOO_LARGE",
        `An anchored replacement for ${path} exceeded ${maxPatchBytes} bytes.`,
        completion,
        `Use smaller exact anchors for ${safePatchPath(path)} and change only the required regions.`,
      );
    const normalizedPatch = { path, content, replacements };
    const existing = patchesByPath.get(path);
    if (existing) {
      if (JSON.stringify(existing) === JSON.stringify(normalizedPatch)) continue;
      throw patchResponseError(
        "PATCH_PATH_DUPLICATE",
        `The model-patch response contained conflicting patches for ${path}.`,
        completion,
        `Emit ${safePatchPath(path)} exactly once. Combine all changes for that file into one patch, then reference the same path from every applicable storyCoverage entry.`,
      );
    }
    patchesByPath.set(path, normalizedPatch);
  }
  const patches = [...patchesByPath.values()].map((patch) => Object.freeze({
    ...patch,
    replacements: Object.freeze(patch.replacements.map(Object.freeze)),
  }));
  const storyCoverage = parseStoryCoverage(
    response.storyCoverage,
    requiredStories,
    new Set(patches.map((patch) => patch.path)),
    completion,
    acceptedStoryCoverage,
  );
  validateCoverageDiversity(storyCoverage, requiredStories, completion);
  validateStoryOwnerCoverage(
    mergeCoverageForValidation(acceptedStoryCoverage, storyCoverage),
    requiredStories,
    completion,
    ownerContext,
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

function mergeCoverageForValidation(acceptedCoverage, responseCoverage) {
  const merged = acceptedCoverage.map((entry) => ({
    storyKey: entry.storyKey,
    implementationPaths: [...entry.implementationPaths],
    testPaths: [...entry.testPaths],
  }));
  mergeStoryCoverage(merged, responseCoverage);
  return merged;
}

function validateCoverageDiversity(storyCoverage, requiredStories, completion) {
  if (requiredStories.length < 3) return;
  const implementationPaths = new Set(
    storyCoverage.flatMap((entry) => entry.implementationPaths),
  );
  if (implementationPaths.size >= 2) return;
  throw patchResponseError(
    "STORY_COVERAGE_COLLAPSED",
    "A multi-story response collapsed distinct acceptance paths into one implementation file.",
    completion,
    `The ${requiredStories.length} supplied stories cannot all rely on ${[...implementationPaths].join(", ") || "one shared helper"}. Emit at least two patched implementation paths: retain shared domain logic where appropriate and patch the reachable owning page, route, handler, job, report, notification sender, or enforcement point required by the stories. Update storyCoverage to cite those exact patched owner paths.`,
  );
}

function validateStoryOwnerCoverage(storyCoverage, requiredStories, completion, ownerContext = []) {
  if (!requiredStories.length) return;
  const missing = [];
  for (const story of requiredStories) {
    const coverage = storyCoverage.find((entry) => entry.storyKey === story.key);
    if (!coverage) continue;
    const requirements = requiredStoryOwnerRequirements(story);
    if (requiredStories.length === 1 && requirements.length < 2) continue;
    for (const requirement of requirements) {
      const owner = ownerContext.find((entry) => entry.storyKey === story.key && entry.owner === requirement.label);
      // A named owner is enforceable only when this request supplied a concrete
      // production candidate. Otherwise a filename heuristic creates an
      // impossible repair loop; semantic verification remains responsible for
      // proving the reachable data flow once it has full candidate evidence.
      const candidates = owner?.suppliedCandidatePaths ?? [];
      if (candidates.length && !coverage.implementationPaths.some((path) => candidates.includes(path)))
        missing.push(`${story.key}:${requirement.label}`);
    }
    for (const owner of ownerContext.filter((entry) =>
      entry.storyKey === story.key && entry.owner === "semantic repair production owner",
    )) {
      if (!coverage.implementationPaths.some((path) => owner.suppliedCandidatePaths.includes(path)))
        missing.push(`${story.key}:${owner.owner}:${owner.suppliedCandidatePaths[0]}`);
    }
  }
  if (!missing.length) return;
  throw patchResponseError(
    "STORY_COVERAGE_OWNER_MISSING",
    "Story coverage did not include a patched implementation owner for every explicit workflow boundary.",
    completion,
    `Patch and cite the missing reachable owners: ${missing.join(", ")}. Cite the exact supplied production-owner path for each one—use existing repository pages, API/services, action writers, notification senders, report surfaces, SBL handlers, and tooling handlers. Do not substitute a generic workflow helper or a direct helper test for these owner paths.`,
  );
}

function requiredStoryOwnerRequirements(story) {
  const text = [
    story.title,
    story.narrative,
    ...story.scenarios.flatMap((scenario) => [scenario.given, scenario.when, scenario.then]),
  ].join(" ").toLowerCase();
  const requirements = [
    {
      label: "frontend/page owner",
      textPattern: /\b(?:view|page|screen|frontend|render|visible|visibility|display)\b/,
      pathPattern: /(?:^|\/)frontend\/|(?:^|\/)(?:pages?|components?|routes?)(?:\/|\.)/i,
    },
    {
      label: "authoritative API or extracted-account data owner",
      textPattern: /\b(?:api|extract|extracted|financial|source data|account data)\b/,
      pathPattern: /(?:^|\/)(?:api|routes?|services?|account[^/]*|extract[^/]*|financial[^/]*|aide_lookup[^/]*)(?:\/|\.|_|-)/i,
    },
    {
      label: "action persistence owner",
      textPattern: /\b(?:action|follow[ -]?up|persist|recorded action)\b/,
      pathPattern: /(?:^|\/)[^/]*(?:action|follow)[^/]*(?:\/|\.|_|-)/i,
    },
    {
      label: "notification delivery owner",
      textPattern: /\b(?:notify|notification|email|recipient)\b/,
      pathPattern: /(?:^|\/)[^/]*(?:notif|notify|email|mail|message|event|queue|graph|communication|account_field_log|tenant_action)[^/]*(?:\/|\.|_|-)/i,
    },
    {
      label: "report owner",
      textPattern: /\b(?:report|reporting|historical|history|dashboard)\b/,
      pathPattern: /(?:^|\/)[^/]*(?:report|history|historical|dashboard)[^/]*(?:\/|\.|_|-)/i,
    },
    {
      label: "SBL owner",
      textPattern: /\bsbl\b/,
      pathPattern: /(?:^|\/)[^/]*sbl[^/]*(?:\/|\.|_|-)/i,
    },
    {
      label: "tooling owner",
      textPattern: /\btooling\b/,
      pathPattern: /(?:^|\/)(?:sbl(?:\/|\.|_|-)|[^/]*(?:tool|security|servicebasedlaunchpad)[^/]*(?:\/|\.|_|-))/i,
    },
  ];
  return requirements.filter((requirement) => requirement.textPattern.test(text));
}

function normalizeModelPatchPath(value) {
  if (typeof value !== "string") return "";
  return value.trim().replaceAll("\\", "/").replace(/^(?:\.\/)+/, "");
}

function safePatchPath(value) {
  return JSON.stringify(String(value ?? "").slice(0, 240));
}

function parseStoryCoverage(
  value,
  requiredStories,
  patchedPaths,
  completion,
  acceptedStoryCoverage = [],
) {
  if (!requiredStories.length) return Object.freeze([]);
  if (!Array.isArray(value))
    throw patchResponseError(
      "STORY_COVERAGE_MISSING",
      "The model-patch response must include coverage for every approved story.",
      completion,
    );
  const requiredKeys = new Set(requiredStories.map((story) => story.key));
  const acceptedByStory = new Map(
    acceptedStoryCoverage.map((entry) => [entry.storyKey, entry]),
  );
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
    const accepted = acceptedByStory.get(storyKey);
    const acceptedImplementationPaths = new Set(accepted?.implementationPaths ?? []);
    const acceptedTestPaths = new Set(accepted?.testPaths ?? []);
    const implementationPaths = declaredImplementationPaths.filter((path) =>
      patchedPaths.has(path) || acceptedImplementationPaths.has(path),
    );
    const testPaths = declaredTestPaths.filter((path) =>
      patchedPaths.has(path) || acceptedTestPaths.has(path),
    );
    if (!implementationPaths.length || !testPaths.length) {
      const missingImplementationPaths = declaredImplementationPaths.filter(
        (path) => !patchedPaths.has(path) && !acceptedImplementationPaths.has(path),
      );
      const missingTestPaths = declaredTestPaths.filter(
        (path) => !patchedPaths.has(path) && !acceptedTestPaths.has(path),
      );
      throw patchResponseError(
        "STORY_COVERAGE_PATCHED_EVIDENCE_MISSING",
        "Every approved story must retain patched implementation and test evidence.",
        completion,
        `Your next response must emit every missing evidence patch for ${storyKey}. Missing implementation patches: ${missingImplementationPaths.join(", ") || "none"}. Missing test patches: ${missingTestPaths.join(", ") || "none"}. A path named in storyCoverage does not count unless that exact path is also present in patches. Exact emitted patch paths: ${[...patchedPaths].join(", ")}. Use minimal anchored replacements for existing implementation files to reserve response space for the required test patch.`,
        { requiredResponsePatchPaths: [...missingImplementationPaths, ...missingTestPaths] },
      );
    }
    if (
      accepted &&
      ![...implementationPaths, ...testPaths].some((path) => patchedPaths.has(path))
    )
      throw patchResponseError(
        "STORY_COVERAGE_REPAIR_DELTA_MISSING",
        "A repair response did not patch any evidence path for an approved story.",
        completion,
        `Emit at least one implementation or test patch for ${storyKey} that addresses the verifier finding. Previously accepted paths may complete the remaining storyCoverage evidence but cannot replace the repair delta.`,
      );
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
    ...new Set(value.map(normalizeModelPatchPath).filter(Boolean)),
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

function patchResponseError(responseIssue, message, completion, responseCorrection = null, additionalDetails = {}) {
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
        typeof (responseCorrection ?? defaultResponseCorrection(responseIssue)) === "string" &&
        (responseCorrection ?? defaultResponseCorrection(responseIssue)).length <= 2048
          ? responseCorrection ?? defaultResponseCorrection(responseIssue)
          : null,
      modelFinishReason: safeFinishReason,
      providerRequestId,
      ...additionalDetails,
    },
  });
}

function defaultResponseCorrection(responseIssue) {
  if (responseIssue === "NON_JSON" || responseIssue === "SCHEMA_INVALID")
    return "Return exactly one JSON object matching responseSchema, with a non-empty patches array, featureSpotlight, and storyCoverage. Do not include markdown or explanatory text.";
  if (responseIssue === "SEMANTIC_VERIFICATION_SCHEMA_INVALID")
    return "Return exactly one adx-candidate-semantic-verification-v1 JSON object. Use passed:true with findings:[], or passed:false with at least one finding containing an approved storyKey, non-empty code/message, and evidencePaths drawn only from supplied files. Do not include any other fields or prose.";
  if (responseIssue === "SEMANTIC_VERIFICATION_NON_JSON")
    return "Return exactly one adx-candidate-semantic-verification-v1 JSON object with no markdown or prose.";
  if (responseIssue === "PATCH_INVALID")
    return "Return only authorized relative writable paths. For each patch, provide either complete string content with no replacements or null content with at least one exact anchored replacement.";
  return null;
}

function withAttempts(error, attempts) {
  if (!(error instanceof ChangeCaseError)) return error;
  return new ChangeCaseError(error.code, error.message, {
    details: { ...error.details, modelAttempts: attempts },
  });
}

async function writeMaterializedPatch(root, patch) {
  const target = resolve(root, patch.path);
  if (!target.startsWith(`${root}/`))
    throw new ChangeCaseError(
      "MODEL_PATCH_PATH_ESCAPE",
      "A model-patch path escaped the disposable candidate.",
    );
  if (typeof patch.content !== "string" || patch.replacements.length)
    throw new ChangeCaseError(
      "MODEL_PATCH_PLAN_INVALID",
      "Only a validated materialized patch can be written to the candidate.",
    );
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, patch.content, "utf8");
}

async function readCandidateFiles(root, paths) {
  return new Map(await Promise.all([...new Set(paths)].map(async (path) => [
    path,
    await readFile(join(root, path), "utf8").catch(() => ""),
  ])));
}

async function captureStoryEvidence(candidate, coverageEntries, previousContent, storyEvidence) {
  for (const coverage of coverageEntries) {
    const evidenceByPath = new Map(
      (storyEvidence.get(coverage.storyKey) ?? []).map((entry) => [
        entry.path,
        new Set(entry.addedLines),
      ]),
    );
    for (const path of coverage.testPaths) {
      const beforeLines = new Set((previousContent.get(path) ?? "").split("\n"));
      const after = await readFile(join(candidate, path), "utf8").catch(() => "");
      const addedLines = after.split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length >= 8 && !beforeLines.has(line));
      const retainedLines = evidenceByPath.get(path) ?? new Set();
      for (const line of addedLines) retainedLines.add(line);
      evidenceByPath.set(path, retainedLines);
    }
    storyEvidence.set(coverage.storyKey, [...evidenceByPath].map(([path, addedLines]) => ({
      path,
      addedLines: [...addedLines],
    })));
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

function failedValidation(reason, details = {}) {
  return Object.freeze({
    code: 1,
    signal: null,
    timedOut: false,
    outputBytes: Buffer.byteLength(reason),
    outputDigest: sha256(reason),
    outputExcerpt: reason,
    validationCommand: details.validationCommand ?? null,
    validationCategory: details.validationCategory ?? "CHECK_FAILED",
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
