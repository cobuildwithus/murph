import { createHash } from "node:crypto";

import {
  extractIsoDatePrefix,
  ID_PREFIXES,
  isStrictIsoDate,
  MEAL_MICRONUTRIENT_KEYS,
  parseCompanionHrvRmssdAdmissionId,
  parseCompanionHrvRmssdObservation,
  serializeCompanionHrvRmssdObservation,
  type CompanionHrvRmssdAdmissionId,
  toLocalDayKey,
  type CompanionHrvRmssdObservation,
  type MealMicronutrientKey,
  type MealMicronutrients,
  type MealNutrition,
  type WorkoutSession,
} from "@murphai/contracts";
import * as z from "@murphai/contracts/zod-runtime";

import { stripUndefined } from "../shared.ts";
import {
  asArray,
  asPlainObject,
  createEvidencePart,
  finiteNumber,
  kilojoulesToKilocalories,
  makeNormalizedDeviceBatch,
  makeProviderExternalRef,
  minutesBetween,
  pushEvidencePart,
  slugify,
  stringId,
  trimToLength,
} from "./shared-normalization.ts";
import {
  JUNCTION_ALLOWED_SUMMARY_RESOURCES,
  JUNCTION_ALLOWED_TIMESERIES_RESOURCES,
  JUNCTION_SLEEP_AVERAGE_HEART_RATE_PATHS,
  JUNCTION_SLEEP_AWAKE_MINUTE_PATHS,
  JUNCTION_SLEEP_AWAKE_SECOND_PATHS,
  JUNCTION_SLEEP_CONSISTENCY_PATHS,
  JUNCTION_SLEEP_DEEP_MINUTE_PATHS,
  JUNCTION_SLEEP_DEEP_SECOND_PATHS,
  JUNCTION_SLEEP_DURATION_MILLISECOND_PATHS,
  JUNCTION_SLEEP_DURATION_MINUTE_PATHS,
  JUNCTION_SLEEP_DURATION_SECOND_PATHS,
  JUNCTION_SLEEP_EFFICIENCY_RATIO_PATHS,
  JUNCTION_SLEEP_END_TIMESTAMP_PATHS,
  JUNCTION_SLEEP_HRV_PATHS,
  JUNCTION_SLEEP_LIGHT_MINUTE_PATHS,
  JUNCTION_SLEEP_LIGHT_SECOND_PATHS,
  JUNCTION_SLEEP_LATENCY_MINUTE_PATHS,
  JUNCTION_SLEEP_LATENCY_SECOND_PATHS,
  JUNCTION_SLEEP_LOWEST_HEART_RATE_PATHS,
  JUNCTION_SLEEP_PERFORMANCE_PATHS,
  JUNCTION_SLEEP_REM_MINUTE_PATHS,
  JUNCTION_SLEEP_REM_SECOND_PATHS,
  JUNCTION_SLEEP_RESPIRATORY_RATE_PATHS,
  JUNCTION_SLEEP_RESTING_HEART_RATE_PATHS,
  JUNCTION_SLEEP_SCORE_PATHS,
  JUNCTION_SLEEP_SPO2_PATHS,
  JUNCTION_SLEEP_STAGE_ARRAY_PATHS,
  JUNCTION_SLEEP_STAGE_DURATION_MILLISECOND_PATHS,
  JUNCTION_SLEEP_STAGE_DURATION_MINUTE_PATHS,
  JUNCTION_SLEEP_STAGE_DURATION_SECOND_PATHS,
  JUNCTION_SLEEP_STAGE_VALUE_PATHS,
  JUNCTION_SLEEP_START_TIMESTAMP_PATHS,
  JUNCTION_SLEEP_TEMPERATURE_DEVIATION_PATHS,
  JUNCTION_SLEEP_TEMPERATURE_PATHS,
  JUNCTION_SLEEP_TIME_IN_BED_MINUTE_PATHS,
  JUNCTION_SLEEP_TIME_IN_BED_SECOND_PATHS,
  JUNCTION_SLEEP_TOTAL_MINUTE_PATHS,
  JUNCTION_SLEEP_TOTAL_SECOND_PATHS,
  isJunctionRawDirectIdentityContainerKey,
  isJunctionRawDirectIdentityKey,
  normalizeJunctionRawIdentityKey,
  normalizeJunctionSleepStageValue,
  normalizeJunctionResourceName,
  type JunctionSleepStageValue,
  type JunctionTimeseriesResource,
} from "./junction-resources.ts";
import {
  normalizeJunctionSourceProviderSlug,
  readJunctionSourceProviderSlug,
  resolveJunctionOrigin,
  type JunctionOriginFallback,
} from "./junction-origin.ts";
import {
  parseJunctionWorkoutFeatureEnvelope,
  type JunctionWorkoutFeatureEnvelope,
  type JunctionWorkoutFeatureMeasurement,
} from "./junction-workout-features.ts";

import type {
  DeviceAuthoritativeEventSetPayload,
  DeviceDataOrigin,
  DeviceEventPayload,
  DeviceExternalRefPayload,
  DeviceEvidencePartPayload,
  DeviceSamplePayload,
} from "../core-port.ts";
import type { PlainObject } from "./shared-normalization.ts";
import type {
  DeviceProviderAdapter,
  DeviceProviderNormalizationContext,
  NormalizedDeviceBatch,
} from "./types.ts";
import { JUNCTION_DEVICE_PROVIDER_DESCRIPTOR } from "./provider-descriptors.ts";

export {
  JUNCTION_ALLOWED_SUMMARY_RESOURCES,
  JUNCTION_ALLOWED_TIMESERIES_RESOURCES,
  JUNCTION_DEFAULT_SUMMARY_RESOURCES,
  JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
  JUNCTION_KNOWN_TIMESERIES_RESOURCES,
  JUNCTION_OPT_IN_SUMMARY_RESOURCES,
  JUNCTION_OPT_IN_TIMESERIES_RESOURCES,
  JUNCTION_RAW_ONLY_SUMMARY_RESOURCES,
  normalizeJunctionResourceName,
  type JunctionTimeseriesResource,
} from "./junction-resources.ts";
export {
  JUNCTION_WORKOUT_FEATURE_MAX_MEASUREMENTS,
  JUNCTION_WORKOUT_FEATURE_MAX_SPLIT_MEASUREMENTS,
  JUNCTION_WORKOUT_FEATURE_MAX_SPLITS,
  JUNCTION_WORKOUT_STREAM_MAX_POINTS,
  JunctionWorkoutStreamLimitError,
  parseJunctionWorkoutFeatureEnvelope,
  reduceJunctionWorkoutStream,
  type JunctionWorkoutFeatureEnvelope,
  type JunctionWorkoutFeatureMeasurement,
  type JunctionWorkoutFeatureSplit,
  type ReduceJunctionWorkoutStreamInput,
} from "./junction-workout-features.ts";

export interface JunctionCompanionHrvRmssdSnapshotEntry {
  admissionId: CompanionHrvRmssdAdmissionId;
  observation: CompanionHrvRmssdObservation;
}

export interface JunctionSnapshotInput {
  accountId?: string | number;
  importedAt?: string | number | Date;
  windowStart?: string | number | Date;
  windowEnd?: string | number | Date;
  connections?: unknown[];
  summaries?: Record<string, unknown>;
  timeseries?: Record<string, unknown>;
  workoutFeatures?: readonly JunctionWorkoutFeatureEnvelope[];
  companionHrvRmssd?: JunctionCompanionHrvRmssdSnapshotEntry;
}

export type JunctionSummaryResource =
  (typeof JUNCTION_ALLOWED_SUMMARY_RESOURCES)[number];

export interface JunctionSummaryNormalizationEvidence {
  readonly resource: JunctionSummaryResource;
  readonly sourceProviderSlug: string;
}

export interface JunctionSummaryNormalizationEvidenceWindow {
  readonly windowEnd: string;
  readonly windowStart: string;
}

export interface JunctionWorkoutDurationCompanionCoverage {
  readonly complete: boolean;
  readonly exactLinkedDurationCount: number;
  readonly matchedExactLinkedDurationCount: number;
}

export interface JunctionBloodPressureProviderRecordIdentityEvidence {
  readonly providerRecordCount: number;
  readonly repairStableExternalRefResourceIds: readonly (string | null)[];
}

type TimestampSemantics = NonNullable<DeviceDataOrigin["timestampSemantics"]>;
type MealNutritionTotals = NonNullable<MealNutrition["totals"]>;
type MealNutritionTotalKey = keyof MealNutritionTotals;

interface ResourceContext {
  resource: string;
  resourceSlug: string;
  identityKind: "summary" | "timeseries";
  sourceProviderSlug: string;
  origin: DeviceDataOrigin;
  externalRefResourceType: string;
  artifactRole: string;
  artifactFileName: string;
  evidenceRoles: string[];
  connection?: PlainObject;
  fallbackIdentityDisambiguator?: string;
}

interface NormalizationContext {
  defaultTimeZone?: string;
  importedAt?: string;
  windowStart?: string;
  windowEnd?: string;
  connectionsByKey: ReadonlyMap<string, PlainObject>;
  evidenceParts: DeviceEvidencePartPayload[];
  events: DeviceEventPayload[];
  samples: DeviceSamplePayload[];
  authoritativeEventSets: DeviceAuthoritativeEventSetPayload[];
}

interface JunctionResourceEntry {
  entry: PlainObject;
  originFallback?: JunctionOriginFallback;
}

interface JunctionResolvedResourceEntry {
  entry: PlainObject;
  resourceContext: ResourceContext;
}

interface MetricDescriptor {
  metric: string;
  unit: string;
  title: string;
  paths: readonly string[];
  nonnegative?: boolean;
  value?: (entry: PlainObject) => unknown;
  metersPaths?: readonly string[];
  percentRatioPaths?: readonly string[];
  secondsPaths?: readonly string[];
}

const junctionSnapshotSchema = z.object({
  accountId: z.union([z.string(), z.number()]).optional(),
  importedAt: z.union([z.string(), z.number(), z.date()]).optional(),
  windowStart: z.union([z.string(), z.number(), z.date()]).optional(),
  windowEnd: z.union([z.string(), z.number(), z.date()]).optional(),
  connections: z.array(z.unknown()).optional(),
  summaries: z.record(z.string(), z.unknown()).optional(),
  timeseries: z.record(z.string(), z.unknown()).optional(),
  workoutFeatures: z.array(z.unknown()).optional(),
  companionHrvRmssd: z.unknown().optional(),
}).catchall(z.unknown());

const junctionCompanionHrvRmssdSnapshotEntrySchema = z.object({
  admissionId: z.unknown(),
  observation: z.unknown(),
}).strict();

const SUMMARY_RESOURCE_ALLOWLIST = new Set<string>(JUNCTION_ALLOWED_SUMMARY_RESOURCES);
const TIMESERIES_RESOURCE_ALLOWLIST = new Set<string>(JUNCTION_ALLOWED_TIMESERIES_RESOURCES);
const FLOATING_TIMESTAMP_SOURCE_PROVIDER_SLUGS = new Set([
  "abbott-libreview",
  "abbott_libreview",
  "freestyle-libre",
  "freestyle_libre",
]);
const RAW_SOURCE_IDENTIFIER_KEYS = new Set([
  "sourcename",
  "sourcedeviceid",
  "sourceappid",
  "deviceid",
  "appid",
]);
const RAW_SOURCE_NAME_KEYS = new Set([
  "displayname",
  "name",
]);
const RAW_SOURCE_LINKAGE_KEY_PARTS = [
  "connectionid",
  "providerconnectionid",
  "sourceid",
  "sourceinstanceid",
] as const;
const RAW_SOURCE_CONTAINER_LINKAGE_KEY_PARTS = [
  "id",
  "uuid",
] as const;

const ACTIVITY_METRICS: readonly MetricDescriptor[] = [
  {
    metric: "activity-minutes",
    unit: "minutes",
    title: "Junction daily active minutes",
    paths: [],
    value: resolveJunctionDailyActivityMinutes,
  },
  { metric: "daily-steps", unit: "count", title: "Junction activity steps", paths: ["steps", "step_count", "daily_steps"] },
  { metric: "active-calories", unit: "kcal", title: "Junction active calories", paths: ["activeCalories", "active_calories", "calories_active"] },
  { metric: "total-calories", unit: "kcal", title: "Junction total calories", paths: ["calories", "totalCalories", "total_calories", "calories_total"] },
  { metric: "distance-km", unit: "km", title: "Junction distance", paths: ["distanceKm", "distance_km"], metersPaths: ["distance"] },
  { metric: "floors-climbed", unit: "count", title: "Junction floors climbed", paths: ["floorsClimbed", "floors_climbed", "floors", "floorsAscended", "floors_ascended"] },
  { metric: "activity-score", unit: "%", title: "Junction activity score", paths: ["activityScore", "activity_score", "score"] },
  { metric: "estimated-vo2-max", unit: "ml/kg/min", title: "Junction estimated VO2 max", paths: ["estimatedVo2Max", "estimated_vo2_max", "vo2Max", "vo2_max", "vo2max", "cardio_fitness"] },
  { metric: "total-elevation-gain-meters", unit: "meter", title: "Junction activity elevation gain", paths: ["totalElevationGainMeters", "total_elevation_gain_meters", "totalElevationGain", "total_elevation_gain", "elevationGainMeters", "elevation_gain_meters"] },
  { metric: "altitude-change-meters", unit: "meter", title: "Junction activity altitude change", paths: ["altitudeChangeMeters", "altitude_change_meters", "altitudeChange", "altitude_change", "elevationChangeMeters", "elevation_change_meters", "elevationChange", "elevation_change"] },
  { metric: "percent-recorded", unit: "%", title: "Junction activity recording coverage", paths: [], percentRatioPaths: ["percentRecorded", "percent_recorded", "recordingCoverage", "recording_coverage", "recordedRatio", "recorded_ratio", "percentRecordedRatio", "percent_recorded_ratio"] },
  { metric: "workout-strain", unit: "score", title: "Junction workout strain", paths: ["workoutStrain", "workout_strain"] },
  { metric: "day-strain", unit: "score", title: "Junction day strain", paths: ["dayStrain", "day_strain", "strain"] },
  { metric: "activity-average-heart-rate", unit: "bpm", title: "Junction activity average heart rate", paths: ["averageHeartRate", "average_heart_rate", "average_hr", "avg_hr", "heart_rate.avg_bpm"], nonnegative: true },
  { metric: "walking-average-heart-rate", unit: "bpm", title: "Junction activity walking average heart rate", paths: ["walkingAverageHeartRate", "walking_average_heart_rate", "walking_average_hr", "heart_rate.avg_walking_bpm"], nonnegative: true },
  { metric: "max-heart-rate", unit: "bpm", title: "Junction activity max heart rate", paths: ["maxHeartRate", "max_heart_rate", "max_hr", "heart_rate.max_bpm"], nonnegative: true },
  { metric: "minimum-heart-rate", unit: "bpm", title: "Junction activity minimum heart rate", paths: ["minimumHeartRate", "minimum_heart_rate", "minimum_hr", "min_hr", "heart_rate.min_bpm"], nonnegative: true },
  { metric: "resting-heart-rate", unit: "bpm", title: "Junction activity resting heart rate", paths: ["restingHeartRate", "resting_heart_rate", "resting_hr", "rhr", "heart_rate.resting_bpm"], nonnegative: true },
  { metric: "low-activity-minutes", unit: "minutes", title: "Junction low-intensity activity", paths: [], value: (entry) => resolveJunctionActivityBucketMinutes(entry, "low") },
  { metric: "medium-activity-minutes", unit: "minutes", title: "Junction medium-intensity activity", paths: [], value: (entry) => resolveJunctionActivityBucketMinutes(entry, "medium") },
  { metric: "high-activity-minutes", unit: "minutes", title: "Junction high-intensity activity", paths: [], value: (entry) => resolveJunctionActivityBucketMinutes(entry, "high") },
];

const BODY_METRICS: readonly MetricDescriptor[] = [
  { metric: "weight", unit: "kg", title: "Junction body weight", paths: ["weightKg", "weight_kg", "weight"] },
  { metric: "bmi", unit: "kg_m2", title: "Junction BMI", paths: ["bmi", "body_mass_index"] },
  { metric: "body-fat-percentage", unit: "%", title: "Junction body fat", paths: ["bodyFatPercentage", "body_fat_percentage", "body_fat_percent", "bodyFat", "body_fat", "fat"] },
  { metric: "lean-body-mass", unit: "kg", title: "Junction lean body mass", paths: ["leanBodyMassKg", "lean_body_mass_kg", "leanBodyMassKilogram", "lean_body_mass_kilogram", "leanMassKg", "lean_mass_kg"] },
  { metric: "waist-circumference", unit: "cm", title: "Junction waist circumference", paths: ["waistCircumference", "waist_circumference", "waistCircumferenceCentimeter", "waist_circumference_centimeter", "waistCircumferenceCm", "waist_circumference_cm"] },
  { metric: "temperature", unit: "celsius", title: "Junction body temperature", paths: ["temperature", "bodyTemperature", "body_temperature", "temperatureCelsius", "temperature_celsius", "skin_temperature"] },
];

const SLEEP_METRICS: readonly MetricDescriptor[] = [
  { metric: "sleep-score", unit: "%", title: "Junction sleep score", paths: JUNCTION_SLEEP_SCORE_PATHS },
  {
    metric: "sleep-total-minutes",
    unit: "minutes",
    title: "Junction total sleep",
    paths: JUNCTION_SLEEP_TOTAL_MINUTE_PATHS,
    secondsPaths: JUNCTION_SLEEP_TOTAL_SECOND_PATHS,
  },
  { metric: "sleep-deep-minutes", unit: "minutes", title: "Junction deep sleep", paths: JUNCTION_SLEEP_DEEP_MINUTE_PATHS, secondsPaths: JUNCTION_SLEEP_DEEP_SECOND_PATHS },
  { metric: "sleep-rem-minutes", unit: "minutes", title: "Junction REM sleep", paths: JUNCTION_SLEEP_REM_MINUTE_PATHS, secondsPaths: JUNCTION_SLEEP_REM_SECOND_PATHS },
  { metric: "sleep-light-minutes", unit: "minutes", title: "Junction light sleep", paths: JUNCTION_SLEEP_LIGHT_MINUTE_PATHS, secondsPaths: JUNCTION_SLEEP_LIGHT_SECOND_PATHS },
  { metric: "sleep-awake-minutes", unit: "minutes", title: "Junction awake time", paths: JUNCTION_SLEEP_AWAKE_MINUTE_PATHS, secondsPaths: JUNCTION_SLEEP_AWAKE_SECOND_PATHS },
  { metric: "time-in-bed-minutes", unit: "minutes", title: "Junction time in bed", paths: JUNCTION_SLEEP_TIME_IN_BED_MINUTE_PATHS, secondsPaths: JUNCTION_SLEEP_TIME_IN_BED_SECOND_PATHS },
  { metric: "sleep-latency-minutes", unit: "minutes", title: "Junction sleep latency", paths: JUNCTION_SLEEP_LATENCY_MINUTE_PATHS, secondsPaths: JUNCTION_SLEEP_LATENCY_SECOND_PATHS, nonnegative: true },
  { metric: "sleep-efficiency", unit: "%", title: "Junction sleep efficiency", paths: [], percentRatioPaths: JUNCTION_SLEEP_EFFICIENCY_RATIO_PATHS },
  { metric: "sleep-consistency", unit: "%", title: "Junction sleep consistency", paths: JUNCTION_SLEEP_CONSISTENCY_PATHS },
  { metric: "sleep-performance", unit: "%", title: "Junction sleep performance", paths: JUNCTION_SLEEP_PERFORMANCE_PATHS },
  { metric: "hrv", unit: "ms", title: "Junction sleep HRV", paths: JUNCTION_SLEEP_HRV_PATHS },
  { metric: "average-heart-rate", unit: "bpm", title: "Junction sleep average heart rate", paths: JUNCTION_SLEEP_AVERAGE_HEART_RATE_PATHS },
  { metric: "lowest-heart-rate", unit: "bpm", title: "Junction sleep lowest heart rate", paths: JUNCTION_SLEEP_LOWEST_HEART_RATE_PATHS },
  { metric: "resting-heart-rate", unit: "bpm", title: "Junction resting heart rate", paths: JUNCTION_SLEEP_RESTING_HEART_RATE_PATHS },
  { metric: "respiratory-rate", unit: "breaths_per_minute", title: "Junction respiratory rate", paths: JUNCTION_SLEEP_RESPIRATORY_RATE_PATHS },
  { metric: "spo2", unit: "%", title: "Junction blood oxygen", paths: JUNCTION_SLEEP_SPO2_PATHS },
  { metric: "temperature", unit: "celsius", title: "Junction sleep skin temperature", paths: JUNCTION_SLEEP_TEMPERATURE_PATHS },
  { metric: "temperature-deviation", unit: "celsius", title: "Junction sleep temperature delta", paths: JUNCTION_SLEEP_TEMPERATURE_DEVIATION_PATHS },
];
const SLEEP_STAGE_METRIC_NAMES = new Set([
  "sleep-awake-minutes",
  "sleep-light-minutes",
  "sleep-deep-minutes",
  "sleep-rem-minutes",
]);
const SLEEP_STAGE_METRICS = SLEEP_METRICS.filter((metric) => SLEEP_STAGE_METRIC_NAMES.has(metric.metric));
const SLEEP_NON_STAGE_METRICS = SLEEP_METRICS.filter((metric) => !SLEEP_STAGE_METRIC_NAMES.has(metric.metric));
const SLEEP_SUMMARY_OWNER_METRICS = SLEEP_METRICS.filter((metric) =>
  metric.metric === "sleep-total-minutes" || SLEEP_STAGE_METRIC_NAMES.has(metric.metric)
);

type WorkoutSessionMetrics = NonNullable<WorkoutSession["metrics"]>;
type WorkoutHeartRateZone = NonNullable<WorkoutSession["heartRateZones"]>[number];
type WorkoutRouteMetadata = NonNullable<WorkoutSession["route"]>;

const WORKOUT_SESSION_METRICS: readonly {
  key: keyof WorkoutSessionMetrics;
  nonnegative?: boolean;
  paths: readonly string[];
}[] = [
  { key: "activeCalories", nonnegative: true, paths: ["activeCalories", "active_calories", "calories"] },
  { key: "totalCalories", nonnegative: true, paths: ["totalCalories", "total_calories"] },
  { key: "averageHeartRate", nonnegative: true, paths: ["averageHeartRate", "average_heart_rate", "average_hr", "avg_hr"] },
  { key: "maxHeartRate", nonnegative: true, paths: ["maxHeartRate", "max_heart_rate", "max_hr"] },
  { key: "totalElevationGainMeters", nonnegative: true, paths: ["totalElevationGainMeters", "total_elevation_gain_meters", "totalElevationGain", "total_elevation_gain", "elevationGainMeters", "elevation_gain_meters"] },
  { key: "altitudeChangeMeters", paths: ["altitudeChangeMeters", "altitude_change_meters", "altitudeChange", "altitude_change", "elevationChangeMeters", "elevation_change_meters", "elevationChange", "elevation_change"] },
  { key: "elevationHighMeters", paths: ["elevationHighMeters", "elevation_high_meters", "elevationHigh", "elevation_high", "elevHigh", "elev_high", "maxElevationMeters", "max_elevation_meters", "highestElevationMeters", "highest_elevation_meters"] },
  { key: "elevationLowMeters", paths: ["elevationLowMeters", "elevation_low_meters", "elevationLow", "elevation_low", "elevLow", "elev_low", "minElevationMeters", "min_elevation_meters", "lowestElevationMeters", "lowest_elevation_meters"] },
  { key: "averageSpeedMps", nonnegative: true, paths: ["averageSpeedMps", "average_speed_mps", "averageSpeed", "average_speed", "avgSpeed", "avg_speed"] },
  { key: "maxSpeedMps", nonnegative: true, paths: ["maxSpeedMps", "max_speed_mps", "maxSpeed", "max_speed"] },
  { key: "averagePowerWatts", nonnegative: true, paths: ["averagePowerWatts", "average_power_watts", "averagePower", "average_power", "averageWatts", "average_watts", "avgWatts", "avg_watts", "power.average_watts"] },
  { key: "maxPowerWatts", nonnegative: true, paths: ["maxPowerWatts", "max_power_watts", "maxPower", "max_power", "maxWatts", "max_watts", "power.max_watts"] },
  { key: "normalizedPowerWatts", nonnegative: true, paths: ["normalizedPowerWatts", "normalized_power_watts", "normalizedPower", "normalized_power", "np", "power.normalized_watts"] },
  { key: "weightedAveragePowerWatts", nonnegative: true, paths: ["weightedAveragePowerWatts", "weighted_average_power_watts", "weightedAveragePower", "weighted_average_power", "weightedAverageWatts", "weighted_average_watts", "power.weighted_average_watts"] },
  { key: "kilojoules", nonnegative: true, paths: ["kilojoules", "kilojoule", "kj", "power.kilojoules"] },
];
// Junction's exact stream endpoint and shallow webhook use the Junction/Vital
// workout id. The upstream provider id remains source-facing metadata only.
const JUNCTION_WORKOUT_PROVIDER_ID_PATHS = [
  "providerWorkoutId",
  "provider_workout_id",
  "providerId",
  "provider_id",
  "activityId",
  "activity_id",
] as const;
const JUNCTION_WORKOUT_JUNCTION_ID_PATHS = [
  "id",
  "workoutId",
  "workout_id",
] as const;
const JUNCTION_WORKOUT_SOURCE_ID_PATHS = [
  ...JUNCTION_WORKOUT_PROVIDER_ID_PATHS,
  ...JUNCTION_WORKOUT_JUNCTION_ID_PATHS,
] as const;
const JUNCTION_GENERIC_SUMMARY_ID_PATHS = [
  "id",
  "resourceId",
  "resource_id",
  "externalId",
  "external_id",
  "providerId",
  "provider_id",
] as const;
const JUNCTION_RECORD_TIMESTAMP_PATHS = [
  "observedAtRaw",
  "observed_at_raw",
  "observedAt",
  "observed_at",
  "timestamp",
  "time",
  "date",
  "day",
  "end",
  "endAt",
  "end_at",
  "timeEnd",
  "time_end",
  "bedtimeStop",
  "bedtime_stop",
  "start",
  "startAt",
  "start_at",
  "timeStart",
  "time_start",
  "bedtimeStart",
  "bedtime_start",
] as const;
const JUNCTION_MEAL_PROVIDER_ID_PATHS = [
  "mealId",
  "meal_id",
  "providerMealId",
  "provider_meal_id",
  "providerId",
  "provider_id",
] as const;
const JUNCTION_MEAL_STABLE_ID_PATHS = [
  "id",
  "resourceId",
  "resource_id",
  "externalId",
  "external_id",
  ...JUNCTION_MEAL_PROVIDER_ID_PATHS,
] as const;
const JUNCTION_MEAL_TITLE_PATHS = [
  "name",
  "mealName",
  "meal_name",
  "mealType",
  "meal_type",
  "title",
  "description",
] as const;
const JUNCTION_MEAL_CALENDAR_DATE_PATHS = [
  "calendarDate",
  "calendar_date",
  "localDate",
  "local_date",
  "date",
  "day",
] as const;
const JUNCTION_LOCAL_CALENDAR_DATE_PATHS = [
  "calendarDate",
  "calendar_date",
  "localDate",
  "local_date",
] as const;
const JUNCTION_MEAL_ITEM_CONTAINER_PATHS = [
  "data",
  "foods",
  "foodItems",
  "food_items",
  "items",
  "ingredients",
  "nutrients",
] as const;
const JUNCTION_MEAL_ITEM_NAME_PATHS = [
  "name",
  "foodName",
  "food_name",
  "itemName",
  "item_name",
  "title",
  "description",
] as const;
const JUNCTION_MEAL_INGREDIENT_LIST_PATHS = [
  "ingredients",
  "ingredientNames",
  "ingredient_names",
  "foods",
  "foodNames",
  "food_names",
] as const;
const JUNCTION_MEAL_CALORIE_PATHS = [
  "calories",
  "caloriesKcal",
  "calories_kcal",
  "energyKcal",
  "energy_kcal",
  "kcal",
  "nutrition.calories",
  "nutrition.totals.calories",
  "totals.calories",
] as const;
const JUNCTION_MEAL_ENERGY_VALUE_PATHS = [
  "energy.value",
  "nutrition.energy.value",
  "nutrition.totals.energy.value",
  "totals.energy.value",
] as const;
const JUNCTION_MEAL_ENERGY_UNIT_PATHS = [
  "energy.unit",
  "energyUnit",
  "energy_unit",
  "nutrition.energy.unit",
  "nutrition.totals.energy.unit",
  "totals.energy.unit",
] as const;
const JUNCTION_MEAL_PROTEIN_GRAM_PATHS = [
  "protein",
  "proteinGrams",
  "protein_grams",
  "protein_g",
  "macros.protein",
  "macros.proteinGrams",
  "macros.protein_grams",
  "nutrition.totals.proteinGrams",
  "totals.proteinGrams",
] as const;
const JUNCTION_MEAL_CARBS_GRAM_PATHS = [
  "carbs",
  "carbohydrates",
  "carbsGrams",
  "carbs_grams",
  "carbohydrateGrams",
  "carbohydrate_grams",
  "carbohydrate_g",
  "macros.carbs",
  "macros.carbohydrates",
  "nutrition.totals.carbsGrams",
  "totals.carbsGrams",
] as const;
const JUNCTION_MEAL_FAT_GRAM_PATHS = [
  "fat",
  "fatGrams",
  "fat_grams",
  "fat_g",
  "macros.fat",
  "macros.fats",
  "macros.fats.total",
  "macros.totalFat",
  "macros.total_fat",
  "nutrition.totals.fatGrams",
  "totals.fatGrams",
] as const;
const JUNCTION_MEAL_FIBER_GRAM_PATHS = [
  // Junction documents the British spelling: macros.fibre.
  "fibre",
  "fiber",
  "fiberGrams",
  "fiber_grams",
  "fiber_g",
  "dietaryFiber",
  "dietary_fiber",
  "macros.fibre",
  "macros.fiber",
  "macros.fiberGrams",
  "macros.fiber_grams",
  "nutrition.totals.fiberGrams",
  "totals.fiberGrams",
] as const;
const JUNCTION_MEAL_WATER_GRAM_PATHS = [
  "water",
  "waterGrams",
  "water_grams",
  "water_g",
  "macros.water",
  "nutrition.totals.waterGrams",
  "totals.waterGrams",
] as const;
// Junction's documented meal `micros` maps (minerals / trace_elements /
// vitamins) keyed by the provider enum values, mapped onto the bounded
// contract micronutrient keys. Units follow the Junction docs: sodium and
// potassium in grams, copper/manganese and most vitamins in milligrams,
// vitamin A/B12/D/K plus trace elements in micrograms. The `satisfies`
// constraint keeps every contract micronutrient key mapped here.
const JUNCTION_MEAL_MICRO_PATHS = {
  sodiumGrams: "micros.minerals.sodium",
  potassiumGrams: "micros.minerals.potassium",
  calciumMg: "micros.minerals.calcium",
  phosphorusMg: "micros.minerals.phosphorus",
  magnesiumMg: "micros.minerals.magnesium",
  ironMg: "micros.minerals.iron",
  zincMg: "micros.minerals.zinc",
  fluorideMg: "micros.minerals.fluoride",
  chlorideMg: "micros.minerals.chloride",
  chromiumMcg: "micros.trace_elements.chromium",
  copperMg: "micros.trace_elements.copper",
  iodineMcg: "micros.trace_elements.iodine",
  manganeseMg: "micros.trace_elements.manganese",
  molybdenumMcg: "micros.trace_elements.molybdenum",
  seleniumMcg: "micros.trace_elements.selenium",
  vitaminAMcg: "micros.vitamins.vitamin_a",
  vitaminB1Mg: "micros.vitamins.vitamin_b1",
  riboflavinMg: "micros.vitamins.riboflavin",
  niacinMg: "micros.vitamins.niacin",
  pantothenicAcidMg: "micros.vitamins.pantothenic_acid",
  vitaminB6Mg: "micros.vitamins.vitamin_b6",
  biotinMcg: "micros.vitamins.biotin",
  vitaminB12Mcg: "micros.vitamins.vitamin_b12",
  vitaminCMg: "micros.vitamins.vitamin_c",
  vitaminDMcg: "micros.vitamins.vitamin_d",
  vitaminEMg: "micros.vitamins.vitamin_e",
  vitaminKMcg: "micros.vitamins.vitamin_k",
  folicAcidMg: "micros.vitamins.folic_acid",
} as const satisfies Record<MealMicronutrientKey, string>;
const JUNCTION_NESTED_RESOURCE_ENTRY_KEYS = ["data", "results", "items", "records"] as const;
const JUNCTION_MEAL_NESTED_RESOURCE_ENTRY_KEYS = ["meal", "meals", "results", "records"] as const;
const JUNCTION_MENSTRUAL_CYCLE_NESTED_RESOURCE_ENTRY_KEYS = [
  "menstrual_cycle",
  ...JUNCTION_NESTED_RESOURCE_ENTRY_KEYS,
] as const;
const JUNCTION_ELECTROCARDIOGRAM_NESTED_RESOURCE_ENTRY_KEYS = [
  "electrocardiogram",
  ...JUNCTION_NESTED_RESOURCE_ENTRY_KEYS,
] as const;
const JUNCTION_MEAL_NUTRITION_TOTAL_KEYS = [
  "calories",
  "proteinGrams",
  "carbsGrams",
  "fatGrams",
  "fiberGrams",
  "waterGrams",
] as const satisfies readonly MealNutritionTotalKey[];
const JUNCTION_WORKOUT_FALLBACK_STABLE_ID_PATHS = [
  ...JUNCTION_WORKOUT_PROVIDER_ID_PATHS,
  ...JUNCTION_GENERIC_SUMMARY_ID_PATHS,
] as const;
const JUNCTION_BLOOD_OXYGEN_VALUE_PATHS = [
  "value",
  "spo2",
  "spO2",
  "bloodOxygen",
  "blood_oxygen",
  "oxygenSaturation",
  "oxygen_saturation",
] as const;
const JUNCTION_STRESS_LEVEL_VALUE_PATHS = [
  "value",
  "stressLevel",
  "stress_level",
  "averageStressLevel",
  "average_stress_level",
  "stress.average",
  "stressLevelValue",
  "stress_level_value",
  "score",
] as const;
// Junction's generic hrv timeseries is RMSSD-defined for wearable providers,
// while HealthKit's HRV quantity is SDNN. Source-aware metric selection below
// keeps Apple Health observations out of the RMSSD series.
const JUNCTION_HRV_VALUE_PATHS = [
  "value",
  "hrv",
  "rmssd",
  "hrvRmssd",
  "hrv_rmssd",
] as const;
const JUNCTION_RESPIRATORY_RATE_VALUE_PATHS = [
  "value",
  "respiratoryRate",
  "respiratory_rate",
  "respirationRate",
  "respiration_rate",
] as const;
const JUNCTION_VO2_MAX_VALUE_PATHS = [
  "value",
  "vo2Max",
  "vo2_max",
  "vo2max",
  "estimatedVo2Max",
  "estimated_vo2_max",
] as const;
const JUNCTION_BODY_TEMPERATURE_DELTA_VALUE_PATHS = [
  "value",
  "temperatureDelta",
  "temperature_delta",
  "temperatureDeviation",
  "temperature_deviation",
] as const;
const JUNCTION_BODY_TEMPERATURE_VALUE_PATHS = [
  "value",
  "temperature",
  "bodyTemperature",
  "body_temperature",
] as const;
const JUNCTION_BASAL_BODY_TEMPERATURE_VALUE_PATHS = [
  "value",
  "basalBodyTemperature",
  "basal_body_temperature",
] as const;
const JUNCTION_CAFFEINE_VALUE_PATHS = [
  "value",
  "caffeine",
] as const;
const JUNCTION_WATER_VALUE_PATHS = [
  "value",
  "water",
] as const;
const JUNCTION_MINDFULNESS_MINUTES_VALUE_PATHS = [
  "value",
  "mindfulnessMinutes",
  "mindfulness_minutes",
] as const;
const JUNCTION_HEART_RATE_RECOVERY_VALUE_PATHS = [
  "value",
  "heartRateRecoveryOneMinute",
  "heart_rate_recovery_one_minute",
] as const;
const JUNCTION_SLEEP_BREATHING_DISTURBANCE_VALUE_PATHS = [
  "value",
] as const;
const JUNCTION_AFIB_BURDEN_VALUE_PATHS = [
  "value",
  "afibBurden",
  "afib_burden",
] as const;
const JUNCTION_GLUCOSE_VALUE_PATHS = [
  "value",
  "glucose",
  "bloodGlucose",
  "blood_glucose",
] as const;
const JUNCTION_BLOOD_PRESSURE_SYSTOLIC_PATHS = [
  "systolic",
] as const;
const JUNCTION_BLOOD_PRESSURE_DIASTOLIC_PATHS = [
  "diastolic",
] as const;
const JUNCTION_TIME_ZONE_OFFSET_MINUTE_PATHS = [
  "timeZoneOffsetMinutes",
  "time_zone_offset_minutes",
  "timezoneOffsetMinutes",
  "timezone_offset_minutes",
  "utcOffsetMinutes",
  "utc_offset_minutes",
] as const;
const JUNCTION_TIME_ZONE_OFFSET_SECOND_PATHS = [
  "timezone_offset",
  "timezoneOffset",
  "timeZoneOffset",
  "time_zone_offset",
  "timezoneOffsetSeconds",
  "timezone_offset_seconds",
  "timeZoneOffsetSeconds",
  "time_zone_offset_seconds",
  "utcOffsetSeconds",
  "utc_offset_seconds",
] as const;
const JUNCTION_SLEEP_STAGE_START_OFFSET_SECOND_PATHS = [
  "stageStartOffsetSecond",
  "stage_start_offset_second",
  "stageStartOffsetSeconds",
  "stage_start_offset_seconds",
] as const;
const JUNCTION_SLEEP_STAGE_END_OFFSET_SECOND_PATHS = [
  "stageEndOffsetSecond",
  "stage_end_offset_second",
  "stageEndOffsetSeconds",
  "stage_end_offset_seconds",
] as const;
const JUNCTION_SLEEP_STAGE_TYPE_ARRAY_PATHS = [
  "stageType",
  "stage_type",
  "sleepStageType",
  "sleep_stage_type",
] as const;
const JUNCTION_SLEEP_COVERAGE_START_TIMESTAMP_PATHS = [
  ...JUNCTION_SLEEP_START_TIMESTAMP_PATHS,
  "sessionStart",
  "session_start",
] as const;
const JUNCTION_SLEEP_COVERAGE_END_TIMESTAMP_PATHS = [
  ...JUNCTION_SLEEP_END_TIMESTAMP_PATHS,
  "sessionEnd",
  "session_end",
] as const;
const SLEEP_STAGE_COVERAGE_TOLERANCE_MS = 1000;
const JUNCTION_CONTRACT_ID_CROCKFORD_BASE32_ALPHABET =
  "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const JUNCTION_SLEEP_STAGES: readonly JunctionSleepStage[] = ["awake", "light", "deep", "rem"];
