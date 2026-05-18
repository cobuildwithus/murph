import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1145_ORDINARY_CONSUMER_CURRENT_CHAIN_COMPLETION_AUDIT_SCHEMA_VERSION,
  runR1145OrdinaryConsumerCurrentChainCompletionAudit,
} from "./r1145-ordinary-consumer-current-chain-completion-audit.ts";
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
  R1174_ORDINARY_CONSUMER_SAFE_NEXT_STEP_PACKET_SCHEMA_VERSION,
  R1174_SAFE_NEXT_STEP_PACKET_COMMAND,
} from "./r1174-ordinary-consumer-safe-next-step-packet.ts";
import {
  R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_COMMAND,
  R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_SCHEMA_VERSION,
} from "./r1175-r1172-to-r1165-safe-assertion-bridge-smoke.ts";
import {
  R1176_R1172_R1165_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_SCHEMA_VERSION,
  R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
} from "./r1176-r1172-r1165-row-owner-safe-assertion-chain-runner.ts";
import {
  R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND,
} from "./r1183-average-submitter-safe-response-materializer.ts";
import {
  R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_COMMAND,
  R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_SCHEMA_VERSION,
} from "./r1185-average-submitter-safe-response-smoke-proof.ts";

const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first";
const PRIMARY_INPUT_FAMILY_IDS = [
  "bloodwork_glycemia",
  "common_bloodwork_core",
  "wearable_activity_daily",
  "vitals_body_context",
];
const ROUTE_RECIPE_IDS = [
  "lab_plus_wearable_minimum_manifest",
  "lab_glycemia_minimum_manifest",
  "wearable_activity_minimum_manifest",
  "full_labs_wearable_first_pass_manifest",
];
const REQUIRED_FIELD_REFS = [
  "personJoinKey",
  "dateOrTimeKey",
  "outcomeEvent",
  "labGlycemia",
  "wearableActivity",
];
const REQUIRED_TABLE_REFS = [
  "primaryTableRef",
  "outcomeTableRef",
  "labTableRef",
  "wearableTableRef",
];
const ROUTE_IDS = [
  "lab_glycemia_minimum_route",
  "wearable_activity_minimum_route",
];
const FEATURE_ONLY_PAIR_FAMILY_IDS = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
];
const R1158_REQUIRED_INPUT_KIND_IDS = [
  "lab_portal_export_or_spreadsheet",
  "phone_watch_or_wearable_activity_export",
];
const R1158_REQUIRED_CHECKLIST_IDS = [
  "confirm_target_age_band_without_identifiers",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
];
const FEATURE_ONLY_SAFE_COMPLETION_MODE_ID = "feature_only_lab_wearable_coverage";
const R1176_ROW_OWNER_HANDOFF_REASON_ID =
  "confirm_feature_only_lab_wearable_availability_before_r1176_live_chain";
const R1165_REQUIRED_ASSERTION_CHECKLIST_IDS = [
  "assert_target_age_band_roughly_16_50",
  "assert_glycemia_bloodwork_export_available",
  "assert_daily_wearable_activity_export_available",
  "assert_no_private_values_identifiers_paths_headers_or_rows",
];
const R1158_OPTIONAL_ADD_ON_FAMILY_IDS = [
  "common_bloodwork_core",
  "vitals_body_context",
];
const R1159_ANSWER_SHEET_NEXT_ACTION = "fill_r1150_feature_only_safe_confirmation_from_r1159_answer_sheet";
const R1160_TRANSCRIPTION_PROOF_NEXT_ACTION =
  "row_owner_confirm_r1150_feature_only_safe_availability_from_r1160_transcription_proof";
const R1161_MATERIALIZER_NEXT_ACTION =
  "rerun_r1161_with_row_owner_feature_only_confirmation_assertion";
const R1161_MATERIALIZED_NEXT_ACTION =
  "run_r1150_intake_with_r1161_confirmed_feature_only_safe_availability_confirmation";
const R1162_ASSERTION_HANDOFF_NEXT_ACTION =
  "row_owner_assert_feature_only_lab_wearable_availability_then_run_r1161_materializer";
const R1163_ASSERTION_RUNNER_NEXT_ACTION =
  "row_owner_assert_feature_only_lab_wearable_availability_then_run_r1163_runner";
const R1164_FEATURE_ONLY_HANDOFF_NEXT_ACTION =
  "complete_r1163_feature_only_availability_assertion_contract";
const R1165_SAFE_ASSERTION_RUNNER_NEXT_ACTION =
  "fill_r1165_row_owner_feature_only_safe_assertion_template";
const R1172_SAFE_ASSERTION_MATERIALIZER_NEXT_ACTION =
  "rerun_r1172_with_row_owner_feature_only_safe_assertion_confirmation";
const R1176_SAFE_ASSERTION_LIVE_CHAIN_NEXT_ACTION =
  "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation";
const R1185_SAFE_RESPONSE_NEXT_REAL_ACTION = "obtain_real_row_owner_safe_confirmation_then_rerun_r1183";
const REFRESH_CURRENT_CHAIN_WITH_R1161_ACTION =
  "refresh_r1076_r1135_r1142_r1144_r1148_r1149_r1151_r1152_r1153_r1154_r1155_r1156_r1157_r1158_r1159_r1160_r1161_current_chain_artifacts";
const REFRESH_CURRENT_CHAIN_WITH_R1162_ACTION =
  "refresh_r1076_r1135_r1142_r1144_r1148_r1149_r1151_r1152_r1153_r1154_r1155_r1156_r1157_r1158_r1159_r1160_r1161_r1162_current_chain_artifacts";
const ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS = [
  "confirm_target_age_band_without_identifiers",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
  "confirm_outcome_linkage_and_time_alignment_if_model_evidence",
  "confirm_aggregate_count_bands_if_model_evidence",
];
const ORDINARY_SUBMITTER_COMPLETION_MODE_IDS = [
  "feature_only_lab_wearable_coverage",
  "outcome_linked_lab_wearable_model_evidence",
];
const R1150_FULL_CONFIRMATION_TEMPLATE_ARTIFACT =
  "r1150-fillable-ordinary-consumer-safe-availability-confirmation.json";
const R1150_FEATURE_ONLY_CONFIRMATION_TEMPLATE_ARTIFACT =
  "r1150-fillable-feature-only-safe-availability-confirmation.json";
const R1154_FEATURE_ONLY_QUICKSTART_ARTIFACT = "r1154-feature-only-safe-confirmation-quickstart.json";
const REQUIRED_ATTESTATION_KEYS = [
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
];
const R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS = [
  "aggregateReadinessFacts.targetAgeBand",
  "sourceFamilies[bloodwork_glycemia].available",
  "sourceFamilies[wearable_activity_daily].available",
  "rowOwnerAssertionsConfirmed",
  ...REQUIRED_ATTESTATION_KEYS.map((key) => `attestations.${key}`),
];
const R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS = [
  "sourceFamilies[bloodwork_glycemia].available",
  "sourceFamilies[wearable_activity_daily].available",
  "sourceFamilies[common_bloodwork_core].available",
  "sourceFamilies[vitals_body_context].available",
  "rowOwnerAssertionsConfirmed",
  "privateContentExcluded",
  ...REQUIRED_ATTESTATION_KEYS.map((key) => `attestations.${key}`),
];
const R1142_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH=<availability-manifest.json> MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH=<partial-private-config.json> pnpm exec tsx scripts/murph-age/r1142-ordinary-consumer-partial-private-chain-runner.ts";
const R1144_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ID=<recipe-id> MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ASSERTIONS_CONFIRMED=true pnpm exec tsx scripts/murph-age/r1144-ordinary-consumer-recipe-readiness-chain-runner.ts";
const R1148_PRIVATE_CONFIG_INTAKE_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH=<partial-private-config.json> pnpm exec tsx scripts/murph-age/r1148-ordinary-consumer-post-confirmation-private-config-intake.ts";
const R1157_COMMAND =
  "MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_PATH=<safe-availability-confirmation.json> pnpm exec tsx scripts/murph-age/r1157-ordinary-consumer-safe-confirmation-chain-runner.ts";
const COMPLETION_UNBLOCKER_STEP_IDS = [
  "confirm_feature_only_lab_wearable_safe_availability",
  "confirm_lab_wearable_recipe_route_requirements",
  "provide_lab_wearable_private_route_config",
  "run_real_lab_wearable_route_metrics",
];
const SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS = ["booleans_only", "fixed_enumerated_ids_only"];
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
];

