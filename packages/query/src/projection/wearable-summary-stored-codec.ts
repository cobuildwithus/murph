import { resolveMetric } from "../wearables/selection.ts";
import {
  ACTIVITY_METRIC_KEYS,
  BODY_METRIC_KEYS,
  RECOVERY_METRIC_KEYS,
  SLEEP_METRIC_KEYS,
  type WearableActivityMetricEvidence,
  type WearableActivityMetricResourceClass,
  type WearableActivitySessionEvidence,
  type WearableActivitySessionMetricValues,
  type WearableCandidateSourceFamily,
  type WearableHeartRateZoneAggregate,
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

export const STORED_ACTIVITY_METRIC_EVIDENCE_KEY = "activityMetricRankingEvidence";
export const STORED_ACTIVITY_METRIC_EVIDENCE_COUNT_KEY =
  "activityMetricRankingEvidenceCount";
export const STORED_ACTIVITY_METRIC_EVIDENCE_FINGERPRINT_KEY =
  "activityMetricRankingEvidenceFingerprint";
export const STORED_ACTIVITY_SESSION_EVIDENCE_KEY = "activitySessionReconciliationEvidence";
export const STORED_ACTIVITY_SESSION_EVIDENCE_COUNT_KEY =
  "activitySessionReconciliationEvidenceCount";
export const STORED_ACTIVITY_SESSION_EVIDENCE_FINGERPRINT_KEY =
  "activitySessionReconciliationEvidenceFingerprint";

export type StoredWearableActivityMetricEvidenceParseResult =
  | { status: "absent" }
  | { status: "invalid" }
  | { status: "valid"; evidence: WearableActivityMetricEvidence[] };

export type StoredWearableActivitySessionEvidenceParseResult =
  | { status: "absent" }
  | { status: "invalid"; reason: "empty" | "malformed" }
  | { status: "valid"; evidence: WearableActivitySessionEvidence[] };

interface StoredWearableProjectionSummaryOptions {
  /**
   * Complete provider/day pre-ranking activity candidates. Keeping only a
   * provider-local winner changes cross-provider agreement and recency ranks.
   */
  activityMetricEvidence?: readonly WearableActivityMetricEvidence[];
  /**
   * Complete provider/day session evidence is retained because truncating it
   * before cross-provider dedupe would silently corrupt composed totals. The
   * enclosing projection row is already bounded to one provider and one day.
   */
  activitySessionEvidence?: readonly WearableActivitySessionEvidence[];
}

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
  options: StoredWearableProjectionSummaryOptions = {},
): string {
  const stored = { ...(summary as Record<string, unknown>) };

  for (const metric of WEARABLE_SUMMARY_METRIC_KEYS[summaryKind]) {
    if (metric in stored) {
      stored[metric] = encodeStoredWearableMetricEnvelope(metric, stored[metric]);
    }
  }

  const publicStored = stringifyPublicWearableProjectionSummary(stored);
  if (
    summaryKind !== "activity"
    || (
      options.activityMetricEvidence === undefined
      && options.activitySessionEvidence === undefined
    )
  ) {
    return publicStored;
  }

  const storedWithEvidence = parseJsonValue<Record<string, unknown> | null>(publicStored, null);
  if (!storedWithEvidence) {
    return publicStored;
  }
  if (options.activityMetricEvidence !== undefined) {
    storedWithEvidence[STORED_ACTIVITY_METRIC_EVIDENCE_KEY] = options.activityMetricEvidence;
    storedWithEvidence[STORED_ACTIVITY_METRIC_EVIDENCE_COUNT_KEY] =
      options.activityMetricEvidence.length;
    storedWithEvidence[STORED_ACTIVITY_METRIC_EVIDENCE_FINGERPRINT_KEY] =
      storedEvidenceFingerprint(options.activityMetricEvidence);
  }
  if (
    options.activitySessionEvidence !== undefined
  ) {
    storedWithEvidence[STORED_ACTIVITY_SESSION_EVIDENCE_COUNT_KEY] =
      options.activitySessionEvidence.length;
    storedWithEvidence[STORED_ACTIVITY_SESSION_EVIDENCE_FINGERPRINT_KEY] =
      storedEvidenceFingerprint(options.activitySessionEvidence);
    if (options.activitySessionEvidence.length > 0) {
      storedWithEvidence[STORED_ACTIVITY_SESSION_EVIDENCE_KEY] =
        options.activitySessionEvidence;
    }
  }
  return JSON.stringify(storedWithEvidence);
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

  delete summary.activitySessions;
  delete summary[STORED_ACTIVITY_METRIC_EVIDENCE_KEY];
  delete summary[STORED_ACTIVITY_METRIC_EVIDENCE_COUNT_KEY];
  delete summary[STORED_ACTIVITY_METRIC_EVIDENCE_FINGERPRINT_KEY];
  delete summary[STORED_ACTIVITY_SESSION_EVIDENCE_KEY];
  delete summary[STORED_ACTIVITY_SESSION_EVIDENCE_COUNT_KEY];
  delete summary[STORED_ACTIVITY_SESSION_EVIDENCE_FINGERPRINT_KEY];
  restoreStoredWearableMetricEnvelopes(summaryKind, summary);
  return summary;
}

