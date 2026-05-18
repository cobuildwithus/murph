import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1034_LABS_WEARABLES_AGGREGATE_REDUCER_SCHEMA_VERSION =
  "murph-age-r1034-labs-wearables-aggregate-reducer.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1034-labs-wearables-aggregate-reducer.latest.json";

type CandidateRole = "score_bearing_research_candidate" | "negative_control" | "reference_only";
type Decision =
  | "send_reviewgpt_aggregate_delta"
  | "keep_shadow_or_reference"
  | "reject_or_hold_candidate";

interface AggregateBoundary {
  aggregateOnly?: boolean;
  codebookTextStored?: boolean;
  coefficientsStored?: boolean;
  localPathsStored?: boolean;
  modelParametersStored?: boolean;
  participantIdentifiersStored?: boolean;
  predictionsStored?: boolean;
  productClaimsIncluded?: boolean;
  productDisplayAuthorized?: boolean;
  productPromotionAuthorized?: boolean;
  rowValuesStored?: boolean;
  smallCellsStored?: boolean;
  sourceBodiesStored?: boolean;
  splitMembershipStored?: boolean;
}

export interface R1034AggregateCandidateMetric {
  aucDelta: number | null;
  brierDelta: number | null;
  calibrationSlope: number | null;
  candidateId: string;
  comparatorId: string;
  eOverO: number | null;
  logLossDelta: number | null;
  negativeControlStatus: "not_applicable" | "beaten" | "not_beaten";
  role: CandidateRole;
  subgroupCalibrationStatus: "stable" | "unstable" | "not_reportable";
}

export interface R1034AggregateReceiptInput {
  artifactBoundary?: AggregateBoundary;
  benchmarkCardId: string;
  candidateMetrics: R1034AggregateCandidateMetric[];
  endpoint: string;
  eventCountBand: string;
  horizon: string;
  packetId: string;
  schemaVersion: string;
}

interface CandidateDecision {
  calibrationAcceptable: boolean;
  candidateId: string;
  comparatorId: string;
  decision: Decision;
  negativeControlBeaten: boolean;
  properScoresImproved: boolean;
  role: CandidateRole;
  subgroupCalibrationAcceptable: boolean;
}

export interface R1034LabsWearablesAggregateReducerOptions {
  aggregateReceipt?: R1034AggregateReceiptInput | null;
  aggregateReceiptPath?: string;
  createdAt?: string;
  outputDir?: string;
}

export interface R1034LabsWearablesAggregateReducerOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1034: false;
    participantIdentifiersStored: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    rowParsingPerformedByR1034: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputReceipt: {
    benchmarkCardId: string | null;
    candidateCountBand: string;
    endpoint: string | null;
    eventCountBand: string | null;
    horizon: string | null;
    packetId: string | null;
    schemaVersion: string | null;
    status: "available" | "missing";
  };
  packetId: "r1034-labs-wearables-aggregate-reducer";
  reduction: {
    candidateDecisions: CandidateDecision[];
    conclusion:
      | "aggregate_receipt_missing"
      | "aggregate_delta_ready_for_reviewgpt"
      | "no_meaningful_delta_keep_shadow_or_reference";
    reviewGptRequired: boolean;
  };
  schemaVersion: typeof R1034_LABS_WEARABLES_AGGREGATE_REDUCER_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "aggregate_receipt_missing"
      | "aggregate_delta_ready_for_reviewgpt"
      | "no_meaningful_delta_keep_shadow_or_reference";
    productDisplayAuthorized: false;
    reviewGptRequired: boolean;
    rowParsingPerformedByR1034: false;
  };
}

export async function runR1034LabsWearablesAggregateReducer(
  options: R1034LabsWearablesAggregateReducerOptions = {},
): Promise<{ output: R1034LabsWearablesAggregateReducerOutput; outputPath: string }> {
  const receipt = options.aggregateReceipt ?? await readReceiptFromPath(options.aggregateReceiptPath);
  if (receipt) validateReceipt(receipt);
  const candidateDecisions = receipt ? receipt.candidateMetrics.map(decisionForCandidate) : [];
  const reviewGptRequired = candidateDecisions.some((decision) => decision.decision === "send_reviewgpt_aggregate_delta");
  const conclusion = !receipt
    ? "aggregate_receipt_missing"
    : reviewGptRequired
      ? "aggregate_delta_ready_for_reviewgpt"
      : "no_meaningful_delta_keep_shadow_or_reference";

  const output: R1034LabsWearablesAggregateReducerOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      localFileNamesStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      outcomeScoringPerformedByR1034: false,
      participantIdentifiersStored: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      rowParsingPerformedByR1034: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputReceipt: receipt ? {
      benchmarkCardId: receipt.benchmarkCardId,
      candidateCountBand: countBand(receipt.candidateMetrics.length),
      endpoint: receipt.endpoint,
      eventCountBand: receipt.eventCountBand,
      horizon: receipt.horizon,
      packetId: receipt.packetId,
      schemaVersion: receipt.schemaVersion,
      status: "available",
    } : {
      benchmarkCardId: null,
      candidateCountBand: "0",
      endpoint: null,
      eventCountBand: null,
      horizon: null,
      packetId: null,
      schemaVersion: null,
      status: "missing",
    },
    packetId: "r1034-labs-wearables-aggregate-reducer",
    reduction: {
      candidateDecisions,
      conclusion,
      reviewGptRequired,
    },
    schemaVersion: R1034_LABS_WEARABLES_AGGREGATE_REDUCER_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      productDisplayAuthorized: false,
      reviewGptRequired,
      rowParsingPerformedByR1034: false,
    },
  };

  assertR1034Safe(output);
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

