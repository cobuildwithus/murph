import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1089_LABS_WEARABLES_CANDIDATE_BATCH_MANIFEST_SCHEMA_VERSION =
  "murph-age-r1089-labs-wearables-candidate-batch-manifest.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_R1088_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "r1088-consumer-input-priority-state.latest.json");
const OUTPUT_FILE_NAME = "r1089-labs-wearables-candidate-batch-manifest.latest.json";

type CandidateId =
  | "I1_lab_plus_wearable_small_panel_shadow"
  | "L1_glycemia_minimal_shadow"
  | "L2_common_lab_body_bp_panel_shadow"
  | "QC1_missingness_coverage_quality_control"
  | "REF0_age_sex_source_baseline"
  | "W1_activity_steps_minutes_shadow"
  | "W2_sleep_duration_regularity_shadow"
  | "W3_recovery_rhr_hrv_quality_gated_shadow";
type CandidateRole =
  | "bloodwork_shadow"
  | "integrated_shadow"
  | "negative_control"
  | "reference"
  | "wearable_shadow";
type CandidateStatus = "blocked_until_true_wearable_receipt" | "held_until_components_pass" | "queued_for_next_local_loop" | "ready_reference";

interface CandidateFamily {
  candidateId: CandidateId;
  role: CandidateRole;
  sourceRequirement: string;
  status: CandidateStatus;
  userSubmitFit: "high" | "medium";
}

export interface R1089LabsWearablesCandidateBatchManifestOptions {
  createdAt?: string;
  outputDir?: string;
  r1088Path?: string;
}

export interface R1089LabsWearablesCandidateBatchManifestOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1089: false;
    participantIdentifiersStored: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1089: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
    variableNamesStored: false;
  };
  batch: {
    batchId: "labs_wearables_consumer_input_candidate_batch_v1";
    candidateFamilies: CandidateFamily[];
    candidateLimit: 8;
    hypothesis: string;
    targetUserInputs: [
      "common_labs_and_vitals",
      "activity_steps_or_minutes",
      "sleep_duration_or_regularity",
      "resting_hr_hrv_recovery_quality_gated",
    ];
  };
  createdAt: string;
  decisionRules: {
    discard: string[];
    keep: string[];
    sendToReviewGpt: string[];
  };
  evaluatorContract: {
    calibrationRequired: true;
    missingnessCoverageControlsRequired: true;
    sameDenominatorRequired: true;
    smallCellSuppressionRequired: true;
  };
  inputArtifact: {
    artifact: "r1088-consumer-input-priority-state.latest.json";
    packetId: string | null;
    schemaVersion: string | null;
    status: "available" | "missing";
  };
  packetId: "r1089-labs-wearables-candidate-batch-manifest";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1089_LABS_WEARABLES_CANDIDATE_BATCH_MANIFEST_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: "labs_wearables_batch_ready" | "consumer_priority_missing_or_not_ready";
    nextLocalAction:
      | "run_labs_wearables_shadow_batch_when_aggregate_data_available"
      | "rerun_consumer_input_priority_state";
    productDisplayAuthorized: false;
    reviewGptNextUse: "after_fresh_labs_or_true_wearable_aggregate_delta";
    rowParsingPerformedByR1089: false;
  };
}

