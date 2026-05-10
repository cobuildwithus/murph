/**
 * Pure thin-runner projection helpers extracted from RunnerStateStore. The
 * store still owns SQL-backed lease/runtime transitions; this module owns
 * normalization, projection, and wake scheduling.
 */

import {
  summarizeHostedExecutionErrorCode,
} from "@murphai/hosted-execution";
import type { HostedExecutionBundleRef } from "@murphai/runtime-state";

import type {
  DurableObjectSqlValue,
  RunnerAlarmKind,
  RunnerStateRecord,
} from "./types.js";

export interface RunnerMetaRow {
  [key: string]: DurableObjectSqlValue;
  active_invocation_expires_at: string | null;
  active_invocation_id: string | null;
  active_invocation_last_heartbeat_at: string | null;
  active_invocation_orphan_observed_at: string | null;
  active_invocation_reason: string | null;
  active_invocation_started_at: string | null;
  active_invocation_worker_version_id: string | null;
  active_workspace_version: string | null;
  alarm_checkpoint_next_wake_at: string | null;
  alarm_due_at: string | null;
  alarm_kind: string | null;
  alarm_workspace_version: string | null;
  lease_generation: number;
  in_flight: number;
  last_error_at: string | null;
  last_error_code: string | null;
  last_invocation_at: string | null;
  deferred_checkpoint_required: number;
  idle_shutdown_checkpoint_due_at: string | null;
  idle_shutdown_checkpoint_workspace_version: string | null;
  next_wake_at: string | null;
  pending_nudge: number;
  pending_work: number;
  retry_failure_count: number;
  user_id: string;
}

export interface RunnerStateProjection {
  record: RunnerStateRecord;
}

export function createDefaultRunnerMetaRow(userId: string): RunnerMetaRow {
  return {
    active_invocation_expires_at: null,
    active_invocation_id: null,
    active_invocation_last_heartbeat_at: null,
    active_invocation_orphan_observed_at: null,
    active_invocation_reason: null,
    active_invocation_started_at: null,
    active_invocation_worker_version_id: null,
    active_workspace_version: null,
    alarm_checkpoint_next_wake_at: null,
    alarm_due_at: null,
    alarm_kind: null,
    alarm_workspace_version: null,
    lease_generation: 0,
    in_flight: 0,
    last_error_at: null,
    last_error_code: null,
    last_invocation_at: null,
    deferred_checkpoint_required: 0,
    idle_shutdown_checkpoint_due_at: null,
    idle_shutdown_checkpoint_workspace_version: null,
    next_wake_at: null,
    pending_nudge: 0,
    pending_work: 0,
    retry_failure_count: 0,
    user_id: userId,
  };
}

