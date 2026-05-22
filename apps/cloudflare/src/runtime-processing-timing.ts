export const HOSTED_RUNTIME_PROCESSING_RECHECK_MARGIN_MS = 5_000;

export function computeHostedRuntimeProcessingRecheckDelayMs(input: {
  idleCheckpointDelayMs: number;
}): number {
  return input.idleCheckpointDelayMs + HOSTED_RUNTIME_PROCESSING_RECHECK_MARGIN_MS;
}

export function assertHostedRuntimeProcessingTimingInvariants(input: {
  idleCheckpointDelayMs: number;
  runnerTimeoutMs: number;
}): void {
  const minimumRunnerTimeoutMs = computeHostedRuntimeProcessingRecheckDelayMs({
    idleCheckpointDelayMs: input.idleCheckpointDelayMs,
  });

  if (input.runnerTimeoutMs <= minimumRunnerTimeoutMs) {
    throw new TypeError(
      "HOSTED_EXECUTION_RUNNER_TIMEOUT_MS must be greater than "
        + "HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS plus "
        + `${HOSTED_RUNTIME_PROCESSING_RECHECK_MARGIN_MS}ms so Temporal owner-watchdog `
        + "rechecks cannot fire before the runtime idle checkpoint window.",
    );
  }
}
