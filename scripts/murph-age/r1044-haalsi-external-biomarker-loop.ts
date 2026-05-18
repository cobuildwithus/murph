import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

import { calculateAuc, findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1044_HAALSI_EXTERNAL_BIOMARKER_SCHEMA_VERSION =
  "murph-age-r1044-haalsi-external-biomarker-loop.v1" as const;

const HAALSI_ZIP = "ICPSR_36633-V4.zip";
const HAALSI_DATA_ENTRY = "ICPSR_36633/DS0001/36633-0001-Data.tsv";
const DEFAULT_OUTPUT_DIR = path.join(".runtime", "operations", "research", "murph-age", "model-runs");
const MINIMUM_CELL_THRESHOLD = 10;
const EPS = 1e-6;
const LAMBDAS = [0, 0.0001, 0.001, 0.01, 0.1, 1] as const;

const FEATURE_COLUMNS = {
  age: "W1C_RAGE_CALC",
  bmi: "W1C_BS_BMI",
  glucose: "W1C_BS_GLUCOSE",
  hdl: "W1C_BS_HDL",
  hemoglobin: "W1C_BS_HEMOGLOBIN",
  ldl: "W1C_BS_LDL",
  pulse: "W1C_BS_MEAN_PULSE",
  sex: "W2C_RSEX",
  status: "W3STATUS",
  totalCholesterol: "W1C_BS_CHOL",
  triglycerides: "W1C_BS_TRIG",
  walkDifficulty: "W1C_PF_DIFF_WALK",
} as const;

const MODEL_CANDIDATES = {
  A0_age_sex: {
    candidateRole: "reference",
    featureKeys: ["age", "male"],
    rationale: "Age and sex reference.",
  },
  A1_glucose: {
    candidateRole: "score_bearing_candidate",
    featureKeys: ["age", "male", "glucose"],
    rationale: "Smallest HAALSI glycemia increment using point-of-care glucose.",
  },
  A2_glucose_body: {
    candidateRole: "score_bearing_candidate",
    featureKeys: ["age", "male", "glucose", "bmi"],
    rationale: "Glycemia plus body/adiposity increment.",
  },
  A3_glucose_body_hemoglobin: {
    candidateRole: "shadow_candidate",
    featureKeys: ["age", "male", "glucose", "bmi", "hemoglobin"],
    rationale: "Adds hemoglobin as a broad health/biomarker stress check.",
  },
  B1_glucose_lipid_body_no_crp: {
    candidateRole: "complexity_comparator",
    featureKeys: ["age", "male", "glucose", "bmi", "log-triglycerides", "hdl-c", "ldl-c"],
    rationale: "Compact glucose/lipid/body no-CRP comparator.",
  },
  B2_glucose_lipid_body_pulse_no_crp: {
    candidateRole: "shadow_candidate",
    featureKeys: ["age", "male", "glucose", "bmi", "log-triglycerides", "hdl-c", "ldl-c", "pulse"],
    rationale: "Adds pulse as a wearable-adjacent physiology probe, not consumer wearable validation.",
  },
  P1_pulse_only: {
    candidateRole: "pulse_shadow",
    featureKeys: ["age", "male", "pulse"],
    rationale: "Smallest pulse physiology increment; wearable-adjacent only, not consumer wearable validation.",
  },
  P2_glucose_pulse: {
    candidateRole: "pulse_shadow",
    featureKeys: ["age", "male", "glucose", "pulse"],
    rationale: "Tests whether pulse adds signal beside the smallest glucose increment.",
  },
  P3_glucose_body_pulse: {
    candidateRole: "pulse_shadow",
    featureKeys: ["age", "male", "glucose", "bmi", "pulse"],
    rationale: "Tests whether pulse adds signal beside glucose and body/adiposity.",
  },
  F1_walk_difficulty_shadow: {
    candidateRole: "function_activity_shadow",
    featureKeys: ["age", "male", "walk-difficulty"],
    rationale: "Walking-difficulty shadow as activity/function context, not device validation.",
  },
  F2_glucose_walk_difficulty_shadow: {
    candidateRole: "function_activity_shadow",
    featureKeys: ["age", "male", "glucose", "walk-difficulty"],
    rationale: "Tests whether walking difficulty adds signal beside the smallest glucose increment.",
  },
  I1_glucose_body_pulse_walk_shadow: {
    candidateRole: "integrated_shadow",
    featureKeys: ["age", "male", "glucose", "bmi", "pulse", "walk-difficulty"],
    rationale: "Integrated glucose/body/pulse/walking-function shadow candidate for hypothesis generation only.",
  },
  NC2_body_only_without_glucose: {
    candidateRole: "negative_control",
    featureKeys: ["age", "male", "bmi"],
    rationale: "Body/adiposity without glucose.",
  },
  NC3_lipid_body_without_glucose: {
    candidateRole: "negative_control",
    featureKeys: ["age", "male", "bmi", "log-triglycerides", "hdl-c", "ldl-c"],
    rationale: "Lipid/body comparator without glucose.",
  },
  NC5_noise_feature: {
    candidateRole: "negative_control",
    featureKeys: ["age", "male", "noise"],
    rationale: "Deterministic noise feature.",
  },
  NC6_missingness_quality_only: {
    candidateRole: "negative_control",
    featureKeys: ["age", "male", "glucose-missing", "pulse-missing", "walk-difficulty-missing"],
    rationale: "Missingness/quality proxy control without measured biomarker or physiology values.",
  },
} as const;

const REQUIRED_FALSE_FLAGS = [
  "codebookTextStored",
  "coefficientsStored",
  "localPathsStored",
  "modelParametersStored",
  "participantIdentifiersStored",
  "participantIdentifiersWritten",
  "predictionsStored",
  "productClaimsIncluded",
  "productDisplayAuthorized",
  "productPromotionAuthorized",
  "rowValuesStored",
  "smallCellsStored",
  "sourceBodiesStored",
  "splitMembershipStored",
] as const;

type CandidateId = keyof typeof MODEL_CANDIDATES;
type CandidateRole = typeof MODEL_CANDIDATES[CandidateId]["candidateRole"];
type Split = "calibration" | "test" | "train";
type TsvRow = Record<string, string>;

export interface R1044HaalsiExternalBiomarkerOptions {
  createdAt?: string;
  downloadsDir?: string;
  iterations?: number;
  outputDir?: string;
}

export interface R1044MetricSummary {
  auc: number | null;
  brier: number;
  calibrationIntercept: number | null;
  calibrationSlope: number | null;
  events: number;
  expectedOverObserved: number | null;
  logLoss: number;
  meanPrediction: number;
  n: number;
  observedRate: number;
}

export interface R1044ModelSummary {
  candidateRole: CandidateRole;
  deltasVsAgeSexReference: { brierDelta: number; logLossDelta: number };
  featureKeys: string[];
  featureObservedCounts: Record<string, number>;
  rationale: string;
  selectedLambda: number;
  splitMetrics: Record<Split, R1044MetricSummary>;
  verdict: "beats_age_sex" | "does_not_beat_age_sex" | "reference";
}

export interface R1044HaalsiExternalBiomarkerOutput {
  benchmarkCard: {
    benchmarkCardId: "r1044-haalsi-external-biomarker-card-0";
    blockedFamilies: ["crp", "hs-crp", "restricted-biomarkers", "source-text", "participant-level-export", "product-display"];
    endpoint: "death by HAALSI wave 3 among participants with known wave-3 status";
    evidenceClassLabel: "external non-NHANES biomarker local diagnostic";
    minimumCellThreshold: typeof MINIMUM_CELL_THRESHOLD;
    schemaVersion: "murph-age-benchmark-card.v1";
    wearableClaim: "none; pulse is wearable-adjacent physiology only";
  };
  codebookTextStored: false;
  coefficientsStored: false;
  createdAt: string;
  dataShape: {
    eligibleRows: number;
    events: number;
    excludedUnknownWave3StatusRows: number;
    splitCounts: Record<Split, { events: number; n: number }>;
  };
  decision: {
    conclusion: "haalsi_glucose_biomarker_signal_supported" | "haalsi_broad_biomarker_signal_not_specific" | "haalsi_biomarker_signal_not_supported";
    controlVerdict: "negative_controls_clean" | "negative_controls_compete_with_glucose";
    nextAction: "prepare_aggregate_review_packet" | "keep_glucose_labs_shadow_and_continue_external_source_search";
    physiologyExpansionStatus: "shadow_only";
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    rationale: string;
    reviewGptRequiredBeforeNextLocalRun: false;
  };
  localPathsStored: false;
  modelParametersStored: false;
  modelScoringPerformed: true;
  models: Record<CandidateId, R1044ModelSummary>;
  packetId: "r1044-haalsi-external-biomarker-loop";
  participantIdentifiersStored: false;
  participantIdentifiersWritten: false;
  predictionsStored: false;
  productClaimsIncluded: false;
  productDisplayAuthorized: false;
  productPromotionAuthorized: false;
  rowValuesStored: false;
  schemaVersion: typeof R1044_HAALSI_EXTERNAL_BIOMARKER_SCHEMA_VERSION;
  smallCellsStored: false;
  sourceBodiesStored: false;
  splitMembershipStored: false;
  status: "research-local-aggregate-only";
}

interface BenchmarkRow {
  split: Split;
  values: Record<string, number | null>;
  y: 0 | 1;
}

interface TrainedModel {
  featureKeys: string[];
  lambda: number;
  predict(row: BenchmarkRow): number;
  stats: Record<string, { mean: number; median: number; observedCount: number; sd: number }>;
}

interface RowsResult {
  excludedUnknownWave3StatusRows: number;
  rows: BenchmarkRow[];
}

export async function runR1044HaalsiExternalBiomarkerLoop(
  options: R1044HaalsiExternalBiomarkerOptions = {},
): Promise<{ output: R1044HaalsiExternalBiomarkerOutput; outputPath: string }> {
  const downloadsDir = options.downloadsDir ?? path.join(os.homedir(), "Downloads");
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const rowsResult = await buildRows(downloadsDir);
  assertMinimumCells(rowsResult.rows);
  const iterations = options.iterations ?? 5000;
  const trained = Object.fromEntries(
    (Object.keys(MODEL_CANDIDATES) as CandidateId[]).map((candidateId) => [
      candidateId,
      selectModel(rowsResult.rows, [...MODEL_CANDIDATES[candidateId].featureKeys], iterations),
    ]),
  ) as Record<CandidateId, TrainedModel>;
  const models = summarizeModels(rowsResult.rows, trained);
  const output: R1044HaalsiExternalBiomarkerOutput = {
    benchmarkCard: {
      benchmarkCardId: "r1044-haalsi-external-biomarker-card-0",
      blockedFamilies: ["crp", "hs-crp", "restricted-biomarkers", "source-text", "participant-level-export", "product-display"],
      endpoint: "death by HAALSI wave 3 among participants with known wave-3 status",
      evidenceClassLabel: "external non-NHANES biomarker local diagnostic",
      minimumCellThreshold: MINIMUM_CELL_THRESHOLD,
      schemaVersion: "murph-age-benchmark-card.v1",
      wearableClaim: "none; pulse is wearable-adjacent physiology only",
    },
    codebookTextStored: false,
    coefficientsStored: false,
    createdAt: options.createdAt ?? new Date().toISOString(),
    dataShape: {
      eligibleRows: rowsResult.rows.length,
      events: rowsResult.rows.reduce((sum, row) => sum + row.y, 0),
      excludedUnknownWave3StatusRows: rowsResult.excludedUnknownWave3StatusRows,
      splitCounts: splitCounts(rowsResult.rows),
    },
    decision: summarizeDecision(models),
    localPathsStored: false,
    modelParametersStored: false,
    modelScoringPerformed: true,
    models,
    packetId: "r1044-haalsi-external-biomarker-loop",
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    rowValuesStored: false,
    schemaVersion: R1044_HAALSI_EXTERNAL_BIOMARKER_SCHEMA_VERSION,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
    status: "research-local-aggregate-only",
  };
  assertR1044Safe(output);
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "r1044-haalsi-external-biomarker-loop.latest.json");
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

export function assertR1044Safe(output: R1044HaalsiExternalBiomarkerOutput): void {
  const findings = findForbiddenAggregateEgress(output);
  for (const flag of REQUIRED_FALSE_FLAGS) {
    if (output[flag] !== false) findings.push(`boundary flag ${flag} must be false`);
  }
  for (const [split, counts] of Object.entries(output.dataShape.splitCounts)) {
    const nonEvents = counts.n - counts.events;
    if (counts.events > 0 && counts.events < MINIMUM_CELL_THRESHOLD) findings.push(`small event count emitted for ${split}`);
    if (nonEvents > 0 && nonEvents < MINIMUM_CELL_THRESHOLD) findings.push(`small non-event count emitted for ${split}`);
  }
  if (findings.length > 0) throw new Error(`R1044 HAALSI external biomarker loop failed safety validation: ${findings.join("; ")}`);
}

async function buildRows(downloadsDir: string): Promise<RowsResult> {
  const sourceRows = await readZippedTsvColumns(
    path.join(downloadsDir, HAALSI_ZIP),
    HAALSI_DATA_ENTRY,
    ["PRIM_KEY", ...Object.values(FEATURE_COLUMNS)],
  );
  const rows: BenchmarkRow[] = [];
  let excludedUnknownWave3StatusRows = 0;
  for (const sourceRow of sourceRows) {
    const id = sourceRow.PRIM_KEY;
    if (!id) continue;
    const status = parseWave3Status(sourceRow[FEATURE_COLUMNS.status]);
    if (status === "unknown") {
      excludedUnknownWave3StatusRows += 1;
      continue;
    }
    const triglycerides = parseMetricValue(sourceRow[FEATURE_COLUMNS.triglycerides]);
    const glucose = parseMetricValue(sourceRow[FEATURE_COLUMNS.glucose]);
    const pulse = parseMetricValue(sourceRow[FEATURE_COLUMNS.pulse]);
    const walkDifficulty = parseMetricValue(sourceRow[FEATURE_COLUMNS.walkDifficulty]);
    const values: BenchmarkRow["values"] = {
      age: parseMetricValue(sourceRow[FEATURE_COLUMNS.age]),
      bmi: parseMetricValue(sourceRow[FEATURE_COLUMNS.bmi]),
      glucose,
      "glucose-missing": glucose === null ? 1 : 0,
      "hdl-c": parseMetricValue(sourceRow[FEATURE_COLUMNS.hdl]),
      hemoglobin: parseMetricValue(sourceRow[FEATURE_COLUMNS.hemoglobin]),
      "ldl-c": parseMetricValue(sourceRow[FEATURE_COLUMNS.ldl]),
      "log-triglycerides": triglycerides && triglycerides > 0 ? Math.log(triglycerides) : null,
      male: parseSex(sourceRow[FEATURE_COLUMNS.sex]),
      noise: deterministicNoise(id),
      pulse,
      "pulse-missing": pulse === null ? 1 : 0,
      "total-cholesterol": parseMetricValue(sourceRow[FEATURE_COLUMNS.totalCholesterol]),
      "walk-difficulty": walkDifficulty,
      "walk-difficulty-missing": walkDifficulty === null ? 1 : 0,
    };
    rows.push({
      split: stableSplit(id),
      values,
      y: status === "dead" ? 1 : 0,
    });
  }
  return { excludedUnknownWave3StatusRows, rows };
}

function selectModel(rows: readonly BenchmarkRow[], featureKeys: string[], iterations: number): TrainedModel {
  const candidates = LAMBDAS.map((lambda) => {
    const model = trainLogistic(rows, featureKeys, lambda, iterations);
    return { calibrationLogLoss: aggregateMetrics(rows, model, "calibration").logLoss, model };
  });
  return candidates.sort((a, b) => a.calibrationLogLoss - b.calibrationLogLoss)[0]!.model;
}

function trainLogistic(rows: readonly BenchmarkRow[], featureKeys: string[], lambda: number, iterations: number): TrainedModel {
  const { stats, vectorForRow } = prepareFeatureMatrix(rows, featureKeys);
  const trainRows = rows.filter((row) => row.split === "train");
  const weights = new Array(featureKeys.length + 1).fill(0);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const gradient = new Array(weights.length).fill(0);
    for (const row of trainRows) {
      const vector = vectorForRow(row);
      const prediction = sigmoid(dot(weights, vector));
      for (let index = 0; index < weights.length; index += 1) gradient[index] += (prediction - row.y) * vector[index]!;
    }
    for (let index = 0; index < weights.length; index += 1) {
      gradient[index] /= Math.max(1, trainRows.length);
      if (index > 0) gradient[index] += lambda * weights[index]!;
      weights[index] -= 0.05 * gradient[index]!;
    }
  }
  return {
    featureKeys,
    lambda,
    predict: (row) => sigmoid(dot(weights, vectorForRow(row))),
    stats,
  };
}

