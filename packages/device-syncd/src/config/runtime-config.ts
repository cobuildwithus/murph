import {
  JUNCTION_API_KEY_ENV_KEYS,
  JUNCTION_CLIENT_USER_ID_SECRET_ENV_KEYS,
  JUNCTION_ENV_ENV_KEYS,
  JUNCTION_PROVIDER_FILTER_ENV_KEYS,
  JUNCTION_RECONCILE_DAYS_ENV_KEYS,
  JUNCTION_RECONCILE_INTERVAL_MS_ENV_KEYS,
  JUNCTION_REGION_ENV_KEYS,
  JUNCTION_REQUEST_TIMEOUT_MS_ENV_KEYS,
  JUNCTION_SUMMARY_BACKFILL_DAYS_ENV_KEYS,
  JUNCTION_SUMMARY_RESOURCES_ENV_KEYS,
  JUNCTION_TIMESERIES_BACKFILL_DAYS_ENV_KEYS,
  JUNCTION_TIMESERIES_RESOURCES_ENV_KEYS,
  JUNCTION_WEBHOOK_SECRET_ENV_KEYS,
  JUNCTION_WEBHOOK_TIMESTAMP_TOLERANCE_MS_ENV_KEYS,
  OURA_API_BASE_URL_ENV_KEYS,
  OURA_AUTH_BASE_URL_ENV_KEYS,
  OURA_BACKFILL_DAYS_ENV_KEYS,
  OURA_CLIENT_ID_ENV_KEYS,
  OURA_CLIENT_SECRET_ENV_KEYS,
  OURA_RECONCILE_DAYS_ENV_KEYS,
  OURA_RECONCILE_INTERVAL_MS_ENV_KEYS,
  OURA_REQUEST_TIMEOUT_MS_ENV_KEYS,
  OURA_SCOPES_ENV_KEYS,
  OURA_WEBHOOK_TIMESTAMP_TOLERANCE_MS_ENV_KEYS,
  STRAVA_API_BASE_URL_ENV_KEYS,
  STRAVA_AUTH_BASE_URL_ENV_KEYS,
  STRAVA_BACKFILL_DAYS_ENV_KEYS,
  STRAVA_CLIENT_ID_ENV_KEYS,
  STRAVA_CLIENT_SECRET_ENV_KEYS,
  STRAVA_RECONCILE_DAYS_ENV_KEYS,
  STRAVA_RECONCILE_INTERVAL_MS_ENV_KEYS,
  STRAVA_REQUEST_TIMEOUT_MS_ENV_KEYS,
  STRAVA_SCOPES_ENV_KEYS,
  STRAVA_WEBHOOK_TIMESTAMP_TOLERANCE_MS_ENV_KEYS,
  WHOOP_BACKFILL_DAYS_ENV_KEYS,
  WHOOP_BASE_URL_ENV_KEYS,
  WHOOP_CLIENT_ID_ENV_KEYS,
  WHOOP_CLIENT_SECRET_ENV_KEYS,
  WHOOP_RECONCILE_DAYS_ENV_KEYS,
  WHOOP_RECONCILE_INTERVAL_MS_ENV_KEYS,
  WHOOP_REQUEST_TIMEOUT_MS_ENV_KEYS,
  WHOOP_SCOPES_ENV_KEYS,
  WHOOP_WEBHOOK_TIMESTAMP_TOLERANCE_MS_ENV_KEYS,
} from "./provider-env.ts";
import {
  optionalEnv,
  parseCsvEnv,
  parseIntegerEnv,
  readOptionalCredentialPair,
} from "./provider-config-helpers.ts";

import type {
  ConfiguredDeviceSyncProviderKey,
  DeviceSyncEnvSource,
  SerializableConfiguredDeviceSyncProviderConfigByKey,
  SerializableConfiguredDeviceSyncProviderConfigs,
} from "./provider-types.ts";

export interface ConfiguredDeviceSyncRuntimeConfig {
  providerConfigs: SerializableConfiguredDeviceSyncProviderConfigs;
  publicBaseUrl: string;
  secret: string;
}

