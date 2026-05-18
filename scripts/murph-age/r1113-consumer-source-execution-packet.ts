import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1113_CONSUMER_SOURCE_EXECUTION_PACKET_SCHEMA_VERSION =
  "murph-age-r1113-consumer-source-execution-packet.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1113-consumer-source-execution-packet.latest.json";

const INPUTS = {
  r1104: {
    artifact: "r1104-consumer-aggregate-receipt-validator.latest.json",
    packetId: "r1104-consumer-aggregate-receipt-validator",
    schemaVersion: "murph-age-r1104-consumer-aggregate-receipt-validator.v1",
  },
  r1105: {
    artifact: "r1105-consumer-aggregate-receipt-template.latest.json",
    packetId: "r1105-consumer-aggregate-receipt-template",
    schemaVersion: "murph-age-r1105-consumer-aggregate-receipt-template.v1",
  },
  r1111: {
    artifact: "r1111-consumer-aggregate-receipt-runbook.latest.json",
    packetId: "r1111-consumer-aggregate-receipt-runbook",
    schemaVersion: "murph-age-r1111-consumer-aggregate-receipt-runbook.v1",
  },
  r1112: {
    artifact: "r1112-consumer-data-priority-router.latest.json",
    packetId: "r1112-consumer-data-priority-router",
    schemaVersion: "murph-age-r1112-consumer-data-priority-router.v1",
  },
  r1123: {
    artifact: "r1123-consumer-wearable-shadow-evidence-arbitration.latest.json",
    packetId: "r1123-consumer-wearable-shadow-evidence-arbitration",
    schemaVersion: "murph-age-r1123-consumer-wearable-shadow-evidence-arbitration.v1",
  },
} as const;

type InputKey = keyof typeof INPUTS;
type PacketConclusion =
  | "consumer_source_execution_packet_ready"
  | "consumer_receipt_already_ready_for_science_review"
  | "consumer_receipt_needs_r1104_validation"
  | "consumer_source_execution_packet_waiting_on_prerequisites";
type NextAction =
  | "run_source_environment_and_fill_r1105_receipt"
  | "validate_existing_receipt_then_review_science_delta"
  | "run_r1104_on_existing_receipt_before_review"
  | "regenerate_consumer_execution_prerequisites";
type CandidateId =
  | "I1_integrated_lab_wearable_small_panel"
  | "L1_tiny_glycemia_only"
  | "L2_common_lab_core_shadow"
  | "QC_missingness_coverage"
  | "W1_activity_steps_minutes"
  | "W2_sleep_duration_regularity"
  | "W3_rhr_hrv_recovery";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface SourceExecutionTarget {
  deferredInputFamilies: [
    "wearable_sleep",
    "wearable_recovery",
  ];
  endpointPriority: [
    "incident_cardiometabolic_disease",
    "risk_factor_progression",
    "hospitalization_or_acute_event_sensitivity",
    "all_cause_mortality_secondary_when_powered",
  ];
  evidenceRole: "primary_score_bearing" | "secondary_score_bearing";
  minimumAggregateReceipt: {
    candidateIds: CandidateId[];
    deferredCandidateIds: CandidateId[];
    requiredMetricFields: [
      "aucDelta",
      "brierDelta",
      "logLossDelta",
      "calibrationStatus",
      "coverageStatus",
      "evidenceSupport",
      "missingnessOrCoverageControlStatus",
    ];
    requiredReceiptSchema: "murph-age-consumer-lab-wearable-aggregate-receipt.v1";
  };
  runEnvironment:
    | "authorized_source_workbench_or_local_row_owner"
    | "authorized_cardia_package_or_aggregate_runner";
  sourceRoute: "all_of_us_workbench_aggregate" | "cardia_authorized_or_aggregate";
  targetInputFamilies: [
    "bloodwork_common_labs",
    "vitals_body_composition",
    "wearable_activity",
  ];
}

interface ExecutionStep {
  stepId:
    | "select_source_route"
    | "freeze_endpoint_and_denominator"
    | "compute_aggregate_candidate_metrics"
    | "run_missingness_and_coverage_controls"
    | "fill_r1105_receipt"
    | "validate_r1104";
  instruction: string;
}

