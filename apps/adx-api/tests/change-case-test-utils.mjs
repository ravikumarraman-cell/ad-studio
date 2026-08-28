export async function cancelChangeCase(request, workspaceId, token, changeCaseId) {
  if (!changeCaseId) return

  const headers = { authorization: `Bearer ${token}` }
  const response = await request.get(`/v1/workspaces/${workspaceId}/change-cases/${changeCaseId}`, { headers })
  if (!response.ok()) return

  const body = await response.json()
  const changeCase = body.changeCase ?? body
  if (!changeCase || changeCase.state === 'CANCELLED' || changeCase.state === 'OUTCOME_RECORDED') return

  await request.post(`/v1/workspaces/${workspaceId}/change-cases/${changeCaseId}/transitions`, {
    headers: {
      ...headers,
      'content-type': 'application/json',
      'idempotency-key': `test-cleanup-${changeCaseId}`,
    },
    data: {
      toState: 'CANCELLED',
      expectedVersion: changeCase.projectionVersion,
    },
  })
}
