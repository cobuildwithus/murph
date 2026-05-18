import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1068_TRUE_WEARABLE_SOURCE_ACTIVATION_MATRIX_SCHEMA_VERSION =
  "murph-age-r1068-true-wearable-source-activation-matrix.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_CONFIRMATION_PATH = path.join(
  ".runtime",
  "murph-age",
  "source-confirmations",
  "true-wearable-source-activation.local.json",
);
const OUTPUT_FILE_NAME = "r1068-true-wearable-source-activation-matrix.latest.json";

type SourceId =
  | "all_of_us_fitbit_labs_ehr_workbench"
  | "nsrr_sleep_autonomic_outcome_cohorts"
  | "partner_or_local_data_holder_aggregate_receipt"
  | "personal_wearable_exports_schema_only"
  | "uk_biobank_accelerometry_labs_outcomes";
type SourceRoute =
  | "controlled_workbench_aggregate"
  | "ingestion_schema_only"
  | "local_data_holder_aggregate"
  | "partner_aggregate_validation";
type SourceActivationStatus =
  | "blocked_need_access_or_confirmation"
  | "blocked_need_aggregate_receipt"
  | "derived_files_detected_need_endpoint_receipt"
  | "receipt_ready_for_reviewgpt"
  | "schema_only_not_score_bearing";
type ReviewGptRole = "none_local_scaffold" | "review_real_aggregate_delta";

interface InputArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface SourceRow {
  activationStatus: SourceActivationStatus;
  directLocalDownloadUsefulNow: boolean;
  evidenceRole:
    | "consumer_wearable_integrated_validation"
    | "downloadable_sleep_autonomic_candidate"
    | "local_schema_only"
    | "partner_integrated_validation"
    | "workbench_integrated_validation";
  nextAction:
    | "download_nsrr_derived_covariate_outcome_files"
    | "fill_or_collect_aggregate_receipt"
    | "get_controlled_workbench_access_then_run_aggregate_evaluator"
    | "hold_schema_only_until_outcome_join"
    | "send_existing_receipt_delta_to_reviewgpt";
  productDisplayAuthorized: false;
  reviewGptRole: ReviewGptRole;
  route: SourceRoute;
  sourceId: SourceId;
}

export interface R1068TrueWearableSourceActivationMatrixOptions {
  confirmationPath?: string;
  createdAt?: string;
  outputDir?: string;
  r1059Path?: string;
  r1061Path?: string;
  scanRoots?: string[];
}

export interface R1068TrueWearableSourceActivationMatrixOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1068: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1068: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: {
    localSourceConfirmation: InputArtifactSummary;
    r1059ReceiptIntake: InputArtifactSummary;
    r1061DataUnblocker: InputArtifactSummary;
  };
  localScan: {
    nsrrDerivedCandidateFileCountBand: string;
    nsrrRawSignalLikeFileCountBand: string;
    personalWearableExportFileCountBand: string;
    rootCountBand: string;
    scanned: boolean;
  };
  nextBatch: {
    immediateAction:
      | "await_or_collect_true_wearable_aggregate_receipt"
      | "prepare_nsrr_derived_file_activation"
      | "send_existing_true_wearable_delta_to_reviewgpt";
    nextUserDataAsk:
      | "download_nsrr_derived_sleep_cohort_files_or_secure_allofus_workbench_access"
      | "no_more_user_downloads_receipt_ready_for_reviewgpt"
      | "point_codex_to_nsrr_derived_files_or_fill_aggregate_receipt";
    reviewGptRequiredNow: boolean;
  };
  packetId: "r1068-true-wearable-source-activation-matrix";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1068_TRUE_WEARABLE_SOURCE_ACTIVATION_MATRIX_SCHEMA_VERSION;
  sourceRows: SourceRow[];
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "true_wearable_receipt_ready_for_reviewgpt"
      | "true_wearable_sources_need_data_or_receipt"
      | "true_wearable_sources_need_nsrr_activation";
    productDisplayAuthorized: false;
    reviewGptUse: "only_for_real_aggregate_delta_or_major_source_strategy";
    rowParsingPerformedByR1068: false;
  };
}

