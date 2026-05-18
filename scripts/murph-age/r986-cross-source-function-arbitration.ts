import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R986_CROSS_SOURCE_FUNCTION_ARBITRATION_SCHEMA_VERSION =
  "murph-age-r986-cross-source-function-arbitration.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_AUTORESEARCH_ROOT = path.join(
  "output-packages",
  "research",
  "murph-age",
  "autoresearch",
);
const DEFAULT_LOOP_RUNS_DIR = path.join(DEFAULT_AUTORESEARCH_ROOT, "loop", "runs");
const DEFAULT_R747_FUNCTION_FAMILY_PATH = path.join(
  DEFAULT_AUTORESEARCH_ROOT,
  "loop",
  "contracts",
  "function-frailty-five-source-reduction-r747.v0.json",
);
const DEFAULT_R984_REDUCTION_PATH = path.join(
  DEFAULT_AUTORESEARCH_ROOT,
  "reviewgpt",
  "reduced",
  "r984-expanded-data-acceleration-summary.json",
);
const DEFAULT_R985_REDUCTION_PATH = path.join(
  DEFAULT_AUTORESEARCH_ROOT,
  "reviewgpt",
  "reduced",
  "r985-mhas-result-next-loop-summary.json",
);
const OUTPUT_FILE_NAME = "r986-cross-source-function-arbitration.latest.json";

type ArtifactKey =
  | "r747FunctionFamilyFiveSourceReduction"
  | "r773NshapSingleDomainBreakdown"
  | "r770NshapFunctionCognitionExternalRepeat"
  | "r740CrelesFunctionCrossSourceRepeat"
  | "r746MidusCoreFunctionCrossSourceRepeat"
  | "r738MidusRefresherFunctionCrossSourceRepeat"
  | "r980MhasFunctionDisabilityAggregateReducer"
  | "r983CurrentCandidateFamilyState"
  | "r984ExpandedDataAccelerationReduction"
  | "r985MhasResultNextLoopReduction";
type ArtifactStatus = "available" | "missing";
type SourceFamily = "MHAS" | "NSHAP" | "CRELES" | "MIDUS_CORE_M2" | "MIDUS_REFRESHER";
type SupportStatus = "supportive" | "weak_support" | "missing_or_blocked" | "contradictory";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: ArtifactStatus;
}

interface MetricDeltaPair {
  brierVsReference: number | null;
  brierVsShuffleMedian: number | null;
  cVsReference: number | null;
  cVsShuffleMedian: number | null;
}

interface FunctionRateSet {
  brierBeatsAllShuffles: number | null;
  brierBeatsReference: number | null;
  brierBeatsShuffleMedian: number | null;
  cBeatsAllShuffles: number | null;
  cBeatsReference: number | null;
  cBeatsShuffleMedian: number | null;
}

interface FunctionSourceEvidence {
  evidenceClass: string;
  functionMedianDeltas: MetricDeltaPair;
  functionRates: FunctionRateSet;
  notes: string[];
  sourceFamily: SourceFamily;
  supportClassification: string | null;
  supportStatus: SupportStatus;
}

export interface R986CrossSourceFunctionArbitrationOptions {
  createdAt?: string;
  crelesFunctionPath?: string;
  midusCoreFunctionPath?: string;
  midusRefresherFunctionPath?: string;
  nshapCombinedPath?: string;
  nshapSingleDomainPath?: string;
  outputDir?: string;
  r747FunctionFamilyPath?: string;
  r980Path?: string;
  r983Path?: string;
  r984ReductionPath?: string;
  r985ReductionPath?: string;
}

export interface R986CrossSourceFunctionArbitrationOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookProseStored: false;
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
    rowParsingPerformedByR986: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
    variableLabelsStored: false;
    variableListsStored: false;
    variableNamesStored: false;
  };
  arbitration: {
    caveats: string[];
    demotionTriggers: string[];
    functionDisabilityVerdict:
      | "portable_diagnostic_sidecar_supported"
      | "hold_pending_cross_source_support";
    portabilitySignals: string[];
    sourceSupportSummary: {
      negativeFunctionBrierDeltaCount: number;
      positiveFunctionCDeltaCount: number;
      sourceCount: number;
      supportiveSourceCount: number;
      weakerSourceLabels: string[];
    };
  };
  createdAt: string;
  evidenceInputs: Record<SourceFamily, FunctionSourceEvidence>;
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  modelDirection: {
    baseAnchor: "nhis_r399_frozen_research_anchor";
    currentLeadFamily: "function_disability" | "none";
    domainOrdering: Array<{
      domain: string;
      status: string;
    }>;
    displayPolicy: "no_user_facing_age_display";
    researchOnly: true;
  };
  nextLoops: Array<{
    loopId: string;
    priority: "p0_now" | "p1_next" | "p2_hold";
    purpose: string;
    reviewGptRole: "none_local_aggregate_work" | "high_value_result_review";
    status: "runnable_now" | "blocked_until_activation_labels" | "hold_for_future_validation";
  }>;
  packetId: "r986-cross-source-function-arbitration";
  reviewGptPacket: {
    readyForChorus: boolean;
    reviewerQuestion: string;
    suggestedLens: string[];
  };
  schemaVersion: typeof R986_CROSS_SOURCE_FUNCTION_ARBITRATION_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    currentLeadFamily: "function_disability" | "none";
    nextLocalLoop: "mhas_anchor_increment_check" | "nshap_activation_label_completion";
    productDisplayAuthorized: false;
    reviewGptNextUse: "r986_model_direction_chorus";
    verdict:
      | "function_disability_portable_diagnostic_sidecar_supported"
      | "function_disability_hold_pending_support";
  };
}