const DEVICE_SYNC_RUNTIME_CONFIG_KEYS = [
  "providerConfigs",
  "publicBaseUrl",
  "secret",
] as const;
const DEVICE_SYNC_PUBLIC_BASE_URL_ENV_KEYS = [
  "DEVICE_SYNC_PUBLIC_BASE_URL",
] as const;
const DEVICE_SYNC_SECRET_ENV_KEYS = [
  "DEVICE_SYNC_SECRET",
] as const;
const SERIALIZABLE_PROVIDER_KEYS = [
  "junction",
  "oura",
  "whoop",
  "strava",
] as const satisfies readonly ConfiguredDeviceSyncProviderKey[];
const SERIALIZABLE_PROVIDER_FIELDS = {
  junction: {
    allowedLinkHosts: "string[]",
    environment: "string",
    providerFilter: "string[]",
    reconcileDays: "number",
    reconcileIntervalMs: "number",
    region: "string",
    requestTimeoutMs: "number",
    summaryBackfillDays: "number",
    summaryResources: "string[]",
    timeseriesBackfillDays: "number",
    timeseriesResources: "string[]",
    webhookTimestampToleranceMs: "number",
  },
  oura: {
    apiBaseUrl: "string",
    authBaseUrl: "string",
    backfillDays: "number",
    clientId: "string",
    clientSecret: "string",
    reconcileDays: "number",
    reconcileIntervalMs: "number",
    requestTimeoutMs: "number",
    scopes: "string[]",
    webhookTimestampToleranceMs: "number",
  },
  whoop: {
    backfillDays: "number",
    baseUrl: "string",
    clientId: "string",
    clientSecret: "string",
    reconcileDays: "number",
    reconcileIntervalMs: "number",
    requestTimeoutMs: "number",
    scopes: "string[]",
    webhookTimestampToleranceMs: "number",
  },
  strava: {
    apiBaseUrl: "string",
    authBaseUrl: "string",
    backfillDays: "number",
    clientId: "string",
    clientSecret: "string",
    reconcileDays: "number",
    reconcileIntervalMs: "number",
    requestTimeoutMs: "number",
    scopes: "string[]",
    webhookTimestampToleranceMs: "number",
  },
} as const;
const SERIALIZABLE_PROVIDER_DISALLOWED_FIELDS = {
  junction: {
    apiKey:
      "is a provider-owned API secret and is not supported in serialized runtime config.",
    clientUserIdSecret:
      "is a provider-owned HMAC secret and is not supported in serialized runtime config.",
    fetchImpl: "is not supported in serialized runtime config.",
    webhookSecret:
      "is a provider-owned webhook secret and is not supported in serialized runtime config.",
  },
  oura: {
    fetchImpl: "is not supported in serialized runtime config.",
    webhookVerificationToken:
      "is a provider-owned admin secret and is not supported in serialized runtime config.",
  },
  whoop: {
    fetchImpl: "is not supported in serialized runtime config.",
  },
  strava: {
    fetchImpl: "is not supported in serialized runtime config.",
    webhookSigningSecret:
      "is a provider-owned webhook signing secret and is not supported in serialized runtime config.",
    webhookVerifyToken:
      "is a provider-owned admin secret and is not supported in serialized runtime config.",
  },
} as const;

export function readConfiguredDeviceSyncRuntimeConfig(
  env: DeviceSyncEnvSource,
): ConfiguredDeviceSyncRuntimeConfig | null {
  const providerConfigs = readSerializableConfiguredDeviceSyncProviderConfigs(env);
  const publicBaseUrl = optionalEnv(env, DEVICE_SYNC_PUBLIC_BASE_URL_ENV_KEYS);
  const secret = optionalEnv(env, DEVICE_SYNC_SECRET_ENV_KEYS);

  if (!publicBaseUrl || !secret || !hasSerializableProviderConfigs(providerConfigs)) {
    return null;
  }

  return {
    providerConfigs,
    publicBaseUrl,
    secret,
  };
}

export function parseConfiguredDeviceSyncRuntimeConfig(
  value: unknown,
  label: string,
): ConfiguredDeviceSyncRuntimeConfig {
  const record = requireSerializableDeviceSyncRuntimeConfigRecord(value, label);

  return {
    providerConfigs: parseSerializableProviderConfigs(
      record.providerConfigs,
      `${label}.providerConfigs`,
    ),
    publicBaseUrl: requireSerializableString(record.publicBaseUrl, `${label}.publicBaseUrl`),
    secret: requireSerializableString(record.secret, `${label}.secret`),
  };
}

