import assert from 'node:assert/strict'
import test from 'node:test'
import { renderDeliveryReviewPage } from '../delivery-review-page.mjs'

const changeCase = { title: 'Care day workspace', state: 'READY_FOR_DELIVERY' }
const options = { canReview: true, canPrepare: true, prepareEndpoint: '/delivery-preview-prepare', decisionEndpoint: '/delivery-decision', outcomeReviewUrl: '/outcome-review' }

test('delivery review guides a provider setup when no preview plan exists', () => {
  const page = renderDeliveryReviewPage(changeCase, [], null, options)
  assert.match(page, /No preview plan has been retained/)
  assert.match(page, /Commit-bound checklist/)
  assert.match(page, /Prepare preview plan/)
  assert.doesNotMatch(page, /Approve this preview delivery/)
})

test('delivery review enables a decision only after matching CI evidence and no error findings', () => {
  const plan = { id: 'plan-1', branch: 'adx/preview/case-1', commitDigest: 'sha256:commit', candidateDigest: 'sha256:candidate', evidenceDigest: 'sha256:evidence' }
  const review = { ciRuns: [{ providerId: 'ci', status: 'PASSED', commitDigest: 'sha256:commit' }], findings: [], approvals: [] }
  const page = renderDeliveryReviewPage(changeCase, [plan], review, options)
  assert.match(page, /Approve this preview delivery/)
  assert.match(page, /delivery-decision/)
  assert.match(page, /sha256:commit/)
})

test('delivery review gives a bounded recovery path for missing CI and blocking findings', () => {
  const plan = { id: 'plan-1', branch: 'adx/preview/case-1', commitDigest: 'sha256:commit', candidateDigest: 'sha256:candidate', evidenceDigest: 'sha256:evidence' }
  const page = renderDeliveryReviewPage(changeCase, [plan], { ciRuns: [], findings: [{ finding: { severity: 'ERROR', message: 'Missing authorization test' } }], approvals: [] }, options)
  assert.match(page, /Refresh the preview evidence/)
  assert.match(page, /Correct the source change for the error-level findings/)
  assert.match(page, /cannot mark findings resolved or manufacture CI evidence/)
  assert.doesNotMatch(page, /Approve this preview delivery/)
})

test('delivery review offers a new server-owned plan when an unexecuted plan must be refreshed', () => {
  const plan = { id: 'plan-1', branch: 'adx/preview/case-1', commitDigest: 'sha256:commit', candidateDigest: 'sha256:candidate', evidenceDigest: 'sha256:evidence' }
  const page = renderDeliveryReviewPage(changeCase, [plan], { ciRuns: [], findings: [], approvals: [] }, options)
  assert.match(page, /Rebuild preview plan/)
  assert.match(page, /delivery-preview-prepare/)
})
