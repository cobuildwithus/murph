import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1055_INTEGRATED_MODEL_DIRECTION_STATE_SCHEMA_VERSION =
  "murph-age-r1055-integrated-model-direction-state.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1055-integrated-model-direction-state.latest.json";

type InputKey = "r1047" | "r1050" | "r1051" | "r1054" | "r1009";
type ComponentStatus =
  | "awaiting_partner_or_workbench_receipt"
  | "lead_shadow_control_limited"
  | "mixed_external_support_shadow"
  | "not_available"
  | "ready_for_scientific_review"
  | "shadow_supported_calibration_limited"
  | "shadow_supported_control_limited";
type DirectionCandidateId =
  | "function_activity_mobility_panel"
  | "minimal_glucose_hba1c_labs"
  | "objective_activity_pulse_rhr_bridge"
  | "small_integrated_lab_activity_function_panel";

interface InputArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface ComponentEvidence {
  rationale: string;
  reviewGptUse: "after_meaningful_aggregate_delta" | "now_for_partner_delta" | "not_before_next_local_run";
  status: ComponentStatus;
  support: Record<string, string | number | boolean | null>;
}

interface DirectionCandidate {
  candidateId: DirectionCandidateId;
  nextUse:
    | "batch_manifest_for_next_local_autoresearch_loop"
    | "defer_until_component_controls_pass"
    | "keep_shadow_for_future_external_transport"
    | "send_partner_delta_to_reviewgpt";
  rank: 1 | 2 | 3 | 4;
  rationale: string;
  status: "active_next_loop_candidate" | "deferred_shadow_candidate" | "review_ready_partner_candidate";
}

export interface R1055IntegratedModelDirectionStateOptions {
  createdAt?: string;
  outputDir?: string;
  r1009Path?: string;
  r1047Path?: string;
  r1050Path?: string;
  r1051Path?: string;
  r1054Path?: string;
}

export interface R1055IntegratedModelDirectionStateOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  candidatePriority: DirectionCandidate[];
  componentEvidence: {
    bloodworkGlycemia: ComponentEvidence;
    functionActivity: ComponentEvidence;
    objectiveActivity: ComponentEvidence;
    partnerWearable: ComponentEvidence;
    pulsePhysiology: ComponentEvidence;
  };
  createdAt: string;
  inputArtifacts: Record<InputKey, InputArtifactSummary>;
  nextAutoresearchDecision: {
    conclusion:
      | "function_activity_lead_partner_wearable_blocked"
      | "inputs_missing_or_not_enough_signal"
      | "partner_integrated_wearable_delta_ready_for_review";
    nextLocalAction:
      | "build_function_activity_pulse_candidate_batch_manifest"
      | "repair_missing_aggregate_inputs"
      | "send_partner_aggregate_delta_to_reviewgpt_for_science_review";
    rationale: string;
    reviewGptNextUse:
      | "after_next_meaningful_aggregate_delta"
      | "partner_or_workbench_scientific_delta_now"
      | "not_before_next_local_run";
    reviewGptRequiredBeforeNextLocalRun: boolean;
  };
  packetId: "r1055-integrated-model-direction-state";
  productPolicy: {
    displayAuthorized: false;
    promotionAuthorized: false;
    productClaimsAuthorized: false;
    recommendationClaimsAuthorized: false;
  };
  schemaVersion: typeof R1055_INTEGRATED_MODEL_DIRECTION_STATE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    currentBloodworkLead: "glucose_hba1c_research_candidate" | "none";
    currentFunctionActivityLead: "walking_function_and_mobility_shadow" | "none";
    currentWearableAdjacentLead: "objective_activity_plus_pulse_shadow" | "objective_activity_shadow_only" | "none";
    modelUse: "research_only_no_product_display";
    nextLoopFocus:
      | "function_activity_pulse_candidate_batch"
      | "partner_wearable_delta_review"
      | "repair_inputs_before_loop";
    reviewGptUse: "major_scientific_result_review_only";
  };
}

