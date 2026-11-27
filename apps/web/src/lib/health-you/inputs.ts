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
import { canonicalProvider } from "../health-wins/engine/daily-clean";
import { day, distance, fields, model, offset, rowDay, type MemberEvidence } from "./engine/model";
import { bedtimeProgress } from "./bedtime";
import { assessmentInputs, pressureInputs } from "./checkins";
import { inputState, type MarkerInput, type YouInputs } from "./evidence";

const pressureKeys = ["systolic-blood-pressure", "diastolic-blood-pressure"];
const metricKeys = [
  "activity-minutes",
  "resting-heart-rate",
  "steps",
  "total-sleep-minutes",
  "estimated-vo2-max",
  "body-height",
  "body-weight",
  "waist-circumference",
];
const labAliases: Record<string, string> = {
  "hdl-c": "hdl",
  "ldl-c": "ldl",
  "ldl-calculated": "ldl",
  "ldl-chol-calc-nih": "ldl",
  "lipoprotein-a": "lpa",
  "non-hdl-cholesterol": "non_hdl",
  "red-cell-distribution-width": "rdw",
  "white-blood-cell-count": "wbc",
  "hs-crp": "hs_crp",
  "vitamin-d": "vitamin_d_25oh",
  "blood-urea-nitrogen": "bun",
  "total-globulin": "globulin",
  "gamma-glutamyl-transferase": "ggt",
  "alkaline-phosphatase": "alp",
  "lymphocyte-percentage": "lymphocytes_pct",
  "mean-corpuscular-volume": "mcv",
  "platelet-count": "platelets",
  "carbon-dioxide": "co2",
  "total-bilirubin": "bilirubin_total",
  "urine-albumin-creatinine-ratio": "urine_acr",
};
const labs: Record<string, string[]> = model.labs;
function system(key: string) {
  if (["hdl", "ldl", "total_cholesterol", "non_hdl", "lpa", "apob", "triglycerides"].includes(key))
    return "Lipids";
  if (
    [
      "rdw",
      "wbc",
      "mcv",
      "hemoglobin",
      "platelets",
      "lymphocytes_pct",
      "hematocrit",
      "red_blood_cell_count",
    ].includes(key)
  )
    return "Blood counts";
  if (["creatinine", "egfr", "bun", "urine_acr"].includes(key)) return "Kidney";
  if (["alt", "ast", "ggt", "alp", "bilirubin_total", "albumin", "globulin", "total_protein"].includes(key))
    return "Liver";
  if (["hba1c", "glucose", "insulin"].includes(key)) return "Blood sugar";
  return "Other markers";
}
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
  const evidence: MemberEvidence = {
    profile: { birth_year: demo.birthYear, sex: demo.biologicalSex },
    joined: toLocalDayKey(joinedAt, timeZone),
    daily: [],
    sleep_sessions: [],
    body: [],
    vo2: [],
    labs: [],
    checkins: [],
    bp: [],
    fitness_tests: [],
  };
  const markers: MarkerInput[] = [];
  const minutes = new Map<string, Set<number>>();
  for (const key of [...metricKeys, ...pressureKeys]) {
    if ("metricCoverage" in client && client.metricCoverage.get(key).status === "unloaded")
      throw new Error("Required metric bucket unavailable");
    if (pressureKeys.includes(key)) continue;
    for (const row of client.metrics.series({ metricKey: key, from, to: asOf, grain: "day" })) {
      recordMetric(evidence, minutes, row, key, from, asOf);
    }
  }
  readLabs(client.labResults.list({ from, to: asOf }), from, asOf, evidence, markers);
  const assessments = assessmentInputs(
    client.entities.list({ families: ["assessment"], from: offset(from, -1), to: offset(asOf, 1) }),
    from,
    asOf,
    timeZone,
  );
  evidence.checkins = assessments.checkins;
  evidence.fitness_tests = assessments.tests;
  evidence.bp = pressureInputs(
    pressureKeys.flatMap((metricKey) => client.metrics.list({ metricKey, from, to: asOf })),
    timeZone,
  );
  const activeMinutes = [...minutes].flatMap(([date, values]) =>
    values.size === 1 ? [{ date, value: [...values][0] }] : [],
  );
  const lifts = completedLifts(
    client.entities.list({
      families: ["event"],
      kinds: ["activity_session"],
      from: offset(asOf, -183),
      to: asOf,
    }),
    asOf,
  );
  const availability = inputAvailability(evidence, asOf, markers);
  const timing = "sleepTiming" in replica ? replica.sleepTiming : undefined;
  const bedtime = bedtimeProgress(timing, asOf);
  if (bedtime)
    availability.bedtime = inputState(
      bedtime.map((night) => night.date),
      asOf,
      2,
    );

  return {
    asOf,
    timeZone,
    evidence,
    bedtime,
    needsWhoopAnswer: Array.isArray(timing) && needsWhoopAnswer(evidence, asOf),
    availability,
    markers,
    lifts,
    activeMinutes,
    sourceRevision: replica.source.dataVersion,
    historyFrom: [from, evidence.joined!].sort().at(-1)!,
  };
}

