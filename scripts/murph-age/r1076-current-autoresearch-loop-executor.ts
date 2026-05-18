import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { runR1074TrueWearablePostDownloadRefresh } from "./r1074-true-wearable-post-download-refresh.ts";
import { runR1075CurrentAutoresearchActionRouter } from "./r1075-current-autoresearch-action-router.ts";
import { runR1077NsrrSourceRouteAlignment } from "./r1077-nsrr-source-route-alignment.ts";
import {
  R1078_DEFAULT_ANALYTIC_CACHE_PATH,
  runR1078NsrrSleepAutonomicLocalLoop,
} from "./r1078-nsrr-sleep-autonomic-local-loop.ts";
import {
  R1079_DEFAULT_PRIVATE_MANIFEST_PATH,
  runR1079NsrrSleepAutonomicStandardizer,
} from "./r1079-nsrr-sleep-autonomic-standardizer.ts";
import { runR1081NsrrSourceTableCandidateScanner } from "./r1081-nsrr-source-table-candidate-scanner.ts";
import { runR1083FunctionMissingnessCalibrationAdjudication } from "./r1083-function-missingness-calibration-adjudication.ts";
import { runR1084HaalsiFunctionMissingnessCalibrationAdjudication } from "./r1084-haalsi-function-missingness-calibration-adjudication.ts";
import { R1156_SAFE_CONFIRMATION_HANDOFF_COMMAND } from "./r1156-ordinary-consumer-safe-confirmation-handoff.ts";
import { R1157_SAFE_CONFIRMATION_CHAIN_RUNNER_COMMAND } from "./r1157-ordinary-consumer-safe-confirmation-chain-runner.ts";
import { R1158_SAFE_CONFIRMATION_FILL_GUIDE_COMMAND } from "./r1158-ordinary-consumer-safe-confirmation-fill-guide.ts";
import { R1159_SAFE_CONFIRMATION_ANSWER_SHEET_COMMAND } from "./r1159-ordinary-consumer-safe-confirmation-answer-sheet.ts";
import { R1160_TRANSCRIPTION_PROOF_COMMAND } from "./r1160-r1159-feature-only-safe-confirmation-transcription-proof.ts";
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
export const R1076_CURRENT_AUTORESEARCH_LOOP_EXECUTOR_SCHEMA_VERSION =
  "murph-age-r1076-current-autoresearch-loop-executor.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1076-current-autoresearch-loop-executor.latest.json";
const R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1183-average-submitter-safe-response-materializer.ts" as const;
const R1184_AVERAGE_SUBMITTER_SAFE_RESPONSE_CHAIN_STATUS_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1184-average-submitter-safe-response-chain-status.ts" as const;
const R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_SCHEMA_VERSION =
  "murph-age-r1185-average-submitter-safe-response-smoke-proof.v1" as const;
const R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1185-average-submitter-safe-response-smoke-proof.ts" as const;
const TARGET_AGE_BAND = "roughly_16_50" as const;
const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first" as const;
const FEATURE_ONLY_SOURCE_FAMILY_IDS = ["bloodwork_glycemia", "wearable_activity_daily"] as const;
const FEATURE_ONLY_OPTIONAL_ADD_ON_FAMILY_IDS = ["common_bloodwork_core", "vitals_body_context"] as const;
const FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS = [
  "sourceFamilies[bloodwork_glycemia].available",
  "sourceFamilies[wearable_activity_daily].available",
  "sourceFamilies[common_bloodwork_core].available",
  "sourceFamilies[vitals_body_context].available",
  "rowOwnerAssertionsConfirmed",
  "privateContentExcluded",
  "attestations.aggregateOnly",
  "attestations.localOnly",
  "attestations.noCoefficientEgress",
  "attestations.noHeaderNameEgress",
  "attestations.noParticipantEgress",
  "attestations.noPredictionEgress",
  "attestations.noPrivatePathEgress",
  "attestations.noPrivateRefValueEgress",
  "attestations.noRowEgress",
  "attestations.noSmallCellEgress",
  "attestations.noSourceTextEgress",
] as const;
const FEATURE_ONLY_SAFE_COMPLETION_CHECKLIST_ITEM_IDS = [
  "confirm_target_age_band_without_identifiers",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
] as const;
const AVERAGE_SUBMITTER_SAFE_RESPONSE_FIELD_IDS = [
  "confirm_target_age_band_roughly_16_50",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
] as const;
const AVERAGE_SUBMITTER_SAFE_EXECUTION_FEATURE_SLOT_IDS = [
  "glycemia_lab_presence",
  "glycemia_measurement_date_presence",
  "daily_activity_presence",
  "daily_wear_coverage_presence",
] as const;
const FEATURE_ONLY_SAFE_ASSERTION_ALLOWED_VALUE_KIND_IDS = [
  "booleans_only",
  "fixed_enumerated_ids_only",
] as const;
const FEATURE_ONLY_SAFE_ASSERTION_BLOCKED_CONTENT_IDS = [
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
const FEATURE_ONLY_SAFE_COMPLETION_MODE_ID = "feature_only_lab_wearable_coverage" as const;
const R1176_ROW_OWNER_HANDOFF_REASON_ID =
  "confirm_feature_only_lab_wearable_availability_before_r1176_live_chain" as const;
const FEATURE_ONLY_SAFE_AVAILABILITY_NEXT_ACTION =
  "run_r1153_feature_only_chain_with_safe_availability" as const;
const R1128_EXPECTED = {
  artifact: "r1128-ordinary-consumer-pipeline-smoke-proof.latest.json",
  packetId: "r1128-ordinary-consumer-pipeline-smoke-proof",
  schemaVersion: "murph-age-r1128-ordinary-consumer-pipeline-smoke-proof.v1",
} as const;
const R1129_EXPECTED = {
  artifact: "r1129-consumer-real-evidence-gate.latest.json",
  packetId: "r1129-consumer-real-evidence-gate",
  schemaVersion: "murph-age-r1129-consumer-real-evidence-gate.v1",
} as const;
const R1130_EXPECTED = {
  artifact: "r1130-ordinary-consumer-real-evidence-handoff.latest.json",
  packetId: "r1130-ordinary-consumer-real-evidence-handoff",
  schemaVersion: "murph-age-r1130-ordinary-consumer-real-evidence-handoff.v1",
} as const;
const R1132_EXPECTED = {
  artifact: "r1132-ordinary-consumer-submission-readiness.latest.json",
  packetId: "r1132-ordinary-consumer-submission-readiness",
  schemaVersion: "murph-age-r1132-ordinary-consumer-submission-readiness.v1",
} as const;
const R1133_EXPECTED = {
  artifact: "r1133-ordinary-consumer-data-availability-preflight.latest.json",
  packetId: "r1133-ordinary-consumer-data-availability-preflight",
  schemaVersion: "murph-age-r1133-ordinary-consumer-data-availability-preflight.v1",
} as const;
const R1134_EXPECTED = {
  artifact: "r1134-ordinary-consumer-availability-config-bridge.latest.json",
  packetId: "r1134-ordinary-consumer-availability-config-bridge",
  schemaVersion: "murph-age-r1134-ordinary-consumer-availability-config-bridge.v1",
} as const;
const R1135_EXPECTED = {
  artifact: "r1135-ordinary-consumer-availability-manifest-packet.latest.json",
  packetId: "r1135-ordinary-consumer-availability-manifest-packet",
  schemaVersion: "murph-age-r1135-ordinary-consumer-availability-manifest-packet.v1",
} as const;
const R1136_EXPECTED = {
  artifact: "r1136-ordinary-consumer-availability-chain-runner.latest.json",
  packetId: "r1136-ordinary-consumer-availability-chain-runner",
  schemaVersion: "murph-age-r1136-ordinary-consumer-availability-chain-runner.v1",
} as const;
const R1137_EXPECTED = {
  artifact: "r1137-ordinary-consumer-partial-route-planner.latest.json",
  packetId: "r1137-ordinary-consumer-partial-route-planner",
  schemaVersion: "murph-age-r1137-ordinary-consumer-partial-route-planner.v1",
} as const;
const R1138_EXPECTED = {
  artifact: "r1138-ordinary-consumer-partial-aggregate-metric-intake.latest.json",
  packetId: "r1138-ordinary-consumer-partial-aggregate-metric-intake",
  schemaVersion: "murph-age-r1138-ordinary-consumer-partial-aggregate-metric-intake.v1",
} as const;
const R1139_EXPECTED = {
  artifact: "r1139-ordinary-consumer-partial-private-config-handoff.latest.json",
  packetId: "r1139-ordinary-consumer-partial-private-config-handoff",
  schemaVersion: "murph-age-r1139-ordinary-consumer-partial-private-config-handoff.v1",
} as const;
const R1140_EXPECTED = {
  artifact: "r1140-ordinary-consumer-partial-readiness-chain-runner.latest.json",
  packetId: "r1140-ordinary-consumer-partial-readiness-chain-runner",
  schemaVersion: "murph-age-r1140-ordinary-consumer-partial-readiness-chain-runner.v1",
} as const;
const R1141_EXPECTED = {
  artifact: "r1141-ordinary-consumer-partial-private-metric-runner.latest.json",
  packetId: "r1141-ordinary-consumer-partial-private-metric-runner",
  schemaVersion: "murph-age-r1141-ordinary-consumer-partial-private-metric-runner.v1",
} as const;
const R1142_EXPECTED = {
  artifact: "r1142-ordinary-consumer-partial-private-chain-runner.latest.json",
  packetId: "r1142-ordinary-consumer-partial-private-chain-runner",
  schemaVersion: "murph-age-r1142-ordinary-consumer-partial-private-chain-runner.v1",
} as const;
const R1145_EXPECTED = {
  artifact: "r1145-ordinary-consumer-current-chain-completion-audit.latest.json",
  packetId: "r1145-ordinary-consumer-current-chain-completion-audit",
  schemaVersion: "murph-age-r1145-ordinary-consumer-current-chain-completion-audit.v1",
} as const;
const R1146_EXPECTED = {
  artifact: "r1146-ordinary-consumer-row-owner-route-action-packet.latest.json",
  packetId: "r1146-ordinary-consumer-row-owner-route-action-packet",
  schemaVersion: "murph-age-r1146-ordinary-consumer-row-owner-route-action-packet.v1",
} as const;
const R1147_EXPECTED = {
  artifact: "r1147-ordinary-consumer-post-confirmation-private-config-packet.latest.json",
  packetId: "r1147-ordinary-consumer-post-confirmation-private-config-packet",
  schemaVersion: "murph-age-r1147-ordinary-consumer-post-confirmation-private-config-packet.v1",
} as const;
const R1148_EXPECTED = {
  artifact: "r1148-ordinary-consumer-post-confirmation-private-config-intake.latest.json",
  packetId: "r1148-ordinary-consumer-post-confirmation-private-config-intake",
  schemaVersion: "murph-age-r1148-ordinary-consumer-post-confirmation-private-config-intake.v1",
} as const;
const R1149_EXPECTED = {
  artifact: "r1149-ordinary-consumer-lab-wearable-submission-kit.latest.json",
  packetId: "r1149-ordinary-consumer-lab-wearable-submission-kit",
  schemaVersion: "murph-age-r1149-ordinary-consumer-lab-wearable-submission-kit.v1",
} as const;
const R1150_EXPECTED = {
  artifact: "r1150-ordinary-consumer-safe-availability-confirmation-intake.latest.json",
  packetId: "r1150-ordinary-consumer-safe-availability-confirmation-intake",
  schemaVersion: "murph-age-r1150-ordinary-consumer-safe-availability-confirmation-intake.v1",
} as const;
const R1151_EXPECTED = {
  artifact: "r1151-ordinary-consumer-feature-only-submission-mode.latest.json",
  packetId: "r1151-ordinary-consumer-feature-only-submission-mode",
  schemaVersion: "murph-age-r1151-ordinary-consumer-feature-only-submission-mode.v1",
} as const;
const R1152_EXPECTED = {
  artifact: "r1152-ordinary-consumer-feature-only-coverage-context-intake.latest.json",
  packetId: "r1152-ordinary-consumer-feature-only-coverage-context-intake",
  schemaVersion: "murph-age-r1152-ordinary-consumer-feature-only-coverage-context-intake.v1",
} as const;
const R1153_EXPECTED = {
  artifact: "r1153-ordinary-consumer-feature-only-chain-runner.latest.json",
  packetId: "r1153-ordinary-consumer-feature-only-chain-runner",
  schemaVersion: "murph-age-r1153-ordinary-consumer-feature-only-chain-runner.v1",
} as const;
const R1154_EXPECTED = {
  artifact: "r1154-ordinary-consumer-safe-availability-action-packet.latest.json",
  packetId: "r1154-ordinary-consumer-safe-availability-action-packet",
  schemaVersion: "murph-age-r1154-ordinary-consumer-safe-availability-action-packet.v1",
} as const;
const R1155_EXPECTED = {
  artifact: "r1155-ordinary-consumer-safe-confirmation-feature-only-smoke-proof.latest.json",
  packetId: "r1155-ordinary-consumer-safe-confirmation-feature-only-smoke-proof",
  schemaVersion: "murph-age-r1155-ordinary-consumer-safe-confirmation-feature-only-smoke-proof.v1",
} as const;
const R1156_EXPECTED = {
  artifact: "r1156-ordinary-consumer-safe-confirmation-handoff.latest.json",
  packetId: "r1156-ordinary-consumer-safe-confirmation-handoff",
  schemaVersion: "murph-age-r1156-ordinary-consumer-safe-confirmation-handoff.v1",
} as const;
const R1157_EXPECTED = {
  artifact: "r1157-ordinary-consumer-safe-confirmation-chain-runner.latest.json",
  packetId: "r1157-ordinary-consumer-safe-confirmation-chain-runner",
  schemaVersion: "murph-age-r1157-ordinary-consumer-safe-confirmation-chain-runner.v1",
} as const;
const R1158_EXPECTED = {
  artifact: "r1158-ordinary-consumer-safe-confirmation-fill-guide.latest.json",
  packetId: "r1158-ordinary-consumer-safe-confirmation-fill-guide",
  schemaVersion: "murph-age-r1158-ordinary-consumer-safe-confirmation-fill-guide.v1",
} as const;
const R1159_EXPECTED = {
  artifact: "r1159-ordinary-consumer-safe-confirmation-answer-sheet.latest.json",
  packetId: "r1159-ordinary-consumer-safe-confirmation-answer-sheet",
  schemaVersion: "murph-age-r1159-ordinary-consumer-safe-confirmation-answer-sheet.v1",
} as const;
const R1160_EXPECTED = {
  artifact: "r1160-r1159-feature-only-safe-confirmation-transcription-proof.latest.json",
  packetId: "r1160-r1159-feature-only-safe-confirmation-transcription-proof",
  schemaVersion: "murph-age-r1160-r1159-feature-only-safe-confirmation-transcription-proof.v1",
} as const;
const R1161_EXPECTED = {
  artifact: "r1161-feature-only-safe-availability-confirmation-materializer.latest.json",
  packetId: "r1161-feature-only-safe-availability-confirmation-materializer",
  schemaVersion: "murph-age-r1161-feature-only-safe-availability-confirmation-materializer.v1",
} as const;
const R1162_EXPECTED = {
  artifact: "r1162-feature-only-safe-confirmation-assertion-handoff.latest.json",
  packetId: "r1162-feature-only-safe-confirmation-assertion-handoff",
  schemaVersion: "murph-age-r1162-feature-only-safe-confirmation-assertion-handoff.v1",
} as const;
const R1163_EXPECTED = {
  artifact: "r1163-feature-only-safe-confirmation-to-research-runner.latest.json",
  packetId: "r1163-feature-only-safe-confirmation-to-research-runner",
  schemaVersion: "murph-age-r1163-feature-only-safe-confirmation-to-research-runner.v1",
} as const;
const R1164_EXPECTED = {
  artifact: "r1164-ordinary-consumer-feature-only-research-handoff.latest.json",
  packetId: "r1164-ordinary-consumer-feature-only-research-handoff",
  schemaVersion: "murph-age-r1164-ordinary-consumer-feature-only-research-handoff.v1",
} as const;
const R1165_EXPECTED = {
  artifact: "r1165-ordinary-consumer-feature-only-safe-assertion-runner.latest.json",
  packetId: "r1165-ordinary-consumer-feature-only-safe-assertion-runner",
  schemaVersion: "murph-age-r1165-ordinary-consumer-feature-only-safe-assertion-runner.v1",
} as const;
const R1167_EXPECTED = {
  artifact: "r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide.latest.json",
  packetId: "r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide",
  schemaVersion: R1167_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_FILL_GUIDE_SCHEMA_VERSION,
} as const;
const R1170_EXPECTED = {
  artifact: "r1170-ordinary-consumer-safe-assertion-smoke-proof.latest.json",
  packetId: "r1170-ordinary-consumer-safe-assertion-smoke-proof",
  schemaVersion: R1170_ORDINARY_CONSUMER_SAFE_ASSERTION_SMOKE_PROOF_SCHEMA_VERSION,
} as const;
const R1172_EXPECTED = {
  artifact: "r1172-ordinary-consumer-safe-assertion-materializer.latest.json",
  packetId: "r1172-ordinary-consumer-safe-assertion-materializer",
  schemaVersion: R1172_ORDINARY_CONSUMER_SAFE_ASSERTION_MATERIALIZER_SCHEMA_VERSION,
} as const;
const R1173_EXPECTED = {
  artifact: "r1173-ordinary-consumer-safe-assertion-answer-sheet.latest.json",
  packetId: "r1173-ordinary-consumer-safe-assertion-answer-sheet",
  schemaVersion: R1173_ORDINARY_CONSUMER_SAFE_ASSERTION_ANSWER_SHEET_SCHEMA_VERSION,
} as const;
const R1174_EXPECTED = {
  artifact: "r1174-ordinary-consumer-safe-next-step-packet.latest.json",
  packetId: "r1174-ordinary-consumer-safe-next-step-packet",
  schemaVersion: R1174_ORDINARY_CONSUMER_SAFE_NEXT_STEP_PACKET_SCHEMA_VERSION,
} as const;
const R1175_EXPECTED = {
  artifact: "r1175-r1172-to-r1165-safe-assertion-bridge-smoke.latest.json",
  packetId: "r1175-r1172-to-r1165-safe-assertion-bridge-smoke",
  schemaVersion: R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_SCHEMA_VERSION,
} as const;
const R1176_EXPECTED = {
  artifact: "r1176-r1172-r1165-row-owner-safe-assertion-chain-runner.latest.json",
  packetId: "r1176-r1172-r1165-row-owner-safe-assertion-chain-runner",
  schemaVersion: R1176_R1172_R1165_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_SCHEMA_VERSION,
} as const;
const R1185_EXPECTED = {
  artifact: "r1185-average-submitter-safe-response-smoke-proof.latest.json",
  packetId: "r1185-average-submitter-safe-response-smoke-proof",
  schemaVersion: R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_SCHEMA_VERSION,
} as const;

type ExecutorConclusion =
  | "executor_blocked_on_true_wearable_data"
  | "executor_hold_consumer_no_delta_continue_source_search"
  | "executor_ready_for_consumer_feature_only_chain"
  | "executor_ready_for_consumer_private_config"
  | "executor_ready_for_consumer_first_pass_aggregate_metrics"
  | "executor_ready_for_consumer_recipe_readiness_chain"
  | "executor_ready_for_consumer_route_metrics"
  | "executor_ready_for_function_adjudication"
  | "executor_ready_for_nsrr_aggregate_receipt"
  | "executor_ready_for_reviewgpt_scientific_delta"
  | "executor_refresh_consumer_safe_action_chain"
  | "executor_waiting_on_consumer_safe_availability_confirmation"
  | "executor_repair_direction_inputs";

interface ArtifactSummary {
  packetId: string;
  schemaVersion: string;
  status: string;
  summaryConclusion: string;
}

interface MissingConfigPieces {
  firstPassCandidateIds: string[];
  semanticRefFamilies: string[];
  submissionContextFields: string[];
  tableRefs: string[];
}

interface SourceFamilyMissingSlotRollup {
  familyId: string;
  missingSlotCount: number | null;
  missingSlotIds: string[];
  status: string | null;
}

export interface R1076CurrentAutoresearchLoopExecutorOptions {
  aggregateReceiptPath?: string;
  createdAt?: string;
  outputDir?: string;
  nsrrSleepAutonomicAnalyticCachePath?: string;
  nsrrSourceCandidateDraftPath?: string;
  nsrrSleepAutonomicStandardizerManifestPath?: string;
  r1057Path?: string;
  r1059Path?: string;
  r1061Path?: string;
  r1062Path?: string;
  r1083AggregatePacketPath?: string;
  r1083ReducerPath?: string;
  r1084HaalsiPath?: string;
  r1101Path?: string;
  r1128Path?: string;
  r1129Path?: string;
  r1130Path?: string;
  r1132Path?: string;
  r1133Path?: string;
  r1134Path?: string;
  r1135Path?: string;
  r1136Path?: string;
  r1137Path?: string;
  r1138Path?: string;
  r1139Path?: string;
  r1140Path?: string;
  r1141Path?: string;
  r1142Path?: string;
  r1145Path?: string;
  r1146Path?: string;
  r1147Path?: string;
  r1148Path?: string;
  r1149Path?: string;
  r1150Path?: string;
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
  scanRoots?: string[];
}

export interface R1076CurrentAutoresearchLoopExecutorOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1076: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1076: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  executedSteps: {
    r1074TrueWearablePostDownloadRefresh: ArtifactSummary;
    r1081NsrrSourceTableCandidateScanner: ArtifactSummary | null;
    r1079NsrrSleepAutonomicStandardizer: ArtifactSummary | null;
    r1078NsrrSleepAutonomicLocalLoop: ArtifactSummary | null;
    r1077NsrrSourceRouteAlignment: ArtifactSummary;
    r1083FunctionMissingnessCalibrationAdjudication: ArtifactSummary;
    r1084HaalsiFunctionMissingnessCalibrationAdjudication: ArtifactSummary;
    r1075CurrentAutoresearchActionRouter: ArtifactSummary;
  };
  nextLoop: {
    consumerAverageSubmitterFamilyIds: string[];
    consumerAverageSubmitterAvailabilityConclusion: string | null;
    consumerAverageSubmitterAvailabilityManifestStatus: string | null;
    consumerAverageSubmitterAvailabilityMissingSourceFamilyIds: string[];
    consumerAverageSubmitterAvailabilityNextAction: string | null;
    consumerAverageSubmitterAvailabilityPreflightArtifact: string | null;
    consumerAverageSubmitterAvailabilityReadyForPrivateConfigMapping: boolean | null;
    consumerAverageSubmitterConfigBridgeArtifact: string | null;
    consumerAverageSubmitterConfigBridgeAvailableSourceFamilyIds: string[];
    consumerAverageSubmitterConfigBridgeConclusion: string | null;
    consumerAverageSubmitterConfigBridgeMappingPlanStatus: string | null;
    consumerAverageSubmitterConfigBridgeNextAction: string | null;
    consumerAverageSubmitterConfigBridgeReadyForPrivateConfigMapping: boolean | null;
    consumerAverageSubmitterConfigBridgeSelectedTableLayout: string | null;
    consumerAverageSubmitterManifestPacketArtifact: string | null;
    consumerAverageSubmitterManifestPacketConclusion: string | null;
    consumerAverageSubmitterManifestPacketMatchedRecipeIds: string[];
    consumerAverageSubmitterManifestPacketMaterializerCommand: string | null;
    consumerAverageSubmitterManifestPacketNextAction: string | null;
    consumerAverageSubmitterManifestPacketPrimaryInputFamilyIds: string[];
    consumerAverageSubmitterManifestPacketReadyForPrivateConfigMapping: boolean | null;
    consumerAverageSubmitterManifestPacketRecipeReadinessChainCommand: string | null;
    consumerAverageSubmitterManifestPacketSafeManifestAttestationsComplete: boolean | null;
    consumerAverageSubmitterManifestPacketPartialPrivateChainRunnerCommand: string | null;
    consumerAverageSubmitterManifestPacketPartialRouteRecipeIds: string[];
    consumerAverageSubmitterManifestPacketPreferredRecipeIds: string[];
    consumerAverageSubmitterManifestPacketRequiredLinkageFamilyIds: string[];
    consumerAverageSubmitterAvailabilityChainArtifact: string | null;
    consumerAverageSubmitterAvailabilityChainConclusion: string | null;
    consumerAverageSubmitterAvailabilityChainManifestSupplied: boolean | null;
    consumerAverageSubmitterAvailabilityChainNextAction: string | null;
    consumerAverageSubmitterAvailabilityChainReadyForPrivateConfigMapping: boolean | null;
    consumerAverageSubmitterPartialRoutePlannerArtifact: string | null;
    consumerAverageSubmitterPartialRoutePlannerConclusion: string | null;
    consumerAverageSubmitterPartialRoutePlannerFullRouteReady: boolean | null;
    consumerAverageSubmitterPartialRoutePlannerNextAction: string | null;
    consumerAverageSubmitterPartialRoutePlannerReadyForPrivateConfigMapping: boolean | null;
    consumerAverageSubmitterPartialRoutePlannerReadyUnsupportedRouteIds: string[];
    consumerAverageSubmitterPartialMetricIntakeArtifact: string | null;
    consumerAverageSubmitterPartialMetricIntakeConclusion: string | null;
    consumerAverageSubmitterPartialMetricIntakeNextAction: string | null;
    consumerAverageSubmitterPartialMetricIntakeReadyRouteIds: string[];
    consumerAverageSubmitterPartialMetricIntakeTemplateArtifact: string | null;
    consumerAverageSubmitterPartialPrivateConfigHandoffArtifact: string | null;
    consumerAverageSubmitterPartialPrivateConfigHandoffConclusion: string | null;
    consumerAverageSubmitterPartialPrivateConfigHandoffEligibleRouteIds: string[];
    consumerAverageSubmitterPartialPrivateConfigHandoffFullEvidenceGateCleared: boolean | null;
    consumerAverageSubmitterPartialPrivateConfigHandoffNextAction: string | null;
    consumerAverageSubmitterPartialPrivateConfigHandoffReadyMetricRouteIds: string[];
    consumerAverageSubmitterPartialPrivateConfigHandoffRequiredFieldRefFamilies: string[];
    consumerAverageSubmitterPartialPrivateConfigHandoffRequiredTableRefs: string[];
    consumerAverageSubmitterPartialPrivateConfigHandoffTemplateArtifact: string | null;
    consumerAverageSubmitterPartialReadinessChainArtifact: string | null;
    consumerAverageSubmitterPartialReadinessChainConclusion: string | null;
    consumerAverageSubmitterPartialReadinessChainEligibleRouteIds: string[];
    consumerAverageSubmitterPartialReadinessChainFullEvidenceGateCleared: boolean | null;
    consumerAverageSubmitterPartialReadinessChainManifestSupplied: boolean | null;
    consumerAverageSubmitterPartialReadinessChainNextAction: string | null;
    consumerAverageSubmitterPartialReadinessChainReadyMetricRouteIds: string[];
    consumerAverageSubmitterPartialReadinessChainRequiredFieldRefFamilies: string[];
    consumerAverageSubmitterPartialReadinessChainRequiredTableRefs: string[];
    consumerAverageSubmitterPartialReadinessChainTemplateArtifact: string | null;
    consumerAverageSubmitterPartialPrivateMetricRunnerAggregateMetricsArtifact: string | null;
    consumerAverageSubmitterPartialPrivateMetricRunnerArtifact: string | null;
    consumerAverageSubmitterPartialPrivateMetricRunnerConclusion: string | null;
    consumerAverageSubmitterPartialPrivateMetricRunnerEligibleRouteIds: string[];
    consumerAverageSubmitterPartialPrivateMetricRunnerExecutedRouteIds: string[];
    consumerAverageSubmitterPartialPrivateMetricRunnerNextAction: string | null;
    consumerAverageSubmitterPartialPrivateMetricRunnerRequestedRouteIds: string[];
    consumerAverageSubmitterPartialPrivateMetricRunnerRouteMetricsReadyForR1138: boolean | null;
    consumerAverageSubmitterPartialPrivateChainAggregateMetricsArtifact: string | null;
    consumerAverageSubmitterPartialPrivateChainArtifact: string | null;
    consumerAverageSubmitterPartialPrivateChainConclusion: string | null;
    consumerAverageSubmitterPartialPrivateChainEligibleRouteIds: string[];
    consumerAverageSubmitterPartialPrivateChainExecutedRouteIds: string[];
    consumerAverageSubmitterPartialPrivateChainFinalReadyRouteIds: string[];
    consumerAverageSubmitterPartialPrivateChainFullEvidenceGateCleared: boolean | null;
    consumerAverageSubmitterPartialPrivateChainFullSupportedRouteReady: boolean | null;
    consumerAverageSubmitterPartialPrivateChainNextAction: string | null;
    consumerAverageSubmitterPartialPrivateChainRouteMetricsReadyForR1138: boolean | null;
    consumerAverageSubmitterCompletionAuditArtifact: string | null;
    consumerAverageSubmitterCompletionAuditBlockers: string[];
    consumerAverageSubmitterCompletionAuditConclusion: string | null;
    consumerAverageSubmitterCompletionAuditGoalAchieved: boolean | null;
    consumerAverageSubmitterCompletionAuditMissingRequirementIds: string[];
    consumerAverageSubmitterCompletionAuditNextAction: string | null;
    consumerAverageSubmitterCompletionAuditUnblockerBlockedRequirementIds: string[];
    consumerAverageSubmitterCompletionAuditUnblockerBlockedStepIds: string[];
    consumerAverageSubmitterCompletionAuditUnblockerCommandCount: number | null;
    consumerAverageSubmitterCompletionAuditUnblockerStepIds: string[];
    consumerAverageSubmitterCompletionAuditUnblockerTopAllowedValueKindIds: string[];
    consumerAverageSubmitterCompletionAuditUnblockerTopBlockedContentIds: string[];
    consumerAverageSubmitterCompletionAuditUnblockerTopCommand: string | null;
    consumerAverageSubmitterCompletionAuditUnblockerTopNextAction: string | null;
    consumerAverageSubmitterCompletionAuditUnblockerTopRequirementId: string | null;
    consumerAverageSubmitterCompletionAuditUnblockerTopRequiredInputKindIds: string[];
    consumerAverageSubmitterCompletionAuditUnblockerTopSafeCompletionChecklistItemIds: string[];
    consumerAverageSubmitterCompletionAuditUnblockerTopStepId: string | null;
    consumerAverageSubmitterCompletionAuditProductDisplayAuthorized: boolean | null;
    consumerAverageSubmitterCompletionAuditReadyToMarkComplete: boolean | null;
    consumerAverageSubmitterCompletionAuditTopMissingRequirement: string | null;
    consumerAverageSubmitterRowOwnerActionPacketArtifact: string | null;
    consumerAverageSubmitterRowOwnerActionPacketBlockers: string[];
    consumerAverageSubmitterRowOwnerActionPacketConclusion: string | null;
    consumerAverageSubmitterRowOwnerActionPacketFallbackRecipeIds: string[];
    consumerAverageSubmitterRowOwnerActionPacketNextAction: string | null;
    consumerAverageSubmitterRowOwnerActionPacketRecommendedConfirmedRecipeCommand: string | null;
    consumerAverageSubmitterRowOwnerActionPacketRecommendedConfirmedRecipeCommandAvailable: boolean | null;
    consumerAverageSubmitterRowOwnerActionPacketSelectedRecipeId: string | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketArtifact: string | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketBlockers: string[];
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketConclusion: string | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketExpectedRouteIds: string[];
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketNextAction: string | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketRequiredFieldRefFamilies: string[];
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketRequiredTableRefs: string[];
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigPrivateFieldRefKeys: string[];
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigPrivateTableRefKeys: string[];
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigRouteRunOrder: string[];
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigSchemaVersion: string | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigTopLevelKeys: string[];
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketRowOwnerAssertionsConfirmed: boolean | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketTemplateArtifact: string | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketTemplateReadyForFill: boolean | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeArtifact: string | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeConclusion: string | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeEvidenceRoleStatus: string | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeMissingAttestationKeys: string[];
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeMissingRouteIds: string[];
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeMissingRunnerFieldRefKeys: string[];
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeMissingRunnerTableRefKeys: string[];
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeNextAction: string | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeOrdinaryTableLayout: string | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakePacketReadyForConfigIntake: boolean | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakePrivateConfigStatus: string | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakePrivateConfigSupplied: boolean | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeR1147Conclusion: string | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeR1147NextAction: string | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeReadyForR1142: boolean | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeRequestedRouteIds: string[];
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeActionGuardPresent: boolean | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketConclusion: string | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketFeatureOnlyCoverageContextReady: boolean | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds: string[];
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketMissingRequiredSourceFamilyIds: string[];
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketNextAction: string | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain: boolean | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketRowLevelDataAcceptedByR1154: boolean | null;
    consumerAverageSubmitterLabWearableSubmissionKitArtifact: string | null;
    consumerAverageSubmitterLabWearableSubmissionKitConclusion: string | null;
    consumerAverageSubmitterLabWearableSubmissionKitNextAction: string | null;
    consumerAverageSubmitterLabWearableSubmissionKitOptionalAddOnFamilyIds: string[];
    consumerAverageSubmitterLabWearableSubmissionKitPrivateConfigReadyForR1142: boolean | null;
    consumerAverageSubmitterLabWearableSubmissionKitPrivateConfigStatus: string | null;
    consumerAverageSubmitterLabWearableSubmissionKitReadyForResearchReview: boolean | null;
    consumerAverageSubmitterLabWearableSubmissionKitRequiredSourceFamilyIds: string[];
    consumerAverageSubmitterLabWearableSubmissionKitRowOwnerAssertionsConfirmed: boolean | null;
    consumerAverageSubmitterLabWearableSubmissionKitTopBlocker: string | null;
    consumerAverageSubmitterSafeAvailabilityConfirmationArtifact: string | null;
    consumerAverageSubmitterSafeAvailabilityConfirmationConclusion: string | null;
    consumerAverageSubmitterSafeAvailabilityConfirmationMissingAggregateReadinessFactIds: string[];
    consumerAverageSubmitterSafeAvailabilityConfirmationMissingAttestationKeys: string[];
    consumerAverageSubmitterSafeAvailabilityConfirmationMissingFeatureOnlySourceFamilyIds: string[];
    consumerAverageSubmitterSafeAvailabilityConfirmationMissingSourceFamilyIds: string[];
    consumerAverageSubmitterSafeAvailabilityConfirmationFeatureOnlyCoverageContextReady: boolean | null;
    consumerAverageSubmitterSafeAvailabilityConfirmationFeatureOnlyCoverageRequiresPreferredPair: boolean | null;
    consumerAverageSubmitterSafeAvailabilityConfirmationChecklistItemIds: string[];
    consumerAverageSubmitterSafeAvailabilityConfirmationMinimumFeaturePairRequired: string[];
    consumerAverageSubmitterSafeAvailabilityConfirmationNextAction: string | null;
    consumerAverageSubmitterSafeAvailabilityConfirmationOutcomeLinkageRequiredForFeatureOnlyContext: boolean | null;
    consumerAverageSubmitterSafeAvailabilityConfirmationReadyForRecipeReadinessChain: boolean | null;
    consumerAverageSubmitterSafeAvailabilityConfirmationRowOwnerAssertionsConfirmed: boolean | null;
    consumerAverageSubmitterSafeAvailabilityConfirmationRowLevelDataAcceptedByR1150: boolean | null;
    consumerAverageSubmitterSafeAvailabilityConfirmationStatus: string | null;
    consumerAverageSubmitterSafeAvailabilityConfirmationTemplateArtifact: string | null;
    consumerAverageSubmitterSafeAvailabilityConfirmationFeatureOnlyTemplateArtifact: string | null;
    consumerAverageSubmitterFeatureOnlyModeArtifact: string | null;
    consumerAverageSubmitterFeatureOnlyModeConclusion: string | null;
    consumerAverageSubmitterFeatureOnlyModeCoverageContextAllowed: boolean | null;
    consumerAverageSubmitterFeatureOnlyModeCoverageRequiresPreferredPair: boolean | null;
    consumerAverageSubmitterFeatureOnlyModeCoverageContextTemplateArtifact: string | null;
    consumerAverageSubmitterFeatureOnlyModeMinimumFeaturePairRequired: string[];
    consumerAverageSubmitterFeatureOnlyModeMissingAttestationKeys: string[];
    consumerAverageSubmitterFeatureOnlyModeMissingEvidenceSourceFamilyIds: string[];
    consumerAverageSubmitterFeatureOnlyModeMissingPrimaryFeatureFamilyIds: string[];
    consumerAverageSubmitterFeatureOnlyModeModelEvidencePromotionAllowed: boolean | null;
    consumerAverageSubmitterFeatureOnlyModeNextAction: string | null;
    consumerAverageSubmitterFeatureOnlyModeOutcomeLinkageRequiredForFeatureOnlyContext: boolean | null;
    consumerAverageSubmitterFeatureOnlyModeOutcomeLinkedEvidenceReady: boolean | null;
    consumerAverageSubmitterFeatureOnlyModePreferredPairReady: boolean | null;
    consumerAverageSubmitterFeatureOnlyModeRowLevelDataAcceptedByR1151: boolean | null;
    consumerAverageSubmitterFeatureOnlyModeSafeAvailabilityFeatureOnlyCoverageContextReady: boolean | null;
    consumerAverageSubmitterFeatureOnlyModeSafeAvailabilityFeatureOnlyReadinessPresent: boolean | null;
    consumerAverageSubmitterFeatureOnlyModeSupportedFeatureFamilyIds: string[];
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeArtifact: string | null;
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeConclusion: string | null;
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeContextStatus: string | null;
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeReadyForResearchPlanning: boolean | null;
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeMinimumFeaturePairRequired: string[];
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeMissingPrimaryFeatureFamilyIds: string[];
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeModelEvidencePromotionAllowed: boolean | null;
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeNextAction: string | null;
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeOutcomeLinkageRequiredForFeatureOnlyContext: boolean | null;
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeR1151ReadyForIntake: boolean | null;
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeRowLevelDataAcceptedByR1152: boolean | null;
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeSupportedFeatureFamilyIds: string[];
    consumerAverageSubmitterFeatureOnlyChainArtifact: string | null;
    consumerAverageSubmitterFeatureOnlyChainConclusion: string | null;
    consumerAverageSubmitterFeatureOnlyChainContextPathConfigured: boolean | null;
    consumerAverageSubmitterFeatureOnlyChainCoverageContextReadyForResearchPlanning: boolean | null;
    consumerAverageSubmitterFeatureOnlyChainCoverageContextAllowed: boolean | null;
    consumerAverageSubmitterFeatureOnlyChainCoverageContextIntakeConclusion: string | null;
    consumerAverageSubmitterFeatureOnlyChainCoverageContextIntakeContextStatus: string | null;
    consumerAverageSubmitterFeatureOnlyChainFeatureOnlyModeConclusion: string | null;
    consumerAverageSubmitterFeatureOnlyChainMinimumFeaturePairRequired: string[];
    consumerAverageSubmitterFeatureOnlyChainMissingCoverageContextPrimaryFeatureFamilyIds: string[];
    consumerAverageSubmitterFeatureOnlyChainMissingFeatureOnlySourceFamilyIds: string[];
    consumerAverageSubmitterFeatureOnlyChainModelEvidencePromotionAllowed: boolean | null;
    consumerAverageSubmitterFeatureOnlyChainNextAction: string | null;
    consumerAverageSubmitterFeatureOnlyChainOutcomeLinkageRequiredForFeatureOnlyContext: boolean | null;
    consumerAverageSubmitterFeatureOnlyChainRowLevelDataAcceptedByR1153: boolean | null;
    consumerAverageSubmitterFeatureOnlyChainSafeAvailabilityFeatureOnlyCoverageContextReady: boolean | null;
    consumerAverageSubmitterFeatureOnlyChainSafeAvailabilityReadyForRecipeReadinessChain: boolean | null;
    consumerAverageSubmitterFeatureOnlyChainSupportedFeatureFamilyIds: string[];
    consumerAverageSubmitterSafeAvailabilityActionPacketArtifact: string | null;
    consumerAverageSubmitterSafeAvailabilityActionPacketCommand: string | null;
    consumerAverageSubmitterSafeAvailabilityActionPacketConclusion: string | null;
    consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyCoverageContextReady: boolean | null;
    consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyQuickstartArtifact: string | null;
    consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount: number | null;
    consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths: string[];
    consumerAverageSubmitterSafeAvailabilityConfirmationIntakeCommand: string | null;
    consumerAverageSubmitterSafeAvailabilityFeatureOnlyChainRunnerCommand: string | null;
    consumerAverageSubmitterSafeAvailabilityOutcomeLinkedRecipeReadinessCommand: string | null;
    consumerAverageSubmitterSafeAvailabilityCompletionModeIds: string[];
    consumerAverageSubmitterSafeAvailabilityActionPacketChecklistItemIds: string[];
    consumerAverageSubmitterSafeAvailabilityActionPacketMinimumFeaturePairRequired: string[];
    consumerAverageSubmitterSafeAvailabilityActionPacketMissingAggregateReadinessFactIds: string[];
    consumerAverageSubmitterSafeAvailabilityActionPacketMissingAttestationKeys: string[];
    consumerAverageSubmitterSafeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds: string[];
    consumerAverageSubmitterSafeAvailabilityActionPacketMissingRequiredSourceFamilyIds: string[];
    consumerAverageSubmitterSafeAvailabilityActionPacketNextAction: string | null;
    consumerAverageSubmitterSafeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain: boolean | null;
    consumerAverageSubmitterSafeAvailabilityActionPacketRowLevelDataAcceptedByR1154: boolean | null;
    consumerAverageSubmitterSafeAvailabilityActionPacketRowOwnerWorkType: string | null;
    consumerAverageSubmitterSafeAvailabilityActionPacketRowParsingPerformedByR1154: boolean | null;
    consumerAverageSubmitterSafeAvailabilityActionPacketTemplateArtifact: string | null;
    consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyTemplateArtifact: string | null;
    consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofArtifact: string | null;
    consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofConclusion: string | null;
    consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofNextAction: string | null;
    consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofFeatureOnlyChainConclusion: string | null;
    consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofFeatureOnlyCoverageContextReadyForResearchPlanning: boolean | null;
    consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofSafeAvailabilityConfirmationConclusion: string | null;
    consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofReadyForRecipeReadinessChain: boolean | null;
    consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofModelEvidencePromotionAllowed: boolean | null;
    consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofRowLevelDataAcceptedByR1155: boolean | null;
    consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofSmokeEvidence: boolean | null;
    consumerAverageSubmitterSafeConfirmationHandoffArtifact: string | null;
    consumerAverageSubmitterSafeConfirmationHandoffCommand: string | null;
    consumerAverageSubmitterSafeConfirmationHandoffConclusion: string | null;
    consumerAverageSubmitterSafeConfirmationHandoffNextAction: string | null;
    consumerAverageSubmitterSafeConfirmationHandoffFeatureOnlyPathMechanicallyProven: boolean | null;
    consumerAverageSubmitterSafeConfirmationHandoffHandoffReadyForRowOwner: boolean | null;
    consumerAverageSubmitterSafeConfirmationHandoffModelEvidencePromotionAllowed: boolean | null;
    consumerAverageSubmitterSafeConfirmationHandoffReadyForModelEvidence: boolean | null;
    consumerAverageSubmitterSafeConfirmationHandoffReadyForRecipeReadinessChain: boolean | null;
    consumerAverageSubmitterSafeConfirmationHandoffRequiredFeatureOnlySourceFamilyIds: string[];
    consumerAverageSubmitterSafeConfirmationHandoffRequiredSafeCompletionCheckIds: string[];
    consumerAverageSubmitterSafeConfirmationHandoffRowLevelDataAcceptedByR1156: boolean | null;
    consumerAverageSubmitterSafeConfirmationHandoffRowOwnerWorkType: string | null;
    consumerAverageSubmitterSafeConfirmationHandoffSafeConfirmationStillRequired: boolean | null;
    consumerAverageSubmitterSafeConfirmationHandoffSmokeEvidence: boolean | null;
    consumerAverageSubmitterSafeConfirmationChainRunnerArtifact: string | null;
    consumerAverageSubmitterSafeConfirmationChainRunnerCommand: string | null;
    consumerAverageSubmitterSafeConfirmationChainRunnerConclusion: string | null;
    consumerAverageSubmitterSafeConfirmationChainRunnerNextAction: string | null;
    consumerAverageSubmitterSafeConfirmationChainRunnerConfirmationPathConfigured: boolean | null;
    consumerAverageSubmitterSafeConfirmationChainRunnerFeatureOnlyCoverageContextReady: boolean | null;
    consumerAverageSubmitterSafeConfirmationChainRunnerFeatureOnlyResearchPlanningReady: boolean | null;
    consumerAverageSubmitterSafeConfirmationChainRunnerReadyForModelEvidence: boolean | null;
    consumerAverageSubmitterSafeConfirmationChainRunnerReadyForRecipeReadinessChain: boolean | null;
    consumerAverageSubmitterSafeConfirmationChainRunnerRowLevelDataAcceptedByR1157: boolean | null;
    consumerAverageSubmitterSafeConfirmationChainRunnerSafeConfirmationStillRequired: boolean | null;
    consumerAverageSubmitterSafeConfirmationFillGuideArtifact: string | null;
    consumerAverageSubmitterSafeConfirmationFillGuideCommand: string | null;
    consumerAverageSubmitterSafeConfirmationFillGuideConclusion: string | null;
    consumerAverageSubmitterSafeConfirmationFillGuideExactSafeFieldEditCount: number | null;
    consumerAverageSubmitterSafeConfirmationFillGuideGuideReadyForRowOwnerFill: boolean | null;
    consumerAverageSubmitterSafeConfirmationFillGuideMinimumFeaturePairRequired: string[];
    consumerAverageSubmitterSafeConfirmationFillGuideNextAction: string | null;
    consumerAverageSubmitterSafeConfirmationFillGuideOptionalAddOnFamilyIds: string[];
    consumerAverageSubmitterSafeConfirmationFillGuideRequiredChecklistIds: string[];
    consumerAverageSubmitterSafeConfirmationFillGuideRequiredInputKindIds: string[];
    consumerAverageSubmitterSafeConfirmationFillGuideRowLevelDataAcceptedByR1158: boolean | null;
    consumerAverageSubmitterSafeConfirmationAnswerSheetArtifact: string | null;
    consumerAverageSubmitterSafeConfirmationAnswerSheetCommand: string | null;
    consumerAverageSubmitterSafeConfirmationAnswerSheetConclusion: string | null;
    consumerAverageSubmitterSafeConfirmationAnswerSheetExactSafeAnswerCount: number | null;
    consumerAverageSubmitterSafeConfirmationAnswerSheetReadyForRowOwner: boolean | null;
    consumerAverageSubmitterSafeConfirmationAnswerSheetMinimumFeaturePairRequired: string[];
    consumerAverageSubmitterSafeConfirmationAnswerSheetNextAction: string | null;
    consumerAverageSubmitterSafeConfirmationAnswerSheetOptionalAddOnFamilyIds: string[];
    consumerAverageSubmitterSafeConfirmationAnswerSheetRequiredChecklistIds: string[];
    consumerAverageSubmitterSafeConfirmationAnswerSheetRequiredInputKindIds: string[];
    consumerAverageSubmitterSafeConfirmationAnswerSheetRowLevelDataAcceptedByR1159: boolean | null;
    consumerAverageSubmitterSafeConfirmationAnswerSheetRowOwnerProvidedValuesStored: boolean | null;
    consumerAverageSubmitterSafeConfirmationTranscriptionProofArtifact: string | null;
    consumerAverageSubmitterSafeConfirmationTranscriptionProofCommand: string | null;
    consumerAverageSubmitterSafeConfirmationTranscriptionProofConclusion: string | null;
    consumerAverageSubmitterSafeConfirmationTranscriptionProofExactSafeTranscriptionStepCount: number | null;
    consumerAverageSubmitterSafeConfirmationTranscriptionProofReadyForRowOwnerConfirmation: boolean | null;
    consumerAverageSubmitterSafeConfirmationTranscriptionProofHypotheticalTranscriptionWouldBeFeatureOnlyReady: boolean | null;
    consumerAverageSubmitterSafeConfirmationTranscriptionProofNextAction: string | null;
    consumerAverageSubmitterSafeConfirmationTranscriptionProofRequiredInputKindIds: string[];
    consumerAverageSubmitterSafeConfirmationTranscriptionProofRowLevelDataAcceptedByR1160: boolean | null;
    consumerAverageSubmitterSafeConfirmationTranscriptionProofRowOwnerConfirmationStillRequired: boolean | null;
    consumerAverageSubmitterSafeConfirmationTranscriptionProofConfirmationValuesStoredByR1160: boolean | null;
    consumerAverageSubmitterSafeConfirmationTranscriptionProofRowOwnerProvidedValuesStored: boolean | null;
    consumerAverageSubmitterSafeConfirmationMaterializerArtifact: string | null;
    consumerAverageSubmitterSafeConfirmationMaterializerCommand: string | null;
    consumerAverageSubmitterSafeConfirmationMaterializerConclusion: string | null;
    consumerAverageSubmitterSafeConfirmationMaterializerNextAction: string | null;
    consumerAverageSubmitterSafeConfirmationMaterializerExplicitRowOwnerConfirmationAssertionProvided: boolean | null;
    consumerAverageSubmitterSafeConfirmationMaterializerSafeConfirmationArtifactWritten: boolean | null;
    consumerAverageSubmitterSafeConfirmationMaterializerSafeConfirmationArtifact: string | null;
    consumerAverageSubmitterSafeConfirmationMaterializerFeatureOnlyConfirmationWouldBeReadyForR1150: boolean | null;
    consumerAverageSubmitterSafeConfirmationMaterializerRowOwnerConfirmationStillRequired: boolean | null;
    consumerAverageSubmitterSafeConfirmationMaterializerConfirmationValuesStoredInR1161Packet: boolean | null;
    consumerAverageSubmitterSafeConfirmationMaterializerRowLevelDataAcceptedByR1161: boolean | null;
    consumerAverageSubmitterSafeConfirmationMaterializerRowOwnerPrivateValuesStored: boolean | null;
    consumerAverageSubmitterSafeConfirmationAssertionHandoffArtifact: string | null;
    consumerAverageSubmitterSafeConfirmationAssertionHandoffCommand: string | null;
    consumerAverageSubmitterSafeConfirmationAssertionHandoffConclusion: string | null;
    consumerAverageSubmitterSafeConfirmationAssertionHandoffNextAction: string | null;
    consumerAverageSubmitterSafeConfirmationAssertionHandoffHandoffReadyForRowOwner: boolean | null;
    consumerAverageSubmitterSafeConfirmationAssertionHandoffRowOwnerAssertionStillRequired: boolean | null;
    consumerAverageSubmitterSafeConfirmationAssertionHandoffExplicitRowOwnerConfirmationAssertionProvided: boolean | null;
    consumerAverageSubmitterSafeConfirmationAssertionHandoffSafeConfirmationArtifactWritten: boolean | null;
    consumerAverageSubmitterSafeConfirmationAssertionHandoffFeatureOnlyConfirmationWouldBeReadyForR1150: boolean | null;
    consumerAverageSubmitterSafeConfirmationAssertionHandoffRequiredInputKindIds: string[];
    consumerAverageSubmitterSafeConfirmationAssertionHandoffRequiredChecklistIds: string[];
    consumerAverageSubmitterSafeConfirmationAssertionHandoffMinimumFeaturePairRequired: string[];
    consumerAverageSubmitterSafeConfirmationAssertionHandoffMaterializerCommand: string | null;
    consumerAverageSubmitterSafeConfirmationAssertionHandoffMaterializerNextAction: string | null;
    consumerAverageSubmitterSafeConfirmationAssertionHandoffConfirmationValuesStoredByR1162: boolean | null;
    consumerAverageSubmitterSafeConfirmationAssertionHandoffRowLevelDataAcceptedByR1162: boolean | null;
    consumerAverageSubmitterSafeConfirmationAssertionHandoffRowOwnerPrivateValuesStored: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerArtifact: string | null;
    consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerCommand: string | null;
    consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerConclusion: string | null;
    consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerNextAction: string | null;
    consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerExplicitRowOwnerAssertionProvided: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerFeatureOnlyResearchPlanningReady: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerFeatureOnlyChainRan: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerRowOwnerAssertionStillRequired: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerConfirmedSafeConfirmationArtifact: string | null;
    consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerSafeConfirmationArtifactWritten: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerRowLevelDataAcceptedByR1163: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerRowOwnerPrivateValuesStored: boolean | null;
    consumerAverageSubmitterFeatureOnlyResearchHandoffArtifact: string | null;
    consumerAverageSubmitterFeatureOnlyResearchHandoffCommand: string | null;
    consumerAverageSubmitterFeatureOnlyResearchHandoffConclusion: string | null;
    consumerAverageSubmitterFeatureOnlyResearchHandoffNextAction: string | null;
    consumerAverageSubmitterFeatureOnlyResearchHandoffFeatureOnlyResearchPlanningReady: boolean | null;
    consumerAverageSubmitterFeatureOnlyResearchHandoffResearchPlanningAllowed: boolean | null;
    consumerAverageSubmitterFeatureOnlyResearchHandoffOutcomeLinkedModelEvidenceStillRequired: boolean | null;
    consumerAverageSubmitterFeatureOnlyResearchHandoffPrioritizedInputKindIds: string[];
    consumerAverageSubmitterFeatureOnlyResearchHandoffMinimumFeaturePairRequired: string[];
    consumerAverageSubmitterFeatureOnlyResearchHandoffRowLevelDataAcceptedByR1164: boolean | null;
    consumerAverageSubmitterFeatureOnlyResearchHandoffRowOwnerPrivateValuesStored: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerArtifact: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerCommand: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerConclusion: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerNextAction: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerAssertionAccepted: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerAssertionProvided: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerAssertionTemplateArtifact: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerChildR1163Ran: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerFeatureOnlyResearchPlanningReady: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerRequiredInputKindIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerRequiredAssertionChecklistIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerOptionalAddOnFamilyIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerValidationReasonIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerRowLevelDataAcceptedByR1165: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerRowOwnerPrivateValuesStored: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideArtifact: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideCommand: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideConclusion: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideNextAction: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideGuideReadyForRowOwnerFill: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideRequiredInputKindIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideOptionalAddOnFamilyIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideSafeFieldEditCount: number | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideSafeFieldEditPaths: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideRowLevelDataAcceptedByR1167: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideRowOwnerPrivateValuesStored: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetArtifact: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetCommand: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetConclusion: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetNextAction: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetReadyForRowOwner: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetMaterializerReady: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetMaterializerExplicitConfirmationRequired: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetExactSafeAnswerCount: number | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetAllowedValueKindIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetBlockedAssertionContentIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetRequiredInputKindIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetRequiredAssertionChecklistIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetSafeFieldEditPaths: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetRowLevelDataAcceptedByR1173: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetRowOwnerProvidedValuesStored: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketArtifact: string | null;
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketCommand: string | null;
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketAllowedValueKindIds: string[];
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketBlockedContentIds: string[];
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketConclusion: string | null;
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketNextAction: string | null;
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForRowOwnerR1172Confirmation: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForRowOwnerR1176LiveChainConfirmation: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketR1176LiveChainCommand: string | null;
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForR1165Runner: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketExactSafeFieldEditCount: number | null;
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketRowLevelDataAcceptedByR1174: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketRowOwnerProvidedValuesStored: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerArtifact: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerCommand: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerConclusion: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerNextAction: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerExplicitRowOwnerAssertionProvided: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerArtifactWritten: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerRowOwnerAssertionStillRequired: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerWouldBeAcceptedByR1165: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerR1165RunnerReady: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerR1165TemplateReady: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerR1167FillGuideReady: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerAllowedValueKindIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerBlockedContentIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerSafeFieldEditCount: number | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerSafeFieldEditPaths: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerRowLevelDataAcceptedByR1172: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerRowOwnerPrivateValuesStored: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofArtifact: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofCommand: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofConclusion: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofNextAction: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofPassed: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofSynthetic: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofRealEvidenceProduced: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofModelEvidencePromotionAllowed: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofLiveChainGateStillRequired: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofR1165AssertionAccepted: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofR1165ChildR1163Ran: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofR1165FeatureOnlyResearchPlanningReady: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofSafeFieldEditCount: number | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofSafeFieldEditPaths: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofRowLevelDataAcceptedByR1170: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofRowOwnerPrivateValuesStored: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeArtifact: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeCommand: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeAllowedValueKindIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeBlockedContentIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeOptionalAddOnFamilyIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeConclusion: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeNextAction: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokePassed: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeSynthetic: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeRealEvidenceProduced: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeModelEvidencePromotionAllowed: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeLiveChainGateStillRequired: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1172MaterializedAssertionWritten: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1172WouldBeAcceptedByR1165: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1165AssertionAccepted: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1165ChildR1163Ran: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1165FeatureOnlyResearchPlanningReady: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1163FeatureOnlyResearchPlanningReady: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeSafeFieldEditCount: number | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeSafeFieldEditPaths: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeRowLevelDataAcceptedByR1175: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeRowOwnerPrivateValuesStored: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeRowParsingPerformedByR1175: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainArtifact: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainCommand: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainAllowedValueKindIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainBlockedContentIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainOptionalAddOnFamilyIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainCompletionModeId: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainConclusion: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainNextAction: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainReady: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainExplicitRowOwnerAssertionProvided: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainFeatureOnlyResearchPlanningReady: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRealEvidenceProduced: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainModelEvidencePromotionAllowed: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainOutcomeLinkedModelEvidenceStillRequired: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowOwnerAssertionStillRequired: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowOwnerHandoffReasonId: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1172MaterializedAssertionWritten: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1172WouldBeAcceptedByR1165: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1165AssertionAccepted: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1165ChildR1163Ran: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1165FeatureOnlyResearchPlanningReady: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1163FeatureOnlyResearchPlanningReady: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainSafeFieldEditCount: number | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainSafeFieldEditPaths: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainSafeCompletionChecklistItemIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowLevelDataAcceptedByR1176: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowOwnerPrivateValuesStored: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowParsingPerformedByR1176: boolean | null;
    consumerAverageSubmitterSafeResponseSmokeProofArtifact: string | null;
    consumerAverageSubmitterSafeResponseSmokeProofCommand: string | null;
    consumerAverageSubmitterSafeResponseSmokeProofConclusion: string | null;
    consumerAverageSubmitterSafeResponseSmokeProofLiveR1184Conclusion: string | null;
    consumerAverageSubmitterSafeResponseSmokeProofLiveR1184ReadyForSyntheticSmoke: boolean | null;
    consumerAverageSubmitterSafeResponseSmokeProofNextRealAction: string | null;
    consumerAverageSubmitterSafeResponseSmokeProofNextRealActionCommand: string | null;
    consumerAverageSubmitterSafeResponseSmokeProofNextRealActionRequiresExplicitRowOwnerAssertion: boolean | null;
    consumerAverageSubmitterSafeResponseSmokeProofMinimumFeaturePairRequired: string[];
    consumerAverageSubmitterSafeResponseSmokeProofPrioritizedInputKindIds: string[];
    consumerAverageSubmitterSafeResponseSmokeProofRequiredResponseFieldIds: string[];
    consumerAverageSubmitterSafeResponseSmokeProofSafeExecutionFeatureSlotIds: string[];
    consumerAverageSubmitterSafeResponseSmokeProofSyntheticPathAdvancedToFeatureOnlyResearchPlanning: boolean | null;
    consumerAverageSubmitterSafeResponseSmokeProofSyntheticSmokeRan: boolean | null;
    consumerAverageSubmitterSafeResponseSmokeProofModelEvidencePromotionAllowed: boolean | null;
    consumerAverageSubmitterSafeResponseSmokeProofProductDisplayAuthorized: boolean | null;
    consumerAverageSubmitterSafeResponseSmokeProofRowLevelDataAcceptedByR1185: boolean | null;
    consumerAverageSubmitterSafeResponseSmokeProofRowOwnerConfirmationInferredByR1185: boolean | null;
    consumerAverageSubmitterSafeResponseSmokeProofRowOwnerPrivateValuesStored: boolean | null;
    consumerAverageSubmitterSafeResponseSmokeProofRowParsingPerformedByR1185: boolean | null;
    consumerAverageSubmitterSafeResponseSmokeProofLiveArtifactsMutatedByR1185: boolean | null;
    consumerAverageSubmitterMissingSlotCount: number | null;
    consumerAverageSubmitterMissingSlotTypes: string[];
    consumerAverageSubmitterNextAction: string | null;
    consumerAverageSubmitterReadinessArtifact: string | null;
    consumerAverageSubmitterReadinessConclusion: string | null;
    consumerAverageSubmitterReadyForPrivateRunner: boolean | null;
    consumerAverageSubmitterRealAggregateStillMissing: boolean | null;
    consumerAverageSubmitterSourceFamilyMissingSlotRollup: SourceFamilyMissingSlotRollup[];
    consumerFirstPassAggregateMetricsTemplateArtifact: string | null;
    consumerOrdinarySubmissionHandoffPlanArtifact: string | null;
    consumerOrdinarySourceFamilyIds: string[];
    consumerOrdinaryTableLayouts: string[];
    consumerPipelineSmokeConclusion: string | null;
    consumerPipelineSmokeSyntheticEvidence: false | null;
    consumerPipelineSmokeTableLayouts: string[];
    consumerPrivateRunnerNextAction: string | null;
    consumerRealEvidenceGateBlockers: string[];
    consumerRealEvidenceGateConclusion: string | null;
    consumerRealEvidenceGateNextAction: string | null;
    consumerRealEvidenceHandoffArtifact: string | null;
    consumerRealEvidenceHandoffBlockers: string[];
    consumerRealEvidenceHandoffMissingConfigChecklistCount: number | null;
    consumerRealEvidenceHandoffMissingConfigChecklistSlotTypes: string[];
    consumerRealEvidenceHandoffConclusion: string | null;
    consumerRealEvidenceHandoffMissingConfigPieces: MissingConfigPieces | null;
    consumerRealEvidenceHandoffNextAction: string | null;
    consumerRealEvidenceHandoffPrivateConfigReadiness: string | null;
    consumerRealEvidenceHandoffRowOwnerWorkType: string | null;
    commands: string[];
    nextAction: string;
    productDisplayAuthorized: false;
    reviewGptRequiredNow: boolean;
    reviewGptUse: "only_for_real_aggregate_delta_or_major_architecture_fork";
    routerConclusion: string;
    routerNextAction: string;
  };
  packetId: "r1076-current-autoresearch-loop-executor";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1076_CURRENT_AUTORESEARCH_LOOP_EXECUTOR_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: ExecutorConclusion;
    nextAction: string;
    productDisplayAuthorized: false;
    reviewGptRequiredNow: boolean;
    rowParsingPerformedByR1076: false;
    routerConclusion: string;
    routerNextAction: string;
    consumerAverageSubmitterFamilyIds: string[];
    consumerAverageSubmitterAvailabilityConclusion: string | null;
    consumerAverageSubmitterAvailabilityManifestStatus: string | null;
    consumerAverageSubmitterAvailabilityMissingSourceFamilyIds: string[];
    consumerAverageSubmitterAvailabilityNextAction: string | null;
    consumerAverageSubmitterAvailabilityPreflightArtifact: string | null;
    consumerAverageSubmitterAvailabilityReadyForPrivateConfigMapping: boolean | null;
    consumerAverageSubmitterConfigBridgeArtifact: string | null;
    consumerAverageSubmitterConfigBridgeAvailableSourceFamilyIds: string[];
    consumerAverageSubmitterConfigBridgeConclusion: string | null;
    consumerAverageSubmitterConfigBridgeMappingPlanStatus: string | null;
    consumerAverageSubmitterConfigBridgeNextAction: string | null;
    consumerAverageSubmitterConfigBridgeReadyForPrivateConfigMapping: boolean | null;
    consumerAverageSubmitterConfigBridgeSelectedTableLayout: string | null;
    consumerAverageSubmitterManifestPacketArtifact: string | null;
    consumerAverageSubmitterManifestPacketConclusion: string | null;
    consumerAverageSubmitterManifestPacketMatchedRecipeIds: string[];
    consumerAverageSubmitterManifestPacketMaterializerCommand: string | null;
    consumerAverageSubmitterManifestPacketNextAction: string | null;
    consumerAverageSubmitterManifestPacketPrimaryInputFamilyIds: string[];
    consumerAverageSubmitterManifestPacketReadyForPrivateConfigMapping: boolean | null;
    consumerAverageSubmitterManifestPacketRecipeReadinessChainCommand: string | null;
    consumerAverageSubmitterManifestPacketSafeManifestAttestationsComplete: boolean | null;
    consumerAverageSubmitterManifestPacketPartialPrivateChainRunnerCommand: string | null;
    consumerAverageSubmitterManifestPacketPartialRouteRecipeIds: string[];
    consumerAverageSubmitterManifestPacketPreferredRecipeIds: string[];
    consumerAverageSubmitterManifestPacketRequiredLinkageFamilyIds: string[];
    consumerAverageSubmitterAvailabilityChainArtifact: string | null;
    consumerAverageSubmitterAvailabilityChainConclusion: string | null;
    consumerAverageSubmitterAvailabilityChainManifestSupplied: boolean | null;
    consumerAverageSubmitterAvailabilityChainNextAction: string | null;
    consumerAverageSubmitterAvailabilityChainReadyForPrivateConfigMapping: boolean | null;
    consumerAverageSubmitterPartialRoutePlannerArtifact: string | null;
    consumerAverageSubmitterPartialRoutePlannerConclusion: string | null;
    consumerAverageSubmitterPartialRoutePlannerFullRouteReady: boolean | null;
    consumerAverageSubmitterPartialRoutePlannerNextAction: string | null;
    consumerAverageSubmitterPartialRoutePlannerReadyForPrivateConfigMapping: boolean | null;
    consumerAverageSubmitterPartialRoutePlannerReadyUnsupportedRouteIds: string[];
    consumerAverageSubmitterPartialMetricIntakeArtifact: string | null;
    consumerAverageSubmitterPartialMetricIntakeConclusion: string | null;
    consumerAverageSubmitterPartialMetricIntakeNextAction: string | null;
    consumerAverageSubmitterPartialMetricIntakeReadyRouteIds: string[];
    consumerAverageSubmitterPartialMetricIntakeTemplateArtifact: string | null;
    consumerAverageSubmitterPartialPrivateConfigHandoffArtifact: string | null;
    consumerAverageSubmitterPartialPrivateConfigHandoffConclusion: string | null;
    consumerAverageSubmitterPartialPrivateConfigHandoffEligibleRouteIds: string[];
    consumerAverageSubmitterPartialPrivateConfigHandoffFullEvidenceGateCleared: boolean | null;
    consumerAverageSubmitterPartialPrivateConfigHandoffNextAction: string | null;
    consumerAverageSubmitterPartialPrivateConfigHandoffReadyMetricRouteIds: string[];
    consumerAverageSubmitterPartialPrivateConfigHandoffRequiredFieldRefFamilies: string[];
    consumerAverageSubmitterPartialPrivateConfigHandoffRequiredTableRefs: string[];
    consumerAverageSubmitterPartialPrivateConfigHandoffTemplateArtifact: string | null;
    consumerAverageSubmitterPartialReadinessChainArtifact: string | null;
    consumerAverageSubmitterPartialReadinessChainConclusion: string | null;
    consumerAverageSubmitterPartialReadinessChainEligibleRouteIds: string[];
    consumerAverageSubmitterPartialReadinessChainFullEvidenceGateCleared: boolean | null;
    consumerAverageSubmitterPartialReadinessChainManifestSupplied: boolean | null;
    consumerAverageSubmitterPartialReadinessChainNextAction: string | null;
    consumerAverageSubmitterPartialReadinessChainReadyMetricRouteIds: string[];
    consumerAverageSubmitterPartialReadinessChainRequiredFieldRefFamilies: string[];
    consumerAverageSubmitterPartialReadinessChainRequiredTableRefs: string[];
    consumerAverageSubmitterPartialReadinessChainTemplateArtifact: string | null;
    consumerAverageSubmitterPartialPrivateMetricRunnerAggregateMetricsArtifact: string | null;
    consumerAverageSubmitterPartialPrivateMetricRunnerArtifact: string | null;
    consumerAverageSubmitterPartialPrivateMetricRunnerConclusion: string | null;
    consumerAverageSubmitterPartialPrivateMetricRunnerEligibleRouteIds: string[];
    consumerAverageSubmitterPartialPrivateMetricRunnerExecutedRouteIds: string[];
    consumerAverageSubmitterPartialPrivateMetricRunnerNextAction: string | null;
    consumerAverageSubmitterPartialPrivateMetricRunnerRequestedRouteIds: string[];
    consumerAverageSubmitterPartialPrivateMetricRunnerRouteMetricsReadyForR1138: boolean | null;
    consumerAverageSubmitterPartialPrivateChainAggregateMetricsArtifact: string | null;
    consumerAverageSubmitterPartialPrivateChainArtifact: string | null;
    consumerAverageSubmitterPartialPrivateChainConclusion: string | null;
    consumerAverageSubmitterPartialPrivateChainEligibleRouteIds: string[];
    consumerAverageSubmitterPartialPrivateChainExecutedRouteIds: string[];
    consumerAverageSubmitterPartialPrivateChainFinalReadyRouteIds: string[];
    consumerAverageSubmitterPartialPrivateChainFullEvidenceGateCleared: boolean | null;
    consumerAverageSubmitterPartialPrivateChainFullSupportedRouteReady: boolean | null;
    consumerAverageSubmitterPartialPrivateChainNextAction: string | null;
    consumerAverageSubmitterPartialPrivateChainRouteMetricsReadyForR1138: boolean | null;
    consumerAverageSubmitterCompletionAuditArtifact: string | null;
    consumerAverageSubmitterCompletionAuditBlockers: string[];
    consumerAverageSubmitterCompletionAuditConclusion: string | null;
    consumerAverageSubmitterCompletionAuditGoalAchieved: boolean | null;
    consumerAverageSubmitterCompletionAuditMissingRequirementIds: string[];
    consumerAverageSubmitterCompletionAuditNextAction: string | null;
    consumerAverageSubmitterCompletionAuditUnblockerBlockedRequirementIds: string[];
    consumerAverageSubmitterCompletionAuditUnblockerBlockedStepIds: string[];
    consumerAverageSubmitterCompletionAuditUnblockerCommandCount: number | null;
    consumerAverageSubmitterCompletionAuditUnblockerStepIds: string[];
    consumerAverageSubmitterCompletionAuditUnblockerTopAllowedValueKindIds: string[];
    consumerAverageSubmitterCompletionAuditUnblockerTopBlockedContentIds: string[];
    consumerAverageSubmitterCompletionAuditUnblockerTopCommand: string | null;
    consumerAverageSubmitterCompletionAuditUnblockerTopNextAction: string | null;
    consumerAverageSubmitterCompletionAuditUnblockerTopRequirementId: string | null;
    consumerAverageSubmitterCompletionAuditUnblockerTopRequiredInputKindIds: string[];
    consumerAverageSubmitterCompletionAuditUnblockerTopSafeCompletionChecklistItemIds: string[];
    consumerAverageSubmitterCompletionAuditUnblockerTopStepId: string | null;
    consumerAverageSubmitterCompletionAuditProductDisplayAuthorized: boolean | null;
    consumerAverageSubmitterCompletionAuditReadyToMarkComplete: boolean | null;
    consumerAverageSubmitterCompletionAuditTopMissingRequirement: string | null;
    consumerAverageSubmitterRowOwnerActionPacketArtifact: string | null;
    consumerAverageSubmitterRowOwnerActionPacketBlockers: string[];
    consumerAverageSubmitterRowOwnerActionPacketConclusion: string | null;
    consumerAverageSubmitterRowOwnerActionPacketFallbackRecipeIds: string[];
    consumerAverageSubmitterRowOwnerActionPacketNextAction: string | null;
    consumerAverageSubmitterRowOwnerActionPacketRecommendedConfirmedRecipeCommand: string | null;
    consumerAverageSubmitterRowOwnerActionPacketRecommendedConfirmedRecipeCommandAvailable: boolean | null;
    consumerAverageSubmitterRowOwnerActionPacketSelectedRecipeId: string | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketArtifact: string | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketBlockers: string[];
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketConclusion: string | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketExpectedRouteIds: string[];
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketNextAction: string | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketRequiredFieldRefFamilies: string[];
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketRequiredTableRefs: string[];
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigPrivateFieldRefKeys: string[];
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigPrivateTableRefKeys: string[];
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigRouteRunOrder: string[];
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigSchemaVersion: string | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigTopLevelKeys: string[];
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketRowOwnerAssertionsConfirmed: boolean | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketTemplateArtifact: string | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketTemplateReadyForFill: boolean | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeArtifact: string | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeConclusion: string | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeEvidenceRoleStatus: string | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeMissingAttestationKeys: string[];
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeMissingRouteIds: string[];
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeMissingRunnerFieldRefKeys: string[];
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeMissingRunnerTableRefKeys: string[];
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeNextAction: string | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeOrdinaryTableLayout: string | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakePacketReadyForConfigIntake: boolean | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakePrivateConfigStatus: string | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakePrivateConfigSupplied: boolean | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeR1147Conclusion: string | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeR1147NextAction: string | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeReadyForR1142: boolean | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeRequestedRouteIds: string[];
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeActionGuardPresent: boolean | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketConclusion: string | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketFeatureOnlyCoverageContextReady: boolean | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds: string[];
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketMissingRequiredSourceFamilyIds: string[];
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketNextAction: string | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain: boolean | null;
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketRowLevelDataAcceptedByR1154: boolean | null;
    consumerAverageSubmitterLabWearableSubmissionKitArtifact: string | null;
    consumerAverageSubmitterLabWearableSubmissionKitConclusion: string | null;
    consumerAverageSubmitterLabWearableSubmissionKitNextAction: string | null;
    consumerAverageSubmitterLabWearableSubmissionKitOptionalAddOnFamilyIds: string[];
    consumerAverageSubmitterLabWearableSubmissionKitPrivateConfigReadyForR1142: boolean | null;
    consumerAverageSubmitterLabWearableSubmissionKitPrivateConfigStatus: string | null;
    consumerAverageSubmitterLabWearableSubmissionKitReadyForResearchReview: boolean | null;
    consumerAverageSubmitterLabWearableSubmissionKitRequiredSourceFamilyIds: string[];
    consumerAverageSubmitterLabWearableSubmissionKitRowOwnerAssertionsConfirmed: boolean | null;
    consumerAverageSubmitterLabWearableSubmissionKitTopBlocker: string | null;
    consumerAverageSubmitterSafeAvailabilityConfirmationArtifact: string | null;
    consumerAverageSubmitterSafeAvailabilityConfirmationConclusion: string | null;
    consumerAverageSubmitterSafeAvailabilityConfirmationMissingAggregateReadinessFactIds: string[];
    consumerAverageSubmitterSafeAvailabilityConfirmationMissingAttestationKeys: string[];
    consumerAverageSubmitterSafeAvailabilityConfirmationMissingFeatureOnlySourceFamilyIds: string[];
    consumerAverageSubmitterSafeAvailabilityConfirmationMissingSourceFamilyIds: string[];
    consumerAverageSubmitterSafeAvailabilityConfirmationFeatureOnlyCoverageContextReady: boolean | null;
    consumerAverageSubmitterSafeAvailabilityConfirmationFeatureOnlyCoverageRequiresPreferredPair: boolean | null;
    consumerAverageSubmitterSafeAvailabilityConfirmationChecklistItemIds: string[];
    consumerAverageSubmitterSafeAvailabilityConfirmationMinimumFeaturePairRequired: string[];
    consumerAverageSubmitterSafeAvailabilityConfirmationNextAction: string | null;
    consumerAverageSubmitterSafeAvailabilityConfirmationOutcomeLinkageRequiredForFeatureOnlyContext: boolean | null;
    consumerAverageSubmitterSafeAvailabilityConfirmationReadyForRecipeReadinessChain: boolean | null;
    consumerAverageSubmitterSafeAvailabilityConfirmationRowOwnerAssertionsConfirmed: boolean | null;
    consumerAverageSubmitterSafeAvailabilityConfirmationRowLevelDataAcceptedByR1150: boolean | null;
    consumerAverageSubmitterSafeAvailabilityConfirmationStatus: string | null;
    consumerAverageSubmitterSafeAvailabilityConfirmationTemplateArtifact: string | null;
    consumerAverageSubmitterSafeAvailabilityConfirmationFeatureOnlyTemplateArtifact: string | null;
    consumerAverageSubmitterFeatureOnlyModeArtifact: string | null;
    consumerAverageSubmitterFeatureOnlyModeConclusion: string | null;
    consumerAverageSubmitterFeatureOnlyModeCoverageContextAllowed: boolean | null;
    consumerAverageSubmitterFeatureOnlyModeCoverageRequiresPreferredPair: boolean | null;
    consumerAverageSubmitterFeatureOnlyModeCoverageContextTemplateArtifact: string | null;
    consumerAverageSubmitterFeatureOnlyModeMinimumFeaturePairRequired: string[];
    consumerAverageSubmitterFeatureOnlyModeMissingAttestationKeys: string[];
    consumerAverageSubmitterFeatureOnlyModeMissingEvidenceSourceFamilyIds: string[];
    consumerAverageSubmitterFeatureOnlyModeMissingPrimaryFeatureFamilyIds: string[];
    consumerAverageSubmitterFeatureOnlyModeModelEvidencePromotionAllowed: boolean | null;
    consumerAverageSubmitterFeatureOnlyModeNextAction: string | null;
    consumerAverageSubmitterFeatureOnlyModeOutcomeLinkageRequiredForFeatureOnlyContext: boolean | null;
    consumerAverageSubmitterFeatureOnlyModeOutcomeLinkedEvidenceReady: boolean | null;
    consumerAverageSubmitterFeatureOnlyModePreferredPairReady: boolean | null;
    consumerAverageSubmitterFeatureOnlyModeRowLevelDataAcceptedByR1151: boolean | null;
    consumerAverageSubmitterFeatureOnlyModeSafeAvailabilityFeatureOnlyCoverageContextReady: boolean | null;
    consumerAverageSubmitterFeatureOnlyModeSafeAvailabilityFeatureOnlyReadinessPresent: boolean | null;
    consumerAverageSubmitterFeatureOnlyModeSupportedFeatureFamilyIds: string[];
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeArtifact: string | null;
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeConclusion: string | null;
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeContextStatus: string | null;
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeReadyForResearchPlanning: boolean | null;
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeMinimumFeaturePairRequired: string[];
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeMissingPrimaryFeatureFamilyIds: string[];
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeModelEvidencePromotionAllowed: boolean | null;
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeNextAction: string | null;
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeOutcomeLinkageRequiredForFeatureOnlyContext: boolean | null;
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeR1151ReadyForIntake: boolean | null;
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeRowLevelDataAcceptedByR1152: boolean | null;
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeSupportedFeatureFamilyIds: string[];
    consumerAverageSubmitterFeatureOnlyChainArtifact: string | null;
    consumerAverageSubmitterFeatureOnlyChainConclusion: string | null;
    consumerAverageSubmitterFeatureOnlyChainContextPathConfigured: boolean | null;
    consumerAverageSubmitterFeatureOnlyChainCoverageContextReadyForResearchPlanning: boolean | null;
    consumerAverageSubmitterFeatureOnlyChainCoverageContextAllowed: boolean | null;
    consumerAverageSubmitterFeatureOnlyChainCoverageContextIntakeConclusion: string | null;
    consumerAverageSubmitterFeatureOnlyChainCoverageContextIntakeContextStatus: string | null;
    consumerAverageSubmitterFeatureOnlyChainFeatureOnlyModeConclusion: string | null;
    consumerAverageSubmitterFeatureOnlyChainMinimumFeaturePairRequired: string[];
    consumerAverageSubmitterFeatureOnlyChainMissingCoverageContextPrimaryFeatureFamilyIds: string[];
    consumerAverageSubmitterFeatureOnlyChainMissingFeatureOnlySourceFamilyIds: string[];
    consumerAverageSubmitterFeatureOnlyChainModelEvidencePromotionAllowed: boolean | null;
    consumerAverageSubmitterFeatureOnlyChainNextAction: string | null;
    consumerAverageSubmitterFeatureOnlyChainOutcomeLinkageRequiredForFeatureOnlyContext: boolean | null;
    consumerAverageSubmitterFeatureOnlyChainRowLevelDataAcceptedByR1153: boolean | null;
    consumerAverageSubmitterFeatureOnlyChainSafeAvailabilityFeatureOnlyCoverageContextReady: boolean | null;
    consumerAverageSubmitterFeatureOnlyChainSafeAvailabilityReadyForRecipeReadinessChain: boolean | null;
    consumerAverageSubmitterFeatureOnlyChainSupportedFeatureFamilyIds: string[];
    consumerAverageSubmitterSafeAvailabilityActionPacketArtifact: string | null;
    consumerAverageSubmitterSafeAvailabilityActionPacketCommand: string | null;
    consumerAverageSubmitterSafeAvailabilityActionPacketConclusion: string | null;
    consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyCoverageContextReady: boolean | null;
    consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyQuickstartArtifact: string | null;
    consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount: number | null;
    consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths: string[];
    consumerAverageSubmitterSafeAvailabilityConfirmationIntakeCommand: string | null;
    consumerAverageSubmitterSafeAvailabilityFeatureOnlyChainRunnerCommand: string | null;
    consumerAverageSubmitterSafeAvailabilityOutcomeLinkedRecipeReadinessCommand: string | null;
    consumerAverageSubmitterSafeAvailabilityCompletionModeIds: string[];
    consumerAverageSubmitterSafeAvailabilityActionPacketChecklistItemIds: string[];
    consumerAverageSubmitterSafeAvailabilityActionPacketMinimumFeaturePairRequired: string[];
    consumerAverageSubmitterSafeAvailabilityActionPacketMissingAggregateReadinessFactIds: string[];
    consumerAverageSubmitterSafeAvailabilityActionPacketMissingAttestationKeys: string[];
    consumerAverageSubmitterSafeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds: string[];
    consumerAverageSubmitterSafeAvailabilityActionPacketMissingRequiredSourceFamilyIds: string[];
    consumerAverageSubmitterSafeAvailabilityActionPacketNextAction: string | null;
    consumerAverageSubmitterSafeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain: boolean | null;
    consumerAverageSubmitterSafeAvailabilityActionPacketRowLevelDataAcceptedByR1154: boolean | null;
    consumerAverageSubmitterSafeAvailabilityActionPacketRowOwnerWorkType: string | null;
    consumerAverageSubmitterSafeAvailabilityActionPacketRowParsingPerformedByR1154: boolean | null;
    consumerAverageSubmitterSafeAvailabilityActionPacketTemplateArtifact: string | null;
    consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyTemplateArtifact: string | null;
    consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofArtifact: string | null;
    consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofConclusion: string | null;
    consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofNextAction: string | null;
    consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofFeatureOnlyChainConclusion: string | null;
    consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofFeatureOnlyCoverageContextReadyForResearchPlanning: boolean | null;
    consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofSafeAvailabilityConfirmationConclusion: string | null;
    consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofReadyForRecipeReadinessChain: boolean | null;
    consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofModelEvidencePromotionAllowed: boolean | null;
    consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofRowLevelDataAcceptedByR1155: boolean | null;
    consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofSmokeEvidence: boolean | null;
    consumerAverageSubmitterSafeConfirmationHandoffArtifact: string | null;
    consumerAverageSubmitterSafeConfirmationHandoffCommand: string | null;
    consumerAverageSubmitterSafeConfirmationHandoffConclusion: string | null;
    consumerAverageSubmitterSafeConfirmationHandoffNextAction: string | null;
    consumerAverageSubmitterSafeConfirmationHandoffFeatureOnlyPathMechanicallyProven: boolean | null;
    consumerAverageSubmitterSafeConfirmationHandoffHandoffReadyForRowOwner: boolean | null;
    consumerAverageSubmitterSafeConfirmationHandoffModelEvidencePromotionAllowed: boolean | null;
    consumerAverageSubmitterSafeConfirmationHandoffReadyForModelEvidence: boolean | null;
    consumerAverageSubmitterSafeConfirmationHandoffReadyForRecipeReadinessChain: boolean | null;
    consumerAverageSubmitterSafeConfirmationHandoffRequiredFeatureOnlySourceFamilyIds: string[];
    consumerAverageSubmitterSafeConfirmationHandoffRequiredSafeCompletionCheckIds: string[];
    consumerAverageSubmitterSafeConfirmationHandoffRowLevelDataAcceptedByR1156: boolean | null;
    consumerAverageSubmitterSafeConfirmationHandoffRowOwnerWorkType: string | null;
    consumerAverageSubmitterSafeConfirmationHandoffSafeConfirmationStillRequired: boolean | null;
    consumerAverageSubmitterSafeConfirmationHandoffSmokeEvidence: boolean | null;
    consumerAverageSubmitterSafeConfirmationChainRunnerArtifact: string | null;
    consumerAverageSubmitterSafeConfirmationChainRunnerCommand: string | null;
    consumerAverageSubmitterSafeConfirmationChainRunnerConclusion: string | null;
    consumerAverageSubmitterSafeConfirmationChainRunnerNextAction: string | null;
    consumerAverageSubmitterSafeConfirmationChainRunnerConfirmationPathConfigured: boolean | null;
    consumerAverageSubmitterSafeConfirmationChainRunnerFeatureOnlyCoverageContextReady: boolean | null;
    consumerAverageSubmitterSafeConfirmationChainRunnerFeatureOnlyResearchPlanningReady: boolean | null;
    consumerAverageSubmitterSafeConfirmationChainRunnerReadyForModelEvidence: boolean | null;
    consumerAverageSubmitterSafeConfirmationChainRunnerReadyForRecipeReadinessChain: boolean | null;
    consumerAverageSubmitterSafeConfirmationChainRunnerRowLevelDataAcceptedByR1157: boolean | null;
    consumerAverageSubmitterSafeConfirmationChainRunnerSafeConfirmationStillRequired: boolean | null;
    consumerAverageSubmitterSafeConfirmationFillGuideArtifact: string | null;
    consumerAverageSubmitterSafeConfirmationFillGuideCommand: string | null;
    consumerAverageSubmitterSafeConfirmationFillGuideConclusion: string | null;
    consumerAverageSubmitterSafeConfirmationFillGuideExactSafeFieldEditCount: number | null;
    consumerAverageSubmitterSafeConfirmationFillGuideGuideReadyForRowOwnerFill: boolean | null;
    consumerAverageSubmitterSafeConfirmationFillGuideMinimumFeaturePairRequired: string[];
    consumerAverageSubmitterSafeConfirmationFillGuideNextAction: string | null;
    consumerAverageSubmitterSafeConfirmationFillGuideOptionalAddOnFamilyIds: string[];
    consumerAverageSubmitterSafeConfirmationFillGuideRequiredChecklistIds: string[];
    consumerAverageSubmitterSafeConfirmationFillGuideRequiredInputKindIds: string[];
    consumerAverageSubmitterSafeConfirmationFillGuideRowLevelDataAcceptedByR1158: boolean | null;
    consumerAverageSubmitterSafeConfirmationAnswerSheetArtifact: string | null;
    consumerAverageSubmitterSafeConfirmationAnswerSheetCommand: string | null;
    consumerAverageSubmitterSafeConfirmationAnswerSheetConclusion: string | null;
    consumerAverageSubmitterSafeConfirmationAnswerSheetExactSafeAnswerCount: number | null;
    consumerAverageSubmitterSafeConfirmationAnswerSheetReadyForRowOwner: boolean | null;
    consumerAverageSubmitterSafeConfirmationAnswerSheetMinimumFeaturePairRequired: string[];
    consumerAverageSubmitterSafeConfirmationAnswerSheetNextAction: string | null;
    consumerAverageSubmitterSafeConfirmationAnswerSheetOptionalAddOnFamilyIds: string[];
    consumerAverageSubmitterSafeConfirmationAnswerSheetRequiredChecklistIds: string[];
    consumerAverageSubmitterSafeConfirmationAnswerSheetRequiredInputKindIds: string[];
    consumerAverageSubmitterSafeConfirmationAnswerSheetRowLevelDataAcceptedByR1159: boolean | null;
    consumerAverageSubmitterSafeConfirmationAnswerSheetRowOwnerProvidedValuesStored: boolean | null;
    consumerAverageSubmitterSafeConfirmationTranscriptionProofArtifact: string | null;
    consumerAverageSubmitterSafeConfirmationTranscriptionProofCommand: string | null;
    consumerAverageSubmitterSafeConfirmationTranscriptionProofConclusion: string | null;
    consumerAverageSubmitterSafeConfirmationTranscriptionProofExactSafeTranscriptionStepCount: number | null;
    consumerAverageSubmitterSafeConfirmationTranscriptionProofReadyForRowOwnerConfirmation: boolean | null;
    consumerAverageSubmitterSafeConfirmationTranscriptionProofHypotheticalTranscriptionWouldBeFeatureOnlyReady: boolean | null;
    consumerAverageSubmitterSafeConfirmationTranscriptionProofNextAction: string | null;
    consumerAverageSubmitterSafeConfirmationTranscriptionProofRequiredInputKindIds: string[];
    consumerAverageSubmitterSafeConfirmationTranscriptionProofRowLevelDataAcceptedByR1160: boolean | null;
    consumerAverageSubmitterSafeConfirmationTranscriptionProofRowOwnerConfirmationStillRequired: boolean | null;
    consumerAverageSubmitterSafeConfirmationTranscriptionProofConfirmationValuesStoredByR1160: boolean | null;
    consumerAverageSubmitterSafeConfirmationTranscriptionProofRowOwnerProvidedValuesStored: boolean | null;
    consumerAverageSubmitterSafeConfirmationMaterializerArtifact: string | null;
    consumerAverageSubmitterSafeConfirmationMaterializerCommand: string | null;
    consumerAverageSubmitterSafeConfirmationMaterializerConclusion: string | null;
    consumerAverageSubmitterSafeConfirmationMaterializerNextAction: string | null;
    consumerAverageSubmitterSafeConfirmationMaterializerExplicitRowOwnerConfirmationAssertionProvided: boolean | null;
    consumerAverageSubmitterSafeConfirmationMaterializerSafeConfirmationArtifactWritten: boolean | null;
    consumerAverageSubmitterSafeConfirmationMaterializerSafeConfirmationArtifact: string | null;
    consumerAverageSubmitterSafeConfirmationMaterializerFeatureOnlyConfirmationWouldBeReadyForR1150: boolean | null;
    consumerAverageSubmitterSafeConfirmationMaterializerRowOwnerConfirmationStillRequired: boolean | null;
    consumerAverageSubmitterSafeConfirmationMaterializerConfirmationValuesStoredInR1161Packet: boolean | null;
    consumerAverageSubmitterSafeConfirmationMaterializerRowLevelDataAcceptedByR1161: boolean | null;
    consumerAverageSubmitterSafeConfirmationMaterializerRowOwnerPrivateValuesStored: boolean | null;
    consumerAverageSubmitterSafeConfirmationAssertionHandoffArtifact: string | null;
    consumerAverageSubmitterSafeConfirmationAssertionHandoffCommand: string | null;
    consumerAverageSubmitterSafeConfirmationAssertionHandoffConclusion: string | null;
    consumerAverageSubmitterSafeConfirmationAssertionHandoffNextAction: string | null;
    consumerAverageSubmitterSafeConfirmationAssertionHandoffHandoffReadyForRowOwner: boolean | null;
    consumerAverageSubmitterSafeConfirmationAssertionHandoffRowOwnerAssertionStillRequired: boolean | null;
    consumerAverageSubmitterSafeConfirmationAssertionHandoffExplicitRowOwnerConfirmationAssertionProvided: boolean | null;
    consumerAverageSubmitterSafeConfirmationAssertionHandoffSafeConfirmationArtifactWritten: boolean | null;
    consumerAverageSubmitterSafeConfirmationAssertionHandoffFeatureOnlyConfirmationWouldBeReadyForR1150: boolean | null;
    consumerAverageSubmitterSafeConfirmationAssertionHandoffRequiredInputKindIds: string[];
    consumerAverageSubmitterSafeConfirmationAssertionHandoffRequiredChecklistIds: string[];
    consumerAverageSubmitterSafeConfirmationAssertionHandoffMinimumFeaturePairRequired: string[];
    consumerAverageSubmitterSafeConfirmationAssertionHandoffMaterializerCommand: string | null;
    consumerAverageSubmitterSafeConfirmationAssertionHandoffMaterializerNextAction: string | null;
    consumerAverageSubmitterSafeConfirmationAssertionHandoffConfirmationValuesStoredByR1162: boolean | null;
    consumerAverageSubmitterSafeConfirmationAssertionHandoffRowLevelDataAcceptedByR1162: boolean | null;
    consumerAverageSubmitterSafeConfirmationAssertionHandoffRowOwnerPrivateValuesStored: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerArtifact: string | null;
    consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerCommand: string | null;
    consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerConclusion: string | null;
    consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerNextAction: string | null;
    consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerExplicitRowOwnerAssertionProvided: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerFeatureOnlyResearchPlanningReady: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerFeatureOnlyChainRan: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerRowOwnerAssertionStillRequired: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerConfirmedSafeConfirmationArtifact: string | null;
    consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerSafeConfirmationArtifactWritten: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerRowLevelDataAcceptedByR1163: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerRowOwnerPrivateValuesStored: boolean | null;
    consumerAverageSubmitterFeatureOnlyResearchHandoffArtifact: string | null;
    consumerAverageSubmitterFeatureOnlyResearchHandoffCommand: string | null;
    consumerAverageSubmitterFeatureOnlyResearchHandoffConclusion: string | null;
    consumerAverageSubmitterFeatureOnlyResearchHandoffNextAction: string | null;
    consumerAverageSubmitterFeatureOnlyResearchHandoffFeatureOnlyResearchPlanningReady: boolean | null;
    consumerAverageSubmitterFeatureOnlyResearchHandoffResearchPlanningAllowed: boolean | null;
    consumerAverageSubmitterFeatureOnlyResearchHandoffOutcomeLinkedModelEvidenceStillRequired: boolean | null;
    consumerAverageSubmitterFeatureOnlyResearchHandoffPrioritizedInputKindIds: string[];
    consumerAverageSubmitterFeatureOnlyResearchHandoffMinimumFeaturePairRequired: string[];
    consumerAverageSubmitterFeatureOnlyResearchHandoffRowLevelDataAcceptedByR1164: boolean | null;
    consumerAverageSubmitterFeatureOnlyResearchHandoffRowOwnerPrivateValuesStored: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerArtifact: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerCommand: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerConclusion: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerNextAction: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerAssertionAccepted: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerAssertionProvided: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerAssertionTemplateArtifact: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerChildR1163Ran: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerFeatureOnlyResearchPlanningReady: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerRequiredInputKindIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerRequiredAssertionChecklistIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerOptionalAddOnFamilyIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerValidationReasonIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerRowLevelDataAcceptedByR1165: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerRowOwnerPrivateValuesStored: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideArtifact: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideCommand: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideConclusion: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideNextAction: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideGuideReadyForRowOwnerFill: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideRequiredInputKindIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideOptionalAddOnFamilyIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideSafeFieldEditCount: number | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideSafeFieldEditPaths: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideRowLevelDataAcceptedByR1167: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideRowOwnerPrivateValuesStored: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetArtifact: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetCommand: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetConclusion: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetNextAction: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetReadyForRowOwner: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetMaterializerReady: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetMaterializerExplicitConfirmationRequired: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetExactSafeAnswerCount: number | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetAllowedValueKindIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetBlockedAssertionContentIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetRequiredInputKindIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetRequiredAssertionChecklistIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetSafeFieldEditPaths: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetRowLevelDataAcceptedByR1173: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetRowOwnerProvidedValuesStored: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketArtifact: string | null;
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketCommand: string | null;
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketAllowedValueKindIds: string[];
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketBlockedContentIds: string[];
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketConclusion: string | null;
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketNextAction: string | null;
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForRowOwnerR1172Confirmation: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForRowOwnerR1176LiveChainConfirmation: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketR1176LiveChainCommand: string | null;
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForR1165Runner: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketExactSafeFieldEditCount: number | null;
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketRowLevelDataAcceptedByR1174: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketRowOwnerProvidedValuesStored: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerArtifact: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerCommand: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerConclusion: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerNextAction: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerExplicitRowOwnerAssertionProvided: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerArtifactWritten: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerRowOwnerAssertionStillRequired: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerWouldBeAcceptedByR1165: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerR1165RunnerReady: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerR1165TemplateReady: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerR1167FillGuideReady: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerAllowedValueKindIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerBlockedContentIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerSafeFieldEditCount: number | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerSafeFieldEditPaths: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerRowLevelDataAcceptedByR1172: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerRowOwnerPrivateValuesStored: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofArtifact: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofCommand: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofConclusion: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofNextAction: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofPassed: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofSynthetic: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofRealEvidenceProduced: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofModelEvidencePromotionAllowed: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofLiveChainGateStillRequired: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofR1165AssertionAccepted: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofR1165ChildR1163Ran: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofR1165FeatureOnlyResearchPlanningReady: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofSafeFieldEditCount: number | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofSafeFieldEditPaths: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofRowLevelDataAcceptedByR1170: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofRowOwnerPrivateValuesStored: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeArtifact: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeCommand: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeAllowedValueKindIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeBlockedContentIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeOptionalAddOnFamilyIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeConclusion: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeNextAction: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokePassed: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeSynthetic: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeRealEvidenceProduced: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeModelEvidencePromotionAllowed: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeLiveChainGateStillRequired: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1172MaterializedAssertionWritten: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1172WouldBeAcceptedByR1165: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1165AssertionAccepted: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1165ChildR1163Ran: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1165FeatureOnlyResearchPlanningReady: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1163FeatureOnlyResearchPlanningReady: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeSafeFieldEditCount: number | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeSafeFieldEditPaths: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeRowLevelDataAcceptedByR1175: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeRowOwnerPrivateValuesStored: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeRowParsingPerformedByR1175: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainArtifact: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainCommand: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainAllowedValueKindIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainBlockedContentIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainOptionalAddOnFamilyIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainCompletionModeId: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainConclusion: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainNextAction: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainReady: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainExplicitRowOwnerAssertionProvided: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainFeatureOnlyResearchPlanningReady: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRealEvidenceProduced: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainModelEvidencePromotionAllowed: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainOutcomeLinkedModelEvidenceStillRequired: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowOwnerAssertionStillRequired: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowOwnerHandoffReasonId: string | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1172MaterializedAssertionWritten: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1172WouldBeAcceptedByR1165: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1165AssertionAccepted: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1165ChildR1163Ran: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1165FeatureOnlyResearchPlanningReady: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1163FeatureOnlyResearchPlanningReady: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainSafeFieldEditCount: number | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainSafeFieldEditPaths: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainSafeCompletionChecklistItemIds: string[];
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowLevelDataAcceptedByR1176: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowOwnerPrivateValuesStored: boolean | null;
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowParsingPerformedByR1176: boolean | null;
    consumerAverageSubmitterSafeResponseSmokeProofArtifact: string | null;
    consumerAverageSubmitterSafeResponseSmokeProofCommand: string | null;
    consumerAverageSubmitterSafeResponseSmokeProofConclusion: string | null;
    consumerAverageSubmitterSafeResponseSmokeProofLiveR1184Conclusion: string | null;
    consumerAverageSubmitterSafeResponseSmokeProofLiveR1184ReadyForSyntheticSmoke: boolean | null;
    consumerAverageSubmitterSafeResponseSmokeProofNextRealAction: string | null;
    consumerAverageSubmitterSafeResponseSmokeProofNextRealActionCommand: string | null;
    consumerAverageSubmitterSafeResponseSmokeProofNextRealActionRequiresExplicitRowOwnerAssertion: boolean | null;
    consumerAverageSubmitterSafeResponseSmokeProofMinimumFeaturePairRequired: string[];
    consumerAverageSubmitterSafeResponseSmokeProofPrioritizedInputKindIds: string[];
    consumerAverageSubmitterSafeResponseSmokeProofRequiredResponseFieldIds: string[];
    consumerAverageSubmitterSafeResponseSmokeProofSafeExecutionFeatureSlotIds: string[];
    consumerAverageSubmitterSafeResponseSmokeProofSyntheticPathAdvancedToFeatureOnlyResearchPlanning: boolean | null;
    consumerAverageSubmitterSafeResponseSmokeProofSyntheticSmokeRan: boolean | null;
    consumerAverageSubmitterSafeResponseSmokeProofModelEvidencePromotionAllowed: boolean | null;
    consumerAverageSubmitterSafeResponseSmokeProofProductDisplayAuthorized: boolean | null;
    consumerAverageSubmitterSafeResponseSmokeProofRowLevelDataAcceptedByR1185: boolean | null;
    consumerAverageSubmitterSafeResponseSmokeProofRowOwnerConfirmationInferredByR1185: boolean | null;
    consumerAverageSubmitterSafeResponseSmokeProofRowOwnerPrivateValuesStored: boolean | null;
    consumerAverageSubmitterSafeResponseSmokeProofRowParsingPerformedByR1185: boolean | null;
    consumerAverageSubmitterSafeResponseSmokeProofLiveArtifactsMutatedByR1185: boolean | null;
    consumerAverageSubmitterMissingSlotCount: number | null;
    consumerAverageSubmitterMissingSlotTypes: string[];
    consumerAverageSubmitterNextAction: string | null;
    consumerAverageSubmitterReadinessArtifact: string | null;
    consumerAverageSubmitterReadinessConclusion: string | null;
    consumerAverageSubmitterReadyForPrivateRunner: boolean | null;
    consumerAverageSubmitterRealAggregateStillMissing: boolean | null;
    consumerAverageSubmitterSourceFamilyMissingSlotRollup: SourceFamilyMissingSlotRollup[];
    consumerFirstPassAggregateMetricsTemplateArtifact: string | null;
    consumerOrdinarySubmissionHandoffPlanArtifact: string | null;
    consumerOrdinarySourceFamilyIds: string[];
    consumerOrdinaryTableLayouts: string[];
    consumerPipelineSmokeConclusion: string | null;
    consumerPipelineSmokeSyntheticEvidence: false | null;
    consumerPipelineSmokeTableLayouts: string[];
    consumerPrivateRunnerNextAction: string | null;
    consumerRealEvidenceGateBlockers: string[];
    consumerRealEvidenceGateConclusion: string | null;
    consumerRealEvidenceGateNextAction: string | null;
    consumerRealEvidenceHandoffArtifact: string | null;
    consumerRealEvidenceHandoffBlockers: string[];
    consumerRealEvidenceHandoffMissingConfigChecklistCount: number | null;
    consumerRealEvidenceHandoffMissingConfigChecklistSlotTypes: string[];
    consumerRealEvidenceHandoffConclusion: string | null;
    consumerRealEvidenceHandoffMissingConfigPieces: MissingConfigPieces | null;
    consumerRealEvidenceHandoffNextAction: string | null;
    consumerRealEvidenceHandoffPrivateConfigReadiness: string | null;
    consumerRealEvidenceHandoffRowOwnerWorkType: string | null;
  };
}

export async function runR1076CurrentAutoresearchLoopExecutor(
  options: R1076CurrentAutoresearchLoopExecutorOptions = {},
): Promise<{ output: R1076CurrentAutoresearchLoopExecutorOutput; outputPath: string }> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const r1081 = options.aggregateReceiptPath
    ? null
    : await runOptionalR1081({
        analyticCachePath: options.nsrrSleepAutonomicAnalyticCachePath,
        candidateDraftPath: options.nsrrSourceCandidateDraftPath,
        manifestPath: options.nsrrSleepAutonomicStandardizerManifestPath,
        outputDir,
        scanRoots: options.scanRoots,
      });
  const r1079 = options.aggregateReceiptPath
    ? null
    : await runOptionalR1079({
        analyticCachePath: options.nsrrSleepAutonomicAnalyticCachePath,
        createdAt: options.createdAt,
        manifestPath: options.nsrrSleepAutonomicStandardizerManifestPath,
        outputDir,
      });
  const r1078 = options.aggregateReceiptPath
    ? null
    : await runOptionalR1078({
        analyticCachePath: options.nsrrSleepAutonomicAnalyticCachePath,
        createdAt: options.createdAt,
        outputDir,
        r1079,
      });
  const r1074 = await runR1074TrueWearablePostDownloadRefresh({
    aggregateReceiptPath: options.aggregateReceiptPath ?? r1078?.r1070ReceiptPath,
    createdAt: options.createdAt,
    outputDir,
    r1059Path: options.r1059Path,
    r1061Path: options.r1061Path,
    r1062Path: options.r1062Path,
    scanRoots: options.scanRoots,
  });
  const r1077 = await runR1077NsrrSourceRouteAlignment({
    createdAt: options.createdAt,
    outputDir,
    r1073Path: path.join(outputDir, "r1073-nsrr-derived-cohort-readiness-intake.latest.json"),
  });
  const r1083 = await runR1083FunctionMissingnessCalibrationAdjudication({
    aggregatePacketPath: options.r1083AggregatePacketPath,
    createdAt: options.createdAt,
    outputDir,
    reducerPath: options.r1083ReducerPath,
  });
  const r1084 = await runR1084HaalsiFunctionMissingnessCalibrationAdjudication({
    createdAt: options.createdAt,
    outputDir,
    r1044Path: options.r1084HaalsiPath,
  });
  const r1075 = await runR1075CurrentAutoresearchActionRouter({
    createdAt: options.createdAt,
    outputDir,
    r1057Path: options.r1057Path,
    r1074Path: r1074.outputPath,
    r1083Path: r1083.outputPath,
    r1084Path: r1084.outputPath,
    r1101Path: options.r1101Path,
  });
  const r1128 = await readJsonIfPresent(options.r1128Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1128_EXPECTED.artifact));
  validateOptionalInputBoundary("r1128", r1128);
  const r1128Expected = r1128MatchesExpected(r1128);
  const consumerPipelineSmokeConclusion = r1128Expected
    ? readStringAt(r1128, ["summary", "conclusion"])
    : null;
  const consumerPipelineSmokeSyntheticEvidence = r1128Expected
    && readBooleanAt(r1128, ["summary", "syntheticEvidence"]) === false
    ? false
    : null;
  const consumerPipelineSmokeTableLayouts = r1128Expected
    ? readStringArrayAt(r1128, ["smokeProof", "ordinaryTableLayoutsSmokePassed"])
    : [];
  const r1129 = await readJsonIfPresent(options.r1129Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1129_EXPECTED.artifact));
  validateOptionalInputBoundary("r1129", r1129);
  const r1129Expected = r1129MatchesExpected(r1129);
  const consumerRealEvidenceGateConclusion = r1129Expected
    ? readStringAt(r1129, ["summary", "conclusion"])
    : null;
  const consumerRealEvidenceGateNextAction = r1129Expected
    ? readStringAt(r1129, ["summary", "nextAction"])
    : null;
  const consumerRealEvidenceGateBlockers = r1129Expected
    ? readStringArrayAt(r1129, ["realEvidenceGate", "blockers"])
    : [];
  const r1130 = await readJsonIfPresent(options.r1130Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1130_EXPECTED.artifact));
  validateOptionalInputBoundary("r1130", r1130);
  const r1130Expected = r1130MatchesExpected(r1130);
  const consumerRealEvidenceHandoffArtifact = r1130Expected ? R1130_EXPECTED.artifact : null;
  const consumerRealEvidenceHandoffConclusion = r1130Expected
    ? readStringAt(r1130, ["summary", "conclusion"])
    : null;
  const consumerRealEvidenceHandoffNextAction = r1130Expected
    ? readStringAt(r1130, ["summary", "nextAction"])
    : null;
  const consumerRealEvidenceHandoffRowOwnerWorkType = r1130Expected
    ? readStringAt(r1130, ["summary", "rowOwnerWorkType"])
    : null;
  const consumerRealEvidenceHandoffPrivateConfigReadiness = r1130Expected
    ? readStringAt(r1130, [
        "realEvidenceHandoff",
        "currentPrivateConfig",
        "readiness",
      ])
    : null;
  const consumerRealEvidenceHandoffBlockers = r1130Expected
    ? readStringArrayAt(r1130, ["realEvidenceHandoff", "blockers"])
    : [];
  const missingConfigChecklist = r1130Expected
    ? readArrayAt(r1130, ["realEvidenceHandoff", "missingConfigChecklist"])
    : [];
  const consumerRealEvidenceHandoffMissingConfigChecklistCount = r1130Expected
    ? missingConfigChecklist.length
    : null;
  const consumerRealEvidenceHandoffMissingConfigChecklistSlotTypes = Array.from(
    new Set(
      missingConfigChecklist
        .map((item) => readStringAt(item, ["slotType"]))
        .filter((slotType): slotType is string => slotType !== null),
    ),
  );
  const consumerRealEvidenceHandoffMissingConfigPieces = r1130Expected
    ? {
        firstPassCandidateIds: readStringArrayAt(r1130, [
          "realEvidenceHandoff",
          "currentPrivateConfig",
          "missingFirstPassCandidateIds",
        ]),
        semanticRefFamilies: readStringArrayAt(r1130, [
          "realEvidenceHandoff",
          "currentPrivateConfig",
          "missingSemanticRefFamilies",
        ]),
        submissionContextFields: readStringArrayAt(r1130, [
          "realEvidenceHandoff",
          "currentPrivateConfig",
          "missingSubmissionContextFields",
        ]),
        tableRefs: readStringArrayAt(r1130, [
          "realEvidenceHandoff",
          "currentPrivateConfig",
          "missingTableRefs",
        ]),
      }
    : null;
  const r1132 = await readJsonIfPresent(options.r1132Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1132_EXPECTED.artifact));
  validateOptionalInputBoundary("r1132", r1132);
  const r1132Expected = r1132MatchesExpected(r1132);
  const consumerAverageSubmitterReadinessArtifact = r1132Expected ? R1132_EXPECTED.artifact : null;
  const consumerAverageSubmitterReadinessConclusion = r1132Expected
    ? readStringAt(r1132, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterNextAction = r1132Expected
    ? readStringAt(r1132, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterFamilyIds = r1132Expected
    ? readStringArrayAt(r1132, ["summary", "averageSubmitterFamilyIds"])
    : [];
  const consumerAverageSubmitterMissingSlotCount = r1132Expected
    ? readNumberAt(r1132, ["summary", "missingSlotCount"])
    : null;
  const consumerAverageSubmitterMissingSlotTypes = r1132Expected
    ? readStringArrayAt(r1132, ["summary", "missingSlotTypes"])
    : [];
  const consumerAverageSubmitterReadyForPrivateRunner = r1132Expected
    ? readBooleanAt(r1132, ["summary", "readyForPrivateRunner"])
    : null;
  const consumerAverageSubmitterRealAggregateStillMissing = r1132Expected
    ? readBooleanAt(r1132, ["summary", "realAggregateStillMissing"])
    : null;
  const consumerAverageSubmitterSourceFamilyMissingSlotRollup = r1132Expected
    ? sourceFamilyMissingSlotRollupFor(r1132)
    : [];
  const r1133 = await readJsonIfPresent(options.r1133Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1133_EXPECTED.artifact));
  validateOptionalInputBoundary("r1133", r1133);
  const r1133Expected = r1133MatchesExpected(r1133);
  const consumerAverageSubmitterAvailabilityPreflightArtifact = r1133Expected ? R1133_EXPECTED.artifact : null;
  const consumerAverageSubmitterAvailabilityConclusion = r1133Expected
    ? readStringAt(r1133, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterAvailabilityNextAction = r1133Expected
    ? readStringAt(r1133, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterAvailabilityManifestStatus = r1133Expected
    ? readStringAt(r1133, ["summary", "manifestStatus"])
    : null;
  const consumerAverageSubmitterAvailabilityMissingSourceFamilyIds = r1133Expected
    ? readStringArrayAt(r1133, ["summary", "missingSourceFamilyIds"])
    : [];
  const consumerAverageSubmitterAvailabilityReadyForPrivateConfigMapping = r1133Expected
    ? readBooleanAt(r1133, ["summary", "readyForPrivateConfigMapping"])
    : null;
  const r1134 = await readJsonIfPresent(options.r1134Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1134_EXPECTED.artifact));
  validateOptionalInputBoundary("r1134", r1134);
  const r1134Expected = r1134MatchesExpected(r1134);
  const consumerAverageSubmitterConfigBridgeArtifact = r1134Expected ? R1134_EXPECTED.artifact : null;
  const consumerAverageSubmitterConfigBridgeConclusion = r1134Expected
    ? readStringAt(r1134, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterConfigBridgeNextAction = r1134Expected
    ? readStringAt(r1134, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterConfigBridgeMappingPlanStatus = r1134Expected
    ? readStringAt(r1134, ["summary", "mappingPlanStatus"])
    : null;
  const consumerAverageSubmitterConfigBridgeReadyForPrivateConfigMapping = r1134Expected
    ? readBooleanAt(r1134, ["summary", "readyForPrivateConfigMapping"])
    : null;
  const consumerAverageSubmitterConfigBridgeSelectedTableLayout = r1134Expected
    ? readStringAt(r1134, ["summary", "selectedTableLayout"])
    : null;
  const consumerAverageSubmitterConfigBridgeAvailableSourceFamilyIds = r1134Expected
    ? readStringArrayAt(r1134, ["availabilityConfigBridge", "availableSourceFamilyIds"])
    : [];
  const r1135 = await readJsonIfPresent(options.r1135Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1135_EXPECTED.artifact));
  validateOptionalInputBoundary("r1135", r1135);
  const r1135Expected = r1135MatchesExpected(r1135);
  const consumerAverageSubmitterManifestPacketArtifact = r1135Expected ? R1135_EXPECTED.artifact : null;
  const consumerAverageSubmitterManifestPacketConclusion = r1135Expected
    ? readStringAt(r1135, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterManifestPacketNextAction = r1135Expected
    ? readStringAt(r1135, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterManifestPacketReadyForPrivateConfigMapping = r1135Expected
    ? readBooleanAt(r1135, ["summary", "readyForPrivateConfigMapping"])
    : null;
  const consumerAverageSubmitterManifestPacketPrimaryInputFamilyIds = r1135Expected
    ? readStringArrayAt(r1135, ["summary", "primarySubmitterInputFamilyIds"])
    : [];
  const consumerAverageSubmitterManifestPacketPartialPrivateChainRunnerCommand = r1135Expected
    ? readStringAt(r1135, ["summary", "partialPrivateChainRunnerCommand"])
    : null;
  const consumerAverageSubmitterManifestPacketPartialRouteRecipeIds = r1135Expected
    ? readStringArrayAt(r1135, ["summary", "partialRouteManifestRecipeIds"])
    : [];
  const consumerAverageSubmitterManifestPacketPreferredRecipeIds = r1135Expected
    ? readStringArrayAt(r1135, ["summary", "preferredManifestRecipeIds"])
    : [];
  const consumerAverageSubmitterManifestPacketRequiredLinkageFamilyIds = r1135Expected
    ? readStringArrayAt(r1135, ["summary", "requiredLinkageFamilyIds"])
    : [];
  const consumerAverageSubmitterManifestPacketMatchedRecipeIds = r1135Expected
    ? readStringArrayAt(r1135, ["summary", "matchedManifestRecipeIds"])
    : [];
  const consumerAverageSubmitterManifestPacketSafeManifestAttestationsComplete = r1135Expected
    ? readBooleanAt(r1135, ["summary", "safeManifestAttestationsComplete"])
    : null;
  const consumerAverageSubmitterManifestPacketMaterializerCommand = r1135Expected
    ? readStringAt(r1135, ["summary", "manifestRecipeMaterializerCommand"])
    : null;
  const consumerAverageSubmitterManifestPacketRecipeReadinessChainCommand = r1135Expected
    ? readStringAt(r1135, ["summary", "recipeReadinessChainRunnerCommand"])
    : null;
  const r1136 = await readJsonIfPresent(options.r1136Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1136_EXPECTED.artifact));
  validateOptionalInputBoundary("r1136", r1136);
  const r1136Expected = r1136MatchesExpected(r1136);
  const consumerAverageSubmitterAvailabilityChainArtifact = r1136Expected ? R1136_EXPECTED.artifact : null;
  const consumerAverageSubmitterAvailabilityChainConclusion = r1136Expected
    ? readStringAt(r1136, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterAvailabilityChainNextAction = r1136Expected
    ? readStringAt(r1136, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterAvailabilityChainManifestSupplied = r1136Expected
    ? readBooleanAt(r1136, ["summary", "manifestSuppliedToRunner"])
    : null;
  const consumerAverageSubmitterAvailabilityChainReadyForPrivateConfigMapping = r1136Expected
    ? readBooleanAt(r1136, ["summary", "readyForPrivateConfigMapping"])
    : null;
  const r1137 = await readJsonIfPresent(options.r1137Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1137_EXPECTED.artifact));
  validateOptionalInputBoundary("r1137", r1137);
  const r1137Expected = r1137MatchesExpected(r1137);
  const consumerAverageSubmitterPartialRoutePlannerArtifact = r1137Expected ? R1137_EXPECTED.artifact : null;
  const consumerAverageSubmitterPartialRoutePlannerConclusion = r1137Expected
    ? readStringAt(r1137, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterPartialRoutePlannerNextAction = r1137Expected
    ? readStringAt(r1137, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterPartialRoutePlannerFullRouteReady = r1137Expected
    ? readBooleanAt(r1137, ["summary", "fullSupportedRouteReady"])
    : null;
  const consumerAverageSubmitterPartialRoutePlannerReadyForPrivateConfigMapping = r1137Expected
    ? readBooleanAt(r1137, ["summary", "readyForPrivateConfigMapping"])
    : null;
  const consumerAverageSubmitterPartialRoutePlannerReadyUnsupportedRouteIds = r1137Expected
    ? readStringArrayAt(r1137, ["summary", "partialRouteIdsReadyButUnsupported"])
    : [];
  const r1138 = await readJsonIfPresent(options.r1138Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1138_EXPECTED.artifact));
  validateOptionalInputBoundary("r1138", r1138);
  const r1138Expected = r1138MatchesExpected(r1138);
  const consumerAverageSubmitterPartialMetricIntakeArtifact = r1138Expected ? R1138_EXPECTED.artifact : null;
  const consumerAverageSubmitterPartialMetricIntakeConclusion = r1138Expected
    ? readStringAt(r1138, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterPartialMetricIntakeNextAction = r1138Expected
    ? readStringAt(r1138, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterPartialMetricIntakeReadyRouteIds = r1138Expected
    ? readStringArrayAt(r1138, ["summary", "readyPartialRouteIds"])
    : [];
  const consumerAverageSubmitterPartialMetricIntakeTemplateArtifact = r1138Expected
    ? readStringAt(r1138, ["summary", "partialAggregateMetricsTemplateArtifact"])
    : null;
  const r1139 = await readJsonIfPresent(options.r1139Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1139_EXPECTED.artifact));
  validateOptionalInputBoundary("r1139", r1139);
  const r1139Expected = r1139MatchesExpected(r1139);
  const consumerAverageSubmitterPartialPrivateConfigHandoffArtifact = r1139Expected ? R1139_EXPECTED.artifact : null;
  const consumerAverageSubmitterPartialPrivateConfigHandoffConclusion = r1139Expected
    ? readStringAt(r1139, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterPartialPrivateConfigHandoffNextAction = r1139Expected
    ? readStringAt(r1139, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterPartialPrivateConfigHandoffEligibleRouteIds = r1139Expected
    ? readStringArrayAt(r1139, ["summary", "eligiblePartialRouteIds"])
    : [];
  const consumerAverageSubmitterPartialPrivateConfigHandoffReadyMetricRouteIds = r1139Expected
    ? readStringArrayAt(r1139, ["summary", "readyPartialMetricRouteIds"])
    : [];
  const consumerAverageSubmitterPartialPrivateConfigHandoffTemplateArtifact = r1139Expected
    ? readStringAt(r1139, ["summary", "partialPrivateConfigTemplateArtifact"])
    : null;
  const consumerAverageSubmitterPartialPrivateConfigHandoffRequiredFieldRefFamilies = r1139Expected
    ? readStringArrayAt(r1139, ["summary", "requiredPrivateFieldRefFamilies"])
    : [];
  const consumerAverageSubmitterPartialPrivateConfigHandoffRequiredTableRefs = r1139Expected
    ? readStringArrayAt(r1139, ["summary", "requiredPrivateTableRefs"])
    : [];
  const consumerAverageSubmitterPartialPrivateConfigHandoffFullEvidenceGateCleared = r1139Expected
    ? readBooleanAt(r1139, ["summary", "fullEvidenceGateCleared"])
    : null;
  const r1140 = await readJsonIfPresent(options.r1140Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1140_EXPECTED.artifact));
  validateOptionalInputBoundary("r1140", r1140);
  const r1140Expected = r1140MatchesExpected(r1140);
  const consumerAverageSubmitterPartialReadinessChainArtifact = r1140Expected ? R1140_EXPECTED.artifact : null;
  const consumerAverageSubmitterPartialReadinessChainConclusion = r1140Expected
    ? readStringAt(r1140, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterPartialReadinessChainNextAction = r1140Expected
    ? readStringAt(r1140, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterPartialReadinessChainEligibleRouteIds = r1140Expected
    ? readStringArrayAt(r1140, ["summary", "eligiblePartialRouteIds"])
    : [];
  const consumerAverageSubmitterPartialReadinessChainReadyMetricRouteIds = r1140Expected
    ? readStringArrayAt(r1140, ["summary", "readyPartialMetricRouteIds"])
    : [];
  const consumerAverageSubmitterPartialReadinessChainTemplateArtifact = r1140Expected
    ? readStringAt(r1140, ["summary", "partialPrivateConfigTemplateArtifact"])
    : null;
  const consumerAverageSubmitterPartialReadinessChainRequiredFieldRefFamilies = r1140Expected
    ? readStringArrayAt(r1140, ["summary", "requiredPrivateFieldRefFamilies"])
    : [];
  const consumerAverageSubmitterPartialReadinessChainRequiredTableRefs = r1140Expected
    ? readStringArrayAt(r1140, ["summary", "requiredPrivateTableRefs"])
    : [];
  const consumerAverageSubmitterPartialReadinessChainFullEvidenceGateCleared = r1140Expected
    ? readBooleanAt(r1140, ["summary", "fullEvidenceGateCleared"])
    : null;
  const consumerAverageSubmitterPartialReadinessChainManifestSupplied = r1140Expected
    ? readBooleanAt(r1140, ["summary", "manifestSuppliedToRunner"])
    : null;
  const r1141 = await readJsonIfPresent(options.r1141Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1141_EXPECTED.artifact));
  validateOptionalInputBoundary("r1141", r1141);
  const r1141Expected = r1141MatchesExpected(r1141);
  const consumerAverageSubmitterPartialPrivateMetricRunnerArtifact = r1141Expected ? R1141_EXPECTED.artifact : null;
  const consumerAverageSubmitterPartialPrivateMetricRunnerConclusion = r1141Expected
    ? readStringAt(r1141, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterPartialPrivateMetricRunnerNextAction = r1141Expected
    ? readStringAt(r1141, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterPartialPrivateMetricRunnerAggregateMetricsArtifact = r1141Expected
    ? readStringAt(r1141, ["summary", "aggregateMetricsArtifact"])
    : null;
  const consumerAverageSubmitterPartialPrivateMetricRunnerRouteMetricsReadyForR1138 = r1141Expected
    ? readBooleanAt(r1141, ["summary", "routeMetricsReadyForR1138"])
    : null;
  const consumerAverageSubmitterPartialPrivateMetricRunnerEligibleRouteIds = r1141Expected
    ? readStringArrayAt(r1141, ["partialPrivateExecution", "eligiblePartialRouteIds"])
    : [];
  const consumerAverageSubmitterPartialPrivateMetricRunnerRequestedRouteIds = r1141Expected
    ? readStringArrayAt(r1141, ["partialPrivateExecution", "requestedPartialRouteIds"])
    : [];
  const consumerAverageSubmitterPartialPrivateMetricRunnerExecutedRouteIds = r1141Expected
    ? readStringArrayAt(r1141, ["summary", "executedPartialRouteIds"])
    : [];
  const r1142 = await readJsonIfPresent(options.r1142Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1142_EXPECTED.artifact));
  validateOptionalInputBoundary("r1142", r1142);
  const r1142Expected = r1142MatchesExpected(r1142);
  const consumerAverageSubmitterPartialPrivateChainArtifact = r1142Expected ? R1142_EXPECTED.artifact : null;
  const consumerAverageSubmitterPartialPrivateChainConclusion = r1142Expected
    ? readStringAt(r1142, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterPartialPrivateChainNextAction = r1142Expected
    ? readStringAt(r1142, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterPartialPrivateChainAggregateMetricsArtifact = r1142Expected
    ? readStringAt(r1142, ["summary", "aggregateMetricsArtifact"])
    : null;
  const consumerAverageSubmitterPartialPrivateChainRouteMetricsReadyForR1138 = r1142Expected
    ? readBooleanAt(r1142, ["summary", "routeMetricsReadyForR1138"])
    : null;
  const consumerAverageSubmitterPartialPrivateChainFullEvidenceGateCleared = r1142Expected
    ? readBooleanAt(r1142, ["summary", "fullEvidenceGateCleared"])
    : null;
  const consumerAverageSubmitterPartialPrivateChainFullSupportedRouteReady = r1142Expected
    ? readBooleanAt(r1142, ["summary", "fullSupportedRouteReady"])
    : null;
  const consumerAverageSubmitterPartialPrivateChainEligibleRouteIds = r1142Expected
    ? readStringArrayAt(r1142, ["summary", "eligiblePartialRouteIds"])
    : [];
  const consumerAverageSubmitterPartialPrivateChainExecutedRouteIds = r1142Expected
    ? readStringArrayAt(r1142, ["summary", "executedPartialRouteIds"])
    : [];
  const consumerAverageSubmitterPartialPrivateChainFinalReadyRouteIds = r1142Expected
    ? readStringArrayAt(r1142, ["summary", "finalReadyPartialMetricRouteIds"])
    : [];
  const r1145 = await readJsonIfPresent(options.r1145Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1145_EXPECTED.artifact));
  validateOptionalInputBoundary("r1145", r1145);
  const r1145Expected = r1145MatchesExpected(r1145);
  const consumerAverageSubmitterCompletionAuditArtifact = r1145Expected ? R1145_EXPECTED.artifact : null;
  const consumerAverageSubmitterCompletionAuditBlockers = r1145Expected
    ? readStringArrayAt(r1145, ["completionAudit", "blockers"])
    : [];
  const consumerAverageSubmitterCompletionAuditConclusion = r1145Expected
    ? readStringAt(r1145, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterCompletionAuditGoalAchieved = r1145Expected
    ? readBooleanAt(r1145, ["summary", "goalAchieved"])
    : null;
  const consumerAverageSubmitterCompletionAuditMissingRequirementIds = r1145Expected
    ? readStringArrayAt(r1145, ["completionAudit", "missingRequirementIds"])
    : [];
  const consumerAverageSubmitterCompletionAuditNextAction = r1145Expected
    ? readStringAt(r1145, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterCompletionAuditUnblockerBlockedRequirementIds = r1145Expected
    ? readStringArrayAt(r1145, ["summary", "completionUnblockerBlockedRequirementIds"])
    : [];
  const consumerAverageSubmitterCompletionAuditUnblockerBlockedStepIds = r1145Expected
    ? readStringArrayAt(r1145, ["summary", "completionUnblockerBlockedStepIds"])
    : [];
  const consumerAverageSubmitterCompletionAuditUnblockerCommandCount = r1145Expected
    ? readNumberAt(r1145, ["summary", "completionUnblockerCommandCount"])
    : null;
  const consumerAverageSubmitterCompletionAuditUnblockerStepIds = r1145Expected
    ? readStringArrayAt(r1145, ["summary", "completionUnblockerStepIds"])
    : [];
  const consumerAverageSubmitterCompletionAuditUnblockerTopAllowedValueKindIds = r1145Expected
    ? readStringArrayAt(r1145, ["summary", "completionUnblockerTopAllowedValueKindIds"])
    : [];
  const consumerAverageSubmitterCompletionAuditUnblockerTopBlockedContentIds = r1145Expected
    ? readStringArrayAt(r1145, ["summary", "completionUnblockerTopBlockedContentIds"])
    : [];
  const consumerAverageSubmitterCompletionAuditUnblockerTopCommand = r1145Expected
    ? readStringAt(r1145, ["summary", "completionUnblockerTopCommand"])
    : null;
  const consumerAverageSubmitterCompletionAuditUnblockerTopNextAction = r1145Expected
    ? readStringAt(r1145, ["summary", "completionUnblockerTopNextAction"])
    : null;
  const consumerAverageSubmitterCompletionAuditUnblockerTopRequirementId = r1145Expected
    ? readStringAt(r1145, ["summary", "completionUnblockerTopRequirementId"])
    : null;
  const consumerAverageSubmitterCompletionAuditUnblockerTopRequiredInputKindIds = r1145Expected
    ? readStringArrayAt(r1145, ["summary", "completionUnblockerTopRequiredInputKindIds"])
    : [];
  const consumerAverageSubmitterCompletionAuditUnblockerTopSafeCompletionChecklistItemIds = r1145Expected
    ? readStringArrayAt(r1145, ["summary", "completionUnblockerTopSafeCompletionChecklistItemIds"])
    : [];
  const consumerAverageSubmitterCompletionAuditUnblockerTopStepId = r1145Expected
    ? readStringAt(r1145, ["summary", "completionUnblockerTopStepId"])
    : null;
  const consumerAverageSubmitterCompletionAuditProductDisplayAuthorized = r1145Expected
    ? readBooleanAt(r1145, ["summary", "productDisplayAuthorized"])
    : null;
  const consumerAverageSubmitterCompletionAuditReadyToMarkComplete = r1145Expected
    ? readBooleanAt(r1145, ["summary", "readyToMarkComplete"])
    : null;
  const consumerAverageSubmitterCompletionAuditTopMissingRequirement = r1145Expected
    ? readStringAt(r1145, ["summary", "topMissingRequirement"])
    : null;
  const r1146 = await readJsonIfPresent(options.r1146Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1146_EXPECTED.artifact));
  validateOptionalInputBoundary("r1146", r1146);
  const r1146Expected = r1146MatchesExpected(r1146);
  const consumerAverageSubmitterRowOwnerActionPacketArtifact = r1146Expected ? R1146_EXPECTED.artifact : null;
  const consumerAverageSubmitterRowOwnerActionPacketConclusion = r1146Expected
    ? readStringAt(r1146, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterRowOwnerActionPacketNextAction = r1146Expected
    ? readStringAt(r1146, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterRowOwnerActionPacketSelectedRecipeId = r1146Expected
    ? readStringAt(r1146, ["summary", "selectedRecommendedRecipeId"])
    : null;
  const consumerAverageSubmitterRowOwnerActionPacketFallbackRecipeIds = r1146Expected
    ? readStringArrayAt(r1146, ["summary", "fallbackRecipeIds"])
    : [];
  const consumerAverageSubmitterRowOwnerActionPacketBlockers = r1146Expected
    ? readStringArrayAt(r1146, ["summary", "blockers"])
    : [];
  const consumerAverageSubmitterRowOwnerActionPacketRecommendedConfirmedRecipeCommandAvailable = r1146Expected
    ? readBooleanAt(r1146, ["summary", "recommendedConfirmedRecipeCommandAvailable"])
    : null;
  const consumerAverageSubmitterRowOwnerActionPacketRecommendedConfirmedRecipeCommand = r1146Expected
    ? readStringAt(r1146, ["rowOwnerRouteActionPacket", "commands", "recommendedConfirmedRecipeCommand"])
    : null;
  const r1147 = await readJsonIfPresent(options.r1147Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1147_EXPECTED.artifact));
  validateOptionalInputBoundary("r1147", r1147);
  const r1147Expected = r1147MatchesExpected(r1147);
  const consumerAverageSubmitterPostConfirmationPrivateConfigPacketArtifact = r1147Expected
    ? R1147_EXPECTED.artifact
    : null;
  const consumerAverageSubmitterPostConfirmationPrivateConfigPacketConclusion = r1147Expected
    ? readStringAt(r1147, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterPostConfirmationPrivateConfigPacketNextAction = r1147Expected
    ? readStringAt(r1147, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterPostConfirmationPrivateConfigPacketBlockers = r1147Expected
    ? readStringArrayAt(r1147, ["summary", "blockers"])
    : [];
  const consumerAverageSubmitterPostConfirmationPrivateConfigPacketExpectedRouteIds = r1147Expected
    ? readStringArrayAt(r1147, ["summary", "expectedRouteIds"])
    : [];
  const consumerAverageSubmitterPostConfirmationPrivateConfigPacketRequiredFieldRefFamilies = r1147Expected
    ? readStringArrayAt(r1147, ["summary", "requiredPrivateFieldRefFamilies"])
    : [];
  const consumerAverageSubmitterPostConfirmationPrivateConfigPacketRequiredTableRefs = r1147Expected
    ? readStringArrayAt(r1147, ["summary", "requiredPrivateTableRefs"])
    : [];
  const consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigPrivateFieldRefKeys = r1147Expected
    ? readStringArrayAt(r1147, ["summary", "runnerConfigPrivateFieldRefKeys"])
    : [];
  const consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigPrivateTableRefKeys = r1147Expected
    ? readStringArrayAt(r1147, ["summary", "runnerConfigPrivateTableRefKeys"])
    : [];
  const consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigRouteRunOrder = r1147Expected
    ? readStringArrayAt(r1147, ["summary", "runnerConfigRouteRunOrder"])
    : [];
  const consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigSchemaVersion = r1147Expected
    ? readStringAt(r1147, ["summary", "runnerConfigSchemaVersion"])
    : null;
  const consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigTopLevelKeys = r1147Expected
    ? readStringArrayAt(r1147, ["summary", "runnerConfigTopLevelKeys"])
    : [];
  const consumerAverageSubmitterPostConfirmationPrivateConfigPacketTemplateArtifact = r1147Expected
    ? readStringAt(r1147, ["summary", "privateConfigTemplateArtifact"])
    : null;
  const consumerAverageSubmitterPostConfirmationPrivateConfigPacketTemplateReadyForFill = r1147Expected
    ? readBooleanAt(r1147, ["summary", "privateConfigTemplateReadyForFill"])
    : null;
  const consumerAverageSubmitterPostConfirmationPrivateConfigPacketRowOwnerAssertionsConfirmed = r1147Expected
    ? readBooleanAt(r1147, ["summary", "rowOwnerAssertionsConfirmed"])
    : null;
  const r1148 = await readJsonIfPresent(options.r1148Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1148_EXPECTED.artifact));
  validateOptionalInputBoundary("r1148", r1148);
  const r1148Expected = r1148MatchesExpected(r1148);
  const consumerAverageSubmitterPostConfirmationPrivateConfigIntakeArtifact = r1148Expected
    ? R1148_EXPECTED.artifact
    : null;
  const consumerAverageSubmitterPostConfirmationPrivateConfigIntakeConclusion = r1148Expected
    ? readStringAt(r1148, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterPostConfirmationPrivateConfigIntakeNextAction = r1148Expected
    ? readStringAt(r1148, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterPostConfirmationPrivateConfigIntakeReadyForR1142 = r1148Expected
    ? readBooleanAt(r1148, ["summary", "readyForR1142"])
    : null;
  const consumerAverageSubmitterPostConfirmationPrivateConfigIntakePrivateConfigSupplied = r1148Expected
    ? readBooleanAt(r1148, ["summary", "privateConfigSuppliedToIntake"])
    : null;
  const consumerAverageSubmitterPostConfirmationPrivateConfigIntakePrivateConfigStatus = r1148Expected
    ? readStringAt(r1148, ["summary", "privateConfigStatus"])
    : null;
  const consumerAverageSubmitterPostConfirmationPrivateConfigIntakeEvidenceRoleStatus = r1148Expected
    ? readStringAt(r1148, ["summary", "evidenceRoleStatus"])
    : null;
  const consumerAverageSubmitterPostConfirmationPrivateConfigIntakeOrdinaryTableLayout = r1148Expected
    ? readStringAt(r1148, ["summary", "ordinaryTableLayout"])
    : null;
  const consumerAverageSubmitterPostConfirmationPrivateConfigIntakePacketReadyForConfigIntake = r1148Expected
    ? readBooleanAt(r1148, ["summary", "packetReadyForConfigIntake"])
    : null;
  const consumerAverageSubmitterPostConfirmationPrivateConfigIntakeRequestedRouteIds = r1148Expected
    ? readStringArrayAt(r1148, ["summary", "requestedRouteIds"])
    : [];
  const consumerAverageSubmitterPostConfirmationPrivateConfigIntakeMissingAttestationKeys = r1148Expected
    ? readStringArrayAt(r1148, ["summary", "missingAttestationKeys"])
    : [];
  const consumerAverageSubmitterPostConfirmationPrivateConfigIntakeMissingRouteIds = r1148Expected
    ? readStringArrayAt(r1148, ["summary", "missingRouteIds"])
    : [];
  const consumerAverageSubmitterPostConfirmationPrivateConfigIntakeMissingRunnerFieldRefKeys = r1148Expected
    ? readStringArrayAt(r1148, ["summary", "missingRunnerFieldRefKeys"])
    : [];
  const consumerAverageSubmitterPostConfirmationPrivateConfigIntakeMissingRunnerTableRefKeys = r1148Expected
    ? readStringArrayAt(r1148, ["summary", "missingRunnerTableRefKeys"])
    : [];
  const consumerAverageSubmitterPostConfirmationPrivateConfigIntakeR1147Conclusion = r1148Expected
    ? readStringAt(r1148, ["summary", "r1147Conclusion"])
    : null;
  const consumerAverageSubmitterPostConfirmationPrivateConfigIntakeR1147NextAction = r1148Expected
    ? readStringAt(r1148, ["summary", "r1147NextAction"])
    : null;
  const consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketConclusion =
    r1148Expected
      ? readStringAt(r1148, ["summary", "safeAvailabilityActionPacketConclusion"])
      : null;
  const consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketFeatureOnlyCoverageContextReady =
    r1148Expected
      ? readBooleanAt(r1148, ["summary", "safeAvailabilityActionPacketFeatureOnlyCoverageContextReady"])
      : null;
  const consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds =
    r1148Expected
      ? readStringArrayAt(r1148, ["summary", "safeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds"])
      : [];
  const consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketMissingRequiredSourceFamilyIds =
    r1148Expected
      ? readStringArrayAt(r1148, ["summary", "safeAvailabilityActionPacketMissingRequiredSourceFamilyIds"])
      : [];
  const consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketNextAction =
    r1148Expected
      ? readStringAt(r1148, ["summary", "safeAvailabilityActionPacketNextAction"])
      : null;
  const consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain =
    r1148Expected
      ? readBooleanAt(r1148, ["summary", "safeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain"])
      : null;
  const consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketRowLevelDataAcceptedByR1154 =
    r1148Expected
      ? readBooleanAt(r1148, ["summary", "safeAvailabilityActionPacketRowLevelDataAcceptedByR1154"])
      : null;
  const consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeActionGuardPresent = r1148Expected
    ? postConfirmationPrivateConfigIntakeSafeActionGuardPresent(r1148)
    : null;
  const r1149 = await readJsonIfPresent(options.r1149Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1149_EXPECTED.artifact));
  validateOptionalInputBoundary("r1149", r1149);
  const r1149Expected = r1149MatchesExpected(r1149);
  const consumerAverageSubmitterLabWearableSubmissionKitArtifact = r1149Expected
    ? R1149_EXPECTED.artifact
    : null;
  const consumerAverageSubmitterLabWearableSubmissionKitConclusion = r1149Expected
    ? readStringAt(r1149, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterLabWearableSubmissionKitNextAction = r1149Expected
    ? readStringAt(r1149, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterLabWearableSubmissionKitOptionalAddOnFamilyIds = r1149Expected
    ? readStringArrayAt(r1149, ["summary", "optionalAddOnFamilyIds"])
    : [];
  const consumerAverageSubmitterLabWearableSubmissionKitPrivateConfigReadyForR1142 = r1149Expected
    ? readBooleanAt(r1149, ["summary", "privateConfigReadyForR1142"])
    : null;
  const consumerAverageSubmitterLabWearableSubmissionKitPrivateConfigStatus = r1149Expected
    ? readStringAt(r1149, ["summary", "privateConfigStatus"])
    : null;
  const consumerAverageSubmitterLabWearableSubmissionKitReadyForResearchReview = r1149Expected
    ? readBooleanAt(r1149, ["summary", "readyForResearchReview"])
    : null;
  const consumerAverageSubmitterLabWearableSubmissionKitRequiredSourceFamilyIds = r1149Expected
    ? readStringArrayAt(r1149, ["summary", "requiredSourceFamilyIds"])
    : [];
  const consumerAverageSubmitterLabWearableSubmissionKitRowOwnerAssertionsConfirmed = r1149Expected
    ? readBooleanAt(r1149, ["summary", "rowOwnerAssertionsConfirmed"])
    : null;
  const consumerAverageSubmitterLabWearableSubmissionKitTopBlocker = r1149Expected
    ? readStringAt(r1149, ["summary", "topBlocker"])
    : null;
  const r1150 = await readJsonIfPresent(
    options.r1150Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1150_EXPECTED.artifact),
  );
  validateOptionalInputBoundary("r1150", r1150);
  const r1150Expected = r1150MatchesExpected(r1150);
  const consumerAverageSubmitterSafeAvailabilityConfirmationArtifact = r1150Expected
    ? R1150_EXPECTED.artifact
    : null;
  const consumerAverageSubmitterSafeAvailabilityConfirmationConclusion = r1150Expected
    ? readStringAt(r1150, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterSafeAvailabilityConfirmationMissingAggregateReadinessFactIds = r1150Expected
    ? readStringArrayAt(r1150, ["summary", "missingAggregateReadinessFactIds"])
    : [];
  const consumerAverageSubmitterSafeAvailabilityConfirmationMissingAttestationKeys = r1150Expected
    ? readStringArrayAt(r1150, ["summary", "missingAttestationKeys"])
    : [];
  const consumerAverageSubmitterSafeAvailabilityConfirmationMissingFeatureOnlySourceFamilyIds = r1150Expected
    ? readStringArrayAt(r1150, ["summary", "missingFeatureOnlySourceFamilyIds"])
    : [];
  const consumerAverageSubmitterSafeAvailabilityConfirmationMissingSourceFamilyIds = r1150Expected
    ? readStringArrayAt(r1150, ["summary", "missingRequiredSourceFamilyIds"])
    : [];
  const consumerAverageSubmitterSafeAvailabilityConfirmationFeatureOnlyCoverageContextReady = r1150Expected
    ? readBooleanAt(r1150, ["summary", "featureOnlyCoverageContextReady"])
    : null;
  const consumerAverageSubmitterSafeAvailabilityConfirmationFeatureOnlyCoverageRequiresPreferredPair = r1150Expected
    ? readBooleanAt(r1150, ["summary", "featureOnlyCoverageRequiresPreferredPair"])
    : null;
  const consumerAverageSubmitterSafeAvailabilityConfirmationChecklistItemIds = r1150Expected
    ? readStringArrayAt(r1150, ["summary", "ordinarySubmitterSafeCompletionChecklistItemIds"])
    : [];
  const consumerAverageSubmitterSafeAvailabilityConfirmationMinimumFeaturePairRequired = r1150Expected
    ? readStringArrayAt(r1150, ["summary", "minimumFeaturePairRequired"])
    : [];
  const consumerAverageSubmitterSafeAvailabilityConfirmationNextAction = r1150Expected
    ? readStringAt(r1150, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterSafeAvailabilityConfirmationOutcomeLinkageRequiredForFeatureOnlyContext = r1150Expected
    ? readBooleanAt(r1150, ["summary", "outcomeLinkageRequiredForFeatureOnlyContext"])
    : null;
  const consumerAverageSubmitterSafeAvailabilityConfirmationReadyForRecipeReadinessChain = r1150Expected
    ? readBooleanAt(r1150, ["summary", "readyForRecipeReadinessChain"])
    : null;
  const consumerAverageSubmitterSafeAvailabilityConfirmationRowOwnerAssertionsConfirmed = r1150Expected
    ? readBooleanAt(r1150, ["summary", "rowOwnerAssertionsConfirmed"])
    : null;
  const consumerAverageSubmitterSafeAvailabilityConfirmationRowLevelDataAcceptedByR1150 = r1150Expected
    ? readBooleanAt(r1150, ["summary", "rowLevelDataAcceptedByR1150"])
    : null;
  const consumerAverageSubmitterSafeAvailabilityConfirmationStatus = r1150Expected
    ? readStringAt(r1150, ["summary", "confirmationStatus"])
    : null;
  const consumerAverageSubmitterSafeAvailabilityConfirmationTemplateArtifact = r1150Expected
    ? readStringAt(r1150, ["summary", "templateArtifact"])
    : null;
  const consumerAverageSubmitterSafeAvailabilityConfirmationFeatureOnlyTemplateArtifact = r1150Expected
    ? readStringAt(r1150, ["summary", "featureOnlyTemplateArtifact"])
    : null;
  const r1151 = await readJsonIfPresent(
    options.r1151Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1151_EXPECTED.artifact),
  );
  validateOptionalInputBoundary("r1151", r1151);
  const r1151Expected = r1151MatchesExpected(r1151);
  const consumerAverageSubmitterFeatureOnlyModeArtifact = r1151Expected
    ? R1151_EXPECTED.artifact
    : null;
  const consumerAverageSubmitterFeatureOnlyModeConclusion = r1151Expected
    ? readStringAt(r1151, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterFeatureOnlyModeCoverageContextAllowed = r1151Expected
    ? readBooleanAt(r1151, ["summary", "featureOnlyCoverageContextAllowed"])
    : null;
  const consumerAverageSubmitterFeatureOnlyModeCoverageRequiresPreferredPair = r1151Expected
    ? readBooleanAt(r1151, ["summary", "featureOnlyCoverageRequiresPreferredPair"])
    : null;
  const consumerAverageSubmitterFeatureOnlyModeCoverageContextTemplateArtifact = r1151Expected
    ? readStringAt(r1151, ["summary", "featureOnlyCoverageContextTemplateArtifact"])
    : null;
  const consumerAverageSubmitterFeatureOnlyModeMinimumFeaturePairRequired = r1151Expected
    ? readStringArrayAt(r1151, ["summary", "minimumFeaturePairRequired"])
    : [];
  const consumerAverageSubmitterFeatureOnlyModeMissingAttestationKeys = r1151Expected
    ? readStringArrayAt(r1151, ["summary", "missingAttestationKeys"])
    : [];
  const consumerAverageSubmitterFeatureOnlyModeMissingEvidenceSourceFamilyIds = r1151Expected
    ? readStringArrayAt(r1151, ["summary", "missingEvidenceSourceFamilyIds"])
    : [];
  const consumerAverageSubmitterFeatureOnlyModeMissingPrimaryFeatureFamilyIds = r1151Expected
    ? readStringArrayAt(r1151, ["summary", "missingPrimaryFeatureFamilyIds"])
    : [];
  const consumerAverageSubmitterFeatureOnlyModeModelEvidencePromotionAllowed = r1151Expected
    ? readBooleanAt(r1151, ["summary", "modelEvidencePromotionAllowed"])
    : null;
  const consumerAverageSubmitterFeatureOnlyModeNextAction = r1151Expected
    ? readStringAt(r1151, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterFeatureOnlyModeOutcomeLinkageRequiredForFeatureOnlyContext = r1151Expected
    ? readBooleanAt(r1151, ["summary", "outcomeLinkageRequiredForFeatureOnlyContext"])
    : null;
  const consumerAverageSubmitterFeatureOnlyModeOutcomeLinkedEvidenceReady = r1151Expected
    ? readBooleanAt(r1151, ["summary", "outcomeLinkedEvidenceReady"])
    : null;
  const consumerAverageSubmitterFeatureOnlyModePreferredPairReady = r1151Expected
    ? readBooleanAt(r1151, ["summary", "featureOnlyPreferredPairReady"])
    : null;
  const consumerAverageSubmitterFeatureOnlyModeRowLevelDataAcceptedByR1151 = r1151Expected
    ? readBooleanAt(r1151, ["summary", "rowLevelDataAcceptedByR1151"])
    : null;
  const consumerAverageSubmitterFeatureOnlyModeSafeAvailabilityFeatureOnlyCoverageContextReady = r1151Expected
    ? readBooleanAt(r1151, ["summary", "safeAvailabilityFeatureOnlyCoverageContextReady"])
    : null;
  const consumerAverageSubmitterFeatureOnlyModeSafeAvailabilityFeatureOnlyReadinessPresent = r1151Expected
    ? readBooleanAt(r1151, ["summary", "safeAvailabilityFeatureOnlyReadinessPresent"])
    : null;
  const consumerAverageSubmitterFeatureOnlyModeSupportedFeatureFamilyIds = r1151Expected
    ? readStringArrayAt(r1151, ["summary", "supportedFeatureFamilyIds"])
    : [];
  const r1152 = await readJsonIfPresent(
    options.r1152Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1152_EXPECTED.artifact),
  );
  validateOptionalInputBoundary("r1152", r1152);
  const r1152Expected = r1152MatchesExpected(r1152);
  const consumerAverageSubmitterFeatureOnlyCoverageContextIntakeArtifact = r1152Expected
    ? R1152_EXPECTED.artifact
    : null;
  const consumerAverageSubmitterFeatureOnlyCoverageContextIntakeConclusion = r1152Expected
    ? readStringAt(r1152, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterFeatureOnlyCoverageContextIntakeContextStatus = r1152Expected
    ? readStringAt(r1152, ["summary", "contextStatus"])
    : null;
  const consumerAverageSubmitterFeatureOnlyCoverageContextIntakeReadyForResearchPlanning = r1152Expected
    ? readBooleanAt(r1152, ["summary", "coverageContextReadyForResearchPlanning"])
    : null;
  const consumerAverageSubmitterFeatureOnlyCoverageContextIntakeMinimumFeaturePairRequired = r1152Expected
    ? readStringArrayAt(r1152, ["summary", "minimumFeaturePairRequired"])
    : [];
  const consumerAverageSubmitterFeatureOnlyCoverageContextIntakeMissingPrimaryFeatureFamilyIds = r1152Expected
    ? readStringArrayAt(r1152, ["summary", "missingPrimaryFeatureFamilyIds"])
    : [];
  const consumerAverageSubmitterFeatureOnlyCoverageContextIntakeModelEvidencePromotionAllowed = r1152Expected
    ? readBooleanAt(r1152, ["summary", "modelEvidencePromotionAllowed"])
    : null;
  const consumerAverageSubmitterFeatureOnlyCoverageContextIntakeNextAction = r1152Expected
    ? readStringAt(r1152, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterFeatureOnlyCoverageContextIntakeOutcomeLinkageRequiredForFeatureOnlyContext = r1152Expected
    ? readBooleanAt(r1152, ["summary", "outcomeLinkageRequiredForFeatureOnlyContext"])
    : null;
  const consumerAverageSubmitterFeatureOnlyCoverageContextIntakeR1151ReadyForIntake = r1152Expected
    ? readBooleanAt(r1152, ["summary", "r1151FeatureOnlyModeReadyForIntake"])
    : null;
  const consumerAverageSubmitterFeatureOnlyCoverageContextIntakeRowLevelDataAcceptedByR1152 = r1152Expected
    ? readBooleanAt(r1152, ["summary", "rowLevelDataAcceptedByR1152"])
    : null;
  const consumerAverageSubmitterFeatureOnlyCoverageContextIntakeSupportedFeatureFamilyIds = r1152Expected
    ? readStringArrayAt(r1152, ["summary", "supportedFeatureFamilyIds"])
    : [];
  const r1153 = await readJsonIfPresent(
    options.r1153Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1153_EXPECTED.artifact),
  );
  validateOptionalInputBoundary("r1153", r1153);
  const r1153Expected = r1153MatchesExpected(r1153);
  const consumerAverageSubmitterFeatureOnlyChainArtifact = r1153Expected
    ? R1153_EXPECTED.artifact
    : null;
  const consumerAverageSubmitterFeatureOnlyChainConclusion = r1153Expected
    ? readStringAt(r1153, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterFeatureOnlyChainContextPathConfigured = r1153Expected
    ? readBooleanAt(r1153, ["summary", "contextPathConfigured"])
    : null;
  const consumerAverageSubmitterFeatureOnlyChainCoverageContextReadyForResearchPlanning = r1153Expected
    ? readBooleanAt(r1153, ["summary", "coverageContextReadyForResearchPlanning"])
    : null;
  const consumerAverageSubmitterFeatureOnlyChainCoverageContextAllowed = r1153Expected
    ? readBooleanAt(r1153, ["summary", "featureOnlyCoverageContextAllowed"])
    : null;
  const consumerAverageSubmitterFeatureOnlyChainCoverageContextIntakeConclusion = r1153Expected
    ? readStringAt(r1153, ["summary", "featureOnlyCoverageContextIntakeConclusion"])
    : null;
  const consumerAverageSubmitterFeatureOnlyChainCoverageContextIntakeContextStatus = r1153Expected
    ? readStringAt(r1153, ["summary", "featureOnlyCoverageContextIntakeContextStatus"])
    : null;
  const consumerAverageSubmitterFeatureOnlyChainFeatureOnlyModeConclusion = r1153Expected
    ? readStringAt(r1153, ["summary", "featureOnlyModeConclusion"])
    : null;
  const consumerAverageSubmitterFeatureOnlyChainMinimumFeaturePairRequired = r1153Expected
    ? readStringArrayAt(r1153, ["summary", "minimumFeaturePairRequired"])
    : [];
  const consumerAverageSubmitterFeatureOnlyChainMissingCoverageContextPrimaryFeatureFamilyIds = r1153Expected
    ? readStringArrayAt(r1153, ["summary", "missingCoverageContextPrimaryFeatureFamilyIds"])
    : [];
  const consumerAverageSubmitterFeatureOnlyChainMissingFeatureOnlySourceFamilyIds = r1153Expected
    ? readStringArrayAt(r1153, ["summary", "missingFeatureOnlySourceFamilyIds"])
    : [];
  const consumerAverageSubmitterFeatureOnlyChainModelEvidencePromotionAllowed = r1153Expected
    ? readBooleanAt(r1153, ["summary", "modelEvidencePromotionAllowed"])
    : null;
  const consumerAverageSubmitterFeatureOnlyChainNextAction = r1153Expected
    ? readStringAt(r1153, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterFeatureOnlyChainOutcomeLinkageRequiredForFeatureOnlyContext = r1153Expected
    ? readBooleanAt(r1153, ["summary", "outcomeLinkageRequiredForFeatureOnlyContext"])
    : null;
  const consumerAverageSubmitterFeatureOnlyChainRowLevelDataAcceptedByR1153 = r1153Expected
    ? readBooleanAt(r1153, ["summary", "rowLevelDataAcceptedByR1153"])
    : null;
  const consumerAverageSubmitterFeatureOnlyChainSafeAvailabilityFeatureOnlyCoverageContextReady = r1153Expected
    ? readBooleanAt(r1153, ["summary", "safeAvailabilityFeatureOnlyCoverageContextReady"])
    : null;
  const consumerAverageSubmitterFeatureOnlyChainSafeAvailabilityReadyForRecipeReadinessChain = r1153Expected
    ? readBooleanAt(r1153, ["summary", "safeAvailabilityReadyForRecipeReadinessChain"])
    : null;
  const consumerAverageSubmitterFeatureOnlyChainSupportedFeatureFamilyIds = r1153Expected
    ? readStringArrayAt(r1153, ["summary", "supportedFeatureFamilyIds"])
    : [];
  const r1154 = await readJsonIfPresent(
    options.r1154Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1154_EXPECTED.artifact),
  );
  validateOptionalInputBoundary("r1154", r1154);
  const r1154Expected = r1154MatchesExpected(r1154);
  const consumerAverageSubmitterSafeAvailabilityActionPacketArtifact = r1154Expected
    ? R1154_EXPECTED.artifact
    : null;
  const consumerAverageSubmitterSafeAvailabilityActionPacketCommand = r1154Expected
    ? readStringAt(r1154, ["safeAvailabilityActionPacket", "commands", "safeAvailabilityActionPacketCommand"])
    : null;
  const consumerAverageSubmitterSafeAvailabilityActionPacketConclusion = r1154Expected
    ? readStringAt(r1154, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyCoverageContextReady = r1154Expected
    ? readBooleanAt(r1154, ["summary", "featureOnlyCoverageContextReady"])
    : null;
  const consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyQuickstartArtifact = r1154Expected
    ? readStringAt(r1154, ["summary", "featureOnlyQuickstartArtifact"])
    : null;
  const consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount = r1154Expected
    ? readNumberAt(r1154, ["summary", "featureOnlyQuickstartSafeFieldEditCount"])
    : null;
  const consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths = r1154Expected
    ? readStringArrayAt(r1154, ["summary", "featureOnlyQuickstartSafeFieldEditPaths"])
    : [];
  const consumerAverageSubmitterSafeAvailabilityConfirmationIntakeCommand = r1154Expected
    ? readStringAt(r1154, ["safeAvailabilityActionPacket", "commands", "safeAvailabilityConfirmationIntakeCommand"])
    : null;
  const consumerAverageSubmitterSafeAvailabilityFeatureOnlyChainRunnerCommand = r1154Expected
    ? readStringAt(r1154, ["safeAvailabilityActionPacket", "commands", "featureOnlyChainRunnerCommand"])
    : null;
  const consumerAverageSubmitterSafeAvailabilityOutcomeLinkedRecipeReadinessCommand = r1154Expected
    ? readStringAt(r1154, ["safeAvailabilityActionPacket", "commands", "outcomeLinkedRecipeReadinessCommand"])
    : null;
  const consumerAverageSubmitterSafeAvailabilityCompletionModeIds = r1154Expected
    ? readStringArrayAt(r1154, ["summary", "ordinarySubmitterCompletionModeIds"])
    : [];
  const consumerAverageSubmitterSafeAvailabilityActionPacketChecklistItemIds = r1154Expected
    ? readStringArrayAt(r1154, ["summary", "ordinarySubmitterSafeCompletionChecklistItemIds"])
    : [];
  const consumerAverageSubmitterSafeAvailabilityActionPacketMinimumFeaturePairRequired = r1154Expected
    ? readStringArrayAt(r1154, ["summary", "minimumFeaturePairRequired"])
    : [];
  const consumerAverageSubmitterSafeAvailabilityActionPacketMissingAggregateReadinessFactIds = r1154Expected
    ? readStringArrayAt(r1154, ["summary", "missingAggregateReadinessFactIds"])
    : [];
  const consumerAverageSubmitterSafeAvailabilityActionPacketMissingAttestationKeys = r1154Expected
    ? readStringArrayAt(r1154, ["summary", "missingAttestationKeys"])
    : [];
  const consumerAverageSubmitterSafeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds = r1154Expected
    ? readStringArrayAt(r1154, ["summary", "missingFeatureOnlySourceFamilyIds"])
    : [];
  const consumerAverageSubmitterSafeAvailabilityActionPacketMissingRequiredSourceFamilyIds = r1154Expected
    ? readStringArrayAt(r1154, ["summary", "missingRequiredSourceFamilyIds"])
    : [];
  const consumerAverageSubmitterSafeAvailabilityActionPacketNextAction = r1154Expected
    ? readStringAt(r1154, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterSafeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain = r1154Expected
    ? readBooleanAt(r1154, ["summary", "readyForOutcomeLinkedRecipeReadinessChain"])
    : null;
  const consumerAverageSubmitterSafeAvailabilityActionPacketRowLevelDataAcceptedByR1154 = r1154Expected
    ? readBooleanAt(r1154, ["summary", "rowLevelDataAcceptedByR1154"])
    : null;
  const consumerAverageSubmitterSafeAvailabilityActionPacketRowOwnerWorkType = r1154Expected
    ? readStringAt(r1154, ["summary", "rowOwnerWorkType"])
    : null;
  const consumerAverageSubmitterSafeAvailabilityActionPacketRowParsingPerformedByR1154 = r1154Expected
    ? readBooleanAt(r1154, ["summary", "rowParsingPerformedByR1154"])
    : null;
  const consumerAverageSubmitterSafeAvailabilityActionPacketTemplateArtifact = r1154Expected
    ? readStringAt(r1154, ["summary", "safeAvailabilityConfirmationTemplateArtifact"])
    : null;
  const consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyTemplateArtifact = r1154Expected
    ? readStringAt(r1154, ["summary", "featureOnlyFillableTemplateArtifact"])
    : null;
  const r1155 = await readJsonIfPresent(
    options.r1155Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1155_EXPECTED.artifact),
  );
  validateOptionalInputBoundary("r1155", r1155);
  const r1155Expected = r1155MatchesExpected(r1155);
  const consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofArtifact = r1155Expected
    ? R1155_EXPECTED.artifact
    : null;
  const consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofConclusion = r1155Expected
    ? readStringAt(r1155, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofNextAction = r1155Expected
    ? readStringAt(r1155, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofFeatureOnlyChainConclusion = r1155Expected
    ? readStringAt(r1155, ["summary", "featureOnlyChainConclusion"])
    : null;
  const consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofFeatureOnlyCoverageContextReadyForResearchPlanning =
    r1155Expected
      ? readBooleanAt(r1155, ["summary", "featureOnlyCoverageContextReadyForResearchPlanning"])
      : null;
  const consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofSafeAvailabilityConfirmationConclusion =
    r1155Expected
      ? readStringAt(r1155, ["summary", "safeAvailabilityConfirmationConclusion"])
      : null;
  const consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofReadyForRecipeReadinessChain = r1155Expected
    ? readBooleanAt(r1155, ["summary", "readyForRecipeReadinessChain"])
    : null;
  const consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofModelEvidencePromotionAllowed = r1155Expected
    ? readBooleanAt(r1155, ["summary", "modelEvidencePromotionAllowed"])
    : null;
  const consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofRowLevelDataAcceptedByR1155 = r1155Expected
    ? readBooleanAt(r1155, ["summary", "rowLevelDataAcceptedByR1155"])
    : null;
  const consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofSmokeEvidence = r1155Expected
    ? readBooleanAt(r1155, ["summary", "smokeEvidence"])
    : null;
  const r1156 = await readJsonIfPresent(
    options.r1156Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1156_EXPECTED.artifact),
  );
  validateOptionalInputBoundary("r1156", r1156);
  const r1156Expected = r1156MatchesExpected(r1156);
  const consumerAverageSubmitterSafeConfirmationHandoffArtifact = r1156Expected
    ? R1156_EXPECTED.artifact
    : null;
  const consumerAverageSubmitterSafeConfirmationHandoffCommand = r1156Expected
    ? readStringAt(r1156, ["safeConfirmationHandoff", "commands", "safeConfirmationHandoffCommand"])
      ?? readStringAt(r1156, ["summary", "safeConfirmationHandoffCommand"])
    : null;
  const consumerAverageSubmitterSafeConfirmationHandoffConclusion = r1156Expected
    ? readStringAt(r1156, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterSafeConfirmationHandoffNextAction = r1156Expected
    ? readStringAt(r1156, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterSafeConfirmationHandoffFeatureOnlyPathMechanicallyProven = r1156Expected
    ? readBooleanAt(r1156, ["summary", "featureOnlyPathMechanicallyProven"])
    : null;
  const consumerAverageSubmitterSafeConfirmationHandoffHandoffReadyForRowOwner = r1156Expected
    ? readBooleanAt(r1156, ["summary", "handoffReadyForRowOwner"])
    : null;
  const consumerAverageSubmitterSafeConfirmationHandoffModelEvidencePromotionAllowed = r1156Expected
    ? readBooleanAt(r1156, ["summary", "modelEvidencePromotionAllowed"])
    : null;
  const consumerAverageSubmitterSafeConfirmationHandoffReadyForModelEvidence = r1156Expected
    ? readBooleanAt(r1156, ["summary", "readyForModelEvidence"])
    : null;
  const consumerAverageSubmitterSafeConfirmationHandoffReadyForRecipeReadinessChain = r1156Expected
    ? readBooleanAt(r1156, ["summary", "readyForRecipeReadinessChain"])
    : null;
  const consumerAverageSubmitterSafeConfirmationHandoffRequiredFeatureOnlySourceFamilyIds = r1156Expected
    ? readStringArrayAt(r1156, ["summary", "requiredFeatureOnlySourceFamilyIds"])
    : [];
  const consumerAverageSubmitterSafeConfirmationHandoffRequiredSafeCompletionCheckIds = r1156Expected
    ? readStringArrayAt(r1156, ["summary", "requiredSafeCompletionCheckIds"])
    : [];
  const consumerAverageSubmitterSafeConfirmationHandoffRowLevelDataAcceptedByR1156 = r1156Expected
    ? readBooleanAt(r1156, ["summary", "rowLevelDataAcceptedByR1156"])
    : null;
  const consumerAverageSubmitterSafeConfirmationHandoffRowOwnerWorkType = r1156Expected
    ? readStringAt(r1156, ["summary", "rowOwnerWorkType"])
    : null;
  const consumerAverageSubmitterSafeConfirmationHandoffSafeConfirmationStillRequired = r1156Expected
    ? readBooleanAt(r1156, ["summary", "safeConfirmationStillRequired"])
    : null;
  const consumerAverageSubmitterSafeConfirmationHandoffSmokeEvidence = r1156Expected
    ? readBooleanAt(r1156, ["summary", "smokeEvidence"])
    : null;
  const r1157 = await readJsonIfPresent(
    options.r1157Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1157_EXPECTED.artifact),
  );
  validateOptionalInputBoundary("r1157", r1157);
  const r1157Expected = r1157MatchesExpected(r1157);
  const consumerAverageSubmitterSafeConfirmationChainRunnerArtifact = r1157Expected
    ? R1157_EXPECTED.artifact
    : null;
  const consumerAverageSubmitterSafeConfirmationChainRunnerCommand = r1157Expected
    ? readStringAt(r1157, ["summary", "safeConfirmationChainRunnerCommand"])
    : null;
  const consumerAverageSubmitterSafeConfirmationChainRunnerConclusion = r1157Expected
    ? readStringAt(r1157, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterSafeConfirmationChainRunnerNextAction = r1157Expected
    ? readStringAt(r1157, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterSafeConfirmationChainRunnerConfirmationPathConfigured = r1157Expected
    ? readBooleanAt(r1157, ["summary", "confirmationPathConfigured"])
    : null;
  const consumerAverageSubmitterSafeConfirmationChainRunnerFeatureOnlyCoverageContextReady = r1157Expected
    ? readBooleanAt(r1157, ["summary", "featureOnlyCoverageContextReady"])
    : null;
  const consumerAverageSubmitterSafeConfirmationChainRunnerFeatureOnlyResearchPlanningReady = r1157Expected
    ? readBooleanAt(r1157, ["summary", "featureOnlyResearchPlanningReady"])
    : null;
  const consumerAverageSubmitterSafeConfirmationChainRunnerReadyForModelEvidence = r1157Expected
    ? readBooleanAt(r1157, ["summary", "readyForModelEvidence"])
    : null;
  const consumerAverageSubmitterSafeConfirmationChainRunnerReadyForRecipeReadinessChain = r1157Expected
    ? readBooleanAt(r1157, ["summary", "readyForRecipeReadinessChain"])
    : null;
  const consumerAverageSubmitterSafeConfirmationChainRunnerRowLevelDataAcceptedByR1157 = r1157Expected
    ? readBooleanAt(r1157, ["summary", "rowLevelDataAcceptedByR1157"])
    : null;
  const consumerAverageSubmitterSafeConfirmationChainRunnerSafeConfirmationStillRequired = r1157Expected
    ? readBooleanAt(r1157, ["summary", "safeConfirmationStillRequired"])
    : null;
  const r1158 = await readJsonIfPresent(
    options.r1158Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1158_EXPECTED.artifact),
  );
  validateOptionalInputBoundary("r1158", r1158);
  const r1158Expected = r1158MatchesExpected(r1158);
  const consumerAverageSubmitterSafeConfirmationFillGuideArtifact = r1158Expected
    ? R1158_EXPECTED.artifact
    : null;
  const consumerAverageSubmitterSafeConfirmationFillGuideCommand = r1158Expected
    ? R1158_SAFE_CONFIRMATION_FILL_GUIDE_COMMAND
    : null;
  const consumerAverageSubmitterSafeConfirmationFillGuideConclusion = r1158Expected
    ? readStringAt(r1158, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterSafeConfirmationFillGuideExactSafeFieldEditCount = r1158Expected
    ? readNumberAt(r1158, ["summary", "exactSafeFieldEditCount"])
    : null;
  const consumerAverageSubmitterSafeConfirmationFillGuideGuideReadyForRowOwnerFill = r1158Expected
    ? readBooleanAt(r1158, ["summary", "guideReadyForRowOwnerFill"])
    : null;
  const consumerAverageSubmitterSafeConfirmationFillGuideMinimumFeaturePairRequired = r1158Expected
    ? readStringArrayAt(r1158, ["summary", "minimumFeaturePairRequired"])
    : [];
  const consumerAverageSubmitterSafeConfirmationFillGuideNextAction = r1158Expected
    ? readStringAt(r1158, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterSafeConfirmationFillGuideOptionalAddOnFamilyIds = r1158Expected
    ? readStringArrayAt(r1158, ["summary", "optionalAddOnFamilyIds"])
    : [];
  const consumerAverageSubmitterSafeConfirmationFillGuideRequiredChecklistIds = r1158Expected
    ? readStringArrayAt(r1158, ["summary", "requiredChecklistIds"])
    : [];
  const consumerAverageSubmitterSafeConfirmationFillGuideRequiredInputKindIds = r1158Expected
    ? readStringArrayAt(r1158, ["summary", "requiredInputKindIds"])
    : [];
  const consumerAverageSubmitterSafeConfirmationFillGuideRowLevelDataAcceptedByR1158 = r1158Expected
    ? readBooleanAt(r1158, ["summary", "rowLevelDataAcceptedByR1158"])
    : null;
  const r1159 = await readJsonIfPresent(
    options.r1159Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1159_EXPECTED.artifact),
  );
  validateOptionalInputBoundary("r1159", r1159);
  const r1159Expected = r1159MatchesExpected(r1159);
  const consumerAverageSubmitterSafeConfirmationAnswerSheetArtifact = r1159Expected
    ? R1159_EXPECTED.artifact
    : null;
  const consumerAverageSubmitterSafeConfirmationAnswerSheetCommand = r1159Expected
    ? R1159_SAFE_CONFIRMATION_ANSWER_SHEET_COMMAND
    : null;
  const consumerAverageSubmitterSafeConfirmationAnswerSheetConclusion = r1159Expected
    ? readStringAt(r1159, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterSafeConfirmationAnswerSheetExactSafeAnswerCount = r1159Expected
    ? readNumberAt(r1159, ["summary", "exactSafeAnswerCount"])
    : null;
  const consumerAverageSubmitterSafeConfirmationAnswerSheetReadyForRowOwner = r1159Expected
    ? readBooleanAt(r1159, ["summary", "answerSheetReadyForRowOwner"])
    : null;
  const consumerAverageSubmitterSafeConfirmationAnswerSheetMinimumFeaturePairRequired = r1159Expected
    ? readStringArrayAt(r1159, ["summary", "minimumFeaturePairRequired"])
    : [];
  const consumerAverageSubmitterSafeConfirmationAnswerSheetNextAction = r1159Expected
    ? readStringAt(r1159, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterSafeConfirmationAnswerSheetOptionalAddOnFamilyIds = r1159Expected
    ? readStringArrayAt(r1159, ["summary", "optionalAddOnFamilyIds"])
    : [];
  const consumerAverageSubmitterSafeConfirmationAnswerSheetRequiredChecklistIds = r1159Expected
    ? readStringArrayAt(r1159, ["summary", "requiredChecklistIds"])
    : [];
  const consumerAverageSubmitterSafeConfirmationAnswerSheetRequiredInputKindIds = r1159Expected
    ? readStringArrayAt(r1159, ["summary", "requiredInputKindIds"])
    : [];
  const consumerAverageSubmitterSafeConfirmationAnswerSheetRowLevelDataAcceptedByR1159 = r1159Expected
    ? readBooleanAt(r1159, ["summary", "rowLevelDataAcceptedByR1159"])
    : null;
  const consumerAverageSubmitterSafeConfirmationAnswerSheetRowOwnerProvidedValuesStored = r1159Expected
    ? readBooleanAt(r1159, ["summary", "rowOwnerProvidedValuesStored"])
    : null;
  const r1160 = await readJsonIfPresent(
    options.r1160Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1160_EXPECTED.artifact),
  );
  validateOptionalInputBoundary("r1160", r1160);
  const r1160Expected = r1160MatchesExpected(r1160);
  const consumerAverageSubmitterSafeConfirmationTranscriptionProofArtifact = r1160Expected
    ? R1160_EXPECTED.artifact
    : null;
  const consumerAverageSubmitterSafeConfirmationTranscriptionProofCommand = r1160Expected
    ? R1160_TRANSCRIPTION_PROOF_COMMAND
    : null;
  const consumerAverageSubmitterSafeConfirmationTranscriptionProofConclusion = r1160Expected
    ? readStringAt(r1160, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterSafeConfirmationTranscriptionProofExactSafeTranscriptionStepCount = r1160Expected
    ? readNumberAt(r1160, ["summary", "exactSafeTranscriptionStepCount"])
    : null;
  const consumerAverageSubmitterSafeConfirmationTranscriptionProofReadyForRowOwnerConfirmation = r1160Expected
    ? readBooleanAt(r1160, ["summary", "transcriptionProofReadyForRowOwnerConfirmation"])
    : null;
  const consumerAverageSubmitterSafeConfirmationTranscriptionProofHypotheticalTranscriptionWouldBeFeatureOnlyReady =
    r1160Expected
      ? readBooleanAt(r1160, ["summary", "hypotheticalTranscriptionWouldBeFeatureOnlyReady"])
      : null;
  const consumerAverageSubmitterSafeConfirmationTranscriptionProofNextAction = r1160Expected
    ? readStringAt(r1160, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterSafeConfirmationTranscriptionProofRequiredInputKindIds = r1160Expected
    ? readStringArrayAt(r1160, ["summary", "requiredInputKindIds"])
    : [];
  const consumerAverageSubmitterSafeConfirmationTranscriptionProofRowLevelDataAcceptedByR1160 = r1160Expected
    ? readBooleanAt(r1160, ["summary", "rowLevelDataAcceptedByR1160"])
    : null;
  const consumerAverageSubmitterSafeConfirmationTranscriptionProofRowOwnerConfirmationStillRequired = r1160Expected
    ? readBooleanAt(r1160, ["summary", "rowOwnerConfirmationStillRequired"])
    : null;
  const consumerAverageSubmitterSafeConfirmationTranscriptionProofConfirmationValuesStoredByR1160 = r1160Expected
    ? readBooleanAt(r1160, ["summary", "confirmationValuesStoredByR1160"])
    : null;
  const consumerAverageSubmitterSafeConfirmationTranscriptionProofRowOwnerProvidedValuesStored = r1160Expected
    ? readBooleanAt(r1160, ["summary", "rowOwnerProvidedValuesStored"])
    : null;
  const r1161 = await readJsonIfPresent(
    options.r1161Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1161_EXPECTED.artifact),
  );
  validateOptionalInputBoundary("r1161", r1161);
  const r1161Expected = r1161MatchesExpected(r1161);
  const consumerAverageSubmitterSafeConfirmationMaterializerArtifact = r1161Expected
    ? R1161_EXPECTED.artifact
    : null;
  const consumerAverageSubmitterSafeConfirmationMaterializerCommand = r1161Expected
    ? R1161_MATERIALIZER_COMMAND
    : null;
  const consumerAverageSubmitterSafeConfirmationMaterializerConclusion = r1161Expected
    ? readStringAt(r1161, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterSafeConfirmationMaterializerNextAction = r1161Expected
    ? readStringAt(r1161, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterSafeConfirmationMaterializerExplicitRowOwnerConfirmationAssertionProvided = r1161Expected
    ? readBooleanAt(r1161, ["summary", "explicitRowOwnerConfirmationAssertionProvided"])
    : null;
  const consumerAverageSubmitterSafeConfirmationMaterializerSafeConfirmationArtifactWritten = r1161Expected
    ? readBooleanAt(r1161, ["summary", "safeConfirmationArtifactWritten"])
    : null;
  const consumerAverageSubmitterSafeConfirmationMaterializerSafeConfirmationArtifact = r1161Expected
    ? readStringAt(r1161, ["summary", "safeConfirmationArtifact"])
    : null;
  const consumerAverageSubmitterSafeConfirmationMaterializerFeatureOnlyConfirmationWouldBeReadyForR1150 = r1161Expected
    ? readBooleanAt(r1161, ["summary", "featureOnlyConfirmationWouldBeReadyForR1150"])
    : null;
  const consumerAverageSubmitterSafeConfirmationMaterializerRowOwnerConfirmationStillRequired = r1161Expected
    ? readBooleanAt(r1161, ["summary", "rowOwnerConfirmationStillRequired"])
    : null;
  const consumerAverageSubmitterSafeConfirmationMaterializerConfirmationValuesStoredInR1161Packet = r1161Expected
    ? readBooleanAt(r1161, ["summary", "confirmationValuesStoredInR1161Packet"])
    : null;
  const consumerAverageSubmitterSafeConfirmationMaterializerRowLevelDataAcceptedByR1161 = r1161Expected
    ? readBooleanAt(r1161, ["summary", "rowLevelDataAcceptedByR1161"])
    : null;
  const consumerAverageSubmitterSafeConfirmationMaterializerRowOwnerPrivateValuesStored = r1161Expected
    ? readBooleanAt(r1161, ["summary", "rowOwnerPrivateValuesStored"])
    : null;
  const r1162 = await readJsonIfPresent(
    options.r1162Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1162_EXPECTED.artifact),
  );
  validateOptionalInputBoundary("r1162", r1162);
  const r1162Expected = r1162MatchesExpected(r1162);
  const consumerAverageSubmitterSafeConfirmationAssertionHandoffArtifact = r1162Expected
    ? R1162_EXPECTED.artifact
    : null;
  const consumerAverageSubmitterSafeConfirmationAssertionHandoffCommand = r1162Expected
    ? R1162_ASSERTION_HANDOFF_COMMAND
    : null;
  const consumerAverageSubmitterSafeConfirmationAssertionHandoffConclusion = r1162Expected
    ? readStringAt(r1162, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterSafeConfirmationAssertionHandoffNextAction = r1162Expected
    ? readStringAt(r1162, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterSafeConfirmationAssertionHandoffHandoffReadyForRowOwner = r1162Expected
    ? readBooleanAt(r1162, ["summary", "handoffReadyForRowOwner"])
    : null;
  const consumerAverageSubmitterSafeConfirmationAssertionHandoffRowOwnerAssertionStillRequired = r1162Expected
    ? readBooleanAt(r1162, ["summary", "rowOwnerAssertionStillRequired"])
    : null;
  const consumerAverageSubmitterSafeConfirmationAssertionHandoffExplicitRowOwnerConfirmationAssertionProvided = r1162Expected
    ? readBooleanAt(r1162, ["summary", "explicitRowOwnerConfirmationAssertionProvided"])
    : null;
  const consumerAverageSubmitterSafeConfirmationAssertionHandoffSafeConfirmationArtifactWritten = r1162Expected
    ? readBooleanAt(r1162, ["summary", "safeConfirmationArtifactWritten"])
    : null;
  const consumerAverageSubmitterSafeConfirmationAssertionHandoffFeatureOnlyConfirmationWouldBeReadyForR1150 = r1162Expected
    ? readBooleanAt(r1162, ["summary", "featureOnlyConfirmationWouldBeReadyForR1150"])
    : null;
  const consumerAverageSubmitterSafeConfirmationAssertionHandoffRequiredInputKindIds = r1162Expected
    ? readStringArrayAt(r1162, ["summary", "requiredInputKindIds"])
    : [];
  const consumerAverageSubmitterSafeConfirmationAssertionHandoffRequiredChecklistIds = r1162Expected
    ? readStringArrayAt(r1162, ["summary", "requiredChecklistIds"])
    : [];
  const consumerAverageSubmitterSafeConfirmationAssertionHandoffMinimumFeaturePairRequired = r1162Expected
    ? readStringArrayAt(r1162, ["summary", "minimumFeaturePairRequired"])
    : [];
  const consumerAverageSubmitterSafeConfirmationAssertionHandoffMaterializerCommand = r1162Expected
    ? readStringAt(r1162, ["summary", "materializerCommand"])
    : null;
  const consumerAverageSubmitterSafeConfirmationAssertionHandoffMaterializerNextAction = r1162Expected
    ? readStringAt(r1162, ["summary", "materializerNextAction"])
    : null;
  const consumerAverageSubmitterSafeConfirmationAssertionHandoffConfirmationValuesStoredByR1162 = r1162Expected
    ? readBooleanAt(r1162, ["summary", "confirmationValuesStoredByR1162"])
    : null;
  const consumerAverageSubmitterSafeConfirmationAssertionHandoffRowLevelDataAcceptedByR1162 = r1162Expected
    ? readBooleanAt(r1162, ["summary", "rowLevelDataAcceptedByR1162"])
    : null;
  const consumerAverageSubmitterSafeConfirmationAssertionHandoffRowOwnerPrivateValuesStored = r1162Expected
    ? readBooleanAt(r1162, ["summary", "rowOwnerPrivateValuesStored"])
    : null;
  const r1163 = await readJsonIfPresent(
    options.r1163Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1163_EXPECTED.artifact),
  );
  validateOptionalInputBoundary("r1163", r1163);
  const r1163Expected = r1163MatchesExpected(r1163);
  const consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerArtifact = r1163Expected
    ? R1163_EXPECTED.artifact
    : null;
  const consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerCommand = r1163Expected
    ? R1163_ASSERTION_TO_RESEARCH_RUNNER_COMMAND
    : null;
  const consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerConclusion = r1163Expected
    ? readStringAt(r1163, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerNextAction = r1163Expected
    ? readStringAt(r1163, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerExplicitRowOwnerAssertionProvided = r1163Expected
    ? readBooleanAt(r1163, ["summary", "explicitRowOwnerConfirmationAssertionProvided"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerFeatureOnlyResearchPlanningReady = r1163Expected
    ? readBooleanAt(r1163, ["summary", "featureOnlyResearchPlanningReady"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerFeatureOnlyChainRan = r1163Expected
    ? readBooleanAt(r1163, ["summary", "featureOnlyChainRan"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerRowOwnerAssertionStillRequired = r1163Expected
    ? readBooleanAt(r1163, ["summary", "rowOwnerAssertionStillRequired"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerConfirmedSafeConfirmationArtifact = r1163Expected
    ? readStringAt(r1163, ["summary", "confirmedSafeConfirmationArtifact"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerSafeConfirmationArtifactWritten = r1163Expected
    ? readBooleanAt(r1163, ["summary", "safeConfirmationArtifactWritten"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerRowLevelDataAcceptedByR1163 = r1163Expected
    ? readBooleanAt(r1163, ["summary", "rowLevelDataAcceptedByR1163"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerRowOwnerPrivateValuesStored = r1163Expected
    ? readBooleanAt(r1163, ["summary", "rowOwnerPrivateValuesStored"])
    : null;
  const r1164 = await readJsonIfPresent(
    options.r1164Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1164_EXPECTED.artifact),
  );
  validateOptionalInputBoundary("r1164", r1164);
  const r1164Expected = r1164MatchesExpected(r1164);
  const consumerAverageSubmitterFeatureOnlyResearchHandoffArtifact = r1164Expected
    ? R1164_EXPECTED.artifact
    : null;
  const consumerAverageSubmitterFeatureOnlyResearchHandoffCommand = r1164Expected
    ? R1164_FEATURE_ONLY_RESEARCH_HANDOFF_COMMAND
    : null;
  const consumerAverageSubmitterFeatureOnlyResearchHandoffConclusion = r1164Expected
    ? readStringAt(r1164, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterFeatureOnlyResearchHandoffNextAction = r1164Expected
    ? readStringAt(r1164, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterFeatureOnlyResearchHandoffFeatureOnlyResearchPlanningReady = r1164Expected
    ? readBooleanAt(r1164, ["summary", "featureOnlyResearchPlanningReady"])
    : null;
  const consumerAverageSubmitterFeatureOnlyResearchHandoffResearchPlanningAllowed = r1164Expected
    ? readBooleanAt(r1164, ["summary", "researchPlanningAllowed"])
    : null;
  const consumerAverageSubmitterFeatureOnlyResearchHandoffOutcomeLinkedModelEvidenceStillRequired = r1164Expected
    ? readBooleanAt(r1164, ["summary", "outcomeLinkedModelEvidenceStillRequired"])
    : null;
  const consumerAverageSubmitterFeatureOnlyResearchHandoffPrioritizedInputKindIds = r1164Expected
    ? readStringArrayAt(r1164, ["summary", "prioritizedInputKindIds"])
    : [];
  const consumerAverageSubmitterFeatureOnlyResearchHandoffMinimumFeaturePairRequired = r1164Expected
    ? readStringArrayAt(r1164, ["summary", "minimumFeaturePairRequired"])
    : [];
  const consumerAverageSubmitterFeatureOnlyResearchHandoffRowLevelDataAcceptedByR1164 = r1164Expected
    ? readBooleanAt(r1164, ["summary", "rowLevelDataAcceptedByR1164"])
    : null;
  const consumerAverageSubmitterFeatureOnlyResearchHandoffRowOwnerPrivateValuesStored = r1164Expected
    ? readBooleanAt(r1164, ["summary", "rowOwnerPrivateValuesStored"])
    : null;
  const r1165 = await readJsonIfPresent(
    options.r1165Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1165_EXPECTED.artifact),
  );
  validateOptionalInputBoundary("r1165", r1165);
  const r1165Expected = r1165MatchesExpected(r1165);
  const consumerAverageSubmitterFeatureOnlySafeAssertionRunnerArtifact = r1165Expected
    ? R1165_EXPECTED.artifact
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionRunnerCommand = r1165Expected
    ? R1165_SAFE_ASSERTION_RUNNER_COMMAND
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionRunnerConclusion = r1165Expected
    ? readStringAt(r1165, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionRunnerNextAction = r1165Expected
    ? readStringAt(r1165, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionRunnerAssertionAccepted = r1165Expected
    ? readBooleanAt(r1165, ["summary", "assertionAccepted"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionRunnerAssertionProvided = r1165Expected
    ? readBooleanAt(r1165, ["summary", "assertionProvided"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionRunnerAssertionTemplateArtifact = r1165Expected
    ? readStringAt(r1165, ["summary", "assertionTemplateArtifact"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionRunnerChildR1163Ran = r1165Expected
    ? readBooleanAt(r1165, ["summary", "childR1163Ran"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionRunnerFeatureOnlyResearchPlanningReady = r1165Expected
    ? readBooleanAt(r1165, ["summary", "featureOnlyResearchPlanningReady"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionRunnerRequiredInputKindIds = r1165Expected
    ? readStringArrayAt(r1165, ["summary", "requiredInputKindIds"])
    : [];
  const consumerAverageSubmitterFeatureOnlySafeAssertionRunnerRequiredAssertionChecklistIds = r1165Expected
    ? readStringArrayAt(r1165, ["summary", "requiredAssertionChecklistIds"])
    : [];
  const consumerAverageSubmitterFeatureOnlySafeAssertionRunnerOptionalAddOnFamilyIds = r1165Expected
    ? readStringArrayAt(r1165, ["summary", "optionalAddOnFamilyIds"])
    : [];
  const consumerAverageSubmitterFeatureOnlySafeAssertionRunnerValidationReasonIds = r1165Expected
    ? readStringArrayAt(r1165, ["summary", "validationReasonIds"])
    : [];
  const consumerAverageSubmitterFeatureOnlySafeAssertionRunnerRowLevelDataAcceptedByR1165 = r1165Expected
    ? readBooleanAt(r1165, ["summary", "rowLevelDataAcceptedByR1165"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionRunnerRowOwnerPrivateValuesStored = r1165Expected
    ? readBooleanAt(r1165, ["summary", "rowOwnerPrivateValuesStored"])
    : null;
  const r1167 = await readJsonIfPresent(
    options.r1167Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1167_EXPECTED.artifact),
  );
  validateOptionalInputBoundary("r1167", r1167);
  const r1167Expected = r1167MatchesExpected(r1167);
  const consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideArtifact = r1167Expected
    ? R1167_EXPECTED.artifact
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideCommand = r1167Expected
    ? R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideConclusion = r1167Expected
    ? readStringAt(r1167, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideNextAction = r1167Expected
    ? readStringAt(r1167, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideGuideReadyForRowOwnerFill = r1167Expected
    ? readBooleanAt(r1167, ["summary", "guideReadyForRowOwnerFill"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideRequiredInputKindIds = r1167Expected
    ? readStringArrayAt(r1167, ["summary", "requiredInputKindIds"])
    : [];
  const consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideOptionalAddOnFamilyIds = r1167Expected
    ? readStringArrayAt(r1167, ["summary", "optionalAddOnFamilyIds"])
    : [];
  const consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideSafeFieldEditCount = r1167Expected
    ? readNumberAt(r1167, ["summary", "safeFieldEditCount"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideSafeFieldEditPaths = r1167Expected
    ? readStringArrayAt(r1167, ["summary", "safeFieldEditPaths"])
    : [];
  const consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideRowLevelDataAcceptedByR1167 = r1167Expected
    ? readBooleanAt(r1167, ["summary", "rowLevelDataAcceptedByR1167"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideRowOwnerPrivateValuesStored = r1167Expected
    ? readBooleanAt(r1167, ["summary", "rowOwnerPrivateValuesStored"])
    : null;
  const r1172 = await readJsonIfPresent(
    options.r1172Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1172_EXPECTED.artifact),
  );
  validateOptionalInputBoundary("r1172", r1172);
  const r1172Expected = r1172MatchesExpected(r1172);
  const consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerArtifact = r1172Expected
    ? R1172_EXPECTED.artifact
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerCommand = r1172Expected
    ? R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerConclusion = r1172Expected
    ? readStringAt(r1172, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerNextAction = r1172Expected
    ? readStringAt(r1172, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerExplicitRowOwnerAssertionProvided = r1172Expected
    ? readBooleanAt(r1172, ["summary", "explicitRowOwnerAssertionProvided"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerArtifactWritten = r1172Expected
    ? readBooleanAt(r1172, ["summary", "safeAssertionArtifactWritten"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerRowOwnerAssertionStillRequired = r1172Expected
    ? readBooleanAt(r1172, ["summary", "rowOwnerAssertionStillRequired"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerWouldBeAcceptedByR1165 = r1172Expected
    ? readBooleanAt(r1172, ["summary", "materializedAssertionWouldBeAcceptedByR1165"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerR1165RunnerReady = r1172Expected
    ? readBooleanAt(r1172, ["summary", "r1165RunnerReadyForAssertion"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerR1165TemplateReady = r1172Expected
    ? readBooleanAt(r1172, ["summary", "r1165TemplateReady"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerR1167FillGuideReady = r1172Expected
    ? readBooleanAt(r1172, ["summary", "r1167FillGuideReady"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerAllowedValueKindIds = r1172Expected
    ? readStringArrayAt(r1172, ["summary", "allowedValueKindIds"])
    : [];
  const consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerBlockedContentIds = r1172Expected
    ? readStringArrayAt(r1172, ["summary", "blockedContentIds"])
    : [];
  const consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerSafeFieldEditCount = r1172Expected
    ? readNumberAt(r1172, ["summary", "safeFieldEditCount"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerSafeFieldEditPaths = r1172Expected
    ? readStringArrayAt(r1172, ["summary", "safeFieldEditPaths"])
    : [];
  const consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerRowLevelDataAcceptedByR1172 = r1172Expected
    ? readBooleanAt(r1172, ["summary", "rowLevelDataAcceptedByR1172"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerRowOwnerPrivateValuesStored = r1172Expected
    ? readBooleanAt(r1172, ["summary", "rowOwnerPrivateValuesStored"])
    : null;
  const r1173 = await readJsonIfPresent(
    options.r1173Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1173_EXPECTED.artifact),
  );
  validateOptionalInputBoundary("r1173", r1173);
  const r1173Expected = r1173MatchesExpected(r1173);
  const consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetArtifact = r1173Expected
    ? R1173_EXPECTED.artifact
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetCommand = r1173Expected
    ? R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetConclusion = r1173Expected
    ? readStringAt(r1173, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetNextAction = r1173Expected
    ? readStringAt(r1173, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetReadyForRowOwner = r1173Expected
    ? readBooleanAt(r1173, ["summary", "answerSheetReadyForRowOwner"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetMaterializerReady = r1173Expected
    ? readBooleanAt(r1173, ["summary", "materializerReady"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetMaterializerExplicitConfirmationRequired =
    r1173Expected
      ? readBooleanAt(r1173, ["summary", "materializerExplicitConfirmationRequired"])
      : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetExactSafeAnswerCount = r1173Expected
    ? readNumberAt(r1173, ["summary", "exactSafeAnswerCount"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetAllowedValueKindIds = r1173Expected
    ? readStringArrayAt(r1173, ["summary", "allowedValueKindIds"])
    : [];
  const consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetBlockedAssertionContentIds = r1173Expected
    ? readStringArrayAt(r1173, ["summary", "blockedAssertionContentIds"])
    : [];
  const consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetRequiredInputKindIds = r1173Expected
    ? readStringArrayAt(r1173, ["summary", "requiredInputKindIds"])
    : [];
  const consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetRequiredAssertionChecklistIds = r1173Expected
    ? readStringArrayAt(r1173, ["summary", "requiredAssertionChecklistIds"])
    : [];
  const consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetSafeFieldEditPaths = r1173Expected
    ? readStringArrayAt(r1173, ["summary", "safeFieldEditPaths"])
    : [];
  const consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetRowLevelDataAcceptedByR1173 = r1173Expected
    ? readBooleanAt(r1173, ["summary", "rowLevelDataAcceptedByR1173"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetRowOwnerProvidedValuesStored = r1173Expected
    ? readBooleanAt(r1173, ["summary", "rowOwnerProvidedValuesStored"])
    : null;
  const r1174 = await readJsonIfPresent(
    options.r1174Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1174_EXPECTED.artifact),
  );
  validateOptionalInputBoundary("r1174", r1174);
  const r1174Expected = r1174MatchesExpected(r1174);
  const consumerAverageSubmitterFeatureOnlySafeNextStepPacketArtifact = r1174Expected
    ? R1174_EXPECTED.artifact
    : null;
  const consumerAverageSubmitterFeatureOnlySafeNextStepPacketCommand = r1174Expected
    ? R1174_SAFE_NEXT_STEP_PACKET_COMMAND
    : null;
  const consumerAverageSubmitterFeatureOnlySafeNextStepPacketAllowedValueKindIds = r1174Expected
    ? readStringArrayAt(r1174, ["summary", "allowedValueKindIds"])
    : [];
  const consumerAverageSubmitterFeatureOnlySafeNextStepPacketBlockedContentIds = r1174Expected
    ? readStringArrayAt(r1174, ["summary", "blockedContentIds"])
    : [];
  const consumerAverageSubmitterFeatureOnlySafeNextStepPacketConclusion = r1174Expected
    ? readStringAt(r1174, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeNextStepPacketNextAction = r1174Expected
    ? readStringAt(r1174, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForRowOwnerR1172Confirmation = r1174Expected
    ? readBooleanAt(r1174, ["summary", "readyForRowOwnerR1172Confirmation"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForRowOwnerR1176LiveChainConfirmation = r1174Expected
    ? readBooleanAt(r1174, ["summary", "readyForRowOwnerR1176LiveChainConfirmation"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeNextStepPacketR1176LiveChainCommand = r1174Expected
    ? readStringAt(r1174, ["summary", "r1176LiveChainCommand"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForR1165Runner = r1174Expected
    ? readBooleanAt(r1174, ["summary", "readyForR1165Runner"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeNextStepPacketExactSafeFieldEditCount = r1174Expected
    ? readNumberAt(r1174, ["summary", "exactSafeFieldEditCount"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeNextStepPacketRowLevelDataAcceptedByR1174 = r1174Expected
    ? readBooleanAt(r1174, ["summary", "rowLevelDataAcceptedByR1174"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeNextStepPacketRowOwnerProvidedValuesStored = r1174Expected
    ? readBooleanAt(r1174, ["summary", "rowOwnerProvidedValuesStored"])
    : null;
  const r1170 = await readJsonIfPresent(
    options.r1170Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1170_EXPECTED.artifact),
  );
  validateOptionalInputBoundary("r1170", r1170);
  const r1170Expected = r1170MatchesExpected(r1170);
  const consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofArtifact = r1170Expected
    ? R1170_EXPECTED.artifact
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofCommand = r1170Expected
    ? R1170_SAFE_ASSERTION_SMOKE_PROOF_COMMAND
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofConclusion = r1170Expected
    ? readStringAt(r1170, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofNextAction = r1170Expected
    ? readStringAt(r1170, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofPassed = r1170Expected
    ? readBooleanAt(r1170, ["summary", "smokeProofPassed"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofSynthetic = r1170Expected
    ? readBooleanAt(r1170, ["summary", "syntheticSmokeProof"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofRealEvidenceProduced = r1170Expected
    ? readBooleanAt(r1170, ["summary", "realEvidenceProduced"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofModelEvidencePromotionAllowed = r1170Expected
    ? readBooleanAt(r1170, ["summary", "modelEvidencePromotionAllowed"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofLiveChainGateStillRequired = r1170Expected
    ? readBooleanAt(r1170, ["summary", "liveChainGateStillRequired"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofR1165AssertionAccepted = r1170Expected
    ? readBooleanAt(r1170, ["summary", "r1165AssertionAccepted"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofR1165ChildR1163Ran = r1170Expected
    ? readBooleanAt(r1170, ["summary", "r1165ChildR1163Ran"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofR1165FeatureOnlyResearchPlanningReady =
    r1170Expected ? readBooleanAt(r1170, ["summary", "r1165FeatureOnlyResearchPlanningReady"]) : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofSafeFieldEditCount = r1170Expected
    ? readNumberAt(r1170, ["summary", "safeFieldEditCount"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofSafeFieldEditPaths = r1170Expected
    ? readStringArrayAt(r1170, ["summary", "safeFieldEditPaths"])
    : [];
  const consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofRowLevelDataAcceptedByR1170 = r1170Expected
    ? readBooleanAt(r1170, ["summary", "rowLevelDataAcceptedByR1170"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofRowOwnerPrivateValuesStored = r1170Expected
    ? readBooleanAt(r1170, ["summary", "rowOwnerPrivateValuesStored"])
    : null;
  const r1175 = await readJsonIfPresent(
    options.r1175Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1175_EXPECTED.artifact),
  );
  validateOptionalInputBoundary("r1175", r1175);
  const r1175Expected = r1175MatchesExpected(r1175);
  const consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeArtifact = r1175Expected
    ? R1175_EXPECTED.artifact
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeCommand = r1175Expected
    ? R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_COMMAND
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeAllowedValueKindIds = r1175Expected
    ? readStringArrayAt(r1175, ["summary", "allowedValueKindIds"])
    : [];
  const consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeBlockedContentIds = r1175Expected
    ? readStringArrayAt(r1175, ["summary", "blockedContentIds"])
    : [];
  const consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeOptionalAddOnFamilyIds = r1175Expected
    ? readStringArrayAt(r1175, ["summary", "optionalAddOnFamilyIds"])
    : [];
  const consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeConclusion = r1175Expected
    ? readStringAt(r1175, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeNextAction = r1175Expected
    ? readStringAt(r1175, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokePassed = r1175Expected
    ? readBooleanAt(r1175, ["summary", "bridgeSmokePassed"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeSynthetic = r1175Expected
    ? readBooleanAt(r1175, ["summary", "syntheticSmokeProof"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeRealEvidenceProduced = r1175Expected
    ? readBooleanAt(r1175, ["summary", "realEvidenceProduced"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeModelEvidencePromotionAllowed = r1175Expected
    ? readBooleanAt(r1175, ["summary", "modelEvidencePromotionAllowed"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeLiveChainGateStillRequired = r1175Expected
    ? readBooleanAt(r1175, ["summary", "liveChainGateStillRequired"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1172MaterializedAssertionWritten = r1175Expected
    ? readBooleanAt(r1175, ["summary", "r1172MaterializedAssertionWritten"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1172WouldBeAcceptedByR1165 = r1175Expected
    ? readBooleanAt(r1175, ["summary", "r1172WouldBeAcceptedByR1165"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1165AssertionAccepted = r1175Expected
    ? readBooleanAt(r1175, ["summary", "r1165AssertionAccepted"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1165ChildR1163Ran = r1175Expected
    ? readBooleanAt(r1175, ["summary", "r1165ChildR1163Ran"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1165FeatureOnlyResearchPlanningReady = r1175Expected
    ? readBooleanAt(r1175, ["summary", "r1165FeatureOnlyResearchPlanningReady"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1163FeatureOnlyResearchPlanningReady = r1175Expected
    ? readBooleanAt(r1175, ["summary", "r1163FeatureOnlyResearchPlanningReady"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeSafeFieldEditCount = r1175Expected
    ? readNumberAt(r1175, ["summary", "safeFieldEditCount"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeSafeFieldEditPaths = r1175Expected
    ? readStringArrayAt(r1175, ["summary", "safeFieldEditPaths"])
    : [];
  const consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeRowLevelDataAcceptedByR1175 = r1175Expected
    ? readBooleanAt(r1175, ["summary", "rowLevelDataAcceptedByR1175"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeRowOwnerPrivateValuesStored = r1175Expected
    ? readBooleanAt(r1175, ["summary", "rowOwnerPrivateValuesStored"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeRowParsingPerformedByR1175 = r1175Expected
    ? readBooleanAt(r1175, ["summary", "rowParsingPerformedByR1175"])
    : null;
  const r1176 = await readJsonIfPresent(
    options.r1176Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1176_EXPECTED.artifact),
  );
  validateOptionalInputBoundary("r1176", r1176);
  const r1176Expected = r1176MatchesExpected(r1176);
  const consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainArtifact = r1176Expected
    ? R1176_EXPECTED.artifact
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainCommand = r1176Expected
    ? R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainAllowedValueKindIds = r1176Expected
    ? readStringArrayAt(r1176, ["summary", "allowedValueKindIds"])
    : [];
  const consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainBlockedContentIds = r1176Expected
    ? readStringArrayAt(r1176, ["summary", "blockedContentIds"])
    : [];
  const consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainOptionalAddOnFamilyIds = r1176Expected
    ? readStringArrayAt(r1176, ["summary", "optionalAddOnFamilyIds"])
    : [];
  const consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainCompletionModeId = r1176Expected
    ? readStringAt(r1176, ["summary", "ordinarySubmitterCompletionModeId"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainConclusion = r1176Expected
    ? readStringAt(r1176, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainNextAction = r1176Expected
    ? readStringAt(r1176, ["summary", "nextAction"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainReady = r1176Expected
    ? readBooleanAt(r1176, ["summary", "chainReady"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainExplicitRowOwnerAssertionProvided = r1176Expected
    ? readBooleanAt(r1176, ["summary", "explicitRowOwnerAssertionProvided"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainFeatureOnlyResearchPlanningReady = r1176Expected
    ? readBooleanAt(r1176, ["summary", "featureOnlyResearchPlanningReady"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRealEvidenceProduced = r1176Expected
    ? readBooleanAt(r1176, ["summary", "realEvidenceProduced"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainModelEvidencePromotionAllowed = r1176Expected
    ? readBooleanAt(r1176, ["summary", "modelEvidencePromotionAllowed"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainOutcomeLinkedModelEvidenceStillRequired =
    r1176Expected ? readBooleanAt(r1176, ["summary", "outcomeLinkedModelEvidenceStillRequired"]) : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowOwnerAssertionStillRequired = r1176Expected
    ? readBooleanAt(r1176, ["summary", "rowOwnerAssertionStillRequiredForLiveChain"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowOwnerHandoffReasonId = r1176Expected
    ? readStringAt(r1176, ["summary", "rowOwnerHandoffReasonId"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1172MaterializedAssertionWritten = r1176Expected
    ? readBooleanAt(r1176, ["summary", "r1172MaterializedAssertionWritten"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1172WouldBeAcceptedByR1165 = r1176Expected
    ? readBooleanAt(r1176, ["summary", "r1172WouldBeAcceptedByR1165"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1165AssertionAccepted = r1176Expected
    ? readBooleanAt(r1176, ["summary", "r1165AssertionAccepted"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1165ChildR1163Ran = r1176Expected
    ? readBooleanAt(r1176, ["summary", "r1165ChildR1163Ran"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1165FeatureOnlyResearchPlanningReady =
    r1176Expected ? readBooleanAt(r1176, ["summary", "r1165FeatureOnlyResearchPlanningReady"]) : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1163FeatureOnlyResearchPlanningReady =
    r1176Expected ? readBooleanAt(r1176, ["summary", "r1163FeatureOnlyResearchPlanningReady"]) : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainSafeFieldEditCount = r1176Expected
    ? readNumberAt(r1176, ["summary", "safeFieldEditCount"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainSafeFieldEditPaths = r1176Expected
    ? readStringArrayAt(r1176, ["summary", "safeFieldEditPaths"])
    : [];
  const consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainSafeCompletionChecklistItemIds = r1176Expected
    ? readStringArrayAt(r1176, ["summary", "ordinarySubmitterSafeCompletionChecklistItemIds"])
    : [];
  const consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowLevelDataAcceptedByR1176 = r1176Expected
    ? readBooleanAt(r1176, ["summary", "rowLevelDataAcceptedByR1176"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowOwnerPrivateValuesStored = r1176Expected
    ? readBooleanAt(r1176, ["summary", "rowOwnerPrivateValuesStored"])
    : null;
  const consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowParsingPerformedByR1176 = r1176Expected
    ? readBooleanAt(r1176, ["summary", "rowParsingPerformedByR1176"])
    : null;
  const r1185 = await readJsonIfPresent(
    options.r1185Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1185_EXPECTED.artifact),
  );
  validateOptionalInputBoundary("r1185", r1185);
  const r1185Expected = r1185MatchesExpected(r1185);
  const consumerAverageSubmitterSafeResponseSmokeProofArtifact = r1185Expected
    ? R1185_EXPECTED.artifact
    : null;
  const consumerAverageSubmitterSafeResponseSmokeProofCommand = r1185Expected
    ? R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_COMMAND
    : null;
  const consumerAverageSubmitterSafeResponseSmokeProofConclusion = r1185Expected
    ? readStringAt(r1185, ["summary", "conclusion"])
    : null;
  const consumerAverageSubmitterSafeResponseSmokeProofLiveR1184Conclusion = r1185Expected
    ? readStringAt(r1185, ["summary", "liveR1184Conclusion"])
    : null;
  const consumerAverageSubmitterSafeResponseSmokeProofLiveR1184ReadyForSyntheticSmoke = r1185Expected
    ? readBooleanAt(r1185, ["summary", "liveR1184ReadyForSyntheticSmoke"])
    : null;
  const consumerAverageSubmitterSafeResponseSmokeProofNextRealAction = r1185Expected
    ? readStringAt(r1185, ["summary", "nextRealAction"])
    : null;
  const consumerAverageSubmitterSafeResponseSmokeProofNextRealActionCommand = r1185Expected
    ? readStringAt(r1185, ["summary", "nextRealActionCommand"])
    : null;
  const consumerAverageSubmitterSafeResponseSmokeProofNextRealActionRequiresExplicitRowOwnerAssertion = r1185Expected
    ? readBooleanAt(r1185, ["summary", "nextRealActionRequiresExplicitRowOwnerAssertion"])
    : null;
  const consumerAverageSubmitterSafeResponseSmokeProofMinimumFeaturePairRequired = r1185Expected
    ? readStringArrayAt(r1185, ["smokeProof", "minimumFeaturePairRequired"])
    : [];
  const consumerAverageSubmitterSafeResponseSmokeProofPrioritizedInputKindIds = r1185Expected
    ? readStringArrayAt(r1185, ["smokeProof", "prioritizedInputKindIds"])
    : [];
  const consumerAverageSubmitterSafeResponseSmokeProofRequiredResponseFieldIds = r1185Expected
    ? readStringArrayAt(r1185, ["smokeProof", "requiredResponseFieldIds"])
    : [];
  const consumerAverageSubmitterSafeResponseSmokeProofSafeExecutionFeatureSlotIds = r1185Expected
    ? readStringArrayAt(r1185, ["smokeProof", "safeExecutionFeatureSlotIds"])
    : [];
  const consumerAverageSubmitterSafeResponseSmokeProofSyntheticPathAdvancedToFeatureOnlyResearchPlanning = r1185Expected
    ? readBooleanAt(r1185, ["summary", "syntheticPathAdvancedToFeatureOnlyResearchPlanning"])
    : null;
  const consumerAverageSubmitterSafeResponseSmokeProofSyntheticSmokeRan = r1185Expected
    ? readBooleanAt(r1185, ["summary", "syntheticSmokeRan"])
    : null;
  const consumerAverageSubmitterSafeResponseSmokeProofModelEvidencePromotionAllowed = r1185Expected
    ? readBooleanAt(r1185, ["smokeProof", "modelEvidencePromotionAllowed"])
    : null;
  const consumerAverageSubmitterSafeResponseSmokeProofProductDisplayAuthorized = r1185Expected
    ? readBooleanAt(r1185, ["smokeProof", "productDisplayAuthorized"])
    : null;
  const consumerAverageSubmitterSafeResponseSmokeProofRowLevelDataAcceptedByR1185 = r1185Expected
    ? readBooleanAt(r1185, ["smokeProof", "rowLevelDataAcceptedByR1185"])
    : null;
  const consumerAverageSubmitterSafeResponseSmokeProofRowOwnerConfirmationInferredByR1185 = r1185Expected
    ? readBooleanAt(r1185, ["smokeProof", "rowOwnerConfirmationInferredByR1185"])
    : null;
  const consumerAverageSubmitterSafeResponseSmokeProofRowOwnerPrivateValuesStored = r1185Expected
    ? readBooleanAt(r1185, ["smokeProof", "rowOwnerPrivateValuesStored"])
    : null;
  const consumerAverageSubmitterSafeResponseSmokeProofRowParsingPerformedByR1185 = r1185Expected
    ? readBooleanAt(r1185, ["smokeProof", "rowParsingPerformedByR1185"])
    : null;
  const consumerAverageSubmitterSafeResponseSmokeProofLiveArtifactsMutatedByR1185 = r1185Expected
    ? readBooleanAt(r1185, ["smokeProof", "liveArtifactsMutatedByR1185"])
    : null;
  const routerNextAction = r1075.output.summary.nextAction;
  const nextAction = concreteNextActionFor({
    consumerAverageSubmitterAvailabilityChainNextAction,
    consumerAverageSubmitterConfigBridgeNextAction,
    consumerAverageSubmitterManifestPacketNextAction,
    consumerAverageSubmitterPartialMetricIntakeNextAction,
    consumerAverageSubmitterPartialPrivateConfigHandoffNextAction,
    consumerAverageSubmitterPartialPrivateChainNextAction,
    consumerAverageSubmitterPartialPrivateMetricRunnerNextAction,
    consumerAverageSubmitterPartialReadinessChainNextAction,
    consumerAverageSubmitterPartialRoutePlannerNextAction,
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeNextAction,
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeReadyForR1142,
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeActionGuardPresent,
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketNextAction,
    consumerAverageSubmitterRowOwnerActionPacketNextAction,
    consumerAverageSubmitterSafeConfirmationAnswerSheetNextAction,
    consumerAverageSubmitterSafeConfirmationAnswerSheetReadyForRowOwner,
    consumerAverageSubmitterSafeConfirmationAssertionHandoffNextAction,
    consumerAverageSubmitterSafeConfirmationAssertionHandoffRowOwnerAssertionStillRequired,
    consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerNextAction,
    consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerRowOwnerAssertionStillRequired,
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetNextAction,
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetReadyForRowOwner,
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketNextAction,
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForRowOwnerR1172Confirmation,
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForRowOwnerR1176LiveChainConfirmation,
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForR1165Runner,
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerNextAction,
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerRowOwnerAssertionStillRequired,
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainNextAction,
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowOwnerAssertionStillRequired,
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerNextAction,
    consumerAverageSubmitterSafeConfirmationMaterializerNextAction,
    consumerAverageSubmitterSafeConfirmationMaterializerRowOwnerConfirmationStillRequired,
    consumerAverageSubmitterSafeConfirmationTranscriptionProofNextAction,
    consumerAverageSubmitterSafeConfirmationTranscriptionProofReadyForRowOwnerConfirmation,
    consumerAverageSubmitterSafeAvailabilityConfirmationNextAction,
    consumerRealEvidenceHandoffNextAction,
    routerNextAction,
  });

  const output: R1076CurrentAutoresearchLoopExecutorOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    executedSteps: {
      r1074TrueWearablePostDownloadRefresh: {
        packetId: r1074.output.packetId,
        schemaVersion: r1074.output.schemaVersion,
        status: r1074.output.status,
        summaryConclusion: r1074.output.summary.conclusion,
      },
      r1081NsrrSourceTableCandidateScanner: r1081 ? {
        packetId: r1081.output.packetId,
        schemaVersion: r1081.output.schemaVersion,
        status: r1081.output.status,
        summaryConclusion: r1081.output.nextStep.conclusion,
      } : null,
      r1079NsrrSleepAutonomicStandardizer: r1079 ? {
        packetId: r1079.output.packetId,
        schemaVersion: r1079.output.schemaVersion,
        status: r1079.output.status,
        summaryConclusion: r1079.output.nextStep.conclusion,
      } : null,
      r1078NsrrSleepAutonomicLocalLoop: r1078 ? {
        packetId: r1078.output.packetId,
        schemaVersion: r1078.output.schemaVersion,
        status: r1078.output.status,
        summaryConclusion: r1078.output.summary.conclusion,
      } : null,
      r1077NsrrSourceRouteAlignment: {
        packetId: r1077.output.packetId,
        schemaVersion: r1077.output.schemaVersion,
        status: r1077.output.status,
        summaryConclusion: r1077.output.summary.conclusion,
      },
      r1083FunctionMissingnessCalibrationAdjudication: {
        packetId: r1083.output.packetId,
        schemaVersion: r1083.output.schemaVersion,
        status: r1083.output.status,
        summaryConclusion: r1083.output.summary.conclusion,
      },
      r1084HaalsiFunctionMissingnessCalibrationAdjudication: {
        packetId: r1084.output.packetId,
        schemaVersion: r1084.output.schemaVersion,
        status: r1084.output.status,
        summaryConclusion: r1084.output.summary.conclusion,
      },
      r1075CurrentAutoresearchActionRouter: {
        packetId: r1075.output.packetId,
        schemaVersion: r1075.output.schemaVersion,
        status: r1075.output.status,
        summaryConclusion: r1075.output.summary.conclusion,
      },
    },
    nextLoop: {
      consumerAverageSubmitterFamilyIds,
      consumerAverageSubmitterAvailabilityConclusion,
      consumerAverageSubmitterAvailabilityManifestStatus,
      consumerAverageSubmitterAvailabilityMissingSourceFamilyIds,
      consumerAverageSubmitterAvailabilityNextAction,
      consumerAverageSubmitterAvailabilityPreflightArtifact,
      consumerAverageSubmitterAvailabilityReadyForPrivateConfigMapping,
      consumerAverageSubmitterConfigBridgeArtifact,
      consumerAverageSubmitterConfigBridgeAvailableSourceFamilyIds,
      consumerAverageSubmitterConfigBridgeConclusion,
      consumerAverageSubmitterConfigBridgeMappingPlanStatus,
      consumerAverageSubmitterConfigBridgeNextAction,
      consumerAverageSubmitterConfigBridgeReadyForPrivateConfigMapping,
      consumerAverageSubmitterConfigBridgeSelectedTableLayout,
      consumerAverageSubmitterManifestPacketArtifact,
      consumerAverageSubmitterManifestPacketConclusion,
      consumerAverageSubmitterManifestPacketMatchedRecipeIds,
      consumerAverageSubmitterManifestPacketMaterializerCommand,
      consumerAverageSubmitterManifestPacketNextAction,
      consumerAverageSubmitterManifestPacketPrimaryInputFamilyIds,
      consumerAverageSubmitterManifestPacketReadyForPrivateConfigMapping,
      consumerAverageSubmitterManifestPacketRecipeReadinessChainCommand,
      consumerAverageSubmitterManifestPacketSafeManifestAttestationsComplete,
      consumerAverageSubmitterManifestPacketPartialPrivateChainRunnerCommand,
      consumerAverageSubmitterManifestPacketPartialRouteRecipeIds,
      consumerAverageSubmitterManifestPacketPreferredRecipeIds,
      consumerAverageSubmitterManifestPacketRequiredLinkageFamilyIds,
      consumerAverageSubmitterAvailabilityChainArtifact,
      consumerAverageSubmitterAvailabilityChainConclusion,
      consumerAverageSubmitterAvailabilityChainManifestSupplied,
      consumerAverageSubmitterAvailabilityChainNextAction,
      consumerAverageSubmitterAvailabilityChainReadyForPrivateConfigMapping,
      consumerAverageSubmitterPartialRoutePlannerArtifact,
      consumerAverageSubmitterPartialRoutePlannerConclusion,
      consumerAverageSubmitterPartialRoutePlannerFullRouteReady,
      consumerAverageSubmitterPartialRoutePlannerNextAction,
      consumerAverageSubmitterPartialRoutePlannerReadyForPrivateConfigMapping,
      consumerAverageSubmitterPartialRoutePlannerReadyUnsupportedRouteIds,
      consumerAverageSubmitterPartialMetricIntakeArtifact,
      consumerAverageSubmitterPartialMetricIntakeConclusion,
      consumerAverageSubmitterPartialMetricIntakeNextAction,
      consumerAverageSubmitterPartialMetricIntakeReadyRouteIds,
      consumerAverageSubmitterPartialMetricIntakeTemplateArtifact,
      consumerAverageSubmitterPartialPrivateConfigHandoffArtifact,
      consumerAverageSubmitterPartialPrivateConfigHandoffConclusion,
      consumerAverageSubmitterPartialPrivateConfigHandoffEligibleRouteIds,
      consumerAverageSubmitterPartialPrivateConfigHandoffFullEvidenceGateCleared,
      consumerAverageSubmitterPartialPrivateConfigHandoffNextAction,
      consumerAverageSubmitterPartialPrivateConfigHandoffReadyMetricRouteIds,
      consumerAverageSubmitterPartialPrivateConfigHandoffRequiredFieldRefFamilies,
      consumerAverageSubmitterPartialPrivateConfigHandoffRequiredTableRefs,
      consumerAverageSubmitterPartialPrivateConfigHandoffTemplateArtifact,
      consumerAverageSubmitterPartialReadinessChainArtifact,
      consumerAverageSubmitterPartialReadinessChainConclusion,
      consumerAverageSubmitterPartialReadinessChainEligibleRouteIds,
      consumerAverageSubmitterPartialReadinessChainFullEvidenceGateCleared,
      consumerAverageSubmitterPartialReadinessChainManifestSupplied,
      consumerAverageSubmitterPartialReadinessChainNextAction,
      consumerAverageSubmitterPartialReadinessChainReadyMetricRouteIds,
      consumerAverageSubmitterPartialReadinessChainRequiredFieldRefFamilies,
      consumerAverageSubmitterPartialReadinessChainRequiredTableRefs,
      consumerAverageSubmitterPartialReadinessChainTemplateArtifact,
      consumerAverageSubmitterPartialPrivateMetricRunnerAggregateMetricsArtifact,
      consumerAverageSubmitterPartialPrivateMetricRunnerArtifact,
      consumerAverageSubmitterPartialPrivateMetricRunnerConclusion,
      consumerAverageSubmitterPartialPrivateMetricRunnerEligibleRouteIds,
      consumerAverageSubmitterPartialPrivateMetricRunnerExecutedRouteIds,
      consumerAverageSubmitterPartialPrivateMetricRunnerNextAction,
      consumerAverageSubmitterPartialPrivateMetricRunnerRequestedRouteIds,
      consumerAverageSubmitterPartialPrivateMetricRunnerRouteMetricsReadyForR1138,
      consumerAverageSubmitterPartialPrivateChainAggregateMetricsArtifact,
      consumerAverageSubmitterPartialPrivateChainArtifact,
      consumerAverageSubmitterPartialPrivateChainConclusion,
      consumerAverageSubmitterPartialPrivateChainEligibleRouteIds,
      consumerAverageSubmitterPartialPrivateChainExecutedRouteIds,
      consumerAverageSubmitterPartialPrivateChainFinalReadyRouteIds,
      consumerAverageSubmitterPartialPrivateChainFullEvidenceGateCleared,
      consumerAverageSubmitterPartialPrivateChainFullSupportedRouteReady,
      consumerAverageSubmitterPartialPrivateChainNextAction,
      consumerAverageSubmitterPartialPrivateChainRouteMetricsReadyForR1138,
      consumerAverageSubmitterCompletionAuditArtifact,
      consumerAverageSubmitterCompletionAuditBlockers,
      consumerAverageSubmitterCompletionAuditConclusion,
      consumerAverageSubmitterCompletionAuditGoalAchieved,
      consumerAverageSubmitterCompletionAuditMissingRequirementIds,
      consumerAverageSubmitterCompletionAuditNextAction,
      consumerAverageSubmitterCompletionAuditUnblockerBlockedRequirementIds,
      consumerAverageSubmitterCompletionAuditUnblockerBlockedStepIds,
      consumerAverageSubmitterCompletionAuditUnblockerCommandCount,
      consumerAverageSubmitterCompletionAuditUnblockerStepIds,
      consumerAverageSubmitterCompletionAuditUnblockerTopAllowedValueKindIds,
      consumerAverageSubmitterCompletionAuditUnblockerTopBlockedContentIds,
      consumerAverageSubmitterCompletionAuditUnblockerTopCommand,
      consumerAverageSubmitterCompletionAuditUnblockerTopNextAction,
      consumerAverageSubmitterCompletionAuditUnblockerTopRequirementId,
      consumerAverageSubmitterCompletionAuditUnblockerTopRequiredInputKindIds,
      consumerAverageSubmitterCompletionAuditUnblockerTopSafeCompletionChecklistItemIds,
      consumerAverageSubmitterCompletionAuditUnblockerTopStepId,
      consumerAverageSubmitterCompletionAuditProductDisplayAuthorized,
      consumerAverageSubmitterCompletionAuditReadyToMarkComplete,
      consumerAverageSubmitterCompletionAuditTopMissingRequirement,
      consumerAverageSubmitterRowOwnerActionPacketArtifact,
      consumerAverageSubmitterRowOwnerActionPacketBlockers,
      consumerAverageSubmitterRowOwnerActionPacketConclusion,
      consumerAverageSubmitterRowOwnerActionPacketFallbackRecipeIds,
      consumerAverageSubmitterRowOwnerActionPacketNextAction,
      consumerAverageSubmitterRowOwnerActionPacketRecommendedConfirmedRecipeCommand,
      consumerAverageSubmitterRowOwnerActionPacketRecommendedConfirmedRecipeCommandAvailable,
      consumerAverageSubmitterRowOwnerActionPacketSelectedRecipeId,
      consumerAverageSubmitterPostConfirmationPrivateConfigPacketArtifact,
      consumerAverageSubmitterPostConfirmationPrivateConfigPacketBlockers,
      consumerAverageSubmitterPostConfirmationPrivateConfigPacketConclusion,
      consumerAverageSubmitterPostConfirmationPrivateConfigPacketExpectedRouteIds,
      consumerAverageSubmitterPostConfirmationPrivateConfigPacketNextAction,
      consumerAverageSubmitterPostConfirmationPrivateConfigPacketRequiredFieldRefFamilies,
      consumerAverageSubmitterPostConfirmationPrivateConfigPacketRequiredTableRefs,
      consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigPrivateFieldRefKeys,
      consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigPrivateTableRefKeys,
      consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigRouteRunOrder,
      consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigSchemaVersion,
      consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigTopLevelKeys,
      consumerAverageSubmitterPostConfirmationPrivateConfigPacketRowOwnerAssertionsConfirmed,
      consumerAverageSubmitterPostConfirmationPrivateConfigPacketTemplateArtifact,
      consumerAverageSubmitterPostConfirmationPrivateConfigPacketTemplateReadyForFill,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeArtifact,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeConclusion,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeEvidenceRoleStatus,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeMissingAttestationKeys,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeMissingRouteIds,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeMissingRunnerFieldRefKeys,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeMissingRunnerTableRefKeys,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeNextAction,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeOrdinaryTableLayout,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakePacketReadyForConfigIntake,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakePrivateConfigStatus,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakePrivateConfigSupplied,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeR1147Conclusion,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeR1147NextAction,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeReadyForR1142,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeRequestedRouteIds,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeActionGuardPresent,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketConclusion,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketFeatureOnlyCoverageContextReady,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketMissingRequiredSourceFamilyIds,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketNextAction,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketRowLevelDataAcceptedByR1154,
      consumerAverageSubmitterLabWearableSubmissionKitArtifact,
      consumerAverageSubmitterLabWearableSubmissionKitConclusion,
      consumerAverageSubmitterLabWearableSubmissionKitNextAction,
      consumerAverageSubmitterLabWearableSubmissionKitOptionalAddOnFamilyIds,
      consumerAverageSubmitterLabWearableSubmissionKitPrivateConfigReadyForR1142,
      consumerAverageSubmitterLabWearableSubmissionKitPrivateConfigStatus,
      consumerAverageSubmitterLabWearableSubmissionKitReadyForResearchReview,
      consumerAverageSubmitterLabWearableSubmissionKitRequiredSourceFamilyIds,
      consumerAverageSubmitterLabWearableSubmissionKitRowOwnerAssertionsConfirmed,
      consumerAverageSubmitterLabWearableSubmissionKitTopBlocker,
      consumerAverageSubmitterSafeAvailabilityConfirmationArtifact,
      consumerAverageSubmitterSafeAvailabilityConfirmationConclusion,
      consumerAverageSubmitterSafeAvailabilityConfirmationMissingAggregateReadinessFactIds,
      consumerAverageSubmitterSafeAvailabilityConfirmationMissingAttestationKeys,
      consumerAverageSubmitterSafeAvailabilityConfirmationMissingFeatureOnlySourceFamilyIds,
      consumerAverageSubmitterSafeAvailabilityConfirmationMissingSourceFamilyIds,
      consumerAverageSubmitterSafeAvailabilityConfirmationFeatureOnlyCoverageContextReady,
      consumerAverageSubmitterSafeAvailabilityConfirmationFeatureOnlyCoverageRequiresPreferredPair,
      consumerAverageSubmitterSafeAvailabilityConfirmationChecklistItemIds,
      consumerAverageSubmitterSafeAvailabilityConfirmationMinimumFeaturePairRequired,
      consumerAverageSubmitterSafeAvailabilityConfirmationNextAction,
      consumerAverageSubmitterSafeAvailabilityConfirmationOutcomeLinkageRequiredForFeatureOnlyContext,
      consumerAverageSubmitterSafeAvailabilityConfirmationReadyForRecipeReadinessChain,
      consumerAverageSubmitterSafeAvailabilityConfirmationRowOwnerAssertionsConfirmed,
      consumerAverageSubmitterSafeAvailabilityConfirmationRowLevelDataAcceptedByR1150,
      consumerAverageSubmitterSafeAvailabilityConfirmationStatus,
      consumerAverageSubmitterSafeAvailabilityConfirmationTemplateArtifact,
      consumerAverageSubmitterSafeAvailabilityConfirmationFeatureOnlyTemplateArtifact,
      consumerAverageSubmitterFeatureOnlyModeArtifact,
      consumerAverageSubmitterFeatureOnlyModeConclusion,
      consumerAverageSubmitterFeatureOnlyModeCoverageContextAllowed,
      consumerAverageSubmitterFeatureOnlyModeCoverageRequiresPreferredPair,
      consumerAverageSubmitterFeatureOnlyModeCoverageContextTemplateArtifact,
      consumerAverageSubmitterFeatureOnlyModeMinimumFeaturePairRequired,
      consumerAverageSubmitterFeatureOnlyModeMissingAttestationKeys,
      consumerAverageSubmitterFeatureOnlyModeMissingEvidenceSourceFamilyIds,
      consumerAverageSubmitterFeatureOnlyModeMissingPrimaryFeatureFamilyIds,
      consumerAverageSubmitterFeatureOnlyModeModelEvidencePromotionAllowed,
      consumerAverageSubmitterFeatureOnlyModeNextAction,
      consumerAverageSubmitterFeatureOnlyModeOutcomeLinkageRequiredForFeatureOnlyContext,
      consumerAverageSubmitterFeatureOnlyModeOutcomeLinkedEvidenceReady,
      consumerAverageSubmitterFeatureOnlyModePreferredPairReady,
      consumerAverageSubmitterFeatureOnlyModeRowLevelDataAcceptedByR1151,
      consumerAverageSubmitterFeatureOnlyModeSafeAvailabilityFeatureOnlyCoverageContextReady,
      consumerAverageSubmitterFeatureOnlyModeSafeAvailabilityFeatureOnlyReadinessPresent,
      consumerAverageSubmitterFeatureOnlyModeSupportedFeatureFamilyIds,
      consumerAverageSubmitterFeatureOnlyCoverageContextIntakeArtifact,
      consumerAverageSubmitterFeatureOnlyCoverageContextIntakeConclusion,
      consumerAverageSubmitterFeatureOnlyCoverageContextIntakeContextStatus,
      consumerAverageSubmitterFeatureOnlyCoverageContextIntakeReadyForResearchPlanning,
      consumerAverageSubmitterFeatureOnlyCoverageContextIntakeMinimumFeaturePairRequired,
      consumerAverageSubmitterFeatureOnlyCoverageContextIntakeMissingPrimaryFeatureFamilyIds,
      consumerAverageSubmitterFeatureOnlyCoverageContextIntakeModelEvidencePromotionAllowed,
      consumerAverageSubmitterFeatureOnlyCoverageContextIntakeNextAction,
      consumerAverageSubmitterFeatureOnlyCoverageContextIntakeOutcomeLinkageRequiredForFeatureOnlyContext,
      consumerAverageSubmitterFeatureOnlyCoverageContextIntakeR1151ReadyForIntake,
      consumerAverageSubmitterFeatureOnlyCoverageContextIntakeRowLevelDataAcceptedByR1152,
      consumerAverageSubmitterFeatureOnlyCoverageContextIntakeSupportedFeatureFamilyIds,
      consumerAverageSubmitterFeatureOnlyChainArtifact,
      consumerAverageSubmitterFeatureOnlyChainConclusion,
      consumerAverageSubmitterFeatureOnlyChainContextPathConfigured,
      consumerAverageSubmitterFeatureOnlyChainCoverageContextReadyForResearchPlanning,
      consumerAverageSubmitterFeatureOnlyChainCoverageContextAllowed,
      consumerAverageSubmitterFeatureOnlyChainCoverageContextIntakeConclusion,
      consumerAverageSubmitterFeatureOnlyChainCoverageContextIntakeContextStatus,
      consumerAverageSubmitterFeatureOnlyChainFeatureOnlyModeConclusion,
      consumerAverageSubmitterFeatureOnlyChainMinimumFeaturePairRequired,
      consumerAverageSubmitterFeatureOnlyChainMissingCoverageContextPrimaryFeatureFamilyIds,
      consumerAverageSubmitterFeatureOnlyChainMissingFeatureOnlySourceFamilyIds,
      consumerAverageSubmitterFeatureOnlyChainModelEvidencePromotionAllowed,
      consumerAverageSubmitterFeatureOnlyChainNextAction,
      consumerAverageSubmitterFeatureOnlyChainOutcomeLinkageRequiredForFeatureOnlyContext,
      consumerAverageSubmitterFeatureOnlyChainRowLevelDataAcceptedByR1153,
      consumerAverageSubmitterFeatureOnlyChainSafeAvailabilityFeatureOnlyCoverageContextReady,
      consumerAverageSubmitterFeatureOnlyChainSafeAvailabilityReadyForRecipeReadinessChain,
      consumerAverageSubmitterFeatureOnlyChainSupportedFeatureFamilyIds,
      consumerAverageSubmitterSafeAvailabilityActionPacketArtifact,
      consumerAverageSubmitterSafeAvailabilityActionPacketCommand,
      consumerAverageSubmitterSafeAvailabilityActionPacketConclusion,
      consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyCoverageContextReady,
      consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyQuickstartArtifact,
      consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount,
      consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths,
      consumerAverageSubmitterSafeAvailabilityConfirmationIntakeCommand,
      consumerAverageSubmitterSafeAvailabilityFeatureOnlyChainRunnerCommand,
      consumerAverageSubmitterSafeAvailabilityOutcomeLinkedRecipeReadinessCommand,
      consumerAverageSubmitterSafeAvailabilityCompletionModeIds,
      consumerAverageSubmitterSafeAvailabilityActionPacketChecklistItemIds,
      consumerAverageSubmitterSafeAvailabilityActionPacketMinimumFeaturePairRequired,
      consumerAverageSubmitterSafeAvailabilityActionPacketMissingAggregateReadinessFactIds,
      consumerAverageSubmitterSafeAvailabilityActionPacketMissingAttestationKeys,
      consumerAverageSubmitterSafeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds,
      consumerAverageSubmitterSafeAvailabilityActionPacketMissingRequiredSourceFamilyIds,
      consumerAverageSubmitterSafeAvailabilityActionPacketNextAction,
      consumerAverageSubmitterSafeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain,
      consumerAverageSubmitterSafeAvailabilityActionPacketRowLevelDataAcceptedByR1154,
      consumerAverageSubmitterSafeAvailabilityActionPacketRowOwnerWorkType,
      consumerAverageSubmitterSafeAvailabilityActionPacketRowParsingPerformedByR1154,
      consumerAverageSubmitterSafeAvailabilityActionPacketTemplateArtifact,
      consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyTemplateArtifact,
      consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofArtifact,
      consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofConclusion,
      consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofNextAction,
      consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofFeatureOnlyChainConclusion,
      consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofFeatureOnlyCoverageContextReadyForResearchPlanning,
      consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofSafeAvailabilityConfirmationConclusion,
      consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofReadyForRecipeReadinessChain,
      consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofModelEvidencePromotionAllowed,
      consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofRowLevelDataAcceptedByR1155,
      consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofSmokeEvidence,
      consumerAverageSubmitterSafeConfirmationHandoffArtifact,
      consumerAverageSubmitterSafeConfirmationHandoffCommand,
      consumerAverageSubmitterSafeConfirmationHandoffConclusion,
      consumerAverageSubmitterSafeConfirmationHandoffNextAction,
      consumerAverageSubmitterSafeConfirmationHandoffFeatureOnlyPathMechanicallyProven,
      consumerAverageSubmitterSafeConfirmationHandoffHandoffReadyForRowOwner,
      consumerAverageSubmitterSafeConfirmationHandoffModelEvidencePromotionAllowed,
      consumerAverageSubmitterSafeConfirmationHandoffReadyForModelEvidence,
      consumerAverageSubmitterSafeConfirmationHandoffReadyForRecipeReadinessChain,
      consumerAverageSubmitterSafeConfirmationHandoffRequiredFeatureOnlySourceFamilyIds,
      consumerAverageSubmitterSafeConfirmationHandoffRequiredSafeCompletionCheckIds,
      consumerAverageSubmitterSafeConfirmationHandoffRowLevelDataAcceptedByR1156,
      consumerAverageSubmitterSafeConfirmationHandoffRowOwnerWorkType,
      consumerAverageSubmitterSafeConfirmationHandoffSafeConfirmationStillRequired,
      consumerAverageSubmitterSafeConfirmationHandoffSmokeEvidence,
      consumerAverageSubmitterSafeConfirmationChainRunnerArtifact,
      consumerAverageSubmitterSafeConfirmationChainRunnerCommand,
      consumerAverageSubmitterSafeConfirmationChainRunnerConclusion,
      consumerAverageSubmitterSafeConfirmationChainRunnerNextAction,
      consumerAverageSubmitterSafeConfirmationChainRunnerConfirmationPathConfigured,
      consumerAverageSubmitterSafeConfirmationChainRunnerFeatureOnlyCoverageContextReady,
      consumerAverageSubmitterSafeConfirmationChainRunnerFeatureOnlyResearchPlanningReady,
      consumerAverageSubmitterSafeConfirmationChainRunnerReadyForModelEvidence,
      consumerAverageSubmitterSafeConfirmationChainRunnerReadyForRecipeReadinessChain,
      consumerAverageSubmitterSafeConfirmationChainRunnerRowLevelDataAcceptedByR1157,
      consumerAverageSubmitterSafeConfirmationChainRunnerSafeConfirmationStillRequired,
      consumerAverageSubmitterSafeConfirmationFillGuideArtifact,
      consumerAverageSubmitterSafeConfirmationFillGuideCommand,
      consumerAverageSubmitterSafeConfirmationFillGuideConclusion,
      consumerAverageSubmitterSafeConfirmationFillGuideExactSafeFieldEditCount,
      consumerAverageSubmitterSafeConfirmationFillGuideGuideReadyForRowOwnerFill,
      consumerAverageSubmitterSafeConfirmationFillGuideMinimumFeaturePairRequired,
      consumerAverageSubmitterSafeConfirmationFillGuideNextAction,
      consumerAverageSubmitterSafeConfirmationFillGuideOptionalAddOnFamilyIds,
      consumerAverageSubmitterSafeConfirmationFillGuideRequiredChecklistIds,
      consumerAverageSubmitterSafeConfirmationFillGuideRequiredInputKindIds,
      consumerAverageSubmitterSafeConfirmationFillGuideRowLevelDataAcceptedByR1158,
      consumerAverageSubmitterSafeConfirmationAnswerSheetArtifact,
      consumerAverageSubmitterSafeConfirmationAnswerSheetCommand,
      consumerAverageSubmitterSafeConfirmationAnswerSheetConclusion,
      consumerAverageSubmitterSafeConfirmationAnswerSheetExactSafeAnswerCount,
      consumerAverageSubmitterSafeConfirmationAnswerSheetReadyForRowOwner,
      consumerAverageSubmitterSafeConfirmationAnswerSheetMinimumFeaturePairRequired,
      consumerAverageSubmitterSafeConfirmationAnswerSheetNextAction,
      consumerAverageSubmitterSafeConfirmationAnswerSheetOptionalAddOnFamilyIds,
      consumerAverageSubmitterSafeConfirmationAnswerSheetRequiredChecklistIds,
      consumerAverageSubmitterSafeConfirmationAnswerSheetRequiredInputKindIds,
      consumerAverageSubmitterSafeConfirmationAnswerSheetRowLevelDataAcceptedByR1159,
      consumerAverageSubmitterSafeConfirmationAnswerSheetRowOwnerProvidedValuesStored,
      consumerAverageSubmitterSafeConfirmationTranscriptionProofArtifact,
      consumerAverageSubmitterSafeConfirmationTranscriptionProofCommand,
      consumerAverageSubmitterSafeConfirmationTranscriptionProofConclusion,
      consumerAverageSubmitterSafeConfirmationTranscriptionProofExactSafeTranscriptionStepCount,
      consumerAverageSubmitterSafeConfirmationTranscriptionProofReadyForRowOwnerConfirmation,
      consumerAverageSubmitterSafeConfirmationTranscriptionProofHypotheticalTranscriptionWouldBeFeatureOnlyReady,
      consumerAverageSubmitterSafeConfirmationTranscriptionProofNextAction,
      consumerAverageSubmitterSafeConfirmationTranscriptionProofRequiredInputKindIds,
      consumerAverageSubmitterSafeConfirmationTranscriptionProofRowLevelDataAcceptedByR1160,
      consumerAverageSubmitterSafeConfirmationTranscriptionProofRowOwnerConfirmationStillRequired,
      consumerAverageSubmitterSafeConfirmationTranscriptionProofConfirmationValuesStoredByR1160,
      consumerAverageSubmitterSafeConfirmationTranscriptionProofRowOwnerProvidedValuesStored,
      consumerAverageSubmitterSafeConfirmationMaterializerArtifact,
      consumerAverageSubmitterSafeConfirmationMaterializerCommand,
      consumerAverageSubmitterSafeConfirmationMaterializerConclusion,
      consumerAverageSubmitterSafeConfirmationMaterializerNextAction,
      consumerAverageSubmitterSafeConfirmationMaterializerExplicitRowOwnerConfirmationAssertionProvided,
      consumerAverageSubmitterSafeConfirmationMaterializerSafeConfirmationArtifactWritten,
      consumerAverageSubmitterSafeConfirmationMaterializerSafeConfirmationArtifact,
      consumerAverageSubmitterSafeConfirmationMaterializerFeatureOnlyConfirmationWouldBeReadyForR1150,
      consumerAverageSubmitterSafeConfirmationMaterializerRowOwnerConfirmationStillRequired,
      consumerAverageSubmitterSafeConfirmationMaterializerConfirmationValuesStoredInR1161Packet,
      consumerAverageSubmitterSafeConfirmationMaterializerRowLevelDataAcceptedByR1161,
      consumerAverageSubmitterSafeConfirmationMaterializerRowOwnerPrivateValuesStored,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffArtifact,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffCommand,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffConclusion,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffNextAction,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffHandoffReadyForRowOwner,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffRowOwnerAssertionStillRequired,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffExplicitRowOwnerConfirmationAssertionProvided,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffSafeConfirmationArtifactWritten,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffFeatureOnlyConfirmationWouldBeReadyForR1150,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffRequiredInputKindIds,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffRequiredChecklistIds,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffMinimumFeaturePairRequired,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffMaterializerCommand,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffMaterializerNextAction,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffConfirmationValuesStoredByR1162,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffRowLevelDataAcceptedByR1162,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffRowOwnerPrivateValuesStored,
      consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerArtifact,
      consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerCommand,
      consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerConclusion,
      consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerNextAction,
      consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerExplicitRowOwnerAssertionProvided,
      consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerFeatureOnlyResearchPlanningReady,
      consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerFeatureOnlyChainRan,
      consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerRowOwnerAssertionStillRequired,
      consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerConfirmedSafeConfirmationArtifact,
      consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerSafeConfirmationArtifactWritten,
      consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerRowLevelDataAcceptedByR1163,
      consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerRowOwnerPrivateValuesStored,
      consumerAverageSubmitterFeatureOnlyResearchHandoffArtifact,
      consumerAverageSubmitterFeatureOnlyResearchHandoffCommand,
      consumerAverageSubmitterFeatureOnlyResearchHandoffConclusion,
      consumerAverageSubmitterFeatureOnlyResearchHandoffNextAction,
      consumerAverageSubmitterFeatureOnlyResearchHandoffFeatureOnlyResearchPlanningReady,
      consumerAverageSubmitterFeatureOnlyResearchHandoffResearchPlanningAllowed,
      consumerAverageSubmitterFeatureOnlyResearchHandoffOutcomeLinkedModelEvidenceStillRequired,
      consumerAverageSubmitterFeatureOnlyResearchHandoffPrioritizedInputKindIds,
      consumerAverageSubmitterFeatureOnlyResearchHandoffMinimumFeaturePairRequired,
      consumerAverageSubmitterFeatureOnlyResearchHandoffRowLevelDataAcceptedByR1164,
      consumerAverageSubmitterFeatureOnlyResearchHandoffRowOwnerPrivateValuesStored,
      consumerAverageSubmitterFeatureOnlySafeAssertionRunnerArtifact,
      consumerAverageSubmitterFeatureOnlySafeAssertionRunnerCommand,
      consumerAverageSubmitterFeatureOnlySafeAssertionRunnerConclusion,
      consumerAverageSubmitterFeatureOnlySafeAssertionRunnerNextAction,
      consumerAverageSubmitterFeatureOnlySafeAssertionRunnerAssertionAccepted,
      consumerAverageSubmitterFeatureOnlySafeAssertionRunnerAssertionProvided,
      consumerAverageSubmitterFeatureOnlySafeAssertionRunnerAssertionTemplateArtifact,
      consumerAverageSubmitterFeatureOnlySafeAssertionRunnerChildR1163Ran,
      consumerAverageSubmitterFeatureOnlySafeAssertionRunnerFeatureOnlyResearchPlanningReady,
      consumerAverageSubmitterFeatureOnlySafeAssertionRunnerRequiredInputKindIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionRunnerRequiredAssertionChecklistIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionRunnerOptionalAddOnFamilyIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionRunnerValidationReasonIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionRunnerRowLevelDataAcceptedByR1165,
      consumerAverageSubmitterFeatureOnlySafeAssertionRunnerRowOwnerPrivateValuesStored,
      consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideArtifact,
      consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideCommand,
      consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideConclusion,
      consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideNextAction,
      consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideGuideReadyForRowOwnerFill,
      consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideRequiredInputKindIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideOptionalAddOnFamilyIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideSafeFieldEditCount,
      consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideSafeFieldEditPaths,
      consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideRowLevelDataAcceptedByR1167,
      consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideRowOwnerPrivateValuesStored,
      consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetArtifact,
      consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetCommand,
      consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetConclusion,
      consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetNextAction,
      consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetReadyForRowOwner,
      consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetMaterializerReady,
      consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetMaterializerExplicitConfirmationRequired,
      consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetExactSafeAnswerCount,
      consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetAllowedValueKindIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetBlockedAssertionContentIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetRequiredInputKindIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetRequiredAssertionChecklistIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetSafeFieldEditPaths,
      consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetRowLevelDataAcceptedByR1173,
      consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetRowOwnerProvidedValuesStored,
      consumerAverageSubmitterFeatureOnlySafeNextStepPacketArtifact,
      consumerAverageSubmitterFeatureOnlySafeNextStepPacketCommand,
      consumerAverageSubmitterFeatureOnlySafeNextStepPacketAllowedValueKindIds,
      consumerAverageSubmitterFeatureOnlySafeNextStepPacketBlockedContentIds,
      consumerAverageSubmitterFeatureOnlySafeNextStepPacketConclusion,
      consumerAverageSubmitterFeatureOnlySafeNextStepPacketNextAction,
      consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForRowOwnerR1172Confirmation,
      consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForRowOwnerR1176LiveChainConfirmation,
      consumerAverageSubmitterFeatureOnlySafeNextStepPacketR1176LiveChainCommand,
      consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForR1165Runner,
      consumerAverageSubmitterFeatureOnlySafeNextStepPacketExactSafeFieldEditCount,
      consumerAverageSubmitterFeatureOnlySafeNextStepPacketRowLevelDataAcceptedByR1174,
      consumerAverageSubmitterFeatureOnlySafeNextStepPacketRowOwnerProvidedValuesStored,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerArtifact,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerCommand,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerConclusion,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerNextAction,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerExplicitRowOwnerAssertionProvided,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerArtifactWritten,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerRowOwnerAssertionStillRequired,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerWouldBeAcceptedByR1165,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerR1165RunnerReady,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerR1165TemplateReady,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerR1167FillGuideReady,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerAllowedValueKindIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerBlockedContentIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerSafeFieldEditCount,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerSafeFieldEditPaths,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerRowLevelDataAcceptedByR1172,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerRowOwnerPrivateValuesStored,
      consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofArtifact,
      consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofCommand,
      consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofConclusion,
      consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofNextAction,
      consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofPassed,
      consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofSynthetic,
      consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofRealEvidenceProduced,
      consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofModelEvidencePromotionAllowed,
      consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofLiveChainGateStillRequired,
      consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofR1165AssertionAccepted,
      consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofR1165ChildR1163Ran,
      consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofR1165FeatureOnlyResearchPlanningReady,
      consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofSafeFieldEditCount,
      consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofSafeFieldEditPaths,
      consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofRowLevelDataAcceptedByR1170,
      consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofRowOwnerPrivateValuesStored,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeArtifact,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeCommand,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeAllowedValueKindIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeBlockedContentIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeOptionalAddOnFamilyIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeConclusion,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeNextAction,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokePassed,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeSynthetic,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeRealEvidenceProduced,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeModelEvidencePromotionAllowed,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeLiveChainGateStillRequired,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1172MaterializedAssertionWritten,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1172WouldBeAcceptedByR1165,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1165AssertionAccepted,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1165ChildR1163Ran,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1165FeatureOnlyResearchPlanningReady,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1163FeatureOnlyResearchPlanningReady,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeSafeFieldEditCount,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeSafeFieldEditPaths,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeRowLevelDataAcceptedByR1175,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeRowOwnerPrivateValuesStored,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeRowParsingPerformedByR1175,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainArtifact,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainCommand,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainAllowedValueKindIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainBlockedContentIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainOptionalAddOnFamilyIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainCompletionModeId,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainConclusion,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainNextAction,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainReady,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainExplicitRowOwnerAssertionProvided,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainFeatureOnlyResearchPlanningReady,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRealEvidenceProduced,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainModelEvidencePromotionAllowed,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainOutcomeLinkedModelEvidenceStillRequired,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowOwnerAssertionStillRequired,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowOwnerHandoffReasonId,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1172MaterializedAssertionWritten,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1172WouldBeAcceptedByR1165,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1165AssertionAccepted,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1165ChildR1163Ran,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1165FeatureOnlyResearchPlanningReady,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1163FeatureOnlyResearchPlanningReady,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainSafeFieldEditCount,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainSafeFieldEditPaths,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainSafeCompletionChecklistItemIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowLevelDataAcceptedByR1176,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowOwnerPrivateValuesStored,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowParsingPerformedByR1176,
      consumerAverageSubmitterSafeResponseSmokeProofArtifact,
      consumerAverageSubmitterSafeResponseSmokeProofCommand,
      consumerAverageSubmitterSafeResponseSmokeProofConclusion,
      consumerAverageSubmitterSafeResponseSmokeProofLiveR1184Conclusion,
      consumerAverageSubmitterSafeResponseSmokeProofLiveR1184ReadyForSyntheticSmoke,
      consumerAverageSubmitterSafeResponseSmokeProofNextRealAction,
      consumerAverageSubmitterSafeResponseSmokeProofNextRealActionCommand,
      consumerAverageSubmitterSafeResponseSmokeProofNextRealActionRequiresExplicitRowOwnerAssertion,
      consumerAverageSubmitterSafeResponseSmokeProofMinimumFeaturePairRequired,
      consumerAverageSubmitterSafeResponseSmokeProofPrioritizedInputKindIds,
      consumerAverageSubmitterSafeResponseSmokeProofRequiredResponseFieldIds,
      consumerAverageSubmitterSafeResponseSmokeProofSafeExecutionFeatureSlotIds,
      consumerAverageSubmitterSafeResponseSmokeProofSyntheticPathAdvancedToFeatureOnlyResearchPlanning,
      consumerAverageSubmitterSafeResponseSmokeProofSyntheticSmokeRan,
      consumerAverageSubmitterSafeResponseSmokeProofModelEvidencePromotionAllowed,
      consumerAverageSubmitterSafeResponseSmokeProofProductDisplayAuthorized,
      consumerAverageSubmitterSafeResponseSmokeProofRowLevelDataAcceptedByR1185,
      consumerAverageSubmitterSafeResponseSmokeProofRowOwnerConfirmationInferredByR1185,
      consumerAverageSubmitterSafeResponseSmokeProofRowOwnerPrivateValuesStored,
      consumerAverageSubmitterSafeResponseSmokeProofRowParsingPerformedByR1185,
      consumerAverageSubmitterSafeResponseSmokeProofLiveArtifactsMutatedByR1185,
      consumerAverageSubmitterMissingSlotCount,
      consumerAverageSubmitterMissingSlotTypes,
      consumerAverageSubmitterNextAction,
      consumerAverageSubmitterReadinessArtifact,
      consumerAverageSubmitterReadinessConclusion,
      consumerAverageSubmitterReadyForPrivateRunner,
      consumerAverageSubmitterRealAggregateStillMissing,
      consumerAverageSubmitterSourceFamilyMissingSlotRollup,
      consumerFirstPassAggregateMetricsTemplateArtifact:
        r1075.output.summary.consumerFirstPassAggregateMetricsTemplateArtifact,
      consumerOrdinarySubmissionHandoffPlanArtifact:
        r1075.output.summary.consumerOrdinarySubmissionHandoffPlanArtifact,
      consumerOrdinarySourceFamilyIds: r1075.output.summary.consumerOrdinarySourceFamilyIds,
      consumerOrdinaryTableLayouts: r1075.output.summary.consumerOrdinaryTableLayouts,
      consumerPipelineSmokeConclusion,
      consumerPipelineSmokeSyntheticEvidence,
      consumerPipelineSmokeTableLayouts,
      consumerPrivateRunnerNextAction: r1075.output.currentState.consumerLoopNextAction,
      consumerRealEvidenceGateBlockers,
      consumerRealEvidenceGateConclusion,
      consumerRealEvidenceGateNextAction,
      consumerRealEvidenceHandoffArtifact,
      consumerRealEvidenceHandoffBlockers,
      consumerRealEvidenceHandoffMissingConfigChecklistCount,
      consumerRealEvidenceHandoffMissingConfigChecklistSlotTypes,
      consumerRealEvidenceHandoffConclusion,
      consumerRealEvidenceHandoffMissingConfigPieces,
      consumerRealEvidenceHandoffNextAction,
      consumerRealEvidenceHandoffPrivateConfigReadiness,
      consumerRealEvidenceHandoffRowOwnerWorkType,
      commands: executorCommandsFor({
        fallbackCommands: r1075.output.nextLoop.commands,
        nextAction: routerNextAction,
      }),
      nextAction,
      productDisplayAuthorized: false,
      reviewGptRequiredNow: r1075.output.summary.reviewGptRequiredNow,
      reviewGptUse: "only_for_real_aggregate_delta_or_major_architecture_fork",
      routerConclusion: r1075.output.summary.conclusion,
      routerNextAction,
    },
    packetId: "r1076-current-autoresearch-loop-executor",
    productDisplayAuthorized: false,
    schemaVersion: R1076_CURRENT_AUTORESEARCH_LOOP_EXECUTOR_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: conclusionFor({
        nextAction,
        routerConclusion: r1075.output.summary.conclusion,
      }),
      nextAction,
      productDisplayAuthorized: false,
      reviewGptRequiredNow: r1075.output.summary.reviewGptRequiredNow,
      rowParsingPerformedByR1076: false,
      routerConclusion: r1075.output.summary.conclusion,
      routerNextAction,
      consumerAverageSubmitterFamilyIds,
      consumerAverageSubmitterAvailabilityConclusion,
      consumerAverageSubmitterAvailabilityManifestStatus,
      consumerAverageSubmitterAvailabilityMissingSourceFamilyIds,
      consumerAverageSubmitterAvailabilityNextAction,
      consumerAverageSubmitterAvailabilityPreflightArtifact,
      consumerAverageSubmitterAvailabilityReadyForPrivateConfigMapping,
      consumerAverageSubmitterConfigBridgeArtifact,
      consumerAverageSubmitterConfigBridgeAvailableSourceFamilyIds,
      consumerAverageSubmitterConfigBridgeConclusion,
      consumerAverageSubmitterConfigBridgeMappingPlanStatus,
      consumerAverageSubmitterConfigBridgeNextAction,
      consumerAverageSubmitterConfigBridgeReadyForPrivateConfigMapping,
      consumerAverageSubmitterConfigBridgeSelectedTableLayout,
      consumerAverageSubmitterManifestPacketArtifact,
      consumerAverageSubmitterManifestPacketConclusion,
      consumerAverageSubmitterManifestPacketMatchedRecipeIds,
      consumerAverageSubmitterManifestPacketMaterializerCommand,
      consumerAverageSubmitterManifestPacketNextAction,
      consumerAverageSubmitterManifestPacketPrimaryInputFamilyIds,
      consumerAverageSubmitterManifestPacketReadyForPrivateConfigMapping,
      consumerAverageSubmitterManifestPacketRecipeReadinessChainCommand,
      consumerAverageSubmitterManifestPacketSafeManifestAttestationsComplete,
      consumerAverageSubmitterManifestPacketPartialPrivateChainRunnerCommand,
      consumerAverageSubmitterManifestPacketPartialRouteRecipeIds,
      consumerAverageSubmitterManifestPacketPreferredRecipeIds,
      consumerAverageSubmitterManifestPacketRequiredLinkageFamilyIds,
      consumerAverageSubmitterAvailabilityChainArtifact,
      consumerAverageSubmitterAvailabilityChainConclusion,
      consumerAverageSubmitterAvailabilityChainManifestSupplied,
      consumerAverageSubmitterAvailabilityChainNextAction,
      consumerAverageSubmitterAvailabilityChainReadyForPrivateConfigMapping,
      consumerAverageSubmitterPartialRoutePlannerArtifact,
      consumerAverageSubmitterPartialRoutePlannerConclusion,
      consumerAverageSubmitterPartialRoutePlannerFullRouteReady,
      consumerAverageSubmitterPartialRoutePlannerNextAction,
      consumerAverageSubmitterPartialRoutePlannerReadyForPrivateConfigMapping,
      consumerAverageSubmitterPartialRoutePlannerReadyUnsupportedRouteIds,
      consumerAverageSubmitterPartialMetricIntakeArtifact,
      consumerAverageSubmitterPartialMetricIntakeConclusion,
      consumerAverageSubmitterPartialMetricIntakeNextAction,
      consumerAverageSubmitterPartialMetricIntakeReadyRouteIds,
      consumerAverageSubmitterPartialMetricIntakeTemplateArtifact,
      consumerAverageSubmitterPartialPrivateConfigHandoffArtifact,
      consumerAverageSubmitterPartialPrivateConfigHandoffConclusion,
      consumerAverageSubmitterPartialPrivateConfigHandoffEligibleRouteIds,
      consumerAverageSubmitterPartialPrivateConfigHandoffFullEvidenceGateCleared,
      consumerAverageSubmitterPartialPrivateConfigHandoffNextAction,
      consumerAverageSubmitterPartialPrivateConfigHandoffReadyMetricRouteIds,
      consumerAverageSubmitterPartialPrivateConfigHandoffRequiredFieldRefFamilies,
      consumerAverageSubmitterPartialPrivateConfigHandoffRequiredTableRefs,
      consumerAverageSubmitterPartialPrivateConfigHandoffTemplateArtifact,
      consumerAverageSubmitterPartialReadinessChainArtifact,
      consumerAverageSubmitterPartialReadinessChainConclusion,
      consumerAverageSubmitterPartialReadinessChainEligibleRouteIds,
      consumerAverageSubmitterPartialReadinessChainFullEvidenceGateCleared,
      consumerAverageSubmitterPartialReadinessChainManifestSupplied,
      consumerAverageSubmitterPartialReadinessChainNextAction,
      consumerAverageSubmitterPartialReadinessChainReadyMetricRouteIds,
      consumerAverageSubmitterPartialReadinessChainRequiredFieldRefFamilies,
      consumerAverageSubmitterPartialReadinessChainRequiredTableRefs,
      consumerAverageSubmitterPartialReadinessChainTemplateArtifact,
      consumerAverageSubmitterPartialPrivateMetricRunnerAggregateMetricsArtifact,
      consumerAverageSubmitterPartialPrivateMetricRunnerArtifact,
      consumerAverageSubmitterPartialPrivateMetricRunnerConclusion,
      consumerAverageSubmitterPartialPrivateMetricRunnerEligibleRouteIds,
      consumerAverageSubmitterPartialPrivateMetricRunnerExecutedRouteIds,
      consumerAverageSubmitterPartialPrivateMetricRunnerNextAction,
      consumerAverageSubmitterPartialPrivateMetricRunnerRequestedRouteIds,
      consumerAverageSubmitterPartialPrivateMetricRunnerRouteMetricsReadyForR1138,
      consumerAverageSubmitterPartialPrivateChainAggregateMetricsArtifact,
      consumerAverageSubmitterPartialPrivateChainArtifact,
      consumerAverageSubmitterPartialPrivateChainConclusion,
      consumerAverageSubmitterPartialPrivateChainEligibleRouteIds,
      consumerAverageSubmitterPartialPrivateChainExecutedRouteIds,
      consumerAverageSubmitterPartialPrivateChainFinalReadyRouteIds,
      consumerAverageSubmitterPartialPrivateChainFullEvidenceGateCleared,
      consumerAverageSubmitterPartialPrivateChainFullSupportedRouteReady,
      consumerAverageSubmitterPartialPrivateChainNextAction,
      consumerAverageSubmitterPartialPrivateChainRouteMetricsReadyForR1138,
      consumerAverageSubmitterCompletionAuditArtifact,
      consumerAverageSubmitterCompletionAuditBlockers,
      consumerAverageSubmitterCompletionAuditConclusion,
      consumerAverageSubmitterCompletionAuditGoalAchieved,
      consumerAverageSubmitterCompletionAuditMissingRequirementIds,
      consumerAverageSubmitterCompletionAuditNextAction,
      consumerAverageSubmitterCompletionAuditUnblockerBlockedRequirementIds,
      consumerAverageSubmitterCompletionAuditUnblockerBlockedStepIds,
      consumerAverageSubmitterCompletionAuditUnblockerCommandCount,
      consumerAverageSubmitterCompletionAuditUnblockerStepIds,
      consumerAverageSubmitterCompletionAuditUnblockerTopAllowedValueKindIds,
      consumerAverageSubmitterCompletionAuditUnblockerTopBlockedContentIds,
      consumerAverageSubmitterCompletionAuditUnblockerTopCommand,
      consumerAverageSubmitterCompletionAuditUnblockerTopNextAction,
      consumerAverageSubmitterCompletionAuditUnblockerTopRequirementId,
      consumerAverageSubmitterCompletionAuditUnblockerTopRequiredInputKindIds,
      consumerAverageSubmitterCompletionAuditUnblockerTopSafeCompletionChecklistItemIds,
      consumerAverageSubmitterCompletionAuditUnblockerTopStepId,
      consumerAverageSubmitterCompletionAuditProductDisplayAuthorized,
      consumerAverageSubmitterCompletionAuditReadyToMarkComplete,
      consumerAverageSubmitterCompletionAuditTopMissingRequirement,
      consumerAverageSubmitterRowOwnerActionPacketArtifact,
      consumerAverageSubmitterRowOwnerActionPacketBlockers,
      consumerAverageSubmitterRowOwnerActionPacketConclusion,
      consumerAverageSubmitterRowOwnerActionPacketFallbackRecipeIds,
      consumerAverageSubmitterRowOwnerActionPacketNextAction,
      consumerAverageSubmitterRowOwnerActionPacketRecommendedConfirmedRecipeCommand,
      consumerAverageSubmitterRowOwnerActionPacketRecommendedConfirmedRecipeCommandAvailable,
      consumerAverageSubmitterRowOwnerActionPacketSelectedRecipeId,
      consumerAverageSubmitterPostConfirmationPrivateConfigPacketArtifact,
      consumerAverageSubmitterPostConfirmationPrivateConfigPacketBlockers,
      consumerAverageSubmitterPostConfirmationPrivateConfigPacketConclusion,
      consumerAverageSubmitterPostConfirmationPrivateConfigPacketExpectedRouteIds,
      consumerAverageSubmitterPostConfirmationPrivateConfigPacketNextAction,
      consumerAverageSubmitterPostConfirmationPrivateConfigPacketRequiredFieldRefFamilies,
      consumerAverageSubmitterPostConfirmationPrivateConfigPacketRequiredTableRefs,
      consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigPrivateFieldRefKeys,
      consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigPrivateTableRefKeys,
      consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigRouteRunOrder,
      consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigSchemaVersion,
      consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigTopLevelKeys,
      consumerAverageSubmitterPostConfirmationPrivateConfigPacketRowOwnerAssertionsConfirmed,
      consumerAverageSubmitterPostConfirmationPrivateConfigPacketTemplateArtifact,
      consumerAverageSubmitterPostConfirmationPrivateConfigPacketTemplateReadyForFill,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeArtifact,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeConclusion,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeEvidenceRoleStatus,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeMissingAttestationKeys,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeMissingRouteIds,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeMissingRunnerFieldRefKeys,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeMissingRunnerTableRefKeys,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeNextAction,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeOrdinaryTableLayout,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakePacketReadyForConfigIntake,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakePrivateConfigStatus,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakePrivateConfigSupplied,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeR1147Conclusion,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeR1147NextAction,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeReadyForR1142,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeRequestedRouteIds,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeActionGuardPresent,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketConclusion,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketFeatureOnlyCoverageContextReady,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketMissingRequiredSourceFamilyIds,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketNextAction,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain,
      consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketRowLevelDataAcceptedByR1154,
      consumerAverageSubmitterLabWearableSubmissionKitArtifact,
      consumerAverageSubmitterLabWearableSubmissionKitConclusion,
      consumerAverageSubmitterLabWearableSubmissionKitNextAction,
      consumerAverageSubmitterLabWearableSubmissionKitOptionalAddOnFamilyIds,
      consumerAverageSubmitterLabWearableSubmissionKitPrivateConfigReadyForR1142,
      consumerAverageSubmitterLabWearableSubmissionKitPrivateConfigStatus,
      consumerAverageSubmitterLabWearableSubmissionKitReadyForResearchReview,
      consumerAverageSubmitterLabWearableSubmissionKitRequiredSourceFamilyIds,
      consumerAverageSubmitterLabWearableSubmissionKitRowOwnerAssertionsConfirmed,
      consumerAverageSubmitterLabWearableSubmissionKitTopBlocker,
      consumerAverageSubmitterSafeAvailabilityConfirmationArtifact,
      consumerAverageSubmitterSafeAvailabilityConfirmationConclusion,
      consumerAverageSubmitterSafeAvailabilityConfirmationMissingAggregateReadinessFactIds,
      consumerAverageSubmitterSafeAvailabilityConfirmationMissingAttestationKeys,
      consumerAverageSubmitterSafeAvailabilityConfirmationMissingFeatureOnlySourceFamilyIds,
      consumerAverageSubmitterSafeAvailabilityConfirmationMissingSourceFamilyIds,
      consumerAverageSubmitterSafeAvailabilityConfirmationFeatureOnlyCoverageContextReady,
      consumerAverageSubmitterSafeAvailabilityConfirmationFeatureOnlyCoverageRequiresPreferredPair,
      consumerAverageSubmitterSafeAvailabilityConfirmationChecklistItemIds,
      consumerAverageSubmitterSafeAvailabilityConfirmationMinimumFeaturePairRequired,
      consumerAverageSubmitterSafeAvailabilityConfirmationNextAction,
      consumerAverageSubmitterSafeAvailabilityConfirmationOutcomeLinkageRequiredForFeatureOnlyContext,
      consumerAverageSubmitterSafeAvailabilityConfirmationReadyForRecipeReadinessChain,
      consumerAverageSubmitterSafeAvailabilityConfirmationRowOwnerAssertionsConfirmed,
      consumerAverageSubmitterSafeAvailabilityConfirmationRowLevelDataAcceptedByR1150,
      consumerAverageSubmitterSafeAvailabilityConfirmationStatus,
      consumerAverageSubmitterSafeAvailabilityConfirmationTemplateArtifact,
      consumerAverageSubmitterSafeAvailabilityConfirmationFeatureOnlyTemplateArtifact,
      consumerAverageSubmitterFeatureOnlyModeArtifact,
      consumerAverageSubmitterFeatureOnlyModeConclusion,
      consumerAverageSubmitterFeatureOnlyModeCoverageContextAllowed,
      consumerAverageSubmitterFeatureOnlyModeCoverageRequiresPreferredPair,
      consumerAverageSubmitterFeatureOnlyModeCoverageContextTemplateArtifact,
      consumerAverageSubmitterFeatureOnlyModeMinimumFeaturePairRequired,
      consumerAverageSubmitterFeatureOnlyModeMissingAttestationKeys,
      consumerAverageSubmitterFeatureOnlyModeMissingEvidenceSourceFamilyIds,
      consumerAverageSubmitterFeatureOnlyModeMissingPrimaryFeatureFamilyIds,
      consumerAverageSubmitterFeatureOnlyModeModelEvidencePromotionAllowed,
      consumerAverageSubmitterFeatureOnlyModeNextAction,
      consumerAverageSubmitterFeatureOnlyModeOutcomeLinkageRequiredForFeatureOnlyContext,
      consumerAverageSubmitterFeatureOnlyModeOutcomeLinkedEvidenceReady,
      consumerAverageSubmitterFeatureOnlyModePreferredPairReady,
      consumerAverageSubmitterFeatureOnlyModeRowLevelDataAcceptedByR1151,
      consumerAverageSubmitterFeatureOnlyModeSafeAvailabilityFeatureOnlyCoverageContextReady,
      consumerAverageSubmitterFeatureOnlyModeSafeAvailabilityFeatureOnlyReadinessPresent,
      consumerAverageSubmitterFeatureOnlyModeSupportedFeatureFamilyIds,
      consumerAverageSubmitterFeatureOnlyCoverageContextIntakeArtifact,
      consumerAverageSubmitterFeatureOnlyCoverageContextIntakeConclusion,
      consumerAverageSubmitterFeatureOnlyCoverageContextIntakeContextStatus,
      consumerAverageSubmitterFeatureOnlyCoverageContextIntakeReadyForResearchPlanning,
      consumerAverageSubmitterFeatureOnlyCoverageContextIntakeMinimumFeaturePairRequired,
      consumerAverageSubmitterFeatureOnlyCoverageContextIntakeMissingPrimaryFeatureFamilyIds,
      consumerAverageSubmitterFeatureOnlyCoverageContextIntakeModelEvidencePromotionAllowed,
      consumerAverageSubmitterFeatureOnlyCoverageContextIntakeNextAction,
      consumerAverageSubmitterFeatureOnlyCoverageContextIntakeOutcomeLinkageRequiredForFeatureOnlyContext,
      consumerAverageSubmitterFeatureOnlyCoverageContextIntakeR1151ReadyForIntake,
      consumerAverageSubmitterFeatureOnlyCoverageContextIntakeRowLevelDataAcceptedByR1152,
      consumerAverageSubmitterFeatureOnlyCoverageContextIntakeSupportedFeatureFamilyIds,
      consumerAverageSubmitterFeatureOnlyChainArtifact,
      consumerAverageSubmitterFeatureOnlyChainConclusion,
      consumerAverageSubmitterFeatureOnlyChainContextPathConfigured,
      consumerAverageSubmitterFeatureOnlyChainCoverageContextReadyForResearchPlanning,
      consumerAverageSubmitterFeatureOnlyChainCoverageContextAllowed,
      consumerAverageSubmitterFeatureOnlyChainCoverageContextIntakeConclusion,
      consumerAverageSubmitterFeatureOnlyChainCoverageContextIntakeContextStatus,
      consumerAverageSubmitterFeatureOnlyChainFeatureOnlyModeConclusion,
      consumerAverageSubmitterFeatureOnlyChainMinimumFeaturePairRequired,
      consumerAverageSubmitterFeatureOnlyChainMissingCoverageContextPrimaryFeatureFamilyIds,
      consumerAverageSubmitterFeatureOnlyChainMissingFeatureOnlySourceFamilyIds,
      consumerAverageSubmitterFeatureOnlyChainModelEvidencePromotionAllowed,
      consumerAverageSubmitterFeatureOnlyChainNextAction,
      consumerAverageSubmitterFeatureOnlyChainOutcomeLinkageRequiredForFeatureOnlyContext,
      consumerAverageSubmitterFeatureOnlyChainRowLevelDataAcceptedByR1153,
      consumerAverageSubmitterFeatureOnlyChainSafeAvailabilityFeatureOnlyCoverageContextReady,
      consumerAverageSubmitterFeatureOnlyChainSafeAvailabilityReadyForRecipeReadinessChain,
      consumerAverageSubmitterFeatureOnlyChainSupportedFeatureFamilyIds,
      consumerAverageSubmitterSafeAvailabilityActionPacketArtifact,
      consumerAverageSubmitterSafeAvailabilityActionPacketCommand,
      consumerAverageSubmitterSafeAvailabilityActionPacketConclusion,
      consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyCoverageContextReady,
      consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyQuickstartArtifact,
      consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount,
      consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths,
      consumerAverageSubmitterSafeAvailabilityConfirmationIntakeCommand,
      consumerAverageSubmitterSafeAvailabilityFeatureOnlyChainRunnerCommand,
      consumerAverageSubmitterSafeAvailabilityOutcomeLinkedRecipeReadinessCommand,
      consumerAverageSubmitterSafeAvailabilityCompletionModeIds,
      consumerAverageSubmitterSafeAvailabilityActionPacketChecklistItemIds,
      consumerAverageSubmitterSafeAvailabilityActionPacketMinimumFeaturePairRequired,
      consumerAverageSubmitterSafeAvailabilityActionPacketMissingAggregateReadinessFactIds,
      consumerAverageSubmitterSafeAvailabilityActionPacketMissingAttestationKeys,
      consumerAverageSubmitterSafeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds,
      consumerAverageSubmitterSafeAvailabilityActionPacketMissingRequiredSourceFamilyIds,
      consumerAverageSubmitterSafeAvailabilityActionPacketNextAction,
      consumerAverageSubmitterSafeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain,
      consumerAverageSubmitterSafeAvailabilityActionPacketRowLevelDataAcceptedByR1154,
      consumerAverageSubmitterSafeAvailabilityActionPacketRowOwnerWorkType,
      consumerAverageSubmitterSafeAvailabilityActionPacketRowParsingPerformedByR1154,
      consumerAverageSubmitterSafeAvailabilityActionPacketTemplateArtifact,
      consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyTemplateArtifact,
      consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofArtifact,
      consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofConclusion,
      consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofNextAction,
      consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofFeatureOnlyChainConclusion,
      consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofFeatureOnlyCoverageContextReadyForResearchPlanning,
      consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofSafeAvailabilityConfirmationConclusion,
      consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofReadyForRecipeReadinessChain,
      consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofModelEvidencePromotionAllowed,
      consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofRowLevelDataAcceptedByR1155,
      consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofSmokeEvidence,
      consumerAverageSubmitterSafeConfirmationHandoffArtifact,
      consumerAverageSubmitterSafeConfirmationHandoffCommand,
      consumerAverageSubmitterSafeConfirmationHandoffConclusion,
      consumerAverageSubmitterSafeConfirmationHandoffNextAction,
      consumerAverageSubmitterSafeConfirmationHandoffFeatureOnlyPathMechanicallyProven,
      consumerAverageSubmitterSafeConfirmationHandoffHandoffReadyForRowOwner,
      consumerAverageSubmitterSafeConfirmationHandoffModelEvidencePromotionAllowed,
      consumerAverageSubmitterSafeConfirmationHandoffReadyForModelEvidence,
      consumerAverageSubmitterSafeConfirmationHandoffReadyForRecipeReadinessChain,
      consumerAverageSubmitterSafeConfirmationHandoffRequiredFeatureOnlySourceFamilyIds,
      consumerAverageSubmitterSafeConfirmationHandoffRequiredSafeCompletionCheckIds,
      consumerAverageSubmitterSafeConfirmationHandoffRowLevelDataAcceptedByR1156,
      consumerAverageSubmitterSafeConfirmationHandoffRowOwnerWorkType,
      consumerAverageSubmitterSafeConfirmationHandoffSafeConfirmationStillRequired,
      consumerAverageSubmitterSafeConfirmationHandoffSmokeEvidence,
      consumerAverageSubmitterSafeConfirmationChainRunnerArtifact,
      consumerAverageSubmitterSafeConfirmationChainRunnerCommand,
      consumerAverageSubmitterSafeConfirmationChainRunnerConclusion,
      consumerAverageSubmitterSafeConfirmationChainRunnerNextAction,
      consumerAverageSubmitterSafeConfirmationChainRunnerConfirmationPathConfigured,
      consumerAverageSubmitterSafeConfirmationChainRunnerFeatureOnlyCoverageContextReady,
      consumerAverageSubmitterSafeConfirmationChainRunnerFeatureOnlyResearchPlanningReady,
      consumerAverageSubmitterSafeConfirmationChainRunnerReadyForModelEvidence,
      consumerAverageSubmitterSafeConfirmationChainRunnerReadyForRecipeReadinessChain,
      consumerAverageSubmitterSafeConfirmationChainRunnerRowLevelDataAcceptedByR1157,
      consumerAverageSubmitterSafeConfirmationChainRunnerSafeConfirmationStillRequired,
      consumerAverageSubmitterSafeConfirmationFillGuideArtifact,
      consumerAverageSubmitterSafeConfirmationFillGuideCommand,
      consumerAverageSubmitterSafeConfirmationFillGuideConclusion,
      consumerAverageSubmitterSafeConfirmationFillGuideExactSafeFieldEditCount,
      consumerAverageSubmitterSafeConfirmationFillGuideGuideReadyForRowOwnerFill,
      consumerAverageSubmitterSafeConfirmationFillGuideMinimumFeaturePairRequired,
      consumerAverageSubmitterSafeConfirmationFillGuideNextAction,
      consumerAverageSubmitterSafeConfirmationFillGuideOptionalAddOnFamilyIds,
      consumerAverageSubmitterSafeConfirmationFillGuideRequiredChecklistIds,
      consumerAverageSubmitterSafeConfirmationFillGuideRequiredInputKindIds,
      consumerAverageSubmitterSafeConfirmationFillGuideRowLevelDataAcceptedByR1158,
      consumerAverageSubmitterSafeConfirmationAnswerSheetArtifact,
      consumerAverageSubmitterSafeConfirmationAnswerSheetCommand,
      consumerAverageSubmitterSafeConfirmationAnswerSheetConclusion,
      consumerAverageSubmitterSafeConfirmationAnswerSheetExactSafeAnswerCount,
      consumerAverageSubmitterSafeConfirmationAnswerSheetReadyForRowOwner,
      consumerAverageSubmitterSafeConfirmationAnswerSheetMinimumFeaturePairRequired,
      consumerAverageSubmitterSafeConfirmationAnswerSheetNextAction,
      consumerAverageSubmitterSafeConfirmationAnswerSheetOptionalAddOnFamilyIds,
      consumerAverageSubmitterSafeConfirmationAnswerSheetRequiredChecklistIds,
      consumerAverageSubmitterSafeConfirmationAnswerSheetRequiredInputKindIds,
      consumerAverageSubmitterSafeConfirmationAnswerSheetRowLevelDataAcceptedByR1159,
      consumerAverageSubmitterSafeConfirmationAnswerSheetRowOwnerProvidedValuesStored,
      consumerAverageSubmitterSafeConfirmationTranscriptionProofArtifact,
      consumerAverageSubmitterSafeConfirmationTranscriptionProofCommand,
      consumerAverageSubmitterSafeConfirmationTranscriptionProofConclusion,
      consumerAverageSubmitterSafeConfirmationTranscriptionProofExactSafeTranscriptionStepCount,
      consumerAverageSubmitterSafeConfirmationTranscriptionProofReadyForRowOwnerConfirmation,
      consumerAverageSubmitterSafeConfirmationTranscriptionProofHypotheticalTranscriptionWouldBeFeatureOnlyReady,
      consumerAverageSubmitterSafeConfirmationTranscriptionProofNextAction,
      consumerAverageSubmitterSafeConfirmationTranscriptionProofRequiredInputKindIds,
      consumerAverageSubmitterSafeConfirmationTranscriptionProofRowLevelDataAcceptedByR1160,
      consumerAverageSubmitterSafeConfirmationTranscriptionProofRowOwnerConfirmationStillRequired,
      consumerAverageSubmitterSafeConfirmationTranscriptionProofConfirmationValuesStoredByR1160,
      consumerAverageSubmitterSafeConfirmationTranscriptionProofRowOwnerProvidedValuesStored,
      consumerAverageSubmitterSafeConfirmationMaterializerArtifact,
      consumerAverageSubmitterSafeConfirmationMaterializerCommand,
      consumerAverageSubmitterSafeConfirmationMaterializerConclusion,
      consumerAverageSubmitterSafeConfirmationMaterializerNextAction,
      consumerAverageSubmitterSafeConfirmationMaterializerExplicitRowOwnerConfirmationAssertionProvided,
      consumerAverageSubmitterSafeConfirmationMaterializerSafeConfirmationArtifactWritten,
      consumerAverageSubmitterSafeConfirmationMaterializerSafeConfirmationArtifact,
      consumerAverageSubmitterSafeConfirmationMaterializerFeatureOnlyConfirmationWouldBeReadyForR1150,
      consumerAverageSubmitterSafeConfirmationMaterializerRowOwnerConfirmationStillRequired,
      consumerAverageSubmitterSafeConfirmationMaterializerConfirmationValuesStoredInR1161Packet,
      consumerAverageSubmitterSafeConfirmationMaterializerRowLevelDataAcceptedByR1161,
      consumerAverageSubmitterSafeConfirmationMaterializerRowOwnerPrivateValuesStored,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffArtifact,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffCommand,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffConclusion,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffNextAction,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffHandoffReadyForRowOwner,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffRowOwnerAssertionStillRequired,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffExplicitRowOwnerConfirmationAssertionProvided,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffSafeConfirmationArtifactWritten,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffFeatureOnlyConfirmationWouldBeReadyForR1150,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffRequiredInputKindIds,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffRequiredChecklistIds,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffMinimumFeaturePairRequired,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffMaterializerCommand,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffMaterializerNextAction,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffConfirmationValuesStoredByR1162,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffRowLevelDataAcceptedByR1162,
      consumerAverageSubmitterSafeConfirmationAssertionHandoffRowOwnerPrivateValuesStored,
      consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerArtifact,
      consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerCommand,
      consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerConclusion,
      consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerNextAction,
      consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerExplicitRowOwnerAssertionProvided,
      consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerFeatureOnlyResearchPlanningReady,
      consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerFeatureOnlyChainRan,
      consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerRowOwnerAssertionStillRequired,
      consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerConfirmedSafeConfirmationArtifact,
      consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerSafeConfirmationArtifactWritten,
      consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerRowLevelDataAcceptedByR1163,
      consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerRowOwnerPrivateValuesStored,
      consumerAverageSubmitterFeatureOnlyResearchHandoffArtifact,
      consumerAverageSubmitterFeatureOnlyResearchHandoffCommand,
      consumerAverageSubmitterFeatureOnlyResearchHandoffConclusion,
      consumerAverageSubmitterFeatureOnlyResearchHandoffNextAction,
      consumerAverageSubmitterFeatureOnlyResearchHandoffFeatureOnlyResearchPlanningReady,
      consumerAverageSubmitterFeatureOnlyResearchHandoffResearchPlanningAllowed,
      consumerAverageSubmitterFeatureOnlyResearchHandoffOutcomeLinkedModelEvidenceStillRequired,
      consumerAverageSubmitterFeatureOnlyResearchHandoffPrioritizedInputKindIds,
      consumerAverageSubmitterFeatureOnlyResearchHandoffMinimumFeaturePairRequired,
      consumerAverageSubmitterFeatureOnlyResearchHandoffRowLevelDataAcceptedByR1164,
      consumerAverageSubmitterFeatureOnlyResearchHandoffRowOwnerPrivateValuesStored,
      consumerAverageSubmitterFeatureOnlySafeAssertionRunnerArtifact,
      consumerAverageSubmitterFeatureOnlySafeAssertionRunnerCommand,
      consumerAverageSubmitterFeatureOnlySafeAssertionRunnerConclusion,
      consumerAverageSubmitterFeatureOnlySafeAssertionRunnerNextAction,
      consumerAverageSubmitterFeatureOnlySafeAssertionRunnerAssertionAccepted,
      consumerAverageSubmitterFeatureOnlySafeAssertionRunnerAssertionProvided,
      consumerAverageSubmitterFeatureOnlySafeAssertionRunnerAssertionTemplateArtifact,
      consumerAverageSubmitterFeatureOnlySafeAssertionRunnerChildR1163Ran,
      consumerAverageSubmitterFeatureOnlySafeAssertionRunnerFeatureOnlyResearchPlanningReady,
      consumerAverageSubmitterFeatureOnlySafeAssertionRunnerRequiredInputKindIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionRunnerRequiredAssertionChecklistIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionRunnerOptionalAddOnFamilyIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionRunnerValidationReasonIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionRunnerRowLevelDataAcceptedByR1165,
      consumerAverageSubmitterFeatureOnlySafeAssertionRunnerRowOwnerPrivateValuesStored,
      consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideArtifact,
      consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideCommand,
      consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideConclusion,
      consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideNextAction,
      consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideGuideReadyForRowOwnerFill,
      consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideRequiredInputKindIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideOptionalAddOnFamilyIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideSafeFieldEditCount,
      consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideSafeFieldEditPaths,
      consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideRowLevelDataAcceptedByR1167,
      consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideRowOwnerPrivateValuesStored,
      consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetArtifact,
      consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetCommand,
      consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetConclusion,
      consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetNextAction,
      consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetReadyForRowOwner,
      consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetMaterializerReady,
      consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetMaterializerExplicitConfirmationRequired,
      consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetExactSafeAnswerCount,
      consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetAllowedValueKindIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetBlockedAssertionContentIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetRequiredInputKindIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetRequiredAssertionChecklistIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetSafeFieldEditPaths,
      consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetRowLevelDataAcceptedByR1173,
      consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetRowOwnerProvidedValuesStored,
      consumerAverageSubmitterFeatureOnlySafeNextStepPacketArtifact,
      consumerAverageSubmitterFeatureOnlySafeNextStepPacketCommand,
      consumerAverageSubmitterFeatureOnlySafeNextStepPacketAllowedValueKindIds,
      consumerAverageSubmitterFeatureOnlySafeNextStepPacketBlockedContentIds,
      consumerAverageSubmitterFeatureOnlySafeNextStepPacketConclusion,
      consumerAverageSubmitterFeatureOnlySafeNextStepPacketNextAction,
      consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForRowOwnerR1172Confirmation,
      consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForRowOwnerR1176LiveChainConfirmation,
      consumerAverageSubmitterFeatureOnlySafeNextStepPacketR1176LiveChainCommand,
      consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForR1165Runner,
      consumerAverageSubmitterFeatureOnlySafeNextStepPacketExactSafeFieldEditCount,
      consumerAverageSubmitterFeatureOnlySafeNextStepPacketRowLevelDataAcceptedByR1174,
      consumerAverageSubmitterFeatureOnlySafeNextStepPacketRowOwnerProvidedValuesStored,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerArtifact,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerCommand,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerConclusion,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerNextAction,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerExplicitRowOwnerAssertionProvided,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerArtifactWritten,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerRowOwnerAssertionStillRequired,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerWouldBeAcceptedByR1165,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerR1165RunnerReady,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerR1165TemplateReady,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerR1167FillGuideReady,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerAllowedValueKindIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerBlockedContentIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerSafeFieldEditCount,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerSafeFieldEditPaths,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerRowLevelDataAcceptedByR1172,
      consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerRowOwnerPrivateValuesStored,
      consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofArtifact,
      consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofCommand,
      consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofConclusion,
      consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofNextAction,
      consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofPassed,
      consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofSynthetic,
      consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofRealEvidenceProduced,
      consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofModelEvidencePromotionAllowed,
      consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofLiveChainGateStillRequired,
      consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofR1165AssertionAccepted,
      consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofR1165ChildR1163Ran,
      consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofR1165FeatureOnlyResearchPlanningReady,
      consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofSafeFieldEditCount,
      consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofSafeFieldEditPaths,
      consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofRowLevelDataAcceptedByR1170,
      consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofRowOwnerPrivateValuesStored,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeArtifact,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeCommand,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeAllowedValueKindIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeBlockedContentIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeOptionalAddOnFamilyIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeConclusion,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeNextAction,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokePassed,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeSynthetic,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeRealEvidenceProduced,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeModelEvidencePromotionAllowed,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeLiveChainGateStillRequired,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1172MaterializedAssertionWritten,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1172WouldBeAcceptedByR1165,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1165AssertionAccepted,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1165ChildR1163Ran,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1165FeatureOnlyResearchPlanningReady,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1163FeatureOnlyResearchPlanningReady,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeSafeFieldEditCount,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeSafeFieldEditPaths,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeRowLevelDataAcceptedByR1175,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeRowOwnerPrivateValuesStored,
      consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeRowParsingPerformedByR1175,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainArtifact,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainCommand,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainAllowedValueKindIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainBlockedContentIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainOptionalAddOnFamilyIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainCompletionModeId,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainConclusion,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainNextAction,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainReady,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainExplicitRowOwnerAssertionProvided,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainFeatureOnlyResearchPlanningReady,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRealEvidenceProduced,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainModelEvidencePromotionAllowed,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainOutcomeLinkedModelEvidenceStillRequired,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowOwnerAssertionStillRequired,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowOwnerHandoffReasonId,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1172MaterializedAssertionWritten,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1172WouldBeAcceptedByR1165,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1165AssertionAccepted,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1165ChildR1163Ran,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1165FeatureOnlyResearchPlanningReady,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1163FeatureOnlyResearchPlanningReady,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainSafeFieldEditCount,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainSafeFieldEditPaths,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainSafeCompletionChecklistItemIds,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowLevelDataAcceptedByR1176,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowOwnerPrivateValuesStored,
      consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowParsingPerformedByR1176,
      consumerAverageSubmitterSafeResponseSmokeProofArtifact,
      consumerAverageSubmitterSafeResponseSmokeProofCommand,
      consumerAverageSubmitterSafeResponseSmokeProofConclusion,
      consumerAverageSubmitterSafeResponseSmokeProofLiveR1184Conclusion,
      consumerAverageSubmitterSafeResponseSmokeProofLiveR1184ReadyForSyntheticSmoke,
      consumerAverageSubmitterSafeResponseSmokeProofNextRealAction,
      consumerAverageSubmitterSafeResponseSmokeProofNextRealActionCommand,
      consumerAverageSubmitterSafeResponseSmokeProofNextRealActionRequiresExplicitRowOwnerAssertion,
      consumerAverageSubmitterSafeResponseSmokeProofMinimumFeaturePairRequired,
      consumerAverageSubmitterSafeResponseSmokeProofPrioritizedInputKindIds,
      consumerAverageSubmitterSafeResponseSmokeProofRequiredResponseFieldIds,
      consumerAverageSubmitterSafeResponseSmokeProofSafeExecutionFeatureSlotIds,
      consumerAverageSubmitterSafeResponseSmokeProofSyntheticPathAdvancedToFeatureOnlyResearchPlanning,
      consumerAverageSubmitterSafeResponseSmokeProofSyntheticSmokeRan,
      consumerAverageSubmitterSafeResponseSmokeProofModelEvidencePromotionAllowed,
      consumerAverageSubmitterSafeResponseSmokeProofProductDisplayAuthorized,
      consumerAverageSubmitterSafeResponseSmokeProofRowLevelDataAcceptedByR1185,
      consumerAverageSubmitterSafeResponseSmokeProofRowOwnerConfirmationInferredByR1185,
      consumerAverageSubmitterSafeResponseSmokeProofRowOwnerPrivateValuesStored,
      consumerAverageSubmitterSafeResponseSmokeProofRowParsingPerformedByR1185,
      consumerAverageSubmitterSafeResponseSmokeProofLiveArtifactsMutatedByR1185,
      consumerAverageSubmitterMissingSlotCount,
      consumerAverageSubmitterMissingSlotTypes,
      consumerAverageSubmitterNextAction,
      consumerAverageSubmitterReadinessArtifact,
      consumerAverageSubmitterReadinessConclusion,
      consumerAverageSubmitterReadyForPrivateRunner,
      consumerAverageSubmitterRealAggregateStillMissing,
      consumerAverageSubmitterSourceFamilyMissingSlotRollup,
      consumerFirstPassAggregateMetricsTemplateArtifact:
        r1075.output.summary.consumerFirstPassAggregateMetricsTemplateArtifact,
      consumerOrdinarySubmissionHandoffPlanArtifact:
        r1075.output.summary.consumerOrdinarySubmissionHandoffPlanArtifact,
      consumerOrdinarySourceFamilyIds: r1075.output.summary.consumerOrdinarySourceFamilyIds,
      consumerOrdinaryTableLayouts: r1075.output.summary.consumerOrdinaryTableLayouts,
      consumerPipelineSmokeConclusion,
      consumerPipelineSmokeSyntheticEvidence,
      consumerPipelineSmokeTableLayouts,
      consumerPrivateRunnerNextAction: r1075.output.currentState.consumerLoopNextAction,
      consumerRealEvidenceGateBlockers,
      consumerRealEvidenceGateConclusion,
      consumerRealEvidenceGateNextAction,
      consumerRealEvidenceHandoffArtifact,
      consumerRealEvidenceHandoffBlockers,
      consumerRealEvidenceHandoffMissingConfigChecklistCount,
      consumerRealEvidenceHandoffMissingConfigChecklistSlotTypes,
      consumerRealEvidenceHandoffConclusion,
      consumerRealEvidenceHandoffMissingConfigPieces,
      consumerRealEvidenceHandoffNextAction,
      consumerRealEvidenceHandoffPrivateConfigReadiness,
      consumerRealEvidenceHandoffRowOwnerWorkType,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1076 current autoresearch loop executor failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function runOptionalR1081(input: {
  analyticCachePath?: string;
  candidateDraftPath?: string;
  manifestPath?: string;
  outputDir: string;
  scanRoots?: string[];
}): Promise<Awaited<ReturnType<typeof runR1081NsrrSourceTableCandidateScanner>> | null> {
  if (input.analyticCachePath?.trim() || input.manifestPath?.trim()) return null;
  const scanRoots = input.scanRoots?.map((root) => root.trim()).filter(Boolean) ?? [];
  if (scanRoots.length === 0) return null;
  return runR1081NsrrSourceTableCandidateScanner({
    outputDir: input.outputDir,
    privateCandidateDraftPath: input.candidateDraftPath,
    scanRoots,
  });
}

async function runOptionalR1078(input: {
  analyticCachePath?: string;
  createdAt?: string;
  outputDir: string;
  r1079: Awaited<ReturnType<typeof runR1079NsrrSleepAutonomicStandardizer>> | null;
}): Promise<Awaited<ReturnType<typeof runR1078NsrrSleepAutonomicLocalLoop>> | null> {
  const explicitAnalyticCachePath = input.analyticCachePath?.trim();
  if (explicitAnalyticCachePath) {
    return runR1078NsrrSleepAutonomicLocalLoop({
      analyticCachePath: explicitAnalyticCachePath,
      createdAt: input.createdAt,
      outputDir: input.outputDir,
    });
  }
  if (input.r1079) {
    if (!input.r1079.output.summary.readyForR1078) return null;
    return runR1078NsrrSleepAutonomicLocalLoop({
      analyticCachePath: input.r1079.analyticCachePath,
      createdAt: input.createdAt,
      endpoint: input.r1079.output.endpoint,
      horizon: input.r1079.output.horizon,
      outputDir: input.outputDir,
    });
  }
  const analyticCachePath = await existingDefaultNsrrAnalyticCachePath();
  if (!analyticCachePath) return null;
  return runR1078NsrrSleepAutonomicLocalLoop({
    analyticCachePath,
    createdAt: input.createdAt,
    outputDir: input.outputDir,
  });
}

async function runOptionalR1079(input: {
  analyticCachePath?: string;
  createdAt?: string;
  manifestPath?: string;
  outputDir: string;
}): Promise<Awaited<ReturnType<typeof runR1079NsrrSleepAutonomicStandardizer>> | null> {
  const manifestPath = input.manifestPath?.trim() || await existingDefaultNsrrStandardizerManifestPath();
  if (!manifestPath) return null;
  return runR1079NsrrSleepAutonomicStandardizer({
    createdAt: input.createdAt,
    manifestPath,
    outputAnalyticCachePath: input.analyticCachePath,
    outputDir: input.outputDir,
  });
}

async function existingDefaultNsrrAnalyticCachePath(): Promise<string | null> {
  try {
    await access(R1078_DEFAULT_ANALYTIC_CACHE_PATH);
    return R1078_DEFAULT_ANALYTIC_CACHE_PATH;
  } catch {
    return null;
  }
}

async function existingDefaultNsrrStandardizerManifestPath(): Promise<string | null> {
  try {
    await access(R1079_DEFAULT_PRIVATE_MANIFEST_PATH);
    return R1079_DEFAULT_PRIVATE_MANIFEST_PATH;
  } catch {
    return null;
  }
}

function conclusionFor(input: {
  nextAction: string;
  routerConclusion: string;
}): ExecutorConclusion {
  if (input.routerConclusion === "current_loop_ready_for_consumer_first_pass_aggregate_metrics") {
    if (isSafeAvailabilityConfirmationAction(input.nextAction)) {
      return "executor_waiting_on_consumer_safe_availability_confirmation";
    }
    if (input.nextAction === "refresh_r1148_post_confirmation_private_config_intake") {
      return "executor_refresh_consumer_safe_action_chain";
    }
    if (input.nextAction === "run_r1144_recipe_readiness_chain_with_confirmed_availability") {
      return "executor_ready_for_consumer_recipe_readiness_chain";
    }
    if (input.nextAction === FEATURE_ONLY_SAFE_AVAILABILITY_NEXT_ACTION) {
      return "executor_ready_for_consumer_feature_only_chain";
    }
    if (input.nextAction === "fill_post_confirmation_private_config_and_run_r1142") {
      return "executor_ready_for_consumer_private_config";
    }
    if (input.nextAction === "run_r1142_for_real_lab_wearable_route_metrics") {
      return "executor_ready_for_consumer_route_metrics";
    }
    return "executor_ready_for_consumer_first_pass_aggregate_metrics";
  }
  if (input.routerConclusion === "current_loop_hold_consumer_no_delta_continue_source_search") {
    return "executor_hold_consumer_no_delta_continue_source_search";
  }
  if (input.routerConclusion === "current_loop_ready_for_function_adjudication") {
    return "executor_ready_for_function_adjudication";
  }
  if (input.routerConclusion === "current_loop_ready_for_nsrr_aggregate_receipt") {
    return "executor_ready_for_nsrr_aggregate_receipt";
  }
  if (input.routerConclusion === "current_loop_ready_for_reviewgpt_scientific_delta") {
    return "executor_ready_for_reviewgpt_scientific_delta";
  }
  if (input.routerConclusion === "current_loop_repair_direction_inputs") {
    return "executor_repair_direction_inputs";
  }
  return "executor_blocked_on_true_wearable_data";
}

function isSafeAvailabilityConfirmationAction(nextAction: string): boolean {
  return [
    "complete_safe_availability_confirmation_template",
    "fill_r1165_row_owner_feature_only_safe_assertion_template",
    "fill_safe_availability_confirmation_from_template",
    "fill_r1150_feature_only_safe_confirmation_from_r1159_answer_sheet",
    "rerun_r1161_with_row_owner_feature_only_confirmation_assertion",
    "rerun_r1172_with_row_owner_feature_only_safe_assertion_confirmation",
    "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation",
    "row_owner_assert_feature_only_lab_wearable_availability_then_run_r1161_materializer",
    "row_owner_confirm_r1150_feature_only_safe_availability_from_r1160_transcription_proof",
    "rerun_safe_availability_confirmation_with_valid_json_object",
    "run_r1150_intake_with_r1161_confirmed_feature_only_safe_availability_confirmation",
  ].includes(nextAction);
}

function concreteNextActionFor(input: {
  consumerAverageSubmitterAvailabilityChainNextAction: string | null;
  consumerAverageSubmitterConfigBridgeNextAction: string | null;
  consumerAverageSubmitterManifestPacketNextAction: string | null;
  consumerAverageSubmitterPartialMetricIntakeNextAction: string | null;
  consumerAverageSubmitterPartialPrivateConfigHandoffNextAction: string | null;
  consumerAverageSubmitterPartialPrivateChainNextAction: string | null;
  consumerAverageSubmitterPartialPrivateMetricRunnerNextAction: string | null;
  consumerAverageSubmitterPartialReadinessChainNextAction: string | null;
  consumerAverageSubmitterPartialRoutePlannerNextAction: string | null;
  consumerAverageSubmitterPostConfirmationPrivateConfigIntakeNextAction: string | null;
  consumerAverageSubmitterPostConfirmationPrivateConfigIntakeReadyForR1142: boolean | null;
  consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeActionGuardPresent: boolean | null;
  consumerAverageSubmitterPostConfirmationPrivateConfigPacketNextAction: string | null;
  consumerAverageSubmitterRowOwnerActionPacketNextAction: string | null;
  consumerAverageSubmitterSafeConfirmationAnswerSheetNextAction: string | null;
  consumerAverageSubmitterSafeConfirmationAnswerSheetReadyForRowOwner: boolean | null;
  consumerAverageSubmitterSafeConfirmationAssertionHandoffNextAction: string | null;
  consumerAverageSubmitterSafeConfirmationAssertionHandoffRowOwnerAssertionStillRequired: boolean | null;
  consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerNextAction: string | null;
  consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerRowOwnerAssertionStillRequired: boolean | null;
  consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetNextAction: string | null;
  consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetReadyForRowOwner: boolean | null;
  consumerAverageSubmitterFeatureOnlySafeNextStepPacketNextAction: string | null;
  consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForRowOwnerR1172Confirmation: boolean | null;
  consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForRowOwnerR1176LiveChainConfirmation: boolean | null;
  consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForR1165Runner: boolean | null;
  consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerNextAction: string | null;
  consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerRowOwnerAssertionStillRequired: boolean | null;
  consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainNextAction: string | null;
  consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowOwnerAssertionStillRequired: boolean | null;
  consumerAverageSubmitterFeatureOnlySafeAssertionRunnerNextAction: string | null;
  consumerAverageSubmitterSafeConfirmationMaterializerNextAction: string | null;
  consumerAverageSubmitterSafeConfirmationMaterializerRowOwnerConfirmationStillRequired: boolean | null;
  consumerAverageSubmitterSafeConfirmationTranscriptionProofNextAction: string | null;
  consumerAverageSubmitterSafeConfirmationTranscriptionProofReadyForRowOwnerConfirmation: boolean | null;
  consumerAverageSubmitterSafeAvailabilityConfirmationNextAction: string | null;
  consumerRealEvidenceHandoffNextAction: string | null;
  routerNextAction: string;
}): string {
  const promoteFeatureOnlySafeAssertionLiveChainAction = (nextAction: string): string => {
    if (
      input.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowOwnerAssertionStillRequired === true
      && input.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainNextAction
        === "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation"
      && (
        nextAction === "row_owner_assert_feature_only_lab_wearable_availability_then_run_r1163_runner"
        || nextAction === "rerun_r1172_with_row_owner_feature_only_safe_assertion_confirmation"
        || nextAction === "keep_live_chain_waiting_on_explicit_row_owner_r1172_confirmation"
      )
    ) {
      return input.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainNextAction;
    }
    return nextAction;
  };

  const promoteSafeConfirmationAnswerSheetAction = (nextAction: string): string => {
    const liveChainPromotedAction = promoteFeatureOnlySafeAssertionLiveChainAction(nextAction);
    if (liveChainPromotedAction !== nextAction) return liveChainPromotedAction;
    if (
      nextAction === "row_owner_assert_feature_only_lab_wearable_availability_then_run_r1163_runner"
      && input.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerRowOwnerAssertionStillRequired === true
      && input.consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForRowOwnerR1176LiveChainConfirmation === true
      && input.consumerAverageSubmitterFeatureOnlySafeNextStepPacketNextAction
    ) {
      return input.consumerAverageSubmitterFeatureOnlySafeNextStepPacketNextAction;
    }
    if (
      nextAction === "row_owner_assert_feature_only_lab_wearable_availability_then_run_r1163_runner"
      && input.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerRowOwnerAssertionStillRequired === true
      && input.consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForRowOwnerR1172Confirmation === true
      && input.consumerAverageSubmitterFeatureOnlySafeNextStepPacketNextAction
    ) {
      return input.consumerAverageSubmitterFeatureOnlySafeNextStepPacketNextAction;
    }
    if (
      nextAction === "row_owner_assert_feature_only_lab_wearable_availability_then_run_r1163_runner"
      && input.consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForR1165Runner === true
      && input.consumerAverageSubmitterFeatureOnlySafeNextStepPacketNextAction
    ) {
      return input.consumerAverageSubmitterFeatureOnlySafeNextStepPacketNextAction;
    }
    if (
      nextAction === "row_owner_assert_feature_only_lab_wearable_availability_then_run_r1163_runner"
      && input.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerRowOwnerAssertionStillRequired === true
      && input.consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetReadyForRowOwner === true
      && input.consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetNextAction
    ) {
      return input.consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetNextAction;
    }
    if (
      nextAction === "row_owner_assert_feature_only_lab_wearable_availability_then_run_r1163_runner"
      && input.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerRowOwnerAssertionStillRequired === true
      && input.consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetReadyForRowOwner !== true
    ) {
      return "refresh_r1173_safe_assertion_answer_sheet";
    }
    if (
      nextAction === "row_owner_assert_feature_only_lab_wearable_availability_then_run_r1163_runner"
      && input.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerRowOwnerAssertionStillRequired === true
      && input.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerNextAction
    ) {
      return input.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerNextAction;
    }
    if (
      nextAction === "row_owner_assert_feature_only_lab_wearable_availability_then_run_r1163_runner"
      && input.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerNextAction
    ) {
      return input.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerNextAction;
    }
    if (
      (nextAction === "fill_safe_availability_confirmation_from_template"
        || nextAction === "fill_r1150_feature_only_safe_confirmation_from_r1159_answer_sheet")
      && input.consumerAverageSubmitterSafeConfirmationTranscriptionProofReadyForRowOwnerConfirmation === true
      && input.consumerAverageSubmitterSafeConfirmationTranscriptionProofNextAction
    ) {
      if (input.consumerAverageSubmitterSafeConfirmationMaterializerNextAction) {
        const downstreamAction = input.consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerNextAction
          ?? input.consumerAverageSubmitterSafeConfirmationAssertionHandoffNextAction
          ?? input.consumerAverageSubmitterSafeConfirmationMaterializerNextAction;
        return promoteSafeConfirmationAnswerSheetAction(downstreamAction);
      }
      return input.consumerAverageSubmitterSafeConfirmationTranscriptionProofNextAction;
    }
    if (
      nextAction === "fill_safe_availability_confirmation_from_template"
      && input.consumerAverageSubmitterSafeConfirmationAnswerSheetReadyForRowOwner === true
      && input.consumerAverageSubmitterSafeConfirmationAnswerSheetNextAction
    ) {
      return input.consumerAverageSubmitterSafeConfirmationAnswerSheetNextAction;
    }
    return nextAction;
  };

  if (
    input.routerNextAction === "fill_consumer_first_pass_aggregate_metrics_template"
    && input.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeActionGuardPresent === false
  ) {
    return "refresh_r1148_post_confirmation_private_config_intake";
  }
  if (
    input.routerNextAction === "fill_consumer_first_pass_aggregate_metrics_template"
    && input.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeReadyForR1142 === true
    && input.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeNextAction
  ) {
    return promoteSafeConfirmationAnswerSheetAction(
      input.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeNextAction,
    );
  }
  if (
    input.routerNextAction === "fill_consumer_first_pass_aggregate_metrics_template"
    && input.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeActionGuardPresent === true
    && input.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeNextAction
      === FEATURE_ONLY_SAFE_AVAILABILITY_NEXT_ACTION
  ) {
    return promoteSafeConfirmationAnswerSheetAction(
      input.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeNextAction,
    );
  }
  if (
    input.routerNextAction === "fill_consumer_first_pass_aggregate_metrics_template"
    && input.consumerAverageSubmitterPostConfirmationPrivateConfigPacketNextAction
    && input.consumerAverageSubmitterPostConfirmationPrivateConfigPacketNextAction
      !== "run_recommended_confirmed_recipe_chain_before_private_config_packet"
  ) {
    return promoteSafeConfirmationAnswerSheetAction(
      input.consumerAverageSubmitterPostConfirmationPrivateConfigPacketNextAction,
    );
  }
  if (
    input.routerNextAction === "fill_consumer_first_pass_aggregate_metrics_template"
    && input.consumerAverageSubmitterSafeAvailabilityConfirmationNextAction
    && input.consumerAverageSubmitterSafeAvailabilityConfirmationNextAction !== "refresh_r1149_submitter_kit"
  ) {
    return promoteSafeConfirmationAnswerSheetAction(
      input.consumerAverageSubmitterSafeAvailabilityConfirmationNextAction,
    );
  }
  if (
    input.routerNextAction === "fill_consumer_first_pass_aggregate_metrics_template"
    && input.consumerAverageSubmitterRowOwnerActionPacketNextAction
  ) {
    return promoteSafeConfirmationAnswerSheetAction(
      input.consumerAverageSubmitterRowOwnerActionPacketNextAction,
    );
  }
  if (
    input.routerNextAction === "fill_consumer_first_pass_aggregate_metrics_template"
    && input.consumerAverageSubmitterPartialPrivateChainNextAction
  ) {
    return input.consumerAverageSubmitterPartialPrivateChainNextAction;
  }
  if (
    input.routerNextAction === "fill_consumer_first_pass_aggregate_metrics_template"
    && input.consumerAverageSubmitterPartialReadinessChainNextAction
      === "fill_partial_private_config_for_ready_routes_then_run_r1141_partial_private_metric_runner"
    && input.consumerAverageSubmitterPartialPrivateMetricRunnerNextAction
    && input.consumerAverageSubmitterPartialPrivateMetricRunnerNextAction !== "run_r1140_or_r1139_until_partial_routes_ready"
  ) {
    return input.consumerAverageSubmitterPartialPrivateMetricRunnerNextAction;
  }
  if (
    input.routerNextAction === "fill_consumer_first_pass_aggregate_metrics_template"
    && input.consumerAverageSubmitterPartialReadinessChainNextAction
  ) {
    return input.consumerAverageSubmitterPartialReadinessChainNextAction;
  }
  if (
    input.routerNextAction === "fill_consumer_first_pass_aggregate_metrics_template"
    && input.consumerAverageSubmitterPartialPrivateConfigHandoffNextAction
    && input.consumerAverageSubmitterPartialPrivateConfigHandoffNextAction !== "fill_safe_availability_manifest_then_run_r1136_r1137_chain"
  ) {
    return input.consumerAverageSubmitterPartialPrivateConfigHandoffNextAction;
  }
  if (
    input.routerNextAction === "fill_consumer_first_pass_aggregate_metrics_template"
    && input.consumerAverageSubmitterPartialMetricIntakeNextAction
    && input.consumerAverageSubmitterPartialMetricIntakeNextAction !== "fill_safe_availability_manifest_then_run_r1136_r1137_chain"
  ) {
    return input.consumerAverageSubmitterPartialMetricIntakeNextAction;
  }
  if (
    input.routerNextAction === "fill_consumer_first_pass_aggregate_metrics_template"
    && input.consumerAverageSubmitterPartialRoutePlannerNextAction
  ) {
    return input.consumerAverageSubmitterPartialRoutePlannerNextAction;
  }
  if (
    input.routerNextAction === "fill_consumer_first_pass_aggregate_metrics_template"
    && input.consumerAverageSubmitterAvailabilityChainNextAction
  ) {
    return input.consumerAverageSubmitterAvailabilityChainNextAction;
  }
  if (
    input.routerNextAction === "fill_consumer_first_pass_aggregate_metrics_template"
    && input.consumerAverageSubmitterManifestPacketNextAction
  ) {
    return input.consumerAverageSubmitterManifestPacketNextAction;
  }
  if (
    input.routerNextAction === "fill_consumer_first_pass_aggregate_metrics_template"
    && input.consumerAverageSubmitterConfigBridgeNextAction
  ) {
    return input.consumerAverageSubmitterConfigBridgeNextAction;
  }
  if (
    input.routerNextAction === "fill_consumer_first_pass_aggregate_metrics_template"
    && input.consumerRealEvidenceHandoffNextAction
  ) {
    return input.consumerRealEvidenceHandoffNextAction;
  }
  return input.routerNextAction;
}

function executorCommandsFor(input: {
  fallbackCommands: string[];
  nextAction: string;
}): string[] {
  if (input.nextAction === "download_nsrr_or_secure_workbench_access") {
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
      "pnpm exec tsx scripts/murph-age/r1076-current-autoresearch-loop-executor.ts",
    ];
  }
  if (input.nextAction === "fill_nsrr_aggregate_receipt_or_run_local_evaluator") {
    return [
      "MURPH_AGE_NSRR_SCAN_ROOTS=<download-folder> pnpm exec tsx scripts/murph-age/r1081-nsrr-source-table-candidate-scanner.ts",
      "MURPH_AGE_NSRR_SOURCE_TABLE_PATH=<downloaded-nsrr-table.csv> pnpm exec tsx scripts/murph-age/r1080-nsrr-standardizer-manifest-scaffold.ts",
      "MURPH_AGE_NSRR_STANDARDIZER_MANIFEST_PATH=<private-manifest.json> pnpm exec tsx scripts/murph-age/r1082-nsrr-standardizer-manifest-readiness.ts",
      "MURPH_AGE_NSRR_STANDARDIZER_MANIFEST_PATH=<private-manifest.json> pnpm exec tsx scripts/murph-age/r1079-nsrr-sleep-autonomic-standardizer.ts",
      "MURPH_AGE_NSRR_SLEEP_AUTONOMIC_ANALYTIC_CACHE_PATH=<standardized-cache.csv.gz> pnpm exec tsx scripts/murph-age/r1078-nsrr-sleep-autonomic-local-loop.ts",
      "MURPH_AGE_NSRR_AGGREGATE_RECEIPT_PATH=<r1078-r1070-receipt.json> pnpm exec tsx scripts/murph-age/r1076-current-autoresearch-loop-executor.ts",
      "MURPH_AGE_NSRR_AGGREGATE_RECEIPT_PATH=<receipt.json> pnpm exec tsx scripts/murph-age/r1076-current-autoresearch-loop-executor.ts",
    ];
  }
  if (input.nextAction === "repair_r1055_r1056_r1057_direction_chain") {
    return [
      ...input.fallbackCommands,
      "pnpm exec tsx scripts/murph-age/r1076-current-autoresearch-loop-executor.ts",
    ];
  }
  if (input.nextAction === "run_function_missingness_calibration_adjudication") {
    return [
      ...input.fallbackCommands,
      "pnpm exec tsx scripts/murph-age/r1076-current-autoresearch-loop-executor.ts",
    ];
  }
  if (input.nextAction === "fill_consumer_first_pass_aggregate_metrics_template") {
    const handoffCommand = "pnpm exec tsx scripts/murph-age/r1130-ordinary-consumer-real-evidence-handoff.ts";
    const withHandoff = input.fallbackCommands.includes(handoffCommand)
      ? input.fallbackCommands
      : insertAfter(
          input.fallbackCommands,
          "pnpm exec tsx scripts/murph-age/r1127-ordinary-consumer-first-pass-submission-handoff.ts",
          handoffCommand,
        );
    const submitterCommand = "pnpm exec tsx scripts/murph-age/r1132-ordinary-consumer-submission-readiness.ts";
    const withSubmitter = withHandoff.includes(submitterCommand)
      ? withHandoff
      : insertAfter(withHandoff, handoffCommand, submitterCommand);
    const availabilityCommand =
      "pnpm exec tsx scripts/murph-age/r1133-ordinary-consumer-data-availability-preflight.ts";
    const withAvailability = withSubmitter.includes(availabilityCommand)
      ? withSubmitter
      : insertAfter(withSubmitter, submitterCommand, availabilityCommand);
    const configBridgeCommand =
      "pnpm exec tsx scripts/murph-age/r1134-ordinary-consumer-availability-config-bridge.ts";
    const withConfigBridge = withAvailability.includes(configBridgeCommand)
      ? withAvailability
      : insertAfter(withAvailability, availabilityCommand, configBridgeCommand);
    const manifestPacketCommand =
      "pnpm exec tsx scripts/murph-age/r1135-ordinary-consumer-availability-manifest-packet.ts";
    const withManifestPacket = withConfigBridge.includes(manifestPacketCommand)
      ? withConfigBridge
      : insertAfter(withConfigBridge, configBridgeCommand, manifestPacketCommand);
    const manifestRecipeMaterializerCommand =
      "pnpm exec tsx scripts/murph-age/r1143-ordinary-consumer-availability-manifest-recipe-materializer.ts";
    const withManifestRecipeMaterializer = withManifestPacket.includes(manifestRecipeMaterializerCommand)
      ? withManifestPacket
      : insertAfter(withManifestPacket, manifestPacketCommand, manifestRecipeMaterializerCommand);
    const recipeReadinessChainRunnerCommand =
      "pnpm exec tsx scripts/murph-age/r1144-ordinary-consumer-recipe-readiness-chain-runner.ts";
    const withRecipeReadinessChain = withManifestRecipeMaterializer.includes(recipeReadinessChainRunnerCommand)
      ? withManifestRecipeMaterializer
      : insertAfter(withManifestRecipeMaterializer, manifestRecipeMaterializerCommand, recipeReadinessChainRunnerCommand);
    const availabilityChainCommand =
      "pnpm exec tsx scripts/murph-age/r1136-ordinary-consumer-availability-chain-runner.ts";
    const withAvailabilityChain = withRecipeReadinessChain.includes(availabilityChainCommand)
      ? withRecipeReadinessChain
      : insertAfter(withRecipeReadinessChain, recipeReadinessChainRunnerCommand, availabilityChainCommand);
    const partialRoutePlannerCommand =
      "pnpm exec tsx scripts/murph-age/r1137-ordinary-consumer-partial-route-planner.ts";
    const withPartialRoutePlanner = withAvailabilityChain.includes(partialRoutePlannerCommand)
      ? withAvailabilityChain
      : insertAfter(withAvailabilityChain, availabilityChainCommand, partialRoutePlannerCommand);
    const partialMetricIntakeCommand =
      "pnpm exec tsx scripts/murph-age/r1138-ordinary-consumer-partial-aggregate-metric-intake.ts";
    const withPartialMetricIntake = withPartialRoutePlanner.includes(partialMetricIntakeCommand)
      ? withPartialRoutePlanner
      : insertAfter(withPartialRoutePlanner, partialRoutePlannerCommand, partialMetricIntakeCommand);
    const partialPrivateConfigHandoffCommand =
      "pnpm exec tsx scripts/murph-age/r1139-ordinary-consumer-partial-private-config-handoff.ts";
    const withPartialPrivateConfigHandoff = withPartialMetricIntake.includes(partialPrivateConfigHandoffCommand)
      ? withPartialMetricIntake
      : insertAfter(withPartialMetricIntake, partialMetricIntakeCommand, partialPrivateConfigHandoffCommand);
    const partialReadinessChainCommand =
      "pnpm exec tsx scripts/murph-age/r1140-ordinary-consumer-partial-readiness-chain-runner.ts";
    const withPartialReadinessChain = withPartialPrivateConfigHandoff.includes(partialReadinessChainCommand)
      ? withPartialPrivateConfigHandoff
      : insertAfter(withPartialPrivateConfigHandoff, partialPrivateConfigHandoffCommand, partialReadinessChainCommand);
    const partialPrivateMetricRunnerCommand =
      "pnpm exec tsx scripts/murph-age/r1141-ordinary-consumer-partial-private-metric-runner.ts";
    const withPartialPrivateMetricRunner = withPartialReadinessChain.includes(partialPrivateMetricRunnerCommand)
      ? withPartialReadinessChain
      : insertAfter(withPartialReadinessChain, partialReadinessChainCommand, partialPrivateMetricRunnerCommand);
    const partialPrivateChainRunnerCommand =
      "pnpm exec tsx scripts/murph-age/r1142-ordinary-consumer-partial-private-chain-runner.ts";
    const withPartialPrivateChain = withPartialPrivateMetricRunner.includes(partialPrivateChainRunnerCommand)
      ? withPartialPrivateMetricRunner
      : insertAfter(withPartialPrivateMetricRunner, partialPrivateMetricRunnerCommand, partialPrivateChainRunnerCommand);
    const currentChainCompletionAuditCommand =
      "pnpm exec tsx scripts/murph-age/r1145-ordinary-consumer-current-chain-completion-audit.ts";
    const withCurrentChainCompletionAudit = withPartialPrivateChain.includes(currentChainCompletionAuditCommand)
      ? withPartialPrivateChain
      : insertAfter(withPartialPrivateChain, partialPrivateChainRunnerCommand, currentChainCompletionAuditCommand);
    const rowOwnerActionPacketCommand =
      "pnpm exec tsx scripts/murph-age/r1146-ordinary-consumer-row-owner-route-action-packet.ts";
    const withRowOwnerActionPacket = withCurrentChainCompletionAudit.includes(rowOwnerActionPacketCommand)
      ? withCurrentChainCompletionAudit
      : insertAfter(withCurrentChainCompletionAudit, currentChainCompletionAuditCommand, rowOwnerActionPacketCommand);
    const postConfirmationPrivateConfigPacketCommand =
      "pnpm exec tsx scripts/murph-age/r1147-ordinary-consumer-post-confirmation-private-config-packet.ts";
    const withPostConfirmationPrivateConfigPacket = withRowOwnerActionPacket.includes(postConfirmationPrivateConfigPacketCommand)
      ? withRowOwnerActionPacket
      : insertAfter(withRowOwnerActionPacket, rowOwnerActionPacketCommand, postConfirmationPrivateConfigPacketCommand);
    const postConfirmationPrivateConfigIntakeCommand =
      "pnpm exec tsx scripts/murph-age/r1148-ordinary-consumer-post-confirmation-private-config-intake.ts";
    const withPostConfirmationPrivateConfigIntake = withPostConfirmationPrivateConfigPacket.includes(postConfirmationPrivateConfigIntakeCommand)
      ? withPostConfirmationPrivateConfigPacket
      : insertAfter(
          withPostConfirmationPrivateConfigPacket,
          postConfirmationPrivateConfigPacketCommand,
          postConfirmationPrivateConfigIntakeCommand,
        );
    const labWearableSubmissionKitCommand =
      "pnpm exec tsx scripts/murph-age/r1149-ordinary-consumer-lab-wearable-submission-kit.ts";
    const withLabWearableSubmissionKit = withPostConfirmationPrivateConfigIntake.includes(labWearableSubmissionKitCommand)
      ? withPostConfirmationPrivateConfigIntake
      : insertAfter(
          withPostConfirmationPrivateConfigIntake,
          postConfirmationPrivateConfigIntakeCommand,
          labWearableSubmissionKitCommand,
        );
    const safeAvailabilityConfirmationIntakeCommand =
      "pnpm exec tsx scripts/murph-age/r1150-ordinary-consumer-safe-availability-confirmation-intake.ts";
    const withSafeAvailabilityConfirmationIntake = withLabWearableSubmissionKit.includes(safeAvailabilityConfirmationIntakeCommand)
      ? withLabWearableSubmissionKit
      : insertAfter(
          withLabWearableSubmissionKit,
          labWearableSubmissionKitCommand,
          safeAvailabilityConfirmationIntakeCommand,
        );
    const featureOnlySubmissionModeCommand =
      "pnpm exec tsx scripts/murph-age/r1151-ordinary-consumer-feature-only-submission-mode.ts";
    const withFeatureOnlySubmissionMode = withSafeAvailabilityConfirmationIntake.includes(featureOnlySubmissionModeCommand)
      ? withSafeAvailabilityConfirmationIntake
      : insertAfter(
          withSafeAvailabilityConfirmationIntake,
          safeAvailabilityConfirmationIntakeCommand,
          featureOnlySubmissionModeCommand,
        );
    const featureOnlyCoverageContextIntakeCommand =
      "pnpm exec tsx scripts/murph-age/r1152-ordinary-consumer-feature-only-coverage-context-intake.ts";
    const withFeatureOnlyCoverageContextIntake = withFeatureOnlySubmissionMode.includes(featureOnlyCoverageContextIntakeCommand)
      ? withFeatureOnlySubmissionMode
      : insertAfter(
          withFeatureOnlySubmissionMode,
          featureOnlySubmissionModeCommand,
          featureOnlyCoverageContextIntakeCommand,
        );
    const featureOnlyChainRunnerCommand =
      "pnpm exec tsx scripts/murph-age/r1153-ordinary-consumer-feature-only-chain-runner.ts";
    const withFeatureOnlyChainRunner = withFeatureOnlyCoverageContextIntake.includes(featureOnlyChainRunnerCommand)
      ? withFeatureOnlyCoverageContextIntake
      : insertAfter(
          withFeatureOnlyCoverageContextIntake,
          featureOnlyCoverageContextIntakeCommand,
          featureOnlyChainRunnerCommand,
        );
    const safeAvailabilityActionPacketCommand =
      "pnpm exec tsx scripts/murph-age/r1154-ordinary-consumer-safe-availability-action-packet.ts";
    const withSafeAvailabilityActionPacket = withFeatureOnlyChainRunner.includes(safeAvailabilityActionPacketCommand)
      ? withFeatureOnlyChainRunner
      : insertAfter(
          withFeatureOnlyChainRunner,
          featureOnlyChainRunnerCommand,
          safeAvailabilityActionPacketCommand,
        );
    const withSafeConfirmationHandoff = withSafeAvailabilityActionPacket.includes(R1156_SAFE_CONFIRMATION_HANDOFF_COMMAND)
      ? withSafeAvailabilityActionPacket
      : insertAfter(
          withSafeAvailabilityActionPacket,
          safeAvailabilityActionPacketCommand,
          R1156_SAFE_CONFIRMATION_HANDOFF_COMMAND,
        );
    const withSafeConfirmationChainRunner = withSafeConfirmationHandoff.includes(R1157_SAFE_CONFIRMATION_CHAIN_RUNNER_COMMAND)
      ? withSafeConfirmationHandoff
      : insertAfter(
          withSafeConfirmationHandoff,
          R1156_SAFE_CONFIRMATION_HANDOFF_COMMAND,
          R1157_SAFE_CONFIRMATION_CHAIN_RUNNER_COMMAND,
        );
    const withSafeConfirmationFillGuide = withSafeConfirmationChainRunner.includes(R1158_SAFE_CONFIRMATION_FILL_GUIDE_COMMAND)
      ? withSafeConfirmationChainRunner
      : insertAfter(
          withSafeConfirmationChainRunner,
          R1157_SAFE_CONFIRMATION_CHAIN_RUNNER_COMMAND,
          R1158_SAFE_CONFIRMATION_FILL_GUIDE_COMMAND,
        );
    const withSafeConfirmationAnswerSheet = withSafeConfirmationFillGuide.includes(R1159_SAFE_CONFIRMATION_ANSWER_SHEET_COMMAND)
      ? withSafeConfirmationFillGuide
      : insertAfter(
          withSafeConfirmationFillGuide,
          R1158_SAFE_CONFIRMATION_FILL_GUIDE_COMMAND,
          R1159_SAFE_CONFIRMATION_ANSWER_SHEET_COMMAND,
        );
    const withTranscriptionProof = withSafeConfirmationAnswerSheet.includes(R1160_TRANSCRIPTION_PROOF_COMMAND)
      ? withSafeConfirmationAnswerSheet
      : insertAfter(
          withSafeConfirmationAnswerSheet,
          R1159_SAFE_CONFIRMATION_ANSWER_SHEET_COMMAND,
          R1160_TRANSCRIPTION_PROOF_COMMAND,
        );
    const withMaterializer = withTranscriptionProof.includes(R1161_MATERIALIZER_COMMAND)
      ? withTranscriptionProof
      : insertAfter(
          withTranscriptionProof,
          R1160_TRANSCRIPTION_PROOF_COMMAND,
          R1161_MATERIALIZER_COMMAND,
        );
    const withAssertionHandoff = withMaterializer.includes(R1162_ASSERTION_HANDOFF_COMMAND)
      ? withMaterializer
      : insertAfter(
          withMaterializer,
          R1161_MATERIALIZER_COMMAND,
          R1162_ASSERTION_HANDOFF_COMMAND,
        );
    const withAssertionRunner = withAssertionHandoff.includes(R1163_ASSERTION_TO_RESEARCH_RUNNER_COMMAND)
      ? withAssertionHandoff
      : insertAfter(
          withAssertionHandoff,
          R1162_ASSERTION_HANDOFF_COMMAND,
          R1163_ASSERTION_TO_RESEARCH_RUNNER_COMMAND,
        );
    const withFeatureOnlyResearchHandoff = withAssertionRunner.includes(R1164_FEATURE_ONLY_RESEARCH_HANDOFF_COMMAND)
      ? withAssertionRunner
      : insertAfter(
          withAssertionRunner,
          R1163_ASSERTION_TO_RESEARCH_RUNNER_COMMAND,
          R1164_FEATURE_ONLY_RESEARCH_HANDOFF_COMMAND,
        );
    const withSafeAssertionFillGuide = withFeatureOnlyResearchHandoff.includes(R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND)
      ? withFeatureOnlyResearchHandoff
      : insertAfter(
          withFeatureOnlyResearchHandoff,
          R1164_FEATURE_ONLY_RESEARCH_HANDOFF_COMMAND,
          R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND,
        );
    const withSafeAssertionAnswerSheet = withSafeAssertionFillGuide.includes(R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND)
      ? withSafeAssertionFillGuide
      : insertAfter(
          withSafeAssertionFillGuide,
          R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND,
          R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND,
        );
    const withSafeNextStepPacket = withSafeAssertionAnswerSheet.includes(R1174_SAFE_NEXT_STEP_PACKET_COMMAND)
      ? withSafeAssertionAnswerSheet
      : insertAfter(
          withSafeAssertionAnswerSheet,
          R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND,
          R1174_SAFE_NEXT_STEP_PACKET_COMMAND,
        );
    const withSafeAssertionMaterializer = withSafeNextStepPacket.includes(R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND)
      ? withSafeNextStepPacket
      : insertAfter(
          withSafeNextStepPacket,
          R1174_SAFE_NEXT_STEP_PACKET_COMMAND,
          R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND,
        );
    const withSafeAssertionRunner = withSafeAssertionMaterializer.includes(R1165_SAFE_ASSERTION_RUNNER_COMMAND)
      ? withSafeAssertionMaterializer
      : insertAfter(
          withSafeAssertionMaterializer,
          R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND,
          R1165_SAFE_ASSERTION_RUNNER_COMMAND,
        );
    const withSafeAssertionBridgeSmoke = withSafeAssertionRunner.includes(
      R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_COMMAND,
    )
      ? withSafeAssertionRunner
      : insertAfter(
          withSafeAssertionRunner,
          R1165_SAFE_ASSERTION_RUNNER_COMMAND,
          R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_COMMAND,
        );
    const withSafeAssertionLiveChain = withSafeAssertionBridgeSmoke.includes(
      R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
    )
      ? withSafeAssertionBridgeSmoke
      : insertAfter(
          withSafeAssertionBridgeSmoke,
          R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_COMMAND,
          R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
        );
    return withSafeAssertionLiveChain.includes(R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_COMMAND)
      ? withSafeAssertionLiveChain
      : insertAfter(
          withSafeAssertionLiveChain,
          R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
          R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_COMMAND,
        );
  }
  return input.fallbackCommands;
}

function insertAfter(commands: readonly string[], anchor: string, inserted: string): string[] {
  const index = commands.indexOf(anchor);
  if (index === -1) return [...commands, inserted];
  return [
    ...commands.slice(0, index + 1),
    inserted,
    ...commands.slice(index + 1),
  ];
}

function safeBoundary(): R1076CurrentAutoresearchLoopExecutorOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localFileNamesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1076: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1076: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1076CurrentAutoresearchLoopExecutor({
    aggregateReceiptPath: process.env.MURPH_AGE_NSRR_AGGREGATE_RECEIPT_PATH,
    nsrrSleepAutonomicAnalyticCachePath: process.env.MURPH_AGE_NSRR_SLEEP_AUTONOMIC_ANALYTIC_CACHE_PATH,
    nsrrSleepAutonomicStandardizerManifestPath: process.env.MURPH_AGE_NSRR_STANDARDIZER_MANIFEST_PATH,
    nsrrSourceCandidateDraftPath: process.env.MURPH_AGE_NSRR_SOURCE_CANDIDATE_DRAFT_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1057Path: process.env.MURPH_AGE_R1057_FUNCTION_ACTIVITY_BATCH_RESULT_PATH,
    r1059Path: process.env.MURPH_AGE_R1059_TRUE_WEARABLE_RECEIPT_INTAKE_PATH,
    r1061Path: process.env.MURPH_AGE_R1061_TRUE_WEARABLE_DATA_UNBLOCKER_PATH,
    r1062Path: process.env.MURPH_AGE_R1062_TRUE_WEARABLE_RECEIPT_TEMPLATE_PATH,
    r1083AggregatePacketPath: process.env.MURPH_AGE_R1025_FUNCTION_TRANSPORT_AGGREGATE_PACKET_PATH,
    r1083ReducerPath: process.env.MURPH_AGE_R1025_FUNCTION_TRANSPORT_REDUCER_PATH,
    r1084HaalsiPath: process.env.MURPH_AGE_R1044_HAALSI_PATH,
    r1101Path: process.env.MURPH_AGE_R1101_CONSUMER_LOOP_EXECUTOR_PATH,
    r1128Path: process.env.MURPH_AGE_R1128_ORDINARY_CONSUMER_PIPELINE_SMOKE_PROOF_PATH,
    r1129Path: process.env.MURPH_AGE_R1129_CONSUMER_REAL_EVIDENCE_GATE_PATH,
    r1130Path: process.env.MURPH_AGE_R1130_ORDINARY_CONSUMER_REAL_EVIDENCE_HANDOFF_PATH,
    r1132Path: process.env.MURPH_AGE_R1132_ORDINARY_CONSUMER_SUBMISSION_READINESS_PATH,
    r1133Path: process.env.MURPH_AGE_R1133_ORDINARY_CONSUMER_DATA_AVAILABILITY_PREFLIGHT_PATH,
    r1134Path: process.env.MURPH_AGE_R1134_ORDINARY_CONSUMER_AVAILABILITY_CONFIG_BRIDGE_PATH,
    r1135Path: process.env.MURPH_AGE_R1135_ORDINARY_CONSUMER_AVAILABILITY_MANIFEST_PACKET_PATH,
    r1136Path: process.env.MURPH_AGE_R1136_ORDINARY_CONSUMER_AVAILABILITY_CHAIN_RUNNER_PATH,
    r1137Path: process.env.MURPH_AGE_R1137_ORDINARY_CONSUMER_PARTIAL_ROUTE_PLANNER_PATH,
    r1138Path: process.env.MURPH_AGE_R1138_ORDINARY_CONSUMER_PARTIAL_AGGREGATE_METRIC_INTAKE_PATH,
    r1139Path: process.env.MURPH_AGE_R1139_ORDINARY_CONSUMER_PARTIAL_PRIVATE_CONFIG_HANDOFF_PATH,
    r1140Path: process.env.MURPH_AGE_R1140_ORDINARY_CONSUMER_PARTIAL_READINESS_CHAIN_RUNNER_PATH,
    r1141Path: process.env.MURPH_AGE_R1141_ORDINARY_CONSUMER_PARTIAL_PRIVATE_METRIC_RUNNER_PATH,
    r1142Path: process.env.MURPH_AGE_R1142_ORDINARY_CONSUMER_PARTIAL_PRIVATE_CHAIN_RUNNER_PATH,
    r1145Path: process.env.MURPH_AGE_R1145_ORDINARY_CONSUMER_CURRENT_CHAIN_COMPLETION_AUDIT_PATH,
    r1146Path: process.env.MURPH_AGE_R1146_ORDINARY_CONSUMER_ROW_OWNER_ROUTE_ACTION_PACKET_PATH,
    r1147Path: process.env.MURPH_AGE_R1147_ORDINARY_CONSUMER_POST_CONFIRMATION_PRIVATE_CONFIG_PACKET_PATH,
    r1148Path: process.env.MURPH_AGE_R1148_ORDINARY_CONSUMER_POST_CONFIRMATION_PRIVATE_CONFIG_INTAKE_PATH,
    r1149Path: process.env.MURPH_AGE_R1149_ORDINARY_CONSUMER_LAB_WEARABLE_SUBMISSION_KIT_PATH,
    r1150Path: process.env.MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_PATH,
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
    scanRoots: parseScanRoots(process.env.MURPH_AGE_NSRR_SCAN_ROOTS),
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    consumerAverageSubmitterFamilyIds: output.summary.consumerAverageSubmitterFamilyIds,
    consumerAverageSubmitterAvailabilityConclusion: output.summary.consumerAverageSubmitterAvailabilityConclusion,
    consumerAverageSubmitterAvailabilityManifestStatus:
      output.summary.consumerAverageSubmitterAvailabilityManifestStatus,
    consumerAverageSubmitterAvailabilityMissingSourceFamilyIds:
      output.summary.consumerAverageSubmitterAvailabilityMissingSourceFamilyIds,
    consumerAverageSubmitterAvailabilityNextAction: output.summary.consumerAverageSubmitterAvailabilityNextAction,
    consumerAverageSubmitterAvailabilityPreflightArtifact:
      output.summary.consumerAverageSubmitterAvailabilityPreflightArtifact,
    consumerAverageSubmitterAvailabilityReadyForPrivateConfigMapping:
      output.summary.consumerAverageSubmitterAvailabilityReadyForPrivateConfigMapping,
    consumerAverageSubmitterConfigBridgeArtifact:
      output.summary.consumerAverageSubmitterConfigBridgeArtifact,
    consumerAverageSubmitterConfigBridgeAvailableSourceFamilyIds:
      output.summary.consumerAverageSubmitterConfigBridgeAvailableSourceFamilyIds,
    consumerAverageSubmitterConfigBridgeConclusion:
      output.summary.consumerAverageSubmitterConfigBridgeConclusion,
    consumerAverageSubmitterConfigBridgeMappingPlanStatus:
      output.summary.consumerAverageSubmitterConfigBridgeMappingPlanStatus,
    consumerAverageSubmitterConfigBridgeNextAction:
      output.summary.consumerAverageSubmitterConfigBridgeNextAction,
    consumerAverageSubmitterConfigBridgeReadyForPrivateConfigMapping:
      output.summary.consumerAverageSubmitterConfigBridgeReadyForPrivateConfigMapping,
    consumerAverageSubmitterConfigBridgeSelectedTableLayout:
      output.summary.consumerAverageSubmitterConfigBridgeSelectedTableLayout,
    consumerAverageSubmitterManifestPacketArtifact:
      output.summary.consumerAverageSubmitterManifestPacketArtifact,
    consumerAverageSubmitterManifestPacketConclusion:
      output.summary.consumerAverageSubmitterManifestPacketConclusion,
    consumerAverageSubmitterManifestPacketMatchedRecipeIds:
      output.summary.consumerAverageSubmitterManifestPacketMatchedRecipeIds,
    consumerAverageSubmitterManifestPacketMaterializerCommand:
      output.summary.consumerAverageSubmitterManifestPacketMaterializerCommand,
    consumerAverageSubmitterManifestPacketNextAction:
      output.summary.consumerAverageSubmitterManifestPacketNextAction,
    consumerAverageSubmitterManifestPacketPrimaryInputFamilyIds:
      output.summary.consumerAverageSubmitterManifestPacketPrimaryInputFamilyIds,
    consumerAverageSubmitterManifestPacketPartialPrivateChainRunnerCommand:
      output.summary.consumerAverageSubmitterManifestPacketPartialPrivateChainRunnerCommand,
    consumerAverageSubmitterManifestPacketPartialRouteRecipeIds:
      output.summary.consumerAverageSubmitterManifestPacketPartialRouteRecipeIds,
    consumerAverageSubmitterManifestPacketPreferredRecipeIds:
      output.summary.consumerAverageSubmitterManifestPacketPreferredRecipeIds,
    consumerAverageSubmitterManifestPacketReadyForPrivateConfigMapping:
      output.summary.consumerAverageSubmitterManifestPacketReadyForPrivateConfigMapping,
    consumerAverageSubmitterManifestPacketRecipeReadinessChainCommand:
      output.summary.consumerAverageSubmitterManifestPacketRecipeReadinessChainCommand,
    consumerAverageSubmitterManifestPacketSafeManifestAttestationsComplete:
      output.summary.consumerAverageSubmitterManifestPacketSafeManifestAttestationsComplete,
    consumerAverageSubmitterManifestPacketRequiredLinkageFamilyIds:
      output.summary.consumerAverageSubmitterManifestPacketRequiredLinkageFamilyIds,
    consumerAverageSubmitterAvailabilityChainArtifact:
      output.summary.consumerAverageSubmitterAvailabilityChainArtifact,
    consumerAverageSubmitterAvailabilityChainConclusion:
      output.summary.consumerAverageSubmitterAvailabilityChainConclusion,
    consumerAverageSubmitterAvailabilityChainManifestSupplied:
      output.summary.consumerAverageSubmitterAvailabilityChainManifestSupplied,
    consumerAverageSubmitterAvailabilityChainNextAction:
      output.summary.consumerAverageSubmitterAvailabilityChainNextAction,
    consumerAverageSubmitterAvailabilityChainReadyForPrivateConfigMapping:
      output.summary.consumerAverageSubmitterAvailabilityChainReadyForPrivateConfigMapping,
    consumerAverageSubmitterPartialRoutePlannerArtifact:
      output.summary.consumerAverageSubmitterPartialRoutePlannerArtifact,
    consumerAverageSubmitterPartialRoutePlannerConclusion:
      output.summary.consumerAverageSubmitterPartialRoutePlannerConclusion,
    consumerAverageSubmitterPartialRoutePlannerFullRouteReady:
      output.summary.consumerAverageSubmitterPartialRoutePlannerFullRouteReady,
    consumerAverageSubmitterPartialRoutePlannerNextAction:
      output.summary.consumerAverageSubmitterPartialRoutePlannerNextAction,
    consumerAverageSubmitterPartialRoutePlannerReadyForPrivateConfigMapping:
      output.summary.consumerAverageSubmitterPartialRoutePlannerReadyForPrivateConfigMapping,
    consumerAverageSubmitterPartialRoutePlannerReadyUnsupportedRouteIds:
      output.summary.consumerAverageSubmitterPartialRoutePlannerReadyUnsupportedRouteIds,
    consumerAverageSubmitterPartialMetricIntakeArtifact:
      output.summary.consumerAverageSubmitterPartialMetricIntakeArtifact,
    consumerAverageSubmitterPartialMetricIntakeConclusion:
      output.summary.consumerAverageSubmitterPartialMetricIntakeConclusion,
    consumerAverageSubmitterPartialMetricIntakeNextAction:
      output.summary.consumerAverageSubmitterPartialMetricIntakeNextAction,
    consumerAverageSubmitterPartialMetricIntakeReadyRouteIds:
      output.summary.consumerAverageSubmitterPartialMetricIntakeReadyRouteIds,
    consumerAverageSubmitterPartialMetricIntakeTemplateArtifact:
      output.summary.consumerAverageSubmitterPartialMetricIntakeTemplateArtifact,
    consumerAverageSubmitterPartialPrivateConfigHandoffArtifact:
      output.summary.consumerAverageSubmitterPartialPrivateConfigHandoffArtifact,
    consumerAverageSubmitterPartialPrivateConfigHandoffConclusion:
      output.summary.consumerAverageSubmitterPartialPrivateConfigHandoffConclusion,
    consumerAverageSubmitterPartialPrivateConfigHandoffEligibleRouteIds:
      output.summary.consumerAverageSubmitterPartialPrivateConfigHandoffEligibleRouteIds,
    consumerAverageSubmitterPartialPrivateConfigHandoffFullEvidenceGateCleared:
      output.summary.consumerAverageSubmitterPartialPrivateConfigHandoffFullEvidenceGateCleared,
    consumerAverageSubmitterPartialPrivateConfigHandoffNextAction:
      output.summary.consumerAverageSubmitterPartialPrivateConfigHandoffNextAction,
    consumerAverageSubmitterPartialPrivateConfigHandoffReadyMetricRouteIds:
      output.summary.consumerAverageSubmitterPartialPrivateConfigHandoffReadyMetricRouteIds,
    consumerAverageSubmitterPartialPrivateConfigHandoffRequiredFieldRefFamilies:
      output.summary.consumerAverageSubmitterPartialPrivateConfigHandoffRequiredFieldRefFamilies,
    consumerAverageSubmitterPartialPrivateConfigHandoffRequiredTableRefs:
      output.summary.consumerAverageSubmitterPartialPrivateConfigHandoffRequiredTableRefs,
    consumerAverageSubmitterPartialPrivateConfigHandoffTemplateArtifact:
      output.summary.consumerAverageSubmitterPartialPrivateConfigHandoffTemplateArtifact,
    consumerAverageSubmitterPartialReadinessChainArtifact:
      output.summary.consumerAverageSubmitterPartialReadinessChainArtifact,
    consumerAverageSubmitterPartialReadinessChainConclusion:
      output.summary.consumerAverageSubmitterPartialReadinessChainConclusion,
    consumerAverageSubmitterPartialReadinessChainEligibleRouteIds:
      output.summary.consumerAverageSubmitterPartialReadinessChainEligibleRouteIds,
    consumerAverageSubmitterPartialReadinessChainFullEvidenceGateCleared:
      output.summary.consumerAverageSubmitterPartialReadinessChainFullEvidenceGateCleared,
    consumerAverageSubmitterPartialReadinessChainManifestSupplied:
      output.summary.consumerAverageSubmitterPartialReadinessChainManifestSupplied,
    consumerAverageSubmitterPartialReadinessChainNextAction:
      output.summary.consumerAverageSubmitterPartialReadinessChainNextAction,
    consumerAverageSubmitterPartialReadinessChainReadyMetricRouteIds:
      output.summary.consumerAverageSubmitterPartialReadinessChainReadyMetricRouteIds,
    consumerAverageSubmitterPartialReadinessChainRequiredFieldRefFamilies:
      output.summary.consumerAverageSubmitterPartialReadinessChainRequiredFieldRefFamilies,
    consumerAverageSubmitterPartialReadinessChainRequiredTableRefs:
      output.summary.consumerAverageSubmitterPartialReadinessChainRequiredTableRefs,
    consumerAverageSubmitterPartialReadinessChainTemplateArtifact:
      output.summary.consumerAverageSubmitterPartialReadinessChainTemplateArtifact,
    consumerAverageSubmitterPartialPrivateMetricRunnerAggregateMetricsArtifact:
      output.summary.consumerAverageSubmitterPartialPrivateMetricRunnerAggregateMetricsArtifact,
    consumerAverageSubmitterPartialPrivateMetricRunnerArtifact:
      output.summary.consumerAverageSubmitterPartialPrivateMetricRunnerArtifact,
    consumerAverageSubmitterPartialPrivateMetricRunnerConclusion:
      output.summary.consumerAverageSubmitterPartialPrivateMetricRunnerConclusion,
    consumerAverageSubmitterPartialPrivateMetricRunnerEligibleRouteIds:
      output.summary.consumerAverageSubmitterPartialPrivateMetricRunnerEligibleRouteIds,
    consumerAverageSubmitterPartialPrivateMetricRunnerExecutedRouteIds:
      output.summary.consumerAverageSubmitterPartialPrivateMetricRunnerExecutedRouteIds,
    consumerAverageSubmitterPartialPrivateMetricRunnerNextAction:
      output.summary.consumerAverageSubmitterPartialPrivateMetricRunnerNextAction,
    consumerAverageSubmitterPartialPrivateMetricRunnerRequestedRouteIds:
      output.summary.consumerAverageSubmitterPartialPrivateMetricRunnerRequestedRouteIds,
    consumerAverageSubmitterPartialPrivateMetricRunnerRouteMetricsReadyForR1138:
      output.summary.consumerAverageSubmitterPartialPrivateMetricRunnerRouteMetricsReadyForR1138,
    consumerAverageSubmitterPartialPrivateChainAggregateMetricsArtifact:
      output.summary.consumerAverageSubmitterPartialPrivateChainAggregateMetricsArtifact,
    consumerAverageSubmitterPartialPrivateChainArtifact:
      output.summary.consumerAverageSubmitterPartialPrivateChainArtifact,
    consumerAverageSubmitterPartialPrivateChainConclusion:
      output.summary.consumerAverageSubmitterPartialPrivateChainConclusion,
    consumerAverageSubmitterPartialPrivateChainEligibleRouteIds:
      output.summary.consumerAverageSubmitterPartialPrivateChainEligibleRouteIds,
    consumerAverageSubmitterPartialPrivateChainExecutedRouteIds:
      output.summary.consumerAverageSubmitterPartialPrivateChainExecutedRouteIds,
    consumerAverageSubmitterPartialPrivateChainFinalReadyRouteIds:
      output.summary.consumerAverageSubmitterPartialPrivateChainFinalReadyRouteIds,
    consumerAverageSubmitterPartialPrivateChainFullEvidenceGateCleared:
      output.summary.consumerAverageSubmitterPartialPrivateChainFullEvidenceGateCleared,
    consumerAverageSubmitterPartialPrivateChainFullSupportedRouteReady:
      output.summary.consumerAverageSubmitterPartialPrivateChainFullSupportedRouteReady,
    consumerAverageSubmitterPartialPrivateChainNextAction:
      output.summary.consumerAverageSubmitterPartialPrivateChainNextAction,
    consumerAverageSubmitterPartialPrivateChainRouteMetricsReadyForR1138:
      output.summary.consumerAverageSubmitterPartialPrivateChainRouteMetricsReadyForR1138,
    consumerAverageSubmitterCompletionAuditArtifact:
      output.summary.consumerAverageSubmitterCompletionAuditArtifact,
    consumerAverageSubmitterCompletionAuditBlockers:
      output.summary.consumerAverageSubmitterCompletionAuditBlockers,
    consumerAverageSubmitterCompletionAuditConclusion:
      output.summary.consumerAverageSubmitterCompletionAuditConclusion,
    consumerAverageSubmitterCompletionAuditGoalAchieved:
      output.summary.consumerAverageSubmitterCompletionAuditGoalAchieved,
    consumerAverageSubmitterCompletionAuditMissingRequirementIds:
      output.summary.consumerAverageSubmitterCompletionAuditMissingRequirementIds,
    consumerAverageSubmitterCompletionAuditNextAction:
      output.summary.consumerAverageSubmitterCompletionAuditNextAction,
    consumerAverageSubmitterCompletionAuditUnblockerBlockedRequirementIds:
      output.summary.consumerAverageSubmitterCompletionAuditUnblockerBlockedRequirementIds,
    consumerAverageSubmitterCompletionAuditUnblockerBlockedStepIds:
      output.summary.consumerAverageSubmitterCompletionAuditUnblockerBlockedStepIds,
    consumerAverageSubmitterCompletionAuditUnblockerCommandCount:
      output.summary.consumerAverageSubmitterCompletionAuditUnblockerCommandCount,
    consumerAverageSubmitterCompletionAuditUnblockerStepIds:
      output.summary.consumerAverageSubmitterCompletionAuditUnblockerStepIds,
    consumerAverageSubmitterCompletionAuditUnblockerTopAllowedValueKindIds:
      output.summary.consumerAverageSubmitterCompletionAuditUnblockerTopAllowedValueKindIds,
    consumerAverageSubmitterCompletionAuditUnblockerTopBlockedContentIds:
      output.summary.consumerAverageSubmitterCompletionAuditUnblockerTopBlockedContentIds,
    consumerAverageSubmitterCompletionAuditUnblockerTopCommand:
      output.summary.consumerAverageSubmitterCompletionAuditUnblockerTopCommand,
    consumerAverageSubmitterCompletionAuditUnblockerTopNextAction:
      output.summary.consumerAverageSubmitterCompletionAuditUnblockerTopNextAction,
    consumerAverageSubmitterCompletionAuditUnblockerTopRequirementId:
      output.summary.consumerAverageSubmitterCompletionAuditUnblockerTopRequirementId,
    consumerAverageSubmitterCompletionAuditUnblockerTopRequiredInputKindIds:
      output.summary.consumerAverageSubmitterCompletionAuditUnblockerTopRequiredInputKindIds,
    consumerAverageSubmitterCompletionAuditUnblockerTopSafeCompletionChecklistItemIds:
      output.summary.consumerAverageSubmitterCompletionAuditUnblockerTopSafeCompletionChecklistItemIds,
    consumerAverageSubmitterCompletionAuditUnblockerTopStepId:
      output.summary.consumerAverageSubmitterCompletionAuditUnblockerTopStepId,
    consumerAverageSubmitterCompletionAuditProductDisplayAuthorized:
      output.summary.consumerAverageSubmitterCompletionAuditProductDisplayAuthorized,
    consumerAverageSubmitterCompletionAuditReadyToMarkComplete:
      output.summary.consumerAverageSubmitterCompletionAuditReadyToMarkComplete,
    consumerAverageSubmitterCompletionAuditTopMissingRequirement:
      output.summary.consumerAverageSubmitterCompletionAuditTopMissingRequirement,
    consumerAverageSubmitterRowOwnerActionPacketArtifact:
      output.summary.consumerAverageSubmitterRowOwnerActionPacketArtifact,
    consumerAverageSubmitterRowOwnerActionPacketBlockers:
      output.summary.consumerAverageSubmitterRowOwnerActionPacketBlockers,
    consumerAverageSubmitterRowOwnerActionPacketConclusion:
      output.summary.consumerAverageSubmitterRowOwnerActionPacketConclusion,
    consumerAverageSubmitterRowOwnerActionPacketFallbackRecipeIds:
      output.summary.consumerAverageSubmitterRowOwnerActionPacketFallbackRecipeIds,
    consumerAverageSubmitterRowOwnerActionPacketNextAction:
      output.summary.consumerAverageSubmitterRowOwnerActionPacketNextAction,
    consumerAverageSubmitterRowOwnerActionPacketRecommendedConfirmedRecipeCommand:
      output.summary.consumerAverageSubmitterRowOwnerActionPacketRecommendedConfirmedRecipeCommand,
    consumerAverageSubmitterRowOwnerActionPacketRecommendedConfirmedRecipeCommandAvailable:
      output.summary.consumerAverageSubmitterRowOwnerActionPacketRecommendedConfirmedRecipeCommandAvailable,
    consumerAverageSubmitterRowOwnerActionPacketSelectedRecipeId:
      output.summary.consumerAverageSubmitterRowOwnerActionPacketSelectedRecipeId,
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketArtifact:
      output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigPacketArtifact,
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketBlockers:
      output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigPacketBlockers,
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketConclusion:
      output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigPacketConclusion,
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketExpectedRouteIds:
      output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigPacketExpectedRouteIds,
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketNextAction:
      output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigPacketNextAction,
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketRequiredFieldRefFamilies:
      output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigPacketRequiredFieldRefFamilies,
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketRequiredTableRefs:
      output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigPacketRequiredTableRefs,
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigPrivateFieldRefKeys:
      output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigPrivateFieldRefKeys,
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigPrivateTableRefKeys:
      output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigPrivateTableRefKeys,
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigRouteRunOrder:
      output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigRouteRunOrder,
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigSchemaVersion:
      output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigSchemaVersion,
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigTopLevelKeys:
      output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigTopLevelKeys,
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketRowOwnerAssertionsConfirmed:
      output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigPacketRowOwnerAssertionsConfirmed,
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketTemplateArtifact:
      output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigPacketTemplateArtifact,
    consumerAverageSubmitterPostConfirmationPrivateConfigPacketTemplateReadyForFill:
      output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigPacketTemplateReadyForFill,
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeArtifact:
      output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeArtifact,
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeConclusion:
      output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeConclusion,
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeEvidenceRoleStatus:
      output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeEvidenceRoleStatus,
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeMissingAttestationKeys:
      output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeMissingAttestationKeys,
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeMissingRouteIds:
      output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeMissingRouteIds,
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeMissingRunnerFieldRefKeys:
      output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeMissingRunnerFieldRefKeys,
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeMissingRunnerTableRefKeys:
      output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeMissingRunnerTableRefKeys,
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeNextAction:
      output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeNextAction,
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeOrdinaryTableLayout:
      output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeOrdinaryTableLayout,
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakePacketReadyForConfigIntake:
      output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakePacketReadyForConfigIntake,
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakePrivateConfigStatus:
      output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakePrivateConfigStatus,
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakePrivateConfigSupplied:
      output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakePrivateConfigSupplied,
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeR1147Conclusion:
      output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeR1147Conclusion,
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeR1147NextAction:
      output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeR1147NextAction,
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeReadyForR1142:
      output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeReadyForR1142,
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeRequestedRouteIds:
      output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeRequestedRouteIds,
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeActionGuardPresent:
      output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeActionGuardPresent,
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketConclusion:
      output.summary
        .consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketConclusion,
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketFeatureOnlyCoverageContextReady:
      output.summary
        .consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketFeatureOnlyCoverageContextReady,
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds:
      output.summary
        .consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds,
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketMissingRequiredSourceFamilyIds:
      output.summary
        .consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketMissingRequiredSourceFamilyIds,
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketNextAction:
      output.summary
        .consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketNextAction,
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain:
      output.summary
        .consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain,
    consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketRowLevelDataAcceptedByR1154:
      output.summary
        .consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketRowLevelDataAcceptedByR1154,
    consumerAverageSubmitterLabWearableSubmissionKitArtifact:
      output.summary.consumerAverageSubmitterLabWearableSubmissionKitArtifact,
    consumerAverageSubmitterLabWearableSubmissionKitConclusion:
      output.summary.consumerAverageSubmitterLabWearableSubmissionKitConclusion,
    consumerAverageSubmitterLabWearableSubmissionKitNextAction:
      output.summary.consumerAverageSubmitterLabWearableSubmissionKitNextAction,
    consumerAverageSubmitterLabWearableSubmissionKitOptionalAddOnFamilyIds:
      output.summary.consumerAverageSubmitterLabWearableSubmissionKitOptionalAddOnFamilyIds,
    consumerAverageSubmitterLabWearableSubmissionKitPrivateConfigReadyForR1142:
      output.summary.consumerAverageSubmitterLabWearableSubmissionKitPrivateConfigReadyForR1142,
    consumerAverageSubmitterLabWearableSubmissionKitPrivateConfigStatus:
      output.summary.consumerAverageSubmitterLabWearableSubmissionKitPrivateConfigStatus,
    consumerAverageSubmitterLabWearableSubmissionKitReadyForResearchReview:
      output.summary.consumerAverageSubmitterLabWearableSubmissionKitReadyForResearchReview,
    consumerAverageSubmitterLabWearableSubmissionKitRequiredSourceFamilyIds:
      output.summary.consumerAverageSubmitterLabWearableSubmissionKitRequiredSourceFamilyIds,
    consumerAverageSubmitterLabWearableSubmissionKitRowOwnerAssertionsConfirmed:
      output.summary.consumerAverageSubmitterLabWearableSubmissionKitRowOwnerAssertionsConfirmed,
    consumerAverageSubmitterLabWearableSubmissionKitTopBlocker:
      output.summary.consumerAverageSubmitterLabWearableSubmissionKitTopBlocker,
    consumerAverageSubmitterSafeAvailabilityConfirmationArtifact:
      output.summary.consumerAverageSubmitterSafeAvailabilityConfirmationArtifact,
    consumerAverageSubmitterSafeAvailabilityConfirmationConclusion:
      output.summary.consumerAverageSubmitterSafeAvailabilityConfirmationConclusion,
    consumerAverageSubmitterSafeAvailabilityConfirmationMissingAggregateReadinessFactIds:
      output.summary.consumerAverageSubmitterSafeAvailabilityConfirmationMissingAggregateReadinessFactIds,
    consumerAverageSubmitterSafeAvailabilityConfirmationMissingAttestationKeys:
      output.summary.consumerAverageSubmitterSafeAvailabilityConfirmationMissingAttestationKeys,
    consumerAverageSubmitterSafeAvailabilityConfirmationMissingFeatureOnlySourceFamilyIds:
      output.summary.consumerAverageSubmitterSafeAvailabilityConfirmationMissingFeatureOnlySourceFamilyIds,
    consumerAverageSubmitterSafeAvailabilityConfirmationMissingSourceFamilyIds:
      output.summary.consumerAverageSubmitterSafeAvailabilityConfirmationMissingSourceFamilyIds,
    consumerAverageSubmitterSafeAvailabilityConfirmationFeatureOnlyCoverageContextReady:
      output.summary.consumerAverageSubmitterSafeAvailabilityConfirmationFeatureOnlyCoverageContextReady,
    consumerAverageSubmitterSafeAvailabilityConfirmationFeatureOnlyCoverageRequiresPreferredPair:
      output.summary.consumerAverageSubmitterSafeAvailabilityConfirmationFeatureOnlyCoverageRequiresPreferredPair,
    consumerAverageSubmitterSafeAvailabilityConfirmationChecklistItemIds:
      output.summary.consumerAverageSubmitterSafeAvailabilityConfirmationChecklistItemIds,
    consumerAverageSubmitterSafeAvailabilityConfirmationMinimumFeaturePairRequired:
      output.summary.consumerAverageSubmitterSafeAvailabilityConfirmationMinimumFeaturePairRequired,
    consumerAverageSubmitterSafeAvailabilityConfirmationNextAction:
      output.summary.consumerAverageSubmitterSafeAvailabilityConfirmationNextAction,
    consumerAverageSubmitterSafeAvailabilityConfirmationOutcomeLinkageRequiredForFeatureOnlyContext:
      output.summary.consumerAverageSubmitterSafeAvailabilityConfirmationOutcomeLinkageRequiredForFeatureOnlyContext,
    consumerAverageSubmitterSafeAvailabilityConfirmationReadyForRecipeReadinessChain:
      output.summary.consumerAverageSubmitterSafeAvailabilityConfirmationReadyForRecipeReadinessChain,
    consumerAverageSubmitterSafeAvailabilityConfirmationRowOwnerAssertionsConfirmed:
      output.summary.consumerAverageSubmitterSafeAvailabilityConfirmationRowOwnerAssertionsConfirmed,
    consumerAverageSubmitterSafeAvailabilityConfirmationRowLevelDataAcceptedByR1150:
      output.summary.consumerAverageSubmitterSafeAvailabilityConfirmationRowLevelDataAcceptedByR1150,
    consumerAverageSubmitterSafeAvailabilityConfirmationStatus:
      output.summary.consumerAverageSubmitterSafeAvailabilityConfirmationStatus,
    consumerAverageSubmitterSafeAvailabilityConfirmationTemplateArtifact:
      output.summary.consumerAverageSubmitterSafeAvailabilityConfirmationTemplateArtifact,
    consumerAverageSubmitterSafeAvailabilityConfirmationFeatureOnlyTemplateArtifact:
      output.summary.consumerAverageSubmitterSafeAvailabilityConfirmationFeatureOnlyTemplateArtifact,
    consumerAverageSubmitterFeatureOnlyModeArtifact:
      output.summary.consumerAverageSubmitterFeatureOnlyModeArtifact,
    consumerAverageSubmitterFeatureOnlyModeConclusion:
      output.summary.consumerAverageSubmitterFeatureOnlyModeConclusion,
    consumerAverageSubmitterFeatureOnlyModeCoverageContextAllowed:
      output.summary.consumerAverageSubmitterFeatureOnlyModeCoverageContextAllowed,
    consumerAverageSubmitterFeatureOnlyModeCoverageRequiresPreferredPair:
      output.summary.consumerAverageSubmitterFeatureOnlyModeCoverageRequiresPreferredPair,
    consumerAverageSubmitterFeatureOnlyModeCoverageContextTemplateArtifact:
      output.summary.consumerAverageSubmitterFeatureOnlyModeCoverageContextTemplateArtifact,
    consumerAverageSubmitterFeatureOnlyModeMinimumFeaturePairRequired:
      output.summary.consumerAverageSubmitterFeatureOnlyModeMinimumFeaturePairRequired,
    consumerAverageSubmitterFeatureOnlyModeMissingAttestationKeys:
      output.summary.consumerAverageSubmitterFeatureOnlyModeMissingAttestationKeys,
    consumerAverageSubmitterFeatureOnlyModeMissingEvidenceSourceFamilyIds:
      output.summary.consumerAverageSubmitterFeatureOnlyModeMissingEvidenceSourceFamilyIds,
    consumerAverageSubmitterFeatureOnlyModeMissingPrimaryFeatureFamilyIds:
      output.summary.consumerAverageSubmitterFeatureOnlyModeMissingPrimaryFeatureFamilyIds,
    consumerAverageSubmitterFeatureOnlyModeModelEvidencePromotionAllowed:
      output.summary.consumerAverageSubmitterFeatureOnlyModeModelEvidencePromotionAllowed,
    consumerAverageSubmitterFeatureOnlyModeNextAction:
      output.summary.consumerAverageSubmitterFeatureOnlyModeNextAction,
    consumerAverageSubmitterFeatureOnlyModeOutcomeLinkageRequiredForFeatureOnlyContext:
      output.summary.consumerAverageSubmitterFeatureOnlyModeOutcomeLinkageRequiredForFeatureOnlyContext,
    consumerAverageSubmitterFeatureOnlyModeOutcomeLinkedEvidenceReady:
      output.summary.consumerAverageSubmitterFeatureOnlyModeOutcomeLinkedEvidenceReady,
    consumerAverageSubmitterFeatureOnlyModePreferredPairReady:
      output.summary.consumerAverageSubmitterFeatureOnlyModePreferredPairReady,
    consumerAverageSubmitterFeatureOnlyModeRowLevelDataAcceptedByR1151:
      output.summary.consumerAverageSubmitterFeatureOnlyModeRowLevelDataAcceptedByR1151,
    consumerAverageSubmitterFeatureOnlyModeSafeAvailabilityFeatureOnlyCoverageContextReady:
      output.summary.consumerAverageSubmitterFeatureOnlyModeSafeAvailabilityFeatureOnlyCoverageContextReady,
    consumerAverageSubmitterFeatureOnlyModeSafeAvailabilityFeatureOnlyReadinessPresent:
      output.summary.consumerAverageSubmitterFeatureOnlyModeSafeAvailabilityFeatureOnlyReadinessPresent,
    consumerAverageSubmitterFeatureOnlyModeSupportedFeatureFamilyIds:
      output.summary.consumerAverageSubmitterFeatureOnlyModeSupportedFeatureFamilyIds,
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeArtifact:
      output.summary.consumerAverageSubmitterFeatureOnlyCoverageContextIntakeArtifact,
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeConclusion:
      output.summary.consumerAverageSubmitterFeatureOnlyCoverageContextIntakeConclusion,
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeContextStatus:
      output.summary.consumerAverageSubmitterFeatureOnlyCoverageContextIntakeContextStatus,
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeReadyForResearchPlanning:
      output.summary.consumerAverageSubmitterFeatureOnlyCoverageContextIntakeReadyForResearchPlanning,
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeMinimumFeaturePairRequired:
      output.summary.consumerAverageSubmitterFeatureOnlyCoverageContextIntakeMinimumFeaturePairRequired,
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeMissingPrimaryFeatureFamilyIds:
      output.summary.consumerAverageSubmitterFeatureOnlyCoverageContextIntakeMissingPrimaryFeatureFamilyIds,
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeModelEvidencePromotionAllowed:
      output.summary.consumerAverageSubmitterFeatureOnlyCoverageContextIntakeModelEvidencePromotionAllowed,
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeNextAction:
      output.summary.consumerAverageSubmitterFeatureOnlyCoverageContextIntakeNextAction,
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeOutcomeLinkageRequiredForFeatureOnlyContext:
      output.summary.consumerAverageSubmitterFeatureOnlyCoverageContextIntakeOutcomeLinkageRequiredForFeatureOnlyContext,
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeR1151ReadyForIntake:
      output.summary.consumerAverageSubmitterFeatureOnlyCoverageContextIntakeR1151ReadyForIntake,
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeRowLevelDataAcceptedByR1152:
      output.summary.consumerAverageSubmitterFeatureOnlyCoverageContextIntakeRowLevelDataAcceptedByR1152,
    consumerAverageSubmitterFeatureOnlyCoverageContextIntakeSupportedFeatureFamilyIds:
      output.summary.consumerAverageSubmitterFeatureOnlyCoverageContextIntakeSupportedFeatureFamilyIds,
    consumerAverageSubmitterFeatureOnlyChainArtifact:
      output.summary.consumerAverageSubmitterFeatureOnlyChainArtifact,
    consumerAverageSubmitterFeatureOnlyChainConclusion:
      output.summary.consumerAverageSubmitterFeatureOnlyChainConclusion,
    consumerAverageSubmitterFeatureOnlyChainContextPathConfigured:
      output.summary.consumerAverageSubmitterFeatureOnlyChainContextPathConfigured,
    consumerAverageSubmitterFeatureOnlyChainCoverageContextReadyForResearchPlanning:
      output.summary.consumerAverageSubmitterFeatureOnlyChainCoverageContextReadyForResearchPlanning,
    consumerAverageSubmitterFeatureOnlyChainCoverageContextAllowed:
      output.summary.consumerAverageSubmitterFeatureOnlyChainCoverageContextAllowed,
    consumerAverageSubmitterFeatureOnlyChainCoverageContextIntakeConclusion:
      output.summary.consumerAverageSubmitterFeatureOnlyChainCoverageContextIntakeConclusion,
    consumerAverageSubmitterFeatureOnlyChainCoverageContextIntakeContextStatus:
      output.summary.consumerAverageSubmitterFeatureOnlyChainCoverageContextIntakeContextStatus,
    consumerAverageSubmitterFeatureOnlyChainFeatureOnlyModeConclusion:
      output.summary.consumerAverageSubmitterFeatureOnlyChainFeatureOnlyModeConclusion,
    consumerAverageSubmitterFeatureOnlyChainMinimumFeaturePairRequired:
      output.summary.consumerAverageSubmitterFeatureOnlyChainMinimumFeaturePairRequired,
    consumerAverageSubmitterFeatureOnlyChainMissingCoverageContextPrimaryFeatureFamilyIds:
      output.summary.consumerAverageSubmitterFeatureOnlyChainMissingCoverageContextPrimaryFeatureFamilyIds,
    consumerAverageSubmitterFeatureOnlyChainMissingFeatureOnlySourceFamilyIds:
      output.summary.consumerAverageSubmitterFeatureOnlyChainMissingFeatureOnlySourceFamilyIds,
    consumerAverageSubmitterFeatureOnlyChainModelEvidencePromotionAllowed:
      output.summary.consumerAverageSubmitterFeatureOnlyChainModelEvidencePromotionAllowed,
    consumerAverageSubmitterFeatureOnlyChainNextAction:
      output.summary.consumerAverageSubmitterFeatureOnlyChainNextAction,
    consumerAverageSubmitterFeatureOnlyChainOutcomeLinkageRequiredForFeatureOnlyContext:
      output.summary.consumerAverageSubmitterFeatureOnlyChainOutcomeLinkageRequiredForFeatureOnlyContext,
    consumerAverageSubmitterFeatureOnlyChainRowLevelDataAcceptedByR1153:
      output.summary.consumerAverageSubmitterFeatureOnlyChainRowLevelDataAcceptedByR1153,
    consumerAverageSubmitterFeatureOnlyChainSafeAvailabilityFeatureOnlyCoverageContextReady:
      output.summary.consumerAverageSubmitterFeatureOnlyChainSafeAvailabilityFeatureOnlyCoverageContextReady,
    consumerAverageSubmitterFeatureOnlyChainSafeAvailabilityReadyForRecipeReadinessChain:
      output.summary.consumerAverageSubmitterFeatureOnlyChainSafeAvailabilityReadyForRecipeReadinessChain,
    consumerAverageSubmitterFeatureOnlyChainSupportedFeatureFamilyIds:
      output.summary.consumerAverageSubmitterFeatureOnlyChainSupportedFeatureFamilyIds,
    consumerAverageSubmitterSafeAvailabilityActionPacketArtifact:
      output.summary.consumerAverageSubmitterSafeAvailabilityActionPacketArtifact,
    consumerAverageSubmitterSafeAvailabilityActionPacketCommand:
      output.summary.consumerAverageSubmitterSafeAvailabilityActionPacketCommand,
    consumerAverageSubmitterSafeAvailabilityActionPacketConclusion:
      output.summary.consumerAverageSubmitterSafeAvailabilityActionPacketConclusion,
    consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyCoverageContextReady:
      output.summary.consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyCoverageContextReady,
    consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyQuickstartArtifact:
      output.summary.consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyQuickstartArtifact,
    consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount:
      output.summary.consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount,
    consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths:
      output.summary.consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths,
    consumerAverageSubmitterSafeAvailabilityConfirmationIntakeCommand:
      output.summary.consumerAverageSubmitterSafeAvailabilityConfirmationIntakeCommand,
    consumerAverageSubmitterSafeAvailabilityFeatureOnlyChainRunnerCommand:
      output.summary.consumerAverageSubmitterSafeAvailabilityFeatureOnlyChainRunnerCommand,
    consumerAverageSubmitterSafeAvailabilityOutcomeLinkedRecipeReadinessCommand:
      output.summary.consumerAverageSubmitterSafeAvailabilityOutcomeLinkedRecipeReadinessCommand,
    consumerAverageSubmitterSafeAvailabilityCompletionModeIds:
      output.summary.consumerAverageSubmitterSafeAvailabilityCompletionModeIds,
    consumerAverageSubmitterSafeAvailabilityActionPacketChecklistItemIds:
      output.summary.consumerAverageSubmitterSafeAvailabilityActionPacketChecklistItemIds,
    consumerAverageSubmitterSafeAvailabilityActionPacketMinimumFeaturePairRequired:
      output.summary.consumerAverageSubmitterSafeAvailabilityActionPacketMinimumFeaturePairRequired,
    consumerAverageSubmitterSafeAvailabilityActionPacketMissingAggregateReadinessFactIds:
      output.summary.consumerAverageSubmitterSafeAvailabilityActionPacketMissingAggregateReadinessFactIds,
    consumerAverageSubmitterSafeAvailabilityActionPacketMissingAttestationKeys:
      output.summary.consumerAverageSubmitterSafeAvailabilityActionPacketMissingAttestationKeys,
    consumerAverageSubmitterSafeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds:
      output.summary.consumerAverageSubmitterSafeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds,
    consumerAverageSubmitterSafeAvailabilityActionPacketMissingRequiredSourceFamilyIds:
      output.summary.consumerAverageSubmitterSafeAvailabilityActionPacketMissingRequiredSourceFamilyIds,
    consumerAverageSubmitterSafeAvailabilityActionPacketNextAction:
      output.summary.consumerAverageSubmitterSafeAvailabilityActionPacketNextAction,
    consumerAverageSubmitterSafeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain:
      output.summary.consumerAverageSubmitterSafeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain,
    consumerAverageSubmitterSafeAvailabilityActionPacketRowLevelDataAcceptedByR1154:
      output.summary.consumerAverageSubmitterSafeAvailabilityActionPacketRowLevelDataAcceptedByR1154,
    consumerAverageSubmitterSafeAvailabilityActionPacketRowOwnerWorkType:
      output.summary.consumerAverageSubmitterSafeAvailabilityActionPacketRowOwnerWorkType,
    consumerAverageSubmitterSafeAvailabilityActionPacketRowParsingPerformedByR1154:
      output.summary.consumerAverageSubmitterSafeAvailabilityActionPacketRowParsingPerformedByR1154,
    consumerAverageSubmitterSafeAvailabilityActionPacketTemplateArtifact:
      output.summary.consumerAverageSubmitterSafeAvailabilityActionPacketTemplateArtifact,
    consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyTemplateArtifact:
      output.summary.consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyTemplateArtifact,
    consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofArtifact:
      output.summary.consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofArtifact,
    consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofConclusion:
      output.summary.consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofConclusion,
    consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofNextAction:
      output.summary.consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofNextAction,
    consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofFeatureOnlyChainConclusion:
      output.summary.consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofFeatureOnlyChainConclusion,
    consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofFeatureOnlyCoverageContextReadyForResearchPlanning:
      output.summary
        .consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofFeatureOnlyCoverageContextReadyForResearchPlanning,
    consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofSafeAvailabilityConfirmationConclusion:
      output.summary.consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofSafeAvailabilityConfirmationConclusion,
    consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofReadyForRecipeReadinessChain:
      output.summary.consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofReadyForRecipeReadinessChain,
    consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofModelEvidencePromotionAllowed:
      output.summary.consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofModelEvidencePromotionAllowed,
    consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofRowLevelDataAcceptedByR1155:
      output.summary.consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofRowLevelDataAcceptedByR1155,
    consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofSmokeEvidence:
      output.summary.consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofSmokeEvidence,
    consumerAverageSubmitterSafeConfirmationHandoffArtifact:
      output.summary.consumerAverageSubmitterSafeConfirmationHandoffArtifact,
    consumerAverageSubmitterSafeConfirmationHandoffCommand:
      output.summary.consumerAverageSubmitterSafeConfirmationHandoffCommand,
    consumerAverageSubmitterSafeConfirmationHandoffConclusion:
      output.summary.consumerAverageSubmitterSafeConfirmationHandoffConclusion,
    consumerAverageSubmitterSafeConfirmationHandoffNextAction:
      output.summary.consumerAverageSubmitterSafeConfirmationHandoffNextAction,
    consumerAverageSubmitterSafeConfirmationHandoffFeatureOnlyPathMechanicallyProven:
      output.summary.consumerAverageSubmitterSafeConfirmationHandoffFeatureOnlyPathMechanicallyProven,
    consumerAverageSubmitterSafeConfirmationHandoffHandoffReadyForRowOwner:
      output.summary.consumerAverageSubmitterSafeConfirmationHandoffHandoffReadyForRowOwner,
    consumerAverageSubmitterSafeConfirmationHandoffModelEvidencePromotionAllowed:
      output.summary.consumerAverageSubmitterSafeConfirmationHandoffModelEvidencePromotionAllowed,
    consumerAverageSubmitterSafeConfirmationHandoffReadyForModelEvidence:
      output.summary.consumerAverageSubmitterSafeConfirmationHandoffReadyForModelEvidence,
    consumerAverageSubmitterSafeConfirmationHandoffReadyForRecipeReadinessChain:
      output.summary.consumerAverageSubmitterSafeConfirmationHandoffReadyForRecipeReadinessChain,
    consumerAverageSubmitterSafeConfirmationHandoffRequiredFeatureOnlySourceFamilyIds:
      output.summary.consumerAverageSubmitterSafeConfirmationHandoffRequiredFeatureOnlySourceFamilyIds,
    consumerAverageSubmitterSafeConfirmationHandoffRequiredSafeCompletionCheckIds:
      output.summary.consumerAverageSubmitterSafeConfirmationHandoffRequiredSafeCompletionCheckIds,
    consumerAverageSubmitterSafeConfirmationHandoffRowLevelDataAcceptedByR1156:
      output.summary.consumerAverageSubmitterSafeConfirmationHandoffRowLevelDataAcceptedByR1156,
    consumerAverageSubmitterSafeConfirmationHandoffRowOwnerWorkType:
      output.summary.consumerAverageSubmitterSafeConfirmationHandoffRowOwnerWorkType,
    consumerAverageSubmitterSafeConfirmationHandoffSafeConfirmationStillRequired:
      output.summary.consumerAverageSubmitterSafeConfirmationHandoffSafeConfirmationStillRequired,
    consumerAverageSubmitterSafeConfirmationHandoffSmokeEvidence:
      output.summary.consumerAverageSubmitterSafeConfirmationHandoffSmokeEvidence,
    consumerAverageSubmitterSafeConfirmationChainRunnerArtifact:
      output.summary.consumerAverageSubmitterSafeConfirmationChainRunnerArtifact,
    consumerAverageSubmitterSafeConfirmationChainRunnerCommand:
      output.summary.consumerAverageSubmitterSafeConfirmationChainRunnerCommand,
    consumerAverageSubmitterSafeConfirmationChainRunnerConclusion:
      output.summary.consumerAverageSubmitterSafeConfirmationChainRunnerConclusion,
    consumerAverageSubmitterSafeConfirmationChainRunnerNextAction:
      output.summary.consumerAverageSubmitterSafeConfirmationChainRunnerNextAction,
    consumerAverageSubmitterSafeConfirmationChainRunnerConfirmationPathConfigured:
      output.summary.consumerAverageSubmitterSafeConfirmationChainRunnerConfirmationPathConfigured,
    consumerAverageSubmitterSafeConfirmationChainRunnerFeatureOnlyCoverageContextReady:
      output.summary.consumerAverageSubmitterSafeConfirmationChainRunnerFeatureOnlyCoverageContextReady,
    consumerAverageSubmitterSafeConfirmationChainRunnerFeatureOnlyResearchPlanningReady:
      output.summary.consumerAverageSubmitterSafeConfirmationChainRunnerFeatureOnlyResearchPlanningReady,
    consumerAverageSubmitterSafeConfirmationChainRunnerReadyForModelEvidence:
      output.summary.consumerAverageSubmitterSafeConfirmationChainRunnerReadyForModelEvidence,
    consumerAverageSubmitterSafeConfirmationChainRunnerReadyForRecipeReadinessChain:
      output.summary.consumerAverageSubmitterSafeConfirmationChainRunnerReadyForRecipeReadinessChain,
    consumerAverageSubmitterSafeConfirmationChainRunnerRowLevelDataAcceptedByR1157:
      output.summary.consumerAverageSubmitterSafeConfirmationChainRunnerRowLevelDataAcceptedByR1157,
    consumerAverageSubmitterSafeConfirmationChainRunnerSafeConfirmationStillRequired:
      output.summary.consumerAverageSubmitterSafeConfirmationChainRunnerSafeConfirmationStillRequired,
    consumerAverageSubmitterSafeConfirmationFillGuideArtifact:
      output.summary.consumerAverageSubmitterSafeConfirmationFillGuideArtifact,
    consumerAverageSubmitterSafeConfirmationFillGuideCommand:
      output.summary.consumerAverageSubmitterSafeConfirmationFillGuideCommand,
    consumerAverageSubmitterSafeConfirmationFillGuideConclusion:
      output.summary.consumerAverageSubmitterSafeConfirmationFillGuideConclusion,
    consumerAverageSubmitterSafeConfirmationFillGuideExactSafeFieldEditCount:
      output.summary.consumerAverageSubmitterSafeConfirmationFillGuideExactSafeFieldEditCount,
    consumerAverageSubmitterSafeConfirmationFillGuideGuideReadyForRowOwnerFill:
      output.summary.consumerAverageSubmitterSafeConfirmationFillGuideGuideReadyForRowOwnerFill,
    consumerAverageSubmitterSafeConfirmationFillGuideMinimumFeaturePairRequired:
      output.summary.consumerAverageSubmitterSafeConfirmationFillGuideMinimumFeaturePairRequired,
    consumerAverageSubmitterSafeConfirmationFillGuideNextAction:
      output.summary.consumerAverageSubmitterSafeConfirmationFillGuideNextAction,
    consumerAverageSubmitterSafeConfirmationFillGuideOptionalAddOnFamilyIds:
      output.summary.consumerAverageSubmitterSafeConfirmationFillGuideOptionalAddOnFamilyIds,
    consumerAverageSubmitterSafeConfirmationFillGuideRequiredChecklistIds:
      output.summary.consumerAverageSubmitterSafeConfirmationFillGuideRequiredChecklistIds,
    consumerAverageSubmitterSafeConfirmationFillGuideRequiredInputKindIds:
      output.summary.consumerAverageSubmitterSafeConfirmationFillGuideRequiredInputKindIds,
    consumerAverageSubmitterSafeConfirmationFillGuideRowLevelDataAcceptedByR1158:
      output.summary.consumerAverageSubmitterSafeConfirmationFillGuideRowLevelDataAcceptedByR1158,
    consumerAverageSubmitterSafeConfirmationAnswerSheetArtifact:
      output.summary.consumerAverageSubmitterSafeConfirmationAnswerSheetArtifact,
    consumerAverageSubmitterSafeConfirmationAnswerSheetCommand:
      output.summary.consumerAverageSubmitterSafeConfirmationAnswerSheetCommand,
    consumerAverageSubmitterSafeConfirmationAnswerSheetConclusion:
      output.summary.consumerAverageSubmitterSafeConfirmationAnswerSheetConclusion,
    consumerAverageSubmitterSafeConfirmationAnswerSheetExactSafeAnswerCount:
      output.summary.consumerAverageSubmitterSafeConfirmationAnswerSheetExactSafeAnswerCount,
    consumerAverageSubmitterSafeConfirmationAnswerSheetReadyForRowOwner:
      output.summary.consumerAverageSubmitterSafeConfirmationAnswerSheetReadyForRowOwner,
    consumerAverageSubmitterSafeConfirmationAnswerSheetMinimumFeaturePairRequired:
      output.summary.consumerAverageSubmitterSafeConfirmationAnswerSheetMinimumFeaturePairRequired,
    consumerAverageSubmitterSafeConfirmationAnswerSheetNextAction:
      output.summary.consumerAverageSubmitterSafeConfirmationAnswerSheetNextAction,
    consumerAverageSubmitterSafeConfirmationAnswerSheetOptionalAddOnFamilyIds:
      output.summary.consumerAverageSubmitterSafeConfirmationAnswerSheetOptionalAddOnFamilyIds,
    consumerAverageSubmitterSafeConfirmationAnswerSheetRequiredChecklistIds:
      output.summary.consumerAverageSubmitterSafeConfirmationAnswerSheetRequiredChecklistIds,
    consumerAverageSubmitterSafeConfirmationAnswerSheetRequiredInputKindIds:
      output.summary.consumerAverageSubmitterSafeConfirmationAnswerSheetRequiredInputKindIds,
    consumerAverageSubmitterSafeConfirmationAnswerSheetRowLevelDataAcceptedByR1159:
      output.summary.consumerAverageSubmitterSafeConfirmationAnswerSheetRowLevelDataAcceptedByR1159,
    consumerAverageSubmitterSafeConfirmationAnswerSheetRowOwnerProvidedValuesStored:
      output.summary.consumerAverageSubmitterSafeConfirmationAnswerSheetRowOwnerProvidedValuesStored,
    consumerAverageSubmitterSafeConfirmationTranscriptionProofArtifact:
      output.summary.consumerAverageSubmitterSafeConfirmationTranscriptionProofArtifact,
    consumerAverageSubmitterSafeConfirmationTranscriptionProofCommand:
      output.summary.consumerAverageSubmitterSafeConfirmationTranscriptionProofCommand,
    consumerAverageSubmitterSafeConfirmationTranscriptionProofConclusion:
      output.summary.consumerAverageSubmitterSafeConfirmationTranscriptionProofConclusion,
    consumerAverageSubmitterSafeConfirmationTranscriptionProofExactSafeTranscriptionStepCount:
      output.summary.consumerAverageSubmitterSafeConfirmationTranscriptionProofExactSafeTranscriptionStepCount,
    consumerAverageSubmitterSafeConfirmationTranscriptionProofReadyForRowOwnerConfirmation:
      output.summary.consumerAverageSubmitterSafeConfirmationTranscriptionProofReadyForRowOwnerConfirmation,
    consumerAverageSubmitterSafeConfirmationTranscriptionProofHypotheticalTranscriptionWouldBeFeatureOnlyReady:
      output.summary.consumerAverageSubmitterSafeConfirmationTranscriptionProofHypotheticalTranscriptionWouldBeFeatureOnlyReady,
    consumerAverageSubmitterSafeConfirmationTranscriptionProofNextAction:
      output.summary.consumerAverageSubmitterSafeConfirmationTranscriptionProofNextAction,
    consumerAverageSubmitterSafeConfirmationTranscriptionProofRequiredInputKindIds:
      output.summary.consumerAverageSubmitterSafeConfirmationTranscriptionProofRequiredInputKindIds,
    consumerAverageSubmitterSafeConfirmationTranscriptionProofRowLevelDataAcceptedByR1160:
      output.summary.consumerAverageSubmitterSafeConfirmationTranscriptionProofRowLevelDataAcceptedByR1160,
    consumerAverageSubmitterSafeConfirmationTranscriptionProofRowOwnerConfirmationStillRequired:
      output.summary.consumerAverageSubmitterSafeConfirmationTranscriptionProofRowOwnerConfirmationStillRequired,
    consumerAverageSubmitterSafeConfirmationTranscriptionProofConfirmationValuesStoredByR1160:
      output.summary.consumerAverageSubmitterSafeConfirmationTranscriptionProofConfirmationValuesStoredByR1160,
    consumerAverageSubmitterSafeConfirmationTranscriptionProofRowOwnerProvidedValuesStored:
      output.summary.consumerAverageSubmitterSafeConfirmationTranscriptionProofRowOwnerProvidedValuesStored,
    consumerAverageSubmitterSafeConfirmationMaterializerArtifact:
      output.summary.consumerAverageSubmitterSafeConfirmationMaterializerArtifact,
    consumerAverageSubmitterSafeConfirmationMaterializerCommand:
      output.summary.consumerAverageSubmitterSafeConfirmationMaterializerCommand,
    consumerAverageSubmitterSafeConfirmationMaterializerConclusion:
      output.summary.consumerAverageSubmitterSafeConfirmationMaterializerConclusion,
    consumerAverageSubmitterSafeConfirmationMaterializerNextAction:
      output.summary.consumerAverageSubmitterSafeConfirmationMaterializerNextAction,
    consumerAverageSubmitterSafeConfirmationMaterializerExplicitRowOwnerConfirmationAssertionProvided:
      output.summary.consumerAverageSubmitterSafeConfirmationMaterializerExplicitRowOwnerConfirmationAssertionProvided,
    consumerAverageSubmitterSafeConfirmationMaterializerSafeConfirmationArtifactWritten:
      output.summary.consumerAverageSubmitterSafeConfirmationMaterializerSafeConfirmationArtifactWritten,
    consumerAverageSubmitterSafeConfirmationMaterializerSafeConfirmationArtifact:
      output.summary.consumerAverageSubmitterSafeConfirmationMaterializerSafeConfirmationArtifact,
    consumerAverageSubmitterSafeConfirmationMaterializerFeatureOnlyConfirmationWouldBeReadyForR1150:
      output.summary.consumerAverageSubmitterSafeConfirmationMaterializerFeatureOnlyConfirmationWouldBeReadyForR1150,
    consumerAverageSubmitterSafeConfirmationMaterializerRowOwnerConfirmationStillRequired:
      output.summary.consumerAverageSubmitterSafeConfirmationMaterializerRowOwnerConfirmationStillRequired,
    consumerAverageSubmitterSafeConfirmationMaterializerConfirmationValuesStoredInR1161Packet:
      output.summary.consumerAverageSubmitterSafeConfirmationMaterializerConfirmationValuesStoredInR1161Packet,
    consumerAverageSubmitterSafeConfirmationMaterializerRowLevelDataAcceptedByR1161:
      output.summary.consumerAverageSubmitterSafeConfirmationMaterializerRowLevelDataAcceptedByR1161,
    consumerAverageSubmitterSafeConfirmationMaterializerRowOwnerPrivateValuesStored:
      output.summary.consumerAverageSubmitterSafeConfirmationMaterializerRowOwnerPrivateValuesStored,
    consumerAverageSubmitterFeatureOnlyResearchHandoffArtifact:
      output.summary.consumerAverageSubmitterFeatureOnlyResearchHandoffArtifact,
    consumerAverageSubmitterFeatureOnlyResearchHandoffCommand:
      output.summary.consumerAverageSubmitterFeatureOnlyResearchHandoffCommand,
    consumerAverageSubmitterFeatureOnlyResearchHandoffConclusion:
      output.summary.consumerAverageSubmitterFeatureOnlyResearchHandoffConclusion,
    consumerAverageSubmitterFeatureOnlyResearchHandoffNextAction:
      output.summary.consumerAverageSubmitterFeatureOnlyResearchHandoffNextAction,
    consumerAverageSubmitterFeatureOnlyResearchHandoffFeatureOnlyResearchPlanningReady:
      output.summary.consumerAverageSubmitterFeatureOnlyResearchHandoffFeatureOnlyResearchPlanningReady,
    consumerAverageSubmitterFeatureOnlyResearchHandoffResearchPlanningAllowed:
      output.summary.consumerAverageSubmitterFeatureOnlyResearchHandoffResearchPlanningAllowed,
    consumerAverageSubmitterFeatureOnlyResearchHandoffOutcomeLinkedModelEvidenceStillRequired:
      output.summary.consumerAverageSubmitterFeatureOnlyResearchHandoffOutcomeLinkedModelEvidenceStillRequired,
    consumerAverageSubmitterFeatureOnlyResearchHandoffPrioritizedInputKindIds:
      output.summary.consumerAverageSubmitterFeatureOnlyResearchHandoffPrioritizedInputKindIds,
    consumerAverageSubmitterFeatureOnlyResearchHandoffMinimumFeaturePairRequired:
      output.summary.consumerAverageSubmitterFeatureOnlyResearchHandoffMinimumFeaturePairRequired,
    consumerAverageSubmitterFeatureOnlyResearchHandoffRowLevelDataAcceptedByR1164:
      output.summary.consumerAverageSubmitterFeatureOnlyResearchHandoffRowLevelDataAcceptedByR1164,
    consumerAverageSubmitterFeatureOnlyResearchHandoffRowOwnerPrivateValuesStored:
      output.summary.consumerAverageSubmitterFeatureOnlyResearchHandoffRowOwnerPrivateValuesStored,
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerArtifact:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerArtifact,
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerCommand:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerCommand,
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerConclusion:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerConclusion,
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerNextAction:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerNextAction,
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerAssertionAccepted:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerAssertionAccepted,
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerAssertionProvided:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerAssertionProvided,
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerAssertionTemplateArtifact:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerAssertionTemplateArtifact,
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerChildR1163Ran:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerChildR1163Ran,
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerFeatureOnlyResearchPlanningReady:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerFeatureOnlyResearchPlanningReady,
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerRequiredInputKindIds:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerRequiredInputKindIds,
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerRequiredAssertionChecklistIds:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerRequiredAssertionChecklistIds,
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerOptionalAddOnFamilyIds:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerOptionalAddOnFamilyIds,
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerValidationReasonIds:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerValidationReasonIds,
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerRowLevelDataAcceptedByR1165:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerRowLevelDataAcceptedByR1165,
    consumerAverageSubmitterFeatureOnlySafeAssertionRunnerRowOwnerPrivateValuesStored:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerRowOwnerPrivateValuesStored,
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideArtifact:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideArtifact,
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideCommand:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideCommand,
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideConclusion:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideConclusion,
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideNextAction:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideNextAction,
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideGuideReadyForRowOwnerFill:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideGuideReadyForRowOwnerFill,
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideRequiredInputKindIds:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideRequiredInputKindIds,
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideOptionalAddOnFamilyIds:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideOptionalAddOnFamilyIds,
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideSafeFieldEditCount:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideSafeFieldEditCount,
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideSafeFieldEditPaths:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideSafeFieldEditPaths,
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideRowLevelDataAcceptedByR1167:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideRowLevelDataAcceptedByR1167,
    consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideRowOwnerPrivateValuesStored:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideRowOwnerPrivateValuesStored,
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetArtifact:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetArtifact,
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetCommand:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetCommand,
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetConclusion:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetConclusion,
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetNextAction:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetNextAction,
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetReadyForRowOwner:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetReadyForRowOwner,
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetMaterializerReady:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetMaterializerReady,
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetMaterializerExplicitConfirmationRequired:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetMaterializerExplicitConfirmationRequired,
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetExactSafeAnswerCount:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetExactSafeAnswerCount,
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetAllowedValueKindIds:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetAllowedValueKindIds,
    consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetBlockedAssertionContentIds:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetBlockedAssertionContentIds,
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketArtifact:
      output.summary.consumerAverageSubmitterFeatureOnlySafeNextStepPacketArtifact,
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketCommand:
      output.summary.consumerAverageSubmitterFeatureOnlySafeNextStepPacketCommand,
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketAllowedValueKindIds:
      output.summary.consumerAverageSubmitterFeatureOnlySafeNextStepPacketAllowedValueKindIds,
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketBlockedContentIds:
      output.summary.consumerAverageSubmitterFeatureOnlySafeNextStepPacketBlockedContentIds,
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketConclusion:
      output.summary.consumerAverageSubmitterFeatureOnlySafeNextStepPacketConclusion,
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketNextAction:
      output.summary.consumerAverageSubmitterFeatureOnlySafeNextStepPacketNextAction,
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForRowOwnerR1172Confirmation:
      output.summary.consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForRowOwnerR1172Confirmation,
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForRowOwnerR1176LiveChainConfirmation:
      output.summary.consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForRowOwnerR1176LiveChainConfirmation,
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketR1176LiveChainCommand:
      output.summary.consumerAverageSubmitterFeatureOnlySafeNextStepPacketR1176LiveChainCommand,
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForR1165Runner:
      output.summary.consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForR1165Runner,
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketExactSafeFieldEditCount:
      output.summary.consumerAverageSubmitterFeatureOnlySafeNextStepPacketExactSafeFieldEditCount,
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketRowLevelDataAcceptedByR1174:
      output.summary.consumerAverageSubmitterFeatureOnlySafeNextStepPacketRowLevelDataAcceptedByR1174,
    consumerAverageSubmitterFeatureOnlySafeNextStepPacketRowOwnerProvidedValuesStored:
      output.summary.consumerAverageSubmitterFeatureOnlySafeNextStepPacketRowOwnerProvidedValuesStored,
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerArtifact:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerArtifact,
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerCommand:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerCommand,
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerConclusion:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerConclusion,
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerNextAction:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerNextAction,
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerExplicitRowOwnerAssertionProvided:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerExplicitRowOwnerAssertionProvided,
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerArtifactWritten:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerArtifactWritten,
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerRowOwnerAssertionStillRequired:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerRowOwnerAssertionStillRequired,
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerWouldBeAcceptedByR1165:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerWouldBeAcceptedByR1165,
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerAllowedValueKindIds:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerAllowedValueKindIds,
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerBlockedContentIds:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerBlockedContentIds,
    consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerSafeFieldEditCount:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerSafeFieldEditCount,
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofArtifact:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofArtifact,
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofCommand:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofCommand,
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofConclusion:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofConclusion,
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofNextAction:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofNextAction,
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofPassed:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofPassed,
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofSynthetic:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofSynthetic,
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofRealEvidenceProduced:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofRealEvidenceProduced,
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofModelEvidencePromotionAllowed:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofModelEvidencePromotionAllowed,
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofLiveChainGateStillRequired:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofLiveChainGateStillRequired,
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofR1165AssertionAccepted:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofR1165AssertionAccepted,
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofR1165ChildR1163Ran:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofR1165ChildR1163Ran,
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofR1165FeatureOnlyResearchPlanningReady:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofR1165FeatureOnlyResearchPlanningReady,
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofSafeFieldEditCount:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofSafeFieldEditCount,
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofSafeFieldEditPaths:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofSafeFieldEditPaths,
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofRowLevelDataAcceptedByR1170:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofRowLevelDataAcceptedByR1170,
    consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofRowOwnerPrivateValuesStored:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofRowOwnerPrivateValuesStored,
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeArtifact:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeArtifact,
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeCommand:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeCommand,
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeAllowedValueKindIds:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeAllowedValueKindIds,
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeBlockedContentIds:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeBlockedContentIds,
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeOptionalAddOnFamilyIds:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeOptionalAddOnFamilyIds,
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeConclusion:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeConclusion,
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeNextAction:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeNextAction,
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokePassed:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokePassed,
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeSynthetic:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeSynthetic,
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeRealEvidenceProduced:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeRealEvidenceProduced,
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeModelEvidencePromotionAllowed:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeModelEvidencePromotionAllowed,
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeLiveChainGateStillRequired:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeLiveChainGateStillRequired,
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1172MaterializedAssertionWritten:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1172MaterializedAssertionWritten,
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1172WouldBeAcceptedByR1165:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1172WouldBeAcceptedByR1165,
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1165AssertionAccepted:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1165AssertionAccepted,
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1165ChildR1163Ran:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1165ChildR1163Ran,
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1165FeatureOnlyResearchPlanningReady:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1165FeatureOnlyResearchPlanningReady,
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1163FeatureOnlyResearchPlanningReady:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1163FeatureOnlyResearchPlanningReady,
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeSafeFieldEditCount:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeSafeFieldEditCount,
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeSafeFieldEditPaths:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeSafeFieldEditPaths,
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeRowLevelDataAcceptedByR1175:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeRowLevelDataAcceptedByR1175,
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeRowOwnerPrivateValuesStored:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeRowOwnerPrivateValuesStored,
    consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeRowParsingPerformedByR1175:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeRowParsingPerformedByR1175,
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainArtifact:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainArtifact,
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainCommand:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainCommand,
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainAllowedValueKindIds:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainAllowedValueKindIds,
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainBlockedContentIds:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainBlockedContentIds,
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainOptionalAddOnFamilyIds:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainOptionalAddOnFamilyIds,
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainCompletionModeId:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainCompletionModeId,
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainConclusion:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainConclusion,
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainNextAction:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainNextAction,
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainReady:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainReady,
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainExplicitRowOwnerAssertionProvided:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainExplicitRowOwnerAssertionProvided,
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainFeatureOnlyResearchPlanningReady:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainFeatureOnlyResearchPlanningReady,
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRealEvidenceProduced:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRealEvidenceProduced,
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainModelEvidencePromotionAllowed:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainModelEvidencePromotionAllowed,
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainOutcomeLinkedModelEvidenceStillRequired:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainOutcomeLinkedModelEvidenceStillRequired,
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowOwnerAssertionStillRequired:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowOwnerAssertionStillRequired,
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowOwnerHandoffReasonId:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowOwnerHandoffReasonId,
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1172MaterializedAssertionWritten:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1172MaterializedAssertionWritten,
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1172WouldBeAcceptedByR1165:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1172WouldBeAcceptedByR1165,
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1165AssertionAccepted:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1165AssertionAccepted,
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1165ChildR1163Ran:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1165ChildR1163Ran,
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1165FeatureOnlyResearchPlanningReady:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1165FeatureOnlyResearchPlanningReady,
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1163FeatureOnlyResearchPlanningReady:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1163FeatureOnlyResearchPlanningReady,
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainSafeFieldEditCount:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainSafeFieldEditCount,
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainSafeFieldEditPaths:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainSafeFieldEditPaths,
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainSafeCompletionChecklistItemIds:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainSafeCompletionChecklistItemIds,
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowLevelDataAcceptedByR1176:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowLevelDataAcceptedByR1176,
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowOwnerPrivateValuesStored:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowOwnerPrivateValuesStored,
    consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowParsingPerformedByR1176:
      output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowParsingPerformedByR1176,
    consumerAverageSubmitterSafeResponseSmokeProofArtifact:
      output.summary.consumerAverageSubmitterSafeResponseSmokeProofArtifact,
    consumerAverageSubmitterSafeResponseSmokeProofCommand:
      output.summary.consumerAverageSubmitterSafeResponseSmokeProofCommand,
    consumerAverageSubmitterSafeResponseSmokeProofConclusion:
      output.summary.consumerAverageSubmitterSafeResponseSmokeProofConclusion,
    consumerAverageSubmitterSafeResponseSmokeProofLiveR1184Conclusion:
      output.summary.consumerAverageSubmitterSafeResponseSmokeProofLiveR1184Conclusion,
    consumerAverageSubmitterSafeResponseSmokeProofLiveR1184ReadyForSyntheticSmoke:
      output.summary.consumerAverageSubmitterSafeResponseSmokeProofLiveR1184ReadyForSyntheticSmoke,
    consumerAverageSubmitterSafeResponseSmokeProofNextRealAction:
      output.summary.consumerAverageSubmitterSafeResponseSmokeProofNextRealAction,
    consumerAverageSubmitterSafeResponseSmokeProofNextRealActionCommand:
      output.summary.consumerAverageSubmitterSafeResponseSmokeProofNextRealActionCommand,
    consumerAverageSubmitterSafeResponseSmokeProofNextRealActionRequiresExplicitRowOwnerAssertion:
      output.summary.consumerAverageSubmitterSafeResponseSmokeProofNextRealActionRequiresExplicitRowOwnerAssertion,
    consumerAverageSubmitterSafeResponseSmokeProofMinimumFeaturePairRequired:
      output.summary.consumerAverageSubmitterSafeResponseSmokeProofMinimumFeaturePairRequired,
    consumerAverageSubmitterSafeResponseSmokeProofPrioritizedInputKindIds:
      output.summary.consumerAverageSubmitterSafeResponseSmokeProofPrioritizedInputKindIds,
    consumerAverageSubmitterSafeResponseSmokeProofRequiredResponseFieldIds:
      output.summary.consumerAverageSubmitterSafeResponseSmokeProofRequiredResponseFieldIds,
    consumerAverageSubmitterSafeResponseSmokeProofSafeExecutionFeatureSlotIds:
      output.summary.consumerAverageSubmitterSafeResponseSmokeProofSafeExecutionFeatureSlotIds,
    consumerAverageSubmitterSafeResponseSmokeProofSyntheticPathAdvancedToFeatureOnlyResearchPlanning:
      output.summary.consumerAverageSubmitterSafeResponseSmokeProofSyntheticPathAdvancedToFeatureOnlyResearchPlanning,
    consumerAverageSubmitterSafeResponseSmokeProofSyntheticSmokeRan:
      output.summary.consumerAverageSubmitterSafeResponseSmokeProofSyntheticSmokeRan,
    consumerAverageSubmitterSafeResponseSmokeProofModelEvidencePromotionAllowed:
      output.summary.consumerAverageSubmitterSafeResponseSmokeProofModelEvidencePromotionAllowed,
    consumerAverageSubmitterSafeResponseSmokeProofProductDisplayAuthorized:
      output.summary.consumerAverageSubmitterSafeResponseSmokeProofProductDisplayAuthorized,
    consumerAverageSubmitterSafeResponseSmokeProofRowLevelDataAcceptedByR1185:
      output.summary.consumerAverageSubmitterSafeResponseSmokeProofRowLevelDataAcceptedByR1185,
    consumerAverageSubmitterSafeResponseSmokeProofRowOwnerConfirmationInferredByR1185:
      output.summary.consumerAverageSubmitterSafeResponseSmokeProofRowOwnerConfirmationInferredByR1185,
    consumerAverageSubmitterSafeResponseSmokeProofRowOwnerPrivateValuesStored:
      output.summary.consumerAverageSubmitterSafeResponseSmokeProofRowOwnerPrivateValuesStored,
    consumerAverageSubmitterSafeResponseSmokeProofRowParsingPerformedByR1185:
      output.summary.consumerAverageSubmitterSafeResponseSmokeProofRowParsingPerformedByR1185,
    consumerAverageSubmitterSafeResponseSmokeProofLiveArtifactsMutatedByR1185:
      output.summary.consumerAverageSubmitterSafeResponseSmokeProofLiveArtifactsMutatedByR1185,
    consumerAverageSubmitterMissingSlotCount: output.summary.consumerAverageSubmitterMissingSlotCount,
    consumerAverageSubmitterMissingSlotTypes: output.summary.consumerAverageSubmitterMissingSlotTypes,
    consumerAverageSubmitterNextAction: output.summary.consumerAverageSubmitterNextAction,
    consumerAverageSubmitterReadinessArtifact: output.summary.consumerAverageSubmitterReadinessArtifact,
    consumerAverageSubmitterReadinessConclusion: output.summary.consumerAverageSubmitterReadinessConclusion,
    consumerAverageSubmitterReadyForPrivateRunner: output.summary.consumerAverageSubmitterReadyForPrivateRunner,
    consumerAverageSubmitterRealAggregateStillMissing:
      output.summary.consumerAverageSubmitterRealAggregateStillMissing,
    consumerAverageSubmitterSourceFamilyMissingSlotRollup:
      output.summary.consumerAverageSubmitterSourceFamilyMissingSlotRollup,
    consumerFirstPassAggregateMetricsTemplateArtifact: output.summary.consumerFirstPassAggregateMetricsTemplateArtifact,
    consumerOrdinarySubmissionHandoffPlanArtifact: output.summary.consumerOrdinarySubmissionHandoffPlanArtifact,
    consumerOrdinarySourceFamilyIds: output.summary.consumerOrdinarySourceFamilyIds,
    consumerOrdinaryTableLayouts: output.summary.consumerOrdinaryTableLayouts,
    consumerPipelineSmokeConclusion: output.summary.consumerPipelineSmokeConclusion,
    consumerPipelineSmokeSyntheticEvidence: output.summary.consumerPipelineSmokeSyntheticEvidence,
    consumerPipelineSmokeTableLayouts: output.summary.consumerPipelineSmokeTableLayouts,
    consumerPrivateRunnerNextAction: output.summary.consumerPrivateRunnerNextAction,
    consumerRealEvidenceGateBlockers: output.summary.consumerRealEvidenceGateBlockers,
    consumerRealEvidenceGateConclusion: output.summary.consumerRealEvidenceGateConclusion,
    consumerRealEvidenceGateNextAction: output.summary.consumerRealEvidenceGateNextAction,
    consumerRealEvidenceHandoffArtifact: output.summary.consumerRealEvidenceHandoffArtifact,
    consumerRealEvidenceHandoffBlockers: output.summary.consumerRealEvidenceHandoffBlockers,
    consumerRealEvidenceHandoffMissingConfigChecklistCount:
      output.summary.consumerRealEvidenceHandoffMissingConfigChecklistCount,
    consumerRealEvidenceHandoffMissingConfigChecklistSlotTypes:
      output.summary.consumerRealEvidenceHandoffMissingConfigChecklistSlotTypes,
    consumerRealEvidenceHandoffConclusion: output.summary.consumerRealEvidenceHandoffConclusion,
    consumerRealEvidenceHandoffMissingConfigPieces:
      output.summary.consumerRealEvidenceHandoffMissingConfigPieces,
    consumerRealEvidenceHandoffNextAction: output.summary.consumerRealEvidenceHandoffNextAction,
    consumerRealEvidenceHandoffPrivateConfigReadiness:
      output.summary.consumerRealEvidenceHandoffPrivateConfigReadiness,
    consumerRealEvidenceHandoffRowOwnerWorkType: output.summary.consumerRealEvidenceHandoffRowOwnerWorkType,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    routerConclusion: output.summary.routerConclusion,
    routerNextAction: output.summary.routerNextAction,
    rowParsingPerformedByR1076: output.summary.rowParsingPerformedByR1076,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

function parseScanRoots(value: string | undefined): string[] {
  return String(value ?? "")
    .split(path.delimiter)
    .map((root) => root.trim())
    .filter(Boolean);
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function validateOptionalInputBoundary(name: string, value: unknown | null): void {
  if (!value) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1076 input ${name} failed aggregate-egress validation: ${findings.join("; ")}`);
  }
}

function r1128MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1128_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1128_EXPECTED.schemaVersion;
}

function r1129MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1129_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1129_EXPECTED.schemaVersion;
}

function r1130MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1130_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1130_EXPECTED.schemaVersion;
}

function r1132MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1132_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1132_EXPECTED.schemaVersion;
}

function r1133MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1133_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1133_EXPECTED.schemaVersion;
}

function r1134MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1134_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1134_EXPECTED.schemaVersion;
}

function r1135MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1135_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1135_EXPECTED.schemaVersion;
}

function r1136MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1136_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1136_EXPECTED.schemaVersion;
}

function r1137MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1137_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1137_EXPECTED.schemaVersion;
}

function r1138MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1138_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1138_EXPECTED.schemaVersion;
}

function r1139MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1139_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1139_EXPECTED.schemaVersion;
}

function r1140MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1140_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1140_EXPECTED.schemaVersion;
}

function r1141MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1141_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1141_EXPECTED.schemaVersion;
}

function r1142MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1142_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1142_EXPECTED.schemaVersion;
}

function r1145MatchesExpected(value: unknown | null): boolean {
  const missingRequirementIds = readStringArrayAt(value, ["completionAudit", "missingRequirementIds"]);
  const blockers = readStringArrayAt(value, ["completionAudit", "blockers"]);
  const unblockerStepIds = readStringArrayAt(value, ["summary", "completionUnblockerStepIds"]);
  const unblockerBlockedStepIds = readStringArrayAt(value, ["summary", "completionUnblockerBlockedStepIds"]);
  const topRequiredInputKindIds = readStringArrayAt(value, ["summary", "completionUnblockerTopRequiredInputKindIds"]);
  const topSafeChecklistItemIds = readStringArrayAt(value, ["summary", "completionUnblockerTopSafeCompletionChecklistItemIds"]);
  const topAllowedValueKindIds = readStringArrayAt(value, ["summary", "completionUnblockerTopAllowedValueKindIds"]);
  return readStringAt(value, ["packetId"]) === R1145_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1145_EXPECTED.schemaVersion
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(value, ["artifactBoundary", "localPathsStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "participantIdentifiersStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "participantIdentifiersWritten"]) === false
    && readBooleanAt(value, ["artifactBoundary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowParsingPerformedByR1145"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowValuesStored"]) === false
    && readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(value, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["summary", "rowParsingPerformedByR1145"]) === false
    && readBooleanAt(value, ["productDisplayAuthorized"]) === false
    && exactStringSet(unblockerStepIds, [
      "confirm_feature_only_lab_wearable_safe_availability",
      "confirm_lab_wearable_recipe_route_requirements",
      "provide_lab_wearable_private_route_config",
      "run_real_lab_wearable_route_metrics",
    ])
    && unblockerBlockedStepIds.every((stepId) => unblockerStepIds.includes(stepId))
    && exactStringSet(topRequiredInputKindIds, [
      "lab_portal_export_or_spreadsheet",
      "phone_watch_or_wearable_activity_export",
    ])
    && exactStringSet(topSafeChecklistItemIds, [
      "confirm_target_age_band_without_identifiers",
      "confirm_glycemia_bloodwork_export_available",
      "confirm_daily_wearable_activity_export_available",
      "confirm_no_private_values_in_confirmation",
    ])
    && exactStringSet(topAllowedValueKindIds, ["booleans_only", "fixed_enumerated_ids_only"])
    && missingRequirementIds.every((requirementId) => requirementId.length > 0)
    && blockers.every((blocker) => blocker.length > 0);
}

function r1146MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1146_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1146_EXPECTED.schemaVersion;
}

function r1147MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1147_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1147_EXPECTED.schemaVersion;
}

function r1148MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1148_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1148_EXPECTED.schemaVersion;
}

function r1149MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1149_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1149_EXPECTED.schemaVersion;
}

function r1150MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1150_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1150_EXPECTED.schemaVersion;
}

function r1151MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1151_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1151_EXPECTED.schemaVersion;
}

function r1152MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1152_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1152_EXPECTED.schemaVersion;
}

function r1153MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1153_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1153_EXPECTED.schemaVersion;
}

function r1154MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1154_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1154_EXPECTED.schemaVersion;
}

function r1155MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1155_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1155_EXPECTED.schemaVersion;
}

function r1156MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1156_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1156_EXPECTED.schemaVersion;
}

function r1157MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1157_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1157_EXPECTED.schemaVersion;
}

function r1158MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1158_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1158_EXPECTED.schemaVersion;
}

function r1159MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1159_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1159_EXPECTED.schemaVersion;
}

function r1160MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1160_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1160_EXPECTED.schemaVersion;
}

function r1161MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1161_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1161_EXPECTED.schemaVersion;
}

function r1162MatchesExpected(value: unknown | null): boolean {
  const conclusion = readStringAt(value, ["summary", "conclusion"]);
  const nextAction = readStringAt(value, ["summary", "nextAction"]);
  return readStringAt(value, ["packetId"]) === R1162_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1162_EXPECTED.schemaVersion
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(value, ["artifactBoundary", "confirmationValuesStoredByR1162"]) === false
    && readBooleanAt(value, ["artifactBoundary", "fileNamesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "headerValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "localPathsStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowLevelDataAcceptedByR1162"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerAssertionInferredByR1162"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowParsingPerformedByR1162"]) === false
    && readBooleanAt(value, ["artifactBoundary", "sourceFileNamesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "sourceVariableNamesStored"]) === false
    && readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(value, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
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
    && readStringAt(value, ["summary", "handoffCommand"]) === R1162_ASSERTION_HANDOFF_COMMAND
    && readStringAt(value, ["summary", "materializerCommand"]) === R1161_MATERIALIZER_COMMAND
    && exactStringSet(readStringArrayAt(value, ["summary", "minimumFeaturePairRequired"]), FEATURE_ONLY_SOURCE_FAMILY_IDS)
    && exactStringSet(
      readStringArrayAt(value, ["summary", "optionalAddOnFamilyIds"]),
      FEATURE_ONLY_OPTIONAL_ADD_ON_FAMILY_IDS,
    )
    && exactStringSet(readStringArrayAt(value, ["summary", "requiredInputKindIds"]), [
      "lab_portal_export_or_spreadsheet",
      "phone_watch_or_wearable_activity_export",
    ])
    && exactStringSet(readStringArrayAt(value, ["summary", "requiredChecklistIds"]), [
      "confirm_target_age_band_without_identifiers",
      "confirm_glycemia_bloodwork_export_available",
      "confirm_daily_wearable_activity_export_available",
      "confirm_no_private_values_in_confirmation",
    ])
    && readBooleanAt(value, ["summary", "confirmationValuesStoredByR1162"]) === false
    && readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1162"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerAssertionInferredByR1162"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["summary", "rowParsingPerformedByR1162"]) === false
    && readBooleanAt(value, ["productDisplayAuthorized"]) === false;
}

function r1163MatchesExpected(value: unknown | null): boolean {
  const conclusion = readStringAt(value, ["summary", "conclusion"]);
  const nextAction = readStringAt(value, ["summary", "nextAction"]);
  return readStringAt(value, ["packetId"]) === R1163_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1163_EXPECTED.schemaVersion
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(value, ["artifactBoundary", "childOutputPathsStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "confirmationArtifactLocalPathStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "confirmationValuesStoredByR1163"]) === false
    && readBooleanAt(value, ["artifactBoundary", "fileNamesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "headerValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "localPathsStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowLevelDataAcceptedByR1163"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerAssertionInferredByR1163"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowParsingPerformedByR1163"]) === false
    && readBooleanAt(value, ["artifactBoundary", "sourceFileNamesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "sourceVariableNamesStored"]) === false
    && readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(value, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && (
      conclusion === "feature_only_safe_confirmation_to_research_runner_ready_research_only"
      || conclusion === "feature_only_safe_confirmation_to_research_runner_waiting_on_feature_only_chain"
      || conclusion === "feature_only_safe_confirmation_to_research_runner_waiting_on_prerequisite"
      || conclusion === "feature_only_safe_confirmation_to_research_runner_waiting_on_row_owner_assertion"
    )
    && (
      nextAction === "complete_safe_availability_confirmation_template"
      || nextAction === "fill_feature_only_coverage_context_template"
      || nextAction === "fill_safe_availability_confirmation_from_template"
      || nextAction === "refresh_r1149_submitter_kit"
      || nextAction === "refresh_r1150_safe_availability_confirmation_template"
      || nextAction === "refresh_r1160_transcription_proof"
      || nextAction === "rerun_r1161_with_row_owner_feature_only_confirmation_assertion"
      || nextAction === "row_owner_assert_feature_only_lab_wearable_availability_then_run_r1163_runner"
      || nextAction === "run_r1144_recipe_readiness_chain_with_confirmed_availability"
      || nextAction === "run_r1150_intake_with_r1161_confirmed_feature_only_safe_availability_confirmation"
      || nextAction === "use_feature_only_coverage_context_for_research_planning_only"
    )
    && readStringAt(value, ["runner", "runnerCommand"]) === R1163_ASSERTION_TO_RESEARCH_RUNNER_COMMAND
    && exactStringSet(readStringArrayAt(value, ["summary", "minimumFeaturePairRequired"]), FEATURE_ONLY_SOURCE_FAMILY_IDS)
    && exactStringSet(readStringArrayAt(value, ["summary", "requiredInputKindIds"]), [
      "lab_portal_export_or_spreadsheet",
      "phone_watch_or_wearable_activity_export",
    ])
    && exactStringSet(readStringArrayAt(value, ["summary", "requiredChecklistIds"]), [
      "confirm_target_age_band_without_identifiers",
      "confirm_glycemia_bloodwork_export_available",
      "confirm_daily_wearable_activity_export_available",
      "confirm_no_private_values_in_confirmation",
    ])
    && readBooleanAt(value, ["summary", "featureOnlyChainRan"]) !== null
    && readBooleanAt(value, ["summary", "featureOnlyResearchPlanningReady"]) !== null
    && readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1163"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerAssertionInferredByR1163"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["summary", "rowParsingPerformedByR1163"]) === false
    && readBooleanAt(value, ["productDisplayAuthorized"]) === false;
}

function r1164MatchesExpected(value: unknown | null): boolean {
  const conclusion = readStringAt(value, ["summary", "conclusion"]);
  const nextAction = readStringAt(value, ["summary", "nextAction"]);
  return readStringAt(value, ["packetId"]) === R1164_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1164_EXPECTED.schemaVersion
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(value, ["artifactBoundary", "childOutputPathsStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "fileNamesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "headerValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "localPathsStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "modelEvidencePromotedByR1164"]) === false
    && readBooleanAt(value, ["artifactBoundary", "r1163InputPathStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowLevelDataAcceptedByR1164"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowParsingPerformedByR1164"]) === false
    && readBooleanAt(value, ["featureOnlyResearchHandoff", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["featureOnlyResearchHandoff", "outcomeLinkedModelEvidenceStillRequired"]) === true
    && readBooleanAt(value, ["featureOnlyResearchHandoff", "privateDetailsStored"]) === false
    && readBooleanAt(value, ["featureOnlyResearchHandoff", "rowLevelDataAcceptedByR1164"]) === false
    && readBooleanAt(value, ["featureOnlyResearchHandoff", "rowOwnerPrivateValuesStored"]) === false
    && readStringAt(value, ["featureOnlyResearchHandoff", "commands", "featureOnlyResearchHandoffCommand"])
      === R1164_FEATURE_ONLY_RESEARCH_HANDOFF_COMMAND
    && readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(value, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && (
      conclusion === "ordinary_feature_only_research_handoff_invalid_r1163_state"
      || conclusion === "ordinary_feature_only_research_handoff_ready_research_only"
      || conclusion === "ordinary_feature_only_research_handoff_waiting_on_feature_only_chain"
      || conclusion === "ordinary_feature_only_research_handoff_waiting_on_r1163"
      || conclusion === "ordinary_feature_only_research_handoff_waiting_on_row_owner_assertion"
    )
    && (
      nextAction === "complete_r1163_feature_only_availability_assertion_contract"
      || nextAction === "refresh_r1163_feature_only_safe_confirmation_to_research_runner"
      || nextAction === "rerun_r1163_feature_only_safe_confirmation_to_research_runner"
      || nextAction === "use_feature_only_coverage_context_for_research_planning_only"
    )
    && exactStringSet(readStringArrayAt(value, ["summary", "minimumFeaturePairRequired"]), FEATURE_ONLY_SOURCE_FAMILY_IDS)
    && exactStringSet(readStringArrayAt(value, ["summary", "prioritizedInputKindIds"]), [
      "lab_portal_export_or_spreadsheet",
      "phone_watch_or_wearable_activity_export",
    ])
    && readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1164"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["summary", "rowParsingPerformedByR1164"]) === false
    && readBooleanAt(value, ["productDisplayAuthorized"]) === false;
}

function r1165MatchesExpected(value: unknown | null): boolean {
  const conclusion = readStringAt(value, ["summary", "conclusion"]);
  const nextAction = readStringAt(value, ["summary", "nextAction"]);
  return readStringAt(value, ["packetId"]) === R1165_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1165_EXPECTED.schemaVersion
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(value, ["artifactBoundary", "assertionFilePathStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "assertionValuesStoredByR1165"]) === false
    && readBooleanAt(value, ["artifactBoundary", "childOutputPathsStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "fileNamesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "headerValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "localPathsStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "modelEvidencePromotedByR1165"]) === false
    && readBooleanAt(value, ["artifactBoundary", "privateDetailsStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowLevelDataAcceptedByR1165"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerAssertionInferredByR1165"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowParsingPerformedByR1165"]) === false
    && readBooleanAt(value, ["assertionRunner", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["assertionRunner", "privateDetailsStored"]) === false
    && readBooleanAt(value, ["assertionRunner", "rowLevelDataAcceptedByR1165"]) === false
    && readBooleanAt(value, ["assertionRunner", "rowOwnerAssertionInferredByR1165"]) === false
    && readBooleanAt(value, ["assertionRunner", "rowOwnerPrivateValuesStored"]) === false
    && readStringAt(value, ["assertionRunner", "commands", "safeAssertionRunnerCommand"])
      === R1165_SAFE_ASSERTION_RUNNER_COMMAND
    && readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(value, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && (
      conclusion === "ordinary_feature_only_safe_assertion_runner_invalid_assertion"
      || conclusion === "ordinary_feature_only_safe_assertion_runner_ready_research_only"
      || conclusion === "ordinary_feature_only_safe_assertion_runner_waiting_on_assertion_file"
      || conclusion === "ordinary_feature_only_safe_assertion_runner_waiting_on_r1163_chain"
    )
    && (
      nextAction === "fill_r1165_row_owner_feature_only_safe_assertion_template"
      || nextAction === "refresh_r1160_transcription_proof"
      || nextAction === "rerun_r1165_with_valid_safe_assertion"
      || nextAction === "row_owner_assert_feature_only_lab_wearable_availability_then_run_r1163_runner"
      || nextAction === "run_r1164_feature_only_research_handoff"
      || nextAction === "use_feature_only_coverage_context_for_research_planning_only"
    )
    && exactStringSet(readStringArrayAt(value, ["summary", "minimumFeaturePairRequired"]), FEATURE_ONLY_SOURCE_FAMILY_IDS)
    && exactStringSet(
      readStringArrayAt(value, ["summary", "optionalAddOnFamilyIds"]),
      FEATURE_ONLY_OPTIONAL_ADD_ON_FAMILY_IDS,
    )
    && exactStringSet(readStringArrayAt(value, ["summary", "requiredInputKindIds"]), [
      "lab_portal_export_or_spreadsheet",
      "phone_watch_or_wearable_activity_export",
    ])
    && readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["summary", "outcomeLinkedModelEvidenceStillRequired"]) === true
    && readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1165"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerAssertionInferredByR1165"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["summary", "rowParsingPerformedByR1165"]) === false
    && readBooleanAt(value, ["productDisplayAuthorized"]) === false;
}

function r1167MatchesExpected(value: unknown | null): boolean {
  const conclusion = readStringAt(value, ["summary", "conclusion"]);
  const nextAction = readStringAt(value, ["summary", "nextAction"]);
  return readStringAt(value, ["packetId"]) === R1167_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1167_EXPECTED.schemaVersion
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(value, ["artifactBoundary", "assertionValuesStoredByR1167"]) === false
    && readBooleanAt(value, ["artifactBoundary", "fileNamesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "headerValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "localPathsStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "modelEvidencePromotedByR1167"]) === false
    && readBooleanAt(value, ["artifactBoundary", "privateDetailsStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowLevelDataAcceptedByR1167"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerAssertionInferredByR1167"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowParsingPerformedByR1167"]) === false
    && readStringAt(value, ["fillGuide", "commands", "fillGuideCommand"]) === R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND
    && readStringAt(value, ["fillGuide", "commands", "safeAssertionRunnerCommand"])
      === R1165_SAFE_ASSERTION_RUNNER_COMMAND
    && readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(value, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && (
      conclusion === "ordinary_feature_only_safe_assertion_fill_guide_ready"
      || conclusion === "ordinary_feature_only_safe_assertion_fill_guide_waiting_on_r1165_runner"
      || conclusion === "ordinary_feature_only_safe_assertion_fill_guide_waiting_on_r1165_template"
    )
    && (
      nextAction === "fill_r1165_row_owner_feature_only_safe_assertion_template"
      || nextAction === "refresh_r1165_safe_assertion_runner"
    )
    && exactStringSet(readStringArrayAt(value, ["summary", "minimumFeaturePairRequired"]), FEATURE_ONLY_SOURCE_FAMILY_IDS)
    && exactStringSet(
      readStringArrayAt(value, ["summary", "optionalAddOnFamilyIds"]),
      FEATURE_ONLY_OPTIONAL_ADD_ON_FAMILY_IDS,
    )
    && exactStringSet(readStringArrayAt(value, ["summary", "requiredInputKindIds"]), [
      "lab_portal_export_or_spreadsheet",
      "phone_watch_or_wearable_activity_export",
    ])
    && readNumberAt(value, ["summary", "safeFieldEditCount"]) === FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS.length
    && exactStringSet(
      readStringArrayAt(value, ["summary", "safeFieldEditPaths"]),
      FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS,
    )
    && readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1167"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerAssertionInferredByR1167"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["summary", "rowParsingPerformedByR1167"]) === false
    && readBooleanAt(value, ["productDisplayAuthorized"]) === false;
}

function r1172MatchesExpected(value: unknown | null): boolean {
  const conclusion = readStringAt(value, ["summary", "conclusion"]);
  const nextAction = readStringAt(value, ["summary", "nextAction"]);
  const safeFieldEditCount = readNumberAt(value, ["summary", "safeFieldEditCount"]);
  return readStringAt(value, ["packetId"]) === R1172_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1172_EXPECTED.schemaVersion
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(value, ["artifactBoundary", "assertionArtifactLocalPathStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "assertionFileWrittenOnlyAfterExplicitAssertion"]) === true
    && readBooleanAt(value, ["artifactBoundary", "assertionValuesStoredInR1172Packet"]) === false
    && readBooleanAt(value, ["artifactBoundary", "childOutputPathsStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "fileNamesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "headerValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "localPathsStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "modelEvidencePromotedByR1172"]) === false
    && readBooleanAt(value, ["artifactBoundary", "privateDetailsStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowLevelDataAcceptedByR1172"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerAssertionInferredByR1172"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowParsingPerformedByR1172"]) === false
    && readStringAt(value, ["materializer", "materializerCommand"]) === R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND
    && readStringAt(value, ["materializer", "r1165RunnerCommand"]) === R1165_SAFE_ASSERTION_RUNNER_COMMAND
    && readStringAt(value, ["materializer", "r1167FillGuideCommand"]) === R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND
    && exactStringSet(
      readStringArrayAt(value, ["materializer", "allowedValueKindIds"]),
      FEATURE_ONLY_SAFE_ASSERTION_ALLOWED_VALUE_KIND_IDS,
    )
    && exactStringSet(
      readStringArrayAt(value, ["materializer", "blockedContentIds"]),
      FEATURE_ONLY_SAFE_ASSERTION_BLOCKED_CONTENT_IDS,
    )
    && readBooleanAt(value, ["materializer", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["materializer", "privateDetailsStored"]) === false
    && readBooleanAt(value, ["materializer", "rowLevelDataAcceptedByR1172"]) === false
    && readBooleanAt(value, ["materializer", "rowOwnerPrivateValuesStored"]) === false
    && readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(value, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
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
    && exactStringSet(readStringArrayAt(value, ["summary", "minimumFeaturePairRequired"]), FEATURE_ONLY_SOURCE_FAMILY_IDS)
    && exactStringSet(
      readStringArrayAt(value, ["summary", "allowedValueKindIds"]),
      FEATURE_ONLY_SAFE_ASSERTION_ALLOWED_VALUE_KIND_IDS,
    )
    && exactStringSet(
      readStringArrayAt(value, ["summary", "blockedContentIds"]),
      FEATURE_ONLY_SAFE_ASSERTION_BLOCKED_CONTENT_IDS,
    )
    && exactStringSet(readStringArrayAt(value, ["summary", "requiredInputKindIds"]), [
      "lab_portal_export_or_spreadsheet",
      "phone_watch_or_wearable_activity_export",
    ])
    && (safeFieldEditCount === 0 || safeFieldEditCount === FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS.length)
    && exactStringSet(
      readStringArrayAt(value, ["summary", "safeFieldEditPaths"]),
      FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS,
    )
    && readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1172"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerAssertionInferredByR1172"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["summary", "rowParsingPerformedByR1172"]) === false
    && readBooleanAt(value, ["summary", "safeAssertionArtifactLocalPathStored"]) === false
    && readBooleanAt(value, ["productDisplayAuthorized"]) === false;
}

function r1173MatchesExpected(value: unknown | null): boolean {
  const conclusion = readStringAt(value, ["summary", "conclusion"]);
  const nextAction = readStringAt(value, ["summary", "nextAction"]);
  return readStringAt(value, ["packetId"]) === R1173_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1173_EXPECTED.schemaVersion
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(value, ["artifactBoundary", "answerSheetTemplatePathStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "assertionValuesStoredByR1173"]) === false
    && readBooleanAt(value, ["artifactBoundary", "fileNamesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "headerValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "localPathsStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "modelEvidencePromotedByR1173"]) === false
    && readBooleanAt(value, ["artifactBoundary", "privateDetailsStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowLevelDataAcceptedByR1173"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerAssertionInferredByR1173"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerProvidedValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowParsingPerformedByR1173"]) === false
    && readStringAt(value, ["rowOwnerAnswerSheet", "commands", "safeAssertionAnswerSheetCommand"])
      === R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND
    && readStringAt(value, ["rowOwnerAnswerSheet", "commands", "safeAssertionFillGuideCommand"])
      === R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND
    && readStringAt(value, ["rowOwnerAnswerSheet", "commands", "safeAssertionMaterializerCommand"])
      === R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND
    && exactStringSet(
      readStringArrayAt(value, ["rowOwnerAnswerSheet", "allowedValueKindIds"]),
      FEATURE_ONLY_SAFE_ASSERTION_ALLOWED_VALUE_KIND_IDS,
    )
    && exactStringSet(
      readStringArrayAt(value, ["rowOwnerAnswerSheet", "blockedAssertionContent"]),
      FEATURE_ONLY_SAFE_ASSERTION_BLOCKED_CONTENT_IDS,
    )
    && readBooleanAt(value, ["rowOwnerAnswerSheet", "materializerExplicitConfirmationRequired"]) === true
    && readBooleanAt(value, ["rowOwnerAnswerSheet", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["rowOwnerAnswerSheet", "privateDetailsStored"]) === false
    && readBooleanAt(value, ["rowOwnerAnswerSheet", "rowLevelDataAcceptedByR1173"]) === false
    && readBooleanAt(value, ["rowOwnerAnswerSheet", "rowOwnerProvidedValuesStored"]) === false
    && readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(value, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && (
      conclusion === "ordinary_safe_assertion_answer_sheet_ready_non_evidence"
      || conclusion === "ordinary_safe_assertion_answer_sheet_waiting_on_r1167_fill_guide"
      || conclusion === "ordinary_safe_assertion_answer_sheet_waiting_on_r1172_materializer"
    )
    && (
      nextAction === "refresh_r1167_safe_assertion_fill_guide"
      || nextAction === "refresh_r1172_safe_assertion_materializer"
      || nextAction === "rerun_r1172_with_row_owner_feature_only_safe_assertion_confirmation"
    )
    && exactStringSet(readStringArrayAt(value, ["summary", "minimumFeaturePairRequired"]), FEATURE_ONLY_SOURCE_FAMILY_IDS)
    && exactStringSet(
      readStringArrayAt(value, ["summary", "allowedValueKindIds"]),
      FEATURE_ONLY_SAFE_ASSERTION_ALLOWED_VALUE_KIND_IDS,
    )
    && exactStringSet(
      readStringArrayAt(value, ["summary", "blockedAssertionContentIds"]),
      FEATURE_ONLY_SAFE_ASSERTION_BLOCKED_CONTENT_IDS,
    )
    && exactStringSet(readStringArrayAt(value, ["summary", "requiredInputKindIds"]), [
      "lab_portal_export_or_spreadsheet",
      "phone_watch_or_wearable_activity_export",
    ])
    && exactStringSet(
      readStringArrayAt(value, ["summary", "safeFieldEditPaths"]),
      FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS,
    )
    && readBooleanAt(value, ["summary", "materializerExplicitConfirmationRequired"]) === true
    && readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1173"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerAssertionInferredByR1173"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerProvidedValuesStored"]) === false
    && readBooleanAt(value, ["summary", "rowParsingPerformedByR1173"]) === false
    && readBooleanAt(value, ["productDisplayAuthorized"]) === false;
}

function r1174MatchesExpected(value: unknown | null): boolean {
  const conclusion = readStringAt(value, ["summary", "conclusion"]);
  const nextAction = readStringAt(value, ["summary", "nextAction"]);
  const exposesR1176LiveChain =
    nextAction === "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation";
  return readStringAt(value, ["packetId"]) === R1174_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1174_EXPECTED.schemaVersion
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(value, ["artifactBoundary", "fileNamesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "headerValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "localPathsStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "modelEvidencePromotedByR1174"]) === false
    && readBooleanAt(value, ["artifactBoundary", "privateDetailsStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowLevelDataAcceptedByR1174"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerConfirmationInferredByR1174"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerProvidedValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowParsingPerformedByR1174"]) === false
    && readStringAt(value, ["rowOwnerNextStepPacket", "packetRole"])
      === "current_blocker_packet_only_not_assertion_not_model_evidence"
    && exactStringSet(
      readStringArrayAt(value, ["rowOwnerNextStepPacket", "allowedValueKindIds"]),
      FEATURE_ONLY_SAFE_ASSERTION_ALLOWED_VALUE_KIND_IDS,
    )
    && exactStringSet(
      readStringArrayAt(value, ["rowOwnerNextStepPacket", "blockedContent"]),
      FEATURE_ONLY_SAFE_ASSERTION_BLOCKED_CONTENT_IDS,
    )
    && readBooleanAt(value, ["rowOwnerNextStepPacket", "rowLevelDataAcceptedByR1174"]) === false
    && readBooleanAt(value, ["rowOwnerNextStepPacket", "rowOwnerProvidedValuesStored"]) === false
    && readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(value, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
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
    && exactStringSet(readStringArrayAt(value, ["summary", "minimumFeaturePairRequired"]), FEATURE_ONLY_SOURCE_FAMILY_IDS)
    && exactStringSet(readStringArrayAt(value, ["summary", "requiredInputKindIds"]), [
      "lab_portal_export_or_spreadsheet",
      "phone_watch_or_wearable_activity_export",
    ])
    && exactStringSet(
      readStringArrayAt(value, ["summary", "allowedValueKindIds"]),
      FEATURE_ONLY_SAFE_ASSERTION_ALLOWED_VALUE_KIND_IDS,
    )
    && exactStringSet(
      readStringArrayAt(value, ["summary", "blockedContentIds"]),
      FEATURE_ONLY_SAFE_ASSERTION_BLOCKED_CONTENT_IDS,
    )
    && exactStringSet(
      readStringArrayAt(value, ["summary", "safeFieldEditPaths"]),
      FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS,
    )
    && readNumberAt(value, ["summary", "exactSafeFieldEditCount"])
      === FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS.length
    && readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]) === false
    && (
      !exposesR1176LiveChain
      || (
        readBooleanAt(value, ["summary", "readyForRowOwnerR1176LiveChainConfirmation"]) === true
        && readStringAt(value, ["summary", "r1176LiveChainCommand"])
          === R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND
      )
    )
    && readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1174"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerConfirmationInferredByR1174"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerProvidedValuesStored"]) === false
    && readBooleanAt(value, ["summary", "rowParsingPerformedByR1174"]) === false
    && readBooleanAt(value, ["productDisplayAuthorized"]) === false;
}

function r1170MatchesExpected(value: unknown | null): boolean {
  const conclusion = readStringAt(value, ["summary", "conclusion"]);
  const nextAction = readStringAt(value, ["summary", "nextAction"]);
  return readStringAt(value, ["packetId"]) === R1170_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1170_EXPECTED.schemaVersion
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(value, ["artifactBoundary", "assertionFilePathStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "assertionValuesStoredByR1170"]) === false
    && readBooleanAt(value, ["artifactBoundary", "childOutputPathsStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "fileNamesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "headerValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "localPathsStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "modelEvidencePromotedByR1170"]) === false
    && readBooleanAt(value, ["artifactBoundary", "privateDetailsStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowLevelDataAcceptedByR1170"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerAssertionInferredByR1170"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowParsingPerformedByR1170"]) === false
    && readBooleanAt(value, ["artifactBoundary", "scratchArtifactsPersisted"]) === false
    && readBooleanAt(value, ["artifactBoundary", "syntheticAssertionPersistedInArtifact"]) === false
    && readStringAt(value, ["safeAssertionSmokeProof", "commands", "smokeProofCommand"])
      === R1170_SAFE_ASSERTION_SMOKE_PROOF_COMMAND
    && readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(value, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && (
      conclusion === "ordinary_safe_assertion_smoke_failed_non_evidence"
      || conclusion === "ordinary_safe_assertion_smoke_passed_non_evidence"
    )
    && (
      nextAction === "inspect_r1170_safe_assertion_smoke_outputs"
      || nextAction === "keep_live_chain_waiting_on_real_r1165_row_owner_safe_assertion"
    )
    && exactStringSet(readStringArrayAt(value, ["summary", "minimumFeaturePairRequired"]), FEATURE_ONLY_SOURCE_FAMILY_IDS)
    && exactStringSet(readStringArrayAt(value, ["summary", "requiredInputKindIds"]), [
      "lab_portal_export_or_spreadsheet",
      "phone_watch_or_wearable_activity_export",
    ])
    && readNumberAt(value, ["summary", "safeFieldEditCount"]) === FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS.length
    && exactStringSet(
      readStringArrayAt(value, ["summary", "safeFieldEditPaths"]),
      FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS,
    )
    && readBooleanAt(value, ["summary", "liveChainGateStillRequired"]) === true
    && readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["summary", "realEvidenceProduced"]) === false
    && readBooleanAt(value, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1170"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerAssertionStillRequiredForLiveChain"]) === true
    && readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["summary", "rowParsingPerformedByR1170"]) === false
    && readBooleanAt(value, ["summary", "smokeEvidence"]) === false
    && readBooleanAt(value, ["summary", "syntheticSmokeProof"]) === true
    && readBooleanAt(value, ["productDisplayAuthorized"]) === false;
}

function r1175MatchesExpected(value: unknown | null): boolean {
  const conclusion = readStringAt(value, ["summary", "conclusion"]);
  const nextAction = readStringAt(value, ["summary", "nextAction"]);
  return readStringAt(value, ["packetId"]) === R1175_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1175_EXPECTED.schemaVersion
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(value, ["artifactBoundary", "assertionFilePathStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "assertionValuesStoredByR1175"]) === false
    && readBooleanAt(value, ["artifactBoundary", "childOutputPathsStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "localPathsStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "materializedAssertionPathStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "modelEvidencePromotedByR1175"]) === false
    && readBooleanAt(value, ["artifactBoundary", "privateDetailsStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowLevelDataAcceptedByR1175"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerAssertionInferredByR1175"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowParsingPerformedByR1175"]) === false
    && readBooleanAt(value, ["artifactBoundary", "scratchArtifactsPersisted"]) === false
    && readBooleanAt(value, ["artifactBoundary", "syntheticConfirmationValuesPersistedInArtifact"]) === false
    && readStringAt(value, ["bridgeSmoke", "bridgeSmokeCommand"])
      === R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_COMMAND
    && readStringAt(value, ["bridgeSmoke", "r1172MaterializerCommand"]) === R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND
    && readStringAt(value, ["bridgeSmoke", "r1165RunnerCommand"]) === R1165_SAFE_ASSERTION_RUNNER_COMMAND
    && exactStringSet(
      readStringArrayAt(value, ["bridgeSmoke", "allowedValueKindIds"]),
      FEATURE_ONLY_SAFE_ASSERTION_ALLOWED_VALUE_KIND_IDS,
    )
    && exactStringSet(
      readStringArrayAt(value, ["bridgeSmoke", "blockedContentIds"]),
      FEATURE_ONLY_SAFE_ASSERTION_BLOCKED_CONTENT_IDS,
    )
    && readBooleanAt(value, ["bridgeSmoke", "realEvidenceProduced"]) === false
    && readBooleanAt(value, ["bridgeSmoke", "syntheticSmokeProof"]) === true
    && readBooleanAt(value, ["bridgeSmoke", "rowLevelDataAcceptedByR1175"]) === false
    && readBooleanAt(value, ["bridgeSmoke", "rowOwnerPrivateValuesStored"]) === false
    && readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(value, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
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
    && exactStringSet(readStringArrayAt(value, ["summary", "minimumFeaturePairRequired"]), FEATURE_ONLY_SOURCE_FAMILY_IDS)
    && exactStringSet(
      readStringArrayAt(value, ["summary", "allowedValueKindIds"]),
      FEATURE_ONLY_SAFE_ASSERTION_ALLOWED_VALUE_KIND_IDS,
    )
    && exactStringSet(
      readStringArrayAt(value, ["summary", "blockedContentIds"]),
      FEATURE_ONLY_SAFE_ASSERTION_BLOCKED_CONTENT_IDS,
    )
    && exactStringSet(readStringArrayAt(value, ["summary", "requiredInputKindIds"]), [
      "lab_portal_export_or_spreadsheet",
      "phone_watch_or_wearable_activity_export",
    ])
    && readNumberAt(value, ["summary", "safeFieldEditCount"]) === FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS.length
    && exactStringSet(
      readStringArrayAt(value, ["summary", "safeFieldEditPaths"]),
      FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS,
    )
    && readBooleanAt(value, ["summary", "liveChainGateStillRequired"]) === true
    && readBooleanAt(value, ["summary", "materializedAssertionPathStored"]) === false
    && readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["summary", "realEvidenceProduced"]) === false
    && readBooleanAt(value, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1175"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerAssertionStillRequiredForLiveChain"]) === true
    && readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["summary", "rowParsingPerformedByR1175"]) === false
    && readBooleanAt(value, ["summary", "smokeEvidence"]) === false
    && readBooleanAt(value, ["summary", "syntheticSmokeProof"]) === true
    && readBooleanAt(value, ["productDisplayAuthorized"]) === false;
}

function r1176MatchesExpected(value: unknown | null): boolean {
  const conclusion = readStringAt(value, ["summary", "conclusion"]);
  const nextAction = readStringAt(value, ["summary", "nextAction"]);
  return readStringAt(value, ["packetId"]) === R1176_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1176_EXPECTED.schemaVersion
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(value, ["artifactBoundary", "assertionFilePathStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "assertionValuesStoredByR1176"]) === false
    && readBooleanAt(value, ["artifactBoundary", "childOutputPathsStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "localPathsStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "materializedAssertionPathStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "modelEvidencePromotedByR1176"]) === false
    && readBooleanAt(value, ["artifactBoundary", "privateDetailsStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowLevelDataAcceptedByR1176"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerAssertionInferredByR1176"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowParsingPerformedByR1176"]) === false
    && readStringAt(value, ["chainRun", "chainRunnerCommand"]) === R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND
    && readStringAt(value, ["chainRun", "r1172MaterializerCommand"]) === R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND
    && readStringAt(value, ["chainRun", "r1165RunnerCommand"]) === R1165_SAFE_ASSERTION_RUNNER_COMMAND
    && readBooleanAt(value, ["chainRun", "materializedAssertionPathStored"]) === false
    && readBooleanAt(value, ["chainRun", "modelEvidencePromotionAllowed"]) === false
    && readStringAt(value, ["chainRun", "ordinarySubmitterCompletionModeId"])
      === FEATURE_ONLY_SAFE_COMPLETION_MODE_ID
    && exactStringSet(
      readStringArrayAt(value, ["chainRun", "minimumFeaturePairRequired"]),
      FEATURE_ONLY_SOURCE_FAMILY_IDS,
    )
    && exactStringSet(
      readStringArrayAt(value, ["chainRun", "optionalAddOnFamilyIds"]),
      FEATURE_ONLY_OPTIONAL_ADD_ON_FAMILY_IDS,
    )
    && exactStringSet(readStringArrayAt(value, ["chainRun", "requiredInputKindIds"]), [
      "lab_portal_export_or_spreadsheet",
      "phone_watch_or_wearable_activity_export",
    ])
    && exactStringSet(
      readStringArrayAt(value, ["chainRun", "allowedValueKindIds"]),
      FEATURE_ONLY_SAFE_ASSERTION_ALLOWED_VALUE_KIND_IDS,
    )
    && exactStringSet(
      readStringArrayAt(value, ["chainRun", "blockedContentIds"]),
      FEATURE_ONLY_SAFE_ASSERTION_BLOCKED_CONTENT_IDS,
    )
    && exactStringSet(
      readStringArrayAt(value, ["chainRun", "ordinarySubmitterSafeCompletionChecklistItemIds"]),
      FEATURE_ONLY_SAFE_COMPLETION_CHECKLIST_ITEM_IDS,
    )
    && readBooleanAt(value, ["chainRun", "outcomeLinkedModelEvidenceStillRequired"]) === true
    && readBooleanAt(value, ["chainRun", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["chainRun", "realEvidenceProduced"]) === false
    && readBooleanAt(value, ["chainRun", "reviewGptRequiredNow"]) === false
    && readBooleanAt(value, ["chainRun", "rowLevelDataAcceptedByR1176"]) === false
    && readBooleanAt(value, ["chainRun", "rowOwnerPrivateValuesStored"]) === false
    && readStringAt(value, ["chainRun", "rowOwnerHandoffReasonId"]) === R1176_ROW_OWNER_HANDOFF_REASON_ID
    && readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(value, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
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
      || nextAction === "run_r1150_intake_with_r1161_confirmed_feature_only_safe_availability_confirmation"
      || nextAction === "run_r1153_feature_only_chain_with_safe_availability"
      || nextAction === "run_r1164_feature_only_research_handoff"
      || nextAction === "run_r1165_with_r1172_row_owner_safe_assertion"
      || nextAction === "run_r1144_recipe_readiness_chain_with_confirmed_availability"
      || nextAction === "use_feature_only_coverage_context_for_research_planning_only"
    )
    && readBooleanAt(value, ["summary", "chainReady"]) !== null
    && readBooleanAt(value, ["summary", "explicitRowOwnerAssertionProvided"]) !== null
    && readBooleanAt(value, ["summary", "featureOnlyResearchPlanningReady"]) !== null
    && exactStringSet(readStringArrayAt(value, ["summary", "minimumFeaturePairRequired"]), FEATURE_ONLY_SOURCE_FAMILY_IDS)
    && exactStringSet(
      readStringArrayAt(value, ["summary", "optionalAddOnFamilyIds"]),
      FEATURE_ONLY_OPTIONAL_ADD_ON_FAMILY_IDS,
    )
    && exactStringSet(readStringArrayAt(value, ["summary", "requiredInputKindIds"]), [
      "lab_portal_export_or_spreadsheet",
      "phone_watch_or_wearable_activity_export",
    ])
    && readStringAt(value, ["summary", "ordinarySubmitterCompletionModeId"])
      === FEATURE_ONLY_SAFE_COMPLETION_MODE_ID
    && exactStringSet(
      readStringArrayAt(value, ["summary", "allowedValueKindIds"]),
      FEATURE_ONLY_SAFE_ASSERTION_ALLOWED_VALUE_KIND_IDS,
    )
    && exactStringSet(
      readStringArrayAt(value, ["summary", "blockedContentIds"]),
      FEATURE_ONLY_SAFE_ASSERTION_BLOCKED_CONTENT_IDS,
    )
    && exactStringSet(
      readStringArrayAt(value, ["summary", "ordinarySubmitterSafeCompletionChecklistItemIds"]),
      FEATURE_ONLY_SAFE_COMPLETION_CHECKLIST_ITEM_IDS,
    )
    && readNumberAt(value, ["summary", "safeFieldEditCount"]) === FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS.length
    && exactStringSet(
      readStringArrayAt(value, ["summary", "safeFieldEditPaths"]),
      FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS,
    )
    && readBooleanAt(value, ["summary", "materializedAssertionPathStored"]) === false
    && readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["summary", "outcomeLinkedModelEvidenceStillRequired"]) === true
    && readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["summary", "realEvidenceProduced"]) === false
    && readBooleanAt(value, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1176"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerAssertionStillRequiredForLiveChain"]) !== null
    && readStringAt(value, ["summary", "rowOwnerHandoffReasonId"]) === R1176_ROW_OWNER_HANDOFF_REASON_ID
    && readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["summary", "rowParsingPerformedByR1176"]) === false
    && readBooleanAt(value, ["productDisplayAuthorized"]) === false;
}

function r1185MatchesExpected(value: unknown | null): boolean {
  const conclusion = readStringAt(value, ["summary", "conclusion"]);
  const nextRealAction = readStringAt(value, ["summary", "nextRealAction"]);
  const nextRealActionCommand = readStringAt(value, ["summary", "nextRealActionCommand"]);
  const syntheticPathAdvanced = readBooleanAt(value, [
    "summary",
    "syntheticPathAdvancedToFeatureOnlyResearchPlanning",
  ]);
  const safeExecutionFeatureSlotIds = readStringArrayAt(value, [
    "smokeProof",
    "safeExecutionFeatureSlotIds",
  ]);
  const nextRealActionMatchesCommand =
    (nextRealAction === "obtain_real_row_owner_safe_confirmation_then_rerun_r1183"
      && nextRealActionCommand === R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND)
    || (nextRealAction === "refresh_r1184_safe_response_chain_status"
      && nextRealActionCommand === R1184_AVERAGE_SUBMITTER_SAFE_RESPONSE_CHAIN_STATUS_COMMAND);
  return readStringAt(value, ["packetId"]) === R1185_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1185_EXPECTED.schemaVersion
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(value, ["artifactBoundary", "confirmedResponseLocalPathStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "fillableResponseLocalPathStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "liveArtifactsMutatedByR1185"]) === false
    && readBooleanAt(value, ["artifactBoundary", "localPathsStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "modelEvidencePromotedByR1185"]) === false
    && readBooleanAt(value, ["artifactBoundary", "privateDetailsStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowLevelDataAcceptedByR1185"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerConfirmationInferredByR1185"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerSafeResponseValuesStoredInR1185Packet"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowParsingPerformedByR1185"]) === false
    && readBooleanAt(value, ["artifactBoundary", "safeBooleanValuesStoredInR1185Packet"]) === false
    && readBooleanAt(value, ["artifactBoundary", "syntheticFixtureRowsStored"]) === false
    && (
      conclusion === "average_submitter_safe_response_smoke_passed_non_evidence"
      || conclusion === "average_submitter_safe_response_smoke_waiting_on_live_r1184_row_owner_blocker"
    )
    && readBooleanAt(value, ["summary", "liveR1184ReadyForSyntheticSmoke"]) !== null
    && nextRealActionMatchesCommand
    && readBooleanAt(value, ["summary", "nextRealActionRequiresExplicitRowOwnerAssertion"]) !== null
    && readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["summary", "syntheticSmokeRan"]) !== null
    && readStringAt(value, ["smokeProof", "evidenceClass"]) === "synthetic_non_evidence_smoke_proof"
    && readBooleanAt(value, ["smokeProof", "liveArtifactsMutatedByR1185"]) === false
    && readBooleanAt(value, ["smokeProof", "liveRowOwnerConfirmationProvided"]) === false
    && exactStringSet(
      readStringArrayAt(value, ["smokeProof", "minimumFeaturePairRequired"]),
      FEATURE_ONLY_SOURCE_FAMILY_IDS,
    )
    && exactStringSet(
      readStringArrayAt(value, ["smokeProof", "prioritizedInputKindIds"]),
      ["lab_portal_export_or_spreadsheet", "phone_watch_or_wearable_activity_export"],
    )
    && exactStringSet(
      readStringArrayAt(value, ["smokeProof", "requiredResponseFieldIds"]),
      AVERAGE_SUBMITTER_SAFE_RESPONSE_FIELD_IDS,
    )
    && (syntheticPathAdvanced === true
      ? exactStringSet(safeExecutionFeatureSlotIds, AVERAGE_SUBMITTER_SAFE_EXECUTION_FEATURE_SLOT_IDS)
      : safeExecutionFeatureSlotIds.length === 0)
    && readBooleanAt(value, ["smokeProof", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["smokeProof", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["smokeProof", "reviewGptRequiredNow"]) === false
    && readBooleanAt(value, ["smokeProof", "rowLevelDataAcceptedByR1185"]) === false
    && readBooleanAt(value, ["smokeProof", "rowOwnerConfirmationInferredByR1185"]) === false
    && readBooleanAt(value, ["smokeProof", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["smokeProof", "rowOwnerSafeResponseValuesStoredInR1185Packet"]) === false
    && readBooleanAt(value, ["smokeProof", "rowParsingPerformedByR1185"]) === false
    && readStringAt(value, ["smokeProof", "sourcePriority"]) === TARGET_INPUT_PRIORITY
    && readBooleanAt(value, ["smokeProof", "syntheticSmokeRan"]) !== null
    && readStringAt(value, ["smokeProof", "targetAgeBand"]) === TARGET_AGE_BAND
    && readBooleanAt(value, ["productDisplayAuthorized"]) === false;
}

function postConfirmationPrivateConfigIntakeSafeActionGuardPresent(r1148: unknown | null): boolean {
  const packetReadyForConfigIntake = readBooleanAt(r1148, ["summary", "packetReadyForConfigIntake"]);
  const nextAction = readStringAt(r1148, ["summary", "nextAction"]);
  const safeNextAction = readStringAt(r1148, ["summary", "safeAvailabilityActionPacketNextAction"]);
  const missingFeatureOnlySourceFamilyIds = readStringArrayAt(r1148, [
    "summary",
    "safeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds",
  ]);
  const featureOnlySafeActionReady = safeNextAction === FEATURE_ONLY_SAFE_AVAILABILITY_NEXT_ACTION
    && readBooleanAt(r1148, ["summary", "safeAvailabilityActionPacketFeatureOnlyCoverageContextReady"]) === true
    && readBooleanAt(r1148, [
      "summary",
      "safeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain",
    ]) === false
    && missingFeatureOnlySourceFamilyIds.length === 0;
  return r1148MatchesExpected(r1148)
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
        && (featureOnlySafeActionReady || includesAll(missingFeatureOnlySourceFamilyIds, FEATURE_ONLY_SOURCE_FAMILY_IDS))
      )
    );
}

function includesAll(actual: readonly string[], expected: readonly string[]): boolean {
  return expected.every((item) => actual.includes(item));
}

function exactStringSet(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && includesAll(actual, expected);
}

function sourceFamilyMissingSlotRollupFor(r1132: unknown | null): SourceFamilyMissingSlotRollup[] {
  return readArrayAt(r1132, ["ordinaryConsumerReadiness", "sourceFamilies"]).flatMap((family) => {
    const familyId = readStringAt(family, ["familyId"]);
    if (!familyId) return [];
    return [{
      familyId,
      missingSlotCount: readNumberAt(family, ["missingSlotCount"]),
      missingSlotIds: readStringArrayAt(family, ["missingSlotIds"]),
      status: readStringAt(family, ["status"]),
    }];
  });
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

function readArrayAt(value: unknown | null, pathParts: readonly string[]): unknown[] {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved) ? resolved : [];
}

function readAt(value: unknown | null, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1076 current autoresearch loop executor failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
