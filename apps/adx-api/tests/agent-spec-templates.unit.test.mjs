import assert from 'node:assert/strict'
import test from 'node:test'
import { listAgentSpecTemplates, resolveAgentSpecTemplate } from '../agent-spec-templates.mjs'

test('reviewed agent specifications expose registered choices per workflow', () => {
  assert.equal(listAgentSpecTemplates('story').length, 4)
  assert.equal(listAgentSpecTemplates('coding').length, 3)
  assert.equal(resolveAgentSpecTemplate('coding', 'bug-fix-proof').version, '1.0.0')
  const playbook = resolveAgentSpecTemplate('story', 'feature-decomposition-playbook')
  assert.equal(playbook.label, 'Feature decomposition playbook')
  assert.match(playbook.guidance, /Phase 1: Requirement Analysis/)
  assert.match(playbook.guidance, /Story Quality Checklist/)
})

test('agent specification resolver rejects browser-supplied unknown IDs', () => {
  assert.throws(() => resolveAgentSpecTemplate('story', 'invent-a-policy'), { code: 'AGENT_SPEC_TEMPLATE_NOT_ALLOWED' })
})