import { ChangeCaseError, sha256 } from './change-case-ledger.mjs'

/** Durable-provider shape, modelled locally: external observations never imply blind retry. */
export class ReleaseWebhookInbox {
  #deliveries = new Map()
  #observations = new Map()
  receive({ providerId, deliveryId, rolloutId, provenanceDigest, status, sequence }) {
    if (!text(providerId) || !text(deliveryId) || !text(rolloutId) || !digest(provenanceDigest) || !['DEPLOYING','PAUSED','ROLLED_BACK','COMPLETED','UNKNOWN'].includes(status) || !Number.isInteger(sequence) || sequence < 1) throw new ChangeCaseError('RELEASE_WEBHOOK_INVALID', 'A release webhook requires provider delivery identity, rollout, provenance, status, and sequence.')
    const key = `${providerId}:${deliveryId}`
    if (this.#deliveries.has(key)) return Object.freeze({ accepted: true, deduplicated: true, observation: this.#deliveries.get(key) })
    const observation = Object.freeze({ providerId, deliveryId, rolloutId, provenanceDigest, status, sequence, digest: sha256({ schema: 'adx-release-webhook-v1', providerId, deliveryId, rolloutId, provenanceDigest, status, sequence }) })
    this.#deliveries.set(key, observation)
    const list = this.#observations.get(rolloutId) ?? []
    this.#observations.set(rolloutId, [...list, observation])
    return Object.freeze({ accepted: true, deduplicated: false, observation })
  }
  reconcile({ rolloutId, provenanceDigest, expectedStatus }) {
    if (!text(rolloutId) || !digest(provenanceDigest) || !text(expectedStatus)) throw new ChangeCaseError('RELEASE_RECONCILIATION_INVALID', 'Rollout, provenance, and expected status are required for reconciliation.')
    const observations = (this.#observations.get(rolloutId) ?? []).filter((item) => item.provenanceDigest === provenanceDigest).sort((left, right) => left.sequence - right.sequence || left.deliveryId.localeCompare(right.deliveryId))
    if (!observations.length) return Object.freeze({ reconciled: false, status: 'RECONCILIATION_REQUIRED', reason: 'NO_PROVIDER_OBSERVATION' })
    const terminal = observations.filter((item) => ['ROLLED_BACK','COMPLETED'].includes(item.status)).at(-1)
    const latest = terminal ?? observations.at(-1)
    if (latest.status === 'UNKNOWN') return Object.freeze({ reconciled: false, status: 'RECONCILIATION_REQUIRED', reason: 'AMBIGUOUS_PROVIDER_OUTCOME', observation: latest })
    const status = latest.status === 'ROLLED_BACK' ? 'ROLLED_BACK' : latest.status === 'COMPLETED' ? 'COMPLETED' : latest.status === 'PAUSED' ? 'PAUSED' : 'ACTIVE'
    return Object.freeze({ reconciled: status === expectedStatus, status, reason: status === expectedStatus ? 'CONVERGED' : 'PROVIDER_DRIFT', observation: latest })
  }
}
const text = (value) => typeof value === 'string' && value.trim()
const digest = (value) => typeof value === 'string' && value.startsWith('sha256:')