const APPLE_HEALTH_KIT_SOURCE_PROVIDER_SLUG = "apple-health-kit";
const HRV_SDNN_METRIC = "hrv-sdnn";
const WHOOP_BLE_OVERNIGHT_PRV_RMSSD_METRIC = "whoop-ble-overnight-prv-rmssd";
const SLEEP_ZEROED_SUMMARY_SUPPRESSED_METRIC_NAMES = new Set([
  "sleep-total-minutes",
  "sleep-efficiency",
  "sleep-light-minutes",
  "sleep-deep-minutes",
  "sleep-rem-minutes",
]);
const SLEEP_ASLEEP_STAGE_METRIC_NAMES = new Set([
  "sleep-light-minutes",
  "sleep-deep-minutes",
  "sleep-rem-minutes",
]);
const JUNCTION_SLEEP_STAGE_SUMMARY_NORMALIZER_VERSION = "junction-sleep-stage-summary.v1";
const JUNCTION_SLEEP_STAGE_CYCLE_FALLBACK_NORMALIZER_VERSION = "junction-sleep-stage-cycle-fallback.v1";
const JUNCTION_SLEEP_UNSPECIFIED_TOTAL_NORMALIZER_VERSION = "junction-sleep-unspecified-total.v1";

type JunctionSleepStage = Exclude<JunctionSleepStageValue, "asleep_unspecified">;

interface JunctionDailyTimeseriesAggregate {
  dayKey: string;
  entry: PlainObject;
  firstSampleAt: string;
  lastRecordedAt?: string;
  lastSampleAt: string;
  legacyDayKeys: Set<string>;
  maxValue: number;
  minValue: number;
  evidencePartRole: string;
  resourceContext: ResourceContext;
  sampleCount: number;
  sum: number;
  timestamp: ReturnType<typeof resolveRecordTimestamp>;
  timeZone?: string;
}

interface JunctionSleepStageAggregate {
  coverageEndAt: string;
  coverageStartAt: string;
  dataOriginEntry: PlainObject;
  durationMinutes: number;
  endAt: string;
  parentResourceId: string;
  recordedAt?: string;
  resourceContext: ResourceContext;
  stage: JunctionSleepStage;
  startAt: string;
  timestamp: ReturnType<typeof resolveRecordTimestamp>;
  timeZone?: string;
}

interface JunctionSleepTotalAggregate {
  coverageEndAt: string;
  coverageStartAt: string;
  dataOriginEntry: PlainObject;
  durationMinutes: number;
  endAt: string;
  parentResourceId: string;
  recordedAt?: string;
  resourceContext: ResourceContext;
  startAt: string;
  timestamp: ReturnType<typeof resolveRecordTimestamp>;
  timeZone?: string;
}

interface JunctionSleepStageInterval {
  dataOriginEntry: PlainObject;
  durationMinutes: number;
  endAt: string;
  intervalEntry: PlainObject;
  recordedAt?: string;
  stage: JunctionSleepStageValue;
  startAt: string;
  timestamp: ReturnType<typeof resolveRecordTimestamp>;
  timeZone?: string;
}

interface JunctionSleepStageCoverageWindow {
  endAt: string;
  startAt: string;
}

interface JunctionCoveredSleepStageIntervals {
  coverageWindow: JunctionSleepStageCoverageWindow;
  intervals: JunctionSleepStageInterval[];
}

interface JunctionSleepStageAggregateBucket {
  coverageEndAt: string;
  coverageStartAt: string;
  dataOriginEntry: PlainObject;
  endAt: string;
  parentResourceId: string;
  recordedAt?: string;
  resourceContext: ResourceContext;
  startAt: string;
  timestamp: ReturnType<typeof resolveRecordTimestamp>;
  timeZone?: string;
}

interface JunctionSleepSummaryStageMetricOwner {
  endAt: string;
  metric: string;
  sourceInstanceId?: string;
  sourceProviderSlug: string;
  sourceType?: string;
  startAt: string;
}

function parseJunctionSnapshot(snapshot: unknown): JunctionSnapshotInput {
  const parsed = junctionSnapshotSchema.parse(snapshot);
  return {
    ...parsed,
    workoutFeatures: parsed.workoutFeatures?.map(parseJunctionWorkoutFeatureEnvelope),
    companionHrvRmssd: parsed.companionHrvRmssd === undefined
      ? undefined
      : parseJunctionCompanionHrvRmssdSnapshotEntry(parsed.companionHrvRmssd),
  };
}

function parseJunctionCompanionHrvRmssdSnapshotEntry(
  value: unknown,
): JunctionCompanionHrvRmssdSnapshotEntry {
  const parsed = junctionCompanionHrvRmssdSnapshotEntrySchema.parse(value);
  const admissionId = parseCompanionHrvRmssdAdmissionId(parsed.admissionId);
  const observation = parseCompanionHrvRmssdObservation(parsed.observation);
  const expectedAdmissionId = createHash("sha256")
    .update(serializeCompanionHrvRmssdObservation(observation))
    .digest("hex");
  if (admissionId !== expectedAdmissionId) {
    throw new TypeError("Companion HRV admission identity did not match its observation.");
  }

  return { admissionId, observation };
}

export function normalizeJunctionSnapshot(
  snapshot: JunctionSnapshotInput,
  providerContext: DeviceProviderNormalizationContext = {},
): NormalizedDeviceBatch {
  const importedAt = normalizeTimestamp(snapshot.importedAt);
  const windowStart = normalizeTimestamp(snapshot.windowStart);
  const windowEnd = normalizeTimestamp(snapshot.windowEnd);
  const evidenceParts: DeviceEvidencePartPayload[] = [];
  const events: DeviceEventPayload[] = [];
  const samples: DeviceSamplePayload[] = [];
  const companionHrvRmssd = snapshot.companionHrvRmssd === undefined
    ? undefined
    : parseJunctionCompanionHrvRmssdSnapshotEntry(snapshot.companionHrvRmssd);
  const connections = asArray(snapshot.connections).flatMap((connection) => {
    const normalized = asPlainObject(connection);
    return normalized ? [normalized] : [];
  });
  const context: NormalizationContext = {
    defaultTimeZone: providerContext.defaultTimeZone,
    importedAt,
    windowStart,
    windowEnd,
    connectionsByKey: buildConnectionsByKey(connections),
    evidenceParts,
    events,
    samples,
    authoritativeEventSets: [],
  };

  normalizeSummaries(snapshot.summaries, context);
  normalizeTimeseries(snapshot.timeseries, context);
  normalizeJunctionWorkoutFeatures(snapshot.workoutFeatures, context);
  normalizeCompanionHrvRmssd(companionHrvRmssd, context);

  return makeNormalizedDeviceBatch({
    provider: "junction",
    accountId: stringId(snapshot.accountId),
    importedAt,
    events,
    samples: samples.length > 0 ? samples : undefined,
    evidenceParts,
    authoritativeEventSets: context.authoritativeEventSets.length > 0
      ? context.authoritativeEventSets
      : undefined,
    provenance: stripUndefined({
      schema: "junction.snapshot.v1",
      normalizerVersion: "junction-normalizer.v1",
      windowStart,
      windowEnd,
      connections: connections.length,
      summaryResources: listAllowedResourceKeys(snapshot.summaries, SUMMARY_RESOURCE_ALLOWLIST),
      timeseriesResources: listAllowedResourceKeys(snapshot.timeseries, TIMESERIES_RESOURCE_ALLOWLIST),
      workoutFeatureEnvelopes: snapshot.workoutFeatures?.length ?? 0,
      companionHrvRmssdObservations: companionHrvRmssd ? 1 : 0,
    }),
  });
}

export function classifyJunctionSummaryNormalizationEvidence(
  snapshot: Pick<
    JunctionSnapshotInput,
    "connections" | "importedAt" | "summaries" | "windowEnd" | "windowStart"
  >,
  evidenceWindow?: JunctionSummaryNormalizationEvidenceWindow,
): readonly JunctionSummaryNormalizationEvidence[] {
  const evidenceRange = evidenceWindow
    ? {
        endMs: Date.parse(evidenceWindow.windowEnd),
        startMs: Date.parse(evidenceWindow.windowStart),
      }
    : null;
  if (
    evidenceRange
    && (
      !Number.isFinite(evidenceRange.startMs)
      || !Number.isFinite(evidenceRange.endMs)
      || evidenceRange.startMs >= evidenceRange.endMs
    )
  ) {
    return [];
  }

  const evidenceByKey = new Map<string, JunctionSummaryNormalizationEvidence>();

  for (const [resource, payload] of allowedResourceEntries(
    snapshot.summaries,
    SUMMARY_RESOURCE_ALLOWLIST,
  )) {
    const normalized = normalizeJunctionSnapshot({
      connections: snapshot.connections,
      importedAt: snapshot.importedAt,
      summaries: { [resource]: payload },
      windowEnd: snapshot.windowEnd,
      windowStart: snapshot.windowStart,
    });

    for (const event of normalized.events ?? []) {
      if (
        evidenceRange
        && !isJunctionSummaryEvidenceEventInRange(event, evidenceRange)
      ) {
        continue;
      }
      const sourceProviderSlug = normalizeJunctionSourceProviderSlug(
        event.dataOrigin?.sourceProviderSlug,
      );
      if (!sourceProviderSlug) {
        continue;
      }

      const summaryResource = resource as JunctionSummaryResource;
      const key = `${summaryResource}\u0000${sourceProviderSlug}`;
      evidenceByKey.set(key, {
        resource: summaryResource,
        sourceProviderSlug,
      });
    }
  }

  return [...evidenceByKey.values()].sort((left, right) =>
    left.resource.localeCompare(right.resource)
    || left.sourceProviderSlug.localeCompare(right.sourceProviderSlug)
  );
}

export function classifyJunctionWorkoutDurationCompanionCoverage(
  snapshot: Pick<
    JunctionSnapshotInput,
    "connections" | "importedAt" | "summaries" | "timeseries" | "windowEnd" | "windowStart"
  >,
): JunctionWorkoutDurationCompanionCoverage {
  const events = normalizeJunctionSnapshot(snapshot).events ?? [];
  const sessionIdentities = new Set(events.flatMap((event) => {
    const identity = event.kind === "activity_session"
      ? junctionWorkoutExternalIdentity(event)
      : undefined;
    return identity ? [identity] : [];
  }));
  const exactLinkedDurationIdentities = new Set(events.flatMap((event) => {
    if (!isJunctionWorkoutDurationMeasurement(event)) {
      return [];
    }
    const identity = junctionWorkoutExternalIdentity(event);
    return identity ? [identity] : [];
  }));
  const matchedExactLinkedDurationCount = [...exactLinkedDurationIdentities]
    .filter((identity) => sessionIdentities.has(identity))
    .length;

  return {
    complete: matchedExactLinkedDurationCount === exactLinkedDurationIdentities.size,
    exactLinkedDurationCount: exactLinkedDurationIdentities.size,
    matchedExactLinkedDurationCount,
  };
}

function isJunctionWorkoutDurationMeasurement(event: DeviceEventPayload): boolean {
  if (event.kind !== "measurement") {
    return false;
  }
  return asArray(event.fields?.measurements).some((measurement) =>
    asPlainObject(measurement)?.metric === "workout-duration"
  );
}

function junctionWorkoutExternalIdentity(event: DeviceEventPayload): string | undefined {
  const externalRef = event.externalRef;
  if (
    !externalRef
    || externalRef.system !== "junction"
    || !externalRef.resourceType.endsWith("-workouts")
  ) {
    return undefined;
  }
  return [externalRef.system, externalRef.resourceType, externalRef.resourceId].join("\u0000");
}

export function identifyJunctionBloodPressureProviderRecords(
  snapshot: Pick<
    JunctionSnapshotInput,
    "connections" | "importedAt" | "timeseries" | "windowEnd" | "windowStart"
  >,
): JunctionBloodPressureProviderRecordIdentityEvidence {
  const connections = asArray(snapshot.connections).flatMap((connection) => {
    const normalized = asPlainObject(connection);
    return normalized ? [normalized] : [];
  });
  const context: NormalizationContext = {
    importedAt: normalizeTimestamp(snapshot.importedAt),
    windowStart: normalizeTimestamp(snapshot.windowStart),
    windowEnd: normalizeTimestamp(snapshot.windowEnd),
    connectionsByKey: buildConnectionsByKey(connections),
    evidenceParts: [],
    events: [],
    samples: [],
    authoritativeEventSets: [],
  };
  const repairStableExternalRefResourceIds: Array<string | null> = [];

  for (const [resource, payload] of allowedResourceEntries(
    snapshot.timeseries,
    TIMESERIES_RESOURCE_ALLOWLIST,
  )) {
    if (resource !== JUNCTION_BLOOD_PRESSURE_RESOURCE) {
      continue;
    }

    const resourceSlug = slugify(resource, "timeseries");
    const baseArtifactRole = `junction-timeseries-reading-${resourceSlug}`;
    for (const [index, { entry, originFallback }] of timeseriesResourceEntries(payload).entries()) {
      const resourceContext = buildResourceContext({
        entry,
        originFallback,
        resource,
        resourceSlug,
        identityKind: "timeseries",
        index,
        fallbackArtifactRole: baseArtifactRole,
        context,
      });
      repairStableExternalRefResourceIds.push(
        resourceContext
          ? buildJunctionBloodPressureRepairStableExternalRefResourceId(
              entry,
              resourceContext,
            )
          : null,
      );
    }
  }

  return {
    providerRecordCount: repairStableExternalRefResourceIds.length,
    repairStableExternalRefResourceIds,
  };
}

function isJunctionSummaryEvidenceEventInRange(
  event: Pick<DeviceEventPayload, "dayKey" | "occurredAt">,
  evidenceRange: { endMs: number; startMs: number },
): boolean {
  const occurredAtMs = Date.parse(event.occurredAt);
  if (
    Number.isFinite(occurredAtMs)
    && occurredAtMs >= evidenceRange.startMs
    && occurredAtMs < evidenceRange.endMs
  ) {
    return true;
  }

  // Daily summaries and overnight sessions can canonically occur at or after
  // the UTC window end while still belonging to its final calendar day. The
  // importer-owned dayKey is the stable ownership signal for that case; a
  // connection-day record has the next dayKey and remains outside the window.
  if (typeof event.dayKey !== "string" || !isDateOnlyJunctionTimestamp(event.dayKey)) {
    return false;
  }
  const dayStartMs = Date.parse(`${event.dayKey}T00:00:00.000Z`);
  return Number.isFinite(dayStartMs)
    && dayStartMs >= evidenceRange.startMs
    && dayStartMs < evidenceRange.endMs;
}

function normalizeCompanionHrvRmssd(
  entry: JunctionCompanionHrvRmssdSnapshotEntry | undefined,
  context: NormalizationContext,
): void {
  if (!entry) {
    return;
  }

  const { admissionId, observation } = entry;
  const occurredAt = `${observation.nightDate}T12:00:00.000Z`;
  const contentVersion = `${observation.methodVersion}:${admissionId}`;
  const identity = createHash("sha256")
    .update(admissionId)
    .digest("hex")
    .slice(0, 16);
  const evidenceRole = `companion-hrv-rmssd:${identity}`;

  pushEvidencePart(
    context.evidenceParts,
    createEvidencePart(
      evidenceRole,
      `companion-hrv-rmssd-${identity}.json`,
      observation,
    ),
  );
  context.events.push({
    kind: "observation",
    occurredAt,
    dayKey: observation.nightDate,
    source: "device",
    title: "Estimated WHOOP BLE scheduled overnight PRV (RMSSD)",
    evidenceRoles: [evidenceRole],
    externalRef: makeProviderExternalRef(
      "whoop",
      "companion-overnight-hrv-rmssd",
      observation.nightDate,
      contentVersion,
      WHOOP_BLE_OVERNIGHT_PRV_RMSSD_METRIC,
    ),
    externalRefUpdatePolicy: "immutable",
    dataOrigin: {
      version: 1,
      aggregatorProvider: "murph-companion",
      sourceProviderSlug: "whoop",
      sourceType: "ble-pulse-interval",
      observedAtRaw: observation.nightDate,
      timestampSemantics: "floating",
      originConfidence: "medium",
      normalizerVersion: "companion-overnight-hrv-rmssd-normalizer.v1",
    },
    fields: {
      metric: WHOOP_BLE_OVERNIGHT_PRV_RMSSD_METRIC,
      observationGrain: "summary",
      value: observation.rmssdMs,
      unit: "ms",
    },
  });
}

export function canNormalizeJunctionSleepCycleRecordToCompactStages(
  record: Record<string, unknown>,
  sourceProviderSlug: string,
): boolean {
  const entries = resourceEntries(record, "sleep_cycle");
  return entries.length > 0 && entries.every(({ entry }) => {
    if (!hasSleepCycleCompactParentIdentity(entry, sourceProviderSlug)) {
      return false;
    }

    const coverageWindow = resolveSleepStageCoverageWindow(entry, sourceProviderSlug);
    return coverageWindow
      ? sleepStageCoverageIntervalsCoverWindow(
        collectSleepStageCoverageIntervals(entry, sourceProviderSlug),
        coverageWindow,
      )
      : false;
  });
}

function normalizeSummaries(
  summaries: Record<string, unknown> | undefined,
  context: NormalizationContext,
): void {
  const summaryEntries = allowedResourceEntries(summaries, SUMMARY_RESOURCE_ALLOWLIST);
  const sleepSummaryMetricOwners = collectJunctionSleepSummaryMetricOwners(summaryEntries, context);

  for (const [resource, payload] of summaryEntries) {
    const preparedMenstrualCycle = resource === "menstrual_cycle"
      ? prepareJunctionMenstrualCycleSummary(payload, context.connectionsByKey)
      : undefined;
    const entries = preparedMenstrualCycle ? [] : resourceEntries(payload, resource);
    const resourceSlug = slugify(resource, "summary");
    const evidencePartRole = `junction-summary-${resourceSlug}`;
    const fallbackIdentityDisambiguators = resource === "meal"
      ? buildJunctionMealFallbackIdentityDisambiguators({
          context,
          entries,
          fallbackArtifactRole: evidencePartRole,
          resource,
          resourceSlug,
        })
      : new Map<number, string>();
    if (resource !== "workouts") {
      pushEvidencePart(
        context.evidenceParts,
        createEvidencePart(
          evidencePartRole,
          `${evidencePartRole}.json`,
          preparedMenstrualCycle?.evidence
            ?? buildRawResourcePayload(resource, payload, context.connectionsByKey),
        ),
      );
    }

    if (preparedMenstrualCycle) {
      preparedMenstrualCycle.cycles.forEach((cycle, index) => {
        const resourceContext = buildResourceContext({
          entry: cycle.entry,
          originFallback: cycle.originFallback,
          resource,
          resourceSlug,
          identityKind: "summary",
          index,
          fallbackArtifactRole: evidencePartRole,
          context,
        });
        if (!resourceContext) {
          return;
        }

        const firstEventIndex = context.events.length;
        pushMenstrualCycleSummary(cycle, resourceContext, context);
        pushJunctionAuthoritativeSummaryEventSet(
          cycle.entry,
          resourceContext,
          context,
          context.events.slice(firstEventIndex),
        );
      });
      continue;
    }

    const resolvedEntries = entries.flatMap(({ entry, originFallback }, index): JunctionResolvedResourceEntry[] => {
      const resourceContext = buildResourceContext({
        entry,
        originFallback,
        resource,
        resourceSlug,
        identityKind: "summary",
        index,
        fallbackArtifactRole: evidencePartRole,
        fallbackIdentityDisambiguator: fallbackIdentityDisambiguators.get(index),
        context,
      });

      if (!resourceContext) {
        return [];
      }

      return [{ entry, resourceContext }];
    });

    if (resource === "sleep_cycle") {
      pushSleepCycleEntries(resolvedEntries, context, sleepSummaryMetricOwners);
      continue;
    }

    const firstResourceEventIndex = context.events.length;
    resolvedEntries.forEach(({ entry, resourceContext }) => {
      const firstEventIndex = context.events.length;
      switch (resource) {
        case "activity":
          pushObservationMetrics(entry, resourceContext, context, ACTIVITY_METRICS);
          break;
        case "body":
          pushObservationMetrics(entry, resourceContext, context, BODY_METRICS);
          break;
        case "sleep":
          pushSleepSummary(entry, resourceContext, context);
          break;
        case "workouts":
          pushWorkoutSummary(entry, resourceContext, context);
          break;
        case "meal":
          pushMealSummary(entry, resourceContext, context);
          break;
        case "profile":
          pushProfileSummary(entry, resourceContext, context);
          break;
        case "electrocardiogram":
          pushElectrocardiogramSummary(entry, resourceContext, context);
          break;
      }
      pushJunctionAuthoritativeSummaryEventSet(
        entry,
        resourceContext,
        context,
        context.events.slice(firstEventIndex),
      );
    });

    if (resource === "workouts") {
      pushEvidencePart(
        context.evidenceParts,
        createEvidencePart(
          evidencePartRole,
          `${evidencePartRole}.json`,
          buildJunctionWorkoutSummaryEvidence(
            context.events.slice(firstResourceEventIndex),
          ),
        ),
      );
    }
  }
}

function collectJunctionSleepSummaryMetricOwners(
  summaryEntries: readonly [string, unknown][],
  context: NormalizationContext,
): JunctionSleepSummaryStageMetricOwner[] {
  const sleepEntry = summaryEntries.find(([resource]) => resource === "sleep");
  if (!sleepEntry) {
    return [];
  }

  const [resource, payload] = sleepEntry;
  const resourceSlug = slugify(resource, "summary");
  const evidencePartRole = `junction-summary-${resourceSlug}`;
  const owners: JunctionSleepSummaryStageMetricOwner[] = [];

  resourceEntries(payload, resource).forEach(({ entry, originFallback }, index) => {
    const resourceContext = buildResourceContext({
      entry,
      originFallback,
      resource,
      resourceSlug,
      identityKind: "summary",
      index,
      fallbackArtifactRole: evidencePartRole,
      context,
    });
    if (!resourceContext) {
      return;
    }

    const startAt = resolveSafeTimestamp(
      firstValueFromPaths(entry, JUNCTION_SLEEP_START_TIMESTAMP_PATHS),
      resourceContext.sourceProviderSlug,
    );
    const endAt = resolveSafeTimestamp(
      firstValueFromPaths(entry, JUNCTION_SLEEP_END_TIMESTAMP_PATHS),
      resourceContext.sourceProviderSlug,
    );
    if (!startAt || !endAt) {
      return;
    }
    const durationMinutes = resolveSleepSummaryDurationMinutes(entry, startAt, endAt);
    const zeroedSummary = isZeroedAppleHealthKitSleepSummary(entry, resourceContext, durationMinutes);

    for (const metric of SLEEP_SUMMARY_OWNER_METRICS) {
      if (zeroedSummary && SLEEP_ZEROED_SUMMARY_SUPPRESSED_METRIC_NAMES.has(metric.metric)) {
        continue;
      }
      if (!resolveMetricDescriptorValue(entry, metric)) {
        continue;
      }

      owners.push(stripUndefined({
        endAt,
        metric: metric.metric,
        sourceInstanceId: resourceContext.origin.sourceInstanceId ?? undefined,
        sourceProviderSlug: resourceContext.sourceProviderSlug,
        sourceType: resourceContext.origin.sourceType,
        startAt,
      }));
    }
  });

  return owners;
}

function buildJunctionMealFallbackIdentityDisambiguators(input: {
  context: NormalizationContext;
  entries: readonly JunctionResourceEntry[];
  fallbackArtifactRole: string;
  resource: string;
  resourceSlug: string;
}): ReadonlyMap<number, string> {
  const fallbackRecords: Array<{ index: number; key: string }> = [];

  input.entries.forEach(({ entry, originFallback }, index) => {
    if (firstStringFromPaths(entry, JUNCTION_MEAL_STABLE_ID_PATHS)) {
      return;
    }

    const resourceContext = buildResourceContext({
      entry,
      originFallback,
      resource: input.resource,
      resourceSlug: input.resourceSlug,
      identityKind: "summary",
      index,
      fallbackArtifactRole: input.fallbackArtifactRole,
      context: input.context,
    });
    if (!resourceContext) {
      return;
    }

    const resolvedTimestamp = resolveJunctionMealTimestamp(
      entry,
      input.context,
      resourceContext.sourceProviderSlug,
    );
    if (!resolvedTimestamp) {
      return;
    }

    fallbackRecords.push({
      index,
      key: JSON.stringify(buildJunctionMealFallbackIdentityParts(
        resourceContext,
        entry,
        resolvedTimestamp.timestamp,
        { includeDisambiguator: false },
      )),
    });
  });

  const countsByKey = new Map<string, number>();
  for (const record of fallbackRecords) {
    countsByKey.set(record.key, (countsByKey.get(record.key) ?? 0) + 1);
  }

  const nextOrdinalByKey = new Map<string, number>();
  const disambiguators = new Map<number, string>();
  for (const record of fallbackRecords) {
    if ((countsByKey.get(record.key) ?? 0) <= 1) {
      continue;
    }

    const ordinal = (nextOrdinalByKey.get(record.key) ?? 0) + 1;
    nextOrdinalByKey.set(record.key, ordinal);
    disambiguators.set(record.index, `duplicate-${ordinal}`);
  }

  return disambiguators;
}

interface JunctionDailyTimeseriesObservationDescriptor {
  metric: string;
  statistic: "mean" | "min" | "max" | "sum";
  title: string;
}

interface JunctionDailyTimeseriesDescriptor {
  normalizeValue: (value: unknown) => number | undefined;
  observations: readonly JunctionDailyTimeseriesObservationDescriptor[];
  unit: string;
  valuePaths: readonly string[];
}

