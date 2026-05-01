import {
  configuredDeviceSyncProviderKeys,
  getConfiguredDeviceSyncProviderManifest,
  listConfiguredDeviceSyncProviderNames,
  type DeviceSyncConfiguredProviderManifest,
  type SerializableConfigFieldKind,
} from "./provider-manifests.ts";

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
    getConfiguredDeviceSyncProviderManifest(provider),
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
    getConfiguredDeviceSyncProviderManifest(provider),
    value,
    label,
  ) as SerializableConfiguredDeviceSyncProviderConfigByKey[TProvider];
}

function cloneSerializableProviderConfig(
  manifest: DeviceSyncConfiguredProviderManifest,
  config: object,
): Record<string, unknown> {
  const record = Object.fromEntries(Object.entries(config));
  const cloned: Record<string, unknown> = {};

  for (const key of Object.keys(manifest.serializableFields)) {
    const value = record[key];

    if (value === undefined) {
      continue;
    }

    cloned[key] = Array.isArray(value) ? [...value] : value;
  }

  return cloned;
}

function parseSerializableProviderConfig(
  manifest: DeviceSyncConfiguredProviderManifest,
  value: unknown,
  label: string,
): Record<string, unknown> {
  const record = requireSerializableProviderConfigRecord(manifest, value, label);
  const parsed: Record<string, unknown> = {};

  for (const [key, kind] of Object.entries(manifest.serializableFields)) {
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
  manifest: DeviceSyncConfiguredProviderManifest,
  value: unknown,
  label: string,
): Record<string, unknown> {
  const record = requireSerializableConfigObject(value, label);
  const supportedKeys = new Set(Object.keys(manifest.serializableFields));

  for (const [key, message] of Object.entries(manifest.disallowedSerializableFields ?? {})) {
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
