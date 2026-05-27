import { createHash } from "node:crypto";

import { extractIsoDatePrefix } from "@murphai/contracts";
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
  JUNCTION_DEFAULT_SUMMARY_RESOURCES,
  JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
  JUNCTION_OPT_IN_TIMESERIES_RESOURCES,
  normalizeJunctionResourceName,
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
  JUNCTION_DEFAULT_SUMMARY_RESOURCES,
  JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
  JUNCTION_OPT_IN_TIMESERIES_RESOURCES,
  normalizeJunctionResourceName,
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

const SUMMARY_RESOURCE_ALLOWLIST = new Set<string>(JUNCTION_DEFAULT_SUMMARY_RESOURCES);
const TIMESERIES_RESOURCE_ALLOWLIST = new Set<string>([
  ...JUNCTION_DEFAULT_TIMESERIES_RESOURCES,
  ...JUNCTION_OPT_IN_TIMESERIES_RESOURCES,
]);
const FLOATING_TIMESTAMP_SOURCE_PROVIDER_SLUGS = new Set([
  "abbott-libreview",
  "abbott_libreview",
  "freestyle-libre",
  "freestyle_libre",
]);
const RAW_SOURCE_IDENTIFIER_KEYS = new Set([
  "sourceName",
  "source_name",
  "sourceDeviceId",
  "source_device_id",
  "sourceAppId",
  "source_app_id",
  "deviceId",
  "device_id",
  "appId",
  "app_id",
]);
const RAW_SOURCE_NAME_KEYS = new Set([
  "displayName",
  "display_name",
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
  { metric: "active-calories", unit: "kcal", title: "Junction active calories", paths: ["activeCalories", "active_calories"] },
  { metric: "total-calories", unit: "kcal", title: "Junction total calories", paths: ["calories", "totalCalories", "total_calories"] },
  { metric: "distance-km", unit: "km", title: "Junction distance", paths: ["distanceKm", "distance_km"] },
  { metric: "activity-score", unit: "%", title: "Junction activity score", paths: ["activityScore", "activity_score", "score"] },
];

const BODY_METRICS: readonly MetricDescriptor[] = [
  { metric: "weight", unit: "kg", title: "Junction body weight", paths: ["weightKg", "weight_kg", "weight"] },
  { metric: "bmi", unit: "kg_m2", title: "Junction BMI", paths: ["bmi", "body_mass_index"] },
  { metric: "body-fat-percentage", unit: "%", title: "Junction body fat", paths: ["bodyFatPercentage", "body_fat_percentage", "body_fat_percent"] },
];

const SLEEP_METRICS: readonly MetricDescriptor[] = [
  { metric: "sleep-score", unit: "%", title: "Junction sleep score", paths: ["sleepScore", "sleep_score", "score"] },
  {
    metric: "sleep-total-minutes",
    unit: "minutes",
    title: "Junction total sleep",
    paths: ["totalSleepMinutes", "total_sleep_minutes", "asleep_minutes"],
    secondsPaths: ["total"],
  },
  { metric: "sleep-deep-minutes", unit: "minutes", title: "Junction deep sleep", paths: ["deepMinutes", "deep_minutes"], secondsPaths: ["deep"] },
  { metric: "sleep-rem-minutes", unit: "minutes", title: "Junction REM sleep", paths: ["remMinutes", "rem_minutes"], secondsPaths: ["rem"] },
  { metric: "sleep-light-minutes", unit: "minutes", title: "Junction light sleep", paths: ["lightMinutes", "light_minutes"], secondsPaths: ["light"] },
  { metric: "sleep-awake-minutes", unit: "minutes", title: "Junction awake time", paths: ["awakeMinutes", "awake_minutes"], secondsPaths: ["awake"] },
  { metric: "hrv", unit: "ms", title: "Junction sleep HRV", paths: ["hrv", "hrvRmssd", "hrv_rmssd", "average_hrv"] },
  { metric: "average-heart-rate", unit: "bpm", title: "Junction sleep average heart rate", paths: ["averageHeartRate", "average_heart_rate", "average_hr", "avg_hr", "hr_average"] },
  { metric: "resting-heart-rate", unit: "bpm", title: "Junction resting heart rate", paths: ["restingHeartRate", "resting_heart_rate", "resting_hr", "rhr"] },
  { metric: "respiratory-rate", unit: "breaths_per_minute", title: "Junction respiratory rate", paths: ["respiratoryRate", "respiratory_rate"] },
  { metric: "spo2", unit: "%", title: "Junction blood oxygen", paths: ["spo2", "bloodOxygen", "blood_oxygen", "oxygen_saturation"] },
];

const WORKOUT_METRICS: readonly MetricDescriptor[] = [
  { metric: "active-calories", unit: "kcal", title: "Junction workout calories", paths: ["calories", "totalCalories", "total_calories"] },
  { metric: "average-heart-rate", unit: "bpm", title: "Junction workout average heart rate", paths: ["averageHeartRate", "average_heart_rate", "average_hr", "avg_hr"] },
  { metric: "max-heart-rate", unit: "bpm", title: "Junction workout max heart rate", paths: ["maxHeartRate", "max_heart_rate", "max_hr"] },
];

type JunctionSleepStage = "awake" | "light" | "deep" | "rem";

const SLEEP_STAGE_VALUE_PATHS = Object.freeze([
  "stage",
  "sleepStage",
  "sleep_stage",
  "sleepStageType",
  "sleep_stage_type",
  "stageType",
  "stage_type",
  "level",
  "state",
  "name",
  "type",
  "value",
] as const);
const SLEEP_STAGE_START_PATHS = Object.freeze([
  "start",
  "startAt",
  "start_at",
  "startTime",
  "start_time",
  "startTimestamp",
  "start_timestamp",
  "timeStart",
  "time_start",
  "bedtimeStart",
  "bedtime_start",
] as const);
const SLEEP_STAGE_END_PATHS = Object.freeze([
  "end",
  "endAt",
  "end_at",
  "endTime",
  "end_time",
  "endTimestamp",
  "end_timestamp",
  "timeEnd",
  "time_end",
  "bedtimeEnd",
  "bedtime_end",
  "bedtimeStop",
  "bedtime_stop",
] as const);
const SLEEP_STAGE_INTERVAL_CONTAINER_PATHS = Object.freeze([
  "stages",
  "sleepStages",
  "sleep_stages",
  "sleepLevels",
  "sleep_levels",
  "sleepCycle",
  "sleep_cycle",
  "hypnogram",
  "intervals",
  "segments",
  "stageIntervals",
  "stage_intervals",
  "levels",
  "records",
  "items",
  "data",
] as const);

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
      createRawArtifact(
        `junction-timeseries-${resourceSlug}`,
        `junction-timeseries-${resourceSlug}.json`,
        buildRawResourcePayload(resource, payload, context.connectionsByKey),
      ),
    );
  }
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

  return stripUndefined({
    ...sanitized,
    connections: sanitizeJunctionRawConnections(snapshot.connections),
    summaries: sanitizeJunctionRawResourceMap(snapshot.summaries, connectionsByKey),
    timeseries: sanitizeJunctionRawResourceMap(snapshot.timeseries, connectionsByKey),
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
  connectionsByKey?: ReadonlyMap<string, PlainObject>,
): Record<string, unknown> | undefined {
  if (!resources) {
    return undefined;
  }

  const entries = Object.entries(resources)
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
  const normalized = normalizeJunctionRawSourceKey(key);
  return RAW_SOURCE_IDENTIFIER_KEYS.has(key)
    || RAW_SOURCE_LINKAGE_KEY_PARTS.some((part) => normalized === part)
    || (inSourceObject && RAW_SOURCE_CONTAINER_LINKAGE_KEY_PARTS.some((part) => normalized === part))
    || (inSourceObject && RAW_SOURCE_NAME_KEYS.has(key));
}

function normalizeJunctionRawSourceKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]+/gu, "");
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
    firstValueFromPaths(entry, ["startAt", "start_at", "bedtimeStart", "bedtime_start"]),
    resourceContext.sourceProviderSlug,
  );
  const endAt = resolveSafeTimestamp(
    firstValueFromPaths(entry, ["endAt", "end_at", "bedtimeEnd", "bedtime_end", "bedtimeStop", "bedtime_stop"]),
    resourceContext.sourceProviderSlug,
  );
  const durationMinutes =
    normalizePositiveIntegerMinutes(
      firstNumberFromPaths(entry, ["durationMinutes", "duration_minutes", "totalSleepMinutes", "total_sleep_minutes"]),
    ) ??
    normalizePositiveIntegerMinutes(
      secondsToMinutes(firstNumberFromPaths(entry, ["durationSeconds", "duration_seconds", "duration", "total"])),
    ) ??
    normalizePositiveIntegerMinutes(
      millisecondsToMinutes(firstNumberFromPaths(entry, ["durationMillis", "duration_millis"])),
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
}

