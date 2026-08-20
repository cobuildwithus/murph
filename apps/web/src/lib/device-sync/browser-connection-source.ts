import {
  countAvailableDeviceSyncSourceResources,
  isDeviceSyncSourceHistoricalBackfillComplete,
  isDeviceSyncSourceResourceAvailabilityMetadataKey,
} from "@murphai/device-syncd/fitbit-migration";
import {
  JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG,
  JUNCTION_GOOGLE_HEALTH_PROVIDER_SLUG,
  normalizeJunctionProviderSlug,
} from "@murphai/device-syncd/connect-config";
import {
  requiresHistoricalResetDeviceSyncSource,
} from "@murphai/device-syncd/public-account";

import type { HostedDeviceConnectionSource } from "./prisma-store/sources";

export type HostedBrowserDeviceSyncConnectionSourceRecoveryKind = "connection_reset";

export interface HostedBrowserDeviceSyncConnectionSource {
  connectionId: string;
  fitbitMigrationCoverageReady?: true;
  firstSeenAt: string;
  historicalBackfillComplete?: true;
  lastErrorCode?: string | null;
  lastDataAt?: string | null;
  lastSeenAt: string;
  recoveryKind?: HostedBrowserDeviceSyncConnectionSourceRecoveryKind;
  requiresReconnect?: boolean;
  resourceCount: number;
  sourceProviderSlug: string;
  status: HostedDeviceConnectionSource["status"];
}

export function toHostedBrowserDeviceSyncConnectionSource(
  source: HostedDeviceConnectionSource,
  browserConnectionId: string,
  options: { fitbitMigrationCoverageReady?: boolean } = {},
): HostedBrowserDeviceSyncConnectionSource {
  const recoveryKind = resolveConnectionSourceRecoveryKind(source);

  return {
    connectionId: browserConnectionId,
    ...(options.fitbitMigrationCoverageReady
      ? { fitbitMigrationCoverageReady: true as const }
      : {}),
    firstSeenAt: source.firstSeenAt,
    ...(isDeviceSyncSourceHistoricalBackfillComplete(source)
      ? { historicalBackfillComplete: true as const }
      : {}),
    lastDataAt: source.lastDataAt,
    ...(source.lastErrorCode ? { lastErrorCode: source.lastErrorCode } : {}),
    lastSeenAt: source.lastSeenAt,
    ...(recoveryKind ? { recoveryKind } : {}),
    ...(requiresConnectionSourceReconnect(source) ? { requiresReconnect: true } : {}),
    resourceCount: countSourceResources(source),
    sourceProviderSlug: source.sourceProviderSlug,
    status: source.status,
  };
}

const CONNECTION_SOURCE_RECONNECT_ERROR_CODES = new Set(["TOKEN_REFRESH_FAILED"]);

/**
 * Preserves the existing browser/companion interpretation of resource entries
 * while excluding migration bookkeeping from user-facing resource lists.
 */
export function isAvailableConnectionSourceResource(
  key: string,
  value: unknown,
): boolean {
  return !isDeviceSyncSourceResourceAvailabilityMetadataKey(key)
    && value !== false
    && value !== null
    && value !== undefined;
}

function countSourceResources(source: HostedDeviceConnectionSource): number {
  const summary = source.resourceAvailabilitySummary;
  if (!summary) {
    return 0;
  }
  const sourceProviderSlug = normalizeJunctionProviderSlug(source.sourceProviderSlug);
  if (
    sourceProviderSlug === JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG
    || sourceProviderSlug === JUNCTION_GOOGLE_HEALTH_PROVIDER_SLUG
  ) {
    return countAvailableDeviceSyncSourceResources(summary);
  }
  return Object.entries(summary).filter(([key, value]) =>
    isAvailableConnectionSourceResource(key, value)
  ).length;
}

function requiresConnectionSourceReconnect(source: HostedDeviceConnectionSource): boolean {
  return source.status === "error"
    && source.lastErrorCode !== null
    && CONNECTION_SOURCE_RECONNECT_ERROR_CODES.has(source.lastErrorCode);
}

// Historical exports cannot restart on a reconnect alone: the provider requires the
// existing connection to be deregistered first, so project the semantic recovery
// kind instead of the raw error code or an ordinary reconnect flag.
export function resolveConnectionSourceRecoveryKind(
  source: HostedDeviceConnectionSource,
): HostedBrowserDeviceSyncConnectionSourceRecoveryKind | null {
  return requiresHistoricalResetDeviceSyncSource(source) ? "connection_reset" : null;
}
