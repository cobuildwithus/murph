import {
  assertListenerPort,
  assertLoopbackListenerHost,
  assertUnbracketedListenerHost,
} from "@murphai/runtime-state";

import {
  DEVICE_SYNC_CONTROL_TOKEN_ENV_KEYS,
  DEVICE_SYNC_SECRET_ENV_KEYS,
} from "./client.ts";

import { createGarminDeviceSyncProvider } from "./providers/garmin.ts";
import { createOuraDeviceSyncProvider } from "./providers/oura.ts";
import { createWhoopDeviceSyncProvider } from "./providers/whoop.ts";
import { createDeviceSyncRegistry } from "./registry.ts";
import { DEFAULT_DEVICE_SYNC_HOST, normalizeString } from "./shared.ts";

import type { GarminDeviceSyncProviderConfig } from "./providers/garmin.ts";
import type { OuraDeviceSyncProviderConfig } from "./providers/oura.ts";
import type { WhoopDeviceSyncProviderConfig } from "./providers/whoop.ts";
import type { CreateDeviceSyncServiceInput } from "./service.ts";
import type {
  DeviceSyncHttpConfig,
  DeviceSyncLogger,
  DeviceSyncProvider,
  DeviceSyncRegistry,
  DeviceSyncServiceConfig,
} from "./types.ts";

export interface LoadedDeviceSyncEnvironment {
  service: CreateDeviceSyncServiceInput;
  http: DeviceSyncHttpConfig;
}

export interface ConfiguredDeviceSyncProviderConfigByKey {
  garmin: GarminDeviceSyncProviderConfig;
  oura: OuraDeviceSyncProviderConfig;
  whoop: WhoopDeviceSyncProviderConfig;
}

export interface SerializableConfiguredDeviceSyncProviderConfigByKey {
  garmin: Omit<GarminDeviceSyncProviderConfig, "fetchImpl">;
  oura: Omit<OuraDeviceSyncProviderConfig, "fetchImpl" | "webhookVerificationToken">;
  whoop: Omit<WhoopDeviceSyncProviderConfig, "fetchImpl">;
}

export type ConfiguredDeviceSyncProviderKey = keyof ConfiguredDeviceSyncProviderConfigByKey;
export type ConfiguredDeviceSyncProviderConfigs = Partial<ConfiguredDeviceSyncProviderConfigByKey>;
export type SerializableConfiguredDeviceSyncProviderConfigs =
  Partial<SerializableConfiguredDeviceSyncProviderConfigByKey>;

type DeviceSyncEnvSource = Readonly<Record<string, string | undefined>>;
type ConfiguredDeviceSyncProviderPresence =
  Partial<Record<ConfiguredDeviceSyncProviderKey, unknown>>;

type ConfiguredDeviceSyncProviderConfigHandler<
  TKey extends ConfiguredDeviceSyncProviderKey,
> = {
  create(config: ConfiguredDeviceSyncProviderConfigByKey[TKey]): DeviceSyncProvider;
  read(env: DeviceSyncEnvSource): ConfiguredDeviceSyncProviderConfigByKey[TKey] | null;
  clone(
    config: ConfiguredDeviceSyncProviderConfigByKey[TKey],
  ): SerializableConfiguredDeviceSyncProviderConfigByKey[TKey];
  parseSerializable(
    value: unknown,
    label: string,
  ): SerializableConfiguredDeviceSyncProviderConfigByKey[TKey];
};

const DEVICE_SYNC_ALLOWED_RETURN_ORIGINS_ENV_KEYS = [
  "DEVICE_SYNC_ALLOWED_RETURN_ORIGINS",
] as const;
const DEVICE_SYNC_HOST_ENV_KEYS = ["DEVICE_SYNC_HOST"] as const;
const DEVICE_SYNC_PORT_ENV_KEYS = ["DEVICE_SYNC_PORT"] as const;
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