function prepareFeatureMatrix(rows: readonly BenchmarkRow[], featureKeys: readonly string[]) {
  const trainRows = rows.filter((row) => row.split === "train");
  const stats: TrainedModel["stats"] = {};
  for (const featureKey of featureKeys) {
    const observedTrainValues = trainRows.map((row) => row.values[featureKey]).filter(isFiniteNumber);
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
    vectorForRow: (row: BenchmarkRow): number[] => [
      1,
      ...featureKeys.map((featureKey) => {
        const stat = stats[featureKey]!;
        return ((row.values[featureKey] ?? stat.median) - stat.mean) / stat.sd;
      }),
    ],
  };
}

function summarizeModels(
  rows: readonly BenchmarkRow[],
  trained: Record<CandidateId, TrainedModel>,
): Record<CandidateId, R1044ModelSummary> {
  const reference = aggregateMetrics(rows, trained.A0_age_sex, "test");
  return Object.fromEntries((Object.keys(MODEL_CANDIDATES) as CandidateId[]).map((candidateId) => {
    const candidate = MODEL_CANDIDATES[candidateId];
    const model = trained[candidateId];
    const testMetrics = aggregateMetrics(rows, model, "test");
    const deltasVsAgeSexReference = {
      brierDelta: roundMetric(testMetrics.brier - reference.brier),
      logLossDelta: roundMetric(testMetrics.logLoss - reference.logLoss),
    };
    return [candidateId, {
      candidateRole: candidate.candidateRole,
      deltasVsAgeSexReference,
      featureKeys: model.featureKeys,
      featureObservedCounts: Object.fromEntries(model.featureKeys.map((key) => [key, model.stats[key]?.observedCount ?? 0])),
      rationale: candidate.rationale,
      selectedLambda: model.lambda,
      splitMetrics: {
        calibration: aggregateMetrics(rows, model, "calibration"),
        test: testMetrics,
        train: aggregateMetrics(rows, model, "train"),
      },
      verdict: candidateId === "A0_age_sex"
        ? "reference"
        : deltasVsAgeSexReference.brierDelta < 0 && deltasVsAgeSexReference.logLossDelta < 0
          ? "beats_age_sex"
          : "does_not_beat_age_sex",
    }];
  })) as Record<CandidateId, R1044ModelSummary>;
}

