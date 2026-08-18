import { expect, test } from '@playwright/test'

const workspaceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

test('a Change Case deep link reloads the authoritative persisted projection', async ({ page, context, request }) => {
  const session = await (await request.get('/__test/session?as=alice')).json()
  await context.addCookies([{ name: 'adx_session', value: session.token, domain: '127.0.0.1', path: '/' }])
  const createResponse = await request.post(`/v1/workspaces/${workspaceId}/change-cases`, { headers: { authorization: `Bearer ${session.token}`, 'idempotency-key': `stage2-browser-create-${Date.now()}` }, data: { title: 'Browser refresh Change Case', riskTier: 'R1' } })
  expect(createResponse.status()).toBe(201)
  const created = await createResponse.json()
  const route = `/v1/workspaces/${workspaceId}/change-cases/${created.changeCaseId}`
  await page.goto(route)
  await expect(page.locator('body')).toContainText('Browser refresh Change Case')
  await expect(page.locator('body')).toContainText('"projectionVersion":1')
  await page.reload()
  await expect(page.locator('body')).toContainText('Browser refresh Change Case')
  await expect(page.locator('body')).toContainText('"projectionVersion":1')
})