export interface R1113ConsumerSourceExecutionPacketOptions {
  createdAt?: string;
  outputDir?: string;
  r1104Path?: string;
  r1105Path?: string;
  r1111Path?: string;
  r1112Path?: string;
  r1123Path?: string;
}

export interface R1113ConsumerSourceExecutionPacketOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1113: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1113: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  executionPacket: {
    blockedExternalOutput: [
      "rows",
      "participant_ids",
      "split_membership",
      "predictions",
      "coefficients_or_model_parameters",
      "source_tables_or_codebook_text",
      "source_variable_names",
      "small_cells",
      "product_claims_or_recommendations",
    ];
    controlsRequiredBeforeScoreBearing: [
      "same_denominator_comparisons",
      "missingness_or_coverage_control",
      "consumer_viable_coverage",
      "non_worse_calibration",
      "proper_score_improvement",
    ];
    receiptTemplateArtifact: "r1105-fillable-consumer-aggregate-receipt-template.json" | null;
    sourceTargets: SourceExecutionTarget[];
    steps: ExecutionStep[];
    validationCommand: "MURPH_AGE_CONSUMER_AGGREGATE_RECEIPT_PATH=<receipt.json> pnpm exec tsx scripts/murph-age/r1104-consumer-aggregate-receipt-validator.ts";
  };
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  packetId: "r1113-consumer-source-execution-packet";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1113_CONSUMER_SOURCE_EXECUTION_PACKET_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: PacketConclusion;
    firstPassCandidateIds: CandidateId[];
    firstWearableCandidate: "W1_activity_steps_minutes" | null;
    nextAction: NextAction;
    productDisplayAuthorized: false;
    reviewGptRequiredNow: boolean;
    rowParsingPerformedByR1113: false;
    topPriority: "consumer_labs_wearables_outcome_linked_aggregate_receipt";
  };
}

