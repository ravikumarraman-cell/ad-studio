import assert from 'node:assert/strict'
import test from 'node:test'
import { createPublicGitHubMilestoneClient } from '../github-public-milestones.mjs'

function response(body) { return { ok: true, status: 200, json: async () => body } }

test('public GitHub milestone creates one retained feature per issue while pull requests are excluded', async () => {
  const calls = []
  const client = createPublicGitHubMilestoneClient({ fetchImpl: async (url) => {
    calls.push(url)
    if (url.includes('/milestones?')) return response([{ number: 12, title: 'Referral reliability', description: 'Improve referral follow-through.', open_issues: 2, closed_issues: 1, due_on: null, html_url: 'https://github.com/acme/care/milestone/12' }])
    return response([{ number: 101, title: 'Show referral status', body: 'Expose the latest status.', labels: [{ name: 'member' }], html_url: 'https://github.com/acme/care/issues/101' }, { number: 102, title: 'Notify care coordinator', body: 'Send the coordination alert.', labels: [{ name: 'operations' }], html_url: 'https://github.com/acme/care/issues/102' }, { number: 103, title: 'Closed issue', state: 'closed', body: 'Ignore me' }, { number: 104, title: 'Implementation pull request', pull_request: {}, body: 'Ignore me' }])
  } })
  const features = await client.featuresFromMilestone({ owner: 'acme', repository: 'care', milestone: 12, featureOwner: 'Care Operations', targetRepository: 'care-portal', riskTier: 'R3' })
  assert.equal(features.length, 2)
  assert.equal(features[0].title, 'Show referral status')
  assert.equal(features[0].featureId, 'github-acme-care-issue-101')
  assert.equal(features[1].featureId, 'github-acme-care-issue-102')
  assert.match(features[0].acceptanceCriteria, /Milestone context: Referral reliability/)
  assert.doesNotMatch(features[0].raw, /Implementation pull request/)
  assert.doesNotMatch(JSON.stringify(features), /Closed issue/)
  assert.equal(calls.length, 2)
  assert.match(calls[1], /\/issues\?state=open&milestone=12/)
})

test('public GitHub client rejects invalid repository input without a request', async () => {
  const client = createPublicGitHubMilestoneClient({ fetchImpl: async () => { throw new Error('should not request') } })
  await assert.rejects(() => client.listMilestones({ owner: 'bad/owner', repository: 'care' }), { message: /owner/ })
})