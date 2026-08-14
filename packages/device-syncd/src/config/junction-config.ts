import { JUNCTION_ALLOWED_TIMESERIES_RESOURCES } from "@murphai/contracts";

import {
  JUNCTION_API_BASE_URL_ENV_KEYS,
  JUNCTION_API_KEY_ENV_KEYS,
  JUNCTION_CLIENT_USER_ID_SECRET_ENV_KEYS,
  JUNCTION_ENV_ENV_KEYS,
  JUNCTION_PROVIDER_FILTER_ENV_KEYS,
  JUNCTION_PUSH_SOURCE_RECOVERY_ENABLED_ENV_KEYS,
  JUNCTION_RECONCILE_DAYS_ENV_KEYS,
  JUNCTION_RECONCILE_INTERVAL_MS_ENV_KEYS,
  JUNCTION_REGION_ENV_KEYS,
  JUNCTION_REQUEST_TIMEOUT_MS_ENV_KEYS,
  JUNCTION_SUMMARY_BACKFILL_DAYS_ENV_KEYS,
  JUNCTION_SUMMARY_RESOURCES_ENV_KEYS,
  JUNCTION_TIMESERIES_BACKFILL_DAYS_ENV_KEYS,
  JUNCTION_WEBHOOK_SECRET_ENV_KEYS,
  JUNCTION_WEBHOOK_TIMESTAMP_TOLERANCE_MS_ENV_KEYS,
} from "./provider-env.ts";
import {
  optionalEnv,
  parseBooleanEnv,
  parseCsvEnv,
  parseIntegerEnv,
} from "./provider-config-helpers.ts";
import { assertValidJunctionClientConfig } from "./junction-client-config.ts";

import type {
  DeviceSyncEnvSource,
  JunctionDeviceSyncProviderConfig,
  JunctionEnvironment,
  JunctionRegion,
} from "./provider-types.ts";

// Production sets the exhaustive code-owned list explicitly. Omitted runtime
// configuration resolves to the same registry, while explicit subsets remain
// exact and cannot be widened by member or environment data.
export const JUNCTION_PRODUCTION_TIMESERIES_RESOURCES =
  JUNCTION_ALLOWED_TIMESERIES_RESOURCES;

export function readConfiguredJunctionDeviceSyncProviderConfig(
  env: DeviceSyncEnvSource,
): JunctionDeviceSyncProviderConfig | null {
  const apiKey = optionalEnv(env, JUNCTION_API_KEY_ENV_KEYS);
  const clientUserIdSecret = optionalEnv(env, JUNCTION_CLIENT_USER_ID_SECRET_ENV_KEYS);
  const environment = optionalEnv(env, JUNCTION_ENV_ENV_KEYS);
  const region = optionalEnv(env, JUNCTION_REGION_ENV_KEYS);
  const webhookSecret = optionalEnv(env, JUNCTION_WEBHOOK_SECRET_ENV_KEYS);

  if (!apiKey && !clientUserIdSecret && !environment && !region && !webhookSecret) {
    return null;
  }

  if (!apiKey || !clientUserIdSecret || !environment || !region) {
    throw new TypeError(
      "Junction configuration is incomplete. Set JUNCTION_API_KEY, JUNCTION_CLIENT_USER_ID_SECRET, JUNCTION_ENV, and JUNCTION_REGION together.",
    );
  }

  const config = {
    apiKey,
    clientUserIdSecret,
    environment: parseJunctionEnvironment(environment),
    region: parseJunctionRegion(region),
    apiBaseUrl: optionalEnv(env, JUNCTION_API_BASE_URL_ENV_KEYS),
    providerFilter: parseCsvEnv(env, JUNCTION_PROVIDER_FILTER_ENV_KEYS),
    summaryResources: parseCsvEnv(env, JUNCTION_SUMMARY_RESOURCES_ENV_KEYS),
    timeseriesResources: [...JUNCTION_PRODUCTION_TIMESERIES_RESOURCES],
    summaryBackfillDays: parseIntegerEnv(env, JUNCTION_SUMMARY_BACKFILL_DAYS_ENV_KEYS),
    timeseriesBackfillDays: parseIntegerEnv(env, JUNCTION_TIMESERIES_BACKFILL_DAYS_ENV_KEYS),
    reconcileDays: parseIntegerEnv(env, JUNCTION_RECONCILE_DAYS_ENV_KEYS),
    reconcileIntervalMs: parseIntegerEnv(env, JUNCTION_RECONCILE_INTERVAL_MS_ENV_KEYS),
    pushSourceRecoveryEnabled: parseBooleanEnv(env, JUNCTION_PUSH_SOURCE_RECOVERY_ENABLED_ENV_KEYS),
    requestTimeoutMs: parseIntegerEnv(env, JUNCTION_REQUEST_TIMEOUT_MS_ENV_KEYS),
    webhookSecret,
    webhookTimestampToleranceMs: parseIntegerEnv(env, JUNCTION_WEBHOOK_TIMESTAMP_TOLERANCE_MS_ENV_KEYS),
  };

  assertValidJunctionClientConfig(config);
  return config;
}

function parseJunctionEnvironment(value: string): JunctionEnvironment {
  if (value === "sandbox" || value === "production") {
    return value;
  }

  throw new TypeError("JUNCTION_ENV must be sandbox or production.");
}

function parseJunctionRegion(value: string): JunctionRegion {
  if (value === "us" || value === "eu") {
    return value;
  }

  throw new TypeError("JUNCTION_REGION must be us or eu.");
}
