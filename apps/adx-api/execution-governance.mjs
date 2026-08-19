import { randomUUID, sign, verify } from 'node:crypto'
import { ChangeCaseError, canonicalJson, sha256 } from './change-case-ledger.mjs'
import { intersectEgress } from './network-governance.mjs'

export const adapterTiers = Object.freeze(['ADVISORY', 'SUPERVISED_IMPLEMENTATION', 'GOVERNED_EXECUTION', 'HIGH_ASSURANCE_EXECUTION'])
export const capabilityNames = Object.freeze(['shell', 'gitRead', 'gitWrite', 'browser', 'network', 'secrets', 'deploy'])
const actionCapability = Object.freeze({ shell: 'shell', git_read: 'gitRead', git_write: 'gitWrite', browser: 'browser', network: 'network', secret_read: 'secrets', deploy: 'deploy' })
const prohibitedCapabilities = new Set(['deploy'])

export function validateAdapterDeclaration(input) {
  if (!input || typeof input.adapterId !== 'string' || !input.adapterId.trim() || typeof input.version !== 'string' || !input.version.trim() || !adapterTiers.includes(input.tier)) throw new ChangeCaseError('AGENT_ADAPTER_INVALID', 'Adapter identifier, version, and supported integration tier are required.')
  const capabilities = normalizeCapabilities(input.capabilities)
  if (input.tier !== 'ADVISORY' && (!input.supportsCancellation || !input.supportsArtifactCollection)) throw new ChangeCaseError('AGENT_ADAPTER_CAPABILITY_INCOMPLETE', 'Implementation adapters must explicitly support cancellation and artifact collection.')
  if (input.tier === 'GOVERNED_EXECUTION' && (!input.supportsToolReceipts || !input.supportsIdempotency || !input.supportsReconciliation)) throw new ChangeCaseError('AGENT_ADAPTER_GOVERNANCE_INCOMPLETE', 'Governed adapters require receipts, idempotency, and reconciliation support.')
  return Object.freeze({ adapterId: input.adapterId.trim(), version: input.version.trim(), tier: input.tier, capabilities, supportsCancellation: Boolean(input.supportsCancellation), supportsArtifactCollection: Boolean(input.supportsArtifactCollection), supportsToolReceipts: Boolean(input.supportsToolReceipts), supportsIdempotency: Boolean(input.supportsIdempotency), supportsReconciliation: Boolean(input.supportsReconciliation) })
}

export function createExecutionLease({ changeCaseId, principal, repositories, requestedCapabilities, requestedEgress = [], policyEgress = [], requestedSecrets = [], policySecrets = [], adapter, policyCapabilities, limits, policyVersion, signer, now = new Date(), durationSeconds = 900, leaseId = randomUUID() }) {
  if (!changeCaseId || !principal?.id || !signer?.privateKey || !signer?.keyId) throw new ChangeCaseError('EXECUTION_LEASE_INVALID', 'Change Case, principal, and signing authority are required for an execution lease.')
  if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 3600) throw new ChangeCaseError('EXECUTION_LEASE_DURATION_INVALID', 'Execution leases must be between one second and one hour.')
  const declaration = validateAdapterDeclaration(adapter)
  if (!['SUPERVISED_IMPLEMENTATION', 'GOVERNED_EXECUTION', 'HIGH_ASSURANCE_EXECUTION'].includes(declaration.tier)) throw new ChangeCaseError('EXECUTION_LEASE_ADAPTER_TIER_DENIED', 'Advisory adapters cannot receive an execution lease.')
  const normalizedRepositories = normalizeRepositories(repositories)
  const capabilities = intersectCapabilities(normalizeCapabilities(requestedCapabilities), declaration.capabilities, normalizeCapabilities(policyCapabilities))
  if (capabilities.deploy) throw new ChangeCaseError('EXECUTION_LEASE_DEPLOYMENT_DENIED', 'An execution lease cannot grant deployment authority.')
  const normalizedLimits = normalizeLimits(limits)
  const issuedAt = now.toISOString(); const expiresAt = new Date(now.getTime() + durationSeconds * 1000).toISOString()
  const egress = capabilities.network ? intersectEgress(requestedEgress, policyEgress) : []
  const secretScopes = capabilities.secrets ? intersectSecretScopes(requestedSecrets, policySecrets) : []
  const unsigned = { leaseId, changeCaseId, principal: principal.id, issuedAt, expiresAt, repositories: normalizedRepositories, capabilities, egress, secretScopes, limits: normalizedLimits, adapter: { adapterId: declaration.adapterId, version: declaration.version, tier: declaration.tier }, policyVersion: String(policyVersion ?? '').trim() }
  if (!unsigned.policyVersion) throw new ChangeCaseError('EXECUTION_LEASE_POLICY_REQUIRED', 'A policy version is required for an execution lease.')
  const digest = sha256({ schema: 'adx-execution-lease-v1', lease: unsigned })
  return Object.freeze({ ...unsigned, leaseDigest: digest, signature: sign(null, Buffer.from(digest), signer.privateKey).toString('base64url'), signatureKeyId: signer.keyId })
}