function summarizeDecision(models: Record<CandidateId, R1044ModelSummary>): R1044HaalsiExternalBiomarkerOutput["decision"] {
  const glucoseWins = ["A1_glucose", "A2_glucose_body"] as const;
  const controlWins = ["NC2_body_only_without_glucose", "NC3_lipid_body_without_glucose", "NC5_noise_feature"] as const;
  const glucoseWinCount = glucoseWins.filter((candidateId) => models[candidateId].verdict === "beats_age_sex").length;
  const controlWinCount = controlWins.filter((candidateId) => models[candidateId].verdict === "beats_age_sex").length;
  const controlVerdict = controlWinCount > 0 ? "negative_controls_compete_with_glucose" : "negative_controls_clean";
  const conclusion = glucoseWinCount > 0 && controlVerdict === "negative_controls_clean"
    ? "haalsi_glucose_biomarker_signal_supported"
    : glucoseWinCount > 0
      ? "haalsi_broad_biomarker_signal_not_specific"
      : "haalsi_biomarker_signal_not_supported";
  return {
    conclusion,
    controlVerdict,
    nextAction: conclusion === "haalsi_glucose_biomarker_signal_supported"
      ? "prepare_aggregate_review_packet"
      : "keep_glucose_labs_shadow_and_continue_external_source_search",
    physiologyExpansionStatus: "shadow_only",
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    rationale: conclusion === "haalsi_glucose_biomarker_signal_supported"
      ? "HAALSI glucose candidates improve proper scores over age/sex while negative controls do not compete."
      : conclusion === "haalsi_broad_biomarker_signal_not_specific"
        ? "HAALSI biomarker candidates improve, but non-glucose controls also improve, so the signal is not glucose-specific."
        : "HAALSI glucose candidates do not improve proper scores over age/sex on the locked test split.",
    reviewGptRequiredBeforeNextLocalRun: false,
  };
}

