export const HOSTED_RUNTIME_PROCESSING_RECHECK_MARGIN_MS = 5_000;

export function computeHostedRuntimeProcessingRecheckDelayMs(input: {
  runnerIdleTtlMs: number;
  runnerCommitTimeoutMs: number;
}): number {
  return input.runnerIdleTtlMs
    + input.runnerCommitTimeoutMs
    + HOSTED_RUNTIME_PROCESSING_RECHECK_MARGIN_MS;
}
