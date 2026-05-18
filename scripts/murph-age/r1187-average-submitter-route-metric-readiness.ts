import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1105_CONSUMER_AGGREGATE_RECEIPT_TEMPLATE_SCHEMA_VERSION,
} from "./r1105-consumer-aggregate-receipt-template.ts";
import {
  R1124_CONSUMER_FIRST_PASS_AGGREGATE_METRIC_INTAKE_SCHEMA_VERSION,
} from "./r1124-consumer-first-pass-aggregate-metric-intake.ts";
import {
  R1130_ORDINARY_CONSUMER_REAL_EVIDENCE_HANDOFF_SCHEMA_VERSION,
} from "./r1130-ordinary-consumer-real-evidence-handoff.ts";
import {
  R1142_ORDINARY_CONSUMER_PARTIAL_PRIVATE_CHAIN_RUNNER_SCHEMA_VERSION,
} from "./r1142-ordinary-consumer-partial-private-chain-runner.ts";
import {
  R1186_AVERAGE_SUBMITTER_SAFE_SUBMISSION_PACKET_COMMAND,
  R1186_AVERAGE_SUBMITTER_SAFE_SUBMISSION_PACKET_SCHEMA_VERSION,
} from "./r1186-average-submitter-safe-submission-packet.ts";

export const R1187_AVERAGE_SUBMITTER_ROUTE_METRIC_READINESS_SCHEMA_VERSION =
  "murph-age-r1187-average-submitter-route-metric-readiness.v1" as const;
export const R1187_AVERAGE_SUBMITTER_ROUTE_METRIC_READINESS_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1187-average-submitter-route-metric-readiness.ts" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1187-average-submitter-route-metric-readiness.latest.json" as const;
const R1186_ARTIFACT = "r1186-average-submitter-safe-submission-packet.latest.json" as const;
const R1130_ARTIFACT = "r1130-ordinary-consumer-real-evidence-handoff.latest.json" as const;
const R1124_ARTIFACT = "r1124-consumer-first-pass-aggregate-metric-intake.latest.json" as const;
const R1105_ARTIFACT = "r1105-consumer-aggregate-receipt-template.latest.json" as const;
const R1142_ARTIFACT = "r1142-ordinary-consumer-partial-private-chain-runner.latest.json" as const;
const R1186_PACKET_ID = "r1186-average-submitter-safe-submission-packet" as const;
const R1130_PACKET_ID = "r1130-ordinary-consumer-real-evidence-handoff" as const;
const R1124_PACKET_ID = "r1124-consumer-first-pass-aggregate-metric-intake" as const;
const R1105_PACKET_ID = "r1105-consumer-aggregate-receipt-template" as const;
const R1142_PACKET_ID = "r1142-ordinary-consumer-partial-private-chain-runner" as const;
const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first" as const;
const TARGET_AGE_BAND = "roughly_16_50" as const;
const MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
] as const;
const PRIORITIZED_INPUT_KIND_IDS = [
  "lab_portal_export_or_spreadsheet",
  "phone_watch_or_wearable_activity_export",
] as const;
const FIRST_PASS_CANDIDATE_IDS = [
  "L1_tiny_glycemia_only",
  "L2_common_lab_core_shadow",
  "W1_activity_steps_minutes",
  "QC_missingness_coverage",
] as const;
const ROUTE_METRIC_STAGE_IDS = [
  "safe_boolean_confirmation",
  "row_owner_private_config",
  "private_runner",
  "aggregate_metric_intake",
  "reviewgpt_real_delta_only",
] as const;
const R1186_CONCLUSION_IDS = [
  "average_submitter_safe_submission_packet_ready_for_feature_only_research_planning",
  "average_submitter_safe_submission_packet_waiting_on_chain_status_refresh",
  "average_submitter_safe_submission_packet_waiting_on_objective_gap_audit_refresh",
  "average_submitter_safe_submission_packet_waiting_on_r1180_confirmed_response_intake",
  "average_submitter_safe_submission_packet_waiting_on_r1183_materializer_refresh",
  "average_submitter_safe_submission_packet_waiting_on_row_owner_confirmation",
] as const;
const R1186_NEXT_ACTION_IDS = [
  "collect_boolean_only_row_owner_confirmation_then_rerun_r1183",
  "refresh_r1179_objective_gap_audit",
  "refresh_r1183_safe_response_materializer",
  "refresh_r1184_safe_response_chain_status",
  "run_r1180_with_r1183_confirmed_safe_response_artifact",
  "use_r1181_feature_only_execution_contract_for_research_planning_only",
] as const;
const R1130_CONCLUSION_IDS = [
  "ordinary_consumer_real_evidence_handoff_no_delta_continue_search",
  "ordinary_consumer_real_evidence_handoff_ready_for_private_runner",
  "ordinary_consumer_real_evidence_handoff_ready_for_reviewgpt_delta",
  "ordinary_consumer_real_evidence_handoff_ready_for_row_owner_config",
  "ordinary_consumer_real_evidence_handoff_waiting_on_refresh",
] as const;
const R1130_NEXT_ACTION_IDS = [
  "complete_private_config_for_real_outcome_linked_labs_wearables",
  "continue_consumer_source_search_after_real_no_delta",
  "refresh_r1122_r1127_r1129_before_handoff",
  "run_r1125_private_runner_then_r1124_real_metric_intake",
  "send_real_consumer_first_pass_delta_to_reviewgpt",
] as const;
const ROW_OWNER_WORK_TYPE_IDS = [
  "complete_private_config",
  "continue_source_search",
  "refresh_handoff_inputs",
  "review_real_delta",
  "run_private_runner",
] as const;
const PRIVATE_CONFIG_READINESS_IDS = [
  "config_intake_missing_or_stale",
  "private_config_needs_completion",
  "private_config_ready_for_r1125",
] as const;
const R1124_CONCLUSION_IDS = [
  "consumer_first_pass_aggregate_metrics_incomplete",
  "consumer_first_pass_aggregate_metrics_missing",
  "consumer_first_pass_aggregate_metric_intake_waiting_on_prerequisites",
  "consumer_first_pass_aggregate_receipt_ready_for_reviewgpt",
  "consumer_first_pass_aggregate_receipt_smoke_only_not_reviewgpt",
  "consumer_first_pass_aggregate_receipt_valid_but_no_delta",
] as const;
const R1124_NEXT_ACTION_IDS = [
  "provide_l1_l2_w1_qc_aggregate_metrics_or_fill_private_config",
  "refresh_r1113_r1121_before_metric_intake",
  "send_aggregate_only_consumer_first_pass_delta_to_reviewgpt",
  "complete_first_pass_aggregate_metrics",
  "record_no_delta_and_continue_consumer_receipt_search",
  "replace_smoke_metrics_with_real_outcome_linked_aggregate",
] as const;
const SUBMISSION_EVIDENCE_ROLE_IDS = [
  "historical_shadow_context",
  "real_first_pass_evidence",
  "synthetic_pipeline_smoke",
] as const;
const R1142_CONCLUSION_IDS = [
  "ordinary_partial_private_chain_full_route_ready_existing_runner_preferred",
  "ordinary_partial_private_chain_partial_metrics_recorded_research_only",
  "ordinary_partial_private_chain_waiting_on_partial_private_config",
  "ordinary_partial_private_chain_waiting_on_partial_private_metrics",
  "ordinary_partial_private_chain_waiting_on_safe_manifest",
] as const;
const R1142_NEXT_ACTION_IDS = [
  "fill_private_config_mapping_for_full_labs_wearable_route",
  "fill_safe_availability_manifest_then_run_r1142_partial_private_chain",
  "provide_partial_private_runner_config",
  "send_r1141_partial_metrics_to_r1138_or_r1140",
  "use_partial_metrics_for_research_only_collect_full_l1_l2_w1_qc_evidence",
] as const;
const SAFE_CONFIRMATION_COMMAND =
  "MURPH_AGE_R1183_ROW_OWNER_SAFE_RESPONSE_ASSERTIONS_CONFIRMED=true pnpm exec tsx scripts/murph-age/r1183-average-submitter-safe-response-materializer.ts" as const;
