import {
  configuredDeviceSyncProviderKeys,
  listConfiguredDeviceSyncProviderNames,
} from "./provider-configs.ts";

import type {
  ConfiguredDeviceSyncProviderConfigByKey,
  ConfiguredDeviceSyncProviderConfigs,
  ConfiguredDeviceSyncProviderKey,
} from "./provider-configs.ts";
import type { GarminDeviceSyncProviderConfig } from "../providers/garmin.ts";
import type { OuraDeviceSyncProviderConfig } from "../providers/oura.ts";
import type { StravaDeviceSyncProviderConfig } from "../providers/strava.ts";
import type { WhoopDeviceSyncProviderConfig } from "../providers/whoop.ts";

export interface SerializableConfiguredDeviceSyncProviderConfigByKey {
  garmin: Omit<GarminDeviceSyncProviderConfig, "fetchImpl">;
  oura: Omit<OuraDeviceSyncProviderConfig, "fetchImpl" | "webhookVerificationToken">;
  whoop: Omit<WhoopDeviceSyncProviderConfig, "fetchImpl">;
  strava: Omit<StravaDeviceSyncProviderConfig, "fetchImpl" | "webhookVerifyToken">;
}

export type SerializableConfiguredDeviceSyncProviderConfigs =
  Partial<SerializableConfiguredDeviceSyncProviderConfigByKey>;

const GARMIN_SERIALIZABLE_PROVIDER_CONFIG_KEYS = [
  "apiBaseUrl",
  "authBaseUrl",
  "backfillDays",
  "clientId",
  "clientSecret",
  "reconcileDays",
  "reconcileIntervalMs",
  "requestTimeoutMs",
  "tokenBaseUrl",
] as const satisfies readonly (keyof GarminDeviceSyncProviderConfig)[];

const OURA_SERIALIZABLE_PROVIDER_CONFIG_KEYS = [
  "apiBaseUrl",
  "authBaseUrl",
  "backfillDays",
  "clientId",
  "clientSecret",
  "reconcileDays",
  "reconcileIntervalMs",
  "requestTimeoutMs",
  "scopes",
  "webhookTimestampToleranceMs",
] as const satisfies readonly (keyof OuraDeviceSyncProviderConfig)[];

const STRAVA_SERIALIZABLE_PROVIDER_CONFIG_KEYS = [
  "apiBaseUrl",
  "authBaseUrl",
  "backfillDays",
  "clientId",
  "clientSecret",
  "reconcileDays",
  "reconcileIntervalMs",
  "requestTimeoutMs",
  "scopes",
] as const satisfies readonly (keyof StravaDeviceSyncProviderConfig)[];

const WHOOP_SERIALIZABLE_PROVIDER_CONFIG_KEYS = [
  "backfillDays",
  "baseUrl",
  "clientId",
  "clientSecret",
  "reconcileDays",
  "reconcileIntervalMs",
  "requestTimeoutMs",
  "scopes",
  "webhookTimestampToleranceMs",
] as const satisfies readonly (keyof WhoopDeviceSyncProviderConfig)[];

// Hosted runner envelopes keep only the serializable runtime subset of provider config.
// Provider-owned admin secrets such as webhook verification tokens stay on the control plane.
export function cloneSerializableConfiguredDeviceSyncProviderConfigs(
  configs: ConfiguredDeviceSyncProviderConfigs,
): SerializableConfiguredDeviceSyncProviderConfigs {
  const cloned: SerializableConfiguredDeviceSyncProviderConfigs = {};

  for (const provider of listConfiguredDeviceSyncProviderNames(configs)) {
    const config = configs[provider];

    if (!config) {
      continue;
    }

    cloned[provider] = cloneSerializableConfiguredDeviceSyncProviderConfig(provider, config) as never;
  }

  return cloned;
}

