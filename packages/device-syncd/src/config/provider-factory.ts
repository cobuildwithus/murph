import { createGarminDeviceSyncProvider } from "../providers/garmin.ts";
import { createOuraDeviceSyncProvider } from "../providers/oura.ts";
import { createStravaDeviceSyncProvider } from "../providers/strava.ts";
import { createWhoopDeviceSyncProvider } from "../providers/whoop.ts";
import { createDeviceSyncRegistry } from "../registry.ts";

import {
  configuredDeviceSyncProviderKeys,
  listConfiguredDeviceSyncProviderNames,
  readConfiguredDeviceSyncProviderConfigs,
} from "./provider-configs.ts";

import type {
  ConfiguredDeviceSyncProviderConfigByKey,
  ConfiguredDeviceSyncProviderConfigs,
  ConfiguredDeviceSyncProviderKey,
  DeviceSyncEnvSource,
} from "./provider-configs.ts";
import type { DeviceSyncProvider, DeviceSyncRegistry } from "../types.ts";

export function createConfiguredDeviceSyncProviders(env: DeviceSyncEnvSource): DeviceSyncProvider[] {
  return createConfiguredDeviceSyncProvidersFromConfigs(
    readConfiguredDeviceSyncProviderConfigs(env),
  );
}

export function createConfiguredDeviceSyncRegistry(
  env: DeviceSyncEnvSource,
): DeviceSyncRegistry {
  return createConfiguredDeviceSyncRegistryFromConfigs(
    readConfiguredDeviceSyncProviderConfigs(env),
  );
}

export function createConfiguredDeviceSyncProvidersFromConfigs(
  configs: ConfiguredDeviceSyncProviderConfigs,
): DeviceSyncProvider[] {
  const providers: DeviceSyncProvider[] = [];

  for (const provider of listConfiguredDeviceSyncProviderNames(configs)) {
    const config = configs[provider];

    if (!config) {
      continue;
    }

    providers.push(createConfiguredDeviceSyncProviderFromConfig(provider, config));
  }

  return providers;
}

export function createConfiguredDeviceSyncRegistryFromConfigs(
  configs: ConfiguredDeviceSyncProviderConfigs,
): DeviceSyncRegistry {
  return createDeviceSyncRegistry(
    createConfiguredDeviceSyncProvidersFromConfigs(configs),
  );
}

function createConfiguredDeviceSyncProviderFromConfig(
  provider: ConfiguredDeviceSyncProviderKey,
  config: ConfiguredDeviceSyncProviderConfigByKey[ConfiguredDeviceSyncProviderKey],
): DeviceSyncProvider {
  switch (provider) {
    case "garmin":
      return createGarminDeviceSyncProvider(config as ConfiguredDeviceSyncProviderConfigByKey["garmin"]);
    case "oura":
      return createOuraDeviceSyncProvider(config as ConfiguredDeviceSyncProviderConfigByKey["oura"]);
    case "whoop":
      return createWhoopDeviceSyncProvider(config as ConfiguredDeviceSyncProviderConfigByKey["whoop"]);
    case "strava":
      return createStravaDeviceSyncProvider(config as ConfiguredDeviceSyncProviderConfigByKey["strava"]);
  }
}

export { configuredDeviceSyncProviderKeys };
