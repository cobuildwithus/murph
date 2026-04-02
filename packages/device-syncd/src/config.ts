import {
  DEVICE_SYNC_CONTROL_TOKEN_ENV_KEYS,
  DEVICE_SYNC_SECRET_ENV_KEYS,
} from "./client.ts";

import { createGarminDeviceSyncProvider } from "./providers/garmin.ts";
import { createOuraDeviceSyncProvider } from "./providers/oura.ts";
import { createWhoopDeviceSyncProvider } from "./providers/whoop.ts";
import { DEFAULT_DEVICE_SYNC_HOST, normalizeString } from "./shared.ts";

import type { GarminDeviceSyncProviderConfig } from "./providers/garmin.ts";
import type { OuraDeviceSyncProviderConfig } from "./providers/oura.ts";
import type { WhoopDeviceSyncProviderConfig } from "./providers/whoop.ts";
import type { CreateDeviceSyncServiceInput } from "./service.ts";
import type {
  DeviceSyncHttpConfig,
  DeviceSyncLogger,
  DeviceSyncProvider,
  DeviceSyncServiceConfig,
} from "./types.ts";

export interface LoadedDeviceSyncEnvironment {
  service: CreateDeviceSyncServiceInput;
  http: DeviceSyncHttpConfig;
}

type DeviceSyncEnvSource = Readonly<Record<string, string | undefined>>;

