import assert from 'node:assert/strict'
import test from 'node:test'
import { adxPageThemeCss } from '../adx-page-theme.mjs'
import { renderDesignReviewPage } from '../design-review-workbench.mjs'

const changeCase = { title: 'Consent referral', state: 'DESIGN_REVIEW', riskTier: 'R3', projectionVersion: 6 }
const view = { design: { revision: 1, designDigest: 'sha256:design', authoredBy: 'author', artifacts: { architectureDecision: { decision: 'Use a consent boundary.' }, interfaceDelta: {}, migrationPlan: {}, threatModel: { threats: [{ name: 'Unauthorized access' }] }, dependencies: [], testStrategy: { layers: ['unit'] } } }, exceptions: [], approvals: [] }

test('design review offers release planning before its Gate C decision', () => {
  const page = renderDesignReviewPage(changeCase, view, { canReview: true, canWrite: true, isDesignAuthor: false, decisionEndpoint: '/design-decision', designCaptureUrl: '/design-workbench', releasePlanningUrl: '/story-release-planning' })
  assert.match(page, /Prioritize approved stories/)
  assert.match(page, /Prioritize stories/)
  assert.match(page, /story-release-planning/)
  assert.ok(page.indexOf('Prioritize stories') < page.indexOf('Record the outcome'))
})

test('design-review decision options keep radios and copy inside the action rail', () => {
  const page = renderDesignReviewPage(changeCase, view, { canReview: true, canWrite: true, isDesignAuthor: false, decisionEndpoint: '/design-decision', designCaptureUrl: '/design-workbench', releasePlanningUrl: '/story-release-planning' })
  assert.match(adxPageThemeCss, /input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)/)
  assert.match(adxPageThemeCss, /input\[type="radio"\][\s\S]*?width:auto/)
  assert.match(page, /fieldset\{min-inline-size:0/)
  assert.match(page, /\.decision-choices label>span\{display:block;min-width:0;flex:1\}/)
  assert.match(page, /\.decision-choices input\{width:auto;min-width:0;flex:0 0 auto/)
  assert.match(page, /id="adx-layout-offsets"/)
  assert.match(page, /\.review-grid\{padding:clamp\(18px,2\.2vw,28px\)/)
})

test('design review wraps a long reviewer principal inside the approval rail', () => {
  const principal = 'oidc:https://login.microsoftonline.com/tenant-id/v2.0:very-long-reviewer-subject-without-any-natural-breaks'
  const page = renderDesignReviewPage(changeCase, { ...view, approvals: [{ decision: 'APPROVED', status: 'ACTIVE', designDigest: 'sha256:design', rationale: 'Verified.', reviewedBy: principal }] }, { canReview: true, canWrite: true, isDesignAuthor: false, decisionEndpoint: '/design-decision', designCaptureUrl: '/design-workbench', releasePlanningUrl: '/story-release-planning' })
  assert.match(page, /class="decision-provenance">Recorded by <code>oidc:/)
  assert.match(page, /\.decision-provenance\{display:block;margin-top:14px;overflow-wrap:anywhere;word-break:break-word\}/)
})
