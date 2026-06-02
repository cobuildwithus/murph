import { createHash } from "node:crypto";

import { extractIsoDatePrefix, type WorkoutSession } from "@murphai/contracts";
import { z } from "zod";

import { stripUndefined } from "../shared.ts";
import {
  asArray,
  asPlainObject,
  createRawArtifact,
  finiteNumber,
  makeNormalizedDeviceBatch,
  makeProviderExternalRef,
  minutesBetween,
  pushRawArtifact,
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
  readJunctionTimeseriesRawArtifactMetadata,
  type JunctionSleepStageValue,
} from "./junction-resources.ts";
import {
  normalizeJunctionSourceProviderSlug,
  readJunctionSourceProviderSlug,
  resolveJunctionOrigin,
  type JunctionOriginFallback,
} from "./junction-origin.ts";

import type {
  DeviceDataOrigin,
  DeviceEventPayload,
  DeviceExternalRefPayload,
  DeviceRawArtifactPayload,
  DeviceSamplePayload,
} from "../core-port.ts";
import type { PlainObject } from "./shared-normalization.ts";
import type { DeviceProviderAdapter, NormalizedDeviceBatch } from "./types.ts";
import { JUNCTION_DEVICE_PROVIDER_DESCRIPTOR } from "./provider-descriptors.ts";

export {
  JUNCTION_ALLOWED_SUMMARY_RESOURCES,
  JUNCTION_ALLOWED_TIMESERIES_RESOURCES,
  JUNCTION_DEFAULT_SUMMARY_RESOURCES,
  JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
  JUNCTION_OPT_IN_TIMESERIES_RESOURCES,
  JUNCTION_RAW_ONLY_SUMMARY_RESOURCES,
  JUNCTION_TIMESERIES_RESOURCE_POLICIES,
  normalizeJunctionResourceName,
  readJunctionTimeseriesRawArtifactMetadata,
  type JunctionTimeseriesRawArtifactMetadata,
  type JunctionTimeseriesResource,
} from "./junction-resources.ts";

export interface JunctionSnapshotInput {
  accountId?: string | number;
  importedAt?: string | number | Date;
  windowStart?: string | number | Date;
  windowEnd?: string | number | Date;
  connections?: unknown[];
  summaries?: Record<string, unknown>;
  timeseries?: Record<string, unknown>;
}

type TimestampSemantics = NonNullable<DeviceDataOrigin["timestampSemantics"]>;

interface ResourceContext {
  resource: string;
  resourceSlug: string;
  identityKind: "summary" | "timeseries";
  sourceProviderSlug: string;
  origin: DeviceDataOrigin;
  externalRefResourceType: string;
  artifactRole: string;
  artifactFileName: string;
  rawArtifactRoles: string[];
  connection?: PlainObject;
}

interface NormalizationContext {
  importedAt?: string;
  windowStart?: string;
  windowEnd?: string;
  connectionsByKey: ReadonlyMap<string, PlainObject>;
  rawArtifacts: DeviceRawArtifactPayload[];
  events: DeviceEventPayload[];
  samples: DeviceSamplePayload[];
}

interface JunctionResourceEntry {
  entry: PlainObject;
  originFallback?: JunctionOriginFallback;
}

