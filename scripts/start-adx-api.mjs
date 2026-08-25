import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { loadLocalEnv } from './load-local-env.mjs'

if (process.argv.includes('--help')) {
  console.log('Usage: npm run api:start\n\nLoads .env.local, verifies governed API prerequisites, checks the configured PORT (default 3100), then starts the ADX API. Environment variables already set in the shell take precedence over .env.local.')
  process.exit(0)
}

await loadLocalEnv(new URL('../.env.local', import.meta.url))
const missing = []
if (!process.env.DATABASE_URL?.trim()) missing.push('DATABASE_URL')
if (!process.env.ADX_LEDGER_SIGNING_PRIVATE_KEY_PEM?.trim() && !process.env.ADX_LEDGER_SIGNING_PRIVATE_KEY_FILE?.trim()) missing.push('ADX_LEDGER_SIGNING_PRIVATE_KEY_FILE or ADX_LEDGER_SIGNING_PRIVATE_KEY_PEM')
if (!process.env.ADX_LEDGER_SIGNING_PUBLIC_KEY_PEM?.trim() && !process.env.ADX_LEDGER_SIGNING_PUBLIC_KEY_FILE?.trim()) missing.push('ADX_LEDGER_SIGNING_PUBLIC_KEY_FILE or ADX_LEDGER_SIGNING_PUBLIC_KEY_PEM')
if (missing.length) throw new Error(`API_START_CONFIGURATION_MISSING: Add ${missing.join(', ')} to .env.local or the shell environment.`)

for (const name of ['ADX_LEDGER_SIGNING_PRIVATE_KEY_FILE', 'ADX_LEDGER_SIGNING_PUBLIC_KEY_FILE']) {
  const value = process.env[name]
  if (!value?.trim()) continue
  try { await access(value) } catch { throw new Error(`API_START_KEY_FILE_UNREADABLE: ${name} does not reference a readable file.`) }
}

const port = Number(process.env.PORT ?? 3100)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('API_START_PORT_INVALID: PORT must be an integer between 1 and 65535.')
await assertPortAvailable(port)
console.log(`ADX API preflight passed. Starting on http://127.0.0.1:${port}`)
const runner = fileURLToPath(new URL('./run-adx-api-stage2.mjs', import.meta.url))
const child = spawn(process.execPath, [runner], { env: process.env, stdio: 'inherit' })
child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0) })

function assertPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', (error) => error.code === 'EADDRINUSE' ? reject(new Error(`API_START_PORT_IN_USE: Port ${port} is already in use. Stop the existing ADX API process, or start with PORT=<available-port> npm run api:start.`)) : reject(error))
    probe.listen(port, '127.0.0.1', () => probe.close(resolve))
  })
}