const R1130_CONFIG_INTAKE_COMMAND =
  "MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH=<private-config.json> pnpm exec tsx scripts/murph-age/r1122-local-private-consumer-receipt-runner-config-intake.ts" as const;
const R1130_PRIVATE_RUNNER_COMMAND =
  "MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH=<private-config.json> pnpm exec tsx scripts/murph-age/r1125-local-private-first-pass-aggregate-metric-runner.ts" as const;
const R1124_METRIC_INTAKE_COMMAND =
  "MURPH_AGE_CONSUMER_FIRST_PASS_AGGREGATE_METRICS_PATH=<aggregate-metrics.json> pnpm exec tsx scripts/murph-age/r1124-consumer-first-pass-aggregate-metric-intake.ts" as const;
const R1104_RECEIPT_VALIDATION_COMMAND =
  "MURPH_AGE_CONSUMER_AGGREGATE_RECEIPT_PATH=<receipt.json> pnpm exec tsx scripts/murph-age/r1104-consumer-aggregate-receipt-validator.ts" as const;
const R1142_PARTIAL_PRIVATE_CHAIN_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH=<availability-manifest.json> MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH=<partial-private-config.json> pnpm exec tsx scripts/murph-age/r1142-ordinary-consumer-partial-private-chain-runner.ts" as const;

type ArrayValue<T extends readonly string[]> = T[number];
type MinimumFeaturePairSourceFamilyId = ArrayValue<typeof MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS>;
type PrioritizedInputKindId = ArrayValue<typeof PRIORITIZED_INPUT_KIND_IDS>;
type FirstPassCandidateId = ArrayValue<typeof FIRST_PASS_CANDIDATE_IDS>;
type RouteMetricStageId = ArrayValue<typeof ROUTE_METRIC_STAGE_IDS>;
type R1186ConclusionId = ArrayValue<typeof R1186_CONCLUSION_IDS>;
type R1186NextActionId = ArrayValue<typeof R1186_NEXT_ACTION_IDS>;
type R1130ConclusionId = ArrayValue<typeof R1130_CONCLUSION_IDS>;
type R1130NextActionId = ArrayValue<typeof R1130_NEXT_ACTION_IDS>;
type RowOwnerWorkTypeId = ArrayValue<typeof ROW_OWNER_WORK_TYPE_IDS>;
type PrivateConfigReadinessId = ArrayValue<typeof PRIVATE_CONFIG_READINESS_IDS>;
type R1124ConclusionId = ArrayValue<typeof R1124_CONCLUSION_IDS>;
type R1124NextActionId = ArrayValue<typeof R1124_NEXT_ACTION_IDS>;
type SubmissionEvidenceRoleId = ArrayValue<typeof SUBMISSION_EVIDENCE_ROLE_IDS>;
type R1142ConclusionId = ArrayValue<typeof R1142_CONCLUSION_IDS>;
type R1142NextActionId = ArrayValue<typeof R1142_NEXT_ACTION_IDS>;

type ReadinessConclusion =
  | "average_submitter_route_metric_readiness_ready_for_private_runner"
  | "average_submitter_route_metric_readiness_ready_for_reviewgpt_real_delta"
  | "average_submitter_route_metric_readiness_waiting_on_aggregate_metrics"
  | "average_submitter_route_metric_readiness_waiting_on_route_metric_input_refresh"
  | "average_submitter_route_metric_readiness_waiting_on_row_owner_private_config"
  | "average_submitter_route_metric_readiness_waiting_on_safe_manifest"
  | "average_submitter_route_metric_readiness_waiting_on_safe_submission_packet_refresh"
  | "average_submitter_route_metric_readiness_waiting_on_safe_submission_confirmation";

type ReadinessNextAction =
  | "complete_r1186_boolean_only_safe_confirmation_first"
  | "complete_private_config_for_real_outcome_linked_labs_wearables"
  | "fill_or_ingest_l1_l2_w1_qc_aggregate_metrics"
  | "refresh_r1186_safe_submission_packet"
  | "refresh_route_metric_readiness_inputs"
  | "run_r1125_private_runner_then_r1124_real_metric_intake"
  | "run_r1142_partial_private_chain_after_safe_manifest"
  | "send_real_consumer_first_pass_delta_to_reviewgpt";

const NEXT_ACTION_COMMANDS: Record<ReadinessNextAction, string | null> = {
  complete_private_config_for_real_outcome_linked_labs_wearables: R1130_CONFIG_INTAKE_COMMAND,
  complete_r1186_boolean_only_safe_confirmation_first: SAFE_CONFIRMATION_COMMAND,
  fill_or_ingest_l1_l2_w1_qc_aggregate_metrics: R1124_METRIC_INTAKE_COMMAND,
  refresh_r1186_safe_submission_packet: R1186_AVERAGE_SUBMITTER_SAFE_SUBMISSION_PACKET_COMMAND,
  refresh_route_metric_readiness_inputs: R1187_AVERAGE_SUBMITTER_ROUTE_METRIC_READINESS_COMMAND,
  run_r1125_private_runner_then_r1124_real_metric_intake: R1130_PRIVATE_RUNNER_COMMAND,
  run_r1142_partial_private_chain_after_safe_manifest: R1142_PARTIAL_PRIVATE_CHAIN_COMMAND,
  send_real_consumer_first_pass_delta_to_reviewgpt: null,
};

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface R1186State {
  artifactBoundaryAggregateOnly: boolean | null;
  artifactBoundaryUnsafeTrueFlagFound: boolean;
  conclusion: R1186ConclusionId | null;
  featureOnlyResearchPlanningReady: boolean | null;
  inputArtifactAvailable: boolean;
  minimumPairMatches: boolean;
  modelEvidencePromotionAllowed: boolean | null;
  nextAction: R1186NextActionId | null;
  nextActionCommandRecognized: boolean;
  nextActionRequiresExplicitRowOwnerAssertion: boolean | null;
  packetId: typeof R1186_PACKET_ID | null;
  prioritizedInputKindsMatch: boolean;
  productDisplayAuthorized: boolean | null;
  realLabWearableRouteMetricsRecorded: boolean | null;
  reviewGptRequiredNow: boolean | null;
  rowLevelDataAcceptedByR1186: boolean | null;
  rowOwnerConfirmationInferredByR1186: boolean | null;
  rowOwnerPrivateValuesStored: boolean | null;
  rowOwnerSafeConfirmationValuesStoredInR1186Packet: boolean | null;
  rowParsingPerformedByR1186: boolean | null;
  safeSubmissionPacketReady: boolean | null;
  schemaCurrent: boolean;
  sourcePriorityMatches: boolean;
  status: "research-local-aggregate-only" | null;
  targetAgeBandMatches: boolean;
}

