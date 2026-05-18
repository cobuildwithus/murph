import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R994_EXPANDED_SOURCE_CACHE_READINESS_SCHEMA_VERSION =
  "murph-age-r994-expanded-source-cache-readiness.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_SOURCE_CACHE_ROOT = path.join(
  ".runtime",
  "cache",
  "murph-age",
  "external-sources",
);
const OUTPUT_FILE_NAME = "r994-expanded-source-cache-readiness.latest.json";

type ReadinessCategory =
  | "score-bearing_complete"
  | "ready_for_no-score_source_card"
  | "blocked_on_endpoint"
  | "blocked_on_activation_or_confirmation"
  | "context-only";
type ArtifactStatus = "available" | "missing";
type SourceFamily =
  | "CRELES waves"
  | "HAALSI"
  | "MHAS/Gateway MHAS"
  | "MIDUS core/refresher"
  | "NHANES"
  | "NSHAP rounds 1-3"
  | "SAGE South Africa";
type ArtifactKey =
  | "crelesLocalBenchmark"
  | "haalsiSourceFeasibility"
  | "midusCoreBenchmark"
  | "midusRefresherBenchmark"
  | "r612NhanesLayeringMap"
  | "r614MhasSourceRightsActivationLabels"
  | "r614NshapActivationLabels"
  | "r615CrossSourceActivationMatrix"
  | "r987CrelesGlycemiaReceiptReducer"
  | "r992NshapFunctionCognitionScaffold"
  | "sageSourceFeasibility";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: ArtifactStatus;
}

interface CacheSummary {
  cacheEvidenceBand: string;
  cachePresent: boolean;
  cacheRootInspected: boolean;
  localFileNamesStored: false;
  localPathsStored: false;
}

interface SourceReadiness {
  aggregateArtifacts: ArtifactSummary[];
  blockedBy: string[];
  cache: CacheSummary;
  category: ReadinessCategory;
  evidenceLabels: string[];
  nextLocalAction: string;
  scoreBearingComplete: boolean;
  sourceFamily: SourceFamily;
}

export interface R994ExpandedSourceCacheReadinessOptions {
  createdAt?: string;
  crelesLocalBenchmarkPath?: string;
  haalsiSourceFeasibilityPath?: string;
  midusCoreBenchmarkPath?: string;
  midusRefresherBenchmarkPath?: string;
  outputDir?: string;
  r612NhanesLayeringMapPath?: string;
  r614MhasSourceRightsActivationLabelsPath?: string;
  r614NshapActivationLabelsPath?: string;
  r615CrossSourceActivationMatrixPath?: string;
  r987CrelesGlycemiaReceiptReducerPath?: string;
  r992NshapFunctionCognitionScaffoldPath?: string;
  sageSourceFeasibilityPath?: string;
  sourceCacheRoot?: string;
}

export interface R994ExpandedSourceCacheReadinessOutput {
  artifactBoundary: {
    aggregateOnly: true;
    cacheBasenamesStored: false;
    codebookProseStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    rowParsingPerformedByR994: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceProseStored: false;
    variableNamesStored: false;
  };
  categoryBuckets: Record<ReadinessCategory, SourceFamily[]>;
  createdAt: string;
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  packetId: "r994-expanded-source-cache-readiness";
  schemaVersion: typeof R994_EXPANDED_SOURCE_CACHE_READINESS_SCHEMA_VERSION;
  sourceReadiness: SourceReadiness[];
  status: "research-local-aggregate-only";
  summary: {
    fastestLaneNow: SourceFamily | null;
    sourcePriorityVerdict:
      | "mhas_no_score_card_first_then_reuse_completed_midsize_score_receipts"
      | "complete_activation_or_endpoint_labels_before_more_source_work";
    cacheInspected: true;
    productDisplayAuthorized: false;
    scoreBearingCompleteCountBand: string;
  };
}

