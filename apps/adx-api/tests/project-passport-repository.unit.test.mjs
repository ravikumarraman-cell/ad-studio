import assert from 'node:assert/strict'
import test from 'node:test'
import { PostgresProjectPassportRepository } from '../project-passport-repository.mjs'

const scope = { organizationId: 'org-a', workspaceId: 'workspace-a' }

function createRepository(rows = []) {
  const calls = []
  const tenantRepository = {
    async scoped(organizationId, workspaceId, work) {
      assert.equal(organizationId, scope.organizationId)
      assert.equal(workspaceId, scope.workspaceId)
      return work({ query: async (text, values) => { calls.push({ text, values }); return { rows } } })
    },
  }
  return { repository: new PostgresProjectPassportRepository({ tenantRepository }), calls }
}

test('lists projects inside the scoped tenant transaction', async () => {
  const { repository, calls } = createRepository([{ id: 'project-health-x', projectKey: 'health-x' }])
  const projects = await repository.list(scope)
  assert.deepEqual(projects, [{ id: 'project-health-x', projectKey: 'health-x' }])
  assert.match(calls[0].text, /FROM adx_project/)
  assert.deepEqual(calls[0].values, ['org-a', 'workspace-a'])
})

test('returns null when an installation is not visible in the caller workspace', async () => {
  const { repository, calls } = createRepository()
  assert.equal(await repository.getInstallation(scope, 'project-health-x', 'installation-health-x'), null)
  assert.match(calls[0].text, /FROM adx_project_installation/)
  assert.deepEqual(calls[0].values, ['installation-health-x', 'project-health-x', 'org-a', 'workspace-a'])
})

test('reads immutable Passport snapshots without mutation methods', async () => {
  const snapshot = { id: 'snapshot-health-x', passportDigest: 'sha256:passport' }
  const { repository, calls } = createRepository([snapshot])
  assert.deepEqual(await repository.getSnapshot(scope, 'project-health-x', snapshot.id), snapshot)
  assert.match(calls[0].text, /FROM adx_passport_snapshot/)
  assert.equal(typeof repository.create, 'undefined')
  assert.equal(typeof repository.activate, 'undefined')
})
