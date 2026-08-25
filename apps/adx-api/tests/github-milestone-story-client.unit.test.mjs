import assert from 'node:assert/strict'
import test from 'node:test'
import { createGitHubMilestoneStoryClient } from '../github-milestone-story-client.mjs'

test('milestone story publisher creates a server-authenticated GitHub issue assigned to the selected milestone', async () => {
  let request
  const client = createGitHubMilestoneStoryClient({ token: 'test-token', fetchImpl: async (url, init) => { request = { url, init }; return { ok: true, status: 201, json: async () => ({ number: 42, html_url: 'https://github.com/acme/care/issues/42', node_id: 'I_42' }) } } })
  const issue = await client.createIssue({ owner: 'acme', repository: 'care', milestoneNumber: 7, title: 'View referral status', body: 'Retained story contract.' })
  assert.equal(issue.number, 42)
  assert.match(request.url, /repos\/acme\/care\/issues$/)
  assert.equal(JSON.parse(request.init.body).milestone, 7)
  assert.equal(request.init.headers.authorization, 'Bearer test-token')
})

test('milestone story publisher rejects invalid repository input before making a request', async () => {
  const client = createGitHubMilestoneStoryClient({ token: 'test-token', fetchImpl: async () => { throw new Error('must not request') } })
  await assert.rejects(() => client.createIssue({ owner: 'bad/owner', repository: 'care', milestoneNumber: 7, title: 'Story', body: 'Contract' }), { code: 'GITHUB_MILESTONE_REPOSITORY_INVALID' })
})