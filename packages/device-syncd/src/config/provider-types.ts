export type JunctionEnvironment = "sandbox" | "production";
export type JunctionRegion = "us" | "eu";

export interface JunctionDeviceSyncProviderConfig {
  apiKey: string;
  /**
   * Optional non-secret isolation namespace for deterministic Junction users.
   * Production and ordinary development omit it to preserve the established
   * `murph_` identity shape.
   */
  clientUserIdNamespace?: string;
  clientUserIdSecret: string;
  environment: JunctionEnvironment;
  region: JunctionRegion;
  /**
   * Overrides the environment/region-derived Junction API base URL. Local
   * harnesses point this at a faked Junction; production leaves it unset.
   */
  apiBaseUrl?: string;
  allowedLinkHosts?: readonly string[];
  providerFilter?: string[];
  summaryResources?: string[];
  timeseriesResources?: string[];
  summaryBackfillDays?: number;
  timeseriesBackfillDays?: number;
  reconcileDays?: number;
  reconcileIntervalMs?: number;
  /**
   * Activates automatic push-source recovery. Off by default because the
   * trigger endpoint is enabled per team by the vendor, so shipping the code
   * and switching it on are deliberately separate steps.
   */
  pushSourceRecoveryEnabled?: boolean;
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
    "fetchImpl" | "webhookSecret" | "apiKey" | "clientUserIdSecret" | "timeseriesResources"
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