function pushSleepCycle(
  entry: PlainObject,
  resourceContext: ResourceContext,
  context: NormalizationContext,
): void {
  const parentTimestamp = resolveRecordTimestamp(entry, context, resourceContext.sourceProviderSlug);

  for (const [index, intervalEntry] of sleepStageIntervalEntries(entry).entries()) {
    const stage = firstSleepStageFromPaths(intervalEntry, SLEEP_STAGE_VALUE_PATHS);
    if (!stage) {
      continue;
    }

    const startAtRaw = firstValueFromPaths(intervalEntry, SLEEP_STAGE_START_PATHS);
    const endAtRaw = firstValueFromPaths(intervalEntry, SLEEP_STAGE_END_PATHS);
    const startAt = resolveSafeTimestamp(startAtRaw, resourceContext.sourceProviderSlug);
    const endAt = resolveSafeTimestamp(endAtRaw, resourceContext.sourceProviderSlug);
    const durationMinutes =
      normalizePositiveIntegerMinutes(
        firstNumberFromPaths(intervalEntry, ["durationMinutes", "duration_minutes", "durationInMinutes", "duration_in_minutes", "minutes"]),
      ) ??
      normalizePositiveIntegerMinutes(
        secondsToMinutes(
          firstNumberFromPaths(intervalEntry, ["durationSeconds", "duration_seconds", "durationInSeconds", "duration_in_seconds", "duration"]),
        ),
      ) ??
      normalizePositiveIntegerMinutes(
        millisecondsToMinutes(
          firstNumberFromPaths(intervalEntry, ["durationMillis", "duration_millis", "durationInMilliseconds", "duration_in_milliseconds"]),
        ),
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
  const occurredAt = startAt ?? (endAt ? undefined : timestamp.occurredAt);
  const durationMinutes =
    normalizePositiveIntegerMinutes(
      firstNumberFromPaths(entry, ["durationMinutes", "duration_minutes", "movingTimeMinutes", "moving_time_minutes"]),
    ) ??
    normalizePositiveIntegerMinutes(
      secondsToMinutes(firstNumberFromPaths(entry, ["durationSeconds", "duration_seconds", "movingTime", "moving_time", "duration"])),
    ) ??
    normalizePositiveIntegerMinutes(
      millisecondsToMinutes(firstNumberFromPaths(entry, ["durationMillis", "duration_millis"])),
    ) ??
    normalizePositiveIntegerMinutes(minutesBetween(startAt, endAt));

  const workoutTimestamp = occurredAt
    ? withTimestampOverride(timestamp, {
      occurredAt,
      dayKey: extractIsoDatePrefix(occurredAt) ?? undefined,
      observedAtRaw: stringId(startAtRaw) ?? occurredAt,
    })
    : timestamp;
  pushObservationMetrics(entry, resourceContext, context, WORKOUT_METRICS, workoutTimestamp);

  if (!occurredAt || durationMinutes === undefined) {
    return;
  }

  const dayKey = extractIsoDatePrefix(occurredAt) ?? timestamp.dayKey;
  const rawActivityType = firstStringFromPaths(entry, ["activityType", "activity_type", "sport.slug", "sport.name", "sport", "type"]);
  const activityType = slugify(rawActivityType, "workout");
  const title = trimToLength(
    firstStringFromPaths(entry, ["title", "name", "sport.name", "sport", "activityType", "activity_type"]) ?? "Junction workout",
    160,
  );
  const sourceWorkoutId = trimOptionalToLength(
    firstStringFromPaths(entry, ["providerId", "provider_id", "id", "workoutId", "workout_id"]),
    200,
  );
  const distanceKm =
    firstNumberFromPaths(entry, ["distanceKm", "distance_km"]) ??
    metersToKilometers(firstNumberFromPaths(entry, ["distanceMeters", "distance_meters", "distance"]));

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
        startedAt: startAt ?? occurredAt,
        endedAt: endAt,
        sessionNote: title,
        exercises: [],
      }),
    }),
  }));
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
    const value = firstNumberFromPaths(entry, metric.paths)
      ?? secondsToMinutes(firstNumberFromPaths(entry, metric.secondsPaths ?? []));
    if (value === undefined) {
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
        value,
        unit: firstStringFromPaths(entry, ["unit"]) ?? metric.unit,
      },
    }));
  }
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
    timeZoneOffsetMinutes: firstNullableNumberFromPaths(entry, ["timeZoneOffsetMinutes", "time_zone_offset_minutes", "utcOffsetMinutes", "utc_offset_minutes"]),
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
  const explicitId = firstStringFromPaths(entry, [
    "id",
    "resourceId",
    "resource_id",
    "externalId",
    "external_id",
    "providerId",
    "provider_id",
    "workoutId",
    "workout_id",
  ]);

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

  if (firstSleepStageFromPaths(entry, SLEEP_STAGE_VALUE_PATHS)) {
    return [entry];
  }

  return SLEEP_STAGE_INTERVAL_CONTAINER_PATHS.flatMap((path) => {
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
    const stage = normalizeJunctionSleepStage(readPath(source, path));
    if (stage) {
      return stage;
    }
  }

  return undefined;
}

function normalizeJunctionSleepStage(value: unknown): JunctionSleepStage | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");

  switch (normalized) {
    case "awake":
    case "wake":
    case "waking":
    case "wakefulness":
      return "awake";
    case "light":
    case "light_sleep":
    case "core":
    case "core_sleep":
    case "n1":
    case "n2":
      return "light";
    case "deep":
    case "deep_sleep":
    case "slow_wave":
    case "slow_wave_sleep":
    case "sws":
    case "n3":
      return "deep";
    case "rem":
    case "rem_sleep":
    case "rapid_eye_movement":
    case "rapid_eye_movement_sleep":
      return "rem";
    default:
      return undefined;
  }
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
