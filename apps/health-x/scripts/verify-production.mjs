import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { chromium } from 'playwright'

await run(['npm', 'run', 'build'])
const port = await availablePort()
const origin = `http://127.0.0.1:${port}`
const server = spawn(process.execPath, ['.output/server/index.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''
server.stdout.on('data', (chunk) => { output += chunk })
server.stderr.on('data', (chunk) => { output += chunk })
let browser
try {
  await waitForServer(origin, server, () => output)
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const consoleErrors = []
  const externalRequests = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('request', (request) => { const target = new URL(request.url()); if (target.origin !== origin) externalRequests.push(target.origin) })
  await page.goto(origin, { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('link', { name: 'Health-X home' }).waitFor()
  await page.getByRole('heading', { name: 'Your appointment' }).waitFor()
  await page.getByText(/fictional data/i).waitFor()
  await page.getByRole('button', { name: 'Comfortable', exact: true }).waitFor()
  await assert.equal(await page.getByRole('button', { name: 'Comfortable', exact: true }).getAttribute('aria-pressed'), 'true')
  await page.getByRole('button', { name: 'Compact', exact: true }).click()
  await assert.equal(await page.locator('main').getAttribute('class'), 'app-shell density-compact')
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
  assert.deepEqual([...new Set(externalRequests)], [], 'Health-X made an external browser request.')
  assert.deepEqual(consoleErrors, [], 'Health-X emitted browser console errors.')
  console.log('Health-X standalone production acceptance passed.')
} finally { await browser?.close(); server.kill('SIGTERM'); await Promise.race([once(server, 'exit'), delay(2_000)]) }

async function assertProgress(page, expected) { assert.equal(await page.locator('[aria-label*="daily actions complete"]').getAttribute('aria-label'), expected) }
function run(command) { return new Promise((resolvePromise, reject) => { const child = spawn(command[0], command.slice(1), { env: process.env, stdio: 'inherit' }); child.once('error', reject); child.once('exit', (code, signal) => code === 0 ? resolvePromise() : reject(new Error(`Build failed: ${command.join(' ')} (${signal ?? code})`))) }) }
async function availablePort() { const server = createServer(); await new Promise((resolvePromise, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolvePromise) }); const { port } = server.address(); await new Promise((resolvePromise) => server.close(resolvePromise)); return port }
async function waitForServer(origin, server, getOutput) { const deadline = Date.now() + 30_000; while (Date.now() < deadline) { if (server.exitCode !== null) throw new Error(`Application exited early (${server.exitCode}): ${getOutput()}`); try { const response = await fetch(origin); if (response.ok) return } catch {} await delay(200) } throw new Error(`Application did not become ready within 30 seconds: ${getOutput()}`) }
function delay(milliseconds) { return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)) }