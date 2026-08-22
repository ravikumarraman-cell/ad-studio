import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCodexAdapter } from '../coding-agent-adapters.mjs'
import { LocalCodingAgentBroker } from '../local-coding-agent-broker.mjs'

const adapter = createCodexAdapter({ version: '1.0.0' })
const task = { objective: 'Add a retained implementation marker.', changeDigest: 'sha256:case-digest', allowedCommands: ['node --test'] }

test('local broker executes only in a disposable copy and promotes the successful candidate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adx-agent-broker-test-')); const source = join(root, 'source'); const candidate = join(root, 'candidate')
  await (await import('node:fs/promises')).mkdir(source); await writeFile(join(source, 'package.json'), '{}')
  const broker = new LocalCodingAgentBroker({ enabled: true, sourceRoot: source, candidateRoot: candidate, run: async ({ cwd, prompt }) => { assert.match(prompt, /retained implementation marker/); await writeFile(join(cwd, 'implemented.txt'), 'done'); return { code: 0, signal: null, output: 'implemented', outputDigest: 'sha256:output', outputBytes: 11, quotaExceeded: false, timedOut: false } } })
  const result = await broker.execute({ adapter, task })
  assert.equal(result.promoted, true)
  assert.equal(await readFile(join(candidate, 'implemented.txt'), 'utf8'), 'done')
  await assert.rejects(() => readFile(join(source, 'implemented.txt'), 'utf8'))
})

test('local broker is disabled until explicitly enabled', async () => {
  const broker = new LocalCodingAgentBroker({ enabled: false, sourceRoot: '/tmp/source', candidateRoot: '/tmp/candidate' })
  await assert.rejects(() => broker.execute({ adapter, task }), { code: 'CODING_AGENT_EXECUTOR_DISABLED' })
})