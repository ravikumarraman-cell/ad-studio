import { createHash, randomUUID, sign, verify } from 'node:crypto'

export const changeCaseStates = Object.freeze(['DRAFT', 'INTAKE', 'AWAITING_CLARIFICATION', 'RISK_REVIEW', 'AWAITING_STORY_APPROVAL', 'DESIGN_REVIEW', 'READY_FOR_EXECUTION', 'AWAITING_VERIFICATION', 'READY_FOR_DELIVERY', 'PAUSED', 'CANCELLED'])
const transitionTargets = Object.freeze({
  DRAFT: new Set(['INTAKE', 'CANCELLED']),
  INTAKE: new Set(['AWAITING_CLARIFICATION', 'RISK_REVIEW', 'PAUSED', 'CANCELLED']),
  AWAITING_CLARIFICATION: new Set(['INTAKE', 'PAUSED', 'CANCELLED']),
  RISK_REVIEW: new Set(['AWAITING_STORY_APPROVAL', 'INTAKE', 'PAUSED', 'CANCELLED']),
  AWAITING_STORY_APPROVAL: new Set(['RISK_REVIEW', 'DESIGN_REVIEW', 'PAUSED', 'CANCELLED']),
  DESIGN_REVIEW: new Set(['READY_FOR_EXECUTION', 'PAUSED', 'CANCELLED']),
  READY_FOR_EXECUTION: new Set(['AWAITING_VERIFICATION', 'PAUSED', 'CANCELLED']),
  AWAITING_VERIFICATION: new Set(['PAUSED', 'CANCELLED']),
  PAUSED: new Set(['INTAKE', 'RISK_REVIEW', 'DESIGN_REVIEW', 'CANCELLED']),
  CANCELLED: new Set(),
})

