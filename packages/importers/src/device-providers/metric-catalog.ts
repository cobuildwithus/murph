export const wearableCanonicalMetricKeys = [
  "activeCalories",
  "activityScore",
  "averageHeartRate",
  "awakeMinutes",
  "bmi",
  "bodyBattery",
  "bodyFatPercentage",
  "dayStrain",
  "deepMinutes",
  "distanceKm",
  "estimatedVo2Max",
  "hrv",
  "lightMinutes",
  "lowestHeartRate",
  "readinessScore",
  "recoveryScore",
  "remMinutes",
  "respiratoryRate",
  "restingHeartRate",
  "sessionCount",
  "sessionMinutes",
  "sleepConsistency",
  "sleepEfficiency",
  "sleepPerformance",
  "sleepScore",
  "spo2",
  "steps",
  "stressLevel",
  "temperature",
  "temperatureDeviation",
  "timeInBedMinutes",
  "totalSleepMinutes",
  "weightKg",
] as const;

export type WearableCanonicalMetricKey = (typeof wearableCanonicalMetricKeys)[number];

export type WearableMetricRecordKind =
  | "activity_session"
  | "daily_observation"
  | "sample"
  | "session_observation";

export interface WearableMetricCatalogEntry {
  readonly key: WearableCanonicalMetricKey;
  readonly aliases: readonly string[];
  readonly defaultRecordKind: WearableMetricRecordKind;
  readonly defaultUnit: string;
  readonly tolerance: number;
}

export const wearableMetricCatalog = Object.freeze({
  activeCalories: defineMetric("activeCalories", "kcal", "daily_observation", 25, ["active_calories", "calories_active"]),
  activityScore: defineMetric("activityScore", "%", "daily_observation", 1, ["activity_score"]),
  averageHeartRate: defineMetric("averageHeartRate", "bpm", "session_observation", 1, ["average_heart_rate", "avg_hr", "heart_rate"]),
  awakeMinutes: defineMetric("awakeMinutes", "minutes", "session_observation", 5, ["awake", "awake_minutes"]),
  bmi: defineMetric("bmi", "kg_m2", "daily_observation", 0.1, ["body_mass_index"]),
  bodyBattery: defineMetric("bodyBattery", "score", "daily_observation", 1, ["body_battery"]),
  bodyFatPercentage: defineMetric("bodyFatPercentage", "%", "daily_observation", 1, ["body_fat", "body_fat_percentage"]),
  dayStrain: defineMetric("dayStrain", "whoop_strain", "daily_observation", 0.5, ["day_strain", "strain"]),
  deepMinutes: defineMetric("deepMinutes", "minutes", "session_observation", 5, ["deep", "deep_minutes"]),
  distanceKm: defineMetric("distanceKm", "km", "daily_observation", 0.25, ["distance", "distance_km"]),
  estimatedVo2Max: defineMetric("estimatedVo2Max", "ml/kg/min", "daily_observation", 1, [
    "estimated_vo2_max",
    "estimated_vo2max",
    "vo2_max",
    "vo2max",
    "cardio_fitness",
    "cardiorespiratory_fitness",
  ]),
  hrv: defineMetric("hrv", "ms", "daily_observation", 3, ["hrv_rmssd", "rmssd"]),
  lightMinutes: defineMetric("lightMinutes", "minutes", "session_observation", 5, ["light", "light_minutes"]),
  lowestHeartRate: defineMetric("lowestHeartRate", "bpm", "session_observation", 1, ["lowest_heart_rate", "min_hr"]),
  readinessScore: defineMetric("readinessScore", "%", "daily_observation", 1, ["readiness", "readiness_score"]),
  recoveryScore: defineMetric("recoveryScore", "%", "daily_observation", 1, ["recovery", "recovery_score"]),
  remMinutes: defineMetric("remMinutes", "minutes", "session_observation", 5, ["rem", "rem_minutes"]),
  respiratoryRate: defineMetric(
    "respiratoryRate",
    "breaths_per_minute",
    "daily_observation",
    1,
    ["respiratory_rate", "respiration_rate"],
  ),
  restingHeartRate: defineMetric("restingHeartRate", "bpm", "daily_observation", 1, ["resting_heart_rate", "rhr"]),
  sessionCount: defineMetric("sessionCount", "count", "activity_session", 0, ["activity_session_count"]),
  sessionMinutes: defineMetric("sessionMinutes", "minutes", "activity_session", 5, ["duration", "session_minutes"]),
  sleepConsistency: defineMetric("sleepConsistency", "%", "daily_observation", 1, ["sleep_consistency"]),
  sleepEfficiency: defineMetric("sleepEfficiency", "%", "session_observation", 1, ["sleep_efficiency"]),
  sleepPerformance: defineMetric("sleepPerformance", "%", "daily_observation", 1, ["sleep_performance"]),
  sleepScore: defineMetric("sleepScore", "%", "daily_observation", 1, ["sleep_score"]),
  spo2: defineMetric("spo2", "%", "daily_observation", 1, ["oxygen_saturation", "spo2"]),
  steps: defineMetric("steps", "count", "daily_observation", 250, ["step_count", "daily_steps"]),
  stressLevel: defineMetric("stressLevel", "score", "daily_observation", 1, ["stress", "stress_level"]),
  temperature: defineMetric("temperature", "celsius", "daily_observation", 0.2, ["body_temperature", "temperature_celsius"]),
  temperatureDeviation: defineMetric("temperatureDeviation", "celsius", "daily_observation", 0.2, ["temperature_delta", "temperature_deviation"]),
  timeInBedMinutes: defineMetric("timeInBedMinutes", "minutes", "session_observation", 5, ["time_in_bed", "time_in_bed_minutes"]),
  totalSleepMinutes: defineMetric("totalSleepMinutes", "minutes", "session_observation", 5, ["asleep", "total_sleep", "total_sleep_minutes"]),
  weightKg: defineMetric("weightKg", "kg", "daily_observation", 0.2, ["body_weight", "weight"]),
} satisfies Record<WearableCanonicalMetricKey, WearableMetricCatalogEntry>);

