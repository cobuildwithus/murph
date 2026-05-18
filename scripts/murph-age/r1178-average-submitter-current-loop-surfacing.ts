import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_COMMAND,
  R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION,
} from "./r1180-average-submitter-safe-confirmation-response-intake.ts";
import {
  R1181_AVERAGE_SUBMITTER_FEATURE_ONLY_EXECUTION_CONTRACT_COMMAND,
} from "./r1181-average-submitter-feature-only-execution-contract.ts";
import {
  R1182_AVERAGE_SUBMITTER_SAFE_RESPONSE_HANDOFF_COMMAND,
  R1182_AVERAGE_SUBMITTER_SAFE_RESPONSE_HANDOFF_SCHEMA_VERSION,
} from "./r1182-average-submitter-safe-response-handoff.ts";

export const R1178_AVERAGE_SUBMITTER_CURRENT_LOOP_SURFACING_SCHEMA_VERSION =
  "murph-age-r1178-average-submitter-current-loop-surfacing.v1" as const;
export const R1178_AVERAGE_SUBMITTER_CURRENT_LOOP_SURFACING_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1178-average-submitter-current-loop-surfacing.ts" as const;
const R1177_ORDINARY_CONSUMER_AVERAGE_SUBMITTER_PRIORITY_PACKET_SCHEMA_VERSION =
  "murph-age-r1177-ordinary-consumer-average-submitter-priority-packet.v1" as const;
const R1177_AVERAGE_SUBMITTER_PRIORITY_PACKET_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1177-ordinary-consumer-average-submitter-priority-packet.ts" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs"
);
const OUTPUT_FILE_NAME =
  "r1178-average-submitter-current-loop-surfacing.latest.json" as const;
const R1076_ARTIFACT =
  "r1076-current-autoresearch-loop-executor.latest.json" as const;
const R1177_ARTIFACT =
  "r1177-ordinary-consumer-average-submitter-priority-packet.latest.json" as const;
const R1185_ARTIFACT =
  "r1185-average-submitter-safe-response-smoke-proof.latest.json" as const;
const R1182_ARTIFACT =
  "r1182-average-submitter-safe-response-handoff.latest.json" as const;
const R1076_PACKET_ID = "r1076-current-autoresearch-loop-executor" as const;
const R1076_SCHEMA_VERSION =
  "murph-age-r1076-current-autoresearch-loop-executor.v1" as const;
const R1177_PACKET_ID =
  "r1177-ordinary-consumer-average-submitter-priority-packet" as const;
const R1185_PACKET_ID =
  "r1185-average-submitter-safe-response-smoke-proof" as const;
const R1185_SCHEMA_VERSION =
  "murph-age-r1185-average-submitter-safe-response-smoke-proof.v1" as const;
const R1182_PACKET_ID = "r1182-average-submitter-safe-response-handoff" as const;
const TARGET_INPUT_PRIORITY =
  "consumer_bloodwork_labs_wearables_16_50_first" as const;
const TARGET_AGE_BAND = "roughly_16_50" as const;
const MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
] as const;
const REQUIRED_INPUT_KIND_IDS = [
  "lab_portal_export_or_spreadsheet",
  "phone_watch_or_wearable_activity_export",
] as const;
const OPTIONAL_CONTEXT_SOURCE_FAMILY_IDS = [
  "common_bloodwork_core",
  "vitals_body_context",
] as const;
const DEFERRED_UNTIL_MINIMUM_PAIR_CONFIRMED_IDS = [
  "common_bloodwork_core",
  "vitals_body_context",
  "wearable_sleep",
  "wearable_recovery",
  "wearable_hrv",
  "advanced_biomarkers",
] as const;
const FIRST_PASS_SUBMISSION_PRIORITY_ORDER_IDS = [
  "glycemia_bloodwork_labs_first",
  "daily_activity_phone_watch_wearable_first",
  "routine_labs_optional_after_minimum_pair",
  "basic_vitals_context_optional_after_minimum_pair",
  "sleep_recovery_hrv_after_minimum_pair",
  "advanced_biomarkers_last",
] as const;
const REQUIRED_SAFE_RESPONSE_FIELD_IDS = [
  "confirm_target_age_band_roughly_16_50",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
] as const;
const REQUIRED_SAFE_RESPONSE_TEMPLATE_KEYS = [
  "askId",
  "confirmDailyWearableActivityExportAvailable",
  "confirmGlycemiaBloodworkExportAvailable",
  "confirmNoPrivateValuesIncluded",
  "confirmTargetAgeBandRoughly16To50",
  "responseKind",
  "schemaVersion",
] as const;
const SAFE_RESPONSE_EXECUTION_FEATURE_SLOT_IDS = [
  "glycemia_lab_presence",
  "glycemia_measurement_date_presence",
  "daily_activity_presence",
  "daily_wear_coverage_presence",
] as const;
const FIRST_SUBMITTER_ASK_IDS = [
  "has_glycemia_bloodwork_export",
  "has_daily_wearable_activity_export",
  "can_confirm_without_private_values",
] as const;
const SAFE_COMPLETION_CHECKLIST_ITEM_IDS = [
  "confirm_target_age_band_without_identifiers",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
] as const;
const BLOCKED_CONTENT_IDS = [
  "private_paths",
  "header_names",
  "file_names",
  "row_values",
  "participant_identifiers",
  "private_ref_values",
  "source_variable_names",
  "predictions",
  "coefficients",
  "model_parameters",
  "source_text",
  "small_cells",
] as const;
const ALLOWED_VALUE_KIND_IDS = [
  "booleans_only",
  "fixed_enumerated_ids_only",
] as const;
const R1177_MISSING_REQUIREMENT_IDS = [
  "row_owner_availability_assertions_confirmed",
  "confirmed_recipe_route_requirements_available",
  "private_route_config_supplied",
  "real_lab_wearable_route_metrics_recorded",
] as const;
const SURFACING_BLOCKER_IDS = [
  "r1076_current_loop_missing_or_stale",
  "r1177_average_submitter_priority_packet_missing_or_stale",
] as const;
const R1177_CONCLUSIONS = [
  "ordinary_average_submitter_priority_packet_ready_for_feature_only_research_handoff",
  "ordinary_average_submitter_priority_packet_waiting_on_completion_audit",
  "ordinary_average_submitter_priority_packet_waiting_on_live_chain_packet",
  "ordinary_average_submitter_priority_packet_waiting_on_minimum_pair_confirmation",
  "ordinary_average_submitter_priority_packet_waiting_on_safe_next_step_packet",
] as const;
const R1177_NEXT_ACTIONS = [
  "refresh_r1145_completion_audit",
  "refresh_r1174_safe_next_step_packet",
  "refresh_r1176_row_owner_safe_assertion_chain",
  "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation",
  "run_r1164_feature_only_research_handoff",
] as const;
const SAFE_R1076_CONCLUSIONS = [
  "executor_waiting_on_consumer_safe_availability_confirmation",
  "executor_ready_for_consumer_first_pass_aggregate_metrics",
  "executor_waiting_on_consumer_first_pass_aggregate_metrics",
  "executor_waiting_on_consumer_private_config",
  "executor_waiting_on_consumer_real_lab_wearable_route_metrics",
] as const;
const SAFE_R1076_ACTIONS = [
  "collect_or_run_real_outcome_linked_labs_wearables_aggregate_metrics",
  "complete_private_config_for_real_outcome_linked_labs_wearables",
  "fill_average_submitter_private_config_slots",
  "fill_consumer_first_pass_aggregate_metrics_template",
  "fill_safe_availability_confirmation_from_template",
  "provide_r1125_private_runner_config_or_fill_r1124_template",
  "refresh_r1174_safe_next_step_packet",
  "refresh_r1176_row_owner_safe_assertion_chain",
  "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation",
  "run_r1164_feature_only_research_handoff",
] as const;
const R1076_CURRENT_LOOP_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1076-current-autoresearch-loop-executor.ts" as const;
const R1145_COMPLETION_AUDIT_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1145-ordinary-consumer-current-chain-completion-audit.ts" as const;
const R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1173-ordinary-consumer-safe-assertion-answer-sheet.ts" as const;
const R1174_SAFE_NEXT_STEP_PACKET_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1174-ordinary-consumer-safe-next-step-packet.ts" as const;
const R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND =
  "MURPH_AGE_R1176_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTIONS_CONFIRMED=true pnpm exec tsx scripts/murph-age/r1176-r1172-r1165-row-owner-safe-assertion-chain-runner.ts" as const;
const R1164_FEATURE_ONLY_RESEARCH_HANDOFF_COMMAND =
  "MURPH_AGE_R1163_FEATURE_ONLY_SAFE_CONFIRMATION_TO_RESEARCH_RUNNER_PATH=<r1163-runner.json> pnpm exec tsx scripts/murph-age/r1164-ordinary-consumer-feature-only-research-handoff.ts" as const;
const R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1183-average-submitter-safe-response-materializer.ts" as const;
const R1184_AVERAGE_SUBMITTER_SAFE_RESPONSE_CHAIN_STATUS_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1184-average-submitter-safe-response-chain-status.ts" as const;
const R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1185-average-submitter-safe-response-smoke-proof.ts" as const;
const ROW_OWNER_ACTION_AUDIENCE =
  "ordinary_submitter_roughly_16_50_row_owner" as const;
