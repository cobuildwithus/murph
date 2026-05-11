import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

import {
  calculateAuc,
  findForbiddenAggregateEgress,
  runMidus2LocalBenchmark,
} from "./midus2-local-benchmark.ts";

export const MIDUS2_CRELES_TRANSPORT_BENCHMARK_SCHEMA_VERSION =
  "murph-age-midus2-creles-transport-benchmark.v1" as const;

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
const DEFAULT_MODEL_CARD_OUTPUT_DIR = path.join(".runtime", "operations", "murph-age", "model-cards");
const MINIMUM_CELL_THRESHOLD = 10;

const CRELES_SOURCE_FEATURE_DEFINITIONS = [
  { column: "AGE", key: "age", source: "recoded", transform: (value: number) => value },
  { column: "SEX", key: "male", source: "recoded", transform: (value: number) => value === 1 ? 1 : value === 2 ? 0 : null },
  { column: "IMC", key: "bmi", source: "biomarker", transform: (value: number) => value },
  { column: "HBAC1", key: "hba1c", source: "biomarker", transform: (value: number) => value },
  { column: "TGS", key: "triglycerides", source: "biomarker", transform: (value: number) => value > 0 ? value : null },
  { column: "HDL", key: "hdl-c", source: "biomarker", transform: (value: number) => value },
] as const;

const TRANSPORT_BENCHMARK_CARD = {
  abstentionCriteria: [
    "Required MIDUS 2 source model-card artifact cannot be generated locally.",
    "Required CRELES Wave 1 recoded, Wave 1 biomarker, or Wave 3 follow-up files are unavailable.",
    "CRELES complete-case denominator lacks outcome variation or falls below the aggregate cell threshold.",
    "The source model requires features outside the CRELES complete-case mapped lab5 feature set.",
    "A candidate requires CRP, hsCRP, exact death dates, source text, participant-level export, or product promotion.",
  ],
  allowedArtifactBoundary: [
    "aggregate counts",
    "aggregate split metrics",
    "benchmark-card metadata",
    "source model metadata",
    "validation statuses",
  ],
  allowedMetrics: ["auc", "brier", "logLoss", "meanPrediction", "observedRate"],
  benchmarkCardId: "midus2-lab5-creles-transport-card-0",
  evidenceClassLabel: "cross-cohort transport diagnostic",
  exposureLabel: "diagnostic-only",
  minimumCellThreshold: MINIMUM_CELL_THRESHOLD,
  schemaVersion: "murph-age-benchmark-card.v1",
  sourceCohort: "MIDUS 2 biomarker 10-year all-cause mortality local benchmark",
  sourceEndpoint: "10-year all-cause mortality, MIDUS 2 complete-window baseline years",
  sourceFeatureMappingPolicy: {
    allowedFeatureFamilies: ["demographics", "body", "glycemia", "lipids"],
    blockedFeatureFamilies: ["crp", "hs-crp", "inflammation-assay-family"],
  },
  targetCohort: "CRELES Wave 1 biomarker baseline with Wave 3 known-status endpoint",
  targetEndpoint: "death by CRELES wave 3 among participants with known wave-3 status",
  targetMissingnessPolicy: "Complete-case scoring for the MIDUS source-model feature set; no row-level missingness diagnostics leave local memory.",
  targetSplitPolicy: "Deterministic calibration/test split from a CRELES transport salt and participant id; split membership is never exported.",
  transportStressMatrix: {
    ageRange: "MIDUS midlife/older adult source scored on older-adult CRELES target",
    cohortEra: "MIDUS 2 2000s source to CRELES 2000s target",
    endpointAscertainment: "MIDUS exact-year mortality window to CRELES wave-status endpoint",
    featureOverlap: "age, sex, BMI, HbA1c, triglycerides, and HDL-C",
    followupWindow: "not identical; target analysis is a transport stress test, not product calibration evidence",
    geography: "United States source to Costa Rica target",
    measurementPipeline: "ICPSR MIDUS biomarker source model-card export scored on CRELES household and blood biomarker files",
  },
} as const;