const DEVICE_SYNC_ALLOWED_RETURN_ORIGINS_ENV_KEYS = [
  "DEVICE_SYNC_ALLOWED_RETURN_ORIGINS",
] as const;
const DEVICE_SYNC_HOST_ENV_KEYS = ["DEVICE_SYNC_HOST"] as const;
const DEVICE_SYNC_PORT_ENV_KEYS = ["DEVICE_SYNC_PORT", "PORT"] as const;
const DEVICE_SYNC_PUBLIC_BASE_URL_ENV_KEYS = [
  "DEVICE_SYNC_PUBLIC_BASE_URL",
] as const;
const DEVICE_SYNC_PUBLIC_HOST_ENV_KEYS = [
  "DEVICE_SYNC_PUBLIC_HOST",
] as const;
const DEVICE_SYNC_PUBLIC_PORT_ENV_KEYS = [
  "DEVICE_SYNC_PUBLIC_PORT",
] as const;
const DEVICE_SYNC_SCHEDULER_POLL_MS_ENV_KEYS = [
  "DEVICE_SYNC_SCHEDULER_POLL_MS",
] as const;
const DEVICE_SYNC_SESSION_TTL_MS_ENV_KEYS = [
  "DEVICE_SYNC_SESSION_TTL_MS",
] as const;
const DEVICE_SYNC_STATE_DB_PATH_ENV_KEYS = [
  "DEVICE_SYNC_STATE_DB_PATH",
] as const;
const DEVICE_SYNC_VAULT_ROOT_ENV_KEYS = ["DEVICE_SYNC_VAULT_ROOT"] as const;
const DEVICE_SYNC_WORKER_BATCH_SIZE_ENV_KEYS = [
  "DEVICE_SYNC_WORKER_BATCH_SIZE",
] as const;
const DEVICE_SYNC_WORKER_LEASE_MS_ENV_KEYS = [
  "DEVICE_SYNC_WORKER_LEASE_MS",
] as const;
const DEVICE_SYNC_WORKER_POLL_MS_ENV_KEYS = [
  "DEVICE_SYNC_WORKER_POLL_MS",
] as const;
const GARMIN_API_BASE_URL_ENV_KEYS = ["GARMIN_API_BASE_URL"] as const;
const GARMIN_AUTH_BASE_URL_ENV_KEYS = ["GARMIN_AUTH_BASE_URL"] as const;
const GARMIN_BACKFILL_DAYS_ENV_KEYS = ["GARMIN_BACKFILL_DAYS"] as const;
const GARMIN_CLIENT_ID_ENV_KEYS = ["GARMIN_CLIENT_ID"] as const;
const GARMIN_CLIENT_SECRET_ENV_KEYS = ["GARMIN_CLIENT_SECRET"] as const;
const GARMIN_TOKEN_BASE_URL_ENV_KEYS = ["GARMIN_TOKEN_BASE_URL"] as const;
const GARMIN_RECONCILE_DAYS_ENV_KEYS = [
  "GARMIN_RECONCILE_DAYS",
] as const;
const GARMIN_RECONCILE_INTERVAL_MS_ENV_KEYS = [
  "GARMIN_RECONCILE_INTERVAL_MS",
] as const;
const GARMIN_REQUEST_TIMEOUT_MS_ENV_KEYS = [
  "GARMIN_REQUEST_TIMEOUT_MS",
] as const;
const OURA_API_BASE_URL_ENV_KEYS = ["OURA_API_BASE_URL"] as const;
const OURA_AUTH_BASE_URL_ENV_KEYS = ["OURA_AUTH_BASE_URL"] as const;
const OURA_BACKFILL_DAYS_ENV_KEYS = ["OURA_BACKFILL_DAYS"] as const;
const OURA_CLIENT_ID_ENV_KEYS = ["OURA_CLIENT_ID"] as const;
const OURA_CLIENT_SECRET_ENV_KEYS = ["OURA_CLIENT_SECRET"] as const;
const OURA_WEBHOOK_VERIFICATION_TOKEN_ENV_KEYS = ["OURA_WEBHOOK_VERIFICATION_TOKEN"] as const;
const OURA_RECONCILE_DAYS_ENV_KEYS = [
  "OURA_RECONCILE_DAYS",
] as const;
const OURA_RECONCILE_INTERVAL_MS_ENV_KEYS = [
  "OURA_RECONCILE_INTERVAL_MS",
] as const;
const OURA_REQUEST_TIMEOUT_MS_ENV_KEYS = [
  "OURA_REQUEST_TIMEOUT_MS",
] as const;
const OURA_SCOPES_ENV_KEYS = ["OURA_SCOPES"] as const;
const OURA_WEBHOOK_TIMESTAMP_TOLERANCE_MS_ENV_KEYS = [
  "OURA_WEBHOOK_TIMESTAMP_TOLERANCE_MS",
] as const;
const WHOOP_BACKFILL_DAYS_ENV_KEYS = ["WHOOP_BACKFILL_DAYS"] as const;
const WHOOP_BASE_URL_ENV_KEYS = ["WHOOP_BASE_URL"] as const;
const WHOOP_CLIENT_ID_ENV_KEYS = ["WHOOP_CLIENT_ID"] as const;
const WHOOP_CLIENT_SECRET_ENV_KEYS = ["WHOOP_CLIENT_SECRET"] as const;
const WHOOP_RECONCILE_DAYS_ENV_KEYS = [
  "WHOOP_RECONCILE_DAYS",
] as const;
const WHOOP_RECONCILE_INTERVAL_MS_ENV_KEYS = [
  "WHOOP_RECONCILE_INTERVAL_MS",
] as const;
const WHOOP_REQUEST_TIMEOUT_MS_ENV_KEYS = [
  "WHOOP_REQUEST_TIMEOUT_MS",
] as const;
const WHOOP_SCOPES_ENV_KEYS = ["WHOOP_SCOPES"] as const;
const WHOOP_WEBHOOK_TIMESTAMP_TOLERANCE_MS_ENV_KEYS = [
  "WHOOP_WEBHOOK_TIMESTAMP_TOLERANCE_MS",
] as const;

