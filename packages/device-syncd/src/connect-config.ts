import {
  JUNCTION_API_KEY_ENV_KEYS,
  JUNCTION_CLIENT_USER_ID_SECRET_ENV_KEYS,
  JUNCTION_ENV_ENV_KEYS,
  JUNCTION_PROVIDER_FILTER_ENV_KEYS,
  JUNCTION_REGION_ENV_KEYS,
  JUNCTION_WEBHOOK_SECRET_ENV_KEYS,
  OURA_CLIENT_ID_ENV_KEYS,
  OURA_CLIENT_SECRET_ENV_KEYS,
  STRAVA_CLIENT_ID_ENV_KEYS,
  STRAVA_CLIENT_SECRET_ENV_KEYS,
  WHOOP_CLIENT_ID_ENV_KEYS,
  WHOOP_CLIENT_SECRET_ENV_KEYS,
} from "./config/provider-env.ts";
import {
  optionalEnv,
  parseCsvEnv,
  readOptionalCredentialPair,
} from "./config/provider-config-helpers.ts";
import { assertValidJunctionClientConfig } from "./config/junction-client-config.ts";

export {
  isDeviceConnectSourceAvailableForConnection,
  listConfiguredDeviceSyncConnectTargets,
  listConfiguredDeviceSyncReconnectTargets,
  normalizeDeviceSyncConnectTargetKey,
  resolveConfiguredDeviceSyncConnectTarget,
  resolveConfiguredDeviceSyncConnectTargetBySourceId,
  type DeviceSyncConnectTarget,
} from "./config/connect-targets.ts";
export {
  areJunctionDeviceConnectProviderSlugsEquivalent,
  DEVICE_CONNECT_SOURCE_BY_ID,
  DEVICE_CONNECT_SOURCES,
  JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG,
  JUNCTION_GOOGLE_HEALTH_PROVIDER_SLUG,
  listDefaultJunctionLinkProviderSlugs,
  listDirectDeviceConnectRouteEntries,
  listJunctionDeviceConnectRouteEntries,
  listJunctionLinkDeviceConnectRouteEntries,
  canonicalizeJunctionProviderSlug,
  normalizeDeviceConnectSourceId,
  normalizeJunctionLinkProviderFilter,
  normalizeJunctionProviderSlug,
  resolveDeviceConnectSourceIdForJunctionProviderSlug,
  resolveDeviceConnectSourceById,
  resolveDirectDeviceConnectRouteByProvider,
  resolveJunctionDeviceConnectRouteByProviderSlug,
  resolveJunctionLinkDeviceConnectRouteByProviderSlug,
  type DeviceConnectDirectRoute,
  type DeviceConnectJunctionLinkRoute,
  type DeviceConnectJunctionSdkRoute,
  type DeviceConnectRoute,
  type DeviceConnectRouteEntry,
  type DeviceConnectSource,
  type DeviceConnectUnavailableRoute,
  type DirectDeviceConnectProvider,
} from "./config/connect-routes.ts";
export {
  configuredDeviceSyncProviderKeys,
  listConfiguredDeviceSyncProviderNames,
} from "./config/provider-keys.ts";
export {
  buildJunctionProviderSourceInstanceKey,
  JUNCTION_CONNECT_SOURCE_TARGETS,
  JUNCTION_DEFAULT_PROVIDER_FILTER,
  JUNCTION_LINK_PROVIDER_SLUGS,
  resolveJunctionConnectSourceLabel,
  resolveJunctionConnectTargetForSourceId,
  type JunctionConnectSourceTarget,
} from "./config/junction-connect-sources.ts";

import type {
  ConfiguredDeviceSyncProviderKey,
  ConfiguredDeviceSyncProviderPresence,
  DeviceSyncEnvSource,
} from "./config/provider-types.ts";

export type { ConfiguredDeviceSyncProviderKey };

type DeviceSyncConnectTargetProviderConfigs = ConfiguredDeviceSyncProviderPresence & {
  junction?: { providerFilter?: string[] };
};

export function readConfiguredDeviceSyncConnectTargetConfigs(
  env: DeviceSyncEnvSource,
): DeviceSyncConnectTargetProviderConfigs {
  const configs: DeviceSyncConnectTargetProviderConfigs = {};
  const junctionConfig = readConfiguredJunctionDeviceSyncConnectTargetConfig(env);

  if (junctionConfig) {
    configs.junction = junctionConfig;
  }

  if (readOptionalCredentialPair(env, OURA_CLIENT_ID_ENV_KEYS, OURA_CLIENT_SECRET_ENV_KEYS, "Oura")) {
    configs.oura = {};
  }
  if (readOptionalCredentialPair(env, WHOOP_CLIENT_ID_ENV_KEYS, WHOOP_CLIENT_SECRET_ENV_KEYS, "WHOOP")) {
    configs.whoop = {};
  }
  if (readOptionalCredentialPair(env, STRAVA_CLIENT_ID_ENV_KEYS, STRAVA_CLIENT_SECRET_ENV_KEYS, "Strava")) {
    configs.strava = {};
  }

  return configs;
}

function readConfiguredJunctionDeviceSyncConnectTargetConfig(
  env: DeviceSyncEnvSource,
): { providerFilter?: string[] } | null {
  const apiKey = optionalEnv(env, JUNCTION_API_KEY_ENV_KEYS);
  const clientUserIdSecret = optionalEnv(env, JUNCTION_CLIENT_USER_ID_SECRET_ENV_KEYS);
  const environment = optionalEnv(env, JUNCTION_ENV_ENV_KEYS);
  const region = optionalEnv(env, JUNCTION_REGION_ENV_KEYS);
  const webhookSecret = optionalEnv(env, JUNCTION_WEBHOOK_SECRET_ENV_KEYS);

  if (!apiKey && !clientUserIdSecret && !environment && !region && !webhookSecret) {
    return null;
  }

  if (!apiKey || !clientUserIdSecret || !environment || !region) {
    throw new TypeError(
      "Junction configuration is incomplete. Set JUNCTION_API_KEY, JUNCTION_CLIENT_USER_ID_SECRET, JUNCTION_ENV, and JUNCTION_REGION together.",
    );
  }

  assertValidJunctionConnectTargetConfig({
    apiKey,
    environment: parseJunctionEnvironment(environment),
    region: parseJunctionRegion(region),
  });

  return {
    providerFilter: parseCsvEnv(env, JUNCTION_PROVIDER_FILTER_ENV_KEYS),
  };
}

function assertValidJunctionConnectTargetConfig(input: {
  apiKey: string;
  environment: "sandbox" | "production";
  region: "us" | "eu";
}): void {
  assertValidJunctionClientConfig(input);
}

function parseJunctionEnvironment(value: string): "sandbox" | "production" {
  if (value === "sandbox" || value === "production") {
    return value;
  }

  throw new TypeError("JUNCTION_ENV must be sandbox or production.");
}

function parseJunctionRegion(value: string): "us" | "eu" {
  if (value === "us" || value === "eu") {
    return value;
  }

  throw new TypeError("JUNCTION_REGION must be us or eu.");
}
