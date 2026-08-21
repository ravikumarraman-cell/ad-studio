export type Membership = { organizationId: string; workspaceId: string; roles: string[] }
export type Principal = { id: string; displayName?: string }
export type Session = { principal: Principal; memberships: Membership[] }
export type ChangeCase = { id: string; title: string; riskTier: string; state: string; projectionVersion?: number }
export type CommandResult = { changeCaseId: string; projectionVersion: number; newState: string; deduplicated?: boolean }
export type ImportFeature = { featureId: string; title: string; description: string; priority: string; owner: string; targetRepository: string; acceptanceCriteria: string; riskTier: string; sourceUrl: string; raw: string }
export type FeatureImportResult = { featureId: string; title: string; status: 'IMPORTED' | 'REQUIRES_CLARIFICATION' | 'FAILED'; changeCaseId?: string; message?: string }
export type FeatureImportResponse = { importId: string; policy: 'PARTIAL_SUCCESS_RESUMABLE'; results: FeatureImportResult[] }
export type ApiError = Error & { status?: number; code?: string }

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: 'include', headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const error = new Error(body?.error?.message ?? body?.message ?? 'ADX request failed') as ApiError
    error.status = response.status
    error.code = body?.error?.code ?? body?.code
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
