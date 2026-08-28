import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import pg from 'pg'
import { loadLocalEnv } from './load-local-env.mjs'

await loadLocalEnv()
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED_FOR_STAGE4_API_VERIFICATION')
const workspace = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; const port = 3110
const api = spawn(process.execPath, [resolve('apps/adx-api/server.mjs')], { env: { ...process.env, PORT: String(port), ADX_TEST_AUTH: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''; api.stdout.on('data', (data) => { output += data }); api.stderr.on('data', (data) => { output += data })
const read = async (response) => ({ status: response.status, body: await response.json() })
const design = (suffix) => ({ architectureDecision: { decision: `bounded API ${suffix}` }, interfaceDelta: { changes: [`POST /design/${suffix}`] }, migrationPlan: { steps: ['migrate safely'] }, threatModel: { threats: [{ id: 'T1', mitigation: 'authorize', residualRisk: 'low' }] }, dependencies: { items: [{ name: 'pg', license: 'MIT' }] }, testStrategy: { layers: ['unit', 'integration', 'browser'] } })
const story = [{ key: 'STORY-DESIGN', title: 'Review a design package', narrative: 'As a reviewer, I need a digest-bound design package before execution.', scenarios: [{ given: 'a classified Change Case', when: 'design is submitted', then: 'an independent reviewer can approve it' }] }]
try {
  await Promise.race([once(api.stdout, 'data'), once(api, 'exit').then(([code]) => Promise.reject(new Error(`API exited early (${code}): ${output}`)))])
  const base = `http://127.0.0.1:${port}`
  const session = async (as) => (await read(await fetch(`${base}/__test/session?as=${as}`))).body.token
  const alice = await session('alice'); const approver = await session('approver'); const reviewer = await session('designReviewer'); const authorReviewer = await session('designAuthorReviewer'); const contributor = await session('designContributor')
  const headers = (token, key) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': key })
  const post = async (token, route, payload, key) => read(await fetch(`${base}${route}`, { method: 'POST', headers: headers(token, key ?? `stage4-${randomUUID()}`), body: JSON.stringify(payload) }))
  const created = await post(alice, `/v1/workspaces/${workspace}/change-cases`, { title: 'Design gate proof', riskTier: 'R2' }); assert.equal(created.status, 201)
  const id = created.body.changeCaseId; let version = created.body.projectionVersion
  version = (await post(alice, `/v1/workspaces/${workspace}/change-cases/${id}/transitions`, { toState: 'INTAKE', expectedVersion: version })).body.projectionVersion
  version = (await post(alice, `/v1/workspaces/${workspace}/change-cases/${id}/intake`, { expectedVersion: version, intent: { outcome: 'Deliver governed design review', owner: 'Platform Security', acceptanceCriteria: 'A reviewer can inspect the retained design and recorded residual risk before execution.', targetRepository: 'adx-api', assets: [{ name: 'internal contract', classification: 'internal' }], sourceContent: 'STG-005 retained source', sourceName: 'stage4.md' } })).body.projectionVersion
  version = (await post(alice, `/v1/workspaces/${workspace}/change-cases/${id}/classify`, { expectedVersion: version })).body.projectionVersion
  const stories = await post(alice, `/v1/workspaces/${workspace}/change-cases/${id}/stories`, { expectedVersion: version, stories: story }); version = stories.body.projectionVersion
  const storyDecision = await post(approver, `/v1/workspaces/${workspace}/change-cases/${id}/story-decision`, { expectedVersion: version, storyDigest: stories.body.storyDigest, decision: 'APPROVED', rationale: 'Story contract is testable.' }); assert.equal(storyDecision.status, 200); version = storyDecision.body.projectionVersion
  const bypass = await post(alice, `/v1/workspaces/${workspace}/change-cases/${id}/transitions`, { toState: 'READY_FOR_EXECUTION', expectedVersion: version }); assert.equal(bypass.status, 400); assert.equal(bypass.body.error.code, 'DESIGN_PACKAGE_REQUIRED')
  const captured = await post(authorReviewer, `/v1/workspaces/${workspace}/change-cases/${id}/design`, { expectedVersion: version, design: design('one') }); assert.equal(captured.status, 200); const digest1 = captured.body.designDigest; version = captured.body.projectionVersion
  const nonReviewer = await post(contributor, `/v1/workspaces/${workspace}/change-cases/${id}/design-decision`, { expectedVersion: version, designDigest: digest1, decision: 'APPROVED', rationale: 'not a reviewer' }); assert.equal(nonReviewer.status, 403); assert.equal(nonReviewer.body.code, 'CAPABILITY_MISSING')
  const selfApproval = await post(authorReviewer, `/v1/workspaces/${workspace}/change-cases/${id}/design-decision`, { expectedVersion: version, designDigest: digest1, decision: 'APPROVED', rationale: 'self review' }); assert.equal(selfApproval.status, 400); assert.equal(selfApproval.body.error.code, 'APPROVAL_SEPARATION_REQUIRED')
  const approved = await post(reviewer, `/v1/workspaces/${workspace}/change-cases/${id}/design-decision`, { expectedVersion: version, designDigest: digest1, decision: 'APPROVED', rationale: 'Architecture, threat model, and test strategy are adequate.' }); assert.equal(approved.status, 200); assert.equal(approved.body.newState, 'READY_FOR_EXECUTION'); version = approved.body.projectionVersion
  const revised = await post(alice, `/v1/workspaces/${workspace}/change-cases/${id}/design`, { expectedVersion: version, design: design('two') }); assert.equal(revised.status, 200); const digest2 = revised.body.designDigest; version = revised.body.projectionVersion
  const view = await read(await fetch(`${base}/v1/workspaces/${workspace}/change-cases/${id}/design`, { headers: { authorization: `Bearer ${alice}` } })); assert.equal(view.status, 200); assert.ok(view.body.approvals.some((approval) => approval.designDigest === digest1 && approval.status === 'INVALIDATED'))
  const exception = await post(alice, `/v1/workspaces/${workspace}/change-cases/${id}/design-exception`, { expectedVersion: version, designDigest: digest2, reason: 'Temporary third-party review evidence is pending.', expiresAt: new Date(Date.now() + 60_000).toISOString() }); assert.equal(exception.status, 200); version = exception.body.projectionVersion
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
  try { await pool.query("UPDATE adx_design_exception SET expires_at=now()-interval '1 minute' WHERE change_case_id=$1 AND design_digest=$2", [id, digest2]) } finally { await pool.end() }
  const expired = await post(reviewer, `/v1/workspaces/${workspace}/change-cases/${id}/design-decision`, { expectedVersion: version, designDigest: digest2, decision: 'APPROVED', rationale: 'This must be blocked by expiry.' }); assert.equal(expired.status, 400); assert.equal(expired.body.error.code, 'DESIGN_EXCEPTION_EXPIRED')
  const current = await post(alice, `/v1/workspaces/${workspace}/change-cases/${id}/design`, { expectedVersion: version, design: design('three') }); const digest3 = current.body.designDigest; version = current.body.projectionVersion
  const finalApproval = await post(reviewer, `/v1/workspaces/${workspace}/change-cases/${id}/design-decision`, { expectedVersion: version, designDigest: digest3, decision: 'APPROVED', rationale: 'Current digest has an independent review and no expired exception.' }); assert.equal(finalApproval.status, 200); assert.equal(finalApproval.body.newState, 'READY_FOR_EXECUTION')
  console.log('Stage 4 API verification passed: package gate, reviewer role, separation of duty, expiry block, digest invalidation, and execution readiness.')
} finally { api.kill('SIGTERM'); await Promise.race([once(api, 'exit'), new Promise((done) => setTimeout(done, 2_000))]) }