export function cloneConfiguredDeviceSyncRuntimeConfig(
  config: ConfiguredDeviceSyncRuntimeConfig,
): ConfiguredDeviceSyncRuntimeConfig {
  return {
    providerConfigs: parseSerializableProviderConfigs(
      structuredClone(config.providerConfigs),
      "runtimeConfig.providerConfigs",
    ),
    publicBaseUrl: config.publicBaseUrl,
    secret: config.secret,
  };
}

function readSerializableConfiguredDeviceSyncProviderConfigs(
  env: DeviceSyncEnvSource,
): SerializableConfiguredDeviceSyncProviderConfigs {
  return {
    ...readSerializableJunctionConfig(env),
    ...readSerializableOuraConfig(env),
    ...readSerializableWhoopConfig(env),
    ...readSerializableStravaConfig(env),
  };
}

function readSerializableJunctionConfig(
  env: DeviceSyncEnvSource,
): Pick<SerializableConfiguredDeviceSyncProviderConfigs, "junction"> {
  const apiKey = optionalEnv(env, JUNCTION_API_KEY_ENV_KEYS);
  const clientUserIdSecret = optionalEnv(env, JUNCTION_CLIENT_USER_ID_SECRET_ENV_KEYS);
  const environment = optionalEnv(env, JUNCTION_ENV_ENV_KEYS);
  const region = optionalEnv(env, JUNCTION_REGION_ENV_KEYS);
  const webhookSecret = optionalEnv(env, JUNCTION_WEBHOOK_SECRET_ENV_KEYS);

  if (!apiKey && !clientUserIdSecret && !environment && !region && !webhookSecret) {
    return {};
  }

  if (!apiKey || !clientUserIdSecret || !environment || !region) {
    throw new TypeError(
      "Junction configuration is incomplete. Set JUNCTION_API_KEY, JUNCTION_CLIENT_USER_ID_SECRET, JUNCTION_ENV, and JUNCTION_REGION together.",
    );
  }

  const parsedEnvironment = parseJunctionEnvironment(environment);
  const parsedRegion = parseJunctionRegion(region);
  assertJunctionApiKeyMatchesProfile(apiKey, parsedEnvironment, parsedRegion);
  const config: SerializableConfiguredDeviceSyncProviderConfigByKey["junction"] = {
    environment: parsedEnvironment,
    region: parsedRegion,
  };
  const providerFilter = parseCsvEnv(env, JUNCTION_PROVIDER_FILTER_ENV_KEYS);
  const summaryResources = parseCsvEnv(env, JUNCTION_SUMMARY_RESOURCES_ENV_KEYS);
  const timeseriesResources = parseCsvEnv(env, JUNCTION_TIMESERIES_RESOURCES_ENV_KEYS);
  const summaryBackfillDays = parseIntegerEnv(env, JUNCTION_SUMMARY_BACKFILL_DAYS_ENV_KEYS);
  const timeseriesBackfillDays = parseIntegerEnv(env, JUNCTION_TIMESERIES_BACKFILL_DAYS_ENV_KEYS);
  const reconcileDays = parseIntegerEnv(env, JUNCTION_RECONCILE_DAYS_ENV_KEYS);
  const reconcileIntervalMs = parseIntegerEnv(env, JUNCTION_RECONCILE_INTERVAL_MS_ENV_KEYS);
  const requestTimeoutMs = parseIntegerEnv(env, JUNCTION_REQUEST_TIMEOUT_MS_ENV_KEYS);
  const webhookTimestampToleranceMs = parseIntegerEnv(
    env,
    JUNCTION_WEBHOOK_TIMESTAMP_TOLERANCE_MS_ENV_KEYS,
  );
  if (providerFilter !== undefined) config.providerFilter = providerFilter;
  if (summaryResources !== undefined) config.summaryResources = summaryResources;
  if (timeseriesResources !== undefined) config.timeseriesResources = timeseriesResources;
  if (summaryBackfillDays !== undefined) config.summaryBackfillDays = summaryBackfillDays;
  if (timeseriesBackfillDays !== undefined) config.timeseriesBackfillDays = timeseriesBackfillDays;
  if (reconcileDays !== undefined) config.reconcileDays = reconcileDays;
  if (reconcileIntervalMs !== undefined) config.reconcileIntervalMs = reconcileIntervalMs;
  if (requestTimeoutMs !== undefined) config.requestTimeoutMs = requestTimeoutMs;
  if (webhookTimestampToleranceMs !== undefined) {
    config.webhookTimestampToleranceMs = webhookTimestampToleranceMs;
  }

  return {
    junction: config,
  };
}

