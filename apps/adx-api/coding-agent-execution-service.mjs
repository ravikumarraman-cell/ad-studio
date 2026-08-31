import { ChangeCaseError, sha256 } from "./change-case-ledger.mjs";

/**
 * Provider-neutral orchestration. Callers supply all policy-derived values;
 * browser input may select only a registered provider identifier.
 */
export class CodingAgentExecutionService {
  constructor({
    executionRepository,
    changeCaseRepository,
    broker,
    resolveAdapter,
    policy,
  }) {
    if (
      !executionRepository ||
      !changeCaseRepository ||
      !broker ||
      typeof resolveAdapter !== "function" ||
      !policy
    )
      throw new Error("CODING_AGENT_EXECUTION_SERVICE_CONFIGURATION_REQUIRED");
    this.executionRepository = executionRepository;
    this.changeCaseRepository = changeCaseRepository;
    this.broker = broker;
    this.resolveAdapter = resolveAdapter;
    this.policy = policy;
  }

  configured() {
    return (
      this.broker.configured() &&
      Boolean(
        this.policy.repository?.repositoryId && this.policy.repository?.ref,
      )
    );
  }

  async execute({
    scope,
    principal,
    changeCase,
    provider,
    task: suppliedTask,
    expectedVersion,
    idempotencyKey,
  }) {
    return this.#complete(
      await this.#prepare({
        scope,
        principal,
        changeCase,
        provider,
        task: suppliedTask,
        expectedVersion,
        idempotencyKey,
      }),
    );
  }

  async start({
    scope,
    principal,
    changeCase,
    provider,
    task: suppliedTask,
    expectedVersion,
    idempotencyKey,
  }) {
    const prepared = await this.#prepare({
      scope,
      principal,
      changeCase,
      provider,
      task: suppliedTask,
      expectedVersion,
      idempotencyKey,
    });
    void this.#complete(prepared).catch(() => {});
    return Object.freeze({
      accepted: true,
      lease: prepared.issued,
      runId: prepared.issued.runId,
      status: "LEASED",
    });
  }

  async #prepare({
    scope,
    principal,
    changeCase,
    provider,
    task: suppliedTask,
    expectedVersion,
    idempotencyKey,
  }) {
    if (!this.configured())
      throw new ChangeCaseError(
        "CODING_AGENT_EXECUTOR_NOT_CONFIGURED",
        "Coding-agent execution is not configured for this ADX server.",
      );
    if (changeCase?.state !== "READY_FOR_EXECUTION")
      throw new ChangeCaseError(
        "EXECUTION_LEASE_NOT_ALLOWED",
        "Bounded implementation requires an execution-ready Change Case.",
      );
    if (
      !Number.isInteger(expectedVersion) ||
      expectedVersion !== changeCase.projectionVersion
    )
      throw new ChangeCaseError(
        "VERSION_CONFLICT",
        "The Change Case changed before implementation could begin.",
      );
    const adapter = this.resolveAdapter(provider);
    const task = suppliedTask ?? this.policy.taskFor(changeCase);
    const request = this.#leaseRequest(adapter);
    const issued = await this.executionRepository.issueLease({
      scope,
      principal,
      changeCaseId: changeCase.id,
      request,
    });
    return {
      scope,
      principal,
      changeCase,
      expectedVersion,
      idempotencyKey,
      adapter,
      task,
      issued,
    };
  }

  async #complete({
    scope,
    principal,
    changeCase,
    expectedVersion,
    idempotencyKey,
    adapter,
    task,
    issued,
  }) {
    let result;
    try {
      const lease = await this.executionRepository.dispatchContext({
        scope,
        leaseId: issued.leaseId,
        runId: issued.runId,
      });
      result = await this.broker.execute({
        adapter,
        task,
        repository: this.policy.repository,
        timeoutMs: lease.limits.maxDurationSeconds * 1000,
        onProgress: (phase) =>
          this.executionRepository.recordProgress({
            scope,
            runId: issued.runId,
            phase,
          }),
      });
    } catch (error) {
      result = failureResult(error);
    }
    const completionResult = toCompletionResult(result);
    const completion = await this.executionRepository.completeDispatch({
      scope,
      leaseId: issued.leaseId,
      runId: issued.runId,
      request: {
        provider: adapter.provider,
        taskDigest: sha256(task),
        policyVersion: this.policy.version,
      },
      result: completionResult,
    });
    if (
      !result.accepted ||
      !result.promoted ||
      !result.candidateDigest ||
      completion.status !== "COMPLETED"
    ) {
      return Object.freeze({
        accepted: false,
        lease: issued,
        completion,
        candidateDigest: null,
        result: publicResult(result),
      });
    }
    let transition;
    try {
      transition = await this.changeCaseRepository.transition({
        scope,
        principal,
        changeCaseId: changeCase.id,
        toState: "AWAITING_VERIFICATION",
        expectedVersion,
        idempotencyKey,
      });
    } catch (error) {
      if (error instanceof ChangeCaseError) {
        const current = await this.changeCaseRepository.get(scope, changeCase.id);
        if (current?.state === "AWAITING_VERIFICATION") {
          return Object.freeze({
            accepted: true,
            lease: issued,
            completion,
            transition: null,
            candidateDigest: result.candidateDigest,
            result: publicResult(result),
          });
        }
      }
      throw error;
    }
    return Object.freeze({
      accepted: true,
      lease: issued,
      completion,
      transition,
      candidateDigest: result.candidateDigest,
      result: publicResult(result),
    });
  }

  #leaseRequest(adapter) {
    const policy = this.policy;
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
      durationSeconds: policy.durationSeconds,
    };
  }
}

