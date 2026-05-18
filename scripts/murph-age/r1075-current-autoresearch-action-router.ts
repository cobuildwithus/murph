import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1075_CURRENT_AUTORESEARCH_ACTION_ROUTER_SCHEMA_VERSION =
  "murph-age-r1075-current-autoresearch-action-router.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1075-current-autoresearch-action-router.latest.json";
const KNOWN_INPUTS = {
  "r1057-function-activity-pulse-candidate-batch-result.latest.json": {
    packetId: "r1057-function-activity-pulse-candidate-batch-result",
    schemaVersion: "murph-age-r1057-function-activity-pulse-candidate-batch-result.v1",
  },
  "r1074-true-wearable-post-download-refresh.latest.json": {
    packetId: "r1074-true-wearable-post-download-refresh",
    schemaVersion: "murph-age-r1074-true-wearable-post-download-refresh.v1",
  },
  "r1083-function-missingness-calibration-adjudication.latest.json": {
    packetId: "r1083-function-missingness-calibration-adjudication",
    schemaVersion: "murph-age-r1083-function-missingness-calibration-adjudication.v1",
  },
  "r1084-haalsi-function-missingness-calibration-adjudication.latest.json": {
    packetId: "r1084-haalsi-function-missingness-calibration-adjudication",
    schemaVersion: "murph-age-r1084-haalsi-function-missingness-calibration-adjudication.v1",
  },
  "r1101-consumer-labs-wearables-loop-executor.latest.json": {
    packetId: "r1101-consumer-labs-wearables-loop-executor",
    schemaVersion: "murph-age-r1101-consumer-labs-wearables-loop-executor.v1",
  },
} as const;

type RouterConclusion =
  | "current_loop_blocked_on_true_wearable_data"
  | "current_loop_hold_consumer_no_delta_continue_source_search"
  | "current_loop_ready_for_consumer_first_pass_aggregate_metrics"
  | "current_loop_ready_for_function_adjudication"
  | "current_loop_ready_for_nsrr_aggregate_receipt"
  | "current_loop_ready_for_reviewgpt_scientific_delta"
  | "current_loop_repair_direction_inputs";
type RouterNextAction =
  | "continue_consumer_source_search_after_no_delta"
  | "download_nsrr_or_secure_workbench_access"
  | "fill_consumer_first_pass_aggregate_metrics_template"
  | "fill_nsrr_aggregate_receipt_or_run_local_evaluator"
  | "repair_r1055_r1056_r1057_direction_chain"
  | "run_function_missingness_calibration_adjudication"
  | "send_real_aggregate_delta_to_reviewgpt";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface RouterDecision {
  conclusion: RouterConclusion;
  nextAction: RouterNextAction;
  rationale: string;
  reviewGptRequiredNow: boolean;
}

export interface R1075CurrentAutoresearchActionRouterOptions {
  createdAt?: string;
  outputDir?: string;
  r1057Path?: string;
  r1074Path?: string;
  r1083Path?: string;
  r1084Path?: string;
  r1101Path?: string;
}

export interface R1075CurrentAutoresearchActionRouterOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1075: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1075: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  currentState: {
    consumerFirstPassAggregateMetricsTemplateArtifact: string | null;
    consumerFirstPassMissingMetricCandidateIds: string[];
    consumerFirstWearableCandidate: string | null;
    consumerLoopConclusion: string | null;
    consumerLoopNextAction: string | null;
    consumerNhanesShadowFirstPassAggregateMetricsArtifact: string | null;
    consumerNhanesShadowFirstPassEvidenceRole:
      | "historical_nhanes_shadow_not_consumer_16_50_validation"
      | "waiting_on_historical_shadow_inputs"
      | null;
    consumerOrdinarySubmissionHandoffPlanArtifact: string | null;
    consumerOrdinarySourceFamilyIds: string[];
    consumerOrdinaryTableLayouts: string[];
    consumerPriority: "labs_vitals_body_wearables_for_roughly_16_50" | null;
    functionActivityLead: string | null;
    r1057NextLocalAction: string | null;
    r1083NextLocalAction: string | null;
    r1084NextLocalAction: string | null;
    trueWearableDataAsk: string | null;
    trueWearableNextAction: string | null;
  };
  inputArtifacts: {
    r1057FunctionActivityPulseBatchResult: ArtifactSummary;
    r1074TrueWearablePostDownloadRefresh: ArtifactSummary;
    r1083FunctionMissingnessCalibrationAdjudication: ArtifactSummary;
    r1084HaalsiFunctionMissingnessCalibrationAdjudication: ArtifactSummary;
    r1101ConsumerLabsWearablesLoopExecutor: ArtifactSummary;
  };
  nextLoop: {
    commands: string[];
    decision: RouterDecision;
    productDisplayAuthorized: false;
    reviewGptUse: "only_for_real_aggregate_delta_or_major_architecture_fork";
  };
  packetId: "r1075-current-autoresearch-action-router";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1075_CURRENT_AUTORESEARCH_ACTION_ROUTER_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: RouterConclusion;
    nextAction: RouterNextAction;
    productDisplayAuthorized: false;
    reviewGptRequiredNow: boolean;
    rowParsingPerformedByR1075: false;
    consumerFirstPassAggregateMetricsTemplateArtifact: string | null;
    consumerFirstWearableCandidate: string | null;
    consumerMissingFirstPassMetricCandidateIds: string[];
    consumerNhanesShadowFirstPassAggregateMetricsArtifact: string | null;
    consumerNhanesShadowFirstPassEvidenceRole:
      | "historical_nhanes_shadow_not_consumer_16_50_validation"
      | "waiting_on_historical_shadow_inputs"
      | null;
    consumerOrdinarySubmissionHandoffPlanArtifact: string | null;
    consumerOrdinarySourceFamilyIds: string[];
    consumerOrdinaryTableLayouts: string[];
  };
}

