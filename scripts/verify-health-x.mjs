import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { resolve } from 'node:path'

const port = 3210
const server = spawn(process.execPath, [resolve('apps/health-x/.output/server/index.mjs')], {
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let output = ''
server.stdout.on('data', (chunk) => { output += chunk })
server.stderr.on('data', (chunk) => { output += chunk })

try {
  await Promise.race([
    once(server.stdout, 'data'),
    once(server, 'exit').then(([code]) => Promise.reject(new Error(`Health-X exited early (${code}): ${output}`))),
  ])

  const response = await fetch(`http://127.0.0.1:${port}/`)
  const html = await response.text()
  const requiredContent = ['Health-X', 'Your appointment', 'Medication', 'Care plan', 'fictional data']
  const missing = requiredContent.filter((content) => !html.includes(content))
  if (!response.ok || missing.length) throw new Error(`Health-X smoke failed: status=${response.status}; missing=${missing.join(', ')}`)
  console.log('Health-X production smoke passed: shell, three feature surfaces, and fictional-data boundary rendered.')
} finally {
  server.kill('SIGTERM')
  await Promise.race([once(server, 'exit'), new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000))])
}