export function verifyExecutionLease(lease, resolvePublicKey, { now = new Date() } = {}) {
  if (!lease || !lease.leaseDigest || !lease.signature || !lease.signatureKeyId) throw new ChangeCaseError('EXECUTION_LEASE_INVALID', 'Execution lease attestation is incomplete.', { severity: 'error' })
  const { leaseDigest, signature, signatureKeyId, ...unsigned } = lease
  const expected = sha256({ schema: 'adx-execution-lease-v1', lease: unsigned })
  if (leaseDigest !== expected) throw new ChangeCaseError('EXECUTION_LEASE_TAMPERED', 'Execution lease digest does not match its signed authority.', { severity: 'error' })
  const publicKey = resolvePublicKey?.(signatureKeyId)
  if (!publicKey || !verify(null, Buffer.from(leaseDigest), publicKey, Buffer.from(signature, 'base64url'))) throw new ChangeCaseError('EXECUTION_LEASE_SIGNATURE_INVALID', 'Execution lease signature cannot be verified.', { severity: 'error' })
  if (Date.parse(lease.expiresAt) <= now.getTime()) throw new ChangeCaseError('EXECUTION_LEASE_EXPIRED', 'Execution lease has expired.')
  return Object.freeze({ ...lease, canonical: canonicalJson(unsigned) })
}

export function authorizeLeaseAction({ lease, action, repositoryId, path, now = new Date(), revoked = false }) {
  if (revoked) throw new ChangeCaseError('EXECUTION_LEASE_REVOKED', 'Execution lease was revoked by the kill switch.', { severity: 'error' })
  if (Date.parse(lease?.expiresAt) <= now.getTime()) throw new ChangeCaseError('EXECUTION_LEASE_EXPIRED', 'Execution lease has expired.')
  const capability = actionCapability[action]
  if (!capability || !lease.capabilities?.[capability] || prohibitedCapabilities.has(capability)) throw new ChangeCaseError('EXECUTION_ACTION_DENIED', 'The execution lease does not permit this action.')
  if (action === 'git_write' && !isWritablePath(lease.repositories, repositoryId, path)) throw new ChangeCaseError('EXECUTION_WRITE_PATH_DENIED', 'The execution lease does not permit writing this path.')
  return true
}

function normalizeCapabilities(value) {
  const source = value && typeof value === 'object' ? value : {}
  return Object.freeze(Object.fromEntries(capabilityNames.map((name) => [name, Boolean(source[name]) && !prohibitedCapabilities.has(name)])))
}
function intersectCapabilities(...sets) { return Object.freeze(Object.fromEntries(capabilityNames.map((name) => [name, sets.every((set) => set[name] === true) && !prohibitedCapabilities.has(name)]))) }
function normalizeRepositories(repositories) {
  if (!Array.isArray(repositories) || !repositories.length) throw new ChangeCaseError('EXECUTION_REPOSITORY_REQUIRED', 'At least one repository scope is required for execution.')
  return Object.freeze(repositories.map((repository) => {
    if (!repository?.repositoryId || typeof repository.ref !== 'string' || !repository.ref.startsWith('refs/') || !Array.isArray(repository.writePaths)) throw new ChangeCaseError('EXECUTION_REPOSITORY_INVALID', 'Repository identifier, ref, and write paths are required.')
    const writePaths = repository.writePaths.map(normalizeRelativePath)
    return Object.freeze({ repositoryId: String(repository.repositoryId), ref: repository.ref, writePaths })
  }))
}
function normalizeRelativePath(path) {
  if (typeof path !== 'string' || !path.trim() || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) throw new ChangeCaseError('EXECUTION_WRITE_PATH_INVALID', 'Write paths must be relative, canonical POSIX paths.')
  return path.trim()
}
function isWritablePath(repositories, repositoryId, path) {
  if (typeof path !== 'string' || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) return false
  const repository = repositories?.find((item) => item.repositoryId === repositoryId)
  return Boolean(repository?.writePaths.some((pattern) => pattern.endsWith('/**') ? path.startsWith(pattern.slice(0, -3)) : path === pattern))
}
function normalizeLimits(limits) {
  const value = limits && typeof limits === 'object' ? limits : {}
  const normalized = { maxDurationSeconds: Number(value.maxDurationSeconds), maxToolCalls: Number(value.maxToolCalls), maxCostUsd: Number(value.maxCostUsd), maxNetworkBytes: Number(value.maxNetworkBytes), maxOutputBytes: Number(value.maxOutputBytes), maxWorkspaceBytes: Number(value.maxWorkspaceBytes ?? 1024 * 1024) }
  if (!Number.isInteger(normalized.maxDurationSeconds) || normalized.maxDurationSeconds < 1 || normalized.maxDurationSeconds > 3600 || !Number.isInteger(normalized.maxToolCalls) || normalized.maxToolCalls < 1 || !Number.isFinite(normalized.maxCostUsd) || normalized.maxCostUsd < 0 || !Number.isInteger(normalized.maxNetworkBytes) || normalized.maxNetworkBytes < 0 || !Number.isInteger(normalized.maxOutputBytes) || normalized.maxOutputBytes < 1 || normalized.maxOutputBytes > 10 * 1024 * 1024 || !Number.isInteger(normalized.maxWorkspaceBytes) || normalized.maxWorkspaceBytes < 1024 || normalized.maxWorkspaceBytes > 64 * 1024 * 1024) throw new ChangeCaseError('EXECUTION_LIMITS_INVALID', 'Execution lease limits are invalid.')
  return Object.freeze(normalized)
}
function intersectSecretScopes(requested, policy) {
  const normalize = (items) => { if (!Array.isArray(items)) throw new ChangeCaseError('EXECUTION_SECRET_SCOPE_INVALID', 'Secret scopes must be an array.'); return items.map((item) => { if (!item || typeof item.name !== 'string' || typeof item.audience !== 'string' || !item.name.trim() || !item.audience.trim()) throw new ChangeCaseError('EXECUTION_SECRET_SCOPE_INVALID', 'Secret scopes require a name and audience.'); return { name: item.name.trim(), audience: item.audience.trim() } }) }
  const policyScopes = normalize(policy); return Object.freeze(normalize(requested).filter((scope) => policyScopes.some((candidate) => candidate.name === scope.name && candidate.audience === scope.audience)))
}
