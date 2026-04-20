/**
 * Pure thin-runner projection helpers extracted from RunnerStateStore. The
 * store still owns SQL-backed lease/runtime transitions; this module owns
 * normalization, projection, and wake scheduling.
 */

import {
  summarizeHostedExecutionErrorCode,
  type HostedExecutionRunStatus,
  type HostedExecutionTimelineEntry,
} from "@murphai/hosted-execution";
import type { HostedExecutionBundleRef } from "@murphai/runtime-state";

import type {
  DurableObjectSqlValue,
  RunnerStateRecord,
} from "./types.js";

export interface RunnerMetaRow {
  [key: string]: DurableObjectSqlValue;
  active_run_attempt: number | null;
  active_run_event_id: string | null;
  active_run_id: string | null;
  active_run_started_at: string | null;
  runtime_bootstrapped: number;
  in_flight: number;
  last_error_at: string | null;
  last_error_code: string | null;
  last_event_id: string | null;
  last_run_at: string | null;
  next_wake_at: string | null;
  user_id: string;
}

export interface RunnerStateProjection {
  record: RunnerStateRecord;
}

export function appendBoundedRunnerTimelineEntry(
  entries: readonly HostedExecutionTimelineEntry[],
  entry: HostedExecutionTimelineEntry,
  limit: number,
): HostedExecutionTimelineEntry[] {
  return [...entries, entry].slice(-limit);
}

export function createDefaultRunnerMetaRow(userId: string): RunnerMetaRow {
  return {
    active_run_attempt: null,
    active_run_event_id: null,
    active_run_id: null,
    active_run_started_at: null,
    runtime_bootstrapped: 0,
    in_flight: 0,
    last_error_at: null,
    last_error_code: null,
    last_event_id: null,
    last_run_at: null,
    next_wake_at: null,
    user_id: userId,
  };
}

export function projectRunnerStateRecord(input: {
  bundleRef: HostedExecutionBundleRef | null;
  meta: RunnerMetaRow;
  run: HostedExecutionRunStatus | null;
  timeline: readonly HostedExecutionTimelineEntry[];
}): RunnerStateProjection {
  const nextLastError = summarizeHostedExecutionErrorCode(input.meta.last_error_code);
  const hasPersistedRunLease = input.meta.active_run_event_id !== null
    && input.meta.active_run_id !== null
    && typeof input.meta.active_run_attempt === "number"
    && input.meta.active_run_started_at !== null;
  const lastEventId = input.meta.last_event_id
    ?? input.meta.active_run_event_id
    ?? input.run?.eventId
    ?? null;

  return {
    record: {
      runtimeBootstrapped: input.meta.runtime_bootstrapped === 1,
      bundleRef: input.bundleRef,
      inFlight: input.meta.in_flight === 1 || hasPersistedRunLease,
      lastError: nextLastError,
      lastErrorAt: input.meta.last_error_at,
      lastErrorCode: input.meta.last_error_code,
      lastEventId,
      lastRunAt: input.meta.last_run_at,
      nextWakeAt: input.meta.next_wake_at,
      pendingWakeCount: 0,
      run: input.run,
      timeline: [...input.timeline],
      userId: input.meta.user_id,
    },
  };
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
