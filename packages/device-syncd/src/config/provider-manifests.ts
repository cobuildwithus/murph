import {
  JUNCTION_ALLOWED_SUMMARY_RESOURCES,
  JUNCTION_ALLOWED_TIMESERIES_RESOURCES,
  JUNCTION_DEFAULT_SUMMARY_RESOURCES,
  JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
  normalizeJunctionResourceName,
} from "@murphai/contracts";
import { JUNCTION_DEVICE_PROVIDER_DESCRIPTOR, normalizeDeviceProviderKey, requireDeviceProviderSyncDescriptor, resolveDeviceProviderConnectionDescriptor, type DeviceProviderDescriptor } from "@murphai/importers/device-providers/provider-descriptors";

import { readConfiguredJunctionDeviceSyncProviderConfig } from "./provider-configs.ts";
import {
  configuredDeviceSyncProviderKeys,
  listConfiguredDeviceSyncProviderNames,
} from "./provider-keys.ts";
import { JUNCTION_DEVICE_SYNC_PROVIDER_ENV_SPEC, type DeviceSyncProviderEnvSpec } from "./provider-env.ts";
import { JUNCTION_SERIALIZABLE_PROVIDER_CONFIG_SCHEMA, type SerializableConfigFieldKind } from "./serializable-provider-configs.ts";
import { normalizeJunctionProviderFilter } from "./junction-connect-sources.ts";
import { normalizeString } from "../shared.ts";

import type { ConfiguredDeviceSyncProviderKey, DeviceSyncEnvSource, JunctionDeviceSyncProviderConfig, SerializableConfiguredDeviceSyncProviderConfigByKey } from "./provider-types.ts";
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

export interface DeviceSyncProviderCatalogEntry {
  provider: ConfiguredDeviceSyncProviderKey;
  displayName: string;
  callbackPath: string | null;
  webhookPath: string | null;
  supportsWebhooks: boolean;
  defaultScopes: string[];
}

export interface DeviceSyncConfiguredProviderManifest {
  provider: ConfiguredDeviceSyncProviderKey;
  credentialPolicy: DeviceSyncProviderCredentialPolicy;
  descriptor: DeviceProviderDescriptor;
  disallowedSerializableFields?: Readonly<Record<string, string>>;
  env: DeviceSyncProviderEnvSpec;
  jobs: DeviceSyncProviderJobDefinitionMap;
  readConfig(env: DeviceSyncEnvSource): JunctionDeviceSyncProviderConfig | null;
  serializableFields: Readonly<Record<
    Extract<keyof SerializableConfiguredDeviceSyncProviderConfigByKey["junction"], string>,
    SerializableConfigFieldKind
  >>;
}

const JUNCTION_SYNC = requireDeviceProviderSyncDescriptor(
  JUNCTION_DEVICE_PROVIDER_DESCRIPTOR,
);

