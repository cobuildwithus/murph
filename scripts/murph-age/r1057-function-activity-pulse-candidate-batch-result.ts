import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1057_FUNCTION_ACTIVITY_PULSE_CANDIDATE_BATCH_RESULT_SCHEMA_VERSION =
  "murph-age-r1057-function-activity-pulse-candidate-batch-result.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1057-function-activity-pulse-candidate-batch-result.latest.json";

type ArtifactKey = "r1009" | "r1047" | "r1050" | "r1051" | "r1054" | "r1056";
type CandidateId =
  | "A1_objective_activity_bridge_shadow"
  | "F1_walking_function_mobility_shadow"
  | "G1_glucose_hba1c_secondary_shadow"
  | "I1_function_activity_pulse_small_panel_shadow"
  | "P1_pulse_rhr_style_shadow"
  | "REF0_age_sex_source_baseline";
type CandidateVerdict =
  | "held_not_ready"
  | "mixed_shadow"
  | "reference_only"
  | "supported_shadow_calibration_limited"
  | "supported_shadow_control_limited";

interface CandidateResult {
  blockers: string[];
  candidateId: CandidateId;
  evidence: Record<string, boolean | number | string | null>;
  role: "bloodwork_shadow" | "integrated_shadow" | "lead_diagnostic" | "reference" | "wearable_adjacent_shadow";
  verdict: CandidateVerdict;
}

interface InputArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface Inputs {
  r1009: unknown | null;
  r1047: unknown | null;
  r1050: unknown | null;
  r1051: unknown | null;
  r1054: unknown | null;
  r1056: unknown | null;
}

export interface R1057FunctionActivityPulseCandidateBatchResultOptions {
  createdAt?: string;
  outputDir?: string;
  r1009Path?: string;
  r1047Path?: string;
  r1050Path?: string;
  r1051Path?: string;
  r1054Path?: string;
  r1056Path?: string;
}

export interface R1057FunctionActivityPulseCandidateBatchResultOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1057: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1057: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  batchResult: {
    candidateResults: CandidateResult[];
    conclusion:
      | "candidate_batch_inputs_missing"
      | "function_activity_pulse_batch_supports_function_mobility_lead"
      | "partner_delta_requires_scientific_review_before_batch";
    leadCandidate: CandidateId | null;
    nextLocalAction:
      | "prepare_true_wearable_or_partner_validation_loop"
      | "repair_candidate_batch_inputs"
      | "send_partner_delta_to_reviewgpt";
    rationale: string;
    reviewGptRequiredBeforeNextLocalRun: boolean;
  };
  createdAt: string;
  inputArtifacts: Record<ArtifactKey, InputArtifactSummary>;
  packetId: "r1057-function-activity-pulse-candidate-batch-result";
  productPolicy: {
    displayAuthorized: false;
    promotionAuthorized: false;
    productClaimsAuthorized: false;
    recommendationClaimsAuthorized: false;
  };
  schemaVersion: typeof R1057_FUNCTION_ACTIVITY_PULSE_CANDIDATE_BATCH_RESULT_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    currentLead: "function_activity_mobility_shadow" | "partner_delta_review" | "none";
    nextLoopFocus: "true_wearable_or_partner_validation" | "review_partner_delta" | "repair_inputs";
    productDisplayAuthorized: false;
    reviewGptUse: "after_real_partner_or_new_source_delta";
    rowParsingPerformedByR1057: false;
  };
}