function readSerializableOuraConfig(
  env: DeviceSyncEnvSource,
): Pick<SerializableConfiguredDeviceSyncProviderConfigs, "oura"> {
  const credentials = readOptionalCredentialPair(
    env,
    OURA_CLIENT_ID_ENV_KEYS,
    OURA_CLIENT_SECRET_ENV_KEYS,
    "Oura",
  );

  if (!credentials) {
    return {};
  }

  const config: SerializableConfiguredDeviceSyncProviderConfigByKey["oura"] = {
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
  };
  const authBaseUrl = optionalEnv(env, OURA_AUTH_BASE_URL_ENV_KEYS);
  const apiBaseUrl = optionalEnv(env, OURA_API_BASE_URL_ENV_KEYS);
  const scopes = parseCsvEnv(env, OURA_SCOPES_ENV_KEYS);
  const backfillDays = parseIntegerEnv(env, OURA_BACKFILL_DAYS_ENV_KEYS);
  const reconcileDays = parseIntegerEnv(env, OURA_RECONCILE_DAYS_ENV_KEYS);
  const reconcileIntervalMs = parseIntegerEnv(env, OURA_RECONCILE_INTERVAL_MS_ENV_KEYS);
  const webhookTimestampToleranceMs = parseIntegerEnv(
    env,
    OURA_WEBHOOK_TIMESTAMP_TOLERANCE_MS_ENV_KEYS,
  );
  const requestTimeoutMs = parseIntegerEnv(env, OURA_REQUEST_TIMEOUT_MS_ENV_KEYS);
  if (authBaseUrl !== undefined) config.authBaseUrl = authBaseUrl;
  if (apiBaseUrl !== undefined) config.apiBaseUrl = apiBaseUrl;
  if (scopes !== undefined) config.scopes = scopes;
  if (backfillDays !== undefined) config.backfillDays = backfillDays;
  if (reconcileDays !== undefined) config.reconcileDays = reconcileDays;
  if (reconcileIntervalMs !== undefined) config.reconcileIntervalMs = reconcileIntervalMs;
  if (webhookTimestampToleranceMs !== undefined) {
    config.webhookTimestampToleranceMs = webhookTimestampToleranceMs;
  }
  if (requestTimeoutMs !== undefined) config.requestTimeoutMs = requestTimeoutMs;

  return { oura: config };
}

function readSerializableWhoopConfig(
  env: DeviceSyncEnvSource,
): Pick<SerializableConfiguredDeviceSyncProviderConfigs, "whoop"> {
  const credentials = readOptionalCredentialPair(
    env,
    WHOOP_CLIENT_ID_ENV_KEYS,
    WHOOP_CLIENT_SECRET_ENV_KEYS,
    "WHOOP",
  );

  if (!credentials) {
    return {};
  }

  const config: SerializableConfiguredDeviceSyncProviderConfigByKey["whoop"] = {
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
  };
  const baseUrl = optionalEnv(env, WHOOP_BASE_URL_ENV_KEYS);
  const scopes = parseCsvEnv(env, WHOOP_SCOPES_ENV_KEYS);
  const backfillDays = parseIntegerEnv(env, WHOOP_BACKFILL_DAYS_ENV_KEYS);
  const reconcileDays = parseIntegerEnv(env, WHOOP_RECONCILE_DAYS_ENV_KEYS);
  const reconcileIntervalMs = parseIntegerEnv(env, WHOOP_RECONCILE_INTERVAL_MS_ENV_KEYS);
  const webhookTimestampToleranceMs = parseIntegerEnv(
    env,
    WHOOP_WEBHOOK_TIMESTAMP_TOLERANCE_MS_ENV_KEYS,
  );
  const requestTimeoutMs = parseIntegerEnv(env, WHOOP_REQUEST_TIMEOUT_MS_ENV_KEYS);
  if (baseUrl !== undefined) config.baseUrl = baseUrl;
  if (scopes !== undefined) config.scopes = scopes;
  if (backfillDays !== undefined) config.backfillDays = backfillDays;
  if (reconcileDays !== undefined) config.reconcileDays = reconcileDays;
  if (reconcileIntervalMs !== undefined) config.reconcileIntervalMs = reconcileIntervalMs;
  if (webhookTimestampToleranceMs !== undefined) {
    config.webhookTimestampToleranceMs = webhookTimestampToleranceMs;
  }
  if (requestTimeoutMs !== undefined) config.requestTimeoutMs = requestTimeoutMs;

  return { whoop: config };
}

