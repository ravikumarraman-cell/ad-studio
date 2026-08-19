import { cp, lstat, mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createHash, randomUUID, sign, verify } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { ChangeCaseError, sha256 } from './change-case-ledger.mjs'

/**
 * Stage 6's verifier boundary. The candidate is copied into a disposable
 * directory and mounted read-only; verifier output is evidence, never a
 * mutation of the candidate or an implementer self-report.
 */
export async function provisionVerificationSandbox({ candidateRoot, image, adapter, config = {}, now = new Date() }) {
  if (typeof image !== 'string' || !image.includes('@sha256:')) throw new ChangeCaseError('VERIFIER_RUNTIME_PROVENANCE_REQUIRED', 'Verification requires a digest-pinned runtime image.')
  const verifiedAdapter = validateVerifierAdapter(adapter)
  const source = await realpath(candidateRoot).catch(() => null)
  if (!source) throw new ChangeCaseError('VERIFIER_CANDIDATE_REQUIRED', 'A candidate checkout is required for verification.')
  const scratchRoot = await mkdtemp(join(tmpdir(), 'adx-verifier-'))
  try {
    const candidate = join(scratchRoot, 'candidate'); await cp(source, candidate, { recursive: true, dereference: false, verbatimSymlinks: true })
    const candidateDigest = await digestTree(candidate)
    const runtimeImageDigest = `sha256:${image.split('@sha256:')[1]}`
    const configDigest = sha256(config)
    const command = verifiedAdapter.command(config)
    return Object.freeze({ enforcement: 'DOCKER_READONLY_VERIFIER', verifierId: verifiedAdapter.verifierId, verifierVersion: verifiedAdapter.version, verifierCategory: verifiedAdapter.category, tool: verifiedAdapter.tool, candidate, candidateDigest, runtimeImageDigest, configDigest, command, image, scratchRoot, timeoutMs: verifiedAdapter.timeoutMs, maxOutputBytes: verifiedAdapter.maxOutputBytes, dockerArgs: Object.freeze(['run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--pids-limit', '16', '--memory', '512m', '--cpus', '1', '--user', nonRootUser(), '--mount', `type=bind,src=${candidate},dst=/candidate,readonly`, '--workdir', '/candidate', '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m', image, ...command]), createdAt: now.toISOString() })
  } catch (error) { await rm(scratchRoot, { recursive: true, force: true }); throw error }
}

