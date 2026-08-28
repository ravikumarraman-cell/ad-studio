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
import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { ChangeCaseError, sha256 } from "./change-case-ledger.mjs";
import { validateCodingAgentAdapter } from "./coding-agent-adapters.mjs";

const maxContextBytes = 160 * 1024;
const maxFileBytes = 24 * 1024;
const maxPatchBytes = 64 * 1024;
const maxPatches = 12;
const maxModelAttempts = 2;
const ignoredDirectories = new Set([
  ".git",
  "node_modules",
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
  "npm run verify:health-x": Object.freeze({
    executable: "npm",
    arguments: Object.freeze(["run", "verify:health-x"]),
  }),
  "npm run verify:production": Object.freeze({
    executable: "npm",
    arguments: Object.freeze(["run", "verify:production"]),
  }),
});

export class ModelPatchBroker {
  constructor({
    enabled = false,
    sourceRoot,
    candidateRoot,
    gateway,
    allowedValidationCommands = ["node --test"],
    linkSourceDependencies = false,
    validate = runValidation,
  } = {}) {
    this.enabled = enabled;
    this.sourceRoot = sourceRoot;
    this.candidateRoot = candidateRoot;
    this.gateway = gateway;
    this.allowedValidationCommands = Object.freeze([
      ...new Set(allowedValidationCommands),
    ]);
    this.linkSourceDependencies = Boolean(linkSourceDependencies);
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
    const context = await collectContext(source, writePaths);
    timings.contextMs = elapsed(startedAt);
    const scratchRoot = await mkdtemp(join(tmpdir(), "adx-model-patch-"));
    const workspace = join(scratchRoot, basename(candidate) || "candidate");
    try {
      const copyStartedAt = Date.now();
      await cp(source, workspace, {
        recursive: true,
        dereference: false,
        verbatimSymlinks: true,
        filter: (path) => shouldCopyCandidatePath(source, path),
      });
      if (this.linkSourceDependencies)
        await linkSourceDependencies(source, workspace);
      timings.workspaceCopyMs = elapsed(copyStartedAt);
      const modelStartedAt = Date.now();
      await reportProgress(onProgress, "MODEL_REQUEST");
      const { completion, patches, featureSpotlight } =
        await requestValidatedPatches({
          gateway: this.gateway,
          task: normalizedTask,
          context,
          writePaths,
        });
      timings.modelMs = elapsed(modelStartedAt);
      const patchStartedAt = Date.now();
      for (const patch of patches) await writePatch(workspace, patch);
      timings.patchMs = elapsed(patchStartedAt);
      const validationStartedAt = Date.now();
      await reportProgress(onProgress, "VALIDATION");
      const validation = await this.validate({
        cwd: workspace,
        allowedCommands: normalizedTask.allowedCommands,
        timeoutMs,
      });
      timings.validationMs = elapsed(validationStartedAt);
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
      await reportProgress(onProgress, "CANDIDATE_PROMOTION");
      await removeTransientCandidateOutputs(workspace);
      const promotionStartedAt = Date.now();
      await mkdir(dirname(candidate), { recursive: true });
      await rm(candidate, { recursive: true, force: true });
      await rename(workspace, candidate);
      const candidateDigest = await digestTree(candidate);
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
        timings: finalizedTimings(timings, startedAt),
      });
    } catch (error) {
      if (error && typeof error === "object")
        error.executionTimings = finalizedTimings(timings, startedAt);
      throw error;
    } finally {
      await rm(scratchRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function reportProgress(onProgress, phase) {
  if (typeof onProgress === "function") await onProgress(phase);
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

async function collectContext(root, writePaths) {
  const entries = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile()) entries.push(fullPath);
    }
  }
  await visit(root);
  let bytes = 0;
  const files = [];
  for (const fullPath of entries.sort()) {
    const path = relative(root, fullPath);
    if (!isWritable(path, writePaths) || isSensitivePath(path)) continue;
    const content = await readFile(fullPath, "utf8").catch(() => null);
    if (
      content === null ||
      content.includes("\u0000") ||
      Buffer.byteLength(content) > maxFileBytes
    )
      continue;
    const size = Buffer.byteLength(content);
    if (bytes + size > maxContextBytes) break;
    bytes += size;
    files.push({ path, content });
  }
  if (!files.length)
    throw new ChangeCaseError(
      "MODEL_PATCH_CONTEXT_EMPTY",
      "No readable files matched the model-patch writable path allowlist.",
    );
  return Object.freeze(files);
}