// Every default-enabled timeseries resource must appear here with a bounded
// daily-aggregate mapping (or, for paired-shape `blood_pressure` only, the
// dedicated sparse per-reading handler below); raw evidence stays one compact
// ~430 B `junction.timeseries_daily_aggregate.v1` artifact per day per
// resource (~160 KB/member-year/resource) no matter how dense the provider
// stream is: glucose CGM streams (288 samples/day, ~10-15 MB/yr raw) reduce
// to the same one artifact per day. Resource classifications and payload
// field names are verified against docs.junction.com
// (wearables/providers/resources; api-reference/data/timeseries/*): hrv,
// respiratory_rate, blood_oxygen, glucose, and stress_level are discrete
// timeseries; vo2_max, body_temperature(_delta), basal_body_temperature,
// caffeine, water, mindfulness_minutes, heart_rate_recovery_one_minute,
// sleep_breathing_disturbance, and afib_burden are interval timeseries. All
// reduce to daily-grain observations below.
const JUNCTION_DAILY_TIMESERIES_DESCRIPTOR_ENTRIES: readonly (readonly [
  JunctionTimeseriesResource,
  JunctionDailyTimeseriesDescriptor,
])[] = [
  ["blood_oxygen", {
    normalizeValue: normalizeBloodOxygenPercent,
    observations: [
      { metric: "spo2", statistic: "mean", title: "Junction blood oxygen average" },
      { metric: "lowest-spo2", statistic: "min", title: "Junction blood oxygen minimum" },
    ],
    unit: "%",
    valuePaths: JUNCTION_BLOOD_OXYGEN_VALUE_PATHS,
  }],
  ["stress_level", {
    normalizeValue: normalizeStressLevelScore,
    observations: [
      { metric: "stress-level", statistic: "mean", title: "Junction stress level average" },
    ],
    unit: "score",
    valuePaths: JUNCTION_STRESS_LEVEL_VALUE_PATHS,
  }],
  ["hrv", {
    normalizeValue: normalizeHrvMilliseconds,
    observations: [
      { metric: "hrv", statistic: "mean", title: "Junction HRV average" },
    ],
    unit: "ms",
    valuePaths: JUNCTION_HRV_VALUE_PATHS,
  }],
  ["respiratory_rate", {
    normalizeValue: normalizeRespiratoryRateBreathsPerMinute,
    observations: [
      { metric: "respiratory-rate", statistic: "mean", title: "Junction respiratory rate average" },
    ],
    unit: "breaths_per_minute",
    valuePaths: JUNCTION_RESPIRATORY_RATE_VALUE_PATHS,
  }],
  ["vo2_max", {
    normalizeValue: normalizeVo2Max,
    observations: [
      { metric: "estimated-vo2-max", statistic: "mean", title: "Junction estimated VO2 max" },
    ],
    unit: "ml/kg/min",
    valuePaths: JUNCTION_VO2_MAX_VALUE_PATHS,
  }],
  ["body_temperature_delta", {
    normalizeValue: normalizeBodyTemperatureDeltaCelsius,
    observations: [
      { metric: "temperature-deviation", statistic: "mean", title: "Junction body temperature deviation" },
    ],
    unit: "celsius",
    valuePaths: JUNCTION_BODY_TEMPERATURE_DELTA_VALUE_PATHS,
  }],
  ["body_temperature", {
    normalizeValue: normalizeBodyTemperatureCelsius,
    observations: [
      { metric: "temperature", statistic: "mean", title: "Junction body temperature average" },
    ],
    unit: "celsius",
    valuePaths: JUNCTION_BODY_TEMPERATURE_VALUE_PATHS,
  }],
  ["basal_body_temperature", {
    normalizeValue: normalizeBodyTemperatureCelsius,
    observations: [
      { metric: "basal-body-temperature", statistic: "mean", title: "Junction basal body temperature average" },
    ],
    unit: "celsius",
    valuePaths: JUNCTION_BASAL_BODY_TEMPERATURE_VALUE_PATHS,
  }],
  ["caffeine", {
    normalizeValue: normalizeCaffeineMilligrams,
    observations: [
      { metric: "caffeine", statistic: "sum", title: "Junction caffeine intake" },
    ],
    unit: "mg",
    valuePaths: JUNCTION_CAFFEINE_VALUE_PATHS,
  }],
  ["water", {
    normalizeValue: normalizeWaterMilliliters,
    observations: [
      { metric: "water", statistic: "sum", title: "Junction water intake" },
    ],
    unit: "ml",
    valuePaths: JUNCTION_WATER_VALUE_PATHS,
  }],
  ["mindfulness_minutes", {
    normalizeValue: normalizeMindfulnessMinutesValue,
    observations: [
      { metric: "mindfulness-minutes", statistic: "sum", title: "Junction mindful minutes" },
    ],
    unit: "minutes",
    valuePaths: JUNCTION_MINDFULNESS_MINUTES_VALUE_PATHS,
  }],
  ["heart_rate_recovery_one_minute", {
    normalizeValue: normalizeHeartRateRecoveryBeats,
    observations: [
      { metric: "heart-rate-recovery-one-minute", statistic: "mean", title: "Junction heart rate recovery (1 min) average" },
    ],
    unit: "bpm",
    valuePaths: JUNCTION_HEART_RATE_RECOVERY_VALUE_PATHS,
  }],
  ["sleep_breathing_disturbance", {
    normalizeValue: normalizeSleepBreathingDisturbanceValue,
    observations: [
      { metric: "sleep-breathing-disturbance", statistic: "mean", title: "Junction sleep breathing disturbances" },
    ],
    unit: "count",
    valuePaths: JUNCTION_SLEEP_BREATHING_DISTURBANCE_VALUE_PATHS,
  }],
  // Apple computes AFib burden roughly weekly; the daily-aggregate seam still
  // bounds it to at most one artifact per day with data.
  ["afib_burden", {
    normalizeValue: normalizeAfibBurdenPercent,
    observations: [
      { metric: "afib-burden", statistic: "mean", title: "Junction AFib burden" },
    ],
    unit: "%",
    valuePaths: JUNCTION_AFIB_BURDEN_VALUE_PATHS,
  }],
  ["glucose", {
    normalizeValue: normalizeGlucoseMilligramsPerDeciliter,
    observations: [
      { metric: "glucose", statistic: "mean", title: "Junction glucose average" },
      { metric: "lowest-glucose", statistic: "min", title: "Junction glucose minimum" },
      { metric: "highest-glucose", statistic: "max", title: "Junction glucose maximum" },
    ],
    unit: "mg/dL",
    valuePaths: JUNCTION_GLUCOSE_VALUE_PATHS,
  }],
];

const JUNCTION_DAILY_TIMESERIES_DESCRIPTORS: ReadonlyMap<string, JunctionDailyTimeseriesDescriptor> =
  new Map(JUNCTION_DAILY_TIMESERIES_DESCRIPTOR_ENTRIES);

// Junction's blood-pressure timeseries pairs `systolic`/`diastolic` per
// reading (docs.junction.com/api-reference/data/timeseries/blood-pressure),
// so it cannot reduce through the single-value daily-aggregate descriptors.
// Readings are sparse (10s-100s per member-year): each one lands as a paired
// `measurement` event plus one compact per-reading evidence part.
const JUNCTION_BLOOD_PRESSURE_RESOURCE = "blood_pressure";
const JUNCTION_NOTE_RESOURCE = "note";
const JUNCTION_WORKOUT_DURATION_RESOURCE = "workout_duration";

// Derived from the descriptor entries (plus the sparse paired blood-pressure
// resource) so the raw-snapshot sanitization allowlist cannot drift from the
// bounded normalization set.
const COMPACT_TIMESERIES_RESOURCE_ALLOWLIST: ReadonlySet<string> = new Set([
  ...JUNCTION_DAILY_TIMESERIES_DESCRIPTOR_ENTRIES.map(([resource]) => resource),
  JUNCTION_BLOOD_PRESSURE_RESOURCE,
  JUNCTION_NOTE_RESOURCE,
  JUNCTION_WORKOUT_DURATION_RESOURCE,
]);

function normalizeTimeseries(
  timeseries: Record<string, unknown> | undefined,
  context: NormalizationContext,
): void {
  for (const [resource, payload] of allowedResourceEntries(timeseries, TIMESERIES_RESOURCE_ALLOWLIST)) {
    if (resource === JUNCTION_NOTE_RESOURCE) {
      pushJunctionNoteTags(payload, resource, slugify(resource, "timeseries"), context);
      continue;
    }

    if (resource === JUNCTION_BLOOD_PRESSURE_RESOURCE) {
      pushJunctionBloodPressureReadings(payload, resource, slugify(resource, "timeseries"), context);
      continue;
    }

    if (resource === JUNCTION_WORKOUT_DURATION_RESOURCE) {
      pushJunctionSparseWorkoutDurationFacts(payload, slugify(resource, "timeseries"), context);
      continue;
    }

    const descriptor = JUNCTION_DAILY_TIMESERIES_DESCRIPTORS.get(resource);
    if (descriptor) {
      pushJunctionDailyTimeseriesObservations(payload, resource, slugify(resource, "timeseries"), context, descriptor);
    }
  }
}

function pushJunctionSparseWorkoutDurationFacts(
  payload: unknown,
  resourceSlug: string,
  context: NormalizationContext,
): void {
  const resource = JUNCTION_WORKOUT_DURATION_RESOURCE;
  const baseArtifactRole = `junction-timeseries-reading-${resourceSlug}`;
  const seenFacts = new Set<string>();
  const selectedEvidenceParts: DeviceEvidencePartPayload[] = [];
  const selectedEvents: DeviceEventPayload[] = [];

  const entries = timeseriesResourceEntries(payload);
  for (const [index, { entry, originFallback }] of [...entries.entries()].reverse()) {
    const workoutId = trimOptionalToLength(firstStringFromPaths(entry, [
      "workoutId",
      "workout_id",
      "metadata.workoutId",
      "metadata.workout_id",
      "source.workoutId",
      "source.workout_id",
    ]), 200);
    const rawSport = firstStringFromPaths(entry, [
      "sport.slug",
      "sport.name",
      "sport",
      "metadata.sport.slug",
      "metadata.sport.name",
      "metadata.sport",
      "source.sport.slug",
      "source.sport.name",
      "source.sport",
    ]);
    const sport = rawSport
      ? trimSlugToLength(slugify(rawSport, "workout"), 80)
      : undefined;
    const linkedEntry = workoutId ? { ...entry, id: workoutId } : entry;
    // Grouped timeseries entries already contain the merged group envelope.
    // Retain only the group-key provider fallback so the same source device is
    // not hashed twice and exact workout facts share the summary identity.
    const linkedOriginFallback = originFallback?.groupedSourceSlug
      ? { groupedSourceSlug: originFallback.groupedSourceSlug }
      : undefined;
    const resourceContext = buildResourceContext({
      entry: linkedEntry,
      originFallback: linkedOriginFallback,
      resource: workoutId ? "workouts" : resource,
      resourceSlug: workoutId ? "workouts" : resourceSlug,
      identityKind: workoutId ? "summary" : "timeseries",
      index,
      fallbackArtifactRole: baseArtifactRole,
      context,
    });
    if (!resourceContext) {
      continue;
    }

    const timestamp = resolveRecordTimestamp(entry, context, resourceContext.sourceProviderSlug);
    const startAt = resolveSafeTimestamp(
      firstValueFromPaths(entry, ["start", "startAt", "start_at", "timestamp"]),
      resourceContext.sourceProviderSlug,
    );
    const endAt = resolveSafeTimestamp(
      firstValueFromPaths(entry, ["end", "endAt", "end_at"]),
      resourceContext.sourceProviderSlug,
    );
    const occurredAt = startAt ?? timestamp.occurredAt;
    const dayKey = occurredAt
      ? resolveJunctionTimeseriesAggregateDayKey(entry, timestamp, occurredAt, context.defaultTimeZone)
      : undefined;
    const measurementValue = normalizeJunctionSparseWorkoutDurationValue(entry, startAt, endAt);
    if (!occurredAt || !dayKey || measurementValue === null) {
      continue;
    }

    const factIdentityHash = shortHash([
      resource,
      resourceContext.sourceProviderSlug,
      ...(workoutId
        ? []
        : [resourceContext.origin.sourceType, resourceContext.origin.sourceInstanceId, sport]),
      workoutId,
      startAt ?? occurredAt,
      endAt,
    ]);
    if (seenFacts.has(factIdentityHash)) {
      continue;
    }
    seenFacts.add(factIdentityHash);

    const factContentHash = shortHash([
      factIdentityHash,
      measurementValue.value,
      measurementValue.unit,
    ]);
    const role = `${baseArtifactRole}:${dayKey}:${factContentHash}`;
    const workoutTimestamp = withTimestampOverride(timestamp, {
      occurredAt,
      dayKey,
      observedAtRaw: startAt ?? timestamp.observedAtRaw ?? occurredAt,
    });
    const externalRef = makeJunctionExternalRef(
      resourceContext,
      linkedEntry,
      workoutTimestamp,
      `${resourceSlug}-${factIdentityHash}`,
    );
    const qualifiers = stripUndefined({ sport });

    const evidencePart = withJunctionCompactTimeseriesMetadata(
      resource,
      createEvidencePart(
        role,
        `${role}.json`,
        stripUndefined({
          schema: "junction.workout_timeseries_fact.v1",
          provider: "junction",
          resource,
          sourceProviderSlug: resourceContext.sourceProviderSlug,
          sourceType: resourceContext.origin.sourceType,
          sourceInstanceId: resourceContext.origin.sourceInstanceId,
          workoutId,
          sport,
          startAt,
          endAt,
          value: measurementValue.value,
          unit: measurementValue.unit,
        }),
      ),
      "timeseries_reading",
    );
    if (evidencePart) {
      selectedEvidenceParts.push(evidencePart);
    }

    selectedEvents.push(stripUndefined({
      kind: "measurement",
      occurredAt,
      recordedAt: timestamp.recordedAt,
      dayKey,
      source: "device",
      title: measurementValue.title,
      evidenceRoles: [role],
      externalRef,
      dataOrigin: buildDataOrigin(entry, resourceContext, workoutTimestamp, {
        normalizerVersion: "junction-workout-timeseries.v1",
      }),
      fields: {
        measurements: [{
          metric: measurementValue.metric,
          value: measurementValue.value,
          unit: measurementValue.unit,
          ...(Object.keys(qualifiers).length > 0 ? { qualifiers } : {}),
        }],
      },
    }));
  }

  for (const evidencePart of selectedEvidenceParts.reverse()) {
    pushEvidencePart(context.evidenceParts, evidencePart);
  }
  context.events.push(...selectedEvents.reverse());

  if (entries.length > 0 && selectedEvents.length === 0) {
    const role = `${baseArtifactRole}:no-valid-samples`;
    pushEvidencePart(
      context.evidenceParts,
      withJunctionCompactTimeseriesMetadata(
        resource,
        createEvidencePart(role, `${role}.json`, {
          schema: "junction.workout_timeseries_fact.v1",
          provider: "junction",
          resource,
          sampleCount: entries.length,
          status: "no_valid_samples",
        }),
        "timeseries_reading",
      ),
    );
  }
}

function normalizeJunctionSparseWorkoutDurationValue(
  entry: PlainObject,
  startAt: string | undefined,
  endAt: string | undefined,
): { metric: string; title: string; unit: string; value: number } | null {
  const rawValue = firstNumberFromPaths(entry, ["value"]);
  const rawUnit = firstStringFromPaths(entry, ["unit"]);

  const intervalMinutes = startAt && endAt ? minutesBetween(startAt, endAt) : undefined;
  const minutes = normalizeWorkoutDurationMinutes(rawValue, rawUnit) ?? intervalMinutes;
  return minutes !== undefined && minutes > 0 && minutes <= 7 * 24 * 60
    ? { metric: "workout-duration", title: "Junction workout duration", unit: "minutes", value: roundJunctionDailyAggregateValue(minutes) }
    : null;
}

function normalizeWorkoutDurationMinutes(value: number | undefined, unit: string | undefined): number | undefined {
  if (value === undefined || value < 0) {
    return undefined;
  }
  const normalizedUnit = unit?.trim().toLowerCase();
  if (!normalizedUnit || ["min", "mins", "minute", "minutes"].includes(normalizedUnit)) {
    return value;
  }
  if (["s", "sec", "secs", "second", "seconds"].includes(normalizedUnit)) {
    return value / 60;
  }
  if (["ms", "millisecond", "milliseconds"].includes(normalizedUnit)) {
    return value / 60_000;
  }
  if (["h", "hr", "hrs", "hour", "hours"].includes(normalizedUnit)) {
    return value * 60;
  }
  return undefined;
}

function normalizeJunctionWorkoutFeatures(
  features: readonly JunctionWorkoutFeatureEnvelope[] | undefined,
  context: NormalizationContext,
): void {
  for (const rawFeature of features ?? []) {
    const feature = parseJunctionWorkoutFeatureEnvelope(rawFeature);
    const entry = stripUndefined({
      id: feature.workoutId,
      authoritativeVersion: feature.sourceUpdatedAt,
      startAt: feature.startedAt,
      endAt: feature.endedAt,
      sourceProviderSlug: feature.sourceProviderSlug,
      sourceInstanceId: feature.sourceInstanceId,
      sourceType: feature.sourceType,
      sport: feature.sport,
    });
    const resourceContext = buildResourceContext({
      entry,
      resource: "workouts",
      resourceSlug: "workouts",
      identityKind: "summary",
      index: 0,
      fallbackArtifactRole: "junction-workout-features",
      context,
    });
    if (!resourceContext) {
      continue;
    }

    const timestamp = withTimestampOverride(
      resolveRecordTimestamp(entry, context, resourceContext.sourceProviderSlug),
      {
        occurredAt: feature.startedAt,
        dayKey: extractIsoDatePrefix(feature.startedAt) ?? undefined,
        observedAtRaw: feature.startedAt,
      },
    );
    const featureHash = shortHash([
      feature.workoutId,
      feature.sourceProviderSlug,
      feature.sourceType,
      feature.sourceInstanceId,
    ]);
    const role = `junction-workout-features:${featureHash}`;
    const featureArtifact = createEvidencePart(role, `${role}.json`, feature);
    pushEvidencePart(context.evidenceParts, featureArtifact
      ? {
          ...featureArtifact,
          metadata: {
            artifactClass: "compact_provider_workout_features",
            provider: "junction",
            resource: "workout_stream",
            resourceCategory: "dedicated_stream_features",
            retentionClass: "provider_evidence",
          },
        }
      : null);

    const emittedEvents: DeviceEventPayload[] = [];
    if (feature.measurements.length > 0) {
      emittedEvents.push(stripUndefined({
        kind: "measurement",
        occurredAt: feature.startedAt,
        recordedAt: feature.endedAt,
        dayKey: timestamp.dayKey,
        source: "device",
        title: "Junction workout stream features",
        evidenceRoles: [role],
        externalRef: makeJunctionExternalRef(resourceContext, entry, timestamp, "stream-features"),
        dataOrigin: buildDataOrigin(entry, resourceContext, timestamp, {
          normalizerVersion: "junction-workout-features.v1",
        }),
        fields: {
          measurements: feature.measurements.map((measurement) =>
            withWorkoutFeatureQualifiers(measurement, {
              "point-count": feature.pointCount,
              sport: feature.sport,
            })
          ),
        },
      }));
    }

    for (const split of feature.splits) {
      const splitTimestamp = withTimestampOverride(timestamp, {
        occurredAt: split.endedAt,
        dayKey: extractIsoDatePrefix(split.endedAt) ?? timestamp.dayKey,
        observedAtRaw: split.endedAt,
      });
      const qualifiers = stripUndefined({
        "split-distance-meters": feature.splitDistanceMeters ?? split.distanceMeters,
        "split-index": split.index,
        sport: feature.sport,
      });
      emittedEvents.push(stripUndefined({
        kind: "measurement",
        occurredAt: split.endedAt,
        recordedAt: feature.endedAt,
        dayKey: splitTimestamp.dayKey,
        source: "device",
        title: `Junction workout split ${split.index}`,
        evidenceRoles: [role],
        externalRef: makeJunctionExternalRef(
          resourceContext,
          entry,
          timestamp,
          `stream-split-${split.index}`,
        ),
        dataOrigin: buildDataOrigin(entry, resourceContext, splitTimestamp, {
          normalizerVersion: "junction-workout-features.v1",
        }),
        fields: {
          measurements: [
            { metric: "workout-split-distance", value: split.distanceMeters, unit: "meter", qualifiers },
            { metric: "workout-split-duration", value: split.durationSeconds, unit: "seconds", qualifiers },
            ...split.measurements.map((measurement) => withWorkoutFeatureQualifiers(measurement, qualifiers)),
          ],
        },
      }));
    }

    context.events.push(...emittedEvents);
    if (feature.sourceUpdatedAt) {
      const identity = makeJunctionExternalRef(
        resourceContext,
        entry,
        timestamp,
        "stream-features",
      );
      context.authoritativeEventSets.push({
        system: identity.system,
        resourceType: identity.resourceType,
        resourceId: identity.resourceId,
        version: feature.sourceUpdatedAt,
        facetPrefixes: ["stream-features", "stream-split"],
        currentFacets: [...new Set(emittedEvents.flatMap((event) => {
          const externalRef = event.externalRef;
          if (
            !externalRef
            || externalRef.version !== feature.sourceUpdatedAt
            || !externalRef.facet
          ) {
            return [];
          }
          return [externalRef.facet];
        }))].sort(),
      });
    }
  }
}

function withWorkoutFeatureQualifiers(
  measurement: JunctionWorkoutFeatureMeasurement,
  qualifiers: Record<string, boolean | number | string | undefined>,
): JunctionWorkoutFeatureMeasurement & { qualifiers?: Record<string, boolean | number | string> } {
  const compactQualifiers = stripUndefined(qualifiers);
  return {
    ...measurement,
    ...(Object.keys(compactQualifiers).length > 0 ? { qualifiers: compactQualifiers } : {}),
  };
}

function pushJunctionNoteTags(
  payload: unknown,
  resource: string,
  resourceSlug: string,
  context: NormalizationContext,
): void {
  const baseArtifactRole = `junction-timeseries-reading-${resourceSlug}`;
  const seenNoteHashes = new Set<string>();

  for (const [index, { entry, originFallback }] of timeseriesResourceEntries(payload).entries()) {
    const resourceContext = buildResourceContext({
      entry,
      originFallback,
      resource,
      resourceSlug,
      identityKind: "timeseries",
      index,
      fallbackArtifactRole: baseArtifactRole,
      context,
    });
    if (!resourceContext) continue;

    const tags = normalizeJunctionNoteTags(entry.tags);
    const start = firstStringFromPaths(entry, ["start", "startAt", "start_at"]);
    const baseTimestamp = resolveRecordTimestamp(
      start ? { ...entry, observedAtRaw: start } : entry,
      context,
      resourceContext.sourceProviderSlug,
    );
    const timestamp = withTimestampOverride(baseTimestamp, {
      dayKey: baseTimestamp.dayKey ?? extractIsoDatePrefix(start) ?? undefined,
    });
    if (!timestamp.occurredAt || !timestamp.dayKey || tags.length === 0) continue;

    const stableId = firstStringFromPaths(entry, JUNCTION_GENERIC_SUMMARY_ID_PATHS);
    const noteHash = stableId
      ? shortHash([resourceContext.externalRefResourceType, stableId])
      : shortHash([
          resourceContext.externalRefResourceType,
          timestamp.observedAtRaw ?? timestamp.occurredAt,
          ...tags,
        ]);
    if (seenNoteHashes.has(noteHash)) continue;
    seenNoteHashes.add(noteHash);

    const role = `${baseArtifactRole}:${timestamp.dayKey}:${noteHash}`;
    pushEvidencePart(
      context.evidenceParts,
      withJunctionCompactTimeseriesMetadata(
        resource,
        createEvidencePart(
          role,
          `${role}.json`,
          stripUndefined({
            schema: "junction.note_tags.v1",
            provider: "junction",
            resource,
            dayKey: timestamp.dayKey,
            sourceProviderSlug: resourceContext.sourceProviderSlug,
            sourceType: resourceContext.origin.sourceType,
            sourceInstanceId: resourceContext.origin.sourceInstanceId,
            occurredAt: timestamp.occurredAt,
            recordedAt: timestamp.recordedAt,
            tags,
          }),
        ),
        "timeseries_reading",
      ),
    );

    for (const tag of tags) {
      context.events.push(stripUndefined({
        kind: "intervention_session",
        occurredAt: timestamp.occurredAt,
        recordedAt: timestamp.recordedAt,
        dayKey: timestamp.dayKey,
        source: "device",
        title: `Wearable tag: ${tag.replaceAll("-", " ")}`,
        tags: [tag],
        evidenceRoles: [role],
        externalRef: makeProviderExternalRef(
          "junction",
          resourceContext.externalRefResourceType,
          noteHash,
          undefined,
          `tag-${tag}`,
        ),
        dataOrigin: buildDataOrigin(entry, resourceContext, timestamp),
        fields: {
          interventionType: tag,
          sessionStatus: "completed",
        },
      }));
    }
  }
}

function normalizeJunctionNoteTags(value: unknown): string[] {
  return [...new Set(
    asArray(value).flatMap((entry) => {
      const label = stringId(entry);
      if (!label) return [];
      const tag = slugify(label, "").slice(0, 80).replace(/-+$/u, "");
      return tag ? [tag] : [];
    }),
  )].sort();
}

function pushJunctionDailyTimeseriesObservations(
  payload: unknown,
  resource: string,
  resourceSlug: string,
  context: NormalizationContext,
  descriptor: JunctionDailyTimeseriesDescriptor,
): void {
  for (const aggregate of buildJunctionDailyTimeseriesAggregates({
    payload,
    resource,
    resourceSlug,
    context,
    valuePaths: descriptor.valuePaths,
    normalizeValue: descriptor.normalizeValue,
  })) {
    for (const observation of descriptor.observations) {
      pushJunctionDailyTimeseriesObservation(context, aggregate, {
        metric: observation.metric,
        title: observation.title,
        unit: descriptor.unit,
        value: junctionDailyTimeseriesStatisticValue(aggregate, observation.statistic),
      });
    }
  }
}

function junctionDailyTimeseriesStatisticValue(
  aggregate: JunctionDailyTimeseriesAggregate,
  statistic: JunctionDailyTimeseriesObservationDescriptor["statistic"],
): number {
  switch (statistic) {
    case "min":
      return aggregate.minValue;
    case "max":
      return aggregate.maxValue;
    case "sum":
      return aggregate.sum;
    case "mean":
      return aggregate.sum / aggregate.sampleCount;
  }
}

function buildJunctionDailyTimeseriesAggregates(input: {
  context: NormalizationContext;
  normalizeValue: (value: unknown) => number | undefined;
  payload: unknown;
  resource: string;
  resourceSlug: string;
  valuePaths: readonly string[];
}): JunctionDailyTimeseriesAggregate[] {
  const evidencePartRole = `junction-timeseries-daily-${input.resourceSlug}`;
  const aggregates = new Map<string, JunctionDailyTimeseriesAggregate>();

  for (const [index, { entry, originFallback }] of timeseriesResourceEntries(input.payload).entries()) {
    const resourceContext = buildResourceContext({
      entry,
      originFallback,
      resource: input.resource,
      resourceSlug: input.resourceSlug,
      identityKind: "timeseries",
      index,
      fallbackArtifactRole: evidencePartRole,
      context: input.context,
    });

    if (!resourceContext) {
      continue;
    }

    const value = input.normalizeValue(firstNumberFromPaths(entry, input.valuePaths));
    const timestamp = resolveRecordTimestamp(entry, input.context, resourceContext.sourceProviderSlug);
    const sampleAt = resolveJunctionDailyAggregateSampleAt(timestamp);
    const dayKey = resolveJunctionTimeseriesAggregateDayKey(entry, timestamp, sampleAt, input.context.defaultTimeZone);
    const legacyDayKey = resolveLegacyJunctionTimeseriesAggregateDayKey(entry, timestamp, sampleAt);

    if (value === undefined || !sampleAt || !dayKey) {
      continue;
    }

    const key = [
      resourceContext.externalRefResourceType,
      resourceContext.origin.sourceType ?? "",
      resourceContext.origin.sourceInstanceId ?? "",
      dayKey,
    ].join("\u0000");
    const existing = aggregates.get(key);
    const recordedAt = timestamp.recordedAt ?? sampleAt;
    const timeZone = firstStringFromPaths(entry, ["timeZone", "timezone", "time_zone"]);
    const legacyDayKeys = new Set<string>();
    if (legacyDayKey && legacyDayKey !== dayKey) {
      legacyDayKeys.add(legacyDayKey);
    }

    if (!existing) {
      aggregates.set(key, {
        dayKey,
        entry,
        firstSampleAt: sampleAt,
        lastRecordedAt: recordedAt,
        lastSampleAt: sampleAt,
        legacyDayKeys,
        maxValue: value,
        minValue: value,
        evidencePartRole,
        resourceContext,
        sampleCount: 1,
        sum: value,
        timestamp,
        timeZone,
      });
      continue;
    }

    existing.sampleCount += 1;
    existing.sum += value;
    if (legacyDayKey && legacyDayKey !== dayKey) {
      existing.legacyDayKeys.add(legacyDayKey);
    }
    if (sampleAt < existing.firstSampleAt) {
      existing.firstSampleAt = sampleAt;
    }

    if (sampleAt >= existing.lastSampleAt) {
      existing.lastSampleAt = sampleAt;
      existing.lastRecordedAt = recordedAt;
      existing.timestamp = timestamp;
    }

    if (value < existing.minValue) {
      existing.minValue = value;
    }

    if (value > existing.maxValue) {
      existing.maxValue = value;
    }
  }

  const sortedAggregates = [...aggregates.values()].sort(compareJunctionDailyTimeseriesAggregates);
  if (sortedAggregates.length === 0) {
    pushJunctionEmptyDailyTimeseriesAggregateArtifact(input.context, input.resource, input.resourceSlug);
    return sortedAggregates;
  }

  pushJunctionDailyTimeseriesAggregateArtifacts(input.context, input.resource, sortedAggregates);
  return sortedAggregates;
}

function pushJunctionEmptyDailyTimeseriesAggregateArtifact(
  context: NormalizationContext,
  resource: string,
  resourceSlug: string,
): void {
  const role = `junction-timeseries-daily-${resourceSlug}:no-valid-samples`;
  pushEvidencePart(
    context.evidenceParts,
    withJunctionCompactTimeseriesMetadata(
      resource,
      createEvidencePart(
        role,
        `${role}.json`,
        {
          schema: "junction.timeseries_daily_aggregate.v1",
          provider: "junction",
          resource,
          sampleCount: 0,
          status: "no_valid_samples",
        },
      ),
    ),
  );
}

function pushJunctionDailyTimeseriesAggregateArtifacts(
  context: NormalizationContext,
  resource: string,
  aggregates: readonly JunctionDailyTimeseriesAggregate[],
): void {
  for (const aggregate of aggregates) {
    // The role derives only from the aggregate's stable grouping identity
    // (resource role + day + source); a sorted-position index here would
    // churn artifact roles across replays and differently-windowed payloads.
    const role = `${aggregate.evidencePartRole}:${aggregate.dayKey}:${shortHash([
      aggregate.resourceContext.sourceProviderSlug,
      aggregate.resourceContext.origin.sourceType ?? "",
      aggregate.resourceContext.origin.sourceInstanceId ?? "",
    ])}`;

    aggregate.evidencePartRole = role;

    pushEvidencePart(
      context.evidenceParts,
      withJunctionCompactTimeseriesMetadata(
        resource,
        createEvidencePart(
          role,
          `${role}.json`,
          stripUndefined({
            schema: "junction.timeseries_daily_aggregate.v1",
            provider: "junction",
            resource,
            dayKey: aggregate.dayKey,
            sourceProviderSlug: aggregate.resourceContext.sourceProviderSlug,
            sourceType: aggregate.resourceContext.origin.sourceType,
            sourceInstanceId: aggregate.resourceContext.origin.sourceInstanceId,
            sampleCount: aggregate.sampleCount,
            firstSampleAt: aggregate.firstSampleAt,
            lastSampleAt: aggregate.lastSampleAt,
            lastRecordedAt: aggregate.lastRecordedAt,
            legacyDayKeys: aggregate.legacyDayKeys.size > 0
              ? [...aggregate.legacyDayKeys].sort()
              : undefined,
            meanValue: roundJunctionTimeseriesAggregateValue(resource, aggregate.sum / aggregate.sampleCount),
            minValue: roundJunctionTimeseriesAggregateValue(resource, aggregate.minValue),
            maxValue: roundJunctionTimeseriesAggregateValue(resource, aggregate.maxValue),
            unit: junctionDailyTimeseriesAggregateUnit(resource),
          }),
        ),
      ),
    );
  }
}

function roundJunctionTimeseriesAggregateValue(resource: string, value: number): number {
  return JUNCTION_DAILY_TIMESERIES_DESCRIPTORS.has(resource)
    ? roundJunctionDailyAggregateValue(value)
    : value;
}

function junctionDailyTimeseriesAggregateUnit(resource: string): string | undefined {
  return JUNCTION_DAILY_TIMESERIES_DESCRIPTORS.get(resource)?.unit;
}

function withJunctionCompactTimeseriesMetadata(
  resource: string,
  artifact: DeviceEvidencePartPayload | null,
  resourceCategory: "timeseries_daily_aggregate" | "timeseries_reading" = "timeseries_daily_aggregate",
): DeviceEvidencePartPayload | null {
  if (!artifact) {
    return null;
  }

  return {
    ...artifact,
    metadata: {
      artifactClass: resourceCategory === "timeseries_reading"
        ? "compact_provider_timeseries_reading"
        : "compact_provider_timeseries_aggregate",
      provider: "junction",
      resource,
      resourceCategory,
      retentionClass: "provider_evidence",
    },
  };
}