type CrelesFeatureDefinition = typeof CRELES_SOURCE_FEATURE_DEFINITIONS[number];
type CrelesFeatureSource = CrelesFeatureDefinition["source"];
type TransportSplit = "calibration" | "test";
type TsvRow = Record<string, string>;

export interface Midus2CrelesTransportBenchmarkOptions {
  createdAt?: string;
  downloadsDir?: string;
  midusOutputDir?: string;
  modelCardOutputDir?: string;
  outputDir?: string;
}

export interface Midus2CrelesAggregateMetricSummary {
  auc: number | null;
  brier: number;
  events: number;
  logLoss: number;
  meanPrediction: number;
  n: number;
  observedRate: number;
}

export interface Midus2CrelesTransportBenchmarkOutput {
  benchmarkCard: typeof TRANSPORT_BENCHMARK_CARD;
  benchmarkId: "midus2-lab5-to-creles-wave3-transport-local-0";
  calibrationParametersStored: false;
  codebookTextStored: false;
  coefficientsStored: false;
  createdAt: string;
  endpointComparison: {
    mismatchPolicy: "transport-stress-only";
    productPromotionAuthorized: false;
    sourceEndpoint: typeof TRANSPORT_BENCHMARK_CARD.sourceEndpoint;
    targetEndpoint: typeof TRANSPORT_BENCHMARK_CARD.targetEndpoint;
  };
  modelScoringPerformed: true;
  participantIdentifiersStored: false;
  participantIdentifiersWritten: false;
  predictionsStored: false;
  rowValuesStored: false;
  schemaVersion: typeof MIDUS2_CRELES_TRANSPORT_BENCHMARK_SCHEMA_VERSION;
  sourceBodiesStored: false;
  sourceModel: {
    cardId: TransportModelCardArtifact["cardId"];
    coefficientsStored: false;
    endpoint: string;
    featureKeys: string[];
    horizonYears: number;
    localArtifactPathStored: false;
    modelId: string;
    modelParametersStored: false;
    modelVersion: string | null;
    referencePopulation: string;
  };
  splitMembershipStored: false;
  status: "research-local-aggregate-only";
  targetDataShape: {
    completeCaseRows: number;
    events: number;
    excludedFollowupRows: number;
    knownStatusRows: number;
    missingFeatureExcludedRows: number;
    splitCounts: Record<TransportSplit, { events: number; n: number }>;
  };
  transportModels: Record<string, {
    calibrationParametersStored: false;
    calibrationPolicy: "none" | "creles-calibration-intercept-slope" | "creles-calibration-age-sex-reference";
    candidateRole: "source_model" | "target_calibrated_source_model" | "target_reference";
    coefficientsStored: false;
    featureKeys: string[];
    predictionsStored: false;
    splitMetrics: Record<TransportSplit, Midus2CrelesAggregateMetricSummary>;
  }>;
}

interface BenchmarkRowsResult {
  excludedFollowupRows: number;
  knownStatusRows: number;
  rows: TransportRow[];
}

interface TransportRow {
  split: TransportSplit;
  values: Record<string, number>;
  y: 0 | 1;
}

interface TransportModelFeatureBase {
  coefficient: number;
  key: string;
  kind: "chronological-age" | "metric" | "sex";
  label: string;
  moduleId: string;
  transform?: { kind: "identity" | "ln" };
}

interface TransportChronologicalAgeFeature extends TransportModelFeatureBase {
  kind: "chronological-age";
}

interface TransportSexFeature extends TransportModelFeatureBase {
  kind: "sex";
  sex: "female" | "male";
}

interface TransportMetricFeature extends TransportModelFeatureBase {
  expectedUnit?: string;
  kind: "metric";
  metricKey: string;
}

type TransportModelFeature =
  | TransportChronologicalAgeFeature
  | TransportMetricFeature
  | TransportSexFeature;

interface TransportRiskModel {
  blockedBiomarkerKeys?: readonly string[];
  blockedMetricKeys?: readonly string[];
  calibration?: {
    intercept: number;
    slope: number;
  };
  endpoint: string;
  features: readonly TransportModelFeature[];
  horizonYears: number;
  intercept: number;
  modelId: string;
  modelVersion?: string;
  referencePopulation: string;
  referenceRiskCurve: readonly { ageYears: number; riskProbability: number }[];
}

