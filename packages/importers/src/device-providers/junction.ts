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
  pushRawArtifact,
  slugify,
  stringId,
  trimToLength,
} from "./shared-normalization.ts";

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

export const JUNCTION_DEFAULT_SUMMARY_RESOURCES = Object.freeze([
  "profile",
  "activity",
  "sleep",
  "workouts",
  "body",
] as const);

export const JUNCTION_DEFAULT_TIMESERIES_RESOURCES = Object.freeze([
  "steps",
  "heartrate",
  "hrv",
  "respiratory_rate",
  "blood_oxygen",
  "weight",
] as const);

export const JUNCTION_OPT_IN_TIMESERIES_RESOURCES = Object.freeze([
  "glucose",
] as const);

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
type OriginConfidence = NonNullable<DeviceDataOrigin["originConfidence"]>;

interface ResourceContext {
  resource: string;
  resourceSlug: string;
  sourceProviderSlug: string;
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

interface MetricDescriptor {
  metric: string;
  unit: string;
  title: string;
  paths: readonly string[];
}

interface SampleStreamDescriptor {
  stream: string;
  unit: string;
  paths: readonly string[];
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
  { metric: "sleep-total-minutes", unit: "minutes", title: "Junction total sleep", paths: ["totalSleepMinutes", "total_sleep_minutes", "asleep_minutes"] },
  { metric: "sleep-deep-minutes", unit: "minutes", title: "Junction deep sleep", paths: ["deepMinutes", "deep_minutes"] },
  { metric: "sleep-rem-minutes", unit: "minutes", title: "Junction REM sleep", paths: ["remMinutes", "rem_minutes"] },
  { metric: "sleep-light-minutes", unit: "minutes", title: "Junction light sleep", paths: ["lightMinutes", "light_minutes"] },
  { metric: "sleep-awake-minutes", unit: "minutes", title: "Junction awake time", paths: ["awakeMinutes", "awake_minutes"] },
  { metric: "hrv", unit: "ms", title: "Junction sleep HRV", paths: ["hrv", "hrvRmssd", "hrv_rmssd"] },
  { metric: "resting-heart-rate", unit: "bpm", title: "Junction resting heart rate", paths: ["restingHeartRate", "resting_heart_rate"] },
  { metric: "respiratory-rate", unit: "breaths_per_minute", title: "Junction respiratory rate", paths: ["respiratoryRate", "respiratory_rate"] },
  { metric: "spo2", unit: "%", title: "Junction blood oxygen", paths: ["spo2", "bloodOxygen", "blood_oxygen", "oxygen_saturation"] },
];

const TIMESERIES_STREAMS: Readonly<Record<string, SampleStreamDescriptor>> = Object.freeze({
  steps: { stream: "steps", unit: "count", paths: ["value", "steps", "step_count"] },
  heartrate: { stream: "heart_rate", unit: "bpm", paths: ["value", "heartRate", "heart_rate", "bpm"] },
  hrv: { stream: "hrv", unit: "ms", paths: ["value", "hrv", "hrvRmssd", "hrv_rmssd"] },
  respiratory_rate: {
    stream: "respiratory_rate",
    unit: "breaths_per_minute",
    paths: ["value", "respiratoryRate", "respiratory_rate"],
  },
  blood_oxygen: { stream: "spo2", unit: "%", paths: ["value", "spo2", "bloodOxygen", "blood_oxygen", "oxygen_saturation"] },
  glucose: { stream: "glucose", unit: "mg_dL", paths: ["value", "glucose", "bloodGlucose", "blood_glucose"] },
});

const TIMESERIES_OBSERVATION_METRICS: Readonly<Record<string, MetricDescriptor>> = Object.freeze({
  weight: { metric: "weight", unit: "kg", title: "Junction body weight", paths: ["value", "weightKg", "weight_kg", "weight"] },
});

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
    samples,
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
        buildRawResourcePayload(resource, payload),
      ),
    );

    entries.forEach((entry, index) => {
      const resourceContext = buildResourceContext({
        entry,
        resource,
        resourceSlug,
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
    const entries = resourceEntries(payload);
    const resourceSlug = slugify(resource, "timeseries");
    const streamDescriptor = TIMESERIES_STREAMS[resource];
    const observationDescriptor = TIMESERIES_OBSERVATION_METRICS[resource];
    pushRawArtifact(
      context.rawArtifacts,
      createRawArtifact(
        `junction-timeseries-${resourceSlug}`,
        `junction-timeseries-${resourceSlug}.json`,
        buildRawResourcePayload(resource, payload),
      ),
    );

    if (!streamDescriptor && !observationDescriptor) {
      continue;
    }

    entries.forEach((entry, index) => {
      const resourceContext = buildResourceContext({
        entry,
        resource,
        resourceSlug,
        index,
        fallbackArtifactRole: `junction-timeseries-${resourceSlug}`,
        context,
      });

      if (!resourceContext) {
        return;
      }

      const value = firstNumberFromPaths(entry, streamDescriptor?.paths ?? observationDescriptor?.paths ?? []);
      const timestamp = resolveRecordTimestamp(entry, context);

      if (value === undefined || !timestamp.occurredAt) {
        return;
      }

      if (streamDescriptor) {
        context.samples.push(stripUndefined({
          stream: streamDescriptor.stream,
          recordedAt: timestamp.occurredAt,
          dayKey: timestamp.dayKey,
          timeZone: firstStringFromPaths(entry, ["timeZone", "timezone", "time_zone"]),
          source: "device",
          quality: "normalized",
          unit: firstStringFromPaths(entry, ["unit"]) ?? streamDescriptor.unit,
          externalRef: makeJunctionExternalRef(resourceContext, entry, "sample"),
          dataOrigin: buildDataOrigin(entry, resourceContext, timestamp),
          sample: {
            recordedAt: timestamp.occurredAt,
            value,
          },
        }));
        return;
      }

      if (observationDescriptor) {
        context.events.push(stripUndefined({
          kind: "observation",
          occurredAt: timestamp.occurredAt,
          recordedAt: timestamp.recordedAt,
          dayKey: timestamp.dayKey,
          timeZone: firstStringFromPaths(entry, ["timeZone", "timezone", "time_zone"]),
          source: "device",
          title: observationDescriptor.title,
          rawArtifactRoles: resourceContext.rawArtifactRoles,
          externalRef: makeJunctionExternalRef(resourceContext, entry, observationDescriptor.metric),
          dataOrigin: buildDataOrigin(entry, resourceContext, timestamp),
          fields: {
            metric: observationDescriptor.metric,
            unit: firstStringFromPaths(entry, ["unit"]) ?? observationDescriptor.unit,
            value,
          },
        }));
      }
    });
  }
}

function buildRawResourcePayload(resource: string, payload: unknown): unknown {
  if (resource !== "profile") {
    return payload;
  }

  if (Array.isArray(payload)) {
    return payload.flatMap((entry) => {
      const sanitized = sanitizeProfilePayload(entry);
      return sanitized ? [sanitized] : [];
    });
  }

  return sanitizeProfilePayload(payload);
}

function sanitizeProfilePayload(payload: unknown): PlainObject | undefined {
  const profile = asPlainObject(payload);
  if (!profile) {
    return undefined;
  }

  const sanitized = stripUndefined({
    sourceProviderSlug: normalizeSourceProviderSlug(firstStringFromPaths(profile, ["sourceProviderSlug", "source_provider_slug"])),
    sourceType: firstStringFromPaths(profile, ["sourceType", "source_type", "source.type"]),
  });

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function pushSleepSummary(
  entry: PlainObject,
  resourceContext: ResourceContext,
  context: NormalizationContext,
): void {
  const timestamp = resolveRecordTimestamp(entry, context);
  const startAt = resolveSafeTimestamp(firstValueFromPaths(entry, ["startAt", "start_at", "bedtimeStart", "bedtime_start"]));
  const endAt = resolveSafeTimestamp(firstValueFromPaths(entry, ["endAt", "end_at", "bedtimeEnd", "bedtime_end"]));
  const durationMinutes = firstNumberFromPaths(entry, ["durationMinutes", "duration_minutes", "totalSleepMinutes", "total_sleep_minutes"]);

  if (startAt || endAt || durationMinutes !== undefined) {
    const occurredAt = endAt ?? startAt ?? timestamp.occurredAt;
    if (occurredAt) {
      context.events.push(stripUndefined({
        kind: "sleep_session",
        occurredAt,
        recordedAt: timestamp.recordedAt,
        dayKey: timestamp.dayKey,
        timeZone: firstStringFromPaths(entry, ["timeZone", "timezone", "time_zone"]),
        source: "device",
        title: "Junction sleep",
        rawArtifactRoles: resourceContext.rawArtifactRoles,
        externalRef: makeJunctionExternalRef(resourceContext, entry, "session"),
        dataOrigin: buildDataOrigin(entry, resourceContext, timestamp),
        fields: stripUndefined({
          startAt,
          endAt,
          durationMinutes,
        }),
      }));
    }
  }

  pushObservationMetrics(entry, resourceContext, context, SLEEP_METRICS);
}

function pushWorkoutSummary(
  entry: PlainObject,
  resourceContext: ResourceContext,
  context: NormalizationContext,
): void {
  const timestamp = resolveRecordTimestamp(entry, context);
  const startAt = resolveSafeTimestamp(firstValueFromPaths(entry, ["startAt", "start_at", "start"]));
  const endAt = resolveSafeTimestamp(firstValueFromPaths(entry, ["endAt", "end_at", "end"]));
  const occurredAt = endAt ?? startAt ?? timestamp.occurredAt;

  if (!occurredAt) {
    return;
  }

  context.events.push(stripUndefined({
    kind: "activity_session",
    occurredAt,
    recordedAt: timestamp.recordedAt,
    dayKey: timestamp.dayKey,
    timeZone: firstStringFromPaths(entry, ["timeZone", "timezone", "time_zone"]),
    source: "device",
    title: trimToLength(firstStringFromPaths(entry, ["title", "name", "sport", "activityType", "activity_type"]) ?? "Junction workout", 160),
    rawArtifactRoles: resourceContext.rawArtifactRoles,
    externalRef: makeJunctionExternalRef(resourceContext, entry, "session"),
    dataOrigin: buildDataOrigin(entry, resourceContext, timestamp),
    fields: stripUndefined({
      startAt,
      endAt,
      durationMinutes: firstNumberFromPaths(entry, ["durationMinutes", "duration_minutes", "movingTimeMinutes", "moving_time_minutes"]),
      activityType: firstStringFromPaths(entry, ["activityType", "activity_type", "sport", "type"]),
      distanceKm: firstNumberFromPaths(entry, ["distanceKm", "distance_km"]),
      totalCalories: firstNumberFromPaths(entry, ["calories", "totalCalories", "total_calories"]),
      averageHeartRate: firstNumberFromPaths(entry, ["averageHeartRate", "average_heart_rate", "avg_hr"]),
      maxHeartRate: firstNumberFromPaths(entry, ["maxHeartRate", "max_heart_rate", "max_hr"]),
    }),
  }));
}

function pushObservationMetrics(
  entry: PlainObject,
  resourceContext: ResourceContext,
  context: NormalizationContext,
  metrics: readonly MetricDescriptor[],
): void {
  const timestamp = resolveRecordTimestamp(entry, context);

  if (!timestamp.occurredAt) {
    return;
  }

  for (const metric of metrics) {
    const value = firstNumberFromPaths(entry, metric.paths);
    if (value === undefined) {
      continue;
    }

    context.events.push(stripUndefined({
      kind: "observation",
      occurredAt: timestamp.occurredAt,
      recordedAt: timestamp.recordedAt,
      dayKey: timestamp.dayKey,
      timeZone: firstStringFromPaths(entry, ["timeZone", "timezone", "time_zone"]),
      source: "device",
      title: metric.title,
      rawArtifactRoles: resourceContext.rawArtifactRoles,
      externalRef: makeJunctionExternalRef(resourceContext, entry, metric.metric),
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
  resource: string;
  resourceSlug: string;
  index: number;
  fallbackArtifactRole: string;
  context: NormalizationContext;
}): ResourceContext | null {
  const connection = resolveEntryConnection(input.entry, input.context.connectionsByKey);
  const sourceProviderSlug = normalizeSourceProviderSlug(
    firstStringFromPaths(input.entry, [
      "sourceProviderSlug",
      "source_provider_slug",
    ]) ?? firstStringFromPaths(connection, [
      "sourceProviderSlug",
      "source_provider_slug",
    ]),
  );

  if (!sourceProviderSlug) {
    return null;
  }

  const resourceType = buildJunctionResourceType(sourceProviderSlug, input.resourceSlug);
  return {
    resource: input.resource,
    resourceSlug: input.resourceSlug,
    sourceProviderSlug,
    externalRefResourceType: resourceType,
    artifactRole: input.fallbackArtifactRole,
    artifactFileName: `${input.fallbackArtifactRole}.json`,
    rawArtifactRoles: [input.fallbackArtifactRole],
    connection,
  };
}

function buildDataOrigin(
  entry: PlainObject,
  resourceContext: ResourceContext,
  timestamp: ReturnType<typeof resolveRecordTimestamp>,
): DeviceDataOrigin {
  return stripUndefined({
    version: 1 as const,
    aggregatorProvider: "junction",
    sourceProviderSlug: resourceContext.sourceProviderSlug,
    sourceType: firstStringFromPaths(entry, ["sourceType", "source_type", "source.type"])
      ?? firstStringFromPaths(resourceContext.connection, ["sourceType", "source_type", "source.type"]),
    sourceInstanceId: buildSourceInstanceId(entry, resourceContext),
    observedAtRaw: timestamp.observedAtRaw,
    timeZoneOffsetMinutes: firstNullableNumberFromPaths(entry, ["timeZoneOffsetMinutes", "time_zone_offset_minutes", "utcOffsetMinutes", "utc_offset_minutes"]),
    timestampSemantics: timestamp.timestampSemantics,
    originConfidence: firstOriginConfidence(entry, resourceContext.connection),
    normalizerVersion: "junction-normalizer.v1",
  });
}

function buildSourceInstanceId(
  entry: PlainObject,
  resourceContext: ResourceContext,
): string | undefined {
  const values = [
    firstStringFromPaths(entry, ["sourceId", "source_id", "connectionId", "connection_id"]),
    firstStringFromPaths(resourceContext.connection, ["sourceId", "source_id", "id", "connectionId", "connection_id"]),
    firstStringFromPaths(entry, ["sourceDeviceId", "source_device_id", "deviceId", "device_id", "source.device_id", "source.deviceId"]),
    firstStringFromPaths(resourceContext.connection, ["sourceDeviceId", "source_device_id", "deviceId", "device_id", "source.device_id", "source.deviceId"]),
    firstStringFromPaths(entry, ["sourceAppId", "source_app_id", "appId", "app_id", "source.app_id", "source.appId"]),
    firstStringFromPaths(resourceContext.connection, ["sourceAppId", "source_app_id", "appId", "app_id", "source.app_id", "source.appId"]),
  ].filter((value): value is string => Boolean(value));

  if (values.length === 0) {
    return undefined;
  }

  const digest = createHash("sha256")
    .update(JSON.stringify({
      sourceProviderSlug: resourceContext.sourceProviderSlug,
      values,
    }))
    .digest("hex")
    .slice(0, 24);

  return `source-${digest}`;
}

function makeJunctionExternalRef(
  resourceContext: ResourceContext,
  entry: PlainObject,
  facet: string,
): DeviceExternalRefPayload {
  return makeProviderExternalRef(
    "junction",
    resourceContext.externalRefResourceType,
    buildStableResourceId(resourceContext, entry),
    undefined,
    slugify(facet, "value"),
  );
}

function buildJunctionResourceType(sourceProviderSlug: string, resourceSlug: string): string {
  return `junction-${slugify(sourceProviderSlug, "source")}-${slugify(resourceSlug, "resource")}`;
}

function buildStableResourceId(resourceContext: ResourceContext, entry: PlainObject): string {
  const explicitId = firstStringFromPaths(entry, ["id", "resourceId", "resource_id", "externalId", "external_id"]);
  const observedAt = firstStringFromPaths(entry, ["observedAt", "observed_at", "timestamp", "time", "date", "day"]);
  const digest = createHash("sha256")
    .update(JSON.stringify({
      resource: resourceContext.resource,
      sourceProviderSlug: resourceContext.sourceProviderSlug,
      explicitId,
      observedAt,
      entry,
    }))
    .digest("hex")
    .slice(0, 16);
  return `${resourceContext.resourceSlug}-${digest}`;
}

function resolveRecordTimestamp(
  entry: PlainObject,
  context: Pick<NormalizationContext, "importedAt" | "windowEnd" | "windowStart">,
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
  ]);
  const explicitSemantics = firstTimestampSemantics(entry);
  const timestampSemantics = explicitSemantics ?? inferTimestampSemantics(rawObservedAt);
  const occurredAt = timestampSemantics === "floating"
    ? context.windowEnd ?? context.windowStart ?? context.importedAt
    : resolveSafeTimestamp(rawObservedAt) ?? context.windowEnd ?? context.windowStart ?? context.importedAt;
  const recordedAt = resolveSafeTimestamp(firstValueFromPaths(entry, ["recordedAt", "recorded_at", "updatedAt", "updated_at"]))
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

  return Object.entries(resources).flatMap(([resource, payload]) => {
    const normalized = normalizeResourceKey(resource);
    return normalized && allowlist.has(normalized) ? [[normalized, payload] as const] : [];
  });
}

function resourceEntries(payload: unknown): PlainObject[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((entry) => {
      const normalized = asPlainObject(entry);
      return normalized ? [normalized] : [];
    });
  }

  const normalized = asPlainObject(payload);
  return normalized ? [normalized] : [];
}

function listAllowedResourceKeys(
  resources: Record<string, unknown> | undefined,
  allowlist: ReadonlySet<string>,
): string[] {
  return allowedResourceEntries(resources, allowlist).map(([resource]) => resource);
}

function normalizeResourceKey(value: string): string | undefined {
  const key = value.trim().toLowerCase().replace(/-/gu, "_");
  if (key === "heart_rate") {
    return "heartrate";
  }
  if (key === "spo2" || key === "blood_oxygen_saturation") {
    return "blood_oxygen";
  }
  return key.length > 0 ? key : undefined;
}

function normalizeSourceProviderSlug(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const slug = slugify(value, "");
  return slug && slug !== "junction" ? slug : undefined;
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

function resolveSafeTimestamp(value: unknown): string | undefined {
  const raw = typeof value === "string" ? value.trim() : value;

  if (typeof raw === "string" && inferTimestampSemantics(raw) === "floating") {
    return undefined;
  }

  return normalizeTimestamp(raw);
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

function firstOriginConfidence(
  entry: PlainObject,
  connection: PlainObject | undefined,
): OriginConfidence | undefined {
  const value = firstStringFromPaths(entry, ["originConfidence", "origin_confidence"])
    ?? firstStringFromPaths(connection, ["originConfidence", "origin_confidence"]);
  return value === "high" || value === "medium" || value === "low" || value === "unknown"
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

function firstNullableStringFromPaths(source: PlainObject | undefined, paths: readonly string[]): string | null | undefined {
  for (const path of paths) {
    const value = readPath(source, path);
    if (value === null) {
      return null;
    }

    const id = stringId(value);
    if (id) {
      return id;
    }
  }

  return undefined;
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
  normalizeSnapshot: normalizeJunctionSnapshot,
};
