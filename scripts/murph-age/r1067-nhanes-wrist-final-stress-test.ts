import { createReadStream } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { createGunzip } from "node:zlib";

import { calculateAuc, findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1067_NHANES_WRIST_FINAL_STRESS_TEST_SCHEMA_VERSION =
  "murph-age-r1067-nhanes-wrist-final-stress-test.v1" as const;

const DEFAULT_ANALYTIC_CACHE_PATH = path.join(
  ".runtime",
  "cache",
  "murph-age",
  "nhanes-wrist-2011-2014",
  "derived",
  "analytic",
  "nhanes-wrist-2011-2014-lab-activity-5y-v0.csv.gz",
);
const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1067-nhanes-wrist-final-stress-test.latest.json";

const LAB9_BP_BODY_FEATURE_KEYS = [
  "age",
  "male",
  "sbp",
  "dbp",
  "bmi",
  "waist",
  "hba1c",
  "creatinine",
  "albumin",
  "hdl",
  "log_triglycerides",
  "alkaline_phosphatase",
  "white_blood_cell_count",
  "lymphocyte_percent",
  "red_cell_distribution_width",
];
const ACTIVITY_ADJUSTED_FEATURE_KEYS = [
  ...LAB9_BP_BODY_FEATURE_KEYS,
  "log_daily_total_activity",
  "valid_day_count",
  "mean_daily_valid_minutes",
  "mean_daily_wake_wear_minutes",
  "mean_daily_sleep_wear_minutes",
  "mean_daily_nonwear_minutes",
];

type Split = "calibration" | "test" | "train";
type StressVerdict = "not_reportable" | "stable" | "unstable";

interface ParsedRow {
  cycleId: "2011-2012" | "2013-2014" | "unknown";
  followupMonths: number | null;
  index: number;
  split: Split;
  values: Record<string, number | null>;
  weight: number;
  y: 0 | 1;
}

interface TrainedModel {
  calibration: { intercept: number; slope: number };
  featureKeys: string[];
  score(row: ParsedRow): number;
  stats: Record<string, { median: number; mean: number; sd: number }>;
}

interface MetricSummary {
  auc: number | null;
  brier: number | null;
  eOverO: number | null;
  eventCountBand: string;
  logLoss: number | null;
  nBand: string;
}

interface DeltaSummary {
  aucDelta: number | null;
  brierDelta: number | null;
  eOverO: number | null;
  logLossDelta: number | null;
}

interface StressScenario {
  activityVsLab9: DeltaSummary;
  comparatorMetrics: MetricSummary;
  eventCountBand: string;
  nBand: string;
  scenarioId:
    | "primary_test_replay"
    | "exclude_first_12_month_deaths"
    | "exclude_first_24_month_deaths"
    | "cycle_transport_2011_to_2013"
    | "cycle_transport_2013_to_2011";
  verdict: StressVerdict;
}

interface SubgroupStressStatus {
  calibrationStatus: StressVerdict;
  subgroupId: "age_40_59" | "age_60_79" | "female" | "male";
}

export interface R1067NhanesWristFinalStressTestOptions {
  analyticCachePath?: string;
  createdAt?: string;
  iterations?: number;
  outputDir?: string;
}

export interface R1067NhanesWristFinalStressTestOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  benchmarkCardId: "nhanes_wrist_lab_activity_mortality_5y_v1";
  createdAt: string;
  endpoint: "5y_all_cause_mortality";
  evidenceLabel: "same_family_public_wrist_activity_wear_shadow_inconclusive";
  packetId: "r1067-nhanes-wrist-final-stress-test";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1067_NHANES_WRIST_FINAL_STRESS_TEST_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  stressScenarios: StressScenario[];
  subgroupStress: SubgroupStressStatus[];
  summary: {
    conclusion:
      | "activity_wear_signal_persistent_but_non_specific_keep_shadow"
      | "activity_wear_signal_unstable_keep_shadow";
    earlyDeathStress: StressVerdict;
    productDisplayAuthorized: false;
    rowValuesStored: false;
    subgroupStress: StressVerdict;
    transportStress: StressVerdict;
    usableAsConsumerWearableValidation: false;
  };
}

