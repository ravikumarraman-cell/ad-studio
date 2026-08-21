import assert from 'node:assert/strict'
import test from 'node:test'
import { renderExecutionHandoffPage } from '../execution-handoff-page.mjs'

const changeCase = { title: 'Referral decision communication', state: 'READY_FOR_EXECUTION', projectionVersion: 12 }
const options = { canSubmit: true, signedInRoles: ['workspace_admin'], transitionsEndpoint: '/transitions', evidenceReviewUrl: '/evidence-review' }

test('execution handoff requires a candidate-readiness attestation before the versioned transition', () => {
  const page = renderExecutionHandoffPage(changeCase, options)
  assert.match(page, /Submit the prepared candidate/)
  assert.match(page, /configured candidate is complete and ready/)
  assert.match(page, /toState:'AWAITING_VERIFICATION'/)
  assert.match(page, /expectedVersion:config.expectedVersion/)
  assert.match(page, /id="submit" disabled/)
})

test('execution handoff does not expose submission controls outside execution readiness', () => {
  const page = renderExecutionHandoffPage({ ...changeCase, state: 'AWAITING_VERIFICATION' }, options)
  assert.match(page, /Handoff is not available/)
  assert.doesNotMatch(page, /id="attestation"/)
})

test('execution handoff names the current role and the contributor-capable roles when submission is denied', () => {
  const page = renderExecutionHandoffPage(changeCase, { ...options, canSubmit: false, signedInRoles: ['reviewer'] })
  assert.match(page, /Your current workspace role: <strong>reviewer<\/strong>/)
  assert.match(page, /contributor<\/strong> or <strong>workspace_admin/)
  assert.match(page, /reviewer<\/strong> role remains read-and-review only/)
})