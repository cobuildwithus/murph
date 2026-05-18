import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1104_CONSUMER_AGGREGATE_RECEIPT_VALIDATOR_SCHEMA_VERSION =
  "murph-age-r1104-consumer-aggregate-receipt-validator.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1104-consumer-aggregate-receipt-validator.latest.json";

const ALLOWED_CANDIDATES = [
  "L1_tiny_glycemia_only",
  "L2_common_lab_core_shadow",
  "W1_activity_steps_minutes",
  "W2_sleep_duration_regularity",
  "W3_rhr_hrv_recovery",
  "QC_missingness_coverage",
  "I1_integrated_lab_wearable_small_panel",
] as const;

type CandidateId = typeof ALLOWED_CANDIDATES[number];
type CandidateKind = "integrated" | "lab" | "negative_control" | "wearable";
type CandidateDecision = "hold_or_reject" | "keep_reference_or_control" | "send_reviewgpt_science_delta";
type EvidenceSupport = "one_receipt_100_plus_events" | "two_independent_50_plus_event_receipts" | "underpowered";
type GateStatus = "missing" | "non_worse" | "not_applicable" | "worse";

export interface R1104ConsumerAggregateReceiptCandidateResult {
  aucDelta: number | null;
  brierDelta: number | null;
  calibrationStatus: GateStatus;
  candidateId: CandidateId;
  candidateKind: CandidateKind;
  comparatorId: "frozen_recalibrated_r399" | "l1_tiny_glycemia_only" | "best_validated_single_family";
  coverageStatus: "consumer_viable" | "missing" | "sparse_or_biased";
  evidenceSupport: EvidenceSupport;
  logLossDelta: number | null;
  missingnessOrCoverageControlStatus: "beaten" | "missing" | "not_applicable" | "not_beaten";
}

export interface R1104ConsumerAggregateReceiptInput {
  artifactBoundary: {
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
  };
  candidateResults: R1104ConsumerAggregateReceiptCandidateResult[];
  evaluatorId: "consumer_lab_wearable_aggregate_evaluator_v1";
  packetId: string;
  receiptAttestations: {
    aggregateOnly: true;
    endpointFrozenBeforeScoring: boolean;
    evaluatorFrozenBeforeExecution: boolean;
    noCoefficientEgress: true;
    noParticipantEgress: true;
    noPredictionEgress: true;
    noRowEgress: true;
    noSmallCellEgress: true;
    sameDenominatorComparisons: boolean;
  };
  schemaVersion: "murph-age-consumer-lab-wearable-aggregate-receipt.v1";
}

interface CandidateReduction {
  calibrationAcceptable: boolean;
  candidateId: CandidateId;
  comparatorId: R1104ConsumerAggregateReceiptCandidateResult["comparatorId"];
  coverageAcceptable: boolean;
  decision: CandidateDecision;
  evidenceAdequate: boolean;
  missingnessOrCoverageControlAcceptable: boolean;
  properScoresImproved: boolean;
  thresholdReason: string;
}

export interface R1104ConsumerAggregateReceiptValidatorOptions {
  aggregateReceipt?: R1104ConsumerAggregateReceiptInput | null;
  aggregateReceiptPath?: string;
  createdAt?: string;
  outputDir?: string;
}

export interface R1104ConsumerAggregateReceiptValidatorOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1104: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1104: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputReceipt: {
    candidateCountBand: "0" | "1-9" | "10-99";
    evaluatorId: R1104ConsumerAggregateReceiptInput["evaluatorId"] | null;
    packetId: string | null;
    schemaVersion: R1104ConsumerAggregateReceiptInput["schemaVersion"] | null;
    status: "available" | "missing";
  };
  packetId: "r1104-consumer-aggregate-receipt-validator";
  productDisplayAuthorized: false;
  reduction: {
    candidateDecisions: CandidateReduction[];
    conclusion:
      | "awaiting_consumer_aggregate_receipt"
      | "consumer_aggregate_receipt_no_science_delta"
      | "consumer_aggregate_receipt_ready_for_reviewgpt";
    reviewGptRequired: boolean;
  };
  schemaVersion: typeof R1104_CONSUMER_AGGREGATE_RECEIPT_VALIDATOR_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "aggregate_receipt_missing"
      | "aggregate_receipt_valid_but_no_delta"
      | "aggregate_receipt_ready_for_reviewgpt";
    productDisplayAuthorized: false;
    reviewGptUse: "only_for_valid_scientific_delta";
    rowParsingPerformedByR1104: false;
  };
}

