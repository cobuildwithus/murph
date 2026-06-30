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
  requireDeviceProviderOAuthDescriptor,
  requireDeviceProviderSyncDescriptor,
  type DeviceProviderDescriptor,
} from "@murphai/importers/device-providers/provider-descriptors";

import { normalizeString } from "./shared.ts";
import { normalizeJunctionProviderFilter } from "./config/junction-connect-sources.ts";

import type {
  ConfiguredDeviceSyncProviderConfigByKey,
  ConfiguredDeviceSyncProviderKey,
  JunctionDeviceSyncProviderConfig,
  OuraDeviceSyncProviderConfig,
  StravaDeviceSyncProviderConfig,
  WhoopDeviceSyncProviderConfig,
} from "./config/provider-types.ts";

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

export interface NormalizedJunctionDeviceSyncRuntimeConfig {
  clientUserIdSecret: string;
  providerFilter: string[];
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
      normalizeJunctionDeviceSyncRuntimeConfig(
        config as ConfiguredDeviceSyncProviderConfigByKey["junction"],
      );
      return JUNCTION_DEVICE_PROVIDER_DESCRIPTOR;
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

  if (providerFilter.length === 0) {
    throw new TypeError("Junction provider filter must include at least one hosted Link provider.");
  }

  return {
    clientUserIdSecret,
    providerFilter,
    summaryResources,
    timeseriesResources,
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
    ...OURA_DEVICE_PROVIDER_DESCRIPTOR,
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
    ...STRAVA_DEVICE_PROVIDER_DESCRIPTOR,
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
    ...WHOOP_DEVICE_PROVIDER_DESCRIPTOR,
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

  return [...new Set(normalized.filter((entry) => allowedResourceSet.has(entry)))];
}
