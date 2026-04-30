import { createDeviceSyncRegistry } from "../registry.ts";

import {
  configuredDeviceSyncProviderKeys,
  getConfiguredDeviceSyncProviderManifest,
} from "./provider-manifests.ts";
import { readConfiguredDeviceSyncProviderConfigs } from "./provider-configs.ts";

import type {
  ConfiguredDeviceSyncProviderConfigByKey,
  ConfiguredDeviceSyncProviderConfigs,
  ConfiguredDeviceSyncProviderKey,
  DeviceSyncEnvSource,
} from "./provider-types.ts";
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

  for (const provider of configuredDeviceSyncProviderKeys) {
    const config = configs[provider];

    if (config === undefined) {
      continue;
    }

    providers.push(createConfiguredDeviceSyncProviderFromConfig(provider, config as never));
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

function createConfiguredDeviceSyncProviderFromConfig<
  TProvider extends ConfiguredDeviceSyncProviderKey,
>(
  provider: TProvider,
  config: ConfiguredDeviceSyncProviderConfigByKey[TProvider],
): DeviceSyncProvider {
  switch (provider) {
    case "garmin":
      return getConfiguredDeviceSyncProviderManifest("garmin").createProvider(
        config as ConfiguredDeviceSyncProviderConfigByKey["garmin"],
      );
    case "junction":
      return getConfiguredDeviceSyncProviderManifest("junction").createProvider(
        config as ConfiguredDeviceSyncProviderConfigByKey["junction"],
      );
    case "oura":
      return getConfiguredDeviceSyncProviderManifest("oura").createProvider(
        config as ConfiguredDeviceSyncProviderConfigByKey["oura"],
      );
    case "whoop":
      return getConfiguredDeviceSyncProviderManifest("whoop").createProvider(
        config as ConfiguredDeviceSyncProviderConfigByKey["whoop"],
      );
    case "strava":
      return getConfiguredDeviceSyncProviderManifest("strava").createProvider(
        config as ConfiguredDeviceSyncProviderConfigByKey["strava"],
      );
  }
}

export { configuredDeviceSyncProviderKeys };