interface R1130State {
  artifactBoundaryAggregateOnly: boolean | null;
  artifactBoundaryUnsafeTrueFlagFound: boolean;
  conclusion: R1130ConclusionId | null;
  configIntakeCommandRecognized: boolean;
  inputArtifactAvailable: boolean;
  metricIntakeCommandRecognized: boolean;
  privateConfigReadiness: PrivateConfigReadinessId | null;
  privateRunnerCommandRecognized: boolean;
  productDisplayAuthorized: boolean | null;
  reviewGptRequiredNow: boolean | null;
  rowOwnerWorkType: RowOwnerWorkTypeId | null;
  rowParsingPerformedByR1130: boolean | null;
  nextAction: R1130NextActionId | null;
  packetId: typeof R1130_PACKET_ID | null;
  schemaCurrent: boolean;
  status: "research-local-aggregate-only" | null;
}

interface R1124State {
  aggregateMetricsProvided: boolean | null;
  aggregateMetricsTemplateRecognized: boolean;
  artifactBoundaryAggregateOnly: boolean | null;
  artifactBoundaryUnsafeTrueFlagFound: boolean;
  conclusion: R1124ConclusionId | null;
  inputArtifactAvailable: boolean;
  nextAction: R1124NextActionId | null;
  productDisplayAuthorized: boolean | null;
  receiptArtifactRecognized: boolean;
  reviewGptRequiredNow: boolean | null;
  rowParsingPerformedByR1124: boolean | null;
  packetId: typeof R1124_PACKET_ID | null;
  schemaCurrent: boolean;
  status: "research-local-aggregate-only" | null;
  submissionEvidenceRole: SubmissionEvidenceRoleId | null;
}

interface R1105State {
  artifactBoundaryAggregateOnly: boolean | null;
  artifactBoundaryUnsafeTrueFlagFound: boolean;
  inputArtifactAvailable: boolean;
  nextValidationCommandRecognized: boolean;
  productDisplayAuthorized: boolean | null;
  packetId: typeof R1105_PACKET_ID | null;
  schemaCurrent: boolean;
  status: "research-local-aggregate-only" | null;
  templateReadyForDataFill: boolean | null;
}

interface R1142State {
  artifactBoundaryAggregateOnly: boolean | null;
  artifactBoundaryUnsafeTrueFlagFound: boolean;
  conclusion: R1142ConclusionId | null;
  fullSupportedRouteReady: boolean | null;
  inputArtifactAvailable: boolean;
  nextAction: R1142NextActionId | null;
  productDisplayAuthorized: boolean | null;
  realAggregateStillMissing: boolean | null;
  reviewGptRequiredNow: boolean | null;
  routeMetricsReadyForR1138: boolean | null;
  rowParsingPerformedByR1142: boolean | null;
  packetId: typeof R1142_PACKET_ID | null;
  schemaCurrent: boolean;
  status: "research-local-private-inputs-aggregate-output" | null;
}

interface Transition {
  conclusion: ReadinessConclusion;
  nextAction: ReadinessNextAction;
}

export interface R1187AverageSubmitterRouteMetricReadinessOptions {
  createdAt?: string;
  outputDir?: string;
  r1105Path?: string;
  r1124Path?: string;
  r1130Path?: string;
  r1142Path?: string;
  r1186Path?: string;
}

