import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1071_NSRR_VALIDATION_READINESS_REDUCER_SCHEMA_VERSION =
  "murph-age-r1071-nsrr-validation-readiness-reducer.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1071-nsrr-validation-readiness-reducer.latest.json";

type ArtifactStatus = "available" | "missing";
type NsrrRoleStatus =
  | "blocked_missing_derived_role_families"
  | "blocked_raw_signal_only"
  | "metadata_role_families_ready_no_scoring"
  | "missing";
type NsrrReceiptStatus =
  | "awaiting_nsrr_sleep_autonomic_aggregate_receipt"
  | "missing"
  | "nsrr_sleep_autonomic_delta_not_ready"
  | "nsrr_sleep_autonomic_delta_ready_for_scientific_review";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: ArtifactStatus;
}

export interface R1071NsrrValidationReadinessReducerOptions {
  createdAt?: string;
  outputDir?: string;
  r1069Path?: string;
  r1070Path?: string;
}

export interface R1071NsrrValidationReadinessReducerOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1071: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1071: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: {
    r1069NsrrDerivedRoleActivation: ArtifactSummary;
    r1070NsrrSleepAutonomicAggregateReceipt: ArtifactSummary;
  };
  packetId: "r1071-nsrr-validation-readiness-reducer";
  productDisplayAuthorized: false;
  readiness: {
    blockingReasons: string[];
    nextAction:
      | "download_nsrr_derived_covariate_sleep_outcome_files"
      | "fill_nsrr_aggregate_receipt_template"
      | "hold_nsrr_delta_no_scientific_review"
      | "send_nsrr_sleep_autonomic_delta_to_reviewgpt";
    reviewGptRequiredNow: boolean;
    status:
      | "blocked_download_nsrr_derived_files"
      | "blocked_fill_nsrr_aggregate_receipt"
      | "nsrr_delta_hold_no_review"
      | "nsrr_delta_ready_for_reviewgpt";
  };
  schemaVersion: typeof R1071_NSRR_VALIDATION_READINESS_REDUCER_SCHEMA_VERSION;
  sourceEvidence: {
    roleFamilyStatus: NsrrRoleStatus;
    roleFamilies: {
      baselineCovariates: string;
      derivedSleepActivityOrAutonomic: string;
      documentationOrMetadata: string;
      outcomeOrFollowup: string;
      rawSignalOnly: string;
    };
  };
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "nsrr_delta_ready_for_reviewgpt"
      | "nsrr_download_or_receipt_missing"
      | "nsrr_receipt_valid_but_no_delta";
    productDisplayAuthorized: false;
    reviewGptUse: "only_for_real_nsrr_aggregate_delta";
    rowParsingPerformedByR1071: false;
  };
  validationPackage: {
    receiptTemplateArtifact: string | null;
    receiptStatus: NsrrReceiptStatus;
    templateReadyForDataFill: boolean;
  };
}

export async function runR1071NsrrValidationReadinessReducer(
  options: R1071NsrrValidationReadinessReducerOptions = {},
): Promise<{ output: R1071NsrrValidationReadinessReducerOutput; outputPath: string }> {
  const r1069 = await readJsonIfPresent(
    options.r1069Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1069-nsrr-derived-role-activation.latest.json"),
  );
  const r1070 = await readJsonIfPresent(
    options.r1070Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1070-nsrr-sleep-autonomic-aggregate-receipt.latest.json"),
  );
  validateInputBoundaries({ r1069, r1070 });

  const sourceEvidence = sourceEvidenceFrom(r1069);
  const validationPackage = validationPackageFrom(r1070);
  const readiness = readinessFrom(sourceEvidence, validationPackage);
  const output: R1071NsrrValidationReadinessReducerOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: {
      r1069NsrrDerivedRoleActivation: summarizeInput("r1069-nsrr-derived-role-activation.latest.json", r1069),
      r1070NsrrSleepAutonomicAggregateReceipt: summarizeInput(
        "r1070-nsrr-sleep-autonomic-aggregate-receipt.latest.json",
        r1070,
      ),
    },
    packetId: "r1071-nsrr-validation-readiness-reducer",
    productDisplayAuthorized: false,
    readiness,
    schemaVersion: R1071_NSRR_VALIDATION_READINESS_REDUCER_SCHEMA_VERSION,
    sourceEvidence,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: summaryConclusion(readiness.status),
      productDisplayAuthorized: false,
      reviewGptUse: "only_for_real_nsrr_aggregate_delta",
      rowParsingPerformedByR1071: false,
    },
    validationPackage,
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1071 NSRR validation readiness reducer failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function sourceEvidenceFrom(value: unknown | null): R1071NsrrValidationReadinessReducerOutput["sourceEvidence"] {
  return {
    roleFamilyStatus: readNsrrRoleStatus(value),
    roleFamilies: {
      baselineCovariates: readStringAt(value, ["roleFamilyScan", "roleFamilies", "baseline_covariates", "status"]) ?? "missing",
      derivedSleepActivityOrAutonomic:
        readStringAt(value, ["roleFamilyScan", "roleFamilies", "derived_sleep_activity_or_autonomic", "status"]) ?? "missing",
      documentationOrMetadata: readStringAt(value, ["roleFamilyScan", "roleFamilies", "documentation_or_metadata", "status"]) ?? "missing",
      outcomeOrFollowup: readStringAt(value, ["roleFamilyScan", "roleFamilies", "outcome_or_followup", "status"]) ?? "missing",
      rawSignalOnly: readStringAt(value, ["roleFamilyScan", "roleFamilies", "raw_signal_only", "status"]) ?? "missing",
    },
  };
}

