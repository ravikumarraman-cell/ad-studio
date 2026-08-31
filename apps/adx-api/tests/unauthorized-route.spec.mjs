import { expect, test } from '@playwright/test'
const base = 'http://127.0.0.1:3104'

test('an unauthenticated browser request cannot reach the current-user route', async ({ page }) => {
  const response = await page.goto(new URL('/v1/me', base).toString())
  expect(response?.status()).toBe(401)
  await expect(page.locator('body')).toContainText('AUTHENTICATION_REQUIRED')
  await expect(page.locator('body')).not.toContainText('memberships')
})
