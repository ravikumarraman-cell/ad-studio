import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { ChangeCaseError, assertTransition, createCheckpoint, createSignedEvent, rebuildProjection, verifyCheckpoint } from '../apps/adx-api/change-case-ledger.mjs'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const signer = { keyId: 'stage2-test-ed25519', privateKey }
const resolvePublicKey = (keyId) => keyId === signer.keyId ? publicKey : null
const ids = { changeCase: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', organization: '11111111-1111-4111-8111-111111111111', workspace: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', actor: 'oidc:https://issuer.example:alice', correlation: '99999999-9999-4999-8999-999999999999' }

const created = createSignedEvent({ aggregateId: ids.changeCase, sequence: 1, eventType: 'ChangeCaseCreated.v1', actor: { type: 'human', subject: ids.actor, issuer: 'https://issuer.example' }, correlationId: ids.correlation, idempotencyKey: 'create-change-case-0001', policyVersion: 'adx-authz-1', payload: { organizationId: ids.organization, workspaceId: ids.workspace, title: 'Prior authorization intake', riskTier: 'R2' }, signer, occurredAt: '2026-08-18T12:00:00.000Z' })
const renamed = createSignedEvent({ aggregateId: ids.changeCase, sequence: 2, eventType: 'ChangeCaseTitleChanged.v1', actor: { type: 'human', subject: ids.actor, issuer: 'https://issuer.example' }, correlationId: ids.correlation, causationId: created.eventId, idempotencyKey: 'edit-change-case-00001', policyVersion: 'adx-authz-1', payload: { title: 'Prior authorization intake and evidence packet' }, previousEventDigest: created.eventDigest, signer, occurredAt: '2026-08-18T12:01:00.000Z' })
const transitioned = createSignedEvent({ aggregateId: ids.changeCase, sequence: 3, eventType: 'ChangeCaseStateChanged.v1', actor: { type: 'human', subject: ids.actor, issuer: 'https://issuer.example' }, correlationId: ids.correlation, causationId: renamed.eventId, idempotencyKey: 'transition-change-case', policyVersion: 'adx-authz-1', payload: { fromState: 'DRAFT', toState: 'INTAKE' }, previousEventDigest: renamed.eventDigest, signer, occurredAt: '2026-08-18T12:02:00.000Z' })
const events = [created, renamed, transitioned]

const projection = rebuildProjection(events, resolvePublicKey)
assert.deepEqual(projection, { id: ids.changeCase, organizationId: ids.organization, workspaceId: ids.workspace, title: 'Prior authorization intake and evidence packet', riskTier: 'R2', state: 'INTAKE', projectionVersion: 3, createdAt: '2026-08-18T12:00:00.000Z', updatedAt: '2026-08-18T12:02:00.000Z' })
assert.throws(() => assertTransition({ fromState: 'DRAFT', toState: 'INTAKE', expectedVersion: 2, projectionVersion: 3 }), (error) => error instanceof ChangeCaseError && error.code === 'VERSION_CONFLICT')
assert.throws(() => assertTransition({ fromState: 'DRAFT', toState: 'DESIGN_REVIEW', expectedVersion: 3, projectionVersion: 3 }), (error) => error instanceof ChangeCaseError && error.code === 'STATE_TRANSITION_INVALID')

const checkpoint = createCheckpoint({ changeCaseId: ids.changeCase, events, signer, createdAt: '2026-08-18T12:03:00.000Z' })
assert.equal(verifyCheckpoint(checkpoint, events, resolvePublicKey), true)
assert.throws(() => rebuildProjection([...events.slice(0, 1), { ...renamed, payload: { title: 'tampered' } }, transitioned], resolvePublicKey), (error) => error instanceof ChangeCaseError && error.code === 'EVENT_PAYLOAD_TAMPERED')
assert.throws(() => rebuildProjection([created, transitioned], resolvePublicKey), (error) => error instanceof ChangeCaseError && error.code === 'EVENT_SEQUENCE_GAP')
assert.throws(() => rebuildProjection([created, { ...renamed, previousEventDigest: 'sha256:broken' }, transitioned], resolvePublicKey), (error) => error instanceof ChangeCaseError && error.code === 'EVENT_CHAIN_BROKEN')
assert.throws(() => verifyCheckpoint({ ...checkpoint, merkleRoot: 'sha256:tampered' }, events, resolvePublicKey), (error) => error instanceof ChangeCaseError && error.code === 'CHECKPOINT_MISMATCH')
assert.throws(() => verifyCheckpoint({ ...checkpoint, signature: 'tampered' }, events, resolvePublicKey), (error) => error instanceof ChangeCaseError && error.code === 'CHECKPOINT_SIGNATURE_INVALID')

console.log('Stage 2 state-machine, signed-ledger, hash-chain, checkpoint, and projection-rebuild verification passed.')
