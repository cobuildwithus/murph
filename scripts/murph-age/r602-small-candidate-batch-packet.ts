import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R602_SMALL_CANDIDATE_BATCH_PACKET_SCHEMA_VERSION =
  "murph-age-r602-small-candidate-batch-packet.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(".runtime", "operations", "research", "murph-age", "model-runs");
const DEFAULT_MIDUS2_INCREMENT_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "r399-midus2-biomarker-increment.latest.json");
const DEFAULT_MIDUS_REFRESHER_INCREMENT_PATH = path.join(
  DEFAULT_MODEL_RUNS_DIR,
  "r399-midus-refresher-biomarker-increment.latest.json",
);
const OUTPUT_FILE_NAME = "r602-small-candidate-batch-packet.latest.json";

const SMALL_BATCH_CANDIDATES = [
  {
    candidateId: "body-only-residual",
    candidateQuestion: "Does BMI add stable residual signal over the frozen R399 anchor?",
    localModelId: "r399_plus_bmi_increment",
  },
  {
    candidateId: "bloodwork-only-residual",
    candidateQuestion: "Do compact glycemia/lipid labs add stable residual signal over the frozen R399 anchor?",
    localModelId: "r399_plus_lab3_increment",
  },
  {
    candidateId: "bloodwork-plus-body-residual",
    candidateQuestion: "Does compact bloodwork plus BMI add stable residual signal over the frozen R399 anchor?",
    localModelId: "r399_plus_lab3_bmi_increment",
  },
] as const;

type SourceRole = "internal_development" | "internal_replication";
type CandidateId = typeof SMALL_BATCH_CANDIDATES[number]["candidateId"];
type LocalModelId = typeof SMALL_BATCH_CANDIDATES[number]["localModelId"];

export interface R602SmallCandidateBatchPacketOptions {
  createdAt?: string;
  midus2IncrementPath?: string;
  midusRefresherIncrementPath?: string;
  outputDir?: string;
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
  candidateId: CandidateId;
  candidateQuestion: string;
  candidateRole: "proposal";
  featureCoverageBands: Record<string, string>;
  featureKeys: string[];
  hypothesis: string;
  hypothesisSource: string;
  localModelId: LocalModelId;
  metricDeltasVsAnchor: MetricDeltas;
  metrics: MetricSummary;
  resultInterpretation: "directionally_promising" | "mixed_or_flat";
}

interface SourceResult {
  anchor: {
    localModelId: "r399_anchor_recalibrated";
    metrics: MetricSummary;
  };
  benchmarkId: string;
  candidateResults: CandidateResult[];
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
}

export interface R602SmallCandidateBatchPacket {
  boundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    rowValuesStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  firebreaks: {
    nullResidual: {
      anchorDeltaIsZeroReference: true;
      interpretationRule: "Candidate families must beat the frozen-anchor recalibration on the same denominator; zero-delta is the null result.";
      status: "applied_in_packet";
    };
    qcMissingness: {
      interpretationRule: "Treat any candidate with worse metrics and weaker feature coverage as a QC/missingness warning, not a biological signal.";
      status: "aggregate_feature_coverage_reported";
    };
  };
  nextReviewGate: {
    recommendation: "send_r602_aggregate_results_direction_chorus";
    reviewerQuestion: string;
  };
  packetId: "r602-small-candidate-residual-batch";
  schemaVersion: typeof R602_SMALL_CANDIDATE_BATCH_PACKET_SCHEMA_VERSION;
  sources: SourceResult[];
  status: "research-local-aggregate-only";
  summary: {
    conclusion: "small_candidate_batch_requires_review";
    notPromotableReasons: string[];
    strongestInternalCandidate: CandidateId;
  };
}