interface TransportModelCardArtifact {
  cardId: "lab5_bp_bmi_transport_research";
  model: TransportRiskModel;
  schemaVersion: "murph.age.model-card-artifact.v1";
}

interface TargetReferenceModel {
  featureKeys: readonly ["age", "male"];
  predict(row: TransportRow): number;
}

interface ScoreModel {
  predict(row: TransportRow): number;
}

export async function runMidus2CrelesTransportBenchmark(
  options: Midus2CrelesTransportBenchmarkOptions = {},
): Promise<{ output: Midus2CrelesTransportBenchmarkOutput; outputPath: string }> {
  const downloadsDir = options.downloadsDir ?? path.join(os.homedir(), "Downloads");
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  const modelCardOutputDir = options.modelCardOutputDir ?? DEFAULT_MODEL_CARD_OUTPUT_DIR;
  const midusOutputDir = options.midusOutputDir ?? DEFAULT_OUTPUT_DIR;

  const sourceRun = await runMidus2LocalBenchmark({
    createdAt: options.createdAt,
    downloadsDir,
    modelCardOutputDir,
    outputDir: midusOutputDir,
    writeLocalModelCard: true,
  });
  if (!sourceRun.localModelCardArtifactPath) {
    throw new Error("MIDUS 2 source model-card artifact was not produced.");
  }
  const sourceArtifact = await readLocalModelCardArtifact(sourceRun.localModelCardArtifactPath);
  const sourceFeatureKeys = sourceArtifact.model.features.map(publicFeatureKey);
  assertSourceModelUsableForTransport(sourceArtifact.model, sourceFeatureKeys);

  const rowsResult = await buildTransportRows(downloadsDir, sourceFeatureKeys);
  assertMinimumAggregateCells(rowsResult.rows);

  const rawSourceModel: ScoreModel = {
    predict: (row) => sigmoid(scoreRuntimeModelLogit(sourceArtifact.model, row.values)),
  };
  const recalibratedSourceModel = calibrateSourceModelOnTarget(sourceArtifact.model, rowsResult.rows);
  const targetReference = trainTargetAgeSexReference(rowsResult.rows);

  const transportModels: Midus2CrelesTransportBenchmarkOutput["transportModels"] = {
    midus2_lab5_source_raw: summarizeTransportModel(rowsResult.rows, rawSourceModel, {
      calibrationPolicy: "none",
      candidateRole: "source_model",
      featureKeys: sourceFeatureKeys,
    }),
    midus2_lab5_source_creles_recalibrated: summarizeTransportModel(rowsResult.rows, recalibratedSourceModel, {
      calibrationPolicy: "creles-calibration-intercept-slope",
      candidateRole: "target_calibrated_source_model",
      featureKeys: sourceFeatureKeys,
    }),
    creles_age_sex_reference: summarizeTransportModel(rowsResult.rows, targetReference, {
      calibrationPolicy: "creles-calibration-age-sex-reference",
      candidateRole: "target_reference",
      featureKeys: [...targetReference.featureKeys],
    }),
  };

  const output: Midus2CrelesTransportBenchmarkOutput = {
    benchmarkCard: TRANSPORT_BENCHMARK_CARD,
    benchmarkId: "midus2-lab5-to-creles-wave3-transport-local-0",
    calibrationParametersStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    createdAt: options.createdAt ?? new Date().toISOString(),
    endpointComparison: {
      mismatchPolicy: "transport-stress-only",
      productPromotionAuthorized: false,
      sourceEndpoint: TRANSPORT_BENCHMARK_CARD.sourceEndpoint,
      targetEndpoint: TRANSPORT_BENCHMARK_CARD.targetEndpoint,
    },
    modelScoringPerformed: true,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    rowValuesStored: false,
    schemaVersion: MIDUS2_CRELES_TRANSPORT_BENCHMARK_SCHEMA_VERSION,
    sourceBodiesStored: false,
    sourceModel: {
      cardId: sourceArtifact.cardId,
      coefficientsStored: false,
      endpoint: sourceArtifact.model.endpoint,
      featureKeys: sourceFeatureKeys,
      horizonYears: sourceArtifact.model.horizonYears,
      localArtifactPathStored: false,
      modelId: sourceArtifact.model.modelId,
      modelParametersStored: false,
      modelVersion: sourceArtifact.model.modelVersion ?? null,
      referencePopulation: sourceArtifact.model.referencePopulation,
    },
    splitMembershipStored: false,
    status: "research-local-aggregate-only",
    targetDataShape: {
      completeCaseRows: rowsResult.rows.length,
      events: rowsResult.rows.reduce((count, row) => count + row.y, 0),
      excludedFollowupRows: rowsResult.excludedFollowupRows,
      knownStatusRows: rowsResult.knownStatusRows,
      missingFeatureExcludedRows: rowsResult.knownStatusRows - rowsResult.rows.length,
      splitCounts: splitCounts(rowsResult.rows),
    },
    transportModels,
  };

  assertMinimumEmittedCounts(output);
  const forbiddenFindings = findForbiddenAggregateEgress(output);
  if (forbiddenFindings.length > 0) {
    throw new Error(`MIDUS-to-CRELES aggregate output failed egress validation: ${forbiddenFindings.join("; ")}`);
  }

  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "midus2-creles-transport-benchmark.latest.json");
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readLocalModelCardArtifact(modelCardPath: string): Promise<TransportModelCardArtifact> {
  const parsedJson = JSON.parse(await readFile(modelCardPath, "utf8")) as unknown;
  return parseTransportModelCardArtifact(parsedJson);
}