function validationPackageFrom(value: unknown | null): R1071NsrrValidationReadinessReducerOutput["validationPackage"] {
  return {
    receiptTemplateArtifact: readStringAt(value, ["receiptTemplateArtifact"]),
    receiptStatus: readNsrrReceiptStatus(value),
    templateReadyForDataFill: readBooleanAt(value, ["summary", "templateReadyForDataFill"]),
  };
}

function readinessFrom(
  sourceEvidence: R1071NsrrValidationReadinessReducerOutput["sourceEvidence"],
  validationPackage: R1071NsrrValidationReadinessReducerOutput["validationPackage"],
): R1071NsrrValidationReadinessReducerOutput["readiness"] {
  if (validationPackage.receiptStatus === "nsrr_sleep_autonomic_delta_ready_for_scientific_review") {
    return {
      blockingReasons: [],
      nextAction: "send_nsrr_sleep_autonomic_delta_to_reviewgpt",
      reviewGptRequiredNow: true,
      status: "nsrr_delta_ready_for_reviewgpt",
    };
  }
  if (validationPackage.receiptStatus === "nsrr_sleep_autonomic_delta_not_ready") {
    return {
      blockingReasons: ["aggregate_delta_failed_r1070_scientific_gates"],
      nextAction: "hold_nsrr_delta_no_scientific_review",
      reviewGptRequiredNow: false,
      status: "nsrr_delta_hold_no_review",
    };
  }
  if (sourceEvidence.roleFamilyStatus === "metadata_role_families_ready_no_scoring") {
    return {
      blockingReasons: ["nsrr_aggregate_receipt_missing"],
      nextAction: "fill_nsrr_aggregate_receipt_template",
      reviewGptRequiredNow: false,
      status: "blocked_fill_nsrr_aggregate_receipt",
    };
  }
  return {
    blockingReasons: [
      sourceEvidence.roleFamilyStatus === "blocked_raw_signal_only"
        ? "only_raw_signal_files_detected"
        : "nsrr_derived_role_families_missing",
      "nsrr_aggregate_receipt_missing",
    ],
    nextAction: "download_nsrr_derived_covariate_sleep_outcome_files",
    reviewGptRequiredNow: false,
    status: "blocked_download_nsrr_derived_files",
  };
}

function summaryConclusion(
  status: R1071NsrrValidationReadinessReducerOutput["readiness"]["status"],
): R1071NsrrValidationReadinessReducerOutput["summary"]["conclusion"] {
  if (status === "nsrr_delta_ready_for_reviewgpt") return "nsrr_delta_ready_for_reviewgpt";
  if (status === "nsrr_delta_hold_no_review") return "nsrr_receipt_valid_but_no_delta";
  return "nsrr_download_or_receipt_missing";
}

function readNsrrRoleStatus(value: unknown | null): NsrrRoleStatus {
  const status = readStringAt(value, ["rowExecutionReadiness", "status"]);
  if (
    status === "blocked_missing_derived_role_families"
    || status === "blocked_raw_signal_only"
    || status === "metadata_role_families_ready_no_scoring"
  ) {
    return status;
  }
  return "missing";
}

function readNsrrReceiptStatus(value: unknown | null): NsrrReceiptStatus {
  const status = readStringAt(value, ["reduction", "conclusion"]);
  if (
    status === "awaiting_nsrr_sleep_autonomic_aggregate_receipt"
    || status === "nsrr_sleep_autonomic_delta_not_ready"
    || status === "nsrr_sleep_autonomic_delta_ready_for_scientific_review"
  ) {
    return status;
  }
  return "missing";
}

function safeBoundary(): R1071NsrrValidationReadinessReducerOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localFileNamesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1071: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1071: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
  };
}

function validateInputBoundaries(inputs: Record<string, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1071 input ${key} failed aggregate-egress validation: ${findings.join("; ")}`);
    }
  }
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function summarizeInput(artifact: string, value: unknown | null): ArtifactSummary {
  return {
    artifact,
    packetId: readStringAt(value, ["packetId"]),
    schemaVersion: readStringAt(value, ["schemaVersion"]),
    status: value ? "available" : "missing",
  };
}

function readBooleanAt(value: unknown, pathParts: readonly string[]): boolean {
  const current = readAt(value, pathParts);
  return current === true;
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const current = readAt(value, pathParts);
  return typeof current === "string" ? current : null;
}

function readAt(value: unknown, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

async function main(): Promise<void> {
  const { output } = await runR1071NsrrValidationReadinessReducer({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1069Path: process.env.MURPH_AGE_R1069_NSRR_DERIVED_ROLE_ACTIVATION_PATH,
    r1070Path: process.env.MURPH_AGE_R1070_NSRR_AGGREGATE_RECEIPT_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    nextAction: output.readiness.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    receiptStatus: output.validationPackage.receiptStatus,
    reviewGptRequiredNow: output.readiness.reviewGptRequiredNow,
    roleFamilyStatus: output.sourceEvidence.roleFamilyStatus,
    rowParsingPerformedByR1071: output.artifactBoundary.rowParsingPerformedByR1071,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1071 NSRR validation readiness reducer failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