const GARMIN_DEVICE_SYNC_PROVIDER_RUNTIME_SECRET_ENV_KEYS = [
  ...GARMIN_CLIENT_ID_ENV_KEYS,
  ...GARMIN_CLIENT_SECRET_ENV_KEYS,
] as const;
const GARMIN_DEVICE_SYNC_PROVIDER_RUNTIME_VARIABLE_ENV_KEYS = [
  ...GARMIN_API_BASE_URL_ENV_KEYS,
  ...GARMIN_AUTH_BASE_URL_ENV_KEYS,
  ...GARMIN_BACKFILL_DAYS_ENV_KEYS,
  ...GARMIN_RECONCILE_DAYS_ENV_KEYS,
  ...GARMIN_RECONCILE_INTERVAL_MS_ENV_KEYS,
  ...GARMIN_REQUEST_TIMEOUT_MS_ENV_KEYS,
  ...GARMIN_TOKEN_BASE_URL_ENV_KEYS,
] as const;
const OURA_DEVICE_SYNC_PROVIDER_RUNTIME_SECRET_ENV_KEYS = [
  ...OURA_CLIENT_ID_ENV_KEYS,
  ...OURA_CLIENT_SECRET_ENV_KEYS,
] as const;
const OURA_DEVICE_SYNC_PROVIDER_RUNTIME_VARIABLE_ENV_KEYS = [
  ...OURA_API_BASE_URL_ENV_KEYS,
  ...OURA_AUTH_BASE_URL_ENV_KEYS,
  ...OURA_BACKFILL_DAYS_ENV_KEYS,
  ...OURA_RECONCILE_DAYS_ENV_KEYS,
  ...OURA_RECONCILE_INTERVAL_MS_ENV_KEYS,
  ...OURA_REQUEST_TIMEOUT_MS_ENV_KEYS,
  ...OURA_SCOPES_ENV_KEYS,
  ...OURA_WEBHOOK_TIMESTAMP_TOLERANCE_MS_ENV_KEYS,
] as const;
const WHOOP_DEVICE_SYNC_PROVIDER_RUNTIME_SECRET_ENV_KEYS = [
  ...WHOOP_CLIENT_ID_ENV_KEYS,
  ...WHOOP_CLIENT_SECRET_ENV_KEYS,
] as const;
const WHOOP_DEVICE_SYNC_PROVIDER_RUNTIME_VARIABLE_ENV_KEYS = [
  ...WHOOP_BACKFILL_DAYS_ENV_KEYS,
  ...WHOOP_BASE_URL_ENV_KEYS,
  ...WHOOP_RECONCILE_DAYS_ENV_KEYS,
  ...WHOOP_RECONCILE_INTERVAL_MS_ENV_KEYS,
  ...WHOOP_REQUEST_TIMEOUT_MS_ENV_KEYS,
  ...WHOOP_SCOPES_ENV_KEYS,
  ...WHOOP_WEBHOOK_TIMESTAMP_TOLERANCE_MS_ENV_KEYS,
] as const;

export const deviceSyncProviderRuntimeSecretEnvKeys = Object.freeze([
  ...GARMIN_DEVICE_SYNC_PROVIDER_RUNTIME_SECRET_ENV_KEYS,
  ...OURA_DEVICE_SYNC_PROVIDER_RUNTIME_SECRET_ENV_KEYS,
  ...WHOOP_DEVICE_SYNC_PROVIDER_RUNTIME_SECRET_ENV_KEYS,
]);

export const deviceSyncProviderRuntimeVariableEnvKeys = Object.freeze([
  ...GARMIN_DEVICE_SYNC_PROVIDER_RUNTIME_VARIABLE_ENV_KEYS,
  ...OURA_DEVICE_SYNC_PROVIDER_RUNTIME_VARIABLE_ENV_KEYS,
  ...WHOOP_DEVICE_SYNC_PROVIDER_RUNTIME_VARIABLE_ENV_KEYS,
]);

