import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R606_PARSIMONIOUS_GLYCEMIA_ABLATION_SCHEMA_VERSION =
  "murph-age-r606-parsimonious-glycemia-ablation.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(".runtime", "operations", "research", "murph-age", "model-runs");
const DEFAULT_MIDUS2_LOCAL_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "midus2-local-benchmark.latest.json");
const DEFAULT_CRELES_LOCAL_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "creles-local-benchmark.latest.json");
const OUTPUT_FILE_NAME = "r606-parsimonious-glycemia-ablation.latest.json";

type CandidateId =
  | "age_sex_reference"
  | "age_sex_plus_bmi"
  | "age_sex_plus_glycemia"
  | "age_sex_plus_glycemia_body";

type SourceId = "creles-local" | "midus2-local";

interface MetricSummary {
  auc: number | null;
  brier: number;
  logLoss: number;
  meanPrediction: number;
  observedRate: number;
}

interface AvailableCandidateSummary {
  candidateId: CandidateId;
  candidateRole: string;
  deltasVsAgeSex: {
    aucDelta: number | null;
    brierDelta: number;
    logLossDelta: number;
  };
  featureKeys: string[];
  metrics: MetricSummary;
  modelId: string;
  status: "available";
}

interface UnsupportedCandidateSummary {
  candidateId: CandidateId;
  reason: "aggregate_artifact_missing_model";
  recommendation: string;
  status: "unsupported";
}

type CandidateSummary = AvailableCandidateSummary | UnsupportedCandidateSummary;

interface AvailableSourceSummary {
  artifact: string;
  benchmarkId: string;
  countBands: {
    eligibleRows: string;
    eventCount: string;
    testEventCount: string;
    testRows: string;
  };
  endpoint: string;
  parsimoniousCandidates: CandidateSummary[];
  schemaVersion: string;
  sourceId: SourceId;
  status: "available";
}

interface MissingSourceSummary {
  artifact: string;
  reason: "missing_artifact";
  sourceId: SourceId;
  status: "missing";
}

type SourceSummary = AvailableSourceSummary | MissingSourceSummary;

export interface R606ParsimoniousGlycemiaAblationOptions {
  createdAt?: string;
  crelesLocalPath?: string;
  midus2LocalPath?: string;
  outputDir?: string;
}