export function parseStoredWearableActivityMetricEvidence(
  summaryJson: string,
): StoredWearableActivityMetricEvidenceParseResult {
  const stored = parseJsonValue<Record<string, unknown> | null>(summaryJson, null);
  if (!isJsonObject(stored)) {
    return { status: "invalid" };
  }
  const hasEvidence = Object.hasOwn(stored, STORED_ACTIVITY_METRIC_EVIDENCE_KEY);
  const hasEvidenceCount = Object.hasOwn(
    stored,
    STORED_ACTIVITY_METRIC_EVIDENCE_COUNT_KEY,
  );
  const hasEvidenceFingerprint = Object.hasOwn(
    stored,
    STORED_ACTIVITY_METRIC_EVIDENCE_FINGERPRINT_KEY,
  );
  if (!hasEvidence && !hasEvidenceCount && !hasEvidenceFingerprint) {
    return { status: "absent" };
  }

  const rawEvidence = stored[STORED_ACTIVITY_METRIC_EVIDENCE_KEY];
  const rawEvidenceCount = stored[STORED_ACTIVITY_METRIC_EVIDENCE_COUNT_KEY];
  const rawEvidenceFingerprint =
    stored[STORED_ACTIVITY_METRIC_EVIDENCE_FINGERPRINT_KEY];
  if (
    !Array.isArray(rawEvidence)
    || !isStoredEvidenceCount(rawEvidenceCount)
    || rawEvidenceCount !== rawEvidence.length
    || !isStoredEvidenceFingerprint(rawEvidenceFingerprint)
    || rawEvidenceFingerprint !== storedEvidenceFingerprint(rawEvidence)
  ) {
    return { status: "invalid" };
  }

  const evidence: WearableActivityMetricEvidence[] = [];
  for (const rawCandidate of rawEvidence) {
    const parsed = parseStoredActivityMetricEvidence(rawCandidate);
    if (!parsed) {
      return { status: "invalid" };
    }
    evidence.push(parsed);
  }
  return { status: "valid", evidence };
}

