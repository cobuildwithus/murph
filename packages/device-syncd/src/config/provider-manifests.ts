import {
  junctionProviderAdapter,
  ouraProviderAdapter,
  stravaProviderAdapter,
  whoopProviderAdapter,
  type DeviceProviderAdapter,
} from "@murphai/importers";
import {
  JUNCTION_DEVICE_PROVIDER_DESCRIPTOR,
  OURA_DEVICE_PROVIDER_DESCRIPTOR,
  STRAVA_DEVICE_PROVIDER_DESCRIPTOR,
  WHOOP_DEVICE_PROVIDER_DESCRIPTOR,
  normalizeDeviceProviderKey,
  resolveDeviceProviderConnectionDescriptor,
  type DeviceProviderDescriptor,
} from "@murphai/importers/device-providers/provider-descriptors";

import {
  createJunctionDeviceSyncProvider,
  JUNCTION_PROVIDER_CONFIG_KEY,
} from "../providers/junction.ts";
import { assertValidJunctionClientConfig } from "../providers/junction-client.ts";
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
  configuredDeviceSyncProviderKeys,
  listConfiguredDeviceSyncProviderNames,
} from "./provider-keys.ts";
import {
  JUNCTION_API_KEY_ENV_KEYS,
  JUNCTION_CLIENT_USER_ID_SECRET_ENV_KEYS,
  JUNCTION_DEVICE_SYNC_PROVIDER_ENV_SPEC,
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
  STRAVA_WEBHOOK_SIGNING_SECRET_ENV_KEYS,
  STRAVA_WEBHOOK_TIMESTAMP_TOLERANCE_MS_ENV_KEYS,
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

import { deviceSyncError } from "../errors.ts";

import type { DeviceSyncJobInput, DeviceSyncJobRecord, DeviceSyncProvider } from "../types.ts";
import type {
  ConfiguredDeviceSyncProviderConfigByKey,
  ConfiguredDeviceSyncProviderKey,
  ConfiguredDeviceSyncProviderPresence,
  DeviceSyncEnvSource,
  SerializableConfiguredDeviceSyncProviderConfigByKey,
} from "./provider-types.ts";
import type { DeviceSyncProviderCredentialPolicy } from "../types.ts";

export type SerializableConfigFieldKind = "boolean" | "number" | "string" | "string[]";
export type DeviceSyncJobPayloadFieldKind = "boolean" | "number" | "string" | "string[]";
export type HostedHintFieldKind = Exclude<DeviceSyncJobPayloadFieldKind, "string[]">;

export interface DeviceSyncJobPayloadFieldSpec {
  kind: DeviceSyncJobPayloadFieldKind;
  includeInHostedHint?: boolean;
  required?: boolean;
}

export interface DeviceSyncProviderJobDefinition {
  payload: Readonly<Record<string, DeviceSyncJobPayloadFieldSpec>>;
}

export type DeviceSyncProviderJobDefinitionMap =
  Readonly<Partial<Record<string, DeviceSyncProviderJobDefinition>>>;

export type HostedHintPayloadFieldMap = Readonly<Record<string, HostedHintFieldKind>>;

export interface ConfiguredDeviceSyncProviderCapabilities {
  remoteDisconnect: boolean;
  scheduledPoll: boolean;
  tokenRefresh: boolean;
  webhookAdmin: boolean;
  webhookPush: boolean;
}

export interface DeviceSyncProviderCatalogEntry {
  provider: ConfiguredDeviceSyncProviderKey;
  displayName: string;
  callbackPath: string | null;
  webhookPath: string | null;
  supportsWebhooks: boolean;
  defaultScopes: string[];
}

export interface DeviceSyncConfiguredProviderManifest<
  TProvider extends ConfiguredDeviceSyncProviderKey = ConfiguredDeviceSyncProviderKey,
  TConfig extends ConfiguredDeviceSyncProviderConfigByKey[TProvider] = ConfiguredDeviceSyncProviderConfigByKey[TProvider],
  TSerializableConfig extends SerializableConfiguredDeviceSyncProviderConfigByKey[TProvider] = SerializableConfiguredDeviceSyncProviderConfigByKey[TProvider],
> {
  provider: TProvider;
  capabilities: ConfiguredDeviceSyncProviderCapabilities;
  credentialPolicy: DeviceSyncProviderCredentialPolicy;
  createProvider(config: TConfig): DeviceSyncProvider;
  descriptor: DeviceProviderDescriptor;
  disallowedSerializableFields?: Readonly<Record<string, string>>;
  env: DeviceSyncProviderEnvSpec;
  importer: DeviceProviderAdapter;
  jobs: DeviceSyncProviderJobDefinitionMap;
  readConfig(env: DeviceSyncEnvSource): TConfig | null;
  serializableFields: Readonly<Record<Extract<keyof TSerializableConfig, string>, SerializableConfigFieldKind>>;
}

export interface DeviceSyncConfiguredProviderManifestByKey {
  junction: DeviceSyncConfiguredProviderManifest<
    "junction",
    ConfiguredDeviceSyncProviderConfigByKey["junction"],
    SerializableConfiguredDeviceSyncProviderConfigByKey["junction"]
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

function booleanJobField(
  options: Pick<DeviceSyncJobPayloadFieldSpec, "includeInHostedHint" | "required"> = {},
): DeviceSyncJobPayloadFieldSpec {
  return {
    kind: "boolean",
    ...options,
  };
}

function stringJobField(
  options: Pick<DeviceSyncJobPayloadFieldSpec, "includeInHostedHint" | "required"> = {},
): DeviceSyncJobPayloadFieldSpec {
  return {
    kind: "string",
    ...options,
  };
}

const JUNCTION_DEVICE_SYNC_PROVIDER_MANIFEST = defineConfiguredDeviceSyncProviderManifest<
  "junction",
  ConfiguredDeviceSyncProviderConfigByKey["junction"],
  SerializableConfiguredDeviceSyncProviderConfigByKey["junction"]
>({
  provider: "junction",
  credentialPolicy: {
    kind: "provider_config",
    providerConfigKey: JUNCTION_PROVIDER_CONFIG_KEY,
  },
  descriptor: JUNCTION_DEVICE_PROVIDER_DESCRIPTOR,
  importer: junctionProviderAdapter,
  env: JUNCTION_DEVICE_SYNC_PROVIDER_ENV_SPEC,
  readConfig(env) {
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
      providerFilter: parseCsvEnv(env, JUNCTION_PROVIDER_FILTER_ENV_KEYS),
      summaryResources: parseCsvEnv(env, JUNCTION_SUMMARY_RESOURCES_ENV_KEYS),
      timeseriesResources: parseCsvEnv(env, JUNCTION_TIMESERIES_RESOURCES_ENV_KEYS),
      summaryBackfillDays: parseIntegerEnv(env, JUNCTION_SUMMARY_BACKFILL_DAYS_ENV_KEYS),
      timeseriesBackfillDays: parseIntegerEnv(env, JUNCTION_TIMESERIES_BACKFILL_DAYS_ENV_KEYS),
      reconcileDays: parseIntegerEnv(env, JUNCTION_RECONCILE_DAYS_ENV_KEYS),
      reconcileIntervalMs: parseIntegerEnv(env, JUNCTION_RECONCILE_INTERVAL_MS_ENV_KEYS),
      requestTimeoutMs: parseIntegerEnv(env, JUNCTION_REQUEST_TIMEOUT_MS_ENV_KEYS),
      webhookSecret,
      webhookTimestampToleranceMs: parseIntegerEnv(env, JUNCTION_WEBHOOK_TIMESTAMP_TOLERANCE_MS_ENV_KEYS),
    };

    assertValidJunctionClientConfig(config);
    return config;
  },
  createProvider: createJunctionDeviceSyncProvider,
  serializableFields: {
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
  disallowedSerializableFields: {
    ...DEFAULT_DISALLOWED_SERIALIZABLE_FIELDS,
    apiKey:
      "is a provider-owned API secret and is not supported in serialized runtime config.",
    clientUserIdSecret:
      "is a provider-owned HMAC secret and is not supported in serialized runtime config.",
    webhookSecret:
      "is a provider-owned webhook secret and is not supported in serialized runtime config.",
  },
  jobs: {
    backfill: {
      payload: {
        windowEnd: stringJobField({ includeInHostedHint: true }),
        windowStart: stringJobField({ includeInHostedHint: true }),
      },
    },
    reconcile: {
      payload: {
        windowEnd: stringJobField({ includeInHostedHint: true }),
        windowStart: stringJobField({ includeInHostedHint: true }),
      },
    },
    resource: {
      payload: {
        eventType: stringJobField({ includeInHostedHint: true }),
        objectId: stringJobField({ includeInHostedHint: true }),
        occurredAt: stringJobField({ includeInHostedHint: true }),
        resource: stringJobField({ includeInHostedHint: true }),
        resourceCategory: stringJobField({ includeInHostedHint: true }),
        sourceProviderSlug: stringJobField({ includeInHostedHint: true }),
        webhookDataJson: stringJobField({ includeInHostedHint: true }),
        windowEnd: stringJobField({ includeInHostedHint: true }),
        windowStart: stringJobField({ includeInHostedHint: true }),
      },
    },
  },
});

const OURA_DEVICE_SYNC_PROVIDER_MANIFEST = defineConfiguredDeviceSyncProviderManifest<
  "oura",
  ConfiguredDeviceSyncProviderConfigByKey["oura"],
  SerializableConfiguredDeviceSyncProviderConfigByKey["oura"]
>({
  provider: "oura",
  credentialPolicy: {
    kind: "oauth_tokens",
  },
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
  jobs: {
    backfill: {
      payload: {
        includePersonalInfo: booleanJobField({ includeInHostedHint: true }),
        windowEnd: stringJobField({ includeInHostedHint: true }),
        windowStart: stringJobField({ includeInHostedHint: true }),
      },
    },
    reconcile: {
      payload: {
        includePersonalInfo: booleanJobField({ includeInHostedHint: true }),
        windowEnd: stringJobField({ includeInHostedHint: true }),
        windowStart: stringJobField({ includeInHostedHint: true }),
      },
    },
    resource: {
      payload: {
        dataType: stringJobField({ includeInHostedHint: true }),
        includePersonalInfo: booleanJobField({ includeInHostedHint: true }),
        objectId: stringJobField({ includeInHostedHint: true }),
        occurredAt: stringJobField({ includeInHostedHint: true }),
        windowEnd: stringJobField({ includeInHostedHint: true }),
        windowStart: stringJobField({ includeInHostedHint: true }),
      },
    },
    delete: {
      payload: {
        dataType: stringJobField({ includeInHostedHint: true, required: true }),
        objectId: stringJobField({ includeInHostedHint: true, required: true }),
        occurredAt: stringJobField({ includeInHostedHint: true }),
        sourceEventType: stringJobField({ includeInHostedHint: true }),
      },
    },
  },
});

const WHOOP_DEVICE_SYNC_PROVIDER_MANIFEST = defineConfiguredDeviceSyncProviderManifest<
  "whoop",
  ConfiguredDeviceSyncProviderConfigByKey["whoop"],
  SerializableConfiguredDeviceSyncProviderConfigByKey["whoop"]
>({
  provider: "whoop",
  credentialPolicy: {
    kind: "oauth_tokens",
  },
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
  jobs: {
    backfill: {
      payload: {
        windowEnd: stringJobField({ includeInHostedHint: true }),
        windowStart: stringJobField({ includeInHostedHint: true }),
      },
    },
    reconcile: {
      payload: {
        windowEnd: stringJobField({ includeInHostedHint: true }),
        windowStart: stringJobField({ includeInHostedHint: true }),
      },
    },
    resource: {
      payload: {
        eventType: stringJobField({ includeInHostedHint: true }),
        occurredAt: stringJobField({ includeInHostedHint: true }),
        resourceId: stringJobField({ includeInHostedHint: true, required: true }),
        resourceType: stringJobField({ includeInHostedHint: true, required: true }),
      },
    },
    delete: {
      payload: {
        eventType: stringJobField({ includeInHostedHint: true }),
        occurredAt: stringJobField({ includeInHostedHint: true }),
        resourceId: stringJobField({ includeInHostedHint: true, required: true }),
        resourceType: stringJobField({ includeInHostedHint: true, required: true }),
      },
    },
  },
});

const STRAVA_DEVICE_SYNC_PROVIDER_MANIFEST = defineConfiguredDeviceSyncProviderManifest<
  "strava",
  ConfiguredDeviceSyncProviderConfigByKey["strava"],
  SerializableConfiguredDeviceSyncProviderConfigByKey["strava"]
>({
  provider: "strava",
  credentialPolicy: {
    kind: "oauth_tokens",
  },
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
      webhookSigningSecret: optionalEnv(env, STRAVA_WEBHOOK_SIGNING_SECRET_ENV_KEYS),
      webhookTimestampToleranceMs: parseIntegerEnv(env, STRAVA_WEBHOOK_TIMESTAMP_TOLERANCE_MS_ENV_KEYS),
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
    webhookTimestampToleranceMs: "number",
  },
  disallowedSerializableFields: {
    ...DEFAULT_DISALLOWED_SERIALIZABLE_FIELDS,
    webhookSigningSecret:
      "is a provider-owned webhook signing secret and is not supported in serialized runtime config.",
    webhookVerifyToken:
      "is a provider-owned admin secret and is not supported in serialized runtime config.",
  },
  jobs: {
    backfill: {
      payload: {
        includeAthlete: booleanJobField(),
        windowEnd: stringJobField({ includeInHostedHint: true }),
        windowKind: stringJobField(),
        windowStart: stringJobField({ includeInHostedHint: true }),
      },
    },
    reconcile: {
      payload: {
        includeAthlete: booleanJobField(),
        windowEnd: stringJobField({ includeInHostedHint: true }),
        windowKind: stringJobField(),
        windowStart: stringJobField({ includeInHostedHint: true }),
      },
    },
    resource: {
      payload: {
        eventType: stringJobField({ includeInHostedHint: true }),
        occurredAt: stringJobField({ includeInHostedHint: true }),
        resourceId: stringJobField({ includeInHostedHint: true, required: true }),
        resourceType: stringJobField({ includeInHostedHint: true, required: true }),
      },
    },
    delete: {
      payload: {
        eventType: stringJobField({ includeInHostedHint: true }),
        occurredAt: stringJobField({ includeInHostedHint: true }),
        resourceId: stringJobField({ includeInHostedHint: true, required: true }),
        resourceType: stringJobField({ includeInHostedHint: true }),
      },
    },
    deauthorize: {
      payload: {
        eventType: stringJobField({ includeInHostedHint: true }),
        occurredAt: stringJobField({ includeInHostedHint: true }),
        resourceId: stringJobField({ includeInHostedHint: true, required: true }),
        resourceType: stringJobField({ includeInHostedHint: true, required: true }),
      },
    },
  },
});

export const deviceSyncProviderManifestByKey = Object.freeze({
  junction: JUNCTION_DEVICE_SYNC_PROVIDER_MANIFEST,
  oura: OURA_DEVICE_SYNC_PROVIDER_MANIFEST,
  whoop: WHOOP_DEVICE_SYNC_PROVIDER_MANIFEST,
  strava: STRAVA_DEVICE_SYNC_PROVIDER_MANIFEST,
} as const satisfies DeviceSyncConfiguredProviderManifestByKey);

export { configuredDeviceSyncProviderKeys };

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

export function resolveDeviceSyncProviderCredentialPolicy(
  provider: Pick<DeviceSyncProvider, "credentialPolicy" | "descriptor" | "provider">,
): DeviceSyncProviderCredentialPolicy {
  const manifest = resolveConfiguredDeviceSyncProviderManifest(provider.provider);
  if (manifest) {
    return manifest.credentialPolicy;
  }

  if (provider.credentialPolicy) {
    return provider.credentialPolicy;
  }

  return provider.descriptor.oauth
    ? { kind: "oauth_tokens" }
    : { kind: "none" };
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

export { listConfiguredDeviceSyncProviderNames };

export function listConfiguredDeviceSyncProviderManifests(
  configs: ConfiguredDeviceSyncProviderPresence,
): DeviceSyncConfiguredProviderManifest[] {
  return listConfiguredDeviceSyncProviderNames(configs).map(
    (provider) => deviceSyncProviderManifestByKey[provider],
  );
}

export function listDeviceSyncProviderCatalog(): DeviceSyncProviderCatalogEntry[] {
  return deviceSyncProviderManifests.map((manifest) => {
    const connection = resolveDeviceProviderConnectionDescriptor(manifest.descriptor);

    return {
      provider: manifest.provider,
      displayName: manifest.descriptor.displayName,
      callbackPath: connection.callbackPath ?? null,
      webhookPath: manifest.descriptor.webhook?.path ?? null,
      supportsWebhooks: manifest.capabilities.webhookPush,
      defaultScopes: [...(connection.defaultScopes ?? [])],
    };
  });
}

export function getConfiguredDeviceSyncProviderJobDefinition(
  provider: string,
  kind: string,
): DeviceSyncProviderJobDefinition | undefined {
  const manifest = resolveConfiguredDeviceSyncProviderManifest(provider);
  return manifest?.jobs[kind];
}

export function normalizeConfiguredDeviceSyncJobInput(
  provider: string,
  job: DeviceSyncJobInput,
  context: string,
): DeviceSyncJobInput {
  return {
    ...job,
    payload: normalizeConfiguredDeviceSyncJobPayload(provider, job.kind, job.payload, context),
  };
}

export function normalizeConfiguredDeviceSyncJobRecord(
  provider: string,
  job: DeviceSyncJobRecord,
  context: string,
): DeviceSyncJobRecord {
  return {
    ...job,
    payload: normalizeConfiguredDeviceSyncJobPayload(provider, job.kind, job.payload, context),
  };
}

export function shapeConfiguredDeviceSyncHostedHintPayload(
  provider: string,
  job: Pick<DeviceSyncJobInput, "kind" | "payload">,
): Record<string, unknown> {
  const definition = getConfiguredDeviceSyncProviderJobDefinition(provider, job.kind);

  if (!definition) {
    return {};
  }

  return pickConfiguredDeviceSyncHostedHintPayload(
    normalizeJobPayloadRecord(job.payload, `${provider} ${job.kind} hosted hint payload`),
    definition,
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
    jobs: freezeConfiguredDeviceSyncProviderJobDefinitions(input.jobs),
    serializableFields: Object.freeze({ ...input.serializableFields }),
  });
}

function deriveConfiguredDeviceSyncProviderCapabilities(
  descriptor: DeviceProviderDescriptor,
): ConfiguredDeviceSyncProviderCapabilities {
  return {
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

function freezeDeviceSyncProviderEnvSpec(env: DeviceSyncProviderEnvSpec): DeviceSyncProviderEnvSpec {
  return Object.freeze({
    configKeys: Object.freeze([...env.configKeys]),
    secretKeys: Object.freeze([...env.secretKeys]),
    variableKeys: Object.freeze([...env.variableKeys]),
  });
}

function freezeConfiguredDeviceSyncProviderJobDefinitions(
  definitions: DeviceSyncProviderJobDefinitionMap,
): DeviceSyncProviderJobDefinitionMap {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(definitions).flatMap(([kind, definition]) =>
        definition
          ? [
              [
                kind,
                Object.freeze({
                  payload: Object.freeze(
                    Object.fromEntries(
                      Object.entries(definition.payload).map(([field, spec]) => [
                        field,
                        Object.freeze({ ...spec }),
                      ]),
                    ),
                  ),
                }),
              ] as const,
            ]
          : [],
      ),
    ),
  );
}

function normalizeConfiguredDeviceSyncJobPayload(
  provider: string,
  kind: string,
  payload: Record<string, unknown> | undefined,
  context: string,
): Record<string, unknown> {
  const normalizedPayload = normalizeJobPayloadRecord(payload, `${provider} ${kind} ${context} payload`);
  const manifest = resolveConfiguredDeviceSyncProviderManifest(provider);

  if (!manifest) {
    return normalizedPayload;
  }

  const definition = manifest.jobs[kind];

  if (!definition) {
    throw deviceSyncError({
      code: "DEVICE_SYNC_JOB_PAYLOAD_INVALID",
      message: `Device sync provider ${provider} job kind ${kind} is not declared in the provider manifest.`,
      retryable: false,
    });
  }

  const output: Record<string, unknown> = {};

  for (const key of Object.keys(normalizedPayload)) {
    if (!Object.prototype.hasOwnProperty.call(definition.payload, key)) {
      throw deviceSyncError({
        code: "DEVICE_SYNC_JOB_PAYLOAD_INVALID",
        message: `Device sync provider ${provider} job ${kind} ${context} payload field ${key} is not declared in the provider manifest.`,
        retryable: false,
      });
    }
  }

  for (const [field, spec] of Object.entries(definition.payload)) {
    const value = normalizedPayload[field];

    if (value === undefined) {
      if (spec.required) {
        throw deviceSyncError({
          code: "DEVICE_SYNC_JOB_PAYLOAD_INVALID",
          message: `Device sync provider ${provider} job ${kind} ${context} payload field ${field} is required.`,
          retryable: false,
        });
      }

      continue;
    }

    if (!matchesConfiguredDeviceSyncJobFieldKind(value, spec.kind)) {
      throw deviceSyncError({
        code: "DEVICE_SYNC_JOB_PAYLOAD_INVALID",
        message:
          `Device sync provider ${provider} job ${kind} ${context} payload field ${field} must be ${describeConfiguredDeviceSyncJobFieldKind(spec.kind)}.`,
        retryable: false,
      });
    }

    output[field] = spec.kind === "string[]" && Array.isArray(value) ? [...value] : value;
  }

  return output;
}

function normalizeJobPayloadRecord(
  payload: Record<string, unknown> | undefined,
  context: string,
): Record<string, unknown> {
  if (payload === undefined) {
    return {};
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw deviceSyncError({
      code: "DEVICE_SYNC_JOB_PAYLOAD_INVALID",
      message: `Device sync ${context} must be an object payload.`,
      retryable: false,
    });
  }

  return { ...payload };
}

function matchesConfiguredDeviceSyncJobFieldKind(
  value: unknown,
  kind: DeviceSyncJobPayloadFieldKind,
): value is boolean | number | string | string[] {
  switch (kind) {
    case "boolean":
      return value === true || value === false;
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "string":
      return typeof value === "string";
    case "string[]":
      return Array.isArray(value) && value.every((entry) => typeof entry === "string");
  }
}

function describeConfiguredDeviceSyncJobFieldKind(kind: DeviceSyncJobPayloadFieldKind): string {
  return kind === "string[]" ? "an array of strings" : `a ${kind}`;
}

function pickConfiguredDeviceSyncHostedHintPayload(
  payload: Record<string, unknown>,
  definition: DeviceSyncProviderJobDefinition,
): Record<string, unknown> {
  const shaped: Record<string, unknown> = {};

  for (const [field, spec] of Object.entries(definition.payload)) {
    if (!spec.includeInHostedHint || spec.kind === "string[]") {
      continue;
    }

    const value = payload[field];

    if (spec.kind === "string" && value === "") {
      continue;
    }

    if (matchesConfiguredDeviceSyncJobFieldKind(value, spec.kind)) {
      shaped[field] = value;
    }
  }

  return shaped;
}

function uniqueDeviceSyncProviderEnvKeys(keys: readonly string[]): string[] {
  return [...new Set(keys)];
}
