import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { resolve } from 'node:path'

const port = 3201
const entrypoint = resolve('apps/tanstack-start-canary/.output/server/index.mjs')
const child = spawn(process.execPath, [entrypoint], {
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let output = ''
child.stdout.on('data', (chunk) => { output += chunk })
child.stderr.on('data', (chunk) => { output += chunk })

try {
  await Promise.race([
    once(child.stdout, 'data'),
    once(child, 'exit').then(([code]) => Promise.reject(new Error(`Canary exited early (${code}): ${output}`))),
  ])

  const response = await fetch(`http://127.0.0.1:${port}/`)
  const html = await response.text()
  if (response.status !== 200) throw new Error(`Expected 200, received ${response.status}`)
  if (!html.includes('ADX TanStack Start compatibility canary')) throw new Error('Canary heading is missing')
  if (!html.includes('data-testid="readiness">ready')) throw new Error('Readiness marker is missing')
  if (!/data-testid="trace-id">[0-9a-f-]{36}/.test(html)) throw new Error('Trace identifier is missing')
  console.log('TanStack Start runtime smoke passed: SSR response, readiness, and trace identifier verified.')
} finally {
  child.kill('SIGTERM')
  await Promise.race([once(child, 'exit'), new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000))])
}
