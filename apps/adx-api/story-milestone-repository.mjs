import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { ChangeCaseError, sha256 } from './change-case-ledger.mjs'

export class StoryMilestoneRepository {
  constructor({ connectionString }) {
    if (!connectionString) throw new Error('DATABASE_URL_REQUIRED')
    this.pool = new pg.Pool({ connectionString, max: 5, idleTimeoutMillis: 10_000 })
  }

  async scoped(scope, work) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query("SELECT set_config('adx.organization_id', $1, true), set_config('adx.workspace_id', $2, true)", [scope.organizationId, scope.workspaceId])
      const value = await work(client)
      await client.query('COMMIT')
      return value
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally { client.release() }
  }

  async view(scope, changeCaseId) {
    return this.scoped(scope, async (client) => {
      const approved = await currentApprovedStories(client, scope, changeCaseId)
      const plan = approved ? await currentPlan(client, scope, changeCaseId, approved.storyDigest) : null
      const syncs = approved ? await client.query('SELECT story_key AS "storyKey", priority, owner, repository, milestone_number AS "milestoneNumber", issue_number AS "issueNumber", issue_url AS "issueUrl", sync_digest AS "syncDigest", created_at AS "createdAt" FROM adx_github_milestone_story_sync WHERE change_case_id=$1 AND story_digest=$2 AND organization_id=$3 AND workspace_id=$4 ORDER BY priority, story_key', [changeCaseId, approved.storyDigest, scope.organizationId, scope.workspaceId]) : { rows: [] }
      return { approvedStories: approved ? { storyDigest: approved.storyDigest, stories: approved.stories } : null, plan, syncs: syncs.rows }
    })
  }

  async workspaceView(scope) {
    return this.scoped(scope, async (client) => {
      const approved = await workspaceApprovedStories(client, scope)
      const plan = await client.query('SELECT portfolio_digest AS "planDigest", entries, planned_by AS "plannedBy", created_at AS "createdAt" FROM adx_workspace_story_portfolio WHERE organization_id=$1 AND workspace_id=$2 ORDER BY created_at DESC LIMIT 1', [scope.organizationId, scope.workspaceId])
      const syncs = await client.query('SELECT sync.change_case_id AS "changeCaseId", change_case.title AS "sourceTitle", sync.story_digest AS "storyDigest", sync.story_key AS "storyKey", sync.priority, sync.owner, sync.repository, sync.milestone_number AS "milestoneNumber", sync.issue_number AS "issueNumber", sync.issue_url AS "issueUrl", sync.created_at AS "createdAt" FROM adx_github_milestone_story_sync sync JOIN adx_change_case change_case ON change_case.id=sync.change_case_id WHERE sync.organization_id=$1 AND sync.workspace_id=$2 ORDER BY sync.priority, sync.created_at, sync.story_key', [scope.organizationId, scope.workspaceId])
      return { approvedStories: { storyDigest: 'workspace', stories: approved }, plan: plan.rows[0] ? { ...plan.rows[0], priorities: plan.rows[0].entries } : null, syncs: syncs.rows }
    })
  }

  async recordSourceMilestone({ scope, principal, changeCaseId, source }) {
    return this.scoped(scope, async (client) => {
      const sourceDigest = sha256({ schema: 'adx-github-source-milestone-v1', changeCaseId, source })
      const existing = await client.query('SELECT source_digest AS "sourceDigest" FROM adx_github_source_milestone WHERE change_case_id=$1 AND organization_id=$2 AND workspace_id=$3', [changeCaseId, scope.organizationId, scope.workspaceId])
      if (existing.rowCount) {
        if (existing.rows[0].sourceDigest !== sourceDigest) throw new ChangeCaseError('GITHUB_SOURCE_MILESTONE_CONFLICT', 'The imported GitHub source milestone cannot be changed after intake.', { retryable: false, severity: 'warning' })
        return { sourceDigest, deduplicated: true }
      }
      await client.query('INSERT INTO adx_github_source_milestone (id,organization_id,workspace_id,change_case_id,owner,repository,milestone_number,milestone_title,source_digest,recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [randomUUID(), scope.organizationId, scope.workspaceId, changeCaseId, source.owner, source.repository, source.number, source.title, sourceDigest, principal.id])
      return { sourceDigest, deduplicated: false }
    })
  }

  async prioritize({ scope, principal, changeCaseId, storyDigest, priorities, expectedVersion }) {
    return this.scoped(scope, async (client) => {
      if (storyDigest === 'workspace') return prioritizeWorkspace(client, { scope, principal, priorities })
      const approved = await requirePlanningState(client, scope, changeCaseId, storyDigest, expectedVersion)
      const normalized = normalizePriorities(approved.stories, priorities)
      const planDigest = sha256({ schema: 'adx-story-priority-plan-v1', changeCaseId, storyDigest, priorities: normalized })
      const existing = await currentPlan(client, scope, changeCaseId, storyDigest)
      if (existing?.planDigest === planDigest) return { ...existing, deduplicated: true }
      await client.query('INSERT INTO adx_story_priority_plan (id,organization_id,workspace_id,change_case_id,story_digest,plan_digest,priorities,planned_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), scope.organizationId, scope.workspaceId, changeCaseId, storyDigest, planDigest, JSON.stringify(normalized), principal.id])
      return { storyDigest, planDigest, priorities: normalized, plannedBy: principal.id, deduplicated: false }
    })
  }

  async retainSync({ scope, principal, changeCaseId, storyDigest, storyKey, priority, owner, repository, milestoneNumber, issue, expectedVersion }) {
    return this.scoped(scope, async (client) => {
      const approved = await requirePlanningState(client, scope, changeCaseId, storyDigest, expectedVersion)
      const plan = await currentPlan(client, scope, changeCaseId, storyDigest)
      if (!plan) throw new ChangeCaseError('STORY_PRIORITY_PLAN_REQUIRED', 'Save a complete approved-story priority plan before publishing to GitHub.', { retryable: false, severity: 'warning' })
      if (!plan.priorities.some((item) => item.storyKey === storyKey && item.priority === priority) || !approved.stories.some((story) => story.key === storyKey)) throw new ChangeCaseError('STORY_PRIORITY_PLAN_MISMATCH', 'The story publication does not match the active approved priority plan.', { retryable: false, severity: 'warning' })
      const existing = await client.query('SELECT issue_number AS "issueNumber", issue_url AS "issueUrl", sync_digest AS "syncDigest" FROM adx_github_milestone_story_sync WHERE change_case_id=$1 AND story_digest=$2 AND story_key=$3 AND owner=$4 AND repository=$5 AND milestone_number=$6 AND organization_id=$7 AND workspace_id=$8', [changeCaseId, storyDigest, storyKey, owner, repository, milestoneNumber, scope.organizationId, scope.workspaceId])
      if (existing.rowCount) return { ...existing.rows[0], deduplicated: true }
      const syncDigest = sha256({ schema: 'adx-github-milestone-story-sync-v1', changeCaseId, storyDigest, storyKey, priority, owner, repository, milestoneNumber, issueNumber: issue.number, issueUrl: issue.url })
      await client.query('INSERT INTO adx_github_milestone_story_sync (id,organization_id,workspace_id,change_case_id,story_digest,story_key,priority,owner,repository,milestone_number,issue_number,issue_url,sync_digest,recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)', [randomUUID(), scope.organizationId, scope.workspaceId, changeCaseId, storyDigest, storyKey, priority, owner, repository, milestoneNumber, issue.number, issue.url, syncDigest, principal.id])
      return { issueNumber: issue.number, issueUrl: issue.url, syncDigest, deduplicated: false }
    })
  }

  async retainWorkspaceSync({ scope, principal, entry, priority, owner, repository, milestoneNumber, issue, destinationOverride }) {
    return this.scoped(scope, async (client) => {
      const existing = await client.query('SELECT issue_number AS "issueNumber", issue_url AS "issueUrl", sync_digest AS "syncDigest" FROM adx_github_milestone_story_sync WHERE change_case_id=$1 AND story_digest=$2 AND story_key=$3 AND owner=$4 AND repository=$5 AND milestone_number=$6 AND organization_id=$7 AND workspace_id=$8', [entry.changeCaseId, entry.storyDigest, entry.sourceStoryKey, owner, repository, milestoneNumber, scope.organizationId, scope.workspaceId])
      if (existing.rowCount) return { ...existing.rows[0], deduplicated: true }
      const syncDigest = sha256({ schema: 'adx-workspace-story-portfolio-sync-v1', entry, priority, owner, repository, milestoneNumber, issueNumber: issue.number, issueUrl: issue.url })
      await client.query('INSERT INTO adx_github_milestone_story_sync (id,organization_id,workspace_id,change_case_id,story_digest,story_key,priority,owner,repository,milestone_number,issue_number,issue_url,sync_digest,recorded_by,source_milestone,destination_override) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)', [randomUUID(), scope.organizationId, scope.workspaceId, entry.changeCaseId, entry.storyDigest, entry.sourceStoryKey, priority, owner, repository, milestoneNumber, issue.number, issue.url, syncDigest, principal.id, JSON.stringify(entry.sourceMilestone), destinationOverride ? JSON.stringify(destinationOverride) : null])
      return { issueNumber: issue.number, issueUrl: issue.url, syncDigest, deduplicated: false }
    })
  }

  async close() { await this.pool.end() }
}

async function workspaceApprovedStories(client, scope) {
  const result = await client.query("SELECT change_case.id AS \"changeCaseId\", change_case.title AS \"sourceTitle\", revision.story_digest AS \"storyDigest\", revision.stories, source.owner AS \"sourceOwner\", source.repository AS \"sourceRepository\", source.milestone_number AS \"sourceMilestoneNumber\", source.milestone_title AS \"sourceMilestoneTitle\" FROM adx_change_case change_case JOIN adx_story_revision revision ON revision.change_case_id=change_case.id JOIN adx_story_approval approval ON approval.change_case_id=revision.change_case_id AND approval.story_digest=revision.story_digest AND approval.status='ACTIVE' AND approval.decision='APPROVED' LEFT JOIN adx_github_source_milestone source ON source.change_case_id=change_case.id AND source.organization_id=$1 AND source.workspace_id=$2 WHERE change_case.organization_id=$1 AND change_case.workspace_id=$2 AND change_case.state='DESIGN_REVIEW' ORDER BY change_case.created_at,revision.revision", [scope.organizationId, scope.workspaceId])
  return result.rows.flatMap((row) => (row.stories ?? []).map((story) => ({ ...story, key: `${row.changeCaseId}:${story.key}`, sourceTitle: row.sourceTitle, sourceStoryKey: story.key, changeCaseId: row.changeCaseId, storyDigest: row.storyDigest, sourceMilestone: row.sourceOwner ? { owner: row.sourceOwner, repository: row.sourceRepository, number: row.sourceMilestoneNumber, title: row.sourceMilestoneTitle } : null })))
}

async function prioritizeWorkspace(client, { scope, principal, priorities }) {
  const stories = await workspaceApprovedStories(client, scope)
  const ranks = normalizePriorities(stories, priorities)
  const byKey = new Map(stories.map((story) => [story.key, story]))
  const normalized = ranks.map((item) => {
    const story = byKey.get(item.storyKey)
    return { ...item, changeCaseId: story.changeCaseId, storyDigest: story.storyDigest, sourceStoryKey: story.sourceStoryKey, sourceMilestone: story.sourceMilestone }
  })
  const portfolioDigest = sha256({ schema: 'adx-workspace-story-portfolio-v1', entries: normalized })
  const existing = await client.query('SELECT portfolio_digest AS "planDigest", entries FROM adx_workspace_story_portfolio WHERE organization_id=$1 AND workspace_id=$2 AND portfolio_digest=$3', [scope.organizationId, scope.workspaceId, portfolioDigest])
  if (existing.rowCount) return { ...existing.rows[0], priorities: existing.rows[0].entries, deduplicated: true }
  await client.query('INSERT INTO adx_workspace_story_portfolio (id,organization_id,workspace_id,portfolio_digest,entries,planned_by) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), scope.organizationId, scope.workspaceId, portfolioDigest, JSON.stringify(normalized), principal.id])
  return { planDigest: portfolioDigest, priorities: normalized, plannedBy: principal.id, deduplicated: false }
}

async function currentApprovedStories(client, scope, changeCaseId) {
  const result = await client.query("SELECT revision.stories, revision.story_digest AS \"storyDigest\" FROM adx_story_revision revision JOIN adx_story_approval approval ON approval.change_case_id=revision.change_case_id AND approval.story_digest=revision.story_digest AND approval.organization_id=revision.organization_id AND approval.workspace_id=revision.workspace_id WHERE revision.change_case_id=$1 AND revision.organization_id=$2 AND revision.workspace_id=$3 AND approval.status='ACTIVE' AND approval.decision='APPROVED' ORDER BY revision.revision DESC LIMIT 1", [changeCaseId, scope.organizationId, scope.workspaceId])
  return result.rowCount ? { storyDigest: result.rows[0].storyDigest, stories: result.rows[0].stories } : null
}

async function requirePlanningState(client, scope, changeCaseId, storyDigest, expectedVersion) {
  const state = await client.query('SELECT state, projection_version AS "projectionVersion" FROM adx_change_case WHERE id=$1 AND organization_id=$2 AND workspace_id=$3 FOR UPDATE', [changeCaseId, scope.organizationId, scope.workspaceId])
  if (!state.rowCount) throw new ChangeCaseError('CHANGE_CASE_NOT_FOUND', 'Change Case was not found.')
  if (expectedVersion !== state.rows[0].projectionVersion) throw new ChangeCaseError('VERSION_CONFLICT', 'The Change Case changed before release planning could be completed.', { retryable: false, severity: 'warning', details: { expectedVersion, actualVersion: state.rows[0].projectionVersion } })
  if (state.rows[0].state !== 'DESIGN_REVIEW') throw new ChangeCaseError('STORY_RELEASE_PLANNING_NOT_ALLOWED', 'Prioritize and publish stories only after independent story approval and before design approval.', { retryable: false, severity: 'warning' })
  const approved = await currentApprovedStories(client, scope, changeCaseId)
  if (!approved || approved.storyDigest !== storyDigest) throw new ChangeCaseError('STORY_APPROVAL_REQUIRED', 'The active independently approved story digest is required for release planning.', { retryable: false, severity: 'warning' })
  return approved
}

async function currentPlan(client, scope, changeCaseId, storyDigest) {
  const result = await client.query('SELECT story_digest AS "storyDigest", plan_digest AS "planDigest", priorities, planned_by AS "plannedBy", created_at AS "createdAt" FROM adx_story_priority_plan WHERE change_case_id=$1 AND story_digest=$2 AND organization_id=$3 AND workspace_id=$4 ORDER BY created_at DESC LIMIT 1', [changeCaseId, storyDigest, scope.organizationId, scope.workspaceId])
  return result.rows[0] ?? null
}

function normalizePriorities(stories, priorities) {
  if (!Array.isArray(priorities) || priorities.length !== stories.length) throw new ChangeCaseError('STORY_PRIORITY_PLAN_INVALID', 'Rank every story in the active approved story set exactly once.', { retryable: false, severity: 'warning' })
  const allowed = new Set(stories.map((story) => story.key)); const keys = new Set(); const ranks = new Set()
  const normalized = priorities.map((item) => ({ storyKey: String(item?.storyKey ?? '').trim(), priority: Number(item?.priority) }))
  for (const item of normalized) if (!allowed.has(item.storyKey) || keys.has(item.storyKey) || !Number.isInteger(item.priority) || item.priority < 1 || item.priority > stories.length || ranks.has(item.priority)) throw new ChangeCaseError('STORY_PRIORITY_PLAN_INVALID', 'Rank every story in the active approved story set exactly once.', { retryable: false, severity: 'warning' }); else { keys.add(item.storyKey); ranks.add(item.priority) }
  return normalized.sort((left, right) => left.priority - right.priority)
}
