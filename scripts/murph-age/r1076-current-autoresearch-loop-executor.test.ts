import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1076_CURRENT_AUTORESEARCH_LOOP_EXECUTOR_SCHEMA_VERSION,
  runR1076CurrentAutoresearchLoopExecutor,
} from "./r1076-current-autoresearch-loop-executor.ts";
import { R1079_NSRR_SLEEP_AUTONOMIC_STANDARDIZER_SCHEMA_VERSION } from "./r1079-nsrr-sleep-autonomic-standardizer.ts";
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
import {
  R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND,
} from "./r1183-average-submitter-safe-response-materializer.ts";
import {
  R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_COMMAND,
  R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_SCHEMA_VERSION,
} from "./r1185-average-submitter-safe-response-smoke-proof.ts";
import {
  R1187_AVERAGE_SUBMITTER_ROUTE_METRIC_READINESS_COMMAND,
  R1187_AVERAGE_SUBMITTER_ROUTE_METRIC_READINESS_SCHEMA_VERSION,
} from "./r1187-average-submitter-route-metric-readiness.ts";

const ORDINARY_SOURCE_FAMILY_IDS = [
  "join_time_alignment",
  "outcome_linkage",
  "bloodwork_glycemia",
  "common_bloodwork_core",
  "vitals_body_context",
  "wearable_activity_daily",
];
const ORDINARY_TABLE_LAYOUTS = ["single_primary_table_fallback", "multi_table_or_explicit_refs"];
const PRIMARY_SUBMITTER_INPUT_FAMILY_IDS = [
  "bloodwork_glycemia",
  "common_bloodwork_core",
  "wearable_activity_daily",
  "vitals_body_context",
];
const REQUIRED_LINKAGE_FAMILY_IDS = ["outcome_linkage", "join_time_alignment"];
const FEATURE_ONLY_SOURCE_FAMILY_IDS = ["bloodwork_glycemia", "wearable_activity_daily"];
const FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS = [
  "lab_portal_export_or_spreadsheet",
  "phone_watch_or_wearable_activity_export",
];
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
];
const FEATURE_ONLY_FILL_GUIDE_CHECKLIST_IDS = [
  "confirm_target_age_band_without_identifiers",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
];
const FEATURE_ONLY_SAFE_ASSERTION_CHECKLIST_IDS = [
  "assert_target_age_band_roughly_16_50",
  "assert_glycemia_bloodwork_export_available",
  "assert_daily_wearable_activity_export_available",
  "assert_no_private_values_identifiers_paths_headers_or_rows",
];
const FEATURE_ONLY_FILL_GUIDE_OPTIONAL_ADD_ON_FAMILY_IDS = [
  "common_bloodwork_core",
  "vitals_body_context",
];
const R1159_ANSWER_SHEET_NEXT_ACTION = "fill_r1150_feature_only_safe_confirmation_from_r1159_answer_sheet";
const R1160_TRANSCRIPTION_PROOF_NEXT_ACTION =
  "row_owner_confirm_r1150_feature_only_safe_availability_from_r1160_transcription_proof";
const R1161_MATERIALIZER_NEXT_ACTION =
  "rerun_r1161_with_row_owner_feature_only_confirmation_assertion";
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
const R1187_SAFE_CONFIRMATION_COMMAND =
  "MURPH_AGE_R1183_ROW_OWNER_SAFE_RESPONSE_ASSERTIONS_CONFIRMED=true pnpm exec tsx scripts/murph-age/r1183-average-submitter-safe-response-materializer.ts";
const REQUIRED_SOURCE_FAMILY_IDS = [
  "outcome_linkage",
  "join_time_alignment",
  "bloodwork_glycemia",
  "wearable_activity_daily",
];
const ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS = [
  "confirm_target_age_band_without_identifiers",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
  "confirm_outcome_linkage_and_time_alignment_if_model_evidence",
  "confirm_aggregate_count_bands_if_model_evidence",
];
const FEATURE_ONLY_SAFE_COMPLETION_CHECK_IDS = [
  "confirm_target_age_band_without_identifiers",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
];
const ORDINARY_SUBMITTER_COMPLETION_MODE_IDS = [
  "feature_only_lab_wearable_coverage",
  "outcome_linked_lab_wearable_model_evidence",
];
const FEATURE_ONLY_SAFE_COMPLETION_MODE_ID = "feature_only_lab_wearable_coverage";
const R1176_ROW_OWNER_HANDOFF_REASON_ID =
  "confirm_feature_only_lab_wearable_availability_before_r1176_live_chain";
const PARTIAL_ROUTE_MANIFEST_RECIPE_IDS = [
  "lab_plus_wearable_minimum_manifest",
  "lab_glycemia_minimum_manifest",
  "wearable_activity_minimum_manifest",
  "full_labs_wearable_first_pass_manifest",
];
const R1142_PARTIAL_PRIVATE_CHAIN_RUNNER_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH=<availability-manifest.json> MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH=<partial-private-config.json> pnpm exec tsx scripts/murph-age/r1142-ordinary-consumer-partial-private-chain-runner.ts";
const R1143_MANIFEST_RECIPE_MATERIALIZER_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ID=<recipe-id> MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ASSERTIONS_CONFIRMED=true pnpm exec tsx scripts/murph-age/r1143-ordinary-consumer-availability-manifest-recipe-materializer.ts";
const R1144_RECIPE_READINESS_CHAIN_RUNNER_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ID=<recipe-id> MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ASSERTIONS_CONFIRMED=true pnpm exec tsx scripts/murph-age/r1144-ordinary-consumer-recipe-readiness-chain-runner.ts";
const R1146_RECOMMENDED_CONFIRMED_RECIPE_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ID=lab_plus_wearable_minimum_manifest MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ASSERTIONS_CONFIRMED=true pnpm exec tsx scripts/murph-age/r1144-ordinary-consumer-recipe-readiness-chain-runner.ts";
const R1150_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_COMMAND =
  "MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_PATH=<safe-availability-confirmation.json> pnpm exec tsx scripts/murph-age/r1150-ordinary-consumer-safe-availability-confirmation-intake.ts";
const R1154_SAFE_AVAILABILITY_ACTION_PACKET_COMMAND =
  "MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_PATH=<r1150-intake.json> pnpm exec tsx scripts/murph-age/r1154-ordinary-consumer-safe-availability-action-packet.ts";
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
const R1153_FEATURE_ONLY_CHAIN_RUNNER_COMMAND =
  "MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_PATH=<safe-availability-confirmation.json> pnpm exec tsx scripts/murph-age/r1153-ordinary-consumer-feature-only-chain-runner.ts";
const R1144_OUTCOME_LINKED_RECIPE_READINESS_COMMAND =
  "MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_PATH=<r1150-intake.json> MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ID=lab_plus_wearable_minimum_manifest pnpm exec tsx scripts/murph-age/r1144-ordinary-consumer-recipe-readiness-chain-runner.ts";
