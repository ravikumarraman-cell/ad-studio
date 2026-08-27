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
  const actualCandidateDigest = await digest(candidate)
  try {
    await assert.rejects(() => createCandidateGitExport({ sourceRoot: source, candidateRoot: candidate, candidateDigest: 'sha256:candidate', canonicalRemote: 'https://github.com/example/repository', runGit: git }), (error) => error.code === 'GIT_EXPORT_CANDIDATE_MISMATCH' && error.retryable === true && error.details.expectedCandidateDigest === 'sha256:candidate' && error.details.actualCandidateDigest === actualCandidateDigest && error.message.includes('run independent verification again'))
    const exported = await createCandidateGitExport({ sourceRoot: source, candidateRoot: candidate, candidateDigest: actualCandidateDigest, canonicalRemote: 'https://github.com/example/repository', runGit: git })
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

test('exports only the registered project subtree despite unrelated source changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adx-git-export-'))
  const source = join(root, 'source'); const candidate = join(root, 'candidate')
  await writeProjectFile(source, 'apps/health-x/feature.js', 'before'); await writeProjectFile(source, 'apps/adx-api/server.js', 'source')
  await writeProjectFile(candidate, 'apps/health-x/feature.js', 'after'); await writeProjectFile(candidate, 'apps/adx-api/server.js', 'candidate')
  const commands = []; const git = async (_cwd, argumentsList) => { commands.push(argumentsList); return argumentsList[0] === 'status' ? argumentsList.includes('apps/health-x') ? '' : ' M apps/adx-api/server.js\n' : argumentsList[0] === 'rev-parse' ? 'abc123\n' : 'https://github.com/example/repository.git\n' }
  try {
    const exported = await createCandidateGitExport({ sourceRoot: source, candidateRoot: candidate, candidateDigest: await digest(candidate), canonicalRemote: 'https://github.com/example/repository', projectPath: 'apps/health-x', runGit: git })
    assert.deepEqual(commands.find((argumentsList) => argumentsList[0] === 'status'), ['status', '--porcelain', '--', 'apps/health-x'])
    assert.deepEqual(exported.changes.map((item) => [item.path, item.operation]), [['apps/health-x/feature.js', 'MODIFY']])
    assert.equal(exported.projectPath, 'apps/health-x')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('rejects changes inside the registered project subtree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adx-git-export-'))
  const source = join(root, 'source'); const candidate = join(root, 'candidate')
  await writeProjectFile(source, 'apps/health-x/feature.js', 'before'); await writeProjectFile(candidate, 'apps/health-x/feature.js', 'after')
  const git = async (_cwd, argumentsList) => argumentsList[0] === 'status' ? ' M apps/health-x/feature.js\n' : argumentsList[0] === 'rev-parse' ? 'abc123\n' : 'https://github.com/example/repository.git\n'
  const candidateDigest = await digest(candidate)
  try {
    await assert.rejects(() => createCandidateGitExport({ sourceRoot: source, candidateRoot: candidate, candidateDigest, canonicalRemote: 'https://github.com/example/repository', projectPath: 'apps/health-x', runGit: git }), { code: 'GIT_EXPORT_SOURCE_DIRTY' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('rejects invalid or unavailable project scopes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adx-git-export-'))
  const git = async (_cwd, argumentsList) => argumentsList[0] === 'status' ? '' : argumentsList[0] === 'rev-parse' ? 'abc123\n' : 'https://github.com/example/repository.git\n'
  const candidateDigest = await digest(root)
  try {
    await assert.rejects(() => createCandidateGitExport({ sourceRoot: root, candidateRoot: root, candidateDigest, canonicalRemote: 'https://github.com/example/repository', projectPath: '../apps/health-x', runGit: git }), { code: 'GIT_EXPORT_INPUT_INVALID' })
    await assert.rejects(() => createCandidateGitExport({ sourceRoot: root, candidateRoot: root, candidateDigest, canonicalRemote: 'https://github.com/example/repository', projectPath: 'apps/health-x', runGit: git }), { code: 'GIT_EXPORT_PROJECT_PATH_MISSING' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('identifies whether the unavailable checkout is source or candidate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adx-git-export-'))
  try {
    await assert.rejects(() => createCandidateGitExport({ sourceRoot: join(root, 'missing-source'), candidateRoot: root, candidateDigest: 'sha256:candidate', canonicalRemote: 'https://github.com/example/repository' }), (error) => error.code === 'GIT_EXPORT_SOURCE_REQUIRED' && error.message.includes('source checkout'))
    await assert.rejects(() => createCandidateGitExport({ sourceRoot: root, candidateRoot: join(root, 'missing-candidate'), candidateDigest: 'sha256:candidate', canonicalRemote: 'https://github.com/example/repository' }), (error) => error.code === 'GIT_EXPORT_CANDIDATE_REQUIRED' && error.message.includes('candidate checkout'))
  } finally { await rm(root, { recursive: true, force: true }) }
})

async function digest(root) {
  const { digestCandidateTree } = await import('../verification-evidence.mjs')
  return digestCandidateTree(root)
}

async function writeProjectFile(root, path, content) {
  const file = join(root, path)
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, content)
}