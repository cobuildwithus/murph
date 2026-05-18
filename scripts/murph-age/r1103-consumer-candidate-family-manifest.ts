import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1103_CONSUMER_CANDIDATE_FAMILY_MANIFEST_SCHEMA_VERSION =
  "murph-age-r1103-consumer-candidate-family-manifest.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1103-consumer-candidate-family-manifest.latest.json";

const INPUTS = {
  r1101: {
    artifact: "r1101-consumer-labs-wearables-loop-executor.latest.json",
    packetId: "r1101-consumer-labs-wearables-loop-executor",
    schemaVersion: "murph-age-r1101-consumer-labs-wearables-loop-executor.v1",
  },
  r1102: {
    artifact: "r1102-reviewgpt-consumer-direction-reducer.latest.json",
    packetId: "r1102-reviewgpt-consumer-direction-reducer",
    schemaVersion: "murph-age-r1102-reviewgpt-consumer-direction-reducer.v1",
  },
} as const;

type InputKey = keyof typeof INPUTS;
type CandidateStatus =
  | "active_external_aggregate_validation"
  | "fixed_shadow_external_aggregate_validation"
  | "blocked_until_outcome_linked_aggregate_receipt"
  | "active_required_control"
  | "held_until_components_pass";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface CandidateFamily {
  candidateId:
    | "L1_tiny_glycemia_only"
    | "L2_common_lab_core_shadow"
    | "W1_activity_steps_minutes"
    | "W2_sleep_duration_regularity"
    | "W3_rhr_hrv_recovery"
    | "QC_missingness_coverage"
    | "I1_integrated_lab_wearable_small_panel";
  priority: number;
  requiredBeforeScoreBearingResearch: string[];
  role:
    | "lab_candidate"
    | "wearable_candidate"
    | "negative_control"
    | "integrated_candidate";
  status: CandidateStatus;
  userSubmitFit: "high" | "medium";
}

export interface R1103ConsumerCandidateFamilyManifestOptions {
  createdAt?: string;
  outputDir?: string;
  r1101Path?: string;
  r1102Path?: string;
}

export interface R1103ConsumerCandidateFamilyManifestOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1103: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1103: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  candidateFamilies: CandidateFamily[];
  createdAt: string;
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  packetId: "r1103-consumer-candidate-family-manifest";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1103_CONSUMER_CANDIDATE_FAMILY_MANIFEST_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "consumer_candidate_family_manifest_ready"
      | "consumer_candidate_family_manifest_waiting_on_direction";
    immediateNextCandidate: "L1_tiny_glycemia_only" | null;
    nextAction:
      | "collect_aggregate_receipt_for_l1_l2_w1_first_pass"
      | "rerun_r1101_r1102_before_manifest";
    productDisplayAuthorized: false;
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1103: false;
  };
  thresholds: {
    generalUnlock: string | null;
    labUnlock: string | null;
    wearableUnlock: string | null;
  };
}

