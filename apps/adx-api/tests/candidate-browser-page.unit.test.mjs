import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderCandidateBrowserPage } from '../candidate-browser-page.mjs'

function vsCodeOpenCommands(page) {
  return [...page.matchAll(/href="(vscode:\/\/command\/vscode\.openFolder\?[^\"]+)"/g)]
    .map((match) => JSON.parse(decodeURIComponent(match[1].split('?')[1])))
}

test('candidate browser shows an empty generated change tree when candidate equals the source baseline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adx-candidate-browser-'))
  try {
    await writeFile(join(root, 'index.mjs'), 'export const answer = 42\n')
    await writeFile(join(root, '.env'), 'SECRET=value\n')
    const page = await renderCandidateBrowserPage({ candidateRoot: root, sourceRoot: root, baseUrl: '/generated-candidate', verificationUrl: '/evidence-review' })
    assert.match(page, /GENERATED CHANGE SET/)
    assert.match(page, /No files differ from the source baseline/)
    assert.doesNotMatch(page, /<code>index\.mjs<\/code>/)
    assert.match(page, /Review generated code/)
    assert.doesNotMatch(page, /SECRET=value/)
    assert.doesNotMatch(page, /\.env/)
    assert.match(page, /Open in separate VS Code window/)
    assert.match(page, /Compare source and candidate in separate VS Code window/)
    assert.match(page, /Next: run independent verification/)
    assert.match(page, /href="\/evidence-review"/)
    assert.doesNotMatch(page, /vscode:\/\/file/)
    const commands = vsCodeOpenCommands(page)
    assert.equal(commands.length, 2)
    for (const [folderUri, options] of commands) {
      assert.equal(folderUri.$mid, 1)
      assert.equal(folderUri.scheme, 'file')
      assert.deepEqual(options, { forceNewWindow: true })
    }
    const [candidateUri] = commands[0]
    assert.equal(candidateUri.path, root)
    const [folderUri] = commands[1]
    assert.match(folderUri.path, /adx-candidate-comparisons\/.*\.code-workspace$/)
    const workspace = JSON.parse(await readFile(folderUri.path, 'utf8'))
    assert.deepEqual(workspace.folders, [
      { name: 'Source baseline', path: root },
      { name: 'Modified candidate', path: root },
    ])
    await unlink(folderUri.path)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('candidate browser renders every generated change as a navigable folder tree', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'adx-candidate-browser-'))
  const source = join(parent, 'source')
  const candidate = join(parent, 'candidate')
  try {
    await mkdir(join(source, 'frontend', 'src'), { recursive: true })
    await mkdir(join(candidate, 'frontend', 'src'), { recursive: true })
    await writeFile(join(source, 'frontend', 'src', 'unchanged.js'), 'export const unchanged = true\n')
    await writeFile(join(source, 'frontend', 'src', 'modified.js'), 'export const state = "before"\n')
    await writeFile(join(candidate, 'frontend', 'src', 'unchanged.js'), 'export const unchanged = true\n')
    await writeFile(join(candidate, 'frontend', 'src', 'modified.js'), 'export const state = "after"\n')
    await writeFile(join(candidate, 'frontend', 'src', 'created.test.js'), 'test("created", () => {})\n')

    const page = await renderCandidateBrowserPage({ candidateRoot: candidate, sourceRoot: source, baseUrl: '/generated-candidate' })

    assert.match(page, /2 changed files · 1 new · 1 modified/)
    assert.match(page, /<summary>frontend<\/summary>/)
    assert.match(page, /<summary>src<\/summary>/)
    assert.match(page, /MODIFIED/)
    assert.match(page, /NEW/)
    assert.match(page, /modified\.js/)
    assert.match(page, /created\.test\.js/)
    assert.doesNotMatch(page, /unchanged\.js/)
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('candidate browser passes special characters through the new-window VS Code command', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'adx candidate browser '))
  const root = join(parent, 'candidate #1')
  try {
    await writeFile(join(parent, 'placeholder'), '')
    await mkdir(root)
    await writeFile(join(root, 'index.mjs'), 'safe\n')
    const page = await renderCandidateBrowserPage({ candidateRoot: root, sourceRoot: root, baseUrl: '/generated-candidate' })
    const commands = vsCodeOpenCommands(page)
    assert.equal(commands.length, 2)
    assert.equal(commands[0][0].path, root)
    assert.deepEqual(commands[0][1], { forceNewWindow: true })
    await unlink(commands[1][0].path)
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('candidate browser still opens an isolated window when no source baseline is available', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adx-candidate-browser-'))
  try {
    await writeFile(join(root, 'index.mjs'), 'safe\n')
    const page = await renderCandidateBrowserPage({ candidateRoot: root, sourceRoot: join(root, 'missing-source'), baseUrl: '/generated-candidate' })
    assert.match(page, /Open in separate VS Code window/)
    assert.doesNotMatch(page, /Compare source and candidate/)
    const commands = vsCodeOpenCommands(page)
    assert.deepEqual(commands, [[{ $mid: 1, scheme: 'file', path: root }, { forceNewWindow: true }]])
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

test('candidate browser fails closed when the candidate root is not a browsable directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adx-candidate-browser-'))
  try {
    const candidateRoot = join(root, 'candidate-root.txt')
    await writeFile(candidateRoot, 'safe\n')
    const page = await renderCandidateBrowserPage({ candidateRoot, baseUrl: '/generated-candidate' })
    assert.match(page, /Generated candidate unavailable/)
    assert.match(page, /generated candidate is unavailable/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