export interface R1187AverageSubmitterRouteMetricReadinessOutput {
  artifactBoundary: ReturnType<typeof safeBoundary>;
  createdAt: string;
  inputArtifacts: {
    r1105ConsumerAggregateReceiptTemplate: ArtifactSummary;
    r1124ConsumerFirstPassAggregateMetricIntake: ArtifactSummary;
    r1130OrdinaryConsumerRealEvidenceHandoff: ArtifactSummary;
    r1142OrdinaryConsumerPartialPrivateChainRunner: ArtifactSummary;
    r1186AverageSubmitterSafeSubmissionPacket: ArtifactSummary;
  };
  packetId: "r1187-average-submitter-route-metric-readiness";
  productDisplayAuthorized: false;
  r1105State: R1105State;
  r1124State: R1124State;
  r1130State: R1130State;
  r1142State: R1142State;
  r1186State: R1186State;
  routeMetricReadiness: {
    aggregateMetricTemplateArtifact: "r1124-fillable-consumer-first-pass-aggregate-metrics.json" | null;
    commands: {
      aggregateMetricIntakeCommand: typeof R1124_METRIC_INTAKE_COMMAND | null;
      aggregateReceiptValidationCommand: typeof R1104_RECEIPT_VALIDATION_COMMAND | null;
      partialPrivateChainCommand: typeof R1142_PARTIAL_PRIVATE_CHAIN_COMMAND | null;
      privateConfigIntakeCommand: typeof R1130_CONFIG_INTAKE_COMMAND | null;
      privateRunnerCommand: typeof R1130_PRIVATE_RUNNER_COMMAND | null;
      safeConfirmationCommand: typeof SAFE_CONFIRMATION_COMMAND | null;
    };
    firstPassCandidateIds: FirstPassCandidateId[];
    minimumFeaturePairRequired: MinimumFeaturePairSourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    prioritizedInputKindIds: PrioritizedInputKindId[];
    productDisplayAuthorized: false;
    reviewGptPolicy: "only_after_real_aggregate_delta_from_r1124_or_r1130";
    routeMetricStageOrder: RouteMetricStageId[];
    rowLevelDataAcceptedByR1187: false;
    rowOwnerPrivateValuesStored: false;
    rowParsingPerformedByR1187: false;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
  schemaVersion: typeof R1187_AVERAGE_SUBMITTER_ROUTE_METRIC_READINESS_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    aggregateMetricsStillMissing: boolean;
    aggregateMetricTemplateReady: boolean;
    conclusion: ReadinessConclusion;
    featureOnlyResearchPlanningReady: boolean;
    minimumFeaturePairRequired: MinimumFeaturePairSourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    nextAction: ReadinessNextAction;
    nextActionCommand: string | null;
    prioritizedInputKindIds: PrioritizedInputKindId[];
    productDisplayAuthorized: false;
    realAggregateStillMissing: boolean;
    realLabWearableRouteMetricsRecorded: boolean;
    reviewGptRequiredNow: boolean;
    rowLevelDataAcceptedByR1187: false;
    privateConfigStillRequired: boolean;
    rowOwnerPrivateConfigStillRequired: boolean;
    rowOwnerPrivateValuesStored: false;
    safeConfirmationStillRequired: boolean;
    safeSubmissionPacketRefreshRequired: boolean;
    rowOwnerSafeConfirmationStillRequired: boolean;
    rowParsingPerformedByR1187: false;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
}

export async function runR1187AverageSubmitterRouteMetricReadiness(
  options: R1187AverageSubmitterRouteMetricReadinessOptions = {},
): Promise<{ output: R1187AverageSubmitterRouteMetricReadinessOutput; outputPath: string }> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const [r1186, r1130, r1124, r1105, r1142] = await Promise.all([
    readJsonIfPresent(options.r1186Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1186_ARTIFACT)),
    readJsonIfPresent(options.r1130Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1130_ARTIFACT)),
    readJsonIfPresent(options.r1124Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1124_ARTIFACT)),
    readJsonIfPresent(options.r1105Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1105_ARTIFACT)),
    readJsonIfPresent(options.r1142Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1142_ARTIFACT)),
  ]);
  validateAggregateSafe("r1186 average submitter safe submission packet", r1186);
  validateAggregateSafe("r1130 ordinary consumer real evidence handoff", r1130);
  validateAggregateSafe("r1124 consumer first-pass aggregate metric intake", r1124);
  validateAggregateSafe("r1105 consumer aggregate receipt template", r1105);
  validateAggregateSafe("r1142 ordinary consumer partial private chain runner", r1142);

  const r1186State = stateFromR1186(r1186);
  const r1130State = stateFromR1130(r1130);
  const r1124State = stateFromR1124(r1124);
  const r1105State = stateFromR1105(r1105);
  const r1142State = stateFromR1142(r1142);
  rejectUnsafeInputs({ r1105State, r1124State, r1130State, r1142State, r1186State });

  const transition = transitionFor({
    r1105State,
    r1124State,
    r1130State,
    r1142State,
    r1186State,
  });
  const reviewGptRequiredNow = transition.conclusion
    === "average_submitter_route_metric_readiness_ready_for_reviewgpt_real_delta";
  const featureOnlyResearchPlanningReady = r1186FeatureOnlyReady(r1186State);
  const rowOwnerSafeConfirmationStillRequired = r1186WaitingOnSafeConfirmation(r1186State);
  const rowOwnerPrivateConfigStillRequired = transition.conclusion
    === "average_submitter_route_metric_readiness_waiting_on_row_owner_private_config";
  const aggregateMetricTemplateReady = r1124State.aggregateMetricsTemplateRecognized
    || r1105State.templateReadyForDataFill === true;
  const realAggregateRecorded = r1124State.aggregateMetricsProvided === true
    && r1124State.submissionEvidenceRole === "real_first_pass_evidence";
  const realRouteMetricsRecorded = realAggregateRecorded
    || r1130ReadyForReviewGpt(r1130State)
    || r1186State.realLabWearableRouteMetricsRecorded === true;
  const realAggregateStillMissing = !realAggregateRecorded
    && r1130State.conclusion !== "ordinary_consumer_real_evidence_handoff_ready_for_reviewgpt_delta";
  const safeSubmissionPacketRefreshRequired = transition.conclusion
    === "average_submitter_route_metric_readiness_waiting_on_safe_submission_packet_refresh";

  const output: R1187AverageSubmitterRouteMetricReadinessOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: createdAtFor(options.createdAt),
    inputArtifacts: {
      r1105ConsumerAggregateReceiptTemplate: summarizeArtifact(
        r1105,
        R1105_ARTIFACT,
        R1105_PACKET_ID,
        R1105_CONSUMER_AGGREGATE_RECEIPT_TEMPLATE_SCHEMA_VERSION,
      ),
      r1124ConsumerFirstPassAggregateMetricIntake: summarizeArtifact(
        r1124,
        R1124_ARTIFACT,
        R1124_PACKET_ID,
        R1124_CONSUMER_FIRST_PASS_AGGREGATE_METRIC_INTAKE_SCHEMA_VERSION,
      ),
      r1130OrdinaryConsumerRealEvidenceHandoff: summarizeArtifact(
        r1130,
        R1130_ARTIFACT,
        R1130_PACKET_ID,
        R1130_ORDINARY_CONSUMER_REAL_EVIDENCE_HANDOFF_SCHEMA_VERSION,
      ),
      r1142OrdinaryConsumerPartialPrivateChainRunner: summarizeArtifact(
        r1142,
        R1142_ARTIFACT,
        R1142_PACKET_ID,
        R1142_ORDINARY_CONSUMER_PARTIAL_PRIVATE_CHAIN_RUNNER_SCHEMA_VERSION,
      ),
      r1186AverageSubmitterSafeSubmissionPacket: summarizeArtifact(
        r1186,
        R1186_ARTIFACT,
        R1186_PACKET_ID,
        R1186_AVERAGE_SUBMITTER_SAFE_SUBMISSION_PACKET_SCHEMA_VERSION,
      ),
    },
    packetId: "r1187-average-submitter-route-metric-readiness",
    productDisplayAuthorized: false,
    r1105State,
    r1124State,
    r1130State,
    r1142State,
    r1186State,
    routeMetricReadiness: {
      aggregateMetricTemplateArtifact: aggregateMetricTemplateReady
        ? "r1124-fillable-consumer-first-pass-aggregate-metrics.json"
        : null,
      commands: {
        aggregateMetricIntakeCommand: r1130State.metricIntakeCommandRecognized
          || r1124State.aggregateMetricsTemplateRecognized
          ? R1124_METRIC_INTAKE_COMMAND
          : null,
        aggregateReceiptValidationCommand: r1105State.nextValidationCommandRecognized
          ? R1104_RECEIPT_VALIDATION_COMMAND
          : null,
        partialPrivateChainCommand: r1142Usable(r1142State) ? R1142_PARTIAL_PRIVATE_CHAIN_COMMAND : null,
        privateConfigIntakeCommand: r1130State.configIntakeCommandRecognized
          ? R1130_CONFIG_INTAKE_COMMAND
          : null,
        privateRunnerCommand: r1130State.privateRunnerCommandRecognized
          ? R1130_PRIVATE_RUNNER_COMMAND
          : null,
        safeConfirmationCommand: r1186State.nextActionCommandRecognized ? SAFE_CONFIRMATION_COMMAND : null,
      },
      firstPassCandidateIds: [...FIRST_PASS_CANDIDATE_IDS],
      minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      prioritizedInputKindIds: [...PRIORITIZED_INPUT_KIND_IDS],
      productDisplayAuthorized: false,
      reviewGptPolicy: "only_after_real_aggregate_delta_from_r1124_or_r1130",
      routeMetricStageOrder: [...ROUTE_METRIC_STAGE_IDS],
      rowLevelDataAcceptedByR1187: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1187: false,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
    schemaVersion: R1187_AVERAGE_SUBMITTER_ROUTE_METRIC_READINESS_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      aggregateMetricsStillMissing: realAggregateStillMissing,
      aggregateMetricTemplateReady,
      conclusion: transition.conclusion,
      featureOnlyResearchPlanningReady,
      minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      nextAction: transition.nextAction,
      nextActionCommand: commandForNextAction(transition.nextAction),
      prioritizedInputKindIds: [...PRIORITIZED_INPUT_KIND_IDS],
      productDisplayAuthorized: false,
      realAggregateStillMissing,
      realLabWearableRouteMetricsRecorded: realRouteMetricsRecorded,
      reviewGptRequiredNow,
      rowLevelDataAcceptedByR1187: false,
      privateConfigStillRequired: rowOwnerPrivateConfigStillRequired,
      rowOwnerPrivateConfigStillRequired,
      rowOwnerPrivateValuesStored: false,
      safeConfirmationStillRequired: rowOwnerSafeConfirmationStillRequired,
      safeSubmissionPacketRefreshRequired,
      rowOwnerSafeConfirmationStillRequired,
      rowParsingPerformedByR1187: false,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };

  ensureNoOutputPathInOutput(output, outputDir);
  validateAggregateSafe("r1187 route metric readiness", output);
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function stateFromR1186(value: unknown | null): R1186State {
  return {
    artifactBoundaryAggregateOnly: readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]),
    artifactBoundaryUnsafeTrueFlagFound: hasUnsafeTrueBoundaryFlag(value),
    conclusion: readStringInSetAt(value, ["summary", "conclusion"], R1186_CONCLUSION_IDS),
    featureOnlyResearchPlanningReady: readBooleanAt(value, ["summary", "featureOnlyResearchPlanningReady"]),
    inputArtifactAvailable: value !== null,
    minimumPairMatches: exactStringSet(
      readStringArrayInSetAt(value, ["summary", "minimumFeaturePairRequired"], MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS),
      MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS,
    ),
    modelEvidencePromotionAllowed: readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]),
    nextAction: readStringInSetAt(value, ["summary", "nextAction"], R1186_NEXT_ACTION_IDS),
    nextActionCommandRecognized: readStringAt(value, ["summary", "nextActionCommand"]) === SAFE_CONFIRMATION_COMMAND,
    nextActionRequiresExplicitRowOwnerAssertion: readBooleanAt(value, [
      "summary",
      "nextActionRequiresExplicitRowOwnerAssertion",
    ]),
    packetId: readStringAt(value, ["packetId"]) === R1186_PACKET_ID ? R1186_PACKET_ID : null,
    prioritizedInputKindsMatch: exactStringSet(
      readStringArrayInSetAt(value, ["summary", "prioritizedInputKindIds"], PRIORITIZED_INPUT_KIND_IDS),
      PRIORITIZED_INPUT_KIND_IDS,
    ),
    productDisplayAuthorized: readBooleanAt(value, ["summary", "productDisplayAuthorized"]),
    realLabWearableRouteMetricsRecorded: readBooleanAt(value, [
      "summary",
      "realLabWearableRouteMetricsRecorded",
    ]),
    reviewGptRequiredNow: readBooleanAt(value, ["summary", "reviewGptRequiredNow"]),
    rowLevelDataAcceptedByR1186: readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1186"]),
    rowOwnerConfirmationInferredByR1186: readBooleanAt(value, [
      "summary",
      "rowOwnerConfirmationInferredByR1186",
    ]),
    rowOwnerPrivateValuesStored: readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]),
    rowOwnerSafeConfirmationValuesStoredInR1186Packet: readBooleanAt(value, [
      "summary",
      "rowOwnerSafeConfirmationValuesStoredInR1186Packet",
    ]),
    rowParsingPerformedByR1186: readBooleanAt(value, ["summary", "rowParsingPerformedByR1186"]),
    safeSubmissionPacketReady: readBooleanAt(value, ["summary", "safeSubmissionPacketReady"]),
    schemaCurrent: readStringAt(value, ["schemaVersion"])
      === R1186_AVERAGE_SUBMITTER_SAFE_SUBMISSION_PACKET_SCHEMA_VERSION,
    sourcePriorityMatches: readStringAt(value, ["summary", "sourcePriority"]) === TARGET_INPUT_PRIORITY,
    status: readStringAt(value, ["status"]) === "research-local-aggregate-only"
      ? "research-local-aggregate-only"
      : null,
    targetAgeBandMatches: readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND,
  };
}