function readSerializableStravaConfig(
  env: DeviceSyncEnvSource,
): Pick<SerializableConfiguredDeviceSyncProviderConfigs, "strava"> {
  const credentials = readOptionalCredentialPair(
    env,
    STRAVA_CLIENT_ID_ENV_KEYS,
    STRAVA_CLIENT_SECRET_ENV_KEYS,
    "Strava",
  );

  if (!credentials) {
    return {};
  }

  const config: SerializableConfiguredDeviceSyncProviderConfigByKey["strava"] = {
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
  };
  const authBaseUrl = optionalEnv(env, STRAVA_AUTH_BASE_URL_ENV_KEYS);
  const apiBaseUrl = optionalEnv(env, STRAVA_API_BASE_URL_ENV_KEYS);
  const scopes = parseCsvEnv(env, STRAVA_SCOPES_ENV_KEYS);
  const backfillDays = parseIntegerEnv(env, STRAVA_BACKFILL_DAYS_ENV_KEYS);
  const reconcileDays = parseIntegerEnv(env, STRAVA_RECONCILE_DAYS_ENV_KEYS);
  const reconcileIntervalMs = parseIntegerEnv(env, STRAVA_RECONCILE_INTERVAL_MS_ENV_KEYS);
  const requestTimeoutMs = parseIntegerEnv(env, STRAVA_REQUEST_TIMEOUT_MS_ENV_KEYS);
  const webhookTimestampToleranceMs = parseIntegerEnv(
    env,
    STRAVA_WEBHOOK_TIMESTAMP_TOLERANCE_MS_ENV_KEYS,
  );
  if (authBaseUrl !== undefined) config.authBaseUrl = authBaseUrl;
  if (apiBaseUrl !== undefined) config.apiBaseUrl = apiBaseUrl;
  if (scopes !== undefined) config.scopes = scopes;
  if (backfillDays !== undefined) config.backfillDays = backfillDays;
  if (reconcileDays !== undefined) config.reconcileDays = reconcileDays;
  if (reconcileIntervalMs !== undefined) config.reconcileIntervalMs = reconcileIntervalMs;
  if (requestTimeoutMs !== undefined) config.requestTimeoutMs = requestTimeoutMs;
  if (webhookTimestampToleranceMs !== undefined) {
    config.webhookTimestampToleranceMs = webhookTimestampToleranceMs;
  }

  return { strava: config };
}

function hasSerializableProviderConfigs(
  configs: SerializableConfiguredDeviceSyncProviderConfigs,
): boolean {
  return SERIALIZABLE_PROVIDER_KEYS.some((provider) => configs[provider] !== undefined);
}

function requireSerializableDeviceSyncRuntimeConfigRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  const record = requireSerializableConfigObject(value, label);
  const supportedKeys = new Set<string>(DEVICE_SYNC_RUNTIME_CONFIG_KEYS);

  for (const key of Object.keys(record)) {
    if (!supportedKeys.has(key)) {
      throw new TypeError(`${label}.${key} is not supported in serialized runtime config.`);
    }
  }

  return record;
}