export function loadDeviceSyncEnvironment(env: NodeJS.ProcessEnv = process.env): LoadedDeviceSyncEnvironment {
  const vaultRoot = requireEnv(env, DEVICE_SYNC_VAULT_ROOT_ENV_KEYS);
  const publicBaseUrl = requireEnv(env, DEVICE_SYNC_PUBLIC_BASE_URL_ENV_KEYS);
  const secret = requireEnv(env, DEVICE_SYNC_SECRET_ENV_KEYS);
  const controlToken = requireEnv(env, DEVICE_SYNC_CONTROL_TOKEN_ENV_KEYS);
  const logger = createConsoleDeviceSyncLogger();
  const providers = createConfiguredDeviceSyncProviders(env);
  const publicListener = readOptionalPublicListener(env);

  if (providers.length === 0) {
    throw new TypeError(
      "No device sync providers are configured. Set Garmin, WHOOP, and/or Oura client credentials before starting device-syncd.",
    );
  }

  const serviceConfig: DeviceSyncServiceConfig = {
    vaultRoot,
    publicBaseUrl,
    allowedReturnOrigins: parseCsvEnv(env, DEVICE_SYNC_ALLOWED_RETURN_ORIGINS_ENV_KEYS),
    stateDatabasePath: optionalEnv(env, DEVICE_SYNC_STATE_DB_PATH_ENV_KEYS),
    sessionTtlMs: parseIntegerEnv(env, DEVICE_SYNC_SESSION_TTL_MS_ENV_KEYS),
    workerLeaseMs: parseIntegerEnv(env, DEVICE_SYNC_WORKER_LEASE_MS_ENV_KEYS),
    workerPollMs: parseIntegerEnv(env, DEVICE_SYNC_WORKER_POLL_MS_ENV_KEYS),
    workerBatchSize: parseIntegerEnv(env, DEVICE_SYNC_WORKER_BATCH_SIZE_ENV_KEYS),
    schedulerPollMs: parseIntegerEnv(env, DEVICE_SYNC_SCHEDULER_POLL_MS_ENV_KEYS),
    log: logger,
  };

  return {
    service: {
      secret,
      config: serviceConfig,
      providers,
    },
    http: {
      host: optionalEnv(env, DEVICE_SYNC_HOST_ENV_KEYS) ?? DEFAULT_DEVICE_SYNC_HOST,
      port: parseIntegerEnv(env, DEVICE_SYNC_PORT_ENV_KEYS) ?? 8788,
      controlToken,
      ouraWebhookVerificationToken: optionalEnv(env, OURA_WEBHOOK_VERIFICATION_TOKEN_ENV_KEYS),
      ...publicListener,
    },
  };
}

export function createConsoleDeviceSyncLogger(consoleLike: Console = console): DeviceSyncLogger {
  return {
    debug(message, context) {
      consoleLike.debug?.(message, context ?? {});
    },
    info(message, context) {
      consoleLike.info?.(message, context ?? {});
    },
    warn(message, context) {
      consoleLike.warn?.(message, context ?? {});
    },
    error(message, context) {
      consoleLike.error?.(message, context ?? {});
    },
  };
}

export function createConfiguredDeviceSyncProviders(env: DeviceSyncEnvSource): DeviceSyncProvider[] {
  const providers: DeviceSyncProvider[] = [];
  const garminConfig = readConfiguredGarminDeviceSyncProviderConfig(env);
  const whoopConfig = readConfiguredWhoopDeviceSyncProviderConfig(env);
  const ouraConfig = readConfiguredOuraDeviceSyncProviderConfig(env);

  if (garminConfig) {
    providers.push(createGarminDeviceSyncProvider(garminConfig));
  }

  if (whoopConfig) {
    providers.push(createWhoopDeviceSyncProvider(whoopConfig));
  }

  if (ouraConfig) {
    providers.push(createOuraDeviceSyncProvider(ouraConfig));
  }

  return providers;
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
  };
}

function readOptionalPublicListener(env: NodeJS.ProcessEnv): Pick<DeviceSyncHttpConfig, "publicHost" | "publicPort"> {
  const publicHost = optionalEnv(env, DEVICE_SYNC_PUBLIC_HOST_ENV_KEYS);
  const publicPort = parseIntegerEnv(env, DEVICE_SYNC_PUBLIC_PORT_ENV_KEYS);

  if (!publicHost && publicPort === undefined) {
    return {};
  }

  if (!publicHost || publicPort === undefined) {
    throw new TypeError(
      "Set DEVICE_SYNC_PUBLIC_HOST and DEVICE_SYNC_PUBLIC_PORT together to enable the public callback/webhook listener.",
    );
  }

  return {
    publicHost,
    publicPort,
  };
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

function requireEnv(env: DeviceSyncEnvSource, keys: readonly string[]): string {
  const value = optionalEnv(env, keys);

  if (!value) {
    throw new TypeError(`Missing required environment variable. Set one of: ${keys.join(", ")}`);
  }

  return value;
}

function optionalEnv(env: DeviceSyncEnvSource, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = normalizeString(env[key]);

    if (value) {
      return value;
    }
  }

  return undefined;
}

function parseIntegerEnv(env: DeviceSyncEnvSource, keys: readonly string[]): number | undefined {
  const value = optionalEnv(env, keys);

  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    throw new TypeError(`Environment variable ${keys[0]} must be an integer.`);
  }

  return parsed;
}

function parseCsvEnv(env: DeviceSyncEnvSource, keys: readonly string[]): string[] | undefined {
  const value = optionalEnv(env, keys);

  if (!value) {
    return undefined;
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
