export function readHostedRunnerCommitTimeoutMs(timeoutMs: number | null): number {
  if (timeoutMs !== null && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return timeoutMs;
  }

  return 30_000;
}
