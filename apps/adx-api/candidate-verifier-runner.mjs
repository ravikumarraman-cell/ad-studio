import { ChangeCaseError } from './change-case-ledger.mjs'

/** Executes independent verifier plug-ins concurrently with a strict evidence contract. */
export function createCandidateVerifierRunner({ maxFindings, normalizeEvidencePaths } = {}) {
  if (!Number.isInteger(maxFindings) || maxFindings < 1 || typeof normalizeEvidencePaths !== 'function') throw new TypeError('CANDIDATE_VERIFIER_RUNNER_CONFIGURATION_INVALID')
  return async function runCandidateVerifiers({ verifiers, timeoutMs, ...input }) {
    const findings = []
    const storyKeys = new Set(input.task.stories.map((story) => story.key))
    const contextPaths = new Set(input.context.map((file) => file.path))
    const results = await Promise.all(verifiers.map((verifier) => runVerifier(verifier, { ...input, timeoutMs }, timeoutMs)))
    for (const { verifier, result } of results) {
      if (!result || typeof result.passed !== 'boolean' || !Array.isArray(result.findings)) throw new ChangeCaseError('CANDIDATE_VERIFIER_INVALID', `Candidate verifier ${verifier.id} returned an invalid result.`)
      const normalizedFindings = result.findings.map((finding) => ({
        storyKey: typeof finding?.storyKey === 'string' ? finding.storyKey.trim() : '',
        code: typeof finding?.code === 'string' ? finding.code.trim() : '',
        message: typeof finding?.message === 'string' ? finding.message.trim() : '',
        evidencePaths: normalizeEvidencePaths(finding?.evidencePaths),
      }))
      const unsupportedEvidencePath = normalizedFindings.flatMap((finding) => finding.evidencePaths).find((path) => !contextPaths.has(path))
      if (unsupportedEvidencePath) throw new ChangeCaseError('CANDIDATE_VERIFIER_INVALID', `Candidate verifier ${verifier.id} cited evidence path ${unsupportedEvidencePath}, which was not supplied in its context.`)
      if (normalizedFindings.length > maxFindings || normalizedFindings.some((finding) => !storyKeys.has(finding.storyKey) || !finding.code || !finding.message || !finding.evidencePaths.length) || (result.passed && normalizedFindings.length) || (!result.passed && !normalizedFindings.length)) throw new ChangeCaseError('CANDIDATE_VERIFIER_INVALID', `Candidate verifier ${verifier.id} returned an inconsistent or unsupported finding.`)
      for (const finding of normalizedFindings) findings.push(Object.freeze({ ...finding, verifierId: verifier.id }))
    }
    return Object.freeze({ passed: findings.length === 0, findings: Object.freeze(findings) })
  }
}

function runVerifier(verifier, input, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort()
      rejectPromise(new ChangeCaseError('CANDIDATE_VERIFIER_TIMED_OUT', `Candidate verifier ${verifier.id} exceeded its execution deadline.`))
    }, timeoutMs)
    Promise.resolve(verifier.verify({ ...input, signal: controller.signal }))
      .then((result) => resolvePromise({ verifier, result }), rejectPromise)
      .finally(() => clearTimeout(timeout))
  })
}
