import {
  normalizeDeviceConnectSourceId,
  normalizeJunctionLinkProviderFilter,
  resolveJunctionLinkDeviceConnectRouteByProviderSlug,
} from "./connect-routes.ts";

import type {
  ConfiguredDeviceSyncProviderKey,
  ConfiguredDeviceSyncProviderPresence,
} from "./provider-types.ts";

export interface DeviceSyncConnectTarget {
  connectSourceId: string;
  connectTarget: string;
  label: string;
  provider: ConfiguredDeviceSyncProviderKey;
  sourceProviderSlug?: string | null;
}

type DeviceSyncConnectTargetProviderConfigs = ConfiguredDeviceSyncProviderPresence & {
  junction?: { providerFilter?: string[] };
};

// Keep provider ingestion configured for existing accounts while this product
// gate controls whether a fresh user-facing connection can be started.
const DISABLED_DEVICE_CONNECT_SOURCE_IDS = new Set(["strava", "dexcom", "google-fit"]);

export function normalizeDeviceSyncConnectTargetKey(value: string): string | null {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, "_")
    .replace(/^_+|_+$/gu, "");

  return normalized || null;
}

export function isDeviceConnectSourceAvailableForConnection(
  connectSourceId: string,
): boolean {
  const normalized = normalizeDeviceConnectSourceId(connectSourceId);
  return Boolean(normalized && !DISABLED_DEVICE_CONNECT_SOURCE_IDS.has(normalized));
}

export function listConfiguredDeviceSyncConnectTargets(
  providerConfigs: DeviceSyncConnectTargetProviderConfigs,
): DeviceSyncConnectTarget[] {
  const targets: DeviceSyncConnectTarget[] = [];
  const junctionConfig = providerConfigs.junction;
  const junctionSourceProviderSlugs = junctionConfig
    ? normalizeJunctionLinkProviderFilter(junctionConfig.providerFilter)
    : [];
  if (junctionConfig) {
    for (const sourceProviderSlug of junctionSourceProviderSlugs) {
      const junctionRoute = resolveJunctionLinkDeviceConnectRouteByProviderSlug(sourceProviderSlug);
      if (!junctionRoute) {
        continue;
      }

      addDeviceSyncConnectTarget(targets, {
        connectSourceId: junctionRoute.source.connectSourceId,
        connectTarget: junctionRoute.route.connectTarget,
        label: junctionRoute.source.label,
        provider: "junction",
        sourceProviderSlug: junctionRoute.route.sourceProviderSlug,
      });
    }
  }

  return targets;
}

export function resolveConfiguredDeviceSyncConnectTarget(
  providerConfigs: DeviceSyncConnectTargetProviderConfigs,
  requestedConnectTarget: string,
): DeviceSyncConnectTarget | null {
  const connectTarget = normalizeDeviceSyncConnectTargetKey(requestedConnectTarget);
  if (!connectTarget) {
    return null;
  }

  return listConfiguredDeviceSyncConnectTargets(providerConfigs).find(
    (target) => target.connectTarget === connectTarget,
  ) ?? null;
}

export function resolveConfiguredDeviceSyncConnectTargetBySourceId(
  providerConfigs: DeviceSyncConnectTargetProviderConfigs,
  requestedConnectSourceId: string,
): DeviceSyncConnectTarget | null {
  const connectSourceId = normalizeDeviceConnectSourceId(requestedConnectSourceId);
  if (!connectSourceId) {
    return null;
  }

  return listConfiguredDeviceSyncConnectTargets(providerConfigs).find(
    (target) => target.connectSourceId === connectSourceId,
  ) ?? null;
}

function addDeviceSyncConnectTarget(
  targets: DeviceSyncConnectTarget[],
  target: DeviceSyncConnectTarget,
): void {
  const connectSourceId = normalizeDeviceConnectSourceId(target.connectSourceId);
  const connectTarget = normalizeDeviceSyncConnectTargetKey(target.connectTarget);
  if (!connectSourceId || !connectTarget) {
    return;
  }

  const sourceProviderSlug = target.sourceProviderSlug
    ? normalizeDeviceSyncConnectTargetKey(target.sourceProviderSlug)
    : null;

  const normalizedTarget = {
    connectSourceId,
    connectTarget,
    label: target.label,
    provider: target.provider,
    ...(sourceProviderSlug ? { sourceProviderSlug } : {}),
  };

  targets.push(normalizedTarget);
}
