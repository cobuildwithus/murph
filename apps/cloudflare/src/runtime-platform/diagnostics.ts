import {
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  readHostedExecutionSafeErrorName,
  readHostedRuntimeSafeErrorText,
  type HostedExecutionStructuredLogDetails,
} from "@murphai/hosted-execution";
import type { HostedWorkspaceSnapshotV2Ref } from "@murphai/hosted-execution/workspace-snapshot-v2";

import { readHostedWorkspaceSnapshotProcessFailureDiagnostics } from "../workspace-snapshot-local.ts";
import {
  HOSTED_REPLAY_SAFE_READ_RETRY_ATTEMPTS,
  readHostedRuntimeControlPlaneFetchFailureDiagnostics,
  shouldRetryHostedRuntimeReplaySafeRead,
  sleepHostedReplaySafeReadRetryDelay,
} from "./control-plane-fetch.ts";

const HOSTED_WORKSPACE_SNAPSHOT_RESTORE_STEP_MARKER =
  "hostedWorkspaceSnapshotRestoreStep";
export type HostedWorkspaceSnapshotRestoreStep =
  | "data_key_unwrap"
  | "object_fetch"
  | "presign_get"
  | "size_guard";

const HOSTED_WORKSPACE_SNAPSHOT_RESTORE_STEPS =
  new Set<HostedWorkspaceSnapshotRestoreStep>([
    "data_key_unwrap",
    "object_fetch",
    "presign_get",
    "size_guard",
  ]);

export function buildHostedWorkspaceSnapshotRestoreLogDetails(input: {
  ref: HostedWorkspaceSnapshotV2Ref;
  timeoutMs: number;
}): HostedExecutionStructuredLogDetails {
  return {
    archiveCompression: input.ref.archive.compression,
    archiveEncryptedByteSize: input.ref.archive.encryptedByteSize,
    archiveFileCount: input.ref.archive.fileCount,
    archiveTotalPlainBytes: input.ref.archive.totalPlainBytes,
    operation: "workspace_snapshot_restore",
    timeoutMs: input.timeoutMs,
  };
}

export async function runHostedWorkspaceSnapshotRestoreReplaySafeReadStep<T>(input: {
  details: HostedExecutionStructuredLogDetails;
  onAttempt?(attempt: number): void;
  run(): Promise<T>;
  step: HostedWorkspaceSnapshotRestoreStep;
}): Promise<T> {
  let lastError: unknown;

  for (
    let attempt = 1;
    attempt <= HOSTED_REPLAY_SAFE_READ_RETRY_ATTEMPTS;
    attempt += 1
  ) {
    input.onAttempt?.(attempt);
    const attemptDetails = {
      ...input.details,
      workspaceSnapshotRestoreAttempt: attempt,
      workspaceSnapshotRestoreMaxAttempts: HOSTED_REPLAY_SAFE_READ_RETRY_ATTEMPTS,
    };

    try {
      return await runHostedWorkspaceSnapshotRestoreStep({
        ...input,
        details: attemptDetails,
      });
    } catch (error) {
      lastError = error;
      const retrying = shouldRetryHostedRuntimeReplaySafeRead({
        attempt,
        error,
      });
      if (!retrying) {
        throw error;
      }

      emitHostedExecutionStructuredLog({
        component: "hosted.runtime.workspace-snapshot",
        details: {
          ...attemptDetails,
          retrying,
          workspaceSnapshotRestoreStep: input.step,
          ...buildHostedRuntimeSafeErrorMetadata(error),
        },
        level: "warn",
        message: "Hosted workspace snapshot restore read step failed; retrying.",
        phase: "runtime.starting",
        userId: null,
      });
      await sleepHostedReplaySafeReadRetryDelay();
    }
  }

  throw lastError;
}

export async function runHostedWorkspaceSnapshotRestoreStep<T>(input: {
  details: HostedExecutionStructuredLogDetails;
  run(): Promise<T>;
  step: HostedWorkspaceSnapshotRestoreStep;
}): Promise<T> {
  const startedAt = Date.now();
  emitHostedExecutionStructuredLog({
    component: "hosted.runtime.workspace-snapshot",
    details: {
      ...input.details,
      workspaceSnapshotRestoreStep: input.step,
    },
    message: "Hosted workspace snapshot restore step started.",
    phase: "runtime.starting",
    userId: null,
  });

  try {
    const result = await input.run();
    emitHostedExecutionStructuredLog({
      component: "hosted.runtime.workspace-snapshot",
      details: {
        ...input.details,
        durationMs: Date.now() - startedAt,
        workspaceSnapshotRestoreStep: input.step,
      },
      message: "Hosted workspace snapshot restore step completed.",
      phase: "runtime.starting",
      userId: null,
    });
    return result;
  } catch (error) {
    annotateHostedWorkspaceSnapshotRestoreStep(error, input.step);
    emitHostedExecutionStructuredLog({
      component: "hosted.runtime.workspace-snapshot",
      details: {
        ...input.details,
        durationMs: Date.now() - startedAt,
        workspaceSnapshotRestoreStep: input.step,
        ...buildHostedRuntimeSafeErrorMetadata(error),
      },
      level: "warn",
      message: "Hosted workspace snapshot restore step failed.",
      phase: "runtime.starting",
      userId: null,
    });
    throw error;
  }
}

