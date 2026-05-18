import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R615_CROSS_SOURCE_ACTIVATION_MATRIX_SCHEMA_VERSION =
  "murph-age-r615-cross-source-activation-matrix.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_SOURCE_INTAKE_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "source-intake",
);
const OUTPUT_FILE_NAME = "r615-cross-source-activation-matrix.latest.json";

type ArtifactKey =
  | "crelesLocalBenchmark"
  | "haalsiSourceFeasibility"
  | "midus2LocalBenchmark"
  | "r612NhanesLayeringMap"
  | "r614MhasSourceRightsActivationLabels"
  | "r614NshapActivationLabels"
  | "sageSouthAfricaHeaderPreflight";
type ArtifactStatus = "available" | "missing";
type ActivationTier =
  | "ready_for_aggregate_benchmark_completed"
  | "endpoint_contract_ready_no_scoring"
  | "metadata_only"
  | "rights_blocked"
  | "outcome_blocked"
  | "same_family_internal_only"
  | "missing_artifact";
type LabelStatus = "green" | "yellow" | "red" | "missing" | "not_applicable";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: ArtifactStatus;
}

export interface R615CrossSourceActivationMatrixOptions {
  createdAt?: string;
  crelesLocalBenchmarkPath?: string;
  haalsiSourceFeasibilityPath?: string;
  midus2LocalBenchmarkPath?: string;
  outputDir?: string;
  r612NhanesLayeringMapPath?: string;
  r614MhasSourceRightsActivationLabelsPath?: string;
  r614NshapActivationLabelsPath?: string;
  sageSouthAfricaHeaderPreflightPath?: string;
}

interface SourceActivationRow {
  activationTier: ActivationTier;
  aggregateOutputLabel: LabelStatus;
  allowedNextLocalActions: string[];
  blockedNextActions: string[];
  calibrationValueLabel: "high" | "medium" | "low" | "same_family_only" | "unknown";
  candidateDomainLabels: {
    cognitionOrContext: LabelStatus;
    functionOrDisability: LabelStatus;
    hardOutcome: LabelStatus;
    labBpBody: LabelStatus;
    wearableOrActivity: LabelStatus;
  };
  evidenceClass:
    | "non_nhanes_transport_diagnostic"
    | "non_us_external_candidate"
    | "same_family_internal"
    | "metadata_transport_candidate"
    | "context_only_candidate";
  joinOrWaveLabel: LabelStatus;
  modelScoringAlreadyPerformed: boolean;
  rowExecutionUnlocked: false;
  sourceFamily: "CRELES" | "HAALSI" | "MHAS" | "MIDUS" | "NHANES" | "NSHAP" | "SAGE";
  sourceRightsLabel: LabelStatus;
}

export interface R615CrossSourceActivationMatrixOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookProseStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    modelScoringPerformedByR615: false;
    outcomeScoringPerformedByR615: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    protocolClaimsIncluded: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR615: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitIdentifiersStored: false;
    splitMembershipStored: false;
    variableLabelsStored: false;
    variableNamesStored: false;
    variableNameSamplesStored: false;
  };
  createdAt: string;
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  nextBatch: Array<{
    actionId: string;
    reason: string;
    reviewGptRole: "none_local_grunt_work" | "aggregate_result_or_strategy_review";
    sourceFamily: SourceActivationRow["sourceFamily"] | "cross_source";
  }>;
  packetId: "r615-cross-source-activation-matrix";
  reviewGptOperatingRule: {
    codexRunsWithoutMicroApproval: string[];
    reviewGptOnlyFor: string[];
  };
  schemaVersion: typeof R615_CROSS_SOURCE_ACTIVATION_MATRIX_SCHEMA_VERSION;
  sourceRows: SourceActivationRow[];
  status: "research-local-aggregate-only";
  summary: {
    conclusion: "cross_source_activation_matrix_ready";
    immediateExecutableAggregateBenchmarkCountBand: string;
    modelPromotionAuthorized: false;
    nextPrimaryLocalAction: string;
    productDisplayAuthorized: false;
    scoreBearingSourceCountBand: string;
  };
}

