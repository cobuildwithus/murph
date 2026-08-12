import {
  JUNCTION_ALLOWED_SUMMARY_RESOURCES,
  JUNCTION_ALLOWED_TIMESERIES_RESOURCES,
  JUNCTION_DEFAULT_SUMMARY_RESOURCES,
  JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
  JUNCTION_KNOWN_TIMESERIES_RESOURCES,
  normalizeJunctionResourceName,
} from "@murphai/importers/device-providers/junction-resources";
import {
  JUNCTION_DEVICE_PROVIDER_DESCRIPTOR,
  OURA_DEVICE_PROVIDER_DESCRIPTOR,
  STRAVA_DEVICE_PROVIDER_DESCRIPTOR,
  WHOOP_DEVICE_PROVIDER_DESCRIPTOR,
  normalizeDeviceProviderKey,
  requireDeviceProviderOAuthDescriptor,
  requireDeviceProviderSyncDescriptor,
  resolveDeviceProviderConnectionDescriptor,
  type DeviceProviderDescriptor,
} from "@murphai/importers/device-providers/provider-descriptors";

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
import {
  JUNCTION_SERIALIZABLE_PROVIDER_CONFIG_SCHEMA,
  OURA_SERIALIZABLE_PROVIDER_CONFIG_SCHEMA,
  STRAVA_SERIALIZABLE_PROVIDER_CONFIG_SCHEMA,
  WHOOP_SERIALIZABLE_PROVIDER_CONFIG_SCHEMA,
  type SerializableConfigFieldKind,
} from "./serializable-provider-configs.ts";
import { normalizeJunctionProviderFilter } from "./junction-connect-sources.ts";
import { normalizeString } from "../shared.ts";

import type {
  ConfiguredDeviceSyncProviderConfigByKey,
  ConfiguredDeviceSyncProviderKey,
  ConfiguredDeviceSyncProviderPresence,
  DeviceSyncEnvSource,
  JunctionDeviceSyncProviderConfig,
  OuraDeviceSyncProviderConfig,
  SerializableConfiguredDeviceSyncProviderConfigByKey,
  StravaDeviceSyncProviderConfig,
  WhoopDeviceSyncProviderConfig,
} from "./provider-types.ts";
import type { DeviceSyncProviderCredentialPolicy } from "../types.ts";

export type { SerializableConfigFieldKind } from "./serializable-provider-configs.ts";
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

type DeviceSyncJobPayloadFieldValue<Spec extends DeviceSyncJobPayloadFieldSpec> =
  Spec["kind"] extends "boolean" ? boolean
    : Spec["kind"] extends "number" ? number
      : Spec["kind"] extends "string" ? string
        : Spec["kind"] extends "string[]" ? string[]
          : never;

/**
 * Payload type derived from a manifest job definition. Producers that
 * construct jobs must type their payloads with this so an undeclared field is
 * a typecheck error instead of a runtime DEVICE_SYNC_JOB_PAYLOAD_INVALID at
 * the enqueue boundary.
 */
export type DeviceSyncJobPayloadOf<Definition extends DeviceSyncProviderJobDefinition> =
  & {
    [Field in keyof Definition["payload"] as Definition["payload"][Field] extends { required: true }
      ? Field
      : never]: DeviceSyncJobPayloadFieldValue<Definition["payload"][Field]>;
  }
  & {
    [Field in keyof Definition["payload"] as Definition["payload"][Field] extends { required: true }
      ? never
      : Field]?: DeviceSyncJobPayloadFieldValue<Definition["payload"][Field]>;
  };

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
  descriptor: DeviceProviderDescriptor;
  disallowedSerializableFields?: Readonly<Record<string, string>>;
  env: DeviceSyncProviderEnvSpec;
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

const OURA_OAUTH = requireDeviceProviderOAuthDescriptor(OURA_DEVICE_PROVIDER_DESCRIPTOR);
const OURA_SYNC = requireDeviceProviderSyncDescriptor(OURA_DEVICE_PROVIDER_DESCRIPTOR);
const OURA_DEFAULT_SCOPES = Object.freeze([...OURA_OAUTH.defaultScopes]);

