export type JunctionEnvironment = "sandbox" | "production";
export type JunctionRegion = "us" | "eu";

export interface JunctionDeviceSyncProviderConfig {
  apiKey: string;
  clientUserIdSecret: string;
  environment: JunctionEnvironment;
  region: JunctionRegion;
  allowedLinkHosts?: readonly string[];
  providerFilter?: string[];
  summaryResources?: string[];
  timeseriesResources?: string[];
  summaryBackfillDays?: number;
  timeseriesBackfillDays?: number;
  reconcileDays?: number;
  reconcileIntervalMs?: number;
  requestTimeoutMs?: number;
  webhookSecret?: string;
  webhookTimestampToleranceMs?: number;
  fetchImpl?: typeof fetch;
}

export interface OuraDeviceSyncProviderConfig {
  clientId: string;
  clientSecret: string;
  authBaseUrl?: string;
  apiBaseUrl?: string;
  scopes?: string[];
  backfillDays?: number;
  reconcileDays?: number;
  reconcileIntervalMs?: number;
  requestTimeoutMs?: number;
  webhookTimestampToleranceMs?: number;
  webhookVerificationToken?: string;
  fetchImpl?: typeof fetch;
}

export interface WhoopDeviceSyncProviderConfig {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  scopes?: string[];
  backfillDays?: number;
  reconcileDays?: number;
  reconcileIntervalMs?: number;
  webhookTimestampToleranceMs?: number;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface StravaDeviceSyncProviderConfig {
  clientId: string;
  clientSecret: string;
  authBaseUrl?: string;
  apiBaseUrl?: string;
  scopes?: string[];
  backfillDays?: number;
  reconcileDays?: number;
  reconcileIntervalMs?: number;
  requestTimeoutMs?: number;
  webhookSigningSecret?: string;
  webhookTimestampToleranceMs?: number;
  webhookVerifyToken?: string;
  fetchImpl?: typeof fetch;
}

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
  strava: Omit<
    StravaDeviceSyncProviderConfig,
    "fetchImpl" | "webhookSigningSecret" | "webhookVerifyToken"
  >;
}

export type SerializableConfiguredDeviceSyncProviderConfigs =
  Partial<SerializableConfiguredDeviceSyncProviderConfigByKey>;
