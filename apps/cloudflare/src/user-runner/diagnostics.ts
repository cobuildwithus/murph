import {
  buildHostedExecutionSafeErrorDiagnostics,
  deriveHostedExecutionErrorCode,
  type HostedExecutionStructuredLogDetails,
} from "@murphai/hosted-execution";
import type {
  HostedRuntimeRedactedJson,
} from "@murphai/hosted-execution/runtime-control";

import type {
  RunnerContainerEnsureProcessingResult,
} from "../runner-container.js";
import type { RunnerStateRecord } from "./types.js";

export type RuntimeProcessingRetryReason =
  | "active_child_rejected"
  | "checkpoint_handoff_pending"
  | "container_busy"
  | "container_rpc_error"
  | "container_rpc_timeout"
  | "command_budget_exhausted"
  | "missing_container_binding"
  | "starting_fence_preserved";

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
  };
}

export function buildRunnerWriteFenceValidationRejectedDetails(input: {
  attemptId: string;
  generation: string;
  record: RunnerStateRecord | null;
  userId: string;
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
    };
  }

  const writeFence = input.record.writeFence;
  const writeFenceAttemptMatches = writeFence !== null
    && writeFence.attemptId === input.attemptId;
  const writeFenceGenerationMatches = writeFence !== null
    && String(writeFence.generation) === input.generation;
  const writeFenceUserMatches = input.record.userId === input.userId;

  return {
    activeWriteFencePresent: writeFence !== null,
    activeWriteFenceWorkspaceVersionPresent: writeFence?.workspaceVersion !== null
      && writeFence?.workspaceVersion !== undefined,
    runnerStatePresent: true,
    writeFenceAttemptMatches,
    writeFenceGenerationMatches,
    writeFenceUserMatches,
    writeFenceValidationRejectReason: readRunnerWriteFenceValidationRejectReason({
      writeFenceAttemptMatches,
      writeFenceGenerationMatches,
      writeFencePresent: writeFence !== null,
      writeFenceUserMatches,
    }),
  };
}

export function readRunnerWriteFenceValidationRejectReason(input: {
  writeFenceAttemptMatches: boolean;
  writeFenceGenerationMatches: boolean;
  writeFencePresent: boolean;
  writeFenceUserMatches: boolean;
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
  return "unknown";
}

/**
 * Same metadata-only picks as `buildHostedRunnerMetadataOnlyErrorDetails`, plus
 * the shared sanitizer's bounded error detail and cause, narrowed to the
 * persisted runtime-log `redactedJson` value shape. Keys must pass the hosted
 * runtime-log redacted-key gate; sanitized error text uses the allowlisted
 * `safeError*` keys because the bare diagnostic keys are rejected by that gate.
 */
const SAFE_REDACTED_ERROR_CODE_DETAIL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/u;

export function buildHostedRunnerRedactedErrorJson(
  error: unknown,
): HostedRuntimeRedactedJson {
  const diagnostics = buildHostedExecutionSafeErrorDiagnostics(error);
  const details = buildHostedRunnerMetadataOnlyErrorDetails(error);
  const redacted: HostedRuntimeRedactedJson = {};
  for (const [key, value] of Object.entries(details)) {
    // `errorCodeDetail` is read from raw `.code`-shaped error properties and is
    // the only value here not safe by construction; keep it only when it looks
    // like a plain code token so one odd value can never make the web parser
    // reject the whole runtime-log request.
    if (key === "errorCodeDetail") {
      if (
        typeof value === "string"
        && SAFE_REDACTED_ERROR_CODE_DETAIL_PATTERN.test(value)
      ) {
        redacted[key] = value;
      }
      continue;
    }
    const redactedKey = key === "errorMessage" ? "safeErrorMessage" : key;
    if (
      typeof value === "boolean"
      || typeof value === "number"
      || typeof value === "string"
      || value === null
    ) {
      redacted[redactedKey] = value;
    } else if (
      Array.isArray(value)
      && value.every((item): item is string => typeof item === "string")
    ) {
      redacted[redactedKey] = value;
    }
  }
  if (typeof diagnostics?.errorDetail === "string") {
    redacted.safeErrorDetail = diagnostics.errorDetail;
  }
  if (typeof diagnostics?.errorCause === "string") {
    redacted.safeErrorCause = diagnostics.errorCause;
  }
  return redacted;
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
