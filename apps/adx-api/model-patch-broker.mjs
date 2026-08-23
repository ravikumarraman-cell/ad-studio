import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID, createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { ChangeCaseError, sha256 } from './change-case-ledger.mjs'
import { validateCodingAgentAdapter } from './coding-agent-adapters.mjs'

const maxContextBytes = 160 * 1024
const maxFileBytes = 24 * 1024
const maxPatchBytes = 64 * 1024
const maxPatches = 12
const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage'])
const sensitiveFileNames = new Set(['.env', '.npmrc'])

export class ModelPatchBroker {
  constructor({ enabled = false, sourceRoot, candidateRoot, gateway, validate = runValidation } = {}) {
    this.enabled = enabled
    this.sourceRoot = sourceRoot
    this.candidateRoot = candidateRoot
    this.gateway = gateway
    this.validate = validate
  }

  configured() {
    return Boolean(this.enabled && this.sourceRoot && this.candidateRoot && this.gateway?.status?.().configured)
  }

  async execute({ adapter, task, timeoutMs = 900_000, repository }) {
    const startedAt = Date.now()
    const timings = {}
    if (!this.configured()) throw new ChangeCaseError('MODEL_PATCH_EXECUTOR_NOT_CONFIGURED', 'The model-patch executor requires an enabled server-owned model gateway, source checkout, and candidate path.')
    const provider = validateCodingAgentAdapter(adapter)
    if (provider.executionKind !== 'MODEL_PATCH') throw new ChangeCaseError('MODEL_PATCH_ADAPTER_REQUIRED', 'This executor accepts only a registered model-patch adapter.')
    const source = await checkedOutRoot(this.sourceRoot)
    const candidate = resolve(this.candidateRoot)
    if (candidate === resolve('/') || source === candidate || source.startsWith(`${candidate}/`)) throw new ChangeCaseError('MODEL_PATCH_CANDIDATE_INVALID', 'The execution candidate must be a separate server-configured checkout path.')
    const normalizedTask = normalizeTask(task)
    const writePaths = normalizeWritePaths(repository?.writePaths)
    const context = await collectContext(source, writePaths)
    timings.contextMs = elapsed(startedAt)
    const scratchRoot = await mkdtemp(join(tmpdir(), 'adx-model-patch-'))
    const workspace = join(scratchRoot, basename(candidate) || 'candidate')
    try {
      const copyStartedAt = Date.now()
      await cp(source, workspace, { recursive: true, dereference: false, verbatimSymlinks: true, filter: (path) => shouldCopyCandidatePath(source, path) })
      timings.workspaceCopyMs = elapsed(copyStartedAt)
      const modelStartedAt = Date.now()
      const completion = await this.gateway.complete({
        system: 'You are a bounded code-editing worker. Return only valid JSON matching the requested schema. Never include markdown, explanations, credentials, commands, or files outside the supplied writable context.',
        prompt: buildPatchPrompt(normalizedTask, context),
        correlationId: randomUUID(),
        maxTokens: 8192,
        temperature: 1
      })
      timings.modelMs = elapsed(modelStartedAt)
      const patchStartedAt = Date.now()
      const patches = parsePatches(completion.text, writePaths, completion.finishReason)
      for (const patch of patches) await writePatch(workspace, patch)
      timings.patchMs = elapsed(patchStartedAt)
      const validationStartedAt = Date.now()
      const validation = await this.validate({ cwd: workspace, allowedCommands: normalizedTask.allowedCommands, timeoutMs })
      timings.validationMs = elapsed(validationStartedAt)
      if (validation.code !== 0 || validation.timedOut) return Object.freeze({ accepted: false, promoted: false, provider: provider.provider, code: validation.code, signal: validation.signal, timedOut: validation.timedOut, quotaExceeded: false, outputBytes: validation.outputBytes, outputDigest: validation.outputDigest, errorCode: validation.timedOut ? 'MODEL_PATCH_VALIDATION_TIMED_OUT' : validation.signal ? 'MODEL_PATCH_VALIDATION_SIGNALED' : 'MODEL_PATCH_VALIDATION_FAILED', candidateDigest: null, timings: finalizedTimings(timings, startedAt) })
      const promotionStartedAt = Date.now()
      await mkdir(dirname(candidate), { recursive: true })
      await rm(candidate, { recursive: true, force: true })
      await rename(workspace, candidate)
      const candidateDigest = await digestTree(candidate)
      timings.promotionMs = elapsed(promotionStartedAt)
      return Object.freeze({ accepted: true, promoted: true, provider: provider.provider, code: 0, signal: null, timedOut: false, quotaExceeded: false, outputBytes: validation.outputBytes, outputDigest: validation.outputDigest, candidateDigest, model: completion.model, responseDigest: completion.responseDigest, timings: finalizedTimings(timings, startedAt) })
    } catch (error) {
      if (error && typeof error === 'object') error.executionTimings = finalizedTimings(timings, startedAt)
      throw error
    } finally {
      await rm(scratchRoot, { recursive: true, force: true }).catch(() => {})
    }
  }
}