export function parseSerializableConfiguredDeviceSyncProviderConfigs(
  value: unknown,
  label: string,
): SerializableConfiguredDeviceSyncProviderConfigs {
  const record = requireSerializableConfiguredDeviceSyncProviderConfigsRecord(value, label);
  const configs: SerializableConfiguredDeviceSyncProviderConfigs = {};

  for (const provider of configuredDeviceSyncProviderKeys) {
    const providerValue = record[provider];

    if (providerValue === undefined) {
      continue;
    }

    configs[provider] = parseSerializableConfiguredDeviceSyncProviderConfig(
      provider,
      providerValue,
      `${label}.${provider}`,
    ) as never;
  }

  return configs;
}

export function requireSerializableConfigObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

export function requireSerializableString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function cloneSerializableConfiguredDeviceSyncProviderConfig(
  provider: ConfiguredDeviceSyncProviderKey,
  config: ConfiguredDeviceSyncProviderConfigByKey[ConfiguredDeviceSyncProviderKey],
): ConfiguredDeviceSyncProviderConfigByKey[ConfiguredDeviceSyncProviderKey] {
  switch (provider) {
    case "garmin":
      return cloneGarminDeviceSyncProviderConfig(config as GarminDeviceSyncProviderConfig);
    case "oura":
      return cloneOuraDeviceSyncProviderConfig(config as OuraDeviceSyncProviderConfig);
    case "whoop":
      return cloneWhoopDeviceSyncProviderConfig(config as WhoopDeviceSyncProviderConfig);
    case "strava":
      return cloneStravaDeviceSyncProviderConfig(config as StravaDeviceSyncProviderConfig);
  }
}

function parseSerializableConfiguredDeviceSyncProviderConfig(
  provider: ConfiguredDeviceSyncProviderKey,
  value: unknown,
  label: string,
): ConfiguredDeviceSyncProviderConfigByKey[ConfiguredDeviceSyncProviderKey] {
  switch (provider) {
    case "garmin":
      return parseSerializableGarminDeviceSyncProviderConfig(value, label);
    case "oura":
      return parseSerializableOuraDeviceSyncProviderConfig(value, label);
    case "whoop":
      return parseSerializableWhoopDeviceSyncProviderConfig(value, label);
    case "strava":
      return parseSerializableStravaDeviceSyncProviderConfig(value, label);
  }
}

function cloneGarminDeviceSyncProviderConfig(
  config: GarminDeviceSyncProviderConfig,
): SerializableConfiguredDeviceSyncProviderConfigByKey["garmin"] {
  return cloneSerializableProviderConfig(config, GARMIN_SERIALIZABLE_PROVIDER_CONFIG_KEYS);
}

function cloneOuraDeviceSyncProviderConfig(
  config: OuraDeviceSyncProviderConfig,
): SerializableConfiguredDeviceSyncProviderConfigByKey["oura"] {
  return cloneSerializableProviderConfig(config, OURA_SERIALIZABLE_PROVIDER_CONFIG_KEYS);
}

function cloneStravaDeviceSyncProviderConfig(
  config: StravaDeviceSyncProviderConfig,
): SerializableConfiguredDeviceSyncProviderConfigByKey["strava"] {
  return cloneSerializableProviderConfig(config, STRAVA_SERIALIZABLE_PROVIDER_CONFIG_KEYS);
}

function cloneWhoopDeviceSyncProviderConfig(
  config: WhoopDeviceSyncProviderConfig,
): SerializableConfiguredDeviceSyncProviderConfigByKey["whoop"] {
  return cloneSerializableProviderConfig(config, WHOOP_SERIALIZABLE_PROVIDER_CONFIG_KEYS);
}

