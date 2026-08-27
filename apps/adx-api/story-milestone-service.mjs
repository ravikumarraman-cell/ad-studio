import { ChangeCaseError } from './change-case-ledger.mjs'

export function createStoryMilestoneService({ repository, client }) {
  if (!repository?.view || !repository?.prioritize || !repository?.retainSync || !client?.listMilestones || !client?.createIssue) throw new Error('STORY_MILESTONE_SERVICE_DEPENDENCIES_REQUIRED')
  return Object.freeze({
    listMilestones: ({ owner, repository: repositoryName }) => client.listMilestones({ owner, repository: repositoryName }),
    async publish({ scope, principal, changeCaseId, owner, repository: repositoryName, milestoneNumber, expectedVersion, sourceMilestoneOverride }) {
      const view = await repository.view(scope, changeCaseId)
      if (!view.plan && repository.workspaceView && repository.retainWorkspaceSync) return publishWorkspacePortfolio({ repository, client, scope, principal, owner, repositoryName, milestoneNumber, sourceMilestoneOverride })
      if (!view.approvedStories) throw new ChangeCaseError('STORY_APPROVAL_REQUIRED', 'An independently approved story set is required before publishing.', { retryable: false, severity: 'warning' })
      if (!view.plan) throw new ChangeCaseError('STORY_PRIORITY_PLAN_REQUIRED', 'Save a complete approved-story priority plan before publishing to GitHub.', { retryable: false, severity: 'warning' })
      const storyByKey = new Map(view.approvedStories.stories.map((story) => [story.key, story]))
      const existing = new Set(view.syncs.filter((sync) => sync.owner === owner && sync.repository === repositoryName && sync.milestoneNumber === Number(milestoneNumber)).map((sync) => sync.storyKey))
      const published = []
      for (const item of view.plan.priorities) {
        const story = storyByKey.get(item.storyKey)
        if (!story) throw new ChangeCaseError('STORY_PRIORITY_PLAN_MISMATCH', 'The active plan contains a story outside the approved revision.', { retryable: false, severity: 'warning' })
        if (existing.has(story.key)) continue
        const issue = await client.createIssue({ owner, repository: repositoryName, milestoneNumber, title: `[P${item.priority}] ${story.title}`, body: issueBody({ changeCaseId, storyDigest: view.approvedStories.storyDigest, story, priority: item.priority }) })
        const receipt = await repository.retainSync({ scope, principal, changeCaseId, storyDigest: view.approvedStories.storyDigest, storyKey: story.key, priority: item.priority, owner, repository: repositoryName, milestoneNumber: Number(milestoneNumber), issue, expectedVersion })
        published.push({ storyKey: story.key, priority: item.priority, ...receipt })
      }
      return Object.freeze({ storyDigest: view.approvedStories.storyDigest, planDigest: view.plan.planDigest, published, alreadyPublished: view.syncs.filter((sync) => existing.has(sync.storyKey)).length })
    }
  })
}

async function publishWorkspacePortfolio({ repository, client, scope, principal, owner, repositoryName, milestoneNumber, sourceMilestoneOverride }) {
  const view = await repository.workspaceView(scope)
  if (!view.plan) throw new ChangeCaseError('STORY_PRIORITY_PLAN_REQUIRED', 'Save the workspace delivery order before publishing.', { retryable: false, severity: 'warning' })
  const stories = new Map(view.approvedStories.stories.map((story) => [story.key, story]))
  const planned = view.plan.priorities.map((item) => ({ item, story: stories.get(item.storyKey) }))
  if (planned.some(({ item, story }) => !story || !sameSourceBinding(item, story))) throw new ChangeCaseError('STORY_PRIORITY_PLAN_MISMATCH', 'The saved portfolio no longer matches the active approved stories and their imported source bindings. Save the delivery order again before publishing.', { retryable: false, severity: 'warning' })
  const sources = uniqueSources(planned.map(({ item }) => item.sourceMilestone))
  const destination = { owner, repository: repositoryName, number: Number(milestoneNumber) }
  const needsOverride = sources.length > 0 && !sources.every((source) => sameDestination(source, destination))
  const override = validateOverride({ needsOverride, sourceMilestoneOverride, sources, destination })
  const existing = new Set(view.syncs.filter((sync) => sync.owner === owner && sync.repository === repositoryName && sync.milestoneNumber === Number(milestoneNumber)).map((sync) => `${sync.changeCaseId}:${sync.storyDigest}:${sync.storyKey}`))
  const published = []
  for (const { item, story } of planned) {
    if (existing.has(`${story.changeCaseId}:${story.storyDigest}:${story.sourceStoryKey}`)) continue
    const issue = await client.createIssue({ owner, repository: repositoryName, milestoneNumber, title: `[P${item.priority}] ${story.title}`, body: issueBody({ changeCaseId: story.changeCaseId, storyDigest: story.storyDigest, story, priority: item.priority }) })
    const receipt = await repository.retainWorkspaceSync({ scope, principal, entry: story, priority: item.priority, owner, repository: repositoryName, milestoneNumber: Number(milestoneNumber), issue, destinationOverride: override })
    if (!receipt.deduplicated) published.push({ storyKey: story.key, priority: item.priority, ...receipt })
  }
  return Object.freeze({ planDigest: view.plan.planDigest, published, destination, overrideApplied: Boolean(override) })
}

function sameSourceBinding(item, story) {
  return item.changeCaseId === story.changeCaseId && item.storyDigest === story.storyDigest && item.sourceStoryKey === story.sourceStoryKey && sameMilestone(item.sourceMilestone, story.sourceMilestone)
}

function sameMilestone(left, right) {
  if (!left && !right) return true
  if (!left || !right) return false
  return left.owner === right.owner && left.repository === right.repository && Number(left.number) === Number(right.number) && String(left.title ?? '') === String(right.title ?? '')
}

function uniqueSources(sources) {
  return [...new Map(sources.filter(Boolean).map((source) => [`${source.owner}/${source.repository}#${source.number}`, source])).values()]
}

function sameDestination(source, destination) {
  return source.owner === destination.owner && source.repository === destination.repository && source.number === destination.number
}

function validateOverride({ needsOverride, sourceMilestoneOverride, sources, destination }) {
  if (!needsOverride) return null
  const rationale = String(sourceMilestoneOverride?.rationale ?? '').trim()
  if (sourceMilestoneOverride?.confirmed !== true || !rationale) throw new ChangeCaseError('GITHUB_MILESTONE_OVERRIDE_CONFIRMATION_REQUIRED', 'This destination differs from the imported source milestone. Confirm the override and provide a rationale before publishing.', { retryable: false, severity: 'warning', details: { sourceMilestones: sources, destination } })
  return { confirmed: true, rationale, sourceMilestones: sources, destination }
}

function issueBody({ changeCaseId, storyDigest, story, priority }) {
  const scenarios = (story.scenarios ?? []).map((scenario) => `### Acceptance example\n- Given ${scenario.given}\n- When ${scenario.when}\n- Then ${scenario.then}`).join('\n\n')
  return `<!-- adx-story:${changeCaseId}:${storyDigest}:${story.sourceStoryKey ?? story.key} -->\n\n## ADX approved story\n\n**Priority:** P${priority}\n\n${story.narrative}\n\n${scenarios}\n\n---\nSource: ADX independently approved story contract \`${storyDigest}\`. Changes to this GitHub issue do not alter the ADX workflow.`
}