function parseTransportModelCardArtifact(value: unknown): TransportModelCardArtifact {
  const artifact = asPlainRecord(value, "model-card artifact");
  const schemaVersion = requiredLiteral(
    artifact.schemaVersion,
    "murph.age.model-card-artifact.v1",
    "model-card schemaVersion",
  );
  const cardId = requiredLiteral(artifact.cardId, "lab5_bp_bmi_transport_research", "model-card cardId");
  const model = parseTransportRiskModel(artifact.model);
  return { cardId, model, schemaVersion };
}

function parseTransportRiskModel(value: unknown): TransportRiskModel {
  const model = asPlainRecord(value, "risk model");
  const parsed: TransportRiskModel = {
    endpoint: requiredString(model.endpoint, "risk model endpoint"),
    features: requiredArray(model.features, "risk model features").map(parseTransportModelFeature),
    horizonYears: requiredNumber(model.horizonYears, "risk model horizonYears"),
    intercept: requiredNumber(model.intercept, "risk model intercept"),
    modelId: requiredString(model.modelId, "risk model modelId"),
    referencePopulation: requiredString(model.referencePopulation, "risk model referencePopulation"),
    referenceRiskCurve: requiredArray(model.referenceRiskCurve, "risk model referenceRiskCurve")
      .map(parseReferenceRiskPoint),
  };
  if (typeof model.modelVersion === "string") parsed.modelVersion = model.modelVersion;
  const calibration = parseOptionalCalibration(model.calibration);
  if (calibration) parsed.calibration = calibration;
  const blockedBiomarkerKeys = parseOptionalStringArray(model.blockedBiomarkerKeys, "risk model blockedBiomarkerKeys");
  if (blockedBiomarkerKeys) parsed.blockedBiomarkerKeys = blockedBiomarkerKeys;
  const blockedMetricKeys = parseOptionalStringArray(model.blockedMetricKeys, "risk model blockedMetricKeys");
  if (blockedMetricKeys) parsed.blockedMetricKeys = blockedMetricKeys;
  return parsed;
}