interface Inputs {
  r1009: unknown | null;
  r1047: unknown | null;
  r1050: unknown | null;
  r1051: unknown | null;
  r1054: unknown | null;
}

export async function runR1055IntegratedModelDirectionState(
  options: R1055IntegratedModelDirectionStateOptions = {},
): Promise<{ output: R1055IntegratedModelDirectionStateOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const componentEvidence = {
    bloodworkGlycemia: summarizeBloodwork(inputs.r1047),
    functionActivity: summarizeFunctionActivity(inputs.r1054, inputs.r1009),
    objectiveActivity: summarizeObjectiveActivity(inputs.r1050),
    partnerWearable: summarizePartnerWearable(inputs.r1051),
    pulsePhysiology: summarizePulsePhysiology(inputs.r1050),
  };
  const candidatePriority = rankCandidates(componentEvidence);
  const nextAutoresearchDecision = decideNextAutoresearchStep(componentEvidence, candidatePriority);
  const output: R1055IntegratedModelDirectionStateOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
    },
    candidatePriority,
    componentEvidence,
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    nextAutoresearchDecision,
    packetId: "r1055-integrated-model-direction-state",
    productPolicy: {
      displayAuthorized: false,
      promotionAuthorized: false,
      productClaimsAuthorized: false,
      recommendationClaimsAuthorized: false,
    },
    schemaVersion: R1055_INTEGRATED_MODEL_DIRECTION_STATE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      currentBloodworkLead: componentEvidence.bloodworkGlycemia.status === "mixed_external_support_shadow"
        ? "glucose_hba1c_research_candidate"
        : "none",
      currentFunctionActivityLead: componentEvidence.functionActivity.status === "lead_shadow_control_limited"
        ? "walking_function_and_mobility_shadow"
        : "none",
      currentWearableAdjacentLead: componentEvidence.pulsePhysiology.status === "shadow_supported_control_limited"
        ? "objective_activity_plus_pulse_shadow"
        : componentEvidence.objectiveActivity.status === "shadow_supported_calibration_limited"
          ? "objective_activity_shadow_only"
          : "none",
      modelUse: "research_only_no_product_display",
      nextLoopFocus: nextLoopFocus(nextAutoresearchDecision),
      reviewGptUse: "major_scientific_result_review_only",
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1055 integrated model direction state failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function summarizeBloodwork(value: unknown | null): ComponentEvidence {
  const lead = readStringAt(value, ["summary", "currentBloodworkLead"]);
  const status = readStringAt(value, ["candidateFamilies", "bloodwork", "glucoseHba1c", "status"]);
  const support = readRecordAt(value, ["candidateFamilies", "bloodwork", "glucoseHba1c", "supportCounts"]);
  if (lead !== "glucose_hba1c_research_candidate") {
    return componentMissing("No active aggregate bloodwork lead is available.");
  }
  return {
    rationale: "Glucose/HbA1c remains the current bloodwork candidate, but external support is mixed and controls compete in multiple transport checks.",
    reviewGptUse: "not_before_next_local_run",
    status: status === "active_research_candidate_mixed_external_support"
      ? "mixed_external_support_shadow"
      : "not_available",
    support: {
      cleanSupport: readNumberAt(support, ["cleanSupport"]),
      mixedSupport: readNumberAt(support, ["mixedSupport"]),
      negativeOrMissing: readNumberAt(support, ["negativeOrMissing"]),
    },
  };
}

