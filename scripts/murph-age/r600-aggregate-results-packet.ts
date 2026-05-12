import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R600_AGGREGATE_RESULTS_PACKET_SCHEMA_VERSION =
  "murph-age-r600-aggregate-results-packet.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(".runtime", "operations", "research", "murph-age", "model-runs");
const DEFAULT_MIDUS2_INCREMENT_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "r399-midus2-biomarker-increment.latest.json");
const DEFAULT_MIDUS_REFRESHER_INCREMENT_PATH = path.join(
  DEFAULT_MODEL_RUNS_DIR,
  "r399-midus-refresher-biomarker-increment.latest.json",
);
const DEFAULT_LAYERING_READINESS_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "r399-layering-readiness.latest.json");
const OUTPUT_FILE_NAME = "r600-aggregate-results-packet.latest.json";

type SourceRole = "internal_development" | "internal_replication";

export interface R600AggregateResultsPacketOptions {
  createdAt?: string;
  midus2IncrementPath?: string;
  midusRefresherIncrementPath?: string;
  outputDir?: string;
  readinessPath?: string;
}

interface MetricSummary {
  auc: number | null;
  brier: number;
  logLoss: number;
  meanPrediction: number;
  observedRate: number;
}

interface MetricDeltas {
  aucDelta: number | null;
  brierDelta: number;
  logLossDelta: number;
  meanPredictionDelta: number;
}

interface CandidateResult {
  anchorModelId: "r399_anchor_recalibrated";
  candidateId: "r399-plus-compact-bloodwork-body-residual" | "r399-plus-compact-bloodwork-residual";
  localModelId: "r399_plus_lab3_bmi_increment" | "r399_plus_lab3_increment";
  metricDeltasVsAnchor: MetricDeltas;
  metrics: MetricSummary;
  signal: "directionally_promising" | "mixed_or_flat";
}

interface SourceResult {
  benchmarkId: string;
  countBands: {
    eligibleRows: string;
    eventCount: string;
    testEventCount: string;
    testRows: string;
  };
  endpoint: string;
  evidenceLabel: "internal-only";
  role: SourceRole;
  schemaVersion: string;
  sourceId: "midus-refresher" | "midus2";
  testSplitStability: "adequate-event-band" | "tiny-event-band";
  anchor: {
    localModelId: "r399_anchor_recalibrated";
    metrics: MetricSummary;
  };
  candidateResults: CandidateResult[];
}

