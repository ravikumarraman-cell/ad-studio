import assert from 'node:assert/strict'
import { ChangeCaseError, sha256 } from '../apps/adx-api/change-case-ledger.mjs'
import { createReleaseCandidate, ReleaseCandidateRegistry, releaseApprovalDigest, verifyReleaseProvenance } from '../apps/adx-api/release-candidate.mjs'

const changeCaseId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const previewPlan = { id: 'preview-1', changeCaseId, candidateDigest: 'sha256:candidate-v1', evidenceDigest: 'sha256:evidence-v1', commitDigest: 'sha256:commit-v1' }
const evidence = { status: 'PASS', candidateDigest: previewPlan.candidateDigest, evidenceDigest: previewPlan.evidenceDigest }
const approval = { previewPlanId: previewPlan.id, commitDigest: previewPlan.commitDigest, decision: 'APPROVED', rationale: 'Independent review accepted this exact commit.', reviewedBy: 'oidc:reviewer', status: 'ACTIVE' }
const candidate = createReleaseCandidate({ changeCaseId, previewPlanId: previewPlan.id, artifactDigest: 'sha256:artifact-v1', candidateDigest: previewPlan.candidateDigest, evidenceDigest: previewPlan.evidenceDigest, commitDigest: previewPlan.commitDigest, approvalDigest: releaseApprovalDigest(approval), policyVersion: 'adx-release-policy-v1' })

assert.equal(candidate.capabilities.deploy, false)
assert.equal(verifyReleaseProvenance({ releaseCandidate: candidate, previewPlan, evidence, approval }).verified, true)
const registry = new ReleaseCandidateRegistry()
assert.equal(registry.submit(candidate).deduplicated, false)
assert.equal(registry.submit(candidate).deduplicated, true)
assert.throws(() => verifyReleaseProvenance({ releaseCandidate: candidate, previewPlan: { ...previewPlan, commitDigest: 'sha256:changed' }, evidence, approval }), (error) => error instanceof ChangeCaseError && error.code === 'RELEASE_PROVENANCE_PREVIEW_MISMATCH')
assert.throws(() => verifyReleaseProvenance({ releaseCandidate: candidate, previewPlan, evidence: { ...evidence, status: 'FAIL' }, approval }), (error) => error instanceof ChangeCaseError && error.code === 'RELEASE_PROVENANCE_EVIDENCE_MISMATCH')
assert.throws(() => verifyReleaseProvenance({ releaseCandidate: candidate, previewPlan, evidence, approval: { ...approval, status: 'INVALIDATED' } }), (error) => error instanceof ChangeCaseError && error.code === 'RELEASE_PROVENANCE_APPROVAL_MISMATCH')
assert.equal(candidate.provenanceDigest, sha256({ schema: 'adx-release-provenance-v1', changeCaseId, previewPlanId: previewPlan.id, ...candidate.provenance }))
console.log('Stage 8 release candidate provenance, exact preview/evidence/approval binding, duplicate prevention, and no-deploy capability verification passed.')