function stateFromR1130(value: unknown | null): R1130State {
  return {
    artifactBoundaryAggregateOnly: readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]),
    artifactBoundaryUnsafeTrueFlagFound: hasUnsafeTrueBoundaryFlag(value),
    conclusion: readStringInSetAt(value, ["summary", "conclusion"], R1130_CONCLUSION_IDS),
    configIntakeCommandRecognized: readStringAt(value, [
      "realEvidenceHandoff",
      "commands",
      "configIntakeCommand",
    ]) === R1130_CONFIG_INTAKE_COMMAND,
    inputArtifactAvailable: value !== null,
    metricIntakeCommandRecognized: readStringAt(value, [
      "realEvidenceHandoff",
      "commands",
      "metricIntakeCommand",
    ]) === R1124_METRIC_INTAKE_COMMAND,
    privateConfigReadiness: readStringInSetAt(
      value,
      ["realEvidenceHandoff", "currentPrivateConfig", "readiness"],
      PRIVATE_CONFIG_READINESS_IDS,
    ),
    privateRunnerCommandRecognized: readStringAt(value, [
      "realEvidenceHandoff",
      "commands",
      "privateRunnerCommand",
    ]) === R1130_PRIVATE_RUNNER_COMMAND,
    productDisplayAuthorized: readBooleanAt(value, ["summary", "productDisplayAuthorized"]),
    reviewGptRequiredNow: readBooleanAt(value, ["summary", "reviewGptRequiredNow"]),
    rowOwnerWorkType: readStringInSetAt(value, ["summary", "rowOwnerWorkType"], ROW_OWNER_WORK_TYPE_IDS),
    rowParsingPerformedByR1130: readBooleanAt(value, ["summary", "rowParsingPerformedByR1130"]),
    nextAction: readStringInSetAt(value, ["summary", "nextAction"], R1130_NEXT_ACTION_IDS),
    packetId: readStringAt(value, ["packetId"]) === R1130_PACKET_ID ? R1130_PACKET_ID : null,
    schemaCurrent: readStringAt(value, ["schemaVersion"])
      === R1130_ORDINARY_CONSUMER_REAL_EVIDENCE_HANDOFF_SCHEMA_VERSION,
    status: readStringAt(value, ["status"]) === "research-local-aggregate-only"
      ? "research-local-aggregate-only"
      : null,
  };
}

function stateFromR1124(value: unknown | null): R1124State {
  return {
    aggregateMetricsProvided: readBooleanAt(value, ["metricIntake", "aggregateMetricsProvided"]),
    aggregateMetricsTemplateRecognized: readStringAt(value, ["metricIntake", "aggregateMetricsTemplateArtifact"])
      === "r1124-fillable-consumer-first-pass-aggregate-metrics.json",
    artifactBoundaryAggregateOnly: readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]),
    artifactBoundaryUnsafeTrueFlagFound: hasUnsafeTrueBoundaryFlag(value),
    conclusion: readStringInSetAt(value, ["summary", "conclusion"], R1124_CONCLUSION_IDS),
    inputArtifactAvailable: value !== null,
    nextAction: readStringInSetAt(value, ["summary", "nextAction"], R1124_NEXT_ACTION_IDS),
    productDisplayAuthorized: readBooleanAt(value, ["summary", "productDisplayAuthorized"]),
    receiptArtifactRecognized: readStringAt(value, ["metricIntake", "receiptArtifact"])
      === "r1124-consumer-first-pass-aggregate-receipt.json",
    reviewGptRequiredNow: readBooleanAt(value, ["summary", "reviewGptRequiredNow"]),
    rowParsingPerformedByR1124: readBooleanAt(value, ["summary", "rowParsingPerformedByR1124"]),
    packetId: readStringAt(value, ["packetId"]) === R1124_PACKET_ID ? R1124_PACKET_ID : null,
    schemaCurrent: readStringAt(value, ["schemaVersion"])
      === R1124_CONSUMER_FIRST_PASS_AGGREGATE_METRIC_INTAKE_SCHEMA_VERSION,
    status: readStringAt(value, ["status"]) === "research-local-aggregate-only"
      ? "research-local-aggregate-only"
      : null,
    submissionEvidenceRole: readStringInSetAt(
      value,
      ["metricIntake", "submissionEvidenceRole"],
      SUBMISSION_EVIDENCE_ROLE_IDS,
    ),
  };
}

