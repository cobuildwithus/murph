import { configuredDeviceSyncProviderKeys } from "./provider-keys.ts";

import type {
  ConfiguredDeviceSyncProviderConfigs,
  SerializableConfiguredDeviceSyncProviderConfigByKey,
  SerializableConfiguredDeviceSyncProviderConfigs,
} from "./provider-types.ts";

export type {
  SerializableConfiguredDeviceSyncProviderConfigByKey,
  SerializableConfiguredDeviceSyncProviderConfigs,
} from "./provider-types.ts";

export type SerializableConfigFieldKind = "boolean" | "number" | "string" | "string[]";

interface SerializableConfiguredDeviceSyncProviderSchema {
  disallowedSerializableFields?: Readonly<Record<string, string>>;
  serializableFields: Readonly<Record<
    Extract<keyof SerializableConfiguredDeviceSyncProviderConfigByKey["junction"], string>,
    SerializableConfigFieldKind
  >>;
}

export const JUNCTION_SERIALIZABLE_PROVIDER_CONFIG_SCHEMA =
  Object.freeze({
    serializableFields: Object.freeze({
      allowedLinkHosts: "string[]",
      apiBaseUrl: "string",
      clientUserIdNamespace: "string",
      environment: "string",
      providerFilter: "string[]",
      pushSourceRecoveryEnabled: "boolean",
      reconcileDays: "number",
      reconcileIntervalMs: "number",
      region: "string",
      requestTimeoutMs: "number",
      summaryBackfillDays: "number",
      summaryResources: "string[]",
      timeseriesBackfillDays: "number",
      webhookTimestampToleranceMs: "number",
    }),
    disallowedSerializableFields: Object.freeze({
      fetchImpl: "is not supported in serialized runtime config.",
      apiKey:
        "is a provider-owned API secret and is not supported in serialized runtime config.",
      clientUserIdSecret:
        "is a provider-owned HMAC secret and is not supported in serialized runtime config.",
      timeseriesResources:
        "is code-owned and is not supported in serialized runtime config.",
      webhookSecret:
        "is a provider-owned webhook secret and is not supported in serialized runtime config.",
    }),
  } satisfies SerializableConfiguredDeviceSyncProviderSchema);

// Hosted runner envelopes keep only the serializable runtime subset of provider config.
// Provider-owned admin secrets such as webhook verification tokens stay on the control plane.
export function cloneSerializableConfiguredDeviceSyncProviderConfigs(
  configs: ConfiguredDeviceSyncProviderConfigs,
): SerializableConfiguredDeviceSyncProviderConfigs {
  return configs.junction
    ? { junction: cloneSerializableProviderConfig(configs.junction) }
    : {};
}

export function parseSerializableConfiguredDeviceSyncProviderConfigs(
  value: unknown,
  label: string,
): SerializableConfiguredDeviceSyncProviderConfigs {
  const record = requireSerializableConfiguredDeviceSyncProviderConfigsRecord(value, label);
  return record.junction === undefined
    ? {}
    : { junction: parseSerializableProviderConfig(record.junction, `${label}.junction`) };
}

export function requireSerializableConfigObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

export function requireSerializableString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function cloneSerializableProviderConfig(
  config: object,
): SerializableConfiguredDeviceSyncProviderConfigByKey["junction"] {
  const record = Object.fromEntries(Object.entries(config));
  const cloned: Record<string, unknown> = {};

  for (const key of Object.keys(JUNCTION_SERIALIZABLE_PROVIDER_CONFIG_SCHEMA.serializableFields)) {
    const value = record[key];

    if (value === undefined) {
      continue;
    }

    cloned[key] = Array.isArray(value) ? [...value] : value;
  }

  return cloned as SerializableConfiguredDeviceSyncProviderConfigByKey["junction"];
}

function parseSerializableProviderConfig(
  value: unknown,
  label: string,
): SerializableConfiguredDeviceSyncProviderConfigByKey["junction"] {
  const record = requireSerializableProviderConfigRecord(value, label);
  const parsed: Record<string, unknown> = {};

  for (const [key, kind] of Object.entries(JUNCTION_SERIALIZABLE_PROVIDER_CONFIG_SCHEMA.serializableFields)) {
    const fieldValue = record[key];

    if (fieldValue === undefined) {
      continue;
    }

    parsed[key] = parseSerializableFieldValue(
      kind,
      fieldValue,
      `${label}.${key}`,
    );
  }

  return parsed as SerializableConfiguredDeviceSyncProviderConfigByKey["junction"];
}

// Web builds from before the direct WHOOP, Oura and Strava removal can still
// serialize those providers into runtime config that is already in flight. A
// new runner drops them, so deploy order does not matter; any other unknown
// provider is still rejected.
const RETIRED_DIRECT_DEVICE_SYNC_PROVIDER_KEYS: ReadonlySet<string> = new Set([
  "oura",
  "strava",
  "whoop",
]);

function requireSerializableConfiguredDeviceSyncProviderConfigsRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  const record = requireSerializableConfigObject(value, label);
  const supportedProviders = new Set<string>(configuredDeviceSyncProviderKeys);

  for (const key of Object.keys(record)) {
    if (!supportedProviders.has(key) && !RETIRED_DIRECT_DEVICE_SYNC_PROVIDER_KEYS.has(key)) {
      throw new TypeError(`${label}.${key} is not a supported device-sync provider config.`);
    }
  }

  return record;
}

function requireSerializableProviderConfigRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  const record = requireSerializableConfigObject(value, label);
  const supportedKeys = new Set(Object.keys(JUNCTION_SERIALIZABLE_PROVIDER_CONFIG_SCHEMA.serializableFields));

  for (const [key, message] of Object.entries(JUNCTION_SERIALIZABLE_PROVIDER_CONFIG_SCHEMA.disallowedSerializableFields)) {
    if (record[key] !== undefined) {
      throw new TypeError(`${label}.${key} ${message}`);
    }
  }

  for (const key of Object.keys(record)) {
    if (!supportedKeys.has(key)) {
      throw new TypeError(`${label}.${key} is not a supported serialized provider config field.`);
    }
  }

  return record;
}

function parseSerializableFieldValue(
  kind: SerializableConfigFieldKind,
  value: unknown,
  label: string,
): boolean | number | string | string[] {
  switch (kind) {
    case "boolean":
      return requireSerializableBoolean(value, label);
    case "number":
      return requireSerializableNumber(value, label);
    case "string":
      return requireSerializableString(value, label);
    case "string[]":
      return requireSerializableStringArray(value, label);
  }
}

function requireSerializableBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }

  return value;
}

function requireSerializableNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }

  return value;
}

function requireSerializableStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array of strings.`);
  }

  return value.map((entry, index) => requireSerializableString(entry, `${label}[${index}]`));
}
