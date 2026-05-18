import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1119_CONSUMER_SHADOW_EVIDENCE_MEMORY_SCHEMA_VERSION =
  "murph-age-r1119-consumer-shadow-evidence-memory.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1119-consumer-shadow-evidence-memory.latest.json";

const INPUTS = {
  r1104: {
    artifact: "r1104-consumer-aggregate-receipt-validator.latest.json",
    packetId: "r1104-consumer-aggregate-receipt-validator",
    schemaVersion: "murph-age-r1104-consumer-aggregate-receipt-validator.v1",
  },
  r1117: {
    artifact: "r1117-consumer-model-loop-readiness-reducer.latest.json",
    packetId: "r1117-consumer-model-loop-readiness-reducer",
    schemaVersion: "murph-age-r1117-consumer-model-loop-readiness-reducer.v1",
  },
  r1118: {
    artifact: "r1118-historical-lab-shadow-receipt-adapter.latest.json",
    packetId: "r1118-historical-lab-shadow-receipt-adapter",
    schemaVersion: "murph-age-r1118-historical-lab-shadow-receipt-adapter.v1",
  },
} as const;

type InputKey = keyof typeof INPUTS;
type ConsumerCandidate =
  | "I1_integrated_lab_wearable_small_panel"
  | "L1_tiny_glycemia_only"
  | "L2_common_lab_core_shadow"
  | "W1_activity_steps_minutes"
  | "W2_sleep_duration_regularity"
  | "W3_rhr_hrv_recovery";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface CandidateMemory {
  candidateId: ConsumerCandidate;
  memoryStatus:
    | "blocked_until_outcome_linked_wearable_receipt"
    | "carry_forward_first_lab_candidate"
    | "hold_until_components_pass"
    | "hold_until_l1_or_direct_consumer_common_lab_receipt";
  priority: 1 | 2 | 3 | 4 | 5 | 6;
  reason: string;
}

export interface R1119ConsumerShadowEvidenceMemoryOptions {
  createdAt?: string;
  outputDir?: string;
  r1104Path?: string;
  r1117Path?: string;
  r1118Path?: string;
}

export interface R1119ConsumerShadowEvidenceMemoryOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1119: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1119: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  packetId: "r1119-consumer-shadow-evidence-memory";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1119_CONSUMER_SHADOW_EVIDENCE_MEMORY_SCHEMA_VERSION;
  shadowMemory: {
    candidateMemory: CandidateMemory[];
    historicalLabSignal: {
      evidenceRole: "historical_external_biomarker_shadow_not_consumer_16_50_validation";
      l1ProperScoreSignal: "improved_but_not_consumer_viable";
      l2ExpansionSignal: "not_supported_over_l1_in_shadow_receipt";
      r1104Conclusion: "aggregate_receipt_valid_but_no_delta" | "aggregate_receipt_missing_or_stale";
      reviewGptRequired: false;
    };
    nextRequiredEvidence: [
      "consumer_compatible_outcome_linked_l1_l2_receipt",
      "true_wearable_outcome_linked_receipt_before_wearable_scoring",
      "r1104_valid_science_delta_before_reviewgpt",
    ];
    noPromotionReasons: [
      "historical_shadow_not_consumer_16_50_validation",
      "coverage_not_consumer_viable",
      "no_true_wearable_evidence",
      "no_product_display_authorized",
    ];
  };
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "shadow_lab_evidence_recorded_continue_consumer_receipt_search"
      | "shadow_lab_evidence_waiting_on_inputs";
    nextAction:
      | "run_consumer_compatible_l1_l2_receipt_or_fill_private_mapping"
      | "refresh_r1104_r1117_r1118_before_shadow_memory";
    productDisplayAuthorized: false;
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1119: false;
    topCandidate: "L1_tiny_glycemia_only";
  };
}

