import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1147_ORDINARY_CONSUMER_POST_CONFIRMATION_PRIVATE_CONFIG_PACKET_SCHEMA_VERSION,
  runR1147OrdinaryConsumerPostConfirmationPrivateConfigPacket,
} from "./r1147-ordinary-consumer-post-confirmation-private-config-packet.ts";

const RECOMMENDED_RECIPE_ID = "lab_plus_wearable_minimum_manifest";
const ROUTE_IDS = [
  "lab_glycemia_minimum_route",
  "wearable_activity_minimum_route",
];
const REQUIRED_SOURCE_FAMILY_IDS = [
  "outcome_linkage",
  "join_time_alignment",
  "bloodwork_glycemia",
  "wearable_activity_daily",
];
const FEATURE_ONLY_PAIR_FAMILY_IDS = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
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
const R1142_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH=<availability-manifest.json> MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH=<partial-private-config.json> pnpm exec tsx scripts/murph-age/r1142-ordinary-consumer-partial-private-chain-runner.ts";
const R1144_CONFIRMED_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ID=lab_plus_wearable_minimum_manifest MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ASSERTIONS_CONFIRMED=true pnpm exec tsx scripts/murph-age/r1144-ordinary-consumer-recipe-readiness-chain-runner.ts";
const RUNNER_CONFIG_SCHEMA_VERSION = "murph-age-ordinary-consumer-partial-private-runner-config.v1";
const RUNNER_AGGREGATE_SCHEMA_VERSION = "murph-age-ordinary-consumer-partial-aggregate-metrics.v1";
const RUNNER_AGGREGATE_EVALUATOR_ID = "ordinary_consumer_partial_route_aggregate_evaluator_v1";
const RUNNER_TOP_LEVEL_KEYS = [
  "schemaVersion",
  "attestations",
  "aggregateMetricsTarget",
  "routeRunOrder",
  "privateTableRefs",
  "privateFieldRefs",
  "submissionContext",
];
const RUNNER_ATTESTATION_KEYS = [
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
const RUNNER_PRIVATE_FIELD_REF_KEYS = [
  "personJoinKey",
  "outcomeEvent",
  "labGlycemia",
  "wearableActivity",
];
const RUNNER_PRIVATE_TABLE_REF_KEYS = [
  "primaryTableRef",
  "outcomeTableRef",
  "labTableRef",
  "wearableTableRef",
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

describe("R1147 ordinary consumer post-confirmation private config packet", () => {
  it("waits on row-owner confirmation while preserving the lab-plus-wearable slot starter", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1147-waiting-"));
    try {
      const paths = await writeInputs(tmp);
      const { output, outputPath, privateConfigTemplatePath } =
        await runR1147OrdinaryConsumerPostConfirmationPrivateConfigPacket({
          createdAt: "2026-05-16T22:00:00.000Z",
          outputDir: path.join(tmp, "out"),
          ...paths,
        });

      expect(path.basename(outputPath)).toBe(
        "r1147-ordinary-consumer-post-confirmation-private-config-packet.latest.json",
      );
      expect(path.basename(privateConfigTemplatePath)).toBe(
        "r1147-fillable-ordinary-consumer-lab-wearable-private-route-config.json",
      );
      expect(output.schemaVersion).toBe(R1147_ORDINARY_CONSUMER_POST_CONFIRMATION_PRIVATE_CONFIG_PACKET_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        blockers: [
          "row_owner_availability_assertions_not_confirmed",
          "private_route_config_not_supplied",
          "real_lab_wearable_route_metrics_missing",
        ],
        conclusion: "ordinary_post_confirmation_private_config_packet_waiting_on_safe_availability_confirmation",
        expectedRouteIds: ROUTE_IDS,
        goalAchieved: false,
        nextAction: "fill_safe_availability_confirmation_from_template",
        privateConfigTemplateArtifact: "r1147-fillable-ordinary-consumer-lab-wearable-private-route-config.json",
        privateConfigTemplateReadyForFill: false,
        productDisplayAuthorized: false,
        readyToMarkComplete: false,
        requiredPrivateFieldRefFamilies: FIELD_REFS,
        requiredPrivateTableRefs: TABLE_REFS,
        reviewGptRequiredNow: false,
        runnerConfigPrivateFieldRefKeys: RUNNER_PRIVATE_FIELD_REF_KEYS,
        runnerConfigPrivateTableRefKeys: RUNNER_PRIVATE_TABLE_REF_KEYS,
        runnerConfigRouteRunOrder: ROUTE_IDS,
        runnerConfigSchemaVersion: RUNNER_CONFIG_SCHEMA_VERSION,
        runnerConfigTopLevelKeys: RUNNER_TOP_LEVEL_KEYS,
        rowOwnerAssertionsConfirmed: false,
        rowParsingPerformedByR1147: false,
        safeAvailabilityActionPacketConclusion: "safe_availability_action_packet_waiting_on_safe_confirmation",
        safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact: R1154_FEATURE_ONLY_QUICKSTART_ARTIFACT,
        safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount:
          R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
        safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths:
          R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS,
        safeAvailabilityActionPacketNextAction: "fill_safe_availability_confirmation_from_template",
        selectedRecommendedRecipeId: RECOMMENDED_RECIPE_ID,
      });
      expect(output.postConfirmationPrivateConfigPacket.safeAvailabilityActionPacket).toMatchObject({
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
      expect(output.postConfirmationPrivateConfigPacket.commands).toMatchObject({
        partialPrivateChainRunnerCommand: R1142_COMMAND,
        recommendedConfirmedRecipeCommand: R1144_CONFIRMED_COMMAND,
      });
      expect(output.postConfirmationPrivateConfigPacket.runnerConfigContract).toMatchObject({
        acceptedPrivateTableLayouts: ["single_primary_table_fallback", "multi_table_or_explicit_refs"],
        aggregateMetricsTarget: {
          evaluatorId: RUNNER_AGGREGATE_EVALUATOR_ID,
          schemaVersion: RUNNER_AGGREGATE_SCHEMA_VERSION,
        },
        fillablePrivateFieldRefKeys: RUNNER_PRIVATE_FIELD_REF_KEYS,
        fillablePrivateTableRefKeys: RUNNER_PRIVATE_TABLE_REF_KEYS,
        localCompletionRequired: true,
        partialPrivateChainRunnerCommand: R1142_COMMAND,
        privateValuesStoredInThisArtifact: false,
        requiredAttestationKeys: RUNNER_ATTESTATION_KEYS,
        routeRunOrder: ROUTE_IDS.map((routeId) => ({ routeId })),
        runnerConfigSchemaVersion: RUNNER_CONFIG_SCHEMA_VERSION,
        runnerTopLevelKeys: RUNNER_TOP_LEVEL_KEYS,
      });
      expect(output.postConfirmationPrivateConfigPacket.routeConfigSlots.map((slot) => slot.routeId)).toEqual(ROUTE_IDS);
      expect(output.postConfirmationPrivateConfigPacket.routeConfigSlots[0]).toMatchObject({
        firstPassCandidateIds: ["L1_tiny_glycemia_only"],
        primaryInputFamilyIds: ["bloodwork_glycemia"],
        requiredPrivateFieldRefFamilies: [
          "personJoinKey",
          "dateOrTimeKey",
          "outcomeEvent",
          "labGlycemia",
        ],
        requiredPrivateTableRefs: ["primaryTableRef", "outcomeTableRef", "labTableRef"],
        valuesStoredInThisArtifact: false,
      });
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(output)).not.toContain("glucose_value");
      expect(JSON.stringify(output)).not.toContain("synthetic-person");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const template = JSON.parse(await readFile(privateConfigTemplatePath, "utf8")) as unknown;
      expect(findForbiddenAggregateEgress(template)).toEqual([]);
      expect(template).toMatchObject({
        runnerConfigContract: {
          fillablePrivateFieldRefKeys: RUNNER_PRIVATE_FIELD_REF_KEYS,
          fillablePrivateTableRefKeys: RUNNER_PRIVATE_TABLE_REF_KEYS,
          routeRunOrder: ROUTE_IDS.map((routeId) => ({ routeId })),
          runnerConfigSchemaVersion: RUNNER_CONFIG_SCHEMA_VERSION,
        },
        runnerConfigSkeleton: {
          aggregateMetricsTarget: {
            evaluatorId: RUNNER_AGGREGATE_EVALUATOR_ID,
            schemaVersion: RUNNER_AGGREGATE_SCHEMA_VERSION,
          },
          privateFieldRefs: Object.fromEntries(RUNNER_PRIVATE_FIELD_REF_KEYS.map((key) => [key, ""])),
          privateTableRefs: Object.fromEntries(RUNNER_PRIVATE_TABLE_REF_KEYS.map((key) => [key, ""])),
          routeRunOrder: ROUTE_IDS.map((routeId) => ({ routeId })),
          schemaVersion: RUNNER_CONFIG_SCHEMA_VERSION,
          submissionContext: {
            evidenceRole: "real_partial_route_evidence",
          },
        },
      });
      const templateRecord = template as {
        runnerConfigSkeleton: {
          attestations: Record<string, boolean>;
          privateFieldRefs: Record<string, string>;
          privateTableRefs: Record<string, string>;
        };
      };
      expect(Object.keys(templateRecord.runnerConfigSkeleton.attestations)).toEqual(RUNNER_ATTESTATION_KEYS);
      expect(Object.values(templateRecord.runnerConfigSkeleton.attestations).every(Boolean)).toBe(true);
      expect(Object.values(templateRecord.runnerConfigSkeleton.privateFieldRefs).every((value) => value === "")).toBe(true);
      expect(Object.values(templateRecord.runnerConfigSkeleton.privateTableRefs).every((value) => value === "")).toBe(true);
      expect(JSON.stringify(template)).not.toContain(tmp);
      expect(JSON.stringify(template)).not.toContain("glucose_value");
      expect(JSON.stringify(template)).not.toContain("synthetic-person");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("unlocks the private config fill step after the confirmed R1144 recipe chain", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1147-confirmed-"));
    try {
      const paths = await writeInputs(tmp, {
        r1144: r1144Fixture({ confirmed: true }),
      });

      const { output } = await runR1147OrdinaryConsumerPostConfirmationPrivateConfigPacket({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        blockers: [
          "private_route_config_not_supplied",
          "real_lab_wearable_route_metrics_missing",
        ],
        conclusion: "ordinary_post_confirmation_private_config_packet_waiting_on_private_route_config",
        expectedRouteIds: ROUTE_IDS,
        nextAction: "fill_post_confirmation_private_config_and_run_r1142",
        privateConfigTemplateReadyForFill: true,
        rowOwnerAssertionsConfirmed: true,
      });
      expect(output.postConfirmationPrivateConfigPacket.confirmationState).toEqual({
        generatedAvailabilityManifestArtifact: "r1143-generated-ordinary-consumer-availability-manifest.latest.json",
        generatedManifestWritten: true,
        routeRequirementsAvailable: true,
        rowOwnerAssertionsConfirmed: true,
      });
      expect(output.postConfirmationPrivateConfigPacket.runnerConfigContract.routeRunOrder).toEqual(
        ROUTE_IDS.map((routeId) => ({ routeId })),
      );
      expect(output.postConfirmationPrivateConfigPacket.routeEvidenceState).toEqual({
        privateRouteConfigSupplied: false,
        realLabWearableRouteMetricsRecorded: false,
        rowOwnerAssertionsConfirmed: true,
      });
      expect(output.postConfirmationPrivateConfigPacket.routeConfigSlots.map((slot) => slot.routeId)).toEqual(ROUTE_IDS);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("marks the packet ready only when confirmation, private config, and route metrics are all complete", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1147-ready-"));
    try {
      const paths = await writeInputs(tmp, {
        r1144: r1144Fixture({ confirmed: true }),
        r1146: r1146Fixture({ ready: true }),
      });

      const { output } = await runR1147OrdinaryConsumerPostConfirmationPrivateConfigPacket({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        blockers: [],
        conclusion: "ordinary_post_confirmation_private_config_packet_ready_for_research_review",
        goalAchieved: true,
        nextAction: "review_real_lab_wearable_route_metrics_research_only",
        privateConfigTemplateReadyForFill: true,
        readyToMarkComplete: true,
        rowOwnerAssertionsConfirmed: true,
      });
      expect(output.postConfirmationPrivateConfigPacket.routeEvidenceState).toEqual({
        privateRouteConfigSupplied: true,
        realLabWearableRouteMetricsRecorded: true,
        rowOwnerAssertionsConfirmed: true,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("refreshes R1154 when the row-owner packet reports an unsafe safe availability action packet", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1147-r1154-guard-"));
    try {
      const paths = await writeInputs(tmp, {
        r1146: r1146Fixture({ safeActionPacketUnsafe: true }),
      });

      const { output } = await runR1147OrdinaryConsumerPostConfirmationPrivateConfigPacket({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        blockers: ["safe_availability_action_packet_missing_or_unsafe"],
        conclusion: "ordinary_post_confirmation_private_config_packet_waiting_on_safe_availability_action_packet_refresh",
        nextAction: "refresh_r1154_safe_availability_action_packet",
        privateConfigTemplateReadyForFill: false,
        safeAvailabilityActionPacketRowLevelDataAcceptedByR1154: true,
      });
      expect(output.postConfirmationPrivateConfigPacket.safeAvailabilityActionPacket).toMatchObject({
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

  it("waits for refresh when an input artifact is stale", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1147-stale-"));
    try {
      const paths = await writeInputs(tmp);
      await writeJson(paths.r1144Path, {
        artifactBoundary: safeBoundary("R1144"),
        packetId: "r1144-ordinary-consumer-recipe-readiness-chain-runner",
        productDisplayAuthorized: false,
        schemaVersion: "stale",
      });

      const { output } = await runR1147OrdinaryConsumerPostConfirmationPrivateConfigPacket({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        blockers: ["refresh_post_confirmation_private_config_packet_inputs"],
        conclusion: "ordinary_post_confirmation_private_config_packet_waiting_on_refresh",
        nextAction: "refresh_r1144_r1146_before_private_config_packet",
        privateConfigTemplateReadyForFill: false,
      });
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
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1147-unsafe-"));
    try {
      const paths = await writeInputs(tmp);
      await writeJson(paths.r1146Path, {
        ...r1146Fixture(),
        artifactBoundary: {
          ...safeBoundary("R1146"),
          rowValuesStored: true,
        },
      });

      await expect(runR1147OrdinaryConsumerPostConfirmationPrivateConfigPacket({
        outputDir: path.join(tmp, "out"),
        ...paths,
      })).rejects.toThrow("R1147 rejected unsafe r1146 input: 1 aggregate-egress violation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1147-cli-"));
    try {
      const paths = await writeInputs(tmp, {
        r1144: r1144Fixture({ confirmed: true }),
      });
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1147-ordinary-consumer-post-confirmation-private-config-packet.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1144_ORDINARY_CONSUMER_RECIPE_READINESS_CHAIN_RUNNER_PATH: paths.r1144Path,
          MURPH_AGE_R1146_ORDINARY_CONSUMER_ROW_OWNER_ROUTE_ACTION_PACKET_PATH: paths.r1146Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        nextAction: string;
        privateConfigTemplateReadyForFill: boolean;
        requiredPrivateFieldRefFamilies: string[];
        runnerConfigSchemaVersion: string;
        rowOwnerAssertionsConfirmed: boolean;
        rowParsingPerformedByR1147: boolean;
        safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact: string | null;
        safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount: number | null;
        safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths: string[];
        selectedRecommendedRecipeId: string;
      };
      expect(summary).toMatchObject({
        conclusion: "ordinary_post_confirmation_private_config_packet_waiting_on_private_route_config",
        nextAction: "fill_post_confirmation_private_config_and_run_r1142",
        privateConfigTemplateReadyForFill: true,
        runnerConfigSchemaVersion: RUNNER_CONFIG_SCHEMA_VERSION,
        rowOwnerAssertionsConfirmed: true,
        rowParsingPerformedByR1147: false,
        safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact: R1154_FEATURE_ONLY_QUICKSTART_ARTIFACT,
        safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount:
          R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
        safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths:
          R1154_FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS,
        selectedRecommendedRecipeId: RECOMMENDED_RECIPE_ID,
      });
      expect(summary.requiredPrivateFieldRefFamilies).toEqual(FIELD_REFS);
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
  overrides: {
    r1144?: Record<string, unknown>;
    r1146?: Record<string, unknown>;
  } = {},
): Promise<{ r1144Path: string; r1146Path: string }> {
  const paths = {
    r1144Path: path.join(tmp, "r1144.json"),
    r1146Path: path.join(tmp, "r1146.json"),
  };
  await Promise.all([
    writeJson(paths.r1144Path, overrides.r1144 ?? r1144Fixture()),
    writeJson(paths.r1146Path, overrides.r1146 ?? r1146Fixture()),
  ]);
  return paths;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function r1144Fixture(options: { confirmed?: boolean } = {}): Record<string, unknown> {
  const confirmed = options.confirmed === true;
  return {
    artifactBoundary: safeBoundary("R1144"),
    packetId: "r1144-ordinary-consumer-recipe-readiness-chain-runner",
    productDisplayAuthorized: false,
    recipeReadinessChain: {
      commands: {
        recipeReadinessChainRunnerCommand:
          "MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ID=<recipe-id> MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ASSERTIONS_CONFIRMED=true pnpm exec tsx scripts/murph-age/r1144-ordinary-consumer-recipe-readiness-chain-runner.ts",
      },
      eligiblePartialRouteIds: confirmed ? ROUTE_IDS : [],
      fullEvidenceGateCleared: false,
      fullSupportedRouteReady: false,
      generatedAvailabilityManifestArtifact: confirmed
        ? "r1143-generated-ordinary-consumer-availability-manifest.latest.json"
        : null,
      generatedManifestWritten: confirmed,
      privateDetailsStored: false,
      readyPartialMetricRouteIds: [],
      recipeId: RECOMMENDED_RECIPE_ID,
      requiredPrivateFieldRefFamilies: confirmed ? FIELD_REFS : [],
      requiredPrivateTableRefs: confirmed ? TABLE_REFS : [],
      rowOwnerAssertionsConfirmed: confirmed,
    },
    schemaVersion: "murph-age-r1144-ordinary-consumer-recipe-readiness-chain-runner.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: confirmed
        ? "ordinary_recipe_readiness_chain_ready_for_partial_route_inputs"
        : "ordinary_recipe_readiness_chain_waiting_on_row_owner_confirmation",
      eligiblePartialRouteIds: confirmed ? ROUTE_IDS : [],
      fullEvidenceGateCleared: false,
      fullSupportedRouteReady: false,
      generatedAvailabilityManifestArtifact: confirmed
        ? "r1143-generated-ordinary-consumer-availability-manifest.latest.json"
        : null,
      generatedManifestWritten: confirmed,
      nextAction: confirmed
        ? "fill_partial_private_config_for_ready_routes_then_run_r1141_partial_private_metric_runner"
        : "confirm_recipe_availability_assertions_before_running_chain",
      productDisplayAuthorized: false,
      readyPartialMetricRouteIds: [],
      realAggregateStillMissing: true,
      recipeId: RECOMMENDED_RECIPE_ID,
      requiredPrivateFieldRefFamilies: confirmed ? FIELD_REFS : [],
      requiredPrivateTableRefs: confirmed ? TABLE_REFS : [],
      reviewGptRequiredNow: false,
      rowOwnerAssertionsConfirmed: confirmed,
      rowParsingPerformedByR1144: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1146Fixture(options: { ready?: boolean; safeActionPacketUnsafe?: boolean } = {}): Record<string, unknown> {
  const ready = options.ready === true;
  const safeActionPacketUnsafe = options.safeActionPacketUnsafe === true;
  const safeActionPacketReady = ready || safeActionPacketUnsafe;
  return {
    artifactBoundary: safeBoundary("R1146"),
    packetId: "r1146-ordinary-consumer-row-owner-route-action-packet",
    productDisplayAuthorized: false,
    rowOwnerRouteActionPacket: {
      blockers: ready
        ? []
        : safeActionPacketUnsafe
          ? ["safe_availability_action_packet_missing_or_unsafe"]
        : [
            "row_owner_availability_assertions_not_confirmed",
            "confirmed_route_config_requirements_not_available",
            "private_route_config_not_supplied",
            "real_lab_wearable_route_metrics_missing",
          ],
      commands: {
        partialPrivateChainRunnerCommand: R1142_COMMAND,
        recommendedConfirmedRecipeCommand: R1144_CONFIRMED_COMMAND,
      },
      expectedPrivateConfigAfterConfirmation: {
        fieldRefFamilies: FIELD_REFS,
        tableRefs: TABLE_REFS,
      },
      goalAchieved: ready,
      nextAction: ready
        ? "review_real_lab_wearable_route_metrics_research_only"
        : safeActionPacketUnsafe
          ? "refresh_r1154_safe_availability_action_packet"
          : "fill_safe_availability_confirmation_from_template",
      privateDetailsStored: false,
      readyToMarkComplete: ready,
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
      recommendedRecipe: {
        countBandFloors: {
          eventCountBand: "10_plus",
          usableRecordCountBand: "50_plus",
        },
        expectedEligiblePartialRouteIds: ROUTE_IDS,
        expectedFullSupportedRouteReady: false,
        primarySubmitterInputFamilyIds: ["bloodwork_glycemia", "wearable_activity_daily"],
        productDisplayAuthorized: false,
        recipeId: RECOMMENDED_RECIPE_ID,
        recipeRouteGroupId: "lab_plus_wearable_minimum_research_route",
        routeKind: "partial_lab_wearable_route",
        routeUse: "preferred first ordinary submitter manifest when glycemia bloodwork and daily wearable activity are both available",
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
        targetAgeBand: "roughly_16_50",
      },
      routeEvidenceState: {
        privateRouteConfigSupplied: ready,
        realLabWearableRouteMetricsRecorded: ready,
        rowOwnerAssertionsConfirmed: ready,
      },
      selectedRecommendedRecipeId: RECOMMENDED_RECIPE_ID,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
    schemaVersion: "murph-age-r1146-ordinary-consumer-row-owner-route-action-packet.v1",
    status: "research-local-aggregate-only",
    summary: {
      blockers: ready
        ? []
        : safeActionPacketUnsafe
          ? ["safe_availability_action_packet_missing_or_unsafe"]
        : [
            "row_owner_availability_assertions_not_confirmed",
            "confirmed_route_config_requirements_not_available",
            "private_route_config_not_supplied",
            "real_lab_wearable_route_metrics_missing",
          ],
      conclusion: ready
        ? "ordinary_row_owner_route_action_packet_ready_for_research_review"
        : safeActionPacketUnsafe
          ? "ordinary_row_owner_route_action_packet_waiting_on_safe_availability_action_packet_refresh"
          : "ordinary_row_owner_route_action_packet_waiting_on_safe_availability_confirmation",
      fallbackRecipeIds: [
        "lab_glycemia_minimum_manifest",
        "wearable_activity_minimum_manifest",
      ],
      goalAchieved: ready,
      nextAction: ready
        ? "review_real_lab_wearable_route_metrics_research_only"
        : safeActionPacketUnsafe
          ? "refresh_r1154_safe_availability_action_packet"
          : "fill_safe_availability_confirmation_from_template",
      productDisplayAuthorized: false,
      readyToMarkComplete: ready,
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
      selectedRecommendedRecipeId: RECOMMENDED_RECIPE_ID,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function safeBoundary(label: string): Record<string, unknown> {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedBy: label,
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
    rowParsingPerformedByR1144: false,
    rowParsingPerformedByR1146: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}