function elapsed(startedAt) { return Math.max(0, Math.round(Date.now() - startedAt)) }
function finalizedTimings(timings, startedAt) { return Object.freeze({ contextMs: Number(timings.contextMs ?? 0), workspaceCopyMs: Number(timings.workspaceCopyMs ?? 0), modelMs: Number(timings.modelMs ?? 0), patchMs: Number(timings.patchMs ?? 0), validationMs: Number(timings.validationMs ?? 0), promotionMs: Number(timings.promotionMs ?? 0), totalMs: elapsed(startedAt) }) }

function normalizeTask(task) {
  if (!task || typeof task.objective !== 'string' || !task.objective.trim() || typeof task.changeDigest !== 'string' || !task.changeDigest.startsWith('sha256:')) throw new ChangeCaseError('MODEL_PATCH_TASK_INVALID', 'A model-patch task requires a retained objective and change digest.')
  const allowedCommands = Array.isArray(task.allowedCommands) ? [...new Set(task.allowedCommands.map((command) => String(command).trim()).filter(Boolean))] : []
  if (!allowedCommands.length || allowedCommands.some((command) => command !== 'node --test')) throw new ChangeCaseError('MODEL_PATCH_COMMAND_DENIED', 'The model-patch executor permits only the exact validation command node --test.')
  return Object.freeze({ objective: task.objective.trim(), changeDigest: task.changeDigest, allowedCommands: Object.freeze(allowedCommands) })
}

function normalizeWritePaths(paths) {
  if (!Array.isArray(paths) || !paths.length) throw new ChangeCaseError('MODEL_PATCH_WRITE_PATHS_REQUIRED', 'The model-patch executor requires a non-empty writable path allowlist.')
  const normalized = paths.map((path) => String(path).trim())
  if (normalized.some((path) => !path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..'))) throw new ChangeCaseError('MODEL_PATCH_WRITE_PATHS_INVALID', 'Writable paths must be relative canonical paths.')
  return Object.freeze(normalized)
}

async function checkedOutRoot(value) {
  if (typeof value !== 'string' || !value.trim()) throw new ChangeCaseError('MODEL_PATCH_SOURCE_REQUIRED', 'A server-configured source checkout is required for model-patch execution.')
  const root = await realpath(value).catch(() => null)
  if (!root) throw new ChangeCaseError('MODEL_PATCH_SOURCE_REQUIRED', 'The server-configured source checkout does not exist.')
  return root
}

async function collectContext(root, writePaths) {
  const entries = []
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
      const fullPath = join(current, entry.name)
      if (entry.isDirectory()) await visit(fullPath)
      else if (entry.isFile()) entries.push(fullPath)
    }
  }
  await visit(root)
  let bytes = 0
  const files = []
  for (const fullPath of entries.sort()) {
    const path = relative(root, fullPath)
    if (!isWritable(path, writePaths) || isSensitivePath(path)) continue
    const content = await readFile(fullPath, 'utf8').catch(() => null)
    if (content === null || content.includes('\u0000') || Buffer.byteLength(content) > maxFileBytes) continue
    const size = Buffer.byteLength(content)
    if (bytes + size > maxContextBytes) break
    bytes += size
    files.push({ path, content })
  }
  if (!files.length) throw new ChangeCaseError('MODEL_PATCH_CONTEXT_EMPTY', 'No readable files matched the model-patch writable path allowlist.')
  return Object.freeze(files)
}

function buildPatchPrompt(task, files) {
  return JSON.stringify({
    schema: 'adx-model-patch-request-v1',
    objective: task.objective,
    changeDigest: task.changeDigest,
    validation: task.allowedCommands,
    responseSchema: { schema: 'adx-model-patch-response-v1', patches: [{ path: 'relative writable path', content: 'complete replacement file content' }] },
    rules: ['Return JSON only.', 'Change only supplied paths.', 'Use complete replacement content for each changed file.', 'Do not add dependencies, run commands, request secrets, create commits, or claim verification.'],
    files
  })
}