function parseSerializableProviderConfigs(
  value: unknown,
  label: string,
): SerializableConfiguredDeviceSyncProviderConfigs {
  const record = requireSerializableConfigObject(value, label);
  const configs: SerializableConfiguredDeviceSyncProviderConfigs = {};

  for (const key of Object.keys(record)) {
    if (!isSerializableProviderKey(key)) {
      throw new TypeError(`${label}.${key} is not a supported device-sync provider config.`);
    }
  }

  if (record.junction !== undefined) {
    configs.junction = parseSerializableProviderConfig(
      "junction",
      record.junction,
      `${label}.junction`,
    );
  }
  if (record.oura !== undefined) {
    configs.oura = parseSerializableProviderConfig("oura", record.oura, `${label}.oura`);
  }
  if (record.whoop !== undefined) {
    configs.whoop = parseSerializableProviderConfig("whoop", record.whoop, `${label}.whoop`);
  }
  if (record.strava !== undefined) {
    configs.strava = parseSerializableProviderConfig("strava", record.strava, `${label}.strava`);
  }

  return configs;
}

function parseSerializableProviderConfig<TProvider extends ConfiguredDeviceSyncProviderKey>(
  provider: TProvider,
  value: unknown,
  label: string,
): SerializableConfiguredDeviceSyncProviderConfigByKey[TProvider] {
  const record = requireSerializableConfigObject(value, label);
  const fields = SERIALIZABLE_PROVIDER_FIELDS[provider];
  const disallowed = SERIALIZABLE_PROVIDER_DISALLOWED_FIELDS[provider];
  const parsed: Record<string, boolean | number | string | string[]> = {};

  for (const [key, message] of Object.entries(disallowed)) {
    if (record[key] !== undefined) {
      throw new TypeError(`${label}.${key} ${message}`);
    }
  }

  for (const key of Object.keys(record)) {
    if (!Object.hasOwn(fields, key)) {
      throw new TypeError(`${label}.${key} is not a supported serialized provider config field.`);
    }
  }

  for (const [key, kind] of Object.entries(fields)) {
    const fieldValue = record[key];
    if (fieldValue === undefined) {
      continue;
    }
    parsed[key] = parseSerializableFieldValue(kind, fieldValue, `${label}.${key}`);
  }

  return parsed as SerializableConfiguredDeviceSyncProviderConfigByKey[TProvider];
}

function parseSerializableFieldValue(
  kind: "boolean" | "number" | "string" | "string[]",
  value: unknown,
  label: string,
): boolean | number | string | string[] {
  switch (kind) {
    case "boolean":
      return requireSerializableBoolean(value, label);
    case "number":
      return requireSerializableNumber(value, label);
    case "string":
      return requireSerializableString(value, label);
    case "string[]":
      return requireSerializableStringArray(value, label);
  }
}

function requireSerializableConfigObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireSerializableString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function requireSerializableBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }

  return value;
}

function requireSerializableNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }

  return value;
}

function requireSerializableStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array of strings.`);
  }

  return value.map((entry, index) => requireSerializableString(entry, `${label}[${index}]`));
}

function isSerializableProviderKey(value: string): value is ConfiguredDeviceSyncProviderKey {
  return (SERIALIZABLE_PROVIDER_KEYS as readonly string[]).includes(value);
}

function parseJunctionEnvironment(value: string): "sandbox" | "production" {
  if (value === "sandbox" || value === "production") {
    return value;
  }

  throw new TypeError("JUNCTION_ENV must be sandbox or production.");
}

function parseJunctionRegion(value: string): "us" | "eu" {
  if (value === "us" || value === "eu") {
    return value;
  }

  throw new TypeError("JUNCTION_REGION must be us or eu.");
}

function assertJunctionApiKeyMatchesProfile(
  apiKey: string,
  environment: "sandbox" | "production",
  region: "us" | "eu",
): void {
  const expectedPrefix = environment === "production"
    ? region === "us" ? "pk_us_" : "pk_eu_"
    : region === "us" ? "sk_us_" : "sk_eu_";

  if (!apiKey.startsWith(expectedPrefix)) {
    throw new TypeError(
      `JUNCTION_API_KEY must start with ${expectedPrefix} for ${environment}/${region}.`,
    );
  }
}
