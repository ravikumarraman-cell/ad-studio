import assert from 'node:assert/strict'
import { ChangeCaseError } from '../apps/adx-api/change-case-ledger.mjs'
import { assessContextFreshness, createContextNode, createSpecialistRole, evaluateRoleSelection, TenantContextGraph } from '../apps/adx-api/context-graph.mjs'

const scope = { organizationId: '11111111-1111-4111-8111-111111111111', workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
const other = { organizationId: '22222222-2222-4222-8222-222222222222', workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }
const node = createContextNode({ nodeId: 'symbol:release', kind: 'CODE_SYMBOL', repositoryId: 'adx-studio', contentDigest: 'sha256:context', provenance: { source: 'repository-index', reference: 'main@abc' }, observedAt: 1_000, maxAgeMs: 100, labels: ['untrusted-content', 'repository'] })
assert.equal(node.provenance.trusted, false)
assert.equal(assessContextFreshness(node, 1_050).status, 'FRESH')
assert.equal(assessContextFreshness(node, 1_101).status, 'STALE')
const graph = new TenantContextGraph(); assert.equal(graph.addNode(scope, node).deduplicated, false); assert.equal(graph.addNode(scope, node).deduplicated, true); assert.equal(graph.query(other, {}).nodes.length, 0)
const role = createSpecialistRole({ roleId: 'architecture-review', allowedContextKinds: ['CODE_SYMBOL', 'API'], policyVersion: 'adx-role-v1' }); assert.equal(role.capabilities.execute, false)
assert.equal(evaluateRoleSelection({ baseline: { quality: 5, cost: 5, latency: 5, evidence: 5, safety: 5, reproducibility: 5, approvalClarity: 5 }, candidate: { quality: 6, cost: 5, latency: 5, evidence: 5, safety: 5, reproducibility: 5, approvalClarity: 5 } }).accepted, true)
assert.equal(evaluateRoleSelection({ baseline: { quality: 5, cost: 5, latency: 5, evidence: 5, safety: 5, reproducibility: 5, approvalClarity: 5 }, candidate: { quality: 6, cost: 5, latency: 5, evidence: 5, safety: 4, reproducibility: 5, approvalClarity: 5 } }).accepted, false)
console.log('Stage 10 tenant context isolation, untrusted provenance, freshness, no-authority specialist roles, and measured role-value verification passed.')
