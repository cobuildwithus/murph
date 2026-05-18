import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1137_ORDINARY_CONSUMER_PARTIAL_ROUTE_PLANNER_SCHEMA_VERSION,
  runR1137OrdinaryConsumerPartialRoutePlanner,
} from "./r1137-ordinary-consumer-partial-route-planner.ts";

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

describe("R1137 ordinary consumer partial route planner", () => {
  it("waits on the safe manifest before planning partial routes", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1137-waiting-"));
    try {
      const r1133Path = path.join(tmp, "r1133.json");
      const r1136Path = path.join(tmp, "r1136.json");
      await Promise.all([
        writeFile(r1133Path, `${JSON.stringify(r1133AvailabilityFixture([]))}\n`),
        writeFile(r1136Path, `${JSON.stringify(r1136Fixture("ordinary_availability_chain_waiting_on_safe_manifest"))}\n`),
      ]);

      const { output, outputPath } = await runR1137OrdinaryConsumerPartialRoutePlanner({
        createdAt: "2026-05-16T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        r1133Path,
        r1136Path,
      });

      expect(path.basename(outputPath)).toBe("r1137-ordinary-consumer-partial-route-planner.latest.json");
      expect(output.schemaVersion).toBe(R1137_ORDINARY_CONSUMER_PARTIAL_ROUTE_PLANNER_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "ordinary_partial_route_planner_waiting_on_safe_manifest",
        nextAction: "fill_safe_availability_manifest_then_run_r1136_r1137_chain",
        primarySubmitterInputFamilyIds: PRIMARY_SUBMITTER_INPUT_FAMILY_IDS,
        productDisplayAuthorized: false,
        readyForPrivateConfigMapping: false,
        realAggregateStillMissing: true,
        requiredLinkageFamilyIds: ["outcome_linkage", "join_time_alignment"],
        rowParsingPerformedByR1137: false,
      });
      expect(output.partialRoutePlanner.routeStatuses.every(
        (route) => route.routeAvailabilityStatus === "blocked_waiting_on_manifest",
      )).toBe(true);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("detects lab-only partial evidence routes without opening product gates", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1137-partial-lab-"));
    try {
      const r1133Path = path.join(tmp, "r1133.json");
      const r1136Path = path.join(tmp, "r1136.json");
      await Promise.all([
        writeFile(r1133Path, `${JSON.stringify(r1133AvailabilityFixture([
          "outcome_linkage",
          "join_time_alignment",
          "bloodwork_glycemia",
        ], "provided"))}\n`),
        writeFile(r1136Path, `${JSON.stringify(r1136Fixture("ordinary_availability_chain_blocked_missing_required_availability"))}\n`),
      ]);

      const { output } = await runR1137OrdinaryConsumerPartialRoutePlanner({
        outputDir: path.join(tmp, "out"),
        r1133Path,
        r1136Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_partial_route_planner_partial_routes_available_runner_extension_needed",
        fullSupportedRouteReady: false,
        nextAction: "extend_r1125_r1124_for_partial_lab_wearable_routes_or_collect_missing_full_route",
        partialRouteIdsReadyButUnsupported: ["lab_glycemia_minimum_route"],
        productDisplayAuthorized: false,
        readyForPrivateConfigMapping: false,
        reviewGptRequiredNow: false,
      });
      expect(output.partialRoutePlanner.blockers).toEqual([
        "current_r1125_r1124_gate_requires_full_l1_l2_w1_qc_metrics",
      ]);
      expect(output.partialRoutePlanner.routeStatuses).toContainEqual(expect.objectContaining({
        currentRunnerSupportStatus: "partial_route_runner_extension_required",
        routeAvailabilityStatus: "available_but_runner_extension_required",
        routeId: "lab_glycemia_minimum_route",
      }));
      expect(output.partialRoutePlanner.routeStatuses).toContainEqual(expect.objectContaining({
        missingSourceFamilyIds: ["wearable_activity_daily"],
        routeAvailabilityStatus: "blocked_missing_inputs",
        routeId: "wearable_activity_minimum_route",
      }));
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("marks the full labs plus wearable route ready for private config mapping", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1137-full-"));
    try {
      const r1133Path = path.join(tmp, "r1133.json");
      const r1136Path = path.join(tmp, "r1136.json");
      await Promise.all([
        writeFile(r1133Path, `${JSON.stringify(r1133AvailabilityFixture(ORDINARY_SOURCE_FAMILY_IDS, "provided"))}\n`),
        writeFile(r1136Path, `${JSON.stringify(r1136Fixture("ordinary_availability_chain_ready_for_private_config_mapping"))}\n`),
      ]);

      const { output } = await runR1137OrdinaryConsumerPartialRoutePlanner({
        outputDir: path.join(tmp, "out"),
        r1133Path,
        r1136Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_partial_route_planner_full_route_ready_for_private_config_mapping",
        fullSupportedRouteReady: true,
        nextAction: "fill_private_config_mapping_for_full_labs_wearable_route",
        productDisplayAuthorized: false,
        readyForPrivateConfigMapping: true,
      });
      expect(output.partialRoutePlanner.blockers).toEqual(["private_config_not_ready_for_r1125"]);
      expect(output.partialRoutePlanner.routeStatuses).toContainEqual(expect.objectContaining({
        currentRunnerSupportStatus: "supported_by_current_first_pass_runner",
        routeAvailabilityStatus: "ready_for_current_runner",
        routeId: "full_labs_wearable_first_pass_route",
      }));
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1137-cli-"));
    try {
      const r1133Path = path.join(tmp, "r1133.json");
      const r1136Path = path.join(tmp, "r1136.json");
      await Promise.all([
        mkdir(path.join(tmp, "out")),
        writeFile(r1133Path, `${JSON.stringify(r1133AvailabilityFixture([
          "outcome_linkage",
          "join_time_alignment",
          "wearable_activity_daily",
        ], "provided"))}\n`),
        writeFile(r1136Path, `${JSON.stringify(r1136Fixture("ordinary_availability_chain_blocked_missing_required_availability"))}\n`),
      ]);

      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1137-ordinary-consumer-partial-route-planner.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1133_ORDINARY_CONSUMER_DATA_AVAILABILITY_PREFLIGHT_PATH: r1133Path,
          MURPH_AGE_R1136_ORDINARY_CONSUMER_AVAILABILITY_CHAIN_RUNNER_PATH: r1136Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        nextAction: string;
        partialRouteIdsReadyButUnsupported: string[];
        productDisplayAuthorized: boolean;
      };
      expect(summary).toMatchObject({
        conclusion: "ordinary_partial_route_planner_partial_routes_available_runner_extension_needed",
        nextAction: "extend_r1125_r1124_for_partial_lab_wearable_routes_or_collect_missing_full_route",
        partialRouteIdsReadyButUnsupported: ["wearable_activity_minimum_route"],
        productDisplayAuthorized: false,
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("localPaths");
      expect(stdout).not.toContain("rowValues");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

function r1133AvailabilityFixture(
  availableSourceFamilyIds: readonly string[],
  manifestStatus = "not_provided",
): Record<string, unknown> {
  const available = new Set(availableSourceFamilyIds);
  const missingSourceFamilyIds = ORDINARY_SOURCE_FAMILY_IDS.filter((familyId) => !available.has(familyId));
  return {
    artifactBoundary: safeBoundary("R1133"),
    ordinaryDataAvailabilityPreflight: {
      acceptedTableLayouts: ["single_primary_table_fallback", "multi_table_or_explicit_refs"],
      aggregateReadinessFacts: {
        eventCountBand: manifestStatus === "provided" ? "10_plus" : "unknown",
        meetsMinimumEventCount: manifestStatus === "provided",
        meetsMinimumUsableRecordCount: manifestStatus === "provided",
        outcomeLinked: available.has("outcome_linkage"),
        sameDenominator: available.has("join_time_alignment"),
        targetAgeBand: "roughly_16_50",
        usableRecordCountBand: manifestStatus === "provided" ? "50_plus" : "unknown",
      },
      blockers: manifestStatus === "provided"
        ? missingSourceFamilyIds.map((familyId) => `source_family_not_available:${familyId}`)
        : ["ordinary_data_availability_manifest_missing"],
      commands: {
        availabilityPreflightCommand:
          "MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH=<availability-manifest.json> pnpm exec tsx scripts/murph-age/r1133-ordinary-consumer-data-availability-preflight.ts",
      },
      manifestStatus,
      missingSourceFamilyIds,
      readyForPrivateConfigMapping: missingSourceFamilyIds.length === 0 && manifestStatus === "provided",
      selectedTableLayout: manifestStatus === "provided" ? "single_primary_table_fallback" : null,
      sourceFamilies: ORDINARY_SOURCE_FAMILY_IDS.map((familyId) => ({
        declaredAvailable: manifestStatus === "provided" ? available.has(familyId) : null,
        familyId,
        inputKind: inputKindFor(familyId),
        privateDetailsStored: false,
        requiredForFirstPass: true,
        status: manifestStatus === "provided" && available.has(familyId) ? "declared_available" : "not_declared",
      })),
    },
    packetId: "r1133-ordinary-consumer-data-availability-preflight",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1133-ordinary-consumer-data-availability-preflight.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: manifestStatus === "provided"
        ? "ordinary_data_availability_preflight_missing_required_availability"
        : "ordinary_data_availability_preflight_waiting_on_manifest",
      manifestStatus,
      missingSourceFamilyIds,
      nextAction: manifestStatus === "provided"
        ? "collect_missing_outcome_linked_labs_wearable_sources"
        : "fill_safe_ordinary_data_availability_manifest",
      productDisplayAuthorized: false,
      readyForPrivateConfigMapping: missingSourceFamilyIds.length === 0 && manifestStatus === "provided",
      readyForPrivateRunner: false,
      realAggregateStillMissing: true,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1133: false,
    },
  };
}

function r1136Fixture(conclusion: string): Record<string, unknown> {
  return {
    artifactBoundary: {
      ...safeBoundary("R1136"),
      availabilityManifestPathStored: false,
    },
    availabilityChain: {
      commands: {
        availabilityChainRunnerCommand:
          "MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH=<availability-manifest.json> pnpm exec tsx scripts/murph-age/r1136-ordinary-consumer-availability-chain-runner.ts",
      },
      privateDetailsStored: false,
    },
    packetId: "r1136-ordinary-consumer-availability-chain-runner",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1136-ordinary-consumer-availability-chain-runner.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      productDisplayAuthorized: false,
      readyForPrivateConfigMapping: conclusion === "ordinary_availability_chain_ready_for_private_config_mapping",
      readyForPrivateRunner: false,
      realAggregateStillMissing: true,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1136: false,
    },
  };
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

function safeBoundary(stage: "R1133" | "R1136") {
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
