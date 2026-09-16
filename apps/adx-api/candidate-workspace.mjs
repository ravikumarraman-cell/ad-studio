import { cp, lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, symlink } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, join, relative } from 'node:path'
import { ChangeCaseError } from './change-case-ledger.mjs'

/**
 * Disposable candidate-workspace lifecycle. Policy is injected so this module
 * can safely serve any governed project profile without importing broker state.
 */
export function createCandidateWorkspaceManager({ sha256, ignoredDirectories, transientDirectories, shouldIncludePath }) {
  if (typeof sha256 !== 'function' || !(ignoredDirectories instanceof Set) || !Array.isArray(transientDirectories) || typeof shouldIncludePath !== 'function') throw new TypeError('CANDIDATE_WORKSPACE_CONFIGURATION_INVALID')
  const executionStateCache = new Map()

  function getExecutionState({ source, candidate, writePaths, readOnlyContextPaths, linkSourceDependencies }) {
    const key = sha256({ source, candidate, writePaths, readOnlyContextPaths, linkSourceDependencies })
    let state = executionStateCache.get(key)
    if (!state) {
      state = { lastTouchedPaths: new Set(), workspaceSeeded: false, seedPromise: null }
      executionStateCache.set(key, state)
    }
    return state
  }

  async function prepareCandidateWorkspace({ source, candidate, state, shouldLinkSourceDependencies, timings }) {
    if (state.lastTouchedPaths.size) {
      await restoreCandidateWorkspacePaths({ source, workspace: candidate, paths: state.lastTouchedPaths })
      state.lastTouchedPaths = new Set()
      return
    }
    if (state.workspaceSeeded) return
    if (!state.seedPromise) {
      state.seedPromise = copyCandidateWorkspace({ source, workspace: candidate, shouldLinkSourceDependencies, timings }).then(() => {
        state.workspaceSeeded = true
      })
    }
    await state.seedPromise
  }

  async function copyCandidateWorkspace({ source, workspace, shouldLinkSourceDependencies, timings }) {
    const startedAt = Date.now()
    const staleWorkspace = `${workspace}.stale-${randomUUID()}`
    const rotated = await rename(workspace, staleWorkspace).then(() => true).catch((error) => {
      if (error?.code === 'ENOENT') return false
      throw error
    })
    await mkdir(workspace, { recursive: true })
    const entries = await readdir(source, { withFileTypes: true })
    await Promise.all(entries.map(async (entry) => {
      const sourcePath = join(source, entry.name)
      if (!shouldIncludePath(source, sourcePath)) return
      await cp(sourcePath, join(workspace, entry.name), {
        recursive: entry.isDirectory(), dereference: false, verbatimSymlinks: true,
        mode: process.platform === 'darwin' ? fsConstants.COPYFILE_FICLONE : 0,
        filter: (path) => shouldIncludePath(source, path),
      })
    }))
    await pruneCandidateWorkspace(workspace, source)
    if (shouldLinkSourceDependencies) await linkSourceDependencies(source, workspace)
    timings.workspaceCopyMs = Number(timings.workspaceCopyMs ?? 0) + elapsed(startedAt)
    if (rotated) void rm(staleWorkspace, { recursive: true, force: true }).catch(() => {})
  }

  async function restoreCandidateWorkspacePaths({ source, workspace, paths }) {
    for (const path of paths) {
      const sourcePath = join(source, path)
      const candidatePath = join(workspace, path)
      const sourceStat = await stat(sourcePath).catch(() => null)
      if (!sourceStat) {
        await rm(candidatePath, { recursive: true, force: true })
        continue
      }
      await mkdir(dirname(candidatePath), { recursive: true })
      await cp(sourcePath, candidatePath, { recursive: sourceStat.isDirectory(), dereference: false, verbatimSymlinks: true, force: true })
    }
  }

  async function checkedOutRoot(value) {
    if (typeof value !== 'string' || !value.trim()) throw new ChangeCaseError('MODEL_PATCH_SOURCE_REQUIRED', 'A server-configured source checkout is required for model-patch execution.')
    const root = await realpath(value).catch(() => null)
    if (!root) throw new ChangeCaseError('MODEL_PATCH_SOURCE_REQUIRED', 'The server-configured source checkout does not exist.')
    return root
  }

  async function removeTransientCandidateOutputs(workspace) {
    await Promise.all(transientDirectories.map((path) => rm(join(workspace, path), { recursive: true, force: true })))
  }

  async function digestTree(root) {
    const files = []
    async function collect(current) {
      for (const entry of await readdir(current, { withFileTypes: true })) {
        const fullPath = join(current, entry.name)
        if (!shouldIncludePath(root, fullPath)) continue
        if (entry.isDirectory()) await collect(fullPath)
        else if (entry.isFile()) {
          const bytes = await readFile(fullPath)
          files.push({ path: relative(root, fullPath), bytes: bytes.length, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` })
        }
      }
    }
    await collect(root)
    return sha256(files.sort((left, right) => left.path.localeCompare(right.path)))
  }

  async function linkSourceDependencies(source, workspace) {
    let linked = 0
    async function linkFrom(relativePath) {
      for (const entry of await readdir(join(source, relativePath || '.'), { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const nextRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name
        if (entry.name === 'node_modules') {
          if (relativePath.split('/').filter(Boolean).length > 1) continue
          await mkdir(dirname(join(workspace, nextRelativePath)), { recursive: true })
          await symlink(join(source, nextRelativePath), join(workspace, nextRelativePath), 'dir')
          linked += 1
          continue
        }
        if (ignoredDirectories.has(entry.name)) continue
        await linkFrom(nextRelativePath)
      }
    }
    await linkFrom('')
    if (!linked) throw new ChangeCaseError('MODEL_PATCH_DEPENDENCIES_MISSING', 'The execution profile requires dependencies in the server source checkout. Install them before starting a bounded run.', { retryable: false, severity: 'warning' })
  }

  async function pruneCandidateWorkspace(workspace, source) {
    await Promise.all(Array.from(ignoredDirectories, (directory) => rm(join(workspace, directory), { recursive: true, force: true })))
    await pruneExcludedFiles(workspace, source, '')
  }

  async function pruneExcludedFiles(workspace, source, relativePath) {
    for (const entry of await readdir(join(source, relativePath || '.'), { withFileTypes: true })) {
      const nextRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) continue
        await pruneExcludedFiles(workspace, source, nextRelativePath)
        continue
      }
      if (!entry.isFile() || shouldIncludePath(source, join(source, nextRelativePath))) continue
      await rm(join(workspace, nextRelativePath), { force: true })
    }
  }

  return Object.freeze({ checkedOutRoot, digestTree, getExecutionState, prepareCandidateWorkspace, removeTransientCandidateOutputs })
}

function elapsed(startedAt) { return Math.max(0, Math.round(Date.now() - startedAt)) }
