import { optionalEnv } from "./provider-config-helpers.ts";
import {
  readConfiguredDeviceSyncProviderConfigs,
} from "./provider-configs.ts";
import {
  cloneSerializableConfiguredDeviceSyncProviderConfigs,
  parseSerializableConfiguredDeviceSyncProviderConfigs,
  requireSerializableConfigObject,
  requireSerializableString,
} from "./serializable-provider-configs.ts";

import type {
  DeviceSyncEnvSource,
  SerializableConfiguredDeviceSyncProviderConfigs,
} from "./provider-types.ts";

export interface ConfiguredDeviceSyncRuntimeConfig {
  providerConfigs: SerializableConfiguredDeviceSyncProviderConfigs;
  publicBaseUrl: string;
  secret: string;
}

const DEVICE_SYNC_RUNTIME_CONFIG_KEYS = [
  "providerConfigs",
  "publicBaseUrl",
  "secret",
] as const;
const DEVICE_SYNC_PUBLIC_BASE_URL_ENV_KEYS = [
  "DEVICE_SYNC_PUBLIC_BASE_URL",
] as const;
const DEVICE_SYNC_SECRET_ENV_KEYS = [
  "DEVICE_SYNC_SECRET",
] as const;

export function readConfiguredDeviceSyncRuntimeConfig(
  env: DeviceSyncEnvSource,
): ConfiguredDeviceSyncRuntimeConfig | null {
  const providerConfigs = cloneSerializableConfiguredDeviceSyncProviderConfigs(
    readConfiguredDeviceSyncProviderConfigs(env),
  );
  const publicBaseUrl = optionalEnv(env, DEVICE_SYNC_PUBLIC_BASE_URL_ENV_KEYS);
  const secret = optionalEnv(env, DEVICE_SYNC_SECRET_ENV_KEYS);

  if (!publicBaseUrl || !secret) {
    return null;
  }

  return {
    providerConfigs,
    publicBaseUrl,
    secret,
  };
}

export function parseConfiguredDeviceSyncRuntimeConfig(
  value: unknown,
  label: string,
): ConfiguredDeviceSyncRuntimeConfig {
  const record = requireSerializableDeviceSyncRuntimeConfigRecord(value, label);

  return {
    providerConfigs: parseSerializableConfiguredDeviceSyncProviderConfigs(
      record.providerConfigs,
      `${label}.providerConfigs`,
    ),
    publicBaseUrl: requireSerializableString(record.publicBaseUrl, `${label}.publicBaseUrl`),
    secret: requireSerializableString(record.secret, `${label}.secret`),
  };
}

export function cloneConfiguredDeviceSyncRuntimeConfig(
  config: ConfiguredDeviceSyncRuntimeConfig,
): ConfiguredDeviceSyncRuntimeConfig {
  return {
    providerConfigs: parseSerializableConfiguredDeviceSyncProviderConfigs(
      config.providerConfigs,
      "runtimeConfig.providerConfigs",
    ),
    publicBaseUrl: config.publicBaseUrl,
    secret: config.secret,
  };
}

function requireSerializableDeviceSyncRuntimeConfigRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  const record = requireSerializableConfigObject(value, label);
  const supportedKeys = new Set<string>(DEVICE_SYNC_RUNTIME_CONFIG_KEYS);

  for (const key of Object.keys(record)) {
    if (!supportedKeys.has(key)) {
      throw new TypeError(`${label}.${key} is not supported in serialized runtime config.`);
    }
  }

  return record;
}
