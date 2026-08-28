import assert from 'node:assert/strict'
import test from 'node:test'
import { createPrivateGitHubMilestoneClient } from '../github-private-milestones.mjs'

function response(body) { return { ok: true, status: 200, json: async () => body } }

test('private GitHub milestone reads use only the server credential and exclude pull requests', async () => {
  const calls = []
  const client = createPrivateGitHubMilestoneClient({ token: 'server-only-token', fetchImpl: async (url, init) => {
    calls.push({ url, init })
    if (url.includes('/milestones?')) return response([{ number: 1, title: 'Care Day Essentials', description: '', open_issues: 2, closed_issues: 0, due_on: null, html_url: 'https://github.com/acme/health-x/milestone/1' }])
    return response([{ number: 10, title: 'Add medication reminder', body: 'Give people a local reminder.', labels: [{ name: 'health-x' }], html_url: 'https://github.com/acme/health-x/issues/10' }, { number: 11, title: 'Closed issue', state: 'closed' }, { number: 12, title: 'Pull request', pull_request: {} }])
  } })

  const features = await client.featuresFromMilestone({ owner: 'acme', repository: 'health-x', milestone: 1, featureOwner: 'Product Operations', targetRepository: 'health-x', riskTier: 'R2' })

  assert.equal(features.length, 1)
  assert.doesNotMatch(JSON.stringify(features), /Closed issue/)
  assert.match(features[0].raw, /github-private-milestone-issue-v1/)
  assert.equal(calls.length, 2)
  assert.match(calls[1].url, /\/issues\?state=open&milestone=1/)
  assert.equal(calls[0].init.headers.authorization, 'Bearer server-only-token')
  assert.equal(calls[0].init.body, undefined)
})

test('private GitHub client requires a configured server credential', () => {
  assert.throws(() => createPrivateGitHubMilestoneClient(), /GITHUB_PRIVATE_READ_TOKEN_REQUIRED/)
})