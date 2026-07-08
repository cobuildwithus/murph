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
    emptyAttempts: readMetadataNumber(metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.emptyAttempts]),
    lastEmptyAt: readMetadataString(metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.lastEmptyAt]),
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

  if (localProgress.status === "retrying") {
    if (hostedProgress.status !== "retrying") {
      return false;
    }

    return compareJunctionRetryProgress(localProgress, hostedProgress) > 0;
  }

  if (localProgress.status === "complete") {
    return hostedProgress.status !== "complete";
  }

  return hostedProgress.status === "retrying";
}

export function mergeHostedJunctionHistoricalBackfillMetadata(input: {
  hostedMetadata: Record<string, unknown>;
  localConnectionStateUnpublished: boolean;
  localMetadata: Record<string, unknown>;
}): { metadata: Record<string, unknown>; preservedLocalProgress: boolean } {
  const preservedLocalProgress = shouldPreserveLocalJunctionHistoricalBackfillProgress(input);

  if (!preservedLocalProgress) {
    return { metadata: { ...input.hostedMetadata }, preservedLocalProgress };
  }

  const metadata: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input.localMetadata)) {
    if (isJunctionHistoricalBackfillMetadataKey(key)) {
      metadata[key] = value;
    }
  }

  for (const [key, value] of Object.entries(input.hostedMetadata)) {
    if (!Object.prototype.hasOwnProperty.call(metadata, key)) {
      metadata[key] = value;
    }
  }

  return { metadata, preservedLocalProgress };
}

function readJunctionHistoricalBackfillStatus(value: unknown): JunctionHistoricalBackfillStatus | null {
  return value === "complete" || value === "exhausted" || value === "retrying" ? value : null;
}

function compareJunctionRetryProgress(
  left: JunctionHistoricalBackfillProgress,
  right: JunctionHistoricalBackfillProgress,
): number {
  if (left.emptyAttempts !== right.emptyAttempts) {
    return left.emptyAttempts - right.emptyAttempts;
  }

  const leftLastEmptyAtMs = left.lastEmptyAt ? Date.parse(left.lastEmptyAt) : NaN;
  const rightLastEmptyAtMs = right.lastEmptyAt ? Date.parse(right.lastEmptyAt) : NaN;
  if (!Number.isFinite(leftLastEmptyAtMs) || !Number.isFinite(rightLastEmptyAtMs)) {
    return 0;
  }

  return leftLastEmptyAtMs - rightLastEmptyAtMs;
}

function readMetadataNumber(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function readMetadataString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}
