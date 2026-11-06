import { createDeviceSyncRegistry } from "../registry.ts";
import {
  configuredDeviceSyncProviderKeys,
} from "./provider-manifests.ts";
import { readConfiguredDeviceSyncProviderConfigs } from "./provider-configs.ts";
import { createJunctionDeviceSyncProvider } from "../providers/junction.ts";

import type {
  ConfiguredDeviceSyncProviderConfigs,
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
  return configs.junction === undefined
    ? []
    : [createJunctionDeviceSyncProvider(configs.junction)];
}

export function createConfiguredDeviceSyncRegistryFromConfigs(
  configs: ConfiguredDeviceSyncProviderConfigs,
): DeviceSyncRegistry {
  return createDeviceSyncRegistry(
    createConfiguredDeviceSyncProvidersFromConfigs(configs),
  );
}

export { configuredDeviceSyncProviderKeys };
