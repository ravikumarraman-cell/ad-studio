import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const port = 3102
const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const child = spawn(process.execPath, [resolve(repositoryRoot, 'apps/adx-api/server.mjs')], {
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let output = ''
child.stdout.on('data', (chunk) => { output += chunk })
child.stderr.on('data', (chunk) => { output += chunk })

try {
  await Promise.race([
    once(child.stdout, 'data'),
    once(child, 'exit').then(([code]) => Promise.reject(new Error(`API exited early (${code}): ${output}`))),
  ])
  const traceId = 'stage0-smoke-trace'
  const healthResponse = await fetch(`http://127.0.0.1:${port}/healthz`, { headers: { 'x-trace-id': traceId } })
  const health = await healthResponse.json()
  const readinessResponse = await fetch(`http://127.0.0.1:${port}/readyz`, { headers: { 'x-trace-id': traceId } })
  const readiness = await readinessResponse.json()
  if (!healthResponse.ok || health.status !== 'ok' || healthResponse.headers.get('x-trace-id') !== traceId) throw new Error('Health or trace-correlation check failed')
  if (!readinessResponse.ok || readiness.status !== 'ready' || readinessResponse.headers.get('x-trace-id') !== traceId) throw new Error('Readiness or trace-correlation check failed')
  console.log('Stage 0 API health, readiness, and trace-correlation smoke passed.')
} finally {
  child.kill('SIGTERM')
  await Promise.race([once(child, 'exit'), new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000))])
}
