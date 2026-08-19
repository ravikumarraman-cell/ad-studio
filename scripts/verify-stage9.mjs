import assert from 'node:assert/strict'
import { ChangeCaseError } from '../apps/adx-api/change-case-ledger.mjs'
import { createOutcomeRecord, exportOutcomeForEvaluation, OutcomeRegistry } from '../apps/adx-api/outcome-record.mjs'

const record = createOutcomeRecord({ changeCaseId: '99999999-9999-4999-8999-999999999999', releaseCandidateId: 'release-9', outcome: 'ROLLED_BACK', taxonomy: 'LATENCY_REGRESSION', summary: 'Latency crossed the release contract and rollback completed.', incidents: [{ category: 'release', reference: 'incident:stage9-1' }], rollback: { artifactDigest: 'sha256:known-good', reason: 'Latency rollback.' }, humanOverride: { label: 'operator-kill-switch', recordedBy: 'oidc:operator' }, metrics: { p95LatencyMs: 702, errorRate: 0.01, customerEmail: 'private@example.test' } })
const registry = new OutcomeRegistry()
assert.equal(registry.retain(record).deduplicated, false)
assert.equal(registry.retain(record).deduplicated, true)
const exported = exportOutcomeForEvaluation(record)
assert.equal(exported.metrics.customerEmail, '[REDACTED]')
assert.equal(exported.rollback.reason, 'Latency rollback.')
assert.throws(() => createOutcomeRecord({ changeCaseId: 'x', releaseCandidateId: 'y', outcome: 'ROLLED_BACK', taxonomy: 'OTHER', summary: 'bad' }), (error) => error instanceof ChangeCaseError && error.code === 'OUTCOME_ROLLBACK_LINK_REQUIRED')
console.log('Stage 9 immutable outcome, rollback/incident link, human override, and redacted evaluation-export verification passed.')
