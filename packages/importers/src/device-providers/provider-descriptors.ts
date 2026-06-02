export type DeviceProviderTransportMode =
  | "oauth_callback"
  | "external_link"
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

export interface DeviceProviderSourcePriorityHints {
  defaultPriority: number;
  metricFamilies: Partial<Record<DeviceProviderMetricFamily, number>>;
  metrics?: Partial<Record<string, number>>;
}

export interface DeviceProviderDescriptor {
  provider: string;
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

export interface ResolveDeviceProviderSourcePriorityInput {
  metric?: string | null;
  metricFamily?: DeviceProviderMetricFamily | null;
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
  const metric = normalizeDeviceProviderMetricKey(input.metric);
  const metricPriority = metric ? descriptor.sourcePriorityHints.metrics?.[metric] : undefined;

  if (typeof metricPriority === "number" && Number.isFinite(metricPriority)) {
    return metricPriority;
  }

  const familyPriority = input.metricFamily
    ? descriptor.sourcePriorityHints.metricFamilies[input.metricFamily]
    : undefined;

  if (typeof familyPriority === "number" && Number.isFinite(familyPriority)) {
    return familyPriority;
  }

  return descriptor.sourcePriorityHints.defaultPriority;
}

function normalizeDeviceProviderMetricKey(metric: string | null | undefined): string | null {
  if (typeof metric !== "string") {
    return null;
  }

  const normalized = metric.trim();
  return normalized.length > 0 ? normalized : null;
}

const GARMIN_DEVICE_PROVIDER_METRIC_PRIORITIES = Object.freeze({
  activeCalories: 100,
  activityScore: 90,
  averageHeartRate: 80,
  awakeMinutes: 80,
  bmi: 100,
  bodyBattery: 100,
  bodyFatPercentage: 100,
  dayStrain: 90,
  deepMinutes: 80,
  distanceKm: 100,
  hrv: 80,
  lightMinutes: 80,
  lowestHeartRate: 90,
  readinessScore: 80,
  recoveryScore: 80,
  remMinutes: 80,
  respiratoryRate: 80,
  restingHeartRate: 90,
  sessionCount: 100,
  sessionMinutes: 90,
  sleepConsistency: 80,
  sleepEfficiency: 80,
  sleepPerformance: 80,
  sleepScore: 90,
  spo2: 80,
  steps: 100,
  stressLevel: 100,
  temperature: 90,
  temperatureDeviation: 80,
  timeInBedMinutes: 90,
  totalCalories: 100,
  totalSleepMinutes: 80,
  weightKg: 100,
} as const satisfies Record<string, number>);

const OURA_DEVICE_PROVIDER_METRIC_PRIORITIES = Object.freeze({
  activeCalories: 90,
  activityScore: 100,
  averageHeartRate: 100,
  awakeMinutes: 100,
  bmi: 90,
  bodyBattery: 90,
  bodyFatPercentage: 90,
  dayStrain: 80,
  deepMinutes: 100,
  distanceKm: 90,
  hrv: 100,
  lightMinutes: 100,
  lowestHeartRate: 100,
  readinessScore: 100,
  recoveryScore: 90,
  remMinutes: 100,
  respiratoryRate: 100,
  restingHeartRate: 80,
  sessionCount: 80,
  sessionMinutes: 100,
  sleepConsistency: 90,
  sleepEfficiency: 100,
  sleepPerformance: 90,
  sleepScore: 100,
  spo2: 100,
  steps: 90,
  stressLevel: 80,
  temperature: 80,
  temperatureDeviation: 100,
  timeInBedMinutes: 100,
  totalCalories: 90,
  totalSleepMinutes: 100,
  weightKg: 90,
} as const satisfies Record<string, number>);

const WHOOP_DEVICE_PROVIDER_METRIC_PRIORITIES = Object.freeze({
  activeCalories: 80,
  activityScore: 80,
  averageHeartRate: 90,
  awakeMinutes: 90,
  bmi: 80,
  bodyBattery: 80,
  bodyFatPercentage: 80,
  dayStrain: 100,
  deepMinutes: 90,
  distanceKm: 80,
  hrv: 90,
  lightMinutes: 90,
  lowestHeartRate: 80,
  readinessScore: 90,
  recoveryScore: 100,
  remMinutes: 90,
  respiratoryRate: 90,
  restingHeartRate: 100,
  sessionCount: 90,
  sessionMinutes: 80,
  sleepConsistency: 100,
  sleepEfficiency: 90,
  sleepPerformance: 100,
  sleepScore: 80,
  spo2: 90,
  steps: 80,
  stressLevel: 90,
  temperature: 100,
  temperatureDeviation: 90,
  timeInBedMinutes: 80,
  totalCalories: 80,
  totalSleepMinutes: 90,
  weightKg: 80,
} as const satisfies Record<string, number>);

const STRAVA_DEVICE_PROVIDER_METRIC_PRIORITIES = Object.freeze({
  activeCalories: 85,
  averageHeartRate: 95,
  averageSpeedMps: 90,
  distanceKm: 100,
  maxHeartRate: 95,
  maxSpeedMps: 90,
  sessionCount: 80,
  sessionMinutes: 100,
  totalCalories: 85,
  totalElevationGainMeters: 90,
} as const satisfies Record<string, number>);

const JUNCTION_DEVICE_PROVIDER_METRIC_PRIORITIES = Object.freeze({
  activeCalories: 55,
  activityScore: 55,
  averageHeartRate: 55,
  awakeMinutes: 55,
  bmi: 55,
  bodyFatPercentage: 55,
  deepMinutes: 55,
  distanceKm: 55,
  hrv: 55,
  lightMinutes: 55,
  maxHeartRate: 55,
  remMinutes: 55,
  respiratoryRate: 55,
  restingHeartRate: 55,
  sleepScore: 55,
  spo2: 55,
  steps: 55,
  stressLevel: 55,
  totalCalories: 55,
  totalSleepMinutes: 55,
  weightKg: 55,
} as const satisfies Record<string, number>);

export const GARMIN_DEVICE_PROVIDER_DESCRIPTOR = {
  provider: "garmin",
  displayName: "Garmin",
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
    metrics: GARMIN_DEVICE_PROVIDER_METRIC_PRIORITIES,
  },
} as const satisfies DeviceProviderDescriptor;

