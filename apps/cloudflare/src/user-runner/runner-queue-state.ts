/**
 * Pure runner queue projection helpers extracted from RunnerQueueStore. The store
 * still owns SQL-backed lifecycle transitions; this module owns normalization,
 * bundle-ref versioning, wake scheduling, and malformed-state cleanup.
 */

import {
  deriveHostedExecutionErrorCode,
  parseHostedExecutionRunStatus,
  parseHostedExecutionTimelineEntries,
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
  MAX_RUN_TIMELINE_ENTRIES,
  type DurableObjectSqlValue,
  type PendingDispatchRecord,
  type RunnerStateRecord,
  earliestIsoTimestamp,
} from "./types.js";

export interface RunnerMetaRow {
  [key: string]: DurableObjectSqlValue;
  activated: number;
  agent_state_bundle_ref_json: string | null;
  agent_state_bundle_version: number;
  backpressured_event_ids_json: string;
  in_flight: number;
  last_error: string | null;
  last_error_at: string | null;
  last_error_code: string | null;
  last_event_id: string | null;
  last_run_at: string | null;
  next_wake_at: string | null;
  retrying_event_id: string | null;
  run_json: string | null;
  timeline_json: string;
  user_id: string;
  vault_bundle_ref_json: string | null;
  vault_bundle_version: number;
}

export interface RunnerStateProjection {
  changed: boolean;
  record: RunnerStateRecord;
  sanitizedMeta: Pick<
    RunnerMetaRow,
    | "agent_state_bundle_ref_json"
    | "vault_bundle_ref_json"
    | "run_json"
    | "timeline_json"
    | "last_error"
  >;
}

export function appendBoundedRunnerEventId(
  eventIds: readonly string[],
  eventId: string,
  limit: number,
): string[] {
  return [...eventIds.filter((entry) => entry !== eventId), eventId].slice(-limit);
}

export function appendBoundedRunnerTimelineEntry(
  entries: readonly HostedExecutionTimelineEntry[],
  entry: HostedExecutionTimelineEntry,
  limit: number,
): HostedExecutionTimelineEntry[] {
  return [...entries, entry].slice(-limit);
}

export function assignRunnerBundleRefs(
  meta: RunnerMetaRow,
  nextBundleRefs: RunnerStateRecord["bundleRefs"],
): void {
  const currentAgentStateRef = parseHostedBundleRefJson(meta.agent_state_bundle_ref_json);
  const currentVaultRef = parseHostedBundleRefJson(meta.vault_bundle_ref_json);

  if (!sameHostedBundlePayloadRef(currentAgentStateRef, nextBundleRefs.agentState)) {
    meta.agent_state_bundle_ref_json = serializeHostedExecutionBundleRef(nextBundleRefs.agentState);
    meta.agent_state_bundle_version += 1;
  }

  if (!sameHostedBundlePayloadRef(currentVaultRef, nextBundleRefs.vault)) {
    meta.vault_bundle_ref_json = serializeHostedExecutionBundleRef(nextBundleRefs.vault);
    meta.vault_bundle_version += 1;
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
    agent_state_bundle_ref_json: null,
    agent_state_bundle_version: 0,
    backpressured_event_ids_json: "[]",
    in_flight: 0,
    last_error: null,
    last_error_at: null,
    last_error_code: null,
    last_event_id: null,
    last_run_at: null,
    next_wake_at: null,
    retrying_event_id: null,
    run_json: null,
    timeline_json: "[]",
    user_id: userId,
    vault_bundle_ref_json: null,
    vault_bundle_version: 0,
  };
}

export function nextConsumedEventExactExpiryIso(): string {
  return new Date(Date.now() + CONSUMED_EVENT_EXACT_TTL_MS).toISOString();
}

export function parseRunnerStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

export function parseStoredRunnerTimelineEntries(value: string): HostedExecutionTimelineEntry[] {
  try {
    return parseHostedExecutionTimelineEntries(JSON.parse(value) as unknown);
  } catch {
    return [];
  }
}

