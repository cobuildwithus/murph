import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1135_ORDINARY_CONSUMER_AVAILABILITY_MANIFEST_PACKET_SCHEMA_VERSION,
  runR1135OrdinaryConsumerAvailabilityManifestPacket,
} from "./r1135-ordinary-consumer-availability-manifest-packet.ts";

const ORDINARY_SOURCE_FAMILY_IDS = [
  "join_time_alignment",
  "outcome_linkage",
  "bloodwork_glycemia",
  "common_bloodwork_core",
  "vitals_body_context",
  "wearable_activity_daily",
];
const PRIMARY_SUBMITTER_INPUT_FAMILY_IDS = [
  "bloodwork_glycemia",
  "common_bloodwork_core",
  "wearable_activity_daily",
  "vitals_body_context",
];
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
const REQUIRED_SAFE_MANIFEST_ATTESTATIONS = [
  "aggregateOnly",
  "noCoefficientEgress",
  "noHeaderNameEgress",
  "noParticipantEgress",
  "noPredictionEgress",
  "noRowEgress",
  "noSmallCellEgress",
  "noSourceTextEgress",
];

describe("R1135 ordinary consumer availability manifest packet", () => {
  it("turns the missing manifest blocker into a safe wearable and bloodwork/lab packet", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1135-waiting-"));
    try {
      const r1076Path = path.join(tmp, "r1076.json");
      const r1133Path = path.join(tmp, "r1133.json");
      const r1134Path = path.join(tmp, "r1134.json");
      await Promise.all([
        writeFile(r1076Path, `${JSON.stringify(r1076Fixture())}\n`),
        writeFile(r1133Path, `${JSON.stringify(r1133WaitingManifestFixture())}\n`),
        writeFile(r1134Path, `${JSON.stringify(r1134WaitingManifestFixture())}\n`),
      ]);

      const { output, outputPath } = await runR1135OrdinaryConsumerAvailabilityManifestPacket({
        createdAt: "2026-05-16T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        r1076Path,
        r1133Path,
        r1134Path,
      });

      expect(path.basename(outputPath)).toBe("r1135-ordinary-consumer-availability-manifest-packet.latest.json");
      expect(output.schemaVersion).toBe(R1135_ORDINARY_CONSUMER_AVAILABILITY_MANIFEST_PACKET_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "ordinary_availability_manifest_packet_waiting_on_row_owner_manifest",
        currentLoopNextAction: "fill_safe_ordinary_data_availability_manifest",
        matchedManifestRecipeIds: [],
        manifestRecipeMaterializerCommand: R1143_MANIFEST_RECIPE_MATERIALIZER_COMMAND,
        missingSourceFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
        nextAction: "fill_r1133_safe_availability_manifest_for_wearables_labs_then_rerun_r1133_r1134",
        partialPrivateChainRunnerCommand: R1142_PARTIAL_PRIVATE_CHAIN_RUNNER_COMMAND,
        partialRouteManifestRecipeIds: PARTIAL_ROUTE_MANIFEST_RECIPE_IDS,
        preferredManifestRecipeIds: PARTIAL_ROUTE_MANIFEST_RECIPE_IDS,
        primarySubmitterInputFamilyIds: PRIMARY_SUBMITTER_INPUT_FAMILY_IDS,
        productDisplayAuthorized: false,
        readyForPrivateConfigMapping: false,
        readyForPrivateRunner: false,
        realAggregateStillMissing: true,
        requiredLinkageFamilyIds: ["outcome_linkage", "join_time_alignment"],
        recipeReadinessChainRunnerCommand: R1144_RECIPE_READINESS_CHAIN_RUNNER_COMMAND,
        rowParsingPerformedByR1135: false,
        safeManifestAttestationsComplete: false,
        targetAgeBand: "roughly_16_50",
      });
      expect(output.availabilityManifestPacket.blockers).toContain("ordinary_data_availability_manifest_missing");
      expect(output.availabilityManifestPacket.fillableManifestArtifact).toBe(
        "r1133-fillable-ordinary-consumer-data-availability-manifest.json",
      );
      expect(output.availabilityManifestPacket.partialPrivateChainRunnerCommand).toBe(
        R1142_PARTIAL_PRIVATE_CHAIN_RUNNER_COMMAND,
      );
      expect(output.availabilityManifestPacket.manifestRecipeMaterializerCommand).toBe(
        R1143_MANIFEST_RECIPE_MATERIALIZER_COMMAND,
      );
      expect(output.availabilityManifestPacket.recipeReadinessChainRunnerCommand).toBe(
        R1144_RECIPE_READINESS_CHAIN_RUNNER_COMMAND,
      );
      expect(output.availabilityManifestPacket.currentManifestRecipeMatches.every(
        (match) => match.currentStatus === "waiting_on_manifest_or_safety_attestations",
      )).toBe(true);
      expect(output.availabilityManifestPacket.preferredManifestRecipeIds).toEqual(PARTIAL_ROUTE_MANIFEST_RECIPE_IDS);
      expect(output.availabilityManifestPacket.partialRouteManifestRecipes).toContainEqual({
        availabilityManifestSchemaVersion: "murph-age-r1133-ordinary-consumer-data-availability-manifest.v1",
        countBandFloors: {
          eventCountBand: "10_plus",
          usableRecordCountBand: "50_plus",
        },
        expectedEligiblePartialRouteIds: [
          "lab_glycemia_minimum_route",
          "wearable_activity_minimum_route",
        ],
        expectedFullSupportedRouteId: null,
        expectedFullSupportedRouteReady: false,
        fullEvidenceGateClearedByRecipe: false,
        primarySubmitterInputFamilyIds: ["bloodwork_glycemia", "wearable_activity_daily"],
        productDisplayAuthorized: false,
        recipeId: "lab_plus_wearable_minimum_manifest",
        recipeOnlyNoClaimOfAvailability: true,
        recipeRouteGroupId: "lab_plus_wearable_minimum_research_route",
        requiredLinkageFamilyIds: ["outcome_linkage", "join_time_alignment"],
        routeKind: "partial_lab_wearable_route",
        routeUse:
          "preferred first ordinary submitter manifest when glycemia bloodwork and daily wearable activity are both available",
        runsWithR1142PartialPrivateChain: true,
        selectedTableLayoutOptions: ["single_primary_table_fallback", "multi_table_or_explicit_refs"],
        sourceFamiliesToDeclareAvailable: [
          "outcome_linkage",
          "join_time_alignment",
          "bloodwork_glycemia",
          "wearable_activity_daily",
        ],
        sourceFamiliesToDeclareUnavailable: ["common_bloodwork_core", "vitals_body_context"],
        targetAgeBand: "roughly_16_50",
      });
      expect(output.availabilityManifestPacket.safeManifestAttestationChecklist).toContainEqual({
        attestationId: "noRowEgress",
        currentStatus: "missing_or_incomplete",
        safeExpectedValue: true,
      });
      expect(output.availabilityManifestPacket.safeManifestAttestationsComplete).toBe(false);
      expect(output.availabilityManifestPacket.forbiddenManifestContent).toContain("header_names");
      expect(output.availabilityManifestPacket.aggregateReadinessChecklist).toContainEqual({
        currentStatus: "missing_or_incomplete",
        fieldId: "eventCountBand",
        minimumCountBand: "10_plus",
        safeExpectedValue: "10_plus or larger, never an exact small count",
      });
      expect(output.availabilityManifestPacket.sourceFamilyChecklist).toContainEqual({
        availabilityStatus: "not_declared",
        familyId: "wearable_activity_daily",
        inputKind: "daily_wearable_activity_export_or_spreadsheet",
        mappingStatus: "missing_or_not_declared",
        priorityGroup: "primary_user_submittable_wearable",
        priorityRank: 5,
        privateDetailsStored: false,
        requiredForCandidateIds: ["W1_activity_steps_minutes"],
        requiredPrivateFieldRefFamilies: ["wearableActivity"],
        requiredPrivateTableRefs: ["wearableTableRef"],
        safeManifestQuestion:
          "Declare whether daily wearable activity data is available from a watch, phone, or wearable export.",
      });
      expect(output.availabilityManifestPacket.sourceFamilyChecklist[2]).toMatchObject({
        familyId: "bloodwork_glycemia",
        priorityGroup: "primary_user_submittable_lab",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes complete safe availability toward private config mapping", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1135-ready-mapping-"));
    try {
      const r1133Path = path.join(tmp, "r1133.json");
      const r1134Path = path.join(tmp, "r1134.json");
      await Promise.all([
        writeFile(r1133Path, `${JSON.stringify(r1133ReadyMappingFixture())}\n`),
        writeFile(r1134Path, `${JSON.stringify(r1134ReadyMappingFixture())}\n`),
      ]);

      const { output } = await runR1135OrdinaryConsumerAvailabilityManifestPacket({
        outputDir: path.join(tmp, "out"),
        r1133Path,
        r1134Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_availability_manifest_packet_ready_for_private_config_mapping",
        matchedManifestRecipeIds: PARTIAL_ROUTE_MANIFEST_RECIPE_IDS,
        manifestRecipeMaterializerCommand: R1143_MANIFEST_RECIPE_MATERIALIZER_COMMAND,
        missingSourceFamilyIds: [],
        nextAction: "fill_private_config_mapping_for_available_wearables_labs",
        partialRouteManifestRecipeIds: PARTIAL_ROUTE_MANIFEST_RECIPE_IDS,
        preferredManifestRecipeIds: PARTIAL_ROUTE_MANIFEST_RECIPE_IDS,
        readyForPrivateConfigMapping: true,
        readyForPrivateRunner: false,
        recipeReadinessChainRunnerCommand: R1144_RECIPE_READINESS_CHAIN_RUNNER_COMMAND,
        safeManifestAttestationsComplete: true,
      });
      expect(output.availabilityManifestPacket.selectedTableLayout).toBe("single_primary_table_fallback");
      expect(output.availabilityManifestPacket.aggregateReadinessChecklist.every(
        (item) => item.currentStatus === "complete",
      )).toBe(true);
      expect(output.availabilityManifestPacket.currentManifestRecipeMatches.every(
        (match) => match.currentStatus === "matched_current_manifest",
      )).toBe(true);
      expect(output.availabilityManifestPacket.safeManifestAttestationChecklist.every(
        (item) => item.currentStatus === "complete",
      )).toBe(true);
      expect(output.availabilityManifestPacket.safeCompletionOrder).toEqual([
        "fill_private_config_mapping_for_declared_available_sources",
        "run_r1122_config_intake",
        "run_r1125_private_runner",
        "run_r1124_real_metric_intake",
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("shows which route recipes a partial lab plus wearable manifest currently satisfies", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1135-partial-match-"));
    try {
      const r1133Path = path.join(tmp, "r1133.json");
      const r1134Path = path.join(tmp, "r1134.json");
      await Promise.all([
        writeFile(r1133Path, `${JSON.stringify(r1133PartialLabWearableFixture())}\n`),
        writeFile(r1134Path, `${JSON.stringify(r1134PartialLabWearableFixture())}\n`),
      ]);

      const { output } = await runR1135OrdinaryConsumerAvailabilityManifestPacket({
        outputDir: path.join(tmp, "out"),
        r1133Path,
        r1134Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_availability_manifest_packet_blocked_missing_required_availability",
        matchedManifestRecipeIds: [
          "lab_plus_wearable_minimum_manifest",
          "lab_glycemia_minimum_manifest",
          "wearable_activity_minimum_manifest",
        ],
        manifestRecipeMaterializerCommand: R1143_MANIFEST_RECIPE_MATERIALIZER_COMMAND,
        missingSourceFamilyIds: ["common_bloodwork_core", "vitals_body_context"],
        nextAction: "collect_outcome_linked_wearable_and_lab_availability_then_rerun_manifest",
        readyForPrivateConfigMapping: false,
        recipeReadinessChainRunnerCommand: R1144_RECIPE_READINESS_CHAIN_RUNNER_COMMAND,
        safeManifestAttestationsComplete: true,
      });
      expect(output.availabilityManifestPacket.currentManifestRecipeMatches).toContainEqual({
        currentStatus: "matched_current_manifest",
        expectedEligiblePartialRouteIds: [
          "lab_glycemia_minimum_route",
          "wearable_activity_minimum_route",
        ],
        expectedFullSupportedRouteReady: false,
        missingSourceFamilyIds: [],
        productDisplayAuthorized: false,
        recipeId: "lab_plus_wearable_minimum_manifest",
        recipeRouteGroupId: "lab_plus_wearable_minimum_research_route",
      });
      expect(output.availabilityManifestPacket.currentManifestRecipeMatches).toContainEqual(
        expect.objectContaining({
          currentStatus: "blocked_missing_source_families",
          missingSourceFamilyIds: ["common_bloodwork_core", "vitals_body_context"],
          recipeId: "full_labs_wearable_first_pass_manifest",
        }),
      );
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1135-cli-"));
    try {
      const r1133Path = path.join(tmp, "r1133.json");
      const r1134Path = path.join(tmp, "r1134.json");
      await Promise.all([
        mkdir(path.join(tmp, "out")),
        writeFile(r1133Path, `${JSON.stringify(r1133ReadyMappingFixture())}\n`),
        writeFile(r1134Path, `${JSON.stringify(r1134ReadyMappingFixture())}\n`),
      ]);

      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1135-ordinary-consumer-availability-manifest-packet.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1133_ORDINARY_CONSUMER_DATA_AVAILABILITY_PREFLIGHT_PATH: r1133Path,
          MURPH_AGE_R1134_ORDINARY_CONSUMER_AVAILABILITY_CONFIG_BRIDGE_PATH: r1134Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        nextAction: string;
        currentManifestRecipeMatches: Array<{ recipeId: string; currentStatus: string }>;
        matchedManifestRecipeIds: string[];
        manifestRecipeMaterializerCommand: string;
        partialPrivateChainRunnerCommand: string;
        partialRouteManifestRecipeIds: string[];
        preferredManifestRecipeIds: string[];
        primarySubmitterInputFamilyIds: string[];
        productDisplayAuthorized: boolean;
        recipeReadinessChainRunnerCommand: string;
        safeManifestAttestationsComplete: boolean;
        safeManifestAttestationChecklist: Array<{ attestationId: string; currentStatus: string }>;
        sourceFamilyChecklist: Array<{ familyId: string; priorityGroup: string }>;
      };
      expect(summary).toMatchObject({
        conclusion: "ordinary_availability_manifest_packet_ready_for_private_config_mapping",
        matchedManifestRecipeIds: PARTIAL_ROUTE_MANIFEST_RECIPE_IDS,
        manifestRecipeMaterializerCommand: R1143_MANIFEST_RECIPE_MATERIALIZER_COMMAND,
        nextAction: "fill_private_config_mapping_for_available_wearables_labs",
        partialPrivateChainRunnerCommand: R1142_PARTIAL_PRIVATE_CHAIN_RUNNER_COMMAND,
        partialRouteManifestRecipeIds: PARTIAL_ROUTE_MANIFEST_RECIPE_IDS,
        preferredManifestRecipeIds: PARTIAL_ROUTE_MANIFEST_RECIPE_IDS,
        primarySubmitterInputFamilyIds: PRIMARY_SUBMITTER_INPUT_FAMILY_IDS,
        productDisplayAuthorized: false,
        recipeReadinessChainRunnerCommand: R1144_RECIPE_READINESS_CHAIN_RUNNER_COMMAND,
        safeManifestAttestationsComplete: true,
      });
      expect(summary.currentManifestRecipeMatches.every(
        (match) => match.currentStatus === "matched_current_manifest",
      )).toBe(true);
      expect(summary.safeManifestAttestationChecklist.map((item) => item.attestationId)).toEqual(
        REQUIRED_SAFE_MANIFEST_ATTESTATIONS,
      );
      expect(summary.sourceFamilyChecklist).toContainEqual({
        availabilityStatus: "declared_available",
        familyId: "bloodwork_glycemia",
        mappingStatus: "available_needs_private_mapping",
        priorityGroup: "primary_user_submittable_lab",
        priorityRank: 3,
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("localPaths");
      expect(stdout).not.toContain("rowValues");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

function r1076Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1076"),
    packetId: "r1076-current-autoresearch-loop-executor",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1076-current-autoresearch-loop-executor.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "executor_ready_for_consumer_first_pass_aggregate_metrics",
      nextAction: "fill_safe_ordinary_data_availability_manifest",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1076: false,
    },
  };
}

function r1133WaitingManifestFixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1133"),
    ordinaryDataAvailabilityPreflight: {
      acceptedTableLayouts: ["single_primary_table_fallback", "multi_table_or_explicit_refs"],
      aggregateReadinessFacts: {
        eventCountBand: "unknown",
        meetsMinimumEventCount: false,
        meetsMinimumUsableRecordCount: false,
        outcomeLinked: false,
        sameDenominator: false,
        targetAgeBand: "roughly_16_50",
        usableRecordCountBand: "unknown",
      },
      blockers: [
        "ordinary_data_availability_manifest_missing",
        ...ORDINARY_SOURCE_FAMILY_IDS.map((familyId) => `source_family_not_available:${familyId}`),
      ],
      commands: {
        availabilityPreflightCommand:
          "MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH=<availability-manifest.json> pnpm exec tsx scripts/murph-age/r1133-ordinary-consumer-data-availability-preflight.ts",
      },
      fillableManifestArtifact: "r1133-fillable-ordinary-consumer-data-availability-manifest.json",
      manifestStatus: "not_provided",
      missingSourceFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
      readyForPrivateConfigMapping: false,
      readyForPrivateRunner: false,
      safeManifestAttestations: {
        checklist: safeManifestAttestationChecklist("missing_or_false"),
        complete: false,
        requiredAttestationIds: REQUIRED_SAFE_MANIFEST_ATTESTATIONS,
      },
      selectedTableLayout: null,
      sourceFamilies: ORDINARY_SOURCE_FAMILY_IDS.map((familyId) => ({
        declaredAvailable: null,
        familyId,
        inputKind: inputKindFor(familyId),
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
      safeManifestAttestationsComplete: false,
    },
  };
}

function r1133ReadyMappingFixture(): Record<string, unknown> {
  const base = r1133WaitingManifestFixture();
  return {
    ...base,
    ordinaryDataAvailabilityPreflight: {
      ...recordAt(base, "ordinaryDataAvailabilityPreflight"),
      aggregateReadinessFacts: {
        eventCountBand: "10_plus",
        meetsMinimumEventCount: true,
        meetsMinimumUsableRecordCount: true,
        outcomeLinked: true,
        sameDenominator: true,
        targetAgeBand: "roughly_16_50",
        usableRecordCountBand: "50_plus",
      },
      blockers: ["private_config_not_ready_for_r1125"],
      manifestStatus: "provided",
      missingSourceFamilyIds: [],
      readyForPrivateConfigMapping: true,
      safeManifestAttestations: {
        checklist: safeManifestAttestationChecklist("complete"),
        complete: true,
        requiredAttestationIds: REQUIRED_SAFE_MANIFEST_ATTESTATIONS,
      },
      selectedTableLayout: "single_primary_table_fallback",
      sourceFamilies: ORDINARY_SOURCE_FAMILY_IDS.map((familyId) => ({
        declaredAvailable: true,
        familyId,
        inputKind: inputKindFor(familyId),
        privateDetailsStored: false,
        requiredForFirstPass: true,
        status: "declared_available",
      })),
    },
    summary: {
      conclusion: "ordinary_data_availability_preflight_ready_for_private_config_mapping",
      manifestStatus: "provided",
      missingSourceFamilyIds: [],
      nextAction: "complete_private_config_for_available_labs_wearables",
      productDisplayAuthorized: false,
      readyForPrivateConfigMapping: true,
      readyForPrivateRunner: false,
      realAggregateStillMissing: true,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1133: false,
      safeManifestAttestationsComplete: true,
    },
  };
}

function r1133PartialLabWearableFixture(): Record<string, unknown> {
  const base = r1133ReadyMappingFixture();
  const available = new Set([
    "join_time_alignment",
    "outcome_linkage",
    "bloodwork_glycemia",
    "wearable_activity_daily",
  ]);
  const missingSourceFamilyIds = ["common_bloodwork_core", "vitals_body_context"];
  return {
    ...base,
    ordinaryDataAvailabilityPreflight: {
      ...recordAt(base, "ordinaryDataAvailabilityPreflight"),
      blockers: missingSourceFamilyIds.map((familyId) => `source_family_not_available:${familyId}`),
      missingSourceFamilyIds,
      readyForPrivateConfigMapping: false,
      sourceFamilies: ORDINARY_SOURCE_FAMILY_IDS.map((familyId) => ({
        declaredAvailable: available.has(familyId),
        familyId,
        inputKind: inputKindFor(familyId),
        privateDetailsStored: false,
        requiredForFirstPass: true,
        status: available.has(familyId) ? "declared_available" : "declared_missing",
      })),
    },
    summary: {
      ...recordAt(base, "summary"),
      conclusion: "ordinary_data_availability_preflight_missing_required_availability",
      missingSourceFamilyIds,
      nextAction: "collect_missing_outcome_linked_labs_wearable_sources",
      readyForPrivateConfigMapping: false,
    },
  };
}

function r1134PartialLabWearableFixture(): Record<string, unknown> {
  const missingSourceFamilyIds = ["common_bloodwork_core", "vitals_body_context"];
  const available = new Set(ORDINARY_SOURCE_FAMILY_IDS.filter((familyId) => !missingSourceFamilyIds.includes(familyId)));
  return {
    artifactBoundary: safeBoundary("R1134"),
    availabilityConfigBridge: {
      availableSourceFamilyIds: [...available],
      blockers: missingSourceFamilyIds.map((familyId) => `source_family_not_available:${familyId}`),
      mappingPlan: {
        selectedTableLayout: "single_primary_table_fallback",
        sourceFamilyMappings: ORDINARY_SOURCE_FAMILY_IDS.map((familyId) => ({
          availabilityStatus: available.has(familyId) ? "declared_available" : "declared_missing",
          familyId,
          mappingStatus: available.has(familyId)
            ? "available_needs_private_mapping"
            : "missing_or_not_declared",
        })),
        status: "blocked_missing_required_availability",
      },
      missingSourceFamilyIds,
      readyForPrivateConfigMapping: false,
      readyForPrivateRunner: false,
      realAggregateStillMissing: true,
    },
    packetId: "r1134-ordinary-consumer-availability-config-bridge",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1134-ordinary-consumer-availability-config-bridge.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "ordinary_availability_config_bridge_blocked_missing_required_availability",
      mappingPlanStatus: "blocked_missing_required_availability",
      missingSourceFamilyIds,
      nextAction: "collect_missing_outcome_linked_labs_wearable_sources",
      productDisplayAuthorized: false,
      readyForPrivateConfigMapping: false,
      readyForPrivateRunner: false,
      realAggregateStillMissing: true,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1134: false,
      selectedTableLayout: "single_primary_table_fallback",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function safeManifestAttestationChecklist(currentStatus: string): Array<Record<string, unknown>> {
  return REQUIRED_SAFE_MANIFEST_ATTESTATIONS.map((attestationId) => ({
    attestationId,
    currentStatus,
    safeExpectedValue: true,
  }));
}

function r1134WaitingManifestFixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1134"),
    availabilityConfigBridge: {
      availableSourceFamilyIds: [],
      blockers: [
        "ordinary_data_availability_manifest_missing",
        ...ORDINARY_SOURCE_FAMILY_IDS.map((familyId) => `source_family_not_available:${familyId}`),
      ],
      commands: {
        availabilityConfigBridgeCommand:
          "pnpm exec tsx scripts/murph-age/r1134-ordinary-consumer-availability-config-bridge.ts",
        configIntakeCommand:
          "MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH=<private-config.json> pnpm exec tsx scripts/murph-age/r1122-local-private-consumer-receipt-runner-config-intake.ts",
        metricIntakeCommand:
          "MURPH_AGE_CONSUMER_FIRST_PASS_AGGREGATE_METRICS_PATH=<aggregate-metrics.json> pnpm exec tsx scripts/murph-age/r1124-consumer-first-pass-aggregate-metric-intake.ts",
        privateRunnerCommand:
          "MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH=<private-config.json> pnpm exec tsx scripts/murph-age/r1125-local-private-first-pass-aggregate-metric-runner.ts",
      },
      mappingPlan: {
        acceptedTableLayouts: ["single_primary_table_fallback", "multi_table_or_explicit_refs"],
        candidateRunOrderIds: [
          "L1_tiny_glycemia_only",
          "L2_common_lab_core_shadow",
          "W1_activity_steps_minutes",
          "QC_missingness_coverage",
        ],
        selectedTableLayout: null,
        sourceFamilyMappings: sourceFamilyMappings("not_declared", "missing_or_not_declared"),
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
    },
  };
}

function r1134ReadyMappingFixture(): Record<string, unknown> {
  const base = r1134WaitingManifestFixture();
  return {
    ...base,
    availabilityConfigBridge: {
      ...recordAt(base, "availabilityConfigBridge"),
      availableSourceFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
      blockers: ["private_config_not_ready_for_r1125"],
      mappingPlan: {
        acceptedTableLayouts: ["single_primary_table_fallback", "multi_table_or_explicit_refs"],
        candidateRunOrderIds: [
          "L1_tiny_glycemia_only",
          "L2_common_lab_core_shadow",
          "W1_activity_steps_minutes",
          "QC_missingness_coverage",
        ],
        selectedTableLayout: "single_primary_table_fallback",
        sourceFamilyMappings: sourceFamilyMappings("declared_available", "available_needs_private_mapping"),
        status: "ready_for_private_config_mapping",
      },
      missingSourceFamilyIds: [],
      readyForPrivateConfigMapping: true,
      readyForPrivateRunner: false,
      realAggregateStillMissing: true,
    },
    summary: {
      conclusion: "ordinary_availability_config_bridge_ready_for_private_config_mapping",
      mappingPlanStatus: "ready_for_private_config_mapping",
      missingSourceFamilyIds: [],
      nextAction: "fill_private_config_mapping_for_available_ordinary_sources",
      productDisplayAuthorized: false,
      readyForPrivateConfigMapping: true,
      readyForPrivateRunner: false,
      realAggregateStillMissing: true,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1134: false,
      selectedTableLayout: "single_primary_table_fallback",
    },
  };
}

function sourceFamilyMappings(availabilityStatus: string, mappingStatus: string): Record<string, unknown>[] {
  return ORDINARY_SOURCE_FAMILY_IDS.map((familyId) => ({
    availabilityStatus,
    familyId,
    inputKind: inputKindFor(familyId),
    mappingStatus,
    privateDetailsStored: false,
    requiredForCandidateIds: candidateIdsFor(familyId),
    requiredPrivateFieldRefFamilies: fieldRefFamiliesFor(familyId),
    requiredPrivateTableRefs: tableRefsFor(familyId),
  }));
}

function inputKindFor(familyId: string): string {
  if (familyId === "bloodwork_glycemia" || familyId === "common_bloodwork_core") {
    return "bloodwork_table_or_lab_portal_export";
  }
  if (familyId === "vitals_body_context") return "body_or_vitals_table";
  if (familyId === "wearable_activity_daily") return "daily_wearable_activity_export_or_spreadsheet";
  if (familyId === "outcome_linkage") return "outcome_or_followup_table";
  return "stable_join_key_and_date_fields";
}

function candidateIdsFor(familyId: string): string[] {
  if (familyId === "wearable_activity_daily") return ["W1_activity_steps_minutes"];
  if (familyId === "common_bloodwork_core" || familyId === "vitals_body_context") return ["L2_common_lab_core_shadow"];
  if (familyId === "bloodwork_glycemia") return ["L1_tiny_glycemia_only", "L2_common_lab_core_shadow"];
  return [
    "L1_tiny_glycemia_only",
    "L2_common_lab_core_shadow",
    "W1_activity_steps_minutes",
    "QC_missingness_coverage",
  ];
}

function fieldRefFamiliesFor(familyId: string): string[] {
  if (familyId === "join_time_alignment") return ["personJoinKey", "dateOrTimeKey"];
  if (familyId === "outcome_linkage") return ["outcomeEvent"];
  if (familyId === "bloodwork_glycemia") return ["labGlycemia"];
  if (familyId === "common_bloodwork_core") return ["commonLabCore"];
  if (familyId === "vitals_body_context") return ["vitalsBody"];
  return ["wearableActivity"];
}

function tableRefsFor(familyId: string): string[] {
  if (familyId === "outcome_linkage") return ["outcomeTableRef"];
  if (familyId === "wearable_activity_daily") return ["wearableTableRef"];
  if (familyId === "join_time_alignment") {
    return ["primaryTableRef", "outcomeTableRef", "labTableRef", "wearableTableRef"];
  }
  if (familyId === "vitals_body_context") return ["labTableRef", "primaryTableRef"];
  return ["labTableRef"];
}

function recordAt(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const nested = value[key];
  return isRecord(nested) ? nested : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeBoundary(stage: "R1076" | "R1133" | "R1134") {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    headerValuesStored: false,
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