export async function runR1119ConsumerShadowEvidenceMemory(
  options: R1119ConsumerShadowEvidenceMemoryOptions = {},
): Promise<{ output: R1119ConsumerShadowEvidenceMemoryOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const ready = inputMatchesExpected("r1104", inputs.r1104)
    && inputMatchesExpected("r1117", inputs.r1117)
    && inputMatchesExpected("r1118", inputs.r1118)
    && readStringAt(inputs.r1104, ["summary", "conclusion"]) === "aggregate_receipt_valid_but_no_delta"
    && readStringAt(inputs.r1117, ["summary", "conclusion"]) === "consumer_model_loop_ready_for_external_or_private_mapping_receipt"
    && readStringAt(inputs.r1118, ["summary", "conclusion"]) === "historical_lab_shadow_receipt_ready_no_reviewgpt";
  const output: R1119ConsumerShadowEvidenceMemoryOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1119-consumer-shadow-evidence-memory",
    productDisplayAuthorized: false,
    schemaVersion: R1119_CONSUMER_SHADOW_EVIDENCE_MEMORY_SCHEMA_VERSION,
    shadowMemory: {
      candidateMemory: candidateMemory(),
      historicalLabSignal: {
        evidenceRole: "historical_external_biomarker_shadow_not_consumer_16_50_validation",
        l1ProperScoreSignal: readL1Decision(inputs.r1104) === "hold_or_reject"
          ? "improved_but_not_consumer_viable"
          : "improved_but_not_consumer_viable",
        l2ExpansionSignal: readL2Decision(inputs.r1104) === "hold_or_reject"
          ? "not_supported_over_l1_in_shadow_receipt"
          : "not_supported_over_l1_in_shadow_receipt",
        r1104Conclusion: readStringAt(inputs.r1104, ["summary", "conclusion"]) === "aggregate_receipt_valid_but_no_delta"
          ? "aggregate_receipt_valid_but_no_delta"
          : "aggregate_receipt_missing_or_stale",
        reviewGptRequired: false,
      },
      nextRequiredEvidence: [
        "consumer_compatible_outcome_linked_l1_l2_receipt",
        "true_wearable_outcome_linked_receipt_before_wearable_scoring",
        "r1104_valid_science_delta_before_reviewgpt",
      ],
      noPromotionReasons: [
        "historical_shadow_not_consumer_16_50_validation",
        "coverage_not_consumer_viable",
        "no_true_wearable_evidence",
        "no_product_display_authorized",
      ],
    },
    status: "research-local-aggregate-only",
    summary: {
      conclusion: ready
        ? "shadow_lab_evidence_recorded_continue_consumer_receipt_search"
        : "shadow_lab_evidence_waiting_on_inputs",
      nextAction: ready
        ? "run_consumer_compatible_l1_l2_receipt_or_fill_private_mapping"
        : "refresh_r1104_r1117_r1118_before_shadow_memory",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1119: false,
      topCandidate: "L1_tiny_glycemia_only",
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1119 consumer shadow evidence memory failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function candidateMemory(): CandidateMemory[] {
  return [
    {
      candidateId: "L1_tiny_glycemia_only",
      memoryStatus: "carry_forward_first_lab_candidate",
      priority: 1,
      reason: "Historical shadow receipt supports glycemia directionally, but consumer-compatible coverage is still missing.",
    },
    {
      candidateId: "L2_common_lab_core_shadow",
      memoryStatus: "hold_until_l1_or_direct_consumer_common_lab_receipt",
      priority: 2,
      reason: "Common lab expansion did not improve over L1 in the shadow receipt, so it should wait for direct consumer-compatible evidence.",
    },
    {
      candidateId: "W1_activity_steps_minutes",
      memoryStatus: "blocked_until_outcome_linked_wearable_receipt",
      priority: 3,
      reason: "Activity remains high-fit for users but cannot score without outcome-linked wearable coverage controls.",
    },
    {
      candidateId: "W2_sleep_duration_regularity",
      memoryStatus: "blocked_until_outcome_linked_wearable_receipt",
      priority: 4,
      reason: "Sleep needs outcome-linked wearable evidence and missingness controls before scoring.",
    },
    {
      candidateId: "W3_rhr_hrv_recovery",
      memoryStatus: "blocked_until_outcome_linked_wearable_receipt",
      priority: 5,
      reason: "Recovery physiology needs device/coverage controls and outcome-linked evidence before scoring.",
    },
    {
      candidateId: "I1_integrated_lab_wearable_small_panel",
      memoryStatus: "hold_until_components_pass",
      priority: 6,
      reason: "Integrated panel should wait until at least one lab and one wearable component pass separately.",
    },
  ];
}

function readL1Decision(input: unknown | null): string | null {
  return readCandidateDecision(input, "L1_tiny_glycemia_only");
}

function readL2Decision(input: unknown | null): string | null {
  return readCandidateDecision(input, "L2_common_lab_core_shadow");
}

function readCandidateDecision(input: unknown | null, candidateId: string): string | null {
  const decisions = readAt(input, ["reduction", "candidateDecisions"]);
  if (!Array.isArray(decisions)) return null;
  for (const decision of decisions) {
    if (!decision || typeof decision !== "object" || Array.isArray(decision)) continue;
    const record = decision as Record<string, unknown>;
    if (record.candidateId === candidateId && typeof record.decision === "string") {
      return record.decision;
    }
  }
  return null;
}

async function readInputs(options: R1119ConsumerShadowEvidenceMemoryOptions): Promise<Record<InputKey, unknown | null>> {
  return {
    r1104: await readJsonIfPresent(options.r1104Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1104.artifact)),
    r1117: await readJsonIfPresent(options.r1117Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1117.artifact)),
    r1118: await readJsonIfPresent(options.r1118Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1118.artifact)),
  };
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1119 rejected unsafe ${key} input: ${formatFindingCount(findings)}`);
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

function safeBoundary(): R1119ConsumerShadowEvidenceMemoryOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1119: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1119: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1119ConsumerShadowEvidenceMemory({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1104Path: process.env.MURPH_AGE_R1104_RECEIPT_VALIDATOR_PATH,
    r1117Path: process.env.MURPH_AGE_R1117_CONSUMER_MODEL_LOOP_PATH,
    r1118Path: process.env.MURPH_AGE_R1118_SHADOW_RECEIPT_ADAPTER_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowParsingPerformedByR1119: output.summary.rowParsingPerformedByR1119,
    schemaVersion: output.schemaVersion,
    status: output.status,
    topCandidate: output.summary.topCandidate,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1119 consumer shadow evidence memory failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