export async function runR615CrossSourceActivationMatrix(
  options: R615CrossSourceActivationMatrixOptions = {},
): Promise<{ output: R615CrossSourceActivationMatrixOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const inputArtifacts = summarizeInputs(inputs);
  const sourceRows = [
    summarizeMhas(inputs.r614MhasSourceRightsActivationLabels),
    summarizeCreles(inputs.crelesLocalBenchmark),
    summarizeMidus(inputs.midus2LocalBenchmark),
    summarizeNshap(inputs.r614NshapActivationLabels),
    summarizeHaalsi(inputs.haalsiSourceFeasibility),
    summarizeSage(inputs.sageSouthAfricaHeaderPreflight),
    summarizeNhanes(inputs.r612NhanesLayeringMap),
  ];
  const nextBatch = buildNextBatch(sourceRows);
  const scoreBearingCount = sourceRows.filter((row) => row.modelScoringAlreadyPerformed).length;
  const immediateBenchmarkCount = sourceRows.filter((row) =>
    row.activationTier === "ready_for_aggregate_benchmark_completed"
    || row.activationTier === "endpoint_contract_ready_no_scoring"
  ).length;

  const output: R615CrossSourceActivationMatrixOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookProseStored: false,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      modelScoringPerformedByR615: false,
      outcomeScoringPerformedByR615: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      protocolClaimsIncluded: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR615: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitIdentifiersStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableNamesStored: false,
      variableNameSamplesStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts,
    nextBatch,
    packetId: "r615-cross-source-activation-matrix",
    reviewGptOperatingRule: {
      codexRunsWithoutMicroApproval: [
        "metadata intake",
        "source-rights label reducers",
        "join and endpoint contract scaffolds",
        "aggregate-only benchmark scripts",
        "suppression and artifact-boundary validators",
      ],
      reviewGptOnlyFor: [
        "new source priority strategy",
        "aggregate result interpretation",
        "major model-family changes",
        "product or promotion boundary decisions",
      ],
    },
    schemaVersion: R615_CROSS_SOURCE_ACTIVATION_MATRIX_SCHEMA_VERSION,
    sourceRows,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "cross_source_activation_matrix_ready",
      immediateExecutableAggregateBenchmarkCountBand: countBand(immediateBenchmarkCount),
      modelPromotionAuthorized: false,
      nextPrimaryLocalAction: nextBatch[0]?.actionId ?? "refresh_source_artifacts",
      productDisplayAuthorized: false,
      scoreBearingSourceCountBand: countBand(scoreBearingCount),
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R615 cross-source activation matrix failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(
  options: R615CrossSourceActivationMatrixOptions,
): Promise<Record<ArtifactKey, unknown | null>> {
  return {
    crelesLocalBenchmark: await readJsonIfPresent(
      options.crelesLocalBenchmarkPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "creles-local-benchmark.latest.json"),
    ),
    haalsiSourceFeasibility: await readJsonIfPresent(
      options.haalsiSourceFeasibilityPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "haalsi-source-feasibility.latest.json"),
    ),
    midus2LocalBenchmark: await readJsonIfPresent(
      options.midus2LocalBenchmarkPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "midus2-local-benchmark.latest.json"),
    ),
    r612NhanesLayeringMap: await readJsonIfPresent(
      options.r612NhanesLayeringMapPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r612-nhanes-layering-map.latest.json"),
    ),
    r614MhasSourceRightsActivationLabels: await readJsonIfPresent(
      options.r614MhasSourceRightsActivationLabelsPath
        ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r614-mhas-source-rights-activation-labels.latest.json"),
    ),
    r614NshapActivationLabels: await readJsonIfPresent(
      options.r614NshapActivationLabelsPath
        ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r614-nshap-activation-labels.latest.json"),
    ),
    sageSouthAfricaHeaderPreflight: await readJsonIfPresent(
      options.sageSouthAfricaHeaderPreflightPath
        ?? path.join(DEFAULT_SOURCE_INTAKE_DIR, "sage-south-africa-header-preflight.latest.json"),
    ),
  };
}

