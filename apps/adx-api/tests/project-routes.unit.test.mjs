import assert from 'node:assert/strict'
import test from 'node:test'
import { authorizationAction, matchProjectRoute } from '../project-routes.mjs'

const workspaceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const projectId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const installationId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

test('matches read-only project catalog routes', () => {
  assert.deepEqual(matchProjectRoute(`/v1/workspaces/${workspaceId}/projects`)?.slice(1), [workspaceId, undefined, undefined, undefined])
  assert.deepEqual(matchProjectRoute(`/v1/workspaces/${workspaceId}/projects/${projectId}`)?.slice(1), [workspaceId, projectId, undefined, undefined])
  assert.deepEqual(matchProjectRoute(`/v1/workspaces/${workspaceId}/projects/${projectId}/installations`)?.slice(1), [workspaceId, projectId, 'installations', undefined])
  assert.deepEqual(matchProjectRoute(`/v1/workspaces/${workspaceId}/projects/${projectId}/snapshots/${installationId}`)?.slice(1), [workspaceId, projectId, 'snapshots', installationId])
})

test('rejects unsupported catalog paths and writes', () => {
  assert.equal(matchProjectRoute(`/v1/workspaces/${workspaceId}/projects/${projectId}/activate`), null)
  assert.equal(authorizationAction('GET'), 'workspace.read')
  assert.equal(authorizationAction('POST'), null)
})
