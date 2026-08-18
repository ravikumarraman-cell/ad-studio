import { expect, test } from '@playwright/test'

test('a user can select a feature and take the first governed action', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Choose a feature. ADX guides the rest.' })).toBeVisible()
  await expect(page.locator('input[type="file"]')).toHaveAttribute('accept', '.csv,text/csv')
  await expect(page.getByRole('button', { name: 'Create Change Case' })).toBeVisible()

  await page.getByRole('button', { name: /HI-1002.*Evidence packet and human review/ }).click()
  await expect(page.getByRole('heading', { name: 'Evidence packet and human review' })).toBeVisible()
  await page.getByRole('button', { name: 'Create Change Case' }).click()

  await expect(page.getByText('HI-1002: Create Change Case accepted.')).toBeVisible()
  await expect(page.getByText('Now: Clarify')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Approve scope' })).toBeVisible()
})
