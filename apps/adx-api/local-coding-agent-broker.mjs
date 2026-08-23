import { cp, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { ChangeCaseError, sha256 } from './change-case-ledger.mjs'
import { validateCodingAgentAdapter } from './coding-agent-adapters.mjs'

export class LocalCodingAgentBroker {
  constructor({ enabled = process.env.ADX_LOCAL_CODING_AGENT_ENABLED === '1', sourceRoot = process.env.ADX_LOCAL_CODING_AGENT_SOURCE_ROOT, candidateRoot = process.env.ADX_LOCAL_VERIFIER_CANDIDATE_ROOT, run = runProvider } = {}) {
    this.enabled = enabled
    this.sourceRoot = sourceRoot
    this.candidateRoot = candidateRoot
    this.run = run
  }

  configured() {
    return Boolean(this.enabled && this.sourceRoot && this.candidateRoot)
  }

  async execute({ adapter, task, timeoutMs = 900_000 }) {
    if (!this.enabled) throw new ChangeCaseError('CODING_AGENT_EXECUTOR_DISABLED', 'Local coding-agent execution is disabled. An administrator must explicitly enable the broker.')
    const provider = validateCodingAgentAdapter(adapter)
    const source = await checkedOutRoot(this.sourceRoot, 'CODING_AGENT_SOURCE_REQUIRED')
    const candidate = resolve(this.candidateRoot ?? '')
    if (!candidate || candidate === resolve('/') || source === candidate || source.startsWith(`${candidate}/`)) throw new ChangeCaseError('CODING_AGENT_CANDIDATE_INVALID', 'The execution candidate must be a separate server-configured checkout path.')
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) throw new ChangeCaseError('CODING_AGENT_TIMEOUT_INVALID', 'Coding-agent execution requires a timeout between one millisecond and one hour.')
    const normalizedTask = normalizeTask(task)
    const scratchRoot = await mkdtemp(join(tmpdir(), 'adx-agent-run-'))
    const workspace = join(scratchRoot, basename(candidate) || 'candidate')
    try {
      await cp(source, workspace, { recursive: true, dereference: false, verbatimSymlinks: true })
      await writeFile(join(workspace, '.adx-agent-task.json'), JSON.stringify({ schema: 'adx-local-coding-agent-task-v1', provider: provider.provider, task: normalizedTask }))
      const result = await this.run({ executable: provider.executable, providerArguments: provider.arguments, cwd: workspace, prompt: buildPrompt(normalizedTask), maxOutputBytes: 64 * 1024, timeoutMs })
      if (result.code !== 0 || result.timedOut || result.quotaExceeded) return Object.freeze({ accepted: false, promoted: false, provider: provider.provider, ...result, errorCode: localFailureCode(result), candidateDigest: null })
      await rm(candidate, { recursive: true, force: true })
      await rename(workspace, candidate)
      return Object.freeze({ accepted: true, promoted: true, provider: provider.provider, ...result, candidateDigest: await digestTree(candidate) })
    } finally {
      await rm(scratchRoot, { recursive: true, force: true }).catch(() => {})
    }
  }
}

function localFailureCode(result) {
  if (result.timedOut) return 'CODING_AGENT_RUN_TIMED_OUT'
  if (result.quotaExceeded) return 'CODING_AGENT_OUTPUT_QUOTA_EXCEEDED'
  if (result.signal) return 'CODING_AGENT_RUN_SIGNALED'
  return 'CODING_AGENT_RUN_FAILED'
}

function normalizeTask(task) {
  if (!task || typeof task.objective !== 'string' || !task.objective.trim() || typeof task.changeDigest !== 'string' || !task.changeDigest.startsWith('sha256:')) throw new ChangeCaseError('CODING_AGENT_TASK_INVALID', 'A coding-agent task requires a retained objective and change digest.')
  const allowedCommands = Array.isArray(task.allowedCommands) ? [...new Set(task.allowedCommands.map((command) => String(command).trim()).filter(Boolean))] : []
  if (!allowedCommands.length || allowedCommands.some((command) => command.length > 200)) throw new ChangeCaseError('CODING_AGENT_TASK_INVALID', 'A coding-agent task requires a bounded command allowlist.')
  return Object.freeze({ objective: task.objective.trim(), changeDigest: task.changeDigest, allowedCommands: Object.freeze(allowedCommands.sort()) })
}

function buildPrompt(task) {
  return `Implement the retained ADX Change Case objective in this checkout.\n\nObjective:\n${task.objective}\n\nChange digest: ${task.changeDigest}\n\nYou may use only these validation commands:\n${task.allowedCommands.map((command) => `- ${command}`).join('\n')}\n\nDo not create a pull request, push, merge, deploy, access secrets, or modify files outside this checkout. Explain the changes and validation in your final output.`
}

async function checkedOutRoot(value, errorCode) {
  if (typeof value !== 'string' || !value.trim()) throw new ChangeCaseError(errorCode, 'A server-configured source checkout is required for coding-agent execution.')
  const root = await realpath(value).catch(() => null)
  if (!root) throw new ChangeCaseError(errorCode, 'The server-configured source checkout does not exist.')
  return root
}

function runProvider({ executable, providerArguments, cwd, prompt, maxOutputBytes, timeoutMs }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, providerArguments, { cwd, env: { PATH: process.env.PATH, LANG: 'C' }, stdio: ['pipe', 'pipe', 'pipe'], shell: false })
    let output = ''; let outputBytes = 0; let quotaExceeded = false
    const capture = (chunk) => { const remaining = Math.max(0, maxOutputBytes - outputBytes); outputBytes += chunk.length; if (remaining) output += chunk.subarray(0, remaining); if (outputBytes > maxOutputBytes && !quotaExceeded) { quotaExceeded = true; child.kill('SIGTERM') } }
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, timeoutMs)
    child.stdout.on('data', capture); child.stderr.on('data', capture)
    child.once('error', (error) => reject(new ChangeCaseError('CODING_AGENT_PROVIDER_UNAVAILABLE', 'The selected local coding-agent CLI could not start.', { severity: 'error', details: { cause: error.message } })))
    child.once('close', (code, signal) => { clearTimeout(timeout); resolvePromise(Object.freeze({ code: code ?? 1, signal, output, outputDigest: sha256(output), outputBytes: Math.min(outputBytes, maxOutputBytes), quotaExceeded, timedOut })) })
    child.stdin.end(prompt)
  })
}

async function digestTree(root) {
  const files = []
  const { readdir, readFile } = await import('node:fs/promises')
  async function collect(current) { for (const entry of await readdir(current, { withFileTypes: true })) { const fullPath = join(current, entry.name); if (entry.isDirectory()) await collect(fullPath); else if (entry.isFile()) { const bytes = await readFile(fullPath); files.push({ path: fullPath.slice(root.length + 1), bytes: bytes.length, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` }) } } }
  await collect(root)
  return sha256(files.sort((left, right) => left.path.localeCompare(right.path)))
}