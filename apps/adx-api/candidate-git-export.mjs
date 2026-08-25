import { createHash } from 'node:crypto'
import { readdir, readFile, realpath } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { spawn } from 'node:child_process'
import { ChangeCaseError, sha256 } from './change-case-ledger.mjs'
import { digestCandidateTree } from './verification-evidence.mjs'

const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', 'test-results', '.output', '.vinxi'])

/**
 * Produces the only source-export input a delivery adapter may use. The source
 * checkout must be clean and anchored to its immutable Git HEAD before its
 * verified candidate can be represented as a set of content-addressed changes.
 */
export async function createCandidateGitExport({ sourceRoot, candidateRoot, candidateDigest, canonicalRemote, runGit = git }) {
  if (!candidateDigest?.startsWith('sha256:') || typeof canonicalRemote !== 'string' || !canonicalRemote.startsWith('https://')) throw new ChangeCaseError('GIT_EXPORT_INPUT_INVALID', 'Candidate digest and canonical HTTPS remote are required.')
  const source = await repositoryRoot(sourceRoot, 'GIT_EXPORT_SOURCE_REQUIRED')
  const candidate = await repositoryRoot(candidateRoot, 'GIT_EXPORT_CANDIDATE_REQUIRED')
  if (await digestCandidateTree(candidate) !== candidateDigest) throw new ChangeCaseError('GIT_EXPORT_CANDIDATE_MISMATCH', 'The server-owned candidate no longer matches the independently verified candidate digest.')
  const [status, baseCommit, remote] = await Promise.all([
    runGit(source, ['status', '--porcelain']),
    runGit(source, ['rev-parse', 'HEAD']),
    runGit(source, ['remote', 'get-url', 'origin']),
  ])
  if (status.trim()) throw new ChangeCaseError('GIT_EXPORT_SOURCE_DIRTY', 'The server-owned source checkout must be clean before a candidate can be exported.')
  if (normalizeRemote(remote) !== normalizeRemote(canonicalRemote)) throw new ChangeCaseError('GIT_EXPORT_REMOTE_MISMATCH', 'The server-owned source checkout does not match the registered delivery repository.')
  const changes = await compareTrees(source, candidate)
  if (!changes.length) throw new ChangeCaseError('GIT_EXPORT_NO_CHANGES', 'The verified candidate contains no exportable changes relative to its source checkout.')
  const unsigned = { schema: 'adx-candidate-git-export-v1', candidateDigest, repository: normalizeRemote(canonicalRemote), baseCommit: baseCommit.trim(), changes }
  return Object.freeze({ ...unsigned, exportDigest: sha256(unsigned) })
}

async function repositoryRoot(value, code) {
  if (typeof value !== 'string' || !value.trim()) throw new ChangeCaseError(code, 'A server-owned checkout path is required.')
  const root = await realpath(value).catch(() => null)
  if (!root) throw new ChangeCaseError(code, 'The server-owned checkout path is unavailable.')
  return root
}

async function compareTrees(sourceRoot, candidateRoot) {
  const [source, candidate] = await Promise.all([tree(sourceRoot), tree(candidateRoot)])
  const paths = [...new Set([...source.keys(), ...candidate.keys()])].sort()
  const changes = []
  for (const path of paths) {
    const before = source.get(path) ?? null
    const after = candidate.get(path) ?? null
    if (before?.digest === after?.digest) continue
    changes.push(Object.freeze({ path, operation: before ? after ? 'MODIFY' : 'DELETE' : 'ADD', beforeDigest: before?.digest ?? null, afterDigest: after?.digest ?? null, content: after?.content ?? null }))
  }
  return Object.freeze(changes)
}

async function tree(root) {
  const files = new Map()
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (ignored(entry.name)) continue
      const fullPath = join(directory, entry.name)
      const path = relative(root, fullPath)
      if (entry.isDirectory()) await visit(fullPath)
      else if (entry.isFile()) {
        const content = await readFile(fullPath)
        files.set(path, Object.freeze({ digest: `sha256:${createHash('sha256').update(content).digest('hex')}`, content: content.toString('base64') }))
      }
    }
  }
  await visit(root)
  return files
}

function ignored(name) { return ignoredDirectories.has(name) || name === '.DS_Store' || name === '.git' || name === '.npmrc' || name.startsWith('.env') || name.endsWith('.pem') || name.endsWith('.key') || name.endsWith('.tsbuildinfo') }
function normalizeRemote(value) { return value.trim().replace(/\.git$/, '').toLowerCase() }

function git(cwd, argumentsList) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', ['-C', cwd, ...argumentsList], { env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'], shell: false })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    child.once('error', () => reject(new ChangeCaseError('GIT_EXPORT_SOURCE_INVALID', 'The source checkout is not accessible through Git.')))
    child.once('close', (code) => code === 0 ? resolvePromise(output) : reject(new ChangeCaseError('GIT_EXPORT_SOURCE_INVALID', 'The source checkout is not a usable Git repository.')))
  })
}