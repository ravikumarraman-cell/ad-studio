import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { loadLocalEnv } from './load-local-env.mjs'
import { createOutcomeRecord } from '../apps/adx-api/outcome-record.mjs'
import { PostgresOutcomeRepository } from '../apps/adx-api/outcome-repository.mjs'

await loadLocalEnv()
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED_FOR_STAGE9_POSTGRES_VERIFICATION')
const scope = { organizationId: '11111111-1111-4111-8111-111111111111', workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
const other = { organizationId: '22222222-2222-4222-8222-222222222222', workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }
const changeCaseId = randomUUID(); const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 }); const repository = new PostgresOutcomeRepository({ connectionString: process.env.DATABASE_URL })
try { await pool.query('INSERT INTO adx_change_case (id,organization_id,workspace_id,title,state,risk_tier,projection_version,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [changeCaseId, scope.organizationId, scope.workspaceId, 'Outcome persistence proof', 'READY_FOR_DELIVERY', 'R2', 1, 'fixture:stage9']); const outcome = createOutcomeRecord({ changeCaseId, releaseCandidateId: 'release-stage9', outcome: 'ROLLED_BACK', taxonomy: 'LATENCY_REGRESSION', summary: 'Rollback completed.', rollback: { artifactDigest: 'sha256:known-good', reason: 'Latency regression.' }, metrics: { p95LatencyMs: 702, contactEmail: 'private@example.test' } }); const retained = await repository.retain({ scope, principal: { id: 'service:outcome', type: 'service' }, outcome }); assert.equal(retained.deduplicated, false); assert.equal((await repository.retain({ scope, principal: { id: 'service:outcome', type: 'service' }, outcome })).deduplicated, true); assert.equal((await repository.list(scope, changeCaseId)).length, 1); assert.equal((await repository.list(other, changeCaseId)).length, 0); assert.equal((await repository.exportForEvaluation({ scope, principal: { id: 'service:evaluation', type: 'service' }, outcomeRecordId: retained.outcomeRecordId, evaluationVersion: 'evaluation-v1' })).deduplicated, false); await assert.rejects(() => repository.retain({ scope, principal: { id: 'human:writer', type: 'human' }, outcome })); console.log('Stage 9 PostgreSQL outcome retention, tenant isolation, idempotency, and immutable redacted evaluation export verification passed.') } finally { await repository.close(); await pool.end() }
