import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { runR1068TrueWearableSourceActivationMatrix } from "./r1068-true-wearable-source-activation-matrix.ts";
import { runR1069NsrrDerivedRoleActivation } from "./r1069-nsrr-derived-role-activation.ts";
import { runR1070NsrrSleepAutonomicAggregateReceipt } from "./r1070-nsrr-sleep-autonomic-aggregate-receipt.ts";
import { runR1071NsrrValidationReadinessReducer } from "./r1071-nsrr-validation-readiness-reducer.ts";
import { runR1072TrueWearableValidationHandoffBundle } from "./r1072-true-wearable-validation-handoff-bundle.ts";
import { runR1073NsrrDerivedCohortReadinessIntake } from "./r1073-nsrr-derived-cohort-readiness-intake.ts";

export const R1074_TRUE_WEARABLE_POST_DOWNLOAD_REFRESH_SCHEMA_VERSION =
  "murph-age-r1074-true-wearable-post-download-refresh.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1074-true-wearable-post-download-refresh.latest.json";

interface ArtifactStep {
  conclusion: string | null;
  packetId: string;
  schemaVersion: string | null;
  status: string | null;
}

export interface R1074TrueWearablePostDownloadRefreshOptions {
  aggregateReceiptPath?: string;
  createdAt?: string;
  outputDir?: string;
  r1059Path?: string;
  r1061Path?: string;
  r1062Path?: string;
  scanRoots?: string[];
}

export interface R1074TrueWearablePostDownloadRefreshOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1074: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1074: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  finalHandoff: {
    conclusion: string;
    dataAsk: string;
    nextAction: string;
    reviewGptRequiredNow: boolean;
  };
  packetId: "r1074-true-wearable-post-download-refresh";
  productDisplayAuthorized: false;
  refreshSteps: ArtifactStep[];
  scanSummary: {
    rootCountBand: string;
    scanned: boolean;
  };
  schemaVersion: typeof R1074_TRUE_WEARABLE_POST_DOWNLOAD_REFRESH_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "post_download_refresh_blocked_on_data"
      | "post_download_refresh_blocked_on_receipt"
      | "post_download_refresh_delta_ready_for_reviewgpt";
    productDisplayAuthorized: false;
    reviewGptUse: "only_if_refreshed_handoff_has_real_aggregate_delta";
    rowParsingPerformedByR1074: false;
  };
}