function pushJunctionDailyTimeseriesObservation(
  context: NormalizationContext,
  aggregate: JunctionDailyTimeseriesAggregate,
  observation: {
    metric: string;
    title: string;
    unit: string;
    value: number;
  },
): void {
  const metric = resolveJunctionHrvMetric(
    observation.metric,
    aggregate.resourceContext.sourceProviderSlug,
  );
  const timestamp = withTimestampOverride(aggregate.timestamp, {
    occurredAt: aggregate.lastSampleAt,
    recordedAt: aggregate.lastRecordedAt,
    dayKey: aggregate.dayKey,
    observedAtRaw: `${aggregate.dayKey}:${aggregate.resourceContext.resource}:daily`,
  });
  const legacyExternalRefs = legacyJunctionDailyTimeseriesAggregateExternalRefs(
    aggregate,
    observation.metric,
  );

  context.events.push(stripUndefined({
    kind: "observation",
    occurredAt: aggregate.lastSampleAt,
    recordedAt: aggregate.lastRecordedAt,
    dayKey: aggregate.dayKey,
    timeZone: aggregate.timeZone,
    source: "device",
    title: resolveJunctionHrvTitle(metric, observation.title),
    evidenceRoles: [aggregate.evidencePartRole],
    externalRef: makeJunctionExternalRef(
      aggregate.resourceContext,
      aggregate.entry,
      timestamp,
      observation.metric,
    ),
    legacyExternalRefs: legacyExternalRefs.length > 0 ? legacyExternalRefs : undefined,
    dataOrigin: buildDataOrigin(aggregate.entry, aggregate.resourceContext, timestamp),
    fields: {
      metric,
      observationGrain: "summary",
      value: roundJunctionDailyAggregateValue(observation.value),
      unit: observation.unit,
    },
  }));
}

function legacyJunctionDailyTimeseriesAggregateExternalRefs(
  aggregate: JunctionDailyTimeseriesAggregate,
  metric: string,
): DeviceExternalRefPayload[] {
  if (aggregate.legacyDayKeys.size === 0) {
    return [];
  }

  return [...aggregate.legacyDayKeys].sort().map((legacyDayKey) =>
    makeJunctionExternalRef(
      aggregate.resourceContext,
      aggregate.entry,
      withTimestampOverride(aggregate.timestamp, {
        occurredAt: aggregate.lastSampleAt,
        recordedAt: aggregate.lastRecordedAt,
        dayKey: legacyDayKey,
        observedAtRaw: `${legacyDayKey}:${aggregate.resourceContext.resource}:daily`,
      }),
      metric,
    )
  );
}

// Sparse paired blood-pressure readings land as-is: one canonical
// `measurement` event (systolic + diastolic mmHg entries, so both flow into
// the existing blood-pressure catalog metrics) plus one compact per-reading
// evidence part (~350 B; readings arrive 10s-100s per member-year).
function pushJunctionBloodPressureReadings(
  payload: unknown,
  resource: string,
  resourceSlug: string,
  context: NormalizationContext,
): void {
  const baseArtifactRole = `junction-timeseries-reading-${resourceSlug}`;
  let readingCount = 0;
  const seenReadingIdentityHashes = new Set<string>();

  for (const [index, { entry, originFallback }] of timeseriesResourceEntries(payload).entries()) {
    const resourceContext = buildResourceContext({
      entry,
      originFallback,
      resource,
      resourceSlug,
      identityKind: "timeseries",
      index,
      fallbackArtifactRole: baseArtifactRole,
      context,
    });

    if (!resourceContext) {
      continue;
    }

    const systolic = normalizeSystolicMmHg(firstNumberFromPaths(entry, JUNCTION_BLOOD_PRESSURE_SYSTOLIC_PATHS));
    const diastolic = normalizeDiastolicMmHg(firstNumberFromPaths(entry, JUNCTION_BLOOD_PRESSURE_DIASTOLIC_PATHS));
    const timestamp = resolveRecordTimestamp(entry, context, resourceContext.sourceProviderSlug);
    const occurredAt = timestamp.occurredAt ?? timestamp.recordedAt;
    const dayKey = resolveJunctionTimeseriesAggregateDayKey(entry, timestamp, occurredAt, context.defaultTimeZone);

    if (systolic === undefined || diastolic === undefined || systolic <= diastolic || !occurredAt || !dayKey) {
      continue;
    }

    // A stable provider row id is the primary reading identity (mirroring
    // the fetch-side dedupe key): two distinct readings with the same
    // timestamp AND the same values must not collapse when the provider
    // distinguishes them. Without an id, the identity includes the paired
    // values so same-second readings from coarse-timestamp providers never
    // collapse, while true duplicate deliveries still merge via externalRef.
    const readingIdentityHash = buildJunctionBloodPressureReadingIdentityHash({
      diastolic,
      entry,
      occurredAt,
      resourceContext,
      resourceSlug,
      systolic,
      timestamp,
    });
    // Exact in-payload duplicates are skipped and the raw role is derived
    // from the same stable identity as the event externalRef (never the
    // payload index), so replays and reorderings stage identical evidence
    // instead of minting new artifacts for an event core already dedupes.
    if (seenReadingIdentityHashes.has(readingIdentityHash)) {
      continue;
    }
    seenReadingIdentityHashes.add(readingIdentityHash);
    readingCount += 1;
    const role = `${baseArtifactRole}:${dayKey}:${readingIdentityHash}`;

    pushEvidencePart(
      context.evidenceParts,
      withJunctionCompactTimeseriesMetadata(
        resource,
        createEvidencePart(
          role,
          `${role}.json`,
          stripUndefined({
            schema: "junction.blood_pressure_reading.v1",
            provider: "junction",
            resource,
            dayKey,
            sourceProviderSlug: resourceContext.sourceProviderSlug,
            sourceType: resourceContext.origin.sourceType,
            sourceInstanceId: resourceContext.origin.sourceInstanceId,
            occurredAt,
            recordedAt: timestamp.recordedAt,
            systolic,
            diastolic,
            unit: "mmHg",
          }),
        ),
        "timeseries_reading",
      ),
    );

    context.events.push(stripUndefined({
      kind: "measurement",
      occurredAt,
      recordedAt: timestamp.recordedAt,
      dayKey,
      timeZone: firstStringFromPaths(entry, ["timeZone", "timezone", "time_zone"]),
      source: "device",
      title: "Junction blood pressure",
      evidenceRoles: [role],
      externalRef: makeProviderExternalRef(
        "junction",
        resourceContext.externalRefResourceType,
        `${resourceSlug}-${readingIdentityHash}`,
        undefined,
        "blood-pressure",
      ),
      dataOrigin: buildDataOrigin(entry, resourceContext, timestamp),
      fields: {
        measurements: [
          { metric: "systolic-blood-pressure", value: systolic, unit: "mmHg" },
          { metric: "diastolic-blood-pressure", value: diastolic, unit: "mmHg" },
        ],
      },
    }));
  }

  if (readingCount === 0) {
    const role = `${baseArtifactRole}:no-valid-samples`;
    pushEvidencePart(
      context.evidenceParts,
      withJunctionCompactTimeseriesMetadata(
        resource,
        createEvidencePart(
          role,
          `${role}.json`,
          {
            schema: "junction.blood_pressure_reading.v1",
            provider: "junction",
            resource,
            readingCount: 0,
            status: "no_valid_samples",
          },
        ),
        "timeseries_reading",
      ),
    );
  }
}

function buildJunctionBloodPressureRepairStableExternalRefResourceId(
  entry: PlainObject,
  resourceContext: ResourceContext,
): string | null {
  const readingRowId = firstStringFromPaths(
    entry,
    ["id", "resourceId", "resource_id", "externalId", "external_id"],
  );
  if (!readingRowId) {
    return null;
  }

  return `${resourceContext.resourceSlug}-${shortHash([
    resourceContext.resourceSlug,
    resourceContext.sourceProviderSlug,
    resourceContext.origin.sourceType ?? "",
    resourceContext.origin.sourceInstanceId ?? "",
    readingRowId,
  ])}`;
}

function buildJunctionBloodPressureReadingIdentityHash(input: {
  diastolic: number;
  entry: PlainObject;
  occurredAt: string;
  resourceContext: ResourceContext;
  resourceSlug: string;
  systolic: number;
  timestamp: ReturnType<typeof resolveRecordTimestamp>;
}): string {
  const repairStableResourceId =
    buildJunctionBloodPressureRepairStableExternalRefResourceId(
      input.entry,
      input.resourceContext,
    );
  if (repairStableResourceId) {
    return repairStableResourceId.slice(`${input.resourceSlug}-`.length);
  }

  return shortHash([
    input.resourceSlug,
    input.resourceContext.sourceProviderSlug,
    input.resourceContext.origin.sourceType ?? "",
    input.resourceContext.origin.sourceInstanceId ?? "",
    input.timestamp.observedAtRaw ?? input.occurredAt,
    input.systolic,
    input.diastolic,
  ]);
}

function buildRawResourcePayload(
  resource: string,
  payload: unknown,
  connectionsByKey?: ReadonlyMap<string, PlainObject>,
): unknown {
  if (resource === "menstrual_cycle") {
    return prepareJunctionMenstrualCycleSummary(payload, connectionsByKey).evidence;
  }

  if (resource === JUNCTION_NOTE_RESOURCE) {
    return sanitizeJunctionNoteRawValue(sanitizeJunctionRawPayload(payload));
  }

  if (resource !== "profile") {
    return sanitizeJunctionRawPayload(payload);
  }

  if (Array.isArray(payload)) {
    return payload.flatMap((entry) => {
      const profile = asPlainObject(entry);
      const sanitized = sanitizeProfilePayload(
        entry,
        profile && connectionsByKey ? resolveEntryConnection(profile, connectionsByKey) : undefined,
      );
      return sanitized ? [sanitized] : [];
    });
  }

  const profile = asPlainObject(payload);
  return sanitizeProfilePayload(
    payload,
    profile && connectionsByKey ? resolveEntryConnection(profile, connectionsByKey) : undefined,
  );
}

function buildJunctionWorkoutSummaryEvidence(
  events: readonly DeviceEventPayload[],
): Record<string, unknown> {
  return {
    schema: "junction.workout-summary-evidence.v1",
    workouts: events.flatMap((event) => event.kind === "activity_session"
      ? [stripUndefined({
          occurredAt: event.occurredAt,
          recordedAt: event.recordedAt,
          dayKey: event.dayKey,
          timeZone: event.timeZone,
          title: event.title,
          externalRef: event.externalRef,
          legacyExternalRefs: event.legacyExternalRefs,
          dataOrigin: event.dataOrigin,
          fields: event.fields,
        })]
      : []),
  };
}

function sanitizeJunctionNoteRawValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeJunctionNoteRawValue);
  }
  if (!isPlainRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => normalizeJunctionRawIdentityKey(key) !== "value")
      .map(([key, entry]) => [key, sanitizeJunctionNoteRawValue(entry)]),
  );
}

function sanitizeJunctionRawSnapshot(snapshot: JunctionSnapshotInput): unknown {
  const sanitized = asPlainObject(sanitizeJunctionRawPayload(snapshot));
  if (!sanitized) {
    return sanitized;
  }
  const connections = asArray(snapshot.connections).flatMap((connection) => {
    const normalized = asPlainObject(connection);
    return normalized ? [normalized] : [];
  });
  const connectionsByKey = buildConnectionsByKey(connections);
  const summaries = sanitizeJunctionRawResourceMap(
    snapshot.summaries,
    SUMMARY_RESOURCE_ALLOWLIST,
    connectionsByKey,
  );
  const timeseries = sanitizeJunctionRawResourceMap(
    snapshot.timeseries,
    COMPACT_TIMESERIES_RESOURCE_ALLOWLIST,
    connectionsByKey,
  );
  const workoutFeatures = snapshot.workoutFeatures?.map(parseJunctionWorkoutFeatureEnvelope);

  if (!summaries && !timeseries && !workoutFeatures?.length) {
    return {};
  }

  return stripUndefined({
    ...sanitized,
    connections: sanitizeJunctionRawConnections(snapshot.connections),
    summaries,
    timeseries,
    workoutFeatures,
  });
}

function sanitizeJunctionRawPayload(payload: unknown): unknown {
  return sanitizeJunctionRawValue(payload, false);
}

function sanitizeJunctionRawConnections(connections: unknown[] | undefined): unknown[] | undefined {
  if (!connections) {
    return undefined;
  }

  return connections.flatMap((connection) => {
    const sanitized = sanitizeProfilePayload(connection);
    return sanitized ? [sanitized] : [];
  });
}

function sanitizeJunctionRawResourceMap(
  resources: Record<string, unknown> | undefined,
  allowlist: ReadonlySet<string>,
  connectionsByKey?: ReadonlyMap<string, PlainObject>,
): Record<string, unknown> | undefined {
  if (!resources) {
    return undefined;
  }

  const entries = allowedResourceEntries(resources, allowlist)
    .map(([resource, payload]) => [resource, buildRawResourcePayload(resource, payload, connectionsByKey)] as const)
    .filter(([, payload]) => payload !== undefined);

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function sanitizeJunctionRawValue(value: unknown, inSourceObject: boolean): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeJunctionRawValue(entry, inSourceObject));
  }

  if (!isPlainRecord(value)) {
    return value;
  }

  const sanitized: PlainObject = {};
  for (const [key, entry] of Object.entries(value)) {
    if (shouldDropJunctionRawSourceKey(key, inSourceObject)) {
      continue;
    }

    sanitized[key] = sanitizeJunctionRawValue(entry, inSourceObject || key === "source" || key === "provider");
  }

  return stripUndefined(sanitized);
}

function shouldDropJunctionRawSourceKey(key: string, inSourceObject: boolean): boolean {
  const normalized = normalizeJunctionRawIdentityKey(key);
  return isJunctionRawDirectIdentityKey(key)
    || isJunctionRawDirectIdentityContainerKey(key)
    || RAW_SOURCE_IDENTIFIER_KEYS.has(normalized)
    || RAW_SOURCE_LINKAGE_KEY_PARTS.some((part) => normalized === part)
    || (inSourceObject && RAW_SOURCE_CONTAINER_LINKAGE_KEY_PARTS.some((part) => normalized === part))
    || (inSourceObject && RAW_SOURCE_NAME_KEYS.has(normalized));
}

function isPlainRecord(value: unknown): value is PlainObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitizeProfilePayload(payload: unknown, connection?: PlainObject): PlainObject | undefined {
  const profile = asPlainObject(payload);
  if (!profile) {
    return undefined;
  }

  const origin = resolveJunctionOrigin(profile, connection);
  const reportedGender = trimOptionalToLength(
    firstStringFromPaths(profile, JUNCTION_PROFILE_GENDER_PATHS)?.trim().toLowerCase(),
    80,
  );
  const sanitized = stripUndefined({
    sourceProviderSlug: readJunctionSourceProviderSlug(profile, connection) ?? origin.sourceProviderSlug,
    sourceType: origin.sourceType,
    reportedGender,
  });

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function pushSleepSummary(
  entry: PlainObject,
  resourceContext: ResourceContext,
  context: NormalizationContext,
): void {
  const timestamp = resolveRecordTimestamp(entry, context, resourceContext.sourceProviderSlug);
  const startAt = resolveSafeTimestamp(
    firstValueFromPaths(entry, JUNCTION_SLEEP_START_TIMESTAMP_PATHS),
    resourceContext.sourceProviderSlug,
  );
  const endAt = resolveSafeTimestamp(
    firstValueFromPaths(entry, JUNCTION_SLEEP_END_TIMESTAMP_PATHS),
    resourceContext.sourceProviderSlug,
  );
  const durationMinutes = resolveSleepSummaryDurationMinutes(entry, startAt, endAt);
  const sleepType = resolveJunctionSleepType(firstStringFromPaths(entry, ["type"]));
  const sleepTimestamp = withTimestampOverride(timestamp, {
    occurredAt: endAt ?? startAt ?? timestamp.occurredAt,
  });
  const zeroedSummary = isZeroedAppleHealthKitSleepSummary(entry, resourceContext, durationMinutes);

  if (startAt && endAt && durationMinutes !== undefined) {
    const occurredAt = sleepTimestamp.occurredAt ?? startAt;
    context.events.push(stripUndefined({
      kind: "sleep_session",
      occurredAt,
      recordedAt: sleepTimestamp.recordedAt,
      dayKey: sleepTimestamp.dayKey,
      timeZone: firstStringFromPaths(entry, ["timeZone", "timezone", "time_zone"]),
      source: "device",
      title: "Junction sleep",
      evidenceRoles: resourceContext.evidenceRoles,
      externalRef: makeJunctionExternalRef(resourceContext, entry, sleepTimestamp, "session"),
      dataOrigin: buildDataOrigin(entry, resourceContext, sleepTimestamp),
      fields: stripUndefined({
        startAt,
        endAt,
        durationMinutes,
        sleepType,
      }),
    }));
  }

  pushObservationMetrics(
    entry,
    resourceContext,
    context,
    zeroedSummary
      ? SLEEP_NON_STAGE_METRICS.filter((metric) => !SLEEP_ZEROED_SUMMARY_SUPPRESSED_METRIC_NAMES.has(metric.metric))
      : SLEEP_NON_STAGE_METRICS,
    sleepTimestamp,
  );
  pushSleepSummaryStageMetrics(entry, resourceContext, context, sleepTimestamp, startAt, endAt, zeroedSummary);
  pushJunctionRecoveryReadinessScore(entry, resourceContext, context, sleepTimestamp);
}

function resolveJunctionSleepType(value: string | undefined): "main_sleep" | "nap" | undefined {
  const normalized = value?.trim().toLowerCase().replace(/[\s-]+/gu, "_");
  if (!normalized) {
    return undefined;
  }

  if (normalized.includes("nap")) {
    return "nap";
  }

  return normalized === "sleep" || normalized === "long_sleep" ? "main_sleep" : undefined;
}

function resolveSleepSummaryDurationMinutes(
  entry: PlainObject,
  startAt: string | undefined,
  endAt: string | undefined,
): number | undefined {
  return normalizePositiveIntegerMinutes(
    firstNumberFromPaths(entry, JUNCTION_SLEEP_DURATION_MINUTE_PATHS),
  ) ??
    normalizePositiveIntegerMinutes(
      secondsToMinutes(firstNumberFromPaths(entry, JUNCTION_SLEEP_DURATION_SECOND_PATHS)),
    ) ??
    normalizePositiveIntegerMinutes(
      millisecondsToMinutes(firstNumberFromPaths(entry, JUNCTION_SLEEP_DURATION_MILLISECOND_PATHS)),
    ) ??
    normalizePositiveIntegerMinutes(minutesBetween(startAt, endAt));
}

function isZeroedAppleHealthKitSleepSummary(
  entry: PlainObject,
  resourceContext: ResourceContext,
  durationMinutes: number | undefined,
): boolean {
  if (normalizeJunctionSourceProviderSlug(resourceContext.sourceProviderSlug) !== APPLE_HEALTH_KIT_SOURCE_PROVIDER_SLUG) {
    return false;
  }

  const totalMinutes = resolveSleepSummaryMetricValue(entry, "sleep-total-minutes");
  const awakeMinutes = resolveSleepSummaryMetricValue(entry, "sleep-awake-minutes");
  if (
    durationMinutes === undefined ||
    totalMinutes !== 0 ||
    awakeMinutes === undefined ||
    awakeMinutes <= 0 ||
    awakeMinutes >= durationMinutes - 1
  ) {
    return false;
  }

  return isSleepSummaryMetricMissingOrZero(entry, "sleep-efficiency") &&
    isSleepSummaryMetricMissingOrZero(entry, "sleep-light-minutes") &&
    isSleepSummaryMetricMissingOrZero(entry, "sleep-deep-minutes") &&
    isSleepSummaryMetricMissingOrZero(entry, "sleep-rem-minutes");
}

function isSleepSummaryMetricMissingOrZero(entry: PlainObject, metricName: string): boolean {
  const value = resolveSleepSummaryMetricValue(entry, metricName);
  return value === undefined || value === 0;
}

function resolveSleepSummaryMetricValue(entry: PlainObject, metricName: string): number | undefined {
  const metric = SLEEP_METRICS.find((candidate) => candidate.metric === metricName);
  const resolved = metric ? resolveMetricDescriptorValue(entry, metric) : null;
  return resolved?.value;
}

function pushSleepSummaryStageMetrics(
  entry: PlainObject,
  resourceContext: ResourceContext,
  context: NormalizationContext,
  timestamp: ReturnType<typeof resolveRecordTimestamp>,
  startAt: string | undefined,
  endAt: string | undefined,
  zeroedSummary = false,
): void {
  const occurredAt = timestamp.occurredAt;
  if (!occurredAt) {
    return;
  }

  const timeZone = resolveSleepStageCanonicalTimeZone(entry);
  const dayKey = startAt && endAt
    ? resolveSleepStageAnchorDayKey(endAt, timeZone, timestamp)
    : timestamp.dayKey ?? extractIsoDatePrefix(occurredAt) ?? undefined;
  for (const metric of SLEEP_STAGE_METRICS) {
    if (zeroedSummary && SLEEP_ASLEEP_STAGE_METRIC_NAMES.has(metric.metric)) {
      continue;
    }
    const resolved = resolveMetricDescriptorValue(entry, metric);
    if (!resolved) {
      continue;
    }
    const externalRef = startAt && endAt
      ? makeJunctionCanonicalSleepStageExternalRef(resourceContext, {
          coverageEndAt: endAt,
          coverageStartAt: startAt,
          dayKey,
          metric: metric.metric,
          timeZone,
        })
      : makeJunctionExternalRef(resourceContext, entry, timestamp, metric.metric);
    const legacyExternalRef = startAt && endAt
      ? makeJunctionExternalRef(resourceContext, entry, timestamp, metric.metric)
      : undefined;

    context.events.push(stripUndefined({
      kind: "observation",
      occurredAt,
      recordedAt: timestamp.recordedAt,
      dayKey,
      timeZone,
      source: "device",
      title: metric.title,
      evidenceRoles: resourceContext.evidenceRoles,
      externalRef,
      legacyExternalRefs: legacyExternalRef ? [legacyExternalRef] : undefined,
      dataOrigin: buildDataOrigin(entry, resourceContext, timestamp, {
        normalizerVersion: JUNCTION_SLEEP_STAGE_SUMMARY_NORMALIZER_VERSION,
      }),
      fields: {
        metric: metric.metric,
        observationGrain: "summary",
        value: resolved.value,
        unit: resolved.unit,
      },
    }));
  }
}

function resolveSleepStageCanonicalTimeZone(...entries: readonly PlainObject[]): string | undefined {
  const explicitTimeZone = entries
    .map((entry) => firstStringFromPaths(entry, ["timeZone", "timezone", "time_zone"]))
    .find((timeZone) => timeZone !== undefined);
  if (explicitTimeZone) {
    return explicitTimeZone;
  }

  const hasOffsetOnlyEvidence = entries.some((entry) => {
    const offsetSeconds = readJunctionTimeZoneOffsetSeconds(entry);
    return offsetSeconds !== null && offsetSeconds !== undefined;
  });
  if (hasOffsetOnlyEvidence) {
    return undefined;
  }

  return entries.some(hasUtcSleepStageWindow)
    ? "UTC"
    : undefined;
}

function hasUtcSleepStageWindow(entry: PlainObject): boolean {
  const rawStartAt = firstStringFromPaths(entry, JUNCTION_SLEEP_COVERAGE_START_TIMESTAMP_PATHS);
  const rawEndAt = firstStringFromPaths(entry, JUNCTION_SLEEP_COVERAGE_END_TIMESTAMP_PATHS);
  return inferTimestampSemantics(rawStartAt) === "utc" && inferTimestampSemantics(rawEndAt) === "utc";
}

function pushSleepCycleEntries(
  entries: readonly JunctionResolvedResourceEntry[],
  context: NormalizationContext,
  sleepSummaryStageMetricOwners: readonly JunctionSleepSummaryStageMetricOwner[],
): void {
  const aggregates = new Map<string, JunctionSleepStageAggregate>();
  const totalAggregates = new Map<string, JunctionSleepTotalAggregate>();

  for (const { entry, resourceContext } of entries) {
    collectJunctionSleepStageAggregates(entry, resourceContext, context, aggregates, totalAggregates);
  }

  for (const aggregate of totalAggregates.values()) {
    if (isSleepMetricOwnedBySleepSummary(aggregate, "sleep-total-minutes", sleepSummaryStageMetricOwners)) {
      continue;
    }

    context.events.push(stripUndefined({
      kind: "observation",
      occurredAt: aggregate.endAt,
      recordedAt: aggregate.recordedAt,
      dayKey: aggregate.timestamp.dayKey,
      timeZone: aggregate.timeZone,
      source: "device",
      title: "Junction total sleep",
      evidenceRoles: aggregate.resourceContext.evidenceRoles,
      externalRef: makeJunctionSleepAggregateExternalRef(
        aggregate.resourceContext,
        aggregate,
        "sleep-total-minutes",
      ),
      dataOrigin: buildDataOrigin(aggregate.dataOriginEntry, aggregate.resourceContext, aggregate.timestamp, {
        normalizerVersion: JUNCTION_SLEEP_UNSPECIFIED_TOTAL_NORMALIZER_VERSION,
      }),
      fields: {
        metric: "sleep-total-minutes",
        observationGrain: "summary",
        value: Number(aggregate.durationMinutes.toFixed(4)),
        unit: "minutes",
      },
    }));
  }

  for (const aggregate of aggregates.values()) {
    const metric = sleepStageMetricDescriptor(aggregate.stage);
    if (isSleepMetricOwnedBySleepSummary(aggregate, metric.metric, sleepSummaryStageMetricOwners)) {
      continue;
    }

    context.events.push(stripUndefined({
      kind: "observation",
      occurredAt: aggregate.endAt,
      recordedAt: aggregate.recordedAt,
      dayKey: aggregate.timestamp.dayKey,
      timeZone: aggregate.timeZone,
      source: "device",
      title: metric.title,
      evidenceRoles: aggregate.resourceContext.evidenceRoles,
      externalRef: makeJunctionSleepAggregateExternalRef(
        aggregate.resourceContext,
        aggregate,
        metric.metric,
      ),
      dataOrigin: buildDataOrigin(aggregate.dataOriginEntry, aggregate.resourceContext, aggregate.timestamp, {
        normalizerVersion: JUNCTION_SLEEP_STAGE_CYCLE_FALLBACK_NORMALIZER_VERSION,
      }),
      fields: {
        metric: metric.metric,
        observationGrain: "summary",
        value: Number(aggregate.durationMinutes.toFixed(4)),
        unit: "minutes",
      },
    }));
  }
}

function isSleepMetricOwnedBySleepSummary(
  aggregate: JunctionSleepStageAggregate | JunctionSleepTotalAggregate,
  metric: string,
  sleepSummaryStageMetricOwners: readonly JunctionSleepSummaryStageMetricOwner[],
): boolean {
  return sleepSummaryStageMetricOwners.some((owner) =>
    owner.metric === metric &&
    sleepStageOwnerSourceMatchesAggregate(owner, aggregate) &&
    sleepStageOwnerWindowMatchesAggregate(owner, aggregate)
  );
}

function sleepStageOwnerSourceMatchesAggregate(
  owner: JunctionSleepSummaryStageMetricOwner,
  aggregate: JunctionSleepStageAggregate | JunctionSleepTotalAggregate,
): boolean {
  if (owner.sourceProviderSlug !== aggregate.resourceContext.sourceProviderSlug) {
    return false;
  }

  const aggregateSourceType = aggregate.resourceContext.origin.sourceType;
  if (owner.sourceType !== aggregateSourceType) {
    return false;
  }

  const aggregateSourceInstanceId = aggregate.resourceContext.origin.sourceInstanceId;
  return owner.sourceInstanceId === aggregateSourceInstanceId;
}

function sleepStageOwnerWindowMatchesAggregate(
  owner: JunctionSleepSummaryStageMetricOwner,
  aggregate: JunctionSleepStageAggregate | JunctionSleepTotalAggregate,
): boolean {
  return owner.startAt === aggregate.coverageStartAt &&
    owner.endAt === aggregate.coverageEndAt;
}

function collectJunctionSleepStageAggregates(
  entry: PlainObject,
  resourceContext: ResourceContext,
  context: NormalizationContext,
  aggregates: Map<string, JunctionSleepStageAggregate>,
  totalAggregates: Map<string, JunctionSleepTotalAggregate>,
): void {
  const parentTimestamp = resolveRecordTimestamp(entry, context, resourceContext.sourceProviderSlug);
  const intervals = collectJunctionSleepStageIntervals(entry, resourceContext, context, parentTimestamp);
  const parentResourceId = resolveSleepCycleParentResourceId(resourceContext, entry, parentTimestamp);
  const covered = collectCoveredSleepStageIntervals(entry, resourceContext, intervals);
  if (!parentResourceId || !covered) {
    return;
  }

  const buckets = new Map<string, JunctionSleepStageAggregateBucket>();
  const entryAggregates = new Map<string, JunctionSleepStageAggregate>();
  const entryTotalAggregates = new Map<string, JunctionSleepTotalAggregate>();
  const hasGenericAsleepStage = covered.intervals.some((interval) => interval.stage === "asleep_unspecified");
  const hasDetailedAsleepStage = covered.intervals.some((interval) => isDetailedAsleepStage(interval.stage));
  for (const interval of covered.intervals) {
    const stageTimestamp = withTimestampOverride(interval.timestamp, {
      occurredAt: covered.coverageWindow.endAt,
      dayKey: resolveSleepStageAnchorDayKey(
        covered.coverageWindow.endAt,
        interval.timeZone,
        interval.timestamp,
        parentTimestamp,
      ),
    });
    const bucketKey = sleepStageBucketKey(
      resourceContext,
      covered.coverageWindow.startAt,
      covered.coverageWindow.endAt,
    );
    const totalAggregateKey = sleepTotalAggregateKey(
      resourceContext,
      covered.coverageWindow.startAt,
      covered.coverageWindow.endAt,
    );
    if (hasGenericAsleepStage && isSleepTotalStage(interval.stage)) {
      addSleepTotalAggregateDuration(entryTotalAggregates, totalAggregateKey, {
        coverageEndAt: covered.coverageWindow.endAt,
        coverageStartAt: covered.coverageWindow.startAt,
        dataOriginEntry: interval.dataOriginEntry,
        durationMinutes: interval.durationMinutes,
        endAt: covered.coverageWindow.endAt,
        parentResourceId,
        recordedAt: stageTimestamp.recordedAt,
        resourceContext,
        startAt: covered.coverageWindow.startAt,
        timestamp: stageTimestamp,
        timeZone: interval.timeZone,
      });
    }

    if (interval.stage === "asleep_unspecified") {
      continue;
    }

    const aggregateKey = sleepStageAggregateKey(
      resourceContext,
      interval.stage,
      covered.coverageWindow.startAt,
      covered.coverageWindow.endAt,
    );
    if (hasDetailedAsleepStage) {
      const bucketCandidate = {
        coverageEndAt: covered.coverageWindow.endAt,
        coverageStartAt: covered.coverageWindow.startAt,
        dataOriginEntry: interval.dataOriginEntry,
        endAt: covered.coverageWindow.endAt,
        parentResourceId,
        recordedAt: stageTimestamp.recordedAt,
        resourceContext,
        startAt: covered.coverageWindow.startAt,
        timestamp: stageTimestamp,
        timeZone: interval.timeZone,
      };
      const existingBucket = buckets.get(bucketKey);
      if (existingBucket) {
        existingBucket.recordedAt = laterOptionalIsoTimestamp(existingBucket.recordedAt, stageTimestamp.recordedAt);
        const preferredBucket = compareSleepStageBucketPreference(bucketCandidate, existingBucket) > 0
          ? { ...bucketCandidate, recordedAt: existingBucket.recordedAt }
          : existingBucket;
        buckets.set(bucketKey, {
          ...preferredBucket,
          recordedAt: existingBucket.recordedAt,
          timestamp: withTimestampOverride(preferredBucket.timestamp, {
            recordedAt: existingBucket.recordedAt,
          }),
        });
      } else {
        buckets.set(bucketKey, bucketCandidate);
      }
    }

    addSleepStageAggregateDuration(entryAggregates, aggregateKey, {
      coverageEndAt: covered.coverageWindow.endAt,
      coverageStartAt: covered.coverageWindow.startAt,
      dataOriginEntry: interval.dataOriginEntry,
      durationMinutes: interval.durationMinutes,
      endAt: covered.coverageWindow.endAt,
      parentResourceId,
      recordedAt: stageTimestamp.recordedAt,
      resourceContext,
      stage: interval.stage,
      startAt: covered.coverageWindow.startAt,
      timestamp: stageTimestamp,
      timeZone: interval.timeZone,
    });
  }

  for (const bucket of buckets.values()) {
    for (const stage of JUNCTION_SLEEP_STAGES) {
      const aggregateKey = sleepStageAggregateKey(
        bucket.resourceContext,
        stage,
        bucket.coverageStartAt,
        bucket.coverageEndAt,
      );
      if (entryAggregates.has(aggregateKey)) {
        continue;
      }

      entryAggregates.set(aggregateKey, {
        coverageEndAt: bucket.coverageEndAt,
        coverageStartAt: bucket.coverageStartAt,
        dataOriginEntry: bucket.dataOriginEntry,
        durationMinutes: 0,
        endAt: bucket.endAt,
        parentResourceId: bucket.parentResourceId,
        recordedAt: bucket.recordedAt,
        resourceContext: bucket.resourceContext,
        stage,
        startAt: bucket.startAt,
        timestamp: bucket.timestamp,
        timeZone: bucket.timeZone,
      });
    }
  }

  for (const aggregate of entryAggregates.values()) {
    mergeSleepStageAggregateCandidate(aggregates, aggregate);
  }
  for (const aggregate of entryTotalAggregates.values()) {
    mergeSleepTotalAggregateCandidate(totalAggregates, aggregate);
  }
}

function sleepStageBucketKey(
  resourceContext: ResourceContext,
  coverageStartAt: string,
  coverageEndAt: string,
): string {
  return [
    resourceContext.externalRefResourceType,
    resourceContext.sourceProviderSlug,
    resourceContext.origin.sourceType,
    resourceContext.origin.sourceInstanceId,
    coverageStartAt,
    coverageEndAt,
  ].join("|");
}

function sleepStageAggregateKey(
  resourceContext: ResourceContext,
  stage: JunctionSleepStage,
  coverageStartAt: string,
  coverageEndAt: string,
): string {
  return [
    resourceContext.externalRefResourceType,
    resourceContext.sourceProviderSlug,
    resourceContext.origin.sourceType,
    resourceContext.origin.sourceInstanceId,
    coverageStartAt,
    coverageEndAt,
    stage,
  ].join("|");
}

function sleepTotalAggregateKey(
  resourceContext: ResourceContext,
  coverageStartAt: string,
  coverageEndAt: string,
): string {
  return [
    resourceContext.externalRefResourceType,
    resourceContext.sourceProviderSlug,
    resourceContext.origin.sourceType,
    resourceContext.origin.sourceInstanceId,
    coverageStartAt,
    coverageEndAt,
    "sleep-total-minutes",
  ].join("|");
}

function addSleepStageAggregateDuration(
  aggregates: Map<string, JunctionSleepStageAggregate>,
  aggregateKey: string,
  candidate: JunctionSleepStageAggregate,
): void {
  const existing = aggregates.get(aggregateKey);
  if (!existing) {
    aggregates.set(aggregateKey, candidate);
    return;
  }

  const recordedAt = laterOptionalIsoTimestamp(existing.recordedAt, candidate.recordedAt);
  const preferred = compareSleepStageAggregatePreference(candidate, existing) > 0 ? candidate : existing;
  aggregates.set(aggregateKey, {
    ...preferred,
    durationMinutes: existing.durationMinutes + candidate.durationMinutes,
    recordedAt,
    timestamp: withTimestampOverride(preferred.timestamp, { recordedAt }),
  });
}

function addSleepTotalAggregateDuration(
  aggregates: Map<string, JunctionSleepTotalAggregate>,
  aggregateKey: string,
  candidate: JunctionSleepTotalAggregate,
): void {
  const existing = aggregates.get(aggregateKey);
  if (!existing) {
    aggregates.set(aggregateKey, candidate);
    return;
  }

  const recordedAt = laterOptionalIsoTimestamp(existing.recordedAt, candidate.recordedAt);
  const preferred = compareSleepAggregatePreference(candidate, existing) > 0 ? candidate : existing;
  aggregates.set(aggregateKey, {
    ...preferred,
    durationMinutes: existing.durationMinutes + candidate.durationMinutes,
    recordedAt,
    timestamp: withTimestampOverride(preferred.timestamp, { recordedAt }),
  });
}

function mergeSleepStageAggregateCandidate(
  aggregates: Map<string, JunctionSleepStageAggregate>,
  candidate: JunctionSleepStageAggregate,
): void {
  const aggregateKey = sleepStageAggregateKey(
    candidate.resourceContext,
    candidate.stage,
    candidate.coverageStartAt,
    candidate.coverageEndAt,
  );
  const existing = aggregates.get(aggregateKey);
  if (!existing) {
    aggregates.set(aggregateKey, candidate);
    return;
  }

  const recordedAt = laterOptionalIsoTimestamp(existing.recordedAt, candidate.recordedAt);
  const preferred = compareSleepStageAggregatePreference(candidate, existing) > 0 ? candidate : existing;
  aggregates.set(aggregateKey, {
    ...preferred,
    recordedAt,
    timestamp: withTimestampOverride(preferred.timestamp, { recordedAt }),
  });
}

function mergeSleepTotalAggregateCandidate(
  aggregates: Map<string, JunctionSleepTotalAggregate>,
  candidate: JunctionSleepTotalAggregate,
): void {
  const aggregateKey = sleepTotalAggregateKey(
    candidate.resourceContext,
    candidate.coverageStartAt,
    candidate.coverageEndAt,
  );
  const existing = aggregates.get(aggregateKey);
  if (!existing) {
    aggregates.set(aggregateKey, candidate);
    return;
  }

  const recordedAt = laterOptionalIsoTimestamp(existing.recordedAt, candidate.recordedAt);
  const preferred = compareSleepAggregatePreference(candidate, existing) > 0 ? candidate : existing;
  aggregates.set(aggregateKey, {
    ...preferred,
    recordedAt,
    timestamp: withTimestampOverride(preferred.timestamp, { recordedAt }),
  });
}

function compareSleepStageBucketPreference(
  left: JunctionSleepStageAggregateBucket,
  right: JunctionSleepStageAggregateBucket,
): number {
  return compareSleepStageDisplayPreference(
    {
      dayKey: left.timestamp.dayKey,
      parentResourceId: left.parentResourceId,
      timeZone: left.timeZone,
    },
    {
      dayKey: right.timestamp.dayKey,
      parentResourceId: right.parentResourceId,
      timeZone: right.timeZone,
    },
  );
}

function compareSleepStageAggregatePreference(
  left: JunctionSleepStageAggregate,
  right: JunctionSleepStageAggregate,
): number {
  return compareSleepAggregatePreference(left, right);
}

function compareSleepAggregatePreference(
  left: JunctionSleepStageAggregate | JunctionSleepTotalAggregate,
  right: JunctionSleepStageAggregate | JunctionSleepTotalAggregate,
): number {
  const durationPreference = Number(left.durationMinutes > 0) - Number(right.durationMinutes > 0);
  if (durationPreference !== 0) {
    return durationPreference;
  }

  return compareSleepStageDisplayPreference(
    {
      dayKey: left.timestamp.dayKey,
      parentResourceId: left.parentResourceId,
      timeZone: left.timeZone,
    },
    {
      dayKey: right.timestamp.dayKey,
      parentResourceId: right.parentResourceId,
      timeZone: right.timeZone,
    },
  );
}

function compareSleepStageDisplayPreference(
  left: { dayKey?: string; parentResourceId: string; timeZone?: string },
  right: { dayKey?: string; parentResourceId: string; timeZone?: string },
): number {
  const timeZonePreference = sleepStageTimeZonePreference(left.timeZone) -
    sleepStageTimeZonePreference(right.timeZone);
  if (timeZonePreference !== 0) {
    return timeZonePreference;
  }

  const timeZoneOrder = compareOptionalSleepStageDisplayValue(left.timeZone, right.timeZone);
  if (timeZoneOrder !== 0) {
    return timeZoneOrder;
  }

  const dayKeyOrder = compareOptionalSleepStageDisplayValue(left.dayKey, right.dayKey);
  if (dayKeyOrder !== 0) {
    return dayKeyOrder;
  }

  return compareOptionalSleepStageDisplayValue(left.parentResourceId, right.parentResourceId);
}

function isDetailedAsleepStage(stage: JunctionSleepStageValue): stage is Exclude<JunctionSleepStage, "awake"> {
  return stage === "light" || stage === "deep" || stage === "rem";
}

function isSleepTotalStage(stage: JunctionSleepStageValue): boolean {
  return stage !== "awake";
}

function sleepStageTimeZonePreference(timeZone: string | undefined): number {
  if (!timeZone) {
    return 0;
  }

  return timeZone === "UTC" ? 1 : 2;
}

function compareOptionalSleepStageDisplayValue(left: string | undefined, right: string | undefined): number {
  const leftValue = left ?? "";
  const rightValue = right ?? "";
  if (leftValue === rightValue) {
    return 0;
  }

  return leftValue < rightValue ? 1 : -1;
}

function collectCoveredSleepStageIntervals(
  entry: PlainObject,
  resourceContext: ResourceContext,
  intervals: readonly JunctionSleepStageInterval[],
): JunctionCoveredSleepStageIntervals | undefined {
  const coverageWindow = resolveSleepStageCoverageWindow(entry, resourceContext.sourceProviderSlug);
  if (!coverageWindow || intervals.length === 0) {
    return undefined;
  }

  const coveredIntervals = clipSleepStageIntervalsToWindow(intervals, coverageWindow);
  return coveredIntervals ? { coverageWindow, intervals: coveredIntervals } : undefined;
}

function resolveSleepStageCoverageWindow(
  entry: PlainObject,
  sourceProviderSlug: string | undefined,
): JunctionSleepStageCoverageWindow | undefined {
  const startAt = resolveSafeTimestamp(
    firstValueFromPaths(entry, JUNCTION_SLEEP_COVERAGE_START_TIMESTAMP_PATHS),
    sourceProviderSlug,
  );
  const endAt = resolveSafeTimestamp(
    firstValueFromPaths(entry, JUNCTION_SLEEP_COVERAGE_END_TIMESTAMP_PATHS),
    sourceProviderSlug,
  );

  if (!startAt || !endAt || Date.parse(endAt) <= Date.parse(startAt)) {
    return undefined;
  }

  return { endAt, startAt };
}

function collectSleepStageCoverageIntervals(
  entry: PlainObject,
  sourceProviderSlug: string,
): Array<Pick<JunctionSleepStageInterval, "endAt" | "startAt">> {
  return sleepStageIntervalEntries(entry, sourceProviderSlug).flatMap((intervalEntry) => {
    const stage = firstSleepStageFromPaths(intervalEntry, JUNCTION_SLEEP_STAGE_VALUE_PATHS, sourceProviderSlug);
    if (!stage) {
      return [];
    }

    const startAt = resolveSafeTimestamp(
      firstValueFromPaths(intervalEntry, JUNCTION_SLEEP_START_TIMESTAMP_PATHS),
      sourceProviderSlug,
    );
    const endAt = resolveSafeTimestamp(
      firstValueFromPaths(intervalEntry, JUNCTION_SLEEP_END_TIMESTAMP_PATHS),
      sourceProviderSlug,
    );
    const durationMinutes =
      normalizePositiveMinutes(
        firstNumberFromPaths(intervalEntry, JUNCTION_SLEEP_STAGE_DURATION_MINUTE_PATHS),
      ) ??
      normalizePositiveMinutes(
        secondsToMinutes(firstNumberFromPaths(intervalEntry, JUNCTION_SLEEP_STAGE_DURATION_SECOND_PATHS)),
      ) ??
      normalizePositiveMinutes(
        millisecondsToMinutes(firstNumberFromPaths(intervalEntry, JUNCTION_SLEEP_STAGE_DURATION_MILLISECOND_PATHS)),
      ) ??
      exactPositiveMinutesBetween(startAt, endAt);
    const resolvedStartAt = startAt ?? subtractMinutes(endAt, durationMinutes);
    const resolvedEndAt = endAt ?? addMinutes(startAt, durationMinutes);

    return resolvedStartAt && resolvedEndAt && durationMinutes !== undefined
      ? [{ endAt: resolvedEndAt, startAt: resolvedStartAt }]
      : [];
  });
}

function sleepStageCoverageIntervalsCoverWindow(
  intervals: ReadonlyArray<Pick<JunctionSleepStageInterval, "endAt" | "startAt">>,
  coverageWindow: JunctionSleepStageCoverageWindow,
): boolean {
  const windowStartMs = Date.parse(coverageWindow.startAt);
  const windowEndMs = Date.parse(coverageWindow.endAt);
  if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs) || windowEndMs <= windowStartMs) {
    return false;
  }

  let coveredUntilMs = windowStartMs;
  const orderedIntervals = [...intervals].sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt));
  for (const interval of orderedIntervals) {
    const rawStartMs = Date.parse(interval.startAt);
    const rawEndMs = Date.parse(interval.endAt);
    if (!Number.isFinite(rawStartMs) || !Number.isFinite(rawEndMs)) {
      continue;
    }

    const intervalStartMs = Math.max(rawStartMs, windowStartMs);
    const intervalEndMs = Math.min(rawEndMs, windowEndMs);
    if (intervalEndMs <= intervalStartMs) {
      continue;
    }

    if (intervalStartMs - coveredUntilMs > SLEEP_STAGE_COVERAGE_TOLERANCE_MS) {
      return false;
    }

    if (intervalStartMs < coveredUntilMs - SLEEP_STAGE_COVERAGE_TOLERANCE_MS) {
      return false;
    }

    const clippedStartMs = Math.max(intervalStartMs, coveredUntilMs);
    if (intervalEndMs <= clippedStartMs) {
      continue;
    }

    coveredUntilMs = intervalEndMs;
  }

  return windowEndMs - coveredUntilMs <= SLEEP_STAGE_COVERAGE_TOLERANCE_MS;
}

