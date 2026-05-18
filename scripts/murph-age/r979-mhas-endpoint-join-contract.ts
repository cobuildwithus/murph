import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R979_MHAS_ENDPOINT_JOIN_CONTRACT_SCHEMA_VERSION =
  "murph-age-r979-mhas-endpoint-join-contract.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r979-mhas-endpoint-join-contract.latest.json";

type ArtifactKey =
  | "mhasJoinProbe"
  | "r611MetadataSourceIntake"
  | "r614MhasSourceRightsActivationLabels"
  | "r615CrossSourceActivationMatrix"
  | "r978FastLoopPriorityReducer";
type ArtifactStatus = "available" | "missing";

const INPUT_ARTIFACT_METADATA: Record<ArtifactKey, {
  artifact: string;
  packetIds: readonly string[];
  schemaVersions: readonly string[];
}> = {
  mhasJoinProbe: {
    artifact: "mhas-join-probe.latest.json",
    packetIds: ["mhas-harmonized-eol-aggregate-join-probe"],
    schemaVersions: ["murph-age-mhas-join-probe.v1"],
  },
  r611MetadataSourceIntake: {
    artifact: "r611-mhas-metadata-source-intake.latest.json",
    packetIds: ["r611-mhas-metadata-source-intake"],
    schemaVersions: ["murph-age-r611-mhas-metadata-source-intake.v1"],
  },
  r614MhasSourceRightsActivationLabels: {
    artifact: "r614-mhas-source-rights-activation-labels.latest.json",
    packetIds: ["r614-mhas-source-rights-activation-labels"],
    schemaVersions: ["murph-age-r614-mhas-source-rights-activation-labels.v1"],
  },
  r615CrossSourceActivationMatrix: {
    artifact: "r615-cross-source-activation-matrix.latest.json",
    packetIds: ["r615-cross-source-activation-matrix"],
    schemaVersions: ["murph-age-r615-cross-source-activation-matrix.v1"],
  },
  r978FastLoopPriorityReducer: {
    artifact: "r978-fast-loop-priority-reducer.latest.json",
    packetIds: ["r978-fast-loop-priority-reducer"],
    schemaVersions: ["murph-age-r978-fast-loop-priority-reducer.v1"],
  },
};

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: ArtifactStatus;
}

interface PrerequisiteSummary {
  blockerReasons: string[];
  joinProbeReady: boolean;
  metadataIntakeReady: boolean;
  priorityQueueReady: boolean;
  sourceActivationReady: boolean;
  sourceMatrixReady: boolean;
  status: "ready" | "blocked";
}

export interface R979MhasEndpointJoinContractOptions {
  createdAt?: string;
  mhasJoinProbePath?: string;
  outputDir?: string;
  r611Path?: string;
  r614MhasPath?: string;
  r615Path?: string;
  r978Path?: string;
}

export interface R979MhasEndpointJoinContractOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookProseStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    joinKeyValuesStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    modelScoringPerformed: false;
    outcomeScoringPerformed: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    rowParsingPerformed: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
    variableLabelsStored: false;
    variableNamesStored: false;
  };
  benchmarkContract: {
    abstentionCriteria: string[];
    allowedArtifactBoundary: string[];
    allowedMetricFamilies: string[];
    benchmarkCardStatus: "locked_no_execution" | "blocked_missing_prerequisites";
    endpointFamily: "mortality_or_followup";
    evidenceClass: "non_us_external_function_disability_diagnostic";
    exposureLabel: "diagnostic-only";
    minimumCellThreshold: 11;
    productPromotionAuthorized: false;
  };
  createdAt: string;
  denominatorPolicy: {
    candidateComparisonPolicy: "same_denominator_age_sex_vs_function_disability";
    denominatorId: "mhas-function-disability-followup-v0";
    missingnessPolicy: "abstain_missing_endpoint_age_sex_or_function_composite";
    surveyWeightPolicy: "unweighted_primary_diagnostic_weighted_sensitivity_deferred";
  };
  endpointJoinContract: {
    endpointStatusPolicy: "mortality_or_eol_status_role_family";
    exactDatePolicy: "local_only_not_exported";
    joinResolutionPolicy: "role_family_contract_only_no_key_names";
    keyValuesExported: false;
    sourceRoleFamilies: Array<
      | "baseline_harmonized_panel"
      | "gateway_eol_endpoint"
      | "follow_up_status_bridge"
      | "raw_wave_follow_up_sections"
    >;
    timeOriginPolicy: "baseline_interview_or_wave_role_family";
    variableNamesExported: false;
  };
  featureContract: {
    blockedFamilies: string[];
    candidateFeatureFamily: "function_limitation_disability_v1";
    referenceFeatureFamily: "age_sex_reference";
  };
  gates: {
    blockedActions: string[];
    nextRunnableAction:
      | "build_mhas_function_disability_aggregate_reducer"
      | "repair_mhas_endpoint_join_prerequisites";
    nextReducerRowParsingAuthorized: boolean;
    outcomeScoringAuthorizedForNextReducer: boolean;
    productDisplayAuthorized: false;
    scope: "mhas_function_disability_aggregate_reducer_only";
  };
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  packetId: "r979-mhas-endpoint-join-contract";
  prerequisites: PrerequisiteSummary;
  schemaVersion: typeof R979_MHAS_ENDPOINT_JOIN_CONTRACT_SCHEMA_VERSION;
  splitCalibrationPolicy: {
    calibrationPolicy: "train_fit_calibration_only_then_holdout_report";
    splitMembershipExported: false;
    splitPolicy: "deterministic_hash_split_no_endpoint_or_score_input";
    testSelectionAuthorized: false;
  };
  status: "research-local-aggregate-only";
  summary: {
    conclusion: "mhas_endpoint_join_contract_locked_next_reducer_ready" | "mhas_endpoint_join_contract_blocked";
    nextLoopId: "mhas-function-disability-fast-loop" | null;
    nextReducerRowParsingAuthorized: boolean;
    productDisplayAuthorized: false;
    rowParsingPerformed: false;
  };
}

