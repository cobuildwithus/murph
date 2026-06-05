export const HOSTED_RUNTIME_PROCESSING_RECHECK_MARGIN_MS = 5_000;

export function computeHostedRuntimeProcessingRecheckDelayMs(input: {
  idleCheckpointDelayMs: number;
  runnerCommitTimeoutMs: number;
}): number {
  return input.idleCheckpointDelayMs
    + input.runnerCommitTimeoutMs
    + HOSTED_RUNTIME_PROCESSING_RECHECK_MARGIN_MS;
}
