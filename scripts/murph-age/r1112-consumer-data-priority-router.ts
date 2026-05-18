import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1112_CONSUMER_DATA_PRIORITY_ROUTER_SCHEMA_VERSION =
  "murph-age-r1112-consumer-data-priority-router.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1112-consumer-data-priority-router.latest.json";

const INPUTS = {
  r1060: {
    artifact: "r1060-local-true-wearable-source-inventory.latest.json",
    packetId: "r1060-local-true-wearable-source-inventory",
    schemaVersion: "murph-age-r1060-local-true-wearable-source-inventory.v1",
  },
  r1087: {
    artifact: "r1087-downloaded-aging-source-feasibility.latest.json",
    packetId: "r1087-downloaded-aging-source-feasibility",
    schemaVersion: "murph-age-r1087-downloaded-aging-source-feasibility.v1",
  },
  r1111: {
    artifact: "r1111-consumer-aggregate-receipt-runbook.latest.json",
    packetId: "r1111-consumer-aggregate-receipt-runbook",
    schemaVersion: "murph-age-r1111-consumer-aggregate-receipt-runbook.v1",
  },
} as const;

type InputKey = keyof typeof INPUTS;
type RouterConclusion =
  | "consumer_aggregate_receipt_ready_for_science_review"
  | "consumer_lab_wearable_loop_blocked_on_outcome_linked_aggregate_receipt"
  | "consumer_data_priority_waiting_on_runbook_or_inventory";
type NextAction =
  | "validate_existing_aggregate_receipt_then_review_science_delta"
  | "run_all_of_us_or_cardia_aggregate_receipt_first"
  | "regenerate_r1060_r1087_r1111_before_data_priority";
type ConsumerScoreFamily =
  | "bloodwork_common_labs"
  | "vitals_body_composition"
  | "wearable_activity"
  | "wearable_recovery"
  | "wearable_sleep";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface DataPriorityRoute {
  routeId:
    | "all_of_us_or_cardia_aggregate"
    | "local_wearable_file_join"
    | "downloaded_aging_sources"
    | "nhanes_or_historical_shadow";
  priority: 1 | 2 | 3 | 4;
  role: "score_bearing_first" | "needs_outcome_join" | "supporting_context" | "shadow_only";
  status:
    | "ready_to_request_or_run"
    | "available_but_not_score_bearing"
    | "ready_support_only"
    | "shadow_only";
  why: string;
}

export interface R1112ConsumerDataPriorityRouterOptions {
  createdAt?: string;
  outputDir?: string;
  r1060Path?: string;
  r1087Path?: string;
  r1111Path?: string;
}

export interface R1112ConsumerDataPriorityRouterOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1112: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1112: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  dataPriority: {
    consumerTarget: {
      firstPassInputPolicy: "average_consumer_submittable_labs_vitals_wearables_first";
      primaryAgeBand: "roughly_16_50";
      scoreCandidateFamilies: ConsumerScoreFamily[];
    };
    routes: DataPriorityRoute[];
  };
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  packetId: "r1112-consumer-data-priority-router";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1112_CONSUMER_DATA_PRIORITY_ROUTER_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: RouterConclusion;
    localWearableFileSignal: "present_without_outcome_join" | "not_detected" | "receipt_ready";
    nextAction: NextAction;
    productDisplayAuthorized: false;
    reviewGptRequiredNow: boolean;
    rowParsingPerformedByR1112: false;
    topPriority: "consumer_labs_wearables_outcome_linked_aggregate_receipt";
  };
}

