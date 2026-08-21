import assert from 'node:assert/strict'
import test from 'node:test'
import { LocalIndependentVerifier } from '../local-independent-verifier.mjs'

const scope = { organizationId: '11111111-1111-4111-8111-111111111111', workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }

test('local verifier fails closed without a server-configured candidate root', async () => {
  const verifier = new LocalIndependentVerifier({ evidenceRepository: {}, signer: { privateKey: {}, keyId: 'test' }, candidateRoot: '' })
  await assert.rejects(() => verifier.verify({ scope, changeCaseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }), { code: 'LOCAL_VERIFIER_CANDIDATE_REQUIRED' })
})

test('local verifier retains service-produced signed evidence', async () => {
  const calls = []
  const evidence = { evidenceDigest: 'sha256:evidence', candidateDigest: 'sha256:candidate', status: 'PASS', verifier: { id: 'adx-local-independent-suite', version: '1.0.0' } }
  const verifier = new LocalIndependentVerifier({
    evidenceRepository: { retain: async (input) => { calls.push(input); return { evidenceId: 'evidence-id', deduplicated: false } }, },
    signer: { privateKey: {}, keyId: 'test' },
    candidateRoot: '/configured/candidate',
    provision: async () => ({ candidateDigest: 'sha256:candidate', runtimeImageDigest: 'sha256:runtime', configDigest: 'sha256:config', verifierId: 'suite', verifierVersion: '1', command: ['true'] }),
    execute: async () => ({ code: 0, outputDigest: 'sha256:output', outputBytes: 0, quotaExceeded: false, timedOut: false, candidateMutated: false }),
    createBundle: () => evidence,
  })
  const result = await verifier.verify({ scope, changeCaseId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })
  assert.equal(result.status, 'PASS')
  assert.equal(result.candidateDigest, 'sha256:candidate')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].principal.type, 'service')
  assert.equal(calls[0].principal.id, 'service:adx-local-independent-verifier')
  assert.equal(calls[0].evidence, evidence)
})