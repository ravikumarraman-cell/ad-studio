import { constants } from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

export async function validatePreviewCheckoutPaths({ sourceRoot, candidateRoot } = {}) {
  const configured = [sourceRoot, candidateRoot].some((value) => typeof value === 'string' && value.trim())
  if (!configured) return Object.freeze({ configured: false, sourceRoot: null, candidateRoot: null })
  if (typeof sourceRoot !== 'string' || !sourceRoot.trim() || typeof candidateRoot !== 'string' || !candidateRoot.trim()) throw new Error('PREVIEW_CHECKOUT_CONFIGURATION_INCOMPLETE')
  const source = await readableDirectory(sourceRoot, 'PREVIEW_SOURCE_CHECKOUT')
  const candidate = await candidateDirectory(candidateRoot)
  return Object.freeze({ configured: true, sourceRoot: source, candidateRoot: candidate })
}

export async function validateReadableFilePath(value, code) {
  const configuredPath = typeof value === 'string' ? value.trim() : ''
  if (!configuredPath) throw new Error(`${code}_MISSING`)
  const path = await realpath(configuredPath).catch(() => null)
  if (!path) throw new Error(`${code}_UNAVAILABLE`)
  const metadata = await stat(path).catch(() => null)
  if (!metadata?.isFile()) throw new Error(`${code}_NOT_FILE`)
  await access(path, constants.R_OK).catch(() => { throw new Error(`${code}_UNREADABLE`) })
  return path
}

async function readableDirectory(value, code) {
  const path = await realpath(value).catch(() => null)
  if (!path) throw new Error(`${code}_UNAVAILABLE`)
  const metadata = await stat(path).catch(() => null)
  if (!metadata?.isDirectory()) throw new Error(`${code}_NOT_DIRECTORY`)
  await access(path, constants.R_OK | constants.X_OK).catch(() => { throw new Error(`${code}_UNREADABLE`) })
  return path
}

async function candidateDirectory(value) {
  const configuredPath = resolve(value)
  const path = await realpath(configuredPath).catch(() => null)
  if (path) return readableDirectory(path, 'PREVIEW_CANDIDATE_CHECKOUT')
  await access(dirname(configuredPath), constants.W_OK | constants.X_OK).catch(() => { throw new Error('PREVIEW_CANDIDATE_PARENT_UNWRITABLE') })
  return configuredPath
}