function summarizeInputs(inputs: Record<ArtifactKey, unknown | null>): Record<ArtifactKey, ArtifactSummary> {
  return {
    crelesLocalBenchmark: summarizeArtifact("creles-local-benchmark.latest.json", inputs.crelesLocalBenchmark),
    haalsiSourceFeasibility: summarizeArtifact("haalsi-source-feasibility.latest.json", inputs.haalsiSourceFeasibility),
    midus2LocalBenchmark: summarizeArtifact("midus2-local-benchmark.latest.json", inputs.midus2LocalBenchmark),
    r612NhanesLayeringMap: summarizeArtifact("r612-nhanes-layering-map.latest.json", inputs.r612NhanesLayeringMap),
    r614MhasSourceRightsActivationLabels: summarizeArtifact(
      "r614-mhas-source-rights-activation-labels.latest.json",
      inputs.r614MhasSourceRightsActivationLabels,
    ),
    r614NshapActivationLabels: summarizeArtifact(
      "r614-nshap-activation-labels.latest.json",
      inputs.r614NshapActivationLabels,
    ),
    sageSouthAfricaHeaderPreflight: summarizeArtifact(
      "sage-south-africa-header-preflight.latest.json",
      inputs.sageSouthAfricaHeaderPreflight,
    ),
  };
}

function summarizeMhas(value: unknown | null): SourceActivationRow {
  const root = optionalRecord(value);
  if (!root) return missingRow("MHAS");
  const summary = optionalRecord(root.summary);
  const gates = optionalRecord(root.gates);
  const localFamily = optionalRecord(root.localFamilyEvidence);
  const rights = optionalRecord(root.sourceRightsActivationLabels);
  const rightsComplete = optionalBoolean(summary?.sourceRightsLabelsComplete) === true
    || optionalBoolean(rights?.activationLabelsComplete) === true;
  const endpointReady = optionalBoolean(summary?.endpointJoinContractReady) === true
    || optionalString(gates?.nextGate) === "draft_locked_mhas_endpoint_join_contract";
  return {
    activationTier: rightsComplete && endpointReady ? "endpoint_contract_ready_no_scoring" : "rights_blocked",
    aggregateOutputLabel: labelFromBoolean(rightsComplete),
    allowedNextLocalActions: rightsComplete && endpointReady
      ? ["draft_locked_mhas_endpoint_join_contract", "build_mhas_function_disability_aggregate_reducer"]
      : ["complete_mhas_source_rights_and_local_family_labels"],
    blockedNextActions: blockedScoringActions(),
    calibrationValueLabel: "high",
    candidateDomainLabels: {
      cognitionOrContext: "yellow",
      functionOrDisability: "green",
      hardOutcome: endpointReady ? "green" : "yellow",
      labBpBody: "yellow",
      wearableOrActivity: "yellow",
    },
    evidenceClass: "non_us_external_candidate",
    joinOrWaveLabel: optionalString(localFamily?.status) === "complete" ? "green" : "yellow",
    modelScoringAlreadyPerformed: false,
    rowExecutionUnlocked: false,
    sourceFamily: "MHAS",
    sourceRightsLabel: labelFromBoolean(rightsComplete),
  };
}

function summarizeCreles(value: unknown | null): SourceActivationRow {
  const root = optionalRecord(value);
  if (!root) return missingRow("CRELES");
  const scored = optionalBoolean(root.modelScoringPerformed) === true;
  const benchmarkCard = optionalRecord(root.benchmarkCard);
  return {
    activationTier: scored ? "ready_for_aggregate_benchmark_completed" : "metadata_only",
    aggregateOutputLabel: benchmarkCard ? "green" : "yellow",
    allowedNextLocalActions: scored
      ? ["reduce_creles_glycemia_transport_receipt", "compare_creles_against_midus_and_nhis_spine"]
      : ["complete_creles_aggregate_benchmark_card"],
    blockedNextActions: [
      "model_promotion_until_multi_source_validation",
      "feature_expansion_from_creles_without_predeclared_card",
      "product_claims_blocked",
    ],
    calibrationValueLabel: "high",
    candidateDomainLabels: {
      cognitionOrContext: "missing",
      functionOrDisability: "yellow",
      hardOutcome: "green",
      labBpBody: "green",
      wearableOrActivity: "missing",
    },
    evidenceClass: "non_nhanes_transport_diagnostic",
    joinOrWaveLabel: "green",
    modelScoringAlreadyPerformed: scored,
    rowExecutionUnlocked: false,
    sourceFamily: "CRELES",
    sourceRightsLabel: "green",
  };
}

