import { resolveMetric } from "../wearables/selection.ts";
import {
  ACTIVITY_METRIC_KEYS,
  BODY_METRIC_KEYS,
  RECOVERY_METRIC_KEYS,
  SLEEP_METRIC_KEYS,
  type WearableMetricKey,
} from "../wearables/types.ts";
import { parseJsonValue } from "./schema.ts";
import { stringifyPublicWearableProjectionSummary } from "./wearable-summary-public-json.ts";
import type { QueryWearableSummaryKind } from "./wearable-summary-store.ts";

// Stored wearable summary codec.
//
// `query_wearable_summaries.summary_json` rows are written through
// `stringifyStoredWearableProjectionSummary` and read back through
// `parseStoredWearableSummary`. The stored form compacts per-metric
// envelopes; the parse side resynthesizes the exact public projection
// bytes:
//
// - an envelope with no evidence is stored as `null` and resynthesized
//   from `resolveMetric(metric, [])`, the same constructor the summary
//   builders use, so the restored bytes match by construction
// - a populated envelope drops constant or derivable fields (`candidates`,
//   `metric`, `selection.paths`, `selection.recordIds`, `null` selection
//   fields) plus dominant defaults (`resolution: "direct"`,
//   `candidateCount: 1`, `level: "high"`, empty arrays, zero duplicate
//   counts) and is rebuilt in the canonical envelope key order on read
//
// The write side verifies every compacted envelope by round-tripping it
// against the full public projection bytes and falls back to storing the
// full envelope when the bytes differ, so compaction can never change
// what readers see. That guarantee is scoped to builder-shaped envelopes
// (the 4-key `WearableResolvedMetric` form every summary builder emits);
// hand-crafted rows whose key set collides with the compact form are not
// distinguishable in-band and may be resynthesized differently.
//
// The decode defaults below are a persistence contract: if the envelope
// shape, `STORED_SELECTION_KEYS`, or `resolveMetric`'s empty output ever
// changes, bump `QUERY_PROJECTION_SQLITE_VERSION` so stored rows rebuild
// (write-side verification protects writes, not previously stored rows).

export type StoredWearableMetricSummaryKind = Exclude<QueryWearableSummaryKind, "source_health">;

const WEARABLE_SUMMARY_METRIC_KEYS: Record<StoredWearableMetricSummaryKind, ReadonlySet<WearableMetricKey>> = {
  activity: ACTIVITY_METRIC_KEYS,
  body_state: BODY_METRIC_KEYS,
  recovery: RECOVERY_METRIC_KEYS,
  sleep: SLEEP_METRIC_KEYS,
};

const STORED_SELECTION_KEYS = [
  "occurredAt",
  "provider",
  "recordedAt",
  "resolution",
  "sourceFamily",
  "sourceKind",
  "title",
  "fallbackFromMetric",
  "fallbackReason",
  "unit",
  "value",
] as const;

export function stringifyStoredWearableProjectionSummary(
  summaryKind: StoredWearableMetricSummaryKind,
  summary: object,
): string {
  const stored = { ...(summary as Record<string, unknown>) };

  for (const metric of WEARABLE_SUMMARY_METRIC_KEYS[summaryKind]) {
    if (metric in stored) {
      stored[metric] = encodeStoredWearableMetricEnvelope(metric, stored[metric]);
    }
  }

  return stringifyPublicWearableProjectionSummary(stored);
}

export function parseStoredWearableSummary<TSummary>(
  summaryKind: StoredWearableMetricSummaryKind,
  summaryJson: string,
): TSummary | null {
  const summary = parseJsonValue<TSummary | null>(summaryJson, null);
  // isJsonObject also rejects arrays, which `typeof` alone would let leak
  // into runtime summary lists as corrupt rows.
  if (!isJsonObject(summary)) {
    return null;
  }

  restoreStoredWearableMetricEnvelopes(summaryKind, summary);
  return summary;
}

function restoreStoredWearableMetricEnvelopes(
  summaryKind: StoredWearableMetricSummaryKind,
  summary: object,
): void {
  const record = summary as Record<string, unknown>;

  for (const metric of WEARABLE_SUMMARY_METRIC_KEYS[summaryKind]) {
    if (metric in record) {
      record[metric] = decodeStoredWearableMetricEnvelope(metric, record[metric]);
    }
  }
}

