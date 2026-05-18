import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1149_ORDINARY_CONSUMER_LAB_WEARABLE_SUBMISSION_KIT_SCHEMA_VERSION,
  runR1149OrdinaryConsumerLabWearableSubmissionKit,
} from "./r1149-ordinary-consumer-lab-wearable-submission-kit.ts";

const REQUIRED_SOURCE_FAMILY_IDS = [
  "outcome_linkage",
  "join_time_alignment",
  "bloodwork_glycemia",
  "wearable_activity_daily",
];
const OPTIONAL_ADD_ON_FAMILY_IDS = [
  "common_bloodwork_core",
  "vitals_body_context",
];
const EXPECTED_ROUTE_IDS = [
  "lab_glycemia_minimum_route",
  "wearable_activity_minimum_route",
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
const FIELD_REF_FAMILIES = [
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
const RUNNER_FIELD_KEYS = [
  "personJoinKey",
  "outcomeEvent",
  "labGlycemia",
  "wearableActivity",
];
const RUNNER_TABLE_KEYS = [
  "primaryTableRef",
  "outcomeTableRef",
  "labTableRef",
  "wearableTableRef",
];
const RUNNER_SCHEMA_VERSION = "murph-age-ordinary-consumer-partial-private-runner-config.v1";
const R1142_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH=<availability-manifest.json> MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH=<partial-private-config.json> pnpm exec tsx scripts/murph-age/r1142-ordinary-consumer-partial-private-chain-runner.ts";
const R1148_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH=<partial-private-config.json> pnpm exec tsx scripts/murph-age/r1148-ordinary-consumer-post-confirmation-private-config-intake.ts";
const R1150_COMMAND =
  "MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_PATH=<safe-availability-confirmation.json> pnpm exec tsx scripts/murph-age/r1150-ordinary-consumer-safe-availability-confirmation-intake.ts";
const R1151_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1151-ordinary-consumer-feature-only-submission-mode.ts";

describe("R1149 ordinary consumer lab/wearable submission kit", () => {
  it("keeps the ordinary submitter kit blocked on row-owner confirmation by default", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1149-blocked-"));
    try {
      const paths = await writeInputs(tmp);

      const { output, outputPath } = await runR1149OrdinaryConsumerLabWearableSubmissionKit({
        createdAt: "2026-05-17T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1149-ordinary-consumer-lab-wearable-submission-kit.latest.json");
      expect(output.schemaVersion).toBe(R1149_ORDINARY_CONSUMER_LAB_WEARABLE_SUBMISSION_KIT_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_lab_wearable_submission_kit_waiting_on_safe_availability_confirmation",
        expectedRouteIds: EXPECTED_ROUTE_IDS,
        featureOnlyModeConclusion: "ordinary_feature_only_mode_waiting_on_safe_availability_confirmation",
        featureOnlyModeModelEvidencePromotionAllowed: false,
        featureOnlyModeOutcomeLinkedEvidenceReady: false,
        featureOnlyModeSupportedFeatureFamilyIds: [],
        nextAction: "fill_safe_availability_confirmation_from_template",
        optionalAddOnFamilyIds: OPTIONAL_ADD_ON_FAMILY_IDS,
        privateConfigReadyForR1142: false,
        privateConfigStatus: "missing",
        productDisplayAuthorized: false,
        readyForResearchReview: false,
        requiredSourceFamilyIds: REQUIRED_SOURCE_FAMILY_IDS,
        reviewGptRequiredNow: false,
        rowOwnerAssertionsConfirmed: false,
        rowParsingPerformedByR1149: false,
        safeAvailabilityActionPacketConclusion: "safe_availability_action_packet_waiting_on_safe_confirmation",
        safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact: R1154_FEATURE_ONLY_QUICKSTART_ARTIFACT,
        safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount:
          R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
        safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths:
          R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS,
        safeAvailabilityActionPacketNextAction: "fill_safe_availability_confirmation_from_template",
        targetAgeBand: "roughly_16_50",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
        topBlocker: "row_owner_availability_assertions_not_confirmed",
      });
      expect(output.ordinaryConsumerSubmissionKit.sourceFamilyChecklist.map((item) => item.familyId)).toEqual([
        ...REQUIRED_SOURCE_FAMILY_IDS,
        ...OPTIONAL_ADD_ON_FAMILY_IDS,
      ]);
      expect(output.ordinaryConsumerSubmissionKit.sourceFamilyChecklist
        .filter((item) => item.requiredForRecommendedRecipe)
        .map((item) => item.familyId)).toEqual(REQUIRED_SOURCE_FAMILY_IDS);
      expect(output.ordinaryConsumerSubmissionKit.privateConfigSlotChecklist).toMatchObject({
        missingRouteIds: EXPECTED_ROUTE_IDS,
        missingRunnerFieldRefKeys: RUNNER_FIELD_KEYS,
        missingRunnerTableRefKeys: RUNNER_TABLE_KEYS,
        requiredPrivateFieldRefFamilies: FIELD_REF_FAMILIES,
        requiredPrivateTableRefs: TABLE_REFS,
        runnerConfigRouteRunOrder: EXPECTED_ROUTE_IDS,
        runnerConfigSchemaVersion: RUNNER_SCHEMA_VERSION,
      });
      expect(output.ordinaryConsumerSubmissionKit.commands).toMatchObject({
        featureOnlySubmissionModeCommand: R1151_COMMAND,
        partialPrivateChainRunnerCommand: R1142_COMMAND,
        postConfirmationPrivateConfigIntakeCommand: R1148_COMMAND,
        privateConfigTemplateArtifact: "r1147-fillable-ordinary-consumer-lab-wearable-private-route-config.json",
        safeAvailabilityConfirmationIntakeCommand: R1150_COMMAND,
      });
      expect(output.ordinaryConsumerSubmissionKit.featureOnlySubmissionMode).toMatchObject({
        conclusion: "ordinary_feature_only_mode_waiting_on_safe_availability_confirmation",
        featureOnlyCoverageContextAllowed: false,
        modelEvidencePromotionAllowed: false,
        outcomeLinkedEvidenceReady: false,
        privateDetailsStored: false,
        supportedFeatureFamilyIds: [],
      });
      expect(output.ordinaryConsumerSubmissionKit.safeAvailabilityActionPacket).toMatchObject({
        conclusion: "safe_availability_action_packet_waiting_on_safe_confirmation",
        featureOnlyCoverageContextReady: false,
        featureOnlyQuickstartArtifact: R1154_FEATURE_ONLY_QUICKSTART_ARTIFACT,
        featureOnlyQuickstartSafeFieldEditCount: R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
        featureOnlyQuickstartSafeFieldEditPaths: R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS,
        minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
        missingFeatureOnlySourceFamilyIds: FEATURE_ONLY_PAIR_FAMILY_IDS,
        missingRequiredSourceFamilyIds: REQUIRED_SOURCE_FAMILY_IDS,
        nextAction: "fill_safe_availability_confirmation_from_template",
        outcomeLinkageRequiredForFeatureOnlyContext: false,
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

  it("refreshes R1151 when row-owner packet reports an unsafe feature-only guard", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1149-feature-guard-"));
    try {
      const paths = await writeInputs(tmp, {
        r1146: r1146Fixture({ featureGuardUnsafe: true }),
      });

      const { output } = await runR1149OrdinaryConsumerLabWearableSubmissionKit({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_lab_wearable_submission_kit_waiting_on_feature_only_guard_refresh",
        featureOnlyModeModelEvidencePromotionAllowed: true,
        nextAction: "refresh_r1151_feature_only_submission_mode",
        topBlocker: "feature_only_submission_model_evidence_guard_missing_or_unsafe",
      });
      expect(output.ordinaryConsumerSubmissionKit.blockers).toEqual([
        "feature_only_submission_model_evidence_guard_missing_or_unsafe",
      ]);
      expect(output.ordinaryConsumerSubmissionKit.featureOnlySubmissionMode).toMatchObject({
        modelEvidencePromotionAllowed: true,
        outcomeLinkedEvidenceReady: false,
        privateDetailsStored: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("refreshes R1154 when row-owner packet reports an unsafe safe availability action packet", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1149-r1154-guard-"));
    try {
      const paths = await writeInputs(tmp, {
        r1146: r1146Fixture({ safeActionPacketUnsafe: true }),
      });

      const { output } = await runR1149OrdinaryConsumerLabWearableSubmissionKit({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_lab_wearable_submission_kit_waiting_on_safe_availability_action_packet_refresh",
        nextAction: "refresh_r1154_safe_availability_action_packet",
        safeAvailabilityActionPacketRowLevelDataAcceptedByR1154: true,
        topBlocker: "safe_availability_action_packet_missing_or_unsafe",
      });
      expect(output.ordinaryConsumerSubmissionKit.blockers).toEqual([
        "safe_availability_action_packet_missing_or_unsafe",
      ]);
      expect(output.ordinaryConsumerSubmissionKit.safeAvailabilityActionPacket).toMatchObject({
        conclusion: "safe_availability_action_packet_ready_for_outcome_linked_recipe_readiness",
        featureOnlyQuickstartArtifact: R1154_FEATURE_ONLY_QUICKSTART_ARTIFACT,
        nextAction: "refresh_r1154_safe_availability_action_packet",
        rowLevelDataAcceptedByR1154: true,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("refreshes R1148 when row-owner packet reports stale safe-action propagation", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1149-r1148-guard-"));
    try {
      const paths = await writeInputs(tmp, {
        r1146: r1146Fixture({ postConfirmationPrivateConfigIntakeUnsafe: true }),
      });

      const { output } = await runR1149OrdinaryConsumerLabWearableSubmissionKit({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_lab_wearable_submission_kit_waiting_on_post_confirmation_private_config_intake_refresh",
        nextAction: "refresh_r1148_post_confirmation_private_config_intake",
        topBlocker: "post_confirmation_private_config_intake_safe_action_guard_missing_or_stale",
      });
      expect(output.ordinaryConsumerSubmissionKit.blockers).toEqual([
        "post_confirmation_private_config_intake_safe_action_guard_missing_or_stale",
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("points to the local R1147 template once row-owner confirmation exists but config is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1149-fill-"));
    try {
      const paths = await writeInputs(tmp, {
        r1146: r1146Fixture({ confirmed: true }),
        r1147: r1147Fixture({ confirmed: true }),
        r1148: r1148Fixture({ packetReady: true }),
      });

      const { output } = await runR1149OrdinaryConsumerLabWearableSubmissionKit({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_lab_wearable_submission_kit_waiting_on_private_config",
        nextAction: "fill_local_private_runner_config_from_r1147_template",
        privateConfigReadyForR1142: false,
        privateConfigStatus: "missing",
        rowOwnerAssertionsConfirmed: true,
        topBlocker: "private_route_config_not_supplied",
      });
      expect(output.ordinaryConsumerSubmissionKit.currentGateState).toMatchObject({
        privateConfigTemplateReadyForFill: true,
        privateConfigSuppliedToIntake: false,
        realLabWearableRouteMetricsRecorded: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("keeps incomplete private-config feedback to safe slot names", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1149-incomplete-"));
    try {
      const paths = await writeInputs(tmp, {
        r1146: r1146Fixture({ confirmed: true, configIncomplete: true }),
        r1147: r1147Fixture({ confirmed: true }),
        r1148: r1148Fixture({ suppliedIncomplete: true }),
      });

      const { output } = await runR1149OrdinaryConsumerLabWearableSubmissionKit({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_lab_wearable_submission_kit_waiting_on_private_config_completion",
        nextAction: "complete_local_private_runner_config_slots",
        privateConfigReadyForR1142: false,
        privateConfigStatus: "available",
        topBlocker: "private_route_config_incomplete",
      });
      expect(output.ordinaryConsumerSubmissionKit.privateConfigSlotChecklist).toMatchObject({
        missingAttestationKeys: ["noPrivatePathEgress"],
        missingRouteIds: ["wearable_activity_minimum_route"],
        missingRunnerFieldRefKeys: ["labGlycemia", "wearableActivity"],
        missingRunnerTableRefKeys: ["labTableRef", "wearableTableRef"],
      });
      const serialized = JSON.stringify(output);
      expect(serialized).not.toContain(tmp);
      expect(serialized).not.toContain("private_person_id");
      expect(serialized).not.toContain("glucose_private_column");
      expect(serialized).not.toContain("ordinary-private-route.csv");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes to R1142 once the real lab-plus-wearable private config is ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1149-run-r1142-"));
    try {
      const paths = await writeInputs(tmp, {
        r1146: r1146Fixture({ confirmed: true, configReady: true }),
        r1147: r1147Fixture({ confirmed: true }),
        r1148: r1148Fixture({ ready: true }),
      });

      const { output } = await runR1149OrdinaryConsumerLabWearableSubmissionKit({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_lab_wearable_submission_kit_ready_to_run_real_route_metrics",
        nextAction: "run_r1142_for_real_lab_wearable_route_metrics",
        privateConfigReadyForR1142: true,
        privateConfigStatus: "available",
        readyForResearchReview: false,
        topBlocker: "real_lab_wearable_route_metrics_missing",
      });
      expect(output.ordinaryConsumerSubmissionKit.privateConfigSlotChecklist).toMatchObject({
        missingAttestationKeys: [],
        missingRouteIds: [],
        missingRunnerFieldRefKeys: [],
        missingRunnerTableRefKeys: [],
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("marks the kit ready for research review only after real route metrics are recorded", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1149-ready-"));
    try {
      const paths = await writeInputs(tmp, {
        r1146: r1146Fixture({ ready: true }),
        r1147: r1147Fixture({ confirmed: true }),
        r1148: r1148Fixture({ ready: true }),
      });

      const { output } = await runR1149OrdinaryConsumerLabWearableSubmissionKit({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_lab_wearable_submission_kit_ready_for_research_review",
        nextAction: "review_real_lab_wearable_route_metrics_research_only",
        readyForResearchReview: true,
        topBlocker: null,
      });
      expect(output.ordinaryConsumerSubmissionKit.blockers).toEqual([]);
      expect(output.ordinaryConsumerSubmissionKit.currentGateState).toMatchObject({
        privateConfigReadyForR1142: true,
        realLabWearableRouteMetricsRecorded: true,
        rowOwnerAssertionsConfirmed: true,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1149-cli-"));
    try {
      const paths = await writeInputs(tmp, {
        r1146: r1146Fixture({ confirmed: true, configReady: true }),
        r1147: r1147Fixture({ confirmed: true }),
        r1148: r1148Fixture({ ready: true }),
      });
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1149-ordinary-consumer-lab-wearable-submission-kit.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1146_ORDINARY_CONSUMER_ROW_OWNER_ROUTE_ACTION_PACKET_PATH: paths.r1146Path,
          MURPH_AGE_R1147_ORDINARY_CONSUMER_POST_CONFIRMATION_PRIVATE_CONFIG_PACKET_PATH: paths.r1147Path,
          MURPH_AGE_R1148_ORDINARY_CONSUMER_POST_CONFIRMATION_PRIVATE_CONFIG_INTAKE_PATH: paths.r1148Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        featureOnlyModeConclusion: string | null;
        featureOnlyModeModelEvidencePromotionAllowed: boolean | null;
        featureOnlyModeOutcomeLinkedEvidenceReady: boolean | null;
        featureOnlyModeSupportedFeatureFamilyIds: string[];
        nextAction: string;
        packetId: string;
        requiredSourceFamilyIds: string[];
        safeAvailabilityActionPacketConclusion: string | null;
        safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact: string | null;
        safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount: number | null;
        safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths: string[];
        safeAvailabilityActionPacketNextAction: string | null;
      };
      expect(summary).toMatchObject({
        featureOnlyModeConclusion: "ordinary_feature_only_mode_waiting_on_safe_availability_confirmation",
        featureOnlyModeModelEvidencePromotionAllowed: false,
        featureOnlyModeOutcomeLinkedEvidenceReady: false,
        featureOnlyModeSupportedFeatureFamilyIds: [],
        nextAction: "run_r1142_for_real_lab_wearable_route_metrics",
        packetId: "r1149-ordinary-consumer-lab-wearable-submission-kit",
        requiredSourceFamilyIds: REQUIRED_SOURCE_FAMILY_IDS,
        safeAvailabilityActionPacketConclusion: "safe_availability_action_packet_ready_for_outcome_linked_recipe_readiness",
        safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact: R1154_FEATURE_ONLY_QUICKSTART_ARTIFACT,
        safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount:
          R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
        safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths:
          R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS,
        safeAvailabilityActionPacketNextAction: "run_r1144_recipe_readiness_chain_with_confirmed_availability",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("outputPath");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeInputs(
  dir: string,
  fixtures: {
    r1146?: Record<string, unknown>;
    r1147?: Record<string, unknown>;
    r1148?: Record<string, unknown>;
  } = {},
): Promise<{ r1146Path: string; r1147Path: string; r1148Path: string }> {
  const r1146Path = path.join(dir, "r1146.json");
  const r1147Path = path.join(dir, "r1147.json");
  const r1148Path = path.join(dir, "r1148.json");
  await Promise.all([
    writeJson(r1146Path, fixtures.r1146 ?? r1146Fixture()),
    writeJson(r1147Path, fixtures.r1147 ?? r1147Fixture()),
    writeJson(r1148Path, fixtures.r1148 ?? r1148Fixture()),
  ]);
  return { r1146Path, r1147Path, r1148Path };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function r1146Fixture(options: {
  confirmed?: boolean;
  configIncomplete?: boolean;
  configReady?: boolean;
  featureGuardUnsafe?: boolean;
  postConfirmationPrivateConfigIntakeUnsafe?: boolean;
  ready?: boolean;
  safeActionPacketUnsafe?: boolean;
} = {}): Record<string, unknown> {
  const confirmed = options.confirmed === true || options.configIncomplete === true || options.configReady === true || options.ready === true;
  const configSupplied = options.configIncomplete === true || options.configReady === true || options.ready === true;
  const configReady = options.configReady === true || options.ready === true;
  const metricsRecorded = options.ready === true;
  const featureGuardUnsafe = options.featureGuardUnsafe === true;
  const postConfirmationPrivateConfigIntakeUnsafe = options.postConfirmationPrivateConfigIntakeUnsafe === true;
  const safeActionPacketUnsafe = options.safeActionPacketUnsafe === true;
  const safeActionPacketReady = confirmed || safeActionPacketUnsafe;
  const blockers = featureGuardUnsafe
    ? ["feature_only_submission_model_evidence_guard_missing_or_unsafe"]
    : safeActionPacketUnsafe
      ? ["safe_availability_action_packet_missing_or_unsafe"]
    : postConfirmationPrivateConfigIntakeUnsafe
      ? ["post_confirmation_private_config_intake_safe_action_guard_missing_or_stale"]
    : metricsRecorded
    ? []
    : !confirmed
      ? [
        "row_owner_availability_assertions_not_confirmed",
        "confirmed_route_config_requirements_not_available",
        "private_route_config_not_supplied",
        "real_lab_wearable_route_metrics_missing",
      ]
      : configReady
        ? ["real_lab_wearable_route_metrics_missing"]
        : [
          options.configIncomplete === true ? "private_route_config_incomplete" : "private_route_config_not_supplied",
          "real_lab_wearable_route_metrics_missing",
        ];
  return {
    artifactBoundary: safeBoundary("R1146"),
    packetId: "r1146-ordinary-consumer-row-owner-route-action-packet",
    productDisplayAuthorized: false,
    rowOwnerRouteActionPacket: {
      availabilityAssertionChecklist: REQUIRED_SOURCE_FAMILY_IDS.map((familyId, index) => ({
        familyId,
        priority: index + 1,
        privateDetailsStored: false,
        requiredForRecommendedRecipe: true,
        role: `${familyId}_role`,
        safeAssertionMeaning: `${familyId}_safe_assertion`,
      })),
      blockers,
      commands: {
        partialPrivateChainRunnerCommand: R1142_COMMAND,
        recipeReadinessChainRunnerCommand:
          "MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ID=<recipe-id> MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ASSERTIONS_CONFIRMED=true pnpm exec tsx scripts/murph-age/r1144-ordinary-consumer-recipe-readiness-chain-runner.ts",
        recommendedConfirmedRecipeCommand:
          "MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ID=lab_plus_wearable_minimum_manifest MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ASSERTIONS_CONFIRMED=true pnpm exec tsx scripts/murph-age/r1144-ordinary-consumer-recipe-readiness-chain-runner.ts",
      },
      expectedPrivateConfigAfterConfirmation: {
        fieldRefFamilies: FIELD_REF_FAMILIES,
        tableRefs: TABLE_REFS,
      },
      fallbackRecipeIds: [
        "lab_glycemia_minimum_manifest",
        "wearable_activity_minimum_manifest",
      ],
      featureOnlySubmissionMode: {
        conclusion: metricsRecorded
          ? "ordinary_feature_only_mode_superseded_by_outcome_linked_evidence"
          : "ordinary_feature_only_mode_waiting_on_safe_availability_confirmation",
        featureOnlyCoverageContextAllowed: false,
        modelEvidencePromotionAllowed: featureGuardUnsafe,
        outcomeLinkedEvidenceReady: metricsRecorded,
        privateDetailsStored: false,
        supportedFeatureFamilyIds: metricsRecorded ? ["bloodwork_glycemia", "wearable_activity_daily"] : [],
      },
      safeAvailabilityActionPacket: {
        conclusion: safeActionPacketReady
          ? "safe_availability_action_packet_ready_for_outcome_linked_recipe_readiness"
          : "safe_availability_action_packet_waiting_on_safe_confirmation",
        featureOnlyCoverageContextReady: safeActionPacketReady,
        featureOnlyQuickstartArtifact: R1154_FEATURE_ONLY_QUICKSTART_ARTIFACT,
        featureOnlyQuickstartSafeFieldEditCount: R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
        featureOnlyQuickstartSafeFieldEditPaths: R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS,
        minimumFeaturePairRequired: FEATURE_ONLY_PAIR_FAMILY_IDS,
        missingFeatureOnlySourceFamilyIds: safeActionPacketReady ? [] : FEATURE_ONLY_PAIR_FAMILY_IDS,
        missingRequiredSourceFamilyIds: safeActionPacketReady ? [] : REQUIRED_SOURCE_FAMILY_IDS,
        nextAction: safeActionPacketUnsafe
          ? "refresh_r1154_safe_availability_action_packet"
          : safeActionPacketReady
            ? "run_r1144_recipe_readiness_chain_with_confirmed_availability"
            : "fill_safe_availability_confirmation_from_template",
        outcomeLinkageRequiredForFeatureOnlyContext: false,
        privateDetailsStored: false,
        readyForOutcomeLinkedRecipeReadinessChain: safeActionPacketReady,
        rowLevelDataAcceptedByR1154: safeActionPacketUnsafe,
        safeAvailabilityConfirmationStatus: safeActionPacketReady ? "available" : "missing",
      },
      routeEvidenceState: {
        privateRouteConfigReadyForR1142: configReady,
        privateRouteConfigSupplied: configSupplied,
        privateRouteConfigSuppliedToIntake: configSupplied,
        privateRouteConfigStatus: configSupplied ? "available" : "missing",
        realLabWearableRouteMetricsRecorded: metricsRecorded,
        rowOwnerAssertionsConfirmed: confirmed,
      },
    },
    schemaVersion: "murph-age-r1146-ordinary-consumer-row-owner-route-action-packet.v1",
    status: "research-local-aggregate-only",
    summary: {
      blockers,
      conclusion: featureGuardUnsafe
        ? "ordinary_row_owner_route_action_packet_waiting_on_feature_only_guard_refresh"
        : safeActionPacketUnsafe
          ? "ordinary_row_owner_route_action_packet_waiting_on_safe_availability_action_packet_refresh"
        : postConfirmationPrivateConfigIntakeUnsafe
          ? "ordinary_row_owner_route_action_packet_waiting_on_post_confirmation_private_config_intake_refresh"
        : metricsRecorded
        ? "ordinary_row_owner_route_action_packet_ready_for_research_review"
        : confirmed
          ? "ordinary_row_owner_route_action_packet_waiting_on_real_route_metrics"
          : "ordinary_row_owner_route_action_packet_waiting_on_safe_availability_confirmation",
      fallbackRecipeIds: [
        "lab_glycemia_minimum_manifest",
        "wearable_activity_minimum_manifest",
      ],
      featureOnlyModeConclusion: metricsRecorded
        ? "ordinary_feature_only_mode_superseded_by_outcome_linked_evidence"
        : "ordinary_feature_only_mode_waiting_on_safe_availability_confirmation",
      featureOnlyModeModelEvidencePromotionAllowed: featureGuardUnsafe,
      featureOnlyModeOutcomeLinkedEvidenceReady: metricsRecorded,
      featureOnlyModeSupportedFeatureFamilyIds: metricsRecorded ? ["bloodwork_glycemia", "wearable_activity_daily"] : [],
      goalAchieved: metricsRecorded,
      nextAction: featureGuardUnsafe
        ? "refresh_r1151_feature_only_submission_mode"
        : safeActionPacketUnsafe
          ? "refresh_r1154_safe_availability_action_packet"
        : postConfirmationPrivateConfigIntakeUnsafe
          ? "refresh_r1148_post_confirmation_private_config_intake"
        : metricsRecorded
        ? "review_real_lab_wearable_route_metrics_research_only"
        : configReady
          ? "run_r1142_for_real_lab_wearable_route_metrics"
          : confirmed
            ? "fill_private_route_config_for_recommended_lab_wearable_routes"
            : "fill_safe_availability_confirmation_from_template",
      privateRouteConfigReadyForR1142: configReady,
      privateRouteConfigStatus: configSupplied ? "available" : "missing",
      privateRouteConfigSuppliedToIntake: configSupplied,
      productDisplayAuthorized: false,
      readyToMarkComplete: metricsRecorded,
      recommendedConfirmedRecipeCommandAvailable: true,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1146: false,
      safeAvailabilityActionPacketConclusion: safeActionPacketReady
        ? "safe_availability_action_packet_ready_for_outcome_linked_recipe_readiness"
        : "safe_availability_action_packet_waiting_on_safe_confirmation",
      safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact: R1154_FEATURE_ONLY_QUICKSTART_ARTIFACT,
      safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount:
        R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
      safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths:
        R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS,
      safeAvailabilityActionPacketNextAction: safeActionPacketUnsafe
        ? "refresh_r1154_safe_availability_action_packet"
        : safeActionPacketReady
          ? "run_r1144_recipe_readiness_chain_with_confirmed_availability"
          : "fill_safe_availability_confirmation_from_template",
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
      commands: {
        partialPrivateChainRunnerCommand: R1142_COMMAND,
      },
    },
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1147-ordinary-consumer-post-confirmation-private-config-packet.v1",
    status: "research-local-aggregate-only",
    summary: {
      blockers: confirmed
        ? ["private_route_config_not_supplied", "real_lab_wearable_route_metrics_missing"]
        : [
          "row_owner_availability_assertions_not_confirmed",
          "private_route_config_not_supplied",
          "real_lab_wearable_route_metrics_missing",
        ],
      conclusion: confirmed
        ? "ordinary_post_confirmation_private_config_packet_waiting_on_private_route_config"
        : "ordinary_post_confirmation_private_config_packet_waiting_on_row_owner_confirmation",
      expectedRouteIds: EXPECTED_ROUTE_IDS,
      goalAchieved: false,
      nextAction: confirmed
        ? "fill_post_confirmation_private_config_and_run_r1142"
        : "run_recommended_confirmed_recipe_chain_before_private_config_packet",
      privateConfigTemplateArtifact: "r1147-fillable-ordinary-consumer-lab-wearable-private-route-config.json",
      privateConfigTemplateReadyForFill: confirmed,
      productDisplayAuthorized: false,
      readyToMarkComplete: false,
      requiredPrivateFieldRefFamilies: FIELD_REF_FAMILIES,
      requiredPrivateTableRefs: TABLE_REFS,
      reviewGptRequiredNow: false,
      runnerConfigPrivateFieldRefKeys: RUNNER_FIELD_KEYS,
      runnerConfigPrivateTableRefKeys: RUNNER_TABLE_KEYS,
      runnerConfigRouteRunOrder: EXPECTED_ROUTE_IDS,
      runnerConfigSchemaVersion: RUNNER_SCHEMA_VERSION,
      runnerConfigTopLevelKeys: [
        "schemaVersion",
        "attestations",
        "aggregateMetricsTarget",
        "routeRunOrder",
        "privateTableRefs",
        "privateFieldRefs",
        "submissionContext",
      ],
      rowOwnerAssertionsConfirmed: confirmed,
      rowParsingPerformedByR1147: false,
      selectedRecommendedRecipeId: "lab_plus_wearable_minimum_manifest",
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1148Fixture(options: {
  packetReady?: boolean;
  ready?: boolean;
  suppliedIncomplete?: boolean;
} = {}): Record<string, unknown> {
  const packetReady = options.packetReady === true || options.ready === true || options.suppliedIncomplete === true;
  const supplied = options.ready === true || options.suppliedIncomplete === true;
  const ready = options.ready === true;
  return {
    artifactBoundary: safeBoundary("R1148"),
    packetId: "r1148-ordinary-consumer-post-confirmation-private-config-intake",
    postConfirmationPrivateConfigIntake: {
      commands: {
        partialPrivateChainRunnerCommand: R1142_COMMAND,
        postConfirmationPrivateConfigIntakeCommand: R1148_COMMAND,
      },
    },
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1148-ordinary-consumer-post-confirmation-private-config-intake.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: ready
        ? "post_confirmation_private_config_ready_for_r1142"
        : supplied
          ? "post_confirmation_private_config_incomplete"
          : packetReady
            ? "post_confirmation_private_config_not_provided"
            : "post_confirmation_private_config_waiting_on_packet",
      evidenceRoleStatus: ready || supplied ? "complete_real_evidence" : "not_provided",
      expectedRouteIds: EXPECTED_ROUTE_IDS,
      missingAttestationKeys: supplied && !ready ? ["noPrivatePathEgress"] : ready ? [] : [
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
      missingRouteIds: supplied && !ready ? ["wearable_activity_minimum_route"] : ready ? [] : EXPECTED_ROUTE_IDS,
      missingRunnerFieldRefKeys: supplied && !ready ? ["labGlycemia", "wearableActivity"] : ready ? [] : RUNNER_FIELD_KEYS,
      missingRunnerTableRefKeys: supplied && !ready ? ["labTableRef", "wearableTableRef"] : ready ? [] : RUNNER_TABLE_KEYS,
      nextAction: ready
        ? "run_r1142_for_real_lab_wearable_route_metrics"
        : supplied
          ? "complete_post_confirmation_private_runner_config_slots"
          : packetReady
            ? "provide_post_confirmation_private_runner_config"
            : "refresh_r1147_post_confirmation_private_config_packet",
      ordinaryTableLayout: ready ? "single_primary_table_fallback" : supplied ? "incomplete" : "not_provided",
      packetReadyForConfigIntake: packetReady,
      privateConfigStatus: supplied ? "available" : "missing",
      privateConfigSuppliedToIntake: supplied,
      productDisplayAuthorized: false,
      readyForR1142: ready,
      requestedRouteIds: ready ? EXPECTED_ROUTE_IDS : supplied ? ["lab_glycemia_minimum_route"] : [],
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1148: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function safeBoundary(label: "R1146" | "R1147" | "R1148"): Record<string, boolean> {
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
    privateConfigPathStored: false,
    privateConfigValuesStored: false,
    privateFieldRefValuesStored: false,
    privateFieldRefsStored: false,
    privateTableRefValuesStored: false,
    privateTableRefsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    [`rowParsingPerformedBy${label}`]: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}