export async function runR994ExpandedSourceCacheReadiness(
  options: R994ExpandedSourceCacheReadinessOptions = {},
): Promise<{ output: R994ExpandedSourceCacheReadinessOutput; outputPath: string }> {
  const [inputs, cachePresence] = await Promise.all([
    readInputs(options),
    inspectCachePresence(options.sourceCacheRoot ?? DEFAULT_SOURCE_CACHE_ROOT),
  ]);
  validateInputBoundaries(inputs);

  const sourceReadiness = buildSourceReadiness(inputs, cachePresence);
  const categoryBuckets = bucketSources(sourceReadiness);
  const scoreBearingCompleteCount = sourceReadiness.filter((source) => source.scoreBearingComplete).length;
  const fastestLaneNow = sourceReadiness.find((source) => source.category === "ready_for_no-score_source_card")
    ?.sourceFamily
    ?? sourceReadiness.find((source) => source.category === "score-bearing_complete")?.sourceFamily
    ?? null;

  const output: R994ExpandedSourceCacheReadinessOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      cacheBasenamesStored: false,
      codebookProseStored: false,
      codebookTextStored: false,
      coefficientsStored: false,
      localFileNamesStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      participantIdentifiersStored: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      rowParsingPerformedByR994: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceProseStored: false,
      variableNamesStored: false,
    },
    categoryBuckets,
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r994-expanded-source-cache-readiness",
    schemaVersion: R994_EXPANDED_SOURCE_CACHE_READINESS_SCHEMA_VERSION,
    sourceReadiness,
    status: "research-local-aggregate-only",
    summary: {
      cacheInspected: true,
      fastestLaneNow,
      productDisplayAuthorized: false,
      scoreBearingCompleteCountBand: countBand(scoreBearingCompleteCount),
      sourcePriorityVerdict: fastestLaneNow === "MHAS/Gateway MHAS"
        ? "mhas_no_score_card_first_then_reuse_completed_midsize_score_receipts"
        : "complete_activation_or_endpoint_labels_before_more_source_work",
    },
  };

  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findForbiddenR994Output(output),
  ];
  if (findings.length > 0) {
    throw new Error(`R994 expanded source cache readiness failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(
  options: R994ExpandedSourceCacheReadinessOptions,
): Promise<Record<ArtifactKey, unknown | null>> {
  return {
    crelesLocalBenchmark: await readJsonIfPresent(
      options.crelesLocalBenchmarkPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "creles-local-benchmark.latest.json"),
    ),
    haalsiSourceFeasibility: await readJsonIfPresent(
      options.haalsiSourceFeasibilityPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "haalsi-source-feasibility.latest.json"),
    ),
    midusCoreBenchmark: await readJsonIfPresent(
      options.midusCoreBenchmarkPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "midus2-local-benchmark.latest.json"),
    ),
    midusRefresherBenchmark: await readJsonIfPresent(
      options.midusRefresherBenchmarkPath
        ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r399-midus-refresher-biomarker-increment.latest.json"),
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
    r615CrossSourceActivationMatrix: await readJsonIfPresent(
      options.r615CrossSourceActivationMatrixPath
        ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r615-cross-source-activation-matrix.latest.json"),
    ),
    r987CrelesGlycemiaReceiptReducer: await readJsonIfPresent(
      options.r987CrelesGlycemiaReceiptReducerPath
        ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r987-creles-glycemia-receipt-reducer.latest.json"),
    ),
    r992NshapFunctionCognitionScaffold: await readJsonIfPresent(
      options.r992NshapFunctionCognitionScaffoldPath
        ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r992-nshap-function-cognition-scaffold.latest.json"),
    ),
    sageSourceFeasibility: await readJsonIfPresent(
      options.sageSourceFeasibilityPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "sage-source-feasibility.latest.json"),
    ),
  };
}

function buildSourceReadiness(
  inputs: Record<ArtifactKey, unknown | null>,
  cachePresence: Record<SourceFamily, CacheSummary>,
): SourceReadiness[] {
  const rows = readSourceRows(inputs.r615CrossSourceActivationMatrix);
  return [
    buildMidusReadiness(inputs, rows.get("MIDUS"), cachePresence["MIDUS core/refresher"]),
    buildCrelesReadiness(inputs, rows.get("CRELES"), cachePresence["CRELES waves"]),
    buildMhasReadiness(inputs, rows.get("MHAS"), cachePresence["MHAS/Gateway MHAS"]),
    buildNshapReadiness(inputs, rows.get("NSHAP"), cachePresence["NSHAP rounds 1-3"]),
    buildHaalsiReadiness(inputs, rows.get("HAALSI"), cachePresence.HAALSI),
    buildSageReadiness(inputs, rows.get("SAGE"), cachePresence["SAGE South Africa"]),
    buildNhanesReadiness(inputs, rows.get("NHANES"), cachePresence.NHANES),
  ];
}

function buildMidusReadiness(
  inputs: Record<ArtifactKey, unknown | null>,
  row: Record<string, unknown> | undefined,
  cache: CacheSummary,
): SourceReadiness {
  const coreScored = optionalBoolean(inputs.midusCoreBenchmark && optionalRecord(inputs.midusCoreBenchmark)?.modelScoringPerformed) === true;
  const refresherScored = optionalBoolean(
    inputs.midusRefresherBenchmark && optionalRecord(inputs.midusRefresherBenchmark)?.modelScoringPerformed,
  ) === true || optionalRecord(inputs.midusRefresherBenchmark)?.incrementEvaluationCard !== undefined;
  return {
    aggregateArtifacts: [
      summarizeArtifact("midus2-local-benchmark.latest.json", inputs.midusCoreBenchmark),
      summarizeArtifact("r399-midus-refresher-biomarker-increment.latest.json", inputs.midusRefresherBenchmark),
    ],
    blockedBy: ["product_promotion_blocked", "same_lane_retuning_blocked"],
    cache,
    category: coreScored || refresherScored || optionalBoolean(row?.modelScoringAlreadyPerformed) === true
      ? "score-bearing_complete"
      : "blocked_on_activation_or_confirmation",
    evidenceLabels: [
      coreScored ? "midus_core_score_receipt_available" : "midus_core_score_receipt_missing",
      refresherScored ? "midus_refresher_increment_receipt_available" : "midus_refresher_increment_receipt_missing",
      "aggregate_receipt_only",
    ],
    nextLocalAction: "reuse_completed_midus_receipts_for_cross_source_comparison",
    scoreBearingComplete: coreScored || refresherScored || optionalBoolean(row?.modelScoringAlreadyPerformed) === true,
    sourceFamily: "MIDUS core/refresher",
  };
}

function buildCrelesReadiness(
  inputs: Record<ArtifactKey, unknown | null>,
  row: Record<string, unknown> | undefined,
  cache: CacheSummary,
): SourceReadiness {
  const scored = optionalBoolean(optionalRecord(inputs.crelesLocalBenchmark)?.modelScoringPerformed) === true
    || readStringAt(inputs.r987CrelesGlycemiaReceiptReducer, ["receiptReduction", "crelesEvidenceStatus"]) === "available"
    || optionalBoolean(row?.modelScoringAlreadyPerformed) === true;
  return {
    aggregateArtifacts: [
      summarizeArtifact("creles-local-benchmark.latest.json", inputs.crelesLocalBenchmark),
      summarizeArtifact("r987-creles-glycemia-receipt-reducer.latest.json", inputs.r987CrelesGlycemiaReceiptReducer),
    ],
    blockedBy: ["product_promotion_blocked", "new_feature_expansion_requires_predeclared_card"],
    cache,
    category: scored ? "score-bearing_complete" : "blocked_on_activation_or_confirmation",
    evidenceLabels: [
      scored ? "creles_wave_score_receipt_available" : "creles_wave_score_receipt_missing",
      "aggregate_receipt_only",
    ],
    nextLocalAction: "reuse_creles_wave_receipts_for_source_priority_and_external_validation_review",
    scoreBearingComplete: scored,
    sourceFamily: "CRELES waves",
  };
}

function buildMhasReadiness(
  inputs: Record<ArtifactKey, unknown | null>,
  row: Record<string, unknown> | undefined,
  cache: CacheSummary,
): SourceReadiness {
  const endpointReady = optionalBoolean(readAt(inputs.r614MhasSourceRightsActivationLabels, [
    "summary",
    "endpointJoinContractReady",
  ])) === true || optionalMetadataLabel(row?.activationTier, "MHAS activation tier") === "endpoint_contract_ready_no_scoring";
  return {
    aggregateArtifacts: [
      summarizeArtifact(
        "r614-mhas-source-rights-activation-labels.latest.json",
        inputs.r614MhasSourceRightsActivationLabels,
      ),
    ],
    blockedBy: endpointReady
      ? ["row_execution_blocked_until_locked_no-score_card", "outcome_scoring_blocked"]
      : ["endpoint_contract_or_source_activation_incomplete"],
    cache,
    category: endpointReady ? "ready_for_no-score_source_card" : "blocked_on_endpoint",
    evidenceLabels: [
      endpointReady ? "mhas_gateway_endpoint_contract_ready_no_scoring" : "mhas_gateway_endpoint_contract_missing",
      cache.cachePresent ? "cache_present" : "cache_absent",
    ],
    nextLocalAction: endpointReady
      ? "draft_no-score_mhas_gateway_source_card"
      : "finish_mhas_endpoint_contract_labels",
    scoreBearingComplete: false,
    sourceFamily: "MHAS/Gateway MHAS",
  };
}

function buildNshapReadiness(
  inputs: Record<ArtifactKey, unknown | null>,
  row: Record<string, unknown> | undefined,
  cache: CacheSummary,
): SourceReadiness {
  const labelsComplete = optionalBoolean(readAt(inputs.r614NshapActivationLabels, [
    "summary",
    "sourceRightsLabelsComplete",
  ])) === true;
  const aggregateOutputsActive = optionalBoolean(readAt(inputs.r614NshapActivationLabels, [
    "summary",
    "aggregateOutputsActive",
  ])) === true;
  const cardAvailable = optionalBoolean(readAt(inputs.r614NshapActivationLabels, [
    "lockedBenchmarkCard",
    "available",
  ])) === true || inputs.r992NshapFunctionCognitionScaffold !== null;
  return {
    aggregateArtifacts: [
      summarizeArtifact("r614-nshap-activation-labels.latest.json", inputs.r614NshapActivationLabels),
      summarizeArtifact("r992-nshap-function-cognition-scaffold.latest.json", inputs.r992NshapFunctionCognitionScaffold),
    ],
    blockedBy: labelsComplete && aggregateOutputsActive
      ? ["outcome_scoring_blocked_until_separate_execution_gate"]
      : ["source_rights_or_aggregate_output_confirmation_incomplete"],
    cache,
    category: labelsComplete && aggregateOutputsActive && cardAvailable
      ? "ready_for_no-score_source_card"
      : "blocked_on_activation_or_confirmation",
    evidenceLabels: [
      cardAvailable ? "nshap_rounds_1_3_card_scaffold_available" : "nshap_rounds_1_3_card_scaffold_missing",
      labelsComplete ? "source_rights_labels_complete" : "source_rights_labels_incomplete",
      optionalMetadataLabel(row?.joinOrWaveLabel, "NSHAP wave label") === "yellow"
        ? "rounds_join_or_wave_label_partial"
        : "rounds_join_or_wave_label_unknown",
    ],
    nextLocalAction: labelsComplete && aggregateOutputsActive
      ? "draft_no-score_nshap_rounds_source_card"
      : "complete_nshap_rounds_activation_confirmation",
    scoreBearingComplete: false,
    sourceFamily: "NSHAP rounds 1-3",
  };
}

function buildHaalsiReadiness(
  inputs: Record<ArtifactKey, unknown | null>,
  row: Record<string, unknown> | undefined,
  cache: CacheSummary,
): SourceReadiness {
  const endpointStatus = readStringAt(inputs.haalsiSourceFeasibility, ["endpointReadiness", "status"]);
  const endpointBlocked = endpointStatus?.includes("blocked") === true
    || optionalMetadataLabel(row?.activationTier, "HAALSI activation tier") === "outcome_blocked";
  return {
    aggregateArtifacts: [summarizeArtifact("haalsi-source-feasibility.latest.json", inputs.haalsiSourceFeasibility)],
    blockedBy: endpointBlocked
      ? ["mortality_or_followup_endpoint_not_ready", "score_bearing_modeling_blocked"]
      : ["activation_confirmation_required_before_execution"],
    cache,
    category: endpointBlocked ? "blocked_on_endpoint" : "blocked_on_activation_or_confirmation",
    evidenceLabels: [
      endpointBlocked ? "haalsi_endpoint_blocked" : "haalsi_endpoint_metadata_ready",
      cache.cachePresent ? "cache_present" : "cache_absent",
    ],
    nextLocalAction: "find_or_activate_haalsi_mortality_or_followup_endpoint",
    scoreBearingComplete: false,
    sourceFamily: "HAALSI",
  };
}

function buildSageReadiness(
  inputs: Record<ArtifactKey, unknown | null>,
  row: Record<string, unknown> | undefined,
  cache: CacheSummary,
): SourceReadiness {
  const contextOnly = optionalMetadataLabel(row?.evidenceClass, "SAGE evidence class") === "context_only_candidate"
    || readStringAt(inputs.sageSourceFeasibility, ["laneAssessment", "classification"]) === "source_fit_context_lane";
  return {
    aggregateArtifacts: [summarizeArtifact("sage-source-feasibility.latest.json", inputs.sageSourceFeasibility)],
    blockedBy: ["score_bearing_modeling_blocked_until_endpoint_and_terms_ready", "product_claims_blocked"],
    cache,
    category: contextOnly ? "context-only" : "blocked_on_endpoint",
    evidenceLabels: [
      contextOnly ? "sage_south_africa_context_only_candidate" : "sage_south_africa_endpoint_incomplete",
      cache.cachePresent ? "cache_present" : "cache_absent",
    ],
    nextLocalAction: "keep_sage_south_africa_as_context_source_until_endpoint_and_terms_card_is_ready",
    scoreBearingComplete: false,
    sourceFamily: "SAGE South Africa",
  };
}

function buildNhanesReadiness(
  inputs: Record<ArtifactKey, unknown | null>,
  row: Record<string, unknown> | undefined,
  cache: CacheSummary,
): SourceReadiness {
  const researchLayer = readStringAt(inputs.r612NhanesLayeringMap, ["summary", "scoreBearingResearchLayer"]);
  return {
    aggregateArtifacts: [summarizeArtifact("r612-nhanes-layering-map.latest.json", inputs.r612NhanesLayeringMap)],
    blockedBy: ["true_external_validation_claim_blocked", "product_claims_blocked"],
    cache,
    category: "context-only",
    evidenceLabels: [
      researchLayer === "lab_bp_body" ? "nhanes_lab_bp_body_research_layer_available" : "nhanes_research_layer_missing",
      optionalMetadataLabel(row?.evidenceClass, "NHANES evidence class") === "same_family_internal"
        ? "same_family_internal_only"
        : "same_family_status_unknown",
    ],
    nextLocalAction: "keep_nhanes_as_internal_same-family_context_not_expanded_source_priority",
    scoreBearingComplete: false,
    sourceFamily: "NHANES",
  };
}

async function inspectCachePresence(sourceCacheRoot: string): Promise<Record<SourceFamily, CacheSummary>> {
  const entries = await readTopLevelDirectoryNames(sourceCacheRoot);
  const build = async (matchers: RegExp[]): Promise<CacheSummary> => {
    const matched = entries.filter((entry) => matchers.some((matcher) => matcher.test(entry)));
    const cacheEvidence = await countMatchedCacheEntries(sourceCacheRoot, matched);
    return {
      cacheEvidenceBand: countBand(cacheEvidence),
      cachePresent: cacheEvidence > 0,
      cacheRootInspected: true,
      localFileNamesStored: false,
      localPathsStored: false,
    };
  };
  return {
    "CRELES waves": await build([/^creles/u]),
    HAALSI: await build([/^haalsi/u]),
    "MHAS/Gateway MHAS": await build([/^mhas/u]),
    "MIDUS core/refresher": await build([/^midus/u]),
    NHANES: await build([/nhanes/iu, /^nhefs/u]),
    "NSHAP rounds 1-3": await build([/^nshap/u]),
    "SAGE South Africa": await build([/^who_sage/u, /^sage/u]),
  };
}

async function readTopLevelDirectoryNames(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (optionalRecord(error)?.code === "ENOENT") return [];
    throw new Error("Failed to inspect R994 source cache root.");
  }
}

async function countMatchedCacheEntries(root: string, topLevelNames: string[]): Promise<number> {
  let count = 0;
  for (const topLevelName of topLevelNames) {
    count += await countEntries(path.join(root, topLevelName), 2000);
  }
  return count;
}

async function countEntries(start: string, remainingBudget: number): Promise<number> {
  if (remainingBudget <= 0) return 0;
  let info;
  try {
    info = await stat(start);
  } catch {
    return 0;
  }
  if (!info.isDirectory()) return 1;
  let total = 0;
  const entries = await readdir(start, { withFileTypes: true });
  for (const entry of entries) {
    if (total >= remainingBudget) break;
    if (entry.isDirectory()) {
      total += await countEntries(path.join(start, entry.name), remainingBudget - total);
    } else {
      total += 1;
    }
  }
  return total;
}

function bucketSources(sourceReadiness: SourceReadiness[]): Record<ReadinessCategory, SourceFamily[]> {
  return {
    "score-bearing_complete": sourceReadiness
      .filter((source) => source.category === "score-bearing_complete")
      .map((source) => source.sourceFamily),
    "ready_for_no-score_source_card": sourceReadiness
      .filter((source) => source.category === "ready_for_no-score_source_card")
      .map((source) => source.sourceFamily),
    blocked_on_endpoint: sourceReadiness
      .filter((source) => source.category === "blocked_on_endpoint")
      .map((source) => source.sourceFamily),
    blocked_on_activation_or_confirmation: sourceReadiness
      .filter((source) => source.category === "blocked_on_activation_or_confirmation")
      .map((source) => source.sourceFamily),
    "context-only": sourceReadiness
      .filter((source) => source.category === "context-only")
      .map((source) => source.sourceFamily),
  };
}

function summarizeInputs(inputs: Record<ArtifactKey, unknown | null>): Record<ArtifactKey, ArtifactSummary> {
  return {
    crelesLocalBenchmark: summarizeArtifact("creles-local-benchmark.latest.json", inputs.crelesLocalBenchmark),
    haalsiSourceFeasibility: summarizeArtifact(
      "haalsi-source-feasibility.latest.json",
      inputs.haalsiSourceFeasibility,
    ),
    midusCoreBenchmark: summarizeArtifact("midus2-local-benchmark.latest.json", inputs.midusCoreBenchmark),
    midusRefresherBenchmark: summarizeArtifact(
      "r399-midus-refresher-biomarker-increment.latest.json",
      inputs.midusRefresherBenchmark,
    ),
    r612NhanesLayeringMap: summarizeArtifact(
      "r612-nhanes-layering-map.latest.json",
      inputs.r612NhanesLayeringMap,
    ),
    r614MhasSourceRightsActivationLabels: summarizeArtifact(
      "r614-mhas-source-rights-activation-labels.latest.json",
      inputs.r614MhasSourceRightsActivationLabels,
    ),
    r614NshapActivationLabels: summarizeArtifact(
      "r614-nshap-activation-labels.latest.json",
      inputs.r614NshapActivationLabels,
    ),
    r615CrossSourceActivationMatrix: summarizeArtifact(
      "r615-cross-source-activation-matrix.latest.json",
      inputs.r615CrossSourceActivationMatrix,
    ),
    r987CrelesGlycemiaReceiptReducer: summarizeArtifact(
      "r987-creles-glycemia-receipt-reducer.latest.json",
      inputs.r987CrelesGlycemiaReceiptReducer,
    ),
    r992NshapFunctionCognitionScaffold: summarizeArtifact(
      "r992-nshap-function-cognition-scaffold.latest.json",
      inputs.r992NshapFunctionCognitionScaffold,
    ),
    sageSourceFeasibility: summarizeArtifact("sage-source-feasibility.latest.json", inputs.sageSourceFeasibility),
  };
}

function summarizeArtifact(artifact: string, value: unknown | null): ArtifactSummary {
  if (!value) return { artifact, packetId: null, schemaVersion: null, status: "missing" };
  const root = requiredRecord(value, artifact);
  return {
    artifact,
    packetId: optionalMetadataLabel(root.packetId, `${artifact} packet id`)
      ?? optionalMetadataLabel(root.benchmarkId, `${artifact} benchmark id`)
      ?? optionalMetadataLabel(root.manifestId, `${artifact} manifest id`),
    schemaVersion: optionalMetadataLabel(root.schemaVersion, `${artifact} schema version`),
    status: "available",
  };
}

function readSourceRows(value: unknown | null): Map<string, Record<string, unknown>> {
  const rows = readRecordArray(optionalRecord(value)?.sourceRows, false);
  const bySource = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const source = optionalMetadataLabel(row.sourceFamily, "source family");
    if (source) bySource.set(source, row);
  }
  return bySource;
}

function validateInputBoundaries(inputs: Record<ArtifactKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) continue;
    const record = requiredRecord(value, key);
    const boundary = optionalRecord(record.boundary)
      ?? optionalRecord(record.artifactBoundary)
      ?? optionalRecord(record.incrementEvaluationCard && optionalRecord(record.incrementEvaluationCard)?.outputBoundary);
    if (!boundary) continue;
    for (const [flag, flagValue] of Object.entries(boundary)) {
      if (flag === "aggregateOnly") continue;
      if ((flag.endsWith("Stored") || flag.endsWith("Included") || flag.endsWith("Authorized")) && flagValue !== false) {
        throw new Error(`${key} boundary has unsafe boundary flag ${flag}`);
      }
    }
  }
}

function findForbiddenR994Output(value: R994ExpandedSourceCacheReadinessOutput): string[] {
  const forbidden = [
    "caseid",
    "codebook",
    "coefficient",
    "localpath",
    "participantid",
    "predictionbyid",
    "rawrow",
    "rowvalue",
    "smallcell",
    "sourcebody",
    "sourceprose",
    "sourcetext",
    "variablelabel",
    "variablename",
  ];
  const findings: string[] = [];
  function visit(node: unknown): void {
    if (typeof node === "string") {
      const normalized = node.toLowerCase().replace(/[_\s-]+/gu, "");
      for (const token of forbidden) {
        if (normalized.includes(token)) findings.push(`forbidden string token ${token}`);
      }
      return;
    }
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    Object.values(node).forEach(visit);
  }
  visit(value);
  return findings;
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (optionalRecord(error)?.code === "ENOENT") return null;
    throw new Error("Failed to read R994 aggregate input artifact.");
  }
}

function readRecordArray(value: unknown, required = true): Record<string, unknown>[] {
  if (value === undefined || value === null) {
    if (required) throw new Error("Expected an object array.");
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new Error("Expected an object array.");
  }
  return value as Record<string, unknown>[];
}

function readAt(value: unknown, pathSegments: string[]): unknown {
  let current = value;
  for (const segment of pathSegments) {
    const record = optionalRecord(current);
    if (!record) return null;
    current = record[segment];
  }
  return current;
}

function readStringAt(value: unknown, pathSegments: string[]): string | null {
  return optionalMetadataLabel(readAt(value, pathSegments), pathSegments.join("."));
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
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
  if (typeof value !== "string") throw new Error(`${label} must be a metadata label.`);
  if (!/^[A-Za-z0-9][A-Za-z0-9 _./:-]*$/u.test(value)) {
    throw new Error(`${label} contains unsupported characters.`);
  }
  if (value.includes("/") && !value.endsWith(".json")) throw new Error(`${label} must not contain path-like text.`);
  return value;
}

function countBand(count: number): string {
  if (count <= 0) return "0";
  if (count <= 4) return "1-4";
  if (count <= 9) return "5-9";
  if (count <= 24) return "10-24";
  if (count <= 99) return "25-99";
  if (count <= 999) return "100-999";
  return "1000+";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR994ExpandedSourceCacheReadiness({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    sourceCacheRoot: process.env.MURPH_AGE_SOURCE_CACHE_ROOT,
  }).then(({ output }) => {
    process.stdout.write(`${JSON.stringify({
      artifact: OUTPUT_FILE_NAME,
      fastestLaneNow: output.summary.fastestLaneNow,
      packetId: output.packetId,
      productDisplayAuthorized: output.summary.productDisplayAuthorized,
      schemaVersion: output.schemaVersion,
      scoreBearingComplete: output.categoryBuckets["score-bearing_complete"],
      sourcePriorityVerdict: output.summary.sourcePriorityVerdict,
      status: output.status,
    })}\n`);
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
