import "server-only";

import { toLocalDayKey } from "@murphai/contracts";
import {
  normalizeMetricValue,
  normalizeUnit,
  resolveLabResultMetricDefinition,
  resolveWearableProviderDescriptor,
} from "@murphai/health-metrics";
import type {
  BrowserVaultCoreCapableQueryClient,
  BrowserVaultMetricRow,
  BrowserVaultEntity,
} from "@murphai/query/browser-replica-client";
import type { BrowserVaultLabResultRow } from "@murphai/query/browser-replica";
import { isRecord } from "../primitives";
import { loadPublishedCompanionMetricReplica } from "../device-sync/companion-numbers";
import { adapt } from "./engine/feeds";
import {
  day,
  distance,
  fields,
  model,
  lookup,
  offset,
  rowDay,
  released,
  type MemberEvidence,
  type Observation,
} from "./engine/model";
import { markerSystem, youLabel } from "./labels";
import { bedtimeProgress } from "./bedtime";
import { assessmentInputs, pressureInputs } from "./checkins";
import { inputState, type MarkerInput, type YouInputs } from "./evidence";

const pressureKeys = ["systolic-blood-pressure", "diastolic-blood-pressure"];
const metricKeys = ["activity-minutes", ...model.feeds.projectable.filter((k) => !pressureKeys.includes(k))];
const labAliases: Record<string, string> = {
  ...model.feeds.labs,
  "ldl-calculated": "ldl",
  "ldl-chol-calc-nih": "ldl",
  "total-globulin": "globulin",
  "carbon-dioxide": "co2",
  "total-bilirubin": "bilirubin_total",
};
const labs: Record<string, string[]> = model.labs;
export function projectYouInputs(
  client: BrowserVaultCoreCapableQueryClient,
  clock: Date,
  joinedAt: Date,
): YouInputs {
  if (
    !("metrics" in client) ||
    !("labResults" in client) ||
    !client.replica.demographics ||
    !client.replica.meals?.timeZone
  )
    throw new Error("Private projection unavailable");
  const { replica } = client,
    timeZone = client.replica.meals.timeZone,
    asOf = toLocalDayKey(clock, timeZone);
  const from = offset(asOf, -364),
    demo = client.replica.demographics;
  const metrics: Observation[] = [],
    labRows: Observation[] = [];
  const markers: MarkerInput[] = [];
  const minutes = new Map<string, Set<number>>();
  for (const key of [...metricKeys, ...pressureKeys]) {
    if ("metricCoverage" in client && client.metricCoverage.get(key).status === "unloaded")
      throw new Error("Required metric bucket unavailable");
    if (pressureKeys.includes(key)) continue;
    const samples =
      Object.hasOwn(model.feeds.body, key) || key === "estimated-vo2-max"
        ? client.metrics.list({ metricKey: key, from, to: asOf })
        : client.metrics.series({ metricKey: key, from, to: asOf, grain: "day" });
    for (const row of samples) {
      recordMetric(metrics, minutes, row, key, from, asOf, timeZone);
    }
  }
  readLabs(client.labResults.list({ from, to: asOf }), from, asOf, labRows, markers);
  const assessments = assessmentInputs(
    client.entities.list({ families: ["assessment"], to: offset(asOf, 1) }),
    from,
    asOf,
    timeZone,
  );
  const pressureRows = pressureKeys.flatMap((metricKey) => client.metrics.list({ metricKey, from, to: asOf }));
  const bp = pressureInputs(pressureRows, timeZone);
  const activeMinutes = [...minutes].flatMap(([date, values]) =>
    values.size === 1 ? [{ date, value: [...values][0] }] : [],
  );
  const trainingRows = client.entities.list({
    families: ["event"],
    kinds: ["activity_session"],
    from: offset(asOf, -183),
    to: asOf,
  });
  const lifts = completedLifts(trainingRows, asOf);
  const workouts = [
    ...("activitySessions" in replica && Array.isArray(replica.activitySessions) ? replica.activitySessions : []),
    ...trainingRows.flatMap((r) => {
      const t = r.attributes.training;
      return r.date &&
        isRecord(t) &&
        t.state === "completed" &&
        strengthTypes.includes(String(t.activityType)) &&
        typeof t.durationMinutes === "number"
        ? [{ date: r.date, type: "strength_training", minutes: t.durationMinutes }]
        : [];
    }),
  ];
  const evidence = adapt({
    profile: { birth_year: demo.birthYear, biological_sex: demo.biologicalSex },
    joined: toLocalDayKey(joinedAt, timeZone),
    metrics,
    labs: labRows,
    bp,
    workouts,
    checkins: assessments.checkins,
    fitness_tests: assessments.tests,
  });
  const availability = inputAvailability(evidence, asOf, markers);
  const timing = "sleepTiming" in replica ? replica.sleepTiming : undefined;
  const bedtime = bedtimeProgress(timing, asOf);
  if (bedtime)
    availability.bedtime = inputState(
      bedtime.map((night) => night.date),
      asOf,
      2,
    );

  const historyFrom = [from, evidence.joined!].sort().at(-1)!;

  return {
    asOf,
    timeZone,
    evidence,
    bedtime,
    hasWearableData: hasWearableData(metrics, minutes.size, timing, asOf),
    hasAnswerProjection: (replica.generation ?? 0) >= 21 && Array.isArray(timing),
    needsWhoopAnswer: Array.isArray(timing) && needsWhoopAnswer(evidence, asOf),
    availability,
    markers,
    lifts,
    activeMinutes,
    sourceRevision: replica.source.dataVersion,
    historyFrom,
    ageHistoryFrom: workoutHistoryFrom(historyFrom, toLocalDayKey(replica.generatedAt, timeZone), asOf, workouts),
  };
}

