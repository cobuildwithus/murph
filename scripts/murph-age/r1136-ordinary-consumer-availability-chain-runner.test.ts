import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1136_ORDINARY_CONSUMER_AVAILABILITY_CHAIN_RUNNER_SCHEMA_VERSION,
  runR1136OrdinaryConsumerAvailabilityChainRunner,
} from "./r1136-ordinary-consumer-availability-chain-runner.ts";

const AVAILABILITY_MANIFEST_SCHEMA_VERSION =
  "murph-age-r1133-ordinary-consumer-data-availability-manifest.v1";
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

describe("R1136 ordinary consumer availability chain runner", () => {
  it("waits on the safe manifest while preserving a one-command chain handoff", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1136-waiting-"));
    try {
      const r1132Path = path.join(tmp, "r1132.json");
      await writeFile(r1132Path, `${JSON.stringify(r1132Fixture())}\n`);

      const { output, outputPath } = await runR1136OrdinaryConsumerAvailabilityChainRunner({
        availabilityManifestPath: "",
        createdAt: "2026-05-16T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        r1132Path,
      });

      expect(path.basename(outputPath)).toBe("r1136-ordinary-consumer-availability-chain-runner.latest.json");
      expect(output.schemaVersion).toBe(R1136_ORDINARY_CONSUMER_AVAILABILITY_CHAIN_RUNNER_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "ordinary_availability_chain_waiting_on_safe_manifest",
        manifestSuppliedToRunner: false,
        missingSourceFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
        nextAction: "fill_safe_availability_manifest_then_run_r1136_chain",
        primarySubmitterInputFamilyIds: PRIMARY_SUBMITTER_INPUT_FAMILY_IDS,
        productDisplayAuthorized: false,
        readyForPrivateConfigMapping: false,
        readyForPrivateRunner: false,
        realAggregateStillMissing: true,
        requiredLinkageFamilyIds: ["outcome_linkage", "join_time_alignment"],
        rowParsingPerformedByR1136: false,
      });
      expect(output.availabilityChain.blockers).toContain("ordinary_data_availability_manifest_missing");
      expect(output.availabilityChain.commands.availabilityChainRunnerCommand).toContain(
        "r1136-ordinary-consumer-availability-chain-runner.ts",
      );
      expect(output.availabilityChain.stageResults).toEqual([
        expect.objectContaining({
          artifact: "r1133-ordinary-consumer-data-availability-preflight.latest.json",
          conclusion: "ordinary_data_availability_preflight_waiting_on_manifest",
        }),
        expect.objectContaining({
          artifact: "r1134-ordinary-consumer-availability-config-bridge.latest.json",
          conclusion: "ordinary_availability_config_bridge_waiting_on_availability_manifest",
        }),
        expect.objectContaining({
          artifact: "r1135-ordinary-consumer-availability-manifest-packet.latest.json",
          conclusion: "ordinary_availability_manifest_packet_waiting_on_row_owner_manifest",
        }),
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("runs a complete safe manifest through R1133, R1134, and R1135", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1136-ready-"));
    try {
      const r1132Path = path.join(tmp, "r1132.json");
      const manifestPath = path.join(tmp, "availability.json");
      await Promise.all([
        writeFile(r1132Path, `${JSON.stringify(r1132Fixture())}\n`),
        writeFile(manifestPath, `${JSON.stringify(completeAvailabilityManifest())}\n`),
      ]);

      const { output } = await runR1136OrdinaryConsumerAvailabilityChainRunner({
        availabilityManifestPath: manifestPath,
        outputDir: path.join(tmp, "out"),
        r1132Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_availability_chain_ready_for_private_config_mapping",
        manifestSuppliedToRunner: true,
        missingSourceFamilyIds: [],
        nextAction: "fill_private_config_mapping_for_available_wearables_labs",
        readyForPrivateConfigMapping: true,
        readyForPrivateRunner: false,
      });
      expect(output.availabilityChain.blockers).toEqual(["private_config_not_ready_for_r1125"]);
      expect(output.availabilityChain.stageResults.map((stage) => stage.conclusion)).toEqual([
        "ordinary_data_availability_preflight_ready_for_private_config_mapping",
        "ordinary_availability_config_bridge_ready_for_private_config_mapping",
        "ordinary_availability_manifest_packet_ready_for_private_config_mapping",
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1136-cli-"));
    try {
      const r1132Path = path.join(tmp, "r1132.json");
      const manifestPath = path.join(tmp, "availability.json");
      await Promise.all([
        mkdir(path.join(tmp, "out")),
        writeFile(r1132Path, `${JSON.stringify(r1132Fixture())}\n`),
        writeFile(manifestPath, `${JSON.stringify(completeAvailabilityManifest())}\n`),
      ]);

      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1136-ordinary-consumer-availability-chain-runner.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH: manifestPath,
          MURPH_AGE_R1132_ORDINARY_CONSUMER_SUBMISSION_READINESS_PATH: r1132Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        manifestSuppliedToRunner: boolean;
        nextAction: string;
        primarySubmitterInputFamilyIds: string[];
        productDisplayAuthorized: boolean;
      };
      expect(summary).toMatchObject({
        conclusion: "ordinary_availability_chain_ready_for_private_config_mapping",
        manifestSuppliedToRunner: true,
        nextAction: "fill_private_config_mapping_for_available_wearables_labs",
        primarySubmitterInputFamilyIds: PRIMARY_SUBMITTER_INPUT_FAMILY_IDS,
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

function completeAvailabilityManifest(): Record<string, unknown> {
  return {
    aggregateReadinessFacts: {
      eventCountBand: "10_plus",
      outcomeLinked: true,
      sameDenominator: true,
      targetAgeBand: "roughly_16_50",
      usableRecordCountBand: "50_plus",
    },
    attestations: {
      aggregateOnly: true,
      noCoefficientEgress: true,
      noHeaderNameEgress: true,
      noParticipantEgress: true,
      noPredictionEgress: true,
      noRowEgress: true,
      noSmallCellEgress: true,
      noSourceTextEgress: true,
    },
    schemaVersion: AVAILABILITY_MANIFEST_SCHEMA_VERSION,
    selectedTableLayout: "single_primary_table_fallback",
    sourceFamilies: ORDINARY_SOURCE_FAMILY_IDS.map((familyId) => ({
      available: true,
      familyId,
    })),
  };
}

function r1132Fixture(): Record<string, unknown> {
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
      readyForPrivateRunner: false,
      sourceFamilies: [
        sourceFamily("join_time_alignment", "stable_join_key_and_date_fields", [], ["personJoinKey", "dateOrTimeKey"], [
          "primaryTableRef",
          "outcomeTableRef",
          "labTableRef",
          "wearableTableRef",
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
        ], ["vitalsBody"], ["primaryTableRef", "labTableRef"]),
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
      conclusion: "ordinary_consumer_submission_readiness_ready_for_row_owner_mapping",
      productDisplayAuthorized: false,
      readyForPrivateRunner: false,
      realAggregateStillMissing: true,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1132: false,
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
  const missingSlotIds = [
    ...requiredForCandidateIds,
    ...requiredPrivateFieldRefFamilies,
    ...requiredPrivateTableRefs,
  ];
  return {
    familyId,
    inputKind,
    missingSlotCount: missingSlotIds.length,
    missingSlotIds,
    requiredForCandidateIds,
    requiredPrivateFieldRefFamilies,
    requiredPrivateTableRefs,
    status: "needs_private_config",
  };
}

function safeBoundary(stage: "R1132") {
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