export async function runR1068TrueWearableSourceActivationMatrix(
  options: R1068TrueWearableSourceActivationMatrixOptions = {},
): Promise<{ output: R1068TrueWearableSourceActivationMatrixOutput; outputPath: string }> {
  const r1059 = await readJsonIfPresent(
    options.r1059Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1059-true-wearable-aggregate-receipt-intake.latest.json"),
  );
  const r1061 = await readJsonIfPresent(
    options.r1061Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1061-true-wearable-data-unblocker.latest.json"),
  );
  const confirmation = await readJsonIfPresent(options.confirmationPath ?? DEFAULT_CONFIRMATION_PATH);
  validateInputBoundaries({ confirmation, r1059, r1061 });

  const localScan = await summarizeLocalScan(options.scanRoots ?? scanRootsFromEnv());
  const receiptReady = readStringAt(r1059, ["summary", "conclusion"]) === "aggregate_receipt_ready_for_reviewgpt"
    || readStringAt(r1061, ["summary", "trueWearableReceiptStatus"]) === "ready_for_reviewgpt";
  const sourceRows = sourceRowsFor({
    confirmation,
    localScan,
    receiptReady,
  });
  const nextBatch = nextBatchFor({ localScan, receiptReady });
  const output: R1068TrueWearableSourceActivationMatrixOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: {
      localSourceConfirmation: summarizeInput("true-wearable-source-activation.local.json", confirmation),
      r1059ReceiptIntake: summarizeInput("r1059-true-wearable-aggregate-receipt-intake.latest.json", r1059),
      r1061DataUnblocker: summarizeInput("r1061-true-wearable-data-unblocker.latest.json", r1061),
    },
    localScan,
    nextBatch,
    packetId: "r1068-true-wearable-source-activation-matrix",
    productDisplayAuthorized: false,
    schemaVersion: R1068_TRUE_WEARABLE_SOURCE_ACTIVATION_MATRIX_SCHEMA_VERSION,
    sourceRows,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: receiptReady
        ? "true_wearable_receipt_ready_for_reviewgpt"
        : localScan.nsrrDerivedCandidateFileCountBand !== "0"
          ? "true_wearable_sources_need_nsrr_activation"
          : "true_wearable_sources_need_data_or_receipt",
      productDisplayAuthorized: false,
      reviewGptUse: "only_for_real_aggregate_delta_or_major_source_strategy",
      rowParsingPerformedByR1068: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1068 true wearable source activation matrix failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function sourceRowsFor(input: {
  confirmation: unknown | null;
  localScan: R1068TrueWearableSourceActivationMatrixOutput["localScan"];
  receiptReady: boolean;
}): SourceRow[] {
  const allOfUsConfirmed = readBooleanAt(input.confirmation, ["allOfUsWorkbenchAccessConfirmed"]);
  const nsrrConfirmed = readBooleanAt(input.confirmation, ["nsrrDerivedFilesDownloaded"]);
  const ukbConfirmed = readBooleanAt(input.confirmation, ["ukbWorkbenchAccessConfirmed"]);
  return [
    {
      activationStatus: input.receiptReady
        ? "receipt_ready_for_reviewgpt"
        : allOfUsConfirmed
          ? "blocked_need_aggregate_receipt"
          : "blocked_need_access_or_confirmation",
      directLocalDownloadUsefulNow: false,
      evidenceRole: "workbench_integrated_validation",
      nextAction: input.receiptReady
        ? "send_existing_receipt_delta_to_reviewgpt"
        : allOfUsConfirmed
          ? "fill_or_collect_aggregate_receipt"
          : "get_controlled_workbench_access_then_run_aggregate_evaluator",
      productDisplayAuthorized: false,
      reviewGptRole: input.receiptReady ? "review_real_aggregate_delta" : "none_local_scaffold",
      route: "controlled_workbench_aggregate",
      sourceId: "all_of_us_fitbit_labs_ehr_workbench",
    },
    {
      activationStatus: input.receiptReady
        ? "receipt_ready_for_reviewgpt"
        : nsrrConfirmed || input.localScan.nsrrDerivedCandidateFileCountBand !== "0"
          ? "derived_files_detected_need_endpoint_receipt"
          : "blocked_need_access_or_confirmation",
      directLocalDownloadUsefulNow: !input.receiptReady,
      evidenceRole: "downloadable_sleep_autonomic_candidate",
      nextAction: input.receiptReady
        ? "send_existing_receipt_delta_to_reviewgpt"
        : nsrrConfirmed || input.localScan.nsrrDerivedCandidateFileCountBand !== "0"
          ? "fill_or_collect_aggregate_receipt"
          : "download_nsrr_derived_covariate_outcome_files",
      productDisplayAuthorized: false,
      reviewGptRole: input.receiptReady ? "review_real_aggregate_delta" : "none_local_scaffold",
      route: "local_data_holder_aggregate",
      sourceId: "nsrr_sleep_autonomic_outcome_cohorts",
    },
    {
      activationStatus: input.receiptReady ? "receipt_ready_for_reviewgpt" : "blocked_need_aggregate_receipt",
      directLocalDownloadUsefulNow: false,
      evidenceRole: "partner_integrated_validation",
      nextAction: input.receiptReady ? "send_existing_receipt_delta_to_reviewgpt" : "fill_or_collect_aggregate_receipt",
      productDisplayAuthorized: false,
      reviewGptRole: input.receiptReady ? "review_real_aggregate_delta" : "none_local_scaffold",
      route: "partner_aggregate_validation",
      sourceId: "partner_or_local_data_holder_aggregate_receipt",
    },
    {
      activationStatus: input.receiptReady
        ? "receipt_ready_for_reviewgpt"
        : ukbConfirmed
          ? "blocked_need_aggregate_receipt"
          : "blocked_need_access_or_confirmation",
      directLocalDownloadUsefulNow: false,
      evidenceRole: "consumer_wearable_integrated_validation",
      nextAction: input.receiptReady
        ? "send_existing_receipt_delta_to_reviewgpt"
        : ukbConfirmed
          ? "fill_or_collect_aggregate_receipt"
          : "get_controlled_workbench_access_then_run_aggregate_evaluator",
      productDisplayAuthorized: false,
      reviewGptRole: input.receiptReady ? "review_real_aggregate_delta" : "none_local_scaffold",
      route: "controlled_workbench_aggregate",
      sourceId: "uk_biobank_accelerometry_labs_outcomes",
    },
    {
      activationStatus: "schema_only_not_score_bearing",
      directLocalDownloadUsefulNow: false,
      evidenceRole: "local_schema_only",
      nextAction: "hold_schema_only_until_outcome_join",
      productDisplayAuthorized: false,
      reviewGptRole: "none_local_scaffold",
      route: "ingestion_schema_only",
      sourceId: "personal_wearable_exports_schema_only",
    },
  ];
}

function nextBatchFor(input: {
  localScan: R1068TrueWearableSourceActivationMatrixOutput["localScan"];
  receiptReady: boolean;
}): R1068TrueWearableSourceActivationMatrixOutput["nextBatch"] {
  if (input.receiptReady) {
    return {
      immediateAction: "send_existing_true_wearable_delta_to_reviewgpt",
      nextUserDataAsk: "no_more_user_downloads_receipt_ready_for_reviewgpt",
      reviewGptRequiredNow: true,
    };
  }
  if (input.localScan.nsrrDerivedCandidateFileCountBand !== "0") {
    return {
      immediateAction: "prepare_nsrr_derived_file_activation",
      nextUserDataAsk: "point_codex_to_nsrr_derived_files_or_fill_aggregate_receipt",
      reviewGptRequiredNow: false,
    };
  }
  return {
    immediateAction: "await_or_collect_true_wearable_aggregate_receipt",
    nextUserDataAsk: "download_nsrr_derived_sleep_cohort_files_or_secure_allofus_workbench_access",
    reviewGptRequiredNow: false,
  };
}

async function summarizeLocalScan(
  scanRoots: string[],
): Promise<R1068TrueWearableSourceActivationMatrixOutput["localScan"]> {
  let nsrrDerivedCandidateCount = 0;
  let nsrrRawSignalLikeCount = 0;
  let personalWearableExportCount = 0;
  for (const root of scanRoots) {
    const rootStat = await statOrNull(root);
    if (!rootStat?.isDirectory()) continue;
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const name = entry.name.toLowerCase();
      if (isNsrrRawSignalLike(name)) nsrrRawSignalLikeCount += 1;
      else if (isNsrrDerivedCandidate(name)) nsrrDerivedCandidateCount += 1;
      if (isPersonalWearableExport(name)) personalWearableExportCount += 1;
    }
  }
  return {
    nsrrDerivedCandidateFileCountBand: countBand(nsrrDerivedCandidateCount),
    nsrrRawSignalLikeFileCountBand: countBand(nsrrRawSignalLikeCount),
    personalWearableExportFileCountBand: countBand(personalWearableExportCount),
    rootCountBand: countBand(scanRoots.length),
    scanned: scanRoots.length > 0,
  };
}

