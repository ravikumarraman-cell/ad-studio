import { expect, test } from '@playwright/test'
import { cancelChangeCase } from './change-case-test-utils.mjs'

const workspaceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

test('a Change Case deep link reloads the authoritative persisted projection', async ({ page, context, request }) => {
  const session = await (await request.get('/__test/session?as=alice')).json()
  await context.addCookies([{ name: 'adx_session', value: session.token, domain: '127.0.0.1', path: '/' }])
  let changeCaseId
  try {
    const createResponse = await request.post(`/v1/workspaces/${workspaceId}/change-cases`, { headers: { authorization: `Bearer ${session.token}`, 'idempotency-key': `stage2-browser-create-${Date.now()}` }, data: { title: 'Browser refresh Change Case', riskTier: 'R1' } })
    expect(createResponse.status()).toBe(201)
    const created = await createResponse.json()
    changeCaseId = created.changeCaseId
    const route = `/v1/workspaces/${workspaceId}/change-cases/${changeCaseId}`
    await page.goto(route)
    await expect(page.locator('body')).toContainText('Browser refresh Change Case')
    await expect(page.locator('body')).toContainText('"projectionVersion":1')
    await page.reload()
    await expect(page.locator('body')).toContainText('Browser refresh Change Case')
    await expect(page.locator('body')).toContainText('"projectionVersion":1')
  } finally {
    await cancelChangeCase(request, workspaceId, session.token, changeCaseId)
  }
})

test('Gate A classifies retained intake before opening story authoring', async ({ page, context, request }) => {
  const session = await (await request.get('/__test/session?as=alice')).json()
  const headers = (idempotencyKey) => ({ authorization: `Bearer ${session.token}`, 'content-type': 'application/json', 'idempotency-key': idempotencyKey })
  await context.addCookies([{ name: 'adx_session', value: session.token, domain: '127.0.0.1', path: '/' }])

  let changeCaseId
  try {
    const created = await request.post(`/v1/workspaces/${workspaceId}/change-cases`, { headers: headers(`stage2-intake-create-${Date.now()}`), data: { title: 'Classify retained intake', riskTier: 'R2' } })
    const { changeCaseId: createdId, projectionVersion: createdVersion } = await created.json()
    changeCaseId = createdId
    const moved = await request.post(`/v1/workspaces/${workspaceId}/change-cases/${changeCaseId}/transitions`, { headers: headers(`stage2-intake-transition-${Date.now()}`), data: { toState: 'INTAKE', expectedVersion: createdVersion } })
    const { projectionVersion: intakeVersion } = await moved.json()
    await request.post(`/v1/workspaces/${workspaceId}/change-cases/${changeCaseId}/intake`, { headers: headers(`stage2-intake-capture-${Date.now()}`), data: { expectedVersion: intakeVersion, intent: { outcome: 'Classify a retained change request', owner: 'Product operations', acceptanceCriteria: 'Risk classification opens story authoring.', targetRepository: 'adx-api', assets: [], sourceContent: 'Controlled browser test', sourceName: 'intake.md' } } })

    await page.goto(`/v1/workspaces/${workspaceId}/change-cases/${changeCaseId}/intake-workshop`)
    await expect(page.getByText('ONE SAFE NEXT ACTION')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Confirm intake, then continue to stories' })).toBeVisible()
    await page.getByRole('button', { name: 'Confirm intake, then continue to stories' }).press('Enter')
    await expect(page.getByRole('status')).toHaveText('Risk classified. Opening story generation…')
    await page.waitForURL(/\/story-workshop$/)
    await expect(page.getByText('Draft stories, then send them to review')).toBeVisible()
  } finally {
    await cancelChangeCase(request, workspaceId, session.token, changeCaseId)
  }
})