function stateFromR1105(value: unknown | null): R1105State {
  return {
    artifactBoundaryAggregateOnly: readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]),
    artifactBoundaryUnsafeTrueFlagFound: hasUnsafeTrueBoundaryFlag(value),
    inputArtifactAvailable: value !== null,
    nextValidationCommandRecognized: readStringAt(value, ["summary", "nextValidationCommand"])
      === R1104_RECEIPT_VALIDATION_COMMAND,
    productDisplayAuthorized: readBooleanAt(value, ["summary", "productDisplayAuthorized"]),
    packetId: readStringAt(value, ["packetId"]) === R1105_PACKET_ID ? R1105_PACKET_ID : null,
    schemaCurrent: readStringAt(value, ["schemaVersion"])
      === R1105_CONSUMER_AGGREGATE_RECEIPT_TEMPLATE_SCHEMA_VERSION,
    status: readStringAt(value, ["status"]) === "research-local-aggregate-only"
      ? "research-local-aggregate-only"
      : null,
    templateReadyForDataFill: readBooleanAt(value, ["summary", "templateReadyForDataFill"]),
  };
}

function stateFromR1142(value: unknown | null): R1142State {
  return {
    artifactBoundaryAggregateOnly: readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]),
    artifactBoundaryUnsafeTrueFlagFound: hasUnsafeTrueBoundaryFlag(value),
    conclusion: readStringInSetAt(value, ["summary", "conclusion"], R1142_CONCLUSION_IDS),
    fullSupportedRouteReady: readBooleanAt(value, ["summary", "fullSupportedRouteReady"]),
    inputArtifactAvailable: value !== null,
    nextAction: readStringInSetAt(value, ["summary", "nextAction"], R1142_NEXT_ACTION_IDS),
    productDisplayAuthorized: readBooleanAt(value, ["summary", "productDisplayAuthorized"]),
    realAggregateStillMissing: readBooleanAt(value, ["summary", "realAggregateStillMissing"]),
    reviewGptRequiredNow: readBooleanAt(value, ["summary", "reviewGptRequiredNow"]),
    routeMetricsReadyForR1138: readBooleanAt(value, ["summary", "routeMetricsReadyForR1138"]),
    rowParsingPerformedByR1142: readBooleanAt(value, ["summary", "rowParsingPerformedByR1142"]),
    packetId: readStringAt(value, ["packetId"]) === R1142_PACKET_ID ? R1142_PACKET_ID : null,
    schemaCurrent: readStringAt(value, ["schemaVersion"])
      === R1142_ORDINARY_CONSUMER_PARTIAL_PRIVATE_CHAIN_RUNNER_SCHEMA_VERSION,
    status: readStringAt(value, ["status"]) === "research-local-private-inputs-aggregate-output"
      ? "research-local-private-inputs-aggregate-output"
      : null,
  };
}

function transitionFor(state: {
  r1105State: R1105State;
  r1124State: R1124State;
  r1130State: R1130State;
  r1142State: R1142State;
  r1186State: R1186State;
}): Transition {
  if (!r1186Usable(state.r1186State)) {
    return {
      conclusion: "average_submitter_route_metric_readiness_waiting_on_safe_submission_packet_refresh",
      nextAction: "refresh_r1186_safe_submission_packet",
    };
  }
  if (r1186WaitingOnSafeConfirmation(state.r1186State)) {
    return {
      conclusion: "average_submitter_route_metric_readiness_waiting_on_safe_submission_confirmation",
      nextAction: "complete_r1186_boolean_only_safe_confirmation_first",
    };
  }
  if (!r1186FeatureOnlyReady(state.r1186State)) {
    return {
      conclusion: "average_submitter_route_metric_readiness_waiting_on_safe_submission_packet_refresh",
      nextAction: "refresh_r1186_safe_submission_packet",
    };
  }
  if (!routeMetricInputsUsable(state)) {
    return {
      conclusion: "average_submitter_route_metric_readiness_waiting_on_route_metric_input_refresh",
      nextAction: "refresh_route_metric_readiness_inputs",
    };
  }
  if (r1130ReadyForReviewGpt(state.r1130State) || r1124ReadyForReviewGpt(state.r1124State)) {
    return {
      conclusion: "average_submitter_route_metric_readiness_ready_for_reviewgpt_real_delta",
      nextAction: "send_real_consumer_first_pass_delta_to_reviewgpt",
    };
  }
  if (r1130ReadyForPrivateRunner(state.r1130State)) {
    return {
      conclusion: "average_submitter_route_metric_readiness_ready_for_private_runner",
      nextAction: "run_r1125_private_runner_then_r1124_real_metric_intake",
    };
  }
  if (r1130WaitingOnPrivateConfig(state.r1130State)) {
    return {
      conclusion: "average_submitter_route_metric_readiness_waiting_on_row_owner_private_config",
      nextAction: "complete_private_config_for_real_outcome_linked_labs_wearables",
    };
  }
  if (r1124WaitingOnAggregateMetrics(state.r1124State) && r1105TemplateUsable(state.r1105State)) {
    return {
      conclusion: "average_submitter_route_metric_readiness_waiting_on_aggregate_metrics",
      nextAction: "fill_or_ingest_l1_l2_w1_qc_aggregate_metrics",
    };
  }
  if (r1142WaitingOnSafeManifest(state.r1142State)) {
    return {
      conclusion: "average_submitter_route_metric_readiness_waiting_on_safe_manifest",
      nextAction: "run_r1142_partial_private_chain_after_safe_manifest",
    };
  }
  return {
    conclusion: "average_submitter_route_metric_readiness_waiting_on_route_metric_input_refresh",
    nextAction: "refresh_route_metric_readiness_inputs",
  };
}

function r1186Usable(state: R1186State): boolean {
  return state.inputArtifactAvailable
    && state.schemaCurrent
    && state.packetId === R1186_PACKET_ID
    && state.status === "research-local-aggregate-only"
    && state.artifactBoundaryAggregateOnly === true
    && !state.artifactBoundaryUnsafeTrueFlagFound
    && state.minimumPairMatches
    && state.modelEvidencePromotionAllowed === false
    && state.prioritizedInputKindsMatch
    && state.productDisplayAuthorized === false
    && state.reviewGptRequiredNow === false
    && state.rowLevelDataAcceptedByR1186 === false
    && state.rowOwnerConfirmationInferredByR1186 === false
    && state.rowOwnerPrivateValuesStored === false
    && state.rowOwnerSafeConfirmationValuesStoredInR1186Packet === false
    && state.rowParsingPerformedByR1186 === false
    && state.sourcePriorityMatches
    && state.targetAgeBandMatches;
}

function r1186WaitingOnSafeConfirmation(state: R1186State): boolean {
  return r1186Usable(state)
    && state.conclusion === "average_submitter_safe_submission_packet_waiting_on_row_owner_confirmation"
    && state.nextAction === "collect_boolean_only_row_owner_confirmation_then_rerun_r1183"
    && state.nextActionCommandRecognized
    && state.nextActionRequiresExplicitRowOwnerAssertion === true
    && state.safeSubmissionPacketReady === true
    && state.featureOnlyResearchPlanningReady === false
    && state.realLabWearableRouteMetricsRecorded === false;
}