export function loadDeviceSyncEnvironment(env: NodeJS.ProcessEnv = process.env): LoadedDeviceSyncEnvironment {
  const vaultRoot = requireEnv(env, DEVICE_SYNC_VAULT_ROOT_ENV_KEYS);
  const publicBaseUrl = requireEnv(env, DEVICE_SYNC_PUBLIC_BASE_URL_ENV_KEYS);
  const secret = requireEnv(env, DEVICE_SYNC_SECRET_ENV_KEYS);
  const controlToken = requireEnv(env, DEVICE_SYNC_CONTROL_TOKEN_ENV_KEYS);
  const logger = createConsoleDeviceSyncLogger();
  const providers = createConfiguredDeviceSyncProviders(env);
  const publicListener = readOptionalPublicListener(env);
  const host = optionalEnv(env, DEVICE_SYNC_HOST_ENV_KEYS) ?? DEFAULT_DEVICE_SYNC_HOST;

  assertLoopbackListenerHost(
    host,
    "DEVICE_SYNC_HOST must be a loopback hostname or address. Use DEVICE_SYNC_PUBLIC_HOST and DEVICE_SYNC_PUBLIC_PORT for externally reachable callback and webhook routes.",
  );

  if (providers.length === 0) {
    throw new TypeError(
      "No device sync providers are configured. Set at least one supported device provider client credential pair before starting device-syncd.",
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
      host,
      port: parsePortEnv(env, DEVICE_SYNC_PORT_ENV_KEYS) ?? 8788,
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

export function createConfiguredDeviceSyncProviders(env: DeviceSyncEnvSource): DeviceSyncProvider[] {
  return createConfiguredDeviceSyncProvidersFromConfigs(
    readConfiguredDeviceSyncProviderConfigs(env),
  );
}

export function createConfiguredDeviceSyncRegistry(
  env: DeviceSyncEnvSource,
): DeviceSyncRegistry {
  return createConfiguredDeviceSyncRegistryFromConfigs(
    readConfiguredDeviceSyncProviderConfigs(env),
  );
}

export function createConfiguredDeviceSyncProvidersFromConfigs(
  configs: ConfiguredDeviceSyncProviderConfigs,
): DeviceSyncProvider[] {
  const providers: DeviceSyncProvider[] = [];

  for (const provider of listConfiguredDeviceSyncProviderNames(configs)) {
    const config = configs[provider];

    if (!config) {
      continue;
    }

    providers.push(createConfiguredDeviceSyncProviderFromConfig(provider, config));
  }

  return providers;
}

export function createConfiguredDeviceSyncRegistryFromConfigs(
  configs: ConfiguredDeviceSyncProviderConfigs,
): DeviceSyncRegistry {
  return createDeviceSyncRegistry(
    createConfiguredDeviceSyncProvidersFromConfigs(configs),
  );
}

export function readConfiguredDeviceSyncProviderConfigs(
  env: DeviceSyncEnvSource,
): ConfiguredDeviceSyncProviderConfigs {
  const configs: ConfiguredDeviceSyncProviderConfigs = {};

  for (const provider of configuredDeviceSyncProviderKeys) {
    const config = configuredDeviceSyncProviderConfigHandlers[provider].read(env);

    if (config) {
      configs[provider] = config as never;
    }
  }

  return configs;
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

const configuredDeviceSyncProviderConfigHandlers: {
  [TKey in ConfiguredDeviceSyncProviderKey]: ConfiguredDeviceSyncProviderConfigHandler<TKey>;
} = {
  garmin: {
    create: createGarminDeviceSyncProvider,
    read: readConfiguredGarminDeviceSyncProviderConfig,
    clone: cloneGarminDeviceSyncProviderConfig,
    parseSerializable: parseSerializableGarminDeviceSyncProviderConfig,
  },
  oura: {
    create: createOuraDeviceSyncProvider,
    read: readConfiguredOuraDeviceSyncProviderConfig,
    clone: cloneOuraDeviceSyncProviderConfig,
    parseSerializable: parseSerializableOuraDeviceSyncProviderConfig,
  },
  whoop: {
    create: createWhoopDeviceSyncProvider,
    read: readConfiguredWhoopDeviceSyncProviderConfig,
    clone: cloneWhoopDeviceSyncProviderConfig,
    parseSerializable: parseSerializableWhoopDeviceSyncProviderConfig,
  },
};

export const configuredDeviceSyncProviderKeys = Object.freeze(
  Object.keys(configuredDeviceSyncProviderConfigHandlers) as ConfiguredDeviceSyncProviderKey[],
);

function createConfiguredDeviceSyncProviderFromConfig(
  provider: ConfiguredDeviceSyncProviderKey,
  config: ConfiguredDeviceSyncProviderConfigByKey[ConfiguredDeviceSyncProviderKey],
): DeviceSyncProvider {
  const handler = configuredDeviceSyncProviderConfigHandlers[provider] as ConfiguredDeviceSyncProviderConfigHandler<ConfiguredDeviceSyncProviderKey>;
  return handler.create(config);
}

function cloneSerializableConfiguredDeviceSyncProviderConfig(
  provider: ConfiguredDeviceSyncProviderKey,
  config: ConfiguredDeviceSyncProviderConfigByKey[ConfiguredDeviceSyncProviderKey],
): ConfiguredDeviceSyncProviderConfigByKey[ConfiguredDeviceSyncProviderKey] {
  const handler = configuredDeviceSyncProviderConfigHandlers[provider] as ConfiguredDeviceSyncProviderConfigHandler<ConfiguredDeviceSyncProviderKey>;
  return handler.clone(config);
}

function parseSerializableConfiguredDeviceSyncProviderConfig(
  provider: ConfiguredDeviceSyncProviderKey,
  value: unknown,
  label: string,
): ConfiguredDeviceSyncProviderConfigByKey[ConfiguredDeviceSyncProviderKey] {
  const handler = configuredDeviceSyncProviderConfigHandlers[provider] as ConfiguredDeviceSyncProviderConfigHandler<ConfiguredDeviceSyncProviderKey>;
  return handler.parseSerializable(value, label);
}

function cloneGarminDeviceSyncProviderConfig(
  config: GarminDeviceSyncProviderConfig,
): SerializableConfiguredDeviceSyncProviderConfigByKey["garmin"] {
  const { fetchImpl: _fetchImpl, ...serializableConfig } = config;

  return {
    ...serializableConfig,
  };
}

function cloneOuraDeviceSyncProviderConfig(
  config: OuraDeviceSyncProviderConfig,
): SerializableConfiguredDeviceSyncProviderConfigByKey["oura"] {
  const {
    fetchImpl: _fetchImpl,
    webhookVerificationToken: _webhookVerificationToken,
    ...serializableConfig
  } = config;

  return {
    ...serializableConfig,
    ...(config.scopes ? { scopes: [...config.scopes] } : {}),
  };
}

function cloneWhoopDeviceSyncProviderConfig(
  config: WhoopDeviceSyncProviderConfig,
): SerializableConfiguredDeviceSyncProviderConfigByKey["whoop"] {
  const { fetchImpl: _fetchImpl, ...serializableConfig } = config;

  return {
    ...serializableConfig,
    ...(config.scopes ? { scopes: [...config.scopes] } : {}),
  };
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

  for (const key of Object.keys(record)) {
    if (!supportedKeys.has(key)) {
      throw new TypeError(`${label}.${key} is not supported in serialized runtime config.`);
    }
  }

  return record;
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

function readOptionalPublicListener(env: NodeJS.ProcessEnv): Pick<DeviceSyncHttpConfig, "publicHost" | "publicPort"> {
  const publicHost = optionalEnv(env, DEVICE_SYNC_PUBLIC_HOST_ENV_KEYS);
  const publicPort = parsePortEnv(env, DEVICE_SYNC_PUBLIC_PORT_ENV_KEYS);

  if (!publicHost && publicPort === undefined) {
    return {};
  }

  if (!publicHost || publicPort === undefined) {
    throw new TypeError(
      "Set DEVICE_SYNC_PUBLIC_HOST and DEVICE_SYNC_PUBLIC_PORT together to enable the public callback/webhook listener.",
    );
  }

  assertUnbracketedListenerHost(
    publicHost,
    "DEVICE_SYNC_PUBLIC_HOST must be a hostname or address without URL bracket syntax. Use ::1, not [::1].",
  );

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

  return parseDecimalInteger(value, keys[0]);
}

function parsePortEnv(env: DeviceSyncEnvSource, keys: readonly string[]): number | undefined {
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

function parseDecimalInteger(value: string, key: string): number {
  if (!/^\d+$/u.test(value)) {
    throw new TypeError(`Environment variable ${key} must be an integer.`);
  }

  return Number.parseInt(value, 10);
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
