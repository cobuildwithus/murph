import { stripUndefined } from "../shared.ts";
import {
  asPlainObject,
  finiteNumber,
  slugify,
  stringId,
  trimToLength,
  type PlainObject,
} from "./shared-normalization.ts";
import { resolveJunctionOrigin } from "./junction-origin.ts";

export const JUNCTION_WORKOUT_STREAM_MAX_POINTS = 50_000;
export const JUNCTION_WORKOUT_FEATURE_MAX_SPLITS = 64;
export const JUNCTION_WORKOUT_FEATURE_MAX_MEASUREMENTS = 20;
export const JUNCTION_WORKOUT_FEATURE_MAX_SPLIT_MEASUREMENTS = 5;

export interface JunctionWorkoutFeatureMeasurement {
  metric: string;
  unit: string;
  value: number;
}

export interface JunctionWorkoutFeatureSplit {
  distanceMeters: number;
  durationSeconds: number;
  endedAt: string;
  index: number;
  measurements: readonly JunctionWorkoutFeatureMeasurement[];
}

export interface JunctionWorkoutFeatureEnvelope {
  schema: "junction.workout_features.v1";
  workoutId: string;
  sourceProviderSlug: string;
  sourceInstanceId?: string;
  sourceType?: string;
  sport?: string;
  startedAt: string;
  endedAt?: string;
  pointCount: number;
  measurements: readonly JunctionWorkoutFeatureMeasurement[];
  splitDistanceMeters?: number;
  splits: readonly JunctionWorkoutFeatureSplit[];
}

export interface ReduceJunctionWorkoutStreamInput {
  sourceInstanceId?: string;
  sourceProviderSlug?: string;
  sourceType?: string;
  sport?: string;
  workoutId: string;
}

export class JunctionWorkoutStreamLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JunctionWorkoutStreamLimitError";
  }
}

const STREAM_ARRAY_KEYS = Object.freeze([
  "altitude",
  "cadence",
  "distance",
  "heartrate",
  "heart_rate",
  "lat",
  "latitude",
  "lng",
  "longitude",
  "power",
  "resistance",
  "temperature",
  "time",
  "timestamps",
  "velocity_smooth",
] as const);

const METRIC_SERIES = Object.freeze([
  {
    arrayKeys: ["heartrate", "heart_rate"] as const,
    averageMetric: "average-workout-heart-rate",
    firstHalfMetric: "first-half-average-workout-heart-rate",
    max: 300,
    maxMetric: "max-workout-heart-rate",
    secondHalfMetric: "second-half-average-workout-heart-rate",
    unit: "bpm",
  },
  {
    arrayKeys: ["cadence"] as const,
    averageMetric: "average-workout-cadence",
    firstHalfMetric: "first-half-average-workout-cadence",
    max: 400,
    maxMetric: "max-workout-cadence",
    secondHalfMetric: "second-half-average-workout-cadence",
    unit: "rpm",
  },
  {
    arrayKeys: ["power"] as const,
    averageMetric: "average-workout-power",
    firstHalfMetric: "first-half-average-workout-power",
    max: 5_000,
    maxMetric: "max-workout-power",
    secondHalfMetric: "second-half-average-workout-power",
    unit: "watt",
  },
  {
    arrayKeys: ["velocity_smooth"] as const,
    averageMetric: "average-workout-speed",
    firstHalfMetric: null,
    max: 150,
    maxMetric: "max-workout-speed",
    secondHalfMetric: null,
    unit: "mps",
  },
] as const);

interface WorkoutStreamPoint {
  distanceMeters?: number;
  index: number;
  timeMs: number;
}