function aggregateMetrics(rows: readonly BenchmarkRow[], model: { predict(row: BenchmarkRow): number }, split: Split): R1044MetricSummary {
  const subset = rows.filter((row) => row.split === split);
  const labels = subset.map((row) => row.y);
  const predictions = subset.map((row) => model.predict(row));
  const observedRate = mean(labels);
  const calibration = labels.some((label) => label === 1) && labels.some((label) => label === 0)
    ? fitCalibration(labels, predictions.map(safeLogit))
    : null;
  return {
    auc: calculateAuc(labels, predictions),
    brier: roundMetric(mean(labels.map((label, index) => (predictions[index]! - label) ** 2))),
    calibrationIntercept: calibration ? roundMetric(calibration.intercept) : null,
    calibrationSlope: calibration ? roundMetric(calibration.slope) : null,
    events: labels.reduce<number>((sum, label) => sum + label, 0),
    expectedOverObserved: observedRate > 0 ? roundMetric(mean(predictions) / observedRate) : null,
    logLoss: roundMetric(-mean(labels.map((label, index) =>
      label * Math.log(Math.max(EPS, predictions[index]!))
      + (1 - label) * Math.log(Math.max(EPS, 1 - predictions[index]!))
    ))),
    meanPrediction: roundMetric(mean(predictions)),
    n: subset.length,
    observedRate: roundMetric(observedRate),
  };
}

