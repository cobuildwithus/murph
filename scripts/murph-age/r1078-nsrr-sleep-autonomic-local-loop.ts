import { createReadStream } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { createGunzip } from "node:zlib";

import { calculateAuc, findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import type { R1070NsrrSleepAutonomicAggregateReceiptInput } from "./r1070-nsrr-sleep-autonomic-aggregate-receipt.ts";

export const R1078_NSRR_SLEEP_AUTONOMIC_LOCAL_LOOP_SCHEMA_VERSION =
  "murph-age-r1078-nsrr-sleep-autonomic-local-loop.v1" as const;

export const R1078_DEFAULT_ANALYTIC_CACHE_PATH = path.join(
  ".runtime",
  "cache",
  "murph-age",
  "nsrr-sleep-autonomic",
  "derived",
  "analytic",
  "nsrr-sleep-autonomic-v0.csv.gz",
);
const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1078-nsrr-sleep-autonomic-local-loop.latest.json";
const R1070_RECEIPT_FILE_NAME = "r1078-r1070-compatible-aggregate-receipt.latest.json";

const LAMBDAS = [0.0001, 0.001, 0.01, 0.1, 1] as const;
const SOURCE_CLINICAL_BASE_KEYS = [
  "age",
  "male",
  "body_mass_index",
  "systolic_blood_pressure",
  "diastolic_blood_pressure",
  "clinical_context_score",
];
const SLEEP_DURATION_REGULARITY_KEYS = [
  "sleep_duration_hours",
  "sleep_efficiency",
  "sleep_midpoint_variability",
  "sleep_regularity_index",
];
const SLEEP_BREATHING_AUTONOMIC_KEYS = [
  "apnea_hypopnea_index",
  "mean_spo2",
  "min_spo2",
  "resting_heart_rate",
  "heart_rate_variability",
];
const SLEEP_ACTIVITY_KEYS = [
  "mean_daily_activity",
  "sedentary_minutes",
  "active_minutes",
  "sleep_wake_transition_count",
];
const COVERAGE_QUALITY_KEYS = [
  "valid_night_count",
  "recording_minutes",
  "wear_time_minutes",
];
const SCORE_SIGNAL_KEYS = [
  ...SLEEP_DURATION_REGULARITY_KEYS,
  ...SLEEP_BREATHING_AUTONOMIC_KEYS,
  ...SLEEP_ACTIVITY_KEYS,
];

type Split = "calibration" | "test" | "train";
type CandidateId = R1070NsrrSleepAutonomicAggregateReceiptInput["candidateMetrics"][number]["candidateId"];
type CandidateRole = R1070NsrrSleepAutonomicAggregateReceiptInput["candidateMetrics"][number]["role"];
type Endpoint = R1070NsrrSleepAutonomicAggregateReceiptInput["endpoint"];
type Horizon = R1070NsrrSleepAutonomicAggregateReceiptInput["horizon"];
type NsrrCandidateMetric = R1070NsrrSleepAutonomicAggregateReceiptInput["candidateMetrics"][number];

interface ParsedRow {
  index: number;
  split: Split;
  values: Record<string, number | null>;
  weight: number;
  y: 0 | 1;
}

interface CandidateDefinition {
  comparatorId: CandidateId | null;
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

interface TrainedModel {
  predict(row: ParsedRow): number;
  score(row: ParsedRow): number;
}

interface CandidateRunSummary {
  candidateId: CandidateId;
  comparatorId: CandidateId | null;
  featureCount: number;
  role: CandidateRole;
  selectedLambdaStored: false;
  splitMetrics: Record<Split, MetricSummary>;
  testCalibration: {
    eOverO: number | null;
    slope: number | null;
  };
}

export interface R1078NsrrSleepAutonomicLocalLoopOptions {
  analyticCachePath?: string;
  calibrationIterations?: number;
  createdAt?: string;
  endpoint?: Endpoint;
  horizon?: Horizon;
  iterations?: number;
  outputDir?: string;
}

export interface R1078NsrrSleepAutonomicLocalLoopOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1078: true;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
    standardizedColumnNamesStored: false;
  };
  benchmarkCardId: "nsrr_sleep_autonomic_local_aggregate_v1";
  candidateRuns: CandidateRunSummary[];
  createdAt: string;
  endpoint: Endpoint;
  evidenceLabel: "local_data_holder_nsrr_sleep_autonomic_research_only";
  horizon: Horizon;
  packetId: "r1078-nsrr-sleep-autonomic-local-loop";
  productDisplayAuthorized: false;
  r1070CompatibleReceipt: R1070NsrrSleepAutonomicAggregateReceiptInput;
  receiptArtifact: typeof R1070_RECEIPT_FILE_NAME;
  schemaVersion: typeof R1078_NSRR_SLEEP_AUTONOMIC_LOCAL_LOOP_SCHEMA_VERSION;
  splitShape: Record<Split, { eventCountBand: string; nBand: string }>;
  standardAnalyticCacheContract: {
    cacheRoot: ".runtime/cache/murph-age/nsrr-sleep-autonomic/derived/analytic";
    localOnly: true;
    requiredGenericColumnFamilies: string[];
    sourceSpecificColumnMapStoredInGit: false;
  };
  status: "research-local-aggregate-only";
  summary: {
    bestScoreBearingCandidate: {
      brierDelta: number | null;
      candidateId: CandidateId;
      logLossDelta: number | null;
      negativeControlStatus: NsrrCandidateMetric["negativeControlStatus"];
    } | null;
    conclusion:
      | "nsrr_sleep_autonomic_delta_ready_for_r1070"
      | "nsrr_sleep_autonomic_hold_for_more_data_or_controls";
    productDisplayAuthorized: false;
    rowValuesStored: false;
    reviewGptRequiredNow: false;
  };
}

