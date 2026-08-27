import assert from 'node:assert/strict'
import test from 'node:test'
import { createStoryMilestoneService } from '../story-milestone-service.mjs'

const stories = [{ key: 'STORY-1', title: 'First value', narrative: 'As a member, I want the first outcome, so that I can proceed.', scenarios: [{ given: 'context', when: 'action', then: 'outcome' }] }, { key: 'STORY-2', title: 'Second value', narrative: 'As an operator, I want the second outcome, so that I can follow up.', scenarios: [{ given: 'context', when: 'action', then: 'outcome' }] }]

test('story milestone service publishes only unsynced approved stories in saved priority order', async () => {
  const calls = []
  const repository = { view: async () => ({ approvedStories: { storyDigest: 'sha256:approved', stories }, plan: { planDigest: 'sha256:plan', priorities: [{ storyKey: 'STORY-2', priority: 1 }, { storyKey: 'STORY-1', priority: 2 }] }, syncs: [{ owner: 'acme', repository: 'care', milestoneNumber: 7, storyKey: 'STORY-1' }] }), retainSync: async (input) => { calls.push(['retain', input]); return { issueNumber: 44, issueUrl: 'https://github.com/acme/care/issues/44' } }, prioritize: async () => {} }
  const client = { listMilestones: async () => [], createIssue: async (input) => { calls.push(['issue', input]); return { number: 44, url: 'https://github.com/acme/care/issues/44' } } }
  const service = createStoryMilestoneService({ repository, client })
  const result = await service.publish({ scope: {}, principal: { id: 'planner' }, changeCaseId: 'case-1', owner: 'acme', repository: 'care', milestoneNumber: 7, expectedVersion: 4 })
  assert.equal(result.published.length, 1)
  assert.equal(calls[0][1].title, '[P1] Second value')
  assert.match(calls[0][1].body, /sha256:approved/)
  assert.equal(calls[1][1].storyKey, 'STORY-2')
})

test('story milestone service refuses publication without a saved priority plan', async () => {
  const service = createStoryMilestoneService({ repository: { view: async () => ({ approvedStories: { storyDigest: 'sha256:approved', stories }, plan: null, syncs: [] }), prioritize: async () => {}, retainSync: async () => {} }, client: { listMilestones: async () => [], createIssue: async () => ({}) } })
  await assert.rejects(() => service.publish({ scope: {}, principal: {}, changeCaseId: 'case-1', owner: 'acme', repository: 'care', milestoneNumber: 7, expectedVersion: 4 }), { code: 'STORY_PRIORITY_PLAN_REQUIRED' })
})

const source = { owner: 'acme', repository: 'care', number: 7, title: 'Q4 delivery' }
const workspaceStories = stories.map((story, index) => ({ ...story, key: `case-1:${story.key}`, sourceStoryKey: story.key, changeCaseId: 'case-1', storyDigest: 'sha256:approved', sourceMilestone: source, sourceTitle: 'Imported feature' }))
const workspacePlan = { planDigest: 'sha256:workspace', priorities: workspaceStories.map((story, index) => ({ storyKey: story.key, priority: index + 1, changeCaseId: story.changeCaseId, storyDigest: story.storyDigest, sourceStoryKey: story.sourceStoryKey, sourceMilestone: source })) }

test('workspace portfolio publishes to its retained source milestone without an override', async () => {
  const calls = []
  const repository = {
    view: async () => ({ plan: null }), prioritize: async () => {}, retainSync: async () => {},
    workspaceView: async () => ({ approvedStories: { stories: workspaceStories }, plan: workspacePlan, syncs: [] }),
    retainWorkspaceSync: async (input) => { calls.push(input); return { issueNumber: 80, issueUrl: 'https://github.com/acme/care/issues/80', deduplicated: false } }
  }
  const client = { listMilestones: async () => [], createIssue: async (input) => { calls.push(input); return { number: 80, url: 'https://github.com/acme/care/issues/80' } } }
  const service = createStoryMilestoneService({ repository, client })
  const result = await service.publish({ scope: {}, principal: { id: 'planner' }, changeCaseId: 'case-1', owner: 'acme', repository: 'care', milestoneNumber: 7 })
  assert.equal(result.published.length, 2)
  assert.equal(result.overrideApplied, false)
  assert.equal(calls[0].milestoneNumber, 7)
})

