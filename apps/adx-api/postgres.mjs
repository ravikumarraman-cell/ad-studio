import pg from 'pg'

export class PostgresTenantRepository {
  constructor(connectionString) { this.pool = new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 10_000 }) }
  async scoped(organizationId, workspaceId, work) {
    const client = await this.pool.connect()
    try { await client.query('BEGIN'); await client.query("SELECT set_config('adx.organization_id', $1, true), set_config('adx.workspace_id', $2, true)", [organizationId, workspaceId]); const value = await work(client); await client.query('COMMIT'); return value } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }
  async memberships(principalId) { const { rows } = await this.pool.query('SELECT organization_id AS "organizationId", workspace_id AS "workspaceId", roles, version FROM adx_workspace_membership WHERE principal_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())', [principalId]); return rows }
  async listResources(scope) { return this.scoped(scope.organizationId, scope.workspaceId, async (client) => (await client.query('SELECT id, workspace_id AS "workspaceId", resource_type AS type, risk_tier AS "riskTier", resource_version AS version, payload->>\'label\' AS label FROM adx_tenant_resource ORDER BY id')).rows) }
}
