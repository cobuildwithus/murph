import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

import { calculateAuc, findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1043_MIDUS_FAMILY_GLYCEMIA_STABILITY_SCHEMA_VERSION =
  "murph-age-r1043-midus-family-glycemia-stability-loop.v1" as const;

const DEFAULT_OUTPUT_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const MINIMUM_CELL_THRESHOLD = 10;
const EPS = 1e-6;
const FIXED_LOW_EVENT_LAMBDA = 0.1;

const COHORTS = {
  midus2: {
    baselineYearColumn: "B1PIDATE_YR",
    biomarkerEntry: "ICPSR_29282/DS0001/29282-0001-Data.tsv",
    biomarkerZip: "ICPSR_29282-V11.zip",
    columns: {
      age: "B4ZAGE",
      bmi: "B4PBMI",
      hba1c: "B4BHA1C",
      hdl: "B4BHDL",
      sex: "B1PRSEX",
      triglycerides: "B4BTRIGL",
    },
    deathYearColumn: "DOD_Y",
    endpoint: "10-year all-cause mortality, MIDUS 2 complete-window baseline years",
    idColumn: "M2ID",
    mortalityEntry: "ICPSR_37237/DS0001/37237-0001-Data.tsv",
    mortalityZip: "ICPSR_37237-V6.zip",
    surveyEntry: "ICPSR_04652/DS0001/04652-0001-Data.tsv",
    surveyZip: "ICPSR_04652-V8.zip",
  },
  "midus-refresher": {
    baselineYearColumn: "RA1PIDATE_YR",
    biomarkerEntry: "ICPSR_36901/DS0001/36901-0001-Data.tsv",
    biomarkerZip: "ICPSR_36901-V6.zip",
    columns: {
      age: "RA4ZAGE",
      bmi: "RA4PBMI",
      hba1c: "RA4BHA1C",
      hdl: "RA4BHDL",
      sex: "RA1PRSEX",
      triglycerides: "RA4BTRIGL",
    },
    deathYearColumn: "DOD_Y",
    endpoint: "10-year all-cause mortality, MIDUS Refresher complete-window baseline years",
    idColumn: "MRID",
    mortalityEntry: "ICPSR_38024/DS0001/38024-0001-Data.tsv",
    mortalityZip: "ICPSR_38024-V3.zip",
    surveyEntry: "ICPSR_36532/DS0001/36532-0001-Data.tsv",
    surveyZip: "ICPSR_36532-V4.zip",
  },
} as const;

const MODEL_CANDIDATES = {
  A0_age_sex: {
    candidateRole: "reference",
    featureKeys: ["age", "male"],
    rationale: "Age and sex reference.",
  },
  A1_glycemia: {
    candidateRole: "score_bearing_candidate",
    featureKeys: ["age", "male", "hba1c"],
    rationale: "Smallest same-family glycemia increment.",
  },
  A2_glycemia_body: {
    candidateRole: "score_bearing_candidate",
    featureKeys: ["age", "male", "hba1c", "bmi"],
    rationale: "Glycemia plus body/adiposity increment.",
  },
  B1_lab3_lipid_body_no_crp: {
    candidateRole: "complexity_comparator",
    featureKeys: ["age", "male", "bmi", "hba1c", "log-triglycerides", "hdl-c"],
    rationale: "MIDUS-family lab3/lipid/body no-CRP comparator.",
  },
  NC2_body_only_without_glycemia: {
    candidateRole: "negative_control",
    featureKeys: ["age", "male", "bmi"],
    rationale: "Body/adiposity without glycemia.",
  },
  NC3_lipid_body_without_glycemia: {
    candidateRole: "negative_control",
    featureKeys: ["age", "male", "bmi", "log-triglycerides", "hdl-c"],
    rationale: "Lipid/body comparator without glycemia.",
  },
  NC5_noise_feature: {
    candidateRole: "negative_control",
    featureKeys: ["age", "male", "noise"],
    rationale: "Deterministic noise feature.",
  },
} as const;

const REQUIRED_FALSE_FLAGS = [
  "calibrationParametersStored",
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

type CohortId = keyof typeof COHORTS;
type CandidateId = keyof typeof MODEL_CANDIDATES;
type CandidateRole = typeof MODEL_CANDIDATES[CandidateId]["candidateRole"];
type Split = "test" | "train";
type TsvRow = Record<string, string>;
type CalibrationPolicy = "raw_source" | "target_intercept_recalibrated" | "target_intercept_slope_recalibrated" | "target_local_same_family_reference";

export interface R1043MidusFamilyGlycemiaStabilityOptions {
  createdAt?: string;
  downloadsDir?: string;
  iterations?: number;
  outputDir?: string;
}

export interface R1043MetricSummary {
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

export interface R1043ModelSummary {
  candidateRole: CandidateRole;
  featureKeys: string[];
  featureObservedCounts: Record<string, number>;
  rationale: string;
  selectedLambda: number;
  splitMetrics: Record<Split, R1043MetricSummary>;
}

export interface R1043TransportCandidateSummary {
  candidateRole: CandidateRole;
  deltasVsTargetAgeSexReference: Record<CalibrationPolicy, { brierDelta: number; logLossDelta: number }>;
  featureKeys: string[];
  sourceModelSelectedLambda: number;
  targetLocalSelectedLambda: number;
  testMetrics: Record<CalibrationPolicy, R1043MetricSummary>;
  verdict: "beats_age_sex_with_recalibration" | "does_not_beat_age_sex" | "reference";
}

export interface R1043MidusFamilyGlycemiaStabilityOutput {
  benchmarkCard: {
    benchmarkCardId: "r1043-midus-family-glycemia-stability-card-0";
    blockedFamilies: ["crp", "hs-crp", "source-text", "participant-level-export", "product-display"];
    evidenceClassLabel: "same-family biomarker stability diagnostic";
    minimumCellThreshold: typeof MINIMUM_CELL_THRESHOLD;
    schemaVersion: "murph-age-benchmark-card.v1";
  };
  calibrationParametersStored: false;
  codebookTextStored: false;
  coefficientsStored: false;
  createdAt: string;
  dataShape: Record<CohortId, {
    eligibleRows: number;
    endpoint: string;
    events: number;
    splitCounts: Record<Split, { events: number; n: number }>;
  }>;
  decision: {
    conclusion: "same_family_glycemia_stability_confirmed" | "same_family_glycemia_stability_partial" | "same_family_glycemia_stability_not_confirmed";
    controlVerdict: "negative_controls_clean" | "negative_controls_compete_with_glycemia";
    nextAction: "prepare_aggregate_review_packet" | "keep_cardiometabolic_labs_shadow_and_seek_external_biomarker_source";
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    rationale: string;
    reviewGptRequiredBeforeNextLocalRun: false;
  };
  localModels: Record<CohortId, Partial<Record<CandidateId, R1043ModelSummary>>>;
  localPathsStored: false;
  modelParametersStored: false;
  modelScoringPerformed: true;
  packetId: "r1043-midus-family-glycemia-stability-loop";
  participantIdentifiersStored: false;
  participantIdentifiersWritten: false;
  predictionsStored: false;
  productClaimsIncluded: false;
  productDisplayAuthorized: false;
  productPromotionAuthorized: false;
  rowValuesStored: false;
  schemaVersion: typeof R1043_MIDUS_FAMILY_GLYCEMIA_STABILITY_SCHEMA_VERSION;
  smallCellsStored: false;
  sourceBodiesStored: false;
  splitMembershipStored: false;
  status: "research-local-aggregate-only";
  transportViews: Record<"midus2_to_midus_refresher" | "midus_refresher_to_midus2", {
    candidates: Partial<Record<CandidateId, R1043TransportCandidateSummary>>;
    source: CohortId;
    target: CohortId;
    targetAgeSexReferenceTest: R1043MetricSummary;
  }>;
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
  scoreLogit(row: BenchmarkRow): number;
  stats: Record<string, { mean: number; median: number; observedCount: number; sd: number }>;
}

interface ScoreModel {
  predict(row: BenchmarkRow): number;
}

export async function runR1043MidusFamilyGlycemiaStabilityLoop(
  options: R1043MidusFamilyGlycemiaStabilityOptions = {},
): Promise<{ output: R1043MidusFamilyGlycemiaStabilityOutput; outputPath: string }> {
  const downloadsDir = options.downloadsDir ?? path.join(os.homedir(), "Downloads");
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const iterations = options.iterations ?? 5000;
  const rowsByCohort = {
    midus2: await buildRows("midus2", downloadsDir),
    "midus-refresher": await buildRows("midus-refresher", downloadsDir),
  } satisfies Record<CohortId, BenchmarkRow[]>;
  assertSourceCells(rowsByCohort);

  const trainedByCohort = {
    midus2: trainCandidateModels(rowsByCohort.midus2, iterations),
    "midus-refresher": trainCandidateModels(rowsByCohort["midus-refresher"], iterations),
  } satisfies Record<CohortId, Partial<Record<CandidateId, TrainedModel>>>;

  const transportViews = {
    midus2_to_midus_refresher: summarizeTransportView({
      source: "midus2",
      sourceModels: trainedByCohort.midus2,
      target: "midus-refresher",
      targetModels: trainedByCohort["midus-refresher"],
      targetRows: rowsByCohort["midus-refresher"],
    }),
    midus_refresher_to_midus2: summarizeTransportView({
      source: "midus-refresher",
      sourceModels: trainedByCohort["midus-refresher"],
      target: "midus2",
      targetModels: trainedByCohort.midus2,
      targetRows: rowsByCohort.midus2,
    }),
  } satisfies R1043MidusFamilyGlycemiaStabilityOutput["transportViews"];

  const output: R1043MidusFamilyGlycemiaStabilityOutput = {
    benchmarkCard: {
      benchmarkCardId: "r1043-midus-family-glycemia-stability-card-0",
      blockedFamilies: ["crp", "hs-crp", "source-text", "participant-level-export", "product-display"],
      evidenceClassLabel: "same-family biomarker stability diagnostic",
      minimumCellThreshold: MINIMUM_CELL_THRESHOLD,
      schemaVersion: "murph-age-benchmark-card.v1",
    },
    calibrationParametersStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    createdAt: options.createdAt ?? new Date().toISOString(),
    dataShape: {
      midus2: summarizeDataShape(rowsByCohort.midus2, COHORTS.midus2.endpoint),
      "midus-refresher": summarizeDataShape(rowsByCohort["midus-refresher"], COHORTS["midus-refresher"].endpoint),
    },
    decision: summarizeDecision(transportViews),
    localModels: {
      midus2: summarizeLocalModels(rowsByCohort.midus2, trainedByCohort.midus2),
      "midus-refresher": summarizeLocalModels(rowsByCohort["midus-refresher"], trainedByCohort["midus-refresher"]),
    },
    localPathsStored: false,
    modelParametersStored: false,
    modelScoringPerformed: true,
    packetId: "r1043-midus-family-glycemia-stability-loop",
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    rowValuesStored: false,
    schemaVersion: R1043_MIDUS_FAMILY_GLYCEMIA_STABILITY_SCHEMA_VERSION,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
    status: "research-local-aggregate-only",
    transportViews,
  };
  assertR1043Safe(output);
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "r1043-midus-family-glycemia-stability-loop.latest.json");
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

export function assertR1043Safe(output: R1043MidusFamilyGlycemiaStabilityOutput): void {
  const findings = findForbiddenAggregateEgress(output);
  for (const flag of REQUIRED_FALSE_FLAGS) {
    if (output[flag] !== false) findings.push(`boundary flag ${flag} must be false`);
  }
  for (const [cohort, shape] of Object.entries(output.dataShape)) {
    for (const [split, counts] of Object.entries(shape.splitCounts)) {
      const nonEvents = counts.n - counts.events;
      if (counts.events > 0 && counts.events < MINIMUM_CELL_THRESHOLD) findings.push(`small event count emitted for ${cohort}.${split}`);
      if (nonEvents > 0 && nonEvents < MINIMUM_CELL_THRESHOLD) findings.push(`small non-event count emitted for ${cohort}.${split}`);
    }
  }
  if (findings.length > 0) {
    throw new Error(`R1043 MIDUS-family glycemia stability loop failed safety validation: ${findings.join("; ")}`);
  }
}

async function buildRows(cohortId: CohortId, downloadsDir: string): Promise<BenchmarkRow[]> {
  const cohort = COHORTS[cohortId];
  const surveyRows = await readZippedTsvColumns(
    path.join(downloadsDir, cohort.surveyZip),
    cohort.surveyEntry,
    [cohort.idColumn, cohort.baselineYearColumn],
  );
  const biomarkerRows = await readZippedTsvColumns(
    path.join(downloadsDir, cohort.biomarkerZip),
    cohort.biomarkerEntry,
    [cohort.idColumn, cohort.columns.age, cohort.columns.sex, cohort.columns.bmi, cohort.columns.hba1c, cohort.columns.triglycerides, cohort.columns.hdl],
  );
  const mortalityRows = await readZippedTsvColumns(
    path.join(downloadsDir, cohort.mortalityZip),
    cohort.mortalityEntry,
    [cohort.idColumn, cohort.deathYearColumn],
  );
  const surveyById = new Map(surveyRows.filter((row) => row[cohort.idColumn]).map((row) => [row[cohort.idColumn], row]));
  const mortalityById = new Map(mortalityRows.filter((row) => row[cohort.idColumn]).map((row) => [row[cohort.idColumn], row]));
  const rows: BenchmarkRow[] = [];
  for (const biomarkerRow of biomarkerRows) {
    const id = biomarkerRow[cohort.idColumn];
    if (!id) continue;
    const surveyRow = surveyById.get(id);
    if (!surveyRow) continue;
    const baselineYear = parseYear(surveyRow[cohort.baselineYearColumn]);
    if (!baselineYear || baselineYear + 10 > 2023) continue;
    const deathYear = parseYear(mortalityById.get(id)?.[cohort.deathYearColumn]);
    const rawSex = parseMetricValue(biomarkerRow[cohort.columns.sex]);
    const rawTriglycerides = parseMetricValue(biomarkerRow[cohort.columns.triglycerides]);
    const values: Record<string, number | null> = {
      age: parseMetricValue(biomarkerRow[cohort.columns.age]),
      bmi: parseMetricValue(biomarkerRow[cohort.columns.bmi]),
      hba1c: parseMetricValue(biomarkerRow[cohort.columns.hba1c]),
      "hdl-c": parseMetricValue(biomarkerRow[cohort.columns.hdl]),
      "log-triglycerides": rawTriglycerides && rawTriglycerides > 0 ? Math.log(rawTriglycerides) : null,
      male: rawSex === 1 ? 1 : rawSex === 2 ? 0 : null,
      noise: deterministicNoise(cohortId, id),
    };
    rows.push({
      split: stableSplit(cohortId, id),
      values,
      y: deathYear && deathYear - baselineYear > 0 && deathYear - baselineYear <= 10 ? 1 : 0,
    });
  }
  return rows;
}

function trainCandidateModels(rows: readonly BenchmarkRow[], iterations: number): Partial<Record<CandidateId, TrainedModel>> {
  return Object.fromEntries(
    (Object.keys(MODEL_CANDIDATES) as CandidateId[]).map((candidateId) => {
      const candidate = MODEL_CANDIDATES[candidateId];
      return [candidateId, selectModel(rows, [...candidate.featureKeys], iterations)];
    }),
  ) as Partial<Record<CandidateId, TrainedModel>>;
}

function selectModel(rows: readonly BenchmarkRow[], featureKeys: string[], iterations: number): TrainedModel {
  return trainLogistic(rows, featureKeys, FIXED_LOW_EVENT_LAMBDA, iterations);
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
    scoreLogit: (row) => dot(weights, vectorForRow(row)),
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

function summarizeLocalModels(
  rows: readonly BenchmarkRow[],
  trained: Partial<Record<CandidateId, TrainedModel>>,
): Partial<Record<CandidateId, R1043ModelSummary>> {
  return Object.fromEntries(Object.entries(trained).map(([candidateId, model]) => {
    const id = candidateId as CandidateId;
    const candidate = MODEL_CANDIDATES[id];
    return [id, {
      candidateRole: candidate.candidateRole,
      featureKeys: model.featureKeys,
      featureObservedCounts: Object.fromEntries(model.featureKeys.map((key) => [key, model.stats[key]?.observedCount ?? 0])),
      rationale: candidate.rationale,
      selectedLambda: model.lambda,
      splitMetrics: {
        test: aggregateMetrics(rows, model, "test"),
        train: aggregateMetrics(rows, model, "train"),
      },
    }];
  })) as Partial<Record<CandidateId, R1043ModelSummary>>;
}

function summarizeTransportView(input: {
  source: CohortId;
  sourceModels: Partial<Record<CandidateId, TrainedModel>>;
  target: CohortId;
  targetModels: Partial<Record<CandidateId, TrainedModel>>;
  targetRows: readonly BenchmarkRow[];
}): R1043MidusFamilyGlycemiaStabilityOutput["transportViews"]["midus2_to_midus_refresher"] {
  const targetAgeSex = input.targetModels.A0_age_sex;
  if (!targetAgeSex) throw new Error("R1043 requires target age/sex reference.");
  const targetAgeSexReferenceTest = aggregateMetrics(input.targetRows, targetAgeSex, "test");
  const candidates: Partial<Record<CandidateId, R1043TransportCandidateSummary>> = {};
  for (const candidateId of Object.keys(MODEL_CANDIDATES) as CandidateId[]) {
    const sourceModel = input.sourceModels[candidateId];
    const targetLocalModel = input.targetModels[candidateId];
    if (!sourceModel || !targetLocalModel) continue;
    const rawSource: ScoreModel = { predict: (row) => sourceModel.predict(row) };
    const targetIntercept = calibrateSourceOnTarget(sourceModel, input.targetRows, "intercept");
    const targetInterceptSlope = calibrateSourceOnTarget(sourceModel, input.targetRows, "intercept-slope");
    const testMetrics = {
      raw_source: aggregateMetrics(input.targetRows, rawSource, "test"),
      target_intercept_recalibrated: aggregateMetrics(input.targetRows, targetIntercept, "test"),
      target_intercept_slope_recalibrated: aggregateMetrics(input.targetRows, targetInterceptSlope, "test"),
      target_local_same_family_reference: aggregateMetrics(input.targetRows, targetLocalModel, "test"),
    } satisfies Record<CalibrationPolicy, R1043MetricSummary>;
    const deltasVsTargetAgeSexReference = Object.fromEntries(
      Object.entries(testMetrics).map(([policy, metrics]) => [policy, {
        brierDelta: roundMetric(metrics.brier - targetAgeSexReferenceTest.brier),
        logLossDelta: roundMetric(metrics.logLoss - targetAgeSexReferenceTest.logLoss),
      }]),
    ) as Record<CalibrationPolicy, { brierDelta: number; logLossDelta: number }>;
    const bestRecalibrated = bestByLogLoss([
      testMetrics.target_intercept_recalibrated,
      testMetrics.target_intercept_slope_recalibrated,
    ]);
    candidates[candidateId] = {
      candidateRole: MODEL_CANDIDATES[candidateId].candidateRole,
      deltasVsTargetAgeSexReference,
      featureKeys: sourceModel.featureKeys,
      sourceModelSelectedLambda: sourceModel.lambda,
      targetLocalSelectedLambda: targetLocalModel.lambda,
      testMetrics,
      verdict: candidateId === "A0_age_sex"
        ? "reference"
        : bestRecalibrated.brier < targetAgeSexReferenceTest.brier && bestRecalibrated.logLoss < targetAgeSexReferenceTest.logLoss
          ? "beats_age_sex_with_recalibration"
          : "does_not_beat_age_sex",
    };
  }
  return { candidates, source: input.source, target: input.target, targetAgeSexReferenceTest };
}

function calibrateSourceOnTarget(sourceModel: TrainedModel, targetRows: readonly BenchmarkRow[], mode: "intercept" | "intercept-slope"): ScoreModel {
  const calibrationRows = targetRows.filter((row) => row.split === "train");
  const calibration = fitCalibration(
    calibrationRows.map((row) => row.y),
    calibrationRows.map((row) => sourceModel.scoreLogit(row)),
    mode,
  );
  return {
    predict: (row) => sigmoid(calibration.intercept + calibration.slope * sourceModel.scoreLogit(row)),
  };
}

function aggregateMetrics(rows: readonly BenchmarkRow[], model: ScoreModel, split: Split): R1043MetricSummary {
  const subset = rows.filter((row) => row.split === split);
  const labels = subset.map((row) => row.y);
  const predictions = subset.map((row) => model.predict(row));
  const observedRate = mean(labels);
  const calibration = labels.some((label) => label === 1) && labels.some((label) => label === 0)
    ? fitCalibration(labels, predictions.map(safeLogit), "intercept-slope")
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

function fitCalibration(labels: readonly number[], logits: readonly number[], mode: "intercept" | "intercept-slope"): { intercept: number; slope: number } {
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
    if (mode === "intercept-slope") slope -= 0.01 * slopeGradient / Math.max(1, labels.length);
  }
  return { intercept, slope: mode === "intercept" ? 1 : slope };
}

function summarizeDecision(
  views: R1043MidusFamilyGlycemiaStabilityOutput["transportViews"],
): R1043MidusFamilyGlycemiaStabilityOutput["decision"] {
  const glycemiaIds: CandidateId[] = ["A1_glycemia", "A2_glycemia_body"];
  const controlIds: CandidateId[] = ["NC2_body_only_without_glycemia", "NC3_lipid_body_without_glycemia", "NC5_noise_feature"];
  const glycemiaWins = glycemiaIds.flatMap((id) => [
    views.midus2_to_midus_refresher.candidates[id]?.verdict,
    views.midus_refresher_to_midus2.candidates[id]?.verdict,
  ]).filter((verdict) => verdict === "beats_age_sex_with_recalibration").length;
  const controlWins = controlIds.flatMap((id) => [
    views.midus2_to_midus_refresher.candidates[id]?.verdict,
    views.midus_refresher_to_midus2.candidates[id]?.verdict,
  ]).filter((verdict) => verdict === "beats_age_sex_with_recalibration").length;
  const controlVerdict = controlWins > 0 ? "negative_controls_compete_with_glycemia" : "negative_controls_clean";
  const conclusion = glycemiaWins >= 4 && controlVerdict === "negative_controls_clean"
    ? "same_family_glycemia_stability_confirmed"
    : glycemiaWins > 0 && controlVerdict === "negative_controls_clean"
      ? "same_family_glycemia_stability_partial"
      : "same_family_glycemia_stability_not_confirmed";
  return {
    conclusion,
    controlVerdict,
    nextAction: conclusion === "same_family_glycemia_stability_confirmed"
      ? "prepare_aggregate_review_packet"
      : "keep_cardiometabolic_labs_shadow_and_seek_external_biomarker_source",
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    rationale: conclusion === "same_family_glycemia_stability_confirmed"
      ? "Glycemia candidates beat age/sex in both MIDUS-family directions and negative controls did not compete."
      : controlVerdict === "negative_controls_compete_with_glycemia"
        ? "Glycemia candidates are not specific because negative controls also beat age/sex in at least one MIDUS-family direction."
        : "Glycemia candidates did not consistently beat age/sex in both MIDUS-family directions.",
    reviewGptRequiredBeforeNextLocalRun: false,
  };
}

function summarizeDataShape(rows: readonly BenchmarkRow[], endpoint: string): R1043MidusFamilyGlycemiaStabilityOutput["dataShape"][CohortId] {
  return {
    eligibleRows: rows.length,
    endpoint,
    events: rows.reduce((sum, row) => sum + row.y, 0),
    splitCounts: splitCounts(rows),
  };
}

function assertSourceCells(rowsByCohort: Record<CohortId, BenchmarkRow[]>): void {
  for (const [cohort, rows] of Object.entries(rowsByCohort)) {
    for (const [split, counts] of Object.entries(splitCounts(rows))) {
      const nonEvents = counts.n - counts.events;
      if (counts.events < MINIMUM_CELL_THRESHOLD || nonEvents < MINIMUM_CELL_THRESHOLD) {
        throw new Error(`R1043 ${cohort}.${split} failed minimum cell threshold.`);
      }
    }
  }
}

function splitCounts(rows: readonly BenchmarkRow[]): Record<Split, { events: number; n: number }> {
  return Object.fromEntries((["test", "train"] as const).map((split) => {
    const splitRows = rows.filter((row) => row.split === split);
    return [split, { events: splitRows.reduce((sum, row) => sum + row.y, 0), n: splitRows.length }];
  })) as Record<Split, { events: number; n: number }>;
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

function stableSplit(cohortId: CohortId, id: string): Split {
  const hex = createHash("sha256").update(`r1043-midus-family:${cohortId}:${id}`).digest("hex").slice(0, 12);
  const value = Number.parseInt(hex, 16) / 0xffffffffffff;
  return value < 0.5 ? "train" : "test";
}

function deterministicNoise(cohortId: CohortId, id: string): number {
  const hex = createHash("sha256").update(`r1043-noise:${cohortId}:${id}`).digest("hex").slice(0, 12);
  return Number.parseInt(hex, 16) / 0xffffffffffff * 2 - 1;
}

function parseMetricValue(value: string | undefined): number | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed >= 999_999) return null;
  return parsed;
}

function parseYear(value: string | undefined): number | null {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 1900 && parsed < 2100 ? parsed : null;
}

function bestByLogLoss(metrics: readonly R1043MetricSummary[]): R1043MetricSummary {
  return [...metrics].sort((a, b) => a.logLoss - b.logLoss)[0]!;
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
  const result = await runR1043MidusFamilyGlycemiaStabilityLoop({
    downloadsDir: process.env.MURPH_AGE_DOWNLOADS_DIR,
    iterations: parsePositiveInteger(process.env.MURPH_AGE_R1043_ITERATIONS),
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  });
  const summary = createCliSummary(result.output, path.basename(result.outputPath));
  console.log(JSON.stringify(summary, null, 2));
}

function createCliSummary(
  aggregate: R1043MidusFamilyGlycemiaStabilityOutput,
  artifact: string,
): {
  artifact: string;
  dataShape: R1043MidusFamilyGlycemiaStabilityOutput["dataShape"];
  decision: R1043MidusFamilyGlycemiaStabilityOutput["decision"];
  packetId: R1043MidusFamilyGlycemiaStabilityOutput["packetId"];
  productDisplayAuthorized: false;
  rowValuesStored: false;
  status: R1043MidusFamilyGlycemiaStabilityOutput["status"];
  transportVerdicts: Record<keyof R1043MidusFamilyGlycemiaStabilityOutput["transportViews"], Partial<Record<CandidateId, R1043TransportCandidateSummary["verdict"]>>>;
} {
  return {
    artifact,
    dataShape: aggregate.dataShape,
    decision: aggregate.decision,
    packetId: aggregate.packetId,
    productDisplayAuthorized: aggregate.productDisplayAuthorized,
    rowValuesStored: aggregate.rowValuesStored,
    status: aggregate.status,
    transportVerdicts: {
      midus2_to_midus_refresher: verdictSummary(aggregate.transportViews.midus2_to_midus_refresher.candidates),
      midus_refresher_to_midus2: verdictSummary(aggregate.transportViews.midus_refresher_to_midus2.candidates),
    },
  };
}

function verdictSummary(
  candidates: Partial<Record<CandidateId, R1043TransportCandidateSummary>>,
): Partial<Record<CandidateId, R1043TransportCandidateSummary["verdict"]>> {
  return Object.fromEntries(
    Object.entries(candidates).map(([candidateId, candidate]) => [candidateId, candidate?.verdict]),
  ) as Partial<Record<CandidateId, R1043TransportCandidateSummary["verdict"]>>;
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
      error: "R1043 MIDUS-family glycemia stability loop failed. Check local MIDUS dataset availability and aggregate cell thresholds.",
      status: "failed",
    }));
    process.exit(1);
  }
}