function failureResult(error) {
  const code =
    error instanceof ChangeCaseError
      ? error.code
      : "CODING_AGENT_EXECUTION_FAILED";
  const errorDetails = safeErrorDetails({
    ...error?.details,
    failureStage: failureStageFor(code),
  });
  return {
    accepted: false,
    promoted: false,
    code: 1,
    signal: null,
    timedOut: false,
    quotaExceeded: false,
    output: "",
    outputBytes: 0,
    outputDigest: sha256(""),
    errorCode: diagnosticCode(code, errorDetails),
    errorDetails,
    timings: safeTimings(error?.executionTimings),
    candidateDigest: null,
  };
}

function diagnosticCode(code, details) {
  if (code !== "AZURE_OPENAI_GATEWAY_REQUEST_FAILED") return code;
  const gateway = [details?.gatewayCode, details?.gatewayParam]
    .filter(Boolean)
    .join(":");
  return gateway ? `${code} (${gateway})` : code;
}

function toCompletionResult(result) {
  const artifacts = result.candidateDigest
    ? [
        {
          mediaType: "application/vnd.adx.candidate-digest",
          digest: result.candidateDigest,
          bytes: 0,
        },
      ]
    : [];
  if (result.featureSpotlight)
    artifacts.push({
      mediaType: "application/vnd.adx.feature-spotlight+json",
      digest: sha256(result.featureSpotlight),
      bytes: Buffer.byteLength(JSON.stringify(result.featureSpotlight)),
      metadata: result.featureSpotlight,
    });
  return {
    code: Number(result.code ?? 1),
    signal: result.signal ?? null,
    timedOut: Boolean(result.timedOut),
    quotaExceeded: Boolean(result.quotaExceeded),
    outputDigest:
      typeof result.outputDigest === "string" &&
      result.outputDigest.startsWith("sha256:")
        ? result.outputDigest
        : null,
    outputBytes: Number(result.outputBytes ?? 0),
    errorCode: result.errorCode ?? null,
    errorDetails: result.errorDetails ?? null,
    timings: safeTimings(result.timings),
    artifacts,
  };
}

