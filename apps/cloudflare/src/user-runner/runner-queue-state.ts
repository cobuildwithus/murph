/**
 * Pure runner queue projection helpers extracted from RunnerQueueStore. The store
 * still owns SQL-backed lifecycle transitions; this module owns normalization,
 * bundle-ref versioning, wake scheduling, and malformed-state cleanup.
 */

import {
  HOSTED_EXECUTION_BUNDLE_SLOTS,
  deriveHostedExecutionErrorCode,
  mapHostedExecutionBundleSlots,
  resolveHostedExecutionBundleKind,
  summarizeHostedExecutionErrorCode,
  summarizeHostedExecutionError,
  type HostedExecutionBundleSlotMap,
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
  type RunnerBundleVersions,
  type RunnerStateRecord,
  earliestIsoTimestamp,
} from "./types.js";

export interface RunnerMetaRow {
  [key: string]: DurableObjectSqlValue;
  activated: number;
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

export interface RunnerStoredBundleSlots {
  bundleRefJsonBySlot: HostedExecutionBundleSlotMap<string | null>;
  bundleVersions: RunnerBundleVersions;
}

export interface RunnerStateProjection {
  changed: boolean;
  record: RunnerStateRecord;
  sanitizedBundleSlots: RunnerStoredBundleSlots;
}

export function appendBoundedRunnerTimelineEntry(
  entries: readonly HostedExecutionTimelineEntry[],
  entry: HostedExecutionTimelineEntry,
  limit: number,
): HostedExecutionTimelineEntry[] {
  return [...entries, entry].slice(-limit);
}

export function assignRunnerBundleRefs(
  bundleSlots: RunnerStoredBundleSlots,
  nextBundleRefs: RunnerStateRecord["bundleRefs"],
): void {
  for (const slot of HOSTED_EXECUTION_BUNDLE_SLOTS) {
    const currentRef = parseHostedBundleRefJson(bundleSlots.bundleRefJsonBySlot[slot]);
    if (sameHostedBundlePayloadRef(currentRef, nextBundleRefs[slot])) {
      continue;
    }

    bundleSlots.bundleRefJsonBySlot[slot] = serializeHostedExecutionBundleRef(nextBundleRefs[slot]);
    bundleSlots.bundleVersions[slot] += 1;
  }
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
    activated: 0,
    in_flight: 0,
    last_error_at: null,
    last_error_code: null,
    last_run_at: null,
    next_wake_at: null,
    user_id: userId,
  };
}

export function createDefaultRunnerBundleSlots(): RunnerStoredBundleSlots {
  return {
    bundleRefJsonBySlot: mapHostedExecutionBundleSlots(() => null),
    bundleVersions: mapHostedExecutionBundleSlots(() => 0),
  };
}

export function nextConsumedEventExactExpiryIso(): string {
  return new Date(Date.now() + CONSUMED_EVENT_EXACT_TTL_MS).toISOString();
}

export function projectRunnerStateRecord(input: {
  backpressuredEventIds: readonly string[];
  bundleSlots: RunnerStoredBundleSlots;
  lastEventId: string | null;
  meta: RunnerMetaRow;
  nextPendingAvailableAt: string | null;
  pendingDispatches: readonly PendingDispatchMetaRecord[];
  poisonedEventIds: readonly string[];
  retryingEventId: string | null;
  run: HostedExecutionRunStatus | null;
  timeline: readonly HostedExecutionTimelineEntry[];
}): RunnerStateProjection {
  const bundleRefState = sanitizeStoredBundleRefs(input.bundleSlots);
  const nextLastError = summarizeHostedExecutionErrorCode(input.meta.last_error_code) ?? bundleRefState.warning;

  return {
    changed: bundleRefState.changed,
    record: {
      activated: input.meta.activated === 1,
      backpressuredEventIds: [...input.backpressuredEventIds],
      bundleRefs: bundleRefState.bundleRefs,
      bundleVersions: bundleRefState.sanitizedBundleSlots.bundleVersions,
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
    sanitizedBundleSlots: bundleRefState.sanitizedBundleSlots,
  };
}

export function resolveRunnerNextWakeAt(input: {
  activated: boolean;
  defaultAlarmDelayMs: number;
  nextPendingAvailableAt: string | null;
  preferredWakeAt?: string | null;
}): string | null {
  const scheduledWakeAt = earliestIsoTimestamp(
    input.nextPendingAvailableAt,
    normalizePreferredWakeAt(input.preferredWakeAt ?? null),
  );
  const fallbackWakeAt = input.activated
    ? new Date(Date.now() + input.defaultAlarmDelayMs).toISOString()
    : null;
  return scheduledWakeAt ?? fallbackWakeAt;
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
  if (!Number.isFinite(parsedMs) || parsedMs <= Date.now()) {
    return null;
  }

  return new Date(parsedMs).toISOString();
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

function sanitizeStoredBundleRefs(bundleSlots: RunnerStoredBundleSlots): {
  bundleRefs: RunnerStateRecord["bundleRefs"];
  changed: boolean;
  sanitizedBundleSlots: RunnerStoredBundleSlots;
  warning: string | null;
} {
  let changed = false;
  const clearedKinds: string[] = [];
  const sanitizedBundleSlots = createDefaultRunnerBundleSlots();

  const bundleRefs = mapHostedExecutionBundleSlots((slot) => {
    const parsedRef = parseHostedBundleRefJson(bundleSlots.bundleRefJsonBySlot[slot]);

    if (bundleSlots.bundleRefJsonBySlot[slot] && !parsedRef) {
      changed = true;
      clearedKinds.push(resolveHostedExecutionBundleKind(slot));
    }

    sanitizedBundleSlots.bundleRefJsonBySlot[slot] = serializeHostedExecutionBundleRef(parsedRef);
    sanitizedBundleSlots.bundleVersions[slot] = bundleSlots.bundleVersions[slot];
    return parsedRef;
  });

  return {
    bundleRefs,
    changed,
    sanitizedBundleSlots,
    warning: clearedKinds.length > 0
      ? `Hosted runner cleared malformed bundle ref(s): ${clearedKinds.join(", ")}.`
      : null,
  };
}
