import { createDeviceSyncRegistry } from "../registry.ts";
import {
  configuredDeviceSyncProviderKeys,
} from "./provider-manifests.ts";
import { readConfiguredDeviceSyncProviderConfigs } from "./provider-configs.ts";
import { createJunctionDeviceSyncProvider } from "../providers/junction.ts";
import { createOuraDeviceSyncProvider } from "../providers/oura.ts";
import { createStravaDeviceSyncProvider } from "../providers/strava.ts";
import { createWhoopDeviceSyncProvider } from "../providers/whoop.ts";

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
    case "junction":
      return createJunctionDeviceSyncProvider(
        config as ConfiguredDeviceSyncProviderConfigByKey["junction"],
      );
    case "oura":
      return createOuraDeviceSyncProvider(
        config as ConfiguredDeviceSyncProviderConfigByKey["oura"],
      );
    case "whoop":
      return createWhoopDeviceSyncProvider(
        config as ConfiguredDeviceSyncProviderConfigByKey["whoop"],
      );
    case "strava":
      return createStravaDeviceSyncProvider(
        config as ConfiguredDeviceSyncProviderConfigByKey["strava"],
      );
  }
}

export { configuredDeviceSyncProviderKeys };
