import {
  GARMIN_WEARABLE_PROVIDER_DESCRIPTOR,
  JUNCTION_WEARABLE_PROVIDER_DESCRIPTOR,
  OURA_WEARABLE_PROVIDER_DESCRIPTOR,
  STRAVA_WEARABLE_PROVIDER_DESCRIPTOR,
  WHOOP_WEARABLE_PROVIDER_DESCRIPTOR,
  resolveWearableProviderSourcePriority,
  type ResolveWearableProviderSourcePriorityInput,
  type WearableProviderMetricFamily,
  type WearableProviderSourcePriorityHints,
} from "@murphai/health-metrics";

export type DeviceProviderTransportMode =
  | "oauth_callback"
  | "external_link"
  | "scheduled_poll"
  | "webhook_push"
  | "async_export"
  | "sdk_ingestion"
  | "xml_import";

export type DeviceProviderMetricFamily = WearableProviderMetricFamily;

export type DeviceProviderSnapshotParserKind = "schema" | "passthrough";
export type DeviceProviderWebhookDeliveryMode = "notification" | "resource";

export interface DeviceProviderOAuthDescriptor {
  callbackPath: string;
  defaultScopes: readonly string[];
}

export type DeviceConnectionFlowKind =
  | "oauth2"
  | "external_link"
  | "sdk"
  | "manual"
  | "none";

export interface DeviceProviderConnectionDescriptor {
  kind: DeviceConnectionFlowKind;
  callbackPath?: string;
  defaultScopes?: readonly string[];
}

export interface DeviceProviderWebhookDescriptor {
  path: string;
  deliveryMode: DeviceProviderWebhookDeliveryMode;
  supportsAdmin: boolean;
}

export interface DeviceProviderSyncWindowDescriptor {
  backfillDays: number;
  reconcileDays: number;
  reconcileIntervalMs: number;
}

export interface DeviceProviderSyncDescriptor {
  windows: DeviceProviderSyncWindowDescriptor;
  jobKinds: readonly string[];
  supportsRemoteDisconnect: boolean;
  supportsTokenRefresh: boolean;
}

export interface DeviceProviderNormalizationDescriptor {
  metricFamilies: readonly DeviceProviderMetricFamily[];
  snapshotParser: DeviceProviderSnapshotParserKind;
}

export type DeviceProviderSourcePriorityHints =
  WearableProviderSourcePriorityHints;

export interface DeviceProviderDescriptor {
  provider: string;
  /**
   * Implementation/source slugs (such as Junction source-provider slugs) that
   * resolve to this provider's public identity, e.g. `whoop_v2` -> `whoop`.
   */
  aliases?: readonly string[];
  displayName: string;
  transportModes: readonly DeviceProviderTransportMode[];
  connection?: DeviceProviderConnectionDescriptor;
  oauth?: DeviceProviderOAuthDescriptor;
  webhook?: DeviceProviderWebhookDescriptor;
  sync?: DeviceProviderSyncDescriptor;
  normalization: DeviceProviderNormalizationDescriptor;
  sourcePriorityHints: DeviceProviderSourcePriorityHints;
}

export const DEFAULT_DEVICE_SYNC_BACKFILL_DAYS = 180;

export type ResolveDeviceProviderSourcePriorityInput =
  ResolveWearableProviderSourcePriorityInput;

export interface DeviceProviderDescriptorLike {
  provider: string;
}

export interface NamedDeviceProviderRegistry<T extends DeviceProviderDescriptorLike> {
  register(provider: T): void;
  get(provider: string): T | undefined;
  list(): T[];
}

