import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  runR1104ConsumerAggregateReceiptValidator,
  type R1104ConsumerAggregateReceiptInput,
} from "./r1104-consumer-aggregate-receipt-validator.ts";

export const R1105_CONSUMER_AGGREGATE_RECEIPT_TEMPLATE_SCHEMA_VERSION =
  "murph-age-r1105-consumer-aggregate-receipt-template.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1105-consumer-aggregate-receipt-template.latest.json";
const RECEIPT_TEMPLATE_FILE_NAME = "r1105-fillable-consumer-aggregate-receipt-template.json";

type CandidateResult = R1104ConsumerAggregateReceiptInput["candidateResults"][number];

const CANDIDATE_ROWS: Array<Pick<CandidateResult, "candidateId" | "candidateKind" | "comparatorId" | "missingnessOrCoverageControlStatus">> = [
  {
    candidateId: "L1_tiny_glycemia_only",
    candidateKind: "lab",
    comparatorId: "frozen_recalibrated_r399",
    missingnessOrCoverageControlStatus: "not_applicable",
  },
  {
    candidateId: "L2_common_lab_core_shadow",
    candidateKind: "lab",
    comparatorId: "l1_tiny_glycemia_only",
    missingnessOrCoverageControlStatus: "not_applicable",
  },
  {
    candidateId: "W1_activity_steps_minutes",
    candidateKind: "wearable",
    comparatorId: "frozen_recalibrated_r399",
    missingnessOrCoverageControlStatus: "missing",
  },
  {
    candidateId: "W2_sleep_duration_regularity",
    candidateKind: "wearable",
    comparatorId: "frozen_recalibrated_r399",
    missingnessOrCoverageControlStatus: "missing",
  },
  {
    candidateId: "W3_rhr_hrv_recovery",
    candidateKind: "wearable",
    comparatorId: "frozen_recalibrated_r399",
    missingnessOrCoverageControlStatus: "missing",
  },
  {
    candidateId: "QC_missingness_coverage",
    candidateKind: "negative_control",
    comparatorId: "frozen_recalibrated_r399",
    missingnessOrCoverageControlStatus: "not_applicable",
  },
  {
    candidateId: "I1_integrated_lab_wearable_small_panel",
    candidateKind: "integrated",
    comparatorId: "best_validated_single_family",
    missingnessOrCoverageControlStatus: "missing",
  },
];

export interface R1105ConsumerAggregateReceiptTemplateOptions {
  createdAt?: string;
  outputDir?: string;
}

export interface R1105ConsumerAggregateReceiptTemplateOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1105: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  fillableReceiptTemplate: R1104ConsumerAggregateReceiptInput;
  packetId: "r1105-consumer-aggregate-receipt-template";
  productDisplayAuthorized: false;
  receiptTemplateArtifact: "r1105-fillable-consumer-aggregate-receipt-template.json";
  schemaVersion: typeof R1105_CONSUMER_AGGREGATE_RECEIPT_TEMPLATE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    candidateResultCount: number;
    nextValidationCommand: "MURPH_AGE_CONSUMER_AGGREGATE_RECEIPT_PATH=<receipt.json> pnpm exec tsx scripts/murph-age/r1104-consumer-aggregate-receipt-validator.ts";
    productDisplayAuthorized: false;
    reviewGptUse: "only_if_r1104_returns_aggregate_receipt_ready_for_reviewgpt";
    templateReadyForDataFill: true;
    templateValidatorConclusion: "consumer_aggregate_receipt_no_science_delta";
  };
}

