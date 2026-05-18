import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1179_AVERAGE_SUBMITTER_OBJECTIVE_GAP_AUDIT_COMMAND,
  R1179_AVERAGE_SUBMITTER_OBJECTIVE_GAP_AUDIT_SCHEMA_VERSION,
} from "./r1179-average-submitter-objective-gap-audit.ts";
import {
  R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_COMMAND,
} from "./r1180-average-submitter-safe-confirmation-response-intake.ts";
import {
  R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_EXPLICIT_CONFIRMATION_COMMAND,
  R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND,
  R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_SCHEMA_VERSION,
} from "./r1183-average-submitter-safe-response-materializer.ts";
import {
  R1184_AVERAGE_SUBMITTER_SAFE_RESPONSE_CHAIN_STATUS_COMMAND,
  R1184_AVERAGE_SUBMITTER_SAFE_RESPONSE_CHAIN_STATUS_SCHEMA_VERSION,
} from "./r1184-average-submitter-safe-response-chain-status.ts";

export const R1186_AVERAGE_SUBMITTER_SAFE_SUBMISSION_PACKET_SCHEMA_VERSION =
  "murph-age-r1186-average-submitter-safe-submission-packet.v1" as const;
export const R1186_AVERAGE_SUBMITTER_SAFE_SUBMISSION_PACKET_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1186-average-submitter-safe-submission-packet.ts" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1186-average-submitter-safe-submission-packet.latest.json" as const;
const R1179_ARTIFACT = "r1179-average-submitter-objective-gap-audit.latest.json" as const;
const R1183_ARTIFACT = "r1183-average-submitter-safe-response-materializer.latest.json" as const;
const R1184_ARTIFACT = "r1184-average-submitter-safe-response-chain-status.latest.json" as const;
const R1179_PACKET_ID = "r1179-average-submitter-objective-gap-audit" as const;
const R1183_PACKET_ID = "r1183-average-submitter-safe-response-materializer" as const;
const R1184_PACKET_ID = "r1184-average-submitter-safe-response-chain-status" as const;
const R1183_FILLABLE_SAFE_RESPONSE_ARTIFACT =
  "r1183-fillable-average-submitter-safe-confirmation-response.json" as const;
const R1183_CONFIRMED_SAFE_RESPONSE_ARTIFACT =
  "r1183-confirmed-average-submitter-safe-confirmation-response.json" as const;
