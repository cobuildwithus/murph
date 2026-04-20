import { assertListenerPort } from "@murphai/runtime-state";

import {
  GARMIN_API_BASE_URL_ENV_KEYS,
  GARMIN_AUTH_BASE_URL_ENV_KEYS,
  GARMIN_BACKFILL_DAYS_ENV_KEYS,
  GARMIN_CLIENT_ID_ENV_KEYS,
  GARMIN_CLIENT_SECRET_ENV_KEYS,
  GARMIN_RECONCILE_DAYS_ENV_KEYS,
  GARMIN_RECONCILE_INTERVAL_MS_ENV_KEYS,
  GARMIN_REQUEST_TIMEOUT_MS_ENV_KEYS,
  GARMIN_TOKEN_BASE_URL_ENV_KEYS,
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
  OURA_WEBHOOK_VERIFICATION_TOKEN_ENV_KEYS,
  STRAVA_API_BASE_URL_ENV_KEYS,
  STRAVA_AUTH_BASE_URL_ENV_KEYS,
  STRAVA_BACKFILL_DAYS_ENV_KEYS,
  STRAVA_CLIENT_ID_ENV_KEYS,
  STRAVA_CLIENT_SECRET_ENV_KEYS,
  STRAVA_RECONCILE_DAYS_ENV_KEYS,
  STRAVA_RECONCILE_INTERVAL_MS_ENV_KEYS,
  STRAVA_REQUEST_TIMEOUT_MS_ENV_KEYS,
  STRAVA_SCOPES_ENV_KEYS,
  STRAVA_WEBHOOK_VERIFY_TOKEN_ENV_KEYS,
  WHOOP_BACKFILL_DAYS_ENV_KEYS,
  WHOOP_BASE_URL_ENV_KEYS,
  WHOOP_CLIENT_ID_ENV_KEYS,
  WHOOP_CLIENT_SECRET_ENV_KEYS,
  WHOOP_RECONCILE_DAYS_ENV_KEYS,
  WHOOP_RECONCILE_INTERVAL_MS_ENV_KEYS,
  WHOOP_REQUEST_TIMEOUT_MS_ENV_KEYS,
  WHOOP_SCOPES_ENV_KEYS,
  WHOOP_WEBHOOK_TIMESTAMP_TOLERANCE_MS_ENV_KEYS,
} from "./env-keys.ts";

import { normalizeString } from "../shared.ts";

import type { GarminDeviceSyncProviderConfig } from "../providers/garmin.ts";
import type { OuraDeviceSyncProviderConfig } from "../providers/oura.ts";
import type { StravaDeviceSyncProviderConfig } from "../providers/strava.ts";
import type { WhoopDeviceSyncProviderConfig } from "../providers/whoop.ts";

export interface ConfiguredDeviceSyncProviderConfigByKey {
  garmin: GarminDeviceSyncProviderConfig;
  oura: OuraDeviceSyncProviderConfig;
  whoop: WhoopDeviceSyncProviderConfig;
  strava: StravaDeviceSyncProviderConfig;
}

export type ConfiguredDeviceSyncProviderKey = keyof ConfiguredDeviceSyncProviderConfigByKey;
export type ConfiguredDeviceSyncProviderConfigs = Partial<ConfiguredDeviceSyncProviderConfigByKey>;
export type ConfiguredDeviceSyncProviderPresence =
  Partial<Record<ConfiguredDeviceSyncProviderKey, unknown>>;

export type DeviceSyncEnvSource = Readonly<Record<string, string | undefined>>;

export const configuredDeviceSyncProviderKeys = Object.freeze([
  "garmin",
  "oura",
  "whoop",
  "strava",
] as ConfiguredDeviceSyncProviderKey[]);

export function readConfiguredDeviceSyncProviderConfigs(
  env: DeviceSyncEnvSource,
): ConfiguredDeviceSyncProviderConfigs {
  const configs: ConfiguredDeviceSyncProviderConfigs = {};

  const garmin = readConfiguredGarminDeviceSyncProviderConfig(env);
  if (garmin) {
    configs.garmin = garmin;
  }

  const oura = readConfiguredOuraDeviceSyncProviderConfig(env);
  if (oura) {
    configs.oura = oura;
  }

  const whoop = readConfiguredWhoopDeviceSyncProviderConfig(env);
  if (whoop) {
    configs.whoop = whoop;
  }

  const strava = readConfiguredStravaDeviceSyncProviderConfig(env);
  if (strava) {
    configs.strava = strava;
  }

  return configs;
}