const R1146_BLOCKERS = [
  "row_owner_availability_assertions_not_confirmed",
  "confirmed_route_config_requirements_not_available",
  "private_route_config_not_supplied",
  "real_lab_wearable_route_metrics_missing",
];
const R1145_MISSING_REQUIREMENT_IDS = [
  "row_owner_availability_assertions_confirmed",
  "confirmed_recipe_route_requirements_available",
  "private_route_config_supplied",
  "real_lab_wearable_route_metrics_recorded",
];
const R1145_UNBLOCKER_STEP_IDS = [
  "confirm_feature_only_lab_wearable_safe_availability",
  "confirm_lab_wearable_recipe_route_requirements",
  "provide_lab_wearable_private_route_config",
  "run_real_lab_wearable_route_metrics",
];
const R1145_UNBLOCKER_ALLOWED_VALUE_KIND_IDS = ["booleans_only", "fixed_enumerated_ids_only"];
const R1145_UNBLOCKER_BLOCKED_CONTENT_IDS = [
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
const LAB_WEARABLE_MINIMUM_ROUTE_IDS = [
  "lab_glycemia_minimum_route",
  "wearable_activity_minimum_route",
];
const R1147_BLOCKERS = [
  "row_owner_availability_assertions_not_confirmed",
  "private_route_config_not_supplied",
  "real_lab_wearable_route_metrics_missing",
];
const R1147_PRIVATE_CONFIG_TEMPLATE_ARTIFACT =
  "r1147-fillable-ordinary-consumer-lab-wearable-private-route-config.json";
const R1147_RUNNER_CONFIG_SCHEMA_VERSION = "murph-age-ordinary-consumer-partial-private-runner-config.v1";
const R1147_RUNNER_CONFIG_TOP_LEVEL_KEYS = [
  "schemaVersion",
  "attestations",
  "aggregateMetricsTarget",
  "routeRunOrder",
  "privateTableRefs",
  "privateFieldRefs",
  "submissionContext",
];
const R1147_RUNNER_CONFIG_PRIVATE_FIELD_REF_KEYS = [
  "personJoinKey",
  "outcomeEvent",
  "labGlycemia",
  "wearableActivity",
];
const R1147_RUNNER_CONFIG_PRIVATE_TABLE_REF_KEYS = [
  "primaryTableRef",
  "outcomeTableRef",
  "labTableRef",
  "wearableTableRef",
];

function ordinarySourceFamilyMissingSlotRollup(): Record<string, unknown>[] {
  return [
    {
      familyId: "join_time_alignment",
      missingSlotCount: 10,
      missingSlotIds: [
        "L1_tiny_glycemia_only",
        "L2_common_lab_core_shadow",
        "W1_activity_steps_minutes",
        "QC_missingness_coverage",
        "personJoinKey",
        "dateOrTimeKey",
        "primaryTableRef",
        "outcomeTableRef",
        "labTableRef",
        "wearableTableRef",
      ],
      status: "needs_private_config",
    },
    {
      familyId: "outcome_linkage",
      missingSlotCount: 6,
      missingSlotIds: [
        "L1_tiny_glycemia_only",
        "L2_common_lab_core_shadow",
        "W1_activity_steps_minutes",
        "QC_missingness_coverage",
        "outcomeEvent",
        "outcomeTableRef",
      ],
      status: "needs_private_config",
    },
    {
      familyId: "bloodwork_glycemia",
      missingSlotCount: 4,
      missingSlotIds: [
        "L1_tiny_glycemia_only",
        "L2_common_lab_core_shadow",
        "labGlycemia",
        "labTableRef",
      ],
      status: "needs_private_config",
    },
    {
      familyId: "common_bloodwork_core",
      missingSlotCount: 3,
      missingSlotIds: [
        "L2_common_lab_core_shadow",
        "commonLabCore",
        "labTableRef",
      ],
      status: "needs_private_config",
    },
    {
      familyId: "vitals_body_context",
      missingSlotCount: 4,
      missingSlotIds: [
        "L2_common_lab_core_shadow",
        "vitalsBody",
        "labTableRef",
        "primaryTableRef",
      ],
      status: "needs_private_config",
    },
    {
      familyId: "wearable_activity_daily",
      missingSlotCount: 3,
      missingSlotIds: [
        "W1_activity_steps_minutes",
        "wearableActivity",
        "wearableTableRef",
      ],
      status: "needs_private_config",
    },
  ];
}

describe("R1076 current autoresearch loop executor", () => {
  it("runs the current true-wearable chain and reports the data blocker", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1076-data-"));
    try {
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      const fixtures = await writeFixtures(tmp);

      const { output, outputPath } = await runR1076CurrentAutoresearchLoopExecutor({
        createdAt: "2026-05-14T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
        ...fixtures,
      });

      expect(path.basename(outputPath)).toBe("r1076-current-autoresearch-loop-executor.latest.json");
      expect(output.schemaVersion).toBe(R1076_CURRENT_AUTORESEARCH_LOOP_EXECUTOR_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "executor_blocked_on_true_wearable_data",
        nextAction: "download_nsrr_or_secure_workbench_access",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1076: false,
        routerConclusion: "current_loop_blocked_on_true_wearable_data",
      });
      expect(output.executedSteps.r1074TrueWearablePostDownloadRefresh.summaryConclusion).toBe("post_download_refresh_blocked_on_data");
      expect(output.executedSteps.r1081NsrrSourceTableCandidateScanner).toMatchObject({
        packetId: "r1081-nsrr-source-table-candidate-scanner",
        summaryConclusion: "nsrr_candidate_tables_not_found",
      });
      expect(output.executedSteps.r1077NsrrSourceRouteAlignment.summaryConclusion).toBe("nsrr_preferred_routes_aligned_blocked_on_downloads");
      expect(output.executedSteps.r1075CurrentAutoresearchActionRouter.summaryConclusion).toBe("current_loop_blocked_on_true_wearable_data");
      expect(output.nextLoop.commands.join("\n")).toContain("after human NSRR terms/access activation");
      expect(output.nextLoop.commands.join("\n")).toContain("nsrr download shhs/datasets");
      expect(output.nextLoop.commands).toContain("pnpm exec tsx scripts/murph-age/r1076-current-autoresearch-loop-executor.ts");
      expect(output.nextLoop.reviewGptUse).toBe("only_for_real_aggregate_delta_or_major_architecture_fork");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);

      const persisted = JSON.parse(await readFile(outputPath, "utf8")) as unknown;
      expect(findForbiddenAggregateEgress(persisted)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("runs the private source-table candidate scanner when scan roots are supplied", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1076-auto-r1081-"));
    try {
      const scanRoot = path.join(tmp, "scan");
      await writeCandidateNsrrTable(scanRoot);
      const fixtures = await writeFixtures(tmp);

      const { output } = await runR1076CurrentAutoresearchLoopExecutor({
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
        ...fixtures,
      });

      expect(output.executedSteps.r1081NsrrSourceTableCandidateScanner).toMatchObject({
        packetId: "r1081-nsrr-source-table-candidate-scanner",
        status: "research-local-private-draft-plus-aggregate-receipt",
        summaryConclusion: "nsrr_candidate_tables_found_private_draft_ready",
      });
      expect(output.summary.conclusion).toBe("executor_blocked_on_true_wearable_data");
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(output)).not.toContain("candidate-source.csv");
      expect(JSON.stringify(output)).not.toContain("src_event");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("surfaces the consumer first-pass labs and wearable metrics handoff as current work", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1076-consumer-first-pass-"));
    try {
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      const fixtures = await writeFixtures(tmp);
      await writeFile(fixtures.r1101Path, `${JSON.stringify(r1101Fixture(
        "consumer_loop_ready_awaiting_aggregate_receipt",
        "fill_r1124_first_pass_aggregate_metrics_template",
      ))}\n`);

      const { output } = await runR1076CurrentAutoresearchLoopExecutor({
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
        ...fixtures,
      });

      expect(output.summary).toMatchObject({
        conclusion: "executor_waiting_on_consumer_safe_availability_confirmation",
        consumerAverageSubmitterFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
        consumerAverageSubmitterAvailabilityConclusion:
          "ordinary_data_availability_preflight_waiting_on_manifest",
        consumerAverageSubmitterAvailabilityManifestStatus: "not_provided",
        consumerAverageSubmitterAvailabilityMissingSourceFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
        consumerAverageSubmitterAvailabilityNextAction: "fill_safe_ordinary_data_availability_manifest",
        consumerAverageSubmitterAvailabilityPreflightArtifact:
          "r1133-ordinary-consumer-data-availability-preflight.latest.json",
        consumerAverageSubmitterAvailabilityReadyForPrivateConfigMapping: false,
        consumerAverageSubmitterConfigBridgeArtifact:
          "r1134-ordinary-consumer-availability-config-bridge.latest.json",
        consumerAverageSubmitterConfigBridgeAvailableSourceFamilyIds: [],
        consumerAverageSubmitterConfigBridgeConclusion:
          "ordinary_availability_config_bridge_waiting_on_availability_manifest",
        consumerAverageSubmitterConfigBridgeMappingPlanStatus: "waiting_on_availability_manifest",
        consumerAverageSubmitterConfigBridgeNextAction: "fill_safe_ordinary_data_availability_manifest",
        consumerAverageSubmitterConfigBridgeReadyForPrivateConfigMapping: false,
        consumerAverageSubmitterConfigBridgeSelectedTableLayout: null,
        consumerAverageSubmitterManifestPacketArtifact:
          "r1135-ordinary-consumer-availability-manifest-packet.latest.json",
        consumerAverageSubmitterManifestPacketConclusion:
          "ordinary_availability_manifest_packet_waiting_on_row_owner_manifest",
        consumerAverageSubmitterManifestPacketMatchedRecipeIds: [],
        consumerAverageSubmitterManifestPacketMaterializerCommand: R1143_MANIFEST_RECIPE_MATERIALIZER_COMMAND,
        consumerAverageSubmitterManifestPacketNextAction:
          "fill_r1133_safe_availability_manifest_for_wearables_labs_then_rerun_r1133_r1134",
        consumerAverageSubmitterManifestPacketPrimaryInputFamilyIds: PRIMARY_SUBMITTER_INPUT_FAMILY_IDS,
        consumerAverageSubmitterManifestPacketPartialPrivateChainRunnerCommand:
          R1142_PARTIAL_PRIVATE_CHAIN_RUNNER_COMMAND,
        consumerAverageSubmitterManifestPacketPartialRouteRecipeIds: PARTIAL_ROUTE_MANIFEST_RECIPE_IDS,
        consumerAverageSubmitterManifestPacketPreferredRecipeIds: PARTIAL_ROUTE_MANIFEST_RECIPE_IDS,
        consumerAverageSubmitterManifestPacketReadyForPrivateConfigMapping: false,
        consumerAverageSubmitterManifestPacketRecipeReadinessChainCommand: R1144_RECIPE_READINESS_CHAIN_RUNNER_COMMAND,
        consumerAverageSubmitterManifestPacketSafeManifestAttestationsComplete: false,
        consumerAverageSubmitterManifestPacketRequiredLinkageFamilyIds: REQUIRED_LINKAGE_FAMILY_IDS,
        consumerAverageSubmitterAvailabilityChainArtifact:
          "r1136-ordinary-consumer-availability-chain-runner.latest.json",
        consumerAverageSubmitterAvailabilityChainConclusion: "ordinary_availability_chain_waiting_on_safe_manifest",
        consumerAverageSubmitterAvailabilityChainManifestSupplied: false,
        consumerAverageSubmitterAvailabilityChainNextAction: "fill_safe_availability_manifest_then_run_r1136_chain",
        consumerAverageSubmitterAvailabilityChainReadyForPrivateConfigMapping: false,
        consumerAverageSubmitterPartialRoutePlannerArtifact:
          "r1137-ordinary-consumer-partial-route-planner.latest.json",
        consumerAverageSubmitterPartialRoutePlannerConclusion:
          "ordinary_partial_route_planner_waiting_on_safe_manifest",
        consumerAverageSubmitterPartialRoutePlannerFullRouteReady: false,
        consumerAverageSubmitterPartialRoutePlannerNextAction:
          "fill_safe_availability_manifest_then_run_r1136_r1137_chain",
        consumerAverageSubmitterPartialRoutePlannerReadyForPrivateConfigMapping: false,
        consumerAverageSubmitterPartialRoutePlannerReadyUnsupportedRouteIds: [],
        consumerAverageSubmitterPartialMetricIntakeArtifact:
          "r1138-ordinary-consumer-partial-aggregate-metric-intake.latest.json",
        consumerAverageSubmitterPartialMetricIntakeConclusion:
          "ordinary_partial_aggregate_metric_intake_waiting_on_route_plan",
        consumerAverageSubmitterPartialMetricIntakeNextAction:
          "fill_safe_availability_manifest_then_run_r1136_r1137_chain",
        consumerAverageSubmitterPartialMetricIntakeReadyRouteIds: [],
        consumerAverageSubmitterPartialMetricIntakeTemplateArtifact:
          "r1138-fillable-ordinary-consumer-partial-aggregate-metrics.json",
        consumerAverageSubmitterPartialPrivateConfigHandoffArtifact:
          "r1139-ordinary-consumer-partial-private-config-handoff.latest.json",
        consumerAverageSubmitterPartialPrivateConfigHandoffConclusion:
          "ordinary_partial_private_config_handoff_waiting_on_route_plan",
        consumerAverageSubmitterPartialPrivateConfigHandoffEligibleRouteIds: [],
        consumerAverageSubmitterPartialPrivateConfigHandoffFullEvidenceGateCleared: false,
        consumerAverageSubmitterPartialPrivateConfigHandoffNextAction:
          "fill_safe_availability_manifest_then_run_r1136_r1137_chain",
        consumerAverageSubmitterPartialPrivateConfigHandoffReadyMetricRouteIds: [],
        consumerAverageSubmitterPartialPrivateConfigHandoffRequiredFieldRefFamilies: [
          "personJoinKey",
          "dateOrTimeKey",
          "outcomeEvent",
          "labGlycemia",
          "commonLabCore",
          "vitalsBody",
          "wearableActivity",
        ],
        consumerAverageSubmitterPartialPrivateConfigHandoffRequiredTableRefs: [
          "primaryTableRef",
          "outcomeTableRef",
          "labTableRef",
          "wearableTableRef",
        ],
        consumerAverageSubmitterPartialPrivateConfigHandoffTemplateArtifact:
          "r1139-fillable-ordinary-consumer-partial-private-config.json",
        consumerAverageSubmitterPartialReadinessChainArtifact:
          "r1140-ordinary-consumer-partial-readiness-chain-runner.latest.json",
        consumerAverageSubmitterPartialReadinessChainConclusion:
          "ordinary_partial_readiness_chain_waiting_on_safe_manifest",
        consumerAverageSubmitterPartialReadinessChainEligibleRouteIds: [],
        consumerAverageSubmitterPartialReadinessChainFullEvidenceGateCleared: false,
        consumerAverageSubmitterPartialReadinessChainManifestSupplied: false,
        consumerAverageSubmitterPartialReadinessChainNextAction:
          "fill_safe_availability_manifest_then_run_r1140_partial_chain",
        consumerAverageSubmitterPartialReadinessChainReadyMetricRouteIds: [],
        consumerAverageSubmitterPartialReadinessChainRequiredFieldRefFamilies: [
          "personJoinKey",
          "dateOrTimeKey",
          "outcomeEvent",
          "labGlycemia",
          "commonLabCore",
          "vitalsBody",
          "wearableActivity",
        ],
        consumerAverageSubmitterPartialReadinessChainRequiredTableRefs: [
          "primaryTableRef",
          "outcomeTableRef",
          "labTableRef",
          "wearableTableRef",
        ],
        consumerAverageSubmitterPartialReadinessChainTemplateArtifact:
          "r1139-fillable-ordinary-consumer-partial-private-config.json",
        consumerAverageSubmitterPartialPrivateMetricRunnerAggregateMetricsArtifact: null,
        consumerAverageSubmitterPartialPrivateMetricRunnerArtifact:
          "r1141-ordinary-consumer-partial-private-metric-runner.latest.json",
        consumerAverageSubmitterPartialPrivateMetricRunnerConclusion:
          "ordinary_partial_private_metric_runner_waiting_on_partial_handoff",
        consumerAverageSubmitterPartialPrivateMetricRunnerEligibleRouteIds: [],
        consumerAverageSubmitterPartialPrivateMetricRunnerExecutedRouteIds: [],
        consumerAverageSubmitterPartialPrivateMetricRunnerNextAction:
          "run_r1140_or_r1139_until_partial_routes_ready",
        consumerAverageSubmitterPartialPrivateMetricRunnerRequestedRouteIds: [],
        consumerAverageSubmitterPartialPrivateMetricRunnerRouteMetricsReadyForR1138: false,
        consumerAverageSubmitterPartialPrivateChainAggregateMetricsArtifact: null,
        consumerAverageSubmitterPartialPrivateChainArtifact:
          "r1142-ordinary-consumer-partial-private-chain-runner.latest.json",
        consumerAverageSubmitterPartialPrivateChainConclusion:
          "ordinary_partial_private_chain_waiting_on_safe_manifest",
        consumerAverageSubmitterPartialPrivateChainEligibleRouteIds: [],
        consumerAverageSubmitterPartialPrivateChainExecutedRouteIds: [],
        consumerAverageSubmitterPartialPrivateChainFinalReadyRouteIds: [],
        consumerAverageSubmitterPartialPrivateChainFullEvidenceGateCleared: false,
        consumerAverageSubmitterPartialPrivateChainFullSupportedRouteReady: false,
        consumerAverageSubmitterPartialPrivateChainNextAction:
          "fill_safe_availability_manifest_then_run_r1142_partial_private_chain",
        consumerAverageSubmitterPartialPrivateChainRouteMetricsReadyForR1138: false,
        consumerAverageSubmitterRowOwnerActionPacketArtifact:
          "r1146-ordinary-consumer-row-owner-route-action-packet.latest.json",
        consumerAverageSubmitterRowOwnerActionPacketBlockers: R1146_BLOCKERS,
        consumerAverageSubmitterRowOwnerActionPacketConclusion:
          "ordinary_row_owner_route_action_packet_waiting_on_row_owner_availability_confirmation",
        consumerAverageSubmitterRowOwnerActionPacketFallbackRecipeIds: [
          "lab_glycemia_minimum_manifest",
          "wearable_activity_minimum_manifest",
        ],
        consumerAverageSubmitterRowOwnerActionPacketNextAction:
          "confirm_recommended_lab_plus_wearable_recipe_availability_assertions",
        consumerAverageSubmitterRowOwnerActionPacketRecommendedConfirmedRecipeCommand:
          R1146_RECOMMENDED_CONFIRMED_RECIPE_COMMAND,
        consumerAverageSubmitterRowOwnerActionPacketRecommendedConfirmedRecipeCommandAvailable: true,
        consumerAverageSubmitterRowOwnerActionPacketSelectedRecipeId: "lab_plus_wearable_minimum_manifest",
        consumerAverageSubmitterPostConfirmationPrivateConfigPacketArtifact:
          "r1147-ordinary-consumer-post-confirmation-private-config-packet.latest.json",
        consumerAverageSubmitterPostConfirmationPrivateConfigPacketBlockers: R1147_BLOCKERS,
        consumerAverageSubmitterPostConfirmationPrivateConfigPacketConclusion:
          "ordinary_post_confirmation_private_config_packet_waiting_on_row_owner_confirmation",
        consumerAverageSubmitterPostConfirmationPrivateConfigPacketExpectedRouteIds: LAB_WEARABLE_MINIMUM_ROUTE_IDS,
        consumerAverageSubmitterPostConfirmationPrivateConfigPacketNextAction:
          "run_recommended_confirmed_recipe_chain_before_private_config_packet",
        consumerAverageSubmitterPostConfirmationPrivateConfigPacketRequiredFieldRefFamilies: [
          "personJoinKey",
          "dateOrTimeKey",
          "outcomeEvent",
          "labGlycemia",
          "wearableActivity",
        ],
        consumerAverageSubmitterPostConfirmationPrivateConfigPacketRequiredTableRefs: [
          "primaryTableRef",
          "outcomeTableRef",
          "labTableRef",
          "wearableTableRef",
        ],
        consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigPrivateFieldRefKeys:
          R1147_RUNNER_CONFIG_PRIVATE_FIELD_REF_KEYS,
        consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigPrivateTableRefKeys:
          R1147_RUNNER_CONFIG_PRIVATE_TABLE_REF_KEYS,
        consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigRouteRunOrder:
          LAB_WEARABLE_MINIMUM_ROUTE_IDS,
        consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigSchemaVersion:
          R1147_RUNNER_CONFIG_SCHEMA_VERSION,
        consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigTopLevelKeys:
          R1147_RUNNER_CONFIG_TOP_LEVEL_KEYS,
        consumerAverageSubmitterPostConfirmationPrivateConfigPacketRowOwnerAssertionsConfirmed: false,
        consumerAverageSubmitterPostConfirmationPrivateConfigPacketTemplateArtifact:
          R1147_PRIVATE_CONFIG_TEMPLATE_ARTIFACT,
        consumerAverageSubmitterPostConfirmationPrivateConfigPacketTemplateReadyForFill: false,
        consumerAverageSubmitterMissingSlotCount: 20,
        consumerAverageSubmitterMissingSlotTypes: [
          "first_pass_candidate",
          "semantic_ref_family",
          "submission_context_field",
          "table_ref",
        ],
        consumerAverageSubmitterNextAction: "fill_average_submitter_private_config_slots",
        consumerAverageSubmitterReadinessArtifact: "r1132-ordinary-consumer-submission-readiness.latest.json",
        consumerAverageSubmitterReadinessConclusion:
          "ordinary_consumer_submission_readiness_ready_for_row_owner_mapping",
        consumerAverageSubmitterReadyForPrivateRunner: false,
        consumerAverageSubmitterRealAggregateStillMissing: true,
        consumerAverageSubmitterSourceFamilyMissingSlotRollup: ordinarySourceFamilyMissingSlotRollup(),
        consumerFirstPassAggregateMetricsTemplateArtifact: "r1124-fillable-consumer-first-pass-aggregate-metrics.json",
        consumerOrdinarySubmissionHandoffPlanArtifact: "r1127-fillable-ordinary-consumer-first-pass-submission-plan.json",
        consumerOrdinarySourceFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
        consumerOrdinaryTableLayouts: ORDINARY_TABLE_LAYOUTS,
        consumerPipelineSmokeConclusion: "ordinary_consumer_pipeline_smoke_passed_non_evidence",
        consumerPipelineSmokeSyntheticEvidence: false,
        consumerPipelineSmokeTableLayouts: ORDINARY_TABLE_LAYOUTS,
        consumerPrivateRunnerNextAction: "fill_r1124_first_pass_aggregate_metrics_template",
        consumerRealEvidenceGateBlockers: [
          "real_outcome_linked_labs_wearables_aggregate_missing",
          "r1124_first_pass_aggregate_metrics_not_provided",
          "l1_l2_w1_qc_first_pass_metrics_incomplete",
        ],
        consumerRealEvidenceGateConclusion: "consumer_real_evidence_gate_waiting_on_real_labs_wearables_aggregate",
        consumerRealEvidenceGateNextAction: "collect_or_run_real_outcome_linked_labs_wearables_aggregate_metrics",
        consumerRealEvidenceHandoffArtifact: "r1130-ordinary-consumer-real-evidence-handoff.latest.json",
        consumerRealEvidenceHandoffBlockers: [
          "real_outcome_linked_labs_wearables_aggregate_missing",
          "r1124_first_pass_aggregate_metrics_not_provided",
          "l1_l2_w1_qc_first_pass_metrics_incomplete",
          "private_config_not_ready_for_r1125",
        ],
        consumerRealEvidenceHandoffMissingConfigChecklistCount: 20,
        consumerRealEvidenceHandoffMissingConfigChecklistSlotTypes: [
          "first_pass_candidate",
          "semantic_ref_family",
          "submission_context_field",
          "table_ref",
        ],
        consumerRealEvidenceHandoffConclusion: "ordinary_consumer_real_evidence_handoff_ready_for_row_owner_config",
        consumerRealEvidenceHandoffMissingConfigPieces: {
          firstPassCandidateIds: [
            "L1_tiny_glycemia_only",
            "L2_common_lab_core_shadow",
            "W1_activity_steps_minutes",
            "QC_missingness_coverage",
          ],
          semanticRefFamilies: [
            "personJoinKey",
            "dateOrTimeKey",
            "outcomeEvent",
            "labGlycemia",
            "commonLabCore",
            "vitalsBody",
            "wearableActivity",
          ],
          submissionContextFields: [
            "evidenceRole",
            "ordinaryConsumerSubmission",
            "outcomeLinked",
            "priorityInputFamilies",
            "targetAgeBand",
          ],
          tableRefs: [
            "primaryTableRef",
            "outcomeTableRef",
            "labTableRef",
            "wearableTableRef",
          ],
        },
        consumerRealEvidenceHandoffNextAction: "complete_private_config_for_real_outcome_linked_labs_wearables",
        consumerRealEvidenceHandoffPrivateConfigReadiness: "private_config_needs_completion",
        consumerRealEvidenceHandoffRowOwnerWorkType: "complete_private_config",
        consumerAverageSubmitterSafeConfirmationTranscriptionProofArtifact:
          "r1160-r1159-feature-only-safe-confirmation-transcription-proof.latest.json",
        consumerAverageSubmitterSafeConfirmationTranscriptionProofCommand: R1160_TRANSCRIPTION_PROOF_COMMAND,
        consumerAverageSubmitterSafeConfirmationTranscriptionProofConclusion:
          "r1159_feature_only_safe_confirmation_transcription_ready_non_evidence",
        consumerAverageSubmitterSafeConfirmationTranscriptionProofExactSafeTranscriptionStepCount:
          R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
        consumerAverageSubmitterSafeConfirmationTranscriptionProofReadyForRowOwnerConfirmation: true,
        consumerAverageSubmitterSafeConfirmationTranscriptionProofHypotheticalTranscriptionWouldBeFeatureOnlyReady: true,
        consumerAverageSubmitterSafeConfirmationTranscriptionProofNextAction: R1160_TRANSCRIPTION_PROOF_NEXT_ACTION,
        consumerAverageSubmitterSafeConfirmationTranscriptionProofRequiredInputKindIds:
          FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS,
        consumerAverageSubmitterSafeConfirmationTranscriptionProofRowLevelDataAcceptedByR1160: false,
        consumerAverageSubmitterSafeConfirmationTranscriptionProofRowOwnerConfirmationStillRequired: true,
        consumerAverageSubmitterSafeConfirmationTranscriptionProofConfirmationValuesStoredByR1160: false,
        consumerAverageSubmitterSafeConfirmationTranscriptionProofRowOwnerProvidedValuesStored: false,
        consumerAverageSubmitterSafeConfirmationMaterializerArtifact:
          "r1161-feature-only-safe-availability-confirmation-materializer.latest.json",
        consumerAverageSubmitterSafeConfirmationMaterializerCommand: R1161_MATERIALIZER_COMMAND,
        consumerAverageSubmitterSafeConfirmationMaterializerConclusion:
          "feature_only_safe_availability_confirmation_materializer_waiting_on_explicit_row_owner_confirmation",
        consumerAverageSubmitterSafeConfirmationMaterializerNextAction: R1161_MATERIALIZER_NEXT_ACTION,
        consumerAverageSubmitterSafeConfirmationMaterializerExplicitRowOwnerConfirmationAssertionProvided: false,
        consumerAverageSubmitterSafeConfirmationMaterializerSafeConfirmationArtifactWritten: false,
        consumerAverageSubmitterSafeConfirmationMaterializerSafeConfirmationArtifact: null,
        consumerAverageSubmitterSafeConfirmationMaterializerFeatureOnlyConfirmationWouldBeReadyForR1150: false,
        consumerAverageSubmitterSafeConfirmationMaterializerRowOwnerConfirmationStillRequired: true,
        consumerAverageSubmitterSafeConfirmationMaterializerConfirmationValuesStoredInR1161Packet: false,
        consumerAverageSubmitterSafeConfirmationMaterializerRowLevelDataAcceptedByR1161: false,
        consumerAverageSubmitterSafeConfirmationMaterializerRowOwnerPrivateValuesStored: false,
        nextAction: R1161_MATERIALIZER_NEXT_ACTION,
        reviewGptRequiredNow: false,
        routerConclusion: "current_loop_ready_for_consumer_first_pass_aggregate_metrics",
        routerNextAction: "fill_consumer_first_pass_aggregate_metrics_template",
      });
      expect(output.nextLoop.consumerOrdinarySubmissionHandoffPlanArtifact).toBe(
        "r1127-fillable-ordinary-consumer-first-pass-submission-plan.json",
      );
      expect(output.nextLoop.consumerAverageSubmitterFamilyIds).toEqual(ORDINARY_SOURCE_FAMILY_IDS);
      expect(output.nextLoop.consumerAverageSubmitterAvailabilityManifestStatus).toBe("not_provided");
      expect(output.nextLoop.consumerAverageSubmitterAvailabilityMissingSourceFamilyIds).toEqual(
        ORDINARY_SOURCE_FAMILY_IDS,
      );
      expect(output.nextLoop.consumerAverageSubmitterConfigBridgeArtifact).toBe(
        "r1134-ordinary-consumer-availability-config-bridge.latest.json",
      );
      expect(output.nextLoop.consumerAverageSubmitterConfigBridgeNextAction).toBe(
        "fill_safe_ordinary_data_availability_manifest",
      );
      expect(output.nextLoop.consumerAverageSubmitterConfigBridgeAvailableSourceFamilyIds).toEqual([]);
      expect(output.nextLoop.consumerAverageSubmitterManifestPacketArtifact).toBe(
        "r1135-ordinary-consumer-availability-manifest-packet.latest.json",
      );
      expect(output.nextLoop.consumerAverageSubmitterManifestPacketPrimaryInputFamilyIds).toEqual(
        PRIMARY_SUBMITTER_INPUT_FAMILY_IDS,
      );
      expect(output.nextLoop.consumerAverageSubmitterManifestPacketMatchedRecipeIds).toEqual([]);
      expect(output.nextLoop.consumerAverageSubmitterManifestPacketMaterializerCommand).toBe(
        R1143_MANIFEST_RECIPE_MATERIALIZER_COMMAND,
      );
      expect(output.nextLoop.consumerAverageSubmitterManifestPacketPartialPrivateChainRunnerCommand).toBe(
        R1142_PARTIAL_PRIVATE_CHAIN_RUNNER_COMMAND,
      );
      expect(output.nextLoop.consumerAverageSubmitterManifestPacketPartialRouteRecipeIds).toEqual(
        PARTIAL_ROUTE_MANIFEST_RECIPE_IDS,
      );
      expect(output.nextLoop.consumerAverageSubmitterManifestPacketPreferredRecipeIds).toEqual(
        PARTIAL_ROUTE_MANIFEST_RECIPE_IDS,
      );
      expect(output.nextLoop.consumerAverageSubmitterManifestPacketRequiredLinkageFamilyIds).toEqual(
        REQUIRED_LINKAGE_FAMILY_IDS,
      );
      expect(output.nextLoop.consumerAverageSubmitterManifestPacketRecipeReadinessChainCommand).toBe(
        R1144_RECIPE_READINESS_CHAIN_RUNNER_COMMAND,
      );
      expect(output.nextLoop.consumerAverageSubmitterManifestPacketSafeManifestAttestationsComplete).toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterAvailabilityChainArtifact).toBe(
        "r1136-ordinary-consumer-availability-chain-runner.latest.json",
      );
      expect(output.nextLoop.consumerAverageSubmitterAvailabilityChainNextAction).toBe(
        "fill_safe_availability_manifest_then_run_r1136_chain",
      );
      expect(output.nextLoop.consumerAverageSubmitterPartialRoutePlannerArtifact).toBe(
        "r1137-ordinary-consumer-partial-route-planner.latest.json",
      );
      expect(output.nextLoop.consumerAverageSubmitterPartialRoutePlannerNextAction).toBe(
        "fill_safe_availability_manifest_then_run_r1136_r1137_chain",
      );
      expect(output.nextLoop.consumerAverageSubmitterPartialMetricIntakeArtifact).toBe(
        "r1138-ordinary-consumer-partial-aggregate-metric-intake.latest.json",
      );
      expect(output.nextLoop.consumerAverageSubmitterPartialMetricIntakeTemplateArtifact).toBe(
        "r1138-fillable-ordinary-consumer-partial-aggregate-metrics.json",
      );
      expect(output.nextLoop.consumerAverageSubmitterPartialPrivateConfigHandoffArtifact).toBe(
        "r1139-ordinary-consumer-partial-private-config-handoff.latest.json",
      );
      expect(output.nextLoop.consumerAverageSubmitterPartialPrivateConfigHandoffTemplateArtifact).toBe(
        "r1139-fillable-ordinary-consumer-partial-private-config.json",
      );
      expect(output.nextLoop.consumerAverageSubmitterPartialPrivateConfigHandoffRequiredFieldRefFamilies).toContain(
        "wearableActivity",
      );
      expect(output.nextLoop.consumerAverageSubmitterPartialReadinessChainArtifact).toBe(
        "r1140-ordinary-consumer-partial-readiness-chain-runner.latest.json",
      );
      expect(output.nextLoop.consumerAverageSubmitterPartialReadinessChainNextAction).toBe(
        "fill_safe_availability_manifest_then_run_r1140_partial_chain",
      );
      expect(output.nextLoop.consumerAverageSubmitterPartialPrivateMetricRunnerArtifact).toBe(
        "r1141-ordinary-consumer-partial-private-metric-runner.latest.json",
      );
      expect(output.nextLoop.consumerAverageSubmitterPartialPrivateMetricRunnerNextAction).toBe(
        "run_r1140_or_r1139_until_partial_routes_ready",
      );
      expect(output.nextLoop.consumerAverageSubmitterPartialPrivateChainArtifact).toBe(
        "r1142-ordinary-consumer-partial-private-chain-runner.latest.json",
      );
      expect(output.nextLoop.consumerAverageSubmitterPartialPrivateChainNextAction).toBe(
        "fill_safe_availability_manifest_then_run_r1142_partial_private_chain",
      );
      expect(output.nextLoop.consumerAverageSubmitterRowOwnerActionPacketArtifact).toBe(
        "r1146-ordinary-consumer-row-owner-route-action-packet.latest.json",
      );
      expect(output.nextLoop.consumerAverageSubmitterRowOwnerActionPacketNextAction).toBe(
        "confirm_recommended_lab_plus_wearable_recipe_availability_assertions",
      );
      expect(output.nextLoop.consumerAverageSubmitterRowOwnerActionPacketSelectedRecipeId).toBe(
        "lab_plus_wearable_minimum_manifest",
      );
      expect(output.nextLoop.consumerAverageSubmitterRowOwnerActionPacketFallbackRecipeIds).toEqual([
        "lab_glycemia_minimum_manifest",
        "wearable_activity_minimum_manifest",
      ]);
      expect(output.nextLoop.consumerAverageSubmitterRowOwnerActionPacketBlockers).toEqual(R1146_BLOCKERS);
      expect(output.nextLoop.consumerAverageSubmitterRowOwnerActionPacketRecommendedConfirmedRecipeCommand).toBe(
        R1146_RECOMMENDED_CONFIRMED_RECIPE_COMMAND,
      );
      expect(output.nextLoop.consumerAverageSubmitterPostConfirmationPrivateConfigPacketArtifact).toBe(
        "r1147-ordinary-consumer-post-confirmation-private-config-packet.latest.json",
      );
      expect(output.nextLoop.consumerAverageSubmitterPostConfirmationPrivateConfigPacketNextAction).toBe(
        "run_recommended_confirmed_recipe_chain_before_private_config_packet",
      );
      expect(output.nextLoop.consumerAverageSubmitterPostConfirmationPrivateConfigPacketExpectedRouteIds).toEqual(
        LAB_WEARABLE_MINIMUM_ROUTE_IDS,
      );
      expect(output.nextLoop.consumerAverageSubmitterPostConfirmationPrivateConfigPacketRequiredFieldRefFamilies)
        .toContain("wearableActivity");
      expect(output.nextLoop.consumerAverageSubmitterPostConfirmationPrivateConfigPacketRequiredTableRefs).toEqual([
        "primaryTableRef",
        "outcomeTableRef",
        "labTableRef",
        "wearableTableRef",
      ]);
      expect(output.nextLoop.consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigSchemaVersion)
        .toBe(R1147_RUNNER_CONFIG_SCHEMA_VERSION);
      expect(output.nextLoop.consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigTopLevelKeys)
        .toEqual(R1147_RUNNER_CONFIG_TOP_LEVEL_KEYS);
      expect(output.nextLoop.consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigPrivateFieldRefKeys)
        .toEqual(R1147_RUNNER_CONFIG_PRIVATE_FIELD_REF_KEYS);
      expect(output.nextLoop.consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigPrivateTableRefKeys)
        .toEqual(R1147_RUNNER_CONFIG_PRIVATE_TABLE_REF_KEYS);
      expect(output.nextLoop.consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigRouteRunOrder)
        .toEqual(LAB_WEARABLE_MINIMUM_ROUTE_IDS);
      expect(output.nextLoop.consumerAverageSubmitterPostConfirmationPrivateConfigPacketTemplateArtifact).toBe(
        R1147_PRIVATE_CONFIG_TEMPLATE_ARTIFACT,
      );
      expect(output.nextLoop.consumerAverageSubmitterPostConfirmationPrivateConfigPacketTemplateReadyForFill).toBe(
        false,
      );
      expect(output.nextLoop.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeConclusion).toBe(
        "post_confirmation_private_config_waiting_on_safe_availability_confirmation",
      );
      expect(output.nextLoop.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeNextAction).toBe(
        "fill_safe_availability_confirmation_from_template",
      );
      expect(output.nextLoop.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeR1147NextAction).toBe(
        "fill_safe_availability_confirmation_from_template",
      );
      expect(output.nextLoop.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeActionGuardPresent)
        .toBe(true);
      expect(
        output.nextLoop
          .consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketNextAction,
      ).toBe("fill_safe_availability_confirmation_from_template");
      expect(
        output.nextLoop
          .consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds,
      ).toEqual(FEATURE_ONLY_SOURCE_FAMILY_IDS);
      expect(
        output.nextLoop
          .consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketMissingRequiredSourceFamilyIds,
      ).toEqual(REQUIRED_SOURCE_FAMILY_IDS);
      expect(
        output.nextLoop
          .consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketRowLevelDataAcceptedByR1154,
      ).toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterMissingSlotCount).toBe(20);
      expect(output.nextLoop.consumerAverageSubmitterSourceFamilyMissingSlotRollup).toEqual(
        ordinarySourceFamilyMissingSlotRollup(),
      );
      expect(output.nextLoop.consumerAverageSubmitterSourceFamilyMissingSlotRollup).toContainEqual({
        familyId: "wearable_activity_daily",
        missingSlotCount: 3,
        missingSlotIds: [
          "W1_activity_steps_minutes",
          "wearableActivity",
          "wearableTableRef",
        ],
        status: "needs_private_config",
      });
      expect(output.nextLoop.consumerAverageSubmitterNextAction).toBe("fill_average_submitter_private_config_slots");
      expect(output.nextLoop.consumerAverageSubmitterReadinessConclusion).toBe(
        "ordinary_consumer_submission_readiness_ready_for_row_owner_mapping",
      );
      expect(output.nextLoop.consumerOrdinarySourceFamilyIds).toEqual(ORDINARY_SOURCE_FAMILY_IDS);
      expect(output.nextLoop.consumerOrdinaryTableLayouts).toEqual(ORDINARY_TABLE_LAYOUTS);
      expect(output.nextLoop.consumerPipelineSmokeConclusion).toBe(
        "ordinary_consumer_pipeline_smoke_passed_non_evidence",
      );
      expect(output.nextLoop.consumerPipelineSmokeTableLayouts).toEqual(ORDINARY_TABLE_LAYOUTS);
      expect(output.nextLoop.consumerRealEvidenceGateConclusion).toBe(
        "consumer_real_evidence_gate_waiting_on_real_labs_wearables_aggregate",
      );
      expect(output.nextLoop.consumerRealEvidenceGateBlockers).toContain(
        "real_outcome_linked_labs_wearables_aggregate_missing",
      );
      expect(output.nextLoop.consumerRealEvidenceHandoffConclusion).toBe(
        "ordinary_consumer_real_evidence_handoff_ready_for_row_owner_config",
      );
      expect(output.nextLoop.consumerRealEvidenceHandoffBlockers).toContain(
        "private_config_not_ready_for_r1125",
      );
      expect(output.nextLoop.consumerRealEvidenceHandoffMissingConfigPieces?.semanticRefFamilies).toContain(
        "wearableActivity",
      );
      expect(output.nextLoop.consumerRealEvidenceHandoffMissingConfigChecklistCount).toBe(20);
      expect(output.nextLoop.consumerRealEvidenceHandoffMissingConfigChecklistSlotTypes).toContain("table_ref");
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityConfirmationArtifact).toBe(
        "r1150-ordinary-consumer-safe-availability-confirmation-intake.latest.json",
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityConfirmationConclusion).toBe(
        "safe_availability_confirmation_not_provided",
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityConfirmationStatus).toBe("missing");
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityConfirmationNextAction).toBe(
        "fill_safe_availability_confirmation_from_template",
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityConfirmationReadyForRecipeReadinessChain)
        .toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityConfirmationFeatureOnlyCoverageContextReady)
        .toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityConfirmationFeatureOnlyCoverageRequiresPreferredPair)
        .toBe(true);
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityConfirmationChecklistItemIds)
        .toEqual(ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS);
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityConfirmationMinimumFeaturePairRequired)
        .toEqual(FEATURE_ONLY_SOURCE_FAMILY_IDS);
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityConfirmationMissingFeatureOnlySourceFamilyIds)
        .toEqual(FEATURE_ONLY_SOURCE_FAMILY_IDS);
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityConfirmationOutcomeLinkageRequiredForFeatureOnlyContext)
        .toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityConfirmationRowLevelDataAcceptedByR1150)
        .toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityConfirmationMissingSourceFamilyIds).toEqual([
        "outcome_linkage",
        "join_time_alignment",
        "bloodwork_glycemia",
        "wearable_activity_daily",
      ]);
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityConfirmationMissingAttestationKeys).toContain(
        "noPrivatePathEgress",
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityConfirmationMissingAggregateReadinessFactIds)
        .toContain("usableRecordCountBand");
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityConfirmationTemplateArtifact).toBe(
        "r1150-fillable-ordinary-consumer-safe-availability-confirmation.json",
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityConfirmationFeatureOnlyTemplateArtifact).toBe(
        "r1150-fillable-feature-only-safe-availability-confirmation.json",
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityActionPacketArtifact).toBe(
        "r1154-ordinary-consumer-safe-availability-action-packet.latest.json",
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityActionPacketCommand).toBe(
        R1154_SAFE_AVAILABILITY_ACTION_PACKET_COMMAND,
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityConfirmationIntakeCommand).toBe(
        R1150_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_COMMAND,
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityFeatureOnlyChainRunnerCommand).toBe(
        R1153_FEATURE_ONLY_CHAIN_RUNNER_COMMAND,
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityOutcomeLinkedRecipeReadinessCommand).toBe(
        R1144_OUTCOME_LINKED_RECIPE_READINESS_COMMAND,
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityCompletionModeIds).toEqual(
        ORDINARY_SUBMITTER_COMPLETION_MODE_IDS,
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityActionPacketConclusion).toBe(
        "safe_availability_action_packet_waiting_on_safe_confirmation",
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityActionPacketNextAction).toBe(
        "fill_safe_availability_confirmation_from_template",
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityActionPacketMinimumFeaturePairRequired)
        .toEqual(FEATURE_ONLY_SOURCE_FAMILY_IDS);
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityActionPacketChecklistItemIds)
        .toEqual(ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS);
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds)
        .toEqual(FEATURE_ONLY_SOURCE_FAMILY_IDS);
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityActionPacketMissingRequiredSourceFamilyIds)
        .toEqual(REQUIRED_SOURCE_FAMILY_IDS);
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyCoverageContextReady)
        .toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyQuickstartArtifact).toBe(
        R1154_FEATURE_ONLY_QUICKSTART_ARTIFACT,
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount)
        .toBe(R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length);
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths)
        .toEqual(R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS);
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain)
        .toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityActionPacketRowLevelDataAcceptedByR1154)
        .toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityActionPacketRowParsingPerformedByR1154)
        .toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityActionPacketTemplateArtifact).toBe(
        "r1150-fillable-ordinary-consumer-safe-availability-confirmation.json",
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyTemplateArtifact).toBe(
        "r1150-fillable-feature-only-safe-availability-confirmation.json",
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofArtifact).toBe(
        "r1155-ordinary-consumer-safe-confirmation-feature-only-smoke-proof.latest.json",
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofConclusion).toBe(
        "ordinary_safe_confirmation_feature_only_smoke_passed_non_evidence",
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofNextAction).toBe(
        "use_r1150_r1153_path_with_real_safe_availability_confirmation",
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofFeatureOnlyChainConclusion)
        .toBe("ordinary_feature_only_chain_ready_research_only");
      expect(
        output.nextLoop
          .consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofFeatureOnlyCoverageContextReadyForResearchPlanning,
      ).toBe(true);
      expect(
        output.nextLoop.consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofSafeAvailabilityConfirmationConclusion,
      ).toBe("safe_availability_confirmation_feature_only_ready_research_only");
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofReadyForRecipeReadinessChain)
        .toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofModelEvidencePromotionAllowed)
        .toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofRowLevelDataAcceptedByR1155)
        .toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofSmokeEvidence).toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationHandoffCommand).toBe(
        R1156_SAFE_CONFIRMATION_HANDOFF_COMMAND,
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationChainRunnerArtifact).toBe(
        "r1157-ordinary-consumer-safe-confirmation-chain-runner.latest.json",
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationChainRunnerCommand).toBe(
        R1157_SAFE_CONFIRMATION_CHAIN_RUNNER_COMMAND,
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationChainRunnerConclusion).toBe(
        "ordinary_safe_confirmation_chain_waiting_on_safe_confirmation",
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationChainRunnerNextAction).toBe(
        "fill_safe_availability_confirmation_from_template",
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationChainRunnerConfirmationPathConfigured)
        .toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationChainRunnerFeatureOnlyCoverageContextReady)
        .toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationChainRunnerFeatureOnlyResearchPlanningReady)
        .toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationChainRunnerReadyForModelEvidence).toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationChainRunnerReadyForRecipeReadinessChain)
        .toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationChainRunnerRowLevelDataAcceptedByR1157)
        .toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationChainRunnerSafeConfirmationStillRequired)
        .toBe(true);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationFillGuideArtifact).toBe(
        "r1158-ordinary-consumer-safe-confirmation-fill-guide.latest.json",
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationFillGuideCommand).toBe(
        R1158_SAFE_CONFIRMATION_FILL_GUIDE_COMMAND,
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationFillGuideConclusion).toBe(
        "ordinary_safe_confirmation_fill_guide_ready_non_evidence",
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationFillGuideNextAction).toBe(
        "fill_safe_availability_confirmation_from_template",
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationFillGuideGuideReadyForRowOwnerFill)
        .toBe(true);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationFillGuideExactSafeFieldEditCount)
        .toBe(R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationFillGuideMinimumFeaturePairRequired)
        .toEqual(FEATURE_ONLY_SOURCE_FAMILY_IDS);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationFillGuideOptionalAddOnFamilyIds)
        .toEqual(FEATURE_ONLY_FILL_GUIDE_OPTIONAL_ADD_ON_FAMILY_IDS);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationFillGuideRequiredChecklistIds)
        .toEqual(FEATURE_ONLY_FILL_GUIDE_CHECKLIST_IDS);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationFillGuideRequiredInputKindIds)
        .toEqual(FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationFillGuideRowLevelDataAcceptedByR1158)
        .toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationAnswerSheetArtifact).toBe(
        "r1159-ordinary-consumer-safe-confirmation-answer-sheet.latest.json",
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationAnswerSheetCommand).toBe(
        R1159_SAFE_CONFIRMATION_ANSWER_SHEET_COMMAND,
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationAnswerSheetConclusion).toBe(
        "ordinary_safe_confirmation_answer_sheet_ready_non_evidence",
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationAnswerSheetNextAction).toBe(
        R1159_ANSWER_SHEET_NEXT_ACTION,
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationAnswerSheetReadyForRowOwner).toBe(true);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationAnswerSheetExactSafeAnswerCount)
        .toBe(R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationAnswerSheetMinimumFeaturePairRequired)
        .toEqual(FEATURE_ONLY_SOURCE_FAMILY_IDS);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationAnswerSheetOptionalAddOnFamilyIds)
        .toEqual(FEATURE_ONLY_FILL_GUIDE_OPTIONAL_ADD_ON_FAMILY_IDS);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationAnswerSheetRequiredChecklistIds)
        .toEqual(FEATURE_ONLY_FILL_GUIDE_CHECKLIST_IDS);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationAnswerSheetRequiredInputKindIds)
        .toEqual(FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationAnswerSheetRowLevelDataAcceptedByR1159)
        .toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationAnswerSheetRowOwnerProvidedValuesStored)
        .toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationTranscriptionProofArtifact).toBe(
        "r1160-r1159-feature-only-safe-confirmation-transcription-proof.latest.json",
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationTranscriptionProofCommand).toBe(
        R1160_TRANSCRIPTION_PROOF_COMMAND,
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationTranscriptionProofConclusion).toBe(
        "r1159_feature_only_safe_confirmation_transcription_ready_non_evidence",
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationTranscriptionProofExactSafeTranscriptionStepCount)
        .toBe(R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationTranscriptionProofReadyForRowOwnerConfirmation)
        .toBe(true);
      expect(
        output.nextLoop
          .consumerAverageSubmitterSafeConfirmationTranscriptionProofHypotheticalTranscriptionWouldBeFeatureOnlyReady,
      ).toBe(true);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationTranscriptionProofNextAction).toBe(
        R1160_TRANSCRIPTION_PROOF_NEXT_ACTION,
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationTranscriptionProofRequiredInputKindIds)
        .toEqual(FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationTranscriptionProofRowLevelDataAcceptedByR1160)
        .toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationTranscriptionProofRowOwnerConfirmationStillRequired)
        .toBe(true);
      expect(
        output.nextLoop.consumerAverageSubmitterSafeConfirmationTranscriptionProofConfirmationValuesStoredByR1160,
      ).toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationTranscriptionProofRowOwnerProvidedValuesStored)
        .toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationMaterializerArtifact).toBe(
        "r1161-feature-only-safe-availability-confirmation-materializer.latest.json",
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationMaterializerCommand).toBe(
        R1161_MATERIALIZER_COMMAND,
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationMaterializerConclusion).toBe(
        "feature_only_safe_availability_confirmation_materializer_waiting_on_explicit_row_owner_confirmation",
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationMaterializerNextAction).toBe(
        R1161_MATERIALIZER_NEXT_ACTION,
      );
      expect(
        output.nextLoop
          .consumerAverageSubmitterSafeConfirmationMaterializerExplicitRowOwnerConfirmationAssertionProvided,
      ).toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationMaterializerSafeConfirmationArtifactWritten)
        .toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationMaterializerSafeConfirmationArtifact).toBeNull();
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationMaterializerFeatureOnlyConfirmationWouldBeReadyForR1150)
        .toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationMaterializerRowOwnerConfirmationStillRequired)
        .toBe(true);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationMaterializerConfirmationValuesStoredInR1161Packet)
        .toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationMaterializerRowLevelDataAcceptedByR1161)
        .toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterSafeConfirmationMaterializerRowOwnerPrivateValuesStored)
        .toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlyModeArtifact).toBe(
        "r1151-ordinary-consumer-feature-only-submission-mode.latest.json",
      );
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlyModeConclusion).toBe(
        "ordinary_feature_only_mode_waiting_on_safe_availability_confirmation",
      );
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlyModeNextAction).toBe(
        "fill_safe_availability_confirmation_from_template",
      );
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlyModeCoverageContextAllowed).toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlyModeCoverageRequiresPreferredPair).toBe(true);
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlyModeMinimumFeaturePairRequired)
        .toEqual(FEATURE_ONLY_SOURCE_FAMILY_IDS);
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlyModeOutcomeLinkageRequiredForFeatureOnlyContext)
        .toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlyModeSafeAvailabilityFeatureOnlyCoverageContextReady)
        .toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlyModeSafeAvailabilityFeatureOnlyReadinessPresent)
        .toBe(true);
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlyModeRowLevelDataAcceptedByR1151).toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlyModeModelEvidencePromotionAllowed).toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlyModeMissingPrimaryFeatureFamilyIds).toEqual([
        "bloodwork_glycemia",
        "wearable_activity_daily",
      ]);
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlyModeMissingEvidenceSourceFamilyIds).toEqual([
        "outcome_linkage",
        "join_time_alignment",
      ]);
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlyModeSupportedFeatureFamilyIds).toEqual([]);
      expect(output.nextLoop.nextAction).toBe(R1161_MATERIALIZER_NEXT_ACTION);
      expect(output.nextLoop.routerNextAction).toBe("fill_consumer_first_pass_aggregate_metrics_template");
      expect(output.nextLoop.commands.join("\n")).toContain("r1124-fillable consumer first-pass aggregate metrics template");
      expect(output.nextLoop.commands.join("\n")).toContain("r1127-fillable ordinary consumer first-pass submission plan");
      expect(output.nextLoop.commands.join("\n")).toContain("r1130-ordinary-consumer-real-evidence-handoff.ts");
      expect(output.nextLoop.commands.join("\n")).toContain("r1132-ordinary-consumer-submission-readiness.ts");
      expect(output.nextLoop.commands.join("\n")).toContain(
        "r1133-ordinary-consumer-data-availability-preflight.ts",
      );
      expect(output.nextLoop.commands.join("\n")).toContain(
        "r1134-ordinary-consumer-availability-config-bridge.ts",
      );
      expect(output.nextLoop.commands.join("\n")).toContain(
        "r1135-ordinary-consumer-availability-manifest-packet.ts",
      );
      expect(output.nextLoop.commands.join("\n")).toContain(
        "r1143-ordinary-consumer-availability-manifest-recipe-materializer.ts",
      );
      expect(output.nextLoop.commands.join("\n")).toContain(
        "r1144-ordinary-consumer-recipe-readiness-chain-runner.ts",
      );
      expect(output.nextLoop.commands.join("\n")).toContain(
        "r1136-ordinary-consumer-availability-chain-runner.ts",
      );
      expect(output.nextLoop.commands.join("\n")).toContain(
        "r1137-ordinary-consumer-partial-route-planner.ts",
      );
      expect(output.nextLoop.commands.join("\n")).toContain(
        "r1138-ordinary-consumer-partial-aggregate-metric-intake.ts",
      );
      expect(output.nextLoop.commands.join("\n")).toContain(
        "r1139-ordinary-consumer-partial-private-config-handoff.ts",
      );
      expect(output.nextLoop.commands.join("\n")).toContain(
        "r1140-ordinary-consumer-partial-readiness-chain-runner.ts",
      );
      expect(output.nextLoop.commands.join("\n")).toContain(
        "r1141-ordinary-consumer-partial-private-metric-runner.ts",
      );
      expect(output.nextLoop.commands.join("\n")).toContain(
        "r1142-ordinary-consumer-partial-private-chain-runner.ts",
      );
      expect(output.nextLoop.commands.join("\n")).toContain(
        "r1145-ordinary-consumer-current-chain-completion-audit.ts",
      );
      expect(output.nextLoop.commands.join("\n")).toContain(
        "r1146-ordinary-consumer-row-owner-route-action-packet.ts",
      );
      expect(output.nextLoop.commands.join("\n")).toContain(
        "r1147-ordinary-consumer-post-confirmation-private-config-packet.ts",
      );
      expect(output.nextLoop.commands.join("\n")).toContain(
        "r1148-ordinary-consumer-post-confirmation-private-config-intake.ts",
      );
      expect(output.nextLoop.commands.join("\n")).toContain(
        "r1149-ordinary-consumer-lab-wearable-submission-kit.ts",
      );
      expect(output.nextLoop.commands.join("\n")).toContain(
        "r1150-ordinary-consumer-safe-availability-confirmation-intake.ts",
      );
      expect(output.nextLoop.commands.join("\n")).toContain(
        "r1151-ordinary-consumer-feature-only-submission-mode.ts",
      );
      expect(output.nextLoop.commands.join("\n")).toContain(
        "r1152-ordinary-consumer-feature-only-coverage-context-intake.ts",
      );
      expect(output.nextLoop.commands.join("\n")).toContain(
        "r1153-ordinary-consumer-feature-only-chain-runner.ts",
      );
      expect(output.nextLoop.commands.join("\n")).toContain(
        "r1154-ordinary-consumer-safe-availability-action-packet.ts",
      );
      expect(output.nextLoop.commands).toContain(R1156_SAFE_CONFIRMATION_HANDOFF_COMMAND);
      expect(output.nextLoop.commands.indexOf(R1156_SAFE_CONFIRMATION_HANDOFF_COMMAND)).toBe(
        output.nextLoop.commands.indexOf("pnpm exec tsx scripts/murph-age/r1154-ordinary-consumer-safe-availability-action-packet.ts") + 1,
      );
      expect(output.nextLoop.commands).toContain(R1157_SAFE_CONFIRMATION_CHAIN_RUNNER_COMMAND);
      expect(output.nextLoop.commands.indexOf(R1157_SAFE_CONFIRMATION_CHAIN_RUNNER_COMMAND)).toBe(
        output.nextLoop.commands.indexOf(R1156_SAFE_CONFIRMATION_HANDOFF_COMMAND) + 1,
      );
      expect(output.nextLoop.commands).toContain(R1158_SAFE_CONFIRMATION_FILL_GUIDE_COMMAND);
      expect(output.nextLoop.commands.indexOf(R1158_SAFE_CONFIRMATION_FILL_GUIDE_COMMAND)).toBe(
        output.nextLoop.commands.indexOf(R1157_SAFE_CONFIRMATION_CHAIN_RUNNER_COMMAND) + 1,
      );
      expect(output.nextLoop.commands).toContain(R1159_SAFE_CONFIRMATION_ANSWER_SHEET_COMMAND);
      expect(output.nextLoop.commands.indexOf(R1159_SAFE_CONFIRMATION_ANSWER_SHEET_COMMAND)).toBe(
        output.nextLoop.commands.indexOf(R1158_SAFE_CONFIRMATION_FILL_GUIDE_COMMAND) + 1,
      );
      expect(output.nextLoop.commands).toContain(R1160_TRANSCRIPTION_PROOF_COMMAND);
      expect(output.nextLoop.commands.indexOf(R1160_TRANSCRIPTION_PROOF_COMMAND)).toBe(
        output.nextLoop.commands.indexOf(R1159_SAFE_CONFIRMATION_ANSWER_SHEET_COMMAND) + 1,
      );
      expect(output.nextLoop.commands).toContain(R1161_MATERIALIZER_COMMAND);
      expect(output.nextLoop.commands.indexOf(R1161_MATERIALIZER_COMMAND)).toBe(
        output.nextLoop.commands.indexOf(R1160_TRANSCRIPTION_PROOF_COMMAND) + 1,
      );
      expect(output.nextLoop.commands).toContain(R1162_ASSERTION_HANDOFF_COMMAND);
      expect(output.nextLoop.commands.indexOf(R1162_ASSERTION_HANDOFF_COMMAND)).toBe(
        output.nextLoop.commands.indexOf(R1161_MATERIALIZER_COMMAND) + 1,
      );
      expect(output.nextLoop.commands).toContain(R1163_ASSERTION_TO_RESEARCH_RUNNER_COMMAND);
      expect(output.nextLoop.commands.indexOf(R1163_ASSERTION_TO_RESEARCH_RUNNER_COMMAND)).toBe(
        output.nextLoop.commands.indexOf(R1162_ASSERTION_HANDOFF_COMMAND) + 1,
      );
      expect(output.nextLoop.commands).toContain(R1164_FEATURE_ONLY_RESEARCH_HANDOFF_COMMAND);
      expect(output.nextLoop.commands.indexOf(R1164_FEATURE_ONLY_RESEARCH_HANDOFF_COMMAND)).toBe(
        output.nextLoop.commands.indexOf(R1163_ASSERTION_TO_RESEARCH_RUNNER_COMMAND) + 1,
      );
      expect(output.nextLoop.commands).toContain(R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND);
      expect(output.nextLoop.commands.indexOf(R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND)).toBe(
        output.nextLoop.commands.indexOf(R1164_FEATURE_ONLY_RESEARCH_HANDOFF_COMMAND) + 1,
      );
      expect(output.nextLoop.commands).toContain(R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND);
      expect(output.nextLoop.commands.indexOf(R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND)).toBe(
        output.nextLoop.commands.indexOf(R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND) + 1,
      );
      expect(output.nextLoop.commands).toContain(R1174_SAFE_NEXT_STEP_PACKET_COMMAND);
      expect(output.nextLoop.commands.indexOf(R1174_SAFE_NEXT_STEP_PACKET_COMMAND)).toBe(
        output.nextLoop.commands.indexOf(R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND) + 1,
      );
      expect(output.nextLoop.commands).toContain(R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND);
      expect(output.nextLoop.commands.indexOf(R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND)).toBe(
        output.nextLoop.commands.indexOf(R1174_SAFE_NEXT_STEP_PACKET_COMMAND) + 1,
      );
      expect(output.nextLoop.commands).toContain(R1165_SAFE_ASSERTION_RUNNER_COMMAND);
      expect(output.nextLoop.commands.indexOf(R1165_SAFE_ASSERTION_RUNNER_COMMAND)).toBe(
        output.nextLoop.commands.indexOf(R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND) + 1,
      );
      expect(output.nextLoop.commands).toContain(R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_COMMAND);
      expect(output.nextLoop.commands.indexOf(R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_COMMAND)).toBe(
        output.nextLoop.commands.indexOf(R1165_SAFE_ASSERTION_RUNNER_COMMAND) + 1,
      );
      expect(output.nextLoop.commands).toContain(R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND);
      expect(output.nextLoop.commands.indexOf(R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND)).toBe(
        output.nextLoop.commands.indexOf(R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_COMMAND) + 1,
      );
      expect(output.nextLoop.commands.join("\n")).toContain("MURPH_AGE_CONSUMER_FIRST_PASS_AGGREGATE_METRICS_PATH");
      expect(output.nextLoop.commands.join("\n")).not.toContain("nsrr download");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("surfaces the R1162 assertion handoff when that packet is available", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1076-r1162-"));
    try {
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      const fixtures = await writeFixtures(tmp);
      const r1162Path = path.join(tmp, "r1162.json");
      await Promise.all([
        writeFile(fixtures.r1101Path, `${JSON.stringify(r1101Fixture(
          "consumer_loop_ready_awaiting_aggregate_receipt",
          "fill_r1124_first_pass_aggregate_metrics_template",
        ))}\n`),
        writeFile(r1162Path, `${JSON.stringify(r1162Fixture())}\n`),
      ]);

      const { output } = await runR1076CurrentAutoresearchLoopExecutor({
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
        ...fixtures,
        r1162Path,
      });

      expect(output.summary.nextAction).toBe(R1162_ASSERTION_HANDOFF_NEXT_ACTION);
      expect(output.summary.consumerAverageSubmitterSafeConfirmationAssertionHandoffArtifact).toBe(
        "r1162-feature-only-safe-confirmation-assertion-handoff.latest.json",
      );
      expect(output.summary.consumerAverageSubmitterSafeConfirmationAssertionHandoffCommand).toBe(
        R1162_ASSERTION_HANDOFF_COMMAND,
      );
      expect(output.summary.consumerAverageSubmitterSafeConfirmationAssertionHandoffConclusion).toBe(
        "feature_only_safe_confirmation_assertion_handoff_ready_for_row_owner_assertion",
      );
      expect(output.summary.consumerAverageSubmitterSafeConfirmationAssertionHandoffNextAction).toBe(
        R1162_ASSERTION_HANDOFF_NEXT_ACTION,
      );
      expect(output.summary.consumerAverageSubmitterSafeConfirmationAssertionHandoffRequiredInputKindIds).toEqual(
        FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS,
      );
      expect(output.summary.consumerAverageSubmitterSafeConfirmationAssertionHandoffRequiredChecklistIds).toEqual(
        FEATURE_ONLY_FILL_GUIDE_CHECKLIST_IDS,
      );
      expect(output.summary.consumerAverageSubmitterSafeConfirmationAssertionHandoffMinimumFeaturePairRequired)
        .toEqual(FEATURE_ONLY_SOURCE_FAMILY_IDS);
      expect(output.summary.consumerAverageSubmitterSafeConfirmationAssertionHandoffRowLevelDataAcceptedByR1162)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterSafeConfirmationAssertionHandoffRowOwnerPrivateValuesStored)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterSafeConfirmationMaterializerNextAction).toBe(
        R1161_MATERIALIZER_NEXT_ACTION,
      );
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("surfaces the R1163 assertion-to-research runner when that packet is available", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1076-r1163-"));
    try {
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      const fixtures = await writeFixtures(tmp);
      const r1162Path = path.join(tmp, "r1162.json");
      const r1163Path = path.join(tmp, "r1163.json");
      const r1165Path = path.join(tmp, "missing-r1165.json");
      const r1172Path = path.join(tmp, "r1172.json");
      const r1173Path = path.join(tmp, "r1173.json");
      await Promise.all([
        writeFile(fixtures.r1101Path, `${JSON.stringify(r1101Fixture(
          "consumer_loop_ready_awaiting_aggregate_receipt",
          "fill_r1124_first_pass_aggregate_metrics_template",
        ))}\n`),
        writeFile(r1162Path, `${JSON.stringify(r1162Fixture())}\n`),
        writeFile(r1163Path, `${JSON.stringify(r1163Fixture())}\n`),
        writeFile(r1172Path, `${JSON.stringify(r1172Fixture())}\n`),
        writeFile(r1173Path, `${JSON.stringify(r1173Fixture())}\n`),
      ]);

      const { output } = await runR1076CurrentAutoresearchLoopExecutor({
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
        ...fixtures,
        r1162Path,
        r1163Path,
        r1165Path,
        r1172Path,
        r1173Path,
      });

      expect(output.summary.nextAction).toBe(R1172_SAFE_ASSERTION_MATERIALIZER_NEXT_ACTION);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerNextAction).toBe(
        R1172_SAFE_ASSERTION_MATERIALIZER_NEXT_ACTION,
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerRowOwnerAssertionStillRequired)
        .toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerArtifact).toBe(
        "r1163-feature-only-safe-confirmation-to-research-runner.latest.json",
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerCommand).toBe(
        R1163_ASSERTION_TO_RESEARCH_RUNNER_COMMAND,
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerConclusion).toBe(
        "feature_only_safe_confirmation_to_research_runner_waiting_on_row_owner_assertion",
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerNextAction).toBe(
        R1163_ASSERTION_RUNNER_NEXT_ACTION,
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerFeatureOnlyResearchPlanningReady)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerFeatureOnlyChainRan)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerRowOwnerAssertionStillRequired)
        .toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerRowLevelDataAcceptedByR1163)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeConfirmationResearchRunnerRowOwnerPrivateValuesStored)
        .toBe(false);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("surfaces the R1164 feature-only research handoff when available", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1076-r1164-"));
    try {
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      const fixtures = await writeFixtures(tmp);
      const r1162Path = path.join(tmp, "r1162.json");
      const r1163Path = path.join(tmp, "r1163.json");
      const r1164Path = path.join(tmp, "r1164.json");
      const r1165Path = path.join(tmp, "missing-r1165.json");
      const r1172Path = path.join(tmp, "r1172.json");
      const r1173Path = path.join(tmp, "r1173.json");
      await Promise.all([
        writeFile(fixtures.r1101Path, `${JSON.stringify(r1101Fixture(
          "consumer_loop_ready_awaiting_aggregate_receipt",
          "fill_r1124_first_pass_aggregate_metrics_template",
        ))}\n`),
        writeFile(r1162Path, `${JSON.stringify(r1162Fixture())}\n`),
        writeFile(r1163Path, `${JSON.stringify(r1163Fixture())}\n`),
        writeFile(r1164Path, `${JSON.stringify(r1164Fixture())}\n`),
        writeFile(r1172Path, `${JSON.stringify(r1172Fixture())}\n`),
        writeFile(r1173Path, `${JSON.stringify(r1173Fixture())}\n`),
      ]);

      const { output } = await runR1076CurrentAutoresearchLoopExecutor({
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
        ...fixtures,
        r1162Path,
        r1163Path,
        r1164Path,
        r1165Path,
        r1172Path,
        r1173Path,
      });

      expect(output.summary.nextAction).toBe(R1172_SAFE_ASSERTION_MATERIALIZER_NEXT_ACTION);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerNextAction).toBe(
        R1172_SAFE_ASSERTION_MATERIALIZER_NEXT_ACTION,
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerRowOwnerAssertionStillRequired)
        .toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyResearchHandoffArtifact).toBe(
        "r1164-ordinary-consumer-feature-only-research-handoff.latest.json",
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlyResearchHandoffCommand).toBe(
        R1164_FEATURE_ONLY_RESEARCH_HANDOFF_COMMAND,
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlyResearchHandoffConclusion).toBe(
        "ordinary_feature_only_research_handoff_waiting_on_row_owner_assertion",
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlyResearchHandoffNextAction).toBe(
        R1164_FEATURE_ONLY_HANDOFF_NEXT_ACTION,
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlyResearchHandoffFeatureOnlyResearchPlanningReady)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyResearchHandoffResearchPlanningAllowed)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyResearchHandoffOutcomeLinkedModelEvidenceStillRequired)
        .toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyResearchHandoffPrioritizedInputKindIds)
        .toEqual(FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyResearchHandoffMinimumFeaturePairRequired)
        .toEqual(FEATURE_ONLY_SOURCE_FAMILY_IDS);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyResearchHandoffRowLevelDataAcceptedByR1164)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyResearchHandoffRowOwnerPrivateValuesStored)
        .toBe(false);
      expect(output.nextLoop.commands).toContain(R1164_FEATURE_ONLY_RESEARCH_HANDOFF_COMMAND);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("surfaces the R1165 safe assertion runner when available", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1076-r1165-"));
    try {
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      const fixtures = await writeFixtures(tmp);
      const r1162Path = path.join(tmp, "r1162.json");
      const r1163Path = path.join(tmp, "r1163.json");
      const r1164Path = path.join(tmp, "r1164.json");
      const r1165Path = path.join(tmp, "r1165.json");
      const r1167Path = path.join(tmp, "r1167.json");
      const r1145Path = path.join(tmp, "r1145.json");
      const r1170Path = path.join(tmp, "r1170.json");
      const r1172Path = path.join(tmp, "r1172.json");
      const r1173Path = path.join(tmp, "r1173.json");
      const r1174Path = path.join(tmp, "r1174.json");
      const r1175Path = path.join(tmp, "r1175.json");
      const r1176Path = path.join(tmp, "r1176.json");
      const r1185Path = path.join(tmp, "r1185.json");
      await Promise.all([
        writeFile(fixtures.r1101Path, `${JSON.stringify(r1101Fixture(
          "consumer_loop_ready_awaiting_aggregate_receipt",
          "fill_r1124_first_pass_aggregate_metrics_template",
        ))}\n`),
        writeFile(r1162Path, `${JSON.stringify(r1162Fixture())}\n`),
        writeFile(r1163Path, `${JSON.stringify(r1163Fixture())}\n`),
        writeFile(r1164Path, `${JSON.stringify(r1164Fixture())}\n`),
        writeFile(r1165Path, `${JSON.stringify(r1165Fixture())}\n`),
        writeFile(r1167Path, `${JSON.stringify(r1167Fixture())}\n`),
        writeFile(r1145Path, `${JSON.stringify(r1145Fixture())}\n`),
        writeFile(r1170Path, `${JSON.stringify(r1170Fixture())}\n`),
        writeFile(r1172Path, `${JSON.stringify(r1172Fixture())}\n`),
        writeFile(r1173Path, `${JSON.stringify(r1173Fixture())}\n`),
        writeFile(r1174Path, `${JSON.stringify(r1174Fixture())}\n`),
        writeFile(r1175Path, `${JSON.stringify(r1175Fixture())}\n`),
        writeFile(r1176Path, `${JSON.stringify(r1176Fixture())}\n`),
        writeFile(r1185Path, `${JSON.stringify(r1185Fixture())}\n`),
      ]);

      const { output } = await runR1076CurrentAutoresearchLoopExecutor({
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
        ...fixtures,
        r1162Path,
        r1163Path,
        r1164Path,
        r1165Path,
        r1167Path,
        r1145Path,
        r1170Path,
        r1172Path,
        r1173Path,
        r1174Path,
        r1175Path,
        r1176Path,
        r1185Path,
      });

      expect(output.summary.nextAction).toBe(R1176_SAFE_ASSERTION_LIVE_CHAIN_NEXT_ACTION);
      expect(output.summary.consumerAverageSubmitterCompletionAuditArtifact).toBe(
        "r1145-ordinary-consumer-current-chain-completion-audit.latest.json",
      );
      expect(output.summary.consumerAverageSubmitterCompletionAuditConclusion).toBe(
        "ordinary_consumer_current_chain_completion_audit_blocked_on_row_owner_route_evidence",
      );
      expect(output.summary.consumerAverageSubmitterCompletionAuditNextAction).toBe(
        R1176_SAFE_ASSERTION_LIVE_CHAIN_NEXT_ACTION,
      );
      expect(output.summary.consumerAverageSubmitterCompletionAuditGoalAchieved).toBe(false);
      expect(output.summary.consumerAverageSubmitterCompletionAuditReadyToMarkComplete).toBe(false);
      expect(output.summary.consumerAverageSubmitterCompletionAuditTopMissingRequirement).toBe(
        "row_owner_availability_assertions_confirmed",
      );
      expect(output.summary.consumerAverageSubmitterCompletionAuditMissingRequirementIds)
        .toEqual(R1145_MISSING_REQUIREMENT_IDS);
      expect(output.summary.consumerAverageSubmitterCompletionAuditBlockers).toEqual(R1146_BLOCKERS);
      expect(output.summary.consumerAverageSubmitterCompletionAuditUnblockerBlockedRequirementIds)
        .toEqual(R1145_MISSING_REQUIREMENT_IDS);
      expect(output.summary.consumerAverageSubmitterCompletionAuditUnblockerBlockedStepIds)
        .toEqual(R1145_UNBLOCKER_STEP_IDS);
      expect(output.summary.consumerAverageSubmitterCompletionAuditUnblockerCommandCount).toBe(4);
      expect(output.summary.consumerAverageSubmitterCompletionAuditUnblockerStepIds)
        .toEqual(R1145_UNBLOCKER_STEP_IDS);
      expect(output.summary.consumerAverageSubmitterCompletionAuditUnblockerTopAllowedValueKindIds)
        .toEqual(R1145_UNBLOCKER_ALLOWED_VALUE_KIND_IDS);
      expect(output.summary.consumerAverageSubmitterCompletionAuditUnblockerTopBlockedContentIds)
        .toEqual(R1145_UNBLOCKER_BLOCKED_CONTENT_IDS);
      expect(output.summary.consumerAverageSubmitterCompletionAuditUnblockerTopCommand)
        .toBe(R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND);
      expect(output.summary.consumerAverageSubmitterCompletionAuditUnblockerTopNextAction)
        .toBe(R1176_SAFE_ASSERTION_LIVE_CHAIN_NEXT_ACTION);
      expect(output.summary.consumerAverageSubmitterCompletionAuditUnblockerTopRequirementId)
        .toBe("row_owner_availability_assertions_confirmed");
      expect(output.summary.consumerAverageSubmitterCompletionAuditUnblockerTopRequiredInputKindIds)
        .toEqual(FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS);
      expect(output.summary.consumerAverageSubmitterCompletionAuditUnblockerTopSafeCompletionChecklistItemIds)
        .toEqual(FEATURE_ONLY_FILL_GUIDE_CHECKLIST_IDS);
      expect(output.summary.consumerAverageSubmitterCompletionAuditUnblockerTopStepId)
        .toBe("confirm_feature_only_lab_wearable_safe_availability");
      expect(output.summary.consumerAverageSubmitterCompletionAuditProductDisplayAuthorized).toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterCompletionAuditMissingRequirementIds)
        .toEqual(R1145_MISSING_REQUIREMENT_IDS);
      expect(output.nextLoop.consumerAverageSubmitterCompletionAuditBlockers).toEqual(R1146_BLOCKERS);
      expect(output.nextLoop.consumerAverageSubmitterCompletionAuditUnblockerStepIds)
        .toEqual(R1145_UNBLOCKER_STEP_IDS);
      expect(output.nextLoop.consumerAverageSubmitterCompletionAuditUnblockerTopRequiredInputKindIds)
        .toEqual(FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS);
      expect(output.nextLoop.consumerAverageSubmitterCompletionAuditUnblockerTopSafeCompletionChecklistItemIds)
        .toEqual(FEATURE_ONLY_FILL_GUIDE_CHECKLIST_IDS);
      expect(output.nextLoop.consumerAverageSubmitterCompletionAuditUnblockerTopStepId)
        .toBe("confirm_feature_only_lab_wearable_safe_availability");
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerArtifact).toBe(
        "r1165-ordinary-consumer-feature-only-safe-assertion-runner.latest.json",
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerCommand).toBe(
        R1165_SAFE_ASSERTION_RUNNER_COMMAND,
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerConclusion).toBe(
        "ordinary_feature_only_safe_assertion_runner_waiting_on_assertion_file",
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerNextAction).toBe(
        R1165_SAFE_ASSERTION_RUNNER_NEXT_ACTION,
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerAssertionAccepted)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerAssertionProvided)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerAssertionTemplateArtifact)
        .toBe("r1165-row-owner-feature-only-safe-assertion.template.json");
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerChildR1163Ran)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerFeatureOnlyResearchPlanningReady)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerRequiredInputKindIds)
        .toEqual(FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerRequiredAssertionChecklistIds)
        .toEqual([
          "assert_target_age_band_roughly_16_50",
          "assert_glycemia_bloodwork_export_available",
          "assert_daily_wearable_activity_export_available",
          "assert_no_private_values_identifiers_paths_headers_or_rows",
        ]);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerOptionalAddOnFamilyIds)
        .toEqual(FEATURE_ONLY_FILL_GUIDE_OPTIONAL_ADD_ON_FAMILY_IDS);
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerOptionalAddOnFamilyIds)
        .toEqual(FEATURE_ONLY_FILL_GUIDE_OPTIONAL_ADD_ON_FAMILY_IDS);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerValidationReasonIds)
        .toEqual(["assertion_file_missing"]);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerRowLevelDataAcceptedByR1165)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionRunnerRowOwnerPrivateValuesStored)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideArtifact).toBe(
        "r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide.latest.json",
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideCommand).toBe(
        R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND,
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideConclusion).toBe(
        "ordinary_feature_only_safe_assertion_fill_guide_ready",
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideNextAction).toBe(
        R1165_SAFE_ASSERTION_RUNNER_NEXT_ACTION,
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideGuideReadyForRowOwnerFill)
        .toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideRequiredInputKindIds)
        .toEqual(FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideOptionalAddOnFamilyIds)
        .toEqual(FEATURE_ONLY_FILL_GUIDE_OPTIONAL_ADD_ON_FAMILY_IDS);
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideOptionalAddOnFamilyIds)
        .toEqual(FEATURE_ONLY_FILL_GUIDE_OPTIONAL_ADD_ON_FAMILY_IDS);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideSafeFieldEditCount)
        .toBe(FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS.length);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideSafeFieldEditPaths)
        .toEqual(FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS);
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideSafeFieldEditPaths)
        .toEqual(FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideRowLevelDataAcceptedByR1167)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionFillGuideRowOwnerPrivateValuesStored)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetArtifact).toBe(
        "r1173-ordinary-consumer-safe-assertion-answer-sheet.latest.json",
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetCommand).toBe(
        R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND,
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetConclusion).toBe(
        "ordinary_safe_assertion_answer_sheet_ready_non_evidence",
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetNextAction).toBe(
        R1172_SAFE_ASSERTION_MATERIALIZER_NEXT_ACTION,
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetReadyForRowOwner).toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetMaterializerReady).toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetMaterializerExplicitConfirmationRequired)
        .toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetExactSafeAnswerCount)
        .toBe(FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS.length);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetAllowedValueKindIds)
        .toEqual(R1145_UNBLOCKER_ALLOWED_VALUE_KIND_IDS);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetBlockedAssertionContentIds)
        .toEqual(R1145_UNBLOCKER_BLOCKED_CONTENT_IDS);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetRequiredInputKindIds)
        .toEqual(FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetRequiredAssertionChecklistIds)
        .toEqual(FEATURE_ONLY_SAFE_ASSERTION_CHECKLIST_IDS);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetSafeFieldEditPaths)
        .toEqual(FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetRowLevelDataAcceptedByR1173)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionAnswerSheetRowOwnerProvidedValuesStored)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeNextStepPacketArtifact).toBe(
        "r1174-ordinary-consumer-safe-next-step-packet.latest.json",
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeNextStepPacketCommand).toBe(
        R1174_SAFE_NEXT_STEP_PACKET_COMMAND,
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeNextStepPacketAllowedValueKindIds)
        .toEqual(R1145_UNBLOCKER_ALLOWED_VALUE_KIND_IDS);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeNextStepPacketBlockedContentIds)
        .toEqual(R1145_UNBLOCKER_BLOCKED_CONTENT_IDS);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeNextStepPacketConclusion).toBe(
        "ordinary_safe_next_step_packet_ready_for_row_owner_r1176_live_chain_confirmation",
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeNextStepPacketNextAction).toBe(
        R1176_SAFE_ASSERTION_LIVE_CHAIN_NEXT_ACTION,
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForRowOwnerR1172Confirmation)
        .toBe(true);
      expect(
        output
          .summary
          .consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForRowOwnerR1176LiveChainConfirmation,
      ).toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeNextStepPacketR1176LiveChainCommand).toBe(
        R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
      );
      expect(
        output
          .nextLoop
          .consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForRowOwnerR1176LiveChainConfirmation,
      ).toBe(true);
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlySafeNextStepPacketR1176LiveChainCommand).toBe(
        R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
      );
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlySafeNextStepPacketAllowedValueKindIds)
        .toEqual(R1145_UNBLOCKER_ALLOWED_VALUE_KIND_IDS);
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlySafeNextStepPacketBlockedContentIds)
        .toEqual(R1145_UNBLOCKER_BLOCKED_CONTENT_IDS);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeNextStepPacketReadyForR1165Runner)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeNextStepPacketExactSafeFieldEditCount)
        .toBe(FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS.length);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeNextStepPacketRowLevelDataAcceptedByR1174)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeNextStepPacketRowOwnerProvidedValuesStored)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerArtifact).toBe(
        "r1172-ordinary-consumer-safe-assertion-materializer.latest.json",
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerCommand).toBe(
        R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND,
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerConclusion).toBe(
        "ordinary_consumer_safe_assertion_materializer_waiting_on_explicit_row_owner_assertion",
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerNextAction).toBe(
        R1172_SAFE_ASSERTION_MATERIALIZER_NEXT_ACTION,
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerExplicitRowOwnerAssertionProvided)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerArtifactWritten)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerRowOwnerAssertionStillRequired)
        .toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerWouldBeAcceptedByR1165)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerR1165RunnerReady)
        .toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerR1165TemplateReady)
        .toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerR1167FillGuideReady)
        .toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerAllowedValueKindIds)
        .toEqual(R1145_UNBLOCKER_ALLOWED_VALUE_KIND_IDS);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerBlockedContentIds)
        .toEqual(R1145_UNBLOCKER_BLOCKED_CONTENT_IDS);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerSafeFieldEditCount)
        .toBe(0);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerSafeFieldEditPaths)
        .toEqual(FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS);
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerSafeFieldEditPaths)
        .toEqual(FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS);
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerAllowedValueKindIds)
        .toEqual(R1145_UNBLOCKER_ALLOWED_VALUE_KIND_IDS);
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerBlockedContentIds)
        .toEqual(R1145_UNBLOCKER_BLOCKED_CONTENT_IDS);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerRowLevelDataAcceptedByR1172)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionMaterializerRowOwnerPrivateValuesStored)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofArtifact).toBe(
        "r1170-ordinary-consumer-safe-assertion-smoke-proof.latest.json",
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofCommand).toBe(
        R1170_SAFE_ASSERTION_SMOKE_PROOF_COMMAND,
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofConclusion).toBe(
        "ordinary_safe_assertion_smoke_passed_non_evidence",
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofNextAction).toBe(
        "keep_live_chain_waiting_on_real_r1165_row_owner_safe_assertion",
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofPassed).toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofSynthetic).toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofRealEvidenceProduced)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofModelEvidencePromotionAllowed)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofLiveChainGateStillRequired)
        .toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofR1165AssertionAccepted)
        .toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofR1165ChildR1163Ran)
        .toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofR1165FeatureOnlyResearchPlanningReady)
        .toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofSafeFieldEditCount)
        .toBe(FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS.length);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofSafeFieldEditPaths)
        .toEqual(FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS);
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofSafeFieldEditPaths)
        .toEqual(FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofRowLevelDataAcceptedByR1170)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionSmokeProofRowOwnerPrivateValuesStored)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeArtifact).toBe(
        "r1175-r1172-to-r1165-safe-assertion-bridge-smoke.latest.json",
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeCommand).toBe(
        R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_COMMAND,
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeAllowedValueKindIds)
        .toEqual(R1145_UNBLOCKER_ALLOWED_VALUE_KIND_IDS);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeBlockedContentIds)
        .toEqual(R1145_UNBLOCKER_BLOCKED_CONTENT_IDS);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeOptionalAddOnFamilyIds)
        .toEqual(FEATURE_ONLY_FILL_GUIDE_OPTIONAL_ADD_ON_FAMILY_IDS);
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeAllowedValueKindIds)
        .toEqual(R1145_UNBLOCKER_ALLOWED_VALUE_KIND_IDS);
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeBlockedContentIds)
        .toEqual(R1145_UNBLOCKER_BLOCKED_CONTENT_IDS);
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeOptionalAddOnFamilyIds)
        .toEqual(FEATURE_ONLY_FILL_GUIDE_OPTIONAL_ADD_ON_FAMILY_IDS);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeConclusion).toBe(
        "r1172_to_r1165_safe_assertion_bridge_smoke_passed_non_evidence",
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeNextAction).toBe(
        "keep_live_chain_waiting_on_explicit_row_owner_r1172_confirmation",
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokePassed).toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeSynthetic).toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeRealEvidenceProduced)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeModelEvidencePromotionAllowed)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeLiveChainGateStillRequired)
        .toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1172MaterializedAssertionWritten)
        .toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1172WouldBeAcceptedByR1165)
        .toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1165AssertionAccepted)
        .toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1165ChildR1163Ran)
        .toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1165FeatureOnlyResearchPlanningReady)
        .toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeR1163FeatureOnlyResearchPlanningReady)
        .toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeSafeFieldEditCount)
        .toBe(FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS.length);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeSafeFieldEditPaths)
        .toEqual(FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS);
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeSafeFieldEditPaths)
        .toEqual(FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeRowLevelDataAcceptedByR1175)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeRowOwnerPrivateValuesStored)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionBridgeSmokeRowParsingPerformedByR1175)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainArtifact).toBe(
        "r1176-r1172-r1165-row-owner-safe-assertion-chain-runner.latest.json",
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainCommand).toBe(
        R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainCompletionModeId)
        .toBe(FEATURE_ONLY_SAFE_COMPLETION_MODE_ID);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainConclusion).toBe(
        "row_owner_safe_assertion_chain_waiting_on_explicit_confirmation",
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainNextAction).toBe(
        R1176_SAFE_ASSERTION_LIVE_CHAIN_NEXT_ACTION,
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainReady).toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainExplicitRowOwnerAssertionProvided)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainFeatureOnlyResearchPlanningReady)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRealEvidenceProduced)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainModelEvidencePromotionAllowed)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainOutcomeLinkedModelEvidenceStillRequired)
        .toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowOwnerAssertionStillRequired)
        .toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowOwnerHandoffReasonId)
        .toBe(R1176_ROW_OWNER_HANDOFF_REASON_ID);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1172MaterializedAssertionWritten)
        .toBeNull();
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1172WouldBeAcceptedByR1165)
        .toBeNull();
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1165AssertionAccepted)
        .toBeNull();
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1165ChildR1163Ran)
        .toBeNull();
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1165FeatureOnlyResearchPlanningReady)
        .toBeNull();
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainR1163FeatureOnlyResearchPlanningReady)
        .toBeNull();
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainSafeFieldEditCount)
        .toBe(FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS.length);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainSafeFieldEditPaths)
        .toEqual(FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainAllowedValueKindIds)
        .toEqual(R1145_UNBLOCKER_ALLOWED_VALUE_KIND_IDS);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainBlockedContentIds)
        .toEqual(R1145_UNBLOCKER_BLOCKED_CONTENT_IDS);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainOptionalAddOnFamilyIds)
        .toEqual(FEATURE_ONLY_FILL_GUIDE_OPTIONAL_ADD_ON_FAMILY_IDS);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainSafeCompletionChecklistItemIds)
        .toEqual(FEATURE_ONLY_SAFE_COMPLETION_CHECK_IDS);
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainSafeFieldEditPaths)
        .toEqual(FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS);
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainAllowedValueKindIds)
        .toEqual(R1145_UNBLOCKER_ALLOWED_VALUE_KIND_IDS);
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainBlockedContentIds)
        .toEqual(R1145_UNBLOCKER_BLOCKED_CONTENT_IDS);
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainOptionalAddOnFamilyIds)
        .toEqual(FEATURE_ONLY_FILL_GUIDE_OPTIONAL_ADD_ON_FAMILY_IDS);
      expect(output.nextLoop.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainSafeCompletionChecklistItemIds)
        .toEqual(FEATURE_ONLY_SAFE_COMPLETION_CHECK_IDS);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowLevelDataAcceptedByR1176)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowOwnerPrivateValuesStored)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlySafeAssertionLiveChainRowParsingPerformedByR1176)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterSafeResponseSmokeProofArtifact).toBe(
        "r1185-average-submitter-safe-response-smoke-proof.latest.json",
      );
      expect(output.summary.consumerAverageSubmitterSafeResponseSmokeProofCommand).toBe(
        R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_COMMAND,
      );
      expect(output.summary.consumerAverageSubmitterSafeResponseSmokeProofConclusion).toBe(
        "average_submitter_safe_response_smoke_passed_non_evidence",
      );
      expect(output.summary.consumerAverageSubmitterSafeResponseSmokeProofLiveR1184Conclusion).toBe(
        "average_submitter_safe_response_chain_waiting_on_row_owner_confirmation",
      );
      expect(output.summary.consumerAverageSubmitterSafeResponseSmokeProofLiveR1184ReadyForSyntheticSmoke)
        .toBe(true);
      expect(output.summary.consumerAverageSubmitterSafeResponseSmokeProofNextRealAction).toBe(
        R1185_SAFE_RESPONSE_NEXT_REAL_ACTION,
      );
      expect(output.summary.consumerAverageSubmitterSafeResponseSmokeProofNextRealActionCommand).toBe(
        R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND,
      );
      expect(
        output.summary.consumerAverageSubmitterSafeResponseSmokeProofNextRealActionRequiresExplicitRowOwnerAssertion,
      ).toBe(true);
      expect(output.summary.consumerAverageSubmitterSafeResponseSmokeProofMinimumFeaturePairRequired)
        .toEqual(FEATURE_ONLY_SOURCE_FAMILY_IDS);
      expect(output.summary.consumerAverageSubmitterSafeResponseSmokeProofPrioritizedInputKindIds)
        .toEqual(FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS);
      expect(output.summary.consumerAverageSubmitterSafeResponseSmokeProofRequiredResponseFieldIds).toEqual([
        "confirm_target_age_band_roughly_16_50",
        "confirm_glycemia_bloodwork_export_available",
        "confirm_daily_wearable_activity_export_available",
        "confirm_no_private_values_in_confirmation",
      ]);
      expect(output.summary.consumerAverageSubmitterSafeResponseSmokeProofSafeExecutionFeatureSlotIds).toEqual([
        "glycemia_lab_presence",
        "glycemia_measurement_date_presence",
        "daily_activity_presence",
        "daily_wear_coverage_presence",
      ]);
      expect(
        output.summary.consumerAverageSubmitterSafeResponseSmokeProofSyntheticPathAdvancedToFeatureOnlyResearchPlanning,
      ).toBe(true);
      expect(output.summary.consumerAverageSubmitterSafeResponseSmokeProofSyntheticSmokeRan).toBe(true);
      expect(output.summary.consumerAverageSubmitterSafeResponseSmokeProofModelEvidencePromotionAllowed)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterSafeResponseSmokeProofProductDisplayAuthorized).toBe(false);
      expect(output.summary.consumerAverageSubmitterSafeResponseSmokeProofRowLevelDataAcceptedByR1185).toBe(false);
      expect(output.summary.consumerAverageSubmitterSafeResponseSmokeProofRowOwnerConfirmationInferredByR1185)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterSafeResponseSmokeProofRowOwnerPrivateValuesStored).toBe(false);
      expect(output.summary.consumerAverageSubmitterSafeResponseSmokeProofRowParsingPerformedByR1185).toBe(false);
      expect(output.summary.consumerAverageSubmitterSafeResponseSmokeProofLiveArtifactsMutatedByR1185).toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterSafeResponseSmokeProofNextRealAction).toBe(
        R1185_SAFE_RESPONSE_NEXT_REAL_ACTION,
      );
      expect(output.nextLoop.consumerAverageSubmitterSafeResponseSmokeProofRequiredResponseFieldIds).toEqual([
        "confirm_target_age_band_roughly_16_50",
        "confirm_glycemia_bloodwork_export_available",
        "confirm_daily_wearable_activity_export_available",
        "confirm_no_private_values_in_confirmation",
      ]);
      expect(output.nextLoop.commands).toContain(R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND);
      expect(output.nextLoop.commands).toContain(R1174_SAFE_NEXT_STEP_PACKET_COMMAND);
      expect(output.nextLoop.commands.indexOf(R1174_SAFE_NEXT_STEP_PACKET_COMMAND)).toBe(
        output.nextLoop.commands.indexOf(R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND) + 1,
      );
      expect(output.nextLoop.commands).toContain(R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND);
      expect(output.nextLoop.commands.indexOf(R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND)).toBe(
        output.nextLoop.commands.indexOf(R1174_SAFE_NEXT_STEP_PACKET_COMMAND) + 1,
      );
      expect(output.nextLoop.commands).toContain(R1165_SAFE_ASSERTION_RUNNER_COMMAND);
      expect(output.nextLoop.commands.indexOf(R1165_SAFE_ASSERTION_RUNNER_COMMAND)).toBe(
        output.nextLoop.commands.indexOf(R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND) + 1,
      );
      expect(output.nextLoop.commands).toContain(R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_COMMAND);
      expect(output.nextLoop.commands.indexOf(R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_COMMAND)).toBe(
        output.nextLoop.commands.indexOf(R1165_SAFE_ASSERTION_RUNNER_COMMAND) + 1,
      );
      expect(output.nextLoop.commands).toContain(R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND);
      expect(output.nextLoop.commands.indexOf(R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND)).toBe(
        output.nextLoop.commands.indexOf(R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_COMMAND) + 1,
      );
      expect(output.nextLoop.commands).toContain(R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_COMMAND);
      expect(output.nextLoop.commands.indexOf(R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_COMMAND)).toBe(
        output.nextLoop.commands.indexOf(R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND) + 1,
      );
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("promotes the R1187 route metric readiness safe confirmation action", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1076-r1187-"));
    try {
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      const fixtures = await writeFixtures(tmp);
      await Promise.all([
        writeFile(fixtures.r1101Path, `${JSON.stringify(r1101Fixture(
          "consumer_loop_ready_awaiting_aggregate_receipt",
          "fill_r1124_first_pass_aggregate_metrics_template",
        ))}\n`),
        writeFile(fixtures.r1187Path, `${JSON.stringify(r1187Fixture())}\n`),
      ]);

      const { output } = await runR1076CurrentAutoresearchLoopExecutor({
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
        ...fixtures,
      });

      expect(output.summary.nextAction).toBe("complete_r1186_boolean_only_safe_confirmation_first");
      expect(output.summary.conclusion).toBe("executor_waiting_on_consumer_safe_submission_confirmation");
      expect(output.summary.reviewGptRequiredNow).toBe(false);
      expect(output.summary.consumerAverageSubmitterRouteMetricReadinessArtifact).toBe(
        "r1187-average-submitter-route-metric-readiness.latest.json",
      );
      expect(output.summary.consumerAverageSubmitterRouteMetricReadinessCommand).toBe(
        R1187_AVERAGE_SUBMITTER_ROUTE_METRIC_READINESS_COMMAND,
      );
      expect(output.summary.consumerAverageSubmitterRouteMetricReadinessConclusion).toBe(
        "average_submitter_route_metric_readiness_waiting_on_safe_submission_confirmation",
      );
      expect(output.summary.consumerAverageSubmitterRouteMetricReadinessNextAction).toBe(
        "complete_r1186_boolean_only_safe_confirmation_first",
      );
      expect(output.summary.consumerAverageSubmitterRouteMetricReadinessNextActionCommand).toBe(
        R1187_SAFE_CONFIRMATION_COMMAND,
      );
      expect(output.summary.consumerAverageSubmitterRouteMetricReadinessMinimumFeaturePairRequired)
        .toEqual(FEATURE_ONLY_SOURCE_FAMILY_IDS);
      expect(output.summary.consumerAverageSubmitterRouteMetricReadinessPrioritizedInputKindIds)
        .toEqual(FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS);
      expect(output.summary.consumerAverageSubmitterRouteMetricReadinessFirstPassCandidateIds).toEqual([
        "L1_tiny_glycemia_only",
        "L2_common_lab_core_shadow",
        "W1_activity_steps_minutes",
        "QC_missingness_coverage",
      ]);
      expect(output.summary.consumerAverageSubmitterRouteMetricReadinessAggregateMetricsStillMissing).toBe(true);
      expect(output.summary.consumerAverageSubmitterRouteMetricReadinessPrivateConfigStillRequired).toBe(false);
      expect(output.summary.consumerAverageSubmitterRouteMetricReadinessRealAggregateStillMissing).toBe(true);
      expect(output.summary.consumerAverageSubmitterRouteMetricReadinessRealLabWearableRouteMetricsRecorded)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterRouteMetricReadinessReviewGptRequiredNow).toBe(false);
      expect(output.summary.consumerAverageSubmitterRouteMetricReadinessSafeConfirmationStillRequired).toBe(true);
      expect(output.summary.consumerAverageSubmitterRouteMetricReadinessSafeSubmissionPacketRefreshRequired)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterRouteMetricReadinessModelEvidencePromotionAllowed).toBe(false);
      expect(output.summary.consumerAverageSubmitterRouteMetricReadinessProductDisplayAuthorized).toBe(false);
      expect(output.summary.consumerAverageSubmitterRouteMetricReadinessRowLevelDataAcceptedByR1187).toBe(false);
      expect(output.summary.consumerAverageSubmitterRouteMetricReadinessRowOwnerPrivateValuesStored).toBe(false);
      expect(output.summary.consumerAverageSubmitterRouteMetricReadinessRowParsingPerformedByR1187).toBe(false);
      expect(output.nextLoop.consumerAverageSubmitterRouteMetricReadinessNextAction).toBe(
        "complete_r1186_boolean_only_safe_confirmation_first",
      );
      expect(output.nextLoop.consumerAverageSubmitterRouteMetricReadinessFirstPassCandidateIds).toEqual([
        "L1_tiny_glycemia_only",
        "L2_common_lab_core_shadow",
        "W1_activity_steps_minutes",
        "QC_missingness_coverage",
      ]);
      expect(output.nextLoop.commands).toContain(R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_COMMAND);
      expect(output.nextLoop.commands).toContain(R1187_AVERAGE_SUBMITTER_ROUTE_METRIC_READINESS_COMMAND);
      expect(output.nextLoop.commands.indexOf(R1187_AVERAGE_SUBMITTER_ROUTE_METRIC_READINESS_COMMAND)).toBe(
        output.nextLoop.commands.indexOf(R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_COMMAND) + 1,
      );
      expect(output.nextLoop.commands).toContain(R1187_SAFE_CONFIRMATION_COMMAND);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("falls back to the R1159 answer sheet action when R1160 transcription proof is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1076-r1160-missing-"));
    try {
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      const fixtures = await writeFixtures(tmp);
      await Promise.all([
        rm(fixtures.r1160Path, { force: true }),
        rm(fixtures.r1161Path, { force: true }),
        writeFile(fixtures.r1101Path, `${JSON.stringify(r1101Fixture(
          "consumer_loop_ready_awaiting_aggregate_receipt",
          "fill_r1124_first_pass_aggregate_metrics_template",
        ))}\n`),
      ]);

      const { output } = await runR1076CurrentAutoresearchLoopExecutor({
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
        ...fixtures,
      });

      expect(output.summary.nextAction).toBe(R1159_ANSWER_SHEET_NEXT_ACTION);
      expect(output.summary.consumerAverageSubmitterSafeConfirmationAnswerSheetNextAction).toBe(
        R1159_ANSWER_SHEET_NEXT_ACTION,
      );
      expect(output.summary.consumerAverageSubmitterSafeConfirmationTranscriptionProofArtifact).toBeNull();
      expect(output.summary.consumerAverageSubmitterSafeConfirmationTranscriptionProofCommand).toBeNull();
      expect(output.summary.consumerAverageSubmitterSafeConfirmationTranscriptionProofNextAction).toBeNull();
      expect(output.summary.consumerAverageSubmitterSafeConfirmationTranscriptionProofRequiredInputKindIds).toEqual([]);
      expect(output.summary.consumerAverageSubmitterSafeConfirmationTranscriptionProofReadyForRowOwnerConfirmation)
        .toBeNull();
      expect(output.summary.consumerAverageSubmitterSafeConfirmationMaterializerArtifact).toBeNull();
      expect(output.summary.consumerAverageSubmitterSafeConfirmationMaterializerCommand).toBeNull();
      expect(output.summary.consumerAverageSubmitterSafeConfirmationMaterializerNextAction).toBeNull();
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("falls back to the R1160 row-owner confirmation action when R1161 materializer is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1076-r1161-missing-"));
    try {
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      const fixtures = await writeFixtures(tmp);
      await Promise.all([
        rm(fixtures.r1161Path, { force: true }),
        writeFile(fixtures.r1101Path, `${JSON.stringify(r1101Fixture(
          "consumer_loop_ready_awaiting_aggregate_receipt",
          "fill_r1124_first_pass_aggregate_metrics_template",
        ))}\n`),
      ]);

      const { output } = await runR1076CurrentAutoresearchLoopExecutor({
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
        ...fixtures,
      });

      expect(output.summary.nextAction).toBe(R1160_TRANSCRIPTION_PROOF_NEXT_ACTION);
      expect(output.summary.consumerAverageSubmitterSafeConfirmationTranscriptionProofNextAction).toBe(
        R1160_TRANSCRIPTION_PROOF_NEXT_ACTION,
      );
      expect(output.summary.consumerAverageSubmitterSafeConfirmationMaterializerArtifact).toBeNull();
      expect(output.summary.consumerAverageSubmitterSafeConfirmationMaterializerCommand).toBeNull();
      expect(output.summary.consumerAverageSubmitterSafeConfirmationMaterializerNextAction).toBeNull();
      expect(output.summary.consumerAverageSubmitterSafeConfirmationMaterializerSafeConfirmationArtifactWritten)
        .toBeNull();
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("promotes the R1150 recipe-readiness chain action when safe availability confirmation is ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1076-r1150-ready-"));
    try {
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      const fixtures = await writeFixtures(tmp);
      await Promise.all([
        writeFile(fixtures.r1101Path, `${JSON.stringify(r1101Fixture(
          "consumer_loop_ready_awaiting_aggregate_receipt",
          "fill_r1124_first_pass_aggregate_metrics_template",
        ))}\n`),
        writeFile(fixtures.r1150Path, `${JSON.stringify(r1150Fixture({ ready: true }))}\n`),
        writeFile(fixtures.r1154Path, `${JSON.stringify(r1154Fixture({ ready: true }))}\n`),
      ]);

      const { output } = await runR1076CurrentAutoresearchLoopExecutor({
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
        ...fixtures,
      });

      expect(output.summary.conclusion).toBe("executor_ready_for_consumer_recipe_readiness_chain");
      expect(output.summary.nextAction).toBe("run_r1144_recipe_readiness_chain_with_confirmed_availability");
      expect(output.summary.consumerAverageSubmitterSafeAvailabilityConfirmationConclusion).toBe(
        "safe_availability_confirmation_ready_for_recipe_readiness_chain",
      );
      expect(output.summary.consumerAverageSubmitterSafeAvailabilityConfirmationStatus).toBe("available");
      expect(output.summary.consumerAverageSubmitterSafeAvailabilityConfirmationReadyForRecipeReadinessChain)
        .toBe(true);
      expect(output.summary.consumerAverageSubmitterSafeAvailabilityConfirmationFeatureOnlyCoverageContextReady)
        .toBe(true);
      expect(output.summary.consumerAverageSubmitterSafeAvailabilityConfirmationMissingFeatureOnlySourceFamilyIds)
        .toEqual([]);
      expect(output.summary.consumerAverageSubmitterSafeAvailabilityConfirmationMinimumFeaturePairRequired)
        .toEqual(FEATURE_ONLY_SOURCE_FAMILY_IDS);
      expect(output.summary.consumerAverageSubmitterSafeAvailabilityConfirmationOutcomeLinkageRequiredForFeatureOnlyContext)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterSafeAvailabilityConfirmationRowLevelDataAcceptedByR1150)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterSafeAvailabilityConfirmationMissingSourceFamilyIds).toEqual([]);
      expect(output.summary.consumerAverageSubmitterSafeAvailabilityConfirmationMissingAttestationKeys).toEqual([]);
      expect(output.summary.consumerAverageSubmitterSafeAvailabilityConfirmationMissingAggregateReadinessFactIds)
        .toEqual([]);
      expect(output.summary.consumerAverageSubmitterRowOwnerActionPacketNextAction).toBe(
        "confirm_recommended_lab_plus_wearable_recipe_availability_assertions",
      );
      expect(output.summary.consumerAverageSubmitterSafeAvailabilityActionPacketConclusion).toBe(
        "safe_availability_action_packet_ready_for_outcome_linked_recipe_readiness",
      );
      expect(output.summary.consumerAverageSubmitterSafeAvailabilityActionPacketNextAction).toBe(
        "run_r1144_recipe_readiness_chain_with_confirmed_availability",
      );
      expect(output.summary.consumerAverageSubmitterSafeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain)
        .toBe(true);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("surfaces R1151 feature-only coverage without promoting it over safe availability confirmation", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1076-r1151-feature-only-"));
    try {
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      const fixtures = await writeFixtures(tmp);
      await Promise.all([
        writeFile(fixtures.r1101Path, `${JSON.stringify(r1101Fixture(
          "consumer_loop_ready_awaiting_aggregate_receipt",
          "fill_r1124_first_pass_aggregate_metrics_template",
        ))}\n`),
        writeFile(fixtures.r1151Path, `${JSON.stringify(r1151Fixture({ featureOnly: true }))}\n`),
        writeFile(fixtures.r1152Path, `${JSON.stringify(r1152Fixture({ ready: true }))}\n`),
        writeFile(fixtures.r1153Path, `${JSON.stringify(r1153Fixture({ ready: true }))}\n`),
      ]);

      const { output } = await runR1076CurrentAutoresearchLoopExecutor({
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
        ...fixtures,
      });

      expect(output.summary.nextAction).toBe(R1161_MATERIALIZER_NEXT_ACTION);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyModeConclusion).toBe(
        "ordinary_feature_only_mode_available_not_model_evidence",
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlyModeCoverageContextAllowed).toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyModeCoverageRequiresPreferredPair).toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyModeMinimumFeaturePairRequired)
        .toEqual(FEATURE_ONLY_SOURCE_FAMILY_IDS);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyModeNextAction).toBe(
        "fill_feature_only_coverage_context_template_for_research_only_intake",
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlyModeModelEvidencePromotionAllowed).toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyModeOutcomeLinkageRequiredForFeatureOnlyContext)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyModeOutcomeLinkedEvidenceReady).toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyModeSafeAvailabilityFeatureOnlyCoverageContextReady)
        .toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyModeSafeAvailabilityFeatureOnlyReadinessPresent)
        .toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyModeRowLevelDataAcceptedByR1151).toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyModeSupportedFeatureFamilyIds).toEqual([
        "bloodwork_glycemia",
        "wearable_activity_daily",
      ]);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyModeMissingPrimaryFeatureFamilyIds).toEqual([]);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyModeMissingEvidenceSourceFamilyIds).toEqual([
        "outcome_linkage",
        "join_time_alignment",
      ]);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyCoverageContextIntakeConclusion).toBe(
        "feature_only_coverage_context_ready_research_only",
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlyCoverageContextIntakeReadyForResearchPlanning)
        .toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyCoverageContextIntakeMinimumFeaturePairRequired)
        .toEqual(FEATURE_ONLY_SOURCE_FAMILY_IDS);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyCoverageContextIntakeMissingPrimaryFeatureFamilyIds)
        .toEqual([]);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyCoverageContextIntakeModelEvidencePromotionAllowed)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyCoverageContextIntakeOutcomeLinkageRequiredForFeatureOnlyContext)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyCoverageContextIntakeR1151ReadyForIntake).toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyCoverageContextIntakeRowLevelDataAcceptedByR1152)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyCoverageContextIntakeSupportedFeatureFamilyIds)
        .toEqual(FEATURE_ONLY_SOURCE_FAMILY_IDS);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyChainArtifact).toBe(
        "r1153-ordinary-consumer-feature-only-chain-runner.latest.json",
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlyChainConclusion).toBe(
        "ordinary_feature_only_chain_ready_research_only",
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlyChainCoverageContextReadyForResearchPlanning)
        .toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyChainCoverageContextAllowed).toBe(true);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyChainCoverageContextIntakeConclusion).toBe(
        "feature_only_coverage_context_ready_research_only",
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlyChainFeatureOnlyModeConclusion).toBe(
        "ordinary_feature_only_mode_available_not_model_evidence",
      );
      expect(output.summary.consumerAverageSubmitterFeatureOnlyChainMinimumFeaturePairRequired)
        .toEqual(FEATURE_ONLY_SOURCE_FAMILY_IDS);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyChainMissingCoverageContextPrimaryFeatureFamilyIds)
        .toEqual([]);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyChainMissingFeatureOnlySourceFamilyIds).toEqual([]);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyChainModelEvidencePromotionAllowed).toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyChainOutcomeLinkageRequiredForFeatureOnlyContext)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyChainRowLevelDataAcceptedByR1153).toBe(false);
      expect(output.summary.consumerAverageSubmitterFeatureOnlyChainSupportedFeatureFamilyIds)
        .toEqual(FEATURE_ONLY_SOURCE_FAMILY_IDS);
      expect(output.summary.consumerAverageSubmitterSafeAvailabilityConfirmationNextAction).toBe(
        "fill_safe_availability_confirmation_from_template",
      );
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("promotes the post-confirmation private config fill step when R1147 is ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1076-post-confirmation-"));
    try {
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      const fixtures = await writeFixtures(tmp);
      await Promise.all([
        writeFile(fixtures.r1101Path, `${JSON.stringify(r1101Fixture(
          "consumer_loop_ready_awaiting_aggregate_receipt",
          "fill_r1124_first_pass_aggregate_metrics_template",
        ))}\n`),
        writeFile(fixtures.r1147Path, `${JSON.stringify(r1147Fixture({ confirmed: true }))}\n`),
        writeFile(fixtures.r1148Path, `${JSON.stringify(r1148Fixture({ packetReady: true }))}\n`),
        writeFile(fixtures.r1149Path, `${JSON.stringify(r1149Fixture({ confirmed: true }))}\n`),
      ]);

      const { output } = await runR1076CurrentAutoresearchLoopExecutor({
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
        ...fixtures,
      });

      expect(output.summary.conclusion).toBe("executor_ready_for_consumer_private_config");
      expect(output.summary.nextAction).toBe("fill_post_confirmation_private_config_and_run_r1142");
      expect(output.summary.consumerAverageSubmitterRowOwnerActionPacketNextAction).toBe(
        "confirm_recommended_lab_plus_wearable_recipe_availability_assertions",
      );
      expect(output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigPacketNextAction).toBe(
        "fill_post_confirmation_private_config_and_run_r1142",
      );
      expect(output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigPacketTemplateReadyForFill).toBe(
        true,
      );
      expect(output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigPacketRowOwnerAssertionsConfirmed)
        .toBe(true);
      expect(output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigPacketExpectedRouteIds).toEqual(
        LAB_WEARABLE_MINIMUM_ROUTE_IDS,
      );
      expect(output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigSchemaVersion)
        .toBe(R1147_RUNNER_CONFIG_SCHEMA_VERSION);
      expect(output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigRouteRunOrder)
        .toEqual(LAB_WEARABLE_MINIMUM_ROUTE_IDS);
      expect(output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeNextAction).toBe(
        "provide_post_confirmation_private_runner_config",
      );
      expect(output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeReadyForR1142).toBe(false);
      expect(output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeActionGuardPresent)
        .toBe(true);
      expect(
        output.summary
          .consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketNextAction,
      ).toBe("run_r1144_recipe_readiness_chain_with_confirmed_availability");
      expect(output.summary.consumerAverageSubmitterLabWearableSubmissionKitArtifact).toBe(
        "r1149-ordinary-consumer-lab-wearable-submission-kit.latest.json",
      );
      expect(output.summary.consumerAverageSubmitterLabWearableSubmissionKitConclusion).toBe(
        "ordinary_consumer_lab_wearable_submission_kit_waiting_on_private_config",
      );
      expect(output.summary.consumerAverageSubmitterLabWearableSubmissionKitRequiredSourceFamilyIds).toEqual([
        "outcome_linkage",
        "join_time_alignment",
        "bloodwork_glycemia",
        "wearable_activity_daily",
      ]);
      expect(output.summary.consumerAverageSubmitterLabWearableSubmissionKitNextAction).toBe(
        "fill_local_private_runner_config_from_r1147_template",
      );
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("refreshes a schema-current R1148 intake that lacks the safe-action guard", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1076-stale-r1148-"));
    try {
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      const fixtures = await writeFixtures(tmp);
      await Promise.all([
        writeFile(fixtures.r1101Path, `${JSON.stringify(r1101Fixture(
          "consumer_loop_ready_awaiting_aggregate_receipt",
          "fill_r1124_first_pass_aggregate_metrics_template",
        ))}\n`),
        writeFile(fixtures.r1147Path, `${JSON.stringify(r1147Fixture({ confirmed: true }))}\n`),
        writeFile(fixtures.r1148Path, `${JSON.stringify(r1148Fixture({
          packetReady: true,
          staleSafeAction: true,
        }))}\n`),
        writeFile(fixtures.r1149Path, `${JSON.stringify(r1149Fixture({ confirmed: true }))}\n`),
      ]);

      const { output } = await runR1076CurrentAutoresearchLoopExecutor({
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
        ...fixtures,
      });

      expect(output.summary.conclusion).toBe("executor_refresh_consumer_safe_action_chain");
      expect(output.summary.nextAction).toBe("refresh_r1148_post_confirmation_private_config_intake");
      expect(output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeArtifact).toBe(
        "r1148-ordinary-consumer-post-confirmation-private-config-intake.latest.json",
      );
      expect(output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeActionGuardPresent)
        .toBe(false);
      expect(output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketNextAction)
        .toBeNull();
      expect(output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeNextAction).toBe(
        "provide_post_confirmation_private_runner_config",
      );
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("promotes the R1153 feature-only chain action carried by R1148", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1076-r1153-action-"));
    try {
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      const fixtures = await writeFixtures(tmp);
      await Promise.all([
        writeFile(fixtures.r1101Path, `${JSON.stringify(r1101Fixture(
          "consumer_loop_ready_awaiting_aggregate_receipt",
          "fill_r1124_first_pass_aggregate_metrics_template",
        ))}\n`),
        writeFile(fixtures.r1147Path, `${JSON.stringify(r1147Fixture())}\n`),
        writeFile(fixtures.r1148Path, `${JSON.stringify(r1148Fixture({ featureOnlyReady: true }))}\n`),
        writeFile(fixtures.r1149Path, `${JSON.stringify(r1149Fixture())}\n`),
      ]);

      const { output } = await runR1076CurrentAutoresearchLoopExecutor({
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
        ...fixtures,
      });

      expect(output.summary.conclusion).toBe("executor_ready_for_consumer_feature_only_chain");
      expect(output.summary.nextAction).toBe("run_r1153_feature_only_chain_with_safe_availability");
      expect(output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeReadyForR1142).toBe(false);
      expect(output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeActionGuardPresent)
        .toBe(true);
      expect(
        output.summary
          .consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketNextAction,
      ).toBe("run_r1153_feature_only_chain_with_safe_availability");
      expect(
        output.summary
          .consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketFeatureOnlyCoverageContextReady,
      ).toBe(true);
      expect(
        output.summary
          .consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain,
      ).toBe(false);
      expect(
        output.summary
          .consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds,
      ).toEqual([]);
      expect(
        output.summary
          .consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketMissingRequiredSourceFamilyIds,
      ).toEqual(["outcome_linkage", "join_time_alignment"]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("promotes R1142 when the post-confirmation private config intake is ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1076-r1148-ready-"));
    try {
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      const fixtures = await writeFixtures(tmp);
      await Promise.all([
        writeFile(fixtures.r1101Path, `${JSON.stringify(r1101Fixture(
          "consumer_loop_ready_awaiting_aggregate_receipt",
          "fill_r1124_first_pass_aggregate_metrics_template",
        ))}\n`),
        writeFile(fixtures.r1147Path, `${JSON.stringify(r1147Fixture({ confirmed: true }))}\n`),
        writeFile(fixtures.r1148Path, `${JSON.stringify(r1148Fixture({ ready: true }))}\n`),
        writeFile(fixtures.r1149Path, `${JSON.stringify(r1149Fixture({ ready: true }))}\n`),
      ]);

      const { output } = await runR1076CurrentAutoresearchLoopExecutor({
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
        ...fixtures,
      });

      expect(output.summary.conclusion).toBe("executor_ready_for_consumer_route_metrics");
      expect(output.summary.nextAction).toBe("run_r1142_for_real_lab_wearable_route_metrics");
      expect(output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeConclusion).toBe(
        "post_confirmation_private_config_ready_for_r1142",
      );
      expect(output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakePrivateConfigStatus)
        .toBe("available");
      expect(output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeReadyForR1142).toBe(true);
      expect(output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeRequestedRouteIds).toEqual(
        LAB_WEARABLE_MINIMUM_ROUTE_IDS,
      );
      expect(output.summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeActionGuardPresent)
        .toBe(true);
      expect(
        output.summary
          .consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain,
      ).toBe(true);
      expect(output.summary.consumerAverageSubmitterLabWearableSubmissionKitNextAction).toBe(
        "run_r1142_for_real_lab_wearable_route_metrics",
      );
      expect(output.summary.consumerAverageSubmitterLabWearableSubmissionKitPrivateConfigReadyForR1142).toBe(true);
      expect(output.summary.consumerAverageSubmitterLabWearableSubmissionKitTopBlocker).toBe(
        "real_lab_wearable_route_metrics_missing",
      );
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("switches to aggregate receipt fill when a derived NSRR cohort appears", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1076-ready-"));
    try {
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      await writeZip(scanRoot, "nsrr-shhs-derived.zip", {
        "shhs/datasets/shhs1-dataset-0.21.0.csv": "",
        "shhs/datasets/shhs-cvd-events-dataset-0.21.0.csv": "",
        "shhs/datasets/shhs-data-dictionary-0.21.0-variables.csv": "",
      });
      const fixtures = await writeFixtures(tmp);

      const { output } = await runR1076CurrentAutoresearchLoopExecutor({
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
        ...fixtures,
      });

      expect(output.summary).toMatchObject({
        conclusion: "executor_ready_for_nsrr_aggregate_receipt",
        nextAction: "fill_nsrr_aggregate_receipt_or_run_local_evaluator",
        reviewGptRequiredNow: false,
        routerConclusion: "current_loop_ready_for_nsrr_aggregate_receipt",
      });
      expect(output.nextLoop.commands[0]).toContain("r1081-nsrr-source-table-candidate-scanner.ts");
      expect(output.nextLoop.commands.join("\n")).toContain("r1080-nsrr-standardizer-manifest-scaffold.ts");
      expect(output.nextLoop.commands.join("\n")).toContain("r1082-nsrr-standardizer-manifest-readiness.ts");
      expect(output.nextLoop.commands.join("\n")).toContain("r1079-nsrr-sleep-autonomic-standardizer.ts");
      expect(output.nextLoop.commands.join("\n")).toContain("r1078-nsrr-sleep-autonomic-local-loop.ts");
      expect(output.nextLoop.commands.join("\n")).toContain("MURPH_AGE_NSRR_AGGREGATE_RECEIPT_PATH");
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(output)).not.toContain("shhs1-dataset");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("runs R1078 automatically when a standardized NSRR analytic cache is present", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1076-auto-r1078-"));
    try {
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      await writeZip(scanRoot, "nsrr-shhs-derived.zip", {
        "shhs/datasets/shhs1-dataset-0.21.0.csv": "",
        "shhs/datasets/shhs-cvd-events-dataset-0.21.0.csv": "",
        "shhs/datasets/shhs-data-dictionary-0.21.0-variables.csv": "",
      });
      const cachePath = path.join(tmp, "cache.csv.gz");
      await writeSyntheticNsrrAnalyticCache(cachePath, 480);
      const fixtures = await writeFixtures(tmp);

      const { output } = await runR1076CurrentAutoresearchLoopExecutor({
        nsrrSleepAutonomicAnalyticCachePath: cachePath,
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
        ...fixtures,
      });

      expect(output.executedSteps.r1078NsrrSleepAutonomicLocalLoop).toMatchObject({
        packetId: "r1078-nsrr-sleep-autonomic-local-loop",
        status: "research-local-aggregate-only",
      });
      expect(output.executedSteps.r1074TrueWearablePostDownloadRefresh.summaryConclusion)
        .not.toBe("post_download_refresh_blocked_on_data");
      expect(output.productDisplayAuthorized).toBe(false);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(output)).not.toContain("primary_event");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("runs R1079 then R1078 automatically when a private standardizer manifest is present", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1076-auto-r1079-"));
    const cachePath = runtimeCachePath(tmp, "r1076-auto-r1079.csv.gz");
    try {
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      await writeZip(scanRoot, "nsrr-shhs-derived.zip", {
        "shhs/datasets/shhs1-dataset-0.21.0.csv": "",
        "shhs/datasets/shhs-cvd-events-dataset-0.21.0.csv": "",
        "shhs/datasets/shhs-data-dictionary-0.21.0-variables.csv": "",
      });
      const sourcePath = path.join(tmp, "private-source.csv");
      const manifestPath = path.join(tmp, "private-manifest.json");
      await writePrivateNsrrSource(sourcePath, 480);
      await writePrivateNsrrManifest(manifestPath, sourcePath, cachePath);
      const fixtures = await writeFixtures(tmp);

      const { output } = await runR1076CurrentAutoresearchLoopExecutor({
        nsrrSleepAutonomicStandardizerManifestPath: manifestPath,
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
        ...fixtures,
      });

      expect(output.executedSteps.r1079NsrrSleepAutonomicStandardizer).toMatchObject({
        packetId: "r1079-nsrr-sleep-autonomic-standardizer",
        status: "research-local-private-cache-plus-aggregate-receipt",
      });
      expect(output.executedSteps.r1078NsrrSleepAutonomicLocalLoop).toMatchObject({
        packetId: "r1078-nsrr-sleep-autonomic-local-loop",
        status: "research-local-aggregate-only",
      });
      expect(output.executedSteps.r1074TrueWearablePostDownloadRefresh.summaryConclusion)
        .not.toBe("post_download_refresh_blocked_on_data");
      expect(output.productDisplayAuthorized).toBe(false);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(output)).not.toContain("src_event");
      expect(JSON.stringify(output)).not.toContain("primary_event");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(cachePath, { force: true });
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not fall back to a stale default cache when R1079 materializes sparse data", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1076-sparse-r1079-"));
    const previousCwd = process.cwd();
    try {
      process.chdir(tmp);
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      await writeZip(scanRoot, "nsrr-shhs-derived.zip", {
        "shhs/datasets/shhs1-dataset-0.21.0.csv": "",
        "shhs/datasets/shhs-cvd-events-dataset-0.21.0.csv": "",
        "shhs/datasets/shhs-data-dictionary-0.21.0-variables.csv": "",
      });
      await writeSyntheticNsrrAnalyticCache(path.join(
        ".runtime",
        "cache",
        "murph-age",
        "nsrr-sleep-autonomic",
        "derived",
        "analytic",
        "nsrr-sleep-autonomic-v0.csv.gz",
      ), 480);
      const sourcePath = path.join(tmp, "private-source.csv");
      const manifestPath = path.join(tmp, "private-manifest.json");
      const cachePath = path.join(
        ".runtime",
        "cache",
        "murph-age",
        "nsrr-sleep-autonomic",
        "derived",
        "analytic",
        "sparse-current.csv.gz",
      );
      await writePrivateNsrrSource(sourcePath, 40);
      await writePrivateNsrrManifest(manifestPath, sourcePath, cachePath);
      const fixtures = await writeFixtures(tmp);

      const { output } = await runR1076CurrentAutoresearchLoopExecutor({
        nsrrSleepAutonomicStandardizerManifestPath: manifestPath,
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
        ...fixtures,
      });

      expect(output.executedSteps.r1079NsrrSleepAutonomicStandardizer).toMatchObject({
        summaryConclusion: "nsrr_standard_cache_materialized_but_sparse",
      });
      expect(output.executedSteps.r1078NsrrSleepAutonomicLocalLoop).toBeNull();
      expect(output.summary).toMatchObject({
        conclusion: "executor_ready_for_nsrr_aggregate_receipt",
        nextAction: "fill_nsrr_aggregate_receipt_or_run_local_evaluator",
      });
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(output)).not.toContain("src_event");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      process.chdir(previousCwd);
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes to function missingness/calibration adjudication when the function aggregate requires it", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1076-function-adjudication-"));
    try {
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      const fixtures = await writeFixtures(tmp);
      await writeFile(fixtures.r1083AggregatePacketPath, `${JSON.stringify(functionAggregatePacketFixture({
        calibration_non_worse: false,
        function_beats_missingness_control: false,
      }))}\n`);

      const { output } = await runR1076CurrentAutoresearchLoopExecutor({
        createdAt: "2026-05-15T14:10:00.000Z",
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
        ...fixtures,
      });

      expect(output.executedSteps.r1083FunctionMissingnessCalibrationAdjudication).toMatchObject({
        packetId: "r1083-function-missingness-calibration-adjudication",
        summaryConclusion: "function_content_adjudication_needed",
      });
      expect(output.summary).toMatchObject({
        conclusion: "executor_ready_for_function_adjudication",
        nextAction: "run_function_missingness_calibration_adjudication",
        reviewGptRequiredNow: false,
        routerConclusion: "current_loop_ready_for_function_adjudication",
      });
      expect(output.nextLoop.commands.join("\n")).toContain("r1083-function-missingness-calibration-adjudication.ts");
      expect(output.nextLoop.commands.join("\n")).toContain("r1076-current-autoresearch-loop-executor.ts");
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1076-cli-"));
    try {
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      const fixtures = await writeFixtures(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1076-current-autoresearch-loop-executor.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_NSRR_SCAN_ROOTS: scanRoot,
          MURPH_AGE_R1057_FUNCTION_ACTIVITY_BATCH_RESULT_PATH: fixtures.r1057Path,
          MURPH_AGE_R1059_TRUE_WEARABLE_RECEIPT_INTAKE_PATH: fixtures.r1059Path,
          MURPH_AGE_R1061_TRUE_WEARABLE_DATA_UNBLOCKER_PATH: fixtures.r1061Path,
          MURPH_AGE_R1062_TRUE_WEARABLE_RECEIPT_TEMPLATE_PATH: fixtures.r1062Path,
          MURPH_AGE_R1025_FUNCTION_TRANSPORT_AGGREGATE_PACKET_PATH: fixtures.r1083AggregatePacketPath,
          MURPH_AGE_R1044_HAALSI_PATH: fixtures.r1084HaalsiPath,
          MURPH_AGE_R1101_CONSUMER_LOOP_EXECUTOR_PATH: fixtures.r1101Path,
          MURPH_AGE_R1128_ORDINARY_CONSUMER_PIPELINE_SMOKE_PROOF_PATH: fixtures.r1128Path,
          MURPH_AGE_R1129_CONSUMER_REAL_EVIDENCE_GATE_PATH: fixtures.r1129Path,
          MURPH_AGE_R1130_ORDINARY_CONSUMER_REAL_EVIDENCE_HANDOFF_PATH: fixtures.r1130Path,
          MURPH_AGE_R1132_ORDINARY_CONSUMER_SUBMISSION_READINESS_PATH: fixtures.r1132Path,
          MURPH_AGE_R1133_ORDINARY_CONSUMER_DATA_AVAILABILITY_PREFLIGHT_PATH: fixtures.r1133Path,
          MURPH_AGE_R1134_ORDINARY_CONSUMER_AVAILABILITY_CONFIG_BRIDGE_PATH: fixtures.r1134Path,
          MURPH_AGE_R1135_ORDINARY_CONSUMER_AVAILABILITY_MANIFEST_PACKET_PATH: fixtures.r1135Path,
          MURPH_AGE_R1136_ORDINARY_CONSUMER_AVAILABILITY_CHAIN_RUNNER_PATH: fixtures.r1136Path,
          MURPH_AGE_R1137_ORDINARY_CONSUMER_PARTIAL_ROUTE_PLANNER_PATH: fixtures.r1137Path,
          MURPH_AGE_R1138_ORDINARY_CONSUMER_PARTIAL_AGGREGATE_METRIC_INTAKE_PATH: fixtures.r1138Path,
          MURPH_AGE_R1139_ORDINARY_CONSUMER_PARTIAL_PRIVATE_CONFIG_HANDOFF_PATH: fixtures.r1139Path,
          MURPH_AGE_R1140_ORDINARY_CONSUMER_PARTIAL_READINESS_CHAIN_RUNNER_PATH: fixtures.r1140Path,
          MURPH_AGE_R1141_ORDINARY_CONSUMER_PARTIAL_PRIVATE_METRIC_RUNNER_PATH: fixtures.r1141Path,
          MURPH_AGE_R1142_ORDINARY_CONSUMER_PARTIAL_PRIVATE_CHAIN_RUNNER_PATH: fixtures.r1142Path,
          MURPH_AGE_R1145_ORDINARY_CONSUMER_CURRENT_CHAIN_COMPLETION_AUDIT_PATH: fixtures.r1145Path,
          MURPH_AGE_R1146_ORDINARY_CONSUMER_ROW_OWNER_ROUTE_ACTION_PACKET_PATH: fixtures.r1146Path,
          MURPH_AGE_R1147_ORDINARY_CONSUMER_POST_CONFIRMATION_PRIVATE_CONFIG_PACKET_PATH: fixtures.r1147Path,
          MURPH_AGE_R1148_ORDINARY_CONSUMER_POST_CONFIRMATION_PRIVATE_CONFIG_INTAKE_PATH: fixtures.r1148Path,
          MURPH_AGE_R1149_ORDINARY_CONSUMER_LAB_WEARABLE_SUBMISSION_KIT_PATH: fixtures.r1149Path,
          MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_PATH: fixtures.r1150Path,
          MURPH_AGE_R1151_ORDINARY_CONSUMER_FEATURE_ONLY_SUBMISSION_MODE_PATH: fixtures.r1151Path,
          MURPH_AGE_R1152_ORDINARY_CONSUMER_FEATURE_ONLY_COVERAGE_CONTEXT_INTAKE_PATH: fixtures.r1152Path,
          MURPH_AGE_R1153_ORDINARY_CONSUMER_FEATURE_ONLY_CHAIN_RUNNER_PATH: fixtures.r1153Path,
          MURPH_AGE_R1154_ORDINARY_CONSUMER_SAFE_AVAILABILITY_ACTION_PACKET_PATH: fixtures.r1154Path,
          MURPH_AGE_R1155_ORDINARY_CONSUMER_SAFE_CONFIRMATION_FEATURE_ONLY_SMOKE_PROOF_PATH: fixtures.r1155Path,
          MURPH_AGE_R1156_ORDINARY_CONSUMER_SAFE_CONFIRMATION_HANDOFF_PATH: fixtures.r1156Path,
          MURPH_AGE_R1157_ORDINARY_CONSUMER_SAFE_CONFIRMATION_CHAIN_RUNNER_PATH: fixtures.r1157Path,
          MURPH_AGE_R1158_ORDINARY_CONSUMER_SAFE_CONFIRMATION_FILL_GUIDE_PATH: fixtures.r1158Path,
          MURPH_AGE_R1159_ORDINARY_CONSUMER_SAFE_CONFIRMATION_ANSWER_SHEET_PATH: fixtures.r1159Path,
          MURPH_AGE_R1160_R1159_FEATURE_ONLY_SAFE_CONFIRMATION_TRANSCRIPTION_PROOF_PATH: fixtures.r1160Path,
          MURPH_AGE_R1161_FEATURE_ONLY_SAFE_AVAILABILITY_CONFIRMATION_MATERIALIZER_PATH: fixtures.r1161Path,
          MURPH_AGE_R1162_FEATURE_ONLY_SAFE_CONFIRMATION_ASSERTION_HANDOFF_PATH: fixtures.r1162Path,
          MURPH_AGE_R1163_FEATURE_ONLY_SAFE_CONFIRMATION_TO_RESEARCH_RUNNER_PATH: fixtures.r1163Path,
          MURPH_AGE_R1174_ORDINARY_CONSUMER_SAFE_NEXT_STEP_PACKET_PATH: fixtures.r1174Path,
          MURPH_AGE_R1176_R1172_R1165_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_PATH: fixtures.r1176Path,
          MURPH_AGE_R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_PATH: fixtures.r1185Path,
          MURPH_AGE_R1187_AVERAGE_SUBMITTER_ROUTE_METRIC_READINESS_PATH: fixtures.r1187Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        consumerAverageSubmitterAvailabilityManifestStatus: string | null;
        consumerAverageSubmitterAvailabilityMissingSourceFamilyIds: string[];
        consumerAverageSubmitterAvailabilityChainNextAction: string | null;
        consumerAverageSubmitterPartialRoutePlannerNextAction: string | null;
        consumerAverageSubmitterPartialMetricIntakeTemplateArtifact: string | null;
        consumerAverageSubmitterPartialPrivateConfigHandoffTemplateArtifact: string | null;
        consumerAverageSubmitterPartialReadinessChainNextAction: string | null;
        consumerAverageSubmitterPartialReadinessChainTemplateArtifact: string | null;
        consumerAverageSubmitterPartialPrivateMetricRunnerNextAction: string | null;
        consumerAverageSubmitterPartialPrivateMetricRunnerRouteMetricsReadyForR1138: boolean | null;
        consumerAverageSubmitterPartialPrivateChainNextAction: string | null;
        consumerAverageSubmitterPartialPrivateChainRouteMetricsReadyForR1138: boolean | null;
        consumerAverageSubmitterRowOwnerActionPacketNextAction: string | null;
        consumerAverageSubmitterRowOwnerActionPacketSelectedRecipeId: string | null;
        consumerAverageSubmitterRowOwnerActionPacketRecommendedConfirmedRecipeCommand: string | null;
        consumerAverageSubmitterPostConfirmationPrivateConfigPacketNextAction: string | null;
        consumerAverageSubmitterPostConfirmationPrivateConfigPacketExpectedRouteIds: string[];
        consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigSchemaVersion: string | null;
        consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigRouteRunOrder: string[];
        consumerAverageSubmitterPostConfirmationPrivateConfigPacketTemplateArtifact: string | null;
        consumerAverageSubmitterPostConfirmationPrivateConfigPacketTemplateReadyForFill: boolean | null;
        consumerAverageSubmitterPostConfirmationPrivateConfigIntakeNextAction: string | null;
        consumerAverageSubmitterPostConfirmationPrivateConfigIntakePrivateConfigStatus: string | null;
        consumerAverageSubmitterPostConfirmationPrivateConfigIntakeReadyForR1142: boolean | null;
        consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeActionGuardPresent: boolean | null;
        consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds: string[];
        consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketMissingRequiredSourceFamilyIds: string[];
        consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketNextAction: string | null;
        consumerAverageSubmitterLabWearableSubmissionKitNextAction: string | null;
        consumerAverageSubmitterLabWearableSubmissionKitRequiredSourceFamilyIds: string[];
        consumerAverageSubmitterLabWearableSubmissionKitTopBlocker: string | null;
        consumerAverageSubmitterSafeAvailabilityConfirmationNextAction: string | null;
        consumerAverageSubmitterSafeAvailabilityConfirmationFeatureOnlyCoverageContextReady: boolean | null;
        consumerAverageSubmitterSafeAvailabilityConfirmationChecklistItemIds: string[];
        consumerAverageSubmitterSafeAvailabilityConfirmationMinimumFeaturePairRequired: string[];
        consumerAverageSubmitterSafeAvailabilityConfirmationMissingFeatureOnlySourceFamilyIds: string[];
        consumerAverageSubmitterSafeAvailabilityConfirmationOutcomeLinkageRequiredForFeatureOnlyContext: boolean | null;
        consumerAverageSubmitterSafeAvailabilityConfirmationReadyForRecipeReadinessChain: boolean | null;
        consumerAverageSubmitterSafeAvailabilityConfirmationRowLevelDataAcceptedByR1150: boolean | null;
        consumerAverageSubmitterSafeAvailabilityConfirmationStatus: string | null;
        consumerAverageSubmitterSafeAvailabilityConfirmationTemplateArtifact: string | null;
        consumerAverageSubmitterSafeAvailabilityConfirmationFeatureOnlyTemplateArtifact: string | null;
        consumerAverageSubmitterFeatureOnlyModeCoverageContextAllowed: boolean | null;
        consumerAverageSubmitterFeatureOnlyModeMinimumFeaturePairRequired: string[];
        consumerAverageSubmitterFeatureOnlyModeMissingPrimaryFeatureFamilyIds: string[];
        consumerAverageSubmitterFeatureOnlyModeModelEvidencePromotionAllowed: boolean | null;
        consumerAverageSubmitterFeatureOnlyModeNextAction: string | null;
        consumerAverageSubmitterFeatureOnlyModeOutcomeLinkageRequiredForFeatureOnlyContext: boolean | null;
        consumerAverageSubmitterFeatureOnlyModeRowLevelDataAcceptedByR1151: boolean | null;
        consumerAverageSubmitterFeatureOnlyModeSafeAvailabilityFeatureOnlyCoverageContextReady: boolean | null;
        consumerAverageSubmitterFeatureOnlyModeSafeAvailabilityFeatureOnlyReadinessPresent: boolean | null;
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
        consumerAverageSubmitterFeatureOnlyChainConclusion: string | null;
        consumerAverageSubmitterFeatureOnlyChainCoverageContextReadyForResearchPlanning: boolean | null;
        consumerAverageSubmitterFeatureOnlyChainCoverageContextAllowed: boolean | null;
        consumerAverageSubmitterFeatureOnlyChainModelEvidencePromotionAllowed: boolean | null;
        consumerAverageSubmitterFeatureOnlyChainRowLevelDataAcceptedByR1153: boolean | null;
        consumerAverageSubmitterSafeAvailabilityActionPacketConclusion: string | null;
        consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyCoverageContextReady: boolean | null;
        consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyQuickstartArtifact: string | null;
        consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount: number | null;
        consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths: string[];
        consumerAverageSubmitterSafeAvailabilityActionPacketChecklistItemIds: string[];
        consumerAverageSubmitterSafeAvailabilityActionPacketMinimumFeaturePairRequired: string[];
        consumerAverageSubmitterSafeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds: string[];
        consumerAverageSubmitterSafeAvailabilityActionPacketMissingRequiredSourceFamilyIds: string[];
        consumerAverageSubmitterSafeAvailabilityActionPacketNextAction: string | null;
        consumerAverageSubmitterSafeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain: boolean | null;
        consumerAverageSubmitterSafeAvailabilityActionPacketRowLevelDataAcceptedByR1154: boolean | null;
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
        consumerAverageSubmitterSafeConfirmationHandoffCommand: string | null;
        consumerAverageSubmitterSafeConfirmationChainRunnerCommand: string | null;
        consumerAverageSubmitterSafeConfirmationChainRunnerConclusion: string | null;
        consumerAverageSubmitterSafeConfirmationChainRunnerNextAction: string | null;
        consumerAverageSubmitterSafeConfirmationChainRunnerFeatureOnlyResearchPlanningReady: boolean | null;
        consumerAverageSubmitterSafeConfirmationChainRunnerRowLevelDataAcceptedByR1157: boolean | null;
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
        consumerAverageSubmitterSafeConfirmationTranscriptionProofHypotheticalTranscriptionWouldBeFeatureOnlyReady:
          boolean | null;
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
        consumerAverageSubmitterManifestPacketMatchedRecipeIds: string[];
        consumerAverageSubmitterManifestPacketMaterializerCommand: string | null;
        consumerAverageSubmitterManifestPacketPrimaryInputFamilyIds: string[];
        consumerAverageSubmitterManifestPacketPartialPrivateChainRunnerCommand: string | null;
        consumerAverageSubmitterManifestPacketPartialRouteRecipeIds: string[];
        consumerAverageSubmitterManifestPacketPreferredRecipeIds: string[];
        consumerAverageSubmitterManifestPacketRecipeReadinessChainCommand: string | null;
        consumerAverageSubmitterManifestPacketSafeManifestAttestationsComplete: boolean | null;
        consumerAverageSubmitterSourceFamilyMissingSlotRollup: Record<string, unknown>[];
        nextAction: string;
        packetId: string;
        productDisplayAuthorized: boolean;
        reviewGptRequiredNow: boolean;
      };
      expect(summary).toMatchObject({
        conclusion: "executor_blocked_on_true_wearable_data",
        nextAction: "download_nsrr_or_secure_workbench_access",
        packetId: "r1076-current-autoresearch-loop-executor",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
      });
      expect(summary.consumerAverageSubmitterAvailabilityManifestStatus).toBe("not_provided");
      expect(summary.consumerAverageSubmitterSafeConfirmationHandoffCommand).toBe(
        R1156_SAFE_CONFIRMATION_HANDOFF_COMMAND,
      );
      expect(summary.consumerAverageSubmitterSafeConfirmationChainRunnerCommand).toBe(
        R1157_SAFE_CONFIRMATION_CHAIN_RUNNER_COMMAND,
      );
      expect(summary.consumerAverageSubmitterSafeConfirmationChainRunnerConclusion).toBe(
        "ordinary_safe_confirmation_chain_waiting_on_safe_confirmation",
      );
      expect(summary.consumerAverageSubmitterSafeConfirmationChainRunnerNextAction).toBe(
        "fill_safe_availability_confirmation_from_template",
      );
      expect(summary.consumerAverageSubmitterSafeConfirmationChainRunnerFeatureOnlyResearchPlanningReady)
        .toBe(false);
      expect(summary.consumerAverageSubmitterSafeConfirmationChainRunnerRowLevelDataAcceptedByR1157).toBe(false);
      expect(summary.consumerAverageSubmitterSafeConfirmationFillGuideArtifact).toBe(
        "r1158-ordinary-consumer-safe-confirmation-fill-guide.latest.json",
      );
      expect(summary.consumerAverageSubmitterSafeConfirmationFillGuideCommand).toBe(
        R1158_SAFE_CONFIRMATION_FILL_GUIDE_COMMAND,
      );
      expect(summary.consumerAverageSubmitterSafeConfirmationFillGuideConclusion).toBe(
        "ordinary_safe_confirmation_fill_guide_ready_non_evidence",
      );
      expect(summary.consumerAverageSubmitterSafeConfirmationFillGuideExactSafeFieldEditCount)
        .toBe(R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length);
      expect(summary.consumerAverageSubmitterSafeConfirmationFillGuideGuideReadyForRowOwnerFill).toBe(true);
      expect(summary.consumerAverageSubmitterSafeConfirmationFillGuideMinimumFeaturePairRequired)
        .toEqual(FEATURE_ONLY_SOURCE_FAMILY_IDS);
      expect(summary.consumerAverageSubmitterSafeConfirmationFillGuideNextAction).toBe(
        "fill_safe_availability_confirmation_from_template",
      );
      expect(summary.consumerAverageSubmitterSafeConfirmationFillGuideOptionalAddOnFamilyIds)
        .toEqual(FEATURE_ONLY_FILL_GUIDE_OPTIONAL_ADD_ON_FAMILY_IDS);
      expect(summary.consumerAverageSubmitterSafeConfirmationFillGuideRequiredChecklistIds)
        .toEqual(FEATURE_ONLY_FILL_GUIDE_CHECKLIST_IDS);
      expect(summary.consumerAverageSubmitterSafeConfirmationFillGuideRequiredInputKindIds)
        .toEqual(FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS);
      expect(summary.consumerAverageSubmitterSafeConfirmationFillGuideRowLevelDataAcceptedByR1158).toBe(false);
      expect(summary.consumerAverageSubmitterSafeConfirmationAnswerSheetArtifact).toBe(
        "r1159-ordinary-consumer-safe-confirmation-answer-sheet.latest.json",
      );
      expect(summary.consumerAverageSubmitterSafeConfirmationAnswerSheetCommand).toBe(
        R1159_SAFE_CONFIRMATION_ANSWER_SHEET_COMMAND,
      );
      expect(summary.consumerAverageSubmitterSafeConfirmationAnswerSheetConclusion).toBe(
        "ordinary_safe_confirmation_answer_sheet_ready_non_evidence",
      );
      expect(summary.consumerAverageSubmitterSafeConfirmationAnswerSheetExactSafeAnswerCount)
        .toBe(R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length);
      expect(summary.consumerAverageSubmitterSafeConfirmationAnswerSheetReadyForRowOwner).toBe(true);
      expect(summary.consumerAverageSubmitterSafeConfirmationAnswerSheetMinimumFeaturePairRequired)
        .toEqual(FEATURE_ONLY_SOURCE_FAMILY_IDS);
      expect(summary.consumerAverageSubmitterSafeConfirmationAnswerSheetNextAction).toBe(
        R1159_ANSWER_SHEET_NEXT_ACTION,
      );
      expect(summary.consumerAverageSubmitterSafeConfirmationAnswerSheetOptionalAddOnFamilyIds)
        .toEqual(FEATURE_ONLY_FILL_GUIDE_OPTIONAL_ADD_ON_FAMILY_IDS);
      expect(summary.consumerAverageSubmitterSafeConfirmationAnswerSheetRequiredChecklistIds)
        .toEqual(FEATURE_ONLY_FILL_GUIDE_CHECKLIST_IDS);
      expect(summary.consumerAverageSubmitterSafeConfirmationAnswerSheetRequiredInputKindIds)
        .toEqual(FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS);
      expect(summary.consumerAverageSubmitterSafeConfirmationAnswerSheetRowLevelDataAcceptedByR1159).toBe(false);
      expect(summary.consumerAverageSubmitterSafeConfirmationAnswerSheetRowOwnerProvidedValuesStored).toBe(false);
      expect(summary.consumerAverageSubmitterSafeConfirmationTranscriptionProofArtifact).toBe(
        "r1160-r1159-feature-only-safe-confirmation-transcription-proof.latest.json",
      );
      expect(summary.consumerAverageSubmitterSafeConfirmationTranscriptionProofCommand).toBe(
        R1160_TRANSCRIPTION_PROOF_COMMAND,
      );
      expect(summary.consumerAverageSubmitterSafeConfirmationTranscriptionProofConclusion).toBe(
        "r1159_feature_only_safe_confirmation_transcription_ready_non_evidence",
      );
      expect(summary.consumerAverageSubmitterSafeConfirmationTranscriptionProofExactSafeTranscriptionStepCount)
        .toBe(R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length);
      expect(summary.consumerAverageSubmitterSafeConfirmationTranscriptionProofReadyForRowOwnerConfirmation)
        .toBe(true);
      expect(summary.consumerAverageSubmitterSafeConfirmationTranscriptionProofHypotheticalTranscriptionWouldBeFeatureOnlyReady)
        .toBe(true);
      expect(summary.consumerAverageSubmitterSafeConfirmationTranscriptionProofNextAction).toBe(
        R1160_TRANSCRIPTION_PROOF_NEXT_ACTION,
      );
      expect(summary.consumerAverageSubmitterSafeConfirmationTranscriptionProofRequiredInputKindIds)
        .toEqual(FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS);
      expect(summary.consumerAverageSubmitterSafeConfirmationTranscriptionProofRowLevelDataAcceptedByR1160).toBe(false);
      expect(summary.consumerAverageSubmitterSafeConfirmationTranscriptionProofRowOwnerConfirmationStillRequired)
        .toBe(true);
      expect(summary.consumerAverageSubmitterSafeConfirmationTranscriptionProofConfirmationValuesStoredByR1160)
        .toBe(false);
      expect(summary.consumerAverageSubmitterSafeConfirmationTranscriptionProofRowOwnerProvidedValuesStored).toBe(false);
      expect(summary.consumerAverageSubmitterSafeConfirmationMaterializerArtifact).toBe(
        "r1161-feature-only-safe-availability-confirmation-materializer.latest.json",
      );
      expect(summary.consumerAverageSubmitterSafeConfirmationMaterializerCommand).toBe(R1161_MATERIALIZER_COMMAND);
      expect(summary.consumerAverageSubmitterSafeConfirmationMaterializerConclusion).toBe(
        "feature_only_safe_availability_confirmation_materializer_waiting_on_explicit_row_owner_confirmation",
      );
      expect(summary.consumerAverageSubmitterSafeConfirmationMaterializerNextAction).toBe(
        R1161_MATERIALIZER_NEXT_ACTION,
      );
      expect(summary.consumerAverageSubmitterSafeConfirmationMaterializerExplicitRowOwnerConfirmationAssertionProvided)
        .toBe(false);
      expect(summary.consumerAverageSubmitterSafeConfirmationMaterializerSafeConfirmationArtifactWritten).toBe(false);
      expect(summary.consumerAverageSubmitterSafeConfirmationMaterializerSafeConfirmationArtifact).toBeNull();
      expect(summary.consumerAverageSubmitterSafeConfirmationMaterializerFeatureOnlyConfirmationWouldBeReadyForR1150)
        .toBe(false);
      expect(summary.consumerAverageSubmitterSafeConfirmationMaterializerRowOwnerConfirmationStillRequired).toBe(true);
      expect(summary.consumerAverageSubmitterSafeConfirmationMaterializerConfirmationValuesStoredInR1161Packet)
        .toBe(false);
      expect(summary.consumerAverageSubmitterSafeConfirmationMaterializerRowLevelDataAcceptedByR1161).toBe(false);
      expect(summary.consumerAverageSubmitterSafeConfirmationMaterializerRowOwnerPrivateValuesStored).toBe(false);
      expect(summary.consumerAverageSubmitterAvailabilityMissingSourceFamilyIds).toEqual(ORDINARY_SOURCE_FAMILY_IDS);
      expect(summary.consumerAverageSubmitterManifestPacketPrimaryInputFamilyIds).toEqual(
        PRIMARY_SUBMITTER_INPUT_FAMILY_IDS,
      );
      expect(summary.consumerAverageSubmitterManifestPacketMatchedRecipeIds).toEqual([]);
      expect(summary.consumerAverageSubmitterManifestPacketMaterializerCommand).toBe(
        R1143_MANIFEST_RECIPE_MATERIALIZER_COMMAND,
      );
      expect(summary.consumerAverageSubmitterManifestPacketPartialPrivateChainRunnerCommand).toBe(
        R1142_PARTIAL_PRIVATE_CHAIN_RUNNER_COMMAND,
      );
      expect(summary.consumerAverageSubmitterManifestPacketPartialRouteRecipeIds).toEqual(
        PARTIAL_ROUTE_MANIFEST_RECIPE_IDS,
      );
      expect(summary.consumerAverageSubmitterManifestPacketPreferredRecipeIds).toEqual(
        PARTIAL_ROUTE_MANIFEST_RECIPE_IDS,
      );
      expect(summary.consumerAverageSubmitterManifestPacketRecipeReadinessChainCommand).toBe(
        R1144_RECIPE_READINESS_CHAIN_RUNNER_COMMAND,
      );
      expect(summary.consumerAverageSubmitterManifestPacketSafeManifestAttestationsComplete).toBe(false);
      expect(summary.consumerAverageSubmitterAvailabilityChainNextAction).toBe(
        "fill_safe_availability_manifest_then_run_r1136_chain",
      );
      expect(summary.consumerAverageSubmitterPartialRoutePlannerNextAction).toBe(
        "fill_safe_availability_manifest_then_run_r1136_r1137_chain",
      );
      expect(summary.consumerAverageSubmitterPartialMetricIntakeTemplateArtifact).toBe(
        "r1138-fillable-ordinary-consumer-partial-aggregate-metrics.json",
      );
      expect(summary.consumerAverageSubmitterPartialPrivateConfigHandoffTemplateArtifact).toBe(
        "r1139-fillable-ordinary-consumer-partial-private-config.json",
      );
      expect(summary.consumerAverageSubmitterPartialReadinessChainNextAction).toBe(
        "fill_safe_availability_manifest_then_run_r1140_partial_chain",
      );
      expect(summary.consumerAverageSubmitterPartialReadinessChainTemplateArtifact).toBe(
        "r1139-fillable-ordinary-consumer-partial-private-config.json",
      );
      expect(summary.consumerAverageSubmitterPartialPrivateMetricRunnerNextAction).toBe(
        "run_r1140_or_r1139_until_partial_routes_ready",
      );
      expect(summary.consumerAverageSubmitterPartialPrivateMetricRunnerRouteMetricsReadyForR1138).toBe(false);
      expect(summary.consumerAverageSubmitterPartialPrivateChainNextAction).toBe(
        "fill_safe_availability_manifest_then_run_r1142_partial_private_chain",
      );
      expect(summary.consumerAverageSubmitterPartialPrivateChainRouteMetricsReadyForR1138).toBe(false);
      expect(summary.consumerAverageSubmitterRowOwnerActionPacketNextAction).toBe(
        "confirm_recommended_lab_plus_wearable_recipe_availability_assertions",
      );
      expect(summary.consumerAverageSubmitterRowOwnerActionPacketSelectedRecipeId).toBe(
        "lab_plus_wearable_minimum_manifest",
      );
      expect(summary.consumerAverageSubmitterRowOwnerActionPacketRecommendedConfirmedRecipeCommand).toBe(
        R1146_RECOMMENDED_CONFIRMED_RECIPE_COMMAND,
      );
      expect(summary.consumerAverageSubmitterPostConfirmationPrivateConfigPacketNextAction).toBe(
        "run_recommended_confirmed_recipe_chain_before_private_config_packet",
      );
      expect(summary.consumerAverageSubmitterPostConfirmationPrivateConfigPacketExpectedRouteIds).toEqual(
        LAB_WEARABLE_MINIMUM_ROUTE_IDS,
      );
      expect(summary.consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigSchemaVersion)
        .toBe(R1147_RUNNER_CONFIG_SCHEMA_VERSION);
      expect(summary.consumerAverageSubmitterPostConfirmationPrivateConfigPacketRunnerConfigRouteRunOrder)
        .toEqual(LAB_WEARABLE_MINIMUM_ROUTE_IDS);
      expect(summary.consumerAverageSubmitterPostConfirmationPrivateConfigPacketTemplateArtifact).toBe(
        R1147_PRIVATE_CONFIG_TEMPLATE_ARTIFACT,
      );
      expect(summary.consumerAverageSubmitterPostConfirmationPrivateConfigPacketTemplateReadyForFill).toBe(false);
      expect(summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeNextAction).toBe(
        "fill_safe_availability_confirmation_from_template",
      );
      expect(summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakePrivateConfigStatus).toBe("missing");
      expect(summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeReadyForR1142).toBe(false);
      expect(summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeActionGuardPresent).toBe(true);
      expect(summary.consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketNextAction)
        .toBe("fill_safe_availability_confirmation_from_template");
      expect(
        summary
          .consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds,
      ).toEqual(FEATURE_ONLY_SOURCE_FAMILY_IDS);
      expect(
        summary
          .consumerAverageSubmitterPostConfirmationPrivateConfigIntakeSafeAvailabilityActionPacketMissingRequiredSourceFamilyIds,
      ).toEqual(REQUIRED_SOURCE_FAMILY_IDS);
      expect(summary.consumerAverageSubmitterLabWearableSubmissionKitNextAction).toBe(
        "confirm_lab_plus_wearable_recipe_availability_assertions",
      );
      expect(summary.consumerAverageSubmitterLabWearableSubmissionKitRequiredSourceFamilyIds).toEqual([
        "outcome_linkage",
        "join_time_alignment",
        "bloodwork_glycemia",
        "wearable_activity_daily",
      ]);
      expect(summary.consumerAverageSubmitterLabWearableSubmissionKitTopBlocker).toBe(
        "row_owner_availability_assertions_not_confirmed",
      );
      expect(summary.consumerAverageSubmitterSafeAvailabilityConfirmationNextAction).toBe(
        "fill_safe_availability_confirmation_from_template",
      );
      expect(summary.consumerAverageSubmitterSafeAvailabilityConfirmationFeatureOnlyCoverageContextReady).toBe(false);
      expect(summary.consumerAverageSubmitterSafeAvailabilityConfirmationChecklistItemIds)
        .toEqual(ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS);
      expect(summary.consumerAverageSubmitterSafeAvailabilityConfirmationMinimumFeaturePairRequired)
        .toEqual(FEATURE_ONLY_SOURCE_FAMILY_IDS);
      expect(summary.consumerAverageSubmitterSafeAvailabilityConfirmationMissingFeatureOnlySourceFamilyIds)
        .toEqual(FEATURE_ONLY_SOURCE_FAMILY_IDS);
      expect(summary.consumerAverageSubmitterSafeAvailabilityConfirmationOutcomeLinkageRequiredForFeatureOnlyContext)
        .toBe(false);
      expect(summary.consumerAverageSubmitterSafeAvailabilityConfirmationReadyForRecipeReadinessChain).toBe(false);
      expect(summary.consumerAverageSubmitterSafeAvailabilityConfirmationRowLevelDataAcceptedByR1150).toBe(false);
      expect(summary.consumerAverageSubmitterSafeAvailabilityConfirmationStatus).toBe("missing");
      expect(summary.consumerAverageSubmitterSafeAvailabilityConfirmationTemplateArtifact).toBe(
        "r1150-fillable-ordinary-consumer-safe-availability-confirmation.json",
      );
      expect(summary.consumerAverageSubmitterSafeAvailabilityConfirmationFeatureOnlyTemplateArtifact).toBe(
        "r1150-fillable-feature-only-safe-availability-confirmation.json",
      );
      expect(summary.consumerAverageSubmitterSafeAvailabilityActionPacketConclusion).toBe(
        "safe_availability_action_packet_waiting_on_safe_confirmation",
      );
      expect(summary.consumerAverageSubmitterSafeAvailabilityActionPacketNextAction).toBe(
        "fill_safe_availability_confirmation_from_template",
      );
      expect(summary.consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyCoverageContextReady)
        .toBe(false);
      expect(summary.consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyQuickstartArtifact).toBe(
        R1154_FEATURE_ONLY_QUICKSTART_ARTIFACT,
      );
      expect(summary.consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount)
        .toBe(R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length);
      expect(summary.consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths)
        .toEqual(R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS);
      expect(summary.consumerAverageSubmitterSafeAvailabilityActionPacketChecklistItemIds)
        .toEqual(ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS);
      expect(summary.consumerAverageSubmitterSafeAvailabilityActionPacketMinimumFeaturePairRequired)
        .toEqual(FEATURE_ONLY_SOURCE_FAMILY_IDS);
      expect(summary.consumerAverageSubmitterSafeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds)
        .toEqual(FEATURE_ONLY_SOURCE_FAMILY_IDS);
      expect(summary.consumerAverageSubmitterSafeAvailabilityActionPacketMissingRequiredSourceFamilyIds)
        .toEqual(REQUIRED_SOURCE_FAMILY_IDS);
      expect(summary.consumerAverageSubmitterSafeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain)
        .toBe(false);
      expect(summary.consumerAverageSubmitterSafeAvailabilityActionPacketRowLevelDataAcceptedByR1154).toBe(false);
      expect(summary.consumerAverageSubmitterSafeAvailabilityActionPacketRowParsingPerformedByR1154).toBe(false);
      expect(summary.consumerAverageSubmitterSafeAvailabilityActionPacketTemplateArtifact).toBe(
        "r1150-fillable-ordinary-consumer-safe-availability-confirmation.json",
      );
      expect(summary.consumerAverageSubmitterSafeAvailabilityActionPacketFeatureOnlyTemplateArtifact).toBe(
        "r1150-fillable-feature-only-safe-availability-confirmation.json",
      );
      expect(summary.consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofArtifact).toBe(
        "r1155-ordinary-consumer-safe-confirmation-feature-only-smoke-proof.latest.json",
      );
      expect(summary.consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofConclusion).toBe(
        "ordinary_safe_confirmation_feature_only_smoke_passed_non_evidence",
      );
      expect(summary.consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofNextAction).toBe(
        "use_r1150_r1153_path_with_real_safe_availability_confirmation",
      );
      expect(summary.consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofFeatureOnlyChainConclusion).toBe(
        "ordinary_feature_only_chain_ready_research_only",
      );
      expect(
        summary
          .consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofFeatureOnlyCoverageContextReadyForResearchPlanning,
      ).toBe(true);
      expect(summary.consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofSafeAvailabilityConfirmationConclusion)
        .toBe("safe_availability_confirmation_feature_only_ready_research_only");
      expect(summary.consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofReadyForRecipeReadinessChain)
        .toBe(false);
      expect(summary.consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofModelEvidencePromotionAllowed)
        .toBe(false);
      expect(summary.consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofRowLevelDataAcceptedByR1155)
        .toBe(false);
      expect(summary.consumerAverageSubmitterSafeConfirmationFeatureOnlySmokeProofSmokeEvidence).toBe(false);
      expect(summary.consumerAverageSubmitterSafeConfirmationChainRunnerConclusion).toBe(
        "ordinary_safe_confirmation_chain_waiting_on_safe_confirmation",
      );
      expect(summary.consumerAverageSubmitterFeatureOnlyModeNextAction).toBe(
        "fill_safe_availability_confirmation_from_template",
      );
      expect(summary.consumerAverageSubmitterFeatureOnlyModeCoverageContextAllowed).toBe(false);
      expect(summary.consumerAverageSubmitterFeatureOnlyModeMinimumFeaturePairRequired)
        .toEqual(FEATURE_ONLY_SOURCE_FAMILY_IDS);
      expect(summary.consumerAverageSubmitterFeatureOnlyModeModelEvidencePromotionAllowed).toBe(false);
      expect(summary.consumerAverageSubmitterFeatureOnlyModeOutcomeLinkageRequiredForFeatureOnlyContext).toBe(false);
      expect(summary.consumerAverageSubmitterFeatureOnlyModeSafeAvailabilityFeatureOnlyCoverageContextReady)
        .toBe(false);
      expect(summary.consumerAverageSubmitterFeatureOnlyModeSafeAvailabilityFeatureOnlyReadinessPresent).toBe(true);
      expect(summary.consumerAverageSubmitterFeatureOnlyModeRowLevelDataAcceptedByR1151).toBe(false);
      expect(summary.consumerAverageSubmitterFeatureOnlyModeMissingPrimaryFeatureFamilyIds).toEqual([
        "bloodwork_glycemia",
        "wearable_activity_daily",
      ]);
      expect(summary.consumerAverageSubmitterFeatureOnlyCoverageContextIntakeConclusion).toBe(
        "feature_only_coverage_context_waiting_on_r1151_ready",
      );
      expect(summary.consumerAverageSubmitterFeatureOnlyCoverageContextIntakeContextStatus).toBe("missing");
      expect(summary.consumerAverageSubmitterFeatureOnlyCoverageContextIntakeReadyForResearchPlanning).toBe(false);
      expect(summary.consumerAverageSubmitterFeatureOnlyCoverageContextIntakeMinimumFeaturePairRequired)
        .toEqual(FEATURE_ONLY_SOURCE_FAMILY_IDS);
      expect(summary.consumerAverageSubmitterFeatureOnlyCoverageContextIntakeMissingPrimaryFeatureFamilyIds)
        .toEqual(FEATURE_ONLY_SOURCE_FAMILY_IDS);
      expect(summary.consumerAverageSubmitterFeatureOnlyCoverageContextIntakeModelEvidencePromotionAllowed)
        .toBe(false);
      expect(summary.consumerAverageSubmitterFeatureOnlyCoverageContextIntakeNextAction).toBe(
        "refresh_r1151_feature_only_submission_mode",
      );
      expect(summary.consumerAverageSubmitterFeatureOnlyCoverageContextIntakeOutcomeLinkageRequiredForFeatureOnlyContext)
        .toBe(false);
      expect(summary.consumerAverageSubmitterFeatureOnlyCoverageContextIntakeR1151ReadyForIntake).toBe(false);
      expect(summary.consumerAverageSubmitterFeatureOnlyCoverageContextIntakeRowLevelDataAcceptedByR1152).toBe(false);
      expect(summary.consumerAverageSubmitterFeatureOnlyChainConclusion).toBe(
        "ordinary_feature_only_chain_waiting_on_safe_availability_confirmation",
      );
      expect(summary.consumerAverageSubmitterFeatureOnlyChainCoverageContextReadyForResearchPlanning).toBe(false);
      expect(summary.consumerAverageSubmitterFeatureOnlyChainCoverageContextAllowed).toBe(false);
      expect(summary.consumerAverageSubmitterFeatureOnlyChainModelEvidencePromotionAllowed).toBe(false);
      expect(summary.consumerAverageSubmitterFeatureOnlyChainRowLevelDataAcceptedByR1153).toBe(false);
      expect(summary.consumerAverageSubmitterSourceFamilyMissingSlotRollup).toContainEqual({
        familyId: "bloodwork_glycemia",
        missingSlotCount: 4,
        missingSlotIds: [
          "L1_tiny_glycemia_only",
          "L2_common_lab_core_shadow",
          "labGlycemia",
          "labTableRef",
        ],
        status: "needs_private_config",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("localPaths");
      expect(stdout).not.toContain("rowValues");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtures(
  tmp: string,
): Promise<{
  r1057Path: string;
  r1059Path: string;
  r1061Path: string;
  r1062Path: string;
  r1083AggregatePacketPath: string;
  r1084HaalsiPath: string;
  r1101Path: string;
  r1128Path: string;
  r1129Path: string;
  r1130Path: string;
  r1132Path: string;
  r1133Path: string;
  r1134Path: string;
  r1135Path: string;
  r1136Path: string;
  r1137Path: string;
  r1138Path: string;
  r1139Path: string;
  r1140Path: string;
  r1141Path: string;
  r1142Path: string;
  r1145Path: string;
  r1146Path: string;
  r1147Path: string;
  r1148Path: string;
  r1149Path: string;
  r1150Path: string;
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
  r1174Path: string;
  r1176Path: string;
  r1185Path: string;
  r1187Path: string;
}> {
  const r1057Path = path.join(tmp, "r1057.json");
  const r1059Path = path.join(tmp, "r1059.json");
  const r1061Path = path.join(tmp, "r1061.json");
  const r1062Path = path.join(tmp, "r1062.json");
  const r1083AggregatePacketPath = path.join(tmp, "missing-r1083-aggregate.json");
  const r1084HaalsiPath = path.join(tmp, "missing-r1084-haalsi.json");
  const r1101Path = path.join(tmp, "r1101.json");
  const r1128Path = path.join(tmp, "r1128.json");
  const r1129Path = path.join(tmp, "r1129.json");
  const r1130Path = path.join(tmp, "r1130.json");
  const r1132Path = path.join(tmp, "r1132.json");
  const r1133Path = path.join(tmp, "r1133.json");
  const r1134Path = path.join(tmp, "r1134.json");
  const r1135Path = path.join(tmp, "r1135.json");
  const r1136Path = path.join(tmp, "r1136.json");
  const r1137Path = path.join(tmp, "r1137.json");
  const r1138Path = path.join(tmp, "r1138.json");
  const r1139Path = path.join(tmp, "r1139.json");
  const r1140Path = path.join(tmp, "r1140.json");
  const r1141Path = path.join(tmp, "r1141.json");
  const r1142Path = path.join(tmp, "r1142.json");
  const r1145Path = path.join(tmp, "missing-r1145.json");
  const r1146Path = path.join(tmp, "r1146.json");
  const r1147Path = path.join(tmp, "r1147.json");
  const r1148Path = path.join(tmp, "r1148.json");
  const r1149Path = path.join(tmp, "r1149.json");
  const r1150Path = path.join(tmp, "r1150.json");
  const r1151Path = path.join(tmp, "r1151.json");
  const r1152Path = path.join(tmp, "r1152.json");
  const r1153Path = path.join(tmp, "r1153.json");
  const r1154Path = path.join(tmp, "r1154.json");
  const r1155Path = path.join(tmp, "r1155.json");
  const r1156Path = path.join(tmp, "r1156.json");
  const r1157Path = path.join(tmp, "r1157.json");
  const r1158Path = path.join(tmp, "r1158.json");
  const r1159Path = path.join(tmp, "r1159.json");
  const r1160Path = path.join(tmp, "r1160.json");
  const r1161Path = path.join(tmp, "r1161.json");
  const r1162Path = path.join(tmp, "missing-r1162.json");
  const r1163Path = path.join(tmp, "missing-r1163.json");
  const r1174Path = path.join(tmp, "missing-r1174.json");
  const r1176Path = path.join(tmp, "missing-r1176.json");
  const r1185Path = path.join(tmp, "missing-r1185.json");
  const r1187Path = path.join(tmp, "missing-r1187.json");
  await Promise.all([
    writeFile(r1057Path, `${JSON.stringify({
      artifactBoundary: safeBoundary("R1057"),
      batchResult: {
        nextLocalAction: "prepare_true_wearable_or_partner_validation_loop",
        reviewGptRequiredBeforeNextLocalRun: false,
      },
      packetId: "r1057-function-activity-pulse-candidate-batch-result",
      schemaVersion: "murph-age-r1057-function-activity-pulse-candidate-batch-result.v1",
      status: "research-local-aggregate-only",
      summary: {
        currentLead: "function_activity_mobility_shadow",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1057: false,
      },
    })}\n`),
    writeFile(r1059Path, `${JSON.stringify({
      artifactBoundary: safeBoundary("R1059"),
      packetId: "r1059-true-wearable-aggregate-receipt-intake",
      schemaVersion: "murph-age-r1059-true-wearable-aggregate-receipt-intake.v1",
      status: "research-local-aggregate-only",
      summary: {
        conclusion: "aggregate_receipt_missing",
        productDisplayAuthorized: false,
      },
    })}\n`),
    writeFile(r1061Path, `${JSON.stringify({
      artifactBoundary: safeBoundary("R1061"),
      packetId: "r1061-true-wearable-data-unblocker",
      schemaVersion: "murph-age-r1061-true-wearable-data-unblocker.v1",
      status: "research-local-aggregate-only",
      summary: {
        productDisplayAuthorized: false,
        publicActivityBridgeStatus: "wrist_shadow_inconclusive_keep_shadow",
      },
    })}\n`),
    writeFile(r1062Path, `${JSON.stringify({
      artifactBoundary: safeBoundary("R1062"),
      packetId: "r1062-true-wearable-aggregate-receipt-template",
      receiptTemplateArtifact: "r1062-fillable-aggregate-receipt-template.json",
      schemaVersion: "murph-age-r1062-true-wearable-aggregate-receipt-template.v1",
      status: "research-local-aggregate-only",
      summary: {
        productDisplayAuthorized: false,
        templateReadyForDataFill: true,
      },
    })}\n`),
    writeFile(r1101Path, `${JSON.stringify(r1101Fixture(
      "consumer_loop_repair_inputs",
      "repair_consumer_lab_wearable_chain",
    ))}\n`),
    writeFile(r1128Path, `${JSON.stringify(r1128Fixture())}\n`),
    writeFile(r1129Path, `${JSON.stringify(r1129Fixture())}\n`),
    writeFile(r1130Path, `${JSON.stringify(r1130Fixture())}\n`),
    writeFile(r1132Path, `${JSON.stringify(r1132Fixture())}\n`),
    writeFile(r1133Path, `${JSON.stringify(r1133Fixture())}\n`),
    writeFile(r1134Path, `${JSON.stringify(r1134Fixture())}\n`),
    writeFile(r1135Path, `${JSON.stringify(r1135Fixture())}\n`),
    writeFile(r1136Path, `${JSON.stringify(r1136Fixture())}\n`),
    writeFile(r1137Path, `${JSON.stringify(r1137Fixture())}\n`),
    writeFile(r1138Path, `${JSON.stringify(r1138Fixture())}\n`),
    writeFile(r1139Path, `${JSON.stringify(r1139Fixture())}\n`),
    writeFile(r1140Path, `${JSON.stringify(r1140Fixture())}\n`),
    writeFile(r1141Path, `${JSON.stringify(r1141Fixture())}\n`),
    writeFile(r1142Path, `${JSON.stringify(r1142Fixture())}\n`),
    writeFile(r1146Path, `${JSON.stringify(r1146Fixture())}\n`),
    writeFile(r1147Path, `${JSON.stringify(r1147Fixture())}\n`),
    writeFile(r1148Path, `${JSON.stringify(r1148Fixture())}\n`),
    writeFile(r1149Path, `${JSON.stringify(r1149Fixture())}\n`),
    writeFile(r1150Path, `${JSON.stringify(r1150Fixture())}\n`),
    writeFile(r1151Path, `${JSON.stringify(r1151Fixture())}\n`),
    writeFile(r1152Path, `${JSON.stringify(r1152Fixture())}\n`),
    writeFile(r1153Path, `${JSON.stringify(r1153Fixture())}\n`),
    writeFile(r1154Path, `${JSON.stringify(r1154Fixture())}\n`),
    writeFile(r1155Path, `${JSON.stringify(r1155Fixture())}\n`),
    writeFile(r1156Path, `${JSON.stringify(r1156Fixture())}\n`),
    writeFile(r1157Path, `${JSON.stringify(r1157Fixture())}\n`),
    writeFile(r1158Path, `${JSON.stringify(r1158Fixture())}\n`),
    writeFile(r1159Path, `${JSON.stringify(r1159Fixture())}\n`),
    writeFile(r1160Path, `${JSON.stringify(r1160Fixture())}\n`),
    writeFile(r1161Path, `${JSON.stringify(r1161Fixture())}\n`),
  ]);
  return {
    r1057Path,
    r1059Path,
    r1061Path,
    r1062Path,
    r1083AggregatePacketPath,
    r1084HaalsiPath,
    r1101Path,
    r1128Path,
    r1129Path,
    r1130Path,
    r1132Path,
    r1133Path,
    r1134Path,
    r1135Path,
    r1136Path,
    r1137Path,
    r1138Path,
    r1139Path,
    r1140Path,
    r1141Path,
    r1142Path,
    r1145Path,
    r1146Path,
    r1147Path,
    r1148Path,
    r1149Path,
    r1150Path,
    r1151Path,
    r1152Path,
    r1153Path,
    r1154Path,
    r1155Path,
    r1156Path,
    r1157Path,
    r1158Path,
    r1159Path,
    r1160Path,
    r1161Path,
    r1162Path,
    r1163Path,
    r1174Path,
    r1176Path,
    r1185Path,
    r1187Path,
  };
}

async function writeSyntheticNsrrAnalyticCache(filePath: string, rowCount: number): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const header = [
    "split",
    "primary_event",
    "age_years",
    "sex_stratum",
    "analysis_weight",
    "eligible_endpoint",
    "body_mass_index",
    "systolic_blood_pressure",
    "diastolic_blood_pressure",
    "clinical_context_score",
    "sleep_duration_hours",
    "sleep_efficiency",
    "sleep_midpoint_variability",
    "sleep_regularity_index",
    "apnea_hypopnea_index",
    "mean_spo2",
    "min_spo2",
    "resting_heart_rate",
    "heart_rate_variability",
    "mean_daily_activity",
    "sedentary_minutes",
    "active_minutes",
    "sleep_wake_transition_count",
    "valid_night_count",
    "recording_minutes",
    "wear_time_minutes",
  ];
  const rows = [header.join(",")];
  for (let index = 0; index < rowCount; index += 1) {
    const split = index < rowCount * 0.5 ? "train" : index < rowCount * 0.75 ? "calibration" : "test";
    const age = 42 + (index % 34);
    const male = index % 2;
    const adverse = ((index * 17) % 100) / 100 > 0.58 ? 1 : 0;
    const event = adverse + 0.015 * (age - 55) + 0.12 * male + (((index * 37) % 100) / 100 - 0.45) > 0.55
      ? 1
      : 0;
    rows.push([
      split,
      String(event),
      age.toFixed(1),
      male === 1 ? "male" : "female",
      "1",
      "1",
      (24 + 4 * adverse + (index % 5) * 0.2).toFixed(2),
      (116 + 8 * adverse + (index % 7)).toFixed(2),
      (72 + 3 * adverse + (index % 4)).toFixed(2),
      (0.2 * adverse + (index % 3) * 0.05).toFixed(3),
      (7.4 - 1.2 * adverse + (index % 4) * 0.05).toFixed(2),
      (0.91 - 0.12 * adverse + (index % 5) * 0.005).toFixed(3),
      (0.2 + 1.4 * adverse + (index % 5) * 0.02).toFixed(3),
      (0.82 - 0.22 * adverse + (index % 4) * 0.01).toFixed(3),
      (5 + 22 * adverse + (index % 8)).toFixed(2),
      (96 - 2 * adverse - (index % 3) * 0.1).toFixed(2),
      (90 - 5 * adverse - (index % 4) * 0.2).toFixed(2),
      (58 + 9 * adverse + (index % 5)).toFixed(2),
      (45 - 14 * adverse - (index % 6)).toFixed(2),
      (4200 - 1600 * adverse + (index % 9) * 10).toFixed(2),
      (470 + 90 * adverse + (index % 7)).toFixed(2),
      (42 - 18 * adverse + (index % 5)).toFixed(2),
      (8 + 5 * adverse + (index % 6)).toFixed(2),
      (5 + (index % 3)).toFixed(0),
      (430 + (index % 8) * 2).toFixed(2),
      (410 + (index % 9) * 2).toFixed(2),
    ].join(","));
  }
  await writeFile(filePath, gzipSync(`${rows.join("\n")}\n`));
}

async function writePrivateNsrrManifest(manifestPath: string, sourcePath: string, analyticCachePath: string): Promise<void> {
  await writeFile(manifestPath, `${JSON.stringify({
    columnMap: {
      active_minutes: "src_active_minutes",
      age_years: "src_age",
      analysis_weight: { constant: 1 },
      apnea_hypopnea_index: "src_ahi",
      body_mass_index: "src_bmi",
      clinical_context_score: "src_clinical_context",
      diastolic_blood_pressure: "src_dbp",
      eligible_endpoint: { constant: 1 },
      heart_rate_variability: "src_hrv",
      mean_daily_activity: "src_activity",
      mean_spo2: "src_mean_spo2",
      min_spo2: "src_min_spo2",
      primary_event: "src_event",
      recording_minutes: "src_recording_minutes",
      resting_heart_rate: "src_rhr",
      sedentary_minutes: "src_sedentary",
      sex_stratum: "src_sex",
      sleep_duration_hours: "src_sleep_duration",
      sleep_efficiency: "src_sleep_efficiency",
      sleep_midpoint_variability: "src_midpoint_variability",
      sleep_regularity_index: "src_sleep_regularity",
      sleep_wake_transition_count: "src_transitions",
      split: "src_split",
      systolic_blood_pressure: "src_sbp",
      valid_night_count: "src_valid_nights",
      wear_time_minutes: "src_wear_time",
    },
    endpoint: "all_cause_mortality",
    horizon: "10y",
    outputAnalyticCachePath: analyticCachePath,
    schemaVersion: R1079_NSRR_SLEEP_AUTONOMIC_STANDARDIZER_SCHEMA_VERSION,
    sourceTablePath: sourcePath,
  })}\n`);
}

function runtimeCachePath(tmp: string, fileName: string): string {
  return path.join(
    process.cwd(),
    ".runtime",
    "cache",
    "murph-age",
    "nsrr-sleep-autonomic",
    "derived",
    "analytic",
    `${path.basename(tmp)}-${fileName}`,
  );
}

async function writePrivateNsrrSource(sourcePath: string, rowCount: number): Promise<void> {
  const header = [
    "src_local_id",
    "src_split",
    "src_event",
    "src_age",
    "src_sex",
    "src_bmi",
    "src_sbp",
    "src_dbp",
    "src_clinical_context",
    "src_sleep_duration",
    "src_sleep_efficiency",
    "src_midpoint_variability",
    "src_sleep_regularity",
    "src_ahi",
    "src_mean_spo2",
    "src_min_spo2",
    "src_rhr",
    "src_hrv",
    "src_activity",
    "src_sedentary",
    "src_active_minutes",
    "src_transitions",
    "src_valid_nights",
    "src_recording_minutes",
    "src_wear_time",
  ];
  const rows = [header.join(",")];
  for (let index = 0; index < rowCount; index += 1) {
    const split = index < rowCount * 0.5 ? "train" : index < rowCount * 0.75 ? "calibration" : "test";
    const age = 42 + (index % 34);
    const male = index % 2;
    const adverse = ((index * 17) % 100) / 100 > 0.58 ? 1 : 0;
    const event = adverse + 0.015 * (age - 55) + 0.12 * male + (((index * 37) % 100) / 100 - 0.45) > 0.55
      ? 1
      : 0;
    rows.push([
      `local-${index}`,
      split,
      String(event),
      age.toFixed(1),
      male === 1 ? "M" : "F",
      (24 + 4 * adverse + (index % 5) * 0.2).toFixed(2),
      (116 + 8 * adverse + (index % 7)).toFixed(2),
      (72 + 3 * adverse + (index % 4)).toFixed(2),
      (0.2 * adverse + (index % 3) * 0.05).toFixed(3),
      (7.4 - 1.2 * adverse + (index % 4) * 0.05).toFixed(2),
      (0.91 - 0.12 * adverse + (index % 5) * 0.005).toFixed(3),
      (0.2 + 1.4 * adverse + (index % 5) * 0.02).toFixed(3),
      (0.82 - 0.22 * adverse + (index % 4) * 0.01).toFixed(3),
      (5 + 22 * adverse + (index % 8)).toFixed(2),
      (96 - 2 * adverse - (index % 3) * 0.1).toFixed(2),
      (90 - 5 * adverse - (index % 4) * 0.2).toFixed(2),
      (58 + 9 * adverse + (index % 5)).toFixed(2),
      (45 - 14 * adverse - (index % 6)).toFixed(2),
      (4200 - 1600 * adverse + (index % 9) * 10).toFixed(2),
      (470 + 90 * adverse + (index % 7)).toFixed(2),
      (42 - 18 * adverse + (index % 5)).toFixed(2),
      (8 + 5 * adverse + (index % 6)).toFixed(2),
      (5 + (index % 3)).toFixed(0),
      (430 + (index % 8) * 2).toFixed(2),
      (410 + (index % 9) * 2).toFixed(2),
    ].join(","));
  }
  await writeFile(sourcePath, `${rows.join("\n")}\n`);
}

async function writeCandidateNsrrTable(scanRoot: string): Promise<void> {
  await mkdir(path.join(scanRoot, "candidate"), { recursive: true });
  await writeFile(path.join(scanRoot, "candidate", "candidate-source.csv"), [
    [
      "src_event",
      "src_age",
      "src_sex",
      "src_sleep_duration",
      "src_ahi",
      "src_rhr",
      "src_activity",
    ].join(","),
    [
      "1",
      "72",
      "M",
      "6.5",
      "18",
      "64",
      "2100",
    ].join(","),
  ].join("\n") + "\n");
}

async function writeZip(root: string, zipName: string, entries: Record<string, string>): Promise<void> {
  const staging = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1076-zip-"));
  try {
    await Promise.all(Object.entries(entries).map(async ([entryPath, content]) => {
      const fullPath = path.join(staging, entryPath);
      await mkdir(path.dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content);
    }));
    execFileSync("zip", ["-qr", path.join(root, zipName), "."], { cwd: staging });
    expect(await readFile(path.join(root, zipName))).toBeTruthy();
  } finally {
    await rm(staging, { force: true, recursive: true });
  }
}

function r1101Fixture(conclusion: string, nextAction: string): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1101"),
    loopState: {
      consumerPriority: "labs_vitals_body_wearables_for_roughly_16_50",
    },
    packetId: "r1101-consumer-labs-wearables-loop-executor",
    schemaVersion: "murph-age-r1101-consumer-labs-wearables-loop-executor.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      firstPassAggregateMetricsTemplateArtifact: "r1124-fillable-consumer-first-pass-aggregate-metrics.json",
      firstWearableCandidate: "W1_activity_steps_minutes",
      missingFirstPassMetricCandidateIds: [
        "L1_tiny_glycemia_only",
        "L2_common_lab_core_shadow",
        "W1_activity_steps_minutes",
        "QC_missingness_coverage",
      ],
      nextAction,
      ordinaryConsumerSubmissionHandoffPlanArtifact: "r1127-fillable-ordinary-consumer-first-pass-submission-plan.json",
      ordinaryConsumerSourceFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
      ordinaryConsumerTableLayouts: ORDINARY_TABLE_LAYOUTS,
      productDisplayAuthorized: false,
      reviewGptRequiredNow: conclusion === "consumer_loop_ready_for_reviewgpt_delta",
      rowParsingPerformedByR1101: false,
    },
  };
}

function r1128Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1128"),
    packetId: "r1128-ordinary-consumer-pipeline-smoke-proof",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1128-ordinary-consumer-pipeline-smoke-proof.v1",
    smokeProof: {
      ordinaryTableLayoutsSmokePassed: ORDINARY_TABLE_LAYOUTS,
      ordinaryTableLayoutSmokeResults: ORDINARY_TABLE_LAYOUTS.map((ordinaryTableLayout) => ({
        aggregateMetricsArtifact: "r1125-consumer-first-pass-aggregate-metrics.json",
        ordinaryTableLayout,
        r1122Conclusion: "local_private_runner_config_ready_for_local_aggregate_receipt",
        r1124Conclusion: "consumer_first_pass_aggregate_receipt_ready_for_reviewgpt",
        r1125Conclusion: "local_private_first_pass_runner_ready_for_reviewgpt_delta",
      })),
      r1122Conclusion: "local_private_runner_config_ready_for_local_aggregate_receipt",
      r1124ConclusionFromSyntheticRun: "consumer_first_pass_aggregate_receipt_ready_for_reviewgpt",
      r1125Conclusion: "local_private_first_pass_runner_ready_for_reviewgpt_delta",
      syntheticEvidenceRole: "pipeline_smoke_only_not_model_evidence",
      syntheticRowsPersisted: false,
    },
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "ordinary_consumer_pipeline_smoke_passed_non_evidence",
      nextAction: "use_r1127_handoff_with_real_private_or_workbench_data",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1128: false,
      syntheticEvidence: false,
    },
  };
}

function r1129Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1129"),
    packetId: "r1129-consumer-real-evidence-gate",
    productDisplayAuthorized: false,
    realEvidenceGate: {
      blockers: [
        "real_outcome_linked_labs_wearables_aggregate_missing",
        "r1124_first_pass_aggregate_metrics_not_provided",
        "l1_l2_w1_qc_first_pass_metrics_incomplete",
      ],
    },
    schemaVersion: "murph-age-r1129-consumer-real-evidence-gate.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "consumer_real_evidence_gate_waiting_on_real_labs_wearables_aggregate",
      nextAction: "collect_or_run_real_outcome_linked_labs_wearables_aggregate_metrics",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1129: false,
    },
  };
}