const R1180_CONFIRMED_RESPONSE_INTAKE_COMMAND =
  `MURPH_AGE_R1180_SAFE_CONFIRMATION_RESPONSE_PATH=<${R1183_CONFIRMED_SAFE_RESPONSE_ARTIFACT}> ${R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_COMMAND}` as const;
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
const FIRST_PASS_SUBMISSION_PRIORITY_ORDER_IDS = [
  "glycemia_bloodwork_labs_first",
  "daily_activity_phone_watch_wearable_first",
  "routine_labs_optional_after_minimum_pair",
  "basic_vitals_context_optional_after_minimum_pair",
  "sleep_recovery_hrv_after_minimum_pair",
  "advanced_biomarkers_last",
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
const REQUIRED_RESPONSE_FIELD_IDS = [
  "confirm_target_age_band_roughly_16_50",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
] as const;
const REQUIRED_RESPONSE_TEMPLATE_KEYS = [
  "askId",
  "confirmDailyWearableActivityExportAvailable",
  "confirmGlycemiaBloodworkExportAvailable",
  "confirmNoPrivateValuesIncluded",
  "confirmTargetAgeBandRoughly16To50",
  "responseKind",
  "schemaVersion",
] as const;
const REQUIRED_ASSERTION_CHECKLIST_IDS = [
  "assert_target_age_band_roughly_16_50",
  "assert_glycemia_bloodwork_export_available",
  "assert_daily_wearable_activity_export_available",
  "assert_no_private_values_identifiers_paths_headers_or_rows",
] as const;
const SAFE_COMPLETION_CHECKLIST_ITEM_IDS = [
  "confirm_target_age_band_without_identifiers",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
] as const;
const SAFE_EXECUTION_FEATURE_SLOT_IDS = [
  "glycemia_lab_presence",
  "glycemia_measurement_date_presence",
  "daily_activity_presence",
  "daily_wear_coverage_presence",
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
const ACCEPTABLE_RESPONSE_KIND_IDS = [
  "explicit_yes_all_required_assertions_confirmed",
  "not_confirmed_or_unsure",
] as const;
const OBJECTIVE_REQUIREMENT_IDS = [
  "ordinary_16_50_priority_selected",
  "minimum_lab_wearable_pair_visible",
  "average_submitter_submission_priority_visible",
  "safe_response_smoke_proof_visible",
  "safe_response_handoff_visible",
  "safe_response_chain_status_visible",
  "row_owner_action_route_visible",
  "safe_current_loop_command_visible",
  "safe_assertion_answer_sheet_available",
  "safe_next_step_packet_available",
  "r1176_live_chain_available",
  "row_owner_safe_assertion_confirmed",
  "feature_only_research_handoff_ready",
  "real_lab_wearable_route_metrics_recorded",
  "product_display_blocked_until_validation",
] as const;
const R1179_NEXT_ACTION_IDS = [
  "refresh_r1178_current_loop_surfacing",
  "refresh_r1145_completion_audit",
  "refresh_r1173_safe_assertion_answer_sheet",
  "refresh_r1174_safe_next_step_packet",
  "refresh_r1176_row_owner_safe_assertion_chain",
  "refresh_r1182_safe_response_handoff",
  "refresh_r1184_safe_response_chain_status",
  "fill_r1180_safe_confirmation_response_template",
  "review_r1173_safe_assertion_answer_sheet_then_rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation",
  "run_r1164_feature_only_research_handoff_after_minimum_pair_confirmed",
  "collect_real_lab_wearable_route_metrics",
  "keep_product_display_blocked",
  "none",
] as const;
const R1184_CONCLUSION_IDS = [
  "average_submitter_safe_response_chain_ready_for_feature_only_research_planning",
  "average_submitter_safe_response_chain_waiting_on_r1180_confirmed_response_intake",
  "average_submitter_safe_response_chain_waiting_on_r1180_response",
  "average_submitter_safe_response_chain_waiting_on_r1181_feature_contract",
  "average_submitter_safe_response_chain_waiting_on_r1182_handoff",
  "average_submitter_safe_response_chain_waiting_on_r1183_refresh",
  "average_submitter_safe_response_chain_waiting_on_row_owner_confirmation",
] as const;
const R1184_NEXT_ACTION_IDS = [
  "fill_r1180_safe_confirmation_response_template",
  "refresh_r1181_feature_only_execution_contract",
  "refresh_r1182_safe_response_handoff",
  "refresh_r1183_safe_response_materializer",
  "rerun_r1183_with_row_owner_safe_response_assertion",
  "run_r1180_with_r1183_confirmed_safe_response_artifact",
  "run_r1181_feature_only_execution_contract",
  "use_r1181_feature_only_execution_contract_for_research_planning_only",
] as const;
const R1183_CONCLUSION_IDS = [
  "average_submitter_safe_response_materializer_confirmed_response_written",
  "average_submitter_safe_response_materializer_ready_for_explicit_confirmation",
  "average_submitter_safe_response_materializer_waiting_on_r1182_handoff",
] as const;
const R1183_NEXT_ACTION_IDS = [
  "refresh_r1182_safe_response_handoff",
  "rerun_r1183_with_row_owner_safe_response_assertion",
  "run_r1180_with_confirmed_average_submitter_safe_response",
] as const;

type ArrayValue<T extends readonly string[]> = T[number];
type MinimumFeaturePairSourceFamilyId = ArrayValue<typeof MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS>;
type PrioritizedInputKindId = ArrayValue<typeof PRIORITIZED_INPUT_KIND_IDS>;
type FirstPassSubmissionPriorityOrderId = ArrayValue<typeof FIRST_PASS_SUBMISSION_PRIORITY_ORDER_IDS>;
type OptionalContextSourceFamilyId = ArrayValue<typeof OPTIONAL_CONTEXT_SOURCE_FAMILY_IDS>;
type DeferredUntilMinimumPairConfirmedId = ArrayValue<typeof DEFERRED_UNTIL_MINIMUM_PAIR_CONFIRMED_IDS>;
type RequiredResponseFieldId = ArrayValue<typeof REQUIRED_RESPONSE_FIELD_IDS>;
type RequiredResponseTemplateKey = ArrayValue<typeof REQUIRED_RESPONSE_TEMPLATE_KEYS>;
type RequiredAssertionChecklistId = ArrayValue<typeof REQUIRED_ASSERTION_CHECKLIST_IDS>;
type SafeCompletionChecklistItemId = ArrayValue<typeof SAFE_COMPLETION_CHECKLIST_ITEM_IDS>;
type SafeExecutionFeatureSlotId = ArrayValue<typeof SAFE_EXECUTION_FEATURE_SLOT_IDS>;
type BlockedContentId = ArrayValue<typeof BLOCKED_CONTENT_IDS>;
type AllowedValueKindId = ArrayValue<typeof ALLOWED_VALUE_KIND_IDS>;
type AcceptableResponseKindId = ArrayValue<typeof ACCEPTABLE_RESPONSE_KIND_IDS>;
type ObjectiveRequirementId = ArrayValue<typeof OBJECTIVE_REQUIREMENT_IDS>;
type R1179NextActionId = ArrayValue<typeof R1179_NEXT_ACTION_IDS>;
type R1184ConclusionId = ArrayValue<typeof R1184_CONCLUSION_IDS>;
type R1184NextActionId = ArrayValue<typeof R1184_NEXT_ACTION_IDS>;
type R1183ConclusionId = ArrayValue<typeof R1183_CONCLUSION_IDS>;
type R1183NextActionId = ArrayValue<typeof R1183_NEXT_ACTION_IDS>;

type PacketConclusion =
  | "average_submitter_safe_submission_packet_ready_for_feature_only_research_planning"
  | "average_submitter_safe_submission_packet_waiting_on_chain_status_refresh"
  | "average_submitter_safe_submission_packet_waiting_on_objective_gap_audit_refresh"
  | "average_submitter_safe_submission_packet_waiting_on_r1180_confirmed_response_intake"
  | "average_submitter_safe_submission_packet_waiting_on_r1183_materializer_refresh"
  | "average_submitter_safe_submission_packet_waiting_on_row_owner_confirmation";

type PacketNextAction =
  | "collect_boolean_only_row_owner_confirmation_then_rerun_r1183"
  | "refresh_r1179_objective_gap_audit"
  | "refresh_r1183_safe_response_materializer"
  | "refresh_r1184_safe_response_chain_status"
  | "run_r1180_with_r1183_confirmed_safe_response_artifact"
  | "use_r1181_feature_only_execution_contract_for_research_planning_only";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface R1179State {
  artifactBoundaryAggregateOnly: boolean | null;
  artifactBoundaryUnsafeTrueFlagFound: boolean;
  averageSubmitterLikelySubmittable: boolean | null;
  blockedRequirementIds: ObjectiveRequirementId[] | null;
  goalAchieved: boolean | null;
  inputArtifactAvailable: boolean;
  minimumPairMatches: boolean;
  modelEvidencePromotionAllowed: boolean | null;
  nextAction: R1179NextActionId | null;
  packetId: typeof R1179_PACKET_ID | null;
  prioritizedInputKindsMatch: boolean;
  productDisplayAuthorized: boolean | null;
  readyToMarkComplete: boolean | null;
  realLabWearableRouteMetricsRecorded: boolean | null;
  rowLevelDataAcceptedByR1179: boolean | null;
  rowOwnerConfirmationInferredByR1179: boolean | null;
  rowOwnerPrivateValuesStored: boolean | null;
  rowOwnerSafeAssertionConfirmed: boolean | null;
  rowParsingPerformedByR1179: boolean | null;
  schemaCurrent: boolean;
  sourcePriorityMatches: boolean;
  status: "research-local-aggregate-only" | null;
  targetAgeBandMatches: boolean;
}

interface R1183State {
  artifactBoundaryAggregateOnly: boolean | null;
  artifactBoundaryUnsafeTrueFlagFound: boolean;
  conclusion: R1183ConclusionId | null;
  confirmedResponseArtifactWritten: boolean | null;
  explicitRowOwnerSafeResponseAssertionProvided: boolean | null;
  fillableResponseArtifactPresent: boolean | null;
  inputArtifactAvailable: boolean;
  materializerReadyForRowOwnerConfirmation: boolean | null;
  minimumPairMatches: boolean;
  modelEvidencePromotionAllowed: boolean | null;
  nextAction: R1183NextActionId | null;
  packetId: typeof R1183_PACKET_ID | null;
  productDisplayAuthorized: boolean | null;
  requiredResponseFieldsMatch: boolean;
  reviewGptRequiredNow: boolean | null;
  rowLevelDataAcceptedByR1183: boolean | null;
  rowOwnerConfirmationInferredByR1183: boolean | null;
  rowOwnerPrivateValuesStored: boolean | null;
  rowOwnerSafeResponseAssertionStillRequired: boolean | null;
  rowOwnerSafeResponseValuesStoredInR1183Packet: boolean | null;
  rowParsingPerformedByR1183: boolean | null;
  schemaCurrent: boolean;
  sourcePriorityMatches: boolean;
  status: "research-local-aggregate-only" | null;
  targetAgeBandMatches: boolean;
}

interface R1184State {
  artifactBoundaryAggregateOnly: boolean | null;
  artifactBoundaryUnsafeTrueFlagFound: boolean;
  conclusion: R1184ConclusionId | null;
  confirmedResponseArtifactReadyForR1180: boolean | null;
  explicitRowOwnerSafeConfirmationProvided: boolean | null;
  featureOnlyExecutionContractReady: boolean | null;
  featureOnlySafeConfirmationReady: boolean | null;
  fillableResponseArtifactPresent: boolean | null;
  handoffReadyForResearchPlanningOnly: boolean | null;
  inputArtifactAvailable: boolean;
  materializerReadyForRowOwnerConfirmation: boolean | null;
  minimumPairMatches: boolean;
  modelEvidencePromotionAllowed: boolean | null;
  nextAction: R1184NextActionId | null;
  nextActionRequiresExplicitRowOwnerAssertion: boolean | null;
  packetId: typeof R1184_PACKET_ID | null;
  prioritizedInputKindsMatch: boolean;
  productDisplayAuthorized: boolean | null;
  requiredResponseFieldsMatch: boolean;
  reviewGptRequiredNow: boolean | null;
  rowLevelDataAcceptedByR1184: boolean | null;
  rowOwnerConfirmationInferredByR1184: boolean | null;
  rowOwnerPrivateValuesStored: boolean | null;
  rowOwnerSafeResponseAssertionStillRequired: boolean | null;
  rowOwnerSafeResponseValuesStoredInR1184Packet: boolean | null;
  rowParsingPerformedByR1184: boolean | null;
  safeExecutionFeatureSlotIds: SafeExecutionFeatureSlotId[] | null;
  schemaCurrent: boolean;
  sourcePriorityMatches: boolean;
  status: "research-local-aggregate-only" | null;
  targetAgeBandMatches: boolean;
}

interface PacketTransition {
  conclusion: PacketConclusion;
  nextAction: PacketNextAction;
}

export interface R1186AverageSubmitterSafeSubmissionPacketOptions {
  createdAt?: string;
  outputDir?: string;
  r1179Path?: string;
  r1183Path?: string;
  r1184Path?: string;
}

export interface R1186AverageSubmitterSafeSubmissionPacketOutput {
  artifactBoundary: ReturnType<typeof safeBoundary>;
  createdAt: string;
  inputArtifacts: {
    r1179ObjectiveGapAudit: ArtifactSummary;
    r1183SafeResponseMaterializer: ArtifactSummary;
    r1184SafeResponseChainStatus: ArtifactSummary;
  };
  packetId: "r1186-average-submitter-safe-submission-packet";
  productDisplayAuthorized: false;
  r1179State: R1179State;
  r1183State: R1183State;
  r1184State: R1184State;
  safeSubmissionPacket: {
    acceptableResponseKindIds: AcceptableResponseKindId[];
    allowedValueKindIds: AllowedValueKindId[];
    averageSubmitterLikelySubmittable: boolean;
    blockedContentIds: BlockedContentId[];
    deferredUntilMinimumPairConfirmedIds: DeferredUntilMinimumPairConfirmedId[];
    explicitRowOwnerSafeConfirmationMustPrecedeCommand: boolean;
    firstPassSubmissionPriorityOrderIds: FirstPassSubmissionPriorityOrderId[];
    materializerExplicitConfirmationCommand: typeof R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_EXPLICIT_CONFIRMATION_COMMAND;
    minimumFeaturePairRequired: MinimumFeaturePairSourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    optionalContextNotRequiredForFirstStep: OptionalContextSourceFamilyId[];
    prioritizedInputKindIds: PrioritizedInputKindId[];
    productDisplayAuthorized: false;
    requiredAssertionChecklistIds: RequiredAssertionChecklistId[];
    requiredResponseFieldIds: RequiredResponseFieldId[];
    requiredResponseTemplateKeys: RequiredResponseTemplateKey[];
    responseTemplateArtifact: typeof R1183_FILLABLE_SAFE_RESPONSE_ARTIFACT | null;
    rowLevelDataAcceptedByR1186: false;
    rowOwnerOnly: true;
    rowOwnerPrivateValuesStored: false;
    rowOwnerSafeConfirmationValuesStoredInR1186Packet: false;
    rowParsingPerformedByR1186: false;
    safeCompletionChecklistItemIds: SafeCompletionChecklistItemId[];
    sourcePriority: typeof TARGET_INPUT_PRIORITY;
    targetAgeBand: typeof TARGET_AGE_BAND;
  };
  schemaVersion: typeof R1186_AVERAGE_SUBMITTER_SAFE_SUBMISSION_PACKET_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    blockedRequirementIds: ObjectiveRequirementId[] | null;
    conclusion: PacketConclusion;
    explicitRowOwnerSafeConfirmationProvided: boolean | null;
    featureOnlyResearchHandoffReady: boolean;
    featureOnlyResearchPlanningReady: boolean;
    fillableResponseArtifactPresent: boolean;
    materializerReadyForRowOwnerConfirmation: boolean | null;
    minimumFeaturePairRequired: MinimumFeaturePairSourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    nextAction: PacketNextAction;
    nextActionCommand: string | null;
    nextActionRequiresExplicitRowOwnerAssertion: boolean;
    prioritizedInputKindIds: PrioritizedInputKindId[];
    productDisplayAuthorized: false;
    readyToMarkComplete: false;
    realLabWearableRouteMetricsRecorded: boolean;
    requiredResponseFieldIds: RequiredResponseFieldId[];
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1186: false;
    rowOwnerActionRouteStatus:
      | "feature_only_research_planning_ready"
      | "waiting_on_boolean_only_safe_confirmation"
      | "waiting_on_confirmed_response_intake"
      | "waiting_on_safe_chain_refresh";
    rowOwnerConfirmationInferredByR1186: false;
    rowOwnerPrivateValuesStored: false;
    rowOwnerSafeConfirmationValuesStoredInR1186Packet: false;
    rowParsingPerformedByR1186: false;
    safeSubmissionPacketReady: boolean;
    sourcePriority: typeof TARGET_INPUT_PRIORITY;
    targetAgeBand: typeof TARGET_AGE_BAND;
  };
}

export async function runR1186AverageSubmitterSafeSubmissionPacket(
  options: R1186AverageSubmitterSafeSubmissionPacketOptions = {},
): Promise<{ output: R1186AverageSubmitterSafeSubmissionPacketOutput; outputPath: string }> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const [r1179, r1183, r1184] = await Promise.all([
    readJsonIfPresent(options.r1179Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1179_ARTIFACT)),
    readJsonIfPresent(options.r1183Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1183_ARTIFACT)),
    readJsonIfPresent(options.r1184Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1184_ARTIFACT)),
  ]);
  validateAggregateSafe("r1179 objective gap audit", r1179);
  validateAggregateSafe("r1183 safe response materializer", r1183);
  validateAggregateSafe("r1184 safe response chain status", r1184);

  const r1179State = stateFromR1179(r1179);
  const r1183State = stateFromR1183(r1183);
  const r1184State = stateFromR1184(r1184);
  rejectUnsafeInputs({ r1179State, r1183State, r1184State });

  const transition = transitionFor({ r1179State, r1183State, r1184State });
  const featureOnlyResearchPlanningReady = r1184ReadyForFeatureOnlyResearchPlanning(r1184State);
  const featureOnlyResearchHandoffReady = r1179State.blockedRequirementIds !== null
    ? !r1179State.blockedRequirementIds.includes("feature_only_research_handoff_ready")
    : featureOnlyResearchPlanningReady;
  const realLabWearableRouteMetricsRecorded = r1179State.realLabWearableRouteMetricsRecorded === true;
  const fillableResponseArtifactPresent = r1184State.fillableResponseArtifactPresent === true
    || r1183State.fillableResponseArtifactPresent === true;
  const safeSubmissionPacketReady =
    transition.conclusion === "average_submitter_safe_submission_packet_waiting_on_row_owner_confirmation"
    || transition.conclusion === "average_submitter_safe_submission_packet_waiting_on_r1180_confirmed_response_intake"
    || transition.conclusion === "average_submitter_safe_submission_packet_ready_for_feature_only_research_planning";

  const output: R1186AverageSubmitterSafeSubmissionPacketOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: createdAtFor(options.createdAt),
    inputArtifacts: {
      r1179ObjectiveGapAudit: summarizeArtifact(
        r1179,
        R1179_ARTIFACT,
        R1179_PACKET_ID,
        R1179_AVERAGE_SUBMITTER_OBJECTIVE_GAP_AUDIT_SCHEMA_VERSION,
      ),
      r1183SafeResponseMaterializer: summarizeArtifact(
        r1183,
        R1183_ARTIFACT,
        R1183_PACKET_ID,
        R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_SCHEMA_VERSION,
      ),
      r1184SafeResponseChainStatus: summarizeArtifact(
        r1184,
        R1184_ARTIFACT,
        R1184_PACKET_ID,
        R1184_AVERAGE_SUBMITTER_SAFE_RESPONSE_CHAIN_STATUS_SCHEMA_VERSION,
      ),
    },
    packetId: "r1186-average-submitter-safe-submission-packet",
    productDisplayAuthorized: false,
    r1179State,
    r1183State,
    r1184State,
    safeSubmissionPacket: {
      acceptableResponseKindIds: [...ACCEPTABLE_RESPONSE_KIND_IDS],
      allowedValueKindIds: [...ALLOWED_VALUE_KIND_IDS],
      averageSubmitterLikelySubmittable: r1179State.averageSubmitterLikelySubmittable === true,
      blockedContentIds: [...BLOCKED_CONTENT_IDS],
      deferredUntilMinimumPairConfirmedIds: [...DEFERRED_UNTIL_MINIMUM_PAIR_CONFIRMED_IDS],
      explicitRowOwnerSafeConfirmationMustPrecedeCommand: true,
      firstPassSubmissionPriorityOrderIds: [...FIRST_PASS_SUBMISSION_PRIORITY_ORDER_IDS],
      materializerExplicitConfirmationCommand: R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_EXPLICIT_CONFIRMATION_COMMAND,
      minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      optionalContextNotRequiredForFirstStep: [...OPTIONAL_CONTEXT_SOURCE_FAMILY_IDS],
      prioritizedInputKindIds: [...PRIORITIZED_INPUT_KIND_IDS],
      productDisplayAuthorized: false,
      requiredAssertionChecklistIds: [...REQUIRED_ASSERTION_CHECKLIST_IDS],
      requiredResponseFieldIds: [...REQUIRED_RESPONSE_FIELD_IDS],
      requiredResponseTemplateKeys: [...REQUIRED_RESPONSE_TEMPLATE_KEYS],
      responseTemplateArtifact: fillableResponseArtifactPresent ? R1183_FILLABLE_SAFE_RESPONSE_ARTIFACT : null,
      rowLevelDataAcceptedByR1186: false,
      rowOwnerOnly: true,
      rowOwnerPrivateValuesStored: false,
      rowOwnerSafeConfirmationValuesStoredInR1186Packet: false,
      rowParsingPerformedByR1186: false,
      safeCompletionChecklistItemIds: [...SAFE_COMPLETION_CHECKLIST_ITEM_IDS],
      sourcePriority: TARGET_INPUT_PRIORITY,
      targetAgeBand: TARGET_AGE_BAND,
    },
    schemaVersion: R1186_AVERAGE_SUBMITTER_SAFE_SUBMISSION_PACKET_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      blockedRequirementIds: r1179State.blockedRequirementIds,
      conclusion: transition.conclusion,
      explicitRowOwnerSafeConfirmationProvided: r1184State.explicitRowOwnerSafeConfirmationProvided,
      featureOnlyResearchHandoffReady,
      featureOnlyResearchPlanningReady,
      fillableResponseArtifactPresent,
      materializerReadyForRowOwnerConfirmation: r1184State.materializerReadyForRowOwnerConfirmation,
      minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      nextAction: transition.nextAction,
      nextActionCommand: commandForNextAction(transition.nextAction),
      nextActionRequiresExplicitRowOwnerAssertion:
        transition.nextAction === "collect_boolean_only_row_owner_confirmation_then_rerun_r1183",
      prioritizedInputKindIds: [...PRIORITIZED_INPUT_KIND_IDS],
      productDisplayAuthorized: false,
      readyToMarkComplete: false,
      realLabWearableRouteMetricsRecorded,
      requiredResponseFieldIds: [...REQUIRED_RESPONSE_FIELD_IDS],
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1186: false,
      rowOwnerActionRouteStatus: rowOwnerActionRouteStatusFor(transition.conclusion),
      rowOwnerConfirmationInferredByR1186: false,
      rowOwnerPrivateValuesStored: false,
      rowOwnerSafeConfirmationValuesStoredInR1186Packet: false,
      rowParsingPerformedByR1186: false,
      safeSubmissionPacketReady,
      sourcePriority: TARGET_INPUT_PRIORITY,
      targetAgeBand: TARGET_AGE_BAND,
    },
  };

  ensureNoOutputPathInOutput(output, outputDir);
  validateAggregateSafe("r1186 safe submission packet", output);
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function stateFromR1179(value: unknown | null): R1179State {
  const blockedRequirementIds = readStringArrayInSetAt(
    value,
    ["summary", "blockedRequirementIds"],
    OBJECTIVE_REQUIREMENT_IDS,
  );
  return {
    artifactBoundaryAggregateOnly: readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]),
    artifactBoundaryUnsafeTrueFlagFound: hasUnsafeTrueBoundaryFlag(value),
    averageSubmitterLikelySubmittable: readBooleanAt(
      value,
      ["summary", "averageSubmitterSubmissionPriority", "averageSubmitterLikelySubmittable"],
    ),
    blockedRequirementIds,
    goalAchieved: readBooleanAt(value, ["summary", "goalAchieved"]),
    inputArtifactAvailable: value !== null,
    minimumPairMatches: exactStringSet(
      readStringArrayInSetAt(value, ["summary", "minimumFeaturePairRequired"], MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS),
      MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS,
    ),
    modelEvidencePromotionAllowed: readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]),
    nextAction: readStringInSetAt(value, ["summary", "nextAction"], R1179_NEXT_ACTION_IDS),
    packetId: readStringAt(value, ["packetId"]) === R1179_PACKET_ID ? R1179_PACKET_ID : null,
    prioritizedInputKindsMatch: exactStringSet(
      readStringArrayInSetAt(value, ["summary", "prioritizedInputKindIds"], PRIORITIZED_INPUT_KIND_IDS),
      PRIORITIZED_INPUT_KIND_IDS,
    ),
    productDisplayAuthorized: readBooleanAt(value, ["summary", "productDisplayAuthorized"]),
    readyToMarkComplete: readBooleanAt(value, ["summary", "readyToMarkComplete"]),
    realLabWearableRouteMetricsRecorded: blockedRequirementIds === null
      ? null
      : !blockedRequirementIds.includes("real_lab_wearable_route_metrics_recorded"),
    rowLevelDataAcceptedByR1179: readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1179"]),
    rowOwnerConfirmationInferredByR1179: readBooleanAt(value, [
      "summary",
      "rowOwnerConfirmationInferredByR1179",
    ]),
    rowOwnerPrivateValuesStored: readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]),
    rowOwnerSafeAssertionConfirmed: blockedRequirementIds === null
      ? null
      : !blockedRequirementIds.includes("row_owner_safe_assertion_confirmed"),
    rowParsingPerformedByR1179: readBooleanAt(value, ["summary", "rowParsingPerformedByR1179"]),
    schemaCurrent: readStringAt(value, ["schemaVersion"])
      === R1179_AVERAGE_SUBMITTER_OBJECTIVE_GAP_AUDIT_SCHEMA_VERSION,
    sourcePriorityMatches: readStringAt(value, ["summary", "sourcePriority"]) === TARGET_INPUT_PRIORITY,
    status: readStringAt(value, ["status"]) === "research-local-aggregate-only"
      ? "research-local-aggregate-only"
      : null,
    targetAgeBandMatches: readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND,
  };
}

