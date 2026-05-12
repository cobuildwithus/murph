import {
  summarizeHostedExecutionErrorCode,
} from "@murphai/hosted-execution";
import type { HostedExecutionBundleRef } from "@murphai/runtime-state";

import type {
  DurableObjectSqlValue,
  RunnerWriteFenceKind,
  RunnerStateRecord,
} from "./types.js";

export interface RunnerMetaRow {
  [key: string]: DurableObjectSqlValue;
  active_attempt_id: string | null;
  active_expires_at: string | null;
  active_generation: number;
  active_kind: string | null;
  active_started_at: string | null;
  active_workspace_version: string | null;
  backoff_until: string | null;
  failure_count: number;
  last_error_at: string | null;
  last_error_code: string | null;
  last_invocation_at: string | null;
  user_id: string;
  wake_at: string | null;
}

export function createDefaultRunnerMetaRow(userId: string): RunnerMetaRow {
  return {
    active_attempt_id: null,
    active_expires_at: null,
    active_generation: 0,
    active_kind: null,
    active_started_at: null,
    active_workspace_version: null,
    backoff_until: null,
    failure_count: 0,
    last_error_at: null,
    last_error_code: null,
    last_invocation_at: null,
    user_id: userId,
    wake_at: null,
  };
}

export function projectRunnerStateRecord(input: {
  bundleRef: HostedExecutionBundleRef | null;
  meta: RunnerMetaRow;
}): RunnerStateRecord {
  const writeFenceKind = readWriteFenceKind(input.meta.active_kind);
  const writeFenceGeneration = normalizeNonNegativeInteger(input.meta.active_generation);
  const writeFence = input.meta.active_attempt_id && input.meta.active_started_at && writeFenceKind
    ? {
        attemptId: input.meta.active_attempt_id,
        expiresAt: normalizeIsoDateOrNull(input.meta.active_expires_at)
          ?? input.meta.active_started_at,
        generation: writeFenceGeneration,
        kind: writeFenceKind,
        startedAt: input.meta.active_started_at,
        workspaceVersion: input.meta.active_workspace_version,
      }
    : null;
  const activeReason = writeFence?.kind === "idle_checkpoint"
    ? "idle_shutdown_checkpoint"
    : writeFence
    ? "runtime"
    : null;
  const wakeAt = normalizeIsoDateOrNull(input.meta.wake_at);
  const backoffUntil = normalizeIsoDateOrNull(input.meta.backoff_until);
  const failureCount = normalizeNonNegativeInteger(input.meta.failure_count);
  const lastError = summarizeHostedExecutionErrorCode(input.meta.last_error_code);

  return {
    backoffUntil,
    writeFence,
    // Legacy active projection around the write fence. Delete after 2026-05-25.
    activeRun: writeFence,
    // Legacy active projection around the write fence. Delete after 2026-05-25.
    active: writeFence
      ? {
          attemptId: writeFence.attemptId,
          expiresAt: writeFence.expiresAt,
          leaseGeneration: String(writeFence.generation),
          reason: activeReason,
          startedAt: writeFence.startedAt,
          workspaceVersion: writeFence.workspaceVersion,
        }
      : null,
    bundleRef: input.bundleRef,
    // Legacy inFlight projection around the write fence. Delete after 2026-05-25.
    inFlight: writeFence !== null,
    lastError,
    lastErrorAt: input.meta.last_error_at,
    lastErrorCode: input.meta.last_error_code,
    lastInvocationAt: input.meta.last_invocation_at,
    leaseGeneration: writeFenceGeneration,
    failureCount,
    nextWakeAt: wakeAt,
    // Legacy pendingNudge projection around wake_at. Delete after 2026-05-25.
    pendingNudge: wakeAt !== null,
    // Legacy pendingNudge projection around wake_at. Delete after 2026-05-25.
    pendingNudgeGeneration: wakeAt !== null ? writeFenceGeneration : 0,
    // Legacy pendingWork projection around wake_at. Delete after 2026-05-25.
    pendingWork: wakeAt !== null,
    retry: {
      at: backoffUntil,
      count: failureCount,
      lastErrorCode: input.meta.last_error_code,
    },
    retryFailureCount: failureCount,
    schema: "murph.hosted-runner.v3",
    userId: input.meta.user_id,
    wakeAt,
    wakePending: wakeAt !== null,
    workspaceInvocation: writeFence
      ? {
          attemptId: writeFence.attemptId,
          lastHeartbeatAt: null,
          orphanObservedAt: null,
          reason: activeReason,
          startedAt: writeFence.startedAt,
          workspaceVersion: writeFence.workspaceVersion,
        }
      : null,
  };
}

export function normalizeNonNegativeInteger(value: number | null): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function normalizeIsoDate(value: string): string {
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

export function normalizePreferredWakeAt(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs)) {
    return null;
  }

  return new Date(Math.max(parsedMs, Date.now())).toISOString();
}

export function resolveRunnerNextWakeAt(record: RunnerStateRecord | {
  nextWakeAt?: string | null;
  preferredWakeAt?: string | null;
}): string | null {
  const legacy = record as { preferredWakeAt?: string | null };
  return normalizePreferredWakeAt(legacy.preferredWakeAt ?? null)
    ?? record.nextWakeAt
    ?? null;
}

function readWriteFenceKind(value: string | null): RunnerWriteFenceKind | null {
  return value === "runtime" || value === "idle_checkpoint" ? value : null;
}
