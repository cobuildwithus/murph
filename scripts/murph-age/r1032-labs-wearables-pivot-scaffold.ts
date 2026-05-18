import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1032_LABS_WEARABLES_PIVOT_SCAFFOLD_SCHEMA_VERSION =
  "murph-age-r1032-labs-wearables-pivot-scaffold.v1" as const;

const INTEGRATED_BENCHMARK_CARD_SCHEMA_VERSION =
  "murph.age.integrated-benchmark-card.v1" as const;
const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1032-labs-wearables-pivot-scaffold.latest.json";

type AccessLane = "public_local" | "free_registered_local" | "controlled_workbench" | "partner_aggregate";
type CandidateRole = "score_bearing_research_candidate" | "negative_control" | "reference_only";
type LoopId =
  | "nhanes_lab_activity_mortality_v1"
  | "external_lab_transport_v1"
  | "partner_integrated_wearable_lab_evaluator_v1";
type ReviewGptUse = "source_priority" | "model_architecture" | "candidate_family_gates" | "aggregate_result_interpretation";

interface CandidateFamily {
  candidateId: string;
  role: CandidateRole;
  status: "predeclared_not_run" | "shadow_only_until_validation" | "reference_not_promotion_target";
}

interface BenchmarkCard {
  accessLane: AccessLane;
  aggregateOutputBoundary: {
    allowed: string[];
    blocked: string[];
    minimumCellPolicy: string;
  };
  benchmarkCardId: LoopId;
  calibrationPlan: string[];
  candidateFamilies: CandidateFamily[];
  censoringPolicy: string;
  comparatorModels: string[];
  coverageQualityPlan: string[];
  endpointHeads: string[];
  featureFamilies: string[];
  horizonPolicy: string;
  metricPlan: string[];
  missingnessPlan: string[];
  negativeControls: string[];
  productDisplayAuthorized: false;
  promotionGates: string[];
  schemaVersion: typeof INTEGRATED_BENCHMARK_CARD_SCHEMA_VERSION;
  sourceRoute: string;
  splitPlan: string[];
  subgroupPromotionBlockers: string[];
  surveyWeightPolicy: string;
}

export interface R1032LabsWearablesPivotScaffoldOptions {
  createdAt?: string;
  outputDir?: string;
}

export interface R1032LabsWearablesPivotScaffoldOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookProseStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformed: false;
    participantIdentifiersStored: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1032: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceProseStored: false;
    splitMembershipStored: false;
  };
  benchmarkCards: BenchmarkCard[];
  createdAt: string;
  modelArchitecture: {
    ageDisplayPolicy: {
      displayAuthorized: false;
      rule: string;
    };
    anchorPolicy: {
      anchorId: "nhis_r399_style_outcome_risk_anchor";
      allowedUse: string[];
      blockedUse: string[];
      crosswalkRule: string;
      status: "frozen_reference_backbone";
    };
    calibrationPolicy: string[];
    endpointHierarchy: string[];
    fairnessAndTransportPolicy: string[];
    missingnessPolicy: {
      defaultUse: string[];
      scoreBearingUseRequires: string[];
    };
    modelingPolicy: string[];
    modules: string[];
    uncertaintyPolicy: string[];
  };
  nextActions: Array<{
    actionId:
      | "create_nhanes_lab_activity_runner_scaffold"
      | "implement_aggregate_metric_reducer"
      | "implement_external_lab_transport_scaffold"
      | "implement_partner_aggregate_receipt_schema"
      | "prepare_scientific_reviewgpt_packet_after_local_scaffolds";
    owner: "local_codex" | "reviewgpt";
    status: "runnable" | "held";
    why: string;
  }>;
  packetId: "r1032-labs-wearables-pivot-scaffold";
  pivotDecision: {
    functionDisabilityStatus: "parallel_sidecar_not_main_lane";
    mainLane: "labs_activity_sleep_autonomic_outcome_risk";
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    reviewGptOperatingRule: string;
    wearableScoreBearingStatus: "shadow_until_integrated_outcome_validation";
  };
  reviewGptEvidence: {
    finalConfirmation: "APPROVE_WITH_CHANGES";
    requiredModel: "GPT-5.5 Extended Pro";
    trustedInputs: string[];
  };
  reviewGptScope: {
    askNext: ReviewGptUse[];
    doNotAsk: string[];
  };
  schemaVersion: typeof R1032_LABS_WEARABLES_PIVOT_SCAFFOLD_SCHEMA_VERSION;
  sourcePriority: {
    controlledPartnerWorkbench: Array<{
      evidenceLabel: string;
      rank: number;
      role: string;
      source: string;
    }>;
    immediatePublicLocal: Array<{
      evidenceLabel: string;
      rank: number;
      role: string;
      source: string;
    }>;
  };
  status: "research-local-scaffold-no-row-parsing";
  summary: {
    conclusion: "labs_wearables_main_lane_scaffolded_no_product_display";
    firstLoop: "nhanes_lab_activity_mortality_v1";
    productDisplayAuthorized: false;
    rowParsingPerformedByR1032: false;
  };
}

