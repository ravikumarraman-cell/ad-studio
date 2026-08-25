import { ChangeCaseError } from './change-case-ledger.mjs'

const apiOrigin = 'https://api.github.com'
const repositoryPart = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,98}[A-Za-z0-9])?$/

function requiredPart(value, label) {
  if (typeof value !== 'string' || !repositoryPart.test(value)) throw new ChangeCaseError('GITHUB_MILESTONE_REPOSITORY_INVALID', `A valid GitHub ${label} is required.`, { retryable: false, severity: 'warning' })
  return value
}

function requiredMilestone(value) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) throw new ChangeCaseError('GITHUB_MILESTONE_INVALID', 'A valid GitHub milestone number is required.', { retryable: false, severity: 'warning' })
  return number
}

export function createGitHubMilestoneStoryClient({ token, fetchImpl = globalThis.fetch } = {}) {
  if (typeof token !== 'string' || !token.trim()) throw new Error('GITHUB_MILESTONE_TOKEN_REQUIRED')
  return Object.freeze({
    async listMilestones({ owner, repository }) {
      const safeOwner = requiredPart(owner, 'owner'); const safeRepository = requiredPart(repository, 'repository')
      const response = await request(fetchImpl, token, safeOwner, safeRepository, '/milestones?state=open&per_page=100')
      if (!Array.isArray(response)) throw new ChangeCaseError('GITHUB_MILESTONE_RESPONSE_INVALID', 'GitHub returned an invalid milestone list.', { retryable: true, severity: 'warning' })
      return Object.freeze(response.map((milestone) => Object.freeze({ number: milestone.number, title: milestone.title, description: milestone.description ?? '', dueOn: milestone.due_on ?? null, openIssues: milestone.open_issues ?? 0 })))
    },
    async createIssue({ owner, repository, milestoneNumber, title, body }) {
      const safeOwner = requiredPart(owner, 'owner'); const safeRepository = requiredPart(repository, 'repository'); const milestone = requiredMilestone(milestoneNumber)
      if (typeof title !== 'string' || !title.trim() || typeof body !== 'string' || !body.trim()) throw new ChangeCaseError('GITHUB_MILESTONE_STORY_INVALID', 'A title and retained story body are required.', { retryable: false, severity: 'warning' })
      const response = await request(fetchImpl, token, safeOwner, safeRepository, '/issues', { method: 'POST', body: { title: title.trim(), body: body.trim(), milestone } })
      if (!Number.isInteger(response?.number) || typeof response.html_url !== 'string') throw new ChangeCaseError('GITHUB_MILESTONE_RESPONSE_INVALID', 'GitHub returned an invalid milestone issue response.', { retryable: true, severity: 'warning' })
      return Object.freeze({ number: response.number, url: response.html_url, nodeId: response.node_id ?? null })
    }
  })
}

async function request(fetchImpl, token, owner, repository, path, { method = 'GET', body } = {}) {
  let response
  try { response = await fetchImpl(`${apiOrigin}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}${path}`, { method, headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'user-agent': 'adx-story-milestone-publisher', ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }) } catch { throw new ChangeCaseError('GITHUB_MILESTONE_UNAVAILABLE', 'GitHub could not be reached. Try again shortly.', { retryable: true, severity: 'warning' }) }
  const payload = await response.json().catch(() => null)
  if (response.ok) return payload
  if (response.status === 401 || response.status === 403) throw new ChangeCaseError('GITHUB_MILESTONE_FORBIDDEN', 'The server GitHub credential cannot create a milestone issue.', { retryable: false, severity: 'warning' })
  if (response.status === 404 || response.status === 422) throw new ChangeCaseError('GITHUB_MILESTONE_REJECTED', 'GitHub rejected the selected repository, milestone, or story issue.', { retryable: false, severity: 'warning' })
  throw new ChangeCaseError('GITHUB_MILESTONE_REQUEST_FAILED', 'GitHub could not create the milestone issue.', { retryable: response.status >= 500 || response.status === 429, severity: 'warning', details: { providerStatus: response.status } })
}