function r1130Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1130"),
    packetId: "r1130-ordinary-consumer-real-evidence-handoff",
    productDisplayAuthorized: false,
    realEvidenceHandoff: {
      blockers: [
        "real_outcome_linked_labs_wearables_aggregate_missing",
        "r1124_first_pass_aggregate_metrics_not_provided",
        "l1_l2_w1_qc_first_pass_metrics_incomplete",
        "private_config_not_ready_for_r1125",
      ],
      currentPrivateConfig: {
        missingFirstPassCandidateIds: [
          "L1_tiny_glycemia_only",
          "L2_common_lab_core_shadow",
          "W1_activity_steps_minutes",
          "QC_missingness_coverage",
        ],
        missingSemanticRefFamilies: [
          "personJoinKey",
          "dateOrTimeKey",
          "outcomeEvent",
          "labGlycemia",
          "commonLabCore",
          "vitalsBody",
          "wearableActivity",
        ],
        missingSubmissionContextFields: [
          "evidenceRole",
          "ordinaryConsumerSubmission",
          "outcomeLinked",
          "priorityInputFamilies",
          "targetAgeBand",
        ],
        missingTableRefs: [
          "primaryTableRef",
          "outcomeTableRef",
          "labTableRef",
          "wearableTableRef",
        ],
        readiness: "private_config_needs_completion",
      },
      missingConfigChecklist: [
        ...[
          "L1_tiny_glycemia_only",
          "L2_common_lab_core_shadow",
          "W1_activity_steps_minutes",
          "QC_missingness_coverage",
        ].map((slotId) => ({
          acceptedTableLayouts: [],
          detail: "include_candidate_in_private_config_candidate_run_order",
          requiredForCandidateIds: [slotId],
          slotId,
          slotType: "first_pass_candidate",
        })),
        ...[
          "personJoinKey",
          "dateOrTimeKey",
          "outcomeEvent",
          "labGlycemia",
          "commonLabCore",
          "vitalsBody",
          "wearableActivity",
        ].map((slotId) => ({
          acceptedTableLayouts: [],
          detail: "required_semantic_ref_family_for_first_pass",
          requiredForCandidateIds: [],
          slotId,
          slotType: "semantic_ref_family",
        })),
        ...[
          "evidenceRole",
          "ordinaryConsumerSubmission",
          "outcomeLinked",
          "priorityInputFamilies",
          "targetAgeBand",
        ].map((slotId) => ({
          acceptedTableLayouts: [],
          detail: "complete_required_submission_context_field",
          requiredForCandidateIds: [],
          slotId,
          slotType: "submission_context_field",
        })),
        ...[
          "primaryTableRef",
          "outcomeTableRef",
          "labTableRef",
          "wearableTableRef",
        ].map((slotId) => ({
          acceptedTableLayouts: ORDINARY_TABLE_LAYOUTS,
          detail: "provide_table_ref_slot_or_use_single_primary_table_fallback",
          requiredForCandidateIds: [],
          slotId,
          slotType: "table_ref",
        })),
      ],
    },
    schemaVersion: "murph-age-r1130-ordinary-consumer-real-evidence-handoff.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "ordinary_consumer_real_evidence_handoff_ready_for_row_owner_config",
      nextAction: "complete_private_config_for_real_outcome_linked_labs_wearables",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowOwnerWorkType: "complete_private_config",
      rowParsingPerformedByR1130: false,
    },
  };
}

