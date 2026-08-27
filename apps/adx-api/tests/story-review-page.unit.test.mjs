import assert from 'node:assert/strict'
import test from 'node:test'
import { renderStoryReviewPage } from '../story-review-page.mjs'

const changeCase = { title: 'Improve care plan reminders', state: 'AWAITING_STORY_APPROVAL', projectionVersion: 7 }
const governance = { stories: { storyDigest: 'sha256:1234567890123456789012345678901234567890', stories: [{ key: 'STORY-1', title: 'Set a reminder', narrative: 'As a member, I want to schedule a reminder.', scenarios: [{ given: 'a care plan', when: 'a reminder is scheduled', then: 'the time is retained' }] }] } }
const options = { canReview: true, isStoryAuthor: false, decisionEndpoint: '/decision', designReviewUrl: '/design', releasePlanningUrl: '/plan', storyWorkshopUrl: '/stories' }

test('story review renders the focused decision surface and retained story evidence', () => {
  const page = renderStoryReviewPage(changeCase, governance, options)
  assert.match(page, /Decision compass/)
  assert.match(page, /What is your decision\?/)
  assert.match(page, /Approve story/)
  assert.match(page, /Return for revision/)
  assert.match(page, /story-decision-form/)
  assert.match(page, /Given/)
  assert.match(page, /--adx-brand/)
})

test('story review preserves separation of duty for the story author', () => {
  const page = renderStoryReviewPage(changeCase, governance, { ...options, isStoryAuthor: true })
  assert.match(page, /Authors cannot approve their own story/)
  assert.doesNotMatch(page, /id="story-decision-form"/)
})

test('story review keeps read-only reviewers out of the decision workflow', () => {
  const page = renderStoryReviewPage(changeCase, governance, { ...options, canReview: false })
  assert.match(page, /Read access does not advance a gate/)
  assert.doesNotMatch(page, /id="story-decision-form"/)
})

test('story review directs completed contracts to their next governed action', () => {
  const page = renderStoryReviewPage({ ...changeCase, state: 'DESIGN_REVIEW' }, governance, options)
  assert.match(page, /Story contract approved/)
  assert.match(page, /Prioritize approved stories/)
  assert.match(page, /Open design review/)
  assert.doesNotMatch(page, /id="story-decision-form"/)
})

test('story review escapes retained values and script configuration', () => {
  const page = renderStoryReviewPage(
    { ...changeCase, title: '<img src=x onerror=alert(1)>' },
    { stories: { storyDigest: '</script><script>alert(1)</script>', stories: [{ ...governance.stories.stories[0], title: '<script>alert(1)</script>' }] } },
    { ...options, decisionEndpoint: '</script><script>alert(1)</script>' }
  )
  assert.doesNotMatch(page, /<img src=x onerror=alert\(1\)>/)
  assert.doesNotMatch(page, /<script>alert\(1\)<\/script>/)
  assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(page, /\\u003c\/script>\\u003cscript>alert\(1\)\\u003c\/script>/)
})
