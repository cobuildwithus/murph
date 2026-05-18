import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

import { calculateAuc, findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1046_NSHAP_HBA1C_REPLICATION_SCHEMA_VERSION =
  "murph-age-r1046-nshap-hba1c-replication-loop.v1" as const;

const DEFAULT_OUTPUT_DIR = path.join(".runtime", "operations", "research", "murph-age", "model-runs");
const MINIMUM_CELL_THRESHOLD = 10;
const EPS = 1e-6;
const LAMBDAS = [0, 0.0001, 0.001, 0.01, 0.1, 1] as const;

const W1_ZIP = "ICPSR_20541-V10.zip";
const W2_ZIP = "ICPSR_34921-V5.zip";
const W3_ZIP = "ICPSR_36873-V9.zip";
const W1_BASELINE_ENTRY = "ICPSR_20541/DS0001/20541-0001-Data.tsv";
const W2_BASELINE_ENTRY = "ICPSR_34921/DS0001/34921-0001-Data.tsv";
const W2_TRACK_ENTRY = "ICPSR_34921/DS0003/34921-0003-Data.tsv";
const W3_TRACK_ENTRY = "ICPSR_36873/DS0005/36873-0005-Data.tsv";

const MODEL_CANDIDATES = {
  A0_age_sex: {
    candidateRole: "reference",
    featureKeys: ["age", "male"],
    rationale: "Age and sex reference.",
  },
  A1_hba1c: {
    candidateRole: "score_bearing_candidate",
    featureKeys: ["age", "male", "hba1c"],
    rationale: "Cleanest NSHAP glycemia replication candidate.",
  },
  A2_hba1c_body: {
    candidateRole: "score_bearing_candidate",
    featureKeys: ["age", "male", "hba1c", "bmi"],
    rationale: "Glycemia plus body/adiposity comparator.",
  },
  P1_pulse_only: {
    candidateRole: "pulse_shadow",
    featureKeys: ["age", "male", "pulse"],
    rationale: "Pulse-only physiology shadow; not consumer wearable validation.",
  },
  P2_hba1c_pulse: {
    candidateRole: "pulse_shadow",
    featureKeys: ["age", "male", "hba1c", "pulse"],
    rationale: "Glycemia plus pulse physiology shadow.",
  },
  P3_hba1c_body_pulse: {
    candidateRole: "pulse_shadow",
    featureKeys: ["age", "male", "hba1c", "bmi", "pulse"],
    rationale: "Glycemia, body, and pulse shadow panel.",
  },
  S1_sleep_problem_shadow: {
    candidateRole: "sleep_shadow",
    featureKeys: ["age", "male", "sleep-problem"],
    rationale: "Self-reported sleep-problem shadow; not consumer wearable validation.",
  },
  F1_walking_function_shadow: {
    candidateRole: "function_activity_shadow",
    featureKeys: ["age", "male", "walking-function"],
    rationale: "Walking-function shadow as activity/function context, not device validation.",
  },
  I1_hba1c_body_pulse_sleep_function: {
    candidateRole: "integrated_shadow",
    featureKeys: ["age", "male", "hba1c", "bmi", "pulse", "sleep-problem", "walking-function"],
    rationale: "Integrated lab/body/pulse/sleep/function shadow candidate for hypothesis generation only.",
  },
  NC2_body_only_without_hba1c: {
    candidateRole: "negative_control",
    featureKeys: ["age", "male", "bmi"],
    rationale: "Body/adiposity without glycemia.",
  },
  NC4_missingness_quality_only: {
    candidateRole: "negative_control",
    featureKeys: ["age", "male", "hba1c-missing", "pulse-missing", "sleep-missing", "walking-function-missing"],
    rationale: "Missingness/quality proxy control without measured biomarker or physiology values.",
  },
  NC5_noise_feature: {
    candidateRole: "negative_control",
    featureKeys: ["age", "male", "noise"],
    rationale: "Deterministic noise feature.",
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
type EndpointStatus = "alive" | "dead" | "unknown";
type SourceId = "nshap_w1_to_w3" | "nshap_w2_to_w3";
type Split = "calibration" | "test" | "train";
type TsvRow = Record<string, string>;

export interface R1046NshapHba1cReplicationOptions {
  createdAt?: string;
  downloadsDir?: string;
  iterations?: number;
  outputDir?: string;
}

export interface R1046MetricSummary {
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

export interface R1046ModelSummary {
  candidateRole: CandidateRole;
  deltasVsAgeSexReference: { brierDelta: number; logLossDelta: number };
  featureKeys: string[];
  featureObservedCounts: Record<string, number>;
  rationale: string;
  selectedLambda: number;
  splitMetrics: Record<Split, R1046MetricSummary>;
  verdict: "beats_age_sex" | "does_not_beat_age_sex" | "reference";
}

export interface R1046SourceSummary {
  dataShape: {
    eligibleRows: number;
    events: number;
    excludedUnknownEndpointRows: number;
    splitCounts: Record<Split, { events: number; n: number }>;
  };
  endpoint: string;
  evidenceClassLabel: "non-NHANES independent biomarker replication diagnostic";
  models: Record<CandidateId, R1046ModelSummary>;
  sourceLabel: string;
}

export interface R1046NshapHba1cReplicationOutput {
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
    benchmarkCardId: "r1046-nshap-hba1c-replication-card-0";
    blockedFamilies: ["crp", "hs-crp", "source-text", "participant-level-export", "product-display"];
    minimumCellThreshold: typeof MINIMUM_CELL_THRESHOLD;
    reviewGptDirection: "R1045 Extended Pro: replicate A1 glucose/HbA1c externally, keep A3/pulse shadow, require negative-control separation.";
    schemaVersion: "murph-age-benchmark-card.v1";
    wearableClaim: "none; pulse is wearable-adjacent physiology only";
  };
  codebookTextStored: false;
  coefficientsStored: false;
  createdAt: string;
  decision: {
    conclusion:
      | "nshap_hba1c_replication_supported"
      | "nshap_hba1c_replication_partial"
      | "nshap_hba1c_replication_not_supported";
    controlVerdict: "negative_controls_clean" | "negative_controls_compete_with_hba1c";
    nextAction:
      | "prepare_next_external_biomarker_replication_source"
      | "keep_hba1c_candidate_research_only_and_seek_additional_external_source";
    physiologyExpansionStatus: "shadow_only";
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    pulseStatus: "pulse_shadow_only";
    rationale: string;
    reviewGptRequiredBeforeNextLocalRun: false;
  };
  localPathsStored: false;
  modelParametersStored: false;
  modelScoringPerformed: true;
  participantIdentifiersStored: false;
  participantIdentifiersWritten: false;
  predictionsStored: false;
  productClaimsIncluded: false;
  productDisplayAuthorized: false;
  productPromotionAuthorized: false;
  rowValuesStored: false;
  schemaVersion: typeof R1046_NSHAP_HBA1C_REPLICATION_SCHEMA_VERSION;
  smallCellsStored: false;
  sourceBodiesStored: false;
  sources: Record<SourceId, R1046SourceSummary>;
  splitMembershipStored: false;
  status: "research-local-aggregate-only";
}

interface BenchmarkRow {
  id: string;
  split: Split;
  values: Record<string, number | null>;
  y: 0 | 1;
}

interface RowsResult {
  excludedUnknownEndpointRows: number;
  rows: BenchmarkRow[];
}

interface TrainedModel {
  featureKeys: string[];
  lambda: number;
  predict(row: BenchmarkRow): number;
  stats: Record<string, { mean: number; median: number; observedCount: number; sd: number }>;
}

export async function runR1046NshapHba1cReplicationLoop(
  options: R1046NshapHba1cReplicationOptions = {},
): Promise<{ output: R1046NshapHba1cReplicationOutput; outputPath: string }> {
  const downloadsDir = options.downloadsDir ?? path.join(os.homedir(), "Downloads");
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const endpointMaps = await readEndpointMaps(downloadsDir);
  const rowsBySource: Record<SourceId, RowsResult> = {
    nshap_w1_to_w3: await buildWave1Rows(downloadsDir, endpointMaps),
    nshap_w2_to_w3: await buildWave2Rows(downloadsDir, endpointMaps),
  };
  const iterations = options.iterations ?? 5000;
  const sources = Object.fromEntries((Object.entries(rowsBySource) as Array<[SourceId, RowsResult]>).map(([sourceId, rowsResult]) => {
    assertMinimumCells(sourceId, rowsResult.rows);
    const trained = Object.fromEntries((Object.keys(MODEL_CANDIDATES) as CandidateId[]).map((candidateId) => [
      candidateId,
      selectModel(rowsResult.rows, [...MODEL_CANDIDATES[candidateId].featureKeys], iterations),
    ])) as Record<CandidateId, TrainedModel>;
    return [sourceId, summarizeSource(sourceId, rowsResult, trained)];
  })) as Record<SourceId, R1046SourceSummary>;
  const output: R1046NshapHba1cReplicationOutput = {
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
      benchmarkCardId: "r1046-nshap-hba1c-replication-card-0",
      blockedFamilies: ["crp", "hs-crp", "source-text", "participant-level-export", "product-display"],
      minimumCellThreshold: MINIMUM_CELL_THRESHOLD,
      reviewGptDirection: "R1045 Extended Pro: replicate A1 glucose/HbA1c externally, keep A3/pulse shadow, require negative-control separation.",
      schemaVersion: "murph-age-benchmark-card.v1",
      wearableClaim: "none; pulse is wearable-adjacent physiology only",
    },
    codebookTextStored: false,
    coefficientsStored: false,
    createdAt: options.createdAt ?? new Date().toISOString(),
    decision: summarizeDecision(sources),
    localPathsStored: false,
    modelParametersStored: false,
    modelScoringPerformed: true,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    rowValuesStored: false,
    schemaVersion: R1046_NSHAP_HBA1C_REPLICATION_SCHEMA_VERSION,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sources,
    splitMembershipStored: false,
    status: "research-local-aggregate-only",
  };
  assertR1046Safe(output);
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "r1046-nshap-hba1c-replication-loop.latest.json");
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

export function assertR1046Safe(output: R1046NshapHba1cReplicationOutput): void {
  const findings = findForbiddenAggregateEgress(output);
  for (const flag of REQUIRED_FALSE_FLAGS) {
    if (output[flag] !== false) findings.push(`boundary flag ${flag} must be false`);
  }
  for (const [sourceId, source] of Object.entries(output.sources)) {
    for (const [split, counts] of Object.entries(source.dataShape.splitCounts)) {
      const nonEvents = counts.n - counts.events;
      if (counts.events > 0 && counts.events < MINIMUM_CELL_THRESHOLD) findings.push(`small event count emitted for ${sourceId}/${split}`);
      if (nonEvents > 0 && nonEvents < MINIMUM_CELL_THRESHOLD) findings.push(`small non-event count emitted for ${sourceId}/${split}`);
    }
  }
  if (findings.length > 0) throw new Error(`R1046 NSHAP HbA1c replication loop failed safety validation: ${findings.join("; ")}`);
}

async function readEndpointMaps(downloadsDir: string): Promise<{
  wave2: Map<string, EndpointStatus>;
  wave3: Map<string, EndpointStatus>;
}> {
  const [wave2Rows, wave3Rows] = await Promise.all([
    readZippedTsvColumns(path.join(downloadsDir, W2_ZIP), W2_TRACK_ENTRY, ["ID", "DECEASED"]),
    readZippedTsvColumns(path.join(downloadsDir, W3_ZIP), W3_TRACK_ENTRY, ["ID", "DECEASED"]),
  ]);
  return {
    wave2: new Map(wave2Rows.map((row) => [row.ID, parseDeceased(row.DECEASED)])),
    wave3: new Map(wave3Rows.map((row) => [row.ID, parseDeceased(row.DECEASED)])),
  };
}

async function buildWave1Rows(
  downloadsDir: string,
  endpoints: { wave2: Map<string, EndpointStatus>; wave3: Map<string, EndpointStatus> },
): Promise<RowsResult> {
  const sourceRows = await readZippedTsvColumns(
    path.join(downloadsDir, W1_ZIP),
    W1_BASELINE_ENTRY,
    ["ID", "AGE", "GENDER", "BMI", "HBA1C", "PULSE_MEAN", "NOSLEEP", "WALKBLK", "WALKROOM"],
  );
  const rows: BenchmarkRow[] = [];
  let excludedUnknownEndpointRows = 0;
  for (const sourceRow of sourceRows) {
    const id = sourceRow.ID;
    const endpoint = combineWave1Endpoint(endpoints.wave2.get(id), endpoints.wave3.get(id));
    if (endpoint === "unknown") {
      excludedUnknownEndpointRows += 1;
      continue;
    }
    const walkingFunctionValue = walkingFunctionProxy(sourceRow.WALKBLK, sourceRow.WALKROOM);
    const values = {
      age: parseMetricValue(sourceRow.AGE),
      bmi: parseMetricValue(sourceRow.BMI),
      hba1c: parseMetricValue(sourceRow.HBA1C),
      "hba1c-missing": missingFlag(sourceRow.HBA1C),
      male: parseSex(sourceRow.GENDER),
      noise: deterministicNoise("nshap-w1", id),
      pulse: parseMetricValue(sourceRow.PULSE_MEAN),
      "pulse-missing": missingFlag(sourceRow.PULSE_MEAN),
      "sleep-missing": missingFlag(sourceRow.NOSLEEP),
      "sleep-problem": parseNonnegativeCode(sourceRow.NOSLEEP),
      "walking-function": walkingFunctionValue,
      "walking-function-missing": walkingFunctionValue === null ? 1 : 0,
    };
    if (!isFiniteNumber(values.age) || !isFiniteNumber(values.male)) continue;
    rows.push({ id, split: stableSplit("nshap-w1", id), values, y: endpoint === "dead" ? 1 : 0 });
  }
  return { excludedUnknownEndpointRows, rows };
}

async function buildWave2Rows(
  downloadsDir: string,
  endpoints: { wave3: Map<string, EndpointStatus> },
): Promise<RowsResult> {
  const sourceRows = await readZippedTsvColumns(
    path.join(downloadsDir, W2_ZIP),
    W2_BASELINE_ENTRY,
    ["ID", "AGE", "GENDER", "A1C_WHBL", "A1C_DBS", "WEIGHT", "HEIGHT", "PULSE_1", "PULSE_2", "NOSLEEP", "WALKBLK", "WALKROOM"],
  );
  const rows: BenchmarkRow[] = [];
  let excludedUnknownEndpointRows = 0;
  for (const sourceRow of sourceRows) {
    const id = sourceRow.ID;
    const endpoint = endpoints.wave3.get(id) ?? "unknown";
    if (endpoint === "unknown") {
      excludedUnknownEndpointRows += 1;
      continue;
    }
    const pulseValues = [parseMetricValue(sourceRow.PULSE_1), parseMetricValue(sourceRow.PULSE_2)].filter(isFiniteNumber);
    const hba1cValue = parseMetricValue(sourceRow.A1C_WHBL) ?? parseMetricValue(sourceRow.A1C_DBS);
    const pulseValue = pulseValues.length > 0 ? mean(pulseValues) : null;
    const walkingFunctionValue = walkingFunctionProxy(sourceRow.WALKBLK, sourceRow.WALKROOM);
    const values = {
      age: parseMetricValue(sourceRow.AGE),
      bmi: calculateBmiFromImperial(sourceRow.WEIGHT, sourceRow.HEIGHT),
      hba1c: hba1cValue,
      "hba1c-missing": hba1cValue === null ? 1 : 0,
      male: parseSex(sourceRow.GENDER),
      noise: deterministicNoise("nshap-w2", id),
      pulse: pulseValue,
      "pulse-missing": pulseValue === null ? 1 : 0,
      "sleep-missing": missingFlag(sourceRow.NOSLEEP),
      "sleep-problem": parseNonnegativeCode(sourceRow.NOSLEEP),
      "walking-function": walkingFunctionValue,
      "walking-function-missing": walkingFunctionValue === null ? 1 : 0,
    };
    if (!isFiniteNumber(values.age) || !isFiniteNumber(values.male)) continue;
    rows.push({ id, split: stableSplit("nshap-w2", id), values, y: endpoint === "dead" ? 1 : 0 });
  }
  return { excludedUnknownEndpointRows, rows };
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

function summarizeSource(sourceId: SourceId, rowsResult: RowsResult, trained: Record<CandidateId, TrainedModel>): R1046SourceSummary {
  const models = summarizeModels(rowsResult.rows, trained);
  return {
    dataShape: {
      eligibleRows: rowsResult.rows.length,
      events: rowsResult.rows.reduce((sum, row) => sum + row.y, 0),
      excludedUnknownEndpointRows: rowsResult.excludedUnknownEndpointRows,
      splitCounts: splitCounts(rowsResult.rows),
    },
    endpoint: sourceId === "nshap_w1_to_w3"
      ? "death by NSHAP wave 2 or wave 3 among participants with known wave-3 tracking status"
      : "death by NSHAP wave 3 among participants with known wave-3 tracking status",
    evidenceClassLabel: "non-NHANES independent biomarker replication diagnostic",
    models,
    sourceLabel: sourceId === "nshap_w1_to_w3"
      ? "NSHAP wave 1 HbA1c baseline to later death tracking"
      : "NSHAP wave 2 HbA1c baseline to later death tracking",
  };
}

function summarizeModels(
  rows: readonly BenchmarkRow[],
  trained: Record<CandidateId, TrainedModel>,
): Record<CandidateId, R1046ModelSummary> {
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
  })) as Record<CandidateId, R1046ModelSummary>;
}