const STRAVA_OAUTH = requireDeviceProviderOAuthDescriptor(STRAVA_DEVICE_PROVIDER_DESCRIPTOR);
const STRAVA_SYNC = requireDeviceProviderSyncDescriptor(STRAVA_DEVICE_PROVIDER_DESCRIPTOR);
const STRAVA_DEFAULT_SCOPES = Object.freeze([...STRAVA_OAUTH.defaultScopes]);

const WHOOP_OAUTH = requireDeviceProviderOAuthDescriptor(WHOOP_DEVICE_PROVIDER_DESCRIPTOR);
const WHOOP_SYNC = requireDeviceProviderSyncDescriptor(WHOOP_DEVICE_PROVIDER_DESCRIPTOR);
const WHOOP_DEFAULT_SCOPES = Object.freeze([...WHOOP_OAUTH.defaultScopes]);
const WHOOP_REQUIRED_SCOPES = Object.freeze(["offline", "read:profile"] as const);

const JUNCTION_SYNC = requireDeviceProviderSyncDescriptor(
  JUNCTION_DEVICE_PROVIDER_DESCRIPTOR,
);

const JUNCTION_DEVICE_SYNC_JOB_DEFINITIONS = {
  backfill: {
    payload: {
      emptyBackfillAttempts: numberJobField({ includeInHostedHint: true }),
      sourceProviderSlug: stringJobField({ includeInHostedHint: true }),
      timeseriesCursor: stringJobField({ includeInHostedHint: true }),
      windowEnd: stringJobField({ includeInHostedHint: true }),
      windowStart: stringJobField({ includeInHostedHint: true }),
    },
  },
  reconcile: {
    payload: {
      sourceProviderSlug: stringJobField({ includeInHostedHint: true }),
      windowEnd: stringJobField({ includeInHostedHint: true }),
      windowStart: stringJobField({ includeInHostedHint: true }),
    },
  },
  push_source_recovery: {
    payload: {
      silentSinceAt: stringJobField({ includeInHostedHint: true }),
      sourceProviderSlug: stringJobField({ includeInHostedHint: true }),
    },
  },
  resource: {
    payload: {
      companionAdmissionId: stringJobField({ includeInHostedHint: true }),
      companionObservationJson: stringJobField({ includeInHostedHint: true }),
      emptyBackfillAttempts: numberJobField({ includeInHostedHint: true }),
      eventType: stringJobField({ includeInHostedHint: true }),
      historicalBackfill: booleanJobField({ includeInHostedHint: true }),
      historicalBackfillVersion: numberJobField({ includeInHostedHint: true }),
      historicalProviderRecordsSeen: booleanJobField({ includeInHostedHint: true }),
      historicalRecordsSeen: booleanJobField({ includeInHostedHint: true }),
      historicalUnresolvedProviderRecordIdentitiesJson: stringJobField({ includeInHostedHint: true }),
      historicalUnresolvedProviderRecordCount: numberJobField({ includeInHostedHint: true }),
      historicalWindowStart: stringJobField({ includeInHostedHint: true }),
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
} satisfies DeviceSyncProviderJobDefinitionMap;

export type JunctionDeviceSyncJobPayloads = {
  [Kind in keyof typeof JUNCTION_DEVICE_SYNC_JOB_DEFINITIONS]: DeviceSyncJobPayloadOf<
    (typeof JUNCTION_DEVICE_SYNC_JOB_DEFINITIONS)[Kind]
  >;
};

const JUNCTION_DEVICE_SYNC_PROVIDER_MANIFEST = defineConfiguredDeviceSyncProviderManifest<
  "junction",
  ConfiguredDeviceSyncProviderConfigByKey["junction"],
  SerializableConfiguredDeviceSyncProviderConfigByKey["junction"]
>({
  provider: "junction",
  credentialPolicy: {
    kind: "provider_config",
    providerConfigKey: "junction",
  },
  descriptor: JUNCTION_DEVICE_PROVIDER_DESCRIPTOR,
  env: JUNCTION_DEVICE_SYNC_PROVIDER_ENV_SPEC,
  readConfig: readConfiguredJunctionDeviceSyncProviderConfig,
  serializableFields: JUNCTION_SERIALIZABLE_PROVIDER_CONFIG_SCHEMA.serializableFields,
  disallowedSerializableFields:
    JUNCTION_SERIALIZABLE_PROVIDER_CONFIG_SCHEMA.disallowedSerializableFields,
  jobs: freezeConfiguredDeviceSyncProviderJobDefinitions(JUNCTION_DEVICE_SYNC_JOB_DEFINITIONS),
});

const OURA_DEVICE_SYNC_JOB_DEFINITIONS = {
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
} satisfies DeviceSyncProviderJobDefinitionMap;

export type OuraDeviceSyncJobPayloads = {
  [Kind in keyof typeof OURA_DEVICE_SYNC_JOB_DEFINITIONS]: DeviceSyncJobPayloadOf<
    (typeof OURA_DEVICE_SYNC_JOB_DEFINITIONS)[Kind]
  >;
};

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
  env: OURA_DEVICE_SYNC_PROVIDER_ENV_SPEC,
  readConfig: readConfiguredOuraDeviceSyncProviderConfig,
  serializableFields: OURA_SERIALIZABLE_PROVIDER_CONFIG_SCHEMA.serializableFields,
  disallowedSerializableFields:
    OURA_SERIALIZABLE_PROVIDER_CONFIG_SCHEMA.disallowedSerializableFields,
  jobs: freezeConfiguredDeviceSyncProviderJobDefinitions(OURA_DEVICE_SYNC_JOB_DEFINITIONS),
});

