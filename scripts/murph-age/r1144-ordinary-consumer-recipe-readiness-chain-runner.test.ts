import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1144_ORDINARY_CONSUMER_RECIPE_READINESS_CHAIN_RUNNER_SCHEMA_VERSION,
  runR1144OrdinaryConsumerRecipeReadinessChainRunner,
} from "./r1144-ordinary-consumer-recipe-readiness-chain-runner.ts";

const ORDINARY_SOURCE_FAMILY_IDS = [
  "join_time_alignment",
  "outcome_linkage",
  "bloodwork_glycemia",
  "common_bloodwork_core",
  "vitals_body_context",
  "wearable_activity_daily",
];
const LAB_PLUS_WEARABLE_SOURCE_FAMILY_IDS = [
  "outcome_linkage",
  "join_time_alignment",
  "bloodwork_glycemia",
  "wearable_activity_daily",
];
const LAB_PLUS_WEARABLE_UNAVAILABLE_SOURCE_FAMILY_IDS = [
  "common_bloodwork_core",
  "vitals_body_context",
];
const R1142_PARTIAL_PRIVATE_CHAIN_RUNNER_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH=<availability-manifest.json> MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH=<partial-private-config.json> pnpm exec tsx scripts/murph-age/r1142-ordinary-consumer-partial-private-chain-runner.ts";