function clipSleepStageIntervalsToWindow(
  intervals: readonly JunctionSleepStageInterval[],
  coverageWindow: JunctionSleepStageCoverageWindow,
): JunctionSleepStageInterval[] | undefined {
  const windowStartMs = Date.parse(coverageWindow.startAt);
  const windowEndMs = Date.parse(coverageWindow.endAt);
  if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs) || windowEndMs <= windowStartMs) {
    return undefined;
  }

  let coveredUntilMs = windowStartMs;
  const coveredIntervals: JunctionSleepStageInterval[] = [];
  const orderedIntervals = [...intervals].sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt));
  for (const interval of orderedIntervals) {
    const rawStartMs = Date.parse(interval.startAt);
    const rawEndMs = Date.parse(interval.endAt);
    if (!Number.isFinite(rawStartMs) || !Number.isFinite(rawEndMs)) {
      continue;
    }

    const intervalStartMs = Math.max(rawStartMs, windowStartMs);
    const intervalEndMs = Math.min(rawEndMs, windowEndMs);
    if (intervalEndMs <= intervalStartMs) {
      continue;
    }

    if (intervalStartMs - coveredUntilMs > SLEEP_STAGE_COVERAGE_TOLERANCE_MS) {
      return undefined;
    }

    if (intervalStartMs < coveredUntilMs - SLEEP_STAGE_COVERAGE_TOLERANCE_MS) {
      return undefined;
    }

    const clippedStartMs = Math.max(intervalStartMs, coveredUntilMs);
    const clippedEndMs = intervalEndMs;
    if (clippedEndMs <= clippedStartMs) {
      continue;
    }

    coveredIntervals.push({
      ...interval,
      durationMinutes: (clippedEndMs - clippedStartMs) / 60000,
      endAt: new Date(clippedEndMs).toISOString(),
      startAt: new Date(clippedStartMs).toISOString(),
    });
    coveredUntilMs = clippedEndMs;
  }

  return windowEndMs - coveredUntilMs <= SLEEP_STAGE_COVERAGE_TOLERANCE_MS
    ? coveredIntervals
    : undefined;
}

function collectJunctionSleepStageIntervals(
  entry: PlainObject,
  resourceContext: ResourceContext,
  context: NormalizationContext,
  parentTimestamp: ReturnType<typeof resolveRecordTimestamp>,
): JunctionSleepStageInterval[] {
  const intervals: JunctionSleepStageInterval[] = [];

  for (const intervalEntry of sleepStageIntervalEntries(entry, resourceContext.sourceProviderSlug)) {
    const stage = firstSleepStageFromPaths(
      intervalEntry,
      JUNCTION_SLEEP_STAGE_VALUE_PATHS,
      resourceContext.sourceProviderSlug,
    );
    if (!stage) {
      continue;
    }

    const startAtRaw = firstValueFromPaths(intervalEntry, JUNCTION_SLEEP_START_TIMESTAMP_PATHS);
    const endAtRaw = firstValueFromPaths(intervalEntry, JUNCTION_SLEEP_END_TIMESTAMP_PATHS);
    const startAt = resolveSafeTimestamp(startAtRaw, resourceContext.sourceProviderSlug);
    const endAt = resolveSafeTimestamp(endAtRaw, resourceContext.sourceProviderSlug);
    const durationMinutes =
      normalizePositiveMinutes(
        firstNumberFromPaths(intervalEntry, JUNCTION_SLEEP_STAGE_DURATION_MINUTE_PATHS),
      ) ??
      normalizePositiveMinutes(
        secondsToMinutes(firstNumberFromPaths(intervalEntry, JUNCTION_SLEEP_STAGE_DURATION_SECOND_PATHS)),
      ) ??
      normalizePositiveMinutes(
        millisecondsToMinutes(firstNumberFromPaths(intervalEntry, JUNCTION_SLEEP_STAGE_DURATION_MILLISECOND_PATHS)),
      ) ??
      exactPositiveMinutesBetween(startAt, endAt);
    const resolvedStartAt = startAt ?? subtractMinutes(endAt, durationMinutes);
    const resolvedEndAt = endAt ?? addMinutes(startAt, durationMinutes);

    if (!resolvedStartAt || !resolvedEndAt || durationMinutes === undefined) {
      continue;
    }

    const intervalTimestamp = resolveRecordTimestamp(intervalEntry, context, resourceContext.sourceProviderSlug);
    const originEntry: PlainObject = { ...entry, ...intervalEntry };
    const timeZone = resolveSleepStageCanonicalTimeZone(intervalEntry, entry);
    const stageTimestamp = withTimestampOverride(intervalTimestamp, {
      recordedAt: intervalTimestamp.recordedAt ?? parentTimestamp.recordedAt ?? resolvedStartAt,
      observedAtRaw: stringId(startAtRaw) ?? intervalTimestamp.observedAtRaw ?? parentTimestamp.observedAtRaw ?? resolvedStartAt,
      timestampSemantics: intervalTimestamp.timestampSemantics ?? parentTimestamp.timestampSemantics,
    });

    intervals.push({
      dataOriginEntry: originEntry,
      durationMinutes,
      endAt: resolvedEndAt,
      recordedAt: stageTimestamp.recordedAt,
      stage,
      startAt: resolvedStartAt,
      intervalEntry,
      timestamp: stageTimestamp,
      timeZone,
    });
  }

  return intervals;
}

function resolveSleepCycleParentResourceId(
  resourceContext: ResourceContext,
  entry: PlainObject,
  parentTimestamp: ReturnType<typeof resolveRecordTimestamp>,
): string | undefined {
  const explicitParentId = firstStringFromPaths(entry, JUNCTION_GENERIC_SUMMARY_ID_PATHS);
  if (
    (parentTimestamp.observedAtRaw || explicitParentId) &&
    !isDirectSleepStageIntervalEntry(entry, resourceContext.sourceProviderSlug)
  ) {
    return buildStableResourceId(resourceContext, entry, parentTimestamp);
  }

  return undefined;
}

function hasSleepCycleCompactParentIdentity(entry: PlainObject, sourceProviderSlug: string | undefined): boolean {
  return !isDirectSleepStageIntervalEntry(entry, sourceProviderSlug) &&
    Boolean(
      firstStringFromPaths(entry, JUNCTION_GENERIC_SUMMARY_ID_PATHS) ||
        firstStringFromPaths(entry, JUNCTION_RECORD_TIMESTAMP_PATHS),
    );
}

function makeJunctionSleepAggregateExternalRef(
  resourceContext: ResourceContext,
  aggregate: JunctionSleepStageAggregate | JunctionSleepTotalAggregate,
  metric: string,
): DeviceExternalRefPayload {
  return makeJunctionCanonicalSleepStageExternalRef(resourceContext, {
    coverageEndAt: aggregate.coverageEndAt,
    coverageStartAt: aggregate.coverageStartAt,
    dayKey: aggregate.timestamp.dayKey,
    metric,
    timeZone: aggregate.timeZone,
  });
}

function makeJunctionCanonicalSleepStageExternalRef(
  resourceContext: ResourceContext,
  input: {
    coverageEndAt: string;
    coverageStartAt: string;
    dayKey?: string;
    metric: string;
    timeZone?: string;
  },
): DeviceExternalRefPayload {
  return makeProviderExternalRef(
    "junction",
    buildJunctionResourceType(resourceContext.sourceProviderSlug, "sleep"),
    `sleep-stage-${shortHash([
      resourceContext.sourceProviderSlug,
      resourceContext.origin.sourceType,
      resourceContext.origin.sourceInstanceId,
      input.coverageStartAt,
      input.coverageEndAt,
    ])}`,
    undefined,
    slugify(input.metric, "value"),
  );
}

function sleepStageMetricDescriptor(stage: JunctionSleepStage): Pick<MetricDescriptor, "metric" | "title"> {
  switch (stage) {
    case "awake":
      return { metric: "sleep-awake-minutes", title: "Junction awake time" };
    case "light":
      return { metric: "sleep-light-minutes", title: "Junction light sleep" };
    case "deep":
      return { metric: "sleep-deep-minutes", title: "Junction deep sleep" };
    case "rem":
      return { metric: "sleep-rem-minutes", title: "Junction REM sleep" };
  }

  const exhaustive: never = stage;
  return exhaustive;
}

function earlierIsoTimestamp(left: string, right: string): string {
  return Date.parse(right) < Date.parse(left) ? right : left;
}

function laterIsoTimestamp(left: string, right: string): string {
  return Date.parse(right) > Date.parse(left) ? right : left;
}

function laterOptionalIsoTimestamp(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return laterIsoTimestamp(left, right);
}

function resolveSleepStageAnchorDayKey(
  coverageEndAt: string,
  timeZone: string | undefined,
  timestamp: ReturnType<typeof resolveRecordTimestamp>,
  parentTimestamp?: ReturnType<typeof resolveRecordTimestamp>,
): string | undefined {
  const coverageEndMs = Date.parse(coverageEndAt);
  const localDayKey = Number.isFinite(coverageEndMs) && timeZone
    ? localDayKeyAtMs(coverageEndMs, timeZone)
    : undefined;

  return localDayKey ?? timestamp.dayKey ?? parentTimestamp?.dayKey ?? extractIsoDatePrefix(coverageEndAt) ?? undefined;
}

function resolveSleepStageBucketTimeZone(
  intervalEntry: PlainObject,
  parentEntry: PlainObject,
  _defaultTimeZone: string | undefined,
): string | undefined {
  // Only provider-supplied zones (or explicit UTC timestamps) can define
  // durable stage buckets. The vault default timezone is mutable profile
  // state, so missing/null provider zones keep stable UTC-day identity.
  return resolveSleepStageCanonicalTimeZone(intervalEntry, parentEntry);
}

function localDayKeyAtMs(timestampMs: number, timeZone: string): string | undefined {
  try {
    return toLocalDayKey(new Date(timestampMs), timeZone);
  } catch {
    return undefined;
  }
}

function pushWorkoutSummary(
  entry: PlainObject,
  resourceContext: ResourceContext,
  context: NormalizationContext,
): void {
  const timestamp = resolveRecordTimestamp(entry, context, resourceContext.sourceProviderSlug);
  const startAtRaw = firstValueFromPaths(entry, ["startAt", "start_at", "start", "timeStart", "time_start"]);
  const startAt = resolveSafeTimestamp(
    startAtRaw,
    resourceContext.sourceProviderSlug,
  );
  const endAtRaw = firstValueFromPaths(entry, ["endAt", "end_at", "end", "timeEnd", "time_end"]);
  const endAt = resolveSafeTimestamp(
    endAtRaw,
    resourceContext.sourceProviderSlug,
  );
  const movingTimeMinutes = resolveWorkoutMovingTimeMinutes(entry);
  const explicitDurationMinutes =
    normalizePositiveIntegerMinutes(
      firstNumberFromPaths(entry, ["durationMinutes", "duration_minutes"]),
    ) ??
    normalizePositiveIntegerMinutes(
      secondsToMinutes(firstNumberFromPaths(entry, ["durationSeconds", "duration_seconds", "duration"])),
    ) ??
    normalizePositiveIntegerMinutes(
      millisecondsToMinutes(firstNumberFromPaths(entry, ["durationMillis", "duration_millis"])),
    );
  const elapsedDurationMinutes = normalizePositiveIntegerMinutes(minutesBetween(startAt, endAt));
  const durationMinutes = explicitDurationMinutes ?? elapsedDurationMinutes ?? movingTimeMinutes;
  const occurredAt = startAt ?? subtractMinutes(endAt, durationMinutes) ?? timestamp.occurredAt;

  const workoutTimestamp = occurredAt
    ? withTimestampOverride(timestamp, {
      occurredAt,
      dayKey: resolveJunctionWorkoutDayKey(entry, startAtRaw, endAtRaw, occurredAt, timestamp),
      observedAtRaw: stringId(startAtRaw) ?? occurredAt,
    })
    : timestamp;
  if (!occurredAt || durationMinutes === undefined) {
    return;
  }

  const dayKey = workoutTimestamp.dayKey;
  const rawSport = firstStringFromPaths(entry, ["sport.slug", "sportSlug", "sport_slug", "sport.type", "sportType", "sport_type", "sport.name", "sportName", "sport_name", "sport"]);
  const sportName = trimOptionalToLength(
    firstStringFromPaths(entry, ["sport.name", "sportName", "sport_name", "sport.type", "sportType", "sport_type", "sport"]),
    160,
  );
  const sport = rawSport ? trimSlugToLength(slugify(rawSport, "workout"), 80) : undefined;
  const rawActivityType = firstStringFromPaths(entry, ["activityType", "activity_type", "sportType", "sport_type", "type"]) ?? rawSport;
  const activityType = slugify(rawActivityType, "workout");
  const title = trimToLength(
    firstStringFromPaths(entry, ["title", "name", "sport.name", "sportName", "sport_name", "sport.type", "sportType", "sport_type", "sport", "activityType", "activity_type"]) ?? "Junction workout",
    160,
  );
  const sourceWorkoutId = trimOptionalToLength(
    firstStringFromPaths(entry, JUNCTION_WORKOUT_SOURCE_ID_PATHS),
    200,
  );
  const distanceKm =
    firstNumberFromPaths(entry, ["distanceKm", "distance_km"]) ??
    metersToKilometers(firstNumberFromPaths(entry, ["distanceMeters", "distance_meters", "distance"]));
  const workoutMetrics = buildWorkoutSessionMetrics(entry);
  const externalRef = makeJunctionExternalRef(resourceContext, entry, workoutTimestamp, "session");
  const legacyExternalRef = makeJunctionLegacyWorkoutExternalRef(
    resourceContext,
    entry,
    externalRef,
  );

  context.events.push(stripUndefined({
    kind: "activity_session",
    occurredAt,
    recordedAt: timestamp.recordedAt,
    dayKey,
    timeZone: firstStringFromPaths(entry, ["timeZone", "timezone", "time_zone"]),
    source: "device",
    title,
    evidenceRoles: resourceContext.evidenceRoles,
    externalRef,
    legacyExternalRefs: legacyExternalRef ? [legacyExternalRef] : undefined,
    dataOrigin: buildDataOrigin(entry, resourceContext, workoutTimestamp),
    fields: stripUndefined({
      durationMinutes,
      activityType,
      distanceKm,
      workout: stripUndefined({
        sourceApp: resourceContext.sourceProviderSlug,
        sourceWorkoutId,
        sport,
        sportName,
        startedAt: startAt ?? occurredAt,
        endedAt: endAt,
        movingTimeMinutes,
        sessionNote: title,
        metrics: workoutMetrics,
        heartRateZones: buildWorkoutHeartRateZones(entry),
        route: buildWorkoutRouteMetadata(entry),
        exercises: [],
      }),
    }),
  }));
}

function resolveJunctionWorkoutDayKey(
  entry: PlainObject,
  startAtRaw: unknown,
  endAtRaw: unknown,
  occurredAt: string,
  timestamp: ReturnType<typeof resolveRecordTimestamp>,
): string | undefined {
  const calendarDayKey = firstIsoDateFromPaths(entry, JUNCTION_LOCAL_CALENDAR_DATE_PATHS);
  if (calendarDayKey) {
    return calendarDayKey;
  }

  const startDayKey = resolveJunctionLocalDayKey(entry, startAtRaw, occurredAt);
  if (stringId(startAtRaw) !== undefined) {
    return startDayKey ?? timestamp.dayKey;
  }

  const endOffsetSeconds = readEmbeddedTimestampOffsetSeconds(endAtRaw);
  if (endOffsetSeconds !== undefined) {
    const endOffsetDayKey = extractLocalDayKeyFromUtcOffset(occurredAt, endOffsetSeconds);
    if (endOffsetDayKey) {
      return endOffsetDayKey;
    }
  }

  const computedOccurredDayKey = resolveJunctionLocalDayKey(entry, occurredAt, occurredAt, "utc");
  if (computedOccurredDayKey) {
    return computedOccurredDayKey;
  }

  if (
    timestamp.observedAtRaw
    && (timestamp.timestampSemantics === "floating" || isDateOnlyJunctionTimestamp(timestamp.observedAtRaw))
  ) {
    return timestamp.dayKey;
  }

  return undefined;
}

function readEmbeddedTimestampOffsetSeconds(value: unknown): number | undefined {
  const rawTimestamp = stringId(value)?.trim();
  const offset = rawTimestamp ? /([+-]\d{2}:?\d{2})$/u.exec(rawTimestamp)?.[1] : undefined;
  const offsetMinutes = offset ? parseJunctionTimeZoneOffsetMinutes(offset) : undefined;
  return offsetMinutes === undefined ? undefined : offsetMinutes * 60;
}

function pushMealSummary(
  entry: PlainObject,
  resourceContext: ResourceContext,
  context: NormalizationContext,
): void {
  const resolvedTimestamp = resolveJunctionMealTimestamp(entry, context, resourceContext.sourceProviderSlug);
  if (!resolvedTimestamp) {
    return;
  }

  const { occurredAt, timestamp: mealTimestamp } = resolvedTimestamp;
  const foodItems = listJunctionMealFoodItems(entry);
  const ingredients = buildJunctionMealIngredients(entry, foodItems);
  const nutrition = buildJunctionMealNutrition(entry, resourceContext, foodItems);

  context.events.push(stripUndefined({
    kind: "meal",
    occurredAt,
    recordedAt: mealTimestamp.recordedAt,
    dayKey: mealTimestamp.dayKey,
    timeZone: firstStringFromPaths(entry, ["timeZone", "timezone", "time_zone"]),
    source: "device",
    title: resolveJunctionMealTitle(entry),
    evidenceRoles: resourceContext.evidenceRoles,
    externalRef: makeJunctionExternalRef(resourceContext, entry, mealTimestamp, "meal"),
    dataOrigin: buildDataOrigin(entry, resourceContext, mealTimestamp),
    fields: stripUndefined({
      mealId: buildJunctionMealId(resourceContext, entry, mealTimestamp),
      ingredients,
      nutrition,
    }),
  }));
}

// Junction profile summaries report height as an integer in centimeters
// (docs.junction.com/api-reference/data/profile/get-summary).
const JUNCTION_PROFILE_METRICS: readonly MetricDescriptor[] = [
  {
    metric: "height",
    unit: "cm",
    title: "Junction height",
    paths: ["height", "heightCm", "height_cm", "heightCentimeters", "height_centimeters"],
  },
];
const JUNCTION_PROFILE_BIRTH_DATE_PATHS = [
  "birthDate",
  "birth_date",
  "dateOfBirth",
  "date_of_birth",
  "dob",
] as const;
const JUNCTION_PROFILE_GENDER_PATHS = ["gender"] as const;
// `gender` is deliberately not a fallback: Junction documents it as a
// distinct enum from biological sex, so each lands under its own label and
// the reported gender also receives its own typed canonical field.
const JUNCTION_PROFILE_SEX_PATHS = [
  "sex",
  "biologicalSex",
  "biological_sex",
] as const;
const JUNCTION_PROFILE_AUTHORITATIVE_FACET_PREFIXES = [
  "height",
  "profile-demographics",
] as const;
const JUNCTION_MENSTRUAL_AUTHORITATIVE_FACET_PREFIXES = [
  "period-length-days",
  "cycle-length-days",
  "menstrual-flow",
  "ovulation-test",
  "pregnancy-test",
  "cervical-mucus",
  "intermenstrual-bleeding",
  "progesterone-test",
  "contraceptive",
  "sexual-activity",
  "menstrual-cycle-deviation",
] as const;

function pushJunctionAuthoritativeSummaryEventSet(
  entry: PlainObject,
  resourceContext: ResourceContext,
  context: NormalizationContext,
  emittedEvents: readonly DeviceEventPayload[],
): void {
  const facetPrefixes = resourceContext.resource === "profile"
    ? JUNCTION_PROFILE_AUTHORITATIVE_FACET_PREFIXES
    : resourceContext.resource === "menstrual_cycle"
      && firstValueFromPaths(entry, ["isPredicted", "is_predicted"]) !== true
      ? JUNCTION_MENSTRUAL_AUTHORITATIVE_FACET_PREFIXES
      : undefined;
  const explicitId = firstStringFromPaths(entry, JUNCTION_GENERIC_SUMMARY_ID_PATHS);
  const version = junctionAuthoritativeSummaryVersion(resourceContext, entry);
  if (!facetPrefixes || !explicitId || !version) {
    return;
  }

  const timestamp = resolveRecordTimestamp(entry, context, resourceContext.sourceProviderSlug);
  const identity = makeJunctionExternalRef(
    resourceContext,
    entry,
    timestamp,
    facetPrefixes[0],
  );
  const currentFacets = emittedEvents.flatMap((event) => {
    const externalRef = event.externalRef;
    return externalRef?.system === identity.system
      && externalRef.resourceType === identity.resourceType
      && externalRef.resourceId === identity.resourceId
      && externalRef.version === version
      && externalRef.facet
      ? [externalRef.facet]
      : [];
  });

  context.authoritativeEventSets.push({
    system: identity.system,
    resourceType: identity.resourceType,
    resourceId: identity.resourceId,
    version,
    facetPrefixes: [...facetPrefixes],
    currentFacets: [...new Set(currentFacets)].sort(),
  });
}

