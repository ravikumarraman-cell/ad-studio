import assert from 'node:assert/strict'
import test from 'node:test'
import { renderVerificationReviewPage } from '../verification-review-page.mjs'

const changeCase = { title: 'Verify generated candidate', state: 'AWAITING_VERIFICATION', projectionVersion: 8 }
const options = { canRun: true, canReview: false, handoffUrl: '/execution-handoff', runEndpoint: '/verification-run', decisionEndpoint: '/verification-decision', verifierConfigured: true }

test('verification page reports elapsed time while the governed verifier request is active', () => {
  const page = renderVerificationReviewPage(changeCase, [], { ...options, candidateUrl: '/generated-candidate' })
  assert.match(page, /Run independent verification/)
  assert.match(page, /Review, then collect fresh evidence/)
  assert.match(page, /review generated code/)
  assert.match(page, /href="\/generated-candidate"/)
  assert.match(page, /Starting independent verification/)
  assert.match(page, /Independent verification running/)
  assert.match(page, /run-status/)
  assert.match(page, /'idempotency-key':crypto\.randomUUID\(\)/)
  assert.match(page, /id="run-verifier" class="button primary" type="button"><span class="busy-indicator" aria-hidden="true"><\/span>/)
  assert.match(page, /aria-busy="false"/)
  assert.match(page, /@media \(prefers-reduced-motion:reduce\)/)
  assert.match(page, /status\.setAttribute\("aria-busy","true"\)/)
})

test('verification page does not offer a run outside the awaiting-verification state', () => {
  const page = renderVerificationReviewPage({ ...changeCase, state: 'READY_FOR_EXECUTION' }, [], options)
  assert.match(page, /Submit a candidate before verification/)
  assert.doesNotMatch(page, /id="run-verifier"/)
})

test('verification page identifies an empty server candidate before a run is submitted', () => {
  const page = renderVerificationReviewPage(changeCase, [], { ...options, verifierConfigured: false, verifierIssue: 'VERIFIER_CANDIDATE_EMPTY' })
  assert.match(page, /Independent verification is not ready/)
  assert.match(page, /VERIFIER_CANDIDATE_EMPTY/)
  assert.doesNotMatch(page, /id="run-verifier"/)
})

test('verification page links a passing candidate to manual preview without treating it as gate completion', () => {
  const page = renderVerificationReviewPage(changeCase, [{ status: 'PASS', candidateDigest: 'sha256:verified', evidenceDigest: 'sha256:evidence', verifierId: 'local', verifierVersion: '1', runtimeImageDigest: 'sha256:runtime' }], { ...options, previewUrl: '/application-preview' })
  assert.match(page, /Open manual preview/)
  assert.match(page, /\/application-preview/)
  assert.match(page, /Manual preview is optional and does not complete Gate D/)
})

test('verification page explains the recovery path for retained failures', () => {
  const page = renderVerificationReviewPage(changeCase, [{ status: 'FAIL', candidateDigest: 'sha256:failed', evidenceDigest: 'sha256:evidence', verifierId: 'local', verifierVersion: '1', runtimeImageDigest: 'sha256:runtime' }], options)
  assert.match(page, /Verification needs a fresh candidate/)
  assert.match(page, /correct the candidate outside this review/)
  assert.match(page, /Run independent verification/)
  assert.doesNotMatch(page, /Complete Gate D/)
})