export async function runR1057FunctionActivityPulseCandidateBatchResult(
  options: R1057FunctionActivityPulseCandidateBatchResultOptions = {},
): Promise<{ output: R1057FunctionActivityPulseCandidateBatchResultOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const batchResult = reduceBatch(inputs);
  const output: R1057FunctionActivityPulseCandidateBatchResultOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      outcomeScoringPerformedByR1057: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR1057: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
    },
    batchResult,
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1057-function-activity-pulse-candidate-batch-result",
    productPolicy: {
      displayAuthorized: false,
      promotionAuthorized: false,
      productClaimsAuthorized: false,
      recommendationClaimsAuthorized: false,
    },
    schemaVersion: R1057_FUNCTION_ACTIVITY_PULSE_CANDIDATE_BATCH_RESULT_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      currentLead: batchResult.conclusion === "function_activity_pulse_batch_supports_function_mobility_lead"
        ? "function_activity_mobility_shadow"
        : batchResult.conclusion === "partner_delta_requires_scientific_review_before_batch"
          ? "partner_delta_review"
          : "none",
      nextLoopFocus: batchResult.nextLocalAction === "prepare_true_wearable_or_partner_validation_loop"
        ? "true_wearable_or_partner_validation"
        : batchResult.nextLocalAction === "send_partner_delta_to_reviewgpt"
          ? "review_partner_delta"
          : "repair_inputs",
      productDisplayAuthorized: false,
      reviewGptUse: "after_real_partner_or_new_source_delta",
      rowParsingPerformedByR1057: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1057 function/activity pulse candidate batch result failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function reduceBatch(inputs: Inputs): R1057FunctionActivityPulseCandidateBatchResultOutput["batchResult"] {
  const manifestReady = readStringAt(inputs.r1056, ["summary", "conclusion"]) === "function_activity_pulse_batch_ready";
  const partnerReviewNeeded =
    readStringAt(inputs.r1051, ["reduction", "conclusion"]) === "partner_wearable_delta_ready_for_scientific_review"
    || readStringAt(inputs.r1056, ["summary", "conclusion"]) === "partner_delta_review_takes_priority";
  const candidateResults = candidateResultsFromInputs(inputs);
  if (partnerReviewNeeded) {
    return {
      candidateResults,
      conclusion: "partner_delta_requires_scientific_review_before_batch",
      leadCandidate: null,
      nextLocalAction: "send_partner_delta_to_reviewgpt",
      rationale: "A real partner/workbench aggregate wearable delta outranks this local aggregate batch and should go to ReviewGPT for scientific interpretation.",
      reviewGptRequiredBeforeNextLocalRun: true,
    };
  }
  if (!manifestReady) {
    return {
      candidateResults,
      conclusion: "candidate_batch_inputs_missing",
      leadCandidate: null,
      nextLocalAction: "repair_candidate_batch_inputs",
      rationale: "The R1056 candidate batch manifest is missing or not ready.",
      reviewGptRequiredBeforeNextLocalRun: false,
    };
  }
  return {
    candidateResults,
    conclusion: "function_activity_pulse_batch_supports_function_mobility_lead",
    leadCandidate: "F1_walking_function_mobility_shadow",
    nextLocalAction: "prepare_true_wearable_or_partner_validation_loop",
    rationale: "Function/mobility remains the strongest shadow lead; objective activity and pulse/RHR are useful wearable-adjacent companions, while glycemia stays secondary and the integrated panel stays held.",
    reviewGptRequiredBeforeNextLocalRun: false,
  };
}

function candidateResultsFromInputs(inputs: Inputs): CandidateResult[] {
  const mhasSupport = readStringAt(inputs.r1009, ["summary", "conclusion"]) === "mhas_function_panel_extension_supports_lead_sidecar";
  const mhasControl = readStringAt(inputs.r1009, ["panelExtensionResult", "negativeControlVerdict"])
    === "function_beats_shuffled_negative_control";
  const functionCrossSource = readStringAt(inputs.r1054, ["summary", "currentFunctionActivityLead"])
    === "walking_function_shadow";
  const functionControlLimited = readStringAt(inputs.r1054, ["decision", "conclusion"])
    === "function_activity_shadow_signal_control_limited";
  const activitySupported = readStringAt(inputs.r1050, ["objectiveActivityContext", "status"])
    === "shadow_supported_calibration_limited";
  const pulseControlLimited = readStringAt(inputs.r1050, ["decision", "conclusion"])
    === "pulse_rhr_shadow_signal_mixed_control_limited";
  const pulseSupport = readStringAt(inputs.r1050, ["decision", "conclusion"]) === "pulse_rhr_shadow_signal_supported"
    || pulseControlLimited;
  const bloodworkLead = readStringAt(inputs.r1047, ["summary", "currentBloodworkLead"])
    === "glucose_hba1c_research_candidate";
  const bloodworkMixed = readStringAt(inputs.r1047, ["candidateFamilies", "bloodwork", "glucoseHba1c", "status"])
    === "active_research_candidate_mixed_external_support";
  const functionReady = mhasSupport && mhasControl && functionCrossSource;

  return [
    {
      blockers: [],
      candidateId: "REF0_age_sex_source_baseline",
      evidence: { referenceRequired: true },
      role: "reference",
      verdict: "reference_only",
    },
    {
      blockers: functionControlLimited ? ["missingness_or_context_controls_compete_in_at_least_one_source"] : [],
      candidateId: "F1_walking_function_mobility_shadow",
      evidence: {
        crossSourceFunctionLead: functionCrossSource,
        mhasControlBeaten: mhasControl,
        mhasSupport,
      },
      role: "lead_diagnostic",
      verdict: functionReady ? "supported_shadow_control_limited" : "held_not_ready",
    },
    {
      blockers: activitySupported ? ["calibration_limited"] : ["objective_activity_bridge_not_supported"],
      candidateId: "A1_objective_activity_bridge_shadow",
      evidence: {
        consumerWearableValidation: false,
        objectiveActivitySupported: activitySupported,
      },
      role: "wearable_adjacent_shadow",
      verdict: activitySupported ? "supported_shadow_calibration_limited" : "held_not_ready",
    },
    {
      blockers: pulseControlLimited ? ["controls_compete_in_at_least_one_source"] : [],
      candidateId: "P1_pulse_rhr_style_shadow",
      evidence: {
        cleanSupport: readNumberAt(inputs.r1050, ["pulsePhysiology", "supportCounts", "cleanSupport"]),
        controlLimited: readNumberAt(inputs.r1050, ["pulsePhysiology", "supportCounts", "controlLimited"]),
      },
      role: "wearable_adjacent_shadow",
      verdict: pulseSupport
        ? pulseControlLimited
          ? "supported_shadow_control_limited"
          : "supported_shadow_calibration_limited"
        : "held_not_ready",
    },
    {
      blockers: bloodworkMixed ? ["external_support_mixed_controls_compete"] : ["bloodwork_lead_missing"],
      candidateId: "G1_glucose_hba1c_secondary_shadow",
      evidence: {
        bloodworkLead,
        cleanSupport: readNumberAt(inputs.r1047, ["candidateFamilies", "bloodwork", "glucoseHba1c", "supportCounts", "cleanSupport"]),
        mixedSupport: readNumberAt(inputs.r1047, ["candidateFamilies", "bloodwork", "glucoseHba1c", "supportCounts", "mixedSupport"]),
      },
      role: "bloodwork_shadow",
      verdict: bloodworkLead && bloodworkMixed ? "mixed_shadow" : "held_not_ready",
    },
    {
      blockers: ["component_controls_not_clean_enough_for_integrated_panel"],
      candidateId: "I1_function_activity_pulse_small_panel_shadow",
      evidence: {
        activitySupported,
        bloodworkLead,
        functionReady,
        pulseSupport,
      },
      role: "integrated_shadow",
      verdict: "held_not_ready",
    },
  ];
}