// Junction profile is a single current-state snapshot per source. Height
// follows the body-summary observation pattern; birth date, biological sex,
// and wheelchair use are categorical, so they land as one structured note
// event keyed by a stable external ref instead of fake numeric observations.
function pushProfileSummary(
  entry: PlainObject,
  resourceContext: ResourceContext,
  context: NormalizationContext,
): void {
  const baseTimestamp = resolveRecordTimestamp(entry, context, resourceContext.sourceProviderSlug);
  // Profile entries carry no observed-at timestamp, so the generic resolver
  // falls back to the sync window. Pin the FULL event time (occurredAt,
  // recordedAt, dayKey) plus the identity-bearing observedAtRaw to the
  // provider's updated/created timestamps: a window-drifting occurredAt
  // would revise the event spine on every reconcile and duplicate the
  // profile across month shards (cross-shard reconcile only indexes the
  // target shard). Junction documents created_at/updated_at as REQUIRED on
  // ClientFacingProfile, so a row without them is malformed input and
  // deliberately stays raw-only rather than getting an invented time.
  const providerTimestampRaw = firstValueFromPaths(entry, ["updatedAt", "updated_at", "createdAt", "created_at"]);
  const providerTimestamp = resolveSafeTimestamp(providerTimestampRaw, resourceContext.sourceProviderSlug);
  const pinnedOccurredAt = baseTimestamp.observedAtRaw ? baseTimestamp.occurredAt : providerTimestamp;
  if (!pinnedOccurredAt) {
    return;
  }
  const timestamp = withTimestampOverride(baseTimestamp, {
    occurredAt: pinnedOccurredAt,
    recordedAt: baseTimestamp.observedAtRaw ? baseTimestamp.recordedAt : providerTimestamp,
    dayKey: extractIsoDatePrefix(pinnedOccurredAt) ?? baseTimestamp.dayKey,
    observedAtRaw: baseTimestamp.observedAtRaw
      ?? stringId(providerTimestampRaw)
      ?? "current",
  });

  pushObservationMetrics(entry, resourceContext, context, JUNCTION_PROFILE_METRICS, timestamp);

  if (!timestamp.occurredAt) {
    return;
  }

  const birthDate = firstIsoDateFromPaths(entry, JUNCTION_PROFILE_BIRTH_DATE_PATHS);
  const reportedGender = readJunctionProfileGender(entry);
  const sex = readJunctionProfileSex(entry);
  const wheelchairUse = firstValueFromPaths(entry, ["wheelchairUse", "wheelchair_use"]);
  const segments = [
    birthDate ? `Birth date: ${birthDate}.` : undefined,
    reportedGender ? `Reported gender: ${reportedGender}.` : undefined,
    sex ? `Biological sex: ${sex}.` : undefined,
    typeof wheelchairUse === "boolean" ? `Wheelchair use: ${wheelchairUse ? "yes" : "no"}.` : undefined,
  ].filter((segment): segment is string => segment !== undefined);

  if (segments.length === 0) {
    return;
  }

  context.events.push(stripUndefined({
    kind: "note",
    occurredAt: timestamp.occurredAt,
    recordedAt: timestamp.recordedAt,
    dayKey: timestamp.dayKey,
    source: "device",
    title: "Junction profile",
    note: trimToLength(segments.join(" "), 4000),
    evidenceRoles: resourceContext.evidenceRoles,
    externalRef: makeJunctionExternalRef(resourceContext, entry, timestamp, "profile-demographics"),
    dataOrigin: buildDataOrigin(entry, resourceContext, timestamp),
    fields: reportedGender ? { reportedGender } : undefined,
  }));
}

function readJunctionProfileGender(entry: PlainObject): "female" | "male" | "other" | undefined {
  const value = firstStringFromPaths(entry, JUNCTION_PROFILE_GENDER_PATHS)?.trim().toLowerCase();
  return value === "female" || value === "male" || value === "other"
    ? value
    : undefined;
}

function readJunctionProfileSex(entry: PlainObject): string | undefined {
  const value = firstStringFromPaths(entry, JUNCTION_PROFILE_SEX_PATHS);
  if (!value || value.trim().toLowerCase() === "unknown") {
    return undefined;
  }

  return trimToLength(value, 40);
}

// Flow categories are a real ordinal intensity scale; the provider label is
// preserved as a measurement qualifier.
const JUNCTION_MENSTRUAL_FLOW_ORDINALS: Readonly<Record<string, number>> = Object.freeze({
  none: 0,
  light: 1,
  medium: 2,
  heavy: 3,
});
const JUNCTION_CERVICAL_MUCUS_QUALITIES = new Set([
  "dry",
  "sticky",
  "creamy",
  "watery",
  "egg_white",
]);
const JUNCTION_CONTRACEPTIVE_TYPES = new Set([
  "implant",
  "injection",
  "iud",
  "intravaginal_ring",
  "oral",
  "patch",
]);
const JUNCTION_MENSTRUAL_DEVIATIONS = new Set([
  "persistent_intermenstrual_bleeding",
  "prolonged_menstrual_periods",
  "irregular_menstrual_cycles",
  "infrequent_menstrual_cycles",
]);
const JUNCTION_OVULATION_TEST_RESULT_VALUES: Readonly<Record<string, number>> = Object.freeze({
  negative: 0,
  positive: 1,
  luteinizing_hormone_surge: 1,
  estrogen_surge: 1,
});
const JUNCTION_PREGNANCY_TEST_RESULT_VALUES: Readonly<Record<string, number>> = Object.freeze({
  negative: 0,
  positive: 1,
});
const JUNCTION_PROGESTERONE_TEST_RESULT_VALUES: Readonly<Record<string, number>> = Object.freeze({
  negative: 0,
  positive: 1,
});
const JUNCTION_MENSTRUAL_CYCLE_LIMIT = 64;
const JUNCTION_MENSTRUAL_FACT_LIMIT = 512;

type JunctionMenstrualFactKind =
  | "basal_body_temperature"
  | "cervical_mucus"
  | "contraceptive"
  | "detected_deviation"
  | "home_pregnancy_test"
  | "home_progesterone_test"
  | "intermenstrual_bleeding"
  | "menstrual_flow"
  | "ovulation_test"
  | "sexual_activity";

interface JunctionMenstrualFactDraft {
  canonical: boolean;
  date: string;
  kind: JunctionMenstrualFactKind;
  value?: string | number | boolean;
}

interface JunctionMenstrualEvidenceFact extends Omit<JunctionMenstrualFactDraft, "canonical"> {
  cycleRecordHash: string;
}

interface JunctionPreparedMenstrualFact extends JunctionMenstrualEvidenceFact {
  canonical: boolean;
  isPredicted: boolean;
}

interface JunctionPreparedMenstrualCycle {
  entry: PlainObject;
  evidence: PlainObject;
  facts: JunctionPreparedMenstrualFact[];
  isPredicted: boolean;
  originFallback: JunctionOriginFallback;
  recordHash: string;
  sortDate?: string;
}

interface JunctionPreparedMenstrualCycleSummary {
  cycles: JunctionPreparedMenstrualCycle[];
  evidence: PlainObject;
}

function prepareJunctionMenstrualCycleSummary(
  payload: unknown,
  connectionsByKey?: ReadonlyMap<string, PlainObject>,
): JunctionPreparedMenstrualCycleSummary {
  const sortedSourceCycles = resourceEntries(payload, "menstrual_cycle")
    .map(({ entry, originFallback }) => {
      const connection = connectionsByKey
        ? resolveEntryConnection(entry, connectionsByKey)
        : undefined;
      return prepareJunctionMenstrualCycle(
        entry,
        buildJunctionOriginFallback(connection, originFallback),
      );
    })
    .sort(comparePreparedJunctionMenstrualCycles);
  const sourceCyclesByHash = new Map<string, JunctionPreparedMenstrualCycle>();
  for (const cycle of sortedSourceCycles) {
    const existing = sourceCyclesByHash.get(cycle.recordHash);
    if (!existing) {
      sourceCyclesByHash.set(cycle.recordHash, cycle);
      continue;
    }
    existing.facts.push(...cycle.facts);
  }
  const sourceCycles = [...sourceCyclesByHash.values()];
  const admittedCycles = sourceCycles.slice(0, JUNCTION_MENSTRUAL_CYCLE_LIMIT);
  const uniqueFacts = new Map<string, JunctionPreparedMenstrualFact>();

  for (const fact of admittedCycles.flatMap((cycle) => cycle.facts).sort(compareJunctionMenstrualFacts)) {
    const key = junctionMenstrualFactSortKey(fact);
    if (!uniqueFacts.has(key)) {
      uniqueFacts.set(key, fact);
    }
  }

  const allFacts = [...uniqueFacts.values()];
  const admittedFacts = allFacts.slice(0, JUNCTION_MENSTRUAL_FACT_LIMIT);
  const factsByCycle = new Map<string, JunctionPreparedMenstrualFact[]>();
  for (const fact of admittedFacts) {
    const facts = factsByCycle.get(fact.cycleRecordHash) ?? [];
    facts.push(fact);
    factsByCycle.set(fact.cycleRecordHash, facts);
  }

  return {
    cycles: admittedCycles.map((cycle) => ({
      ...cycle,
      facts: factsByCycle.get(cycle.recordHash) ?? [],
    })),
    evidence: {
      schema: "junction.menstrual_cycle_evidence.v1",
      provider: "junction",
      resource: "menstrual_cycle",
      cycleCount: admittedCycles.length,
      factCount: admittedFacts.length,
      omittedCycleCount: Math.max(0, sourceCycles.length - admittedCycles.length),
      omittedFactCount: Math.max(0, allFacts.length - admittedFacts.length),
      cycles: admittedCycles.map((cycle) => ({
        ...cycle.evidence,
        factCount: factsByCycle.get(cycle.recordHash)?.length ?? 0,
      })),
      facts: admittedFacts.map(({ canonical: _canonical, isPredicted: _isPredicted, ...fact }) => fact),
    },
  };
}

function prepareJunctionMenstrualCycle(
  entry: PlainObject,
  originFallback: JunctionOriginFallback,
): JunctionPreparedMenstrualCycle {
  const isPredicted = firstValueFromPaths(entry, ["isPredicted", "is_predicted"]) === true;
  const drafts = collectJunctionMenstrualFactDrafts(entry);
  const origin = resolveJunctionOrigin(entry, originFallback);
  const sourceProviderSlug = origin.sourceProviderSlug;
  const sourceType = origin.sourceType;
  const explicitId = firstStringFromPaths(entry, JUNCTION_GENERIC_SUMMARY_ID_PATHS);
  const periodStart = firstIsoDateFromPaths(entry, ["periodStart", "period_start"]);
  const periodEnd = firstIsoDateFromPaths(entry, ["periodEnd", "period_end"]);
  const cycleEnd = firstIsoDateFromPaths(entry, ["cycleEnd", "cycle_end"]);
  const createdAt = trimOptionalToLength(firstStringFromPaths(entry, ["createdAt", "created_at"]), 80);
  const updatedAt = trimOptionalToLength(firstStringFromPaths(entry, ["updatedAt", "updated_at"]), 80);
  const legacyCycleStart = firstIsoDateFromPaths(entry, ["cycleStart", "cycle_start"]);
  const legacyCycleDay = firstNumberFromPaths(entry, ["cycleDay", "cycle_day"]);
  const legacyPeriodLengthDays = firstNumberFromPaths(entry, ["periodLengthDays", "period_length_days"]);
  const legacyCycleLengthDays = firstNumberFromPaths(entry, ["cycleLengthDays", "cycle_length_days"]);
  const recordHash = shortHash([
    "menstrual-cycle",
    sourceProviderSlug,
    sourceType,
    origin.sourceInstanceId,
    explicitId,
    periodStart,
    periodEnd,
    cycleEnd,
    createdAt,
    updatedAt,
    isPredicted,
    legacyCycleStart,
    legacyCycleDay,
    legacyPeriodLengthDays,
    legacyCycleLengthDays,
  ]);
  const facts = drafts.map((fact) => ({
    ...fact,
    cycleRecordHash: recordHash,
    isPredicted,
  }));
  const evidence = stripUndefined({
    recordHash,
    sourceProviderSlug,
    sourceType,
    isPredicted,
    periodStart,
    periodEnd,
    cycleEnd,
    createdAt,
    updatedAt,
    legacyCycleStart,
    legacyCycleDay,
    legacyPeriodLengthDays,
    legacyCycleLengthDays,
  });
  const scalarEntry = stripUndefined({
    id: explicitId,
    period_start: periodStart,
    period_end: periodEnd,
    cycle_end: cycleEnd,
    created_at: createdAt,
    updated_at: updatedAt,
    is_predicted: isPredicted,
  });

  return {
    entry: scalarEntry,
    evidence,
    facts,
    isPredicted,
    originFallback: { ...origin },
    recordHash,
    sortDate: firstStrictIsoDateFromPaths(entry, [
      "periodStart",
      "period_start",
      "cycleEnd",
      "cycle_end",
      "periodEnd",
      "period_end",
    ]),
  };
}

function collectJunctionMenstrualFactDrafts(entry: PlainObject): JunctionMenstrualFactDraft[] {
  const facts: JunctionMenstrualFactDraft[] = [];
  const pushEnumFacts = (
    paths: readonly string[],
    kind: JunctionMenstrualFactKind,
    valuePaths: readonly string[],
    isCanonical: (value: string) => boolean,
  ): void => {
    for (const sub of junctionDatedEvidenceSubEntries(entry, paths)) {
      const value = normalizeJunctionMenstrualEvidenceLabel(
        firstStringFromPaths(sub.entry, valuePaths),
      );
      if (value) {
        facts.push({
          canonical: isStrictIsoDate(sub.date) && isCanonical(value),
          date: sub.date,
          kind,
          value,
        });
      }
    }
  };

  pushEnumFacts(
    ["menstrualFlow", "menstrual_flow"],
    "menstrual_flow",
    ["flow"],
    (value) => Object.hasOwn(JUNCTION_MENSTRUAL_FLOW_ORDINALS, value),
  );
  pushEnumFacts(
    ["cervicalMucus", "cervical_mucus"],
    "cervical_mucus",
    ["quality"],
    (value) => JUNCTION_CERVICAL_MUCUS_QUALITIES.has(value),
  );
  pushEnumFacts(
    ["contraceptive"],
    "contraceptive",
    ["type"],
    (value) => JUNCTION_CONTRACEPTIVE_TYPES.has(value),
  );
  pushEnumFacts(
    ["detectedDeviations", "detected_deviations"],
    "detected_deviation",
    ["deviation"],
    (value) => JUNCTION_MENSTRUAL_DEVIATIONS.has(value),
  );
  pushEnumFacts(
    ["ovulationTest", "ovulation_test"],
    "ovulation_test",
    ["testResult", "test_result"],
    (value) => Object.hasOwn(JUNCTION_OVULATION_TEST_RESULT_VALUES, value),
  );
  pushEnumFacts(
    ["homePregnancyTest", "home_pregnancy_test"],
    "home_pregnancy_test",
    ["testResult", "test_result"],
    (value) => Object.hasOwn(JUNCTION_PREGNANCY_TEST_RESULT_VALUES, value),
  );
  pushEnumFacts(
    ["homeProgesteroneTest", "home_progesterone_test"],
    "home_progesterone_test",
    ["testResult", "test_result"],
    (value) => Object.hasOwn(JUNCTION_PROGESTERONE_TEST_RESULT_VALUES, value),
  );

  for (const sub of junctionDatedEvidenceSubEntries(entry, ["intermenstrualBleeding", "intermenstrual_bleeding"])) {
    facts.push({
      canonical: isStrictIsoDate(sub.date),
      date: sub.date,
      kind: "intermenstrual_bleeding",
    });
  }
  for (const sub of junctionDatedEvidenceSubEntries(entry, ["basalBodyTemperature", "basal_body_temperature"])) {
    const value = finiteNumber(firstValueFromPaths(sub.entry, ["value"]));
    if (value !== undefined) {
      facts.push({ canonical: false, date: sub.date, kind: "basal_body_temperature", value });
    }
  }
  for (const sub of junctionDatedEvidenceSubEntries(entry, ["sexualActivity", "sexual_activity"])) {
    const rawProtectionUsed = firstValueFromPaths(sub.entry, ["protectionUsed", "protection_used"]);
    if (rawProtectionUsed === undefined || rawProtectionUsed === null || typeof rawProtectionUsed === "boolean") {
      facts.push(stripUndefined({
        canonical: isStrictIsoDate(sub.date),
        date: sub.date,
        kind: "sexual_activity" as const,
        value: typeof rawProtectionUsed === "boolean" ? rawProtectionUsed : undefined,
      }));
      continue;
    }

    const invalidValue = normalizeJunctionMenstrualEvidenceLabel(String(rawProtectionUsed));
    if (invalidValue) {
      facts.push({
        canonical: false,
        date: sub.date,
        kind: "sexual_activity",
        value: invalidValue,
      });
    }
  }

  return facts;
}

function comparePreparedJunctionMenstrualCycles(
  left: JunctionPreparedMenstrualCycle,
  right: JunctionPreparedMenstrualCycle,
): number {
  return Number(left.isPredicted) - Number(right.isPredicted)
    || compareNewestOptionalIsoDates(left.sortDate, right.sortDate)
    || left.recordHash.localeCompare(right.recordHash);
}

function compareJunctionMenstrualFacts(
  left: JunctionPreparedMenstrualFact,
  right: JunctionPreparedMenstrualFact,
): number {
  return Number(left.isPredicted) - Number(right.isPredicted)
    || Number(!left.canonical) - Number(!right.canonical)
    || compareNewestOptionalIsoDates(
      isStrictIsoDate(left.date) ? left.date : undefined,
      isStrictIsoDate(right.date) ? right.date : undefined,
    )
    || junctionMenstrualFactSortKey(left).localeCompare(junctionMenstrualFactSortKey(right));
}

function compareNewestOptionalIsoDates(
  left: string | undefined,
  right: string | undefined,
): number {
  if (left && right) {
    return right.localeCompare(left);
  }
  return left ? -1 : right ? 1 : 0;
}

function junctionMenstrualFactSortKey(fact: JunctionMenstrualEvidenceFact): string {
  return JSON.stringify([
    fact.cycleRecordHash,
    fact.date,
    fact.kind,
    fact.value ?? null,
  ]);
}

function normalizeJunctionMenstrualEvidenceLabel(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized ? trimToLength(normalized, 80) : undefined;
}

// One Junction menstrual cycle summary per cycle (~13/year). The caller has
// already selected the deterministic admitted flat fact set. Predicted cycles
// are upstream forecasts, not canonical facts.
function pushMenstrualCycleSummary(
  cycle: JunctionPreparedMenstrualCycle,
  resourceContext: ResourceContext,
  context: NormalizationContext,
): void {
  if (cycle.isPredicted) {
    return;
  }

  const entry = cycle.entry;
  const baseTimestamp = resolveRecordTimestamp(entry, context, resourceContext.sourceProviderSlug);
  const periodStart = firstStrictIsoDateFromPaths(entry, ["periodStart", "period_start"]);
  const periodEnd = firstStrictIsoDateFromPaths(entry, ["periodEnd", "period_end"]);
  const cycleEnd = firstStrictIsoDateFromPaths(entry, ["cycleEnd", "cycle_end"]);
  const facetCounts = new Map<string, number>();
  const nextDailyFacet = (prefix: string, date: string): string => {
    const key = `${prefix}\u0000${date}`;
    const ordinal = (facetCounts.get(key) ?? 0) + 1;
    facetCounts.set(key, ordinal);
    return `${prefix}-${date}-${ordinal}`;
  };

  if (periodStart) {
    const cycleTimestamp = junctionDateOnlyTimestamp(baseTimestamp, periodStart);
    // Junction currently documents period_start, period_end, and cycle_end.
    // Legacy cycle_start and scalar length aliases remain evidence-only.
    const cycleObservations = [
      {
        metric: "period-length-days",
        title: "Junction period length",
        value: inclusiveDaysBetween(periodStart, periodEnd),
      },
      {
        metric: "cycle-length-days",
        title: "Junction cycle length",
        value: inclusiveDaysBetween(periodStart, cycleEnd),
      },
    ];

    for (const observation of cycleObservations) {
      if (observation.value === undefined) {
        continue;
      }

      context.events.push(stripUndefined({
        kind: "observation",
        occurredAt: cycleTimestamp.occurredAt,
        recordedAt: cycleTimestamp.recordedAt,
        dayKey: cycleTimestamp.dayKey,
        source: "device",
        title: observation.title,
        evidenceRoles: resourceContext.evidenceRoles,
        externalRef: makeJunctionExternalRef(resourceContext, entry, cycleTimestamp, observation.metric),
        dataOrigin: buildDataOrigin(entry, resourceContext, cycleTimestamp),
        fields: {
          metric: observation.metric,
          observationGrain: "summary",
          value: observation.value,
          unit: "days",
        },
      }));
    }
  }

  // Basal temperature stays evidence-only here because the dedicated sparse
  // daily resource is its canonical owner. Every other event is emitted from
  // the same admitted fact used by bounded evidence and receipt hashing.
  for (const fact of cycle.facts) {
    if (!fact.canonical || fact.kind === "basal_body_temperature") {
      continue;
    }

    const value = typeof fact.value === "string" ? fact.value : undefined;
    let input: Parameters<typeof pushJunctionCycleDailyMeasurement>[4] | undefined;
    switch (fact.kind) {
      case "menstrual_flow": {
        const ordinal = value ? JUNCTION_MENSTRUAL_FLOW_ORDINALS[value] : undefined;
        if (value && ordinal !== undefined) {
          input = {
            date: fact.date,
            facet: nextDailyFacet("menstrual-flow", fact.date),
            measurement: { metric: "menstrual-flow", value: ordinal, unit: "score", qualifiers: { flow: value } },
            title: "Junction menstrual flow",
          };
        }
        break;
      }
      case "ovulation_test":
      case "home_pregnancy_test":
      case "home_progesterone_test": {
        const definition = fact.kind === "ovulation_test"
          ? { metric: "ovulation-test", title: "Junction ovulation test", values: JUNCTION_OVULATION_TEST_RESULT_VALUES }
          : fact.kind === "home_pregnancy_test"
            ? { metric: "pregnancy-test", title: "Junction pregnancy test", values: JUNCTION_PREGNANCY_TEST_RESULT_VALUES }
            : { metric: "progesterone-test", title: "Junction progesterone test", values: JUNCTION_PROGESTERONE_TEST_RESULT_VALUES };
        const ordinal = value ? definition.values[value] : undefined;
        if (value && ordinal !== undefined) {
          input = {
            date: fact.date,
            facet: nextDailyFacet(definition.metric, fact.date),
            measurement: { metric: definition.metric, value: ordinal, unit: "result", qualifiers: { result: value } },
            title: definition.title,
          };
        }
        break;
      }
      case "cervical_mucus":
        if (value) {
          input = {
            date: fact.date,
            facet: nextDailyFacet("cervical-mucus", fact.date),
            measurement: { metric: "cervical-mucus", value: 1, unit: "observation", qualifiers: { quality: value } },
            title: "Junction cervical mucus",
          };
        }
        break;
      case "intermenstrual_bleeding":
        input = {
          date: fact.date,
          facet: nextDailyFacet("intermenstrual-bleeding", fact.date),
          measurement: { metric: "intermenstrual-bleeding", value: 1, unit: "event", qualifiers: { bleeding: "intermenstrual" } },
          title: "Junction intermenstrual bleeding",
        };
        break;
      case "contraceptive":
        if (value) {
          input = {
            date: fact.date,
            facet: nextDailyFacet("contraceptive", fact.date),
            measurement: { metric: "contraceptive-use", value: 1, unit: "event", qualifiers: { type: value } },
            title: "Junction contraceptive use",
          };
        }
        break;
      case "sexual_activity":
        input = {
          date: fact.date,
          facet: nextDailyFacet("sexual-activity", fact.date),
          measurement: {
            metric: "sexual-activity",
            value: 1,
            unit: "event",
            qualifiers: typeof fact.value === "boolean" ? { "protection-used": fact.value } : {},
          },
          title: "Junction sexual activity",
        };
        break;
      case "detected_deviation":
        if (value) {
          input = {
            date: fact.date,
            facet: nextDailyFacet("menstrual-cycle-deviation", fact.date),
            measurement: { metric: "menstrual-cycle-deviation", value: 1, unit: "flag", qualifiers: { deviation: value } },
            title: "Junction cycle deviation",
          };
        }
        break;
    }

    if (input) {
      pushJunctionCycleDailyMeasurement(entry, resourceContext, context, baseTimestamp, input);
    }
  }
}

interface JunctionDatedSubEntry {
  date: string;
  entry: PlainObject;
}

function junctionDatedSubEntries(entry: PlainObject, paths: readonly string[]): JunctionDatedSubEntry[] {
  return junctionDatedEvidenceSubEntries(entry, paths).filter((subEntry) =>
    isStrictIsoDate(subEntry.date)
  );
}

function junctionDatedEvidenceSubEntries(
  entry: PlainObject,
  paths: readonly string[],
): JunctionDatedSubEntry[] {
  const subEntries: JunctionDatedSubEntry[] = [];

  for (const value of asArray(firstValueFromPaths(entry, paths))) {
    const subEntry = asPlainObject(value);
    const date = trimOptionalToLength(
      subEntry ? firstStringFromPaths(subEntry, ["date"]) : undefined,
      40,
    );
    if (subEntry && date) {
      subEntries.push({ date, entry: subEntry });
    }
  }

  return subEntries;
}

function pushJunctionCycleDailyMeasurement(
  entry: PlainObject,
  resourceContext: ResourceContext,
  context: NormalizationContext,
  baseTimestamp: ReturnType<typeof resolveRecordTimestamp>,
  input: {
    date: string;
    facet: string;
    measurement: {
      metric: string;
      value: number;
      unit: string;
      qualifiers: Record<string, string | boolean>;
    };
    title: string;
  },
): void {
  const timestamp = junctionDateOnlyTimestamp(baseTimestamp, input.date);

  context.events.push(stripUndefined({
    kind: "measurement",
    occurredAt: timestamp.occurredAt,
    recordedAt: timestamp.recordedAt,
    dayKey: timestamp.dayKey,
    source: "device",
    title: input.title,
    evidenceRoles: resourceContext.evidenceRoles,
    externalRef: makeJunctionExternalRef(resourceContext, entry, timestamp, input.facet),
    dataOrigin: buildDataOrigin(entry, resourceContext, timestamp),
    fields: {
      measurements: [input.measurement],
    },
  }));
}

function junctionDateOnlyTimestamp(
  baseTimestamp: ReturnType<typeof resolveRecordTimestamp>,
  date: string,
): ReturnType<typeof resolveRecordTimestamp> {
  return withTimestampOverride(baseTimestamp, {
    occurredAt: `${date}T00:00:00.000Z`,
    recordedAt: baseTimestamp.recordedAt ?? `${date}T00:00:00.000Z`,
    dayKey: date,
    observedAtRaw: date,
  });
}

function inclusiveDaysBetween(startDate: string, endDate: string | undefined): number | undefined {
  if (!endDate) {
    return undefined;
  }

  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return undefined;
  }

  const days = Math.round((end - start) / 86_400_000) + 1;
  return days >= 1 && days <= 120 ? days : undefined;
}

// One Junction ECG summary per recording, dozens-to-hundreds of sub-KB rows
// per member-year (docs.junction.com/api-reference/data/electrocardiogram/get-summary).
// The recording lands as one measurement event carrying the classification as
// a qualifier; the electrocardiogram_voltage waveform stays excluded.
function pushElectrocardiogramSummary(
  entry: PlainObject,
  resourceContext: ResourceContext,
  context: NormalizationContext,
): void {
  const baseTimestamp = resolveRecordTimestamp(entry, context, resourceContext.sourceProviderSlug);
  const sessionStartRaw = firstValueFromPaths(entry, ["sessionStart", "session_start"]);
  const sessionStart = resolveSafeTimestamp(sessionStartRaw, resourceContext.sourceProviderSlug);
  // A recording is a point-in-time clinical fact: without a valid
  // session_start the row stays raw-only rather than inheriting a
  // sync-window/import-time fallback that would invent the recording
  // moment (and let the externalRef drift with the fetch window).
  const occurredAt = sessionStart;

  if (!occurredAt) {
    return;
  }

  const timestamp = withTimestampOverride(baseTimestamp, {
    occurredAt,
    dayKey: extractIsoDatePrefix(occurredAt) ?? baseTimestamp.dayKey,
    observedAtRaw: stringId(sessionStartRaw) ?? baseTimestamp.observedAtRaw ?? occurredAt,
  });
  const classification = trimOptionalToLength(firstStringFromPaths(entry, ["classification"]), 80);
  const inconclusiveCause = trimOptionalToLength(
    firstStringFromPaths(entry, ["inconclusiveCause", "inconclusive_cause"]),
    80,
  );
  const heartRateMeanRaw = firstNonNegativeNumberFromPaths(entry, ["heartRateMean", "heart_rate_mean"]);
  // Plausibility window matching the other vitals in this stack: ECG mean HR
  // outside 20-300 bpm is sensor noise, not a reading.
  const heartRateMean = heartRateMeanRaw !== undefined && heartRateMeanRaw >= 20 && heartRateMeanRaw <= 300
    ? heartRateMeanRaw
    : undefined;
  const sampleCount = firstNonNegativeNumberFromPaths(entry, ["voltageSampleCount", "voltage_sample_count"]);
  const qualifiers = stripUndefined({
    classification,
    "inconclusive-cause": inconclusiveCause,
  });
  const measurementBase = Object.keys(qualifiers).length > 0 ? { qualifiers } : {};
  const numericMeasurements = [
    ...(heartRateMean !== undefined
      ? [{ metric: "ecg-heart-rate-mean", value: heartRateMean, unit: "bpm", ...measurementBase }]
      : []),
    ...(sampleCount !== undefined
      ? [{ metric: "ecg-voltage-sample-count", value: sampleCount, unit: "count", ...measurementBase }]
      : []),
  ];
  // A classification with no surviving numeric metrics is still the
  // clinically meaningful fact of the recording (the backfill completion
  // predicate already treats classification as useful evidence): land it as
  // a categorical recording flag (menstrual deviation pattern) instead of
  // silently leaving the record raw-only.
  const measurements = numericMeasurements.length > 0
    ? numericMeasurements
    : classification !== undefined
      ? [{ metric: "ecg-recording", value: 1, unit: "recording", ...measurementBase }]
      : [];

  if (measurements.length === 0) {
    return;
  }

  context.events.push(stripUndefined({
    kind: "measurement",
    occurredAt,
    recordedAt: timestamp.recordedAt,
    dayKey: timestamp.dayKey,
    timeZone: firstStringFromPaths(entry, ["timeZone", "timezone", "time_zone"]),
    source: "device",
    title: classification ? `Junction ECG (${classification.replaceAll("_", " ")})` : "Junction ECG",
    evidenceRoles: resourceContext.evidenceRoles,
    externalRef: makeJunctionExternalRef(resourceContext, entry, timestamp, "ecg-recording"),
    dataOrigin: buildDataOrigin(entry, resourceContext, timestamp),
    fields: {
      measurements,
    },
  }));
}

function resolveJunctionMealTimestamp(
  entry: PlainObject,
  context: Pick<NormalizationContext, "importedAt" | "windowEnd" | "windowStart">,
  sourceProviderSlug: string | undefined,
): { occurredAt: string; timestamp: ReturnType<typeof resolveRecordTimestamp> } | null {
  const timestamp = resolveRecordTimestamp(entry, context, sourceProviderSlug);
  const calendarDayKey = firstIsoDateFromPaths(entry, JUNCTION_MEAL_CALENDAR_DATE_PATHS);
  const calendarOccurredAt = calendarDayKey ? `${calendarDayKey}T00:00:00.000Z` : undefined;
  const shouldUseCalendarOccurredAt = Boolean(
    calendarOccurredAt
      && (
        !timestamp.observedAtRaw
        || timestamp.timestampSemantics === "floating"
        || isDateOnlyJunctionTimestamp(timestamp.observedAtRaw)
      ),
  );
  const occurredAt = shouldUseCalendarOccurredAt
    ? calendarOccurredAt
    : timestamp.occurredAt ?? calendarOccurredAt;

  if (!occurredAt) {
    return null;
  }

  return {
    occurredAt,
    timestamp: withTimestampOverride(timestamp, {
      occurredAt,
      dayKey: calendarDayKey ?? timestamp.dayKey,
      observedAtRaw: timestamp.observedAtRaw ?? calendarDayKey ?? occurredAt,
    }),
  };
}

function resolveJunctionMealTitle(entry: PlainObject): string {
  const title = trimOptionalToLength(
    firstStringFromPaths(entry, JUNCTION_MEAL_TITLE_PATHS),
    160,
  );
  return title || "Junction meal";
}