function fitCalibration(labels: readonly number[], logits: readonly number[]): { intercept: number; slope: number } {
  let intercept = 0;
  let slope = 1;
  for (let iteration = 0; iteration < 1500; iteration += 1) {
    let interceptGradient = 0;
    let slopeGradient = 0;
    for (let index = 0; index < labels.length; index += 1) {
      const error = sigmoid(intercept + slope * logits[index]!) - labels[index]!;
      interceptGradient += error;
      slopeGradient += error * logits[index]!;
    }
    intercept -= 0.05 * interceptGradient / Math.max(1, labels.length);
    slope -= 0.01 * slopeGradient / Math.max(1, labels.length);
  }
  return { intercept, slope };
}

async function readZippedTsvColumns(zipPath: string, entry: string, columns: readonly string[]): Promise<TsvRow[]> {
  const unzip = spawn("unzip", ["-p", zipPath, entry], { stdio: ["ignore", "pipe", "pipe"] });
  const rl = createInterface({ crlfDelay: Infinity, input: unzip.stdout });
  let header: string[] | null = null;
  let indexes: Record<string, number> | null = null;
  const rows: TsvRow[] = [];
  for await (const line of rl) {
    if (!header) {
      header = line.split("\t");
      indexes = Object.fromEntries(columns.map((column) => [column, header!.indexOf(column)]));
      continue;
    }
    const cells = line.split("\t");
    const row: TsvRow = {};
    for (const [column, index] of Object.entries(indexes ?? {})) row[column] = index >= 0 ? String(cells[index] ?? "").trim() : "";
    rows.push(row);
  }
  await new Promise<void>((resolve, reject) => {
    unzip.on("close", (code) => code === 0 ? resolve() : reject(new Error(`unzip exited with ${code}`)));
    unzip.on("error", reject);
  });
  return rows;
}

