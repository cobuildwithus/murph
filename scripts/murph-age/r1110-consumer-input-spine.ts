import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1110_CONSUMER_INPUT_SPINE_SCHEMA_VERSION =
  "murph-age-r1110-consumer-input-spine.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1110-consumer-input-spine.latest.json";

const INPUTS = {
  r1090: {
    artifact: "r1090-consumer-feature-registry-state.latest.json",
    packetId: "r1090-consumer-feature-registry-state",
    schemaVersion: "murph-age-r1090-consumer-feature-registry-state.v1",
  },
  r1103: {
    artifact: "r1103-consumer-candidate-family-manifest.latest.json",
    packetId: "r1103-consumer-candidate-family-manifest",
    schemaVersion: "murph-age-r1103-consumer-candidate-family-manifest.v1",
  },
  r1109: {
    artifact: "r1109-all-of-us-aggregate-handoff.latest.json",
    packetId: "r1109-all-of-us-aggregate-handoff",
    schemaVersion: "murph-age-r1109-all-of-us-aggregate-handoff.v1",
  },
} as const;

type InputKey = keyof typeof INPUTS;
type CurrentStatus =
  | "blocked_until_outcome_linked_wearable_receipt"
  | "ready_for_aggregate_receipt"
  | "supporting_context_only";
type FirstPassRole =
  | "context_or_attribution_only"
  | "lab_model_candidate"
  | "lab_vital_model_candidate"
  | "wearable_model_candidate";
type Priority =
  | "p0_score_candidate"
  | "p0_score_candidate_pending_receipt"
  | "p1_context";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface ConsumerInputFamily {
  candidateIds: string[];
  currentStatus: CurrentStatus;
  familyId:
    | "bloodwork_common_labs"
    | "vitals_body_composition"
    | "wearable_activity"
    | "wearable_recovery"
    | "wearable_sleep";
  firstPassRole: FirstPassRole;
  priority: Priority;
  requiredEvidence: string[];
  userSubmitFit: "high";
  why: string;
}

interface DeprioritizedFamily {
  familyId:
    | "chronological_age_mimicry"
    | "exotic_assays_or_research_devices"
    | "function_mobility_context"
    | "hospital_only_stress_sources"
    | "older_adult_only_mortality_sources";
  policy: "exclude_first_loop" | "supporting_context_only" | "transport_only";
  reason: string;
}

interface StrictRunStep {
  candidateId:
    | "I1_integrated_lab_wearable_small_panel"
    | "L1_tiny_glycemia_only"
    | "L2_common_lab_core_shadow"
    | "QC_missingness_coverage"
    | "W1_activity_steps_minutes"
    | "W2_sleep_duration_regularity"
    | "W3_rhr_hrv_recovery";
  runOrder: number;
  runPolicy: "negative_control_required" | "run_after_lab_receipt" | "run_first" | "run_only_if_outcome_linked_wearable_coverage_exists";
}

export interface R1110ConsumerInputSpineOptions {
  createdAt?: string;
  outputDir?: string;
  r1090Path?: string;
  r1103Path?: string;
  r1109Path?: string;
}

export interface R1110ConsumerInputSpineOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1110: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1110: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  consumerInputSpine: {
    allowedFirstClassInputFamilies: ConsumerInputFamily[];
    deprioritizedFamilies: DeprioritizedFamily[];
    scope: {
      primaryAgeBand: "roughly_16_50";
      primaryModelIntent: "consumer_submittable_labs_wearables_first";
    };
  };
  createdAt: string;
  executionPlan: {
    receiptValidatorCommand: "MURPH_AGE_CONSUMER_AGGREGATE_RECEIPT_PATH=<receipt.json> pnpm exec tsx scripts/murph-age/r1104-consumer-aggregate-receipt-validator.ts";
    reviewGptUse: "only_after_valid_scientific_delta_or_high_level_endpoint_conflict";
    sourceRoute: "all_of_us_or_cardia_aggregate_receipt_first";
    strictRunOrder: StrictRunStep[];
  };
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  packetId: "r1110-consumer-input-spine";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1110_CONSUMER_INPUT_SPINE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: "consumer_lab_wearable_spine_ready" | "waiting_on_upstream_consumer_artifacts";
    nextAction:
      | "collect_or_run_aggregate_receipt_then_validate_r1104"
      | "regenerate_r1090_r1103_r1109_before_consumer_spine";
    productDisplayAuthorized: false;
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1110: false;
    topPriority: "outcome_linked_aggregate_receipt_with_consumer_labs_and_wearables";
  };
}

