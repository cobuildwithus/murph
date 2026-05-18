import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1060_LOCAL_TRUE_WEARABLE_SOURCE_INVENTORY_SCHEMA_VERSION =
  "murph-age-r1060-local-true-wearable-source-inventory.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_R1058_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "r1058-true-wearable-partner-validation-readiness.latest.json");
const DEFAULT_R1059_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "r1059-true-wearable-aggregate-receipt-intake.latest.json");
const OUTPUT_FILE_NAME = "r1060-local-true-wearable-source-inventory.latest.json";

type CsvFamily = "financial_transaction_like" | "outcome_label_like" | "unknown" | "wearable_health_like";
type ScanRootKind = "local_user_downloads" | "murph_cache" | "other_local_root";

interface InputArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface ScanRootSummary {
  csvFamilyCounts: Record<CsvFamily, number>;
  kind: ScanRootKind;
  spreadsheetFileCount: number;
  status: "available" | "missing_or_unreadable";
}

export interface R1060LocalTrueWearableSourceInventoryOptions {
  createdAt?: string;
  outputDir?: string;
  r1058Path?: string;
  r1059Path?: string;
  scanRoots?: string[];
}

export interface R1060LocalTrueWearableSourceInventoryOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    fileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1060: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1060: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: {
    r1058Readiness: InputArtifactSummary;
    r1059ReceiptIntake: InputArtifactSummary;
  };
  packetId: "r1060-local-true-wearable-source-inventory";
  productPolicy: {
    displayAuthorized: false;
    promotionAuthorized: false;
    productClaimsAuthorized: false;
    recommendationClaimsAuthorized: false;
  };
  scanSummary: {
    aggregateReceiptStatus:
      | "missing"
      | "ready_for_reviewgpt"
      | "valid_but_no_delta";
    localOutcomeLabelLikeCsvCount: number;
    localWearableHealthLikeCsvCount: number;
    rootCountBand: "0" | "1-9" | "10-99";
    roots: ScanRootSummary[];
    spreadsheetCandidateCount: number;
    transactionLikeActivityFileCount: number;
  };
  schemaVersion: typeof R1060_LOCAL_TRUE_WEARABLE_SOURCE_INVENTORY_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "local_true_wearable_receipt_already_ready"
      | "no_local_true_wearable_outcome_source_detected"
      | "possible_local_wearable_files_need_outcome_join"
      | "wearable_source_inventory_not_configured";
    nextLocalAction:
      | "await_or_collect_true_wearable_aggregate_receipt"
      | "connect_wearable_files_to_outcome_source_before_r1059"
      | "configure_scan_roots_or_receipt_path"
      | "send_existing_receipt_delta_to_reviewgpt";
    productDisplayAuthorized: false;
    rationale: string;
    reviewGptRequiredBeforeNextLocalRun: boolean;
    rowParsingPerformedByR1060: false;
  };
}