export const OURA_DEVICE_PROVIDER_DESCRIPTOR = {
  provider: "oura",
  displayName: "Oura",
  transportModes: ["oauth_callback", "scheduled_poll", "webhook_push"],
  connection: {
    kind: "oauth2",
    callbackPath: "/oauth/oura/callback",
    defaultScopes: ["personal", "daily", "heartrate", "workout", "session", "spo2"],
  },
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
    metrics: OURA_DEVICE_PROVIDER_METRIC_PRIORITIES,
  },
} as const satisfies DeviceProviderDescriptor;

export const STRAVA_DEVICE_PROVIDER_DESCRIPTOR = {
  provider: "strava",
  displayName: "Strava",
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
  sourcePriorityHints: {
    defaultPriority: 75,
    metricFamilies: {
      activity: 100,
      cardio: 90,
      session: 95,
    },
    metrics: STRAVA_DEVICE_PROVIDER_METRIC_PRIORITIES,
  },
} as const satisfies DeviceProviderDescriptor;

export const WHOOP_DEVICE_PROVIDER_DESCRIPTOR = {
  provider: "whoop",
  displayName: "WHOOP",
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
    metrics: WHOOP_DEVICE_PROVIDER_METRIC_PRIORITIES,
  },
} as const satisfies DeviceProviderDescriptor;

export const JUNCTION_DEVICE_PROVIDER_DESCRIPTOR = {
  provider: "junction",
  displayName: "Junction",
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
      reconcileIntervalMs: 6 * 60 * 60_000,
    },
    jobKinds: ["backfill", "reconcile", "resource"],
    supportsRemoteDisconnect: true,
    supportsTokenRefresh: false,
  },
  normalization: {
    metricFamilies: ["activity", "sleep", "recovery", "cardio", "respiration", "blood_oxygen", "body", "session"],
    snapshotParser: "schema",
  },
  sourcePriorityHints: {
    defaultPriority: 55,
    metricFamilies: {
      activity: 55,
      sleep: 55,
      recovery: 55,
      cardio: 55,
      respiration: 55,
      blood_oxygen: 55,
      body: 55,
      session: 55,
    },
    metrics: JUNCTION_DEVICE_PROVIDER_METRIC_PRIORITIES,
  },
} as const satisfies DeviceProviderDescriptor;

export const defaultDeviceProviderDescriptors = Object.freeze([
  WHOOP_DEVICE_PROVIDER_DESCRIPTOR,
  OURA_DEVICE_PROVIDER_DESCRIPTOR,
  GARMIN_DEVICE_PROVIDER_DESCRIPTOR,
  STRAVA_DEVICE_PROVIDER_DESCRIPTOR,
  JUNCTION_DEVICE_PROVIDER_DESCRIPTOR,
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
