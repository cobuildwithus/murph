export type WearableProviderMetricFamily =
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

export interface WearableProviderSourcePriorityHints {
  defaultPriority: number;
  metricFamilies: Partial<Record<WearableProviderMetricFamily, number>>;
  metrics?: Partial<Record<string, number>>;
}

export interface WearableProviderDescriptor {
  aliases?: readonly string[];
  displayName: string;
  provider: string;
  sourcePriorityHints: WearableProviderSourcePriorityHints;
}

export interface ResolveWearableProviderSourcePriorityInput {
  metric?: string | null;
  metricFamily?: WearableProviderMetricFamily | null;
}

const GARMIN_METRIC_PRIORITIES = Object.freeze({
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

const OURA_METRIC_PRIORITIES = Object.freeze({
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

const WHOOP_METRIC_PRIORITIES = Object.freeze({
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

const STRAVA_METRIC_PRIORITIES = Object.freeze({
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

const JUNCTION_METRIC_PRIORITIES = Object.freeze({
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

export const GARMIN_WEARABLE_PROVIDER_DESCRIPTOR = {
  provider: "garmin",
  displayName: "Garmin",
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
    metrics: GARMIN_METRIC_PRIORITIES,
  },
} as const satisfies WearableProviderDescriptor;

export const OURA_WEARABLE_PROVIDER_DESCRIPTOR = {
  provider: "oura",
  displayName: "Oura",
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
    metrics: OURA_METRIC_PRIORITIES,
  },
} as const satisfies WearableProviderDescriptor;

export const STRAVA_WEARABLE_PROVIDER_DESCRIPTOR = {
  provider: "strava",
  displayName: "Strava",
  sourcePriorityHints: {
    defaultPriority: 75,
    metricFamilies: {
      activity: 100,
      cardio: 90,
      session: 95,
    },
    metrics: STRAVA_METRIC_PRIORITIES,
  },
} as const satisfies WearableProviderDescriptor;

export const WHOOP_WEARABLE_PROVIDER_DESCRIPTOR = {
  provider: "whoop",
  aliases: ["whoop_v2", "whoop-v2"],
  displayName: "WHOOP",
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
    metrics: WHOOP_METRIC_PRIORITIES,
  },
} as const satisfies WearableProviderDescriptor;

export const GOOGLE_HEALTH_WEARABLE_PROVIDER_DESCRIPTOR = {
  provider: "google-health",
  aliases: ["google_health"],
  displayName: "Google Health",
  sourcePriorityHints: {
    defaultPriority: 55,
    metricFamilies: {
      activity: 55,
      sleep: 55,
      cardio: 55,
      respiration: 55,
      blood_oxygen: 55,
      body: 55,
      session: 55,
    },
    metrics: JUNCTION_METRIC_PRIORITIES,
  },
} as const satisfies WearableProviderDescriptor;

export const JUNCTION_WEARABLE_PROVIDER_DESCRIPTOR = {
  provider: "junction",
  displayName: "Junction",
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
    metrics: JUNCTION_METRIC_PRIORITIES,
  },
} as const satisfies WearableProviderDescriptor;

export const defaultWearableProviderDescriptors = Object.freeze([
  WHOOP_WEARABLE_PROVIDER_DESCRIPTOR,
  OURA_WEARABLE_PROVIDER_DESCRIPTOR,
  GARMIN_WEARABLE_PROVIDER_DESCRIPTOR,
  STRAVA_WEARABLE_PROVIDER_DESCRIPTOR,
  GOOGLE_HEALTH_WEARABLE_PROVIDER_DESCRIPTOR,
  JUNCTION_WEARABLE_PROVIDER_DESCRIPTOR,
] as const);

export function normalizeWearableProviderKey(provider: string): string | undefined {
  const normalized = provider.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

function buildProviderLookup(
  descriptors: readonly WearableProviderDescriptor[],
): Map<string, WearableProviderDescriptor> {
  const lookup = new Map<string, WearableProviderDescriptor>();
  for (const descriptor of descriptors) {
    for (const rawKey of [descriptor.provider, ...(descriptor.aliases ?? [])]) {
      const key = normalizeWearableProviderKey(rawKey);
      if (!key) {
        throw new TypeError(`${descriptor.provider} defines a blank provider key`);
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

const defaultProviderLookup = buildProviderLookup(defaultWearableProviderDescriptors);

export function resolveWearableProviderDescriptor(
  provider: string,
  descriptors: readonly WearableProviderDescriptor[] = defaultWearableProviderDescriptors,
): WearableProviderDescriptor | undefined {
  const key = normalizeWearableProviderKey(provider);
  if (!key) {
    return undefined;
  }
  return (descriptors === defaultWearableProviderDescriptors
    ? defaultProviderLookup
    : buildProviderLookup(descriptors)).get(key);
}

export function canonicalizeWearableProviderSlug(
  provider: string,
  descriptors: readonly WearableProviderDescriptor[] = defaultWearableProviderDescriptors,
): string {
  const key = normalizeWearableProviderKey(provider);
  return key ? resolveWearableProviderDescriptor(key, descriptors)?.provider ?? key : "";
}

export function resolveWearableProviderSourcePriority(
  descriptor: WearableProviderDescriptor,
  input: ResolveWearableProviderSourcePriorityInput = {},
): number {
  const metric = input.metric?.trim() || null;
  const metricPriority = metric ? descriptor.sourcePriorityHints.metrics?.[metric] : undefined;
  if (typeof metricPriority === "number" && Number.isFinite(metricPriority)) {
    return metricPriority;
  }
  const familyPriority = input.metricFamily
    ? descriptor.sourcePriorityHints.metricFamilies[input.metricFamily]
    : undefined;
  return typeof familyPriority === "number" && Number.isFinite(familyPriority)
    ? familyPriority
    : descriptor.sourcePriorityHints.defaultPriority;
}