const REQUIRED_ASSERTION_CHECKLIST_IDS = [
  "assert_target_age_band_roughly_16_50",
  "assert_glycemia_bloodwork_export_available",
  "assert_daily_wearable_activity_export_available",
  "assert_no_private_values_identifiers_paths_headers_or_rows",
] as const;
const ROW_OWNER_ACTION_IDS = [
  "fill_r1180_safe_confirmation_response_template",
  "review_r1173_safe_assertion_answer_sheet",
  "review_r1174_safe_next_step_packet",
  "explicitly_run_r1176_live_chain_if_all_safe_assertions_are_true",
  "run_r1164_feature_only_research_handoff_after_minimum_pair_confirmed",
] as const;
const R1184_CONCLUSIONS = [
  "average_submitter_safe_response_chain_ready_for_feature_only_research_planning",
  "average_submitter_safe_response_chain_waiting_on_r1180_confirmed_response_intake",
  "average_submitter_safe_response_chain_waiting_on_r1180_response",
  "average_submitter_safe_response_chain_waiting_on_r1181_feature_contract",
  "average_submitter_safe_response_chain_waiting_on_r1182_handoff",
  "average_submitter_safe_response_chain_waiting_on_r1183_refresh",
  "average_submitter_safe_response_chain_waiting_on_row_owner_confirmation",
] as const;
const R1185_CONCLUSIONS = [
  "average_submitter_safe_response_smoke_passed_non_evidence",
  "average_submitter_safe_response_smoke_waiting_on_live_r1184_row_owner_blocker",
] as const;
const R1185_NEXT_REAL_ACTIONS = [
  "obtain_real_row_owner_safe_confirmation_then_rerun_r1183",
  "refresh_r1184_safe_response_chain_status",
] as const;
const R1182_CONCLUSIONS = [
  "average_submitter_safe_response_handoff_ready_for_research_planning_only",
  "average_submitter_safe_response_handoff_waiting_on_row_owner_confirmation",
  "average_submitter_safe_response_handoff_waiting_on_r1181_refresh",
  "average_submitter_safe_response_handoff_rejected_r1180_response_shape",
] as const;
const R1182_NEXT_ACTIONS = [
  "fill_r1180_safe_confirmation_response_template",
  "refresh_r1181_feature_only_execution_contract",
  "rerun_r1180_with_valid_safe_confirmation_response",
  "use_r1181_feature_only_execution_contract_for_research_planning_only",
  "none",
] as const;

type MinimumFeaturePairSourceFamilyId =
  (typeof MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS)[number];
type RequiredInputKindId = (typeof REQUIRED_INPUT_KIND_IDS)[number];
type OptionalContextSourceFamilyId =
  (typeof OPTIONAL_CONTEXT_SOURCE_FAMILY_IDS)[number];
type DeferredUntilMinimumPairConfirmedId =
  (typeof DEFERRED_UNTIL_MINIMUM_PAIR_CONFIRMED_IDS)[number];
type FirstPassSubmissionPriorityOrderId =
  (typeof FIRST_PASS_SUBMISSION_PRIORITY_ORDER_IDS)[number];
type RequiredSafeResponseFieldId =
  (typeof REQUIRED_SAFE_RESPONSE_FIELD_IDS)[number];
type RequiredSafeResponseTemplateKey =
  (typeof REQUIRED_SAFE_RESPONSE_TEMPLATE_KEYS)[number];
type SafeResponseExecutionFeatureSlotId =
  (typeof SAFE_RESPONSE_EXECUTION_FEATURE_SLOT_IDS)[number];
type FirstSubmitterAskId = (typeof FIRST_SUBMITTER_ASK_IDS)[number];
type SafeCompletionChecklistItemId =
  (typeof SAFE_COMPLETION_CHECKLIST_ITEM_IDS)[number];
type BlockedContentId = (typeof BLOCKED_CONTENT_IDS)[number];
type AllowedValueKindId = (typeof ALLOWED_VALUE_KIND_IDS)[number];
type R1177MissingRequirementId = (typeof R1177_MISSING_REQUIREMENT_IDS)[number];
type SurfacingBlockerId = (typeof SURFACING_BLOCKER_IDS)[number];
type R1177Conclusion = (typeof R1177_CONCLUSIONS)[number];
type R1177NextAction = (typeof R1177_NEXT_ACTIONS)[number];
type SafeR1076Conclusion = (typeof SAFE_R1076_CONCLUSIONS)[number];
type SafeR1076Action = (typeof SAFE_R1076_ACTIONS)[number];
type RequiredAssertionChecklistId =
  (typeof REQUIRED_ASSERTION_CHECKLIST_IDS)[number];
type RowOwnerActionId = (typeof ROW_OWNER_ACTION_IDS)[number];
type R1184Conclusion = (typeof R1184_CONCLUSIONS)[number];
type R1185Conclusion = (typeof R1185_CONCLUSIONS)[number];
type R1185NextRealAction = (typeof R1185_NEXT_REAL_ACTIONS)[number];
type R1182Conclusion = (typeof R1182_CONCLUSIONS)[number];
type R1182NextAction = (typeof R1182_NEXT_ACTIONS)[number];
type RowOwnerActionRouteStatus =
  | "feature_only_research_handoff_ready"
  | "waiting_on_current_loop_or_priority_packet"
  | "waiting_on_row_owner_feature_only_assertion";
type SurfacingConclusion =
  | "average_submitter_priority_visible_in_current_loop"
  | "average_submitter_priority_waiting_on_current_loop_and_priority_packets"
  | "average_submitter_priority_waiting_on_current_loop_packet"
  | "average_submitter_priority_waiting_on_r1177_priority_packet";
type SurfacingNextAction =
  | "refresh_r1076_current_loop_executor"
  | "refresh_r1177_average_submitter_priority_packet"
  | R1177NextAction;

const UNSAFE_UPSTREAM_BOUNDARY_FLAG_NAMES = [
  "codebookTextStored",
  "coefficientsStored",
  "fileNamesStored",
  "headerValuesStored",
  "localFileNamesStored",
  "localPathsStored",
  "modelEvidencePromotedByR1177",
  "modelParametersStored",
  "outcomeScoringPerformedByR1076",
  "participantIdentifiersStored",
  "participantIdentifiersWritten",
  "predictionsStored",
  "privateConfigValuesStored",
  "privateDetailsStored",
  "privateFieldRefValuesStored",
  "privateFieldRefsStored",
  "privateTableRefValuesStored",
  "privateTableRefsStored",
  "productClaimsIncluded",
  "productDisplayAuthorized",
  "productPromotionAuthorized",
  "recommendationClaimsIncluded",
  "rowLevelDataAcceptedByR1177",
  "rowOwnerConfirmationInferredByR1177",
  "rowOwnerPrivateValuesStored",
  "rowOwnerProvidedValuesStored",
  "rowParsingPerformedByR1076",
  "rowParsingPerformedByR1177",
  "rowValuesStored",
  "smallCellsStored",
  "sourceBodiesStored",
  "sourceFileNamesStored",
  "sourceVariableNamesStored",
  "splitMembershipStored",
] as const;
const COMMAND_BY_SURFACING_NEXT_ACTION = {
  refresh_r1076_current_loop_executor: R1076_CURRENT_LOOP_COMMAND,
  refresh_r1145_completion_audit: R1145_COMPLETION_AUDIT_COMMAND,
  refresh_r1174_safe_next_step_packet: R1174_SAFE_NEXT_STEP_PACKET_COMMAND,
  refresh_r1176_row_owner_safe_assertion_chain:
    R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
  refresh_r1177_average_submitter_priority_packet:
    R1177_AVERAGE_SUBMITTER_PRIORITY_PACKET_COMMAND,
  rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation:
    R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
  run_r1164_feature_only_research_handoff:
    R1164_FEATURE_ONLY_RESEARCH_HANDOFF_COMMAND,
} satisfies Record<SurfacingNextAction, string>;

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface RowOwnerOnlyAction {
  actionId: RowOwnerActionId;
  command: string;
  rowOwnerOnly: true;
  storesPrivateDetailsInPacket: false;
}

interface RowOwnerActionRoute {
  allowedValueKindIds: AllowedValueKindId[];
  audience: typeof ROW_OWNER_ACTION_AUDIENCE;
  blockedContentIds: BlockedContentId[];
  firstRunnableActionId: RowOwnerActionId | null;
  liveChainCommand: typeof R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND;
  minimumFeaturePairRequired: MinimumFeaturePairSourceFamilyId[];
  nextAction: SurfacingNextAction;
  productDisplayAuthorized: false;
  requiredAssertionChecklistIds: RequiredAssertionChecklistId[];
  requiredInputKindIds: RequiredInputKindId[];
  rowOwnerActionRouteStatus: RowOwnerActionRouteStatus;
  rowOwnerOnlyActions: RowOwnerOnlyAction[];
  rowOwnerPrivateValuesStored: false;
  rowParsingPerformedByR1178: false;
  safeCompletionChecklistItemIds: SafeCompletionChecklistItemId[];
  sourcePriority: typeof TARGET_INPUT_PRIORITY;
  targetAgeBand: typeof TARGET_AGE_BAND;
}

interface AverageSubmitterSubmissionPriority {
  averageSubmitterLikelySubmittable: true;
  deferredUntilMinimumPairConfirmedIds: DeferredUntilMinimumPairConfirmedId[];
  firstPassOnly: true;
  firstPassSubmissionPriorityOrderIds: FirstPassSubmissionPriorityOrderId[];
  minimumFeaturePairRequired: MinimumFeaturePairSourceFamilyId[];
  modelEvidencePromotionAllowed: false;
  optionalContextNotRequiredForFirstStep: OptionalContextSourceFamilyId[];
  prioritizedInputKindIds: RequiredInputKindId[];
  productDisplayAuthorized: false;
  rowLevelDataAcceptedByR1178: false;
  rowParsingPerformedByR1178: false;
  sourcePriority: typeof TARGET_INPUT_PRIORITY;
  targetAgeBand: typeof TARGET_AGE_BAND;
}

interface SafeResponseSmokeProofSummary {
  artifact: typeof R1185_ARTIFACT;
  command: typeof R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_COMMAND | null;
  conclusion: R1185Conclusion | null;
  liveArtifactsMutatedByR1185: boolean | null;
  liveR1184Conclusion: R1184Conclusion | null;
  liveR1184ReadyForSyntheticSmoke: boolean | null;
  minimumFeaturePairRequired: MinimumFeaturePairSourceFamilyId[];
  modelEvidencePromotionAllowed: false;
  nextRealAction: R1185NextRealAction | null;
  nextRealActionCommand: string | null;
  nextRealActionRequiresExplicitRowOwnerAssertion: boolean | null;
  prioritizedInputKindIds: RequiredInputKindId[];
  productDisplayAuthorized: false;
  recognized: boolean;
  requiredResponseFieldIds: RequiredSafeResponseFieldId[];
  reviewGptRequiredNow: false;
  rowLevelDataAcceptedByR1185: boolean | null;
  rowOwnerConfirmationInferredByR1185: boolean | null;
  rowOwnerPrivateValuesStored: boolean | null;
  rowParsingPerformedByR1185: boolean | null;
  safeExecutionFeatureSlotIds: SafeResponseExecutionFeatureSlotId[];
  sourcePriority: typeof TARGET_INPUT_PRIORITY;
  syntheticNonEvidence: boolean;
  syntheticPathAdvancedToFeatureOnlyResearchPlanning: boolean | null;
  syntheticSmokeRan: boolean | null;
  targetAgeBand: typeof TARGET_AGE_BAND;
}

