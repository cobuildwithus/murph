import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

export const MIDUS2_LOCAL_BENCHMARK_SCHEMA_VERSION = "murph-age-midus2-local-benchmark.v1" as const;

const MIDUS2_SURVEY_ZIP = "ICPSR_04652-V8.zip";
const MIDUS2_BIOMARKER_ZIP = "ICPSR_29282-V11.zip";
const MIDUS2_MORTALITY_ZIP = "ICPSR_37237-V6.zip";

const MIDUS2_SURVEY_ENTRY = "ICPSR_04652/DS0001/04652-0001-Data.tsv";
const MIDUS2_BIOMARKER_ENTRY = "ICPSR_29282/DS0001/29282-0001-Data.tsv";
const MIDUS2_MORTALITY_ENTRY = "ICPSR_37237/DS0001/37237-0001-Data.tsv";

const DEFAULT_OUTPUT_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);

const FEATURE_DEFINITIONS = [
  { column: "B4ZAGE", key: "age", transform: (value: number) => value },
  { column: "B1PRSEX", key: "male", transform: (value: number) => value === 1 ? 1 : value === 2 ? 0 : null },
  { column: "B4PBMI", key: "bmi", transform: (value: number) => value },
  { column: "B4BHA1C", key: "hba1c", transform: (value: number) => value },
  { column: "B4BCHOL", key: "total-cholesterol", transform: (value: number) => value },
  { column: "B4BTRIGL", key: "log-triglycerides", transform: (value: number) => value > 0 ? Math.log(value) : null },
  { column: "B4BHDL", key: "hdl-c", transform: (value: number) => value },
  { column: "B4BLDL", key: "ldl-c", transform: (value: number) => value },
] as const;

const MODEL_CANDIDATE_DEFINITIONS = {
  age_sex_reference: {
    candidateRole: "reference",
    featureKeys: ["age", "male"],
    hypothesis: "Age and sex reference model for same-denominator comparison.",
    hypothesisSource: "literature or mechanistic rationale",
  },
  glycemia_body_no_crp: {
    candidateRole: "proposal",
    featureKeys: ["age", "male", "bmi", "hba1c"],
    hypothesis: "BMI plus glycemia may add a small mortality-risk increment over demographics.",
    hypothesisSource: "literature or mechanistic rationale",
  },
  lab5_lipid_body_no_crp: {
    candidateRole: "proposal",
    featureKeys: ["age", "male", "bmi", "hba1c", "log-triglycerides", "hdl-c"],
    hypothesis: "A compact lab5-compatible lipid/glycemia/body candidate may transport better than broader lipid panels.",
    hypothesisSource: "robustness stress test",
  },
  extended_lipids_body_no_crp: {
    candidateRole: "proposal",
    featureKeys: ["age", "male", "bmi", "total-cholesterol", "log-triglycerides", "hdl-c", "ldl-c"],
    hypothesis: "Extended lipid detail may improve discrimination but should be checked against simpler lab5-compatible features.",
    hypothesisSource: "robustness stress test",
  },
  clinical_core_labs_no_albumin_no_crp: {
    candidateRole: "proposal",
    featureKeys: [
      "age",
      "male",
      "bmi",
      "hba1c",
      "total-cholesterol",
      "log-triglycerides",
      "hdl-c",
      "ldl-c",
    ],
    hypothesis: "No-albumin/no-CRP clinical-core candidate combines glycemia, body, and lipid features.",
    hypothesisSource: "train/calibration diagnostic",
  },
} as const;

type ModelCandidateDefinition = typeof MODEL_CANDIDATE_DEFINITIONS[keyof typeof MODEL_CANDIDATE_DEFINITIONS];
type ModelCandidateHypothesisSource = ModelCandidateDefinition["hypothesisSource"];

const LAMBDAS = [0, 0.0001, 0.001, 0.01, 0.1, 1] as const;

const REQUIRED_FALSE_BOUNDARY_FLAGS = new Set([
  "codebookTextStored",
  "coefficientsStored",
  "participantIdentifiersStored",
  "participantIdentifiersWritten",
  "promotionAuthorized",
  "predictionsStored",
  "rowValuesStored",
  "sourceBodiesStored",
  "splitMembershipStored",
  "testSelectionAuthorized",
]);

