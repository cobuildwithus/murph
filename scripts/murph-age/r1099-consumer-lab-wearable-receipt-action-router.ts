import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1099_CONSUMER_LAB_WEARABLE_RECEIPT_ACTION_ROUTER_SCHEMA_VERSION =
  "murph-age-r1099-consumer-lab-wearable-receipt-action-router.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1099-consumer-lab-wearable-receipt-action-router.latest.json";

const INPUTS = {
  r1059: {
    artifact: "r1059-true-wearable-aggregate-receipt-intake.latest.json",
    packetId: "r1059-true-wearable-aggregate-receipt-intake",
    schemaVersion: "murph-age-r1059-true-wearable-aggregate-receipt-intake.v1",
  },
  r1097: {
    artifact: "r1097-consumer-lab-wearable-aggregate-template.latest.json",
    packetId: "r1097-consumer-lab-wearable-aggregate-template",
    schemaVersion: "murph-age-r1097-consumer-lab-wearable-aggregate-template.v1",
  },
  r1098: {
    artifact: "r1098-reviewgpt-consumer-direction-reducer.latest.json",
    packetId: "r1098-reviewgpt-consumer-direction-reducer",
    schemaVersion: "murph-age-r1098-reviewgpt-consumer-direction-reducer.v1",
  },
  r1104: {
    artifact: "r1104-consumer-aggregate-receipt-validator.latest.json",
    packetId: "r1104-consumer-aggregate-receipt-validator",
    schemaVersion: "murph-age-r1104-consumer-aggregate-receipt-validator.v1",
  },
} as const;

type InputKey = keyof typeof INPUTS;
type RouterConclusion =
  | "await_consumer_lab_wearable_aggregate_receipt"
  | "send_consumer_lab_wearable_delta_to_reviewgpt"
  | "hold_consumer_lab_wearable_receipt_no_model_change"
  | "repair_consumer_direction_or_template";
type RouterNextAction =
  | "await_or_collect_all_of_us_or_partner_workbench_aggregate_receipt"
  | "send_valid_consumer_lab_wearable_delta_to_reviewgpt"
  | "hold_receipt_no_model_change_continue_source_search"
  | "repair_consumer_direction_or_template";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface RouterDecision {
  conclusion: RouterConclusion;
  nextAction: RouterNextAction;
  reviewGptRequiredNow: boolean;
  why: string;
}

export interface R1099ConsumerLabWearableReceiptActionRouterOptions {
  createdAt?: string;
  outputDir?: string;
  r1059Path?: string;
  r1097Path?: string;
  r1098Path?: string;
  r1104Path?: string;
}

export interface R1099ConsumerLabWearableReceiptActionRouterOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1099: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1099: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  currentState: {
    aggregateReceiptStatus: "coverage_insufficient" | "missing" | "ready_for_reviewgpt" | "valid_but_no_delta";
    candidateDecision: string | null;
    consumerInputPriority: "bloodwork_labs_vitals_body_wearables_for_roughly_16_50";
    directionStatus: "aligned" | "missing_or_misaligned";
    productDisplayAuthorized: false;
    templateStatus: "ready" | "not_ready";
    wearableStatus: string | null;
  };
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  nextLoop: {
    ageEvidenceSubbands: string[];
    commands: string[];
    decision: RouterDecision;
    productDisplayAuthorized: false;
    reviewGptUse: "only_after_valid_scientific_delta_or_major_architecture_question";
    routeTargets: string[];
  };
  packetId: "r1099-consumer-lab-wearable-receipt-action-router";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1099_CONSUMER_LAB_WEARABLE_RECEIPT_ACTION_ROUTER_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: RouterConclusion;
    nextAction: RouterNextAction;
    productDisplayAuthorized: false;
    reviewGptRequiredNow: boolean;
    rowParsingPerformedByR1099: false;
  };
}

