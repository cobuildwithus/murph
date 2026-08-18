import {
  configuredDeviceSyncProviderKeys,
  listConfiguredDeviceSyncProviderNames,
} from "./provider-keys.ts";

import type {
  ConfiguredDeviceSyncProviderConfigByKey,
  ConfiguredDeviceSyncProviderConfigs,
  ConfiguredDeviceSyncProviderKey,
  SerializableConfiguredDeviceSyncProviderConfigByKey,
  SerializableConfiguredDeviceSyncProviderConfigs,
} from "./provider-types.ts";

export type {
  SerializableConfiguredDeviceSyncProviderConfigByKey,
  SerializableConfiguredDeviceSyncProviderConfigs,
} from "./provider-types.ts";

export type SerializableConfigFieldKind = "boolean" | "number" | "string" | "string[]";

export interface SerializableConfiguredDeviceSyncProviderSchema<
  TProvider extends ConfiguredDeviceSyncProviderKey = ConfiguredDeviceSyncProviderKey,
> {
  disallowedSerializableFields?: Readonly<Record<string, string>>;
  serializableFields: Readonly<Record<
    Extract<keyof SerializableConfiguredDeviceSyncProviderConfigByKey[TProvider], string>,
    SerializableConfigFieldKind
  >>;
}

const DEFAULT_DISALLOWED_SERIALIZABLE_FIELDS = Object.freeze({
  fetchImpl: "is not supported in serialized runtime config.",
});

export const JUNCTION_SERIALIZABLE_PROVIDER_CONFIG_SCHEMA =
  defineSerializableConfiguredDeviceSyncProviderSchema<"junction">({
    serializableFields: {
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
    },
    disallowedSerializableFields: {
      ...DEFAULT_DISALLOWED_SERIALIZABLE_FIELDS,
      apiKey:
        "is a provider-owned API secret and is not supported in serialized runtime config.",
      clientUserIdSecret:
        "is a provider-owned HMAC secret and is not supported in serialized runtime config.",
      timeseriesResources:
        "is code-owned and is not supported in serialized runtime config.",
      webhookSecret:
        "is a provider-owned webhook secret and is not supported in serialized runtime config.",
    },
  });

export const OURA_SERIALIZABLE_PROVIDER_CONFIG_SCHEMA =
  defineSerializableConfiguredDeviceSyncProviderSchema<"oura">({
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
  });

export const WHOOP_SERIALIZABLE_PROVIDER_CONFIG_SCHEMA =
  defineSerializableConfiguredDeviceSyncProviderSchema<"whoop">({
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
  });

export const STRAVA_SERIALIZABLE_PROVIDER_CONFIG_SCHEMA =
  defineSerializableConfiguredDeviceSyncProviderSchema<"strava">({
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
  });

export const serializableConfiguredDeviceSyncProviderSchemaByKey = Object.freeze({
  junction: JUNCTION_SERIALIZABLE_PROVIDER_CONFIG_SCHEMA,
  oura: OURA_SERIALIZABLE_PROVIDER_CONFIG_SCHEMA,
  whoop: WHOOP_SERIALIZABLE_PROVIDER_CONFIG_SCHEMA,
  strava: STRAVA_SERIALIZABLE_PROVIDER_CONFIG_SCHEMA,
});

export function getSerializableConfiguredDeviceSyncProviderSchema<
  TProvider extends ConfiguredDeviceSyncProviderKey,
>(
  provider: TProvider,
): (typeof serializableConfiguredDeviceSyncProviderSchemaByKey)[TProvider] {
  return serializableConfiguredDeviceSyncProviderSchemaByKey[provider];
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

function cloneSerializableConfiguredDeviceSyncProviderConfig<
  TProvider extends ConfiguredDeviceSyncProviderKey,
>(
  provider: TProvider,
  config: ConfiguredDeviceSyncProviderConfigByKey[TProvider],
): SerializableConfiguredDeviceSyncProviderConfigByKey[TProvider] {
  return cloneSerializableProviderConfig(
    getSerializableConfiguredDeviceSyncProviderSchema(provider),
    config,
  ) as SerializableConfiguredDeviceSyncProviderConfigByKey[TProvider];
}

function parseSerializableConfiguredDeviceSyncProviderConfig<
  TProvider extends ConfiguredDeviceSyncProviderKey,
>(
  provider: TProvider,
  value: unknown,
  label: string,
): SerializableConfiguredDeviceSyncProviderConfigByKey[TProvider] {
  return parseSerializableProviderConfig(
    getSerializableConfiguredDeviceSyncProviderSchema(provider),
    value,
    label,
  ) as SerializableConfiguredDeviceSyncProviderConfigByKey[TProvider];
}

function cloneSerializableProviderConfig(
  schema: SerializableConfiguredDeviceSyncProviderSchema,
  config: object,
): Record<string, unknown> {
  const record = Object.fromEntries(Object.entries(config));
  const cloned: Record<string, unknown> = {};

  for (const key of Object.keys(schema.serializableFields)) {
    const value = record[key];

    if (value === undefined) {
      continue;
    }

    cloned[key] = Array.isArray(value) ? [...value] : value;
  }

  return cloned;
}

function parseSerializableProviderConfig(
  schema: SerializableConfiguredDeviceSyncProviderSchema,
  value: unknown,
  label: string,
): Record<string, unknown> {
  const record = requireSerializableProviderConfigRecord(schema, value, label);
  const parsed: Record<string, unknown> = {};

  for (const [key, kind] of Object.entries(schema.serializableFields)) {
    const fieldValue = record[key];

    if (fieldValue === undefined) {
      continue;
    }

    parsed[key] = parseSerializableFieldValue(
      kind as SerializableConfigFieldKind,
      fieldValue,
      `${label}.${key}`,
    );
  }

  return parsed;
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
  schema: SerializableConfiguredDeviceSyncProviderSchema,
  value: unknown,
  label: string,
): Record<string, unknown> {
  const record = requireSerializableConfigObject(value, label);
  const supportedKeys = new Set(Object.keys(schema.serializableFields));

  for (const [key, message] of Object.entries(schema.disallowedSerializableFields ?? {})) {
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

function defineSerializableConfiguredDeviceSyncProviderSchema<
  TProvider extends ConfiguredDeviceSyncProviderKey,
>(
  input: SerializableConfiguredDeviceSyncProviderSchema<TProvider>,
): SerializableConfiguredDeviceSyncProviderSchema<TProvider> {
  return Object.freeze({
    disallowedSerializableFields: input.disallowedSerializableFields
      ? Object.freeze({ ...input.disallowedSerializableFields })
      : undefined,
    serializableFields: Object.freeze({ ...input.serializableFields }),
  });
}
