import {
  configuredDeviceSyncProviderKeys,
  listConfiguredDeviceSyncProviderNames,
} from "./provider-keys.ts";
import {
  optionalEnv,
  parseCsvEnv,
  parseIntegerEnv,
  parsePortEnv,
  readOptionalCredentialPair,
  requireEnv,
} from "./provider-config-helpers.ts";

import type {
  ConfiguredDeviceSyncProviderConfigByKey,
  ConfiguredDeviceSyncProviderConfigs,
  ConfiguredDeviceSyncProviderKey,
  ConfiguredDeviceSyncProviderPresence,
  DeviceSyncEnvSource,
} from "./provider-types.ts";

import {
  JUNCTION_PRODUCTION_TIMESERIES_RESOURCES,
  readConfiguredJunctionDeviceSyncProviderConfig,
} from "./junction-config.ts";

export type {
  ConfiguredDeviceSyncProviderConfigByKey,
  ConfiguredDeviceSyncProviderConfigs,
  ConfiguredDeviceSyncProviderKey,
  ConfiguredDeviceSyncProviderPresence,
  DeviceSyncEnvSource,
} from "./provider-types.ts";

export { configuredDeviceSyncProviderKeys };
export {
  JUNCTION_PRODUCTION_TIMESERIES_RESOURCES,
  readConfiguredJunctionDeviceSyncProviderConfig,
};

export function readConfiguredDeviceSyncProviderConfigs(
  env: DeviceSyncEnvSource,
): ConfiguredDeviceSyncProviderConfigs {
  const configs: ConfiguredDeviceSyncProviderConfigs = {};

  const junction = readConfiguredJunctionDeviceSyncProviderConfig(env);
  if (junction) {
    configs.junction = junction;
  }

  return configs;
}

export function hasConfiguredDeviceSyncProviderConfigs(
  configs: ConfiguredDeviceSyncProviderPresence,
): boolean {
  return listConfiguredDeviceSyncProviderNames(configs).length > 0;
}

export { listConfiguredDeviceSyncProviderNames };

export {
  optionalEnv,
  parseCsvEnv,
  parseIntegerEnv,
  parsePortEnv,
  requireEnv,
} from "./provider-config-helpers.ts";