export function reduceJunctionWorkoutStream(
  payload: unknown,
  input: ReduceJunctionWorkoutStreamInput,
): JunctionWorkoutFeatureEnvelope | null {
  const workoutId = trimIdentifier(input.workoutId, 200);
  const record = unwrapWorkoutStreamRecord(payload);
  if (!workoutId || !record) {
    return null;
  }

  assertBoundedWorkoutStreamArrays(record);
  const timeValues = firstArray(record, ["time", "timestamps"]);
  if (!timeValues || timeValues.length === 0) {
    return null;
  }

  const distanceValues = firstArray(record, ["distance"]);
  const points = buildWorkoutStreamPoints(timeValues, distanceValues);
  if (points.length === 0) {
    return null;
  }

  const startedAt = new Date(points[0]?.timeMs ?? Number.NaN).toISOString();
  const endedAt = points.length > 1
    ? new Date(points.at(-1)?.timeMs ?? Number.NaN).toISOString()
    : undefined;
  const origin = resolveJunctionOrigin(record, stripUndefined({
    sourceInstanceId: input.sourceInstanceId,
    sourceProviderSlug: input.sourceProviderSlug,
    sourceType: input.sourceType,
  }));
  if (!origin.sourceProviderSlug) {
    return null;
  }

  const sport = normalizeSport(input.sport) ?? readWorkoutStreamSport(record);
  const measurements = buildWorkoutStreamMeasurements(record, points);
  const splitResult = buildWorkoutStreamSplits(record, points, sport);
  if (measurements.length === 0 && splitResult.splits.length === 0) {
    return null;
  }

  return stripUndefined({
    schema: "junction.workout_features.v1" as const,
    workoutId,
    sourceProviderSlug: origin.sourceProviderSlug,
    sourceInstanceId: origin.sourceInstanceId ?? undefined,
    sourceType: origin.sourceType,
    sport,
    startedAt,
    endedAt: endedAt ?? undefined,
    pointCount: timeValues.length,
    measurements: measurements.slice(0, JUNCTION_WORKOUT_FEATURE_MAX_MEASUREMENTS),
    splitDistanceMeters: splitResult.splitDistanceMeters,
    splits: splitResult.splits,
  });
}

export function parseJunctionWorkoutFeatureEnvelope(
  value: unknown,
): JunctionWorkoutFeatureEnvelope {
  const record = asPlainObject(value);
  if (!record || record.schema !== "junction.workout_features.v1") {
    throw new TypeError("Junction workout feature envelope schema was invalid.");
  }

  const workoutId = trimIdentifier(record.workoutId, 200);
  const sourceProviderSlug = normalizeSlug(record.sourceProviderSlug, 80);
  const sourceInstanceId = optionalPatternedString(record.sourceInstanceId, 120);
  const sourceType = optionalSlug(record.sourceType, 80);
  const sport = optionalSlug(record.sport, 80);
  const startedAt = parseIsoTimestamp(record.startedAt);
  const endedAt = record.endedAt === undefined ? undefined : parseIsoTimestamp(record.endedAt);
  const pointCount = parseBoundedInteger(record.pointCount, 1, JUNCTION_WORKOUT_STREAM_MAX_POINTS);
  const measurements = parseMeasurements(record.measurements, JUNCTION_WORKOUT_FEATURE_MAX_MEASUREMENTS);
  const splitDistanceMeters = record.splitDistanceMeters === undefined
    ? undefined
    : parsePositiveNumber(record.splitDistanceMeters, 1_000_000);
  const rawSplits = Array.isArray(record.splits) ? record.splits : null;

  if (
    !workoutId
    || !sourceProviderSlug
    || !startedAt
    || (record.endedAt !== undefined && !endedAt)
    || (record.splitDistanceMeters !== undefined && splitDistanceMeters === null)
    || pointCount === null
    || !rawSplits
  ) {
    throw new TypeError("Junction workout feature envelope identity was invalid.");
  }
  if (rawSplits.length > JUNCTION_WORKOUT_FEATURE_MAX_SPLITS) {
    throw new JunctionWorkoutStreamLimitError("Junction workout feature split count exceeded the configured limit.");
  }

  const splits = rawSplits.map((split, index) => parseWorkoutFeatureSplit(split, index + 1));
  if (measurements.length === 0 && splits.length === 0) {
    throw new TypeError("Junction workout feature envelope did not contain any facts.");
  }

  return stripUndefined({
    schema: "junction.workout_features.v1" as const,
    workoutId,
    sourceProviderSlug,
    sourceInstanceId,
    sourceType,
    sport,
    startedAt,
    endedAt: endedAt ?? undefined,
    pointCount,
    measurements,
    splitDistanceMeters: splitDistanceMeters ?? undefined,
    splits,
  });
}

