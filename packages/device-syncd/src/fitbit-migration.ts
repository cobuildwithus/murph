import {
  JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG,
  JUNCTION_GOOGLE_HEALTH_PROVIDER_SLUG,
  normalizeJunctionProviderSlug,
} from "./config/connect-routes.ts";
import {
  DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
  DEVICE_SYNC_SOURCE_PROVIDER_DISCONNECTED_ERROR_CODE,
  DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE,
  isDeviceSyncSourceDisconnectFenced,
} from "./public-account.ts";

export {
  DEVICE_SYNC_SOURCE_PROVIDER_DISCONNECTED_ERROR_CODE,
  DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE,
  JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG,
  JUNCTION_GOOGLE_HEALTH_PROVIDER_SLUG,
};

export const DEVICE_SYNC_GOOGLE_HEALTH_FITBIT_CUTOVER_FAILED_ERROR_CODE =
  "GOOGLE_HEALTH_FITBIT_CUTOVER_FAILED";

// Older source rows can retain these keys. They are never data resources.
export function isDeviceSyncSourceResourceAvailabilityMetadataKey(key: string): boolean {
  return key === "sourceInstanceKeyFallback"
    || key === "historicalBackfillCompletedAt"
    || key.startsWith("canonicalCoverageBoundary_")
    || key.startsWith("canonicalCoverageFinalizedAt_");
}

export interface GoogleHealthFitbitMigrationSource {
  id?: string;
  lastErrorCode?: string | null;
  lastSeenAt?: string;
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

export function isGoogleHealthFitbitMigrationCutoverReady(input: {
  allowedLegacyClaim?: { lastSeenAt: string; sourceId: string } | null;
  sources: readonly GoogleHealthFitbitMigrationSource[];
}): boolean {
  const { legacy, successor } = resolveGoogleHealthFitbitMigrationSources(input.sources);
  if (!legacy || successor?.status !== "connected") {
    return false;
  }
  const legacyTerminal = isGoogleHealthFitbitMigrationLegacyTerminal(legacy);
  const ownsClaim = Boolean(
    input.allowedLegacyClaim
    && legacy.id === input.allowedLegacyClaim.sourceId
    && legacy.lastSeenAt === input.allowedLegacyClaim.lastSeenAt
    && legacy.lastErrorCode === DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
  );
  return legacyTerminal
    || (
      legacy.status !== "disconnected"
      && (!isDeviceSyncSourceDisconnectFenced(legacy) || ownsClaim)
    );
}
