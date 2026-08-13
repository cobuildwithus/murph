import {
  isJunctionDailyCanonicalCoverageResource,
  JUNCTION_ALLOWED_SUMMARY_RESOURCES,
  JUNCTION_ALLOWED_TIMESERIES_RESOURCES,
  normalizeJunctionCanonicalCoverageBoundary,
} from "@murphai/importers/device-providers/junction-resources";
import {
  DEVICE_SYNC_SOURCE_PROVIDER_DISCONNECTED_ERROR_CODE,
  DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE,
} from "./public-account.ts";

export {
  DEVICE_SYNC_SOURCE_PROVIDER_DISCONNECTED_ERROR_CODE,
  DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE,
};

export const DEVICE_SYNC_SOURCE_HISTORICAL_BACKFILL_COMPLETED_AT_KEY =
  "historicalBackfillCompletedAt";

export const DEVICE_SYNC_SOURCE_CANONICAL_COVERAGE_BOUNDARY_KEY_PREFIX =
  "canonicalCoverageBoundary_";

export const DEVICE_SYNC_SOURCE_CANONICAL_COVERAGE_FINALIZED_AT_KEY_PREFIX =
  "canonicalCoverageFinalizedAt_";

export const DEVICE_SYNC_GOOGLE_HEALTH_FITBIT_CUTOVER_FAILED_ERROR_CODE =
  "GOOGLE_HEALTH_FITBIT_CUTOVER_FAILED";

const DEVICE_SYNC_SOURCE_RESOURCE_AVAILABILITY_METADATA_KEYS = new Set([
  DEVICE_SYNC_SOURCE_HISTORICAL_BACKFILL_COMPLETED_AT_KEY,
  "sourceInstanceKeyFallback",
]);

// Only resources that can produce dated canonical records need a handoff
// boundary. `profile` is a current-state snapshot, and unknown provider
// availability fields never enter the canonical import path.
const DEVICE_SYNC_SOURCE_CANONICAL_COVERAGE_RESOURCES = new Set<string>([
  ...JUNCTION_ALLOWED_SUMMARY_RESOURCES.filter((resource) => resource !== "profile"),
  ...JUNCTION_ALLOWED_TIMESERIES_RESOURCES,
]);

export function isDeviceSyncSourceHistoricalBackfillComplete(source: {
  firstSeenAt?: string | null;
  resourceAvailabilitySummary?: Record<string, unknown> | null;
}): boolean {
  const completedAt = source.resourceAvailabilitySummary?.[
    DEVICE_SYNC_SOURCE_HISTORICAL_BACKFILL_COMPLETED_AT_KEY
  ];
  if (typeof completedAt !== "string" || !source.firstSeenAt) {
    return false;
  }

  const completedAtMs = Date.parse(completedAt);
  const firstSeenAtMs = Date.parse(source.firstSeenAt);
  return Number.isFinite(completedAtMs)
    && Number.isFinite(firstSeenAtMs)
    && completedAtMs >= firstSeenAtMs;
}

export function isDeviceSyncSourceResourceAvailabilityMetadataKey(
  key: string,
): boolean {
  return DEVICE_SYNC_SOURCE_RESOURCE_AVAILABILITY_METADATA_KEYS.has(key)
    || key.startsWith(
      DEVICE_SYNC_SOURCE_CANONICAL_COVERAGE_BOUNDARY_KEY_PREFIX,
    )
    || key.startsWith(
      DEVICE_SYNC_SOURCE_CANONICAL_COVERAGE_FINALIZED_AT_KEY_PREFIX,
    );
}

export function buildDeviceSyncSourceCanonicalCoverageBoundaryKey(
  resource: string,
): string | null {
  const normalized = resource.trim();
  return /^[A-Za-z][A-Za-z0-9_-]{0,38}$/u.test(normalized)
    ? `${DEVICE_SYNC_SOURCE_CANONICAL_COVERAGE_BOUNDARY_KEY_PREFIX}${normalized}`
    : null;
}

export function buildDeviceSyncSourceCanonicalCoverageFinalizedAtKey(
  resource: string,
): string | null {
  const normalized = resource.trim();
  return /^[A-Za-z][A-Za-z0-9_-]{0,38}$/u.test(normalized)
    ? `${DEVICE_SYNC_SOURCE_CANONICAL_COVERAGE_FINALIZED_AT_KEY_PREFIX}${normalized}`
    : null;
}

