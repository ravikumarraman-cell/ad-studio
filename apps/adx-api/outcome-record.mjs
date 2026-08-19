import { randomUUID } from 'node:crypto'
import { ChangeCaseError, sha256 } from './change-case-ledger.mjs'

export function createOutcomeRecord({ changeCaseId, releaseCandidateId, outcome, taxonomy, summary, incidents = [], rollback = null, humanOverride = null, metrics = {} }) {
  if (!text(changeCaseId) || !text(releaseCandidateId) || !['SUCCESS','FAILURE','ROLLED_BACK'].includes(outcome) || !['DELIVERY_SUCCESS','AVAILABILITY_REGRESSION','LATENCY_REGRESSION','SECURITY_INCIDENT','OPERATOR_OVERRIDE','OTHER'].includes(taxonomy) || !text(summary) || !Array.isArray(incidents) || !object(metrics)) throw new ChangeCaseError('OUTCOME_RECORD_INVALID', 'An outcome requires Change Case, release candidate, taxonomy, summary, incident links, and metrics.')
  if (outcome === 'ROLLED_BACK' && (!rollback || !text(rollback.artifactDigest) || !text(rollback.reason))) throw new ChangeCaseError('OUTCOME_ROLLBACK_LINK_REQUIRED', 'A rolled-back outcome requires a rollback artifact and reason.')
  if (humanOverride && (!text(humanOverride.label) || !text(humanOverride.recordedBy))) throw new ChangeCaseError('OUTCOME_OVERRIDE_INVALID', 'A human override requires a label and recorder.')
  const normalized = Object.freeze({ changeCaseId, releaseCandidateId, outcome, taxonomy, summary: summary.trim(), incidents: Object.freeze(incidents.map(normalizeIncident)), rollback: rollback ? Object.freeze({ artifactDigest: rollback.artifactDigest, reason: rollback.reason.trim() }) : null, humanOverride: humanOverride ? Object.freeze({ label: humanOverride.label.trim(), recordedBy: humanOverride.recordedBy.trim() }) : null, metrics: Object.freeze(structuredClone(metrics)) })
  return Object.freeze({ outcomeRecordId: randomUUID(), schema: 'adx-outcome-record-v1', ...normalized, outcomeDigest: sha256(normalized) })
}

/** Produces a safe, immutable learning row; it rejects unredacted sensitive-looking fields. */
export function exportOutcomeForEvaluation(record) {
  if (!record?.outcomeDigest) throw new ChangeCaseError('OUTCOME_RECORD_INVALID', 'A retained outcome record is required.')
  const safeMetrics = redact(record.metrics)
  return Object.freeze({ schema: 'adx-outcome-evaluation-v1', outcomeDigest: record.outcomeDigest, outcome: record.outcome, taxonomy: record.taxonomy, incidents: record.incidents.map((item) => ({ category: item.category, reference: item.reference })), rollback: record.rollback ? { reason: record.rollback.reason } : null, humanOverride: record.humanOverride ? { label: record.humanOverride.label } : null, metrics: safeMetrics, exportDigest: sha256({ outcomeDigest: record.outcomeDigest, outcome: record.outcome, taxonomy: record.taxonomy, incidents: record.incidents, rollback: record.rollback ? { reason: record.rollback.reason } : null, humanOverride: record.humanOverride ? { label: record.humanOverride.label } : null, metrics: safeMetrics }) })
}

export class OutcomeRegistry {
  #records = new Map()
  retain(record) { if (!record?.outcomeDigest) throw new ChangeCaseError('OUTCOME_RECORD_INVALID', 'A valid outcome record is required.'); const prior = this.#records.get(record.outcomeDigest); if (prior) return Object.freeze({ accepted: true, deduplicated: true, outcome: prior }); this.#records.set(record.outcomeDigest, record); return Object.freeze({ accepted: true, deduplicated: false, outcome: record }) }
}

function redact(value, key = '') { if (/(email|name|phone|address|token|secret|password|cookie|content|prompt)/i.test(key)) return '[REDACTED]'; if (typeof value === 'string') return value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]'); if (Array.isArray(value)) return Object.freeze(value.map((item) => redact(item))); if (object(value)) return Object.freeze(Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redact(entryValue, entryKey)]))); return value }
function normalizeIncident(item) { if (!object(item) || !text(item.category) || !text(item.reference)) throw new ChangeCaseError('OUTCOME_INCIDENT_INVALID', 'Each incident link requires a category and stable reference.'); return Object.freeze({ category: item.category.trim(), reference: item.reference.trim() }) }
const text = (value) => typeof value === 'string' && value.trim()
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