function unwrapWorkoutStreamRecord(payload: unknown): PlainObject | null {
  const record = asPlainObject(payload);
  if (!record) {
    return null;
  }
  const data = asPlainObject(record.data);
  return data && STREAM_ARRAY_KEYS.some((key) => Array.isArray(data[key]))
    ? { ...record, ...data }
    : record;
}

function assertBoundedWorkoutStreamArrays(record: PlainObject): void {
  for (const key of STREAM_ARRAY_KEYS) {
    const value = record[key];
    if (Array.isArray(value) && value.length > JUNCTION_WORKOUT_STREAM_MAX_POINTS) {
      throw new JunctionWorkoutStreamLimitError(
        `Junction workout stream exceeded ${JUNCTION_WORKOUT_STREAM_MAX_POINTS} points.`,
      );
    }
  }
}

function buildWorkoutStreamPoints(
  timeValues: readonly unknown[],
  distanceValues: readonly unknown[] | null,
): WorkoutStreamPoint[] {
  const points: WorkoutStreamPoint[] = [];
  let lastTimeMs = Number.NEGATIVE_INFINITY;
  let lastDistance = Number.NEGATIVE_INFINITY;

  for (const [index, rawTime] of timeValues.entries()) {
    const timeMs = parseWorkoutStreamTimeMs(rawTime);
    if (timeMs === null || timeMs < lastTimeMs) {
      continue;
    }

    const rawDistance = distanceValues?.[index];
    const distance = normalizeBoundedMetric(rawDistance, 1_000_000);
    const distanceMeters = distance !== undefined && distance >= lastDistance
      ? distance
      : undefined;
    if (distanceMeters !== undefined) {
      lastDistance = distanceMeters;
    }

    points.push(stripUndefined({ index, timeMs, distanceMeters }));
    lastTimeMs = timeMs;
  }

  return points;
}

function buildWorkoutStreamMeasurements(
  record: PlainObject,
  points: readonly WorkoutStreamPoint[],
): JunctionWorkoutFeatureMeasurement[] {
  const firstTimeMs = points[0]?.timeMs;
  const lastTimeMs = points.at(-1)?.timeMs;
  if (firstTimeMs === undefined || lastTimeMs === undefined) {
    return [];
  }

  const measurements: JunctionWorkoutFeatureMeasurement[] = [];
  const durationSeconds = Math.max(0, (lastTimeMs - firstTimeMs) / 1000);
  if (durationSeconds > 0) {
    measurements.push(measurement("workout-stream-duration", durationSeconds, "seconds"));
  }

  const finalDistance = [...points].reverse().find((point) => point.distanceMeters !== undefined)?.distanceMeters;
  if (finalDistance !== undefined && finalDistance > 0) {
    measurements.push(measurement("workout-stream-distance", finalDistance, "meter"));
  }

  const midpointMs = firstTimeMs + (lastTimeMs - firstTimeMs) / 2;
  for (const descriptor of METRIC_SERIES) {
    const values = firstArray(record, descriptor.arrayKeys);
    if (!values) {
      continue;
    }

    const valid = workoutMetricValues(values, points, descriptor.max);
    if (valid.length === 0) {
      continue;
    }
    measurements.push(
      measurement(descriptor.averageMetric, mean(valid.map((entry) => entry.value)), descriptor.unit),
      measurement(descriptor.maxMetric, Math.max(...valid.map((entry) => entry.value)), descriptor.unit),
    );

    if (descriptor.firstHalfMetric && descriptor.secondHalfMetric && lastTimeMs > firstTimeMs) {
      const firstHalf = valid.filter((entry) => entry.timeMs < midpointMs).map((entry) => entry.value);
      const secondHalf = valid.filter((entry) => entry.timeMs >= midpointMs).map((entry) => entry.value);
      if (firstHalf.length > 0) {
        measurements.push(measurement(descriptor.firstHalfMetric, mean(firstHalf), descriptor.unit));
      }
      if (secondHalf.length > 0) {
        measurements.push(measurement(descriptor.secondHalfMetric, mean(secondHalf), descriptor.unit));
      }
    }
  }

  return measurements;
}

