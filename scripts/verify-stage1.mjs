import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { AuthorizationDecisionCache, authorize, capabilitiesFor, mapVerifiedOidcClaims } from '../packages/identity/src/index.mjs'

const ids = { orgA: '11111111-1111-4111-8111-111111111111', orgB: '22222222-2222-4222-8222-222222222222', workspaceA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', workspaceB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', resourceA: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', resourceB: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }
const alice = { id: 'oidc:https://issuer.example:alice', type: 'human', issuer: 'https://issuer.example' }
const memberships = [{ organizationId: ids.orgA, workspaceId: ids.workspaceA, roles: ['workspace_admin'], version: 1 }]
const resourceA = { id: ids.resourceA, organizationId: ids.orgA, workspaceId: ids.workspaceA, type: 'record', ownerId: alice.id, riskTier: 'R2', version: 1 }
const resourceB = { ...resourceA, id: ids.resourceB, organizationId: ids.orgB, workspaceId: ids.workspaceB }

assert.deepEqual(capabilitiesFor(['contributor']), ['resource.read', 'resource.write', 'workspace.read'])
assert.equal(authorize({ principal: alice, memberships, resource: resourceA, action: 'resource.read' }).outcome, 'ALLOW')
assert.equal(authorize({ principal: alice, memberships, resource: resourceB, action: 'resource.read' }).outcome, 'DENY')
assert.equal(authorize({ principal: alice, memberships, resource: resourceA, action: 'release.execute' }).outcome, 'DENY')
assert.equal(mapVerifiedOidcClaims({ iss: 'https://issuer.example', aud: 'adx-api', sub: 'alice', exp: Math.floor(Date.now() / 1000) + 60 }, { issuer: 'https://issuer.example', audience: 'adx-api' }).id, alice.id)
assert.throws(() => mapVerifiedOidcClaims({ iss: 'wrong', aud: 'adx-api', sub: 'alice' }, { issuer: 'https://issuer.example', audience: 'adx-api' }))
const cache = new AuthorizationDecisionCache(); cache.set({ principal: alice, resource: resourceA, action: 'resource.read', membershipVersion: 1 }, { outcome: 'ALLOW' }); assert.ok(cache.get({ principal: alice, resource: resourceA, action: 'resource.read', membershipVersion: 1 })); cache.invalidateWorkspace(ids.workspaceA); assert.equal(cache.get({ principal: alice, resource: resourceA, action: 'resource.read', membershipVersion: 1 }), null)

const port = 3103
// Stage 1 proves the authorization boundary using its deterministic in-memory
// tenant fixture. CI also supplies DATABASE_URL for later Stage 2 ledger
// checks, but Stage 1 runs before migrations and must not try to query an
// uninitialized database.
const stage1Env = { ...process.env, PORT: String(port), ADX_TEST_AUTH: '1' }
delete stage1Env.DATABASE_URL
const api = spawn(process.execPath, [resolve('apps/adx-api/server.mjs')], { env: stage1Env, stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''; api.stdout.on('data', (data) => { output += data }); api.stderr.on('data', (data) => { output += data })
try {
  await Promise.race([once(api.stdout, 'data'), once(api, 'exit').then(([code]) => Promise.reject(new Error(`API exited early (${code}): ${output}`)))])
  const base = `http://127.0.0.1:${port}`
  const health = await fetch(`${base}/healthz`)
  assert.equal(health.status, 200, `API health check failed: ${await health.text()}`)
  const session = await (await fetch(`${base}/__test/session?as=alice`)).json()
  const headers = { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' }
  const ownList = await fetch(`${base}/v1/workspaces/${ids.workspaceA}/resources`, { headers }); assert.equal(ownList.status, 200); assert.equal((await ownList.json()).resources[0].id, ids.resourceA)
  const forbiddenWorkspace = await fetch(`${base}/v1/workspaces/${ids.workspaceB}/resources`, { headers }); assert.equal(forbiddenWorkspace.status, 403)
  const directObjectReference = await fetch(`${base}/v1/workspaces/${ids.workspaceA}/resources/${ids.resourceB}`, { headers }); assert.equal(directObjectReference.status, 404)
  const mutationBypass = await fetch(`${base}/v1/workspaces/${ids.workspaceB}/resources/${ids.resourceB}`, { method: 'PATCH', headers, body: JSON.stringify({ label: 'attempted cross-tenant write' }) }); assert.equal(mutationBypass.status, 403)
  for (const path of ['/v1/search?q=Workspace%20B', '/v1/cache/resources', `/v1/exports/${ids.resourceB}`, `/v1/object-store/${ids.resourceB}`, '/v1/events', '/v1/webhooks']) {
    const response = await fetch(`${base}${path}`, { headers }); const body = await response.text(); assert.notEqual(response.status, 200, `${path} unexpectedly returned success`); assert.ok(!body.includes('Workspace B confidential record'), `${path} leaked a tenant resource`)
  }
  console.log('Stage 1 policy, OIDC-claim mapping, tenant isolation, direct-object-reference, bulk/search/cache/object/export/event/webhook negative-path verification passed.')
} finally { api.kill('SIGTERM'); await Promise.race([once(api, 'exit'), new Promise((done) => setTimeout(done, 2_000))]) }
