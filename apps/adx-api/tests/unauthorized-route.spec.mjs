import { expect, test } from '@playwright/test'

test('an unauthenticated browser request cannot reach the current-user route', async ({ page }) => {
  const response = await page.goto('/v1/me')
  expect(response?.status()).toBe(401)
  await expect(page.locator('body')).toContainText('AUTHENTICATION_REQUIRED')
  await expect(page.locator('body')).not.toContainText('memberships')
})