function summarizeDecision(sources: Record<SourceId, R1046SourceSummary>): R1046NshapHba1cReplicationOutput["decision"] {
  const sourceSummaries = Object.values(sources);
  const cleanSupportCount = sourceSummaries.filter((source) => {
    const hba1cWins = source.models.A1_hba1c.verdict === "beats_age_sex";
    const controlsCompete = source.models.NC2_body_only_without_hba1c.verdict === "beats_age_sex"
      || source.models.NC4_missingness_quality_only.verdict === "beats_age_sex"
      || source.models.NC5_noise_feature.verdict === "beats_age_sex";
    return hba1cWins && !controlsCompete;
  }).length;
  const controlsCompeteAnywhere = sourceSummaries.some((source) =>
    source.models.NC2_body_only_without_hba1c.verdict === "beats_age_sex"
    || source.models.NC4_missingness_quality_only.verdict === "beats_age_sex"
    || source.models.NC5_noise_feature.verdict === "beats_age_sex"
  );
  const conclusion = cleanSupportCount === sourceSummaries.length
    ? "nshap_hba1c_replication_supported"
    : cleanSupportCount > 0
      ? "nshap_hba1c_replication_partial"
      : "nshap_hba1c_replication_not_supported";
  return {
    conclusion,
    controlVerdict: controlsCompeteAnywhere ? "negative_controls_compete_with_hba1c" : "negative_controls_clean",
    nextAction: conclusion === "nshap_hba1c_replication_supported"
      ? "prepare_next_external_biomarker_replication_source"
      : "keep_hba1c_candidate_research_only_and_seek_additional_external_source",
    physiologyExpansionStatus: "shadow_only",
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    pulseStatus: "pulse_shadow_only",
    rationale: conclusion === "nshap_hba1c_replication_supported"
      ? "NSHAP HbA1c candidates replicate across both wave baselines while negative controls do not compete."
      : conclusion === "nshap_hba1c_replication_partial"
        ? "At least one NSHAP HbA1c source supports the glucose/HbA1c candidate, but replication is not uniform across wave baselines."
        : "NSHAP HbA1c candidates do not cleanly improve proper scores over age/sex with negative-control separation.",
    reviewGptRequiredBeforeNextLocalRun: false,
  };
}

