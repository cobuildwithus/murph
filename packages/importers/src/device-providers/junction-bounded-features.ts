import { resolveJunctionTimeseriesResourcePolicy } from "@murphai/contracts";

import { stripUndefined } from "../shared.ts";
import { resolveJunctionOrigin } from "./junction-origin.ts";
import { stableStringify } from "./raw-ingest-receipt.ts";
import { asPlainObject, finiteNumber, stringId } from "./shared-normalization.ts";

import type { PlainObject } from "./shared-normalization.ts";

export const JUNCTION_ECG_VOLTAGE_FEATURE_SCHEMA = "junction.ecg_voltage_feature.v1";
export const JUNCTION_WORKOUT_STREAM_FEATURE_SCHEMA = "junction.workout_stream_feature.v2";

const ECG_IDS = ["junctionGroupId", "recordingId", "recording_id"] as const;
const WORKOUT_IDS = ["workoutId", "workout_id", "id"] as const;
const MAX_FEATURE_BYTES = 16_384;
const MAX_WORKOUT_SPLITS = 64;

const ECG_FIELDS = new Set([
  "schema", "id", "recordingId", "sessionStart", "sessionEnd",
  "durationSeconds", "voltageSampleCount", "voltageUnit", "voltageMin", "voltageMax",
  "voltageMean", "voltageRms", "leadType", "leadCount", "sourceProviderSlug",
  "sourceType", "sourceInstanceId",
]);
const WORKOUT_FIELDS = new Set([
  "schema", "id", "workoutId", "sport", "startAt", "endAt",
  "durationSeconds", "distanceMeters", "averageHeartRate", "maxHeartRate",
  "firstHalfAverageHeartRate", "secondHalfAverageHeartRate",
  "averageCadence", "maxCadence", "cadenceUnit", "averagePower", "maxPower",
  "averageSpeed", "maxSpeed", "sampleCount", "splits", "version",
  "workoutDayKey",
  "sourceProviderSlug", "sourceType", "sourceInstanceId",
]);

const WORKOUT_SPLIT_FIELDS = new Set([
  "index", "distanceMeters", "durationSeconds", "endedAt",
  "averageHeartRate", "averageCadence", "cadenceUnit", "averagePower",
]);

export interface JunctionElectrocardiogramVoltageReductionLimits {
  readonly maxRecordings: number;
  readonly maxSamples: number;
}

export interface JunctionWorkoutStreamCandidate {
  readonly identity: string;
  readonly summary: PlainObject;
  readonly workoutId: string;
}

export interface JunctionWorkoutStreamReductionInput {
  readonly maxSamples: number;
  readonly stream: unknown;
  readonly summary: unknown;
}

interface EcgSample {
  readonly lead: string;
  readonly recordingId?: string;
  readonly sourceInstanceId?: string;
  readonly sourceProviderSlug: string;
  readonly sourceType?: string;
  readonly timestamp: string;
  readonly timestampMs: number;
  readonly unit: string;
  readonly value: number;
}

interface WorkoutPoint {
  readonly distanceMeters?: number;
  readonly index: number;
  readonly timeMs: number;
}

export function reduceJunctionElectrocardiogramVoltageRecords(
  records: readonly unknown[],
  limits: JunctionElectrocardiogramVoltageReductionLimits,
): PlainObject[] {
  positiveInteger(limits.maxRecordings, "ECG recording limit");
  positiveInteger(limits.maxSamples, "ECG sample limit");
  if (records.length > limits.maxSamples) {
    invalid(`ECG exceeded ${limits.maxSamples} samples`);
  }

  const identified = new Map<string, EcgSample[]>();
  records.forEach((value, index) => {
    const sample = parseEcgSample(value, index);
    const source = stableStringify([
      sample.sourceProviderSlug,
      sample.sourceType ?? null,
      sample.sourceInstanceId ?? null,
      sample.unit,
    ]);
    const key = `${source}:${sample.recordingId}`;
    const bucket = identified.get(key) ?? [];
    bucket.push(sample);
    identified.set(key, bucket);
  });

  const recordings = [...identified.values()];
  if (recordings.length > limits.maxRecordings) {
    invalid(`ECG exceeded ${limits.maxRecordings} recordings`);
  }
  return resolveJunctionBoundedFeatureRecords(
    "electrocardiogram_voltage",
    recordings.map(reduceEcgRecording),
  );
}

