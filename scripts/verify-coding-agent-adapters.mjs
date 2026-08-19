import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { ChangeCaseError } from '../apps/adx-api/change-case-ledger.mjs'
import { createExecutionLease } from '../apps/adx-api/execution-governance.mjs'
import { createClaudeCodeAdapter, createCodingAgentDispatchPreview, createCodexAdapter, createCopilotAdapter, dispatchCodingAgent, validateCodingAgentAdapter } from '../apps/adx-api/coding-agent-adapters.mjs'

const signer = { keyId: 'coding-agent-test-key', ...generateKeyPairSync('ed25519') }
const now = new Date('2026-08-19T12:00:00.000Z')
const capabilities = { shell: true, gitRead: true, gitWrite: true, network: false, secrets: false }
const adapters = [createCodexAdapter({ version: '0.1.0', capabilities }), createClaudeCodeAdapter({ version: '0.1.0', capabilities }), createCopilotAdapter({ version: '0.1.0', capabilities })]
assert.deepEqual(adapters.map((adapter) => adapter.provider), ['CODEX', 'CLAUDE_CODE', 'GITHUB_COPILOT'])
assert.equal(adapters.every((adapter) => adapter.mode === 'DECLARATION_ONLY' && adapter.enabled === false && adapter.capabilities.deploy === false), true)
for (const adapter of adapters) assert.equal(validateCodingAgentAdapter(adapter), adapter)

const adapter = adapters[0]
const lease = createExecutionLease({ changeCaseId: 'cc-coding-agent', principal: { id: 'human:requester' }, repositories: [{ repositoryId: 'repo-1', ref: 'refs/heads/main', writePaths: ['src/**'] }], requestedCapabilities: capabilities, policyCapabilities: capabilities, adapter, limits: { maxDurationSeconds: 300, maxToolCalls: 10, maxCostUsd: 1, maxNetworkBytes: 0, maxOutputBytes: 4096 }, policyVersion: 'execution-policy-v1', signer, now })
const preview = createCodingAgentDispatchPreview({ adapter, lease, resolvePublicKey: (keyId) => keyId === signer.keyId ? signer.publicKey : null, task: { objective: 'Add the bounded requested implementation.', changeDigest: 'sha256:change-request', allowedCommands: ['npm test', 'npm run typecheck'] }, now })
assert.equal(preview.provider, 'CODEX'); assert.equal(preview.command.executable, 'codex'); assert.equal(preview.leaseDigest, lease.leaseDigest)
assert.throws(() => dispatchCodingAgent(), (error) => error instanceof ChangeCaseError && error.code === 'CODING_AGENT_EXECUTOR_DISABLED')
assert.throws(() => createCodingAgentDispatchPreview({ adapter: adapters[1], lease, resolvePublicKey: () => signer.publicKey, task: { objective: 'x', changeDigest: 'sha256:x', allowedCommands: ['npm test'] }, now }), (error) => error instanceof ChangeCaseError && error.code === 'CODING_AGENT_LEASE_ADAPTER_MISMATCH')
assert.throws(() => validateCodingAgentAdapter({ ...adapter, executable: 'sh' }), (error) => error instanceof ChangeCaseError && error.code === 'CODING_AGENT_ADAPTER_TAMPERED')
console.log('Codex, Claude Code, and GitHub Copilot declaration-only adapters, lease binding, preview dispatch, tamper rejection, and live-executor denial verified.')