interface SafeConfirmationResponseTemplate {
  askId: "confirm_feature_only_lab_wearable_availability_without_private_values";
  confirmDailyWearableActivityExportAvailable: false;
  confirmGlycemiaBloodworkExportAvailable: false;
  confirmNoPrivateValuesIncluded: false;
  confirmTargetAgeBandRoughly16To50: false;
  responseKind: "explicit_yes_all_required_assertions_confirmed";
  schemaVersion: typeof R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION;
}

interface SafeResponseHandoffSummary {
  allowedValueKindIds: AllowedValueKindId[];
  artifact: typeof R1182_ARTIFACT;
  blockedContentIds: BlockedContentId[];
  command: typeof R1182_AVERAGE_SUBMITTER_SAFE_RESPONSE_HANDOFF_COMMAND | null;
  conclusion: R1182Conclusion | null;
  minimumFeaturePairRequired: MinimumFeaturePairSourceFamilyId[];
  modelEvidencePromotionAllowed: false;
  nextAction: R1182NextAction | null;
  nextActionCommand: string | null;
  prioritizedInputKindIds: RequiredInputKindId[];
  productDisplayAuthorized: false;
  recognized: boolean;
  requiredAssertionChecklistIds: RequiredAssertionChecklistId[];
  requiredResponseFieldIds: RequiredSafeResponseFieldId[];
  responseTemplate: SafeConfirmationResponseTemplate | null;
  responseTemplateKeyOrder: RequiredSafeResponseTemplateKey[];
  reviewGptRequiredNow: false;
  rowLevelDataAcceptedByR1182: boolean | null;
  rowOwnerConfirmationInferredByR1182: boolean | null;
  rowOwnerPrivateValuesStored: boolean | null;
  rowParsingPerformedByR1182: boolean | null;
  safeCompletionChecklistItemIds: SafeCompletionChecklistItemId[];
  sourcePriority: typeof TARGET_INPUT_PRIORITY;
  targetAgeBand: typeof TARGET_AGE_BAND;
}

export interface R1178AverageSubmitterCurrentLoopSurfacingOptions {
  createdAt?: string;
  outputDir?: string;
  r1076Path?: string;
  r1177Path?: string;
  r1182Path?: string;
  r1185Path?: string;
}

export interface R1178AverageSubmitterCurrentLoopSurfacingOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    fileNamesStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelEvidencePromotedByR1178: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    privateConfigValuesStored: false;
    privateDetailsStored: false;
    privateFieldRefValuesStored: false;
    privateFieldRefsStored: false;
    privateTableRefValuesStored: false;
    privateTableRefsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowLevelDataAcceptedByR1178: false;
    rowOwnerConfirmationInferredByR1178: false;
    rowOwnerPrivateValuesStored: false;
    rowOwnerProvidedValuesStored: false;
    rowParsingPerformedByR1178: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  currentLoopSurfacing: {
    allowedValueKindIds: AllowedValueKindId[];
    averageSubmitterPriorityPacketCommand: typeof R1177_AVERAGE_SUBMITTER_PRIORITY_PACKET_COMMAND;
    averageSubmitterSubmissionPriority: AverageSubmitterSubmissionPriority;
    blockedContentIds: BlockedContentId[];
    conclusion: SurfacingConclusion;
    currentLoopCommand: string;
    currentLoopConclusionBeforePriorityPacket: SafeR1076Conclusion | null;
    currentLoopNextActionBeforePriorityPacket: SafeR1076Action | null;
    currentMissingRequirementIds: R1177MissingRequirementId[];
    currentSurfacingBlockerIds: SurfacingBlockerId[];
    deferredUntilMinimumPairConfirmedIds: DeferredUntilMinimumPairConfirmedId[];
    firstSubmitterAskIds: FirstSubmitterAskId[];
    minimumFeaturePairConfirmed: boolean;
    minimumFeaturePairRequired: MinimumFeaturePairSourceFamilyId[];
    nextAction: SurfacingNextAction;
    optionalContextNotRequiredForFirstStep: OptionalContextSourceFamilyId[];
    prioritizedInputKindIds: RequiredInputKindId[];
    priorityVisibleInCurrentLoop: boolean;
    productDisplayAuthorized: false;
    r1076CurrentLoopRecognized: boolean;
    r1177PriorityPacketRecognized: boolean;
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1178: false;
    rowOwnerConfirmationInferredByR1178: false;
    rowOwnerPrivateValuesStored: false;
    rowParsingPerformedByR1178: false;
    rowOwnerActionRoute: RowOwnerActionRoute;
    safeResponseHandoff: SafeResponseHandoffSummary;
    safeResponseSmokeProof: SafeResponseSmokeProofSummary;
    safeCompletionChecklistItemIds: SafeCompletionChecklistItemId[];
    sourcePriority: typeof TARGET_INPUT_PRIORITY;
    targetAgeBand: typeof TARGET_AGE_BAND;
    topRequirementId: R1177MissingRequirementId | SurfacingBlockerId | null;
    upstreamR1177Conclusion: R1177Conclusion | null;
    upstreamR1177NextAction: R1177NextAction | null;
  };
  inputArtifacts: {
    r1076CurrentLoopExecutor: ArtifactSummary;
    r1177AverageSubmitterPriorityPacket: ArtifactSummary;
    r1182AverageSubmitterSafeResponseHandoff: ArtifactSummary;
    r1185AverageSubmitterSafeResponseSmokeProof: ArtifactSummary;
  };
  packetId: "r1178-average-submitter-current-loop-surfacing";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1178_AVERAGE_SUBMITTER_CURRENT_LOOP_SURFACING_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    allowedValueKindIds: AllowedValueKindId[];
    averageSubmitterPriorityPacketCommand: typeof R1177_AVERAGE_SUBMITTER_PRIORITY_PACKET_COMMAND;
    averageSubmitterSubmissionPriority: AverageSubmitterSubmissionPriority;
    blockedContentIds: BlockedContentId[];
    conclusion: SurfacingConclusion;
    currentLoopCommand: string;
    currentLoopConclusionBeforePriorityPacket: SafeR1076Conclusion | null;
    currentLoopNextActionBeforePriorityPacket: SafeR1076Action | null;
    currentMissingRequirementIds: R1177MissingRequirementId[];
    currentSurfacingBlockerIds: SurfacingBlockerId[];
    deferredUntilMinimumPairConfirmedIds: DeferredUntilMinimumPairConfirmedId[];
    firstSubmitterAskIds: FirstSubmitterAskId[];
    minimumFeaturePairConfirmed: boolean;
    minimumFeaturePairRequired: MinimumFeaturePairSourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    nextAction: SurfacingNextAction;
    optionalContextNotRequiredForFirstStep: OptionalContextSourceFamilyId[];
    prioritizedInputKindIds: RequiredInputKindId[];
    priorityVisibleInCurrentLoop: boolean;
    productDisplayAuthorized: false;
    r1076CurrentLoopRecognized: boolean;
    r1177PriorityPacketRecognized: boolean;
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1178: false;
    rowOwnerConfirmationInferredByR1178: false;
    rowOwnerPrivateValuesStored: false;
    rowParsingPerformedByR1178: false;
    rowOwnerActionRoute: RowOwnerActionRoute;
    safeResponseHandoff: SafeResponseHandoffSummary;
    safeResponseSmokeProof: SafeResponseSmokeProofSummary;
    safeCompletionChecklistItemIds: SafeCompletionChecklistItemId[];
    sourcePriority: typeof TARGET_INPUT_PRIORITY;
    targetAgeBand: typeof TARGET_AGE_BAND;
    topRequirementId: R1177MissingRequirementId | SurfacingBlockerId | null;
    upstreamR1177Conclusion: R1177Conclusion | null;
    upstreamR1177NextAction: R1177NextAction | null;
  };
}