export async function runR1074TrueWearablePostDownloadRefresh(
  options: R1074TrueWearablePostDownloadRefreshOptions = {},
): Promise<{ output: R1074TrueWearablePostDownloadRefreshOutput; outputPath: string }> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const scanRoots = options.scanRoots ?? scanRootsFromEnv();

  const r1068 = await runR1068TrueWearableSourceActivationMatrix({
    outputDir,
    r1059Path: options.r1059Path,
    r1061Path: options.r1061Path,
    scanRoots,
  });
  const r1069 = await runR1069NsrrDerivedRoleActivation({
    outputDir,
    r1068Path: r1068.outputPath,
    scanRoots,
  });
  const r1073 = await runR1073NsrrDerivedCohortReadinessIntake({ outputDir, scanRoots });
  const r1070 = await runR1070NsrrSleepAutonomicAggregateReceipt({
    aggregateReceiptPath: options.aggregateReceiptPath ?? process.env.MURPH_AGE_NSRR_AGGREGATE_RECEIPT_PATH,
    outputDir,
  });
  const r1071 = await runR1071NsrrValidationReadinessReducer({
    outputDir,
    r1069Path: r1069.outputPath,
    r1070Path: r1070.outputPath,
  });
  const r1072 = await runR1072TrueWearableValidationHandoffBundle({
    outputDir,
    r1059Path: options.r1059Path,
    r1061Path: options.r1061Path,
    r1062Path: options.r1062Path,
    r1068Path: r1068.outputPath,
    r1069Path: r1069.outputPath,
    r1070Path: r1070.outputPath,
    r1071Path: r1071.outputPath,
    r1073Path: r1073.outputPath,
  });

  const output: R1074TrueWearablePostDownloadRefreshOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    finalHandoff: {
      conclusion: r1072.output.summary.conclusion,
      dataAsk: r1072.output.nextAction.dataAsk,
      nextAction: r1072.output.nextAction.actionId,
      reviewGptRequiredNow: r1072.output.nextAction.reviewGptRequiredNow,
    },
    packetId: "r1074-true-wearable-post-download-refresh",
    productDisplayAuthorized: false,
    refreshSteps: [
      artifactStep(r1068.output.packetId, r1068.output.schemaVersion, r1068.output.status, r1068.output.summary.conclusion),
      artifactStep(r1069.output.packetId, r1069.output.schemaVersion, r1069.output.status, r1069.output.summary.conclusion),
      artifactStep(r1073.output.packetId, r1073.output.schemaVersion, r1073.output.status, r1073.output.summary.conclusion),
      artifactStep(r1070.output.packetId, r1070.output.schemaVersion, r1070.output.status, r1070.output.reduction.conclusion),
      artifactStep(r1071.output.packetId, r1071.output.schemaVersion, r1071.output.status, r1071.output.summary.conclusion),
      artifactStep(r1072.output.packetId, r1072.output.schemaVersion, r1072.output.status, r1072.output.summary.conclusion),
    ],
    scanSummary: {
      rootCountBand: countBand(scanRoots.length),
      scanned: scanRoots.length > 0,
    },
    schemaVersion: R1074_TRUE_WEARABLE_POST_DOWNLOAD_REFRESH_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: summaryConclusion(r1072.output.summary.conclusion),
      productDisplayAuthorized: false,
      reviewGptUse: "only_if_refreshed_handoff_has_real_aggregate_delta",
      rowParsingPerformedByR1074: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1074 true wearable post-download refresh failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function artifactStep(packetId: string, schemaVersion: string, status: string, conclusion: string): ArtifactStep {
  return {
    conclusion,
    packetId,
    schemaVersion,
    status,
  };
}

function summaryConclusion(
  r1072Conclusion: R1074TrueWearablePostDownloadRefreshOutput["finalHandoff"]["conclusion"],
): R1074TrueWearablePostDownloadRefreshOutput["summary"]["conclusion"] {
  if (r1072Conclusion === "true_wearable_delta_ready_for_reviewgpt") {
    return "post_download_refresh_delta_ready_for_reviewgpt";
  }
  if (r1072Conclusion === "true_wearable_validation_blocked_on_receipt") {
    return "post_download_refresh_blocked_on_receipt";
  }
  return "post_download_refresh_blocked_on_data";
}

function safeBoundary(): R1074TrueWearablePostDownloadRefreshOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localFileNamesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1074: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1074: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
  };
}

function countBand(count: number): string {
  if (count === 0) return "0";
  if (count < 10) return "1-9";
  if (count < 100) return "10-99";
  return "100+";
}

function scanRootsFromEnv(): string[] {
  const merged = [
    process.env.MURPH_AGE_NSRR_SCAN_ROOTS,
    process.env.MURPH_AGE_TRUE_WEARABLE_SOURCE_SCAN_ROOTS,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(path.delimiter);
  const scanRoots = merged.split(path.delimiter).map((root) => root.trim()).filter(Boolean);
  return scanRoots.length > 0 ? scanRoots : [path.join(os.homedir(), "Downloads")];
}

async function main(): Promise<void> {
  const { output } = await runR1074TrueWearablePostDownloadRefresh({
    aggregateReceiptPath: process.env.MURPH_AGE_NSRR_AGGREGATE_RECEIPT_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1059Path: process.env.MURPH_AGE_R1059_TRUE_WEARABLE_RECEIPT_INTAKE_PATH,
    r1061Path: process.env.MURPH_AGE_R1061_TRUE_WEARABLE_DATA_UNBLOCKER_PATH,
    r1062Path: process.env.MURPH_AGE_R1062_TRUE_WEARABLE_RECEIPT_TEMPLATE_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    dataAsk: output.finalHandoff.dataAsk,
    nextAction: output.finalHandoff.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    reviewGptRequiredNow: output.finalHandoff.reviewGptRequiredNow,
    rowParsingPerformedByR1074: output.artifactBoundary.rowParsingPerformedByR1074,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1074 true wearable post-download refresh failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
