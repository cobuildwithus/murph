import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1090_CONSUMER_FEATURE_REGISTRY_STATE_SCHEMA_VERSION =
  "murph-age-r1090-consumer-feature-registry-state.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1090-consumer-feature-registry-state.latest.json";

const INPUTS = {
  r1047: {
    artifact: "r1047-biomarker-evidence-state.latest.json",
    packetId: "r1047-biomarker-evidence-state",
    schemaVersion: "murph-age-r1047-biomarker-evidence-state.v1",
  },
  r1050: {
    artifact: "r1050-wearable-adjacent-physiology-state.latest.json",
    packetId: "r1050-wearable-adjacent-physiology-state",
    schemaVersion: "murph-age-r1050-wearable-adjacent-physiology-state.v1",
  },
  r1051: {
    artifact: "r1051-partner-wearable-aggregate-evaluator.latest.json",
    packetId: "r1051-partner-wearable-aggregate-evaluator",
    schemaVersion: "murph-age-r1051-partner-wearable-aggregate-evaluator.v1",
  },
  r1060: {
    artifact: "r1060-local-true-wearable-source-inventory.latest.json",
    packetId: "r1060-local-true-wearable-source-inventory",
    schemaVersion: "murph-age-r1060-local-true-wearable-source-inventory.v1",
  },
  r1088: {
    artifact: "r1088-consumer-input-priority-state.latest.json",
    packetId: "r1088-consumer-input-priority-state",
    schemaVersion: "murph-age-r1088-consumer-input-priority-state.v1",
  },
  r1089: {
    artifact: "r1089-labs-wearables-candidate-batch-manifest.latest.json",
    packetId: "r1089-labs-wearables-candidate-batch-manifest",
    schemaVersion: "murph-age-r1089-labs-wearables-candidate-batch-manifest.v1",
  },
} as const;

type InputKey = keyof typeof INPUTS;
type FeatureDomain =
  | "activity_fitness"
  | "body_composition_vitals"
  | "bloodwork"
  | "function_mobility"
  | "sleep_recovery"
  | "wearable_quality";
type EvidenceStatus =
  | "blocked_until_true_wearable_outcome_aggregate"
  | "control_limited_shadow"
  | "mixed_shadow"
  | "negative_control_required"
  | "supporting_context_only";
type ExecutableStatus =
  | "blocked_no_true_wearable_receipt"
  | "queued_shadow_candidate"
  | "ready_quality_control"
  | "supporting_not_primary";
type UserSubmitFit = "high" | "medium";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface FeatureRegistryEntry {
  attributionReadiness:
    | "blocked_until_calibration_and_external_validation"
    | "benchmark_side_decomposition_only"
    | "quality_control_only";
  collectionMethod:
    | "blood_panel_or_lab_upload"
    | "device_or_manual_vital"
    | "fitness_or_activity_device"
    | "mobility_or_survey_context"
    | "sleep_or_recovery_device";
  domain: FeatureDomain;
  evidenceStatus: EvidenceStatus;
  executableStatus: ExecutableStatus;
  featureFamilyId:
    | "activity_steps_minutes"
    | "blood_pressure_vitals"
    | "body_composition"
    | "function_mobility_context"
    | "glycemia_hba1c_glucose"
    | "lipids_triglycerides_cholesterol"
    | "missingness_coverage_quality"
    | "resting_hr_recovery"
    | "sleep_duration_regularity"
    | "wearable_hrv_quality_gated";
  leakageRisk: "low" | "medium";
  modelUse:
    | "current_p0_shadow_lane"
    | "current_quality_control"
    | "future_true_wearable_lane"
    | "supporting_context_not_primary";
  requiredControl:
    | "coverage_quality_and_shuffled_wearable_controls"
    | "missingness_quality_control"
    | "same_denominator_negative_controls"
    | "source_specific_missingness_control";
  userSubmitFit: UserSubmitFit;
}

export interface R1090ConsumerFeatureRegistryStateOptions {
  createdAt?: string;
  outputDir?: string;
  r1047Path?: string;
  r1050Path?: string;
  r1051Path?: string;
  r1060Path?: string;
  r1088Path?: string;
  r1089Path?: string;
}

export interface R1090ConsumerFeatureRegistryStateOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1090: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  featureRegistry: {
    registryScope: "consumer_submittable_16_50_research_registry_v0";
    entries: FeatureRegistryEntry[];
  };
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  packetId: "r1090-consumer-feature-registry-state";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1090_CONSUMER_FEATURE_REGISTRY_STATE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    currentExecutableShadowFamilies: string[];
    featureRegistryEntryCount: number;
    nextLocalAction: "use_registry_to_drive_labs_wearables_shadow_batch";
    productDisplayAuthorized: false;
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1090: false;
    trueWearableFamiliesBlocked: string[];
  };
}