const FORBIDDEN_AGGREGATE_EGRESS_KEYS = new Set([
  "caseid",
  "coefficients",
  "codebooktext",
  "ids",
  "m2id",
  "mrid",
  "participantids",
  "participantidentifiers",
  "predictionbyid",
  "predictions",
  "rawrows",
  "rowrecords",
  "rowvalues",
  "selectedpointids",
  "sourcetext",
  "splitids",
  "splitmembership",
]);

export interface Midus2LocalBenchmarkOptions {
  createdAt?: string;
  downloadsDir?: string;
  outputDir?: string;
}

export interface Midus2AggregateMetricSummary {
  auc: number | null;
  brier: number;
  events: number;
  logLoss: number;
  meanPrediction: number;
  n: number;
  observedRate: number;
}

export interface Midus2LocalBenchmarkOutput {
  benchmarkId: "midus2-biomarker-10y-complete-window-local-0";
  candidateBatch: {
    batchId: "midus2-first-no-crp-candidate-batch";
    candidateCount: number;
    exposureLabel: "diagnostic-only";
    hypothesisSources: ModelCandidateHypothesisSource[];
    promotionAuthorized: false;
    testSelectionAuthorized: false;
  };
  codebookTextStored: false;
  createdAt: string;
  dataShape: {
    eligibleRows: number;
    events: number;
    splitCounts: Record<"calibration" | "test" | "train", { events: number; n: number }>;
  };
  endpoint: "10-year all-cause mortality, MIDUS 2 complete-window baseline years";
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
    splitMetrics: Record<"calibration" | "test" | "train", Midus2AggregateMetricSummary>;
  }>;
  participantIdentifiersStored: false;
  participantIdentifiersWritten: false;
  predictionsStored: false;
  coefficientsStored: false;
  rowValuesStored: false;
  schemaVersion: typeof MIDUS2_LOCAL_BENCHMARK_SCHEMA_VERSION;
  sourceBodiesStored: false;
  splitMembershipStored: false;
  status: "research-local-aggregate-only";
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

export async function runMidus2LocalBenchmark(
  options: Midus2LocalBenchmarkOptions = {},
): Promise<{ output: Midus2LocalBenchmarkOutput; outputPath: string }> {
  const downloadsDir = options.downloadsDir ?? path.join(os.homedir(), "Downloads");
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const rows = await buildBenchmarkRows(downloadsDir);

  const models = Object.fromEntries(
    Object.entries(MODEL_CANDIDATE_DEFINITIONS).map(([modelId, candidate]) => {
      const trained = selectModel(rows, [...candidate.featureKeys]);
      return [modelId, summarizeModel(rows, trained, candidate)];
    }),
  );

  const output: Midus2LocalBenchmarkOutput = {
    benchmarkId: "midus2-biomarker-10y-complete-window-local-0",
    candidateBatch: {
      batchId: "midus2-first-no-crp-candidate-batch",
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
      splitCounts: splitCounts(rows),
    },
    endpoint: "10-year all-cause mortality, MIDUS 2 complete-window baseline years",
    modelScoringPerformed: true,
    models,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    rowValuesStored: false,
    schemaVersion: MIDUS2_LOCAL_BENCHMARK_SCHEMA_VERSION,
    sourceBodiesStored: false,
    splitMembershipStored: false,
    status: "research-local-aggregate-only",
  };

  const forbiddenFindings = findForbiddenAggregateEgress(output);
  if (forbiddenFindings.length > 0) {
    throw new Error(`MIDUS 2 aggregate output failed egress validation: ${forbiddenFindings.join("; ")}`);
  }

  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "midus2-local-benchmark.latest.json");
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

export function findForbiddenAggregateEgress(value: unknown): string[] {
  const findings: string[] = [];

  function visit(node: unknown, pathParts: string[]): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, [...pathParts, String(index)]));
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      const normalized = key.trim().toLowerCase();
      const childPath = [...pathParts, key].join(".");
      if (FORBIDDEN_AGGREGATE_EGRESS_KEYS.has(normalized)) {
        findings.push(`forbidden key ${childPath}`);
      }
      if (REQUIRED_FALSE_BOUNDARY_FLAGS.has(key) && child !== false) {
        findings.push(`boundary flag ${childPath} must be false`);
      }
      visit(child, [...pathParts, key]);
    }
  }

  visit(value, []);
  return findings;
}

