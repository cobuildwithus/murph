import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R613_NSHAP_METADATA_BENCHMARK_CARD_SCHEMA_VERSION =
  "murph-age-r613-nshap-metadata-benchmark-card.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r613-nshap-metadata-benchmark-card.latest.json";

type ArtifactKey = "nshapActivationFeasibility" | "r609SourceActivationQueue" | "r612NhanesLayeringMap";
type ArtifactStatus = "available" | "missing";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: ArtifactStatus;
}

interface CandidateFamily {
  candidateFamilyId: string;
  role: "reference" | "primary_increment" | "conditional_increment" | "shadow";
  allowedOnlyIf: string[];
  blockedUntil: string[];
  interpretation: string;
}

interface BenchmarkCard {
  aggregateOutputsAllowed: string[];
  blockedOutputs: string[];
  candidateFamilies: CandidateFamily[];
  cardId: "nshap-metadata-benchmark-card";
  cardStatus: "metadata_locked_no_execution";
  endpointFamily: "mortality_or_followup";
  source: "NSHAP";
  sourceActivation: {
    aggregateOutputPermission: "unconfirmed_human_required";
    rowParsingUnlocked: false;
    sourceRightsLabelsComplete: false;
    termsAllowLocalResearchRows: "unconfirmed_human_required";
  };
  sourceFit: {
    endpointReadyForBenchmarkDesign: boolean;
    fileCoverageStatus: string | null;
    headerCoverageStatus: string | null;
    rowActivationRequiredBeforeExecution: boolean;
  };
}

export interface R613NshapMetadataBenchmarkCardOptions {
  createdAt?: string;
  nshapActivationFeasibilityPath?: string;
  outputDir?: string;
  r609Path?: string;
  r612Path?: string;
}

export interface R613NshapMetadataBenchmarkCard {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformed: false;
    participantIdentifiersStored: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    rowParsingPerformed: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  benchmarkCard: BenchmarkCard;
  createdAt: string;
  gateStatus: {
    lockedBenchmarkCardAvailable: true;
    nextAction: "fill_nshap_source_rights_and_aggregate_output_labels";
    outcomeScoringUnlocked: false;
    rowExecutionUnlocked: false;
  };
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  overfitControls: string[];
  packetId: "r613-nshap-metadata-benchmark-card";
  schemaVersion: typeof R613_NSHAP_METADATA_BENCHMARK_CARD_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: "nshap_metadata_benchmark_card_locked_without_execution";
    nhanesLabLayerCarriedAsResearchOnly: boolean;
    outcomeScoringUnlockedCountBand: "0";
    productPromotionAuthorized: false;
  };
}

