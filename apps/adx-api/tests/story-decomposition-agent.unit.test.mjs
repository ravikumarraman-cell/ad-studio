import assert from 'node:assert/strict'
import test from 'node:test'
import { createStoryDecompositionAgent } from '../story-decomposition-agent.mjs'

const changeCase = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Explain an authorization decision', state: 'RISK_REVIEW', riskTier: 'R2' }
const governance = { intent: { outcome: 'Make the decision understandable to members.', acceptanceCriteria: 'The member can view the decision and reason.', targetRepository: 'health-auth-service', assets: [] }, assessment: { riskTier: 'R2' }, ambiguities: [] }
const suggestions = [{ title: 'View decision', narrative: 'As a member, I want to view my authorization decision, so that I understand the outcome.', scenarios: [{ given: 'a completed decision', when: 'the member opens the decision', then: 'the outcome and reason are displayed' }] }]

test('story decomposition agent creates a bounded preview receipt without workflow authority', async () => {
  const agent = createStoryDecompositionAgent({ suggestionService: { status: () => ({ configured: true, provider: 'OLLAMA_LOCAL', model: 'local-story-model' }), suggest: async () => ({ provider: 'OLLAMA_LOCAL', model: 'local-story-model', providerRequestId: 'request-1', suggestions }) } })
  const run = await agent.run({ changeCase, governance, correlationId: 'trace-1' })
  assert.equal(run.mode, 'AGENTIC_PREVIEW_ONLY')
  assert.equal(run.agent.functions.length, 4)
  assert.equal(run.authority.mayPersistStories, false)
  assert.equal(run.authority.mayApproveStories, false)
  assert.match(run.receipt.runDigest, /^sha256:/)
  assert.equal(run.inspection.validBdd, true)
})

test('story decomposition agent binds a reviewed specification template to its receipt', async () => {
  const agent = createStoryDecompositionAgent({ suggestionService: { status: () => ({ configured: true }), suggest: async ({ guidance }) => { assert.match(guidance, /smallest independently valuable user stories/); return { provider: 'OLLAMA_LOCAL', model: 'local-story-model', suggestions } } } })
  const run = await agent.run({ changeCase, governance, correlationId: 'trace-template', templateId: 'user-value-slices' })
  assert.equal(run.receipt.template.id, 'user-value-slices')
  await assert.rejects(() => agent.run({ changeCase, governance, correlationId: 'trace-template-denied', templateId: 'unknown' }), { code: 'AGENT_SPEC_TEMPLATE_NOT_ALLOWED' })
})

test('story decomposition agent supplies the complete feature decomposition playbook', async () => {
  const output = []
  const originalInfo = console.info
  console.info = (message) => output.push(message)
  try {
    const agent = createStoryDecompositionAgent({ suggestionService: { status: () => ({ configured: true }), suggest: async ({ guidance }) => { assert.match(guidance, /Phase 1: Requirement Analysis/); assert.match(guidance, /Phase 4: Story Decomposition/); assert.match(guidance, /Story Quality Checklist/); return { provider: 'OLLAMA_LOCAL', model: 'local-story-model', suggestions } } } })
    const run = await agent.run({ changeCase, governance, correlationId: 'trace-playbook', templateId: 'feature-decomposition-playbook' })
    assert.equal(run.receipt.template.id, 'feature-decomposition-playbook')
    assert.match(run.receipt.template.digest, /^sha256:/)
  } finally {
    console.info = originalInfo
  }
  assert.match(output[0], /^\[ADX story decomposition input trace-playbook\]/)
  assert.match(output[0], /Phase 1: Requirement Analysis/)
  assert.match(output[0], /Phase 4: Story Decomposition/)
  assert.match(output[0], /Story Quality Checklist/)
  assert.match(output[0], /"inputDigest": "sha256:/)
})

test('story decomposition agent refuses unresolved intake ambiguity', async () => {
  const agent = createStoryDecompositionAgent({ suggestionService: { status: () => ({}), suggest: async () => ({ suggestions }) } })
  await assert.rejects(() => agent.run({ changeCase, governance: { ...governance, ambiguities: [{ code: 'SOURCE_CONTENT_MISSING', status: 'OPEN' }] }, correlationId: 'trace-2' }), { code: 'STORY_AGENT_CLARIFICATION_REQUIRED' })
})