function aggregateMetrics(rows: readonly BenchmarkRow[], model: { predict(row: BenchmarkRow): number }, split: Split): R1046MetricSummary {
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

function assertMinimumCells(sourceId: SourceId, rows: readonly BenchmarkRow[]): void {
  for (const [split, counts] of Object.entries(splitCounts(rows))) {
    const nonEvents = counts.n - counts.events;
    if (counts.events < MINIMUM_CELL_THRESHOLD || nonEvents < MINIMUM_CELL_THRESHOLD) {
      throw new Error(`R1046 ${sourceId}/${split} failed minimum cell threshold.`);
    }
  }
}

function splitCounts(rows: readonly BenchmarkRow[]): Record<Split, { events: number; n: number }> {
  return Object.fromEntries((["calibration", "test", "train"] as const).map((split) => {
    const splitRows = rows.filter((row) => row.split === split);
    return [split, { events: splitRows.reduce((sum, row) => sum + row.y, 0), n: splitRows.length }];
  })) as Record<Split, { events: number; n: number }>;
}

function combineWave1Endpoint(wave2: EndpointStatus | undefined, wave3: EndpointStatus | undefined): EndpointStatus {
  if (wave2 === "dead" || wave3 === "dead") return "dead";
  if (wave3 === "alive") return "alive";
  return "unknown";
}

function parseDeceased(value: string | undefined): EndpointStatus {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (parsed === 1) return "dead";
  if (parsed === 0) return "alive";
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
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 999_999) return null;
  return parsed;
}