export async function runR602SmallCandidateBatchPacket(
  options: R602SmallCandidateBatchPacketOptions = {},
): Promise<{ output: R602SmallCandidateBatchPacket; outputPath: string }> {
  const [midus2, midusRefresher] = await Promise.all([
    readJson(options.midus2IncrementPath ?? DEFAULT_MIDUS2_INCREMENT_PATH),
    readJson(options.midusRefresherIncrementPath ?? DEFAULT_MIDUS_REFRESHER_INCREMENT_PATH),
  ]);
  const sources = [
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
  ];
  const output: R602SmallCandidateBatchPacket = {
    boundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      rowValuesStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    firebreaks: {
      nullResidual: {
        anchorDeltaIsZeroReference: true,
        interpretationRule: "Candidate families must beat the frozen-anchor recalibration on the same denominator; zero-delta is the null result.",
        status: "applied_in_packet",
      },
      qcMissingness: {
        interpretationRule: "Treat any candidate with worse metrics and weaker feature coverage as a QC/missingness warning, not a biological signal.",
        status: "aggregate_feature_coverage_reported",
      },
    },
    nextReviewGate: {
      recommendation: "send_r602_aggregate_results_direction_chorus",
      reviewerQuestion: "Given this aggregate-only small candidate batch, should Murph Age continue residual model search, move to transport/external stress, or stop/narrow this candidate family?",
    },
    packetId: "r602-small-candidate-residual-batch",
    schemaVersion: R602_SMALL_CANDIDATE_BATCH_PACKET_SCHEMA_VERSION,
    sources,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "small_candidate_batch_requires_review",
      notPromotableReasons: [
        "Only internal MIDUS-family aggregate evidence is included.",
        "MIDUS Refresher has a tiny-event test band and cannot validate promotion.",
        "No website, sidebar, product, recommendation, or protocol surface is authorized.",
      ],
      strongestInternalCandidate: strongestCandidate(sources),
    },
  };
  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R602 small-candidate packet failed aggregate-egress validation: ${findings.join("; ")}`);
  }
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
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
  const root = requiredRecord(input.value, `${input.sourceId} increment artifact`);
  const benchmarkId = requiredString(root.benchmarkId, `${input.sourceId} benchmarkId`);
  if (benchmarkId !== input.expectedBenchmarkId) {
    throw new Error(`${input.sourceId} artifact does not match the expected R602 benchmark.`);
  }
  const dataShape = requiredRecord(root.dataShape, `${input.sourceId} dataShape`);
  const splitCounts = requiredRecord(dataShape.splitCounts, `${input.sourceId} split counts`);
  const testSplit = requiredRecord(splitCounts.test, `${input.sourceId} test split`);
  const models = requiredRecord(root.models, `${input.sourceId} models`);
  const anchor = metricAt(models.r399_anchor_recalibrated, `${input.sourceId} R399 anchor`);
  return {
    anchor: {
      localModelId: "r399_anchor_recalibrated",
      metrics: anchor,
    },
    benchmarkId,
    candidateResults: SMALL_BATCH_CANDIDATES.map((candidate) => summarizeCandidate({
      anchor,
      candidate,
      models,
      sourceId: input.sourceId,
    })),
    countBands: {
      eligibleRows: countBand(requiredNumber(dataShape.eligibleRows, `${input.sourceId} eligible rows`)),
      eventCount: countBand(requiredNumber(dataShape.events, `${input.sourceId} events`)),
      testEventCount: countBand(requiredNumber(testSplit.events, `${input.sourceId} test events`)),
      testRows: countBand(requiredNumber(testSplit.n, `${input.sourceId} test rows`)),
    },
    endpoint: requiredString(root.endpoint, `${input.sourceId} endpoint`),
    evidenceLabel: "internal-only",
    role: input.role,
    schemaVersion: requiredString(root.schemaVersion, `${input.sourceId} schema version`),
    sourceId: input.sourceId,
    testSplitStability: requiredNumber(testSplit.events, `${input.sourceId} test events`) < 10
      ? "tiny-event-band"
      : "adequate-event-band",
  };
}

function summarizeCandidate(input: {
  anchor: MetricSummary;
  candidate: typeof SMALL_BATCH_CANDIDATES[number];
  models: Record<string, unknown>;
  sourceId: string;
}): CandidateResult {
  const model = requiredRecord(
    input.models[input.candidate.localModelId],
    `${input.sourceId} ${input.candidate.localModelId}`,
  );
  const metrics = metricAt(model, `${input.sourceId} ${input.candidate.localModelId}`);
  const deltas = metricDeltas(metrics, input.anchor);
  return {
    anchorModelId: "r399_anchor_recalibrated",
    candidateId: input.candidate.candidateId,
    candidateQuestion: input.candidate.candidateQuestion,
    candidateRole: "proposal",
    featureCoverageBands: featureCoverageBands(model.featureObservedCounts),
    featureKeys: readStringArray(model.featureKeys, `${input.sourceId} ${input.candidate.localModelId} feature keys`),
    hypothesis: requiredString(model.hypothesis, `${input.sourceId} ${input.candidate.localModelId} hypothesis`),
    hypothesisSource: requiredString(
      model.hypothesisSource,
      `${input.sourceId} ${input.candidate.localModelId} hypothesis source`,
    ),
    localModelId: input.candidate.localModelId,
    metricDeltasVsAnchor: deltas,
    metrics,
    resultInterpretation: hasDirectionalSignal(deltas) ? "directionally_promising" : "mixed_or_flat",
  };
}

function strongestCandidate(sources: SourceResult[]): CandidateId {
  const scores = new Map<CandidateId, number>();
  for (const source of sources) {
    for (const result of source.candidateResults) {
      const score =
        (result.metricDeltasVsAnchor.aucDelta !== null && result.metricDeltasVsAnchor.aucDelta > 0 ? 1 : 0) +
        (result.metricDeltasVsAnchor.brierDelta < 0 ? 1 : 0) +
        (result.metricDeltasVsAnchor.logLossDelta < 0 ? 1 : 0);
      scores.set(result.candidateId, (scores.get(result.candidateId) ?? 0) + score);
    }
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0]
    ?? "body-only-residual";
}

function metricAt(model: unknown, label: string): MetricSummary {
  const splitMetrics = requiredRecord(requiredRecord(model, label).splitMetrics, `${label} split metrics`);
  const test = requiredRecord(splitMetrics.test, `${label} test metrics`);
  return {
    auc: test.auc === null ? null : roundMetric(requiredNumber(test.auc, `${label} auc`)),
    brier: roundMetric(requiredNumber(test.brier, `${label} brier`)),
    logLoss: roundMetric(requiredNumber(test.logLoss, `${label} logLoss`)),
    meanPrediction: roundMetric(requiredNumber(test.meanPrediction, `${label} mean prediction`)),
    observedRate: roundMetric(requiredNumber(test.observedRate, `${label} observed rate`)),
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

function featureCoverageBands(value: unknown): Record<string, string> {
  const counts = requiredRecord(value, "feature coverage");
  return Object.fromEntries(Object.entries(counts).map(([key, count]) => [
    key,
    countBand(requiredNumber(count, `${key} observed count`)),
  ]));
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new Error("Failed to read a Murph Age aggregate candidate artifact.");
  }
}

function readStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be a string array.`);
  }
  return [...value];
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a string.`);
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
  runR602SmallCandidateBatchPacket({
    midus2IncrementPath: process.env.MURPH_AGE_MIDUS2_INCREMENT_PATH,
    midusRefresherIncrementPath: process.env.MURPH_AGE_MIDUS_REFRESHER_INCREMENT_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  }).then(({ output: packet, outputPath }) => {
    console.log(JSON.stringify(toCliSummary(packet, outputPath), null, 2));
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "R602 small-candidate packet failed.");
    process.exitCode = 1;
  });
}

function toCliSummary(packet: R602SmallCandidateBatchPacket, outputPath: string): {
  artifact: string;
  packetId: R602SmallCandidateBatchPacket["packetId"];
  productPromotionAuthorized: boolean;
  schemaVersion: R602SmallCandidateBatchPacket["schemaVersion"];
  sourceCount: number;
  status: R602SmallCandidateBatchPacket["status"];
  strongestInternalCandidate: CandidateId;
} {
  return {
    artifact: path.basename(outputPath),
    packetId: packet.packetId,
    productPromotionAuthorized: packet.boundary.productPromotionAuthorized,
    schemaVersion: packet.schemaVersion,
    sourceCount: packet.sources.length,
    status: packet.status,
    strongestInternalCandidate: packet.summary.strongestInternalCandidate,
  };
}
