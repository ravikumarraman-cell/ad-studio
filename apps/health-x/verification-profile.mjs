import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const workspaceRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))

export const healthXVerificationProfile = Object.freeze({
  name: 'Health-X',
  workspaceRoot,
  buildCommand: ['npm', 'run', 'health-x:build'],
  serverCommand: [process.execPath, 'apps/health-x/.output/server/index.mjs'],
  async verify({ page, origin }) {
    await page.goto(origin, { waitUntil: 'networkidle' })
    await page.evaluate(() => localStorage.clear())
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('link', { name: 'Health-X home' }).waitFor()
    await page.getByRole('heading', { name: 'Your appointment' }).waitFor()
    await page.getByText(/fictional data/i).waitFor()
    await assert.equal(await page.getByRole('button', { name: 'Comfortable', exact: true }).getAttribute('aria-pressed'), 'true')
    await page.getByRole('button', { name: 'Compact', exact: true }).click()
    await page.reload({ waitUntil: 'networkidle' })
    await assert.equal(await page.getByRole('button', { name: 'Compact', exact: true }).getAttribute('aria-pressed'), 'true')
    await page.getByRole('button', { name: 'Use default', exact: true }).click()
    await assert.equal(await page.getByRole('button', { name: 'Comfortable', exact: true }).getAttribute('aria-pressed'), 'true')
    await assertProgress(page, '0 of 4 daily actions complete')
    await page.getByRole('button', { name: 'Check in', exact: true }).click()
    await page.getByText('Checked in', { exact: true }).waitFor()
    await page.getByRole('button', { name: /Morning medication/ }).click()
    await assertProgress(page, '1 of 4 daily actions complete')
    await page.getByRole('button', { name: /Take a 10-minute walk/ }).click()
    await assertProgress(page, '2 of 4 daily actions complete')
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Check in', exact: true }).waitFor()
    await assertProgress(page, '0 of 4 daily actions complete')
  },
})

async function assertProgress(page, expected) { assert.equal(await page.locator('[aria-label*="daily actions complete"]').getAttribute('aria-label'), expected) }
