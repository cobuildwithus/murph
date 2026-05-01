import { formatDeviceSyncProviderLabel } from "../provider-label.ts";
import { normalizeJunctionProviderFilter } from "../providers/junction.ts";
import { listConfiguredDeviceSyncProviderNames } from "./provider-configs.ts";

import type {
  ConfiguredDeviceSyncProviderKey,
  ConfiguredDeviceSyncProviderPresence,
} from "./provider-types.ts";

export interface DeviceSyncConnectTarget {
  connectTarget: string;
  label: string;
  provider: ConfiguredDeviceSyncProviderKey;
  sourceProviderSlug?: string | null;
}

type DeviceSyncConnectTargetProviderConfigs = ConfiguredDeviceSyncProviderPresence & {
  junction?: { providerFilter?: string[] };
};

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
  const targetsByKey = new Map<string, DeviceSyncConnectTarget>();

  for (const provider of listConfiguredDeviceSyncProviderNames(providerConfigs)) {
    if (provider === "junction") {
      continue;
    }

    addDeviceSyncConnectTarget(targetsByKey, {
      connectTarget: provider,
      label: formatDeviceSyncProviderLabel(provider),
      provider,
    });
  }

  const junctionConfig = providerConfigs.junction;
  if (junctionConfig) {
    for (const sourceProviderSlug of normalizeJunctionProviderFilter(junctionConfig.providerFilter)) {
      if (sourceProviderSlug === "junction") {
        continue;
      }

      addDeviceSyncConnectTarget(targetsByKey, {
        connectTarget: sourceProviderSlug,
        label: formatDeviceSyncProviderLabel(sourceProviderSlug),
        provider: "junction",
        sourceProviderSlug,
      });
    }
  }

  return [...targetsByKey.values()];
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
  targetsByKey: Map<string, DeviceSyncConnectTarget>,
  target: DeviceSyncConnectTarget,
): void {
  const connectTarget = normalizeDeviceSyncConnectTargetKey(target.connectTarget);
  if (!connectTarget || targetsByKey.has(connectTarget)) {
    return;
  }

  const sourceProviderSlug = target.sourceProviderSlug
    ? normalizeDeviceSyncConnectTargetKey(target.sourceProviderSlug)
    : null;

  targetsByKey.set(connectTarget, {
    connectTarget,
    label: target.label,
    provider: target.provider,
    ...(sourceProviderSlug ? { sourceProviderSlug } : {}),
  });
}