export function projectRunnerStateRecord(input: {
  meta: RunnerMetaRow;
  nextPendingAvailableAtOverride?: string | null;
  pendingDispatches: readonly PendingDispatchRecord[];
  poisonedEventIds: readonly string[];
}): RunnerStateProjection {
  const bundleRefState = sanitizeStoredBundleRefs(input.meta);
  const runTraceState = sanitizeStoredRunTrace(input.meta);
  const nextLastError = mergeRunnerLastError(
    mergeRunnerLastError(input.meta.last_error, bundleRefState.warning),
    runTraceState.warning,
  );

  return {
    changed: bundleRefState.changed || runTraceState.changed || nextLastError !== input.meta.last_error,
    record: {
      activated: input.meta.activated === 1,
      backpressuredEventIds: parseRunnerStringArray(input.meta.backpressured_event_ids_json),
      bundleRefs: {
        agentState: bundleRefState.agentState,
        vault: bundleRefState.vault,
      },
      bundleVersions: {
        agentState: input.meta.agent_state_bundle_version,
        vault: input.meta.vault_bundle_version,
      },
      inFlight: input.meta.in_flight === 1,
      lastError: nextLastError,
      lastErrorAt: input.meta.last_error_at,
      lastErrorCode: input.meta.last_error_code,
      lastEventId: input.meta.last_event_id,
      lastRunAt: input.meta.last_run_at,
      nextPendingAvailableAt:
        input.nextPendingAvailableAtOverride ?? input.pendingDispatches[0]?.availableAt ?? null,
      nextWakeAt: input.meta.next_wake_at,
      pendingEventCount: input.pendingDispatches.length,
      poisonedEventIds: [...input.poisonedEventIds],
      run: runTraceState.run,
      retryingEventId: input.meta.retrying_event_id,
      timeline: runTraceState.timeline,
      userId: input.meta.user_id,
    },
    sanitizedMeta: {
      agent_state_bundle_ref_json: serializeHostedExecutionBundleRef(bundleRefState.agentState),
      last_error: nextLastError,
      run_json: stringifyRunStatus(runTraceState.run),
      timeline_json: JSON.stringify(runTraceState.timeline),
      vault_bundle_ref_json: serializeHostedExecutionBundleRef(bundleRefState.vault),
    },
  };
}

export function readRunnerBundleMetaStateFromMeta(meta: RunnerMetaRow): Pick<
  RunnerStateRecord,
  "bundleRefs" | "bundleVersions" | "inFlight" | "userId"
> {
  return {
    bundleRefs: {
      agentState: parseHostedBundleRefJson(meta.agent_state_bundle_ref_json),
      vault: parseHostedBundleRefJson(meta.vault_bundle_ref_json),
    },
    bundleVersions: {
      agentState: meta.agent_state_bundle_version,
      vault: meta.vault_bundle_version,
    },
    inFlight: meta.in_flight === 1,
    userId: meta.user_id,
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

export function mergeRunnerLastError(
  current: string | null,
  warning: string | null,
): string | null {
  if (!warning) {
    return current;
  }

  if (!current) {
    return warning;
  }

  return current.includes(warning) ? current : `${current} ${warning}`;
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

function parseHostedExecutionRunStatusJson(value: string | null): HostedExecutionRunStatus | null {
  if (!value) {
    return null;
  }

  try {
    return parseHostedExecutionRunStatus(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

function sanitizeStoredBundleRefs(meta: RunnerMetaRow): {
  agentState: HostedExecutionBundleRef | null;
  changed: boolean;
  vault: HostedExecutionBundleRef | null;
  warning: string | null;
} {
  let changed = false;
  const clearedKinds: string[] = [];

  const agentState = parseHostedBundleRefJson(meta.agent_state_bundle_ref_json);
  if (meta.agent_state_bundle_ref_json && !agentState) {
    changed = true;
    clearedKinds.push("agent-state");
  }

  const vault = parseHostedBundleRefJson(meta.vault_bundle_ref_json);
  if (meta.vault_bundle_ref_json && !vault) {
    changed = true;
    clearedKinds.push("vault");
  }

  return {
    agentState,
    changed,
    vault,
    warning: clearedKinds.length > 0
      ? `Hosted runner cleared malformed bundle ref(s): ${clearedKinds.join(", ")}.`
      : null,
  };
}

function sanitizeStoredRunTrace(meta: RunnerMetaRow): {
  changed: boolean;
  run: HostedExecutionRunStatus | null;
  timeline: HostedExecutionTimelineEntry[];
  warning: string | null;
} {
  let changed = false;
  const clearedKinds: string[] = [];

  const run = parseHostedExecutionRunStatusJson(meta.run_json);
  if (meta.run_json && !run) {
    changed = true;
    clearedKinds.push("run");
  }

  const timeline = parseStoredRunnerTimelineEntries(meta.timeline_json);
  if (meta.timeline_json && meta.timeline_json !== "[]" && timeline.length === 0) {
    changed = true;
    clearedKinds.push("timeline");
  }

  const boundedTimeline = timeline.slice(-MAX_RUN_TIMELINE_ENTRIES);
  if (boundedTimeline.length !== timeline.length) {
    changed = true;
    clearedKinds.push("timeline-pruned");
  }

  return {
    changed,
    run,
    timeline: boundedTimeline,
    warning: clearedKinds.length > 0
      ? `Hosted runner normalized run trace field(s): ${clearedKinds.join(", ")}.`
      : null,
  };
}

function stringifyRunStatus(value: HostedExecutionRunStatus | null): string | null {
  return value ? JSON.stringify(value) : null;
}
