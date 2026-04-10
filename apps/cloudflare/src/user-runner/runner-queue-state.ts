/**
 * Pure runner queue projection helpers extracted from RunnerQueueStore. The store
 * still owns SQL-backed lifecycle transitions; this module owns normalization,
 * bundle-ref versioning, wake scheduling, and malformed-state cleanup.
 */

import {
  deriveHostedExecutionErrorCode,
  summarizeHostedExecutionErrorCode,
  summarizeHostedExecutionError,
  type HostedExecutionRunStatus,
  type HostedExecutionTimelineEntry,
} from "@murphai/hosted-execution";
import {
  parseHostedExecutionBundleRef,
  sameHostedBundlePayloadRef,
  serializeHostedExecutionBundleRef,
  type HostedExecutionBundleRef,
} from "@murphai/runtime-state";

import {
  CONSUMED_EVENT_EXACT_TTL_MS,
  type DurableObjectSqlValue,
  type PendingDispatchMetaRecord,
  type RunnerBundleVersion,
  type RunnerStateRecord,
  earliestIsoTimestamp,
} from "./types.js";

export interface RunnerMetaRow {
  [key: string]: DurableObjectSqlValue;
  runtime_bootstrapped: number;
  in_flight: number;
  last_error_at: string | null;
  last_error_code: string | null;
  last_run_at: string | null;
  next_wake_at: string | null;
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
  changed: boolean;
  record: RunnerStateRecord;
  sanitizedBundleState: RunnerStoredBundleState;
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

export function classifyMalformedPendingDispatchError(error: unknown): {
  errorCode: string;
  message: string;
} {
  const errorCode = deriveHostedExecutionErrorCode(error);
  if (isInvalidRequestFamilyErrorCode(errorCode)) {
    return {
      errorCode: "invalid_request",
      message: "Hosted runner poisoned a malformed pending dispatch.",
    };
  }

  return {
    errorCode,
    message: `Hosted runner poisoned a malformed pending dispatch. ${summarizeHostedExecutionError(error)}`,
  };
}

export function createDefaultRunnerMetaRow(userId: string): RunnerMetaRow {
  return {
    runtime_bootstrapped: 0,
    in_flight: 0,
    last_error_at: null,
    last_error_code: null,
    last_run_at: null,
    next_wake_at: null,
    user_id: userId,
  };
}

export function createDefaultRunnerBundleState(): RunnerStoredBundleState {
  return {
    bundleRefJson: null,
    bundleVersion: 0,
  };
}

export function nextConsumedEventExactExpiryIso(): string {
  return new Date(Date.now() + CONSUMED_EVENT_EXACT_TTL_MS).toISOString();
}

export function projectRunnerStateRecord(input: {
  backpressuredEventIds: readonly string[];
  bundleState: RunnerStoredBundleState;
  lastEventId: string | null;
  meta: RunnerMetaRow;
  nextPendingAvailableAt: string | null;
  pendingDispatches: readonly PendingDispatchMetaRecord[];
  poisonedEventIds: readonly string[];
  retryingEventId: string | null;
  run: HostedExecutionRunStatus | null;
  timeline: readonly HostedExecutionTimelineEntry[];
}): RunnerStateProjection {
  const bundleRefState = sanitizeStoredBundleRef(input.bundleState);
  const nextLastError = summarizeHostedExecutionErrorCode(input.meta.last_error_code) ?? bundleRefState.warning;

  return {
    changed: bundleRefState.changed,
    record: {
      runtimeBootstrapped: input.meta.runtime_bootstrapped === 1,
      backpressuredEventIds: [...input.backpressuredEventIds],
      bundleRef: bundleRefState.bundleRef,
      bundleVersion: bundleRefState.sanitizedBundleState.bundleVersion,
      inFlight: input.meta.in_flight === 1,
      lastError: nextLastError,
      lastErrorAt: input.meta.last_error_at,
      lastErrorCode: input.meta.last_error_code,
      lastEventId: input.lastEventId,
      lastRunAt: input.meta.last_run_at,
      nextPendingAvailableAt: input.nextPendingAvailableAt,
      nextWakeAt: input.meta.next_wake_at,
      pendingEventCount: input.pendingDispatches.length,
      poisonedEventIds: [...input.poisonedEventIds],
      run: input.run,
      retryingEventId: input.retryingEventId,
      timeline: [...input.timeline],
      userId: input.meta.user_id,
    },
    sanitizedBundleState: bundleRefState.sanitizedBundleState,
  };
}

export function resolveRunnerNextWakeAt(input: {
  nextPendingAvailableAt: string | null;
  preferredWakeAt?: string | null;
}): string | null {
  return earliestIsoTimestamp(
    input.nextPendingAvailableAt,
    normalizePreferredWakeAt(input.preferredWakeAt ?? null),
  );
}

function isInvalidRequestFamilyErrorCode(errorCode: string): boolean {
  return errorCode === "invalid_request"
    || errorCode === "range_error"
    || errorCode === "reference_error"
    || errorCode === "syntax_error"
    || errorCode === "type_error"
    || errorCode === "uri_error";
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

function parseHostedBundleRefJson(value: string | null): HostedExecutionBundleRef | null {
  if (!value) {
    return null;
  }

  try {
    return parseHostedExecutionBundleRef(JSON.parse(value) as unknown, "Hosted runner bundle ref");
  } catch {
    return null;
  }
}

function sanitizeStoredBundleRef(bundleState: RunnerStoredBundleState): {
  bundleRef: RunnerStateRecord["bundleRef"];
  changed: boolean;
  sanitizedBundleState: RunnerStoredBundleState;
  warning: string | null;
} {
  const parsedRef = parseHostedBundleRefJson(bundleState.bundleRefJson);
  const changed = Boolean(bundleState.bundleRefJson && !parsedRef);
  const sanitizedBundleState = createDefaultRunnerBundleState();
  sanitizedBundleState.bundleRefJson = serializeHostedExecutionBundleRef(parsedRef);
  sanitizedBundleState.bundleVersion = bundleState.bundleVersion;

  return {
    bundleRef: parsedRef,
    changed,
    sanitizedBundleState,
    warning: changed
      ? "Hosted runner cleared malformed bundle ref(s): vault."
      : null,
  };
}
