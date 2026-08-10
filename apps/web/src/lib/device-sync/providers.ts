import {
  cloneSerializableConfiguredDeviceSyncProviderConfigs,
  configuredDeviceSyncProviderKeys,
  createConfiguredDeviceSyncRegistry,
  createConfiguredDeviceSyncRegistryFromConfigs,
  readConfiguredDeviceSyncProviderConfigs,
  type ConfiguredDeviceSyncProviderConfigs,
  type SerializableConfiguredDeviceSyncProviderConfigs,
} from "@murphai/device-syncd/config";
import type { DeviceSyncEnvSource } from "@murphai/device-syncd/provider-configs";
import { deviceSyncError } from "@murphai/device-syncd/errors";
import type {
  DeviceSyncProvider,
  DeviceSyncRegistry,
} from "@murphai/device-syncd/types";

export function createHostedDeviceSyncRegistry(
  env: NodeJS.ProcessEnv = process.env,
): DeviceSyncRegistry {
  return createConfiguredDeviceSyncRegistry(env);
}

/**
 * Builds one operation-scoped registry. Member-owned client credentials replace
 * only their provider's serializable fields. Code-owned runtime defaults remain
 * intact, while operator-only webhook secrets and test fetch functions are
 * deliberately removed from the member-scoped provider instance.
 */
export function createHostedDeviceSyncRegistryWithProviderConfigs(input: {
  env?: DeviceSyncEnvSource;
  providerConfigs: SerializableConfiguredDeviceSyncProviderConfigs;
}): DeviceSyncRegistry {
  return createConfiguredDeviceSyncRegistryFromConfigs(
    mergeHostedDeviceSyncProviderConfigs({
      base: readConfiguredDeviceSyncProviderConfigs(
        input.env ?? process.env,
      ),
      overlay: input.providerConfigs,
    }),
  );
}

export function mergeHostedDeviceSyncProviderConfigs(input: {
  base: ConfiguredDeviceSyncProviderConfigs;
  overlay: SerializableConfiguredDeviceSyncProviderConfigs;
}): ConfiguredDeviceSyncProviderConfigs {
  const merged: ConfiguredDeviceSyncProviderConfigs = { ...input.base };

  for (const provider of configuredDeviceSyncProviderKeys) {
    const overlay = input.overlay[provider];
    if (!overlay) {
      continue;
    }
    const base = input.base[provider];
    const serializableBase = base
      ? cloneSerializableConfiguredDeviceSyncProviderConfigs({
          [provider]: base,
        })[provider]
      : undefined;
    merged[provider] = {
      ...(serializableBase ?? {}),
      ...overlay,
    } as never;
  }

  return merged;
}

export function requireHostedDeviceSyncProvider(
  registry: DeviceSyncRegistry,
  provider: string,
): DeviceSyncProvider {
  const resolved = registry.get(provider);

  if (!resolved) {
    throw deviceSyncError({
      code: "PROVIDER_NOT_CONFIGURED",
      message: `Hosted device-sync provider ${provider} is not configured in the shared device-sync provider registry.`,
      retryable: false,
      httpStatus: 404,
    });
  }

  return resolved;
}
