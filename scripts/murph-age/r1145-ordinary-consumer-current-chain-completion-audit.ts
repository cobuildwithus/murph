import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { R1161_MATERIALIZER_COMMAND } from "./r1161-feature-only-safe-availability-confirmation-materializer.ts";
import { R1162_ASSERTION_HANDOFF_COMMAND } from "./r1162-feature-only-safe-confirmation-assertion-handoff.ts";
import { R1163_ASSERTION_TO_RESEARCH_RUNNER_COMMAND } from "./r1163-feature-only-safe-confirmation-to-research-runner.ts";
import { R1164_FEATURE_ONLY_RESEARCH_HANDOFF_COMMAND } from "./r1164-ordinary-consumer-feature-only-research-handoff.ts";
import { R1165_SAFE_ASSERTION_RUNNER_COMMAND } from "./r1165-ordinary-consumer-feature-only-safe-assertion-runner.ts";
import {
  R1167_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_FILL_GUIDE_SCHEMA_VERSION,
  R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND,
} from "./r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide.ts";
import {
  R1170_ORDINARY_CONSUMER_SAFE_ASSERTION_SMOKE_PROOF_SCHEMA_VERSION,
  R1170_SAFE_ASSERTION_SMOKE_PROOF_COMMAND,
} from "./r1170-ordinary-consumer-safe-assertion-smoke-proof.ts";
import {
  R1172_ORDINARY_CONSUMER_SAFE_ASSERTION_MATERIALIZER_SCHEMA_VERSION,
  R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND,
} from "./r1172-ordinary-consumer-safe-assertion-materializer.ts";
import {
  R1173_ORDINARY_CONSUMER_SAFE_ASSERTION_ANSWER_SHEET_SCHEMA_VERSION,
  R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND,
} from "./r1173-ordinary-consumer-safe-assertion-answer-sheet.ts";
import {
  R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_COMMAND,
  R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_SCHEMA_VERSION,
} from "./r1175-r1172-to-r1165-safe-assertion-bridge-smoke.ts";
import {
  R1176_R1172_R1165_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_SCHEMA_VERSION,
  R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
} from "./r1176-r1172-r1165-row-owner-safe-assertion-chain-runner.ts";
export const R1145_ORDINARY_CONSUMER_CURRENT_CHAIN_COMPLETION_AUDIT_SCHEMA_VERSION =
  "murph-age-r1145-ordinary-consumer-current-chain-completion-audit.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1145-ordinary-consumer-current-chain-completion-audit.latest.json";
const CURRENT_LOOP_COMMAND = "pnpm exec tsx scripts/murph-age/r1076-current-autoresearch-loop-executor.ts" as const;
const R1148_PRIVATE_CONFIG_INTAKE_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH=<partial-private-config.json> pnpm exec tsx scripts/murph-age/r1148-ordinary-consumer-post-confirmation-private-config-intake.ts" as const;
const R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1183-average-submitter-safe-response-materializer.ts" as const;
const R1184_AVERAGE_SUBMITTER_SAFE_RESPONSE_CHAIN_STATUS_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1184-average-submitter-safe-response-chain-status.ts" as const;
const R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_SCHEMA_VERSION =
  "murph-age-r1185-average-submitter-safe-response-smoke-proof.v1" as const;
const R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1185-average-submitter-safe-response-smoke-proof.ts" as const;
const R1174_ORDINARY_CONSUMER_SAFE_NEXT_STEP_PACKET_SCHEMA_VERSION =
  "murph-age-r1174-ordinary-consumer-safe-next-step-packet.v1" as const;
const R1174_SAFE_NEXT_STEP_PACKET_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1174-ordinary-consumer-safe-next-step-packet.ts" as const;

const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first" as const;
const TARGET_AGE_BAND = "roughly_16_50" as const;
const REQUIRED_PRIMARY_INPUT_FAMILY_IDS = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
] as const;
const REQUIRED_LINKAGE_FAMILY_IDS = [
  "outcome_linkage",
  "join_time_alignment",
] as const;
const REQUIRED_ROUTE_RECIPE_IDS = [
  "lab_plus_wearable_minimum_manifest",
  "lab_glycemia_minimum_manifest",
  "wearable_activity_minimum_manifest",
  "full_labs_wearable_first_pass_manifest",
] as const;
const REQUIRED_PRIVATE_FIELD_REF_FAMILIES = [
  "personJoinKey",
  "dateOrTimeKey",
  "outcomeEvent",
  "labGlycemia",
  "wearableActivity",
] as const;
const REQUIRED_PRIVATE_TABLE_REFS = [
  "primaryTableRef",
  "outcomeTableRef",
  "labTableRef",
  "wearableTableRef",
] as const;
const REQUIRED_ROUTE_METRIC_IDS = [
  "lab_glycemia_minimum_route",
  "wearable_activity_minimum_route",
] as const;
const REQUIRED_SUBMITTER_KIT_SOURCE_FAMILY_IDS = [
  "outcome_linkage",
  "join_time_alignment",
  "bloodwork_glycemia",
  "wearable_activity_daily",
] as const;
const REQUIRED_FEATURE_ONLY_PAIR_FAMILY_IDS = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
] as const;
const REQUIRED_ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS = [
  "confirm_target_age_band_without_identifiers",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
  "confirm_outcome_linkage_and_time_alignment_if_model_evidence",
  "confirm_aggregate_count_bands_if_model_evidence",
] as const;
const REQUIRED_ORDINARY_SUBMITTER_COMPLETION_MODE_IDS = [
  "feature_only_lab_wearable_coverage",
  "outcome_linked_lab_wearable_model_evidence",
] as const;
const REQUIRED_SAFE_CONFIRMATION_ATTESTATION_KEYS = [
  "aggregateOnly",
  "localOnly",
  "noCoefficientEgress",
  "noHeaderNameEgress",
  "noParticipantEgress",
  "noPredictionEgress",
  "noPrivatePathEgress",
  "noPrivateRefValueEgress",
  "noRowEgress",
  "noSmallCellEgress",
  "noSourceTextEgress",
] as const;
const REQUIRED_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS = [
  "aggregateReadinessFacts.targetAgeBand",
  "sourceFamilies[bloodwork_glycemia].available",
  "sourceFamilies[wearable_activity_daily].available",
  "rowOwnerAssertionsConfirmed",
  ...REQUIRED_SAFE_CONFIRMATION_ATTESTATION_KEYS.map((key) => `attestations.${key}`),
] as const;
const REQUIRED_FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS = [
  "sourceFamilies[bloodwork_glycemia].available",
  "sourceFamilies[wearable_activity_daily].available",
  "sourceFamilies[common_bloodwork_core].available",
  "sourceFamilies[vitals_body_context].available",
  "rowOwnerAssertionsConfirmed",
  "privateContentExcluded",
  ...REQUIRED_SAFE_CONFIRMATION_ATTESTATION_KEYS.map((key) => `attestations.${key}`),
] as const;
const REQUIRED_R1158_INPUT_KIND_IDS = [
  "lab_portal_export_or_spreadsheet",
  "phone_watch_or_wearable_activity_export",
] as const;
const REQUIRED_R1158_FEATURE_ONLY_CHECKLIST_IDS = [
  "confirm_target_age_band_without_identifiers",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
] as const;
const REQUIRED_R1185_SAFE_RESPONSE_FIELD_IDS = [
  "confirm_target_age_band_roughly_16_50",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
] as const;
const REQUIRED_R1185_SAFE_EXECUTION_FEATURE_SLOT_IDS = [
  "glycemia_lab_presence",
  "glycemia_measurement_date_presence",
  "daily_activity_presence",
  "daily_wear_coverage_presence",
] as const;
const FEATURE_ONLY_SAFE_COMPLETION_MODE_ID = "feature_only_lab_wearable_coverage" as const;
const R1176_ROW_OWNER_HANDOFF_REASON_ID =
  "confirm_feature_only_lab_wearable_availability_before_r1176_live_chain" as const;
const REQUIRED_SAFE_ASSERTION_CHECKLIST_IDS = [
  "assert_target_age_band_roughly_16_50",
  "assert_glycemia_bloodwork_export_available",
  "assert_daily_wearable_activity_export_available",
  "assert_no_private_values_identifiers_paths_headers_or_rows",
] as const;
const REQUIRED_R1158_OPTIONAL_ADD_ON_FAMILY_IDS = [
  "common_bloodwork_core",
  "vitals_body_context",
] as const;
const SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS = [
  "booleans_only",
  "fixed_enumerated_ids_only",
] as const;
const SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS = [
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
const REQUIRED_R1154_FALSE_BOUNDARY_FLAGS = [
  "availabilityConfirmationPathStored",
  "codebookTextStored",
  "coefficientsStored",
  "fileNamesStored",
  "headerValuesStored",
  "localPathsStored",
  "modelParametersStored",
  "participantIdentifiersStored",
  "participantIdentifiersWritten",
  "predictionsStored",
  "privateConfigValuesStored",
  "privateFieldRefValuesStored",
  "privateFieldRefsStored",
  "privateTableRefValuesStored",
  "privateTableRefsStored",
  "productClaimsIncluded",
  "productDisplayAuthorized",
  "productPromotionAuthorized",
  "recommendationClaimsIncluded",
  "rowLevelDataAcceptedByR1154",
  "rowParsingPerformedByR1154",
  "rowValuesStored",
  "smallCellsStored",
  "sourceBodiesStored",
  "sourceFileNamesStored",
  "sourceVariableNamesStored",
  "splitMembershipStored",
] as const;

const INPUTS = {
  r1076: {
    artifact: "r1076-current-autoresearch-loop-executor.latest.json",
    packetId: "r1076-current-autoresearch-loop-executor",
    schemaVersion: "murph-age-r1076-current-autoresearch-loop-executor.v1",
  },
  r1135: {
    artifact: "r1135-ordinary-consumer-availability-manifest-packet.latest.json",
    packetId: "r1135-ordinary-consumer-availability-manifest-packet",
    schemaVersion: "murph-age-r1135-ordinary-consumer-availability-manifest-packet.v1",
  },
  r1142: {
    artifact: "r1142-ordinary-consumer-partial-private-chain-runner.latest.json",
    packetId: "r1142-ordinary-consumer-partial-private-chain-runner",
    schemaVersion: "murph-age-r1142-ordinary-consumer-partial-private-chain-runner.v1",
  },
  r1144: {
    artifact: "r1144-ordinary-consumer-recipe-readiness-chain-runner.latest.json",
    packetId: "r1144-ordinary-consumer-recipe-readiness-chain-runner",
    schemaVersion: "murph-age-r1144-ordinary-consumer-recipe-readiness-chain-runner.v1",
  },
  r1148: {
    artifact: "r1148-ordinary-consumer-post-confirmation-private-config-intake.latest.json",
    packetId: "r1148-ordinary-consumer-post-confirmation-private-config-intake",
    schemaVersion: "murph-age-r1148-ordinary-consumer-post-confirmation-private-config-intake.v1",
  },
  r1149: {
    artifact: "r1149-ordinary-consumer-lab-wearable-submission-kit.latest.json",
    packetId: "r1149-ordinary-consumer-lab-wearable-submission-kit",
    schemaVersion: "murph-age-r1149-ordinary-consumer-lab-wearable-submission-kit.v1",
  },
  r1151: {
    artifact: "r1151-ordinary-consumer-feature-only-submission-mode.latest.json",
    packetId: "r1151-ordinary-consumer-feature-only-submission-mode",
    schemaVersion: "murph-age-r1151-ordinary-consumer-feature-only-submission-mode.v1",
  },
  r1152: {
    artifact: "r1152-ordinary-consumer-feature-only-coverage-context-intake.latest.json",
    packetId: "r1152-ordinary-consumer-feature-only-coverage-context-intake",
    schemaVersion: "murph-age-r1152-ordinary-consumer-feature-only-coverage-context-intake.v1",
  },
  r1153: {
    artifact: "r1153-ordinary-consumer-feature-only-chain-runner.latest.json",
    packetId: "r1153-ordinary-consumer-feature-only-chain-runner",
    schemaVersion: "murph-age-r1153-ordinary-consumer-feature-only-chain-runner.v1",
  },
  r1154: {
    artifact: "r1154-ordinary-consumer-safe-availability-action-packet.latest.json",
    packetId: "r1154-ordinary-consumer-safe-availability-action-packet",
    schemaVersion: "murph-age-r1154-ordinary-consumer-safe-availability-action-packet.v1",
  },
  r1155: {
    artifact: "r1155-ordinary-consumer-safe-confirmation-feature-only-smoke-proof.latest.json",
    packetId: "r1155-ordinary-consumer-safe-confirmation-feature-only-smoke-proof",
    schemaVersion: "murph-age-r1155-ordinary-consumer-safe-confirmation-feature-only-smoke-proof.v1",
  },
  r1156: {
    artifact: "r1156-ordinary-consumer-safe-confirmation-handoff.latest.json",
    packetId: "r1156-ordinary-consumer-safe-confirmation-handoff",
    schemaVersion: "murph-age-r1156-ordinary-consumer-safe-confirmation-handoff.v1",
  },
  r1157: {
    artifact: "r1157-ordinary-consumer-safe-confirmation-chain-runner.latest.json",
    packetId: "r1157-ordinary-consumer-safe-confirmation-chain-runner",
    schemaVersion: "murph-age-r1157-ordinary-consumer-safe-confirmation-chain-runner.v1",
  },
  r1158: {
    artifact: "r1158-ordinary-consumer-safe-confirmation-fill-guide.latest.json",
    packetId: "r1158-ordinary-consumer-safe-confirmation-fill-guide",
    schemaVersion: "murph-age-r1158-ordinary-consumer-safe-confirmation-fill-guide.v1",
  },
  r1159: {
    artifact: "r1159-ordinary-consumer-safe-confirmation-answer-sheet.latest.json",
    packetId: "r1159-ordinary-consumer-safe-confirmation-answer-sheet",
    schemaVersion: "murph-age-r1159-ordinary-consumer-safe-confirmation-answer-sheet.v1",
  },
  r1160: {
    artifact: "r1160-r1159-feature-only-safe-confirmation-transcription-proof.latest.json",
    packetId: "r1160-r1159-feature-only-safe-confirmation-transcription-proof",
    schemaVersion: "murph-age-r1160-r1159-feature-only-safe-confirmation-transcription-proof.v1",
  },
  r1161: {
    artifact: "r1161-feature-only-safe-availability-confirmation-materializer.latest.json",
    packetId: "r1161-feature-only-safe-availability-confirmation-materializer",
    schemaVersion: "murph-age-r1161-feature-only-safe-availability-confirmation-materializer.v1",
  },
  r1162: {
    artifact: "r1162-feature-only-safe-confirmation-assertion-handoff.latest.json",
    packetId: "r1162-feature-only-safe-confirmation-assertion-handoff",
    schemaVersion: "murph-age-r1162-feature-only-safe-confirmation-assertion-handoff.v1",
  },
  r1163: {
    artifact: "r1163-feature-only-safe-confirmation-to-research-runner.latest.json",
    packetId: "r1163-feature-only-safe-confirmation-to-research-runner",
    schemaVersion: "murph-age-r1163-feature-only-safe-confirmation-to-research-runner.v1",
  },
  r1164: {
    artifact: "r1164-ordinary-consumer-feature-only-research-handoff.latest.json",
    packetId: "r1164-ordinary-consumer-feature-only-research-handoff",
    schemaVersion: "murph-age-r1164-ordinary-consumer-feature-only-research-handoff.v1",
  },
  r1165: {
    artifact: "r1165-ordinary-consumer-feature-only-safe-assertion-runner.latest.json",
    packetId: "r1165-ordinary-consumer-feature-only-safe-assertion-runner",
    schemaVersion: "murph-age-r1165-ordinary-consumer-feature-only-safe-assertion-runner.v1",
  },
  r1167: {
    artifact: "r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide.latest.json",
    packetId: "r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide",
    schemaVersion: R1167_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_FILL_GUIDE_SCHEMA_VERSION,
  },
  r1170: {
    artifact: "r1170-ordinary-consumer-safe-assertion-smoke-proof.latest.json",
    packetId: "r1170-ordinary-consumer-safe-assertion-smoke-proof",
    schemaVersion: R1170_ORDINARY_CONSUMER_SAFE_ASSERTION_SMOKE_PROOF_SCHEMA_VERSION,
  },
  r1172: {
    artifact: "r1172-ordinary-consumer-safe-assertion-materializer.latest.json",
    packetId: "r1172-ordinary-consumer-safe-assertion-materializer",
    schemaVersion: R1172_ORDINARY_CONSUMER_SAFE_ASSERTION_MATERIALIZER_SCHEMA_VERSION,
  },
  r1173: {
    artifact: "r1173-ordinary-consumer-safe-assertion-answer-sheet.latest.json",
    packetId: "r1173-ordinary-consumer-safe-assertion-answer-sheet",
    schemaVersion: R1173_ORDINARY_CONSUMER_SAFE_ASSERTION_ANSWER_SHEET_SCHEMA_VERSION,
  },
  r1174: {
    artifact: "r1174-ordinary-consumer-safe-next-step-packet.latest.json",
    packetId: "r1174-ordinary-consumer-safe-next-step-packet",
    schemaVersion: R1174_ORDINARY_CONSUMER_SAFE_NEXT_STEP_PACKET_SCHEMA_VERSION,
  },
  r1175: {
    artifact: "r1175-r1172-to-r1165-safe-assertion-bridge-smoke.latest.json",
    packetId: "r1175-r1172-to-r1165-safe-assertion-bridge-smoke",
    schemaVersion: R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_SCHEMA_VERSION,
  },
  r1176: {
    artifact: "r1176-r1172-r1165-row-owner-safe-assertion-chain-runner.latest.json",
    packetId: "r1176-r1172-r1165-row-owner-safe-assertion-chain-runner",
    schemaVersion: R1176_R1172_R1165_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_SCHEMA_VERSION,
  },
  r1185: {
    artifact: "r1185-average-submitter-safe-response-smoke-proof.latest.json",
    packetId: "r1185-average-submitter-safe-response-smoke-proof",
    schemaVersion: R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_SCHEMA_VERSION,
  },
} as const;

type InputKey = keyof typeof INPUTS;
type RequirementStatus = "missing" | "satisfied" | "weakly_verified";
type CompletionUnblockerStepStatus = "blocked" | "satisfied";
type CompletionUnblockerStepId =
  | "confirm_feature_only_lab_wearable_safe_availability"
  | "confirm_lab_wearable_recipe_route_requirements"
  | "provide_lab_wearable_private_route_config"
  | "run_real_lab_wearable_route_metrics";
type SafeUnblockerAllowedValueKindId = typeof SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS[number];
type SafeUnblockerBlockedContentId = typeof SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS[number];
type AuditConclusion =
  | "ordinary_consumer_current_chain_completion_audit_blocked_on_row_owner_route_evidence"
  | "ordinary_consumer_current_chain_completion_audit_ready_for_research_review"
  | "ordinary_consumer_current_chain_completion_audit_waiting_on_refresh";
type AuditNextAction =
  | "complete_safe_availability_confirmation_template"
  | "confirm_recipe_availability_assertions_for_lab_plus_wearable_route"
  | "fill_feature_only_coverage_context_template"
  | "fill_r1165_row_owner_feature_only_safe_assertion_template"
  | "fill_r1150_feature_only_safe_confirmation_from_r1159_answer_sheet"
  | "fill_safe_availability_confirmation_from_template"
  | "fill_private_route_config_for_confirmed_lab_wearable_routes"
  | "refresh_r1076_r1135_r1142_r1144_r1148_r1149_r1151_r1152_r1153_r1154_r1155_r1156_r1157_r1158_r1159_r1160_r1161_current_chain_artifacts"
  | "refresh_r1076_r1135_r1142_r1144_r1148_r1149_r1151_r1152_r1153_r1154_r1155_r1156_r1157_r1158_r1159_r1160_r1161_r1162_current_chain_artifacts"
  | "refresh_r1148_post_confirmation_private_config_intake"
  | "refresh_r1149_submitter_kit"
  | "refresh_r1151_feature_only_submission_mode"
  | "refresh_r1152_feature_only_coverage_context_intake"
  | "refresh_r1153_feature_only_chain_runner"
  | "refresh_r1154_safe_availability_action_packet"
  | "refresh_r1155_safe_confirmation_feature_only_smoke_proof"
  | "refresh_r1156_safe_confirmation_handoff"
  | "refresh_r1157_safe_confirmation_chain_runner"
  | "refresh_r1158_safe_confirmation_fill_guide"
  | "refresh_r1159_safe_confirmation_answer_sheet"
  | "refresh_r1160_safe_confirmation_transcription_proof"
  | "refresh_r1161_safe_confirmation_materializer"
  | "refresh_r1162_safe_confirmation_assertion_handoff"
  | "refresh_r1163_feature_only_safe_confirmation_to_research_runner"
  | "refresh_r1167_safe_assertion_fill_guide"
  | "refresh_r1172_safe_assertion_materializer"
  | "refresh_r1173_safe_assertion_answer_sheet"
  | "refresh_r1175_r1172_to_r1165_safe_assertion_bridge_smoke"
  | "refresh_r1176_row_owner_safe_assertion_chain"
  | "review_real_lab_wearable_route_metrics_research_only"
  | "rerun_r1161_with_row_owner_feature_only_confirmation_assertion"
  | "rerun_r1172_with_row_owner_feature_only_safe_assertion_confirmation"
  | "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation"
  | "rerun_r1165_with_valid_safe_assertion"
  | "row_owner_confirm_r1150_feature_only_safe_availability_from_r1160_transcription_proof"
  | "run_r1144_recipe_readiness_chain_with_confirmed_availability"
  | "run_r1150_safe_availability_confirmation_intake"
  | "run_r1153_feature_only_chain_with_safe_availability"
  | "run_r1150_intake_with_r1161_confirmed_feature_only_safe_availability_confirmation"
  | "run_r1164_feature_only_research_handoff"
  | "run_r1165_with_r1172_row_owner_safe_assertion"
  | "row_owner_assert_feature_only_lab_wearable_availability_then_run_r1161_materializer"
  | "row_owner_assert_feature_only_lab_wearable_availability_then_run_r1163_runner"
  | "run_r1142_partial_private_chain_for_real_lab_wearable_route_metrics"
  | "rerun_safe_availability_confirmation_with_valid_json_object"
  | "use_feature_only_coverage_context_for_research_planning_only";
type RequirementId =
  | "active_loop_prioritizes_ordinary_labs_wearables"
  | "confirmed_recipe_route_requirements_available"
  | "feature_only_chain_runner_guard_present"
  | "feature_only_coverage_context_intake_guard_present"
  | "feature_only_submission_model_evidence_guard_present"
  | "ordinary_lab_wearable_submitter_kit_available"
  | "ordinary_submitter_safe_completion_modes_present"
  | "ordinary_submitter_safe_completion_checklist_present"
  | "ordinary_submitter_kit_feature_only_guard_present"
  | "partial_private_chain_available"
  | "post_confirmation_private_config_intake_safe_action_guard_present"
  | "privacy_and_product_gate_closed"
  | "private_route_config_supplied"
  | "real_lab_wearable_route_metrics_recorded"
  | "route_recipes_cover_lab_and_wearable_submitter_inputs"
  | "row_owner_availability_assertions_confirmed"
  | "safe_availability_action_packet_guard_present"
  | "safe_confirmation_chain_runner_present"
  | "safe_confirmation_answer_sheet_present"
  | "safe_confirmation_materializer_present"
  | "safe_confirmation_assertion_handoff_present"
  | "feature_only_safe_assertion_fill_guide_present"
  | "feature_only_safe_assertion_answer_sheet_present"
  | "feature_only_safe_assertion_materializer_present"
  | "feature_only_safe_assertion_bridge_smoke_present"
  | "feature_only_safe_assertion_live_chain_present"
  | "safe_confirmation_transcription_proof_present"
  | "safe_confirmation_fill_guide_present"
  | "safe_confirmation_handoff_packet_present"
  | "safe_confirmation_feature_only_smoke_proof_present"
  | "safe_row_owner_assertion_gate_present";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface AuditChecklistItem {
  evidenceArtifacts: string[];
  requirementId: RequirementId;
  status: RequirementStatus;
  why: string;
}

interface CompletionAuditCommands {
  currentLoopCommand: typeof CURRENT_LOOP_COMMAND;
  partialPrivateChainRunnerCommand: string | null;
  postConfirmationPrivateConfigIntakeCommand: typeof R1148_PRIVATE_CONFIG_INTAKE_COMMAND;
  recipeReadinessChainRunnerCommand: string | null;
  rowOwnerSafeAssertionChainRunnerCommand: typeof R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND;
}

interface CompletionUnblockerStep {
  allowedValueKindIds: SafeUnblockerAllowedValueKindId[];
  blocker: string;
  blockedContentIds: SafeUnblockerBlockedContentId[];
  command: string | null;
  minimumFeaturePairRequired: Array<typeof REQUIRED_FEATURE_ONLY_PAIR_FAMILY_IDS[number]>;
  nextAction: AuditNextAction;
  optionalAddOnFamilyIds: Array<typeof REQUIRED_R1158_OPTIONAL_ADD_ON_FAMILY_IDS[number]>;
  prioritizedInputFamilyIds: string[];
  privateDetailsStored: false;
  productDisplayAuthorized: false;
  requirementId: RequirementId;
  requiredInputKindIds: Array<typeof REQUIRED_R1158_INPUT_KIND_IDS[number]>;
  rowLevelDataAccepted: false;
  safeCompletionChecklistItemIds: Array<typeof REQUIRED_R1158_FEATURE_ONLY_CHECKLIST_IDS[number]>;
  status: CompletionUnblockerStepStatus;
  stepId: CompletionUnblockerStepId;
  targetAgeBand: typeof TARGET_AGE_BAND;
  targetInputPriority: typeof TARGET_INPUT_PRIORITY;
}

export interface R1145OrdinaryConsumerCurrentChainCompletionAuditOptions {
  createdAt?: string;
  outputDir?: string;
  r1076Path?: string;
  r1135Path?: string;
  r1142Path?: string;
  r1144Path?: string;
  r1148Path?: string;
  r1149Path?: string;
  r1151Path?: string;
  r1152Path?: string;
  r1153Path?: string;
  r1154Path?: string;
  r1155Path?: string;
  r1156Path?: string;
  r1157Path?: string;
  r1158Path?: string;
  r1159Path?: string;
  r1160Path?: string;
  r1161Path?: string;
  r1162Path?: string;
  r1163Path?: string;
  r1164Path?: string;
  r1165Path?: string;
  r1167Path?: string;
  r1170Path?: string;
  r1172Path?: string;
  r1173Path?: string;
  r1174Path?: string;
  r1175Path?: string;
  r1176Path?: string;
  r1185Path?: string;
}

export interface R1145OrdinaryConsumerCurrentChainCompletionAuditOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    privateConfigValuesStored: false;
    privateFieldRefsStored: false;
    privateTableRefsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1145: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  completionAudit: {
    blockers: string[];
    checklist: AuditChecklistItem[];
    commands: {
      currentLoopCommand: typeof CURRENT_LOOP_COMMAND;
      partialPrivateChainRunnerCommand: string | null;
      postConfirmationPrivateConfigIntakeCommand: typeof R1148_PRIVATE_CONFIG_INTAKE_COMMAND;
      recipeReadinessChainRunnerCommand: string | null;
      rowOwnerSafeAssertionChainRunnerCommand: typeof R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND;
    };
    goalAchieved: boolean;
    missingRequirementIds: RequirementId[];
    nextConcreteAction: AuditNextAction;
    prioritizedSubmitterInputFamilyIds: string[];
    readyToMarkComplete: boolean;
    restatedObjective: "prioritize_ordinary_16_50_wearable_data_and_bloodwork_labs_for_murph_age_model";
    unblockerSteps: CompletionUnblockerStep[];
    routeEvidenceState: {
      eligiblePartialRouteIds: string[];
      executedPartialRouteIds: string[];
      finalReadyPartialMetricRouteIds: string[];
      fullEvidenceGateCleared: false;
      fullSupportedRouteReady: boolean | null;
      privateDetailsStored: false;
      privateRouteConfigReadyForR1142: boolean | null;
      privateRouteConfigSupplied: boolean | null;
      privateRouteConfigSuppliedToIntake: boolean | null;
      privateRouteConfigStatus: string | null;
      realLabWearableRouteMetricsRecorded: boolean;
      requiredPrivateFieldRefFamilies: string[];
      requiredPrivateTableRefs: string[];
      rowOwnerAssertionsConfirmed: boolean | null;
    };
    featureOnlySubmissionMode: {
      conclusion: string | null;
      featureOnlyCoverageContextAllowed: boolean | null;
      featureOnlyCoverageRequiresPreferredPair: boolean | null;
      featureOnlyPreferredPairReady: boolean | null;
      minimumFeaturePairRequired: string[];
      missingEvidenceSourceFamilyIds: string[];
      missingPrimaryFeatureFamilyIds: string[];
      modelEvidencePromotionAllowed: boolean | null;
      outcomeLinkageRequiredForFeatureOnlyContext: boolean | null;
      outcomeLinkedEvidenceReady: boolean | null;
      privateDetailsStored: false;
      rowLevelDataAcceptedByR1151: boolean | null;
      supportedFeatureFamilyIds: string[];
    };
    featureOnlyCoverageContextIntake: {
      conclusion: string | null;
      contextStatus: string | null;
      coverageContextReadyForResearchPlanning: boolean | null;
      featureOnlyCoverageRequiresPreferredPair: boolean | null;
      minimumFeaturePairRequired: string[];
      missingPrimaryFeatureFamilyIds: string[];
      modelEvidencePromotionAllowed: boolean | null;
      outcomeLinkageRequiredForFeatureOnlyContext: boolean | null;
      privateDetailsStored: false;
      r1151FeatureOnlyModeReadyForIntake: boolean | null;
      rowLevelDataAcceptedByR1152: boolean | null;
      supportedFeatureFamilyIds: string[];
    };
    featureOnlyChainRunner: {
      conclusion: string | null;
      coverageContextReadyForResearchPlanning: boolean | null;
      featureOnlyCoverageContextAllowed: boolean | null;
      featureOnlyCoverageContextIntakeConclusion: string | null;
      featureOnlyCoverageContextIntakeContextStatus: string | null;
      featureOnlyModeConclusion: string | null;
      minimumFeaturePairRequired: string[];
      missingCoverageContextPrimaryFeatureFamilyIds: string[];
      missingFeatureOnlySourceFamilyIds: string[];
      modelEvidencePromotionAllowed: boolean | null;
      nextAction: string | null;
      outcomeLinkageRequiredForFeatureOnlyContext: boolean | null;
      privateDetailsStored: false;
      rowLevelDataAcceptedByR1153: boolean | null;
      safeAvailabilityFeatureOnlyCoverageContextReady: boolean | null;
      safeAvailabilityReadyForRecipeReadinessChain: boolean | null;
      supportedFeatureFamilyIds: string[];
    };
    safeConfirmationFeatureOnlySmokeProof: {
      conclusion: string | null;
      featureOnlyChainConclusion: string | null;
      featureOnlyCoverageContextReadyForResearchPlanning: boolean | null;
      modelEvidencePromotionAllowed: boolean | null;
      nextAction: string | null;
      readyForRecipeReadinessChain: boolean | null;
      rowLevelDataAcceptedByR1155: boolean | null;
      safeAvailabilityConfirmationConclusion: string | null;
      smokeEvidence: boolean | null;
    };
    safeConfirmationHandoff: {
      conclusion: string | null;
      featureOnlyPathMechanicallyProven: boolean | null;
      handoffReadyForRowOwner: boolean | null;
      modelEvidencePromotionAllowed: boolean | null;
      nextAction: string | null;
      readyForModelEvidence: boolean | null;
      readyForRecipeReadinessChain: boolean | null;
      requiredFeatureOnlySourceFamilyIds: string[];
      requiredSafeCompletionCheckIds: string[];
      rowLevelDataAcceptedByR1156: boolean | null;
      rowOwnerWorkType: string | null;
      safeConfirmationStillRequired: boolean | null;
      smokeEvidence: boolean | null;
    };
    safeConfirmationChainRunner: {
      conclusion: string | null;
      confirmationPathConfigured: boolean | null;
      featureOnlyCoverageContextReady: boolean | null;
      featureOnlyResearchPlanningReady: boolean | null;
      modelEvidencePromotionAllowed: boolean | null;
      nextAction: string | null;
      readyForModelEvidence: boolean | null;
      readyForRecipeReadinessChain: boolean | null;
      rowLevelDataAcceptedByR1157: boolean | null;
      safeConfirmationStillRequired: boolean | null;
    };
    safeConfirmationFillGuide: {
      conclusion: string | null;
      exactSafeFieldEditCount: number | null;
      guideReadyForRowOwnerFill: boolean | null;
      minimumFeaturePairRequired: string[];
      nextAction: string | null;
      optionalAddOnFamilyIds: string[];
      requiredChecklistIds: string[];
      requiredInputKindIds: string[];
      rowLevelDataAcceptedByR1158: boolean | null;
    };
    safeConfirmationAnswerSheet: {
      answerSheetReadyForRowOwner: boolean | null;
      conclusion: string | null;
      exactSafeAnswerCount: number | null;
      minimumFeaturePairRequired: string[];
      nextAction: string | null;
      optionalAddOnFamilyIds: string[];
      requiredChecklistIds: string[];
      requiredInputKindIds: string[];
      rowLevelDataAcceptedByR1159: boolean | null;
      rowOwnerProvidedValuesStored: boolean | null;
    };
    safeConfirmationTranscriptionProof: {
      conclusion: string | null;
      confirmationValuesStoredByR1160: boolean | null;
      exactSafeTranscriptionStepCount: number | null;
      hypotheticalTranscriptionWouldBeFeatureOnlyReady: boolean | null;
      nextAction: string | null;
      readyForRowOwnerConfirmation: boolean | null;
      requiredInputKindIds: string[];
      rowLevelDataAcceptedByR1160: boolean | null;
      rowOwnerConfirmationStillRequired: boolean | null;
      rowOwnerProvidedValuesStored: boolean | null;
    };
    safeConfirmationMaterializer: {
      conclusion: string | null;
      confirmationValuesStoredInR1161Packet: boolean | null;
      explicitRowOwnerConfirmationAssertionProvided: boolean | null;
      featureOnlyConfirmationWouldBeReadyForR1150: boolean | null;
      nextAction: string | null;
      rowLevelDataAcceptedByR1161: boolean | null;
      rowOwnerConfirmationStillRequired: boolean | null;
      rowOwnerPrivateValuesStored: boolean | null;
      safeConfirmationArtifact: string | null;
      safeConfirmationArtifactWritten: boolean | null;
      safeMaterializedFieldCount: number | null;
    };
    safeConfirmationAssertionHandoff: {
      conclusion: string | null;
      confirmationValuesStoredByR1162: boolean | null;
      explicitRowOwnerConfirmationAssertionProvided: boolean | null;
      featureOnlyConfirmationWouldBeReadyForR1150: boolean | null;
      handoffReadyForRowOwner: boolean | null;
      materializerCommand: string | null;
      materializerNextAction: string | null;
      minimumFeaturePairRequired: string[];
      nextAction: string | null;
      requiredChecklistIds: string[];
      requiredInputKindIds: string[];
      rowLevelDataAcceptedByR1162: boolean | null;
      rowOwnerAssertionInferredByR1162: boolean | null;
      rowOwnerAssertionStillRequired: boolean | null;
      rowOwnerPrivateValuesStored: boolean | null;
      safeConfirmationArtifactWritten: boolean | null;
    };
    safeAvailabilityActionPacket: {
      conclusion: string | null;
      featureOnlyCoverageContextReady: boolean | null;
      featureOnlyQuickstartArtifact: string | null;
      featureOnlyQuickstartSafeFieldEditCount: number | null;
      featureOnlyQuickstartSafeFieldEditPaths: string[];
      fillableTemplateArtifact: string | null;
      featureOnlyFillableTemplateArtifact: string | null;
      minimumFeaturePairRequired: string[];
      missingAggregateReadinessFactIds: string[];
      missingAttestationKeys: string[];
      missingFeatureOnlySourceFamilyIds: string[];
      missingRequiredSourceFamilyIds: string[];
      nextAction: string | null;
      ordinarySubmitterCompletionModeIds: string[];
      ordinarySubmitterSafeCompletionChecklistItemIds: string[];
      outcomeLinkageRequiredForFeatureOnlyContext: boolean | null;
      preferredRecipeId: string | null;
      privateDetailsStored: false;
      readyForOutcomeLinkedRecipeReadinessChain: boolean | null;
      rowLevelDataAcceptedByR1154: boolean | null;
      rowOwnerAssertionsConfirmed: boolean | null;
      rowOwnerWorkType: string | null;
      safeAvailabilityConfirmationStatus: string | null;
    };
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
  createdAt: string;
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  packetId: "r1145-ordinary-consumer-current-chain-completion-audit";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1145_ORDINARY_CONSUMER_CURRENT_CHAIN_COMPLETION_AUDIT_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: AuditConclusion;
    goalAchieved: boolean;
    nextAction: AuditNextAction;
    completionUnblockerBlockedRequirementIds: RequirementId[];
    completionUnblockerBlockedStepIds: CompletionUnblockerStepId[];
    completionUnblockerCommandCount: number;
    completionUnblockerStepIds: CompletionUnblockerStepId[];
    completionUnblockerTopAllowedValueKindIds: SafeUnblockerAllowedValueKindId[];
    completionUnblockerTopBlockedContentIds: SafeUnblockerBlockedContentId[];
    completionUnblockerTopCommand: string | null;
    completionUnblockerTopNextAction: AuditNextAction | null;
    completionUnblockerTopRequirementId: RequirementId | null;
    completionUnblockerTopRequiredInputKindIds: Array<typeof REQUIRED_R1158_INPUT_KIND_IDS[number]>;
    completionUnblockerTopSafeCompletionChecklistItemIds: Array<typeof REQUIRED_R1158_FEATURE_ONLY_CHECKLIST_IDS[number]>;
    completionUnblockerTopStepId: CompletionUnblockerStepId | null;
    productDisplayAuthorized: false;
    postConfirmationPrivateConfigIntakeConclusion: string | null;
    postConfirmationPrivateConfigIntakeNextAction: string | null;
    postConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketNextAction: string | null;
    readyToMarkComplete: boolean;
    reviewGptRequiredNow: boolean;
    rowParsingPerformedByR1145: false;
    safeAvailabilityActionPacketConclusion: string | null;
    safeAvailabilityActionPacketChecklistItemIds: string[];
    safeAvailabilityActionPacketCompletionModeIds: string[];
    safeAvailabilityActionPacketFillableTemplateArtifact: string | null;
    safeAvailabilityActionPacketFeatureOnlyFillableTemplateArtifact: string | null;
    safeAvailabilityActionPacketFeatureOnlyCoverageContextReady: boolean | null;
    safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact: string | null;
    safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount: number | null;
    safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths: string[];
    safeAvailabilityActionPacketNextAction: string | null;
    safeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain: boolean | null;
    safeConfirmationFeatureOnlySmokeProofConclusion: string | null;
    safeConfirmationFeatureOnlySmokeProofFeatureOnlyChainConclusion: string | null;
    safeConfirmationFeatureOnlySmokeProofFeatureOnlyCoverageContextReadyForResearchPlanning: boolean | null;
    safeConfirmationFeatureOnlySmokeProofModelEvidencePromotionAllowed: boolean | null;
    safeConfirmationFeatureOnlySmokeProofNextAction: string | null;
    safeConfirmationFeatureOnlySmokeProofReadyForRecipeReadinessChain: boolean | null;
    safeConfirmationFeatureOnlySmokeProofRowLevelDataAcceptedByR1155: boolean | null;
    safeConfirmationFeatureOnlySmokeProofSafeAvailabilityConfirmationConclusion: string | null;
    safeConfirmationFeatureOnlySmokeProofSmokeEvidence: boolean | null;
    safeConfirmationHandoffConclusion: string | null;
    safeConfirmationHandoffFeatureOnlyPathMechanicallyProven: boolean | null;
    safeConfirmationHandoffHandoffReadyForRowOwner: boolean | null;
    safeConfirmationHandoffModelEvidencePromotionAllowed: boolean | null;
    safeConfirmationHandoffNextAction: string | null;
    safeConfirmationHandoffReadyForModelEvidence: boolean | null;
    safeConfirmationHandoffReadyForRecipeReadinessChain: boolean | null;
    safeConfirmationHandoffRequiredFeatureOnlySourceFamilyIds: string[];
    safeConfirmationHandoffRequiredSafeCompletionCheckIds: string[];
    safeConfirmationHandoffRowLevelDataAcceptedByR1156: boolean | null;
    safeConfirmationHandoffRowOwnerWorkType: string | null;
    safeConfirmationHandoffSafeConfirmationStillRequired: boolean | null;
    safeConfirmationHandoffSmokeEvidence: boolean | null;
    safeConfirmationChainRunnerConclusion: string | null;
    safeConfirmationChainRunnerFeatureOnlyResearchPlanningReady: boolean | null;
    safeConfirmationChainRunnerModelEvidencePromotionAllowed: boolean | null;
    safeConfirmationChainRunnerNextAction: string | null;
    safeConfirmationChainRunnerReadyForModelEvidence: boolean | null;
    safeConfirmationChainRunnerReadyForRecipeReadinessChain: boolean | null;
    safeConfirmationChainRunnerRowLevelDataAcceptedByR1157: boolean | null;
    safeConfirmationChainRunnerSafeConfirmationStillRequired: boolean | null;
    safeConfirmationFillGuideConclusion: string | null;
    safeConfirmationFillGuideExactSafeFieldEditCount: number | null;
    safeConfirmationFillGuideGuideReadyForRowOwnerFill: boolean | null;
    safeConfirmationFillGuideNextAction: string | null;
    safeConfirmationFillGuideRequiredInputKindIds: string[];
    safeConfirmationFillGuideRowLevelDataAcceptedByR1158: boolean | null;
    safeConfirmationAnswerSheetConclusion: string | null;
    safeConfirmationAnswerSheetExactSafeAnswerCount: number | null;
    safeConfirmationAnswerSheetReadyForRowOwner: boolean | null;
    safeConfirmationAnswerSheetNextAction: string | null;
    safeConfirmationAnswerSheetRequiredInputKindIds: string[];
    safeConfirmationAnswerSheetRowLevelDataAcceptedByR1159: boolean | null;
    safeConfirmationAnswerSheetRowOwnerProvidedValuesStored: boolean | null;
    safeConfirmationTranscriptionProofConclusion: string | null;
    safeConfirmationTranscriptionProofConfirmationValuesStoredByR1160: boolean | null;
    safeConfirmationTranscriptionProofExactSafeTranscriptionStepCount: number | null;
    safeConfirmationTranscriptionProofHypotheticalTranscriptionWouldBeFeatureOnlyReady: boolean | null;
    safeConfirmationTranscriptionProofNextAction: string | null;
    safeConfirmationTranscriptionProofReadyForRowOwnerConfirmation: boolean | null;
    safeConfirmationTranscriptionProofRequiredInputKindIds: string[];
    safeConfirmationTranscriptionProofRowLevelDataAcceptedByR1160: boolean | null;
    safeConfirmationTranscriptionProofRowOwnerConfirmationStillRequired: boolean | null;
    safeConfirmationTranscriptionProofRowOwnerProvidedValuesStored: boolean | null;
    safeConfirmationMaterializerConclusion: string | null;
    safeConfirmationMaterializerConfirmationValuesStoredInR1161Packet: boolean | null;
    safeConfirmationMaterializerExplicitRowOwnerConfirmationAssertionProvided: boolean | null;
    safeConfirmationMaterializerFeatureOnlyConfirmationWouldBeReadyForR1150: boolean | null;
    safeConfirmationMaterializerNextAction: string | null;
    safeConfirmationMaterializerRowLevelDataAcceptedByR1161: boolean | null;
    safeConfirmationMaterializerRowOwnerConfirmationStillRequired: boolean | null;
    safeConfirmationMaterializerRowOwnerPrivateValuesStored: boolean | null;
    safeConfirmationMaterializerSafeConfirmationArtifact: string | null;
    safeConfirmationMaterializerSafeConfirmationArtifactWritten: boolean | null;
    safeConfirmationMaterializerSafeMaterializedFieldCount: number | null;
    safeConfirmationAssertionHandoffConclusion: string | null;
    safeConfirmationAssertionHandoffConfirmationValuesStoredByR1162: boolean | null;
    safeConfirmationAssertionHandoffExplicitRowOwnerConfirmationAssertionProvided: boolean | null;
    safeConfirmationAssertionHandoffFeatureOnlyConfirmationWouldBeReadyForR1150: boolean | null;
    safeConfirmationAssertionHandoffHandoffReadyForRowOwner: boolean | null;
    safeConfirmationAssertionHandoffMaterializerCommand: string | null;
    safeConfirmationAssertionHandoffMaterializerNextAction: string | null;
    safeConfirmationAssertionHandoffMinimumFeaturePairRequired: string[];
    safeConfirmationAssertionHandoffNextAction: string | null;
    safeConfirmationAssertionHandoffRequiredChecklistIds: string[];
    safeConfirmationAssertionHandoffRequiredInputKindIds: string[];
    safeConfirmationAssertionHandoffRowLevelDataAcceptedByR1162: boolean | null;
    safeConfirmationAssertionHandoffRowOwnerAssertionInferredByR1162: boolean | null;
    safeConfirmationAssertionHandoffRowOwnerAssertionStillRequired: boolean | null;
    safeConfirmationAssertionHandoffRowOwnerPrivateValuesStored: boolean | null;
    safeConfirmationAssertionHandoffSafeConfirmationArtifactWritten: boolean | null;
    safeConfirmationToResearchRunnerConclusion: string | null;
    safeConfirmationToResearchRunnerConfirmedSafeConfirmationArtifact: string | null;
    safeConfirmationToResearchRunnerExplicitRowOwnerAssertionProvided: boolean | null;
    safeConfirmationToResearchRunnerFeatureOnlyChainRan: boolean | null;
    safeConfirmationToResearchRunnerFeatureOnlyResearchPlanningReady: boolean | null;
    safeConfirmationToResearchRunnerNextAction: string | null;
    safeConfirmationToResearchRunnerRowLevelDataAcceptedByR1163: boolean | null;
    safeConfirmationToResearchRunnerRowOwnerAssertionInferredByR1163: boolean | null;
    safeConfirmationToResearchRunnerRowOwnerAssertionStillRequired: boolean | null;
    safeConfirmationToResearchRunnerRowOwnerPrivateValuesStored: boolean | null;
    safeConfirmationToResearchRunnerSafeConfirmationArtifactWritten: boolean | null;
    featureOnlyResearchHandoffCommand: string | null;
    featureOnlyResearchHandoffConclusion: string | null;
    featureOnlyResearchHandoffFeatureOnlyResearchPlanningReady: boolean | null;
    featureOnlyResearchHandoffMinimumFeaturePairRequired: string[];
    featureOnlyResearchHandoffNextAction: string | null;
    featureOnlyResearchHandoffOutcomeLinkedModelEvidenceStillRequired: boolean | null;
    featureOnlyResearchHandoffPrioritizedInputKindIds: string[];
    featureOnlyResearchHandoffResearchPlanningAllowed: boolean | null;
    featureOnlyResearchHandoffRowLevelDataAcceptedByR1164: boolean | null;
    featureOnlyResearchHandoffRowOwnerPrivateValuesStored: boolean | null;
    featureOnlySafeAssertionRunnerCommand: string | null;
    featureOnlySafeAssertionRunnerConclusion: string | null;
    featureOnlySafeAssertionRunnerNextAction: string | null;
    featureOnlySafeAssertionRunnerAssertionAccepted: boolean | null;
    featureOnlySafeAssertionRunnerAssertionProvided: boolean | null;
    featureOnlySafeAssertionRunnerAssertionTemplateArtifact: string | null;
    featureOnlySafeAssertionRunnerChildR1163Ran: boolean | null;
    featureOnlySafeAssertionRunnerFeatureOnlyResearchPlanningReady: boolean | null;
    featureOnlySafeAssertionRunnerRequiredInputKindIds: string[];
    featureOnlySafeAssertionRunnerRequiredAssertionChecklistIds: string[];
    featureOnlySafeAssertionRunnerOptionalAddOnFamilyIds: string[];
    featureOnlySafeAssertionRunnerValidationReasonIds: string[];
    featureOnlySafeAssertionRunnerRowLevelDataAcceptedByR1165: boolean | null;
    featureOnlySafeAssertionRunnerRowOwnerPrivateValuesStored: boolean | null;
    featureOnlySafeAssertionFillGuideCommand: string | null;
    featureOnlySafeAssertionFillGuideConclusion: string | null;
    featureOnlySafeAssertionFillGuideNextAction: string | null;
    featureOnlySafeAssertionFillGuideGuideReadyForRowOwnerFill: boolean | null;
    featureOnlySafeAssertionFillGuideRequiredInputKindIds: string[];
    featureOnlySafeAssertionFillGuideOptionalAddOnFamilyIds: string[];
    featureOnlySafeAssertionFillGuideSafeFieldEditCount: number | null;
    featureOnlySafeAssertionFillGuideSafeFieldEditPaths: string[];
    featureOnlySafeAssertionFillGuideRowLevelDataAcceptedByR1167: boolean | null;
    featureOnlySafeAssertionFillGuideRowOwnerPrivateValuesStored: boolean | null;
    featureOnlySafeAssertionAnswerSheetCommand: string | null;
    featureOnlySafeAssertionAnswerSheetConclusion: string | null;
    featureOnlySafeAssertionAnswerSheetNextAction: string | null;
    featureOnlySafeAssertionAnswerSheetReadyForRowOwner: boolean | null;
    featureOnlySafeAssertionAnswerSheetMaterializerReady: boolean | null;
    featureOnlySafeAssertionAnswerSheetMaterializerExplicitConfirmationRequired: boolean | null;
    featureOnlySafeAssertionAnswerSheetExactSafeAnswerCount: number | null;
    featureOnlySafeAssertionAnswerSheetAllowedValueKindIds: string[];
    featureOnlySafeAssertionAnswerSheetBlockedAssertionContentIds: string[];
    featureOnlySafeAssertionAnswerSheetRequiredInputKindIds: string[];
    featureOnlySafeAssertionAnswerSheetRequiredAssertionChecklistIds: string[];
    featureOnlySafeAssertionAnswerSheetSafeFieldEditPaths: string[];
    featureOnlySafeAssertionAnswerSheetRowLevelDataAcceptedByR1173: boolean | null;
    featureOnlySafeAssertionAnswerSheetRowOwnerProvidedValuesStored: boolean | null;
    featureOnlySafeAssertionMaterializerCommand: string | null;
    featureOnlySafeAssertionMaterializerConclusion: string | null;
    featureOnlySafeAssertionMaterializerNextAction: string | null;
    featureOnlySafeAssertionMaterializerExplicitRowOwnerAssertionProvided: boolean | null;
    featureOnlySafeAssertionMaterializerArtifactWritten: boolean | null;
    featureOnlySafeAssertionMaterializerRowOwnerAssertionStillRequired: boolean | null;
    featureOnlySafeAssertionMaterializerWouldBeAcceptedByR1165: boolean | null;
    featureOnlySafeAssertionMaterializerR1165RunnerReady: boolean | null;
    featureOnlySafeAssertionMaterializerR1165TemplateReady: boolean | null;
    featureOnlySafeAssertionMaterializerR1167FillGuideReady: boolean | null;
    featureOnlySafeAssertionMaterializerAllowedValueKindIds: string[];
    featureOnlySafeAssertionMaterializerBlockedContentIds: string[];
    featureOnlySafeAssertionMaterializerSafeFieldEditCount: number | null;
    featureOnlySafeAssertionMaterializerSafeFieldEditPaths: string[];
    featureOnlySafeAssertionMaterializerRowLevelDataAcceptedByR1172: boolean | null;
    featureOnlySafeAssertionMaterializerRowOwnerPrivateValuesStored: boolean | null;
    featureOnlySafeAssertionSmokeProofCommand: string | null;
    featureOnlySafeAssertionSmokeProofConclusion: string | null;
    featureOnlySafeAssertionSmokeProofNextAction: string | null;
    featureOnlySafeAssertionSmokeProofPassed: boolean | null;
    featureOnlySafeAssertionSmokeProofSynthetic: boolean | null;
    featureOnlySafeAssertionSmokeProofRealEvidenceProduced: boolean | null;
    featureOnlySafeAssertionSmokeProofModelEvidencePromotionAllowed: boolean | null;
    featureOnlySafeAssertionSmokeProofLiveChainGateStillRequired: boolean | null;
    featureOnlySafeAssertionSmokeProofR1165AssertionAccepted: boolean | null;
    featureOnlySafeAssertionSmokeProofR1165ChildR1163Ran: boolean | null;
    featureOnlySafeAssertionSmokeProofR1165FeatureOnlyResearchPlanningReady: boolean | null;
    featureOnlySafeAssertionSmokeProofSafeFieldEditCount: number | null;
    featureOnlySafeAssertionSmokeProofSafeFieldEditPaths: string[];
    featureOnlySafeAssertionSmokeProofRowLevelDataAcceptedByR1170: boolean | null;
    featureOnlySafeAssertionSmokeProofRowOwnerPrivateValuesStored: boolean | null;
    featureOnlySafeAssertionBridgeSmokeCommand: string | null;
    featureOnlySafeAssertionBridgeSmokeAllowedValueKindIds: string[];
    featureOnlySafeAssertionBridgeSmokeBlockedContentIds: string[];
    featureOnlySafeAssertionBridgeSmokeOptionalAddOnFamilyIds: string[];
    featureOnlySafeAssertionBridgeSmokeConclusion: string | null;
    featureOnlySafeAssertionBridgeSmokeNextAction: string | null;
    featureOnlySafeAssertionBridgeSmokePassed: boolean | null;
    featureOnlySafeAssertionBridgeSmokeSynthetic: boolean | null;
    featureOnlySafeAssertionBridgeSmokeRealEvidenceProduced: boolean | null;
    featureOnlySafeAssertionBridgeSmokeModelEvidencePromotionAllowed: boolean | null;
    featureOnlySafeAssertionBridgeSmokeLiveChainGateStillRequired: boolean | null;
    featureOnlySafeAssertionBridgeSmokeR1172MaterializedAssertionWritten: boolean | null;
    featureOnlySafeAssertionBridgeSmokeR1172WouldBeAcceptedByR1165: boolean | null;
    featureOnlySafeAssertionBridgeSmokeR1165AssertionAccepted: boolean | null;
    featureOnlySafeAssertionBridgeSmokeR1165ChildR1163Ran: boolean | null;
    featureOnlySafeAssertionBridgeSmokeR1165FeatureOnlyResearchPlanningReady: boolean | null;
    featureOnlySafeAssertionBridgeSmokeR1163FeatureOnlyResearchPlanningReady: boolean | null;
    featureOnlySafeAssertionBridgeSmokeSafeFieldEditCount: number | null;
    featureOnlySafeAssertionBridgeSmokeSafeFieldEditPaths: string[];
    featureOnlySafeAssertionBridgeSmokeRowLevelDataAcceptedByR1175: boolean | null;
    featureOnlySafeAssertionBridgeSmokeRowOwnerPrivateValuesStored: boolean | null;
    featureOnlySafeAssertionBridgeSmokeRowParsingPerformedByR1175: boolean | null;
    featureOnlySafeNextStepPacketCommand: string | null;
    featureOnlySafeNextStepPacketAllowedValueKindIds: string[];
    featureOnlySafeNextStepPacketBlockedContentIds: string[];
    featureOnlySafeNextStepPacketConclusion: string | null;
    featureOnlySafeNextStepPacketNextAction: string | null;
    featureOnlySafeNextStepPacketReadyForR1165Runner: boolean | null;
    featureOnlySafeNextStepPacketReadyForRowOwnerR1172Confirmation: boolean | null;
    featureOnlySafeNextStepPacketReadyForRowOwnerR1176LiveChainConfirmation: boolean | null;
    featureOnlySafeNextStepPacketR1176LiveChainCommand: string | null;
    featureOnlySafeNextStepPacketSafeFieldEditCount: number | null;
    featureOnlySafeNextStepPacketSafeFieldEditPaths: string[];
    featureOnlySafeNextStepPacketRowLevelDataAcceptedByR1174: boolean | null;
    featureOnlySafeNextStepPacketRowOwnerPrivateValuesStored: boolean | null;
    featureOnlySafeNextStepPacketRowOwnerProvidedValuesStored: boolean | null;
    featureOnlySafeAssertionLiveChainCommand: string | null;
    featureOnlySafeAssertionLiveChainAllowedValueKindIds: string[];
    featureOnlySafeAssertionLiveChainBlockedContentIds: string[];
    featureOnlySafeAssertionLiveChainOptionalAddOnFamilyIds: string[];
    featureOnlySafeAssertionLiveChainCompletionModeId: string | null;
    featureOnlySafeAssertionLiveChainConclusion: string | null;
    featureOnlySafeAssertionLiveChainNextAction: string | null;
    featureOnlySafeAssertionLiveChainReady: boolean | null;
    featureOnlySafeAssertionLiveChainExplicitRowOwnerAssertionProvided: boolean | null;
    featureOnlySafeAssertionLiveChainFeatureOnlyResearchPlanningReady: boolean | null;
    featureOnlySafeAssertionLiveChainRealEvidenceProduced: boolean | null;
    featureOnlySafeAssertionLiveChainModelEvidencePromotionAllowed: boolean | null;
    featureOnlySafeAssertionLiveChainOutcomeLinkedModelEvidenceStillRequired: boolean | null;
    featureOnlySafeAssertionLiveChainRowOwnerAssertionStillRequired: boolean | null;
    featureOnlySafeAssertionLiveChainRowOwnerHandoffReasonId: string | null;
    featureOnlySafeAssertionLiveChainR1172MaterializedAssertionWritten: boolean | null;
    featureOnlySafeAssertionLiveChainR1172WouldBeAcceptedByR1165: boolean | null;
    featureOnlySafeAssertionLiveChainR1165AssertionAccepted: boolean | null;
    featureOnlySafeAssertionLiveChainR1165ChildR1163Ran: boolean | null;
    featureOnlySafeAssertionLiveChainR1165FeatureOnlyResearchPlanningReady: boolean | null;
    featureOnlySafeAssertionLiveChainR1163FeatureOnlyResearchPlanningReady: boolean | null;
    featureOnlySafeAssertionLiveChainSafeFieldEditCount: number | null;
    featureOnlySafeAssertionLiveChainSafeFieldEditPaths: string[];
    featureOnlySafeAssertionLiveChainSafeCompletionChecklistItemIds: string[];
    featureOnlySafeAssertionLiveChainRowLevelDataAcceptedByR1176: boolean | null;
    featureOnlySafeAssertionLiveChainRowOwnerPrivateValuesStored: boolean | null;
    featureOnlySafeAssertionLiveChainRowParsingPerformedByR1176: boolean | null;
    safeResponseSmokeProofCommand: string | null;
    safeResponseSmokeProofConclusion: string | null;
    safeResponseSmokeProofLiveR1184Conclusion: string | null;
    safeResponseSmokeProofLiveR1184ReadyForSyntheticSmoke: boolean | null;
    safeResponseSmokeProofNextRealAction: string | null;
    safeResponseSmokeProofNextRealActionCommand: string | null;
    safeResponseSmokeProofNextRealActionRequiresExplicitRowOwnerAssertion: boolean | null;
    safeResponseSmokeProofMinimumFeaturePairRequired: string[];
    safeResponseSmokeProofPrioritizedInputKindIds: string[];
    safeResponseSmokeProofRequiredResponseFieldIds: string[];
    safeResponseSmokeProofSafeExecutionFeatureSlotIds: string[];
    safeResponseSmokeProofSyntheticPathAdvancedToFeatureOnlyResearchPlanning: boolean | null;
    safeResponseSmokeProofSyntheticSmokeRan: boolean | null;
    safeResponseSmokeProofModelEvidencePromotionAllowed: boolean | null;
    safeResponseSmokeProofProductDisplayAuthorized: boolean | null;
    safeResponseSmokeProofRowLevelDataAcceptedByR1185: boolean | null;
    safeResponseSmokeProofRowOwnerConfirmationInferredByR1185: boolean | null;
    safeResponseSmokeProofRowOwnerPrivateValuesStored: boolean | null;
    safeResponseSmokeProofRowParsingPerformedByR1185: boolean | null;
    safeResponseSmokeProofLiveArtifactsMutatedByR1185: boolean | null;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
    topMissingRequirement: RequirementId | null;
  };
}

export async function runR1145OrdinaryConsumerCurrentChainCompletionAudit(
  options: R1145OrdinaryConsumerCurrentChainCompletionAuditOptions = {},
): Promise<{ output: R1145OrdinaryConsumerCurrentChainCompletionAuditOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);
  const requiredInputsReady = requiredNonActionPacketInputsReady(inputs);
  const checklist = checklistFor({ inputs, requiredInputsReady });
  const missingRequirementIds = checklist
    .filter((item) => item.status !== "satisfied")
    .map((item) => item.requirementId);
  const blockers = blockersFor({ inputs, missingRequirementIds, requiredInputsReady });
  const goalAchieved = requiredInputsReady && missingRequirementIds.length === 0 && blockers.length === 0;
  const nextConcreteAction = nextActionFor({ goalAchieved, inputs, requiredInputsReady });
  const routeEvidenceState = routeEvidenceStateFor(inputs);
  const auditCommands: CompletionAuditCommands = {
    currentLoopCommand: CURRENT_LOOP_COMMAND,
    partialPrivateChainRunnerCommand: readStringAt(inputs.r1135, ["summary", "partialPrivateChainRunnerCommand"])
      ?? readStringAt(inputs.r1142, ["partialPrivateChain", "commands", "partialPrivateChainRunnerCommand"]),
    postConfirmationPrivateConfigIntakeCommand: R1148_PRIVATE_CONFIG_INTAKE_COMMAND,
    recipeReadinessChainRunnerCommand: readStringAt(inputs.r1135, ["summary", "recipeReadinessChainRunnerCommand"])
      ?? readStringAt(inputs.r1144, ["recipeReadinessChain", "commands", "recipeReadinessChainRunnerCommand"]),
    rowOwnerSafeAssertionChainRunnerCommand: R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
  };
  const unblockerSteps = completionUnblockerStepsFor({ commands: auditCommands, inputs, missingRequirementIds });
  const topUnblockerStep = unblockerSteps.find((step) => step.status === "blocked") ?? null;
  const output: R1145OrdinaryConsumerCurrentChainCompletionAuditOutput = {
    artifactBoundary: safeBoundary(),
    completionAudit: {
      blockers,
      checklist,
      commands: auditCommands,
      goalAchieved,
      missingRequirementIds,
      nextConcreteAction,
      prioritizedSubmitterInputFamilyIds: [...REQUIRED_PRIMARY_INPUT_FAMILY_IDS],
      readyToMarkComplete: goalAchieved,
      restatedObjective: "prioritize_ordinary_16_50_wearable_data_and_bloodwork_labs_for_murph_age_model",
      unblockerSteps,
      routeEvidenceState,
      featureOnlySubmissionMode: featureOnlySubmissionModeFor(inputs),
      featureOnlyCoverageContextIntake: featureOnlyCoverageContextIntakeFor(inputs),
      featureOnlyChainRunner: featureOnlyChainRunnerFor(inputs),
      safeConfirmationFeatureOnlySmokeProof: safeConfirmationFeatureOnlySmokeProofFor(inputs),
      safeConfirmationHandoff: safeConfirmationHandoffFor(inputs),
      safeConfirmationChainRunner: safeConfirmationChainRunnerFor(inputs),
      safeConfirmationFillGuide: safeConfirmationFillGuideFor(inputs),
      safeConfirmationAnswerSheet: safeConfirmationAnswerSheetFor(inputs),
      safeConfirmationTranscriptionProof: safeConfirmationTranscriptionProofFor(inputs),
      safeConfirmationMaterializer: safeConfirmationMaterializerFor(inputs),
      safeConfirmationAssertionHandoff: safeConfirmationAssertionHandoffFor(inputs),
      safeAvailabilityActionPacket: safeAvailabilityActionPacketFor(inputs),
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1145-ordinary-consumer-current-chain-completion-audit",
    productDisplayAuthorized: false,
    schemaVersion: R1145_ORDINARY_CONSUMER_CURRENT_CHAIN_COMPLETION_AUDIT_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: conclusionFor({ goalAchieved, requiredInputsReady }),
      goalAchieved,
      nextAction: nextConcreteAction,
      completionUnblockerBlockedRequirementIds: unblockerSteps
        .filter((step) => step.status === "blocked")
        .map((step) => step.requirementId),
      completionUnblockerBlockedStepIds: unblockerSteps
        .filter((step) => step.status === "blocked")
        .map((step) => step.stepId),
      completionUnblockerCommandCount: unblockerSteps.filter((step) => step.command !== null).length,
      completionUnblockerStepIds: unblockerSteps.map((step) => step.stepId),
      completionUnblockerTopAllowedValueKindIds: topUnblockerStep?.allowedValueKindIds ?? [],
      completionUnblockerTopBlockedContentIds: topUnblockerStep?.blockedContentIds ?? [],
      completionUnblockerTopCommand: topUnblockerStep?.command ?? null,
      completionUnblockerTopNextAction: topUnblockerStep?.nextAction ?? null,
      completionUnblockerTopRequirementId: topUnblockerStep?.requirementId ?? null,
      completionUnblockerTopRequiredInputKindIds: topUnblockerStep?.requiredInputKindIds ?? [],
      completionUnblockerTopSafeCompletionChecklistItemIds: topUnblockerStep?.safeCompletionChecklistItemIds ?? [],
      completionUnblockerTopStepId: topUnblockerStep?.stepId ?? null,
      productDisplayAuthorized: false,
      postConfirmationPrivateConfigIntakeConclusion: readStringAt(inputs.r1148, ["summary", "conclusion"]),
      postConfirmationPrivateConfigIntakeNextAction: readStringAt(inputs.r1148, ["summary", "nextAction"]),
      postConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketNextAction:
        readStringAt(inputs.r1148, ["summary", "safeAvailabilityActionPacketNextAction"]),
      readyToMarkComplete: goalAchieved,
      reviewGptRequiredNow: reviewGptRequiredNow(inputs),
      rowParsingPerformedByR1145: false,
      safeAvailabilityActionPacketConclusion: readStringAt(inputs.r1154, ["summary", "conclusion"]),
      safeAvailabilityActionPacketChecklistItemIds:
        readStringArrayAt(inputs.r1154, ["summary", "ordinarySubmitterSafeCompletionChecklistItemIds"]),
      safeAvailabilityActionPacketCompletionModeIds:
        readStringArrayAt(inputs.r1154, ["summary", "ordinarySubmitterCompletionModeIds"]),
      safeAvailabilityActionPacketFillableTemplateArtifact:
        readStringAt(inputs.r1154, ["summary", "fillableTemplateArtifact"]),
      safeAvailabilityActionPacketFeatureOnlyFillableTemplateArtifact:
        readStringAt(inputs.r1154, ["summary", "featureOnlyFillableTemplateArtifact"]),
      safeAvailabilityActionPacketFeatureOnlyCoverageContextReady:
        readBooleanAt(inputs.r1154, ["summary", "featureOnlyCoverageContextReady"]),
      safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact:
        readStringAt(inputs.r1154, ["summary", "featureOnlyQuickstartArtifact"]),
      safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount:
        readNumberAt(inputs.r1154, ["summary", "featureOnlyQuickstartSafeFieldEditCount"]),
      safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths:
        readStringArrayAt(inputs.r1154, ["summary", "featureOnlyQuickstartSafeFieldEditPaths"]),
      safeAvailabilityActionPacketNextAction: readStringAt(inputs.r1154, ["summary", "nextAction"]),
      safeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain:
        readBooleanAt(inputs.r1154, ["summary", "readyForOutcomeLinkedRecipeReadinessChain"]),
      safeConfirmationFeatureOnlySmokeProofConclusion: readStringAt(inputs.r1155, ["summary", "conclusion"]),
      safeConfirmationFeatureOnlySmokeProofFeatureOnlyChainConclusion:
        readStringAt(inputs.r1155, ["summary", "featureOnlyChainConclusion"]),
      safeConfirmationFeatureOnlySmokeProofFeatureOnlyCoverageContextReadyForResearchPlanning:
        readBooleanAt(inputs.r1155, ["summary", "featureOnlyCoverageContextReadyForResearchPlanning"]),
      safeConfirmationFeatureOnlySmokeProofModelEvidencePromotionAllowed:
        readBooleanAt(inputs.r1155, ["summary", "modelEvidencePromotionAllowed"]),
      safeConfirmationFeatureOnlySmokeProofNextAction: readStringAt(inputs.r1155, ["summary", "nextAction"]),
      safeConfirmationFeatureOnlySmokeProofReadyForRecipeReadinessChain:
        readBooleanAt(inputs.r1155, ["summary", "readyForRecipeReadinessChain"]),
      safeConfirmationFeatureOnlySmokeProofRowLevelDataAcceptedByR1155:
        readBooleanAt(inputs.r1155, ["summary", "rowLevelDataAcceptedByR1155"]),
      safeConfirmationFeatureOnlySmokeProofSafeAvailabilityConfirmationConclusion:
        readStringAt(inputs.r1155, ["summary", "safeAvailabilityConfirmationConclusion"]),
      safeConfirmationFeatureOnlySmokeProofSmokeEvidence: readBooleanAt(inputs.r1155, ["summary", "smokeEvidence"]),
      safeConfirmationHandoffConclusion: readStringAt(inputs.r1156, ["summary", "conclusion"]),
      safeConfirmationHandoffFeatureOnlyPathMechanicallyProven:
        readBooleanAt(inputs.r1156, ["summary", "featureOnlyPathMechanicallyProven"]),
      safeConfirmationHandoffHandoffReadyForRowOwner:
        readBooleanAt(inputs.r1156, ["summary", "handoffReadyForRowOwner"]),
      safeConfirmationHandoffModelEvidencePromotionAllowed:
        readBooleanAt(inputs.r1156, ["summary", "modelEvidencePromotionAllowed"]),
      safeConfirmationHandoffNextAction: readStringAt(inputs.r1156, ["summary", "nextAction"]),
      safeConfirmationHandoffReadyForModelEvidence:
        readBooleanAt(inputs.r1156, ["summary", "readyForModelEvidence"]),
      safeConfirmationHandoffReadyForRecipeReadinessChain:
        readBooleanAt(inputs.r1156, ["summary", "readyForRecipeReadinessChain"]),
      safeConfirmationHandoffRequiredFeatureOnlySourceFamilyIds:
        readStringArrayAt(inputs.r1156, ["summary", "requiredFeatureOnlySourceFamilyIds"]),
      safeConfirmationHandoffRequiredSafeCompletionCheckIds:
        readStringArrayAt(inputs.r1156, ["summary", "requiredSafeCompletionCheckIds"]),
      safeConfirmationHandoffRowLevelDataAcceptedByR1156:
        readBooleanAt(inputs.r1156, ["summary", "rowLevelDataAcceptedByR1156"]),
      safeConfirmationHandoffRowOwnerWorkType: readStringAt(inputs.r1156, ["summary", "rowOwnerWorkType"]),
      safeConfirmationHandoffSafeConfirmationStillRequired:
        readBooleanAt(inputs.r1156, ["summary", "safeConfirmationStillRequired"]),
      safeConfirmationHandoffSmokeEvidence: readBooleanAt(inputs.r1156, ["summary", "smokeEvidence"]),
      safeConfirmationChainRunnerConclusion: readStringAt(inputs.r1157, ["summary", "conclusion"]),
      safeConfirmationChainRunnerFeatureOnlyResearchPlanningReady:
        readBooleanAt(inputs.r1157, ["summary", "featureOnlyResearchPlanningReady"]),
      safeConfirmationChainRunnerModelEvidencePromotionAllowed:
        readBooleanAt(inputs.r1157, ["summary", "modelEvidencePromotionAllowed"]),
      safeConfirmationChainRunnerNextAction: readStringAt(inputs.r1157, ["summary", "nextAction"]),
      safeConfirmationChainRunnerReadyForModelEvidence:
        readBooleanAt(inputs.r1157, ["summary", "readyForModelEvidence"]),
      safeConfirmationChainRunnerReadyForRecipeReadinessChain:
        readBooleanAt(inputs.r1157, ["summary", "readyForRecipeReadinessChain"]),
      safeConfirmationChainRunnerRowLevelDataAcceptedByR1157:
        readBooleanAt(inputs.r1157, ["summary", "rowLevelDataAcceptedByR1157"]),
      safeConfirmationChainRunnerSafeConfirmationStillRequired:
        readBooleanAt(inputs.r1157, ["summary", "safeConfirmationStillRequired"]),
      safeConfirmationFillGuideConclusion: readStringAt(inputs.r1158, ["summary", "conclusion"]),
      safeConfirmationFillGuideExactSafeFieldEditCount:
        readNumberAt(inputs.r1158, ["summary", "exactSafeFieldEditCount"]),
      safeConfirmationFillGuideGuideReadyForRowOwnerFill:
        readBooleanAt(inputs.r1158, ["summary", "guideReadyForRowOwnerFill"]),
      safeConfirmationFillGuideNextAction: readStringAt(inputs.r1158, ["summary", "nextAction"]),
      safeConfirmationFillGuideRequiredInputKindIds:
        readStringArrayAt(inputs.r1158, ["summary", "requiredInputKindIds"]),
      safeConfirmationFillGuideRowLevelDataAcceptedByR1158:
        readBooleanAt(inputs.r1158, ["summary", "rowLevelDataAcceptedByR1158"]),
      safeConfirmationAnswerSheetConclusion: readStringAt(inputs.r1159, ["summary", "conclusion"]),
      safeConfirmationAnswerSheetExactSafeAnswerCount:
        readNumberAt(inputs.r1159, ["summary", "exactSafeAnswerCount"]),
      safeConfirmationAnswerSheetReadyForRowOwner:
        readBooleanAt(inputs.r1159, ["summary", "answerSheetReadyForRowOwner"]),
      safeConfirmationAnswerSheetNextAction: readStringAt(inputs.r1159, ["summary", "nextAction"]),
      safeConfirmationAnswerSheetRequiredInputKindIds:
        readStringArrayAt(inputs.r1159, ["summary", "requiredInputKindIds"]),
      safeConfirmationAnswerSheetRowLevelDataAcceptedByR1159:
        readBooleanAt(inputs.r1159, ["summary", "rowLevelDataAcceptedByR1159"]),
      safeConfirmationAnswerSheetRowOwnerProvidedValuesStored:
        readBooleanAt(inputs.r1159, ["summary", "rowOwnerProvidedValuesStored"]),
      safeConfirmationTranscriptionProofConclusion:
        readStringAt(inputs.r1160, ["summary", "conclusion"]),
      safeConfirmationTranscriptionProofConfirmationValuesStoredByR1160:
        readBooleanAt(inputs.r1160, ["summary", "confirmationValuesStoredByR1160"]),
      safeConfirmationTranscriptionProofExactSafeTranscriptionStepCount:
        readNumberAt(inputs.r1160, ["summary", "exactSafeTranscriptionStepCount"]),
      safeConfirmationTranscriptionProofHypotheticalTranscriptionWouldBeFeatureOnlyReady:
        readBooleanAt(inputs.r1160, ["summary", "hypotheticalTranscriptionWouldBeFeatureOnlyReady"]),
      safeConfirmationTranscriptionProofNextAction:
        readStringAt(inputs.r1160, ["summary", "nextAction"]),
      safeConfirmationTranscriptionProofReadyForRowOwnerConfirmation:
        readBooleanAt(inputs.r1160, ["summary", "transcriptionProofReadyForRowOwnerConfirmation"]),
      safeConfirmationTranscriptionProofRequiredInputKindIds:
        readStringArrayAt(inputs.r1160, ["summary", "requiredInputKindIds"]),
      safeConfirmationTranscriptionProofRowLevelDataAcceptedByR1160:
        readBooleanAt(inputs.r1160, ["summary", "rowLevelDataAcceptedByR1160"]),
      safeConfirmationTranscriptionProofRowOwnerConfirmationStillRequired:
        readBooleanAt(inputs.r1160, ["summary", "rowOwnerConfirmationStillRequired"]),
      safeConfirmationTranscriptionProofRowOwnerProvidedValuesStored:
        readBooleanAt(inputs.r1160, ["summary", "rowOwnerProvidedValuesStored"]),
      safeConfirmationMaterializerConclusion:
        readStringAt(inputs.r1161, ["summary", "conclusion"]),
      safeConfirmationMaterializerConfirmationValuesStoredInR1161Packet:
        readBooleanAt(inputs.r1161, ["summary", "confirmationValuesStoredInR1161Packet"]),
      safeConfirmationMaterializerExplicitRowOwnerConfirmationAssertionProvided:
        readBooleanAt(inputs.r1161, ["summary", "explicitRowOwnerConfirmationAssertionProvided"]),
      safeConfirmationMaterializerFeatureOnlyConfirmationWouldBeReadyForR1150:
        readBooleanAt(inputs.r1161, ["summary", "featureOnlyConfirmationWouldBeReadyForR1150"]),
      safeConfirmationMaterializerNextAction:
        readStringAt(inputs.r1161, ["summary", "nextAction"]),
      safeConfirmationMaterializerRowLevelDataAcceptedByR1161:
        readBooleanAt(inputs.r1161, ["summary", "rowLevelDataAcceptedByR1161"]),
      safeConfirmationMaterializerRowOwnerConfirmationStillRequired:
        readBooleanAt(inputs.r1161, ["summary", "rowOwnerConfirmationStillRequired"]),
      safeConfirmationMaterializerRowOwnerPrivateValuesStored:
        readBooleanAt(inputs.r1161, ["summary", "rowOwnerPrivateValuesStored"]),
      safeConfirmationMaterializerSafeConfirmationArtifact:
        readStringAt(inputs.r1161, ["summary", "safeConfirmationArtifact"]),
      safeConfirmationMaterializerSafeConfirmationArtifactWritten:
        readBooleanAt(inputs.r1161, ["summary", "safeConfirmationArtifactWritten"]),
      safeConfirmationMaterializerSafeMaterializedFieldCount:
        readNumberAt(inputs.r1161, ["summary", "safeMaterializedFieldCount"]),
      safeConfirmationAssertionHandoffConclusion:
        readStringAt(inputs.r1162, ["summary", "conclusion"]),
      safeConfirmationAssertionHandoffConfirmationValuesStoredByR1162:
        readBooleanAt(inputs.r1162, ["summary", "confirmationValuesStoredByR1162"]),
      safeConfirmationAssertionHandoffExplicitRowOwnerConfirmationAssertionProvided:
        readBooleanAt(inputs.r1162, ["summary", "explicitRowOwnerConfirmationAssertionProvided"]),
      safeConfirmationAssertionHandoffFeatureOnlyConfirmationWouldBeReadyForR1150:
        readBooleanAt(inputs.r1162, ["summary", "featureOnlyConfirmationWouldBeReadyForR1150"]),
      safeConfirmationAssertionHandoffHandoffReadyForRowOwner:
        readBooleanAt(inputs.r1162, ["summary", "handoffReadyForRowOwner"]),
      safeConfirmationAssertionHandoffMaterializerCommand:
        readStringAt(inputs.r1162, ["summary", "materializerCommand"]),
      safeConfirmationAssertionHandoffMaterializerNextAction:
        readStringAt(inputs.r1162, ["summary", "materializerNextAction"]),
      safeConfirmationAssertionHandoffMinimumFeaturePairRequired:
        readStringArrayAt(inputs.r1162, ["summary", "minimumFeaturePairRequired"]),
      safeConfirmationAssertionHandoffNextAction:
        readStringAt(inputs.r1162, ["summary", "nextAction"]),
      safeConfirmationAssertionHandoffRequiredChecklistIds:
        readStringArrayAt(inputs.r1162, ["summary", "requiredChecklistIds"]),
      safeConfirmationAssertionHandoffRequiredInputKindIds:
        readStringArrayAt(inputs.r1162, ["summary", "requiredInputKindIds"]),
      safeConfirmationAssertionHandoffRowLevelDataAcceptedByR1162:
        readBooleanAt(inputs.r1162, ["summary", "rowLevelDataAcceptedByR1162"]),
      safeConfirmationAssertionHandoffRowOwnerAssertionInferredByR1162:
        readBooleanAt(inputs.r1162, ["summary", "rowOwnerAssertionInferredByR1162"]),
      safeConfirmationAssertionHandoffRowOwnerAssertionStillRequired:
        readBooleanAt(inputs.r1162, ["summary", "rowOwnerAssertionStillRequired"]),
      safeConfirmationAssertionHandoffRowOwnerPrivateValuesStored:
        readBooleanAt(inputs.r1162, ["summary", "rowOwnerPrivateValuesStored"]),
      safeConfirmationAssertionHandoffSafeConfirmationArtifactWritten:
        readBooleanAt(inputs.r1162, ["summary", "safeConfirmationArtifactWritten"]),
      safeConfirmationToResearchRunnerConclusion:
        readStringAt(inputs.r1163, ["summary", "conclusion"]),
      safeConfirmationToResearchRunnerConfirmedSafeConfirmationArtifact:
        readStringAt(inputs.r1163, ["summary", "confirmedSafeConfirmationArtifact"]),
      safeConfirmationToResearchRunnerExplicitRowOwnerAssertionProvided:
        readBooleanAt(inputs.r1163, ["summary", "explicitRowOwnerConfirmationAssertionProvided"]),
      safeConfirmationToResearchRunnerFeatureOnlyChainRan:
        readBooleanAt(inputs.r1163, ["summary", "featureOnlyChainRan"]),
      safeConfirmationToResearchRunnerFeatureOnlyResearchPlanningReady:
        readBooleanAt(inputs.r1163, ["summary", "featureOnlyResearchPlanningReady"]),
      safeConfirmationToResearchRunnerNextAction:
        readStringAt(inputs.r1163, ["summary", "nextAction"]),
      safeConfirmationToResearchRunnerRowLevelDataAcceptedByR1163:
        readBooleanAt(inputs.r1163, ["summary", "rowLevelDataAcceptedByR1163"]),
      safeConfirmationToResearchRunnerRowOwnerAssertionInferredByR1163:
        readBooleanAt(inputs.r1163, ["summary", "rowOwnerAssertionInferredByR1163"]),
      safeConfirmationToResearchRunnerRowOwnerAssertionStillRequired:
        readBooleanAt(inputs.r1163, ["summary", "rowOwnerAssertionStillRequired"]),
      safeConfirmationToResearchRunnerRowOwnerPrivateValuesStored:
        readBooleanAt(inputs.r1163, ["summary", "rowOwnerPrivateValuesStored"]),
      safeConfirmationToResearchRunnerSafeConfirmationArtifactWritten:
        readBooleanAt(inputs.r1163, ["summary", "safeConfirmationArtifactWritten"]),
      featureOnlyResearchHandoffCommand: inputMatchesExpected("r1164", inputs.r1164)
        ? R1164_FEATURE_ONLY_RESEARCH_HANDOFF_COMMAND
        : null,
      featureOnlyResearchHandoffConclusion:
        readStringAt(inputs.r1164, ["summary", "conclusion"]),
      featureOnlyResearchHandoffFeatureOnlyResearchPlanningReady:
        readBooleanAt(inputs.r1164, ["summary", "featureOnlyResearchPlanningReady"]),
      featureOnlyResearchHandoffMinimumFeaturePairRequired:
        readStringArrayAt(inputs.r1164, ["summary", "minimumFeaturePairRequired"]),
      featureOnlyResearchHandoffNextAction:
        readStringAt(inputs.r1164, ["summary", "nextAction"]),
      featureOnlyResearchHandoffOutcomeLinkedModelEvidenceStillRequired:
        readBooleanAt(inputs.r1164, ["summary", "outcomeLinkedModelEvidenceStillRequired"]),
      featureOnlyResearchHandoffPrioritizedInputKindIds:
        readStringArrayAt(inputs.r1164, ["summary", "prioritizedInputKindIds"]),
      featureOnlyResearchHandoffResearchPlanningAllowed:
        readBooleanAt(inputs.r1164, ["summary", "researchPlanningAllowed"]),
      featureOnlyResearchHandoffRowLevelDataAcceptedByR1164:
        readBooleanAt(inputs.r1164, ["summary", "rowLevelDataAcceptedByR1164"]),
      featureOnlyResearchHandoffRowOwnerPrivateValuesStored:
        readBooleanAt(inputs.r1164, ["summary", "rowOwnerPrivateValuesStored"]),
      featureOnlySafeAssertionRunnerCommand: featureOnlySafeAssertionRunnerPresent(inputs.r1165)
        ? R1165_SAFE_ASSERTION_RUNNER_COMMAND
        : null,
      featureOnlySafeAssertionRunnerConclusion:
        readStringAt(inputs.r1165, ["summary", "conclusion"]),
      featureOnlySafeAssertionRunnerNextAction:
        readStringAt(inputs.r1165, ["summary", "nextAction"]),
      featureOnlySafeAssertionRunnerAssertionAccepted:
        readBooleanAt(inputs.r1165, ["summary", "assertionAccepted"]),
      featureOnlySafeAssertionRunnerAssertionProvided:
        readBooleanAt(inputs.r1165, ["summary", "assertionProvided"]),
      featureOnlySafeAssertionRunnerAssertionTemplateArtifact:
        readStringAt(inputs.r1165, ["summary", "assertionTemplateArtifact"]),
      featureOnlySafeAssertionRunnerChildR1163Ran:
        readBooleanAt(inputs.r1165, ["summary", "childR1163Ran"]),
      featureOnlySafeAssertionRunnerFeatureOnlyResearchPlanningReady:
        readBooleanAt(inputs.r1165, ["summary", "featureOnlyResearchPlanningReady"]),
      featureOnlySafeAssertionRunnerRequiredInputKindIds:
        readStringArrayAt(inputs.r1165, ["summary", "requiredInputKindIds"]),
      featureOnlySafeAssertionRunnerRequiredAssertionChecklistIds:
        readStringArrayAt(inputs.r1165, ["summary", "requiredAssertionChecklistIds"]),
      featureOnlySafeAssertionRunnerOptionalAddOnFamilyIds:
        readStringArrayAt(inputs.r1165, ["summary", "optionalAddOnFamilyIds"]),
      featureOnlySafeAssertionRunnerValidationReasonIds:
        readStringArrayAt(inputs.r1165, ["summary", "validationReasonIds"]),
      featureOnlySafeAssertionRunnerRowLevelDataAcceptedByR1165:
        readBooleanAt(inputs.r1165, ["summary", "rowLevelDataAcceptedByR1165"]),
      featureOnlySafeAssertionRunnerRowOwnerPrivateValuesStored:
        readBooleanAt(inputs.r1165, ["summary", "rowOwnerPrivateValuesStored"]),
      featureOnlySafeAssertionFillGuideCommand: inputMatchesExpected("r1167", inputs.r1167)
        ? R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND
        : null,
      featureOnlySafeAssertionFillGuideConclusion:
        readStringAt(inputs.r1167, ["summary", "conclusion"]),
      featureOnlySafeAssertionFillGuideNextAction:
        readStringAt(inputs.r1167, ["summary", "nextAction"]),
      featureOnlySafeAssertionFillGuideGuideReadyForRowOwnerFill:
        readBooleanAt(inputs.r1167, ["summary", "guideReadyForRowOwnerFill"]),
      featureOnlySafeAssertionFillGuideRequiredInputKindIds:
        readStringArrayAt(inputs.r1167, ["summary", "requiredInputKindIds"]),
      featureOnlySafeAssertionFillGuideOptionalAddOnFamilyIds:
        readStringArrayAt(inputs.r1167, ["summary", "optionalAddOnFamilyIds"]),
      featureOnlySafeAssertionFillGuideSafeFieldEditCount:
        readNumberAt(inputs.r1167, ["summary", "safeFieldEditCount"]),
      featureOnlySafeAssertionFillGuideSafeFieldEditPaths:
        readStringArrayAt(inputs.r1167, ["summary", "safeFieldEditPaths"]),
      featureOnlySafeAssertionFillGuideRowLevelDataAcceptedByR1167:
        readBooleanAt(inputs.r1167, ["summary", "rowLevelDataAcceptedByR1167"]),
      featureOnlySafeAssertionFillGuideRowOwnerPrivateValuesStored:
        readBooleanAt(inputs.r1167, ["summary", "rowOwnerPrivateValuesStored"]),
      featureOnlySafeAssertionAnswerSheetCommand: inputMatchesExpected("r1173", inputs.r1173)
        ? R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND
        : null,
      featureOnlySafeAssertionAnswerSheetConclusion:
        readStringAt(inputs.r1173, ["summary", "conclusion"]),
      featureOnlySafeAssertionAnswerSheetNextAction:
        readStringAt(inputs.r1173, ["summary", "nextAction"]),
      featureOnlySafeAssertionAnswerSheetReadyForRowOwner:
        readBooleanAt(inputs.r1173, ["summary", "answerSheetReadyForRowOwner"]),
      featureOnlySafeAssertionAnswerSheetMaterializerReady:
        readBooleanAt(inputs.r1173, ["summary", "materializerReady"]),
      featureOnlySafeAssertionAnswerSheetMaterializerExplicitConfirmationRequired:
        readBooleanAt(inputs.r1173, ["summary", "materializerExplicitConfirmationRequired"]),
      featureOnlySafeAssertionAnswerSheetExactSafeAnswerCount:
        readNumberAt(inputs.r1173, ["summary", "exactSafeAnswerCount"]),
      featureOnlySafeAssertionAnswerSheetAllowedValueKindIds:
        readStringArrayAt(inputs.r1173, ["summary", "allowedValueKindIds"]),
      featureOnlySafeAssertionAnswerSheetBlockedAssertionContentIds:
        readStringArrayAt(inputs.r1173, ["summary", "blockedAssertionContentIds"]),
      featureOnlySafeAssertionAnswerSheetRequiredInputKindIds:
        readStringArrayAt(inputs.r1173, ["summary", "requiredInputKindIds"]),
      featureOnlySafeAssertionAnswerSheetRequiredAssertionChecklistIds:
        readStringArrayAt(inputs.r1173, ["summary", "requiredAssertionChecklistIds"]),
      featureOnlySafeAssertionAnswerSheetSafeFieldEditPaths:
        readStringArrayAt(inputs.r1173, ["summary", "safeFieldEditPaths"]),
      featureOnlySafeAssertionAnswerSheetRowLevelDataAcceptedByR1173:
        readBooleanAt(inputs.r1173, ["summary", "rowLevelDataAcceptedByR1173"]),
      featureOnlySafeAssertionAnswerSheetRowOwnerProvidedValuesStored:
        readBooleanAt(inputs.r1173, ["summary", "rowOwnerProvidedValuesStored"]),
      featureOnlySafeAssertionMaterializerCommand: inputMatchesExpected("r1172", inputs.r1172)
        ? R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND
        : null,
      featureOnlySafeAssertionMaterializerConclusion:
        readStringAt(inputs.r1172, ["summary", "conclusion"]),
      featureOnlySafeAssertionMaterializerNextAction:
        readStringAt(inputs.r1172, ["summary", "nextAction"]),
      featureOnlySafeAssertionMaterializerExplicitRowOwnerAssertionProvided:
        readBooleanAt(inputs.r1172, ["summary", "explicitRowOwnerAssertionProvided"]),
      featureOnlySafeAssertionMaterializerArtifactWritten:
        readBooleanAt(inputs.r1172, ["summary", "safeAssertionArtifactWritten"]),
      featureOnlySafeAssertionMaterializerRowOwnerAssertionStillRequired:
        readBooleanAt(inputs.r1172, ["summary", "rowOwnerAssertionStillRequired"]),
      featureOnlySafeAssertionMaterializerWouldBeAcceptedByR1165:
        readBooleanAt(inputs.r1172, ["summary", "materializedAssertionWouldBeAcceptedByR1165"]),
      featureOnlySafeAssertionMaterializerR1165RunnerReady:
        readBooleanAt(inputs.r1172, ["summary", "r1165RunnerReadyForAssertion"]),
      featureOnlySafeAssertionMaterializerR1165TemplateReady:
        readBooleanAt(inputs.r1172, ["summary", "r1165TemplateReady"]),
      featureOnlySafeAssertionMaterializerR1167FillGuideReady:
        readBooleanAt(inputs.r1172, ["summary", "r1167FillGuideReady"]),
      featureOnlySafeAssertionMaterializerAllowedValueKindIds:
        readStringArrayAt(inputs.r1172, ["summary", "allowedValueKindIds"]),
      featureOnlySafeAssertionMaterializerBlockedContentIds:
        readStringArrayAt(inputs.r1172, ["summary", "blockedContentIds"]),
      featureOnlySafeAssertionMaterializerSafeFieldEditCount:
        readNumberAt(inputs.r1172, ["summary", "safeFieldEditCount"]),
      featureOnlySafeAssertionMaterializerSafeFieldEditPaths:
        readStringArrayAt(inputs.r1172, ["summary", "safeFieldEditPaths"]),
      featureOnlySafeAssertionMaterializerRowLevelDataAcceptedByR1172:
        readBooleanAt(inputs.r1172, ["summary", "rowLevelDataAcceptedByR1172"]),
      featureOnlySafeAssertionMaterializerRowOwnerPrivateValuesStored:
        readBooleanAt(inputs.r1172, ["summary", "rowOwnerPrivateValuesStored"]),
      featureOnlySafeAssertionSmokeProofCommand: inputMatchesExpected("r1170", inputs.r1170)
        ? R1170_SAFE_ASSERTION_SMOKE_PROOF_COMMAND
        : null,
      featureOnlySafeAssertionSmokeProofConclusion:
        readStringAt(inputs.r1170, ["summary", "conclusion"]),
      featureOnlySafeAssertionSmokeProofNextAction:
        readStringAt(inputs.r1170, ["summary", "nextAction"]),
      featureOnlySafeAssertionSmokeProofPassed:
        readBooleanAt(inputs.r1170, ["summary", "smokeProofPassed"]),
      featureOnlySafeAssertionSmokeProofSynthetic:
        readBooleanAt(inputs.r1170, ["summary", "syntheticSmokeProof"]),
      featureOnlySafeAssertionSmokeProofRealEvidenceProduced:
        readBooleanAt(inputs.r1170, ["summary", "realEvidenceProduced"]),
      featureOnlySafeAssertionSmokeProofModelEvidencePromotionAllowed:
        readBooleanAt(inputs.r1170, ["summary", "modelEvidencePromotionAllowed"]),
      featureOnlySafeAssertionSmokeProofLiveChainGateStillRequired:
        readBooleanAt(inputs.r1170, ["summary", "liveChainGateStillRequired"]),
      featureOnlySafeAssertionSmokeProofR1165AssertionAccepted:
        readBooleanAt(inputs.r1170, ["summary", "r1165AssertionAccepted"]),
      featureOnlySafeAssertionSmokeProofR1165ChildR1163Ran:
        readBooleanAt(inputs.r1170, ["summary", "r1165ChildR1163Ran"]),
      featureOnlySafeAssertionSmokeProofR1165FeatureOnlyResearchPlanningReady:
        readBooleanAt(inputs.r1170, ["summary", "r1165FeatureOnlyResearchPlanningReady"]),
      featureOnlySafeAssertionSmokeProofSafeFieldEditCount:
        readNumberAt(inputs.r1170, ["summary", "safeFieldEditCount"]),
      featureOnlySafeAssertionSmokeProofSafeFieldEditPaths:
        readStringArrayAt(inputs.r1170, ["summary", "safeFieldEditPaths"]),
      featureOnlySafeAssertionSmokeProofRowLevelDataAcceptedByR1170:
        readBooleanAt(inputs.r1170, ["summary", "rowLevelDataAcceptedByR1170"]),
      featureOnlySafeAssertionSmokeProofRowOwnerPrivateValuesStored:
        readBooleanAt(inputs.r1170, ["summary", "rowOwnerPrivateValuesStored"]),
      featureOnlySafeAssertionBridgeSmokeCommand: featureOnlySafeAssertionBridgeSmokePresent(inputs.r1175)
        ? R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_COMMAND
        : null,
      featureOnlySafeAssertionBridgeSmokeAllowedValueKindIds:
        readStringArrayAt(inputs.r1175, ["summary", "allowedValueKindIds"]),
      featureOnlySafeAssertionBridgeSmokeBlockedContentIds:
        readStringArrayAt(inputs.r1175, ["summary", "blockedContentIds"]),
      featureOnlySafeAssertionBridgeSmokeOptionalAddOnFamilyIds:
        readStringArrayAt(inputs.r1175, ["summary", "optionalAddOnFamilyIds"]),
      featureOnlySafeAssertionBridgeSmokeConclusion:
        readStringAt(inputs.r1175, ["summary", "conclusion"]),
      featureOnlySafeAssertionBridgeSmokeNextAction:
        readStringAt(inputs.r1175, ["summary", "nextAction"]),
      featureOnlySafeAssertionBridgeSmokePassed:
        readBooleanAt(inputs.r1175, ["summary", "bridgeSmokePassed"]),
      featureOnlySafeAssertionBridgeSmokeSynthetic:
        readBooleanAt(inputs.r1175, ["summary", "syntheticSmokeProof"]),
      featureOnlySafeAssertionBridgeSmokeRealEvidenceProduced:
        readBooleanAt(inputs.r1175, ["summary", "realEvidenceProduced"]),
      featureOnlySafeAssertionBridgeSmokeModelEvidencePromotionAllowed:
        readBooleanAt(inputs.r1175, ["summary", "modelEvidencePromotionAllowed"]),
      featureOnlySafeAssertionBridgeSmokeLiveChainGateStillRequired:
        readBooleanAt(inputs.r1175, ["summary", "liveChainGateStillRequired"]),
      featureOnlySafeAssertionBridgeSmokeR1172MaterializedAssertionWritten:
        readBooleanAt(inputs.r1175, ["summary", "r1172MaterializedAssertionWritten"]),
      featureOnlySafeAssertionBridgeSmokeR1172WouldBeAcceptedByR1165:
        readBooleanAt(inputs.r1175, ["summary", "r1172WouldBeAcceptedByR1165"]),
      featureOnlySafeAssertionBridgeSmokeR1165AssertionAccepted:
        readBooleanAt(inputs.r1175, ["summary", "r1165AssertionAccepted"]),
      featureOnlySafeAssertionBridgeSmokeR1165ChildR1163Ran:
        readBooleanAt(inputs.r1175, ["summary", "r1165ChildR1163Ran"]),
      featureOnlySafeAssertionBridgeSmokeR1165FeatureOnlyResearchPlanningReady:
        readBooleanAt(inputs.r1175, ["summary", "r1165FeatureOnlyResearchPlanningReady"]),
      featureOnlySafeAssertionBridgeSmokeR1163FeatureOnlyResearchPlanningReady:
        readBooleanAt(inputs.r1175, ["summary", "r1163FeatureOnlyResearchPlanningReady"]),
      featureOnlySafeAssertionBridgeSmokeSafeFieldEditCount:
        readNumberAt(inputs.r1175, ["summary", "safeFieldEditCount"]),
      featureOnlySafeAssertionBridgeSmokeSafeFieldEditPaths:
        readStringArrayAt(inputs.r1175, ["summary", "safeFieldEditPaths"]),
      featureOnlySafeAssertionBridgeSmokeRowLevelDataAcceptedByR1175:
        readBooleanAt(inputs.r1175, ["summary", "rowLevelDataAcceptedByR1175"]),
      featureOnlySafeAssertionBridgeSmokeRowOwnerPrivateValuesStored:
        readBooleanAt(inputs.r1175, ["summary", "rowOwnerPrivateValuesStored"]),
      featureOnlySafeAssertionBridgeSmokeRowParsingPerformedByR1175:
        readBooleanAt(inputs.r1175, ["summary", "rowParsingPerformedByR1175"]),
      featureOnlySafeNextStepPacketCommand: featureOnlySafeNextStepPacketPresent(inputs.r1174)
        ? R1174_SAFE_NEXT_STEP_PACKET_COMMAND
        : null,
      featureOnlySafeNextStepPacketAllowedValueKindIds:
        readStringArrayAt(inputs.r1174, ["summary", "allowedValueKindIds"]),
      featureOnlySafeNextStepPacketBlockedContentIds:
        readStringArrayAt(inputs.r1174, ["summary", "blockedContentIds"]),
      featureOnlySafeNextStepPacketConclusion:
        readStringAt(inputs.r1174, ["summary", "conclusion"]),
      featureOnlySafeNextStepPacketNextAction:
        readStringAt(inputs.r1174, ["summary", "nextAction"]),
      featureOnlySafeNextStepPacketReadyForR1165Runner:
        readBooleanAt(inputs.r1174, ["summary", "readyForR1165Runner"]),
      featureOnlySafeNextStepPacketReadyForRowOwnerR1172Confirmation:
        readBooleanAt(inputs.r1174, ["summary", "readyForRowOwnerR1172Confirmation"]),
      featureOnlySafeNextStepPacketReadyForRowOwnerR1176LiveChainConfirmation:
        readBooleanAt(inputs.r1174, ["summary", "readyForRowOwnerR1176LiveChainConfirmation"]),
      featureOnlySafeNextStepPacketR1176LiveChainCommand:
        readStringAt(inputs.r1174, ["summary", "r1176LiveChainCommand"]),
      featureOnlySafeNextStepPacketSafeFieldEditCount:
        readNumberAt(inputs.r1174, ["summary", "exactSafeFieldEditCount"]),
      featureOnlySafeNextStepPacketSafeFieldEditPaths:
        readStringArrayAt(inputs.r1174, ["summary", "safeFieldEditPaths"]),
      featureOnlySafeNextStepPacketRowLevelDataAcceptedByR1174:
        readBooleanAt(inputs.r1174, ["summary", "rowLevelDataAcceptedByR1174"]),
      featureOnlySafeNextStepPacketRowOwnerPrivateValuesStored:
        readBooleanAt(inputs.r1174, ["summary", "rowOwnerPrivateValuesStored"]),
      featureOnlySafeNextStepPacketRowOwnerProvidedValuesStored:
        readBooleanAt(inputs.r1174, ["summary", "rowOwnerProvidedValuesStored"]),
      featureOnlySafeAssertionLiveChainCommand: featureOnlySafeAssertionLiveChainPresent(inputs.r1176)
        ? R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND
        : null,
      featureOnlySafeAssertionLiveChainAllowedValueKindIds:
        readStringArrayAt(inputs.r1176, ["summary", "allowedValueKindIds"]),
      featureOnlySafeAssertionLiveChainBlockedContentIds:
        readStringArrayAt(inputs.r1176, ["summary", "blockedContentIds"]),
      featureOnlySafeAssertionLiveChainOptionalAddOnFamilyIds:
        readStringArrayAt(inputs.r1176, ["summary", "optionalAddOnFamilyIds"]),
      featureOnlySafeAssertionLiveChainCompletionModeId:
        readStringAt(inputs.r1176, ["summary", "ordinarySubmitterCompletionModeId"]),
      featureOnlySafeAssertionLiveChainConclusion:
        readStringAt(inputs.r1176, ["summary", "conclusion"]),
      featureOnlySafeAssertionLiveChainNextAction:
        readStringAt(inputs.r1176, ["summary", "nextAction"]),
      featureOnlySafeAssertionLiveChainReady:
        readBooleanAt(inputs.r1176, ["summary", "chainReady"]),
      featureOnlySafeAssertionLiveChainExplicitRowOwnerAssertionProvided:
        readBooleanAt(inputs.r1176, ["summary", "explicitRowOwnerAssertionProvided"]),
      featureOnlySafeAssertionLiveChainFeatureOnlyResearchPlanningReady:
        readBooleanAt(inputs.r1176, ["summary", "featureOnlyResearchPlanningReady"]),
      featureOnlySafeAssertionLiveChainRealEvidenceProduced:
        readBooleanAt(inputs.r1176, ["summary", "realEvidenceProduced"]),
      featureOnlySafeAssertionLiveChainModelEvidencePromotionAllowed:
        readBooleanAt(inputs.r1176, ["summary", "modelEvidencePromotionAllowed"]),
      featureOnlySafeAssertionLiveChainOutcomeLinkedModelEvidenceStillRequired:
        readBooleanAt(inputs.r1176, ["summary", "outcomeLinkedModelEvidenceStillRequired"]),
      featureOnlySafeAssertionLiveChainRowOwnerAssertionStillRequired:
        readBooleanAt(inputs.r1176, ["summary", "rowOwnerAssertionStillRequiredForLiveChain"]),
      featureOnlySafeAssertionLiveChainRowOwnerHandoffReasonId:
        readStringAt(inputs.r1176, ["summary", "rowOwnerHandoffReasonId"]),
      featureOnlySafeAssertionLiveChainR1172MaterializedAssertionWritten:
        readBooleanAt(inputs.r1176, ["summary", "r1172MaterializedAssertionWritten"]),
      featureOnlySafeAssertionLiveChainR1172WouldBeAcceptedByR1165:
        readBooleanAt(inputs.r1176, ["summary", "r1172WouldBeAcceptedByR1165"]),
      featureOnlySafeAssertionLiveChainR1165AssertionAccepted:
        readBooleanAt(inputs.r1176, ["summary", "r1165AssertionAccepted"]),
      featureOnlySafeAssertionLiveChainR1165ChildR1163Ran:
        readBooleanAt(inputs.r1176, ["summary", "r1165ChildR1163Ran"]),
      featureOnlySafeAssertionLiveChainR1165FeatureOnlyResearchPlanningReady:
        readBooleanAt(inputs.r1176, ["summary", "r1165FeatureOnlyResearchPlanningReady"]),
      featureOnlySafeAssertionLiveChainR1163FeatureOnlyResearchPlanningReady:
        readBooleanAt(inputs.r1176, ["summary", "r1163FeatureOnlyResearchPlanningReady"]),
      featureOnlySafeAssertionLiveChainSafeFieldEditCount:
        readNumberAt(inputs.r1176, ["summary", "safeFieldEditCount"]),
      featureOnlySafeAssertionLiveChainSafeFieldEditPaths:
        readStringArrayAt(inputs.r1176, ["summary", "safeFieldEditPaths"]),
      featureOnlySafeAssertionLiveChainSafeCompletionChecklistItemIds:
        readStringArrayAt(inputs.r1176, ["summary", "ordinarySubmitterSafeCompletionChecklistItemIds"]),
      featureOnlySafeAssertionLiveChainRowLevelDataAcceptedByR1176:
        readBooleanAt(inputs.r1176, ["summary", "rowLevelDataAcceptedByR1176"]),
      featureOnlySafeAssertionLiveChainRowOwnerPrivateValuesStored:
        readBooleanAt(inputs.r1176, ["summary", "rowOwnerPrivateValuesStored"]),
      featureOnlySafeAssertionLiveChainRowParsingPerformedByR1176:
        readBooleanAt(inputs.r1176, ["summary", "rowParsingPerformedByR1176"]),
      safeResponseSmokeProofCommand: safeResponseSmokeProofPresent(inputs.r1185)
        ? R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_COMMAND
        : null,
      safeResponseSmokeProofConclusion:
        readStringAt(inputs.r1185, ["summary", "conclusion"]),
      safeResponseSmokeProofLiveR1184Conclusion:
        readStringAt(inputs.r1185, ["summary", "liveR1184Conclusion"]),
      safeResponseSmokeProofLiveR1184ReadyForSyntheticSmoke:
        readBooleanAt(inputs.r1185, ["summary", "liveR1184ReadyForSyntheticSmoke"]),
      safeResponseSmokeProofNextRealAction:
        readStringAt(inputs.r1185, ["summary", "nextRealAction"]),
      safeResponseSmokeProofNextRealActionCommand:
        readStringAt(inputs.r1185, ["summary", "nextRealActionCommand"]),
      safeResponseSmokeProofNextRealActionRequiresExplicitRowOwnerAssertion:
        readBooleanAt(inputs.r1185, ["summary", "nextRealActionRequiresExplicitRowOwnerAssertion"]),
      safeResponseSmokeProofMinimumFeaturePairRequired:
        readStringArrayAt(inputs.r1185, ["smokeProof", "minimumFeaturePairRequired"]),
      safeResponseSmokeProofPrioritizedInputKindIds:
        readStringArrayAt(inputs.r1185, ["smokeProof", "prioritizedInputKindIds"]),
      safeResponseSmokeProofRequiredResponseFieldIds:
        readStringArrayAt(inputs.r1185, ["smokeProof", "requiredResponseFieldIds"]),
      safeResponseSmokeProofSafeExecutionFeatureSlotIds:
        readStringArrayAt(inputs.r1185, ["smokeProof", "safeExecutionFeatureSlotIds"]),
      safeResponseSmokeProofSyntheticPathAdvancedToFeatureOnlyResearchPlanning:
        readBooleanAt(inputs.r1185, ["summary", "syntheticPathAdvancedToFeatureOnlyResearchPlanning"]),
      safeResponseSmokeProofSyntheticSmokeRan:
        readBooleanAt(inputs.r1185, ["summary", "syntheticSmokeRan"]),
      safeResponseSmokeProofModelEvidencePromotionAllowed:
        readBooleanAt(inputs.r1185, ["smokeProof", "modelEvidencePromotionAllowed"]),
      safeResponseSmokeProofProductDisplayAuthorized:
        readBooleanAt(inputs.r1185, ["smokeProof", "productDisplayAuthorized"]),
      safeResponseSmokeProofRowLevelDataAcceptedByR1185:
        readBooleanAt(inputs.r1185, ["smokeProof", "rowLevelDataAcceptedByR1185"]),
      safeResponseSmokeProofRowOwnerConfirmationInferredByR1185:
        readBooleanAt(inputs.r1185, ["smokeProof", "rowOwnerConfirmationInferredByR1185"]),
      safeResponseSmokeProofRowOwnerPrivateValuesStored:
        readBooleanAt(inputs.r1185, ["smokeProof", "rowOwnerPrivateValuesStored"]),
      safeResponseSmokeProofRowParsingPerformedByR1185:
        readBooleanAt(inputs.r1185, ["smokeProof", "rowParsingPerformedByR1185"]),
      safeResponseSmokeProofLiveArtifactsMutatedByR1185:
        readBooleanAt(inputs.r1185, ["smokeProof", "liveArtifactsMutatedByR1185"]),
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
      topMissingRequirement: missingRequirementIds[0] ?? null,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1145 current-chain completion audit failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function checklistFor(input: {
  inputs: Record<InputKey, unknown | null>;
  requiredInputsReady: boolean;
}): AuditChecklistItem[] {
  if (!input.requiredInputsReady) return baseChecklist("weakly_verified");
  return [
    {
      evidenceArtifacts: [INPUTS.r1076.artifact, INPUTS.r1135.artifact],
      requirementId: "active_loop_prioritizes_ordinary_labs_wearables",
      status: ordinaryPriorityVisible(input.inputs) ? "satisfied" : "missing",
      why: "The active chain must keep wearable data and bloodwork/labs from ordinary roughly 16-50 submitters as the first model input surface.",
    },
    {
      evidenceArtifacts: [INPUTS.r1135.artifact],
      requirementId: "route_recipes_cover_lab_and_wearable_submitter_inputs",
      status: routeRecipesCoverPrimaryInputs(input.inputs.r1135) ? "satisfied" : "missing",
      why: "R1135 must expose lab-plus-wearable, lab-only, wearable-only, and full first-pass route recipes with required outcome and join/time linkage.",
    },
    {
      evidenceArtifacts: [INPUTS.r1149.artifact],
      requirementId: "ordinary_lab_wearable_submitter_kit_available",
      status: ordinarySubmitterKitAvailable(input.inputs.r1149) ? "satisfied" : "missing",
      why: "R1149 must compile the ordinary row-owner lab-plus-wearable submission kit with required safe source-family confirmations, route ids, private slot families, and local commands.",
    },
    {
      evidenceArtifacts: [INPUTS.r1149.artifact],
      requirementId: "ordinary_submitter_kit_feature_only_guard_present",
      status: ordinarySubmitterKitFeatureOnlyGuardPresent(input.inputs.r1149) ? "satisfied" : "missing",
      why: "The R1149 submitter kit must carry the feature-only non-model-evidence guard so stale kits cannot hide unsupported lab/wearable evidence promotion.",
    },
    {
      evidenceArtifacts: [INPUTS.r1151.artifact],
      requirementId: "feature_only_submission_model_evidence_guard_present",
      status: featureOnlyModelEvidenceGuardPresent(input.inputs.r1151) ? "satisfied" : "missing",
      why: "R1151 must prove ordinary lab/wearable submissions without outcome linkage can only become feature coverage context, not model evidence or product display.",
    },
    {
      evidenceArtifacts: [INPUTS.r1152.artifact],
      requirementId: "feature_only_coverage_context_intake_guard_present",
      status: featureOnlyCoverageContextIntakeGuardPresent(input.inputs.r1152) ? "satisfied" : "missing",
      why: "R1152 must validate any filled feature-only lab/wearable coverage context as research-only and keep model evidence, outcome linkage, row-level data, product display, and ReviewGPT gates closed.",
    },
    {
      evidenceArtifacts: [INPUTS.r1153.artifact],
      requirementId: "feature_only_chain_runner_guard_present",
      status: featureOnlyChainRunnerGuardPresent(input.inputs.r1153) ? "satisfied" : "missing",
      why: "R1153 must compose the feature-only lab/wearable chain in one aggregate-only command while keeping model evidence, outcome linkage, row-level data, product display, and ReviewGPT gates closed.",
    },
    {
      evidenceArtifacts: [INPUTS.r1155.artifact],
      requirementId: "safe_confirmation_feature_only_smoke_proof_present",
      status: safeConfirmationFeatureOnlySmokeProofPresent(input.inputs.r1155) ? "satisfied" : "missing",
      why: "R1155 must prove the compact lab-plus-wearable safe confirmation can drive the R1150 through R1153 feature-only path without creating model evidence.",
    },
    {
      evidenceArtifacts: [INPUTS.r1156.artifact],
      requirementId: "safe_confirmation_handoff_packet_present",
      status: safeConfirmationHandoffPresent(input.inputs.r1156) ? "satisfied" : "missing",
      why: "R1156 must expose the compact pathless row-owner handoff for ordinary lab-plus-wearable safe confirmation without treating the smoke proof as evidence.",
    },
    {
      evidenceArtifacts: [INPUTS.r1157.artifact],
      requirementId: "safe_confirmation_chain_runner_present",
      status: safeConfirmationChainRunnerPresent(input.inputs.r1157) ? "satisfied" : "missing",
      why: "R1157 must run the ordinary lab-plus-wearable safe confirmation chain as one aggregate-only command while keeping row-level data, private values, model evidence promotion, and product display closed.",
    },
    {
      evidenceArtifacts: [INPUTS.r1158.artifact],
      requirementId: "safe_confirmation_fill_guide_present",
      status: safeConfirmationFillGuidePresent(input.inputs.r1158) ? "satisfied" : "missing",
      why: "R1158 must expose the pathless average submitter fill guide for the minimum bloodwork/lab plus wearable input pair without accepting row-level data or promoting model evidence.",
    },
    {
      evidenceArtifacts: [INPUTS.r1159.artifact],
      requirementId: "safe_confirmation_answer_sheet_present",
      status: safeConfirmationAnswerSheetPresent(input.inputs.r1159) ? "satisfied" : "missing",
      why: "R1159 must expose the pathless average submitter answer sheet for the minimum bloodwork/lab plus wearable input pair without accepting row-owner-provided values, row-level data, or promoting model evidence.",
    },
    {
      evidenceArtifacts: [INPUTS.r1160.artifact],
      requirementId: "safe_confirmation_transcription_proof_present",
      status: safeConfirmationTranscriptionProofPresent(input.inputs.r1160) ? "satisfied" : "missing",
      why: "R1160 must prove the R1159 answer sheet can transcribe into the R1150 feature-only safe availability confirmation without storing confirmation values or replacing row-owner confirmation.",
    },
    {
      evidenceArtifacts: [INPUTS.r1161.artifact],
      requirementId: "safe_confirmation_materializer_present",
      status: safeConfirmationMaterializerPresent(input.inputs.r1161) ? "satisfied" : "missing",
      why: "R1161 must expose the explicit row-owner assertion gate that can materialize the feature-only R1150 safe availability confirmation without storing private values in the audit packet.",
    },
    {
      evidenceArtifacts: [INPUTS.r1162.artifact],
      requirementId: "safe_confirmation_assertion_handoff_present",
      status: safeConfirmationAssertionHandoffPresent(input.inputs.r1162) ? "satisfied" : "missing",
      why: "R1162 must make the R1161 row-owner assertion step actionable for ordinary lab portal/spreadsheet plus phone/watch/wearable submitters without storing private details.",
    },
    {
      evidenceArtifacts: [INPUTS.r1167.artifact],
      requirementId: "feature_only_safe_assertion_fill_guide_present",
      status: !featureOnlySafeAssertionRunnerPresent(input.inputs.r1165)
        || featureOnlySafeAssertionFillGuidePresent(input.inputs.r1167)
        ? "satisfied"
        : "missing",
      why: "R1167 must expose the pathless R1165 safe assertion fill guide for average lab portal/spreadsheet plus phone/watch/wearable submitters without accepting row-level data or promoting model evidence.",
    },
    {
      evidenceArtifacts: [INPUTS.r1173.artifact],
      requirementId: "feature_only_safe_assertion_answer_sheet_present",
      status: !featureOnlySafeAssertionFillGuidePresent(input.inputs.r1167)
        || featureOnlySafeAssertionAnswerSheetPresent(input.inputs.r1173)
        ? "satisfied"
        : "missing",
      why: "R1173 must expose the pathless row-owner answer sheet for the R1165 safe assertion so ordinary lab portal/spreadsheet plus phone/watch/wearable submitters can review exact safe confirmations before R1172 materializes anything.",
    },
    {
      evidenceArtifacts: [INPUTS.r1172.artifact],
      requirementId: "feature_only_safe_assertion_materializer_present",
      status: !featureOnlySafeAssertionFillGuidePresent(input.inputs.r1167)
        || featureOnlySafeAssertionMaterializerPresent(input.inputs.r1172)
        ? "satisfied"
        : "missing",
      why: "R1172 must provide the explicit row-owner confirmation materializer for the R1165 safe assertion without writing assertion values unless the row owner confirms and without accepting row-level data or promoting model evidence.",
    },
    {
      evidenceArtifacts: [INPUTS.r1175.artifact],
      requirementId: "feature_only_safe_assertion_bridge_smoke_present",
      status: !featureOnlySafeAssertionMaterializerPresent(input.inputs.r1172)
        || featureOnlySafeAssertionBridgeSmokePresent(input.inputs.r1175)
        ? "satisfied"
        : "missing",
      why: "R1175 must prove the R1172 materialized safe assertion can feed the R1165 runner in a scratch-only non-evidence rehearsal while keeping the live row-owner confirmation gate required.",
    },
    {
      evidenceArtifacts: [INPUTS.r1176.artifact],
      requirementId: "feature_only_safe_assertion_live_chain_present",
      status: !featureOnlySafeAssertionBridgeSmokePresent(input.inputs.r1175)
        || featureOnlySafeAssertionLiveChainPresent(input.inputs.r1176)
        ? "satisfied"
        : "missing",
      why: "R1176 must expose the row-owner-gated live R1172-to-R1165 chain for ordinary lab portal/spreadsheet plus phone/watch/wearable submitters while default runs avoid child mutation, row parsing, private values, and model evidence.",
    },
    {
      evidenceArtifacts: [INPUTS.r1154.artifact],
      requirementId: "safe_availability_action_packet_guard_present",
      status: safeAvailabilityActionPacketGuardPresent(input.inputs.r1154) ? "satisfied" : "missing",
      why: "R1154 must turn the row-owner safe availability state into a pathless lab portal/spreadsheet plus phone/watch/wearable action packet before the audit can pass.",
    },
    {
      evidenceArtifacts: [INPUTS.r1076.artifact, INPUTS.r1154.artifact],
      requirementId: "ordinary_submitter_safe_completion_checklist_present",
      status: ordinarySubmitterSafeCompletionChecklistPresent(input.inputs) ? "satisfied" : "missing",
      why: "The current loop and R1154 action packet must expose the ordinary submitter safe-completion checklist for target age band, glycemia bloodwork export, phone/watch activity export, no-private-values confirmation, optional outcome/time alignment, and coarse count bands.",
    },
    {
      evidenceArtifacts: [INPUTS.r1076.artifact, INPUTS.r1154.artifact],
      requirementId: "ordinary_submitter_safe_completion_modes_present",
      status: ordinarySubmitterSafeCompletionModesPresent(input.inputs) ? "satisfied" : "missing",
      why: "The current loop and R1154 action packet must expose the two safe fill modes: feature-only lab/wearable coverage and outcome-linked lab/wearable model-evidence readiness.",
    },
    {
      evidenceArtifacts: [INPUTS.r1148.artifact],
      requirementId: "post_confirmation_private_config_intake_safe_action_guard_present",
      status: postConfirmationPrivateConfigIntakeSafeActionGuardPresent(input.inputs.r1148) ? "satisfied" : "missing",
      why: "R1148 must carry the R1147/R1154 safe availability action state so private config intake cannot skip safe lab-plus-wearable confirmation.",
    },
    {
      evidenceArtifacts: [INPUTS.r1144.artifact],
      requirementId: "safe_row_owner_assertion_gate_present",
      status: safeRowOwnerAssertionGatePresent(input.inputs.r1144) ? "satisfied" : "missing",
      why: "R1144 must refuse to materialize an availability manifest unless the row owner explicitly confirms safe availability assertions.",
    },
    {
      evidenceArtifacts: [INPUTS.r1144.artifact],
      requirementId: "row_owner_availability_assertions_confirmed",
      status: readBooleanAt(input.inputs.r1144, ["summary", "rowOwnerAssertionsConfirmed"]) === true
        ? "satisfied"
        : "missing",
      why: "Real route work cannot begin until the row owner confirms the ordinary lab/wearable availability assertions.",
    },
    {
      evidenceArtifacts: [INPUTS.r1144.artifact],
      requirementId: "confirmed_recipe_route_requirements_available",
      status: confirmedRouteRequirementsAvailable(input.inputs.r1144) ? "satisfied" : "missing",
      why: "After confirmation, the chain must name only aggregate-safe private field/table ref families needed for the lab and wearable routes.",
    },
    {
      evidenceArtifacts: [INPUTS.r1142.artifact],
      requirementId: "partial_private_chain_available",
      status: partialPrivateChainAvailable(input.inputs.r1142) ? "satisfied" : "missing",
      why: "The latest chain needs a one-command local private runner path for route metrics after safe manifest and private config completion.",
    },
    {
      evidenceArtifacts: [INPUTS.r1148.artifact, INPUTS.r1142.artifact],
      requirementId: "private_route_config_supplied",
      status: privateRouteConfigReadyOrAlreadyRun(input.inputs) ? "satisfied" : "missing",
      why: "The private config values must stay in the row owner's workspace, but aggregate artifacts must show the config is ready for R1142 or was supplied to R1142.",
    },
    {
      evidenceArtifacts: [INPUTS.r1142.artifact],
      requirementId: "real_lab_wearable_route_metrics_recorded",
      status: realLabWearableRouteMetricsRecorded(input.inputs.r1142) ? "satisfied" : "missing",
      why: "The current prioritized objective needs real aggregate route metrics for both the bloodwork/lab route and wearable activity route.",
    },
    {
      evidenceArtifacts: [INPUTS.r1076.artifact, INPUTS.r1135.artifact, INPUTS.r1142.artifact, INPUTS.r1144.artifact, INPUTS.r1148.artifact, INPUTS.r1149.artifact, INPUTS.r1151.artifact, INPUTS.r1152.artifact, INPUTS.r1153.artifact, INPUTS.r1154.artifact, INPUTS.r1155.artifact, INPUTS.r1156.artifact, INPUTS.r1157.artifact, INPUTS.r1158.artifact, INPUTS.r1159.artifact, INPUTS.r1160.artifact, INPUTS.r1161.artifact, INPUTS.r1162.artifact, INPUTS.r1167.artifact, INPUTS.r1170.artifact, INPUTS.r1172.artifact, INPUTS.r1173.artifact, INPUTS.r1174.artifact, INPUTS.r1175.artifact, INPUTS.r1176.artifact],
      requirementId: "privacy_and_product_gate_closed",
      status: privacyProductGateClosed(input.inputs) ? "satisfied" : "weakly_verified",
      why: "The audit and its inputs must remain aggregate-only with product display, product promotion, private details, predictions, and coefficients closed.",
    },
  ];
}

function baseChecklist(status: RequirementStatus): AuditChecklistItem[] {
  return [
    {
      evidenceArtifacts: [INPUTS.r1076.artifact, INPUTS.r1135.artifact],
      requirementId: "active_loop_prioritizes_ordinary_labs_wearables",
      status,
      why: "Current-chain artifacts need refresh before priority can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1135.artifact],
      requirementId: "route_recipes_cover_lab_and_wearable_submitter_inputs",
      status,
      why: "Current-chain artifacts need refresh before route recipe coverage can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1149.artifact],
      requirementId: "ordinary_lab_wearable_submitter_kit_available",
      status,
      why: "Current-chain artifacts need refresh before ordinary submitter kit coverage can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1149.artifact],
      requirementId: "ordinary_submitter_kit_feature_only_guard_present",
      status,
      why: "Current-chain artifacts need refresh before ordinary submitter kit feature-only guard coverage can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1151.artifact],
      requirementId: "feature_only_submission_model_evidence_guard_present",
      status,
      why: "Current-chain artifacts need refresh before feature-only non-model evidence guard coverage can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1152.artifact],
      requirementId: "feature_only_coverage_context_intake_guard_present",
      status,
      why: "Current-chain artifacts need refresh before feature-only coverage context intake guard coverage can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1153.artifact],
      requirementId: "feature_only_chain_runner_guard_present",
      status,
      why: "Current-chain artifacts need refresh before feature-only chain runner guard coverage can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1155.artifact],
      requirementId: "safe_confirmation_feature_only_smoke_proof_present",
      status,
      why: "Current-chain artifacts need refresh before the feature-only safe confirmation smoke proof can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1156.artifact],
      requirementId: "safe_confirmation_handoff_packet_present",
      status,
      why: "Current-chain artifacts need refresh before the safe confirmation row-owner handoff can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1157.artifact],
      requirementId: "safe_confirmation_chain_runner_present",
      status,
      why: "Current-chain artifacts need refresh before the one-command safe confirmation chain runner can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1158.artifact],
      requirementId: "safe_confirmation_fill_guide_present",
      status,
      why: "Current-chain artifacts need refresh before the safe confirmation fill guide can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1159.artifact],
      requirementId: "safe_confirmation_answer_sheet_present",
      status,
      why: "Current-chain artifacts need refresh before the safe confirmation answer sheet can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1160.artifact],
      requirementId: "safe_confirmation_transcription_proof_present",
      status,
      why: "Current-chain artifacts need refresh before the safe confirmation transcription proof can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1154.artifact],
      requirementId: "safe_availability_action_packet_guard_present",
      status,
      why: "Current-chain artifacts need refresh before the safe availability action packet guard can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1076.artifact, INPUTS.r1154.artifact],
      requirementId: "ordinary_submitter_safe_completion_checklist_present",
      status,
      why: "Current-chain artifacts need refresh before the ordinary submitter safe-completion checklist can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1076.artifact, INPUTS.r1154.artifact],
      requirementId: "ordinary_submitter_safe_completion_modes_present",
      status,
      why: "Current-chain artifacts need refresh before the ordinary submitter safe-completion modes can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1148.artifact],
      requirementId: "post_confirmation_private_config_intake_safe_action_guard_present",
      status,
      why: "Current-chain artifacts need refresh before R1148 safe-action propagation can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1144.artifact],
      requirementId: "safe_row_owner_assertion_gate_present",
      status,
      why: "Current-chain artifacts need refresh before the assertion gate can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1144.artifact],
      requirementId: "row_owner_availability_assertions_confirmed",
      status,
      why: "Current-chain artifacts need refresh before row-owner assertion status can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1144.artifact],
      requirementId: "confirmed_recipe_route_requirements_available",
      status,
      why: "Current-chain artifacts need refresh before route config requirements can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1142.artifact],
      requirementId: "partial_private_chain_available",
      status,
      why: "Current-chain artifacts need refresh before the partial private chain can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1148.artifact, INPUTS.r1142.artifact],
      requirementId: "private_route_config_supplied",
      status,
      why: "Current-chain artifacts need refresh before private config status can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1142.artifact],
      requirementId: "real_lab_wearable_route_metrics_recorded",
      status,
      why: "Current-chain artifacts need refresh before route metric status can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1161.artifact],
      requirementId: "safe_confirmation_materializer_present",
      status,
      why: "Current-chain artifacts need refresh before the gated safe confirmation materializer can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1162.artifact],
      requirementId: "safe_confirmation_assertion_handoff_present",
      status,
      why: "Current-chain artifacts need refresh before the safe confirmation assertion handoff can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1167.artifact],
      requirementId: "feature_only_safe_assertion_fill_guide_present",
      status,
      why: "Current-chain artifacts need refresh before the feature-only safe assertion fill guide can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1173.artifact],
      requirementId: "feature_only_safe_assertion_answer_sheet_present",
      status,
      why: "Current-chain artifacts need refresh before the feature-only safe assertion answer sheet can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1175.artifact],
      requirementId: "feature_only_safe_assertion_bridge_smoke_present",
      status,
      why: "Current-chain artifacts need refresh before the R1172-to-R1165 bridge smoke proof can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1176.artifact],
      requirementId: "feature_only_safe_assertion_live_chain_present",
      status,
      why: "Current-chain artifacts need refresh before the R1176 row-owner-gated safe assertion live chain can be audited.",
    },
    {
      evidenceArtifacts: [INPUTS.r1076.artifact, INPUTS.r1135.artifact, INPUTS.r1142.artifact, INPUTS.r1144.artifact, INPUTS.r1148.artifact, INPUTS.r1149.artifact, INPUTS.r1151.artifact, INPUTS.r1152.artifact, INPUTS.r1153.artifact, INPUTS.r1154.artifact, INPUTS.r1155.artifact, INPUTS.r1156.artifact, INPUTS.r1157.artifact, INPUTS.r1158.artifact, INPUTS.r1159.artifact, INPUTS.r1160.artifact, INPUTS.r1161.artifact, INPUTS.r1162.artifact, INPUTS.r1167.artifact, INPUTS.r1170.artifact, INPUTS.r1172.artifact, INPUTS.r1173.artifact, INPUTS.r1174.artifact, INPUTS.r1175.artifact, INPUTS.r1176.artifact],
      requirementId: "privacy_and_product_gate_closed",
      status,
      why: "Current-chain artifacts need refresh before privacy/product gates can be audited.",
    },
  ];
}

function blockersFor(input: {
  inputs: Record<InputKey, unknown | null>;
  missingRequirementIds: readonly RequirementId[];
  requiredInputsReady: boolean;
}): string[] {
  if (!input.requiredInputsReady) return ["refresh_current_chain_artifacts"];
  const blockers: string[] = [];
  if (input.missingRequirementIds.includes("route_recipes_cover_lab_and_wearable_submitter_inputs")) {
    blockers.push("ordinary_lab_wearable_route_recipes_missing");
  }
  if (input.missingRequirementIds.includes("ordinary_lab_wearable_submitter_kit_available")) {
    blockers.push("ordinary_lab_wearable_submitter_kit_missing_or_stale");
  }
  if (input.missingRequirementIds.includes("ordinary_submitter_kit_feature_only_guard_present")) {
    blockers.push("ordinary_submitter_kit_feature_only_guard_missing_or_stale");
  }
  if (input.missingRequirementIds.includes("feature_only_submission_model_evidence_guard_present")) {
    blockers.push("feature_only_submission_model_evidence_guard_missing_or_unsafe");
  }
  if (input.missingRequirementIds.includes("feature_only_coverage_context_intake_guard_present")) {
    blockers.push("feature_only_coverage_context_intake_guard_missing_or_unsafe");
  }
  if (input.missingRequirementIds.includes("feature_only_chain_runner_guard_present")) {
    blockers.push("feature_only_chain_runner_guard_missing_or_unsafe");
  }
  if (input.missingRequirementIds.includes("safe_confirmation_feature_only_smoke_proof_present")) {
    blockers.push("safe_confirmation_feature_only_smoke_proof_missing_or_unsafe");
  }
  if (input.missingRequirementIds.includes("safe_confirmation_handoff_packet_present")) {
    blockers.push("safe_confirmation_handoff_missing_or_unsafe");
  }
  if (input.missingRequirementIds.includes("safe_confirmation_chain_runner_present")) {
    blockers.push("safe_confirmation_chain_runner_missing_or_unsafe");
  }
  if (input.missingRequirementIds.includes("safe_confirmation_fill_guide_present")) {
    blockers.push("safe_confirmation_fill_guide_missing_or_unsafe");
  }
  if (input.missingRequirementIds.includes("safe_confirmation_answer_sheet_present")) {
    blockers.push("safe_confirmation_answer_sheet_missing_or_unsafe");
  }
  if (input.missingRequirementIds.includes("safe_confirmation_transcription_proof_present")) {
    blockers.push("safe_confirmation_transcription_proof_missing_or_unsafe");
  }
  if (input.missingRequirementIds.includes("safe_confirmation_materializer_present")) {
    blockers.push("safe_confirmation_materializer_missing_or_unsafe");
  }
  if (input.missingRequirementIds.includes("safe_confirmation_assertion_handoff_present")) {
    blockers.push("safe_confirmation_assertion_handoff_missing_or_unsafe");
  }
  if (input.missingRequirementIds.includes("feature_only_safe_assertion_fill_guide_present")) {
    blockers.push("feature_only_safe_assertion_fill_guide_missing_or_unsafe");
  }
  if (input.missingRequirementIds.includes("feature_only_safe_assertion_answer_sheet_present")) {
    blockers.push("feature_only_safe_assertion_answer_sheet_missing_or_unsafe");
  }
  if (input.missingRequirementIds.includes("feature_only_safe_assertion_materializer_present")) {
    blockers.push("feature_only_safe_assertion_materializer_missing_or_unsafe");
  }
  if (input.missingRequirementIds.includes("feature_only_safe_assertion_bridge_smoke_present")) {
    blockers.push("feature_only_safe_assertion_bridge_smoke_missing_or_unsafe");
  }
  if (input.missingRequirementIds.includes("feature_only_safe_assertion_live_chain_present")) {
    blockers.push("feature_only_safe_assertion_live_chain_missing_or_unsafe");
  }
  if (input.missingRequirementIds.includes("safe_availability_action_packet_guard_present")) {
    blockers.push("safe_availability_action_packet_missing_or_unsafe");
  }
  if (input.missingRequirementIds.includes("ordinary_submitter_safe_completion_checklist_present")) {
    blockers.push("ordinary_submitter_safe_completion_checklist_missing_or_stale");
  }
  if (input.missingRequirementIds.includes("ordinary_submitter_safe_completion_modes_present")) {
    blockers.push("ordinary_submitter_safe_completion_modes_missing_or_stale");
  }
  if (input.missingRequirementIds.includes("post_confirmation_private_config_intake_safe_action_guard_present")) {
    blockers.push("post_confirmation_private_config_intake_safe_action_guard_missing_or_stale");
  }
  if (input.missingRequirementIds.includes("safe_row_owner_assertion_gate_present")) {
    blockers.push("row_owner_assertion_gate_missing_or_unsafe");
  }
  if (input.missingRequirementIds.includes("row_owner_availability_assertions_confirmed")) {
    blockers.push("row_owner_availability_assertions_not_confirmed");
  }
  if (input.missingRequirementIds.includes("confirmed_recipe_route_requirements_available")) {
    blockers.push("confirmed_route_config_requirements_not_available");
  }
  if (input.missingRequirementIds.includes("private_route_config_supplied")) {
    blockers.push(privateRouteConfigSuppliedToIntake(input.inputs) ? "private_route_config_incomplete" : "private_route_config_not_supplied");
  }
  if (input.missingRequirementIds.includes("real_lab_wearable_route_metrics_recorded")) {
    blockers.push("real_lab_wearable_route_metrics_missing");
  }
  if (input.missingRequirementIds.includes("privacy_and_product_gate_closed")) {
    blockers.push("privacy_or_product_gate_not_closed");
  }
  return [...new Set(blockers)];
}

function completionUnblockerStepsFor(input: {
  commands: CompletionAuditCommands;
  inputs: Record<InputKey, unknown | null>;
  missingRequirementIds: readonly RequirementId[];
}): CompletionUnblockerStep[] {
  const stepFor = (
    step: Omit<CompletionUnblockerStep, "allowedValueKindIds" | "blockedContentIds" | "minimumFeaturePairRequired" | "optionalAddOnFamilyIds" | "prioritizedInputFamilyIds" | "privateDetailsStored" | "productDisplayAuthorized" | "requiredInputKindIds" | "rowLevelDataAccepted" | "safeCompletionChecklistItemIds" | "status" | "targetAgeBand" | "targetInputPriority">,
  ): CompletionUnblockerStep => ({
    ...step,
    allowedValueKindIds: [...SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS],
    blockedContentIds: [...SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS],
    minimumFeaturePairRequired: [...REQUIRED_FEATURE_ONLY_PAIR_FAMILY_IDS],
    optionalAddOnFamilyIds: [...REQUIRED_R1158_OPTIONAL_ADD_ON_FAMILY_IDS],
    prioritizedInputFamilyIds: [...REQUIRED_PRIMARY_INPUT_FAMILY_IDS],
    privateDetailsStored: false,
    productDisplayAuthorized: false,
    requiredInputKindIds: [...REQUIRED_R1158_INPUT_KIND_IDS],
    rowLevelDataAccepted: false,
    safeCompletionChecklistItemIds: [...REQUIRED_R1158_FEATURE_ONLY_CHECKLIST_IDS],
    status: input.missingRequirementIds.includes(step.requirementId) ? "blocked" : "satisfied",
    targetAgeBand: TARGET_AGE_BAND,
    targetInputPriority: TARGET_INPUT_PRIORITY,
  });

  return [
    stepFor({
      blocker: "row_owner_availability_assertions_not_confirmed",
      command: input.commands.rowOwnerSafeAssertionChainRunnerCommand,
      nextAction: "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation",
      requirementId: "row_owner_availability_assertions_confirmed",
      stepId: "confirm_feature_only_lab_wearable_safe_availability",
    }),
    stepFor({
      blocker: "confirmed_route_config_requirements_not_available",
      command: input.commands.recipeReadinessChainRunnerCommand,
      nextAction: "run_r1144_recipe_readiness_chain_with_confirmed_availability",
      requirementId: "confirmed_recipe_route_requirements_available",
      stepId: "confirm_lab_wearable_recipe_route_requirements",
    }),
    stepFor({
      blocker: privateRouteConfigSuppliedToIntake(input.inputs)
        ? "private_route_config_incomplete"
        : "private_route_config_not_supplied",
      command: input.commands.postConfirmationPrivateConfigIntakeCommand,
      nextAction: "fill_private_route_config_for_confirmed_lab_wearable_routes",
      requirementId: "private_route_config_supplied",
      stepId: "provide_lab_wearable_private_route_config",
    }),
    stepFor({
      blocker: "real_lab_wearable_route_metrics_missing",
      command: input.commands.partialPrivateChainRunnerCommand,
      nextAction: "run_r1142_partial_private_chain_for_real_lab_wearable_route_metrics",
      requirementId: "real_lab_wearable_route_metrics_recorded",
      stepId: "run_real_lab_wearable_route_metrics",
    }),
  ];
}

function nextActionFor(input: {
  goalAchieved: boolean;
  inputs: Record<InputKey, unknown | null>;
  requiredInputsReady: boolean;
}): AuditNextAction {
  if (!input.requiredInputsReady) return "refresh_r1076_r1135_r1142_r1144_r1148_r1149_r1151_r1152_r1153_r1154_r1155_r1156_r1157_r1158_r1159_r1160_r1161_r1162_current_chain_artifacts";
  if (input.goalAchieved) return "review_real_lab_wearable_route_metrics_research_only";
  if (!featureOnlyModelEvidenceGuardPresent(input.inputs.r1151)) {
    return "refresh_r1151_feature_only_submission_mode";
  }
  if (!featureOnlyCoverageContextIntakeGuardPresent(input.inputs.r1152)) {
    return "refresh_r1152_feature_only_coverage_context_intake";
  }
  if (!featureOnlyChainRunnerGuardPresent(input.inputs.r1153)) {
    return "refresh_r1153_feature_only_chain_runner";
  }
  if (!safeConfirmationFeatureOnlySmokeProofPresent(input.inputs.r1155)) {
    return "refresh_r1155_safe_confirmation_feature_only_smoke_proof";
  }
  if (!safeConfirmationHandoffPresent(input.inputs.r1156)) {
    return "refresh_r1156_safe_confirmation_handoff";
  }
  if (!safeConfirmationChainRunnerPresent(input.inputs.r1157)) {
    return "refresh_r1157_safe_confirmation_chain_runner";
  }
  if (!safeConfirmationFillGuidePresent(input.inputs.r1158)) {
    return "refresh_r1158_safe_confirmation_fill_guide";
  }
  if (!safeConfirmationAnswerSheetPresent(input.inputs.r1159)) {
    return "refresh_r1159_safe_confirmation_answer_sheet";
  }
  if (!safeConfirmationTranscriptionProofPresent(input.inputs.r1160)) {
    return "refresh_r1160_safe_confirmation_transcription_proof";
  }
  if (!safeConfirmationMaterializerPresent(input.inputs.r1161)) {
    return "refresh_r1161_safe_confirmation_materializer";
  }
  if (!safeConfirmationAssertionHandoffPresent(input.inputs.r1162)) {
    return "refresh_r1162_safe_confirmation_assertion_handoff";
  }
  if (featureOnlySafeAssertionRunnerPresent(input.inputs.r1165) && !featureOnlySafeAssertionFillGuidePresent(input.inputs.r1167)) {
    return "refresh_r1167_safe_assertion_fill_guide";
  }
  if (featureOnlySafeAssertionFillGuidePresent(input.inputs.r1167)
    && !featureOnlySafeAssertionAnswerSheetPresent(input.inputs.r1173)) {
    return "refresh_r1173_safe_assertion_answer_sheet";
  }
  if (featureOnlySafeAssertionFillGuidePresent(input.inputs.r1167)
    && !featureOnlySafeAssertionMaterializerPresent(input.inputs.r1172)) {
    return "refresh_r1172_safe_assertion_materializer";
  }
  if (featureOnlySafeAssertionMaterializerPresent(input.inputs.r1172)
    && !featureOnlySafeAssertionBridgeSmokePresent(input.inputs.r1175)) {
    return "refresh_r1175_r1172_to_r1165_safe_assertion_bridge_smoke";
  }
  if (featureOnlySafeAssertionBridgeSmokePresent(input.inputs.r1175)
    && !featureOnlySafeAssertionLiveChainPresent(input.inputs.r1176)) {
    return "refresh_r1176_row_owner_safe_assertion_chain";
  }
  if (!ordinarySubmitterKitFeatureOnlyGuardPresent(input.inputs.r1149)) {
    return "refresh_r1149_submitter_kit";
  }
  if (!safeAvailabilityActionPacketGuardPresent(input.inputs.r1154)) {
    return "refresh_r1154_safe_availability_action_packet";
  }
  if (!ordinarySubmitterSafeCompletionChecklistPresent(input.inputs)) {
    return "refresh_r1076_r1135_r1142_r1144_r1148_r1149_r1151_r1152_r1153_r1154_r1155_r1156_r1157_r1158_r1159_r1160_r1161_r1162_current_chain_artifacts";
  }
  if (!postConfirmationPrivateConfigIntakeSafeActionGuardPresent(input.inputs.r1148)) {
    return "refresh_r1148_post_confirmation_private_config_intake";
  }
  if (readBooleanAt(input.inputs.r1144, ["summary", "rowOwnerAssertionsConfirmed"]) !== true) {
    return featureOnlySafeAssertionLiveChainNextAction(input.inputs.r1176)
      ?? featureOnlySafeAssertionAnswerSheetNextAction(input.inputs.r1173)
      ?? featureOnlySafeAssertionMaterializerNextAction(input.inputs.r1172)
      ?? featureOnlySafeAssertionRunnerNextAction(input.inputs.r1165)
      ?? safeConfirmationToResearchRunnerNextAction(input.inputs.r1163)
      ?? safeConfirmationAssertionHandoffNextAction(input.inputs.r1162)
      ?? safeConfirmationMaterializerNextAction(input.inputs.r1161)
      ?? safeConfirmationTranscriptionProofNextAction(input.inputs.r1160)
      ?? safeConfirmationAnswerSheetNextAction(input.inputs.r1159)
      ?? safeAvailabilityActionPacketNextAction(input.inputs.r1154)
      ?? "fill_safe_availability_confirmation_from_template";
  }
  if (!privateRouteConfigReadyOrAlreadyRun(input.inputs)) {
    return "fill_private_route_config_for_confirmed_lab_wearable_routes";
  }
  return "run_r1142_partial_private_chain_for_real_lab_wearable_route_metrics";
}

function conclusionFor(input: {
  goalAchieved: boolean;
  requiredInputsReady: boolean;
}): AuditConclusion {
  if (!input.requiredInputsReady) return "ordinary_consumer_current_chain_completion_audit_waiting_on_refresh";
  if (input.goalAchieved) return "ordinary_consumer_current_chain_completion_audit_ready_for_research_review";
  return "ordinary_consumer_current_chain_completion_audit_blocked_on_row_owner_route_evidence";
}

function ordinaryPriorityVisible(inputs: Record<InputKey, unknown | null>): boolean {
  return (
    readStringAt(inputs.r1076, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    || readStringAt(inputs.r1135, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    || readStringAt(inputs.r1144, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    || readStringAt(inputs.r1142, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
  ) && includesAll(
    readStringArrayAt(inputs.r1135, ["summary", "primarySubmitterInputFamilyIds"]),
    REQUIRED_PRIMARY_INPUT_FAMILY_IDS,
  );
}

function routeRecipesCoverPrimaryInputs(r1135: unknown | null): boolean {
  const recipeIds = [
    ...readStringArrayAt(r1135, ["summary", "preferredManifestRecipeIds"]),
    ...readStringArrayAt(r1135, ["summary", "partialRouteManifestRecipeIds"]),
  ];
  const linkageIds = readStringArrayAt(r1135, ["summary", "requiredLinkageFamilyIds"]);
  return includesAll(recipeIds, REQUIRED_ROUTE_RECIPE_IDS)
    && includesAll(linkageIds, REQUIRED_LINKAGE_FAMILY_IDS);
}

function ordinarySubmitterKitAvailable(r1149: unknown | null): boolean {
  return readStringAt(r1149, ["packetId"]) === INPUTS.r1149.packetId
    && readStringAt(r1149, ["schemaVersion"]) === INPUTS.r1149.schemaVersion
    && readStringAt(r1149, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && includesAll(
      readStringArrayAt(r1149, ["summary", "requiredSourceFamilyIds"]),
      REQUIRED_SUBMITTER_KIT_SOURCE_FAMILY_IDS,
    )
    && includesAll(
      readStringArrayAt(r1149, ["summary", "expectedRouteIds"]),
      REQUIRED_ROUTE_METRIC_IDS,
    )
    && readStringAt(r1149, ["summary", "nextAction"]) !== null
    && readBooleanAt(r1149, ["productDisplayAuthorized"]) === false;
}

function ordinarySubmitterKitFeatureOnlyGuardPresent(r1149: unknown | null): boolean {
  return readStringAt(r1149, ["packetId"]) === INPUTS.r1149.packetId
    && readStringAt(r1149, ["schemaVersion"]) === INPUTS.r1149.schemaVersion
    && readBooleanAt(r1149, ["summary", "featureOnlyModeModelEvidencePromotionAllowed"]) === false
    && readBooleanAt(r1149, ["summary", "featureOnlyModeOutcomeLinkedEvidenceReady"]) !== null
    && readStringAt(r1149, ["summary", "featureOnlyModeConclusion"]) !== null
    && readBooleanAt(r1149, [
      "ordinaryConsumerSubmissionKit",
      "featureOnlySubmissionMode",
      "modelEvidencePromotionAllowed",
    ]) === false
    && readBooleanAt(r1149, [
      "ordinaryConsumerSubmissionKit",
      "featureOnlySubmissionMode",
      "featureOnlyCoverageContextAllowed",
    ]) !== null
    && readBooleanAt(r1149, [
      "ordinaryConsumerSubmissionKit",
      "featureOnlySubmissionMode",
      "outcomeLinkedEvidenceReady",
    ]) !== null
    && readBooleanAt(r1149, [
      "ordinaryConsumerSubmissionKit",
      "featureOnlySubmissionMode",
      "privateDetailsStored",
    ]) === false
    && readStringAt(r1149, [
      "ordinaryConsumerSubmissionKit",
      "commands",
      "featureOnlySubmissionModeCommand",
    ]) !== null
    && readBooleanAt(r1149, ["productDisplayAuthorized"]) === false;
}

function featureOnlyModelEvidenceGuardPresent(r1151: unknown | null): boolean {
  return readStringAt(r1151, ["packetId"]) === INPUTS.r1151.packetId
    && readStringAt(r1151, ["schemaVersion"]) === INPUTS.r1151.schemaVersion
    && readStringAt(r1151, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(r1151, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && readBooleanAt(r1151, ["summary", "featureOnlyCoverageRequiresPreferredPair"]) === true
    && includesAll(
      readStringArrayAt(r1151, ["summary", "minimumFeaturePairRequired"]),
      REQUIRED_FEATURE_ONLY_PAIR_FAMILY_IDS,
    )
    && readBooleanAt(r1151, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(r1151, ["summary", "outcomeLinkageRequiredForFeatureOnlyContext"]) === false
    && readBooleanAt(r1151, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(r1151, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(r1151, ["summary", "rowLevelDataAcceptedByR1151"]) === false
    && readBooleanAt(r1151, ["summary", "rowParsingPerformedByR1151"]) === false
    && readBooleanAt(r1151, ["productDisplayAuthorized"]) === false
    && readStringAt(r1151, ["summary", "nextAction"]) !== null;
}

function featureOnlyCoverageContextIntakeGuardPresent(r1152: unknown | null): boolean {
  return readStringAt(r1152, ["packetId"]) === INPUTS.r1152.packetId
    && readStringAt(r1152, ["schemaVersion"]) === INPUTS.r1152.schemaVersion
    && readStringAt(r1152, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(r1152, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && readBooleanAt(r1152, ["summary", "featureOnlyCoverageRequiresPreferredPair"]) === true
    && includesAll(
      readStringArrayAt(r1152, ["summary", "minimumFeaturePairRequired"]),
      REQUIRED_FEATURE_ONLY_PAIR_FAMILY_IDS,
    )
    && readBooleanAt(r1152, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(r1152, ["summary", "outcomeLinkageRequiredForFeatureOnlyContext"]) === false
    && readBooleanAt(r1152, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(r1152, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(r1152, ["summary", "rowLevelDataAcceptedByR1152"]) === false
    && readBooleanAt(r1152, ["summary", "rowParsingPerformedByR1152"]) === false
    && readBooleanAt(r1152, ["productDisplayAuthorized"]) === false
    && readStringAt(r1152, ["summary", "nextAction"]) !== null;
}

function featureOnlyChainRunnerGuardPresent(r1153: unknown | null): boolean {
  return readStringAt(r1153, ["packetId"]) === INPUTS.r1153.packetId
    && readStringAt(r1153, ["schemaVersion"]) === INPUTS.r1153.schemaVersion
    && readStringAt(r1153, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(r1153, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(r1153, ["artifactBoundary", "availabilityConfirmationPathStored"]) === false
    && readBooleanAt(r1153, ["artifactBoundary", "contextPathStored"]) === false
    && readBooleanAt(r1153, ["artifactBoundary", "featureValuesStored"]) === false
    && readBooleanAt(r1153, ["artifactBoundary", "fileNamesStored"]) === false
    && readBooleanAt(r1153, ["artifactBoundary", "headerValuesStored"]) === false
    && readBooleanAt(r1153, ["artifactBoundary", "localPathsStored"]) === false
    && readBooleanAt(r1153, ["artifactBoundary", "participantIdentifiersStored"]) === false
    && readBooleanAt(r1153, ["artifactBoundary", "participantIdentifiersWritten"]) === false
    && readBooleanAt(r1153, ["artifactBoundary", "predictionsStored"]) === false
    && readBooleanAt(r1153, ["artifactBoundary", "privateConfigValuesStored"]) === false
    && readBooleanAt(r1153, ["artifactBoundary", "privateFieldRefValuesStored"]) === false
    && readBooleanAt(r1153, ["artifactBoundary", "privateFieldRefsStored"]) === false
    && readBooleanAt(r1153, ["artifactBoundary", "privateTableRefValuesStored"]) === false
    && readBooleanAt(r1153, ["artifactBoundary", "privateTableRefsStored"]) === false
    && readBooleanAt(r1153, ["artifactBoundary", "rowLevelDataAcceptedByR1153"]) === false
    && readBooleanAt(r1153, ["artifactBoundary", "rowParsingPerformedByR1153"]) === false
    && readBooleanAt(r1153, ["artifactBoundary", "rowValuesStored"]) === false
    && readBooleanAt(r1153, ["artifactBoundary", "sourceFileNamesStored"]) === false
    && readBooleanAt(r1153, ["artifactBoundary", "sourceVariableNamesStored"]) === false
    && readStringAt(r1153, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(r1153, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && includesAll(
      readStringArrayAt(r1153, ["summary", "minimumFeaturePairRequired"]),
      REQUIRED_FEATURE_ONLY_PAIR_FAMILY_IDS,
    )
    && readBooleanAt(r1153, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(r1153, ["summary", "outcomeLinkageRequiredForFeatureOnlyContext"]) === false
    && readBooleanAt(r1153, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(r1153, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(r1153, ["summary", "rowLevelDataAcceptedByR1153"]) === false
    && readBooleanAt(r1153, ["summary", "rowParsingPerformedByR1153"]) === false
    && readBooleanAt(r1153, ["productDisplayAuthorized"]) === false
    && readStringAt(r1153, ["summary", "featureOnlyCoverageContextIntakeConclusion"]) !== null
    && readStringAt(r1153, ["summary", "featureOnlyModeConclusion"]) !== null
    && readStringAt(r1153, ["summary", "nextAction"]) !== null;
}

function safeConfirmationFeatureOnlySmokeProofPresent(r1155: unknown | null): boolean {
  return readStringAt(r1155, ["packetId"]) === INPUTS.r1155.packetId
    && readStringAt(r1155, ["schemaVersion"]) === INPUTS.r1155.schemaVersion
    && readStringAt(r1155, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(r1155, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(r1155, ["artifactBoundary", "confirmationPathStored"]) === false
    && readBooleanAt(r1155, ["artifactBoundary", "confirmationValuesStored"]) === false
    && readBooleanAt(r1155, ["artifactBoundary", "contextPathStored"]) === false
    && readBooleanAt(r1155, ["artifactBoundary", "featureValuesStored"]) === false
    && readBooleanAt(r1155, ["artifactBoundary", "fileNamesStored"]) === false
    && readBooleanAt(r1155, ["artifactBoundary", "localPathsStored"]) === false
    && readBooleanAt(r1155, ["artifactBoundary", "privateFieldRefValuesStored"]) === false
    && readBooleanAt(r1155, ["artifactBoundary", "privateTableRefValuesStored"]) === false
    && readBooleanAt(r1155, ["artifactBoundary", "rowLevelDataAcceptedByR1155"]) === false
    && readBooleanAt(r1155, ["artifactBoundary", "rowParsingPerformedByR1155"]) === false
    && readBooleanAt(r1155, ["artifactBoundary", "temporaryConfirmationPersisted"]) === false
    && readStringAt(r1155, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(r1155, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && readStringAt(r1155, ["summary", "conclusion"]) === "ordinary_safe_confirmation_feature_only_smoke_passed_non_evidence"
    && readStringAt(r1155, ["summary", "featureOnlyChainConclusion"]) === "ordinary_feature_only_chain_ready_research_only"
    && readStringAt(r1155, ["summary", "safeAvailabilityConfirmationConclusion"])
      === "safe_availability_confirmation_feature_only_ready_research_only"
    && readBooleanAt(r1155, ["summary", "featureOnlyCoverageContextReadyForResearchPlanning"]) === true
    && readBooleanAt(r1155, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(r1155, ["summary", "readyForRecipeReadinessChain"]) === false
    && readBooleanAt(r1155, ["summary", "rowLevelDataAcceptedByR1155"]) === false
    && readBooleanAt(r1155, ["summary", "rowParsingPerformedByR1155"]) === false
    && readBooleanAt(r1155, ["summary", "smokeEvidence"]) === false
    && readBooleanAt(r1155, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(r1155, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(r1155, ["productDisplayAuthorized"]) === false
    && readBooleanAt(
      r1155,
      ["safeConfirmationFeatureOnlySmokeProof", "temporaryConfirmationValuesPersistedInArtifact"],
    ) === false
    && readBooleanAt(
      r1155,
      ["safeConfirmationFeatureOnlySmokeProof", "outcomeLinkedEvidenceIncludedInSmoke"],
    ) === false;
}

function safeConfirmationHandoffPresent(r1156: unknown | null): boolean {
  return readStringAt(r1156, ["packetId"]) === INPUTS.r1156.packetId
    && readStringAt(r1156, ["schemaVersion"]) === INPUTS.r1156.schemaVersion
    && readStringAt(r1156, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(r1156, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(r1156, ["artifactBoundary", "availabilityConfirmationPathStored"]) === false
    && readBooleanAt(r1156, ["artifactBoundary", "confirmationValuesStored"]) === false
    && readBooleanAt(r1156, ["artifactBoundary", "featureValuesStored"]) === false
    && readBooleanAt(r1156, ["artifactBoundary", "fileNamesStored"]) === false
    && readBooleanAt(r1156, ["artifactBoundary", "headerValuesStored"]) === false
    && readBooleanAt(r1156, ["artifactBoundary", "localPathsStored"]) === false
    && readBooleanAt(r1156, ["artifactBoundary", "privateFieldRefValuesStored"]) === false
    && readBooleanAt(r1156, ["artifactBoundary", "privateTableRefValuesStored"]) === false
    && readBooleanAt(r1156, ["artifactBoundary", "rowLevelDataAcceptedByR1156"]) === false
    && readBooleanAt(r1156, ["artifactBoundary", "rowParsingPerformedByR1156"]) === false
    && readBooleanAt(r1156, ["artifactBoundary", "smokeEvidenceStoredAsModelEvidence"]) === false
    && readStringAt(r1156, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(r1156, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && includesAll(
      readStringArrayAt(r1156, ["summary", "requiredFeatureOnlySourceFamilyIds"]),
      REQUIRED_FEATURE_ONLY_PAIR_FAMILY_IDS,
    )
    && includesAll(
      readStringArrayAt(r1156, ["summary", "requiredSafeCompletionCheckIds"]),
      REQUIRED_ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS,
    )
    && readBooleanAt(r1156, ["summary", "featureOnlyPathMechanicallyProven"]) === true
    && readBooleanAt(r1156, ["summary", "handoffReadyForRowOwner"]) === true
    && readBooleanAt(r1156, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(r1156, ["summary", "readyForModelEvidence"]) === false
    && readBooleanAt(r1156, ["summary", "rowLevelDataAcceptedByR1156"]) === false
    && readBooleanAt(r1156, ["summary", "rowParsingPerformedByR1156"]) === false
    && readBooleanAt(r1156, ["summary", "smokeEvidence"]) === false
    && readBooleanAt(r1156, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(r1156, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(r1156, ["productDisplayAuthorized"]) === false
    && readStringAt(r1156, ["summary", "nextAction"]) !== null
    && readStringAt(r1156, ["summary", "safeAvailabilityActionPacketConclusion"]) !== null
    && readStringAt(r1156, ["summary", "safeConfirmationFeatureOnlySmokeProofConclusion"])
      === "ordinary_safe_confirmation_feature_only_smoke_passed_non_evidence";
}

function safeConfirmationChainRunnerPresent(r1157: unknown | null): boolean {
  return readStringAt(r1157, ["packetId"]) === INPUTS.r1157.packetId
    && readStringAt(r1157, ["schemaVersion"]) === INPUTS.r1157.schemaVersion
    && readStringAt(r1157, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(r1157, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(r1157, ["artifactBoundary", "availabilityConfirmationPathStored"]) === false
    && readBooleanAt(r1157, ["artifactBoundary", "confirmationValuesStored"]) === false
    && readBooleanAt(r1157, ["artifactBoundary", "contextPathStored"]) === false
    && readBooleanAt(r1157, ["artifactBoundary", "featureValuesStored"]) === false
    && readBooleanAt(r1157, ["artifactBoundary", "fileNamesStored"]) === false
    && readBooleanAt(r1157, ["artifactBoundary", "headerValuesStored"]) === false
    && readBooleanAt(r1157, ["artifactBoundary", "localPathsStored"]) === false
    && readBooleanAt(r1157, ["artifactBoundary", "privateFieldRefValuesStored"]) === false
    && readBooleanAt(r1157, ["artifactBoundary", "privateTableRefValuesStored"]) === false
    && readBooleanAt(r1157, ["artifactBoundary", "rowLevelDataAcceptedByR1157"]) === false
    && readBooleanAt(r1157, ["artifactBoundary", "rowParsingPerformedByR1157"]) === false
    && readBooleanAt(r1157, ["artifactBoundary", "temporaryConfirmationPersistedByR1157"]) === false
    && readStringAt(r1157, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(r1157, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && readBooleanAt(r1157, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(r1157, ["summary", "readyForModelEvidence"]) === false
    && readBooleanAt(r1157, ["summary", "rowLevelDataAcceptedByR1157"]) === false
    && readBooleanAt(r1157, ["summary", "rowParsingPerformedByR1157"]) === false
    && readBooleanAt(r1157, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(r1157, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(r1157, ["productDisplayAuthorized"]) === false
    && readStringAt(r1157, ["summary", "safeConfirmationChainRunnerCommand"]) !== null
    && readStringAt(r1157, ["summary", "safeAvailabilityConfirmationConclusion"]) !== null
    && readStringAt(r1157, ["summary", "safeConfirmationHandoffConclusion"]) !== null;
}

function safeConfirmationFillGuidePresent(r1158: unknown | null): boolean {
  return readStringAt(r1158, ["packetId"]) === INPUTS.r1158.packetId
    && readStringAt(r1158, ["schemaVersion"]) === INPUTS.r1158.schemaVersion
    && readStringAt(r1158, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(r1158, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(r1158, ["artifactBoundary", "availabilityConfirmationPathStored"]) === false
    && readBooleanAt(r1158, ["artifactBoundary", "confirmationValuesStored"]) === false
    && readBooleanAt(r1158, ["artifactBoundary", "featureValuesStored"]) === false
    && readBooleanAt(r1158, ["artifactBoundary", "fileNamesStored"]) === false
    && readBooleanAt(r1158, ["artifactBoundary", "headerValuesStored"]) === false
    && readBooleanAt(r1158, ["artifactBoundary", "localPathsStored"]) === false
    && readBooleanAt(r1158, ["artifactBoundary", "privateConfigValuesStored"]) === false
    && readBooleanAt(r1158, ["artifactBoundary", "privateFieldRefValuesStored"]) === false
    && readBooleanAt(r1158, ["artifactBoundary", "privateFieldRefsStored"]) === false
    && readBooleanAt(r1158, ["artifactBoundary", "privateTableRefValuesStored"]) === false
    && readBooleanAt(r1158, ["artifactBoundary", "privateTableRefsStored"]) === false
    && readBooleanAt(r1158, ["artifactBoundary", "rowLevelDataAcceptedByR1158"]) === false
    && readBooleanAt(r1158, ["artifactBoundary", "rowParsingPerformedByR1158"]) === false
    && readBooleanAt(r1158, ["artifactBoundary", "sourceFileNamesStored"]) === false
    && readBooleanAt(r1158, ["artifactBoundary", "sourceVariableNamesStored"]) === false
    && readStringAt(r1158, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(r1158, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && readStringAt(r1158, ["summary", "conclusion"]) === "ordinary_safe_confirmation_fill_guide_ready_non_evidence"
    && readStringAt(r1158, ["summary", "nextAction"]) === "fill_safe_availability_confirmation_from_template"
    && readBooleanAt(r1158, ["summary", "guideReadyForRowOwnerFill"]) === true
    && readNumberAt(r1158, ["summary", "exactSafeFieldEditCount"]) === REQUIRED_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length
    && exactStringSet(readStringArrayAt(r1158, ["summary", "minimumFeaturePairRequired"]), REQUIRED_FEATURE_ONLY_PAIR_FAMILY_IDS)
    && exactStringSet(readStringArrayAt(r1158, ["summary", "optionalAddOnFamilyIds"]), REQUIRED_R1158_OPTIONAL_ADD_ON_FAMILY_IDS)
    && exactStringSet(readStringArrayAt(r1158, ["summary", "requiredChecklistIds"]), REQUIRED_R1158_FEATURE_ONLY_CHECKLIST_IDS)
    && exactStringSet(readStringArrayAt(r1158, ["summary", "requiredInputKindIds"]), REQUIRED_R1158_INPUT_KIND_IDS)
    && readBooleanAt(r1158, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(r1158, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(r1158, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(r1158, ["summary", "rowLevelDataAcceptedByR1158"]) === false
    && readBooleanAt(r1158, ["summary", "rowParsingPerformedByR1158"]) === false
    && readBooleanAt(r1158, ["productDisplayAuthorized"]) === false;
}

function safeConfirmationAnswerSheetPresent(r1159: unknown | null): boolean {
  return readStringAt(r1159, ["packetId"]) === INPUTS.r1159.packetId
    && readStringAt(r1159, ["schemaVersion"]) === INPUTS.r1159.schemaVersion
    && readStringAt(r1159, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(r1159, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(r1159, ["artifactBoundary", "answerSheetTemplatePathStored"]) === false
    && readBooleanAt(r1159, ["artifactBoundary", "availabilityConfirmationPathStored"]) === false
    && readBooleanAt(r1159, ["artifactBoundary", "featureValuesStored"]) === false
    && readBooleanAt(r1159, ["artifactBoundary", "fileNamesStored"]) === false
    && readBooleanAt(r1159, ["artifactBoundary", "headerValuesStored"]) === false
    && readBooleanAt(r1159, ["artifactBoundary", "localPathsStored"]) === false
    && readBooleanAt(r1159, ["artifactBoundary", "privateConfigValuesStored"]) === false
    && readBooleanAt(r1159, ["artifactBoundary", "privateFieldRefValuesStored"]) === false
    && readBooleanAt(r1159, ["artifactBoundary", "privateFieldRefsStored"]) === false
    && readBooleanAt(r1159, ["artifactBoundary", "privateTableRefValuesStored"]) === false
    && readBooleanAt(r1159, ["artifactBoundary", "privateTableRefsStored"]) === false
    && readBooleanAt(r1159, ["artifactBoundary", "rowLevelDataAcceptedByR1159"]) === false
    && readBooleanAt(r1159, ["artifactBoundary", "rowOwnerProvidedValuesStored"]) === false
    && readBooleanAt(r1159, ["artifactBoundary", "rowParsingPerformedByR1159"]) === false
    && readBooleanAt(r1159, ["artifactBoundary", "sourceFileNamesStored"]) === false
    && readBooleanAt(r1159, ["artifactBoundary", "sourceVariableNamesStored"]) === false
    && readBooleanAt(r1159, ["artifactBoundary", "submittedConfirmationValuesStored"]) === false
    && readStringAt(r1159, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(r1159, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && readStringAt(r1159, ["summary", "conclusion"]) === "ordinary_safe_confirmation_answer_sheet_ready_non_evidence"
    && readStringAt(r1159, ["summary", "nextAction"]) === "fill_r1150_feature_only_safe_confirmation_from_r1159_answer_sheet"
    && readBooleanAt(r1159, ["summary", "answerSheetReadyForRowOwner"]) === true
    && readNumberAt(r1159, ["summary", "exactSafeAnswerCount"]) === REQUIRED_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length
    && exactStringSet(readStringArrayAt(r1159, ["summary", "minimumFeaturePairRequired"]), REQUIRED_FEATURE_ONLY_PAIR_FAMILY_IDS)
    && exactStringSet(readStringArrayAt(r1159, ["summary", "optionalAddOnFamilyIds"]), REQUIRED_R1158_OPTIONAL_ADD_ON_FAMILY_IDS)
    && exactStringSet(readStringArrayAt(r1159, ["summary", "requiredChecklistIds"]), REQUIRED_R1158_FEATURE_ONLY_CHECKLIST_IDS)
    && exactStringSet(readStringArrayAt(r1159, ["summary", "requiredInputKindIds"]), REQUIRED_R1158_INPUT_KIND_IDS)
    && readBooleanAt(r1159, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(r1159, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(r1159, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(r1159, ["summary", "rowLevelDataAcceptedByR1159"]) === false
    && readBooleanAt(r1159, ["summary", "rowOwnerProvidedValuesStored"]) === false
    && readBooleanAt(r1159, ["summary", "rowParsingPerformedByR1159"]) === false
    && readBooleanAt(r1159, ["productDisplayAuthorized"]) === false;
}

function safeConfirmationTranscriptionProofPresent(r1160: unknown | null): boolean {
  return readStringAt(r1160, ["packetId"]) === INPUTS.r1160.packetId
    && readStringAt(r1160, ["schemaVersion"]) === INPUTS.r1160.schemaVersion
    && readStringAt(r1160, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(r1160, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(r1160, ["artifactBoundary", "answerSheetValuesStored"]) === false
    && readBooleanAt(r1160, ["artifactBoundary", "availabilityConfirmationPathStored"]) === false
    && readBooleanAt(r1160, ["artifactBoundary", "confirmationValuesStoredByR1160"]) === false
    && readBooleanAt(r1160, ["artifactBoundary", "featureValuesStored"]) === false
    && readBooleanAt(r1160, ["artifactBoundary", "fileNamesStored"]) === false
    && readBooleanAt(r1160, ["artifactBoundary", "headerValuesStored"]) === false
    && readBooleanAt(r1160, ["artifactBoundary", "localPathsStored"]) === false
    && readBooleanAt(r1160, ["artifactBoundary", "privateConfigValuesStored"]) === false
    && readBooleanAt(r1160, ["artifactBoundary", "privateFieldRefValuesStored"]) === false
    && readBooleanAt(r1160, ["artifactBoundary", "privateFieldRefsStored"]) === false
    && readBooleanAt(r1160, ["artifactBoundary", "privateTableRefValuesStored"]) === false
    && readBooleanAt(r1160, ["artifactBoundary", "privateTableRefsStored"]) === false
    && readBooleanAt(r1160, ["artifactBoundary", "recommendationClaimsIncluded"]) === false
    && readBooleanAt(r1160, ["artifactBoundary", "rowLevelDataAcceptedByR1160"]) === false
    && readBooleanAt(r1160, ["artifactBoundary", "rowOwnerProvidedValuesStored"]) === false
    && readBooleanAt(r1160, ["artifactBoundary", "rowParsingPerformedByR1160"]) === false
    && readBooleanAt(r1160, ["artifactBoundary", "sourceFileNamesStored"]) === false
    && readBooleanAt(r1160, ["artifactBoundary", "sourceVariableNamesStored"]) === false
    && readBooleanAt(r1160, ["artifactBoundary", "transcribedConfirmationPersisted"]) === false
    && readStringAt(r1160, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(r1160, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && readStringAt(r1160, ["summary", "conclusion"])
      === "r1159_feature_only_safe_confirmation_transcription_ready_non_evidence"
    && readStringAt(r1160, ["summary", "nextAction"])
      === "row_owner_confirm_r1150_feature_only_safe_availability_from_r1160_transcription_proof"
    && readBooleanAt(r1160, ["summary", "r1159AnswerSheetReadyForRowOwner"]) === true
    && readNumberAt(r1160, ["summary", "exactSafeTranscriptionStepCount"])
      === REQUIRED_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length
    && readBooleanAt(r1160, ["summary", "featureOnlyTemplateReady"]) === true
    && readBooleanAt(r1160, ["summary", "hypotheticalTranscriptionWouldBeFeatureOnlyReady"]) === true
    && readBooleanAt(r1160, ["summary", "transcriptionProofReadyForRowOwnerConfirmation"]) === true
    && readBooleanAt(r1160, ["summary", "rowOwnerConfirmationStillRequired"]) === true
    && exactStringSet(
      readStringArrayAt(r1160, ["summary", "minimumFeaturePairRequired"]),
      REQUIRED_FEATURE_ONLY_PAIR_FAMILY_IDS,
    )
    && exactStringSet(
      readStringArrayAt(r1160, ["summary", "optionalAddOnFamilyIds"]),
      REQUIRED_R1158_OPTIONAL_ADD_ON_FAMILY_IDS,
    )
    && exactStringSet(
      readStringArrayAt(r1160, ["summary", "requiredChecklistIds"]),
      REQUIRED_R1158_FEATURE_ONLY_CHECKLIST_IDS,
    )
    && exactStringSet(
      readStringArrayAt(r1160, ["summary", "requiredInputKindIds"]),
      REQUIRED_R1158_INPUT_KIND_IDS,
    )
    && readBooleanAt(r1160, ["summary", "confirmationValuesStoredByR1160"]) === false
    && readBooleanAt(r1160, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(r1160, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(r1160, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(r1160, ["summary", "rowLevelDataAcceptedByR1160"]) === false
    && readBooleanAt(r1160, ["summary", "rowOwnerProvidedValuesStored"]) === false
    && readBooleanAt(r1160, ["summary", "rowParsingPerformedByR1160"]) === false
    && readBooleanAt(r1160, ["productDisplayAuthorized"]) === false;
}

function safeConfirmationMaterializerPresent(r1161: unknown | null): boolean {
  const conclusion = readStringAt(r1161, ["summary", "conclusion"]);
  const nextAction = readStringAt(r1161, ["summary", "nextAction"]);
  const artifactWritten = readBooleanAt(r1161, ["summary", "safeConfirmationArtifactWritten"]);
  return readStringAt(r1161, ["packetId"]) === INPUTS.r1161.packetId
    && readStringAt(r1161, ["schemaVersion"]) === INPUTS.r1161.schemaVersion
    && readStringAt(r1161, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(r1161, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(r1161, ["artifactBoundary", "confirmationArtifactLocalPathStored"]) === false
    && readBooleanAt(r1161, ["artifactBoundary", "confirmationValuesStoredInR1161Packet"]) === false
    && readBooleanAt(r1161, ["artifactBoundary", "fileNamesStored"]) === false
    && readBooleanAt(r1161, ["artifactBoundary", "headerValuesStored"]) === false
    && readBooleanAt(r1161, ["artifactBoundary", "localPathsStored"]) === false
    && readBooleanAt(r1161, ["artifactBoundary", "privateConfigValuesStored"]) === false
    && readBooleanAt(r1161, ["artifactBoundary", "privateFieldRefValuesStored"]) === false
    && readBooleanAt(r1161, ["artifactBoundary", "privateFieldRefsStored"]) === false
    && readBooleanAt(r1161, ["artifactBoundary", "privateTableRefValuesStored"]) === false
    && readBooleanAt(r1161, ["artifactBoundary", "privateTableRefsStored"]) === false
    && readBooleanAt(r1161, ["artifactBoundary", "recommendationClaimsIncluded"]) === false
    && readBooleanAt(r1161, ["artifactBoundary", "rowLevelDataAcceptedByR1161"]) === false
    && readBooleanAt(r1161, ["artifactBoundary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(r1161, ["artifactBoundary", "rowParsingPerformedByR1161"]) === false
    && readBooleanAt(r1161, ["artifactBoundary", "safeConfirmationArtifactWrittenOnlyAfterExplicitAssertion"]) === true
    && readBooleanAt(r1161, ["artifactBoundary", "sourceFileNamesStored"]) === false
    && readBooleanAt(r1161, ["artifactBoundary", "sourceVariableNamesStored"]) === false
    && readStringAt(r1161, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(r1161, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && (
      conclusion === "feature_only_safe_availability_confirmation_materializer_waiting_on_explicit_row_owner_confirmation"
      || conclusion === "feature_only_safe_availability_confirmation_materialized"
    )
    && (
      nextAction === "rerun_r1161_with_row_owner_feature_only_confirmation_assertion"
      || nextAction === "run_r1150_intake_with_r1161_confirmed_feature_only_safe_availability_confirmation"
    )
    && readBooleanAt(r1161, ["summary", "r1160ProofReadyForRowOwnerConfirmation"]) === true
    && readBooleanAt(r1161, ["summary", "featureOnlyTemplateReady"]) === true
    && readNumberAt(r1161, ["summary", "safeMaterializedFieldCount"])
      === (artifactWritten === true ? REQUIRED_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length : 0)
    && exactStringSet(
      readStringArrayAt(r1161, ["summary", "minimumFeaturePairRequired"]),
      REQUIRED_FEATURE_ONLY_PAIR_FAMILY_IDS,
    )
    && exactStringSet(
      readStringArrayAt(r1161, ["summary", "optionalAddOnFamilyIds"]),
      REQUIRED_R1158_OPTIONAL_ADD_ON_FAMILY_IDS,
    )
    && readBooleanAt(r1161, ["summary", "confirmationValuesStoredInR1161Packet"]) === false
    && readBooleanAt(r1161, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(r1161, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(r1161, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(r1161, ["summary", "rowLevelDataAcceptedByR1161"]) === false
    && readBooleanAt(r1161, ["summary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(r1161, ["summary", "rowParsingPerformedByR1161"]) === false
    && readBooleanAt(r1161, ["productDisplayAuthorized"]) === false;
}

function safeConfirmationAssertionHandoffPresent(r1162: unknown | null): boolean {
  const conclusion = readStringAt(r1162, ["summary", "conclusion"]);
  const nextAction = readStringAt(r1162, ["summary", "nextAction"]);
  return readStringAt(r1162, ["packetId"]) === INPUTS.r1162.packetId
    && readStringAt(r1162, ["schemaVersion"]) === INPUTS.r1162.schemaVersion
    && readStringAt(r1162, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(r1162, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(r1162, ["artifactBoundary", "confirmationValuesStoredByR1162"]) === false
    && readBooleanAt(r1162, ["artifactBoundary", "fileNamesStored"]) === false
    && readBooleanAt(r1162, ["artifactBoundary", "headerValuesStored"]) === false
    && readBooleanAt(r1162, ["artifactBoundary", "localPathsStored"]) === false
    && readBooleanAt(r1162, ["artifactBoundary", "privateConfigValuesStored"]) === false
    && readBooleanAt(r1162, ["artifactBoundary", "privateFieldRefValuesStored"]) === false
    && readBooleanAt(r1162, ["artifactBoundary", "privateFieldRefsStored"]) === false
    && readBooleanAt(r1162, ["artifactBoundary", "privateTableRefValuesStored"]) === false
    && readBooleanAt(r1162, ["artifactBoundary", "privateTableRefsStored"]) === false
    && readBooleanAt(r1162, ["artifactBoundary", "rowLevelDataAcceptedByR1162"]) === false
    && readBooleanAt(r1162, ["artifactBoundary", "rowOwnerAssertionInferredByR1162"]) === false
    && readBooleanAt(r1162, ["artifactBoundary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(r1162, ["artifactBoundary", "rowParsingPerformedByR1162"]) === false
    && readBooleanAt(r1162, ["artifactBoundary", "sourceFileNamesStored"]) === false
    && readBooleanAt(r1162, ["artifactBoundary", "sourceVariableNamesStored"]) === false
    && readStringAt(r1162, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(r1162, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && (
      conclusion === "feature_only_safe_confirmation_assertion_handoff_ready_for_row_owner_assertion"
      || conclusion === "feature_only_safe_confirmation_assertion_handoff_satisfied"
      || conclusion === "feature_only_safe_confirmation_assertion_handoff_waiting_on_r1161_materializer"
    )
    && (
      nextAction === "refresh_r1161_safe_confirmation_materializer"
      || nextAction === "row_owner_assert_feature_only_lab_wearable_availability_then_run_r1161_materializer"
      || nextAction === "run_r1150_intake_with_r1161_confirmed_feature_only_safe_availability_confirmation"
    )
    && readStringAt(r1162, ["summary", "handoffCommand"]) === R1162_ASSERTION_HANDOFF_COMMAND
    && readStringAt(r1162, ["summary", "materializerCommand"]) === R1161_MATERIALIZER_COMMAND
    && exactStringSet(
      readStringArrayAt(r1162, ["summary", "minimumFeaturePairRequired"]),
      REQUIRED_FEATURE_ONLY_PAIR_FAMILY_IDS,
    )
    && exactStringSet(
      readStringArrayAt(r1162, ["summary", "requiredInputKindIds"]),
      REQUIRED_R1158_INPUT_KIND_IDS,
    )
    && exactStringSet(
      readStringArrayAt(r1162, ["summary", "requiredChecklistIds"]),
      REQUIRED_R1158_FEATURE_ONLY_CHECKLIST_IDS,
    )
    && readBooleanAt(r1162, ["summary", "confirmationValuesStoredByR1162"]) === false
    && readBooleanAt(r1162, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(r1162, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(r1162, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(r1162, ["summary", "rowLevelDataAcceptedByR1162"]) === false
    && readBooleanAt(r1162, ["summary", "rowOwnerAssertionInferredByR1162"]) === false
    && readBooleanAt(r1162, ["summary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(r1162, ["summary", "rowParsingPerformedByR1162"]) === false
    && readBooleanAt(r1162, ["productDisplayAuthorized"]) === false;
}

function safeAvailabilityActionPacketGuardPresent(r1154: unknown | null): boolean {
  return readStringAt(r1154, ["packetId"]) === INPUTS.r1154.packetId
    && readStringAt(r1154, ["schemaVersion"]) === INPUTS.r1154.schemaVersion
    && readStringAt(r1154, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(r1154, ["artifactBoundary", "aggregateOnly"]) === true
    && REQUIRED_R1154_FALSE_BOUNDARY_FLAGS.every((flag) =>
      readBooleanAt(r1154, ["artifactBoundary", flag]) === false
    )
    && readStringAt(r1154, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(r1154, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && readStringAt(r1154, ["summary", "fillableTemplateArtifact"]) !== null
    && readStringAt(r1154, ["summary", "featureOnlyFillableTemplateArtifact"]) !== null
    && readStringAt(r1154, ["summary", "featureOnlyQuickstartArtifact"]) !== null
    && readStringAt(r1154, ["safeAvailabilityActionPacket", "featureOnlyQuickstartArtifact"]) !== null
    && safeAvailabilityActionPacketFieldEditPathsPresent(r1154)
    && exactStringSet(
      readStringArrayAt(r1154, ["summary", "minimumFeaturePairRequired"]),
      REQUIRED_FEATURE_ONLY_PAIR_FAMILY_IDS,
    )
    && includesAll(
      readStringArrayAt(r1154, ["summary", "expectedRouteIds"]),
      REQUIRED_ROUTE_METRIC_IDS,
    )
    && readStringAt(r1154, ["summary", "preferredRecipeId"]) === "lab_plus_wearable_minimum_manifest"
    && readBooleanAt(r1154, ["summary", "outcomeLinkageRequiredForFeatureOnlyContext"]) === false
    && readBooleanAt(r1154, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(r1154, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(r1154, ["summary", "rowLevelDataAcceptedByR1154"]) === false
    && readBooleanAt(r1154, ["summary", "rowParsingPerformedByR1154"]) === false
    && readBooleanAt(r1154, ["productDisplayAuthorized"]) === false
    && readBooleanAt(r1154, ["safeAvailabilityActionPacket", "privateDetailsStored"]) === false
    && readBooleanAt(r1154, ["safeAvailabilityActionPacket", "rowLevelDataAcceptedByR1154"]) === false
    && readStringAt(r1154, ["summary", "nextAction"]) !== null;
}

function safeAvailabilityActionPacketFieldEditPathsPresent(r1154: unknown | null): boolean {
  return readNumberAt(r1154, ["summary", "featureOnlyQuickstartSafeFieldEditCount"])
    === REQUIRED_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length
    && readNumberAt(r1154, [
      "safeAvailabilityActionPacket",
      "featureOnlyQuickstartSafeFieldEditCount",
    ]) === REQUIRED_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length
    && exactStringSet(
      readStringArrayAt(r1154, ["summary", "featureOnlyQuickstartSafeFieldEditPaths"]),
      REQUIRED_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS,
    )
    && exactStringSet(
      readStringArrayAt(r1154, [
        "safeAvailabilityActionPacket",
        "featureOnlyQuickstartSafeFieldEditPaths",
      ]),
      REQUIRED_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS,
    );
}

function ordinarySubmitterSafeCompletionChecklistPresent(inputs: Record<InputKey, unknown | null>): boolean {
  return exactStringSet(
    readStringArrayAt(inputs.r1154, ["summary", "ordinarySubmitterSafeCompletionChecklistItemIds"]),
    REQUIRED_ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS,
  )
    && exactStringSet(
      readStringArrayAt(
        inputs.r1076,
        ["summary", "consumerAverageSubmitterSafeAvailabilityActionPacketChecklistItemIds"],
      ),
      REQUIRED_ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS,
    )
    && safeCompletionChecklistDetailsPresent(inputs.r1154);
}

function ordinarySubmitterSafeCompletionModesPresent(inputs: Record<InputKey, unknown | null>): boolean {
  return exactStringSet(
    readStringArrayAt(inputs.r1154, ["summary", "ordinarySubmitterCompletionModeIds"]),
    REQUIRED_ORDINARY_SUBMITTER_COMPLETION_MODE_IDS,
  )
    && exactStringSet(
      readStringArrayAt(inputs.r1076, [
        "summary",
        "consumerAverageSubmitterSafeAvailabilityCompletionModeIds",
      ]),
      REQUIRED_ORDINARY_SUBMITTER_COMPLETION_MODE_IDS,
    )
    && safeCompletionModeDetailsPresent(inputs.r1154);
}

function safeCompletionModeDetailsPresent(r1154: unknown | null): boolean {
  const items = readRecordArrayAt(r1154, [
    "safeAvailabilityActionPacket",
    "ordinarySubmitterCompletionModes",
  ]);
  return exactStringSet(
    items.map((item) => readStringAt(item, ["modeId"])).filter((item): item is string => item !== null),
    REQUIRED_ORDINARY_SUBMITTER_COMPLETION_MODE_IDS,
  )
    && items.every((item) =>
      readBooleanAt(item, ["privateDetailsStored"]) === false
      && readBooleanAt(item, ["rowLevelDataAccepted"]) === false
      && readBooleanAt(item, ["outcomeLinkageRequired"]) !== null
      && readBooleanAt(item, ["modelEvidenceCandidate"]) !== null
      && readStringAt(item, ["modeType"]) !== null
      && readStringAt(item, ["nextActionAfterR1150"]) !== null
      && readStringAt(item, ["safeCompletionMeaning"]) !== null
      && readStringArrayAt(item, ["requiredSourceFamilyIds"]).length > 0
      && readStringArrayAt(item, ["requiredAttestationKeys"]).length > 0
      && readStringArrayAt(item, ["requiredChecklistIds"]).length > 0
      && readStringArrayAt(item, ["requiredAggregateReadinessFactIds"]).length > 0
    );
}

function safeCompletionChecklistDetailsPresent(r1154: unknown | null): boolean {
  const items = readRecordArrayAt(r1154, [
    "safeAvailabilityActionPacket",
    "ordinarySubmitterSafeCompletionChecklist",
  ]);
  return exactStringSet(
    items.map((item) => readStringAt(item, ["checkId"])).filter((item): item is string => item !== null),
    REQUIRED_ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS,
  )
    && items.every((item) =>
      readBooleanAt(item, ["privateDetailsStored"]) === false
      && readBooleanAt(item, ["requiredForFeatureOnlyPreferredPair"]) !== null
      && readBooleanAt(item, ["requiredForOutcomeLinkedRecipe"]) !== null
      && readStringAt(item, ["safeCompletionMeaning"]) !== null
    );
}

function safeAvailabilityActionPacketNextAction(r1154: unknown | null): AuditNextAction | null {
  const nextAction = readStringAt(r1154, ["summary", "nextAction"]);
  switch (nextAction) {
    case "complete_safe_availability_confirmation_template":
    case "fill_feature_only_coverage_context_template":
    case "fill_safe_availability_confirmation_from_template":
    case "refresh_r1149_submitter_kit":
    case "run_r1144_recipe_readiness_chain_with_confirmed_availability":
    case "run_r1150_safe_availability_confirmation_intake":
    case "run_r1153_feature_only_chain_with_safe_availability":
    case "rerun_safe_availability_confirmation_with_valid_json_object":
      return nextAction;
    default:
      return null;
  }
}

function safeConfirmationAnswerSheetNextAction(r1159: unknown | null): AuditNextAction | null {
  const nextAction = readStringAt(r1159, ["summary", "nextAction"]);
  return nextAction === "fill_r1150_feature_only_safe_confirmation_from_r1159_answer_sheet"
    ? nextAction
    : null;
}

function safeConfirmationTranscriptionProofNextAction(r1160: unknown | null): AuditNextAction | null {
  const nextAction = readStringAt(r1160, ["summary", "nextAction"]);
  return nextAction === "row_owner_confirm_r1150_feature_only_safe_availability_from_r1160_transcription_proof"
    ? nextAction
    : null;
}

function safeConfirmationMaterializerNextAction(r1161: unknown | null): AuditNextAction | null {
  const nextAction = readStringAt(r1161, ["summary", "nextAction"]);
  return nextAction === "rerun_r1161_with_row_owner_feature_only_confirmation_assertion"
    || nextAction === "run_r1150_intake_with_r1161_confirmed_feature_only_safe_availability_confirmation"
    ? nextAction
    : null;
}

function safeConfirmationAssertionHandoffNextAction(r1162: unknown | null): AuditNextAction | null {
  const nextAction = readStringAt(r1162, ["summary", "nextAction"]);
  return nextAction === "row_owner_assert_feature_only_lab_wearable_availability_then_run_r1161_materializer"
    || nextAction === "run_r1150_intake_with_r1161_confirmed_feature_only_safe_availability_confirmation"
    ? nextAction
    : null;
}

function safeConfirmationToResearchRunnerNextAction(r1163: unknown | null): AuditNextAction | null {
  if (!inputMatchesExpected("r1163", r1163)) return null;
  if (readStringAt(r1163, ["runner", "runnerCommand"]) !== R1163_ASSERTION_TO_RESEARCH_RUNNER_COMMAND) return null;
  const nextAction = readStringAt(r1163, ["summary", "nextAction"]);
  return nextAction === "row_owner_assert_feature_only_lab_wearable_availability_then_run_r1163_runner"
    || nextAction === "use_feature_only_coverage_context_for_research_planning_only"
    || nextAction === "fill_safe_availability_confirmation_from_template"
    || nextAction === "fill_feature_only_coverage_context_template"
    ? nextAction
    : null;
}

function featureOnlySafeAssertionRunnerNextAction(r1165: unknown | null): AuditNextAction | null {
  if (!featureOnlySafeAssertionRunnerPresent(r1165)) return null;
  const nextAction = readStringAt(r1165, ["summary", "nextAction"]);
  return nextAction === "fill_r1165_row_owner_feature_only_safe_assertion_template"
    || nextAction === "rerun_r1165_with_valid_safe_assertion"
    || nextAction === "run_r1164_feature_only_research_handoff"
    || nextAction === "use_feature_only_coverage_context_for_research_planning_only"
    ? nextAction
    : null;
}

function featureOnlySafeAssertionMaterializerNextAction(r1172: unknown | null): AuditNextAction | null {
  if (!featureOnlySafeAssertionMaterializerPresent(r1172)) return null;
  const nextAction = readStringAt(r1172, ["summary", "nextAction"]);
  return nextAction === "rerun_r1172_with_row_owner_feature_only_safe_assertion_confirmation"
    || nextAction === "run_r1165_with_r1172_row_owner_safe_assertion"
    ? nextAction
    : null;
}

function featureOnlySafeAssertionAnswerSheetNextAction(r1173: unknown | null): AuditNextAction | null {
  if (!featureOnlySafeAssertionAnswerSheetPresent(r1173)) return null;
  const nextAction = readStringAt(r1173, ["summary", "nextAction"]);
  return nextAction === "rerun_r1172_with_row_owner_feature_only_safe_assertion_confirmation"
    ? nextAction
    : null;
}

function featureOnlySafeAssertionLiveChainNextAction(r1176: unknown | null): AuditNextAction | null {
  if (!featureOnlySafeAssertionLiveChainPresent(r1176)) return null;
  const nextAction = readStringAt(r1176, ["summary", "nextAction"]);
  return nextAction === "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation"
    ? nextAction
    : null;
}

function featureOnlySafeNextStepPacketPresent(r1174: unknown | null): boolean {
  const conclusion = readStringAt(r1174, ["summary", "conclusion"]);
  const nextAction = readStringAt(r1174, ["summary", "nextAction"]);
  const exposesR1176LiveChain =
    nextAction === "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation";
  return inputMatchesExpected("r1174", r1174)
    && readStringAt(r1174, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(r1174, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(r1174, ["artifactBoundary", "codebookTextStored"]) === false
    && readBooleanAt(r1174, ["artifactBoundary", "coefficientsStored"]) === false
    && readBooleanAt(r1174, ["artifactBoundary", "fileNamesStored"]) === false
    && readBooleanAt(r1174, ["artifactBoundary", "headerValuesStored"]) === false
    && readBooleanAt(r1174, ["artifactBoundary", "localPathsStored"]) === false
    && readBooleanAt(r1174, ["artifactBoundary", "modelEvidencePromotedByR1174"]) === false
    && readBooleanAt(r1174, ["artifactBoundary", "modelParametersStored"]) === false
    && readBooleanAt(r1174, ["artifactBoundary", "participantIdentifiersStored"]) === false
    && readBooleanAt(r1174, ["artifactBoundary", "participantIdentifiersWritten"]) === false
    && readBooleanAt(r1174, ["artifactBoundary", "predictionsStored"]) === false
    && readBooleanAt(r1174, ["artifactBoundary", "privateConfigValuesStored"]) === false
    && readBooleanAt(r1174, ["artifactBoundary", "privateDetailsStored"]) === false
    && readBooleanAt(r1174, ["artifactBoundary", "privateFieldRefValuesStored"]) === false
    && readBooleanAt(r1174, ["artifactBoundary", "privateFieldRefsStored"]) === false
    && readBooleanAt(r1174, ["artifactBoundary", "privateTableRefValuesStored"]) === false
    && readBooleanAt(r1174, ["artifactBoundary", "privateTableRefsStored"]) === false
    && readBooleanAt(r1174, ["artifactBoundary", "productDisplayAuthorized"]) === false
    && readBooleanAt(r1174, ["artifactBoundary", "rowLevelDataAcceptedByR1174"]) === false
    && readBooleanAt(r1174, ["artifactBoundary", "rowOwnerConfirmationInferredByR1174"]) === false
    && readBooleanAt(r1174, ["artifactBoundary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(r1174, ["artifactBoundary", "rowOwnerProvidedValuesStored"]) === false
    && readBooleanAt(r1174, ["artifactBoundary", "rowParsingPerformedByR1174"]) === false
    && readBooleanAt(r1174, ["artifactBoundary", "rowValuesStored"]) === false
    && readBooleanAt(r1174, ["artifactBoundary", "smallCellsStored"]) === false
    && readBooleanAt(r1174, ["artifactBoundary", "sourceBodiesStored"]) === false
    && readBooleanAt(r1174, ["artifactBoundary", "sourceFileNamesStored"]) === false
    && readBooleanAt(r1174, ["artifactBoundary", "sourceVariableNamesStored"]) === false
    && readStringAt(r1174, ["rowOwnerNextStepPacket", "packetRole"])
      === "current_blocker_packet_only_not_assertion_not_model_evidence"
    && readStringAt(r1174, ["rowOwnerNextStepPacket", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(r1174, ["rowOwnerNextStepPacket", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && readBooleanAt(r1174, ["rowOwnerNextStepPacket", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(r1174, ["rowOwnerNextStepPacket", "rowLevelDataAcceptedByR1174"]) === false
    && readBooleanAt(r1174, ["rowOwnerNextStepPacket", "rowOwnerProvidedValuesStored"]) === false
    && exactStringSet(
      readStringArrayAt(r1174, ["rowOwnerNextStepPacket", "allowedValueKindIds"]),
      SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
    )
    && exactStringSet(
      readStringArrayAt(r1174, ["rowOwnerNextStepPacket", "blockedContent"]),
      SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS,
    )
    && exactStringSet(
      readStringArrayAt(r1174, ["rowOwnerNextStepPacket", "minimumFeaturePairRequired"]),
      REQUIRED_FEATURE_ONLY_PAIR_FAMILY_IDS,
    )
    && exactStringSet(
      readStringArrayAt(r1174, ["rowOwnerNextStepPacket", "exactSafeFieldEditPaths"]),
      REQUIRED_FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS,
    )
    && readStringAt(r1174, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(r1174, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && (
      conclusion === "ordinary_safe_next_step_packet_ready_for_row_owner_r1172_confirmation"
      || conclusion === "ordinary_safe_next_step_packet_ready_for_row_owner_r1176_live_chain_confirmation"
      || conclusion === "ordinary_safe_next_step_packet_safe_assertion_materialized_non_evidence"
      || conclusion === "ordinary_safe_next_step_packet_waiting_on_r1145_completion_audit"
      || conclusion === "ordinary_safe_next_step_packet_waiting_on_r1172_materializer"
      || conclusion === "ordinary_safe_next_step_packet_waiting_on_r1173_answer_sheet"
    )
    && (
      nextAction === "refresh_r1145_completion_audit"
      || nextAction === "refresh_r1172_safe_assertion_materializer"
      || nextAction === "refresh_r1173_safe_assertion_answer_sheet"
      || nextAction === "rerun_r1172_with_row_owner_feature_only_safe_assertion_confirmation"
      || nextAction === "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation"
      || nextAction === "run_r1165_with_r1172_row_owner_safe_assertion"
    )
    && exactStringSet(readStringArrayAt(r1174, ["summary", "minimumFeaturePairRequired"]), REQUIRED_FEATURE_ONLY_PAIR_FAMILY_IDS)
    && exactStringSet(readStringArrayAt(r1174, ["summary", "requiredInputKindIds"]), REQUIRED_R1158_INPUT_KIND_IDS)
    && exactStringSet(
      readStringArrayAt(r1174, ["summary", "requiredAssertionChecklistIds"]),
      REQUIRED_SAFE_ASSERTION_CHECKLIST_IDS,
    )
    && exactStringSet(
      readStringArrayAt(r1174, ["summary", "allowedValueKindIds"]),
      SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
    )
    && exactStringSet(
      readStringArrayAt(r1174, ["summary", "blockedContentIds"]),
      SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS,
    )
    && readNumberAt(r1174, ["summary", "exactSafeFieldEditCount"])
      === REQUIRED_FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS.length
    && exactStringSet(
      readStringArrayAt(r1174, ["summary", "safeFieldEditPaths"]),
      REQUIRED_FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS,
    )
    && readBooleanAt(r1174, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(r1174, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(r1174, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(r1174, ["summary", "rowLevelDataAcceptedByR1174"]) === false
    && readBooleanAt(r1174, ["summary", "rowOwnerConfirmationInferredByR1174"]) === false
    && readBooleanAt(r1174, ["summary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(r1174, ["summary", "rowOwnerProvidedValuesStored"]) === false
    && readBooleanAt(r1174, ["summary", "rowParsingPerformedByR1174"]) === false
    && (!exposesR1176LiveChain || (
      readBooleanAt(r1174, ["summary", "readyForRowOwnerR1176LiveChainConfirmation"]) === true
      && readStringAt(r1174, ["summary", "r1176LiveChainCommand"])
        === R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND
      && readBooleanAt(r1174, ["rowOwnerNextStepPacket", "readyForRowOwnerR1176LiveChainConfirmation"]) === true
      && readStringAt(r1174, ["rowOwnerNextStepPacket", "r1176LiveChainCommand"])
        === R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND
    ))
    && readBooleanAt(r1174, ["productDisplayAuthorized"]) === false;
}

function featureOnlySafeAssertionFillGuidePresent(r1167: unknown | null): boolean {
  return inputMatchesExpected("r1167", r1167)
    && readStringAt(r1167, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(r1167, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(r1167, ["artifactBoundary", "assertionValuesStoredByR1167"]) === false
    && readBooleanAt(r1167, ["artifactBoundary", "fileNamesStored"]) === false
    && readBooleanAt(r1167, ["artifactBoundary", "headerValuesStored"]) === false
    && readBooleanAt(r1167, ["artifactBoundary", "localPathsStored"]) === false
    && readBooleanAt(r1167, ["artifactBoundary", "modelEvidencePromotedByR1167"]) === false
    && readBooleanAt(r1167, ["artifactBoundary", "privateDetailsStored"]) === false
    && readBooleanAt(r1167, ["artifactBoundary", "rowLevelDataAcceptedByR1167"]) === false
    && readBooleanAt(r1167, ["artifactBoundary", "rowOwnerAssertionInferredByR1167"]) === false
    && readBooleanAt(r1167, ["artifactBoundary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(r1167, ["artifactBoundary", "rowParsingPerformedByR1167"]) === false
    && readStringAt(r1167, ["fillGuide", "commands", "fillGuideCommand"]) === R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND
    && readStringAt(r1167, ["fillGuide", "commands", "safeAssertionRunnerCommand"])
      === R1165_SAFE_ASSERTION_RUNNER_COMMAND
    && readStringAt(r1167, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(r1167, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && readStringAt(r1167, ["summary", "conclusion"]) === "ordinary_feature_only_safe_assertion_fill_guide_ready"
    && readStringAt(r1167, ["summary", "nextAction"]) === "fill_r1165_row_owner_feature_only_safe_assertion_template"
    && readBooleanAt(r1167, ["summary", "guideReadyForRowOwnerFill"]) === true
    && exactStringSet(readStringArrayAt(r1167, ["summary", "minimumFeaturePairRequired"]), REQUIRED_FEATURE_ONLY_PAIR_FAMILY_IDS)
    && exactStringSet(
      readStringArrayAt(r1167, ["summary", "optionalAddOnFamilyIds"]),
      REQUIRED_R1158_OPTIONAL_ADD_ON_FAMILY_IDS,
    )
    && exactStringSet(readStringArrayAt(r1167, ["summary", "requiredInputKindIds"]), REQUIRED_R1158_INPUT_KIND_IDS)
    && readNumberAt(r1167, ["summary", "safeFieldEditCount"])
      === REQUIRED_FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS.length
    && exactStringSet(
      readStringArrayAt(r1167, ["summary", "safeFieldEditPaths"]),
      REQUIRED_FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS,
    )
    && readBooleanAt(r1167, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(r1167, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(r1167, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(r1167, ["summary", "rowLevelDataAcceptedByR1167"]) === false
    && readBooleanAt(r1167, ["summary", "rowOwnerAssertionInferredByR1167"]) === false
    && readBooleanAt(r1167, ["summary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(r1167, ["summary", "rowParsingPerformedByR1167"]) === false
    && readBooleanAt(r1167, ["productDisplayAuthorized"]) === false;
}

function featureOnlySafeAssertionRunnerPresent(r1165: unknown | null): boolean {
  return inputMatchesExpected("r1165", r1165)
    && readStringAt(r1165, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(r1165, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(r1165, ["artifactBoundary", "assertionValuesStoredByR1165"]) === false
    && readBooleanAt(r1165, ["artifactBoundary", "fileNamesStored"]) === false
    && readBooleanAt(r1165, ["artifactBoundary", "headerValuesStored"]) === false
    && readBooleanAt(r1165, ["artifactBoundary", "localPathsStored"]) === false
    && readBooleanAt(r1165, ["artifactBoundary", "modelEvidencePromotedByR1165"]) === false
    && readBooleanAt(r1165, ["artifactBoundary", "privateDetailsStored"]) === false
    && readBooleanAt(r1165, ["artifactBoundary", "rowLevelDataAcceptedByR1165"]) === false
    && readBooleanAt(r1165, ["artifactBoundary", "rowOwnerAssertionInferredByR1165"]) === false
    && readBooleanAt(r1165, ["artifactBoundary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(r1165, ["artifactBoundary", "rowParsingPerformedByR1165"]) === false
    && readStringAt(r1165, ["assertionRunner", "commands", "safeAssertionRunnerCommand"])
      === R1165_SAFE_ASSERTION_RUNNER_COMMAND
    && exactStringSet(
      readStringArrayAt(r1165, ["summary", "minimumFeaturePairRequired"]),
      REQUIRED_FEATURE_ONLY_PAIR_FAMILY_IDS,
    )
    && exactStringSet(
      readStringArrayAt(r1165, ["summary", "optionalAddOnFamilyIds"]),
      REQUIRED_R1158_OPTIONAL_ADD_ON_FAMILY_IDS,
    )
    && exactStringSet(readStringArrayAt(r1165, ["summary", "requiredInputKindIds"]), REQUIRED_R1158_INPUT_KIND_IDS)
    && readBooleanAt(r1165, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(r1165, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(r1165, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(r1165, ["summary", "rowLevelDataAcceptedByR1165"]) === false
    && readBooleanAt(r1165, ["summary", "rowOwnerAssertionInferredByR1165"]) === false
    && readBooleanAt(r1165, ["summary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(r1165, ["summary", "rowParsingPerformedByR1165"]) === false
    && readBooleanAt(r1165, ["productDisplayAuthorized"]) === false;
}

function featureOnlySafeAssertionAnswerSheetPresent(r1173: unknown | null): boolean {
  return inputMatchesExpected("r1173", r1173)
    && readStringAt(r1173, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(r1173, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(r1173, ["artifactBoundary", "answerSheetTemplatePathStored"]) === false
    && readBooleanAt(r1173, ["artifactBoundary", "assertionValuesStoredByR1173"]) === false
    && readBooleanAt(r1173, ["artifactBoundary", "fileNamesStored"]) === false
    && readBooleanAt(r1173, ["artifactBoundary", "headerValuesStored"]) === false
    && readBooleanAt(r1173, ["artifactBoundary", "localPathsStored"]) === false
    && readBooleanAt(r1173, ["artifactBoundary", "modelEvidencePromotedByR1173"]) === false
    && readBooleanAt(r1173, ["artifactBoundary", "privateDetailsStored"]) === false
    && readBooleanAt(r1173, ["artifactBoundary", "rowLevelDataAcceptedByR1173"]) === false
    && readBooleanAt(r1173, ["artifactBoundary", "rowOwnerAssertionInferredByR1173"]) === false
    && readBooleanAt(r1173, ["artifactBoundary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(r1173, ["artifactBoundary", "rowOwnerProvidedValuesStored"]) === false
    && readBooleanAt(r1173, ["artifactBoundary", "rowParsingPerformedByR1173"]) === false
    && readStringAt(r1173, ["rowOwnerAnswerSheet", "commands", "safeAssertionAnswerSheetCommand"])
      === R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND
    && readStringAt(r1173, ["rowOwnerAnswerSheet", "commands", "safeAssertionFillGuideCommand"])
      === R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND
    && readStringAt(r1173, ["rowOwnerAnswerSheet", "commands", "safeAssertionMaterializerCommand"])
      === R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND
    && exactStringSet(
      readStringArrayAt(r1173, ["rowOwnerAnswerSheet", "allowedValueKindIds"]),
      SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
    )
    && exactStringSet(
      readStringArrayAt(r1173, ["rowOwnerAnswerSheet", "blockedAssertionContent"]),
      SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS,
    )
    && readBooleanAt(r1173, ["rowOwnerAnswerSheet", "materializerExplicitConfirmationRequired"]) === true
    && readBooleanAt(r1173, ["rowOwnerAnswerSheet", "readyForR1172MaterializerConfirmation"]) === true
    && readBooleanAt(r1173, ["rowOwnerAnswerSheet", "rowLevelDataAcceptedByR1173"]) === false
    && readBooleanAt(r1173, ["rowOwnerAnswerSheet", "rowOwnerProvidedValuesStored"]) === false
    && readStringAt(r1173, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(r1173, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && readStringAt(r1173, ["summary", "conclusion"]) === "ordinary_safe_assertion_answer_sheet_ready_non_evidence"
    && readStringAt(r1173, ["summary", "nextAction"])
      === "rerun_r1172_with_row_owner_feature_only_safe_assertion_confirmation"
    && readBooleanAt(r1173, ["summary", "answerSheetReadyForRowOwner"]) === true
    && readBooleanAt(r1173, ["summary", "fillGuideReadyForRowOwnerFill"]) === true
    && readBooleanAt(r1173, ["summary", "materializerReady"]) === true
    && readBooleanAt(r1173, ["summary", "materializerExplicitConfirmationRequired"]) === true
    && exactStringSet(
      readStringArrayAt(r1173, ["summary", "allowedValueKindIds"]),
      SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
    )
    && exactStringSet(
      readStringArrayAt(r1173, ["summary", "blockedAssertionContentIds"]),
      SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS,
    )
    && exactStringSet(readStringArrayAt(r1173, ["summary", "minimumFeaturePairRequired"]), REQUIRED_FEATURE_ONLY_PAIR_FAMILY_IDS)
    && exactStringSet(readStringArrayAt(r1173, ["summary", "requiredInputKindIds"]), REQUIRED_R1158_INPUT_KIND_IDS)
    && exactStringSet(
      readStringArrayAt(r1173, ["summary", "requiredAssertionChecklistIds"]),
      REQUIRED_SAFE_ASSERTION_CHECKLIST_IDS,
    )
    && readNumberAt(r1173, ["summary", "exactSafeAnswerCount"])
      === REQUIRED_FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS.length
    && readNumberAt(r1173, ["summary", "safeFieldEditCount"])
      === REQUIRED_FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS.length
    && exactStringSet(
      readStringArrayAt(r1173, ["summary", "safeFieldEditPaths"]),
      REQUIRED_FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS,
    )
    && readBooleanAt(r1173, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(r1173, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(r1173, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(r1173, ["summary", "rowLevelDataAcceptedByR1173"]) === false
    && readBooleanAt(r1173, ["summary", "rowOwnerAssertionInferredByR1173"]) === false
    && readBooleanAt(r1173, ["summary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(r1173, ["summary", "rowOwnerProvidedValuesStored"]) === false
    && readBooleanAt(r1173, ["summary", "rowParsingPerformedByR1173"]) === false
    && readBooleanAt(r1173, ["productDisplayAuthorized"]) === false;
}

function featureOnlySafeAssertionMaterializerPresent(r1172: unknown | null): boolean {
  const conclusion = readStringAt(r1172, ["summary", "conclusion"]);
  const nextAction = readStringAt(r1172, ["summary", "nextAction"]);
  const safeFieldEditCount = readNumberAt(r1172, ["summary", "safeFieldEditCount"]);
  return inputMatchesExpected("r1172", r1172)
    && readStringAt(r1172, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(r1172, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(r1172, ["artifactBoundary", "assertionArtifactLocalPathStored"]) === false
    && readBooleanAt(r1172, ["artifactBoundary", "assertionFileWrittenOnlyAfterExplicitAssertion"]) === true
    && readBooleanAt(r1172, ["artifactBoundary", "assertionValuesStoredInR1172Packet"]) === false
    && readBooleanAt(r1172, ["artifactBoundary", "fileNamesStored"]) === false
    && readBooleanAt(r1172, ["artifactBoundary", "headerValuesStored"]) === false
    && readBooleanAt(r1172, ["artifactBoundary", "localPathsStored"]) === false
    && readBooleanAt(r1172, ["artifactBoundary", "modelEvidencePromotedByR1172"]) === false
    && readBooleanAt(r1172, ["artifactBoundary", "privateDetailsStored"]) === false
    && readBooleanAt(r1172, ["artifactBoundary", "rowLevelDataAcceptedByR1172"]) === false
    && readBooleanAt(r1172, ["artifactBoundary", "rowOwnerAssertionInferredByR1172"]) === false
    && readBooleanAt(r1172, ["artifactBoundary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(r1172, ["artifactBoundary", "rowParsingPerformedByR1172"]) === false
    && readStringAt(r1172, ["materializer", "materializerCommand"]) === R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND
    && readStringAt(r1172, ["materializer", "r1165RunnerCommand"]) === R1165_SAFE_ASSERTION_RUNNER_COMMAND
    && readStringAt(r1172, ["materializer", "r1167FillGuideCommand"]) === R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND
    && exactStringSet(
      readStringArrayAt(r1172, ["materializer", "allowedValueKindIds"]),
      SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
    )
    && exactStringSet(
      readStringArrayAt(r1172, ["materializer", "blockedContentIds"]),
      SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS,
    )
    && readStringAt(r1172, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(r1172, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && (
      conclusion === "ordinary_consumer_safe_assertion_materialized"
      || conclusion === "ordinary_consumer_safe_assertion_materializer_waiting_on_explicit_row_owner_assertion"
      || conclusion === "ordinary_consumer_safe_assertion_materializer_waiting_on_r1165_runner"
      || conclusion === "ordinary_consumer_safe_assertion_materializer_waiting_on_r1165_template"
      || conclusion === "ordinary_consumer_safe_assertion_materializer_waiting_on_r1167_fill_guide"
    )
    && (
      nextAction === "refresh_r1165_safe_assertion_runner"
      || nextAction === "refresh_r1165_safe_assertion_template"
      || nextAction === "refresh_r1167_safe_assertion_fill_guide"
      || nextAction === "rerun_r1172_with_row_owner_feature_only_safe_assertion_confirmation"
      || nextAction === "run_r1165_with_r1172_row_owner_safe_assertion"
    )
    && exactStringSet(readStringArrayAt(r1172, ["summary", "minimumFeaturePairRequired"]), REQUIRED_FEATURE_ONLY_PAIR_FAMILY_IDS)
    && exactStringSet(readStringArrayAt(r1172, ["summary", "requiredInputKindIds"]), REQUIRED_R1158_INPUT_KIND_IDS)
    && exactStringSet(
      readStringArrayAt(r1172, ["summary", "allowedValueKindIds"]),
      SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
    )
    && exactStringSet(
      readStringArrayAt(r1172, ["summary", "blockedContentIds"]),
      SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS,
    )
    && (safeFieldEditCount === 0 || safeFieldEditCount === REQUIRED_FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS.length)
    && exactStringSet(
      readStringArrayAt(r1172, ["summary", "safeFieldEditPaths"]),
      REQUIRED_FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS,
    )
    && readBooleanAt(r1172, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(r1172, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(r1172, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(r1172, ["summary", "rowLevelDataAcceptedByR1172"]) === false
    && readBooleanAt(r1172, ["summary", "rowOwnerAssertionInferredByR1172"]) === false
    && readBooleanAt(r1172, ["summary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(r1172, ["summary", "rowParsingPerformedByR1172"]) === false
    && readBooleanAt(r1172, ["summary", "safeAssertionArtifactLocalPathStored"]) === false
    && readBooleanAt(r1172, ["productDisplayAuthorized"]) === false;
}

function featureOnlySafeAssertionBridgeSmokePresent(r1175: unknown | null): boolean {
  const conclusion = readStringAt(r1175, ["summary", "conclusion"]);
  const nextAction = readStringAt(r1175, ["summary", "nextAction"]);
  return inputMatchesExpected("r1175", r1175)
    && readStringAt(r1175, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(r1175, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(r1175, ["artifactBoundary", "assertionFilePathStored"]) === false
    && readBooleanAt(r1175, ["artifactBoundary", "assertionValuesStoredByR1175"]) === false
    && readBooleanAt(r1175, ["artifactBoundary", "childOutputPathsStored"]) === false
    && readBooleanAt(r1175, ["artifactBoundary", "localPathsStored"]) === false
    && readBooleanAt(r1175, ["artifactBoundary", "materializedAssertionPathStored"]) === false
    && readBooleanAt(r1175, ["artifactBoundary", "modelEvidencePromotedByR1175"]) === false
    && readBooleanAt(r1175, ["artifactBoundary", "privateDetailsStored"]) === false
    && readBooleanAt(r1175, ["artifactBoundary", "rowLevelDataAcceptedByR1175"]) === false
    && readBooleanAt(r1175, ["artifactBoundary", "rowOwnerAssertionInferredByR1175"]) === false
    && readBooleanAt(r1175, ["artifactBoundary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(r1175, ["artifactBoundary", "rowParsingPerformedByR1175"]) === false
    && readBooleanAt(r1175, ["artifactBoundary", "scratchArtifactsPersisted"]) === false
    && readBooleanAt(r1175, ["artifactBoundary", "syntheticConfirmationValuesPersistedInArtifact"]) === false
    && readStringAt(r1175, ["bridgeSmoke", "bridgeSmokeCommand"])
      === R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_COMMAND
    && readStringAt(r1175, ["bridgeSmoke", "r1172MaterializerCommand"]) === R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND
    && readStringAt(r1175, ["bridgeSmoke", "r1165RunnerCommand"]) === R1165_SAFE_ASSERTION_RUNNER_COMMAND
    && exactStringSet(
      readStringArrayAt(r1175, ["bridgeSmoke", "allowedValueKindIds"]),
      SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
    )
    && exactStringSet(
      readStringArrayAt(r1175, ["bridgeSmoke", "blockedContentIds"]),
      SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS,
    )
    && readBooleanAt(r1175, ["bridgeSmoke", "realEvidenceProduced"]) === false
    && readBooleanAt(r1175, ["bridgeSmoke", "rowLevelDataAcceptedByR1175"]) === false
    && readBooleanAt(r1175, ["bridgeSmoke", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(r1175, ["bridgeSmoke", "syntheticSmokeProof"]) === true
    && readStringAt(r1175, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(r1175, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && (
      conclusion === "r1172_to_r1165_safe_assertion_bridge_smoke_failed_non_evidence"
      || conclusion === "r1172_to_r1165_safe_assertion_bridge_smoke_passed_non_evidence"
      || conclusion === "r1172_to_r1165_safe_assertion_bridge_smoke_waiting_on_r1172_prerequisite"
    )
    && (
      nextAction === "inspect_r1175_bridge_smoke_outputs"
      || nextAction === "keep_live_chain_waiting_on_explicit_row_owner_r1172_confirmation"
      || nextAction === "refresh_r1165_safe_assertion_runner"
      || nextAction === "refresh_r1165_safe_assertion_template"
      || nextAction === "refresh_r1167_safe_assertion_fill_guide"
      || nextAction === "rerun_r1172_with_row_owner_feature_only_safe_assertion_confirmation"
      || nextAction === "run_r1165_with_r1172_row_owner_safe_assertion"
    )
    && exactStringSet(readStringArrayAt(r1175, ["summary", "minimumFeaturePairRequired"]), REQUIRED_FEATURE_ONLY_PAIR_FAMILY_IDS)
    && exactStringSet(
      readStringArrayAt(r1175, ["summary", "optionalAddOnFamilyIds"]),
      REQUIRED_R1158_OPTIONAL_ADD_ON_FAMILY_IDS,
    )
    && exactStringSet(
      readStringArrayAt(r1175, ["summary", "allowedValueKindIds"]),
      SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
    )
    && exactStringSet(
      readStringArrayAt(r1175, ["summary", "blockedContentIds"]),
      SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS,
    )
    && exactStringSet(readStringArrayAt(r1175, ["summary", "requiredInputKindIds"]), REQUIRED_R1158_INPUT_KIND_IDS)
    && readNumberAt(r1175, ["summary", "safeFieldEditCount"]) === REQUIRED_FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS.length
    && exactStringSet(
      readStringArrayAt(r1175, ["summary", "safeFieldEditPaths"]),
      REQUIRED_FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS,
    )
    && readBooleanAt(r1175, ["summary", "liveChainGateStillRequired"]) === true
    && readBooleanAt(r1175, ["summary", "materializedAssertionPathStored"]) === false
    && readBooleanAt(r1175, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(r1175, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(r1175, ["summary", "realEvidenceProduced"]) === false
    && readBooleanAt(r1175, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(r1175, ["summary", "rowLevelDataAcceptedByR1175"]) === false
    && readBooleanAt(r1175, ["summary", "rowOwnerAssertionStillRequiredForLiveChain"]) === true
    && readBooleanAt(r1175, ["summary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(r1175, ["summary", "rowParsingPerformedByR1175"]) === false
    && readBooleanAt(r1175, ["summary", "smokeEvidence"]) === false
    && readBooleanAt(r1175, ["summary", "syntheticSmokeProof"]) === true
    && readBooleanAt(r1175, ["productDisplayAuthorized"]) === false;
}

function featureOnlySafeAssertionLiveChainPresent(r1176: unknown | null): boolean {
  const conclusion = readStringAt(r1176, ["summary", "conclusion"]);
  const nextAction = readStringAt(r1176, ["summary", "nextAction"]);
  return inputMatchesExpected("r1176", r1176)
    && readStringAt(r1176, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(r1176, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(r1176, ["artifactBoundary", "assertionFilePathStored"]) === false
    && readBooleanAt(r1176, ["artifactBoundary", "assertionValuesStoredByR1176"]) === false
    && readBooleanAt(r1176, ["artifactBoundary", "childOutputPathsStored"]) === false
    && readBooleanAt(r1176, ["artifactBoundary", "localPathsStored"]) === false
    && readBooleanAt(r1176, ["artifactBoundary", "materializedAssertionPathStored"]) === false
    && readBooleanAt(r1176, ["artifactBoundary", "modelEvidencePromotedByR1176"]) === false
    && readBooleanAt(r1176, ["artifactBoundary", "privateDetailsStored"]) === false
    && readBooleanAt(r1176, ["artifactBoundary", "rowLevelDataAcceptedByR1176"]) === false
    && readBooleanAt(r1176, ["artifactBoundary", "rowOwnerAssertionInferredByR1176"]) === false
    && readBooleanAt(r1176, ["artifactBoundary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(r1176, ["artifactBoundary", "rowParsingPerformedByR1176"]) === false
    && readStringAt(r1176, ["chainRun", "chainRunnerCommand"])
      === R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND
    && readStringAt(r1176, ["chainRun", "r1172MaterializerCommand"]) === R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND
    && readStringAt(r1176, ["chainRun", "r1165RunnerCommand"]) === R1165_SAFE_ASSERTION_RUNNER_COMMAND
    && readBooleanAt(r1176, ["chainRun", "materializedAssertionPathStored"]) === false
    && readBooleanAt(r1176, ["chainRun", "modelEvidencePromotionAllowed"]) === false
    && readStringAt(r1176, ["chainRun", "ordinarySubmitterCompletionModeId"])
      === FEATURE_ONLY_SAFE_COMPLETION_MODE_ID
    && exactStringSet(
      readStringArrayAt(r1176, ["chainRun", "minimumFeaturePairRequired"]),
      REQUIRED_FEATURE_ONLY_PAIR_FAMILY_IDS,
    )
    && exactStringSet(
      readStringArrayAt(r1176, ["chainRun", "optionalAddOnFamilyIds"]),
      REQUIRED_R1158_OPTIONAL_ADD_ON_FAMILY_IDS,
    )
    && exactStringSet(readStringArrayAt(r1176, ["chainRun", "requiredInputKindIds"]), REQUIRED_R1158_INPUT_KIND_IDS)
    && exactStringSet(
      readStringArrayAt(r1176, ["chainRun", "allowedValueKindIds"]),
      SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
    )
    && exactStringSet(
      readStringArrayAt(r1176, ["chainRun", "blockedContentIds"]),
      SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS,
    )
    && exactStringSet(
      readStringArrayAt(r1176, ["chainRun", "ordinarySubmitterSafeCompletionChecklistItemIds"]),
      REQUIRED_R1158_FEATURE_ONLY_CHECKLIST_IDS,
    )
    && readBooleanAt(r1176, ["chainRun", "outcomeLinkedModelEvidenceStillRequired"]) === true
    && readBooleanAt(r1176, ["chainRun", "productDisplayAuthorized"]) === false
    && readBooleanAt(r1176, ["chainRun", "realEvidenceProduced"]) === false
    && readBooleanAt(r1176, ["chainRun", "reviewGptRequiredNow"]) === false
    && readBooleanAt(r1176, ["chainRun", "rowLevelDataAcceptedByR1176"]) === false
    && readBooleanAt(r1176, ["chainRun", "rowOwnerPrivateValuesStored"]) === false
    && readStringAt(r1176, ["chainRun", "rowOwnerHandoffReasonId"]) === R1176_ROW_OWNER_HANDOFF_REASON_ID
    && readStringAt(r1176, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(r1176, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && (
      conclusion === "row_owner_safe_assertion_chain_ready_research_only"
      || conclusion === "row_owner_safe_assertion_chain_waiting_on_explicit_confirmation"
      || conclusion === "row_owner_safe_assertion_chain_waiting_on_r1165_research_runner"
      || conclusion === "row_owner_safe_assertion_chain_waiting_on_r1172_prerequisite"
    )
    && (
      nextAction === "fill_feature_only_coverage_context_template"
      || nextAction === "fill_r1165_row_owner_feature_only_safe_assertion_template"
      || nextAction === "fill_safe_availability_confirmation_from_template"
      || nextAction === "inspect_r1176_row_owner_safe_assertion_chain_outputs"
      || nextAction === "refresh_r1149_submitter_kit"
      || nextAction === "refresh_r1150_safe_availability_confirmation_template"
      || nextAction === "refresh_r1160_transcription_proof"
      || nextAction === "refresh_r1165_safe_assertion_runner"
      || nextAction === "refresh_r1165_safe_assertion_template"
      || nextAction === "refresh_r1167_safe_assertion_fill_guide"
      || nextAction === "rerun_r1161_with_row_owner_feature_only_confirmation_assertion"
      || nextAction === "rerun_r1165_with_valid_safe_assertion"
      || nextAction === "rerun_r1172_with_row_owner_feature_only_safe_assertion_confirmation"
      || nextAction === "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation"
      || nextAction === "row_owner_assert_feature_only_lab_wearable_availability_then_run_r1163_runner"
      || nextAction === "run_r1144_recipe_readiness_chain_with_confirmed_availability"
      || nextAction === "run_r1150_intake_with_r1161_confirmed_feature_only_safe_availability_confirmation"
      || nextAction === "run_r1153_feature_only_chain_with_safe_availability"
      || nextAction === "run_r1164_feature_only_research_handoff"
      || nextAction === "run_r1165_with_r1172_row_owner_safe_assertion"
      || nextAction === "use_feature_only_coverage_context_for_research_planning_only"
    )
    && readBooleanAt(r1176, ["summary", "chainReady"]) !== null
    && readBooleanAt(r1176, ["summary", "explicitRowOwnerAssertionProvided"]) !== null
    && readBooleanAt(r1176, ["summary", "featureOnlyResearchPlanningReady"]) !== null
    && exactStringSet(readStringArrayAt(r1176, ["summary", "minimumFeaturePairRequired"]), REQUIRED_FEATURE_ONLY_PAIR_FAMILY_IDS)
    && exactStringSet(
      readStringArrayAt(r1176, ["summary", "optionalAddOnFamilyIds"]),
      REQUIRED_R1158_OPTIONAL_ADD_ON_FAMILY_IDS,
    )
    && exactStringSet(readStringArrayAt(r1176, ["summary", "requiredInputKindIds"]), REQUIRED_R1158_INPUT_KIND_IDS)
    && readStringAt(r1176, ["summary", "ordinarySubmitterCompletionModeId"])
      === FEATURE_ONLY_SAFE_COMPLETION_MODE_ID
    && exactStringSet(
      readStringArrayAt(r1176, ["summary", "allowedValueKindIds"]),
      SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
    )
    && exactStringSet(
      readStringArrayAt(r1176, ["summary", "blockedContentIds"]),
      SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS,
    )
    && exactStringSet(
      readStringArrayAt(r1176, ["summary", "ordinarySubmitterSafeCompletionChecklistItemIds"]),
      REQUIRED_R1158_FEATURE_ONLY_CHECKLIST_IDS,
    )
    && readNumberAt(r1176, ["summary", "safeFieldEditCount"]) === REQUIRED_FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS.length
    && exactStringSet(
      readStringArrayAt(r1176, ["summary", "safeFieldEditPaths"]),
      REQUIRED_FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS,
    )
    && readBooleanAt(r1176, ["summary", "materializedAssertionPathStored"]) === false
    && readBooleanAt(r1176, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(r1176, ["summary", "outcomeLinkedModelEvidenceStillRequired"]) === true
    && readBooleanAt(r1176, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(r1176, ["summary", "realEvidenceProduced"]) === false
    && readBooleanAt(r1176, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(r1176, ["summary", "rowLevelDataAcceptedByR1176"]) === false
    && readBooleanAt(r1176, ["summary", "rowOwnerAssertionStillRequiredForLiveChain"]) !== null
    && readStringAt(r1176, ["summary", "rowOwnerHandoffReasonId"]) === R1176_ROW_OWNER_HANDOFF_REASON_ID
    && readBooleanAt(r1176, ["summary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(r1176, ["summary", "rowParsingPerformedByR1176"]) === false
    && readBooleanAt(r1176, ["productDisplayAuthorized"]) === false;
}

function safeResponseSmokeProofPresent(r1185: unknown | null): boolean {
  const conclusion = readStringAt(r1185, ["summary", "conclusion"]);
  const nextRealAction = readStringAt(r1185, ["summary", "nextRealAction"]);
  const nextRealActionCommand = readStringAt(r1185, ["summary", "nextRealActionCommand"]);
  const syntheticPathAdvanced = readBooleanAt(r1185, [
    "summary",
    "syntheticPathAdvancedToFeatureOnlyResearchPlanning",
  ]);
  const safeExecutionFeatureSlotIds = readStringArrayAt(r1185, [
    "smokeProof",
    "safeExecutionFeatureSlotIds",
  ]);
  const nextRealActionMatchesCommand =
    (nextRealAction === "obtain_real_row_owner_safe_confirmation_then_rerun_r1183"
      && nextRealActionCommand === R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND)
    || (nextRealAction === "refresh_r1184_safe_response_chain_status"
      && nextRealActionCommand === R1184_AVERAGE_SUBMITTER_SAFE_RESPONSE_CHAIN_STATUS_COMMAND);
  return inputMatchesExpected("r1185", r1185)
    && readStringAt(r1185, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(r1185, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(r1185, ["artifactBoundary", "confirmedResponseLocalPathStored"]) === false
    && readBooleanAt(r1185, ["artifactBoundary", "fillableResponseLocalPathStored"]) === false
    && readBooleanAt(r1185, ["artifactBoundary", "liveArtifactsMutatedByR1185"]) === false
    && readBooleanAt(r1185, ["artifactBoundary", "localPathsStored"]) === false
    && readBooleanAt(r1185, ["artifactBoundary", "modelEvidencePromotedByR1185"]) === false
    && readBooleanAt(r1185, ["artifactBoundary", "privateDetailsStored"]) === false
    && readBooleanAt(r1185, ["artifactBoundary", "productDisplayAuthorized"]) === false
    && readBooleanAt(r1185, ["artifactBoundary", "rowLevelDataAcceptedByR1185"]) === false
    && readBooleanAt(r1185, ["artifactBoundary", "rowOwnerConfirmationInferredByR1185"]) === false
    && readBooleanAt(r1185, ["artifactBoundary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(r1185, ["artifactBoundary", "rowOwnerSafeResponseValuesStoredInR1185Packet"]) === false
    && readBooleanAt(r1185, ["artifactBoundary", "rowParsingPerformedByR1185"]) === false
    && readBooleanAt(r1185, ["artifactBoundary", "safeBooleanValuesStoredInR1185Packet"]) === false
    && readBooleanAt(r1185, ["artifactBoundary", "syntheticFixtureRowsStored"]) === false
    && (
      conclusion === "average_submitter_safe_response_smoke_passed_non_evidence"
      || conclusion === "average_submitter_safe_response_smoke_waiting_on_live_r1184_row_owner_blocker"
    )
    && readBooleanAt(r1185, ["summary", "liveR1184ReadyForSyntheticSmoke"]) !== null
    && nextRealActionMatchesCommand
    && readBooleanAt(r1185, ["summary", "nextRealActionRequiresExplicitRowOwnerAssertion"]) !== null
    && readBooleanAt(r1185, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(r1185, ["summary", "syntheticSmokeRan"]) !== null
    && readStringAt(r1185, ["smokeProof", "evidenceClass"]) === "synthetic_non_evidence_smoke_proof"
    && readBooleanAt(r1185, ["smokeProof", "liveArtifactsMutatedByR1185"]) === false
    && readBooleanAt(r1185, ["smokeProof", "liveRowOwnerConfirmationProvided"]) === false
    && exactStringSet(
      readStringArrayAt(r1185, ["smokeProof", "minimumFeaturePairRequired"]),
      REQUIRED_FEATURE_ONLY_PAIR_FAMILY_IDS,
    )
    && exactStringSet(readStringArrayAt(r1185, ["smokeProof", "prioritizedInputKindIds"]), REQUIRED_R1158_INPUT_KIND_IDS)
    && exactStringSet(
      readStringArrayAt(r1185, ["smokeProof", "requiredResponseFieldIds"]),
      REQUIRED_R1185_SAFE_RESPONSE_FIELD_IDS,
    )
    && (syntheticPathAdvanced === true
      ? exactStringSet(safeExecutionFeatureSlotIds, REQUIRED_R1185_SAFE_EXECUTION_FEATURE_SLOT_IDS)
      : safeExecutionFeatureSlotIds.length === 0)
    && readBooleanAt(r1185, ["smokeProof", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(r1185, ["smokeProof", "productDisplayAuthorized"]) === false
    && readBooleanAt(r1185, ["smokeProof", "reviewGptRequiredNow"]) === false
    && readBooleanAt(r1185, ["smokeProof", "rowLevelDataAcceptedByR1185"]) === false
    && readBooleanAt(r1185, ["smokeProof", "rowOwnerConfirmationInferredByR1185"]) === false
    && readBooleanAt(r1185, ["smokeProof", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(r1185, ["smokeProof", "rowOwnerSafeResponseValuesStoredInR1185Packet"]) === false
    && readBooleanAt(r1185, ["smokeProof", "rowParsingPerformedByR1185"]) === false
    && readStringAt(r1185, ["smokeProof", "sourcePriority"]) === TARGET_INPUT_PRIORITY
    && readBooleanAt(r1185, ["smokeProof", "syntheticSmokeRan"]) !== null
    && readStringAt(r1185, ["smokeProof", "targetAgeBand"]) === TARGET_AGE_BAND
    && readBooleanAt(r1185, ["productDisplayAuthorized"]) === false;
}

function postConfirmationPrivateConfigIntakeSafeActionGuardPresent(r1148: unknown | null): boolean {
  const packetReadyForConfigIntake = readBooleanAt(r1148, ["summary", "packetReadyForConfigIntake"]);
  const nextAction = readStringAt(r1148, ["summary", "nextAction"]);
  const safeNextAction = readStringAt(r1148, ["summary", "safeAvailabilityActionPacketNextAction"]);
  return readStringAt(r1148, ["packetId"]) === INPUTS.r1148.packetId
    && readStringAt(r1148, ["schemaVersion"]) === INPUTS.r1148.schemaVersion
    && readStringAt(r1148, ["status"]) === "research-local-aggregate-only"
    && readStringAt(r1148, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(r1148, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && readBooleanAt(r1148, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(r1148, ["artifactBoundary", "privateConfigPathStored"]) === false
    && readBooleanAt(r1148, ["artifactBoundary", "privateConfigValuesStored"]) === false
    && readBooleanAt(r1148, ["artifactBoundary", "privateFieldRefValuesStored"]) === false
    && readBooleanAt(r1148, ["artifactBoundary", "privateTableRefValuesStored"]) === false
    && readBooleanAt(r1148, ["artifactBoundary", "rowParsingPerformedByR1148"]) === false
    && readBooleanAt(r1148, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(r1148, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(r1148, ["summary", "rowParsingPerformedByR1148"]) === false
    && readBooleanAt(r1148, ["productDisplayAuthorized"]) === false
    && readStringAt(r1148, ["summary", "r1147Conclusion"]) !== null
    && readStringAt(r1148, ["summary", "r1147NextAction"]) !== null
    && safeNextAction !== null
    && readBooleanAt(r1148, ["summary", "safeAvailabilityActionPacketFeatureOnlyCoverageContextReady"]) !== null
    && readBooleanAt(r1148, ["summary", "safeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain"]) !== null
    && readBooleanAt(r1148, ["summary", "safeAvailabilityActionPacketRowLevelDataAcceptedByR1154"]) === false
    && (
      packetReadyForConfigIntake === true
      || (
        packetReadyForConfigIntake === false
        && nextAction === safeNextAction
        && includesAll(
          readStringArrayAt(r1148, ["summary", "safeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds"]),
          REQUIRED_FEATURE_ONLY_PAIR_FAMILY_IDS,
        )
      )
    );
}

function safeRowOwnerAssertionGatePresent(r1144: unknown | null): boolean {
  const rowOwnerConfirmed = readBooleanAt(r1144, ["summary", "rowOwnerAssertionsConfirmed"]);
  const generatedManifestWritten = readBooleanAt(r1144, ["summary", "generatedManifestWritten"]);
  const nextAction = readStringAt(r1144, ["summary", "nextAction"]);
  if (rowOwnerConfirmed === false) {
    return generatedManifestWritten === false
      && nextAction === "confirm_recipe_availability_assertions_before_running_chain";
  }
  return rowOwnerConfirmed === true && generatedManifestWritten === true;
}

function confirmedRouteRequirementsAvailable(r1144: unknown | null): boolean {
  return readBooleanAt(r1144, ["summary", "rowOwnerAssertionsConfirmed"]) === true
    && includesAll(
      readStringArrayAt(r1144, ["summary", "requiredPrivateFieldRefFamilies"]),
      REQUIRED_PRIVATE_FIELD_REF_FAMILIES,
    )
    && includesAll(
      readStringArrayAt(r1144, ["summary", "requiredPrivateTableRefs"]),
      REQUIRED_PRIVATE_TABLE_REFS,
    );
}

function partialPrivateChainAvailable(r1142: unknown | null): boolean {
  return readStringAt(r1142, ["packetId"]) === INPUTS.r1142.packetId
    && readStringAt(r1142, ["schemaVersion"]) === INPUTS.r1142.schemaVersion
    && readStringAt(r1142, ["partialPrivateChain", "commands", "partialPrivateChainRunnerCommand"]) !== null;
}

function privateRouteConfigReadyOrAlreadyRun(inputs: Record<InputKey, unknown | null>): boolean {
  return readBooleanAt(inputs.r1148, ["summary", "readyForR1142"]) === true
    || readBooleanAt(inputs.r1142, ["partialPrivateChain", "partialPrivateConfigSuppliedToRunner"]) === true;
}

function privateRouteConfigSuppliedToIntake(inputs: Record<InputKey, unknown | null>): boolean {
  return readBooleanAt(inputs.r1148, ["summary", "privateConfigSuppliedToIntake"]) === true;
}

function privateRouteConfigSupplied(inputs: Record<InputKey, unknown | null>): boolean {
  return privateRouteConfigSuppliedToIntake(inputs)
    || readBooleanAt(inputs.r1142, ["partialPrivateChain", "partialPrivateConfigSuppliedToRunner"]) === true;
}

function realLabWearableRouteMetricsRecorded(r1142: unknown | null): boolean {
  return readBooleanAt(r1142, ["summary", "routeMetricsReadyForR1138"]) === true
    && readStringAt(r1142, ["summary", "aggregateMetricsArtifact"]) !== null
    && includesAll(
      readStringArrayAt(r1142, ["summary", "finalReadyPartialMetricRouteIds"]),
      REQUIRED_ROUTE_METRIC_IDS,
    );
}

function privacyProductGateClosed(inputs: Record<InputKey, unknown | null>): boolean {
  return (Object.entries(inputs) as Array<[InputKey, unknown | null]>).every(([key, input]) =>
    (
      (key === "r1154" || key === "r1155" || key === "r1156" || key === "r1157" || key === "r1158"
        || key === "r1159" || key === "r1160" || key === "r1161" || key === "r1162" || key === "r1163"
        || key === "r1164" || key === "r1165" || key === "r1167" || key === "r1170" || key === "r1172"
        || key === "r1173" || key === "r1174" || key === "r1175" || key === "r1176" || key === "r1185")
        && input === null
    )
    || (
      input !== null
      && findForbiddenAggregateEgress(input).length === 0
      && readBooleanAt(input, ["productDisplayAuthorized"]) === false
    )
  ) && !reviewGptRequiredNow(inputs);
}

function reviewGptRequiredNow(inputs: Record<InputKey, unknown | null>): boolean {
  return (Object.values(inputs) as Array<unknown | null>).some((input) =>
    readBooleanAt(input, ["summary", "reviewGptRequiredNow"]) === true
  );
}

function routeEvidenceStateFor(inputs: Record<InputKey, unknown | null>): R1145OrdinaryConsumerCurrentChainCompletionAuditOutput["completionAudit"]["routeEvidenceState"] {
  return {
    eligiblePartialRouteIds: readStringArrayAt(inputs.r1144, ["summary", "eligiblePartialRouteIds"]),
    executedPartialRouteIds: readStringArrayAt(inputs.r1142, ["summary", "executedPartialRouteIds"]),
    finalReadyPartialMetricRouteIds: readStringArrayAt(inputs.r1142, ["summary", "finalReadyPartialMetricRouteIds"]),
    fullEvidenceGateCleared: false,
    fullSupportedRouteReady: readBooleanAt(inputs.r1144, ["summary", "fullSupportedRouteReady"]),
    privateDetailsStored: false,
    privateRouteConfigReadyForR1142: privateRouteConfigReadyOrAlreadyRun(inputs),
    privateRouteConfigSupplied: privateRouteConfigSupplied(inputs),
    privateRouteConfigSuppliedToIntake: privateRouteConfigSuppliedToIntake(inputs),
    privateRouteConfigStatus: readStringAt(inputs.r1148, ["summary", "privateConfigStatus"]),
    realLabWearableRouteMetricsRecorded: realLabWearableRouteMetricsRecorded(inputs.r1142),
    requiredPrivateFieldRefFamilies: readStringArrayAt(inputs.r1144, ["summary", "requiredPrivateFieldRefFamilies"]),
    requiredPrivateTableRefs: readStringArrayAt(inputs.r1144, ["summary", "requiredPrivateTableRefs"]),
    rowOwnerAssertionsConfirmed: readBooleanAt(inputs.r1144, ["summary", "rowOwnerAssertionsConfirmed"]),
  };
}

function featureOnlySubmissionModeFor(inputs: Record<InputKey, unknown | null>): R1145OrdinaryConsumerCurrentChainCompletionAuditOutput["completionAudit"]["featureOnlySubmissionMode"] {
  return {
    conclusion: readStringAt(inputs.r1151, ["summary", "conclusion"]),
    featureOnlyCoverageContextAllowed: readBooleanAt(inputs.r1151, ["summary", "featureOnlyCoverageContextAllowed"]),
    featureOnlyCoverageRequiresPreferredPair: readBooleanAt(
      inputs.r1151,
      ["summary", "featureOnlyCoverageRequiresPreferredPair"],
    ),
    featureOnlyPreferredPairReady: readBooleanAt(inputs.r1151, ["summary", "featureOnlyPreferredPairReady"]),
    minimumFeaturePairRequired: readStringArrayAt(inputs.r1151, ["summary", "minimumFeaturePairRequired"]),
    missingEvidenceSourceFamilyIds: readStringArrayAt(inputs.r1151, ["summary", "missingEvidenceSourceFamilyIds"]),
    missingPrimaryFeatureFamilyIds: readStringArrayAt(inputs.r1151, ["summary", "missingPrimaryFeatureFamilyIds"]),
    modelEvidencePromotionAllowed: readBooleanAt(inputs.r1151, ["summary", "modelEvidencePromotionAllowed"]),
    outcomeLinkageRequiredForFeatureOnlyContext: readBooleanAt(
      inputs.r1151,
      ["summary", "outcomeLinkageRequiredForFeatureOnlyContext"],
    ),
    outcomeLinkedEvidenceReady: readBooleanAt(inputs.r1151, ["summary", "outcomeLinkedEvidenceReady"]),
    privateDetailsStored: false,
    rowLevelDataAcceptedByR1151: readBooleanAt(inputs.r1151, ["summary", "rowLevelDataAcceptedByR1151"]),
    supportedFeatureFamilyIds: readStringArrayAt(inputs.r1151, ["summary", "supportedFeatureFamilyIds"]),
  };
}

function featureOnlyCoverageContextIntakeFor(inputs: Record<InputKey, unknown | null>): R1145OrdinaryConsumerCurrentChainCompletionAuditOutput["completionAudit"]["featureOnlyCoverageContextIntake"] {
  return {
    conclusion: readStringAt(inputs.r1152, ["summary", "conclusion"]),
    contextStatus: readStringAt(inputs.r1152, ["summary", "contextStatus"]),
    coverageContextReadyForResearchPlanning: readBooleanAt(
      inputs.r1152,
      ["summary", "coverageContextReadyForResearchPlanning"],
    ),
    featureOnlyCoverageRequiresPreferredPair: readBooleanAt(
      inputs.r1152,
      ["summary", "featureOnlyCoverageRequiresPreferredPair"],
    ),
    minimumFeaturePairRequired: readStringArrayAt(inputs.r1152, ["summary", "minimumFeaturePairRequired"]),
    missingPrimaryFeatureFamilyIds: readStringArrayAt(inputs.r1152, ["summary", "missingPrimaryFeatureFamilyIds"]),
    modelEvidencePromotionAllowed: readBooleanAt(inputs.r1152, ["summary", "modelEvidencePromotionAllowed"]),
    outcomeLinkageRequiredForFeatureOnlyContext: readBooleanAt(
      inputs.r1152,
      ["summary", "outcomeLinkageRequiredForFeatureOnlyContext"],
    ),
    privateDetailsStored: false,
    r1151FeatureOnlyModeReadyForIntake: readBooleanAt(
      inputs.r1152,
      ["summary", "r1151FeatureOnlyModeReadyForIntake"],
    ),
    rowLevelDataAcceptedByR1152: readBooleanAt(inputs.r1152, ["summary", "rowLevelDataAcceptedByR1152"]),
    supportedFeatureFamilyIds: readStringArrayAt(inputs.r1152, ["summary", "supportedFeatureFamilyIds"]),
  };
}

function featureOnlyChainRunnerFor(inputs: Record<InputKey, unknown | null>): R1145OrdinaryConsumerCurrentChainCompletionAuditOutput["completionAudit"]["featureOnlyChainRunner"] {
  return {
    conclusion: readStringAt(inputs.r1153, ["summary", "conclusion"]),
    coverageContextReadyForResearchPlanning: readBooleanAt(
      inputs.r1153,
      ["summary", "coverageContextReadyForResearchPlanning"],
    ),
    featureOnlyCoverageContextAllowed: readBooleanAt(
      inputs.r1153,
      ["summary", "featureOnlyCoverageContextAllowed"],
    ),
    featureOnlyCoverageContextIntakeConclusion: readStringAt(
      inputs.r1153,
      ["summary", "featureOnlyCoverageContextIntakeConclusion"],
    ),
    featureOnlyCoverageContextIntakeContextStatus: readStringAt(
      inputs.r1153,
      ["summary", "featureOnlyCoverageContextIntakeContextStatus"],
    ),
    featureOnlyModeConclusion: readStringAt(inputs.r1153, ["summary", "featureOnlyModeConclusion"]),
    minimumFeaturePairRequired: readStringArrayAt(inputs.r1153, ["summary", "minimumFeaturePairRequired"]),
    missingCoverageContextPrimaryFeatureFamilyIds: readStringArrayAt(
      inputs.r1153,
      ["summary", "missingCoverageContextPrimaryFeatureFamilyIds"],
    ),
    missingFeatureOnlySourceFamilyIds: readStringArrayAt(
      inputs.r1153,
      ["summary", "missingFeatureOnlySourceFamilyIds"],
    ),
    modelEvidencePromotionAllowed: readBooleanAt(inputs.r1153, ["summary", "modelEvidencePromotionAllowed"]),
    nextAction: readStringAt(inputs.r1153, ["summary", "nextAction"]),
    outcomeLinkageRequiredForFeatureOnlyContext: readBooleanAt(
      inputs.r1153,
      ["summary", "outcomeLinkageRequiredForFeatureOnlyContext"],
    ),
    privateDetailsStored: false,
    rowLevelDataAcceptedByR1153: readBooleanAt(inputs.r1153, ["summary", "rowLevelDataAcceptedByR1153"]),
    safeAvailabilityFeatureOnlyCoverageContextReady: readBooleanAt(
      inputs.r1153,
      ["summary", "safeAvailabilityFeatureOnlyCoverageContextReady"],
    ),
    safeAvailabilityReadyForRecipeReadinessChain: readBooleanAt(
      inputs.r1153,
      ["summary", "safeAvailabilityReadyForRecipeReadinessChain"],
    ),
    supportedFeatureFamilyIds: readStringArrayAt(inputs.r1153, ["summary", "supportedFeatureFamilyIds"]),
  };
}

function safeConfirmationFeatureOnlySmokeProofFor(inputs: Record<InputKey, unknown | null>): R1145OrdinaryConsumerCurrentChainCompletionAuditOutput["completionAudit"]["safeConfirmationFeatureOnlySmokeProof"] {
  return {
    conclusion: readStringAt(inputs.r1155, ["summary", "conclusion"]),
    featureOnlyChainConclusion: readStringAt(inputs.r1155, ["summary", "featureOnlyChainConclusion"]),
    featureOnlyCoverageContextReadyForResearchPlanning:
      readBooleanAt(inputs.r1155, ["summary", "featureOnlyCoverageContextReadyForResearchPlanning"]),
    modelEvidencePromotionAllowed: readBooleanAt(inputs.r1155, ["summary", "modelEvidencePromotionAllowed"]),
    nextAction: readStringAt(inputs.r1155, ["summary", "nextAction"]),
    readyForRecipeReadinessChain: readBooleanAt(inputs.r1155, ["summary", "readyForRecipeReadinessChain"]),
    rowLevelDataAcceptedByR1155: readBooleanAt(inputs.r1155, ["summary", "rowLevelDataAcceptedByR1155"]),
    safeAvailabilityConfirmationConclusion:
      readStringAt(inputs.r1155, ["summary", "safeAvailabilityConfirmationConclusion"]),
    smokeEvidence: readBooleanAt(inputs.r1155, ["summary", "smokeEvidence"]),
  };
}

function safeConfirmationHandoffFor(inputs: Record<InputKey, unknown | null>): R1145OrdinaryConsumerCurrentChainCompletionAuditOutput["completionAudit"]["safeConfirmationHandoff"] {
  return {
    conclusion: readStringAt(inputs.r1156, ["summary", "conclusion"]),
    featureOnlyPathMechanicallyProven: readBooleanAt(inputs.r1156, ["summary", "featureOnlyPathMechanicallyProven"]),
    handoffReadyForRowOwner: readBooleanAt(inputs.r1156, ["summary", "handoffReadyForRowOwner"]),
    modelEvidencePromotionAllowed: readBooleanAt(inputs.r1156, ["summary", "modelEvidencePromotionAllowed"]),
    nextAction: readStringAt(inputs.r1156, ["summary", "nextAction"]),
    readyForModelEvidence: readBooleanAt(inputs.r1156, ["summary", "readyForModelEvidence"]),
    readyForRecipeReadinessChain: readBooleanAt(inputs.r1156, ["summary", "readyForRecipeReadinessChain"]),
    requiredFeatureOnlySourceFamilyIds:
      readStringArrayAt(inputs.r1156, ["summary", "requiredFeatureOnlySourceFamilyIds"]),
    requiredSafeCompletionCheckIds:
      readStringArrayAt(inputs.r1156, ["summary", "requiredSafeCompletionCheckIds"]),
    rowLevelDataAcceptedByR1156: readBooleanAt(inputs.r1156, ["summary", "rowLevelDataAcceptedByR1156"]),
    rowOwnerWorkType: readStringAt(inputs.r1156, ["summary", "rowOwnerWorkType"]),
    safeConfirmationStillRequired: readBooleanAt(inputs.r1156, ["summary", "safeConfirmationStillRequired"]),
    smokeEvidence: readBooleanAt(inputs.r1156, ["summary", "smokeEvidence"]),
  };
}

function safeConfirmationChainRunnerFor(inputs: Record<InputKey, unknown | null>): R1145OrdinaryConsumerCurrentChainCompletionAuditOutput["completionAudit"]["safeConfirmationChainRunner"] {
  return {
    conclusion: readStringAt(inputs.r1157, ["summary", "conclusion"]),
    confirmationPathConfigured: readBooleanAt(inputs.r1157, ["summary", "confirmationPathConfigured"]),
    featureOnlyCoverageContextReady:
      readBooleanAt(inputs.r1157, ["summary", "featureOnlyCoverageContextReady"]),
    featureOnlyResearchPlanningReady:
      readBooleanAt(inputs.r1157, ["summary", "featureOnlyResearchPlanningReady"]),
    modelEvidencePromotionAllowed: readBooleanAt(inputs.r1157, ["summary", "modelEvidencePromotionAllowed"]),
    nextAction: readStringAt(inputs.r1157, ["summary", "nextAction"]),
    readyForModelEvidence: readBooleanAt(inputs.r1157, ["summary", "readyForModelEvidence"]),
    readyForRecipeReadinessChain: readBooleanAt(inputs.r1157, ["summary", "readyForRecipeReadinessChain"]),
    rowLevelDataAcceptedByR1157: readBooleanAt(inputs.r1157, ["summary", "rowLevelDataAcceptedByR1157"]),
    safeConfirmationStillRequired: readBooleanAt(inputs.r1157, ["summary", "safeConfirmationStillRequired"]),
  };
}

function safeConfirmationFillGuideFor(inputs: Record<InputKey, unknown | null>): R1145OrdinaryConsumerCurrentChainCompletionAuditOutput["completionAudit"]["safeConfirmationFillGuide"] {
  return {
    conclusion: readStringAt(inputs.r1158, ["summary", "conclusion"]),
    exactSafeFieldEditCount: readNumberAt(inputs.r1158, ["summary", "exactSafeFieldEditCount"]),
    guideReadyForRowOwnerFill: readBooleanAt(inputs.r1158, ["summary", "guideReadyForRowOwnerFill"]),
    minimumFeaturePairRequired: readStringArrayAt(inputs.r1158, ["summary", "minimumFeaturePairRequired"]),
    nextAction: readStringAt(inputs.r1158, ["summary", "nextAction"]),
    optionalAddOnFamilyIds: readStringArrayAt(inputs.r1158, ["summary", "optionalAddOnFamilyIds"]),
    requiredChecklistIds: readStringArrayAt(inputs.r1158, ["summary", "requiredChecklistIds"]),
    requiredInputKindIds: readStringArrayAt(inputs.r1158, ["summary", "requiredInputKindIds"]),
    rowLevelDataAcceptedByR1158: readBooleanAt(inputs.r1158, ["summary", "rowLevelDataAcceptedByR1158"]),
  };
}

function safeConfirmationAnswerSheetFor(inputs: Record<InputKey, unknown | null>): R1145OrdinaryConsumerCurrentChainCompletionAuditOutput["completionAudit"]["safeConfirmationAnswerSheet"] {
  return {
    answerSheetReadyForRowOwner: readBooleanAt(inputs.r1159, ["summary", "answerSheetReadyForRowOwner"]),
    conclusion: readStringAt(inputs.r1159, ["summary", "conclusion"]),
    exactSafeAnswerCount: readNumberAt(inputs.r1159, ["summary", "exactSafeAnswerCount"]),
    minimumFeaturePairRequired: readStringArrayAt(inputs.r1159, ["summary", "minimumFeaturePairRequired"]),
    nextAction: readStringAt(inputs.r1159, ["summary", "nextAction"]),
    optionalAddOnFamilyIds: readStringArrayAt(inputs.r1159, ["summary", "optionalAddOnFamilyIds"]),
    requiredChecklistIds: readStringArrayAt(inputs.r1159, ["summary", "requiredChecklistIds"]),
    requiredInputKindIds: readStringArrayAt(inputs.r1159, ["summary", "requiredInputKindIds"]),
    rowLevelDataAcceptedByR1159: readBooleanAt(inputs.r1159, ["summary", "rowLevelDataAcceptedByR1159"]),
    rowOwnerProvidedValuesStored: readBooleanAt(inputs.r1159, ["summary", "rowOwnerProvidedValuesStored"]),
  };
}

function safeConfirmationTranscriptionProofFor(inputs: Record<InputKey, unknown | null>): R1145OrdinaryConsumerCurrentChainCompletionAuditOutput["completionAudit"]["safeConfirmationTranscriptionProof"] {
  return {
    conclusion: readStringAt(inputs.r1160, ["summary", "conclusion"]),
    confirmationValuesStoredByR1160:
      readBooleanAt(inputs.r1160, ["summary", "confirmationValuesStoredByR1160"]),
    exactSafeTranscriptionStepCount:
      readNumberAt(inputs.r1160, ["summary", "exactSafeTranscriptionStepCount"]),
    hypotheticalTranscriptionWouldBeFeatureOnlyReady:
      readBooleanAt(inputs.r1160, ["summary", "hypotheticalTranscriptionWouldBeFeatureOnlyReady"]),
    nextAction: readStringAt(inputs.r1160, ["summary", "nextAction"]),
    readyForRowOwnerConfirmation:
      readBooleanAt(inputs.r1160, ["summary", "transcriptionProofReadyForRowOwnerConfirmation"]),
    requiredInputKindIds: readStringArrayAt(inputs.r1160, ["summary", "requiredInputKindIds"]),
    rowLevelDataAcceptedByR1160:
      readBooleanAt(inputs.r1160, ["summary", "rowLevelDataAcceptedByR1160"]),
    rowOwnerConfirmationStillRequired:
      readBooleanAt(inputs.r1160, ["summary", "rowOwnerConfirmationStillRequired"]),
    rowOwnerProvidedValuesStored:
      readBooleanAt(inputs.r1160, ["summary", "rowOwnerProvidedValuesStored"]),
  };
}

function safeConfirmationMaterializerFor(inputs: Record<InputKey, unknown | null>): R1145OrdinaryConsumerCurrentChainCompletionAuditOutput["completionAudit"]["safeConfirmationMaterializer"] {
  return {
    conclusion: readStringAt(inputs.r1161, ["summary", "conclusion"]),
    confirmationValuesStoredInR1161Packet:
      readBooleanAt(inputs.r1161, ["summary", "confirmationValuesStoredInR1161Packet"]),
    explicitRowOwnerConfirmationAssertionProvided:
      readBooleanAt(inputs.r1161, ["summary", "explicitRowOwnerConfirmationAssertionProvided"]),
    featureOnlyConfirmationWouldBeReadyForR1150:
      readBooleanAt(inputs.r1161, ["summary", "featureOnlyConfirmationWouldBeReadyForR1150"]),
    nextAction: readStringAt(inputs.r1161, ["summary", "nextAction"]),
    rowLevelDataAcceptedByR1161:
      readBooleanAt(inputs.r1161, ["summary", "rowLevelDataAcceptedByR1161"]),
    rowOwnerConfirmationStillRequired:
      readBooleanAt(inputs.r1161, ["summary", "rowOwnerConfirmationStillRequired"]),
    rowOwnerPrivateValuesStored:
      readBooleanAt(inputs.r1161, ["summary", "rowOwnerPrivateValuesStored"]),
    safeConfirmationArtifact:
      readStringAt(inputs.r1161, ["summary", "safeConfirmationArtifact"]),
    safeConfirmationArtifactWritten:
      readBooleanAt(inputs.r1161, ["summary", "safeConfirmationArtifactWritten"]),
    safeMaterializedFieldCount:
      readNumberAt(inputs.r1161, ["summary", "safeMaterializedFieldCount"]),
  };
}

function safeConfirmationAssertionHandoffFor(inputs: Record<InputKey, unknown | null>): R1145OrdinaryConsumerCurrentChainCompletionAuditOutput["completionAudit"]["safeConfirmationAssertionHandoff"] {
  return {
    conclusion: readStringAt(inputs.r1162, ["summary", "conclusion"]),
    confirmationValuesStoredByR1162:
      readBooleanAt(inputs.r1162, ["summary", "confirmationValuesStoredByR1162"]),
    explicitRowOwnerConfirmationAssertionProvided:
      readBooleanAt(inputs.r1162, ["summary", "explicitRowOwnerConfirmationAssertionProvided"]),
    featureOnlyConfirmationWouldBeReadyForR1150:
      readBooleanAt(inputs.r1162, ["summary", "featureOnlyConfirmationWouldBeReadyForR1150"]),
    handoffReadyForRowOwner:
      readBooleanAt(inputs.r1162, ["summary", "handoffReadyForRowOwner"]),
    materializerCommand: readStringAt(inputs.r1162, ["summary", "materializerCommand"]),
    materializerNextAction: readStringAt(inputs.r1162, ["summary", "materializerNextAction"]),
    minimumFeaturePairRequired:
      readStringArrayAt(inputs.r1162, ["summary", "minimumFeaturePairRequired"]),
    nextAction: readStringAt(inputs.r1162, ["summary", "nextAction"]),
    requiredChecklistIds:
      readStringArrayAt(inputs.r1162, ["summary", "requiredChecklistIds"]),
    requiredInputKindIds:
      readStringArrayAt(inputs.r1162, ["summary", "requiredInputKindIds"]),
    rowLevelDataAcceptedByR1162:
      readBooleanAt(inputs.r1162, ["summary", "rowLevelDataAcceptedByR1162"]),
    rowOwnerAssertionInferredByR1162:
      readBooleanAt(inputs.r1162, ["summary", "rowOwnerAssertionInferredByR1162"]),
    rowOwnerAssertionStillRequired:
      readBooleanAt(inputs.r1162, ["summary", "rowOwnerAssertionStillRequired"]),
    rowOwnerPrivateValuesStored:
      readBooleanAt(inputs.r1162, ["summary", "rowOwnerPrivateValuesStored"]),
    safeConfirmationArtifactWritten:
      readBooleanAt(inputs.r1162, ["summary", "safeConfirmationArtifactWritten"]),
  };
}

function safeAvailabilityActionPacketFor(inputs: Record<InputKey, unknown | null>): R1145OrdinaryConsumerCurrentChainCompletionAuditOutput["completionAudit"]["safeAvailabilityActionPacket"] {
  return {
    conclusion: readStringAt(inputs.r1154, ["summary", "conclusion"]),
    featureOnlyCoverageContextReady: readBooleanAt(inputs.r1154, ["summary", "featureOnlyCoverageContextReady"]),
    featureOnlyQuickstartArtifact: readStringAt(inputs.r1154, ["summary", "featureOnlyQuickstartArtifact"]),
    featureOnlyQuickstartSafeFieldEditCount:
      readNumberAt(inputs.r1154, ["summary", "featureOnlyQuickstartSafeFieldEditCount"]),
    featureOnlyQuickstartSafeFieldEditPaths:
      readStringArrayAt(inputs.r1154, ["summary", "featureOnlyQuickstartSafeFieldEditPaths"]),
    fillableTemplateArtifact: readStringAt(inputs.r1154, ["summary", "fillableTemplateArtifact"]),
    featureOnlyFillableTemplateArtifact: readStringAt(
      inputs.r1154,
      ["summary", "featureOnlyFillableTemplateArtifact"],
    ),
    minimumFeaturePairRequired: readStringArrayAt(inputs.r1154, ["summary", "minimumFeaturePairRequired"]),
    missingAggregateReadinessFactIds: readStringArrayAt(
      inputs.r1154,
      ["summary", "missingAggregateReadinessFactIds"],
    ),
    missingAttestationKeys: readStringArrayAt(inputs.r1154, ["summary", "missingAttestationKeys"]),
    missingFeatureOnlySourceFamilyIds: readStringArrayAt(
      inputs.r1154,
      ["summary", "missingFeatureOnlySourceFamilyIds"],
    ),
    missingRequiredSourceFamilyIds: readStringArrayAt(
      inputs.r1154,
      ["summary", "missingRequiredSourceFamilyIds"],
    ),
    nextAction: readStringAt(inputs.r1154, ["summary", "nextAction"]),
    ordinarySubmitterCompletionModeIds: readStringArrayAt(
      inputs.r1154,
      ["summary", "ordinarySubmitterCompletionModeIds"],
    ),
    ordinarySubmitterSafeCompletionChecklistItemIds: readStringArrayAt(
      inputs.r1154,
      ["summary", "ordinarySubmitterSafeCompletionChecklistItemIds"],
    ),
    outcomeLinkageRequiredForFeatureOnlyContext: readBooleanAt(
      inputs.r1154,
      ["summary", "outcomeLinkageRequiredForFeatureOnlyContext"],
    ),
    preferredRecipeId: readStringAt(inputs.r1154, ["summary", "preferredRecipeId"]),
    privateDetailsStored: false,
    readyForOutcomeLinkedRecipeReadinessChain: readBooleanAt(
      inputs.r1154,
      ["summary", "readyForOutcomeLinkedRecipeReadinessChain"],
    ),
    rowLevelDataAcceptedByR1154: readBooleanAt(inputs.r1154, ["summary", "rowLevelDataAcceptedByR1154"]),
    rowOwnerAssertionsConfirmed: readBooleanAt(inputs.r1154, ["summary", "rowOwnerAssertionsConfirmed"]),
    rowOwnerWorkType: readStringAt(inputs.r1154, ["summary", "rowOwnerWorkType"]),
    safeAvailabilityConfirmationStatus: readStringAt(
      inputs.r1154,
      ["summary", "safeAvailabilityConfirmationStatus"],
    ),
  };
}

async function readInputs(
  options: R1145OrdinaryConsumerCurrentChainCompletionAuditOptions,
): Promise<Record<InputKey, unknown | null>> {
  return {
    r1076: await readJsonIfPresent(options.r1076Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1076.artifact)),
    r1135: await readJsonIfPresent(options.r1135Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1135.artifact)),
    r1142: await readJsonIfPresent(options.r1142Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1142.artifact)),
    r1144: await readJsonIfPresent(options.r1144Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1144.artifact)),
    r1148: await readJsonIfPresent(options.r1148Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1148.artifact)),
    r1149: await readJsonIfPresent(options.r1149Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1149.artifact)),
    r1151: await readJsonIfPresent(options.r1151Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1151.artifact)),
    r1152: await readJsonIfPresent(options.r1152Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1152.artifact)),
    r1153: await readJsonIfPresent(options.r1153Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1153.artifact)),
    r1154: await readJsonIfPresent(options.r1154Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1154.artifact)),
    r1155: await readJsonIfPresent(options.r1155Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1155.artifact)),
    r1156: await readJsonIfPresent(options.r1156Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1156.artifact)),
    r1157: await readJsonIfPresent(options.r1157Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1157.artifact)),
    r1158: await readJsonIfPresent(options.r1158Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1158.artifact)),
    r1159: await readJsonIfPresent(options.r1159Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1159.artifact)),
    r1160: await readJsonIfPresent(options.r1160Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1160.artifact)),
    r1161: await readJsonIfPresent(options.r1161Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1161.artifact)),
    r1162: await readJsonIfPresent(options.r1162Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1162.artifact)),
    r1163: await readJsonIfPresent(options.r1163Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1163.artifact)),
    r1164: await readJsonIfPresent(options.r1164Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1164.artifact)),
    r1165: await readJsonIfPresent(options.r1165Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1165.artifact)),
    r1167: await readJsonIfPresent(options.r1167Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1167.artifact)),
    r1170: await readJsonIfPresent(options.r1170Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1170.artifact)),
    r1172: await readJsonIfPresent(options.r1172Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1172.artifact)),
    r1173: await readJsonIfPresent(options.r1173Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1173.artifact)),
    r1174: await readJsonIfPresent(options.r1174Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1174.artifact)),
    r1175: await readJsonIfPresent(options.r1175Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1175.artifact)),
    r1176: await readJsonIfPresent(options.r1176Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1176.artifact)),
    r1185: await readJsonIfPresent(options.r1185Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1185.artifact)),
  };
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1145 rejected unsafe ${key} input: ${formatFindingCount(findings)}`);
    }
  }
}

function summarizeInputs(inputs: Record<InputKey, unknown | null>): Record<InputKey, ArtifactSummary> {
  return {
    r1076: summarizeInput("r1076", inputs.r1076),
    r1135: summarizeInput("r1135", inputs.r1135),
    r1142: summarizeInput("r1142", inputs.r1142),
    r1144: summarizeInput("r1144", inputs.r1144),
    r1148: summarizeInput("r1148", inputs.r1148),
    r1149: summarizeInput("r1149", inputs.r1149),
    r1151: summarizeInput("r1151", inputs.r1151),
    r1152: summarizeInput("r1152", inputs.r1152),
    r1153: summarizeInput("r1153", inputs.r1153),
    r1154: summarizeInput("r1154", inputs.r1154),
    r1155: summarizeInput("r1155", inputs.r1155),
    r1156: summarizeInput("r1156", inputs.r1156),
    r1157: summarizeInput("r1157", inputs.r1157),
    r1158: summarizeInput("r1158", inputs.r1158),
    r1159: summarizeInput("r1159", inputs.r1159),
    r1160: summarizeInput("r1160", inputs.r1160),
    r1161: summarizeInput("r1161", inputs.r1161),
    r1162: summarizeInput("r1162", inputs.r1162),
    r1163: summarizeInput("r1163", inputs.r1163),
    r1164: summarizeInput("r1164", inputs.r1164),
    r1165: summarizeInput("r1165", inputs.r1165),
    r1167: summarizeInput("r1167", inputs.r1167),
    r1170: summarizeInput("r1170", inputs.r1170),
    r1172: summarizeInput("r1172", inputs.r1172),
    r1173: summarizeInput("r1173", inputs.r1173),
    r1174: summarizeInput("r1174", inputs.r1174),
    r1175: summarizeInput("r1175", inputs.r1175),
    r1176: summarizeInput("r1176", inputs.r1176),
    r1185: summarizeInput("r1185", inputs.r1185),
  };
}

function summarizeInput(key: InputKey, input: unknown | null): ArtifactSummary {
  const expected = INPUTS[key];
  const packetId = readStringAt(input, ["packetId"]);
  const schemaVersion = readStringAt(input, ["schemaVersion"]);
  return {
    artifact: expected.artifact,
    packetId: packetId === expected.packetId ? expected.packetId : null,
    schemaVersion: schemaVersion === expected.schemaVersion ? expected.schemaVersion : null,
    status: input ? "available" : "missing",
  };
}

function inputMatchesExpected(key: InputKey, input: unknown | null): boolean {
  const expected = INPUTS[key];
  return readStringAt(input, ["packetId"]) === expected.packetId
    && readStringAt(input, ["schemaVersion"]) === expected.schemaVersion;
}

function requiredNonActionPacketInputsReady(inputs: Record<InputKey, unknown | null>): boolean {
  return (Object.entries(inputs) as Array<[InputKey, unknown | null]>).every(([key, value]) =>
    key === "r1154" || key === "r1155" || key === "r1156" || key === "r1157" || key === "r1158"
    || key === "r1159" || key === "r1160" || key === "r1161" || key === "r1162" || key === "r1163"
    || key === "r1164" || key === "r1165" || key === "r1167" || key === "r1170" || key === "r1172"
    || key === "r1173" || key === "r1174" || key === "r1175" || key === "r1176" || key === "r1185"
    || inputMatchesExpected(key, value)
  );
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

function readBooleanAt(value: unknown | null, pathParts: readonly string[]): boolean | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "boolean" ? resolved : null;
}

function readNumberAt(value: unknown | null, pathParts: readonly string[]): number | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "number" ? resolved : null;
}

function readStringAt(value: unknown | null, pathParts: readonly string[]): string | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
}

function readStringArrayAt(value: unknown | null, pathParts: readonly string[]): string[] {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved) ? resolved.filter((item): item is string => typeof item === "string") : [];
}

function readRecordArrayAt(value: unknown | null, pathParts: readonly string[]): Array<Record<string, unknown>> {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved)
    ? resolved.filter((item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && !Array.isArray(item)
      )
    : [];
}

function readAt(value: unknown | null, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function includesAll(values: readonly string[], requiredValues: readonly string[]): boolean {
  const valueSet = new Set(values);
  return requiredValues.every((value) => valueSet.has(value));
}

function exactStringSet(values: readonly string[], expectedValues: readonly string[]): boolean {
  return values.length === expectedValues.length && includesAll(values, expectedValues);
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function formatFindingCount(findings: readonly string[]): string {
  return `${findings.length} aggregate-egress violation${findings.length === 1 ? "" : "s"}`;
}

function safeBoundary(): R1145OrdinaryConsumerCurrentChainCompletionAuditOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    privateConfigValuesStored: false,
    privateFieldRefsStored: false,
    privateTableRefsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1145: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1145OrdinaryConsumerCurrentChainCompletionAudit({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1076Path: process.env.MURPH_AGE_R1076_CURRENT_AUTORESEARCH_LOOP_EXECUTOR_PATH,
    r1135Path: process.env.MURPH_AGE_R1135_ORDINARY_CONSUMER_AVAILABILITY_MANIFEST_PACKET_PATH,
    r1142Path: process.env.MURPH_AGE_R1142_ORDINARY_CONSUMER_PARTIAL_PRIVATE_CHAIN_RUNNER_PATH,
    r1144Path: process.env.MURPH_AGE_R1144_ORDINARY_CONSUMER_RECIPE_READINESS_CHAIN_RUNNER_PATH,
    r1148Path: process.env.MURPH_AGE_R1148_ORDINARY_CONSUMER_POST_CONFIRMATION_PRIVATE_CONFIG_INTAKE_PATH,
    r1149Path: process.env.MURPH_AGE_R1149_ORDINARY_CONSUMER_LAB_WEARABLE_SUBMISSION_KIT_PATH,
    r1151Path: process.env.MURPH_AGE_R1151_ORDINARY_CONSUMER_FEATURE_ONLY_SUBMISSION_MODE_PATH,
    r1152Path: process.env.MURPH_AGE_R1152_ORDINARY_CONSUMER_FEATURE_ONLY_COVERAGE_CONTEXT_INTAKE_PATH,
    r1153Path: process.env.MURPH_AGE_R1153_ORDINARY_CONSUMER_FEATURE_ONLY_CHAIN_RUNNER_PATH,
    r1154Path: process.env.MURPH_AGE_R1154_ORDINARY_CONSUMER_SAFE_AVAILABILITY_ACTION_PACKET_PATH,
    r1155Path: process.env.MURPH_AGE_R1155_ORDINARY_CONSUMER_SAFE_CONFIRMATION_FEATURE_ONLY_SMOKE_PROOF_PATH,
    r1156Path: process.env.MURPH_AGE_R1156_ORDINARY_CONSUMER_SAFE_CONFIRMATION_HANDOFF_PATH,
    r1157Path: process.env.MURPH_AGE_R1157_ORDINARY_CONSUMER_SAFE_CONFIRMATION_CHAIN_RUNNER_PATH,
    r1158Path: process.env.MURPH_AGE_R1158_ORDINARY_CONSUMER_SAFE_CONFIRMATION_FILL_GUIDE_PATH,
    r1159Path: process.env.MURPH_AGE_R1159_ORDINARY_CONSUMER_SAFE_CONFIRMATION_ANSWER_SHEET_PATH,
    r1160Path: process.env.MURPH_AGE_R1160_R1159_FEATURE_ONLY_SAFE_CONFIRMATION_TRANSCRIPTION_PROOF_PATH,
    r1161Path: process.env.MURPH_AGE_R1161_FEATURE_ONLY_SAFE_AVAILABILITY_CONFIRMATION_MATERIALIZER_PATH,
    r1162Path: process.env.MURPH_AGE_R1162_FEATURE_ONLY_SAFE_CONFIRMATION_ASSERTION_HANDOFF_PATH,
    r1163Path: process.env.MURPH_AGE_R1163_FEATURE_ONLY_SAFE_CONFIRMATION_TO_RESEARCH_RUNNER_PATH,
    r1164Path: process.env.MURPH_AGE_R1164_ORDINARY_CONSUMER_FEATURE_ONLY_RESEARCH_HANDOFF_PATH,
    r1165Path: process.env.MURPH_AGE_R1165_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_RUNNER_PATH,
    r1167Path: process.env.MURPH_AGE_R1167_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_FILL_GUIDE_PATH,
    r1170Path: process.env.MURPH_AGE_R1170_ORDINARY_CONSUMER_SAFE_ASSERTION_SMOKE_PROOF_PATH,
    r1172Path: process.env.MURPH_AGE_R1172_ORDINARY_CONSUMER_SAFE_ASSERTION_MATERIALIZER_PATH,
    r1173Path: process.env.MURPH_AGE_R1173_ORDINARY_CONSUMER_SAFE_ASSERTION_ANSWER_SHEET_PATH,
    r1174Path: process.env.MURPH_AGE_R1174_ORDINARY_CONSUMER_SAFE_NEXT_STEP_PACKET_PATH,
    r1175Path: process.env.MURPH_AGE_R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_PATH,
    r1176Path: process.env.MURPH_AGE_R1176_R1172_R1165_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_PATH,
    r1185Path: process.env.MURPH_AGE_R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    blockers: output.completionAudit.blockers,
    conclusion: output.summary.conclusion,
    completionUnblockerBlockedRequirementIds: output.summary.completionUnblockerBlockedRequirementIds,
    completionUnblockerBlockedStepIds: output.summary.completionUnblockerBlockedStepIds,
    completionUnblockerCommandCount: output.summary.completionUnblockerCommandCount,
    completionUnblockerStepIds: output.summary.completionUnblockerStepIds,
    completionUnblockerTopAllowedValueKindIds: output.summary.completionUnblockerTopAllowedValueKindIds,
    completionUnblockerTopBlockedContentIds: output.summary.completionUnblockerTopBlockedContentIds,
    completionUnblockerTopCommand: output.summary.completionUnblockerTopCommand,
    completionUnblockerTopNextAction: output.summary.completionUnblockerTopNextAction,
    completionUnblockerTopRequirementId: output.summary.completionUnblockerTopRequirementId,
    completionUnblockerTopRequiredInputKindIds: output.summary.completionUnblockerTopRequiredInputKindIds,
    completionUnblockerTopSafeCompletionChecklistItemIds:
      output.summary.completionUnblockerTopSafeCompletionChecklistItemIds,
    completionUnblockerTopStepId: output.summary.completionUnblockerTopStepId,
    featureOnlyCoverageContextIntakeConclusion:
      output.completionAudit.featureOnlyCoverageContextIntake.conclusion,
    featureOnlyCoverageContextIntakeContextStatus:
      output.completionAudit.featureOnlyCoverageContextIntake.contextStatus,
    featureOnlyCoverageContextIntakeReadyForResearchPlanning:
      output.completionAudit.featureOnlyCoverageContextIntake.coverageContextReadyForResearchPlanning,
    featureOnlyCoverageContextIntakeRowLevelDataAcceptedByR1152:
      output.completionAudit.featureOnlyCoverageContextIntake.rowLevelDataAcceptedByR1152,
    featureOnlyChainConclusion:
      output.completionAudit.featureOnlyChainRunner.conclusion,
    featureOnlyChainCoverageContextReadyForResearchPlanning:
      output.completionAudit.featureOnlyChainRunner.coverageContextReadyForResearchPlanning,
    featureOnlyChainCoverageContextAllowed:
      output.completionAudit.featureOnlyChainRunner.featureOnlyCoverageContextAllowed,
    featureOnlyChainModelEvidencePromotionAllowed:
      output.completionAudit.featureOnlyChainRunner.modelEvidencePromotionAllowed,
    featureOnlyChainNextAction:
      output.completionAudit.featureOnlyChainRunner.nextAction,
    featureOnlyChainOutcomeLinkageRequiredForFeatureOnlyContext:
      output.completionAudit.featureOnlyChainRunner.outcomeLinkageRequiredForFeatureOnlyContext,
    featureOnlyChainRowLevelDataAcceptedByR1153:
      output.completionAudit.featureOnlyChainRunner.rowLevelDataAcceptedByR1153,
    safeConfirmationFeatureOnlySmokeProofConclusion:
      output.completionAudit.safeConfirmationFeatureOnlySmokeProof.conclusion,
    safeConfirmationFeatureOnlySmokeProofFeatureOnlyChainConclusion:
      output.completionAudit.safeConfirmationFeatureOnlySmokeProof.featureOnlyChainConclusion,
    safeConfirmationFeatureOnlySmokeProofFeatureOnlyCoverageContextReadyForResearchPlanning:
      output.completionAudit.safeConfirmationFeatureOnlySmokeProof.featureOnlyCoverageContextReadyForResearchPlanning,
    safeConfirmationFeatureOnlySmokeProofModelEvidencePromotionAllowed:
      output.completionAudit.safeConfirmationFeatureOnlySmokeProof.modelEvidencePromotionAllowed,
    safeConfirmationFeatureOnlySmokeProofNextAction:
      output.completionAudit.safeConfirmationFeatureOnlySmokeProof.nextAction,
    safeConfirmationFeatureOnlySmokeProofReadyForRecipeReadinessChain:
      output.completionAudit.safeConfirmationFeatureOnlySmokeProof.readyForRecipeReadinessChain,
    safeConfirmationFeatureOnlySmokeProofRowLevelDataAcceptedByR1155:
      output.completionAudit.safeConfirmationFeatureOnlySmokeProof.rowLevelDataAcceptedByR1155,
    safeConfirmationFeatureOnlySmokeProofSafeAvailabilityConfirmationConclusion:
      output.completionAudit.safeConfirmationFeatureOnlySmokeProof.safeAvailabilityConfirmationConclusion,
    safeConfirmationFeatureOnlySmokeProofSmokeEvidence:
      output.completionAudit.safeConfirmationFeatureOnlySmokeProof.smokeEvidence,
    safeConfirmationHandoffConclusion:
      output.completionAudit.safeConfirmationHandoff.conclusion,
    safeConfirmationHandoffFeatureOnlyPathMechanicallyProven:
      output.completionAudit.safeConfirmationHandoff.featureOnlyPathMechanicallyProven,
    safeConfirmationHandoffHandoffReadyForRowOwner:
      output.completionAudit.safeConfirmationHandoff.handoffReadyForRowOwner,
    safeConfirmationHandoffModelEvidencePromotionAllowed:
      output.completionAudit.safeConfirmationHandoff.modelEvidencePromotionAllowed,
    safeConfirmationHandoffNextAction:
      output.completionAudit.safeConfirmationHandoff.nextAction,
    safeConfirmationHandoffReadyForModelEvidence:
      output.completionAudit.safeConfirmationHandoff.readyForModelEvidence,
    safeConfirmationHandoffReadyForRecipeReadinessChain:
      output.completionAudit.safeConfirmationHandoff.readyForRecipeReadinessChain,
    safeConfirmationHandoffRequiredFeatureOnlySourceFamilyIds:
      output.completionAudit.safeConfirmationHandoff.requiredFeatureOnlySourceFamilyIds,
    safeConfirmationHandoffRequiredSafeCompletionCheckIds:
      output.completionAudit.safeConfirmationHandoff.requiredSafeCompletionCheckIds,
    safeConfirmationHandoffRowLevelDataAcceptedByR1156:
      output.completionAudit.safeConfirmationHandoff.rowLevelDataAcceptedByR1156,
    safeConfirmationHandoffRowOwnerWorkType:
      output.completionAudit.safeConfirmationHandoff.rowOwnerWorkType,
    safeConfirmationHandoffSafeConfirmationStillRequired:
      output.completionAudit.safeConfirmationHandoff.safeConfirmationStillRequired,
    safeConfirmationHandoffSmokeEvidence:
      output.completionAudit.safeConfirmationHandoff.smokeEvidence,
    safeConfirmationChainRunnerConclusion:
      output.completionAudit.safeConfirmationChainRunner.conclusion,
    safeConfirmationChainRunnerConfirmationPathConfigured:
      output.completionAudit.safeConfirmationChainRunner.confirmationPathConfigured,
    safeConfirmationChainRunnerFeatureOnlyCoverageContextReady:
      output.completionAudit.safeConfirmationChainRunner.featureOnlyCoverageContextReady,
    safeConfirmationChainRunnerFeatureOnlyResearchPlanningReady:
      output.completionAudit.safeConfirmationChainRunner.featureOnlyResearchPlanningReady,
    safeConfirmationChainRunnerModelEvidencePromotionAllowed:
      output.completionAudit.safeConfirmationChainRunner.modelEvidencePromotionAllowed,
    safeConfirmationChainRunnerNextAction:
      output.completionAudit.safeConfirmationChainRunner.nextAction,
    safeConfirmationChainRunnerReadyForModelEvidence:
      output.completionAudit.safeConfirmationChainRunner.readyForModelEvidence,
    safeConfirmationChainRunnerReadyForRecipeReadinessChain:
      output.completionAudit.safeConfirmationChainRunner.readyForRecipeReadinessChain,
    safeConfirmationChainRunnerRowLevelDataAcceptedByR1157:
      output.completionAudit.safeConfirmationChainRunner.rowLevelDataAcceptedByR1157,
    safeConfirmationChainRunnerSafeConfirmationStillRequired:
      output.completionAudit.safeConfirmationChainRunner.safeConfirmationStillRequired,
    safeConfirmationFillGuideConclusion:
      output.completionAudit.safeConfirmationFillGuide.conclusion,
    safeConfirmationFillGuideExactSafeFieldEditCount:
      output.completionAudit.safeConfirmationFillGuide.exactSafeFieldEditCount,
    safeConfirmationFillGuideGuideReadyForRowOwnerFill:
      output.completionAudit.safeConfirmationFillGuide.guideReadyForRowOwnerFill,
    safeConfirmationFillGuideNextAction:
      output.completionAudit.safeConfirmationFillGuide.nextAction,
    safeConfirmationFillGuideRequiredInputKindIds:
      output.completionAudit.safeConfirmationFillGuide.requiredInputKindIds,
    safeConfirmationFillGuideRowLevelDataAcceptedByR1158:
      output.completionAudit.safeConfirmationFillGuide.rowLevelDataAcceptedByR1158,
    safeConfirmationAnswerSheetConclusion:
      output.completionAudit.safeConfirmationAnswerSheet.conclusion,
    safeConfirmationAnswerSheetExactSafeAnswerCount:
      output.completionAudit.safeConfirmationAnswerSheet.exactSafeAnswerCount,
    safeConfirmationAnswerSheetReadyForRowOwner:
      output.completionAudit.safeConfirmationAnswerSheet.answerSheetReadyForRowOwner,
    safeConfirmationAnswerSheetNextAction:
      output.completionAudit.safeConfirmationAnswerSheet.nextAction,
    safeConfirmationAnswerSheetRequiredInputKindIds:
      output.completionAudit.safeConfirmationAnswerSheet.requiredInputKindIds,
    safeConfirmationAnswerSheetRowLevelDataAcceptedByR1159:
      output.completionAudit.safeConfirmationAnswerSheet.rowLevelDataAcceptedByR1159,
    safeConfirmationAnswerSheetRowOwnerProvidedValuesStored:
      output.completionAudit.safeConfirmationAnswerSheet.rowOwnerProvidedValuesStored,
    safeConfirmationTranscriptionProofConclusion:
      output.completionAudit.safeConfirmationTranscriptionProof.conclusion,
    safeConfirmationTranscriptionProofConfirmationValuesStoredByR1160:
      output.completionAudit.safeConfirmationTranscriptionProof.confirmationValuesStoredByR1160,
    safeConfirmationTranscriptionProofExactSafeTranscriptionStepCount:
      output.completionAudit.safeConfirmationTranscriptionProof.exactSafeTranscriptionStepCount,
    safeConfirmationTranscriptionProofHypotheticalTranscriptionWouldBeFeatureOnlyReady:
      output.completionAudit.safeConfirmationTranscriptionProof.hypotheticalTranscriptionWouldBeFeatureOnlyReady,
    safeConfirmationTranscriptionProofNextAction:
      output.completionAudit.safeConfirmationTranscriptionProof.nextAction,
    safeConfirmationTranscriptionProofReadyForRowOwnerConfirmation:
      output.completionAudit.safeConfirmationTranscriptionProof.readyForRowOwnerConfirmation,
    safeConfirmationTranscriptionProofRequiredInputKindIds:
      output.completionAudit.safeConfirmationTranscriptionProof.requiredInputKindIds,
    safeConfirmationTranscriptionProofRowLevelDataAcceptedByR1160:
      output.completionAudit.safeConfirmationTranscriptionProof.rowLevelDataAcceptedByR1160,
    safeConfirmationTranscriptionProofRowOwnerConfirmationStillRequired:
      output.completionAudit.safeConfirmationTranscriptionProof.rowOwnerConfirmationStillRequired,
    safeConfirmationTranscriptionProofRowOwnerProvidedValuesStored:
      output.completionAudit.safeConfirmationTranscriptionProof.rowOwnerProvidedValuesStored,
    safeConfirmationMaterializerConclusion:
      output.completionAudit.safeConfirmationMaterializer.conclusion,
    safeConfirmationMaterializerConfirmationValuesStoredInR1161Packet:
      output.completionAudit.safeConfirmationMaterializer.confirmationValuesStoredInR1161Packet,
    safeConfirmationMaterializerExplicitRowOwnerConfirmationAssertionProvided:
      output.completionAudit.safeConfirmationMaterializer.explicitRowOwnerConfirmationAssertionProvided,
    safeConfirmationMaterializerFeatureOnlyConfirmationWouldBeReadyForR1150:
      output.completionAudit.safeConfirmationMaterializer.featureOnlyConfirmationWouldBeReadyForR1150,
    safeConfirmationMaterializerNextAction:
      output.completionAudit.safeConfirmationMaterializer.nextAction,
    safeConfirmationMaterializerRowLevelDataAcceptedByR1161:
      output.completionAudit.safeConfirmationMaterializer.rowLevelDataAcceptedByR1161,
    safeConfirmationMaterializerRowOwnerConfirmationStillRequired:
      output.completionAudit.safeConfirmationMaterializer.rowOwnerConfirmationStillRequired,
    safeConfirmationMaterializerRowOwnerPrivateValuesStored:
      output.completionAudit.safeConfirmationMaterializer.rowOwnerPrivateValuesStored,
    safeConfirmationMaterializerSafeConfirmationArtifact:
      output.completionAudit.safeConfirmationMaterializer.safeConfirmationArtifact,
    safeConfirmationMaterializerSafeConfirmationArtifactWritten:
      output.completionAudit.safeConfirmationMaterializer.safeConfirmationArtifactWritten,
    safeConfirmationMaterializerSafeMaterializedFieldCount:
      output.completionAudit.safeConfirmationMaterializer.safeMaterializedFieldCount,
    safeConfirmationAssertionHandoffConclusion:
      output.completionAudit.safeConfirmationAssertionHandoff.conclusion,
    safeConfirmationAssertionHandoffConfirmationValuesStoredByR1162:
      output.completionAudit.safeConfirmationAssertionHandoff.confirmationValuesStoredByR1162,
    safeConfirmationAssertionHandoffExplicitRowOwnerConfirmationAssertionProvided:
      output.completionAudit.safeConfirmationAssertionHandoff.explicitRowOwnerConfirmationAssertionProvided,
    safeConfirmationAssertionHandoffFeatureOnlyConfirmationWouldBeReadyForR1150:
      output.completionAudit.safeConfirmationAssertionHandoff.featureOnlyConfirmationWouldBeReadyForR1150,
    safeConfirmationAssertionHandoffHandoffReadyForRowOwner:
      output.completionAudit.safeConfirmationAssertionHandoff.handoffReadyForRowOwner,
    safeConfirmationAssertionHandoffMaterializerCommand:
      output.completionAudit.safeConfirmationAssertionHandoff.materializerCommand,
    safeConfirmationAssertionHandoffMaterializerNextAction:
      output.completionAudit.safeConfirmationAssertionHandoff.materializerNextAction,
    safeConfirmationAssertionHandoffMinimumFeaturePairRequired:
      output.completionAudit.safeConfirmationAssertionHandoff.minimumFeaturePairRequired,
    safeConfirmationAssertionHandoffNextAction:
      output.completionAudit.safeConfirmationAssertionHandoff.nextAction,
    safeConfirmationAssertionHandoffRequiredChecklistIds:
      output.completionAudit.safeConfirmationAssertionHandoff.requiredChecklistIds,
    safeConfirmationAssertionHandoffRequiredInputKindIds:
      output.completionAudit.safeConfirmationAssertionHandoff.requiredInputKindIds,
    safeConfirmationAssertionHandoffRowLevelDataAcceptedByR1162:
      output.completionAudit.safeConfirmationAssertionHandoff.rowLevelDataAcceptedByR1162,
    safeConfirmationAssertionHandoffRowOwnerAssertionInferredByR1162:
      output.completionAudit.safeConfirmationAssertionHandoff.rowOwnerAssertionInferredByR1162,
    safeConfirmationAssertionHandoffRowOwnerAssertionStillRequired:
      output.completionAudit.safeConfirmationAssertionHandoff.rowOwnerAssertionStillRequired,
    safeConfirmationAssertionHandoffRowOwnerPrivateValuesStored:
      output.completionAudit.safeConfirmationAssertionHandoff.rowOwnerPrivateValuesStored,
    safeConfirmationAssertionHandoffSafeConfirmationArtifactWritten:
      output.completionAudit.safeConfirmationAssertionHandoff.safeConfirmationArtifactWritten,
    safeConfirmationToResearchRunnerConclusion:
      output.summary.safeConfirmationToResearchRunnerConclusion,
    safeConfirmationToResearchRunnerConfirmedSafeConfirmationArtifact:
      output.summary.safeConfirmationToResearchRunnerConfirmedSafeConfirmationArtifact,
    safeConfirmationToResearchRunnerExplicitRowOwnerAssertionProvided:
      output.summary.safeConfirmationToResearchRunnerExplicitRowOwnerAssertionProvided,
    safeConfirmationToResearchRunnerFeatureOnlyChainRan:
      output.summary.safeConfirmationToResearchRunnerFeatureOnlyChainRan,
    safeConfirmationToResearchRunnerFeatureOnlyResearchPlanningReady:
      output.summary.safeConfirmationToResearchRunnerFeatureOnlyResearchPlanningReady,
    safeConfirmationToResearchRunnerNextAction:
      output.summary.safeConfirmationToResearchRunnerNextAction,
    safeConfirmationToResearchRunnerRowLevelDataAcceptedByR1163:
      output.summary.safeConfirmationToResearchRunnerRowLevelDataAcceptedByR1163,
    safeConfirmationToResearchRunnerRowOwnerAssertionInferredByR1163:
      output.summary.safeConfirmationToResearchRunnerRowOwnerAssertionInferredByR1163,
    safeConfirmationToResearchRunnerRowOwnerAssertionStillRequired:
      output.summary.safeConfirmationToResearchRunnerRowOwnerAssertionStillRequired,
    safeConfirmationToResearchRunnerRowOwnerPrivateValuesStored:
      output.summary.safeConfirmationToResearchRunnerRowOwnerPrivateValuesStored,
    safeConfirmationToResearchRunnerSafeConfirmationArtifactWritten:
      output.summary.safeConfirmationToResearchRunnerSafeConfirmationArtifactWritten,
    featureOnlyResearchHandoffCommand:
      output.summary.featureOnlyResearchHandoffCommand,
    featureOnlyResearchHandoffConclusion:
      output.summary.featureOnlyResearchHandoffConclusion,
    featureOnlyResearchHandoffFeatureOnlyResearchPlanningReady:
      output.summary.featureOnlyResearchHandoffFeatureOnlyResearchPlanningReady,
    featureOnlyResearchHandoffMinimumFeaturePairRequired:
      output.summary.featureOnlyResearchHandoffMinimumFeaturePairRequired,
    featureOnlyResearchHandoffNextAction:
      output.summary.featureOnlyResearchHandoffNextAction,
    featureOnlyResearchHandoffOutcomeLinkedModelEvidenceStillRequired:
      output.summary.featureOnlyResearchHandoffOutcomeLinkedModelEvidenceStillRequired,
    featureOnlyResearchHandoffPrioritizedInputKindIds:
      output.summary.featureOnlyResearchHandoffPrioritizedInputKindIds,
    featureOnlyResearchHandoffResearchPlanningAllowed:
      output.summary.featureOnlyResearchHandoffResearchPlanningAllowed,
    featureOnlyResearchHandoffRowLevelDataAcceptedByR1164:
      output.summary.featureOnlyResearchHandoffRowLevelDataAcceptedByR1164,
    featureOnlyResearchHandoffRowOwnerPrivateValuesStored:
      output.summary.featureOnlyResearchHandoffRowOwnerPrivateValuesStored,
    featureOnlySafeAssertionRunnerCommand:
      output.summary.featureOnlySafeAssertionRunnerCommand,
    featureOnlySafeAssertionRunnerConclusion:
      output.summary.featureOnlySafeAssertionRunnerConclusion,
    featureOnlySafeAssertionRunnerNextAction:
      output.summary.featureOnlySafeAssertionRunnerNextAction,
    featureOnlySafeAssertionRunnerAssertionAccepted:
      output.summary.featureOnlySafeAssertionRunnerAssertionAccepted,
    featureOnlySafeAssertionRunnerAssertionProvided:
      output.summary.featureOnlySafeAssertionRunnerAssertionProvided,
    featureOnlySafeAssertionRunnerAssertionTemplateArtifact:
      output.summary.featureOnlySafeAssertionRunnerAssertionTemplateArtifact,
    featureOnlySafeAssertionRunnerChildR1163Ran:
      output.summary.featureOnlySafeAssertionRunnerChildR1163Ran,
    featureOnlySafeAssertionRunnerFeatureOnlyResearchPlanningReady:
      output.summary.featureOnlySafeAssertionRunnerFeatureOnlyResearchPlanningReady,
    featureOnlySafeAssertionRunnerRequiredInputKindIds:
      output.summary.featureOnlySafeAssertionRunnerRequiredInputKindIds,
    featureOnlySafeAssertionRunnerRequiredAssertionChecklistIds:
      output.summary.featureOnlySafeAssertionRunnerRequiredAssertionChecklistIds,
    featureOnlySafeAssertionRunnerOptionalAddOnFamilyIds:
      output.summary.featureOnlySafeAssertionRunnerOptionalAddOnFamilyIds,
    featureOnlySafeAssertionRunnerValidationReasonIds:
      output.summary.featureOnlySafeAssertionRunnerValidationReasonIds,
    featureOnlySafeAssertionRunnerRowLevelDataAcceptedByR1165:
      output.summary.featureOnlySafeAssertionRunnerRowLevelDataAcceptedByR1165,
    featureOnlySafeAssertionRunnerRowOwnerPrivateValuesStored:
      output.summary.featureOnlySafeAssertionRunnerRowOwnerPrivateValuesStored,
    featureOnlySafeAssertionFillGuideCommand:
      output.summary.featureOnlySafeAssertionFillGuideCommand,
    featureOnlySafeAssertionFillGuideConclusion:
      output.summary.featureOnlySafeAssertionFillGuideConclusion,
    featureOnlySafeAssertionFillGuideNextAction:
      output.summary.featureOnlySafeAssertionFillGuideNextAction,
    featureOnlySafeAssertionFillGuideGuideReadyForRowOwnerFill:
      output.summary.featureOnlySafeAssertionFillGuideGuideReadyForRowOwnerFill,
    featureOnlySafeAssertionFillGuideRequiredInputKindIds:
      output.summary.featureOnlySafeAssertionFillGuideRequiredInputKindIds,
    featureOnlySafeAssertionFillGuideOptionalAddOnFamilyIds:
      output.summary.featureOnlySafeAssertionFillGuideOptionalAddOnFamilyIds,
    featureOnlySafeAssertionFillGuideSafeFieldEditCount:
      output.summary.featureOnlySafeAssertionFillGuideSafeFieldEditCount,
    featureOnlySafeAssertionFillGuideSafeFieldEditPaths:
      output.summary.featureOnlySafeAssertionFillGuideSafeFieldEditPaths,
    featureOnlySafeAssertionFillGuideRowLevelDataAcceptedByR1167:
      output.summary.featureOnlySafeAssertionFillGuideRowLevelDataAcceptedByR1167,
    featureOnlySafeAssertionFillGuideRowOwnerPrivateValuesStored:
      output.summary.featureOnlySafeAssertionFillGuideRowOwnerPrivateValuesStored,
    featureOnlySafeAssertionAnswerSheetCommand:
      output.summary.featureOnlySafeAssertionAnswerSheetCommand,
    featureOnlySafeAssertionAnswerSheetConclusion:
      output.summary.featureOnlySafeAssertionAnswerSheetConclusion,
    featureOnlySafeAssertionAnswerSheetNextAction:
      output.summary.featureOnlySafeAssertionAnswerSheetNextAction,
    featureOnlySafeAssertionAnswerSheetReadyForRowOwner:
      output.summary.featureOnlySafeAssertionAnswerSheetReadyForRowOwner,
    featureOnlySafeAssertionAnswerSheetMaterializerReady:
      output.summary.featureOnlySafeAssertionAnswerSheetMaterializerReady,
    featureOnlySafeAssertionAnswerSheetMaterializerExplicitConfirmationRequired:
      output.summary.featureOnlySafeAssertionAnswerSheetMaterializerExplicitConfirmationRequired,
    featureOnlySafeAssertionAnswerSheetExactSafeAnswerCount:
      output.summary.featureOnlySafeAssertionAnswerSheetExactSafeAnswerCount,
    featureOnlySafeAssertionAnswerSheetAllowedValueKindIds:
      output.summary.featureOnlySafeAssertionAnswerSheetAllowedValueKindIds,
    featureOnlySafeAssertionAnswerSheetBlockedAssertionContentIds:
      output.summary.featureOnlySafeAssertionAnswerSheetBlockedAssertionContentIds,
    featureOnlySafeAssertionMaterializerCommand:
      output.summary.featureOnlySafeAssertionMaterializerCommand,
    featureOnlySafeAssertionMaterializerConclusion:
      output.summary.featureOnlySafeAssertionMaterializerConclusion,
    featureOnlySafeAssertionMaterializerNextAction:
      output.summary.featureOnlySafeAssertionMaterializerNextAction,
    featureOnlySafeAssertionMaterializerExplicitRowOwnerAssertionProvided:
      output.summary.featureOnlySafeAssertionMaterializerExplicitRowOwnerAssertionProvided,
    featureOnlySafeAssertionMaterializerArtifactWritten:
      output.summary.featureOnlySafeAssertionMaterializerArtifactWritten,
    featureOnlySafeAssertionMaterializerRowOwnerAssertionStillRequired:
      output.summary.featureOnlySafeAssertionMaterializerRowOwnerAssertionStillRequired,
    featureOnlySafeAssertionMaterializerWouldBeAcceptedByR1165:
      output.summary.featureOnlySafeAssertionMaterializerWouldBeAcceptedByR1165,
    featureOnlySafeAssertionMaterializerAllowedValueKindIds:
      output.summary.featureOnlySafeAssertionMaterializerAllowedValueKindIds,
    featureOnlySafeAssertionMaterializerBlockedContentIds:
      output.summary.featureOnlySafeAssertionMaterializerBlockedContentIds,
    featureOnlySafeAssertionMaterializerSafeFieldEditCount:
      output.summary.featureOnlySafeAssertionMaterializerSafeFieldEditCount,
    featureOnlySafeAssertionSmokeProofCommand:
      output.summary.featureOnlySafeAssertionSmokeProofCommand,
    featureOnlySafeAssertionSmokeProofConclusion:
      output.summary.featureOnlySafeAssertionSmokeProofConclusion,
    featureOnlySafeAssertionSmokeProofNextAction:
      output.summary.featureOnlySafeAssertionSmokeProofNextAction,
    featureOnlySafeAssertionSmokeProofPassed:
      output.summary.featureOnlySafeAssertionSmokeProofPassed,
    featureOnlySafeAssertionSmokeProofSynthetic:
      output.summary.featureOnlySafeAssertionSmokeProofSynthetic,
    featureOnlySafeAssertionSmokeProofRealEvidenceProduced:
      output.summary.featureOnlySafeAssertionSmokeProofRealEvidenceProduced,
    featureOnlySafeAssertionSmokeProofModelEvidencePromotionAllowed:
      output.summary.featureOnlySafeAssertionSmokeProofModelEvidencePromotionAllowed,
    featureOnlySafeAssertionSmokeProofLiveChainGateStillRequired:
      output.summary.featureOnlySafeAssertionSmokeProofLiveChainGateStillRequired,
    featureOnlySafeAssertionSmokeProofR1165AssertionAccepted:
      output.summary.featureOnlySafeAssertionSmokeProofR1165AssertionAccepted,
    featureOnlySafeAssertionSmokeProofR1165ChildR1163Ran:
      output.summary.featureOnlySafeAssertionSmokeProofR1165ChildR1163Ran,
    featureOnlySafeAssertionSmokeProofR1165FeatureOnlyResearchPlanningReady:
      output.summary.featureOnlySafeAssertionSmokeProofR1165FeatureOnlyResearchPlanningReady,
    featureOnlySafeAssertionSmokeProofSafeFieldEditCount:
      output.summary.featureOnlySafeAssertionSmokeProofSafeFieldEditCount,
    featureOnlySafeAssertionSmokeProofSafeFieldEditPaths:
      output.summary.featureOnlySafeAssertionSmokeProofSafeFieldEditPaths,
    featureOnlySafeAssertionSmokeProofRowLevelDataAcceptedByR1170:
      output.summary.featureOnlySafeAssertionSmokeProofRowLevelDataAcceptedByR1170,
    featureOnlySafeAssertionSmokeProofRowOwnerPrivateValuesStored:
      output.summary.featureOnlySafeAssertionSmokeProofRowOwnerPrivateValuesStored,
    featureOnlySafeAssertionBridgeSmokeCommand:
      output.summary.featureOnlySafeAssertionBridgeSmokeCommand,
    featureOnlySafeAssertionBridgeSmokeAllowedValueKindIds:
      output.summary.featureOnlySafeAssertionBridgeSmokeAllowedValueKindIds,
    featureOnlySafeAssertionBridgeSmokeBlockedContentIds:
      output.summary.featureOnlySafeAssertionBridgeSmokeBlockedContentIds,
    featureOnlySafeAssertionBridgeSmokeOptionalAddOnFamilyIds:
      output.summary.featureOnlySafeAssertionBridgeSmokeOptionalAddOnFamilyIds,
    featureOnlySafeAssertionBridgeSmokeConclusion:
      output.summary.featureOnlySafeAssertionBridgeSmokeConclusion,
    featureOnlySafeAssertionBridgeSmokeNextAction:
      output.summary.featureOnlySafeAssertionBridgeSmokeNextAction,
    featureOnlySafeAssertionBridgeSmokePassed:
      output.summary.featureOnlySafeAssertionBridgeSmokePassed,
    featureOnlySafeAssertionBridgeSmokeSynthetic:
      output.summary.featureOnlySafeAssertionBridgeSmokeSynthetic,
    featureOnlySafeAssertionBridgeSmokeRealEvidenceProduced:
      output.summary.featureOnlySafeAssertionBridgeSmokeRealEvidenceProduced,
    featureOnlySafeAssertionBridgeSmokeModelEvidencePromotionAllowed:
      output.summary.featureOnlySafeAssertionBridgeSmokeModelEvidencePromotionAllowed,
    featureOnlySafeAssertionBridgeSmokeLiveChainGateStillRequired:
      output.summary.featureOnlySafeAssertionBridgeSmokeLiveChainGateStillRequired,
    featureOnlySafeAssertionBridgeSmokeR1172MaterializedAssertionWritten:
      output.summary.featureOnlySafeAssertionBridgeSmokeR1172MaterializedAssertionWritten,
    featureOnlySafeAssertionBridgeSmokeR1172WouldBeAcceptedByR1165:
      output.summary.featureOnlySafeAssertionBridgeSmokeR1172WouldBeAcceptedByR1165,
    featureOnlySafeAssertionBridgeSmokeR1165AssertionAccepted:
      output.summary.featureOnlySafeAssertionBridgeSmokeR1165AssertionAccepted,
    featureOnlySafeAssertionBridgeSmokeR1165ChildR1163Ran:
      output.summary.featureOnlySafeAssertionBridgeSmokeR1165ChildR1163Ran,
    featureOnlySafeAssertionBridgeSmokeR1165FeatureOnlyResearchPlanningReady:
      output.summary.featureOnlySafeAssertionBridgeSmokeR1165FeatureOnlyResearchPlanningReady,
    featureOnlySafeAssertionBridgeSmokeR1163FeatureOnlyResearchPlanningReady:
      output.summary.featureOnlySafeAssertionBridgeSmokeR1163FeatureOnlyResearchPlanningReady,
    featureOnlySafeAssertionBridgeSmokeSafeFieldEditCount:
      output.summary.featureOnlySafeAssertionBridgeSmokeSafeFieldEditCount,
    featureOnlySafeAssertionBridgeSmokeSafeFieldEditPaths:
      output.summary.featureOnlySafeAssertionBridgeSmokeSafeFieldEditPaths,
    featureOnlySafeAssertionBridgeSmokeRowLevelDataAcceptedByR1175:
      output.summary.featureOnlySafeAssertionBridgeSmokeRowLevelDataAcceptedByR1175,
    featureOnlySafeAssertionBridgeSmokeRowOwnerPrivateValuesStored:
      output.summary.featureOnlySafeAssertionBridgeSmokeRowOwnerPrivateValuesStored,
    featureOnlySafeAssertionBridgeSmokeRowParsingPerformedByR1175:
      output.summary.featureOnlySafeAssertionBridgeSmokeRowParsingPerformedByR1175,
    featureOnlySafeNextStepPacketCommand:
      output.summary.featureOnlySafeNextStepPacketCommand,
    featureOnlySafeNextStepPacketAllowedValueKindIds:
      output.summary.featureOnlySafeNextStepPacketAllowedValueKindIds,
    featureOnlySafeNextStepPacketBlockedContentIds:
      output.summary.featureOnlySafeNextStepPacketBlockedContentIds,
    featureOnlySafeNextStepPacketConclusion:
      output.summary.featureOnlySafeNextStepPacketConclusion,
    featureOnlySafeNextStepPacketNextAction:
      output.summary.featureOnlySafeNextStepPacketNextAction,
    featureOnlySafeNextStepPacketReadyForR1165Runner:
      output.summary.featureOnlySafeNextStepPacketReadyForR1165Runner,
    featureOnlySafeNextStepPacketReadyForRowOwnerR1172Confirmation:
      output.summary.featureOnlySafeNextStepPacketReadyForRowOwnerR1172Confirmation,
    featureOnlySafeNextStepPacketReadyForRowOwnerR1176LiveChainConfirmation:
      output.summary.featureOnlySafeNextStepPacketReadyForRowOwnerR1176LiveChainConfirmation,
    featureOnlySafeNextStepPacketR1176LiveChainCommand:
      output.summary.featureOnlySafeNextStepPacketR1176LiveChainCommand,
    featureOnlySafeNextStepPacketSafeFieldEditCount:
      output.summary.featureOnlySafeNextStepPacketSafeFieldEditCount,
    featureOnlySafeNextStepPacketSafeFieldEditPaths:
      output.summary.featureOnlySafeNextStepPacketSafeFieldEditPaths,
    featureOnlySafeNextStepPacketRowLevelDataAcceptedByR1174:
      output.summary.featureOnlySafeNextStepPacketRowLevelDataAcceptedByR1174,
    featureOnlySafeNextStepPacketRowOwnerPrivateValuesStored:
      output.summary.featureOnlySafeNextStepPacketRowOwnerPrivateValuesStored,
    featureOnlySafeNextStepPacketRowOwnerProvidedValuesStored:
      output.summary.featureOnlySafeNextStepPacketRowOwnerProvidedValuesStored,
    featureOnlySafeAssertionLiveChainCommand:
      output.summary.featureOnlySafeAssertionLiveChainCommand,
    featureOnlySafeAssertionLiveChainAllowedValueKindIds:
      output.summary.featureOnlySafeAssertionLiveChainAllowedValueKindIds,
    featureOnlySafeAssertionLiveChainBlockedContentIds:
      output.summary.featureOnlySafeAssertionLiveChainBlockedContentIds,
    featureOnlySafeAssertionLiveChainOptionalAddOnFamilyIds:
      output.summary.featureOnlySafeAssertionLiveChainOptionalAddOnFamilyIds,
    featureOnlySafeAssertionLiveChainCompletionModeId:
      output.summary.featureOnlySafeAssertionLiveChainCompletionModeId,
    featureOnlySafeAssertionLiveChainConclusion:
      output.summary.featureOnlySafeAssertionLiveChainConclusion,
    featureOnlySafeAssertionLiveChainNextAction:
      output.summary.featureOnlySafeAssertionLiveChainNextAction,
    featureOnlySafeAssertionLiveChainReady:
      output.summary.featureOnlySafeAssertionLiveChainReady,
    featureOnlySafeAssertionLiveChainExplicitRowOwnerAssertionProvided:
      output.summary.featureOnlySafeAssertionLiveChainExplicitRowOwnerAssertionProvided,
    featureOnlySafeAssertionLiveChainFeatureOnlyResearchPlanningReady:
      output.summary.featureOnlySafeAssertionLiveChainFeatureOnlyResearchPlanningReady,
    featureOnlySafeAssertionLiveChainRealEvidenceProduced:
      output.summary.featureOnlySafeAssertionLiveChainRealEvidenceProduced,
    featureOnlySafeAssertionLiveChainModelEvidencePromotionAllowed:
      output.summary.featureOnlySafeAssertionLiveChainModelEvidencePromotionAllowed,
    featureOnlySafeAssertionLiveChainOutcomeLinkedModelEvidenceStillRequired:
      output.summary.featureOnlySafeAssertionLiveChainOutcomeLinkedModelEvidenceStillRequired,
    featureOnlySafeAssertionLiveChainRowOwnerAssertionStillRequired:
      output.summary.featureOnlySafeAssertionLiveChainRowOwnerAssertionStillRequired,
    featureOnlySafeAssertionLiveChainRowOwnerHandoffReasonId:
      output.summary.featureOnlySafeAssertionLiveChainRowOwnerHandoffReasonId,
    featureOnlySafeAssertionLiveChainR1172MaterializedAssertionWritten:
      output.summary.featureOnlySafeAssertionLiveChainR1172MaterializedAssertionWritten,
    featureOnlySafeAssertionLiveChainR1172WouldBeAcceptedByR1165:
      output.summary.featureOnlySafeAssertionLiveChainR1172WouldBeAcceptedByR1165,
    featureOnlySafeAssertionLiveChainR1165AssertionAccepted:
      output.summary.featureOnlySafeAssertionLiveChainR1165AssertionAccepted,
    featureOnlySafeAssertionLiveChainR1165ChildR1163Ran:
      output.summary.featureOnlySafeAssertionLiveChainR1165ChildR1163Ran,
    featureOnlySafeAssertionLiveChainR1165FeatureOnlyResearchPlanningReady:
      output.summary.featureOnlySafeAssertionLiveChainR1165FeatureOnlyResearchPlanningReady,
    featureOnlySafeAssertionLiveChainR1163FeatureOnlyResearchPlanningReady:
      output.summary.featureOnlySafeAssertionLiveChainR1163FeatureOnlyResearchPlanningReady,
    featureOnlySafeAssertionLiveChainSafeFieldEditCount:
      output.summary.featureOnlySafeAssertionLiveChainSafeFieldEditCount,
    featureOnlySafeAssertionLiveChainSafeFieldEditPaths:
      output.summary.featureOnlySafeAssertionLiveChainSafeFieldEditPaths,
    featureOnlySafeAssertionLiveChainSafeCompletionChecklistItemIds:
      output.summary.featureOnlySafeAssertionLiveChainSafeCompletionChecklistItemIds,
    featureOnlySafeAssertionLiveChainRowLevelDataAcceptedByR1176:
      output.summary.featureOnlySafeAssertionLiveChainRowLevelDataAcceptedByR1176,
    featureOnlySafeAssertionLiveChainRowOwnerPrivateValuesStored:
      output.summary.featureOnlySafeAssertionLiveChainRowOwnerPrivateValuesStored,
    featureOnlySafeAssertionLiveChainRowParsingPerformedByR1176:
      output.summary.featureOnlySafeAssertionLiveChainRowParsingPerformedByR1176,
    safeResponseSmokeProofCommand:
      output.summary.safeResponseSmokeProofCommand,
    safeResponseSmokeProofConclusion:
      output.summary.safeResponseSmokeProofConclusion,
    safeResponseSmokeProofLiveR1184Conclusion:
      output.summary.safeResponseSmokeProofLiveR1184Conclusion,
    safeResponseSmokeProofLiveR1184ReadyForSyntheticSmoke:
      output.summary.safeResponseSmokeProofLiveR1184ReadyForSyntheticSmoke,
    safeResponseSmokeProofNextRealAction:
      output.summary.safeResponseSmokeProofNextRealAction,
    safeResponseSmokeProofNextRealActionCommand:
      output.summary.safeResponseSmokeProofNextRealActionCommand,
    safeResponseSmokeProofNextRealActionRequiresExplicitRowOwnerAssertion:
      output.summary.safeResponseSmokeProofNextRealActionRequiresExplicitRowOwnerAssertion,
    safeResponseSmokeProofMinimumFeaturePairRequired:
      output.summary.safeResponseSmokeProofMinimumFeaturePairRequired,
    safeResponseSmokeProofPrioritizedInputKindIds:
      output.summary.safeResponseSmokeProofPrioritizedInputKindIds,
    safeResponseSmokeProofRequiredResponseFieldIds:
      output.summary.safeResponseSmokeProofRequiredResponseFieldIds,
    safeResponseSmokeProofSafeExecutionFeatureSlotIds:
      output.summary.safeResponseSmokeProofSafeExecutionFeatureSlotIds,
    safeResponseSmokeProofSyntheticPathAdvancedToFeatureOnlyResearchPlanning:
      output.summary.safeResponseSmokeProofSyntheticPathAdvancedToFeatureOnlyResearchPlanning,
    safeResponseSmokeProofSyntheticSmokeRan:
      output.summary.safeResponseSmokeProofSyntheticSmokeRan,
    safeResponseSmokeProofModelEvidencePromotionAllowed:
      output.summary.safeResponseSmokeProofModelEvidencePromotionAllowed,
    safeResponseSmokeProofProductDisplayAuthorized:
      output.summary.safeResponseSmokeProofProductDisplayAuthorized,
    safeResponseSmokeProofRowLevelDataAcceptedByR1185:
      output.summary.safeResponseSmokeProofRowLevelDataAcceptedByR1185,
    safeResponseSmokeProofRowOwnerConfirmationInferredByR1185:
      output.summary.safeResponseSmokeProofRowOwnerConfirmationInferredByR1185,
    safeResponseSmokeProofRowOwnerPrivateValuesStored:
      output.summary.safeResponseSmokeProofRowOwnerPrivateValuesStored,
    safeResponseSmokeProofRowParsingPerformedByR1185:
      output.summary.safeResponseSmokeProofRowParsingPerformedByR1185,
    safeResponseSmokeProofLiveArtifactsMutatedByR1185:
      output.summary.safeResponseSmokeProofLiveArtifactsMutatedByR1185,
    featureOnlyCoverageContextAllowed:
      output.completionAudit.featureOnlySubmissionMode.featureOnlyCoverageContextAllowed,
    featureOnlyCoverageRequiresPreferredPair:
      output.completionAudit.featureOnlySubmissionMode.featureOnlyCoverageRequiresPreferredPair,
    featureOnlyModeConclusion: output.completionAudit.featureOnlySubmissionMode.conclusion,
    featureOnlyModeMinimumFeaturePairRequired:
      output.completionAudit.featureOnlySubmissionMode.minimumFeaturePairRequired,
    featureOnlyModeModelEvidencePromotionAllowed:
      output.completionAudit.featureOnlySubmissionMode.modelEvidencePromotionAllowed,
    featureOnlyModeOutcomeLinkageRequiredForFeatureOnlyContext:
      output.completionAudit.featureOnlySubmissionMode.outcomeLinkageRequiredForFeatureOnlyContext,
    featureOnlyModeOutcomeLinkedEvidenceReady:
      output.completionAudit.featureOnlySubmissionMode.outcomeLinkedEvidenceReady,
    featureOnlyModeRowLevelDataAcceptedByR1151:
      output.completionAudit.featureOnlySubmissionMode.rowLevelDataAcceptedByR1151,
    featureOnlyModeSupportedFeatureFamilyIds:
      output.completionAudit.featureOnlySubmissionMode.supportedFeatureFamilyIds,
    goalAchieved: output.summary.goalAchieved,
    missingRequirementIds: output.completionAudit.missingRequirementIds,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    postConfirmationPrivateConfigIntakeConclusion:
      output.summary.postConfirmationPrivateConfigIntakeConclusion,
    postConfirmationPrivateConfigIntakeNextAction:
      output.summary.postConfirmationPrivateConfigIntakeNextAction,
    postConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketNextAction:
      output.summary.postConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketNextAction,
    privateRouteConfigReadyForR1142: output.completionAudit.routeEvidenceState.privateRouteConfigReadyForR1142,
    privateRouteConfigStatus: output.completionAudit.routeEvidenceState.privateRouteConfigStatus,
    privateRouteConfigSuppliedToIntake: output.completionAudit.routeEvidenceState.privateRouteConfigSuppliedToIntake,
    productDisplayAuthorized: output.productDisplayAuthorized,
    readyToMarkComplete: output.summary.readyToMarkComplete,
    rowParsingPerformedByR1145: output.summary.rowParsingPerformedByR1145,
    safeAvailabilityActionPacketConclusion:
      output.completionAudit.safeAvailabilityActionPacket.conclusion,
    safeAvailabilityActionPacketFillableTemplateArtifact:
      output.completionAudit.safeAvailabilityActionPacket.fillableTemplateArtifact,
    safeAvailabilityActionPacketFeatureOnlyFillableTemplateArtifact:
      output.completionAudit.safeAvailabilityActionPacket.featureOnlyFillableTemplateArtifact,
    safeAvailabilityActionPacketFeatureOnlyCoverageContextReady:
      output.completionAudit.safeAvailabilityActionPacket.featureOnlyCoverageContextReady,
    safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact:
      output.completionAudit.safeAvailabilityActionPacket.featureOnlyQuickstartArtifact,
    safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount:
      output.completionAudit.safeAvailabilityActionPacket.featureOnlyQuickstartSafeFieldEditCount,
    safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths:
      output.completionAudit.safeAvailabilityActionPacket.featureOnlyQuickstartSafeFieldEditPaths,
    safeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds:
      output.completionAudit.safeAvailabilityActionPacket.missingFeatureOnlySourceFamilyIds,
    safeAvailabilityActionPacketMissingRequiredSourceFamilyIds:
      output.completionAudit.safeAvailabilityActionPacket.missingRequiredSourceFamilyIds,
    safeAvailabilityActionPacketNextAction:
      output.completionAudit.safeAvailabilityActionPacket.nextAction,
    safeAvailabilityActionPacketCompletionModeIds:
      output.completionAudit.safeAvailabilityActionPacket.ordinarySubmitterCompletionModeIds,
    safeAvailabilityActionPacketChecklistItemIds:
      output.completionAudit.safeAvailabilityActionPacket.ordinarySubmitterSafeCompletionChecklistItemIds,
    safeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain:
      output.completionAudit.safeAvailabilityActionPacket.readyForOutcomeLinkedRecipeReadinessChain,
    safeAvailabilityActionPacketRowLevelDataAcceptedByR1154:
      output.completionAudit.safeAvailabilityActionPacket.rowLevelDataAcceptedByR1154,
    schemaVersion: output.schemaVersion,
    status: output.status,
    targetAgeBand: output.summary.targetAgeBand,
    targetInputPriority: output.summary.targetInputPriority,
    topMissingRequirement: output.summary.topMissingRequirement,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1145 current-chain completion audit failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
