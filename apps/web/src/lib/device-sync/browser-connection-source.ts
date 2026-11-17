import { isDeviceSyncSourceResourceAvailabilityMetadataKey } from "@murphai/device-syncd/fitbit-migration";
import {
  requiresHistoricalResetDeviceSyncSource,
} from "@murphai/device-syncd/public-account";

import type { HostedDeviceConnectionSource } from "./prisma-store/sources";

export type HostedBrowserDeviceSyncConnectionSourceRecoveryKind = "connection_reset";

export interface HostedBrowserDeviceSyncConnectionSource {
  connectionId: string;
  firstSeenAt: string;
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
): HostedBrowserDeviceSyncConnectionSource {
  const recoveryKind = resolveConnectionSourceRecoveryKind(source);

  return {
    connectionId: browserConnectionId,
    firstSeenAt: source.firstSeenAt,
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
 * Preserves the existing browser/companion interpretation of resource entries.
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
  return Object.entries(summary).filter(([key, value]) =>
    isAvailableConnectionSourceResource(key, value)
  ).length;
}

/**
 * The one Web rule for "this source's authorization lapsed". The member's own
 * connection screen and the consented group status both read it, so a group
 * never reports a weaker state than the member already sees.
 */
export function requiresConnectionSourceReconnect(source: {
  lastErrorCode: string | null;
  status: string;
}): boolean {
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
