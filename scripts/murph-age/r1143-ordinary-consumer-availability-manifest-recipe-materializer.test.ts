import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { runR1133OrdinaryConsumerDataAvailabilityPreflight } from "./r1133-ordinary-consumer-data-availability-preflight.ts";
import { runR1135OrdinaryConsumerAvailabilityManifestPacket } from "./r1135-ordinary-consumer-availability-manifest-packet.ts";
import {
  R1143_ORDINARY_CONSUMER_AVAILABILITY_MANIFEST_RECIPE_MATERIALIZER_SCHEMA_VERSION,
  runR1143OrdinaryConsumerAvailabilityManifestRecipeMaterializer,
} from "./r1143-ordinary-consumer-availability-manifest-recipe-materializer.ts";

const AVAILABILITY_MANIFEST_SCHEMA_VERSION =
  "murph-age-r1133-ordinary-consumer-data-availability-manifest.v1";
const ORDINARY_SOURCE_FAMILY_IDS = [
  "join_time_alignment",
  "outcome_linkage",
  "bloodwork_glycemia",
  "common_bloodwork_core",
  "vitals_body_context",
  "wearable_activity_daily",
] as const;
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

describe("R1143 ordinary consumer availability manifest recipe materializer", () => {
  it("waits for explicit row-owner confirmation before writing a recipe manifest", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1143-wait-"));
    try {
      const r1135Path = await writeR1135Fixture(tmp);
      const { generatedManifestPath, output } = await runR1143OrdinaryConsumerAvailabilityManifestRecipeMaterializer({
        assertionsConfirmed: false,
        createdAt: "2026-05-16T16:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        r1135Path,
        r1150Path: path.join(tmp, "missing-r1150.json"),
        recipeId: "lab_plus_wearable_minimum_manifest",
      });

      expect(generatedManifestPath).toBeNull();
      expect(output.schemaVersion).toBe(
        R1143_ORDINARY_CONSUMER_AVAILABILITY_MANIFEST_RECIPE_MATERIALIZER_SCHEMA_VERSION,
      );
      expect(output.summary).toMatchObject({
        conclusion: "ordinary_manifest_recipe_materializer_waiting_on_row_owner_confirmation",
        generatedAvailabilityManifestArtifact: null,
        generatedManifestWritten: false,
        nextAction: "confirm_recipe_availability_assertions_before_generating_manifest",
        productDisplayAuthorized: false,
        recipeId: "lab_plus_wearable_minimum_manifest",
        rowOwnerAssertionsConfirmed: false,
        safeAvailabilityConfirmationReadyForRecipeReadinessChain: false,
        safeManifestAttestationsComplete: false,
        sourceFamiliesDeclaredAvailable: LAB_PLUS_WEARABLE_SOURCE_FAMILY_IDS,
        sourceFamiliesDeclaredUnavailable: LAB_PLUS_WEARABLE_UNAVAILABLE_SOURCE_FAMILY_IDS,
      });
      expect(output.manifestRecipeMaterializer.rowOwnerAssertionChecklist).toEqual(
        LAB_PLUS_WEARABLE_SOURCE_FAMILY_IDS.map((familyId) => ({
          assertionId: `actual_source_family_available:${familyId}`,
          familyId,
          requiredStatus: "confirmed_available_for_this_recipe_before_generation",
        })),
      );
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("materializes a confirmed lab-plus-wearable recipe that R1133 and R1135 can match", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1143-confirmed-"));
    try {
      const r1132Path = await writeR1132Fixture(tmp);
      const r1135Path = await writeR1135Fixture(tmp);
      const { generatedManifestPath, output } = await runR1143OrdinaryConsumerAvailabilityManifestRecipeMaterializer({
        assertionsConfirmed: true,
        outputDir: path.join(tmp, "out"),
        r1135Path,
        r1150Path: path.join(tmp, "missing-r1150.json"),
        recipeId: "lab_plus_wearable_minimum_manifest",
      });

      expect(path.basename(generatedManifestPath ?? "")).toBe(
        "r1143-generated-safe-ordinary-consumer-availability-manifest.latest.json",
      );
      expect(output.summary).toMatchObject({
        conclusion: "ordinary_manifest_recipe_materializer_generated_safe_manifest",
        generatedAvailabilityManifestArtifact: "r1143-generated-safe-ordinary-consumer-availability-manifest.latest.json",
        generatedManifestWritten: true,
        nextAction: "run_r1133_with_generated_safe_manifest_then_r1136_or_r1142",
        rowOwnerAssertionsConfirmed: true,
        safeAvailabilityConfirmationReadyForRecipeReadinessChain: false,
        safeManifestAttestationsComplete: true,
      });

      const generatedManifest = JSON.parse(await readFile(generatedManifestPath ?? "", "utf8")) as Record<string, unknown>;
      expect(generatedManifest).toMatchObject({
        aggregateReadinessFacts: {
          eventCountBand: "10_plus",
          outcomeLinked: true,
          sameDenominator: true,
          targetAgeBand: "roughly_16_50",
          usableRecordCountBand: "50_plus",
        },
        schemaVersion: AVAILABILITY_MANIFEST_SCHEMA_VERSION,
        selectedTableLayout: "single_primary_table_fallback",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      });
      expect(generatedManifest.sourceFamilies).toEqual(
        ORDINARY_SOURCE_FAMILY_IDS.map((familyId) => ({
          available: LAB_PLUS_WEARABLE_SOURCE_FAMILY_IDS.includes(familyId),
          familyId,
        })),
      );
      expect(findForbiddenAggregateEgress(generatedManifest)).toEqual([]);

      const preflight = await runR1133OrdinaryConsumerDataAvailabilityPreflight({
        availabilityManifestPath: generatedManifestPath ?? undefined,
        outputDir: path.join(tmp, "preflight"),
        r1132Path,
      });
      expect(preflight.output.summary).toMatchObject({
        manifestStatus: "provided",
        readyForPrivateConfigMapping: false,
        safeManifestAttestationsComplete: true,
      });
      expect(preflight.output.summary.missingSourceFamilyIds).toEqual(
        LAB_PLUS_WEARABLE_UNAVAILABLE_SOURCE_FAMILY_IDS,
      );

      const packet = await runR1135OrdinaryConsumerAvailabilityManifestPacket({
        outputDir: path.join(tmp, "packet"),
        r1076Path: path.join(tmp, "missing-r1076.json"),
        r1133Path: preflight.outputPath,
        r1134Path: path.join(tmp, "missing-r1134.json"),
      });
      expect(packet.output.summary.matchedManifestRecipeIds).toEqual([
        "lab_plus_wearable_minimum_manifest",
        "lab_glycemia_minimum_manifest",
        "wearable_activity_minimum_manifest",
      ]);
      expect(packet.output.availabilityManifestPacket.currentManifestRecipeMatches).toContainEqual({
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
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(findForbiddenAggregateEgress(preflight.output)).toEqual([]);
      expect(findForbiddenAggregateEgress(packet.output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(preflight.output)).not.toContain(tmp);
      expect(JSON.stringify(packet.output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("uses validated R1150 safe availability confirmation as row-owner confirmation", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1143-r1150-ready-"));
    try {
      const r1135Path = await writeR1135Fixture(tmp);
      const r1150Path = await writeR1150Fixture(tmp, { ready: true });
      const { generatedManifestPath, output } = await runR1143OrdinaryConsumerAvailabilityManifestRecipeMaterializer({
        assertionsConfirmed: false,
        outputDir: path.join(tmp, "out"),
        r1135Path,
        r1150Path,
        recipeId: "lab_plus_wearable_minimum_manifest",
      });

      expect(path.basename(generatedManifestPath ?? "")).toBe(
        "r1143-generated-safe-ordinary-consumer-availability-manifest.latest.json",
      );
      expect(output.inputArtifacts.r1150).toMatchObject({
        artifact: "r1150-ordinary-consumer-safe-availability-confirmation-intake.latest.json",
        status: "available",
      });
      expect(output.summary).toMatchObject({
        conclusion: "ordinary_manifest_recipe_materializer_generated_safe_manifest",
        generatedManifestWritten: true,
        rowOwnerAssertionsConfirmed: true,
        safeAvailabilityConfirmationReadyForRecipeReadinessChain: true,
        safeManifestAttestationsComplete: true,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeR1135Fixture(tmp: string): Promise<string> {
  const r1135Path = path.join(tmp, "r1135.json");
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
        {
          expectedEligiblePartialRouteIds: ["lab_glycemia_minimum_route"],
          expectedFullSupportedRouteId: null,
          expectedFullSupportedRouteReady: false,
          recipeId: "lab_glycemia_minimum_manifest",
          recipeRouteGroupId: "lab_glycemia_minimum_route",
          routeKind: "partial_lab_route",
          routeUse: "minimum bloodwork/lab manifest when wearable activity is not yet available",
          sourceFamiliesToDeclareAvailable: [
            "outcome_linkage",
            "join_time_alignment",
            "bloodwork_glycemia",
          ],
          sourceFamiliesToDeclareUnavailable: [
            "common_bloodwork_core",
            "vitals_body_context",
            "wearable_activity_daily",
          ],
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
  await mkdir(path.dirname(r1132Path), { recursive: true });
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