const WHOOP_DEVICE_SYNC_JOB_DEFINITIONS = {
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
} satisfies DeviceSyncProviderJobDefinitionMap;

export type WhoopDeviceSyncJobPayloads = {
  [Kind in keyof typeof WHOOP_DEVICE_SYNC_JOB_DEFINITIONS]: DeviceSyncJobPayloadOf<
    (typeof WHOOP_DEVICE_SYNC_JOB_DEFINITIONS)[Kind]
  >;
};

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
  env: WHOOP_DEVICE_SYNC_PROVIDER_ENV_SPEC,
  readConfig: readConfiguredWhoopDeviceSyncProviderConfig,
  serializableFields: WHOOP_SERIALIZABLE_PROVIDER_CONFIG_SCHEMA.serializableFields,
  disallowedSerializableFields:
    WHOOP_SERIALIZABLE_PROVIDER_CONFIG_SCHEMA.disallowedSerializableFields,
  jobs: freezeConfiguredDeviceSyncProviderJobDefinitions(WHOOP_DEVICE_SYNC_JOB_DEFINITIONS),
});

const STRAVA_DEVICE_SYNC_JOB_DEFINITIONS = {
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
} satisfies DeviceSyncProviderJobDefinitionMap;

export type StravaDeviceSyncJobPayloads = {
  [Kind in keyof typeof STRAVA_DEVICE_SYNC_JOB_DEFINITIONS]: DeviceSyncJobPayloadOf<
    (typeof STRAVA_DEVICE_SYNC_JOB_DEFINITIONS)[Kind]
  >;
};

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
  env: STRAVA_DEVICE_SYNC_PROVIDER_ENV_SPEC,
  readConfig: readConfiguredStravaDeviceSyncProviderConfig,
  serializableFields: STRAVA_SERIALIZABLE_PROVIDER_CONFIG_SCHEMA.serializableFields,
  disallowedSerializableFields:
    STRAVA_SERIALIZABLE_PROVIDER_CONFIG_SCHEMA.disallowedSerializableFields,
  jobs: freezeConfiguredDeviceSyncProviderJobDefinitions(STRAVA_DEVICE_SYNC_JOB_DEFINITIONS),
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

