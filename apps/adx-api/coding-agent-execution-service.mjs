import { ChangeCaseError, sha256 } from './change-case-ledger.mjs'

/**
 * Provider-neutral orchestration. Callers supply all policy-derived values;
 * browser input may select only a registered provider identifier.
 */
export class CodingAgentExecutionService {
  constructor({ executionRepository, changeCaseRepository, broker, resolveAdapter, policy }) {
    if (!executionRepository || !changeCaseRepository || !broker || typeof resolveAdapter !== 'function' || !policy) throw new Error('CODING_AGENT_EXECUTION_SERVICE_CONFIGURATION_REQUIRED')
    this.executionRepository = executionRepository
    this.changeCaseRepository = changeCaseRepository
    this.broker = broker
    this.resolveAdapter = resolveAdapter
    this.policy = policy
  }

  configured() {
    return this.broker.configured() && Boolean(this.policy.repository?.repositoryId && this.policy.repository?.ref)
  }

  async execute({ scope, principal, changeCase, provider, task: suppliedTask, expectedVersion, idempotencyKey }) {
    return this.#complete(await this.#prepare({ scope, principal, changeCase, provider, task: suppliedTask, expectedVersion, idempotencyKey }))
  }

  async start({ scope, principal, changeCase, provider, task: suppliedTask, expectedVersion, idempotencyKey }) {
    const prepared = await this.#prepare({ scope, principal, changeCase, provider, task: suppliedTask, expectedVersion, idempotencyKey })
    void this.#complete(prepared).catch(() => {})
    return Object.freeze({ accepted: true, lease: prepared.issued, runId: prepared.issued.runId, status: 'LEASED' })
  }

  async #prepare({ scope, principal, changeCase, provider, task: suppliedTask, expectedVersion, idempotencyKey }) {
    if (!this.configured()) throw new ChangeCaseError('CODING_AGENT_EXECUTOR_NOT_CONFIGURED', 'Coding-agent execution is not configured for this ADX server.')
    if (changeCase?.state !== 'READY_FOR_EXECUTION') throw new ChangeCaseError('EXECUTION_LEASE_NOT_ALLOWED', 'Bounded implementation requires an execution-ready Change Case.')
    if (!Number.isInteger(expectedVersion) || expectedVersion !== changeCase.projectionVersion) throw new ChangeCaseError('VERSION_CONFLICT', 'The Change Case changed before implementation could begin.')
    const adapter = this.resolveAdapter(provider)
    const task = suppliedTask ?? this.policy.taskFor(changeCase)
    const request = this.#leaseRequest(adapter)
    const issued = await this.executionRepository.issueLease({ scope, principal, changeCaseId: changeCase.id, request })
    return { scope, principal, changeCase, expectedVersion, idempotencyKey, adapter, task, issued }
  }

  async #complete({ scope, principal, changeCase, expectedVersion, idempotencyKey, adapter, task, issued }) {
    let result
    try {
      const lease = await this.executionRepository.dispatchContext({ scope, leaseId: issued.leaseId, runId: issued.runId })
      result = await this.broker.execute({ adapter, task, repository: this.policy.repository, timeoutMs: lease.limits.maxDurationSeconds * 1000 })
    } catch (error) {
      result = failureResult(error)
    }
    const completionResult = toCompletionResult(result)
    const completion = await this.executionRepository.completeDispatch({
      scope,
      leaseId: issued.leaseId,
      runId: issued.runId,
      request: { provider: adapter.provider, taskDigest: sha256(task), policyVersion: this.policy.version },
      result: completionResult
    })
    if (!result.accepted || !result.promoted || !result.candidateDigest || completion.status !== 'COMPLETED') {
      return Object.freeze({ accepted: false, lease: issued, completion, candidateDigest: null, result: publicResult(result) })
    }
    const transition = await this.changeCaseRepository.transition({
      scope,
      principal,
      changeCaseId: changeCase.id,
      toState: 'AWAITING_VERIFICATION',
      expectedVersion,
      idempotencyKey
    })
    return Object.freeze({ accepted: true, lease: issued, completion, transition, candidateDigest: result.candidateDigest, result: publicResult(result) })
  }

  #leaseRequest(adapter) {
    const policy = this.policy
    return {
      agentPrincipal: policy.agentPrincipal,
      repositories: [policy.repository],
      requestedCapabilities: policy.capabilities,
      policyCapabilities: policy.capabilities,
      requestedEgress: [],
      policyEgress: [],
      requestedSecrets: [],
      policySecrets: [],
      adapter,
      limits: policy.limits,
      policyVersion: policy.version,
      durationSeconds: policy.durationSeconds
    }
  }
}