describe("R1144 ordinary consumer recipe readiness chain runner", () => {
  it("stops before route planning until row-owner recipe assertions are confirmed", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1144-wait-"));
    try {
      const r1135Path = await writeR1135Fixture(tmp);
      const { output, outputPath } = await runR1144OrdinaryConsumerRecipeReadinessChainRunner({
        assertionsConfirmed: false,
        createdAt: "2026-05-16T17:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        r1135Path,
        r1150Path: path.join(tmp, "missing-r1150.json"),
        recipeId: "lab_plus_wearable_minimum_manifest",
      });

      expect(path.basename(outputPath)).toBe("r1144-ordinary-consumer-recipe-readiness-chain-runner.latest.json");
      expect(output.schemaVersion).toBe(R1144_ORDINARY_CONSUMER_RECIPE_READINESS_CHAIN_RUNNER_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "ordinary_recipe_readiness_chain_waiting_on_row_owner_confirmation",
        eligiblePartialRouteIds: [],
        generatedAvailabilityManifestArtifact: null,
        generatedManifestWritten: false,
        nextAction: "confirm_recipe_availability_assertions_before_running_chain",
        partialAggregateMetricsTemplateArtifact: null,
        partialPrivateConfigTemplateArtifact: null,
        productDisplayAuthorized: false,
        recipeId: "lab_plus_wearable_minimum_manifest",
        requiredPrivateFieldRefFamilies: [],
        requiredPrivateTableRefs: [],
        rowOwnerAssertionsConfirmed: false,
        safeAvailabilityConfirmationReadyForRecipeReadinessChain: false,
      });
      expect(output.recipeReadinessChain.partialReadinessChainArtifact).toBeNull();
      expect(output.recipeReadinessChain.missingSourceFamilyIds).toEqual(
        LAB_PLUS_WEARABLE_UNAVAILABLE_SOURCE_FAMILY_IDS,
      );
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("runs a confirmed lab-plus-wearable recipe to route readiness and metric templates", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1144-confirmed-"));
    try {
      const r1132Path = await writeR1132Fixture(tmp);
      const r1135Path = await writeR1135Fixture(tmp);
      const { output } = await runR1144OrdinaryConsumerRecipeReadinessChainRunner({
        assertionsConfirmed: true,
        outputDir: path.join(tmp, "out"),
        r1076Path: path.join(tmp, "missing-r1076.json"),
        r1132Path,
        r1135Path,
        r1150Path: path.join(tmp, "missing-r1150.json"),
        recipeId: "lab_plus_wearable_minimum_manifest",
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_recipe_readiness_chain_ready_for_partial_route_inputs",
        eligiblePartialRouteIds: [
          "lab_glycemia_minimum_route",
          "wearable_activity_minimum_route",
        ],
        fullEvidenceGateCleared: false,
        fullSupportedRouteReady: false,
        generatedAvailabilityManifestArtifact: "r1143-generated-safe-ordinary-consumer-availability-manifest.latest.json",
        generatedManifestWritten: true,
        missingSourceFamilyIds: ["common_bloodwork_core", "vitals_body_context"],
        nextAction: "fill_partial_private_config_for_ready_routes_then_run_r1141_partial_private_metric_runner",
        partialAggregateMetricsTemplateArtifact: "r1138-fillable-ordinary-consumer-partial-aggregate-metrics.json",
        partialPrivateConfigTemplateArtifact: "r1139-fillable-ordinary-consumer-partial-private-config.json",
        productDisplayAuthorized: false,
        readyPartialMetricRouteIds: [],
        recipeId: "lab_plus_wearable_minimum_manifest",
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
        rowOwnerAssertionsConfirmed: true,
        safeAvailabilityConfirmationReadyForRecipeReadinessChain: false,
      });
      expect(output.recipeReadinessChain.requiredPrivateFieldRefFamilies).toEqual([
        "personJoinKey",
        "dateOrTimeKey",
        "outcomeEvent",
        "labGlycemia",
        "wearableActivity",
      ]);
      expect(output.recipeReadinessChain.requiredPrivateTableRefs).toEqual([
        "primaryTableRef",
        "outcomeTableRef",
        "labTableRef",
        "wearableTableRef",
      ]);
      expect(output.recipeReadinessChain.partialReadinessChainArtifact).toBe(
        "r1140-ordinary-consumer-partial-readiness-chain-runner.latest.json",
      );
      expect(output.recipeReadinessChain.materializerConclusion).toBe(
        "ordinary_manifest_recipe_materializer_generated_safe_manifest",
      );
      expect(output.recipeReadinessChain.partialReadinessChainConclusion).toBe(
        "ordinary_partial_readiness_chain_ready_for_partial_private_mapping",
      );
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("uses a ready R1150 safe availability confirmation to run recipe readiness", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1144-r1150-ready-"));
    try {
      const r1132Path = await writeR1132Fixture(tmp);
      const r1135Path = await writeR1135Fixture(tmp);
      const r1150Path = await writeR1150Fixture(tmp, { ready: true });
      const { output } = await runR1144OrdinaryConsumerRecipeReadinessChainRunner({
        assertionsConfirmed: false,
        outputDir: path.join(tmp, "out"),
        r1076Path: path.join(tmp, "missing-r1076.json"),
        r1132Path,
        r1135Path,
        r1150Path,
        recipeId: "lab_plus_wearable_minimum_manifest",
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_recipe_readiness_chain_ready_for_partial_route_inputs",
        eligiblePartialRouteIds: [
          "lab_glycemia_minimum_route",
          "wearable_activity_minimum_route",
        ],
        generatedManifestWritten: true,
        rowOwnerAssertionsConfirmed: true,
        safeAvailabilityConfirmationReadyForRecipeReadinessChain: true,
      });
      expect(output.recipeReadinessChain.safeAvailabilityConfirmationReadyForRecipeReadinessChain).toBe(true);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeR1135Fixture(tmp: string): Promise<string> {
  const r1135Path = path.join(tmp, "r1135.json");
  await mkdir(path.dirname(r1135Path), { recursive: true });
  await writeFile(r1135Path, `${JSON.stringify({
    artifactBoundary: safeBoundary("R1135"),
    availabilityManifestPacket: {
      partialRouteManifestRecipes: [
        {
          expectedEligiblePartialRouteIds: [
            "lab_glycemia_minimum_route",
            "wearable_activity_minimum_route",
          ],
          expectedFullSupportedRouteId: null,
          expectedFullSupportedRouteReady: false,
          recipeId: "lab_plus_wearable_minimum_manifest",
          recipeRouteGroupId: "lab_plus_wearable_minimum_research_route",
          routeKind: "partial_lab_wearable_route",
          routeUse:
            "preferred first ordinary submitter manifest when glycemia bloodwork and daily wearable activity are both available",
          sourceFamiliesToDeclareAvailable: LAB_PLUS_WEARABLE_SOURCE_FAMILY_IDS,
          sourceFamiliesToDeclareUnavailable: LAB_PLUS_WEARABLE_UNAVAILABLE_SOURCE_FAMILY_IDS,
        },
      ],
    },
    packetId: "r1135-ordinary-consumer-availability-manifest-packet",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1135-ordinary-consumer-availability-manifest-packet.v1",
    status: "research-local-aggregate-only",
    summary: {
      partialPrivateChainRunnerCommand: R1142_PARTIAL_PRIVATE_CHAIN_RUNNER_COMMAND,
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1135: false,
    },
  })}\n`);
  return r1135Path;
}

async function writeR1132Fixture(tmp: string): Promise<string> {
  const r1132Path = path.join(tmp, "r1132.json");
  await writeFile(r1132Path, `${JSON.stringify({
    artifactBoundary: safeBoundary("R1132"),
    ordinaryConsumerReadiness: {
      commands: {
        configIntakeCommand: "pnpm exec tsx scripts/murph-age/r1122-local-private-consumer-receipt-runner-config-intake.ts",
        metricIntakeCommand: "pnpm exec tsx scripts/murph-age/r1124-consumer-first-pass-aggregate-metric-intake.ts",
        privateRunnerCommand: "pnpm exec tsx scripts/murph-age/r1125-local-private-first-pass-aggregate-metric-runner.ts",
      },
      sourceFamilies: ORDINARY_SOURCE_FAMILY_IDS.map((familyId) => ({
        familyId,
        inputKind: `${familyId}_safe_input_kind`,
        missingSlotCount: 1,
        missingSlotIds: [],
      })),
    },
    packetId: "r1132-ordinary-consumer-submission-readiness",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1132-ordinary-consumer-submission-readiness.v1",
    status: "research-local-aggregate-only",
    summary: {
      productDisplayAuthorized: false,
      readyForPrivateRunner: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1132: false,
    },
  })}\n`);
  return r1132Path;
}

async function writeR1150Fixture(tmp: string, options: { ready: boolean }): Promise<string> {
  const r1150Path = path.join(tmp, "r1150.json");
  await writeFile(r1150Path, `${JSON.stringify({
    artifactBoundary: safeBoundary("R1150"),
    packetId: "r1150-ordinary-consumer-safe-availability-confirmation-intake",
    productDisplayAuthorized: false,
    safeAvailabilityConfirmationIntake: {
      privateDetailsStored: false,
      safeConfirmationReadyForR1143: options.ready,
    },
    schemaVersion: "murph-age-r1150-ordinary-consumer-safe-availability-confirmation-intake.v1",
    status: "research-local-aggregate-only",
    summary: {
      confirmationStatus: options.ready ? "available" : "missing",
      productDisplayAuthorized: false,
      readyForRecipeReadinessChain: options.ready,
      reviewGptRequiredNow: false,
      rowOwnerAssertionsConfirmed: options.ready,
      rowParsingPerformedByR1150: false,
    },
  })}\n`);
  return r1150Path;
}

function safeBoundary(source: string): Record<string, false | true> {
  return {
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
    recommendationClaimsIncluded: false,
    [`rowParsingPerformedBy${source}`]: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
  };
}
