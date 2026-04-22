import {
  garminProviderAdapter,
  ouraProviderAdapter,
  stravaProviderAdapter,
  whoopProviderAdapter,
  type DeviceProviderAdapter,
} from "@murphai/importers";
import {
  GARMIN_DEVICE_PROVIDER_DESCRIPTOR,
  OURA_DEVICE_PROVIDER_DESCRIPTOR,
  STRAVA_DEVICE_PROVIDER_DESCRIPTOR,
  WHOOP_DEVICE_PROVIDER_DESCRIPTOR,
  normalizeDeviceProviderKey,
  type DeviceProviderDescriptor,
} from "@murphai/importers/device-providers/provider-descriptors";

import { createGarminDeviceSyncProvider } from "../providers/garmin.ts";
import { createOuraDeviceSyncProvider } from "../providers/oura.ts";
import { createStravaDeviceSyncProvider } from "../providers/strava.ts";
import { createWhoopDeviceSyncProvider } from "../providers/whoop.ts";

import {
  optionalEnv,
  parseCsvEnv,
  parseIntegerEnv,
  readOptionalCredentialPair,
} from "./provider-config-helpers.ts";
import {
  GARMIN_API_BASE_URL_ENV_KEYS,
  GARMIN_AUTH_BASE_URL_ENV_KEYS,
  GARMIN_BACKFILL_DAYS_ENV_KEYS,
  GARMIN_CLIENT_ID_ENV_KEYS,
  GARMIN_CLIENT_SECRET_ENV_KEYS,
  GARMIN_DEVICE_SYNC_PROVIDER_ENV_SPEC,
  GARMIN_RECONCILE_DAYS_ENV_KEYS,
  GARMIN_RECONCILE_INTERVAL_MS_ENV_KEYS,
  GARMIN_REQUEST_TIMEOUT_MS_ENV_KEYS,
  GARMIN_TOKEN_BASE_URL_ENV_KEYS,
  OURA_API_BASE_URL_ENV_KEYS,
  OURA_AUTH_BASE_URL_ENV_KEYS,
  OURA_BACKFILL_DAYS_ENV_KEYS,
  OURA_CLIENT_ID_ENV_KEYS,
  OURA_CLIENT_SECRET_ENV_KEYS,
  OURA_DEVICE_SYNC_PROVIDER_ENV_SPEC,
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
  STRAVA_DEVICE_SYNC_PROVIDER_ENV_SPEC,
  STRAVA_RECONCILE_DAYS_ENV_KEYS,
  STRAVA_RECONCILE_INTERVAL_MS_ENV_KEYS,
  STRAVA_REQUEST_TIMEOUT_MS_ENV_KEYS,
  STRAVA_SCOPES_ENV_KEYS,
  STRAVA_WEBHOOK_VERIFY_TOKEN_ENV_KEYS,
  WHOOP_BACKFILL_DAYS_ENV_KEYS,
  WHOOP_BASE_URL_ENV_KEYS,
  WHOOP_CLIENT_ID_ENV_KEYS,
  WHOOP_CLIENT_SECRET_ENV_KEYS,
  WHOOP_DEVICE_SYNC_PROVIDER_ENV_SPEC,
  WHOOP_RECONCILE_DAYS_ENV_KEYS,
  WHOOP_RECONCILE_INTERVAL_MS_ENV_KEYS,
  WHOOP_REQUEST_TIMEOUT_MS_ENV_KEYS,
  WHOOP_SCOPES_ENV_KEYS,
  WHOOP_WEBHOOK_TIMESTAMP_TOLERANCE_MS_ENV_KEYS,
  type DeviceSyncProviderEnvSpec,
} from "./provider-env.ts";

import type { DeviceSyncProvider } from "../types.ts";
import type {
  ConfiguredDeviceSyncProviderConfigByKey,
  ConfiguredDeviceSyncProviderKey,
  ConfiguredDeviceSyncProviderPresence,
  DeviceSyncEnvSource,
  SerializableConfiguredDeviceSyncProviderConfigByKey,
} from "./provider-types.ts";

export type SerializableConfigFieldKind = "number" | "string" | "string[]";
export type HostedHintFieldKind = "boolean" | "number" | "string";
export type HostedHintPayloadFieldMap = Readonly<Record<string, HostedHintFieldKind>>;

export interface ConfiguredDeviceSyncProviderCapabilities {
  auth: "oauth2" | null;
  remoteDisconnect: boolean;
  scheduledPoll: boolean;
  tokenRefresh: boolean;
  webhookAdmin: boolean;
  webhookPush: boolean;
}