const CANDIDATES: Record<CandidateId, CandidateDefinition> = {
  N0_age_sex: {
    comparatorId: null,
    featureKeys: ["age", "male"],
    role: "reference_only",
  },
  N1_source_clinical_base: {
    comparatorId: "N0_age_sex",
    featureKeys: SOURCE_CLINICAL_BASE_KEYS,
    role: "reference_only",
  },
  N2_sleep_duration_regularity: {
    comparatorId: "N1_source_clinical_base",
    featureKeys: [...SOURCE_CLINICAL_BASE_KEYS, ...SLEEP_DURATION_REGULARITY_KEYS],
    role: "score_bearing_research_candidate",
  },
  N3_sleep_breathing_autonomic: {
    comparatorId: "N1_source_clinical_base",
    featureKeys: [...SOURCE_CLINICAL_BASE_KEYS, ...SLEEP_BREATHING_AUTONOMIC_KEYS],
    role: "score_bearing_research_candidate",
  },
  N4_sleep_activity_autonomic_combo: {
    comparatorId: "N1_source_clinical_base",
    featureKeys: [...SOURCE_CLINICAL_BASE_KEYS, ...SCORE_SIGNAL_KEYS],
    role: "score_bearing_research_candidate",
  },
  N5_coverage_quality_only_negative_control: {
    comparatorId: "N1_source_clinical_base",
    featureKeys: [...SOURCE_CLINICAL_BASE_KEYS, ...COVERAGE_QUALITY_KEYS],
    role: "negative_control",
  },
  N6_shuffled_sleep_autonomic_negative_control: {
    comparatorId: "N1_source_clinical_base",
    featureKeys: [...SOURCE_CLINICAL_BASE_KEYS, ...SCORE_SIGNAL_KEYS.map((key) => `shuffled_${key}`)],
    role: "negative_control",
  },
};

