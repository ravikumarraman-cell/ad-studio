import assert from 'node:assert/strict'
import test from 'node:test'
import { matchChangeCaseRoute } from '../change-case-routes.mjs'

test('generated candidate route resolves as a change-case operation', () => {
  const match = matchChangeCaseRoute('/v1/workspaces/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/change-cases/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/generated-candidate')
  assert.ok(match)
  assert.equal(match[3], 'generated-candidate')
})