function parseStoredActivityMetricEvidence(
  value: unknown,
): WearableActivityMetricEvidence | null {
  if (
    !isJsonObject(value)
    || !isJsonObject(value.origin)
    || !hasExactObjectKeys(value, STORED_ACTIVITY_METRIC_EVIDENCE_KEYS)
    || !hasExactObjectKeys(value.origin, STORED_ACTIVITY_METRIC_ORIGIN_KEYS)
  ) {
    return null;
  }

  const metric = [...ACTIVITY_METRIC_KEYS].find((candidate) => candidate === value.metric);
  const resourceClass = [...ACTIVITY_METRIC_RESOURCE_CLASSES].find(
    (candidate) => candidate === value.resourceClass,
  );
  const sourceFamily = [...WEARABLE_CANDIDATE_SOURCE_FAMILIES].find(
    (candidate) => candidate === value.sourceFamily,
  );
  const occurredAt = nullableParseableTimestamp(value.occurredAt);
  const recordedAt = nullableParseableTimestamp(value.recordedAt);
  const unit = nullableBoundedString(value.unit, 80);
  const aggregatorProvider = nullableStoredToken(value.origin.aggregatorProvider);
  const sourceProviderSlug = nullableStoredToken(value.origin.sourceProviderSlug);
  const sourceType = nullableStoredToken(value.origin.sourceType);
  if (
    !metric
    || !resourceClass
    || !sourceFamily
    || typeof value.candidateKey !== "string"
    || !STORED_ACTIVITY_METRIC_CANDIDATE_KEY_PATTERN.test(value.candidateKey)
    || !isIsoDateString(value.date)
    || typeof value.exactKey !== "string"
    || !STORED_ACTIVITY_METRIC_EXACT_KEY_PATTERN.test(value.exactKey)
    || typeof value.hasDayStrainFacet !== "boolean"
    || occurredAt === undefined
    || aggregatorProvider === undefined
    || sourceProviderSlug === undefined
    || sourceType === undefined
    || !isStoredToken(value.provider)
    || !isStoredToken(value.publicProvider)
    || recordedAt === undefined
    || !isStoredToken(value.sourceKind)
    || unit === undefined
    || !isFiniteNumber(value.value)
  ) {
    return null;
  }

  return {
    candidateKey: value.candidateKey,
    date: value.date,
    exactKey: value.exactKey,
    hasDayStrainFacet: value.hasDayStrainFacet,
    metric,
    occurredAt,
    origin: {
      aggregatorProvider,
      sourceProviderSlug,
      sourceType,
    },
    provider: value.provider,
    publicProvider: value.publicProvider,
    recordedAt,
    resourceClass,
    sourceFamily,
    sourceKind: value.sourceKind,
    unit,
    value: value.value,
  };
}

export function parseStoredWearableActivitySessionEvidence(
  summaryJson: string,
): StoredWearableActivitySessionEvidenceParseResult {
  const stored = parseJsonValue<Record<string, unknown> | null>(summaryJson, null);
  if (!isJsonObject(stored)) {
    return { status: "invalid", reason: "malformed" };
  }
  const hasEvidence = Object.hasOwn(stored, STORED_ACTIVITY_SESSION_EVIDENCE_KEY);
  const hasEvidenceCount = Object.hasOwn(
    stored,
    STORED_ACTIVITY_SESSION_EVIDENCE_COUNT_KEY,
  );
  const hasEvidenceFingerprint = Object.hasOwn(
    stored,
    STORED_ACTIVITY_SESSION_EVIDENCE_FINGERPRINT_KEY,
  );
  if (!hasEvidence && !hasEvidenceCount && !hasEvidenceFingerprint) {
    return { status: "absent" };
  }

  const rawEvidence = stored[STORED_ACTIVITY_SESSION_EVIDENCE_KEY];
  const rawEvidenceCount = stored[STORED_ACTIVITY_SESSION_EVIDENCE_COUNT_KEY];
  const rawEvidenceFingerprint =
    stored[STORED_ACTIVITY_SESSION_EVIDENCE_FINGERPRINT_KEY];
  if (
    !hasEvidence
    && isStoredEvidenceCount(rawEvidenceCount)
    && rawEvidenceCount === 0
    && isStoredEvidenceFingerprint(rawEvidenceFingerprint)
    && rawEvidenceFingerprint === storedEvidenceFingerprint([])
  ) {
    return { status: "valid", evidence: [] };
  }
  if (
    !Array.isArray(rawEvidence)
    || !isStoredEvidenceCount(rawEvidenceCount)
    || rawEvidenceCount !== rawEvidence.length
    || !isStoredEvidenceFingerprint(rawEvidenceFingerprint)
    || rawEvidenceFingerprint !== storedEvidenceFingerprint(rawEvidence)
  ) {
    return { status: "invalid", reason: "malformed" };
  }
  if (rawEvidence.length === 0) {
    return { status: "invalid", reason: "empty" };
  }

  const evidence: WearableActivitySessionEvidence[] = [];
  for (const rawSession of rawEvidence) {
    const parsed = parseStoredActivitySessionEvidence(rawSession);
    if (!parsed) {
      return { status: "invalid", reason: "malformed" };
    }
    evidence.push(parsed);
  }
  return { status: "valid", evidence };
}

