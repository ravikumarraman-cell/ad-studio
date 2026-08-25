import { ChangeCaseError } from './change-case-ledger.mjs'

export function createStoryMilestoneService({ repository, client }) {
  if (!repository?.view || !repository?.prioritize || !repository?.retainSync || !client?.listMilestones || !client?.createIssue) throw new Error('STORY_MILESTONE_SERVICE_DEPENDENCIES_REQUIRED')
  return Object.freeze({
    listMilestones: ({ owner, repository: repositoryName }) => client.listMilestones({ owner, repository: repositoryName }),
    async publish({ scope, principal, changeCaseId, owner, repository: repositoryName, milestoneNumber, expectedVersion }) {
      const view = await repository.view(scope, changeCaseId)
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

function issueBody({ changeCaseId, storyDigest, story, priority }) {
  const scenarios = (story.scenarios ?? []).map((scenario) => `### Acceptance example\n- Given ${scenario.given}\n- When ${scenario.when}\n- Then ${scenario.then}`).join('\n\n')
  return `<!-- adx-story:${changeCaseId}:${storyDigest}:${story.key} -->\n\n## ADX approved story\n\n**Priority:** P${priority}\n\n${story.narrative}\n\n${scenarios}\n\n---\nSource: ADX independently approved story contract \`${storyDigest}\`. Changes to this GitHub issue do not alter the ADX workflow.`
}