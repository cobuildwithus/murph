import {
  DEVICE_SYNC_SECRET_ENV_KEYS,
  resolveDeviceSyncControlToken,
} from "@healthybob/runtime-state";

import { createOuraDeviceSyncProvider } from "./providers/oura.js";
import { createWhoopDeviceSyncProvider } from "./providers/whoop.js";
import { DEFAULT_DEVICE_SYNC_HOST, normalizeString } from "./shared.js";

import type { CreateDeviceSyncServiceInput } from "./service.js";
import type {
  DeviceSyncHttpConfig,
  DeviceSyncLogger,
  DeviceSyncProvider,
  DeviceSyncServiceConfig,
} from "./types.js";

export interface LoadedDeviceSyncEnvironment {
  service: CreateDeviceSyncServiceInput;
  http: DeviceSyncHttpConfig;
}

interface DeviceSyncProviderFactoryEntry {
  label: string;
  clientIdKeys: readonly string[];
  clientSecretKeys: readonly string[];
  create(env: NodeJS.ProcessEnv, credentials: { clientId: string; clientSecret: string }): DeviceSyncProvider;
}

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
const DEVICE_SYNC_VAULT_ROOT_ENV_KEYS = [
  "DEVICE_SYNC_VAULT_ROOT",
  "VAULT_ROOT",
] as const;
const DEVICE_SYNC_WORKER_BATCH_SIZE_ENV_KEYS = [
  "DEVICE_SYNC_WORKER_BATCH_SIZE",
] as const;
const DEVICE_SYNC_WORKER_LEASE_MS_ENV_KEYS = [
  "DEVICE_SYNC_WORKER_LEASE_MS",
] as const;
const DEVICE_SYNC_WORKER_POLL_MS_ENV_KEYS = [
  "DEVICE_SYNC_WORKER_POLL_MS",
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

const DEVICE_SYNC_PROVIDER_FACTORIES: readonly DeviceSyncProviderFactoryEntry[] = Object.freeze([
  {
    label: "WHOOP",
    clientIdKeys: WHOOP_CLIENT_ID_ENV_KEYS,
    clientSecretKeys: WHOOP_CLIENT_SECRET_ENV_KEYS,
    create(env, credentials) {
      return createWhoopDeviceSyncProvider({
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        baseUrl: optionalEnv(env, WHOOP_BASE_URL_ENV_KEYS),
        scopes: parseCsvEnv(env, WHOOP_SCOPES_ENV_KEYS),
        backfillDays: parseIntegerEnv(env, WHOOP_BACKFILL_DAYS_ENV_KEYS),
        reconcileDays: parseIntegerEnv(env, WHOOP_RECONCILE_DAYS_ENV_KEYS),
        reconcileIntervalMs: parseIntegerEnv(env, WHOOP_RECONCILE_INTERVAL_MS_ENV_KEYS),
        webhookTimestampToleranceMs: parseIntegerEnv(env, WHOOP_WEBHOOK_TIMESTAMP_TOLERANCE_MS_ENV_KEYS),
        requestTimeoutMs: parseIntegerEnv(env, WHOOP_REQUEST_TIMEOUT_MS_ENV_KEYS),
      });
    },
  },
  {
    label: "Oura",
    clientIdKeys: OURA_CLIENT_ID_ENV_KEYS,
    clientSecretKeys: OURA_CLIENT_SECRET_ENV_KEYS,
    create(env, credentials) {
      return createOuraDeviceSyncProvider({
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        authBaseUrl: optionalEnv(env, OURA_AUTH_BASE_URL_ENV_KEYS),
        apiBaseUrl: optionalEnv(env, OURA_API_BASE_URL_ENV_KEYS),
        scopes: parseCsvEnv(env, OURA_SCOPES_ENV_KEYS),
        backfillDays: parseIntegerEnv(env, OURA_BACKFILL_DAYS_ENV_KEYS),
        reconcileDays: parseIntegerEnv(env, OURA_RECONCILE_DAYS_ENV_KEYS),
        reconcileIntervalMs: parseIntegerEnv(env, OURA_RECONCILE_INTERVAL_MS_ENV_KEYS),
        requestTimeoutMs: parseIntegerEnv(env, OURA_REQUEST_TIMEOUT_MS_ENV_KEYS),
      });
    },
  },
]);

export function loadDeviceSyncEnvironment(env: NodeJS.ProcessEnv = process.env): LoadedDeviceSyncEnvironment {
  const vaultRoot = requireEnv(env, DEVICE_SYNC_VAULT_ROOT_ENV_KEYS);
  const publicBaseUrl = requireEnv(env, DEVICE_SYNC_PUBLIC_BASE_URL_ENV_KEYS);
  const secret = requireEnv(env, DEVICE_SYNC_SECRET_ENV_KEYS);
  // Keep DEVICE_SYNC_SECRET as the control-token fallback for local bootstrap
  // compatibility until callers fully migrate to DEVICE_SYNC_CONTROL_TOKEN.
  const controlToken = resolveDeviceSyncControlToken({ env }) ?? secret;
  const logger = createConsoleDeviceSyncLogger();
  const providers = createConfiguredProviders(env);
  const publicListener = readOptionalPublicListener(env);

  if (providers.length === 0) {
    throw new TypeError(
      "No device sync providers are configured. Set WHOOP and/or Oura client credentials before starting device-syncd.",
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

function createConfiguredProviders(env: NodeJS.ProcessEnv): DeviceSyncProvider[] {
  return DEVICE_SYNC_PROVIDER_FACTORIES.flatMap((entry) => {
    const credentials = readOptionalCredentialPair(
      env,
      entry.clientIdKeys,
      entry.clientSecretKeys,
      entry.label,
    );

    return credentials ? [entry.create(env, credentials)] : [];
  });
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
  env: NodeJS.ProcessEnv,
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

function requireEnv(env: NodeJS.ProcessEnv, keys: readonly string[]): string {
  const value = optionalEnv(env, keys);

  if (!value) {
    throw new TypeError(`Missing required environment variable. Set one of: ${keys.join(", ")}`);
  }

  return value;
}

function optionalEnv(env: NodeJS.ProcessEnv, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = normalizeString(env[key]);

    if (value) {
      return value;
    }
  }

  return undefined;
}

function parseIntegerEnv(env: NodeJS.ProcessEnv, keys: readonly string[]): number | undefined {
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

function parseCsvEnv(env: NodeJS.ProcessEnv, keys: readonly string[]): string[] | undefined {
  const value = optionalEnv(env, keys);

  if (!value) {
    return undefined;
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