function r1132Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1132"),
    ordinaryConsumerReadiness: {
      blockers: [
        "real_outcome_linked_labs_wearables_aggregate_missing",
        "r1124_first_pass_aggregate_metrics_not_provided",
        "l1_l2_w1_qc_first_pass_metrics_incomplete",
        "private_config_not_ready_for_r1125",
        "r1125_real_aggregate_metrics_not_materialized",
      ],
      completionAudit: {
        goalAchieved: false,
        readyToMarkComplete: false,
        topMissingRequirement: "real_outcome_linked_labs_wearables_aggregate_exists",
      },
      missingSlotSummary: {
        bySlotType: {
          first_pass_candidate: 4,
          semantic_ref_family: 7,
          submission_context_field: 5,
          table_ref: 4,
        },
        total: 20,
      },
      readyForPrivateRunner: false,
      sourceFamilies: ordinarySourceFamilyMissingSlotRollup(),
    },
    packetId: "r1132-ordinary-consumer-submission-readiness",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1132-ordinary-consumer-submission-readiness.v1",
    status: "research-local-aggregate-only",
    summary: {
      averageSubmitterFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
      conclusion: "ordinary_consumer_submission_readiness_ready_for_row_owner_mapping",
      missingSlotCount: 20,
      missingSlotTypes: [
        "first_pass_candidate",
        "semantic_ref_family",
        "submission_context_field",
        "table_ref",
      ],
      nextAction: "fill_average_submitter_private_config_slots",
      productDisplayAuthorized: false,
      readyForPrivateRunner: false,
      realAggregateStillMissing: true,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1132: false,
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1133Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1133"),
    ordinaryDataAvailabilityPreflight: {
      aggregateReadinessFacts: {
        eventCountBand: "unknown",
        meetsMinimumEventCount: false,
        meetsMinimumUsableRecordCount: false,
        outcomeLinked: false,
        sameDenominator: false,
        targetAgeBand: "unknown",
        usableRecordCountBand: "unknown",
      },
      blockers: [
        "ordinary_data_availability_manifest_missing",
        ...ORDINARY_SOURCE_FAMILY_IDS.map((familyId) => `source_family_not_available:${familyId}`),
        "accepted_table_layout_not_declared",
        "outcome_linkage_not_declared",
        "same_denominator_not_declared",
        "event_count_floor_not_declared_or_below_minimum",
        "usable_record_floor_not_declared_or_below_minimum",
      ],
      fillableManifestArtifact: "r1133-fillable-ordinary-consumer-data-availability-manifest.json",
      manifestStatus: "not_provided",
      missingSourceFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
      privateDetailsStored: false,
      readyForPrivateConfigMapping: false,
      readyForPrivateRunner: false,
      sourceFamilies: ORDINARY_SOURCE_FAMILY_IDS.map((familyId) => ({
        declaredAvailable: null,
        familyId,
        privateDetailsStored: false,
        requiredForFirstPass: true,
        status: "not_declared",
      })),
    },
    packetId: "r1133-ordinary-consumer-data-availability-preflight",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1133-ordinary-consumer-data-availability-preflight.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "ordinary_data_availability_preflight_waiting_on_manifest",
      manifestStatus: "not_provided",
      missingSourceFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
      nextAction: "fill_safe_ordinary_data_availability_manifest",
      productDisplayAuthorized: false,
      readyForPrivateConfigMapping: false,
      readyForPrivateRunner: false,
      realAggregateStillMissing: true,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1133: false,
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1134Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1134"),
    availabilityConfigBridge: {
      availableSourceFamilyIds: [],
      blockers: [
        "ordinary_data_availability_manifest_missing",
        ...ORDINARY_SOURCE_FAMILY_IDS.map((familyId) => `source_family_not_available:${familyId}`),
      ],
      mappingPlan: {
        selectedTableLayout: null,
        sourceFamilyMappings: ORDINARY_SOURCE_FAMILY_IDS.map((familyId) => ({
          familyId,
          mappingStatus: "missing_or_not_declared",
        })),
        status: "waiting_on_availability_manifest",
      },
      missingSourceFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
      readyForPrivateConfigMapping: false,
      readyForPrivateRunner: false,
      realAggregateStillMissing: true,
    },
    packetId: "r1134-ordinary-consumer-availability-config-bridge",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1134-ordinary-consumer-availability-config-bridge.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "ordinary_availability_config_bridge_waiting_on_availability_manifest",
      mappingPlanStatus: "waiting_on_availability_manifest",
      missingSourceFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
      nextAction: "fill_safe_ordinary_data_availability_manifest",
      productDisplayAuthorized: false,
      readyForPrivateConfigMapping: false,
      readyForPrivateRunner: false,
      realAggregateStillMissing: true,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1134: false,
      selectedTableLayout: null,
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1135Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1135"),
    availabilityManifestPacket: {
      acceptedTableLayouts: ORDINARY_TABLE_LAYOUTS,
      blockers: [
        "ordinary_data_availability_manifest_missing",
        ...ORDINARY_SOURCE_FAMILY_IDS.map((familyId) => `source_family_not_available:${familyId}`),
      ],
      fillableManifestArtifact: "r1133-fillable-ordinary-consumer-data-availability-manifest.json",
      partialPrivateChainRunnerCommand: R1142_PARTIAL_PRIVATE_CHAIN_RUNNER_COMMAND,
      partialRouteManifestRecipes: [
        {
          recipeId: "lab_plus_wearable_minimum_manifest",
          routeId: "lab_plus_wearable_minimum_research_route",
        },
      ],
      preferredManifestRecipeIds: PARTIAL_ROUTE_MANIFEST_RECIPE_IDS,
      primarySubmitterInputFamilyIds: PRIMARY_SUBMITTER_INPUT_FAMILY_IDS,
      privateDetailsStored: false,
      requiredLinkageFamilyIds: REQUIRED_LINKAGE_FAMILY_IDS,
      selectedTableLayout: null,
    },
    packetId: "r1135-ordinary-consumer-availability-manifest-packet",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1135-ordinary-consumer-availability-manifest-packet.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "ordinary_availability_manifest_packet_waiting_on_row_owner_manifest",
      currentLoopNextAction: "fill_safe_ordinary_data_availability_manifest",
      missingSourceFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
      nextAction: "fill_r1133_safe_availability_manifest_for_wearables_labs_then_rerun_r1133_r1134",
      matchedManifestRecipeIds: [],
      manifestRecipeMaterializerCommand: R1143_MANIFEST_RECIPE_MATERIALIZER_COMMAND,
      partialPrivateChainRunnerCommand: R1142_PARTIAL_PRIVATE_CHAIN_RUNNER_COMMAND,
      partialRouteManifestRecipeIds: PARTIAL_ROUTE_MANIFEST_RECIPE_IDS,
      preferredManifestRecipeIds: PARTIAL_ROUTE_MANIFEST_RECIPE_IDS,
      primarySubmitterInputFamilyIds: PRIMARY_SUBMITTER_INPUT_FAMILY_IDS,
      productDisplayAuthorized: false,
      readyForPrivateConfigMapping: false,
      readyForPrivateRunner: false,
      realAggregateStillMissing: true,
      requiredLinkageFamilyIds: REQUIRED_LINKAGE_FAMILY_IDS,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1135: false,
      recipeReadinessChainRunnerCommand: R1144_RECIPE_READINESS_CHAIN_RUNNER_COMMAND,
      safeManifestAttestationsComplete: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1136Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      ...safeBoundary("R1136"),
      availabilityManifestPathStored: false,
    },
    availabilityChain: {
      blockers: [
        "ordinary_data_availability_manifest_missing",
        ...ORDINARY_SOURCE_FAMILY_IDS.map((familyId) => `source_family_not_available:${familyId}`),
      ],
      manifestSuppliedToRunner: false,
      missingSourceFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
      primarySubmitterInputFamilyIds: PRIMARY_SUBMITTER_INPUT_FAMILY_IDS,
      privateDetailsStored: false,
      readyForPrivateConfigMapping: false,
      readyForPrivateRunner: false,
      requiredLinkageFamilyIds: REQUIRED_LINKAGE_FAMILY_IDS,
    },
    packetId: "r1136-ordinary-consumer-availability-chain-runner",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1136-ordinary-consumer-availability-chain-runner.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "ordinary_availability_chain_waiting_on_safe_manifest",
      manifestSuppliedToRunner: false,
      missingSourceFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
      nextAction: "fill_safe_availability_manifest_then_run_r1136_chain",
      primarySubmitterInputFamilyIds: PRIMARY_SUBMITTER_INPUT_FAMILY_IDS,
      productDisplayAuthorized: false,
      readyForPrivateConfigMapping: false,
      readyForPrivateRunner: false,
      realAggregateStillMissing: true,
      requiredLinkageFamilyIds: REQUIRED_LINKAGE_FAMILY_IDS,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1136: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1137Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1137"),
    packetId: "r1137-ordinary-consumer-partial-route-planner",
    partialRoutePlanner: {
      availableSourceFamilyIds: [],
      currentEvidenceGate: "full_l1_l2_w1_qc_required_for_real_evidence_gate",
      fullSupportedRouteReady: false,
      partialRouteIdsReadyButUnsupported: [],
      primarySubmitterInputFamilyIds: PRIMARY_SUBMITTER_INPUT_FAMILY_IDS,
      privateDetailsStored: false,
      requiredLinkageFamilyIds: REQUIRED_LINKAGE_FAMILY_IDS,
    },
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1137-ordinary-consumer-partial-route-planner.v1",
    status: "research-local-aggregate-only",
    summary: {
      availableSourceFamilyIds: [],
      conclusion: "ordinary_partial_route_planner_waiting_on_safe_manifest",
      fullSupportedRouteReady: false,
      nextAction: "fill_safe_availability_manifest_then_run_r1136_r1137_chain",
      partialRouteIdsReadyButUnsupported: [],
      primarySubmitterInputFamilyIds: PRIMARY_SUBMITTER_INPUT_FAMILY_IDS,
      productDisplayAuthorized: false,
      readyForPrivateConfigMapping: false,
      realAggregateStillMissing: true,
      requiredLinkageFamilyIds: REQUIRED_LINKAGE_FAMILY_IDS,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1137: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1138Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1138"),
    packetId: "r1138-ordinary-consumer-partial-aggregate-metric-intake",
    partialMetricIntake: {
      aggregateMetricsProvided: false,
      fullEvidenceGateCleared: false,
      partialAggregateMetricsTemplateArtifact: "r1138-fillable-ordinary-consumer-partial-aggregate-metrics.json",
      partialRouteIdsReadyButUnsupported: [],
      privateDetailsStored: false,
      readyPartialRouteIds: [],
    },
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1138-ordinary-consumer-partial-aggregate-metric-intake.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "ordinary_partial_aggregate_metric_intake_waiting_on_route_plan",
      nextAction: "fill_safe_availability_manifest_then_run_r1136_r1137_chain",
      partialAggregateMetricsTemplateArtifact: "r1138-fillable-ordinary-consumer-partial-aggregate-metrics.json",
      productDisplayAuthorized: false,
      readyPartialRouteIds: [],
      realAggregateStillMissing: true,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1138: false,
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1139Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1139"),
    packetId: "r1139-ordinary-consumer-partial-private-config-handoff",
    partialPrivateConfigHandoff: {
      currentEvidenceGate: "full_l1_l2_w1_qc_required_for_real_evidence_gate",
      eligiblePartialRouteIds: [],
      fullEvidenceGateCleared: false,
      fullSupportedRouteReady: false,
      partialPrivateConfigTemplateArtifact: "r1139-fillable-ordinary-consumer-partial-private-config.json",
      partialRunnerImplementationRequired: false,
      privateDetailsStored: false,
      readyPartialMetricRouteIds: [],
      requiredPrivateFieldRefFamilies: [
        "personJoinKey",
        "dateOrTimeKey",
        "outcomeEvent",
        "labGlycemia",
        "commonLabCore",
        "vitalsBody",
        "wearableActivity",
      ],
      requiredPrivateTableRefs: [
        "primaryTableRef",
        "outcomeTableRef",
        "labTableRef",
        "wearableTableRef",
      ],
    },
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1139-ordinary-consumer-partial-private-config-handoff.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "ordinary_partial_private_config_handoff_waiting_on_route_plan",
      eligiblePartialRouteIds: [],
      fullEvidenceGateCleared: false,
      fullSupportedRouteReady: false,
      nextAction: "fill_safe_availability_manifest_then_run_r1136_r1137_chain",
      partialPrivateConfigTemplateArtifact: "r1139-fillable-ordinary-consumer-partial-private-config.json",
      productDisplayAuthorized: false,
      readyPartialMetricRouteIds: [],
      realAggregateStillMissing: true,
      requiredPrivateFieldRefFamilies: [
        "personJoinKey",
        "dateOrTimeKey",
        "outcomeEvent",
        "labGlycemia",
        "commonLabCore",
        "vitalsBody",
        "wearableActivity",
      ],
      requiredPrivateTableRefs: [
        "primaryTableRef",
        "outcomeTableRef",
        "labTableRef",
        "wearableTableRef",
      ],
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1139: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1140Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      ...safeBoundary("R1140"),
      availabilityManifestPathStored: false,
      partialAggregateMetricsPathStored: false,
    },
    packetId: "r1140-ordinary-consumer-partial-readiness-chain-runner",
    partialReadinessChain: {
      eligiblePartialRouteIds: [],
      fullEvidenceGateCleared: false,
      fullSupportedRouteReady: false,
      manifestSuppliedToRunner: false,
      missingSourceFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
      partialAggregateMetricsSuppliedToRunner: false,
      partialAggregateMetricsTemplateArtifact: "r1138-fillable-ordinary-consumer-partial-aggregate-metrics.json",
      partialPrivateConfigTemplateArtifact: "r1139-fillable-ordinary-consumer-partial-private-config.json",
      privateDetailsStored: false,
      readyPartialMetricRouteIds: [],
      requiredPrivateFieldRefFamilies: [
        "personJoinKey",
        "dateOrTimeKey",
        "outcomeEvent",
        "labGlycemia",
        "commonLabCore",
        "vitalsBody",
        "wearableActivity",
      ],
      requiredPrivateTableRefs: [
        "primaryTableRef",
        "outcomeTableRef",
        "labTableRef",
        "wearableTableRef",
      ],
    },
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1140-ordinary-consumer-partial-readiness-chain-runner.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "ordinary_partial_readiness_chain_waiting_on_safe_manifest",
      eligiblePartialRouteIds: [],
      fullEvidenceGateCleared: false,
      fullSupportedRouteReady: false,
      manifestSuppliedToRunner: false,
      missingSourceFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
      nextAction: "fill_safe_availability_manifest_then_run_r1140_partial_chain",
      partialAggregateMetricsSuppliedToRunner: false,
      partialAggregateMetricsTemplateArtifact: "r1138-fillable-ordinary-consumer-partial-aggregate-metrics.json",
      partialPrivateConfigTemplateArtifact: "r1139-fillable-ordinary-consumer-partial-private-config.json",
      productDisplayAuthorized: false,
      readyPartialMetricRouteIds: [],
      realAggregateStillMissing: true,
      requiredPrivateFieldRefFamilies: [
        "personJoinKey",
        "dateOrTimeKey",
        "outcomeEvent",
        "labGlycemia",
        "commonLabCore",
        "vitalsBody",
        "wearableActivity",
      ],
      requiredPrivateTableRefs: [
        "primaryTableRef",
        "outcomeTableRef",
        "labTableRef",
        "wearableTableRef",
      ],
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1140: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1141Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      ...safeBoundary("R1141"),
      outcomeScoringPerformedByR1141: false,
      privateConfigPathStored: false,
    },
    inputArtifacts: {
      r1139: {
        artifact: "r1139-ordinary-consumer-partial-private-config-handoff.latest.json",
        packetId: "r1139-ordinary-consumer-partial-private-config-handoff",
        schemaVersion: "murph-age-r1139-ordinary-consumer-partial-private-config-handoff.v1",
        status: "available",
      },
    },
    packetId: "r1141-ordinary-consumer-partial-private-metric-runner",
    partialPrivateExecution: {
      aggregateMetricsArtifact: null,
      aggregateMetricsRouteCountBand: "0",
      configPathConfigured: false,
      eligiblePartialRouteIds: [],
      eventCountBand: "0",
      executedPartialRouteIds: [],
      localPrivateDataRead: false,
      partialPrivateConfigTemplateArtifact: "r1139-fillable-ordinary-consumer-partial-private-config.json",
      privateValuesStored: false,
      requestedPartialRouteIds: [],
      routeExecutionStatus: [],
      usableRecordCountBand: "0",
    },
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1141-ordinary-consumer-partial-private-metric-runner.v1",
    status: "research-local-private-inputs-aggregate-output",
    summary: {
      aggregateMetricsArtifact: null,
      conclusion: "ordinary_partial_private_metric_runner_waiting_on_partial_handoff",
      executedPartialRouteIds: [],
      nextAction: "run_r1140_or_r1139_until_partial_routes_ready",
      productDisplayAuthorized: false,
      realAggregateStillMissing: true,
      reviewGptRequiredNow: false,
      routeMetricsReadyForR1138: false,
      rowValuesStored: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1142Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      ...safeBoundary("R1142"),
      availabilityManifestPathStored: false,
      partialPrivateConfigPathStored: false,
    },
    packetId: "r1142-ordinary-consumer-partial-private-chain-runner",
    partialPrivateChain: {
      aggregateMetricsArtifact: null,
      availabilityManifestSuppliedToRunner: false,
      eligiblePartialRouteIds: [],
      executedPartialRouteIds: [],
      finalReadyPartialMetricRouteIds: [],
      fullEvidenceGateCleared: false,
      fullSupportedRouteReady: false,
      manifestFirstRoutePlanConclusion: "ordinary_partial_readiness_chain_waiting_on_safe_manifest",
      metricRecordingRefreshConclusion: null,
      partialPrivateConfigSuppliedToRunner: false,
      partialPrivateMetricRunnerConclusion: "ordinary_partial_private_metric_runner_waiting_on_partial_handoff",
      partialPrivateMetricRunnerNextAction: "run_r1140_or_r1139_until_partial_routes_ready",
      privateDetailsStored: false,
      routeMetricsReadyForR1138: false,
      stageOrder: [
        "r1140_route_plan",
        "r1141_partial_private_metric_runner",
      ],
      stageResults: [],
    },
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1142-ordinary-consumer-partial-private-chain-runner.v1",
    status: "research-local-private-inputs-aggregate-output",
    summary: {
      aggregateMetricsArtifact: null,
      conclusion: "ordinary_partial_private_chain_waiting_on_safe_manifest",
      eligiblePartialRouteIds: [],
      executedPartialRouteIds: [],
      finalReadyPartialMetricRouteIds: [],
      fullEvidenceGateCleared: false,
      fullSupportedRouteReady: false,
      nextAction: "fill_safe_availability_manifest_then_run_r1142_partial_private_chain",
      productDisplayAuthorized: false,
      realAggregateStillMissing: true,
      reviewGptRequiredNow: false,
      routeMetricsReadyForR1138: false,
      rowParsingPerformedByR1142: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1145Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1145"),
    completionAudit: {
      blockers: R1146_BLOCKERS,
      goalAchieved: false,
      missingRequirementIds: R1145_MISSING_REQUIREMENT_IDS,
      nextConcreteAction: R1176_SAFE_ASSERTION_LIVE_CHAIN_NEXT_ACTION,
      prioritizedSubmitterInputFamilyIds: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      readyToMarkComplete: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
    packetId: "r1145-ordinary-consumer-current-chain-completion-audit",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1145-ordinary-consumer-current-chain-completion-audit.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "ordinary_consumer_current_chain_completion_audit_blocked_on_row_owner_route_evidence",
      goalAchieved: false,
      nextAction: R1176_SAFE_ASSERTION_LIVE_CHAIN_NEXT_ACTION,
      completionUnblockerBlockedRequirementIds: R1145_MISSING_REQUIREMENT_IDS,
      completionUnblockerBlockedStepIds: R1145_UNBLOCKER_STEP_IDS,
      completionUnblockerCommandCount: 4,
      completionUnblockerStepIds: R1145_UNBLOCKER_STEP_IDS,
      completionUnblockerTopAllowedValueKindIds: R1145_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
      completionUnblockerTopBlockedContentIds: R1145_UNBLOCKER_BLOCKED_CONTENT_IDS,
      completionUnblockerTopCommand: R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
      completionUnblockerTopNextAction: R1176_SAFE_ASSERTION_LIVE_CHAIN_NEXT_ACTION,
      completionUnblockerTopRequirementId: "row_owner_availability_assertions_confirmed",
      completionUnblockerTopRequiredInputKindIds: FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS,
      completionUnblockerTopSafeCompletionChecklistItemIds: FEATURE_ONLY_FILL_GUIDE_CHECKLIST_IDS,
      completionUnblockerTopStepId: "confirm_feature_only_lab_wearable_safe_availability",
      productDisplayAuthorized: false,
      readyToMarkComplete: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1145: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      topMissingRequirement: "row_owner_availability_assertions_confirmed",
    },
  };
}