export interface DeviceSyncConfiguredProviderManifest<
  TProvider extends ConfiguredDeviceSyncProviderKey = ConfiguredDeviceSyncProviderKey,
  TConfig extends ConfiguredDeviceSyncProviderConfigByKey[TProvider] = ConfiguredDeviceSyncProviderConfigByKey[TProvider],
  TSerializableConfig extends SerializableConfiguredDeviceSyncProviderConfigByKey[TProvider] = SerializableConfiguredDeviceSyncProviderConfigByKey[TProvider],
> {
  provider: TProvider;
  capabilities: ConfiguredDeviceSyncProviderCapabilities;
  createProvider(config: TConfig): DeviceSyncProvider;
  descriptor: DeviceProviderDescriptor;
  disallowedSerializableFields?: Readonly<Record<string, string>>;
  env: DeviceSyncProviderEnvSpec;
  hostedHintPayloads?: Readonly<Partial<Record<string, HostedHintPayloadFieldMap>>>;
  importer: DeviceProviderAdapter;
  readConfig(env: DeviceSyncEnvSource): TConfig | null;
  serializableFields: Readonly<Record<Extract<keyof TSerializableConfig, string>, SerializableConfigFieldKind>>;
}

export interface DeviceSyncConfiguredProviderManifestByKey {
  garmin: DeviceSyncConfiguredProviderManifest<
    "garmin",
    ConfiguredDeviceSyncProviderConfigByKey["garmin"],
    SerializableConfiguredDeviceSyncProviderConfigByKey["garmin"]
  >;
  oura: DeviceSyncConfiguredProviderManifest<
    "oura",
    ConfiguredDeviceSyncProviderConfigByKey["oura"],
    SerializableConfiguredDeviceSyncProviderConfigByKey["oura"]
  >;
  whoop: DeviceSyncConfiguredProviderManifest<
    "whoop",
    ConfiguredDeviceSyncProviderConfigByKey["whoop"],
    SerializableConfiguredDeviceSyncProviderConfigByKey["whoop"]
  >;
  strava: DeviceSyncConfiguredProviderManifest<
    "strava",
    ConfiguredDeviceSyncProviderConfigByKey["strava"],
    SerializableConfiguredDeviceSyncProviderConfigByKey["strava"]
  >;
}

const DEFAULT_DISALLOWED_SERIALIZABLE_FIELDS = Object.freeze({
  fetchImpl: "is not supported in serialized runtime config.",
});

const GARMIN_DEVICE_SYNC_PROVIDER_MANIFEST = defineConfiguredDeviceSyncProviderManifest<
  "garmin",
  ConfiguredDeviceSyncProviderConfigByKey["garmin"],
  SerializableConfiguredDeviceSyncProviderConfigByKey["garmin"]
>({
  provider: "garmin",
  descriptor: GARMIN_DEVICE_PROVIDER_DESCRIPTOR,
  importer: garminProviderAdapter,
  env: GARMIN_DEVICE_SYNC_PROVIDER_ENV_SPEC,
  readConfig(env) {
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
  },
  createProvider: createGarminDeviceSyncProvider,
  serializableFields: {
    apiBaseUrl: "string",
    authBaseUrl: "string",
    backfillDays: "number",
    clientId: "string",
    clientSecret: "string",
    reconcileDays: "number",
    reconcileIntervalMs: "number",
    requestTimeoutMs: "number",
    tokenBaseUrl: "string",
  },
  disallowedSerializableFields: DEFAULT_DISALLOWED_SERIALIZABLE_FIELDS,
  hostedHintPayloads: {
    backfill: {
      includeProfile: "boolean",
      windowEnd: "string",
      windowStart: "string",
    },
    reconcile: {
      includeProfile: "boolean",
      windowEnd: "string",
      windowStart: "string",
    },
  },
});

const OURA_DEVICE_SYNC_PROVIDER_MANIFEST = defineConfiguredDeviceSyncProviderManifest<
  "oura",
  ConfiguredDeviceSyncProviderConfigByKey["oura"],
  SerializableConfiguredDeviceSyncProviderConfigByKey["oura"]