function buildPatchPrompt(
  task,
  files,
  attempt = 1,
  previousResponseIssue = null,
) {
  return JSON.stringify({
    schema: "adx-model-patch-request-v1",
    objective: task.objective,
    changeDigest: task.changeDigest,
    validation: task.allowedCommands,
    responseSchema: {
      schema: "adx-model-patch-response-v1",
      patches: [
        {
          path: "relative writable path",
          content: "complete replacement file content",
        },
      ],
      featureSpotlight: {
        featureId:
          "lowercase feature identifier used only in data-adx-feature attributes",
        title: "short user-visible feature title",
        summary: "short description of what to look for",
      },
    },
    attempt,
    previousResponseIssue,
    rules: [
      "Return JSON only.",
      "Change only supplied paths.",
      "Use complete replacement content for each changed file.",
      "When a user-visible feature is added, include featureSpotlight and mark its visible root element with data-adx-feature equal to featureSpotlight.featureId. Otherwise set featureSpotlight to null.",
      "Do not add dependencies, run commands, request secrets, create commits, or claim verification.",
    ],
    files,
  });
}

async function requestValidatedPatches({ gateway, task, context, writePaths }) {
  let lastError;
  for (let attempt = 1; attempt <= maxModelAttempts; attempt += 1) {
    const completion = await gateway.complete({
      system:
        "You are a bounded code-editing worker. Return only valid JSON matching the requested schema. Never include markdown, explanations, credentials, commands, or files outside the supplied writable context.",
      prompt: buildPatchPrompt(
        task,
        context,
        attempt,
        lastError?.details?.responseIssue,
      ),
      correlationId: randomUUID(),
      maxTokens: 8192,
      temperature: 0,
      responseSchema: modelPatchResponseSchema,
    });
    try {
      return Object.freeze({
        completion,
        ...parseModelResponse(completion.text, writePaths, completion),
      });
    } catch (error) {
      if (
        error?.code !== "MODEL_PATCH_RESPONSE_INVALID" ||
        attempt === maxModelAttempts
      )
        throw withAttempts(error, attempt);
      lastError = error;
    }
  }
  throw lastError;
}

const modelPatchResponseSchema = Object.freeze({
  name: "adx_model_patch_response",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["schema", "patches", "featureSpotlight"],
    properties: {
      schema: { type: "string", enum: ["adx-model-patch-response-v1"] },
      patches: {
        type: "array",
        minItems: 1,
        maxItems: maxPatches,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["path", "content"],
          properties: { path: { type: "string" }, content: { type: "string" } },
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
    },
  },
});

function parseModelResponse(text, writePaths, completion = {}) {
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
    if (
      !path ||
      path.startsWith("/") ||
      path.includes("\\") ||
      path.split("/").includes("..") ||
      !isWritable(path, writePaths) ||
      isSensitivePath(path) ||
      content === null ||
      content.includes("\u0000") ||
      Buffer.byteLength(content) > maxPatchBytes ||
      seen.has(path)
    )
      throw patchResponseError(
        "PATCH_INVALID",
        "The model-patch response contains an invalid or unauthorized file replacement.",
        completion,
      );
    seen.add(path);
    return Object.freeze({ path, content });
  });
  return Object.freeze({
    patches: Object.freeze(patches),
    featureSpotlight: parseFeatureSpotlight(
      response.featureSpotlight,
      completion,
    ),
  });
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

function patchResponseError(responseIssue, message, completion) {
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
  await writeFile(target, patch.content, "utf8");
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

function runValidation({ cwd, allowedCommands, timeoutMs }) {
  const command = validationCommands[allowedCommands?.[0]];
  if (!command)
    throw new ChangeCaseError(
      "MODEL_PATCH_COMMAND_DENIED",
      "Validation requires an approved project command.",
    );
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
  const dependencies = join(source, "node_modules");
  if (!(await stat(dependencies).catch(() => null))?.isDirectory())
    throw new ChangeCaseError(
      "MODEL_PATCH_DEPENDENCIES_MISSING",
      "The Health-X execution profile requires the server source checkout dependencies. Run npm ci in the server source checkout first.",
      { retryable: false, severity: "warning" },
    );
  await symlink(dependencies, join(workspace, "node_modules"), "dir");
}

async function removeTransientCandidateOutputs(workspace) {
  await Promise.all(
    transientCandidateDirectories.map((path) =>
      rm(join(workspace, path), { recursive: true, force: true }),
    ),
  );
}

async function digestTree(root) {
  const files = [];
  async function collect(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
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
