import { formatDeviceSyncProviderLabel } from "../provider-label.ts";
import {
  normalizeDeviceConnectSourceId,
  normalizeJunctionLinkProviderFilter,
  resolveDirectDeviceConnectRouteByProvider,
  resolveJunctionLinkDeviceConnectRouteByProviderSlug,
} from "./connect-routes.ts";
import { listConfiguredDeviceSyncProviderNames } from "./provider-configs.ts";

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

const JUNCTION_PREFERRED_CONNECT_SOURCE_IDS = new Set(["oura", "strava"]);

export function normalizeDeviceSyncConnectTargetKey(value: string): string | null {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, "_")
    .replace(/^_+|_+$/gu, "");

  return normalized || null;
}

export function listConfiguredDeviceSyncConnectTargets(
  providerConfigs: DeviceSyncConnectTargetProviderConfigs,
): DeviceSyncConnectTarget[] {
  const targetsBySourceId = new Map<string, DeviceSyncConnectTarget>();

  for (const provider of listConfiguredDeviceSyncProviderNames(providerConfigs)) {
    if (provider === "junction") {
      continue;
    }

    const directRoute = resolveDirectDeviceConnectRouteByProvider(provider);
    addDeviceSyncConnectTarget(targetsBySourceId, {
      connectSourceId: directRoute?.source.connectSourceId ?? provider,
      connectTarget: directRoute?.route.connectTarget ?? provider,
      label: directRoute?.source.label ?? formatDeviceSyncProviderLabel(provider),
      provider,
    });
  }

  const junctionConfig = providerConfigs.junction;
  if (junctionConfig) {
    for (const sourceProviderSlug of normalizeJunctionLinkProviderFilter(junctionConfig.providerFilter)) {
      const junctionRoute = resolveJunctionLinkDeviceConnectRouteByProviderSlug(sourceProviderSlug);
      if (!junctionRoute) {
        continue;
      }

      addDeviceSyncConnectTarget(
        targetsBySourceId,
        {
          connectSourceId: junctionRoute.source.connectSourceId,
          connectTarget: junctionRoute.route.connectTarget,
          label: junctionRoute.source.label,
          provider: "junction",
          sourceProviderSlug: junctionRoute.route.sourceProviderSlug,
        },
        {
          replaceExisting: shouldPreferJunctionConnectSource(junctionRoute.source.connectSourceId),
        },
      );
    }
  }

  return [...targetsBySourceId.values()];
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

function addDeviceSyncConnectTarget(
  targetsBySourceId: Map<string, DeviceSyncConnectTarget>,
  target: DeviceSyncConnectTarget,
  options: { replaceExisting?: boolean } = {},
): void {
  const connectSourceId = normalizeDeviceConnectSourceId(target.connectSourceId);
  const connectTarget = normalizeDeviceSyncConnectTargetKey(target.connectTarget);
  if (
    !connectSourceId
    || !connectTarget
    || (targetsBySourceId.has(connectSourceId) && !options.replaceExisting)
  ) {
    return;
  }

  const sourceProviderSlug = target.sourceProviderSlug
    ? normalizeDeviceSyncConnectTargetKey(target.sourceProviderSlug)
    : null;

  targetsBySourceId.set(connectSourceId, {
    connectSourceId,
    connectTarget,
    label: target.label,
    provider: target.provider,
    ...(sourceProviderSlug ? { sourceProviderSlug } : {}),
  });
}

function shouldPreferJunctionConnectSource(connectSourceId: string): boolean {
  const normalizedConnectSourceId = normalizeDeviceConnectSourceId(connectSourceId);

  return normalizedConnectSourceId
    ? JUNCTION_PREFERRED_CONNECT_SOURCE_IDS.has(normalizedConnectSourceId)
    : false;
}
