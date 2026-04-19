/**
 * Pure thin-runner projection helpers extracted from RunnerStateStore. The
 * store still owns SQL-backed lease/runtime transitions; this module owns
 * normalization, bundle-ref versioning, and wake scheduling.
 */

import {
  summarizeHostedExecutionErrorCode,
  type HostedWakeMaterializationHints,
  type HostedExecutionRunStatus,
  type HostedExecutionTimelineEntry,
} from "@murphai/hosted-execution";
import {
  parseHostedExecutionBundleRef,
  sameHostedBundlePayloadRef,
  serializeHostedExecutionBundleRef,
  type HostedExecutionBundleRef,
} from "@murphai/runtime-state";

import type {
  DurableObjectSqlValue,
  RunnerBundleVersion,
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
  pending_commit_json: string | null;
  wake_materialization_hints_json: string | null;
  user_id: string;
}

export interface RunnerBundleSlotRow {
  [key: string]: DurableObjectSqlValue;
  bundle_ref_json: string | null;
  bundle_version: number;
  slot: string;
}

export interface RunnerStoredBundleState {
  bundleRefJson: string | null;
  bundleVersion: RunnerBundleVersion;
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

export function assignRunnerBundleRefs(
  bundleState: RunnerStoredBundleState,
  nextBundleRef: RunnerStateRecord["bundleRef"],
): void {
  const currentRef = parseHostedBundleRefJson(bundleState.bundleRefJson);
  if (sameHostedBundlePayloadRef(currentRef, nextBundleRef)) {
    return;
  }

  bundleState.bundleRefJson = serializeHostedExecutionBundleRef(nextBundleRef);
  bundleState.bundleVersion += 1;
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
    pending_commit_json: null,
    wake_materialization_hints_json: null,
    user_id: userId,
  };
}

export function createDefaultRunnerBundleState(): RunnerStoredBundleState {
  return {
    bundleRefJson: null,
    bundleVersion: 0,
  };
}

export function projectRunnerStateRecord(input: {
  bundleState: RunnerStoredBundleState;
  meta: RunnerMetaRow;
  run: HostedExecutionRunStatus | null;
  timeline: readonly HostedExecutionTimelineEntry[];
}): RunnerStateProjection {
  const bundleRef = parseHostedBundleRefJson(input.bundleState.bundleRefJson);
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
      bundleRef,
      bundleVersion: input.bundleState.bundleVersion,
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
  wakeMaterializationHints?: HostedWakeMaterializationHints | null;
}): string | null {
  return earliestRunnerWakeAt(
    normalizePreferredWakeAt(input.preferredWakeAt ?? null),
    normalizePreferredWakeAt(input.wakeMaterializationHints?.assistantWakeAt ?? null),
    normalizePreferredWakeAt(input.wakeMaterializationHints?.deviceSyncWakeAt ?? null),
  );
}

export function hasWakeMaterializationHintPayload(
  value: HostedWakeMaterializationHints | null,
): boolean {
  return Boolean(value && Object.keys(value).length > 0);
}

export function hasDroppedWakeMaterializationHintPayload(
  value: HostedWakeMaterializationHints | null,
): boolean {
  if (!value) {
    return false;
  }

  const keys = Object.keys(value);
  if (keys.length === 0) {
    return true;
  }

  return keys.some((key) => key !== "assistantWakeAt" && key !== "deviceSyncWakeAt") || (
    value.assistantWakeAt !== undefined
    && value.assistantWakeAt !== null
    && Number.isNaN(Date.parse(value.assistantWakeAt))
  ) || (
    value.deviceSyncWakeAt !== undefined
    && value.deviceSyncWakeAt !== null
    && Number.isNaN(Date.parse(value.deviceSyncWakeAt))
  );
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

function earliestRunnerWakeAt(...values: Array<string | null | undefined>): string | null {
  return values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null;
}

function parseHostedBundleRefJson(value: string | null): HostedExecutionBundleRef | null {
  if (!value) {
    return null;
  }

  try {
    return parseHostedExecutionBundleRef(JSON.parse(value) as unknown, "Hosted runner bundle ref");
  } catch {
    throw new Error("Hosted runner state is corrupt: runner_meta.bundle_ref_json is malformed.");
  }
}