export async function runR613NshapMetadataBenchmarkCard(
  options: R613NshapMetadataBenchmarkCardOptions = {},
): Promise<{ output: R613NshapMetadataBenchmarkCard; outputPath: string }> {
  const inputs = {
    nshapActivationFeasibility: await readJsonIfPresent(
      options.nshapActivationFeasibilityPath
        ?? path.join(DEFAULT_MODEL_RUNS_DIR, "nshap-activation-feasibility.latest.json"),
    ),
    r609SourceActivationQueue: await readJsonIfPresent(
      options.r609Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r609-source-activation-queue.latest.json"),
    ),
    r612NhanesLayeringMap: await readJsonIfPresent(
      options.r612Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r612-nhanes-layering-map.latest.json"),
    ),
  };
  validateInputBoundaries(inputs);

  const inputArtifacts = summarizeInputs(inputs);
  const nshap = optionalRecord(inputs.nshapActivationFeasibility);
  const endpointReadiness = optionalRecord(nshap?.endpointReadiness);
  const fileCoverage = optionalRecord(nshap?.fileCoverage);
  const headerCoverage = optionalRecord(nshap?.headerCoverage);
  const rowActivationRequired = optionalBoolean(endpointReadiness?.rowActivationRequiredBeforeExecution) !== false;

  const output: R613NshapMetadataBenchmarkCard = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      outcomeScoringPerformed: false,
      participantIdentifiersStored: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      rowParsingPerformed: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
    },
    benchmarkCard: {
      aggregateOutputsAllowed: [
        "eligible_denominator_count_band",
        "coverage_and_missingness_counts",
        "anchor_versus_increment_metric_summary",
        "proper_score_summary_if_fixed_horizon_is_locked",
        "calibration_summary",
        "broad_subgroup_summary",
        "suppression_verdict",
      ],
      blockedOutputs: [
        "row_values",
        "participant_identifiers",
        "split_memberships",
        "individual_level_model_outputs",
        "model_parameters",
        "source_text",
        "unsuppressed_small_cells",
        "product_or_recommendation_claims",
      ],
      candidateFamilies: candidateFamilies(),
      cardId: "nshap-metadata-benchmark-card",
      cardStatus: "metadata_locked_no_execution",
      endpointFamily: "mortality_or_followup",
      source: "NSHAP",
      sourceActivation: {
        aggregateOutputPermission: "unconfirmed_human_required",
        rowParsingUnlocked: false,
        sourceRightsLabelsComplete: false,
        termsAllowLocalResearchRows: "unconfirmed_human_required",
      },
      sourceFit: {
        endpointReadyForBenchmarkDesign: optionalBoolean(endpointReadiness?.readyForLockedBenchmarkDesign) === true,
        fileCoverageStatus: optionalMetadataLabel(fileCoverage?.status, "NSHAP file coverage status"),
        headerCoverageStatus: optionalMetadataLabel(headerCoverage?.status, "NSHAP header coverage status"),
        rowActivationRequiredBeforeExecution: rowActivationRequired,
      },
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    gateStatus: {
      lockedBenchmarkCardAvailable: true,
      nextAction: "fill_nshap_source_rights_and_aggregate_output_labels",
      outcomeScoringUnlocked: false,
      rowExecutionUnlocked: false,
    },
    inputArtifacts,
    overfitControls: [
      "freeze_this_card_before_any_nshap_row_execution",
      "compare_anchor_only_against_one_increment_family_at_a_time",
      "do_not_change_candidate_definitions_after_nshap_results",
      "keep_nhanes_lab_layer_research_only_until_non_nhanes_validation",
      "report_null_or_negative_aggregate_results_without_reselecting_subgroups",
      "require_same_denominator_labels_for_all_metric_comparisons",
    ],
    packetId: "r613-nshap-metadata-benchmark-card",
    schemaVersion: R613_NSHAP_METADATA_BENCHMARK_CARD_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "nshap_metadata_benchmark_card_locked_without_execution",
      nhanesLabLayerCarriedAsResearchOnly: hasNhanesLabLayer(inputs.r612NhanesLayeringMap),
      outcomeScoringUnlockedCountBand: "0",
      productPromotionAuthorized: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R613 NSHAP metadata benchmark card failed aggregate-egress validation: ${findings.join("; ")}`);
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
      allowedOnlyIf: ["source_activation_complete", "endpoint_family_locked"],
      blockedUntil: ["source_rights_labels_complete", "aggregate_output_permission_confirmed"],
      candidateFamilyId: "anchor_only_reference",
      interpretation: "Reference comparator only; never a biological-age product claim.",
      role: "reference",
    },
    {
      allowedOnlyIf: ["function_family_mapping_green", "same_denominator_anchor_comparison_available"],
      blockedUntil: ["locked_function_family_mapping", "source_activation_complete"],
      candidateFamilyId: "anchor_plus_function_sidecar",
      interpretation: "Primary sidecar validation candidate because function has the strongest prior sidecar consensus.",
      role: "primary_increment",
    },
    {
      allowedOnlyIf: ["biomarker_family_mapping_green", "same_denominator_anchor_comparison_available"],
      blockedUntil: ["source_activation_complete", "biomarker_mapping_green"],
      candidateFamilyId: "lab_bp_body_biomarker_increment",
      interpretation: "Carries the NHANES lab, BP, and body signal into a non-NHANES benchmark only if mapping is clean.",
      role: "conditional_increment",
    },
    {
      allowedOnlyIf: ["glycemia_mapping_green", "fixed_external_validation_spec"],
      blockedUntil: ["source_activation_complete", "glycemia_family_mapping_green"],
      candidateFamilyId: "glycemia_only_frozen_external_candidate",
      interpretation: "Frozen candidate from prior loops; validate or park, but do not retune on NSHAP.",
      role: "conditional_increment",
    },
    {
      allowedOnlyIf: ["function_result_reviewed", "cognition_family_mapping_green"],
      blockedUntil: ["function_sidecar_result_available", "cognition_mapping_green"],
      candidateFamilyId: "cognition_shadow_after_function",
      interpretation: "Shadow-only future lane; cognition must not displace function without stable residual evidence.",
      role: "shadow",
    },
  ];
}

function validateInputBoundaries(inputs: Record<ArtifactKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[ArtifactKey, unknown | null]>) {
    if (!value) continue;
    const root = requiredRecord(value, key);
    const boundary = optionalRecord(root.boundary) ?? optionalRecord(root.artifactBoundary);
    if (!boundary) continue;
    for (const boundaryKey of [
      "codebookTextStored",
      "coefficientsStored",
      "localPathsStored",
      "modelParametersStored",
      "modelScoringPerformed",
      "outcomeScoringPerformed",
      "participantIdentifiersStored",
      "participantIdentifiersWritten",
      "predictionsStored",
      "productClaimsIncluded",
      "productDisplayAuthorized",
      "productPromotionAuthorized",
      "protocolClaimsIncluded",
      "recommendationClaimsIncluded",
      "rowParsingPerformed",
      "rowValuesStored",
      "smallCellsStored",
      "sourceBodiesStored",
      "splitIdentifiersStored",
      "splitMembershipStored",
      "variableLabelsStored",
      "variableNamesStored",
    ]) {
      if (boundary[boundaryKey] !== undefined && boundary[boundaryKey] !== false) {
        throw new Error(`${key} boundary flag ${boundaryKey} must be false.`);
      }
    }
  }
}

function summarizeInputs(inputs: Record<ArtifactKey, unknown | null>): Record<ArtifactKey, ArtifactSummary> {
  return {
    nshapActivationFeasibility: summarizeArtifact(
      "nshap-activation-feasibility.latest.json",
      inputs.nshapActivationFeasibility,
    ),
    r609SourceActivationQueue: summarizeArtifact("r609-source-activation-queue.latest.json", inputs.r609SourceActivationQueue),
    r612NhanesLayeringMap: summarizeArtifact("r612-nhanes-layering-map.latest.json", inputs.r612NhanesLayeringMap),
  };
}

function summarizeArtifact(artifact: string, value: unknown | null): ArtifactSummary {
  if (!value) return { artifact, packetId: null, schemaVersion: null, status: "missing" };
  const root = requiredRecord(value, artifact);
  return {
    artifact,
    packetId: optionalMetadataLabel(root.packetId, `${artifact} packet id`),
    schemaVersion: optionalMetadataLabel(root.schemaVersion, `${artifact} schema version`),
    status: "available",
  };
}

function hasNhanesLabLayer(value: unknown | null): boolean {
  const root = optionalRecord(value);
  const summary = optionalRecord(root?.summary);
  return summary?.scoreBearingResearchLayer === "lab_bp_body"
    && summary?.modelDefaultAuthorized === false;
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") return null;
    throw new Error("Failed to read a Murph Age aggregate metadata artifact.");
  }
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  const record = optionalRecord(value);
  if (!record) throw new Error(`${label} must be an object.`);
  return record;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function optionalMetadataLabel(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    /[\r\n\t/\\]/u.test(value) ||
    /\b(?:authorization|codebook|coefficient|identifier|participant|prediction|raw\s*row|row\s*value|small\s*cell|source\s*body|source\s*text|split\s*id)\b/iu.test(value)
  ) {
    throw new Error(`${label} is not a safe metadata label.`);
  }
  return value;
}

async function main(): Promise<void> {
  const { output: manifest } = await runR613NshapMetadataBenchmarkCard({
    nshapActivationFeasibilityPath: process.env.MURPH_AGE_NSHAP_ACTIVATION_FEASIBILITY_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r609Path: process.env.MURPH_AGE_R609_SOURCE_ACTIVATION_QUEUE_PATH,
    r612Path: process.env.MURPH_AGE_R612_NHANES_LAYERING_MAP_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    artifact: OUTPUT_FILE_NAME,
    conclusion: manifest.summary.conclusion,
    nextAction: manifest.gateStatus.nextAction,
    outcomeScoringUnlockedCountBand: manifest.summary.outcomeScoringUnlockedCountBand,
    packetId: manifest.packetId,
    productPromotionAuthorized: manifest.summary.productPromotionAuthorized,
    schemaVersion: manifest.schemaVersion,
    status: manifest.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