export function normalizeDeviceProviderKey(provider: string): string | undefined {
  if (typeof provider !== "string") {
    return undefined;
  }

  const normalized = provider.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

export function createNamedDeviceProviderRegistry<T extends DeviceProviderDescriptorLike>(
  label: string,
  providers: readonly T[] = [],
): NamedDeviceProviderRegistry<T> {
  const registry = new Map<string, T>();

  const api: NamedDeviceProviderRegistry<T> = {
    register(provider) {
      const key = normalizeDeviceProviderKey(provider.provider);

      if (!key) {
        throw new TypeError("provider must be a non-empty string");
      }

      if (registry.has(key)) {
        throw new TypeError(`${label} \"${key}\" is already registered`);
      }

      registry.set(key, provider);
    },
    get(provider) {
      const key = normalizeDeviceProviderKey(provider);
      return key ? registry.get(key) : undefined;
    },
    list() {
      return [...registry.values()];
    },
  };

  for (const provider of providers) {
    api.register(provider);
  }

  return api;
}

export function requireDeviceProviderOAuthDescriptor(
  descriptor: DeviceProviderDescriptor,
): DeviceProviderOAuthDescriptor {
  if (!descriptor.oauth) {
    throw new TypeError(`${descriptor.provider} does not define OAuth metadata.`);
  }

  return descriptor.oauth;
}

export function resolveDeviceProviderConnectionDescriptor(
  descriptor: DeviceProviderDescriptor,
): DeviceProviderConnectionDescriptor {
  if (descriptor.connection) {
    return descriptor.connection;
  }

  if (descriptor.oauth) {
    return {
      kind: "oauth2",
      callbackPath: descriptor.oauth.callbackPath,
      defaultScopes: descriptor.oauth.defaultScopes,
    };
  }

  return {
    kind: "none",
  };
}

export function requireDeviceProviderWebhookDescriptor(
  descriptor: DeviceProviderDescriptor,
): DeviceProviderWebhookDescriptor {
  if (!descriptor.webhook) {
    throw new TypeError(`${descriptor.provider} does not define webhook metadata.`);
  }

  return descriptor.webhook;
}

export function requireDeviceProviderSyncDescriptor(
  descriptor: DeviceProviderDescriptor,
): DeviceProviderSyncDescriptor {
  if (!descriptor.sync) {
    throw new TypeError(`${descriptor.provider} does not define sync metadata.`);
  }

  return descriptor.sync;
}

export function resolveDeviceProviderSourcePriority(
  descriptor: DeviceProviderDescriptor,
  input: ResolveDeviceProviderSourcePriorityInput = {},
): number {
  return resolveWearableProviderSourcePriority(descriptor, input);
}

// Garmin has no direct import adapter (ingestion is Junction-only), but the
// descriptor stays registered: it is Garmin's public identity for data already
// in vaults - the query layer resolves the "Garmin" display name and
// per-metric selection priorities from this registry.
export const GARMIN_DEVICE_PROVIDER_DESCRIPTOR = {
  ...GARMIN_WEARABLE_PROVIDER_DESCRIPTOR,
  transportModes: ["async_export"],
  connection: {
    kind: "none",
  },
  normalization: {
    metricFamilies: [
      "activity",
      "sleep",
      "cardio",
      "respiration",
      "temperature",
      "women_health",
    ],
    snapshotParser: "schema",
  },
} as const satisfies DeviceProviderDescriptor;

export const OURA_DEVICE_PROVIDER_DESCRIPTOR = {
  ...OURA_WEARABLE_PROVIDER_DESCRIPTOR,
  transportModes: ["oauth_callback", "scheduled_poll", "webhook_push"],
  connection: {
    kind: "oauth2",
    callbackPath: "/oauth/oura/callback",
    defaultScopes: ["personal", "daily", "workout", "session", "spo2"],
  },
  oauth: {
    callbackPath: "/oauth/oura/callback",
    defaultScopes: ["personal", "daily", "workout", "session", "spo2"],
  },
  webhook: {
    path: "/webhooks/oura",
    deliveryMode: "resource",
    supportsAdmin: true,
  },
  sync: {
    windows: {
      backfillDays: DEFAULT_DEVICE_SYNC_BACKFILL_DAYS,
      reconcileDays: 21,
      reconcileIntervalMs: 6 * 60 * 60_000,
    },
    jobKinds: ["backfill", "reconcile", "resource", "delete"],
    supportsRemoteDisconnect: true,
    supportsTokenRefresh: true,
  },
  normalization: {
    metricFamilies: [
      "activity",
      "sleep",
      "readiness",
      "cardio",
      "respiration",
      "blood_oxygen",
      "session",
    ],
    snapshotParser: "schema",
  },
} as const satisfies DeviceProviderDescriptor;

export const STRAVA_DEVICE_PROVIDER_DESCRIPTOR = {
  ...STRAVA_WEARABLE_PROVIDER_DESCRIPTOR,
  transportModes: ["oauth_callback", "scheduled_poll", "webhook_push"],
  connection: {
    kind: "oauth2",
    callbackPath: "/oauth/strava/callback",
    defaultScopes: ["activity:read"],
  },
  oauth: {
    callbackPath: "/oauth/strava/callback",
    defaultScopes: ["activity:read"],
  },
  webhook: {
    path: "/webhooks/strava",
    deliveryMode: "notification",
    supportsAdmin: true,
  },
  sync: {
    windows: {
      backfillDays: 30,
      reconcileDays: 7,
      reconcileIntervalMs: 6 * 60 * 60_000,
    },
    jobKinds: ["backfill", "reconcile", "resource", "delete", "deauthorize"],
    supportsRemoteDisconnect: true,
    supportsTokenRefresh: true,
  },
  normalization: {
    metricFamilies: ["activity", "cardio", "session"],
    snapshotParser: "schema",
  },
} as const satisfies DeviceProviderDescriptor;

export const WHOOP_DEVICE_PROVIDER_DESCRIPTOR = {
  ...WHOOP_WEARABLE_PROVIDER_DESCRIPTOR,
  transportModes: ["oauth_callback", "scheduled_poll", "webhook_push"],
  connection: {
    kind: "oauth2",
    callbackPath: "/oauth/whoop/callback",
    defaultScopes: [
      "offline",
      "read:profile",
      "read:body_measurement",
      "read:sleep",
      "read:recovery",
      "read:cycles",
      "read:workout",
    ],
  },
  oauth: {
    callbackPath: "/oauth/whoop/callback",
    defaultScopes: [
      "offline",
      "read:profile",
      "read:body_measurement",
      "read:sleep",
      "read:recovery",
      "read:cycles",
      "read:workout",
    ],
  },
  webhook: {
    path: "/webhooks/whoop",
    deliveryMode: "resource",
    supportsAdmin: false,
  },
  sync: {
    windows: {
      backfillDays: DEFAULT_DEVICE_SYNC_BACKFILL_DAYS,
      reconcileDays: 21,
      reconcileIntervalMs: 6 * 60 * 60_000,
    },
    jobKinds: ["backfill", "reconcile", "resource", "delete"],
    supportsRemoteDisconnect: true,
    supportsTokenRefresh: true,
  },
  normalization: {
    metricFamilies: ["activity", "sleep", "recovery", "body", "respiration", "temperature"],
    snapshotParser: "schema",
  },
} as const satisfies DeviceProviderDescriptor;

export const JUNCTION_DEVICE_PROVIDER_DESCRIPTOR = {
  ...JUNCTION_WEARABLE_PROVIDER_DESCRIPTOR,
  transportModes: ["external_link", "scheduled_poll", "webhook_push"],
  connection: {
    kind: "external_link",
    callbackPath: "/connect/junction/callback",
  },
  webhook: {
    path: "/webhooks/junction",
    deliveryMode: "resource",
    supportsAdmin: false,
  },
  sync: {
    windows: {
      backfillDays: DEFAULT_DEVICE_SYNC_BACKFILL_DAYS,
      reconcileDays: 7,
      reconcileIntervalMs: 60 * 60_000,
    },
    jobKinds: ["backfill", "reconcile", "resource"],
    supportsRemoteDisconnect: true,
    supportsTokenRefresh: false,
  },
  normalization: {
    metricFamilies: ["activity", "sleep", "recovery", "cardio", "respiration", "blood_oxygen", "body", "session"],
    snapshotParser: "schema",
  },
} as const satisfies DeviceProviderDescriptor;

export const defaultDeviceProviderDescriptors = Object.freeze([
  WHOOP_DEVICE_PROVIDER_DESCRIPTOR,
  OURA_DEVICE_PROVIDER_DESCRIPTOR,
  GARMIN_DEVICE_PROVIDER_DESCRIPTOR,
  STRAVA_DEVICE_PROVIDER_DESCRIPTOR,
  JUNCTION_DEVICE_PROVIDER_DESCRIPTOR,
] as const);

function buildDeviceProviderDescriptorLookup(
  descriptors: readonly DeviceProviderDescriptor[],
): Map<string, DeviceProviderDescriptor> {
  const lookup = new Map<string, DeviceProviderDescriptor>();

  for (const descriptor of descriptors) {
    const providerKey = normalizeDeviceProviderKey(descriptor.provider);
    if (!providerKey) {
      throw new TypeError("provider descriptor must define a non-empty provider");
    }

    for (const rawKey of [descriptor.provider, ...(descriptor.aliases ?? [])]) {
      const key = normalizeDeviceProviderKey(rawKey);
      if (!key) {
        throw new TypeError(`${descriptor.provider} defines a blank provider alias`);
      }

      const existing = lookup.get(key);
      if (existing && existing.provider !== descriptor.provider) {
        throw new TypeError(
          `provider key "${key}" resolves to both "${existing.provider}" and "${descriptor.provider}"`,
        );
      }

      lookup.set(key, descriptor);
    }
  }

  return lookup;
}

const defaultDeviceProviderDescriptorLookup = buildDeviceProviderDescriptorLookup(defaultDeviceProviderDescriptors);

export function resolveDeviceProviderDescriptor(
  provider: string,
  descriptors: readonly DeviceProviderDescriptor[] = defaultDeviceProviderDescriptors,
): DeviceProviderDescriptor | undefined {
  const key = normalizeDeviceProviderKey(provider);

  if (!key) {
    return undefined;
  }

  const lookup = descriptors === defaultDeviceProviderDescriptors
    ? defaultDeviceProviderDescriptorLookup
    : buildDeviceProviderDescriptorLookup(descriptors);
  return lookup.get(key);
}

export function canonicalizeDeviceProviderSlug(
  provider: string,
  descriptors: readonly DeviceProviderDescriptor[] = defaultDeviceProviderDescriptors,
): string {
  const key = normalizeDeviceProviderKey(provider);

  if (!key) {
    return "";
  }

  return resolveDeviceProviderDescriptor(key, descriptors)?.provider ?? key;
}