export async function runR1032LabsWearablesPivotScaffold(
  options: R1032LabsWearablesPivotScaffoldOptions = {},
): Promise<{ output: R1032LabsWearablesPivotScaffoldOutput; outputPath: string }> {
  const output: R1032LabsWearablesPivotScaffoldOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookProseStored: false,
      codebookTextStored: false,
      coefficientsStored: false,
      localFileNamesStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      outcomeScoringPerformed: false,
      participantIdentifiersStored: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR1032: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceProseStored: false,
      splitMembershipStored: false,
    },
    benchmarkCards: benchmarkCards(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    modelArchitecture: {
      ageDisplayPolicy: {
        displayAuthorized: false,
        rule: "Risk-to-age display stays locked until calibrated risk is externally validated for a declared endpoint, horizon, reference population, uncertainty interval, and abstention policy.",
      },
      anchorPolicy: {
        anchorId: "nhis_r399_style_outcome_risk_anchor",
        allowedUse: [
          "frozen baseline risk reference",
          "offset or single logit covariate when directly computable",
          "same-denominator comparator",
          "residual increment baseline",
        ],
        blockedUse: [
          "continued same-split tuning",
          "proof that labs work",
          "proof that consumer wearables work",
          "source-specific proxy projection after outcome inspection",
        ],
        crosswalkRule: "Use the frozen anchor only when required inputs are directly observed or a previously frozen validated crosswalk exists; otherwise use an age/sex/body/BP or source-clinical base comparator.",
        status: "frozen_reference_backbone",
      },
      calibrationPolicy: [
        "Report intercept, slope, expected/observed ratio, calibration curve or ICI/ECE, observed event rate, and mean predicted risk.",
        "Use weighted and unweighted Brier, log loss, calibration, and discrimination metrics for complex survey sources when feasible.",
        "Treat AUC/C-index as secondary to proper scores and calibration.",
      ],
      endpointHierarchy: [
        "all_cause_mortality",
        "major_cardiovascular_event",
        "hospitalization_or_emergency_utilization",
        "incident_cardiometabolic_disease",
        "frailty_disability_or_functional_decline_auxiliary_head",
      ],
      fairnessAndTransportPolicy: [
        "Promotion fails if calibration materially collapses in protected or operationally important groups where reportable.",
        "Check age, sex, recruitment source, geography, baseline disease burden, medication burden, healthcare access proxies, and device/provider/coverage groups when available.",
        "A positive result for one endpoint does not promote another endpoint.",
      ],
      missingnessPolicy: {
        defaultUse: [
          "eligibility",
          "abstention",
          "uncertainty widening",
          "coverage diagnostics",
          "negative controls",
        ],
        scoreBearingUseRequires: [
          "predeclared validation",
          "transport and fairness checks",
          "explicit product review before any display claim",
          "no description as biological-age effect",
        ],
      },
      modelingPolicy: [
        "Primary endpoint modeling must predeclare horizon and censoring handling.",
        "Use discrete-time survival, Cox/pooled logistic landmark models, or fixed-horizon logistic only when horizon ascertainment is complete or IPCW/landmarking is used.",
        "Start with compact regularized or spline/GAM-like candidate families before broad automated search, boosting, or neural models.",
        "Do not train to chronological-age mimicry.",
        "Do not algebraically add separately validated modules into a score-bearing product estimate without same-denominator integrated calibration evidence.",
      ],
      modules: [
        "lab_body_bp",
        "wearable_activity_sedentary",
        "sleep_recovery_autonomic",
        "missingness_quality",
        "source_calibration",
      ],
      uncertaintyPolicy: [
        "model_estimation",
        "calibration",
        "missingness",
        "wearable_coverage",
        "device_method",
        "source_transport",
        "endpoint_mismatch",
        "out_of_reference_range",
      ],
    },
    nextActions: [
      {
        actionId: "create_nhanes_lab_activity_runner_scaffold",
        owner: "local_codex",
        status: "runnable",
        why: "Loop 1 is the first executable public bridge, but row parsing remains blocked until local source files and the locked card are present.",
      },
      {
        actionId: "implement_aggregate_metric_reducer",
        owner: "local_codex",
        status: "runnable",
        why: "All three loops need the same aggregate-only metric receipt before any ReviewGPT result packet.",
      },
      {
        actionId: "implement_external_lab_transport_scaffold",
        owner: "local_codex",
        status: "runnable",
        why: "Loop 2 decides whether lab5/lab9 survives outside NHANES/NHIS-family evidence.",
      },
      {
        actionId: "implement_partner_aggregate_receipt_schema",
        owner: "local_codex",
        status: "runnable",
        why: "Loop 3 is the clean path to true consumer-wearable plus labs plus outcome validation without receiving rows.",
      },
      {
        actionId: "prepare_scientific_reviewgpt_packet_after_local_scaffolds",
        owner: "reviewgpt",
        status: "held",
        why: "ReviewGPT should critique source priority, candidate families, gates, and aggregate deltas after local scaffolds are concrete.",
      },
    ],
    packetId: "r1032-labs-wearables-pivot-scaffold",
    pivotDecision: {
      functionDisabilityStatus: "parallel_sidecar_not_main_lane",
      mainLane: "labs_activity_sleep_autonomic_outcome_risk",
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      reviewGptOperatingRule: "ReviewGPT handles hard scientific architecture, source strategy, candidate-family gates, and aggregate-result interpretation; Codex handles local schemas, validators, runners, and tests.",
      wearableScoreBearingStatus: "shadow_until_integrated_outcome_validation",
    },
    reviewGptEvidence: {
      finalConfirmation: "APPROVE_WITH_CHANGES",
      requiredModel: "GPT-5.5 Extended Pro",
      trustedInputs: [
        "r1029-vonneumann-labs-wearables-ml-strategy",
        "r1029-hercules-labs-wearables-ml-strategy",
        "r1031-final-extended-pro-confirmation",
      ],
    },
    reviewGptScope: {
      askNext: [
        "source_priority",
        "model_architecture",
        "candidate_family_gates",
        "aggregate_result_interpretation",
      ],
      doNotAsk: [
        "typescript_schema_names",
        "validator_implementation",
        "file_path_hygiene",
        "ordinary_test_failures",
        "website_or_sidebar_display",
        "product_copy",
        "minor_function_sidecar_bookkeeping",
      ],
    },
    schemaVersion: R1032_LABS_WEARABLES_PIVOT_SCAFFOLD_SCHEMA_VERSION,
    sourcePriority: {
      controlledPartnerWorkbench: [
        {
          evidenceLabel: "partner_aggregate_validation",
          rank: 1,
          role: "True consumer-wearable plus labs plus outcomes validation.",
          source: "partner_aggregate_evaluator",
        },
        {
          evidenceLabel: "human_admin_workbench",
          rank: 2,
          role: "High-power lab, body, accelerometry, mortality, and event validation.",
          source: "uk_biobank_integrated",
        },
        {
          evidenceLabel: "controlled_workbench",
          rank: 3,
          role: "Consumer wearable realism with EHR labs and event heads.",
          source: "all_of_us_fitbit_labs_ehr",
        },
        {
          evidenceLabel: "sleep_autonomic_external_candidate",
          rank: 4,
          role: "Sleep, recovery, and autonomic physiology outcome validation.",
          source: "nsrr_mesa_sleep_shhs_mros_style",
        },
      ],
      immediatePublicLocal: [
        {
          evidenceLabel: "public_bridge_same_family",
          rank: 1,
          role: "First same-denominator lab, BP/body, objective-activity, and linked-mortality benchmark.",
          source: "nhanes_labs_body_bp_objective_activity_linked_mortality",
        },
        {
          evidenceLabel: "same_family_lab_development",
          rank: 2,
          role: "Lab-risk development, assay-era diagnostics, and PhenoAge-style reference context.",
          source: "nhanes_iii_and_continuous_nhanes_lab_mortality",
        },
        {
          evidenceLabel: "external_transport_candidate",
          rank: 3,
          role: "External lab/body transport for compact lab modules.",
          source: "midus_creles_or_similar_biomarker_followup",
        },
        {
          evidenceLabel: "sidecar_transport_stress",
          rank: 4,
          role: "Older-adult and non-US calibration stress where biomarker/outcome facts are clean.",
          source: "haalsi_mhas_hrs_sage_or_other_aging_biomarker_cohorts",
        },
      ],
    },
    status: "research-local-scaffold-no-row-parsing",
    summary: {
      conclusion: "labs_wearables_main_lane_scaffolded_no_product_display",
      firstLoop: "nhanes_lab_activity_mortality_v1",
      productDisplayAuthorized: false,
      rowParsingPerformedByR1032: false,
    },
  };

  assertR1032Safe(output);
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