export function readConfiguredGarminDeviceSyncProviderConfig(
  env: DeviceSyncEnvSource,
): GarminDeviceSyncProviderConfig | null {
  const credentials = readOptionalCredentialPair(
    env,
    GARMIN_CLIENT_ID_ENV_KEYS,
    GARMIN_CLIENT_SECRET_ENV_KEYS,
    "Garmin",
  );

  if (!credentials) {
    return null;
  }

  return {
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    authBaseUrl: optionalEnv(env, GARMIN_AUTH_BASE_URL_ENV_KEYS),
    tokenBaseUrl: optionalEnv(env, GARMIN_TOKEN_BASE_URL_ENV_KEYS),
    apiBaseUrl: optionalEnv(env, GARMIN_API_BASE_URL_ENV_KEYS),
    backfillDays: parseIntegerEnv(env, GARMIN_BACKFILL_DAYS_ENV_KEYS),
    reconcileDays: parseIntegerEnv(env, GARMIN_RECONCILE_DAYS_ENV_KEYS),
    reconcileIntervalMs: parseIntegerEnv(env, GARMIN_RECONCILE_INTERVAL_MS_ENV_KEYS),
    requestTimeoutMs: parseIntegerEnv(env, GARMIN_REQUEST_TIMEOUT_MS_ENV_KEYS),
  };
}

export function readConfiguredWhoopDeviceSyncProviderConfig(
  env: DeviceSyncEnvSource,
): WhoopDeviceSyncProviderConfig | null {
  const credentials = readOptionalCredentialPair(
    env,
    WHOOP_CLIENT_ID_ENV_KEYS,
    WHOOP_CLIENT_SECRET_ENV_KEYS,
    "WHOOP",
  );

  if (!credentials) {
    return null;
  }

  return {
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    baseUrl: optionalEnv(env, WHOOP_BASE_URL_ENV_KEYS),
    scopes: parseCsvEnv(env, WHOOP_SCOPES_ENV_KEYS),
    backfillDays: parseIntegerEnv(env, WHOOP_BACKFILL_DAYS_ENV_KEYS),
    reconcileDays: parseIntegerEnv(env, WHOOP_RECONCILE_DAYS_ENV_KEYS),
    reconcileIntervalMs: parseIntegerEnv(env, WHOOP_RECONCILE_INTERVAL_MS_ENV_KEYS),
    webhookTimestampToleranceMs: parseIntegerEnv(env, WHOOP_WEBHOOK_TIMESTAMP_TOLERANCE_MS_ENV_KEYS),
    requestTimeoutMs: parseIntegerEnv(env, WHOOP_REQUEST_TIMEOUT_MS_ENV_KEYS),
  };
}

export function readConfiguredOuraDeviceSyncProviderConfig(
  env: DeviceSyncEnvSource,
): OuraDeviceSyncProviderConfig | null {
  const credentials = readOptionalCredentialPair(
    env,
    OURA_CLIENT_ID_ENV_KEYS,
    OURA_CLIENT_SECRET_ENV_KEYS,
    "Oura",
  );

  if (!credentials) {
    return null;
  }

  return {
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    authBaseUrl: optionalEnv(env, OURA_AUTH_BASE_URL_ENV_KEYS),
    apiBaseUrl: optionalEnv(env, OURA_API_BASE_URL_ENV_KEYS),
    scopes: parseCsvEnv(env, OURA_SCOPES_ENV_KEYS),
    backfillDays: parseIntegerEnv(env, OURA_BACKFILL_DAYS_ENV_KEYS),
    reconcileDays: parseIntegerEnv(env, OURA_RECONCILE_DAYS_ENV_KEYS),
    reconcileIntervalMs: parseIntegerEnv(env, OURA_RECONCILE_INTERVAL_MS_ENV_KEYS),
    webhookTimestampToleranceMs: parseIntegerEnv(env, OURA_WEBHOOK_TIMESTAMP_TOLERANCE_MS_ENV_KEYS),
    requestTimeoutMs: parseIntegerEnv(env, OURA_REQUEST_TIMEOUT_MS_ENV_KEYS),
    webhookVerificationToken: optionalEnv(env, OURA_WEBHOOK_VERIFICATION_TOKEN_ENV_KEYS),
  };
}