export async function runR1113ConsumerSourceExecutionPacket(
  options: R1113ConsumerSourceExecutionPacketOptions = {},
): Promise<{ output: R1113ConsumerSourceExecutionPacketOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const firstWearableCandidate = firstWearableCandidateFor(inputs);
  const firstPassCandidateIds = minimumFirstPassCandidateIds(firstWearableCandidate);
  const prerequisiteReady = inputMatchesExpected("r1105", inputs.r1105)
    && inputMatchesExpected("r1111", inputs.r1111)
    && inputMatchesExpected("r1112", inputs.r1112)
    && inputMatchesExpected("r1123", inputs.r1123)
    && readBooleanAt(inputs.r1105, ["summary", "templateReadyForDataFill"]) === true
    && readStringAt(inputs.r1111, ["summary", "conclusion"]) === "consumer_aggregate_receipt_runbook_ready"
    && readStringAt(inputs.r1112, ["summary", "conclusion"]) === "consumer_lab_wearable_loop_blocked_on_outcome_linked_aggregate_receipt"
    && firstWearableCandidate === "W1_activity_steps_minutes";
  const receiptReady = inputMatchesExpected("r1104", inputs.r1104)
    && readStringAt(inputs.r1104, ["summary", "conclusion"]) === "aggregate_receipt_ready_for_reviewgpt";
  const receiptReportedByPriorityRouter = inputMatchesExpected("r1112", inputs.r1112)
    && readStringAt(inputs.r1112, ["summary", "conclusion"]) === "consumer_aggregate_receipt_ready_for_science_review";
  const conclusion = receiptReady
    ? "consumer_receipt_already_ready_for_science_review"
    : receiptReportedByPriorityRouter
      ? "consumer_receipt_needs_r1104_validation"
    : prerequisiteReady
      ? "consumer_source_execution_packet_ready"
      : "consumer_source_execution_packet_waiting_on_prerequisites";

  const output: R1113ConsumerSourceExecutionPacketOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    executionPacket: {
      blockedExternalOutput: [
        "rows",
        "participant_ids",
        "split_membership",
        "predictions",
        "coefficients_or_model_parameters",
        "source_tables_or_codebook_text",
        "source_variable_names",
        "small_cells",
        "product_claims_or_recommendations",
      ],
      controlsRequiredBeforeScoreBearing: [
        "same_denominator_comparisons",
        "missingness_or_coverage_control",
        "consumer_viable_coverage",
        "non_worse_calibration",
        "proper_score_improvement",
      ],
      receiptTemplateArtifact: readStringAt(inputs.r1105, ["receiptTemplateArtifact"]) === "r1105-fillable-consumer-aggregate-receipt-template.json"
        ? "r1105-fillable-consumer-aggregate-receipt-template.json"
        : null,
      sourceTargets: sourceTargets(firstWearableCandidate),
      steps: executionSteps(),
      validationCommand:
        "MURPH_AGE_CONSUMER_AGGREGATE_RECEIPT_PATH=<receipt.json> pnpm exec tsx scripts/murph-age/r1104-consumer-aggregate-receipt-validator.ts",
    },
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1113-consumer-source-execution-packet",
    productDisplayAuthorized: false,
    schemaVersion: R1113_CONSUMER_SOURCE_EXECUTION_PACKET_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      firstPassCandidateIds,
      firstWearableCandidate,
      nextAction: nextActionFor(conclusion),
      productDisplayAuthorized: false,
      reviewGptRequiredNow: conclusion === "consumer_receipt_already_ready_for_science_review",
      rowParsingPerformedByR1113: false,
      topPriority: "consumer_labs_wearables_outcome_linked_aggregate_receipt",
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1113 consumer source execution packet failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function nextActionFor(conclusion: PacketConclusion): NextAction {
  if (conclusion === "consumer_receipt_already_ready_for_science_review") {
    return "validate_existing_receipt_then_review_science_delta";
  }
  if (conclusion === "consumer_receipt_needs_r1104_validation") {
    return "run_r1104_on_existing_receipt_before_review";
  }
  if (conclusion === "consumer_source_execution_packet_ready") {
    return "run_source_environment_and_fill_r1105_receipt";
  }
  return "regenerate_consumer_execution_prerequisites";
}

function sourceTargets(firstWearableCandidate: R1113ConsumerSourceExecutionPacketOutput["summary"]["firstWearableCandidate"]): SourceExecutionTarget[] {
  const endpointPriority: SourceExecutionTarget["endpointPriority"] = [
    "incident_cardiometabolic_disease",
    "risk_factor_progression",
    "hospitalization_or_acute_event_sensitivity",
    "all_cause_mortality_secondary_when_powered",
  ];
  const deferredInputFamilies: SourceExecutionTarget["deferredInputFamilies"] = [
    "wearable_sleep",
    "wearable_recovery",
  ];
  const targetInputFamilies: SourceExecutionTarget["targetInputFamilies"] = [
    "bloodwork_common_labs",
    "vitals_body_composition",
    "wearable_activity",
  ];
  const minimumAggregateReceipt: SourceExecutionTarget["minimumAggregateReceipt"] = {
    candidateIds: minimumFirstPassCandidateIds(firstWearableCandidate),
    deferredCandidateIds: [
      "W2_sleep_duration_regularity",
      "W3_rhr_hrv_recovery",
      "I1_integrated_lab_wearable_small_panel",
    ],
    requiredMetricFields: [
      "aucDelta",
      "brierDelta",
      "logLossDelta",
      "calibrationStatus",
      "coverageStatus",
      "evidenceSupport",
      "missingnessOrCoverageControlStatus",
    ],
    requiredReceiptSchema: "murph-age-consumer-lab-wearable-aggregate-receipt.v1",
  };
  return [
    {
      deferredInputFamilies,
      endpointPriority,
      evidenceRole: "primary_score_bearing",
      minimumAggregateReceipt,
      runEnvironment: "authorized_source_workbench_or_local_row_owner",
      sourceRoute: "all_of_us_workbench_aggregate",
      targetInputFamilies,
    },
    {
      deferredInputFamilies,
      endpointPriority,
      evidenceRole: "secondary_score_bearing",
      minimumAggregateReceipt,
      runEnvironment: "authorized_cardia_package_or_aggregate_runner",
      sourceRoute: "cardia_authorized_or_aggregate",
      targetInputFamilies,
    },
  ];
}

function executionSteps(): ExecutionStep[] {
  return [
    {
      instruction: "Use All of Us first if available; otherwise use authorized CARDIA or an equivalent row-owning aggregate runner.",
      stepId: "select_source_route",
    },
    {
      instruction: "Freeze endpoint, denominator, age band, follow-up window, comparison set, and suppression policy before scoring.",
      stepId: "freeze_endpoint_and_denominator",
    },
    {
      instruction: "Compute only aggregate candidate deltas for L1 glycemia, L2 common labs/vitals, W1 activity/steps/minutes, and the required missingness/coverage control.",
      stepId: "compute_aggregate_candidate_metrics",
    },
    {
      instruction: "Run same-denominator missingness and coverage controls before treating W1 or any later wearable candidate as score-bearing.",
      stepId: "run_missingness_and_coverage_controls",
    },
    {
      instruction: "Fill the R1105 receipt template with aggregate metric deltas and gate statuses only.",
      stepId: "fill_r1105_receipt",
    },
    {
      instruction: "Run R1104 on the filled receipt; use ReviewGPT only if R1104 returns a valid scientific delta.",
      stepId: "validate_r1104",
    },
  ];
}

function firstWearableCandidateFor(
  inputs: Record<InputKey, unknown | null>,
): R1113ConsumerSourceExecutionPacketOutput["summary"]["firstWearableCandidate"] {
  const candidate = readStringAt(inputs.r1123, ["summary", "firstWearableCandidate"]);
  if (inputMatchesExpected("r1123", inputs.r1123) && candidate === "W1_activity_steps_minutes") {
    return "W1_activity_steps_minutes";
  }
  return null;
}

function minimumFirstPassCandidateIds(
  firstWearableCandidate: R1113ConsumerSourceExecutionPacketOutput["summary"]["firstWearableCandidate"],
): CandidateId[] {
  return [
    "L1_tiny_glycemia_only",
    "L2_common_lab_core_shadow",
    ...(firstWearableCandidate ? [firstWearableCandidate] : []),
    "QC_missingness_coverage",
  ];
}

async function readInputs(options: R1113ConsumerSourceExecutionPacketOptions): Promise<Record<InputKey, unknown | null>> {
  return {
    r1104: await readJsonIfPresent(options.r1104Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1104.artifact)),
    r1105: await readJsonIfPresent(options.r1105Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1105.artifact)),
    r1111: await readJsonIfPresent(options.r1111Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1111.artifact)),
    r1112: await readJsonIfPresent(options.r1112Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1112.artifact)),
    r1123: await readJsonIfPresent(options.r1123Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1123.artifact)),
  };
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1113 rejected unsafe ${key} input: ${formatFindingCount(findings)}`);
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

function readBooleanAt(value: unknown, pathParts: readonly string[]): boolean | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "boolean" ? resolved : null;
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
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

function safeBoundary(): R1113ConsumerSourceExecutionPacketOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1113: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1113: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1113ConsumerSourceExecutionPacket({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1104Path: process.env.MURPH_AGE_R1104_RECEIPT_VALIDATOR_PATH,
    r1105Path: process.env.MURPH_AGE_R1105_CONSUMER_RECEIPT_TEMPLATE_PATH,
    r1111Path: process.env.MURPH_AGE_R1111_CONSUMER_RUNBOOK_PATH,
    r1112Path: process.env.MURPH_AGE_R1112_CONSUMER_DATA_PRIORITY_PATH,
    r1123Path: process.env.MURPH_AGE_R1123_WEARABLE_SHADOW_ARBITRATION_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    firstPassCandidateIds: output.summary.firstPassCandidateIds,
    firstWearableCandidate: output.summary.firstWearableCandidate,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowParsingPerformedByR1113: output.summary.rowParsingPerformedByR1113,
    schemaVersion: output.schemaVersion,
    sourceTargets: output.executionPacket.sourceTargets.map((target) => target.sourceRoute),
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1113 consumer source execution packet failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
