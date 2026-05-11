import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

import { calculateAuc, findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const CRELES_LOCAL_BENCHMARK_SCHEMA_VERSION = "murph-age-creles-local-benchmark.v1" as const;

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

const FEATURE_DEFINITIONS = [
  { column: "AGE", key: "age", source: "recoded", transform: (value: number) => value },
  { column: "SEX", key: "male", source: "recoded", transform: (value: number) => value === 1 ? 1 : value === 2 ? 0 : null },
  { column: "IMC", key: "bmi", source: "biomarker", transform: (value: number) => value },
  { column: "GLUCOSA", key: "glucose", source: "biomarker", transform: (value: number) => value },
  { column: "HBAC1", key: "hba1c", source: "biomarker", transform: (value: number) => value },
  { column: "COLESTTOT", key: "total-cholesterol", source: "biomarker", transform: (value: number) => value },
  { column: "TGS", key: "log-triglycerides", source: "biomarker", transform: (value: number) => value > 0 ? Math.log(value) : null },
  { column: "HDL", key: "hdl-c", source: "biomarker", transform: (value: number) => value },
  { column: "LDL", key: "ldl-c", source: "biomarker", transform: (value: number) => value },
  { column: "SISTOLICA", key: "systolic-blood-pressure", source: "biomarker", transform: (value: number) => value },
  { column: "DIASTOLICA", key: "diastolic-blood-pressure", source: "biomarker", transform: (value: number) => value },
] as const;

const MODEL_CANDIDATE_DEFINITIONS = {
  age_sex_reference: {
    candidateRole: "reference",
    featureKeys: ["age", "male"],
    hypothesis: "Age and sex reference model for CRELES wave-3 mortality-status comparison.",
    hypothesisSource: "literature or mechanistic rationale",
  },
  glycemia_body_no_crp: {
    candidateRole: "proposal",
    featureKeys: ["age", "male", "bmi", "hba1c", "glucose"],
    hypothesis: "Body size plus glycemia may add mortality-status signal over demographics in an older-adult transport cohort.",
    hypothesisSource: "transport stress test",
  },
  lab5_lipid_body_no_crp: {
    candidateRole: "proposal",
    featureKeys: ["age", "male", "bmi", "hba1c", "log-triglycerides", "hdl-c"],
    hypothesis: "The compact lab5 lipid/glycemia/body feature set should be checked in CRELES before it is treated as broadly transportable.",
    hypothesisSource: "transport stress test",
  },
  bp_lipid_body_no_crp: {
    candidateRole: "proposal",
    featureKeys: [
      "age",
      "male",
      "bmi",
      "hba1c",
      "log-triglycerides",
      "hdl-c",
      "systolic-blood-pressure",
      "diastolic-blood-pressure",
    ],
    hypothesis: "Blood pressure may explain additional older-adult mortality-status signal beyond compact labs and body size.",
    hypothesisSource: "transport stress test",
  },
  extended_clinical_no_crp: {
    candidateRole: "proposal",
    featureKeys: [
      "age",
      "male",
      "bmi",
      "glucose",
      "hba1c",
      "total-cholesterol",
      "log-triglycerides",
      "hdl-c",
      "ldl-c",
      "systolic-blood-pressure",
      "diastolic-blood-pressure",
    ],
    hypothesis: "A broader no-CRP clinical feature set may improve CRELES discrimination but must justify its added complexity.",
    hypothesisSource: "transport stress test",
  },
} as const;

const LAMBDAS = [0, 0.0001, 0.001, 0.01, 0.1, 1] as const;
const MINIMUM_CELL_THRESHOLD = 10;

const CRELES_BENCHMARK_CARD = {
  abstentionCriteria: [
    "Required CRELES Wave 1 recoded, Wave 1 biomarker, or Wave 3 follow-up files are unavailable.",
    "Wave-3 status cannot be interpreted as interviewed, death by wave date, or lost to follow-up.",
    "Known-status denominator has no outcome variation or falls below the minimum aggregate cell threshold.",
    "A candidate requires CRP, hsCRP, exact death dates, controlled fields, source text, or participant-level export.",
  ],
  allowedArtifactBoundary: [
    "aggregate counts",
    "aggregate split metrics",
    "aggregate feature-observed counts",
    "benchmark-card metadata",
    "validation statuses",
  ],
  allowedMetrics: ["auc", "brier", "logLoss", "meanPrediction", "observedRate"],
  baseline: "CRELES Wave 1 household/biomarker baseline",
  benchmarkCardId: "creles-wave1-wave3-mortality-status-card-0",
  censoringRule: "Participants lost before Wave 3 are excluded; exact death and censoring dates are not used.",
  denominator: "Wave 1 biomarker participants with interpretable Wave 3 known-alive or death-by-wave status",
  endpoint: "death by CRELES wave 3 among participants with known wave-3 status",
  evidenceClassLabel: "public non-NHANES transport diagnostic",
  exposureLabel: "diagnostic-only",
  featureMappingPolicy: {
    allowedFeatureFamilies: ["demographics", "body", "glycemia", "lipids", "blood-pressure"],
    blockedFeatureFamilies: ["crp", "hs-crp", "inflammation-assay-family"],
  },
  followupWindow: "Wave 1 baseline to Wave 3 status",
  minimumCellThreshold: MINIMUM_CELL_THRESHOLD,
  missingnessPolicy: "Median imputation from the train split for candidate features; no row-level imputation diagnostics leave local memory.",
  schemaVersion: "murph-age-benchmark-card.v1",
  surveyWeightPolicy: "Unweighted first transport diagnostic; weighted CRELES analysis requires a separate predeclared runner.",
  transportStressMatrix: {
    ageRange: "older-adult cohort",
    cohortEra: "2000s",
    endpointAscertainment: "wave follow-up status",
    featureMissingness: "candidate-feature missingness handled by train-split median imputation",
    followupWindow: "approximately Wave 1 to Wave 3",
    geography: "Costa Rica",
    measurementPipeline: "CRELES household, anthropometry, blood biomarker, and blood-pressure files",
    recruitmentFrame: "community older-adult cohort",
  },
} as const;

type FeatureDefinition = typeof FEATURE_DEFINITIONS[number];
type FeatureSource = FeatureDefinition["source"];
type ModelCandidateDefinition = typeof MODEL_CANDIDATE_DEFINITIONS[keyof typeof MODEL_CANDIDATE_DEFINITIONS];
type ModelCandidateHypothesisSource = ModelCandidateDefinition["hypothesisSource"];

export interface CrelesLocalBenchmarkOptions {
  createdAt?: string;
  downloadsDir?: string;
  outputDir?: string;
}

export interface CrelesAggregateMetricSummary {
  auc: number | null;
  brier: number;
  events: number;
  logLoss: number;
  meanPrediction: number;
  n: number;
  observedRate: number;
}

export interface CrelesLocalBenchmarkOutput {
  benchmarkCard: typeof CRELES_BENCHMARK_CARD;
  benchmarkId: "creles-wave1-biomarker-wave3-mortality-status-local-0";
  candidateBatch: {
    batchId: "creles-wave3-no-crp-candidate-batch";
    candidateCount: number;
    exposureLabel: "diagnostic-only";
    hypothesisSources: ModelCandidateHypothesisSource[];
    promotionAuthorized: false;
    testSelectionAuthorized: false;
  };
  codebookTextStored: false;
  coefficientsStored: false;
  createdAt: string;
  dataShape: {
    eligibleRows: number;
    events: number;
    excludedFollowupRows: number;
    splitCounts: Record<"calibration" | "test" | "train", { events: number; n: number }>;
  };
  endpoint: "death by CRELES wave 3 among participants with known wave-3 status";
  endpointLimitations: [
    "Wave-status endpoint only; exact death or censoring dates are not used.",
    "Lost-to-follow-up statuses are excluded from the executable benchmark denominator.",
  ];
  modelScoringPerformed: true;
  models: Record<string, {
    candidateRole: "proposal" | "reference";
    coefficientsStored: false;
    featureKeys: string[];
    featureObservedCounts: Record<string, number>;
    hypothesis: string;
    hypothesisSource: ModelCandidateHypothesisSource;
    predictionsStored: false;
    selectedLambda: number;
    splitMetrics: Record<"calibration" | "test" | "train", CrelesAggregateMetricSummary>;
  }>;
  participantIdentifiersStored: false;
  participantIdentifiersWritten: false;
  predictionsStored: false;
  rowValuesStored: false;
  schemaVersion: typeof CRELES_LOCAL_BENCHMARK_SCHEMA_VERSION;
  sourceBodiesStored: false;
  splitMembershipStored: false;
  status: "research-local-aggregate-only";
}

interface BenchmarkRowsResult {
  excludedFollowupRows: number;
  rows: ParsedRow[];
}

interface ParsedRow {
  split: "calibration" | "test" | "train";
  values: Record<string, number | null>;
  y: 0 | 1;
}

interface TrainedModel {
  featureKeys: string[];
  lambda: number;
  predict(row: ParsedRow): number;
  stats: Record<string, { mean: number; median: number; observedCount: number; sd: number }>;
}

type TsvRow = Record<string, string>;

export async function runCrelesLocalBenchmark(
  options: CrelesLocalBenchmarkOptions = {},
): Promise<{ output: CrelesLocalBenchmarkOutput; outputPath: string }> {
  const downloadsDir = options.downloadsDir ?? path.join(os.homedir(), "Downloads");
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const benchmarkCard = CRELES_BENCHMARK_CARD;
  const { excludedFollowupRows, rows } = await buildBenchmarkRows(downloadsDir);

  const models = Object.fromEntries(
    Object.entries(MODEL_CANDIDATE_DEFINITIONS).map(([modelId, candidate]) => {
      const trained = selectModel(rows, [...candidate.featureKeys]);
      return [modelId, summarizeModel(rows, trained, candidate)];
    }),
  );

  const output: CrelesLocalBenchmarkOutput = {
    benchmarkCard,
    benchmarkId: "creles-wave1-biomarker-wave3-mortality-status-local-0",
    candidateBatch: {
      batchId: "creles-wave3-no-crp-candidate-batch",
      candidateCount: Object.keys(MODEL_CANDIDATE_DEFINITIONS).length,
      exposureLabel: "diagnostic-only",
      hypothesisSources: Array.from(new Set(
        Object.values(MODEL_CANDIDATE_DEFINITIONS).map((candidate) => candidate.hypothesisSource),
      )),
      promotionAuthorized: false,
      testSelectionAuthorized: false,
    },
    codebookTextStored: false,
    coefficientsStored: false,
    createdAt: options.createdAt ?? new Date().toISOString(),
    dataShape: {
      eligibleRows: rows.length,
      events: rows.reduce((count, row) => count + row.y, 0),
      excludedFollowupRows,
      splitCounts: splitCounts(rows),
    },
    endpoint: "death by CRELES wave 3 among participants with known wave-3 status",
    endpointLimitations: [
      "Wave-status endpoint only; exact death or censoring dates are not used.",
      "Lost-to-follow-up statuses are excluded from the executable benchmark denominator.",
    ],
    modelScoringPerformed: true,
    models,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    rowValuesStored: false,
    schemaVersion: CRELES_LOCAL_BENCHMARK_SCHEMA_VERSION,
    sourceBodiesStored: false,
    splitMembershipStored: false,
    status: "research-local-aggregate-only",
  };

  assertMinimumAggregateCells(output);
  const forbiddenFindings = findForbiddenAggregateEgress(output);
  if (forbiddenFindings.length > 0) {
    throw new Error(`CRELES aggregate output failed egress validation: ${forbiddenFindings.join("; ")}`);
  }

  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "creles-local-benchmark.latest.json");
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function assertMinimumAggregateCells(output: CrelesLocalBenchmarkOutput): void {
  const threshold = output.benchmarkCard.minimumCellThreshold;
  for (const [split, counts] of Object.entries(output.dataShape.splitCounts)) {
    if (counts.events < threshold || counts.n - counts.events < threshold) {
      throw new Error(`CRELES aggregate output failed minimum cell threshold for ${split}.`);
    }
  }
}

async function buildBenchmarkRows(downloadsDir: string): Promise<BenchmarkRowsResult> {
  const recodedRows = await readZippedTsvColumns(
    path.join(downloadsDir, CRELES_WAVE1_ZIP),
    CRELES_WAVE1_RECODED_ENTRY,
    ["IDSUJETO", ...columnsForSource("recoded")],
  );
  const biomarkerRows = await readZippedTsvColumns(
    path.join(downloadsDir, CRELES_WAVE1_ZIP),
    CRELES_WAVE1_BIOMARKER_ENTRY,
    ["IDSUJETO", ...columnsForSource("biomarker")],
  );
  const followupRows = await readZippedTsvColumns(
    path.join(downloadsDir, CRELES_WAVE3_ZIP),
    CRELES_WAVE3_FOLLOWUP_ENTRY,
    ["IDSUJETO", "TRACK_W3"],
  );

  const recodedById = new Map(recodedRows.filter((row) => row.IDSUJETO).map((row) => [row.IDSUJETO, row]));
  const followupById = new Map(followupRows.filter((row) => row.IDSUJETO).map((row) => [row.IDSUJETO, row]));
  const rows: ParsedRow[] = [];
  let excludedFollowupRows = 0;

  for (const biomarkerRow of biomarkerRows) {
    const id = biomarkerRow.IDSUJETO;
    if (!id) continue;
    const recodedRow = recodedById.get(id);
    const followupStatus = parseFollowupStatus(followupById.get(id)?.TRACK_W3);
    if (!recodedRow || followupStatus === "missing") continue;
    if (followupStatus === "lost") {
      excludedFollowupRows += 1;
      continue;
    }

    const values: Record<string, number | null> = {};
    for (const definition of FEATURE_DEFINITIONS) {
      const row = definition.source === "recoded" ? recodedRow : biomarkerRow;
      const rawValue = parseMetricValue(row[definition.column]);
      values[definition.key] = rawValue === null ? null : definition.transform(rawValue);
    }
    rows.push({
      split: stableSplit(id),
      values,
      y: followupStatus === "dead" ? 1 : 0,
    });
  }
  return { excludedFollowupRows, rows };
}

function columnsForSource(source: FeatureSource): string[] {
  return FEATURE_DEFINITIONS
    .filter((definition) => definition.source === source)
    .map((definition) => definition.column);
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

function selectModel(rows: readonly ParsedRow[], featureKeys: string[]): TrainedModel {
  const candidates = LAMBDAS.map((lambda) => {
    const model = trainLogistic(rows, featureKeys, lambda);
    return {
      calibrationLogLoss: aggregateMetrics(rows, model, "calibration").logLoss,
      model,
    };
  });
  return candidates.sort((a, b) => a.calibrationLogLoss - b.calibrationLogLoss)[0]!.model;
}

function trainLogistic(rows: readonly ParsedRow[], featureKeys: string[], lambda: number): TrainedModel {
  const { stats, vectorForRow } = prepareFeatureMatrix(rows, featureKeys);
  const trainRows = rows.filter((row) => row.split === "train");
  const weights = new Array(featureKeys.length + 1).fill(0);
  for (let iteration = 0; iteration < 5000; iteration += 1) {
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
    stats,
  };
}

function prepareFeatureMatrix(rows: readonly ParsedRow[], featureKeys: readonly string[]) {
  const trainRows = rows.filter((row) => row.split === "train");
  const stats: Record<string, { mean: number; median: number; observedCount: number; sd: number }> = {};
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

function summarizeModel(
  rows: readonly ParsedRow[],
  model: TrainedModel,
  candidate: ModelCandidateDefinition,
): CrelesLocalBenchmarkOutput["models"][string] {
  return {
    candidateRole: candidate.candidateRole,
    coefficientsStored: false,
    featureKeys: model.featureKeys,
    featureObservedCounts: Object.fromEntries(
      model.featureKeys.map((key) => [key, model.stats[key]?.observedCount ?? 0]),
    ),
    hypothesis: candidate.hypothesis,
    hypothesisSource: candidate.hypothesisSource,
    predictionsStored: false,
    selectedLambda: model.lambda,
    splitMetrics: {
      calibration: aggregateMetrics(rows, model, "calibration"),
      test: aggregateMetrics(rows, model, "test"),
      train: aggregateMetrics(rows, model, "train"),
    },
  };
}

function aggregateMetrics(
  rows: readonly ParsedRow[],
  model: TrainedModel,
  split: ParsedRow["split"],
): CrelesAggregateMetricSummary {
  const subset = rows.filter((row) => row.split === split);
  const labels = subset.map((row) => row.y);
  const predictions = subset.map((row) => model.predict(row));
  const eps = 1e-6;
  return {
    auc: calculateAuc(labels, predictions),
    brier: mean(labels.map((label, index) => (predictions[index]! - label) ** 2)),
    events: labels.reduce<number>((sum, label) => sum + label, 0),
    logLoss: -mean(labels.map((label, index) =>
      label * Math.log(Math.max(eps, predictions[index]!))
      + (1 - label) * Math.log(Math.max(eps, 1 - predictions[index]!))
    )),
    meanPrediction: mean(predictions),
    n: subset.length,
    observedRate: mean(labels),
  };
}

function splitCounts(rows: readonly ParsedRow[]): CrelesLocalBenchmarkOutput["dataShape"]["splitCounts"] {
  return Object.fromEntries(
    (["calibration", "test", "train"] as const).map((split) => {
      const splitRows = rows.filter((row) => row.split === split);
      return [split, { events: splitRows.reduce((sum, row) => sum + row.y, 0), n: splitRows.length }];
    }),
  ) as CrelesLocalBenchmarkOutput["dataShape"]["splitCounts"];
}

function stableSplit(id: string): ParsedRow["split"] {
  const hex = createHash("sha256").update(`creles-wave3-bench-0:${id}`).digest("hex").slice(0, 12);
  const value = Number.parseInt(hex, 16) / 0xffffffffffff;
  if (value < 0.6) return "train";
  if (value < 0.8) return "calibration";
  return "test";
}

function parseFollowupStatus(value: string | undefined): "alive" | "dead" | "lost" | "missing" {
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

function dot(a: readonly number[], b: readonly number[]): number {
  return a.reduce((sum, value, index) => sum + value * b[index]!, 0);
}

function sigmoid(value: number): number {
  return value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));
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

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = await runCrelesLocalBenchmark({
    downloadsDir: process.env.MURPH_AGE_DOWNLOADS_DIR,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  });
  const aggregateSummary = {
    candidateBatch: result.output.candidateBatch,
    dataShape: result.output.dataShape,
    endpoint: result.output.endpoint,
    endpointLimitations: result.output.endpointLimitations,
    models: Object.fromEntries(
      Object.entries(result.output.models).map(([modelId, model]) => [modelId, {
        candidateRole: model.candidateRole,
        hypothesisSource: model.hypothesisSource,
        selectedLambda: model.selectedLambda,
        test: model.splitMetrics.test,
      }]),
    ),
    status: result.output.status,
    artifact: path.basename(result.outputPath),
  };
  console.log(JSON.stringify(aggregateSummary, null, 2));
}