export function assertR1032Safe(output: R1032LabsWearablesPivotScaffoldOutput): void {
  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findR1032SpecificFindings(output),
  ];
  if (findings.length > 0) {
    throw new Error(`R1032 labs/wearables pivot scaffold failed safety validation: ${findings.join("; ")}`);
  }
}

function benchmarkCards(): BenchmarkCard[] {
  return [
    {
      accessLane: "public_local",
      aggregateOutputBoundary: aggregateBoundary(),
      benchmarkCardId: "nhanes_lab_activity_mortality_v1",
      calibrationPlan: commonCalibrationPlan(),
      candidateFamilies: [
        candidate("A0_age_sex"),
        candidate("A1_anchor_projection_or_age_sex_body_bp"),
        candidate("A2_lab5_bp_body"),
        candidate("A3_lab9_bp_body"),
        candidate("A4_lab9_bp_body_plus_activity_volume"),
        candidate("A5_lab9_bp_body_plus_activity_volume_plus_sedentary"),
        candidate("A6_lab9_bp_body_plus_activity_quality_controls"),
        candidate("A7_missingness_quality_only_negative_control", "negative_control"),
        candidate("A8_shuffled_activity_negative_control", "negative_control"),
        candidate("A9_phenoage_style_lab_reference_only", "reference_only"),
      ],
      censoringPolicy: "Use predeclared horizon with complete ascertainment or IPCW/landmarking; report survival-calibrated proper scores when censoring exists.",
      comparatorModels: [
        "age_sex",
        "age_sex_body_bp",
        "frozen_anchor_when_directly_computable",
        "lab5_bp_body",
        "lab9_bp_body",
      ],
      coverageQualityPlan: [
        "valid_wear_day_count",
        "wear_time_or_coverage_summary",
        "coverage_only_negative_control",
      ],
      endpointHeads: ["all_cause_mortality"],
      featureFamilies: [
        "age_sex",
        "body_bp",
        "lab5",
        "lab9",
        "objective_activity_volume",
        "sedentary_burden",
        "activity_coverage_quality",
      ],
      horizonPolicy: "Fixed horizon declared before training; if ten-year ascertainment is not valid, use a separately labeled shorter horizon.",
      metricPlan: commonMetricPlan(),
      missingnessPlan: commonMissingnessPlan(),
      negativeControls: [
        "missingness_quality_only",
        "activity_coverage_only",
        "shuffled_activity_features",
      ],
      productDisplayAuthorized: false,
      promotionGates: [
        "same_denominator_comparison",
        "proper_score_improvement_over_lab_body_bp",
        "calibration_not_materially_worse",
        "coverage_only_control_does_not_explain_signal",
        "weighted_and_unweighted_metric_table_present",
        "integrated_validation_required_before_consumer_wearable_claim",
      ],
      schemaVersion: INTEGRATED_BENCHMARK_CARD_SCHEMA_VERSION,
      sourceRoute: "nhanes_labs_body_bp_objective_activity_linked_mortality",
      splitPlan: [
        "train_calibration_test_or_time_block_declared_before_scoring",
        "no candidate iteration on inspected test output",
      ],
      subgroupPromotionBlockers: commonSubgroupBlockers(),
      surveyWeightPolicy: "Declare whether primary objective is population-representative risk or individual transport; report weighted and unweighted metrics when feasible.",
    },
    {
      accessLane: "free_registered_local",
      aggregateOutputBoundary: aggregateBoundary(),
      benchmarkCardId: "external_lab_transport_v1",
      calibrationPlan: commonCalibrationPlan(),
      candidateFamilies: [
        candidate("B0_age_sex"),
        candidate("B1_age_sex_body_bp"),
        candidate("B2_lab5_bp_body"),
        candidate("B3_lab9_bp_body_if_available"),
        candidate("B4_minimal_glycemia_renal_lipid_bp_body"),
        candidate("B5_lab9_minus_unstable_assays"),
        candidate("B6_missingness_only_negative_control", "negative_control"),
        candidate("B7_transport_recalibration_only_no_coefficient_refit"),
        candidate("B8_source_refit_shrinkage_challenger_only"),
      ],
      censoringPolicy: "Endpoint and censoring must be source-carded before any row execution; recalibration-only transport is tested separately from source refit.",
      comparatorModels: [
        "age_sex",
        "age_sex_body_bp",
        "frozen_nhanes_lab_model_with_intercept_slope_recalibration",
        "source_refit_shrinkage_challenger_only",
      ],
      coverageQualityPlan: [
        "lab_recency_or_wave_context",
        "assay_context",
        "sampling_or_fasting_context_when_available",
      ],
      endpointHeads: ["all_cause_mortality", "frailty_disability_or_functional_decline_auxiliary_head"],
      featureFamilies: [
        "age_sex",
        "body_bp",
        "glycemia",
        "renal",
        "lipids",
        "albumin_or_liver_family_when_comparable",
        "cbc_or_hematologic_family_when_comparable",
        "medication_and_sampling_context",
      ],
      horizonPolicy: "Use the source-supported horizon only; a positive result for one endpoint or horizon cannot promote another.",
      metricPlan: commonMetricPlan(),
      missingnessPlan: commonMissingnessPlan(),
      negativeControls: ["missingness_only", "recalibration_only_no_feature_coefficient_refit"],
      productDisplayAuthorized: false,
      promotionGates: [
        "external_source_not_same_family_only",
        "proper_score_improvement_over_age_sex_body_bp",
        "calibration_repairable_with_intercept_slope",
        "core_lab_direction_stable",
        "medication_treatment_assay_context_declared",
        "no_boutique_denominator_created_by_missingness",
      ],
      schemaVersion: INTEGRATED_BENCHMARK_CARD_SCHEMA_VERSION,
      sourceRoute: "midus_creles_or_similar_biomarker_followup",
      splitPlan: [
        "within_source_train_calibration_test_when_powered",
        "leave_source_out_when_two_or_more_external_sources_exist",
      ],
      subgroupPromotionBlockers: commonSubgroupBlockers(),
      surveyWeightPolicy: "Use source-design weights when appropriate and always expose whether weighted metrics are primary.",
    },
    {
      accessLane: "partner_aggregate",
      aggregateOutputBoundary: aggregateBoundary(),
      benchmarkCardId: "partner_integrated_wearable_lab_evaluator_v1",
      calibrationPlan: commonCalibrationPlan(),
      candidateFamilies: [
        candidate("C0_age_sex"),
        candidate("C1_anchor_or_source_clinical_base"),
        candidate("C2_lab5_or_lab9_bp_body"),
        candidate("C3_lab_bp_body_plus_activity_28d"),
        candidate("C4_lab_bp_body_plus_activity_sleep_28d"),
        candidate("C5_lab_bp_body_plus_activity_sleep_rhr"),
        candidate("C6_lab_bp_body_plus_activity_sleep_rhr_hrv_quality_gated"),
        candidate("C7_wearable_coverage_quality_only_negative_control", "negative_control"),
        candidate("C8_shuffled_wearable_negative_control", "negative_control"),
      ],
      censoringPolicy: "Partner or workbench must declare endpoint ascertainment, censoring, and event-window policy before returning aggregate metrics.",
      comparatorModels: [
        "age_sex",
        "source_clinical_base",
        "lab_body_bp",
        "activity_only_increment",
        "sleep_only_increment",
        "coverage_quality_only_negative_control",
      ],
      coverageQualityPlan: [
        "valid_day_count",
        "valid_night_count",
        "device_provider_summary",
        "measurement_context_summary",
        "low_coverage_abstention_or_uncertainty_widening",
      ],
      endpointHeads: [
        "all_cause_mortality",
        "major_cardiovascular_event",
        "hospitalization_or_emergency_utilization",
        "incident_cardiometabolic_disease",
        "frailty_disability_or_functional_decline_auxiliary_head",
      ],
      featureFamilies: [
        "lab_body_bp",
        "activity_28d",
        "sleep_duration_regularity_28d",
        "resting_heart_rate",
        "hrv_method_qualified_shadow",
        "wearable_coverage_quality",
        "device_provider_context",
      ],
      horizonPolicy: "Each endpoint and horizon is a separate model head; no cross-head promotion.",
      metricPlan: commonMetricPlan(),
      missingnessPlan: commonMissingnessPlan(),
      negativeControls: [
        "coverage_quality_only",
        "shuffled_wearable_features",
        "device_provider_only",
      ],
      productDisplayAuthorized: false,
      promotionGates: [
        "frozen_aggregate_evaluator_before_partner_execution",
        "proper_score_improvement_over_lab_body_bp",
        "calibration_not_materially_degraded",
        "device_provider_coverage_checks_pass",
        "integrated_same_denominator_validation_before_combined_score",
        "replication_plan_before_score_bearing_promotion",
      ],
      schemaVersion: INTEGRATED_BENCHMARK_CARD_SCHEMA_VERSION,
      sourceRoute: "partner_or_workbench_labs_wearables_outcomes",
      splitPlan: [
        "partner_uses_frozen_evaluator_or_workbench_notebook",
        "only aggregate receipt leaves data holder boundary",
      ],
      subgroupPromotionBlockers: commonSubgroupBlockers(),
      surveyWeightPolicy: "Not required for ordinary partner cohorts unless source design requires it; source-design weighting status must be declared.",
    },
  ];
}

