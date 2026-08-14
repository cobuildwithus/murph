import { resolveJunctionTimeseriesResourcePolicy } from "@murphai/contracts";

import { stripUndefined } from "../shared.ts";
import { resolveJunctionOrigin } from "./junction-origin.ts";
import { stableStringify } from "./raw-ingest-receipt.ts";
import { asPlainObject, finiteNumber, stringId } from "./shared-normalization.ts";

import type { PlainObject } from "./shared-normalization.ts";

export const JUNCTION_ECG_VOLTAGE_FEATURE_SCHEMA = "junction.ecg_voltage_feature.v1";
export const JUNCTION_WORKOUT_STREAM_FEATURE_SCHEMA = "junction.workout_stream_feature.v1";

const ECG_IDS = ["junctionGroupId", "recordingId", "recording_id"] as const;
const WORKOUT_IDS = ["workoutId", "workout_id", "id"] as const;
const MAX_FEATURE_BYTES = 16_384;

const ECG_FIELDS = new Set([
  "schema", "id", "recordingId", "sessionStart", "sessionEnd",
  "durationSeconds", "voltageSampleCount", "voltageUnit", "voltageMin", "voltageMax",
  "voltageMean", "voltageRms", "leadType", "leadCount", "sourceProviderSlug",
  "sourceType", "sourceInstanceId",
]);
const WORKOUT_FIELDS = new Set([
  "schema", "id", "workoutId", "sport", "startAt", "endAt",
  "durationSeconds", "distanceMeters", "averageHeartRate", "maxHeartRate",
  "sampleCount", "sourceProviderSlug", "sourceType", "sourceInstanceId",
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
  const heartRates = parallelArray(stream.heartrate, times.length, "heartrate");
  const distances = parallelArray(stream.distance, times.length, "distance");
  if (!heartRates && !distances) invalid("workout stream had no supported metrics");

  let firstMs = Number.POSITIVE_INFINITY;
  let lastMs = Number.NEGATIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  let average = 0;
  let heartRateCount = 0;
  let distanceMeters: number | undefined;
  for (let index = 0; index < times.length; index += 1) {
    const at = timestampMs(times[index]);
    firstMs = Math.min(firstMs, at);
    lastMs = Math.max(lastMs, at);
    const heartRate = optionalNumber(heartRates?.[index], "heart rate");
    if (heartRate !== undefined) {
      if (heartRate < 20 || heartRate > 300) invalid("heart rate was invalid");
      heartRateCount += 1;
      maximum = Math.max(maximum, heartRate);
      average += (heartRate - average) / heartRateCount;
    }
    const distance = optionalNumber(distances?.[index], "distance");
    if (distance !== undefined) {
      if (distance < 0) invalid("workout distance was negative");
      distanceMeters = Math.max(distanceMeters ?? 0, distance);
    }
  }

  const workoutId = consistentId(summary, WORKOUT_IDS, "workout summary");
  const origin = resolveJunctionOrigin(summary);
  if (!workoutId || !origin.sourceProviderSlug) {
    invalid("workout summary lacked identity");
  }
  const startAt = firstTimestamp(summary, ["time_start", "timeStart", "startAt", "start_at", "start"])
    ?? new Date(firstMs).toISOString();
  const endAt = firstTimestamp(summary, ["time_end", "timeEnd", "endAt", "end_at", "end"])
    ?? new Date(lastMs).toISOString();
  const durationSeconds = (Date.parse(endAt) - Date.parse(startAt)) / 1_000;
  if (durationSeconds < 0) invalid("workout duration was invalid");

  const feature = stripUndefined({
    schema: JUNCTION_WORKOUT_STREAM_FEATURE_SCHEMA,
    id: workoutId,
    workoutId,
    sport: firstString(summary, ["sport.slug", "sportSlug", "sport_slug", "sport.name", "sport"]),
    startAt,
    endAt,
    durationSeconds: round(durationSeconds),
    distanceMeters: distanceMeters === undefined ? undefined : round(distanceMeters),
    averageHeartRate: heartRateCount ? round(average) : undefined,
    maxHeartRate: heartRateCount ? round(maximum) : undefined,
    sampleCount: times.length,
    sourceProviderSlug: origin.sourceProviderSlug,
    sourceType: origin.sourceType,
    sourceInstanceId: origin.sourceInstanceId ?? undefined,
  });
  assertFeature("workout_stream", feature);
  return feature;
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
    : ["durationSeconds", "distanceMeters", "averageHeartRate", "maxHeartRate"];
  const invalidNumber = numericFields.some((key) => {
    const value = feature[key];
    return (ecg || key === "durationSeconds" || value !== undefined)
      && finiteNumber(value) === undefined;
  });
  const scalarOnly = Object.values(feature).every(
    (value) => typeof value === "string" || typeof value === "number",
  );
  const policy = resolveJunctionTimeseriesResourcePolicy(resource);
  const countLimit = ecg ? policy?.maxSamplesPerWindow : policy?.maxSamplesPerRecord;
  const duration = finiteNumber(feature.durationSeconds);
  const distance = finiteNumber(feature.distanceMeters);
  const averageHeartRate = finiteNumber(feature.averageHeartRate);
  const maxHeartRate = finiteNumber(feature.maxHeartRate);
  const voltageMin = finiteNumber(feature.voltageMin);
  const voltageMax = finiteNumber(feature.voltageMax);
  const voltageMean = finiteNumber(feature.voltageMean);
  const voltageRms = finiteNumber(feature.voltageRms);
  const leadCount = finiteNumber(feature.leadCount);
  if (
    feature.schema !== schema
    || Object.keys(feature).some((key) => !fields.has(key))
    || !scalarOnly
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
    || (ecg && (voltageMin === undefined || voltageMax === undefined || voltageMean === undefined || voltageRms === undefined))
    || (ecg && voltageMin !== undefined && voltageMax !== undefined && voltageMin > voltageMax)
    || (ecg && voltageMean !== undefined && voltageMin !== undefined && voltageMean < voltageMin)
    || (ecg && voltageMean !== undefined && voltageMax !== undefined && voltageMean > voltageMax)
    || (ecg && voltageRms !== undefined && voltageRms < 0)
    || (ecg && (leadCount === undefined || !Number.isSafeInteger(leadCount) || leadCount < 1))
    || (ecg && !firstString(feature, ["voltageUnit"]))
  ) invalid(`${resource} feature was invalid`);
  consistentId(feature, ecg ? ECG_IDS : WORKOUT_IDS, "feature");
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