function needsWhoopAnswer(evidence: MemberEvidence, asOf: string) {
  const whoop = [...(evidence.daily ?? []), ...(evidence.sleep_sessions ?? [])].some(
    (row) => row.source === "whoop" && distance(asOf, rowDay(row)) <= 42,
  );
  return whoop && !(evidence.checkins ?? []).some((row) => row.whoop_zones != null && rowDay(row) <= asOf);
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
function recordMetric(
  evidence: MemberEvidence,
  minutes: Map<string, Set<number>>,
  row: BrowserVaultMetricRow,
  key: string,
  from: string,
  asOf: string,
) {
  const normalized = validMetric(row, from, asOf);
  if (!normalized || normalized.canonicalValue === null) return;
  const value = normalized.canonicalValue;
  const source = canonicalProvider(row.sourceLabel ?? ""),
    date = row.date;
  const item = { date, source, unit: normalized.canonicalUnit };
  if (key === "body-height" || key === "body-weight" || key === "waist-circumference") {
    evidence.body!.push({
      ...item,
      [{ "body-height": "height_cm", "body-weight": "weight_kg", "waist-circumference": "waist_cm" }[key]]: value,
    });
  } else if (
    resolveWearableProviderDescriptor(source) ||
    ["apple", "apple watch", "oura", "garmin", "whoop", "fitbit"].includes(source)
  ) {
    if (key === "activity-minutes" && value >= 0 && value <= 1440) {
      const values = minutes.get(date) ?? new Set<number>();
      values.add(value);
      minutes.set(date, values);
    }
    if (key === "resting-heart-rate") evidence.daily!.push({ ...item, rhr: value });
    if (key === "total-sleep-minutes" && row.context.sleepType !== "nap")
      evidence.sleep_sessions!.push({ ...item, asleep_min: value, type: "main" });
    if (key === "steps")
      evidence.daily!.push({
        ...item,
        steps: value,
        wear_complete: row.context.wearComplete,
        worn_min: row.context.wornMinutes,
      });
    if (key === "estimated-vo2-max") evidence.vo2!.push({ ...item, value, method: "device_estimate" });
  }
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
  evidence: MemberEvidence,
  markers: MarkerInput[],
) {
  for (const row of rows) {
    const def = resolveLabResultMetricDefinition(row.metricKey);
    if (!def || !day(row.date) || row.date < from || row.date > asOf) continue;
    const marker = labAliases[def.key] ?? def.key.replaceAll("-", "_");
    const unit = normalizeUnit(row.normalizedUnit);
    const researchUnit = labs[marker]?.[1];
    evidence.labs!.push({
      date: row.date,
      marker,
      value: row.normalizedValue,
      unit: researchUnit && normalizeUnit(researchUnit) === unit ? researchUnit : unit,
      panel_id: row.drawId,
      comparator: row.comparator,
      source: "normalized-lab",
    });
    const reading = markerReading(row, unit, def.canonicalUnit ?? null);
    if (!reading) continue;
    markers.push({
      date: row.date,
      key: def.key,
      label: def.displayName,
      ...reading,
      system: system(marker),
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
    ["vo2_peak", "value"],
    ["bmi", "weight_kg"],
    ["waist", "waist_cm"],
  ]) {
    const rows =
      k === "sleep"
        ? evidence.sleep_sessions
        : k === "pulse"
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
      ["strength", "strength-training", "weight-training", "weightlifting", "resistance-training"].includes(
        String(training.activityType),
      )
    )
      lifts.push(date);
  }
  return lifts;
}