function aggregateBoundary(): BenchmarkCard["aggregateOutputBoundary"] {
  return {
    allowed: [
      "denominator_count_bands",
      "event_count_bands",
      "aggregate_metric_tables",
      "calibration_summaries",
      "subgroup_summaries_above_suppression_threshold",
      "missingness_and_coverage_summaries",
      "ablation_delta_summaries",
      "negative_control_verdicts",
    ],
    blocked: [
      "rows",
      "identifiers",
      "individual_risks",
      "individual_model_outputs",
      "feature_coefficients",
      "fitted_model_parameters",
      "split_membership_lists",
      "unsuppressed_subgroups",
      "raw_wearable_traces",
      "source_prose",
      "local_file_paths",
    ],
    minimumCellPolicy: "Suppress or band sparse cells; aggregate receipt must not expose reportable tiny denominator or event cells.",
  };
}

function candidate(candidateId: string, role: CandidateRole = "score_bearing_research_candidate"): CandidateFamily {
  return {
    candidateId,
    role,
    status: role === "score_bearing_research_candidate"
      ? "predeclared_not_run"
      : role === "negative_control"
        ? "shadow_only_until_validation"
        : "reference_not_promotion_target",
  };
}

function commonCalibrationPlan(): string[] {
  return [
    "train_then_calibration_then_locked_test",
    "intercept_slope_calibration",
    "expected_observed_ratio",
    "calibration_curve_or_ici_ece",
    "source_specific_recalibration_reported_separately",
  ];
}