export async function runR1112ConsumerDataPriorityRouter(
  options: R1112ConsumerDataPriorityRouterOptions = {},
): Promise<{ output: R1112ConsumerDataPriorityRouterOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const identitiesReady = (Object.keys(INPUTS) as InputKey[]).every((key) => inputMatchesExpected(key, inputs[key]));
  const runbookReady = readStringAt(inputs.r1111, ["summary", "conclusion"]) === "consumer_aggregate_receipt_runbook_ready";
  const aggregateReceiptReady = readStringAt(inputs.r1060, ["scanSummary", "aggregateReceiptStatus"]) === "ready_for_reviewgpt";
  const localWearableCandidateCount = localWearableCandidateCountFor(inputs.r1060);
  const downloadedSupportReady = downloadedSourcesReadyForSupport(inputs.r1087);
  const conclusion = selectConclusion({
    aggregateReceiptReady,
    identitiesReady,
    runbookReady,
  });
  const output: R1112ConsumerDataPriorityRouterOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    dataPriority: {
      consumerTarget: consumerTarget(inputs.r1111),
      routes: dataPriorityRoutes({
        aggregateReceiptReady,
        downloadedSupportReady,
        localWearableCandidateCount,
      }),
    },
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1112-consumer-data-priority-router",
    productDisplayAuthorized: false,
    schemaVersion: R1112_CONSUMER_DATA_PRIORITY_ROUTER_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      localWearableFileSignal: aggregateReceiptReady
        ? "receipt_ready"
        : localWearableCandidateCount > 0
          ? "present_without_outcome_join"
          : "not_detected",
      nextAction: nextActionFor(conclusion),
      productDisplayAuthorized: false,
      reviewGptRequiredNow: conclusion === "consumer_aggregate_receipt_ready_for_science_review",
      rowParsingPerformedByR1112: false,
      topPriority: "consumer_labs_wearables_outcome_linked_aggregate_receipt",
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1112 consumer data priority router failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function selectConclusion(input: {
  aggregateReceiptReady: boolean;
  identitiesReady: boolean;
  runbookReady: boolean;
}): RouterConclusion {
  if (!input.identitiesReady || !input.runbookReady) return "consumer_data_priority_waiting_on_runbook_or_inventory";
  if (input.aggregateReceiptReady) return "consumer_aggregate_receipt_ready_for_science_review";
  return "consumer_lab_wearable_loop_blocked_on_outcome_linked_aggregate_receipt";
}

function nextActionFor(conclusion: RouterConclusion): NextAction {
  if (conclusion === "consumer_aggregate_receipt_ready_for_science_review") {
    return "validate_existing_aggregate_receipt_then_review_science_delta";
  }
  if (conclusion === "consumer_lab_wearable_loop_blocked_on_outcome_linked_aggregate_receipt") {
    return "run_all_of_us_or_cardia_aggregate_receipt_first";
  }
  return "regenerate_r1060_r1087_r1111_before_data_priority";
}

function consumerTarget(input: unknown | null): R1112ConsumerDataPriorityRouterOutput["dataPriority"]["consumerTarget"] {
  const scoreCandidateFamilies = readStringArrayAt(input, ["handoff", "consumerTarget", "scoreCandidateFamilies"])
    .filter(isConsumerScoreFamily);
  return {
    firstPassInputPolicy: "average_consumer_submittable_labs_vitals_wearables_first",
    primaryAgeBand: "roughly_16_50",
    scoreCandidateFamilies: scoreCandidateFamilies.length > 0
      ? scoreCandidateFamilies
      : [
        "bloodwork_common_labs",
        "vitals_body_composition",
        "wearable_activity",
        "wearable_sleep",
        "wearable_recovery",
      ],
  };
}

function isConsumerScoreFamily(value: string): value is ConsumerScoreFamily {
  return value === "bloodwork_common_labs"
    || value === "vitals_body_composition"
    || value === "wearable_activity"
    || value === "wearable_recovery"
    || value === "wearable_sleep";
}

function dataPriorityRoutes(input: {
  aggregateReceiptReady: boolean;
  downloadedSupportReady: boolean;
  localWearableCandidateCount: number;
}): DataPriorityRoute[] {
  return [
    {
      priority: 1,
      role: "score_bearing_first",
      routeId: "all_of_us_or_cardia_aggregate",
      status: input.aggregateReceiptReady ? "available_but_not_score_bearing" : "ready_to_request_or_run",
      why: input.aggregateReceiptReady
        ? "An aggregate receipt is present; validate it before any science review or model-direction change."
        : "This is the first source route that can plausibly connect ordinary labs, vitals, and wearable coverage to outcomes in the 16-50 target.",
    },
    {
      priority: 2,
      role: "needs_outcome_join",
      routeId: "local_wearable_file_join",
      status: input.localWearableCandidateCount > 0 ? "available_but_not_score_bearing" : "shadow_only",
      why: input.localWearableCandidateCount > 0
        ? "A wearable-like local file exists, but it has no same-denominator outcome label join, so it cannot validate Murph Age yet."
        : "No local wearable-like file was detected in the current scan.",
    },
    {
      priority: 3,
      role: "supporting_context",
      routeId: "downloaded_aging_sources",
      status: input.downloadedSupportReady ? "ready_support_only" : "shadow_only",
      why: "Downloaded aging cohorts are useful for biomarker and transport context, but they are not the first score-bearing 16-50 lab/wearable consumer lane.",
    },
    {
      priority: 4,
      role: "shadow_only",
      routeId: "nhanes_or_historical_shadow",
      status: "shadow_only",
      why: "NHANES and historical mortality anchors stay useful for calibration discipline and sanity checks, not first consumer wearable validation.",
    },
  ];
}

function localWearableCandidateCountFor(input: unknown | null): number {
  const wearableCsvCount = readNumberAt(input, ["scanSummary", "localWearableHealthLikeCsvCount"]) ?? 0;
  const spreadsheetCount = readNumberAt(input, ["scanSummary", "spreadsheetCandidateCount"]) ?? 0;
  return wearableCsvCount + spreadsheetCount;
}

function downloadedSourcesReadyForSupport(input: unknown | null): boolean {
  const rows = readArrayAt(input, ["downloadedSourceFeasibility", "sourceRows"]);
  return rows.some((row) => {
    const status = readStringAt(row, ["sourceReadyStatus"]);
    return status === "ready_for_existing_aggregate_loop" || status === "ready_for_score_receipt_reuse";
  });
}

async function readInputs(options: R1112ConsumerDataPriorityRouterOptions): Promise<Record<InputKey, unknown | null>> {
  return {
    r1060: await readJsonIfPresent(options.r1060Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1060.artifact)),
    r1087: await readJsonIfPresent(options.r1087Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1087.artifact)),
    r1111: await readJsonIfPresent(options.r1111Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1111.artifact)),
  };
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1112 rejected unsafe ${key} input: ${formatFindingCount(findings)}`);
    }
  }
}

function summarizeInputs(inputs: Record<InputKey, unknown | null>): Record<InputKey, ArtifactSummary> {
  return Object.fromEntries(
    (Object.entries(INPUTS) as Array<[InputKey, typeof INPUTS[InputKey]]>).map(([key, expected]) => {
      const input = inputs[key];
      const packetId = readStringAt(input, ["packetId"]);
      const schemaVersion = readStringAt(input, ["schemaVersion"]);
      return [key, {
        artifact: expected.artifact,
        packetId: packetId === expected.packetId ? expected.packetId : null,
        schemaVersion: schemaVersion === expected.schemaVersion ? expected.schemaVersion : null,
        status: input ? "available" : "missing",
      }];
    }),
  ) as Record<InputKey, ArtifactSummary>;
}

function inputMatchesExpected(key: InputKey, input: unknown | null): boolean {
  const expected = INPUTS[key];
  return readStringAt(input, ["packetId"]) === expected.packetId
    && readStringAt(input, ["schemaVersion"]) === expected.schemaVersion;
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

function readArrayAt(value: unknown, pathParts: readonly string[]): unknown[] {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved) ? resolved : [];
}

function readNumberAt(value: unknown, pathParts: readonly string[]): number | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "number" && Number.isFinite(resolved) ? resolved : null;
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
}

function readStringArrayAt(value: unknown, pathParts: readonly string[]): string[] {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved) ? resolved.filter((item): item is string => typeof item === "string") : [];
}

function readAt(value: unknown, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function formatFindingCount(findings: readonly string[]): string {
  return `${findings.length} aggregate-egress violation${findings.length === 1 ? "" : "s"}`;
}

function safeBoundary(): R1112ConsumerDataPriorityRouterOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1112: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1112: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1112ConsumerDataPriorityRouter({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1060Path: process.env.MURPH_AGE_R1060_WEARABLE_INVENTORY_PATH,
    r1087Path: process.env.MURPH_AGE_R1087_DOWNLOADED_SOURCE_FEASIBILITY_PATH,
    r1111Path: process.env.MURPH_AGE_R1111_CONSUMER_RUNBOOK_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    localWearableFileSignal: output.summary.localWearableFileSignal,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowParsingPerformedByR1112: output.summary.rowParsingPerformedByR1112,
    schemaVersion: output.schemaVersion,
    status: output.status,
    topPriority: output.summary.topPriority,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1112 consumer data priority router failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