export async function runR979MhasEndpointJoinContract(
  options: R979MhasEndpointJoinContractOptions = {},
): Promise<{ output: R979MhasEndpointJoinContractOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const inputArtifacts = summarizeInputs(inputs);
  const prerequisites = summarizePrerequisites(inputs, inputArtifacts);
  const ready = prerequisites.status === "ready";

  const output: R979MhasEndpointJoinContractOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookProseStored: false,
      codebookTextStored: false,
      coefficientsStored: false,
      joinKeyValuesStored: false,
      localFileNamesStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      modelScoringPerformed: false,
      outcomeScoringPerformed: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      rowParsingPerformed: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableNamesStored: false,
    },
    benchmarkContract: {
      abstentionCriteria: [
        "missing_endpoint_status_role_family",
        "missing_baseline_age_or_sex_role_family",
        "missing_function_disability_composite",
        "same_denominator_cell_below_minimum_threshold",
      ],
      allowedArtifactBoundary: [
        "aggregate_counts",
        "aggregate_metrics",
        "same_denominator_deltas",
        "suppression_verdicts",
        "benchmark_metadata",
      ],
      allowedMetricFamilies: [
        "auc",
        "brier",
        "log_loss",
        "mean_prediction",
        "observed_rate",
        "calibration_summary",
        "negative_control_shuffle_summary",
      ],
      benchmarkCardStatus: ready ? "locked_no_execution" : "blocked_missing_prerequisites",
      endpointFamily: "mortality_or_followup",
      evidenceClass: "non_us_external_function_disability_diagnostic",
      exposureLabel: "diagnostic-only",
      minimumCellThreshold: 11,
      productPromotionAuthorized: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    denominatorPolicy: {
      candidateComparisonPolicy: "same_denominator_age_sex_vs_function_disability",
      denominatorId: "mhas-function-disability-followup-v0",
      missingnessPolicy: "abstain_missing_endpoint_age_sex_or_function_composite",
      surveyWeightPolicy: "unweighted_primary_diagnostic_weighted_sensitivity_deferred",
    },
    endpointJoinContract: {
      endpointStatusPolicy: "mortality_or_eol_status_role_family",
      exactDatePolicy: "local_only_not_exported",
      joinResolutionPolicy: "role_family_contract_only_no_key_names",
      keyValuesExported: false,
      sourceRoleFamilies: [
        "baseline_harmonized_panel",
        "gateway_eol_endpoint",
        "follow_up_status_bridge",
        "raw_wave_follow_up_sections",
      ],
      timeOriginPolicy: "baseline_interview_or_wave_role_family",
      variableNamesExported: false,
    },
    featureContract: {
      blockedFamilies: [
        "activity_or_wearable_proxy",
        "cognition_additive",
        "biomarker_increment",
        "protocol_or_recommendation_features",
        "crp_or_hscrp",
      ],
      candidateFeatureFamily: "function_limitation_disability_v1",
      referenceFeatureFamily: "age_sex_reference",
    },
    gates: {
      blockedActions: ready
        ? [
            "product_claims",
            "website_or_sidebar_display",
            "recommendation_claims",
            "row_level_export",
            "coefficient_or_model_parameter_export",
            "same_result_promotion_without_external_review",
          ]
        : prerequisites.blockerReasons,
      nextRunnableAction: ready
        ? "build_mhas_function_disability_aggregate_reducer"
        : "repair_mhas_endpoint_join_prerequisites",
      nextReducerRowParsingAuthorized: ready,
      outcomeScoringAuthorizedForNextReducer: ready,
      productDisplayAuthorized: false,
      scope: "mhas_function_disability_aggregate_reducer_only",
    },
    inputArtifacts,
    packetId: "r979-mhas-endpoint-join-contract",
    prerequisites,
    schemaVersion: R979_MHAS_ENDPOINT_JOIN_CONTRACT_SCHEMA_VERSION,
    splitCalibrationPolicy: {
      calibrationPolicy: "train_fit_calibration_only_then_holdout_report",
      splitMembershipExported: false,
      splitPolicy: "deterministic_hash_split_no_endpoint_or_score_input",
      testSelectionAuthorized: false,
    },
    status: "research-local-aggregate-only",
    summary: {
      conclusion: ready
        ? "mhas_endpoint_join_contract_locked_next_reducer_ready"
        : "mhas_endpoint_join_contract_blocked",
      nextLoopId: ready ? "mhas-function-disability-fast-loop" : null,
      nextReducerRowParsingAuthorized: ready,
      productDisplayAuthorized: false,
      rowParsingPerformed: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R979 MHAS endpoint/join contract failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(
  options: R979MhasEndpointJoinContractOptions,
): Promise<Record<ArtifactKey, unknown | null>> {
  return {
    mhasJoinProbe: await readJsonIfPresent(
      options.mhasJoinProbePath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "mhas-join-probe.latest.json"),
    ),
    r611MetadataSourceIntake: await readJsonIfPresent(
      options.r611Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r611-mhas-metadata-source-intake.latest.json"),
    ),
    r614MhasSourceRightsActivationLabels: await readJsonIfPresent(
      options.r614MhasPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r614-mhas-source-rights-activation-labels.latest.json"),
    ),
    r615CrossSourceActivationMatrix: await readJsonIfPresent(
      options.r615Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r615-cross-source-activation-matrix.latest.json"),
    ),
    r978FastLoopPriorityReducer: await readJsonIfPresent(
      options.r978Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r978-fast-loop-priority-reducer.latest.json"),
    ),
  };
}

function summarizeInputs(inputs: Record<ArtifactKey, unknown | null>): Record<ArtifactKey, ArtifactSummary> {
  return {
    mhasJoinProbe: summarizeArtifact("mhasJoinProbe", inputs.mhasJoinProbe),
    r611MetadataSourceIntake: summarizeArtifact("r611MetadataSourceIntake", inputs.r611MetadataSourceIntake),
    r614MhasSourceRightsActivationLabels: summarizeArtifact(
      "r614MhasSourceRightsActivationLabels",
      inputs.r614MhasSourceRightsActivationLabels,
    ),
    r615CrossSourceActivationMatrix: summarizeArtifact(
      "r615CrossSourceActivationMatrix",
      inputs.r615CrossSourceActivationMatrix,
    ),
    r978FastLoopPriorityReducer: summarizeArtifact("r978FastLoopPriorityReducer", inputs.r978FastLoopPriorityReducer),
  };
}

function summarizeArtifact(key: ArtifactKey, value: unknown | null): ArtifactSummary {
  const metadata = INPUT_ARTIFACT_METADATA[key];
  if (!value) return { artifact: metadata.artifact, packetId: null, schemaVersion: null, status: "missing" };
  const root = requiredRecord(value, metadata.artifact);
  const packetId = optionalString(root.packetId);
  const schemaVersion = optionalString(root.schemaVersion) ?? optionalString(root.schema_version);
  return {
    artifact: metadata.artifact,
    packetId: packetId && metadata.packetIds.includes(packetId) ? packetId : null,
    schemaVersion: schemaVersion && metadata.schemaVersions.includes(schemaVersion) ? schemaVersion : null,
    status: "available",
  };
}

function summarizePrerequisites(
  inputs: Record<ArtifactKey, unknown | null>,
  artifacts: Record<ArtifactKey, ArtifactSummary>,
): PrerequisiteSummary {
  const blockerReasons: string[] = [];
  for (const [key, artifact] of Object.entries(artifacts)) {
    if (artifact.status !== "available") blockerReasons.push(`${key}_missing`);
    if (artifact.status === "available" && !artifact.packetId) blockerReasons.push(`${key}_packet_mismatch`);
    if (artifact.status === "available" && !artifact.schemaVersion) blockerReasons.push(`${key}_schema_mismatch`);
  }

  const joinProbeReady = readBooleanAt(inputs.mhasJoinProbe, ["joinFeasibility", "readyForLockedJoinContract"]) === true
    && readStringAt(inputs.mhasJoinProbe, ["endpointEolMetadataStatus", "status"]) === "endpoint_metadata_ready_for_contract";
  if (!joinProbeReady) blockerReasons.push("mhas_join_probe_not_ready");

  const metadataIntakeReady = readBooleanAt(inputs.r611MetadataSourceIntake, ["summary", "metadataIntakeCompleted"]) === true;
  if (!metadataIntakeReady) blockerReasons.push("mhas_metadata_intake_not_ready");

  const sourceActivationReady =
    readBooleanAt(inputs.r614MhasSourceRightsActivationLabels, ["summary", "endpointJoinContractReady"]) === true
    && readBooleanAt(inputs.r614MhasSourceRightsActivationLabels, ["summary", "sourceRightsLabelsComplete"]) === true
    && readStringAt(inputs.r614MhasSourceRightsActivationLabels, ["gates", "nextGate"]) === "draft_locked_mhas_endpoint_join_contract";
  if (!sourceActivationReady) blockerReasons.push("mhas_source_activation_not_ready");

  const sourceMatrixReady =
    readStringAt(inputs.r615CrossSourceActivationMatrix, ["summary", "nextPrimaryLocalAction"])
      === "draft_locked_mhas_endpoint_join_contract";
  if (!sourceMatrixReady) blockerReasons.push("mhas_not_primary_source_matrix_action");

  const priorityQueueReady =
    readStringAt(inputs.r978FastLoopPriorityReducer, ["summary", "nextDataSource"]) === "MHAS"
    && readStringAt(inputs.r978FastLoopPriorityReducer, ["summary", "nextLoopId"]) === "mhas-function-disability-fast-loop";
  if (!priorityQueueReady) blockerReasons.push("mhas_not_priority_fast_loop");

  return {
    blockerReasons: dedupeLabels(blockerReasons),
    joinProbeReady,
    metadataIntakeReady,
    priorityQueueReady,
    sourceActivationReady,
    sourceMatrixReady,
    status: blockerReasons.length === 0 ? "ready" : "blocked",
  };
}

function validateInputBoundaries(inputs: Record<ArtifactKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) continue;
    const root = requiredRecord(value, `${key} input`);
    const boundary = root.boundary ?? root.artifactBoundary;
    if (boundary !== undefined) assertBoundaryFlags(boundary, `${key} boundary`);
  }
}