export async function runR1067NhanesWristFinalStressTest(
  options: R1067NhanesWristFinalStressTestOptions = {},
): Promise<{ output: R1067NhanesWristFinalStressTestOutput; outputPath: string }> {
  const analyticCachePath = options.analyticCachePath ?? DEFAULT_ANALYTIC_CACHE_PATH;
  await requireLocalCache(analyticCachePath);
  const rows = await readAnalyticRows(analyticCachePath);
  const iterations = options.iterations ?? 700;
  const primary = trainPair(
    rows.filter((row) => row.split === "train"),
    rows.filter((row) => row.split === "calibration"),
    iterations,
  );
  const stressScenarios = [
    scenarioFromRows("primary_test_replay", rows.filter((row) => row.split === "test"), primary),
    scenarioFromRows(
      "exclude_first_12_month_deaths",
      rows.filter((row) => row.split === "test" && !earlyDeath(row, 12)),
      primary,
    ),
    scenarioFromRows(
      "exclude_first_24_month_deaths",
      rows.filter((row) => row.split === "test" && !earlyDeath(row, 24)),
      primary,
    ),
    cycleTransportScenario("cycle_transport_2011_to_2013", rows, "2011-2012", "2013-2014", iterations),
    cycleTransportScenario("cycle_transport_2013_to_2011", rows, "2013-2014", "2011-2012", iterations),
  ];
  const subgroupStress = subgroupStatuses(rows.filter((row) => row.split === "test"), primary);
  const earlyDeathStress = aggregateVerdict([
    stressScenarios.find((scenario) => scenario.scenarioId === "exclude_first_12_month_deaths")?.verdict,
    stressScenarios.find((scenario) => scenario.scenarioId === "exclude_first_24_month_deaths")?.verdict,
  ]);
  const transportStress = aggregateVerdict([
    stressScenarios.find((scenario) => scenario.scenarioId === "cycle_transport_2011_to_2013")?.verdict,
    stressScenarios.find((scenario) => scenario.scenarioId === "cycle_transport_2013_to_2011")?.verdict,
  ]);
  const subgroupStressVerdict = aggregateVerdict(subgroupStress.map((status) => status.calibrationStatus));
  const persistent = earlyDeathStress === "stable"
    && transportStress !== "unstable"
    && subgroupStressVerdict !== "unstable";
  const output: R1067NhanesWristFinalStressTestOutput = {
    artifactBoundary: safeBoundary(),
    benchmarkCardId: "nhanes_wrist_lab_activity_mortality_5y_v1",
    createdAt: options.createdAt ?? new Date().toISOString(),
    endpoint: "5y_all_cause_mortality",
    evidenceLabel: "same_family_public_wrist_activity_wear_shadow_inconclusive",
    packetId: "r1067-nhanes-wrist-final-stress-test",
    productDisplayAuthorized: false,
    schemaVersion: R1067_NHANES_WRIST_FINAL_STRESS_TEST_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    stressScenarios,
    subgroupStress,
    summary: {
      conclusion: persistent
        ? "activity_wear_signal_persistent_but_non_specific_keep_shadow"
        : "activity_wear_signal_unstable_keep_shadow",
      earlyDeathStress,
      productDisplayAuthorized: false,
      rowValuesStored: false,
      subgroupStress: subgroupStressVerdict,
      transportStress,
      usableAsConsumerWearableValidation: false,
    },
  };
  assertR1067Safe(output);
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function trainPair(trainRows: readonly ParsedRow[], calibrationRows: readonly ParsedRow[], iterations: number): {
  activity: TrainedModel;
  comparator: TrainedModel;
} {
  return {
    activity: trainCalibratedModel(trainRows, calibrationRows, ACTIVITY_ADJUSTED_FEATURE_KEYS, iterations),
    comparator: trainCalibratedModel(trainRows, calibrationRows, LAB9_BP_BODY_FEATURE_KEYS, iterations),
  };
}

function scenarioFromRows(
  scenarioId: StressScenario["scenarioId"],
  rows: readonly ParsedRow[],
  models: { activity: TrainedModel; comparator: TrainedModel },
): StressScenario {
  const comparatorMetrics = aggregateMetrics(rows, models.comparator);
  const activityMetrics = aggregateMetrics(rows, models.activity);
  const activityVsLab9 = {
    aucDelta: delta(activityMetrics.auc, comparatorMetrics.auc),
    brierDelta: delta(activityMetrics.brier, comparatorMetrics.brier),
    eOverO: activityMetrics.eOverO,
    logLossDelta: delta(activityMetrics.logLoss, comparatorMetrics.logLoss),
  };
  return {
    activityVsLab9,
    comparatorMetrics,
    eventCountBand: countBand(rows.reduce((sum, row) => sum + row.y, 0)),
    nBand: countBand(rows.length),
    scenarioId,
    verdict: verdictForDelta(activityVsLab9, rows),
  };
}

function cycleTransportScenario(
  scenarioId: StressScenario["scenarioId"],
  rows: readonly ParsedRow[],
  trainCycle: ParsedRow["cycleId"],
  testCycle: ParsedRow["cycleId"],
  iterations: number,
): StressScenario {
  const trainRows = rows.filter((row) => row.cycleId === trainCycle && row.split === "train");
  const calibrationRows = rows.filter((row) => row.cycleId === trainCycle && row.split === "calibration");
  const models = trainPair(trainRows, calibrationRows, iterations);
  return scenarioFromRows(scenarioId, rows.filter((row) => row.cycleId === testCycle), models);
}

function subgroupStatuses(
  rows: readonly ParsedRow[],
  models: { activity: TrainedModel; comparator: TrainedModel },
): SubgroupStressStatus[] {
  const subgroups: Array<[SubgroupStressStatus["subgroupId"], (row: ParsedRow) => boolean]> = [
    ["male", (row) => row.values.male === 1],
    ["female", (row) => row.values.male === 0],
    ["age_40_59", (row) => (row.values.age ?? 0) < 60],
    ["age_60_79", (row) => (row.values.age ?? 0) >= 60],
  ];
  return subgroups.map(([subgroupId, predicate]) => {
    const subset = rows.filter(predicate);
    return {
      calibrationStatus: subgroupVerdict(aggregateMetrics(subset, models.activity), subset),
      subgroupId,
    };
  });
}

function verdictForDelta(deltaSummary: DeltaSummary, rows: readonly ParsedRow[]): StressVerdict {
  if (!hasReportableEvents(rows)) return "not_reportable";
  return deltaSummary.brierDelta !== null
    && deltaSummary.brierDelta < 0
    && deltaSummary.logLossDelta !== null
    && deltaSummary.logLossDelta < 0
    && deltaSummary.eOverO !== null
    && deltaSummary.eOverO >= 0.9
    && deltaSummary.eOverO <= 1.1
    ? "stable"
    : "unstable";
}

function subgroupVerdict(metrics: MetricSummary, rows: readonly ParsedRow[]): StressVerdict {
  if (!hasReportableEvents(rows)) return "not_reportable";
  return metrics.eOverO !== null && metrics.eOverO >= 0.85 && metrics.eOverO <= 1.15 ? "stable" : "unstable";
}

function aggregateVerdict(verdicts: readonly (StressVerdict | undefined)[]): StressVerdict {
  const observed = verdicts.filter((verdict): verdict is StressVerdict => verdict !== undefined);
  if (observed.some((verdict) => verdict === "unstable")) return "unstable";
  if (observed.some((verdict) => verdict === "stable")) return "stable";
  return "not_reportable";
}

async function requireLocalCache(filePath: string): Promise<void> {
  try {
    await access(filePath);
  } catch {
    throw new Error("R1067 requires the local ignored NHANES wrist analytic cache before stress testing.");
  }
}

async function readAnalyticRows(filePath: string): Promise<ParsedRow[]> {
  const stream = createReadStream(filePath).pipe(createGunzip());
  const rl = createInterface({ crlfDelay: Infinity, input: stream });
  let header: string[] | null = null;
  const rows: ParsedRow[] = [];
  for await (const line of rl) {
    if (!header) {
      header = line.split(",");
      continue;
    }
    const cells = parseCsvLine(line);
    const raw = Object.fromEntries(header.map((column, index) => [column, String(cells[index] ?? "").trim()]));
    if (raw.eligible_5y_endpoint !== "1") continue;
    const split = parseSplit(raw.split);
    const outcome = parseBinary(raw.primary_5y_event);
    const age = parseNumber(raw.age_years);
    if (!split || outcome === null || age === null || age < 40 || age > 79) continue;
    rows.push({
      cycleId: cycleId(raw.cycle_id),
      followupMonths: parseNumber(raw.primary_5y_followup_months),
      index: rows.length,
      split,
      values: buildValues(raw),
      weight: parsePositiveNumber(raw.sample_weight_combined) ?? 1,
      y: outcome,
    });
  }
  if (rows.length === 0) throw new Error("R1067 local NHANES wrist analytic cache produced no eligible rows.");
  return rows;
}

function buildValues(raw: Record<string, string>): Record<string, number | null> {
  const triglycerides = parsePositiveNumber(raw.triglycerides);
  return {
    age: parseNumber(raw.age_years),
    albumin: parseNumber(raw.albumin),
    alkaline_phosphatase: parseNumber(raw.alkaline_phosphatase),
    bmi: parseNumber(raw.body_mass_index),
    creatinine: parseNumber(raw.creatinine),
    dbp: parseNumber(raw.diastolic_blood_pressure),
    hba1c: parseNumber(raw.hba1c),
    hdl: parseNumber(raw.hdl_cholesterol),
    log_daily_total_activity: logPositive(raw.mean_daily_total_activity),
    log_triglycerides: triglycerides === null ? null : Math.log(triglycerides),
    lymphocyte_percent: parseNumber(raw.lymphocyte_percent),
    male: sexValue(raw.sex_stratum),
    mean_daily_nonwear_minutes: parseNumber(raw.mean_daily_nonwear_minutes),
    mean_daily_sleep_wear_minutes: parseNumber(raw.mean_daily_sleep_wear_minutes),
    mean_daily_valid_minutes: parseNumber(raw.mean_daily_valid_minutes),
    mean_daily_wake_wear_minutes: parseNumber(raw.mean_daily_wake_wear_minutes),
    red_cell_distribution_width: parseNumber(raw.red_cell_distribution_width),
    sbp: parseNumber(raw.systolic_blood_pressure),
    valid_day_count: parseNumber(raw.valid_day_count),
    waist: parseNumber(raw.waist_circumference),
    white_blood_cell_count: parseNumber(raw.white_blood_cell_count),
  };
}

function trainCalibratedModel(
  rows: readonly ParsedRow[],
  calibrationRows: readonly ParsedRow[],
  featureKeys: string[],
  iterations: number,
): TrainedModel {
  const model = trainLogistic(rows, featureKeys, iterations);
  return {
    ...model,
    calibration: fitCalibrationOnLogit(calibrationRows, (row) => model.score(row), Math.max(100, Math.floor(iterations / 2))),
  };
}

function trainLogistic(rows: readonly ParsedRow[], featureKeys: string[], iterations: number): TrainedModel {
  const { stats, vectorForRow } = prepareFeatureMatrix(rows, featureKeys);
  const weights = new Array(featureKeys.length + 1).fill(0);
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0) || 1;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const gradient = new Array(weights.length).fill(0);
    for (const row of rows) {
      const vector = vectorForRow(row);
      const error = sigmoid(dot(weights, vector)) - row.y;
      for (let index = 0; index < weights.length; index += 1) {
        gradient[index] += row.weight * error * vector[index]!;
      }
    }
    for (let index = 0; index < weights.length; index += 1) {
      gradient[index] /= totalWeight;
      if (index > 0) gradient[index] += 0.01 * weights[index]!;
      weights[index] -= 0.05 * gradient[index]!;
    }
  }
  return {
    calibration: { intercept: 0, slope: 1 },
    featureKeys,
    score: (row) => dot(weights, vectorForRow(row)),
    stats,
  };
}