export async function runR1090ConsumerFeatureRegistryState(
  options: R1090ConsumerFeatureRegistryStateOptions = {},
): Promise<{ output: R1090ConsumerFeatureRegistryStateOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const entries = buildRegistryEntries(inputs);
  const output: R1090ConsumerFeatureRegistryStateOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      participantIdentifiersStored: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR1090: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceVariableNamesStored: false,
      splitMembershipStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    featureRegistry: {
      entries,
      registryScope: "consumer_submittable_16_50_research_registry_v0",
    },
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1090-consumer-feature-registry-state",
    productDisplayAuthorized: false,
    schemaVersion: R1090_CONSUMER_FEATURE_REGISTRY_STATE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      currentExecutableShadowFamilies: entries
        .filter((entry) => entry.executableStatus === "queued_shadow_candidate")
        .map((entry) => entry.featureFamilyId),
      featureRegistryEntryCount: entries.length,
      nextLocalAction: "use_registry_to_drive_labs_wearables_shadow_batch",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1090: false,
      trueWearableFamiliesBlocked: entries
        .filter((entry) => entry.executableStatus === "blocked_no_true_wearable_receipt")
        .map((entry) => entry.featureFamilyId),
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1090 consumer feature registry state failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(options: R1090ConsumerFeatureRegistryStateOptions): Promise<Record<InputKey, unknown | null>> {
  return {
    r1047: await readJsonIfPresent(options.r1047Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1047.artifact)),
    r1050: await readJsonIfPresent(options.r1050Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1050.artifact)),
    r1051: await readJsonIfPresent(options.r1051Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1051.artifact)),
    r1060: await readJsonIfPresent(options.r1060Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1060.artifact)),
    r1088: await readJsonIfPresent(options.r1088Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1088.artifact)),
    r1089: await readJsonIfPresent(options.r1089Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1089.artifact)),
  };
}

