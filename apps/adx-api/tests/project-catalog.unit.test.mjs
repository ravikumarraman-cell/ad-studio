import assert from 'node:assert/strict'
import test from 'node:test'
import { createProjectCatalog } from '../project-catalog.mjs'

const scope = { organizationId: 'org-a', workspaceId: 'workspace-a' }
const healthX = { id: 'installation-health-x', projectId: 'health-x', displayName: 'Health-X', organizationId: 'org-a', workspaceId: 'workspace-a', owner: 'personal-care-demo', canonicalRemote: 'https://example.test/health-x.git', defaultBaseRef: 'refs/heads/main', manifestDigest: 'sha256:manifest' }

test('lists immutable project installations only within the requested workspace', () => {
  const catalog = createProjectCatalog({ installations: [healthX, { ...healthX, id: 'installation-other', projectId: 'other', organizationId: 'org-b', workspaceId: 'workspace-b' }] })
  const projects = catalog.list(scope)
  assert.deepEqual(projects.map(({ id, projectId }) => ({ id, projectId })), [{ id: 'installation-health-x', projectId: 'health-x' }])
  assert.equal(Object.isFrozen(projects[0]), true)
})

test('denies cross-workspace project installation lookup', () => {
  const catalog = createProjectCatalog({ installations: [healthX] })
  assert.throws(() => catalog.get({ organizationId: 'org-b', workspaceId: 'workspace-b' }, healthX.id), { code: 'PROJECT_INSTALLATION_DENIED' })
})

test('rejects incomplete or duplicate installation registration', () => {
  assert.throws(() => createProjectCatalog({ installations: [{ ...healthX, manifestDigest: 'invalid' }] }), { code: 'PROJECT_INSTALLATION_INVALID' })
  assert.throws(() => createProjectCatalog({ installations: [healthX, healthX] }), { code: 'PROJECT_INSTALLATION_DUPLICATE' })
})