export function selectJunctionWorkoutStreamCandidates(
  records: readonly unknown[],
  maxWorkouts: number,
): JunctionWorkoutStreamCandidate[] {
  positiveInteger(maxWorkouts, "workout limit");
  const selected = new Map<string, JunctionWorkoutStreamCandidate>();
  records.forEach((value, index) => {
    const summary = record(value, `workout index ${index}`);
    const workoutId = consistentId(summary, WORKOUT_IDS, "workout index");
    const provider = resolveJunctionOrigin(summary).sourceProviderSlug;
    if (!workoutId || !provider) invalid("workout index lacked identity");
    const key = buildJunctionBoundedFeatureIdentity("workout_stream", summary);
    const existing = selected.get(key);
    if (existing && stableStringify(existing.summary) !== stableStringify(summary)) {
      invalid(`workout index contained conflicting workout ${workoutId}`);
    }
    selected.set(key, { identity: key, summary, workoutId });
  });
  if (selected.size > maxWorkouts) {
    invalid(`workout index exceeded ${maxWorkouts} workouts`);
  }
  return [...selected.values()].sort((left, right) =>
    left.identity < right.identity ? -1 : left.identity > right.identity ? 1 : 0,
  );
}

export function reduceJunctionWorkoutStreamPayload(
  input: JunctionWorkoutStreamReductionInput,
): PlainObject {
  positiveInteger(input.maxSamples, "workout sample limit");
  const summary = record(input.summary, "workout summary");
  const stream = record(input.stream, "workout stream");
  const times = array(stream.time, "workout time");
  if (times.length === 0 || times.length > input.maxSamples) {
    invalid(`workout stream must contain 1-${input.maxSamples} timestamps`);
  }
  const heartRates = parallelArray(
    stream.heartrate ?? stream.heart_rate,
    times.length,
    "heartrate",
  );
  const distances = parallelArray(stream.distance, times.length, "distance");
  const cadence = parallelArray(stream.cadence, times.length, "cadence");
  const power = parallelArray(stream.power, times.length, "power");
  const speeds = parallelArray(stream.velocity_smooth, times.length, "velocity_smooth");
  if (!heartRates && !distances && !cadence && !power && !speeds) {
    invalid("workout stream had no supported metrics");
  }

  const points: WorkoutPoint[] = [];
  let lastMs = Number.NEGATIVE_INFINITY;
  let lastDistance = Number.NEGATIVE_INFINITY;
  let distanceMeters: number | undefined;
  for (let index = 0; index < times.length; index += 1) {
    const at = timestampMs(times[index]);
    if (at < lastMs) {
      invalid("workout timestamps were not monotonic");
    }
    const distance = optionalNumber(distances?.[index], "distance");
    if (distance !== undefined) {
      if (distance < 0) invalid("workout distance was negative");
      distanceMeters = Math.max(distanceMeters ?? 0, distance);
    }
    const pointDistance = distance !== undefined && distance >= lastDistance
      ? distance
      : undefined;
    if (pointDistance !== undefined) {
      lastDistance = pointDistance;
    }
    points.push(stripUndefined({
      distanceMeters: pointDistance,
      index,
      timeMs: at,
    }));
    lastMs = at;
  }

  const firstMs = points[0]?.timeMs;
  const finalMs = points.at(-1)?.timeMs;
  if (firstMs === undefined || finalMs === undefined) {
    invalid("workout stream was empty");
  }
  const heartRateStats = workoutSeriesStats(heartRates, points, "heart rate", 20, 300, true);

  const workoutId = consistentId(summary, WORKOUT_IDS, "workout summary");
  const origin = resolveJunctionOrigin(summary);
  if (!workoutId || !origin.sourceProviderSlug) {
    invalid("workout summary lacked identity");
  }
  const sport = firstString(summary, ["sport.slug", "sportSlug", "sport_slug", "sport.name", "sport"]);
  const cadenceUnit = resolveWorkoutCadenceUnit(sport);
  const cadenceStats = cadenceUnit
    ? workoutSeriesStats(cadence, points, "cadence", 0, 400)
    : undefined;
  const powerStats = workoutSeriesStats(power, points, "power", 0, 5_000);
  const speedStats = workoutSeriesStats(speeds, points, "speed", 0, 150);
  const startAtRaw = firstString(summary, ["time_start", "timeStart", "startAt", "start_at", "start"]);
  const startAt = firstTimestamp(summary, ["time_start", "timeStart", "startAt", "start_at", "start"])
    ?? new Date(firstMs).toISOString();
  const endAt = firstTimestamp(summary, ["time_end", "timeEnd", "endAt", "end_at", "end"])
    ?? new Date(finalMs).toISOString();
  const durationSeconds = (Date.parse(endAt) - Date.parse(startAt)) / 1_000;
  if (durationSeconds < 0) invalid("workout duration was invalid");
  const splits = buildWorkoutSplits(stream, points, sport);

  const feature = stripUndefined({
    schema: JUNCTION_WORKOUT_STREAM_FEATURE_SCHEMA,
    id: workoutId,
    workoutId,
    sport,
    startAt,
    endAt,
    durationSeconds: round(durationSeconds),
    distanceMeters: distanceMeters === undefined ? undefined : round(distanceMeters),
    averageHeartRate: heartRateStats?.average,
    maxHeartRate: heartRateStats?.maximum,
    firstHalfAverageHeartRate: heartRateStats?.firstHalfAverage,
    secondHalfAverageHeartRate: heartRateStats?.secondHalfAverage,
    averageCadence: cadenceStats?.average,
    maxCadence: cadenceStats?.maximum,
    cadenceUnit: cadenceStats ? cadenceUnit : undefined,
    averagePower: powerStats?.average,
    maxPower: powerStats?.maximum,
    averageSpeed: speedStats?.average,
    maxSpeed: speedStats?.maximum,
    sampleCount: times.length,
    splits,
    version: firstTimestamp(summary, ["updated_at", "updatedAt"]) ?? endAt,
    workoutDayKey: resolveWorkoutDayKey(summary, startAtRaw, startAt),
    sourceProviderSlug: origin.sourceProviderSlug,
    sourceType: origin.sourceType,
    sourceInstanceId: origin.sourceInstanceId ?? undefined,
  });
  assertFeature("workout_stream", feature);
  return feature;
}