function assertBoundaryFlags(value: unknown, label: string): void {
  const boundary = requiredRecord(value, label);
  for (const key of [
    "codebookProseStored",
    "codebookTextStored",
    "coefficientsStored",
    "joinKeyValuesStored",
    "localFileNamesStored",
    "localPathsStored",
    "modelParametersStored",
    "modelScoringPerformed",
    "modelScoringPerformedByR615",
    "outcomeScoringPerformed",
    "outcomeScoringPerformedByR615",
    "participantIdentifiersStored",
    "participantIdentifiersWritten",
    "predictionsStored",
    "productClaimsIncluded",
    "productDisplayAuthorized",
    "productPromotionAuthorized",
    "protocolClaimsIncluded",
    "recommendationClaimsIncluded",
    "rowParsingPerformed",
    "rowParsingPerformedByR615",
    "rowValuesStored",
    "smallCellsStored",
    "sourceBodiesStored",
    "splitIdentifiersStored",
    "splitMembershipStored",
    "variableLabelsStored",
    "variableNamesStored",
    "variableNameSamplesStored",
  ]) {
    if (boundary[key] !== undefined && boundary[key] !== false) {
      throw new Error(`${label} flag ${key} must be false.`);
    }
  }
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") return null;
    throw new Error("Failed to read an aggregate MHAS contract input artifact.");
  }
}