function stateFromR1183(value: unknown | null): R1183State {
  return {
    artifactBoundaryAggregateOnly: readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]),
    artifactBoundaryUnsafeTrueFlagFound: hasUnsafeTrueBoundaryFlag(value),
    conclusion: readStringInSetAt(value, ["summary", "conclusion"], R1183_CONCLUSION_IDS),
    confirmedResponseArtifactWritten: readBooleanAt(value, ["summary", "confirmedResponseArtifactWritten"]),
    explicitRowOwnerSafeResponseAssertionProvided: readBooleanAt(value, [
      "summary",
      "explicitRowOwnerSafeResponseAssertionProvided",
    ]),
    fillableResponseArtifactPresent: readStringAt(value, ["summary", "fillableResponseArtifact"])
      === R1183_FILLABLE_SAFE_RESPONSE_ARTIFACT
      && readBooleanAt(value, ["summary", "fillableResponseArtifactWritten"]) === true,
    inputArtifactAvailable: value !== null,
    materializerReadyForRowOwnerConfirmation: readBooleanAt(value, [
      "summary",
      "materializerReadyForRowOwnerConfirmation",
    ]),
    minimumPairMatches: exactStringSet(
      readStringArrayInSetAt(value, ["summary", "minimumFeaturePairRequired"], MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS),
      MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS,
    ),
    modelEvidencePromotionAllowed: readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]),
    nextAction: readStringInSetAt(value, ["summary", "nextAction"], R1183_NEXT_ACTION_IDS),
    packetId: readStringAt(value, ["packetId"]) === R1183_PACKET_ID ? R1183_PACKET_ID : null,
    productDisplayAuthorized: readBooleanAt(value, ["summary", "productDisplayAuthorized"]),
    requiredResponseFieldsMatch: exactStringSet(
      readStringArrayInSetAt(value, ["summary", "requiredResponseFieldIds"], REQUIRED_RESPONSE_FIELD_IDS),
      REQUIRED_RESPONSE_FIELD_IDS,
    ),
    reviewGptRequiredNow: readBooleanAt(value, ["summary", "reviewGptRequiredNow"]),
    rowLevelDataAcceptedByR1183: readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1183"]),
    rowOwnerConfirmationInferredByR1183: readBooleanAt(value, ["summary", "rowOwnerConfirmationInferredByR1183"]),
    rowOwnerPrivateValuesStored: readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]),
    rowOwnerSafeResponseAssertionStillRequired: readBooleanAt(value, [
      "summary",
      "rowOwnerSafeResponseAssertionStillRequired",
    ]),
    rowOwnerSafeResponseValuesStoredInR1183Packet: readBooleanAt(value, [
      "summary",
      "rowOwnerSafeResponseValuesStoredInR1183Packet",
    ]),
    rowParsingPerformedByR1183: readBooleanAt(value, ["summary", "rowParsingPerformedByR1183"]),
    schemaCurrent: readStringAt(value, ["schemaVersion"])
      === R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_SCHEMA_VERSION,
    sourcePriorityMatches: readStringAt(value, ["summary", "sourcePriority"]) === TARGET_INPUT_PRIORITY,
    status: readStringAt(value, ["status"]) === "research-local-aggregate-only"
      ? "research-local-aggregate-only"
      : null,
    targetAgeBandMatches: readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND,
  };
}