export function readDeviceSyncSourceCanonicalCoverageBoundary(
  summary: Record<string, unknown> | null | undefined,
  resource: string,
): string | null {
  const key = buildDeviceSyncSourceCanonicalCoverageBoundaryKey(resource);
  const value = key ? summary?.[key] : undefined;
  return normalizeJunctionCanonicalCoverageBoundary(resource, value);
}

export function readDeviceSyncSourceCanonicalCoverageFinalizedAt(
  summary: Record<string, unknown> | null | undefined,
  resource: string,
): string | null {
  const key = buildDeviceSyncSourceCanonicalCoverageFinalizedAtKey(resource);
  const value = key ? summary?.[key] : undefined;
  if (typeof value !== "string") {
    return null;
  }
  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) && new Date(timestampMs).toISOString() === value
    ? value
    : null;
}

export function isGoogleHealthFitbitMigrationLegacyTerminal(source: {
  lastErrorCode?: string | null;
  status: string;
}): boolean {
  return source.status === "disconnected"
    && (
      source.lastErrorCode === null
      || source.lastErrorCode === undefined
      || source.lastErrorCode === DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE
      || source.lastErrorCode === DEVICE_SYNC_SOURCE_PROVIDER_DISCONNECTED_ERROR_CODE
    );
}

export function isGoogleHealthFitbitMigrationLegacyCoverageReady(input: {
  legacyAccessTerminal?: boolean;
  legacySummary: Record<string, unknown> | null | undefined;
  successorSummary: Record<string, unknown> | null | undefined;
}): boolean {
  const producedLegacyResources = [...DEVICE_SYNC_SOURCE_CANONICAL_COVERAGE_RESOURCES]
    .filter((resource) =>
      readDeviceSyncSourceCanonicalCoverageBoundary(input.legacySummary, resource) !== null
    );
  const uncoveredLegacyResources = [...DEVICE_SYNC_SOURCE_CANONICAL_COVERAGE_RESOURCES]
    .filter((resource) =>
      isAvailableDeviceSyncSourceResource(
        resource,
        input.legacySummary?.[resource],
      )
      && !producedLegacyResources.includes(resource)
    );

  if (uncoveredLegacyResources.length > 0) {
    return false;
  }

  if (
    input.legacyAccessTerminal !== true
    && producedLegacyResources.some((resource) =>
      isJunctionDailyCanonicalCoverageResource(resource)
      && !hasDeviceSyncSourceCanonicalCoverageFinalized(
        input.legacySummary,
        resource,
      )
    )
  ) {
    return false;
  }

  return producedLegacyResources.length === 0
    ? input.legacyAccessTerminal === true
    : producedLegacyResources.every((resource) =>
      isAvailableDeviceSyncSourceResource(
        resource,
        input.successorSummary?.[resource],
      )
    );
}

function hasDeviceSyncSourceCanonicalCoverageFinalized(
  summary: Record<string, unknown> | null | undefined,
  resource: string,
): boolean {
  return readDeviceSyncSourceCanonicalCoverageFinalizedAt(summary, resource) !== null;
}

export function countAvailableDeviceSyncSourceResources(
  summary: Record<string, unknown> | null | undefined,
): number {
  return Object.entries(summary ?? {}).filter(([key, value]) =>
    isAvailableDeviceSyncSourceResource(key, value)
  ).length;
}

export function isAvailableDeviceSyncSourceResource(
  key: string,
  value: unknown,
): boolean {
  if (isDeviceSyncSourceResourceAvailabilityMetadataKey(key)) {
    return false;
  }
  if (value === true) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim().toLowerCase() === "available";
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const availability = value as { available?: unknown; status?: unknown };
  if (Object.hasOwn(availability, "available")) {
    return availability.available === true;
  }
  return typeof availability.status === "string"
    && availability.status.trim().toLowerCase() === "available";
}

export function isGoogleHealthFitbitMigrationSuccessorReady(input: {
  firstSeenAt?: string | null;
  historicalBackfillComplete: boolean;
  lastDataAt?: string | null;
  resourceCount: number;
  status: string;
}): boolean {
  if (
    input.status !== "connected"
    || !input.historicalBackfillComplete
    || input.resourceCount <= 0
    || !input.firstSeenAt
    || !input.lastDataAt
  ) {
    return false;
  }

  const firstSeenAtMs = Date.parse(input.firstSeenAt);
  const lastDataAtMs = Date.parse(input.lastDataAt);
  return Number.isFinite(firstSeenAtMs)
    && Number.isFinite(lastDataAtMs)
    && lastDataAtMs > firstSeenAtMs;
}
