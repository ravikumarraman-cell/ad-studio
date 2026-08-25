import assert from 'node:assert/strict'
import test from 'node:test'
import { renderExecutionHandoffPage } from '../execution-handoff-page.mjs'

const changeCase = { title: 'Referral decision communication', state: 'READY_FOR_EXECUTION', projectionVersion: 12 }
const options = { canSubmit: true, signedInRoles: ['workspace_admin'], dispatchEndpoint: '/execution/dispatch', statusEndpoint: '/execution', evidenceReviewUrl: '/evidence-review', candidateUrl: '/generated-candidate', providers: [{ id: 'LOCAL_TEST', label: 'Local test provider', description: 'A registered provider.', enabled: true }] }

test('execution handoff requests a bounded implementation run instead of attesting to an external candidate', () => {
  const page = renderExecutionHandoffPage(changeCase, options)
  assert.match(page, /Request implementation/)
  assert.match(page, /signed lease/)
  assert.match(page, /Select a configured implementation runner/)
  assert.match(page, /Story decomposition models are configured separately/)
  assert.match(page, /dispatchEndpoint/)
  assert.match(page, /statusEndpoint/)
  assert.match(page, /Implementation activity/)
  assert.match(page, /LIVE BOUNDED RUN/)
  assert.match(page, /Lease issued/)
  assert.match(page, /Sandbox working/)
  assert.match(page, /Ready for verification/)
  assert.match(page, /Events appear only after they are durably recorded/)
  assert.match(page, /progress-events/)
  assert.match(page, /failure-details/)
  assert.match(page, /Diagnostic code/)
  assert.match(page, /The bounded runner reached its time limit/)
  assert.match(page, /provider is rate limited/)
  assert.match(page, /View generated candidate/)
  assert.match(page, /candidateUrl/)
  assert.match(page, /LOCAL_TEST/)
  assert.doesNotMatch(page, /toState.*AWAITING_VERIFICATION/)
  assert.doesNotMatch(page, /prepared candidate/)
  assert.match(page, /id="submit" disabled/)
})

test('execution handoff does not expose submission controls outside execution readiness', () => {
  const page = renderExecutionHandoffPage({ ...changeCase, state: 'AWAITING_VERIFICATION' }, options)
  assert.match(page, /Implementation is not available/)
  assert.doesNotMatch(page, /id="attestation"/)
})

test('execution handoff names the current role and the contributor-capable roles when submission is denied', () => {
  const page = renderExecutionHandoffPage(changeCase, { ...options, canSubmit: false, signedInRoles: ['reviewer'] })
  assert.match(page, /Your current workspace role: <strong>reviewer<\/strong>/)
  assert.match(page, /contributor<\/strong> or <strong>workspace_admin/)
  assert.match(page, /reviewer<\/strong> role remains read-and-review only/)
})

test('execution handoff sends only a reviewed coding specification ID with dispatch', () => {
  const page = renderExecutionHandoffPage(changeCase, { ...options, templates: [{ id: 'evidence-first-feature', label: 'Evidence-first feature', description: 'Bounded feature delivery.' }] })
  assert.match(page, /Implementation specification/)
  assert.match(page, /coding-spec-template/)
  assert.match(page, /evidence-first-feature/)
  assert.match(page, /templateId/)
  assert.match(page, /cannot expand the lease scope/)
})