export async function runR1060LocalTrueWearableSourceInventory(
  options: R1060LocalTrueWearableSourceInventoryOptions = {},
): Promise<{ output: R1060LocalTrueWearableSourceInventoryOutput; outputPath: string }> {
  const r1058 = await readJsonIfPresent(options.r1058Path ?? DEFAULT_R1058_PATH);
  const r1059 = await readJsonIfPresent(options.r1059Path ?? DEFAULT_R1059_PATH);
  validateInputBoundary("r1058", r1058);
  validateInputBoundary("r1059", r1059);

  const roots = options.scanRoots ?? scanRootsFromEnv(process.env.MURPH_AGE_WEARABLE_SOURCE_SCAN_ROOTS);
  const rootSummaries = await Promise.all(roots.map(scanRoot));
  const aggregateReceiptStatus = receiptStatus(r1059);
  const scanSummary = {
    aggregateReceiptStatus,
    localOutcomeLabelLikeCsvCount: rootSummaries.reduce((sum, root) => sum + root.csvFamilyCounts.outcome_label_like, 0),
    localWearableHealthLikeCsvCount: rootSummaries.reduce((sum, root) => sum + root.csvFamilyCounts.wearable_health_like, 0),
    rootCountBand: countBand(roots.length),
    roots: rootSummaries,
    spreadsheetCandidateCount: rootSummaries.reduce((sum, root) => sum + root.spreadsheetFileCount, 0),
    transactionLikeActivityFileCount: rootSummaries.reduce((sum, root) => sum + root.csvFamilyCounts.financial_transaction_like, 0),
  } satisfies R1060LocalTrueWearableSourceInventoryOutput["scanSummary"];
  const summary = summarize(scanSummary);
  const output: R1060LocalTrueWearableSourceInventoryOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      fileNamesStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      outcomeScoringPerformedByR1060: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR1060: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: {
      r1058Readiness: summarizeInput("r1058_true_wearable_partner_validation_readiness", r1058),
      r1059ReceiptIntake: summarizeInput("r1059_true_wearable_aggregate_receipt_intake", r1059),
    },
    packetId: "r1060-local-true-wearable-source-inventory",
    productPolicy: {
      displayAuthorized: false,
      promotionAuthorized: false,
      productClaimsAuthorized: false,
      recommendationClaimsAuthorized: false,
    },
    scanSummary,
    schemaVersion: R1060_LOCAL_TRUE_WEARABLE_SOURCE_INVENTORY_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary,
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1060 local true wearable source inventory failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function summarize(
  scanSummary: R1060LocalTrueWearableSourceInventoryOutput["scanSummary"],
): R1060LocalTrueWearableSourceInventoryOutput["summary"] {
  if (scanSummary.aggregateReceiptStatus === "ready_for_reviewgpt") {
    return {
      conclusion: "local_true_wearable_receipt_already_ready",
      nextLocalAction: "send_existing_receipt_delta_to_reviewgpt",
      productDisplayAuthorized: false,
      rationale: "A valid aggregate wearable delta has already landed in the receipt intake lane.",
      reviewGptRequiredBeforeNextLocalRun: true,
      rowParsingPerformedByR1060: false,
    };
  }
  if (scanSummary.rootCountBand === "0") {
    return {
      conclusion: "wearable_source_inventory_not_configured",
      nextLocalAction: "configure_scan_roots_or_receipt_path",
      productDisplayAuthorized: false,
      rationale: "No local scan roots were provided and no aggregate receipt is ready.",
      reviewGptRequiredBeforeNextLocalRun: false,
      rowParsingPerformedByR1060: false,
    };
  }
  if (scanSummary.localWearableHealthLikeCsvCount > 0 || scanSummary.spreadsheetCandidateCount > 0) {
    return {
      conclusion: "possible_local_wearable_files_need_outcome_join",
      nextLocalAction: "connect_wearable_files_to_outcome_source_before_r1059",
      productDisplayAuthorized: false,
      rationale: "Potential local wearable-like files exist, but R1059 still needs an aggregate receipt with outcome labels and same-denominator comparisons.",
      reviewGptRequiredBeforeNextLocalRun: false,
      rowParsingPerformedByR1060: false,
    };
  }
  return {
    conclusion: "no_local_true_wearable_outcome_source_detected",
    nextLocalAction: "await_or_collect_true_wearable_aggregate_receipt",
    productDisplayAuthorized: false,
    rationale: "Configured local files do not look like wearable health exports with outcome labels; the current blocker remains a true aggregate receipt.",
    reviewGptRequiredBeforeNextLocalRun: false,
    rowParsingPerformedByR1060: false,
  };
}

async function scanRoot(root: string): Promise<ScanRootSummary> {
  const kind = classifyRoot(root);
  try {
    const rootStat = await stat(root);
    if (!rootStat.isDirectory()) {
      return emptyScanRoot(kind, "missing_or_unreadable");
    }
    const entries = await readdir(root, { withFileTypes: true });
    const csvFamilyCounts = emptyCsvCounts();
    let spreadsheetFileCount = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (extension === ".csv") {
        const family = await classifyCsv(path.join(root, entry.name));
        csvFamilyCounts[family] += 1;
      } else if (extension === ".xlsx" && hasHealthWearableName(entry.name)) {
        spreadsheetFileCount += 1;
      }
    }
    return {
      csvFamilyCounts,
      kind,
      spreadsheetFileCount,
      status: "available",
    };
  } catch {
    return emptyScanRoot(kind, "missing_or_unreadable");
  }
}

function hasHealthWearableName(name: string): boolean {
  return /(?:fitbit|wearable|steps|sleep|heart|hrv|whoop|oura|garmin|apple[-_ ]?health|body[-_ ]?battery|o2[-_ ]?ring|pulse|spo2|oxygen)/iu.test(name);
}

