import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { loadLocalEnv } from './load-local-env.mjs'

await loadLocalEnv()
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED_FOR_STAGE2_API_VERIFICATION')
const ids = { workspaceA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', workspaceB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }
const port = 3106
const api = spawn(process.execPath, [resolve('apps/adx-api/server.mjs')], { env: { ...process.env, PORT: String(port), ADX_TEST_AUTH: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''; api.stdout.on('data', (data) => { output += data }); api.stderr.on('data', (data) => { output += data })
const json = async (response) => ({ status: response.status, body: await response.json() })

try {
  await Promise.race([once(api.stdout, 'data'), once(api, 'exit').then(([code]) => Promise.reject(new Error(`API exited early (${code}): ${output}`)))])
  const base = `http://127.0.0.1:${port}`
  const alice = await json(await fetch(`${base}/__test/session?as=alice`)); const bob = await json(await fetch(`${base}/__test/session?as=bob`))
  const headers = { authorization: `Bearer ${alice.body.token}`, 'content-type': 'application/json', 'idempotency-key': `stage2-api-create-${randomUUID()}` }
  const create = await json(await fetch(`${base}/v1/workspaces/${ids.workspaceA}/change-cases`, { method: 'POST', headers, body: JSON.stringify({ title: 'API Change Case', riskTier: 'R2' }) }))
  assert.equal(create.status, 201); assert.equal(create.body.newState, 'DRAFT'); assert.ok(create.body.commandId); assert.ok(create.body.correlationId)
  const duplicate = await json(await fetch(`${base}/v1/workspaces/${ids.workspaceA}/change-cases`, { method: 'POST', headers, body: JSON.stringify({ title: 'API Change Case', riskTier: 'R2' }) }))
  assert.equal(duplicate.status, 200); assert.equal(duplicate.body.changeCaseId, create.body.changeCaseId); assert.equal(duplicate.body.deduplicated, true)
  const listed = await json(await fetch(`${base}/v1/workspaces/${ids.workspaceA}/change-cases`, { headers: { authorization: `Bearer ${alice.body.token}` } }))
  assert.equal(listed.status, 200); assert.ok(listed.body.changeCases.some((item) => item.id === create.body.changeCaseId))
  const stale = await json(await fetch(`${base}/v1/workspaces/${ids.workspaceA}/change-cases/${create.body.changeCaseId}/draft`, { method: 'POST', headers: { ...headers, 'idempotency-key': `stage2-api-stale-${randomUUID()}` }, body: JSON.stringify({ title: 'Stale', expectedVersion: 0 }) }))
  assert.equal(stale.status, 409); assert.equal(stale.body.error.code, 'VERSION_CONFLICT')
  const edit = await json(await fetch(`${base}/v1/workspaces/${ids.workspaceA}/change-cases/${create.body.changeCaseId}/draft`, { method: 'POST', headers: { ...headers, 'idempotency-key': `stage2-api-edit-${randomUUID()}` }, body: JSON.stringify({ title: 'API Change Case edited', expectedVersion: 1 }) }))
  assert.equal(edit.status, 200); assert.equal(edit.body.projectionVersion, 2)
  const transition = await json(await fetch(`${base}/v1/workspaces/${ids.workspaceA}/change-cases/${create.body.changeCaseId}/transitions`, { method: 'POST', headers: { ...headers, 'idempotency-key': `stage2-api-transition-${randomUUID()}` }, body: JSON.stringify({ toState: 'INTAKE', expectedVersion: 2 }) }))
  assert.equal(transition.status, 200); assert.equal(transition.body.newState, 'INTAKE')
  const timeline = await json(await fetch(`${base}/v1/workspaces/${ids.workspaceA}/change-cases/${create.body.changeCaseId}/timeline`, { headers: { authorization: `Bearer ${alice.body.token}` } }))
  assert.equal(timeline.status, 200); assert.equal(timeline.body.events.length, 3)
  const crossTenant = await fetch(`${base}/v1/workspaces/${ids.workspaceB}/change-cases/${create.body.changeCaseId}`, { headers: { authorization: `Bearer ${bob.body.token}` } })
  assert.equal(crossTenant.status, 404)
  console.log('Stage 2 tenant-authorized Change Case API command, query, idempotency, conflict, timeline, and cross-tenant verification passed.')
} finally { api.kill('SIGTERM'); await Promise.race([once(api, 'exit'), new Promise((done) => setTimeout(done, 2_000))]) }
