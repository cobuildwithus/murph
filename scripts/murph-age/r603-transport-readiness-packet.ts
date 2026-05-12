import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R603_TRANSPORT_READINESS_PACKET_SCHEMA_VERSION =
  "murph-age-r603-transport-readiness-packet.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(".runtime", "operations", "research", "murph-age", "model-runs");
const DEFAULT_CRELES_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "creles-local-benchmark.latest.json");
const DEFAULT_TRANSPORT_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "midus2-creles-transport-benchmark.latest.json");
const DEFAULT_R602_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "r602-small-candidate-batch-packet.latest.json");
const OUTPUT_FILE_NAME = "r603-transport-readiness-packet.latest.json";

export interface R603TransportReadinessPacketOptions {
  createdAt?: string;
  crelesPath?: string;
  outputDir?: string;
  r602Path?: string;
  transportPath?: string;
}

interface MetricSummary {
  auc: number | null;
  brier: number;
  logLoss: number;
  meanPrediction: number;
  observedRate: number;
}

interface ModelSummary {
  candidateRole: string;
  featureKeys: string[];
  metricDeltasVsReference: {
    aucDelta: number | null;
    brierDelta: number;
    logLossDelta: number;
  };
  metrics: MetricSummary;
  modelId: string;
}

export interface R603TransportReadinessPacket {
  boundary: {
    aggregateOnly: true;
    calibrationParametersStored: false;
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
  packetId: "r603-creles-transport-readiness";
  readiness: {
    conclusion: "transport_signal_not_confirmed" | "transport_ready_for_review";
    nextReviewQuestion: string;
  };
  r602Consensus: {
    strongestInternalCandidate: string | null;
    transportStressRecommended: true | null;
  };
  schemaVersion: typeof R603_TRANSPORT_READINESS_PACKET_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  transport: {
    crelesLocal: {
      benchmarkId: string;
      countBands: {
        eligibleRows: string;
        eventCount: string;
        testEventCount: string;
        testRows: string;
      };
      endpoint: string;
      models: ModelSummary[];
      status: "available";
    } | {
      reason: "missing_artifact";
      status: "missing";
    };
    midusToCreles: {
      benchmarkId: string;
      countBands: {
        completeCaseRows: string;
        eventCount: string;
        testEventCount: string;
        testRows: string;
      };
      endpointMismatchPolicy: string;
      models: ModelSummary[];
      sourceModelFeatureKeys: string[];
      status: "available";
    } | {
      reason: "missing_artifact";
      status: "missing";
    };
  };
}

export async function runR603TransportReadinessPacket(
  options: R603TransportReadinessPacketOptions = {},
): Promise<{ output: R603TransportReadinessPacket; outputPath: string }> {
  const creles = await readJsonIfPresent(options.crelesPath ?? DEFAULT_CRELES_PATH);
  const transport = await readJsonIfPresent(options.transportPath ?? DEFAULT_TRANSPORT_PATH);
  const r602 = await readJsonIfPresent(options.r602Path ?? DEFAULT_R602_PATH);
  const crelesLocal = creles ? summarizeCreles(creles) : { reason: "missing_artifact", status: "missing" } as const;
  const midusToCreles = transport
    ? summarizeTransport(transport)
    : { reason: "missing_artifact", status: "missing" } as const;
  const output: R603TransportReadinessPacket = {
    boundary: {
      aggregateOnly: true,
      calibrationParametersStored: false,
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
    packetId: "r603-creles-transport-readiness",
    readiness: {
      conclusion: transportConclusion(midusToCreles),
      nextReviewQuestion: "Given R602's transport-first recommendation and the CRELES aggregate transport stress, should Murph Age stop this residual candidate family, narrow to parsimonious glycemia/body signals, or implement a stronger external transport runner next?",
    },
    r602Consensus: summarizeR602(r602),
    schemaVersion: R603_TRANSPORT_READINESS_PACKET_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    transport: {
      crelesLocal,
      midusToCreles,
    },
  };
  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R603 transport-readiness packet failed aggregate-egress validation: ${findings.join("; ")}`);
  }
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function summarizeCreles(value: unknown): R603TransportReadinessPacket["transport"]["crelesLocal"] {
  const root = requiredRecord(value, "CRELES local artifact");
  assertBoundaryFlags(root, "CRELES local artifact");
  const dataShape = requiredRecord(root.dataShape, "CRELES data shape");
  const splitCounts = requiredRecord(dataShape.splitCounts, "CRELES split counts");
  const testSplit = requiredRecord(splitCounts.test, "CRELES test split");
  const models = requiredRecord(root.models, "CRELES models");
  const reference = metricAt(models.age_sex_reference, "CRELES age/sex reference");
  return {
    benchmarkId: requiredString(root.benchmarkId, "CRELES benchmark id"),
    countBands: {
      eligibleRows: countBand(requiredNumber(dataShape.eligibleRows, "CRELES eligible rows")),
      eventCount: countBand(requiredNumber(dataShape.events, "CRELES events")),
      testEventCount: countBand(requiredNumber(testSplit.events, "CRELES test events")),
      testRows: countBand(requiredNumber(testSplit.n, "CRELES test rows")),
    },
    endpoint: requiredString(root.endpoint, "CRELES endpoint"),
    models: summarizeModels(models, reference),
    status: "available",
  };
}

function summarizeTransport(value: unknown): R603TransportReadinessPacket["transport"]["midusToCreles"] {
  const root = requiredRecord(value, "MIDUS-to-CRELES transport artifact");
  assertBoundaryFlags(root, "MIDUS-to-CRELES transport artifact");
  const dataShape = requiredRecord(root.targetDataShape, "transport target data shape");
  const splitCounts = requiredRecord(dataShape.splitCounts, "transport split counts");
  const testSplit = requiredRecord(splitCounts.test, "transport test split");
  const models = requiredRecord(root.transportModels, "transport models");
  const reference = metricAt(models.creles_age_sex_reference, "transport CRELES age/sex reference");
  const endpointComparison = requiredRecord(root.endpointComparison, "transport endpoint comparison");
  const sourceModel = requiredRecord(root.sourceModel, "transport source model");
  return {
    benchmarkId: requiredString(root.benchmarkId, "transport benchmark id"),
    countBands: {
      completeCaseRows: countBand(requiredNumber(dataShape.completeCaseRows, "transport complete cases")),
      eventCount: countBand(requiredNumber(dataShape.events, "transport events")),
      testEventCount: countBand(requiredNumber(testSplit.events, "transport test events")),
      testRows: countBand(requiredNumber(testSplit.n, "transport test rows")),
    },
    endpointMismatchPolicy: requiredString(endpointComparison.mismatchPolicy, "transport mismatch policy"),
    models: summarizeModels(models, reference),
    sourceModelFeatureKeys: readStringArray(sourceModel.featureKeys, "transport source feature keys"),
    status: "available",
  };
}

function summarizeModels(models: Record<string, unknown>, reference: MetricSummary): ModelSummary[] {
  return Object.entries(models).map(([modelId, value]) => {
    const model = requiredRecord(value, `${modelId} model`);
    const metrics = metricAt(model, `${modelId} model`);
    return {
      candidateRole: requiredString(model.candidateRole, `${modelId} candidate role`),
      featureKeys: readStringArray(model.featureKeys, `${modelId} feature keys`),
      metricDeltasVsReference: {
        aucDelta: metrics.auc === null || reference.auc === null ? null : roundMetric(metrics.auc - reference.auc),
        brierDelta: roundMetric(metrics.brier - reference.brier),
        logLossDelta: roundMetric(metrics.logLoss - reference.logLoss),
      },
      metrics,
      modelId,
    };
  });
}

function summarizeR602(value: unknown | null): R603TransportReadinessPacket["r602Consensus"] {
  if (!value) {
    return {
      strongestInternalCandidate: null,
      transportStressRecommended: null,
    };
  }
  const root = requiredRecord(value, "R602 packet");
  const summary = requiredRecord(root.summary, "R602 summary");
  return {
    strongestInternalCandidate: requiredString(summary.strongestInternalCandidate, "R602 strongest candidate"),
    transportStressRecommended: true,
  };
}

function transportConclusion(value: R603TransportReadinessPacket["transport"]["midusToCreles"]): R603TransportReadinessPacket["readiness"]["conclusion"] {
  if (value.status !== "available") return "transport_signal_not_confirmed";
  const source = value.models.find((model) => model.modelId === "midus2_lab5_source_creles_recalibrated");
  const reference = value.models.find((model) => model.modelId === "creles_age_sex_reference");
  if (!source || !reference) return "transport_signal_not_confirmed";
  const betterProperScores = source.metrics.brier < reference.metrics.brier && source.metrics.logLoss < reference.metrics.logLoss;
  const noWorseDiscrimination = source.metrics.auc !== null && reference.metrics.auc !== null && source.metrics.auc >= reference.metrics.auc;
  return betterProperScores && noWorseDiscrimination ? "transport_ready_for_review" : "transport_signal_not_confirmed";
}

function metricAt(model: unknown, label: string): MetricSummary {
  const record = requiredRecord(model, label);
  const splitMetrics = requiredRecord(record.splitMetrics, `${label} split metrics`);
  const test = requiredRecord(splitMetrics.test, `${label} test metrics`);
  return {
    auc: test.auc === null ? null : roundMetric(requiredNumber(test.auc, `${label} auc`)),
    brier: roundMetric(requiredNumber(test.brier, `${label} brier`)),
    logLoss: roundMetric(requiredNumber(test.logLoss, `${label} logLoss`)),
    meanPrediction: roundMetric(requiredNumber(test.meanPrediction, `${label} mean prediction`)),
    observedRate: roundMetric(requiredNumber(test.observedRate, `${label} observed rate`)),
  };
}

function assertBoundaryFlags(root: Record<string, unknown>, label: string): void {
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
    if (root[key] !== false) throw new Error(`${label} has unsafe boundary flag ${key}.`);
  }
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") return null;
    throw new Error("Failed to read a Murph Age transport artifact.");
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
  runR603TransportReadinessPacket({
    crelesPath: process.env.MURPH_AGE_CRELES_OUTPUT_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r602Path: process.env.MURPH_AGE_R602_PACKET_PATH,
    transportPath: process.env.MURPH_AGE_MIDUS_CRELES_TRANSPORT_OUTPUT_PATH,
  }).then(({ output: packet, outputPath }) => {
    console.log(JSON.stringify({
      artifact: path.basename(outputPath),
      conclusion: packet.readiness.conclusion,
      packetId: packet.packetId,
      productPromotionAuthorized: packet.boundary.productPromotionAuthorized,
      schemaVersion: packet.schemaVersion,
      status: packet.status,
    }, null, 2));
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "R603 transport-readiness packet failed.");
    process.exitCode = 1;
  });
}