async function classifyCsv(filePath: string): Promise<CsvFamily> {
  try {
    const content = await readFile(filePath, "utf8");
    const firstLine = content.split(/\r?\n/u)[0] ?? "";
    const normalized = firstLine.toLowerCase();
    const wearableSignals = [
      "steps",
      "heart",
      "hrv",
      "sleep",
      "calories",
      "distance",
      "active",
      "sedentary",
      "workout",
      "resting",
      "pulse",
      "spo2",
      "oxygen",
      "o2",
    ];
    const outcomeSignals = ["death", "mortality", "hospital", "diagnosis", "event", "frailty", "disability"];
    const transactionSignals = ["description", "amount", "statement", "merchant", "category"];
    if (outcomeSignals.some((signal) => normalized.includes(signal))) return "outcome_label_like";
    if (wearableSignals.some((signal) => normalized.includes(signal))) return "wearable_health_like";
    if (transactionSignals.filter((signal) => normalized.includes(signal)).length >= 2) return "financial_transaction_like";
    return "unknown";
  } catch {
    return "unknown";
  }
}

function receiptStatus(r1059: unknown | null): R1060LocalTrueWearableSourceInventoryOutput["scanSummary"]["aggregateReceiptStatus"] {
  const conclusion = readStringAt(r1059, ["summary", "conclusion"]);
  if (conclusion === "aggregate_receipt_ready_for_reviewgpt") return "ready_for_reviewgpt";
  if (conclusion === "aggregate_receipt_valid_but_no_delta") return "valid_but_no_delta";
  return "missing";
}

function classifyRoot(root: string): ScanRootKind {
  const normalized = root.toLowerCase();
  if (normalized.includes("downloads")) return "local_user_downloads";
  if (normalized.includes(".runtime") || normalized.includes("murph-age")) return "murph_cache";
  return "other_local_root";
}

function emptyCsvCounts(): Record<CsvFamily, number> {
  return {
    financial_transaction_like: 0,
    outcome_label_like: 0,
    unknown: 0,
    wearable_health_like: 0,
  };
}

function emptyScanRoot(kind: ScanRootKind, status: ScanRootSummary["status"]): ScanRootSummary {
  return {
    csvFamilyCounts: emptyCsvCounts(),
    kind,
    spreadsheetFileCount: 0,
    status,
  };
}

function scanRootsFromEnv(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(path.delimiter).map((item) => item.trim()).filter(Boolean);
}

function countBand(count: number): R1060LocalTrueWearableSourceInventoryOutput["scanSummary"]["rootCountBand"] {
  if (count === 0) return "0";
  if (count < 10) return "1-9";
  return "10-99";
}

function validateInputBoundary(label: string, value: unknown | null): void {
  if (!value) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1060 input ${label} failed aggregate boundary validation: ${findings.join("; ")}`);
  }
}

function summarizeInput(artifact: string, value: unknown | null): InputArtifactSummary {
  return {
    artifact,
    packetId: safeMetadata(readStringAt(value, ["packetId"])),
    schemaVersion: safeMetadata(readStringAt(value, ["schemaVersion"])),
    status: value ? "available" : "missing",
  };
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function readStringAt(value: unknown | null, pathSegments: readonly string[]): string | null {
  let current: unknown = value;
  for (const segment of pathSegments) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" ? current : null;
}

function safeMetadata(value: string | null): string | null {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,120}$/u.test(value) ? value : null;
}

async function main(): Promise<void> {
  const { output } = await runR1060LocalTrueWearableSourceInventory({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1058Path: process.env.MURPH_AGE_R1058_VALIDATION_READINESS_PATH,
    r1059Path: process.env.MURPH_AGE_R1059_RECEIPT_INTAKE_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    aggregateReceiptStatus: output.scanSummary.aggregateReceiptStatus,
    conclusion: output.summary.conclusion,
    localWearableHealthLikeCsvCount: output.scanSummary.localWearableHealthLikeCsvCount,
    nextLocalAction: output.summary.nextLocalAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    reviewGptRequiredBeforeNextLocalRun: output.summary.reviewGptRequiredBeforeNextLocalRun,
    rowParsingPerformedByR1060: output.summary.rowParsingPerformedByR1060,
    schemaVersion: output.schemaVersion,
    spreadsheetCandidateCount: output.scanSummary.spreadsheetCandidateCount,
    status: output.status,
    transactionLikeActivityFileCount: output.scanSummary.transactionLikeActivityFileCount,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1060 local true wearable source inventory failed."}\n`);
    process.exitCode = 1;
  });
}
