import { spawn } from 'node:child_process'
import { ChangeCaseError } from './change-case-ledger.mjs'

/** Executes only server-provided command definitions with bounded output and time. */
export function createBoundedValidationRunner({ commands, sha256, spawnImpl = spawn } = {}) {
  if (!commands || typeof commands !== 'object' || typeof sha256 !== 'function' || typeof spawnImpl !== 'function') throw new TypeError('VALIDATION_RUNNER_CONFIGURATION_INVALID')
  return async function runValidation({ cwd, allowedCommands, timeoutMs }) {
    const configured = commands[allowedCommands?.[0]]
    if (!configured) throw new ChangeCaseError('MODEL_PATCH_COMMAND_DENIED', 'Validation requires an approved project command.')
    const steps = Array.isArray(configured) ? configured : [configured]
    const startedAt = Date.now()
    let outputBytes = 0
    let outputExcerpt = ''
    for (const command of steps) {
      const result = await runValidationCommand({ cwd, command, timeoutMs: Math.max(1, timeoutMs - elapsed(startedAt)) })
      outputBytes = Math.min(64 * 1024, outputBytes + result.outputBytes)
      outputExcerpt = appendOutputExcerpt(outputExcerpt, result.outputExcerpt ?? '')
      if (result.code !== 0 || result.signal || result.timedOut) return Object.freeze({ ...result, outputBytes, outputExcerpt: outputExcerpt || null })
    }
    return Object.freeze({
      code: 0, signal: null, timedOut: false, outputBytes,
      outputDigest: sha256({ commandCount: steps.length, outputBytes }),
      outputExcerpt: outputExcerpt || null,
    })
  }

  function runValidationCommand({ cwd, command, timeoutMs }) {
    return new Promise((resolvePromise) => {
      const child = spawnImpl(command.executable, command.arguments, {
        cwd,
        env: { PATH: process.env.PATH, LANG: 'C', npm_config_audit: 'false', npm_config_fund: 'false' },
        stdio: ['ignore', 'pipe', 'pipe'], shell: false,
      })
      let outputBytes = 0
      let outputExcerpt = ''
      const capture = (chunk) => {
        outputBytes += chunk.length
        outputExcerpt = appendOutputExcerpt(outputExcerpt, chunk)
      }
      let timedOut = false
      const timeout = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
      }, timeoutMs)
      child.stdout.on('data', capture)
      child.stderr.on('data', capture)
      child.once('close', (code, signal) => {
        clearTimeout(timeout)
        resolvePromise(Object.freeze({
          code: code ?? 1, signal, timedOut, outputBytes: Math.min(outputBytes, 64 * 1024),
          outputDigest: sha256({ code, signal, outputBytes: Math.min(outputBytes, 64 * 1024) }),
          outputExcerpt: outputExcerpt || null,
        }))
      })
    })
  }
}

function elapsed(startedAt) { return Math.max(0, Math.round(Date.now() - startedAt)) }
function appendOutputExcerpt(current, chunk) {
  const next = `${current}${chunk.toString('utf8')}`
  return Buffer.byteLength(next) <= 4096 ? next : next.slice(-4096)
}
