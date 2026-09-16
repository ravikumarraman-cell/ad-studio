import { ChangeCaseError, sha256 } from "./change-case-ledger.mjs";
import {
  failureResult,
  publicResult,
  toCompletionResult,
} from "./coding-agent-execution-diagnostics.mjs";
import { createLeasedExecutionRunner } from "./leased-execution-runner.mjs";

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
    heartbeatIntervalMs = 5_000,
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
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    this.runLeasedExecution = createLeasedExecutionRunner({
      executionRepository,
      broker,
      heartbeatIntervalMs,
      toFailureResult: failureResult,
    });
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
    if (
      changeCase?.state !== "READY_FOR_EXECUTION" &&
      changeCase?.state !== "AWAITING_VERIFICATION"
    )
      throw new ChangeCaseError(
        "EXECUTION_LEASE_NOT_ALLOWED",
        "Bounded implementation requires an execution-ready Change Case or a candidate awaiting corrective verification.",
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
    const result = await this.runLeasedExecution({
      scope,
      issued,
      adapter,
      task,
      repository: this.policy.repository,
    });
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
