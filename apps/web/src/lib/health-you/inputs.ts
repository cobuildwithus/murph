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
import { resolvedDraws, labDraw, type LabDraw } from "./engine/lab-draws";
import { WEARABLE_FRESH_DAYS } from "./engine/daily";
import { adapt } from "./engine/feeds";
import {
  day,
  distance,
  fields,
  lookup,
  model,
  offset,
  rowDay,
  released,
  type MemberEvidence,
  type Observation,
} from "./engine/model";
import { markerSystem, youLabel } from "./labels";
import { bedtimeProgress } from "./bedtime";
import { assessmentInputs, localPressureTime, pressureInputs } from "./checkins";
import { inputState, type MarkerInput, type YouInputs } from "./evidence";

const pressureKeys = ["systolic-blood-pressure", "diastolic-blood-pressure"];
const metricKeys = ["activity-minutes", ...model.feeds.projectable.filter((k) => !pressureKeys.includes(k))];
const labAliases: Record<string, string> = {
  ...model.feeds.labs,
  "egfr-ckd-epi": "egfr",
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
  readLabs(client.labResults.list({ from, to: asOf }), from, asOf, timeZone, labRows, markers);
  const assessments = assessmentInputs(
    client.entities.list({ families: ["assessment"], to: offset(asOf, 1) }),
    from,
    asOf,
    timeZone,
  );
  const pressureRows = pressureKeys.flatMap((metricKey) =>
    client.metrics.list({ metricKey, from, to: asOf }),
  );
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
  const publication = toLocalDayKey(replica.generatedAt, timeZone);
  const { sessions, training } = projectWorkouts(replica, trainingRows, publication, asOf, timeZone);
  const { timing, sleep_sessions } = sleepTimingEvidence(replica, from, asOf);
  const meals = client.replica.meals.days
    .filter((d) => d.date >= from && d.date <= asOf)
    .flatMap((d) =>
      d.meals.map((m) => ({
        id: m.id,
        date: d.date,
        timestamp: m.eatenAt,
        fiber_g: m.fiberGrams,
        calories: m.calories,
        protein_g: m.proteinGrams,
        carbs_g: m.carbsGrams,
        fat_g: m.fatGrams,
      })),
    );
  const evidence = adapt({
    profile: { birth_year: demo.birthYear, biological_sex: demo.biologicalSex },
    joined: toLocalDayKey(joinedAt, timeZone),
    metrics,
    labs: labRows,
    bp,
    workouts: [...sessions, ...training],
    sleep_sessions,
    meals,
    checkins: assessments.checkins,
    fitness_tests: assessments.tests,
  });
  const availability = inputAvailability(evidence, asOf, markers);
  const bedtime = bedtimeProgress(timing, asOf);
  if (bedtime)
    availability.bedtime = inputState(
      bedtime.map((night) => night.date),
      asOf,
      2,
    );

  const historyFrom = [from, evidence.joined!].sort().at(-1)!;

  const generation = replica.generation ?? 0;
  return {
    asOf,
    timeZone,
    evidence,
    bedtime,
    hasWearableData: hasWearableData(metrics, minutes.size, timing, asOf),
    hasAnswerProjection: generation >= 21 && Array.isArray(timing),
    hasHabitQuestions: generation >= 22 && Array.isArray(timing),
    needsWhoopAnswer: Array.isArray(timing) && needsWhoopAnswer(evidence, asOf),
    availability,
    markers,
    lifts,
    activeMinutes,
    sourceRevision: replica.source.dataVersion,
    historyFrom,
    ageHistoryFrom: [
      historyFrom,
      ...(sessions.length ? [offset(publication, -62 + 27)] : []),
      ...(training.length ? [offset([publication, asOf].sort().at(-1)!, -183 + 27)] : []),
    ]
      .sort()
      .at(-1)!,
  };
}