function workoutHistoryFrom(from: string, publication: string, asOf: string, workouts: { type: string }[]) {
  // Historical scores need the whole rolling window inside the retained source.
  const kinds = new Set(workouts.map(w => lookup(model.policy.workout_types, w.type)));
  const bounds = [from];
  if (kinds.has("running")) bounds.push(offset(publication, -62 + model.policy.workout_days - 1));
  if (kinds.has("lifting")) bounds.push(offset(asOf, -183 + model.policy.workout_days - 1));
  return bounds.sort().at(-1)!;
}

function needsWhoopAnswer(evidence: MemberEvidence, asOf: string) {
  const whoop = [...(evidence.daily ?? []), ...(evidence.sleep_sessions ?? [])].some(
    (row) => row.source === "whoop" && distance(asOf, rowDay(row)) <= 42,
  );
  return (
    whoop && !(evidence.checkins ?? []).some((row) => row.whoop_standard_zones != null && rowDay(row) <= asOf)
  );
}

export async function readYouInputs(
  memberId: string,
  signal: AbortSignal,
  clock: Date,
  joinedAt: Date,
  replicaState: Parameters<typeof loadPublishedCompanionMetricReplica>[0]["replicaState"],
) {
  const saved = await loadPublishedCompanionMetricReplica({
    memberId,
    signal,
    replicaState,
    metricKeys: [...metricKeys, ...pressureKeys],
    requestedShards: ["core", "metricsIndex", "labs"],
    timeoutMs: 6000,
  });
  if (saved.state !== "ready" || saved.freshness !== "fresh") throw new Error("Private projection unavailable");
  return projectYouInputs(saved.client, clock, joinedAt);
}