function readBooleanAt(value: unknown, pathParts: readonly string[]): boolean | null {
  const valueAtPath = readAtPath(value, pathParts);
  return typeof valueAtPath === "boolean" ? valueAtPath : null;
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const valueAtPath = readAtPath(value, pathParts);
  return typeof valueAtPath === "string" && valueAtPath.length > 0 ? valueAtPath : null;
}

function readAtPath(value: unknown, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    const record = optionalRecord(current);
    if (!record) return null;
    current = record[part];
  }
  return current;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  const record = optionalRecord(value);
  if (!record) throw new Error(`${label} must be an object.`);
  return record;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function dedupeLabels(labels: string[]): string[] {
  return [...new Set(labels.filter((label) => label.length > 0))];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR979MhasEndpointJoinContract({
    mhasJoinProbePath: process.env.MURPH_AGE_MHAS_JOIN_PROBE_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r611Path: process.env.MURPH_AGE_R611_MHAS_SOURCE_INTAKE_PATH,
    r614MhasPath: process.env.MURPH_AGE_R614_MHAS_LABELS_PATH,
    r615Path: process.env.MURPH_AGE_R615_ACTIVATION_MATRIX_PATH,
    r978Path: process.env.MURPH_AGE_R978_FAST_LOOP_PRIORITY_PATH,
  }).then(({ output, outputPath }) => {
    const summary = {
      artifact: path.basename(outputPath),
      conclusion: output.summary.conclusion,
      nextLoopId: output.summary.nextLoopId,
      nextReducerRowParsingAuthorized: output.summary.nextReducerRowParsingAuthorized,
      packetId: output.packetId,
      productDisplayAuthorized: output.summary.productDisplayAuthorized,
      rowParsingPerformed: output.summary.rowParsingPerformed,
      schemaVersion: output.schemaVersion,
      status: output.status,
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "R979 MHAS endpoint/join contract failed.");
    process.exitCode = 1;
  });
}