function assertMinimumCells(rows: readonly BenchmarkRow[]): void {
  for (const [split, counts] of Object.entries(splitCounts(rows))) {
    const nonEvents = counts.n - counts.events;
    if (counts.events < MINIMUM_CELL_THRESHOLD || nonEvents < MINIMUM_CELL_THRESHOLD) {
      throw new Error(`R1044 ${split} failed minimum cell threshold.`);
    }
  }
}

function splitCounts(rows: readonly BenchmarkRow[]): Record<Split, { events: number; n: number }> {
  return Object.fromEntries((["calibration", "test", "train"] as const).map((split) => {
    const splitRows = rows.filter((row) => row.split === split);
    return [split, { events: splitRows.reduce((sum, row) => sum + row.y, 0), n: splitRows.length }];
  })) as Record<Split, { events: number; n: number }>;
}

function stableSplit(id: string): Split {
  const value = Number.parseInt(createHash("sha256").update(`r1044-haalsi:${id}`).digest("hex").slice(0, 12), 16) / 0xffffffffffff;
  if (value < 0.6) return "train";
  if (value < 0.8) return "calibration";
  return "test";
}

function deterministicNoise(id: string): number {
  const value = Number.parseInt(createHash("sha256").update(`r1044-noise:${id}`).digest("hex").slice(0, 12), 16) / 0xffffffffffff;
  return value * 2 - 1;
}