function prepareFeatureMatrix(rows: readonly ParsedRow[], featureKeys: readonly string[]) {
  const stats: Record<string, { median: number; mean: number; sd: number }> = {};
  for (const featureKey of featureKeys) {
    const observed = rows.map((row) => row.values[featureKey]).filter(isFiniteNumber);
    const medianValue = median(observed);
    const imputed = rows.map((row) => row.values[featureKey] ?? medianValue);
    stats[featureKey] = {
      mean: mean(imputed),
      median: medianValue,
      sd: standardDeviation(imputed),
    };
  }
  return {
    stats,
    vectorForRow: (row: ParsedRow): number[] => [
      1,
      ...featureKeys.map((featureKey) => {
        const stat = stats[featureKey]!;
        return ((row.values[featureKey] ?? stat.median) - stat.mean) / stat.sd;
      }),
    ],
  };
}

function aggregateMetrics(rows: readonly ParsedRow[], model: TrainedModel): MetricSummary {
  const labels = rows.map((row) => row.y);
  const probabilities = rows.map((row) => calibratedPrediction(model, row));
  const weights = rows.map((row) => row.weight);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const observed = weightedMean(labels, weights);
  const meanPredicted = weightedMean(probabilities, weights);
  const eps = 1e-6;
  return {
    auc: roundOrNull(calculateAuc(labels, probabilities)),
    brier: totalWeight > 0
      ? roundOrNull(rows.reduce((sum, row, index) => sum + row.weight * (probabilities[index]! - row.y) ** 2, 0) / totalWeight)
      : null,
    eOverO: observed !== null && observed > 0 && meanPredicted !== null ? roundOrNull(meanPredicted / observed) : null,
    eventCountBand: countBand(labels.reduce<number>((sum, label) => sum + label, 0)),
    logLoss: totalWeight > 0
      ? roundOrNull(-rows.reduce((sum, row, index) => {
        const p = probabilities[index]!;
        return sum + row.weight * (row.y * Math.log(Math.max(eps, p)) + (1 - row.y) * Math.log(Math.max(eps, 1 - p)));
      }, 0) / totalWeight)
      : null,
    nBand: countBand(rows.length),
  };
}

