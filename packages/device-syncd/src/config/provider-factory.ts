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

function createConfiguredDeviceSyncProviderFromConfig<
  TProvider extends ConfiguredDeviceSyncProviderKey,
>(
  provider: TProvider,
  config: ConfiguredDeviceSyncProviderConfigByKey[TProvider],
): DeviceSyncProvider {
  return getConfiguredDeviceSyncProviderManifest(provider).createProvider(config);
}

export { configuredDeviceSyncProviderKeys };