const metricAliases = new Map<string, WearableCanonicalMetricKey>();
for (const entry of Object.values(wearableMetricCatalog)) {
  metricAliases.set(entry.key.toLowerCase(), entry.key);
  metricAliases.set(camelToKebabCase(entry.key), entry.key);
  metricAliases.set(camelToSnakeCase(entry.key), entry.key);
  for (const alias of entry.aliases) {
    metricAliases.set(alias.toLowerCase(), entry.key);
    metricAliases.set(alias.toLowerCase().replace(/_/gu, "-"), entry.key);
  }
}

metricAliases.set("daily-steps", "steps");
metricAliases.set("sleep-total-minutes", "totalSleepMinutes");
metricAliases.set("sleep-awake-minutes", "awakeMinutes");
metricAliases.set("sleep-light-minutes", "lightMinutes");
metricAliases.set("sleep-deep-minutes", "deepMinutes");
metricAliases.set("sleep-rem-minutes", "remMinutes");

export function resolveWearableCanonicalMetricKey(metric: string): WearableCanonicalMetricKey | null {
  return metricAliases.get(metric.trim().toLowerCase()) ?? null;
}

export function resolveWearableMetricCatalogEntry(
  metric: string,
): WearableMetricCatalogEntry | null {
  const key = resolveWearableCanonicalMetricKey(metric);
  return key ? wearableMetricCatalog[key] : null;
}

export function resolveWearableMetricTolerance(metric: string): number {
  return resolveWearableMetricCatalogEntry(metric)?.tolerance ?? 0;
}

function defineMetric(
  key: WearableCanonicalMetricKey,
  defaultUnit: string,
  defaultRecordKind: WearableMetricRecordKind,
  tolerance: number,
  aliases: readonly string[] = [],
): WearableMetricCatalogEntry {
  return { aliases, defaultRecordKind, defaultUnit, key, tolerance };
}

function camelToKebabCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/gu, "$1-$2").toLowerCase();
}

function camelToSnakeCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/gu, "$1_$2").toLowerCase();
}