function stateFromR1184(value: unknown | null): R1184State {
  return {
    artifactBoundaryAggregateOnly: readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]),
    artifactBoundaryUnsafeTrueFlagFound: hasUnsafeTrueBoundaryFlag(value),
    conclusion: readStringInSetAt(value, ["summary", "conclusion"], R1184_CONCLUSION_IDS),
    confirmedResponseArtifactReadyForR1180: readBooleanAt(value, [
      "summary",
      "confirmedResponseArtifactReadyForR1180",
    ]),
    explicitRowOwnerSafeConfirmationProvided: readBooleanAt(value, [
      "summary",
      "explicitRowOwnerSafeConfirmationProvided",
    ]),
    featureOnlyExecutionContractReady: readBooleanAt(value, ["summary", "featureOnlyExecutionContractReady"]),
    featureOnlySafeConfirmationReady: readBooleanAt(value, ["summary", "featureOnlySafeConfirmationReady"]),
    fillableResponseArtifactPresent: readBooleanAt(value, ["summary", "fillableResponseArtifactPresent"]),
    handoffReadyForResearchPlanningOnly: readBooleanAt(value, ["summary", "handoffReadyForResearchPlanningOnly"]),
    inputArtifactAvailable: value !== null,
    materializerReadyForRowOwnerConfirmation: readBooleanAt(value, [
      "summary",
      "materializerReadyForRowOwnerConfirmation",
    ]),
    minimumPairMatches: exactStringSet(
      readStringArrayInSetAt(value, ["summary", "minimumFeaturePairRequired"], MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS),
      MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS,
    ),
    modelEvidencePromotionAllowed: readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]),
    nextAction: readStringInSetAt(value, ["summary", "nextAction"], R1184_NEXT_ACTION_IDS),
    nextActionRequiresExplicitRowOwnerAssertion: readBooleanAt(value, [
      "summary",
      "nextActionRequiresExplicitRowOwnerAssertion",
    ]),
    packetId: readStringAt(value, ["packetId"]) === R1184_PACKET_ID ? R1184_PACKET_ID : null,
    prioritizedInputKindsMatch: exactStringSet(
      readStringArrayInSetAt(value, ["summary", "prioritizedInputKindIds"], PRIORITIZED_INPUT_KIND_IDS),
      PRIORITIZED_INPUT_KIND_IDS,
    ),
    productDisplayAuthorized: readBooleanAt(value, ["summary", "productDisplayAuthorized"]),
    requiredResponseFieldsMatch: exactStringSet(
      readStringArrayInSetAt(value, ["summary", "requiredResponseFieldIds"], REQUIRED_RESPONSE_FIELD_IDS),
      REQUIRED_RESPONSE_FIELD_IDS,
    ),
    reviewGptRequiredNow: readBooleanAt(value, ["summary", "reviewGptRequiredNow"]),
    rowLevelDataAcceptedByR1184: readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1184"]),
    rowOwnerConfirmationInferredByR1184: readBooleanAt(value, ["summary", "rowOwnerConfirmationInferredByR1184"]),
    rowOwnerPrivateValuesStored: readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]),
    rowOwnerSafeResponseAssertionStillRequired: readBooleanAt(value, [
      "summary",
      "rowOwnerSafeResponseAssertionStillRequired",
    ]),
    rowOwnerSafeResponseValuesStoredInR1184Packet: readBooleanAt(value, [
      "summary",
      "rowOwnerSafeResponseValuesStoredInR1184Packet",
    ]),
    rowParsingPerformedByR1184: readBooleanAt(value, ["summary", "rowParsingPerformedByR1184"]),
    safeExecutionFeatureSlotIds: readStringArrayInSetAt(
      value,
      ["summary", "safeExecutionFeatureSlotIds"],
      SAFE_EXECUTION_FEATURE_SLOT_IDS,
    ),
    schemaCurrent: readStringAt(value, ["schemaVersion"])
      === R1184_AVERAGE_SUBMITTER_SAFE_RESPONSE_CHAIN_STATUS_SCHEMA_VERSION,
    sourcePriorityMatches: readStringAt(value, ["summary", "sourcePriority"]) === TARGET_INPUT_PRIORITY,
    status: readStringAt(value, ["status"]) === "research-local-aggregate-only"
      ? "research-local-aggregate-only"
      : null,
    targetAgeBandMatches: readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND,
  };
}

