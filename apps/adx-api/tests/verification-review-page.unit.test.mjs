import assert from 'node:assert/strict'
import test from 'node:test'
import { renderVerificationReviewPage } from '../verification-review-page.mjs'

const changeCase = { title: 'Verify generated candidate', state: 'AWAITING_VERIFICATION', projectionVersion: 8 }
const options = { canRun: true, canReview: false, handoffUrl: '/execution-handoff', runEndpoint: '/verification-run', decisionEndpoint: '/verification-decision', verifierConfigured: true }

test('verification page reports elapsed time while the governed verifier request is active', () => {
  const page = renderVerificationReviewPage(changeCase, [], options)
  assert.match(page, /Run independent verification/)
  assert.match(page, /Starting independent verification/)
  assert.match(page, /Independent verification running/)
  assert.match(page, /run-status/)
})

test('verification page does not offer a run outside the awaiting-verification state', () => {
  const page = renderVerificationReviewPage({ ...changeCase, state: 'READY_FOR_EXECUTION' }, [], options)
  assert.match(page, /Submit a prepared candidate first/)
  assert.doesNotMatch(page, /onclick="const status=document.getElementById\('run-status'\)/)
})

test('verification page identifies an empty server candidate before a run is submitted', () => {
  const page = renderVerificationReviewPage(changeCase, [], { ...options, verifierConfigured: false, verifierIssue: 'VERIFIER_CANDIDATE_EMPTY' })
  assert.match(page, /Independent verification is not ready/)
  assert.match(page, /VERIFIER_CANDIDATE_EMPTY/)
  assert.doesNotMatch(page, /id="run-verifier"/)
})