export function assertR1034Safe(output: R1034LabsWearablesAggregateReducerOutput): void {
  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findR1034SpecificFindings(output),
  ];
  if (findings.length > 0) {
    throw new Error(`R1034 labs/wearables aggregate reducer failed safety validation: ${findings.join("; ")}`);
  }
}

async function readReceiptFromPath(aggregateReceiptPath: string | undefined): Promise<R1034AggregateReceiptInput | null> {
  if (!aggregateReceiptPath) return null;
  const parsed = JSON.parse(await readFile(aggregateReceiptPath, "utf8")) as unknown;
  return requireReceipt(parsed);
}

function validateReceipt(receipt: R1034AggregateReceiptInput): void {
  const boundaryFindings = findForbiddenAggregateEgress(receipt);
  if (boundaryFindings.length > 0) {
    throw new Error(`R1034 input aggregate receipt failed safety validation: ${boundaryFindings.join("; ")}`);
  }
  if (!receipt.packetId || !receipt.schemaVersion || !receipt.benchmarkCardId) {
    throw new Error("R1034 aggregate receipt requires packetId, schemaVersion, and benchmarkCardId.");
  }
  if (!Array.isArray(receipt.candidateMetrics)) {
    throw new Error("R1034 aggregate receipt requires candidateMetrics.");
  }
}

function requireReceipt(value: unknown): R1034AggregateReceiptInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("R1034 aggregate receipt must be an object.");
  }
  const receipt = value as R1034AggregateReceiptInput;
  validateReceipt(receipt);
  return receipt;
}

function decisionForCandidate(metric: R1034AggregateCandidateMetric): CandidateDecision {
  const properScoresImproved = (metric.brierDelta !== null && metric.brierDelta < 0)
    || (metric.logLossDelta !== null && metric.logLossDelta < 0);
  const calibrationAcceptable = metric.calibrationSlope !== null
    && metric.calibrationSlope >= 0.9
    && metric.calibrationSlope <= 1.1
    && metric.eOverO !== null
    && metric.eOverO >= 0.95
    && metric.eOverO <= 1.05;
  const subgroupCalibrationAcceptable = metric.subgroupCalibrationStatus === "stable"
    || metric.subgroupCalibrationStatus === "not_reportable";
  const negativeControlBeaten = metric.negativeControlStatus === "beaten"
    || metric.negativeControlStatus === "not_applicable";
  const decision: Decision = metric.role !== "score_bearing_research_candidate"
    ? "keep_shadow_or_reference"
    : properScoresImproved && calibrationAcceptable && subgroupCalibrationAcceptable && negativeControlBeaten
      ? "send_reviewgpt_aggregate_delta"
      : "reject_or_hold_candidate";

  return {
    calibrationAcceptable,
    candidateId: metric.candidateId,
    comparatorId: metric.comparatorId,
    decision,
    negativeControlBeaten,
    properScoresImproved,
    role: metric.role,
    subgroupCalibrationAcceptable,
  };
}

function countBand(count: number): string {
  if (count === 0) return "0";
  if (count < 10) return "1-9";
  if (count < 100) return "10-99";
  return "100+";
}

function findR1034SpecificFindings(output: R1034LabsWearablesAggregateReducerOutput): string[] {
  const findings: string[] = [];
  if (output.summary.productDisplayAuthorized !== false) {
    findings.push("summary.productDisplayAuthorized must remain false");
  }
  if (output.summary.rowParsingPerformedByR1034 !== false) {
    findings.push("R1034 must not parse rows");
  }
  if (output.artifactBoundary.outcomeScoringPerformedByR1034 !== false) {
    findings.push("R1034 must not perform outcome scoring");
  }
  return findings;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR1034LabsWearablesAggregateReducer({
    aggregateReceiptPath: process.env.MURPH_AGE_R1034_AGGREGATE_RECEIPT_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  }).then(({ output }) => {
    process.stdout.write(`${JSON.stringify({
      candidateCountBand: output.inputReceipt.candidateCountBand,
      conclusion: output.summary.conclusion,
      packetId: output.packetId,
      productDisplayAuthorized: output.summary.productDisplayAuthorized,
      reviewGptRequired: output.summary.reviewGptRequired,
      rowParsingPerformedByR1034: output.summary.rowParsingPerformedByR1034,
      schemaVersion: output.schemaVersion,
      status: output.status,
    }, null, 2)}\n`);
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
