export type JunctionHistoricalBackfillStatus = "complete" | "exhausted" | "retrying";

export interface JunctionHistoricalBackfillProgress {
  emptyAttempts: number;
  lastEmptyAt: string | null;
  status: JunctionHistoricalBackfillStatus;
  windowEnd: string;
  windowStart: string;
}

export const JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS = Object.freeze({
  status: "junctionHistoricalBackfillStatus",
  emptyAttempts: "junctionHistoricalBackfillEmptyAttempts",
  lastEmptyAt: "junctionHistoricalBackfillLastEmptyAt",
  windowStart: "junctionHistoricalBackfillWindowStart",
  windowEnd: "junctionHistoricalBackfillWindowEnd",
} as const);

const JUNCTION_HISTORICAL_BACKFILL_METADATA_KEY_SET = new Set<string>(
  Object.values(JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS),
);

export function isJunctionHistoricalBackfillMetadataKey(key: string): boolean {
  return JUNCTION_HISTORICAL_BACKFILL_METADATA_KEY_SET.has(key);
}

export function readJunctionHistoricalBackfillProgress(
  metadata: Record<string, unknown>,
): JunctionHistoricalBackfillProgress | null {
  const status = readJunctionHistoricalBackfillStatus(
    metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.status],
  );
  const windowStart = readMetadataString(metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.windowStart]);
  const windowEnd = readMetadataString(metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.windowEnd]);

  if (!status || !windowStart || !windowEnd) {
    return null;
  }

  return {
    emptyAttempts: readNonNegativeInteger(
      metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.emptyAttempts],
    ),
    lastEmptyAt: readNullableMetadataString(
      metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.lastEmptyAt],
    ),
    status,
    windowEnd,
    windowStart,
  };
}

export function shouldPreserveLocalJunctionHistoricalBackfillProgress(input: {
  hostedMetadata: Record<string, unknown>;
  localConnectionStateUnpublished: boolean;
  localMetadata: Record<string, unknown>;
}): boolean {
  if (!input.localConnectionStateUnpublished) {
    return false;
  }

  const localProgress = readJunctionHistoricalBackfillProgress(input.localMetadata);
  if (!localProgress) {
    return false;
  }

  const hostedProgress = readJunctionHistoricalBackfillProgress(input.hostedMetadata);
  if (!hostedProgress) {
    return true;
  }

  if (
    localProgress.windowStart !== hostedProgress.windowStart
    || localProgress.windowEnd !== hostedProgress.windowEnd
  ) {
    return false;
  }

  if (localProgress.status === "complete") {
    return hostedProgress.status !== "complete";
  }

  if (hostedProgress.status === "complete" || hostedProgress.status === "exhausted") {
    return false;
  }

  if (localProgress.status === "exhausted") {
    return true;
  }

  const localLastEmptyAtMs = localProgress.lastEmptyAt ? parseIsoMs(localProgress.lastEmptyAt) : null;
  const hostedLastEmptyAtMs = hostedProgress.lastEmptyAt ? parseIsoMs(hostedProgress.lastEmptyAt) : null;

  if (localLastEmptyAtMs !== null && hostedLastEmptyAtMs !== null) {
    if (localLastEmptyAtMs > hostedLastEmptyAtMs) {
      return true;
    }

    if (localLastEmptyAtMs < hostedLastEmptyAtMs) {
      return false;
    }
  }

  return localProgress.emptyAttempts > hostedProgress.emptyAttempts;
}

export function mergeHostedJunctionHistoricalBackfillMetadata(input: {
  hostedMetadata: Record<string, unknown>;
  localConnectionStateUnpublished: boolean;
  localMetadata: Record<string, unknown>;
}): { metadata: Record<string, unknown>; preservedLocalProgress: boolean } {
  const metadata = { ...input.hostedMetadata };
  const preservedLocalProgress = shouldPreserveLocalJunctionHistoricalBackfillProgress(input);

  if (!preservedLocalProgress) {
    return { metadata, preservedLocalProgress };
  }

  for (const [key, value] of Object.entries(input.localMetadata)) {
    if (isJunctionHistoricalBackfillMetadataKey(key)) {
      metadata[key] = value;
    }
  }

  return { metadata, preservedLocalProgress };
}

function readJunctionHistoricalBackfillStatus(value: unknown): JunctionHistoricalBackfillStatus | null {
  return value === "complete" || value === "exhausted" || value === "retrying" ? value : null;
}

function readMetadataString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function readNullableMetadataString(value: unknown): string | null {
  return value === null ? null : readMetadataString(value);
}

function readNonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function parseIsoMs(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}
