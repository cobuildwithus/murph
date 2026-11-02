import type { DeviceSyncLogger } from "./types.ts";

export function createConsoleDeviceSyncLogger(consoleLike: Console = console): DeviceSyncLogger {
  return {
    debug(message, context) {
      consoleLike.debug?.(message, context ?? {});
    },
    info(message, context) {
      consoleLike.info?.(message, context ?? {});
    },
    warn(message, context) {
      consoleLike.warn?.(message, context ?? {});
    },
    error(message, context) {
      consoleLike.error?.(message, context ?? {});
    },
  };
}

export {
  deviceSyncProviderRuntimeSecretEnvKeys,
  deviceSyncProviderRuntimeVariableEnvKeys,
} from "./config/env-keys.ts";
export {
  configuredDeviceSyncProviderKeys,
  hasConfiguredDeviceSyncProviderConfigs,
  JUNCTION_PRODUCTION_TIMESERIES_RESOURCES,
  listConfiguredDeviceSyncProviderNames,
  readConfiguredDeviceSyncProviderConfigs,
  readConfiguredJunctionDeviceSyncProviderConfig,
} from "./config/provider-configs.ts";
export {
  deviceSyncProviderManifests,
  getConfiguredDeviceSyncProviderManifest,
  listDeviceSyncProviderCatalog,
  listConfiguredDeviceSyncProviderManifests,
  requireConfiguredDeviceSyncProviderManifest,
  resolveConfiguredDeviceSyncProviderManifest,
} from "./config/provider-manifests.ts";
export {
  getConfiguredDeviceSyncProviderJobDefinition,
  normalizeConfiguredDeviceSyncJobInput,
  normalizeConfiguredDeviceSyncJobRecord,
  shapeConfiguredDeviceSyncHostedHintPayload,
} from "./provider-job-definitions.ts";
export {
  resolveConfiguredDeviceSyncProviderCredentialPolicy,
  resolveDeviceSyncProviderCredentialPolicy,
} from "./provider-credential-policy.ts";
export {
  createConfiguredDeviceSyncProviders,
  createConfiguredDeviceSyncProvidersFromConfigs,
  createConfiguredDeviceSyncRegistry,
  createConfiguredDeviceSyncRegistryFromConfigs,
} from "./config/provider-factory.ts";
export {
  cloneSerializableConfiguredDeviceSyncProviderConfigs,
  parseSerializableConfiguredDeviceSyncProviderConfigs,
} from "./config/serializable-provider-configs.ts";
export {
  cloneConfiguredDeviceSyncRuntimeConfig,
  parseConfiguredDeviceSyncRuntimeConfig,
  readConfiguredDeviceSyncRuntimeConfig,
} from "./config/runtime-config.ts";
export {
  isDeviceConnectSourceAvailableForConnection,
  listConfiguredDeviceSyncConnectTargets,
  listConfiguredDeviceSyncReconnectTargets,
  normalizeDeviceSyncConnectTargetKey,
  resolveConfiguredDeviceSyncConnectTarget,
  resolveConfiguredDeviceSyncConnectTargetBySourceId,
} from "./config/connect-targets.ts";
export {
  DEVICE_CONNECT_SOURCE_BY_ID,
  DEVICE_CONNECT_SOURCES,
  listDefaultJunctionLinkProviderSlugs,
  listJunctionDeviceConnectRouteEntries,
  listJunctionLinkDeviceConnectRouteEntries,
  normalizeDeviceConnectSourceId,
  normalizeJunctionLinkProviderFilter,
  normalizeJunctionProviderSlug,
  resolveDeviceConnectSourceById,
  resolveJunctionDeviceConnectRouteByProviderSlug,
  resolveJunctionLinkDeviceConnectRouteByProviderSlug,
} from "./config/connect-routes.ts";
export {
  buildJunctionProviderSourceInstanceKey,
  JUNCTION_CONNECT_SOURCE_TARGETS,
  JUNCTION_DEFAULT_PROVIDER_FILTER,
  JUNCTION_LINK_PROVIDER_SLUGS,
  resolveJunctionConnectSourceLabel,
  resolveJunctionConnectTargetForSourceId,
} from "./config/junction-connect-sources.ts";

export type {
  ConfiguredDeviceSyncProviderConfigByKey,
  ConfiguredDeviceSyncProviderConfigs,
  ConfiguredDeviceSyncProviderKey,
} from "./config/provider-configs.ts";
export type {
  DeviceSyncConnectTarget,
} from "./config/connect-targets.ts";
export type {
  DeviceConnectJunctionLinkRoute,
  DeviceConnectJunctionSdkRoute,
  DeviceConnectRoute,
  DeviceConnectRouteEntry,
  DeviceConnectSource,
  DeviceConnectUnavailableRoute,
} from "./config/connect-routes.ts";
export type {
  JunctionConnectSourceTarget,
} from "./config/junction-connect-sources.ts";
export type {
  ConfiguredDeviceSyncProviderCapabilities,
  DeviceSyncProviderCatalogEntry,
  DeviceSyncJobPayloadFieldKind,
  DeviceSyncJobPayloadFieldSpec,
  DeviceSyncProviderJobDefinition,
  DeviceSyncProviderJobDefinitionMap,
  DeviceSyncConfiguredProviderManifest,
  DeviceSyncConfiguredProviderManifestByKey,
  HostedHintFieldKind,
  HostedHintPayloadFieldMap,
  SerializableConfigFieldKind,
} from "./config/provider-manifests.ts";
export type {
  SerializableConfiguredDeviceSyncProviderConfigByKey,
  SerializableConfiguredDeviceSyncProviderConfigs,
} from "./config/serializable-provider-configs.ts";
export type { ConfiguredDeviceSyncRuntimeConfig } from "./config/runtime-config.ts";