function isNsrrDerivedCandidate(name: string): boolean {
  return /\.(csv|sas7bdat|tsv|xpt|zip)$/u.test(name)
    && /(?:nsrr|mesa|shhs|mros|sof|sleep)/u.test(name)
    && /(?:covariate|dataset|derived|harmonized|outcome|phenotype|sleep)/u.test(name);
}

function isNsrrRawSignalLike(name: string): boolean {
  return /\.(edf|mat|xml|h5)$/u.test(name)
    && /(?:actigraphy|psg|raw|signal|sleep)/u.test(name);
}

function isPersonalWearableExport(name: string): boolean {
  return /(?:apple[-_ ]?health|fitbit|garmin|oura|whoop|wearable|steps|sleep|heart[-_ ]?rate|hrv)/u.test(name)
    && /\.(csv|json|xml|zip)$/u.test(name);
}

function safeBoundary(): R1068TrueWearableSourceActivationMatrixOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localFileNamesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1068: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1068: false,
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
      throw new Error(`R1068 input ${key} failed aggregate-egress validation: ${findings.join("; ")}`);
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

async function statOrNull(filePath: string) {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}

function summarizeInput(artifact: string, value: unknown | null): InputArtifactSummary {
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

function countBand(count: number): string {
  if (count === 0) return "0";
  if (count < 10) return "1-9";
  if (count < 100) return "10-99";
  return "100+";
}

function scanRootsFromEnv(): string[] {
  return (process.env.MURPH_AGE_TRUE_WEARABLE_SOURCE_SCAN_ROOTS ?? "")
    .split(path.delimiter)
    .map((root) => root.trim())
    .filter(Boolean);
}

async function main(): Promise<void> {
  const { output } = await runR1068TrueWearableSourceActivationMatrix({
    confirmationPath: process.env.MURPH_AGE_TRUE_WEARABLE_SOURCE_CONFIRMATION_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1059Path: process.env.MURPH_AGE_R1059_TRUE_WEARABLE_RECEIPT_INTAKE_PATH,
    r1061Path: process.env.MURPH_AGE_R1061_TRUE_WEARABLE_DATA_UNBLOCKER_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    immediateAction: output.nextBatch.immediateAction,
    nextUserDataAsk: output.nextBatch.nextUserDataAsk,
    nsrrDerivedCandidateFileCountBand: output.localScan.nsrrDerivedCandidateFileCountBand,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    reviewGptRequiredNow: output.nextBatch.reviewGptRequiredNow,
    rowParsingPerformedByR1068: output.artifactBoundary.rowParsingPerformedByR1068,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1068 true wearable source activation matrix failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
