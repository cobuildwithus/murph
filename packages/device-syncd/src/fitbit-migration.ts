import {
  isJunctionDailyCanonicalCoverageResource,
  JUNCTION_ALLOWED_SUMMARY_RESOURCES,
  JUNCTION_ALLOWED_TIMESERIES_RESOURCES,
  normalizeJunctionCanonicalCoverageBoundary,
} from "@murphai/importers/device-providers/junction-resources";

import {
  JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG,
  JUNCTION_GOOGLE_HEALTH_PROVIDER_SLUG,
  normalizeJunctionProviderSlug,
} from "./connect-config.ts";
import {
  DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
  DEVICE_SYNC_SOURCE_PROVIDER_DISCONNECTED_ERROR_CODE,
  DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE,
  isDeviceSyncSourceDisconnectFenced,
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

const RESOURCE_METADATA_KEYS = new Set([
  DEVICE_SYNC_SOURCE_HISTORICAL_BACKFILL_COMPLETED_AT_KEY,
  "sourceInstanceKeyFallback",
]);
const CANONICAL_RESOURCES = new Set<string>([
  ...JUNCTION_ALLOWED_SUMMARY_RESOURCES.filter((resource) => resource !== "profile"),
  ...JUNCTION_ALLOWED_TIMESERIES_RESOURCES,
]);

export interface GoogleHealthFitbitMigrationSource {
  firstSeenAt?: string | null;
  id?: string;
  lastDataAt?: string | null;
  lastErrorCode?: string | null;
  lastSeenAt?: string;
  resourceAvailabilitySummary?: Record<string, unknown> | null;
  sourceProviderSlug: string;
  status: string;
}

export function resolveGoogleHealthFitbitMigrationSources<
  TSource extends GoogleHealthFitbitMigrationSource,
>(sources: readonly TSource[]): { legacy: TSource | null; successor: TSource | null } {
  let legacy: TSource | null = null;
  let successor: TSource | null = null;
  for (const source of sources) {
    const slug = normalizeJunctionProviderSlug(source.sourceProviderSlug);
    if (slug === JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG) {
      legacy ??= source;
    } else if (slug === JUNCTION_GOOGLE_HEALTH_PROVIDER_SLUG) {
      successor ??= source;
    }
  }
  return { legacy, successor };
}

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

export function isDeviceSyncSourceResourceAvailabilityMetadataKey(key: string): boolean {
  return RESOURCE_METADATA_KEYS.has(key)
    || key.startsWith(DEVICE_SYNC_SOURCE_CANONICAL_COVERAGE_BOUNDARY_KEY_PREFIX)
    || key.startsWith(DEVICE_SYNC_SOURCE_CANONICAL_COVERAGE_FINALIZED_AT_KEY_PREFIX);
}

function coverageKey(prefix: string, resource: string): string | null {
  const normalized = resource.trim();
  return /^[A-Za-z][A-Za-z0-9_-]{0,38}$/u.test(normalized)
    ? `${prefix}${normalized}`
    : null;
}

export function buildDeviceSyncSourceCanonicalCoverageBoundaryKey(
  resource: string,
): string | null {
  return coverageKey(DEVICE_SYNC_SOURCE_CANONICAL_COVERAGE_BOUNDARY_KEY_PREFIX, resource);
}

export function buildDeviceSyncSourceCanonicalCoverageFinalizedAtKey(
  resource: string,
): string | null {
  return coverageKey(DEVICE_SYNC_SOURCE_CANONICAL_COVERAGE_FINALIZED_AT_KEY_PREFIX, resource);
}

export function readDeviceSyncSourceCanonicalCoverageBoundary(
  summary: Record<string, unknown> | null | undefined,
  resource: string,
): string | null {
  const key = buildDeviceSyncSourceCanonicalCoverageBoundaryKey(resource);
  return normalizeJunctionCanonicalCoverageBoundary(resource, key ? summary?.[key] : undefined);
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
      source.lastErrorCode == null
      || source.lastErrorCode === DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE
      || source.lastErrorCode === DEVICE_SYNC_SOURCE_PROVIDER_DISCONNECTED_ERROR_CODE
    );
}

export function isGoogleHealthFitbitMigrationLegacyCoverageReady(input: {
  legacyAccessTerminal?: boolean;
  legacySummary: Record<string, unknown> | null | undefined;
  successorSummary: Record<string, unknown> | null | undefined;
}): boolean {
  const produced = [...CANONICAL_RESOURCES].filter((resource) =>
    readDeviceSyncSourceCanonicalCoverageBoundary(input.legacySummary, resource) !== null
  );
  if ([...CANONICAL_RESOURCES].some((resource) =>
    isAvailableDeviceSyncSourceResource(resource, input.legacySummary?.[resource])
    && !produced.includes(resource)
  )) {
    return false;
  }
  if (
    input.legacyAccessTerminal !== true
    && produced.some((resource) =>
      isJunctionDailyCanonicalCoverageResource(resource)
      && readDeviceSyncSourceCanonicalCoverageFinalizedAt(input.legacySummary, resource) === null
    )
  ) {
    return false;
  }
  return produced.length === 0
    ? input.legacyAccessTerminal === true
    : produced.every((resource) =>
      isAvailableDeviceSyncSourceResource(resource, input.successorSummary?.[resource])
    );
}

export function countAvailableDeviceSyncSourceResources(
  summary: Record<string, unknown> | null | undefined,
): number {
  return Object.entries(summary ?? {}).filter(([key, value]) =>
    isAvailableDeviceSyncSourceResource(key, value)
  ).length;
}

export function isAvailableDeviceSyncSourceResource(key: string, value: unknown): boolean {
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

export function isGoogleHealthFitbitMigrationCutoverReady(input: {
  allowedLegacyClaim?: { lastSeenAt: string; sourceId: string } | null;
  sources: readonly GoogleHealthFitbitMigrationSource[];
}): boolean {
  const { legacy, successor } = resolveGoogleHealthFitbitMigrationSources(input.sources);
  if (!legacy || !successor) {
    return false;
  }
  const legacyTerminal = isGoogleHealthFitbitMigrationLegacyTerminal(legacy);
  const ownsClaim = Boolean(
    input.allowedLegacyClaim
    && legacy.id === input.allowedLegacyClaim.sourceId
    && legacy.lastSeenAt === input.allowedLegacyClaim.lastSeenAt
    && legacy.lastErrorCode === DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
  );
  return (
    legacyTerminal
    || (
      legacy.status !== "disconnected"
      && (!isDeviceSyncSourceDisconnectFenced(legacy) || ownsClaim)
    )
  )
    && isGoogleHealthFitbitMigrationLegacyCoverageReady({
      legacyAccessTerminal: legacyTerminal,
      legacySummary: legacy.resourceAvailabilitySummary,
      successorSummary: successor.resourceAvailabilitySummary,
    })
    && isGoogleHealthFitbitMigrationSuccessorReady({
      firstSeenAt: successor.firstSeenAt,
      historicalBackfillComplete: isDeviceSyncSourceHistoricalBackfillComplete(successor),
      lastDataAt: successor.lastDataAt,
      resourceCount: countAvailableDeviceSyncSourceResources(
        successor.resourceAvailabilitySummary,
      ),
      status: successor.status,
    });
}
