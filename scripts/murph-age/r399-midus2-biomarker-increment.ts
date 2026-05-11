import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

import {
  calculateMurphAge,
  METRIC_POINT_SCHEMA_VERSION,
  parseMurphAgeLocalModelCardArtifact,
  validateMurphAgeRiskModel,
  type MetricPoint,
  type MurphAgeIncrementEvaluationCard,
  type MurphAgeRiskModel,
  type MurphAgeSex,
} from "@murphai/health-metrics";

import { calculateAuc, findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R399_LOCAL_MODEL_CARD_FILENAME,
  R399_RESEARCH_CARD_ID,
} from "./r399-local-model-card.ts";

export const R399_MIDUS2_BIOMARKER_INCREMENT_SCHEMA_VERSION =
  "murph-age-r399-midus2-biomarker-increment.v1" as const;
const INCREMENT_EVALUATION_CARD_SCHEMA_VERSION = "murph.age.increment-evaluation-card.v1" as const;

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
const DEFAULT_R399_MODEL_CARD_PATH = path.join(
  ".runtime",
  "operations",
  "murph-age",
  "model-cards",
  R399_LOCAL_MODEL_CARD_FILENAME,
);
const OUTPUT_FILE_NAME = "r399-midus2-biomarker-increment.latest.json";

const R399_PROXY_FEATURE_KEYS = [
  "bmi",
  "self-rated-health",
  "hypertension-history-proxy-yes",
  "diabetes-history-proxy-yes",
  "smoking-status-proxy",
  "physical-activity-proxy",
] as const;

const BIOMARKER_FEATURE_DEFINITIONS = [
  { column: "B4BHA1C", key: "hba1c", transform: (value: number) => value },
  { column: "B4BTRIGL", key: "log-triglycerides", transform: (value: number) => value > 0 ? Math.log(value) : null },
  { column: "B4BHDL", key: "hdl-c", transform: (value: number) => value },
] as const;

const MODEL_CANDIDATE_DEFINITIONS = {
  age_sex_reference: {
    candidateRole: "reference",
    featureKeys: ["age", "female"],
    hypothesis: "Age and sex reference model on the same MIDUS 2 denominator.",
    hypothesisSource: "literature or mechanistic rationale",
  },
  r399_anchor_recalibrated: {
    candidateRole: "base_anchor",
    featureKeys: ["r399-logit"],
    hypothesis: "Frozen R399 transported to MIDUS with train-only intercept/slope recalibration.",
    hypothesisSource: "external-source feasibility need",
  },
  r399_plus_lab3_increment: {
    candidateRole: "proposal",
    featureKeys: ["r399-logit", "hba1c", "log-triglycerides", "hdl-c"],
    hypothesis: "Compact MIDUS glycemia/lipid biomarkers may add stable residual signal over the R399 proxy anchor.",
    hypothesisSource: "train/calibration diagnostic",
  },
  r399_plus_lab3_bmi_increment: {
    candidateRole: "proposal",
    featureKeys: ["r399-logit", "bmi", "hba1c", "log-triglycerides", "hdl-c"],
    hypothesis: "Re-estimating BMI alongside MIDUS biomarkers checks whether body-size transport changes the R399 residual increment.",
    hypothesisSource: "robustness stress test",
  },
  lab3_age_sex_reference: {
    candidateRole: "reference",
    featureKeys: ["age", "female", "bmi", "hba1c", "log-triglycerides", "hdl-c"],
    hypothesis: "Non-layered compact lab reference for judging whether R399 should remain the spine.",
    hypothesisSource: "robustness stress test",
  },
} as const;

const LAMBDAS = [0, 0.0001, 0.001, 0.01, 0.1, 1] as const;

export interface R399Midus2BiomarkerIncrementOptions {
  createdAt?: string;
  downloadsDir?: string;
  outputDir?: string;
  r399ModelCardPath?: string;
}

export interface R399Midus2AggregateMetricSummary {
  auc: number | null;
  brier: number;
  events: number;
  logLoss: number;
  meanPrediction: number;
  n: number;
  observedRate: number;
}