function transitionFor(state: {
  r1179State: R1179State;
  r1183State: R1183State;
  r1184State: R1184State;
}): PacketTransition {
  if (!r1179Usable(state.r1179State)) {
    return {
      conclusion: "average_submitter_safe_submission_packet_waiting_on_objective_gap_audit_refresh",
      nextAction: "refresh_r1179_objective_gap_audit",
    };
  }
  if (!r1184Usable(state.r1184State)) {
    return {
      conclusion: "average_submitter_safe_submission_packet_waiting_on_chain_status_refresh",
      nextAction: "refresh_r1184_safe_response_chain_status",
    };
  }
  if (r1184ReadyForFeatureOnlyResearchPlanning(state.r1184State)) {
    return {
      conclusion: "average_submitter_safe_submission_packet_ready_for_feature_only_research_planning",
      nextAction: "use_r1181_feature_only_execution_contract_for_research_planning_only",
    };
  }
  if (r1184WaitingOnR1180ConfirmedResponseIntake(state.r1184State)) {
    return {
      conclusion: "average_submitter_safe_submission_packet_waiting_on_r1180_confirmed_response_intake",
      nextAction: "run_r1180_with_r1183_confirmed_safe_response_artifact",
    };
  }
  if (r1184WaitingOnRowOwnerConfirmation(state.r1184State) && r1183ReadyForExplicitConfirmation(state.r1183State)) {
    return {
      conclusion: "average_submitter_safe_submission_packet_waiting_on_row_owner_confirmation",
      nextAction: "collect_boolean_only_row_owner_confirmation_then_rerun_r1183",
    };
  }
  if (!r1183ReadyForExplicitConfirmation(state.r1183State)) {
    return {
      conclusion: "average_submitter_safe_submission_packet_waiting_on_r1183_materializer_refresh",
      nextAction: "refresh_r1183_safe_response_materializer",
    };
  }
  return {
    conclusion: "average_submitter_safe_submission_packet_waiting_on_chain_status_refresh",
    nextAction: "refresh_r1184_safe_response_chain_status",
  };
}