function buildJunctionMealId(
  resourceContext: ResourceContext,
  entry: PlainObject,
  timestamp: ReturnType<typeof resolveRecordTimestamp>,
): string {
  const explicitId = firstStringFromPaths(entry, JUNCTION_MEAL_STABLE_ID_PATHS);
  const identity = explicitId
    ? [
        "junction-meal",
        resourceContext.sourceProviderSlug,
        resourceContext.origin.sourceType ?? null,
        resourceContext.origin.sourceInstanceId ?? null,
        explicitId,
      ]
    : buildJunctionMealFallbackIdentityParts(resourceContext, entry, timestamp);

  return buildJunctionDeterministicContractId(
    ID_PREFIXES.meal,
    JSON.stringify(identity),
  );
}

function buildJunctionDeterministicContractId(prefix: string, seed: string): string {
  const bytes = createHash("sha256").update(seed).digest();
  let output = "";
  let buffer = 0;
  let bits = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;

    while (bits >= 5 && output.length < 26) {
      bits -= 5;
      output += JUNCTION_CONTRACT_ID_CROCKFORD_BASE32_ALPHABET[(buffer >> bits) & 31];
    }
  }

  if (bits > 0 && output.length < 26) {
    output += JUNCTION_CONTRACT_ID_CROCKFORD_BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  }

  return `${prefix}_${output.padEnd(26, "0").slice(0, 26)}`;
}

function buildJunctionMealFallbackIdentityParts(
  resourceContext: ResourceContext,
  entry: PlainObject,
  timestamp: ReturnType<typeof resolveRecordTimestamp>,
  options: { includeDisambiguator?: boolean } = {},
): unknown[] {
  return [
    "junction-meal",
    resourceContext.sourceProviderSlug,
    resourceContext.origin.sourceType ?? null,
    resourceContext.origin.sourceInstanceId ?? null,
    timestamp.observedAtRaw ?? timestamp.occurredAt ?? null,
    resolveJunctionMealTitle(entry),
    ...(
      options.includeDisambiguator === false || !resourceContext.fallbackIdentityDisambiguator
        ? []
        : [resourceContext.fallbackIdentityDisambiguator]
    ),
  ];
}

function buildJunctionMealNutrition(
  entry: PlainObject,
  resourceContext: ResourceContext,
  foodItems: readonly JunctionMealFoodItem[],
): MealNutrition | undefined {
  const itemEntries = foodItems.map((item) => item.entry);
  const itemTotals = sumJunctionMealNutritionTotals(itemEntries);
  const directTotals = readJunctionMealNutritionData(entry);
  const totals = mergeJunctionMealNutritionTotals(itemTotals, directTotals);
  const micros = mergeJunctionMealMicros(
    sumJunctionMealMicros(itemEntries),
    readJunctionMealMicros(entry),
  );

  if (!totals && !micros) {
    return undefined;
  }

  const provenance: MealNutrition["provenance"] = {
    source: "database",
    confidence: "high",
    sourceDetail: trimToLength(`junction:${resourceContext.sourceProviderSlug}:meal`, 240),
  };

  return stripUndefined({
    totals,
    micros,
    provenance,
  });
}

// Micronutrients land bounded and compactly: only the documented Junction
// micro keys are read, and null/zero entries are skipped.
function readJunctionMealMicros(entry: PlainObject): Partial<MealMicronutrients> | undefined {
  const micros: Partial<MealMicronutrients> = {};

  for (const key of MEAL_MICRONUTRIENT_KEYS) {
    const value = roundMealNutritionValue(finiteNumber(readPath(entry, JUNCTION_MEAL_MICRO_PATHS[key])));
    if (value !== undefined && value > 0) {
      micros[key] = value;
    }
  }

  return Object.keys(micros).length > 0 ? micros : undefined;
}

function sumJunctionMealMicros(
  entries: readonly PlainObject[],
): Partial<MealMicronutrients> | undefined {
  const totals: Partial<MealMicronutrients> = {};

  for (const entry of entries) {
    const micros = readJunctionMealMicros(entry);
    for (const [key, value] of Object.entries(micros ?? {}) as Array<[MealMicronutrientKey, number]>) {
      totals[key] = roundMealNutritionValue((totals[key] ?? 0) + value) ?? value;
    }
  }

  return Object.keys(totals).length > 0 ? totals : undefined;
}

function mergeJunctionMealMicros(
  itemMicros: Partial<MealMicronutrients> | undefined,
  directMicros: Partial<MealMicronutrients> | undefined,
): MealMicronutrients | undefined {
  const micros: Partial<MealMicronutrients> = {};

  for (const key of MEAL_MICRONUTRIENT_KEYS) {
    const value = directMicros?.[key] ?? itemMicros?.[key];
    if (value !== undefined) {
      micros[key] = value;
    }
  }

  return Object.keys(micros).length > 0 ? micros : undefined;
}

interface JunctionMealFoodItem {
  readonly entry: PlainObject;
  readonly name?: string;
}

function listJunctionMealFoodItems(entry: PlainObject): JunctionMealFoodItem[] {
  for (const path of JUNCTION_MEAL_ITEM_CONTAINER_PATHS) {
    const value = readPath(entry, path);
    const items = value === undefined || value === entry ? [] : collectJunctionMealFoodItems(value);
    if (items.length > 0) {
      return items;
    }
  }

  return [];
}

function collectJunctionMealFoodItems(
  value: unknown,
  fallbackName?: string,
): JunctionMealFoodItem[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectJunctionMealFoodItems(entry, fallbackName));
  }

  const entry = asPlainObject(value);
  if (!entry) {
    return [];
  }

  const name = firstStringFromPaths(entry, JUNCTION_MEAL_ITEM_NAME_PATHS) ?? fallbackName;
  if (isJunctionMealNutritionItem(entry)) {
    return [stripUndefined({ entry, name }) as JunctionMealFoodItem];
  }

  return Object.entries(entry).flatMap(([key, nested]) => collectJunctionMealFoodItems(nested, key));
}

function isJunctionMealNutritionItem(entry: PlainObject): boolean {
  return Boolean(
    asPlainObject(readPath(entry, "energy"))
    || asPlainObject(readPath(entry, "macros"))
    || asPlainObject(readPath(entry, "micros"))
    || readJunctionMealNutritionData(entry),
  );
}

function buildJunctionMealIngredients(
  entry: PlainObject,
  foodItems: readonly JunctionMealFoodItem[],
): string[] | undefined {
  const candidates = [
    ...foodItems.map((item) => item.name ?? firstStringFromPaths(item.entry, JUNCTION_MEAL_ITEM_NAME_PATHS)),
    ...listJunctionMealIngredientNames(entry),
    ...firstStringArrayFromPaths(entry, JUNCTION_MEAL_INGREDIENT_LIST_PATHS),
  ];
  const ingredients: string[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const ingredient = trimOptionalToLength(candidate, 4000);
    const dedupeKey = ingredient?.toLowerCase();
    if (!ingredient || !dedupeKey || seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    ingredients.push(ingredient);
    if (ingredients.length >= 100) {
      break;
    }
  }

  return ingredients.length > 0 ? ingredients : undefined;
}

function listJunctionMealIngredientNames(entry: PlainObject): string[] {
  const names: string[] = [];

  for (const path of JUNCTION_MEAL_ITEM_CONTAINER_PATHS) {
    const value = readPath(entry, path);
    if (value === undefined || value === entry) {
      continue;
    }

    names.push(...collectJunctionMealIngredientNames(value));
  }

  return names;
}

function collectJunctionMealIngredientNames(value: unknown, fallbackName?: string): string[] {
  const valueId = typeof value === "string" ? stringId(value) : undefined;
  if (valueId) {
    return [valueId];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectJunctionMealIngredientNames(entry, fallbackName));
  }

  const entry = asPlainObject(value);
  if (!entry) {
    return [];
  }

  const name = firstStringFromPaths(entry, JUNCTION_MEAL_ITEM_NAME_PATHS);
  if (name) {
    return [name];
  }

  if (fallbackName && isJunctionMealNutritionItem(entry)) {
    return [fallbackName];
  }

  return Object.entries(entry).flatMap(([key, nested]) => {
    if (!Array.isArray(nested) && !asPlainObject(nested)) {
      return [];
    }

    return collectJunctionMealIngredientNames(nested, key);
  });
}

function sumJunctionMealNutritionTotals(
  entries: readonly PlainObject[],
): MealNutritionTotals | undefined {
  const totals: Partial<MealNutritionTotals> = {};

  for (const entry of entries) {
    const nutrition = readJunctionMealNutritionData(entry);
    if (!nutrition) {
      continue;
    }

    for (const key of JUNCTION_MEAL_NUTRITION_TOTAL_KEYS) {
      addJunctionMealNutritionValue(totals, key, nutrition[key]);
    }
  }

  return mealNutritionTotalsOrUndefined(totals);
}

function readJunctionMealNutritionData(entry: PlainObject): MealNutritionTotals | undefined {
  const totals: Partial<MealNutritionTotals> = {};

  addJunctionMealNutritionValue(totals, "calories", readJunctionMealCalories(entry));
  addJunctionMealNutritionValue(totals, "proteinGrams", firstNonNegativeNumberFromPaths(entry, JUNCTION_MEAL_PROTEIN_GRAM_PATHS));
  addJunctionMealNutritionValue(totals, "carbsGrams", firstNonNegativeNumberFromPaths(entry, JUNCTION_MEAL_CARBS_GRAM_PATHS));
  addJunctionMealNutritionValue(totals, "fatGrams", firstNonNegativeNumberFromPaths(entry, JUNCTION_MEAL_FAT_GRAM_PATHS));
  addJunctionMealNutritionValue(totals, "fiberGrams", firstNonNegativeNumberFromPaths(entry, JUNCTION_MEAL_FIBER_GRAM_PATHS));
  addJunctionMealNutritionValue(totals, "waterGrams", firstNonNegativeNumberFromPaths(entry, JUNCTION_MEAL_WATER_GRAM_PATHS));

  return mealNutritionTotalsOrUndefined(totals);
}

function mergeJunctionMealNutritionTotals(
  itemTotals: MealNutritionTotals | undefined,
  directTotals: MealNutritionTotals | undefined,
): MealNutritionTotals | undefined {
  const totals: Partial<MealNutritionTotals> = {};

  for (const key of JUNCTION_MEAL_NUTRITION_TOTAL_KEYS) {
    addJunctionMealNutritionValue(totals, key, directTotals?.[key] ?? itemTotals?.[key]);
  }

  return mealNutritionTotalsOrUndefined(totals);
}

function mealNutritionTotalsOrUndefined(
  totals: Partial<MealNutritionTotals>,
): MealNutritionTotals | undefined {
  return Object.keys(totals).length > 0 ? totals : undefined;
}

function addJunctionMealNutritionValue(
  totals: Partial<MealNutritionTotals>,
  key: MealNutritionTotalKey,
  value: number | undefined,
): void {
  if (value === undefined) {
    return;
  }

  totals[key] = roundMealNutritionValue((totals[key] ?? 0) + value);
}

function readJunctionMealCalories(entry: PlainObject): number | undefined {
  const directCalories = firstNonNegativeNumberFromPaths(entry, JUNCTION_MEAL_CALORIE_PATHS);
  if (directCalories !== undefined) {
    return roundMealNutritionValue(directCalories);
  }

  const energyValue = firstNonNegativeNumberFromPaths(entry, JUNCTION_MEAL_ENERGY_VALUE_PATHS);
  if (energyValue === undefined) {
    return undefined;
  }

  const unit = firstStringFromPaths(entry, JUNCTION_MEAL_ENERGY_UNIT_PATHS);
  if (!unit || isJunctionKilocalorieUnit(unit)) {
    return roundMealNutritionValue(energyValue);
  }

  if (isJunctionKilojouleUnit(unit)) {
    return roundMealNutritionValue(kilojoulesToKilocalories(energyValue));
  }

  return undefined;
}

function buildWorkoutSessionMetrics(entry: PlainObject): WorkoutSessionMetrics | undefined {
  const metrics: WorkoutSessionMetrics = {};

  for (const { key, nonnegative, paths } of WORKOUT_SESSION_METRICS) {
    const rawValue = firstNumberFromPaths(entry, paths);
    const value = nonnegative ? normalizeNonNegativeNumber(rawValue) : rawValue;
    if (value !== undefined) {
      metrics[key] = value;
    }
  }

  return Object.keys(metrics).length > 0 ? metrics : undefined;
}

function resolveWorkoutMovingTimeMinutes(entry: PlainObject): number | undefined {
  return normalizePositiveIntegerMinutes(
    firstNumberFromPaths(entry, ["movingTimeMinutes", "moving_time_minutes"]),
  ) ??
    normalizePositiveIntegerMinutes(
      secondsToMinutes(firstNumberFromPaths(entry, ["movingTime", "moving_time"])),
    ) ??
    normalizePositiveIntegerMinutes(
      millisecondsToMinutes(firstNumberFromPaths(entry, ["movingTimeMillis", "moving_time_millis"])),
    );
}

function buildWorkoutHeartRateZones(entry: PlainObject): WorkoutHeartRateZone[] | undefined {
  const source = firstValueFromPaths(entry, [
    "heartRateZones",
    "heart_rate_zones",
    "hrZones",
    "hr_zones",
    "heart_rate.zones",
    "zones.heart_rate",
  ]);
  const zones = normalizeWorkoutHeartRateZoneSource(source);
  const boundedZones = zones.slice(0, 20);

  return boundedZones.length > 0 ? boundedZones : undefined;
}

function normalizeWorkoutHeartRateZoneSource(source: unknown): WorkoutHeartRateZone[] {
  if (Array.isArray(source)) {
    return source.flatMap((entry, index) => {
      const numeric = finiteNumber(entry);
      const zone = asPlainObject(entry) ?? (numeric !== undefined ? { zone: index, duration: entry } : null);
      const normalized = zone ? normalizeWorkoutHeartRateZone(zone, index) : undefined;
      return normalized ? [normalized] : [];
    });
  }

  const record = asPlainObject(source);
  if (!record) {
    return [];
  }

  return Object.entries(record).flatMap(([label, value], index) => {
    const zoneRecord = asPlainObject(value) ?? { duration: value };
    const normalized = normalizeWorkoutHeartRateZone(zoneRecord, index, label);
    return normalized ? [normalized] : [];
  });
}

function normalizeWorkoutHeartRateZone(
  entry: PlainObject,
  index: number,
  fallbackLabel?: string,
): WorkoutHeartRateZone | undefined {
  const label = trimOptionalToLength(
    firstStringFromPaths(entry, ["label", "name", "zoneName", "zone_name"]) ?? fallbackLabel,
    80,
  );
  const minHeartRate = normalizeNonNegativeNumber(
    firstNumberFromPaths(entry, ["minHeartRate", "min_heart_rate", "minBpm", "min_bpm", "min"]),
  );
  const maxHeartRate = normalizeNonNegativeNumber(
    firstNumberFromPaths(entry, ["maxHeartRate", "max_heart_rate", "maxBpm", "max_bpm", "max"]),
  );
  const durationMinutes = firstNonNegativeMinutesFromPaths(entry, {
    minutePaths: ["durationMinutes", "duration_minutes", "minutes", "timeMinutes", "time_minutes"],
    secondPaths: ["durationSeconds", "duration_seconds", "seconds", "time", "duration"],
    millisecondPaths: ["durationMillis", "duration_millis", "milliseconds"],
  });

  if (label === undefined && minHeartRate === undefined && maxHeartRate === undefined && durationMinutes === undefined) {
    return undefined;
  }

  return stripUndefined({
    zone: readWorkoutHeartRateZoneNumber(entry, fallbackLabel, index),
    label,
    minHeartRate,
    maxHeartRate,
    durationMinutes,
  });
}

function readWorkoutHeartRateZoneNumber(
  entry: PlainObject,
  fallbackLabel: string | undefined,
  index: number,
): number | undefined {
  const explicit = firstNumberFromPaths(entry, ["zone", "zoneIndex", "zone_index", "index"]);
  if (explicit !== undefined && Number.isInteger(explicit) && explicit >= 0 && explicit <= 20) {
    return explicit;
  }

  const zoneLabel = firstStringFromPaths(entry, ["zone", "zoneName", "zone_name", "label", "name"]) ?? fallbackLabel;
  const labelMatch = zoneLabel ? /(\d+)/u.exec(zoneLabel) : null;
  const parsedLabel = labelMatch ? Number(labelMatch[1]) : undefined;
  if (parsedLabel !== undefined && Number.isInteger(parsedLabel) && parsedLabel >= 0 && parsedLabel <= 20) {
    return parsedLabel;
  }

  return Math.min(index + 1, 20);
}

function buildWorkoutRouteMetadata(entry: PlainObject): WorkoutRouteMetadata | undefined {
  const route = stripUndefined({
    routeId: trimOptionalToLength(
      firstStringFromPaths(entry, ["routeId", "route_id", "route.id", "route.providerId", "route.provider_id"]),
      200,
    ),
    routeName: trimOptionalToLength(
      firstStringFromPaths(entry, ["routeName", "route_name", "route.name"]),
      160,
    ),
    mapId: trimOptionalToLength(
      firstStringFromPaths(entry, ["mapId", "map_id", "map.id", "map.providerId", "map.provider_id"]),
      200,
    ),
  });

  return Object.keys(route).length > 0 ? route : undefined;
}

function pushObservationMetrics(
  entry: PlainObject,
  resourceContext: ResourceContext,
  context: NormalizationContext,
  metrics: readonly MetricDescriptor[],
  timestampOverride?: ReturnType<typeof resolveRecordTimestamp>,
): void {
  const timestamp = timestampOverride ?? resolveRecordTimestamp(entry, context, resourceContext.sourceProviderSlug);
  const occurredAt = timestamp.occurredAt;

  if (!occurredAt) {
    return;
  }

  for (const metric of metrics) {
    const resolved = resolveMetricDescriptorValue(entry, metric);
    if (!resolved) {
      continue;
    }

    const metricKey = resolveJunctionHrvMetric(
      metric.metric,
      resourceContext.sourceProviderSlug,
    );
    context.events.push(stripUndefined({
      kind: "observation",
      occurredAt,
      recordedAt: timestamp.recordedAt,
      dayKey: timestamp.dayKey,
      timeZone: firstStringFromPaths(entry, ["timeZone", "timezone", "time_zone"]),
      source: "device",
      title: resolveJunctionHrvTitle(metricKey, metric.title),
      evidenceRoles: resourceContext.evidenceRoles,
      // Keep the pre-separation provider identity facet so a re-import
      // supersedes an existing generic Apple HRV event instead of duplicating
      // it under the corrected SDNN metric.
      externalRef: makeJunctionExternalRef(resourceContext, entry, timestamp, metric.metric),
      dataOrigin: buildDataOrigin(entry, resourceContext, timestamp),
      fields: {
        metric: metricKey,
        observationGrain: "summary",
        value: resolved.value,
        unit: resolved.unit,
      },
    }));
  }
}

function resolveJunctionHrvMetric(metric: string, sourceProviderSlug: string): string {
  if (metric !== "hrv") {
    return metric;
  }

  return normalizeJunctionSourceProviderSlug(sourceProviderSlug)
      === APPLE_HEALTH_KIT_SOURCE_PROVIDER_SLUG
    ? HRV_SDNN_METRIC
    : metric;
}

function resolveJunctionHrvTitle(metric: string, fallback: string): string {
  return metric === HRV_SDNN_METRIC ? "Apple Health HRV (SDNN)" : fallback;
}

function pushJunctionRecoveryReadinessScore(
  entry: PlainObject,
  resourceContext: ResourceContext,
  context: NormalizationContext,
  timestampOverride?: ReturnType<typeof resolveRecordTimestamp>,
): void {
  const value = firstNumberFromPaths(entry, ["recoveryReadinessScore", "recovery_readiness_score"]);
  if (value === undefined) {
    return;
  }

  const timestamp = timestampOverride ?? resolveRecordTimestamp(entry, context, resourceContext.sourceProviderSlug);
  if (!timestamp.occurredAt) {
    return;
  }

  const metric = resourceContext.sourceProviderSlug === "oura" ? "readiness-score" : "recovery-score";
  context.events.push(stripUndefined({
    kind: "observation",
    occurredAt: timestamp.occurredAt,
    recordedAt: timestamp.recordedAt,
    dayKey: timestamp.dayKey,
    timeZone: firstStringFromPaths(entry, ["timeZone", "timezone", "time_zone"]),
    source: "device",
    title: "Junction recovery readiness score",
    evidenceRoles: resourceContext.evidenceRoles,
    externalRef: makeJunctionExternalRef(resourceContext, entry, timestamp, metric),
    dataOrigin: buildDataOrigin(entry, resourceContext, timestamp),
    fields: {
      metric,
      observationGrain: "summary",
      value,
      unit: "%",
    },
  }));
}

function resolveMetricDescriptorValue(
  entry: PlainObject,
  metric: MetricDescriptor,
): { value: number; unit: string } | null {
  const computedValue = metric.value ? finiteNumber(metric.value(entry)) : undefined;
  if (computedValue !== undefined && (!metric.nonnegative || computedValue >= 0)) {
    return { value: computedValue, unit: metric.unit };
  }

  const directValue = firstNumberFromPaths(entry, metric.paths);
  if (directValue !== undefined && (!metric.nonnegative || directValue >= 0)) {
    return {
      value: directValue,
      unit: firstStringFromPaths(entry, ["unit"]) ?? metric.unit,
    };
  }

  const secondsValue = secondsToMinutes(firstNumberFromPaths(entry, metric.secondsPaths ?? []));
  if (secondsValue !== undefined && (!metric.nonnegative || secondsValue >= 0)) {
    return { value: secondsValue, unit: metric.unit };
  }

  const metersValue = metersToKilometers(firstNumberFromPaths(entry, metric.metersPaths ?? []));
  if (metersValue !== undefined) {
    return { value: metersValue, unit: metric.unit };
  }

  const percentRatioValue = normalizePercentRatio(firstNumberFromPaths(entry, metric.percentRatioPaths ?? []));
  if (percentRatioValue !== undefined) {
    return { value: percentRatioValue, unit: metric.unit };
  }

  return null;
}

function resolveJunctionDailyActivityMinutes(entry: PlainObject): number | undefined {
  // Junction activity summary intensity buckets are already minutes. Keeping
  // the shared resolver here also applies the same per-bucket and daily caps.
  const lowActivityMinutes = resolveJunctionActivityBucketMinutes(entry, "low");
  const mediumActivityMinutes = resolveJunctionActivityBucketMinutes(entry, "medium");
  const highActivityMinutes = resolveJunctionActivityBucketMinutes(entry, "high");

  if (
    lowActivityMinutes === undefined
    || mediumActivityMinutes === undefined
    || highActivityMinutes === undefined
  ) {
    return undefined;
  }

  const totalActivityMinutes =
    lowActivityMinutes + mediumActivityMinutes + highActivityMinutes;

  return totalActivityMinutes <= 24 * 60
    ? totalActivityMinutes
    : undefined;
}

function resolveJunctionActivityBucketMinutes(
  entry: PlainObject,
  bucket: "low" | "medium" | "high",
): number | undefined {
  const minutes = firstNumberFromPaths(entry, [bucket]);
  return minutes !== undefined && minutes >= 0 && minutes <= 24 * 60
    ? minutes
    : undefined;
}

function buildResourceContext(input: {
  entry: PlainObject;
  originFallback?: JunctionOriginFallback;
  resource: string;
  resourceSlug: string;
  identityKind: "summary" | "timeseries";
  index: number;
  fallbackArtifactRole: string;
  fallbackIdentityDisambiguator?: string;
  context: NormalizationContext;
}): ResourceContext | null {
  const connection = resolveEntryConnection(input.entry, input.context.connectionsByKey);
  const originFallback = buildJunctionOriginFallback(connection, input.originFallback);
  const origin = resolveJunctionOrigin(input.entry, originFallback);
  const sourceProviderSlug = readJunctionSourceProviderSlug(input.entry, originFallback)
    ?? origin.sourceProviderSlug;

  if (!sourceProviderSlug) {
    return null;
  }

  const resourceType = buildJunctionResourceType(sourceProviderSlug, input.resourceSlug);
  return {
    resource: input.resource,
    resourceSlug: input.resourceSlug,
    identityKind: input.identityKind,
    sourceProviderSlug,
    origin,
    externalRefResourceType: resourceType,
    artifactRole: input.fallbackArtifactRole,
    artifactFileName: `${input.fallbackArtifactRole}.json`,
    evidenceRoles: [input.fallbackArtifactRole],
    connection,
    fallbackIdentityDisambiguator: input.fallbackIdentityDisambiguator,
  };
}

function buildJunctionOriginFallback(
  connection: PlainObject | undefined,
  originFallback: JunctionOriginFallback | undefined,
): JunctionOriginFallback {
  if (!connection) {
    return withGroupedSourceProviderFallback(originFallback ?? {});
  }

  if (!originFallback) {
    return connection;
  }

  const groupedFallback = withGroupedSourceProviderFallback(originFallback);
  return stripUndefined({
    ...connection,
    ...groupedFallback,
    groupedSourceSlug: groupedFallback.groupedSourceSlug,
  });
}

function withGroupedSourceProviderFallback(
  originFallback: JunctionOriginFallback,
): JunctionOriginFallback {
  const groupedSourceProviderSlug = readJunctionSourceProviderSlug(undefined, originFallback)
    ?? normalizeJunctionSourceProviderSlug(originFallback.groupedSourceSlug);
  const groupedSourceType = firstStringFromPaths(originFallback, ["sourceType", "source_type", "source.type"]);

  return stripUndefined({
    ...originFallback,
    sourceProviderSlug: groupedSourceProviderSlug,
    sourceType: groupedSourceType,
  });
}

function buildDataOrigin(
  entry: PlainObject,
  resourceContext: ResourceContext,
  timestamp: ReturnType<typeof resolveRecordTimestamp>,
  options: { normalizerVersion?: string } = {},
): DeviceDataOrigin {
  return stripUndefined({
    ...resourceContext.origin,
    observedAtRaw: timestamp.observedAtRaw,
    timeZoneOffsetMinutes: readJunctionTimeZoneOffsetMinutes(entry),
    timestampSemantics: timestamp.timestampSemantics,
    normalizerVersion: options.normalizerVersion ?? "junction-normalizer.v1",
  });
}

function withTimestampOverride(
  timestamp: ReturnType<typeof resolveRecordTimestamp>,
  override: Partial<ReturnType<typeof resolveRecordTimestamp>>,
): ReturnType<typeof resolveRecordTimestamp> {
  return {
    occurredAt: override.occurredAt ?? timestamp.occurredAt,
    recordedAt: override.recordedAt ?? timestamp.recordedAt,
    dayKey: override.dayKey ?? timestamp.dayKey,
    observedAtRaw: override.observedAtRaw ?? timestamp.observedAtRaw,
    timestampSemantics: override.timestampSemantics ?? timestamp.timestampSemantics,
  };
}

function makeJunctionExternalRef(
  resourceContext: ResourceContext,
  entry: PlainObject,
  timestamp: ReturnType<typeof resolveRecordTimestamp>,
  facet: string,
): DeviceExternalRefPayload {
  return makeProviderExternalRef(
    "junction",
    resourceContext.externalRefResourceType,
    buildStableResourceId(resourceContext, entry, timestamp),
    junctionExternalRefVersion(resourceContext, entry),
    slugify(facet, "value"),
  );
}

function makeJunctionLegacyWorkoutExternalRef(
  resourceContext: ResourceContext,
  entry: PlainObject,
  canonicalExternalRef: DeviceExternalRefPayload,
): DeviceExternalRefPayload | undefined {
  if (resourceContext.identityKind !== "summary" || resourceContext.resource !== "workouts") {
    return undefined;
  }

  // Reconstruct the exact pre-canonical selector: provider identifiers won,
  // then Junction identifiers filled the fallback. Even the same raw ID has
  // a different historical key because that key was source-scoped.
  const historicalExplicitId = firstStringFromPaths(entry, JUNCTION_WORKOUT_SOURCE_ID_PATHS);
  if (!historicalExplicitId) {
    return undefined;
  }

  const historicalExternalRef = makeProviderExternalRef(
    "junction",
    resourceContext.externalRefResourceType,
    `${resourceContext.resourceSlug}-${shortHash([
      resourceContext.sourceProviderSlug,
      resourceContext.origin.sourceType,
      resourceContext.origin.sourceInstanceId,
      historicalExplicitId,
    ])}`,
    undefined,
    canonicalExternalRef.facet ?? "session",
  );
  return historicalExternalRef.resourceId === canonicalExternalRef.resourceId
    ? undefined
    : historicalExternalRef;
}

function junctionExternalRefVersion(
  resourceContext: ResourceContext,
  entry: PlainObject,
): string | undefined {
  if (
    resourceContext.sourceProviderSlug !== "apple-health-kit"
    || resourceContext.origin.sourceType !== "companion-whoop-metadata-unverified"
  ) {
    return junctionAuthoritativeSummaryVersion(resourceContext, entry);
  }

  const version = entry.companionSyncVersion;
  return typeof version === "number" && Number.isSafeInteger(version) && version >= 0
    ? String(version)
    : undefined;
}

function junctionAuthoritativeSummaryVersion(
  resourceContext: ResourceContext,
  entry: PlainObject,
): string | undefined {
  if (resourceContext.identityKind !== "summary") {
    return undefined;
  }
  if (resourceContext.resource === "workouts") {
    return resolveSafeTimestamp(entry.authoritativeVersion, resourceContext.sourceProviderSlug);
  }
  if (resourceContext.resource !== "profile" && resourceContext.resource !== "menstrual_cycle") {
    return undefined;
  }
  return resolveSafeTimestamp(
    firstValueFromPaths(entry, ["updatedAt", "updated_at", "createdAt", "created_at"]),
    resourceContext.sourceProviderSlug,
  );
}

function buildJunctionResourceType(sourceProviderSlug: string, resourceSlug: string): string {
  return `junction-${slugify(sourceProviderSlug, "source")}-${slugify(resourceSlug, "resource")}`;
}

function buildStableResourceId(
  resourceContext: ResourceContext,
  entry: PlainObject,
  timestamp: ReturnType<typeof resolveRecordTimestamp>,
): string {
  if (resourceContext.identityKind === "timeseries") {
    return buildStableTimeseriesResourceId(resourceContext, timestamp);
  }

  return buildStableSummaryResourceId(resourceContext, entry, timestamp);
}

function buildStableSummaryResourceId(
  resourceContext: ResourceContext,
  entry: PlainObject,
  timestamp: ReturnType<typeof resolveRecordTimestamp>,
): string {
  const exactJunctionWorkoutId = resourceContext.resource === "workouts"
    ? firstStringFromPaths(entry, JUNCTION_WORKOUT_JUNCTION_ID_PATHS)
    : undefined;
  if (exactJunctionWorkoutId) {
    return `${resourceContext.resourceSlug}-${shortHash([
      "junction-workout-id",
      exactJunctionWorkoutId,
    ])}`;
  }

  const explicitId = resourceContext.resource === "workouts"
    ? firstStringFromPaths(entry, JUNCTION_WORKOUT_FALLBACK_STABLE_ID_PATHS)
    : resourceContext.resource === "meal"
      ? firstStringFromPaths(entry, JUNCTION_MEAL_STABLE_ID_PATHS)
    : firstStringFromPaths(entry, JUNCTION_GENERIC_SUMMARY_ID_PATHS);

  if (explicitId) {
    return `${resourceContext.resourceSlug}-${shortHash([
      resourceContext.sourceProviderSlug,
      resourceContext.origin.sourceType,
      resourceContext.origin.sourceInstanceId,
      explicitId,
    ])}`;
  }

  return `${resourceContext.resourceSlug}-${shortHash([
    resourceContext.resourceSlug,
    resourceContext.sourceProviderSlug,
    resourceContext.origin.sourceType,
    resourceContext.origin.sourceInstanceId,
    timestamp.observedAtRaw ?? timestamp.occurredAt,
    ...(resourceContext.resource === "meal" ? [
      resolveJunctionMealTitle(entry),
      ...(resourceContext.fallbackIdentityDisambiguator ? [resourceContext.fallbackIdentityDisambiguator] : []),
    ] : []),
  ])}`;
}

function buildStableTimeseriesResourceId(
  resourceContext: ResourceContext,
  timestamp: ReturnType<typeof resolveRecordTimestamp>,
): string {
  return `${resourceContext.resourceSlug}-${shortHash([
    resourceContext.resourceSlug,
    resourceContext.sourceProviderSlug,
    resourceContext.origin.sourceType,
    resourceContext.origin.sourceInstanceId,
    timestamp.observedAtRaw ?? timestamp.occurredAt,
  ])}`;
}

function shortHash(parts: readonly unknown[]): string {
  return createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 16);
}

