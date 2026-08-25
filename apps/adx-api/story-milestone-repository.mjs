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

  async prioritize({ scope, principal, changeCaseId, storyDigest, priorities, expectedVersion }) {
    return this.scoped(scope, async (client) => {
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

  async close() { await this.pool.end() }
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