function r1179Usable(state: R1179State): boolean {
  return state.inputArtifactAvailable
    && state.schemaCurrent
    && state.packetId === R1179_PACKET_ID
    && state.status === "research-local-aggregate-only"
    && state.artifactBoundaryAggregateOnly === true
    && !state.artifactBoundaryUnsafeTrueFlagFound
    && state.averageSubmitterLikelySubmittable === true
    && state.goalAchieved === false
    && state.minimumPairMatches
    && state.modelEvidencePromotionAllowed === false
    && state.prioritizedInputKindsMatch
    && state.productDisplayAuthorized === false
    && state.readyToMarkComplete === false
    && state.realLabWearableRouteMetricsRecorded === false
    && state.rowLevelDataAcceptedByR1179 === false
    && state.rowOwnerConfirmationInferredByR1179 === false
    && state.rowOwnerPrivateValuesStored === false
    && state.rowParsingPerformedByR1179 === false
    && state.sourcePriorityMatches
    && state.targetAgeBandMatches;
}

function r1183ReadyForExplicitConfirmation(state: R1183State): boolean {
  return state.inputArtifactAvailable
    && state.schemaCurrent
    && state.packetId === R1183_PACKET_ID
    && state.status === "research-local-aggregate-only"
    && state.artifactBoundaryAggregateOnly === true
    && !state.artifactBoundaryUnsafeTrueFlagFound
    && state.conclusion === "average_submitter_safe_response_materializer_ready_for_explicit_confirmation"
    && state.nextAction === "rerun_r1183_with_row_owner_safe_response_assertion"
    && state.confirmedResponseArtifactWritten === false
    && state.explicitRowOwnerSafeResponseAssertionProvided === false
    && state.fillableResponseArtifactPresent === true
    && state.materializerReadyForRowOwnerConfirmation === true
    && state.minimumPairMatches
    && state.modelEvidencePromotionAllowed === false
    && state.productDisplayAuthorized === false
    && state.requiredResponseFieldsMatch
    && state.reviewGptRequiredNow === false
    && state.rowLevelDataAcceptedByR1183 === false
    && state.rowOwnerConfirmationInferredByR1183 === false
    && state.rowOwnerPrivateValuesStored === false
    && state.rowOwnerSafeResponseAssertionStillRequired === true
    && state.rowOwnerSafeResponseValuesStoredInR1183Packet === false
    && state.rowParsingPerformedByR1183 === false
    && state.sourcePriorityMatches
    && state.targetAgeBandMatches;
}