export async function runR1178AverageSubmitterCurrentLoopSurfacing(
  options: R1178AverageSubmitterCurrentLoopSurfacingOptions = {}
): Promise<{
  output: R1178AverageSubmitterCurrentLoopSurfacingOutput;
  outputPath: string;
}> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const r1076Path =
    options.r1076Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1076_ARTIFACT);
  const r1177Path =
    options.r1177Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1177_ARTIFACT);
  const r1182Path =
    options.r1182Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1182_ARTIFACT);
  const r1185Path =
    options.r1185Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1185_ARTIFACT);
  const r1076 = await readJsonIfPresent(r1076Path);
  const r1177 = await readJsonIfPresent(r1177Path);
  const r1182 = await readJsonIfPresent(r1182Path);
  const r1185 = await readJsonIfPresent(r1185Path);
  validateAggregateSafe("r1076 current loop executor", r1076);
  validateAggregateSafe("r1177 average-submitter priority packet", r1177);
  validateAggregateSafe("r1182 safe response handoff", r1182);
  validateAggregateSafe("r1185 safe response smoke proof", r1185);

  const r1076Ready = matchesR1076CurrentLoop(r1076);
  const r1177Ready = matchesR1177AverageSubmitterPriorityPacket(r1177);
  const upstreamR1177Conclusion = r1177Ready
    ? parseAllowedString(
        readStringAt(r1177, ["summary", "conclusion"]),
        R1177_CONCLUSIONS
      )
    : null;
  const upstreamR1177NextAction = r1177Ready
    ? parseAllowedString(
        readStringAt(r1177, ["summary", "nextAction"]),
        R1177_NEXT_ACTIONS
      )
    : null;
  const currentMissingRequirementIds = r1177Ready
    ? filteredR1177MissingRequirementIds(r1177)
    : [];
  const currentSurfacingBlockerIds = surfacingBlockerIdsFor({
    r1076Ready,
    r1177Ready,
  });
  const conclusion = conclusionFor({ r1076Ready, r1177Ready });
  const nextAction = nextActionFor({
    r1076Ready,
    r1177Ready,
    upstreamR1177NextAction,
  });
  const priorityVisibleInCurrentLoop = r1076Ready && r1177Ready;
  const minimumFeaturePairConfirmed =
    r1177Ready &&
    readBooleanAt(r1177, ["summary", "minimumFeaturePairConfirmed"]) === true;
  const currentLoopConclusionBeforePriorityPacket = r1076Ready
    ? parseAllowedString(
        readStringAt(r1076, ["summary", "conclusion"]),
        SAFE_R1076_CONCLUSIONS
      )
    : null;
  const currentLoopNextActionBeforePriorityPacket = r1076Ready
    ? parseAllowedString(
        readStringAt(r1076, ["summary", "nextAction"]),
        SAFE_R1076_ACTIONS
      )
    : null;
  const topRequirementId =
    currentSurfacingBlockerIds[0] ?? currentMissingRequirementIds[0] ?? null;
  const rowOwnerActionRoute = rowOwnerActionRouteFor({
    minimumFeaturePairConfirmed,
    nextAction,
    priorityVisibleInCurrentLoop,
  });
  const averageSubmitterSubmissionPriority =
    buildAverageSubmitterSubmissionPriority();
  const safeResponseHandoff = safeResponseHandoffFor(r1182);
  const safeResponseSmokeProof = safeResponseSmokeProofFor(r1185);
  const currentLoopCommand = currentLoopCommandFor(
    rowOwnerActionRoute,
    safeResponseHandoff
  );
  const createdAt = createdAtFor(options.createdAt);

  const summary: R1178AverageSubmitterCurrentLoopSurfacingOutput["summary"] = {
    allowedValueKindIds: [...ALLOWED_VALUE_KIND_IDS],
    averageSubmitterPriorityPacketCommand:
      R1177_AVERAGE_SUBMITTER_PRIORITY_PACKET_COMMAND,
    averageSubmitterSubmissionPriority,
    blockedContentIds: [...BLOCKED_CONTENT_IDS],
    conclusion,
    currentLoopCommand,
    currentLoopConclusionBeforePriorityPacket,
    currentLoopNextActionBeforePriorityPacket,
    currentMissingRequirementIds,
    currentSurfacingBlockerIds,
    deferredUntilMinimumPairConfirmedIds: [
      ...DEFERRED_UNTIL_MINIMUM_PAIR_CONFIRMED_IDS,
    ],
    firstSubmitterAskIds: [...FIRST_SUBMITTER_ASK_IDS],
    minimumFeaturePairConfirmed,
    minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS],
    modelEvidencePromotionAllowed: false,
    nextAction,
    optionalContextNotRequiredForFirstStep: [
      ...OPTIONAL_CONTEXT_SOURCE_FAMILY_IDS,
    ],
    prioritizedInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
    priorityVisibleInCurrentLoop,
    productDisplayAuthorized: false,
    r1076CurrentLoopRecognized: r1076Ready,
    r1177PriorityPacketRecognized: r1177Ready,
    reviewGptRequiredNow: false,
    rowLevelDataAcceptedByR1178: false,
    rowOwnerConfirmationInferredByR1178: false,
    rowOwnerPrivateValuesStored: false,
    rowParsingPerformedByR1178: false,
    rowOwnerActionRoute,
    safeResponseHandoff,
    safeResponseSmokeProof,
    safeCompletionChecklistItemIds: [...SAFE_COMPLETION_CHECKLIST_ITEM_IDS],
    sourcePriority: TARGET_INPUT_PRIORITY,
    targetAgeBand: TARGET_AGE_BAND,
    topRequirementId,
    upstreamR1177Conclusion,
    upstreamR1177NextAction,
  };

  const output: R1178AverageSubmitterCurrentLoopSurfacingOutput = {
    artifactBoundary: safeBoundary(),
    createdAt,
    currentLoopSurfacing: {
      allowedValueKindIds: summary.allowedValueKindIds,
      averageSubmitterPriorityPacketCommand:
        summary.averageSubmitterPriorityPacketCommand,
      averageSubmitterSubmissionPriority:
        summary.averageSubmitterSubmissionPriority,
      blockedContentIds: summary.blockedContentIds,
      conclusion: summary.conclusion,
      currentLoopCommand: summary.currentLoopCommand,
      currentLoopConclusionBeforePriorityPacket:
        summary.currentLoopConclusionBeforePriorityPacket,
      currentLoopNextActionBeforePriorityPacket:
        summary.currentLoopNextActionBeforePriorityPacket,
      currentMissingRequirementIds: summary.currentMissingRequirementIds,
      currentSurfacingBlockerIds: summary.currentSurfacingBlockerIds,
      deferredUntilMinimumPairConfirmedIds:
        summary.deferredUntilMinimumPairConfirmedIds,
      firstSubmitterAskIds: summary.firstSubmitterAskIds,
      minimumFeaturePairConfirmed: summary.minimumFeaturePairConfirmed,
      minimumFeaturePairRequired: summary.minimumFeaturePairRequired,
      nextAction: summary.nextAction,
      optionalContextNotRequiredForFirstStep:
        summary.optionalContextNotRequiredForFirstStep,
      prioritizedInputKindIds: summary.prioritizedInputKindIds,
      priorityVisibleInCurrentLoop: summary.priorityVisibleInCurrentLoop,
      productDisplayAuthorized: false,
      r1076CurrentLoopRecognized: summary.r1076CurrentLoopRecognized,
      r1177PriorityPacketRecognized: summary.r1177PriorityPacketRecognized,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1178: false,
      rowOwnerConfirmationInferredByR1178: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1178: false,
      rowOwnerActionRoute: summary.rowOwnerActionRoute,
      safeResponseHandoff: summary.safeResponseHandoff,
      safeResponseSmokeProof: summary.safeResponseSmokeProof,
      safeCompletionChecklistItemIds: summary.safeCompletionChecklistItemIds,
      sourcePriority: summary.sourcePriority,
      targetAgeBand: summary.targetAgeBand,
      topRequirementId: summary.topRequirementId,
      upstreamR1177Conclusion: summary.upstreamR1177Conclusion,
      upstreamR1177NextAction: summary.upstreamR1177NextAction,
    },
    inputArtifacts: {
      r1076CurrentLoopExecutor: summarizeArtifact({
        artifact: R1076_ARTIFACT,
        expectedPacketId: R1076_PACKET_ID,
        expectedSchemaVersion: R1076_SCHEMA_VERSION,
        value: r1076,
      }),
      r1177AverageSubmitterPriorityPacket: summarizeArtifact({
        artifact: R1177_ARTIFACT,
        expectedPacketId: R1177_PACKET_ID,
        expectedSchemaVersion:
          R1177_ORDINARY_CONSUMER_AVERAGE_SUBMITTER_PRIORITY_PACKET_SCHEMA_VERSION,
        value: r1177,
      }),
      r1182AverageSubmitterSafeResponseHandoff: summarizeArtifact({
        artifact: R1182_ARTIFACT,
        expectedPacketId: R1182_PACKET_ID,
        expectedSchemaVersion:
          R1182_AVERAGE_SUBMITTER_SAFE_RESPONSE_HANDOFF_SCHEMA_VERSION,
        value: r1182,
      }),
      r1185AverageSubmitterSafeResponseSmokeProof: summarizeArtifact({
        artifact: R1185_ARTIFACT,
        expectedPacketId: R1185_PACKET_ID,
        expectedSchemaVersion: R1185_SCHEMA_VERSION,
        value: r1185,
      }),
    },
    packetId: "r1178-average-submitter-current-loop-surfacing",
    productDisplayAuthorized: false,
    schemaVersion:
      R1178_AVERAGE_SUBMITTER_CURRENT_LOOP_SURFACING_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary,
  };

  ensureNoOutputPathInOutput(output, outputDir);
  validateAggregateSafe(
    "r1178 average submitter current-loop surfacing",
    output
  );
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function matchesR1076CurrentLoop(value: unknown | null): boolean {
  return (
    readStringAt(value, ["packetId"]) === R1076_PACKET_ID &&
    readStringAt(value, ["schemaVersion"]) === R1076_SCHEMA_VERSION &&
    readStringAt(value, ["status"]) === "research-local-aggregate-only" &&
    readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true &&
    noTrueArtifactBoundaryFlags(value) &&
    readBooleanAt(value, ["artifactBoundary", "productDisplayAuthorized"]) ===
      false &&
    readBooleanAt(value, ["artifactBoundary", "rowParsingPerformedByR1076"]) ===
      false &&
    readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false &&
    readBooleanAt(value, ["summary", "reviewGptRequiredNow"]) === false &&
    readBooleanAt(value, ["summary", "rowParsingPerformedByR1076"]) === false &&
    parseAllowedString(
      readStringAt(value, ["summary", "conclusion"]),
      SAFE_R1076_CONCLUSIONS
    ) !== null &&
    parseAllowedString(
      readStringAt(value, ["summary", "nextAction"]),
      SAFE_R1076_ACTIONS
    ) !== null
  );
}

