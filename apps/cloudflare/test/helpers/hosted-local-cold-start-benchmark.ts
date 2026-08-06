import type {
  HostedRuntimeLatencyPhaseBreakdown,
} from "@murphai/hosted-execution/runtime-control";

interface ColdStartRuntimeLog {
  attemptId: string | null;
  component?: string;
  level: string;
  phase: string;
  redactedJson?: Record<string, unknown> | null;
}

interface ColdStartLatencyTrace {
  phaseBreakdown: HostedRuntimeLatencyPhaseBreakdown | null;
  runtimeAttemptId: string | null;
}

/**
 * A recovered startup is useful reliability evidence but not a valid latency
 * sample. Keep benchmark statistics limited to the first failure-free runtime
 * generation and one accepted attempt so retries cannot taint percentiles.
 */
export function assertSingleSuccessfulColdStartAttempt(
  runtimeLogs: readonly ColdStartRuntimeLog[],
  successfulAttemptId: string,
  workspaceWriteFenceGeneration: string,
): void {
  const failedLog = runtimeLogs.find((entry) =>
    entry.level === "error" || entry.phase === "error"
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
  if (workspaceWriteFenceGeneration !== "1") {
    throw new Error("Cold-start benchmark observed a recovered fresh runtime generation.");
  }
}

export function assertEstablishedR2ColdStartAttempt(input: {
  expectedEncryptedBytes: number;
  expectedPlainBytes: number;
  runtimeLogs: readonly ColdStartRuntimeLog[];
  successfulAttemptId: string;
  trace: ColdStartLatencyTrace;
  workspaceWriteFenceGeneration: string;
}): void {
  assertSingleSuccessfulColdStartAttempt(
    input.runtimeLogs,
    input.successfulAttemptId,
    input.workspaceWriteFenceGeneration,
  );

  if (input.trace.runtimeAttemptId !== input.successfulAttemptId) {
    throw new Error("Cold-start benchmark latency trace belongs to another runtime attempt.");
  }
  const phaseBreakdown = input.trace.phaseBreakdown;
  if (!phaseBreakdown || phaseBreakdown.boot?.restoreWasCold !== true) {
    throw new Error("Cold-start benchmark latency trace did not prove a cold restore.");
  }
  const restore = phaseBreakdown.restore;
  if (
    !restore
    || restore.encryptedBytes !== input.expectedEncryptedBytes
    || restore.plainBytes !== input.expectedPlainBytes
    || typeof restore.objectFetchMs !== "number"
    || !Number.isSafeInteger(restore.objectFetchMs)
    || restore.objectFetchMs < 0
  ) {
    throw new Error("Cold-start benchmark latency trace did not match the restored v2 snapshot.");
  }
  if (restore.replaySafeReadMaxAttempt !== 1) {
    const observedAttempt = restore.replaySafeReadMaxAttempt ?? "missing";
    throw new Error(
      `Cold-start benchmark observed a recovered workspace snapshot restore (replaySafeReadMaxAttempt=${observedAttempt}).`,
    );
  }
}