export class ChangeCaseError extends Error {
  constructor(code, message, { retryable = false, severity = 'warning', details = {} } = {}) {
    super(message)
    this.code = code; this.retryable = retryable; this.severity = severity; this.details = details
  }
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

export function sha256(value) { return `sha256:${createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex')}` }

function eventMaterial(event) {
  return {
    eventId: event.eventId, eventType: event.eventType, eventVersion: event.eventVersion, aggregateType: 'ChangeCase', aggregateId: event.aggregateId,
    sequence: event.sequence, occurredAt: event.occurredAt, actor: event.actor, correlationId: event.correlationId, causationId: event.causationId ?? null,
    idempotencyKey: event.idempotencyKey, policyVersion: event.policyVersion, payloadDigest: event.payloadDigest, payload: event.payload, previousEventDigest: event.previousEventDigest ?? null,
  }
}

export function createSignedEvent({ aggregateId, sequence, eventType, actor, correlationId, causationId, idempotencyKey, policyVersion, payload, previousEventDigest, signer, occurredAt = new Date().toISOString(), eventId = randomUUID() }) {
  if (!Number.isInteger(sequence) || sequence < 1) throw new ChangeCaseError('EVENT_SEQUENCE_INVALID', 'Event sequence must be a positive integer.')
  if (!signer?.privateKey || !signer?.keyId) throw new ChangeCaseError('ATTESTATION_SIGNER_REQUIRED', 'A signing key is required for a Change Case event.')
  const unsigned = { eventId, eventType, eventVersion: 1, aggregateId, sequence, occurredAt, actor, correlationId, causationId, idempotencyKey, policyVersion, payloadDigest: sha256(payload), payload, previousEventDigest }
  const eventDigest = sha256(eventMaterial(unsigned))
  const signature = sign(null, Buffer.from(eventDigest), signer.privateKey).toString('base64url')
  return Object.freeze({ ...unsigned, eventDigest, signature, signatureKeyId: signer.keyId })
}

export function verifySignedEvent(event, resolvePublicKey) {
  if (!event || event.payloadDigest !== sha256(event.payload)) throw new ChangeCaseError('EVENT_PAYLOAD_TAMPERED', 'Event payload digest does not match its payload.', { severity: 'error' })
  if (event.eventDigest !== sha256(eventMaterial(event))) throw new ChangeCaseError('EVENT_DIGEST_TAMPERED', 'Event digest does not match its canonical envelope.', { severity: 'error' })
  const publicKey = resolvePublicKey?.(event.signatureKeyId)
  if (!publicKey || !verify(null, Buffer.from(event.eventDigest), publicKey, Buffer.from(event.signature, 'base64url'))) throw new ChangeCaseError('EVENT_SIGNATURE_INVALID', 'Event attestation signature cannot be verified.', { severity: 'error' })
  return true
}

export function applyChangeCaseEvent(projection, event) {
  if (event.eventType === 'ChangeCaseCreated.v1') {
    if (projection) throw new ChangeCaseError('EVENT_REPLAY_DUPLICATE_CREATE', 'A Change Case was created more than once.', { severity: 'error' })
    return Object.freeze({ id: event.aggregateId, organizationId: event.payload.organizationId, workspaceId: event.payload.workspaceId, title: event.payload.title, riskTier: event.payload.riskTier, state: 'DRAFT', projectionVersion: event.sequence, createdAt: event.occurredAt, updatedAt: event.occurredAt })
  }
  if (!projection) throw new ChangeCaseError('EVENT_REPLAY_MISSING_CREATE', 'A Change Case event appeared before its create event.', { severity: 'error' })
  if (event.sequence !== projection.projectionVersion + 1) throw new ChangeCaseError('EVENT_SEQUENCE_GAP', 'Change Case event sequence is not contiguous.', { severity: 'error' })
  if (event.eventType === 'ChangeCaseTitleChanged.v1') return Object.freeze({ ...projection, title: event.payload.title, projectionVersion: event.sequence, updatedAt: event.occurredAt })
  if (event.eventType === 'ChangeCaseStateChanged.v1') return Object.freeze({ ...projection, state: event.payload.toState, projectionVersion: event.sequence, updatedAt: event.occurredAt })
  if (event.eventType === 'ChangeCaseRiskClassified.v1') return Object.freeze({ ...projection, riskTier: event.payload.riskTier, state: event.payload.toState, projectionVersion: event.sequence, updatedAt: event.occurredAt })
  if (['ChangeCaseIntakeCaptured.v1', 'ChangeCaseStoriesGenerated.v1', 'ChangeCaseStoryApproved.v1', 'ChangeCaseStoryRejected.v1'].includes(event.eventType)) return Object.freeze({ ...projection, state: event.payload.toState ?? projection.state, projectionVersion: event.sequence, updatedAt: event.occurredAt })
  if (['ChangeCaseDesignCaptured.v1', 'ChangeCaseDesignExceptionRecorded.v1', 'ChangeCaseDesignApproved.v1', 'ChangeCaseDesignRejected.v1', 'ChangeCaseVerificationCompleted.v1'].includes(event.eventType)) return Object.freeze({ ...projection, state: event.payload.toState ?? projection.state, projectionVersion: event.sequence, updatedAt: event.occurredAt })
  throw new ChangeCaseError('EVENT_TYPE_UNKNOWN', `Unsupported Change Case event type: ${event.eventType}.`, { severity: 'error' })
}

export function rebuildProjection(events, resolvePublicKey) {
  let projection = null; let previousDigest = null
  for (const [index, event] of events.entries()) {
    if (event.sequence !== index + 1) throw new ChangeCaseError('EVENT_SEQUENCE_GAP', 'Change Case event sequence is not contiguous.', { severity: 'error' })
    if ((event.previousEventDigest ?? null) !== previousDigest) throw new ChangeCaseError('EVENT_CHAIN_BROKEN', 'Change Case event hash chain is broken.', { severity: 'error' })
    verifySignedEvent(event, resolvePublicKey)
    projection = applyChangeCaseEvent(projection, event)
    previousDigest = event.eventDigest
  }
  return projection
}

export function merkleRoot(digests) {
  if (!digests.length) throw new ChangeCaseError('CHECKPOINT_EMPTY', 'A checkpoint requires at least one event digest.')
  let level = [...digests]
  while (level.length > 1) {
    const next = []
    for (let index = 0; index < level.length; index += 2) next.push(sha256(`${level[index]}|${level[index + 1] ?? level[index]}`))
    level = next
  }
  return level[0]
}

export function createCheckpoint({ changeCaseId, events, signer, createdAt = new Date().toISOString(), checkpointId = randomUUID() }) {
  const throughSequence = events.at(-1)?.sequence
  const root = merkleRoot(events.map((event) => event.eventDigest))
  const material = { checkpointId, changeCaseId, throughSequence, merkleRoot: root, createdAt }
  return Object.freeze({ ...material, signature: sign(null, Buffer.from(canonicalJson(material)), signer.privateKey).toString('base64url'), signatureKeyId: signer.keyId })
}

export function verifyCheckpoint(checkpoint, events, resolvePublicKey) {
  if (checkpoint.throughSequence !== events.at(-1)?.sequence || checkpoint.merkleRoot !== merkleRoot(events.map((event) => event.eventDigest))) throw new ChangeCaseError('CHECKPOINT_MISMATCH', 'Checkpoint does not include the expected event set.', { severity: 'error' })
  const publicKey = resolvePublicKey?.(checkpoint.signatureKeyId)
  const material = { checkpointId: checkpoint.checkpointId, changeCaseId: checkpoint.changeCaseId, throughSequence: checkpoint.throughSequence, merkleRoot: checkpoint.merkleRoot, createdAt: checkpoint.createdAt }
  if (!publicKey || !verify(null, Buffer.from(canonicalJson(material)), publicKey, Buffer.from(checkpoint.signature, 'base64url'))) throw new ChangeCaseError('CHECKPOINT_SIGNATURE_INVALID', 'Checkpoint signature cannot be verified.', { severity: 'error' })
  return true
}

export function assertTransition({ fromState, toState, expectedVersion, projectionVersion }) {
  if (expectedVersion !== projectionVersion) throw new ChangeCaseError('VERSION_CONFLICT', 'The Change Case changed before this command could be applied.', { details: { expectedVersion, actualVersion: projectionVersion } })
  if (!transitionTargets[fromState]?.has(toState)) throw new ChangeCaseError('STATE_TRANSITION_INVALID', `Cannot transition from ${fromState} to ${toState}.`)
}
