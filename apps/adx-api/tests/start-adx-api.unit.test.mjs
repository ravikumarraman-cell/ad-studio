import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'

test('API launcher documents the preflighted command without loading configuration', () => {
  const output = execFileSync(process.execPath, ['scripts/start-adx-api.mjs', '--help'], { cwd: new URL('../../..', import.meta.url), encoding: 'utf8' })
  assert.match(output, /npm run api:start/)
  assert.match(output, /\.env\.local/)
  assert.match(output, /PORT/)
})