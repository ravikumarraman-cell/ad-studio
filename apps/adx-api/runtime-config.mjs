import { access, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'

export async function validateReadableFilePath(value, code) {
  const configuredPath = typeof value === 'string' ? value.trim() : ''
  if (!configuredPath) throw new Error(`${code}_MISSING`)
  const path = await realpath(configuredPath).catch(() => null)
  if (!path) throw new Error(`${code}_UNAVAILABLE`)
  const metadata = await stat(path).catch(() => null)
  if (!metadata?.isFile()) throw new Error(`${code}_NOT_FILE`)
  await access(path, constants.R_OK).catch(() => {
    throw new Error(`${code}_UNREADABLE`)
  })
  return path
}

export async function validateModelPatchRuntimeConfiguration({
  enabled,
  profile,
} = {}) {
  if (!enabled) return Object.freeze({ enabled: false })
  if (!profile || typeof profile !== 'object') throw new Error('MODEL_PATCH_CONFIGURATION_REQUIRED')
  const sourceRoot = await validateReadableDirectory(profile.sourceRoot, 'MODEL_PATCH_SOURCE_ROOT')
  const candidateRoot = await validateCandidateDirectory(profile.candidateRoot)
  if (sourceRoot === candidateRoot || sourceRoot.startsWith(`${candidateRoot}/`) || candidateRoot.startsWith(`${sourceRoot}/`)) {
    throw new Error('MODEL_PATCH_PATH_CONFLICT: Configure the model-patch source and candidate roots as separate checkout directories.')
  }
  if (typeof profile.validationCommand !== 'string' || !profile.validationCommand.trim()) {
    throw new Error('MODEL_PATCH_VALIDATION_COMMAND_REQUIRED: Configure a non-empty validation command for the active model-patch profile.')
  }
  return Object.freeze({ enabled: true, sourceRoot, candidateRoot, validationCommand: profile.validationCommand.trim() })
}

async function validateReadableDirectory(value, code) {
  const configuredPath = typeof value === 'string' ? value.trim() : ''
  if (!configuredPath) throw new Error(`${code}_MISSING`)
  const path = await realpath(configuredPath).catch(() => null)
  if (!path) throw new Error(`${code}_UNAVAILABLE`)
  const metadata = await stat(path).catch(() => null)
  if (!metadata?.isDirectory()) throw new Error(`${code}_NOT_DIRECTORY`)
  await access(path, constants.R_OK | constants.X_OK).catch(() => {
    throw new Error(`${code}_UNREADABLE`)
  })
  return path
}

async function validateCandidateDirectory(value) {
  const candidateRoot = await validateReadableDirectory(value, 'MODEL_PATCH_CANDIDATE_ROOT')
  return candidateRoot
}