function r1184Usable(state: R1184State): boolean {
  return state.inputArtifactAvailable
    && state.schemaCurrent
    && state.packetId === R1184_PACKET_ID
    && state.status === "research-local-aggregate-only"
    && state.artifactBoundaryAggregateOnly === true
    && !state.artifactBoundaryUnsafeTrueFlagFound
    && state.minimumPairMatches
    && state.modelEvidencePromotionAllowed === false
    && state.prioritizedInputKindsMatch
    && state.productDisplayAuthorized === false
    && state.requiredResponseFieldsMatch
    && state.reviewGptRequiredNow === false
    && state.rowLevelDataAcceptedByR1184 === false
    && state.rowOwnerConfirmationInferredByR1184 === false
    && state.rowOwnerPrivateValuesStored === false
    && state.rowOwnerSafeResponseValuesStoredInR1184Packet === false
    && state.rowParsingPerformedByR1184 === false
    && state.sourcePriorityMatches
    && state.targetAgeBandMatches;
}

function r1184WaitingOnRowOwnerConfirmation(state: R1184State): boolean {
  return r1184Usable(state)
    && state.conclusion === "average_submitter_safe_response_chain_waiting_on_row_owner_confirmation"
    && state.nextAction === "rerun_r1183_with_row_owner_safe_response_assertion"
    && state.confirmedResponseArtifactReadyForR1180 === false
    && state.explicitRowOwnerSafeConfirmationProvided === false
    && state.featureOnlyExecutionContractReady === false
    && state.featureOnlySafeConfirmationReady === false
    && state.fillableResponseArtifactPresent === true
    && state.handoffReadyForResearchPlanningOnly === false
    && state.materializerReadyForRowOwnerConfirmation === true
    && state.nextActionRequiresExplicitRowOwnerAssertion === true
    && state.rowOwnerSafeResponseAssertionStillRequired === true;
}

function r1184WaitingOnR1180ConfirmedResponseIntake(state: R1184State): boolean {
  return r1184Usable(state)
    && state.conclusion === "average_submitter_safe_response_chain_waiting_on_r1180_confirmed_response_intake"
    && state.nextAction === "run_r1180_with_r1183_confirmed_safe_response_artifact"
    && state.confirmedResponseArtifactReadyForR1180 === true
    && state.nextActionRequiresExplicitRowOwnerAssertion === false;
}

function r1184ReadyForFeatureOnlyResearchPlanning(state: R1184State): boolean {
  return r1184Usable(state)
    && state.conclusion === "average_submitter_safe_response_chain_ready_for_feature_only_research_planning"
    && state.nextAction === "use_r1181_feature_only_execution_contract_for_research_planning_only"
    && state.explicitRowOwnerSafeConfirmationProvided === true
    && state.featureOnlyExecutionContractReady === true
    && state.featureOnlySafeConfirmationReady === true
    && state.handoffReadyForResearchPlanningOnly === true
    && exactStringSet(state.safeExecutionFeatureSlotIds, SAFE_EXECUTION_FEATURE_SLOT_IDS);
}

function commandForNextAction(nextAction: PacketNextAction): string | null {
  if (nextAction === "collect_boolean_only_row_owner_confirmation_then_rerun_r1183") {
    return R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_EXPLICIT_CONFIRMATION_COMMAND;
  }
  if (nextAction === "refresh_r1179_objective_gap_audit") {
    return R1179_AVERAGE_SUBMITTER_OBJECTIVE_GAP_AUDIT_COMMAND;
  }
  if (nextAction === "refresh_r1183_safe_response_materializer") {
    return R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND;
  }
  if (nextAction === "refresh_r1184_safe_response_chain_status") {
    return R1184_AVERAGE_SUBMITTER_SAFE_RESPONSE_CHAIN_STATUS_COMMAND;
  }
  if (nextAction === "run_r1180_with_r1183_confirmed_safe_response_artifact") {
    return R1180_CONFIRMED_RESPONSE_INTAKE_COMMAND;
  }
  return null;
}

