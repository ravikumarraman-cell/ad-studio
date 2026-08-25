import assert from 'node:assert/strict'
import test from 'node:test'
import { renderStoryReleasePlanningPage } from '../story-release-planning-page.mjs'

const changeCase = { title: 'Referral status', state: 'DESIGN_REVIEW', riskTier: 'R2', projectionVersion: 8 }
const view = { approvedStories: { storyDigest: 'sha256:approved', stories: [{ key: 'STORY-1', title: 'View status', narrative: 'As a member, I want to view referral status, so that I understand next steps.' }, { key: 'STORY-2', title: 'Follow up', narrative: 'As an operator, I want to follow up, so that referrals do not stall.' }] }, plan: { priorities: [{ storyKey: 'STORY-2', priority: 1 }, { storyKey: 'STORY-1', priority: 2 }] }, syncs: [{ storyKey: 'STORY-2', priority: 1, owner: 'acme', repository: 'care', milestoneNumber: 7, issueNumber: 42, issueUrl: 'https://github.com/acme/care/issues/42' }] }
const endpoints = { priorityEndpoint: '/priority', milestonesEndpoint: '/milestones', publishEndpoint: '/publish', storyDigest: 'sha256:approved' }

test('release planning renders ranked approved stories, milestone discovery, and immutable publication history', () => {
  const page = renderStoryReleasePlanningPage(changeCase, view, { canPlan: true, publisherConfigured: true, endpoints })
  assert.match(page, /One ordered delivery plan/)
  assert.match(page, /STORY-2/)
  assert.ok(page.indexOf('Follow up') < page.indexOf('View status'))
  assert.match(page, /Load milestones/)
  assert.match(page, /Publish prioritized stories/)
  assert.match(page, /GitHub issue #42/)
  assert.match(page, /story-priority-plan|priorityEndpoint/)
  assert.match(page, /storyDigest/)
})

test('release planning explains its workflow boundary when no approved story contract exists', () => {
  const page = renderStoryReleasePlanningPage(changeCase, { approvedStories: null, plan: null, syncs: [] }, { canPlan: true, publisherConfigured: true, endpoints })
  assert.match(page, /independently approved story revision is required/)
  assert.doesNotMatch(page, /Publish prioritized stories/)
})