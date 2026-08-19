import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { authorizeLeaseAction, createExecutionLease, validateAdapterDeclaration, verifyExecutionLease } from '../apps/adx-api/execution-governance.mjs'
import { authorizeEgress, authorizeResolvedEgress } from '../apps/adx-api/network-governance.mjs'
import { issueSecretBrokerGrant } from '../apps/adx-api/secret-broker.mjs'
import { ChangeCaseError } from '../apps/adx-api/change-case-ledger.mjs'

const signer = { keyId: 'stage5-test-ed25519', ...generateKeyPairSync('ed25519') }
const adapter = { adapterId: 'test-adapter', version: '1.0.0', tier: 'GOVERNED_EXECUTION', capabilities: { shell: true, gitRead: true, gitWrite: true, network: true, secrets: true, deploy: true }, supportsCancellation: true, supportsArtifactCollection: true, supportsToolReceipts: true, supportsIdempotency: true, supportsReconciliation: true }
assert.equal(validateAdapterDeclaration(adapter).capabilities.deploy, false)
const now = new Date('2026-08-19T01:00:00.000Z')
const lease = createExecutionLease({ changeCaseId: 'cc-stage5', principal: { id: 'agent:implementer' }, repositories: [{ repositoryId: 'repo-1', ref: 'refs/heads/adx/cc-stage5', writePaths: ['src/**', 'tests/**'] }], requestedCapabilities: { shell: true, gitRead: true, gitWrite: true, network: true, secrets: true, deploy: true }, adapter, policyCapabilities: { shell: true, gitRead: true, gitWrite: true, network: false, secrets: false, deploy: false }, limits: { maxDurationSeconds: 900, maxToolCalls: 10, maxCostUsd: 1, maxNetworkBytes: 0, maxOutputBytes: 65536 }, policyVersion: 'adx-execution-v1', signer, now })
assert.equal(lease.capabilities.gitWrite, true); assert.equal(lease.capabilities.network, false); assert.equal(lease.capabilities.secrets, false); assert.equal(lease.capabilities.deploy, false)
verifyExecutionLease(lease, (keyId) => keyId === signer.keyId ? signer.publicKey : null, { now })
assert.doesNotThrow(() => authorizeLeaseAction({ lease, action: 'git_write', repositoryId: 'repo-1', path: 'src/safe.mjs', now }))
for (const denied of [{ action: 'git_write', repositoryId: 'repo-1', path: '../policy.yml' }, { action: 'network' }, { action: 'secret_read' }, { action: 'deploy' }]) assert.throws(() => authorizeLeaseAction({ lease, ...denied, now }), (error) => error instanceof ChangeCaseError)
assert.throws(() => authorizeLeaseAction({ lease, action: 'shell', now: new Date('2026-08-19T01:15:01.000Z') }), (error) => error instanceof ChangeCaseError && error.code === 'EXECUTION_LEASE_EXPIRED')
assert.throws(() => authorizeLeaseAction({ lease, action: 'shell', now, revoked: true }), (error) => error instanceof ChangeCaseError && error.code === 'EXECUTION_LEASE_REVOKED')
const boundedNetworkLease = createExecutionLease({ changeCaseId: 'cc-stage5-network', principal: { id: 'agent:implementer' }, repositories: [{ repositoryId: 'repo-1', ref: 'refs/heads/adx/cc-stage5', writePaths: ['src/**'] }], requestedCapabilities: { network: true, secrets: true }, requestedEgress: [{ host: 'registry.npmjs.org', port: 443 }], policyEgress: [{ host: 'registry.npmjs.org', port: 443 }], requestedSecrets: [{ name: 'npm-token', audience: 'registry.npmjs.org' }], policySecrets: [{ name: 'npm-token', audience: 'registry.npmjs.org' }], adapter, policyCapabilities: { network: true, secrets: true }, limits: { maxDurationSeconds: 900, maxToolCalls: 10, maxCostUsd: 1, maxNetworkBytes: 100, maxOutputBytes: 65536 }, policyVersion: 'adx-execution-v1', signer, now })
assert.equal(authorizeEgress({ lease: boundedNetworkLease, target: { host: 'registry.npmjs.org', port: 443 } }).host, 'registry.npmjs.org')
assert.throws(() => authorizeEgress({ lease: boundedNetworkLease, target: { host: '169.254.169.254', port: 80 } }), (error) => error instanceof ChangeCaseError && error.code === 'EXECUTION_EGRESS_DENIED')
await assert.rejects(() => authorizeResolvedEgress({ lease: boundedNetworkLease, target: { host: 'registry.npmjs.org', port: 443 }, lookup: async () => [{ address: '127.0.0.1', family: 4 }] }), (error) => error instanceof ChangeCaseError && error.code === 'EXECUTION_EGRESS_DENIED')
await assert.rejects(() => authorizeResolvedEgress({ lease: boundedNetworkLease, target: { host: 'registry.npmjs.org', port: 443 }, lookup: async () => [{ address: 'fd00::1', family: 6 }] }), (error) => error instanceof ChangeCaseError && error.code === 'EXECUTION_EGRESS_DENIED')
const grant = issueSecretBrokerGrant({ lease: boundedNetworkLease, secretName: 'npm-token', audience: 'registry.npmjs.org', now }); assert.equal(grant.delivery, 'GATEWAY_ONLY'); assert.equal('value' in grant, false)
assert.throws(() => issueSecretBrokerGrant({ lease: boundedNetworkLease, secretName: 'cloud-token', audience: 'metadata.google.internal', now }), (error) => error instanceof ChangeCaseError && error.code === 'EXECUTION_SECRET_DENIED')
console.log('Stage 5 adapter declaration, signed lease, capability intersection, path boundary, egress/secret scopes, expiry, and kill-switch contract verification passed.')