function annotateHostedWorkspaceSnapshotRestoreStep(
  error: unknown,
  step: HostedWorkspaceSnapshotRestoreStep,
): void {
  if (!error || typeof error !== "object") {
    return;
  }
  const record = error as Record<string, unknown>;
  if (
    readHostedWorkspaceSnapshotRestoreStepValue(
      record[HOSTED_WORKSPACE_SNAPSHOT_RESTORE_STEP_MARKER],
    )
  ) {
    return;
  }
  try {
    Object.defineProperty(error, HOSTED_WORKSPACE_SNAPSHOT_RESTORE_STEP_MARKER, {
      configurable: true,
      enumerable: false,
      value: step,
    });
  } catch {
    // Best-effort diagnostics only; never mask the original restore failure.
  }
}

export function readHostedWorkspaceSnapshotRestoreStep(
  error: unknown,
): HostedWorkspaceSnapshotRestoreStep | null {
  let current: unknown = error;
  const seen = new Set<unknown>();

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as Record<string, unknown>;
    const step = readHostedWorkspaceSnapshotRestoreStepValue(
      record[HOSTED_WORKSPACE_SNAPSHOT_RESTORE_STEP_MARKER],
    );
    if (step) {
      return step;
    }
    current = "cause" in record ? record.cause : null;
  }

  return null;
}

function readHostedWorkspaceSnapshotRestoreStepValue(
  value: unknown,
): HostedWorkspaceSnapshotRestoreStep | null {
  return (
    typeof value === "string"
    && HOSTED_WORKSPACE_SNAPSHOT_RESTORE_STEPS.has(
      value as HostedWorkspaceSnapshotRestoreStep,
    )
  )
    ? (value as HostedWorkspaceSnapshotRestoreStep)
    : null;
}
export function buildHostedRuntimeSafeErrorMetadata(
  error: unknown,
  options: {
    includeSafeErrorText?: boolean;
  } = {},
): HostedExecutionStructuredLogDetails {
  const fetchFailureDiagnostics =
    readHostedRuntimeControlPlaneFetchFailureDiagnostics(error);
  const workspaceSnapshotRestoreStep =
    readHostedWorkspaceSnapshotRestoreStep(error);
  const workspaceSnapshotProcessFailure =
    readHostedWorkspaceSnapshotProcessFailureDiagnostics(error);
  const safeErrorText = options.includeSafeErrorText === false
    ? null
    : readHostedRuntimeSafeErrorText(error);
  const errorName = readHostedExecutionSafeErrorName(error);
  return {
    errorCode: fetchFailureDiagnostics?.fetchCauseCode
      ?? deriveHostedExecutionErrorCode(error),
    errorMessagePresent: error instanceof Error && error.message.trim().length > 0,
    ...(safeErrorText ? { safeErrorText } : {}),
    ...(errorName ? { errorName } : {}),
    ...(fetchFailureDiagnostics
      ? {
          fetchCallerSignalAborted:
            fetchFailureDiagnostics.fetchCallerSignalAborted,
          fetchCauseCode: fetchFailureDiagnostics.fetchCauseCode,
          fetchCauseKind: fetchFailureDiagnostics.fetchCauseKind,
          ...(fetchFailureDiagnostics.fetchCauseName
            ? { fetchCauseName: fetchFailureDiagnostics.fetchCauseName }
            : {}),
          fetchRequestSignalAborted:
            fetchFailureDiagnostics.fetchRequestSignalAborted,
          fetchTimeoutMs: fetchFailureDiagnostics.fetchTimeoutMs,
          fetchTimeoutSignalAborted:
            fetchFailureDiagnostics.fetchTimeoutSignalAborted,
        }
      : {}),
    ...(workspaceSnapshotRestoreStep
      ? { workspaceSnapshotRestoreStep }
      : {}),
    ...(workspaceSnapshotProcessFailure
      ? {
          workspaceSnapshotProcessLabel: workspaceSnapshotProcessFailure.label,
          ...(workspaceSnapshotProcessFailure.exitCode !== null
            ? {
                workspaceSnapshotProcessExitCode:
                  workspaceSnapshotProcessFailure.exitCode,
              }
            : {}),
          ...(workspaceSnapshotProcessFailure.signal
            ? {
                workspaceSnapshotProcessSignal:
                  workspaceSnapshotProcessFailure.signal,
              }
            : {}),
          workspaceSnapshotProcessStderrBytes:
            workspaceSnapshotProcessFailure.stderrByteCount,
          workspaceSnapshotProcessStderrLineCount:
            workspaceSnapshotProcessFailure.stderrLineCount,
          ...(workspaceSnapshotProcessFailure.stderrMarkers.length > 0
            ? {
                workspaceSnapshotProcessStderrMarkers:
                  [...workspaceSnapshotProcessFailure.stderrMarkers],
              }
            : {}),
          workspaceSnapshotProcessStderrTruncated:
            workspaceSnapshotProcessFailure.stderrTruncated,
        }
      : {}),
  };
}
export function readHostedRuntimeStepElapsedMs(startedAt: number): number {
  const elapsedMs = Date.now() - startedAt;
  return Number.isSafeInteger(elapsedMs) && elapsedMs >= 0
    ? elapsedMs
    : 0;
}