function parseSerializableGarminDeviceSyncProviderConfig(
  value: unknown,
  label: string,
): SerializableConfiguredDeviceSyncProviderConfigByKey["garmin"] {
  const record = requireSerializableProviderConfigRecord(
    value,
    label,
    [
      "apiBaseUrl",
      "authBaseUrl",
      "backfillDays",
      "clientId",
      "clientSecret",
      "reconcileDays",
      "reconcileIntervalMs",
      "requestTimeoutMs",
      "tokenBaseUrl",
    ],
  );

  return {
    apiBaseUrl: parseSerializableOptionalString(record.apiBaseUrl, `${label}.apiBaseUrl`),
    authBaseUrl: parseSerializableOptionalString(record.authBaseUrl, `${label}.authBaseUrl`),
    backfillDays: parseSerializableOptionalNumber(record.backfillDays, `${label}.backfillDays`),
    clientId: requireSerializableString(record.clientId, `${label}.clientId`),
    clientSecret: requireSerializableString(record.clientSecret, `${label}.clientSecret`),
    reconcileDays: parseSerializableOptionalNumber(record.reconcileDays, `${label}.reconcileDays`),
    reconcileIntervalMs: parseSerializableOptionalNumber(
      record.reconcileIntervalMs,
      `${label}.reconcileIntervalMs`,
    ),
    requestTimeoutMs: parseSerializableOptionalNumber(record.requestTimeoutMs, `${label}.requestTimeoutMs`),
    tokenBaseUrl: parseSerializableOptionalString(record.tokenBaseUrl, `${label}.tokenBaseUrl`),
  };
}

function parseSerializableOuraDeviceSyncProviderConfig(
  value: unknown,
  label: string,
): SerializableConfiguredDeviceSyncProviderConfigByKey["oura"] {
  const record = requireSerializableProviderConfigRecord(
    value,
    label,
    [
      "apiBaseUrl",
      "authBaseUrl",
      "backfillDays",
      "clientId",
      "clientSecret",
      "reconcileDays",
      "reconcileIntervalMs",
      "requestTimeoutMs",
      "scopes",
      "webhookTimestampToleranceMs",
    ],
  );

  return {
    apiBaseUrl: parseSerializableOptionalString(record.apiBaseUrl, `${label}.apiBaseUrl`),
    authBaseUrl: parseSerializableOptionalString(record.authBaseUrl, `${label}.authBaseUrl`),
    backfillDays: parseSerializableOptionalNumber(record.backfillDays, `${label}.backfillDays`),
    clientId: requireSerializableString(record.clientId, `${label}.clientId`),
    clientSecret: requireSerializableString(record.clientSecret, `${label}.clientSecret`),
    reconcileDays: parseSerializableOptionalNumber(record.reconcileDays, `${label}.reconcileDays`),
    reconcileIntervalMs: parseSerializableOptionalNumber(
      record.reconcileIntervalMs,
      `${label}.reconcileIntervalMs`,
    ),
    requestTimeoutMs: parseSerializableOptionalNumber(record.requestTimeoutMs, `${label}.requestTimeoutMs`),
    scopes: parseSerializableOptionalStringArray(record.scopes, `${label}.scopes`),
    webhookTimestampToleranceMs: parseSerializableOptionalNumber(
      record.webhookTimestampToleranceMs,
      `${label}.webhookTimestampToleranceMs`,
    ),
  };
}

function parseSerializableStravaDeviceSyncProviderConfig(
  value: unknown,
  label: string,
): SerializableConfiguredDeviceSyncProviderConfigByKey["strava"] {
  const record = requireSerializableProviderConfigRecord(
    value,
    label,
    [
      "apiBaseUrl",
      "authBaseUrl",
      "backfillDays",
      "clientId",
      "clientSecret",
      "reconcileDays",
      "reconcileIntervalMs",
      "requestTimeoutMs",
      "scopes",
    ],
  );

  return {
    apiBaseUrl: parseSerializableOptionalString(record.apiBaseUrl, `${label}.apiBaseUrl`),
    authBaseUrl: parseSerializableOptionalString(record.authBaseUrl, `${label}.authBaseUrl`),
    backfillDays: parseSerializableOptionalNumber(record.backfillDays, `${label}.backfillDays`),
    clientId: requireSerializableString(record.clientId, `${label}.clientId`),
    clientSecret: requireSerializableString(record.clientSecret, `${label}.clientSecret`),
    reconcileDays: parseSerializableOptionalNumber(record.reconcileDays, `${label}.reconcileDays`),
    reconcileIntervalMs: parseSerializableOptionalNumber(
      record.reconcileIntervalMs,
      `${label}.reconcileIntervalMs`,
    ),
    requestTimeoutMs: parseSerializableOptionalNumber(record.requestTimeoutMs, `${label}.requestTimeoutMs`),
    scopes: parseSerializableOptionalStringArray(record.scopes, `${label}.scopes`),
  };
}

