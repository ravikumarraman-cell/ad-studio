import assert from 'node:assert/strict'
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { ChangeCaseError, rebuildProjection } from '../apps/adx-api/change-case-ledger.mjs'
import { PostgresChangeCaseRepository } from '../apps/adx-api/change-case-repository.mjs'
import { loadLocalEnv } from './load-local-env.mjs'

await loadLocalEnv()
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED_FOR_STAGE2_POSTGRES_VERIFICATION')
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const repository = new PostgresChangeCaseRepository({ connectionString: process.env.DATABASE_URL, signer: { keyId: 'stage2-postgres-test-ed25519', privateKey, publicKey } })
const scope = { organizationId: '11111111-1111-4111-8111-111111111111', workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
const principal = { id: `test:stage2:${randomUUID()}`, type: 'human', issuer: 'stage2-test' }
const key = `create-${randomUUID()}`

try {
  const created = await repository.create({ scope, principal, title: 'Durable Change Case', riskTier: 'R2', idempotencyKey: key })
  const duplicate = await repository.create({ scope, principal, title: 'Durable Change Case', riskTier: 'R2', idempotencyKey: key })
  assert.equal(created.changeCaseId, duplicate.changeCaseId)
  assert.equal(duplicate.deduplicated, true)

  const initialEvents = await repository.timeline(scope, created.changeCaseId)
  const initialOutbox = await repository.outbox(scope, created.changeCaseId)
  assert.equal(initialEvents.length, 1)
  assert.equal(initialOutbox.length, 1)
  await assert.rejects(() => repository.editDraft({ scope, principal, changeCaseId: created.changeCaseId, title: 'Stale write', expectedVersion: 0, idempotencyKey: `stale-${randomUUID()}` }), (error) => error instanceof ChangeCaseError && error.code === 'VERSION_CONFLICT')

  const edited = await repository.editDraft({ scope, principal, changeCaseId: created.changeCaseId, title: 'Durable Change Case, edited', expectedVersion: 1, idempotencyKey: `edit-${randomUUID()}` })
  const transitioned = await repository.transition({ scope, principal, changeCaseId: created.changeCaseId, toState: 'INTAKE', expectedVersion: edited.projectionVersion, idempotencyKey: `transition-${randomUUID()}` })
  assert.equal(transitioned.newState, 'INTAKE')
  const events = await repository.timeline(scope, created.changeCaseId)
  const outbox = await repository.outbox(scope, created.changeCaseId)
  assert.equal(events.length, 3)
  assert.equal(outbox.length, 3)
  const projection = rebuildProjection(events, (keyId) => keyId === 'stage2-postgres-test-ed25519' ? publicKey : null)
  assert.equal(projection.title, 'Durable Change Case, edited')
  assert.equal(projection.state, 'INTAKE')
  assert.equal(projection.projectionVersion, 3)
  const checkpoint = await repository.checkpoint(scope, created.changeCaseId)
  assert.equal(checkpoint.throughSequence, 3)
  const integrity = await repository.verifyIntegrity(scope, created.changeCaseId)
  assert.equal(integrity.projection.state, 'INTAKE')
  assert.equal(integrity.checkpoint.throughSequence, 3)
  const deliveryId = `delivery-${randomUUID()}`
  const received = await repository.receiveProviderSignal({ scope, provider: 'stage2-provider', deliveryId, changeCaseId: created.changeCaseId, occurredAt: '2026-08-18T12:03:00.000Z', payload: { state: 'observed' } })
  const duplicateSignal = await repository.receiveProviderSignal({ scope, provider: 'stage2-provider', deliveryId, changeCaseId: created.changeCaseId, occurredAt: '2026-08-18T12:03:00.000Z', payload: { state: 'observed' } })
  assert.equal(received.deduplicated, false); assert.equal(duplicateSignal.deduplicated, true)
  await repository.receiveProviderSignal({ scope, provider: 'stage2-provider', deliveryId: `delivery-late-${randomUUID()}`, changeCaseId: created.changeCaseId, occurredAt: '2026-08-18T12:05:00.000Z', payload: { state: 'late' } })
  await repository.receiveProviderSignal({ scope, provider: 'stage2-provider', deliveryId: `delivery-early-${randomUUID()}`, changeCaseId: created.changeCaseId, occurredAt: '2026-08-18T12:04:00.000Z', payload: { state: 'early' } })
  const inbox = await repository.inbox(scope, created.changeCaseId)
  assert.equal(inbox.length, 3); assert.deepEqual(inbox.map((item) => item.payload.state), ['observed', 'early', 'late'])
  const reconciliation = await repository.requireReconciliation(scope, outbox[0].id, 'PROVIDER_TIMEOUT')
  assert.equal(reconciliation.status, 'RECONCILIATION_REQUIRED')
  assert.equal((await repository.outbox(scope, created.changeCaseId))[0].status, 'RECONCILIATION_REQUIRED')
  const observedCase = await repository.create({ scope, principal, title: 'Provider reconciliation Change Case', riskTier: 'R1', idempotencyKey: `reconcile-case-${randomUUID()}` })
  await repository.receiveProviderSignal({ scope, provider: 'stage2-provider', deliveryId: `reconcile-late-${randomUUID()}`, changeCaseId: observedCase.changeCaseId, occurredAt: '2026-08-18T12:12:00.000Z', payload: { observedState: 'INTAKE' } })
  await repository.receiveProviderSignal({ scope, provider: 'stage2-provider', deliveryId: `reconcile-early-${randomUUID()}`, changeCaseId: observedCase.changeCaseId, occurredAt: '2026-08-18T12:11:00.000Z', payload: { observedState: 'INTAKE' } })
  const converged = await repository.reconcileObservedState({ scope, changeCaseId: observedCase.changeCaseId, provider: 'stage2-provider' })
  const convergedAgain = await repository.reconcileObservedState({ scope, changeCaseId: observedCase.changeCaseId, provider: 'stage2-provider' })
  assert.equal(converged.newState, 'INTAKE'); assert.equal(convergedAgain.converged, true); assert.equal((await repository.timeline(scope, observedCase.changeCaseId)).length, 2)
  console.log('Stage 2 PostgreSQL transaction, idempotency, optimistic-concurrency, outbox/inbox, reconciliation, and replay verification passed.')
} finally { await repository.close() }
