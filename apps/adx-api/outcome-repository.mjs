import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { ChangeCaseError } from './change-case-ledger.mjs'
import { exportOutcomeForEvaluation } from './outcome-record.mjs'

export class PostgresOutcomeRepository {
  constructor({ connectionString }) { if (!connectionString) throw new Error('OUTCOME_REPOSITORY_CONFIGURATION_REQUIRED'); this.pool = new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 10_000 }) }
  async scoped(scope, work) { const client = await this.pool.connect(); try { await client.query('BEGIN'); await client.query("SELECT set_config('adx.organization_id',$1,true),set_config('adx.workspace_id',$2,true)", [scope.organizationId, scope.workspaceId]); const value = await work(client); await client.query('COMMIT'); return value } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() } }
  async retain({ scope, principal, outcome }) {
    if (principal?.type !== 'service' || !principal.id || !outcome?.outcomeDigest) throw new ChangeCaseError('OUTCOME_WRITER_REQUIRED', 'Only the outcome service may retain a valid outcome record.')
    return this.scoped(scope, async (client) => {
      const changeCase = await client.query('SELECT 1 FROM adx_change_case WHERE id=$1 AND organization_id=$2 AND workspace_id=$3', [outcome.changeCaseId, scope.organizationId, scope.workspaceId])
      if (!changeCase.rowCount) throw new ChangeCaseError('CHANGE_CASE_NOT_FOUND', 'Change Case was not found.')
      const id = randomUUID()
      const retained = await client.query('INSERT INTO adx_outcome_record (id,organization_id,workspace_id,change_case_id,release_candidate_id,outcome,outcome_digest,outcome_type,taxonomy,recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (change_case_id,outcome_digest) DO NOTHING RETURNING id', [id, scope.organizationId, scope.workspaceId, outcome.changeCaseId, outcome.releaseCandidateId, outcome, outcome.outcomeDigest, outcome.outcome, outcome.taxonomy, principal.id])
      const outcomeRecordId = retained.rowCount ? id : (await client.query('SELECT id FROM adx_outcome_record WHERE change_case_id=$1 AND outcome_digest=$2', [outcome.changeCaseId, outcome.outcomeDigest])).rows[0].id
      return { accepted: true, deduplicated: !retained.rowCount, outcomeRecordId, outcomeDigest: outcome.outcomeDigest }
    })
  }
  async exportForEvaluation({ scope, principal, outcomeRecordId, evaluationVersion }) {
    if (principal?.type !== 'service' || !principal.id || typeof evaluationVersion !== 'string' || !evaluationVersion.trim()) throw new ChangeCaseError('OUTCOME_EXPORT_INVALID', 'The evaluation service and an immutable evaluation version are required.')
    return this.scoped(scope, async (client) => {
      const row = await client.query('SELECT outcome FROM adx_outcome_record WHERE id=$1 AND organization_id=$2 AND workspace_id=$3', [outcomeRecordId, scope.organizationId, scope.workspaceId])
      if (!row.rowCount) throw new ChangeCaseError('OUTCOME_RECORD_NOT_FOUND', 'Outcome record was not found.')
      const payload = exportOutcomeForEvaluation(row.rows[0].outcome); const id = randomUUID()
      const inserted = await client.query('INSERT INTO adx_outcome_evaluation_export (id,organization_id,workspace_id,outcome_record_id,evaluation_version,payload,export_digest,exported_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (outcome_record_id,evaluation_version,export_digest) DO NOTHING RETURNING id', [id, scope.organizationId, scope.workspaceId, outcomeRecordId, evaluationVersion.trim(), payload, payload.exportDigest, principal.id])
      return { accepted: true, deduplicated: !inserted.rowCount, exportDigest: payload.exportDigest }
    })
  }
  async list(scope, changeCaseId) { return this.scoped(scope, async (client) => (await client.query('SELECT id,outcome_digest AS "outcomeDigest",outcome_type AS outcome,taxonomy,release_candidate_id AS "releaseCandidateId",created_at AS "createdAt" FROM adx_outcome_record WHERE change_case_id=$1 AND organization_id=$2 AND workspace_id=$3 ORDER BY created_at DESC', [changeCaseId, scope.organizationId, scope.workspaceId])).rows) }
  async close() { await this.pool.end() }
}
