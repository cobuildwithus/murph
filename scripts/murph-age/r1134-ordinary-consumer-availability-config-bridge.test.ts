import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1134_ORDINARY_CONSUMER_AVAILABILITY_CONFIG_BRIDGE_SCHEMA_VERSION,
  runR1134OrdinaryConsumerAvailabilityConfigBridge,
} from "./r1134-ordinary-consumer-availability-config-bridge.ts";

const ORDINARY_SOURCE_FAMILY_IDS = [
  "join_time_alignment",
  "outcome_linkage",
  "bloodwork_glycemia",
  "common_bloodwork_core",
  "vitals_body_context",
  "wearable_activity_daily",
];

describe("R1134 ordinary consumer availability config bridge", () => {
  it("waits on the safe availability manifest before private config mapping", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1134-waiting-"));
    try {
      const r1132Path = path.join(tmp, "r1132.json");
      const r1133Path = path.join(tmp, "r1133.json");
      await Promise.all([
        writeFile(r1132Path, `${JSON.stringify(r1132Fixture())}\n`),
        writeFile(r1133Path, `${JSON.stringify(r1133WaitingManifestFixture())}\n`),
      ]);

      const { output, outputPath } = await runR1134OrdinaryConsumerAvailabilityConfigBridge({
        createdAt: "2026-05-16T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        r1132Path,
        r1133Path,
      });

      expect(path.basename(outputPath)).toBe("r1134-ordinary-consumer-availability-config-bridge.latest.json");
      expect(output.schemaVersion).toBe(R1134_ORDINARY_CONSUMER_AVAILABILITY_CONFIG_BRIDGE_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "ordinary_availability_config_bridge_waiting_on_availability_manifest",
        mappingPlanStatus: "waiting_on_availability_manifest",
        missingSourceFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
        nextAction: "fill_safe_ordinary_data_availability_manifest",
        productDisplayAuthorized: false,
        readyForPrivateConfigMapping: false,
        readyForPrivateRunner: false,
        realAggregateStillMissing: true,
        rowParsingPerformedByR1134: false,
      });
      expect(output.availabilityConfigBridge.blockers).toContain("ordinary_data_availability_manifest_missing");
      expect(output.availabilityConfigBridge.mappingPlan.sourceFamilyMappings).toContainEqual({
        availabilityStatus: "not_declared",
        familyId: "wearable_activity_daily",
        inputKind: "daily_wearable_activity_export_or_spreadsheet",
        mappingStatus: "missing_or_not_declared",
        privateDetailsStored: false,
        requiredForCandidateIds: ["W1_activity_steps_minutes"],
        requiredPrivateFieldRefFamilies: ["wearableActivity"],
        requiredPrivateTableRefs: ["wearableTableRef"],
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("turns complete availability into a safe private config mapping plan", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1134-ready-mapping-"));
    try {
      const r1132Path = path.join(tmp, "r1132.json");
      const r1133Path = path.join(tmp, "r1133.json");
      await Promise.all([
        writeFile(r1132Path, `${JSON.stringify(r1132Fixture())}\n`),
        writeFile(r1133Path, `${JSON.stringify(r1133ReadyMappingFixture())}\n`),
      ]);

      const { output } = await runR1134OrdinaryConsumerAvailabilityConfigBridge({
        outputDir: path.join(tmp, "out"),
        r1132Path,
        r1133Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_availability_config_bridge_ready_for_private_config_mapping",
        mappingPlanStatus: "ready_for_private_config_mapping",
        missingSourceFamilyIds: [],
        nextAction: "fill_private_config_mapping_for_available_ordinary_sources",
        readyForPrivateConfigMapping: true,
        readyForPrivateRunner: false,
        selectedTableLayout: "single_primary_table_fallback",
      });
      expect(output.availabilityConfigBridge.availableSourceFamilyIds).toEqual(ORDINARY_SOURCE_FAMILY_IDS);
      expect(output.availabilityConfigBridge.blockers).toEqual(["private_config_not_ready_for_r1125"]);
      expect(output.availabilityConfigBridge.mappingPlan).toMatchObject({
        acceptedTableLayouts: ["single_primary_table_fallback", "multi_table_or_explicit_refs"],
        candidateRunOrderIds: [
          "L1_tiny_glycemia_only",
          "L2_common_lab_core_shadow",
          "W1_activity_steps_minutes",
          "QC_missingness_coverage",
        ],
        selectedTableLayout: "single_primary_table_fallback",
        status: "ready_for_private_config_mapping",
      });
      expect(output.availabilityConfigBridge.mappingPlan.sourceFamilyMappings).toContainEqual({
        availabilityStatus: "declared_available",
        familyId: "bloodwork_glycemia",
        inputKind: "bloodwork_table_or_lab_portal_export",
        mappingStatus: "available_needs_private_mapping",
        privateDetailsStored: false,
        requiredForCandidateIds: [
          "L1_tiny_glycemia_only",
          "L2_common_lab_core_shadow",
        ],
        requiredPrivateFieldRefFamilies: ["labGlycemia"],
        requiredPrivateTableRefs: ["labTableRef"],
      });
      expect(output.availabilityConfigBridge.mappingPlan.submissionContextChecklist).toContainEqual({
        fieldId: "outcomeLinked",
        requiredStatus: "complete_in_private_config",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes directly to the private runner when availability and private config readiness are complete", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1134-ready-runner-"));
    try {
      const r1132Path = path.join(tmp, "r1132.json");
      const r1133Path = path.join(tmp, "r1133.json");
      await Promise.all([
        writeFile(r1132Path, `${JSON.stringify(r1132Fixture({ readyForPrivateRunner: true }))}\n`),
        writeFile(r1133Path, `${JSON.stringify(r1133ReadyMappingFixture({ readyForPrivateRunner: true }))}\n`),
      ]);

      const { output } = await runR1134OrdinaryConsumerAvailabilityConfigBridge({
        outputDir: path.join(tmp, "out"),
        r1132Path,
        r1133Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_availability_config_bridge_ready_for_private_runner",
        mappingPlanStatus: "ready_for_private_runner",
        nextAction: "run_r1125_private_runner_then_r1124_real_metric_intake",
        readyForPrivateConfigMapping: true,
        readyForPrivateRunner: true,
        realAggregateStillMissing: false,
      });
      expect(output.availabilityConfigBridge.blockers).toEqual([]);
      expect(output.availabilityConfigBridge.mappingPlan.sourceFamilyMappings[0]?.mappingStatus).toBe(
        "available_mapped_or_ready",
      );
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1134-cli-"));
    try {
      const r1132Path = path.join(tmp, "r1132.json");
      const r1133Path = path.join(tmp, "r1133.json");
      await Promise.all([
        mkdir(path.join(tmp, "out")),
        writeFile(r1132Path, `${JSON.stringify(r1132Fixture())}\n`),
        writeFile(r1133Path, `${JSON.stringify(r1133ReadyMappingFixture())}\n`),
      ]);

      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1134-ordinary-consumer-availability-config-bridge.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1132_ORDINARY_CONSUMER_SUBMISSION_READINESS_PATH: r1132Path,
          MURPH_AGE_R1133_ORDINARY_CONSUMER_DATA_AVAILABILITY_PREFLIGHT_PATH: r1133Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        nextAction: string;
        productDisplayAuthorized: boolean;
        sourceFamilyMappings: Array<{ familyId: string; mappingStatus: string }>;
      };
      expect(summary).toMatchObject({
        conclusion: "ordinary_availability_config_bridge_ready_for_private_config_mapping",
        nextAction: "fill_private_config_mapping_for_available_ordinary_sources",
        productDisplayAuthorized: false,
      });
      expect(summary.sourceFamilyMappings).toContainEqual({
        familyId: "wearable_activity_daily",
        mappingStatus: "available_needs_private_mapping",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("localPaths");
      expect(stdout).not.toContain("rowValues");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

function r1132Fixture(input: { readyForPrivateRunner?: boolean } = {}): Record<string, unknown> {
  const readyForPrivateRunner = input.readyForPrivateRunner === true;
  return {
    artifactBoundary: safeBoundary("R1132"),
    ordinaryConsumerReadiness: {
      commands: {
        configIntakeCommand:
          "MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH=<private-config.json> pnpm exec tsx scripts/murph-age/r1122-local-private-consumer-receipt-runner-config-intake.ts",
        metricIntakeCommand:
          "MURPH_AGE_CONSUMER_FIRST_PASS_AGGREGATE_METRICS_PATH=<aggregate-metrics.json> pnpm exec tsx scripts/murph-age/r1124-consumer-first-pass-aggregate-metric-intake.ts",
        privateRunnerCommand:
          "MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH=<private-config.json> pnpm exec tsx scripts/murph-age/r1125-local-private-first-pass-aggregate-metric-runner.ts",
      },
      minimalSubmissionBundle: {
        acceptedTableLayouts: ["single_primary_table_fallback", "multi_table_or_explicit_refs"],
        firstPassCandidateIds: [
          "L1_tiny_glycemia_only",
          "L2_common_lab_core_shadow",
          "W1_activity_steps_minutes",
          "QC_missingness_coverage",
        ],
      },
      readyForPrivateRunner,
      sourceFamilies: [
        sourceFamily("join_time_alignment", "stable_join_key_and_date_fields", [], ["personJoinKey", "dateOrTimeKey"], [
          "primaryTableRef",
        ]),
        sourceFamily("outcome_linkage", "outcome_or_followup_table", [], ["outcomeEvent"], ["outcomeTableRef"]),
        sourceFamily("bloodwork_glycemia", "bloodwork_table_or_lab_portal_export", [
          "L1_tiny_glycemia_only",
          "L2_common_lab_core_shadow",
        ], ["labGlycemia"], ["labTableRef"]),
        sourceFamily("common_bloodwork_core", "bloodwork_table_or_lab_portal_export", [
          "L2_common_lab_core_shadow",
        ], ["commonLabCore"], ["labTableRef"]),
        sourceFamily("vitals_body_context", "body_or_vitals_table", [
          "L2_common_lab_core_shadow",
        ], ["vitalsBody"], ["primaryTableRef"]),
        sourceFamily("wearable_activity_daily", "daily_wearable_activity_export_or_spreadsheet", [
          "W1_activity_steps_minutes",
        ], ["wearableActivity"], ["wearableTableRef"]),
      ],
    },
    packetId: "r1132-ordinary-consumer-submission-readiness",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1132-ordinary-consumer-submission-readiness.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: readyForPrivateRunner
        ? "ordinary_consumer_submission_readiness_ready_for_private_runner"
        : "ordinary_consumer_submission_readiness_ready_for_row_owner_mapping",
      productDisplayAuthorized: false,
      readyForPrivateRunner,
      rowParsingPerformedByR1132: false,
    },
  };
}

function r1133WaitingManifestFixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1133"),
    ordinaryDataAvailabilityPreflight: {
      blockers: [
        "ordinary_data_availability_manifest_missing",
        ...ORDINARY_SOURCE_FAMILY_IDS.map((familyId) => `source_family_not_available:${familyId}`),
      ],
      manifestStatus: "not_provided",
      missingSourceFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
      readyForPrivateConfigMapping: false,
      readyForPrivateRunner: false,
      sourceFamilies: ORDINARY_SOURCE_FAMILY_IDS.map((familyId) => ({
        familyId,
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
      rowParsingPerformedByR1133: false,
    },
  };
}

function r1133ReadyMappingFixture(input: { readyForPrivateRunner?: boolean } = {}): Record<string, unknown> {
  const readyForPrivateRunner = input.readyForPrivateRunner === true;
  return {
    artifactBoundary: safeBoundary("R1133"),
    ordinaryDataAvailabilityPreflight: {
      acceptedTableLayouts: ["single_primary_table_fallback", "multi_table_or_explicit_refs"],
      blockers: readyForPrivateRunner ? [] : ["private_config_not_ready_for_r1125"],
      commands: {
        availabilityPreflightCommand:
          "MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH=<availability-manifest.json> pnpm exec tsx scripts/murph-age/r1133-ordinary-consumer-data-availability-preflight.ts",
      },
      manifestStatus: "provided",
      missingSourceFamilyIds: [],
      readyForPrivateConfigMapping: true,
      readyForPrivateRunner,
      selectedTableLayout: "single_primary_table_fallback",
      sourceFamilies: ORDINARY_SOURCE_FAMILY_IDS.map((familyId) => ({
        familyId,
        status: "declared_available",
      })),
    },
    packetId: "r1133-ordinary-consumer-data-availability-preflight",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1133-ordinary-consumer-data-availability-preflight.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: readyForPrivateRunner
        ? "ordinary_data_availability_preflight_ready_for_private_runner"
        : "ordinary_data_availability_preflight_ready_for_private_config_mapping",
      manifestStatus: "provided",
      missingSourceFamilyIds: [],
      nextAction: readyForPrivateRunner
        ? "run_r1125_private_runner_then_r1124_real_metric_intake"
        : "complete_private_config_for_available_labs_wearables",
      productDisplayAuthorized: false,
      readyForPrivateConfigMapping: true,
      readyForPrivateRunner,
      rowParsingPerformedByR1133: false,
    },
  };
}

function sourceFamily(
  familyId: string,
  inputKind: string,
  requiredForCandidateIds: string[],
  requiredPrivateFieldRefFamilies: string[],
  requiredPrivateTableRefs: string[],
): Record<string, unknown> {
  return {
    acceptableForAverageUser: true,
    familyId,
    inputKind,
    privateDetailsStored: false,
    requiredForCandidateIds,
    requiredForFirstPass: true,
    requiredPrivateFieldRefFamilies,
    requiredPrivateTableRefs,
    status: "needs_private_config",
  };
}

function safeBoundary(stage: "R1132" | "R1133"): Record<string, unknown> {
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
    privateConfigValuesStored: false,
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