export function getConfiguredDeviceSyncProviderDescriptor<
  TProvider extends ConfiguredDeviceSyncProviderKey,
>(provider: TProvider): DeviceSyncConfiguredProviderManifestByKey[TProvider]["descriptor"] {
  return deviceSyncProviderManifestByKey[provider].descriptor;
}

export function resolveConfiguredDeviceSyncProviderDescriptor(
  provider: string,
): DeviceProviderDescriptor | undefined {
  return resolveConfiguredDeviceSyncProviderManifest(provider)?.descriptor;
}

export interface NormalizedJunctionDeviceSyncRuntimeConfig {
  clientUserIdSecret: string;
  providerFilter: string[];
  reconcileIntervalMs: number;
  summaryResources: string[];
  timeseriesResources: string[];
}

export function buildConfiguredDeviceSyncProviderRuntimeDescriptor<
  TProvider extends ConfiguredDeviceSyncProviderKey,
>(
  provider: TProvider,
  config: ConfiguredDeviceSyncProviderConfigByKey[TProvider],
): DeviceProviderDescriptor {
  switch (provider) {
    case "junction":
      return buildJunctionDeviceSyncRuntimeDescriptor(
        config as ConfiguredDeviceSyncProviderConfigByKey["junction"],
      );
    case "oura":
      return buildOuraDeviceSyncRuntimeDescriptor(
        config as ConfiguredDeviceSyncProviderConfigByKey["oura"],
      );
    case "whoop":
      return buildWhoopDeviceSyncRuntimeDescriptor(
        config as ConfiguredDeviceSyncProviderConfigByKey["whoop"],
      );
    case "strava":
      return buildStravaDeviceSyncRuntimeDescriptor(
        config as ConfiguredDeviceSyncProviderConfigByKey["strava"],
      );
  }
}

export function normalizeJunctionDeviceSyncRuntimeConfig(
  config: JunctionDeviceSyncProviderConfig,
): NormalizedJunctionDeviceSyncRuntimeConfig {
  const clientUserIdSecret = assertValidJunctionClientUserIdSecret(config.clientUserIdSecret);
  const summaryResources = normalizeRequiredJunctionResourceList(
    config.summaryResources,
    JUNCTION_DEFAULT_SUMMARY_RESOURCES,
    JUNCTION_ALLOWED_SUMMARY_RESOURCES,
    "summary",
  );
  const timeseriesResources = normalizeOptionalJunctionResourceList(
    config.timeseriesResources,
    JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
    JUNCTION_ALLOWED_TIMESERIES_RESOURCES,
    JUNCTION_KNOWN_TIMESERIES_RESOURCES,
    "timeseries",
  );
  const providerFilter = normalizeJunctionProviderFilter(config.providerFilter);
  const reconcileIntervalMs = Math.max(
    60_000,
    config.reconcileIntervalMs ?? JUNCTION_SYNC.windows.reconcileIntervalMs,
  );

  if (providerFilter.length === 0) {
    throw new TypeError("Junction provider filter must include at least one hosted Link provider.");
  }

  return {
    clientUserIdSecret,
    providerFilter,
    reconcileIntervalMs,
    summaryResources,
    timeseriesResources,
  };
}

export function buildJunctionDeviceSyncRuntimeDescriptor(
  config: JunctionDeviceSyncProviderConfig,
): DeviceProviderDescriptor {
  const runtimeConfig = normalizeJunctionDeviceSyncRuntimeConfig(config);

  return {
    ...getConfiguredDeviceSyncProviderDescriptor("junction"),
    sync: {
      ...JUNCTION_SYNC,
      windows: {
        ...JUNCTION_SYNC.windows,
        reconcileIntervalMs: runtimeConfig.reconcileIntervalMs,
      },
    },
  };
}