function workoutSeriesStats(
  values: readonly unknown[] | undefined,
  points: readonly WorkoutPoint[],
  label: string,
  minimum: number,
  maximum: number,
  includeHalves = false,
): {
  average: number;
  firstHalfAverage?: number;
  maximum: number;
  secondHalfAverage?: number;
} | undefined {
  if (!values || points.length === 0) {
    return undefined;
  }
  const midpoint = (points[0]?.timeMs ?? 0)
    + ((points.at(-1)?.timeMs ?? 0) - (points[0]?.timeMs ?? 0)) / 2;
  let average = 0;
  let count = 0;
  let highest = Number.NEGATIVE_INFINITY;
  let firstHalfAverage = 0;
  let firstHalfCount = 0;
  let secondHalfAverage = 0;
  let secondHalfCount = 0;

  for (const point of points) {
    const value = optionalNumber(values[point.index], label);
    if (value === undefined) {
      continue;
    }
    if (value < minimum || value > maximum) {
      invalid(`${label} was invalid`);
    }
    count += 1;
    average += (value - average) / count;
    highest = Math.max(highest, value);
    if (includeHalves && point.timeMs < midpoint) {
      firstHalfCount += 1;
      firstHalfAverage += (value - firstHalfAverage) / firstHalfCount;
    } else if (includeHalves) {
      secondHalfCount += 1;
      secondHalfAverage += (value - secondHalfAverage) / secondHalfCount;
    }
  }

  return count === 0
    ? undefined
    : stripUndefined({
        average: round(average),
        firstHalfAverage: firstHalfCount > 0 ? round(firstHalfAverage) : undefined,
        maximum: round(highest),
        secondHalfAverage: secondHalfCount > 0 ? round(secondHalfAverage) : undefined,
      });
}

