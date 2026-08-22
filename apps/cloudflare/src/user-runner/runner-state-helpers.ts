import type {
  DurableObjectSqlValue,
  RunnerRuntimeProcessingMode,
  RunnerWriteFenceKind,
  RunnerStateRecord,
} from "./types.js";

export interface RunnerMetaRow {
  [key: string]: DurableObjectSqlValue;
  active_attempt_id: string | null;
  active_generation: number;
  active_kind: string | null;
  active_provider_egress_token_hash: string | null;
  active_custom_inference_envelope: string | null;
  active_platform_ai_allowed: number | null;
  active_reason: string | null;
  active_runner_container_name: string | null;
  active_started_at: string | null;
  active_workspace_version: string | null;
  failure_count: number;
  last_error_at: string | null;
  last_error_code: string | null;
  last_invocation_at: string | null;
  user_id: string;
}

export function createDefaultRunnerMetaRow(userId: string): RunnerMetaRow {
  return {
    active_attempt_id: null,
    active_generation: 0,
    active_kind: null,
    active_provider_egress_token_hash: null,
    active_custom_inference_envelope: null,
    active_platform_ai_allowed: null,
    active_reason: null,
    active_runner_container_name: null,
    active_started_at: null,
    active_workspace_version: null,
    failure_count: 0,
    last_error_at: null,
    last_error_code: null,
    last_invocation_at: null,
    user_id: userId,
  };
}

export function projectRunnerStateRecord(input: {
  meta: RunnerMetaRow;
}): RunnerStateRecord {
  const writeFenceKind = readWriteFenceKind(input.meta.active_kind);
  const writeFenceGeneration = normalizeNonNegativeInteger(input.meta.active_generation);
  const runnerContainerName = readRunnerContainerNameOrNull(
    input.meta.active_runner_container_name,
  );
  const writeFence = input.meta.active_attempt_id && input.meta.active_started_at && writeFenceKind
      ? {
        attemptId: input.meta.active_attempt_id,
        generation: writeFenceGeneration,
        kind: writeFenceKind,
        processingMode: readRunnerRuntimeProcessingMode(input.meta.active_reason),
        runnerContainerName,
        startedAt: input.meta.active_started_at,
        workspaceVersion: input.meta.active_workspace_version,
      }
    : null;
  const failureCount = normalizeNonNegativeInteger(input.meta.failure_count);

  return {
    writeFence,
    failureCount,
    lastErrorAt: input.meta.last_error_at,
    lastErrorCode: input.meta.last_error_code,
    lastInvocationAt: input.meta.last_invocation_at,
    pendingRunnerContainerName: writeFence ? null : runnerContainerName,
    userId: input.meta.user_id,
  };
}

function readRunnerContainerNameOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function normalizeNonNegativeInteger(value: number | null): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function normalizeIsoDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError("Hosted runner date must be an ISO date string.");
  }

  return parsed.toISOString();
}

export function normalizeIsoDateOrNull(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return normalizeIsoDate(value);
}

export function readWriteFenceKind(value: string | null): RunnerWriteFenceKind | null {
  return value === "runtime" ? value : null;
}

export function readRunnerRuntimeProcessingMode(
  value: unknown,
): RunnerRuntimeProcessingMode {
  return value === "environment_interview"
      || value === "inbox_media_retention"
      || value === "system_mailbox"
    ? value
    : "default";
}
