import assert from 'node:assert/strict'
import { ChangeCaseError } from '../apps/adx-api/change-case-ledger.mjs'
import { createFeatureFlagAdapter, createProgressiveRolloutPlan, createReleaseAnalysisContract, createReleaseEnvironmentAdapter, evaluateReleaseAnalysis, ProgressiveRolloutRegistry } from '../apps/adx-api/progressive-release.mjs'
import { createReleaseCandidate, releaseApprovalDigest, verifyReleaseProvenance } from '../apps/adx-api/release-candidate.mjs'
import { ReleaseWebhookInbox } from '../apps/adx-api/release-reconciliation.mjs'

const preview = { id: 'preview-game-day', changeCaseId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', candidateDigest: 'sha256:candidate-game-day', evidenceDigest: 'sha256:evidence-game-day', commitDigest: 'sha256:commit-game-day' }
const evidence = { status: 'PASS', candidateDigest: preview.candidateDigest, evidenceDigest: preview.evidenceDigest }
const approval = { previewPlanId: preview.id, commitDigest: preview.commitDigest, decision: 'APPROVED', rationale: 'Independent preview approval.', reviewedBy: 'human:preview-reviewer', status: 'ACTIVE' }
const candidate = createReleaseCandidate({ changeCaseId: preview.changeCaseId, previewPlanId: preview.id, artifactDigest: 'sha256:artifact-game-day', candidateDigest: preview.candidateDigest, evidenceDigest: preview.evidenceDigest, commitDigest: preview.commitDigest, approvalDigest: releaseApprovalDigest(approval), policyVersion: 'adx-release-policy-v1' })
const environment = createReleaseEnvironmentAdapter({ providerId: 'game-day-rollout', environmentId: 'staging' })
const flag = createFeatureFlagAdapter({ providerId: 'game-day-flag', flagKey: 'release-game-day' })
const contract = createReleaseAnalysisContract({ contractId: 'game-day-slo', version: '1', maxErrorRate: 0.02, maxP95LatencyMs: 500, minimumSamples: 100, maximumTelemetryAgeMs: 60_000 })
const plan = createProgressiveRolloutPlan({ releaseCandidate: candidate, environment, featureFlag: flag, analysisContract: contract, stages: [5, 25, 100] })
const healthy = () => evaluateReleaseAnalysis({ rolloutPlan: plan, observation: { errorRate: 0.01, p95LatencyMs: 250, sampleCount: 120, observedAt: Date.now() } })
const start = () => new ProgressiveRolloutRegistry().start(plan).rollout

// 1. Happy-path staged rollout.
{ const registry = new ProgressiveRolloutRegistry(); let rollout = registry.start(plan).rollout; rollout = registry.observe(rollout.rolloutId, healthy()).rollout; rollout = registry.observe(rollout.rolloutId, healthy()).rollout; rollout = registry.observe(rollout.rolloutId, healthy()).rollout; assert.equal(rollout.status, 'COMPLETED') }
// 2 / 3. Availability and latency regressions require rollback.
{ const registry = new ProgressiveRolloutRegistry(); const availability = registry.observe(registry.start(plan).rollout.rolloutId, evaluateReleaseAnalysis({ rolloutPlan: plan, observation: { errorRate: 0.03, p95LatencyMs: 250, sampleCount: 120, observedAt: Date.now() } })).rollout; assert.equal(availability.status, 'ROLLBACK_REQUIRED'); const latency = registry.observe(registry.start(createProgressiveRolloutPlan({ releaseCandidate: createReleaseCandidate({ changeCaseId: preview.changeCaseId, previewPlanId: preview.id, artifactDigest: 'sha256:artifact-latency', candidateDigest: preview.candidateDigest, evidenceDigest: preview.evidenceDigest, commitDigest: preview.commitDigest, approvalDigest: releaseApprovalDigest(approval), policyVersion: 'adx-release-policy-v1' }), environment, featureFlag: flag, analysisContract: contract, stages: [5, 100] })).rollout.rolloutId, evaluateReleaseAnalysis({ rolloutPlan: plan, observation: { errorRate: 0.01, p95LatencyMs: 501, sampleCount: 120, observedAt: Date.now() } })); assert.equal(latency.rollout.status, 'ROLLBACK_REQUIRED') }
// 4 / 10. Stale telemetry and low traffic pause rather than promote.
assert.equal(evaluateReleaseAnalysis({ rolloutPlan: plan, observation: { errorRate: 0, p95LatencyMs: 20, sampleCount: 120, observedAt: Date.now() - 61_000 } }).decision, 'PAUSE')
assert.equal(evaluateReleaseAnalysis({ rolloutPlan: plan, observation: { errorRate: 0, p95LatencyMs: 20, sampleCount: 4, observedAt: Date.now() } }).decision, 'PAUSE')
// 5 / 6 / 12. Mismatched, expired, or tampered release provenance is denied.
assert.throws(() => verifyReleaseProvenance({ releaseCandidate: candidate, previewPlan: { ...preview, commitDigest: 'sha256:tampered' }, evidence, approval }), ChangeCaseError)
assert.throws(() => verifyReleaseProvenance({ releaseCandidate: candidate, previewPlan: preview, evidence, approval: { ...approval, status: 'INVALIDATED' } }), ChangeCaseError)
assert.throws(() => verifyReleaseProvenance({ releaseCandidate: candidate, previewPlan: preview, evidence: { ...evidence, evidenceDigest: 'sha256:tampered' }, approval }), ChangeCaseError)
// 7 / 8 / 11. Operator kill switch, compatible rollback, incompatible-target denial.
{ const registry = new ProgressiveRolloutRegistry(); let rollout = registry.start(plan).rollout; rollout = registry.pause(rollout.rolloutId, { id: 'human:operator', type: 'human' }, 'Kill switch.').rollout; assert.equal(rollout.status, 'PAUSED'); rollout = registry.rollback(rollout.rolloutId, { id: 'human:operator', type: 'human' }, 'sha256:expand-contract-compatible', true).rollout; assert.equal(rollout.status, 'ROLLED_BACK'); assert.throws(() => registry.rollback(rollout.rolloutId, { id: 'human:operator', type: 'human' }, 'sha256:incompatible', false), ChangeCaseError) }
// 9. Duplicate, delayed, reordered provider webhooks converge.
{ const inbox = new ReleaseWebhookInbox(); const input = { providerId: environment.providerId, rolloutId: 'provider-rollout', provenanceDigest: candidate.provenanceDigest }; inbox.receive({ ...input, deliveryId: 'complete', status: 'COMPLETED', sequence: 3 }); inbox.receive({ ...input, deliveryId: 'complete', status: 'COMPLETED', sequence: 3 }); inbox.receive({ ...input, deliveryId: 'delayed-deploying', status: 'DEPLOYING', sequence: 1 }); assert.equal(inbox.reconcile({ rolloutId: input.rolloutId, provenanceDigest: input.provenanceDigest, expectedStatus: 'COMPLETED' }).reconciled, true) }
console.log('Stage 8 game-day suite passed: staged rollout, availability/latency rollback, telemetry pauses, provenance denial, kill switch, migration-compatible rollback, webhook convergence, low-traffic escalation, incompatible rollback denial, and tamper block.')