function parsePatches(text, writePaths, finishReason = null) {
  let response
  try { response = JSON.parse(unwrapJsonFence(text)) } catch { throw patchResponseError('NON_JSON', 'The model-patch executor received a non-JSON response.', finishReason) }
  if (response?.schema !== 'adx-model-patch-response-v1' || !Array.isArray(response.patches) || !response.patches.length || response.patches.length > maxPatches) throw patchResponseError('SCHEMA_INVALID', 'The model-patch response must contain a bounded non-empty patch list.', finishReason)
  const seen = new Set()
  const patches = response.patches.map((patch) => {
    const path = typeof patch?.path === 'string' ? patch.path.trim() : ''
    const content = typeof patch?.content === 'string' ? patch.content : null
    if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..') || !isWritable(path, writePaths) || isSensitivePath(path) || content === null || content.includes('\u0000') || Buffer.byteLength(content) > maxPatchBytes || seen.has(path)) throw patchResponseError('PATCH_INVALID', 'The model-patch response contains an invalid or unauthorized file replacement.', finishReason)
    seen.add(path)
    return Object.freeze({ path, content })
  })
  return Object.freeze(patches)
}

function unwrapJsonFence(text) {
  const trimmed = String(text ?? '').trim()
  const match = trimmed.match(/^```json\s*\n?([\s\S]*?)\n?```$/i)
  return match ? match[1].trim() : trimmed
}

function patchResponseError(responseIssue, message, finishReason) {
  const safeFinishReason = ['stop', 'length', 'content_filter'].includes(finishReason) ? finishReason : null
  return new ChangeCaseError('MODEL_PATCH_RESPONSE_INVALID', message, { details: { responseIssue, modelFinishReason: safeFinishReason } })
}

async function writePatch(root, patch) {
  const target = resolve(root, patch.path)
  if (!target.startsWith(`${root}/`)) throw new ChangeCaseError('MODEL_PATCH_PATH_ESCAPE', 'A model-patch path escaped the disposable candidate.')
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, patch.content, 'utf8')
}

function isWritable(path, writePaths) {
  return writePaths.some((pattern) => pattern.endsWith('/**') ? path.startsWith(pattern.slice(0, -3)) : path === pattern)
}

function isSensitivePath(path) {
  return path.split('/').some((part) => sensitiveFileNames.has(part) || part.endsWith('.pem') || part.endsWith('.key'))
}

function shouldCopyCandidatePath(root, path) {
  const relativePath = relative(root, path)
  if (!relativePath) return true
  const parts = relativePath.split('/')
  return !parts.some((part) => ignoredDirectories.has(part)) && !isSensitivePath(relativePath)
}

function runValidation({ cwd, allowedCommands, timeoutMs }) {
  if (!allowedCommands.includes('node --test')) throw new ChangeCaseError('MODEL_PATCH_COMMAND_DENIED', 'Validation requires the exact approved command node --test.')
  return new Promise((resolvePromise) => {
    const child = spawn('node', ['--test'], { cwd, env: { PATH: process.env.PATH, LANG: 'C' }, stdio: ['ignore', 'pipe', 'pipe'], shell: false })
    let outputBytes = 0
    const capture = (chunk) => { outputBytes += chunk.length }
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, timeoutMs)
    child.stdout.on('data', capture); child.stderr.on('data', capture)
    child.once('close', (code, signal) => { clearTimeout(timeout); resolvePromise(Object.freeze({ code: code ?? 1, signal, timedOut, outputBytes: Math.min(outputBytes, 64 * 1024), outputDigest: sha256({ code, signal, outputBytes: Math.min(outputBytes, 64 * 1024) }) })) })
  })
}

async function digestTree(root) {
  const files = []
  async function collect(current) { for (const entry of await readdir(current, { withFileTypes: true })) { const fullPath = join(current, entry.name); if (entry.isDirectory()) await collect(fullPath); else if (entry.isFile()) { const bytes = await readFile(fullPath); files.push({ path: relative(root, fullPath), bytes: bytes.length, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` }) } } }
  await collect(root)
  return sha256(files.sort((left, right) => left.path.localeCompare(right.path)))
}