export async function runR1110ConsumerInputSpine(
  options: R1110ConsumerInputSpineOptions = {},
): Promise<{ output: R1110ConsumerInputSpineOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const inputIdentityReady = (Object.keys(INPUTS) as InputKey[]).every((key) => inputMatchesExpected(key, inputs[key]));
  const ready = inputIdentityReady
    && readStringAt(inputs.r1090, ["summary", "nextLocalAction"]) === "use_registry_to_drive_labs_wearables_shadow_batch"
    && readStringAt(inputs.r1103, ["summary", "conclusion"]) === "consumer_candidate_family_manifest_ready"
    && readStringAt(inputs.r1109, ["summary", "conclusion"]) === "all_of_us_aggregate_handoff_ready";

  const output: R1110ConsumerInputSpineOutput = {
    artifactBoundary: safeBoundary(),
    consumerInputSpine: {
      allowedFirstClassInputFamilies: consumerInputFamilies(),
      deprioritizedFamilies: deprioritizedFamilies(),
      scope: {
        primaryAgeBand: "roughly_16_50",
        primaryModelIntent: "consumer_submittable_labs_wearables_first",
      },
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    executionPlan: {
      receiptValidatorCommand:
        "MURPH_AGE_CONSUMER_AGGREGATE_RECEIPT_PATH=<receipt.json> pnpm exec tsx scripts/murph-age/r1104-consumer-aggregate-receipt-validator.ts",
      reviewGptUse: "only_after_valid_scientific_delta_or_high_level_endpoint_conflict",
      sourceRoute: "all_of_us_or_cardia_aggregate_receipt_first",
      strictRunOrder: strictRunOrder(),
    },
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1110-consumer-input-spine",
    productDisplayAuthorized: false,
    schemaVersion: R1110_CONSUMER_INPUT_SPINE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: ready ? "consumer_lab_wearable_spine_ready" : "waiting_on_upstream_consumer_artifacts",
      nextAction: ready
        ? "collect_or_run_aggregate_receipt_then_validate_r1104"
        : "regenerate_r1090_r1103_r1109_before_consumer_spine",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1110: false,
      topPriority: "outcome_linked_aggregate_receipt_with_consumer_labs_and_wearables",
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1110 consumer input spine failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function consumerInputFamilies(): ConsumerInputFamily[] {
  return [
    {
      candidateIds: ["L1_tiny_glycemia_only", "L2_common_lab_core_shadow"],
      currentStatus: "ready_for_aggregate_receipt",
      familyId: "bloodwork_common_labs",
      firstPassRole: "lab_model_candidate",
      priority: "p0_score_candidate",
      requiredEvidence: [
        "same_denominator_outcome_aggregate_receipt",
        "proper_score_improvement_and_non_worse_calibration",
        "consumer_viable_coverage",
        "negative_controls_do_not_match_candidate",
      ],
      userSubmitFit: "high",
      why: "Common bloodwork is the highest-fit Murph input family because a typical 16-50 user can upload it from an ordinary lab panel.",
    },
    {
      candidateIds: ["L2_common_lab_core_shadow"],
      currentStatus: "ready_for_aggregate_receipt",
      familyId: "vitals_body_composition",
      firstPassRole: "lab_vital_model_candidate",
      priority: "p0_score_candidate",
      requiredEvidence: [
        "incremental_gain_beyond_labs_or_age_sex",
        "not_a_body_only_shortcut",
        "consumer_viable_coverage",
      ],
      userSubmitFit: "high",
      why: "Blood pressure, body size, and basic body metrics are easy for average users to submit and are useful companion inputs to labs.",
    },
    {
      candidateIds: ["W1_activity_steps_minutes"],
      currentStatus: "blocked_until_outcome_linked_wearable_receipt",
      familyId: "wearable_activity",
      firstPassRole: "wearable_model_candidate",
      priority: "p0_score_candidate_pending_receipt",
      requiredEvidence: [
        "outcome_linked_wearable_aggregate_receipt",
        "valid_wear_coverage_summary",
        "coverage_quality_control_beaten",
        "shuffled_wearable_control_beaten",
      ],
      userSubmitFit: "high",
      why: "Activity from consumer wearables is a core Murph-age input, but it should not become score-bearing until outcome-linked aggregate evidence beats coverage controls.",
    },
    {
      candidateIds: ["W2_sleep_duration_regularity"],
      currentStatus: "blocked_until_outcome_linked_wearable_receipt",
      familyId: "wearable_sleep",
      firstPassRole: "wearable_model_candidate",
      priority: "p0_score_candidate_pending_receipt",
      requiredEvidence: [
        "outcome_linked_sleep_or_device_aggregate_receipt",
        "valid_sleep_night_coverage_summary",
        "missingness_control_beaten",
      ],
      userSubmitFit: "high",
      why: "Sleep is highly user-submittable through wearables, but signal must separate physiology from tracking adherence.",
    },
    {
      candidateIds: ["W3_rhr_hrv_recovery"],
      currentStatus: "blocked_until_outcome_linked_wearable_receipt",
      familyId: "wearable_recovery",
      firstPassRole: "wearable_model_candidate",
      priority: "p0_score_candidate_pending_receipt",
      requiredEvidence: [
        "outcome_linked_recovery_or_autonomic_aggregate_receipt",
        "device_or_source_category_summary",
        "coverage_quality_control_beaten",
        "illness_and_training_context_audit",
      ],
      userSubmitFit: "high",
      why: "Resting heart rate, HRV, and recovery-like signals are consumer-native, but need stronger guards against device, illness, and training-status artifacts.",
    },
  ];
}

function deprioritizedFamilies(): DeprioritizedFamily[] {
  return [
    {
      familyId: "function_mobility_context",
      policy: "supporting_context_only",
      reason: "Useful for attribution and older-adult transport, but less central than labs and wearables for average 16-50 Murph users.",
    },
    {
      familyId: "exotic_assays_or_research_devices",
      policy: "exclude_first_loop",
      reason: "Do not let hard-to-obtain measurements drive the first consumer model architecture.",
    },
    {
      familyId: "older_adult_only_mortality_sources",
      policy: "transport_only",
      reason: "Older-adult mortality cohorts can stress-test transport but should not define the main 16-50 consumer feature spine.",
    },
    {
      familyId: "hospital_only_stress_sources",
      policy: "transport_only",
      reason: "Hospital data may reveal failure modes but is not representative of ordinary consumer-submitted Murph inputs.",
    },
    {
      familyId: "chronological_age_mimicry",
      policy: "exclude_first_loop",
      reason: "Chronological-age prediction is a sanity reference, not the optimization target.",
    },
  ];
}

function strictRunOrder(): StrictRunStep[] {
  return [
    {
      candidateId: "L1_tiny_glycemia_only",
      runOrder: 1,
      runPolicy: "run_first",
    },
    {
      candidateId: "L2_common_lab_core_shadow",
      runOrder: 2,
      runPolicy: "run_after_lab_receipt",
    },
    {
      candidateId: "QC_missingness_coverage",
      runOrder: 3,
      runPolicy: "negative_control_required",
    },
    {
      candidateId: "W1_activity_steps_minutes",
      runOrder: 4,
      runPolicy: "run_only_if_outcome_linked_wearable_coverage_exists",
    },
    {
      candidateId: "W2_sleep_duration_regularity",
      runOrder: 5,
      runPolicy: "run_only_if_outcome_linked_wearable_coverage_exists",
    },
    {
      candidateId: "W3_rhr_hrv_recovery",
      runOrder: 6,
      runPolicy: "run_only_if_outcome_linked_wearable_coverage_exists",
    },
    {
      candidateId: "I1_integrated_lab_wearable_small_panel",
      runOrder: 7,
      runPolicy: "run_only_if_outcome_linked_wearable_coverage_exists",
    },
  ];
}

async function readInputs(options: R1110ConsumerInputSpineOptions): Promise<Record<InputKey, unknown | null>> {
  return {
    r1090: await readJsonIfPresent(options.r1090Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1090.artifact)),
    r1103: await readJsonIfPresent(options.r1103Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1103.artifact)),
    r1109: await readJsonIfPresent(options.r1109Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1109.artifact)),
  };
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1110 rejected unsafe ${key} input: ${formatFindingCount(findings)}`);
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

function formatFindingCount(findings: readonly string[]): string {
  return `${findings.length} aggregate-egress violation${findings.length === 1 ? "" : "s"}`;
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
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : null;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function safeBoundary(): R1110ConsumerInputSpineOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1110: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1110: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1110ConsumerInputSpine({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1090Path: process.env.MURPH_AGE_R1090_CONSUMER_FEATURE_REGISTRY_PATH,
    r1103Path: process.env.MURPH_AGE_R1103_CONSUMER_CANDIDATE_MANIFEST_PATH,
    r1109Path: process.env.MURPH_AGE_R1109_ALL_OF_US_HANDOFF_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    firstClassFamilies: output.consumerInputSpine.allowedFirstClassInputFamilies.map((family) => family.familyId),
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowParsingPerformedByR1110: output.summary.rowParsingPerformedByR1110,
    schemaVersion: output.schemaVersion,
    status: output.status,
    topPriority: output.summary.topPriority,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1110 consumer input spine failed."}\n`);
    process.exitCode = 1;
  });
}