export async function runR1075CurrentAutoresearchActionRouter(
  options: R1075CurrentAutoresearchActionRouterOptions = {},
): Promise<{ output: R1075CurrentAutoresearchActionRouterOutput; outputPath: string }> {
  const inputs = {
    r1057: await readJsonIfPresent(
      options.r1057Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1057-function-activity-pulse-candidate-batch-result.latest.json"),
    ),
    r1074: await readJsonIfPresent(
      options.r1074Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1074-true-wearable-post-download-refresh.latest.json"),
    ),
    r1083: await readJsonIfPresent(
      options.r1083Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1083-function-missingness-calibration-adjudication.latest.json"),
    ),
    r1084: await readJsonIfPresent(
      options.r1084Path ?? path.join(
        DEFAULT_MODEL_RUNS_DIR,
        "r1084-haalsi-function-missingness-calibration-adjudication.latest.json",
      ),
    ),
    r1101: await readJsonIfPresent(
      options.r1101Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1101-consumer-labs-wearables-loop-executor.latest.json"),
    ),
  };
  validateInputBoundaries(inputs);

  const decision = decideNextLoop(inputs);
  const output: R1075CurrentAutoresearchActionRouterOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    currentState: {
      consumerFirstPassAggregateMetricsTemplateArtifact: readStringAt(inputs.r1101, [
        "summary",
        "firstPassAggregateMetricsTemplateArtifact",
      ]),
      consumerFirstPassMissingMetricCandidateIds: readStringArrayAt(inputs.r1101, [
        "summary",
        "missingFirstPassMetricCandidateIds",
      ]),
      consumerFirstWearableCandidate: safeEnum(readStringAt(inputs.r1101, ["summary", "firstWearableCandidate"]), [
        "W1_activity_steps_minutes",
      ]),
      consumerLoopConclusion: safeEnum(readStringAt(inputs.r1101, ["summary", "conclusion"]), [
        "consumer_loop_ready_awaiting_aggregate_receipt",
        "consumer_loop_ready_for_reviewgpt_delta",
        "consumer_loop_hold_no_delta_continue_source_search",
        "consumer_loop_repair_inputs",
      ]),
      consumerLoopNextAction: safeEnum(readStringAt(inputs.r1101, ["summary", "nextAction"]), [
        "fill_r1124_first_pass_aggregate_metrics_template",
        "provide_r1125_private_runner_config_or_fill_r1124_template",
        "use_better_covered_private_data_or_fill_r1124_template",
        "collect_or_run_consumer_lab_wearable_aggregate_receipt",
        "send_aggregate_only_consumer_lab_wearable_delta_to_reviewgpt",
        "record_no_delta_memory_and_continue_consumer_source_search",
        "repair_consumer_lab_wearable_chain",
      ]),
      consumerNhanesShadowFirstPassAggregateMetricsArtifact: readStringAt(inputs.r1101, [
        "summary",
        "nhanesShadowFirstPassAggregateMetricsArtifact",
      ]),
      consumerNhanesShadowFirstPassEvidenceRole: safeEnum(readStringAt(inputs.r1101, [
        "summary",
        "nhanesShadowFirstPassEvidenceRole",
      ]), [
        "historical_nhanes_shadow_not_consumer_16_50_validation",
        "waiting_on_historical_shadow_inputs",
      ]),
      consumerOrdinarySubmissionHandoffPlanArtifact: readStringAt(inputs.r1101, [
        "summary",
        "ordinaryConsumerSubmissionHandoffPlanArtifact",
      ]),
      consumerOrdinarySourceFamilyIds: readStringArrayAt(inputs.r1101, [
        "summary",
        "ordinaryConsumerSourceFamilyIds",
      ]),
      consumerOrdinaryTableLayouts: readStringArrayAt(inputs.r1101, [
        "summary",
        "ordinaryConsumerTableLayouts",
      ]),
      consumerPriority: readStringAt(inputs.r1101, ["loopState", "consumerPriority"]) === "labs_vitals_body_wearables_for_roughly_16_50"
        ? "labs_vitals_body_wearables_for_roughly_16_50"
        : null,
      functionActivityLead: safeEnum(readStringAt(inputs.r1057, ["summary", "currentLead"]), [
        "function_activity_mobility_shadow",
      ]),
      r1057NextLocalAction: safeEnum(readStringAt(inputs.r1057, ["batchResult", "nextLocalAction"]), [
        "prepare_true_wearable_or_partner_validation_loop",
        "repair_candidate_batch_inputs",
      ]),
      r1083NextLocalAction: safeEnum(readStringAt(inputs.r1083, ["decision", "nextLocalAction"]), [
        "await_valid_function_transport_aggregate",
        "hold_function_family_and_redirect_next_source",
        "run_ordered_function_missingness_calibration_loop",
        "seek_fresh_function_source_or_true_wearable_validation",
      ]),
      r1084NextLocalAction: safeEnum(readStringAt(inputs.r1084, ["nextLocalAction"]), [
        "await_haalsi_aggregate",
        "hold_function_content_and_redirect_candidate_generation",
        "keep_function_lead_seek_fresh_function_source_or_true_wearable",
      ]),
      trueWearableDataAsk: safeDataAskFor(readStringAt(inputs.r1074, ["finalHandoff", "nextAction"])),
      trueWearableNextAction: safeEnum(readStringAt(inputs.r1074, ["finalHandoff", "nextAction"]), [
        "download_nsrr_derived_files_or_secure_workbench_access",
        "fill_nsrr_aggregate_receipt",
        "send_nsrr_delta_to_reviewgpt",
        "send_true_wearable_delta_to_reviewgpt",
      ]),
    },
    inputArtifacts: {
      r1057FunctionActivityPulseBatchResult: summarizeInput(
        "r1057-function-activity-pulse-candidate-batch-result.latest.json",
        inputs.r1057,
      ),
      r1074TrueWearablePostDownloadRefresh: summarizeInput(
        "r1074-true-wearable-post-download-refresh.latest.json",
        inputs.r1074,
      ),
      r1083FunctionMissingnessCalibrationAdjudication: summarizeInput(
        "r1083-function-missingness-calibration-adjudication.latest.json",
        inputs.r1083,
      ),
      r1084HaalsiFunctionMissingnessCalibrationAdjudication: summarizeInput(
        "r1084-haalsi-function-missingness-calibration-adjudication.latest.json",
        inputs.r1084,
      ),
      r1101ConsumerLabsWearablesLoopExecutor: summarizeInput(
        "r1101-consumer-labs-wearables-loop-executor.latest.json",
        inputs.r1101,
      ),
    },
    nextLoop: {
      commands: commandsFor(decision.nextAction),
      decision,
      productDisplayAuthorized: false,
      reviewGptUse: "only_for_real_aggregate_delta_or_major_architecture_fork",
    },
    packetId: "r1075-current-autoresearch-action-router",
    productDisplayAuthorized: false,
    schemaVersion: R1075_CURRENT_AUTORESEARCH_ACTION_ROUTER_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: decision.conclusion,
      nextAction: decision.nextAction,
      productDisplayAuthorized: false,
      reviewGptRequiredNow: decision.reviewGptRequiredNow,
      rowParsingPerformedByR1075: false,
      consumerFirstPassAggregateMetricsTemplateArtifact: readStringAt(inputs.r1101, [
        "summary",
        "firstPassAggregateMetricsTemplateArtifact",
      ]),
      consumerFirstWearableCandidate: readStringAt(inputs.r1101, ["summary", "firstWearableCandidate"]),
      consumerMissingFirstPassMetricCandidateIds: readStringArrayAt(inputs.r1101, [
        "summary",
        "missingFirstPassMetricCandidateIds",
      ]),
      consumerNhanesShadowFirstPassAggregateMetricsArtifact: readStringAt(inputs.r1101, [
        "summary",
        "nhanesShadowFirstPassAggregateMetricsArtifact",
      ]),
      consumerNhanesShadowFirstPassEvidenceRole: safeEnum(readStringAt(inputs.r1101, [
        "summary",
        "nhanesShadowFirstPassEvidenceRole",
      ]), [
        "historical_nhanes_shadow_not_consumer_16_50_validation",
        "waiting_on_historical_shadow_inputs",
      ]),
      consumerOrdinarySubmissionHandoffPlanArtifact: readStringAt(inputs.r1101, [
        "summary",
        "ordinaryConsumerSubmissionHandoffPlanArtifact",
      ]),
      consumerOrdinarySourceFamilyIds: readStringArrayAt(inputs.r1101, [
        "summary",
        "ordinaryConsumerSourceFamilyIds",
      ]),
      consumerOrdinaryTableLayouts: readStringArrayAt(inputs.r1101, [
        "summary",
        "ordinaryConsumerTableLayouts",
      ]),
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1075 current autoresearch action router failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function decideNextLoop(inputs: {
  r1057: unknown | null;
  r1074: unknown | null;
  r1083: unknown | null;
  r1084: unknown | null;
  r1101: unknown | null;
}): RouterDecision {
  const consumerReviewRequired = readBooleanAt(inputs.r1101, ["summary", "reviewGptRequiredNow"]);
  const consumerLoopConclusion = readStringAt(inputs.r1101, ["summary", "conclusion"]);
  const consumerLoopNextAction = readStringAt(inputs.r1101, ["summary", "nextAction"]);
  if (consumerReviewRequired || consumerLoopConclusion === "consumer_loop_ready_for_reviewgpt_delta") {
    return {
      conclusion: "current_loop_ready_for_reviewgpt_scientific_delta",
      nextAction: "send_real_aggregate_delta_to_reviewgpt",
      rationale: "A consumer lab/wearable first-pass aggregate delta has cleared local gates; ReviewGPT should interpret the scientific result before more local model search.",
      reviewGptRequiredNow: true,
    };
  }
  if (consumerLoopConclusion === "consumer_loop_ready_awaiting_aggregate_receipt") {
    return {
      conclusion: "current_loop_ready_for_consumer_first_pass_aggregate_metrics",
      nextAction: "fill_consumer_first_pass_aggregate_metrics_template",
      rationale: consumerLoopNextAction === "fill_r1124_first_pass_aggregate_metrics_template"
        ? "The active consumer-first pass is the R1124 aggregate metrics template for L1/L2/W1/QC, prioritizing ordinary labs, vitals/body context, and wearable activity that a typical 16-50-year-old could submit."
        : "The active consumer-first pass needs aggregate lab and wearable metrics before more same-source model search or older NSRR sleep/autonomic routing.",
      reviewGptRequiredNow: false,
    };
  }
  if (consumerLoopConclusion === "consumer_loop_hold_no_delta_continue_source_search") {
    return {
      conclusion: "current_loop_hold_consumer_no_delta_continue_source_search",
      nextAction: "continue_consumer_source_search_after_no_delta",
      rationale: "The consumer lab/wearable first-pass receipt produced no score-improving aggregate delta; keep that memory and continue source search before promoting broader panels.",
      reviewGptRequiredNow: false,
    };
  }

  const trueWearableReviewRequired = readBooleanAt(inputs.r1074, ["finalHandoff", "reviewGptRequiredNow"]);
  const trueWearableNextAction = readStringAt(inputs.r1074, ["finalHandoff", "nextAction"]);
  if (trueWearableReviewRequired || trueWearableNextAction === "send_nsrr_delta_to_reviewgpt" || trueWearableNextAction === "send_true_wearable_delta_to_reviewgpt") {
    return {
      conclusion: "current_loop_ready_for_reviewgpt_scientific_delta",
      nextAction: "send_real_aggregate_delta_to_reviewgpt",
      rationale: "A true wearable or NSRR aggregate delta has cleared local gates; ReviewGPT should interpret the scientific result before more local model search.",
      reviewGptRequiredNow: true,
    };
  }

  const r1057ReviewRequired = readBooleanAt(inputs.r1057, ["batchResult", "reviewGptRequiredBeforeNextLocalRun"]);
  if (r1057ReviewRequired) {
    return {
      conclusion: "current_loop_ready_for_reviewgpt_scientific_delta",
      nextAction: "send_real_aggregate_delta_to_reviewgpt",
      rationale: "The function/activity batch reducer found a partner/workbench aggregate delta that should go to ReviewGPT before more local loop work.",
      reviewGptRequiredNow: true,
    };
  }

  const r1083NextAction = readStringAt(inputs.r1083, ["decision", "nextLocalAction"]);
  const r1084NextAction = readStringAt(inputs.r1084, ["nextLocalAction"]);
  if (r1084NextAction === "hold_function_content_and_redirect_candidate_generation") {
    return {
      conclusion: "current_loop_repair_direction_inputs",
      nextAction: "repair_r1055_r1056_r1057_direction_chain",
      rationale: "The HAALSI function adjudication did not clear missingness/calibration; refresh model direction before preserving function as lead.",
      reviewGptRequiredNow: false,
    };
  }
  if (
    r1083NextAction === "run_ordered_function_missingness_calibration_loop"
    && r1084NextAction !== "keep_function_lead_seek_fresh_function_source_or_true_wearable"
  ) {
    return {
      conclusion: "current_loop_ready_for_function_adjudication",
      nextAction: "run_function_missingness_calibration_adjudication",
      rationale: "The current function sidecar has enough aggregate support to stay lead, but calibration and missingness controls require an ordered local adjudication loop before more source chasing.",
      reviewGptRequiredNow: false,
    };
  }

  if (trueWearableNextAction === "fill_nsrr_aggregate_receipt") {
    return {
      conclusion: "current_loop_ready_for_nsrr_aggregate_receipt",
      nextAction: "fill_nsrr_aggregate_receipt_or_run_local_evaluator",
      rationale: "Local NSRR-derived cohort evidence is ready enough for aggregate receipt fill or local aggregate evaluator execution; ReviewGPT is not needed until a real delta clears gates.",
      reviewGptRequiredNow: false,
    };
  }

  const r1057NextAction = readStringAt(inputs.r1057, ["batchResult", "nextLocalAction"]);
  if (r1057NextAction === "prepare_true_wearable_or_partner_validation_loop" && trueWearableNextAction === "download_nsrr_derived_files_or_secure_workbench_access") {
    return {
      conclusion: "current_loop_blocked_on_true_wearable_data",
      nextAction: "download_nsrr_or_secure_workbench_access",
      rationale: "The current local shadow lead is function/activity, and the next model-improving step is true wearable or NSRR validation data rather than more same-source model search.",
      reviewGptRequiredNow: false,
    };
  }

  return {
    conclusion: "current_loop_repair_direction_inputs",
    nextAction: "repair_r1055_r1056_r1057_direction_chain",
    rationale: "The current direction chain is incomplete or stale; refresh the integrated direction, candidate manifest, batch result, and true-wearable post-download refresh before choosing another loop.",
    reviewGptRequiredNow: false,
  };
}

function commandsFor(nextAction: RouterNextAction): string[] {
  if (nextAction === "fill_consumer_first_pass_aggregate_metrics_template") {
    return [
      "if the R1124 template is missing: pnpm exec tsx scripts/murph-age/r1124-consumer-first-pass-aggregate-metric-intake.ts",
      "pnpm exec tsx scripts/murph-age/r1127-ordinary-consumer-first-pass-submission-handoff.ts",
      "fill r1127-fillable ordinary consumer first-pass submission plan with private semantic refs only",
      "with a completed private config: MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH=<private-config.json> pnpm exec tsx scripts/murph-age/r1125-local-private-first-pass-aggregate-metric-runner.ts",
      "fill r1124-fillable consumer first-pass aggregate metrics template with aggregate L1/L2/W1/QC metrics only",
      "MURPH_AGE_CONSUMER_FIRST_PASS_AGGREGATE_METRICS_PATH=<aggregate-metrics.json> pnpm exec tsx scripts/murph-age/r1124-consumer-first-pass-aggregate-metric-intake.ts",
      "pnpm exec tsx scripts/murph-age/r1101-consumer-labs-wearables-loop-executor.ts",
      "pnpm exec tsx scripts/murph-age/r1075-current-autoresearch-action-router.ts",
    ];
  }
  if (nextAction === "continue_consumer_source_search_after_no_delta") {
    return [
      "record aggregate no-delta memory for the L1/L2/W1/QC consumer first-pass branch",
      "continue source search for ordinary labs, vitals/body, and wearable activity aggregate receipts before broad panels",
      "pnpm exec tsx scripts/murph-age/r1089-labs-wearables-candidate-batch-manifest.ts",
      "pnpm exec tsx scripts/murph-age/r1101-consumer-labs-wearables-loop-executor.ts",
      "pnpm exec tsx scripts/murph-age/r1075-current-autoresearch-action-router.ts",
    ];
  }
  if (nextAction === "download_nsrr_or_secure_workbench_access") {
    return [
      "while true-wearable access is pending: pnpm exec tsx scripts/murph-age/r603-autoresearch-loop-runner.ts",
      "while true-wearable access is pending: pnpm exec tsx scripts/murph-age/r1024-function-transport-fast-loop-runner.ts",
      "after human NSRR terms/access activation: nsrr download shhs/datasets",
      "after human NSRR terms/access activation: nsrr download mesa/datasets",
      "after human NSRR terms/access activation: nsrr download mesa/actigraphy",
      "after human NSRR terms/access activation: nsrr download hchs/datasets",
      "after human NSRR terms/access activation: nsrr download hchs/actigraphy",
      "after human NSRR terms/access activation: nsrr download mros/datasets",
      "after human NSRR terms/access activation: nsrr download sof/datasets",
      "MURPH_AGE_NSRR_SCAN_ROOTS=<download-folder> pnpm exec tsx scripts/murph-age/r1081-nsrr-source-table-candidate-scanner.ts",
      "MURPH_AGE_NSRR_SOURCE_TABLE_PATH=<downloaded-nsrr-table.csv> pnpm exec tsx scripts/murph-age/r1080-nsrr-standardizer-manifest-scaffold.ts",
      "MURPH_AGE_NSRR_STANDARDIZER_MANIFEST_PATH=<private-manifest.json> pnpm exec tsx scripts/murph-age/r1082-nsrr-standardizer-manifest-readiness.ts",
      "pnpm exec tsx scripts/murph-age/r1074-true-wearable-post-download-refresh.ts",
      "pnpm exec tsx scripts/murph-age/r1075-current-autoresearch-action-router.ts",
    ];
  }
  if (nextAction === "fill_nsrr_aggregate_receipt_or_run_local_evaluator") {
    return [
      "MURPH_AGE_NSRR_SCAN_ROOTS=<download-folder> pnpm exec tsx scripts/murph-age/r1081-nsrr-source-table-candidate-scanner.ts",
      "MURPH_AGE_NSRR_SOURCE_TABLE_PATH=<downloaded-nsrr-table.csv> pnpm exec tsx scripts/murph-age/r1080-nsrr-standardizer-manifest-scaffold.ts",
      "MURPH_AGE_NSRR_STANDARDIZER_MANIFEST_PATH=<private-manifest.json> pnpm exec tsx scripts/murph-age/r1082-nsrr-standardizer-manifest-readiness.ts",
      "MURPH_AGE_NSRR_STANDARDIZER_MANIFEST_PATH=<private-manifest.json> pnpm exec tsx scripts/murph-age/r1079-nsrr-sleep-autonomic-standardizer.ts",
      "MURPH_AGE_NSRR_SLEEP_AUTONOMIC_ANALYTIC_CACHE_PATH=<standardized-cache.csv.gz> pnpm exec tsx scripts/murph-age/r1078-nsrr-sleep-autonomic-local-loop.ts",
      "MURPH_AGE_NSRR_AGGREGATE_RECEIPT_PATH=<r1078-r1070-receipt.json> pnpm exec tsx scripts/murph-age/r1070-nsrr-sleep-autonomic-aggregate-receipt.ts",
      "MURPH_AGE_NSRR_AGGREGATE_RECEIPT_PATH=<receipt.json> pnpm exec tsx scripts/murph-age/r1070-nsrr-sleep-autonomic-aggregate-receipt.ts",
      "pnpm exec tsx scripts/murph-age/r1074-true-wearable-post-download-refresh.ts",
      "pnpm exec tsx scripts/murph-age/r1075-current-autoresearch-action-router.ts",
    ];
  }
  if (nextAction === "send_real_aggregate_delta_to_reviewgpt") {
    return [
      "package aggregate-only delta packet for ReviewGPT scientific interpretation",
      "do not send row values, predictions, coefficients, source text, or product claims",
    ];
  }
  if (nextAction === "run_function_missingness_calibration_adjudication") {
    return [
      "pnpm exec tsx scripts/murph-age/r1083-function-missingness-calibration-adjudication.ts",
      "run ordered same-denominator function-vs-missingness calibration adjudication in the private aggregate adapter",
      "send only a meaningful aggregate science delta to ReviewGPT if the adjudication changes the lead family",
    ];
  }
  return [
    "pnpm exec tsx scripts/murph-age/r1055-integrated-model-direction-state.ts",
    "pnpm exec tsx scripts/murph-age/r1056-function-activity-pulse-candidate-batch-manifest.ts",
    "pnpm exec tsx scripts/murph-age/r1057-function-activity-pulse-candidate-batch-result.ts",
    "pnpm exec tsx scripts/murph-age/r1074-true-wearable-post-download-refresh.ts",
  ];
}

function safeBoundary(): R1075CurrentAutoresearchActionRouterOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localFileNamesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1075: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1075: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
  };
}

