import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCandidateGitExport } from '../candidate-git-export.mjs'

test('exports only content-addressed candidate changes from a clean registered source checkout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adx-git-export-'))
  const source = join(root, 'source'); const candidate = join(root, 'candidate')
  await mkdir(source); await mkdir(candidate)
  await writeFile(join(source, 'same.txt'), 'same'); await writeFile(join(source, 'changed.txt'), 'before')
  await writeFile(join(candidate, 'same.txt'), 'same'); await writeFile(join(candidate, 'changed.txt'), 'after'); await writeFile(join(candidate, 'added.txt'), 'new'); await writeFile(join(candidate, '.env'), 'secret'); await writeFile(join(candidate, '.env.local'), 'secret'); await writeFile(join(candidate, '.git'), 'gitdir: /private/metadata'); await writeFile(join(candidate, '.DS_Store'), 'metadata'); await writeFile(join(candidate, 'cache.tsbuildinfo'), 'build-state'); await mkdir(join(candidate, 'test-results')); await writeFile(join(candidate, 'test-results', 'result.json'), 'result')
  const git = async (_cwd, argumentsList) => argumentsList[0] === 'status' ? '' : argumentsList[0] === 'rev-parse' ? 'abc123\n' : 'https://github.com/example/repository.git\n'
  try {
    await assert.rejects(() => createCandidateGitExport({ sourceRoot: source, candidateRoot: candidate, candidateDigest: 'sha256:candidate', canonicalRemote: 'https://github.com/example/repository', runGit: git }), { code: 'GIT_EXPORT_CANDIDATE_MISMATCH' })
    const exported = await createCandidateGitExport({ sourceRoot: source, candidateRoot: candidate, candidateDigest: await digest(candidate), canonicalRemote: 'https://github.com/example/repository', runGit: git })
    assert.equal(exported.baseCommit, 'abc123')
    assert.deepEqual(exported.changes.map((item) => [item.path, item.operation]), [['added.txt', 'ADD'], ['changed.txt', 'MODIFY']])
    assert.equal(exported.changes.some((item) => item.path.startsWith('.env') || item.path === '.git' || item.path === '.DS_Store' || item.path.endsWith('.tsbuildinfo') || item.path.startsWith('test-results/')), false)
    assert.ok(exported.exportDigest.startsWith('sha256:'))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('rejects a dirty source checkout before producing an export', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adx-git-export-'))
  const git = async (_cwd, argumentsList) => argumentsList[0] === 'status' ? ' M tracked.txt\n' : 'https://github.com/example/repository\n'
  try {
    const candidateDigest = await digest(root)
    await assert.rejects(() => createCandidateGitExport({ sourceRoot: root, candidateRoot: root, candidateDigest, canonicalRemote: 'https://github.com/example/repository', runGit: git }), { code: 'GIT_EXPORT_SOURCE_DIRTY' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

async function digest(root) {
  const { digestCandidateTree } = await import('../verification-evidence.mjs')
  return digestCandidateTree(root)
}