function parseNonnegativeCode(value: string | undefined): number | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed >= 999_999) return null;
  return parsed;
}

function walkingFunctionProxy(walkBlockValue: string | undefined, walkRoomValue: string | undefined): number | null {
  const values = [parseNonnegativeCode(walkBlockValue), parseNonnegativeCode(walkRoomValue)].filter(isFiniteNumber);
  return values.length > 0 ? Math.max(...values) : null;
}

function missingFlag(value: string | undefined): 0 | 1 {
  return parseNonnegativeCode(value) === null ? 1 : 0;
}

function calculateBmiFromImperial(weightValue: string | undefined, heightValue: string | undefined): number | null {
  const weight = parseMetricValue(weightValue);
  const height = parseMetricValue(heightValue);
  if (!weight || !height || weight < 70 || weight > 500 || height < 48 || height > 84) return null;
  return weight / (height ** 2) * 703;
}

function stableSplit(sourceId: string, id: string): Split {
  const value = Number.parseInt(createHash("sha256").update(`r1046:${sourceId}:${id}`).digest("hex").slice(0, 12), 16) / 0xffffffffffff;
  if (value < 0.6) return "train";
  if (value < 0.8) return "calibration";
  return "test";
}

function deterministicNoise(sourceId: string, id: string): number {
  const value = Number.parseInt(createHash("sha256").update(`r1046-noise:${sourceId}:${id}`).digest("hex").slice(0, 12), 16) / 0xffffffffffff;
  return value * 2 - 1;
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
  const result = await runR1046NshapHba1cReplicationLoop({
    downloadsDir: process.env.MURPH_AGE_DOWNLOADS_DIR,
    iterations: parsePositiveInteger(process.env.MURPH_AGE_R1046_ITERATIONS),
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  });
  const summary = createCliSummary(result.output, path.basename(result.outputPath));
  console.log(JSON.stringify(summary, null, 2));
}

