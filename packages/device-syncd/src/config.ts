import { createWhoopDeviceSyncProvider } from "./providers/whoop.js";
import { normalizeString } from "./shared.js";

import type { DeviceSyncHttpConfig, DeviceSyncLogger, DeviceSyncServiceConfig } from "./types.js";
import type { CreateDeviceSyncServiceInput } from "./service.js";

export interface LoadedDeviceSyncEnvironment {
  service: CreateDeviceSyncServiceInput;
  http: DeviceSyncHttpConfig;
}

export function loadDeviceSyncEnvironment(env: NodeJS.ProcessEnv = process.env): LoadedDeviceSyncEnvironment {
  const vaultRoot = requireEnv(env, ["HEALTHYBOB_VAULT_ROOT", "HEALTHYBOB_DEVICE_SYNC_VAULT_ROOT"]);
  const publicBaseUrl = requireEnv(env, ["HEALTHYBOB_DEVICE_SYNC_PUBLIC_BASE_URL"]);
  const secret = requireEnv(env, ["HEALTHYBOB_DEVICE_SYNC_SECRET"]);
  const whoopClientId = requireEnv(env, ["HEALTHYBOB_WHOOP_CLIENT_ID"]);
  const whoopClientSecret = requireEnv(env, ["HEALTHYBOB_WHOOP_CLIENT_SECRET"]);
  const logger = createConsoleDeviceSyncLogger();

  const serviceConfig: DeviceSyncServiceConfig = {
    vaultRoot,
    publicBaseUrl,
    allowedReturnOrigins: parseCsvEnv(env, ["HEALTHYBOB_DEVICE_SYNC_ALLOWED_RETURN_ORIGINS"]),
    stateDatabasePath: optionalEnv(env, ["HEALTHYBOB_DEVICE_SYNC_STATE_DB_PATH"]),
    sessionTtlMs: parseIntegerEnv(env, ["HEALTHYBOB_DEVICE_SYNC_SESSION_TTL_MS"]),
    workerLeaseMs: parseIntegerEnv(env, ["HEALTHYBOB_DEVICE_SYNC_WORKER_LEASE_MS"]),
    workerPollMs: parseIntegerEnv(env, ["HEALTHYBOB_DEVICE_SYNC_WORKER_POLL_MS"]),
    workerBatchSize: parseIntegerEnv(env, ["HEALTHYBOB_DEVICE_SYNC_WORKER_BATCH_SIZE"]),
    schedulerPollMs: parseIntegerEnv(env, ["HEALTHYBOB_DEVICE_SYNC_SCHEDULER_POLL_MS"]),
    log: logger,
  };

  return {
    service: {
      secret,
      config: serviceConfig,
      providers: [
        createWhoopDeviceSyncProvider({
          clientId: whoopClientId,
          clientSecret: whoopClientSecret,
          baseUrl: optionalEnv(env, ["HEALTHYBOB_WHOOP_BASE_URL"]),
          scopes: parseCsvEnv(env, ["HEALTHYBOB_WHOOP_SCOPES"]),
          backfillDays: parseIntegerEnv(env, ["HEALTHYBOB_WHOOP_BACKFILL_DAYS"]),
          reconcileDays: parseIntegerEnv(env, ["HEALTHYBOB_WHOOP_RECONCILE_DAYS"]),
          reconcileIntervalMs: parseIntegerEnv(env, ["HEALTHYBOB_WHOOP_RECONCILE_INTERVAL_MS"]),
          webhookTimestampToleranceMs: parseIntegerEnv(env, ["HEALTHYBOB_WHOOP_WEBHOOK_TIMESTAMP_TOLERANCE_MS"]),
          requestTimeoutMs: parseIntegerEnv(env, ["HEALTHYBOB_WHOOP_REQUEST_TIMEOUT_MS"]),
        }),
      ],
    },
    http: {
      host: optionalEnv(env, ["HEALTHYBOB_DEVICE_SYNC_HOST"]) ?? "0.0.0.0",
      port: parseIntegerEnv(env, ["HEALTHYBOB_DEVICE_SYNC_PORT", "PORT"]) ?? 8788,
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