const JUNCTION_DEVICE_SYNC_JOB_DEFINITIONS = {
  backfill: {
    payload: {
      emptyBackfillAttempts: numberJobField({ includeInHostedHint: true }),
      historicalProofFirstSeenAt: stringJobField({ includeInHostedHint: true }),
      historicalProofSourceProviderSlug: stringJobField({ includeInHostedHint: true }),
      historicalProviderRecordsSeen: booleanJobField({ includeInHostedHint: true }),
      historicalRecordsSeen: booleanJobField({ includeInHostedHint: true }),
      sourceProviderSlug: stringJobField({ includeInHostedHint: true }),
      timeseriesCursor: stringJobField({ includeInHostedHint: true }),
      timeseriesResourceCursor: stringJobField({ includeInHostedHint: true }),
      timeseriesWindowHours: numberJobField({ includeInHostedHint: true }),
      workoutStreamCursor: stringJobField({ includeInHostedHint: true }),
      workoutStreamEmptySeen: booleanJobField({ includeInHostedHint: true }),
      windowEnd: stringJobField({ includeInHostedHint: true }),
      windowStart: stringJobField({ includeInHostedHint: true }),
    },
  },
  reconcile: {
    payload: {
      sourceProviderSlug: stringJobField({ includeInHostedHint: true }),
      reconcileProof: stringJobField({ includeInHostedHint: true }),
      summaryPhaseComplete: booleanJobField({ includeInHostedHint: true }),
      summaryResourceCursor: stringJobField({ includeInHostedHint: true }),
      timeseriesCursor: stringJobField({ includeInHostedHint: true }),
      timeseriesResourceCursor: stringJobField({ includeInHostedHint: true }),
      timeseriesWindowHours: numberJobField({ includeInHostedHint: true }),
      workoutStreamCursor: stringJobField({ includeInHostedHint: true }),
      workoutStreamEmptySeen: booleanJobField({ includeInHostedHint: true }),
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
      calendarRefreshDay: stringJobField({ includeInHostedHint: true }),
      companionAdmissionId: stringJobField({ includeInHostedHint: true }),
      companionObservationJson: stringJobField({ includeInHostedHint: true }),
      emptyBackfillAttempts: numberJobField({ includeInHostedHint: true }),
      eventType: stringJobField({ includeInHostedHint: true }),
      historicalBackfill: booleanJobField({ includeInHostedHint: true }),
      historicalBackfillVersion: numberJobField({ includeInHostedHint: true }),
      historicalProviderRecordsSeen: booleanJobField({ includeInHostedHint: true }),
      historicalPullPending: booleanJobField({ includeInHostedHint: true }),
      historicalRecordsSeen: booleanJobField({ includeInHostedHint: true }),
      historicalUnresolvedProviderRecordIdentitiesJson: stringJobField({ includeInHostedHint: true }),
      historicalUnresolvedProviderRecordCount: numberJobField({ includeInHostedHint: true }),
      historicalWindowStart: stringJobField({ includeInHostedHint: true }),
      objectId: stringJobField({ includeInHostedHint: true }),
      occurredAt: stringJobField({ includeInHostedHint: true }),
      resource: stringJobField({ includeInHostedHint: true }),
      resourceCategory: stringJobField({ includeInHostedHint: true }),
      sourceLifecycleEpoch: numberJobField({ includeInHostedHint: true }),
      sourceInstanceId: stringJobField({ includeInHostedHint: true }),
      sourceProviderSlug: stringJobField({ includeInHostedHint: true }),
      sourceType: stringJobField({ includeInHostedHint: true }),
      // Legacy field: retained so previously queued rows still validate; the
      // day key is now derived from windowStart plus the authority timezone.
      temporalAuthorityDayKey: stringJobField(),
      temporalAuthorityTimeZone: stringJobField({ includeInHostedHint: true }),
      timeseriesWindowHours: numberJobField({ includeInHostedHint: true }),
      webhookDataJson: stringJobField({ includeInHostedHint: true }),
      workoutStreamCursor: stringJobField({ includeInHostedHint: true }),
      workoutStreamEmptyReplay: booleanJobField({ includeInHostedHint: true }),
      workoutStreamEmptySeen: booleanJobField({ includeInHostedHint: true }),
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

const JUNCTION_DEVICE_SYNC_PROVIDER_MANIFEST = Object.freeze({
  provider: "junction",
  credentialPolicy: {
    kind: "provider_config",
    providerConfigKey: "junction",
  },
  descriptor: JUNCTION_DEVICE_PROVIDER_DESCRIPTOR,
  env: freezeDeviceSyncProviderEnvSpec(JUNCTION_DEVICE_SYNC_PROVIDER_ENV_SPEC),
  readConfig: readConfiguredJunctionDeviceSyncProviderConfig,
  serializableFields: JUNCTION_SERIALIZABLE_PROVIDER_CONFIG_SCHEMA.serializableFields,
  disallowedSerializableFields:
    JUNCTION_SERIALIZABLE_PROVIDER_CONFIG_SCHEMA.disallowedSerializableFields,
  jobs: freezeConfiguredDeviceSyncProviderJobDefinitions(JUNCTION_DEVICE_SYNC_JOB_DEFINITIONS),
} satisfies DeviceSyncConfiguredProviderManifest);

export { configuredDeviceSyncProviderKeys };

export const deviceSyncProviderManifests = Object.freeze([
  JUNCTION_DEVICE_SYNC_PROVIDER_MANIFEST,
]);

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

export function resolveConfiguredDeviceSyncProviderManifest(
  provider: string,
): DeviceSyncConfiguredProviderManifest | undefined {
  return normalizeDeviceProviderKey(provider) === "junction"
    ? JUNCTION_DEVICE_SYNC_PROVIDER_MANIFEST
    : undefined;
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

export function listDeviceSyncProviderCatalog(): DeviceSyncProviderCatalogEntry[] {
  return deviceSyncProviderManifests.map((manifest) => {
    const connection = resolveDeviceProviderConnectionDescriptor(manifest.descriptor);

    return {
      provider: manifest.provider,
      displayName: manifest.descriptor.displayName,
      callbackPath: connection.callbackPath ?? null,
      webhookPath: manifest.descriptor.webhook?.path ?? null,
      supportsWebhooks: manifest.descriptor.transportModes.includes("webhook_push"),
      defaultScopes: [...(connection.defaultScopes ?? [])],
    };
  });
}

export function resolveConfiguredDeviceSyncProviderDescriptor(
  provider: string,
): DeviceProviderDescriptor | undefined {
  return resolveConfiguredDeviceSyncProviderManifest(provider)?.descriptor;
}

export interface NormalizedJunctionDeviceSyncRuntimeConfig {
  clientUserIdNamespace: string;
  clientUserIdSecret: string;
  providerFilter: string[];
  reconcileIntervalMs: number;
  summaryResources: string[];
  timeseriesResources: string[];
}

export function normalizeJunctionDeviceSyncRuntimeConfig(
  config: JunctionDeviceSyncProviderConfig,
): NormalizedJunctionDeviceSyncRuntimeConfig {
  const clientUserIdNamespace = normalizeJunctionClientUserIdNamespace(
    config.clientUserIdNamespace,
  );
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
    clientUserIdNamespace,
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
    ...JUNCTION_DEVICE_PROVIDER_DESCRIPTOR,
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

export function normalizeJunctionClientUserIdNamespace(
  namespace: string | undefined,
): string {
  const normalizedNamespace = normalizeString(namespace);

  if (!normalizedNamespace) {
    return "";
  }
  if (!/^[a-z][a-z0-9]{0,7}$/u.test(normalizedNamespace)) {
    throw new TypeError(
      "JUNCTION_CLIENT_USER_ID_NAMESPACE must be 1-8 lowercase letters or digits and start with a letter.",
    );
  }

  return normalizedNamespace;
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
  label: string,
): string[] {
  const allowedResourceSet = new Set<string>(allowedResources);
  const enabledResources: string[] = [];
  const unsupportedResources: string[] = [];

  for (const requestedResource of value === undefined ? defaults : value) {
    const normalized = normalizeJunctionResourceName(requestedResource);
    if (!normalized || !allowedResourceSet.has(normalized)) {
      unsupportedResources.push(normalized ?? requestedResource);
      continue;
    }
    enabledResources.push(normalized);
  }

  if (unsupportedResources.length > 0) {
    throw new TypeError(
      `Junction ${label} resources include unsupported resource(s): ${[...new Set(unsupportedResources)].join(", ")}.`,
    );
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
