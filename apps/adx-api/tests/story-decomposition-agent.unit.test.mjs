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

test('story decomposition agent applies an allowlisted reviewed skill and binds it to the receipt', async () => {
  const agent = createStoryDecompositionAgent({ suggestionService: { status: () => ({ configured: true }), suggest: async ({ templateGuidance }) => { assert.match(templateGuidance, /Decompose by user journey/); return { provider: 'OLLAMA_LOCAL', model: 'local-story-model', suggestions } } } })
  const run = await agent.run({ changeCase, governance, correlationId: 'trace-skill', skillId: 'user-journey' })
  assert.equal(agent.status().skills.length, 3)
  assert.equal(run.receipt.skill.id, 'user-journey')
  assert.equal(run.receipt.skill.version, '1.0.0')
  await assert.rejects(() => agent.run({ changeCase, governance, correlationId: 'trace-skill-denied', skillId: 'unreviewed-skill' }), { code: 'STORY_SKILL_NOT_ALLOWED' })
})

test('story decomposition agent refuses unresolved intake ambiguity', async () => {
  const agent = createStoryDecompositionAgent({ suggestionService: { status: () => ({}), suggest: async () => ({ suggestions }) } })
  await assert.rejects(() => agent.run({ changeCase, governance: { ...governance, ambiguities: [{ code: 'SOURCE_CONTENT_MISSING', status: 'OPEN' }] }, correlationId: 'trace-2' }), { code: 'STORY_AGENT_CLARIFICATION_REQUIRED' })
})