export interface R600AggregateResultsPacket {
  boundary: {
    aggregateOnly: true;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    predictionsStored: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    rowValuesStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  nextReviewGate: {
    recommendation: "send_aggregate_results_gate";
    reviewerQuestion: string;
  };
  packetId: "r600-frozen-anchor-residual-increment-aggregate-results";
  schemaVersion: typeof R600_AGGREGATE_RESULTS_PACKET_SCHEMA_VERSION;
  sources: SourceResult[];
  status: "research-local-aggregate-only";
  summary: {
    bestCurrentCandidate: "r399-plus-compact-bloodwork-body-residual";
    conclusion: "weak_internal_signal_not_promotable";
    reasons: string[];
  };
  upstreamManifest: {
    candidateBatchId: string;
    candidateBatchStatus: "frozen-research-only";
    sourceRoles: Array<{
      id: string;
      optimizationAllowed: boolean;
      role: string;
    }>;
  };
}

export async function runR600AggregateResultsPacket(
  options: R600AggregateResultsPacketOptions = {},
): Promise<{ output: R600AggregateResultsPacket; outputPath: string }> {
  const [midus2, midusRefresher, readiness] = await Promise.all([
    readJson(options.midus2IncrementPath ?? DEFAULT_MIDUS2_INCREMENT_PATH),
    readJson(options.midusRefresherIncrementPath ?? DEFAULT_MIDUS_REFRESHER_INCREMENT_PATH),
    readJson(options.readinessPath ?? DEFAULT_LAYERING_READINESS_PATH),
  ]);
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const output: R600AggregateResultsPacket = {
    boundary: {
      aggregateOnly: true,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      participantIdentifiersStored: false,
      predictionsStored: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      rowValuesStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    nextReviewGate: {
      recommendation: "send_aggregate_results_gate",
      reviewerQuestion: "Do these internal MIDUS 2 and MIDUS Refresher aggregate results justify a new source/evaluator step, or should the next loop refine the residual-increment evaluator before any broader source search?",
    },
    packetId: "r600-frozen-anchor-residual-increment-aggregate-results",
    schemaVersion: R600_AGGREGATE_RESULTS_PACKET_SCHEMA_VERSION,
    sources: [
      summarizeSource({
        expectedBenchmarkId: "r399-midus2-biomarker-increment-local-0",
        role: "internal_development",
        sourceId: "midus2",
        value: midus2,
      }),
      summarizeSource({
        expectedBenchmarkId: "r399-midus-refresher-biomarker-increment-local-0",
        role: "internal_replication",
        sourceId: "midus-refresher",
        value: midusRefresher,
      }),
    ],
    status: "research-local-aggregate-only",
    summary: {
      bestCurrentCandidate: "r399-plus-compact-bloodwork-body-residual",
      conclusion: "weak_internal_signal_not_promotable",
      reasons: [
        "The compact bloodwork-plus-body residual candidate is directionally best in both internal sources.",
        "MIDUS 2 lift over the frozen R399 anchor is very small.",
        "MIDUS Refresher lift is larger but sits in a tiny-event test band, so it is unstable internal replication evidence only.",
        "CRELES transport remains non-confirming in the upstream readiness artifact.",
        "Wearables remain shadow-only and age-like display remains explicitly abstained.",
      ],
    },
    upstreamManifest: summarizeReadinessManifest(readiness),
  };
  const egressFindings = findForbiddenAggregateEgress(output);
  if (egressFindings.length > 0) {
    throw new Error(`R600 aggregate-results packet failed aggregate-egress validation: ${egressFindings.join("; ")}`);
  }
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function summarizeSource(input: {
  expectedBenchmarkId: string;
  role: SourceRole;
  sourceId: SourceResult["sourceId"];
  value: unknown;
}): SourceResult {
  const root = requiredRecord(input.value, `${input.sourceId} aggregate result`);
  const benchmarkId = requiredString(root.benchmarkId, `${input.sourceId} benchmarkId`);
  if (benchmarkId !== input.expectedBenchmarkId) {
    throw new Error(`${input.sourceId} aggregate result does not match the expected R600 benchmark.`);
  }
  const dataShape = requiredRecord(root.dataShape, `${input.sourceId} dataShape`);
  const splitCounts = requiredRecord(dataShape.splitCounts, `${input.sourceId} splitCounts`);
  const testSplit = requiredRecord(splitCounts.test, `${input.sourceId} test split`);
  const models = requiredRecord(root.models, `${input.sourceId} models`);
  const anchor = metricAt(models.r399_anchor_recalibrated, `${input.sourceId} R399 anchor`);
  return {
    anchor: {
      localModelId: "r399_anchor_recalibrated",
      metrics: anchor,
    },
    benchmarkId,
    candidateResults: [
      summarizeCandidate({
        anchor,
        candidateId: "r399-plus-compact-bloodwork-residual",
        localModelId: "r399_plus_lab3_increment",
        models,
        sourceId: input.sourceId,
      }),
      summarizeCandidate({
        anchor,
        candidateId: "r399-plus-compact-bloodwork-body-residual",
        localModelId: "r399_plus_lab3_bmi_increment",
        models,
        sourceId: input.sourceId,
      }),
    ],
    countBands: {
      eligibleRows: countBand(requiredNumber(dataShape.eligibleRows, `${input.sourceId} eligible rows`)),
      eventCount: countBand(requiredNumber(dataShape.events, `${input.sourceId} events`)),
      testEventCount: countBand(requiredNumber(testSplit.events, `${input.sourceId} test events`)),
      testRows: countBand(requiredNumber(testSplit.n, `${input.sourceId} test rows`)),
    },
    endpoint: requiredString(root.endpoint, `${input.sourceId} endpoint`),
    evidenceLabel: "internal-only",
    role: input.role,
    schemaVersion: requiredString(root.schemaVersion, `${input.sourceId} schemaVersion`),
    sourceId: input.sourceId,
    testSplitStability: requiredNumber(testSplit.events, `${input.sourceId} test events`) < 10
      ? "tiny-event-band"
      : "adequate-event-band",
  };
}

function summarizeCandidate(input: {
  anchor: MetricSummary;
  candidateId: CandidateResult["candidateId"];
  localModelId: CandidateResult["localModelId"];
  models: Record<string, unknown>;
  sourceId: string;
}): CandidateResult {
  const metrics = metricAt(input.models[input.localModelId], `${input.sourceId} ${input.localModelId}`);
  const metricDeltasVsAnchor = metricDeltas(metrics, input.anchor);
  return {
    anchorModelId: "r399_anchor_recalibrated",
    candidateId: input.candidateId,
    localModelId: input.localModelId,
    metricDeltasVsAnchor,
    metrics,
    signal: hasDirectionalSignal(metricDeltasVsAnchor) ? "directionally_promising" : "mixed_or_flat",
  };
}

function summarizeReadinessManifest(value: unknown): R600AggregateResultsPacket["upstreamManifest"] {
  const root = requiredRecord(value, "R399 layering readiness");
  const nextLoop = requiredRecord(root.nextLoop, "R399 layering readiness nextLoop");
  const candidateBatch = requiredRecord(nextLoop.candidateBatch, "R399 layering readiness candidateBatch");
  return {
    candidateBatchId: requiredString(candidateBatch.batchId, "R399 layering readiness batch id"),
    candidateBatchStatus: "frozen-research-only",
    sourceRoles: readSourceRoles(nextLoop.sourceRoles),
  };
}

function readSourceRoles(value: unknown): R600AggregateResultsPacket["upstreamManifest"]["sourceRoles"] {
  if (!Array.isArray(value)) throw new Error("R399 layering readiness source roles must be an array.");
  return value.map((item) => {
    const record = requiredRecord(item, "R399 layering readiness source role");
    return {
      id: requiredString(record.id, "R399 layering readiness source role id"),
      optimizationAllowed: requiredBoolean(record.optimizationAllowed, "R399 layering readiness source role optimization flag"),
      role: requiredString(record.role, "R399 layering readiness source role"),
    };
  });
}

function metricAt(model: unknown, label: string): MetricSummary {
  const splitMetrics = requiredRecord(requiredRecord(model, label).splitMetrics, `${label} splitMetrics`);
  const test = requiredRecord(splitMetrics.test, `${label} test metrics`);
  return {
    auc: test.auc === null ? null : requiredNumber(test.auc, `${label} auc`),
    brier: roundMetric(requiredNumber(test.brier, `${label} brier`)),
    logLoss: roundMetric(requiredNumber(test.logLoss, `${label} logLoss`)),
    meanPrediction: roundMetric(requiredNumber(test.meanPrediction, `${label} meanPrediction`)),
    observedRate: roundMetric(requiredNumber(test.observedRate, `${label} observedRate`)),
  };
}

function metricDeltas(candidate: MetricSummary, anchor: MetricSummary): MetricDeltas {
  return {
    aucDelta: candidate.auc === null || anchor.auc === null ? null : roundMetric(candidate.auc - anchor.auc),
    brierDelta: roundMetric(candidate.brier - anchor.brier),
    logLossDelta: roundMetric(candidate.logLoss - anchor.logLoss),
    meanPredictionDelta: roundMetric(candidate.meanPrediction - anchor.meanPrediction),
  };
}

function hasDirectionalSignal(deltas: MetricDeltas): boolean {
  const improvements = [
    deltas.aucDelta !== null && deltas.aucDelta > 0,
    deltas.brierDelta < 0,
    deltas.logLossDelta < 0,
  ];
  return improvements.filter(Boolean).length >= 2;
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new Error("Failed to read a Murph Age aggregate research artifact.");
  }
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a string.`);
  return value;
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean.`);
  return value;
}

function requiredNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return value;
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
  runR600AggregateResultsPacket({
    midus2IncrementPath: process.env.MURPH_AGE_MIDUS2_INCREMENT_PATH,
    midusRefresherIncrementPath: process.env.MURPH_AGE_MIDUS_REFRESHER_INCREMENT_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    readinessPath: process.env.MURPH_AGE_LAYERING_READINESS_PATH,
  }).then(({ output, outputPath }) => {
    const cliSummary = toCliSummary(output, outputPath);
    console.log(JSON.stringify(cliSummary, null, 2));
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "R600 aggregate-results packet failed.");
    process.exitCode = 1;
  });
}

function toCliSummary(packet: R600AggregateResultsPacket, outputPath: string): {
  artifact: string;
  conclusion: R600AggregateResultsPacket["summary"]["conclusion"];
  packetId: R600AggregateResultsPacket["packetId"];
  productPromotionAuthorized: boolean;
  schemaVersion: R600AggregateResultsPacket["schemaVersion"];
  sourceCount: number;
  status: R600AggregateResultsPacket["status"];
} {
  return {
    artifact: path.basename(outputPath),
    conclusion: packet.summary.conclusion,
    packetId: packet.packetId,
    productPromotionAuthorized: packet.boundary.productPromotionAuthorized,
    schemaVersion: packet.schemaVersion,
    sourceCount: packet.sources.length,
    status: packet.status,
  };
}