export function projectRunnerStateRecord(input: {
  bundleRef: HostedExecutionBundleRef | null;
  meta: RunnerMetaRow;
}): RunnerStateProjection {
  const nextLastError = summarizeHostedExecutionErrorCode(input.meta.last_error_code);
  const hasPersistedInvocationLease = input.meta.active_invocation_id !== null
    && input.meta.active_invocation_started_at !== null;
  const active = hasPersistedInvocationLease
    ? {
        attemptId: input.meta.active_invocation_id ?? "",
        expiresAt: input.meta.active_invocation_expires_at
          ?? input.meta.active_invocation_started_at
          ?? "",
        leaseGeneration: normalizeRetryFailureCount(input.meta.lease_generation).toString(),
        reason: input.meta.active_invocation_reason,
        startedAt: input.meta.active_invocation_started_at ?? "",
        workspaceVersion: input.meta.active_workspace_version,
      }
    : null;
  const alarm = readRunnerAlarmFromMeta(input.meta);
  const pendingWork = input.meta.pending_work === 1 || input.meta.pending_nudge === 1;

  return {
    record: {
      active,
      alarm,
      bundleRef: input.bundleRef,
      inFlight: hasPersistedInvocationLease,
      lastError: nextLastError,
      lastErrorAt: input.meta.last_error_at,
      lastErrorCode: input.meta.last_error_code,
      lastInvocationAt: input.meta.last_invocation_at,
      pendingWork,
      retry: {
        count: normalizeRetryFailureCount(input.meta.retry_failure_count),
        lastErrorAt: input.meta.last_error_at,
        lastErrorCode: input.meta.last_error_code,
      },
      schema: "murph.hosted-runner.v2",
      deferredCheckpointRequired: input.meta.deferred_checkpoint_required === 1,
      idleShutdownCheckpointDueAt: alarm?.kind === "idle_checkpoint"
        ? alarm.dueAt
        : input.meta.idle_shutdown_checkpoint_due_at,
      idleShutdownCheckpointWorkspaceVersion: alarm?.kind === "idle_checkpoint"
        ? alarm.workspaceVersion
        : input.meta.idle_shutdown_checkpoint_workspace_version,
      leaseGeneration: input.meta.lease_generation,
      nextWakeAt: alarm?.kind === "work"
        ? alarm.dueAt
        : input.meta.next_wake_at,
      pendingNudge: pendingWork,
      retryFailureCount: normalizeRetryFailureCount(input.meta.retry_failure_count),
      userId: input.meta.user_id,
      workspaceInvocation: hasPersistedInvocationLease
        ? {
            attemptId: input.meta.active_invocation_id ?? "",
            lastHeartbeatAt: input.meta.active_invocation_last_heartbeat_at,
            orphanObservedAt: input.meta.active_invocation_orphan_observed_at,
            reason: input.meta.active_invocation_reason,
            startedAt: input.meta.active_invocation_started_at ?? "",
            workspaceVersion: input.meta.active_workspace_version,
          }
        : null,
    },
  };
}

export function normalizeRetryFailureCount(value: number | null): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function resolveRunnerNextWakeAt(input: {
  preferredWakeAt?: string | null;
}): string | null {
  return normalizePreferredWakeAt(input.preferredWakeAt ?? null);
}

function normalizePreferredWakeAt(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs)) {
    return null;
  }

  return new Date(Math.max(parsedMs, Date.now())).toISOString();
}

function readRunnerAlarmFromMeta(meta: RunnerMetaRow): RunnerStateRecord["alarm"] {
  const storedKind = readRunnerAlarmKind(meta.alarm_kind);
  const storedDueAt = normalizeAlarmDueAt(meta.alarm_due_at);
  if (storedKind && storedDueAt) {
    return {
      checkpointNextWakeAt: normalizeNullableIsoDate(meta.alarm_checkpoint_next_wake_at),
      dueAt: storedDueAt,
      kind: storedKind,
      workspaceVersion: typeof meta.alarm_workspace_version === "string"
        ? meta.alarm_workspace_version
        : null,
    };
  }

  const idleDueAt = normalizeAlarmDueAt(meta.idle_shutdown_checkpoint_due_at);
  if (idleDueAt) {
    return {
      checkpointNextWakeAt: normalizeNullableIsoDate(meta.next_wake_at),
      dueAt: idleDueAt,
      kind: "idle_checkpoint",
      workspaceVersion: typeof meta.idle_shutdown_checkpoint_workspace_version === "string"
        ? meta.idle_shutdown_checkpoint_workspace_version
        : null,
    };
  }

  const workDueAt = normalizeAlarmDueAt(meta.next_wake_at);
  return workDueAt
    ? {
        checkpointNextWakeAt: null,
        dueAt: workDueAt,
        kind: "work",
        workspaceVersion: null,
      }
    : null;
}

function readRunnerAlarmKind(value: string | null): RunnerAlarmKind | null {
  return value === "work" || value === "idle_checkpoint" ? value : null;
}

function normalizeAlarmDueAt(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const parsedMs = Date.parse(value);
  return Number.isFinite(parsedMs) ? new Date(parsedMs).toISOString() : null;
}

function normalizeNullableIsoDate(value: string | null): string | null {
  return normalizeAlarmDueAt(value);
}
