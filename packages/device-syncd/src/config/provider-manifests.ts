import {
  junctionProviderAdapter,
  ouraProviderAdapter,
  stravaProviderAdapter,
  whoopProviderAdapter,
  type DeviceProviderAdapter,
} from "@murphai/importers";
import {
  normalizeDeviceProviderKey,
  resolveDeviceProviderConnectionDescriptor,
  type DeviceProviderDescriptor,
} from "@murphai/importers/device-providers/provider-descriptors";
import { configuredDeviceSyncProviderDescriptors } from "../configured-provider-descriptors.ts";
import { configuredDeviceSyncProviderCredentialPolicies } from "../provider-credential-policy.ts";
import { configuredDeviceSyncProviderJobDefinitions } from "../provider-job-definitions.ts";

import { createJunctionDeviceSyncProvider } from "../providers/junction.ts";
import { createOuraDeviceSyncProvider } from "../providers/oura.ts";
import { createStravaDeviceSyncProvider } from "../providers/strava.ts";
import { createWhoopDeviceSyncProvider } from "../providers/whoop.ts";
import {
  readConfiguredJunctionDeviceSyncProviderConfig,
  readConfiguredOuraDeviceSyncProviderConfig,
  readConfiguredStravaDeviceSyncProviderConfig,
  readConfiguredWhoopDeviceSyncProviderConfig,
} from "./provider-configs.ts";
import {
  configuredDeviceSyncProviderKeys,
  listConfiguredDeviceSyncProviderNames,
} from "./provider-keys.ts";
import {
  JUNCTION_DEVICE_SYNC_PROVIDER_ENV_SPEC,
  OURA_DEVICE_SYNC_PROVIDER_ENV_SPEC,
  STRAVA_DEVICE_SYNC_PROVIDER_ENV_SPEC,
  WHOOP_DEVICE_SYNC_PROVIDER_ENV_SPEC,
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
import type { DeviceSyncProviderCredentialPolicy } from "../types.ts";
import type { DeviceSyncProviderJobDefinitionMap } from "../provider-job-definitions.ts";

export {
  resolveConfiguredDeviceSyncProviderCredentialPolicy,
  resolveDeviceSyncProviderCredentialPolicy,
} from "../provider-credential-policy.ts";
export {
  getConfiguredDeviceSyncProviderJobDefinition,
  normalizeConfiguredDeviceSyncJobInput,
  normalizeConfiguredDeviceSyncJobRecord,
  shapeConfiguredDeviceSyncHostedHintPayload,
} from "../provider-job-definitions.ts";
export type {
  DeviceSyncJobPayloadFieldKind,
  DeviceSyncJobPayloadFieldSpec,
  DeviceSyncProviderJobDefinition,
  DeviceSyncProviderJobDefinitionMap,
  HostedHintFieldKind,
  HostedHintPayloadFieldMap,
} from "../provider-job-definitions.ts";

export type SerializableConfigFieldKind = "boolean" | "number" | "string" | "string[]";

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

const JUNCTION_DEVICE_SYNC_PROVIDER_MANIFEST = defineConfiguredDeviceSyncProviderManifest<
  "junction",
  ConfiguredDeviceSyncProviderConfigByKey["junction"],
  SerializableConfiguredDeviceSyncProviderConfigByKey["junction"]
>({
  provider: "junction",
  credentialPolicy: configuredDeviceSyncProviderCredentialPolicies.junction,
  descriptor: configuredDeviceSyncProviderDescriptors.junction,
  importer: junctionProviderAdapter,
  env: JUNCTION_DEVICE_SYNC_PROVIDER_ENV_SPEC,
  readConfig: readConfiguredJunctionDeviceSyncProviderConfig,
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
  jobs: configuredDeviceSyncProviderJobDefinitions.junction,
});

const OURA_DEVICE_SYNC_PROVIDER_MANIFEST = defineConfiguredDeviceSyncProviderManifest<
  "oura",
  ConfiguredDeviceSyncProviderConfigByKey["oura"],
  SerializableConfiguredDeviceSyncProviderConfigByKey["oura"]
>({
  provider: "oura",
  credentialPolicy: configuredDeviceSyncProviderCredentialPolicies.oura,
  descriptor: configuredDeviceSyncProviderDescriptors.oura,
  importer: ouraProviderAdapter,
  env: OURA_DEVICE_SYNC_PROVIDER_ENV_SPEC,
  readConfig: readConfiguredOuraDeviceSyncProviderConfig,
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
  jobs: configuredDeviceSyncProviderJobDefinitions.oura,
});

const WHOOP_DEVICE_SYNC_PROVIDER_MANIFEST = defineConfiguredDeviceSyncProviderManifest<
  "whoop",
  ConfiguredDeviceSyncProviderConfigByKey["whoop"],
  SerializableConfiguredDeviceSyncProviderConfigByKey["whoop"]
>({
  provider: "whoop",
  credentialPolicy: configuredDeviceSyncProviderCredentialPolicies.whoop,
  descriptor: configuredDeviceSyncProviderDescriptors.whoop,
  importer: whoopProviderAdapter,
  env: WHOOP_DEVICE_SYNC_PROVIDER_ENV_SPEC,
  readConfig: readConfiguredWhoopDeviceSyncProviderConfig,
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
  jobs: configuredDeviceSyncProviderJobDefinitions.whoop,
});

const STRAVA_DEVICE_SYNC_PROVIDER_MANIFEST = defineConfiguredDeviceSyncProviderManifest<
  "strava",
  ConfiguredDeviceSyncProviderConfigByKey["strava"],
  SerializableConfiguredDeviceSyncProviderConfigByKey["strava"]
>({
  provider: "strava",
  credentialPolicy: configuredDeviceSyncProviderCredentialPolicies.strava,
  descriptor: configuredDeviceSyncProviderDescriptors.strava,
  importer: stravaProviderAdapter,
  env: STRAVA_DEVICE_SYNC_PROVIDER_ENV_SPEC,
  readConfig: readConfiguredStravaDeviceSyncProviderConfig,
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
  jobs: configuredDeviceSyncProviderJobDefinitions.strava,
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
    jobs: input.jobs,
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

function freezeDeviceSyncProviderEnvSpec(env: DeviceSyncProviderEnvSpec): DeviceSyncProviderEnvSpec {
  return Object.freeze({
    configKeys: Object.freeze([...env.configKeys]),
    secretKeys: Object.freeze([...env.secretKeys]),
    variableKeys: Object.freeze([...env.variableKeys]),
  });
}

function uniqueDeviceSyncProviderEnvKeys(keys: readonly string[]): string[] {
  return [...new Set(keys)];
}