function parseSerializableWhoopDeviceSyncProviderConfig(
  value: unknown,
  label: string,
): SerializableConfiguredDeviceSyncProviderConfigByKey["whoop"] {
  const record = requireSerializableProviderConfigRecord(
    value,
    label,
    [
      "backfillDays",
      "baseUrl",
      "clientId",
      "clientSecret",
      "reconcileDays",
      "reconcileIntervalMs",
      "requestTimeoutMs",
      "scopes",
      "webhookTimestampToleranceMs",
    ],
  );

  return {
    backfillDays: parseSerializableOptionalNumber(record.backfillDays, `${label}.backfillDays`),
    baseUrl: parseSerializableOptionalString(record.baseUrl, `${label}.baseUrl`),
    clientId: requireSerializableString(record.clientId, `${label}.clientId`),
    clientSecret: requireSerializableString(record.clientSecret, `${label}.clientSecret`),
    reconcileDays: parseSerializableOptionalNumber(record.reconcileDays, `${label}.reconcileDays`),
    reconcileIntervalMs: parseSerializableOptionalNumber(
      record.reconcileIntervalMs,
      `${label}.reconcileIntervalMs`,
    ),
    requestTimeoutMs: parseSerializableOptionalNumber(record.requestTimeoutMs, `${label}.requestTimeoutMs`),
    scopes: parseSerializableOptionalStringArray(record.scopes, `${label}.scopes`),
    webhookTimestampToleranceMs: parseSerializableOptionalNumber(
      record.webhookTimestampToleranceMs,
      `${label}.webhookTimestampToleranceMs`,
    ),
  };
}

function requireSerializableConfiguredDeviceSyncProviderConfigsRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  const record = requireSerializableConfigObject(value, label);
  const supportedProviders = new Set<string>(configuredDeviceSyncProviderKeys);

  for (const key of Object.keys(record)) {
    if (!supportedProviders.has(key)) {
      throw new TypeError(`${label}.${key} is not a supported device-sync provider config.`);
    }
  }

  return record;
}

function requireSerializableProviderConfigRecord(
  value: unknown,
  label: string,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  const record = requireSerializableConfigObject(value, label);
  const supportedKeys = new Set(allowedKeys);

  if (record.fetchImpl !== undefined) {
    throw new TypeError(`${label}.fetchImpl is not supported in serialized runtime config.`);
  }

  if (record.webhookVerificationToken !== undefined) {
    throw new TypeError(
      `${label}.webhookVerificationToken is a provider-owned admin secret and is not supported in serialized runtime config.`,
    );
  }

  if (record.webhookVerifyToken !== undefined) {
    throw new TypeError(
      `${label}.webhookVerifyToken is a provider-owned admin secret and is not supported in serialized runtime config.`,
    );
  }

  for (const key of Object.keys(record)) {
    if (!supportedKeys.has(key)) {
      throw new TypeError(`${label}.${key} is not a supported serialized provider config field.`);
    }
  }

  return record;
}

function cloneSerializableProviderConfig<
  TConfig extends object,
  const TKeys extends readonly (keyof TConfig)[],
>(
  config: TConfig,
  keys: TKeys,
): Pick<TConfig, TKeys[number]> {
  const cloned = {} as Pick<TConfig, TKeys[number]>;

  for (const key of keys) {
    const value = config[key];

    if (value === undefined) {
      continue;
    }

    cloned[key] = (Array.isArray(value) ? [...value] : value) as Pick<TConfig, TKeys[number]>[typeof key];
  }

  return cloned;
}

function parseSerializableOptionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requireSerializableString(value, label);
}

function parseSerializableOptionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }

  return value;
}

function parseSerializableOptionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array of strings.`);
  }

  return value.map((entry, index) => requireSerializableString(entry, `${label}[${index}]`));
}
