import { createServer } from 'node:http'
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { authorize, createAuthorizationSnapshot, InMemorySessionStore, TenantResourceStore } from '../../packages/identity/src/index.mjs'
import { createOidcVerifier } from './oidc.mjs'
import { createPkceTransaction, exchangeGoogleCode, googleAuthorizationUrl } from './oauth.mjs'
import { PostgresTenantRepository } from './postgres.mjs'
import { ChangeCaseError } from './change-case-ledger.mjs'
import { PostgresChangeCaseRepository } from './change-case-repository.mjs'

const ids = Object.freeze({ orgA: '11111111-1111-4111-8111-111111111111', orgB: '22222222-2222-4222-8222-222222222222', workspaceA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', workspaceB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', resourceA: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', resourceB: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' })
const alice = Object.freeze({ id: 'oidc:https://issuer.example:alice', type: 'human', issuer: 'https://issuer.example' })
const bob = Object.freeze({ id: 'oidc:https://issuer.example:bob', type: 'human', issuer: 'https://issuer.example' })
const approver = Object.freeze({ id: 'oidc:https://issuer.example:approver', type: 'human', issuer: 'https://issuer.example' })
const designReviewer = Object.freeze({ id: 'oidc:https://issuer.example:design-reviewer', type: 'human', issuer: 'https://issuer.example' })
const memberships = Object.freeze({ alice: [{ organizationId: ids.orgA, workspaceId: ids.workspaceA, roles: ['workspace_admin'], version: 1 }], approver: [{ organizationId: ids.orgA, workspaceId: ids.workspaceA, roles: ['workspace_admin'], version: 1 }], designReviewer: [{ organizationId: ids.orgA, workspaceId: ids.workspaceA, roles: ['reviewer'], version: 1 }], bob: [{ organizationId: ids.orgB, workspaceId: ids.workspaceB, roles: ['contributor'], version: 1 }] })
const sessions = new InMemorySessionStore()
const resources = new TenantResourceStore([
  { id: ids.resourceA, organizationId: ids.orgA, workspaceId: ids.workspaceA, type: 'demo-record', ownerId: alice.id, riskTier: 'R2', version: 1, label: 'Workspace A confidential record' },
  { id: ids.resourceB, organizationId: ids.orgB, workspaceId: ids.workspaceB, type: 'demo-record', ownerId: bob.id, riskTier: 'R2', version: 1, label: 'Workspace B confidential record' },
])
const auditEvents = []
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const verifyOidc = createOidcVerifier()
const postgres = process.env.DATABASE_URL ? new PostgresTenantRepository(process.env.DATABASE_URL) : null
const ledgerSigner = createLedgerSigner(process.env)
const changeCases = process.env.DATABASE_URL && ledgerSigner ? new PostgresChangeCaseRepository({ connectionString: process.env.DATABASE_URL, signer: ledgerSigner }) : null
const oauthTransactions = new Map()

