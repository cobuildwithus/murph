import { requiresHistoricalResetDeviceSyncSource } from "@murphai/device-syncd/public-account";

import type { HostedDeviceConnectionSource } from "./prisma-store/sources";

export type HostedBrowserDeviceSyncConnectionSourceRecoveryKind = "connection_reset";

export interface HostedBrowserDeviceSyncConnectionSource {
  connectionId: string;
  firstSeenAt: string;
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
    lastSeenAt: source.lastSeenAt,
    ...(recoveryKind ? { recoveryKind } : {}),
    ...(requiresHostedDeviceConnectionSourceReconnect(source)
      ? { requiresReconnect: true }
      : {}),
    resourceCount: countSourceResources(source.resourceAvailabilitySummary),
    sourceProviderSlug: source.sourceProviderSlug,
    status: source.status,
  };
}

const CONNECTION_SOURCE_SUMMARY_METADATA_KEYS = new Set([
  "sourceInstanceKeyFallback",
]);
export const HOSTED_DEVICE_CONNECTION_SOURCE_RECONNECT_ERROR_CODES = [
  "TOKEN_REFRESH_FAILED",
] as const;
const CONNECTION_SOURCE_RECONNECT_ERROR_CODES = new Set<string>(
  HOSTED_DEVICE_CONNECTION_SOURCE_RECONNECT_ERROR_CODES,
);

/**
 * True when a `resourceAvailabilitySummary` entry names an available resource
 * rather than bookkeeping metadata or an unavailable marker.
 */
export function isAvailableConnectionSourceResource(
  key: string,
  value: unknown,
): boolean {
  return !CONNECTION_SOURCE_SUMMARY_METADATA_KEYS.has(key)
    && value !== false
    && value !== null
    && value !== undefined;
}

function countSourceResources(
  summary: HostedDeviceConnectionSource["resourceAvailabilitySummary"],
): number {
  if (!summary) {
    return 0;
  }

  return Object.entries(summary).filter(([key, value]) =>
    isAvailableConnectionSourceResource(key, value)
  ).length;
}

export function requiresHostedDeviceConnectionSourceReconnect(
  source: {
    lastErrorCode?: string | null;
    status?: string | null;
  },
): boolean {
  return source.status === "error"
    && typeof source.lastErrorCode === "string"
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