export async function runR986CrossSourceFunctionArbitration(
  options: R986CrossSourceFunctionArbitrationOptions = {},
): Promise<{ output: R986CrossSourceFunctionArbitrationOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const evidenceInputs: Record<SourceFamily, FunctionSourceEvidence> = {
    MHAS: summarizeMhasFunction(inputs.r980MhasFunctionDisabilityAggregateReducer),
    NSHAP: summarizeNshapFunction(inputs.r773NshapSingleDomainBreakdown, inputs.r770NshapFunctionCognitionExternalRepeat),
    CRELES: summarizeGenericFunction("CRELES", "non_us_transport_stress", inputs.r740CrelesFunctionCrossSourceRepeat),
    MIDUS_CORE_M2: summarizeGenericFunction("MIDUS_CORE_M2", "biomarker_transport_same_program", inputs.r746MidusCoreFunctionCrossSourceRepeat),
    MIDUS_REFRESHER: summarizeGenericFunction(
      "MIDUS_REFRESHER",
      "biomarker_transport_refresher",
      inputs.r738MidusRefresherFunctionCrossSourceRepeat,
    ),
  };
  const sourceSupportSummary = summarizeSourceSupport(evidenceInputs);
  const functionSupported = sourceSupportSummary.supportiveSourceCount >= 4
    && sourceSupportSummary.positiveFunctionCDeltaCount >= 4
    && sourceSupportSummary.negativeFunctionBrierDeltaCount >= 4;
  const currentLeadFamily = readStringAt(inputs.r983CurrentCandidateFamilyState, ["summary", "currentLeadFamily"]) === "function_disability"
    ? "function_disability"
    : "none";
  const nshapFreshBlocked = readStringAt(inputs.r983CurrentCandidateFamilyState, [
    "candidateFamilies",
    "cognition",
    "status",
  ]) === "diagnostic_only_pending_nshap";

  const output: R986CrossSourceFunctionArbitrationOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookProseStored: false,
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
      rowParsingPerformedByR986: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableListsStored: false,
      variableNamesStored: false,
    },
    arbitration: {
      caveats: [
        "function_disability_is_diagnostic_sidecar_not_product_age",
        "nshap_fresh_execution_still_requires_activation_labels",
        "midus_refresher_support_is_directional_but_shuffle_all_source_rates_are_weaker",
        "do_not_refit_or_replace_frozen_nhis_anchor_from_sidecar_diagnostics",
      ],
      demotionTriggers: [
        "fresh_nshap_function_cognition_contradicts_mhas_direction",
        "mhas_anchor_increment_check_shows_no_increment_over_frozen_anchor",
        "future_external_source_reverses_brier_or_calibration_direction",
        "domain_gain_appears_to_be_age_mimicry_or_source_specific_qc",
      ],
      functionDisabilityVerdict: functionSupported
        ? "portable_diagnostic_sidecar_supported"
        : "hold_pending_cross_source_support",
      portabilitySignals: portabilitySignals({ evidenceInputs, functionSupported, nshapFreshBlocked }),
      sourceSupportSummary,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    evidenceInputs,
    inputArtifacts: summarizeInputs(inputs),
    modelDirection: {
      baseAnchor: "nhis_r399_frozen_research_anchor",
      currentLeadFamily,
      displayPolicy: "no_user_facing_age_display",
      domainOrdering: [
        {
          domain: "function_disability",
          status: functionSupported ? "lead_diagnostic_sidecar_candidate" : "hold_diagnostic_only",
        },
        {
          domain: "cognition",
          status: "adjacent_shadow_domain_pending_fresh_nshap_arbitration",
        },
        {
          domain: "glycemia_body",
          status: "frozen_small_future_validation_candidate",
        },
        {
          domain: "broad_biomarkers",
          status: "not_promoted_transport_unconfirmed",
        },
        {
          domain: "wearables_sleep_activity",
          status: "shadow_only",
        },
      ],
      researchOnly: true,
    },
    nextLoops: buildNextLoops({ functionSupported, nshapFreshBlocked }),
    packetId: "r986-cross-source-function-arbitration",
    reviewGptPacket: {
      readyForChorus: true,
      reviewerQuestion:
        "Given the aggregate-only cross-source arbitration, should function/disability remain the lead diagnostic sidecar, and what single next executable model loop improves generalization fastest without widening the architecture?",
      suggestedLens: [
        "scientific_generalization_skeptic",
        "simple_model_architecture_keeper",
        "external_validation_operator",
      ],
    },
    schemaVersion: R986_CROSS_SOURCE_FUNCTION_ARBITRATION_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      currentLeadFamily,
      nextLocalLoop: functionSupported ? "mhas_anchor_increment_check" : "nshap_activation_label_completion",
      productDisplayAuthorized: false,
      reviewGptNextUse: "r986_model_direction_chorus",
      verdict: functionSupported
        ? "function_disability_portable_diagnostic_sidecar_supported"
        : "function_disability_hold_pending_support",
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R986 cross-source function arbitration failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(
  options: R986CrossSourceFunctionArbitrationOptions,
): Promise<Record<ArtifactKey, unknown | null>> {
  return {
    r747FunctionFamilyFiveSourceReduction: await readJsonIfPresent(
      options.r747FunctionFamilyPath ?? DEFAULT_R747_FUNCTION_FAMILY_PATH,
    ),
    r773NshapSingleDomainBreakdown: await readJsonIfPresent(
      options.nshapSingleDomainPath
        ?? path.join(
          DEFAULT_LOOP_RUNS_DIR,
          "session_murph_age_r773_nshap_single_domain_breakdown",
          "nshap-single-domain-breakdown-r773.json",
        ),
    ),
    r770NshapFunctionCognitionExternalRepeat: await readJsonIfPresent(
      options.nshapCombinedPath
        ?? path.join(
          DEFAULT_LOOP_RUNS_DIR,
          "session_murph_age_r770_nshap_function_cognition_external_repeat",
          "nshap-function-cognition-external-repeat-r770.json",
        ),
    ),
    r740CrelesFunctionCrossSourceRepeat: await readJsonIfPresent(
      options.crelesFunctionPath
        ?? path.join(
          DEFAULT_LOOP_RUNS_DIR,
          "session_murph_age_r740_creles_function_cross_source_repeat",
          "creles-function-cross-source-repeat-r740.json",
        ),
    ),
    r746MidusCoreFunctionCrossSourceRepeat: await readJsonIfPresent(
      options.midusCoreFunctionPath
        ?? path.join(
          DEFAULT_LOOP_RUNS_DIR,
          "session_murph_age_r746_midus_core_m2_function_cross_source_repeat",
          "midus-core-m2-function-cross-source-repeat-r746.json",
        ),
    ),
    r738MidusRefresherFunctionCrossSourceRepeat: await readJsonIfPresent(
      options.midusRefresherFunctionPath
        ?? path.join(
          DEFAULT_LOOP_RUNS_DIR,
          "session_murph_age_r738_midus_refresher_function_cross_source_repeat",
          "midus-refresher-function-cross-source-repeat-r738.json",
        ),
    ),
    r980MhasFunctionDisabilityAggregateReducer: await readJsonIfPresent(
      options.r980Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r980-mhas-function-disability-aggregate-reducer.latest.json"),
    ),
    r983CurrentCandidateFamilyState: await readJsonIfPresent(
      options.r983Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r983-current-candidate-family-state.latest.json"),
    ),
    r984ExpandedDataAccelerationReduction: await readJsonIfPresent(options.r984ReductionPath ?? DEFAULT_R984_REDUCTION_PATH),
    r985MhasResultNextLoopReduction: await readJsonIfPresent(options.r985ReductionPath ?? DEFAULT_R985_REDUCTION_PATH),
  };
}

function summarizeMhasFunction(value: unknown | null): FunctionSourceEvidence {
  return {
    evidenceClass: "fresh_current_mhas_aggregate",
    functionMedianDeltas: {
      brierVsReference: readNumberAt(value, ["aggregateResult", "medianDeltas", "functionMinusRawBrier", "median"]),
      brierVsShuffleMedian:
        readNumberAt(value, ["aggregateResult", "medianDeltas", "functionMinusShuffleMedianBrier", "median"]),
      cVsReference: readNumberAt(value, ["aggregateResult", "medianDeltas", "functionMinusRawC", "median"]),
      cVsShuffleMedian: readNumberAt(value, ["aggregateResult", "medianDeltas", "functionMinusShuffleMedianC", "median"]),
    },
    functionRates: {
      brierBeatsAllShuffles: readNumberAt(value, ["aggregateResult", "keyRates", "functionBrierBeatsAllShufflesRate"]),
      brierBeatsReference: readNumberAt(value, ["aggregateResult", "keyRates", "functionBrierBeatsRawRate"]),
      brierBeatsShuffleMedian: readNumberAt(value, ["aggregateResult", "keyRates", "functionBrierBeatsShuffleMedianRate"]),
      cBeatsAllShuffles: readNumberAt(value, ["aggregateResult", "keyRates", "functionCBeatsAllShufflesRate"]),
      cBeatsReference: readNumberAt(value, ["aggregateResult", "keyRates", "functionCBeatsRawRate"]),
      cBeatsShuffleMedian: readNumberAt(value, ["aggregateResult", "keyRates", "functionCBeatsShuffleMedianRate"]),
    },
    notes: ["current_fresh_mhas_loop_supportive", "effect_size_c_statistic_small_but_directionally_consistent"],
    sourceFamily: "MHAS",
    supportClassification: readStringAt(value, ["aggregateResult", "supportClassification"]),
    supportStatus: classifySupport(value, ["aggregateResult", "supportClassification"], "function"),
  };
}

function summarizeNshapFunction(singleDomain: unknown | null, combined: unknown | null): FunctionSourceEvidence {
  const classification = readStringAt(singleDomain, ["support_classification"]);
  return {
    evidenceClass: "historical_nshap_diagnostic_activation_blocked_for_fresh_execution",
    functionMedianDeltas: {
      brierVsReference: readNumberAt(singleDomain, ["delta_summaries", "function_minus_intercept_brier", "median"]),
      brierVsShuffleMedian: readNumberAt(singleDomain, [
        "delta_summaries",
        "function_minus_shuffle_median_brier",
        "median",
      ]),
      cVsReference: readNumberAt(singleDomain, ["delta_summaries", "function_minus_intercept_c", "median"]),
      cVsShuffleMedian: readNumberAt(singleDomain, ["delta_summaries", "function_minus_shuffle_median_c", "median"]),
    },
    functionRates: {
      brierBeatsAllShuffles: readNumberAt(singleDomain, ["key_rates", "function_brier_beats_all_shuffles_rate"]),
      brierBeatsReference: readNumberAt(singleDomain, ["key_rates", "function_brier_beats_intercept_rate"]),
      brierBeatsShuffleMedian: readNumberAt(singleDomain, ["key_rates", "function_brier_beats_shuffle_median_rate"]),
      cBeatsAllShuffles: readNumberAt(singleDomain, ["key_rates", "function_c_beats_all_shuffles_rate"]),
      cBeatsReference: readNumberAt(singleDomain, ["key_rates", "function_c_beats_intercept_rate"]),
      cBeatsShuffleMedian: readNumberAt(singleDomain, ["key_rates", "function_c_beats_shuffle_median_rate"]),
    },
    notes: [
      "prior_nshap_single_domain_function_supportive",
      combined && typeof combined === "object" ? "prior_nshap_function_cognition_combined_supportive" : "combined_artifact_missing",
      "fresh_nshap_execution_still_activation_blocked",
    ],
    sourceFamily: "NSHAP",
    supportClassification: classification,
    supportStatus: classifySupport(singleDomain, ["support_classification"], "function"),
  };
}

function summarizeGenericFunction(
  sourceFamily: Exclude<SourceFamily, "MHAS" | "NSHAP">,
  evidenceClass: string,
  value: unknown | null,
): FunctionSourceEvidence {
  const cAll = readNumberAt(value, ["key_rates", "function_c_beats_all_shuffles_rate"]);
  const brierAll = readNumberAt(value, ["key_rates", "function_brier_beats_all_shuffles_rate"]);
  const weaker = (cAll !== null && cAll < 0.9) || (brierAll !== null && brierAll < 0.9);
  return {
    evidenceClass,
    functionMedianDeltas: {
      brierVsReference: readNumberAt(value, ["delta_summaries", "function_minus_raw_brier", "median"])
        ?? readNumberAt(value, ["delta_summaries", "function_minus_intercept_brier", "median"]),
      brierVsShuffleMedian: readNumberAt(value, ["delta_summaries", "function_minus_shuffle_median_brier", "median"]),
      cVsReference: readNumberAt(value, ["delta_summaries", "function_minus_raw_c", "median"])
        ?? readNumberAt(value, ["delta_summaries", "function_minus_intercept_c", "median"]),
      cVsShuffleMedian: readNumberAt(value, ["delta_summaries", "function_minus_shuffle_median_c", "median"]),
    },
    functionRates: {
      brierBeatsAllShuffles: brierAll,
      brierBeatsReference: readNumberAt(value, ["key_rates", "function_brier_beats_raw_rate"])
        ?? readNumberAt(value, ["key_rates", "function_brier_beats_intercept_rate"]),
      brierBeatsShuffleMedian: readNumberAt(value, ["key_rates", "function_brier_beats_shuffle_median_rate"]),
      cBeatsAllShuffles: cAll,
      cBeatsReference: readNumberAt(value, ["key_rates", "function_c_beats_raw_rate"])
        ?? readNumberAt(value, ["key_rates", "function_c_beats_intercept_rate"]),
      cBeatsShuffleMedian: readNumberAt(value, ["key_rates", "function_c_beats_shuffle_median_rate"]),
    },
    notes: weaker ? ["directionally_supportive_but_weaker_shuffle_all_rates"] : ["directionally_supportive"],
    sourceFamily,
    supportClassification: readStringAt(value, ["support_classification"]),
    supportStatus: classifySupport(value, ["support_classification"], "function"),
  };
}

function summarizeSourceSupport(
  evidenceInputs: Record<SourceFamily, FunctionSourceEvidence>,
): R986CrossSourceFunctionArbitrationOutput["arbitration"]["sourceSupportSummary"] {
  const sources = Object.values(evidenceInputs);
  return {
    negativeFunctionBrierDeltaCount: sources.filter((source) =>
      typeof source.functionMedianDeltas.brierVsReference === "number" && source.functionMedianDeltas.brierVsReference < 0
    ).length,
    positiveFunctionCDeltaCount: sources.filter((source) =>
      typeof source.functionMedianDeltas.cVsReference === "number" && source.functionMedianDeltas.cVsReference > 0
    ).length,
    sourceCount: sources.length,
    supportiveSourceCount: sources.filter((source) =>
      source.supportStatus === "supportive" || source.supportStatus === "weak_support"
    ).length,
    weakerSourceLabels: sources
      .filter((source) => source.supportStatus === "weak_support")
      .map((source) => source.sourceFamily),
  };
}

function portabilitySignals(input: {
  evidenceInputs: Record<SourceFamily, FunctionSourceEvidence>;
  functionSupported: boolean;
  nshapFreshBlocked: boolean;
}): string[] {
  const signals = [
    input.functionSupported
      ? "five_source_directional_function_support_present"
      : "five_source_function_support_not_yet_sufficient",
    "mhas_current_fresh_loop_supports_lead_sidecar",
    "creles_and_midus_function_diagnostics_support_transport_stress",
    "nshap_prior_function_cognition_supports_adjacent_confirmation",
  ];
  if (input.nshapFreshBlocked) signals.push("fresh_nshap_execution_is_next_activation_limited_step");
  return signals;
}

function buildNextLoops(input: {
  functionSupported: boolean;
  nshapFreshBlocked: boolean;
}): R986CrossSourceFunctionArbitrationOutput["nextLoops"] {
  return [
    {
      loopId: "mhas_anchor_increment_check",
      priority: input.functionSupported ? "p0_now" : "p1_next",
      purpose: "Test whether the lead function/disability sidecar adds increment around the frozen NHIS/R399 anchor rather than only age-like or source-QC signal.",
      reviewGptRole: "none_local_aggregate_work",
      status: "runnable_now",
    },
    {
      loopId: "nshap_activation_then_function_cognition",
      priority: input.nshapFreshBlocked ? "p1_next" : "p0_now",
      purpose: "Refresh the strongest independent function/cognition sidecar check once source-rights and aggregate-output labels are complete.",
      reviewGptRole: "none_local_aggregate_work",
      status: input.nshapFreshBlocked ? "blocked_until_activation_labels" : "runnable_now",
    },
    {
      loopId: "r986_reviewgpt_model_direction_chorus",
      priority: "p1_next",
      purpose: "Ask ReviewGPT to critique the cross-source direction and choose the next meaningful model loop, not implementation checklists.",
      reviewGptRole: "high_value_result_review",
      status: "runnable_now",
    },
    {
      loopId: "compact_glycemia_body_future_validation",
      priority: "p2_hold",
      purpose: "Keep the small glycemia/body candidate frozen until a clean independent validation opportunity is ready.",
      reviewGptRole: "high_value_result_review",
      status: "hold_for_future_validation",
    },
  ];
}

function classifySupport(value: unknown | null, classificationPath: string[], prefix: "function"): SupportStatus {
  const classification = readStringAt(value, classificationPath);
  if (!classification) return "missing_or_blocked";
  const lower = classification.toLowerCase();
  if (lower.includes("inconclusive") || lower.includes("blocked") || lower.includes("hold")) return "missing_or_blocked";
  if (!lower.includes("supportive") && !lower.includes("concordant")) return "contradictory";

  const cReference = readNumberAt(value, ["key_rates", `${prefix}_c_beats_raw_rate`])
    ?? readNumberAt(value, ["key_rates", `${prefix}_c_beats_intercept_rate`])
    ?? readNumberAt(value, ["aggregateResult", "keyRates", "functionCBeatsRawRate"]);
  const brierReference = readNumberAt(value, ["key_rates", `${prefix}_brier_beats_raw_rate`])
    ?? readNumberAt(value, ["key_rates", `${prefix}_brier_beats_intercept_rate`])
    ?? readNumberAt(value, ["aggregateResult", "keyRates", "functionBrierBeatsRawRate"]);
  const cAll = readNumberAt(value, ["key_rates", `${prefix}_c_beats_all_shuffles_rate`])
    ?? readNumberAt(value, ["aggregateResult", "keyRates", "functionCBeatsAllShufflesRate"]);
  const brierAll = readNumberAt(value, ["key_rates", `${prefix}_brier_beats_all_shuffles_rate`])
    ?? readNumberAt(value, ["aggregateResult", "keyRates", "functionBrierBeatsAllShufflesRate"]);
  if (
    (typeof cReference === "number" && cReference < 0.8)
    || (typeof brierReference === "number" && brierReference < 0.8)
  ) {
    return "contradictory";
  }
  if (
    (typeof cAll === "number" && cAll < 0.9)
    || (typeof brierAll === "number" && brierAll < 0.9)
  ) {
    return "weak_support";
  }
  return "supportive";
}

function validateInputBoundaries(inputs: Record<ArtifactKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (value === null) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R986 input ${key} failed aggregate boundary validation: ${findings.join("; ")}`);
    }
  }
}

function summarizeInputs(inputs: Record<ArtifactKey, unknown | null>): Record<ArtifactKey, ArtifactSummary> {
  return {
    r747FunctionFamilyFiveSourceReduction:
      summarizeArtifact("function-frailty-five-source-reduction-r747.v0.json", inputs.r747FunctionFamilyFiveSourceReduction),
    r773NshapSingleDomainBreakdown:
      summarizeArtifact("nshap-single-domain-breakdown-r773.json", inputs.r773NshapSingleDomainBreakdown),
    r770NshapFunctionCognitionExternalRepeat:
      summarizeArtifact("nshap-function-cognition-external-repeat-r770.json", inputs.r770NshapFunctionCognitionExternalRepeat),
    r740CrelesFunctionCrossSourceRepeat:
      summarizeArtifact("creles-function-cross-source-repeat-r740.json", inputs.r740CrelesFunctionCrossSourceRepeat),
    r746MidusCoreFunctionCrossSourceRepeat:
      summarizeArtifact("midus-core-m2-function-cross-source-repeat-r746.json", inputs.r746MidusCoreFunctionCrossSourceRepeat),
    r738MidusRefresherFunctionCrossSourceRepeat:
      summarizeArtifact("midus-refresher-function-cross-source-repeat-r738.json", inputs.r738MidusRefresherFunctionCrossSourceRepeat),
    r980MhasFunctionDisabilityAggregateReducer:
      summarizeArtifact("r980-mhas-function-disability-aggregate-reducer.latest.json", inputs.r980MhasFunctionDisabilityAggregateReducer),
    r983CurrentCandidateFamilyState:
      summarizeArtifact("r983-current-candidate-family-state.latest.json", inputs.r983CurrentCandidateFamilyState),
    r984ExpandedDataAccelerationReduction:
      summarizeArtifact("r984-expanded-data-acceleration-summary.json", inputs.r984ExpandedDataAccelerationReduction),
    r985MhasResultNextLoopReduction:
      summarizeArtifact("r985-mhas-result-next-loop-summary.json", inputs.r985MhasResultNextLoopReduction),
  };
}

function summarizeArtifact(artifact: string, value: unknown | null): ArtifactSummary {
  if (!value) return { artifact, packetId: null, schemaVersion: null, status: "missing" };
  return {
    artifact,
    packetId: readStringAt(value, ["packetId"])
      ?? readStringAt(value, ["run_id"])
      ?? readStringAt(value, ["schema_version"]),
    schemaVersion: readStringAt(value, ["schemaVersion"]) ?? readStringAt(value, ["schema_version"]),
    status: "available",
  };
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") return null;
    throw new Error("R986 failed to read an aggregate input artifact.");
  }
}

function readNumberAt(value: unknown | null, keys: string[]): number | null {
  const found = readAt(value, keys);
  return typeof found === "number" && Number.isFinite(found) ? found : null;
}

function readStringAt(value: unknown | null, keys: string[]): string | null {
  const found = readAt(value, keys);
  return typeof found === "string" && found.length > 0 ? found : null;
}

function readAt(value: unknown | null, keys: string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

async function main(): Promise<void> {
  const { output } = await runR986CrossSourceFunctionArbitration({
    crelesFunctionPath: process.env.MURPH_AGE_R740_CRELES_FUNCTION_PATH,
    midusCoreFunctionPath: process.env.MURPH_AGE_R746_MIDUS_CORE_FUNCTION_PATH,
    midusRefresherFunctionPath: process.env.MURPH_AGE_R738_MIDUS_REFRESHER_FUNCTION_PATH,
    nshapCombinedPath: process.env.MURPH_AGE_R770_NSHAP_COMBINED_PATH,
    nshapSingleDomainPath: process.env.MURPH_AGE_R773_NSHAP_SINGLE_DOMAIN_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r747FunctionFamilyPath: process.env.MURPH_AGE_R747_FUNCTION_FAMILY_PATH,
    r980Path: process.env.MURPH_AGE_R980_MHAS_FUNCTION_PATH,
    r983Path: process.env.MURPH_AGE_R983_CANDIDATE_STATE_PATH,
    r984ReductionPath: process.env.MURPH_AGE_R984_REDUCTION_PATH,
    r985ReductionPath: process.env.MURPH_AGE_R985_REDUCTION_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    artifact: OUTPUT_FILE_NAME,
    currentLeadFamily: output.summary.currentLeadFamily,
    nextLocalLoop: output.summary.nextLocalLoop,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    schemaVersion: output.schemaVersion,
    status: output.status,
    supportiveSourceCount: output.arbitration.sourceSupportSummary.supportiveSourceCount,
    verdict: output.summary.verdict,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {
    process.stderr.write("R986 cross-source function arbitration failed.\n");
    process.exitCode = 1;
  });
}
