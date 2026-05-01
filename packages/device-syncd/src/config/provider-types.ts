import type { JunctionDeviceSyncProviderConfig } from "../providers/junction.ts";
import type { OuraDeviceSyncProviderConfig } from "../providers/oura.ts";
import type { StravaDeviceSyncProviderConfig } from "../providers/strava.ts";
import type { WhoopDeviceSyncProviderConfig } from "../providers/whoop.ts";

export interface ConfiguredDeviceSyncProviderConfigByKey {
  junction: JunctionDeviceSyncProviderConfig;
  oura: OuraDeviceSyncProviderConfig;
  whoop: WhoopDeviceSyncProviderConfig;
  strava: StravaDeviceSyncProviderConfig;
}

export type ConfiguredDeviceSyncProviderKey = keyof ConfiguredDeviceSyncProviderConfigByKey;
export type ConfiguredDeviceSyncProviderConfigs = Partial<ConfiguredDeviceSyncProviderConfigByKey>;
export type ConfiguredDeviceSyncProviderPresence =
  Partial<Record<ConfiguredDeviceSyncProviderKey, unknown>>;

export type DeviceSyncEnvSource = Readonly<Record<string, string | undefined>>;

export interface SerializableConfiguredDeviceSyncProviderConfigByKey {
  junction: Omit<
    JunctionDeviceSyncProviderConfig,
    "fetchImpl" | "webhookSecret" | "apiKey" | "clientUserIdSecret"
  >;
  oura: Omit<OuraDeviceSyncProviderConfig, "fetchImpl" | "webhookVerificationToken">;
  whoop: Omit<WhoopDeviceSyncProviderConfig, "fetchImpl">;
  strava: Omit<StravaDeviceSyncProviderConfig, "fetchImpl" | "webhookVerifyToken">;
}

export type SerializableConfiguredDeviceSyncProviderConfigs =
  Partial<SerializableConfiguredDeviceSyncProviderConfigByKey>;