function buildRegistryEntries(inputs: Record<InputKey, unknown | null>): FeatureRegistryEntry[] {
  const labEvidence = readStringAt(inputs.r1047, ["candidateFamilies", "bloodwork", "glucoseHba1c", "status"])
    === "active_research_candidate_mixed_external_support";
  const pulseEvidence = readStringAt(inputs.r1050, ["decision", "conclusion"])
    === "pulse_rhr_shadow_signal_mixed_control_limited";
  const trueWearableReceiptMissing = readStringAt(inputs.r1051, ["reduction", "conclusion"])
    === "awaiting_partner_or_workbench_aggregate_receipt";
  const localWearableCandidateExists = readStringAt(inputs.r1060, ["summary", "conclusion"])
    === "possible_local_wearable_files_need_outcome_join";
  const batchReady = readStringAt(inputs.r1089, ["summary", "conclusion"]) === "labs_wearables_batch_ready";

  return [
    {
      attributionReadiness: "benchmark_side_decomposition_only",
      collectionMethod: "blood_panel_or_lab_upload",
      domain: "bloodwork",
      evidenceStatus: labEvidence ? "mixed_shadow" : "control_limited_shadow",
      executableStatus: batchReady ? "queued_shadow_candidate" : "supporting_not_primary",
      featureFamilyId: "glycemia_hba1c_glucose",
      leakageRisk: "low",
      modelUse: "current_p0_shadow_lane",
      requiredControl: "same_denominator_negative_controls",
      userSubmitFit: "high",
    },
    {
      attributionReadiness: "benchmark_side_decomposition_only",
      collectionMethod: "blood_panel_or_lab_upload",
      domain: "bloodwork",
      evidenceStatus: "mixed_shadow",
      executableStatus: batchReady ? "queued_shadow_candidate" : "supporting_not_primary",
      featureFamilyId: "lipids_triglycerides_cholesterol",
      leakageRisk: "low",
      modelUse: "current_p0_shadow_lane",
      requiredControl: "same_denominator_negative_controls",
      userSubmitFit: "high",
    },
    {
      attributionReadiness: "benchmark_side_decomposition_only",
      collectionMethod: "device_or_manual_vital",
      domain: "body_composition_vitals",
      evidenceStatus: "mixed_shadow",
      executableStatus: batchReady ? "queued_shadow_candidate" : "supporting_not_primary",
      featureFamilyId: "blood_pressure_vitals",
      leakageRisk: "low",
      modelUse: "current_p0_shadow_lane",
      requiredControl: "same_denominator_negative_controls",
      userSubmitFit: "high",
    },
    {
      attributionReadiness: "benchmark_side_decomposition_only",
      collectionMethod: "device_or_manual_vital",
      domain: "body_composition_vitals",
      evidenceStatus: "mixed_shadow",
      executableStatus: batchReady ? "queued_shadow_candidate" : "supporting_not_primary",
      featureFamilyId: "body_composition",
      leakageRisk: "low",
      modelUse: "current_p0_shadow_lane",
      requiredControl: "same_denominator_negative_controls",
      userSubmitFit: "high",
    },
    {
      attributionReadiness: "blocked_until_calibration_and_external_validation",
      collectionMethod: "fitness_or_activity_device",
      domain: "activity_fitness",
      evidenceStatus: trueWearableReceiptMissing ? "blocked_until_true_wearable_outcome_aggregate" : "control_limited_shadow",
      executableStatus: "blocked_no_true_wearable_receipt",
      featureFamilyId: "activity_steps_minutes",
      leakageRisk: "medium",
      modelUse: localWearableCandidateExists ? "future_true_wearable_lane" : "future_true_wearable_lane",
      requiredControl: "coverage_quality_and_shuffled_wearable_controls",
      userSubmitFit: "high",
    },
    {
      attributionReadiness: "blocked_until_calibration_and_external_validation",
      collectionMethod: "sleep_or_recovery_device",
      domain: "sleep_recovery",
      evidenceStatus: "blocked_until_true_wearable_outcome_aggregate",
      executableStatus: "blocked_no_true_wearable_receipt",
      featureFamilyId: "sleep_duration_regularity",
      leakageRisk: "medium",
      modelUse: "future_true_wearable_lane",
      requiredControl: "coverage_quality_and_shuffled_wearable_controls",
      userSubmitFit: "high",
    },
    {
      attributionReadiness: "blocked_until_calibration_and_external_validation",
      collectionMethod: "sleep_or_recovery_device",
      domain: "sleep_recovery",
      evidenceStatus: pulseEvidence ? "control_limited_shadow" : "blocked_until_true_wearable_outcome_aggregate",
      executableStatus: "blocked_no_true_wearable_receipt",
      featureFamilyId: "resting_hr_recovery",
      leakageRisk: "medium",
      modelUse: "future_true_wearable_lane",
      requiredControl: "coverage_quality_and_shuffled_wearable_controls",
      userSubmitFit: "high",
    },
    {
      attributionReadiness: "blocked_until_calibration_and_external_validation",
      collectionMethod: "sleep_or_recovery_device",
      domain: "sleep_recovery",
      evidenceStatus: "blocked_until_true_wearable_outcome_aggregate",
      executableStatus: "blocked_no_true_wearable_receipt",
      featureFamilyId: "wearable_hrv_quality_gated",
      leakageRisk: "medium",
      modelUse: "future_true_wearable_lane",
      requiredControl: "coverage_quality_and_shuffled_wearable_controls",
      userSubmitFit: "high",
    },
    {
      attributionReadiness: "quality_control_only",
      collectionMethod: "fitness_or_activity_device",
      domain: "wearable_quality",
      evidenceStatus: "negative_control_required",
      executableStatus: "ready_quality_control",
      featureFamilyId: "missingness_coverage_quality",
      leakageRisk: "medium",
      modelUse: "current_quality_control",
      requiredControl: "missingness_quality_control",
      userSubmitFit: "medium",
    },
    {
      attributionReadiness: "benchmark_side_decomposition_only",
      collectionMethod: "mobility_or_survey_context",
      domain: "function_mobility",
      evidenceStatus: "supporting_context_only",
      executableStatus: "supporting_not_primary",
      featureFamilyId: "function_mobility_context",
      leakageRisk: "low",
      modelUse: "supporting_context_not_primary",
      requiredControl: "source_specific_missingness_control",
      userSubmitFit: "medium",
    },
  ];
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1090 rejected unsafe ${key} input: ${findings.join("; ")}`);
    }
  }
}

function summarizeInputs(inputs: Record<InputKey, unknown | null>): Record<InputKey, ArtifactSummary> {
  return Object.fromEntries(
    (Object.keys(INPUTS) as InputKey[]).map((key) => [key, summarizeInput(INPUTS[key].artifact, inputs[key])]),
  ) as Record<InputKey, ArtifactSummary>;
}

function summarizeInput(artifact: string, value: unknown | null): ArtifactSummary {
  return {
    artifact,
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
  runR1090ConsumerFeatureRegistryState()
    .then(({ output }) => {
      process.stdout.write(`${JSON.stringify({
        currentExecutableShadowFamilies: output.summary.currentExecutableShadowFamilies,
        featureRegistryEntryCount: output.summary.featureRegistryEntryCount,
        nextLocalAction: output.summary.nextLocalAction,
        packetId: output.packetId,
        productDisplayAuthorized: output.productDisplayAuthorized,
        rowParsingPerformedByR1090: output.summary.rowParsingPerformedByR1090,
        schemaVersion: output.schemaVersion,
        status: output.status,
        trueWearableFamiliesBlocked: output.summary.trueWearableFamiliesBlocked,
      }, null, 2)}\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : "R1090 consumer feature registry state failed."}\n`);
      process.exitCode = 1;
    });
}
