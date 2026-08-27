import assert from 'node:assert/strict'
import test from 'node:test'
import { renderStoryReleasePlanningPage } from '../story-release-planning-page.mjs'

const changeCase = { title: 'Referral status', state: 'DESIGN_REVIEW', riskTier: 'R2', projectionVersion: 8 }
const view = { approvedStories: { storyDigest: 'sha256:approved', stories: [{ key: 'STORY-1', sourceStoryKey: 'STORY-1', changeCaseId: 'case-1', sourceTitle: 'Referral feature', title: 'View status', narrative: 'As a member, I want to view referral status, so that I understand next steps.' }, { key: 'STORY-2', sourceStoryKey: 'STORY-2', changeCaseId: 'case-1', sourceTitle: 'Referral feature', title: 'Follow up', narrative: 'As an operator, I want to follow up, so that referrals do not stall.' }] }, plan: { priorities: [{ storyKey: 'STORY-2', priority: 1 }, { storyKey: 'STORY-1', priority: 2 }] }, syncs: [{ changeCaseId: 'case-1', sourceTitle: 'Referral feature', storyKey: 'STORY-2', priority: 1, owner: 'acme', repository: 'care', milestoneNumber: 7, issueNumber: 42, issueUrl: 'https://github.com/acme/care/issues/42' }] }
const endpoints = { priorityEndpoint: '/priority', milestonesEndpoint: '/milestones', publishEndpoint: '/publish', storyDigest: 'sha256:approved' }

test('release planning renders ranked approved stories, milestone discovery, and immutable publication history', () => {
  const page = renderStoryReleasePlanningPage(changeCase, view, { canPlan: true, publisherConfigured: true, designReviewUrl: '/design-review', endpoints })
  assert.match(page, /Prioritize approved stories/)
  assert.match(page, /What should ship first\?/)
  assert.match(page, /STORY-2/)
  assert.ok(page.indexOf('Follow up') < page.indexOf('View status'))
  assert.match(page, /Find milestones/)
  assert.match(page, /Publish prioritized stories/)
  assert.match(page, /Open issue #42/)
  assert.match(page, /1 story issue published/)
  assert.match(page, /Priority 1/)
  assert.match(page, /Destination: acme\/care · milestone #7/)
  assert.match(page, /Referral feature/)
  assert.match(page, /story-priority-plan|priorityEndpoint/)
  assert.match(page, /storyDigest/)
  assert.match(page, /Continue to Gate C · Design review/)
})

test('release planning remains usable when GitHub publication is not configured', () => {
  const page = renderStoryReleasePlanningPage(changeCase, view, { canPlan: true, publisherConfigured: false, endpoints })
  assert.match(page, /Save delivery order/)
  assert.match(page, /GitHub publishing is not configured/)
  assert.doesNotMatch(page, /Release planning unavailable/)
})

test('release planning explains its workflow boundary when no approved story contract exists', () => {
  const page = renderStoryReleasePlanningPage(changeCase, { approvedStories: null, plan: null, syncs: [] }, { canPlan: true, publisherConfigured: true, endpoints })
  assert.match(page, /independently approved story revision is required/)
  assert.doesNotMatch(page, /Publish prioritized stories/)
})

test('release planning defaults to the one imported source milestone and includes an explicit override flow', () => {
  const sourcedView = { ...view, approvedStories: { ...view.approvedStories, stories: view.approvedStories.stories.map((story) => ({ ...story, sourceMilestone: { owner: 'acme', repository: 'care', number: 7, title: 'Q4 delivery' } })) } }
  const page = renderStoryReleasePlanningPage(changeCase, sourcedView, { canPlan: true, publisherConfigured: true, endpoints })
  assert.match(page, /Default destination: acme\/care/)
  assert.match(page, /Different destination selected/)
  assert.match(page, /Reason for this override/)
  assert.match(page, /sourceMilestoneOverride/)
  assert.match(page, /hasSavedPlan/)
})