function buildWorkoutSplits(
  stream: PlainObject,
  points: readonly WorkoutPoint[],
  sport: string | undefined,
): PlainObject[] {
  const distancePoints = points.filter(
    (point): point is WorkoutPoint & { distanceMeters: number } =>
      point.distanceMeters !== undefined,
  );
  const firstPoint = distancePoints[0];
  const lastPoint = distancePoints.at(-1);
  if (!firstPoint || !lastPoint || distancePoints.length < 2) {
    return [];
  }

  const splitDistanceMeters = sport?.toLowerCase().includes("swim") ? 100 : 1_000;
  const firstBoundaryIndex = Math.ceil(firstPoint.distanceMeters / splitDistanceMeters);
  const firstSplitIndex = firstBoundaryIndex + 1;
  const lastSplitIndex = Math.floor(lastPoint.distanceMeters / splitDistanceMeters);
  if (firstSplitIndex > lastSplitIndex) {
    return [];
  }

  const firstBoundary = findWorkoutSplitBoundary(
    distancePoints,
    firstBoundaryIndex * splitDistanceMeters,
    1,
  );
  if (!firstBoundary) {
    return [];
  }

  const heartRates = parallelArray(
    stream.heartrate ?? stream.heart_rate,
    points.length,
    "heartrate",
  );
  const cadence = parallelArray(stream.cadence, points.length, "cadence");
  const power = parallelArray(stream.power, points.length, "power");
  const cadenceUnit = resolveWorkoutCadenceUnit(sport);
  const splits: PlainObject[] = [];
  let previousBoundaryTimeMs = firstBoundary.timeMs;
  let searchIndex = firstBoundary.searchIndex;

  for (
    let splitIndex = firstSplitIndex;
    splitIndex <= lastSplitIndex && splits.length < MAX_WORKOUT_SPLITS;
    splitIndex += 1
  ) {
    const boundary = findWorkoutSplitBoundary(
      distancePoints,
      splitIndex * splitDistanceMeters,
      searchIndex,
    );
    if (!boundary) {
      break;
    }
    const durationSeconds = (boundary.timeMs - previousBoundaryTimeMs) / 1_000;
    if (durationSeconds > 0) {
      const averageCadence = cadenceUnit
        ? workoutSeriesWindowAverage(
            cadence,
            points,
            previousBoundaryTimeMs,
            boundary.timeMs,
            splits.length === 0,
            "cadence",
            0,
            400,
          )
        : undefined;
      splits.push(stripUndefined({
        index: splitIndex,
        distanceMeters: splitDistanceMeters,
        durationSeconds: round(durationSeconds),
        endedAt: new Date(boundary.timeMs).toISOString(),
        averageHeartRate: workoutSeriesWindowAverage(
          heartRates,
          points,
          previousBoundaryTimeMs,
          boundary.timeMs,
          splits.length === 0,
          "heart rate",
          20,
          300,
        ),
        averageCadence,
        cadenceUnit: averageCadence === undefined ? undefined : cadenceUnit,
        averagePower: workoutSeriesWindowAverage(
          power,
          points,
          previousBoundaryTimeMs,
          boundary.timeMs,
          splits.length === 0,
          "power",
          0,
          5_000,
        ),
      }));
    }
    previousBoundaryTimeMs = boundary.timeMs;
    searchIndex = boundary.searchIndex;
  }

  return splits;
}

function workoutSeriesWindowAverage(
  values: readonly unknown[] | undefined,
  points: readonly WorkoutPoint[],
  startTimeMs: number,
  endTimeMs: number,
  includeStart: boolean,
  label: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (!values) {
    return undefined;
  }
  let average = 0;
  let count = 0;
  for (const point of points) {
    if (
      (includeStart ? point.timeMs < startTimeMs : point.timeMs <= startTimeMs)
      || point.timeMs > endTimeMs
    ) {
      continue;
    }
    const value = optionalNumber(values[point.index], label);
    if (value === undefined) {
      continue;
    }
    if (value < minimum || value > maximum) {
      invalid(`${label} was invalid`);
    }
    count += 1;
    average += (value - average) / count;
  }
  return count > 0 ? round(average) : undefined;
}

function findWorkoutSplitBoundary(
  points: readonly (WorkoutPoint & { distanceMeters: number })[],
  targetDistance: number,
  initialSearchIndex: number,
): { searchIndex: number; timeMs: number } | undefined {
  let searchIndex = Math.max(1, initialSearchIndex);
  while (
    searchIndex < points.length
    && (points[searchIndex]?.distanceMeters ?? Number.NEGATIVE_INFINITY) < targetDistance
  ) {
    searchIndex += 1;
  }
  const upper = points[searchIndex];
  const lower = points[Math.max(0, searchIndex - 1)];
  if (
    !lower
    || !upper
    || upper.distanceMeters < targetDistance
    || lower.distanceMeters > targetDistance
  ) {
    return undefined;
  }
  if (lower.distanceMeters === targetDistance) {
    return { searchIndex, timeMs: lower.timeMs };
  }
  const distanceSpan = upper.distanceMeters - lower.distanceMeters;
  const timeMs = distanceSpan <= 0
    ? upper.timeMs
    : lower.timeMs + (upper.timeMs - lower.timeMs)
      * Math.max(0, Math.min(1, (targetDistance - lower.distanceMeters) / distanceSpan));
  return { searchIndex, timeMs };
}

function resolveWorkoutCadenceUnit(sport: string | undefined): "rpm" | "steps-per-minute" | undefined {
  const normalized = sport?.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-");
  if (!normalized) {
    return undefined;
  }
  if (/(?:^|-)(?:hike|hiking|run|running|walk|walking)(?:-|$)/u.test(normalized)) {
    return "steps-per-minute";
  }
  return /(?:^|-)(?:bike|biking|cycle|cycling|ride|riding|spin|spinning)(?:-|$)/u
    .test(normalized)
    ? "rpm"
    : undefined;
}

