export const wearableCanonicalMetricKeys = [
  "activeCalories",
  "activityMinutes",
  "activityScore",
  "afibBurden",
  "altitudeChangeMeters",
  "averageHeartRate",
  "awakeMinutes",
  "basalBodyTemperature",
  "bmi",
  "bodyBattery",
  "bodyFatPercentage",
  "bodyWaterPercentage",
  "boneMassPercentage",
  "caffeine",
  "dayStrain",
  "deepMinutes",
  "diastolicBloodPressure",
  "distanceKm",
  "estimatedVo2Max",
  "floorsClimbed",
  "glucose",
  "heartRateRecoveryOneMinute",
  "highActivityMinutes",
  "highestGlucose",
  "hrv",
  "leanBodyMassKg",
  "lightMinutes",
  "lowActivityMinutes",
  "lowestGlucose",
  "lowestHeartRate",
  "lowestSpo2",
  "maxHeartRate",
  "mediumActivityMinutes",
  "mindfulnessMinutes",
  "muscleMassPercentage",
  "percentRecorded",
  "readinessScore",
  "recoveryScore",
  "remMinutes",
  "respiratoryRate",
  "restingHeartRate",
  "sessionCount",
  "sessionMinutes",
  "sleepBreathingDisturbance",
  "sleepConsistency",
  "sleepEfficiency",
  "sleepLatencyMinutes",
  "sleepPerformance",
  "sleepScore",
  "spo2",
  "steps",
  "stressLevel",
  "systolicBloodPressure",
  "temperature",
  "temperatureDeviation",
  "timeInBedMinutes",
  "totalCalories",
  "totalElevationGainMeters",
  "totalSleepMinutes",
  "visceralFatIndex",
  "waistCircumference",
  "walkingAverageHeartRate",
  "water",
  "workoutStrain",
  "walkingAverageHeartRate",
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

export interface NormalizedWearableMetricValue {
  readonly key: WearableCanonicalMetricKey;
  readonly unit: string;
  readonly value: number;
}

export const wearableMetricCatalog = Object.freeze({
  activeCalories: defineMetric("activeCalories", "kcal", "daily_observation", 25, [
    "active_calories",
    "calories_active",
  ]),
  activityMinutes: defineMetric("activityMinutes", "minutes", "daily_observation", 5, []),
  activityScore: defineMetric("activityScore", "%", "daily_observation", 1, ["activity_score"]),
  afibBurden: defineMetric("afibBurden", "%", "daily_observation", 0.5, []),
  altitudeChangeMeters: defineMetric("altitudeChangeMeters", "meter", "session_observation", 5, [
    "altitude_change",
    "altitude_change_meter",
    "altitude_change_meters",
  ]),
  averageHeartRate: defineMetric("averageHeartRate", "bpm", "session_observation", 1, ["average_heart_rate", "avg_hr", "heart_rate"]),
  awakeMinutes: defineMetric("awakeMinutes", "minutes", "session_observation", 5, ["awake", "awake_minutes"]),
  basalBodyTemperature: defineMetric("basalBodyTemperature", "celsius", "daily_observation", 0.2, []),
  bmi: defineMetric("bmi", "kg/m^2", "daily_observation", 0.1, ["body_mass_index"]),
  bodyBattery: defineMetric("bodyBattery", "score", "daily_observation", 1, ["body_battery"]),
  bodyFatPercentage: defineMetric("bodyFatPercentage", "%", "daily_observation", 1, [
    "body_fat",
    "body_fat_percentage",
    "body_fat_pct",
  ]),
  bodyWaterPercentage: defineMetric("bodyWaterPercentage", "%", "daily_observation", 1, [
    "body_water_percentage",
    "water_percentage",
  ]),
  boneMassPercentage: defineMetric("boneMassPercentage", "%", "daily_observation", 1, [
    "bone_mass_percentage",
  ]),
  caffeine: defineMetric("caffeine", "mg", "daily_observation", 5, ["caffeine_mg"]),
  dayStrain: defineMetric("dayStrain", "whoop_strain", "daily_observation", 0.5, ["day_strain", "strain"]),
  deepMinutes: defineMetric("deepMinutes", "minutes", "session_observation", 5, ["deep", "deep_minutes"]),
  diastolicBloodPressure: defineMetric("diastolicBloodPressure", "mmHg", "sample", 1, ["diastolic", "diastolic_bp", "dbp"]),
  distanceKm: defineMetric("distanceKm", "km", "daily_observation", 0.25, [
    "distance",
    "distance_km",
    "equivalent_walking_distance",
  ]),
  estimatedVo2Max: defineMetric("estimatedVo2Max", "ml/kg/min", "daily_observation", 1, [
    "estimated_vo2_max",
    "estimated_vo2max",
    "vo2_max",
    "vo2max",
    "cardio_fitness",
    "cardiorespiratory_fitness",
  ]),
  floorsClimbed: defineMetric("floorsClimbed", "count", "daily_observation", 1, [
    "floors",
    "floors_climbed",
    "floors_ascended",
  ]),
  glucose: defineMetric("glucose", "mg/dL", "daily_observation", 2, ["blood_glucose"]),
  heartRateRecoveryOneMinute: defineMetric("heartRateRecoveryOneMinute", "bpm", "daily_observation", 1, ["heart_rate_recovery"]),
  highActivityMinutes: defineMetric("highActivityMinutes", "minutes", "daily_observation", 5, ["high_activity_minutes"]),
  highestGlucose: defineMetric("highestGlucose", "mg/dL", "daily_observation", 2, ["max_glucose", "glucose_max"]),
  highActivityMinutes: defineMetric("highActivityMinutes", "minutes", "daily_observation", 5),
  hrv: defineMetric("hrv", "ms", "daily_observation", 3, ["hrv_rmssd", "rmssd"]),
  leanBodyMassKg: defineMetric("leanBodyMassKg", "kg", "daily_observation", 0.2, [
    "lean_body_mass",
    "lean_body_mass_kg",
    "lean_body_mass_kilogram",
    "lean_mass",
    "lean_mass_kg",
  ]),
  lightMinutes: defineMetric("lightMinutes", "minutes", "session_observation", 5, ["light", "light_minutes"]),
  lowActivityMinutes: defineMetric("lowActivityMinutes", "minutes", "daily_observation", 5, ["low_activity_minutes"]),
  lowestGlucose: defineMetric("lowestGlucose", "mg/dL", "daily_observation", 2, ["min_glucose", "glucose_min"]),
  lowestHeartRate: defineMetric("lowestHeartRate", "bpm", "session_observation", 1, ["lowest_heart_rate", "min_hr"]),
  lowestSpo2: defineMetric("lowestSpo2", "%", "daily_observation", 1, [
    "lowest_spo2",
    "lowest_blood_oxygen",
    "lowest_oxygen_saturation",
    "min_spo2",
    "minimum_spo2",
    "spo2_min",
  ]),
  maxHeartRate: defineMetric("maxHeartRate", "bpm", "session_observation", 1, ["max_heart_rate", "max_hr"]),
  mediumActivityMinutes: defineMetric("mediumActivityMinutes", "minutes", "daily_observation", 5, ["medium_activity_minutes"]),
  mindfulnessMinutes: defineMetric("mindfulnessMinutes", "minutes", "daily_observation", 2, ["mindful_minutes"]),
  muscleMassPercentage: defineMetric("muscleMassPercentage", "%", "daily_observation", 1, [
    "muscle_mass_percentage",
  ]),
  percentRecorded: defineMetric("percentRecorded", "%", "session_observation", 1, ["percent_recorded"]),
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
  sleepBreathingDisturbance: defineMetric("sleepBreathingDisturbance", "count", "daily_observation", 0.5, ["breathing_disturbances"]),
  sleepConsistency: defineMetric("sleepConsistency", "%", "daily_observation", 1, ["sleep_consistency"]),
  sleepEfficiency: defineMetric("sleepEfficiency", "%", "session_observation", 1, ["sleep_efficiency"]),
  sleepLatencyMinutes: defineMetric("sleepLatencyMinutes", "minutes", "session_observation", 5, [
    "sleep_latency_minutes",
  ]),
  sleepPerformance: defineMetric("sleepPerformance", "%", "daily_observation", 1, ["sleep_performance"]),
  sleepScore: defineMetric("sleepScore", "%", "daily_observation", 1, ["sleep_score"]),
  spo2: defineMetric("spo2", "%", "daily_observation", 1, ["oxygen_saturation", "spo2"]),
  steps: defineMetric("steps", "count", "daily_observation", 250, ["step_count", "daily_steps"]),
  stressLevel: defineMetric("stressLevel", "score", "daily_observation", 1, ["stress", "stress_level"]),
  systolicBloodPressure: defineMetric("systolicBloodPressure", "mmHg", "sample", 1, ["systolic", "systolic_bp", "sbp"]),
  temperature: defineMetric("temperature", "celsius", "daily_observation", 0.2, ["body_temperature", "temperature_celsius"]),
  temperatureDeviation: defineMetric("temperatureDeviation", "celsius", "daily_observation", 0.2, ["temperature_delta", "temperature_deviation"]),
  timeInBedMinutes: defineMetric("timeInBedMinutes", "minutes", "session_observation", 5, ["time_in_bed", "time_in_bed_minutes"]),
  totalCalories: defineMetric("totalCalories", "kcal", "daily_observation", 25, [
    "calories",
    "energy_burned",
    "total_calories",
  ]),
  totalElevationGainMeters: defineMetric("totalElevationGainMeters", "meter", "session_observation", 5, [
    "altitude_gain",
    "altitude_gain_meter",
    "altitude_gain_meters",
    "total_elevation_gain",
    "elevation_gain",
  ]),
  totalSleepMinutes: defineMetric("totalSleepMinutes", "minutes", "session_observation", 5, ["asleep", "total_sleep", "total_sleep_minutes"]),
  visceralFatIndex: defineMetric("visceralFatIndex", "index", "daily_observation", 1, [
    "visceral_fat_index",
  ]),
  waistCircumference: defineMetric("waistCircumference", "cm", "daily_observation", 0.5, [
    "waist_circumference",
    "waist_circumference_centimeter",
    "waist_circumference_cm",
  ]),
  walkingAverageHeartRate: defineMetric("walkingAverageHeartRate", "bpm", "daily_observation", 1, [
    "avg_walking_bpm",
  ]),
  water: defineMetric("water", "ml", "daily_observation", 50, ["dietary_water", "water_ml"]),
  workoutStrain: defineMetric("workoutStrain", "whoop_strain", "session_observation", 0.5, ["workout_strain"]),
  walkingAverageHeartRate: defineMetric("walkingAverageHeartRate", "bpm", "daily_observation", 1),
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

export function normalizeWearableMetricValue(
  metric: string,
  value: number,
  unit: string | null | undefined,
): NormalizedWearableMetricValue | null {
  if (!Number.isFinite(value)) {
    return null;
  }

  const key = resolveWearableCanonicalMetricKey(metric);

  if (!key) {
    return null;
  }

  const normalizedMetric = normalizeMetricName(metric);
  const normalizedUnit = normalizeUnit(unit);

  switch (key) {
    case "activeCalories":
      return normalizeActiveCaloriesMetricValue(normalizedMetric, value, normalizedUnit);
    case "totalCalories":
      return normalizeTotalCaloriesMetricValue(value, normalizedUnit);
    case "distanceKm":
      return {
        key,
        unit: "km",
        value: normalizeDistanceKilometers(value, normalizedUnit),
      };
    case "basalBodyTemperature":
    case "temperature":
    case "temperatureDeviation":
      return {
        key,
        unit: "celsius",
        value: normalizeTemperatureCelsius(value, normalizedUnit),
      };
    case "leanBodyMassKg":
    case "weightKg": {
      const kilograms = normalizeWeightKilograms(value, normalizedUnit);
      return kilograms === null ? null : { key, unit: "kg", value: kilograms };
    }
    case "totalElevationGainMeters":
    case "altitudeChangeMeters":
      return {
        key,
        unit: "meter",
        value: normalizeMeters(value, normalizedUnit),
      };
    default:
      return {
        key,
        unit: wearableMetricCatalog[key].defaultUnit,
        value,
      };
  }
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

function normalizeMetricName(metric: string): string {
  return metric.trim().toLowerCase().replace(/[\s_]+/gu, "-");
}

function normalizeUnit(unit: string | null | undefined): string | null {
  const normalized = unit?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : null;
}

function normalizeActiveCaloriesMetricValue(
  normalizedMetric: string,
  value: number,
  unit: string | null,
): NormalizedWearableMetricValue | null {
  if (isKilocalorieUnit(unit)) {
    return { key: "activeCalories", unit: "kcal", value };
  }

  if (normalizedMetric !== "energy-burned" && unit === null) {
    return { key: "activeCalories", unit: "kcal", value };
  }

  if (isKilojouleUnit(unit)) {
    return {
      key: "activeCalories",
      unit: "kcal",
      value: Number((value / 4.184).toFixed(4)),
    };
  }

  return null;
}

function normalizeTotalCaloriesMetricValue(
  value: number,
  unit: string | null,
): NormalizedWearableMetricValue | null {
  if (isKilocalorieUnit(unit) || unit === null) {
    return { key: "totalCalories", unit: "kcal", value };
  }

  if (isKilojouleUnit(unit)) {
    return {
      key: "totalCalories",
      unit: "kcal",
      value: Number((value / 4.184).toFixed(4)),
    };
  }

  return null;
}

function normalizeWeightKilograms(value: number, unit: string | null): number | null {
  switch (unit) {
    case null:
    case "kg":
    case "kilogram":
    case "kilograms":
      return value;
    case "lb":
    case "lbs":
    case "pound":
    case "pounds":
      return Number((value * 0.45359237).toFixed(4));
    default:
      return null;
  }
}

function normalizeDistanceKilometers(value: number, unit: string | null): number {
  switch (unit) {
    case "km":
    case "kilometer":
    case "kilometers":
      return value;
    case "mi":
    case "mile":
    case "miles":
      return Number((value * 1.609344).toFixed(4));
    default:
      return Number((value / 1000).toFixed(4));
  }
}

function normalizeTemperatureCelsius(value: number, unit: string | null): number {
  switch (unit) {
    case "f":
    case "fahrenheit":
      return Number((((value - 32) * 5) / 9).toFixed(4));
    default:
      return value;
  }
}

function normalizeMeters(value: number, unit: string | null): number {
  switch (unit) {
    case null:
    case "m":
    case "meter":
    case "meters":
      return value;
    case "km":
    case "kilometer":
    case "kilometers":
      return Number((value * 1000).toFixed(4));
    case "ft":
    case "foot":
    case "feet":
      return Number((value * 0.3048).toFixed(4));
    case "mi":
    case "mile":
    case "miles":
      return Number((value * 1609.344).toFixed(4));
    default:
      return value;
  }
}

function isKilocalorieUnit(unit: string | null): boolean {
  switch (unit) {
    case "kcal":
    case "kilocalorie":
    case "kilocalories":
      return true;
    default:
      return false;
  }
}

function isKilojouleUnit(unit: string | null): boolean {
  switch (unit) {
    case "kj":
    case "kilojoule":
    case "kilojoules":
      return true;
    default:
      return false;
  }
}
