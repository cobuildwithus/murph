import { createReadStream } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { createGunzip } from "node:zlib";

import { calculateAuc, findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import type { R1034AggregateCandidateMetric, R1034AggregateReceiptInput } from "./r1034-labs-wearables-aggregate-reducer.ts";

export const R1066_NHANES_WRIST_ACTIVITY_ROBUSTNESS_LOOP_SCHEMA_VERSION =
  "murph-age-r1066-nhanes-wrist-activity-robustness-loop.v1" as const;

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
const OUTPUT_FILE_NAME = "r1066-nhanes-wrist-activity-robustness-loop.latest.json";
const R1034_RECEIPT_FILE_NAME = "r1066-r1034-compatible-aggregate-receipt.latest.json";

const LAMBDAS = [0.0001, 0.001, 0.01, 0.1, 1] as const;
const COVERAGE_WEAR_FEATURE_KEYS = [
  "valid_day_count",
  "mean_daily_valid_minutes",
  "mean_daily_wake_wear_minutes",
  "mean_daily_sleep_wear_minutes",
  "mean_daily_nonwear_minutes",
];
const ACTIVITY_FEATURE_KEYS = [
  "log_daily_total_activity",
  ...COVERAGE_WEAR_FEATURE_KEYS,
];
const ACTIVITY_WITHOUT_SLEEP_NONWEAR_FEATURE_KEYS = [
  "log_daily_total_activity",
  "valid_day_count",
  "mean_daily_valid_minutes",
  "mean_daily_wake_wear_minutes",
];
const SLEEP_WEAR_NONWEAR_FEATURE_KEYS = [
  "mean_daily_wake_wear_minutes",
  "mean_daily_sleep_wear_minutes",
  "mean_daily_nonwear_minutes",
];
const LAB5_BP_BODY_FEATURE_KEYS = [
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
const LAB9_BP_BODY_FEATURE_KEYS = [
  ...LAB5_BP_BODY_FEATURE_KEYS,
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

interface DeltaInterval {
  high: number | null;
  low: number | null;
}

interface PrimaryActivityDeltaSummary {
  aucDelta: number | null;
  brierDelta: number | null;
  calibrationSlope: number | null;
  eOverO: number | null;
  logLossDelta: number | null;
  negativeControlsBeaten: boolean;
}

interface RobustnessSummary {
  ablationDeltas: {
    activityAdjustedForCoverage: PrimaryActivityDeltaSummary | null;
    activityOnly: PrimaryActivityDeltaSummary | null;
    activityWithoutSleepNonwear: PrimaryActivityDeltaSummary | null;
    coverageWearOnly: PrimaryActivityDeltaSummary | null;
    sleepWearNonwearOnly: PrimaryActivityDeltaSummary | null;
  };
  activitySignalVerdict:
    | "activity_increment_survives_coverage_controls"
    | "activity_increment_not_separated_from_coverage_or_unstable";
  uncertainty: {
    aucDeltaInterval: DeltaInterval;
    bootstrapIterations: number;
    brierDeltaInterval: DeltaInterval;
    logLossDeltaInterval: DeltaInterval;
    signStability: {
      aucImprovedFraction: number | null;
      brierImprovedFraction: number | null;
      logLossImprovedFraction: number | null;
    };
  };
}

export interface R1066NhanesWristActivityRobustnessLoopOptions {
  analyticCachePath?: string;
  calibrationIterations?: number;
  bootstrapIterations?: number;
  createdAt?: string;
  iterations?: number;
  outputDir?: string;
}

export interface R1066NhanesWristActivityRobustnessLoopOutput {
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
  candidateRuns: CandidateRunSummary[];
  createdAt: string;
  denominator: "mortality_eligible_age_40_79_5y_observed";
  endpoint: "5y_all_cause_mortality";
  evidenceLabel: "same_family_public_wrist_activity_sidecar_not_consumer_wearable_validation";
  horizon: "5y";
  packetId: "r1066-nhanes-wrist-activity-robustness-loop";
  productDisplayAuthorized: false;
  r1034CompatibleReceipt: R1034AggregateReceiptInput;
  schemaVersion: typeof R1066_NHANES_WRIST_ACTIVITY_ROBUSTNESS_LOOP_SCHEMA_VERSION;
  splitShape: Record<Split, { eventCountBand: string; nBand: string }>;
  status: "research-local-aggregate-only";
  summary: {
    primaryActivityVsLab9: PrimaryActivityDeltaSummary | null;
    robustness: RobustnessSummary;
    conclusion:
      | "wrist_activity_robustness_supports_stronger_shadow_evidence"
      | "wrist_activity_robustness_inconclusive_keep_shadow";
    productDisplayAuthorized: false;
    rowValuesStored: false;
    usableAsConsumerWearableValidation: false;
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
  C1_lab5_bp_body: {
    comparatorId: "R1_age_sex_bp_body_reference",
    featureKeys: LAB5_BP_BODY_FEATURE_KEYS,
    role: "score_bearing_research_candidate",
  },
  C2_lab9_bp_body_primary: {
    comparatorId: "R1_age_sex_bp_body_reference",
    featureKeys: LAB9_BP_BODY_FEATURE_KEYS,
    role: "score_bearing_research_candidate",
  },
  C4a_lab9_plus_log_activity_only: {
    comparatorId: "C2_lab9_bp_body_primary",
    featureKeys: [...LAB9_BP_BODY_FEATURE_KEYS, "log_daily_total_activity"],
    role: "score_bearing_research_candidate",
  },
  C4b_lab9_plus_full_coverage_wear_only: {
    comparatorId: "C2_lab9_bp_body_primary",
    featureKeys: [...LAB9_BP_BODY_FEATURE_KEYS, ...COVERAGE_WEAR_FEATURE_KEYS],
    role: "negative_control",
  },
  C4c_lab9_plus_log_activity_adjusted_for_coverage_primary: {
    comparatorId: "C2_lab9_bp_body_primary",
    featureKeys: [...LAB9_BP_BODY_FEATURE_KEYS, ...ACTIVITY_FEATURE_KEYS],
    role: "score_bearing_research_candidate",
  },
  C4d_lab9_plus_sleep_wear_nonwear_composition_only: {
    comparatorId: "C2_lab9_bp_body_primary",
    featureKeys: [...LAB9_BP_BODY_FEATURE_KEYS, ...SLEEP_WEAR_NONWEAR_FEATURE_KEYS],
    role: "negative_control",
  },
  C4e_lab9_plus_activity_without_sleep_nonwear_fields: {
    comparatorId: "C2_lab9_bp_body_primary",
    featureKeys: [...LAB9_BP_BODY_FEATURE_KEYS, ...ACTIVITY_WITHOUT_SLEEP_NONWEAR_FEATURE_KEYS],
    role: "score_bearing_research_candidate",
  },
  N1_coverage_wear_only_negative_control: {
    comparatorId: "C2_lab9_bp_body_primary",
    featureKeys: [...LAB9_BP_BODY_FEATURE_KEYS, ...COVERAGE_WEAR_FEATURE_KEYS],
    role: "negative_control",
  },
  N2_shuffled_activity_within_split_negative_control: {
    comparatorId: "C2_lab9_bp_body_primary",
    featureKeys: [...LAB9_BP_BODY_FEATURE_KEYS, "shuffled_split_log_daily_total_activity", ...COVERAGE_WEAR_FEATURE_KEYS],
    role: "negative_control",
  },
  N3_shuffled_activity_within_age_sex_cycle_negative_control: {
    comparatorId: "C2_lab9_bp_body_primary",
    featureKeys: [...LAB9_BP_BODY_FEATURE_KEYS, "shuffled_age_sex_cycle_log_daily_total_activity", ...COVERAGE_WEAR_FEATURE_KEYS],
    role: "negative_control",
  },
  N4_cycle_context_only_negative_control: {
    comparatorId: "C2_lab9_bp_body_primary",
    featureKeys: [...LAB9_BP_BODY_FEATURE_KEYS, "cycle_context"],
    role: "negative_control",
  },
  N5_valid_day_threshold_only_negative_control: {
    comparatorId: "C2_lab9_bp_body_primary",
    featureKeys: [...LAB9_BP_BODY_FEATURE_KEYS, "valid_day_threshold_met"],
    role: "negative_control",
  },
};

export async function runR1066NhanesWristActivityRobustnessLoop(
  options: R1066NhanesWristActivityRobustnessLoopOptions = {},
): Promise<{ output: R1066NhanesWristActivityRobustnessLoopOutput; outputPath: string; r1034ReceiptPath: string }> {
  const analyticCachePath = options.analyticCachePath ?? DEFAULT_ANALYTIC_CACHE_PATH;
  await requireLocalCache(analyticCachePath);
  const rows = await readAnalyticRows(analyticCachePath);
  const iterations = options.iterations ?? 900;
  const calibrationIterations = options.calibrationIterations ?? 600;
  const bootstrapIterations = options.bootstrapIterations ?? 80;
  const runs: CandidateRunSummary[] = [];
  const trained = new Map<string, { calibration: { intercept: number; slope: number }; model: TrainedModel }>();

  for (const [candidateId, definition] of Object.entries(CANDIDATES)) {
    const model = selectModel(rows, definition.featureKeys, iterations);
    const calibration = fitCalibrationTransform(rows, model, calibrationIterations);
    trained.set(candidateId, { calibration, model });
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
  const robustness = robustnessSummary(rows, r1034CompatibleReceipt.candidateMetrics, trained, bootstrapIterations);
  const primaryActivitySummary = robustness.ablationDeltas.activityAdjustedForCoverage;
  const conclusion = robustness.activitySignalVerdict === "activity_increment_survives_coverage_controls"
    ? "wrist_activity_robustness_supports_stronger_shadow_evidence"
    : "wrist_activity_robustness_inconclusive_keep_shadow";

  const output: R1066NhanesWristActivityRobustnessLoopOutput = {
    artifactBoundary: safeBoundary(),
    benchmarkCardId: "nhanes_wrist_lab_activity_mortality_5y_v1",
    candidateRuns: runs,
    createdAt: options.createdAt ?? new Date().toISOString(),
    denominator: "mortality_eligible_age_40_79_5y_observed",
    endpoint: "5y_all_cause_mortality",
    evidenceLabel: "same_family_public_wrist_activity_sidecar_not_consumer_wearable_validation",
    horizon: "5y",
    packetId: "r1066-nhanes-wrist-activity-robustness-loop",
    productDisplayAuthorized: false,
    r1034CompatibleReceipt,
    schemaVersion: R1066_NHANES_WRIST_ACTIVITY_ROBUSTNESS_LOOP_SCHEMA_VERSION,
    splitShape: splitShape(rows),
    status: "research-local-aggregate-only",
    summary: {
      primaryActivityVsLab9: primaryActivitySummary,
      robustness,
      conclusion,
      productDisplayAuthorized: false,
      rowValuesStored: false,
      usableAsConsumerWearableValidation: false,
    },
  };

  assertR1066Safe(output);
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

export function assertR1066Safe(output: R1066NhanesWristActivityRobustnessLoopOutput): void {
  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findR1066SpecificFindings(output),
  ];
  if (findings.length > 0) {
    throw new Error(`R1066 NHANES wrist activity robustness loop failed safety validation: ${findings.join("; ")}`);
  }
}

async function requireLocalCache(filePath: string): Promise<void> {
  try {
    await access(filePath);
  } catch {
    throw new Error("R1066 requires the local ignored NHANES wrist analytic cache before scoring.");
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
    throw new Error("R1066 local NHANES wrist analytic cache produced no eligible aggregate rows.");
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
    valid_day_threshold_met: validDayThreshold(raw.valid_day_count),
    waist: parseNumber(raw.waist_circumference),
    white_blood_cell_count: parseNumber(raw.white_blood_cell_count),
  };
}

function attachShuffledActivityValues(rows: ParsedRow[]): void {
  for (const row of rows) {
    const splitSource = deterministicSourceRow(rows.filter((candidate) => candidate.split === row.split), row.index, 17);
    const bandSource = deterministicSourceRow(rows.filter((candidate) => shuffleBand(candidate) === shuffleBand(row)), row.index, 29);
    row.values.shuffled_split_log_daily_total_activity = splitSource?.values.log_daily_total_activity ?? null;
    row.values.shuffled_age_sex_cycle_log_daily_total_activity = bandSource?.values.log_daily_total_activity ?? null;
  }
}

function deterministicSourceRow(rows: readonly ParsedRow[], rowIndex: number, salt: number): ParsedRow | null {
  if (rows.length === 0) return null;
  return rows[(rowIndex * 1103515245 + 12345 + salt) % rows.length] ?? null;
}

function shuffleBand(row: ParsedRow): string {
  const age = row.values.age;
  const ageBand = age === null ? "unknown" : age < 60 ? "40_59" : "60_79";
  return `${row.split}:${ageBand}:${row.values.male ?? "unknown"}:${row.values.cycle_context ?? "unknown"}`;
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
    benchmarkCardId: "nhanes_wrist_lab_activity_mortality_5y_v1",
    candidateMetrics: metrics,
    endpoint: "all_cause_mortality",
    eventCountBand: mergedEventCountBand(runs),
    horizon: "5y",
    packetId: "r1066-nhanes-wrist-activity-robustness-loop",
    schemaVersion: R1066_NHANES_WRIST_ACTIVITY_ROBUSTNESS_LOOP_SCHEMA_VERSION,
  };
}

function r1034MetricForRun(
  run: CandidateRunSummary,
  runs: readonly CandidateRunSummary[],
): R1034AggregateCandidateMetric {
  const comparator = runs.find((candidateRun) => candidateRun.candidateId === run.comparatorId);
  if (!comparator) {
    throw new Error(`R1066 candidate ${run.candidateId} requires comparator ${run.comparatorId}.`);
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
    .filter((candidateRun) => candidateRun.role === "negative_control" && candidateRun.comparatorId === "C2_lab9_bp_body_primary")
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

function robustnessSummary(
  rows: readonly ParsedRow[],
  metrics: readonly R1034AggregateCandidateMetric[],
  trained: ReadonlyMap<string, { calibration: { intercept: number; slope: number }; model: TrainedModel }>,
  bootstrapIterations: number,
): RobustnessSummary {
  const activityAdjustedForCoverage = activityDeltaSummary(metrics, "C4c_lab9_plus_log_activity_adjusted_for_coverage_primary");
  const coverageWearOnly = activityDeltaSummary(metrics, "C4b_lab9_plus_full_coverage_wear_only");
  const uncertainty = bootstrapDeltaSummary({
    bootstrapIterations,
    candidate: trained.get("C4c_lab9_plus_log_activity_adjusted_for_coverage_primary"),
    comparator: trained.get("C2_lab9_bp_body_primary"),
    rows,
  });
  const activityImproved = activityAdjustedForCoverage?.brierDelta !== null
    && activityAdjustedForCoverage?.brierDelta !== undefined
    && activityAdjustedForCoverage.brierDelta < 0
    && activityAdjustedForCoverage.logLossDelta !== null
    && activityAdjustedForCoverage.logLossDelta < 0
    && activityAdjustedForCoverage.negativeControlsBeaten;
  const separatedFromCoverage = activityAdjustedForCoverage !== null
    && coverageWearOnly !== null
    && activityAdjustedForCoverage.brierDelta !== null
    && coverageWearOnly.brierDelta !== null
    && activityAdjustedForCoverage.logLossDelta !== null
    && coverageWearOnly.logLossDelta !== null
    && activityAdjustedForCoverage.brierDelta < coverageWearOnly.brierDelta
    && activityAdjustedForCoverage.logLossDelta < coverageWearOnly.logLossDelta;
  const uncertaintyStable = uncertainty.signStability.brierImprovedFraction !== null
    && uncertainty.signStability.brierImprovedFraction >= 0.75
    && uncertainty.signStability.logLossImprovedFraction !== null
    && uncertainty.signStability.logLossImprovedFraction >= 0.75;

  return {
    ablationDeltas: {
      activityAdjustedForCoverage,
      activityOnly: activityDeltaSummary(metrics, "C4a_lab9_plus_log_activity_only"),
      activityWithoutSleepNonwear: activityDeltaSummary(metrics, "C4e_lab9_plus_activity_without_sleep_nonwear_fields"),
      coverageWearOnly,
      sleepWearNonwearOnly: activityDeltaSummary(metrics, "C4d_lab9_plus_sleep_wear_nonwear_composition_only"),
    },
    activitySignalVerdict: activityImproved && separatedFromCoverage && uncertaintyStable
      ? "activity_increment_survives_coverage_controls"
      : "activity_increment_not_separated_from_coverage_or_unstable",
    uncertainty,
  };
}

function activityDeltaSummary(
  metrics: readonly R1034AggregateCandidateMetric[],
  candidateId: string,
): PrimaryActivityDeltaSummary | null {
  const metric = metrics.find((candidateMetric) => candidateMetric.candidateId === candidateId);
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

function bootstrapDeltaSummary(input: {
  bootstrapIterations: number;
  candidate: { calibration: { intercept: number; slope: number }; model: TrainedModel } | undefined;
  comparator: { calibration: { intercept: number; slope: number }; model: TrainedModel } | undefined;
  rows: readonly ParsedRow[];
}): RobustnessSummary["uncertainty"] {
  const testRows = input.rows.filter((row) => row.split === "test");
  if (!input.candidate || !input.comparator || testRows.length === 0 || input.bootstrapIterations <= 0) {
    return emptyUncertainty(input.bootstrapIterations);
  }
  const aucDeltas: number[] = [];
  const brierDeltas: number[] = [];
  const logLossDeltas: number[] = [];
  for (let iteration = 0; iteration < input.bootstrapIterations; iteration += 1) {
    const sampled = bootstrapSample(testRows, iteration + 1);
    const candidateMetrics = aggregateMetricsForRows(sampled, input.candidate.model, input.candidate.calibration);
    const comparatorMetrics = aggregateMetricsForRows(sampled, input.comparator.model, input.comparator.calibration);
    pushIfFinite(aucDeltas, rawDelta(candidateMetrics.auc, comparatorMetrics.auc));
    pushIfFinite(brierDeltas, rawDelta(candidateMetrics.brier, comparatorMetrics.brier));
    pushIfFinite(logLossDeltas, rawDelta(candidateMetrics.logLoss, comparatorMetrics.logLoss));
  }
  return {
    aucDeltaInterval: percentileInterval(aucDeltas),
    bootstrapIterations: input.bootstrapIterations,
    brierDeltaInterval: percentileInterval(brierDeltas),
    logLossDeltaInterval: percentileInterval(logLossDeltas),
    signStability: {
      aucImprovedFraction: fraction(aucDeltas, (value) => value > 0),
      brierImprovedFraction: fraction(brierDeltas, (value) => value < 0),
      logLossImprovedFraction: fraction(logLossDeltas, (value) => value < 0),
    },
  };
}

function emptyUncertainty(bootstrapIterations: number): RobustnessSummary["uncertainty"] {
  return {
    aucDeltaInterval: { high: null, low: null },
    bootstrapIterations,
    brierDeltaInterval: { high: null, low: null },
    logLossDeltaInterval: { high: null, low: null },
    signStability: {
      aucImprovedFraction: null,
      brierImprovedFraction: null,
      logLossImprovedFraction: null,
    },
  };
}

function bootstrapSample(rows: readonly ParsedRow[], seed: number): ParsedRow[] {
  let state = seed >>> 0;
  return Array.from({ length: rows.length }, () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return rows[state % rows.length]!;
  });
}

function aggregateMetricsForRows(
  rows: readonly ParsedRow[],
  model: TrainedModel,
  calibration: { intercept: number; slope: number },
): Pick<MetricSummary, "auc" | "brier" | "logLoss"> {
  const labels = rows.map((row) => row.y);
  const probabilities = rows.map((row) => calibratedPrediction(model, calibration, row));
  const weights = rows.map((row) => row.weight);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const eps = 1e-6;
  return {
    auc: calculateAuc(labels, probabilities),
    brier: totalWeight > 0
      ? rows.reduce((sum, row, index) => sum + row.weight * (probabilities[index]! - row.y) ** 2, 0) / totalWeight
      : null,
    logLoss: totalWeight > 0
      ? -rows.reduce((sum, row, index) => {
        const p = probabilities[index]!;
        return sum + row.weight * (row.y * Math.log(Math.max(eps, p)) + (1 - row.y) * Math.log(Math.max(eps, 1 - p)));
      }, 0) / totalWeight
      : null,
  };
}

function rawDelta(candidate: number | null, comparator: number | null): number | null {
  return candidate === null || comparator === null ? null : candidate - comparator;
}

function pushIfFinite(values: number[], value: number | null): void {
  if (typeof value === "number" && Number.isFinite(value)) values.push(value);
}

function percentileInterval(values: readonly number[]): DeltaInterval {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return { high: null, low: null };
  return {
    high: roundOrNull(sorted[Math.min(sorted.length - 1, Math.floor(0.975 * (sorted.length - 1)))]),
    low: roundOrNull(sorted[Math.floor(0.025 * (sorted.length - 1))]),
  };
}

function fraction(values: readonly number[], predicate: (value: number) => boolean): number | null {
  return values.length > 0 ? roundOrNull(values.filter(predicate).length / values.length) : null;
}

function splitShape(rows: readonly ParsedRow[]): R1066NhanesWristActivityRobustnessLoopOutput["splitShape"] {
  return Object.fromEntries((["calibration", "test", "train"] as const).map((split) => {
    const subset = rows.filter((row) => row.split === split);
    return [split, {
      eventCountBand: countBand(subset.reduce((sum, row) => sum + row.y, 0)),
      nBand: countBand(subset.length),
    }];
  })) as R1066NhanesWristActivityRobustnessLoopOutput["splitShape"];
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

function findR1066SpecificFindings(output: R1066NhanesWristActivityRobustnessLoopOutput): string[] {
  const findings: string[] = [];
  if (output.productDisplayAuthorized !== false || output.summary.productDisplayAuthorized !== false) {
    findings.push("product display must remain locked");
  }
  if (output.summary.rowValuesStored !== false) {
    findings.push("row values must not be stored");
  }
  const serialized = JSON.stringify(output);
  for (const forbidden of ["participant_key", "SEQN", "sample_weight_combined", "primary_5y_followup_months"]) {
    if (serialized.includes(forbidden)) findings.push(`forbidden row-level column egress ${forbidden}`);
  }
  return findings;
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

function validDayThreshold(value: string | undefined): number | null {
  const parsed = parseNumber(value);
  return parsed === null ? null : parsed >= 4 ? 1 : 0;
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
  if (normalized.includes("2013") || normalized.includes("2014")) return 1;
  if (normalized.includes("2011") || normalized.includes("2012")) return 0;
  return null;
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
  runR1066NhanesWristActivityRobustnessLoop({
    analyticCachePath: process.env.MURPH_AGE_NHANES_WRIST_ANALYTIC_CACHE_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  }).then(({ output }) => {
    process.stdout.write(`${JSON.stringify({
      conclusion: output.summary.conclusion,
      packetId: output.packetId,
      primaryActivityVsLab9: output.summary.primaryActivityVsLab9,
      productDisplayAuthorized: output.summary.productDisplayAuthorized,
      robustnessVerdict: output.summary.robustness.activitySignalVerdict,
      rowValuesStored: output.summary.rowValuesStored,
      schemaVersion: output.schemaVersion,
      status: output.status,
      usableAsConsumerWearableValidation: output.summary.usableAsConsumerWearableValidation,
    }, null, 2)}\n`);
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