function failureResult(error) {
  const code = error instanceof ChangeCaseError ? error.code : 'CODING_AGENT_EXECUTION_FAILED'
  return { accepted: false, promoted: false, code: 1, signal: null, timedOut: false, quotaExceeded: false, output: '', outputBytes: 0, outputDigest: sha256(''), errorCode: code, errorDetails: safeErrorDetails(error?.details), timings: safeTimings(error?.executionTimings), candidateDigest: null }
}

function toCompletionResult(result) {
  const candidateArtifact = result.candidateDigest ? [{ mediaType: 'application/vnd.adx.candidate-digest', digest: result.candidateDigest, bytes: 0 }] : []
  return { code: Number(result.code ?? 1), signal: result.signal ?? null, timedOut: Boolean(result.timedOut), quotaExceeded: Boolean(result.quotaExceeded), outputBytes: Number(result.outputBytes ?? 0), errorCode: result.errorCode ?? null, errorDetails: result.errorDetails ?? null, timings: safeTimings(result.timings), artifacts: candidateArtifact }
}

function publicResult(result) {
  return Object.freeze({ provider: result.provider ?? null, code: Number(result.code ?? 1), signal: result.signal ?? null, timedOut: Boolean(result.timedOut), quotaExceeded: Boolean(result.quotaExceeded), outputDigest: result.outputDigest ?? sha256(''), outputBytes: Number(result.outputBytes ?? 0), errorCode: result.errorCode ?? null })
}

function safeErrorDetails(details) {
  const providerStatus = Number(details?.providerStatus)
  const providerRequestId = typeof details?.providerRequestId === 'string' && details.providerRequestId.length <= 256 ? details.providerRequestId : null
  const gatewayCode = typeof details?.gatewayError?.code === 'string' && details.gatewayError.code.length <= 128 ? details.gatewayError.code : null
  const gatewayParam = typeof details?.gatewayError?.param === 'string' && details.gatewayError.param.length <= 128 ? details.gatewayError.param : null
  const responseIssue = ['NON_JSON', 'SCHEMA_INVALID', 'PATCH_INVALID'].includes(details?.responseIssue) ? details.responseIssue : null
  const modelFinishReason = ['stop', 'length', 'content_filter'].includes(details?.modelFinishReason) ? details.modelFinishReason : null
  const safe = { provider: details?.provider === 'AZURE_OPENAI_GATEWAY' ? details.provider : null, providerStatus: Number.isInteger(providerStatus) && providerStatus >= 100 && providerStatus <= 599 ? providerStatus : null, providerRequestId, gatewayCode, gatewayParam, responseIssue, modelFinishReason }
  return Object.values(safe).some(Boolean) ? safe : null
}

function safeTimings(timings) {
  const safe = {}
  for (const field of ['contextMs', 'workspaceCopyMs', 'modelMs', 'patchMs', 'validationMs', 'promotionMs', 'totalMs']) {
    const value = Number(timings?.[field])
    if (Number.isInteger(value) && value >= 0 && value <= 900_000) safe[field] = value
  }
  return Object.keys(safe).length ? safe : null
}