function createCliSummary(
  aggregate: R1046NshapHba1cReplicationOutput,
  artifact: string,
): {
  artifact: string;
  decision: R1046NshapHba1cReplicationOutput["decision"];
  modelVerdicts: Record<SourceId, Partial<Record<CandidateId, R1046ModelSummary["verdict"]>>>;
  packetId: "r1046-nshap-hba1c-replication-loop";
  productDisplayAuthorized: false;
  rowValuesStored: false;
  sourceShapes: Record<SourceId, R1046SourceSummary["dataShape"]>;
  status: R1046NshapHba1cReplicationOutput["status"];
} {
  return {
    artifact,
    decision: aggregate.decision,
    modelVerdicts: Object.fromEntries(Object.entries(aggregate.sources).map(([sourceId, source]) => [
      sourceId,
      Object.fromEntries(Object.entries(source.models).map(([candidateId, model]) => [candidateId, model.verdict])),
    ])) as Record<SourceId, Partial<Record<CandidateId, R1046ModelSummary["verdict"]>>>,
    packetId: "r1046-nshap-hba1c-replication-loop",
    productDisplayAuthorized: aggregate.productDisplayAuthorized,
    rowValuesStored: aggregate.rowValuesStored,
    sourceShapes: Object.fromEntries(Object.entries(aggregate.sources).map(([sourceId, source]) => [
      sourceId,
      source.dataShape,
    ])) as Record<SourceId, R1046SourceSummary["dataShape"]>,
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
      error: "R1046 NSHAP HbA1c replication loop failed. Check local NSHAP archive availability and aggregate cell thresholds.",
      status: "failed",
    }));
    process.exit(1);
  }
}
