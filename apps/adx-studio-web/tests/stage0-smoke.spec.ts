import { expect, test } from '@playwright/test'

test('guided walkthrough prevents skipped and incomplete early gate decisions', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Choose your delivery path.' })).toBeVisible()
  await page.getByRole('button', { name: /Start guided case/ }).click()
  await expect(page.getByRole('heading', { name: 'Run a feature through ADX.' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Decision frame' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Generate & curate stories/ })).toBeDisabled()

  await page.getByLabel('Feature title').fill('')
  await expect(page.getByRole('button', { name: 'Continue walkthrough' })).toBeDisabled()
  await expect(page.getByText('Enter a feature title and desired outcome to continue.')).toBeVisible()

  await page.getByLabel('Feature title').fill('Provider authorization request')
  await page.getByRole('button', { name: 'Continue walkthrough' }).click()
  await expect(page.getByRole('heading', { name: 'Story suggestions for this feature' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Generate & curate stories/ })).toBeFocused()
  await expect(page.getByRole('button', { name: 'Accept selected stories' })).toBeDisabled()
  await expect(page.getByText('Select at least one story to continue.')).toBeVisible()

  await page.getByRole('checkbox').first().check()
  await page.getByRole('button', { name: 'Accept selected stories' }).click()
  await expect(page.getByRole('heading', { name: 'Independent story approval' })).toBeVisible()

  for (let index = 0; index < 6; index += 1) {
    await page.getByRole('button', { name: 'Continue walkthrough' }).click()
  }
  await page.getByRole('button', { name: 'Finish guided demo' }).click()
  await expect(page.getByRole('heading', { name: 'No records were created or changed.' })).toBeFocused()
  await expect(page.getByRole('button', { name: 'Choose a delivery path' })).toBeVisible()
})
