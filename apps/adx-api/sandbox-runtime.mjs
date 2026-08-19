import { access, cp, lstat, mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { platform } from 'node:os'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { ChangeCaseError, sha256 } from './change-case-ledger.mjs'
import { verifyExecutionLease } from './execution-governance.mjs'

/**
 * A fail-closed macOS substrate adapter. It never executes directly on the
 * host: callers must receive an OS sandbox profile or an explicit denial.
 * Linux/production runtimes must supply an equivalent hardened adapter.
 */
export async function provisionSandbox({ lease, resolvePublicKey, worktrees, runtimeImageDigest, command, now = new Date() }) {
  verifyExecutionLease(lease, resolvePublicKey, { now })
  if (platform() !== 'darwin') throw new ChangeCaseError('SANDBOX_SUBSTRATE_UNAVAILABLE', 'No supported OS-level sandbox substrate is available on this host.', { severity: 'error' })
  if (typeof runtimeImageDigest !== 'string' || !runtimeImageDigest.startsWith('sha256:')) throw new ChangeCaseError('SANDBOX_PROVENANCE_REQUIRED', 'A signed runtime image digest is required.')
  if (!Array.isArray(command) || !command.length || !command.every((part) => typeof part === 'string' && part.length)) throw new ChangeCaseError('SANDBOX_COMMAND_INVALID', 'Sandbox commands must be a non-empty argument vector.')
  const mounts = await canonicalMounts(lease.repositories, worktrees)
  const mountInputDigest = sha256({ repositories: mounts.map(({ repositoryId, root, writeRoots }) => ({ repositoryId, root, writeRoots })) })
  return Object.freeze({ enforcement: 'OS_SANDBOX_EXEC', leaseId: lease.leaseId, runtimeImageDigest, mountInputDigest, mounts, command: [...command], maxOutputBytes: lease.limits.maxOutputBytes, timeoutMs: executionTimeoutMs(lease, now), profile: buildMacSandboxProfile(mounts) })
}

export async function executeSandbox(plan, { onOutput, signal } = {}) {
  if (plan?.enforcement !== 'OS_SANDBOX_EXEC' || platform() !== 'darwin') throw new ChangeCaseError('SANDBOX_SUBSTRATE_UNAVAILABLE', 'Sandbox execution is unavailable without a supported OS substrate.', { severity: 'error' })
  return new Promise((resolvePromise, reject) => {
    const child = spawn('/usr/bin/sandbox-exec', ['-p', plan.profile, ...plan.command], { cwd: plan.mounts[0]?.root, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C' }, stdio: ['ignore', 'pipe', 'pipe'], shell: false })
    let outputBytes = 0; let quotaExceeded = false; let timedOut = false; let cancelled = false; const stop = () => child.kill('SIGTERM'); const timeout = setTimeout(() => { timedOut = true; stop() }, plan.timeoutMs); const abort = () => { cancelled = true; stop() }; signal?.addEventListener('abort', abort, { once: true }); const output = (chunk) => { const remaining = Math.max(0, plan.maxOutputBytes - outputBytes); outputBytes += chunk.length; if (remaining > 0) onOutput?.(chunk.subarray(0, remaining)); if (outputBytes > plan.maxOutputBytes && !quotaExceeded) { quotaExceeded = true; stop() } }
    child.stdout.on('data', output); child.stderr.on('data', output)
    child.once('error', (error) => reject(new ChangeCaseError('SANDBOX_EXECUTION_FAILED', 'OS sandbox process could not start.', { severity: 'error', details: { cause: error.message } })))
    child.once('close', (code, closeSignal) => { clearTimeout(timeout); signal?.removeEventListener('abort', abort); resolvePromise(Object.freeze({ code, signal: closeSignal, outputBytes: Math.min(outputBytes, plan.maxOutputBytes), quotaExceeded, timedOut, cancelled })) })
  })
}

/** Docker Desktop is a Linux-VM substrate on this host. The image must be digest-pinned. */
export async function provisionDockerSandbox({ lease, resolvePublicKey, worktrees, image, command, now = new Date() }) {
  verifyExecutionLease(lease, resolvePublicKey, { now })
  if (typeof image !== 'string' || !image.includes('@sha256:')) throw new ChangeCaseError('SANDBOX_PROVENANCE_REQUIRED', 'Docker sandbox images must be digest-pinned.')
  const runtimeImageDigest = `sha256:${image.split('@sha256:')[1]}`
  if (!Array.isArray(command) || !command.length || !command.every((part) => typeof part === 'string' && part.length)) throw new ChangeCaseError('SANDBOX_COMMAND_INVALID', 'Sandbox commands must be a non-empty argument vector.')
  const sourceMounts = await canonicalMounts(lease.repositories, worktrees)
  const mountInputDigest = sha256({ repositories: sourceMounts.map(({ repositoryId, root, writeRoots }) => ({ repositoryId, root, writeRoots })) })
  const mounts = await materializeCopyOnWriteMounts(sourceMounts)
  // The input checkout is not charged to the lease: the quota covers bytes
  // introduced into its writable scope by this execution.  This lets a small
  // bounded change run against an existing repository without treating the
  // repository itself as agent-produced output.
  const workspaceBaseline = await snapshotWritableBytes(mounts)
  return Object.freeze({ enforcement: 'DOCKER_HARDENED_CONTAINER', leaseId: lease.leaseId, runtimeImageDigest, mountInputDigest, mounts, image, command: [...command], maxOutputBytes: lease.limits.maxOutputBytes, maxWorkspaceBytes: lease.limits.maxWorkspaceBytes, workspaceBaseline, timeoutMs: executionTimeoutMs(lease, now), scratchRoot: mounts[0]?.scratchRoot, dockerArgs: buildDockerArgs({ mounts, limits: lease.limits, image, command }) })
}

export function buildDockerArgs({ mounts, limits, image, command }) {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 65534; const gid = typeof process.getgid === 'function' ? process.getgid() : 65534
  if (uid === 0) throw new ChangeCaseError('SANDBOX_ROOT_IDENTITY_DENIED', 'A hardened Docker sandbox cannot run as root.')
  const fileBytes = limits.maxWorkspaceBytes; const args = ['run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--pids-limit', String(Math.min(64, limits.maxToolCalls + 8)), '--memory', '512m', '--cpus', '1', '--ulimit', 'nofile=64:64', '--ulimit', `fsize=${fileBytes}:${fileBytes}`, '--user', `${uid}:${gid}`, '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m']
  for (const mount of mounts) {
    const target = `/workspace/${mount.repositoryId}`
    args.push('--mount', `type=bind,src=${mount.root},dst=${target},readonly`)
    for (const writeRoot of mount.writeRoots) args.push('--mount', `type=bind,src=${writeRoot},dst=${target}/${relative(mount.root, writeRoot)},readonly=false`)
  }
  args.push('--workdir', `/workspace/${mounts[0].repositoryId}`, image, ...command)
  return Object.freeze(args)
}

export async function executeDockerSandbox(plan, { onOutput, signal } = {}) {
  if (plan?.enforcement !== 'DOCKER_HARDENED_CONTAINER') throw new ChangeCaseError('SANDBOX_SUBSTRATE_UNAVAILABLE', 'A hardened Docker sandbox plan is required.', { severity: 'error' })
  return new Promise((resolvePromise, reject) => {
    const child = spawn('docker', plan.dockerArgs, { env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'], shell: false })
    let outputBytes = 0; let quotaExceeded = false; let workspaceQuotaExceeded = false; let workspaceBytes = 0; let timedOut = false; let cancelled = false; let checkingWorkspace = false; const stop = () => child.kill('SIGTERM'); const timeout = setTimeout(() => { timedOut = true; stop() }, plan.timeoutMs); const abort = () => { cancelled = true; stop() }; signal?.addEventListener('abort', abort, { once: true }); const output = (chunk) => { const remaining = Math.max(0, plan.maxOutputBytes - outputBytes); outputBytes += chunk.length; if (remaining > 0) onOutput?.(chunk.subarray(0, remaining)); if (outputBytes > plan.maxOutputBytes && !quotaExceeded) { quotaExceeded = true; stop() } }
    // Docker bind mounts cannot carry a portable project quota.  The trusted
    // substrate watches only the disposable COW mount and kills the container
    // as soon as aggregate new/expanded writable bytes exceed the signed cap.
    const workspaceMonitor = setInterval(async () => {
      if (checkingWorkspace || workspaceQuotaExceeded) return
      checkingWorkspace = true
      try {
        workspaceBytes = await workspaceDeltaBytes(plan.mounts, plan.workspaceBaseline)
        if (workspaceBytes > plan.maxWorkspaceBytes) { workspaceQuotaExceeded = true; quotaExceeded = true; stop() }
      } finally { checkingWorkspace = false }
    }, 10)
    child.stdout.on('data', output); child.stderr.on('data', output)
    child.once('error', async (error) => { clearTimeout(timeout); clearInterval(workspaceMonitor); signal?.removeEventListener('abort', abort); await cleanupSandbox(plan); reject(new ChangeCaseError('SANDBOX_EXECUTION_FAILED', 'Hardened Docker sandbox process could not start.', { severity: 'error', details: { cause: error.message } })) })
    child.once('close', async (code, closeSignal) => { clearTimeout(timeout); clearInterval(workspaceMonitor); signal?.removeEventListener('abort', abort); workspaceBytes = await workspaceDeltaBytes(plan.mounts, plan.workspaceBaseline); if (workspaceBytes > plan.maxWorkspaceBytes) { workspaceQuotaExceeded = true; quotaExceeded = true } const artifacts = await collectArtifacts(plan.mounts); await cleanupSandbox(plan); resolvePromise(Object.freeze({ code, signal: closeSignal, outputBytes: Math.min(outputBytes, plan.maxOutputBytes), quotaExceeded, workspaceQuotaExceeded, workspaceBytes, timedOut, cancelled, artifacts })) })
  })
}

export function buildMacSandboxProfile(mounts) {
  const readable = mounts.flatMap((mount) => [mount.root, ...systemReadPaths])
  const writable = mounts.flatMap((mount) => mount.writeRoots)
  const clauses = ['(version 1)', '(deny default)', '(allow process*)', ...readable.map((path) => `(allow file-read* (subpath ${quote(path)}))`), ...writable.map((path) => `(allow file-write* (subpath ${quote(path)}))`)]
  return clauses.join('\n')
}

const systemReadPaths = Object.freeze(['/System', '/usr', '/bin', '/sbin', '/Library/Apple'])
const quote = (value) => JSON.stringify(value)

async function canonicalMounts(repositories, worktrees) {
  if (!worktrees || typeof worktrees !== 'object') throw new ChangeCaseError('SANDBOX_WORKTREE_REQUIRED', 'A checked-out worktree is required for every leased repository.')
  const mounts = []
  for (const repository of repositories) {
    const configured = worktrees[repository.repositoryId]
    if (typeof configured !== 'string') throw new ChangeCaseError('SANDBOX_WORKTREE_REQUIRED', 'A checked-out worktree is required for every leased repository.')
    await access(configured, constants.R_OK)
    const root = await realpath(configured); const writeRoots = []
    for (const pattern of repository.writePaths) {
      const prefix = pattern.endsWith('/**') ? pattern.slice(0, -3) : pattern
      const candidate = resolve(root, prefix)
      if (!isDescendant(root, candidate)) throw new ChangeCaseError('SANDBOX_MOUNT_ESCAPE', 'Write mount escapes the checked-out repository.', { severity: 'error' })
      writeRoots.push(candidate)
    }
    mounts.push(Object.freeze({ repositoryId: repository.repositoryId, root, writeRoots: Object.freeze(writeRoots) }))
  }
  return Object.freeze(mounts)
}
async function materializeCopyOnWriteMounts(mounts) {
  const scratchRoot = await mkdtemp(join(tmpdir(), 'adx-sandbox-cow-'))
  try {
    const copied = []
    for (const mount of mounts) {
      const root = join(scratchRoot, mount.repositoryId); await cp(mount.root, root, { recursive: true, dereference: false, verbatimSymlinks: true })
      copied.push(Object.freeze({ repositoryId: mount.repositoryId, root, writeRoots: Object.freeze(mount.writeRoots.map((writeRoot) => resolve(root, relative(mount.root, writeRoot)))), scratchRoot }))
    }
    return Object.freeze(copied)
  } catch (error) { await rm(scratchRoot, { recursive: true, force: true }); throw error }
}
async function cleanupSandbox(plan) { if (plan.scratchRoot) await rm(plan.scratchRoot, { recursive: true, force: true }).catch(() => {}) }
async function collectArtifacts(mounts) {
  const artifacts = []
  for (const mount of mounts) for (const writeRoot of mount.writeRoots) await collectFiles(writeRoot, writeRoot, artifacts)
  return Object.freeze(artifacts.sort((left, right) => left.path.localeCompare(right.path)))
}
async function snapshotWritableBytes(mounts) {
  const snapshot = new Map()
  for (const mount of mounts) for (const writeRoot of mount.writeRoots) await recordFileBytes(writeRoot, writeRoot, snapshot)
  return snapshot
}
async function workspaceDeltaBytes(mounts, baseline = new Map()) {
  const current = new Map(); for (const mount of mounts) for (const writeRoot of mount.writeRoots) await recordFileBytes(writeRoot, writeRoot, current)
  let bytes = 0; for (const [path, size] of current) bytes += Math.max(0, size - (baseline.get(path) ?? 0))
  return bytes
}
async function recordFileBytes(root, current, files) {
  const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) { const fullPath = join(current, entry.name); if (entry.isDirectory()) await recordFileBytes(root, fullPath, files); else if (entry.isFile()) files.set(fullPath, (await lstat(fullPath)).size) }
}
async function collectFiles(root, current, artifacts) {
  const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const fullPath = join(current, entry.name); const relativePath = relative(root, fullPath)
    if (entry.isDirectory()) await collectFiles(root, fullPath, artifacts)
    else if (entry.isFile()) { const stat = await lstat(fullPath); const digest = createHash('sha256').update(await readFile(fullPath)).digest('hex'); artifacts.push(Object.freeze({ path: relativePath, bytes: stat.size, digest: `sha256:${digest}` })) }
  }
}
function isDescendant(root, candidate) { const path = relative(root, candidate); return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !path.includes(`..${sep}`)) }
function executionTimeoutMs(lease, now) { return Math.max(1, Math.min(lease.limits.maxDurationSeconds * 1000, Date.parse(lease.expiresAt) - now.getTime())) }