export async function runR1089LabsWearablesCandidateBatchManifest(
  options: R1089LabsWearablesCandidateBatchManifestOptions = {},
): Promise<{ output: R1089LabsWearablesCandidateBatchManifestOutput; outputPath: string }> {
  const r1088 = await readJsonIfPresent(options.r1088Path ?? DEFAULT_R1088_PATH);
  validateInputBoundary(r1088);
  const ready = readStringAt(r1088, ["summary", "nextAutoresearchLoop"]) === "bloodwork_plus_wearable_priority_loop";
  const output: R1089LabsWearablesCandidateBatchManifestOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      outcomeScoringPerformedByR1089: false,
      participantIdentifiersStored: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR1089: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
      variableNamesStored: false,
    },
    batch: {
      batchId: "labs_wearables_consumer_input_candidate_batch_v1",
      candidateFamilies: candidateFamilies(ready),
      candidateLimit: 8,
      hypothesis: "For a 16-50 Murph user, the next useful research batch should favor common labs/vitals and consumer wearable aggregates, while keeping function/disability as context rather than the primary next model lane.",
      targetUserInputs: [
        "common_labs_and_vitals",
        "activity_steps_or_minutes",
        "sleep_duration_or_regularity",
        "resting_hr_hrv_recovery_quality_gated",
      ],
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    decisionRules: {
      discard: [
        "proper_scores_do_not_improve",
        "calibration_or_subgroup_calibration_worse",
        "missingness_or_device_coverage_control_matches_candidate",
        "shuffled_wearable_control_matches_candidate",
        "same_source_test_chasing_or_endpoint_drift",
      ],
      keep: [
        "same_denominator_comparison",
        "proper_scores_improve",
        "calibration_non_worse",
        "missingness_and_coverage_controls_beaten",
        "feature_family_is_user_submittable",
      ],
      sendToReviewGpt: [
        "clean_lab_delta_changes_bloodwork_architecture",
        "true_wearable_aggregate_delta_lands",
        "labs_and_wearables_conflict_across_sources",
        "promotion_or_product_display_question_arises",
      ],
    },
    evaluatorContract: {
      calibrationRequired: true,
      missingnessCoverageControlsRequired: true,
      sameDenominatorRequired: true,
      smallCellSuppressionRequired: true,
    },
    inputArtifact: summarizeInput(r1088),
    packetId: "r1089-labs-wearables-candidate-batch-manifest",
    productDisplayAuthorized: false,
    schemaVersion: R1089_LABS_WEARABLES_CANDIDATE_BATCH_MANIFEST_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: ready ? "labs_wearables_batch_ready" : "consumer_priority_missing_or_not_ready",
      nextLocalAction: ready
        ? "run_labs_wearables_shadow_batch_when_aggregate_data_available"
        : "rerun_consumer_input_priority_state",
      productDisplayAuthorized: false,
      reviewGptNextUse: "after_fresh_labs_or_true_wearable_aggregate_delta",
      rowParsingPerformedByR1089: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1089 labs/wearables candidate batch manifest failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function candidateFamilies(ready: boolean): CandidateFamily[] {
  const queued = ready ? "queued_for_next_local_loop" : "held_until_components_pass";
  return [
    {
      candidateId: "REF0_age_sex_source_baseline",
      role: "reference",
      sourceRequirement: "source_local_reference",
      status: "ready_reference",
      userSubmitFit: "high",
    },
    {
      candidateId: "L1_glycemia_minimal_shadow",
      role: "bloodwork_shadow",
      sourceRequirement: "bloodwork_source_with_outcome_and_controls",
      status: queued,
      userSubmitFit: "high",
    },
    {
      candidateId: "L2_common_lab_body_bp_panel_shadow",
      role: "bloodwork_shadow",
      sourceRequirement: "common_lab_vital_source_with_outcome_and_controls",
      status: queued,
      userSubmitFit: "high",
    },
    {
      candidateId: "W1_activity_steps_minutes_shadow",
      role: "wearable_shadow",
      sourceRequirement: "true_wearable_or_objective_activity_aggregate",
      status: ready ? "blocked_until_true_wearable_receipt" : "held_until_components_pass",
      userSubmitFit: "high",
    },
    {
      candidateId: "W2_sleep_duration_regularity_shadow",
      role: "wearable_shadow",
      sourceRequirement: "true_sleep_or_device_aggregate",
      status: ready ? "blocked_until_true_wearable_receipt" : "held_until_components_pass",
      userSubmitFit: "high",
    },
    {
      candidateId: "W3_recovery_rhr_hrv_quality_gated_shadow",
      role: "wearable_shadow",
      sourceRequirement: "true_recovery_autonomic_aggregate_with_coverage_controls",
      status: ready ? "blocked_until_true_wearable_receipt" : "held_until_components_pass",
      userSubmitFit: "high",
    },
    {
      candidateId: "QC1_missingness_coverage_quality_control",
      role: "negative_control",
      sourceRequirement: "same_denominator_quality_and_coverage_features_only",
      status: queued,
      userSubmitFit: "medium",
    },
    {
      candidateId: "I1_lab_plus_wearable_small_panel_shadow",
      role: "integrated_shadow",
      sourceRequirement: "bloodwork_and_true_wearable_components_both_clear_controls",
      status: "held_until_components_pass",
      userSubmitFit: "high",
    },
  ];
}

function validateInputBoundary(value: unknown | null): void {
  if (!value) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1089 input r1088 failed aggregate boundary validation: ${findings.join("; ")}`);
  }
}

function summarizeInput(value: unknown | null): R1089LabsWearablesCandidateBatchManifestOutput["inputArtifact"] {
  return {
    artifact: "r1088-consumer-input-priority-state.latest.json",
    packetId: readStringAt(value, ["packetId"]),
    schemaVersion: readStringAt(value, ["schemaVersion"]),
    status: value ? "available" : "missing",
  };
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
  let current: unknown = value;
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR1089LabsWearablesCandidateBatchManifest()
    .then(({ output }) => {
      process.stdout.write(`${JSON.stringify({
        conclusion: output.summary.conclusion,
        nextLocalAction: output.summary.nextLocalAction,
        packetId: output.packetId,
        productDisplayAuthorized: output.productDisplayAuthorized,
        queuedCandidates: output.batch.candidateFamilies.filter((candidate) =>
          candidate.status === "queued_for_next_local_loop"
        ).map((candidate) => candidate.candidateId),
        rowParsingPerformedByR1089: output.summary.rowParsingPerformedByR1089,
        schemaVersion: output.schemaVersion,
        status: output.status,
      }, null, 2)}\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : "R1089 labs/wearables candidate batch manifest failed."}\n`);
      process.exitCode = 1;
    });
}