function r1186FeatureOnlyReady(state: R1186State): boolean {
  return r1186Usable(state)
    && state.conclusion === "average_submitter_safe_submission_packet_ready_for_feature_only_research_planning"
    && state.nextAction === "use_r1181_feature_only_execution_contract_for_research_planning_only"
    && !state.nextActionCommandRecognized
    && state.nextActionRequiresExplicitRowOwnerAssertion === false
    && state.safeSubmissionPacketReady === true
    && state.featureOnlyResearchPlanningReady === true;
}

function routeMetricInputsUsable(state: {
  r1105State: R1105State;
  r1124State: R1124State;
  r1130State: R1130State;
  r1142State: R1142State;
}): boolean {
  return r1130Usable(state.r1130State)
    && r1124Usable(state.r1124State)
    && r1105TemplateUsable(state.r1105State)
    && r1142Usable(state.r1142State);
}

function r1130Usable(state: R1130State): boolean {
  return state.inputArtifactAvailable
    && state.schemaCurrent
    && state.packetId === R1130_PACKET_ID
    && state.status === "research-local-aggregate-only"
    && state.artifactBoundaryAggregateOnly === true
    && !state.artifactBoundaryUnsafeTrueFlagFound
    && state.productDisplayAuthorized === false
    && state.rowParsingPerformedByR1130 === false
    && state.configIntakeCommandRecognized
    && state.metricIntakeCommandRecognized
    && state.privateRunnerCommandRecognized;
}

function r1130ReadyForReviewGpt(state: R1130State): boolean {
  return r1130Usable(state)
    && state.conclusion === "ordinary_consumer_real_evidence_handoff_ready_for_reviewgpt_delta"
    && state.nextAction === "send_real_consumer_first_pass_delta_to_reviewgpt"
    && state.reviewGptRequiredNow === true
    && state.rowOwnerWorkType === "review_real_delta";
}

function r1130ReadyForPrivateRunner(state: R1130State): boolean {
  return r1130Usable(state)
    && state.conclusion === "ordinary_consumer_real_evidence_handoff_ready_for_private_runner"
    && state.nextAction === "run_r1125_private_runner_then_r1124_real_metric_intake"
    && state.reviewGptRequiredNow === false
    && state.rowOwnerWorkType === "run_private_runner"
    && state.privateConfigReadiness === "private_config_ready_for_r1125";
}

function r1130WaitingOnPrivateConfig(state: R1130State): boolean {
  return r1130Usable(state)
    && state.conclusion === "ordinary_consumer_real_evidence_handoff_ready_for_row_owner_config"
    && state.nextAction === "complete_private_config_for_real_outcome_linked_labs_wearables"
    && state.reviewGptRequiredNow === false
    && state.rowOwnerWorkType === "complete_private_config";
}

function r1124Usable(state: R1124State): boolean {
  return state.inputArtifactAvailable
    && state.schemaCurrent
    && state.packetId === R1124_PACKET_ID
    && state.status === "research-local-aggregate-only"
    && state.artifactBoundaryAggregateOnly === true
    && !state.artifactBoundaryUnsafeTrueFlagFound
    && state.productDisplayAuthorized === false
    && state.rowParsingPerformedByR1124 === false
    && state.aggregateMetricsTemplateRecognized;
}

function r1124WaitingOnAggregateMetrics(state: R1124State): boolean {
  return r1124Usable(state)
    && state.conclusion === "consumer_first_pass_aggregate_metrics_missing"
    && state.nextAction === "provide_l1_l2_w1_qc_aggregate_metrics_or_fill_private_config"
    && state.aggregateMetricsProvided === false
    && state.reviewGptRequiredNow === false;
}

function r1124ReadyForReviewGpt(state: R1124State): boolean {
  return r1124Usable(state)
    && state.conclusion === "consumer_first_pass_aggregate_receipt_ready_for_reviewgpt"
    && state.nextAction === "send_aggregate_only_consumer_first_pass_delta_to_reviewgpt"
    && state.aggregateMetricsProvided === true
    && state.receiptArtifactRecognized
    && state.reviewGptRequiredNow === true
    && state.submissionEvidenceRole === "real_first_pass_evidence";
}

function r1105TemplateUsable(state: R1105State): boolean {
  return state.inputArtifactAvailable
    && state.schemaCurrent
    && state.packetId === R1105_PACKET_ID
    && state.status === "research-local-aggregate-only"
    && state.artifactBoundaryAggregateOnly === true
    && !state.artifactBoundaryUnsafeTrueFlagFound
    && state.productDisplayAuthorized === false
    && state.templateReadyForDataFill === true
    && state.nextValidationCommandRecognized;
}

function r1142Usable(state: R1142State): boolean {
  return state.inputArtifactAvailable
    && state.schemaCurrent
    && state.packetId === R1142_PACKET_ID
    && state.status === "research-local-private-inputs-aggregate-output"
    && state.artifactBoundaryAggregateOnly === true
    && !state.artifactBoundaryUnsafeTrueFlagFound
    && state.productDisplayAuthorized === false
    && state.reviewGptRequiredNow === false
    && state.rowParsingPerformedByR1142 === false;
}

function r1142WaitingOnSafeManifest(state: R1142State): boolean {
  return r1142Usable(state)
    && state.conclusion === "ordinary_partial_private_chain_waiting_on_safe_manifest"
    && state.nextAction === "fill_safe_availability_manifest_then_run_r1142_partial_private_chain"
    && state.fullSupportedRouteReady === false
    && state.realAggregateStillMissing === true
    && state.routeMetricsReadyForR1138 === false;
}

function commandForNextAction(nextAction: ReadinessNextAction): string | null {
  return NEXT_ACTION_COMMANDS[nextAction];
}

function rejectUnsafeInputs(state: {
  r1105State: R1105State;
  r1124State: R1124State;
  r1130State: R1130State;
  r1142State: R1142State;
  r1186State: R1186State;
}): void {
  const unsafeInputFindings = [
    {
      count: [
        state.r1186State.artifactBoundaryUnsafeTrueFlagFound,
        state.r1186State.modelEvidencePromotionAllowed === true,
        state.r1186State.productDisplayAuthorized === true,
        state.r1186State.reviewGptRequiredNow === true,
        state.r1186State.rowLevelDataAcceptedByR1186 === true,
        state.r1186State.rowOwnerConfirmationInferredByR1186 === true,
        state.r1186State.rowOwnerPrivateValuesStored === true,
        state.r1186State.rowOwnerSafeConfirmationValuesStoredInR1186Packet === true,
        state.r1186State.rowParsingPerformedByR1186 === true,
      ].filter(Boolean).length,
      label: "r1186 safe submission packet",
    },
    {
      count: [
        state.r1130State.artifactBoundaryUnsafeTrueFlagFound,
        state.r1130State.productDisplayAuthorized === true,
        state.r1130State.rowParsingPerformedByR1130 === true,
      ].filter(Boolean).length,
      label: "r1130 real evidence handoff",
    },
    {
      count: [
        state.r1124State.artifactBoundaryUnsafeTrueFlagFound,
        state.r1124State.productDisplayAuthorized === true,
        state.r1124State.rowParsingPerformedByR1124 === true,
      ].filter(Boolean).length,
      label: "r1124 aggregate metric intake",
    },
    {
      count: [
        state.r1105State.artifactBoundaryUnsafeTrueFlagFound,
        state.r1105State.productDisplayAuthorized === true,
      ].filter(Boolean).length,
      label: "r1105 aggregate receipt template",
    },
    {
      count: [
        state.r1142State.artifactBoundaryUnsafeTrueFlagFound,
        state.r1142State.productDisplayAuthorized === true,
        state.r1142State.reviewGptRequiredNow === true,
        state.r1142State.rowParsingPerformedByR1142 === true,
      ].filter(Boolean).length,
      label: "r1142 partial private chain runner",
    },
  ] as const;

  for (const finding of unsafeInputFindings) {
    if (finding.count > 0) {
      throw new Error(`R1187 rejected unsafe ${finding.label}: ${finding.count} ${findingLabel(finding.count)}`);
    }
  }
}