function write(response, status, body, traceId) { response.statusCode = status; response.setHeader('content-type', 'application/json'); response.setHeader('cache-control', 'no-store'); response.setHeader('x-trace-id', traceId); response.end(JSON.stringify({ ...body, traceId })) }
function writeHtml(response, status, html, traceId) { response.statusCode = status; response.setHeader('content-type', 'text/html; charset=utf-8'); response.setHeader('cache-control', 'no-store'); response.setHeader('x-trace-id', traceId); response.end(html) }
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
function storyReviewPage(changeCase, governance) {
  const factors = governance.assessment?.explanation?.factors ?? []; const stories = governance.stories?.stories ?? []; const approvals = governance.approvals ?? []
  const nextAction = changeCase.state === 'AWAITING_STORY_APPROVAL' ? 'Review this exact story contract and record an independent decision.' : changeCase.state === 'DESIGN_REVIEW' ? 'Story contract approved. The next governed gate is design review.' : 'Complete the prior intake or risk-classification step before review.'
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ADX Story Review — ${escapeHtml(changeCase.title)}</title><style>body{margin:0;background:#f6f8fb;color:#172033;font:16px system-ui,sans-serif;line-height:1.5}main{max-width:960px;margin:auto;padding:32px 20px}header,.card{background:#fff;border:1px solid #dce3ee;border-radius:14px;padding:24px;margin:16px 0;box-shadow:0 2px 9px #14213d0a}.eyebrow{font-size:.75rem;letter-spacing:.12em;font-weight:700;color:#52657f}h1{margin:.2rem 0;font-size:2rem}.risk{display:inline-block;background:#fff2d9;color:#7b4600;font-weight:700;padding:5px 10px;border-radius:999px}h2{font-size:1.15rem;margin-top:0}dl{display:grid;grid-template-columns:max-content 1fr;gap:8px 18px}dt{font-weight:700;color:#52657f}ul,ol{padding-left:20px}.scenario{border-left:3px solid #3274c7;padding-left:12px;margin:12px 0}.next{background:#e9f4ff;border-color:#9dcef8}.muted{color:#52657f}code{font-size:.85em;overflow-wrap:anywhere}</style></head><body><main><header><p class="eyebrow">AUTHORITATIVE CHANGE CASE · STORY REVIEW</p><h1>${escapeHtml(changeCase.title)}</h1><p><span class="risk">${escapeHtml(changeCase.riskTier)} risk</span> <span class="muted">State: ${escapeHtml(changeCase.state)} · Version ${escapeHtml(changeCase.projectionVersion)}</span></p></header><section class="card next" aria-labelledby="next-action"><p class="eyebrow">ONE SAFE NEXT ACTION</p><h2 id="next-action">${escapeHtml(nextAction)}</h2><p>This screen shows retained facts and the exact story digest under review; it does not infer approval from a visual interaction.</p></section><section class="card"><p class="eyebrow">RETAINED INTENT</p><h2>What is being changed</h2><dl><dt>Outcome</dt><dd>${escapeHtml(governance.intent?.outcome ?? 'Not captured')}</dd><dt>Owner</dt><dd>${escapeHtml(governance.intent?.owner ?? 'Not captured')}</dd><dt>Acceptance criteria</dt><dd>${escapeHtml(governance.intent?.acceptanceCriteria ?? 'Not captured')}</dd><dt>Repository</dt><dd>${escapeHtml(governance.intent?.targetRepository ?? 'Not captured')}</dd><dt>Source</dt><dd>${governance.sources.map((source) => `${escapeHtml(source.sourceName)} <code>${escapeHtml(source.sourceDigest)}</code>`).join('<br>') || 'None retained'}</dd></dl></section><section class="card"><p class="eyebrow">RISK EXPLANATION</p><h2>${escapeHtml(governance.assessment?.riskTier ?? changeCase.riskTier)} effective risk</h2><p>${escapeHtml(governance.assessment?.explanation?.rationale ?? 'Classification is pending.')}</p><ul>${factors.map((factor) => `<li>${escapeHtml(factor.asset)} — ${escapeHtml(factor.classification)} (minimum risk weight ${escapeHtml(factor.weight)})</li>`).join('')}</ul></section><section class="card"><p class="eyebrow">BDD STORY CONTRACT · ${escapeHtml(governance.stories?.storyDigest ?? 'not generated')}</p><h2>Reviewable stories</h2>${stories.map((story) => `<article><h3>${escapeHtml(story.key)} — ${escapeHtml(story.title)}</h3><p>${escapeHtml(story.narrative)}</p>${story.scenarios.map((scenario) => `<div class="scenario"><strong>Given</strong> ${escapeHtml(scenario.given)}<br><strong>When</strong> ${escapeHtml(scenario.when)}<br><strong>Then</strong> ${escapeHtml(scenario.then)}</div>`).join('')}</article>`).join('') || '<p>No story revision is ready for review.</p>'}</section><section class="card"><p class="eyebrow">APPROVAL HISTORY</p><h2>Digest-bound decisions</h2><ul>${approvals.map((approval) => `<li><strong>${escapeHtml(approval.decision)}</strong> · ${escapeHtml(approval.status)} · <code>${escapeHtml(approval.storyDigest)}</code><br>${escapeHtml(approval.rationale)}</li>`).join('') || '<li>No decision has been recorded.</li>'}</ul></section></main></body></html>`
}
function bearer(request) { const value = request.headers.authorization; if (value?.startsWith('Bearer ')) return value.slice(7); return request.headers.cookie?.match(/(?:^|;\s*)adx_session=([^;]+)/)?.[1] ?? null }
async function sessionFor(request) {
  const token = bearer(request); const local = sessions.resolve(token)
  if (local || !verifyOidc || !token) return local
  try { return { principal: await verifyOidc(token), memberships: [] } } catch { return null }
}
function audit(event) { auditEvents.push(Object.freeze({ id: randomUUID(), at: new Date().toISOString(), ...event })) }
function workspaceResource(workspaceId, organizationId) { return { id: workspaceId, workspaceId, organizationId, type: 'workspace', version: 1, riskTier: 'R0' } }
function publicResource(resource) { return { id: resource.id, workspaceId: resource.workspaceId, type: resource.type, riskTier: resource.riskTier, version: resource.version, label: resource.label } }
function readJson(request) { return new Promise((resolve) => { let data = ''; request.on('data', (chunk) => { data += chunk }); request.on('end', () => { try { resolve(data ? JSON.parse(data) : {}) } catch { resolve(null) } }) }) }
function createLedgerSigner(env) {
  const keyFile = (file) => readFileSync(isAbsolute(file) ? file : resolve(repositoryRoot, file), 'utf8')
  const privatePem = env.ADX_LEDGER_SIGNING_PRIVATE_KEY_PEM ?? (env.ADX_LEDGER_SIGNING_PRIVATE_KEY_FILE ? keyFile(env.ADX_LEDGER_SIGNING_PRIVATE_KEY_FILE) : null)
  const publicPem = env.ADX_LEDGER_SIGNING_PUBLIC_KEY_PEM ?? (env.ADX_LEDGER_SIGNING_PUBLIC_KEY_FILE ? keyFile(env.ADX_LEDGER_SIGNING_PUBLIC_KEY_FILE) : null)
  if (privatePem) {
    const privateKey = createPrivateKey(privatePem)
    return { keyId: env.ADX_LEDGER_SIGNING_KEY_ID ?? 'adx-ledger-default', privateKey, publicKey: publicPem ? createPublicKey(publicPem) : createPublicKey(privateKey) }
  }
  if (env.ADX_TEST_AUTH === '1') { const keys = generateKeyPairSync('ed25519'); return { keyId: 'adx-test-ledger-ed25519', ...keys } }
  return null
}
function changeCaseResource(changeCase, scope) { return { id: changeCase.id, organizationId: scope.organizationId, workspaceId: scope.workspaceId, type: 'change-case', version: changeCase.projectionVersion, riskTier: changeCase.riskTier } }
function commandError(response, error, traceId) {
  if (error instanceof ChangeCaseError) return write(response, error.code === 'CHANGE_CASE_NOT_FOUND' ? 404 : error.code === 'VERSION_CONFLICT' || error.code === 'IDEMPOTENCY_KEY_REUSED' ? 409 : 400, { error: { code: error.code, message: error.message, retryable: error.retryable, severity: error.severity, correlationId: traceId, details: error.details } }, traceId)
  return write(response, 500, { error: { code: 'CHANGE_CASE_COMMAND_FAILED', message: 'The Change Case command could not be completed.', retryable: true, severity: 'error', correlationId: traceId, ...(process.env.ADX_TEST_AUTH === '1' ? { details: { cause: error instanceof Error ? error.message : String(error) } } : {}) } }, traceId)
}

function decisionFor({ session, resource, action }) {
  const decision = authorize({ principal: session.principal, memberships: session.memberships, resource, action })
  const membership = decision.membership ?? session.memberships.find((item) => item.workspaceId === resource.workspaceId && item.organizationId === resource.organizationId)
  const snapshot = createAuthorizationSnapshot({ principal: session.principal, membership, resource, action, decision })
  audit({ type: 'authorization.decision', snapshot })
  return decision
}

const server = createServer(async (request, response) => {
  const traceId = request.headers['x-trace-id'] || randomUUID()
  const url = new URL(request.url, 'http://adx.local')
  if (url.pathname === '/healthz') return write(response, 200, { status: 'ok', service: 'adx-api' }, traceId)
  if (url.pathname === '/readyz') return write(response, 200, { status: 'ready', dependencies: ['postgres', 'object-store', 'identity-provider'] }, traceId)
  if (request.method === 'GET' && url.pathname === '/auth/login') {
    if (!process.env.ADX_OIDC_AUDIENCE || !process.env.ADX_OIDC_REDIRECT_URI) return write(response, 503, { code: 'OIDC_NOT_CONFIGURED' }, traceId)
    const transaction = createPkceTransaction(); oauthTransactions.set(transaction.state, { ...transaction, expiresAt: Date.now() + 10 * 60_000 })
    response.statusCode = 302; response.setHeader('location', googleAuthorizationUrl({ clientId: process.env.ADX_OIDC_AUDIENCE, redirectUri: process.env.ADX_OIDC_REDIRECT_URI, transaction })); return response.end()
  }
  if (request.method === 'GET' && url.pathname === '/auth/callback') {
    const state = url.searchParams.get('state'); const code = url.searchParams.get('code'); const transaction = oauthTransactions.get(state)
    oauthTransactions.delete(state)
    if (!state || !code || !transaction || transaction.expiresAt < Date.now()) return write(response, 400, { code: 'OIDC_STATE_REJECTED' }, traceId)
    try {
      const tokens = await exchangeGoogleCode({ code, verifier: transaction.verifier, clientId: process.env.ADX_OIDC_AUDIENCE, clientSecret: process.env.ADX_OIDC_CLIENT_SECRET, redirectUri: process.env.ADX_OIDC_REDIRECT_URI })
      const principal = verifyOidc ? await verifyOidc(tokens.id_token) : null
      if (!principal) return write(response, 401, { code: 'OIDC_TOKEN_REJECTED' }, traceId)
      const knownMemberships = principal.id === alice.id ? memberships.alice : principal.id === bob.id ? memberships.bob : []
      const token = sessions.create(principal, knownMemberships); audit({ type: 'session.login', principalId: principal.id, provider: 'google' })
      response.statusCode = 302; response.setHeader('set-cookie', `adx_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600`); response.setHeader('location', '/v1/me'); return response.end()
    } catch { return write(response, 401, { code: 'OIDC_CALLBACK_REJECTED' }, traceId) }
  }
  if (process.env.ADX_TEST_AUTH === '1' && url.pathname === '/__test/session') {
    const actor = url.searchParams.get('as'); const principal = actor === 'alice' ? alice : actor === 'approver' ? approver : actor === 'designReviewer' ? designReviewer : actor === 'bob' ? bob : null
    if (!principal) return write(response, 400, { code: 'UNKNOWN_TEST_PRINCIPAL' }, traceId)
    const token = sessions.create(principal, memberships[actor]); audit({ type: 'session.login', principalId: principal.id, testOnly: true })
    return write(response, 201, { token, principal: { id: principal.id, type: principal.type } }, traceId)
  }
  const session = await sessionFor(request)
  if (!session) return write(response, 401, { code: 'AUTHENTICATION_REQUIRED', message: 'A valid OIDC-backed session is required.' }, traceId)
  if (request.method === 'GET' && url.pathname === '/v1/me') return write(response, 200, { principal: session.principal, memberships: session.memberships.map(({ organizationId, workspaceId, roles }) => ({ organizationId, workspaceId, roles })) }, traceId)

  const changeCaseListMatch = url.pathname.match(/^\/v1\/workspaces\/([0-9a-f-]+)\/change-cases$/i)
  if (changeCaseListMatch) {
    const workspaceId = changeCaseListMatch[1]; const membership = session.memberships.find((item) => item.workspaceId === workspaceId)
    if (!membership) return write(response, 403, { code: 'WORKSPACE_ACCESS_DENIED' }, traceId)
    if (!changeCases) return write(response, 503, { code: 'CHANGE_CASE_LEDGER_NOT_CONFIGURED' }, traceId)
    const scope = { organizationId: membership.organizationId, workspaceId: membership.workspaceId }
    const action = request.method === 'GET' ? 'workspace.read' : request.method === 'POST' ? 'workspace.manage' : null
    if (!action) return write(response, 405, { code: 'METHOD_NOT_ALLOWED' }, traceId)
    const decision = decisionFor({ session, resource: workspaceResource(workspaceId, membership.organizationId), action })
    if (decision.outcome !== 'ALLOW') return write(response, 403, { code: decision.reason }, traceId)
    if (request.method === 'GET') return write(response, 200, { changeCases: await changeCases.list(scope, { state: url.searchParams.get('state') ?? undefined, riskTier: url.searchParams.get('riskTier') ?? undefined }) }, traceId)
    const body = await readJson(request); const idempotencyKey = request.headers['idempotency-key']
    if (typeof body?.title !== 'string' || !body.title.trim() || !['R0','R1','R2','R3','R4'].includes(body.riskTier)) return write(response, 400, { error: { code: 'CHANGE_CASE_CREATE_INVALID', message: 'title and riskTier are required.', retryable: false, severity: 'warning', correlationId: traceId } }, traceId)
    try { const result = await changeCases.create({ scope, principal: session.principal, title: body.title.trim(), riskTier: body.riskTier, idempotencyKey, correlationId: traceId }); return write(response, result.deduplicated ? 200 : 201, result, traceId) } catch (error) { return commandError(response, error, traceId) }
  }

  const changeCaseMatch = url.pathname.match(/^\/v1\/workspaces\/([0-9a-f-]+)\/change-cases\/([0-9a-f-]+)(?:\/(timeline|draft|transitions|intake|classify|stories|story-decision|governance|story-review|design|design-decision))?$/i)
  if (changeCaseMatch) {
    const [, workspaceId, changeCaseId, operation] = changeCaseMatch; const membership = session.memberships.find((item) => item.workspaceId === workspaceId)
    if (!membership) return write(response, 403, { code: 'WORKSPACE_ACCESS_DENIED' }, traceId)
    if (!changeCases) return write(response, 503, { code: 'CHANGE_CASE_LEDGER_NOT_CONFIGURED' }, traceId)
    const scope = { organizationId: membership.organizationId, workspaceId: membership.workspaceId }
    const current = await changeCases.get(scope, changeCaseId)
    if (!current) return write(response, 404, { code: 'CHANGE_CASE_NOT_FOUND' }, traceId)
    const action = request.method === 'GET' ? 'resource.read' : operation === 'design-decision' ? 'resource.review' : 'resource.write'
    const decision = decisionFor({ session, resource: changeCaseResource(current, scope), action })
    if (decision.outcome !== 'ALLOW') return write(response, 403, { code: decision.reason }, traceId)
    if (request.method === 'GET' && !operation) return write(response, 200, { changeCase: current }, traceId)
    if (request.method === 'GET' && operation === 'timeline') return write(response, 200, { events: await changeCases.timeline(scope, changeCaseId) }, traceId)
    if (request.method === 'GET' && operation === 'governance') return write(response, 200, await changeCases.intakeView(scope, changeCaseId), traceId)
    if (request.method === 'GET' && operation === 'design') return write(response, 200, await changeCases.designView(scope, changeCaseId), traceId)
    if (request.method === 'GET' && operation === 'story-review') return writeHtml(response, 200, storyReviewPage(current, await changeCases.intakeView(scope, changeCaseId)), traceId)
    const body = await readJson(request); const idempotencyKey = request.headers['idempotency-key']
    try {
      if (request.method === 'POST' && operation === 'draft' && typeof body?.title === 'string') return write(response, 200, await changeCases.editDraft({ scope, principal: session.principal, changeCaseId, title: body.title.trim(), expectedVersion: body.expectedVersion, idempotencyKey, correlationId: traceId }), traceId)
      if (request.method === 'POST' && operation === 'transitions' && typeof body?.toState === 'string') return write(response, 200, await changeCases.transition({ scope, principal: session.principal, changeCaseId, toState: body.toState, expectedVersion: body.expectedVersion, idempotencyKey, correlationId: traceId }), traceId)
      if (request.method === 'POST' && operation === 'intake') return write(response, 200, await changeCases.captureIntent({ scope, principal: session.principal, changeCaseId, intent: body?.intent, expectedVersion: body?.expectedVersion, idempotencyKey, correlationId: traceId }), traceId)
      if (request.method === 'POST' && operation === 'classify') return write(response, 200, await changeCases.classifyIntake({ scope, principal: session.principal, changeCaseId, expectedVersion: body?.expectedVersion, idempotencyKey, correlationId: traceId }), traceId)
      if (request.method === 'POST' && operation === 'stories') return write(response, 200, await changeCases.generateStories({ scope, principal: session.principal, changeCaseId, stories: body?.stories, expectedVersion: body?.expectedVersion, idempotencyKey, correlationId: traceId }), traceId)
      if (request.method === 'POST' && operation === 'story-decision') return write(response, 200, await changeCases.decideStories({ scope, principal: session.principal, changeCaseId, storyDigest: body?.storyDigest, decision: body?.decision, rationale: body?.rationale, expectedVersion: body?.expectedVersion, idempotencyKey, correlationId: traceId }), traceId)
      if (request.method === 'POST' && operation === 'design') return write(response, 200, await changeCases.captureDesign({ scope, principal: session.principal, changeCaseId, design: body?.design, expectedVersion: body?.expectedVersion, idempotencyKey, correlationId: traceId }), traceId)
      if (request.method === 'POST' && operation === 'design-decision') return write(response, 200, await changeCases.decideDesign({ scope, principal: session.principal, changeCaseId, designDigest: body?.designDigest, decision: body?.decision, rationale: body?.rationale, expectedVersion: body?.expectedVersion, idempotencyKey, correlationId: traceId }), traceId)
      return write(response, 400, { error: { code: 'CHANGE_CASE_COMMAND_INVALID', message: 'The Change Case command is invalid.', retryable: false, severity: 'warning', correlationId: traceId } }, traceId)
    } catch (error) { return commandError(response, error, traceId) }
  }

  const listMatch = url.pathname.match(/^\/v1\/workspaces\/([0-9a-f-]+)\/resources$/i)
  if (request.method === 'GET' && listMatch) {
    const workspaceId = listMatch[1]; const membership = session.memberships.find((item) => item.workspaceId === workspaceId)
    if (!membership) return write(response, 403, { code: 'WORKSPACE_ACCESS_DENIED' }, traceId)
    const decision = decisionFor({ session, resource: workspaceResource(workspaceId, membership.organizationId), action: 'workspace.read' })
    if (decision.outcome !== 'ALLOW') return write(response, 403, { code: decision.reason }, traceId)
    const scopedResources = postgres ? await postgres.listResources(membership) : resources.listScoped(membership).map(publicResource)
    return write(response, 200, { resources: scopedResources }, traceId)
  }
  const resourceMatch = url.pathname.match(/^\/v1\/workspaces\/([0-9a-f-]+)\/resources\/([0-9a-f-]+)$/i)
  if (resourceMatch) {
    const [, workspaceId, resourceId] = resourceMatch; const membership = session.memberships.find((item) => item.workspaceId === workspaceId)
    if (!membership) return write(response, 403, { code: 'WORKSPACE_ACCESS_DENIED' }, traceId)
    const resource = resources.getScoped(resourceId, membership)
    if (!resource) return write(response, 404, { code: 'RESOURCE_NOT_FOUND' }, traceId)
    const action = request.method === 'GET' ? 'resource.read' : request.method === 'PATCH' ? 'resource.write' : null
    if (!action) return write(response, 405, { code: 'METHOD_NOT_ALLOWED' }, traceId)
    const decision = decisionFor({ session, resource, action })
    if (decision.outcome !== 'ALLOW') return write(response, 403, { code: decision.reason }, traceId)
    if (action === 'resource.read') return write(response, 200, { resource: publicResource(resource) }, traceId)
    const body = await readJson(request); if (typeof body?.label !== 'string' || !body.label.trim()) return write(response, 400, { code: 'LABEL_REQUIRED' }, traceId)
    const updated = { ...resource, label: body.label.trim(), version: resource.version + 1 }; resources.put(updated)
    audit({ type: 'resource.updated', resourceId: resource.id, authorization: createAuthorizationSnapshot({ principal: session.principal, membership: decision.membership, resource: updated, action, decision }) })
    return write(response, 200, { resource: publicResource(updated) }, traceId)
  }
  return write(response, 404, { code: 'NOT_FOUND' }, traceId)
})

server.listen(process.env.PORT || 3100, '127.0.0.1', () => console.log(JSON.stringify({ service: 'adx-api', event: 'listening', traceId: randomUUID() })))