export async function runR1099ConsumerLabWearableReceiptActionRouter(
  options: R1099ConsumerLabWearableReceiptActionRouterOptions = {},
): Promise<{ output: R1099ConsumerLabWearableReceiptActionRouterOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const decision = decideNextLoop(inputs);
  const output: R1099ConsumerLabWearableReceiptActionRouterOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    currentState: {
      aggregateReceiptStatus: aggregateReceiptStatusFromConclusion(activeReceiptConclusion(inputs), inputs),
      candidateDecision: readStringAt(inputs.r1098, ["reducedDecision", "candidateDecision"]),
      consumerInputPriority: "bloodwork_labs_vitals_body_wearables_for_roughly_16_50",
      directionStatus: directionReady(inputs.r1098) ? "aligned" : "missing_or_misaligned",
      productDisplayAuthorized: false,
      templateStatus: templateReady(inputs.r1097) ? "ready" : "not_ready",
      wearableStatus: readStringAt(inputs.r1098, ["reducedDecision", "wearableStatus"]),
    },
    inputArtifacts: summarizeInputs(inputs),
    nextLoop: {
      ageEvidenceSubbands: ageEvidenceSubbands(inputs.r1098),
      commands: commandsFor(decision.nextAction),
      decision,
      productDisplayAuthorized: false,
      reviewGptUse: "only_after_valid_scientific_delta_or_major_architecture_question",
      routeTargets: routeTargets(inputs.r1097),
    },
    packetId: "r1099-consumer-lab-wearable-receipt-action-router",
    productDisplayAuthorized: false,
    schemaVersion: R1099_CONSUMER_LAB_WEARABLE_RECEIPT_ACTION_ROUTER_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: decision.conclusion,
      nextAction: decision.nextAction,
      productDisplayAuthorized: false,
      reviewGptRequiredNow: decision.reviewGptRequiredNow,
      rowParsingPerformedByR1099: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1099 consumer lab/wearable action router failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function decideNextLoop(inputs: Record<InputKey, unknown | null>): RouterDecision {
  if (!directionReady(inputs.r1098) || !templateReady(inputs.r1097)) {
    return {
      conclusion: "repair_consumer_direction_or_template",
      nextAction: "repair_consumer_direction_or_template",
      reviewGptRequiredNow: false,
      why: "The consumer labs/wearables direction or fillable aggregate receipt template is missing or stale.",
    };
  }

  const receiptConclusion = activeReceiptConclusion(inputs);
  if (receiptConclusion === "aggregate_receipt_ready_for_reviewgpt") {
    return {
      conclusion: "send_consumer_lab_wearable_delta_to_reviewgpt",
      nextAction: "send_valid_consumer_lab_wearable_delta_to_reviewgpt",
      reviewGptRequiredNow: true,
      why: "A real outcome-linked aggregate labs/wearables receipt cleared local gates and contains a scientific model delta.",
    };
  }
  if (receiptConclusion === "aggregate_receipt_valid_but_no_delta") {
    if (consumerCoverageInsufficient(inputs.r1104)) {
      return {
        conclusion: "await_consumer_lab_wearable_aggregate_receipt",
        nextAction: "await_or_collect_all_of_us_or_partner_workbench_aggregate_receipt",
        reviewGptRequiredNow: false,
        why: "A safe aggregate receipt exists, but no score-bearing consumer labs/wearables candidate has consumer-viable coverage, so the loop still needs a real consumer-compatible receipt.",
      };
    }
    return {
      conclusion: "hold_consumer_lab_wearable_receipt_no_model_change",
      nextAction: "hold_receipt_no_model_change_continue_source_search",
      reviewGptRequiredNow: false,
      why: "The aggregate receipt was safe and valid, but it did not produce a model-improving labs/wearables delta.",
    };
  }

  return {
    conclusion: "await_consumer_lab_wearable_aggregate_receipt",
    nextAction: "await_or_collect_all_of_us_or_partner_workbench_aggregate_receipt",
    reviewGptRequiredNow: false,
    why: "The next model-improving step is a real aggregate receipt from All of Us, a partner workbench, or an equivalent consumer labs/wearables outcome source.",
  };
}

function commandsFor(nextAction: RouterNextAction): string[] {
  if (nextAction === "await_or_collect_all_of_us_or_partner_workbench_aggregate_receipt") {
    return [
      "use r1105-fillable consumer labs/wearables aggregate receipt template with All of Us, CARDIA, or an equivalent outcome-linked workbench source",
      "MURPH_AGE_CONSUMER_AGGREGATE_RECEIPT_PATH=<receipt.json> pnpm exec tsx scripts/murph-age/r1104-consumer-aggregate-receipt-validator.ts",
      "pnpm exec tsx scripts/murph-age/r1099-consumer-lab-wearable-receipt-action-router.ts",
    ];
  }
  if (nextAction === "send_valid_consumer_lab_wearable_delta_to_reviewgpt") {
    return [
      "package aggregate-only consumer labs/wearables delta for ReviewGPT scientific interpretation",
      "do not send row values, participant identifiers, predictions, coefficients, source text, small cells, or product claims",
    ];
  }
  if (nextAction === "hold_receipt_no_model_change_continue_source_search") {
    return [
      "record aggregate receipt as no-improvement evidence",
      "continue All of Us, partner workbench, MIDUS, NHANES bridge, and UKB-supporting source search in priority order",
    ];
  }
  return [
    "pnpm exec tsx scripts/murph-age/r1096-consumer-validation-route-priority.ts",
    "pnpm exec tsx scripts/murph-age/r1097-consumer-lab-wearable-aggregate-template.ts",
    "pnpm exec tsx scripts/murph-age/r1098-reviewgpt-consumer-direction-reducer.ts",
  ];
}

async function readInputs(options: R1099ConsumerLabWearableReceiptActionRouterOptions): Promise<Record<InputKey, unknown | null>> {
  return {
    r1059: await readJsonIfPresent(options.r1059Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1059.artifact)),
    r1097: await readJsonIfPresent(options.r1097Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1097.artifact)),
    r1098: await readJsonIfPresent(options.r1098Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1098.artifact)),
    r1104: await readJsonIfPresent(options.r1104Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1104.artifact)),
  };
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1099 rejected unsafe ${key} input: ${findings.join("; ")}`);
    }
  }
}

function summarizeInputs(inputs: Record<InputKey, unknown | null>): Record<InputKey, ArtifactSummary> {
  return Object.fromEntries(
    (Object.keys(INPUTS) as InputKey[]).map((key) => [key, summarizeInput(INPUTS[key].artifact, inputs[key])]),
  ) as Record<InputKey, ArtifactSummary>;
}

function summarizeInput(artifact: string, value: unknown | null): ArtifactSummary {
  const expected = Object.values(INPUTS).find((input) => input.artifact === artifact);
  const packetId = readStringAt(value, ["packetId"]);
  const schemaVersion = readStringAt(value, ["schemaVersion"]);
  return {
    artifact,
    packetId: expected && packetId === expected.packetId ? packetId : null,
    schemaVersion: expected && schemaVersion === expected.schemaVersion ? schemaVersion : null,
    status: value ? "available" : "missing",
  };
}

function directionReady(value: unknown | null): boolean {
  return readStringAt(value, ["summary", "conclusion"])
    === "reviewgpt_direction_aligned_consumer_lab_wearable_route_locked";
}

function templateReady(value: unknown | null): boolean {
  return readStringAt(value, ["summary", "conclusion"])
      === "consumer_lab_wearable_template_ready_for_data_holder_fill"
    && readBooleanAt(value, ["summary", "templateReadyForDataFill"]) === true;
}

function activeReceiptConclusion(inputs: Record<InputKey, unknown | null>): string {
  const consumerReceiptConclusion = readStringAt(inputs.r1104, ["summary", "conclusion"]);
  if (
    consumerReceiptConclusion === "aggregate_receipt_ready_for_reviewgpt"
    || consumerReceiptConclusion === "aggregate_receipt_valid_but_no_delta"
  ) {
    return consumerReceiptConclusion;
  }
  const legacyWearableReceiptConclusion = readStringAt(inputs.r1059, ["summary", "conclusion"]);
  if (
    legacyWearableReceiptConclusion === "aggregate_receipt_ready_for_reviewgpt"
    || legacyWearableReceiptConclusion === "aggregate_receipt_valid_but_no_delta"
  ) {
    return legacyWearableReceiptConclusion;
  }
  return "aggregate_receipt_missing";
}

function aggregateReceiptStatusFromConclusion(
  conclusion: string,
  inputs?: Record<InputKey, unknown | null>,
): R1099ConsumerLabWearableReceiptActionRouterOutput["currentState"]["aggregateReceiptStatus"] {
  if (conclusion === "aggregate_receipt_ready_for_reviewgpt") return "ready_for_reviewgpt";
  if (conclusion === "aggregate_receipt_valid_but_no_delta") {
    return inputs && consumerCoverageInsufficient(inputs.r1104)
      ? "coverage_insufficient"
      : "valid_but_no_delta";
  }
  return "missing";
}

function consumerCoverageInsufficient(value: unknown | null): boolean {
  if (readStringAt(value, ["summary", "conclusion"]) !== "aggregate_receipt_valid_but_no_delta") {
    return false;
  }
  const candidateDecisions = readArrayAt(value, ["reduction", "candidateDecisions"]);
  const scoreBearingCandidates = candidateDecisions.filter((candidate) => {
    const candidateId = readStringAt(candidate, ["candidateId"]);
    return candidateId !== null && candidateId !== "QC_missingness_coverage";
  });
  return scoreBearingCandidates.length > 0
    && scoreBearingCandidates.every((candidate) => readBooleanAt(candidate, ["coverageAcceptable"]) !== true);
}

function routeTargets(value: unknown | null): string[] {
  return orderConsumerRouteTargets(readArrayAt(value, ["templateBundle", "targetRoutes"])
    .map((route) => typeof route === "string" ? route : null)
    .filter((route): route is string => route !== null));
}

function orderConsumerRouteTargets(targets: readonly string[]): string[] {
  const targetSet = new Set(targets);
  const priority = [
    "all-of-us-fitbit-labs-ehr",
    "cardia-authorized-or-aggregate",
    "partner-aggregate-evaluator",
    "nhanes-activity-shadow-lmf",
    "midus-biomarker-mortality",
    "uk-biobank-integrated",
  ];
  const ordered = priority.filter((target) =>
    target === "cardia-authorized-or-aggregate" || targetSet.has(target)
  );
  for (const target of targets) {
    if (!ordered.includes(target)) ordered.push(target);
  }
  return ordered;
}

function ageEvidenceSubbands(value: unknown | null): string[] {
  return readArrayAt(value, ["reducedDecision", "ageEvidenceSubbands"])
    .map((subband) => typeof subband === "string" ? subband : null)
    .filter((subband): subband is string => subband !== null);
}

function safeBoundary(): R1099ConsumerLabWearableReceiptActionRouterOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1099: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1099: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function readBooleanAt(value: unknown, pathParts: readonly string[]): boolean | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "boolean" ? resolved : null;
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
}

function readArrayAt(value: unknown, pathParts: readonly string[]): unknown[] {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved) ? resolved : [];
}

function readAt(value: unknown, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !(part in current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

async function main(): Promise<void> {
  const { output } = await runR1099ConsumerLabWearableReceiptActionRouter({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1059Path: process.env.MURPH_AGE_R1059_TRUE_WEARABLE_RECEIPT_INTAKE_PATH,
    r1097Path: process.env.MURPH_AGE_R1097_CONSUMER_TEMPLATE_PATH,
    r1098Path: process.env.MURPH_AGE_R1098_CONSUMER_DIRECTION_REDUCER_PATH,
    r1104Path: process.env.MURPH_AGE_R1104_CONSUMER_AGGREGATE_RECEIPT_VALIDATOR_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    aggregateReceiptStatus: output.currentState.aggregateReceiptStatus,
    conclusion: output.summary.conclusion,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    reviewGptUse: output.nextLoop.reviewGptUse,
    routeTargets: output.nextLoop.routeTargets,
    rowParsingPerformedByR1099: output.summary.rowParsingPerformedByR1099,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1099 consumer lab/wearable action router failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
