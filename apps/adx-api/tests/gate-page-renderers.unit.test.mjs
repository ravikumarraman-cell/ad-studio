import assert from 'node:assert/strict'
import test from 'node:test'
import { intakeGatePage } from '../intake-gate-page.mjs'
import { outcomeReviewPage } from '../outcome-review-page.mjs'
import { storyWorkshopPageWithModelSelector } from '../story-workshop-page.mjs'

const changeCase = {
  title: 'Improve care plan reminders',
  state: 'INTAKE',
  riskTier: 'MODERATE',
  projectionVersion: 7,
}

test('Gate A renders the authorized intake classification action', () => {
  const page = intakeGatePage(
    changeCase,
    { intent: { outcome: 'Reliable reminders', owner: 'Care operations', acceptanceCriteria: 'A member can confirm a reminder.' } },
    { canWrite: true, classifyEndpoint: '/classify', storyWorkshopUrl: '/stories' },
  )

  assert.match(page, /GATE A · DEFINE THE WORK/)
  assert.match(page, /Confirm intake, then continue to stories/)
  assert.match(page, /id="classify"/)
  assert.match(page, /"classifyEndpoint":"\/classify"/)
})

test('Gate A exposes the next story action only after risk classification', () => {
  const page = intakeGatePage(
    { ...changeCase, state: 'RISK_REVIEW' },
    { intent: {} },
    { canWrite: false, classifyEndpoint: '/classify', storyWorkshopUrl: '/stories' },
  )

  assert.match(page, /Risk classification is complete/)
  assert.match(page, /Continue to Generate & curate stories/)
  assert.doesNotMatch(page, /id="classify"/)
})

test('Gate A.5 renders the authoring surface only for an authorized ready case', () => {
  const page = storyWorkshopPageWithModelSelector(
    { ...changeCase, state: 'RISK_REVIEW' },
    {},
    {
      canAuthor: true,
      storiesEndpoint: '/stories',
      storySuggestionsEndpoint: '/story-suggestions',
      storyReviewUrl: '/story-review',
      homeUrl: '/',
      aiStatus: { configured: false, provider: 'local', model: 'none' },
    },
  )

  assert.match(page, /Shape a reviewable story set/)
  assert.match(page, /Suggestions are unavailable/)
  assert.match(page, /story-workshop-form/)
  assert.match(page, /Back to ADX home/)
  assert.equal((page.match(/<script>/g) ?? []).length, 1)
})

test('Gate A.5 keeps unavailable authoring read-only and escapes retained titles', () => {
  const page = storyWorkshopPageWithModelSelector(
    { ...changeCase, state: 'INTAKE', title: '<script>alert(1)</script>' },
    {},
    {
      canAuthor: false,
      storiesEndpoint: '/stories',
      storySuggestionsEndpoint: '/story-suggestions',
      storyReviewUrl: '/story-review',
      homeUrl: '/',
      aiStatus: { configured: false, provider: 'local', model: 'none' },
    },
  )

  assert.match(page, /Story shaping opens after risk classification/)
  assert.doesNotMatch(page, /<form id="story-workshop-form">/)
  assert.doesNotMatch(page, /<script>alert\(1\)<\/script>/)
  assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
})

test('Gate A.5 renders response-derived applied-spec evidence and select-all controls', () => {
  const page = storyWorkshopPageWithModelSelector(
    { ...changeCase, state: 'RISK_REVIEW' },
    {},
    {
      canAuthor: true,
      storiesEndpoint: '/stories',
      storySuggestionsEndpoint: '/story-suggestions',
      storyReviewUrl: '/story-review',
      homeUrl: '/',
      aiStatus: {
        configured: true,
        provider: 'local',
        providerLabel: 'Local',
        model: 'reviewed-model',
        models: ['reviewed-model'],
        templates: [],
      },
    },
  )

  assert.match(page, /id="applied-spec"[^>]*role="status"[^>]*aria-live="polite"/)
  assert.match(page, /id="select-all-stories" type="checkbox"/)
  assert.match(page, /body:JSON\.stringify\(\{model:document\.getElementById\('story-ai-model'\)\.value,templateId:document\.getElementById\('story-spec-template'\)\.value\}\)/)
  assert.match(page, /const receiptTemplate=body\.receipt\?\.template/)
  assert.match(page, /marker\.textContent=receiptTemplate\?'Applied specification: '/)
  assert.match(page, /Retained context only was used\./)
  assert.match(page, /selectAll\.onchange=/)
  assert.equal((page.match(/<script>/g) ?? []).length, 1)
})

test('Gate F totals retained outcomes and preserves escaped history', () => {
  const page = outcomeReviewPage(
    { ...changeCase, state: 'OUTCOME_RECORDED' },
    [
      { outcome: 'SUCCESS', taxonomy: 'ADOPTION', releaseCandidateId: 'candidate-1', outcomeDigest: 'sha256:success' },
      { outcome: 'FAILURE', taxonomy: '<script>alert(1)</script>', releaseCandidateId: 'candidate-2', outcomeDigest: 'sha256:failure' },
    ],
  )

  assert.match(page, /Success: 1/)
  assert.match(page, /Failure: 1/)
  assert.match(page, /Review the retained outcome and compare it with the frozen evaluation baseline/)
  assert.doesNotMatch(page, /<script>alert\(1\)<\/script>/)
  assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
})

test('Gate F exposes a visible completion path for delivery-ready cases', () => {
  const page = outcomeReviewPage(
    { ...changeCase, state: 'READY_FOR_DELIVERY' },
    [
      { outcome: 'SUCCESS', taxonomy: 'ADOPTION', releaseCandidateId: 'candidate-1', outcomeDigest: 'sha256:success' },
      { outcome: 'FAILURE', taxonomy: 'ROLLBACK', releaseCandidateId: 'candidate-2', outcomeDigest: 'sha256:failure' },
    ],
    {
      canComplete: true,
      completionEndpoint: '/outcome-completion',
      expectedVersion: 7,
    },
  )

  assert.match(page, /Complete Gate F/)
  assert.match(page, /outcome-completion/)
  assert.match(page, /id="outcome-digest"/)
  assert.match(page, /Recording Gate F outcome/)
})

test('Gate F explains the upstream action when no outcome has been retained', () => {
  const page = outcomeReviewPage(
    { ...changeCase, state: 'READY_FOR_DELIVERY' },
    [],
    { canComplete: true, deliveryReviewUrl: '/delivery-review' },
  )
  assert.match(page, /Nothing to record yet/)
  assert.match(page, /Finish Gate E/)
  assert.match(page, /Open Gate E/)
  assert.match(page, /outcome service retain the result/)
  assert.doesNotMatch(page, /id="complete-gate-f"/)
})