function calibratedPrediction(model: TrainedModel, row: ParsedRow): number {
  return sigmoid(model.calibration.intercept + model.calibration.slope * model.score(row));
}

function fitCalibrationOnLogit(
  rows: readonly ParsedRow[],
  scoreForRow: (row: ParsedRow) => number,
  iterations: number,
): { intercept: number; slope: number } {
  if (!hasBothClasses(rows)) return { intercept: 0, slope: 1 };
  const weights = [0, 1];
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0) || 1;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let interceptGradient = 0;
    let slopeGradient = 0;
    for (const row of rows) {
      const score = clamp(scoreForRow(row), -12, 12);
      const error = sigmoid(weights[0]! + weights[1]! * score) - row.y;
      interceptGradient += row.weight * error;
      slopeGradient += row.weight * error * score;
    }
    weights[0] -= 0.02 * interceptGradient / totalWeight;
    weights[1] -= 0.02 * slopeGradient / totalWeight;
  }
  return { intercept: weights[0]!, slope: weights[1]! };
}

function assertR1067Safe(output: R1067NhanesWristFinalStressTestOutput): void {
  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findR1067SpecificFindings(output),
  ];
  if (findings.length > 0) {
    throw new Error(`R1067 NHANES wrist final stress test failed aggregate-egress validation: ${findings.join("; ")}`);
  }
}