function parseTransportModelFeature(value: unknown): TransportModelFeature {
  const feature = asPlainRecord(value, "risk model feature");
  const base = {
    coefficient: requiredNumber(feature.coefficient, "feature coefficient"),
    key: requiredString(feature.key, "feature key"),
    label: requiredString(feature.label, "feature label"),
    moduleId: requiredString(feature.moduleId, "feature moduleId"),
    transform: parseOptionalTransform(feature.transform),
  };
  const kind = requiredString(feature.kind, "feature kind");
  if (kind === "chronological-age") return { ...base, kind };
  if (kind === "sex") {
    const sex = requiredString(feature.sex, "feature sex");
    if (sex !== "female" && sex !== "male") throw new Error("Feature sex must be female or male.");
    return { ...base, kind, sex };
  }
  if (kind === "metric") {
    const expectedUnit = typeof feature.expectedUnit === "string" ? feature.expectedUnit : undefined;
    const parsed: TransportMetricFeature = {
      ...base,
      kind,
      metricKey: requiredString(feature.metricKey, "feature metricKey"),
    };
    if (expectedUnit) parsed.expectedUnit = expectedUnit;
    return parsed;
  }
  throw new Error(`Unsupported transport model feature kind: ${kind}`);
}

function parseReferenceRiskPoint(value: unknown): { ageYears: number; riskProbability: number } {
  const point = asPlainRecord(value, "reference risk point");
  return {
    ageYears: requiredNumber(point.ageYears, "reference risk point ageYears"),
    riskProbability: requiredNumber(point.riskProbability, "reference risk point riskProbability"),
  };
}

function parseOptionalCalibration(value: unknown): TransportRiskModel["calibration"] | undefined {
  if (value === undefined) return undefined;
  const calibration = asPlainRecord(value, "risk model calibration");
  return {
    intercept: requiredNumber(calibration.intercept, "calibration intercept"),
    slope: requiredNumber(calibration.slope, "calibration slope"),
  };
}

function parseOptionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  return requiredArray(value, label).map((item, index) => requiredString(item, `${label}.${index}`));
}

function parseOptionalTransform(value: unknown): TransportModelFeature["transform"] | undefined {
  if (value === undefined) return undefined;
  const transform = asPlainRecord(value, "feature transform");
  const kind = requiredString(transform.kind, "feature transform kind");
  if (kind !== "identity" && kind !== "ln") {
    throw new Error(`Unsupported transport model feature transform: ${kind}`);
  }
  return { kind };
}

function asPlainRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Expected ${label} to be an array.`);
  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Expected ${label} to be a string.`);
  return value;
}

function requiredNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Expected ${label} to be finite.`);
  return value;
}

function requiredLiteral<const T extends string>(value: unknown, literal: T, label: string): T {
  if (value !== literal) throw new Error(`Expected ${label} to be ${literal}.`);
  return literal;
}

function assertSourceModelUsableForTransport(model: TransportRiskModel, sourceFeatureKeys: readonly string[]): void {
  const requiredKeys: ReadonlySet<string> = new Set(
    CRELES_SOURCE_FEATURE_DEFINITIONS.map((definition) => definition.key),
  );
  for (const key of sourceFeatureKeys) {
    if (!requiredKeys.has(key)) {
      throw new Error("MIDUS 2 source model contains a feature that is not mapped for CRELES transport scoring.");
    }
  }
  for (const feature of model.features) {
    const joined = [feature.key, feature.kind === "metric" ? feature.metricKey : "", feature.label]
      .join(" ")
      .toLowerCase();
    if (joined.includes("crp") || joined.includes("hscrp") || joined.includes("c-reactive")) {
      throw new Error("MIDUS 2 source model includes an inflammation assay feature that is blocked for transport scoring.");
    }
  }
}

async function buildTransportRows(downloadsDir: string, sourceFeatureKeys: readonly string[]): Promise<BenchmarkRowsResult> {
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
  const rows: TransportRow[] = [];
  let excludedFollowupRows = 0;
  let knownStatusRows = 0;

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
    knownStatusRows += 1;

    const values: Record<string, number | null> = {};
    for (const definition of CRELES_SOURCE_FEATURE_DEFINITIONS) {
      const row = definition.source === "recoded" ? recodedRow : biomarkerRow;
      const rawValue = parseMetricValue(row[definition.column]);
      values[definition.key] = rawValue === null ? null : definition.transform(rawValue);
    }
    if (!completeForSourceModel(values, sourceFeatureKeys)) continue;
    rows.push({
      split: stableSplit(id),
      values,
      y: followupStatus === "dead" ? 1 : 0,
    });
  }
  return { excludedFollowupRows, knownStatusRows, rows };
}

function completeForSourceModel(
  values: Record<string, number | null>,
  sourceFeatureKeys: readonly string[],
): values is Record<string, number> {
  return sourceFeatureKeys.every((key) => Number.isFinite(values[key]));
}

function assertMinimumAggregateCells(rows: readonly TransportRow[]): void {
  for (const [split, counts] of Object.entries(splitCounts(rows))) {
    if (counts.events < MINIMUM_CELL_THRESHOLD || counts.n - counts.events < MINIMUM_CELL_THRESHOLD) {
      throw new Error(`MIDUS-to-CRELES aggregate output failed minimum cell threshold for ${split}.`);
    }
  }
}

function assertMinimumEmittedCounts(output: Midus2CrelesTransportBenchmarkOutput): void {
  const counts = {
    completeCaseRows: output.targetDataShape.completeCaseRows,
    events: output.targetDataShape.events,
    excludedFollowupRows: output.targetDataShape.excludedFollowupRows,
    knownStatusRows: output.targetDataShape.knownStatusRows,
    missingFeatureExcludedRows: output.targetDataShape.missingFeatureExcludedRows,
    ...Object.fromEntries(
      Object.entries(output.targetDataShape.splitCounts).flatMap(([split, splitCountsForKey]) => [
        [`${split}Events`, splitCountsForKey.events],
        [`${split}NonEvents`, splitCountsForKey.n - splitCountsForKey.events],
        [`${split}Rows`, splitCountsForKey.n],
      ]),
    ),
  };
  for (const [label, count] of Object.entries(counts)) {
    if (count > 0 && count < MINIMUM_CELL_THRESHOLD) {
      throw new Error(`MIDUS-to-CRELES aggregate output has a small emitted count for ${label}.`);
    }
  }
}

function columnsForSource(source: CrelesFeatureSource): string[] {
  return CRELES_SOURCE_FEATURE_DEFINITIONS
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

function calibrateSourceModelOnTarget(
  sourceModel: TransportRiskModel,
  rows: readonly TransportRow[],
): ScoreModel {
  const calibrationRows = rows.filter((row) => row.split === "calibration");
  const logits = calibrationRows.map((row) => scoreRuntimeModelLogit(sourceModel, row.values));
  const { intercept, slope } = fitSingleFeatureLogistic(calibrationRows.map((row) => row.y), logits);
  return {
    predict: (row) => sigmoid(intercept + slope * scoreRuntimeModelLogit(sourceModel, row.values)),
  };
}

function trainTargetAgeSexReference(rows: readonly TransportRow[]): TargetReferenceModel {
  const calibrationRows = rows.filter((row) => row.split === "calibration");
  const ageValues = calibrationRows.map((row) => row.values.age);
  const ageMean = mean(ageValues);
  const ageSd = standardDeviation(ageValues);
  const labels = calibrationRows.map((row) => row.y);
  const standardizedInputs = calibrationRows.map((row) => [
    (row.values.age - ageMean) / ageSd,
    row.values.male,
  ]);
  const { intercept, weights } = fitMultiFeatureLogistic(labels, standardizedInputs, 0.001);
  return {
    featureKeys: ["age", "male"],
    predict: (row) => sigmoid(
      intercept
        + weights[0]! * ((row.values.age - ageMean) / ageSd)
        + weights[1]! * row.values.male,
    ),
  };
}

function fitSingleFeatureLogistic(
  labels: readonly number[],
  featureValues: readonly number[],
): { intercept: number; slope: number } {
  const eventRate = Math.min(0.99, Math.max(0.01, mean(labels)));
  let intercept = logit(eventRate);
  let slope = 1;
  for (let iteration = 0; iteration < 6000; iteration += 1) {
    let interceptGradient = 0;
    let slopeGradient = 0;
    for (let index = 0; index < labels.length; index += 1) {
      const featureValue = featureValues[index]!;
      const error = sigmoid(intercept + slope * featureValue) - labels[index]!;
      interceptGradient += error;
      slopeGradient += error * featureValue;
    }
    interceptGradient /= Math.max(1, labels.length);
    slopeGradient = slopeGradient / Math.max(1, labels.length) + 0.001 * slope;
    intercept -= 0.05 * interceptGradient;
    slope -= 0.05 * slopeGradient;
  }
  return { intercept, slope };
}

function fitMultiFeatureLogistic(
  labels: readonly number[],
  inputs: readonly (readonly number[])[],
  lambda: number,
): { intercept: number; weights: number[] } {
  const eventRate = Math.min(0.99, Math.max(0.01, mean(labels)));
  let intercept = logit(eventRate);
  const weights = new Array(inputs[0]?.length ?? 0).fill(0);
  for (let iteration = 0; iteration < 6000; iteration += 1) {
    let interceptGradient = 0;
    const gradients = new Array(weights.length).fill(0);
    for (let rowIndex = 0; rowIndex < labels.length; rowIndex += 1) {
      const input = inputs[rowIndex]!;
      const score = intercept + weights.reduce((sum, weight, index) => sum + weight * input[index]!, 0);
      const error = sigmoid(score) - labels[rowIndex]!;
      interceptGradient += error;
      for (let index = 0; index < weights.length; index += 1) {
        gradients[index] += error * input[index]!;
      }
    }
    intercept -= 0.05 * (interceptGradient / Math.max(1, labels.length));
    for (let index = 0; index < weights.length; index += 1) {
      const gradient = gradients[index]! / Math.max(1, labels.length) + lambda * weights[index]!;
      weights[index] -= 0.05 * gradient;
    }
  }
  return { intercept, weights };
}

function summarizeTransportModel(
  rows: readonly TransportRow[],
  model: ScoreModel,
  metadata: {
    calibrationPolicy: Midus2CrelesTransportBenchmarkOutput["transportModels"][string]["calibrationPolicy"];
    candidateRole: Midus2CrelesTransportBenchmarkOutput["transportModels"][string]["candidateRole"];
    featureKeys: string[];
  },
): Midus2CrelesTransportBenchmarkOutput["transportModels"][string] {
  return {
    calibrationParametersStored: false,
    calibrationPolicy: metadata.calibrationPolicy,
    candidateRole: metadata.candidateRole,
    coefficientsStored: false,
    featureKeys: metadata.featureKeys,
    predictionsStored: false,
    splitMetrics: {
      calibration: aggregateMetrics(rows, model, "calibration"),
      test: aggregateMetrics(rows, model, "test"),
    },
  };
}

function aggregateMetrics(
  rows: readonly TransportRow[],
  model: ScoreModel,
  split: TransportSplit,
): Midus2CrelesAggregateMetricSummary {
  const subset = rows.filter((row) => row.split === split);
  const labels = subset.map((row) => row.y);
  const probabilities = subset.map((row) => model.predict(row));
  const eps = 1e-6;
  return {
    auc: calculateAuc(labels, probabilities),
    brier: mean(labels.map((label, index) => (probabilities[index]! - label) ** 2)),
    events: labels.reduce<number>((sum, label) => sum + label, 0),
    logLoss: -mean(labels.map((label, index) =>
      label * Math.log(Math.max(eps, probabilities[index]!))
      + (1 - label) * Math.log(Math.max(eps, 1 - probabilities[index]!))
    )),
    meanPrediction: mean(probabilities),
    n: subset.length,
    observedRate: mean(labels),
  };
}

function splitCounts(rows: readonly TransportRow[]): Midus2CrelesTransportBenchmarkOutput["targetDataShape"]["splitCounts"] {
  return Object.fromEntries(
    (["calibration", "test"] as const).map((split) => {
      const splitRows = rows.filter((row) => row.split === split);
      return [split, { events: splitRows.reduce((sum, row) => sum + row.y, 0), n: splitRows.length }];
    }),
  ) as Midus2CrelesTransportBenchmarkOutput["targetDataShape"]["splitCounts"];
}

function scoreRuntimeModelLogit(model: TransportRiskModel, values: Record<string, number>): number {
  const linearScore = model.features.reduce((sum, feature) => {
    return sum + feature.coefficient * runtimeFeatureValue(feature, values);
  }, model.intercept);
  return model.calibration ? model.calibration.intercept + model.calibration.slope * linearScore : linearScore;
}

function runtimeFeatureValue(feature: TransportModelFeature, values: Record<string, number>): number {
  const rawValue = feature.kind === "chronological-age"
    ? values.age
    : feature.kind === "sex"
      ? values.male
      : values[feature.metricKey];
  if (!Number.isFinite(rawValue)) {
    throw new Error(`MIDUS 2 source model feature ${publicFeatureKey(feature)} is missing from CRELES transport row.`);
  }
  if (feature.transform?.kind === "ln") return Math.log(rawValue);
  if (feature.transform && feature.transform.kind !== "identity") {
    throw new Error(`MIDUS-to-CRELES transport scoring does not support ${feature.transform.kind} transforms.`);
  }
  return rawValue;
}

function publicFeatureKey(feature: TransportModelFeature): string {
  if (feature.kind === "chronological-age") return "age";
  if (feature.kind === "sex") return "male";
  return feature.metricKey;
}

function stableSplit(id: string): TransportSplit {
  const hex = createHash("sha256").update(`midus2-creles-transport-0:${id}`).digest("hex").slice(0, 12);
  const value = Number.parseInt(hex, 16) / 0xffffffffffff;
  return value < 0.5 ? "calibration" : "test";
}

function parseFollowupStatus(value: string | undefined): "alive" | "dead" | "lost" | "missing" {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (parsed === 1) return "alive";
  if (parsed === 2) return "dead";
  if (parsed === 3) return "lost";
  return "missing";
}

function parseMetricValue(value: string | undefined): number | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed >= 999_999) return null;
  return parsed;
}

function sigmoid(value: number): number {
  return value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));
}

function logit(probability: number): number {
  return Math.log(probability / (1 - probability));
}

function mean(values: readonly number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function standardDeviation(values: readonly number[]): number {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2))) || 1;
}

async function runCli(): Promise<void> {
  const result = await runMidus2CrelesTransportBenchmark({
    downloadsDir: process.env.MURPH_AGE_DOWNLOADS_DIR,
    midusOutputDir: process.env.MURPH_AGE_MIDUS_RESEARCH_OUTPUT_DIR,
    modelCardOutputDir: process.env.MURPH_AGE_MODEL_CARD_OUTPUT_DIR,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  });
  const aggregateSummary = {
    artifact: path.basename(result.outputPath),
    benchmarkId: result.output.benchmarkId,
    endpointComparison: result.output.endpointComparison,
    sourceModel: {
      cardId: result.output.sourceModel.cardId,
      endpoint: result.output.sourceModel.endpoint,
      featureKeys: result.output.sourceModel.featureKeys,
      horizonYears: result.output.sourceModel.horizonYears,
      modelId: result.output.sourceModel.modelId,
      modelVersion: result.output.sourceModel.modelVersion,
      referencePopulation: result.output.sourceModel.referencePopulation,
    },
    status: result.output.status,
    targetDataShape: result.output.targetDataShape,
    transportModels: Object.fromEntries(
      Object.entries(result.output.transportModels).map(([modelId, model]) => [modelId, {
        calibrationPolicy: model.calibrationPolicy,
        candidateRole: model.candidateRole,
        featureKeys: model.featureKeys,
        test: model.splitMetrics.test,
      }]),
    ),
  };
  console.log(JSON.stringify(aggregateSummary, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await runCli();
  } catch {
    console.error(JSON.stringify({
      status: "failed",
      error: "MIDUS-to-CRELES transport benchmark failed. Check local downloads, feature availability, and ignored runtime output directories.",
    }, null, 2));
    process.exitCode = 1;
  }
}