export async function executeVerificationSandbox(plan, { onOutput } = {}) {
  if (plan?.enforcement !== 'DOCKER_READONLY_VERIFIER') throw new ChangeCaseError('VERIFIER_SUBSTRATE_REQUIRED', 'A read-only verification sandbox plan is required.')
  return new Promise((resolvePromise, reject) => {
    const child = spawn('docker', plan.dockerArgs, { env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'], shell: false })
    let output = ''; let outputBytes = 0; let quotaExceeded = false; let timedOut = false; const stop = () => child.kill('SIGTERM'); const timeout = setTimeout(() => { timedOut = true; stop() }, plan.timeoutMs)
    const capture = (chunk) => { const remaining = Math.max(0, plan.maxOutputBytes - outputBytes); outputBytes += chunk.length; if (remaining) { const visible = chunk.subarray(0, remaining); output += visible; onOutput?.(visible) }; if (outputBytes > plan.maxOutputBytes && !quotaExceeded) { quotaExceeded = true; stop() } }
    child.stdout.on('data', capture); child.stderr.on('data', capture)
    child.once('error', async (error) => { clearTimeout(timeout); await cleanupVerification(plan); reject(new ChangeCaseError('VERIFIER_EXECUTION_FAILED', 'Verification sandbox process could not start.', { severity: 'error', details: { cause: error.message } })) })
    child.once('close', async (code, signal) => { clearTimeout(timeout); const postRunDigest = await digestTree(plan.candidate); const candidateMutated = postRunDigest !== plan.candidateDigest; const result = Object.freeze({ code, signal, output, outputBytes: Math.min(outputBytes, plan.maxOutputBytes), quotaExceeded, timedOut, candidateMutated, outputDigest: sha256(output) }); await cleanupVerification(plan); resolvePromise(result) })
  })
}

export function createEvidenceBundle({ plan, result, signer, evidenceId = randomUUID(), now = new Date() }) {
  if (!signer?.privateKey || !signer?.keyId) throw new ChangeCaseError('EVIDENCE_SIGNER_REQUIRED', 'Independent verification evidence must be signed.')
  if (!plan?.candidateDigest || !plan.runtimeImageDigest || !plan.configDigest || !plan.verifierId || !plan.verifierVersion) throw new ChangeCaseError('EVIDENCE_INPUTS_INCOMPLETE', 'Evidence requires pinned candidate, runtime, verifier, and configuration provenance.')
  if (!result || typeof result.code !== 'number' || !result.outputDigest || result.candidateMutated) throw new ChangeCaseError('EVIDENCE_RESULT_INCOMPLETE', 'Evidence cannot pass without an isolated verifier result.')
  const status = result.code === 0 && !result.quotaExceeded && !result.timedOut ? 'PASS' : 'FAIL'
  const unsigned = { evidenceId, schemaVersion: 'adx-evidence-bundle-v1', verifier: { kind: 'INDEPENDENT_VERIFIER', id: plan.verifierId, version: plan.verifierVersion, category: plan.verifierCategory ?? 'CUSTOM', tool: plan.tool ?? { name: plan.verifierId, version: plan.verifierVersion } }, status, candidateDigest: plan.candidateDigest, runtimeImageDigest: plan.runtimeImageDigest, configDigest: plan.configDigest, commandDigest: sha256(plan.command), environment: { enforcement: plan.enforcement, network: 'NONE', candidateMount: 'READ_ONLY' }, result: { exitCode: result.code, signal: result.signal, outputDigest: result.outputDigest, outputBytes: result.outputBytes, quotaExceeded: Boolean(result.quotaExceeded), timedOut: Boolean(result.timedOut), candidateMutated: Boolean(result.candidateMutated) }, createdAt: now.toISOString() }
  const evidenceDigest = sha256(unsigned)
  return Object.freeze({ ...unsigned, evidenceDigest, signature: sign(null, Buffer.from(evidenceDigest), signer.privateKey).toString('base64url'), signatureKeyId: signer.keyId })
}

export function validateEvidencePass(evidence) {
  if (!evidence || evidence.status !== 'PASS' || evidence.verifier?.kind !== 'INDEPENDENT_VERIFIER' || !evidence.candidateDigest || !evidence.runtimeImageDigest || !evidence.configDigest || !evidence.commandDigest || !evidence.result?.outputDigest || evidence.result.candidateMutated || evidence.result.quotaExceeded || evidence.result.timedOut || evidence.result.exitCode !== 0) throw new ChangeCaseError('EVIDENCE_PASS_INVALID', 'A pass requires complete independent, reproducible evidence.')
  return true
}

export function verifyEvidenceBundle(evidence, resolvePublicKey) {
  if (!evidence?.evidenceDigest || !evidence.signature || !evidence.signatureKeyId) throw new ChangeCaseError('EVIDENCE_ATTESTATION_INCOMPLETE', 'Evidence attestation is incomplete.', { severity: 'error' })
  const { evidenceDigest, signature, signatureKeyId, ...unsigned } = evidence
  if (evidenceDigest !== sha256(unsigned)) throw new ChangeCaseError('EVIDENCE_DIGEST_TAMPERED', 'Evidence digest does not match its canonical bundle.', { severity: 'error' })
  const publicKey = resolvePublicKey?.(signatureKeyId)
  if (!publicKey || !verify(null, Buffer.from(evidenceDigest), publicKey, Buffer.from(signature, 'base64url'))) throw new ChangeCaseError('EVIDENCE_SIGNATURE_INVALID', 'Evidence signature cannot be verified.', { severity: 'error' })
  if (!['PASS', 'FAIL'].includes(evidence.status) || evidence.verifier?.kind !== 'INDEPENDENT_VERIFIER' || !evidence.verifier?.tool?.name || !evidence.verifier?.tool?.version || !evidence.candidateDigest || !evidence.runtimeImageDigest || !evidence.configDigest || !evidence.commandDigest || !evidence.result?.outputDigest) throw new ChangeCaseError('EVIDENCE_SCHEMA_INVALID', 'Evidence does not meet the independent-verification schema.')
  if (evidence.status === 'PASS') validateEvidencePass(evidence)
  return true
}

function validateVerifierAdapter(adapter) {
  if (!adapter || typeof adapter.verifierId !== 'string' || !adapter.verifierId.trim() || typeof adapter.version !== 'string' || !adapter.version.trim() || typeof adapter.command !== 'function') throw new ChangeCaseError('VERIFIER_ADAPTER_INVALID', 'Verifier identifier, version, and fixed command factory are required.')
  const timeoutMs = Number(adapter.timeoutMs ?? 60_000); const maxOutputBytes = Number(adapter.maxOutputBytes ?? 65_536)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000 || !Number.isInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 10 * 1024 * 1024) throw new ChangeCaseError('VERIFIER_ADAPTER_INVALID', 'Verifier limits are invalid.')
  const tool = adapter.tool && typeof adapter.tool.name === 'string' && typeof adapter.tool.version === 'string' ? Object.freeze({ name: adapter.tool.name.trim(), version: adapter.tool.version.trim() }) : Object.freeze({ name: adapter.verifierId.trim(), version: adapter.version.trim() })
  return Object.freeze({ verifierId: adapter.verifierId.trim(), version: adapter.version.trim(), category: typeof adapter.category === 'string' ? adapter.category : 'CUSTOM', tool, timeoutMs, maxOutputBytes, command: (config) => { const command = adapter.command(config); if (!Array.isArray(command) || !command.length || !command.every((part) => typeof part === 'string' && part.length)) throw new ChangeCaseError('VERIFIER_COMMAND_INVALID', 'Verifier commands must be a non-empty argument vector.'); return Object.freeze([...command]) } })
}
async function digestTree(root) { const files = []; await collectTree(root, root, files); return sha256(files.sort((left, right) => left.path.localeCompare(right.path))) }
async function collectTree(root, current, files) { for (const entry of await readdir(current, { withFileTypes: true })) { const fullPath = join(current, entry.name); const path = relative(root, fullPath); if (entry.isDirectory()) await collectTree(root, fullPath, files); else if (entry.isFile()) { const bytes = await readFile(fullPath); files.push({ path, bytes: bytes.length, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` }) } else { const stat = await lstat(fullPath); files.push({ path, type: stat.isSymbolicLink() ? 'symlink' : 'other' }) } } }
async function cleanupVerification(plan) { await rm(plan.scratchRoot, { recursive: true, force: true }).catch(() => {}) }
function nonRootUser() { const uid = typeof process.getuid === 'function' ? process.getuid() : 65534; const gid = typeof process.getgid === 'function' ? process.getgid() : 65534; if (uid === 0) throw new ChangeCaseError('VERIFIER_ROOT_IDENTITY_DENIED', 'A verifier cannot run as root.'); return `${uid}:${gid}` }