function publicResult(result) {
  return Object.freeze({
    provider: result.provider ?? null,
    code: Number(result.code ?? 1),
    signal: result.signal ?? null,
    timedOut: Boolean(result.timedOut),
    quotaExceeded: Boolean(result.quotaExceeded),
    outputDigest: result.outputDigest ?? sha256(""),
    outputBytes: Number(result.outputBytes ?? 0),
    errorCode: result.errorCode ?? null,
  });
}

function safeErrorDetails(details) {
  const providerStatus = Number(details?.providerStatus);
  const providerRequestId =
    typeof details?.providerRequestId === "string" &&
    details.providerRequestId.length <= 256
      ? details.providerRequestId
      : null;
  const gatewayCode =
    typeof details?.gatewayError?.code === "string" &&
    details.gatewayError.code.length <= 128
      ? details.gatewayError.code
      : null;
  const gatewayParam =
    typeof details?.gatewayError?.param === "string" &&
    details.gatewayError.param.length <= 128
      ? details.gatewayError.param
      : null;
  const responseIssue = [
    "NON_JSON",
    "SCHEMA_INVALID",
    "PATCH_INVALID",
  ].includes(details?.responseIssue)
    ? details.responseIssue
    : null;
  const modelFinishReason = ["stop", "length", "content_filter"].includes(
    details?.modelFinishReason,
  )
    ? details.modelFinishReason
    : null;
  const modelAttempts =
    Number.isInteger(details?.modelAttempts) &&
    details.modelAttempts >= 1 &&
    details.modelAttempts <= 2
      ? details.modelAttempts
      : null;
  const failureStage = [
    "SETUP",
    "MODEL_RESPONSE",
    "VALIDATION",
    "EXECUTION",
  ].includes(details?.failureStage)
    ? details.failureStage
    : null;
  const validationCommand = ["node --test", "npm run verify:health-x"].includes(
    details?.validationCommand,
  )
    ? details.validationCommand
    : null;
  const validationCategory = ["CHECK_FAILED", "TIMED_OUT", "SIGNALED"].includes(
    details?.validationCategory,
  )
    ? details.validationCategory
    : null;
  const validationOutputExcerpt =
    typeof details?.validationOutputExcerpt === "string" &&
    details.validationOutputExcerpt.length <= 4096
      ? details.validationOutputExcerpt
      : null;
  const validationFailureReason =
    typeof details?.validationFailureReason === "string" &&
    details.validationFailureReason.length <= 256
      ? details.validationFailureReason
      : null;
  const safe = {
    provider:
      details?.provider === "AZURE_OPENAI_GATEWAY" ? details.provider : null,
    providerStatus:
      Number.isInteger(providerStatus) &&
      providerStatus >= 100 &&
      providerStatus <= 599
        ? providerStatus
        : null,
    providerRequestId,
    gatewayCode,
    gatewayParam,
    responseIssue,
    modelFinishReason,
    modelAttempts,
    failureStage,
    validationCommand,
    validationCategory,
    validationOutputExcerpt,
    validationFailureReason,
  };
  return Object.values(safe).some(Boolean) ? safe : null;
}

function failureStageFor(code) {
  if (code.startsWith("MODEL_PATCH_VALIDATION")) return "VALIDATION";
  if (code.startsWith("MODEL_PATCH_RESPONSE")) return "MODEL_RESPONSE";
  if (
    code.includes("CONFIGURED") ||
    code.includes("SOURCE") ||
    code.includes("DEPENDENCIES") ||
    code.includes("CANDIDATE")
  )
    return "SETUP";
  return "EXECUTION";
}

function safeTimings(timings) {
  const safe = {};
  for (const field of [
    "contextMs",
    "workspaceCopyMs",
    "modelMs",
    "patchMs",
    "validationMs",
    "promotionMs",
    "totalMs",
  ]) {
    const value = Number(timings?.[field]);
    if (Number.isInteger(value) && value >= 0 && value <= 900_000)
      safe[field] = value;
  }
  return Object.keys(safe).length ? safe : null;
}