function summarizeMidus(value: unknown | null): SourceActivationRow {
  const root = optionalRecord(value);
  if (!root) return missingRow("MIDUS");
  const scored = optionalBoolean(root.modelScoringPerformed) === true;
  return {
    activationTier: scored ? "ready_for_aggregate_benchmark_completed" : "metadata_only",
    aggregateOutputLabel: "green",
    allowedNextLocalActions: [
      "keep_midus_results_as_internal_transport_receipt",
      "use_midus_for_cross_source_comparison_not_product_promotion",
    ],
    blockedNextActions: [
      "retune_on_inspected_midus_results",
      "promote_midus_as_final_external_validation",
      "product_claims_blocked",
    ],
    calibrationValueLabel: "medium",
    candidateDomainLabels: {
      cognitionOrContext: "yellow",
      functionOrDisability: "yellow",
      hardOutcome: "green",
      labBpBody: "green",
      wearableOrActivity: "yellow",
    },
    evidenceClass: "non_nhanes_transport_diagnostic",
    joinOrWaveLabel: "green",
    modelScoringAlreadyPerformed: scored,
    rowExecutionUnlocked: false,
    sourceFamily: "MIDUS",
    sourceRightsLabel: "green",
  };
}

function summarizeNshap(value: unknown | null): SourceActivationRow {
  const root = optionalRecord(value);
  if (!root) return missingRow("NSHAP");
  const rights = optionalRecord(root.sourceRightsAndAggregateOutput);
  const rowReadiness = optionalRecord(root.rowExecutionReadiness);
  const rightsComplete = optionalBoolean(rights?.labelsComplete) === true;
  const archiveReady = optionalString(optionalRecord(root.archiveReadiness)?.status) === "all_expected_archives_observed";
  return {
    activationTier: rightsComplete ? "metadata_only" : "rights_blocked",
    aggregateOutputLabel: labelFromBoolean(optionalBoolean(rights?.aggregateOutputsActive) === true),
    allowedNextLocalActions: rightsComplete
      ? ["build_nshap_round_harmonization_card"]
      : ["complete_nshap_source_rights_and_aggregate_output_labels"],
    blockedNextActions: [
      ...(rightsComplete ? [] : ["row_execution_until_source_rights_labels_complete"]),
      "outcome_scoring_until_locked_execution_gate",
      "product_claims_blocked",
    ],
    calibrationValueLabel: "medium",
    candidateDomainLabels: {
      cognitionOrContext: "green",
      functionOrDisability: "green",
      hardOutcome: archiveReady ? "yellow" : "red",
      labBpBody: "yellow",
      wearableOrActivity: "yellow",
    },
    evidenceClass: "metadata_transport_candidate",
    joinOrWaveLabel: optionalString(rowReadiness?.status)?.startsWith("blocked") ? "yellow" : "green",
    modelScoringAlreadyPerformed: false,
    rowExecutionUnlocked: false,
    sourceFamily: "NSHAP",
    sourceRightsLabel: labelFromBoolean(rightsComplete),
  };
}

function summarizeHaalsi(value: unknown | null): SourceActivationRow {
  const root = optionalRecord(value);
  if (!root) return missingRow("HAALSI");
  const endpointStatus = optionalString(optionalRecord(root.endpointReadiness)?.status);
  const endpointReady = endpointStatus !== null && !endpointStatus.includes("blocked");
  return {
    activationTier: endpointReady ? "metadata_only" : "outcome_blocked",
    aggregateOutputLabel: "yellow",
    allowedNextLocalActions: endpointReady
      ? ["draft_haalsi_transport_card"]
      : ["find_or_activate_haalsi_mortality_or_followup_endpoint"],
    blockedNextActions: [
      "score_bearing_haalsi_modeling_until_endpoint_ready",
      "product_claims_blocked",
    ],
    calibrationValueLabel: endpointReady ? "high" : "unknown",
    candidateDomainLabels: {
      cognitionOrContext: "green",
      functionOrDisability: "green",
      hardOutcome: endpointReady ? "yellow" : "red",
      labBpBody: "green",
      wearableOrActivity: "yellow",
    },
    evidenceClass: "metadata_transport_candidate",
    joinOrWaveLabel: "yellow",
    modelScoringAlreadyPerformed: false,
    rowExecutionUnlocked: false,
    sourceFamily: "HAALSI",
    sourceRightsLabel: "yellow",
  };
}