function resolveRecordTimestamp(
  entry: PlainObject,
  context: Pick<NormalizationContext, "importedAt" | "windowEnd" | "windowStart">,
  sourceProviderSlug: string | undefined,
): {
  occurredAt?: string;
  recordedAt?: string;
  dayKey?: string;
  observedAtRaw?: string;
  timestampSemantics?: TimestampSemantics;
} {
  const rawObservedAt = firstStringFromPaths(entry, JUNCTION_RECORD_TIMESTAMP_PATHS);
  const localCalendarDayKey = firstIsoDateFromPaths(entry, JUNCTION_LOCAL_CALENDAR_DATE_PATHS);
  const explicitSemantics = firstTimestampSemantics(entry);
  const hasSourceSpecificFloatingTime = hasFloatingTimestampSourceProvider(sourceProviderSlug);
  const timestampSemantics = hasSourceSpecificFloatingTime
    ? "floating"
    : explicitSemantics ?? inferTimestampSemantics(rawObservedAt);
  const fallbackOccurredAt = context.windowEnd ?? context.windowStart ?? context.importedAt;
  const occurredAt = hasSourceSpecificFloatingTime
    ? undefined
    : timestampSemantics === "floating"
      ? fallbackOccurredAt
      : resolveSafeTimestamp(rawObservedAt, sourceProviderSlug) ?? fallbackOccurredAt;
  const recordedAt = hasSourceSpecificFloatingTime
    ? undefined
    : resolveSafeTimestamp(
      firstValueFromPaths(entry, ["recordedAt", "recorded_at", "updatedAt", "updated_at"]),
      sourceProviderSlug,
    )
      ?? occurredAt;

  return stripUndefined({
    occurredAt,
    recordedAt,
    dayKey: localCalendarDayKey ?? resolveJunctionLocalDayKey(entry, rawObservedAt, occurredAt, timestampSemantics),
    observedAtRaw: rawObservedAt,
    timestampSemantics,
  });
}

function resolveJunctionLocalDayKey(
  entry: PlainObject,
  rawTimestampValue: unknown,
  resolvedTimestamp: string | undefined,
  timestampSemanticsOverride?: TimestampSemantics,
): string | undefined {
  const rawTimestamp = stringId(rawTimestampValue);
  const rawDayKey = extractIsoDatePrefix(rawTimestamp) ?? undefined;
  if (!rawTimestamp) {
    return undefined;
  }

  const timestampSemantics = timestampSemanticsOverride
    ?? firstTimestampSemantics(entry)
    ?? inferTimestampSemantics(rawTimestamp);

  if (timestampSemantics === "floating" || isDateOnlyJunctionTimestamp(rawTimestamp)) {
    return rawDayKey;
  }

  if (timestampSemantics === "offset") {
    return rawDayKey;
  }

  const offsetSeconds = readJunctionTimeZoneOffsetSeconds(entry);
  if (offsetSeconds !== null && offsetSeconds !== undefined && resolvedTimestamp) {
    const offsetDayKey = extractLocalDayKeyFromUtcOffset(resolvedTimestamp, offsetSeconds);
    if (offsetDayKey) {
      return offsetDayKey;
    }
  }

  return undefined;
}

function buildConnectionsByKey(connections: readonly PlainObject[]): ReadonlyMap<string, PlainObject> {
  const entries: Array<[string, PlainObject]> = [];

  for (const connection of connections) {
    for (const keyPath of ["id", "connectionId", "connection_id", "sourceId", "source_id"]) {
      const key = firstStringFromPaths(connection, [keyPath]);
      if (key) {
        entries.push([key, connection]);
      }
    }
  }

  return new Map(entries);
}

function resolveEntryConnection(
  entry: PlainObject,
  connectionsByKey: ReadonlyMap<string, PlainObject>,
): PlainObject | undefined {
  const keys = [
    firstStringFromPaths(entry, ["connectionId", "connection_id"]),
    firstStringFromPaths(entry, ["sourceId", "source_id"]),
  ];

  for (const key of keys) {
    const connection = key ? connectionsByKey.get(key) : undefined;
    if (connection) {
      return connection;
    }
  }

  return undefined;
}

function allowedResourceEntries(
  resources: Record<string, unknown> | undefined,
  allowlist: ReadonlySet<string>,
): Array<[string, unknown]> {
  if (!resources) {
    return [];
  }

  const mergedEntries = new Map<string, unknown>();
  for (const [resource, payload] of Object.entries(resources)) {
    const normalized = normalizeJunctionResourceName(resource);
    if (!normalized || !allowlist.has(normalized)) {
      continue;
    }
    mergedEntries.set(
      normalized,
      mergeJunctionResourcePayloads(mergedEntries.get(normalized), payload, normalized),
    );
  }

  return [...mergedEntries.entries()];
}

function mergeJunctionResourcePayloads(existing: unknown, next: unknown, resource?: string): unknown {
  if (existing === undefined) {
    return next;
  }

  const grouped = mergeJunctionGroupedPayloads(existing, next);
  if (grouped) {
    return grouped;
  }

  const nested = mergeJunctionNestedEnvelopePayloads(existing, next, resource);
  if (nested) {
    return nested;
  }

  return [...toMergedJunctionPayloadItems(existing), ...toMergedJunctionPayloadItems(next)];
}

function mergeJunctionGroupedPayloads(left: unknown, right: unknown): PlainObject | null {
  const leftRecord = asPlainObject(left);
  const rightRecord = asPlainObject(right);
  const leftGroups = asPlainObject(leftRecord?.groups);
  const rightGroups = asPlainObject(rightRecord?.groups);

  if (!leftRecord || !rightRecord || !leftGroups || !rightGroups) {
    return null;
  }

  const groups: Record<string, unknown[]> = {};
  for (const [source, entries] of Object.entries(leftGroups)) {
    groups[source] = toMergedJunctionPayloadItems(entries);
  }
  for (const [source, entries] of Object.entries(rightGroups)) {
    groups[source] = [
      ...(groups[source] ?? []),
      ...toMergedJunctionPayloadItems(entries),
    ];
  }

  return {
    ...leftRecord,
    ...rightRecord,
    groups,
  };
}

function mergeJunctionNestedEnvelopePayloads(
  left: unknown,
  right: unknown,
  resource?: string,
): PlainObject | null {
  const leftRecord = asPlainObject(left);
  const rightRecord = asPlainObject(right);

  if (!leftRecord || !rightRecord) {
    return null;
  }

  for (const key of nestedResourceEntryKeys(resource)) {
    if (Array.isArray(leftRecord[key]) && Array.isArray(rightRecord[key])) {
      return {
        ...leftRecord,
        ...rightRecord,
        [key]: [
          ...asArray(leftRecord[key]),
          ...asArray(rightRecord[key]),
        ],
      };
    }
  }

  return null;
}

function toMergedJunctionPayloadItems(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function resourceEntries(payload: unknown, resource?: string): JunctionResourceEntry[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((entry) => expandResourceEntry(entry, resource));
  }

  const normalized = asPlainObject(payload);
  return normalized ? expandResourceEntry(normalized, resource) : [];
}

function timeseriesResourceEntries(payload: unknown): JunctionResourceEntry[] {
  const groupedEntries = groupedTimeseriesResourceEntries(payload);
  return groupedEntries.length > 0 ? groupedEntries : resourceEntries(payload);
}

function groupedTimeseriesResourceEntries(payload: unknown): JunctionResourceEntry[] {
  const envelope = asPlainObject(payload);
  const groups = asPlainObject(envelope?.groups);

  if (!groups) {
    return [];
  }

  return Object.entries(groups).flatMap(([groupedSourceSlug, groupPayload]) =>
    asArray(groupPayload).flatMap((groupEntry) => {
      const groupRecord = asPlainObject(groupEntry);
      if (!groupRecord) {
        return [];
      }

      const originFallback = stripUndefined({
        ...groupRecord,
        groupedSourceSlug,
      });
      const nestedEntries = readNestedResourceEntries(groupRecord);

      if (!nestedEntries) {
        return [{
          entry: {
            ...groupRecord,
            groupedSourceSlug,
          },
          originFallback,
        }];
      }

      return nestedEntries.map((nestedEntry) => ({
        entry: mergeNestedResourceEntry(groupRecord, nestedEntry),
        originFallback,
      }));
    })
  );
}

function sleepStageIntervalEntries(
  entry: PlainObject,
  sourceProviderSlug: string | undefined,
): PlainObject[] {
  const seen = new Set<PlainObject>();

  return [
    ...collectSleepStageIntervalEntries(entry, seen, sourceProviderSlug),
    ...parallelSleepStageIntervalEntries(entry, sourceProviderSlug),
  ];
}

function collectSleepStageIntervalEntries(
  value: unknown,
  seen: Set<PlainObject>,
  sourceProviderSlug: string | undefined,
): PlainObject[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectSleepStageIntervalEntries(entry, seen, sourceProviderSlug));
  }

  const entry = asPlainObject(value);
  if (!entry) {
    return [];
  }
  if (seen.has(entry)) {
    return [];
  }
  seen.add(entry);

  if (firstSleepStageFromPaths(entry, JUNCTION_SLEEP_STAGE_VALUE_PATHS, sourceProviderSlug)) {
    return [entry];
  }

  return JUNCTION_SLEEP_STAGE_ARRAY_PATHS.flatMap((path) => {
    const nested = readPath(entry, path);
    if (nested === value) {
      return [];
    }

    return collectSleepStageIntervalEntries(nested, seen, sourceProviderSlug);
  });
}

function parallelSleepStageIntervalEntries(
  entry: PlainObject,
  sourceProviderSlug: string | undefined,
): PlainObject[] {
  const sessionStartRaw = firstValueFromPaths(entry, [
    "sessionStart",
    "session_start",
    ...JUNCTION_SLEEP_START_TIMESTAMP_PATHS,
  ]);
  const sessionStartAt = normalizeTimestamp(sessionStartRaw);
  if (!sessionStartAt) {
    return [];
  }

  const startOffsets = firstNumberArrayFromPaths(entry, JUNCTION_SLEEP_STAGE_START_OFFSET_SECOND_PATHS);
  const endOffsets = firstNumberArrayFromPaths(entry, JUNCTION_SLEEP_STAGE_END_OFFSET_SECOND_PATHS);
  const stageValues = firstArrayFromPaths(entry, JUNCTION_SLEEP_STAGE_TYPE_ARRAY_PATHS);
  if (startOffsets.length === 0 || endOffsets.length === 0 || stageValues.length === 0) {
    return [];
  }

  const timeZone = firstStringFromPaths(entry, ["timeZone", "timezone", "time_zone"]);

  return stageValues.flatMap((stageValue, index) => {
    const stage = normalizeJunctionSleepStageValueForSource(stageValue, sourceProviderSlug);
    const startOffsetSeconds = startOffsets[index];
    const endOffsetSeconds = endOffsets[index];
    if (!stage || startOffsetSeconds === undefined || endOffsetSeconds === undefined) {
      return [];
    }

    const startAt = addMinutes(sessionStartAt, startOffsetSeconds / 60);
    const endAt = addMinutes(sessionStartAt, endOffsetSeconds / 60);
    if (!startAt || !endAt || Date.parse(endAt) <= Date.parse(startAt)) {
      return [];
    }

    return [stripUndefined({
      start: startAt,
      end: endAt,
      stage,
      localDate: resolveVaultLocalDayKey(startAt, timeZone),
      stageStartOffsetSecond: startOffsetSeconds,
      stageEndOffsetSecond: endOffsetSeconds,
      stageIndex: index,
    })];
  });
}

function expandResourceEntry(value: unknown, resource?: string): JunctionResourceEntry[] {
  const entry = asPlainObject(value);
  if (!entry) {
    return [];
  }

  const nestedEntries = readNestedResourceEntries(entry, resource);
  if (!nestedEntries) {
    return [{ entry }];
  }

  return nestedEntries.map((nestedEntry) => ({
    entry: mergeNestedResourceEntry(entry, nestedEntry),
    originFallback: entry,
  }));
}

function readNestedResourceEntries(envelope: PlainObject, resource?: string): PlainObject[] | null {
  const sourceProviderSlug = resource === "sleep_cycle"
    ? readJunctionSourceProviderSlug(envelope, undefined)
    : undefined;

  for (const key of nestedResourceEntryKeys(resource)) {
    const directEntry = asPlainObject(envelope[key]);
    const entries = directEntry
      ? [directEntry]
      : asArray(envelope[key]).flatMap((entry) => {
          const normalized = asPlainObject(entry);
          return normalized ? [normalized] : [];
        });
    if (entries.length > 0) {
      if (
        resource === "sleep_cycle" &&
        entries.some((entry) =>
          isDirectSleepStageIntervalEntry(
            entry,
            readJunctionSourceProviderSlug(entry, envelope) ?? sourceProviderSlug,
          )
        )
      ) {
        return null;
      }

      return entries;
    }
  }

  return null;
}

function isDirectSleepStageIntervalEntry(
  entry: PlainObject,
  sourceProviderSlug: string | undefined,
): boolean {
  return firstSleepStageFromPaths(entry, JUNCTION_SLEEP_STAGE_VALUE_PATHS, sourceProviderSlug) !== undefined;
}

function nestedResourceEntryKeys(resource: string | undefined): readonly string[] {
  switch (resource) {
    case "meal":
      return JUNCTION_MEAL_NESTED_RESOURCE_ENTRY_KEYS;
    case "menstrual_cycle":
      return JUNCTION_MENSTRUAL_CYCLE_NESTED_RESOURCE_ENTRY_KEYS;
    case "electrocardiogram":
      return JUNCTION_ELECTROCARDIOGRAM_NESTED_RESOURCE_ENTRY_KEYS;
    default:
      return JUNCTION_NESTED_RESOURCE_ENTRY_KEYS;
  }
}

function mergeNestedResourceEntry(envelope: PlainObject, nestedEntry: PlainObject): PlainObject {
  return {
    ...envelope,
    ...nestedEntry,
  };
}

function listAllowedResourceKeys(
  resources: Record<string, unknown> | undefined,
  allowlist: ReadonlySet<string>,
): string[] {
  return allowedResourceEntries(resources, allowlist).map(([resource]) => resource);
}

function firstSleepStageFromPaths(
  source: PlainObject | undefined,
  paths: readonly string[],
  sourceProviderSlug?: string,
): JunctionSleepStageValue | undefined {
  for (const path of paths) {
    const stage = normalizeJunctionSleepStageValueForSource(readPath(source, path), sourceProviderSlug);
    if (stage) {
      return stage;
    }
  }

  return undefined;
}

function normalizeJunctionSleepStageValueForSource(
  value: unknown,
  sourceProviderSlug: string | undefined,
): JunctionSleepStageValue | null {
  const normalized = normalizeJunctionSleepStageValue(value);
  if (normalized) {
    return normalized;
  }

  return isAppleHealthKitSourceProvider(sourceProviderSlug) && isJunctionAppleGenericAsleepStageValue(value)
    ? "asleep_unspecified"
    : null;
}

function isAppleHealthKitSourceProvider(sourceProviderSlug: string | undefined): boolean {
  return normalizeJunctionSourceProviderSlug(sourceProviderSlug) === APPLE_HEALTH_KIT_SOURCE_PROVIDER_SLUG;
}

function isJunctionAppleGenericAsleepStageValue(value: unknown): boolean {
  return value === -1 || (typeof value === "string" && value.trim() === "-1");
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function resolveSafeTimestamp(value: unknown, sourceProviderSlug?: string): string | undefined {
  const raw = typeof value === "string" ? value.trim() : value;

  if (typeof raw === "string" && hasFloatingTimestampSourceProvider(sourceProviderSlug)) {
    return undefined;
  }

  if (typeof raw === "string" && inferTimestampSemantics(raw) === "floating") {
    return undefined;
  }

  return normalizeTimestamp(raw);
}

function hasFloatingTimestampSourceProvider(sourceProviderSlug: string | undefined): boolean {
  const normalized = normalizeJunctionSourceProviderSlug(sourceProviderSlug);
  return normalized ? FLOATING_TIMESTAMP_SOURCE_PROVIDER_SLUGS.has(normalized) : false;
}

function inferTimestampSemantics(value: string | undefined): TimestampSemantics | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (/z$/iu.test(trimmed)) {
    return "utc";
  }

  if (/[+-]\d{2}:?\d{2}$/u.test(trimmed)) {
    return "offset";
  }

  if (/^\d{4}-\d{2}-\d{2}(?:$|[ t]\d{2}:\d{2})/iu.test(trimmed)) {
    return "floating";
  }

  return "unknown";
}

function firstTimestampSemantics(entry: PlainObject): TimestampSemantics | undefined {
  const value = firstStringFromPaths(entry, ["timestampSemantics", "timestamp_semantics"]);
  return value === "utc" || value === "offset" || value === "floating" || value === "unknown"
    ? value
    : undefined;
}

function resolveJunctionTimeseriesAggregateDayKey(
  entry: PlainObject,
  timestamp: ReturnType<typeof resolveRecordTimestamp>,
  sampleAt: string | undefined,
  defaultTimeZone: string | undefined,
): string | undefined {
  if (timestamp.timestampSemantics === "offset") {
    return timestamp.dayKey ?? extractIsoDatePrefix(sampleAt) ?? undefined;
  }

  const offsetSeconds = readJunctionTimeZoneOffsetSeconds(entry);
  if (
    offsetSeconds !== null
    && offsetSeconds !== undefined
    && sampleAt
    && timestamp.observedAtRaw
    && timestamp.timestampSemantics !== "floating"
    && !isDateOnlyJunctionTimestamp(timestamp.observedAtRaw)
  ) {
    const offsetDayKey = extractLocalDayKeyFromUtcOffset(sampleAt, offsetSeconds);
    if (offsetDayKey) {
      return offsetDayKey;
    }
  }

  const vaultDayKey = sampleAt
    ? resolveVaultLocalDayKey(sampleAt, defaultTimeZone)
    : undefined;
  return timestamp.dayKey ?? vaultDayKey ?? extractIsoDatePrefix(sampleAt) ?? undefined;
}

function resolveJunctionDailyAggregateSampleAt(
  timestamp: ReturnType<typeof resolveRecordTimestamp>,
): string | undefined {
  return timestamp.occurredAt ?? timestamp.recordedAt ?? (
    timestamp.timestampSemantics === "floating" && timestamp.dayKey
      ? `${timestamp.dayKey}T00:00:00.000Z`
      : undefined
  );
}

function resolveVaultLocalDayKey(timestamp: string, defaultTimeZone: string | undefined): string | undefined {
  if (!defaultTimeZone) {
    return undefined;
  }

  try {
    return toLocalDayKey(timestamp, defaultTimeZone);
  } catch {
    return undefined;
  }
}

function resolveLegacyJunctionTimeseriesAggregateDayKey(
  entry: PlainObject,
  timestamp: ReturnType<typeof resolveRecordTimestamp>,
  sampleAt: string | undefined,
): string | undefined {
  const offsetSeconds = readJunctionTimeZoneOffsetSeconds(entry);
  if (
    offsetSeconds !== null
    && offsetSeconds !== undefined
    && sampleAt
    && timestamp.observedAtRaw
    && timestamp.timestampSemantics !== "floating"
    && !isDateOnlyJunctionTimestamp(timestamp.observedAtRaw)
  ) {
    const offsetDayKey = extractLocalDayKeyFromUtcOffset(sampleAt, offsetSeconds);
    if (offsetDayKey) {
      return offsetDayKey;
    }
  }

  return extractIsoDatePrefix(timestamp.observedAtRaw) ?? extractIsoDatePrefix(sampleAt) ?? undefined;
}

function isDateOnlyJunctionTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value.trim());
}

function extractLocalDayKeyFromUtcOffset(timestamp: string, offsetSeconds: number): string | undefined {
  if (!Number.isFinite(offsetSeconds) || Math.abs(offsetSeconds) > 24 * 60 * 60) {
    return undefined;
  }

  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) {
    return undefined;
  }

  return new Date(timestampMs + offsetSeconds * 1000).toISOString().slice(0, 10);
}

function readJunctionTimeZoneOffsetMinutes(entry: PlainObject): number | null | undefined {
  const minuteValue = firstNullableJunctionTimeZoneOffsetValueFromPaths(
    entry,
    JUNCTION_TIME_ZONE_OFFSET_MINUTE_PATHS,
    "minutes",
  );
  if (minuteValue !== undefined) {
    return minuteValue;
  }

  const secondValue = firstNullableJunctionTimeZoneOffsetValueFromPaths(
    entry,
    JUNCTION_TIME_ZONE_OFFSET_SECOND_PATHS,
    "seconds",
  );

  return secondValue === undefined || secondValue === null ? secondValue : secondValue / 60;
}

function readJunctionTimeZoneOffsetSeconds(entry: PlainObject): number | null | undefined {
  const minuteValue = firstNullableJunctionTimeZoneOffsetValueFromPaths(
    entry,
    JUNCTION_TIME_ZONE_OFFSET_MINUTE_PATHS,
    "minutes",
  );
  if (minuteValue !== undefined) {
    return minuteValue === null ? null : minuteValue * 60;
  }

  return firstNullableJunctionTimeZoneOffsetValueFromPaths(entry, JUNCTION_TIME_ZONE_OFFSET_SECOND_PATHS, "seconds");
}

function firstNullableJunctionTimeZoneOffsetValueFromPaths(
  source: PlainObject,
  paths: readonly string[],
  unit: "minutes" | "seconds",
): number | null | undefined {
  for (const path of paths) {
    const value = readPath(source, path);

    if (value === undefined) {
      continue;
    }

    if (value === null) {
      return null;
    }

    const numeric = finiteNumber(value);
    if (numeric !== undefined) {
      return numeric;
    }

    if (typeof value !== "string") {
      continue;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }

    const offsetMinutes = parseJunctionTimeZoneOffsetMinutes(trimmed);
    if (offsetMinutes !== undefined) {
      return unit === "minutes" ? offsetMinutes : offsetMinutes * 60;
    }

    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function parseJunctionTimeZoneOffsetMinutes(value: string): number | undefined {
  if (value.toUpperCase() === "Z") {
    return 0;
  }

  const match = /^([+-])(\d{2}):?(\d{2})$/u.exec(value);
  if (!match) {
    return undefined;
  }

  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 24 || minutes > 59) {
    return undefined;
  }

  const sign = match[1] === "-" ? -1 : 1;
  return sign * (hours * 60 + minutes);
}

function firstNumberFromPaths(source: PlainObject | undefined, paths: readonly string[]): number | undefined {
  for (const path of paths) {
    const value = finiteNumber(readPath(source, path));
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function firstNumberArrayFromPaths(source: PlainObject | undefined, paths: readonly string[]): Array<number | undefined> {
  for (const path of paths) {
    const values = numberArrayFromValue(readPath(source, path));
    if (values.length > 0) {
      return values;
    }
  }

  return [];
}

function numberArrayFromValue(value: unknown): Array<number | undefined> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => finiteNumber(entry));
}

function firstNonNegativeNumberFromPaths(source: PlainObject | undefined, paths: readonly string[]): number | undefined {
  return normalizeNonNegativeNumber(firstNumberFromPaths(source, paths));
}

function firstNullableNumberFromPaths(source: PlainObject | undefined, paths: readonly string[]): number | null | undefined {
  for (const path of paths) {
    const value = readPath(source, path);
    if (value === null) {
      return null;
    }

    const numeric = finiteNumber(value);
    if (numeric !== undefined) {
      return numeric;
    }
  }

  return undefined;
}

function firstNonNegativeMinutesFromPaths(
  source: PlainObject | undefined,
  paths: {
    minutePaths: readonly string[];
    secondPaths?: readonly string[];
    millisecondPaths?: readonly string[];
  },
): number | undefined {
  return normalizeNonNegativeNumber(firstNumberFromPaths(source, paths.minutePaths)) ??
    normalizeNonNegativeNumber(secondsToMinutes(firstNumberFromPaths(source, paths.secondPaths ?? []))) ??
    normalizeNonNegativeNumber(millisecondsToMinutes(firstNumberFromPaths(source, paths.millisecondPaths ?? [])));
}

function normalizeNonNegativeNumber(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  return numeric !== undefined && numeric >= 0 ? numeric : undefined;
}

function normalizePositiveIntegerMinutes(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  if (numeric === undefined || numeric <= 0) {
    return undefined;
  }

  return Math.max(1, Math.round(numeric));
}

function normalizePositiveMinutes(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  return numeric !== undefined && numeric > 0 ? numeric : undefined;
}

function exactPositiveMinutesBetween(startAt: string | undefined, endAt: string | undefined): number | undefined {
  if (!startAt || !endAt) {
    return undefined;
  }

  const durationMs = Date.parse(endAt) - Date.parse(startAt);

  return Number.isFinite(durationMs) && durationMs > 0 ? durationMs / 60000 : undefined;
}

function secondsToMinutes(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  if (numeric === undefined) {
    return undefined;
  }

  return numeric / 60;
}

function millisecondsToMinutes(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  if (numeric === undefined) {
    return undefined;
  }

  return numeric / 60000;
}

function addMinutes(timestamp: string | undefined, minutes: number | undefined): string | undefined {
  if (!timestamp || minutes === undefined) {
    return undefined;
  }

  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) {
    return undefined;
  }

  return new Date(time + minutes * 60000).toISOString();
}

function subtractMinutes(timestamp: string | undefined, minutes: number | undefined): string | undefined {
  if (!timestamp || minutes === undefined) {
    return undefined;
  }

  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) {
    return undefined;
  }

  return new Date(time - minutes * 60000).toISOString();
}

function metersToKilometers(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  if (numeric === undefined || numeric < 0) {
    return undefined;
  }

  return numeric / 1000;
}

function normalizePercentRatio(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  if (numeric === undefined) {
    return undefined;
  }

  return numeric >= 0 && numeric <= 1 ? numeric * 100 : numeric;
}

function normalizeBloodOxygenPercent(value: unknown): number | undefined {
  const numeric = normalizePercentRatio(value);

  if (numeric === undefined || numeric <= 0 || numeric > 100) {
    return undefined;
  }

  return roundJunctionDailyAggregateValue(numeric);
}

function normalizeStressLevelScore(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  if (numeric === undefined || numeric < 0 || numeric > 100) {
    return undefined;
  }

  return roundJunctionDailyAggregateValue(numeric);
}

function normalizeHrvMilliseconds(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  if (numeric === undefined || numeric <= 0 || numeric > 1000) {
    return undefined;
  }

  return roundJunctionDailyAggregateValue(numeric);
}

function normalizeRespiratoryRateBreathsPerMinute(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  if (numeric === undefined || numeric <= 0 || numeric > 100) {
    return undefined;
  }

  return roundJunctionDailyAggregateValue(numeric);
}

function normalizeVo2Max(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  if (numeric === undefined || numeric <= 0 || numeric > 120) {
    return undefined;
  }

  return roundJunctionDailyAggregateValue(numeric);
}

// Apple Watch wrist-temperature deviation is a nightly delta in °C
// (docs.junction.com/api-reference/data/timeseries/body-temperature-delta);
// negative deltas are valid and a swing beyond ±5 °C is implausible.
function normalizeBodyTemperatureDeltaCelsius(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  if (numeric === undefined || numeric < -5 || numeric > 5) {
    return undefined;
  }

  return roundJunctionDailyAggregateValue(numeric);
}

function normalizeBodyTemperatureCelsius(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  if (numeric === undefined || numeric < 30 || numeric > 45) {
    return undefined;
  }

  return roundJunctionDailyAggregateValue(numeric);
}

// Junction's caffeine timeseries is documented in grams
// (docs.junction.com/api-reference/data/timeseries/caffeine); convert to
// milligrams for the observation metric. 2 g per logged entry is already an
// implausible single intake.
function normalizeCaffeineMilligrams(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  if (numeric === undefined || numeric <= 0 || numeric > 2) {
    return undefined;
  }

  return roundJunctionDailyAggregateValue(numeric * 1000);
}

function normalizeWaterMilliliters(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  if (numeric === undefined || numeric <= 0 || numeric > 10_000) {
    return undefined;
  }

  return roundJunctionDailyAggregateValue(numeric);
}

function normalizeMindfulnessMinutesValue(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  if (numeric === undefined || numeric <= 0 || numeric > 1440) {
    return undefined;
  }

  return roundJunctionDailyAggregateValue(numeric);
}

function normalizeHeartRateRecoveryBeats(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  if (numeric === undefined || numeric <= 0 || numeric > 120) {
    return undefined;
  }

  return roundJunctionDailyAggregateValue(numeric);
}

// A zero-disturbance night is a meaningful fact, so zero stays valid.
function normalizeSleepBreathingDisturbanceValue(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  if (numeric === undefined || numeric < 0 || numeric > 200) {
    return undefined;
  }

  return roundJunctionDailyAggregateValue(numeric);
}

function normalizeAfibBurdenPercent(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  if (numeric === undefined || numeric < 0 || numeric > 100) {
    return undefined;
  }

  return roundJunctionDailyAggregateValue(numeric);
}

// Junction normalizes glucose timeseries to mmol/L
// (docs.junction.com/api-reference/data/timeseries/glucose); the plausibility
// window is therefore mmol/L-shaped (1-35 covers meter and CGM extremes, and
// mg/dL-scale values fail closed instead of corrupting the metric). Convert
// to mg/dL to match the `glucose` metric-catalog canonical unit.
function normalizeGlucoseMilligramsPerDeciliter(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  if (numeric === undefined || numeric < 1 || numeric > 35) {
    return undefined;
  }

  return roundJunctionDailyAggregateValue(numeric * 18.0182);
}

function normalizeSystolicMmHg(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  if (numeric === undefined || numeric < 60 || numeric > 260) {
    return undefined;
  }

  return roundJunctionDailyAggregateValue(numeric);
}

function normalizeDiastolicMmHg(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  if (numeric === undefined || numeric < 30 || numeric > 160) {
    return undefined;
  }

  return roundJunctionDailyAggregateValue(numeric);
}

function roundJunctionDailyAggregateValue(value: number): number {
  return Number(value.toFixed(4));
}

function roundMealNutritionValue(value: unknown): number | undefined {
  const numeric = normalizeNonNegativeNumber(value);
  return numeric === undefined ? undefined : Number(numeric.toFixed(4));
}

function isJunctionKilocalorieUnit(value: string): boolean {
  const unit = normalizeNutritionUnit(value);
  return unit === "kcal" || unit === "kilocalorie" || unit === "kilocalories"
    || unit === "cal" || unit === "calorie" || unit === "calories";
}

function isJunctionKilojouleUnit(value: string): boolean {
  const unit = normalizeNutritionUnit(value);
  return unit === "kj" || unit === "kilojoule" || unit === "kilojoules";
}

function normalizeNutritionUnit(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z]/gu, "");
}

function compareJunctionDailyTimeseriesAggregates(
  left: JunctionDailyTimeseriesAggregate,
  right: JunctionDailyTimeseriesAggregate,
): number {
  return left.dayKey.localeCompare(right.dayKey)
    || left.resourceContext.sourceProviderSlug.localeCompare(right.resourceContext.sourceProviderSlug)
    || (left.resourceContext.origin.sourceType ?? "").localeCompare(right.resourceContext.origin.sourceType ?? "")
    || (left.resourceContext.origin.sourceInstanceId ?? "").localeCompare(right.resourceContext.origin.sourceInstanceId ?? "");
}

function firstStringFromPaths(source: PlainObject | undefined, paths: readonly string[]): string | undefined {
  for (const path of paths) {
    const value = readPath(source, path);
    const id = stringId(value);
    if (id) {
      return id;
    }
  }

  return undefined;
}

function firstStringArrayFromPaths(source: PlainObject | undefined, paths: readonly string[]): string[] {
  for (const path of paths) {
    const values = stringArrayFromValue(readPath(source, path));
    if (values.length > 0) {
      return values;
    }
  }

  return [];
}

function firstArrayFromPaths(source: PlainObject | undefined, paths: readonly string[]): unknown[] {
  for (const path of paths) {
    const value = readPath(source, path);
    if (Array.isArray(value) && value.length > 0) {
      return value;
    }
  }

  return [];
}

function stringArrayFromValue(value: unknown): string[] {
  if (typeof value === "string") {
    return value.trim() ? [value.trim()] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const id = stringId(entry);
    return id ? [id] : [];
  });
}

function firstIsoDateFromPaths(source: PlainObject | undefined, paths: readonly string[]): string | undefined {
  for (const path of paths) {
    const date = extractIsoDatePrefix(stringId(readPath(source, path)) ?? "");
    if (date) {
      return date;
    }
  }

  return undefined;
}

function firstStrictIsoDateFromPaths(
  source: PlainObject | undefined,
  paths: readonly string[],
): string | undefined {
  const date = firstIsoDateFromPaths(source, paths);
  return date && isStrictIsoDate(date) ? date : undefined;
}

function trimOptionalToLength(value: string | undefined, maxLength: number): string | undefined {
  return value ? trimToLength(value, maxLength) : undefined;
}

function trimSlugToLength(value: string, maxLength: number): string {
  return value.slice(0, maxLength).replace(/-+$/u, "") || "workout";
}

function firstValueFromPaths(source: PlainObject | undefined, paths: readonly string[]): unknown {
  for (const path of paths) {
    const value = readPath(source, path);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function readPath(source: PlainObject | undefined, path: string): unknown {
  if (!source) {
    return undefined;
  }

  return path.split(".").reduce<unknown>((current, key) => {
    const record = asPlainObject(current);
    return record ? record[key] : undefined;
  }, source);
}

export const junctionProviderAdapter: DeviceProviderAdapter<JunctionSnapshotInput> = {
  ...JUNCTION_DEVICE_PROVIDER_DESCRIPTOR,
  parseSnapshot: parseJunctionSnapshot,
  sanitizeRawSnapshot: sanitizeJunctionRawSnapshot,
  normalizeSnapshot: normalizeJunctionSnapshot,
};