function encodeStoredWearableMetricEnvelope(metric: WearableMetricKey, envelope: unknown): unknown {
  const compact = compactStoredWearableMetricEnvelope(envelope);
  if (compact === undefined) {
    return envelope;
  }

  const restored = decodeStoredWearableMetricEnvelope(metric, compact);
  return stringifyPublicWearableProjectionSummary(restored) === stringifyPublicWearableProjectionSummary(envelope)
    ? compact
    : envelope;
}

function compactStoredWearableMetricEnvelope(envelope: unknown): Record<string, unknown> | null | undefined {
  if (!isJsonObject(envelope)) {
    return undefined;
  }

  const confidence = envelope.confidence;
  const selection = envelope.selection;
  if (!isJsonObject(confidence) || !isJsonObject(selection)) {
    return undefined;
  }

  if (selection.resolution === "none") {
    return null;
  }

  return {
    confidence: compactStoredConfidence(confidence),
    selection: compactStoredSelection(selection),
  };
}

function compactStoredConfidence(confidence: Record<string, unknown>): Record<string, unknown> {
  const compact: Record<string, unknown> = {};

  if (confidence.candidateCount !== 1) {
    compact.candidateCount = confidence.candidateCount;
  }
  if (Array.isArray(confidence.conflictingProviders) && confidence.conflictingProviders.length > 0) {
    compact.conflictingProviders = confidence.conflictingProviders;
  }
  if (confidence.exactDuplicateCount !== 0) {
    compact.exactDuplicateCount = confidence.exactDuplicateCount;
  }
  if (confidence.level !== "high") {
    compact.level = confidence.level;
  }
  if (Array.isArray(confidence.reasons) && confidence.reasons.length > 0) {
    compact.reasons = confidence.reasons;
  }

  return compact;
}

function compactStoredSelection(selection: Record<string, unknown>): Record<string, unknown> {
  const compact: Record<string, unknown> = {};

  for (const key of STORED_SELECTION_KEYS) {
    const value = selection[key];
    if (value !== null && value !== undefined && !(key === "resolution" && value === "direct")) {
      compact[key] = value;
    }
  }

  return compact;
}

function decodeStoredWearableMetricEnvelope(metric: WearableMetricKey, stored: unknown): unknown {
  if (stored === null) {
    return emptyStoredWearableMetricEnvelope(metric);
  }

  if (!isJsonObject(stored) || !isCompactStoredEnvelope(stored)) {
    return stored;
  }

  // The discriminator guarantees both are plain objects.
  const confidence = stored.confidence as Record<string, unknown>;
  const selection = stored.selection as Record<string, unknown>;

  return {
    candidates: [],
    confidence: {
      candidateCount: confidence.candidateCount ?? 1,
      conflictingProviders: confidence.conflictingProviders ?? [],
      exactDuplicateCount: confidence.exactDuplicateCount ?? 0,
      level: confidence.level ?? "high",
      reasons: confidence.reasons ?? [],
    },
    metric,
    selection: {
      occurredAt: selection.occurredAt ?? null,
      paths: [],
      provider: selection.provider ?? null,
      recordedAt: selection.recordedAt ?? null,
      recordIds: [],
      resolution: selection.resolution ?? "direct",
      sourceFamily: selection.sourceFamily ?? null,
      sourceKind: selection.sourceKind ?? null,
      title: selection.title ?? null,
      fallbackFromMetric: selection.fallbackFromMetric ?? null,
      fallbackReason: selection.fallbackReason ?? null,
      unit: selection.unit ?? null,
      value: selection.value ?? null,
    },
  };
}

function emptyStoredWearableMetricEnvelope(metric: WearableMetricKey): unknown {
  // resolveMetric constructs a fresh envelope (new arrays/literals) on every
  // call, so callers can mutate the result without cross-envelope leaks.
  return resolveMetric(metric, []);
}

function isCompactStoredEnvelope(stored: Record<string, unknown>): boolean {
  // Compact envelopes carry exactly { confidence, selection }, both plain
  // objects — the writer emits both keys unconditionally. Anything else
  // (full envelopes stored verbatim by the fail-open path, corrupt or
  // tampered cells like {} or {selection:{...}}) passes through untouched:
  // decode must never synthesize a high-confidence selection from a shape
  // the writer cannot produce.
  const keys = Object.keys(stored);
  return keys.length === 2
    && isJsonObject(stored.confidence)
    && isJsonObject(stored.selection);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