export function assertValidJunctionClientUserIdSecret(secret: string): string {
  const normalizedSecret = normalizeString(secret);

  if (!normalizedSecret || normalizedSecret.length < 16) {
    throw new TypeError("JUNCTION_CLIENT_USER_ID_SECRET must be at least 16 characters.");
  }

  return normalizedSecret;
}

export function buildOuraDeviceSyncScopes(input: string[] | undefined): string[] {
  const requested = [...OURA_DEFAULT_SCOPES, ...(input ?? [])];
  return [...new Set(
    requested
      .map((scope) => scope.trim())
      .filter((scope) => scope && !isDeprecatedOuraScope(scope)),
  )];
}

export function buildOuraDeviceSyncRuntimeDescriptor(
  config: OuraDeviceSyncProviderConfig,
): DeviceProviderDescriptor {
  const backfillDays = Math.max(1, config.backfillDays ?? OURA_SYNC.windows.backfillDays);
  const reconcileDays = Math.max(1, config.reconcileDays ?? OURA_SYNC.windows.reconcileDays);
  const reconcileIntervalMs = Math.max(
    60_000,
    config.reconcileIntervalMs ?? OURA_SYNC.windows.reconcileIntervalMs,
  );

  return {
    ...getConfiguredDeviceSyncProviderDescriptor("oura"),
    oauth: {
      ...OURA_OAUTH,
      defaultScopes: buildOuraDeviceSyncScopes(config.scopes),
    },
    sync: {
      ...OURA_SYNC,
      windows: {
        backfillDays,
        reconcileDays,
        reconcileIntervalMs,
      },
    },
  };
}

export function normalizeStravaDeviceSyncScopes(value: unknown): string[] {
  if (!Array.isArray(value) && typeof value !== "string") {
    return [];
  }

  const rawScopes = Array.isArray(value) ? value : [value];
  const deduped = new Set<string>();

  for (const entry of rawScopes) {
    if (typeof entry !== "string") {
      continue;
    }

    for (const scope of entry.split(/[\s,]+/u)) {
      const normalized = scope.trim();

      if (normalized) {
        deduped.add(normalized);
      }
    }
  }

  return [...deduped];
}

export function buildStravaDeviceSyncScopes(input: string[] | undefined): string[] {
  const scopes = normalizeStravaDeviceSyncScopes(input);
  return scopes.length > 0 ? scopes : [...STRAVA_DEFAULT_SCOPES];
}

export function buildStravaDeviceSyncRuntimeDescriptor(
  config: StravaDeviceSyncProviderConfig,
): DeviceProviderDescriptor {
  const backfillDays = Math.max(1, config.backfillDays ?? STRAVA_SYNC.windows.backfillDays);
  const reconcileDays = Math.max(1, config.reconcileDays ?? STRAVA_SYNC.windows.reconcileDays);
  const reconcileIntervalMs = Math.max(
    60_000,
    config.reconcileIntervalMs ?? STRAVA_SYNC.windows.reconcileIntervalMs,
  );

  return {
    ...getConfiguredDeviceSyncProviderDescriptor("strava"),
    oauth: {
      ...STRAVA_OAUTH,
      defaultScopes: buildStravaDeviceSyncScopes(config.scopes),
    },
    sync: {
      ...STRAVA_SYNC,
      windows: {
        backfillDays,
        reconcileDays,
        reconcileIntervalMs,
      },
    },
  };
}

export function buildWhoopDeviceSyncScopes(input: string[] | undefined): string[] {
  const requested = input === undefined ? [...WHOOP_DEFAULT_SCOPES] : input;
  return [...new Set(
    [...WHOOP_REQUIRED_SCOPES, ...requested]
      .map((scope) => scope.trim())
      .filter(Boolean),
  )];
}

