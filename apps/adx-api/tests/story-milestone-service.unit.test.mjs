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