function r1146Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1146"),
    packetId: "r1146-ordinary-consumer-row-owner-route-action-packet",
    productDisplayAuthorized: false,
    rowOwnerRouteActionPacket: {
      commands: {
        recommendedConfirmedRecipeCommand: R1146_RECOMMENDED_CONFIRMED_RECIPE_COMMAND,
      },
      routeEvidenceState: {
        privateRouteConfigSupplied: false,
        realLabWearableRouteMetricsRecorded: false,
        rowOwnerAssertionsConfirmed: false,
      },
    },
    schemaVersion: "murph-age-r1146-ordinary-consumer-row-owner-route-action-packet.v1",
    status: "research-local-aggregate-only",
    summary: {
      blockers: R1146_BLOCKERS,
      conclusion: "ordinary_row_owner_route_action_packet_waiting_on_row_owner_availability_confirmation",
      fallbackRecipeIds: [
        "lab_glycemia_minimum_manifest",
        "wearable_activity_minimum_manifest",
      ],
      goalAchieved: false,
      nextAction: "confirm_recommended_lab_plus_wearable_recipe_availability_assertions",
      productDisplayAuthorized: false,
      readyToMarkComplete: false,
      recommendedConfirmedRecipeCommandAvailable: true,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1146: false,
      selectedRecommendedRecipeId: "lab_plus_wearable_minimum_manifest",
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1147Fixture(options: { confirmed?: boolean } = {}): Record<string, unknown> {
  const confirmed = options.confirmed === true;
  return {
    artifactBoundary: safeBoundary("R1147"),
    packetId: "r1147-ordinary-consumer-post-confirmation-private-config-packet",
    postConfirmationPrivateConfigPacket: {
      blockers: confirmed
        ? [
            "private_route_config_not_supplied",
            "real_lab_wearable_route_metrics_missing",
          ]
        : R1147_BLOCKERS,
      commands: {
        partialPrivateChainRunnerCommand: R1142_PARTIAL_PRIVATE_CHAIN_RUNNER_COMMAND,
        privateRouteConfigTemplateArtifact: R1147_PRIVATE_CONFIG_TEMPLATE_ARTIFACT,
        recommendedConfirmedRecipeCommand: R1146_RECOMMENDED_CONFIRMED_RECIPE_COMMAND,
      },
      confirmationState: {
        generatedAvailabilityManifestArtifact: confirmed
          ? "r1143-generated-ordinary-consumer-availability-manifest.latest.json"
          : null,
        generatedManifestWritten: confirmed,
        routeRequirementsAvailable: confirmed,
        rowOwnerAssertionsConfirmed: confirmed,
      },
      expectedRouteIds: LAB_WEARABLE_MINIMUM_ROUTE_IDS,
      goalAchieved: false,
      nextAction: confirmed
        ? "fill_post_confirmation_private_config_and_run_r1142"
        : "run_recommended_confirmed_recipe_chain_before_private_config_packet",
      privateConfigTemplateReadyForFill: confirmed,
      privateDetailsStored: false,
      readyToMarkComplete: false,
      routeEvidenceState: {
        privateRouteConfigSupplied: false,
        realLabWearableRouteMetricsRecorded: false,
        rowOwnerAssertionsConfirmed: confirmed,
      },
      selectedRecommendedRecipeId: "lab_plus_wearable_minimum_manifest",
      templateSchemaVersion: "murph-age-ordinary-consumer-post-confirmation-private-route-config-template.v1",
    },
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1147-ordinary-consumer-post-confirmation-private-config-packet.v1",
    status: "research-local-aggregate-only",
    summary: {
      blockers: confirmed
        ? [
            "private_route_config_not_supplied",
            "real_lab_wearable_route_metrics_missing",
          ]
        : R1147_BLOCKERS,
      conclusion: confirmed
        ? "ordinary_post_confirmation_private_config_packet_waiting_on_private_route_config"
        : "ordinary_post_confirmation_private_config_packet_waiting_on_row_owner_confirmation",
      expectedRouteIds: LAB_WEARABLE_MINIMUM_ROUTE_IDS,
      goalAchieved: false,
      nextAction: confirmed
        ? "fill_post_confirmation_private_config_and_run_r1142"
        : "run_recommended_confirmed_recipe_chain_before_private_config_packet",
      privateConfigTemplateArtifact: R1147_PRIVATE_CONFIG_TEMPLATE_ARTIFACT,
      privateConfigTemplateReadyForFill: confirmed,
      productDisplayAuthorized: false,
      readyToMarkComplete: false,
      requiredPrivateFieldRefFamilies: [
        "personJoinKey",
        "dateOrTimeKey",
        "outcomeEvent",
        "labGlycemia",
        "wearableActivity",
      ],
      requiredPrivateTableRefs: [
        "primaryTableRef",
        "outcomeTableRef",
        "labTableRef",
        "wearableTableRef",
      ],
      reviewGptRequiredNow: false,
      runnerConfigPrivateFieldRefKeys: R1147_RUNNER_CONFIG_PRIVATE_FIELD_REF_KEYS,
      runnerConfigPrivateTableRefKeys: R1147_RUNNER_CONFIG_PRIVATE_TABLE_REF_KEYS,
      runnerConfigRouteRunOrder: LAB_WEARABLE_MINIMUM_ROUTE_IDS,
      runnerConfigSchemaVersion: R1147_RUNNER_CONFIG_SCHEMA_VERSION,
      runnerConfigTopLevelKeys: R1147_RUNNER_CONFIG_TOP_LEVEL_KEYS,
      rowOwnerAssertionsConfirmed: confirmed,
      rowParsingPerformedByR1147: false,
      selectedRecommendedRecipeId: "lab_plus_wearable_minimum_manifest",
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1148Fixture(
  options: {
    featureOnlyReady?: boolean;
    packetReady?: boolean;
    ready?: boolean;
    staleSafeAction?: boolean;
  } = {},
): Record<string, unknown> {
  const ready = options.ready === true;
  const featureOnlyReady = options.featureOnlyReady === true;
  const packetReady = ready || options.packetReady === true;
  const outcomeLinkedReady = ready || packetReady;
  const safeAvailabilityConfirmed = outcomeLinkedReady || featureOnlyReady;
  const safeAvailabilityActionPacketNextAction = outcomeLinkedReady
    ? "run_r1144_recipe_readiness_chain_with_confirmed_availability"
    : featureOnlyReady
      ? "run_r1153_feature_only_chain_with_safe_availability"
    : "fill_safe_availability_confirmation_from_template";
  const safeActionFields = options.staleSafeAction === true ? {} : {
    r1147Conclusion: packetReady
      ? "ordinary_post_confirmation_private_config_packet_waiting_on_private_route_config"
      : "ordinary_post_confirmation_private_config_packet_waiting_on_safe_availability_confirmation",
    r1147NextAction: packetReady
      ? "fill_post_confirmation_private_config_and_run_r1142"
      : "fill_safe_availability_confirmation_from_template",
    safeAvailabilityActionPacketConclusion: outcomeLinkedReady
      ? "safe_availability_action_packet_ready_for_outcome_linked_recipe_readiness"
      : featureOnlyReady
        ? "safe_availability_action_packet_feature_only_context_available"
        : "safe_availability_action_packet_waiting_on_safe_confirmation",
    safeAvailabilityActionPacketFeatureOnlyCoverageContextReady: safeAvailabilityConfirmed,
    safeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds: safeAvailabilityConfirmed
      ? []
      : FEATURE_ONLY_SOURCE_FAMILY_IDS,
    safeAvailabilityActionPacketMissingRequiredSourceFamilyIds: outcomeLinkedReady
      ? []
      : featureOnlyReady
        ? ["outcome_linkage", "join_time_alignment"]
      : REQUIRED_SOURCE_FAMILY_IDS,
    safeAvailabilityActionPacketNextAction,
    safeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain: outcomeLinkedReady,
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
        : packetReady
          ? "post_confirmation_private_config_not_provided"
          : "post_confirmation_private_config_waiting_on_safe_availability_confirmation",
      evidenceRoleStatus: ready ? "complete_real_evidence" : "not_provided",
      expectedRouteIds: LAB_WEARABLE_MINIMUM_ROUTE_IDS,
      missingAttestationKeys: ready
        ? []
        : [
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
          ],
      missingRouteIds: ready ? [] : LAB_WEARABLE_MINIMUM_ROUTE_IDS,
      missingRunnerFieldRefKeys: ready ? [] : R1147_RUNNER_CONFIG_PRIVATE_FIELD_REF_KEYS,
      missingRunnerTableRefKeys: ready ? [] : R1147_RUNNER_CONFIG_PRIVATE_TABLE_REF_KEYS,
      nextAction: ready
        ? "run_r1142_for_real_lab_wearable_route_metrics"
        : packetReady
          ? "provide_post_confirmation_private_runner_config"
          : featureOnlyReady
            ? safeAvailabilityActionPacketNextAction
          : "fill_safe_availability_confirmation_from_template",
      ordinaryTableLayout: ready ? "single_primary_table_fallback" : "not_provided",
      packetReadyForConfigIntake: packetReady,
      privateConfigStatus: ready ? "available" : "missing",
      privateConfigSuppliedToIntake: ready,
      productDisplayAuthorized: false,
      readyForR1142: ready,
      requestedRouteIds: ready ? LAB_WEARABLE_MINIMUM_ROUTE_IDS : [],
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1148: false,
      ...safeActionFields,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1149Fixture(options: { confirmed?: boolean; ready?: boolean } = {}): Record<string, unknown> {
  const confirmed = options.confirmed === true || options.ready === true;
  const ready = options.ready === true;
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
    summary: {
      conclusion: ready
        ? "ordinary_consumer_lab_wearable_submission_kit_ready_to_run_real_route_metrics"
        : confirmed
          ? "ordinary_consumer_lab_wearable_submission_kit_waiting_on_private_config"
          : "ordinary_consumer_lab_wearable_submission_kit_waiting_on_row_owner_confirmation",
      expectedRouteIds: LAB_WEARABLE_MINIMUM_ROUTE_IDS,
      nextAction: ready
        ? "run_r1142_for_real_lab_wearable_route_metrics"
        : confirmed
          ? "fill_local_private_runner_config_from_r1147_template"
          : "confirm_lab_plus_wearable_recipe_availability_assertions",
      optionalAddOnFamilyIds: [
        "common_bloodwork_core",
        "vitals_body_context",
      ],
      privateConfigReadyForR1142: ready,
      privateConfigStatus: ready ? "available" : "missing",
      productDisplayAuthorized: false,
      readyForResearchReview: false,
      requiredSourceFamilyIds: [
        "outcome_linkage",
        "join_time_alignment",
        "bloodwork_glycemia",
        "wearable_activity_daily",
      ],
      reviewGptRequiredNow: false,
      rowOwnerAssertionsConfirmed: confirmed,
      rowParsingPerformedByR1149: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      topBlocker: ready ? "real_lab_wearable_route_metrics_missing" : confirmed
        ? "private_route_config_not_supplied"
        : "row_owner_availability_assertions_not_confirmed",
    },
  };
}

function r1150Fixture(options: { ready?: boolean } = {}): Record<string, unknown> {
  const ready = options.ready === true;
  return {
    artifactBoundary: safeBoundary("R1150"),
    packetId: "r1150-ordinary-consumer-safe-availability-confirmation-intake",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1150-ordinary-consumer-safe-availability-confirmation-intake.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: ready
        ? "safe_availability_confirmation_ready_for_recipe_readiness_chain"
        : "safe_availability_confirmation_not_provided",
      confirmationPathConfigured: ready,
      confirmationStatus: ready ? "available" : "missing",
      expectedRouteIds: LAB_WEARABLE_MINIMUM_ROUTE_IDS,
      featureOnlyCoverageContextReady: ready,
      featureOnlyCoverageRequiresPreferredPair: true,
      minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      missingAggregateReadinessFactIds: ready
        ? []
        : [
            "outcomeLinked",
            "sameDenominator",
            "targetAgeBand",
            "usableRecordCountBand",
            "eventCountBand",
          ],
      missingAttestationKeys: ready
        ? []
        : [
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
          ],
      missingFeatureOnlySourceFamilyIds: ready ? [] : FEATURE_ONLY_SOURCE_FAMILY_IDS,
      missingRequiredSourceFamilyIds: ready
        ? []
        : [
            "outcome_linkage",
            "join_time_alignment",
            "bloodwork_glycemia",
            "wearable_activity_daily",
          ],
      nextAction: ready
        ? "run_r1144_recipe_readiness_chain_with_confirmed_availability"
        : "fill_safe_availability_confirmation_from_template",
      outcomeLinkageRequiredForFeatureOnlyContext: false,
      ordinarySubmitterCompletionModeIds: ORDINARY_SUBMITTER_COMPLETION_MODE_IDS,
      ordinarySubmitterSafeCompletionChecklistItemIds: ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS,
      productDisplayAuthorized: false,
      readyForRecipeReadinessChain: ready,
      reviewGptRequiredNow: false,
      rowOwnerAssertionsConfirmed: ready ? true : null,
      rowLevelDataAcceptedByR1150: false,
      rowParsingPerformedByR1150: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      templateArtifact: "r1150-fillable-ordinary-consumer-safe-availability-confirmation.json",
      featureOnlyTemplateArtifact: "r1150-fillable-feature-only-safe-availability-confirmation.json",
    },
  };
}

function r1151Fixture(options: { featureOnly?: boolean; ready?: boolean } = {}): Record<string, unknown> {
  const ready = options.ready === true;
  const featureOnly = options.featureOnly === true;
  return {
    artifactBoundary: safeBoundary("R1151"),
    packetId: "r1151-ordinary-consumer-feature-only-submission-mode",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1151-ordinary-consumer-feature-only-submission-mode.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: ready
        ? "ordinary_feature_only_mode_superseded_by_outcome_linked_evidence"
        : featureOnly
          ? "ordinary_feature_only_mode_available_not_model_evidence"
          : "ordinary_feature_only_mode_waiting_on_safe_availability_confirmation",
      featureOnlyCoverageContextAllowed: featureOnly,
      featureOnlyCoverageRequiresPreferredPair: true,
      featureOnlyCoverageContextTemplateArtifact: "r1151-fillable-ordinary-consumer-feature-only-coverage-context.json",
      featureOnlyPreferredPairReady: ready || featureOnly,
      minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      missingAttestationKeys: featureOnly || ready
        ? []
        : [
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
          ],
      missingEvidenceSourceFamilyIds: ready ? [] : ["outcome_linkage", "join_time_alignment"],
      missingPrimaryFeatureFamilyIds: ready || featureOnly ? [] : ["bloodwork_glycemia", "wearable_activity_daily"],
      modelEvidencePromotionAllowed: false,
      nextAction: ready
        ? "run_r1144_recipe_readiness_chain_with_confirmed_availability"
        : featureOnly
          ? "fill_feature_only_coverage_context_template_for_research_only_intake"
          : "fill_safe_availability_confirmation_from_template",
      outcomeLinkageRequiredForFeatureOnlyContext: false,
      outcomeLinkedEvidenceReady: ready,
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1151: false,
      rowParsingPerformedByR1151: false,
      safeAvailabilityFeatureOnlyCoverageContextReady: ready || featureOnly,
      safeAvailabilityFeatureOnlyReadinessPresent: true,
      supportedFeatureFamilyIds: ready || featureOnly ? ["bloodwork_glycemia", "wearable_activity_daily"] : [],
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1152Fixture(options: { ready?: boolean } = {}): Record<string, unknown> {
  const ready = options.ready === true;
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
      minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      missingAttestationKeys: ready ? [] : [
        "aggregateOnly",
        "localOnly",
      ],
      missingPrimaryFeatureFamilyIds: ready ? [] : FEATURE_ONLY_SOURCE_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
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
      supportedFeatureFamilyIds: ready ? FEATURE_ONLY_SOURCE_FAMILY_IDS : [],
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1153Fixture(options: { ready?: boolean } = {}): Record<string, unknown> {
  const ready = options.ready === true;
  return {
    artifactBoundary: {
      ...safeBoundary("R1153"),
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
      minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      missingCoverageContextPrimaryFeatureFamilyIds: ready ? [] : FEATURE_ONLY_SOURCE_FAMILY_IDS,
      missingFeatureOnlySourceFamilyIds: ready ? [] : FEATURE_ONLY_SOURCE_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
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
      supportedFeatureFamilyIds: ready ? FEATURE_ONLY_SOURCE_FAMILY_IDS : [],
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1154Fixture(options: { ready?: boolean } = {}): Record<string, unknown> {
  const ready = options.ready === true;
  return {
    artifactBoundary: {
      ...safeBoundary("R1154"),
      availabilityConfirmationPathStored: false,
      fileNamesStored: false,
      headerValuesStored: false,
      privateConfigValuesStored: false,
      privateFieldRefValuesStored: false,
      privateFieldRefsStored: false,
      privateTableRefValuesStored: false,
      privateTableRefsStored: false,
      rowLevelDataAcceptedByR1154: false,
      sourceFileNamesStored: false,
      sourceVariableNamesStored: false,
    },
    packetId: "r1154-ordinary-consumer-safe-availability-action-packet",
    productDisplayAuthorized: false,
    safeAvailabilityActionPacket: {
      commands: {
        featureOnlyChainRunnerCommand: R1153_FEATURE_ONLY_CHAIN_RUNNER_COMMAND,
        outcomeLinkedRecipeReadinessCommand: R1144_OUTCOME_LINKED_RECIPE_READINESS_COMMAND,
        safeAvailabilityActionPacketCommand: R1154_SAFE_AVAILABILITY_ACTION_PACKET_COMMAND,
        safeAvailabilityConfirmationIntakeCommand: R1150_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_COMMAND,
      },
      featureOnlyQuickstartArtifact: R1154_FEATURE_ONLY_QUICKSTART_ARTIFACT,
      featureOnlyQuickstartSafeFieldEditCount: R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
      featureOnlyQuickstartSafeFieldEditPaths: R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS,
    },
    schemaVersion: "murph-age-r1154-ordinary-consumer-safe-availability-action-packet.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: ready
        ? "safe_availability_action_packet_ready_for_outcome_linked_recipe_readiness"
        : "safe_availability_action_packet_waiting_on_safe_confirmation",
      featureOnlyCoverageContextReady: ready,
      featureOnlyQuickstartArtifact: R1154_FEATURE_ONLY_QUICKSTART_ARTIFACT,
      featureOnlyQuickstartSafeFieldEditCount: R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
      featureOnlyQuickstartSafeFieldEditPaths: R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS,
      minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      missingAggregateReadinessFactIds: ready
        ? []
        : ["outcomeLinked", "sameDenominator", "targetAgeBand", "usableRecordCountBand", "eventCountBand"],
      missingAttestationKeys: ready
        ? []
        : REQUIRED_ATTESTATION_KEYS,
      missingFeatureOnlySourceFamilyIds: ready ? [] : FEATURE_ONLY_SOURCE_FAMILY_IDS,
      missingRequiredSourceFamilyIds: ready ? [] : REQUIRED_SOURCE_FAMILY_IDS,
      nextAction: ready
        ? "run_r1144_recipe_readiness_chain_with_confirmed_availability"
        : "fill_safe_availability_confirmation_from_template",
      outcomeLinkageRequiredForFeatureOnlyContext: false,
      ordinarySubmitterCompletionModeIds: ORDINARY_SUBMITTER_COMPLETION_MODE_IDS,
      ordinarySubmitterSafeCompletionChecklistItemIds: ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS,
      preferredRecipeId: "lab_plus_wearable_minimum_manifest",
      productDisplayAuthorized: false,
      r1150Conclusion: ready
        ? "safe_availability_confirmation_ready_for_recipe_readiness_chain"
        : "safe_availability_confirmation_not_provided",
      r1150Expected: true,
      r1150SafeArtifactBoundaryPresent: true,
      readyForOutcomeLinkedRecipeReadinessChain: ready,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1154: false,
      rowOwnerAssertionsConfirmed: ready ? true : null,
      rowOwnerWorkType: ready ? "run_outcome_linked_recipe_readiness" : "fill_safe_availability_confirmation",
      rowParsingPerformedByR1154: false,
      safeAvailabilityConfirmationStatus: ready ? "available" : "missing",
      safeAvailabilityConfirmationTemplateArtifact: "r1150-fillable-ordinary-consumer-safe-availability-confirmation.json",
      featureOnlyFillableTemplateArtifact: "r1150-fillable-feature-only-safe-availability-confirmation.json",
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1155Fixture(): Record<string, unknown> {
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
      compactConfirmationSourceFamilyIds: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      derivedCoverageContextUsed: true,
      featureOnlyChainConclusion: "ordinary_feature_only_chain_ready_research_only",
      featureOnlyChainNextAction: "use_feature_only_coverage_context_for_research_planning_only",
      featureOnlyCoverageContextIntakeConclusion: "feature_only_coverage_context_ready_research_only",
      featureOnlyCoverageContextReadyForResearchPlanning: true,
      featureOnlyModeConclusion: "ordinary_feature_only_mode_available_not_model_evidence",
      modelEvidencePromotionAllowed: false,
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
      modelEvidencePromotionAllowed: false,
      nextAction: "use_r1150_r1153_path_with_real_safe_availability_confirmation",
      productDisplayAuthorized: false,
      readyForRecipeReadinessChain: false,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1155: false,
      rowParsingPerformedByR1155: false,
      safeAvailabilityConfirmationConclusion: "safe_availability_confirmation_feature_only_ready_research_only",
      smokeEvidence: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1156Fixture(): Record<string, unknown> {
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
      sourceFileNamesStored: false,
      sourceVariableNamesStored: false,
      smokeEvidenceStoredAsModelEvidence: false,
    },
    packetId: "r1156-ordinary-consumer-safe-confirmation-handoff",
    productDisplayAuthorized: false,
    safeConfirmationHandoff: {
      commands: {
        safeConfirmationHandoffCommand: R1156_SAFE_CONFIRMATION_HANDOFF_COMMAND,
      },
    },
    schemaVersion: "murph-age-r1156-ordinary-consumer-safe-confirmation-handoff.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "ordinary_safe_confirmation_handoff_ready_for_row_owner_fill_non_evidence",
      featureOnlyPathMechanicallyProven: true,
      handoffReadyForRowOwner: true,
      modelEvidencePromotionAllowed: false,
      nextAction: "fill_safe_availability_confirmation_from_template",
      productDisplayAuthorized: false,
      readyForModelEvidence: false,
      readyForRecipeReadinessChain: false,
      requiredFeatureOnlySourceFamilyIds: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      requiredSafeCompletionCheckIds: ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1156: false,
      rowOwnerWorkType: "fill_safe_availability_confirmation",
      rowParsingPerformedByR1156: false,
      safeConfirmationHandoffCommand: R1156_SAFE_CONFIRMATION_HANDOFF_COMMAND,
      safeConfirmationStillRequired: true,
      smokeEvidence: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1157Fixture(): Record<string, unknown> {
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
      conclusion: "ordinary_safe_confirmation_chain_waiting_on_safe_confirmation",
      confirmationPathConfigured: false,
      featureOnlyCoverageContextReady: false,
      featureOnlyResearchPlanningReady: false,
      modelEvidencePromotionAllowed: false,
      nextAction: "fill_safe_availability_confirmation_from_template",
      productDisplayAuthorized: false,
      readyForModelEvidence: false,
      readyForRecipeReadinessChain: false,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1157: false,
      rowParsingPerformedByR1157: false,
      safeAvailabilityActionPacketConclusion: "safe_availability_action_packet_waiting_on_safe_confirmation",
      safeAvailabilityConfirmationConclusion: "safe_availability_confirmation_not_provided",
      safeConfirmationChainRunnerCommand: R1157_SAFE_CONFIRMATION_CHAIN_RUNNER_COMMAND,
      safeConfirmationHandoffConclusion: "ordinary_safe_confirmation_handoff_ready_for_row_owner_fill_non_evidence",
      safeConfirmationStillRequired: true,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
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
      minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: "fill_safe_availability_confirmation_from_template",
      optionalAddOnFamilyIds: FEATURE_ONLY_FILL_GUIDE_OPTIONAL_ADD_ON_FAMILY_IDS,
      productDisplayAuthorized: false,
      recommendedCompletionModeId: "feature_only_lab_wearable_coverage",
      requiredChecklistIds: FEATURE_ONLY_FILL_GUIDE_CHECKLIST_IDS,
      requiredInputKindIds: FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1158: false,
      rowParsingPerformedByR1158: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1159Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      ...safeBoundary("R1159"),
      answerSheetTemplatePathStored: false,
      rowLevelDataAcceptedByR1159: false,
      rowOwnerProvidedValuesStored: false,
      rowParsingPerformedByR1159: false,
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
      minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: R1159_ANSWER_SHEET_NEXT_ACTION,
      optionalAddOnFamilyIds: FEATURE_ONLY_FILL_GUIDE_OPTIONAL_ADD_ON_FAMILY_IDS,
      productDisplayAuthorized: false,
      recommendedCompletionModeId: "feature_only_lab_wearable_coverage",
      requiredChecklistIds: FEATURE_ONLY_FILL_GUIDE_CHECKLIST_IDS,
      requiredInputKindIds: FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1159: false,
      rowOwnerProvidedValuesStored: false,
      rowParsingPerformedByR1159: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
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
      minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: R1160_TRANSCRIPTION_PROOF_NEXT_ACTION,
      optionalAddOnFamilyIds: FEATURE_ONLY_FILL_GUIDE_OPTIONAL_ADD_ON_FAMILY_IDS,
      productDisplayAuthorized: false,
      requiredChecklistIds: FEATURE_ONLY_FILL_GUIDE_CHECKLIST_IDS,
      requiredInputKindIds: FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1160: false,
      rowOwnerConfirmationStillRequired: true,
      rowOwnerProvidedValuesStored: false,
      rowParsingPerformedByR1160: false,
      r1159AnswerSheetReadyForRowOwner: true,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      transcriptionProofReadyForRowOwnerConfirmation: true,
    },
  };
}

function r1161Fixture(): Record<string, unknown> {
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
    packetId: "r1161-feature-only-safe-availability-confirmation-materializer",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1161-feature-only-safe-availability-confirmation-materializer.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "feature_only_safe_availability_confirmation_materializer_waiting_on_explicit_row_owner_confirmation",
      confirmationArtifactLocalPathStored: false,
      confirmationValuesStoredInR1161Packet: false,
      explicitRowOwnerConfirmationAssertionProvided: false,
      featureOnlyConfirmationWouldBeReadyForR1150: false,
      featureOnlyTemplateReady: true,
      minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: R1161_MATERIALIZER_NEXT_ACTION,
      optionalAddOnFamilyIds: FEATURE_ONLY_FILL_GUIDE_OPTIONAL_ADD_ON_FAMILY_IDS,
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1161: false,
      rowOwnerConfirmationStillRequired: true,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1161: false,
      r1160ProofReadyForRowOwnerConfirmation: true,
      safeConfirmationArtifact: null,
      safeConfirmationArtifactWritten: false,
      safeMaterializedFieldCount: 0,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1162Fixture(): Record<string, unknown> {
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
    packetId: "r1162-feature-only-safe-confirmation-assertion-handoff",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1162-feature-only-safe-confirmation-assertion-handoff.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "feature_only_safe_confirmation_assertion_handoff_ready_for_row_owner_assertion",
      confirmationValuesStoredByR1162: false,
      explicitRowOwnerConfirmationAssertionProvided: false,
      featureOnlyConfirmationWouldBeReadyForR1150: false,
      handoffCommand: R1162_ASSERTION_HANDOFF_COMMAND,
      handoffReadyForRowOwner: true,
      materializerCommand: R1161_MATERIALIZER_COMMAND,
      materializerConclusion: "feature_only_safe_availability_confirmation_materializer_waiting_on_explicit_row_owner_confirmation",
      materializerNextAction: R1161_MATERIALIZER_NEXT_ACTION,
      minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: R1162_ASSERTION_HANDOFF_NEXT_ACTION,
      optionalAddOnFamilyIds: FEATURE_ONLY_FILL_GUIDE_OPTIONAL_ADD_ON_FAMILY_IDS,
      productDisplayAuthorized: false,
      requiredChecklistIds: FEATURE_ONLY_FILL_GUIDE_CHECKLIST_IDS,
      requiredInputKindIds: FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1162: false,
      rowOwnerAssertionInferredByR1162: false,
      rowOwnerAssertionStillRequired: true,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1162: false,
      safeConfirmationArtifact: null,
      safeConfirmationArtifactWritten: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
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
      materializerConclusion: "feature_only_safe_availability_confirmation_materializer_waiting_on_explicit_row_owner_confirmation",
      materializerNextAction: R1161_MATERIALIZER_NEXT_ACTION,
      minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: R1163_ASSERTION_RUNNER_NEXT_ACTION,
      optionalAddOnFamilyIds: FEATURE_ONLY_FILL_GUIDE_OPTIONAL_ADD_ON_FAMILY_IDS,
      productDisplayAuthorized: false,
      requiredChecklistIds: FEATURE_ONLY_FILL_GUIDE_CHECKLIST_IDS,
      requiredInputKindIds: FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1163: false,
      rowOwnerAssertionInferredByR1163: false,
      rowOwnerAssertionStillRequired: true,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1163: false,
      safeConfirmationArtifactWritten: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
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
      minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: R1164_FEATURE_ONLY_HANDOFF_NEXT_ACTION,
      outcomeLinkedModelEvidenceStillRequired: true,
      prioritizedInputKindIds: FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS,
      productDisplayAuthorized: false,
      researchPlanningAllowed: false,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1164: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1164: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
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
      minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
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
      optionalAddOnFamilyIds: FEATURE_ONLY_FILL_GUIDE_OPTIONAL_ADD_ON_FAMILY_IDS,
      requiredInputKindIds: FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1165: false,
      rowOwnerAssertionInferredByR1165: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1165: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
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
      minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: R1165_SAFE_ASSERTION_RUNNER_NEXT_ACTION,
      optionalAddOnFamilyIds: FEATURE_ONLY_FILL_GUIDE_OPTIONAL_ADD_ON_FAMILY_IDS,
      productDisplayAuthorized: false,
      requiredInputKindIds: FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1167: false,
      rowOwnerAssertionInferredByR1167: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1167: false,
      safeFieldEditCount: FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS.length,
      safeFieldEditPaths: FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
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
      minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: "keep_live_chain_waiting_on_real_r1165_row_owner_safe_assertion",
      productDisplayAuthorized: false,
      realEvidenceProduced: false,
      requiredInputKindIds: FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1170: false,
      rowOwnerAssertionStillRequiredForLiveChain: true,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1170: false,
      r1163FeatureOnlyResearchPlanningReady: true,
      r1165AssertionAccepted: true,
      r1165ChildR1163Ran: true,
      r1165FeatureOnlyResearchPlanningReady: true,
      safeFieldEditCount: FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS.length,
      safeFieldEditPaths: FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS,
      smokeEvidence: false,
      smokeProofPassed: true,
      syntheticSmokeProof: true,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
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
      allowedValueKindIds: R1145_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
      blockedContentIds: R1145_UNBLOCKER_BLOCKED_CONTENT_IDS,
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
      allowedValueKindIds: R1145_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
      blockedContentIds: R1145_UNBLOCKER_BLOCKED_CONTENT_IDS,
      conclusion: "ordinary_consumer_safe_assertion_materializer_waiting_on_explicit_row_owner_assertion",
      explicitRowOwnerAssertionProvided: false,
      materializedAssertionArtifact: null,
      materializedAssertionWouldBeAcceptedByR1165: false,
      minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: R1172_SAFE_ASSERTION_MATERIALIZER_NEXT_ACTION,
      productDisplayAuthorized: false,
      requiredInputKindIds: FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS,
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
      safeFieldEditPaths: FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
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
      allowedValueKindIds: R1145_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
      blockedAssertionContent: R1145_UNBLOCKER_BLOCKED_CONTENT_IDS,
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
      allowedValueKindIds: R1145_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
      answerSheetReadyForRowOwner: true,
      blockedAssertionContentIds: R1145_UNBLOCKER_BLOCKED_CONTENT_IDS,
      conclusion: "ordinary_safe_assertion_answer_sheet_ready_non_evidence",
      exactSafeAnswerCount: FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS.length,
      fillGuideReadyForRowOwnerFill: true,
      materializerExplicitConfirmationRequired: true,
      materializerReady: true,
      minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: R1172_SAFE_ASSERTION_MATERIALIZER_NEXT_ACTION,
      productDisplayAuthorized: false,
      requiredAssertionChecklistIds: FEATURE_ONLY_SAFE_ASSERTION_CHECKLIST_IDS,
      requiredInputKindIds: FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1173: false,
      rowOwnerAssertionInferredByR1173: false,
      rowOwnerPrivateValuesStored: false,
      rowOwnerProvidedValuesStored: false,
      rowParsingPerformedByR1173: false,
      safeFieldEditCount: FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS.length,
      safeFieldEditPaths: FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
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
      allowedValueKindIds: R1145_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
      blockedContent: R1145_UNBLOCKER_BLOCKED_CONTENT_IDS,
      packetRole: "current_blocker_packet_only_not_assertion_not_model_evidence",
      rowLevelDataAcceptedByR1174: false,
      rowOwnerProvidedValuesStored: false,
    },
    schemaVersion: R1174_ORDINARY_CONSUMER_SAFE_NEXT_STEP_PACKET_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      allowedValueKindIds: R1145_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
      blockedContentIds: R1145_UNBLOCKER_BLOCKED_CONTENT_IDS,
      conclusion: "ordinary_safe_next_step_packet_ready_for_row_owner_r1176_live_chain_confirmation",
      exactSafeFieldEditCount: FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS.length,
      minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: R1176_SAFE_ASSERTION_LIVE_CHAIN_NEXT_ACTION,
      productDisplayAuthorized: false,
      readyForR1165Runner: false,
      readyForRowOwnerR1172Confirmation: true,
      readyForRowOwnerR1176LiveChainConfirmation: true,
      r1176LiveChainCommand: R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
      requiredInputKindIds: FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1174: false,
      rowOwnerConfirmationInferredByR1174: false,
      rowOwnerPrivateValuesStored: false,
      rowOwnerProvidedValuesStored: false,
      rowParsingPerformedByR1174: false,
      safeFieldEditPaths: FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
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
      allowedValueKindIds: R1145_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
      blockedContentIds: R1145_UNBLOCKER_BLOCKED_CONTENT_IDS,
      bridgeSmokeCommand: R1175_R1172_TO_R1165_SAFE_ASSERTION_BRIDGE_SMOKE_COMMAND,
      optionalAddOnFamilyIds: FEATURE_ONLY_FILL_GUIDE_OPTIONAL_ADD_ON_FAMILY_IDS,
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
      allowedValueKindIds: R1145_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
      bridgeSmokePassed: true,
      blockedContentIds: R1145_UNBLOCKER_BLOCKED_CONTENT_IDS,
      conclusion: "r1172_to_r1165_safe_assertion_bridge_smoke_passed_non_evidence",
      liveChainGateStillRequired: true,
      materializedAssertionPathStored: false,
      minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: "keep_live_chain_waiting_on_explicit_row_owner_r1172_confirmation",
      optionalAddOnFamilyIds: FEATURE_ONLY_FILL_GUIDE_OPTIONAL_ADD_ON_FAMILY_IDS,
      productDisplayAuthorized: false,
      realEvidenceProduced: false,
      requiredInputKindIds: FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS,
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
      safeFieldEditCount: FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS.length,
      safeFieldEditPaths: FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS,
      smokeEvidence: false,
      syntheticSmokeProof: true,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
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
      minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      allowedValueKindIds: R1145_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
      blockedContentIds: R1145_UNBLOCKER_BLOCKED_CONTENT_IDS,
      optionalAddOnFamilyIds: FEATURE_ONLY_FILL_GUIDE_OPTIONAL_ADD_ON_FAMILY_IDS,
      ordinarySubmitterCompletionModeId: FEATURE_ONLY_SAFE_COMPLETION_MODE_ID,
      ordinarySubmitterSafeCompletionChecklistItemIds: FEATURE_ONLY_SAFE_COMPLETION_CHECK_IDS,
      outcomeLinkedModelEvidenceStillRequired: true,
      productDisplayAuthorized: false,
      realEvidenceProduced: false,
      requiredInputKindIds: FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS,
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
      safeFieldEditCount: FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS.length,
      safeFieldEditPaths: FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS,
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
      minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: R1176_SAFE_ASSERTION_LIVE_CHAIN_NEXT_ACTION,
      allowedValueKindIds: R1145_UNBLOCKER_ALLOWED_VALUE_KIND_IDS,
      blockedContentIds: R1145_UNBLOCKER_BLOCKED_CONTENT_IDS,
      optionalAddOnFamilyIds: FEATURE_ONLY_FILL_GUIDE_OPTIONAL_ADD_ON_FAMILY_IDS,
      ordinarySubmitterCompletionModeId: FEATURE_ONLY_SAFE_COMPLETION_MODE_ID,
      ordinarySubmitterSafeCompletionChecklistItemIds: FEATURE_ONLY_SAFE_COMPLETION_CHECK_IDS,
      outcomeLinkedModelEvidenceStillRequired: true,
      productDisplayAuthorized: false,
      realEvidenceProduced: false,
      requiredInputKindIds: FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS,
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
      safeFieldEditCount: FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS.length,
      safeFieldEditPaths: FEATURE_ONLY_SAFE_ASSERTION_FIELD_EDIT_PATHS,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
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
      minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextRealAction: R1185_SAFE_RESPONSE_NEXT_REAL_ACTION,
      nextRealActionCommand: R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND,
      nextRealActionRequiresExplicitRowOwnerAssertion: true,
      prioritizedInputKindIds: FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS,
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
      sourcePriority: "consumer_bloodwork_labs_wearables_16_50_first",
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

function r1187Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
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
    },
    packetId: "r1187-average-submitter-route-metric-readiness",
    productDisplayAuthorized: false,
    routeMetricReadiness: {
      commands: {
        aggregateMetricIntakeCommand: null,
        aggregateReceiptValidationCommand: null,
        partialPrivateChainCommand: null,
        privateConfigIntakeCommand: null,
        privateRunnerCommand: null,
        safeConfirmationCommand: R1187_SAFE_CONFIRMATION_COMMAND,
      },
      firstPassCandidateIds: [
        "L1_tiny_glycemia_only",
        "L2_common_lab_core_shadow",
        "W1_activity_steps_minutes",
        "QC_missingness_coverage",
      ],
      minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      prioritizedInputKindIds: FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS,
      productDisplayAuthorized: false,
      reviewGptPolicy: "only_after_real_aggregate_delta_from_r1124_or_r1130",
      routeMetricStageOrder: [
        "safe_boolean_confirmation",
        "row_owner_private_config",
        "private_runner",
        "aggregate_metric_intake",
        "reviewgpt_real_delta_only",
      ],
      rowLevelDataAcceptedByR1187: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1187: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
    schemaVersion: R1187_AVERAGE_SUBMITTER_ROUTE_METRIC_READINESS_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      aggregateMetricsStillMissing: true,
      aggregateMetricTemplateReady: true,
      conclusion: "average_submitter_route_metric_readiness_waiting_on_safe_submission_confirmation",
      featureOnlyResearchPlanningReady: false,
      minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: "complete_r1186_boolean_only_safe_confirmation_first",
      nextActionCommand: R1187_SAFE_CONFIRMATION_COMMAND,
      prioritizedInputKindIds: FEATURE_ONLY_FILL_GUIDE_INPUT_KIND_IDS,
      productDisplayAuthorized: false,
      privateConfigStillRequired: false,
      realAggregateStillMissing: true,
      realLabWearableRouteMetricsRecorded: false,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1187: false,
      rowOwnerPrivateConfigStillRequired: false,
      rowOwnerPrivateValuesStored: false,
      rowOwnerSafeConfirmationStillRequired: true,
      rowParsingPerformedByR1187: false,
      safeConfirmationStillRequired: true,
      safeSubmissionPacketRefreshRequired: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function safeBoundary(
  stage:
    | "R1057"
    | "R1059"
    | "R1061"
    | "R1062"
    | "R1101"
    | "R1128"
    | "R1129"
    | "R1130"
    | "R1132"
    | "R1133"
    | "R1134"
    | "R1135"
    | "R1136"
    | "R1137"
    | "R1138"
    | "R1139"
    | "R1140"
    | "R1141"
    | "R1142"
    | "R1145"
    | "R1146"
    | "R1147"
    | "R1148"
    | "R1149"
    | "R1150"
    | "R1151"
    | "R1152"
    | "R1153"
    | "R1154"
    | "R1155"
    | "R1156"
    | "R1157"
    | "R1158"
    | "R1159"
    | "R1160"
    | "R1161"
    | "R1162"
    | "R1163",
) {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    [`outcomeScoringPerformedBy${stage}`]: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    [`rowParsingPerformedBy${stage}`]: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
  };
}

function functionAggregatePacketFixture(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
    },
    decision_inputs: {
      abstention_acceptable: true,
      aggregate_verdict: "supports_generalization",
      calibration_non_worse: true,
      cognition_dominates_function: false,
      contradicts_prior_function_evidence: false,
      function_beats_missingness_control: true,
      function_beats_shuffled_control: true,
      meaningful_aggregate_delta: true,
      proper_scores_improve: true,
      same_denominator_valid: true,
      suppression_passed: true,
      ...overrides,
    },
    metric_deltas: {
      anchor_plus_function_sidecar_vs_frozen_anchor: {
        auc_delta: 0.04,
        brier_delta: -0.02,
        log_loss_delta: null,
      },
      function_sidecar_vs_missingness_only_reference: {
        auc_delta: null,
        brier_delta: null,
        log_loss_delta: null,
      },
      function_sidecar_vs_shuffled_function_control: {
        auc_delta: 0.03,
        brier_delta: -0.006,
        log_loss_delta: null,
      },
    },
    packetId: "r1025-function-transport-aggregate-packet",
    schemaVersion: "murph-age-r1025-function-transport-aggregate-packet.v0",
    status: "research-local-aggregate-only",
  };
}