function summarizeSage(value: unknown | null): SourceActivationRow {
  const root = optionalRecord(value);
  if (!root) return missingRow("SAGE");
  const conclusion = optionalString(root.preflightConclusion);
  const metadataOnly = conclusion?.includes("metadata-only") === true;
  return {
    activationTier: metadataOnly ? "metadata_only" : "outcome_blocked",
    aggregateOutputLabel: "yellow",
    allowedNextLocalActions: ["draft_sage_terms_endpoint_and_join_feasibility_card"],
    blockedNextActions: [
      "score_bearing_sage_modeling_until_endpoint_and_terms_ready",
      "product_claims_blocked",
    ],
    calibrationValueLabel: "low",
    candidateDomainLabels: {
      cognitionOrContext: "yellow",
      functionOrDisability: "green",
      hardOutcome: "yellow",
      labBpBody: "yellow",
      wearableOrActivity: "yellow",
    },
    evidenceClass: "context_only_candidate",
    joinOrWaveLabel: "yellow",
    modelScoringAlreadyPerformed: false,
    rowExecutionUnlocked: false,
    sourceFamily: "SAGE",
    sourceRightsLabel: "yellow",
  };
}

function summarizeNhanes(value: unknown | null): SourceActivationRow {
  const root = optionalRecord(value);
  if (!root) return missingRow("NHANES");
  const summary = optionalRecord(root.summary);
  const scoreLayer = optionalString(summary?.scoreBearingResearchLayer);
  const activityLayer = optionalString(summary?.objectiveActivityLayer);
  return {
    activationTier: "same_family_internal_only",
    aggregateOutputLabel: "green",
    allowedNextLocalActions: [
      "use_nhanes_lab_bp_body_as_research_only_signal",
      "keep_objective_activity_shadow_only",
    ],
    blockedNextActions: [
      "true_external_validation_claim_from_nhanes",
      "consumer_wearable_validation_from_nhanes_activity",
      "product_claims_blocked",
    ],
    calibrationValueLabel: "same_family_only",
    candidateDomainLabels: {
      cognitionOrContext: "missing",
      functionOrDisability: "missing",
      hardOutcome: "yellow",
      labBpBody: scoreLayer === "lab_bp_body" ? "green" : "yellow",
      wearableOrActivity: activityLayer === "shadow_only" ? "yellow" : "red",
    },
    evidenceClass: "same_family_internal",
    joinOrWaveLabel: "not_applicable",
    modelScoringAlreadyPerformed: false,
    rowExecutionUnlocked: false,
    sourceFamily: "NHANES",
    sourceRightsLabel: "green",
  };
}

function buildNextBatch(rows: SourceActivationRow[]): R615CrossSourceActivationMatrixOutput["nextBatch"] {
  const bySource = new Map(rows.map((row) => [row.sourceFamily, row]));
  const batch: R615CrossSourceActivationMatrixOutput["nextBatch"] = [];
  if (bySource.get("MHAS")?.activationTier === "endpoint_contract_ready_no_scoring") {
    batch.push({
      actionId: "draft_locked_mhas_endpoint_join_contract",
      reason: "MHAS has source-rights labels and local role families ready, but needs a locked endpoint/join contract before scoring.",
      reviewGptRole: "none_local_grunt_work",
      sourceFamily: "MHAS",
    });
  }
  if (bySource.get("CRELES")?.activationTier === "ready_for_aggregate_benchmark_completed") {
    batch.push({
      actionId: "reduce_creles_glycemia_transport_receipt",
      reason: "CRELES already has aggregate benchmark results and should be reduced into a cross-source evidence receipt.",
      reviewGptRole: "aggregate_result_or_strategy_review",
      sourceFamily: "CRELES",
    });
  }
  if (bySource.get("NSHAP")?.activationTier === "rights_blocked") {
    batch.push({
      actionId: "complete_nshap_source_rights_and_aggregate_output_labels",
      reason: "NSHAP files and metadata are present, but source-rights and aggregate-output labels are not complete.",
      reviewGptRole: "none_local_grunt_work",
      sourceFamily: "NSHAP",
    });
  }
  batch.push({
    actionId: "refresh_cross_source_matrix_after_next_receipts",
    reason: "Keep source activation, scoring receipts, and NHANES layering synchronized as local loops complete.",
    reviewGptRole: "none_local_grunt_work",
    sourceFamily: "cross_source",
  });
  return batch;
}

