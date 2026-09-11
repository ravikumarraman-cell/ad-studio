import assert from 'node:assert/strict'
import test from 'node:test'
import { listAgentSpecTemplates, resolveAgentSpecTemplate } from '../agent-spec-templates.mjs'

test('reviewed agent specifications expose registered choices per workflow', () => {
  assert.equal(listAgentSpecTemplates('story').length, 4)
  assert.equal(listAgentSpecTemplates('coding').length, 5)
  assert.ok(listAgentSpecTemplates('coding').some((template) => template.id === 'engineering'))
  assert.equal(resolveAgentSpecTemplate('coding', 'bug-fix-proof').version, '1.0.0')
  assert.equal(resolveAgentSpecTemplate('coding', 'engineering').label, 'Engineering Implementation Specification')
  const tenantCompass = resolveAgentSpecTemplate('coding', 'cloud-asset-inventory-reuse-first')
  assert.equal(tenantCompass.version, '1.1.0')
  assert.match(tenantCompass.guidance, /distinct patched test file/)
  assert.match(tenantCompass.guidance, /Never construct `boto3\.resource\(\)`/)
  assert.match(tenantCompass.guidance, /MUST NOT claim a story is covered merely because a file was touched/)
  const playbook = resolveAgentSpecTemplate('story', 'feature-decomposition-playbook')
  assert.equal(playbook.label, 'Feature decomposition playbook')
  assert.match(playbook.guidance, /Phase 1: Requirement Analysis/)
  assert.match(playbook.guidance, /Story Quality Checklist/)
})

test('agent specification resolver rejects browser-supplied unknown IDs', () => {
  assert.throws(() => resolveAgentSpecTemplate('story', 'invent-a-policy'), { code: 'AGENT_SPEC_TEMPLATE_NOT_ALLOWED' })
})