async function readInputs(options: R1057FunctionActivityPulseCandidateBatchResultOptions): Promise<Inputs> {
  return {
    r1009: await readJsonIfPresent(
      options.r1009Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1009-mhas-function-panel-extension-result.latest.json"),
    ),
    r1047: await readJsonIfPresent(
      options.r1047Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1047-biomarker-evidence-state.latest.json"),
    ),
    r1050: await readJsonIfPresent(
      options.r1050Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1050-wearable-adjacent-physiology-state.latest.json"),
    ),
    r1051: await readJsonIfPresent(
      options.r1051Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1051-partner-wearable-aggregate-evaluator.latest.json"),
    ),
    r1054: await readJsonIfPresent(
      options.r1054Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1054-cross-source-function-physiology-state.latest.json"),
    ),
    r1056: await readJsonIfPresent(
      options.r1056Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1056-function-activity-pulse-candidate-batch-manifest.latest.json"),
    ),
  };
}

function validateInputBoundaries(inputs: Inputs): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1057 input ${key} failed aggregate boundary validation: ${findings.join("; ")}`);
    }
  }
}

function summarizeInputs(inputs: Inputs): Record<ArtifactKey, InputArtifactSummary> {
  return {
    r1009: summarizeInput("r1009_mhas_function_panel_extension_result", inputs.r1009),
    r1047: summarizeInput("r1047_biomarker_evidence_state", inputs.r1047),
    r1050: summarizeInput("r1050_wearable_adjacent_physiology_state", inputs.r1050),
    r1051: summarizeInput("r1051_partner_wearable_aggregate_evaluator", inputs.r1051),
    r1054: summarizeInput("r1054_cross_source_function_physiology_state", inputs.r1054),
    r1056: summarizeInput("r1056_function_activity_pulse_candidate_batch_manifest", inputs.r1056),
  };
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
  const valueAtPath = readAt(value, pathSegments);
  return typeof valueAtPath === "string" ? valueAtPath : null;
}

function readNumberAt(value: unknown | null, pathSegments: readonly string[]): number | null {
  const valueAtPath = readAt(value, pathSegments);
  return typeof valueAtPath === "number" && Number.isFinite(valueAtPath) ? valueAtPath : null;
}

function readAt(value: unknown | null, pathSegments: readonly string[]): unknown {
  let current: unknown = value;
  for (const segment of pathSegments) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function safeMetadata(value: string | null): string | null {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,120}$/u.test(value) ? value : null;
}

async function main(): Promise<void> {
  const { output } = await runR1057FunctionActivityPulseCandidateBatchResult({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1009Path: process.env.MURPH_AGE_R1009_MHAS_FUNCTION_RESULT_PATH,
    r1047Path: process.env.MURPH_AGE_R1047_BIOMARKER_STATE_PATH,
    r1050Path: process.env.MURPH_AGE_R1050_WEARABLE_PHYSIOLOGY_STATE_PATH,
    r1051Path: process.env.MURPH_AGE_R1051_PARTNER_EVALUATOR_PATH,
    r1054Path: process.env.MURPH_AGE_R1054_FUNCTION_PHYSIOLOGY_STATE_PATH,
    r1056Path: process.env.MURPH_AGE_R1056_CANDIDATE_BATCH_MANIFEST_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.batchResult.conclusion,
    currentLead: output.summary.currentLead,
    leadCandidate: output.batchResult.leadCandidate,
    nextLocalAction: output.batchResult.nextLocalAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    reviewGptRequiredBeforeNextLocalRun: output.batchResult.reviewGptRequiredBeforeNextLocalRun,
    rowParsingPerformedByR1057: output.summary.rowParsingPerformedByR1057,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1057 function/activity pulse candidate batch result failed."}\n`);
    process.exitCode = 1;
  });
}