test('workspace portfolio accepts a source binding read back from JSONB in a different key order', async () => {
  const jsonbOrderedSource = { title: 'Q4 delivery', number: 7, repository: 'care', owner: 'acme' }
  const plan = { ...workspacePlan, priorities: workspacePlan.priorities.map((item) => ({ ...item, sourceMilestone: jsonbOrderedSource })) }
  const repository = { view: async () => ({ plan: null }), prioritize: async () => {}, retainSync: async () => {}, workspaceView: async () => ({ approvedStories: { stories: workspaceStories }, plan, syncs: [] }), retainWorkspaceSync: async () => ({ issueNumber: 80, issueUrl: 'https://github.com/acme/care/issues/80', deduplicated: false }) }
  const service = createStoryMilestoneService({ repository, client: { listMilestones: async () => [], createIssue: async () => ({ number: 80, url: 'https://github.com/acme/care/issues/80' }) } })
  const result = await service.publish({ scope: {}, principal: { id: 'planner' }, changeCaseId: 'case-1', owner: 'acme', repository: 'care', milestoneNumber: 7 })
  assert.equal(result.published.length, 2)
})

test('workspace portfolio requires confirmed, explained override for another milestone', async () => {
  const repository = { view: async () => ({ plan: null }), prioritize: async () => {}, retainSync: async () => {}, workspaceView: async () => ({ approvedStories: { stories: workspaceStories }, plan: workspacePlan, syncs: [] }), retainWorkspaceSync: async () => ({ deduplicated: false }) }
  const service = createStoryMilestoneService({ repository, client: { listMilestones: async () => [], createIssue: async () => ({ number: 81, url: 'https://github.com/acme/care/issues/81' }) } })
  await assert.rejects(() => service.publish({ scope: {}, principal: { id: 'planner' }, changeCaseId: 'case-1', owner: 'acme', repository: 'care', milestoneNumber: 9 }), { code: 'GITHUB_MILESTONE_OVERRIDE_CONFIRMATION_REQUIRED' })
  await assert.rejects(() => service.publish({ scope: {}, principal: { id: 'planner' }, changeCaseId: 'case-1', owner: 'acme', repository: 'care', milestoneNumber: 9, sourceMilestoneOverride: { confirmed: true } }), { code: 'GITHUB_MILESTONE_OVERRIDE_CONFIRMATION_REQUIRED' })
})

test('workspace portfolio retains an explicit override receipt', async () => {
  const receipts = []
  const repository = { view: async () => ({ plan: null }), prioritize: async () => {}, retainSync: async () => {}, workspaceView: async () => ({ approvedStories: { stories: workspaceStories }, plan: workspacePlan, syncs: [] }), retainWorkspaceSync: async (input) => { receipts.push(input); return { issueNumber: 82, issueUrl: 'https://github.com/acme/care/issues/82', deduplicated: false } } }
  const service = createStoryMilestoneService({ repository, client: { listMilestones: async () => [], createIssue: async () => ({ number: 82, url: 'https://github.com/acme/care/issues/82' }) } })
  const result = await service.publish({ scope: {}, principal: { id: 'planner' }, changeCaseId: 'case-1', owner: 'acme', repository: 'care', milestoneNumber: 9, sourceMilestoneOverride: { confirmed: true, rationale: 'Coordinating the release train.' } })
  assert.equal(result.overrideApplied, true)
  assert.equal(receipts[0].destinationOverride.rationale, 'Coordinating the release train.')
})