async function buildBenchmarkRows(downloadsDir: string): Promise<ParsedRow[]> {
  const surveyRows = await readZippedTsvColumns(
    path.join(downloadsDir, MIDUS2_SURVEY_ZIP),
    MIDUS2_SURVEY_ENTRY,
    ["M2ID", "B1PIDATE_YR"],
  );
  const biomarkerRows = await readZippedTsvColumns(
    path.join(downloadsDir, MIDUS2_BIOMARKER_ZIP),
    MIDUS2_BIOMARKER_ENTRY,
    ["M2ID", ...FEATURE_DEFINITIONS.map((feature) => feature.column)],
  );
  const mortalityRows = await readZippedTsvColumns(
    path.join(downloadsDir, MIDUS2_MORTALITY_ZIP),
    MIDUS2_MORTALITY_ENTRY,
    ["M2ID", "DOD_Y"],
  );

  const surveyById = new Map(surveyRows.filter((row) => row.M2ID).map((row) => [row.M2ID, row]));
  const mortalityById = new Map(mortalityRows.filter((row) => row.M2ID).map((row) => [row.M2ID, row]));
  const rows: ParsedRow[] = [];
  for (const biomarkerRow of biomarkerRows) {
    const id = biomarkerRow.M2ID;
    if (!id) continue;
    const surveyRow = surveyById.get(id);
    if (!surveyRow) continue;
    const baselineYear = parseYear(surveyRow.B1PIDATE_YR);
    if (!baselineYear || baselineYear + 10 > 2023) continue;
    const deathYear = parseYear(mortalityById.get(id)?.DOD_Y);
    const values: Record<string, number | null> = {};
    for (const definition of FEATURE_DEFINITIONS) {
      const rawValue = parseMetricValue(biomarkerRow[definition.column]);
      values[definition.key] = rawValue === null ? null : definition.transform(rawValue);
    }
    rows.push({
      split: stableSplit(id),
      values,
      y: deathYear && deathYear - baselineYear > 0 && deathYear - baselineYear <= 10 ? 1 : 0,
    });
  }
  return rows;
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
): Midus2LocalBenchmarkOutput["models"][string] {
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
): Midus2AggregateMetricSummary {
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

function splitCounts(rows: readonly ParsedRow[]): Midus2LocalBenchmarkOutput["dataShape"]["splitCounts"] {
  return Object.fromEntries(
    (["calibration", "test", "train"] as const).map((split) => {
      const splitRows = rows.filter((row) => row.split === split);
      return [split, { events: splitRows.reduce((sum, row) => sum + row.y, 0), n: splitRows.length }];
    }),
  ) as Midus2LocalBenchmarkOutput["dataShape"]["splitCounts"];
}

function stableSplit(id: string): ParsedRow["split"] {
  const hex = createHash("sha256").update(`midus2-bench-0:${id}`).digest("hex").slice(0, 12);
  const value = Number.parseInt(hex, 16) / 0xffffffffffff;
  if (value < 0.6) return "train";
  if (value < 0.8) return "calibration";
  return "test";
}

function parseYear(value: string | undefined): number | null {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 1900 && parsed < 2100 ? parsed : null;
}

function parseMetricValue(value: string | undefined): number | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed >= 999_999) return null;
  return parsed;
}

export function calculateAuc(labels: readonly number[], predictions: readonly number[]): number | null {
  const pairs = labels.map((label, index) => ({ label, prediction: predictions[index]! }))
    .sort((a, b) => a.prediction - b.prediction);
  let rankSum = 0;
  let positives = 0;
  let negatives = 0;
  for (let index = 0; index < pairs.length;) {
    let end = index + 1;
    while (end < pairs.length && pairs[end]!.prediction === pairs[index]!.prediction) {
      end += 1;
    }
    const averageRank = (index + 1 + end) / 2;
    for (let pairIndex = index; pairIndex < end; pairIndex += 1) {
      if (pairs[pairIndex]!.label === 1) {
        rankSum += averageRank;
        positives += 1;
      } else {
        negatives += 1;
      }
    }
    index = end;
  }
  if (!positives || !negatives) return null;
  return (rankSum - positives * (positives + 1) / 2) / (positives * negatives);
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
  const result = await runMidus2LocalBenchmark({
    downloadsDir: process.env.MURPH_AGE_DOWNLOADS_DIR,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  });
  const aggregateSummary = {
    candidateBatch: result.output.candidateBatch,
    dataShape: result.output.dataShape,
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
