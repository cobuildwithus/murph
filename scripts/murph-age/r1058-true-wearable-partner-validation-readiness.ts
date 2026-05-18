import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1058_TRUE_WEARABLE_PARTNER_VALIDATION_READINESS_SCHEMA_VERSION =
  "murph-age-r1058-true-wearable-partner-validation-readiness.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_R1051_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "r1051-partner-wearable-aggregate-evaluator.latest.json");
const DEFAULT_R1057_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "r1057-function-activity-pulse-candidate-batch-result.latest.json");
const OUTPUT_FILE_NAME = "r1058-true-wearable-partner-validation-readiness.latest.json";

type CandidateId =
  | "C0_age_sex"
  | "C1_source_clinical_base"
  | "C2_lab5_or_lab9_bp_body"
  | "C3_lab_bp_body_plus_activity_28d"
  | "C4_lab_bp_body_plus_activity_sleep_28d"
  | "C5_lab_bp_body_plus_activity_sleep_rhr"
  | "C6_lab_bp_body_plus_activity_sleep_rhr_hrv_quality_gated"
  | "C7_wearable_coverage_quality_only_negative_control"
  | "C8_shuffled_wearable_negative_control";
type Endpoint =
  | "all_cause_mortality"
  | "frailty_disability_or_functional_decline_auxiliary_head"
  | "hospitalization_or_emergency_utilization"
  | "incident_cardiometabolic_disease"
  | "major_cardiovascular_event";
type InputKey = "r1051" | "r1057";

interface InputArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface ValidationCandidate {
  candidateId: CandidateId;
  role: "negative_control" | "reference" | "score_bearing_research_candidate";
  status: "held_until_coverage_method_green" | "required" | "required_control";
  tests: string[];
}

export interface R1058TrueWearablePartnerValidationReadinessOptions {
  createdAt?: string;
  outputDir?: string;
  r1051Path?: string;
  r1057Path?: string;
}

export interface R1058TrueWearablePartnerValidationReadinessOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1058: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1058: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  handoffPackage: {
    allowedReceiptRoutes: Array<"controlled_workbench_aggregate" | "local_data_holder_aggregate" | "partner_aggregate_validation">;
    blockedReceiptContents: string[];
    candidateFamilies: ValidationCandidate[];
    endpointPriority: Endpoint[];
    evaluatorId: "partner_integrated_wearable_lab_evaluator_v1";
    minimumReceiptAttestations: string[];
    packageId: "true_wearable_or_workbench_validation_v1";
    primaryQuestion: string;
    selectedShadowLead: "function_activity_mobility_shadow" | "none";
  };
  inputArtifacts: Record<InputKey, InputArtifactSummary>;
  packetId: "r1058-true-wearable-partner-validation-readiness";
  productPolicy: {
    displayAuthorized: false;
    promotionAuthorized: false;
    productClaimsAuthorized: false;
    recommendationClaimsAuthorized: false;
  };
  readiness: {
    blockedBy: string[];
    conclusion:
      | "partner_delta_ready_for_reviewgpt_science_review"
      | "true_wearable_validation_package_ready_awaiting_receipt"
      | "true_wearable_validation_readiness_inputs_missing";
    nextLocalAction:
      | "collect_or_point_r1051_to_aggregate_receipt"
      | "repair_r1057_or_r1051_state"
      | "send_partner_delta_to_reviewgpt_for_science_review";
    rationale: string;
    reviewGptRequiredBeforeNextLocalRun: boolean;
  };
  schemaVersion: typeof R1058_TRUE_WEARABLE_PARTNER_VALIDATION_READINESS_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    currentLead: "function_activity_mobility_shadow" | "partner_delta_review" | "none";
    nextLoopFocus: "await_true_wearable_aggregate_receipt" | "review_partner_delta" | "repair_inputs";
    productDisplayAuthorized: false;
    reviewGptUse: "only_after_real_aggregate_delta";
    rowParsingPerformedByR1058: false;
  };
}

