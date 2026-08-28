import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderCandidateBrowserPage } from '../candidate-browser-page.mjs'

test('candidate browser lists retained source while excluding sensitive files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adx-candidate-browser-'))
  try {
    await writeFile(join(root, 'index.mjs'), 'export const answer = 42\n')
    await writeFile(join(root, '.env'), 'SECRET=value\n')
    const page = await renderCandidateBrowserPage({ candidateRoot: root, sourceRoot: root, baseUrl: '/generated-candidate', verificationUrl: '/evidence-review' })
    assert.match(page, /index\.mjs/)
    assert.match(page, /Review generated code/)
    assert.doesNotMatch(page, /SECRET=value/)
    assert.doesNotMatch(page, /\.env/)
    assert.match(page, /Open in VS Code/)
    assert.match(page, /Compare source and candidate in separate VS Code window/)
    assert.match(page, /Next: run independent verification/)
    assert.match(page, /href="\/evidence-review"/)
    assert.match(page, new RegExp(`vscode://file${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    const commandLink = page.match(/href="(vscode:\/\/command\/vscode\.openFolder\?[^\"]+)"/)
    assert.ok(commandLink)
    const [folderUri, options] = JSON.parse(decodeURIComponent(commandLink[1].split('?')[1]))
    assert.equal(folderUri.$mid, 1)
    assert.equal(folderUri.scheme, 'file')
    assert.match(folderUri.path, /adx-candidate-comparisons\/.*\.code-workspace$/)
    const workspace = JSON.parse(await readFile(folderUri.path, 'utf8'))
    assert.deepEqual(workspace.folders, [
      { name: 'Source baseline', path: root },
      { name: 'Modified candidate', path: root },
    ])
    await unlink(folderUri.path)
    assert.deepEqual(options, { forceNewWindow: true })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('candidate browser escapes special characters in the VS Code folder URL', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'adx candidate browser '))
  const root = join(parent, 'candidate #1')
  try {
    await writeFile(join(parent, 'placeholder'), '')
    await mkdir(root)
    await writeFile(join(root, 'index.mjs'), 'safe\n')
    const page = await renderCandidateBrowserPage({ candidateRoot: root, sourceRoot: root, baseUrl: '/generated-candidate' })
    assert.match(page, /vscode:\/\/file\/.*candidate%20%231/)
  } finally {
    await rm(parent, { recursive: true, force: true })
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
