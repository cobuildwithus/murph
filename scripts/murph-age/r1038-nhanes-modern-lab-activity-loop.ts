import { createReadStream } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { createGunzip } from "node:zlib";

import { calculateAuc, findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import type { R1034AggregateCandidateMetric, R1034AggregateReceiptInput } from "./r1034-labs-wearables-aggregate-reducer.ts";

export const R1038_NHANES_MODERN_LAB_ACTIVITY_LOOP_SCHEMA_VERSION =
  "murph-age-r1038-nhanes-modern-lab-activity-loop.v1" as const;

const DEFAULT_ANALYTIC_CACHE_PATH = path.join(
  ".runtime",
  "cache",
  "murph-age",
  "nhanes-pam-2003-2006",
  "derived",
  "analytic",
  "nhanes-pam-2003-2006-lab-activity-v0.csv.gz",
);
const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1038-nhanes-modern-lab-activity-loop.latest.json";
const R1034_RECEIPT_FILE_NAME = "r1038-r1034-compatible-aggregate-receipt.latest.json";

const LAMBDAS = [0.0001, 0.001, 0.01, 0.1, 1] as const;
const ACTIVITY_FEATURE_KEYS = [
  "valid_day_count",
  "mean_daily_wear_minutes",
  "log_activity_total_counts",
  "mean_daily_sedentary_minutes",
  "mean_daily_light_minutes",
  "mean_daily_mvpa_minutes",
  "mean_daily_activity_fragmentation",
];
const C1_LAB5_HBA1C_BP_BODY_FEATURE_KEYS = [
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
];
const C3_LAB9_HBA1C_BP_BODY_FEATURE_KEYS = [
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

type Split = "calibration" | "test" | "train";
type CandidateRole = "negative_control" | "reference_only" | "score_bearing_research_candidate";

interface ParsedRow {
  index: number;
  split: Split;
  values: Record<string, number | null>;
  weight: number;
  y: 0 | 1;
}

interface TrainedModel {
  featureKeys: string[];
  lambda: number;
  predict(row: ParsedRow): number;
  score(row: ParsedRow): number;
  stats: Record<string, { median: number; mean: number; observedCount: number; sd: number }>;
}

interface CandidateDefinition {
  comparatorId: string | null;
  featureKeys: string[];
  role: CandidateRole;
}

interface MetricSummary {
  auc: number | null;
  brier: number | null;
  eOverO: number | null;
  eventCountBand: string;
  logLoss: number | null;
  meanPredicted: number | null;
  nBand: string;
  observedRate: number | null;
}

interface CandidateRunSummary {
  candidateId: string;
  comparatorId: string | null;
  role: CandidateRole;
  selectedLambdaStored: false;
  splitMetrics: Record<Split, MetricSummary>;
  testCalibration: {
    eOverO: number | null;
    intercept: number | null;
    slope: number | null;
  };
}

export interface R1038NhanesModernLabActivityLoopOptions {
  analyticCachePath?: string;
  calibrationIterations?: number;
  createdAt?: string;
  iterations?: number;
  outputDir?: string;
}

export interface R1038NhanesModernLabActivityLoopOutput {
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
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  benchmarkCardId: "nhanes_lab_activity_mortality_v1";
  candidateRuns: CandidateRunSummary[];
  createdAt: string;
  endpoint: "10y_all_cause_mortality";
  evidenceLabel: "same_family_public_bridge_not_consumer_wearable_validation";
  horizon: "10y";
  packetId: "r1038-nhanes-modern-lab-activity-loop";
  productDisplayAuthorized: false;
  r1034CompatibleReceipt: R1034AggregateReceiptInput;
  schemaVersion: typeof R1038_NHANES_MODERN_LAB_ACTIVITY_LOOP_SCHEMA_VERSION;
  splitShape: Record<Split, { eventCountBand: string; nBand: string }>;
  status: "research-local-aggregate-only";
  summary: {
    c8ActivityVsLab9: {
      aucDelta: number | null;
      brierDelta: number | null;
      calibrationSlope: number | null;
      eOverO: number | null;
      logLossDelta: number | null;
      negativeControlsBeaten: boolean;
    } | null;
    conclusion: "activity_signal_shadow_hold_for_calibration_or_external_validation" | "activity_signal_ready_for_r1034_review";
    productDisplayAuthorized: false;
    rowValuesStored: false;
  };
}

const CANDIDATES: Record<string, CandidateDefinition> = {
  R0_age_sex_reference: {
    comparatorId: null,
    featureKeys: ["age", "male"],
    role: "reference_only",
  },
  R1_age_sex_bp_body_reference: {
    comparatorId: "R0_age_sex_reference",
    featureKeys: ["age", "male", "sbp", "dbp", "bmi", "waist"],
    role: "reference_only",
  },
  C1_lab5_hba1c_bp_body: {
    comparatorId: "R1_age_sex_bp_body_reference",
    featureKeys: C1_LAB5_HBA1C_BP_BODY_FEATURE_KEYS,
    role: "score_bearing_research_candidate",
  },
  C2_lab5_glucose_bp_body: {
    comparatorId: "R1_age_sex_bp_body_reference",
    featureKeys: ["age", "male", "sbp", "dbp", "bmi", "waist", "glucose", "creatinine", "albumin", "hdl", "log_triglycerides"],
    role: "score_bearing_research_candidate",
  },
  C3_lab9_hba1c_bp_body_primary: {
    comparatorId: "R1_age_sex_bp_body_reference",
    featureKeys: C3_LAB9_HBA1C_BP_BODY_FEATURE_KEYS,
    role: "score_bearing_research_candidate",
  },
  C4_lab9_glucose_bp_body_sensitivity: {
    comparatorId: "R1_age_sex_bp_body_reference",
    featureKeys: [
      "age",
      "male",
      "sbp",
      "dbp",
      "bmi",
      "waist",
      "glucose",
      "creatinine",
      "albumin",
      "hdl",
      "log_triglycerides",
      "alkaline_phosphatase",
      "white_blood_cell_count",
      "lymphocyte_percent",
      "red_cell_distribution_width",
    ],
    role: "score_bearing_research_candidate",
  },
  C5_lab10_both_glycemia_bp_body_sensitivity: {
    comparatorId: "R1_age_sex_bp_body_reference",
    featureKeys: [
      "age",
      "male",
      "sbp",
      "dbp",
      "bmi",
      "waist",
      "hba1c",
      "glucose",
      "creatinine",
      "albumin",
      "hdl",
      "log_triglycerides",
      "alkaline_phosphatase",
      "white_blood_cell_count",
      "lymphocyte_percent",
      "red_cell_distribution_width",
    ],
    role: "score_bearing_research_candidate",
  },
  C6_age_sex_activity_primitives: {
    comparatorId: "R0_age_sex_reference",
    featureKeys: ["age", "male", ...ACTIVITY_FEATURE_KEYS],
    role: "score_bearing_research_candidate",
  },
  C7_lab5_hba1c_bp_body_activity: {
    comparatorId: "C1_lab5_hba1c_bp_body",
    featureKeys: [...C1_LAB5_HBA1C_BP_BODY_FEATURE_KEYS, ...ACTIVITY_FEATURE_KEYS],
    role: "score_bearing_research_candidate",
  },
  C8_lab9_hba1c_bp_body_activity_primary: {
    comparatorId: "C3_lab9_hba1c_bp_body_primary",
    featureKeys: [...C3_LAB9_HBA1C_BP_BODY_FEATURE_KEYS, ...ACTIVITY_FEATURE_KEYS],
    role: "score_bearing_research_candidate",
  },
  N1_coverage_quality_only_negative_control: {
    comparatorId: "C3_lab9_hba1c_bp_body_primary",
    featureKeys: [...C3_LAB9_HBA1C_BP_BODY_FEATURE_KEYS, "valid_day_count", "mean_daily_wear_minutes"],
    role: "negative_control",
  },
  N2_shuffled_activity_negative_control: {
    comparatorId: "C3_lab9_hba1c_bp_body_primary",
    featureKeys: [...C3_LAB9_HBA1C_BP_BODY_FEATURE_KEYS, ...ACTIVITY_FEATURE_KEYS.map((key) => `shuffled_${key}`)],
    role: "negative_control",
  },
  N3_cycle_context_only_negative_control: {
    comparatorId: "C3_lab9_hba1c_bp_body_primary",
    featureKeys: [...C3_LAB9_HBA1C_BP_BODY_FEATURE_KEYS, "cycle_context"],
    role: "negative_control",
  },
};

export async function runR1038NhanesModernLabActivityLoop(
  options: R1038NhanesModernLabActivityLoopOptions = {},
): Promise<{ output: R1038NhanesModernLabActivityLoopOutput; outputPath: string; r1034ReceiptPath: string }> {
  const analyticCachePath = options.analyticCachePath ?? DEFAULT_ANALYTIC_CACHE_PATH;
  await requireLocalCache(analyticCachePath);
  const rows = await readAnalyticRows(analyticCachePath);
  const iterations = options.iterations ?? 1800;
  const calibrationIterations = options.calibrationIterations ?? 1200;
  const trained = new Map<string, TrainedModel>();
  const runs: CandidateRunSummary[] = [];

  for (const [candidateId, definition] of Object.entries(CANDIDATES)) {
    const model = selectModel(rows, definition.featureKeys, iterations);
    const calibration = fitCalibrationTransform(rows, model, calibrationIterations);
    trained.set(candidateId, model);
    runs.push({
      candidateId,
      comparatorId: definition.comparatorId,
      role: definition.role,
      selectedLambdaStored: false,
      splitMetrics: {
        calibration: aggregateMetrics(rows, model, calibration, "calibration"),
        test: aggregateMetrics(rows, model, calibration, "test"),
        train: aggregateMetrics(rows, model, calibration, "train"),
      },
      testCalibration: calibrationAssessment(rows, model, calibration, "test", calibrationIterations),
    });
  }

  const r1034CompatibleReceipt = createR1034Receipt(runs);
  const c8Summary = c8ActivitySummary(runs, r1034CompatibleReceipt.candidateMetrics);
  const conclusion = c8Summary?.negativeControlsBeaten === true
    && c8Summary.brierDelta !== null
    && c8Summary.brierDelta < 0
    && c8Summary.logLossDelta !== null
    && c8Summary.logLossDelta < 0
    && c8Summary.calibrationSlope !== null
    && c8Summary.calibrationSlope >= 0.9
    && c8Summary.calibrationSlope <= 1.1
    && c8Summary.eOverO !== null
    && c8Summary.eOverO >= 0.95
    && c8Summary.eOverO <= 1.05
    ? "activity_signal_ready_for_r1034_review"
    : "activity_signal_shadow_hold_for_calibration_or_external_validation";

  const output: R1038NhanesModernLabActivityLoopOutput = {
    artifactBoundary: safeBoundary(),
    benchmarkCardId: "nhanes_lab_activity_mortality_v1",
    candidateRuns: runs,
    createdAt: options.createdAt ?? new Date().toISOString(),
    endpoint: "10y_all_cause_mortality",
    evidenceLabel: "same_family_public_bridge_not_consumer_wearable_validation",
    horizon: "10y",
    packetId: "r1038-nhanes-modern-lab-activity-loop",
    productDisplayAuthorized: false,
    r1034CompatibleReceipt,
    schemaVersion: R1038_NHANES_MODERN_LAB_ACTIVITY_LOOP_SCHEMA_VERSION,
    splitShape: splitShape(rows),
    status: "research-local-aggregate-only",
    summary: {
      c8ActivityVsLab9: c8Summary,
      conclusion,
      productDisplayAuthorized: false,
      rowValuesStored: false,
    },
  };

  assertR1038Safe(output);
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  const r1034ReceiptPath = path.join(outputDir, R1034_RECEIPT_FILE_NAME);
  await Promise.all([
    writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`),
    writeFile(r1034ReceiptPath, `${JSON.stringify(r1034CompatibleReceipt, null, 2)}\n`),
  ]);
  return { output, outputPath, r1034ReceiptPath };
}

export function assertR1038Safe(output: R1038NhanesModernLabActivityLoopOutput): void {
  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findR1038SpecificFindings(output),
  ];
  if (findings.length > 0) {
    throw new Error(`R1038 NHANES modern lab/activity loop failed safety validation: ${findings.join("; ")}`);
  }
}

async function requireLocalCache(filePath: string): Promise<void> {
  try {
    await access(filePath);
  } catch {
    throw new Error("R1038 requires the local ignored NHANES analytic cache before scoring.");
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
    const cells = line.split(",");
    const raw = Object.fromEntries(header.map((column, index) => [column, String(cells[index] ?? "").trim()]));
    const split = parseSplit(raw.split);
    const outcome = parseBinary(raw.primary_10y_event);
    if (!split || outcome === null) continue;
    const values = buildValues(raw);
    rows.push({
      index: rows.length,
      split,
      values,
      weight: parsePositiveNumber(raw.sample_weight_combined) ?? 1,
      y: outcome,
    });
  }
  if (rows.length === 0) {
    throw new Error("R1038 local NHANES analytic cache produced no eligible aggregate rows.");
  }
  attachShuffledActivityValues(rows);
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
    cycle_context: cycleContext(raw.cycle_id),
    dbp: parseNumber(raw.diastolic_blood_pressure),
    glucose: parseNumber(raw.glucose),
    hba1c: parseNumber(raw.hba1c),
    hdl: parseNumber(raw.hdl_cholesterol),
    log_activity_total_counts: logPositive(raw.mean_daily_total_counts),
    log_triglycerides: triglycerides === null ? null : Math.log(triglycerides),
    lymphocyte_percent: parseNumber(raw.lymphocyte_percent),
    male: sexValue(raw.sex_stratum),
    mean_daily_activity_fragmentation: parseNumber(raw.mean_daily_activity_fragmentation),
    mean_daily_light_minutes: parseNumber(raw.mean_daily_light_minutes),
    mean_daily_mvpa_minutes: parseNumber(raw.mean_daily_mvpa_minutes),
    mean_daily_sedentary_minutes: parseNumber(raw.mean_daily_sedentary_minutes),
    mean_daily_wear_minutes: parseNumber(raw.mean_daily_wear_minutes),
    red_cell_distribution_width: parseNumber(raw.red_cell_distribution_width),
    sbp: parseNumber(raw.systolic_blood_pressure),
    valid_day_count: parseNumber(raw.valid_day_count),
    waist: parseNumber(raw.waist_circumference),
    white_blood_cell_count: parseNumber(raw.white_blood_cell_count),
  };
}

function attachShuffledActivityValues(rows: ParsedRow[]): void {
  const sourceRows = [...rows];
  for (const row of rows) {
    const source = sourceRows[(row.index * 1103515245 + 12345) % sourceRows.length]!;
    for (const key of activityFeatureKeys()) {
      row.values[`shuffled_${key}`] = source.values[key] ?? null;
    }
  }
}

function selectModel(rows: readonly ParsedRow[], featureKeys: string[], iterations: number): TrainedModel {
  const candidates = LAMBDAS.map((lambda) => {
    const model = trainLogistic(rows, featureKeys, lambda, iterations);
    return {
      calibrationLogLoss: aggregateMetrics(rows, model, { intercept: 0, slope: 1 }, "calibration").logLoss ?? Number.POSITIVE_INFINITY,
      model,
    };
  });
  return candidates.sort((a, b) => a.calibrationLogLoss - b.calibrationLogLoss)[0]!.model;
}

function trainLogistic(
  rows: readonly ParsedRow[],
  featureKeys: string[],
  lambda: number,
  iterations: number,
): TrainedModel {
  const { stats, vectorForRow } = prepareFeatureMatrix(rows, featureKeys);
  const trainRows = rows.filter((row) => row.split === "train");
  const weights = new Array(featureKeys.length + 1).fill(0);
  const totalWeight = trainRows.reduce((sum, row) => sum + row.weight, 0) || 1;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const gradient = new Array(weights.length).fill(0);
    for (const row of trainRows) {
      const vector = vectorForRow(row);
      const error = sigmoid(dot(weights, vector)) - row.y;
      for (let index = 0; index < weights.length; index += 1) {
        gradient[index] += row.weight * error * vector[index]!;
      }
    }
    for (let index = 0; index < weights.length; index += 1) {
      gradient[index] /= totalWeight;
      if (index > 0) gradient[index] += lambda * weights[index]!;
      weights[index] -= 0.05 * gradient[index]!;
    }
  }
  return {
    featureKeys,
    lambda,
    predict: (row) => sigmoid(dot(weights, vectorForRow(row))),
    score: (row) => dot(weights, vectorForRow(row)),
    stats,
  };
}

function prepareFeatureMatrix(rows: readonly ParsedRow[], featureKeys: readonly string[]) {
  const trainRows = rows.filter((row) => row.split === "train");
  const stats: Record<string, { median: number; mean: number; observedCount: number; sd: number }> = {};
  for (const featureKey of featureKeys) {
    const observedTrainValues = trainRows
      .map((row) => row.values[featureKey])
      .filter(isFiniteNumber);
    const medianValue = median(observedTrainValues);
    const imputedTrainValues = trainRows.map((row) => row.values[featureKey] ?? medianValue);
    stats[featureKey] = {
      mean: mean(imputedTrainValues),
      median: medianValue,
      observedCount: rows.filter((row) => isFiniteNumber(row.values[featureKey])).length,
      sd: standardDeviation(imputedTrainValues),
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

function fitCalibrationTransform(
  rows: readonly ParsedRow[],
  model: TrainedModel,
  iterations: number,
): { intercept: number; slope: number } {
  return fitCalibrationOnLogit(rows.filter((row) => row.split === "calibration"), (row) => model.score(row), iterations);
}

function calibrationAssessment(
  rows: readonly ParsedRow[],
  model: TrainedModel,
  calibration: { intercept: number; slope: number },
  split: Split,
  iterations: number,
): CandidateRunSummary["testCalibration"] {
  const subset = rows.filter((row) => row.split === split);
  const metrics = aggregateMetrics(rows, model, calibration, split);
  const fit = fitCalibrationOnLogit(subset, (row) => logit(calibratedPrediction(model, calibration, row)), iterations);
  return {
    eOverO: metrics.eOverO,
    intercept: roundOrNull(fit.intercept),
    slope: roundOrNull(fit.slope),
  };
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

function aggregateMetrics(
  rows: readonly ParsedRow[],
  model: TrainedModel,
  calibration: { intercept: number; slope: number },
  split: Split,
): MetricSummary {
  const subset = rows.filter((row) => row.split === split);
  const labels = subset.map((row) => row.y);
  const probabilities = subset.map((row) => calibratedPrediction(model, calibration, row));
  const totalWeight = subset.reduce((sum, row) => sum + row.weight, 0);
  const observed = weightedMean(subset.map((row) => row.y), subset.map((row) => row.weight));
  const meanPredicted = weightedMean(probabilities, subset.map((row) => row.weight));
  const eps = 1e-6;
  return {
    auc: roundOrNull(calculateAuc(labels, probabilities)),
    brier: totalWeight > 0
      ? roundOrNull(subset.reduce((sum, row, index) => sum + row.weight * (probabilities[index]! - row.y) ** 2, 0) / totalWeight)
      : null,
    eOverO: observed !== null && observed > 0 && meanPredicted !== null ? roundOrNull(meanPredicted / observed) : null,
    eventCountBand: countBand(labels.reduce<number>((sum, label) => sum + label, 0)),
    logLoss: totalWeight > 0
      ? roundOrNull(-subset.reduce((sum, row, index) => {
        const p = probabilities[index]!;
        return sum + row.weight * (row.y * Math.log(Math.max(eps, p)) + (1 - row.y) * Math.log(Math.max(eps, 1 - p)));
      }, 0) / totalWeight)
      : null,
    meanPredicted: roundOrNull(meanPredicted),
    nBand: countBand(subset.length),
    observedRate: roundOrNull(observed),
  };
}

function calibratedPrediction(
  model: TrainedModel,
  calibration: { intercept: number; slope: number },
  row: ParsedRow,
): number {
  return sigmoid(calibration.intercept + calibration.slope * model.score(row));
}

function createR1034Receipt(runs: readonly CandidateRunSummary[]): R1034AggregateReceiptInput {
  const metrics = runs
    .filter((run) => run.comparatorId !== null)
    .map((run) => r1034MetricForRun(run, runs));
  return {
    artifactBoundary: safeBoundary(),
    benchmarkCardId: "nhanes_lab_activity_mortality_v1",
    candidateMetrics: metrics,
    endpoint: "all_cause_mortality",
    eventCountBand: mergedEventCountBand(runs),
    horizon: "10y",
    packetId: "r1038-nhanes-modern-lab-activity-loop",
    schemaVersion: R1038_NHANES_MODERN_LAB_ACTIVITY_LOOP_SCHEMA_VERSION,
  };
}

function r1034MetricForRun(
  run: CandidateRunSummary,
  runs: readonly CandidateRunSummary[],
): R1034AggregateCandidateMetric {
  const comparator = runs.find((candidateRun) => candidateRun.candidateId === run.comparatorId);
  if (!comparator) {
    throw new Error(`R1038 candidate ${run.candidateId} requires comparator ${run.comparatorId}.`);
  }
  return {
    aucDelta: delta(run.splitMetrics.test.auc, comparator.splitMetrics.test.auc),
    brierDelta: delta(run.splitMetrics.test.brier, comparator.splitMetrics.test.brier),
    calibrationSlope: run.testCalibration.slope,
    candidateId: run.candidateId,
    comparatorId: comparator.candidateId,
    eOverO: run.testCalibration.eOverO,
    logLossDelta: delta(run.splitMetrics.test.logLoss, comparator.splitMetrics.test.logLoss),
    negativeControlStatus: negativeControlStatus(run, runs),
    role: run.role,
    subgroupCalibrationStatus: "not_reportable",
  };
}

function negativeControlStatus(
  run: CandidateRunSummary,
  runs: readonly CandidateRunSummary[],
): R1034AggregateCandidateMetric["negativeControlStatus"] {
  if (run.role === "negative_control") return "not_applicable";
  if (!run.candidateId.includes("activity")) return "not_applicable";
  const negativeControls = runs
    .filter((candidateRun) => candidateRun.role === "negative_control" && candidateRun.comparatorId === "C3_lab9_hba1c_bp_body_primary")
    .map((candidateRun) => r1034DeltaPair(candidateRun, runs));
  const runDelta = r1034DeltaPair(run, runs);
  if (!negativeControls.length || runDelta.brierDelta === null || runDelta.logLossDelta === null) return "not_beaten";
  return negativeControls.every((control) =>
      control.brierDelta !== null
      && control.logLossDelta !== null
      && runDelta.brierDelta! < control.brierDelta
      && runDelta.logLossDelta! < control.logLossDelta
    )
    ? "beaten"
    : "not_beaten";
}

function r1034DeltaPair(run: CandidateRunSummary, runs: readonly CandidateRunSummary[]): {
  brierDelta: number | null;
  logLossDelta: number | null;
} {
  const comparator = runs.find((candidateRun) => candidateRun.candidateId === run.comparatorId);
  return {
    brierDelta: comparator ? delta(run.splitMetrics.test.brier, comparator.splitMetrics.test.brier) : null,
    logLossDelta: comparator ? delta(run.splitMetrics.test.logLoss, comparator.splitMetrics.test.logLoss) : null,
  };
}

function c8ActivitySummary(
  runs: readonly CandidateRunSummary[],
  metrics: readonly R1034AggregateCandidateMetric[],
): R1038NhanesModernLabActivityLoopOutput["summary"]["c8ActivityVsLab9"] {
  const metric = metrics.find((candidateMetric) => candidateMetric.candidateId === "C8_lab9_hba1c_bp_body_activity_primary");
  if (!metric) return null;
  return {
    aucDelta: metric.aucDelta,
    brierDelta: metric.brierDelta,
    calibrationSlope: metric.calibrationSlope,
    eOverO: metric.eOverO,
    logLossDelta: metric.logLossDelta,
    negativeControlsBeaten: metric.negativeControlStatus === "beaten",
  };
}

function splitShape(rows: readonly ParsedRow[]): R1038NhanesModernLabActivityLoopOutput["splitShape"] {
  return Object.fromEntries((["calibration", "test", "train"] as const).map((split) => {
    const subset = rows.filter((row) => row.split === split);
    return [split, {
      eventCountBand: countBand(subset.reduce((sum, row) => sum + row.y, 0)),
      nBand: countBand(subset.length),
    }];
  })) as R1038NhanesModernLabActivityLoopOutput["splitShape"];
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
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
  } as const;
}

function findR1038SpecificFindings(output: R1038NhanesModernLabActivityLoopOutput): string[] {
  const findings: string[] = [];
  if (output.productDisplayAuthorized !== false || output.summary.productDisplayAuthorized !== false) {
    findings.push("product display must remain locked");
  }
  if (output.summary.rowValuesStored !== false) {
    findings.push("row values must not be stored");
  }
  const serialized = JSON.stringify(output);
  for (const forbidden of ["SEQN", "participant_key", "sample_weight_combined", "primary_10y_followup_months"]) {
    if (serialized.includes(forbidden)) findings.push(`forbidden row-level column egress ${forbidden}`);
  }
  return findings;
}

function activityFeatureKeys(): string[] {
  return ACTIVITY_FEATURE_KEYS;
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

function cycleContext(value: string | undefined): number | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  if (normalized.includes("2005") || normalized.includes("2006")) return 1;
  if (normalized.includes("2003") || normalized.includes("2004")) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function delta(candidate: number | null, comparator: number | null): number | null {
  return candidate === null || comparator === null ? null : roundOrNull(candidate - comparator);
}

function mergedEventCountBand(runs: readonly CandidateRunSummary[]): string {
  const testBand = runs[0]?.splitMetrics.test.eventCountBand;
  return testBand ?? "0";
}

function hasBothClasses(rows: readonly ParsedRow[]): boolean {
  const events = rows.reduce((sum, row) => sum + row.y, 0);
  return events > 0 && events < rows.length;
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

function logit(probability: number): number {
  const p = clamp(probability, 1e-6, 1 - 1e-6);
  return Math.log(p / (1 - p));
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
  runR1038NhanesModernLabActivityLoop({
    analyticCachePath: process.env.MURPH_AGE_NHANES_ANALYTIC_CACHE_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  }).then(({ output }) => {
    process.stdout.write(`${JSON.stringify({
      c8ActivityVsLab9: output.summary.c8ActivityVsLab9,
      conclusion: output.summary.conclusion,
      packetId: output.packetId,
      productDisplayAuthorized: output.summary.productDisplayAuthorized,
      rowValuesStored: output.summary.rowValuesStored,
      schemaVersion: output.schemaVersion,
      status: output.status,
    }, null, 2)}\n`);
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
