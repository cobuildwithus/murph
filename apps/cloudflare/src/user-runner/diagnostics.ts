import {
  buildHostedExecutionSafeErrorDiagnostics,
  deriveHostedExecutionErrorCode,
  type HostedExecutionStructuredLogDetails,
} from "@murphai/hosted-execution";

import type {
  RunnerContainerEnsureProcessingResult,
} from "../runner-container.js";
import type { RunnerStateRecord } from "./types.js";
import { readWriteFenceWatchdogAlarmAt } from "./watchdog.js";

export type RuntimeProcessingRetryReason =
  | "active_child_rejected"
  | "container_busy"
  | "container_rpc_error"
  | "container_rpc_timeout"
  | "missing_container_binding"
  | "stale_fence_replacement_race";

export type RuntimeProcessingStartFailureRetryReason = Extract<
  RuntimeProcessingRetryReason,
  "container_rpc_error" | "container_rpc_timeout" | "missing_container_binding"
>;

export function buildRunnerRecordTimingLogDetails(
  record: RunnerStateRecord,
  nowMs = Date.now(),
): HostedExecutionStructuredLogDetails {
  const writeFence = record.writeFence;
  const writeFenceStartedAtMs = writeFence ? Date.parse(writeFence.startedAt) : NaN;

  return {
    activeWriteFenceAgeMs: Number.isFinite(writeFenceStartedAtMs)
      ? Math.max(0, nowMs - writeFenceStartedAtMs)
      : null,
    activeWriteFenceGeneration: writeFence?.generation ?? null,
    activeWriteFencePresent: writeFence !== null,
    activeWriteFenceWorkspaceVersion: writeFence?.workspaceVersion ?? null,
    failureCount: record.failureCount,
    lastErrorCode: record.lastErrorCode,
    watchdogAlarmAt: readWriteFenceWatchdogAlarmAt(record),
  };
}

export function buildRunnerWriteFenceValidationRejectedDetails(input: {
  attemptId: string;
  generation: string;
  record: RunnerStateRecord | null;
  userId: string;
  workspaceVersion: string | null;
}): HostedExecutionStructuredLogDetails {
  if (!input.record) {
    return {
      activeWriteFencePresent: false,
      activeWriteFenceWorkspaceVersionPresent: false,
      runnerStatePresent: false,
      writeFenceAttemptMatches: false,
      writeFenceGenerationMatches: false,
      writeFenceUserMatches: false,
      writeFenceValidationRejectReason: "missing_runner_state",
      writeFenceWorkspaceVersionMatches: false,
    };
  }

  const writeFence = input.record.writeFence;
  const writeFenceAttemptMatches = writeFence !== null
    && writeFence.attemptId === input.attemptId;
  const writeFenceGenerationMatches = writeFence !== null
    && String(writeFence.generation) === input.generation;
  const writeFenceUserMatches = input.record.userId === input.userId;
  const writeFenceWorkspaceVersionMatches = input.workspaceVersion === null
    || (
      writeFence !== null
      && writeFence.workspaceVersion === input.workspaceVersion
    );

  return {
    activeWriteFencePresent: writeFence !== null,
    activeWriteFenceWorkspaceVersionPresent: writeFence?.workspaceVersion !== null
      && writeFence?.workspaceVersion !== undefined,
    runnerStatePresent: true,
    writeFenceAttemptMatches,
    writeFenceGenerationMatches,
    writeFenceUserMatches,
    writeFenceWorkspaceVersionMatches,
    writeFenceValidationRejectReason: readRunnerWriteFenceValidationRejectReason({
      writeFenceAttemptMatches,
      writeFenceGenerationMatches,
      writeFencePresent: writeFence !== null,
      writeFenceUserMatches,
      writeFenceWorkspaceVersionMatches,
    }),
  };
}

export function readRunnerWriteFenceValidationRejectReason(input: {
  writeFenceAttemptMatches: boolean;
  writeFenceGenerationMatches: boolean;
  writeFencePresent: boolean;
  writeFenceUserMatches: boolean;
  writeFenceWorkspaceVersionMatches: boolean;
}): string {
  if (!input.writeFencePresent) {
    return "no_active_write_fence";
  }
  if (!input.writeFenceAttemptMatches) {
    return "attempt_mismatch";
  }
  if (!input.writeFenceGenerationMatches) {
    return "generation_mismatch";
  }
  if (!input.writeFenceUserMatches) {
    return "user_mismatch";
  }
  if (!input.writeFenceWorkspaceVersionMatches) {
    return "workspace_version_mismatch";
  }
  return "unknown";
}

export function buildHostedRunnerMetadataOnlyErrorDetails(
  error: unknown,
): HostedExecutionStructuredLogDetails {
  const diagnostics = buildHostedExecutionSafeErrorDiagnostics(error);
  if (!diagnostics) {
    return {};
  }

  return {
    detailsKeys: Object.keys(diagnostics).sort(),
    ...(typeof diagnostics.errorCode === "string" ? { errorCode: diagnostics.errorCode } : {}),
    ...(typeof diagnostics.errorCodeDetail === "string"
      ? { errorCodeDetail: diagnostics.errorCodeDetail }
      : {}),
    errorDetailPresent: typeof diagnostics.errorDetail === "string",
    ...(typeof diagnostics.errorMessage === "string" ? { errorMessage: diagnostics.errorMessage } : {}),
    ...(typeof diagnostics.errorName === "string" ? { errorName: diagnostics.errorName } : {}),
    ...(typeof diagnostics.errorStatus === "number" ? { errorStatus: diagnostics.errorStatus } : {}),
  };
}

export function safeCleanupErrorCode(error: unknown): string {
  const name = error instanceof Error ? error.name.trim() : "";
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(name)
    ? name
    : "UnknownError";
}

export function mapRunnerProcessingRetryReason(
  reason: Extract<
    RunnerContainerEnsureProcessingResult,
    { kind: "wake-unconfirmed" }
  >["reason"],
): RuntimeProcessingRetryReason {
  switch (reason) {
    case "active-child-rejected":
      return "active_child_rejected";
    case "container-rpc-error":
      return "container_rpc_error";
    case "container-rpc-timeout":
      return "container_rpc_timeout";
    case "missing-container-binding":
      return "missing_container_binding";
    case "missing-wake-method":
      return "container_rpc_error";
  }
}

export function classifyRuntimeStartFailureRetryReason(
  error: unknown,
): RuntimeProcessingStartFailureRetryReason {
  if (isMissingContainerBindingFailure(error)) {
    return "missing_container_binding";
  }

  return deriveHostedExecutionErrorCode(error) === "timeout"
    ? "container_rpc_timeout"
    : "container_rpc_error";
}

export function isMissingContainerBindingFailure(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "";
  const normalized = message.toLowerCase();
  return normalized.includes("runnercontainer binding")
    || normalized.includes("container binding");
}
