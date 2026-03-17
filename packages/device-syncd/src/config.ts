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

const DEVICE_SYNC_PROVIDER_FACTORIES: readonly DeviceSyncProviderFactoryEntry[] = Object.freeze([
  {
    label: "WHOOP",
    clientIdKeys: ["HEALTHYBOB_WHOOP_CLIENT_ID"],
    clientSecretKeys: ["HEALTHYBOB_WHOOP_CLIENT_SECRET"],
    create(env, credentials) {
      return createWhoopDeviceSyncProvider({
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        baseUrl: optionalEnv(env, ["HEALTHYBOB_WHOOP_BASE_URL"]),
        scopes: parseCsvEnv(env, ["HEALTHYBOB_WHOOP_SCOPES"]),
        backfillDays: parseIntegerEnv(env, ["HEALTHYBOB_WHOOP_BACKFILL_DAYS"]),
        reconcileDays: parseIntegerEnv(env, ["HEALTHYBOB_WHOOP_RECONCILE_DAYS"]),
        reconcileIntervalMs: parseIntegerEnv(env, ["HEALTHYBOB_WHOOP_RECONCILE_INTERVAL_MS"]),
        webhookTimestampToleranceMs: parseIntegerEnv(
          env,
          ["HEALTHYBOB_WHOOP_WEBHOOK_TIMESTAMP_TOLERANCE_MS"],
        ),
        requestTimeoutMs: parseIntegerEnv(env, ["HEALTHYBOB_WHOOP_REQUEST_TIMEOUT_MS"]),
      });
    },
  },
  {
    label: "Oura",
    clientIdKeys: ["HEALTHYBOB_OURA_CLIENT_ID"],
    clientSecretKeys: ["HEALTHYBOB_OURA_CLIENT_SECRET"],
    create(env, credentials) {
      return createOuraDeviceSyncProvider({
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        authBaseUrl: optionalEnv(env, ["HEALTHYBOB_OURA_AUTH_BASE_URL"]),
        apiBaseUrl: optionalEnv(env, ["HEALTHYBOB_OURA_API_BASE_URL"]),
        scopes: parseCsvEnv(env, ["HEALTHYBOB_OURA_SCOPES"]),
        backfillDays: parseIntegerEnv(env, ["HEALTHYBOB_OURA_BACKFILL_DAYS"]),
        reconcileDays: parseIntegerEnv(env, ["HEALTHYBOB_OURA_RECONCILE_DAYS"]),
        reconcileIntervalMs: parseIntegerEnv(env, ["HEALTHYBOB_OURA_RECONCILE_INTERVAL_MS"]),
        requestTimeoutMs: parseIntegerEnv(env, ["HEALTHYBOB_OURA_REQUEST_TIMEOUT_MS"]),
      });
    },
  },
]);

export function loadDeviceSyncEnvironment(env: NodeJS.ProcessEnv = process.env): LoadedDeviceSyncEnvironment {
  const vaultRoot = requireEnv(env, ["HEALTHYBOB_VAULT_ROOT", "HEALTHYBOB_DEVICE_SYNC_VAULT_ROOT"]);
  const publicBaseUrl = requireEnv(env, ["HEALTHYBOB_DEVICE_SYNC_PUBLIC_BASE_URL"]);
  const secret = requireEnv(env, ["HEALTHYBOB_DEVICE_SYNC_SECRET"]);
  const controlToken = optionalEnv(env, ["HEALTHYBOB_DEVICE_SYNC_CONTROL_TOKEN"]) ?? secret;
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
      providers,
    },
    http: {
      host: optionalEnv(env, ["HEALTHYBOB_DEVICE_SYNC_HOST"]) ?? DEFAULT_DEVICE_SYNC_HOST,
      port: parseIntegerEnv(env, ["HEALTHYBOB_DEVICE_SYNC_PORT", "PORT"]) ?? 8788,
      controlToken,
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
  const publicHost = optionalEnv(env, ["HEALTHYBOB_DEVICE_SYNC_PUBLIC_HOST"]);
  const publicPort = parseIntegerEnv(env, ["HEALTHYBOB_DEVICE_SYNC_PUBLIC_PORT"]);

  if (!publicHost && publicPort === undefined) {
    return {};
  }

  if (!publicHost || publicPort === undefined) {
    throw new TypeError(
      "Set HEALTHYBOB_DEVICE_SYNC_PUBLIC_HOST and HEALTHYBOB_DEVICE_SYNC_PUBLIC_PORT together to enable the public callback/webhook listener.",
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
