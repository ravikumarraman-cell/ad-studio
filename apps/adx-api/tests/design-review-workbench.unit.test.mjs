import assert from 'node:assert/strict'
import test from 'node:test'
import { renderDesignReviewPage } from '../design-review-workbench.mjs'

const changeCase = { title: 'Consent referral', state: 'DESIGN_REVIEW', riskTier: 'R3', projectionVersion: 6 }
const view = { design: { revision: 1, designDigest: 'sha256:design', authoredBy: 'author', artifacts: { architectureDecision: { decision: 'Use a consent boundary.' }, interfaceDelta: {}, migrationPlan: {}, threatModel: { threats: [{ name: 'Unauthorized access' }] }, dependencies: [], testStrategy: { layers: ['unit'] } } }, exceptions: [], approvals: [] }

test('design review offers release planning before its Gate C decision', () => {
  const page = renderDesignReviewPage(changeCase, view, { canReview: true, canWrite: true, isDesignAuthor: false, decisionEndpoint: '/design-decision', designCaptureUrl: '/design-workbench', releasePlanningUrl: '/story-release-planning' })
  assert.match(page, /Set the story delivery order/)
  assert.match(page, /Plan story release order/)
  assert.match(page, /story-release-planning/)
  assert.ok(page.indexOf('Plan story release order') < page.indexOf('Record the outcome'))
})