import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCodingAgentAdapter } from '../coding-agent-adapters.mjs'
import { ModelPatchBroker } from '../model-patch-broker.mjs'

const adapter = createCodingAgentAdapter({ provider: 'UHG_AZURE_OPENAI', version: 'gpt-5.6-terra_2026-07-09', capabilities: { shell: true, gitRead: true, gitWrite: true, browser: false, network: false, secrets: false, deploy: false }, enabled: true })
const task = { objective: 'Replace the marker.', changeDigest: 'sha256:case-digest', allowedCommands: ['node --test'] }
const repository = { writePaths: ['src/**'] }

function gateway(response) {
  return { status: () => ({ configured: true, model: 'gpt-5.6-terra' }), complete: async () => ({ model: 'gpt-5.6-terra', responseDigest: 'sha256:response', text: JSON.stringify(response) }) }
}

test('model-patch broker applies only a validated writable-file replacement in a disposable candidate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adx-model-broker-test-')); const source = join(root, 'source'); const candidate = join(root, 'candidate')
  await mkdir(join(source, 'src'), { recursive: true }); await writeFile(join(source, 'src', 'marker.js'), 'export const marker = "before"\n')
  const broker = new ModelPatchBroker({ enabled: true, sourceRoot: source, candidateRoot: candidate, gateway: gateway({ schema: 'adx-model-patch-response-v1', patches: [{ path: 'src/marker.js', content: 'export const marker = "after"\n' }] }), validate: async ({ cwd, allowedCommands }) => { assert.equal(cwd.endsWith('/candidate'), true); assert.deepEqual(allowedCommands, ['node --test']); return { code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: 'sha256:test' } } })
  const result = await broker.execute({ adapter, task, repository })
  assert.equal(result.promoted, true)
  assert.equal(Number.isInteger(result.timings.totalMs), true)
  assert.equal(Number.isInteger(result.timings.modelMs), true)
  assert.equal(Number.isInteger(result.timings.validationMs), true)
  assert.equal(await readFile(join(candidate, 'src', 'marker.js'), 'utf8'), 'export const marker = "after"\n')
  assert.equal(await readFile(join(source, 'src', 'marker.js'), 'utf8'), 'export const marker = "before"\n')
})

test('model-patch broker classifies a failed validation command', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adx-model-broker-test-')); const source = join(root, 'source'); const candidate = join(root, 'candidate')
  await mkdir(join(source, 'src'), { recursive: true }); await writeFile(join(source, 'src', 'marker.js'), 'export const marker = "before"\n')
  const broker = new ModelPatchBroker({ enabled: true, sourceRoot: source, candidateRoot: candidate, gateway: gateway({ schema: 'adx-model-patch-response-v1', patches: [{ path: 'src/marker.js', content: 'export const marker = "after"\n' }] }), validate: async () => ({ code: 1, signal: null, timedOut: false, outputBytes: 0, outputDigest: 'sha256:test' }) })
  const result = await broker.execute({ adapter, task, repository })
  assert.equal(result.errorCode, 'MODEL_PATCH_VALIDATION_FAILED')
  await rm(root, { recursive: true, force: true })
})

test('model-patch broker rejects a model edit outside the lease write allowlist', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adx-model-broker-test-')); const source = join(root, 'source'); const candidate = join(root, 'candidate')
  await mkdir(join(source, 'src'), { recursive: true }); await writeFile(join(source, 'src', 'marker.js'), 'export const marker = "before"\n')
  const broker = new ModelPatchBroker({ enabled: true, sourceRoot: source, candidateRoot: candidate, gateway: gateway({ schema: 'adx-model-patch-response-v1', patches: [{ path: 'package.json', content: '{}' }] }), validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: 'sha256:test' }) })
  await assert.rejects(() => broker.execute({ adapter, task, repository }), { code: 'MODEL_PATCH_RESPONSE_INVALID' })
})

test('model-patch broker accepts a strictly fenced JSON response', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adx-model-broker-test-')); const source = join(root, 'source'); const candidate = join(root, 'candidate')
  await mkdir(join(source, 'src'), { recursive: true }); await writeFile(join(source, 'src', 'marker.js'), 'export const marker = "before"\n')
  const response = { schema: 'adx-model-patch-response-v1', patches: [{ path: 'src/marker.js', content: 'export const marker = "after"\n' }] }
  const broker = new ModelPatchBroker({ enabled: true, sourceRoot: source, candidateRoot: candidate, gateway: { status: () => ({ configured: true }), complete: async () => ({ text: `\`\`\`json\n${JSON.stringify(response)}\n\`\`\``, model: 'gpt-5.6-terra', responseDigest: 'sha256:response', finishReason: 'stop' }) }, validate: async () => ({ code: 0, signal: null, timedOut: false, outputBytes: 0, outputDigest: 'sha256:test' }) })
  const result = await broker.execute({ adapter, task, repository })
  assert.equal(result.promoted, true)
})