function parseStoredActivitySessionEvidence(
  value: unknown,
): WearableActivitySessionEvidence | null {
  if (!isJsonObject(value)) {
    return null;
  }

  const activityType = nullableString(value.activityType);
  const durationMinutes = isFiniteNumber(value.durationMinutes)
    ? value.durationMinutes
    : null;
  const endedAt = nullableParseableTimestamp(value.endedAt);
  const reconciliationExactKey =
    typeof value.reconciliationExactKey === "string"
    && STORED_ACTIVITY_SESSION_EXACT_KEY_PATTERN.test(value.reconciliationExactKey)
      ? value.reconciliationExactKey
      : undefined;
  const reconciliationResourceKey = value.reconciliationResourceKey === null
    ? null
    : (
        typeof value.reconciliationResourceKey === "string"
        && STORED_ACTIVITY_SESSION_RESOURCE_KEY_PATTERN.test(value.reconciliationResourceKey)
          ? value.reconciliationResourceKey
          : undefined
      );
  const recordedAt = nullableParseableTimestamp(value.recordedAt);
  const startedAt = nullableParseableTimestamp(value.startedAt);
  const heartRateZones = parseStoredHeartRateZones(value.heartRateZones);
  const workoutMetricKeys = stringArray(value.workoutMetricKeys);
  const workoutMetricValues = parseStoredWorkoutMetricValues(value.workoutMetricValues);
  if (
    activityType === undefined
    || !isIsoDateString(value.date)
    || durationMinutes === null
    || durationMinutes <= 0
    || typeof value.durationConsistent !== "boolean"
    || endedAt === undefined
    || heartRateZones === null
    || typeof value.provider !== "string"
    || value.provider.length === 0
    || reconciliationExactKey === undefined
    || reconciliationResourceKey === undefined
    || recordedAt === undefined
    || startedAt === undefined
    || workoutMetricKeys === null
    || workoutMetricValues === null
    || (startedAt === null && endedAt !== null)
    || (
      startedAt !== null
      && endedAt !== null
      && Date.parse(endedAt) <= Date.parse(startedAt)
    )
  ) {
    return null;
  }

  return {
    activityType,
    date: value.date,
    durationMinutes,
    durationConsistent: value.durationConsistent,
    endedAt,
    heartRateZones,
    provider: value.provider,
    reconciliationExactKey,
    reconciliationResourceKey,
    recordedAt,
    startedAt,
    workoutMetricKeys,
    workoutMetricValues,
  };
}

function parseStoredHeartRateZones(value: unknown): WearableHeartRateZoneAggregate[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const zones: WearableHeartRateZoneAggregate[] = [];
  for (const rawZone of value) {
    if (!isJsonObject(rawZone) || !isFiniteNumber(rawZone.durationMinutes)) {
      return null;
    }
    if (
      !isOptionalString(rawZone.label)
      || !isOptionalFiniteNumber(rawZone.maxHeartRate)
      || !isOptionalFiniteNumber(rawZone.minHeartRate)
      || !isOptionalFiniteNumber(rawZone.zone)
    ) {
      return null;
    }
    zones.push({
      durationMinutes: rawZone.durationMinutes,
      ...(rawZone.label === undefined ? {} : { label: rawZone.label }),
      ...(rawZone.maxHeartRate === undefined ? {} : { maxHeartRate: rawZone.maxHeartRate }),
      ...(rawZone.minHeartRate === undefined ? {} : { minHeartRate: rawZone.minHeartRate }),
      ...(rawZone.zone === undefined ? {} : { zone: rawZone.zone }),
    });
  }
  return zones;
}

function parseStoredWorkoutMetricValues(
  value: unknown,
): WearableActivitySessionMetricValues | null {
  if (!isJsonObject(value)) {
    return null;
  }

  const keys = [
    "activeCalories",
    "distanceKm",
    "maxHeartRate",
    "totalElevationGainMeters",
    "workoutStrain",
  ] as const satisfies readonly (keyof WearableActivitySessionMetricValues)[];
  const parsed: WearableActivitySessionMetricValues = {};
  for (const key of keys) {
    const metricValue = value[key];
    if (!isOptionalFiniteNumber(metricValue)) {
      return null;
    }
    if (metricValue !== undefined) {
      parsed[key] = metricValue;
    }
  }
  return parsed;
}

function nullableString(value: unknown): string | null | undefined {
  return value === null || typeof value === "string" ? value : undefined;
}

