import { ChangeCaseError } from './change-case-ledger.mjs'

const apiOrigin = 'https://api.github.com'
const repositoryPattern = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,98}[A-Za-z0-9])?$/
const maxIssueCount = 100
const maxIssueBodyLength = 4_000

function repositoryPart(value, label) {
  if (typeof value !== 'string' || !repositoryPattern.test(value)) throw new ChangeCaseError('GITHUB_PUBLIC_REPOSITORY_INVALID', `A valid public GitHub ${label} is required.`, { retryable: false, severity: 'warning' })
  return value
}

function milestoneNumber(value) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1 || number > 2_147_483_647) throw new ChangeCaseError('GITHUB_PUBLIC_MILESTONE_INVALID', 'A valid GitHub milestone number is required.', { retryable: false, severity: 'warning' })
  return number
}

function githubUrl(owner, repository, path) {
  return `${apiOrigin}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}${path}`
}

async function githubJson(fetchImpl, url) {
  let response
  try { response = await fetchImpl(url, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'adx-public-milestone-import' } }) } catch { throw new ChangeCaseError('GITHUB_PUBLIC_UNAVAILABLE', 'GitHub could not be reached. Try again shortly.', { retryable: true, severity: 'warning' }) }
  const payload = await response.json().catch(() => null)
  if (response.ok) return payload
  if (response.status === 404) throw new ChangeCaseError('GITHUB_PUBLIC_NOT_FOUND', 'The public repository or milestone was not found.', { retryable: false, severity: 'warning' })
  if (response.status === 403 || response.status === 429) throw new ChangeCaseError('GITHUB_PUBLIC_RATE_LIMITED', 'GitHub temporarily limited public requests. Try again later.', { retryable: true, severity: 'warning' })
  throw new ChangeCaseError('GITHUB_PUBLIC_REQUEST_FAILED', 'GitHub could not provide this public milestone.', { retryable: response.status >= 500, severity: 'warning', details: { providerStatus: response.status } })
}

function publicMilestone(value) {
  return Object.freeze({ number: value.number, title: value.title, description: value.description ?? '', openIssues: value.open_issues, closedIssues: value.closed_issues, dueOn: value.due_on, htmlUrl: value.html_url })
}

function publicIssue(value) {
  return Object.freeze({ number: value.number, title: value.title, body: String(value.body ?? '').slice(0, maxIssueBodyLength), labels: (value.labels ?? []).map((label) => typeof label === 'string' ? label : label?.name).filter(Boolean), htmlUrl: value.html_url })
}

function issueFeature({ owner, repository, milestone, issue, featureOwner, targetRepository, riskTier }) {
  const sourceUrl = issue.htmlUrl || `https://github.com/${owner}/${repository}/issues/${issue.number}`
  const raw = JSON.stringify({ source: 'github-public-milestone-issue-v1', repository: `${owner}/${repository}`, milestone: publicMilestone(milestone), issue })
  const labels = issue.labels.length ? ` Labels: ${issue.labels.join(', ')}.` : ''
  return Object.freeze({ featureId: `github-${owner}-${repository}-issue-${issue.number}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 120), title: issue.title, description: issue.body.trim() || `Deliver GitHub issue #${issue.number} from milestone: ${milestone.title}.`, owner: featureOwner, targetRepository, acceptanceCriteria: `Complete GitHub issue #${issue.number}: ${issue.title}.${labels} Milestone context: ${milestone.title}.`, riskTier, sourceUrl, raw })
}

export function createPublicGitHubMilestoneClient({ fetchImpl = globalThis.fetch } = {}) {
  return Object.freeze({
    async listMilestones({ owner, repository }) {
      const safeOwner = repositoryPart(owner, 'owner')
      const safeRepository = repositoryPart(repository, 'repository')
      const milestones = await githubJson(fetchImpl, githubUrl(safeOwner, safeRepository, '/milestones?state=open&per_page=100'))
      if (!Array.isArray(milestones)) throw new ChangeCaseError('GITHUB_PUBLIC_RESPONSE_INVALID', 'GitHub returned an invalid milestone list.', { retryable: true, severity: 'warning' })
      return Object.freeze(milestones.map(publicMilestone))
    },
    async featuresFromMilestone({ owner, repository, milestone: requestedMilestone, featureOwner, targetRepository, riskTier = 'R2' }) {
      const safeOwner = repositoryPart(owner, 'owner')
      const safeRepository = repositoryPart(repository, 'repository')
      const number = milestoneNumber(requestedMilestone)
      if (typeof featureOwner !== 'string' || !featureOwner.trim() || typeof targetRepository !== 'string' || !targetRepository.trim()) throw new ChangeCaseError('GITHUB_PUBLIC_FEATURE_CONTEXT_REQUIRED', 'Feature owner and target repository are required before importing a milestone.', { retryable: false, severity: 'warning' })
      if (!['R0', 'R1', 'R2', 'R3', 'R4'].includes(riskTier)) throw new ChangeCaseError('GITHUB_PUBLIC_RISK_INVALID', 'Choose a valid initial risk tier.', { retryable: false, severity: 'warning' })
      const milestones = await githubJson(fetchImpl, githubUrl(safeOwner, safeRepository, '/milestones?state=all&per_page=100'))
      const milestone = Array.isArray(milestones) ? milestones.find((item) => item?.number === number) : null
      if (!milestone) throw new ChangeCaseError('GITHUB_PUBLIC_NOT_FOUND', 'The selected public GitHub milestone was not found.', { retryable: false, severity: 'warning' })
      const issues = await githubJson(fetchImpl, githubUrl(safeOwner, safeRepository, `/issues?state=all&milestone=${number}&per_page=${maxIssueCount}`))
      if (!Array.isArray(issues)) throw new ChangeCaseError('GITHUB_PUBLIC_RESPONSE_INVALID', 'GitHub returned invalid milestone issues.', { retryable: true, severity: 'warning' })
      const selectedIssues = issues.filter((issue) => !issue.pull_request).slice(0, maxIssueCount).map(publicIssue)
      if (!selectedIssues.length) throw new ChangeCaseError('GITHUB_PUBLIC_MILESTONE_EMPTY', 'The selected milestone has no non-pull-request issues to import.', { retryable: false, severity: 'warning' })
      const context = { owner: safeOwner, repository: safeRepository, milestone, featureOwner: featureOwner.trim(), targetRepository: targetRepository.trim(), riskTier }
      return Object.freeze(selectedIssues.map((issue) => issueFeature({ ...context, issue })))
    }
  })
}