export interface R606ParsimoniousGlycemiaAblationPacket {
  boundary: {
    aggregateOnly: true;
    calibrationParametersStored: false;
    codebookProseStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  packetId: "r606-parsimonious-glycemia-ablation";
  recommendations: {
    narrowestNextCodePath: string;
    rationale: string[];
  };
  schemaVersion: typeof R606_PARSIMONIOUS_GLYCEMIA_ABLATION_SCHEMA_VERSION;
  sources: SourceSummary[];
  status: "blocked-insufficient-aggregate-detail" | "research-local-aggregate-only";
  summary: {
    availableSourceCountBand: string;
    conclusion: "partial_aggregate_packet_ready" | "no_supported_artifacts";
    smallestSupportedCombination: "age_sex_plus_glycemia_body" | null;
    unsupportedCandidateIds: CandidateId[];
  };
}

export async function runR606ParsimoniousGlycemiaAblation(
  options: R606ParsimoniousGlycemiaAblationOptions = {},
): Promise<{ output: R606ParsimoniousGlycemiaAblationPacket; outputPath: string }> {
  const [midus2, creles] = await Promise.all([
    readJsonIfPresent(options.midus2LocalPath ?? DEFAULT_MIDUS2_LOCAL_PATH),
    readJsonIfPresent(options.crelesLocalPath ?? DEFAULT_CRELES_LOCAL_PATH),
  ]);
  const sources: SourceSummary[] = [
    summarizeLocalBenchmark("midus2-local", "midus2-local-benchmark.latest.json", midus2),
    summarizeLocalBenchmark("creles-local", "creles-local-benchmark.latest.json", creles),
  ];
  const availableSources = sources.filter((source): source is AvailableSourceSummary => source.status === "available");
  const unsupportedCandidateIds = unsupportedCandidateIdsFor(sources);
  const output: R606ParsimoniousGlycemiaAblationPacket = {
    boundary: {
      aggregateOnly: true,
      calibrationParametersStored: false,
      codebookProseStored: false,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      participantIdentifiersStored: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    packetId: "r606-parsimonious-glycemia-ablation",
    recommendations: {
      narrowestNextCodePath: "Add predeclared age/sex + BMI and age/sex + glycemia candidates to the existing MIDUS and CRELES local benchmark runners, then rerun this aggregate packet without expanding into lipids, blood pressure, CRP, or extended clinical panels.",
      rationale: [
        "Existing aggregate artifacts support age/sex and the smallest coherent glycemia/body combination only.",
        "Separate BMI-only and glycemia-only ablations are not present on the locked same-denominator artifacts.",
        "No row-level values, participant identifiers, split membership, predictions, coefficients, or model parameters are exported.",
      ],
    },
    schemaVersion: R606_PARSIMONIOUS_GLYCEMIA_ABLATION_SCHEMA_VERSION,
    sources,
    status: availableSources.length > 0 ? "research-local-aggregate-only" : "blocked-insufficient-aggregate-detail",
    summary: {
      availableSourceCountBand: countBand(availableSources.length),
      conclusion: availableSources.length > 0 ? "partial_aggregate_packet_ready" : "no_supported_artifacts",
      smallestSupportedCombination: availableSources.some((source) =>
        source.parsimoniousCandidates.some((candidate) =>
          candidate.candidateId === "age_sex_plus_glycemia_body" && candidate.status === "available"
        )
      )
        ? "age_sex_plus_glycemia_body"
        : null,
      unsupportedCandidateIds,
    },
  };
  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R606 parsimonious glycemia ablation failed aggregate-egress validation: ${findings.join("; ")}`);
  }
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function summarizeLocalBenchmark(sourceId: SourceId, artifact: string, value: unknown | null): SourceSummary {
  if (!value) return { artifact, reason: "missing_artifact", sourceId, status: "missing" };
  const root = requiredRecord(value, `${sourceId} artifact`);
  assertAggregateBoundary(root, `${sourceId} artifact`);
  const dataShape = requiredRecord(root.dataShape, `${sourceId} data shape`);
  const splitCounts = requiredRecord(dataShape.splitCounts, `${sourceId} split counts`);
  const testSplit = requiredRecord(splitCounts.test, `${sourceId} test counts`);
  const models = requiredRecord(root.models, `${sourceId} models`);
  const reference = summarizeAvailableCandidate("age_sex_reference", "age_sex_reference", models, null);
  if (reference.status !== "available") {
    throw new Error(`${sourceId} artifact is missing the required aggregate age/sex reference.`);
  }
  return {
    artifact,
    benchmarkId: requiredString(root.benchmarkId, `${sourceId} benchmark id`),
    countBands: {
      eligibleRows: countBand(requiredNumber(dataShape.eligibleRows, `${sourceId} eligible rows`)),
      eventCount: countBand(requiredNumber(dataShape.events, `${sourceId} events`)),
      testEventCount: countBand(requiredNumber(testSplit.events, `${sourceId} test events`)),
      testRows: countBand(requiredNumber(testSplit.n, `${sourceId} test rows`)),
    },
    endpoint: requiredString(root.endpoint, `${sourceId} endpoint`),
    parsimoniousCandidates: [
      reference,
      unsupportedCandidate("age_sex_plus_bmi", "BMI-only aggregate ablation is not present on this local benchmark artifact."),
      unsupportedCandidate("age_sex_plus_glycemia", "Glycemia-only aggregate ablation is not present on this local benchmark artifact."),
      summarizeAvailableCandidate("age_sex_plus_glycemia_body", "glycemia_body_no_crp", models, reference.metrics),
    ],
    schemaVersion: requiredString(root.schemaVersion, `${sourceId} schema version`),
    sourceId,
    status: "available",
  };
}

function summarizeAvailableCandidate(
  candidateId: CandidateId,
  modelId: string,
  models: Record<string, unknown>,
  referenceMetrics: MetricSummary | null,
): CandidateSummary {
  const model = optionalRecord(models[modelId]);
  if (!model) {
    return unsupportedCandidate(candidateId, `Aggregate model ${modelId} is not present on this local benchmark artifact.`);
  }
  const metrics = metricAt(model, modelId);
  return {
    candidateId,
    candidateRole: requiredString(model.candidateRole, `${modelId} candidate role`),
    deltasVsAgeSex: referenceMetrics
      ? metricDeltas(metrics, referenceMetrics)
      : { aucDelta: null, brierDelta: 0, logLossDelta: 0 },
    featureKeys: readStringArray(model.featureKeys, `${modelId} feature keys`),
    metrics,
    modelId,
    status: "available",
  };
}

function unsupportedCandidate(candidateId: CandidateId, recommendation: string): UnsupportedCandidateSummary {
  return {
    candidateId,
    reason: "aggregate_artifact_missing_model",
    recommendation,
    status: "unsupported",
  };
}

function unsupportedCandidateIdsFor(sources: SourceSummary[]): CandidateId[] {
  const ids = new Set<CandidateId>();
  for (const source of sources) {
    if (source.status !== "available") continue;
    for (const candidate of source.parsimoniousCandidates) {
      if (candidate.status === "unsupported") ids.add(candidate.candidateId);
    }
  }
  return [...ids].sort();
}

function metricAt(model: Record<string, unknown>, label: string): MetricSummary {
  const splitMetrics = requiredRecord(model.splitMetrics, `${label} aggregate metrics`);
  const test = requiredRecord(splitMetrics.test, `${label} test metrics`);
  return {
    auc: test.auc === null ? null : roundMetric(requiredNumber(test.auc, `${label} auc`)),
    brier: roundMetric(requiredNumber(test.brier, `${label} brier`)),
    logLoss: roundMetric(requiredNumber(test.logLoss, `${label} log loss`)),
    meanPrediction: roundMetric(requiredNumber(test.meanPrediction, `${label} mean prediction`)),
    observedRate: roundMetric(requiredNumber(test.observedRate, `${label} observed rate`)),
  };
}

function metricDeltas(metrics: MetricSummary, reference: MetricSummary): AvailableCandidateSummary["deltasVsAgeSex"] {
  return {
    aucDelta: metrics.auc === null || reference.auc === null ? null : roundMetric(metrics.auc - reference.auc),
    brierDelta: roundMetric(metrics.brier - reference.brier),
    logLossDelta: roundMetric(metrics.logLoss - reference.logLoss),
  };
}

function assertAggregateBoundary(root: Record<string, unknown>, label: string): void {
  for (const key of [
    "codebookTextStored",
    "coefficientsStored",
    "participantIdentifiersStored",
    "participantIdentifiersWritten",
    "predictionsStored",
    "rowValuesStored",
    "sourceBodiesStored",
    "splitMembershipStored",
  ]) {
    if (root[key] !== false) throw new Error(`${label} has unsafe aggregate boundary flag.`);
  }
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") return null;
    throw new Error("Failed to read a Murph Age aggregate artifact.");
  }
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  const record = optionalRecord(value);
  if (!record) throw new Error(`${label} must be an object.`);
  return record;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a string.`);
  return value;
}

function requiredNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return value;
}

function readStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be a string array.`);
  }
  return [...value];
}

function countBand(count: number): string {
  if (count <= 0) return "0";
  if (count < 10) return "1-9";
  if (count < 50) return "10-49";
  if (count < 100) return "50-99";
  if (count < 500) return "100-499";
  if (count < 1000) return "500-999";
  return "1000+";
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR606ParsimoniousGlycemiaAblation({
    crelesLocalPath: process.env.MURPH_AGE_CRELES_OUTPUT_PATH,
    midus2LocalPath: process.env.MURPH_AGE_MIDUS2_OUTPUT_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  }).then(({ output, outputPath }) => {
    process.stdout.write(`${JSON.stringify({
      artifact: path.basename(outputPath),
      availableSourceCountBand: output.summary.availableSourceCountBand,
      conclusion: output.summary.conclusion,
      packetId: output.packetId,
      productPromotionAuthorized: output.boundary.productPromotionAuthorized,
      schemaVersion: output.schemaVersion,
      status: output.status,
      unsupportedCandidateIds: output.summary.unsupportedCandidateIds,
    }, null, 2)}\n`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "R606 parsimonious glycemia ablation failed.");
    process.exitCode = 1;
  });
}
