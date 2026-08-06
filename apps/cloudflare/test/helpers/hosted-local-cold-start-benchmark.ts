interface ColdStartRuntimeLog {
  attemptId: string | null;
  level: string;
  phase: string;
}

/**
 * A recovered startup is useful reliability evidence but not a valid latency
 * sample. Keep benchmark statistics limited to one failure-free runtime
 * attempt so retries cannot silently inflate the reported percentiles.
 */
export function assertSingleSuccessfulColdStartAttempt(
  runtimeLogs: readonly ColdStartRuntimeLog[],
  successfulAttemptId: string,
): void {
  const failedLog = runtimeLogs.find((entry) =>
    entry.level === "error" || entry.phase === "failed"
  );
  if (failedLog) {
    throw new Error("Cold-start benchmark observed a failed runtime phase.");
  }

  const attemptIds = new Set(
    runtimeLogs.flatMap((entry) => entry.attemptId ? [entry.attemptId] : []),
  );
  if (attemptIds.size !== 1 || !attemptIds.has(successfulAttemptId)) {
    throw new Error("Cold-start benchmark observed more than one runtime attempt.");
  }
}
