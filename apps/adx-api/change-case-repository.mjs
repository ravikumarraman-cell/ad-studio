import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { ChangeCaseError, assertTransition, createCheckpoint, createSignedEvent, rebuildProjection, sha256, verifyCheckpoint } from './change-case-ledger.mjs'

const eventRow = (row) => ({
  eventId: row.eventId, eventType: row.eventType, eventVersion: row.eventVersion, aggregateId: row.aggregateId, sequence: row.sequence, occurredAt: row.occurredAt.toISOString(), actor: row.actor,
  correlationId: row.correlationId, causationId: row.causationId, idempotencyKey: row.idempotencyKey, policyVersion: row.policyVersion, payloadDigest: row.payloadDigest, payload: row.payload,
  previousEventDigest: row.previousEventDigest, eventDigest: row.eventDigest, signature: row.signature, signatureKeyId: row.signatureKeyId,
})

export class PostgresChangeCaseRepository {
  constructor({ connectionString, signer }) {
    if (!connectionString) throw new Error('DATABASE_URL_REQUIRED')
    if (!signer?.privateKey || !signer?.keyId) throw new Error('LEDGER_SIGNER_REQUIRED')
    this.pool = new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 10_000 })
    this.signer = signer
  }

  async scoped(scope, work) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query("SELECT set_config('adx.organization_id', $1, true), set_config('adx.workspace_id', $2, true)", [scope.organizationId, scope.workspaceId])
      const value = await work(client)
      await client.query('COMMIT')
      return value
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally { client.release() }
  }

  async create({ scope, principal, title, riskTier, idempotencyKey, correlationId = randomUUID(), policyVersion = 'adx-authz-1' }) {
    const requestDigest = sha256({ command: 'ChangeCaseCreate.v1', title, riskTier, scope })
    return this.scoped(scope, async (client) => {
      const prior = await this.#idempotency(client, scope, idempotencyKey, requestDigest)
      if (prior) return { ...prior, deduplicated: true }
      const id = randomUUID(); const occurredAt = new Date().toISOString()
      const event = createSignedEvent({ aggregateId: id, sequence: 1, eventType: 'ChangeCaseCreated.v1', actor: actorOf(principal), correlationId, idempotencyKey, policyVersion, payload: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, title, riskTier }, signer: this.signer, occurredAt })
      const projection = rebuildProjection([event], (keyId) => keyId === this.signer.keyId ? this.signer.publicKey : null)
      await client.query('INSERT INTO adx_change_case (id, organization_id, workspace_id, title, state, risk_tier, projection_version, created_by, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)', [projection.id, scope.organizationId, scope.workspaceId, projection.title, projection.state, riskTier, projection.projectionVersion, principal.id, occurredAt])
      await this.#insertEvent(client, scope, event)
      const response = { accepted: true, commandId: randomUUID(), changeCaseId: id, newState: projection.state, projectionVersion: projection.projectionVersion, correlationId }
      await this.#recordIdempotency(client, scope, idempotencyKey, requestDigest, response)
      await this.#outbox(client, scope, id, event, correlationId)
      return response
    })
  }

  async editDraft({ scope, principal, changeCaseId, title, expectedVersion, idempotencyKey, correlationId = randomUUID(), policyVersion = 'adx-authz-1' }) {
    const requestDigest = sha256({ command: 'ChangeCaseTitleChange.v1', changeCaseId, title, expectedVersion, scope })
    return this.scoped(scope, async (client) => {
      const prior = await this.#idempotency(client, scope, idempotencyKey, requestDigest)
      if (prior) return { ...prior, deduplicated: true }
      const current = await this.#currentForUpdate(client, scope, changeCaseId)
      if (!current) throw new ChangeCaseError('CHANGE_CASE_NOT_FOUND', 'Change Case was not found.')
      if (current.state !== 'DRAFT') throw new ChangeCaseError('DRAFT_EDIT_NOT_ALLOWED', 'Only a draft Change Case may be edited.')
      if (expectedVersion !== current.projectionVersion) throw new ChangeCaseError('VERSION_CONFLICT', 'The Change Case changed before this command could be applied.', { details: { expectedVersion, actualVersion: current.projectionVersion } })
      const previous = await this.#lastEvent(client, scope, changeCaseId)
      const event = createSignedEvent({ aggregateId: changeCaseId, sequence: current.projectionVersion + 1, eventType: 'ChangeCaseTitleChanged.v1', actor: actorOf(principal), correlationId, causationId: previous.eventId, idempotencyKey, policyVersion, payload: { title }, previousEventDigest: previous.eventDigest, signer: this.signer })
      await client.query('UPDATE adx_change_case SET title = $1, projection_version = $2, updated_at = $3 WHERE id = $4 AND organization_id = $5 AND workspace_id = $6', [title, event.sequence, event.occurredAt, changeCaseId, scope.organizationId, scope.workspaceId])
      await this.#insertEvent(client, scope, event)
      const response = { accepted: true, commandId: randomUUID(), changeCaseId, newState: current.state, projectionVersion: event.sequence, correlationId }
      await this.#recordIdempotency(client, scope, idempotencyKey, requestDigest, response)
      await this.#outbox(client, scope, changeCaseId, event, correlationId)
      return response
    })
  }

  async transition({ scope, principal, changeCaseId, toState, expectedVersion, idempotencyKey, correlationId = randomUUID(), policyVersion = 'adx-authz-1' }) {
    const requestDigest = sha256({ command: 'ChangeCaseTransition.v1', changeCaseId, toState, expectedVersion, scope })
    return this.scoped(scope, async (client) => {
      const prior = await this.#idempotency(client, scope, idempotencyKey, requestDigest)
      if (prior) return { ...prior, deduplicated: true }
      const current = await this.#currentForUpdate(client, scope, changeCaseId)
      if (!current) throw new ChangeCaseError('CHANGE_CASE_NOT_FOUND', 'Change Case was not found.')
      assertTransition({ fromState: current.state, toState, expectedVersion, projectionVersion: current.projectionVersion })
      const previous = await this.#lastEvent(client, scope, changeCaseId)
      const event = createSignedEvent({ aggregateId: changeCaseId, sequence: current.projectionVersion + 1, eventType: 'ChangeCaseStateChanged.v1', actor: actorOf(principal), correlationId, causationId: previous.eventId, idempotencyKey, policyVersion, payload: { fromState: current.state, toState }, previousEventDigest: previous.eventDigest, signer: this.signer })
      await client.query('UPDATE adx_change_case SET state = $1, projection_version = $2, updated_at = $3 WHERE id = $4 AND organization_id = $5 AND workspace_id = $6', [toState, event.sequence, event.occurredAt, changeCaseId, scope.organizationId, scope.workspaceId])
      await this.#insertEvent(client, scope, event)
      const response = { accepted: true, commandId: randomUUID(), changeCaseId, newState: toState, projectionVersion: event.sequence, correlationId }
      await this.#recordIdempotency(client, scope, idempotencyKey, requestDigest, response)
      await this.#outbox(client, scope, changeCaseId, event, correlationId)
      return response
    })
  }

  async list(scope, { state, riskTier } = {}) { return this.scoped(scope, async (client) => (await client.query('SELECT id, title, state, risk_tier AS "riskTier", projection_version AS "projectionVersion", created_at AS "createdAt", updated_at AS "updatedAt" FROM adx_change_case WHERE organization_id = $1 AND workspace_id = $2 AND ($3::text IS NULL OR state = $3) AND ($4::text IS NULL OR risk_tier = $4) ORDER BY updated_at DESC, id DESC', [scope.organizationId, scope.workspaceId, state ?? null, riskTier ?? null])).rows) }
  async get(scope, changeCaseId) { return this.scoped(scope, async (client) => (await client.query('SELECT id, title, state, risk_tier AS "riskTier", projection_version AS "projectionVersion", created_at AS "createdAt", updated_at AS "updatedAt" FROM adx_change_case WHERE id = $1 AND organization_id = $2 AND workspace_id = $3', [changeCaseId, scope.organizationId, scope.workspaceId])).rows[0] ?? null) }
  async timeline(scope, changeCaseId) { return this.scoped(scope, async (client) => (await client.query('SELECT event_id AS "eventId", event_type AS "eventType", event_version AS "eventVersion", change_case_id AS "aggregateId", sequence, occurred_at AS "occurredAt", actor, correlation_id AS "correlationId", causation_id AS "causationId", idempotency_key AS "idempotencyKey", policy_version AS "policyVersion", payload_digest AS "payloadDigest", payload, previous_event_digest AS "previousEventDigest", event_digest AS "eventDigest", signature, signature_key_id AS "signatureKeyId" FROM adx_change_case_event WHERE change_case_id = $1 AND organization_id = $2 AND workspace_id = $3 ORDER BY sequence', [changeCaseId, scope.organizationId, scope.workspaceId])).rows.map(eventRow)) }
  async outbox(scope, changeCaseId) { return this.scoped(scope, async (client) => (await client.query('SELECT id, event_id AS "eventId", status, provider_idempotency_key AS "providerIdempotencyKey" FROM adx_outbox_message WHERE change_case_id = $1 AND organization_id = $2 AND workspace_id = $3 ORDER BY created_at', [changeCaseId, scope.organizationId, scope.workspaceId])).rows) }
  async receiveProviderSignal({ scope, provider, deliveryId, changeCaseId, occurredAt, payload }) {
    if (!provider || !deliveryId || !changeCaseId || !occurredAt || !payload) throw new ChangeCaseError('PROVIDER_SIGNAL_INVALID', 'Provider, delivery identifier, Change Case, timestamp, and payload are required.')
    return this.scoped(scope, async (client) => {
      const result = await client.query('INSERT INTO adx_provider_inbox (id, organization_id, workspace_id, provider, provider_delivery_id, change_case_id, occurred_at, payload_digest, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (provider, provider_delivery_id) DO NOTHING RETURNING id', [randomUUID(), scope.organizationId, scope.workspaceId, provider, deliveryId, changeCaseId, occurredAt, sha256(payload), payload])
      return { accepted: true, deduplicated: result.rowCount === 0 }
    })
  }
  async inbox(scope, changeCaseId) { return this.scoped(scope, async (client) => (await client.query('SELECT provider, provider_delivery_id AS "deliveryId", occurred_at AS "occurredAt", payload_digest AS "payloadDigest", payload FROM adx_provider_inbox WHERE change_case_id = $1 AND organization_id = $2 AND workspace_id = $3 ORDER BY occurred_at, provider_delivery_id', [changeCaseId, scope.organizationId, scope.workspaceId])).rows) }
  async requireReconciliation(scope, outboxId, reason) {
    return this.scoped(scope, async (client) => {
      const result = await client.query("UPDATE adx_outbox_message SET status = 'RECONCILIATION_REQUIRED', attempts = attempts + 1, next_attempt_at = now() WHERE id = $1 AND organization_id = $2 AND workspace_id = $3 AND status IN ('PENDING','DELIVERING') RETURNING id", [outboxId, scope.organizationId, scope.workspaceId])
      if (!result.rowCount) throw new ChangeCaseError('OUTBOX_NOT_RECONCILABLE', 'Outbox message is not available for reconciliation.', { details: { reason } })
      return { status: 'RECONCILIATION_REQUIRED', reason }
    })
  }
  async reconcileObservedState({ scope, changeCaseId, provider, principal = { id: 'service:reconciler', type: 'service', issuer: 'adx' } }) {
    const observations = (await this.inbox(scope, changeCaseId)).filter((item) => item.provider === provider && typeof item.payload?.observedState === 'string')
    if (!observations.length) throw new ChangeCaseError('RECONCILIATION_OBSERVATION_MISSING', 'No authenticated provider observation is available for reconciliation.')
    const observed = observations.at(-1); const current = await this.get(scope, changeCaseId)
    if (!current) throw new ChangeCaseError('CHANGE_CASE_NOT_FOUND', 'Change Case was not found.')
    if (current.state === observed.payload.observedState) return { accepted: true, converged: true, changeCaseId, newState: current.state, projectionVersion: current.projectionVersion }
    const result = await this.transition({ scope, principal, changeCaseId, toState: observed.payload.observedState, expectedVersion: current.projectionVersion, idempotencyKey: `reconcile:${sha256({ provider, changeCaseId, digest: observed.payloadDigest }).slice(7, 55)}`, correlationId: randomUUID(), policyVersion: 'adx-reconciliation-1' })
    return { ...result, converged: true }
  }
  async checkpoint(scope, changeCaseId) {
    const events = await this.timeline(scope, changeCaseId)
    if (!events.length) throw new ChangeCaseError('CHANGE_CASE_NOT_FOUND', 'Change Case was not found.')
    const checkpoint = createCheckpoint({ changeCaseId, events, signer: this.signer })
    await this.scoped(scope, async (client) => { await client.query('INSERT INTO adx_change_case_checkpoint (id, organization_id, workspace_id, change_case_id, through_sequence, merkle_root, signature, signature_key_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [checkpoint.checkpointId, scope.organizationId, scope.workspaceId, changeCaseId, checkpoint.throughSequence, checkpoint.merkleRoot, checkpoint.signature, checkpoint.signatureKeyId, checkpoint.createdAt]) })
    return checkpoint
  }
  async verifyIntegrity(scope, changeCaseId) {
    const events = await this.timeline(scope, changeCaseId)
    const resolvePublicKey = (keyId) => keyId === this.signer.keyId ? this.signer.publicKey : null
    const projection = rebuildProjection(events, resolvePublicKey)
    const checkpoint = await this.scoped(scope, async (client) => (await client.query('SELECT id AS "checkpointId", through_sequence AS "throughSequence", merkle_root AS "merkleRoot", signature, signature_key_id AS "signatureKeyId", created_at AS "createdAt" FROM adx_change_case_checkpoint WHERE change_case_id = $1 AND organization_id = $2 AND workspace_id = $3 ORDER BY through_sequence DESC LIMIT 1', [changeCaseId, scope.organizationId, scope.workspaceId])).rows[0] ?? null)
    if (!checkpoint) throw new ChangeCaseError('CHECKPOINT_MISSING', 'No retained checkpoint exists for this Change Case.', { severity: 'error' })
    verifyCheckpoint({ ...checkpoint, createdAt: checkpoint.createdAt.toISOString(), changeCaseId }, events, resolvePublicKey)
    return { projection, checkpoint: { id: checkpoint.checkpointId, throughSequence: checkpoint.throughSequence, merkleRoot: checkpoint.merkleRoot } }
  }
  async close() { await this.pool.end() }

  async #idempotency(client, scope, idempotencyKey, requestDigest) {
    if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128) throw new ChangeCaseError('IDEMPOTENCY_KEY_INVALID', 'An idempotency key between 16 and 128 characters is required.')
    const result = await client.query('SELECT request_digest AS "requestDigest", response FROM adx_change_case_idempotency WHERE idempotency_key = $1 AND organization_id = $2 AND workspace_id = $3 FOR UPDATE', [idempotencyKey, scope.organizationId, scope.workspaceId])
    if (!result.rowCount) return null
    if (result.rows[0].requestDigest !== requestDigest) throw new ChangeCaseError('IDEMPOTENCY_KEY_REUSED', 'This idempotency key was used for a different command.')
    return result.rows[0].response
  }
  async #recordIdempotency(client, scope, key, requestDigest, response) { await client.query('INSERT INTO adx_change_case_idempotency (organization_id, workspace_id, idempotency_key, request_digest, command_id, response) VALUES ($1,$2,$3,$4,$5,$6)', [scope.organizationId, scope.workspaceId, key, requestDigest, response.commandId, response]) }
  async #currentForUpdate(client, scope, id) { const result = await client.query('SELECT id, state, projection_version AS "projectionVersion" FROM adx_change_case WHERE id = $1 AND organization_id = $2 AND workspace_id = $3 FOR UPDATE', [id, scope.organizationId, scope.workspaceId]); return result.rows[0] }
  async #lastEvent(client, scope, id) { const result = await client.query('SELECT event_id AS "eventId", event_digest AS "eventDigest" FROM adx_change_case_event WHERE change_case_id = $1 AND organization_id = $2 AND workspace_id = $3 ORDER BY sequence DESC LIMIT 1', [id, scope.organizationId, scope.workspaceId]); return result.rows[0] }
  async #insertEvent(client, scope, event) { await client.query('INSERT INTO adx_change_case_event (event_id, organization_id, workspace_id, change_case_id, sequence, event_type, event_version, occurred_at, actor, correlation_id, causation_id, idempotency_key, policy_version, payload, payload_digest, previous_event_digest, event_digest, signature, signature_key_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)', [event.eventId, scope.organizationId, scope.workspaceId, event.aggregateId, event.sequence, event.eventType, event.eventVersion, event.occurredAt, event.actor, event.correlationId, event.causationId ?? null, event.idempotencyKey, event.policyVersion, event.payload, event.payloadDigest, event.previousEventDigest ?? null, event.eventDigest, event.signature, event.signatureKeyId]) }
  async #outbox(client, scope, changeCaseId, event, correlationId) { await client.query('INSERT INTO adx_outbox_message (id, organization_id, workspace_id, change_case_id, event_id, message_type, provider_idempotency_key, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), scope.organizationId, scope.workspaceId, changeCaseId, event.eventId, 'ChangeCaseEventPublished.v1', `${changeCaseId}:${event.sequence}`, { eventId: event.eventId, correlationId }]) }
}

function actorOf(principal) { return { type: principal.type, subject: principal.id, issuer: principal.issuer ?? 'adx.local' } }