function sleepTimingEvidence(
  replica: BrowserVaultCoreCapableQueryClient["replica"],
  from: string,
  asOf: string,
) {
  const timing = "sleepTiming" in replica ? replica.sleepTiming : undefined;
  const providers = "sleepTimingProviders" in replica ? replica.sleepTimingProviders : undefined;
  const sleep_sessions = (timing ?? []).flatMap((night) => {
    const source = measuringDevice(providers?.[night.date]);
    if (!source || night.date < from || night.date > asOf) return [];
    return [
      {
        date: night.date,
        source,
        method: "main_sleep_window",
        type: "main",
        start_at: night.startAt,
        end_at: night.endAt,
        start_offset_min: zoneOffset(night.startAt, night.timeZone),
        end_offset_min: zoneOffset(night.endAt, night.timeZone),
      },
    ];
  });
  return { timing, sleep_sessions };
}
function projectWorkouts(
  replica: BrowserVaultCoreCapableQueryClient["replica"],
  trainingRows: BrowserVaultEntity[],
  publication: string,
  asOf: string,
  timeZone: string,
) {
  const sessions = [
    ...("activitySessions" in replica ? (replica.activitySessions ?? []) : []),
    ...("detailedWorkouts" in replica ? (replica.detailedWorkouts ?? []) : []),
  ].flatMap((r, index) => {
    const type = workoutType(r.type);
    if (!type || r.date < offset(publication,-62) || r.date > asOf) return [];
    const z = r.zones;
    return [{date:r.date, minutes:r.minutes, type, id:String(index), ...(z && {
      provider:z.provider, zone_min: z.first === 0 || (z.provider !== "whoop" && z.first===1) ? z.minutes : undefined,
      reported_at:z.reportedAt ? toLocalDayKey(z.reportedAt,timeZone) : undefined,
    })}];
  });
  const training = trainingRows.flatMap((r) => {
    const t = r.attributes.training;
    if (
      !r.date ||
      r.date < offset(publication, -183) ||
      r.date > asOf ||
      !isRecord(t) ||
      t.state !== "completed" ||
      typeof t.durationMinutes !== "number"
    )
      return [];
    const type = workoutType(t.activityType);
    return type ? [{ date: r.date, type, minutes: t.durationMinutes }] : [];
  });
  return { sessions, training };
}
function workoutType(value: unknown) {
  if (typeof value !== "string") return null;
  if (strengthTypes.includes(value)) return "strength_training";
  const type = value === "walk" ? "walking" : value.toLowerCase().replaceAll("-", "_");
  return Object.hasOwn(model.daily.workout_proxy, type) ? type : null;
}
function zoneOffset(instant: string, timeZone: string) {
  const stamp = new Date(instant);
  return (
    (Date.parse(localPressureTime(stamp, timeZone) + "Z") - Math.floor(stamp.valueOf() / 60_000) * 60_000) /
    60_000
  );
}