export async function runR1058TrueWearablePartnerValidationReadiness(
  options: R1058TrueWearablePartnerValidationReadinessOptions = {},
): Promise<{ output: R1058TrueWearablePartnerValidationReadinessOutput; outputPath: string }> {
  const inputs = {
    r1051: await readJsonIfPresent(options.r1051Path ?? DEFAULT_R1051_PATH),
    r1057: await readJsonIfPresent(options.r1057Path ?? DEFAULT_R1057_PATH),
  };
  validateInputBoundaries(inputs);

  const readiness = summarizeReadiness(inputs.r1051, inputs.r1057);
  const output: R1058TrueWearablePartnerValidationReadinessOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      localFileNamesStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      outcomeScoringPerformedByR1058: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR1058: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    handoffPackage: {
      allowedReceiptRoutes: [
        "local_data_holder_aggregate",
        "controlled_workbench_aggregate",
        "partner_aggregate_validation",
      ],
      blockedReceiptContents: [
        "row_values",
        "participant_identifiers",
        "split_memberships",
        "participant_level_outputs",
        "fitted_model_coefficients",
        "source_bodies_or_codebook_text",
        "small_cells",
        "product_claims",
      ],
      candidateFamilies: validationCandidates(),
      endpointPriority: [
        "frailty_disability_or_functional_decline_auxiliary_head",
        "hospitalization_or_emergency_utilization",
        "major_cardiovascular_event",
        "incident_cardiometabolic_disease",
        "all_cause_mortality",
      ],
      evaluatorId: "partner_integrated_wearable_lab_evaluator_v1",
      minimumReceiptAttestations: [
        "aggregateOnly",
        "endpointFrozenBeforeScoring",
        "evaluatorFrozenBeforeExecution",
        "sameDenominatorComparisons",
        "validDayNightCoverageReported",
        "deviceProviderCoverageReported",
        "noRowEgress",
        "noParticipantEgress",
        "noPredictionEgress",
        "noCoefficientEgress",
        "noSmallCellEgress",
      ],
      packageId: "true_wearable_or_workbench_validation_v1",
      primaryQuestion: "Do activity, sleep, RHR, or quality-gated HRV wearable summaries improve calibrated outcome prediction over source clinical base plus lab/body/BP comparators on the same denominator?",
      selectedShadowLead: readiness.conclusion === "true_wearable_validation_readiness_inputs_missing"
        ? "none"
        : "function_activity_mobility_shadow",
    },
    inputArtifacts: {
      r1051: summarizeInput("r1051_partner_wearable_aggregate_evaluator", inputs.r1051),
      r1057: summarizeInput("r1057_function_activity_pulse_candidate_batch_result", inputs.r1057),
    },
    packetId: "r1058-true-wearable-partner-validation-readiness",
    productPolicy: {
      displayAuthorized: false,
      promotionAuthorized: false,
      productClaimsAuthorized: false,
      recommendationClaimsAuthorized: false,
    },
    readiness,
    schemaVersion: R1058_TRUE_WEARABLE_PARTNER_VALIDATION_READINESS_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      currentLead: readiness.conclusion === "partner_delta_ready_for_reviewgpt_science_review"
        ? "partner_delta_review"
        : readiness.conclusion === "true_wearable_validation_package_ready_awaiting_receipt"
          ? "function_activity_mobility_shadow"
          : "none",
      nextLoopFocus: readiness.conclusion === "partner_delta_ready_for_reviewgpt_science_review"
        ? "review_partner_delta"
        : readiness.conclusion === "true_wearable_validation_package_ready_awaiting_receipt"
          ? "await_true_wearable_aggregate_receipt"
          : "repair_inputs",
      productDisplayAuthorized: false,
      reviewGptUse: "only_after_real_aggregate_delta",
      rowParsingPerformedByR1058: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1058 true wearable partner validation readiness failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function summarizeReadiness(
  r1051: unknown | null,
  r1057: unknown | null,
): R1058TrueWearablePartnerValidationReadinessOutput["readiness"] {
  const currentLead = readStringAt(r1057, ["summary", "currentLead"]);
  const nextLoopFocus = readStringAt(r1057, ["summary", "nextLoopFocus"]);
  const partnerConclusion = readStringAt(r1051, ["reduction", "conclusion"]);
  if (partnerConclusion === "partner_wearable_delta_ready_for_scientific_review") {
    return {
      blockedBy: [],
      conclusion: "partner_delta_ready_for_reviewgpt_science_review",
      nextLocalAction: "send_partner_delta_to_reviewgpt_for_science_review",
      rationale: "A true aggregate wearable delta is available, so the next step is ReviewGPT scientific interpretation rather than another local manifest.",
      reviewGptRequiredBeforeNextLocalRun: true,
    };
  }
  if (currentLead !== "function_activity_mobility_shadow" || nextLoopFocus !== "true_wearable_or_partner_validation") {
    return {
      blockedBy: ["r1057_current_lead_missing_or_not_true_wearable_focused"],
      conclusion: "true_wearable_validation_readiness_inputs_missing",
      nextLocalAction: "repair_r1057_or_r1051_state",
      rationale: "The current aggregate batch result does not yet identify the function/activity mobility shadow lead or true wearable validation focus.",
      reviewGptRequiredBeforeNextLocalRun: false,
    };
  }
  return {
    blockedBy: ["no_true_wearable_or_workbench_aggregate_receipt_yet"],
    conclusion: "true_wearable_validation_package_ready_awaiting_receipt",
    nextLocalAction: "collect_or_point_r1051_to_aggregate_receipt",
    rationale: "The validation package is ready, but no local data-holder, workbench, or partner aggregate receipt has landed.",
    reviewGptRequiredBeforeNextLocalRun: false,
  };
}

function validationCandidates(): ValidationCandidate[] {
  return [
    {
      candidateId: "C0_age_sex",
      role: "reference",
      status: "required",
      tests: ["baseline_reference"],
    },
    {
      candidateId: "C1_source_clinical_base",
      role: "reference",
      status: "required",
      tests: ["source_supported_clinical_context_reference"],
    },
    {
      candidateId: "C2_lab5_or_lab9_bp_body",
      role: "reference",
      status: "required",
      tests: ["lab_body_bp_comparator"],
    },
    {
      candidateId: "C3_lab_bp_body_plus_activity_28d",
      role: "score_bearing_research_candidate",
      status: "required",
      tests: ["activity_increment", "coverage_control_beaten", "same_denominator"],
    },
    {
      candidateId: "C4_lab_bp_body_plus_activity_sleep_28d",
      role: "score_bearing_research_candidate",
      status: "required",
      tests: ["activity_sleep_increment", "valid_night_coverage", "same_denominator"],
    },
    {
      candidateId: "C5_lab_bp_body_plus_activity_sleep_rhr",
      role: "score_bearing_research_candidate",
      status: "required",
      tests: ["rhr_increment", "device_provider_diagnostic", "same_denominator"],
    },
    {
      candidateId: "C6_lab_bp_body_plus_activity_sleep_rhr_hrv_quality_gated",
      role: "score_bearing_research_candidate",
      status: "held_until_coverage_method_green",
      tests: ["method_qualified_hrv_only", "coverage_method_green", "same_denominator"],
    },
    {
      candidateId: "C7_wearable_coverage_quality_only_negative_control",
      role: "negative_control",
      status: "required_control",
      tests: ["coverage_selection_artifact_check"],
    },
    {
      candidateId: "C8_shuffled_wearable_negative_control",
      role: "negative_control",
      status: "required_control",
      tests: ["wearable_signal_shuffle_check"],
    },
  ];
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1058 input ${key} failed aggregate boundary validation: ${findings.join("; ")}`);
    }
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
  const { output } = await runR1058TrueWearablePartnerValidationReadiness({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1051Path: process.env.MURPH_AGE_R1051_PARTNER_EVALUATOR_PATH,
    r1057Path: process.env.MURPH_AGE_R1057_CANDIDATE_BATCH_RESULT_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.readiness.conclusion,
    currentLead: output.summary.currentLead,
    evaluatorId: output.handoffPackage.evaluatorId,
    nextLocalAction: output.readiness.nextLocalAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    reviewGptRequiredBeforeNextLocalRun: output.readiness.reviewGptRequiredBeforeNextLocalRun,
    rowParsingPerformedByR1058: output.summary.rowParsingPerformedByR1058,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1058 true wearable partner validation readiness failed."}\n`);
    process.exitCode = 1;
  });
}