function matchesR1177AverageSubmitterPriorityPacket(
  value: unknown | null
): boolean {
  return (
    readStringAt(value, ["packetId"]) === R1177_PACKET_ID &&
    readStringAt(value, ["schemaVersion"]) ===
      R1177_ORDINARY_CONSUMER_AVERAGE_SUBMITTER_PRIORITY_PACKET_SCHEMA_VERSION &&
    readStringAt(value, ["status"]) === "research-local-aggregate-only" &&
    readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true &&
    noTrueArtifactBoundaryFlags(value) &&
    readBooleanAt(value, ["artifactBoundary", "productDisplayAuthorized"]) ===
      false &&
    readBooleanAt(value, [
      "artifactBoundary",
      "rowLevelDataAcceptedByR1177",
    ]) === false &&
    readBooleanAt(value, [
      "artifactBoundary",
      "rowOwnerConfirmationInferredByR1177",
    ]) === false &&
    readBooleanAt(value, ["artifactBoundary", "rowParsingPerformedByR1177"]) ===
      false &&
    readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND &&
    readStringAt(value, ["summary", "targetInputPriority"]) ===
      TARGET_INPUT_PRIORITY &&
    parseAllowedString(
      readStringAt(value, ["summary", "conclusion"]),
      R1177_CONCLUSIONS
    ) !== null &&
    parseAllowedString(
      readStringAt(value, ["summary", "nextAction"]),
      R1177_NEXT_ACTIONS
    ) !== null &&
    matchesR1177StateConsistency(value) &&
    exactStringSet(
      readStringArrayAt(value, ["summary", "minimumFeaturePairRequired"]),
      MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS
    ) &&
    exactStringSet(
      readStringArrayAt(value, ["summary", "prioritizedInputKindIds"]),
      REQUIRED_INPUT_KIND_IDS
    ) &&
    exactStringSet(
      readStringArrayAt(value, ["summary", "firstSubmitterAskIds"]),
      FIRST_SUBMITTER_ASK_IDS
    ) &&
    exactStringSet(
      readStringArrayAt(value, [
        "summary",
        "optionalContextNotRequiredForFirstStep",
      ]),
      OPTIONAL_CONTEXT_SOURCE_FAMILY_IDS
    ) &&
    exactStringSet(
      readStringArrayAt(value, [
        "summary",
        "deferredUntilMinimumPairConfirmedIds",
      ]),
      DEFERRED_UNTIL_MINIMUM_PAIR_CONFIRMED_IDS
    ) &&
    readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false &&
    readBooleanAt(value, ["summary", "reviewGptRequiredNow"]) === false &&
    readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1177"]) ===
      false &&
    readBooleanAt(value, ["summary", "rowOwnerConfirmationInferredByR1177"]) ===
      false &&
    readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]) ===
      false &&
    readBooleanAt(value, ["summary", "rowParsingPerformedByR1177"]) === false &&
    readStringAt(value, ["averageSubmitterPriorityPacket", "targetAgeBand"]) ===
      TARGET_AGE_BAND &&
    readStringAt(value, [
      "averageSubmitterPriorityPacket",
      "targetInputPriority",
    ]) === TARGET_INPUT_PRIORITY &&
    readStringAt(value, [
      "averageSubmitterPriorityPacket",
      "rowOwnerOnlyCommand",
    ]) === R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND &&
    exactStringSet(
      readStringArrayAt(value, [
        "averageSubmitterPriorityPacket",
        "minimumFeaturePairRequired",
      ]),
      MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS
    ) &&
    exactStringSet(
      readStringArrayAt(value, [
        "averageSubmitterPriorityPacket",
        "prioritizedInputKindIds",
      ]),
      REQUIRED_INPUT_KIND_IDS
    ) &&
    readBooleanAt(value, [
      "averageSubmitterPriorityPacket",
      "productDisplayAuthorized",
    ]) === false &&
    readBooleanAt(value, [
      "averageSubmitterPriorityPacket",
      "minimumFeaturePairConfirmed",
    ]) === readBooleanAt(value, ["summary", "minimumFeaturePairConfirmed"]) &&
    readBooleanAt(value, [
      "averageSubmitterPriorityPacket",
      "rowLevelDataAcceptedByR1177",
    ]) === false &&
    readBooleanAt(value, [
      "averageSubmitterPriorityPacket",
      "rowOwnerConfirmationInferredByR1177",
    ]) === false &&
    readBooleanAt(value, [
      "averageSubmitterPriorityPacket",
      "rowOwnerPrivateValuesStored",
    ]) === false
  );
}

function matchesR1177StateConsistency(value: unknown | null): boolean {
  const conclusion = parseAllowedString(
    readStringAt(value, ["summary", "conclusion"]),
    R1177_CONCLUSIONS
  );
  const nextAction = parseAllowedString(
    readStringAt(value, ["summary", "nextAction"]),
    R1177_NEXT_ACTIONS
  );
  const minimumFeaturePairConfirmed = readBooleanAt(value, [
    "summary",
    "minimumFeaturePairConfirmed",
  ]);
  const currentMissingRequirementIds = readStringArrayAt(value, [
    "summary",
    "currentMissingRequirementIds",
  ]);
  if (
    conclusion === null ||
    nextAction === null ||
    minimumFeaturePairConfirmed === null ||
    readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]) !==
      false ||
    !isUniqueStringSubset(
      currentMissingRequirementIds,
      R1177_MISSING_REQUIREMENT_IDS
    )
  ) {
    return false;
  }

  if (
    conclusion ===
    "ordinary_average_submitter_priority_packet_ready_for_feature_only_research_handoff"
  ) {
    return (
      nextAction === "run_r1164_feature_only_research_handoff" &&
      minimumFeaturePairConfirmed &&
      currentMissingRequirementIds.length === 0
    );
  }
  if (minimumFeaturePairConfirmed) return false;
  if (
    conclusion ===
    "ordinary_average_submitter_priority_packet_waiting_on_completion_audit"
  ) {
    return nextAction === "refresh_r1145_completion_audit";
  }
  if (
    conclusion ===
    "ordinary_average_submitter_priority_packet_waiting_on_safe_next_step_packet"
  ) {
    return nextAction === "refresh_r1174_safe_next_step_packet";
  }
  if (
    conclusion ===
    "ordinary_average_submitter_priority_packet_waiting_on_live_chain_packet"
  ) {
    return nextAction === "refresh_r1176_row_owner_safe_assertion_chain";
  }
  return (
    nextAction ===
      "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation" &&
    currentMissingRequirementIds.includes(
      "row_owner_availability_assertions_confirmed"
    )
  );
}

function noTrueArtifactBoundaryFlags(value: unknown | null): boolean {
  return UNSAFE_UPSTREAM_BOUNDARY_FLAG_NAMES.every(
    (flagName) => readBooleanAt(value, ["artifactBoundary", flagName]) !== true
  );
}

function isUniqueStringSubset(
  actual: string[],
  allowedValues: readonly string[]
): boolean {
  const allowed = new Set<string>(allowedValues);
  const actualSet = new Set(actual);
  return (
    actual.length === actualSet.size &&
    actual.every((item) => allowed.has(item))
  );
}

function filteredR1177MissingRequirementIds(
  value: unknown | null
): R1177MissingRequirementId[] {
  const allowed = new Set<string>(R1177_MISSING_REQUIREMENT_IDS);
  return readStringArrayAt(value, [
    "summary",
    "currentMissingRequirementIds",
  ]).filter((item): item is R1177MissingRequirementId => allowed.has(item));
}

function surfacingBlockerIdsFor(input: {
  r1076Ready: boolean;
  r1177Ready: boolean;
}): SurfacingBlockerId[] {
  const blockerIds: SurfacingBlockerId[] = [];
  if (!input.r1076Ready) blockerIds.push("r1076_current_loop_missing_or_stale");
  if (!input.r1177Ready)
    blockerIds.push("r1177_average_submitter_priority_packet_missing_or_stale");
  return blockerIds;
}

function conclusionFor(input: {
  r1076Ready: boolean;
  r1177Ready: boolean;
}): SurfacingConclusion {
  if (!input.r1076Ready && !input.r1177Ready) {
    return "average_submitter_priority_waiting_on_current_loop_and_priority_packets";
  }
  if (!input.r1076Ready) {
    return "average_submitter_priority_waiting_on_current_loop_packet";
  }
  if (!input.r1177Ready) {
    return "average_submitter_priority_waiting_on_r1177_priority_packet";
  }
  return "average_submitter_priority_visible_in_current_loop";
}

function nextActionFor(input: {
  r1076Ready: boolean;
  r1177Ready: boolean;
  upstreamR1177NextAction: R1177NextAction | null;
}): SurfacingNextAction {
  if (!input.r1076Ready) return "refresh_r1076_current_loop_executor";
  if (!input.r1177Ready)
    return "refresh_r1177_average_submitter_priority_packet";
  return (
    input.upstreamR1177NextAction ??
    "refresh_r1177_average_submitter_priority_packet"
  );
}

function commandForNextAction(nextAction: SurfacingNextAction): string {
  return COMMAND_BY_SURFACING_NEXT_ACTION[nextAction];
}

function currentLoopCommandFor(
  rowOwnerActionRoute: RowOwnerActionRoute,
  safeResponseHandoff: SafeResponseHandoffSummary
): string {
  if (
    rowOwnerActionRoute.rowOwnerActionRouteStatus ===
    "waiting_on_row_owner_feature_only_assertion"
  ) {
    if (
      safeResponseHandoff.recognized &&
      safeResponseHandoff.nextAction ===
        "fill_r1180_safe_confirmation_response_template" &&
      safeResponseHandoff.nextActionCommand ===
        R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_COMMAND
    ) {
      return R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_COMMAND;
    }
    return R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND;
  }
  if (
    rowOwnerActionRoute.rowOwnerActionRouteStatus ===
    "feature_only_research_handoff_ready"
  ) {
    return R1164_FEATURE_ONLY_RESEARCH_HANDOFF_COMMAND;
  }
  return commandForNextAction(rowOwnerActionRoute.nextAction);
}

function rowOwnerActionRouteFor(input: {
  minimumFeaturePairConfirmed: boolean;
  nextAction: SurfacingNextAction;
  priorityVisibleInCurrentLoop: boolean;
}): RowOwnerActionRoute {
  const rowOwnerActionRouteStatus = rowOwnerActionRouteStatusFor(input);
  return {
    allowedValueKindIds: [...ALLOWED_VALUE_KIND_IDS],
    audience: ROW_OWNER_ACTION_AUDIENCE,
    blockedContentIds: [...BLOCKED_CONTENT_IDS],
    firstRunnableActionId: firstRunnableRowOwnerActionIdFor(
      rowOwnerActionRouteStatus
    ),
    liveChainCommand: R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
    minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS],
    nextAction: input.nextAction,
    productDisplayAuthorized: false,
    requiredAssertionChecklistIds: [...REQUIRED_ASSERTION_CHECKLIST_IDS],
    requiredInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
    rowOwnerActionRouteStatus,
    rowOwnerOnlyActions: rowOwnerOnlyActionsFor(),
    rowOwnerPrivateValuesStored: false,
    rowParsingPerformedByR1178: false,
    safeCompletionChecklistItemIds: [...SAFE_COMPLETION_CHECKLIST_ITEM_IDS],
    sourcePriority: TARGET_INPUT_PRIORITY,
    targetAgeBand: TARGET_AGE_BAND,
  };
}

function buildAverageSubmitterSubmissionPriority(): AverageSubmitterSubmissionPriority {
  return {
    averageSubmitterLikelySubmittable: true,
    deferredUntilMinimumPairConfirmedIds: [
      ...DEFERRED_UNTIL_MINIMUM_PAIR_CONFIRMED_IDS,
    ],
    firstPassOnly: true,
    firstPassSubmissionPriorityOrderIds: [
      ...FIRST_PASS_SUBMISSION_PRIORITY_ORDER_IDS,
    ],
    minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS],
    modelEvidencePromotionAllowed: false,
    optionalContextNotRequiredForFirstStep: [
      ...OPTIONAL_CONTEXT_SOURCE_FAMILY_IDS,
    ],
    prioritizedInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
    productDisplayAuthorized: false,
    rowLevelDataAcceptedByR1178: false,
    rowParsingPerformedByR1178: false,
    sourcePriority: TARGET_INPUT_PRIORITY,
    targetAgeBand: TARGET_AGE_BAND,
  };
}

