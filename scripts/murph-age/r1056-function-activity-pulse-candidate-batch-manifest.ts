import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1056_FUNCTION_ACTIVITY_PULSE_CANDIDATE_BATCH_MANIFEST_SCHEMA_VERSION =
  "murph-age-r1056-function-activity-pulse-candidate-batch-manifest.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_R1055_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "r1055-integrated-model-direction-state.latest.json");
const OUTPUT_FILE_NAME = "r1056-function-activity-pulse-candidate-batch-manifest.latest.json";

type CandidateId =
  | "A1_objective_activity_bridge_shadow"
  | "F1_walking_function_mobility_shadow"
  | "G1_glucose_hba1c_secondary_shadow"
  | "I1_function_activity_pulse_small_panel_shadow"
  | "P1_pulse_rhr_style_shadow"
  | "REF0_age_sex_source_baseline";
type CandidateRole = "bloodwork_shadow" | "integrated_shadow" | "lead_diagnostic" | "reference" | "wearable_adjacent_shadow";
type CandidateStatus = "held_until_components_pass" | "queued_for_next_local_loop" | "ready_reference";

interface CandidateFamily {
  candidateId: CandidateId;
  requiredEvidence: string[];
  role: CandidateRole;
  status: CandidateStatus;
}

interface InputArtifactSummary {
  artifact: "r1055_integrated_model_direction_state";
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

export interface R1056FunctionActivityPulseCandidateBatchManifestOptions {
  createdAt?: string;
  outputDir?: string;
  r1055Path?: string;
}

export interface R1056FunctionActivityPulseCandidateBatchManifestOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformed: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1056: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  batch: {
    allowedExecution: Array<"aggregate_only_export" | "locked_local_evaluator">;
    batchId: "function_activity_pulse_candidate_batch_v1";
    blockedExecution: string[];
    candidateFamilies: CandidateFamily[];
    candidateLimit: 6;
    hypothesis: string;
    localRunPurpose: "next_autoresearch_candidate_batch";
    sourceLanes: string[];
  };
  createdAt: string;
  decisionRules: {
    discard: string[];
    keep: string[];
    sendToReviewGpt: string[];
  };
  evaluatorContract: {
    calibrationRequired: true;
    negativeControlsRequired: string[];
    sameDenominatorRequired: true;
    smallCellSuppressionRequired: true;
  };
  inputArtifact: InputArtifactSummary;
  packetId: "r1056-function-activity-pulse-candidate-batch-manifest";
  schemaVersion: typeof R1056_FUNCTION_ACTIVITY_PULSE_CANDIDATE_BATCH_MANIFEST_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "function_activity_pulse_batch_ready"
      | "partner_delta_review_takes_priority"
      | "r1055_direction_missing_or_not_ready";
    nextLocalAction:
      | "run_function_activity_pulse_candidate_batch"
      | "send_partner_delta_to_reviewgpt_before_local_batch"
      | "rerun_r1055_integrated_direction_state";
    productDisplayAuthorized: false;
    reviewGptNextUse: "after_fresh_aggregate_delta_or_partner_delta_only";
    rowParsingPerformedByR1056: false;
  };
}

