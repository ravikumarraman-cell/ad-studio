import assert from 'node:assert/strict'
import test from 'node:test'
import { CodingAgentExecutionService } from '../coding-agent-execution-service.mjs'

const scope = { organizationId: 'org', workspaceId: 'workspace' }
const principal = { id: 'human:author' }
const changeCase = { id: 'case-1', state: 'READY_FOR_EXECUTION', projectionVersion: 4, title: 'Improve referral status' }
const adapter = { provider: 'LOCAL_TEST', adapterId: 'local-test', version: '1.0.0' }
const policy = {
  version: 'local-test-v1',
  agentPrincipal: { id: 'agent:local-test' },
  repository: { repositoryId: 'repo', ref: 'refs/heads/main', writePaths: ['src/**'] },
  capabilities: { shell: true, gitRead: true, gitWrite: true, browser: false, network: false, secrets: false, deploy: false },
  limits: { maxDurationSeconds: 60, maxToolCalls: 10, maxCostUsd: 0, maxNetworkBytes: 0, maxOutputBytes: 1024, maxWorkspaceBytes: 1024 * 1024 },
  durationSeconds: 60,
  taskFor: (item) => ({ objective: item.title, changeDigest: 'sha256:case-digest', allowedCommands: ['node --test'] })
}

function harness(result) {
  const calls = []
  const executionRepository = {
    issueLease: async (input) => { calls.push(['issueLease', input]); return { leaseId: 'lease-1', runId: 'run-1', status: 'ACTIVE' } },
    dispatchContext: async (input) => { calls.push(['dispatchContext', input]); return { limits: { maxDurationSeconds: 60 } } },
    completeDispatch: async (input) => { calls.push(['completeDispatch', input]); return { status: input.result.code === 0 ? 'COMPLETED' : 'FAILED' } }
  }
  const changeCaseRepository = { transition: async (input) => { calls.push(['transition', input]); return { newState: 'AWAITING_VERIFICATION' } } }
  const broker = { configured: () => true, execute: async () => result }
  const service = new CodingAgentExecutionService({ executionRepository, changeCaseRepository, broker, resolveAdapter: () => adapter, policy })
  return { service, calls }
}

test('successful bounded implementation completes the run then opens independent verification', async () => {
  const { service, calls } = harness({ accepted: true, promoted: true, provider: 'LOCAL_TEST', code: 0, outputDigest: 'sha256:output', outputBytes: 12, candidateDigest: 'sha256:candidate' })
  const outcome = await service.execute({ scope, principal, changeCase, provider: 'LOCAL_TEST', expectedVersion: 4, idempotencyKey: 'execute-1' })
  assert.equal(outcome.accepted, true)
  assert.equal(outcome.transition.newState, 'AWAITING_VERIFICATION')
  assert.deepEqual(calls.map(([name]) => name), ['issueLease', 'dispatchContext', 'completeDispatch', 'transition'])
  assert.deepEqual(calls[2][1].result.artifacts, [{ mediaType: 'application/vnd.adx.candidate-digest', digest: 'sha256:candidate', bytes: 0 }])
})

test('failed implementation retains execution readiness and never transitions to verification', async () => {
  const { service, calls } = harness({ accepted: false, promoted: false, provider: 'LOCAL_TEST', code: 1, outputDigest: 'sha256:output', outputBytes: 12, errorCode: 'MODEL_PATCH_CONTEXT_EMPTY', candidateDigest: null })
  const outcome = await service.execute({ scope, principal, changeCase, provider: 'LOCAL_TEST', expectedVersion: 4, idempotencyKey: 'execute-2' })
  assert.equal(outcome.accepted, false)
  assert.deepEqual(calls.map(([name]) => name), ['issueLease', 'dispatchContext', 'completeDispatch'])
  assert.equal(calls[2][1].result.errorCode, 'MODEL_PATCH_CONTEXT_EMPTY')
})

test('starting bounded implementation returns the run identity before the broker completes', async () => {
  let completeBroker
  const { service, calls } = harness({ accepted: true, promoted: true, provider: 'LOCAL_TEST', code: 0, outputDigest: 'sha256:output', outputBytes: 12, candidateDigest: 'sha256:candidate' })
  service.broker.execute = () => new Promise((resolve) => { completeBroker = resolve })
  const started = await service.start({ scope, principal, changeCase, provider: 'LOCAL_TEST', expectedVersion: 4, idempotencyKey: 'execute-3' })
  assert.deepEqual(started, { accepted: true, lease: { leaseId: 'lease-1', runId: 'run-1', status: 'ACTIVE' }, runId: 'run-1', status: 'LEASED' })
  assert.deepEqual(calls.map(([name]) => name), ['issueLease', 'dispatchContext'])
  completeBroker({ accepted: true, promoted: true, provider: 'LOCAL_TEST', code: 0, outputDigest: 'sha256:output', outputBytes: 12, candidateDigest: 'sha256:candidate' })
})