export interface R399Midus2BiomarkerIncrementOutput {
  anchor: {
    cardId: typeof R399_RESEARCH_CARD_ID;
    coefficientsStored: false;
    featureCount: number;
    localArtifactPathStored: false;
    modelId: string;
    modelParametersStored: false;
    predictionsStored: false;
  };
  benchmarkId: "r399-midus2-biomarker-increment-local-0";
  candidateBatch: {
    batchId: "r399-midus2-first-biomarker-increment-batch";
    candidateCount: number;
    exposureLabel: "diagnostic-only";
    hypothesisSources: Array<ModelCandidateDefinition["hypothesisSource"]>;
    promotionAuthorized: false;
    testSelectionAuthorized: false;
  };
  codebookTextStored: false;
  coefficientsStored: false;
  createdAt: string;
  dataShape: {
    eligibleRows: number;
    events: number;
    r399ProxyFeatureObservedCounts: Record<typeof R399_PROXY_FEATURE_KEYS[number], number>;
    splitCounts: Record<"calibration" | "test" | "train", { events: number; n: number }>;
  };
  endpoint: "10-year all-cause mortality, MIDUS 2 complete-window baseline years";
  incrementEvaluationCard: MurphAgeIncrementEvaluationCard;
  modelScoringPerformed: true;
  models: Record<string, {
    anchorCardId: typeof R399_RESEARCH_CARD_ID | null;
    candidateRole: "base_anchor" | "proposal" | "reference";
    coefficientsStored: false;
    featureKeys: string[];
    featureObservedCounts: Record<string, number>;
    hypothesis: string;
    hypothesisSource: ModelCandidateDefinition["hypothesisSource"];
    predictionsStored: false;
    selectedLambda: number;
    splitMetrics: Record<"calibration" | "test" | "train", R399Midus2AggregateMetricSummary>;
  }>;
  participantIdentifiersStored: false;
  participantIdentifiersWritten: false;
  predictionsStored: false;
  rowValuesStored: false;
  schemaVersion: typeof R399_MIDUS2_BIOMARKER_INCREMENT_SCHEMA_VERSION;
  sourceBodiesStored: false;
  splitMembershipStored: false;
  status: "research-local-aggregate-only";
}

type ModelCandidateDefinition = typeof MODEL_CANDIDATE_DEFINITIONS[keyof typeof MODEL_CANDIDATE_DEFINITIONS];
type TsvRow = Record<string, string>;
type Split = "calibration" | "test" | "train";

interface ParsedRow {
  r399Risk: number;
  split: Split;
  values: Record<string, number | null>;
  y: 0 | 1;
}

interface TrainedModel {
  featureKeys: string[];
  lambda: number;
  predict(row: ParsedRow): number;
  stats: Record<string, { mean: number; median: number; observedCount: number; sd: number }>;
}

