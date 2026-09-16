/**
 * Owns the lifetime of an already-issued execution lease. It deliberately
 * contains no Change Case policy: callers decide whether and how a completed
 * run changes application state.
 */
export function createLeasedExecutionRunner({
  executionRepository,
  broker,
  heartbeatIntervalMs,
  toFailureResult,
}) {
  if (
    !executionRepository ||
    !broker ||
    !Number.isInteger(heartbeatIntervalMs) ||
    heartbeatIntervalMs < 1 ||
    typeof toFailureResult !== "function"
  )
    throw new TypeError("LEASED_EXECUTION_RUNNER_CONFIGURATION_INVALID");

  return async function runLeasedExecution({
    scope,
    issued,
    adapter,
    task,
    repository,
  }) {
    let heartbeatTimer = null;
    try {
      const lease = await executionRepository.dispatchContext({
        scope,
        leaseId: issued.leaseId,
        runId: issued.runId,
      });
      heartbeatTimer = setInterval(() => {
        void executionRepository.heartbeatRun({ scope, runId: issued.runId }).catch(() => {});
      }, heartbeatIntervalMs);
      heartbeatTimer.unref?.();
      return await broker.execute({
        adapter,
        task,
        repository,
        timeoutMs: lease.limits.maxDurationSeconds * 1000,
        onProgress: (phase, details) =>
          executionRepository.recordProgress({
            scope,
            runId: issued.runId,
            phase,
            details,
          }),
      });
    } catch (error) {
      return toFailureResult(error);
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    }
  };
}