function nullableParseableTimestamp(value: unknown): string | null | undefined {
  return value === null
    ? null
    : (
        typeof value === "string"
        && ISO_TIMESTAMP_PATTERN.test(value)
        && isIsoDateString(value.slice(0, 10))
        && Number.isFinite(Date.parse(value))
          ? value
          : undefined
      );
}

function nullableBoundedString(
  value: unknown,
  maxLength: number,
): string | null | undefined {
  return value === null
    ? null
    : (
        typeof value === "string"
        && value.length > 0
        && value.length <= maxLength
        && value.trim() === value
        && !CONTROL_CHARACTER_PATTERN.test(value)
          ? value
          : undefined
      );
}

function nullableStoredToken(value: unknown): string | null | undefined {
  return value === null ? null : isStoredToken(value) ? value : undefined;
}

function isStoredToken(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 120
    && STORED_TOKEN_PATTERN.test(value);
}

function isIsoDateString(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? [...value]
    : null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStoredEvidenceCount(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0;
}

function isStoredEvidenceFingerprint(value: unknown): value is string {
  return typeof value === "string"
    && STORED_EVIDENCE_FINGERPRINT_PATTERN.test(value);
}

function storedEvidenceFingerprint(value: unknown): string {
  return `fnv1a64:${fnv1a64Hex(
    stableJsonStringify(JSON.parse(JSON.stringify(value))),
  )}`;
}

function stableJsonStringify(value: unknown): string {
  if (
    value === null
    || typeof value === "boolean"
    || typeof value === "number"
    || typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJsonStringify).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJsonStringify(entry)}`)
      .join(",")}}`;
  }
  throw new TypeError("Stored activity evidence must be JSON-serializable.");
}

function isOptionalFiniteNumber(value: unknown): value is number | undefined {
  return value === undefined || isFiniteNumber(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

const ACTIVITY_METRIC_RESOURCE_CLASSES = new Set<WearableActivityMetricResourceClass>([
  "activity",
  "cycle",
  "generic",
  "none",
]);
const WEARABLE_CANDIDATE_SOURCE_FAMILIES = new Set<WearableCandidateSourceFamily>([
  "canonical",
  "derived",
  "event",
  "sample",
]);
const STORED_ACTIVITY_METRIC_EVIDENCE_KEYS = new Set([
  "candidateKey",
  "date",
  "exactKey",
  "hasDayStrainFacet",
  "metric",
  "occurredAt",
  "origin",
  "provider",
  "publicProvider",
  "recordedAt",
  "resourceClass",
  "sourceFamily",
  "sourceKind",
  "unit",
  "value",
]);
const STORED_ACTIVITY_METRIC_ORIGIN_KEYS = new Set([
  "aggregatorProvider",
  "sourceProviderSlug",
  "sourceType",
]);
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const STORED_TOKEN_PATTERN = /^[a-z0-9]+(?:[ ._:/-][a-z0-9]+)*$/u;
const STORED_ACTIVITY_METRIC_CANDIDATE_KEY_PATTERN =
  /^activity-metric-candidate:\d{10}$/u;
const STORED_ACTIVITY_METRIC_EXACT_KEY_PATTERN =
  /^activity-metric-exact:\d{10}$/u;
const STORED_ACTIVITY_SESSION_EXACT_KEY_PATTERN =
  /^activity-session-exact:\d{10}$/u;
const STORED_ACTIVITY_SESSION_RESOURCE_KEY_PATTERN =
  /^activity-session-resource:\d{10}$/u;
const STORED_EVIDENCE_FINGERPRINT_PATTERN = /^fnv1a64:[a-f0-9]{16}$/u;
const FNV_64_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_64_PRIME = 0x100000001b3n;
const FNV_64_MASK = 0xffffffffffffffffn;

function fnv1a64Hex(value: string): string {
  let hash = FNV_64_OFFSET_BASIS;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * FNV_64_PRIME) & FNV_64_MASK;
  }
  return hash.toString(16).padStart(16, "0");
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

function hasExactObjectKeys(
  value: Record<string, unknown>,
  expectedKeys: ReadonlySet<string>,
): boolean {
  const keys = Object.keys(value);
  return keys.length === expectedKeys.size
    && keys.every((key) => expectedKeys.has(key));
}