function validateInputBoundaries(inputs: Record<string, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1075 input ${key} failed aggregate-egress validation: ${findings.join("; ")}`);
    }
  }
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function summarizeInput(artifact: string, value: unknown | null): ArtifactSummary {
  const expected = KNOWN_INPUTS[artifact as keyof typeof KNOWN_INPUTS];
  const packetId = readStringAt(value, ["packetId"]);
  const schemaVersion = readStringAt(value, ["schemaVersion"]);
  return {
    artifact,
    packetId: expected && packetId === expected.packetId ? packetId : null,
    schemaVersion: expected && schemaVersion === expected.schemaVersion ? schemaVersion : null,
    status: value ? "available" : "missing",
  };
}

function safeEnum<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return allowed.includes(value as T) ? value as T : null;
}

function safeDataAskFor(nextAction: string | null): string | null {
  if (nextAction === "download_nsrr_derived_files_or_secure_workbench_access") {
    return "download_nsrr_or_secure_workbench_access";
  }
  if (nextAction === "fill_nsrr_aggregate_receipt") {
    return "nsrr_aggregate_receipt_or_local_evaluator_ready";
  }
  if (nextAction === "send_nsrr_delta_to_reviewgpt" || nextAction === "send_true_wearable_delta_to_reviewgpt") {
    return "aggregate_delta_ready_for_scientific_review";
  }
  return null;
}

function readBooleanAt(value: unknown | null, pathParts: readonly string[]): boolean {
  return readAt(value, pathParts) === true;
}

function readStringAt(value: unknown | null, pathParts: readonly string[]): string | null {
  const current = readAt(value, pathParts);
  return typeof current === "string" ? current : null;
}

function readStringArrayAt(value: unknown | null, pathParts: readonly string[]): string[] {
  const current = readAt(value, pathParts);
  return Array.isArray(current) ? current.filter((item): item is string => typeof item === "string") : [];
}

function readAt(value: unknown | null, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

async function main(): Promise<void> {
  const { output } = await runR1075CurrentAutoresearchActionRouter({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1057Path: process.env.MURPH_AGE_R1057_FUNCTION_ACTIVITY_BATCH_RESULT_PATH,
    r1074Path: process.env.MURPH_AGE_R1074_TRUE_WEARABLE_REFRESH_PATH,
    r1083Path: process.env.MURPH_AGE_R1083_FUNCTION_ADJUDICATION_PATH,
    r1084Path: process.env.MURPH_AGE_R1084_HAALSI_FUNCTION_ADJUDICATION_PATH,
    r1101Path: process.env.MURPH_AGE_R1101_CONSUMER_LOOP_EXECUTOR_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    consumerFirstPassAggregateMetricsTemplateArtifact: output.summary.consumerFirstPassAggregateMetricsTemplateArtifact,
    consumerFirstWearableCandidate: output.summary.consumerFirstWearableCandidate,
    consumerMissingFirstPassMetricCandidateIds: output.summary.consumerMissingFirstPassMetricCandidateIds,
    consumerNhanesShadowFirstPassAggregateMetricsArtifact: output.summary.consumerNhanesShadowFirstPassAggregateMetricsArtifact,
    consumerNhanesShadowFirstPassEvidenceRole: output.summary.consumerNhanesShadowFirstPassEvidenceRole,
    consumerOrdinarySubmissionHandoffPlanArtifact: output.summary.consumerOrdinarySubmissionHandoffPlanArtifact,
    consumerOrdinarySourceFamilyIds: output.summary.consumerOrdinarySourceFamilyIds,
    consumerOrdinaryTableLayouts: output.summary.consumerOrdinaryTableLayouts,
    conclusion: output.summary.conclusion,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowParsingPerformedByR1075: output.summary.rowParsingPerformedByR1075,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1075 current autoresearch action router failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