function validMetric(row: BrowserVaultMetricRow, from: string, asOf: string) {
  if (
    (row.metricKey === "total-sleep-minutes" && (row.context.sleepType === "short_sleep" || row.context.sleepState === "tentative")) ||
    !day(row.date) ||
    row.date < from ||
    row.date > asOf ||
    row.statistic !== "value" ||
    row.comparator != null ||
    !row.unit ||
    row.value === null
  )
    return null;
  const normalized = normalizeMetricValue({ metricKey: row.metricKey, unit: row.unit, value: row.value });
  const value = normalized.canonicalValue;
  return value !== null && Number.isFinite(value) ? normalized : null;
}
function hasWearableData(metrics: Observation[], activeMinuteDays: number, timing: readonly { date: string }[] | undefined, asOf: string) {
  return activeMinuteDays > 0 || Boolean(timing?.some(night => night.date <= asOf)) || metrics.some(row =>
    row.provider && Object.hasOwn(model.feeds.daily, String(row.key)) && released(row, asOf));
}

// Only an identified original measuring device can establish a wearable series.
function measuringDevice(label: unknown) {
  if (typeof label !== "string") return undefined;
  const key = label
    .trim()
    .toLowerCase()
    .replace(/[-_ ]+/g, "_");
  if (
    [
      "apple_health",
      "apple_healthkit",
      "apple_health_kit",
      "healthkit",
      "junction",
      "health_connect",
      "google_fit",
    ].includes(key)
  )
    return undefined;
  const aliases: Record<string, string> = model.feeds.provider_aliases;
  const provider = Object.hasOwn(aliases, key) ? aliases[key] : key;
  return ["apple", "garmin", "oura", "whoop", "fitbit"].includes(provider) ||
    resolveWearableProviderDescriptor(provider)
    ? provider
    : undefined;
}
function recordMetric(
  metrics: Observation[],
  minutes: Map<string, Set<number>>,
  row: BrowserVaultMetricRow,
  key: string,
  from: string,
  asOf: string,
  timeZone: string,
) {
  const normalized = validMetric(row, from, asOf);
  if (!normalized || normalized.canonicalValue === null) return;
  const value = normalized.canonicalValue;
  const date = row.date,
    ctx = row.context;
  const qualifiers = isRecord(ctx.qualifiers) ? ctx.qualifiers : {};
  const provider = measuringDevice(ctx.provider ?? row.sourceLabel);
  if (key === "activity-minutes") {
    if (!provider || model.feeds.excluded_providers.includes(provider) || value < 0 || value > 1440) return;
    const values = minutes.get(date) ?? new Set<number>();
    values.add(value);
    minutes.set(date, values);
    return;
  }
  const reported = typeof ctx.recordedAt === "string" ? Date.parse(ctx.recordedAt) : NaN;
  metrics.push({
    ...(Number.isFinite(reported) && { reported_at: toLocalDayKey(reported, timeZone) }),
    date,
    key,
    value,
    provider,
    unit: normalized.canonicalUnit === "kg/m^2" ? "kg/m2" : normalized.canonicalUnit,
    method: ctx.measurementMethodKey ?? ctx.method,
    nap: ctx.sleepType === "nap" || ctx.isNap === true,
    partial: ctx.partial ?? qualifiers.partial,
    off_body: ctx.offBody ?? qualifiers.off_body,
    wear_complete: ctx.wearComplete ?? qualifiers.wear_complete,
    worn_min: ctx.wornMinutes ?? qualifiers.worn_min,
  });
}

// Source-unit catalog entries may retain an arbitrary reporting unit. Only publish known physical units.
const sourceLabUnits = new Set([
  ...Object.values(fields).map((f) => normalizeUnit(f.unit)),
  ...[
    "mg/dL",
    "nmol/L",
    "ng/mL",
    "µg/dL",
    "pg/mL",
    "mIU/L",
    "µIU/mL",
    "µmol/L",
    "mmol/L",
    "%",
    "g/L",
    "U/L",
    "IU/L",
    "10^9/L",
    "10^3/uL",
    "mL/min/1.73m2",
  ].map(normalizeUnit),
]);
function markerReading(row: BrowserVaultLabResultRow, unit: string | null, canonical: string | null) {
  if (row.comparator !== null || row.normalizedValue === null || !Number.isFinite(row.normalizedValue) || !unit)
    return null;
  if (!sourceLabUnits.has(unit) && normalizeUnit(canonical) !== unit) return null;
  const flag: MarkerInput["flag"] =
    row.flag === "high" || row.flag === "low" || row.flag === "normal" ? row.flag : null;
  return { value: row.normalizedValue, unit: unit === "percent" ? "%" : unit, flag };
}