function findR1067SpecificFindings(output: R1067NhanesWristFinalStressTestOutput): string[] {
  const findings: string[] = [];
  if (output.productDisplayAuthorized !== false || output.summary.productDisplayAuthorized !== false) {
    findings.push("product display must remain locked");
  }
  if (output.summary.rowValuesStored !== false) findings.push("row values must not be stored");
  const serialized = JSON.stringify(output);
  for (const forbidden of ["participant_key", "SEQN", "sample_weight_combined", "primary_5y_followup_months", ".runtime/"]) {
    if (serialized.includes(forbidden)) findings.push(`forbidden external artifact content ${forbidden}`);
  }
  return findings;
}

function safeBoundary() {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localFileNamesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    participantIdentifiersStored: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
  } as const;
}

function earlyDeath(row: ParsedRow, months: number): boolean {
  return row.y === 1 && row.followupMonths !== null && row.followupMonths <= months;
}

function hasBothClasses(rows: readonly ParsedRow[]): boolean {
  const events = rows.reduce((sum, row) => sum + row.y, 0);
  return events > 0 && events < rows.length;
}

function hasReportableEvents(rows: readonly ParsedRow[]): boolean {
  const events = rows.reduce((sum, row) => sum + row.y, 0);
  return rows.length >= 100 && events >= 10 && rows.length - events >= 10;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (quoted) {
      if (char === "\"" && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function parseSplit(value: string | undefined): Split | null {
  return value === "train" || value === "calibration" || value === "test" ? value : null;
}

function parseBinary(value: string | undefined): 0 | 1 | null {
  const parsed = Number(String(value ?? "").trim());
  if (parsed === 0) return 0;
  if (parsed === 1) return 1;
  return null;
}

function parseNumber(value: string | undefined): number | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePositiveNumber(value: string | undefined): number | null {
  const parsed = parseNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function logPositive(value: string | undefined): number | null {
  const parsed = parsePositiveNumber(value);
  return parsed === null ? null : Math.log(parsed);
}

function sexValue(value: string | undefined): number | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["1", "m", "male"].includes(normalized)) return 1;
  if (["2", "0", "f", "female"].includes(normalized)) return 0;
  return null;
}

function cycleId(value: string | undefined): ParsedRow["cycleId"] {
  const normalized = String(value ?? "");
  if (normalized.includes("2011") || normalized.includes("2012")) return "2011-2012";
  if (normalized.includes("2013") || normalized.includes("2014")) return "2013-2014";
  return "unknown";
}

function delta(candidate: number | null, comparator: number | null): number | null {
  return candidate === null || comparator === null ? null : roundOrNull(candidate - comparator);
}

function weightedMean(values: readonly number[], weights: readonly number[]): number | null {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  return totalWeight > 0 ? values.reduce((sum, value, index) => sum + value * weights[index]!, 0) / totalWeight : null;
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a.reduce((sum, value, index) => sum + value * b[index]!, 0);
}

function sigmoid(value: number): number {
  return value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mean(values: readonly number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values: readonly number[]): number {
  const sorted = values.filter(isFiniteNumber).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function standardDeviation(values: readonly number[]): number {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2))) || 1;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function countBand(count: number): string {
  if (count === 0) return "0";
  if (count < 10) return "1-9";
  if (count < 100) return "10-99";
  if (count < 1000) return "100-999";
  return "1000+";
}

function roundOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(8)) : null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR1067NhanesWristFinalStressTest({
    analyticCachePath: process.env.MURPH_AGE_NHANES_WRIST_ANALYTIC_CACHE_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  }).then(({ output }) => {
    process.stdout.write(`${JSON.stringify({
      conclusion: output.summary.conclusion,
      earlyDeathStress: output.summary.earlyDeathStress,
      packetId: output.packetId,
      productDisplayAuthorized: output.summary.productDisplayAuthorized,
      rowValuesStored: output.summary.rowValuesStored,
      schemaVersion: output.schemaVersion,
      subgroupStress: output.summary.subgroupStress,
      transportStress: output.summary.transportStress,
      usableAsConsumerWearableValidation: output.summary.usableAsConsumerWearableValidation,
    }, null, 2)}\n`);
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
