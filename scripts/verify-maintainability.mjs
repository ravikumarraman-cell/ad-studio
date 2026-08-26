import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

const root = resolve(import.meta.dirname, '..')
const read = (file) => readFileSync(resolve(root, file), 'utf8')
const workflow = JSON.parse(read('packages/domain/src/change-case-workflow.json'))

assert.equal(new Set(workflow.states).size, workflow.states.length, 'Canonical Change Case states must be unique.')
assert.equal(new Set(workflow.gates.map((gate) => gate.id)).size, workflow.gates.length, 'Canonical gate IDs must be unique.')
assert.deepEqual(workflow.gates.map((gate) => gate.id), ['A', 'A.5', 'B', 'C', 'D', 'E', 'F'])
assert.equal(Object.keys(workflow.statePositions).length, workflow.states.length, 'Every state must map to one workflow position.')

const ledger = read('apps/adx-api/change-case-ledger.mjs')
const server = read('apps/adx-api/server.mjs')
const workflowUi = read('apps/adx-studio-web/src/workflow.ts')
for (const [name, source] of Object.entries({ ledger, server, workflowUi })) {
  assert.match(source, /change-case-workflow\.json/, `${name} must consume the canonical workflow contract.`)
}
assert.doesNotMatch(read('packages/domain/src/change-case.ts'), /EXECUTION_AUTHORIZED|EXECUTING|COMPLETED/, 'The typed domain contract must not expose retired workflow states.')

console.log('Maintainability contract verification passed.')
