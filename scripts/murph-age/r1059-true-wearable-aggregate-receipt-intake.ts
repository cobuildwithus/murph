import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { runR1051PartnerWearableAggregateEvaluator } from "./r1051-partner-wearable-aggregate-evaluator.ts";
import { runR1058TrueWearablePartnerValidationReadiness } from "./r1058-true-wearable-partner-validation-readiness.ts";

export const R1059_TRUE_WEARABLE_AGGREGATE_RECEIPT_INTAKE_SCHEMA_VERSION =
  "murph-age-r1059-true-wearable-aggregate-receipt-intake.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1059-true-wearable-aggregate-receipt-intake.latest.json";

export interface R1059TrueWearableAggregateReceiptIntakeOptions {
  aggregateReceiptPath?: string;
  createdAt?: string;
  outputDir?: string;
  r1057Path?: string;
}

export interface R1059TrueWearableAggregateReceiptIntakeOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1059: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1059: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  intake: {
    aggregateReceiptProvided: boolean;
    candidateCountBand: "0" | "1-9" | "10-99";
    evaluatorConclusion:
      | "awaiting_partner_or_workbench_aggregate_receipt"
      | "partner_wearable_delta_not_ready"
      | "partner_wearable_delta_ready_for_scientific_review";
    nextAction:
      | "await_true_wearable_aggregate_receipt"
      | "hold_receipt_no_scientific_delta"
      | "send_aggregate_delta_to_reviewgpt";
    readinessConclusion:
      | "partner_delta_ready_for_reviewgpt_science_review"
      | "true_wearable_validation_package_ready_awaiting_receipt"
      | "true_wearable_validation_readiness_inputs_missing";
    reviewGptRequired: boolean;
  };
  packetId: "r1059-true-wearable-aggregate-receipt-intake";
  productPolicy: {
    displayAuthorized: false;
    promotionAuthorized: false;
    productClaimsAuthorized: false;
    recommendationClaimsAuthorized: false;
  };
  schemaVersion: typeof R1059_TRUE_WEARABLE_AGGREGATE_RECEIPT_INTAKE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "aggregate_receipt_missing"
      | "aggregate_receipt_ready_for_reviewgpt"
      | "aggregate_receipt_valid_but_no_delta";
    productDisplayAuthorized: false;
    reviewGptUse: "only_for_valid_scientific_delta";
    rowParsingPerformedByR1059: false;
  };
}

export async function runR1059TrueWearableAggregateReceiptIntake(
  options: R1059TrueWearableAggregateReceiptIntakeOptions = {},
): Promise<{ output: R1059TrueWearableAggregateReceiptIntakeOutput; outputPath: string }> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });

  if (options.aggregateReceiptPath) await validateReceiptFileBoundary(options.aggregateReceiptPath);
  const r1051 = await runR1051PartnerWearableAggregateEvaluator({
    aggregateReceiptPath: options.aggregateReceiptPath,
    createdAt: options.createdAt,
    outputDir,
  });
  const r1058 = await runR1058TrueWearablePartnerValidationReadiness({
    createdAt: options.createdAt,
    outputDir,
    r1051Path: r1051.outputPath,
    r1057Path: options.r1057Path,
  });

  const intake = {
    aggregateReceiptProvided: Boolean(options.aggregateReceiptPath),
    candidateCountBand: r1051.output.inputReceipt.candidateCountBand,
    evaluatorConclusion: r1051.output.reduction.conclusion,
    nextAction: nextAction(r1051.output.reduction.conclusion),
    readinessConclusion: r1058.output.readiness.conclusion,
    reviewGptRequired: r1051.output.reduction.reviewGptRequired || r1058.output.readiness.reviewGptRequiredBeforeNextLocalRun,
  } satisfies R1059TrueWearableAggregateReceiptIntakeOutput["intake"];
  const output: R1059TrueWearableAggregateReceiptIntakeOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      outcomeScoringPerformedByR1059: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR1059: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    intake,
    packetId: "r1059-true-wearable-aggregate-receipt-intake",
    productPolicy: {
      displayAuthorized: false,
      promotionAuthorized: false,
      productClaimsAuthorized: false,
      recommendationClaimsAuthorized: false,
    },
    schemaVersion: R1059_TRUE_WEARABLE_AGGREGATE_RECEIPT_INTAKE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: intake.evaluatorConclusion === "partner_wearable_delta_ready_for_scientific_review"
        ? "aggregate_receipt_ready_for_reviewgpt"
        : intake.evaluatorConclusion === "partner_wearable_delta_not_ready"
          ? "aggregate_receipt_valid_but_no_delta"
          : "aggregate_receipt_missing",
      productDisplayAuthorized: false,
      reviewGptUse: "only_for_valid_scientific_delta",
      rowParsingPerformedByR1059: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1059 true wearable aggregate receipt intake failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function nextAction(
  conclusion: R1059TrueWearableAggregateReceiptIntakeOutput["intake"]["evaluatorConclusion"],
): R1059TrueWearableAggregateReceiptIntakeOutput["intake"]["nextAction"] {
  if (conclusion === "partner_wearable_delta_ready_for_scientific_review") return "send_aggregate_delta_to_reviewgpt";
  if (conclusion === "partner_wearable_delta_not_ready") return "hold_receipt_no_scientific_delta";
  return "await_true_wearable_aggregate_receipt";
}

async function validateReceiptFileBoundary(filePath: string): Promise<void> {
  const value = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1059 input aggregate receipt failed aggregate boundary validation: ${findings.join("; ")}`);
  }
}

async function main(): Promise<void> {
  const { output } = await runR1059TrueWearableAggregateReceiptIntake({
    aggregateReceiptPath: process.env.MURPH_AGE_TRUE_WEARABLE_AGGREGATE_RECEIPT_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1057Path: process.env.MURPH_AGE_R1057_CANDIDATE_BATCH_RESULT_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    aggregateReceiptProvided: output.intake.aggregateReceiptProvided,
    candidateCountBand: output.intake.candidateCountBand,
    conclusion: output.summary.conclusion,
    nextAction: output.intake.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    reviewGptRequired: output.intake.reviewGptRequired,
    rowParsingPerformedByR1059: output.summary.rowParsingPerformedByR1059,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1059 true wearable aggregate receipt intake failed."}\n`);
    process.exitCode = 1;
  });
}
