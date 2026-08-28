import assert from 'node:assert/strict'
import test from 'node:test'
import { authorize } from './index.mjs'

const scope = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
}

test('workspace administrators can independently review governed resources', () => {
  const decision = authorize({
    principal: { id: 'oidc:https://accounts.google.com:reviewer', type: 'human' },
    memberships: [{ ...scope, roles: ['workspace_admin'] }],
    resource: {
      id: '22222222-2222-4222-8222-222222222222',
      ...scope,
      ownerId: 'oidc:https://accounts.google.com:author',
    },
    action: 'resource.review',
    context: { separationOfDutyAction: 'resource.review' },
  })

  assert.equal(decision.outcome, 'ALLOW')
  assert.equal(decision.reason, 'POLICY_SATISFIED')
})

test('workspace administrators still cannot review their own governed resources', () => {
  const principal = { id: 'oidc:https://accounts.google.com:author', type: 'human' }
  const decision = authorize({
    principal,
    memberships: [{ ...scope, roles: ['workspace_admin'] }],
    resource: {
      id: '22222222-2222-4222-8222-222222222222',
      ...scope,
      ownerId: principal.id,
    },
    action: 'resource.review',
    context: { separationOfDutyAction: 'resource.review' },
  })

  assert.equal(decision.outcome, 'DENY')
  assert.equal(decision.reason, 'SEPARATION_OF_DUTY')
})