function parseWave3Status(value: string | undefined): "alive" | "dead" | "unknown" {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (parsed === 0) return "dead";
  if (parsed === 1) return "alive";
  return "unknown";
}

function parseSex(value: string | undefined): number | null {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (parsed === 1) return 1;
  if (parsed === 2) return 0;
  return null;
}

function parseMetricValue(value: string | undefined): number | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed >= 999_999) return null;
  return parsed;
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a.reduce((sum, value, index) => sum + value * b[index]!, 0);
}

function sigmoid(value: number): number {
  return value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));
}

function safeLogit(probability: number): number {
  const bounded = Math.min(1 - EPS, Math.max(EPS, probability));
  return Math.log(bounded / (1 - bounded));
}

function mean(values: readonly number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values: readonly number[]): number {
  const sorted = values.filter(isFiniteNumber).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function standardDeviation(values: readonly number[]): number {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2))) || 1;
}

function roundMetric(value: number): number {
  return Number(value.toFixed(8));
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

async function runCli(): Promise<void> {
  const result = await runR1044HaalsiExternalBiomarkerLoop({
    downloadsDir: process.env.MURPH_AGE_DOWNLOADS_DIR,
    iterations: parsePositiveInteger(process.env.MURPH_AGE_R1044_ITERATIONS),
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  });
  const summary = createCliSummary(result.output, path.basename(result.outputPath));
  console.log(JSON.stringify(summary, null, 2));
}

function createCliSummary(
  aggregate: R1044HaalsiExternalBiomarkerOutput,
  artifact: string,
): {
  artifact: string;
  dataShape: R1044HaalsiExternalBiomarkerOutput["dataShape"];
  decision: R1044HaalsiExternalBiomarkerOutput["decision"];
  modelVerdicts: Partial<Record<CandidateId, R1044ModelSummary["verdict"]>>;
  packetId: R1044HaalsiExternalBiomarkerOutput["packetId"];
  productDisplayAuthorized: false;
  rowValuesStored: false;
  status: R1044HaalsiExternalBiomarkerOutput["status"];
} {
  return {
    artifact,
    dataShape: aggregate.dataShape,
    decision: aggregate.decision,
    modelVerdicts: Object.fromEntries(
      Object.entries(aggregate.models).map(([candidateId, model]) => [candidateId, model.verdict]),
    ) as Partial<Record<CandidateId, R1044ModelSummary["verdict"]>>,
    packetId: aggregate.packetId,
    productDisplayAuthorized: aggregate.productDisplayAuthorized,
    rowValuesStored: aggregate.rowValuesStored,
    status: aggregate.status,
  };
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await runCli();
  } catch {
    console.error(JSON.stringify({
      error: "R1044 HAALSI external biomarker loop failed. Check local HAALSI archive availability and aggregate cell thresholds.",
      status: "failed",
    }));
    process.exit(1);
  }
}
