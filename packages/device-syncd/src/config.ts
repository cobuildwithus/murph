import {
  assertLoopbackListenerHost,
  assertUnbracketedListenerHost,
} from "@murphai/runtime-state/loopback-control-plane";

import {
  DEVICE_SYNC_ALLOWED_RETURN_ORIGINS_ENV_KEYS,
  DEVICE_SYNC_CONTROL_TOKEN_ENV_KEYS,
  DEVICE_SYNC_HOST_ENV_KEYS,
  DEVICE_SYNC_PORT_ENV_KEYS,
  DEVICE_SYNC_PUBLIC_BASE_URL_ENV_KEYS,
  DEVICE_SYNC_PUBLIC_HOST_ENV_KEYS,
  DEVICE_SYNC_PUBLIC_PORT_ENV_KEYS,
  DEVICE_SYNC_SCHEDULER_POLL_MS_ENV_KEYS,
  DEVICE_SYNC_SECRET_ENV_KEYS,
  DEVICE_SYNC_SESSION_TTL_MS_ENV_KEYS,
  DEVICE_SYNC_STATE_DB_PATH_ENV_KEYS,
  DEVICE_SYNC_VAULT_ROOT_ENV_KEYS,
  DEVICE_SYNC_WORKER_BATCH_SIZE_ENV_KEYS,
  DEVICE_SYNC_WORKER_LEASE_MS_ENV_KEYS,
  DEVICE_SYNC_WORKER_POLL_MS_ENV_KEYS,
} from "./config/env-keys.ts";
import {
  parseCsvEnv,
  parseIntegerEnv,
  parsePortEnv,
  optionalEnv,
  requireEnv,
} from "./config/provider-configs.ts";
import { createConfiguredDeviceSyncProviders } from "./config/provider-factory.ts";

import { DEFAULT_DEVICE_SYNC_HOST } from "./shared.ts";
export { resolveDeviceProviderMatchKeys } from "./provider-match.ts";

import type { DeviceSyncEnvSource } from "./config/provider-configs.ts";
import type { DeviceSyncHttpConfig, DeviceSyncLogger } from "./types.ts";
import type { CreateDeviceSyncServiceInput } from "./service.ts";

export interface LoadedDeviceSyncEnvironment {
  service: CreateDeviceSyncServiceInput;
  http: DeviceSyncHttpConfig;
}

export function loadDeviceSyncEnvironment(env: NodeJS.ProcessEnv = process.env): LoadedDeviceSyncEnvironment {
  const vaultRoot = requireEnv(env, DEVICE_SYNC_VAULT_ROOT_ENV_KEYS);
  const publicBaseUrl = requireEnv(env, DEVICE_SYNC_PUBLIC_BASE_URL_ENV_KEYS);
  const secret = requireEnv(env, DEVICE_SYNC_SECRET_ENV_KEYS);
  const controlToken = requireEnv(env, DEVICE_SYNC_CONTROL_TOKEN_ENV_KEYS);
  const logger = createConsoleDeviceSyncLogger();
  const providers = createConfiguredDeviceSyncProviders(env);
  const publicListener = readOptionalPublicListener(env);
  const host = optionalEnv(env, DEVICE_SYNC_HOST_ENV_KEYS) ?? DEFAULT_DEVICE_SYNC_HOST;

  assertLoopbackListenerHost(
    host,
    "DEVICE_SYNC_HOST must be a loopback hostname or address. Use DEVICE_SYNC_PUBLIC_HOST and DEVICE_SYNC_PUBLIC_PORT for externally reachable callback and webhook routes.",
  );

  if (providers.length === 0) {
    throw new TypeError(
      "No device sync providers are configured. Set at least one supported device provider client credential pair before starting device-syncd.",
    );
  }

  return {
    service: {
      secret,
      config: {
        vaultRoot,
        publicBaseUrl,
        allowedReturnOrigins: parseCsvEnv(env, DEVICE_SYNC_ALLOWED_RETURN_ORIGINS_ENV_KEYS),
        stateDatabasePath: optionalEnv(env, DEVICE_SYNC_STATE_DB_PATH_ENV_KEYS),
        sessionTtlMs: parseIntegerEnv(env, DEVICE_SYNC_SESSION_TTL_MS_ENV_KEYS),
        workerLeaseMs: parseIntegerEnv(env, DEVICE_SYNC_WORKER_LEASE_MS_ENV_KEYS),
        workerPollMs: parseIntegerEnv(env, DEVICE_SYNC_WORKER_POLL_MS_ENV_KEYS),
        workerBatchSize: parseIntegerEnv(env, DEVICE_SYNC_WORKER_BATCH_SIZE_ENV_KEYS),
        schedulerPollMs: parseIntegerEnv(env, DEVICE_SYNC_SCHEDULER_POLL_MS_ENV_KEYS),
        log: logger,
      },
      providers,
    },
    http: {
      host,
      port: parsePortEnv(env, DEVICE_SYNC_PORT_ENV_KEYS) ?? 8788,
      controlToken,
      ...publicListener,
    },
  };
}

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

function readOptionalPublicListener(
  env: DeviceSyncEnvSource,
): Pick<DeviceSyncHttpConfig, "publicHost" | "publicPort"> {
  const publicHost = optionalEnv(env, DEVICE_SYNC_PUBLIC_HOST_ENV_KEYS);
  const publicPort = parsePortEnv(env, DEVICE_SYNC_PUBLIC_PORT_ENV_KEYS);

  if (!publicHost && publicPort === undefined) {
    return {};
  }

  if (!publicHost || publicPort === undefined) {
    throw new TypeError(
      "Set DEVICE_SYNC_PUBLIC_HOST and DEVICE_SYNC_PUBLIC_PORT together to enable the public callback/webhook listener.",
    );
  }

  assertUnbracketedListenerHost(
    publicHost,
    "DEVICE_SYNC_PUBLIC_HOST must be a hostname or address without URL bracket syntax. Use ::1, not [::1].",
  );

  return {
    publicHost,
    publicPort,
  };
}

export {
  DEVICE_SYNC_CONTROL_TOKEN_ENV_KEYS,
  DEVICE_SYNC_SECRET_ENV_KEYS,
  deviceSyncProviderRuntimeSecretEnvKeys,
  deviceSyncProviderRuntimeVariableEnvKeys,
} from "./config/env-keys.ts";
export {
  configuredDeviceSyncProviderKeys,
  hasConfiguredDeviceSyncProviderConfigs,
  listConfiguredDeviceSyncProviderNames,
  readConfiguredDeviceSyncProviderConfigs,
  readConfiguredJunctionDeviceSyncProviderConfig,
  readConfiguredOuraDeviceSyncProviderConfig,
  readConfiguredStravaDeviceSyncProviderConfig,
  readConfiguredWhoopDeviceSyncProviderConfig,
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
  listDirectDeviceConnectRouteEntries,
  listJunctionDeviceConnectRouteEntries,
  listJunctionLinkDeviceConnectRouteEntries,
  normalizeDeviceConnectSourceId,
  normalizeJunctionLinkProviderFilter,
  normalizeJunctionProviderSlug,
  resolveDeviceConnectSourceById,
  resolveDirectDeviceConnectRouteByProvider,
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
  DeviceConnectDirectRoute,
  DeviceConnectJunctionLinkRoute,
  DeviceConnectJunctionSdkRoute,
  DeviceConnectRoute,
  DeviceConnectRouteEntry,
  DeviceConnectSource,
  DeviceConnectUnavailableRoute,
  DirectDeviceConnectProvider,
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