function commonMetricPlan(): string[] {
  return [
    "weighted_auc_or_c_index_when_feasible",
    "unweighted_auc_or_c_index",
    "weighted_brier_when_feasible",
    "unweighted_brier",
    "weighted_log_loss_when_feasible",
    "unweighted_log_loss",
    "calibration_intercept",
    "calibration_slope",
    "expected_observed_ratio",
    "observed_event_rate",
    "mean_predicted_risk",
    "uncertainty_interval_or_bootstrap_summary",
  ];
}

function commonMissingnessPlan(): string[] {
  return [
    "whole_domain_missingness_does_not_impute_fake_signal",
    "missing_or_low_quality_domain_can_abstain_or_widen_uncertainty",
    "within_card_imputation_must_be_predeclared",
    "missingness_and_coverage_are_quality_uncertainty_inputs_by_default",
  ];
}

function commonSubgroupBlockers(): string[] {
  return [
    "age_band",
    "sex",
    "baseline_disease_burden",
    "medication_burden_when_available",
    "race_ethnicity_or_geography_when_legally_and_ethically_reportable",
    "healthcare_access_proxy_when_available",
    "device_provider_or_coverage_when_available",
  ];
}

function findR1032SpecificFindings(output: R1032LabsWearablesPivotScaffoldOutput): string[] {
  const findings: string[] = [];
  if (output.summary.productDisplayAuthorized !== false) {
    findings.push("summary.productDisplayAuthorized must remain false");
  }
  if (output.pivotDecision.productDisplayAuthorized !== false) {
    findings.push("pivotDecision.productDisplayAuthorized must remain false");
  }
  if (output.pivotDecision.mainLane !== "labs_activity_sleep_autonomic_outcome_risk") {
    findings.push("main lane must stay on labs/activity/sleep/autonomic outcome risk");
  }
  if (!output.modelArchitecture.modelingPolicy.some((policy) => policy.includes("censoring"))) {
    findings.push("modeling policy must mention censoring handling");
  }
  if (!output.modelArchitecture.anchorPolicy.crosswalkRule.includes("directly observed")) {
    findings.push("anchor crosswalk rule must require directly observed inputs or frozen validation");
  }
  for (const card of output.benchmarkCards) {
    if (card.productDisplayAuthorized !== false) {
      findings.push(`${card.benchmarkCardId} product display must remain false`);
    }
    if (!card.censoringPolicy.toLowerCase().includes("censor")) {
      findings.push(`${card.benchmarkCardId} must declare censoring policy`);
    }
    if (card.candidateFamilies.filter((candidateFamily) => candidateFamily.role === "score_bearing_research_candidate").length > 8) {
      findings.push(`${card.benchmarkCardId} has too many score-bearing candidates`);
    }
  }
  return findings;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR1032LabsWearablesPivotScaffold({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  }).then(({ output }) => {
    process.stdout.write(`${JSON.stringify({
      benchmarkCardCount: output.benchmarkCards.length,
      conclusion: output.summary.conclusion,
      firstLoop: output.summary.firstLoop,
      packetId: output.packetId,
      productDisplayAuthorized: output.summary.productDisplayAuthorized,
      rowParsingPerformedByR1032: output.summary.rowParsingPerformedByR1032,
      schemaVersion: output.schemaVersion,
      status: output.status,
    }, null, 2)}\n`);
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