export async function runR1103ConsumerCandidateFamilyManifest(
  options: R1103ConsumerCandidateFamilyManifestOptions = {},
): Promise<{ output: R1103ConsumerCandidateFamilyManifestOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const ready = readStringAt(inputs.r1101, ["summary", "conclusion"]) === "consumer_loop_ready_awaiting_aggregate_receipt"
    && readStringAt(inputs.r1102, ["summary", "conclusion"]) === "reviewgpt_consumer_direction_reduced";
  const output: R1103ConsumerCandidateFamilyManifestOutput = {
    artifactBoundary: safeBoundary(),
    candidateFamilies: candidateFamilies(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1103-consumer-candidate-family-manifest",
    productDisplayAuthorized: false,
    schemaVersion: R1103_CONSUMER_CANDIDATE_FAMILY_MANIFEST_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: ready
        ? "consumer_candidate_family_manifest_ready"
        : "consumer_candidate_family_manifest_waiting_on_direction",
      immediateNextCandidate: ready ? "L1_tiny_glycemia_only" : null,
      nextAction: ready
        ? "collect_aggregate_receipt_for_l1_l2_w1_first_pass"
        : "rerun_r1101_r1102_before_manifest",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1103: false,
    },
    thresholds: {
      generalUnlock: readStringAt(inputs.r1102, ["reviewGptJson", "next_model_loops", "0", "success_threshold"]),
      labUnlock: readStringAt(inputs.r1102, ["reviewGptJson", "next_model_loops", "1", "success_threshold"]),
      wearableUnlock: readStringAt(inputs.r1102, ["reviewGptJson", "wearable_policy", "score_bearing_unlock_condition"]),
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1103 consumer candidate family manifest failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function candidateFamilies(): CandidateFamily[] {
  return [
    {
      candidateId: "L1_tiny_glycemia_only",
      priority: 1,
      requiredBeforeScoreBearingResearch: [
        "fresh_outcome_linked_aggregate_receipt",
        "proper_score_improvement_over_frozen_r399",
        "no_material_calibration_worsening",
        "consumer_viable_feature_coverage",
      ],
      role: "lab_candidate",
      status: "active_external_aggregate_validation",
      userSubmitFit: "high",
    },
    {
      candidateId: "L2_common_lab_core_shadow",
      priority: 2,
      requiredBeforeScoreBearingResearch: [
        "beat_frozen_r399",
        "beat_l1_tiny_glycemia_when_l1_fields_available",
        "avoid_uncommon_lab_dependency",
        "no_missingness_or_body_only_artifact",
      ],
      role: "lab_candidate",
      status: "fixed_shadow_external_aggregate_validation",
      userSubmitFit: "high",
    },
    {
      candidateId: "W1_activity_steps_minutes",
      priority: 3,
      requiredBeforeScoreBearingResearch: [
        "true_outcome_linked_wearable_aggregate_receipt",
        "valid_wear_coverage_summary",
        "coverage_quality_control_beaten",
        "shuffled_wearable_control_beaten",
      ],
      role: "wearable_candidate",
      status: "blocked_until_outcome_linked_aggregate_receipt",
      userSubmitFit: "high",
    },
    {
      candidateId: "W2_sleep_duration_regularity",
      priority: 4,
      requiredBeforeScoreBearingResearch: [
        "true_outcome_linked_sleep_aggregate_receipt",
        "valid_sleep_night_coverage_summary",
        "missingness_control_beaten",
      ],
      role: "wearable_candidate",
      status: "blocked_until_outcome_linked_aggregate_receipt",
      userSubmitFit: "high",
    },
    {
      candidateId: "W3_rhr_hrv_recovery",
      priority: 5,
      requiredBeforeScoreBearingResearch: [
        "true_outcome_linked_recovery_aggregate_receipt",
        "device_or_source_category_summary",
        "coverage_quality_control_beaten",
        "no_training_status_or_illness_context_artifact",
      ],
      role: "wearable_candidate",
      status: "blocked_until_outcome_linked_aggregate_receipt",
      userSubmitFit: "high",
    },
    {
      candidateId: "QC_missingness_coverage",
      priority: 6,
      requiredBeforeScoreBearingResearch: [
        "negative_control_only",
      ],
      role: "negative_control",
      status: "active_required_control",
      userSubmitFit: "medium",
    },
    {
      candidateId: "I1_integrated_lab_wearable_small_panel",
      priority: 7,
      requiredBeforeScoreBearingResearch: [
        "one_lab_component_passes_separately",
        "one_wearable_component_passes_separately",
        "incremental_gain_over_best_single_family",
      ],
      role: "integrated_candidate",
      status: "held_until_components_pass",
      userSubmitFit: "high",
    },
  ];
}

async function readInputs(options: R1103ConsumerCandidateFamilyManifestOptions): Promise<Record<InputKey, unknown | null>> {
  return {
    r1101: await readJsonIfPresent(options.r1101Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1101.artifact)),
    r1102: await readJsonIfPresent(options.r1102Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1102.artifact)),
  };
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1103 rejected unsafe ${key} input: ${findings.join("; ")}`);
    }
  }
}

function summarizeInputs(inputs: Record<InputKey, unknown | null>): Record<InputKey, ArtifactSummary> {
  return Object.fromEntries(
    (Object.entries(INPUTS) as Array<[InputKey, typeof INPUTS[InputKey]]>).map(([key, expected]) => {
      const input = inputs[key];
      return [key, {
        artifact: expected.artifact,
        packetId: readStringAt(input, ["packetId"]),
        schemaVersion: readStringAt(input, ["schemaVersion"]),
        status: input ? "available" : "missing",
      }];
    }),
  ) as Record<InputKey, ArtifactSummary>;
}

function safeBoundary(): R1103ConsumerCandidateFamilyManifestOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1103: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1103: false,
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
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function readAt(value: unknown, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (Array.isArray(current)) {
      const index = Number.parseInt(part, 10);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return null;
      current = current[index];
      continue;
    }
    if (!current || typeof current !== "object" || Array.isArray(current) || !(part in current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
}

async function main(): Promise<void> {
  const { output } = await runR1103ConsumerCandidateFamilyManifest({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1101Path: process.env.MURPH_AGE_R1101_CONSUMER_LOOP_PATH,
    r1102Path: process.env.MURPH_AGE_R1102_REVIEWGPT_DIRECTION_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    candidateCount: output.candidateFamilies.length,
    conclusion: output.summary.conclusion,
    immediateNextCandidate: output.summary.immediateNextCandidate,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowParsingPerformedByR1103: output.summary.rowParsingPerformedByR1103,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1103 consumer candidate family manifest failed."}\n`);
    process.exitCode = 1;
  });
}