function safeResponseHandoffFor(
  value: unknown | null
): SafeResponseHandoffSummary {
  if (!matchesR1182SafeResponseHandoff(value)) {
    return {
      allowedValueKindIds: [],
      artifact: R1182_ARTIFACT,
      blockedContentIds: [],
      command: null,
      conclusion: null,
      minimumFeaturePairRequired: [],
      modelEvidencePromotionAllowed: false,
      nextAction: null,
      nextActionCommand: null,
      prioritizedInputKindIds: [],
      productDisplayAuthorized: false,
      recognized: false,
      requiredAssertionChecklistIds: [],
      requiredResponseFieldIds: [],
      responseTemplate: null,
      responseTemplateKeyOrder: [],
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1182: null,
      rowOwnerConfirmationInferredByR1182: null,
      rowOwnerPrivateValuesStored: null,
      rowParsingPerformedByR1182: null,
      safeCompletionChecklistItemIds: [],
      sourcePriority: TARGET_INPUT_PRIORITY,
      targetAgeBand: TARGET_AGE_BAND,
    };
  }

  const nextAction = parseAllowedString(
    readStringAt(value, ["summary", "nextAction"]),
    R1182_NEXT_ACTIONS
  );
  return {
    allowedValueKindIds: [...ALLOWED_VALUE_KIND_IDS],
    artifact: R1182_ARTIFACT,
    blockedContentIds: [...BLOCKED_CONTENT_IDS],
    command: R1182_AVERAGE_SUBMITTER_SAFE_RESPONSE_HANDOFF_COMMAND,
    conclusion: parseAllowedString(
      readStringAt(value, ["summary", "conclusion"]),
      R1182_CONCLUSIONS
    ),
    minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS],
    modelEvidencePromotionAllowed: false,
    nextAction,
    nextActionCommand: commandForR1182NextAction(nextAction),
    prioritizedInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
    productDisplayAuthorized: false,
    recognized: true,
    requiredAssertionChecklistIds: [...REQUIRED_ASSERTION_CHECKLIST_IDS],
    requiredResponseFieldIds: [...REQUIRED_SAFE_RESPONSE_FIELD_IDS],
    responseTemplate: buildSafeConfirmationResponseTemplate(),
    responseTemplateKeyOrder: [...REQUIRED_SAFE_RESPONSE_TEMPLATE_KEYS],
    reviewGptRequiredNow: false,
    rowLevelDataAcceptedByR1182: readBooleanAt(value, [
      "summary",
      "rowLevelDataAcceptedByR1182",
    ]),
    rowOwnerConfirmationInferredByR1182: readBooleanAt(value, [
      "summary",
      "rowOwnerConfirmationInferredByR1182",
    ]),
    rowOwnerPrivateValuesStored: readBooleanAt(value, [
      "summary",
      "rowOwnerPrivateValuesStored",
    ]),
    rowParsingPerformedByR1182: readBooleanAt(value, [
      "summary",
      "rowParsingPerformedByR1182",
    ]),
    safeCompletionChecklistItemIds: [...SAFE_COMPLETION_CHECKLIST_ITEM_IDS],
    sourcePriority: TARGET_INPUT_PRIORITY,
    targetAgeBand: TARGET_AGE_BAND,
  };
}

function matchesR1182SafeResponseHandoff(value: unknown | null): boolean {
  const nextAction = parseAllowedString(
    readStringAt(value, ["summary", "nextAction"]),
    R1182_NEXT_ACTIONS
  );
  return (
    readStringAt(value, ["packetId"]) === R1182_PACKET_ID &&
    readStringAt(value, ["schemaVersion"]) ===
      R1182_AVERAGE_SUBMITTER_SAFE_RESPONSE_HANDOFF_SCHEMA_VERSION &&
    readStringAt(value, ["status"]) === "research-local-aggregate-only" &&
    readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true &&
    noTrueArtifactBoundaryFlags(value) &&
    readBooleanAt(value, ["artifactBoundary", "productDisplayAuthorized"]) ===
      false &&
    parseAllowedString(
      readStringAt(value, ["summary", "conclusion"]),
      R1182_CONCLUSIONS
    ) !== null &&
    nextAction !== null &&
    readStringAt(value, ["summary", "nextActionCommand"]) ===
      commandForR1182NextAction(nextAction) &&
    readStringAt(value, ["summary", "sourcePriority"]) ===
      TARGET_INPUT_PRIORITY &&
    readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND &&
    exactStringSet(
      readStringArrayAt(value, ["summary", "minimumFeaturePairRequired"]),
      MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS
    ) &&
    exactStringSet(
      readStringArrayAt(value, ["summary", "requiredResponseFieldIds"]),
      REQUIRED_SAFE_RESPONSE_FIELD_IDS
    ) &&
    readStringAt(value, ["summary", "responseTemplateSchemaVersion"]) ===
      R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION &&
    readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]) ===
      false &&
    readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false &&
    readBooleanAt(value, ["summary", "reviewGptRequiredNow"]) === false &&
    readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1182"]) ===
      false &&
    readBooleanAt(value, [
      "summary",
      "rowOwnerConfirmationInferredByR1182",
    ]) === false &&
    readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]) === false &&
    readBooleanAt(value, ["summary", "rowParsingPerformedByR1182"]) ===
      false &&
    exactStringSet(
      readStringArrayAt(value, ["safeResponseHandoff", "allowedValueKindIds"]),
      ALLOWED_VALUE_KIND_IDS
    ) &&
    exactStringSet(
      readStringArrayAt(value, ["safeResponseHandoff", "blockedContentIds"]),
      BLOCKED_CONTENT_IDS
    ) &&
    exactStringSet(
      readStringArrayAt(value, [
        "safeResponseHandoff",
        "minimumFeaturePairRequired",
      ]),
      MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS
    ) &&
    exactStringSet(
      readStringArrayAt(value, ["safeResponseHandoff", "prioritizedInputKindIds"]),
      REQUIRED_INPUT_KIND_IDS
    ) &&
    exactStringSet(
      readStringArrayAt(value, [
        "safeResponseHandoff",
        "requiredAssertionChecklistIds",
      ]),
      REQUIRED_ASSERTION_CHECKLIST_IDS
    ) &&
    exactStringSet(
      readStringArrayAt(value, ["safeResponseHandoff", "requiredResponseFieldIds"]),
      REQUIRED_SAFE_RESPONSE_FIELD_IDS
    ) &&
    exactStringSet(
      readStringArrayAt(value, ["safeResponseHandoff", "responseTemplateKeyOrder"]),
      REQUIRED_SAFE_RESPONSE_TEMPLATE_KEYS
    ) &&
    exactStringSet(
      readStringArrayAt(value, [
        "safeResponseHandoff",
        "safeCompletionChecklistItemIds",
      ]),
      SAFE_COMPLETION_CHECKLIST_ITEM_IDS
    ) &&
    readBooleanAt(value, [
      "safeResponseHandoff",
      "modelEvidencePromotionAllowed",
    ]) === false &&
    readBooleanAt(value, ["safeResponseHandoff", "productDisplayAuthorized"]) ===
      false &&
    readBooleanAt(value, ["safeResponseHandoff", "reviewGptRequiredNow"]) ===
      false &&
    readBooleanAt(value, [
      "safeResponseHandoff",
      "rowLevelDataAcceptedByR1182",
    ]) === false &&
    readBooleanAt(value, [
      "safeResponseHandoff",
      "rowOwnerConfirmationInferredByR1182",
    ]) === false &&
    readBooleanAt(value, [
      "safeResponseHandoff",
      "rowOwnerPrivateValuesStored",
    ]) === false &&
    readBooleanAt(value, [
      "safeResponseHandoff",
      "rowParsingPerformedByR1182",
    ]) === false &&
    matchesSafeConfirmationResponseTemplate(
      readAt(value, ["safeResponseHandoff", "responseTemplate"])
    )
  );
}

function matchesSafeConfirmationResponseTemplate(value: unknown): boolean {
  return (
    readStringAt(value, ["askId"]) ===
      "confirm_feature_only_lab_wearable_availability_without_private_values" &&
    readBooleanAt(value, ["confirmDailyWearableActivityExportAvailable"]) ===
      false &&
    readBooleanAt(value, ["confirmGlycemiaBloodworkExportAvailable"]) ===
      false &&
    readBooleanAt(value, ["confirmNoPrivateValuesIncluded"]) === false &&
    readBooleanAt(value, ["confirmTargetAgeBandRoughly16To50"]) === false &&
    readStringAt(value, ["responseKind"]) ===
      "explicit_yes_all_required_assertions_confirmed" &&
    readStringAt(value, ["schemaVersion"]) ===
      R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION
  );
}

function buildSafeConfirmationResponseTemplate(): SafeConfirmationResponseTemplate {
  return {
    askId: "confirm_feature_only_lab_wearable_availability_without_private_values",
    confirmDailyWearableActivityExportAvailable: false,
    confirmGlycemiaBloodworkExportAvailable: false,
    confirmNoPrivateValuesIncluded: false,
    confirmTargetAgeBandRoughly16To50: false,
    responseKind: "explicit_yes_all_required_assertions_confirmed",
    schemaVersion: R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION,
  };
}

function commandForR1182NextAction(nextAction: R1182NextAction | null): string | null {
  if (
    nextAction === "fill_r1180_safe_confirmation_response_template" ||
    nextAction === "rerun_r1180_with_valid_safe_confirmation_response"
  ) {
    return R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_COMMAND;
  }
  if (nextAction === "refresh_r1181_feature_only_execution_contract") {
    return R1181_AVERAGE_SUBMITTER_FEATURE_ONLY_EXECUTION_CONTRACT_COMMAND;
  }
  return null;
}

