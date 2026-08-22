import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderCandidateBrowserPage } from '../candidate-browser-page.mjs'

test('candidate browser lists retained source while excluding sensitive files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adx-candidate-browser-'))
  try {
    await writeFile(join(root, 'index.mjs'), 'export const answer = 42\n')
    await writeFile(join(root, '.env'), 'SECRET=value\n')
    const page = await renderCandidateBrowserPage({ candidateRoot: root, baseUrl: '/generated-candidate' })
    assert.match(page, /index\.mjs/)
    assert.match(page, /View generated candidate|Generated code/)
    assert.doesNotMatch(page, /SECRET=value/)
    assert.doesNotMatch(page, /\.env/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('candidate browser rejects a path traversal request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adx-candidate-browser-'))
  try {
    await writeFile(join(root, 'index.mjs'), 'safe\n')
    const page = await renderCandidateBrowserPage({ candidateRoot: root, baseUrl: '/generated-candidate', requestedPath: '../.env' })
    assert.match(page, /Select a file/)
    assert.doesNotMatch(page, /safe\n<\/pre>/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