function summarizeFunctionActivity(r1054: unknown | null, r1009: unknown | null): ComponentEvidence {
  const crossSourceLead = readStringAt(r1054, ["summary", "currentFunctionActivityLead"]) === "walking_function_shadow";
  const crossSourceConclusion = readStringAt(r1054, ["decision", "conclusion"]);
  const mhasSupport = readStringAt(r1009, ["summary", "conclusion"]) === "mhas_function_panel_extension_supports_lead_sidecar";
  const mhasNegativeControl = readStringAt(r1009, ["panelExtensionResult", "negativeControlVerdict"]);
  if (!crossSourceLead && !mhasSupport) {
    return componentMissing("Function/activity aggregate support is unavailable or not yet confirmed.");
  }
  return {
    rationale: mhasSupport
      ? "Walking/function and mobility-style signals are the strongest current shadow direction: MHAS supports a mobility panel against its shuffled control, while HAALSI/NSHAP support walking/function but remain control-limited."
      : "HAALSI/NSHAP support walking/function as a shadow direction, but broader mobility support is not yet available.",
    reviewGptUse: "after_meaningful_aggregate_delta",
    status: "lead_shadow_control_limited",
    support: {
      crossSourceControlLimited: crossSourceConclusion === "function_activity_shadow_signal_control_limited",
      crossSourceLead,
      mhasNegativeControlBeaten: mhasNegativeControl === "function_beats_shuffled_negative_control",
      mhasSupport,
    },
  };
}

function summarizeObjectiveActivity(value: unknown | null): ComponentEvidence {
  const activityStatus = readStringAt(value, ["objectiveActivityContext", "status"]);
  if (activityStatus !== "shadow_supported_calibration_limited") {
    return componentMissing("Objective activity bridge is missing or not supported.");
  }
  return {
    rationale: "NHANES objective activity improves aggregate proper scores, but it is calibration-limited and is not consumer wearable validation.",
    reviewGptUse: "not_before_next_local_run",
    status: "shadow_supported_calibration_limited",
    support: {
      calibrationLimited: true,
      consumerWearableValidation: false,
      objectiveActivityBridge: true,
    },
  };
}

function summarizePulsePhysiology(value: unknown | null): ComponentEvidence {
  const conclusion = readStringAt(value, ["decision", "conclusion"]);
  const support = readRecordAt(value, ["pulsePhysiology", "supportCounts"]);
  if (conclusion !== "pulse_rhr_shadow_signal_mixed_control_limited"
    && conclusion !== "pulse_rhr_shadow_signal_supported") {
    return componentMissing("Pulse/RHR-style physiology is missing or not supported.");
  }
  return {
    rationale: "Pulse/RHR-style physiology has aggregate support, but at least one source is control-limited and none of the current evidence is true consumer wearable validation.",
    reviewGptUse: "not_before_next_local_run",
    status: conclusion === "pulse_rhr_shadow_signal_supported"
      ? "shadow_supported_calibration_limited"
      : "shadow_supported_control_limited",
    support: {
      cleanSupport: readNumberAt(support, ["cleanSupport"]),
      controlLimited: readNumberAt(support, ["controlLimited"]),
      negativeOrMissing: readNumberAt(support, ["negativeOrMissing"]),
    },
  };
}

function summarizePartnerWearable(value: unknown | null): ComponentEvidence {
  const conclusion = readStringAt(value, ["reduction", "conclusion"]);
  const reviewGptRequired = readBooleanAt(value, ["reduction", "reviewGptRequired"]);
  if (conclusion === "partner_wearable_delta_ready_for_scientific_review" || reviewGptRequired === true) {
    return {
      rationale: "A partner/workbench aggregate wearable delta is ready; this is the right point for ReviewGPT scientific interpretation.",
      reviewGptUse: "now_for_partner_delta",
      status: "ready_for_scientific_review",
      support: {
        aggregateReceiptAvailable: true,
        reviewGptRequired: true,
      },
    };
  }
  return {
    rationale: "The partner/workbench evaluator exists, but no aggregate wearable receipt has landed yet.",
    reviewGptUse: "not_before_next_local_run",
    status: "awaiting_partner_or_workbench_receipt",
    support: {
      aggregateReceiptAvailable: false,
      reviewGptRequired: false,
    },
  };
}

