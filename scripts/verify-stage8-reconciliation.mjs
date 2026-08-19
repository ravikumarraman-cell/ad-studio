import assert from 'node:assert/strict'
import { ReleaseWebhookInbox } from '../apps/adx-api/release-reconciliation.mjs'

const inbox = new ReleaseWebhookInbox()
const base = { providerId: 'rollout-simulator', rolloutId: 'rollout-8', provenanceDigest: 'sha256:provenance-8' }
assert.equal(inbox.receive({ ...base, deliveryId: 'delayed-complete', status: 'COMPLETED', sequence: 3 }).deduplicated, false)
assert.equal(inbox.receive({ ...base, deliveryId: 'delayed-complete', status: 'COMPLETED', sequence: 3 }).deduplicated, true)
assert.equal(inbox.receive({ ...base, deliveryId: 'reordered-deploying', status: 'DEPLOYING', sequence: 1 }).deduplicated, false)
assert.equal(inbox.reconcile({ rolloutId: base.rolloutId, provenanceDigest: base.provenanceDigest, expectedStatus: 'COMPLETED' }).status, 'COMPLETED')
assert.equal(inbox.receive({ ...base, deliveryId: 'rollback', status: 'ROLLED_BACK', sequence: 4 }).deduplicated, false)
assert.equal(inbox.reconcile({ rolloutId: base.rolloutId, provenanceDigest: base.provenanceDigest, expectedStatus: 'ROLLED_BACK' }).reconciled, true)
assert.equal(inbox.reconcile({ rolloutId: 'missing', provenanceDigest: base.provenanceDigest, expectedStatus: 'ACTIVE' }).status, 'RECONCILIATION_REQUIRED')
assert.equal(inbox.receive({ ...base, rolloutId: 'ambiguous', deliveryId: 'unknown', status: 'UNKNOWN', sequence: 1 }).deduplicated, false)
assert.equal(inbox.reconcile({ rolloutId: 'ambiguous', provenanceDigest: base.provenanceDigest, expectedStatus: 'ACTIVE' }).reason, 'AMBIGUOUS_PROVIDER_OUTCOME')
console.log('Stage 8 release webhook duplicate, delayed, reordered, rollback, drift, and ambiguous-outcome reconciliation verification passed.')