function findingLabel(count: number): "finding" | "findings" {
  return count === 1 ? "finding" : "findings";
}

function summarizeArtifact(
  value: unknown | null,
  artifact: string,
  packetId: string,
  schemaVersion: string,
): ArtifactSummary {
  return {
    artifact,
    packetId: readStringAt(value, ["packetId"]) === packetId ? packetId : null,
    schemaVersion: readStringAt(value, ["schemaVersion"]) === schemaVersion ? schemaVersion : null,
    status: value === null ? "missing" : "available",
  };
}

function safeBoundary() {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelEvidencePromotedByR1187: false,
    modelParametersStored: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    privateConfigValuesStored: false,
    privateDetailsStored: false,
    privateFieldRefValuesStored: false,
    privateFieldRefsStored: false,
    privateTableRefValuesStored: false,
    privateTableRefsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowLevelDataAcceptedByR1187: false,
    rowOwnerPrivateValuesStored: false,
    rowParsingPerformedByR1187: false,
    rowValuesStored: false,
    safeBooleanValuesStoredInR1187Packet: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  } as const;
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    return parsed;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return null;
    }
    if (error instanceof SyntaxError) {
      throw new Error("R1187 input JSON parse failed.");
    }
    throw error;
  }
}

function validateAggregateSafe(label: string, value: unknown | null): void {
  if (value === null) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1187 rejected unsafe ${label}: ${findings.length} ${findingLabel(findings.length)}`);
  }
}

function ensureNoOutputPathInOutput(value: unknown, outputDir: string): void {
  const serialized = JSON.stringify(value);
  if (serialized.includes(outputDir) || serialized.includes(OUTPUT_FILE_NAME)) {
    throw new Error("R1187 output included an output path.");
  }
}

function createdAtFor(value: string | undefined): string {
  const createdAt = value ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new Error("R1187 rejected invalid createdAt timestamp.");
  }
  return createdAt;
}

function hasUnsafeTrueBoundaryFlag(value: unknown): boolean {
  const boundary = readRecordAt(value, ["artifactBoundary"]);
  if (boundary === null) return false;
  return Object.entries(boundary).some(([key, child]) => key !== "aggregateOnly" && child === true);
}

function readRecordAt(value: unknown, pathParts: readonly string[]): Record<string, unknown> | null {
  const found = readAt(value, pathParts);
  return isPlainRecord(found) ? found : null;
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const found = readAt(value, pathParts);
  return typeof found === "string" ? found : null;
}

function readBooleanAt(value: unknown, pathParts: readonly string[]): boolean | null {
  const found = readAt(value, pathParts);
  return typeof found === "boolean" ? found : null;
}

function readStringArrayAt(value: unknown, pathParts: readonly string[]): string[] | null {
  const found = readAt(value, pathParts);
  return Array.isArray(found) && found.every((item) => typeof item === "string") ? [...found] : null;
}

function readStringInSetAt<T extends readonly string[]>(
  value: unknown,
  pathParts: readonly string[],
  values: T,
): T[number] | null {
  const found = readStringAt(value, pathParts);
  return stringSetIncludes(values, found) ? found : null;
}

function readStringArrayInSetAt<T extends readonly string[]>(
  value: unknown,
  pathParts: readonly string[],
  values: T,
): T[number][] | null {
  const found = readStringArrayAt(value, pathParts);
  if (found === null) return null;
  const safeValues: T[number][] = [];
  for (const item of found) {
    if (!stringSetIncludes(values, item)) return null;
    safeValues.push(item);
  }
  return safeValues;
}

function exactStringSet(values: readonly string[] | null, expected: readonly string[]): boolean {
  return values !== null
    && values.length === expected.length
    && values.every((value) => expected.includes(value))
    && expected.every((value) => values.includes(value));
}

function readAt(value: unknown, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!isPlainRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringSetIncludes<T extends readonly string[]>(values: T, value: string | null): value is T[number] {
  return value !== null && values.some((candidate) => candidate === value);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return isPlainRecord(error) && error.code === code;
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  if (isExpectedSafeError(error)) return error.message;
  return fallback;
}

function isExpectedSafeError(error: Error): boolean {
  return error.message === "R1187 input JSON parse failed."
    || error.message === "R1187 output included an output path."
    || error.message === "R1187 rejected invalid createdAt timestamp."
    || /^R1187 rejected unsafe (?:r1186 average submitter safe submission packet|r1130 ordinary consumer real evidence handoff|r1124 consumer first-pass aggregate metric intake|r1105 consumer aggregate receipt template|r1142 ordinary consumer partial private chain runner|r1187 route metric readiness|r1186 safe submission packet|r1130 real evidence handoff|r1124 aggregate metric intake|r1105 aggregate receipt template|r1142 partial private chain runner): \d+ findings?$/u
      .test(error.message);
}

async function main(): Promise<void> {
  try {
    const { output } = await runR1187AverageSubmitterRouteMetricReadiness({
      createdAt: process.env.MURPH_AGE_R1187_CREATED_AT,
      outputDir: process.env.MURPH_AGE_R1187_OUTPUT_DIR,
      r1105Path: process.env.MURPH_AGE_R1105_CONSUMER_AGGREGATE_RECEIPT_TEMPLATE_PATH,
      r1124Path: process.env.MURPH_AGE_R1124_CONSUMER_FIRST_PASS_AGGREGATE_METRIC_INTAKE_PATH,
      r1130Path: process.env.MURPH_AGE_R1130_ORDINARY_CONSUMER_REAL_EVIDENCE_HANDOFF_PATH,
      r1142Path: process.env.MURPH_AGE_R1142_ORDINARY_CONSUMER_PARTIAL_PRIVATE_CHAIN_RUNNER_PATH,
      r1186Path: process.env.MURPH_AGE_R1186_AVERAGE_SUBMITTER_SAFE_SUBMISSION_PACKET_PATH,
    });
    process.stdout.write(`${JSON.stringify({
      conclusion: output.summary.conclusion,
      nextAction: output.summary.nextAction,
      nextActionCommand: output.summary.nextActionCommand,
      packetId: output.packetId,
      realAggregateStillMissing: output.summary.realAggregateStillMissing,
      aggregateMetricsStillMissing: output.summary.aggregateMetricsStillMissing,
      reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
      privateConfigStillRequired: output.summary.privateConfigStillRequired,
      rowOwnerPrivateConfigStillRequired: output.summary.rowOwnerPrivateConfigStillRequired,
      safeConfirmationStillRequired: output.summary.safeConfirmationStillRequired,
      safeSubmissionPacketRefreshRequired: output.summary.safeSubmissionPacketRefreshRequired,
      rowOwnerSafeConfirmationStillRequired: output.summary.rowOwnerSafeConfirmationStillRequired,
      schemaVersion: output.schemaVersion,
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${safeCliErrorMessage(error, "R1187 route metric readiness failed.")}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