function safeResponseSmokeProofFor(
  value: unknown | null
): SafeResponseSmokeProofSummary {
  if (!matchesR1185SafeResponseSmokeProof(value)) {
    return {
      artifact: R1185_ARTIFACT,
      command: null,
      conclusion: null,
      liveArtifactsMutatedByR1185: null,
      liveR1184Conclusion: null,
      liveR1184ReadyForSyntheticSmoke: null,
      minimumFeaturePairRequired: [],
      modelEvidencePromotionAllowed: false,
      nextRealAction: null,
      nextRealActionCommand: null,
      nextRealActionRequiresExplicitRowOwnerAssertion: null,
      prioritizedInputKindIds: [],
      productDisplayAuthorized: false,
      recognized: false,
      requiredResponseFieldIds: [],
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1185: null,
      rowOwnerConfirmationInferredByR1185: null,
      rowOwnerPrivateValuesStored: null,
      rowParsingPerformedByR1185: null,
      safeExecutionFeatureSlotIds: [],
      sourcePriority: TARGET_INPUT_PRIORITY,
      syntheticNonEvidence: false,
      syntheticPathAdvancedToFeatureOnlyResearchPlanning: null,
      syntheticSmokeRan: null,
      targetAgeBand: TARGET_AGE_BAND,
    };
  }

  return {
    artifact: R1185_ARTIFACT,
    command: R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_COMMAND,
    conclusion: parseAllowedString(
      readStringAt(value, ["summary", "conclusion"]),
      R1185_CONCLUSIONS
    ),
    liveArtifactsMutatedByR1185: readBooleanAt(value, [
      "smokeProof",
      "liveArtifactsMutatedByR1185",
    ]),
    liveR1184Conclusion: parseAllowedString(
      readStringAt(value, ["summary", "liveR1184Conclusion"]),
      R1184_CONCLUSIONS
    ),
    liveR1184ReadyForSyntheticSmoke: readBooleanAt(value, [
      "summary",
      "liveR1184ReadyForSyntheticSmoke",
    ]),
    minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS],
    modelEvidencePromotionAllowed: false,
    nextRealAction: parseAllowedString(
      readStringAt(value, ["summary", "nextRealAction"]),
      R1185_NEXT_REAL_ACTIONS
    ),
    nextRealActionCommand: readStringAt(value, [
      "summary",
      "nextRealActionCommand",
    ]),
    nextRealActionRequiresExplicitRowOwnerAssertion: readBooleanAt(value, [
      "summary",
      "nextRealActionRequiresExplicitRowOwnerAssertion",
    ]),
    prioritizedInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
    productDisplayAuthorized: false,
    recognized: true,
    requiredResponseFieldIds: [...REQUIRED_SAFE_RESPONSE_FIELD_IDS],
    reviewGptRequiredNow: false,
    rowLevelDataAcceptedByR1185: readBooleanAt(value, [
      "smokeProof",
      "rowLevelDataAcceptedByR1185",
    ]),
    rowOwnerConfirmationInferredByR1185: readBooleanAt(value, [
      "smokeProof",
      "rowOwnerConfirmationInferredByR1185",
    ]),
    rowOwnerPrivateValuesStored: readBooleanAt(value, [
      "smokeProof",
      "rowOwnerPrivateValuesStored",
    ]),
    rowParsingPerformedByR1185: readBooleanAt(value, [
      "smokeProof",
      "rowParsingPerformedByR1185",
    ]),
    safeExecutionFeatureSlotIds: readBooleanAt(value, [
      "summary",
      "syntheticPathAdvancedToFeatureOnlyResearchPlanning",
    ])
      ? [...SAFE_RESPONSE_EXECUTION_FEATURE_SLOT_IDS]
      : [],
    sourcePriority: TARGET_INPUT_PRIORITY,
    syntheticNonEvidence: true,
    syntheticPathAdvancedToFeatureOnlyResearchPlanning: readBooleanAt(value, [
      "summary",
      "syntheticPathAdvancedToFeatureOnlyResearchPlanning",
    ]),
    syntheticSmokeRan: readBooleanAt(value, ["summary", "syntheticSmokeRan"]),
    targetAgeBand: TARGET_AGE_BAND,
  };
}

function matchesR1185SafeResponseSmokeProof(value: unknown | null): boolean {
  const conclusion = parseAllowedString(
    readStringAt(value, ["summary", "conclusion"]),
    R1185_CONCLUSIONS
  );
  const liveR1184Conclusion = readStringAt(value, [
    "summary",
    "liveR1184Conclusion",
  ]);
  const parsedLiveR1184Conclusion = parseAllowedString(
    readStringAt(value, ["summary", "liveR1184Conclusion"]),
    R1184_CONCLUSIONS
  );
  const nextRealAction = parseAllowedString(
    readStringAt(value, ["summary", "nextRealAction"]),
    R1185_NEXT_REAL_ACTIONS
  );
  const nextRealActionCommand = readStringAt(value, [
    "summary",
    "nextRealActionCommand",
  ]);
  const syntheticPathAdvanced = readBooleanAt(value, [
    "summary",
    "syntheticPathAdvancedToFeatureOnlyResearchPlanning",
  ]);
  const safeExecutionFeatureSlotIds = readStringArrayAt(value, [
    "smokeProof",
    "safeExecutionFeatureSlotIds",
  ]);
  const nextRealActionMatchesCommand =
    (nextRealAction === "obtain_real_row_owner_safe_confirmation_then_rerun_r1183" &&
      nextRealActionCommand ===
        R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND) ||
    (nextRealAction === "refresh_r1184_safe_response_chain_status" &&
      nextRealActionCommand ===
        R1184_AVERAGE_SUBMITTER_SAFE_RESPONSE_CHAIN_STATUS_COMMAND);

  return (
    readStringAt(value, ["packetId"]) === R1185_PACKET_ID &&
    readStringAt(value, ["schemaVersion"]) === R1185_SCHEMA_VERSION &&
    readStringAt(value, ["status"]) === "research-local-aggregate-only" &&
    readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true &&
    readBooleanAt(value, ["artifactBoundary", "confirmedResponseLocalPathStored"]) ===
      false &&
    readBooleanAt(value, ["artifactBoundary", "fillableResponseLocalPathStored"]) ===
      false &&
    readBooleanAt(value, ["artifactBoundary", "liveArtifactsMutatedByR1185"]) ===
      false &&
    readBooleanAt(value, ["artifactBoundary", "localPathsStored"]) === false &&
    readBooleanAt(value, ["artifactBoundary", "modelEvidencePromotedByR1185"]) ===
      false &&
    readBooleanAt(value, ["artifactBoundary", "privateDetailsStored"]) === false &&
    readBooleanAt(value, ["artifactBoundary", "productDisplayAuthorized"]) ===
      false &&
    readBooleanAt(value, ["artifactBoundary", "rowLevelDataAcceptedByR1185"]) ===
      false &&
    readBooleanAt(value, [
      "artifactBoundary",
      "rowOwnerConfirmationInferredByR1185",
    ]) === false &&
    readBooleanAt(value, ["artifactBoundary", "rowOwnerPrivateValuesStored"]) ===
      false &&
    readBooleanAt(value, [
      "artifactBoundary",
      "rowOwnerSafeResponseValuesStoredInR1185Packet",
    ]) === false &&
    readBooleanAt(value, ["artifactBoundary", "rowParsingPerformedByR1185"]) ===
      false &&
    readBooleanAt(value, [
      "artifactBoundary",
      "safeBooleanValuesStoredInR1185Packet",
    ]) === false &&
    readBooleanAt(value, ["artifactBoundary", "syntheticFixtureRowsStored"]) ===
      false &&
    conclusion !== null &&
    (liveR1184Conclusion === null || parsedLiveR1184Conclusion !== null) &&
    nextRealAction !== null &&
    nextRealActionMatchesCommand &&
    readBooleanAt(value, ["summary", "liveR1184ReadyForSyntheticSmoke"]) !==
      null &&
    readBooleanAt(value, [
      "summary",
      "nextRealActionRequiresExplicitRowOwnerAssertion",
    ]) !== null &&
    readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false &&
    readBooleanAt(value, ["summary", "syntheticSmokeRan"]) !== null &&
    readStringAt(value, ["smokeProof", "evidenceClass"]) ===
      "synthetic_non_evidence_smoke_proof" &&
    readBooleanAt(value, ["smokeProof", "liveArtifactsMutatedByR1185"]) ===
      false &&
    readBooleanAt(value, ["smokeProof", "liveRowOwnerConfirmationProvided"]) ===
      false &&
    exactStringSet(
      readStringArrayAt(value, ["smokeProof", "minimumFeaturePairRequired"]),
      MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS
    ) &&
    exactStringSet(
      readStringArrayAt(value, ["smokeProof", "prioritizedInputKindIds"]),
      REQUIRED_INPUT_KIND_IDS
    ) &&
    exactStringSet(
      readStringArrayAt(value, ["smokeProof", "requiredResponseFieldIds"]),
      REQUIRED_SAFE_RESPONSE_FIELD_IDS
    ) &&
    (syntheticPathAdvanced === true
      ? exactStringSet(
          safeExecutionFeatureSlotIds,
          SAFE_RESPONSE_EXECUTION_FEATURE_SLOT_IDS
        )
      : safeExecutionFeatureSlotIds.length === 0) &&
    readBooleanAt(value, ["smokeProof", "modelEvidencePromotionAllowed"]) ===
      false &&
    readBooleanAt(value, ["smokeProof", "productDisplayAuthorized"]) === false &&
    readBooleanAt(value, ["smokeProof", "reviewGptRequiredNow"]) === false &&
    readBooleanAt(value, ["smokeProof", "rowLevelDataAcceptedByR1185"]) ===
      false &&
    readBooleanAt(value, [
      "smokeProof",
      "rowOwnerConfirmationInferredByR1185",
    ]) === false &&
    readBooleanAt(value, ["smokeProof", "rowOwnerPrivateValuesStored"]) ===
      false &&
    readBooleanAt(value, [
      "smokeProof",
      "rowOwnerSafeResponseValuesStoredInR1185Packet",
    ]) === false &&
    readBooleanAt(value, ["smokeProof", "rowParsingPerformedByR1185"]) ===
      false &&
    readStringAt(value, ["smokeProof", "sourcePriority"]) ===
      TARGET_INPUT_PRIORITY &&
    readBooleanAt(value, ["smokeProof", "syntheticSmokeRan"]) !== null &&
    readStringAt(value, ["smokeProof", "targetAgeBand"]) === TARGET_AGE_BAND &&
    readBooleanAt(value, ["productDisplayAuthorized"]) === false
  );
}

