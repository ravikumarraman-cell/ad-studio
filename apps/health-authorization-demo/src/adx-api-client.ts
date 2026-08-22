export type Membership = { organizationId: string; workspaceId: string; roles: string[] }
export type Principal = { id: string; displayName?: string }
export type Session = { principal: Principal; memberships: Membership[] }
export type ChangeCase = { id: string; title: string; riskTier: string; state: string; projectionVersion?: number }
export type CommandResult = { changeCaseId: string; projectionVersion: number; newState: string; deduplicated?: boolean }
export type ImportFeature = { featureId: string; title: string; description: string; priority: string; owner: string; targetRepository: string; acceptanceCriteria: string; riskTier: string; sourceUrl: string; raw: string }
export type FeatureImportResult = { featureId: string; title: string; status: 'IMPORTED' | 'REQUIRES_CLARIFICATION' | 'FAILED'; changeCaseId?: string; message?: string }
export type FeatureImportResponse = { importId: string; policy: 'PARTIAL_SUCCESS_RESUMABLE'; results: FeatureImportResult[] }
export type PublicGitHubMilestone = { number: number; title: string; description: string; openIssues: number; closedIssues: number; dueOn: string | null; htmlUrl: string }
export type ApiError = Error & { status?: number; code?: string }

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, { ...init, credentials: 'include', headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } })
  } catch {
    throw new Error('The ADX API could not be reached. Confirm that the local ADX API is running, then try again.')
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const code = body?.error?.code ?? body?.code
    const error = new Error(body?.error?.message ?? body?.message ?? (code ? `The ADX API denied this request (${code}).` : `The ADX API returned HTTP ${response.status}.`)) as ApiError
    error.status = response.status
    error.code = code
    throw error
  }
  return response.json() as Promise<T>
}

export function newIdempotencyKey() { return crypto.randomUUID() }

export async function cancelChangeCase(workspaceId: string, changeCase: ChangeCase): Promise<CommandResult> {
  if (typeof changeCase.projectionVersion !== 'number') throw new Error('The Change Case version is unavailable. Refresh the workspace and try again.')
  return api<CommandResult>(`/v1/workspaces/${workspaceId}/change-cases/${changeCase.id}/transitions`, {
    method: 'POST',
    headers: { 'idempotency-key': newIdempotencyKey() },
    body: JSON.stringify({ toState: 'CANCELLED', expectedVersion: changeCase.projectionVersion }),
  })
}

export async function importFeatures(workspaceId: string, importId: string, features: ImportFeature[]): Promise<FeatureImportResponse> {
  return api<FeatureImportResponse>(`/v1/workspaces/${workspaceId}/feature-imports`, {
    method: 'POST',
    headers: { 'idempotency-key': newIdempotencyKey() },
    body: JSON.stringify({ importId, features }),
  })
}

export async function listPublicGitHubMilestones(workspaceId: string, owner: string, repository: string): Promise<{ milestones: PublicGitHubMilestone[] }> {
  return api(`/v1/workspaces/${workspaceId}/github-public/milestones?owner=${encodeURIComponent(owner)}&repository=${encodeURIComponent(repository)}`)
}

export async function importPublicGitHubMilestone(workspaceId: string, input: { owner: string; repository: string; milestone: number; featureOwner: string; targetRepository: string; riskTier: string }): Promise<FeatureImportResponse> {
  return api(`/v1/workspaces/${workspaceId}/github-public/milestone-import`, { method: 'POST', headers: { 'idempotency-key': newIdempotencyKey() }, body: JSON.stringify({ ...input, importId: crypto.randomUUID() }) })
}
