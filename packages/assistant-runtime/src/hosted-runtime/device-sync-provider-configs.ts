import {
  cloneSerializableConfiguredDeviceSyncProviderConfigs,
  configuredDeviceSyncProviderKeys,
  readConfiguredJunctionDeviceSyncProviderConfig,
} from "@murphai/device-syncd/config";
import type {
  ConfiguredDeviceSyncProviderConfigs,
  SerializableConfiguredDeviceSyncProviderConfigs,
} from "@murphai/device-syncd/config";
import type { HostedAssistantRuntimeDeviceSyncConfig } from "./models.ts";

const HOSTED_RUNTIME_JUNCTION_PLATFORM_ENV_KEYS = [
  "JUNCTION_API_KEY",
  "JUNCTION_CLIENT_USER_ID_SECRET",
  "JUNCTION_ENV",
  "JUNCTION_REGION",
] as const;

export function resolveHostedRuntimeDeviceSyncProviderConfigs(
  providerConfigs: HostedAssistantRuntimeDeviceSyncConfig["providerConfigs"],
  memberProviderConfigs: SerializableConfiguredDeviceSyncProviderConfigs,
  platformEnv: Readonly<Record<string, string>>,
): ConfiguredDeviceSyncProviderConfigs {
  const runtimeProviderConfigs: ConfiguredDeviceSyncProviderConfigs = {};

  if (providerConfigs.junction && hasHostedRuntimeJunctionPlatformEnv(platformEnv)) {
    const junction = readConfiguredJunctionDeviceSyncProviderConfig(platformEnv);

    if (junction) {
      // Hosted config owns no explicit resource list; preserve that omission so
      // provider normalization applies the contracts-owned curated defaults.
      delete junction.timeseriesResources;
      runtimeProviderConfigs.junction = junction;
    }
  }

  if (providerConfigs.oura) {
    runtimeProviderConfigs.oura = providerConfigs.oura;
  }

  if (providerConfigs.whoop) {
    runtimeProviderConfigs.whoop = providerConfigs.whoop;
  }

  if (providerConfigs.strava) {
    runtimeProviderConfigs.strava = providerConfigs.strava;
  }

  for (const provider of configuredDeviceSyncProviderKeys) {
    const memberConfig = memberProviderConfigs[provider];
    if (!memberConfig) {
      continue;
    }
    const runtimeConfig = runtimeProviderConfigs[provider];
    const serializableRuntimeConfig = runtimeConfig
      ? cloneSerializableConfiguredDeviceSyncProviderConfigs({
          [provider]: runtimeConfig,
        })[provider]
      : undefined;
    runtimeProviderConfigs[provider] = {
      ...(serializableRuntimeConfig ?? {}),
      ...memberConfig,
    } as never;
  }

  return runtimeProviderConfigs;
}

export function hasHostedRuntimeJunctionPlatformEnv(
  platformEnv: Readonly<Record<string, string>>,
): boolean {
  return HOSTED_RUNTIME_JUNCTION_PLATFORM_ENV_KEYS.some((key) => Boolean(platformEnv[key]));
}
