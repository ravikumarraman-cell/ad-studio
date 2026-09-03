import assert from 'node:assert/strict'
import test from 'node:test'
import { authorizationAction, matchChangeCaseRoute } from '../change-case-routes.mjs'

test('generated candidate route resolves as a change-case operation', () => {
  const match = matchChangeCaseRoute('/v1/workspaces/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/change-cases/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/generated-candidate')
  assert.ok(match)
  assert.equal(match[3], 'generated-candidate')
})

test('story release planning routes resolve and protect GitHub milestone discovery as a write action', () => {
  const match = matchChangeCaseRoute('/v1/workspaces/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/change-cases/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/story-release-planning')
  assert.ok(match)
  assert.equal(match[3], 'story-release-planning')
  assert.equal(authorizationAction('GET', 'story-milestones'), 'resource.write')
})

test('outcome recording routes require reviewer authorization', () => {
  const match = matchChangeCaseRoute('/v1/workspaces/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/change-cases/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/outcome-record')
  assert.ok(match)
  assert.equal(match[3], 'outcome-record')
  assert.equal(authorizationAction('POST', 'outcome-record'), 'resource.review')
})
