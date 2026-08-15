import {
  configuredDeviceSyncProviderKeys,
  listConfiguredDeviceSyncProviderNames,
} from "./provider-keys.ts";
import {
  optionalEnv,
  parseCsvEnv,
  parseIntegerEnv,
  parsePortEnv,
  readOptionalCredentialPair,
  requireEnv,
} from "./provider-config-helpers.ts";

import type {
  ConfiguredDeviceSyncProviderConfigByKey,
  ConfiguredDeviceSyncProviderConfigs,
  ConfiguredDeviceSyncProviderKey,
  ConfiguredDeviceSyncProviderPresence,
  DeviceSyncEnvSource,
} from "./provider-types.ts";
import {
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
  STRAVA_WEBHOOK_SIGNING_SECRET_ENV_KEYS,
  STRAVA_WEBHOOK_TIMESTAMP_TOLERANCE_MS_ENV_KEYS,
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
} from "./provider-env.ts";
import {
  JUNCTION_PRODUCTION_TIMESERIES_RESOURCES,
  readConfiguredJunctionDeviceSyncProviderConfig,
} from "./junction-config.ts";
import type {
  OuraDeviceSyncProviderConfig,
  StravaDeviceSyncProviderConfig,
  WhoopDeviceSyncProviderConfig,
} from "./provider-types.ts";

export type {
  ConfiguredDeviceSyncProviderConfigByKey,
  ConfiguredDeviceSyncProviderConfigs,
  ConfiguredDeviceSyncProviderKey,
  ConfiguredDeviceSyncProviderPresence,
  DeviceSyncEnvSource,
} from "./provider-types.ts";

export { configuredDeviceSyncProviderKeys };
export {
  JUNCTION_PRODUCTION_TIMESERIES_RESOURCES,
  readConfiguredJunctionDeviceSyncProviderConfig,
};

export function readConfiguredDeviceSyncProviderConfigs(
  env: DeviceSyncEnvSource,
): ConfiguredDeviceSyncProviderConfigs {
  const configs: ConfiguredDeviceSyncProviderConfigs = {};

  const junction = readConfiguredJunctionDeviceSyncProviderConfig(env);
  if (junction) {
    configs.junction = junction;
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
    webhookSigningSecret: optionalEnv(env, STRAVA_WEBHOOK_SIGNING_SECRET_ENV_KEYS),
    webhookTimestampToleranceMs: parseIntegerEnv(env, STRAVA_WEBHOOK_TIMESTAMP_TOLERANCE_MS_ENV_KEYS),
    webhookVerifyToken: optionalEnv(env, STRAVA_WEBHOOK_VERIFY_TOKEN_ENV_KEYS),
  };
}

export function hasConfiguredDeviceSyncProviderConfigs(
  configs: ConfiguredDeviceSyncProviderPresence,
): boolean {
  return listConfiguredDeviceSyncProviderNames(configs).length > 0;
}

export { listConfiguredDeviceSyncProviderNames };

export {
  optionalEnv,
  parseCsvEnv,
  parseIntegerEnv,
  parsePortEnv,
  requireEnv,
} from "./provider-config-helpers.ts";
