import assert from 'node:assert/strict'
import { ChangeCaseError } from '../apps/adx-api/change-case-ledger.mjs'
import { createFeatureFlagAdapter, createProgressiveRolloutPlan, createReleaseAnalysisContract, createReleaseEnvironmentAdapter, evaluateReleaseAnalysis, ProgressiveRolloutRegistry } from '../apps/adx-api/progressive-release.mjs'
import { createReleaseCandidate } from '../apps/adx-api/release-candidate.mjs'

const candidate = createReleaseCandidate({ changeCaseId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', previewPlanId: 'preview-8', artifactDigest: 'sha256:artifact-8', candidateDigest: 'sha256:candidate-8', evidenceDigest: 'sha256:evidence-8', commitDigest: 'sha256:commit-8', approvalDigest: 'sha256:approval-8', policyVersion: 'adx-release-policy-v1' })
const environment = createReleaseEnvironmentAdapter({ providerId: 'rollout-simulator', environmentId: 'staging' })
const featureFlag = createFeatureFlagAdapter({ providerId: 'flag-simulator', flagKey: 'controlled-release' })
const contract = createReleaseAnalysisContract({ contractId: 'web-slo', version: '1', maxErrorRate: 0.02, maxP95LatencyMs: 500, minimumSamples: 100, maximumTelemetryAgeMs: 60_000 })
const plan = createProgressiveRolloutPlan({ releaseCandidate: candidate, environment, featureFlag, analysisContract: contract, stages: [5, 25, 100] })
const registry = new ProgressiveRolloutRegistry()
let rollout = registry.start(plan).rollout
assert.equal(rollout.audiencePercent, 5)
rollout = registry.observe(rollout.rolloutId, evaluateReleaseAnalysis({ rolloutPlan: plan, observation: { errorRate: 0.01, p95LatencyMs: 300, sampleCount: 120, observedAt: Date.now() } })).rollout
assert.equal(rollout.audiencePercent, 25)
rollout = registry.observe(rollout.rolloutId, evaluateReleaseAnalysis({ rolloutPlan: plan, observation: { errorRate: 0.04, p95LatencyMs: 300, sampleCount: 120, observedAt: Date.now() } })).rollout
assert.equal(rollout.status, 'ROLLBACK_REQUIRED')
rollout = registry.pause(rollout.rolloutId, { id: 'human:operator', type: 'human' }, 'Operator kill switch.').rollout
assert.equal(rollout.status, 'PAUSED')
rollout = registry.rollback(rollout.rolloutId, { id: 'human:operator', type: 'human' }, 'sha256:prior-compatible-artifact', true).rollout
assert.equal(rollout.status, 'ROLLED_BACK')
const missingTelemetry = evaluateReleaseAnalysis({ rolloutPlan: plan, observation: { errorRate: 0, p95LatencyMs: 10, sampleCount: 120, observedAt: Date.now() - 61_000 } })
assert.equal(missingTelemetry.decision, 'PAUSE')
const lowTraffic = evaluateReleaseAnalysis({ rolloutPlan: plan, observation: { errorRate: 0, p95LatencyMs: 10, sampleCount: 3, observedAt: Date.now() } })
assert.equal(lowTraffic.decision, 'PAUSE')
assert.throws(() => registry.rollback(rollout.rolloutId, { id: 'human:operator', type: 'human' }, 'sha256:incompatible', false), (error) => error instanceof ChangeCaseError && error.code === 'ROLLOUT_ROLLBACK_INVALID')
assert.equal(environment.capabilities.deploy, false)
console.log('Stage 8 simulation-only environment, flag, rollout, metrics, pause, and compatible rollback adapter verification passed.')
