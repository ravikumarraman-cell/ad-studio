import assert from 'node:assert/strict'
import { createEvaluationSet, compareOutcomeBaseline } from '../apps/adx-api/outcome-evaluation.mjs'

const baseline = createEvaluationSet({ version: 'baseline-v1', exports: [{ exportDigest: 'sha256:1', outcome: 'SUCCESS' }, { exportDigest: 'sha256:2', outcome: 'SUCCESS' }, { exportDigest: 'sha256:3', outcome: 'ROLLED_BACK' }] })
const current = createEvaluationSet({ version: 'current-v1', exports: [{ exportDigest: 'sha256:4', outcome: 'SUCCESS' }, { exportDigest: 'sha256:5', outcome: 'ROLLED_BACK' }, { exportDigest: 'sha256:6', outcome: 'ROLLED_BACK' }] })
const comparison = compareOutcomeBaseline({ baseline, current })
assert.equal(comparison.safetyRegression, true)
assert.ok(comparison.successRateDelta < 0)
assert.ok(comparison.rollbackRateDelta > 0)
console.log('Stage 9 immutable evaluation-set versioning and outcome baseline comparison verification passed.')
