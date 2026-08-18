import { createHash, randomUUID } from 'node:crypto'

export const POLICY_VERSION = 'adx-authz-1'

export const roleCapabilities = Object.freeze({
  workspace_admin: ['workspace.read', 'workspace.manage', 'member.manage', 'resource.read', 'resource.write', 'resource.approve_high_risk', 'audit.read'],
  contributor: ['workspace.read', 'resource.read', 'resource.write'],
  reviewer: ['workspace.read', 'resource.read', 'resource.review', 'audit.read'],
  auditor: ['workspace.read', 'resource.read', 'audit.read'],
  read_projection: ['workspace.read', 'resource.read'],
  workflow_command: ['workspace.read', 'resource.read', 'resource.write'],
  evidence_writer: ['workspace.read', 'resource.read', 'evidence.write'],
  verifier: ['workspace.read', 'resource.read', 'resource.review'],
  release_controller: ['workspace.read', 'resource.read', 'release.execute'],
})

const highRisk = new Set(['R3', 'R4'])
const opaqueId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isOpaqueId(value) { return typeof value === 'string' && opaqueId.test(value) }

export function capabilitiesFor(roles) {
  return [...new Set(roles.flatMap((role) => roleCapabilities[role] ?? []))].sort()
}

export function mapVerifiedOidcClaims(claims, { issuer, audience, now = Date.now() }) {
  if (!claims || claims.iss !== issuer || !audienceIncludes(claims.aud, audience)) throw new Error('OIDC_CLAIMS_REJECTED')
  if (!claims.sub || (claims.exp && claims.exp * 1000 <= now)) throw new Error('OIDC_CLAIMS_REJECTED')
  return Object.freeze({ id: `oidc:${claims.iss}:${claims.sub}`, type: 'human', displayName: claims.name ?? claims.preferred_username ?? 'Authenticated user', issuer: claims.iss, subject: claims.sub })
}

function audienceIncludes(aud, expected) { return Array.isArray(aud) ? aud.includes(expected) : aud === expected }

export function createAuthorizationSnapshot({ principal, membership, resource, action, decision, now = new Date().toISOString() }) {
  return Object.freeze({
    decisionId: randomUUID(), policyVersion: POLICY_VERSION, at: now, action,
    principal: { id: principal.id, type: principal.type, issuer: principal.issuer ?? 'service' },
    membership: membership ? { organizationId: membership.organizationId, workspaceId: membership.workspaceId, roles: [...membership.roles].sort(), version: membership.version } : null,
    resource: resource ? { id: resource.id, organizationId: resource.organizationId, workspaceId: resource.workspaceId, type: resource.type, version: resource.version } : null,
    outcome: decision.outcome, reason: decision.reason,
  })
}

/** Server-authoritative, deny-by-default RBAC + ABAC decision point. */
export function authorize({ principal, memberships, resource, action, context = {} }) {
  const deny = (reason) => ({ outcome: 'DENY', reason })
  if (!principal?.id || !resource || !action) return deny('AUTHENTICATION_OR_RESOURCE_MISSING')
  if (!isOpaqueId(resource.id) || !isOpaqueId(resource.organizationId) || !isOpaqueId(resource.workspaceId)) return deny('RESOURCE_IDENTIFIER_INVALID')
  const membership = memberships.find((item) => item.workspaceId === resource.workspaceId && item.organizationId === resource.organizationId && !item.expiresAt)
  if (!membership) return deny('WORKSPACE_MEMBERSHIP_REQUIRED')
  const capabilities = capabilitiesFor(membership.roles)
  if (!capabilities.includes(action)) return deny('CAPABILITY_MISSING')
  if (resource.ownerId && resource.ownerId === principal.id && context.separationOfDutyAction && action === context.separationOfDutyAction) return deny('SEPARATION_OF_DUTY')
  if (highRisk.has(resource.riskTier) && action === 'resource.write' && !capabilities.includes('resource.approve_high_risk') && resource.ownerId !== principal.id) return deny('HIGH_RISK_RELATIONSHIP_REQUIRED')
  if (principal.type === 'human' && action === 'release.execute') return deny('SERVICE_IDENTITY_REQUIRED')
  return { outcome: 'ALLOW', reason: 'POLICY_SATISFIED', membership, capabilities }
}

export class AuthorizationDecisionCache {
  #entries = new Map()
  constructor({ ttlMs = 30_000 } = {}) { this.ttlMs = ttlMs }
  get(input) {
    const key = cacheKey(input); const item = this.#entries.get(key)
    if (!item || item.expiresAt <= Date.now()) { this.#entries.delete(key); return null }
    return item.value
  }
  set(input, value) { this.#entries.set(cacheKey(input), { value, expiresAt: Date.now() + this.ttlMs }); return value }
  invalidateWorkspace(workspaceId) { for (const key of this.#entries.keys()) if (key.includes(`|${workspaceId}|`)) this.#entries.delete(key) }
  clear() { this.#entries.clear() }
}

function cacheKey({ principal, resource, action, membershipVersion = 0, policyVersion = POLICY_VERSION }) {
  return `${policyVersion}|${principal.id}|${resource.workspaceId}|${resource.id}|${resource.version}|${membershipVersion}|${action}`
}

export class InMemorySessionStore {
  #sessions = new Map()
  create(principal, memberships, { ttlMs = 60 * 60 * 1000 } = {}) {
    const token = randomUUID() + randomUUID().replaceAll('-', '')
    const record = Object.freeze({ principal, memberships: memberships.map((item) => Object.freeze({ ...item, roles: [...item.roles] })), expiresAt: Date.now() + ttlMs })
    this.#sessions.set(hash(token), record)
    return token
  }
  resolve(token) { const record = this.#sessions.get(hash(token ?? '')); return record && record.expiresAt > Date.now() ? record : null }
  revoke(token) { this.#sessions.delete(hash(token ?? '')) }
}

function hash(value) { return createHash('sha256').update(value).digest('base64url') }

export class TenantResourceStore {
  #resources = new Map()
  constructor(resources = []) { resources.forEach((resource) => this.put(resource)) }
  put(resource) {
    if (!isOpaqueId(resource.id) || !isOpaqueId(resource.organizationId) || !isOpaqueId(resource.workspaceId)) throw new Error('TENANT_RESOURCE_IDENTIFIER_INVALID')
    this.#resources.set(resource.id, Object.freeze({ ...resource }))
  }
  getScoped(id, { organizationId, workspaceId }) {
    const resource = this.#resources.get(id)
    return resource && resource.organizationId === organizationId && resource.workspaceId === workspaceId ? resource : null
  }
  listScoped({ organizationId, workspaceId }) {
    return [...this.#resources.values()].filter((resource) => resource.organizationId === organizationId && resource.workspaceId === workspaceId)
  }
}