export async function runR1105ConsumerAggregateReceiptTemplate(
  options: R1105ConsumerAggregateReceiptTemplateOptions = {},
): Promise<{ output: R1105ConsumerAggregateReceiptTemplateOutput; outputPath: string; receiptTemplatePath: string }> {
  const fillableReceiptTemplate = createFillableReceiptTemplate();
  const templateValidatorConclusion = await validateTemplateWithR1104(fillableReceiptTemplate);
  const output: R1105ConsumerAggregateReceiptTemplateOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    fillableReceiptTemplate,
    packetId: "r1105-consumer-aggregate-receipt-template",
    productDisplayAuthorized: false,
    receiptTemplateArtifact: RECEIPT_TEMPLATE_FILE_NAME,
    schemaVersion: R1105_CONSUMER_AGGREGATE_RECEIPT_TEMPLATE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      candidateResultCount: fillableReceiptTemplate.candidateResults.length,
      nextValidationCommand:
        "MURPH_AGE_CONSUMER_AGGREGATE_RECEIPT_PATH=<receipt.json> pnpm exec tsx scripts/murph-age/r1104-consumer-aggregate-receipt-validator.ts",
      productDisplayAuthorized: false,
      reviewGptUse: "only_if_r1104_returns_aggregate_receipt_ready_for_reviewgpt",
      templateReadyForDataFill: true,
      templateValidatorConclusion,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1105 consumer aggregate receipt template failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  const receiptTemplatePath = path.join(outputDir, RECEIPT_TEMPLATE_FILE_NAME);
  await Promise.all([
    writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`),
    writeFile(receiptTemplatePath, `${JSON.stringify(fillableReceiptTemplate, null, 2)}\n`),
  ]);
  return { output, outputPath, receiptTemplatePath };
}

function createFillableReceiptTemplate(): R1104ConsumerAggregateReceiptInput {
  return {
    artifactBoundary: safeBoundary(),
    candidateResults: CANDIDATE_ROWS.map((candidate) => ({
      aucDelta: null,
      brierDelta: null,
      calibrationStatus: "missing",
      candidateId: candidate.candidateId,
      candidateKind: candidate.candidateKind,
      comparatorId: candidate.comparatorId,
      coverageStatus: "missing",
      evidenceSupport: "underpowered",
      logLossDelta: null,
      missingnessOrCoverageControlStatus: candidate.missingnessOrCoverageControlStatus,
    })),
    evaluatorId: "consumer_lab_wearable_aggregate_evaluator_v1",
    packetId: "fill-this-consumer-aggregate-receipt",
    receiptAttestations: {
      aggregateOnly: true,
      endpointFrozenBeforeScoring: true,
      evaluatorFrozenBeforeExecution: true,
      noCoefficientEgress: true,
      noParticipantEgress: true,
      noPredictionEgress: true,
      noRowEgress: true,
      noSmallCellEgress: true,
      sameDenominatorComparisons: true,
    },
    schemaVersion: "murph-age-consumer-lab-wearable-aggregate-receipt.v1",
  };
}

async function validateTemplateWithR1104(
  receipt: R1104ConsumerAggregateReceiptInput,
): Promise<R1105ConsumerAggregateReceiptTemplateOutput["summary"]["templateValidatorConclusion"]> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1105-r1104-"));
  try {
    const { output } = await runR1104ConsumerAggregateReceiptValidator({
      aggregateReceipt: receipt,
      outputDir: tmp,
    });
    if (output.reduction.conclusion !== "consumer_aggregate_receipt_no_science_delta") {
      throw new Error("R1105 template receipt should validate but not create a scientific delta before metrics are filled.");
    }
    return output.reduction.conclusion;
  } finally {
    await rm(tmp, { force: true, recursive: true });
  }
}

function safeBoundary(): R1105ConsumerAggregateReceiptTemplateOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1105: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1105ConsumerAggregateReceiptTemplate({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  });
  process.stdout.write(`${JSON.stringify({
    candidateResultCount: output.summary.candidateResultCount,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    rowParsingPerformedByR1105: output.artifactBoundary.rowParsingPerformedByR1105,
    schemaVersion: output.schemaVersion,
    status: output.status,
    templateReadyForDataFill: output.summary.templateReadyForDataFill,
    templateValidatorConclusion: output.summary.templateValidatorConclusion,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1105 consumer aggregate receipt template failed."}\n`);
    process.exitCode = 1;
  });
}
