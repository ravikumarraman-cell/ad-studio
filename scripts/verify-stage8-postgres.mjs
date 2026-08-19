import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { loadLocalEnv } from './load-local-env.mjs'
import { createPreviewDeliveryPlan, createPreviewGitProvider } from '../apps/adx-api/git-delivery-preview.mjs'
import { PostgresPreviewDeliveryRepository } from '../apps/adx-api/git-delivery-repository.mjs'
import { createReleaseCandidate, releaseApprovalDigest } from '../apps/adx-api/release-candidate.mjs'
import { PostgresReleaseCandidateRepository } from '../apps/adx-api/release-candidate-repository.mjs'

await loadLocalEnv()
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED_FOR_STAGE8_POSTGRES_VERIFICATION')
const scope = { organizationId: '11111111-1111-4111-8111-111111111111', workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
const otherScope = { organizationId: '22222222-2222-4222-8222-222222222222', workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }
const changeCaseId = randomUUID()
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 })
const previewRepository = new PostgresPreviewDeliveryRepository({ connectionString: process.env.DATABASE_URL })
const releaseRepository = new PostgresReleaseCandidateRepository({ connectionString: process.env.DATABASE_URL })
const scoped = async (target, work) => { const client = await pool.connect(); try { await client.query('BEGIN'); await client.query("SELECT set_config('adx.organization_id',$1,true),set_config('adx.workspace_id',$2,true)", [target.organizationId, target.workspaceId]); const value = await work(client); await client.query('COMMIT'); return value } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() } }
try {
  await pool.query('INSERT INTO adx_change_case (id,organization_id,workspace_id,title,state,risk_tier,projection_version,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [changeCaseId, scope.organizationId, scope.workspaceId, 'Release candidate persistence proof', 'READY_FOR_DELIVERY', 'R2', 1, 'fixture:stage8'])
  const provider = createPreviewGitProvider({ providerId: 'github-preview', repositories: [{ repositoryId: 'adx-studio', canonicalRemote: 'https://github.com/ravikumarraman-cell/ad-studio.git', defaultBaseRef: 'refs/heads/main' }] })
  const plan = createPreviewDeliveryPlan({ provider, changeCaseId, repositoryId: 'adx-studio', candidateDigest: 'sha256:candidate-stage8', evidenceDigest: 'sha256:evidence-stage8', changes: [{ path: 'release.mjs', digest: 'sha256:release-content' }], title: 'Release proof preview' })
  const retainedPreview = await previewRepository.retain({ scope, principal: { id: 'service:delivery-preview', type: 'service' }, plan })
  const approval = { previewPlanId: retainedPreview.previewPlanId, commitDigest: plan.commitDigest, decision: 'APPROVED', rationale: 'Preview, CI, and evidence have been reviewed.', reviewedBy: 'human:preview-reviewer', status: 'ACTIVE' }
  await scoped(scope, async (client) => {
    await client.query('INSERT INTO adx_evidence_bundle (id,organization_id,workspace_id,change_case_id,evidence,evidence_digest,verifier_id,verifier_version,status,candidate_digest,runtime_image_digest,config_digest,command_digest,signature,signature_key_id,recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)', [randomUUID(), scope.organizationId, scope.workspaceId, changeCaseId, { fixture: 'stage8' }, plan.evidenceDigest, 'fixture-verifier', '1', 'PASS', plan.candidateDigest, 'sha256:runtime', 'sha256:config', 'sha256:command', 'fixture-signature', 'fixture-key', 'service:verifier'])
    await client.query("INSERT INTO adx_git_preview_approval (id,organization_id,workspace_id,preview_plan_id,commit_digest,decision,rationale,reviewed_by,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ACTIVE')", [randomUUID(), scope.organizationId, scope.workspaceId, approval.previewPlanId, approval.commitDigest, approval.decision, approval.rationale, approval.reviewedBy])
  })
  const candidate = createReleaseCandidate({ changeCaseId, previewPlanId: retainedPreview.previewPlanId, artifactDigest: 'sha256:artifact-stage8', candidateDigest: plan.candidateDigest, evidenceDigest: plan.evidenceDigest, commitDigest: plan.commitDigest, approvalDigest: releaseApprovalDigest(approval), policyVersion: 'adx-release-policy-v1' })
  const retained = await releaseRepository.retain({ scope, principal: { id: 'service:release-controller', type: 'service' }, candidate })
  assert.equal(retained.deduplicated, false)
  assert.equal((await releaseRepository.retain({ scope, principal: { id: 'service:release-controller', type: 'service' }, candidate })).deduplicated, true)
  assert.equal((await releaseRepository.list(scope, changeCaseId)).length, 1)
  assert.equal((await releaseRepository.list(otherScope, changeCaseId)).length, 0)
  await assert.rejects(() => releaseRepository.retain({ scope, principal: { id: 'agent:release', type: 'agent' }, candidate }))
  await assert.rejects(() => scoped(scope, (client) => client.query('UPDATE adx_release_candidate SET status=$1 WHERE id=$2', ['CANDIDATE', retained.releaseCandidateId])))
  assert.equal((await releaseRepository.decide({ scope, principal: { id: 'human:release-reviewer', type: 'human' }, releaseCandidateId: retained.releaseCandidateId, provenanceDigest: candidate.provenanceDigest, decision: 'APPROVED', rationale: 'Release candidate provenance reviewed.' })).deduplicated, false)
  assert.equal((await releaseRepository.decide({ scope, principal: { id: 'human:release-reviewer', type: 'human' }, releaseCandidateId: retained.releaseCandidateId, provenanceDigest: candidate.provenanceDigest, decision: 'APPROVED', rationale: 'Release candidate provenance reviewed.' })).deduplicated, true)
  await assert.rejects(() => releaseRepository.decide({ scope, principal: { id: 'human:release-reviewer', type: 'human' }, releaseCandidateId: retained.releaseCandidateId, provenanceDigest: 'sha256:wrong', decision: 'APPROVED', rationale: 'Wrong digest.' }))
  assert.equal((await releaseRepository.authorize({ scope, principal: { id: 'service:release-controller', type: 'service' }, releaseCandidateId: retained.releaseCandidateId, provenanceDigest: candidate.provenanceDigest })).authorized, true)
  console.log('Stage 8 PostgreSQL verification passed: tenant-scoped immutable release candidates, provenance validation, idempotency, and digest-bound human decisions.')
} finally {
  await previewRepository.close()
  await releaseRepository.close()
  await pool.end()
}
