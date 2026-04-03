export type DeviceProviderTransportMode =
  | "oauth_callback"
  | "scheduled_poll"
  | "webhook_push"
  | "async_export"
  | "sdk_ingestion"
  | "xml_import";

export type DeviceProviderMetricFamily =
  | "activity"
  | "sleep"
  | "recovery"
  | "readiness"
  | "cardio"
  | "respiration"
  | "temperature"
  | "blood_oxygen"
  | "body"
  | "women_health"
  | "session";

export type DeviceProviderSnapshotParserKind = "schema" | "passthrough";
export type DeviceProviderWebhookDeliveryMode = "notification" | "resource";

export interface DeviceProviderOAuthDescriptor {
  callbackPath: string;
  defaultScopes: readonly string[];
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

export interface DeviceProviderSourcePriorityHints {
  defaultPriority: number;
  metricFamilies: Partial<Record<DeviceProviderMetricFamily, number>>;
}

export interface DeviceProviderDescriptor {
  provider: string;
  displayName: string;
  transportModes: readonly DeviceProviderTransportMode[];
  oauth?: DeviceProviderOAuthDescriptor;
  webhook?: DeviceProviderWebhookDescriptor;
  sync?: DeviceProviderSyncDescriptor;
  normalization: DeviceProviderNormalizationDescriptor;
  sourcePriorityHints: DeviceProviderSourcePriorityHints;
}

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

export const GARMIN_DEVICE_PROVIDER_DESCRIPTOR = {
  provider: "garmin",
  displayName: "Garmin",
  transportModes: ["oauth_callback", "scheduled_poll"],
  oauth: {
    callbackPath: "/oauth/garmin/callback",
    defaultScopes: [],
  },
  sync: {
    windows: {
      backfillDays: 30,
      reconcileDays: 7,
      reconcileIntervalMs: 6 * 60 * 60_000,
    },
    jobKinds: ["backfill", "reconcile"],
    supportsRemoteDisconnect: true,
    supportsTokenRefresh: true,
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
  sourcePriorityHints: {
    defaultPriority: 70,
    metricFamilies: {
      activity: 100,
      cardio: 80,
      sleep: 65,
      respiration: 65,
      temperature: 60,
      women_health: 100,
    },
  },
} as const satisfies DeviceProviderDescriptor;

export const OURA_DEVICE_PROVIDER_DESCRIPTOR = {
  provider: "oura",
  displayName: "Oura",
  transportModes: ["oauth_callback", "scheduled_poll", "webhook_push"],
  oauth: {
    callbackPath: "/oauth/oura/callback",
    defaultScopes: ["personal", "daily", "heartrate", "workout", "session", "spo2"],
  },
  webhook: {
    path: "/webhooks/oura",
    deliveryMode: "resource",
    supportsAdmin: true,
  },
  sync: {
    windows: {
      backfillDays: 90,
      reconcileDays: 21,
      reconcileIntervalMs: 6 * 60 * 60_000,
    },
    jobKinds: ["backfill", "reconcile", "resource", "delete"],
    supportsRemoteDisconnect: false,
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
    snapshotParser: "passthrough",
  },
  sourcePriorityHints: {
    defaultPriority: 85,
    metricFamilies: {
      sleep: 100,
      readiness: 100,
      blood_oxygen: 100,
      session: 90,
      cardio: 85,
      respiration: 80,
      activity: 75,
    },
  },
} as const satisfies DeviceProviderDescriptor;

export const WHOOP_DEVICE_PROVIDER_DESCRIPTOR = {
  provider: "whoop",
  displayName: "WHOOP",
  transportModes: ["oauth_callback", "scheduled_poll", "webhook_push"],
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
      backfillDays: 90,
      reconcileDays: 21,
      reconcileIntervalMs: 6 * 60 * 60_000,
    },
    jobKinds: ["backfill", "reconcile", "resource", "delete"],
    supportsRemoteDisconnect: true,
    supportsTokenRefresh: true,
  },
  normalization: {
    metricFamilies: ["activity", "sleep", "recovery", "body", "respiration", "temperature"],
    snapshotParser: "passthrough",
  },
  sourcePriorityHints: {
    defaultPriority: 80,
    metricFamilies: {
      recovery: 100,
      sleep: 95,
      body: 90,
      respiration: 85,
      temperature: 85,
      activity: 80,
    },
  },
} as const satisfies DeviceProviderDescriptor;

export const defaultDeviceProviderDescriptors = Object.freeze([
  WHOOP_DEVICE_PROVIDER_DESCRIPTOR,
  OURA_DEVICE_PROVIDER_DESCRIPTOR,
  GARMIN_DEVICE_PROVIDER_DESCRIPTOR,
] as const);

export function resolveDeviceProviderDescriptor(
  provider: string,
  descriptors: readonly DeviceProviderDescriptor[] = defaultDeviceProviderDescriptors,
): DeviceProviderDescriptor | undefined {
  const key = normalizeDeviceProviderKey(provider);

  if (!key) {
    return undefined;
  }

  return descriptors.find((descriptor) => normalizeDeviceProviderKey(descriptor.provider) === key);
}
