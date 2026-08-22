import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { chromium } from 'playwright'

export async function verifyLocalApplication(profile) {
  assertProfile(profile)
  await run(profile.buildCommand, { cwd: profile.workspaceRoot })
  const port = await availablePort()
  const origin = `http://127.0.0.1:${port}`
  const server = spawn(profile.serverCommand[0], profile.serverCommand.slice(1), {
    cwd: profile.workspaceRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let serverOutput = ''
  server.stdout.on('data', (chunk) => { serverOutput += chunk })
  server.stderr.on('data', (chunk) => { serverOutput += chunk })
  let browser
  try {
    await waitForServer(origin, server, () => serverOutput)
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    const consoleErrors = []
    const externalRequests = []
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    page.on('request', (request) => { const target = new URL(request.url()); if (target.origin !== origin) externalRequests.push(target.origin) })
    await profile.verify({ page, origin })
    assert.deepEqual([...new Set(externalRequests)], [], `${profile.name} made an external browser request.`)
    assert.deepEqual(consoleErrors, [], `${profile.name} emitted browser console errors.`)
    console.log(`${profile.name} production acceptance passed: build, local runtime, browser flows, refresh behavior, and network boundary.`)
  } finally {
    await browser?.close()
    server.kill('SIGTERM')
    await Promise.race([once(server, 'exit'), delay(2_000)])
  }
}

function assertProfile(profile) {
  if (!profile || typeof profile.name !== 'string' || typeof profile.workspaceRoot !== 'string' || !Array.isArray(profile.buildCommand) || !Array.isArray(profile.serverCommand) || typeof profile.verify !== 'function') throw new Error('LOCAL_APPLICATION_PROFILE_INVALID')
}

function run(command, { cwd }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command[0], command.slice(1), { cwd, env: process.env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => code === 0 ? resolvePromise() : reject(new Error(`Build failed: ${command.join(' ')} (${signal ?? code})`)))
  })
}

async function availablePort() {
  const server = createServer()
  await new Promise((resolvePromise, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolvePromise) })
  const address = server.address()
  await new Promise((resolvePromise) => server.close(resolvePromise))
  return address.port
}

async function waitForServer(origin, server, output) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Application exited early (${server.exitCode}): ${output()}`)
    try { const response = await fetch(origin); if (response.ok) return } catch {}
    await delay(200)
  }
  throw new Error(`Application did not become ready within 30 seconds: ${output()}`)
}

function delay(milliseconds) { return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)) }