function rankCandidates(
  evidence: R1055IntegratedModelDirectionStateOutput["componentEvidence"],
): DirectionCandidate[] {
  if (evidence.partnerWearable.status === "ready_for_scientific_review") {
    return [
      {
        candidateId: "objective_activity_pulse_rhr_bridge",
        nextUse: "send_partner_delta_to_reviewgpt",
        rank: 1,
        rationale: "Partner/workbench aggregate wearable evidence is ready for scientific review before another local loop.",
        status: "review_ready_partner_candidate",
      },
      integratedPanel(2),
      functionActivityCandidate(3, "keep_shadow_for_future_external_transport"),
      glycemiaCandidate(4),
    ];
  }

  return [
    functionActivityCandidate(1, "batch_manifest_for_next_local_autoresearch_loop"),
    {
      candidateId: "objective_activity_pulse_rhr_bridge",
      nextUse: "batch_manifest_for_next_local_autoresearch_loop",
      rank: 2,
      rationale: "Objective activity and pulse/RHR-style physiology are wearable-adjacent, but still need true wearable or partner aggregate validation.",
      status: "active_next_loop_candidate",
    },
    glycemiaCandidate(3),
    integratedPanel(4),
  ];
}

function functionActivityCandidate(
  rank: 1 | 2 | 3 | 4,
  nextUse: DirectionCandidate["nextUse"],
): DirectionCandidate {
  return {
    candidateId: "function_activity_mobility_panel",
    nextUse,
    rank,
    rationale: "Walking/function and mobility have the strongest current cross-source shadow support, including MHAS aggregate support.",
    status: nextUse === "batch_manifest_for_next_local_autoresearch_loop"
      ? "active_next_loop_candidate"
      : "deferred_shadow_candidate",
  };
}

function glycemiaCandidate(rank: 1 | 2 | 3 | 4): DirectionCandidate {
  return {
    candidateId: "minimal_glucose_hba1c_labs",
    nextUse: "keep_shadow_for_future_external_transport",
    rank,
    rationale: "Glycemia is still the lead bloodwork candidate, but support is mixed and should not outrank function/activity until controls are cleaner.",
    status: "deferred_shadow_candidate",
  };
}

function integratedPanel(rank: 1 | 2 | 3 | 4): DirectionCandidate {
  return {
    candidateId: "small_integrated_lab_activity_function_panel",
    nextUse: "defer_until_component_controls_pass",
    rank,
    rationale: "A small integrated panel is the eventual model shape, but it should wait until component-specific controls are cleaner.",
    status: "deferred_shadow_candidate",
  };
}

function decideNextAutoresearchStep(
  evidence: R1055IntegratedModelDirectionStateOutput["componentEvidence"],
  candidatePriority: DirectionCandidate[],
): R1055IntegratedModelDirectionStateOutput["nextAutoresearchDecision"] {
  if (evidence.partnerWearable.status === "ready_for_scientific_review") {
    return {
      conclusion: "partner_integrated_wearable_delta_ready_for_review",
      nextLocalAction: "send_partner_aggregate_delta_to_reviewgpt_for_science_review",
      rationale: "A meaningful partner/workbench aggregate delta should be interpreted by ReviewGPT before more local candidate search.",
      reviewGptNextUse: "partner_or_workbench_scientific_delta_now",
      reviewGptRequiredBeforeNextLocalRun: true,
    };
  }
  if (candidatePriority[0]?.candidateId === "function_activity_mobility_panel") {
    return {
      conclusion: "function_activity_lead_partner_wearable_blocked",
      nextLocalAction: "build_function_activity_pulse_candidate_batch_manifest",
      rationale: "No partner wearable receipt is ready, so the next local loop should batch function/activity plus pulse/RHR-style wearable-adjacent candidates and keep glycemia as a secondary shadow layer.",
      reviewGptNextUse: "after_next_meaningful_aggregate_delta",
      reviewGptRequiredBeforeNextLocalRun: false,
    };
  }
  return {
    conclusion: "inputs_missing_or_not_enough_signal",
    nextLocalAction: "repair_missing_aggregate_inputs",
    rationale: "The required aggregate state artifacts are missing or do not support a next loop direction.",
    reviewGptNextUse: "not_before_next_local_run",
    reviewGptRequiredBeforeNextLocalRun: false,
  };
}

