import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

import { calculateAuc, findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1041_MINIMAL_GLYCEMIA_TRANSPORT_SCHEMA_VERSION =
  "murph-age-r1041-minimal-glycemia-transport-loop.v1" as const;

const MIDUS2_SURVEY_ZIP = "ICPSR_04652-V8.zip";
const MIDUS2_BIOMARKER_ZIP = "ICPSR_29282-V11.zip";
const MIDUS2_MORTALITY_ZIP = "ICPSR_37237-V6.zip";

const MIDUS2_SURVEY_ENTRY = "ICPSR_04652/DS0001/04652-0001-Data.tsv";
const MIDUS2_BIOMARKER_ENTRY = "ICPSR_29282/DS0001/29282-0001-Data.tsv";
const MIDUS2_MORTALITY_ENTRY = "ICPSR_37237/DS0001/37237-0001-Data.tsv";

const CRELES_WAVE1_ZIP = "ICPSR_26681-V3.zip";
const CRELES_WAVE3_ZIP = "ICPSR_35250-V2.zip";

const CRELES_WAVE1_RECODED_ENTRY = "ICPSR_26681/DS0010/26681-0010-Data.tsv";
const CRELES_WAVE1_BIOMARKER_ENTRY = "ICPSR_26681/DS0002/26681-0002-Data.tsv";
const CRELES_WAVE3_FOLLOWUP_ENTRY = "ICPSR_35250/DS0013/35250-0013-Data.tsv";

const DEFAULT_OUTPUT_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const MINIMUM_CELL_THRESHOLD = 10;
const EPS = 1e-6;
const LAMBDAS = [0, 0.0001, 0.001, 0.01, 0.1, 1] as const;

const REQUIRED_FALSE_BOUNDARY_FLAGS = [
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

const MIDUS2_FEATURE_DEFINITIONS = [
  { column: "B4ZAGE", key: "age", transform: (value: number) => value },
  { column: "B1PRSEX", key: "male", transform: (value: number) => value === 1 ? 1 : value === 2 ? 0 : null },
  { column: "B4PBMI", key: "bmi", transform: (value: number) => value },
  { column: "B4BHA1C", key: "hba1c", transform: (value: number) => value },
  { column: "B4BTRIGL", key: "log-triglycerides", transform: (value: number) => value > 0 ? Math.log(value) : null },
  { column: "B4BHDL", key: "hdl-c", transform: (value: number) => value },
] as const;

const CRELES_FEATURE_DEFINITIONS = [
  { column: "AGE", key: "age", source: "recoded", transform: (value: number) => value },
  { column: "SEX", key: "male", source: "recoded", transform: (value: number) => value === 1 ? 1 : value === 2 ? 0 : null },
  { column: "IMC", key: "bmi", source: "biomarker", transform: (value: number) => value },
  { column: "HBAC1", key: "hba1c", source: "biomarker", transform: (value: number) => value },
  { column: "TGS", key: "log-triglycerides", source: "biomarker", transform: (value: number) => value > 0 ? Math.log(value) : null },
  { column: "HDL", key: "hdl-c", source: "biomarker", transform: (value: number) => value },
  { column: "SISTOLICA", key: "systolic-blood-pressure", source: "biomarker", transform: (value: number) => value },
  { column: "DIASTOLICA", key: "diastolic-blood-pressure", source: "biomarker", transform: (value: number) => value },
] as const;

const MODEL_CANDIDATES = {
  A0_age_sex: {
    candidateRole: "reference",
    featureKeys: ["age", "male"],
    ladderRank: 0,
    rationale: "Age and sex reference.",
  },
  A1_glycemia: {
    candidateRole: "score_bearing_candidate",
    featureKeys: ["age", "male", "hba1c"],
    ladderRank: 1,
    rationale: "Smallest common glycemia increment that can transport across MIDUS and CRELES.",
  },
  A2_glycemia_body: {
    candidateRole: "score_bearing_candidate",
    featureKeys: ["age", "male", "hba1c", "bmi"],
    ladderRank: 2,
    rationale: "Glycemia plus body/adiposity increment.",
  },
  A3_glycemia_body_bp: {
    candidateRole: "shadow_unharmonized_candidate",
    featureKeys: ["age", "male", "hba1c", "bmi", "systolic-blood-pressure", "diastolic-blood-pressure"],
    ladderRank: 3,
    rationale: "BP/hypertension extension; local CRELES-only until MIDUS-compatible BP is available.",
  },
  B1_lab5_lipid_body_no_crp: {
    candidateRole: "complexity_comparator",
    featureKeys: ["age", "male", "bmi", "hba1c", "log-triglycerides", "hdl-c"],
    ladderRank: 4,
    rationale: "Compact lab5 lipid/body comparator to detect complexity overfit.",
  },
  NC2_body_only_without_glycemia: {
    candidateRole: "negative_control",
    featureKeys: ["age", "male", "bmi"],
    ladderRank: 90,
    rationale: "Body/adiposity without glycemia.",
  },
  NC3_lipid_body_without_glycemia: {
    candidateRole: "negative_control",
    featureKeys: ["age", "male", "bmi", "log-triglycerides", "hdl-c"],
    ladderRank: 91,
    rationale: "Lipid/body comparator without glycemia.",
  },
  NC5_noise_feature: {
    candidateRole: "negative_control",
    featureKeys: ["age", "male", "noise"],
    ladderRank: 92,
    rationale: "Deterministic noise feature with similar dimensionality to a small increment.",
  },
} as const;

type SourceId = "creles" | "midus2";
type Split = "calibration" | "test" | "train";
type TsvRow = Record<string, string>;
type CandidateId = keyof typeof MODEL_CANDIDATES;
type CandidateRole = typeof MODEL_CANDIDATES[CandidateId]["candidateRole"];
type CalibrationPolicy =
  | "raw_source"
  | "target_intercept_recalibrated"
  | "target_intercept_slope_recalibrated"
  | "target_local_same_family_reference";

export interface R1041MinimalGlycemiaTransportOptions {
  createdAt?: string;
  downloadsDir?: string;
  iterations?: number;
  outputDir?: string;
}

export interface R1041MetricSummary {
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

export interface R1041ModelSummary {
  candidateRole: CandidateRole;
  featureKeys: string[];
  featureObservedCounts: Record<string, number>;
  rationale: string;
  selectedLambda: number;
  splitMetrics: Record<Split, R1041MetricSummary>;
}

export interface R1041TransportCandidateSummary {
  candidateRole: CandidateRole;
  deltasVsTargetAgeSexReference: Record<CalibrationPolicy, {
    brierDelta: number;
    logLossDelta: number;
  }>;
  featureKeys: string[];
  sourceModelSelectedLambda: number;
  targetLocalSelectedLambda: number;
  testMetrics: Record<CalibrationPolicy, R1041MetricSummary>;
  verdict: "beats_age_sex_with_recalibration" | "does_not_beat_age_sex" | "reference";
}

export interface R1041MinimalGlycemiaTransportOutput {
  benchmarkCard: {
    artifactBoundary: {
      aggregateOnly: true;
      codebookTextStored: false;
      coefficientsStored: false;
      localPathsStored: false;
      modelParametersStored: false;
      participantIdentifiersStored: false;
      predictionsStored: false;
      rowValuesStored: false;
      sourceBodiesStored: false;
      splitMembershipStored: false;
    };
    benchmarkCardId: "r1041-minimal-glycemia-transport-card-0";
    blockedFamilies: ["crp", "hs-crp", "source-text", "participant-level-export", "product-display"];
    evidenceClassLabel: "cross-source minimal cardiometabolic transport diagnostic";
    minimumCellThreshold: typeof MINIMUM_CELL_THRESHOLD;
    reviewGptDirection: "R1040 Extended Pro approved tiny nested glycemia ladder and no further ReviewGPT until new aggregate metrics.";
    schemaVersion: "murph-age-benchmark-card.v1";
  };
  calibrationParametersStored: false;
  codebookTextStored: false;
  coefficientsStored: false;
  createdAt: string;
  dataShape: Record<SourceId, {
    eligibleRows: number;
    endpoint: string;
    events: number;
    splitCounts: Record<Split, { events: number; n: number }>;
  }>;
  decision: {
    controlVerdict:
      | "negative_controls_clean"
      | "negative_controls_compete_with_glycemia"
      | "negative_controls_not_applicable";
    conclusion:
      | "minimal_glycemia_transport_confirmed"
      | "minimal_glycemia_transport_partial"
      | "minimal_glycemia_transport_not_confirmed";
    nextAction:
      | "prepare_aggregate_review_packet"
      | "keep_glycemia_shadow_and_seek_external_biomarker_source"
      | "run_partner_or_workbench_integrated_labs_wearables_when_available";
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    rationale: string;
    reviewGptRequiredBeforeNextLocalRun: false;
  };
  featureAvailability: {
    commonTransportFeatureKeys: string[];
    sourceSpecificFeatureKeys: Record<SourceId, string[]>;
    unharmonizedCandidateIds: CandidateId[];
  };
  localModels: Record<SourceId, Partial<Record<CandidateId, R1041ModelSummary>>>;
  localPathsStored: false;
  modelParametersStored: false;
  modelScoringPerformed: true;
  packetId: "r1041-minimal-glycemia-transport-loop";
  participantIdentifiersStored: false;
  participantIdentifiersWritten: false;
  predictionsStored: false;
  productClaimsIncluded: false;
  productDisplayAuthorized: false;
  productPromotionAuthorized: false;
  rowValuesStored: false;
  schemaVersion: typeof R1041_MINIMAL_GLYCEMIA_TRANSPORT_SCHEMA_VERSION;
  smallCellsStored: false;
  sourceBodiesStored: false;
  splitMembershipStored: false;
  status: "research-local-aggregate-only";
  transportViews: Record<"creles_to_midus2" | "midus2_to_creles", {
    candidates: Partial<Record<CandidateId, R1041TransportCandidateSummary>>;
    source: SourceId;
    target: SourceId;
    targetAgeSexReferenceTest: R1041MetricSummary;
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

export async function runR1041MinimalGlycemiaTransportLoop(
  options: R1041MinimalGlycemiaTransportOptions = {},
): Promise<{ output: R1041MinimalGlycemiaTransportOutput; outputPath: string }> {
  const downloadsDir = options.downloadsDir ?? path.join(os.homedir(), "Downloads");
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const iterations = options.iterations ?? 5000;

  const sourceRows: Record<SourceId, BenchmarkRow[]> = {
    creles: await buildCrelesRows(downloadsDir),
    midus2: await buildMidus2Rows(downloadsDir),
  };
  assertSourceCells(sourceRows);

  const localTrainedModels = {
    creles: trainSupportedCandidateModels(sourceRows.creles, iterations),
    midus2: trainSupportedCandidateModels(sourceRows.midus2, iterations),
  } satisfies Record<SourceId, Partial<Record<CandidateId, TrainedModel>>>;

  const localModels = {
    creles: summarizeLocalModels(sourceRows.creles, localTrainedModels.creles),
    midus2: summarizeLocalModels(sourceRows.midus2, localTrainedModels.midus2),
  } satisfies R1041MinimalGlycemiaTransportOutput["localModels"];

  const transportViews = {
    creles_to_midus2: summarizeTransportView({
      source: "creles",
      sourceModels: localTrainedModels.creles,
      sourceRows: sourceRows.creles,
      target: "midus2",
      targetModels: localTrainedModels.midus2,
      targetRows: sourceRows.midus2,
    }),
    midus2_to_creles: summarizeTransportView({
      source: "midus2",
      sourceModels: localTrainedModels.midus2,
      sourceRows: sourceRows.midus2,
      target: "creles",
      targetModels: localTrainedModels.creles,
      targetRows: sourceRows.creles,
    }),
  } satisfies R1041MinimalGlycemiaTransportOutput["transportViews"];

  const output: R1041MinimalGlycemiaTransportOutput = {
    benchmarkCard: {
      artifactBoundary: {
        aggregateOnly: true,
        codebookTextStored: false,
        coefficientsStored: false,
        localPathsStored: false,
        modelParametersStored: false,
        participantIdentifiersStored: false,
        predictionsStored: false,
        rowValuesStored: false,
        sourceBodiesStored: false,
        splitMembershipStored: false,
      },
      benchmarkCardId: "r1041-minimal-glycemia-transport-card-0",
      blockedFamilies: ["crp", "hs-crp", "source-text", "participant-level-export", "product-display"],
      evidenceClassLabel: "cross-source minimal cardiometabolic transport diagnostic",
      minimumCellThreshold: MINIMUM_CELL_THRESHOLD,
      reviewGptDirection:
        "R1040 Extended Pro approved tiny nested glycemia ladder and no further ReviewGPT until new aggregate metrics.",
      schemaVersion: "murph-age-benchmark-card.v1",
    },
    calibrationParametersStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    createdAt: options.createdAt ?? new Date().toISOString(),
    dataShape: {
      creles: summarizeDataShape(
        sourceRows.creles,
        "death by CRELES wave 3 among participants with known wave-3 status",
      ),
      midus2: summarizeDataShape(
        sourceRows.midus2,
        "10-year all-cause mortality, MIDUS 2 complete-window baseline years",
      ),
    },
    decision: summarizeDecision(transportViews),
    featureAvailability: {
      commonTransportFeatureKeys: commonTransportFeatureKeys(sourceRows),
      sourceSpecificFeatureKeys: {
        creles: sourceFeatureKeys(sourceRows.creles),
        midus2: sourceFeatureKeys(sourceRows.midus2),
      },
      unharmonizedCandidateIds: unavailableForBothSources(sourceRows),
    },
    localModels,
    localPathsStored: false,
    modelParametersStored: false,
    modelScoringPerformed: true,
    packetId: "r1041-minimal-glycemia-transport-loop",
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    rowValuesStored: false,
    schemaVersion: R1041_MINIMAL_GLYCEMIA_TRANSPORT_SCHEMA_VERSION,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
    status: "research-local-aggregate-only",
    transportViews,
  };

  assertR1041Safe(output);
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "r1041-minimal-glycemia-transport-loop.latest.json");
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

export function assertR1041Safe(output: R1041MinimalGlycemiaTransportOutput): void {
  const findings = findForbiddenAggregateEgress(output);
  for (const flag of REQUIRED_FALSE_BOUNDARY_FLAGS) {
    if (output[flag] !== false) {
      findings.push(`boundary flag ${flag} must be false`);
    }
  }
  for (const [source, shape] of Object.entries(output.dataShape)) {
    for (const [split, counts] of Object.entries(shape.splitCounts)) {
      const nonEvents = counts.n - counts.events;
      if (counts.events > 0 && counts.events < MINIMUM_CELL_THRESHOLD) {
        findings.push(`small event count emitted for ${source}.${split}`);
      }
      if (nonEvents > 0 && nonEvents < MINIMUM_CELL_THRESHOLD) {
        findings.push(`small non-event count emitted for ${source}.${split}`);
      }
    }
  }
  if (findings.length > 0) {
    throw new Error(`R1041 minimal glycemia transport loop failed safety validation: ${findings.join("; ")}`);
  }
}

async function buildMidus2Rows(downloadsDir: string): Promise<BenchmarkRow[]> {
  const surveyRows = await readZippedTsvColumns(
    path.join(downloadsDir, MIDUS2_SURVEY_ZIP),
    MIDUS2_SURVEY_ENTRY,
    ["M2ID", "B1PIDATE_YR"],
  );
  const biomarkerRows = await readZippedTsvColumns(
    path.join(downloadsDir, MIDUS2_BIOMARKER_ZIP),
    MIDUS2_BIOMARKER_ENTRY,
    ["M2ID", ...MIDUS2_FEATURE_DEFINITIONS.map((definition) => definition.column)],
  );
  const mortalityRows = await readZippedTsvColumns(
    path.join(downloadsDir, MIDUS2_MORTALITY_ZIP),
    MIDUS2_MORTALITY_ENTRY,
    ["M2ID", "DOD_Y"],
  );

  const surveyById = new Map(surveyRows.filter((row) => row.M2ID).map((row) => [row.M2ID, row]));
  const mortalityById = new Map(mortalityRows.filter((row) => row.M2ID).map((row) => [row.M2ID, row]));
  const rows: BenchmarkRow[] = [];
  for (const biomarkerRow of biomarkerRows) {
    const id = biomarkerRow.M2ID;
    if (!id) continue;
    const surveyRow = surveyById.get(id);
    if (!surveyRow) continue;
    const baselineYear = parseYear(surveyRow.B1PIDATE_YR);
    if (!baselineYear || baselineYear + 10 > 2023) continue;
    const deathYear = parseYear(mortalityById.get(id)?.DOD_Y);
    const values: Record<string, number | null> = { noise: deterministicNoise("midus2", id) };
    for (const definition of MIDUS2_FEATURE_DEFINITIONS) {
      const rawValue = parseMetricValue(biomarkerRow[definition.column]);
      values[definition.key] = rawValue === null ? null : definition.transform(rawValue);
    }
    rows.push({
      split: stableSplit("midus2", id),
      values,
      y: deathYear && deathYear - baselineYear > 0 && deathYear - baselineYear <= 10 ? 1 : 0,
    });
  }
  return rows;
}

async function buildCrelesRows(downloadsDir: string): Promise<BenchmarkRow[]> {
  const recodedRows = await readZippedTsvColumns(
    path.join(downloadsDir, CRELES_WAVE1_ZIP),
    CRELES_WAVE1_RECODED_ENTRY,
    ["IDSUJETO", ...columnsForCrelesSource("recoded")],
  );
  const biomarkerRows = await readZippedTsvColumns(
    path.join(downloadsDir, CRELES_WAVE1_ZIP),
    CRELES_WAVE1_BIOMARKER_ENTRY,
    ["IDSUJETO", ...columnsForCrelesSource("biomarker")],
  );
  const followupRows = await readZippedTsvColumns(
    path.join(downloadsDir, CRELES_WAVE3_ZIP),
    CRELES_WAVE3_FOLLOWUP_ENTRY,
    ["IDSUJETO", "TRACK_W3"],
  );

  const recodedById = new Map(recodedRows.filter((row) => row.IDSUJETO).map((row) => [row.IDSUJETO, row]));
  const followupById = new Map(followupRows.filter((row) => row.IDSUJETO).map((row) => [row.IDSUJETO, row]));
  const rows: BenchmarkRow[] = [];
  for (const biomarkerRow of biomarkerRows) {
    const id = biomarkerRow.IDSUJETO;
    if (!id) continue;
    const recodedRow = recodedById.get(id);
    const followupStatus = parseCrelesFollowupStatus(followupById.get(id)?.TRACK_W3);
    if (!recodedRow || followupStatus === "missing" || followupStatus === "lost") continue;
    const values: Record<string, number | null> = { noise: deterministicNoise("creles", id) };
    for (const definition of CRELES_FEATURE_DEFINITIONS) {
      const sourceRow = definition.source === "recoded" ? recodedRow : biomarkerRow;
      const rawValue = parseMetricValue(sourceRow[definition.column]);
      values[definition.key] = rawValue === null ? null : definition.transform(rawValue);
    }
    rows.push({
      split: stableSplit("creles", id),
      values,
      y: followupStatus === "dead" ? 1 : 0,
    });
  }
  return rows;
}

function trainSupportedCandidateModels(
  rows: readonly BenchmarkRow[],
  iterations: number,
): Partial<Record<CandidateId, TrainedModel>> {
  const trained: Partial<Record<CandidateId, TrainedModel>> = {};
  for (const [candidateId, candidate] of Object.entries(MODEL_CANDIDATES) as Array<[CandidateId, typeof MODEL_CANDIDATES[CandidateId]]>) {
    if (!candidateSupported(rows, candidate.featureKeys)) continue;
    trained[candidateId] = selectModel(rows, [...candidate.featureKeys], iterations);
  }
  return trained;
}

function selectModel(rows: readonly BenchmarkRow[], featureKeys: string[], iterations: number): TrainedModel {
  const candidates = LAMBDAS.map((lambda) => {
    const model = trainLogistic(rows, featureKeys, lambda, iterations);
    return {
      calibrationLogLoss: aggregateMetrics(rows, model, "calibration").logLoss,
      model,
    };
  });
  return candidates.sort((a, b) => a.calibrationLogLoss - b.calibrationLogLoss)[0]!.model;
}

function trainLogistic(
  rows: readonly BenchmarkRow[],
  featureKeys: string[],
  lambda: number,
  iterations: number,
): TrainedModel {
  const { stats, vectorForRow } = prepareFeatureMatrix(rows, featureKeys);
  const trainRows = rows.filter((row) => row.split === "train");
  const weights = new Array(featureKeys.length + 1).fill(0);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const gradient = new Array(weights.length).fill(0);
    for (const row of trainRows) {
      const vector = vectorForRow(row);
      const prediction = sigmoid(dot(weights, vector));
      for (let index = 0; index < weights.length; index += 1) {
        gradient[index] += (prediction - row.y) * vector[index]!;
      }
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
): Partial<Record<CandidateId, R1041ModelSummary>> {
  return Object.fromEntries(
    Object.entries(trained).map(([candidateId, model]) => {
      const id = candidateId as CandidateId;
      const candidate = MODEL_CANDIDATES[id];
      return [id, {
        candidateRole: candidate.candidateRole,
        featureKeys: model.featureKeys,
        featureObservedCounts: Object.fromEntries(
          model.featureKeys.map((key) => [key, model.stats[key]?.observedCount ?? 0]),
        ),
        rationale: candidate.rationale,
        selectedLambda: model.lambda,
        splitMetrics: {
          calibration: aggregateMetrics(rows, model, "calibration"),
          test: aggregateMetrics(rows, model, "test"),
          train: aggregateMetrics(rows, model, "train"),
        },
      }];
    }),
  ) as Partial<Record<CandidateId, R1041ModelSummary>>;
}

function summarizeTransportView(input: {
  source: SourceId;
  sourceModels: Partial<Record<CandidateId, TrainedModel>>;
  sourceRows: readonly BenchmarkRow[];
  target: SourceId;
  targetModels: Partial<Record<CandidateId, TrainedModel>>;
  targetRows: readonly BenchmarkRow[];
}): R1041MinimalGlycemiaTransportOutput["transportViews"]["midus2_to_creles"] {
  const targetAgeSexModel = input.targetModels.A0_age_sex;
  if (!targetAgeSexModel) throw new Error("R1041 transport view requires a target age/sex model.");
  const targetAgeSexReferenceTest = aggregateMetrics(input.targetRows, targetAgeSexModel, "test");
  const candidates: Partial<Record<CandidateId, R1041TransportCandidateSummary>> = {};

  for (const candidateId of transportCandidateIds(input.sourceRows, input.targetRows)) {
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
    } satisfies Record<CalibrationPolicy, R1041MetricSummary>;
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
        : bestRecalibrated.brier < targetAgeSexReferenceTest.brier
          && bestRecalibrated.logLoss < targetAgeSexReferenceTest.logLoss
          ? "beats_age_sex_with_recalibration"
          : "does_not_beat_age_sex",
    };
  }

  return {
    candidates,
    source: input.source,
    target: input.target,
    targetAgeSexReferenceTest,
  };
}

function calibrateSourceOnTarget(
  sourceModel: TrainedModel,
  targetRows: readonly BenchmarkRow[],
  mode: "intercept" | "intercept-slope",
): ScoreModel {
  const calibrationRows = targetRows.filter((row) => row.split === "calibration");
  const logits = calibrationRows.map((row) => sourceModel.scoreLogit(row));
  const labels = calibrationRows.map((row) => row.y);
  const calibration = fitCalibration(labels, logits, mode);
  return {
    predict: (row) => sigmoid(calibration.intercept + calibration.slope * sourceModel.scoreLogit(row)),
  };
}

function aggregateMetrics(rows: readonly BenchmarkRow[], model: ScoreModel, split: Split): R1041MetricSummary {
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

function fitCalibration(
  labels: readonly number[],
  logits: readonly number[],
  mode: "intercept" | "intercept-slope",
): { intercept: number; slope: number } {
  let intercept = 0;
  let slope = 1;
  for (let iteration = 0; iteration < 1500; iteration += 1) {
    let interceptGradient = 0;
    let slopeGradient = 0;
    for (let index = 0; index < labels.length; index += 1) {
      const logitValue = logits[index]!;
      const error = sigmoid(intercept + slope * logitValue) - labels[index]!;
      interceptGradient += error;
      slopeGradient += error * logitValue;
    }
    interceptGradient /= Math.max(1, labels.length);
    slopeGradient /= Math.max(1, labels.length);
    intercept -= 0.05 * interceptGradient;
    if (mode === "intercept-slope") slope -= 0.01 * slopeGradient;
  }
  return { intercept, slope: mode === "intercept" ? 1 : slope };
}

function summarizeDecision(
  views: R1041MinimalGlycemiaTransportOutput["transportViews"],
): R1041MinimalGlycemiaTransportOutput["decision"] {
  const glycemiaCandidateIds: CandidateId[] = ["A1_glycemia", "A2_glycemia_body"];
  const negativeControlCandidateIds: CandidateId[] = [
    "NC2_body_only_without_glycemia",
    "NC3_lipid_body_without_glycemia",
    "NC5_noise_feature",
  ];
  const glycemiaVerdicts = glycemiaCandidateIds.flatMap((candidateId) => [
    views.creles_to_midus2.candidates[candidateId]?.verdict,
    views.midus2_to_creles.candidates[candidateId]?.verdict,
  ]);
  const negativeControlVerdicts = negativeControlCandidateIds.flatMap((candidateId) => [
    views.creles_to_midus2.candidates[candidateId]?.verdict,
    views.midus2_to_creles.candidates[candidateId]?.verdict,
  ]);
  const glycemiaWins = glycemiaVerdicts.filter((verdict) => verdict === "beats_age_sex_with_recalibration").length;
  const negativeControlWins = negativeControlVerdicts
    .filter((verdict) => verdict === "beats_age_sex_with_recalibration").length;
  const controlVerdict = negativeControlVerdicts.length === 0
    ? "negative_controls_not_applicable"
    : negativeControlWins > 0
      ? "negative_controls_compete_with_glycemia"
      : "negative_controls_clean";
  const conclusion = glycemiaWins >= 4 && controlVerdict === "negative_controls_clean"
    ? "minimal_glycemia_transport_confirmed"
    : glycemiaWins > 0 && controlVerdict === "negative_controls_clean"
      ? "minimal_glycemia_transport_partial"
      : "minimal_glycemia_transport_not_confirmed";
  return {
    controlVerdict,
    conclusion,
    nextAction: conclusion === "minimal_glycemia_transport_confirmed"
      ? "prepare_aggregate_review_packet"
      : conclusion === "minimal_glycemia_transport_partial"
        ? "run_partner_or_workbench_integrated_labs_wearables_when_available"
        : "keep_glycemia_shadow_and_seek_external_biomarker_source",
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    rationale: conclusion === "minimal_glycemia_transport_confirmed"
      ? "Both glycemia candidates beat target age/sex in both recalibrated transport directions."
      : conclusion === "minimal_glycemia_transport_partial"
        ? "At least one minimal glycemia candidate helped under recalibrated transport, but evidence is not stable across both directions."
        : controlVerdict === "negative_controls_compete_with_glycemia"
          ? "Minimal glycemia candidates are not specific enough because negative controls also beat target age/sex under recalibrated transport."
          : "Minimal glycemia candidates did not beat target age/sex under recalibrated transport in the required directions.",
    reviewGptRequiredBeforeNextLocalRun: false,
  };
}

function summarizeDataShape(rows: readonly BenchmarkRow[], endpoint: string): R1041MinimalGlycemiaTransportOutput["dataShape"][SourceId] {
  return {
    eligibleRows: rows.length,
    endpoint,
    events: rows.reduce((sum, row) => sum + row.y, 0),
    splitCounts: splitCounts(rows),
  };
}

function assertSourceCells(rowsBySource: Record<SourceId, BenchmarkRow[]>): void {
  for (const [source, rows] of Object.entries(rowsBySource)) {
    const counts = splitCounts(rows);
    for (const [split, count] of Object.entries(counts)) {
      const nonEvents = count.n - count.events;
      if (count.events < MINIMUM_CELL_THRESHOLD || nonEvents < MINIMUM_CELL_THRESHOLD) {
        throw new Error(`R1041 ${source}.${split} failed minimum cell threshold.`);
      }
    }
  }
}

function splitCounts(rows: readonly BenchmarkRow[]): Record<Split, { events: number; n: number }> {
  return Object.fromEntries(
    (["calibration", "test", "train"] as const).map((split) => {
      const splitRows = rows.filter((row) => row.split === split);
      return [split, { events: splitRows.reduce((sum, row) => sum + row.y, 0), n: splitRows.length }];
    }),
  ) as Record<Split, { events: number; n: number }>;
}

function candidateSupported(rows: readonly BenchmarkRow[], featureKeys: readonly string[]): boolean {
  return featureKeys.every((featureKey) => rows.some((row) => isFiniteNumber(row.values[featureKey])));
}

function transportCandidateIds(sourceRows: readonly BenchmarkRow[], targetRows: readonly BenchmarkRow[]): CandidateId[] {
  return (Object.keys(MODEL_CANDIDATES) as CandidateId[])
    .filter((candidateId) => candidateSupported(sourceRows, MODEL_CANDIDATES[candidateId].featureKeys))
    .filter((candidateId) => candidateSupported(targetRows, MODEL_CANDIDATES[candidateId].featureKeys))
    .filter((candidateId) => candidateId !== "A3_glycemia_body_bp");
}

function unavailableForBothSources(rowsBySource: Record<SourceId, readonly BenchmarkRow[]>): CandidateId[] {
  return (Object.keys(MODEL_CANDIDATES) as CandidateId[]).filter((candidateId) => {
    const featureKeys = MODEL_CANDIDATES[candidateId].featureKeys;
    return !candidateSupported(rowsBySource.creles, featureKeys) || !candidateSupported(rowsBySource.midus2, featureKeys);
  });
}

function commonTransportFeatureKeys(rowsBySource: Record<SourceId, readonly BenchmarkRow[]>): string[] {
  const creles = new Set(sourceFeatureKeys(rowsBySource.creles));
  return sourceFeatureKeys(rowsBySource.midus2).filter((key) => creles.has(key));
}

function sourceFeatureKeys(rows: readonly BenchmarkRow[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row.values)) {
      if (isFiniteNumber(value)) keys.add(key);
    }
  }
  return Array.from(keys).sort();
}

async function readZippedTsvColumns(
  zipPath: string,
  entry: string,
  columns: readonly string[],
): Promise<TsvRow[]> {
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
    for (const [column, index] of Object.entries(indexes ?? {})) {
      row[column] = index >= 0 ? String(cells[index] ?? "").trim() : "";
    }
    rows.push(row);
  }
  await new Promise<void>((resolve, reject) => {
    unzip.on("close", (code) => code === 0 ? resolve() : reject(new Error(`unzip exited with ${code}`)));
    unzip.on("error", reject);
  });
  return rows;
}

function columnsForCrelesSource(source: "biomarker" | "recoded"): string[] {
  return CRELES_FEATURE_DEFINITIONS
    .filter((definition) => definition.source === source)
    .map((definition) => definition.column);
}

function stableSplit(source: SourceId, id: string): Split {
  const hex = createHash("sha256").update(`r1041-minimal-glycemia:${source}:${id}`).digest("hex").slice(0, 12);
  const value = Number.parseInt(hex, 16) / 0xffffffffffff;
  if (value < 0.6) return "train";
  if (value < 0.8) return "calibration";
  return "test";
}

function deterministicNoise(source: SourceId, id: string): number {
  const hex = createHash("sha256").update(`r1041-noise:${source}:${id}`).digest("hex").slice(0, 12);
  const unit = Number.parseInt(hex, 16) / 0xffffffffffff;
  return unit * 2 - 1;
}

function parseCrelesFollowupStatus(value: string | undefined): "alive" | "dead" | "lost" | "missing" {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (parsed === 1) return "alive";
  if (parsed === 2) return "dead";
  if (parsed === 3 || parsed === 4) return "lost";
  return "missing";
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

function bestByLogLoss(metrics: readonly R1041MetricSummary[]): R1041MetricSummary {
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
  const result = await runR1041MinimalGlycemiaTransportLoop({
    downloadsDir: process.env.MURPH_AGE_DOWNLOADS_DIR,
    iterations: parsePositiveInteger(process.env.MURPH_AGE_R1041_ITERATIONS),
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  });
  const summary = createCliSummary(result.output, path.basename(result.outputPath));
  console.log(JSON.stringify(summary, null, 2));
}

function createCliSummary(
  aggregate: R1041MinimalGlycemiaTransportOutput,
  artifact: string,
): {
  artifact: string;
  dataShape: R1041MinimalGlycemiaTransportOutput["dataShape"];
  decision: R1041MinimalGlycemiaTransportOutput["decision"];
  featureAvailability: R1041MinimalGlycemiaTransportOutput["featureAvailability"];
  packetId: R1041MinimalGlycemiaTransportOutput["packetId"];
  productDisplayAuthorized: false;
  rowValuesStored: false;
  status: R1041MinimalGlycemiaTransportOutput["status"];
  transportVerdicts: Record<keyof R1041MinimalGlycemiaTransportOutput["transportViews"], Partial<Record<CandidateId, R1041TransportCandidateSummary["verdict"]>>>;
} {
  return {
    artifact,
    dataShape: aggregate.dataShape,
    decision: aggregate.decision,
    featureAvailability: aggregate.featureAvailability,
    packetId: aggregate.packetId,
    productDisplayAuthorized: aggregate.productDisplayAuthorized,
    rowValuesStored: aggregate.rowValuesStored,
    status: aggregate.status,
    transportVerdicts: {
      creles_to_midus2: verdictSummary(aggregate.transportViews.creles_to_midus2.candidates),
      midus2_to_creles: verdictSummary(aggregate.transportViews.midus2_to_creles.candidates),
    },
  };
}

function verdictSummary(
  candidates: Partial<Record<CandidateId, R1041TransportCandidateSummary>>,
): Partial<Record<CandidateId, R1041TransportCandidateSummary["verdict"]>> {
  return Object.fromEntries(
    Object.entries(candidates).map(([candidateId, candidate]) => [
      candidateId,
      candidate?.verdict,
    ]),
  ) as Partial<Record<CandidateId, R1041TransportCandidateSummary["verdict"]>>;
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
      error: "R1041 minimal glycemia transport loop failed. Check local dataset availability and aggregate cell thresholds.",
      status: "failed",
    }));
    process.exit(1);
  }
}