const WORKOUT_LOCAL_DATE_PATHS = [
  "calendarDate",
  "calendar_date",
  "localDate",
  "local_date",
] as const;
const WORKOUT_OFFSET_MINUTE_PATHS = [
  "timeZoneOffsetMinutes",
  "time_zone_offset_minutes",
  "timezoneOffsetMinutes",
  "timezone_offset_minutes",
  "utcOffsetMinutes",
  "utc_offset_minutes",
] as const;
const WORKOUT_OFFSET_SECOND_PATHS = [
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

function resolveWorkoutDayKey(
  summary: PlainObject,
  startAtRaw: string | undefined,
  startAt: string,
): string | undefined {
  for (const path of WORKOUT_LOCAL_DATE_PATHS) {
    const dayKey = strictDayKey(firstString(summary, [path]));
    if (dayKey) {
      return dayKey;
    }
  }
  if (!startAtRaw) {
    return undefined;
  }

  const explicitSemantics = firstString(summary, [
    "timestampSemantics",
    "timestamp_semantics",
  ]);
  const semantics = explicitSemantics === "utc"
    || explicitSemantics === "offset"
    || explicitSemantics === "floating"
    || explicitSemantics === "unknown"
    ? explicitSemantics
    : /z$/iu.test(startAtRaw)
      ? "utc"
      : /[+-]\d{2}:?\d{2}$/u.test(startAtRaw)
        ? "offset"
        : /^\d{4}-\d{2}-\d{2}(?:$|[ t]\d{2}:\d{2})/iu.test(startAtRaw)
          ? "floating"
          : "unknown";
  if (semantics === "offset" || semantics === "floating") {
    return strictDayKey(startAtRaw);
  }

  const offsetSeconds =
    firstWorkoutOffset(summary, WORKOUT_OFFSET_MINUTE_PATHS, 60)
    ?? firstWorkoutOffset(summary, WORKOUT_OFFSET_SECOND_PATHS, 1);
  if (offsetSeconds === undefined || Math.abs(offsetSeconds) > 24 * 60 * 60) {
    return undefined;
  }
  const startMs = Date.parse(startAt);
  return Number.isFinite(startMs)
    ? new Date(startMs + offsetSeconds * 1_000).toISOString().slice(0, 10)
    : undefined;
}

function firstWorkoutOffset(
  summary: PlainObject,
  paths: readonly string[],
  numericMultiplier: number,
): number | undefined {
  for (const path of paths) {
    const value = readPath(summary, path);
    const numeric = finiteNumber(value);
    if (numeric !== undefined) {
      return numeric * numericMultiplier;
    }
    if (typeof value !== "string") {
      continue;
    }
    const match = /^([+-])(\d{2}):?(\d{2})$/u.exec(value.trim());
    if (!match) {
      continue;
    }
    const hours = Number(match[2]);
    const minutes = Number(match[3]);
    if (hours <= 24 && minutes <= 59) {
      return (match[1] === "-" ? -1 : 1) * (hours * 60 + minutes) * 60;
    }
  }
  return undefined;
}

function strictDayKey(value: string | undefined): string | undefined {
  const dayKey = /^\d{4}-\d{2}-\d{2}/u.exec(value ?? "")?.[0];
  if (!dayKey) {
    return undefined;
  }
  const parsed = new Date(`${dayKey}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(dayKey)
    ? dayKey
    : undefined;
}

export function resolveJunctionBoundedFeatureRecords(
  resource: "electrocardiogram_voltage" | "workout_stream",
  records: readonly unknown[],
): PlainObject[] {
  const selected = new Map<string, PlainObject>();
  const policy = resolveJunctionTimeseriesResourcePolicy(resource);
  if (!policy?.maxRecordsPerWindow || records.length > policy.maxRecordsPerWindow) {
    invalid(`${resource} exceeded its feature cardinality`);
  }
  records.forEach((value, index) => {
    const feature = record(value, `${resource} feature ${index}`);
    assertFeature(resource, feature);
    const identity = buildJunctionBoundedFeatureIdentity(resource, feature);
    const existing = selected.get(identity);
    if (existing && stableStringify(existing) !== stableStringify(feature)) {
      invalid(`${resource} contained conflicting feature ${identity}`);
    }
    selected.set(identity, feature);
  });
  return [...selected.values()];
}

export function buildJunctionBoundedFeatureIdentity(
  resource: "electrocardiogram_voltage" | "workout_stream",
  feature: PlainObject,
): string {
  const origin = resolveJunctionOrigin(feature);
  const stableId = consistentId(feature, resource === "electrocardiogram_voltage" ? ECG_IDS : WORKOUT_IDS, "feature");
  if (!origin.sourceProviderSlug || !stableId) {
    invalid(`${resource} feature lacked identity`);
  }
  return stableStringify([
    origin.sourceProviderSlug,
    origin.sourceType ?? null,
    origin.sourceInstanceId ?? null,
    stableId,
  ]);
}

function parseEcgSample(value: unknown, index: number): EcgSample {
  const sample = record(value, `ECG sample ${index}`);
  const timestamp = firstTimestamp(sample, ["timestamp"]);
  const voltage = finiteNumber(sample.value);
  const unit = firstString(sample, ["unit"]);
  const lead = firstString(sample, ["type"]);
  const origin = resolveJunctionOrigin(sample);
  const recordingId = consistentId(sample, ECG_IDS, "ECG sample");
  if (!timestamp || voltage === undefined || !unit || !lead || !origin.sourceProviderSlug || !recordingId) {
    invalid(`ECG sample ${index} was incomplete`);
  }
  return stripUndefined({
    lead,
    recordingId,
    sourceInstanceId: origin.sourceInstanceId ?? undefined,
    sourceProviderSlug: origin.sourceProviderSlug,
    sourceType: origin.sourceType,
    timestamp,
    timestampMs: Date.parse(timestamp),
    unit,
    value: voltage,
  });
}

function reduceEcgRecording(rawSamples: readonly EcgSample[]): PlainObject {
  const unique = new Map<string, EcgSample>();
  for (const sample of [...rawSamples].sort(compareSamples)) {
    const key = `${sample.timestamp}:${sample.lead}`;
    const existing = unique.get(key);
    if (existing && stableStringify(existing) !== stableStringify(sample)) {
      invalid("ECG contained conflicting samples");
    }
    unique.set(key, sample);
  }
  const samples = [...unique.values()];
  const first = samples[0];
  const last = samples.at(-1);
  if (!first || !last) invalid("ECG recording was empty");

  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  let mean = 0;
  let meanSquare = 0;
  const leads = new Set<string>();
  samples.forEach((sample, index) => {
    if (
      sample.recordingId !== first.recordingId
      || sample.sourceProviderSlug !== first.sourceProviderSlug
      || sample.sourceType !== first.sourceType
      || sample.sourceInstanceId !== first.sourceInstanceId
      || sample.unit !== first.unit
    ) invalid("ECG recording mixed source or unit data");
    const count = index + 1;
    minimum = Math.min(minimum, sample.value);
    maximum = Math.max(maximum, sample.value);
    mean += (sample.value - mean) / count;
    meanSquare += (sample.value * sample.value - meanSquare) / count;
    leads.add(sample.lead);
  });
  const feature = stripUndefined({
    schema: JUNCTION_ECG_VOLTAGE_FEATURE_SCHEMA,
    id: first.recordingId,
    recordingId: first.recordingId,
    sessionStart: first.timestamp,
    sessionEnd: last.timestamp,
    durationSeconds: round((last.timestampMs - first.timestampMs) / 1_000),
    voltageSampleCount: samples.length,
    voltageUnit: first.unit,
    voltageMin: round(minimum),
    voltageMax: round(maximum),
    voltageMean: round(mean),
    voltageRms: round(Math.sqrt(meanSquare)),
    leadType: leads.size === 1 ? [...leads][0] : undefined,
    leadCount: leads.size,
    sourceProviderSlug: first.sourceProviderSlug,
    sourceType: first.sourceType,
    sourceInstanceId: first.sourceInstanceId,
  });
  assertFeature("electrocardiogram_voltage", feature);
  return feature;
}

function assertFeature(
  resource: "electrocardiogram_voltage" | "workout_stream",
  feature: PlainObject,
): void {
  const ecg = resource === "electrocardiogram_voltage";
  const schema = ecg ? JUNCTION_ECG_VOLTAGE_FEATURE_SCHEMA : JUNCTION_WORKOUT_STREAM_FEATURE_SCHEMA;
  const fields = ecg ? ECG_FIELDS : WORKOUT_FIELDS;
  const start = firstTimestamp(feature, ecg ? ["sessionStart"] : ["startAt"]);
  const end = firstTimestamp(feature, ecg ? ["sessionEnd"] : ["endAt"]);
  const count = finiteNumber(feature[ecg ? "voltageSampleCount" : "sampleCount"]);
  const numericFields = ecg
    ? ["durationSeconds", "voltageMin", "voltageMax", "voltageMean", "voltageRms", "leadCount"]
    : [
        "durationSeconds", "distanceMeters", "averageHeartRate", "maxHeartRate",
        "firstHalfAverageHeartRate", "secondHalfAverageHeartRate",
        "averageCadence", "maxCadence", "averagePower", "maxPower",
        "averageSpeed", "maxSpeed",
      ];
  const invalidNumber = numericFields.some((key) => {
    const value = feature[key];
    return (ecg || key === "durationSeconds" || value !== undefined)
      && finiteNumber(value) === undefined;
  });
  const boundedShape = Object.entries(feature).every(
    ([key, value]) => key === "splits"
      ? !ecg && Array.isArray(value)
      : typeof value === "string" || typeof value === "number",
  );
  const policy = resolveJunctionTimeseriesResourcePolicy(resource);
  const countLimit = ecg ? policy?.maxSamplesPerWindow : policy?.maxSamplesPerRecord;
  const duration = finiteNumber(feature.durationSeconds);
  const distance = finiteNumber(feature.distanceMeters);
  const averageHeartRate = finiteNumber(feature.averageHeartRate);
  const maxHeartRate = finiteNumber(feature.maxHeartRate);
  const firstHalfAverageHeartRate = finiteNumber(feature.firstHalfAverageHeartRate);
  const secondHalfAverageHeartRate = finiteNumber(feature.secondHalfAverageHeartRate);
  const averageCadence = finiteNumber(feature.averageCadence);
  const maxCadence = finiteNumber(feature.maxCadence);
  const averagePower = finiteNumber(feature.averagePower);
  const maxPower = finiteNumber(feature.maxPower);
  const averageSpeed = finiteNumber(feature.averageSpeed);
  const maxSpeed = finiteNumber(feature.maxSpeed);
  const voltageMin = finiteNumber(feature.voltageMin);
  const voltageMax = finiteNumber(feature.voltageMax);
  const voltageMean = finiteNumber(feature.voltageMean);
  const voltageRms = finiteNumber(feature.voltageRms);
  const leadCount = finiteNumber(feature.leadCount);
  if (
    feature.schema !== schema
    || Object.keys(feature).some((key) => !fields.has(key))
    || !boundedShape
    || Buffer.byteLength(JSON.stringify(feature), "utf8") > MAX_FEATURE_BYTES
    || !resolveJunctionOrigin(feature).sourceProviderSlug
    || !start
    || !end
    || Date.parse(end) < Date.parse(start)
    || count === undefined
    || !Number.isSafeInteger(count)
    || count < 1
    || countLimit === undefined
    || count > countLimit
    || invalidNumber
    || duration === undefined
    || duration < 0
    || (!ecg && distance !== undefined && distance < 0)
    || (!ecg && averageHeartRate !== undefined && (averageHeartRate < 20 || averageHeartRate > 300))
    || (!ecg && maxHeartRate !== undefined && (maxHeartRate < 20 || maxHeartRate > 300))
    || (!ecg && averageHeartRate !== undefined && maxHeartRate !== undefined && averageHeartRate > maxHeartRate)
    || (!ecg && firstHalfAverageHeartRate !== undefined && (firstHalfAverageHeartRate < 20 || firstHalfAverageHeartRate > 300))
    || (!ecg && secondHalfAverageHeartRate !== undefined && (secondHalfAverageHeartRate < 20 || secondHalfAverageHeartRate > 300))
    || (!ecg && averageCadence !== undefined && (averageCadence < 0 || averageCadence > 400))
    || (!ecg && maxCadence !== undefined && (maxCadence < 0 || maxCadence > 400))
    || (!ecg && averageCadence !== undefined && maxCadence !== undefined && averageCadence > maxCadence)
    || (!ecg && averagePower !== undefined && (averagePower < 0 || averagePower > 5_000))
    || (!ecg && maxPower !== undefined && (maxPower < 0 || maxPower > 5_000))
    || (!ecg && averagePower !== undefined && maxPower !== undefined && averagePower > maxPower)
    || (!ecg && averageSpeed !== undefined && (averageSpeed < 0 || averageSpeed > 150))
    || (!ecg && maxSpeed !== undefined && (maxSpeed < 0 || maxSpeed > 150))
    || (!ecg && averageSpeed !== undefined && maxSpeed !== undefined && averageSpeed > maxSpeed)
    || (!ecg && feature.workoutDayKey !== undefined && strictDayKey(firstString(feature, ["workoutDayKey"])) !== feature.workoutDayKey)
    || (!ecg && !firstTimestamp(feature, ["version"]))
    || (ecg && (voltageMin === undefined || voltageMax === undefined || voltageMean === undefined || voltageRms === undefined))
    || (ecg && voltageMin !== undefined && voltageMax !== undefined && voltageMin > voltageMax)
    || (ecg && voltageMean !== undefined && voltageMin !== undefined && voltageMean < voltageMin)
    || (ecg && voltageMean !== undefined && voltageMax !== undefined && voltageMean > voltageMax)
    || (ecg && voltageRms !== undefined && voltageRms < 0)
    || (ecg && (leadCount === undefined || !Number.isSafeInteger(leadCount) || leadCount < 1))
    || (ecg && !firstString(feature, ["voltageUnit"]))
  ) invalid(`${resource} feature was invalid`);
  if (!ecg) {
    assertWorkoutSplits(feature.splits);
  }
  consistentId(feature, ecg ? ECG_IDS : WORKOUT_IDS, "feature");
}

function assertWorkoutSplits(value: unknown): void {
  if (!Array.isArray(value) || value.length > MAX_WORKOUT_SPLITS) {
    invalid("workout feature splits were invalid");
  }
  let previousIndex = 0;
  let previousEndedAt = Number.NEGATIVE_INFINITY;
  for (const [offset, rawSplit] of value.entries()) {
    const split = record(rawSplit, `workout split ${offset + 1}`);
    const index = finiteNumber(split.index);
    const distance = finiteNumber(split.distanceMeters);
    const duration = finiteNumber(split.durationSeconds);
    const endedAt = firstTimestamp(split, ["endedAt"]);
    const averageSplitHeartRate = finiteNumber(split.averageHeartRate);
    const averageSplitCadence = finiteNumber(split.averageCadence);
    const averageSplitPower = finiteNumber(split.averagePower);
    const cadenceUnit = firstString(split, ["cadenceUnit"]);
    if (
      Object.keys(split).some((key) => !WORKOUT_SPLIT_FIELDS.has(key))
      || Object.values(split).some((entry) =>
        typeof entry !== "string" && typeof entry !== "number"
      )
      || index === undefined
      || !Number.isSafeInteger(index)
      || index <= previousIndex
      || distance === undefined
      || distance <= 0
      || duration === undefined
      || duration <= 0
      || !endedAt
      || Date.parse(endedAt) <= previousEndedAt
      || (averageSplitHeartRate !== undefined
        && (averageSplitHeartRate < 20 || averageSplitHeartRate > 300))
      || (averageSplitCadence !== undefined
        && (averageSplitCadence < 0 || averageSplitCadence > 400))
      || (averageSplitPower !== undefined
        && (averageSplitPower < 0 || averageSplitPower > 5_000))
      || ((averageSplitCadence === undefined) !== (cadenceUnit === undefined))
      || (cadenceUnit !== undefined
        && cadenceUnit !== "rpm"
        && cadenceUnit !== "steps-per-minute")
    ) {
      invalid(`workout split ${offset + 1} was invalid`);
    }
    previousIndex = index;
    previousEndedAt = Date.parse(endedAt);
  }
}

function compareSamples(left: EcgSample, right: EcgSample): number {
  return left.timestampMs - right.timestampMs || left.lead.localeCompare(right.lead);
}

function parallelArray(value: unknown, length: number, label: string): unknown[] | undefined {
  if (value === undefined || value === null) return undefined;
  const values = array(value, label);
  if (values.length !== length) invalid(`${label} cardinality was invalid`);
  return values;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) invalid(`${label} must be an array`);
  return value;
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  const number = finiteNumber(value);
  if (number === undefined) invalid(`${label} was not finite`);
  return number;
}

function timestampMs(value: unknown): number {
  const numeric = finiteNumber(value);
  const parsed = numeric === undefined
    ? typeof value === "string" ? Date.parse(value) : Number.NaN
    : Math.abs(numeric) < 10_000_000_000 ? numeric * 1_000 : numeric;
  if (!Number.isFinite(parsed)) invalid("timestamp was invalid");
  return parsed;
}

function firstTimestamp(source: PlainObject, paths: readonly string[]): string | undefined {
  for (const path of paths) {
    const value = readPath(source, path);
    if (value === undefined || value === null) continue;
    try {
      return new Date(timestampMs(value)).toISOString();
    } catch {
      continue;
    }
  }
  return undefined;
}

function firstString(source: PlainObject, paths: readonly string[]): string | undefined {
  for (const path of paths) {
    const value = stringId(readPath(source, path));
    if (value && value.length <= 200) return value;
  }
  return undefined;
}

function consistentId(source: PlainObject, paths: readonly string[], label: string): string | undefined {
  const values = new Set(paths.flatMap((path) => {
    const value = firstString(source, [path]);
    return value ? [value] : [];
  }));
  if (values.size > 1) invalid(`${label} contained conflicting stable identifiers`);
  return [...values][0];
}

function readPath(source: PlainObject, path: string): unknown {
  let value: unknown = source;
  for (const segment of path.split(".")) {
    const current = asPlainObject(value);
    if (!current) return undefined;
    value = current[segment];
  }
  return value;
}

function record(value: unknown, label: string): PlainObject {
  const parsed = asPlainObject(value);
  if (!parsed) invalid(`${label} must be an object`);
  return parsed;
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) invalid(`${label} was invalid`);
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

function invalid(message: string): never {
  throw new TypeError(`Junction ${message}.`);
}