export async function runR1056FunctionActivityPulseCandidateBatchManifest(
  options: R1056FunctionActivityPulseCandidateBatchManifestOptions = {},
): Promise<{ output: R1056FunctionActivityPulseCandidateBatchManifestOutput; outputPath: string }> {
  const r1055 = await readJsonIfPresent(options.r1055Path ?? DEFAULT_R1055_PATH);
  validateInputBoundary(r1055);

  const conclusion = summarizeConclusion(r1055);
  const output: R1056FunctionActivityPulseCandidateBatchManifestOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      localFileNamesStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      outcomeScoringPerformed: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR1056: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
    },
    batch: {
      allowedExecution: ["locked_local_evaluator", "aggregate_only_export"],
      batchId: "function_activity_pulse_candidate_batch_v1",
      blockedExecution: [
        "product_display_or_claim",
        "broad_automl_search",
        "neural_model_search",
        "same_source_repeated_test_chasing",
        "synthetic_wearable_label_creation",
        "individual_level_export",
      ],
      candidateFamilies: candidateFamilies(conclusion),
      candidateLimit: 6,
      hypothesis: "Walking/function, mobility, objective activity, and pulse/RHR-style physiology should be tested as a small wearable-adjacent increment batch before expanding the bloodwork or integrated panel search.",
      localRunPurpose: "next_autoresearch_candidate_batch",
      sourceLanes: [
        "mhas_function_mobility_aggregate",
        "haalsi_walk_pulse_glucose_aggregate",
        "nshap_function_pulse_hba1c_aggregate",
        "nhanes_objective_activity_lab_bridge",
        "partner_workbench_aggregate_when_available",
      ],
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    decisionRules: {
      discard: [
        "proper_scores_do_not_improve",
        "calibration_materially_worse",
        "negative_control_matches_or_beats_candidate",
        "missingness_or_coverage_explains_signal",
        "denominator_or_endpoint_drift",
      ],
      keep: [
        "same_denominator_comparison",
        "proper_scores_improve",
        "calibration_non_worse",
        "negative_controls_beaten",
        "shadow_direction_replicates_across_sources",
      ],
      sendToReviewGpt: [
        "fresh_meaningful_aggregate_delta",
        "function_and_pulse_results_conflict",
        "partner_wearable_delta_lands",
        "model_family_fork_needed",
      ],
    },
    evaluatorContract: {
      calibrationRequired: true,
      negativeControlsRequired: [
        "missingness_quality_only",
        "coverage_quality_only",
        "shuffled_function_or_activity",
        "body_or_context_only_when_available",
      ],
      sameDenominatorRequired: true,
      smallCellSuppressionRequired: true,
    },
    inputArtifact: summarizeInput(r1055),
    packetId: "r1056-function-activity-pulse-candidate-batch-manifest",
    schemaVersion: R1056_FUNCTION_ACTIVITY_PULSE_CANDIDATE_BATCH_MANIFEST_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      nextLocalAction: nextLocalAction(conclusion),
      productDisplayAuthorized: false,
      reviewGptNextUse: "after_fresh_aggregate_delta_or_partner_delta_only",
      rowParsingPerformedByR1056: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1056 function/activity pulse candidate batch manifest failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function summarizeConclusion(
  r1055: unknown | null,
): R1056FunctionActivityPulseCandidateBatchManifestOutput["summary"]["conclusion"] {
  const conclusion = readStringAt(r1055, ["nextAutoresearchDecision", "conclusion"]);
  if (conclusion === "partner_integrated_wearable_delta_ready_for_review") return "partner_delta_review_takes_priority";
  if (conclusion === "function_activity_lead_partner_wearable_blocked") return "function_activity_pulse_batch_ready";
  return "r1055_direction_missing_or_not_ready";
}

function nextLocalAction(
  conclusion: R1056FunctionActivityPulseCandidateBatchManifestOutput["summary"]["conclusion"],
): R1056FunctionActivityPulseCandidateBatchManifestOutput["summary"]["nextLocalAction"] {
  if (conclusion === "function_activity_pulse_batch_ready") return "run_function_activity_pulse_candidate_batch";
  if (conclusion === "partner_delta_review_takes_priority") return "send_partner_delta_to_reviewgpt_before_local_batch";
  return "rerun_r1055_integrated_direction_state";
}

function candidateFamilies(
  conclusion: R1056FunctionActivityPulseCandidateBatchManifestOutput["summary"]["conclusion"],
): CandidateFamily[] {
  const queued = conclusion === "function_activity_pulse_batch_ready";
  return [
    {
      candidateId: "REF0_age_sex_source_baseline",
      requiredEvidence: [],
      role: "reference",
      status: "ready_reference",
    },
    {
      candidateId: "F1_walking_function_mobility_shadow",
      requiredEvidence: [
        "mhas_function_mobility_support",
        "haalsi_nshap_walking_function_support",
      ],
      role: "lead_diagnostic",
      status: queued ? "queued_for_next_local_loop" : "held_until_components_pass",
    },
    {
      candidateId: "A1_objective_activity_bridge_shadow",
      requiredEvidence: ["nhanes_objective_activity_bridge"],
      role: "wearable_adjacent_shadow",
      status: queued ? "queued_for_next_local_loop" : "held_until_components_pass",
    },
    {
      candidateId: "P1_pulse_rhr_style_shadow",
      requiredEvidence: ["haalsi_nshap_pulse_support"],
      role: "wearable_adjacent_shadow",
      status: queued ? "queued_for_next_local_loop" : "held_until_components_pass",
    },
    {
      candidateId: "G1_glucose_hba1c_secondary_shadow",
      requiredEvidence: ["mixed_external_glycemia_support"],
      role: "bloodwork_shadow",
      status: queued ? "queued_for_next_local_loop" : "held_until_components_pass",
    },
    {
      candidateId: "I1_function_activity_pulse_small_panel_shadow",
      requiredEvidence: [
        "component_specific_controls_pass",
        "same_denominator_integrated_evaluation",
      ],
      role: "integrated_shadow",
      status: "held_until_components_pass",
    },
  ];
}

function validateInputBoundary(r1055: unknown | null): void {
  if (!r1055) return;
  const findings = findForbiddenAggregateEgress(r1055);
  if (findings.length > 0) {
    throw new Error(`R1056 input r1055 failed aggregate boundary validation: ${findings.join("; ")}`);
  }
}

function summarizeInput(value: unknown | null): InputArtifactSummary {
  return {
    artifact: "r1055_integrated_model_direction_state",
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
  const { output } = await runR1056FunctionActivityPulseCandidateBatchManifest({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1055Path: process.env.MURPH_AGE_R1055_INTEGRATED_DIRECTION_STATE_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    batchId: output.batch.batchId,
    candidateCount: output.batch.candidateFamilies.length,
    conclusion: output.summary.conclusion,
    nextLocalAction: output.summary.nextLocalAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    rowParsingPerformedByR1056: output.summary.rowParsingPerformedByR1056,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1056 function/activity pulse candidate batch manifest failed."}\n`);
    process.exitCode = 1;
  });
}