describe("R1145 ordinary consumer current-chain completion audit", () => {
  it("keeps the latest objective focused on ordinary bloodwork/labs and wearable data but blocked on real route evidence", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1145-blocked-"));
    try {
      const paths = await writeInputs(tmp);
      const { output, outputPath } = await runR1145OrdinaryConsumerCurrentChainCompletionAudit({
        createdAt: "2026-05-16T18:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1145-ordinary-consumer-current-chain-completion-audit.latest.json");
      expect(output.schemaVersion).toBe(R1145_ORDINARY_CONSUMER_CURRENT_CHAIN_COMPLETION_AUDIT_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_current_chain_completion_audit_blocked_on_row_owner_route_evidence",
        goalAchieved: false,
        nextAction: R1162_ASSERTION_HANDOFF_NEXT_ACTION,
        completionUnblockerBlockedRequirementIds: [
          "row_owner_availability_assertions_confirmed",
          "confirmed_recipe_route_requirements_available",
          "private_route_config_supplied",
          "real_lab_wearable_route_metrics_recorded",
        ],
        completionUnblockerBlockedStepIds: COMPLETION_UNBLOCKER_STEP_IDS,
        completionUnblockerCommandCount: 4,
        completionUnblockerStepIds: COMPLETION_UNBLOCKER_STEP_IDS,
        completionUnblockerTopAllowedValueKindIds: SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
        completionUnblockerTopBlockedContentIds: SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS,
        completionUnblockerTopCommand: R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
        completionUnblockerTopNextAction: R1176_SAFE_ASSERTION_LIVE_CHAIN_NEXT_ACTION,
        completionUnblockerTopRequirementId: "row_owner_availability_assertions_confirmed",
        completionUnblockerTopRequiredInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
        completionUnblockerTopSafeCompletionChecklistItemIds: R1158_REQUIRED_CHECKLIST_IDS,
        completionUnblockerTopStepId: "confirm_feature_only_lab_wearable_safe_availability",
        productDisplayAuthorized: false,
        readyToMarkComplete: false,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1145: false,
        safeAvailabilityActionPacketConclusion: "safe_availability_action_packet_waiting_on_safe_confirmation",
        safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact: R1154_FEATURE_ONLY_QUICKSTART_ARTIFACT,
        safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount:
          R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
        safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths:
          R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS,
        safeAvailabilityActionPacketNextAction: "fill_safe_availability_confirmation_from_template",
        safeConfirmationFeatureOnlySmokeProofConclusion:
          "ordinary_safe_confirmation_feature_only_smoke_passed_non_evidence",
        safeConfirmationFeatureOnlySmokeProofModelEvidencePromotionAllowed: false,
        safeConfirmationFeatureOnlySmokeProofReadyForRecipeReadinessChain: false,
        safeConfirmationFeatureOnlySmokeProofRowLevelDataAcceptedByR1155: false,
        safeConfirmationFeatureOnlySmokeProofSmokeEvidence: false,
        safeConfirmationHandoffConclusion:
          "ordinary_safe_confirmation_handoff_ready_for_row_owner_fill_non_evidence",
        safeConfirmationHandoffFeatureOnlyPathMechanicallyProven: true,
        safeConfirmationHandoffHandoffReadyForRowOwner: true,
        safeConfirmationHandoffModelEvidencePromotionAllowed: false,
        safeConfirmationHandoffNextAction: "fill_safe_availability_confirmation_from_template",
        safeConfirmationHandoffReadyForModelEvidence: false,
        safeConfirmationHandoffReadyForRecipeReadinessChain: false,
        safeConfirmationHandoffRowLevelDataAcceptedByR1156: false,
        safeConfirmationHandoffSafeConfirmationStillRequired: true,
        safeConfirmationHandoffSmokeEvidence: false,
        safeConfirmationChainRunnerConclusion:
          "ordinary_safe_confirmation_chain_waiting_on_safe_confirmation",
        safeConfirmationChainRunnerFeatureOnlyResearchPlanningReady: false,
        safeConfirmationChainRunnerModelEvidencePromotionAllowed: false,
        safeConfirmationChainRunnerNextAction: "fill_safe_availability_confirmation_from_template",
        safeConfirmationChainRunnerReadyForModelEvidence: false,
        safeConfirmationChainRunnerReadyForRecipeReadinessChain: false,
        safeConfirmationChainRunnerRowLevelDataAcceptedByR1157: false,
        safeConfirmationChainRunnerSafeConfirmationStillRequired: true,
        safeConfirmationFillGuideConclusion: "ordinary_safe_confirmation_fill_guide_ready_non_evidence",
        safeConfirmationFillGuideExactSafeFieldEditCount: R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
        safeConfirmationFillGuideGuideReadyForRowOwnerFill: true,
        safeConfirmationFillGuideNextAction: "fill_safe_availability_confirmation_from_template",
        safeConfirmationFillGuideRequiredInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
        safeConfirmationFillGuideRowLevelDataAcceptedByR1158: false,
        safeConfirmationAnswerSheetConclusion: "ordinary_safe_confirmation_answer_sheet_ready_non_evidence",
        safeConfirmationAnswerSheetExactSafeAnswerCount: R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
        safeConfirmationAnswerSheetReadyForRowOwner: true,
        safeConfirmationAnswerSheetNextAction: R1159_ANSWER_SHEET_NEXT_ACTION,
        safeConfirmationAnswerSheetRequiredInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
        safeConfirmationAnswerSheetRowLevelDataAcceptedByR1159: false,
        safeConfirmationAnswerSheetRowOwnerProvidedValuesStored: false,
        safeConfirmationTranscriptionProofConclusion:
          "r1159_feature_only_safe_confirmation_transcription_ready_non_evidence",
        safeConfirmationTranscriptionProofConfirmationValuesStoredByR1160: false,
        safeConfirmationTranscriptionProofExactSafeTranscriptionStepCount:
          R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
        safeConfirmationTranscriptionProofHypotheticalTranscriptionWouldBeFeatureOnlyReady: true,
        safeConfirmationTranscriptionProofNextAction: R1160_TRANSCRIPTION_PROOF_NEXT_ACTION,
        safeConfirmationTranscriptionProofReadyForRowOwnerConfirmation: true,
        safeConfirmationTranscriptionProofRequiredInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
        safeConfirmationTranscriptionProofRowLevelDataAcceptedByR1160: false,
        safeConfirmationTranscriptionProofRowOwnerConfirmationStillRequired: true,
        safeConfirmationTranscriptionProofRowOwnerProvidedValuesStored: false,
        safeConfirmationMaterializerConclusion:
          "feature_only_safe_availability_confirmation_materializer_waiting_on_explicit_row_owner_confirmation",
        safeConfirmationMaterializerConfirmationValuesStoredInR1161Packet: false,
        safeConfirmationMaterializerExplicitRowOwnerConfirmationAssertionProvided: false,
        safeConfirmationMaterializerFeatureOnlyConfirmationWouldBeReadyForR1150: false,
        safeConfirmationMaterializerNextAction: R1161_MATERIALIZER_NEXT_ACTION,
        safeConfirmationMaterializerRowLevelDataAcceptedByR1161: false,
        safeConfirmationMaterializerRowOwnerConfirmationStillRequired: true,
        safeConfirmationMaterializerRowOwnerPrivateValuesStored: false,
        safeConfirmationMaterializerSafeConfirmationArtifact: null,
        safeConfirmationMaterializerSafeConfirmationArtifactWritten: false,
        safeConfirmationMaterializerSafeMaterializedFieldCount: 0,
        safeConfirmationAssertionHandoffConclusion:
          "feature_only_safe_confirmation_assertion_handoff_ready_for_row_owner_assertion",
        safeConfirmationAssertionHandoffConfirmationValuesStoredByR1162: false,
        safeConfirmationAssertionHandoffExplicitRowOwnerConfirmationAssertionProvided: false,
        safeConfirmationAssertionHandoffFeatureOnlyConfirmationWouldBeReadyForR1150: false,
        safeConfirmationAssertionHandoffHandoffReadyForRowOwner: true,
        safeConfirmationAssertionHandoffNextAction: R1162_ASSERTION_HANDOFF_NEXT_ACTION,
        safeConfirmationAssertionHandoffRequiredChecklistIds: R1158_REQUIRED_CHECKLIST_IDS,
        safeConfirmationAssertionHandoffRequiredInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
        safeConfirmationAssertionHandoffRowLevelDataAcceptedByR1162: false,
        safeConfirmationAssertionHandoffRowOwnerAssertionInferredByR1162: false,
        safeConfirmationAssertionHandoffRowOwnerAssertionStillRequired: true,
        safeConfirmationAssertionHandoffRowOwnerPrivateValuesStored: false,
        safeConfirmationAssertionHandoffSafeConfirmationArtifactWritten: false,
        targetAgeBand: "roughly_16_50",
        targetInputPriority: TARGET_INPUT_PRIORITY,
        topMissingRequirement: "row_owner_availability_assertions_confirmed",
      });
      expect(output.completionAudit.missingRequirementIds).toEqual([
        "row_owner_availability_assertions_confirmed",
        "confirmed_recipe_route_requirements_available",
        "private_route_config_supplied",
        "real_lab_wearable_route_metrics_recorded",
      ]);
      expect(output.completionAudit.blockers).toEqual([
        "row_owner_availability_assertions_not_confirmed",
        "confirmed_route_config_requirements_not_available",
        "private_route_config_not_supplied",
        "real_lab_wearable_route_metrics_missing",
      ]);
      expect(output.completionAudit.prioritizedSubmitterInputFamilyIds).toEqual(FEATURE_ONLY_PAIR_FAMILY_IDS);
      expect(output.completionAudit.commands).toMatchObject({
        partialPrivateChainRunnerCommand: R1142_COMMAND,
        postConfirmationPrivateConfigIntakeCommand: R1148_PRIVATE_CONFIG_INTAKE_COMMAND,
        recipeReadinessChainRunnerCommand: R1144_COMMAND,
        rowOwnerSafeAssertionChainRunnerCommand: R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
      });
      expect(output.completionAudit.unblockerSteps).toMatchObject([
        {
          allowedValueKindIds: SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
          blocker: "row_owner_availability_assertions_not_confirmed",
          blockedContentIds: SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS,
          command: R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
          minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
          nextAction: R1176_SAFE_ASSERTION_LIVE_CHAIN_NEXT_ACTION,
          optionalAddOnFamilyIds: R1158_OPTIONAL_ADD_ON_FAMILY_IDS,
          requirementId: "row_owner_availability_assertions_confirmed",
          requiredInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
          safeCompletionChecklistItemIds: R1158_REQUIRED_CHECKLIST_IDS,
          status: "blocked",
          stepId: "confirm_feature_only_lab_wearable_safe_availability",
        },
        {
          blocker: "confirmed_route_config_requirements_not_available",
          command: R1144_COMMAND,
          nextAction: "run_r1144_recipe_readiness_chain_with_confirmed_availability",
          requirementId: "confirmed_recipe_route_requirements_available",
          status: "blocked",
          stepId: "confirm_lab_wearable_recipe_route_requirements",
        },
        {
          blocker: "private_route_config_not_supplied",
          command: R1148_PRIVATE_CONFIG_INTAKE_COMMAND,
          nextAction: "fill_private_route_config_for_confirmed_lab_wearable_routes",
          requirementId: "private_route_config_supplied",
          status: "blocked",
          stepId: "provide_lab_wearable_private_route_config",
        },
        {
          blocker: "real_lab_wearable_route_metrics_missing",
          command: R1142_COMMAND,
          nextAction: "run_r1142_partial_private_chain_for_real_lab_wearable_route_metrics",
          requirementId: "real_lab_wearable_route_metrics_recorded",
          status: "blocked",
          stepId: "run_real_lab_wearable_route_metrics",
        },
      ]);
      expect(statusByRequirement(output.completionAudit.checklist)).toMatchObject({
        active_loop_prioritizes_ordinary_labs_wearables: "satisfied",
        feature_only_chain_runner_guard_present: "satisfied",
        feature_only_coverage_context_intake_guard_present: "satisfied",
        feature_only_submission_model_evidence_guard_present: "satisfied",
        ordinary_lab_wearable_submitter_kit_available: "satisfied",
        ordinary_submitter_safe_completion_modes_present: "satisfied",
        ordinary_submitter_safe_completion_checklist_present: "satisfied",
        ordinary_submitter_kit_feature_only_guard_present: "satisfied",
        partial_private_chain_available: "satisfied",
        post_confirmation_private_config_intake_safe_action_guard_present: "satisfied",
        privacy_and_product_gate_closed: "satisfied",
        route_recipes_cover_lab_and_wearable_submitter_inputs: "satisfied",
        safe_availability_action_packet_guard_present: "satisfied",
        safe_confirmation_chain_runner_present: "satisfied",
        safe_confirmation_answer_sheet_present: "satisfied",
        safe_confirmation_transcription_proof_present: "satisfied",
        safe_confirmation_materializer_present: "satisfied",
        safe_confirmation_fill_guide_present: "satisfied",
        safe_confirmation_handoff_packet_present: "satisfied",
        safe_confirmation_feature_only_smoke_proof_present: "satisfied",
        safe_row_owner_assertion_gate_present: "satisfied",
      });
      expect(output.completionAudit.routeEvidenceState).toMatchObject({
        finalReadyPartialMetricRouteIds: [],
        privateDetailsStored: false,
        privateRouteConfigReadyForR1142: false,
        privateRouteConfigSupplied: false,
        privateRouteConfigSuppliedToIntake: false,
        privateRouteConfigStatus: "missing",
        realLabWearableRouteMetricsRecorded: false,
        requiredPrivateFieldRefFamilies: [],
        requiredPrivateTableRefs: [],
        rowOwnerAssertionsConfirmed: false,
      });
      expect(output.completionAudit.featureOnlySubmissionMode).toMatchObject({
        conclusion: "ordinary_feature_only_mode_waiting_on_safe_availability_confirmation",
        featureOnlyCoverageContextAllowed: false,
        featureOnlyCoverageRequiresPreferredPair: true,
        minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
        modelEvidencePromotionAllowed: false,
        outcomeLinkageRequiredForFeatureOnlyContext: false,
        outcomeLinkedEvidenceReady: false,
        rowLevelDataAcceptedByR1151: false,
        supportedFeatureFamilyIds: [],
      });
      expect(output.completionAudit.featureOnlyCoverageContextIntake).toMatchObject({
        conclusion: "feature_only_coverage_context_waiting_on_r1151_ready",
        contextStatus: "missing",
        coverageContextReadyForResearchPlanning: false,
        featureOnlyCoverageRequiresPreferredPair: true,
        minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
        modelEvidencePromotionAllowed: false,
        outcomeLinkageRequiredForFeatureOnlyContext: false,
        r1151FeatureOnlyModeReadyForIntake: false,
        rowLevelDataAcceptedByR1152: false,
        supportedFeatureFamilyIds: [],
      });
      expect(output.completionAudit.featureOnlyChainRunner).toMatchObject({
        conclusion: "ordinary_feature_only_chain_waiting_on_safe_availability_confirmation",
        coverageContextReadyForResearchPlanning: false,
        featureOnlyCoverageContextAllowed: false,
        featureOnlyCoverageContextIntakeConclusion: "feature_only_coverage_context_waiting_on_r1151_ready",
        featureOnlyModeConclusion: "ordinary_feature_only_mode_waiting_on_safe_availability_confirmation",
        minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
        modelEvidencePromotionAllowed: false,
        outcomeLinkageRequiredForFeatureOnlyContext: false,
        rowLevelDataAcceptedByR1153: false,
        supportedFeatureFamilyIds: [],
      });
      expect(output.completionAudit.safeConfirmationFeatureOnlySmokeProof).toMatchObject({
        conclusion: "ordinary_safe_confirmation_feature_only_smoke_passed_non_evidence",
        featureOnlyChainConclusion: "ordinary_feature_only_chain_ready_research_only",
        featureOnlyCoverageContextReadyForResearchPlanning: true,
        modelEvidencePromotionAllowed: false,
        nextAction: "use_r1150_r1153_path_with_real_safe_availability_confirmation",
        readyForRecipeReadinessChain: false,
        rowLevelDataAcceptedByR1155: false,
        safeAvailabilityConfirmationConclusion: "safe_availability_confirmation_feature_only_ready_research_only",
        smokeEvidence: false,
      });
      expect(output.completionAudit.safeConfirmationHandoff).toMatchObject({
        conclusion: "ordinary_safe_confirmation_handoff_ready_for_row_owner_fill_non_evidence",
        featureOnlyPathMechanicallyProven: true,
        handoffReadyForRowOwner: true,
        modelEvidencePromotionAllowed: false,
        nextAction: "fill_safe_availability_confirmation_from_template",
        readyForModelEvidence: false,
        readyForRecipeReadinessChain: false,
        requiredFeatureOnlySourceFamilyIds: FEATURE_ONLY_PAIR_FAMILY_IDS,
        requiredSafeCompletionCheckIds: ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS,
        rowLevelDataAcceptedByR1156: false,
        rowOwnerWorkType: "fill_safe_availability_confirmation",
        safeConfirmationStillRequired: true,
        smokeEvidence: false,
      });
      expect(output.completionAudit.safeConfirmationChainRunner).toMatchObject({
        conclusion: "ordinary_safe_confirmation_chain_waiting_on_safe_confirmation",
        confirmationPathConfigured: false,
        featureOnlyCoverageContextReady: false,
        featureOnlyResearchPlanningReady: false,
        modelEvidencePromotionAllowed: false,
        nextAction: "fill_safe_availability_confirmation_from_template",
        readyForModelEvidence: false,
        readyForRecipeReadinessChain: false,
        rowLevelDataAcceptedByR1157: false,
        safeConfirmationStillRequired: true,
      });
      expect(output.completionAudit.safeConfirmationFillGuide).toMatchObject({
        conclusion: "ordinary_safe_confirmation_fill_guide_ready_non_evidence",
        exactSafeFieldEditCount: R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
        guideReadyForRowOwnerFill: true,
        minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
        nextAction: "fill_safe_availability_confirmation_from_template",
        optionalAddOnFamilyIds: R1158_OPTIONAL_ADD_ON_FAMILY_IDS,
        requiredChecklistIds: R1158_REQUIRED_CHECKLIST_IDS,
        requiredInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
        rowLevelDataAcceptedByR1158: false,
      });
      expect(output.completionAudit.safeConfirmationAnswerSheet).toMatchObject({
        answerSheetReadyForRowOwner: true,
        conclusion: "ordinary_safe_confirmation_answer_sheet_ready_non_evidence",
        exactSafeAnswerCount: R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
        minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
        nextAction: R1159_ANSWER_SHEET_NEXT_ACTION,
        optionalAddOnFamilyIds: R1158_OPTIONAL_ADD_ON_FAMILY_IDS,
        requiredChecklistIds: R1158_REQUIRED_CHECKLIST_IDS,
        requiredInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
        rowLevelDataAcceptedByR1159: false,
        rowOwnerProvidedValuesStored: false,
      });
      expect(output.completionAudit.safeConfirmationTranscriptionProof).toMatchObject({
        conclusion: "r1159_feature_only_safe_confirmation_transcription_ready_non_evidence",
        confirmationValuesStoredByR1160: false,
        exactSafeTranscriptionStepCount: R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
        hypotheticalTranscriptionWouldBeFeatureOnlyReady: true,
        nextAction: R1160_TRANSCRIPTION_PROOF_NEXT_ACTION,
        readyForRowOwnerConfirmation: true,
        requiredInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
        rowLevelDataAcceptedByR1160: false,
        rowOwnerConfirmationStillRequired: true,
        rowOwnerProvidedValuesStored: false,
      });
      expect(output.completionAudit.safeConfirmationMaterializer).toMatchObject({
        conclusion:
          "feature_only_safe_availability_confirmation_materializer_waiting_on_explicit_row_owner_confirmation",
        confirmationValuesStoredInR1161Packet: false,
        explicitRowOwnerConfirmationAssertionProvided: false,
        featureOnlyConfirmationWouldBeReadyForR1150: false,
        nextAction: R1161_MATERIALIZER_NEXT_ACTION,
        rowLevelDataAcceptedByR1161: false,
        rowOwnerConfirmationStillRequired: true,
        rowOwnerPrivateValuesStored: false,
        safeConfirmationArtifact: null,
        safeConfirmationArtifactWritten: false,
        safeMaterializedFieldCount: 0,
      });
      expect(output.completionAudit.safeAvailabilityActionPacket).toMatchObject({
        conclusion: "safe_availability_action_packet_waiting_on_safe_confirmation",
        featureOnlyCoverageContextReady: false,
        featureOnlyFillableTemplateArtifact: R1150_FEATURE_ONLY_CONFIRMATION_TEMPLATE_ARTIFACT,
        featureOnlyQuickstartArtifact: R1154_FEATURE_ONLY_QUICKSTART_ARTIFACT,
        featureOnlyQuickstartSafeFieldEditCount: R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
        featureOnlyQuickstartSafeFieldEditPaths: R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS,
        fillableTemplateArtifact: R1150_FULL_CONFIRMATION_TEMPLATE_ARTIFACT,
        minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
        missingFeatureOnlySourceFamilyIds: FEATURE_ONLY_PAIR_FAMILY_IDS,
        missingRequiredSourceFamilyIds: [
          "outcome_linkage",
          "join_time_alignment",
          "bloodwork_glycemia",
          "wearable_activity_daily",
        ],
        nextAction: "fill_safe_availability_confirmation_from_template",
        ordinarySubmitterCompletionModeIds: ORDINARY_SUBMITTER_COMPLETION_MODE_IDS,
        ordinarySubmitterSafeCompletionChecklistItemIds: ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS,
        outcomeLinkageRequiredForFeatureOnlyContext: false,
        preferredRecipeId: "lab_plus_wearable_minimum_manifest",
        readyForOutcomeLinkedRecipeReadinessChain: false,
        rowLevelDataAcceptedByR1154: false,
        safeAvailabilityConfirmationStatus: "missing",
      });
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = JSON.parse(await readFile(outputPath, "utf8")) as unknown;
      expect(findForbiddenAggregateEgress(persisted)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prioritizes the R1163 feature-only lab and wearable assertion runner when available", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1145-r1163-"));
    try {
      const paths = await writeInputs(tmp, {
        r1163: r1163Fixture(),
      });
      const { output } = await runR1145OrdinaryConsumerCurrentChainCompletionAudit({
        createdAt: "2026-05-17T20:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_current_chain_completion_audit_blocked_on_row_owner_route_evidence",
        nextAction: R1163_ASSERTION_RUNNER_NEXT_ACTION,
        safeConfirmationToResearchRunnerConclusion:
          "feature_only_safe_confirmation_to_research_runner_waiting_on_row_owner_assertion",
        safeConfirmationToResearchRunnerConfirmedSafeConfirmationArtifact: null,
        safeConfirmationToResearchRunnerExplicitRowOwnerAssertionProvided: false,
        safeConfirmationToResearchRunnerFeatureOnlyChainRan: false,
        safeConfirmationToResearchRunnerFeatureOnlyResearchPlanningReady: false,
        safeConfirmationToResearchRunnerNextAction: R1163_ASSERTION_RUNNER_NEXT_ACTION,
        safeConfirmationToResearchRunnerRowLevelDataAcceptedByR1163: false,
        safeConfirmationToResearchRunnerRowOwnerAssertionInferredByR1163: false,
        safeConfirmationToResearchRunnerRowOwnerAssertionStillRequired: true,
        safeConfirmationToResearchRunnerRowOwnerPrivateValuesStored: false,
        safeConfirmationToResearchRunnerSafeConfirmationArtifactWritten: false,
      });
      expect(output.summary.safeConfirmationAssertionHandoffNextAction).toBe(R1162_ASSERTION_HANDOFF_NEXT_ACTION);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("surfaces the R1164 feature-only research handoff without marking model evidence complete", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1145-r1164-"));
    try {
      const paths = await writeInputs(tmp, {
        r1163: r1163Fixture(),
        r1164: r1164Fixture(),
      });
      const { output } = await runR1145OrdinaryConsumerCurrentChainCompletionAudit({
        createdAt: "2026-05-17T20:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_current_chain_completion_audit_blocked_on_row_owner_route_evidence",
        featureOnlyResearchHandoffCommand: R1164_FEATURE_ONLY_RESEARCH_HANDOFF_COMMAND,
        featureOnlyResearchHandoffConclusion:
          "ordinary_feature_only_research_handoff_waiting_on_row_owner_assertion",
        featureOnlyResearchHandoffFeatureOnlyResearchPlanningReady: false,
        featureOnlyResearchHandoffMinimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
        featureOnlyResearchHandoffNextAction: R1164_FEATURE_ONLY_HANDOFF_NEXT_ACTION,
        featureOnlyResearchHandoffOutcomeLinkedModelEvidenceStillRequired: true,
        featureOnlyResearchHandoffPrioritizedInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
        featureOnlyResearchHandoffResearchPlanningAllowed: false,
        featureOnlyResearchHandoffRowLevelDataAcceptedByR1164: false,
        featureOnlyResearchHandoffRowOwnerPrivateValuesStored: false,
        goalAchieved: false,
        nextAction: R1163_ASSERTION_RUNNER_NEXT_ACTION,
        readyToMarkComplete: false,
      });
      expect(output.inputArtifacts.r1164).toMatchObject({
        artifact: "r1164-ordinary-consumer-feature-only-research-handoff.latest.json",
        packetId: "r1164-ordinary-consumer-feature-only-research-handoff",
        schemaVersion: "murph-age-r1164-ordinary-consumer-feature-only-research-handoff.v1",
        status: "available",
      });
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("surfaces the R1165 safe assertion runner without marking model evidence complete", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1145-r1165-"));
    try {
      const paths = await writeInputs(tmp, {
        r1163: r1163Fixture(),
        r1164: r1164Fixture(),
        r1165: r1165Fixture(),
        r1167: r1167Fixture(),
        r1170: r1170Fixture(),
        r1172: r1172Fixture(),
        r1173: r1173Fixture(),
        r1174: r1174Fixture(),
        r1175: r1175Fixture(),
        r1176: r1176Fixture(),
        r1185: r1185Fixture(),
      });
      const { output } = await runR1145OrdinaryConsumerCurrentChainCompletionAudit({
        createdAt: "2026-05-18T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_current_chain_completion_audit_blocked_on_row_owner_route_evidence",
        featureOnlySafeAssertionRunnerCommand: R1165_SAFE_ASSERTION_RUNNER_COMMAND,
        featureOnlySafeAssertionRunnerConclusion:
          "ordinary_feature_only_safe_assertion_runner_waiting_on_assertion_file",
        featureOnlySafeAssertionRunnerNextAction: R1165_SAFE_ASSERTION_RUNNER_NEXT_ACTION,
        featureOnlySafeAssertionRunnerAssertionAccepted: false,
        featureOnlySafeAssertionRunnerAssertionProvided: false,
        featureOnlySafeAssertionRunnerAssertionTemplateArtifact:
          "r1165-row-owner-feature-only-safe-assertion.template.json",
        featureOnlySafeAssertionRunnerChildR1163Ran: false,
        featureOnlySafeAssertionRunnerFeatureOnlyResearchPlanningReady: false,
        featureOnlySafeAssertionRunnerRequiredInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
        featureOnlySafeAssertionRunnerRequiredAssertionChecklistIds: R1165_REQUIRED_ASSERTION_CHECKLIST_IDS,
        featureOnlySafeAssertionRunnerOptionalAddOnFamilyIds: R1158_OPTIONAL_ADD_ON_FAMILY_IDS,
        featureOnlySafeAssertionRunnerValidationReasonIds: ["assertion_file_missing"],
        featureOnlySafeAssertionRunnerRowLevelDataAcceptedByR1165: false,
        featureOnlySafeAssertionRunnerRowOwnerPrivateValuesStored: false,
        featureOnlySafeAssertionFillGuideCommand: R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND,
        featureOnlySafeAssertionFillGuideConclusion:
          "ordinary_feature_only_safe_assertion_fill_guide_ready",
        featureOnlySafeAssertionFillGuideNextAction: R1165_SAFE_ASSERTION_RUNNER_NEXT_ACTION,
        featureOnlySafeAssertionFillGuideGuideReadyForRowOwnerFill: true,
        featureOnlySafeAssertionFillGuideRequiredInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
        featureOnlySafeAssertionFillGuideOptionalAddOnFamilyIds: R1158_OPTIONAL_ADD_ON_FAMILY_IDS,
        featureOnlySafeAssertionFillGuideSafeFieldEditCount: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS.length,
        featureOnlySafeAssertionFillGuideSafeFieldEditPaths: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS,
        featureOnlySafeAssertionFillGuideRowLevelDataAcceptedByR1167: false,
        featureOnlySafeAssertionFillGuideRowOwnerPrivateValuesStored: false,
        featureOnlySafeAssertionAnswerSheetCommand: R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND,
        featureOnlySafeAssertionAnswerSheetConclusion: "ordinary_safe_assertion_answer_sheet_ready_non_evidence",
        featureOnlySafeAssertionAnswerSheetNextAction: R1172_SAFE_ASSERTION_MATERIALIZER_NEXT_ACTION,
        featureOnlySafeAssertionAnswerSheetReadyForRowOwner: true,
        featureOnlySafeAssertionAnswerSheetMaterializerReady: true,
        featureOnlySafeAssertionAnswerSheetMaterializerExplicitConfirmationRequired: true,
        featureOnlySafeAssertionAnswerSheetExactSafeAnswerCount: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS.length,
        featureOnlySafeAssertionAnswerSheetAllowedValueKindIds: SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
        featureOnlySafeAssertionAnswerSheetBlockedAssertionContentIds: SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS,
        featureOnlySafeAssertionAnswerSheetRequiredInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
        featureOnlySafeAssertionAnswerSheetRequiredAssertionChecklistIds: R1165_REQUIRED_ASSERTION_CHECKLIST_IDS,
        featureOnlySafeAssertionAnswerSheetSafeFieldEditPaths: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS,
        featureOnlySafeAssertionAnswerSheetRowLevelDataAcceptedByR1173: false,
        featureOnlySafeAssertionAnswerSheetRowOwnerProvidedValuesStored: false,
        featureOnlySafeAssertionMaterializerCommand: R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND,
        featureOnlySafeAssertionMaterializerConclusion:
          "ordinary_consumer_safe_assertion_materializer_waiting_on_explicit_row_owner_assertion",
        featureOnlySafeAssertionMaterializerNextAction: R1172_SAFE_ASSERTION_MATERIALIZER_NEXT_ACTION,
        featureOnlySafeAssertionMaterializerExplicitRowOwnerAssertionProvided: false,
        featureOnlySafeAssertionMaterializerArtifactWritten: false,
        featureOnlySafeAssertionMaterializerRowOwnerAssertionStillRequired: true,
        featureOnlySafeAssertionMaterializerWouldBeAcceptedByR1165: false,
        featureOnlySafeAssertionMaterializerR1165RunnerReady: true,
        featureOnlySafeAssertionMaterializerR1165TemplateReady: true,
        featureOnlySafeAssertionMaterializerR1167FillGuideReady: true,
        featureOnlySafeAssertionMaterializerAllowedValueKindIds: SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
        featureOnlySafeAssertionMaterializerBlockedContentIds: SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS,
        featureOnlySafeAssertionMaterializerSafeFieldEditCount: 0,
        featureOnlySafeAssertionMaterializerSafeFieldEditPaths: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS,
        featureOnlySafeAssertionMaterializerRowLevelDataAcceptedByR1172: false,
        featureOnlySafeAssertionMaterializerRowOwnerPrivateValuesStored: false,
        featureOnlySafeAssertionSmokeProofCommand: R1170_SAFE_ASSERTION_SMOKE_PROOF_COMMAND,
        featureOnlySafeAssertionSmokeProofConclusion: "ordinary_safe_assertion_smoke_passed_non_evidence",
        featureOnlySafeAssertionSmokeProofNextAction:
          "keep_live_chain_waiting_on_real_r1165_row_owner_safe_assertion",
        featureOnlySafeAssertionSmokeProofPassed: true,
        featureOnlySafeAssertionSmokeProofSynthetic: true,
        featureOnlySafeAssertionSmokeProofRealEvidenceProduced: false,
        featureOnlySafeAssertionSmokeProofModelEvidencePromotionAllowed: false,
        featureOnlySafeAssertionSmokeProofLiveChainGateStillRequired: true,
        featureOnlySafeAssertionSmokeProofR1165AssertionAccepted: true,
        featureOnlySafeAssertionSmokeProofR1165ChildR1163Ran: true,
        featureOnlySafeAssertionSmokeProofR1165FeatureOnlyResearchPlanningReady: true,
        featureOnlySafeAssertionSmokeProofSafeFieldEditCount: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS.length,
        featureOnlySafeAssertionSmokeProofSafeFieldEditPaths: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS,
        featureOnlySafeAssertionSmokeProofRowLevelDataAcceptedByR1170: false,
        featureOnlySafeAssertionSmokeProofRowOwnerPrivateValuesStored: false,
        featureOnlySafeAssertionBridgeSmokeCommand:
          R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_COMMAND,
        featureOnlySafeAssertionBridgeSmokeAllowedValueKindIds: SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
        featureOnlySafeAssertionBridgeSmokeBlockedContentIds: SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS,
        featureOnlySafeAssertionBridgeSmokeOptionalAddOnFamilyIds: R1158_OPTIONAL_ADD_ON_FAMILY_IDS,
        featureOnlySafeAssertionBridgeSmokeConclusion:
          "r1172_to_r1165_safe_assertion_bridge_smoke_passed_non_evidence",
        featureOnlySafeAssertionBridgeSmokeNextAction:
          "keep_live_chain_waiting_on_explicit_row_owner_r1172_confirmation",
        featureOnlySafeAssertionBridgeSmokePassed: true,
        featureOnlySafeAssertionBridgeSmokeSynthetic: true,
        featureOnlySafeAssertionBridgeSmokeRealEvidenceProduced: false,
        featureOnlySafeAssertionBridgeSmokeModelEvidencePromotionAllowed: false,
        featureOnlySafeAssertionBridgeSmokeLiveChainGateStillRequired: true,
        featureOnlySafeAssertionBridgeSmokeR1172MaterializedAssertionWritten: true,
        featureOnlySafeAssertionBridgeSmokeR1172WouldBeAcceptedByR1165: true,
        featureOnlySafeAssertionBridgeSmokeR1165AssertionAccepted: true,
        featureOnlySafeAssertionBridgeSmokeR1165ChildR1163Ran: true,
        featureOnlySafeAssertionBridgeSmokeR1165FeatureOnlyResearchPlanningReady: true,
        featureOnlySafeAssertionBridgeSmokeR1163FeatureOnlyResearchPlanningReady: true,
        featureOnlySafeAssertionBridgeSmokeSafeFieldEditCount: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS.length,
        featureOnlySafeAssertionBridgeSmokeSafeFieldEditPaths: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS,
        featureOnlySafeAssertionBridgeSmokeRowLevelDataAcceptedByR1175: false,
        featureOnlySafeAssertionBridgeSmokeRowOwnerPrivateValuesStored: false,
        featureOnlySafeAssertionBridgeSmokeRowParsingPerformedByR1175: false,
        featureOnlySafeNextStepPacketCommand: R1174_SAFE_NEXT_STEP_PACKET_COMMAND,
        featureOnlySafeNextStepPacketAllowedValueKindIds: SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
        featureOnlySafeNextStepPacketBlockedContentIds: SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS,
        featureOnlySafeNextStepPacketConclusion:
          "ordinary_safe_next_step_packet_ready_for_row_owner_r1176_live_chain_confirmation",
        featureOnlySafeNextStepPacketNextAction: R1176_SAFE_ASSERTION_LIVE_CHAIN_NEXT_ACTION,
        featureOnlySafeNextStepPacketReadyForR1165Runner: false,
        featureOnlySafeNextStepPacketReadyForRowOwnerR1172Confirmation: true,
        featureOnlySafeNextStepPacketReadyForRowOwnerR1176LiveChainConfirmation: true,
        featureOnlySafeNextStepPacketR1176LiveChainCommand:
          R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
        featureOnlySafeNextStepPacketSafeFieldEditCount: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS.length,
        featureOnlySafeNextStepPacketSafeFieldEditPaths: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS,
        featureOnlySafeNextStepPacketRowLevelDataAcceptedByR1174: false,
        featureOnlySafeNextStepPacketRowOwnerPrivateValuesStored: false,
        featureOnlySafeNextStepPacketRowOwnerProvidedValuesStored: false,
        featureOnlySafeAssertionLiveChainCommand:
          R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
        featureOnlySafeAssertionLiveChainAllowedValueKindIds: SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
        featureOnlySafeAssertionLiveChainBlockedContentIds: SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS,
        featureOnlySafeAssertionLiveChainOptionalAddOnFamilyIds: R1158_OPTIONAL_ADD_ON_FAMILY_IDS,
        featureOnlySafeAssertionLiveChainCompletionModeId: FEATURE_ONLY_SAFE_COMPLETION_MODE_ID,
        featureOnlySafeAssertionLiveChainConclusion:
          "row_owner_safe_assertion_chain_waiting_on_explicit_confirmation",
        featureOnlySafeAssertionLiveChainNextAction: R1176_SAFE_ASSERTION_LIVE_CHAIN_NEXT_ACTION,
        featureOnlySafeAssertionLiveChainReady: false,
        featureOnlySafeAssertionLiveChainExplicitRowOwnerAssertionProvided: false,
        featureOnlySafeAssertionLiveChainFeatureOnlyResearchPlanningReady: false,
        featureOnlySafeAssertionLiveChainRealEvidenceProduced: false,
        featureOnlySafeAssertionLiveChainModelEvidencePromotionAllowed: false,
        featureOnlySafeAssertionLiveChainOutcomeLinkedModelEvidenceStillRequired: true,
        featureOnlySafeAssertionLiveChainRowOwnerAssertionStillRequired: true,
        featureOnlySafeAssertionLiveChainRowOwnerHandoffReasonId: R1176_ROW_OWNER_HANDOFF_REASON_ID,
        featureOnlySafeAssertionLiveChainR1172MaterializedAssertionWritten: null,
        featureOnlySafeAssertionLiveChainR1172WouldBeAcceptedByR1165: null,
        featureOnlySafeAssertionLiveChainR1165AssertionAccepted: null,
        featureOnlySafeAssertionLiveChainR1165ChildR1163Ran: null,
        featureOnlySafeAssertionLiveChainR1165FeatureOnlyResearchPlanningReady: null,
        featureOnlySafeAssertionLiveChainR1163FeatureOnlyResearchPlanningReady: null,
        featureOnlySafeAssertionLiveChainSafeFieldEditCount: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS.length,
        featureOnlySafeAssertionLiveChainSafeFieldEditPaths: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS,
        featureOnlySafeAssertionLiveChainSafeCompletionChecklistItemIds: R1158_REQUIRED_CHECKLIST_IDS,
        featureOnlySafeAssertionLiveChainRowLevelDataAcceptedByR1176: false,
        featureOnlySafeAssertionLiveChainRowOwnerPrivateValuesStored: false,
        featureOnlySafeAssertionLiveChainRowParsingPerformedByR1176: false,
        safeResponseSmokeProofCommand: R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_COMMAND,
        safeResponseSmokeProofConclusion: "average_submitter_safe_response_smoke_passed_non_evidence",
        safeResponseSmokeProofLiveR1184Conclusion:
          "average_submitter_safe_response_chain_waiting_on_row_owner_confirmation",
        safeResponseSmokeProofLiveR1184ReadyForSyntheticSmoke: true,
        safeResponseSmokeProofNextRealAction: R1185_SAFE_RESPONSE_NEXT_REAL_ACTION,
        safeResponseSmokeProofNextRealActionCommand: R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND,
        safeResponseSmokeProofNextRealActionRequiresExplicitRowOwnerAssertion: true,
        safeResponseSmokeProofMinimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
        safeResponseSmokeProofPrioritizedInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
        safeResponseSmokeProofRequiredResponseFieldIds: [
          "confirm_target_age_band_roughly_16_50",
          "confirm_glycemia_bloodwork_export_available",
          "confirm_daily_wearable_activity_export_available",
          "confirm_no_private_values_in_confirmation",
        ],
        safeResponseSmokeProofSafeExecutionFeatureSlotIds: [
          "glycemia_lab_presence",
          "glycemia_measurement_date_presence",
          "daily_activity_presence",
          "daily_wear_coverage_presence",
        ],
        safeResponseSmokeProofSyntheticPathAdvancedToFeatureOnlyResearchPlanning: true,
        safeResponseSmokeProofSyntheticSmokeRan: true,
        safeResponseSmokeProofModelEvidencePromotionAllowed: false,
        safeResponseSmokeProofProductDisplayAuthorized: false,
        safeResponseSmokeProofRowLevelDataAcceptedByR1185: false,
        safeResponseSmokeProofRowOwnerConfirmationInferredByR1185: false,
        safeResponseSmokeProofRowOwnerPrivateValuesStored: false,
        safeResponseSmokeProofRowParsingPerformedByR1185: false,
        safeResponseSmokeProofLiveArtifactsMutatedByR1185: false,
        goalAchieved: false,
        nextAction: R1176_SAFE_ASSERTION_LIVE_CHAIN_NEXT_ACTION,
        readyToMarkComplete: false,
      });
      expect(output.inputArtifacts.r1165).toMatchObject({
        artifact: "r1165-ordinary-consumer-feature-only-safe-assertion-runner.latest.json",
        packetId: "r1165-ordinary-consumer-feature-only-safe-assertion-runner",
        schemaVersion: "murph-age-r1165-ordinary-consumer-feature-only-safe-assertion-runner.v1",
        status: "available",
      });
      expect(output.inputArtifacts.r1167).toMatchObject({
        artifact: "r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide.latest.json",
        packetId: "r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide",
        schemaVersion: R1167_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_FILL_GUIDE_SCHEMA_VERSION,
        status: "available",
      });
      expect(output.inputArtifacts.r1170).toMatchObject({
        artifact: "r1170-ordinary-consumer-safe-assertion-smoke-proof.latest.json",
        packetId: "r1170-ordinary-consumer-safe-assertion-smoke-proof",
        schemaVersion: R1170_ORDINARY_CONSUMER_SAFE_ASSERTION_SMOKE_PROOF_SCHEMA_VERSION,
        status: "available",
      });
      expect(output.inputArtifacts.r1172).toMatchObject({
        artifact: "r1172-ordinary-consumer-safe-assertion-materializer.latest.json",
        packetId: "r1172-ordinary-consumer-safe-assertion-materializer",
        schemaVersion: R1172_ORDINARY_CONSUMER_SAFE_ASSERTION_MATERIALIZER_SCHEMA_VERSION,
        status: "available",
      });
      expect(output.inputArtifacts.r1173).toMatchObject({
        artifact: "r1173-ordinary-consumer-safe-assertion-answer-sheet.latest.json",
        packetId: "r1173-ordinary-consumer-safe-assertion-answer-sheet",
        schemaVersion: R1173_ORDINARY_CONSUMER_SAFE_ASSERTION_ANSWER_SHEET_SCHEMA_VERSION,
        status: "available",
      });
      expect(output.inputArtifacts.r1174).toMatchObject({
        artifact: "r1174-ordinary-consumer-safe-next-step-packet.latest.json",
        packetId: "r1174-ordinary-consumer-safe-next-step-packet",
        schemaVersion: R1174_ORDINARY_CONSUMER_SAFE_NEXT_STEP_PACKET_SCHEMA_VERSION,
        status: "available",
      });
      expect(output.inputArtifacts.r1175).toMatchObject({
        artifact: "r1175-r1172-to-r1165-safe-assertion-bridge-smoke.latest.json",
        packetId: "r1175-r1172-to-r1165-safe-assertion-bridge-smoke",
        schemaVersion: R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_SCHEMA_VERSION,
        status: "available",
      });
      expect(output.inputArtifacts.r1176).toMatchObject({
        artifact: "r1176-r1172-r1165-row-owner-safe-assertion-chain-runner.latest.json",
        packetId: "r1176-r1172-r1165-row-owner-safe-assertion-chain-runner",
        schemaVersion: R1176_R1172_R1165_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_SCHEMA_VERSION,
        status: "available",
      });
      expect(output.inputArtifacts.r1185).toMatchObject({
        artifact: "r1185-average-submitter-safe-response-smoke-proof.latest.json",
        packetId: "r1185-average-submitter-safe-response-smoke-proof",
        schemaVersion: R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_SCHEMA_VERSION,
        status: "available",
      });
      expect(statusByRequirement(output.completionAudit.checklist)).toMatchObject({
        feature_only_safe_assertion_fill_guide_present: "satisfied",
        feature_only_safe_assertion_answer_sheet_present: "satisfied",
        feature_only_safe_assertion_materializer_present: "satisfied",
        feature_only_safe_assertion_bridge_smoke_present: "satisfied",
        feature_only_safe_assertion_live_chain_present: "satisfied",
      });
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("marks the current chain ready only after row-owner confirmation, private config, and lab plus wearable route metrics", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1145-ready-"));
    try {
      const paths = await writeInputs(tmp, {
        r1142: r1142Fixture({ routeMetricsReady: true }),
        r1144: r1144Fixture({ rowOwnerConfirmed: true }),
        r1148: r1148Fixture({ ready: true }),
        r1149: r1149Fixture({ ready: true }),
        r1151: r1151Fixture({ ready: true }),
        r1152: r1152Fixture({ ready: true }),
        r1154: r1154Fixture({ ready: true }),
        r1161: r1161Fixture({ materialized: true }),
      });

      const { output } = await runR1145OrdinaryConsumerCurrentChainCompletionAudit({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_current_chain_completion_audit_ready_for_research_review",
        goalAchieved: true,
        nextAction: "review_real_lab_wearable_route_metrics_research_only",
        completionUnblockerBlockedRequirementIds: [],
        completionUnblockerBlockedStepIds: [],
        completionUnblockerCommandCount: 4,
        completionUnblockerStepIds: COMPLETION_UNBLOCKER_STEP_IDS,
        completionUnblockerTopAllowedValueKindIds: [],
        completionUnblockerTopBlockedContentIds: [],
        completionUnblockerTopCommand: null,
        completionUnblockerTopNextAction: null,
        completionUnblockerTopRequirementId: null,
        completionUnblockerTopRequiredInputKindIds: [],
        completionUnblockerTopSafeCompletionChecklistItemIds: [],
        completionUnblockerTopStepId: null,
        productDisplayAuthorized: false,
        readyToMarkComplete: true,
        topMissingRequirement: null,
      });
      expect(output.completionAudit.missingRequirementIds).toEqual([]);
      expect(output.completionAudit.blockers).toEqual([]);
      expect(output.completionAudit.unblockerSteps.map((step) => step.status)).toEqual([
        "satisfied",
        "satisfied",
        "satisfied",
        "satisfied",
      ]);
      expect(output.completionAudit.routeEvidenceState).toMatchObject({
        eligiblePartialRouteIds: ROUTE_IDS,
        executedPartialRouteIds: ROUTE_IDS,
        finalReadyPartialMetricRouteIds: ROUTE_IDS,
        privateRouteConfigReadyForR1142: true,
        privateRouteConfigSupplied: true,
        privateRouteConfigSuppliedToIntake: true,
        privateRouteConfigStatus: "available",
        realLabWearableRouteMetricsRecorded: true,
        requiredPrivateFieldRefFamilies: REQUIRED_FIELD_REFS,
        requiredPrivateTableRefs: REQUIRED_TABLE_REFS,
        rowOwnerAssertionsConfirmed: true,
      });
      expect(output.completionAudit.featureOnlySubmissionMode).toMatchObject({
        conclusion: "ordinary_feature_only_mode_superseded_by_outcome_linked_evidence",
        featureOnlyCoverageContextAllowed: false,
        featureOnlyCoverageRequiresPreferredPair: true,
        minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
        modelEvidencePromotionAllowed: false,
        outcomeLinkageRequiredForFeatureOnlyContext: false,
        outcomeLinkedEvidenceReady: true,
        rowLevelDataAcceptedByR1151: false,
        supportedFeatureFamilyIds: [
          "bloodwork_glycemia",
          "wearable_activity_daily",
        ],
      });
      expect(output.completionAudit.featureOnlyCoverageContextIntake).toMatchObject({
        conclusion: "feature_only_coverage_context_ready_research_only",
        coverageContextReadyForResearchPlanning: true,
        featureOnlyCoverageRequiresPreferredPair: true,
        minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
        modelEvidencePromotionAllowed: false,
        outcomeLinkageRequiredForFeatureOnlyContext: false,
        rowLevelDataAcceptedByR1152: false,
        supportedFeatureFamilyIds: [
          "bloodwork_glycemia",
          "wearable_activity_daily",
        ],
      });
      expect(output.completionAudit.safeAvailabilityActionPacket).toMatchObject({
        conclusion: "safe_availability_action_packet_ready_for_outcome_linked_recipe_readiness",
        featureOnlyCoverageContextReady: true,
        featureOnlyFillableTemplateArtifact: R1150_FEATURE_ONLY_CONFIRMATION_TEMPLATE_ARTIFACT,
        featureOnlyQuickstartArtifact: R1154_FEATURE_ONLY_QUICKSTART_ARTIFACT,
        featureOnlyQuickstartSafeFieldEditCount: R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
        featureOnlyQuickstartSafeFieldEditPaths: R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS,
        fillableTemplateArtifact: R1150_FULL_CONFIRMATION_TEMPLATE_ARTIFACT,
        missingFeatureOnlySourceFamilyIds: [],
        missingRequiredSourceFamilyIds: [],
        nextAction: "run_r1144_recipe_readiness_chain_with_confirmed_availability",
        ordinarySubmitterSafeCompletionChecklistItemIds: ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS,
        readyForOutcomeLinkedRecipeReadinessChain: true,
        rowLevelDataAcceptedByR1154: false,
      });
      expect(output.completionAudit.safeConfirmationMaterializer).toMatchObject({
        conclusion: "feature_only_safe_availability_confirmation_materialized",
        explicitRowOwnerConfirmationAssertionProvided: true,
        featureOnlyConfirmationWouldBeReadyForR1150: true,
        nextAction: R1161_MATERIALIZED_NEXT_ACTION,
        rowOwnerConfirmationStillRequired: false,
        safeConfirmationArtifact: "r1161-confirmed-feature-only-safe-availability-confirmation.json",
        safeConfirmationArtifactWritten: true,
        safeMaterializedFieldCount: R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes to R1142 when R1148 says the private config is ready but route metrics are still missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1145-r1148-ready-"));
    try {
      const paths = await writeInputs(tmp, {
        r1144: r1144Fixture({ rowOwnerConfirmed: true }),
        r1148: r1148Fixture({ ready: true }),
        r1152: r1152Fixture({ ready: true }),
      });

      const { output } = await runR1145OrdinaryConsumerCurrentChainCompletionAudit({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_current_chain_completion_audit_blocked_on_row_owner_route_evidence",
        goalAchieved: false,
        nextAction: "run_r1142_partial_private_chain_for_real_lab_wearable_route_metrics",
        topMissingRequirement: "real_lab_wearable_route_metrics_recorded",
      });
      expect(output.completionAudit.missingRequirementIds).toEqual([
        "real_lab_wearable_route_metrics_recorded",
      ]);
      expect(output.completionAudit.blockers).toEqual([
        "real_lab_wearable_route_metrics_missing",
      ]);
      expect(output.completionAudit.routeEvidenceState).toMatchObject({
        privateRouteConfigReadyForR1142: true,
        privateRouteConfigSupplied: true,
        privateRouteConfigSuppliedToIntake: true,
        privateRouteConfigStatus: "available",
        realLabWearableRouteMetricsRecorded: false,
        rowOwnerAssertionsConfirmed: true,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks completion when the R1151 feature-only non-evidence guard is stale or unsafe", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1145-r1151-guard-"));
    try {
      const paths = await writeInputs(tmp, {
        r1142: r1142Fixture({ routeMetricsReady: true }),
        r1144: r1144Fixture({ rowOwnerConfirmed: true }),
        r1148: r1148Fixture({ ready: true }),
        r1149: r1149Fixture({ ready: true }),
        r1151: r1151Fixture({ modelPromotionAllowed: true, ready: true }),
        r1152: r1152Fixture({ ready: true }),
      });

      const { output } = await runR1145OrdinaryConsumerCurrentChainCompletionAudit({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_current_chain_completion_audit_blocked_on_row_owner_route_evidence",
        goalAchieved: false,
        nextAction: "refresh_r1151_feature_only_submission_mode",
        readyToMarkComplete: false,
        topMissingRequirement: "feature_only_submission_model_evidence_guard_present",
      });
      expect(output.completionAudit.missingRequirementIds).toEqual([
        "feature_only_submission_model_evidence_guard_present",
      ]);
      expect(output.completionAudit.blockers).toEqual([
        "feature_only_submission_model_evidence_guard_missing_or_unsafe",
      ]);
      expect(output.completionAudit.featureOnlySubmissionMode).toMatchObject({
        modelEvidencePromotionAllowed: true,
        outcomeLinkedEvidenceReady: true,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks completion when R1151 does not enforce the lab-plus-wearable feature-only pair", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1145-r1151-pair-"));
    try {
      const paths = await writeInputs(tmp, {
        r1142: r1142Fixture({ routeMetricsReady: true }),
        r1144: r1144Fixture({ rowOwnerConfirmed: true }),
        r1148: r1148Fixture({ ready: true }),
        r1149: r1149Fixture({ ready: true }),
        r1151: r1151Fixture({ omitPairGuard: true, ready: true }),
        r1152: r1152Fixture({ ready: true }),
      });

      const { output } = await runR1145OrdinaryConsumerCurrentChainCompletionAudit({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_current_chain_completion_audit_blocked_on_row_owner_route_evidence",
        nextAction: "refresh_r1151_feature_only_submission_mode",
        topMissingRequirement: "feature_only_submission_model_evidence_guard_present",
      });
      expect(output.completionAudit.missingRequirementIds).toEqual([
        "feature_only_submission_model_evidence_guard_present",
      ]);
      expect(output.completionAudit.blockers).toEqual([
        "feature_only_submission_model_evidence_guard_missing_or_unsafe",
      ]);
      expect(output.completionAudit.featureOnlySubmissionMode).toMatchObject({
        featureOnlyCoverageRequiresPreferredPair: null,
        minimumFeaturePairRequired: [],
        modelEvidencePromotionAllowed: false,
        outcomeLinkageRequiredForFeatureOnlyContext: null,
        rowLevelDataAcceptedByR1151: null,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks completion when the R1149 submitter kit does not carry the feature-only guard", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1145-r1149-guard-"));
    try {
      const paths = await writeInputs(tmp, {
        r1142: r1142Fixture({ routeMetricsReady: true }),
        r1144: r1144Fixture({ rowOwnerConfirmed: true }),
        r1148: r1148Fixture({ ready: true }),
        r1149: r1149Fixture({ omitFeatureOnlyGuard: true, ready: true }),
        r1151: r1151Fixture({ ready: true }),
        r1152: r1152Fixture({ ready: true }),
      });

      const { output } = await runR1145OrdinaryConsumerCurrentChainCompletionAudit({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_current_chain_completion_audit_blocked_on_row_owner_route_evidence",
        goalAchieved: false,
        nextAction: "refresh_r1149_submitter_kit",
        readyToMarkComplete: false,
        topMissingRequirement: "ordinary_submitter_kit_feature_only_guard_present",
      });
      expect(output.completionAudit.missingRequirementIds).toEqual([
        "ordinary_submitter_kit_feature_only_guard_present",
      ]);
      expect(output.completionAudit.blockers).toEqual([
        "ordinary_submitter_kit_feature_only_guard_missing_or_stale",
      ]);
      expect(statusByRequirement(output.completionAudit.checklist)).toMatchObject({
        feature_only_coverage_context_intake_guard_present: "satisfied",
        feature_only_submission_model_evidence_guard_present: "satisfied",
        ordinary_lab_wearable_submitter_kit_available: "satisfied",
        ordinary_submitter_kit_feature_only_guard_present: "missing",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks completion when the R1152 feature-only coverage intake guard is stale or unsafe", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1145-r1152-guard-"));
    try {
      const paths = await writeInputs(tmp, {
        r1142: r1142Fixture({ routeMetricsReady: true }),
        r1144: r1144Fixture({ rowOwnerConfirmed: true }),
        r1148: r1148Fixture({ ready: true }),
        r1149: r1149Fixture({ ready: true }),
        r1151: r1151Fixture({ ready: true }),
        r1152: r1152Fixture({ modelPromotionAllowed: true, ready: true }),
      });

      const { output } = await runR1145OrdinaryConsumerCurrentChainCompletionAudit({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_current_chain_completion_audit_blocked_on_row_owner_route_evidence",
        goalAchieved: false,
        nextAction: "refresh_r1152_feature_only_coverage_context_intake",
        readyToMarkComplete: false,
        topMissingRequirement: "feature_only_coverage_context_intake_guard_present",
      });
      expect(output.completionAudit.missingRequirementIds).toEqual([
        "feature_only_coverage_context_intake_guard_present",
      ]);
      expect(output.completionAudit.blockers).toEqual([
        "feature_only_coverage_context_intake_guard_missing_or_unsafe",
      ]);
      expect(output.completionAudit.featureOnlyCoverageContextIntake).toMatchObject({
        coverageContextReadyForResearchPlanning: true,
        modelEvidencePromotionAllowed: true,
        rowLevelDataAcceptedByR1152: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks completion when the R1153 feature-only chain guard is stale or unsafe", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1145-r1153-guard-"));
    try {
      const paths = await writeInputs(tmp, {
        r1142: r1142Fixture({ routeMetricsReady: true }),
        r1144: r1144Fixture({ rowOwnerConfirmed: true }),
        r1148: r1148Fixture({ ready: true }),
        r1149: r1149Fixture({ ready: true }),
        r1151: r1151Fixture({ ready: true }),
        r1152: r1152Fixture({ ready: true }),
        r1153: r1153Fixture({ modelPromotionAllowed: true, ready: true }),
      });

      const { output } = await runR1145OrdinaryConsumerCurrentChainCompletionAudit({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_current_chain_completion_audit_blocked_on_row_owner_route_evidence",
        goalAchieved: false,
        nextAction: "refresh_r1153_feature_only_chain_runner",
        readyToMarkComplete: false,
        topMissingRequirement: "feature_only_chain_runner_guard_present",
      });
      expect(output.completionAudit.missingRequirementIds).toEqual([
        "feature_only_chain_runner_guard_present",
      ]);
      expect(output.completionAudit.blockers).toEqual([
        "feature_only_chain_runner_guard_missing_or_unsafe",
      ]);
      expect(output.completionAudit.featureOnlyChainRunner).toMatchObject({
        coverageContextReadyForResearchPlanning: true,
        modelEvidencePromotionAllowed: true,
        rowLevelDataAcceptedByR1153: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks completion when the R1153 feature-only chain boundary is not aggregate-only", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1145-r1153-boundary-"));
    try {
      const paths = await writeInputs(tmp, {
        r1142: r1142Fixture({ routeMetricsReady: true }),
        r1144: r1144Fixture({ rowOwnerConfirmed: true }),
        r1148: r1148Fixture({ ready: true }),
        r1149: r1149Fixture({ ready: true }),
        r1151: r1151Fixture({ ready: true }),
        r1152: r1152Fixture({ ready: true }),
        r1153: r1153Fixture({ aggregateOnly: false, ready: true }),
      });

      const { output } = await runR1145OrdinaryConsumerCurrentChainCompletionAudit({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_current_chain_completion_audit_blocked_on_row_owner_route_evidence",
        goalAchieved: false,
        nextAction: "refresh_r1153_feature_only_chain_runner",
        readyToMarkComplete: false,
        topMissingRequirement: "feature_only_chain_runner_guard_present",
      });
      expect(output.completionAudit.missingRequirementIds).toEqual([
        "feature_only_chain_runner_guard_present",
      ]);
      expect(output.completionAudit.blockers).toEqual([
        "feature_only_chain_runner_guard_missing_or_unsafe",
      ]);
      expect(output.completionAudit.featureOnlyChainRunner).toMatchObject({
        coverageContextReadyForResearchPlanning: true,
        modelEvidencePromotionAllowed: false,
        rowLevelDataAcceptedByR1153: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks completion when the R1155 safe confirmation feature-only smoke proof is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1145-r1155-missing-"));
    try {
      const paths = await writeInputs(tmp, {
        r1142: r1142Fixture({ routeMetricsReady: true }),
        r1144: r1144Fixture({ rowOwnerConfirmed: true }),
        r1148: r1148Fixture({ ready: true }),
        r1149: r1149Fixture({ ready: true }),
        r1151: r1151Fixture({ ready: true }),
        r1152: r1152Fixture({ ready: true }),
        r1153: r1153Fixture({ ready: true }),
        r1154: r1154Fixture({ ready: true }),
      });
      await rm(paths.r1155Path, { force: true });

      const { output } = await runR1145OrdinaryConsumerCurrentChainCompletionAudit({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_current_chain_completion_audit_blocked_on_row_owner_route_evidence",
        goalAchieved: false,
        nextAction: "refresh_r1155_safe_confirmation_feature_only_smoke_proof",
        readyToMarkComplete: false,
        safeConfirmationFeatureOnlySmokeProofConclusion: null,
        topMissingRequirement: "safe_confirmation_feature_only_smoke_proof_present",
      });
      expect(output.completionAudit.missingRequirementIds).toEqual([
        "safe_confirmation_feature_only_smoke_proof_present",
      ]);
      expect(output.completionAudit.blockers).toEqual([
        "safe_confirmation_feature_only_smoke_proof_missing_or_unsafe",
      ]);
      expect(output.inputArtifacts.r1155).toMatchObject({
        packetId: null,
        schemaVersion: null,
        status: "missing",
      });
      expect(output.completionAudit.safeConfirmationFeatureOnlySmokeProof).toMatchObject({
        conclusion: null,
        modelEvidencePromotionAllowed: null,
        readyForRecipeReadinessChain: null,
        rowLevelDataAcceptedByR1155: null,
        smokeEvidence: null,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks completion when the R1156 safe confirmation handoff is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1145-r1156-missing-"));
    try {
      const paths = await writeInputs(tmp, {
        r1142: r1142Fixture({ routeMetricsReady: true }),
        r1144: r1144Fixture({ rowOwnerConfirmed: true }),
        r1148: r1148Fixture({ ready: true }),
        r1149: r1149Fixture({ ready: true }),
        r1151: r1151Fixture({ ready: true }),
        r1152: r1152Fixture({ ready: true }),
        r1153: r1153Fixture({ ready: true }),
        r1154: r1154Fixture({ ready: true }),
      });
      await rm(paths.r1156Path, { force: true });

      const { output } = await runR1145OrdinaryConsumerCurrentChainCompletionAudit({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_current_chain_completion_audit_blocked_on_row_owner_route_evidence",
        goalAchieved: false,
        nextAction: "refresh_r1156_safe_confirmation_handoff",
        readyToMarkComplete: false,
        safeConfirmationHandoffConclusion: null,
        topMissingRequirement: "safe_confirmation_handoff_packet_present",
      });
      expect(output.completionAudit.missingRequirementIds).toEqual([
        "safe_confirmation_handoff_packet_present",
      ]);
      expect(output.completionAudit.blockers).toEqual([
        "safe_confirmation_handoff_missing_or_unsafe",
      ]);
      expect(output.inputArtifacts.r1156).toMatchObject({
        packetId: null,
        schemaVersion: null,
        status: "missing",
      });
      expect(output.completionAudit.safeConfirmationHandoff).toMatchObject({
        conclusion: null,
        featureOnlyPathMechanicallyProven: null,
        handoffReadyForRowOwner: null,
        rowLevelDataAcceptedByR1156: null,
        smokeEvidence: null,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks completion when the R1157 safe confirmation chain runner is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1145-r1157-missing-"));
    try {
      const paths = await writeInputs(tmp, {
        r1142: r1142Fixture({ routeMetricsReady: true }),
        r1144: r1144Fixture({ rowOwnerConfirmed: true }),
        r1148: r1148Fixture({ ready: true }),
        r1149: r1149Fixture({ ready: true }),
        r1151: r1151Fixture({ ready: true }),
        r1152: r1152Fixture({ ready: true }),
        r1153: r1153Fixture({ ready: true }),
        r1154: r1154Fixture({ ready: true }),
      });
      await rm(paths.r1157Path, { force: true });

      const { output } = await runR1145OrdinaryConsumerCurrentChainCompletionAudit({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_current_chain_completion_audit_blocked_on_row_owner_route_evidence",
        goalAchieved: false,
        nextAction: "refresh_r1157_safe_confirmation_chain_runner",
        readyToMarkComplete: false,
        safeConfirmationChainRunnerConclusion: null,
        topMissingRequirement: "safe_confirmation_chain_runner_present",
      });
      expect(output.completionAudit.missingRequirementIds).toEqual([
        "safe_confirmation_chain_runner_present",
      ]);
      expect(output.completionAudit.blockers).toEqual([
        "safe_confirmation_chain_runner_missing_or_unsafe",
      ]);
      expect(output.inputArtifacts.r1157).toMatchObject({
        packetId: null,
        schemaVersion: null,
        status: "missing",
      });
      expect(output.completionAudit.safeConfirmationChainRunner).toMatchObject({
        conclusion: null,
        modelEvidencePromotionAllowed: null,
        readyForModelEvidence: null,
        readyForRecipeReadinessChain: null,
        rowLevelDataAcceptedByR1157: null,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks completion when the R1158 safe confirmation fill guide is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1145-r1158-missing-"));
    try {
      const paths = await writeInputs(tmp, {
        r1142: r1142Fixture({ routeMetricsReady: true }),
        r1144: r1144Fixture({ rowOwnerConfirmed: true }),
        r1148: r1148Fixture({ ready: true }),
        r1149: r1149Fixture({ ready: true }),
        r1151: r1151Fixture({ ready: true }),
        r1152: r1152Fixture({ ready: true }),
        r1153: r1153Fixture({ ready: true }),
        r1154: r1154Fixture({ ready: true }),
        r1157: r1157Fixture({ readyForRecipe: true }),
      });
      await rm(paths.r1158Path, { force: true });

      const { output } = await runR1145OrdinaryConsumerCurrentChainCompletionAudit({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_current_chain_completion_audit_blocked_on_row_owner_route_evidence",
        goalAchieved: false,
        nextAction: "refresh_r1158_safe_confirmation_fill_guide",
        readyToMarkComplete: false,
        safeConfirmationFillGuideConclusion: null,
        topMissingRequirement: "safe_confirmation_fill_guide_present",
      });
      expect(output.completionAudit.missingRequirementIds).toEqual([
        "safe_confirmation_fill_guide_present",
      ]);
      expect(output.completionAudit.blockers).toEqual([
        "safe_confirmation_fill_guide_missing_or_unsafe",
      ]);
      expect(output.inputArtifacts.r1158).toMatchObject({
        packetId: null,
        schemaVersion: null,
        status: "missing",
      });
      expect(output.completionAudit.safeConfirmationFillGuide).toMatchObject({
        conclusion: null,
        exactSafeFieldEditCount: null,
        guideReadyForRowOwnerFill: null,
        minimumFeaturePairRequired: [],
        rowLevelDataAcceptedByR1158: null,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks completion when the R1159 safe confirmation answer sheet is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1145-r1159-missing-"));
    try {
      const paths = await writeInputs(tmp, {
        r1142: r1142Fixture({ routeMetricsReady: true }),
        r1144: r1144Fixture({ rowOwnerConfirmed: true }),
        r1148: r1148Fixture({ ready: true }),
        r1149: r1149Fixture({ ready: true }),
        r1151: r1151Fixture({ ready: true }),
        r1152: r1152Fixture({ ready: true }),
        r1153: r1153Fixture({ ready: true }),
        r1154: r1154Fixture({ ready: true }),
        r1157: r1157Fixture({ readyForRecipe: true }),
      });
      await rm(paths.r1159Path, { force: true });

      const { output } = await runR1145OrdinaryConsumerCurrentChainCompletionAudit({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_current_chain_completion_audit_blocked_on_row_owner_route_evidence",
        goalAchieved: false,
        nextAction: "refresh_r1159_safe_confirmation_answer_sheet",
        readyToMarkComplete: false,
        safeConfirmationAnswerSheetConclusion: null,
        topMissingRequirement: "safe_confirmation_answer_sheet_present",
      });
      expect(output.completionAudit.missingRequirementIds).toEqual([
        "safe_confirmation_answer_sheet_present",
      ]);
      expect(output.completionAudit.blockers).toEqual([
        "safe_confirmation_answer_sheet_missing_or_unsafe",
      ]);
      expect(output.inputArtifacts.r1159).toMatchObject({
        packetId: null,
        schemaVersion: null,
        status: "missing",
      });
      expect(output.completionAudit.safeConfirmationAnswerSheet).toMatchObject({
        answerSheetReadyForRowOwner: null,
        conclusion: null,
        exactSafeAnswerCount: null,
        minimumFeaturePairRequired: [],
        rowLevelDataAcceptedByR1159: null,
        rowOwnerProvidedValuesStored: null,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks completion when the R1160 safe confirmation transcription proof is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1145-r1160-missing-"));
    try {
      const paths = await writeInputs(tmp, {
        r1142: r1142Fixture({ routeMetricsReady: true }),
        r1144: r1144Fixture({ rowOwnerConfirmed: true }),
        r1148: r1148Fixture({ ready: true }),
        r1149: r1149Fixture({ ready: true }),
        r1151: r1151Fixture({ ready: true }),
        r1152: r1152Fixture({ ready: true }),
        r1153: r1153Fixture({ ready: true }),
        r1154: r1154Fixture({ ready: true }),
        r1156: r1156Fixture({ readyForRecipe: true }),
        r1157: r1157Fixture({ readyForRecipe: true }),
      });
      await rm(paths.r1160Path, { force: true });

      const { output } = await runR1145OrdinaryConsumerCurrentChainCompletionAudit({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_current_chain_completion_audit_blocked_on_row_owner_route_evidence",
        goalAchieved: false,
        nextAction: "refresh_r1160_safe_confirmation_transcription_proof",
        readyToMarkComplete: false,
        safeConfirmationTranscriptionProofConclusion: null,
        topMissingRequirement: "safe_confirmation_transcription_proof_present",
      });
      expect(output.completionAudit.missingRequirementIds).toEqual([
        "safe_confirmation_transcription_proof_present",
      ]);
      expect(output.completionAudit.blockers).toEqual([
        "safe_confirmation_transcription_proof_missing_or_unsafe",
      ]);
      expect(output.inputArtifacts.r1160).toMatchObject({
        packetId: null,
        schemaVersion: null,
        status: "missing",
      });
      expect(output.completionAudit.safeConfirmationTranscriptionProof).toMatchObject({
        conclusion: null,
        exactSafeTranscriptionStepCount: null,
        nextAction: null,
        readyForRowOwnerConfirmation: null,
        requiredInputKindIds: [],
        rowLevelDataAcceptedByR1160: null,
        rowOwnerConfirmationStillRequired: null,
        rowOwnerProvidedValuesStored: null,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks completion when the R1161 safe confirmation materializer is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1145-r1161-missing-"));
    try {
      const paths = await writeInputs(tmp, {
        r1142: r1142Fixture({ routeMetricsReady: true }),
        r1144: r1144Fixture({ rowOwnerConfirmed: true }),
        r1148: r1148Fixture({ ready: true }),
        r1149: r1149Fixture({ ready: true }),
        r1151: r1151Fixture({ ready: true }),
        r1152: r1152Fixture({ ready: true }),
        r1153: r1153Fixture({ ready: true }),
        r1154: r1154Fixture({ ready: true }),
        r1156: r1156Fixture({ readyForRecipe: true }),
        r1157: r1157Fixture({ readyForRecipe: true }),
      });
      await rm(paths.r1161Path, { force: true });

      const { output } = await runR1145OrdinaryConsumerCurrentChainCompletionAudit({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_current_chain_completion_audit_blocked_on_row_owner_route_evidence",
        goalAchieved: false,
        nextAction: "refresh_r1161_safe_confirmation_materializer",
        readyToMarkComplete: false,
        safeConfirmationMaterializerConclusion: null,
        topMissingRequirement: "safe_confirmation_materializer_present",
      });
      expect(output.completionAudit.missingRequirementIds).toEqual([
        "safe_confirmation_materializer_present",
      ]);
      expect(output.completionAudit.blockers).toEqual([
        "safe_confirmation_materializer_missing_or_unsafe",
      ]);
      expect(output.inputArtifacts.r1161).toMatchObject({
        packetId: null,
        schemaVersion: null,
        status: "missing",
      });
      expect(output.completionAudit.safeConfirmationMaterializer).toMatchObject({
        conclusion: null,
        confirmationValuesStoredInR1161Packet: null,
        explicitRowOwnerConfirmationAssertionProvided: null,
        featureOnlyConfirmationWouldBeReadyForR1150: null,
        nextAction: null,
        rowLevelDataAcceptedByR1161: null,
        rowOwnerConfirmationStillRequired: null,
        rowOwnerPrivateValuesStored: null,
        safeConfirmationArtifact: null,
        safeConfirmationArtifactWritten: null,
        safeMaterializedFieldCount: null,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks completion when the R1154 safe availability action packet is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1145-r1154-missing-"));
    try {
      const paths = await writeInputs(tmp, {
        r1142: r1142Fixture({ routeMetricsReady: true }),
        r1144: r1144Fixture({ rowOwnerConfirmed: true }),
        r1148: r1148Fixture({ ready: true }),
        r1149: r1149Fixture({ ready: true }),
        r1151: r1151Fixture({ ready: true }),
        r1152: r1152Fixture({ ready: true }),
        r1153: r1153Fixture({ ready: true }),
      });
      await rm(paths.r1154Path, { force: true });

      const { output } = await runR1145OrdinaryConsumerCurrentChainCompletionAudit({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_current_chain_completion_audit_blocked_on_row_owner_route_evidence",
        goalAchieved: false,
        nextAction: "refresh_r1154_safe_availability_action_packet",
        readyToMarkComplete: false,
        topMissingRequirement: "safe_availability_action_packet_guard_present",
      });
      expect(output.completionAudit.missingRequirementIds).toEqual([
        "safe_availability_action_packet_guard_present",
        "ordinary_submitter_safe_completion_checklist_present",
        "ordinary_submitter_safe_completion_modes_present",
      ]);
      expect(output.completionAudit.blockers).toEqual([
        "safe_availability_action_packet_missing_or_unsafe",
        "ordinary_submitter_safe_completion_checklist_missing_or_stale",
        "ordinary_submitter_safe_completion_modes_missing_or_stale",
      ]);
      expect(output.inputArtifacts.r1154).toMatchObject({
        packetId: null,
        schemaVersion: null,
        status: "missing",
      });
      expect(output.completionAudit.safeAvailabilityActionPacket).toMatchObject({
        conclusion: null,
        featureOnlyFillableTemplateArtifact: null,
        featureOnlyQuickstartArtifact: null,
        fillableTemplateArtifact: null,
        minimumFeaturePairRequired: [],
        nextAction: null,
        rowLevelDataAcceptedByR1154: null,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks completion when the R1154 action packet boundary allows row-level data", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1145-r1154-boundary-"));
    try {
      const paths = await writeInputs(tmp, {
        r1142: r1142Fixture({ routeMetricsReady: true }),
        r1144: r1144Fixture({ rowOwnerConfirmed: true }),
        r1148: r1148Fixture({ ready: true }),
        r1149: r1149Fixture({ ready: true }),
        r1151: r1151Fixture({ ready: true }),
        r1152: r1152Fixture({ ready: true }),
        r1153: r1153Fixture({ ready: true }),
        r1154: r1154Fixture({ ready: true, rowLevelDataAccepted: true }),
      });

      const { output } = await runR1145OrdinaryConsumerCurrentChainCompletionAudit({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_current_chain_completion_audit_blocked_on_row_owner_route_evidence",
        goalAchieved: false,
        nextAction: "refresh_r1154_safe_availability_action_packet",
        readyToMarkComplete: false,
        topMissingRequirement: "safe_availability_action_packet_guard_present",
      });
      expect(output.completionAudit.missingRequirementIds).toEqual([
        "safe_availability_action_packet_guard_present",
      ]);
      expect(output.completionAudit.blockers).toEqual([
        "safe_availability_action_packet_missing_or_unsafe",
      ]);
      expect(output.completionAudit.safeAvailabilityActionPacket).toMatchObject({
        conclusion: "safe_availability_action_packet_ready_for_outcome_linked_recipe_readiness",
        rowLevelDataAcceptedByR1154: true,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks completion when the R1154 quickstart safe field edits are stale", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1145-r1154-field-edits-"));
    try {
      const paths = await writeInputs(tmp, {
        r1142: r1142Fixture({ routeMetricsReady: true }),
        r1144: r1144Fixture({ rowOwnerConfirmed: true }),
        r1148: r1148Fixture({ ready: true }),
        r1149: r1149Fixture({ ready: true }),
        r1151: r1151Fixture({ ready: true }),
        r1152: r1152Fixture({ ready: true }),
        r1153: r1153Fixture({ ready: true }),
        r1154: r1154Fixture({ omitFieldEditPaths: true, ready: true }),
      });

      const { output } = await runR1145OrdinaryConsumerCurrentChainCompletionAudit({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_current_chain_completion_audit_blocked_on_row_owner_route_evidence",
        goalAchieved: false,
        nextAction: "refresh_r1154_safe_availability_action_packet",
        readyToMarkComplete: false,
        topMissingRequirement: "safe_availability_action_packet_guard_present",
      });
      expect(output.completionAudit.missingRequirementIds).toEqual([
        "safe_availability_action_packet_guard_present",
      ]);
      expect(output.completionAudit.blockers).toEqual([
        "safe_availability_action_packet_missing_or_unsafe",
      ]);
      expect(output.completionAudit.safeAvailabilityActionPacket).toMatchObject({
        conclusion: "safe_availability_action_packet_ready_for_outcome_linked_recipe_readiness",
        featureOnlyQuickstartArtifact: R1154_FEATURE_ONLY_QUICKSTART_ARTIFACT,
        featureOnlyQuickstartSafeFieldEditCount: null,
        featureOnlyQuickstartSafeFieldEditPaths: [],
        rowLevelDataAcceptedByR1154: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks completion when the ordinary submitter safe-completion checklist is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1145-checklist-"));
    try {
      const paths = await writeInputs(tmp, {
        r1142: r1142Fixture({ routeMetricsReady: true }),
        r1144: r1144Fixture({ rowOwnerConfirmed: true }),
        r1148: r1148Fixture({ ready: true }),
        r1149: r1149Fixture({ ready: true }),
        r1151: r1151Fixture({ ready: true }),
        r1152: r1152Fixture({ ready: true }),
        r1153: r1153Fixture({ ready: true }),
        r1154: r1154Fixture({ omitChecklist: true, ready: true }),
      });

      const { output } = await runR1145OrdinaryConsumerCurrentChainCompletionAudit({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_current_chain_completion_audit_blocked_on_row_owner_route_evidence",
        goalAchieved: false,
        nextAction: REFRESH_CURRENT_CHAIN_WITH_R1162_ACTION,
        readyToMarkComplete: false,
        safeAvailabilityActionPacketChecklistItemIds: [],
        topMissingRequirement: "ordinary_submitter_safe_completion_checklist_present",
      });
      expect(output.completionAudit.missingRequirementIds).toEqual([
        "ordinary_submitter_safe_completion_checklist_present",
      ]);
      expect(output.completionAudit.blockers).toEqual([
        "ordinary_submitter_safe_completion_checklist_missing_or_stale",
      ]);
      expect(output.completionAudit.safeAvailabilityActionPacket).toMatchObject({
        conclusion: "safe_availability_action_packet_ready_for_outcome_linked_recipe_readiness",
        ordinarySubmitterSafeCompletionChecklistItemIds: [],
        rowLevelDataAcceptedByR1154: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks completion when R1148 does not carry the safe availability action state", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1145-r1148-safe-action-"));
    try {
      const paths = await writeInputs(tmp, {
        r1142: r1142Fixture({ routeMetricsReady: true }),
        r1144: r1144Fixture({ rowOwnerConfirmed: true }),
        r1148: r1148Fixture({ omitSafeActionGuard: true, ready: true }),
        r1149: r1149Fixture({ ready: true }),
        r1151: r1151Fixture({ ready: true }),
        r1152: r1152Fixture({ ready: true }),
        r1153: r1153Fixture({ ready: true }),
        r1154: r1154Fixture({ ready: true }),
      });

      const { output } = await runR1145OrdinaryConsumerCurrentChainCompletionAudit({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_current_chain_completion_audit_blocked_on_row_owner_route_evidence",
        goalAchieved: false,
        nextAction: "refresh_r1148_post_confirmation_private_config_intake",
        readyToMarkComplete: false,
        topMissingRequirement: "post_confirmation_private_config_intake_safe_action_guard_present",
      });
      expect(output.completionAudit.missingRequirementIds).toEqual([
        "post_confirmation_private_config_intake_safe_action_guard_present",
      ]);
      expect(output.completionAudit.blockers).toEqual([
        "post_confirmation_private_config_intake_safe_action_guard_missing_or_stale",
      ]);
      expect(output.summary).toMatchObject({
        postConfirmationPrivateConfigIntakeConclusion: "post_confirmation_private_config_ready_for_r1142",
        postConfirmationPrivateConfigIntakeNextAction: "run_r1142_for_real_lab_wearable_route_metrics",
        postConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketNextAction: null,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits for refresh when a current-chain artifact is stale", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1145-stale-"));
    try {
      const paths = await writeInputs(tmp);
      await writeJson(paths.r1144Path, {
        artifactBoundary: safeBoundary("R1144"),
        packetId: "r1144-ordinary-consumer-recipe-readiness-chain-runner",
        productDisplayAuthorized: false,
        schemaVersion: "stale",
      });

      const { output } = await runR1145OrdinaryConsumerCurrentChainCompletionAudit({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_current_chain_completion_audit_waiting_on_refresh",
        goalAchieved: false,
        nextAction: REFRESH_CURRENT_CHAIN_WITH_R1162_ACTION,
        readyToMarkComplete: false,
      });
      expect(output.completionAudit.blockers).toEqual(["refresh_current_chain_artifacts"]);
      expect(output.inputArtifacts.r1144).toMatchObject({
        packetId: "r1144-ordinary-consumer-recipe-readiness-chain-runner",
        schemaVersion: null,
        status: "available",
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe input artifacts with a sanitized error", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1145-unsafe-"));
    try {
      const paths = await writeInputs(tmp);
      await writeJson(paths.r1142Path, {
        ...r1142Fixture(),
        artifactBoundary: {
          ...safeBoundary("R1142"),
          predictionsStored: true,
        },
      });

      await expect(runR1145OrdinaryConsumerCurrentChainCompletionAudit({
        outputDir: path.join(tmp, "out"),
        ...paths,
      })).rejects.toThrow("R1145 rejected unsafe r1142 input: 1 aggregate-egress violation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1145-cli-"));
    try {
      const paths = await writeInputs(tmp, {
        r1172: r1172Fixture(),
        r1173: r1173Fixture(),
        r1174: r1174Fixture(),
        r1175: r1175Fixture(),
        r1176: r1176Fixture(),
        r1185: r1185Fixture(),
      });
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1145-ordinary-consumer-current-chain-completion-audit.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1076_CURRENT_AUTORESEARCH_LOOP_EXECUTOR_PATH: paths.r1076Path,
          MURPH_AGE_R1135_ORDINARY_CONSUMER_AVAILABILITY_MANIFEST_PACKET_PATH: paths.r1135Path,
          MURPH_AGE_R1142_ORDINARY_CONSUMER_PARTIAL_PRIVATE_CHAIN_RUNNER_PATH: paths.r1142Path,
          MURPH_AGE_R1144_ORDINARY_CONSUMER_RECIPE_READINESS_CHAIN_RUNNER_PATH: paths.r1144Path,
          MURPH_AGE_R1148_ORDINARY_CONSUMER_POST_CONFIRMATION_PRIVATE_CONFIG_INTAKE_PATH: paths.r1148Path,
          MURPH_AGE_R1149_ORDINARY_CONSUMER_LAB_WEARABLE_SUBMISSION_KIT_PATH: paths.r1149Path,
          MURPH_AGE_R1151_ORDINARY_CONSUMER_FEATURE_ONLY_SUBMISSION_MODE_PATH: paths.r1151Path,
          MURPH_AGE_R1152_ORDINARY_CONSUMER_FEATURE_ONLY_COVERAGE_CONTEXT_INTAKE_PATH: paths.r1152Path,
          MURPH_AGE_R1153_ORDINARY_CONSUMER_FEATURE_ONLY_CHAIN_RUNNER_PATH: paths.r1153Path,
          MURPH_AGE_R1154_ORDINARY_CONSUMER_SAFE_AVAILABILITY_ACTION_PACKET_PATH: paths.r1154Path,
          MURPH_AGE_R1155_ORDINARY_CONSUMER_SAFE_CONFIRMATION_FEATURE_ONLY_SMOKE_PROOF_PATH: paths.r1155Path,
          MURPH_AGE_R1156_ORDINARY_CONSUMER_SAFE_CONFIRMATION_HANDOFF_PATH: paths.r1156Path,
          MURPH_AGE_R1157_ORDINARY_CONSUMER_SAFE_CONFIRMATION_CHAIN_RUNNER_PATH: paths.r1157Path,
          MURPH_AGE_R1158_ORDINARY_CONSUMER_SAFE_CONFIRMATION_FILL_GUIDE_PATH: paths.r1158Path,
          MURPH_AGE_R1159_ORDINARY_CONSUMER_SAFE_CONFIRMATION_ANSWER_SHEET_PATH: paths.r1159Path,
          MURPH_AGE_R1160_R1159_FEATURE_ONLY_SAFE_CONFIRMATION_TRANSCRIPTION_PROOF_PATH: paths.r1160Path,
          MURPH_AGE_R1161_FEATURE_ONLY_SAFE_AVAILABILITY_CONFIRMATION_MATERIALIZER_PATH: paths.r1161Path,
          MURPH_AGE_R1162_FEATURE_ONLY_SAFE_CONFIRMATION_ASSERTION_HANDOFF_PATH: paths.r1162Path,
          MURPH_AGE_R1163_FEATURE_ONLY_SAFE_CONFIRMATION_TO_RESEARCH_RUNNER_PATH: paths.r1163Path,
          MURPH_AGE_R1172_ORDINARY_CONSUMER_SAFE_ASSERTION_MATERIALIZER_PATH: paths.r1172Path,
          MURPH_AGE_R1173_ORDINARY_CONSUMER_SAFE_ASSERTION_ANSWER_SHEET_PATH: paths.r1173Path,
          MURPH_AGE_R1174_ORDINARY_CONSUMER_SAFE_NEXT_STEP_PACKET_PATH: paths.r1174Path,
          MURPH_AGE_R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_PATH: paths.r1175Path,
          MURPH_AGE_R1176_R1172_R1165_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_PATH: paths.r1176Path,
          MURPH_AGE_R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_PATH: paths.r1185Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        featureOnlyCoverageContextIntakeConclusion: string | null;
        featureOnlyCoverageContextIntakeContextStatus: string | null;
        featureOnlyCoverageContextIntakeReadyForResearchPlanning: boolean | null;
        featureOnlyCoverageContextIntakeRowLevelDataAcceptedByR1152: boolean | null;
        featureOnlyChainConclusion: string | null;
        featureOnlyChainCoverageContextAllowed: boolean | null;
        featureOnlyChainCoverageContextReadyForResearchPlanning: boolean | null;
        featureOnlyChainModelEvidencePromotionAllowed: boolean | null;
        featureOnlyChainRowLevelDataAcceptedByR1153: boolean | null;
        safeConfirmationFeatureOnlySmokeProofConclusion: string | null;
        safeConfirmationFeatureOnlySmokeProofFeatureOnlyChainConclusion: string | null;
        safeConfirmationFeatureOnlySmokeProofFeatureOnlyCoverageContextReadyForResearchPlanning: boolean | null;
        safeConfirmationFeatureOnlySmokeProofModelEvidencePromotionAllowed: boolean | null;
        safeConfirmationFeatureOnlySmokeProofNextAction: string | null;
        safeConfirmationFeatureOnlySmokeProofReadyForRecipeReadinessChain: boolean | null;
        safeConfirmationFeatureOnlySmokeProofRowLevelDataAcceptedByR1155: boolean | null;
        safeConfirmationFeatureOnlySmokeProofSafeAvailabilityConfirmationConclusion: string | null;
        safeConfirmationFeatureOnlySmokeProofSmokeEvidence: boolean | null;
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
        safeConfirmationAssertionHandoffNextAction: string | null;
        safeConfirmationAssertionHandoffRowLevelDataAcceptedByR1162: boolean | null;
        safeConfirmationAssertionHandoffRowOwnerAssertionStillRequired: boolean | null;
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
        featureOnlySafeAssertionAnswerSheetCommand: string | null;
        featureOnlySafeAssertionAnswerSheetConclusion: string | null;
        featureOnlySafeAssertionAnswerSheetNextAction: string | null;
        featureOnlySafeAssertionAnswerSheetReadyForRowOwner: boolean | null;
        featureOnlySafeAssertionAnswerSheetMaterializerReady: boolean | null;
        featureOnlySafeAssertionAnswerSheetMaterializerExplicitConfirmationRequired: boolean | null;
        featureOnlySafeAssertionAnswerSheetExactSafeAnswerCount: number | null;
        featureOnlySafeAssertionAnswerSheetAllowedValueKindIds: string[];
        featureOnlySafeAssertionAnswerSheetBlockedAssertionContentIds: string[];
        featureOnlySafeAssertionMaterializerArtifactWritten: boolean | null;
        featureOnlySafeAssertionMaterializerCommand: string | null;
        featureOnlySafeAssertionMaterializerConclusion: string | null;
        featureOnlySafeAssertionMaterializerExplicitRowOwnerAssertionProvided: boolean | null;
        featureOnlySafeAssertionMaterializerNextAction: string | null;
        featureOnlySafeAssertionMaterializerRowOwnerAssertionStillRequired: boolean | null;
        featureOnlySafeAssertionMaterializerAllowedValueKindIds: string[];
        featureOnlySafeAssertionMaterializerBlockedContentIds: string[];
        featureOnlySafeAssertionMaterializerSafeFieldEditCount: number | null;
        featureOnlySafeAssertionMaterializerWouldBeAcceptedByR1165: boolean | null;
        featureOnlySafeAssertionBridgeSmokeCommand: string | null;
        featureOnlySafeAssertionBridgeSmokeAllowedValueKindIds: string[];
        featureOnlySafeAssertionBridgeSmokeBlockedContentIds: string[];
        featureOnlySafeAssertionBridgeSmokeOptionalAddOnFamilyIds: string[];
        featureOnlySafeAssertionBridgeSmokeConclusion: string | null;
        featureOnlySafeAssertionBridgeSmokeNextAction: string | null;
        featureOnlySafeAssertionBridgeSmokePassed: boolean | null;
        featureOnlySafeAssertionBridgeSmokeSynthetic: boolean | null;
        featureOnlySafeAssertionBridgeSmokeRealEvidenceProduced: boolean | null;
        featureOnlySafeAssertionBridgeSmokeR1172MaterializedAssertionWritten: boolean | null;
        featureOnlySafeAssertionBridgeSmokeR1165AssertionAccepted: boolean | null;
        featureOnlySafeAssertionBridgeSmokeRowLevelDataAcceptedByR1175: boolean | null;
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
        featureOnlySafeAssertionLiveChainR1165AssertionAccepted: boolean | null;
        featureOnlySafeAssertionLiveChainSafeFieldEditCount: number | null;
        featureOnlySafeAssertionLiveChainSafeCompletionChecklistItemIds: string[];
        featureOnlySafeAssertionLiveChainRowLevelDataAcceptedByR1176: boolean | null;
        featureOnlyCoverageContextAllowed: boolean | null;
        featureOnlyModeConclusion: string | null;
        featureOnlyModeModelEvidencePromotionAllowed: boolean | null;
        featureOnlyModeOutcomeLinkedEvidenceReady: boolean | null;
        featureOnlyModeSupportedFeatureFamilyIds: string[];
        missingRequirementIds: string[];
        nextAction: string;
        postConfirmationPrivateConfigIntakeConclusion: string | null;
        postConfirmationPrivateConfigIntakeNextAction: string | null;
        postConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketNextAction: string | null;
        privateRouteConfigReadyForR1142: boolean;
        privateRouteConfigStatus: string;
        privateRouteConfigSuppliedToIntake: boolean;
        readyToMarkComplete: boolean;
        safeAvailabilityActionPacketConclusion: string | null;
        safeAvailabilityActionPacketFillableTemplateArtifact: string | null;
        safeAvailabilityActionPacketFeatureOnlyFillableTemplateArtifact: string | null;
        safeAvailabilityActionPacketFeatureOnlyCoverageContextReady: boolean | null;
        safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact: string | null;
        safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount: number | null;
        safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths: string[];
        safeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds: string[];
        safeAvailabilityActionPacketMissingRequiredSourceFamilyIds: string[];
        safeAvailabilityActionPacketNextAction: string | null;
        safeAvailabilityActionPacketCompletionModeIds: string[];
        safeAvailabilityActionPacketChecklistItemIds: string[];
        safeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain: boolean | null;
        safeAvailabilityActionPacketRowLevelDataAcceptedByR1154: boolean | null;
        targetInputPriority: string;
        topMissingRequirement: string;
      };
      expect(summary).toMatchObject({
        conclusion: "ordinary_consumer_current_chain_completion_audit_blocked_on_row_owner_route_evidence",
        featureOnlyCoverageContextIntakeConclusion: "feature_only_coverage_context_waiting_on_r1151_ready",
        featureOnlyCoverageContextIntakeContextStatus: "missing",
        featureOnlyCoverageContextIntakeReadyForResearchPlanning: false,
        featureOnlyCoverageContextIntakeRowLevelDataAcceptedByR1152: false,
        featureOnlyChainConclusion: "ordinary_feature_only_chain_waiting_on_safe_availability_confirmation",
        featureOnlyChainCoverageContextAllowed: false,
        featureOnlyChainCoverageContextReadyForResearchPlanning: false,
        featureOnlyChainModelEvidencePromotionAllowed: false,
        featureOnlyChainRowLevelDataAcceptedByR1153: false,
        safeConfirmationFeatureOnlySmokeProofConclusion:
          "ordinary_safe_confirmation_feature_only_smoke_passed_non_evidence",
        safeConfirmationFeatureOnlySmokeProofFeatureOnlyChainConclusion:
          "ordinary_feature_only_chain_ready_research_only",
        safeConfirmationFeatureOnlySmokeProofFeatureOnlyCoverageContextReadyForResearchPlanning: true,
        safeConfirmationFeatureOnlySmokeProofModelEvidencePromotionAllowed: false,
        safeConfirmationFeatureOnlySmokeProofNextAction:
          "use_r1150_r1153_path_with_real_safe_availability_confirmation",
        safeConfirmationFeatureOnlySmokeProofReadyForRecipeReadinessChain: false,
        safeConfirmationFeatureOnlySmokeProofRowLevelDataAcceptedByR1155: false,
        safeConfirmationFeatureOnlySmokeProofSafeAvailabilityConfirmationConclusion:
          "safe_availability_confirmation_feature_only_ready_research_only",
        safeConfirmationFeatureOnlySmokeProofSmokeEvidence: false,
        safeConfirmationChainRunnerConclusion:
          "ordinary_safe_confirmation_chain_waiting_on_safe_confirmation",
        safeConfirmationChainRunnerFeatureOnlyResearchPlanningReady: false,
        safeConfirmationChainRunnerModelEvidencePromotionAllowed: false,
        safeConfirmationChainRunnerNextAction: "fill_safe_availability_confirmation_from_template",
        safeConfirmationChainRunnerReadyForModelEvidence: false,
        safeConfirmationChainRunnerReadyForRecipeReadinessChain: false,
        safeConfirmationChainRunnerRowLevelDataAcceptedByR1157: false,
        safeConfirmationChainRunnerSafeConfirmationStillRequired: true,
        safeConfirmationFillGuideConclusion: "ordinary_safe_confirmation_fill_guide_ready_non_evidence",
        safeConfirmationFillGuideExactSafeFieldEditCount: R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
        safeConfirmationFillGuideGuideReadyForRowOwnerFill: true,
        safeConfirmationFillGuideNextAction: "fill_safe_availability_confirmation_from_template",
        safeConfirmationFillGuideRequiredInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
        safeConfirmationFillGuideRowLevelDataAcceptedByR1158: false,
        safeConfirmationAnswerSheetConclusion: "ordinary_safe_confirmation_answer_sheet_ready_non_evidence",
        safeConfirmationAnswerSheetExactSafeAnswerCount: R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
        safeConfirmationAnswerSheetReadyForRowOwner: true,
        safeConfirmationAnswerSheetNextAction: R1159_ANSWER_SHEET_NEXT_ACTION,
        safeConfirmationAnswerSheetRequiredInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
        safeConfirmationAnswerSheetRowLevelDataAcceptedByR1159: false,
        safeConfirmationAnswerSheetRowOwnerProvidedValuesStored: false,
        safeConfirmationTranscriptionProofConclusion:
          "r1159_feature_only_safe_confirmation_transcription_ready_non_evidence",
        safeConfirmationTranscriptionProofConfirmationValuesStoredByR1160: false,
        safeConfirmationTranscriptionProofExactSafeTranscriptionStepCount:
          R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
        safeConfirmationTranscriptionProofHypotheticalTranscriptionWouldBeFeatureOnlyReady: true,
        safeConfirmationTranscriptionProofNextAction: R1160_TRANSCRIPTION_PROOF_NEXT_ACTION,
        safeConfirmationTranscriptionProofReadyForRowOwnerConfirmation: true,
        safeConfirmationTranscriptionProofRequiredInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
        safeConfirmationTranscriptionProofRowLevelDataAcceptedByR1160: false,
        safeConfirmationTranscriptionProofRowOwnerConfirmationStillRequired: true,
        safeConfirmationTranscriptionProofRowOwnerProvidedValuesStored: false,
        safeConfirmationMaterializerConclusion:
          "feature_only_safe_availability_confirmation_materializer_waiting_on_explicit_row_owner_confirmation",
        safeConfirmationMaterializerConfirmationValuesStoredInR1161Packet: false,
        safeConfirmationMaterializerExplicitRowOwnerConfirmationAssertionProvided: false,
        safeConfirmationMaterializerFeatureOnlyConfirmationWouldBeReadyForR1150: false,
        safeConfirmationMaterializerNextAction: R1161_MATERIALIZER_NEXT_ACTION,
        safeConfirmationMaterializerRowLevelDataAcceptedByR1161: false,
        safeConfirmationMaterializerRowOwnerConfirmationStillRequired: true,
        safeConfirmationMaterializerRowOwnerPrivateValuesStored: false,
        safeConfirmationMaterializerSafeConfirmationArtifact: null,
        safeConfirmationMaterializerSafeConfirmationArtifactWritten: false,
        safeConfirmationMaterializerSafeMaterializedFieldCount: 0,
        safeConfirmationAssertionHandoffConclusion:
          "feature_only_safe_confirmation_assertion_handoff_ready_for_row_owner_assertion",
        safeConfirmationAssertionHandoffNextAction: R1162_ASSERTION_HANDOFF_NEXT_ACTION,
        safeConfirmationAssertionHandoffRowLevelDataAcceptedByR1162: false,
        safeConfirmationAssertionHandoffRowOwnerAssertionStillRequired: true,
        safeConfirmationToResearchRunnerConclusion: null,
        safeConfirmationToResearchRunnerConfirmedSafeConfirmationArtifact: null,
        safeConfirmationToResearchRunnerExplicitRowOwnerAssertionProvided: null,
        safeConfirmationToResearchRunnerFeatureOnlyChainRan: null,
        safeConfirmationToResearchRunnerFeatureOnlyResearchPlanningReady: null,
        safeConfirmationToResearchRunnerNextAction: null,
        safeConfirmationToResearchRunnerRowLevelDataAcceptedByR1163: null,
        safeConfirmationToResearchRunnerRowOwnerAssertionInferredByR1163: null,
        safeConfirmationToResearchRunnerRowOwnerAssertionStillRequired: null,
        safeConfirmationToResearchRunnerRowOwnerPrivateValuesStored: null,
        safeConfirmationToResearchRunnerSafeConfirmationArtifactWritten: null,
        featureOnlySafeAssertionAnswerSheetCommand: R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND,
        featureOnlySafeAssertionAnswerSheetConclusion: "ordinary_safe_assertion_answer_sheet_ready_non_evidence",
        featureOnlySafeAssertionAnswerSheetNextAction: R1172_SAFE_ASSERTION_MATERIALIZER_NEXT_ACTION,
        featureOnlySafeAssertionAnswerSheetReadyForRowOwner: true,
        featureOnlySafeAssertionAnswerSheetMaterializerReady: true,
        featureOnlySafeAssertionAnswerSheetMaterializerExplicitConfirmationRequired: true,
        featureOnlySafeAssertionAnswerSheetExactSafeAnswerCount: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS.length,
        featureOnlySafeAssertionAnswerSheetAllowedValueKindIds: SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
        featureOnlySafeAssertionAnswerSheetBlockedAssertionContentIds: SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS,
        featureOnlySafeAssertionMaterializerArtifactWritten: false,
        featureOnlySafeAssertionMaterializerCommand: R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND,
        featureOnlySafeAssertionMaterializerConclusion:
          "ordinary_consumer_safe_assertion_materializer_waiting_on_explicit_row_owner_assertion",
        featureOnlySafeAssertionMaterializerExplicitRowOwnerAssertionProvided: false,
        featureOnlySafeAssertionMaterializerNextAction: R1172_SAFE_ASSERTION_MATERIALIZER_NEXT_ACTION,
        featureOnlySafeAssertionMaterializerRowOwnerAssertionStillRequired: true,
        featureOnlySafeAssertionMaterializerAllowedValueKindIds: SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
        featureOnlySafeAssertionMaterializerBlockedContentIds: SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS,
        featureOnlySafeAssertionMaterializerSafeFieldEditCount: 0,
        featureOnlySafeAssertionMaterializerWouldBeAcceptedByR1165: false,
        featureOnlySafeAssertionBridgeSmokeCommand:
          R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_COMMAND,
        featureOnlySafeAssertionBridgeSmokeAllowedValueKindIds: SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
        featureOnlySafeAssertionBridgeSmokeBlockedContentIds: SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS,
        featureOnlySafeAssertionBridgeSmokeOptionalAddOnFamilyIds: R1158_OPTIONAL_ADD_ON_FAMILY_IDS,
        featureOnlySafeAssertionBridgeSmokeConclusion:
          "r1172_to_r1165_safe_assertion_bridge_smoke_passed_non_evidence",
        featureOnlySafeAssertionBridgeSmokeNextAction:
          "keep_live_chain_waiting_on_explicit_row_owner_r1172_confirmation",
        featureOnlySafeAssertionBridgeSmokePassed: true,
        featureOnlySafeAssertionBridgeSmokeSynthetic: true,
        featureOnlySafeAssertionBridgeSmokeRealEvidenceProduced: false,
        featureOnlySafeAssertionBridgeSmokeR1172MaterializedAssertionWritten: true,
        featureOnlySafeAssertionBridgeSmokeR1165AssertionAccepted: true,
        featureOnlySafeAssertionBridgeSmokeRowLevelDataAcceptedByR1175: false,
        featureOnlySafeNextStepPacketCommand: R1174_SAFE_NEXT_STEP_PACKET_COMMAND,
        featureOnlySafeNextStepPacketAllowedValueKindIds: SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
        featureOnlySafeNextStepPacketBlockedContentIds: SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS,
        featureOnlySafeNextStepPacketConclusion:
          "ordinary_safe_next_step_packet_ready_for_row_owner_r1176_live_chain_confirmation",
        featureOnlySafeNextStepPacketNextAction: R1176_SAFE_ASSERTION_LIVE_CHAIN_NEXT_ACTION,
        featureOnlySafeNextStepPacketReadyForR1165Runner: false,
        featureOnlySafeNextStepPacketReadyForRowOwnerR1172Confirmation: true,
        featureOnlySafeNextStepPacketReadyForRowOwnerR1176LiveChainConfirmation: true,
        featureOnlySafeNextStepPacketR1176LiveChainCommand:
          R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
        featureOnlySafeNextStepPacketSafeFieldEditCount: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS.length,
        featureOnlySafeNextStepPacketSafeFieldEditPaths: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS,
        featureOnlySafeNextStepPacketRowLevelDataAcceptedByR1174: false,
        featureOnlySafeNextStepPacketRowOwnerPrivateValuesStored: false,
        featureOnlySafeNextStepPacketRowOwnerProvidedValuesStored: false,
        featureOnlySafeAssertionLiveChainCommand:
          R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
        featureOnlySafeAssertionLiveChainAllowedValueKindIds: SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
        featureOnlySafeAssertionLiveChainBlockedContentIds: SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS,
        featureOnlySafeAssertionLiveChainOptionalAddOnFamilyIds: R1158_OPTIONAL_ADD_ON_FAMILY_IDS,
        featureOnlySafeAssertionLiveChainCompletionModeId: FEATURE_ONLY_SAFE_COMPLETION_MODE_ID,
        featureOnlySafeAssertionLiveChainConclusion:
          "row_owner_safe_assertion_chain_waiting_on_explicit_confirmation",
        featureOnlySafeAssertionLiveChainNextAction: R1176_SAFE_ASSERTION_LIVE_CHAIN_NEXT_ACTION,
        featureOnlySafeAssertionLiveChainReady: false,
        featureOnlySafeAssertionLiveChainExplicitRowOwnerAssertionProvided: false,
        featureOnlySafeAssertionLiveChainFeatureOnlyResearchPlanningReady: false,
        featureOnlySafeAssertionLiveChainRealEvidenceProduced: false,
        featureOnlySafeAssertionLiveChainModelEvidencePromotionAllowed: false,
        featureOnlySafeAssertionLiveChainOutcomeLinkedModelEvidenceStillRequired: true,
        featureOnlySafeAssertionLiveChainRowOwnerAssertionStillRequired: true,
        featureOnlySafeAssertionLiveChainRowOwnerHandoffReasonId: R1176_ROW_OWNER_HANDOFF_REASON_ID,
        featureOnlySafeAssertionLiveChainR1172MaterializedAssertionWritten: null,
        featureOnlySafeAssertionLiveChainR1165AssertionAccepted: null,
        featureOnlySafeAssertionLiveChainSafeFieldEditCount: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS.length,
        featureOnlySafeAssertionLiveChainSafeCompletionChecklistItemIds: R1158_REQUIRED_CHECKLIST_IDS,
        featureOnlySafeAssertionLiveChainRowLevelDataAcceptedByR1176: false,
        featureOnlyCoverageContextAllowed: false,
        featureOnlyModeConclusion: "ordinary_feature_only_mode_waiting_on_safe_availability_confirmation",
        featureOnlyModeModelEvidencePromotionAllowed: false,
        featureOnlyModeOutcomeLinkedEvidenceReady: false,
        featureOnlyModeSupportedFeatureFamilyIds: [],
        missingRequirementIds: [
          "row_owner_availability_assertions_confirmed",
          "confirmed_recipe_route_requirements_available",
          "private_route_config_supplied",
          "real_lab_wearable_route_metrics_recorded",
        ],
        nextAction: R1176_SAFE_ASSERTION_LIVE_CHAIN_NEXT_ACTION,
        postConfirmationPrivateConfigIntakeConclusion: "post_confirmation_private_config_waiting_on_safe_availability_confirmation",
        postConfirmationPrivateConfigIntakeNextAction: "fill_safe_availability_confirmation_from_template",
        postConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketNextAction:
          "fill_safe_availability_confirmation_from_template",
        privateRouteConfigReadyForR1142: false,
        privateRouteConfigStatus: "missing",
        privateRouteConfigSuppliedToIntake: false,
        readyToMarkComplete: false,
        safeAvailabilityActionPacketConclusion: "safe_availability_action_packet_waiting_on_safe_confirmation",
        safeAvailabilityActionPacketFillableTemplateArtifact: R1150_FULL_CONFIRMATION_TEMPLATE_ARTIFACT,
        safeAvailabilityActionPacketFeatureOnlyFillableTemplateArtifact:
          R1150_FEATURE_ONLY_CONFIRMATION_TEMPLATE_ARTIFACT,
        safeAvailabilityActionPacketFeatureOnlyCoverageContextReady: false,
        safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact: R1154_FEATURE_ONLY_QUICKSTART_ARTIFACT,
        safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount:
          R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
        safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths:
          R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS,
        safeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds: FEATURE_ONLY_PAIR_FAMILY_IDS,
        safeAvailabilityActionPacketMissingRequiredSourceFamilyIds: [
          "outcome_linkage",
          "join_time_alignment",
          "bloodwork_glycemia",
          "wearable_activity_daily",
        ],
        safeAvailabilityActionPacketNextAction: "fill_safe_availability_confirmation_from_template",
        safeAvailabilityActionPacketCompletionModeIds: ORDINARY_SUBMITTER_COMPLETION_MODE_IDS,
        safeAvailabilityActionPacketChecklistItemIds: ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS,
        safeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain: false,
        safeAvailabilityActionPacketRowLevelDataAcceptedByR1154: false,
        targetInputPriority: TARGET_INPUT_PRIORITY,
        topMissingRequirement: "row_owner_availability_assertions_confirmed",
      });
      expect(stdout).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("keeps optional common bloodwork and vitals from becoming required primary inputs", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1145-optional-primary-"));
    try {
      const paths = await writeInputs(tmp, {
        r1135: r1135Fixture({ primaryInputFamilyIds: FEATURE_ONLY_PAIR_FAMILY_IDS }),
      });
      const { output } = await runR1145OrdinaryConsumerCurrentChainCompletionAudit({
        createdAt: "2026-05-18T05:20:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(statusByRequirement(output.completionAudit.checklist)).toMatchObject({
        active_loop_prioritizes_ordinary_labs_wearables: "satisfied",
      });
      expect(output.completionAudit.missingRequirementIds).not.toContain(
        "active_loop_prioritizes_ordinary_labs_wearables",
      );
      expect(output.completionAudit.prioritizedSubmitterInputFamilyIds).toEqual(FEATURE_ONLY_PAIR_FAMILY_IDS);
      expect(output.completionAudit.unblockerSteps[0]).toMatchObject({
        minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
        optionalAddOnFamilyIds: R1158_OPTIONAL_ADD_ON_FAMILY_IDS,
        prioritizedInputFamilyIds: FEATURE_ONLY_PAIR_FAMILY_IDS,
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeInputs(
  tmp: string,
  overrides: {
    r1135?: Record<string, unknown>;
    r1142?: Record<string, unknown>;
    r1144?: Record<string, unknown>;
    r1148?: Record<string, unknown>;
    r1149?: Record<string, unknown>;
    r1151?: Record<string, unknown>;
    r1152?: Record<string, unknown>;
    r1153?: Record<string, unknown>;
    r1154?: Record<string, unknown>;
    r1155?: Record<string, unknown>;
    r1156?: Record<string, unknown>;
    r1157?: Record<string, unknown>;
    r1158?: Record<string, unknown>;
    r1159?: Record<string, unknown>;
    r1160?: Record<string, unknown>;
    r1161?: Record<string, unknown>;
    r1162?: Record<string, unknown>;
    r1163?: Record<string, unknown>;
    r1164?: Record<string, unknown>;
    r1165?: Record<string, unknown>;
    r1167?: Record<string, unknown>;
    r1170?: Record<string, unknown>;
    r1172?: Record<string, unknown>;
    r1173?: Record<string, unknown>;
    r1174?: Record<string, unknown>;
    r1175?: Record<string, unknown>;
    r1176?: Record<string, unknown>;
    r1185?: Record<string, unknown>;
  } = {},
): Promise<{
  r1076Path: string;
  r1135Path: string;
  r1142Path: string;
  r1144Path: string;
  r1148Path: string;
  r1149Path: string;
  r1151Path: string;
  r1152Path: string;
  r1153Path: string;
  r1154Path: string;
  r1155Path: string;
  r1156Path: string;
  r1157Path: string;
  r1158Path: string;
  r1159Path: string;
  r1160Path: string;
  r1161Path: string;
  r1162Path: string;
  r1163Path: string;
  r1164Path: string;
  r1165Path: string;
  r1167Path: string;
  r1170Path: string;
  r1172Path: string;
  r1173Path: string;
  r1174Path: string;
  r1175Path: string;
  r1176Path: string;
  r1185Path: string;
}> {
  const paths = {
    r1076Path: path.join(tmp, "r1076.json"),
    r1135Path: path.join(tmp, "r1135.json"),
    r1142Path: path.join(tmp, "r1142.json"),
    r1144Path: path.join(tmp, "r1144.json"),
    r1148Path: path.join(tmp, "r1148.json"),
    r1149Path: path.join(tmp, "r1149.json"),
    r1151Path: path.join(tmp, "r1151.json"),
    r1152Path: path.join(tmp, "r1152.json"),
    r1153Path: path.join(tmp, "r1153.json"),
    r1154Path: path.join(tmp, "r1154.json"),
    r1155Path: path.join(tmp, "r1155.json"),
    r1156Path: path.join(tmp, "r1156.json"),
    r1157Path: path.join(tmp, "r1157.json"),
    r1158Path: path.join(tmp, "r1158.json"),
    r1159Path: path.join(tmp, "r1159.json"),
    r1160Path: path.join(tmp, "r1160.json"),
    r1161Path: path.join(tmp, "r1161.json"),
    r1162Path: path.join(tmp, "r1162.json"),
    r1163Path: path.join(tmp, "r1163.json"),
    r1164Path: path.join(tmp, "r1164.json"),
    r1165Path: path.join(tmp, "r1165.json"),
    r1167Path: path.join(tmp, "r1167.json"),
    r1170Path: path.join(tmp, "r1170.json"),
    r1172Path: path.join(tmp, "r1172.json"),
    r1173Path: path.join(tmp, "r1173.json"),
    r1174Path: path.join(tmp, "r1174.json"),
    r1175Path: path.join(tmp, "r1175.json"),
    r1176Path: path.join(tmp, "r1176.json"),
    r1185Path: path.join(tmp, "r1185.json"),
  };
  await Promise.all([
    writeJson(paths.r1076Path, r1076Fixture()),
    writeJson(paths.r1135Path, overrides.r1135 ?? r1135Fixture()),
    writeJson(paths.r1142Path, overrides.r1142 ?? r1142Fixture()),
    writeJson(paths.r1144Path, overrides.r1144 ?? r1144Fixture()),
    writeJson(paths.r1148Path, overrides.r1148 ?? r1148Fixture()),
    writeJson(paths.r1149Path, overrides.r1149 ?? r1149Fixture()),
    writeJson(paths.r1151Path, overrides.r1151 ?? r1151Fixture()),
    writeJson(paths.r1152Path, overrides.r1152 ?? r1152Fixture()),
    writeJson(paths.r1153Path, overrides.r1153 ?? r1153Fixture()),
    writeJson(paths.r1154Path, overrides.r1154 ?? r1154Fixture()),
    writeJson(paths.r1155Path, overrides.r1155 ?? r1155Fixture()),
    writeJson(paths.r1156Path, overrides.r1156 ?? r1156Fixture()),
    writeJson(paths.r1157Path, overrides.r1157 ?? r1157Fixture()),
    writeJson(paths.r1158Path, overrides.r1158 ?? r1158Fixture()),
    writeJson(paths.r1159Path, overrides.r1159 ?? r1159Fixture()),
    writeJson(paths.r1160Path, overrides.r1160 ?? r1160Fixture()),
    writeJson(paths.r1161Path, overrides.r1161 ?? r1161Fixture()),
    writeJson(paths.r1162Path, overrides.r1162 ?? r1162Fixture()),
    overrides.r1163 === undefined ? Promise.resolve() : writeJson(paths.r1163Path, overrides.r1163),
    overrides.r1164 === undefined ? Promise.resolve() : writeJson(paths.r1164Path, overrides.r1164),
    overrides.r1165 === undefined ? Promise.resolve() : writeJson(paths.r1165Path, overrides.r1165),
    overrides.r1167 === undefined ? Promise.resolve() : writeJson(paths.r1167Path, overrides.r1167),
    overrides.r1170 === undefined ? Promise.resolve() : writeJson(paths.r1170Path, overrides.r1170),
    overrides.r1172 === undefined ? Promise.resolve() : writeJson(paths.r1172Path, overrides.r1172),
    overrides.r1173 === undefined ? Promise.resolve() : writeJson(paths.r1173Path, overrides.r1173),
    overrides.r1174 === undefined ? Promise.resolve() : writeJson(paths.r1174Path, overrides.r1174),
    overrides.r1175 === undefined ? Promise.resolve() : writeJson(paths.r1175Path, overrides.r1175),
    overrides.r1176 === undefined ? Promise.resolve() : writeJson(paths.r1176Path, overrides.r1176),
    overrides.r1185 === undefined ? Promise.resolve() : writeJson(paths.r1185Path, overrides.r1185),
  ]);
  return paths;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function r1076Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1076"),
    packetId: "r1076-current-autoresearch-loop-executor",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1076-current-autoresearch-loop-executor.v1",
    status: "research-local-aggregate-only",
    summary: {
      consumerAverageSubmitterSafeAvailabilityCompletionModeIds: ORDINARY_SUBMITTER_COMPLETION_MODE_IDS,
      consumerAverageSubmitterSafeAvailabilityActionPacketChecklistItemIds:
        ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS,
      nextAction: "fill_safe_availability_manifest_then_run_r1142_partial_private_chain",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1076: false,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };
}

function r1135Fixture(options: { primaryInputFamilyIds?: readonly string[] } = {}): Record<string, unknown> {
  const primaryInputFamilyIds = options.primaryInputFamilyIds ?? PRIMARY_INPUT_FAMILY_IDS;
  return {
    artifactBoundary: safeBoundary("R1135"),
    packetId: "r1135-ordinary-consumer-availability-manifest-packet",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1135-ordinary-consumer-availability-manifest-packet.v1",
    status: "research-local-aggregate-only",
    summary: {
      partialPrivateChainRunnerCommand: R1142_COMMAND,
      partialRouteManifestRecipeIds: ROUTE_RECIPE_IDS,
      preferredManifestRecipeIds: ROUTE_RECIPE_IDS,
      primarySubmitterInputFamilyIds: primaryInputFamilyIds,
      productDisplayAuthorized: false,
      realAggregateStillMissing: true,
      recipeReadinessChainRunnerCommand: R1144_COMMAND,
      requiredLinkageFamilyIds: ["outcome_linkage", "join_time_alignment"],
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1135: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };
}

function r1144Fixture(options: { rowOwnerConfirmed?: boolean } = {}): Record<string, unknown> {
  const rowOwnerConfirmed = options.rowOwnerConfirmed === true;
  return {
    artifactBoundary: safeBoundary("R1144"),
    packetId: "r1144-ordinary-consumer-recipe-readiness-chain-runner",
    productDisplayAuthorized: false,
    recipeReadinessChain: {
      commands: {
        recipeReadinessChainRunnerCommand: R1144_COMMAND,
      },
    },
    schemaVersion: "murph-age-r1144-ordinary-consumer-recipe-readiness-chain-runner.v1",
    status: "research-local-aggregate-only",
    summary: {
      eligiblePartialRouteIds: rowOwnerConfirmed ? ROUTE_IDS : [],
      fullEvidenceGateCleared: false,
      fullSupportedRouteReady: false,
      generatedManifestWritten: rowOwnerConfirmed,
      nextAction: rowOwnerConfirmed
        ? "fill_partial_private_config_for_ready_routes_then_run_r1141_partial_private_metric_runner"
        : "confirm_recipe_availability_assertions_before_running_chain",
      productDisplayAuthorized: false,
      readyPartialMetricRouteIds: [],
      requiredPrivateFieldRefFamilies: rowOwnerConfirmed ? REQUIRED_FIELD_REFS : [],
      requiredPrivateTableRefs: rowOwnerConfirmed ? REQUIRED_TABLE_REFS : [],
      reviewGptRequiredNow: false,
      rowOwnerAssertionsConfirmed: rowOwnerConfirmed,
      rowParsingPerformedByR1144: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };
}

function r1142Fixture(options: { routeMetricsReady?: boolean } = {}): Record<string, unknown> {
  const routeMetricsReady = options.routeMetricsReady === true;
  return {
    artifactBoundary: safeBoundary("R1142"),
    packetId: "r1142-ordinary-consumer-partial-private-chain-runner",
    partialPrivateChain: {
      commands: {
        partialPrivateChainRunnerCommand: R1142_COMMAND,
      },
      partialPrivateConfigSuppliedToRunner: routeMetricsReady,
      privateDetailsStored: false,
    },
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1142-ordinary-consumer-partial-private-chain-runner.v1",
    status: "research-local-private-inputs-aggregate-output",
    summary: {
      aggregateMetricsArtifact: routeMetricsReady
        ? "r1141-ordinary-consumer-partial-route-aggregate-metrics.json"
        : null,
      eligiblePartialRouteIds: ROUTE_IDS,
      executedPartialRouteIds: routeMetricsReady ? ROUTE_IDS : [],
      finalReadyPartialMetricRouteIds: routeMetricsReady ? ROUTE_IDS : [],
      fullEvidenceGateCleared: false,
      fullSupportedRouteReady: false,
      nextAction: routeMetricsReady
        ? "use_partial_metrics_for_research_only_collect_full_l1_l2_w1_qc_evidence"
        : "provide_partial_private_runner_config",
      productDisplayAuthorized: false,
      realAggregateStillMissing: !routeMetricsReady,
      reviewGptRequiredNow: false,
      routeMetricsReadyForR1138: routeMetricsReady,
      rowParsingPerformedByR1142: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };
}

function r1148Fixture(options: {
  omitSafeActionGuard?: boolean;
  ready?: boolean;
  suppliedIncomplete?: boolean;
} = {}): Record<string, unknown> {
  const ready = options.ready === true;
  const suppliedIncomplete = options.suppliedIncomplete === true;
  const packetReadyForConfigIntake = ready || suppliedIncomplete;
  const safeActionFields = options.omitSafeActionGuard === true
    ? {}
    : {
      r1147Conclusion: packetReadyForConfigIntake
        ? "ordinary_post_confirmation_private_config_packet_waiting_on_private_route_config"
        : "ordinary_post_confirmation_private_config_packet_waiting_on_safe_availability_confirmation",
      r1147NextAction: packetReadyForConfigIntake
        ? "fill_post_confirmation_private_config_and_run_r1142"
        : "fill_safe_availability_confirmation_from_template",
      safeAvailabilityActionPacketConclusion: packetReadyForConfigIntake
        ? "safe_availability_action_packet_ready_for_outcome_linked_recipe_readiness"
        : "safe_availability_action_packet_waiting_on_safe_confirmation",
      safeAvailabilityActionPacketFeatureOnlyCoverageContextReady: packetReadyForConfigIntake,
      safeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds: packetReadyForConfigIntake
        ? []
        : FEATURE_ONLY_PAIR_FAMILY_IDS,
      safeAvailabilityActionPacketMissingRequiredSourceFamilyIds: packetReadyForConfigIntake
        ? []
        : [
            "outcome_linkage",
            "join_time_alignment",
            ...FEATURE_ONLY_PAIR_FAMILY_IDS,
          ],
      safeAvailabilityActionPacketNextAction: packetReadyForConfigIntake
        ? "run_r1144_recipe_readiness_chain_with_confirmed_availability"
        : "fill_safe_availability_confirmation_from_template",
      safeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain: packetReadyForConfigIntake,
      safeAvailabilityActionPacketRowLevelDataAcceptedByR1154: false,
    };
  return {
    artifactBoundary: {
      ...safeBoundary("R1148"),
      configReadErrorStored: false,
      privateConfigPathStored: false,
      privateConfigValuesStored: false,
      privateFieldRefValuesStored: false,
      privateFieldRefsStored: false,
      privateTableRefValuesStored: false,
      privateTableRefsStored: false,
    },
    packetId: "r1148-ordinary-consumer-post-confirmation-private-config-intake",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1148-ordinary-consumer-post-confirmation-private-config-intake.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: ready
        ? "post_confirmation_private_config_ready_for_r1142"
        : suppliedIncomplete
          ? "post_confirmation_private_config_incomplete"
          : "post_confirmation_private_config_waiting_on_safe_availability_confirmation",
      evidenceRoleStatus: ready ? "complete_real_evidence" : "not_provided",
      expectedRouteIds: ROUTE_IDS,
      missingAttestationKeys: ready ? [] : ["localOnly"],
      missingRouteIds: ready ? [] : ROUTE_IDS,
      missingRunnerFieldRefKeys: ready ? [] : REQUIRED_FIELD_REFS,
      missingRunnerTableRefKeys: ready ? [] : REQUIRED_TABLE_REFS,
      nextAction: ready
        ? "run_r1142_for_real_lab_wearable_route_metrics"
        : suppliedIncomplete
          ? "complete_post_confirmation_private_runner_config_slots"
          : "fill_safe_availability_confirmation_from_template",
      ordinaryTableLayout: ready ? "single_primary_table_fallback" : "not_provided",
      packetReadyForConfigIntake,
      privateConfigStatus: ready || suppliedIncomplete ? "available" : "missing",
      privateConfigSuppliedToIntake: ready || suppliedIncomplete,
      productDisplayAuthorized: false,
      readyForR1142: ready,
      requestedRouteIds: ready ? ROUTE_IDS : [],
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1148: false,
      ...safeActionFields,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };
}

function r1149Fixture(options: { omitFeatureOnlyGuard?: boolean; ready?: boolean } = {}): Record<string, unknown> {
  const ready = options.ready === true;
  const featureOnlyMode = {
    conclusion: ready
      ? "ordinary_feature_only_mode_superseded_by_outcome_linked_evidence"
      : "ordinary_feature_only_mode_waiting_on_safe_availability_confirmation",
    featureOnlyCoverageContextAllowed: false,
    modelEvidencePromotionAllowed: false,
    outcomeLinkedEvidenceReady: ready,
    privateDetailsStored: false,
    supportedFeatureFamilyIds: ready ? ["bloodwork_glycemia", "wearable_activity_daily"] : [],
  };
  return {
    artifactBoundary: {
      ...safeBoundary("R1149"),
      privateConfigValuesStored: false,
      privateFieldRefValuesStored: false,
      privateFieldRefsStored: false,
      privateTableRefValuesStored: false,
      privateTableRefsStored: false,
    },
    packetId: "r1149-ordinary-consumer-lab-wearable-submission-kit",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1149-ordinary-consumer-lab-wearable-submission-kit.v1",
    status: "research-local-aggregate-only",
    ...(options.omitFeatureOnlyGuard === true
      ? {}
      : {
        ordinaryConsumerSubmissionKit: {
          commands: {
            featureOnlySubmissionModeCommand:
              "pnpm exec tsx scripts/murph-age/r1151-ordinary-consumer-feature-only-submission-mode.ts",
          },
          featureOnlySubmissionMode: featureOnlyMode,
        },
      }),
    summary: {
      conclusion: ready
        ? "ordinary_consumer_lab_wearable_submission_kit_ready_for_research_review"
        : "ordinary_consumer_lab_wearable_submission_kit_waiting_on_row_owner_confirmation",
      expectedRouteIds: ROUTE_IDS,
      ...(options.omitFeatureOnlyGuard === true
        ? {}
        : {
          featureOnlyModeConclusion: featureOnlyMode.conclusion,
          featureOnlyModeModelEvidencePromotionAllowed: featureOnlyMode.modelEvidencePromotionAllowed,
          featureOnlyModeOutcomeLinkedEvidenceReady: featureOnlyMode.outcomeLinkedEvidenceReady,
          featureOnlyModeSupportedFeatureFamilyIds: featureOnlyMode.supportedFeatureFamilyIds,
        }),
      nextAction: ready
        ? "review_real_lab_wearable_route_metrics_research_only"
        : "confirm_lab_plus_wearable_recipe_availability_assertions",
      optionalAddOnFamilyIds: [
        "common_bloodwork_core",
        "vitals_body_context",
      ],
      privateConfigReadyForR1142: ready,
      privateConfigStatus: ready ? "available" : "missing",
      productDisplayAuthorized: false,
      readyForResearchReview: ready,
      requiredSourceFamilyIds: [
        "outcome_linkage",
        "join_time_alignment",
        "bloodwork_glycemia",
        "wearable_activity_daily",
      ],
      reviewGptRequiredNow: false,
      rowOwnerAssertionsConfirmed: ready,
      rowParsingPerformedByR1149: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
      topBlocker: ready ? null : "row_owner_availability_assertions_not_confirmed",
    },
  };
}

function r1151Fixture(
  options: { modelPromotionAllowed?: boolean; omitPairGuard?: boolean; ready?: boolean } = {},
): Record<string, unknown> {
  const ready = options.ready === true;
  const modelEvidencePromotionAllowed = options.modelPromotionAllowed === true;
  const pairGuard = options.omitPairGuard === true
    ? {}
    : {
      featureOnlyCoverageRequiresPreferredPair: true,
      minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
      outcomeLinkageRequiredForFeatureOnlyContext: false,
      rowLevelDataAcceptedByR1151: false,
    };
  return {
    artifactBoundary: {
      ...safeBoundary("R1151"),
      featureValuesStored: false,
      fileNamesStored: false,
      privateFieldRefValuesStored: false,
      privateTableRefValuesStored: false,
    },
    packetId: "r1151-ordinary-consumer-feature-only-submission-mode",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1151-ordinary-consumer-feature-only-submission-mode.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: ready
        ? "ordinary_feature_only_mode_superseded_by_outcome_linked_evidence"
        : "ordinary_feature_only_mode_waiting_on_safe_availability_confirmation",
      featureOnlyCoverageContextAllowed: false,
      featureOnlyPreferredPairReady: ready,
      ...pairGuard,
      missingAttestationKeys: ready ? [] : ["aggregateOnly", "localOnly"],
      missingEvidenceSourceFamilyIds: ready ? [] : ["outcome_linkage", "join_time_alignment"],
      missingPrimaryFeatureFamilyIds: ready ? [] : ["bloodwork_glycemia", "wearable_activity_daily"],
      modelEvidencePromotionAllowed,
      nextAction: ready
        ? "run_r1144_recipe_readiness_chain_with_confirmed_availability"
        : "fill_safe_availability_confirmation_from_template",
      outcomeLinkedEvidenceReady: ready,
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1151: false,
      supportedFeatureFamilyIds: ready ? ["bloodwork_glycemia", "wearable_activity_daily"] : [],
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };
}

function r1152Fixture(
  options: { modelPromotionAllowed?: boolean; ready?: boolean } = {},
): Record<string, unknown> {
  const ready = options.ready === true;
  const modelEvidencePromotionAllowed = options.modelPromotionAllowed === true;
  return {
    artifactBoundary: {
      ...safeBoundary("R1152"),
      featureValuesStored: false,
      fileNamesStored: false,
      privateFieldRefValuesStored: false,
      privateTableRefValuesStored: false,
    },
    packetId: "r1152-ordinary-consumer-feature-only-coverage-context-intake",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1152-ordinary-consumer-feature-only-coverage-context-intake.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: ready
        ? "feature_only_coverage_context_ready_research_only"
        : "feature_only_coverage_context_waiting_on_r1151_ready",
      contextPathConfigured: ready,
      contextStatus: ready ? "available" : "missing",
      coverageContextReadyForResearchPlanning: ready,
      featureOnlyCoverageRequiresPreferredPair: true,
      minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
      missingAttestationKeys: ready ? [] : ["aggregateOnly", "localOnly"],
      missingPrimaryFeatureFamilyIds: ready ? [] : ["bloodwork_glycemia", "wearable_activity_daily"],
      modelEvidencePromotionAllowed,
      nextAction: ready
        ? "use_feature_only_coverage_context_for_research_planning_only"
        : "refresh_r1151_feature_only_submission_mode",
      outcomeLinkageRequiredForFeatureOnlyContext: false,
      productDisplayAuthorized: false,
      r1151FeatureOnlyCoverageContextAllowed: ready,
      r1151FeatureOnlyModeReadyForIntake: ready,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1152: false,
      rowParsingPerformedByR1152: false,
      supportedFeatureFamilyIds: ready ? ["bloodwork_glycemia", "wearable_activity_daily"] : [],
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };
}

function r1153Fixture(
  options: { aggregateOnly?: boolean; modelPromotionAllowed?: boolean; ready?: boolean } = {},
): Record<string, unknown> {
  const ready = options.ready === true;
  const modelEvidencePromotionAllowed = options.modelPromotionAllowed === true;
  return {
    artifactBoundary: {
      ...safeBoundary("R1153"),
      aggregateOnly: options.aggregateOnly ?? true,
      availabilityConfirmationPathStored: false,
      contextPathStored: false,
      featureValuesStored: false,
      fileNamesStored: false,
      privateFieldRefValuesStored: false,
      privateTableRefValuesStored: false,
      rowLevelDataAcceptedByR1153: false,
    },
    packetId: "r1153-ordinary-consumer-feature-only-chain-runner",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1153-ordinary-consumer-feature-only-chain-runner.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: ready
        ? "ordinary_feature_only_chain_ready_research_only"
        : "ordinary_feature_only_chain_waiting_on_safe_availability_confirmation",
      contextPathConfigured: ready,
      coverageContextReadyForResearchPlanning: ready,
      featureOnlyCoverageContextAllowed: ready,
      featureOnlyCoverageContextIntakeConclusion: ready
        ? "feature_only_coverage_context_ready_research_only"
        : "feature_only_coverage_context_waiting_on_r1151_ready",
      featureOnlyCoverageContextIntakeContextStatus: ready ? "available" : "missing",
      featureOnlyModeConclusion: ready
        ? "ordinary_feature_only_mode_available_not_model_evidence"
        : "ordinary_feature_only_mode_waiting_on_safe_availability_confirmation",
      minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
      missingCoverageContextPrimaryFeatureFamilyIds: ready ? [] : FEATURE_ONLY_PAIR_FAMILY_IDS,
      missingFeatureOnlySourceFamilyIds: ready ? [] : FEATURE_ONLY_PAIR_FAMILY_IDS,
      modelEvidencePromotionAllowed,
      nextAction: ready
        ? "use_feature_only_coverage_context_for_research_planning_only"
        : "fill_safe_availability_confirmation_from_template",
      outcomeLinkageRequiredForFeatureOnlyContext: false,
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1153: false,
      rowParsingPerformedByR1153: false,
      safeAvailabilityFeatureOnlyCoverageContextReady: ready,
      safeAvailabilityReadyForRecipeReadinessChain: false,
      supportedFeatureFamilyIds: ready ? FEATURE_ONLY_PAIR_FAMILY_IDS : [],
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };
}

function r1154Fixture(
  options: {
    omitChecklist?: boolean;
    omitFieldEditPaths?: boolean;
    ready?: boolean;
    rowLevelDataAccepted?: boolean;
  } = {},
): Record<string, unknown> {
  const ready = options.ready === true;
  const rowLevelDataAccepted = options.rowLevelDataAccepted === true;
  const checklistFields = options.omitChecklist === true
    ? {}
    : {
      ordinarySubmitterSafeCompletionChecklist: ordinarySubmitterSafeCompletionChecklistFixture(),
    };
  const checklistSummaryFields = options.omitChecklist === true
    ? {}
    : {
      ordinarySubmitterSafeCompletionChecklistItemIds: ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS,
    };
  const fieldEditFields = options.omitFieldEditPaths === true
    ? {}
    : {
      featureOnlyQuickstartSafeFieldEditCount: R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
      featureOnlyQuickstartSafeFieldEditPaths: R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS,
    };
  return {
    artifactBoundary: {
      ...safeBoundary("R1154"),
      availabilityConfirmationPathStored: false,
      fileNamesStored: false,
      privateFieldRefValuesStored: false,
      privateTableRefValuesStored: false,
      rowLevelDataAcceptedByR1154: rowLevelDataAccepted,
    },
    packetId: "r1154-ordinary-consumer-safe-availability-action-packet",
    productDisplayAuthorized: false,
    safeAvailabilityActionPacket: {
      expectedRouteIds: ROUTE_IDS,
      featureOnlyCoverageContextReady: ready,
      featureOnlyFillableTemplateArtifact: R1150_FEATURE_ONLY_CONFIRMATION_TEMPLATE_ARTIFACT,
      featureOnlyQuickstartArtifact: R1154_FEATURE_ONLY_QUICKSTART_ARTIFACT,
      ...fieldEditFields,
      fillableTemplateArtifact: R1150_FULL_CONFIRMATION_TEMPLATE_ARTIFACT,
      minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
      missingAggregateReadinessFactIds: ready
        ? []
        : ["outcomeLinked", "sameDenominator", "targetAgeBand", "usableRecordCountBand", "eventCountBand"],
      missingAttestationKeys: ready ? [] : ["aggregateOnly", "localOnly"],
      missingFeatureOnlySourceFamilyIds: ready ? [] : FEATURE_ONLY_PAIR_FAMILY_IDS,
      missingRequiredSourceFamilyIds: ready
        ? []
        : ["outcome_linkage", "join_time_alignment", "bloodwork_glycemia", "wearable_activity_daily"],
      ordinarySubmitterCompletionModes: ordinarySubmitterCompletionModesFixture(),
      outcomeLinkageRequiredForFeatureOnlyContext: false,
      ...checklistFields,
      preferredRecipeId: "lab_plus_wearable_minimum_manifest",
      privateDetailsStored: false,
      readyForOutcomeLinkedRecipeReadinessChain: ready,
      rowLevelDataAcceptedByR1154: rowLevelDataAccepted,
      rowOwnerAssertionsConfirmed: ready,
      rowOwnerWorkType: ready
        ? "run_outcome_linked_recipe_readiness"
        : "fill_safe_availability_confirmation",
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
    schemaVersion: "murph-age-r1154-ordinary-consumer-safe-availability-action-packet.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: ready
        ? "safe_availability_action_packet_ready_for_outcome_linked_recipe_readiness"
        : "safe_availability_action_packet_waiting_on_safe_confirmation",
      expectedRouteIds: ROUTE_IDS,
      featureOnlyCoverageContextReady: ready,
      featureOnlyFillableTemplateArtifact: R1150_FEATURE_ONLY_CONFIRMATION_TEMPLATE_ARTIFACT,
      featureOnlyQuickstartArtifact: R1154_FEATURE_ONLY_QUICKSTART_ARTIFACT,
      ...fieldEditFields,
      fillableTemplateArtifact: R1150_FULL_CONFIRMATION_TEMPLATE_ARTIFACT,
      minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
      missingAggregateReadinessFactIds: ready
        ? []
        : ["outcomeLinked", "sameDenominator", "targetAgeBand", "usableRecordCountBand", "eventCountBand"],
      missingAttestationKeys: ready ? [] : ["aggregateOnly", "localOnly"],
      missingFeatureOnlySourceFamilyIds: ready ? [] : FEATURE_ONLY_PAIR_FAMILY_IDS,
      missingRequiredSourceFamilyIds: ready
        ? []
        : ["outcome_linkage", "join_time_alignment", "bloodwork_glycemia", "wearable_activity_daily"],
      nextAction: ready
        ? "run_r1144_recipe_readiness_chain_with_confirmed_availability"
        : "fill_safe_availability_confirmation_from_template",
      outcomeLinkageRequiredForFeatureOnlyContext: false,
      ordinarySubmitterCompletionModeIds: ORDINARY_SUBMITTER_COMPLETION_MODE_IDS,
      ...checklistSummaryFields,
      preferredRecipeId: "lab_plus_wearable_minimum_manifest",
      productDisplayAuthorized: false,
      readyForOutcomeLinkedRecipeReadinessChain: ready,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1154: rowLevelDataAccepted,
      rowOwnerAssertionsConfirmed: ready,
      rowOwnerWorkType: ready
        ? "run_outcome_linked_recipe_readiness"
        : "fill_safe_availability_confirmation",
      rowParsingPerformedByR1154: false,
      safeAvailabilityConfirmationStatus: ready ? "available" : "missing",
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };
}

function r1155Fixture(
  options: {
    modelEvidencePromotionAllowed?: boolean;
  } = {},
): Record<string, unknown> {
  const modelEvidencePromotionAllowed = options.modelEvidencePromotionAllowed === true;
  return {
    artifactBoundary: {
      ...safeBoundary("R1155"),
      confirmationPathStored: false,
      confirmationValuesStored: false,
      contextPathStored: false,
      featureValuesStored: false,
      fileNamesStored: false,
      privateFieldRefValuesStored: false,
      privateTableRefValuesStored: false,
      rowLevelDataAcceptedByR1155: false,
      temporaryConfirmationPersisted: false,
    },
    packetId: "r1155-ordinary-consumer-safe-confirmation-feature-only-smoke-proof",
    productDisplayAuthorized: false,
    safeConfirmationFeatureOnlySmokeProof: {
      compactConfirmationSourceFamilyIds: FEATURE_ONLY_PAIR_FAMILY_IDS,
      derivedCoverageContextUsed: true,
      featureOnlyChainConclusion: "ordinary_feature_only_chain_ready_research_only",
      featureOnlyChainNextAction: "use_feature_only_coverage_context_for_research_planning_only",
      featureOnlyCoverageContextIntakeConclusion: "feature_only_coverage_context_ready_research_only",
      featureOnlyCoverageContextReadyForResearchPlanning: true,
      featureOnlyModeConclusion: "ordinary_feature_only_mode_available_not_model_evidence",
      modelEvidencePromotionAllowed,
      outcomeLinkedEvidenceIncludedInSmoke: false,
      productDisplayAuthorized: false,
      readyForRecipeReadinessChain: false,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1155: false,
      rowParsingPerformedByR1155: false,
      safeAvailabilityConfirmationConclusion: "safe_availability_confirmation_feature_only_ready_research_only",
      smokeEvidenceRole: "feature_only_safe_confirmation_smoke_only_not_model_evidence",
      temporaryConfirmationValuesPersistedInArtifact: false,
      temporaryConfirmationWrittenByR1155: true,
    },
    schemaVersion: "murph-age-r1155-ordinary-consumer-safe-confirmation-feature-only-smoke-proof.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "ordinary_safe_confirmation_feature_only_smoke_passed_non_evidence",
      featureOnlyChainConclusion: "ordinary_feature_only_chain_ready_research_only",
      featureOnlyCoverageContextReadyForResearchPlanning: true,
      modelEvidencePromotionAllowed,
      nextAction: "use_r1150_r1153_path_with_real_safe_availability_confirmation",
      productDisplayAuthorized: false,
      readyForRecipeReadinessChain: false,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1155: false,
      rowParsingPerformedByR1155: false,
      safeAvailabilityConfirmationConclusion: "safe_availability_confirmation_feature_only_ready_research_only",
      smokeEvidence: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };
}

function r1156Fixture(
  options: {
    readyForRecipe?: boolean;
  } = {},
): Record<string, unknown> {
  const readyForRecipe = options.readyForRecipe === true;
  return {
    artifactBoundary: {
      ...safeBoundary("R1156"),
      availabilityConfirmationPathStored: false,
      confirmationValuesStored: false,
      featureValuesStored: false,
      fileNamesStored: false,
      headerValuesStored: false,
      privateConfigValuesStored: false,
      privateFieldRefValuesStored: false,
      privateFieldRefsStored: false,
      privateTableRefValuesStored: false,
      privateTableRefsStored: false,
      rowLevelDataAcceptedByR1156: false,
      rowParsingPerformedByR1156: false,
      smokeEvidenceStoredAsModelEvidence: false,
      sourceFileNamesStored: false,
      sourceVariableNamesStored: false,
    },
    packetId: "r1156-ordinary-consumer-safe-confirmation-handoff",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1156-ordinary-consumer-safe-confirmation-handoff.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: readyForRecipe
        ? "ordinary_safe_confirmation_handoff_ready_for_feature_only_or_recipe_next_step_non_evidence"
        : "ordinary_safe_confirmation_handoff_ready_for_row_owner_fill_non_evidence",
      featureOnlyPathMechanicallyProven: true,
      handoffReadyForRowOwner: true,
      modelEvidencePromotionAllowed: false,
      nextAction: readyForRecipe
        ? "run_r1144_recipe_readiness_chain_with_confirmed_availability"
        : "fill_safe_availability_confirmation_from_template",
      productDisplayAuthorized: false,
      readyForModelEvidence: false,
      readyForRecipeReadinessChain: readyForRecipe,
      requiredFeatureOnlySourceFamilyIds: FEATURE_ONLY_PAIR_FAMILY_IDS,
      requiredSafeCompletionCheckIds: ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1156: false,
      rowOwnerWorkType: readyForRecipe
        ? "run_feature_only_or_recipe_next_step"
        : "fill_safe_availability_confirmation",
      rowParsingPerformedByR1156: false,
      safeAvailabilityActionPacketConclusion: readyForRecipe
        ? "safe_availability_action_packet_ready_for_outcome_linked_recipe_readiness"
        : "safe_availability_action_packet_waiting_on_safe_confirmation",
      safeAvailabilityActionPacketNextAction: readyForRecipe
        ? "run_r1144_recipe_readiness_chain_with_confirmed_availability"
        : "fill_safe_availability_confirmation_from_template",
      safeConfirmationFeatureOnlySmokeProofConclusion:
        "ordinary_safe_confirmation_feature_only_smoke_passed_non_evidence",
      safeConfirmationStillRequired: !readyForRecipe,
      smokeEvidence: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };
}

function r1157Fixture(
  options: {
    readyForRecipe?: boolean;
  } = {},
): Record<string, unknown> {
  const readyForRecipe = options.readyForRecipe === true;
  return {
    artifactBoundary: {
      ...safeBoundary("R1157"),
      availabilityConfirmationPathStored: false,
      confirmationValuesStored: false,
      contextPathStored: false,
      featureValuesStored: false,
      fileNamesStored: false,
      headerValuesStored: false,
      privateConfigValuesStored: false,
      privateFieldRefValuesStored: false,
      privateFieldRefsStored: false,
      privateTableRefValuesStored: false,
      privateTableRefsStored: false,
      rowLevelDataAcceptedByR1157: false,
      rowParsingPerformedByR1157: false,
      sourceFileNamesStored: false,
      sourceVariableNamesStored: false,
      temporaryConfirmationPersistedByR1157: false,
    },
    packetId: "r1157-ordinary-consumer-safe-confirmation-chain-runner",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1157-ordinary-consumer-safe-confirmation-chain-runner.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: readyForRecipe
        ? "ordinary_safe_confirmation_chain_ready_for_recipe_readiness_or_model_evidence_review"
        : "ordinary_safe_confirmation_chain_waiting_on_safe_confirmation",
      confirmationPathConfigured: readyForRecipe,
      featureOnlyCoverageContextReady: readyForRecipe,
      featureOnlyResearchPlanningReady: readyForRecipe,
      modelEvidencePromotionAllowed: false,
      nextAction: readyForRecipe
        ? "run_r1144_recipe_readiness_chain_with_confirmed_availability"
        : "fill_safe_availability_confirmation_from_template",
      productDisplayAuthorized: false,
      readyForModelEvidence: false,
      readyForRecipeReadinessChain: readyForRecipe,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1157: false,
      rowParsingPerformedByR1157: false,
      safeAvailabilityActionPacketConclusion: readyForRecipe
        ? "safe_availability_action_packet_ready_for_outcome_linked_recipe_readiness"
        : "safe_availability_action_packet_waiting_on_safe_confirmation",
      safeAvailabilityConfirmationConclusion: readyForRecipe
        ? "safe_availability_confirmation_ready_for_outcome_linked_recipe_research_only"
        : "safe_availability_confirmation_not_provided",
      safeConfirmationChainRunnerCommand: R1157_COMMAND,
      safeConfirmationHandoffConclusion: readyForRecipe
        ? "ordinary_safe_confirmation_handoff_ready_for_feature_only_or_recipe_next_step_non_evidence"
        : "ordinary_safe_confirmation_handoff_ready_for_row_owner_fill_non_evidence",
      safeConfirmationStillRequired: !readyForRecipe,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };
}

function r1158Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      ...safeBoundary("R1158"),
      availabilityConfirmationPathStored: false,
      confirmationValuesStored: false,
      featureValuesStored: false,
      fileNamesStored: false,
      headerValuesStored: false,
      privateConfigValuesStored: false,
      privateFieldRefValuesStored: false,
      privateFieldRefsStored: false,
      privateTableRefValuesStored: false,
      privateTableRefsStored: false,
      rowLevelDataAcceptedByR1158: false,
      rowParsingPerformedByR1158: false,
      sourceFileNamesStored: false,
      sourceVariableNamesStored: false,
    },
    packetId: "r1158-ordinary-consumer-safe-confirmation-fill-guide",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1158-ordinary-consumer-safe-confirmation-fill-guide.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "ordinary_safe_confirmation_fill_guide_ready_non_evidence",
      exactSafeFieldEditCount: R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
      guideReadyForRowOwnerFill: true,
      minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: "fill_safe_availability_confirmation_from_template",
      optionalAddOnFamilyIds: R1158_OPTIONAL_ADD_ON_FAMILY_IDS,
      productDisplayAuthorized: false,
      recommendedCompletionModeId: "feature_only_lab_wearable_coverage",
      requiredChecklistIds: R1158_REQUIRED_CHECKLIST_IDS,
      requiredInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1158: false,
      rowParsingPerformedByR1158: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };
}

function r1159Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      ...safeBoundary("R1159"),
      answerSheetTemplatePathStored: false,
      availabilityConfirmationPathStored: false,
      featureValuesStored: false,
      fileNamesStored: false,
      headerValuesStored: false,
      privateConfigValuesStored: false,
      privateFieldRefValuesStored: false,
      privateFieldRefsStored: false,
      privateTableRefValuesStored: false,
      privateTableRefsStored: false,
      rowLevelDataAcceptedByR1159: false,
      rowOwnerProvidedValuesStored: false,
      rowParsingPerformedByR1159: false,
      sourceFileNamesStored: false,
      sourceVariableNamesStored: false,
      submittedConfirmationValuesStored: false,
    },
    packetId: "r1159-ordinary-consumer-safe-confirmation-answer-sheet",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1159-ordinary-consumer-safe-confirmation-answer-sheet.v1",
    status: "research-local-aggregate-only",
    summary: {
      answerSheetReadyForRowOwner: true,
      conclusion: "ordinary_safe_confirmation_answer_sheet_ready_non_evidence",
      exactSafeAnswerCount: R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
      featureOnlyTemplateReady: true,
      fillGuideReadyForRowOwnerFill: true,
      minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: R1159_ANSWER_SHEET_NEXT_ACTION,
      optionalAddOnFamilyIds: R1158_OPTIONAL_ADD_ON_FAMILY_IDS,
      productDisplayAuthorized: false,
      recommendedCompletionModeId: "feature_only_lab_wearable_coverage",
      requiredChecklistIds: R1158_REQUIRED_CHECKLIST_IDS,
      requiredInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1159: false,
      rowOwnerProvidedValuesStored: false,
      rowParsingPerformedByR1159: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };
}

function r1160Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      ...safeBoundary("R1160"),
      answerSheetValuesStored: false,
      availabilityConfirmationPathStored: false,
      confirmationValuesStoredByR1160: false,
      featureValuesStored: false,
      fileNamesStored: false,
      headerValuesStored: false,
      privateConfigValuesStored: false,
      privateFieldRefValuesStored: false,
      privateFieldRefsStored: false,
      privateTableRefValuesStored: false,
      privateTableRefsStored: false,
      rowLevelDataAcceptedByR1160: false,
      rowOwnerProvidedValuesStored: false,
      rowParsingPerformedByR1160: false,
      sourceFileNamesStored: false,
      sourceVariableNamesStored: false,
      transcribedConfirmationPersisted: false,
    },
    packetId: "r1160-r1159-feature-only-safe-confirmation-transcription-proof",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1160-r1159-feature-only-safe-confirmation-transcription-proof.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "r1159_feature_only_safe_confirmation_transcription_ready_non_evidence",
      confirmationValuesStoredByR1160: false,
      exactSafeTranscriptionStepCount: R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
      featureOnlyTemplateReady: true,
      hypotheticalTranscriptionWouldBeFeatureOnlyReady: true,
      minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: R1160_TRANSCRIPTION_PROOF_NEXT_ACTION,
      optionalAddOnFamilyIds: R1158_OPTIONAL_ADD_ON_FAMILY_IDS,
      productDisplayAuthorized: false,
      requiredChecklistIds: R1158_REQUIRED_CHECKLIST_IDS,
      requiredInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1160: false,
      rowOwnerConfirmationStillRequired: true,
      rowOwnerProvidedValuesStored: false,
      rowParsingPerformedByR1160: false,
      r1159AnswerSheetReadyForRowOwner: true,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
      transcriptionProofReadyForRowOwnerConfirmation: true,
    },
  };
}

function r1161Fixture(options: { materialized?: boolean } = {}): Record<string, unknown> {
  const materialized = options.materialized === true;
  return {
    artifactBoundary: {
      ...safeBoundary("R1161"),
      confirmationArtifactLocalPathStored: false,
      confirmationValuesStoredInR1161Packet: false,
      fileNamesStored: false,
      headerValuesStored: false,
      privateConfigValuesStored: false,
      privateFieldRefValuesStored: false,
      privateFieldRefsStored: false,
      privateTableRefValuesStored: false,
      privateTableRefsStored: false,
      rowLevelDataAcceptedByR1161: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1161: false,
      safeConfirmationArtifactWrittenOnlyAfterExplicitAssertion: true,
      sourceFileNamesStored: false,
      sourceVariableNamesStored: false,
    },
    materializer: {
      confirmedConfirmationArtifact: materialized
        ? "r1161-confirmed-feature-only-safe-availability-confirmation.json"
        : null,
      explicitRowOwnerConfirmationAssertionProvided: materialized,
      featureOnlyConfirmationWouldBeReadyForR1150: materialized,
      featureOnlyTemplateReady: true,
      minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      optionalAddOnFamilyIds: R1158_OPTIONAL_ADD_ON_FAMILY_IDS,
      privateDetailsStored: false,
      r1150FeatureOnlyTemplateArtifact: R1150_FEATURE_ONLY_CONFIRMATION_TEMPLATE_ARTIFACT,
      r1160ProofReadyForRowOwnerConfirmation: true,
      rowLevelDataAcceptedByR1161: false,
      rowOwnerConfirmationStillRequired: !materialized,
      rowOwnerPrivateValuesStored: false,
      safeConfirmationArtifactWritten: materialized,
      safeMaterializedFieldCount: materialized ? R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length : 0,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
    packetId: "r1161-feature-only-safe-availability-confirmation-materializer",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1161-feature-only-safe-availability-confirmation-materializer.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: materialized
        ? "feature_only_safe_availability_confirmation_materialized"
        : "feature_only_safe_availability_confirmation_materializer_waiting_on_explicit_row_owner_confirmation",
      confirmationArtifactLocalPathStored: false,
      confirmationValuesStoredInR1161Packet: false,
      explicitRowOwnerConfirmationAssertionProvided: materialized,
      featureOnlyConfirmationWouldBeReadyForR1150: materialized,
      featureOnlyTemplateReady: true,
      minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: materialized
        ? R1161_MATERIALIZED_NEXT_ACTION
        : R1161_MATERIALIZER_NEXT_ACTION,
      optionalAddOnFamilyIds: R1158_OPTIONAL_ADD_ON_FAMILY_IDS,
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1161: false,
      rowOwnerConfirmationStillRequired: !materialized,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1161: false,
      r1160ProofReadyForRowOwnerConfirmation: true,
      safeConfirmationArtifact: materialized
        ? "r1161-confirmed-feature-only-safe-availability-confirmation.json"
        : null,
      safeConfirmationArtifactWritten: materialized,
      safeMaterializedFieldCount: materialized ? R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length : 0,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };
}

function r1162Fixture(options: { materialized?: boolean } = {}): Record<string, unknown> {
  const materialized = options.materialized === true;
  const nextAction = materialized ? R1161_MATERIALIZED_NEXT_ACTION : R1162_ASSERTION_HANDOFF_NEXT_ACTION;
  return {
    artifactBoundary: {
      ...safeBoundary("R1162"),
      confirmationArtifactLocalPathStored: false,
      confirmationValuesStoredByR1162: false,
      fileNamesStored: false,
      headerValuesStored: false,
      privateConfigValuesStored: false,
      privateFieldRefValuesStored: false,
      privateFieldRefsStored: false,
      privateTableRefValuesStored: false,
      privateTableRefsStored: false,
      rowLevelDataAcceptedByR1162: false,
      rowOwnerAssertionInferredByR1162: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1162: false,
      sourceFileNamesStored: false,
      sourceVariableNamesStored: false,
    },
    assertionHandoff: {
      handoffCommand: "pnpm exec tsx scripts/murph-age/r1162-feature-only-safe-confirmation-assertion-handoff.ts",
      handoffReadyForRowOwner: true,
      materializerCommand:
        "MURPH_AGE_R1161_ROW_OWNER_FEATURE_ONLY_CONFIRMATION_ASSERTIONS_CONFIRMED=true pnpm exec tsx scripts/murph-age/r1161-feature-only-safe-availability-confirmation-materializer.ts",
      minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextActionAfterAssertion: nextAction,
      optionalAddOnFamilyIds: R1158_OPTIONAL_ADD_ON_FAMILY_IDS,
      requiredChecklistIds: R1158_REQUIRED_CHECKLIST_IDS,
      requiredInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
      rowLevelDataAcceptedByR1162: false,
      rowOwnerAssertionStillRequired: !materialized,
      rowOwnerPrivateValuesStored: false,
      safeConfirmationArtifact: materialized
        ? "r1161-confirmed-feature-only-safe-availability-confirmation.json"
        : null,
      safeConfirmationArtifactWritten: materialized,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
    materializerState: {
      artifact: "r1161-feature-only-safe-availability-confirmation-materializer.latest.json",
      conclusion: materialized
        ? "feature_only_safe_availability_confirmation_materialized"
        : "feature_only_safe_availability_confirmation_materializer_waiting_on_explicit_row_owner_confirmation",
      explicitRowOwnerConfirmationAssertionProvided: materialized,
      featureOnlyConfirmationWouldBeReadyForR1150: materialized,
      featureOnlyTemplateReady: true,
      nextAction: materialized ? R1161_MATERIALIZED_NEXT_ACTION : R1161_MATERIALIZER_NEXT_ACTION,
      r1160ProofReadyForRowOwnerConfirmation: true,
      rowOwnerConfirmationStillRequired: !materialized,
      safeConfirmationArtifact: materialized
        ? "r1161-confirmed-feature-only-safe-availability-confirmation.json"
        : null,
      safeConfirmationArtifactWritten: materialized,
      safeMaterializedFieldCount: materialized ? R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length : 0,
    },
    packetId: "r1162-feature-only-safe-confirmation-assertion-handoff",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1162-feature-only-safe-confirmation-assertion-handoff.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: materialized
        ? "feature_only_safe_confirmation_assertion_handoff_satisfied"
        : "feature_only_safe_confirmation_assertion_handoff_ready_for_row_owner_assertion",
      confirmationValuesStoredByR1162: false,
      explicitRowOwnerConfirmationAssertionProvided: materialized,
      featureOnlyConfirmationWouldBeReadyForR1150: materialized,
      handoffCommand: "pnpm exec tsx scripts/murph-age/r1162-feature-only-safe-confirmation-assertion-handoff.ts",
      handoffReadyForRowOwner: true,
      materializerCommand:
        "MURPH_AGE_R1161_ROW_OWNER_FEATURE_ONLY_CONFIRMATION_ASSERTIONS_CONFIRMED=true pnpm exec tsx scripts/murph-age/r1161-feature-only-safe-availability-confirmation-materializer.ts",
      materializerConclusion: materialized
        ? "feature_only_safe_availability_confirmation_materialized"
        : "feature_only_safe_availability_confirmation_materializer_waiting_on_explicit_row_owner_confirmation",
      materializerNextAction: materialized ? R1161_MATERIALIZED_NEXT_ACTION : R1161_MATERIALIZER_NEXT_ACTION,
      minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction,
      optionalAddOnFamilyIds: R1158_OPTIONAL_ADD_ON_FAMILY_IDS,
      productDisplayAuthorized: false,
      requiredChecklistIds: R1158_REQUIRED_CHECKLIST_IDS,
      requiredInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1162: false,
      rowOwnerAssertionInferredByR1162: false,
      rowOwnerAssertionStillRequired: !materialized,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1162: false,
      safeConfirmationArtifact: materialized
        ? "r1161-confirmed-feature-only-safe-availability-confirmation.json"
        : null,
      safeConfirmationArtifactWritten: materialized,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };
}

function r1163Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      ...safeBoundary("R1163"),
      childOutputPathsStored: false,
      confirmationArtifactLocalPathStored: false,
      confirmationValuesStoredByR1163: false,
      featureValuesStored: false,
      fileNamesStored: false,
      headerValuesStored: false,
      privateConfigValuesStored: false,
      privateFieldRefValuesStored: false,
      privateFieldRefsStored: false,
      privateTableRefValuesStored: false,
      privateTableRefsStored: false,
      rowLevelDataAcceptedByR1163: false,
      rowOwnerAssertionInferredByR1163: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1163: false,
      sourceFileNamesStored: false,
      sourceVariableNamesStored: false,
    },
    packetId: "r1163-feature-only-safe-confirmation-to-research-runner",
    productDisplayAuthorized: false,
    runner: {
      runnerCommand: R1163_ASSERTION_TO_RESEARCH_RUNNER_COMMAND,
    },
    schemaVersion: "murph-age-r1163-feature-only-safe-confirmation-to-research-runner.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "feature_only_safe_confirmation_to_research_runner_waiting_on_row_owner_assertion",
      confirmedSafeConfirmationArtifact: null,
      explicitRowOwnerConfirmationAssertionProvided: false,
      featureOnlyChainConclusion: null,
      featureOnlyChainRan: false,
      featureOnlyResearchPlanningReady: false,
      materializerConclusion:
        "feature_only_safe_availability_confirmation_materializer_waiting_on_explicit_row_owner_confirmation",
      materializerNextAction: R1161_MATERIALIZER_NEXT_ACTION,
      minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: R1163_ASSERTION_RUNNER_NEXT_ACTION,
      optionalAddOnFamilyIds: R1158_OPTIONAL_ADD_ON_FAMILY_IDS,
      productDisplayAuthorized: false,
      requiredChecklistIds: R1158_REQUIRED_CHECKLIST_IDS,
      requiredInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1163: false,
      rowOwnerAssertionInferredByR1163: false,
      rowOwnerAssertionStillRequired: true,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1163: false,
      safeConfirmationArtifactWritten: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };
}

function r1164Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      ...safeBoundary("R1163"),
      childOutputPathsStored: false,
      featureValuesStored: false,
      fileNamesStored: false,
      headerValuesStored: false,
      modelEvidencePromotedByR1164: false,
      privateConfigValuesStored: false,
      privateDetailsStored: false,
      privateFieldRefValuesStored: false,
      privateFieldRefsStored: false,
      privateTableRefValuesStored: false,
      privateTableRefsStored: false,
      r1163InputPathStored: false,
      rowLevelDataAcceptedByR1164: false,
      rowParsingPerformedByR1164: false,
      sourceFileNamesStored: false,
      sourceVariableNamesStored: false,
    },
    featureOnlyResearchHandoff: {
      commands: {
        featureOnlyResearchHandoffCommand: R1164_FEATURE_ONLY_RESEARCH_HANDOFF_COMMAND,
      },
      modelEvidencePromotionAllowed: false,
      outcomeLinkedModelEvidenceStillRequired: true,
      privateDetailsStored: false,
      rowLevelDataAcceptedByR1164: false,
      rowOwnerPrivateValuesStored: false,
    },
    packetId: "r1164-ordinary-consumer-feature-only-research-handoff",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1164-ordinary-consumer-feature-only-research-handoff.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "ordinary_feature_only_research_handoff_waiting_on_row_owner_assertion",
      featureOnlyResearchPlanningReady: false,
      minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: R1164_FEATURE_ONLY_HANDOFF_NEXT_ACTION,
      outcomeLinkedModelEvidenceStillRequired: true,
      prioritizedInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
      productDisplayAuthorized: false,
      researchPlanningAllowed: false,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1164: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1164: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };
}

function r1165Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      ...safeBoundary("R1163"),
      assertionFilePathStored: false,
      assertionValuesStoredByR1165: false,
      childOutputPathsStored: false,
      fileNamesStored: false,
      headerValuesStored: false,
      modelEvidencePromotedByR1165: false,
      privateConfigValuesStored: false,
      privateDetailsStored: false,
      privateFieldRefValuesStored: false,
      privateFieldRefsStored: false,
      privateTableRefValuesStored: false,
      privateTableRefsStored: false,
      rowLevelDataAcceptedByR1165: false,
      rowOwnerAssertionInferredByR1165: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1165: false,
      safeAssertionTemplateWritten: true,
      sourceFileNamesStored: false,
      sourceVariableNamesStored: false,
    },
    assertionRunner: {
      commands: {
        safeAssertionRunnerCommand: R1165_SAFE_ASSERTION_RUNNER_COMMAND,
      },
      modelEvidencePromotionAllowed: false,
      privateDetailsStored: false,
      rowLevelDataAcceptedByR1165: false,
      rowOwnerAssertionInferredByR1165: false,
      rowOwnerPrivateValuesStored: false,
    },
    packetId: "r1165-ordinary-consumer-feature-only-safe-assertion-runner",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1165-ordinary-consumer-feature-only-safe-assertion-runner.v1",
    status: "research-local-aggregate-only",
    summary: {
      assertionAccepted: false,
      assertionProvided: false,
      assertionTemplateArtifact: "r1165-row-owner-feature-only-safe-assertion.template.json",
      childR1163Ran: false,
      conclusion: "ordinary_feature_only_safe_assertion_runner_waiting_on_assertion_file",
      featureOnlyResearchPlanningReady: false,
      minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: R1165_SAFE_ASSERTION_RUNNER_NEXT_ACTION,
      outcomeLinkedModelEvidenceStillRequired: true,
      productDisplayAuthorized: false,
      requiredAssertionChecklistIds: [
        "assert_target_age_band_roughly_16_50",
        "assert_glycemia_bloodwork_export_available",
        "assert_daily_wearable_activity_export_available",
        "assert_no_private_values_identifiers_paths_headers_or_rows",
      ],
      optionalAddOnFamilyIds: R1158_OPTIONAL_ADD_ON_FAMILY_IDS,
      requiredInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1165: false,
      rowOwnerAssertionInferredByR1165: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1165: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
      validationReasonIds: ["assertion_file_missing"],
    },
  };
}

function r1167Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      assertionValuesStoredByR1167: false,
      fileNamesStored: false,
      headerValuesStored: false,
      localPathsStored: false,
      modelEvidencePromotedByR1167: false,
      privateDetailsStored: false,
      rowLevelDataAcceptedByR1167: false,
      rowOwnerAssertionInferredByR1167: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1167: false,
    },
    fillGuide: {
      commands: {
        fillGuideCommand: R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND,
        safeAssertionRunnerCommand: R1165_SAFE_ASSERTION_RUNNER_COMMAND,
      },
    },
    packetId: "r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide",
    productDisplayAuthorized: false,
    schemaVersion: R1167_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_FILL_GUIDE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "ordinary_feature_only_safe_assertion_fill_guide_ready",
      guideReadyForRowOwnerFill: true,
      minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: R1165_SAFE_ASSERTION_RUNNER_NEXT_ACTION,
      optionalAddOnFamilyIds: R1158_OPTIONAL_ADD_ON_FAMILY_IDS,
      productDisplayAuthorized: false,
      requiredInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1167: false,
      rowOwnerAssertionInferredByR1167: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1167: false,
      safeFieldEditCount: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS.length,
      safeFieldEditPaths: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };
}

function r1170Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      assertionFilePathStored: false,
      assertionValuesStoredByR1170: false,
      childOutputPathsStored: false,
      fileNamesStored: false,
      headerValuesStored: false,
      localPathsStored: false,
      modelEvidencePromotedByR1170: false,
      privateDetailsStored: false,
      rowLevelDataAcceptedByR1170: false,
      rowOwnerAssertionInferredByR1170: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1170: false,
      scratchArtifactsPersisted: false,
      syntheticAssertionPersistedInArtifact: false,
    },
    packetId: "r1170-ordinary-consumer-safe-assertion-smoke-proof",
    productDisplayAuthorized: false,
    safeAssertionSmokeProof: {
      commands: {
        smokeProofCommand: R1170_SAFE_ASSERTION_SMOKE_PROOF_COMMAND,
      },
    },
    schemaVersion: R1170_ORDINARY_CONSUMER_SAFE_ASSERTION_SMOKE_PROOF_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "ordinary_safe_assertion_smoke_passed_non_evidence",
      liveChainGateStillRequired: true,
      minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: "keep_live_chain_waiting_on_real_r1165_row_owner_safe_assertion",
      productDisplayAuthorized: false,
      realEvidenceProduced: false,
      requiredInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1170: false,
      rowOwnerAssertionStillRequiredForLiveChain: true,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1170: false,
      r1163FeatureOnlyResearchPlanningReady: true,
      r1165AssertionAccepted: true,
      r1165ChildR1163Ran: true,
      r1165FeatureOnlyResearchPlanningReady: true,
      safeFieldEditCount: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS.length,
      safeFieldEditPaths: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS,
      smokeEvidence: false,
      smokeProofPassed: true,
      syntheticSmokeProof: true,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };
}

function r1172Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      assertionArtifactLocalPathStored: false,
      assertionFileWrittenOnlyAfterExplicitAssertion: true,
      assertionValuesStoredInR1172Packet: false,
      childOutputPathsStored: false,
      fileNamesStored: false,
      headerValuesStored: false,
      localPathsStored: false,
      modelEvidencePromotedByR1172: false,
      privateDetailsStored: false,
      rowLevelDataAcceptedByR1172: false,
      rowOwnerAssertionInferredByR1172: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1172: false,
    },
    materializer: {
      allowedValueKindIds: SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
      blockedContentIds: SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS,
      materializerCommand: R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND,
      modelEvidencePromotionAllowed: false,
      privateDetailsStored: false,
      r1165RunnerCommand: R1165_SAFE_ASSERTION_RUNNER_COMMAND,
      r1167FillGuideCommand: R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND,
      rowLevelDataAcceptedByR1172: false,
      rowOwnerPrivateValuesStored: false,
    },
    packetId: "r1172-ordinary-consumer-safe-assertion-materializer",
    productDisplayAuthorized: false,
    schemaVersion: R1172_ORDINARY_CONSUMER_SAFE_ASSERTION_MATERIALIZER_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      allowedValueKindIds: SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
      blockedContentIds: SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS,
      conclusion: "ordinary_consumer_safe_assertion_materializer_waiting_on_explicit_row_owner_assertion",
      explicitRowOwnerAssertionProvided: false,
      materializedAssertionArtifact: null,
      materializedAssertionWouldBeAcceptedByR1165: false,
      minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: R1172_SAFE_ASSERTION_MATERIALIZER_NEXT_ACTION,
      productDisplayAuthorized: false,
      requiredInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1172: false,
      rowOwnerAssertionInferredByR1172: false,
      rowOwnerAssertionStillRequired: true,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1172: false,
      r1165RunnerReadyForAssertion: true,
      r1165TemplateReady: true,
      r1167FillGuideReady: true,
      safeAssertionArtifactLocalPathStored: false,
      safeAssertionArtifactWritten: false,
      safeFieldEditCount: 0,
      safeFieldEditPaths: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };
}

function r1173Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      answerSheetTemplatePathStored: false,
      assertionValuesStoredByR1173: false,
      codebookTextStored: false,
      coefficientsStored: false,
      fileNamesStored: false,
      headerValuesStored: false,
      localPathsStored: false,
      modelEvidencePromotedByR1173: false,
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
      rowLevelDataAcceptedByR1173: false,
      rowOwnerAssertionInferredByR1173: false,
      rowOwnerPrivateValuesStored: false,
      rowOwnerProvidedValuesStored: false,
      rowParsingPerformedByR1173: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceFileNamesStored: false,
      sourceVariableNamesStored: false,
      splitMembershipStored: false,
    },
    packetId: "r1173-ordinary-consumer-safe-assertion-answer-sheet",
    productDisplayAuthorized: false,
    rowOwnerAnswerSheet: {
      allowedValueKindIds: SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
      blockedAssertionContent: SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS,
      commands: {
        safeAssertionAnswerSheetCommand: R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND,
        safeAssertionFillGuideCommand: R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND,
        safeAssertionMaterializerCommand: R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND,
      },
      materializerExplicitConfirmationRequired: true,
      modelEvidencePromotionAllowed: false,
      privateDetailsStored: false,
      readyForR1172MaterializerConfirmation: true,
      rowLevelDataAcceptedByR1173: false,
      rowOwnerProvidedValuesStored: false,
    },
    schemaVersion: R1173_ORDINARY_CONSUMER_SAFE_ASSERTION_ANSWER_SHEET_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      allowedValueKindIds: SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
      answerSheetReadyForRowOwner: true,
      blockedAssertionContentIds: SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS,
      conclusion: "ordinary_safe_assertion_answer_sheet_ready_non_evidence",
      exactSafeAnswerCount: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS.length,
      fillGuideReadyForRowOwnerFill: true,
      materializerExplicitConfirmationRequired: true,
      materializerReady: true,
      minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: R1172_SAFE_ASSERTION_MATERIALIZER_NEXT_ACTION,
      productDisplayAuthorized: false,
      requiredAssertionChecklistIds: R1165_REQUIRED_ASSERTION_CHECKLIST_IDS,
      requiredInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1173: false,
      rowOwnerAssertionInferredByR1173: false,
      rowOwnerPrivateValuesStored: false,
      rowOwnerProvidedValuesStored: false,
      rowParsingPerformedByR1173: false,
      safeFieldEditCount: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS.length,
      safeFieldEditPaths: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };
}

function r1175Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      assertionFilePathStored: false,
      assertionValuesStoredByR1175: false,
      childOutputPathsStored: false,
      fileNamesStored: false,
      headerValuesStored: false,
      localPathsStored: false,
      materializedAssertionPathStored: false,
      modelEvidencePromotedByR1175: false,
      privateDetailsStored: false,
      rowLevelDataAcceptedByR1175: false,
      rowOwnerAssertionInferredByR1175: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1175: false,
      scratchArtifactsPersisted: false,
      syntheticConfirmationValuesPersistedInArtifact: false,
    },
    bridgeSmoke: {
      allowedValueKindIds: SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
      blockedContentIds: SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS,
      bridgeSmokeCommand: R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_COMMAND,
      optionalAddOnFamilyIds: R1158_OPTIONAL_ADD_ON_FAMILY_IDS,
      r1165RunnerCommand: R1165_SAFE_ASSERTION_RUNNER_COMMAND,
      r1172MaterializerCommand: R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND,
      realEvidenceProduced: false,
      rowLevelDataAcceptedByR1175: false,
      rowOwnerPrivateValuesStored: false,
      syntheticSmokeProof: true,
    },
    packetId: "r1175-r1172-to-r1165-safe-assertion-bridge-smoke",
    productDisplayAuthorized: false,
    schemaVersion: R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      allowedValueKindIds: SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
      bridgeSmokePassed: true,
      blockedContentIds: SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS,
      conclusion: "r1172_to_r1165_safe_assertion_bridge_smoke_passed_non_evidence",
      liveChainGateStillRequired: true,
      materializedAssertionPathStored: false,
      minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: "keep_live_chain_waiting_on_explicit_row_owner_r1172_confirmation",
      optionalAddOnFamilyIds: R1158_OPTIONAL_ADD_ON_FAMILY_IDS,
      productDisplayAuthorized: false,
      realEvidenceProduced: false,
      requiredInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1175: false,
      rowOwnerAssertionStillRequiredForLiveChain: true,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1175: false,
      r1163FeatureOnlyResearchPlanningReady: true,
      r1165AssertionAccepted: true,
      r1165ChildR1163Ran: true,
      r1165FeatureOnlyResearchPlanningReady: true,
      r1172MaterializedAssertionWritten: true,
      r1172WouldBeAcceptedByR1165: true,
      safeFieldEditCount: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS.length,
      safeFieldEditPaths: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS,
      smokeEvidence: false,
      syntheticSmokeProof: true,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };
}

function r1174Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      fileNamesStored: false,
      headerValuesStored: false,
      localPathsStored: false,
      modelEvidencePromotedByR1174: false,
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
      rowLevelDataAcceptedByR1174: false,
      rowOwnerConfirmationInferredByR1174: false,
      rowOwnerPrivateValuesStored: false,
      rowOwnerProvidedValuesStored: false,
      rowParsingPerformedByR1174: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceFileNamesStored: false,
      sourceVariableNamesStored: false,
      splitMembershipStored: false,
    },
    packetId: "r1174-ordinary-consumer-safe-next-step-packet",
    productDisplayAuthorized: false,
    rowOwnerNextStepPacket: {
      allowedValueKindIds: SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
      audience: "ordinary_submitter_roughly_16_50_row_owner",
      blockedContent: SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS,
      currentMissingRequirementIds: [
        "row_owner_availability_assertions_confirmed",
        "confirmed_recipe_route_requirements_available",
        "private_route_config_supplied",
        "real_lab_wearable_route_metrics_recorded",
      ],
      exactSafeFieldEditPaths: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS,
      materializedSafeAssertionArtifact: null,
      minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      optionalAddOnFamilyIds: [
        "common_bloodwork_core",
        "vitals_body_context",
      ],
      packetRole: "current_blocker_packet_only_not_assertion_not_model_evidence",
      readyForR1165Runner: false,
      readyForRowOwnerR1172Confirmation: true,
      readyForRowOwnerR1176LiveChainConfirmation: true,
      requiredAssertionChecklistIds: R1165_REQUIRED_ASSERTION_CHECKLIST_IDS,
      requiredAttestationKeys: REQUIRED_ATTESTATION_KEYS,
      r1176LiveChainCommand: R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
      rowLevelDataAcceptedByR1174: false,
      rowOwnerOnlyActions: [
        {
          actionId: "explicitly_run_r1176_live_chain_if_all_safe_assertions_are_true",
          command: R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
          rowOwnerOnly: true,
          storesPrivateDetailsInPacket: false,
        },
      ],
      rowOwnerProvidedValuesStored: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
    schemaVersion: R1174_ORDINARY_CONSUMER_SAFE_NEXT_STEP_PACKET_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      answerSheetReadyForRowOwner: true,
      allowedValueKindIds: SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
      blockedContentIds: SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS,
      conclusion: "ordinary_safe_next_step_packet_ready_for_row_owner_r1176_live_chain_confirmation",
      exactSafeFieldEditCount: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS.length,
      explicitRowOwnerAssertionProvided: false,
      materializedSafeAssertionArtifact: null,
      materializedSafeAssertionArtifactStoredAsPath: false,
      materializerReady: true,
      minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: R1176_SAFE_ASSERTION_LIVE_CHAIN_NEXT_ACTION,
      optionalAddOnFamilyIds: [
        "common_bloodwork_core",
        "vitals_body_context",
      ],
      productDisplayAuthorized: false,
      r1176LiveChainCommand: R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
      readyForR1165Runner: false,
      readyForRowOwnerR1172Confirmation: true,
      readyForRowOwnerR1176LiveChainConfirmation: true,
      requiredAssertionChecklistIds: R1165_REQUIRED_ASSERTION_CHECKLIST_IDS,
      requiredInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1174: false,
      rowOwnerConfirmationInferredByR1174: false,
      rowOwnerPrivateValuesStored: false,
      rowOwnerProvidedValuesStored: false,
      rowParsingPerformedByR1174: false,
      safeFieldEditPaths: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };
}

function r1176Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      assertionFilePathStored: false,
      assertionValuesStoredByR1176: false,
      childOutputPathsStored: false,
      codebookTextStored: false,
      coefficientsStored: false,
      fileNamesStored: false,
      headerValuesStored: false,
      localPathsStored: false,
      materializedAssertionPathStored: false,
      modelEvidencePromotedByR1176: false,
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
      rowLevelDataAcceptedByR1176: false,
      rowOwnerAssertionInferredByR1176: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1176: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceFileNamesStored: false,
      sourceVariableNamesStored: false,
      splitMembershipStored: false,
    },
    chainRun: {
      chainRunnerCommand: R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
      explicitRowOwnerAssertionProvided: false,
      featureOnlyResearchPlanningReady: false,
      materializedAssertionArtifact: null,
      materializedAssertionPathStored: false,
      minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      allowedValueKindIds: SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
      blockedContentIds: SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS,
      optionalAddOnFamilyIds: R1158_OPTIONAL_ADD_ON_FAMILY_IDS,
      ordinarySubmitterCompletionModeId: FEATURE_ONLY_SAFE_COMPLETION_MODE_ID,
      ordinarySubmitterSafeCompletionChecklistItemIds: R1158_REQUIRED_CHECKLIST_IDS,
      outcomeLinkedModelEvidenceStillRequired: true,
      productDisplayAuthorized: false,
      realEvidenceProduced: false,
      requiredInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1176: false,
      rowOwnerAssertionStillRequiredForLiveChain: true,
      rowOwnerPrivateValuesStored: false,
      r1163Conclusion: null,
      r1163FeatureOnlyResearchPlanningReady: null,
      r1165AssertionAccepted: null,
      r1165ChildR1163Ran: null,
      r1165Conclusion: null,
      r1165FeatureOnlyResearchPlanningReady: null,
      r1165NextAction: null,
      r1165RunnerCommand: R1165_SAFE_ASSERTION_RUNNER_COMMAND,
      r1172Conclusion: null,
      r1172MaterializerCommand: R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND,
      r1172NextAction: null,
      r1172SafeAssertionArtifactWritten: null,
      r1172WouldBeAcceptedByR1165: null,
      rowOwnerHandoffReasonId: R1176_ROW_OWNER_HANDOFF_REASON_ID,
      safeFieldEditCount: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS.length,
      safeFieldEditPaths: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS,
    },
    packetId: "r1176-r1172-r1165-row-owner-safe-assertion-chain-runner",
    productDisplayAuthorized: false,
    schemaVersion: R1176_R1172_R1165_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      chainReady: false,
      conclusion: "row_owner_safe_assertion_chain_waiting_on_explicit_confirmation",
      explicitRowOwnerAssertionProvided: false,
      featureOnlyResearchPlanningReady: false,
      materializedAssertionArtifact: null,
      materializedAssertionPathStored: false,
      minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: R1176_SAFE_ASSERTION_LIVE_CHAIN_NEXT_ACTION,
      allowedValueKindIds: SAFE_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
      blockedContentIds: SAFE_UNBLOCKER_BLOCKED_CONTENT_IDS,
      optionalAddOnFamilyIds: R1158_OPTIONAL_ADD_ON_FAMILY_IDS,
      ordinarySubmitterCompletionModeId: FEATURE_ONLY_SAFE_COMPLETION_MODE_ID,
      ordinarySubmitterSafeCompletionChecklistItemIds: R1158_REQUIRED_CHECKLIST_IDS,
      outcomeLinkedModelEvidenceStillRequired: true,
      productDisplayAuthorized: false,
      realEvidenceProduced: false,
      requiredInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1176: false,
      rowOwnerAssertionStillRequiredForLiveChain: true,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1176: false,
      r1163FeatureOnlyResearchPlanningReady: null,
      r1165AssertionAccepted: null,
      r1165ChildR1163Ran: null,
      r1165FeatureOnlyResearchPlanningReady: null,
      r1172MaterializedAssertionWritten: null,
      r1172WouldBeAcceptedByR1165: null,
      rowOwnerHandoffReasonId: R1176_ROW_OWNER_HANDOFF_REASON_ID,
      safeFieldEditCount: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS.length,
      safeFieldEditPaths: R1167_SAFE_ASSERTION_FIELD_EDIT_PATHS,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };
}

function r1185Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      confirmedResponseLocalPathStored: false,
      fileNamesStored: false,
      fillableResponseLocalPathStored: false,
      headerValuesStored: false,
      liveArtifactsMutatedByR1185: false,
      localPathsStored: false,
      modelEvidencePromotedByR1185: false,
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
      rowLevelDataAcceptedByR1185: false,
      rowOwnerConfirmationInferredByR1185: false,
      rowOwnerPrivateValuesStored: false,
      rowOwnerSafeResponseValuesStoredInR1185Packet: false,
      rowParsingPerformedByR1185: false,
      rowValuesStored: false,
      safeBooleanValuesStoredInR1185Packet: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceFileNamesStored: false,
      sourceVariableNamesStored: false,
      splitMembershipStored: false,
      syntheticFixtureRowsStored: false,
    },
    liveR1184State: {
      artifactBoundaryAggregateOnly: true,
      artifactBoundaryUnsafeTrueFlagFound: false,
      confirmedResponseArtifactReadyForR1180: false,
      conclusion: "average_submitter_safe_response_chain_waiting_on_row_owner_confirmation",
      fillableResponseArtifactPresent: true,
      inputArtifactAvailable: true,
      modelEvidencePromotionAllowed: false,
      nextAction: "rerun_r1183_with_row_owner_safe_response_assertion",
      nextActionCommand: R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND,
      nextActionRequiresExplicitRowOwnerAssertion: true,
      packetId: "r1184-average-submitter-safe-response-chain-status",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1184: false,
      rowOwnerConfirmationInferredByR1184: false,
      rowOwnerPrivateValuesStored: false,
      rowOwnerSafeResponseValuesStoredInR1184Packet: false,
      rowParsingPerformedByR1184: false,
      schemaCurrent: true,
      sourcePriorityMatches: true,
      status: "research-local-aggregate-only",
      targetAgeBandMatches: true,
    },
    packetId: "r1185-average-submitter-safe-response-smoke-proof",
    productDisplayAuthorized: false,
    schemaVersion: R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_SCHEMA_VERSION,
    smokeProof: {
      evidenceClass: "synthetic_non_evidence_smoke_proof",
      liveArtifactsMutatedByR1185: false,
      liveRowOwnerConfirmationProvided: false,
      minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextRealAction: R1185_SAFE_RESPONSE_NEXT_REAL_ACTION,
      nextRealActionCommand: R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND,
      nextRealActionRequiresExplicitRowOwnerAssertion: true,
      prioritizedInputKindIds: R1158_REQUIRED_INPUT_KIND_IDS,
      productDisplayAuthorized: false,
      requiredResponseFieldIds: [
        "confirm_target_age_band_roughly_16_50",
        "confirm_glycemia_bloodwork_export_available",
        "confirm_daily_wearable_activity_export_available",
        "confirm_no_private_values_in_confirmation",
      ],
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1185: false,
      rowOwnerConfirmationInferredByR1185: false,
      rowOwnerPrivateValuesStored: false,
      rowOwnerSafeResponseValuesStoredInR1185Packet: false,
      rowParsingPerformedByR1185: false,
      safeExecutionFeatureSlotIds: [
        "glycemia_lab_presence",
        "glycemia_measurement_date_presence",
        "daily_activity_presence",
        "daily_wear_coverage_presence",
      ],
      sourcePriority: TARGET_INPUT_PRIORITY,
      stageConclusions: [
        {
          artifact: "r1183-average-submitter-safe-response-materializer.latest.json",
          conclusion: "average_submitter_safe_response_materializer_confirmed_response_written",
          readyForNextStage: true,
          stageId: "r1183_materializer",
          syntheticNonEvidence: true,
        },
        {
          artifact: "r1180-average-submitter-safe-confirmation-response-intake.latest.json",
          conclusion: "safe_confirmation_response_intake_ready_feature_only",
          readyForNextStage: true,
          stageId: "r1180_response_intake",
          syntheticNonEvidence: true,
        },
        {
          artifact: "r1181-average-submitter-feature-only-execution-contract.latest.json",
          conclusion: "average_submitter_feature_only_execution_contract_ready_research_only",
          readyForNextStage: true,
          stageId: "r1181_feature_contract",
          syntheticNonEvidence: true,
        },
        {
          artifact: "r1182-average-submitter-safe-response-handoff.latest.json",
          conclusion: "average_submitter_safe_response_handoff_ready_for_research_planning_only",
          readyForNextStage: true,
          stageId: "r1182_safe_response_handoff",
          syntheticNonEvidence: true,
        },
        {
          artifact: "r1184-average-submitter-safe-response-chain-status.latest.json",
          conclusion: "average_submitter_safe_response_chain_ready_for_feature_only_research_planning",
          readyForNextStage: true,
          stageId: "r1184_chain_status",
          syntheticNonEvidence: true,
        },
      ],
      syntheticPathAdvancedToFeatureOnlyResearchPlanning: true,
      syntheticSafeConfirmationUsed: true,
      syntheticSmokeRan: true,
      targetAgeBand: "roughly_16_50",
    },
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "average_submitter_safe_response_smoke_passed_non_evidence",
      liveR1184Conclusion: "average_submitter_safe_response_chain_waiting_on_row_owner_confirmation",
      liveR1184ReadyForSyntheticSmoke: true,
      nextRealAction: R1185_SAFE_RESPONSE_NEXT_REAL_ACTION,
      nextRealActionCommand: R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND,
      nextRealActionRequiresExplicitRowOwnerAssertion: true,
      productDisplayAuthorized: false,
      syntheticPathAdvancedToFeatureOnlyResearchPlanning: true,
      syntheticSmokeRan: true,
    },
  };
}

function ordinarySubmitterSafeCompletionChecklistFixture(): Array<Record<string, unknown>> {
  return ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS.map((checkId) => ({
    checkId,
    mapsToSourceFamilyIds: checkId === "confirm_glycemia_bloodwork_export_available"
      ? ["bloodwork_glycemia"]
      : checkId === "confirm_daily_wearable_activity_export_available"
        ? ["wearable_activity_daily"]
        : checkId === "confirm_outcome_linkage_and_time_alignment_if_model_evidence"
          ? ["outcome_linkage", "join_time_alignment"]
          : [],
    privateDetailsStored: false,
    requiredForFeatureOnlyPreferredPair: [
      "confirm_target_age_band_without_identifiers",
      "confirm_glycemia_bloodwork_export_available",
      "confirm_daily_wearable_activity_export_available",
      "confirm_no_private_values_in_confirmation",
    ].includes(checkId),
    requiredForOutcomeLinkedRecipe: true,
    safeCompletionMeaning: `Safe checklist item ${checkId}`,
  }));
}

function ordinarySubmitterCompletionModesFixture(): Array<Record<string, unknown>> {
  return [
    {
      modeId: "feature_only_lab_wearable_coverage",
      modeType: "feature_only_coverage",
      modelEvidenceCandidate: false,
      nextActionAfterR1150: "run_r1153_feature_only_chain",
      outcomeLinkageRequired: false,
      privateDetailsStored: false,
      requiredAggregateReadinessFactIds: ["targetAgeBand"],
      requiredAttestationKeys: ["aggregateOnly", "localOnly"],
      requiredChecklistIds: [
        "confirm_target_age_band_without_identifiers",
        "confirm_glycemia_bloodwork_export_available",
        "confirm_daily_wearable_activity_export_available",
        "confirm_no_private_values_in_confirmation",
      ],
      requiredSourceFamilyIds: FEATURE_ONLY_PAIR_FAMILY_IDS,
      rowLevelDataAccepted: false,
      safeCompletionMeaning: "Safe feature-only completion mode.",
    },
    {
      modeId: "outcome_linked_lab_wearable_model_evidence",
      modeType: "outcome_linked_model_evidence",
      modelEvidenceCandidate: true,
      nextActionAfterR1150: "run_r1144_recipe_readiness_chain",
      outcomeLinkageRequired: true,
      privateDetailsStored: false,
      requiredAggregateReadinessFactIds: [
        "outcomeLinked",
        "sameDenominator",
        "targetAgeBand",
        "usableRecordCountBand",
        "eventCountBand",
      ],
      requiredAttestationKeys: ["aggregateOnly", "localOnly"],
      requiredChecklistIds: ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS,
      requiredSourceFamilyIds: [
        "outcome_linkage",
        "join_time_alignment",
        "bloodwork_glycemia",
        "wearable_activity_daily",
      ],
      rowLevelDataAccepted: false,
      safeCompletionMeaning: "Safe outcome-linked completion mode.",
    },
  ];
}

function safeBoundary(source: string): Record<string, boolean> {
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
    [`rowParsingPerformedBy${source}`]: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

function statusByRequirement(checklist: Array<{ requirementId: string; status: string }>): Record<string, string> {
  return Object.fromEntries(checklist.map((item) => [item.requirementId, item.status]));
}
