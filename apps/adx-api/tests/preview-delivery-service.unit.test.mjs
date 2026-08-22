import assert from 'node:assert/strict'
import test from 'node:test'
import { createPreviewDeliveryService } from '../preview-delivery-service.mjs'

const scope = { organizationId: 'org', workspaceId: 'workspace' }
const changeCase = { id: 'case-1', title: 'Care day workspace', state: 'READY_FOR_DELIVERY' }
const binding = { candidateDigest: 'sha256:candidate', evidenceDigest: 'sha256:evidence' }

function service({ evidence = [{ status: 'PASS', ...binding }], timeline = [{ eventType: 'ChangeCaseVerificationCompleted.v1', payload: binding }] } = {}) {
  const retained = []
  return {
    retained,
    prepare: createPreviewDeliveryService({
      providerId: 'local-preview',
      repositories: [{ repositoryId: 'health-x', canonicalRemote: 'https://example.test/health-x.git', defaultBaseRef: 'refs/heads/main' }],
      deliveryRepository: { retain: async (input) => { retained.push(input); return { accepted: true, previewPlanId: 'plan-1' } } },
      evidenceRepository: { list: async () => evidence },
      changeCaseRepository: { intakeView: async () => ({ intent: { targetRepository: 'health-x' } }) },
      servicePrincipal: { type: 'service', id: 'delivery-preview-service' },
    }).prepare({ scope, changeCase, timeline }),
  }
}

test('prepares a server-owned preview-only plan from the exact Gate D binding', async () => {
  const prepared = service()
  const result = await prepared.prepare
  assert.equal(result.previewPlanId, 'plan-1')
  assert.equal(prepared.retained[0].principal.type, 'service')
  assert.equal(prepared.retained[0].plan.mode, 'PREVIEW_ONLY')
  assert.equal(prepared.retained[0].plan.candidateDigest, binding.candidateDigest)
  assert.equal(prepared.retained[0].plan.evidenceDigest, binding.evidenceDigest)
  assert.equal(prepared.retained[0].plan.repository.repositoryId, 'health-x')
})

test('rejects a plan when Gate D evidence is no longer retained', async () => {
  const prepared = service({ evidence: [] })
  await assert.rejects(prepared.prepare, { code: 'DELIVERY_PREVIEW_EVIDENCE_STALE' })
})