function readLabs(
  rows: BrowserVaultLabResultRow[],
  from: string,
  asOf: string,
  labRows: Observation[],
  markers: MarkerInput[],
) {
  for (const row of rows) {
    const def = resolveLabResultMetricDefinition(row.metricKey);
    if (row.parentResultStatus === "pending" || !def || !day(row.date) || row.date < from || row.date > asOf) continue;
    const marker = labAliases[def.key] ?? def.key.replaceAll("-", "_");
    const unit = normalizeUnit(row.normalizedUnit);
    const researchUnit = labs[marker]?.[1];
    labRows.push({
      date: row.date,
      marker,
      value: row.normalizedValue,
      unit: researchUnit && normalizeUnit(researchUnit) === unit ? researchUnit : unit,
      draw_id: row.drawId,
      comparator: row.comparator,
      source: "normalized-lab",
    });
    const reading = markerReading(row, unit, def.canonicalUnit ?? null);
    if (!reading) continue;
    markers.push({
      date: row.date,
      key: def.key,
      label: youLabel(marker) ?? youLabel(def.key)!,
      ...reading,
      system: markerSystem(marker),
      modelKey: labs[marker]?.[0] ?? (marker === "ldl" ? "ldl_c" : marker),
    });
  }
}

function inputAvailability(evidence: MemberEvidence, asOf: string, markers: MarkerInput[]) {
  const availability: YouInputs["availability"] = Object.fromEntries(
    [...Object.keys(model.coef), ...model.optional, "bedtime", "hip_minutes", "steps"].map((k) => [
      k,
      "unavailable",
    ]),
  );
  for (const [k, field] of [
    ["sleep", "asleep_min"],
    ["pulse", "rhr"],
    ["steps", "steps"],
    ["vo2_peak", "value"],
    ["bmi", "weight_kg"],
    ["waist", "waist_cm"],
  ]) {
    const rows =
      k === "sleep"
        ? evidence.sleep_sessions
        : k === "pulse" || k === "steps"
          ? evidence.daily
          : k === "vo2_peak"
            ? evidence.vo2
            : evidence.body;
    availability[k] = inputState(
      (rows ?? []).filter((r) => r[field] != null).map(rowDay),
      asOf,
      k === "vo2_peak" ? 42 : ["bmi", "waist"].includes(k) ? 180 : 2,
    );
  }
  for (const [k, f] of Object.entries(fields))
    if (f.group === "blood")
      availability[k] = inputState(
        markers.filter((m) => m.modelKey === k).map((m) => m.date),
        asOf,
        365,
      );
  if (evidence.bp?.length) availability.sbp = inputState(evidence.bp.map(rowDay), asOf, 28);
  return availability;
}

const strengthTypes = [
  "strength",
  "strength-training",
  "weight-training",
  "weightlifting",
  "resistance-training",
  "strength_training",
  "weight_training",
];
function completedLifts(rows: BrowserVaultEntity[], asOf: string) {
  const lifts: string[] = [];
  for (const entity of rows) {
    const training = entity.attributes.training,
      date = entity.date;
    if (
      date &&
      date <= asOf &&
      distance(asOf, date) <= 183 &&
      isRecord(training) &&
      training.state === "completed" &&
      strengthTypes.includes(String(training.activityType))
    )
      lifts.push(date);
  }
  return lifts;
}
