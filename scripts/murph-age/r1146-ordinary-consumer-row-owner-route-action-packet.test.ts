import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1146_ORDINARY_CONSUMER_ROW_OWNER_ROUTE_ACTION_PACKET_SCHEMA_VERSION,
  runR1146OrdinaryConsumerRowOwnerRouteActionPacket,
} from "./r1146-ordinary-consumer-row-owner-route-action-packet.ts";

const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first";
const RECOMMENDED_RECIPE_ID = "lab_plus_wearable_minimum_manifest";
const FALLBACK_RECIPE_IDS = [
  "lab_glycemia_minimum_manifest",
  "wearable_activity_minimum_manifest",
];
const ROUTE_IDS = [
  "lab_glycemia_minimum_route",
  "wearable_activity_minimum_route",
];
const FIELD_REFS = [
  "personJoinKey",
  "dateOrTimeKey",
  "outcomeEvent",
  "labGlycemia",
  "wearableActivity",
];
const TABLE_REFS = [
  "primaryTableRef",
  "outcomeTableRef",
  "labTableRef",
  "wearableTableRef",
];
const FEATURE_ONLY_PAIR_FAMILY_IDS = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
];
const R1154_FEATURE_ONLY_QUICKSTART_ARTIFACT = "r1154-feature-only-safe-confirmation-quickstart.json";
const R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS = [
  "aggregateReadinessFacts.targetAgeBand",
  "sourceFamilies[bloodwork_glycemia].available",
  "sourceFamilies[wearable_activity_daily].available",
  "rowOwnerAssertionsConfirmed",
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
const R1142_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH=<availability-manifest.json> MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH=<partial-private-config.json> pnpm exec tsx scripts/murph-age/r1142-ordinary-consumer-partial-private-chain-runner.ts";
const R1144_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ID=<recipe-id> MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ASSERTIONS_CONFIRMED=true pnpm exec tsx scripts/murph-age/r1144-ordinary-consumer-recipe-readiness-chain-runner.ts";

describe("R1146 ordinary consumer row-owner route action packet", () => {
  it("turns the R1145 blockers into a concrete lab-plus-wearable row-owner action packet", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1146-blocked-"));
    try {
      const paths = await writeInputs(tmp);
      const { output, outputPath } = await runR1146OrdinaryConsumerRowOwnerRouteActionPacket({
        createdAt: "2026-05-16T19:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1146-ordinary-consumer-row-owner-route-action-packet.latest.json");
      expect(output.schemaVersion).toBe(R1146_ORDINARY_CONSUMER_ROW_OWNER_ROUTE_ACTION_PACKET_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "ordinary_row_owner_route_action_packet_waiting_on_safe_availability_confirmation",
        fallbackRecipeIds: FALLBACK_RECIPE_IDS,
        featureOnlyModeConclusion: "ordinary_feature_only_mode_waiting_on_safe_availability_confirmation",
        featureOnlyModeModelEvidencePromotionAllowed: false,
        featureOnlyModeOutcomeLinkedEvidenceReady: false,
        featureOnlyModeSupportedFeatureFamilyIds: [],
        goalAchieved: false,
        nextAction: "fill_safe_availability_confirmation_from_template",
        productDisplayAuthorized: false,
        readyToMarkComplete: false,
        recommendedConfirmedRecipeCommandAvailable: true,
        rowParsingPerformedByR1146: false,
        safeAvailabilityActionPacketConclusion: "safe_availability_action_packet_waiting_on_safe_confirmation",
        safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact: R1154_FEATURE_ONLY_QUICKSTART_ARTIFACT,
        safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount:
          R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
        safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths:
          R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS,
        safeAvailabilityActionPacketNextAction: "fill_safe_availability_confirmation_from_template",
        selectedRecommendedRecipeId: RECOMMENDED_RECIPE_ID,
        targetAgeBand: "roughly_16_50",
        targetInputPriority: TARGET_INPUT_PRIORITY,
      });
      expect(output.rowOwnerRouteActionPacket.blockers).toEqual([
        "row_owner_availability_assertions_not_confirmed",
        "confirmed_route_config_requirements_not_available",
        "private_route_config_not_supplied",
        "real_lab_wearable_route_metrics_missing",
      ]);
      expect(output.rowOwnerRouteActionPacket.commands.recommendedConfirmedRecipeCommand).toBe(
        "MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ID=lab_plus_wearable_minimum_manifest MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ASSERTIONS_CONFIRMED=true pnpm exec tsx scripts/murph-age/r1144-ordinary-consumer-recipe-readiness-chain-runner.ts",
      );
      expect(output.rowOwnerRouteActionPacket.commands.recommendedConfirmedRecipeCommand).not.toContain("<recipe-id>");
      expect(output.rowOwnerRouteActionPacket.availabilityAssertionChecklist.map((item) => item.familyId)).toEqual([
        "outcome_linkage",
        "join_time_alignment",
        "bloodwork_glycemia",
        "wearable_activity_daily",
      ]);
      expect(output.rowOwnerRouteActionPacket.expectedPrivateConfigAfterConfirmation).toEqual({
        fieldRefFamilies: FIELD_REFS,
        tableRefs: TABLE_REFS,
      });
      expect(output.rowOwnerRouteActionPacket.featureOnlySubmissionMode).toMatchObject({
        conclusion: "ordinary_feature_only_mode_waiting_on_safe_availability_confirmation",
        modelEvidencePromotionAllowed: false,
        outcomeLinkedEvidenceReady: false,
        supportedFeatureFamilyIds: [],
      });
      expect(output.rowOwnerRouteActionPacket.safeAvailabilityActionPacket).toMatchObject({
        conclusion: "safe_availability_action_packet_waiting_on_safe_confirmation",
        featureOnlyCoverageContextReady: false,
        featureOnlyQuickstartArtifact: R1154_FEATURE_ONLY_QUICKSTART_ARTIFACT,
        featureOnlyQuickstartSafeFieldEditCount: R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
        featureOnlyQuickstartSafeFieldEditPaths: R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS,
        minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
        missingFeatureOnlySourceFamilyIds: FEATURE_ONLY_PAIR_FAMILY_IDS,
        missingRequiredSourceFamilyIds: [
          "outcome_linkage",
          "join_time_alignment",
          "bloodwork_glycemia",
          "wearable_activity_daily",
        ],
        nextAction: "fill_safe_availability_confirmation_from_template",
        outcomeLinkageRequiredForFeatureOnlyContext: false,
        readyForOutcomeLinkedRecipeReadinessChain: false,
        rowLevelDataAcceptedByR1154: false,
        safeAvailabilityConfirmationStatus: "missing",
      });
      expect(output.rowOwnerRouteActionPacket.recommendedRecipe).toMatchObject({
        expectedEligiblePartialRouteIds: ROUTE_IDS,
        primarySubmitterInputFamilyIds: [
          "bloodwork_glycemia",
          "wearable_activity_daily",
        ],
        recipeId: RECOMMENDED_RECIPE_ID,
        sourceFamiliesToDeclareAvailable: [
          "outcome_linkage",
          "join_time_alignment",
          "bloodwork_glycemia",
          "wearable_activity_daily",
        ],
        sourceFamiliesToDeclareUnavailable: [
          "common_bloodwork_core",
          "vitals_body_context",
        ],
      });
      expect(output.rowOwnerRouteActionPacket.fullRouteAddOnFamilyIds).toEqual([
        "common_bloodwork_core",
        "vitals_body_context",
      ]);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(output)).not.toContain("glucose_value");
      expect(JSON.stringify(output)).not.toContain("synthetic-person");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = JSON.parse(await readFile(outputPath, "utf8")) as unknown;
      expect(findForbiddenAggregateEgress(persisted)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("inherits ready status only when the current-chain audit is actually complete", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1146-ready-"));
    try {
      const paths = await writeInputs(tmp, {
        r1145: r1145Fixture({ ready: true }),
      });

      const { output } = await runR1146OrdinaryConsumerRowOwnerRouteActionPacket({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        blockers: [],
        conclusion: "ordinary_row_owner_route_action_packet_ready_for_research_review",
        goalAchieved: true,
        nextAction: "review_real_lab_wearable_route_metrics_research_only",
        productDisplayAuthorized: false,
        readyToMarkComplete: true,
      });
      expect(output.rowOwnerRouteActionPacket.routeEvidenceState).toEqual({
        privateRouteConfigReadyForR1142: true,
        privateRouteConfigSupplied: true,
        privateRouteConfigSuppliedToIntake: true,
        privateRouteConfigStatus: "available",
        realLabWearableRouteMetricsRecorded: true,
        rowOwnerAssertionsConfirmed: true,
      });
      expect(output.rowOwnerRouteActionPacket.featureOnlySubmissionMode).toMatchObject({
        conclusion: "ordinary_feature_only_mode_superseded_by_outcome_linked_evidence",
        modelEvidencePromotionAllowed: false,
        outcomeLinkedEvidenceReady: true,
        supportedFeatureFamilyIds: [
          "bloodwork_glycemia",
          "wearable_activity_daily",
        ],
      });
      expect(output.rowOwnerRouteActionPacket.safeAvailabilityActionPacket).toMatchObject({
        conclusion: "safe_availability_action_packet_ready_for_outcome_linked_recipe_readiness",
        featureOnlyCoverageContextReady: true,
        featureOnlyQuickstartArtifact: R1154_FEATURE_ONLY_QUICKSTART_ARTIFACT,
        featureOnlyQuickstartSafeFieldEditCount: R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
        featureOnlyQuickstartSafeFieldEditPaths: R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS,
        missingFeatureOnlySourceFamilyIds: [],
        missingRequiredSourceFamilyIds: [],
        nextAction: "run_r1144_recipe_readiness_chain_with_confirmed_availability",
        readyForOutcomeLinkedRecipeReadinessChain: true,
        rowLevelDataAcceptedByR1154: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes directly to R1142 when the private config is ready but metrics are not recorded", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1146-run-r1142-"));
    try {
      const paths = await writeInputs(tmp, {
        r1145: r1145Fixture({ configReady: true }),
      });

      const { output } = await runR1146OrdinaryConsumerRowOwnerRouteActionPacket({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        blockers: ["real_lab_wearable_route_metrics_missing"],
        conclusion: "ordinary_row_owner_route_action_packet_waiting_on_real_route_metrics",
        goalAchieved: false,
        nextAction: "run_r1142_for_real_lab_wearable_route_metrics",
        privateRouteConfigReadyForR1142: true,
        privateRouteConfigStatus: "available",
        privateRouteConfigSuppliedToIntake: true,
        readyToMarkComplete: false,
      });
      expect(output.rowOwnerRouteActionPacket.routeEvidenceState).toMatchObject({
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

  it("refreshes R1151 when the current-chain audit reports an unsafe feature-only guard", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1146-r1151-guard-"));
    try {
      const paths = await writeInputs(tmp, {
        r1145: r1145Fixture({ featureGuardUnsafe: true }),
      });

      const { output } = await runR1146OrdinaryConsumerRowOwnerRouteActionPacket({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        blockers: ["feature_only_submission_model_evidence_guard_missing_or_unsafe"],
        conclusion: "ordinary_row_owner_route_action_packet_waiting_on_feature_only_guard_refresh",
        goalAchieved: false,
        nextAction: "refresh_r1151_feature_only_submission_mode",
        readyToMarkComplete: false,
      });
      expect(output.rowOwnerRouteActionPacket.featureOnlySubmissionMode).toMatchObject({
        modelEvidencePromotionAllowed: true,
        outcomeLinkedEvidenceReady: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("refreshes R1154 when the current-chain audit reports an unsafe safe availability action packet", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1146-r1154-guard-"));
    try {
      const paths = await writeInputs(tmp, {
        r1145: r1145Fixture({ safeActionPacketUnsafe: true }),
      });

      const { output } = await runR1146OrdinaryConsumerRowOwnerRouteActionPacket({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        blockers: ["safe_availability_action_packet_missing_or_unsafe"],
        conclusion: "ordinary_row_owner_route_action_packet_waiting_on_safe_availability_action_packet_refresh",
        goalAchieved: false,
        nextAction: "refresh_r1154_safe_availability_action_packet",
        readyToMarkComplete: false,
      });
      expect(output.rowOwnerRouteActionPacket.safeAvailabilityActionPacket).toMatchObject({
        conclusion: "safe_availability_action_packet_ready_for_outcome_linked_recipe_readiness",
        featureOnlyQuickstartArtifact: R1154_FEATURE_ONLY_QUICKSTART_ARTIFACT,
        nextAction: "refresh_r1154_safe_availability_action_packet",
        rowLevelDataAcceptedByR1154: true,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("refreshes R1148 when the current-chain audit reports stale safe-action propagation", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1146-r1148-guard-"));
    try {
      const paths = await writeInputs(tmp, {
        r1145: r1145Fixture({ postConfirmationPrivateConfigIntakeUnsafe: true }),
      });

      const { output } = await runR1146OrdinaryConsumerRowOwnerRouteActionPacket({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        blockers: ["post_confirmation_private_config_intake_safe_action_guard_missing_or_stale"],
        conclusion: "ordinary_row_owner_route_action_packet_waiting_on_post_confirmation_private_config_intake_refresh",
        goalAchieved: false,
        nextAction: "refresh_r1148_post_confirmation_private_config_intake",
        readyToMarkComplete: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits for refresh when an input artifact is stale", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1146-stale-"));
    try {
      const paths = await writeInputs(tmp);
      await writeJson(paths.r1145Path, {
        artifactBoundary: safeBoundary("R1145"),
        packetId: "r1145-ordinary-consumer-current-chain-completion-audit",
        productDisplayAuthorized: false,
        schemaVersion: "stale",
      });

      const { output } = await runR1146OrdinaryConsumerRowOwnerRouteActionPacket({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        blockers: ["refresh_current_chain_action_packet_inputs"],
        conclusion: "ordinary_row_owner_route_action_packet_waiting_on_refresh",
        nextAction: "refresh_r1135_r1145_before_row_owner_action_packet",
        readyToMarkComplete: false,
      });
      expect(output.inputArtifacts.r1145).toMatchObject({
        packetId: "r1145-ordinary-consumer-current-chain-completion-audit",
        schemaVersion: null,
        status: "available",
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe input artifacts with a sanitized error", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1146-unsafe-"));
    try {
      const paths = await writeInputs(tmp);
      await writeJson(paths.r1145Path, {
        ...r1145Fixture(),
        artifactBoundary: {
          ...safeBoundary("R1145"),
          rowValuesStored: true,
        },
      });

      await expect(runR1146OrdinaryConsumerRowOwnerRouteActionPacket({
        outputDir: path.join(tmp, "out"),
        ...paths,
      })).rejects.toThrow("R1146 rejected unsafe r1145 input: 1 aggregate-egress violation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1146-cli-"));
    try {
      const paths = await writeInputs(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1146-ordinary-consumer-row-owner-route-action-packet.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1135_ORDINARY_CONSUMER_AVAILABILITY_MANIFEST_PACKET_PATH: paths.r1135Path,
          MURPH_AGE_R1145_ORDINARY_CONSUMER_CURRENT_CHAIN_COMPLETION_AUDIT_PATH: paths.r1145Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        featureOnlyModeConclusion: string | null;
        featureOnlyModeModelEvidencePromotionAllowed: boolean | null;
        featureOnlyModeOutcomeLinkedEvidenceReady: boolean | null;
        featureOnlyModeSupportedFeatureFamilyIds: string[];
        nextAction: string;
        privateRouteConfigReadyForR1142: boolean;
        privateRouteConfigStatus: string;
        privateRouteConfigSuppliedToIntake: boolean;
        recommendedConfirmedRecipeCommandAvailable: boolean;
        safeAvailabilityActionPacketConclusion: string | null;
        safeAvailabilityActionPacketFeatureOnlyCoverageContextReady: boolean | null;
        safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact: string | null;
        safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount: number | null;
        safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths: string[];
        safeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds: string[];
        safeAvailabilityActionPacketMissingRequiredSourceFamilyIds: string[];
        safeAvailabilityActionPacketNextAction: string | null;
        safeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain: boolean | null;
        safeAvailabilityActionPacketRowLevelDataAcceptedByR1154: boolean | null;
        selectedRecommendedRecipeId: string;
        targetInputPriority: string;
      };
      expect(summary).toMatchObject({
        conclusion: "ordinary_row_owner_route_action_packet_waiting_on_safe_availability_confirmation",
        featureOnlyModeConclusion: "ordinary_feature_only_mode_waiting_on_safe_availability_confirmation",
        featureOnlyModeModelEvidencePromotionAllowed: false,
        featureOnlyModeOutcomeLinkedEvidenceReady: false,
        featureOnlyModeSupportedFeatureFamilyIds: [],
        nextAction: "fill_safe_availability_confirmation_from_template",
        privateRouteConfigReadyForR1142: false,
        privateRouteConfigStatus: "missing",
        privateRouteConfigSuppliedToIntake: false,
        recommendedConfirmedRecipeCommandAvailable: true,
        safeAvailabilityActionPacketConclusion: "safe_availability_action_packet_waiting_on_safe_confirmation",
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
        safeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain: false,
        safeAvailabilityActionPacketRowLevelDataAcceptedByR1154: false,
        selectedRecommendedRecipeId: RECOMMENDED_RECIPE_ID,
        targetInputPriority: TARGET_INPUT_PRIORITY,
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("glucose_value");
      expect(stdout).not.toContain("synthetic-person");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeInputs(
  tmp: string,
  overrides: { r1145?: Record<string, unknown> } = {},
): Promise<{ r1135Path: string; r1145Path: string }> {
  const paths = {
    r1135Path: path.join(tmp, "r1135.json"),
    r1145Path: path.join(tmp, "r1145.json"),
  };
  await Promise.all([
    writeJson(paths.r1135Path, r1135Fixture()),
    writeJson(paths.r1145Path, overrides.r1145 ?? r1145Fixture()),
  ]);
  return paths;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function r1135Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1135"),
    availabilityManifestPacket: {
      partialRouteManifestRecipes: [
        recipe({
          available: ["outcome_linkage", "join_time_alignment", "bloodwork_glycemia", "wearable_activity_daily"],
          eligibleRoutes: ROUTE_IDS,
          id: "lab_plus_wearable_minimum_manifest",
          primaryInputs: ["bloodwork_glycemia", "wearable_activity_daily"],
          routeGroupId: "lab_plus_wearable_minimum_research_route",
          routeKind: "partial_lab_wearable_route",
          unavailable: ["common_bloodwork_core", "vitals_body_context"],
        }),
        recipe({
          available: ["outcome_linkage", "join_time_alignment", "bloodwork_glycemia"],
          eligibleRoutes: ["lab_glycemia_minimum_route"],
          id: "lab_glycemia_minimum_manifest",
          primaryInputs: ["bloodwork_glycemia"],
          routeGroupId: "lab_glycemia_minimum_route",
          routeKind: "partial_lab_route",
          unavailable: ["common_bloodwork_core", "wearable_activity_daily", "vitals_body_context"],
        }),
        recipe({
          available: ["outcome_linkage", "join_time_alignment", "wearable_activity_daily"],
          eligibleRoutes: ["wearable_activity_minimum_route"],
          id: "wearable_activity_minimum_manifest",
          primaryInputs: ["wearable_activity_daily"],
          routeGroupId: "wearable_activity_minimum_route",
          routeKind: "partial_wearable_route",
          unavailable: ["bloodwork_glycemia", "common_bloodwork_core", "vitals_body_context"],
        }),
      ],
    },
    packetId: "r1135-ordinary-consumer-availability-manifest-packet",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1135-ordinary-consumer-availability-manifest-packet.v1",
    status: "research-local-aggregate-only",
    summary: {
      partialPrivateChainRunnerCommand: R1142_COMMAND,
      productDisplayAuthorized: false,
      recipeReadinessChainRunnerCommand: R1144_COMMAND,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1135: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };
}

function recipe(input: {
  available: string[];
  eligibleRoutes: string[];
  id: string;
  primaryInputs: string[];
  routeGroupId: string;
  routeKind: string;
  unavailable: string[];
}): Record<string, unknown> {
  return {
    countBandFloors: {
      eventCountBand: "10_plus",
      usableRecordCountBand: "50_plus",
    },
    expectedEligiblePartialRouteIds: input.eligibleRoutes,
    expectedFullSupportedRouteReady: false,
    primarySubmitterInputFamilyIds: input.primaryInputs,
    productDisplayAuthorized: false,
    recipeId: input.id,
    recipeRouteGroupId: input.routeGroupId,
    routeKind: input.routeKind,
    routeUse: `${input.id}_safe_route_use`,
    sourceFamiliesToDeclareAvailable: input.available,
    sourceFamiliesToDeclareUnavailable: input.unavailable,
    targetAgeBand: "roughly_16_50",
  };
}

function r1145Fixture(
  options: {
    configReady?: boolean;
    featureGuardUnsafe?: boolean;
    postConfirmationPrivateConfigIntakeUnsafe?: boolean;
    ready?: boolean;
    safeActionPacketUnsafe?: boolean;
  } = {},
): Record<string, unknown> {
  const ready = options.ready === true;
  const configReady = ready || options.configReady === true;
  const featureGuardUnsafe = options.featureGuardUnsafe === true;
  const postConfirmationPrivateConfigIntakeUnsafe = options.postConfirmationPrivateConfigIntakeUnsafe === true;
  const safeActionPacketUnsafe = options.safeActionPacketUnsafe === true;
  return {
    artifactBoundary: safeBoundary("R1145"),
    completionAudit: {
      blockers: featureGuardUnsafe
        ? ["feature_only_submission_model_evidence_guard_missing_or_unsafe"]
        : safeActionPacketUnsafe
          ? ["safe_availability_action_packet_missing_or_unsafe"]
        : postConfirmationPrivateConfigIntakeUnsafe
          ? ["post_confirmation_private_config_intake_safe_action_guard_missing_or_stale"]
        : ready
        ? []
        : configReady
          ? ["real_lab_wearable_route_metrics_missing"]
        : [
          "row_owner_availability_assertions_not_confirmed",
          "confirmed_route_config_requirements_not_available",
          "private_route_config_not_supplied",
          "real_lab_wearable_route_metrics_missing",
        ],
      commands: {
        partialPrivateChainRunnerCommand: R1142_COMMAND,
        recipeReadinessChainRunnerCommand: R1144_COMMAND,
      },
      featureOnlySubmissionMode: {
        conclusion: ready
          ? "ordinary_feature_only_mode_superseded_by_outcome_linked_evidence"
          : "ordinary_feature_only_mode_waiting_on_safe_availability_confirmation",
        featureOnlyCoverageContextAllowed: false,
        modelEvidencePromotionAllowed: featureGuardUnsafe,
        outcomeLinkedEvidenceReady: ready,
        privateDetailsStored: false,
        supportedFeatureFamilyIds: ready ? ["bloodwork_glycemia", "wearable_activity_daily"] : [],
      },
      safeAvailabilityActionPacket: {
        conclusion: ready || safeActionPacketUnsafe
          ? "safe_availability_action_packet_ready_for_outcome_linked_recipe_readiness"
          : "safe_availability_action_packet_waiting_on_safe_confirmation",
        featureOnlyCoverageContextReady: ready || safeActionPacketUnsafe,
        featureOnlyQuickstartArtifact: R1154_FEATURE_ONLY_QUICKSTART_ARTIFACT,
        featureOnlyQuickstartSafeFieldEditCount: R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
        featureOnlyQuickstartSafeFieldEditPaths: R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS,
        minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
        missingFeatureOnlySourceFamilyIds: ready || safeActionPacketUnsafe ? [] : FEATURE_ONLY_PAIR_FAMILY_IDS,
        missingRequiredSourceFamilyIds: ready || safeActionPacketUnsafe
          ? []
          : ["outcome_linkage", "join_time_alignment", "bloodwork_glycemia", "wearable_activity_daily"],
        nextAction: safeActionPacketUnsafe
          ? "refresh_r1154_safe_availability_action_packet"
          : ready
            ? "run_r1144_recipe_readiness_chain_with_confirmed_availability"
            : "fill_safe_availability_confirmation_from_template",
        outcomeLinkageRequiredForFeatureOnlyContext: false,
        privateDetailsStored: false,
        readyForOutcomeLinkedRecipeReadinessChain: ready || safeActionPacketUnsafe,
        rowLevelDataAcceptedByR1154: safeActionPacketUnsafe,
        safeAvailabilityConfirmationStatus: ready || safeActionPacketUnsafe ? "available" : "missing",
      },
      goalAchieved: ready,
      readyToMarkComplete: ready,
      routeEvidenceState: {
        privateRouteConfigReadyForR1142: configReady,
        privateRouteConfigSupplied: configReady,
        privateRouteConfigSuppliedToIntake: configReady,
        privateRouteConfigStatus: configReady ? "available" : "missing",
        realLabWearableRouteMetricsRecorded: ready,
        rowOwnerAssertionsConfirmed: configReady,
      },
    },
    packetId: "r1145-ordinary-consumer-current-chain-completion-audit",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1145-ordinary-consumer-current-chain-completion-audit.v1",
    status: "research-local-aggregate-only",
    summary: {
      goalAchieved: ready,
      nextAction: ready
        ? "review_real_lab_wearable_route_metrics_research_only"
        : safeActionPacketUnsafe
          ? "refresh_r1154_safe_availability_action_packet"
        : postConfirmationPrivateConfigIntakeUnsafe
          ? "refresh_r1148_post_confirmation_private_config_intake"
        : configReady
          ? "run_r1142_partial_private_chain_for_real_lab_wearable_route_metrics"
          : "fill_safe_availability_confirmation_from_template",
      productDisplayAuthorized: false,
      readyToMarkComplete: ready,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1145: false,
      safeAvailabilityActionPacketConclusion: ready || safeActionPacketUnsafe
        ? "safe_availability_action_packet_ready_for_outcome_linked_recipe_readiness"
        : "safe_availability_action_packet_waiting_on_safe_confirmation",
      safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact: R1154_FEATURE_ONLY_QUICKSTART_ARTIFACT,
      safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount:
        R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
      safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths:
        R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS,
      safeAvailabilityActionPacketNextAction: safeActionPacketUnsafe
        ? "refresh_r1154_safe_availability_action_packet"
        : ready
          ? "run_r1144_recipe_readiness_chain_with_confirmed_availability"
          : "fill_safe_availability_confirmation_from_template",
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };
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