function nextLoopFocus(
  decision: R1055IntegratedModelDirectionStateOutput["nextAutoresearchDecision"],
): R1055IntegratedModelDirectionStateOutput["summary"]["nextLoopFocus"] {
  if (decision.conclusion === "partner_integrated_wearable_delta_ready_for_review") {
    return "partner_wearable_delta_review";
  }
  if (decision.conclusion === "function_activity_lead_partner_wearable_blocked") {
    return "function_activity_pulse_candidate_batch";
  }
  return "repair_inputs_before_loop";
}

async function readInputs(options: R1055IntegratedModelDirectionStateOptions): Promise<Inputs> {
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
  };
}

function validateInputBoundaries(inputs: Inputs): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1055 input ${key} failed aggregate boundary validation: ${findings.join("; ")}`);
    }
  }
}

function summarizeInputs(inputs: Inputs): Record<InputKey, InputArtifactSummary> {
  return {
    r1009: summarizeInput("r1009_mhas_function_panel_extension_result", inputs.r1009),
    r1047: summarizeInput("r1047_biomarker_evidence_state", inputs.r1047),
    r1050: summarizeInput("r1050_wearable_adjacent_physiology_state", inputs.r1050),
    r1051: summarizeInput("r1051_partner_wearable_aggregate_evaluator", inputs.r1051),
    r1054: summarizeInput("r1054_cross_source_function_physiology_state", inputs.r1054),
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

function componentMissing(rationale: string): ComponentEvidence {
  return {
    rationale,
    reviewGptUse: "not_before_next_local_run",
    status: "not_available",
    support: {},
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

function readRecordAt(value: unknown | null, pathSegments: readonly string[]): Record<string, unknown> | null {
  const valueAtPath = readAt(value, pathSegments);
  return valueAtPath && typeof valueAtPath === "object" && !Array.isArray(valueAtPath)
    ? valueAtPath as Record<string, unknown>
    : null;
}

function readStringAt(value: unknown | null, pathSegments: readonly string[]): string | null {
  const valueAtPath = readAt(value, pathSegments);
  return typeof valueAtPath === "string" ? valueAtPath : null;
}

function readNumberAt(value: unknown | null, pathSegments: readonly string[]): number | null {
  const valueAtPath = readAt(value, pathSegments);
  return typeof valueAtPath === "number" && Number.isFinite(valueAtPath) ? valueAtPath : null;
}

function readBooleanAt(value: unknown | null, pathSegments: readonly string[]): boolean | null {
  const valueAtPath = readAt(value, pathSegments);
  return typeof valueAtPath === "boolean" ? valueAtPath : null;
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
  const { output } = await runR1055IntegratedModelDirectionState({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1009Path: process.env.MURPH_AGE_R1009_MHAS_FUNCTION_RESULT_PATH,
    r1047Path: process.env.MURPH_AGE_R1047_BIOMARKER_STATE_PATH,
    r1050Path: process.env.MURPH_AGE_R1050_WEARABLE_PHYSIOLOGY_STATE_PATH,
    r1051Path: process.env.MURPH_AGE_R1051_PARTNER_EVALUATOR_PATH,
    r1054Path: process.env.MURPH_AGE_R1054_FUNCTION_PHYSIOLOGY_STATE_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    artifact: OUTPUT_FILE_NAME,
    conclusion: output.nextAutoresearchDecision.conclusion,
    firstCandidate: output.candidatePriority[0]?.candidateId ?? null,
    nextLocalAction: output.nextAutoresearchDecision.nextLocalAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productPolicy.displayAuthorized,
    reviewGptRequiredBeforeNextLocalRun: output.nextAutoresearchDecision.reviewGptRequiredBeforeNextLocalRun,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1055 integrated model direction state failed."}\n`);
    process.exitCode = 1;
  });
}