function buildWorkoutStreamSplits(
  record: PlainObject,
  points: readonly WorkoutStreamPoint[],
  sport: string | undefined,
): { splitDistanceMeters?: number; splits: JunctionWorkoutFeatureSplit[] } {
  const distancePoints = points.filter(
    (point): point is WorkoutStreamPoint & { distanceMeters: number } => point.distanceMeters !== undefined,
  );
  const totalDistance = distancePoints.at(-1)?.distanceMeters;
  if (!totalDistance || distancePoints.length < 2) {
    return { splits: [] };
  }

  const baseDistance = sport?.includes("swim") ? 100 : 1_000;
  const splitDistanceMeters = baseDistance * Math.max(
    1,
    Math.ceil(totalDistance / (baseDistance * JUNCTION_WORKOUT_FEATURE_MAX_SPLITS)),
  );
  const splitCount = Math.min(
    Math.floor(totalDistance / splitDistanceMeters),
    JUNCTION_WORKOUT_FEATURE_MAX_SPLITS,
  );
  if (splitCount === 0) {
    return { splits: [] };
  }

  const splits: JunctionWorkoutFeatureSplit[] = [];
  let previousPoint = distancePoints[0];
  let searchIndex = 1;
  for (let splitIndex = 1; splitIndex <= splitCount; splitIndex += 1) {
    const targetDistance = splitIndex * splitDistanceMeters;
    while (
      searchIndex < distancePoints.length
      && (distancePoints[searchIndex]?.distanceMeters ?? Number.NEGATIVE_INFINITY) < targetDistance
    ) {
      searchIndex += 1;
    }
    const crossingPoint = distancePoints[searchIndex];
    if (!crossingPoint) {
      break;
    }

    const measurements = buildSplitMeasurements(
      record,
      points,
      previousPoint.index,
      crossingPoint.index,
    );
    const durationSeconds = (crossingPoint.timeMs - previousPoint.timeMs) / 1000;
    if (durationSeconds > 0) {
      splits.push({
        distanceMeters: splitDistanceMeters,
        durationSeconds: roundMetric(durationSeconds),
        endedAt: new Date(crossingPoint.timeMs).toISOString(),
        index: splitIndex,
        measurements,
      });
    }
    previousPoint = crossingPoint;
  }

  return splits.length > 0 ? { splitDistanceMeters, splits } : { splits: [] };
}

function buildSplitMeasurements(
  record: PlainObject,
  points: readonly WorkoutStreamPoint[],
  startIndex: number,
  endIndex: number,
): JunctionWorkoutFeatureMeasurement[] {
  const measurements: JunctionWorkoutFeatureMeasurement[] = [];
  const splitDescriptors = [
    { arrayKeys: ["heartrate", "heart_rate"] as const, max: 300, metric: "average-workout-split-heart-rate", unit: "bpm" },
    { arrayKeys: ["cadence"] as const, max: 400, metric: "average-workout-split-cadence", unit: "rpm" },
    { arrayKeys: ["power"] as const, max: 5_000, metric: "average-workout-split-power", unit: "watt" },
  ] as const;

  for (const descriptor of splitDescriptors) {
    const values = firstArray(record, descriptor.arrayKeys);
    if (!values) continue;
    const inSplit = points
      .filter((point) => point.index >= startIndex && point.index <= endIndex)
      .flatMap((point) => {
        const value = normalizeBoundedMetric(values[point.index], descriptor.max);
        return value === undefined ? [] : [value];
      });
    if (inSplit.length > 0) {
      measurements.push(measurement(descriptor.metric, mean(inSplit), descriptor.unit));
    }
  }

  return measurements.slice(0, JUNCTION_WORKOUT_FEATURE_MAX_SPLIT_MEASUREMENTS);
}

function workoutMetricValues(
  values: readonly unknown[],
  points: readonly WorkoutStreamPoint[],
  max: number,
): Array<{ timeMs: number; value: number }> {
  return points.flatMap((point) => {
    const value = normalizeBoundedMetric(values[point.index], max);
    return value === undefined ? [] : [{ timeMs: point.timeMs, value }];
  });
}

