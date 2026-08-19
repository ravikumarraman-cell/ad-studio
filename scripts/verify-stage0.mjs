import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const requiredFiles = [
  'package.json',
  '.npmrc',
  'packages/domain/src/change-case.ts',
  'packages/domain/src/change-case-workflow.json',
  'packages/contracts/schemas/change-case.create.schema.json',
  'docs/conformance/stage-0.md',
  'docs/adr/ADR-002-framework-adoption.md',
  'docs/adr/ADR-004-event-reconciliation.md',
  'docs/adr/ADR-006-execution-substrate.md',
  'apps/tanstack-start-canary/app.config.ts',
  'apps/tanstack-start-canary/app/routes/index.tsx',
]

for (const file of requiredFiles) {
  if (!existsSync(resolve(root, file))) throw new Error(`STG0-MISSING: ${file}`)
}

const rootPackage = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
if (!Array.isArray(rootPackage.workspaces) || !rootPackage.workspaces.includes('apps/*') || !rootPackage.workspaces.includes('packages/*')) {
  throw new Error('STG0-WORKSPACE: root package must declare apps/* and packages/* workspaces')
}
if (rootPackage.engines?.node !== '>=22.19.0 <23') throw new Error('STG0-NODE: Node engine must be explicitly pinned')

const registry = readFileSync(resolve(root, '.npmrc'), 'utf8')
if (!registry.includes('registry=https://registry.npmjs.org/') || !registry.includes('strict-ssl=true')) {
  throw new Error('STG0-REGISTRY: the public registry and strict SSL are required')
}

const schema = JSON.parse(readFileSync(resolve(root, 'packages/contracts/schemas/change-case.create.schema.json'), 'utf8'))
const expected = ['tenantId', 'title', 'riskTier', 'idempotencyKey']
if (schema.additionalProperties !== false || expected.some((field) => !schema.required?.includes(field))) {
  throw new Error('STG0-CONTRACT: CreateChangeCase command must be closed and idempotent')
}
if (schema.properties?.riskTier?.enum?.join(',') !== 'R0,R1,R2,R3,R4') {
  throw new Error('STG0-CONTRACT: risk tiers must be exactly R0 through R4')
}

const workflow = JSON.parse(readFileSync(resolve(root, 'packages/domain/src/change-case-workflow.json'), 'utf8'))
const requiredStates = ['DRAFT', 'INTAKE', 'AWAITING_CLARIFICATION', 'RISK_REVIEW', 'AWAITING_STORY_APPROVAL', 'DESIGN_REVIEW', 'READY_FOR_EXECUTION', 'AWAITING_VERIFICATION', 'READY_FOR_DELIVERY', 'OUTCOME_RECORDED', 'PAUSED', 'CANCELLED']
const requiredGateIds = ['A', 'A.5', 'B', 'C', 'D', 'E', 'F']
if (workflow.states?.join(',') !== requiredStates.join(',') || new Set(workflow.states).size !== requiredStates.length) {
  throw new Error('STG0-WORKFLOW: canonical Change Case states must be complete and unique')
}
if (workflow.gates?.map((gate) => gate.id).join(',') !== requiredGateIds.join(',') || workflow.gates.some((gate) => !gate.name || !gate.purpose || !gate.review)) {
  throw new Error('STG0-WORKFLOW: canonical gates must be complete and presentation-ready')
}
if (Object.keys(workflow.statePositions ?? {}).length !== requiredStates.length) {
  throw new Error('STG0-WORKFLOW: every canonical state must have exactly one workflow position')
}

console.log('Stage 0 structural contract verification passed.')