export async function runR399Midus2BiomarkerIncrement(
  options: R399Midus2BiomarkerIncrementOptions = {},
): Promise<{ output: R399Midus2BiomarkerIncrementOutput; outputPath: string }> {
  const downloadsDir = options.downloadsDir ?? path.join(os.homedir(), "Downloads");
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const r399Model = await readR399ModelCard(options.r399ModelCardPath ?? DEFAULT_R399_MODEL_CARD_PATH);
  const rows = await buildBenchmarkRows({ downloadsDir, r399Model });
  const dataShape: R399Midus2BiomarkerIncrementOutput["dataShape"] = {
    eligibleRows: rows.length,
    events: rows.reduce((sum, row) => sum + row.y, 0),
    r399ProxyFeatureObservedCounts: r399ProxyFeatureObservedCounts(rows),
    splitCounts: splitCounts(rows),
  };

  const models = Object.fromEntries(
    Object.entries(MODEL_CANDIDATE_DEFINITIONS).map(([modelId, candidate]) => {
      const trained = selectModel(rows, [...candidate.featureKeys]);
      return [modelId, summarizeModel(rows, trained, candidate)];
    }),
  ) as R399Midus2BiomarkerIncrementOutput["models"];
  const incrementEvaluationCard = buildIncrementEvaluationCard({ dataShape, models });
  assertIncrementEvaluationCardBoundary(incrementEvaluationCard);

  const output: R399Midus2BiomarkerIncrementOutput = {
    anchor: {
      cardId: R399_RESEARCH_CARD_ID,
      coefficientsStored: false,
      featureCount: r399Model.features.length,
      localArtifactPathStored: false,
      modelId: r399Model.modelId,
      modelParametersStored: false,
      predictionsStored: false,
    },
    benchmarkId: "r399-midus2-biomarker-increment-local-0",
    candidateBatch: {
      batchId: "r399-midus2-first-biomarker-increment-batch",
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
    dataShape,
    endpoint: "10-year all-cause mortality, MIDUS 2 complete-window baseline years",
    incrementEvaluationCard,
    modelScoringPerformed: true,
    models,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    rowValuesStored: false,
    schemaVersion: R399_MIDUS2_BIOMARKER_INCREMENT_SCHEMA_VERSION,
    sourceBodiesStored: false,
    splitMembershipStored: false,
    status: "research-local-aggregate-only",
  };

  const forbiddenFindings = findForbiddenAggregateEgress(output);
  if (forbiddenFindings.length > 0) {
    throw new Error(`R399 MIDUS 2 biomarker increment output failed egress validation: ${forbiddenFindings.join("; ")}`);
  }

  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readR399ModelCard(modelCardPath: string): Promise<MurphAgeRiskModel> {
  const artifact = JSON.parse(await readFile(modelCardPath, "utf8")) as unknown;
  const parsed = parseMurphAgeLocalModelCardArtifact(artifact);
  if (!parsed.value || parsed.warnings.length > 0) {
    throw new Error("R399 local model-card artifact failed schema validation.");
  }
  if (parsed.value.cardId !== R399_RESEARCH_CARD_ID) {
    throw new Error(`Expected R399 local model-card artifact ${R399_RESEARCH_CARD_ID}.`);
  }
  const validation = validateMurphAgeRiskModel(parsed.value.model);
  if (validation.status !== "valid") {
    throw new Error("R399 local model-card model failed validation.");
  }
  return parsed.value.model;
}

async function buildBenchmarkRows(input: {
  downloadsDir: string;
  r399Model: MurphAgeRiskModel;
}): Promise<ParsedRow[]> {
  const surveyRows = await readZippedTsvColumns(
    path.join(input.downloadsDir, MIDUS2_SURVEY_ZIP),
    MIDUS2_SURVEY_ENTRY,
    [
      "M2ID",
      "B1PIDATE_YR",
      "B1PA1",
      "B1PA24",
      "B1PA38A",
      "B1PA39",
      "B1SA11X",
      "B1SA30A",
      "B1SA30B",
      "B1SA30C",
      "B1SA30D",
      "B1SA30E",
      "B1SA30F",
      "B1SA31A",
      "B1SA31B",
      "B1SA31C",
      "B1SA31D",
      "B1SA31E",
      "B1SA31F",
    ],
  );
  const biomarkerRows = await readZippedTsvColumns(
    path.join(input.downloadsDir, MIDUS2_BIOMARKER_ZIP),
    MIDUS2_BIOMARKER_ENTRY,
    [
      "M2ID",
      "B4ZAGE",
      "B1PRSEX",
      "B4PBMI",
      ...BIOMARKER_FEATURE_DEFINITIONS.map((feature) => feature.column),
    ],
  );
  const mortalityRows = await readZippedTsvColumns(
    path.join(input.downloadsDir, MIDUS2_MORTALITY_ZIP),
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
    const age = parseMetricValue(biomarkerRow.B4ZAGE);
    const sex = parseMidusSex(biomarkerRow.B1PRSEX);
    if (age === null || sex === null) continue;

    const deathYear = parseYear(mortalityById.get(id)?.DOD_Y);
    const values: Record<string, number | null> = {
      age,
      female: sex === "female" ? 1 : 0,
      "r399-logit": null,
      ...buildR399ProxyValues({ biomarkerRow, surveyRow }),
    };
    for (const definition of BIOMARKER_FEATURE_DEFINITIONS) {
      const rawValue = parseMetricValue(biomarkerRow[definition.column]);
      values[definition.key] = rawValue === null ? null : definition.transform(rawValue);
    }

    const r399Risk = scoreR399Risk({
      age,
      r399Model: input.r399Model,
      sex,
      values,
    });
    values["r399-logit"] = logit(r399Risk);
    rows.push({
      r399Risk,
      split: stableSplit(id),
      values,
      y: deathYear && deathYear - baselineYear > 0 && deathYear - baselineYear <= 10 ? 1 : 0,
    });
  }
  return rows;
}

function buildR399ProxyValues(input: {
  biomarkerRow: TsvRow;
  surveyRow: TsvRow;
}): Record<typeof R399_PROXY_FEATURE_KEYS[number], number | null> {
  return {
    bmi: parseMetricValue(input.biomarkerRow.B4PBMI),
    "diabetes-history-proxy-yes": parseYesNo(input.surveyRow.B1SA11X),
    "hypertension-history-proxy-yes": parseYesNo(input.surveyRow.B1PA24),
    "physical-activity-proxy": parsePhysicalActivityProxy(input.surveyRow),
    "self-rated-health": parseLikert(input.surveyRow.B1PA1, { max: 5, min: 1 }),
    "smoking-status-proxy": parseSmokingStatusProxy(input.surveyRow),
  };
}

function scoreR399Risk(input: {
  age: number;
  r399Model: MurphAgeRiskModel;
  sex: MurphAgeSex;
  values: Record<string, number | null>;
}): number {
  const result = calculateMurphAge({
    asOf: "2026-05-12T00:00:00.000Z",
    chronologicalAgeYears: input.age,
    model: input.r399Model,
    points: R399_PROXY_FEATURE_KEYS
      .map((metricKey) => {
        const value = input.values[metricKey];
        return value === null ? null : metricPoint(metricKey, value);
      })
      .filter((point): point is MetricPoint => point !== null),
    sex: input.sex,
  });
  if (result.status !== "ready" || !result.risk) {
    throw new Error("R399 anchor failed to score a MIDUS row.");
  }
  return result.risk.probability;
}

function selectModel(rows: readonly ParsedRow[], featureKeys: string[]): TrainedModel {
  const candidates = LAMBDAS.map((lambda) => {
    const model = trainLogistic(rows, featureKeys, lambda);
    return {
      calibrationLogLoss: aggregateMetrics(rows, model.predict, "calibration").logLoss,
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

function prepareFeatureMatrix(
  rows: readonly ParsedRow[],
  featureKeys: readonly string[],
): {
  stats: Record<string, { mean: number; median: number; observedCount: number; sd: number }>;
  vectorForRow(row: ParsedRow): number[];
} {
  const trainRows = rows.filter((row) => row.split === "train");
  const stats = Object.fromEntries(featureKeys.map((featureKey) => {
    const observed = trainRows
      .map((row) => row.values[featureKey])
      .filter((value): value is number => value !== null && Number.isFinite(value))
      .sort((left, right) => left - right);
    const median = percentile(observed, 0.5);
    const mean = observed.reduce((sum, value) => sum + value, 0) / Math.max(1, observed.length);
    const variance = observed.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / Math.max(1, observed.length);
    return [featureKey, {
      mean: Number.isFinite(mean) ? mean : 0,
      median: Number.isFinite(median) ? median : 0,
      observedCount: observed.length,
      sd: Math.max(Math.sqrt(variance), 1e-6),
    }];
  }));

  return {
    stats,
    vectorForRow(row) {
      return [
        1,
        ...featureKeys.map((featureKey) => {
          const stat = stats[featureKey]!;
          const rawValue = row.values[featureKey];
          const value = rawValue !== null && Number.isFinite(rawValue) ? rawValue : stat.median;
          return (value - stat.mean) / stat.sd;
        }),
      ];
    },
  };
}

function summarizeModel(
  rows: readonly ParsedRow[],
  model: TrainedModel,
  candidate: ModelCandidateDefinition,
): R399Midus2BiomarkerIncrementOutput["models"][string] {
  return {
    anchorCardId: candidate.featureKeys.some((featureKey) => featureKey === "r399-logit")
      ? R399_RESEARCH_CARD_ID
      : null,
    candidateRole: candidate.candidateRole,
    coefficientsStored: false,
    featureKeys: [...candidate.featureKeys],
    featureObservedCounts: featureObservedCounts(rows, candidate.featureKeys),
    hypothesis: candidate.hypothesis,
    hypothesisSource: candidate.hypothesisSource,
    predictionsStored: false,
    selectedLambda: model.lambda,
    splitMetrics: {
      calibration: aggregateMetrics(rows, model.predict, "calibration"),
      test: aggregateMetrics(rows, model.predict, "test"),
      train: aggregateMetrics(rows, model.predict, "train"),
    },
  };
}

function buildIncrementEvaluationCard(input: {
  dataShape: R399Midus2BiomarkerIncrementOutput["dataShape"];
  models: R399Midus2BiomarkerIncrementOutput["models"];
}): MurphAgeIncrementEvaluationCard {
  const anchorMetrics = input.models.r399_anchor_recalibrated?.splitMetrics.test;
  const candidateMetrics = input.models.r399_plus_lab3_bmi_increment?.splitMetrics.test;
  if (!anchorMetrics || !candidateMetrics) {
    throw new Error("R399 MIDUS 2 biomarker increment card requires anchor and candidate test metrics.");
  }
  const testSplit = input.dataShape.splitCounts.test;
  return {
    anchorCardId: R399_RESEARCH_CARD_ID,
    candidateBatchId: "r399-midus2-first-biomarker-increment-batch",
    candidateId: "r399-plus-lab3-bmi-increment",
    evaluation: {
      aggregateMetricDeltas: {
        aucDelta: nullableMetricDelta(candidateMetrics.auc, anchorMetrics.auc),
        brierDelta: roundMetric(candidateMetrics.brier - anchorMetrics.brier),
        logLossDelta: roundMetric(candidateMetrics.logLoss - anchorMetrics.logLoss),
      },
      aggregateSample: {
        evaluatedRowCount: testSplit.n,
        eventCount: testSplit.events,
        minimumCellCount: Math.min(testSplit.events, Math.max(0, testSplit.n - testSplit.events)),
        suppressedCellCount: 0,
      },
      anchorMetrics,
      candidateMetrics,
      comparator: "anchor-vs-anchor-plus-increment",
      evidenceTier: "internal-diagnostic",
      sameDenominator: true,
    },
    flatteningAuthorized: false,
    layer: "biomarker-increment",
    outputBoundary: {
      aggregateOnly: true,
      coefficientsExportAllowed: false,
      localArtifactPathExportAllowed: false,
      modelParametersExportAllowed: false,
      participantIdentifiersExportAllowed: false,
      participantLevelExportAllowed: false,
      predictionsExportAllowed: false,
      productDisplayExportAllowed: false,
      rowValuesExportAllowed: false,
      sourceTextExportAllowed: false,
      splitMembershipExportAllowed: false,
    },
    productAuthorized: false,
    riskEffect: "aggregate-estimated",
    schemaVersion: INCREMENT_EVALUATION_CARD_SCHEMA_VERSION,
    scoreBearing: false,
    scoreContributionAuthorized: false,
    sourceRouteId: "midus-biomarker-mortality",
  };
}

function assertIncrementEvaluationCardBoundary(card: MurphAgeIncrementEvaluationCard): void {
  const boundary = card.outputBoundary;
  if (
    card.productAuthorized !== false
    || card.scoreBearing !== false
    || card.scoreContributionAuthorized !== false
    || card.flatteningAuthorized !== false
    || card.evaluation.sameDenominator !== true
    || boundary.aggregateOnly !== true
    || boundary.coefficientsExportAllowed !== false
    || boundary.localArtifactPathExportAllowed !== false
    || boundary.modelParametersExportAllowed !== false
    || boundary.participantIdentifiersExportAllowed !== false
    || boundary.participantLevelExportAllowed !== false
    || boundary.predictionsExportAllowed !== false
    || boundary.productDisplayExportAllowed !== false
    || boundary.rowValuesExportAllowed !== false
    || boundary.sourceTextExportAllowed !== false
    || boundary.splitMembershipExportAllowed !== false
  ) {
    throw new Error("R399 MIDUS 2 biomarker increment card must remain aggregate-only and research-only.");
  }
}

function aggregateMetrics(
  rows: readonly ParsedRow[],
  predict: (row: ParsedRow) => number,
  split: Split,
): R399Midus2AggregateMetricSummary {
  const splitRows = rows.filter((row) => row.split === split);
  const predictions = splitRows.map((row) => clampProbability(predict(row)));
  const outcomes = splitRows.map((row) => row.y);
  const n = splitRows.length;
  const events = outcomes.reduce<number>((sum, value) => sum + value, 0);
  return {
    auc: calculateAuc(outcomes, predictions),
    brier: roundMetric(predictions.reduce((sum, prediction, index) =>
      sum + ((prediction - outcomes[index]!) ** 2), 0) / Math.max(1, n)),
    events,
    logLoss: roundMetric(predictions.reduce((sum, prediction, index) => {
      const y = outcomes[index]!;
      return sum - (y * Math.log(prediction) + (1 - y) * Math.log(1 - prediction));
    }, 0) / Math.max(1, n)),
    meanPrediction: roundMetric(predictions.reduce((sum, value) => sum + value, 0) / Math.max(1, n)),
    n,
    observedRate: roundMetric(events / Math.max(1, n)),
  };
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
      const missingColumns = Object.entries(indexes)
        .filter(([, index]) => index < 0)
        .map(([column]) => column);
      if (missingColumns.length > 0) {
        throw new Error(`Missing expected TSV columns: ${missingColumns.join(", ")}`);
      }
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

function metricPoint(metricKey: string, value: number): MetricPoint {
  const unit = metricKey === "bmi" ? "kg/m^2" : null;
  return {
    biomarkerKey: null,
    canonicalUnit: unit,
    canonicalValue: value,
    comparator: null,
    confidence: "medium",
    context: {
      aggregationWindow: null,
      deviceModel: null,
      labName: null,
      method: null,
      notes: [],
      provider: null,
      rawRefs: [],
      sourceLabel: "MIDUS 2 local research adapter",
    },
    effectiveDate: "2026-05-12",
    grain: "instant",
    id: `metric-point:${metricKey}:midus2-local-research`,
    metricKey,
    observedAt: "2026-05-12T00:00:00.000Z",
    provenance: {
      dataOrigin: null,
      externalRef: null,
      labName: null,
      provider: null,
      rawRefs: [],
      sourceLabel: "MIDUS 2 local research adapter",
    },
    recordedAt: null,
    reportedAt: null,
    schemaVersion: METRIC_POINT_SCHEMA_VERSION,
    source: {
      family: "derived",
      kind: metricKey === "bmi" ? "measurement" : "survey-response",
      path: "local://midus2-r399-adapter",
      recordId: "midus2-local-research-row",
      resultIndex: null,
    },
    statistic: "value",
    textValue: null,
    unit,
    value,
  };
}

function parseMidusSex(value: string | undefined): MurphAgeSex | null {
  const parsed = parseMetricValue(value);
  if (parsed === 1) return "male";
  if (parsed === 2) return "female";
  return null;
}

function parseYear(value: string | undefined): number | null {
  const parsed = parseMetricValue(value);
  if (parsed === null) return null;
  const rounded = Math.trunc(parsed);
  return rounded >= 1900 && rounded <= 2100 ? rounded : null;
}

function parseMetricValue(value: string | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === ".") return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0 || parsed >= 90_000) return null;
  return parsed;
}

function parseLikert(value: string | undefined, input: { max: number; min: number }): number | null {
  const parsed = parseMetricValue(value);
  return parsed !== null && parsed >= input.min && parsed <= input.max ? parsed : null;
}

function parseYesNo(value: string | undefined): 0 | 1 | null {
  const parsed = parseMetricValue(value);
  if (parsed === 1) return 1;
  if (parsed === 2) return 0;
  return null;
}

function parseSmokingStatusProxy(row: TsvRow): number | null {
  const everRegular = parseYesNo(row.B1PA38A);
  const nowRegular = parseYesNo(row.B1PA39);
  if (everRegular === 0) return 0;
  if (everRegular === 1 && nowRegular === 0) return 1;
  if (everRegular === 1 && nowRegular === 1) return 2;
  return null;
}

function parsePhysicalActivityProxy(row: TsvRow): number | null {
  const vigorousKeys = ["B1SA30A", "B1SA30B", "B1SA30C", "B1SA30D", "B1SA30E", "B1SA30F"] as const;
  const moderateKeys = ["B1SA31A", "B1SA31B", "B1SA31C", "B1SA31D", "B1SA31E", "B1SA31F"] as const;
  const values: number[] = [];
  for (const key of vigorousKeys) {
    const parsed = parseActivityFrequency(row[key]);
    if (parsed !== null) values.push(parsed * 2);
  }
  for (const key of moderateKeys) {
    const parsed = parseActivityFrequency(row[key]);
    if (parsed !== null) values.push(parsed);
  }
  if (values.length === 0) return null;
  return (values.reduce((sum, value) => sum + value, 0) / values.length) * 20;
}

function parseActivityFrequency(value: string | undefined): number | null {
  const parsed = parseMetricValue(value);
  if (parsed === null || parsed < 1 || parsed > 6) return null;
  return 6 - parsed;
}

function stableSplit(id: string): Split {
  const digest = createHash("sha256").update(`r399-midus2-increment-v0:${id}`).digest();
  const bucket = digest.readUInt32BE(0) / 0xffffffff;
  if (bucket < 0.6) return "train";
  if (bucket < 0.8) return "calibration";
  return "test";
}

function splitCounts(rows: readonly ParsedRow[]): Record<Split, { events: number; n: number }> {
  return {
    calibration: summarizeSplit(rows, "calibration"),
    test: summarizeSplit(rows, "test"),
    train: summarizeSplit(rows, "train"),
  };
}

function summarizeSplit(rows: readonly ParsedRow[], split: Split): { events: number; n: number } {
  const splitRows = rows.filter((row) => row.split === split);
  return {
    events: splitRows.reduce((sum, row) => sum + row.y, 0),
    n: splitRows.length,
  };
}

function r399ProxyFeatureObservedCounts(
  rows: readonly ParsedRow[],
): Record<typeof R399_PROXY_FEATURE_KEYS[number], number> {
  return featureObservedCounts(rows, R399_PROXY_FEATURE_KEYS) as Record<typeof R399_PROXY_FEATURE_KEYS[number], number>;
}

function featureObservedCounts(rows: readonly ParsedRow[], featureKeys: readonly string[]): Record<string, number> {
  return Object.fromEntries(featureKeys.map((featureKey) => [
    featureKey,
    rows.reduce((count, row) => {
      const value = row.values[featureKey];
      return count + (value !== null && Number.isFinite(value) ? 1 : 0);
    }, 0),
  ]));
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * fraction)));
  return values[index]!;
}

function dot(left: readonly number[], right: readonly number[]): number {
  return left.reduce((sum, value, index) => sum + value * right[index]!, 0);
}

function sigmoid(value: number): number {
  if (value < -35) return 1e-15;
  if (value > 35) return 1 - 1e-15;
  return 1 / (1 + Math.exp(-value));
}

function logit(value: number): number {
  const probability = clampProbability(value);
  return Math.log(probability / (1 - probability));
}

function clampProbability(value: number): number {
  return Math.min(1 - 1e-12, Math.max(1e-12, value));
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}

function nullableMetricDelta(candidate: number | null, anchor: number | null): number | undefined {
  if (candidate === null || anchor === null) return undefined;
  return roundMetric(candidate - anchor);
}

async function main(): Promise<void> {
  const { output } = await runR399Midus2BiomarkerIncrement({
    downloadsDir: process.env.MURPH_AGE_DOWNLOADS_DIR,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r399ModelCardPath: process.env.MURPH_AGE_R399_MODEL_CARD_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    anchor: {
      cardId: output.anchor.cardId,
      featureCount: output.anchor.featureCount,
      modelId: output.anchor.modelId,
    },
    artifact: OUTPUT_FILE_NAME,
    benchmarkId: output.benchmarkId,
    candidateBatch: output.candidateBatch,
    dataShape: output.dataShape,
    modelIds: Object.keys(output.models),
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
