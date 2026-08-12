import {
  countAvailableDeviceSyncSourceResources,
  isDeviceSyncSourceHistoricalBackfillComplete,
  requiresHistoricalResetDeviceSyncSource,
} from "@murphai/device-syncd/public-account";

import type { HostedDeviceConnectionSource } from "./prisma-store/sources";

export {
  isAvailableDeviceSyncSourceResource as isAvailableConnectionSourceResource,
} from "@murphai/device-syncd/public-account";

export type HostedBrowserDeviceSyncConnectionSourceRecoveryKind = "connection_reset";

export interface HostedBrowserDeviceSyncConnectionSource {
  connectionId: string;
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
): HostedBrowserDeviceSyncConnectionSource {
  const recoveryKind = resolveConnectionSourceRecoveryKind(source);

  return {
    connectionId: browserConnectionId,
    firstSeenAt: source.firstSeenAt,
    ...(isDeviceSyncSourceHistoricalBackfillComplete(source)
      ? { historicalBackfillComplete: true as const }
      : {}),
    lastDataAt: source.lastDataAt,
    ...(source.lastErrorCode ? { lastErrorCode: source.lastErrorCode } : {}),
    lastSeenAt: source.lastSeenAt,
    ...(recoveryKind ? { recoveryKind } : {}),
    ...(requiresConnectionSourceReconnect(source) ? { requiresReconnect: true } : {}),
    resourceCount: countAvailableDeviceSyncSourceResources(
      source.resourceAvailabilitySummary,
    ),
    sourceProviderSlug: source.sourceProviderSlug,
    status: source.status,
  };
}

const CONNECTION_SOURCE_RECONNECT_ERROR_CODES = new Set(["TOKEN_REFRESH_FAILED"]);

/**
 * True when a `resourceAvailabilitySummary` entry names an available resource
 * rather than bookkeeping metadata or an unavailable marker.
 */
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
