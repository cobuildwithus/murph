import {
  JUNCTION_COMPANION_HEALTH_METADATA_MAX_BATCH_BYTES,
  JUNCTION_COMPANION_HEALTH_METADATA_MAX_FUTURE_SKEW_MS,
  JUNCTION_COMPANION_HEALTH_METADATA_MAX_HISTORY_MS,
  JUNCTION_COMPANION_HEALTH_METADATA_MAX_RECORDS,
  JUNCTION_COMPANION_HEALTH_METADATA_SCHEMA_VERSION,
} from "./companion-health-metadata.ts";

const JUNCTION_COMPANION_HEALTH_METADATA_BATCH_KEYS = new Set(["schemaVersion", "records"]);
const JUNCTION_COMPANION_HEALTH_METADATA_RECORD_KEYS = new Set([
  "recordId",
  "kind",
  "value",
  "startAt",
  "endAt",
  "syncVersion",
]);
const JUNCTION_COMPANION_HEALTH_METADATA_RECORD_ID_PATTERN = /^[a-f0-9]{64}$/u;
const JUNCTION_COMPANION_HEALTH_METADATA_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;

export type JunctionCompanionHealthMetadataKind = "recovery_score" | "workout_strain";

export interface JunctionCompanionHealthMetadataRecord {
  endAt: string;
  kind: JunctionCompanionHealthMetadataKind;
  recordId: string;
  startAt: string;
  syncVersion: number;
  value: number;
}

export interface JunctionCompanionHealthMetadataBatch {
  records: JunctionCompanionHealthMetadataRecord[];
  schemaVersion: 1;
}

/**
 * Neutral decoded-batch validation failure. Boundary owners must map this to
 * their own HTTP or durable-job error without logging the rejected payload.
 */
export class JunctionCompanionHealthMetadataParseError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "JunctionCompanionHealthMetadataParseError";
  }
}

/**
 * Parses the deliberately closed companion HealthKit metadata batch.
 *
 * Callers continue to own authentication, transport byte limits, JSON
 * decoding, envelope validation, and boundary-specific error mapping. This
 * shared owner validates only the decoded batch and returns its canonical
 * sorted representation.
 */
export function parseJunctionCompanionHealthMetadataBatch(
  value: unknown,
  receivedAtMs: number,
): JunctionCompanionHealthMetadataBatch {
  if (!Number.isFinite(receivedAtMs)) {
    throw invalidCompanionHealthMetadata("receivedAt is invalid");
  }

  const batch = readPlainObject(value);
  if (!batch || hasUnexpectedObjectKeys(batch, JUNCTION_COMPANION_HEALTH_METADATA_BATCH_KEYS)) {
    throw invalidCompanionHealthMetadata("batch shape is invalid");
  }
  if (batch.schemaVersion !== JUNCTION_COMPANION_HEALTH_METADATA_SCHEMA_VERSION) {
    throw invalidCompanionHealthMetadata("schemaVersion is unsupported");
  }
  if (
    !Array.isArray(batch.records)
    || batch.records.length < 1
    || batch.records.length > JUNCTION_COMPANION_HEALTH_METADATA_MAX_RECORDS
  ) {
    throw invalidCompanionHealthMetadata("record count is invalid");
  }

  const recordIds = new Set<string>();
  const records = batch.records.map((value, index) => {
    const record = readPlainObject(value);
    if (!record || hasUnexpectedObjectKeys(record, JUNCTION_COMPANION_HEALTH_METADATA_RECORD_KEYS)) {
      throw invalidCompanionHealthMetadata(`record ${index + 1} shape is invalid`);
    }

    const recordId = record.recordId;
    if (typeof recordId !== "string" || !JUNCTION_COMPANION_HEALTH_METADATA_RECORD_ID_PATTERN.test(recordId)) {
      throw invalidCompanionHealthMetadata(`record ${index + 1} recordId is invalid`);
    }
    if (recordIds.has(recordId)) {
      throw invalidCompanionHealthMetadata(`record ${index + 1} recordId is duplicated`);
    }
    recordIds.add(recordId);

    const kind = record.kind;
    if (kind !== "recovery_score" && kind !== "workout_strain") {
      throw invalidCompanionHealthMetadata(`record ${index + 1} kind is invalid`);
    }

    const numericValue = record.value;
    const valueLimit = kind === "recovery_score" ? 100 : 21;
    if (
      typeof numericValue !== "number"
      || !Number.isFinite(numericValue)
      || numericValue < 0
      || numericValue > valueLimit
    ) {
      throw invalidCompanionHealthMetadata(`record ${index + 1} value is invalid`);
    }

    const startAt = toCompanionHealthMetadataIsoTimestamp(record.startAt);
    const endAt = toCompanionHealthMetadataIsoTimestamp(record.endAt);
    if (!startAt || !endAt || Date.parse(endAt) <= Date.parse(startAt)) {
      throw invalidCompanionHealthMetadata(`record ${index + 1} interval is invalid`);
    }
    if (Date.parse(startAt) < receivedAtMs - JUNCTION_COMPANION_HEALTH_METADATA_MAX_HISTORY_MS) {
      throw invalidCompanionHealthMetadata(`record ${index + 1} history is too old`);
    }
    if (Date.parse(endAt) > receivedAtMs + JUNCTION_COMPANION_HEALTH_METADATA_MAX_FUTURE_SKEW_MS) {
      throw invalidCompanionHealthMetadata(`record ${index + 1} endAt is too far in the future`);
    }

    const syncVersion = record.syncVersion;
    if (
      typeof syncVersion !== "number"
      || !Number.isSafeInteger(syncVersion)
      || syncVersion < 0
    ) {
      throw invalidCompanionHealthMetadata(`record ${index + 1} syncVersion is invalid`);
    }

    return {
      endAt,
      kind,
      recordId,
      startAt,
      syncVersion,
      value: numericValue,
    } satisfies JunctionCompanionHealthMetadataRecord;
  });

  records.sort((left, right) =>
    left.recordId.localeCompare(right.recordId) || left.kind.localeCompare(right.kind)
  );
  const canonicalBatch = {
    records,
    schemaVersion: JUNCTION_COMPANION_HEALTH_METADATA_SCHEMA_VERSION,
  } satisfies JunctionCompanionHealthMetadataBatch;

  if (
    new TextEncoder().encode(JSON.stringify(canonicalBatch)).byteLength
      > JUNCTION_COMPANION_HEALTH_METADATA_MAX_BATCH_BYTES
  ) {
    throw invalidCompanionHealthMetadata("canonical batch is too large");
  }

  return canonicalBatch;
}

function readPlainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasUnexpectedObjectKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
): boolean {
  return Object.keys(value).some((key) => !allowedKeys.has(key));
}

function toCompanionHealthMetadataIsoTimestamp(value: unknown): string | null {
  if (
    typeof value !== "string"
    || value.length > 64
    || !JUNCTION_COMPANION_HEALTH_METADATA_TIMESTAMP_PATTERN.test(value)
  ) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function invalidCompanionHealthMetadata(reason: string): JunctionCompanionHealthMetadataParseError {
  return new JunctionCompanionHealthMetadataParseError(reason);
}