function rowOwnerActionRouteStatusFor(input: {
  minimumFeaturePairConfirmed: boolean;
  priorityVisibleInCurrentLoop: boolean;
}): RowOwnerActionRouteStatus {
  if (!input.priorityVisibleInCurrentLoop)
    return "waiting_on_current_loop_or_priority_packet";
  if (input.minimumFeaturePairConfirmed)
    return "feature_only_research_handoff_ready";
  return "waiting_on_row_owner_feature_only_assertion";
}

function firstRunnableRowOwnerActionIdFor(
  status: RowOwnerActionRouteStatus
): RowOwnerActionId | null {
  if (status === "waiting_on_current_loop_or_priority_packet") return null;
  if (status === "feature_only_research_handoff_ready") {
    return "run_r1164_feature_only_research_handoff_after_minimum_pair_confirmed";
  }
  return "fill_r1180_safe_confirmation_response_template";
}

function rowOwnerOnlyActionsFor(): RowOwnerOnlyAction[] {
  return [
    {
      actionId: "fill_r1180_safe_confirmation_response_template",
      command: R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_COMMAND,
      rowOwnerOnly: true,
      storesPrivateDetailsInPacket: false,
    },
    {
      actionId: "review_r1173_safe_assertion_answer_sheet",
      command: R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND,
      rowOwnerOnly: true,
      storesPrivateDetailsInPacket: false,
    },
    {
      actionId: "review_r1174_safe_next_step_packet",
      command: R1174_SAFE_NEXT_STEP_PACKET_COMMAND,
      rowOwnerOnly: true,
      storesPrivateDetailsInPacket: false,
    },
    {
      actionId:
        "explicitly_run_r1176_live_chain_if_all_safe_assertions_are_true",
      command: R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
      rowOwnerOnly: true,
      storesPrivateDetailsInPacket: false,
    },
    {
      actionId:
        "run_r1164_feature_only_research_handoff_after_minimum_pair_confirmed",
      command: R1164_FEATURE_ONLY_RESEARCH_HANDOFF_COMMAND,
      rowOwnerOnly: true,
      storesPrivateDetailsInPacket: false,
    },
  ];
}

function summarizeArtifact(input: {
  artifact: string;
  expectedPacketId: string;
  expectedSchemaVersion: string;
  value: unknown | null;
}): ArtifactSummary {
  const packetId =
    readStringAt(input.value, ["packetId"]) === input.expectedPacketId
      ? input.expectedPacketId
      : null;
  const schemaVersion =
    readStringAt(input.value, ["schemaVersion"]) === input.expectedSchemaVersion
      ? input.expectedSchemaVersion
      : null;
  return {
    artifact: input.artifact,
    packetId,
    schemaVersion,
    status: input.value === null ? "missing" : "available",
  };
}

function safeBoundary(): R1178AverageSubmitterCurrentLoopSurfacingOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    fileNamesStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelEvidencePromotedByR1178: false,
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
    rowLevelDataAcceptedByR1178: false,
    rowOwnerConfirmationInferredByR1178: false,
    rowOwnerPrivateValuesStored: false,
    rowOwnerProvidedValuesStored: false,
    rowParsingPerformedByR1178: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error: unknown) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

function validateAggregateSafe(label: string, value: unknown): void {
  if (value === null) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(
      `R1178 rejected unsafe ${label}: ${formatFindingCount(findings)}`
    );
  }
}

function ensureNoOutputPathInOutput(
  output: R1178AverageSubmitterCurrentLoopSurfacingOutput,
  outputDir: string
): void {
  if (JSON.stringify(output).includes(outputDir)) {
    throw new Error(
      "R1178 rejected current-loop surfacing packet with output path leakage."
    );
  }
}

function createdAtFor(createdAt: string | undefined): string {
  if (createdAt === undefined) return new Date().toISOString();
  if (isStrictIsoTimestamp(createdAt)) return createdAt;
  throw new Error("R1178 rejected invalid createdAt timestamp.");
}

function isStrictIsoTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))
    return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
}

function readStringAt(value: unknown, pathParts: string[]): string | null {
  const valueAtPath = readAt(value, pathParts);
  return typeof valueAtPath === "string" ? valueAtPath : null;
}

function readBooleanAt(value: unknown, pathParts: string[]): boolean | null {
  const valueAtPath = readAt(value, pathParts);
  return typeof valueAtPath === "boolean" ? valueAtPath : null;
}

function readStringArrayAt(value: unknown, pathParts: string[]): string[] {
  const valueAtPath = readAt(value, pathParts);
  if (!Array.isArray(valueAtPath)) return [];
  return valueAtPath.every((item): item is string => typeof item === "string")
    ? valueAtPath
    : [];
}

function readAt(value: unknown, pathParts: string[]): unknown {
  let current: unknown = value;
  for (const part of pathParts) {
    const record = asRecord(current);
    if (!record) return null;
    current = record[part];
  }
  return current;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactStringSet(
  actual: string[],
  expectedValues: readonly string[]
): boolean {
  const actualSet = new Set(actual);
  if (
    actual.length !== expectedValues.length ||
    actualSet.size !== expectedValues.length
  )
    return false;
  const expected = new Set(expectedValues);
  return (
    expectedValues.every((item) => actualSet.has(item)) &&
    actual.every((item) => expected.has(item))
  );
}

function parseAllowedString<const T extends readonly string[]>(
  value: string | null,
  allowedValues: T
): T[number] | null {
  if (value === null) return null;
  return (allowedValues as readonly string[]).includes(value)
    ? (value as T[number])
    : null;
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function cliSummary(
  output: R1178AverageSubmitterCurrentLoopSurfacingOutput
): Record<string, unknown> {
  return {
    averageSubmitterSubmissionPriorityOrderIds:
      output.summary.averageSubmitterSubmissionPriority
        .firstPassSubmissionPriorityOrderIds,
    conclusion: output.summary.conclusion,
    currentLoopCommand: output.summary.currentLoopCommand,
    currentMissingRequirementIds: output.summary.currentMissingRequirementIds,
    currentSurfacingBlockerIds: output.summary.currentSurfacingBlockerIds,
    deferredUntilMinimumPairConfirmedIds:
      output.summary.averageSubmitterSubmissionPriority
        .deferredUntilMinimumPairConfirmedIds,
    firstSubmitterAskIds: output.summary.firstSubmitterAskIds,
    minimumFeaturePairConfirmed: output.summary.minimumFeaturePairConfirmed,
    minimumFeaturePairRequired: output.summary.minimumFeaturePairRequired,
    optionalContextNotRequiredForFirstStep:
      output.summary.averageSubmitterSubmissionPriority
        .optionalContextNotRequiredForFirstStep,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    prioritizedInputKindIds: output.summary.prioritizedInputKindIds,
    priorityVisibleInCurrentLoop: output.summary.priorityVisibleInCurrentLoop,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    r1076CurrentLoopRecognized: output.summary.r1076CurrentLoopRecognized,
    r1177PriorityPacketRecognized: output.summary.r1177PriorityPacketRecognized,
    rowLevelDataAcceptedByR1178: output.summary.rowLevelDataAcceptedByR1178,
    rowOwnerConfirmationInferredByR1178:
      output.summary.rowOwnerConfirmationInferredByR1178,
    rowOwnerActionRouteStatus:
      output.summary.rowOwnerActionRoute.rowOwnerActionRouteStatus,
    rowOwnerFirstRunnableActionId:
      output.summary.rowOwnerActionRoute.firstRunnableActionId,
    rowOwnerPrivateValuesStored: output.summary.rowOwnerPrivateValuesStored,
    rowParsingPerformedByR1178: output.summary.rowParsingPerformedByR1178,
    safeResponseHandoffConclusion:
      output.summary.safeResponseHandoff.conclusion,
    safeResponseHandoffNextAction:
      output.summary.safeResponseHandoff.nextAction,
    safeResponseHandoffNextActionCommand:
      output.summary.safeResponseHandoff.nextActionCommand,
    safeResponseHandoffRecognized:
      output.summary.safeResponseHandoff.recognized,
    safeResponseSmokeProofConclusion:
      output.summary.safeResponseSmokeProof.conclusion,
    safeResponseSmokeProofNextRealAction:
      output.summary.safeResponseSmokeProof.nextRealAction,
    safeResponseSmokeProofNextRealActionCommand:
      output.summary.safeResponseSmokeProof.nextRealActionCommand,
    safeResponseSmokeProofRecognized:
      output.summary.safeResponseSmokeProof.recognized,
    safeResponseSmokeProofSyntheticNonEvidence:
      output.summary.safeResponseSmokeProof.syntheticNonEvidence,
    schemaVersion: output.schemaVersion,
    sourcePriority: output.summary.sourcePriority,
    targetAgeBand: output.summary.targetAgeBand,
    topRequirementId: output.summary.topRequirementId,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1178AverageSubmitterCurrentLoopSurfacing({
    createdAt: process.env.MURPH_AGE_R1178_CREATED_AT,
    outputDir:
      process.env.MURPH_AGE_R1178_OUTPUT_DIR ??
      process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1076Path:
      process.env.MURPH_AGE_R1076_CURRENT_AUTORESEARCH_LOOP_EXECUTOR_PATH,
    r1177Path:
      process.env.MURPH_AGE_R1177_AVERAGE_SUBMITTER_PRIORITY_PACKET_PATH,
    r1182Path:
      process.env.MURPH_AGE_R1182_SAFE_RESPONSE_HANDOFF_PATH,
    r1185Path:
      process.env.MURPH_AGE_R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_PATH,
  });
  process.stdout.write(`${JSON.stringify(cliSummary(output), null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${safeCliErrorMessage(
        error,
        "R1178 average-submitter current-loop surfacing failed."
      )}\n`
    );
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  if (/[\r\n]|(?:\/|\\)/u.test(error.message)) return fallback;
  return isAllowlistedR1178ErrorMessage(error.message)
    ? error.message
    : fallback;
}

function formatFindingCount(findings: readonly unknown[]): string {
  return `${findings.length} finding${findings.length === 1 ? "" : "s"}`;
}

function isAllowlistedR1178ErrorMessage(message: string): boolean {
  return [
    /^R1178 rejected invalid createdAt timestamp\.$/u,
    /^R1178 rejected current-loop surfacing packet with output path leakage\.$/u,
    /^R1178 rejected unsafe (?:r1076 current loop executor|r1177 average-submitter priority packet|r1182 safe response handoff|r1185 safe response smoke proof|r1178 average submitter current-loop surfacing): \d+ findings?$/u,
  ].some((pattern) => pattern.test(message));
}