function rowOwnerActionRouteStatusFor(
  conclusion: PacketConclusion,
): R1186AverageSubmitterSafeSubmissionPacketOutput["summary"]["rowOwnerActionRouteStatus"] {
  if (conclusion === "average_submitter_safe_submission_packet_ready_for_feature_only_research_planning") {
    return "feature_only_research_planning_ready";
  }
  if (conclusion === "average_submitter_safe_submission_packet_waiting_on_row_owner_confirmation") {
    return "waiting_on_boolean_only_safe_confirmation";
  }
  if (conclusion === "average_submitter_safe_submission_packet_waiting_on_r1180_confirmed_response_intake") {
    return "waiting_on_confirmed_response_intake";
  }
  return "waiting_on_safe_chain_refresh";
}

function rejectUnsafeInputs(state: {
  r1179State: R1179State;
  r1183State: R1183State;
  r1184State: R1184State;
}): void {
  const r1179Findings = [
    state.r1179State.artifactBoundaryUnsafeTrueFlagFound,
    state.r1179State.modelEvidencePromotionAllowed === true,
    state.r1179State.productDisplayAuthorized === true,
    state.r1179State.rowLevelDataAcceptedByR1179 === true,
    state.r1179State.rowOwnerConfirmationInferredByR1179 === true,
    state.r1179State.rowOwnerPrivateValuesStored === true,
    state.r1179State.rowParsingPerformedByR1179 === true,
  ].filter(Boolean).length;
  const r1183Findings = [
    state.r1183State.artifactBoundaryUnsafeTrueFlagFound,
    state.r1183State.modelEvidencePromotionAllowed === true,
    state.r1183State.productDisplayAuthorized === true,
    state.r1183State.rowLevelDataAcceptedByR1183 === true,
    state.r1183State.rowOwnerConfirmationInferredByR1183 === true,
    state.r1183State.rowOwnerPrivateValuesStored === true,
    state.r1183State.rowOwnerSafeResponseValuesStoredInR1183Packet === true,
    state.r1183State.rowParsingPerformedByR1183 === true,
  ].filter(Boolean).length;
  const r1184Findings = [
    state.r1184State.artifactBoundaryUnsafeTrueFlagFound,
    state.r1184State.modelEvidencePromotionAllowed === true,
    state.r1184State.productDisplayAuthorized === true,
    state.r1184State.rowLevelDataAcceptedByR1184 === true,
    state.r1184State.rowOwnerConfirmationInferredByR1184 === true,
    state.r1184State.rowOwnerPrivateValuesStored === true,
    state.r1184State.rowOwnerSafeResponseValuesStoredInR1184Packet === true,
    state.r1184State.rowParsingPerformedByR1184 === true,
  ].filter(Boolean).length;

  if (r1179Findings > 0) {
    throw new Error(`R1186 rejected unsafe r1179 objective gap audit: ${r1179Findings} ${findingLabel(r1179Findings)}`);
  }
  if (r1183Findings > 0) {
    throw new Error(`R1186 rejected unsafe r1183 safe response materializer: ${r1183Findings} ${findingLabel(r1183Findings)}`);
  }
  if (r1184Findings > 0) {
    throw new Error(`R1186 rejected unsafe r1184 safe response chain status: ${r1184Findings} ${findingLabel(r1184Findings)}`);
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
    confirmedResponseLocalPathStored: false,
    fileNamesStored: false,
    fillableResponseLocalPathStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelEvidencePromotedByR1186: false,
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
    rowLevelDataAcceptedByR1186: false,
    rowOwnerConfirmationInferredByR1186: false,
    rowOwnerPrivateValuesStored: false,
    rowOwnerSafeConfirmationValuesStoredInR1186Packet: false,
    rowParsingPerformedByR1186: false,
    rowValuesStored: false,
    safeBooleanValuesStoredInR1186Packet: false,
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
      throw new Error("R1186 input JSON parse failed.");
    }
    throw error;
  }
}

function validateAggregateSafe(label: string, value: unknown | null): void {
  if (value === null) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1186 rejected unsafe ${label}: ${findings.length} ${findingLabel(findings.length)}`);
  }
}

function ensureNoOutputPathInOutput(value: unknown, outputDir: string): void {
  const serialized = JSON.stringify(value);
  if (serialized.includes(outputDir) || serialized.includes(OUTPUT_FILE_NAME)) {
    throw new Error("R1186 output included an output path.");
  }
}

function createdAtFor(value: string | undefined): string {
  const createdAt = value ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new Error("R1186 rejected invalid createdAt timestamp.");
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
  return error.message === "R1186 input JSON parse failed."
    || error.message === "R1186 output included an output path."
    || error.message === "R1186 rejected invalid createdAt timestamp."
    || /^R1186 rejected unsafe (?:r1179 objective gap audit|r1183 safe response materializer|r1184 safe response chain status|r1186 safe submission packet): \d+ findings?$/u
      .test(error.message);
}

async function main(): Promise<void> {
  try {
    const { output } = await runR1186AverageSubmitterSafeSubmissionPacket({
      createdAt: process.env.MURPH_AGE_R1186_CREATED_AT,
      outputDir: process.env.MURPH_AGE_R1186_OUTPUT_DIR,
      r1179Path: process.env.MURPH_AGE_R1179_AVERAGE_SUBMITTER_OBJECTIVE_GAP_AUDIT_PATH,
      r1183Path: process.env.MURPH_AGE_R1183_SAFE_RESPONSE_MATERIALIZER_PATH,
      r1184Path: process.env.MURPH_AGE_R1184_SAFE_RESPONSE_CHAIN_STATUS_PATH,
    });
    process.stdout.write(`${JSON.stringify({
      conclusion: output.summary.conclusion,
      featureOnlyResearchPlanningReady: output.summary.featureOnlyResearchPlanningReady,
      nextAction: output.summary.nextAction,
      nextActionCommand: output.summary.nextActionCommand,
      nextActionRequiresExplicitRowOwnerAssertion: output.summary.nextActionRequiresExplicitRowOwnerAssertion,
      packetId: output.packetId,
      realLabWearableRouteMetricsRecorded: output.summary.realLabWearableRouteMetricsRecorded,
      safeSubmissionPacketReady: output.summary.safeSubmissionPacketReady,
      schemaVersion: output.schemaVersion,
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${safeCliErrorMessage(error, "R1186 safe submission packet failed.")}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
