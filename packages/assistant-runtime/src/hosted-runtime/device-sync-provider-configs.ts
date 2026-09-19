import {
  readConfiguredJunctionDeviceSyncProviderConfig,
} from "@murphai/device-syncd/config";
import type {
  ConfiguredDeviceSyncProviderConfigs,
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
  platformEnv: Readonly<Record<string, string>>,
): ConfiguredDeviceSyncProviderConfigs {
  const runtimeProviderConfigs: ConfiguredDeviceSyncProviderConfigs = {};

  if (providerConfigs.junction && hasHostedRuntimeJunctionPlatformEnv(platformEnv)) {
    const junction = readConfiguredJunctionDeviceSyncProviderConfig(platformEnv);

    if (junction) {
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

  return runtimeProviderConfigs;
}

export function hasHostedRuntimeJunctionPlatformEnv(
  platformEnv: Readonly<Record<string, string>>,
): boolean {
  return HOSTED_RUNTIME_JUNCTION_PLATFORM_ENV_KEYS.some((key) => Boolean(platformEnv[key]));
}
