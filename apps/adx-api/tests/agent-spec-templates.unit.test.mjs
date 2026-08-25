import assert from 'node:assert/strict'
import test from 'node:test'
import { listAgentSpecTemplates, resolveAgentSpecTemplate } from '../agent-spec-templates.mjs'

test('reviewed agent specifications expose three concise choices per workflow', () => {
  assert.equal(listAgentSpecTemplates('story').length, 3)
  assert.equal(listAgentSpecTemplates('coding').length, 3)
  assert.equal(resolveAgentSpecTemplate('coding', 'bug-fix-proof').version, '1.0.0')
})

test('agent specification resolver rejects browser-supplied unknown IDs', () => {
  assert.throws(() => resolveAgentSpecTemplate('story', 'invent-a-policy'), { code: 'AGENT_SPEC_TEMPLATE_NOT_ALLOWED' })
})