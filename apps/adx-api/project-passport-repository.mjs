import { PostgresTenantRepository } from './postgres.mjs'

export class PostgresProjectPassportRepository {
  constructor({ connectionString, tenantRepository } = {}) {
    this.tenantRepository = tenantRepository ?? new PostgresTenantRepository(connectionString)
  }

  async list(scope) {
    return this.tenantRepository.scoped(scope.organizationId, scope.workspaceId, async (client) => (
      await client.query(
        `SELECT id, project_key AS "projectKey", display_name AS "displayName", owner, state, created_at AS "createdAt"
         FROM adx_project
         WHERE organization_id = $1 AND workspace_id = $2
         ORDER BY display_name, id`,
        [scope.organizationId, scope.workspaceId]
      )
    ).rows)
  }

  async getProject(scope, projectId) {
    return this.tenantRepository.scoped(scope.organizationId, scope.workspaceId, async (client) => (
      await client.query(
        `SELECT id, project_key AS "projectKey", display_name AS "displayName", owner, state, created_at AS "createdAt"
         FROM adx_project
         WHERE id = $1 AND organization_id = $2 AND workspace_id = $3`,
        [projectId, scope.organizationId, scope.workspaceId]
      )
    ).rows[0] ?? null)
  }

  async listInstallations(scope, projectId) {
    return this.tenantRepository.scoped(scope.organizationId, scope.workspaceId, async (client) => (
      await client.query(
        `SELECT id, project_id AS "projectId", canonical_remote AS "canonicalRemote", default_base_ref AS "defaultBaseRef",
                manifest_digest AS "manifestDigest", state, created_at AS "createdAt"
         FROM adx_project_installation
         WHERE project_id = $1 AND organization_id = $2 AND workspace_id = $3
         ORDER BY created_at DESC, id DESC`,
        [projectId, scope.organizationId, scope.workspaceId]
      )
    ).rows)
  }

  async getInstallation(scope, projectId, installationId) {
    return this.tenantRepository.scoped(scope.organizationId, scope.workspaceId, async (client) => (
      await client.query(
        `SELECT id, project_id AS "projectId", canonical_remote AS "canonicalRemote", default_base_ref AS "defaultBaseRef",
                manifest_digest AS "manifestDigest", state, created_at AS "createdAt"
         FROM adx_project_installation
         WHERE id = $1 AND project_id = $2 AND organization_id = $3 AND workspace_id = $4`,
        [installationId, projectId, scope.organizationId, scope.workspaceId]
      )
    ).rows[0] ?? null)
  }

  async getSnapshot(scope, projectId, snapshotId) {
    return this.tenantRepository.scoped(scope.organizationId, scope.workspaceId, async (client) => (
      await client.query(
        `SELECT id, installation_id AS "installationId", schema_version AS "schemaVersion", passport,
                passport_digest AS "passportDigest", effective_policy AS "effectivePolicy",
                effective_policy_digest AS "effectivePolicyDigest", captured_by AS "capturedBy", captured_at AS "capturedAt"
         FROM adx_passport_snapshot snapshot
         INNER JOIN adx_project_installation installation ON installation.id = snapshot.installation_id
         WHERE snapshot.id = $1 AND installation.project_id = $2
           AND snapshot.organization_id = $3 AND snapshot.workspace_id = $4`,
        [snapshotId, projectId, scope.organizationId, scope.workspaceId]
      )
    ).rows[0] ?? null)
  }

  async close() { await this.tenantRepository.pool?.end() }
}