function blockedScoringActions(): string[] {
  return [
    "row_execution_until_locked_contract",
    "outcome_scoring_until_execution_gate",
    "model_mutation_until_aggregate_result_review",
    "product_claims_blocked",
  ];
}

function missingRow(sourceFamily: SourceActivationRow["sourceFamily"]): SourceActivationRow {
  return {
    activationTier: "missing_artifact",
    aggregateOutputLabel: "missing",
    allowedNextLocalActions: ["refresh_source_artifact"],
    blockedNextActions: ["source_activation_until_artifact_available", "product_claims_blocked"],
    calibrationValueLabel: "unknown",
    candidateDomainLabels: {
      cognitionOrContext: "missing",
      functionOrDisability: "missing",
      hardOutcome: "missing",
      labBpBody: "missing",
      wearableOrActivity: "missing",
    },
    evidenceClass: "metadata_transport_candidate",
    joinOrWaveLabel: "missing",
    modelScoringAlreadyPerformed: false,
    rowExecutionUnlocked: false,
    sourceFamily,
    sourceRightsLabel: "missing",
  };
}

function summarizeArtifact(artifact: string, value: unknown | null): ArtifactSummary {
  if (!value) return { artifact, packetId: null, schemaVersion: null, status: "missing" };
  const root = requiredRecord(value, artifact);
  return {
    artifact,
    packetId: optionalString(root.packetId),
    schemaVersion: optionalString(root.schemaVersion),
    status: "available",
  };
}

function validateInputBoundaries(inputs: Record<ArtifactKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) continue;
    const record = requiredRecord(value, key);
    const boundary = optionalRecord(record.boundary) ?? optionalRecord(record.artifactBoundary);
    if (!boundary) continue;
    for (const [flag, flagValue] of Object.entries(boundary)) {
      if (flag === "aggregateOnly") continue;
      if ((flag.endsWith("Stored") || flag.endsWith("Included") || flag.endsWith("Authorized")) && flagValue !== false) {
        throw new Error(`${key} boundary has unsafe boundary flag ${flag}`);
      }
    }
  }
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    const code = optionalRecord(error)?.code;
    if (code === "ENOENT") return null;
    throw error;
  }
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function labelFromBoolean(value: boolean): LabelStatus {
  return value ? "green" : "red";
}

function countBand(count: number): string {
  if (count === 0) return "0";
  if (count <= 4) return "1-4";
  if (count <= 9) return "5-9";
  return "10+";
}

async function main(): Promise<void> {
  const { output: manifest } = await runR615CrossSourceActivationMatrix({
    crelesLocalBenchmarkPath: process.env.MURPH_AGE_CRELES_LOCAL_BENCHMARK_PATH,
    haalsiSourceFeasibilityPath: process.env.MURPH_AGE_HAALSI_SOURCE_FEASIBILITY_PATH,
    midus2LocalBenchmarkPath: process.env.MURPH_AGE_MIDUS2_LOCAL_BENCHMARK_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r612NhanesLayeringMapPath: process.env.MURPH_AGE_R612_NHANES_LAYERING_MAP_PATH,
    r614MhasSourceRightsActivationLabelsPath: process.env.MURPH_AGE_R614_MHAS_LABELS_PATH,
    r614NshapActivationLabelsPath: process.env.MURPH_AGE_R614_NSHAP_LABELS_PATH,
    sageSouthAfricaHeaderPreflightPath: process.env.MURPH_AGE_SAGE_HEADER_PREFLIGHT_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    artifact: OUTPUT_FILE_NAME,
    conclusion: manifest.summary.conclusion,
    immediateExecutableAggregateBenchmarkCountBand: manifest.summary.immediateExecutableAggregateBenchmarkCountBand,
    nextPrimaryLocalAction: manifest.summary.nextPrimaryLocalAction,
    packetId: manifest.packetId,
    productDisplayAuthorized: manifest.summary.productDisplayAuthorized,
    schemaVersion: manifest.schemaVersion,
    scoreBearingSourceCountBand: manifest.summary.scoreBearingSourceCountBand,
    status: manifest.status,
  })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