interface MetricDescriptor {
  metric: string;
  unit: string;
  title: string;
  paths: readonly string[];
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
}).catchall(z.unknown());

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
  { metric: "max-heart-rate", unit: "bpm", title: "Junction activity max heart rate", paths: ["maxHeartRate", "max_heart_rate", "max_hr", "heart_rate.max_bpm"] },
  { metric: "resting-heart-rate", unit: "bpm", title: "Junction activity resting heart rate", paths: ["restingHeartRate", "resting_heart_rate", "resting_hr", "rhr", "heart_rate.resting_bpm"] },
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
const JUNCTION_WORKOUT_ID_PATHS = [
  "providerWorkoutId",
  "provider_workout_id",
  "providerId",
  "provider_id",
  "activityId",
  "activity_id",
  "id",
  "workoutId",
  "workout_id",
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
const JUNCTION_WORKOUT_STABLE_ID_PATHS = [
  ...JUNCTION_WORKOUT_ID_PATHS,
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

type JunctionSleepStage = JunctionSleepStageValue;

interface JunctionDailyTimeseriesAggregate {
  dayKey: string;
  entry: PlainObject;
  lastRecordedAt?: string;
  lastSampleAt: string;
  minValue: number;
  resourceContext: ResourceContext;
  sampleCount: number;
  sum: number;
  timestamp: ReturnType<typeof resolveRecordTimestamp>;
  timeZone?: string;
}

function parseJunctionSnapshot(snapshot: unknown): JunctionSnapshotInput {
  return junctionSnapshotSchema.parse(snapshot);
}

export function normalizeJunctionSnapshot(snapshot: JunctionSnapshotInput): NormalizedDeviceBatch {
  const importedAt = normalizeTimestamp(snapshot.importedAt);
  const windowStart = normalizeTimestamp(snapshot.windowStart);
  const windowEnd = normalizeTimestamp(snapshot.windowEnd);
  const rawArtifacts: DeviceRawArtifactPayload[] = [];
  const events: DeviceEventPayload[] = [];
  const samples: DeviceSamplePayload[] = [];
  const connections = asArray(snapshot.connections).flatMap((connection) => {
    const normalized = asPlainObject(connection);
    return normalized ? [normalized] : [];
  });
  const context: NormalizationContext = {
    importedAt,
    windowStart,
    windowEnd,
    connectionsByKey: buildConnectionsByKey(connections),
    rawArtifacts,
    events,
    samples,
  };

  normalizeSummaries(snapshot.summaries, context);
  normalizeTimeseries(snapshot.timeseries, context);

  return makeNormalizedDeviceBatch({
    provider: "junction",
    accountId: stringId(snapshot.accountId),
    importedAt,
    events,
    samples: samples.length > 0 ? samples : undefined,
    rawArtifacts,
    provenance: stripUndefined({
      schema: "junction.snapshot.v1",
      normalizerVersion: "junction-normalizer.v1",
      windowStart,
      windowEnd,
      connections: connections.length,
      summaryResources: listAllowedResourceKeys(snapshot.summaries, SUMMARY_RESOURCE_ALLOWLIST),
      timeseriesResources: listAllowedResourceKeys(snapshot.timeseries, TIMESERIES_RESOURCE_ALLOWLIST),
    }),
  });
}

function normalizeSummaries(
  summaries: Record<string, unknown> | undefined,
  context: NormalizationContext,
): void {
  for (const [resource, payload] of allowedResourceEntries(summaries, SUMMARY_RESOURCE_ALLOWLIST)) {
    const entries = resourceEntries(payload);
    const resourceSlug = slugify(resource, "summary");
    pushRawArtifact(
      context.rawArtifacts,
      createRawArtifact(
        `junction-summary-${resourceSlug}`,
        `junction-summary-${resourceSlug}.json`,
        buildRawResourcePayload(resource, payload, context.connectionsByKey),
      ),
    );

    entries.forEach(({ entry, originFallback }, index) => {
      const resourceContext = buildResourceContext({
        entry,
        originFallback,
        resource,
        resourceSlug,
        identityKind: "summary",
        index,
        fallbackArtifactRole: `junction-summary-${resourceSlug}`,
        context,
      });

      if (!resourceContext) {
        return;
      }

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
        case "sleep_cycle":
          pushSleepCycle(entry, resourceContext, context);
          break;
        case "workouts":
          pushWorkoutSummary(entry, resourceContext, context);
          break;
        case "profile":
          break;
      }
    });
  }
}

function normalizeTimeseries(
  timeseries: Record<string, unknown> | undefined,
  context: NormalizationContext,
): void {
  for (const [resource, payload] of allowedResourceEntries(timeseries, TIMESERIES_RESOURCE_ALLOWLIST)) {
    const resourceSlug = slugify(resource, "timeseries");
    pushRawArtifact(
      context.rawArtifacts,
      withJunctionTimeseriesMetadata(
        resource,
        createRawArtifact(
          `junction-timeseries-${resourceSlug}`,
          `junction-timeseries-${resourceSlug}.json`,
          buildRawResourcePayload(resource, payload, context.connectionsByKey),
        ),
      ),
    );

    if (resource === "blood_oxygen") {
      pushBloodOxygenDailyObservations(payload, resource, resourceSlug, context);
    } else if (resource === "stress_level") {
      pushStressLevelDailyObservations(payload, resource, resourceSlug, context);
    }
  }
}

function pushBloodOxygenDailyObservations(
  payload: unknown,
  resource: string,
  resourceSlug: string,
  context: NormalizationContext,
): void {
  for (const aggregate of buildJunctionDailyTimeseriesAggregates({
    payload,
    resource,
    resourceSlug,
    context,
    valuePaths: JUNCTION_BLOOD_OXYGEN_VALUE_PATHS,
    normalizeValue: normalizeBloodOxygenPercent,
  })) {
    const meanValue = roundBloodOxygenValue(aggregate.sum / aggregate.sampleCount);
    pushBloodOxygenDailyObservation(context, aggregate, {
      metric: "spo2",
      title: "Junction blood oxygen average",
      value: meanValue,
    });
    pushBloodOxygenDailyObservation(context, aggregate, {
      metric: "lowest-spo2",
      title: "Junction blood oxygen minimum",
      value: aggregate.minValue,
    });
  }
}

function pushStressLevelDailyObservations(
  payload: unknown,
  resource: string,
  resourceSlug: string,
  context: NormalizationContext,
): void {
  for (const aggregate of buildJunctionDailyTimeseriesAggregates({
    payload,
    resource,
    resourceSlug,
    context,
    valuePaths: JUNCTION_STRESS_LEVEL_VALUE_PATHS,
    normalizeValue: normalizeStressLevelScore,
  })) {
    pushStressLevelDailyObservation(context, aggregate, {
      value: roundStressLevelValue(aggregate.sum / aggregate.sampleCount),
    });
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
  const fallbackArtifactRole = `junction-timeseries-${input.resourceSlug}`;
  const aggregates = new Map<string, JunctionDailyTimeseriesAggregate>();

  for (const [index, { entry, originFallback }] of timeseriesResourceEntries(input.payload).entries()) {
    const resourceContext = buildResourceContext({
      entry,
      originFallback,
      resource: input.resource,
      resourceSlug: input.resourceSlug,
      identityKind: "timeseries",
      index,
      fallbackArtifactRole,
      context: input.context,
    });

    if (!resourceContext) {
      continue;
    }

    const value = input.normalizeValue(firstNumberFromPaths(entry, input.valuePaths));
    const timestamp = resolveRecordTimestamp(entry, input.context, resourceContext.sourceProviderSlug);
    const sampleAt = timestamp.occurredAt ?? timestamp.recordedAt;
    const dayKey = resolveJunctionTimeseriesAggregateDayKey(entry, timestamp, sampleAt);

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

    if (!existing) {
      aggregates.set(key, {
        dayKey,
        entry,
        lastRecordedAt: recordedAt,
        lastSampleAt: sampleAt,
        minValue: value,
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

    if (sampleAt >= existing.lastSampleAt) {
      existing.lastSampleAt = sampleAt;
      existing.lastRecordedAt = recordedAt;
      existing.timestamp = timestamp;
    }

    if (value < existing.minValue) {
      existing.minValue = value;
    }
  }

  return [...aggregates.values()].sort(compareJunctionDailyTimeseriesAggregates);
}

function pushBloodOxygenDailyObservation(
  context: NormalizationContext,
  aggregate: JunctionDailyTimeseriesAggregate,
  observation: {
    metric: "spo2" | "lowest-spo2";
    title: string;
    value: number;
  },
): void {
  const timestamp = withTimestampOverride(aggregate.timestamp, {
    occurredAt: aggregate.lastSampleAt,
    recordedAt: aggregate.lastRecordedAt,
    dayKey: aggregate.dayKey,
    observedAtRaw: `${aggregate.dayKey}:blood_oxygen:daily`,
  });

  context.events.push(stripUndefined({
    kind: "observation",
    occurredAt: aggregate.lastSampleAt,
    recordedAt: aggregate.lastRecordedAt,
    dayKey: aggregate.dayKey,
    timeZone: aggregate.timeZone,
    source: "device",
    title: observation.title,
    rawArtifactRoles: aggregate.resourceContext.rawArtifactRoles,
    externalRef: makeJunctionExternalRef(aggregate.resourceContext, aggregate.entry, timestamp, observation.metric),
    dataOrigin: buildDataOrigin(aggregate.entry, aggregate.resourceContext, timestamp),
    fields: {
      metric: observation.metric,
      observationGrain: "summary",
      value: roundBloodOxygenValue(observation.value),
      unit: "%",
    },
  }));
}

function pushStressLevelDailyObservation(
  context: NormalizationContext,
  aggregate: JunctionDailyTimeseriesAggregate,
  observation: {
    value: number;
  },
): void {
  const timestamp = withTimestampOverride(aggregate.timestamp, {
    occurredAt: aggregate.lastSampleAt,
    recordedAt: aggregate.lastRecordedAt,
    dayKey: aggregate.dayKey,
    observedAtRaw: `${aggregate.dayKey}:stress_level:daily`,
  });

  context.events.push(stripUndefined({
    kind: "observation",
    occurredAt: aggregate.lastSampleAt,
    recordedAt: aggregate.lastRecordedAt,
    dayKey: aggregate.dayKey,
    timeZone: aggregate.timeZone,
    source: "device",
    title: "Junction stress level average",
    rawArtifactRoles: aggregate.resourceContext.rawArtifactRoles,
    externalRef: makeJunctionExternalRef(aggregate.resourceContext, aggregate.entry, timestamp, "stress-level"),
    dataOrigin: buildDataOrigin(aggregate.entry, aggregate.resourceContext, timestamp),
    fields: {
      metric: "stress-level",
      observationGrain: "summary",
      value: roundStressLevelValue(observation.value),
      unit: "score",
    },
  }));
}

function withJunctionTimeseriesMetadata(
  resource: string,
  artifact: DeviceRawArtifactPayload | null,
): DeviceRawArtifactPayload | null {
  if (!artifact) {
    return null;
  }

  const metadata = readJunctionTimeseriesRawArtifactMetadata(resource);
  return {
    ...artifact,
    ...(metadata ? { metadata } : {}),
  };
}

function buildRawResourcePayload(
  resource: string,
  payload: unknown,
  connectionsByKey?: ReadonlyMap<string, PlainObject>,
): unknown {
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
    TIMESERIES_RESOURCE_ALLOWLIST,
    connectionsByKey,
  );

  if (!summaries && !timeseries) {
    return {};
  }

  return stripUndefined({
    ...sanitized,
    connections: sanitizeJunctionRawConnections(snapshot.connections),
    summaries,
    timeseries,
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
  const sanitized = stripUndefined({
    sourceProviderSlug: readJunctionSourceProviderSlug(profile, connection) ?? origin.sourceProviderSlug,
    sourceType: origin.sourceType,
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
  const durationMinutes =
    normalizePositiveIntegerMinutes(
      firstNumberFromPaths(entry, JUNCTION_SLEEP_DURATION_MINUTE_PATHS),
    ) ??
    normalizePositiveIntegerMinutes(
      secondsToMinutes(firstNumberFromPaths(entry, JUNCTION_SLEEP_DURATION_SECOND_PATHS)),
    ) ??
    normalizePositiveIntegerMinutes(
      millisecondsToMinutes(firstNumberFromPaths(entry, JUNCTION_SLEEP_DURATION_MILLISECOND_PATHS)),
    ) ??
    normalizePositiveIntegerMinutes(minutesBetween(startAt, endAt));

  if (startAt && endAt && durationMinutes !== undefined) {
    const occurredAt = startAt;
    context.events.push(stripUndefined({
      kind: "sleep_session",
      occurredAt,
      recordedAt: timestamp.recordedAt,
      dayKey: timestamp.dayKey,
      timeZone: firstStringFromPaths(entry, ["timeZone", "timezone", "time_zone"]),
      source: "device",
      title: "Junction sleep",
      rawArtifactRoles: resourceContext.rawArtifactRoles,
      externalRef: makeJunctionExternalRef(resourceContext, entry, timestamp, "session"),
      dataOrigin: buildDataOrigin(entry, resourceContext, timestamp),
      fields: {
        startAt,
        endAt,
        durationMinutes,
      },
    }));
  }

  pushObservationMetrics(entry, resourceContext, context, SLEEP_METRICS);
  pushJunctionRecoveryReadinessScore(entry, resourceContext, context, timestamp);
}

function pushSleepCycle(
  entry: PlainObject,
  resourceContext: ResourceContext,
  context: NormalizationContext,
): void {
  const parentTimestamp = resolveRecordTimestamp(entry, context, resourceContext.sourceProviderSlug);

  for (const [index, intervalEntry] of sleepStageIntervalEntries(entry).entries()) {
    const stage = firstSleepStageFromPaths(intervalEntry, JUNCTION_SLEEP_STAGE_VALUE_PATHS);
    if (!stage) {
      continue;
    }

    const startAtRaw = firstValueFromPaths(intervalEntry, JUNCTION_SLEEP_START_TIMESTAMP_PATHS);
    const endAtRaw = firstValueFromPaths(intervalEntry, JUNCTION_SLEEP_END_TIMESTAMP_PATHS);
    const startAt = resolveSafeTimestamp(startAtRaw, resourceContext.sourceProviderSlug);
    const endAt = resolveSafeTimestamp(endAtRaw, resourceContext.sourceProviderSlug);
    const durationMinutes =
      normalizePositiveIntegerMinutes(
        firstNumberFromPaths(intervalEntry, JUNCTION_SLEEP_STAGE_DURATION_MINUTE_PATHS),
      ) ??
      normalizePositiveIntegerMinutes(
        secondsToMinutes(firstNumberFromPaths(intervalEntry, JUNCTION_SLEEP_STAGE_DURATION_SECOND_PATHS)),
      ) ??
      normalizePositiveIntegerMinutes(
        millisecondsToMinutes(firstNumberFromPaths(intervalEntry, JUNCTION_SLEEP_STAGE_DURATION_MILLISECOND_PATHS)),
      ) ??
      normalizePositiveIntegerMinutes(minutesBetween(startAt, endAt));
    const resolvedStartAt = startAt ?? subtractMinutes(endAt, durationMinutes);
    const resolvedEndAt = endAt ?? addMinutes(startAt, durationMinutes);

    if (!resolvedStartAt || !resolvedEndAt || durationMinutes === undefined) {
      continue;
    }

    const intervalTimestamp = resolveRecordTimestamp(intervalEntry, context, resourceContext.sourceProviderSlug);
    const stageTimestamp = withTimestampOverride(intervalTimestamp, {
      occurredAt: resolvedStartAt,
      recordedAt: intervalTimestamp.recordedAt ?? parentTimestamp.recordedAt ?? resolvedStartAt,
      dayKey: extractIsoDatePrefix(resolvedStartAt) ?? intervalTimestamp.dayKey ?? parentTimestamp.dayKey,
      observedAtRaw: stringId(startAtRaw) ?? intervalTimestamp.observedAtRaw ?? parentTimestamp.observedAtRaw ?? resolvedStartAt,
      timestampSemantics: intervalTimestamp.timestampSemantics ?? parentTimestamp.timestampSemantics,
    });
    const originEntry: PlainObject = { ...entry, ...intervalEntry };

    context.samples.push(stripUndefined({
      stream: "sleep_stage",
      unit: "stage",
      recordedAt: stageTimestamp.recordedAt,
      dayKey: stageTimestamp.dayKey,
      timeZone: firstStringFromPaths(intervalEntry, ["timeZone", "timezone", "time_zone"])
        ?? firstStringFromPaths(entry, ["timeZone", "timezone", "time_zone"]),
      source: "device",
      quality: "normalized",
      externalRef: makeJunctionSleepStageExternalRef(resourceContext, originEntry, stageTimestamp, stage, index),
      dataOrigin: buildDataOrigin(originEntry, resourceContext, stageTimestamp),
      sample: {
        recordedAt: stageTimestamp.recordedAt,
        occurredAt: stageTimestamp.occurredAt,
        stage,
        startAt: resolvedStartAt,
        endAt: resolvedEndAt,
        durationMinutes,
      },
    }));
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
  const endAt = resolveSafeTimestamp(
    firstValueFromPaths(entry, ["endAt", "end_at", "end", "timeEnd", "time_end"]),
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
      dayKey: extractIsoDatePrefix(occurredAt) ?? undefined,
      observedAtRaw: stringId(startAtRaw) ?? occurredAt,
    })
    : timestamp;
  if (!occurredAt || durationMinutes === undefined) {
    return;
  }

  const dayKey = extractIsoDatePrefix(occurredAt) ?? timestamp.dayKey;
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
    firstStringFromPaths(entry, JUNCTION_WORKOUT_ID_PATHS),
    200,
  );
  const distanceKm =
    firstNumberFromPaths(entry, ["distanceKm", "distance_km"]) ??
    metersToKilometers(firstNumberFromPaths(entry, ["distanceMeters", "distance_meters", "distance"]));
  const workoutMetrics = buildWorkoutSessionMetrics(entry);

  context.events.push(stripUndefined({
    kind: "activity_session",
    occurredAt,
    recordedAt: timestamp.recordedAt,
    dayKey,
    timeZone: firstStringFromPaths(entry, ["timeZone", "timezone", "time_zone"]),
    source: "device",
    title,
    rawArtifactRoles: resourceContext.rawArtifactRoles,
    externalRef: makeJunctionExternalRef(resourceContext, entry, workoutTimestamp, "session"),
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
      const zone = asPlainObject(entry) ?? (finiteNumber(entry) !== undefined ? { duration: entry } : null);
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

    context.events.push(stripUndefined({
      kind: "observation",
      occurredAt,
      recordedAt: timestamp.recordedAt,
      dayKey: timestamp.dayKey,
      timeZone: firstStringFromPaths(entry, ["timeZone", "timezone", "time_zone"]),
      source: "device",
      title: metric.title,
      rawArtifactRoles: resourceContext.rawArtifactRoles,
      externalRef: makeJunctionExternalRef(resourceContext, entry, timestamp, metric.metric),
      dataOrigin: buildDataOrigin(entry, resourceContext, timestamp),
      fields: {
        metric: metric.metric,
        observationGrain: "summary",
        value: resolved.value,
        unit: resolved.unit,
      },
    }));
  }
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
    rawArtifactRoles: resourceContext.rawArtifactRoles,
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
  const directValue = firstNumberFromPaths(entry, metric.paths);
  if (directValue !== undefined) {
    return {
      value: directValue,
      unit: firstStringFromPaths(entry, ["unit"]) ?? metric.unit,
    };
  }

  const secondsValue = secondsToMinutes(firstNumberFromPaths(entry, metric.secondsPaths ?? []));
  if (secondsValue !== undefined) {
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

function buildResourceContext(input: {
  entry: PlainObject;
  originFallback?: JunctionOriginFallback;
  resource: string;
  resourceSlug: string;
  identityKind: "summary" | "timeseries";
  index: number;
  fallbackArtifactRole: string;
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
    rawArtifactRoles: [input.fallbackArtifactRole],
    connection,
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
): DeviceDataOrigin {
  return stripUndefined({
    ...resourceContext.origin,
    observedAtRaw: timestamp.observedAtRaw,
    timeZoneOffsetMinutes: readJunctionTimeZoneOffsetMinutes(entry),
    timestampSemantics: timestamp.timestampSemantics,
    normalizerVersion: "junction-normalizer.v1",
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
    undefined,
    slugify(facet, "value"),
  );
}

function makeJunctionSleepStageExternalRef(
  resourceContext: ResourceContext,
  entry: PlainObject,
  timestamp: ReturnType<typeof resolveRecordTimestamp>,
  stage: JunctionSleepStage,
  index: number,
): DeviceExternalRefPayload {
  return makeProviderExternalRef(
    "junction",
    resourceContext.externalRefResourceType,
    buildStableSleepStageResourceId(resourceContext, entry, timestamp, stage, index),
    undefined,
    `sleep-stage-${stage}`,
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
  const explicitId = resourceContext.resource === "workouts"
    ? firstStringFromPaths(entry, JUNCTION_WORKOUT_STABLE_ID_PATHS)
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

function buildStableSleepStageResourceId(
  resourceContext: ResourceContext,
  entry: PlainObject,
  timestamp: ReturnType<typeof resolveRecordTimestamp>,
  stage: JunctionSleepStage,
  index: number,
): string {
  const explicitId = firstStringFromPaths(entry, [
    "id",
    "stageId",
    "stage_id",
    "resourceId",
    "resource_id",
    "externalId",
    "external_id",
  ]);

  return `${resourceContext.resourceSlug}-stage-${shortHash([
    resourceContext.resourceSlug,
    resourceContext.sourceProviderSlug,
    resourceContext.origin.sourceType,
    resourceContext.origin.sourceInstanceId,
    explicitId,
    timestamp.observedAtRaw ?? timestamp.occurredAt,
    stage,
    index,
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
  const rawObservedAt = firstStringFromPaths(entry, [
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
  ]);
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
    dayKey: extractIsoDatePrefix(rawObservedAt) ?? extractIsoDatePrefix(occurredAt) ?? undefined,
    observedAtRaw: rawObservedAt,
    timestampSemantics,
  });
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
      mergeJunctionResourcePayloads(mergedEntries.get(normalized), payload),
    );
  }

  return [...mergedEntries.entries()];
}

function mergeJunctionResourcePayloads(existing: unknown, next: unknown): unknown {
  if (existing === undefined) {
    return next;
  }

  const grouped = mergeJunctionGroupedPayloads(existing, next);
  if (grouped) {
    return grouped;
  }

  const nested = mergeJunctionNestedEnvelopePayloads(existing, next);
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

function mergeJunctionNestedEnvelopePayloads(left: unknown, right: unknown): PlainObject | null {
  const leftRecord = asPlainObject(left);
  const rightRecord = asPlainObject(right);

  if (!leftRecord || !rightRecord) {
    return null;
  }

  for (const key of ["data", "results", "items", "records"]) {
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

function resourceEntries(payload: unknown): JunctionResourceEntry[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((entry) => expandResourceEntry(entry));
  }

  const normalized = asPlainObject(payload);
  return normalized ? expandResourceEntry(normalized) : [];
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

function sleepStageIntervalEntries(entry: PlainObject): PlainObject[] {
  return collectSleepStageIntervalEntries(entry);
}

function collectSleepStageIntervalEntries(value: unknown): PlainObject[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectSleepStageIntervalEntries(entry));
  }

  const entry = asPlainObject(value);
  if (!entry) {
    return [];
  }

  if (firstSleepStageFromPaths(entry, JUNCTION_SLEEP_STAGE_VALUE_PATHS)) {
    return [entry];
  }

  return JUNCTION_SLEEP_STAGE_ARRAY_PATHS.flatMap((path) => {
    const nested = readPath(entry, path);
    if (nested === value) {
      return [];
    }

    return collectSleepStageIntervalEntries(nested);
  });
}

function expandResourceEntry(value: unknown): JunctionResourceEntry[] {
  const entry = asPlainObject(value);
  if (!entry) {
    return [];
  }

  const nestedEntries = readNestedResourceEntries(entry);
  if (!nestedEntries) {
    return [{ entry }];
  }

  return nestedEntries.map((nestedEntry) => ({
    entry: mergeNestedResourceEntry(entry, nestedEntry),
    originFallback: entry,
  }));
}

function readNestedResourceEntries(envelope: PlainObject): PlainObject[] | null {
  for (const key of ["data", "results", "items", "records"]) {
    const directEntry = asPlainObject(envelope[key]);
    const entries = directEntry
      ? [directEntry]
      : asArray(envelope[key]).flatMap((entry) => {
          const normalized = asPlainObject(entry);
          return normalized ? [normalized] : [];
        });
    if (entries.length > 0) {
      return entries;
    }
  }

  return null;
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

function firstSleepStageFromPaths(source: PlainObject | undefined, paths: readonly string[]): JunctionSleepStage | undefined {
  for (const path of paths) {
    const stage = normalizeJunctionSleepStageValue(readPath(source, path));
    if (stage) {
      return stage;
    }
  }

  return undefined;
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

  return timestamp.dayKey ?? extractIsoDatePrefix(sampleAt) ?? undefined;
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
  const minuteValue = firstNullableNumberFromPaths(entry, JUNCTION_TIME_ZONE_OFFSET_MINUTE_PATHS);
  if (minuteValue !== undefined) {
    return minuteValue;
  }

  const secondValue = firstNullableNumberFromPaths(entry, JUNCTION_TIME_ZONE_OFFSET_SECOND_PATHS);

  return secondValue === undefined || secondValue === null ? secondValue : secondValue / 60;
}

function readJunctionTimeZoneOffsetSeconds(entry: PlainObject): number | null | undefined {
  const minuteValue = firstNullableNumberFromPaths(entry, JUNCTION_TIME_ZONE_OFFSET_MINUTE_PATHS);
  if (minuteValue !== undefined) {
    return minuteValue === null ? null : minuteValue * 60;
  }

  return firstNullableNumberFromPaths(entry, JUNCTION_TIME_ZONE_OFFSET_SECOND_PATHS);
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

  return roundBloodOxygenValue(numeric);
}

function normalizeStressLevelScore(value: unknown): number | undefined {
  const numeric = finiteNumber(value);

  if (numeric === undefined || numeric < 0 || numeric > 100) {
    return undefined;
  }

  return roundStressLevelValue(numeric);
}

function roundBloodOxygenValue(value: number): number {
  return Number(value.toFixed(4));
}

function roundStressLevelValue(value: number): number {
  return Number(value.toFixed(4));
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