>({
  provider: "oura",
  descriptor: OURA_DEVICE_PROVIDER_DESCRIPTOR,
  importer: ouraProviderAdapter,
  env: OURA_DEVICE_SYNC_PROVIDER_ENV_SPEC,
  readConfig(env) {
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
  },
  createProvider: createOuraDeviceSyncProvider,
  serializableFields: {
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
  disallowedSerializableFields: {
    ...DEFAULT_DISALLOWED_SERIALIZABLE_FIELDS,
    webhookVerificationToken:
      "is a provider-owned admin secret and is not supported in serialized runtime config.",
  },
  hostedHintPayloads: {
    backfill: {
      includePersonalInfo: "boolean",
      windowEnd: "string",
      windowStart: "string",
    },
    reconcile: {
      includePersonalInfo: "boolean",
      windowEnd: "string",
      windowStart: "string",
    },
    resource: {
      dataType: "string",
      includePersonalInfo: "boolean",
      objectId: "string",
      occurredAt: "string",
      windowEnd: "string",
      windowStart: "string",
    },
    delete: {
      dataType: "string",
      objectId: "string",
      occurredAt: "string",
      sourceEventType: "string",
    },
  },
});

const WHOOP_DEVICE_SYNC_PROVIDER_MANIFEST = defineConfiguredDeviceSyncProviderManifest<
  "whoop",
  ConfiguredDeviceSyncProviderConfigByKey["whoop"],
  SerializableConfiguredDeviceSyncProviderConfigByKey["whoop"]
>({
  provider: "whoop",
  descriptor: WHOOP_DEVICE_PROVIDER_DESCRIPTOR,
  importer: whoopProviderAdapter,
  env: WHOOP_DEVICE_SYNC_PROVIDER_ENV_SPEC,
  readConfig(env) {
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
  },
  createProvider: createWhoopDeviceSyncProvider,
  serializableFields: {
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
  disallowedSerializableFields: DEFAULT_DISALLOWED_SERIALIZABLE_FIELDS,
  hostedHintPayloads: {
    backfill: {
      windowEnd: "string",
      windowStart: "string",
    },
    reconcile: {
      windowEnd: "string",
      windowStart: "string",
    },
    resource: {
      eventType: "string",
      occurredAt: "string",
      resourceId: "string",
      resourceType: "string",
    },
    delete: {
      eventType: "string",
      occurredAt: "string",
      resourceId: "string",
      resourceType: "string",
    },
  },
});

const STRAVA_DEVICE_SYNC_PROVIDER_MANIFEST = defineConfiguredDeviceSyncProviderManifest<
  "strava",
  ConfiguredDeviceSyncProviderConfigByKey["strava"],
  SerializableConfiguredDeviceSyncProviderConfigByKey["strava"]
>({
  provider: "strava",
  descriptor: STRAVA_DEVICE_PROVIDER_DESCRIPTOR,
  importer: stravaProviderAdapter,
  env: STRAVA_DEVICE_SYNC_PROVIDER_ENV_SPEC,
  readConfig(env) {
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
  },
  createProvider: createStravaDeviceSyncProvider,
  serializableFields: {
    apiBaseUrl: "string",
    authBaseUrl: "string",
    backfillDays: "number",
    clientId: "string",
    clientSecret: "string",
    reconcileDays: "number",
    reconcileIntervalMs: "number",
    requestTimeoutMs: "number",
    scopes: "string[]",
  },
  disallowedSerializableFields: {
    ...DEFAULT_DISALLOWED_SERIALIZABLE_FIELDS,
    webhookVerifyToken:
      "is a provider-owned admin secret and is not supported in serialized runtime config.",
  },
  hostedHintPayloads: {
    backfill: {
      windowEnd: "string",
      windowStart: "string",
    },
    reconcile: {
      windowEnd: "string",
      windowStart: "string",
    },
    resource: {
      eventType: "string",
      occurredAt: "string",
      resourceId: "string",
      resourceType: "string",
    },
    delete: {
      eventType: "string",
      occurredAt: "string",
      resourceId: "string",
      resourceType: "string",
    },
    deauthorize: {
      eventType: "string",
      occurredAt: "string",
      resourceId: "string",
      resourceType: "string",
    },
  },
});

export const deviceSyncProviderManifestByKey = Object.freeze({
  garmin: GARMIN_DEVICE_SYNC_PROVIDER_MANIFEST,
  oura: OURA_DEVICE_SYNC_PROVIDER_MANIFEST,
  whoop: WHOOP_DEVICE_SYNC_PROVIDER_MANIFEST,
  strava: STRAVA_DEVICE_SYNC_PROVIDER_MANIFEST,
} as const satisfies DeviceSyncConfiguredProviderManifestByKey);

export const configuredDeviceSyncProviderKeys = Object.freeze(
  Object.keys(deviceSyncProviderManifestByKey) as ConfiguredDeviceSyncProviderKey[],
);

export const deviceSyncProviderManifests = Object.freeze(
  configuredDeviceSyncProviderKeys.map((provider) => deviceSyncProviderManifestByKey[provider]),
);

export const deviceSyncProviderRuntimeSecretEnvKeys = Object.freeze(
  uniqueDeviceSyncProviderEnvKeys(
    deviceSyncProviderManifests.flatMap((manifest) => manifest.env.secretKeys),
  ),
);

export const deviceSyncProviderRuntimeVariableEnvKeys = Object.freeze(
  uniqueDeviceSyncProviderEnvKeys(
    deviceSyncProviderManifests.flatMap((manifest) => manifest.env.variableKeys),
  ),
);

export function getConfiguredDeviceSyncProviderManifest<
  TProvider extends ConfiguredDeviceSyncProviderKey,
>(provider: TProvider): DeviceSyncConfiguredProviderManifestByKey[TProvider] {
  return deviceSyncProviderManifestByKey[provider];
}

export function resolveConfiguredDeviceSyncProviderManifest(
  provider: string,
): DeviceSyncConfiguredProviderManifest | undefined {
  const key = normalizeDeviceProviderKey(provider);

  if (!key || !isConfiguredDeviceSyncProviderKey(key)) {
    return undefined;
  }

  return deviceSyncProviderManifestByKey[key];
}

export function requireConfiguredDeviceSyncProviderManifest(
  provider: string,
): DeviceSyncConfiguredProviderManifest {
  const manifest = resolveConfiguredDeviceSyncProviderManifest(provider);

  if (!manifest) {
    throw new TypeError(`Unsupported device-sync provider: ${provider}`);
  }

  return manifest;
}

export function listConfiguredDeviceSyncProviderNames(
  configs: ConfiguredDeviceSyncProviderPresence,
): ConfiguredDeviceSyncProviderKey[] {
  return configuredDeviceSyncProviderKeys.filter((provider) => configs[provider] !== undefined);
}

export function listConfiguredDeviceSyncProviderManifests(
  configs: ConfiguredDeviceSyncProviderPresence,
): DeviceSyncConfiguredProviderManifest[] {
  return listConfiguredDeviceSyncProviderNames(configs).map(
    (provider) => deviceSyncProviderManifestByKey[provider],
  );
}

function defineConfiguredDeviceSyncProviderManifest<
  TProvider extends ConfiguredDeviceSyncProviderKey,
  TConfig extends ConfiguredDeviceSyncProviderConfigByKey[TProvider],
  TSerializableConfig extends SerializableConfiguredDeviceSyncProviderConfigByKey[TProvider],
>(
  input: Omit<
    DeviceSyncConfiguredProviderManifest<TProvider, TConfig, TSerializableConfig>,
    "capabilities"
  >,
): DeviceSyncConfiguredProviderManifest<TProvider, TConfig, TSerializableConfig> {
  return Object.freeze({
    ...input,
    capabilities: Object.freeze(deriveConfiguredDeviceSyncProviderCapabilities(input.descriptor)),
    disallowedSerializableFields: input.disallowedSerializableFields
      ? Object.freeze({ ...input.disallowedSerializableFields })
      : undefined,
    env: freezeDeviceSyncProviderEnvSpec(input.env),
    hostedHintPayloads: input.hostedHintPayloads
      ? freezeHostedHintPayloads(input.hostedHintPayloads)
      : undefined,
    serializableFields: Object.freeze({ ...input.serializableFields }),
  });
}

function deriveConfiguredDeviceSyncProviderCapabilities(
  descriptor: DeviceProviderDescriptor,
): ConfiguredDeviceSyncProviderCapabilities {
  return {
    auth: descriptor.transportModes.includes("oauth_callback") ? "oauth2" : null,
    remoteDisconnect: Boolean(descriptor.sync?.supportsRemoteDisconnect),
    scheduledPoll: descriptor.transportModes.includes("scheduled_poll"),
    tokenRefresh: Boolean(descriptor.sync?.supportsTokenRefresh),
    webhookAdmin: Boolean(descriptor.webhook?.supportsAdmin),
    webhookPush: descriptor.transportModes.includes("webhook_push"),
  };
}

function isConfiguredDeviceSyncProviderKey(
  value: string,
): value is ConfiguredDeviceSyncProviderKey {
  return Object.prototype.hasOwnProperty.call(deviceSyncProviderManifestByKey, value);
}

function freezeDeviceSyncProviderEnvSpec(env: DeviceSyncProviderEnvSpec): DeviceSyncProviderEnvSpec {
  return Object.freeze({
    configKeys: Object.freeze([...env.configKeys]),
    secretKeys: Object.freeze([...env.secretKeys]),
    variableKeys: Object.freeze([...env.variableKeys]),
  });
}

function freezeHostedHintPayloads(
  hostedHintPayloads: Readonly<Partial<Record<string, HostedHintPayloadFieldMap>>>,
): Readonly<Partial<Record<string, HostedHintPayloadFieldMap>>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(hostedHintPayloads).map(([kind, fields]) => [
        kind,
        Object.freeze({ ...fields }),
      ]),
    ),
  );
}

function uniqueDeviceSyncProviderEnvKeys(keys: readonly string[]): string[] {
  return [...new Set(keys)];
}