export function buildWhoopDeviceSyncRuntimeDescriptor(
  config: WhoopDeviceSyncProviderConfig,
): DeviceProviderDescriptor {
  const backfillDays = Math.max(1, config.backfillDays ?? WHOOP_SYNC.windows.backfillDays);
  const reconcileDays = Math.max(1, config.reconcileDays ?? WHOOP_SYNC.windows.reconcileDays);
  const reconcileIntervalMs = Math.max(
    60_000,
    config.reconcileIntervalMs ?? WHOOP_SYNC.windows.reconcileIntervalMs,
  );

  return {
    ...getConfiguredDeviceSyncProviderDescriptor("whoop"),
    oauth: {
      ...WHOOP_OAUTH,
      defaultScopes: buildWhoopDeviceSyncScopes(config.scopes),
    },
    sync: {
      ...WHOOP_SYNC,
      windows: {
        backfillDays,
        reconcileDays,
        reconcileIntervalMs,
      },
    },
  };
}

function isDeprecatedOuraScope(scope: string): boolean {
  return scope.replace(/^extapi:/u, "") === "heartrate";
}

function normalizeRequiredJunctionResourceList(
  value: string[] | undefined,
  defaults: readonly string[],
  allowedResources: readonly string[],
  label: string,
): string[] {
  const normalized = (value && value.length > 0 ? value : defaults)
    .map(normalizeJunctionResourceName)
    .filter((entry): entry is string => entry !== null);
  const allowedResourceSet = new Set<string>(allowedResources);
  const unsupportedResources = normalized.filter((entry) => !allowedResourceSet.has(entry));

  if (unsupportedResources.length > 0) {
    throw new TypeError(
      `Junction ${label} resources include unsupported resource(s): ${[...new Set(unsupportedResources)].join(", ")}.`,
    );
  }

  if (normalized.length === 0) {
    throw new TypeError(`Junction ${label} resources must include at least one supported resource.`);
  }

  return [...new Set(normalized)];
}

function normalizeOptionalJunctionResourceList(
  value: string[] | undefined,
  defaults: readonly string[],
  allowedResources: readonly string[],
  knownResources: readonly string[],
  label: string,
): string[] {
  const normalized = (value === undefined ? defaults : value)
    .map(normalizeJunctionResourceName)
    .filter((entry): entry is string => entry !== null);
  const allowedResourceSet = new Set<string>(allowedResources);
  const knownResourceSet = new Set<string>([...allowedResources, ...knownResources]);
  const unsupportedResources = normalized.filter((entry) => !knownResourceSet.has(entry));

  if (unsupportedResources.length > 0) {
    throw new TypeError(
      `Junction ${label} resources include unsupported resource(s): ${[...new Set(unsupportedResources)].join(", ")}.`,
    );
  }

  const enabledResources = normalized.filter((entry) => allowedResourceSet.has(entry));
  if (value !== undefined && value.length > 0 && enabledResources.length === 0) {
    return [...new Set(defaults)];
  }

  return [...new Set(enabledResources)];
}

type DeviceSyncJobFieldOptions = Pick<
  DeviceSyncJobPayloadFieldSpec,
  "includeInHostedHint" | "required"
>;

function booleanJobField(): { kind: "boolean" };
function booleanJobField<const O extends DeviceSyncJobFieldOptions>(
  options: O,
): { kind: "boolean" } & O;
function booleanJobField(
  options: DeviceSyncJobFieldOptions = {},
): DeviceSyncJobPayloadFieldSpec {
  return {
    kind: "boolean",
    ...options,
  };
}

function numberJobField(): { kind: "number" };
function numberJobField<const O extends DeviceSyncJobFieldOptions>(
  options: O,
): { kind: "number" } & O;
function numberJobField(
  options: DeviceSyncJobFieldOptions = {},
): DeviceSyncJobPayloadFieldSpec {
  return {
    kind: "number",
    ...options,
  };
}

function stringJobField(): { kind: "string" };
function stringJobField<const O extends DeviceSyncJobFieldOptions>(
  options: O,
): { kind: "string" } & O;
function stringJobField(
  options: DeviceSyncJobFieldOptions = {},
): DeviceSyncJobPayloadFieldSpec {
  return {
    kind: "string",
    ...options,
  };
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
