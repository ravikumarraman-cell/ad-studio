import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createExecutionLease } from '../apps/adx-api/execution-governance.mjs'
import { provisionSandbox } from '../apps/adx-api/sandbox-runtime.mjs'
import { ChangeCaseError } from '../apps/adx-api/change-case-ledger.mjs'

const signer = { keyId: 'stage5-sandbox-test', ...generateKeyPairSync('ed25519') }; const root = await mkdtemp(join(tmpdir(), 'adx-stage5-'))
try {
  await mkdir(join(root, 'src')); const adapter = { adapterId: 'sandbox-test', version: '1', tier: 'SUPERVISED_IMPLEMENTATION', capabilities: { shell: true, gitRead: true, gitWrite: true }, supportsCancellation: true, supportsArtifactCollection: true }
  const lease = createExecutionLease({ changeCaseId: 'cc-sandbox', principal: { id: 'agent:test' }, repositories: [{ repositoryId: 'repo-1', ref: 'refs/heads/test', writePaths: ['src/**'] }], requestedCapabilities: { shell: true, gitRead: true, gitWrite: true }, adapter, policyCapabilities: { shell: true, gitRead: true, gitWrite: true }, limits: { maxDurationSeconds: 60, maxToolCalls: 1, maxCostUsd: 0, maxNetworkBytes: 0, maxOutputBytes: 65536 }, policyVersion: 'adx-execution-v1', signer })
  const plan = await provisionSandbox({ lease, resolvePublicKey: (keyId) => keyId === signer.keyId ? signer.publicKey : null, worktrees: { 'repo-1': root }, runtimeImageDigest: 'sha256:local-hardened-runtime', command: ['/bin/echo', 'bounded'] })
  assert.equal(plan.enforcement, 'OS_SANDBOX_EXEC'); assert.match(plan.mountInputDigest, /^sha256:/); assert.match(plan.profile, /\(deny default\)/); assert.match(plan.profile, /src/); assert.doesNotMatch(plan.profile, /network/)
  await assert.rejects(() => provisionSandbox({ lease, resolvePublicKey: () => signer.publicKey, worktrees: {}, runtimeImageDigest: 'sha256:x', command: ['/bin/echo'] }), (error) => error instanceof ChangeCaseError && error.code === 'SANDBOX_WORKTREE_REQUIRED')
  console.log('Stage 5 fail-closed OS sandbox plan, runtime provenance, canonical mount, and default-deny profile verification passed.')
} finally { await rm(root, { recursive: true, force: true }) }