function parseWorkoutFeatureSplit(value: unknown, expectedIndex: number): JunctionWorkoutFeatureSplit {
  const record = asPlainObject(value);
  const index = record ? parseBoundedInteger(record.index, 1, JUNCTION_WORKOUT_FEATURE_MAX_SPLITS) : null;
  const distanceMeters = record ? parsePositiveNumber(record.distanceMeters, 1_000_000) : null;
  const durationSeconds = record ? parsePositiveNumber(record.durationSeconds, 7 * 24 * 60 * 60) : null;
  const endedAt = record ? parseIsoTimestamp(record.endedAt) : null;
  const measurements = record
    ? parseMeasurements(record.measurements, JUNCTION_WORKOUT_FEATURE_MAX_SPLIT_MEASUREMENTS)
    : [];

  if (!record || index !== expectedIndex || distanceMeters === null || durationSeconds === null || !endedAt) {
    throw new TypeError("Junction workout feature split was invalid.");
  }

  return { distanceMeters, durationSeconds, endedAt, index, measurements };
}

function parseMeasurements(value: unknown, maxCount: number): JunctionWorkoutFeatureMeasurement[] {
  if (!Array.isArray(value) || value.length > maxCount) {
    throw new JunctionWorkoutStreamLimitError("Junction workout feature measurement count exceeded the configured limit.");
  }

  return value.map((entry) => {
    const record = asPlainObject(entry);
    const metric = record ? normalizeSlug(record.metric, 120) : null;
    const unit = record ? normalizeSlug(record.unit, 80) : null;
    const numeric = record ? finiteNumber(record.value) : undefined;
    if (!metric || !unit || numeric === undefined) {
      throw new TypeError("Junction workout feature measurement was invalid.");
    }
    return measurement(metric, numeric, unit);
  });
}

function parseWorkoutStreamTimeMs(value: unknown): number | null {
  const numeric = finiteNumber(value);
  if (numeric !== undefined) {
    const milliseconds = numeric >= 100_000_000_000 ? numeric : numeric * 1000;
    return Number.isFinite(milliseconds)
      && milliseconds >= 0
      && Number.isFinite(new Date(milliseconds).getTime())
      ? milliseconds
      : null;
  }
  const raw = stringId(value);
  const parsed = raw ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function readWorkoutStreamSport(record: PlainObject): string | undefined {
  const sport = asPlainObject(record.sport);
  return normalizeSport(sport?.slug)
    ?? normalizeSport(sport?.name)
    ?? normalizeSport(record.sport);
}

function normalizeSport(value: unknown): string | undefined {
  return optionalSlug(value, 80);
}

function firstArray(record: PlainObject, keys: readonly string[]): readonly unknown[] | null {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return null;
}

function normalizeBoundedMetric(value: unknown, max: number): number | undefined {
  const numeric = finiteNumber(value);
  return numeric !== undefined && numeric >= 0 && numeric <= max ? numeric : undefined;
}

function measurement(metric: string, value: number, unit: string): JunctionWorkoutFeatureMeasurement {
  return { metric, value: roundMetric(value), unit };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function trimIdentifier(value: unknown, maxLength: number): string | null {
  const normalized = stringId(value)?.trim();
  return normalized ? trimToLength(normalized, maxLength) : null;
}

function normalizeSlug(value: unknown, maxLength: number): string | null {
  const normalized = stringId(value)?.trim();
  if (!normalized) return null;
  const slug = slugify(normalized, "").slice(0, maxLength).replace(/-+$/u, "");
  return slug || null;
}

function optionalSlug(value: unknown, maxLength: number): string | undefined {
  return normalizeSlug(value, maxLength) ?? undefined;
}

function optionalPatternedString(value: unknown, maxLength: number): string | undefined {
  const normalized = trimIdentifier(value, maxLength);
  return normalized && /^[a-z0-9][a-z0-9._:-]*$/u.test(normalized) ? normalized : undefined;
}

function parseIsoTimestamp(value: unknown): string | null {
  const raw = stringId(value);
  const parsed = raw ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function parseBoundedInteger(value: unknown, min: number, max: number): number | null {
  const numeric = finiteNumber(value);
  return numeric !== undefined && Number.isInteger(numeric) && numeric >= min && numeric <= max
    ? numeric
    : null;
}

function parsePositiveNumber(value: unknown, max: number): number | null {
  const numeric = finiteNumber(value);
  return numeric !== undefined && numeric > 0 && numeric <= max ? numeric : null;
}