function needsWhoopAnswer(evidence: MemberEvidence, asOf: string) {
  const whoop = [...(evidence.daily ?? []), ...(evidence.sleep_sessions ?? []), ...(evidence.workouts ?? [])].some(
    (row) => (row.source === "whoop" || row.provider === "whoop") && distance(asOf, rowDay(row)) <= 42,
  );
  return (
    whoop && !(evidence.checkins ?? []).some((row) => (row.answerKey === "whoopZones" || row.whoop_standard_zones != null) && rowDay(row) <= asOf)
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
  if (saved.state !== "ready" || saved.freshness !== "fresh")
    throw new Error("Private projection unavailable");
  return projectYouInputs(saved.client, clock, joinedAt);
}

function validMetric(row: BrowserVaultMetricRow, from: string, asOf: string) {
  if (
    (row.metricKey === "total-sleep-minutes" &&
      (row.context.sleepType === "short_sleep" || row.context.sleepState === "tentative")) ||
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
function hasWearableData(
  metrics: Observation[],
  activeMinuteDays: number,
  timing: readonly { date: string }[] | undefined,
  asOf: string,
) {
  return (
    activeMinuteDays > 0 ||
    Boolean(timing?.some((night) => night.date <= asOf)) ||
    metrics.some(
      (row) => row.provider && Object.hasOwn(model.feeds.daily, String(row.key)) && released(row, asOf),
    )
  );
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
  ...Object.values(fields)
    .filter((f) => f.group === "blood")
    .map((f) => normalizeUnit(f.unit)),
  ...[
    "mg/dL",
    "nmol/L",
    "ng/mL",
    "mg/L",
    "mcg/dL",
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
  if (
    row.comparator !== null ||
    row.normalizedValue === null ||
    !Number.isFinite(row.normalizedValue) ||
    !unit
  )
    return null;
  if (!sourceLabUnits.has(unit) && normalizeUnit(canonical) !== unit) return null;
  const flag: MarkerInput["flag"] =
    row.flag === "high" || row.flag === "low" || row.flag === "normal" ? row.flag : null;
  return { value: row.normalizedValue, unit: unit === "percent" ? "%" : unit, flag };
}

function labFactorKey(marker: string, unit: string | null, row: BrowserVaultLabResultRow) {
  return (
    labs[marker]?.[0] ??
    (marker === "lpa" && unit === normalizeUnit("nmol/L")
      ? "lpa_molar"
      : marker === "glucose" && row.fastingStatus === "fasting"
        ? "fasting_glucose"
        : marker)
  );
}
function labObservation(
  row: BrowserVaultLabResultRow,
  marker: string,
  unit: string | null,
  timeZone: string,
) {
  const researchUnit = labs[marker]?.[1] ?? lookup(model.candidates, marker)?.unit;
  const pending = row.parentResultStatus === "pending";
  const release = row.reportedAt;
  const instant = release && /(?:Z|[+-]\d\d:\d\d)$/i.test(release) ? Date.parse(release) : NaN;
  const releaseDate = Number.isFinite(instant) ? toLocalDayKey(instant, timeZone) : release;
  const observation = {
    date: row.date,
    marker,
    value: row.normalizedValue,
    unit: researchUnit && normalizeUnit(researchUnit) === unit ? researchUnit : unit,
    draw_id: row.drawId,
    collected_at: row.collectedAt,
    reported_at: releaseDate,
    report_timestamp: Number.isFinite(instant) ? new Date(instant).toISOString() : release,
    status: pending ? "pending" : "final",
    fasting: row.fastingStatus === "fasting" ? true : row.fastingStatus === "non_fasting" ? false : undefined,
    comparator: row.comparator,
    source: "normalized-lab",
  };
  return observation;
}

function displayReading(
  row: BrowserVaultLabResultRow,
  modelKey: string,
  unit: string | null,
  canonical: string | null,
) {
  const bounds = fields[modelKey] ?? lookup(model.candidates, modelKey) ?? lookup(model.lipids, modelKey);
  const reading = row.parentResultStatus !== "pending" && markerReading(row, unit, canonical);
  const valid =
    reading &&
    !(
      bounds &&
      normalizeUnit("unit" in bounds ? bounds.unit : "mg/dL") === unit &&
      (reading.value < bounds.min || reading.value > bounds.max)
    );
  return valid ? reading : null;
}

function appendLatestMarkers(
  byMarker: Map<string, LabDraw[]>,
  display: Map<LabDraw, MarkerInput>,
  markers: MarkerInput[],
) {
  for (const group of byMarker.values()) {
    const days = new Map<string, LabDraw[]>();
    for (const draw of resolvedDraws(group)) {
      const sameDay = days.get(draw.date) ?? [];
      sameDay.push(draw);
      days.set(draw.date, sameDay);
    }
    for (const draws of days.values()) {
      const latest = draws
        .map((r) => r.collected)
        .sort()
        .at(-1);
      for (const draw of draws) if (draw.collected === latest) markers.push(display.get(draw)!);
    }
  }
}

function readLabs(
  rows: BrowserVaultLabResultRow[],
  from: string,
  asOf: string,
  timeZone: string,
  labRows: Observation[],
  markers: MarkerInput[],
) {
  const byMarker = new Map<string, LabDraw[]>();
  const display = new Map<LabDraw, MarkerInput>();
  for (const row of rows) {
    const def = resolveLabResultMetricDefinition(row.metricKey);
    if (!def || !day(row.date) || row.date < from || row.date > asOf) continue;
    const marker = labAliases[def.key] ?? def.key.replaceAll("-", "_");
    const unit = normalizeUnit(row.normalizedUnit);
    const observation = labObservation(row, marker, unit, timeZone);
    if (!released(observation, asOf)) continue;
    labRows.push(observation);
    const modelKey = labFactorKey(marker, unit, row);
    const reading = displayReading(row, modelKey, unit, def.canonicalUnit ?? null);
    const draw = labDraw({ ...observation, panel_id: row.drawId }, reading ? reading.value : null);
    const group = byMarker.get(def.key) ?? [];
    group.push(draw);
    byMarker.set(def.key, group);
    if (!reading) continue;
    display.set(draw, {
      date: row.date,
      key: def.key,
      label: youLabel(marker) ?? youLabel(def.key)!,
      ...reading,
      system: markerSystem(marker),
      modelKey,
    });
  }
  appendLatestMarkers(byMarker, display, markers);
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
      k === "vo2_peak" ? 42 : ["bmi", "waist"].includes(k) ? 180 : WEARABLE_FRESH_DAYS,
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
