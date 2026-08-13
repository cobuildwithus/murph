import { formatDeviceSyncProviderLabel } from "../provider-label.ts";
import {
  listDirectDeviceConnectRouteEntries,
  normalizeDeviceConnectSourceId,
  normalizeJunctionLinkProviderFilter,
  resolveDirectDeviceConnectRouteByProvider,
  resolveJunctionLinkDeviceConnectRouteByProviderSlug,
} from "./connect-routes.ts";
import { listConfiguredDeviceSyncProviderNames } from "./provider-keys.ts";

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

const JUNCTION_PREFERRED_CONNECT_SOURCE_IDS = new Set(["whoop"]);
// Keep provider ingestion configured for existing accounts while this product
// gate controls whether a fresh user-facing connection can be started.
const DISABLED_DEVICE_CONNECT_SOURCE_IDS = new Set(["dexcom"]);

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
  if (!normalized) {
    return false;
  }
  return !DISABLED_DEVICE_CONNECT_SOURCE_IDS.has(normalized)
    && !listMemberOwnedDeviceSyncConnectTargets().some(
      (target) => target.connectSourceId === normalized,
    );
}

export function isMemberOwnedDeviceSyncConnectTarget(
  target: Pick<DeviceSyncConnectTarget, "connectSourceId" | "connectTarget" | "provider">,
): boolean {
  return listMemberOwnedDeviceSyncConnectTargets().some((candidate) =>
    candidate.connectSourceId === normalizeDeviceConnectSourceId(target.connectSourceId)
    && candidate.connectTarget === normalizeDeviceSyncConnectTargetKey(target.connectTarget)
    && candidate.provider === target.provider
  );
}

export function listMemberOwnedDeviceSyncConnectTargets(): DeviceSyncConnectTarget[] {
  return listDirectDeviceConnectRouteEntries()
    .filter(({ route }) => route.applicationOwnership === "member")
    .map(({ route, source }) => ({
      connectSourceId: source.connectSourceId,
      connectTarget: route.connectTarget,
      label: source.label,
      provider: route.provider,
    }));
}

export function listConfiguredDeviceSyncConnectTargets(
  providerConfigs: DeviceSyncConnectTargetProviderConfigs,
): DeviceSyncConnectTarget[] {
  return collectConfiguredDeviceSyncConnectTargets(providerConfigs, {
    dedupeBySourceId: true,
  });
}

export function listConfiguredDeviceSyncReconnectTargets(
  providerConfigs: DeviceSyncConnectTargetProviderConfigs,
): DeviceSyncConnectTarget[] {
  return collectConfiguredDeviceSyncConnectTargets(providerConfigs, {
    dedupeBySourceId: false,
  });
}

export function listDeviceSyncReconnectTargets(
  providerConfigs: DeviceSyncConnectTargetProviderConfigs = {},
): DeviceSyncConnectTarget[] {
  const targets = [
    ...listConfiguredDeviceSyncReconnectTargets(providerConfigs),
    ...listMemberOwnedDeviceSyncConnectTargets(),
  ];
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = buildDeviceSyncConnectTargetCoordinateKey(target);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function collectConfiguredDeviceSyncConnectTargets(
  providerConfigs: DeviceSyncConnectTargetProviderConfigs,
  options: { dedupeBySourceId: boolean },
): DeviceSyncConnectTarget[] {
  const targetsBySourceId = new Map<string, DeviceSyncConnectTarget>();
  const targets: DeviceSyncConnectTarget[] = [];
  const junctionConfig = providerConfigs.junction;
  const junctionSourceProviderSlugs = junctionConfig
    ? normalizeJunctionLinkProviderFilter(junctionConfig.providerFilter)
    : [];
  const junctionPreferredConnectSourceIds = new Set<string>();

  if (options.dedupeBySourceId) {
    for (const sourceProviderSlug of junctionSourceProviderSlugs) {
      const junctionRoute = resolveJunctionLinkDeviceConnectRouteByProviderSlug(sourceProviderSlug);
      const connectSourceId = junctionRoute
        ? normalizeDeviceConnectSourceId(junctionRoute.source.connectSourceId)
        : null;

      if (connectSourceId && JUNCTION_PREFERRED_CONNECT_SOURCE_IDS.has(connectSourceId)) {
        junctionPreferredConnectSourceIds.add(connectSourceId);
      }
    }
  }

  for (const provider of listConfiguredDeviceSyncProviderNames(providerConfigs)) {
    if (provider === "junction") {
      continue;
    }

    const directRoute = resolveDirectDeviceConnectRouteByProvider(provider);
    const directConnectSourceId = directRoute?.source.connectSourceId ?? provider;
    const normalizedDirectConnectSourceId =
      normalizeDeviceConnectSourceId(directConnectSourceId);
    if (
      normalizedDirectConnectSourceId
      && junctionPreferredConnectSourceIds.has(normalizedDirectConnectSourceId)
    ) {
      continue;
    }

    addDeviceSyncConnectTarget(targets, targetsBySourceId, {
      connectSourceId: directConnectSourceId,
      connectTarget: directRoute?.route.connectTarget ?? provider,
      label: directRoute?.source.label ?? formatDeviceSyncProviderLabel(provider),
      provider,
    }, options);
  }

  if (junctionConfig) {
    for (const sourceProviderSlug of junctionSourceProviderSlugs) {
      const junctionRoute = resolveJunctionLinkDeviceConnectRouteByProviderSlug(sourceProviderSlug);
      if (!junctionRoute) {
        continue;
      }

      addDeviceSyncConnectTarget(targets, targetsBySourceId, {
        connectSourceId: junctionRoute.source.connectSourceId,
        connectTarget: junctionRoute.route.connectTarget,
        label: junctionRoute.source.label,
        provider: "junction",
        sourceProviderSlug: junctionRoute.route.sourceProviderSlug,
      }, options);
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

function buildDeviceSyncConnectTargetCoordinateKey(
  target: DeviceSyncConnectTarget,
): string {
  return [
    normalizeDeviceConnectSourceId(target.connectSourceId) ?? "",
    normalizeDeviceSyncConnectTargetKey(target.connectTarget) ?? "",
    target.provider,
    normalizeDeviceSyncConnectTargetKey(target.sourceProviderSlug ?? "") ?? "",
  ].join("\u0000");
}

function addDeviceSyncConnectTarget(
  targets: DeviceSyncConnectTarget[],
  targetsBySourceId: Map<string, DeviceSyncConnectTarget>,
  target: DeviceSyncConnectTarget,
  options: { dedupeBySourceId: boolean },
): void {
  const connectSourceId = normalizeDeviceConnectSourceId(target.connectSourceId);
  const connectTarget = normalizeDeviceSyncConnectTargetKey(target.connectTarget);
  if (
    !connectSourceId
    || !connectTarget
    || (options.dedupeBySourceId && targetsBySourceId.has(connectSourceId))
  ) {
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
  targetsBySourceId.set(connectSourceId, normalizedTarget);
}