export async function runR1078NsrrSleepAutonomicLocalLoop(
  options: R1078NsrrSleepAutonomicLocalLoopOptions = {},
): Promise<{ output: R1078NsrrSleepAutonomicLocalLoopOutput; outputPath: string; r1070ReceiptPath: string }> {
  const analyticCachePath = options.analyticCachePath ?? R1078_DEFAULT_ANALYTIC_CACHE_PATH;
  await requireLocalCache(analyticCachePath);
  const rows = await readAnalyticRows(analyticCachePath);
  assertMinimumAggregateSize(rows);

  const iterations = options.iterations ?? 1500;
  const calibrationIterations = options.calibrationIterations ?? 900;
  const runs: CandidateRunSummary[] = [];

  for (const [candidateId, definition] of Object.entries(CANDIDATES) as Array<[CandidateId, CandidateDefinition]>) {
    const model = selectModel(rows, definition.featureKeys, iterations);
    const calibration = fitCalibrationTransform(rows, model, calibrationIterations);
    runs.push({
      candidateId,
      comparatorId: definition.comparatorId,
      featureCount: definition.featureKeys.length,
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

  const r1070CompatibleReceipt = createR1070Receipt({
    endpoint: options.endpoint ?? "major_cardiovascular_event",
    horizon: options.horizon ?? "source_supported",
    runs,
  });
  const bestCandidate = bestScoreBearingCandidateFromMetrics(r1070CompatibleReceipt.candidateMetrics);
  const ready = r1070CompatibleReceipt.candidateMetrics.some((metric) =>
    metric.role === "score_bearing_research_candidate"
    && metric.brierDelta !== null
    && metric.brierDelta < 0
    && metric.logLossDelta !== null
    && metric.logLossDelta < 0
    && metric.calibrationSlope !== null
    && metric.calibrationSlope >= 0.9
    && metric.calibrationSlope <= 1.1
    && metric.eOverO !== null
    && metric.eOverO >= 0.95
    && metric.eOverO <= 1.05
    && metric.negativeControlStatus === "beaten"
  );
  const output: R1078NsrrSleepAutonomicLocalLoopOutput = {
    artifactBoundary: safeBoundary(),
    benchmarkCardId: "nsrr_sleep_autonomic_local_aggregate_v1",
    candidateRuns: runs,
    createdAt: options.createdAt ?? new Date().toISOString(),
    endpoint: r1070CompatibleReceipt.endpoint,
    evidenceLabel: "local_data_holder_nsrr_sleep_autonomic_research_only",
    horizon: r1070CompatibleReceipt.horizon,
    packetId: "r1078-nsrr-sleep-autonomic-local-loop",
    productDisplayAuthorized: false,
    r1070CompatibleReceipt,
    receiptArtifact: R1070_RECEIPT_FILE_NAME,
    schemaVersion: R1078_NSRR_SLEEP_AUTONOMIC_LOCAL_LOOP_SCHEMA_VERSION,
    splitShape: splitShape(rows),
    standardAnalyticCacheContract: {
      cacheRoot: ".runtime/cache/murph-age/nsrr-sleep-autonomic/derived/analytic",
      localOnly: true,
      requiredGenericColumnFamilies: [
        "split_assignment",
        "endpoint_indicator",
        "age_and_sex",
        "optional_weight",
        "eligibility_flag",
      ],
      sourceSpecificColumnMapStoredInGit: false,
    },
    status: "research-local-aggregate-only",
    summary: {
      bestScoreBearingCandidate: bestCandidate,
      conclusion: ready
        ? "nsrr_sleep_autonomic_delta_ready_for_r1070"
        : "nsrr_sleep_autonomic_hold_for_more_data_or_controls",
      productDisplayAuthorized: false,
      rowValuesStored: false,
      reviewGptRequiredNow: false,
    },
  };

  assertR1078Safe(output);
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  const r1070ReceiptPath = path.join(outputDir, R1070_RECEIPT_FILE_NAME);
  await Promise.all([
    writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`),
    writeFile(r1070ReceiptPath, `${JSON.stringify(r1070CompatibleReceipt, null, 2)}\n`),
  ]);
  return { output, outputPath, r1070ReceiptPath };
}

export function assertR1078Safe(output: R1078NsrrSleepAutonomicLocalLoopOutput): void {
  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findR1078SpecificFindings(output),
  ];
  if (findings.length > 0) {
    throw new Error(`R1078 NSRR sleep/autonomic local loop failed safety validation: ${findings.join("; ")}`);
  }
}

async function requireLocalCache(filePath: string): Promise<void> {
  try {
    await access(filePath);
  } catch {
    throw new Error("R1078 requires the local ignored NSRR standardized analytic cache before scoring.");
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
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    const raw = Object.fromEntries(header.map((column, index) => [column, String(cells[index] ?? "").trim()]));
    if (raw.eligible_endpoint && raw.eligible_endpoint !== "1") continue;
    const split = parseSplit(raw.split);
    const outcome = parseBinary(raw.primary_event);
    const age = parseNumber(raw.age_years);
    if (!split || outcome === null || age === null || age < 18) continue;
    rows.push({
      index: rows.length,
      split,
      values: buildValues(raw),
      weight: parsePositiveNumber(raw.analysis_weight) ?? 1,
      y: outcome,
    });
  }
  if (rows.length === 0) {
    throw new Error("R1078 local NSRR analytic cache produced no eligible aggregate rows.");
  }
  attachShuffledValues(rows);
  return rows;
}

function buildValues(raw: Record<string, string>): Record<string, number | null> {
  return {
    age: parseNumber(raw.age_years),
    apnea_hypopnea_index: parseNumber(raw.apnea_hypopnea_index),
    active_minutes: parseNumber(raw.active_minutes),
    body_mass_index: parseNumber(raw.body_mass_index),
    clinical_context_score: parseNumber(raw.clinical_context_score),
    diastolic_blood_pressure: parseNumber(raw.diastolic_blood_pressure),
    heart_rate_variability: parseNumber(raw.heart_rate_variability),
    male: sexValue(raw.sex_stratum),
    mean_daily_activity: logPositive(raw.mean_daily_activity),
    mean_spo2: parseNumber(raw.mean_spo2),
    min_spo2: parseNumber(raw.min_spo2),
    recording_minutes: parseNumber(raw.recording_minutes),
    resting_heart_rate: parseNumber(raw.resting_heart_rate),
    sedentary_minutes: parseNumber(raw.sedentary_minutes),
    sleep_duration_hours: parseNumber(raw.sleep_duration_hours),
    sleep_efficiency: parseNumber(raw.sleep_efficiency),
    sleep_midpoint_variability: parseNumber(raw.sleep_midpoint_variability),
    sleep_regularity_index: parseNumber(raw.sleep_regularity_index),
    sleep_wake_transition_count: parseNumber(raw.sleep_wake_transition_count),
    systolic_blood_pressure: parseNumber(raw.systolic_blood_pressure),
    valid_night_count: parseNumber(raw.valid_night_count),
    wear_time_minutes: parseNumber(raw.wear_time_minutes),
  };
}

function attachShuffledValues(rows: ParsedRow[]): void {
  const sourceRows = [...rows];
  for (const row of rows) {
    const source = sourceRows[(row.index * 1103515245 + 12345) % sourceRows.length]!;
    for (const key of SCORE_SIGNAL_KEYS) {
      row.values[`shuffled_${key}`] = source.values[key] ?? null;
    }
  }
}

function assertMinimumAggregateSize(rows: readonly ParsedRow[]): void {
  const eventCount = rows.reduce((sum, row) => sum + row.y, 0);
  if (rows.length < 100 || eventCount < 10) {
    throw new Error("R1078 requires at least 100 eligible rows and 10 events before emitting aggregate metrics.");
  }
  for (const split of ["calibration", "test", "train"] as const) {
    const subset = rows.filter((row) => row.split === split);
    const splitEventCount = subset.reduce((sum, row) => sum + row.y, 0);
    if (subset.length < 10 || splitEventCount < 10) {
      throw new Error("R1078 requires every split to clear the minimum cell threshold before emitting aggregate metrics.");
    }
  }
  const testRows = rows.filter((row) => row.split === "test");
  if (testRows.length < 100) {
    throw new Error("R1078 requires at least 100 test rows before emitting an R1070-compatible receipt.");
  }
}

function selectModel(rows: readonly ParsedRow[], featureKeys: string[], iterations: number): TrainedModel {
  const candidates = LAMBDAS.map((lambda) => {
    const model = trainLogistic(rows, featureKeys, lambda, iterations);
    return {
      calibrationLogLoss: aggregateMetrics(rows, model, { intercept: 0, slope: 1 }, "calibration").logLoss
        ?? Number.POSITIVE_INFINITY,
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
  const { vectorForRow } = prepareFeatureMatrix(rows, featureKeys);
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
    predict: (row) => sigmoid(dot(weights, vectorForRow(row))),
    score: (row) => dot(weights, vectorForRow(row)),
  };
}

function prepareFeatureMatrix(rows: readonly ParsedRow[], featureKeys: readonly string[]) {
  const trainRows = rows.filter((row) => row.split === "train");
  const stats: Record<string, { median: number; mean: number; sd: number }> = {};
  for (const featureKey of featureKeys) {
    const observedTrainValues = trainRows
      .map((row) => row.values[featureKey])
      .filter(isFiniteNumber);
    const medianValue = median(observedTrainValues);
    const imputedTrainValues = trainRows.map((row) => row.values[featureKey] ?? medianValue);
    stats[featureKey] = {
      mean: mean(imputedTrainValues),
      median: medianValue,
      sd: standardDeviation(imputedTrainValues),
    };
  }
  return {
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

function createR1070Receipt(input: {
  endpoint: Endpoint;
  horizon: Horizon;
  runs: readonly CandidateRunSummary[];
}): R1070NsrrSleepAutonomicAggregateReceiptInput {
  const candidateMetrics = input.runs
    .filter((run) => run.comparatorId !== null)
    .map((run) => r1070MetricForRun(run, input.runs));
  return {
    artifactBoundary: safeBoundary(),
    candidateMetrics,
    denominatorCountBand: r1070CountBand(input.runs[0]?.splitMetrics.test.nBand),
    endpoint: input.endpoint,
    eventCountBand: r1070EventCountBand(input.runs[0]?.splitMetrics.test.eventCountBand),
    evidenceClass: "local_data_holder_aggregate",
    evaluatorId: "nsrr_sleep_autonomic_aggregate_evaluator_v1",
    featureSchemaVersion: "murph-age-nsrr-sleep-autonomic-feature-schema.v1",
    horizon: input.horizon,
    packetId: "r1078-nsrr-sleep-autonomic-local-loop",
    receiptAttestations: {
      aggregateOnly: true,
      endpointFrozenBeforeScoring: true,
      evaluatorFrozenBeforeExecution: true,
      measurementMethodCoverageReported: true,
      noCoefficientEgress: true,
      noParticipantEgress: true,
      noPredictionEgress: true,
      noRowEgress: true,
      noSmallCellEgress: true,
      sameDenominatorComparisons: true,
      validSleepAutonomicCoverageReported: true,
    },
    schemaVersion: "murph-age-nsrr-sleep-autonomic-aggregate-receipt.v1",
  };
}

function r1070MetricForRun(
  run: CandidateRunSummary,
  runs: readonly CandidateRunSummary[],
): NsrrCandidateMetric {
  const comparator = runs.find((candidateRun) => candidateRun.candidateId === run.comparatorId);
  if (!comparator) {
    throw new Error(`R1078 candidate ${run.candidateId} requires comparator ${run.comparatorId}.`);
  }
  return {
    aucDelta: delta(run.splitMetrics.test.auc, comparator.splitMetrics.test.auc),
    brierDelta: delta(run.splitMetrics.test.brier, comparator.splitMetrics.test.brier),
    calibrationSlope: run.testCalibration.slope,
    candidateId: run.candidateId,
    comparatorId: comparator.candidateId,
    eOverO: run.testCalibration.eOverO,
    logLossDelta: delta(run.splitMetrics.test.logLoss, comparator.splitMetrics.test.logLoss),
    measurementMethodCalibrationStatus: calibrationGateStatus(run.testCalibration),
    negativeControlStatus: negativeControlStatus(run, runs),
    role: run.role,
    subgroupCalibrationStatus: "not_reportable",
  };
}

function calibrationGateStatus(
  calibration: CandidateRunSummary["testCalibration"],
): NsrrCandidateMetric["measurementMethodCalibrationStatus"] {
  return calibration.slope !== null
    && calibration.slope >= 0.9
    && calibration.slope <= 1.1
    && calibration.eOverO !== null
    && calibration.eOverO >= 0.95
    && calibration.eOverO <= 1.05
    ? "stable"
    : "unstable";
}

function negativeControlStatus(
  run: CandidateRunSummary,
  runs: readonly CandidateRunSummary[],
): NsrrCandidateMetric["negativeControlStatus"] {
  if (run.role !== "score_bearing_research_candidate") return "not_applicable";
  const controls = runs.filter((candidateRun) => candidateRun.role === "negative_control").map((control) =>
    deltaPair(control, runs)
  );
  const candidate = deltaPair(run, runs);
  if (!controls.length || candidate.brierDelta === null || candidate.logLossDelta === null) return "not_beaten";
  return controls.every((control) =>
      control.brierDelta !== null
      && control.logLossDelta !== null
      && candidate.brierDelta! < control.brierDelta
      && candidate.logLossDelta! < control.logLossDelta
    )
    ? "beaten"
    : "not_beaten";
}

function deltaPair(run: CandidateRunSummary, runs: readonly CandidateRunSummary[]): {
  brierDelta: number | null;
  logLossDelta: number | null;
} {
  const comparator = runs.find((candidateRun) => candidateRun.candidateId === run.comparatorId);
  return {
    brierDelta: comparator ? delta(run.splitMetrics.test.brier, comparator.splitMetrics.test.brier) : null,
    logLossDelta: comparator ? delta(run.splitMetrics.test.logLoss, comparator.splitMetrics.test.logLoss) : null,
  };
}

function bestScoreBearingCandidateFromMetrics(
  metrics: readonly NsrrCandidateMetric[],
): R1078NsrrSleepAutonomicLocalLoopOutput["summary"]["bestScoreBearingCandidate"] {
  const scoreBearing = metrics
    .filter((metric) => metric.role === "score_bearing_research_candidate")
    .sort((left, right) => (left.logLossDelta ?? Number.POSITIVE_INFINITY) - (right.logLossDelta ?? Number.POSITIVE_INFINITY));
  const best = scoreBearing[0];
  return best
    ? {
        brierDelta: best.brierDelta,
        candidateId: best.candidateId,
        logLossDelta: best.logLossDelta,
        negativeControlStatus: best.negativeControlStatus,
      }
    : null;
}

function splitShape(rows: readonly ParsedRow[]): R1078NsrrSleepAutonomicLocalLoopOutput["splitShape"] {
  return Object.fromEntries((["calibration", "test", "train"] as const).map((split) => {
    const subset = rows.filter((row) => row.split === split);
    return [split, {
      eventCountBand: countBand(subset.reduce((sum, row) => sum + row.y, 0)),
      nBand: countBand(subset.length),
    }];
  })) as R1078NsrrSleepAutonomicLocalLoopOutput["splitShape"];
}

function safeBoundary(): R1078NsrrSleepAutonomicLocalLoopOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localFileNamesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1078: true,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
    standardizedColumnNamesStored: false,
  };
}

function findR1078SpecificFindings(output: R1078NsrrSleepAutonomicLocalLoopOutput): string[] {
  const findings: string[] = [];
  if (output.productDisplayAuthorized !== false || output.summary.productDisplayAuthorized !== false) {
    findings.push("product display must remain locked");
  }
  if (output.summary.rowValuesStored !== false) findings.push("row values must not be stored");
  const serialized = JSON.stringify(output);
  for (const forbidden of [
    "nsrrid",
    "subject_id",
    "source_column",
    "sourceCodebook",
    "primary_event",
    "analysis_weight",
  ]) {
    if (serialized.includes(forbidden)) findings.push(`forbidden row/source egress ${forbidden}`);
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

function delta(candidate: number | null, comparator: number | null): number | null {
  return candidate === null || comparator === null ? null : roundOrNull(candidate - comparator);
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
  if (count < 10000) return "1000-9999";
  return "10000+";
}

function r1070CountBand(band: string | undefined): R1070NsrrSleepAutonomicAggregateReceiptInput["denominatorCountBand"] {
  if (band === "10000+") return "10000+";
  if (band === "1000-9999") return "1000-9999";
  return "100-999";
}

function r1070EventCountBand(band: string | undefined): R1070NsrrSleepAutonomicAggregateReceiptInput["eventCountBand"] {
  if (band === "1000+" || band === "1000-9999" || band === "10000+") return "1000+";
  if (band === "100-999") return "100-999";
  return "10-99";
}

function roundOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(8)) : null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR1078NsrrSleepAutonomicLocalLoop({
    analyticCachePath: process.env.MURPH_AGE_NSRR_SLEEP_AUTONOMIC_ANALYTIC_CACHE_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  }).then(({ output }) => {
    process.stdout.write(`${JSON.stringify({
      bestScoreBearingCandidate: output.summary.bestScoreBearingCandidate,
      conclusion: output.summary.conclusion,
      packetId: output.packetId,
      productDisplayAuthorized: output.summary.productDisplayAuthorized,
      receiptArtifact: output.receiptArtifact,
      reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
      rowValuesStored: output.summary.rowValuesStored,
      schemaVersion: output.schemaVersion,
      status: output.status,
    }, null, 2)}\n`);
  }).catch((error: unknown) => {
    console.error(safeCliErrorMessage(error, "R1078 NSRR sleep/autonomic local loop failed."));
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