export function readConfiguredStravaDeviceSyncProviderConfig(
  env: DeviceSyncEnvSource,
): StravaDeviceSyncProviderConfig | null {
  const credentials = readOptionalCredentialPair(
    env,
    STRAVA_CLIENT_ID_ENV_KEYS,
    STRAVA_CLIENT_SECRET_ENV_KEYS,
    "Strava",
  );

  if (!credentials) {
    return null;
  }

  return {
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    authBaseUrl: optionalEnv(env, STRAVA_AUTH_BASE_URL_ENV_KEYS),
    apiBaseUrl: optionalEnv(env, STRAVA_API_BASE_URL_ENV_KEYS),
    scopes: parseCsvEnv(env, STRAVA_SCOPES_ENV_KEYS),
    backfillDays: parseIntegerEnv(env, STRAVA_BACKFILL_DAYS_ENV_KEYS),
    reconcileDays: parseIntegerEnv(env, STRAVA_RECONCILE_DAYS_ENV_KEYS),
    reconcileIntervalMs: parseIntegerEnv(env, STRAVA_RECONCILE_INTERVAL_MS_ENV_KEYS),
    requestTimeoutMs: parseIntegerEnv(env, STRAVA_REQUEST_TIMEOUT_MS_ENV_KEYS),
    webhookVerifyToken: optionalEnv(env, STRAVA_WEBHOOK_VERIFY_TOKEN_ENV_KEYS),
  };
}

export function hasConfiguredDeviceSyncProviderConfigs(
  configs: ConfiguredDeviceSyncProviderPresence,
): boolean {
  return listConfiguredDeviceSyncProviderNames(configs).length > 0;
}

export function listConfiguredDeviceSyncProviderNames(
  configs: ConfiguredDeviceSyncProviderPresence,
): ConfiguredDeviceSyncProviderKey[] {
  return configuredDeviceSyncProviderKeys.filter((provider) => configs[provider] !== undefined);
}

export function requireEnv(env: DeviceSyncEnvSource, keys: readonly string[]): string {
  const value = optionalEnv(env, keys);

  if (!value) {
    throw new TypeError(`Missing required environment variable. Set one of: ${keys.join(", ")}`);
  }

  return value;
}

export function optionalEnv(env: DeviceSyncEnvSource, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = normalizeString(env[key]);

    if (value) {
      return value;
    }
  }

  return undefined;
}

export function parseIntegerEnv(env: DeviceSyncEnvSource, keys: readonly string[]): number | undefined {
  const value = optionalEnv(env, keys);

  if (!value) {
    return undefined;
  }

  return parseDecimalInteger(value, keys[0]);
}

export function parsePortEnv(env: DeviceSyncEnvSource, keys: readonly string[]): number | undefined {
  const parsed = parseIntegerEnv(env, keys);

  if (parsed === undefined) {
    return undefined;
  }

  assertListenerPort(
    parsed,
    `Environment variable ${keys[0]} must be an integer between 0 and 65535.`,
    { allowZero: true },
  );

  return parsed;
}

export function parseCsvEnv(env: DeviceSyncEnvSource, keys: readonly string[]): string[] | undefined {
  const value = optionalEnv(env, keys);

  if (!value) {
    return undefined;
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readOptionalCredentialPair(
  env: DeviceSyncEnvSource,
  clientIdKeys: readonly string[],
  clientSecretKeys: readonly string[],
  providerLabel: string,
): { clientId: string; clientSecret: string } | null {
  const clientId = optionalEnv(env, clientIdKeys);
  const clientSecret = optionalEnv(env, clientSecretKeys);

  if (!clientId && !clientSecret) {
    return null;
  }

  if (!clientId || !clientSecret) {
    throw new TypeError(
      `${providerLabel} configuration is incomplete. Set ${clientIdKeys[0]} and ${clientSecretKeys[0]} together.`,
    );
  }

  return { clientId, clientSecret };
}

function parseDecimalInteger(value: string, key: string): number {
  if (!/^\d+$/u.test(value)) {
    throw new TypeError(`Environment variable ${key} must be an integer.`);
  }

  return Number.parseInt(value, 10);
}
