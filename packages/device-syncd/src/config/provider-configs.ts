import {
  configuredDeviceSyncProviderKeys,
  getConfiguredDeviceSyncProviderManifest,
  listConfiguredDeviceSyncProviderNames,
} from "./provider-manifests.ts";
import {
  optionalEnv,
  parseCsvEnv,
  parseIntegerEnv,
  parsePortEnv,
  requireEnv,
} from "./provider-config-helpers.ts";

import type {
  ConfiguredDeviceSyncProviderConfigByKey,
  ConfiguredDeviceSyncProviderConfigs,
  ConfiguredDeviceSyncProviderKey,
  ConfiguredDeviceSyncProviderPresence,
  DeviceSyncEnvSource,
} from "./provider-types.ts";
import type { GarminDeviceSyncProviderConfig } from "../providers/garmin.ts";
import type { JunctionDeviceSyncProviderConfig } from "../providers/junction.ts";
import type { OuraDeviceSyncProviderConfig } from "../providers/oura.ts";
import type { StravaDeviceSyncProviderConfig } from "../providers/strava.ts";
import type { WhoopDeviceSyncProviderConfig } from "../providers/whoop.ts";

export type {
  ConfiguredDeviceSyncProviderConfigByKey,
  ConfiguredDeviceSyncProviderConfigs,
  ConfiguredDeviceSyncProviderKey,
  ConfiguredDeviceSyncProviderPresence,
  DeviceSyncEnvSource,
} from "./provider-types.ts";

export { configuredDeviceSyncProviderKeys };

export function readConfiguredDeviceSyncProviderConfigs(
  env: DeviceSyncEnvSource,
): ConfiguredDeviceSyncProviderConfigs {
  const configs: ConfiguredDeviceSyncProviderConfigs = {};

  for (const provider of configuredDeviceSyncProviderKeys) {
    const manifest = getConfiguredDeviceSyncProviderManifest(provider);
    const config = manifest.readConfig(env);

    if (config) {
      configs[provider] = config as never;
    }
  }

  return configs;
}

export function readConfiguredGarminDeviceSyncProviderConfig(
  env: DeviceSyncEnvSource,
): GarminDeviceSyncProviderConfig | null {
  return getConfiguredDeviceSyncProviderManifest("garmin").readConfig(env);
}

export function readConfiguredJunctionDeviceSyncProviderConfig(
  env: DeviceSyncEnvSource,
): JunctionDeviceSyncProviderConfig | null {
  return getConfiguredDeviceSyncProviderManifest("junction").readConfig(env);
}

export function readConfiguredWhoopDeviceSyncProviderConfig(
  env: DeviceSyncEnvSource,
): WhoopDeviceSyncProviderConfig | null {
  return getConfiguredDeviceSyncProviderManifest("whoop").readConfig(env);
}

export function readConfiguredOuraDeviceSyncProviderConfig(
  env: DeviceSyncEnvSource,
): OuraDeviceSyncProviderConfig | null {
  return getConfiguredDeviceSyncProviderManifest("oura").readConfig(env);
}

export function readConfiguredStravaDeviceSyncProviderConfig(
  env: DeviceSyncEnvSource,
): StravaDeviceSyncProviderConfig | null {
  return getConfiguredDeviceSyncProviderManifest("strava").readConfig(env);
}

export function hasConfiguredDeviceSyncProviderConfigs(
  configs: ConfiguredDeviceSyncProviderPresence,
): boolean {
  return listConfiguredDeviceSyncProviderNames(configs).length > 0;
}

export { listConfiguredDeviceSyncProviderNames };

export {
  optionalEnv,
  parseCsvEnv,
  parseIntegerEnv,
  parsePortEnv,
  requireEnv,
} from "./provider-config-helpers.ts";