export async function runR1104ConsumerAggregateReceiptValidator(
  options: R1104ConsumerAggregateReceiptValidatorOptions = {},
): Promise<{ output: R1104ConsumerAggregateReceiptValidatorOutput; outputPath: string }> {
  const receipt = options.aggregateReceipt ?? await readReceiptFromPath(options.aggregateReceiptPath);
  if (receipt) validateReceipt(receipt);
  const candidateDecisions = receipt ? receipt.candidateResults.map(decideCandidate) : [];
  const reviewGptRequired = candidateDecisions.some((decision) => decision.decision === "send_reviewgpt_science_delta");
  const conclusion = !receipt
    ? "awaiting_consumer_aggregate_receipt"
    : reviewGptRequired
      ? "consumer_aggregate_receipt_ready_for_reviewgpt"
      : "consumer_aggregate_receipt_no_science_delta";

  const output: R1104ConsumerAggregateReceiptValidatorOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputReceipt: {
      candidateCountBand: countBand(receipt?.candidateResults.length ?? 0),
      evaluatorId: receipt?.evaluatorId ?? null,
      packetId: receipt ? "aggregate_receipt_received" : null,
      schemaVersion: receipt?.schemaVersion ?? null,
      status: receipt ? "available" : "missing",
    },
    packetId: "r1104-consumer-aggregate-receipt-validator",
    productDisplayAuthorized: false,
    reduction: {
      candidateDecisions,
      conclusion,
      reviewGptRequired,
    },
    schemaVersion: R1104_CONSUMER_AGGREGATE_RECEIPT_VALIDATOR_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: !receipt
        ? "aggregate_receipt_missing"
        : reviewGptRequired
          ? "aggregate_receipt_ready_for_reviewgpt"
          : "aggregate_receipt_valid_but_no_delta",
      productDisplayAuthorized: false,
      reviewGptUse: "only_for_valid_scientific_delta",
      rowParsingPerformedByR1104: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1104 consumer aggregate receipt validator failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function validateReceipt(receipt: R1104ConsumerAggregateReceiptInput): void {
  const findings = findForbiddenAggregateEgress(receipt);
  if (findings.length > 0) {
    throw new Error(`R1104 rejected unsafe aggregate receipt: ${formatFindingCount(findings)}`);
  }
  if (receipt.schemaVersion !== "murph-age-consumer-lab-wearable-aggregate-receipt.v1") {
    throw new Error("R1104 aggregate receipt has an unsupported schemaVersion.");
  }
  if (receipt.evaluatorId !== "consumer_lab_wearable_aggregate_evaluator_v1") {
    throw new Error("R1104 aggregate receipt has an unsupported evaluatorId.");
  }
  const attestations = receipt.receiptAttestations;
  const attestationOk = attestations.aggregateOnly
    && attestations.endpointFrozenBeforeScoring
    && attestations.evaluatorFrozenBeforeExecution
    && attestations.noCoefficientEgress
    && attestations.noParticipantEgress
    && attestations.noPredictionEgress
    && attestations.noRowEgress
    && attestations.noSmallCellEgress
    && attestations.sameDenominatorComparisons;
  if (!attestationOk) {
    throw new Error("R1104 aggregate receipt is missing required aggregate-only attestations.");
  }
  for (const candidate of receipt.candidateResults) {
    if (!ALLOWED_CANDIDATES.includes(candidate.candidateId)) {
      throw new Error("R1104 aggregate receipt has an unsupported candidateId.");
    }
  }
}

function decideCandidate(candidate: R1104ConsumerAggregateReceiptCandidateResult): CandidateReduction {
  if (candidate.candidateKind === "negative_control") {
    return {
      calibrationAcceptable: true,
      candidateId: candidate.candidateId,
      comparatorId: candidate.comparatorId,
      coverageAcceptable: true,
      decision: "keep_reference_or_control",
      evidenceAdequate: true,
      missingnessOrCoverageControlAcceptable: true,
      properScoresImproved: false,
      thresholdReason: "negative_control_not_score_bearing",
    };
  }
  const evidenceAdequate = candidate.evidenceSupport !== "underpowered";
  const properScoresImproved = candidate.logLossDelta !== null
    && candidate.logLossDelta <= -0.002
    && candidate.brierDelta !== null
    && candidate.brierDelta <= -0.0005;
  const calibrationAcceptable = candidate.calibrationStatus === "non_worse" || candidate.calibrationStatus === "not_applicable";
  const coverageAcceptable = candidate.coverageStatus === "consumer_viable";
  const missingnessOrCoverageControlAcceptable = candidate.missingnessOrCoverageControlStatus === "beaten"
    || candidate.missingnessOrCoverageControlStatus === "not_applicable";
  const aucAcceptable = candidate.candidateKind === "wearable"
    ? candidate.aucDelta !== null && candidate.aucDelta >= 0.01
    : candidate.aucDelta !== null && candidate.aucDelta >= 0.005;
  const ready = evidenceAdequate
    && properScoresImproved
    && calibrationAcceptable
    && coverageAcceptable
    && missingnessOrCoverageControlAcceptable
    && aucAcceptable;

  return {
    calibrationAcceptable,
    candidateId: candidate.candidateId,
    comparatorId: candidate.comparatorId,
    coverageAcceptable,
    decision: ready ? "send_reviewgpt_science_delta" : "hold_or_reject",
    evidenceAdequate,
    missingnessOrCoverageControlAcceptable,
    properScoresImproved,
    thresholdReason: ready
      ? "aggregate_threshold_cleared"
      : "aggregate_threshold_not_cleared",
  };
}

async function readReceiptFromPath(filePath?: string): Promise<R1104ConsumerAggregateReceiptInput | null> {
  if (!filePath?.trim()) return null;
  return JSON.parse(await readFile(filePath, "utf8")) as R1104ConsumerAggregateReceiptInput;
}

function countBand(count: number): "0" | "1-9" | "10-99" {
  if (count <= 0) return "0";
  if (count < 10) return "1-9";
  return "10-99";
}

function formatFindingCount(findings: readonly string[]): string {
  return `${findings.length} aggregate-egress violation${findings.length === 1 ? "" : "s"}`;
}

function safeBoundary(): R1104ConsumerAggregateReceiptValidatorOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1104: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1104: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1104ConsumerAggregateReceiptValidator({
    aggregateReceiptPath: process.env.MURPH_AGE_CONSUMER_AGGREGATE_RECEIPT_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  });
  process.stdout.write(`${JSON.stringify({
    candidateCountBand: output.inputReceipt.candidateCountBand,
    conclusion: output.summary.conclusion,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    reviewGptRequired: output.reduction.reviewGptRequired,
    rowParsingPerformedByR1104: output.summary.rowParsingPerformedByR1104,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1104 consumer aggregate receipt validator failed."}\n`);
    process.exitCode = 1;
  });
}
