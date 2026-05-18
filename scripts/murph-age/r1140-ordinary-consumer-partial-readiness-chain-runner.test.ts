import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1140_ORDINARY_CONSUMER_PARTIAL_READINESS_CHAIN_RUNNER_SCHEMA_VERSION,
  runR1140OrdinaryConsumerPartialReadinessChainRunner,
} from "./r1140-ordinary-consumer-partial-readiness-chain-runner.ts";

const AVAILABILITY_MANIFEST_SCHEMA_VERSION =
  "murph-age-r1133-ordinary-consumer-data-availability-manifest.v1";
const PARTIAL_AGGREGATE_METRICS_SCHEMA_VERSION =
  "murph-age-ordinary-consumer-partial-aggregate-metrics.v1";
const ORDINARY_SOURCE_FAMILY_IDS = [
  "join_time_alignment",
  "outcome_linkage",
  "bloodwork_glycemia",
  "common_bloodwork_core",
  "vitals_body_context",
  "wearable_activity_daily",
];

describe("R1140 ordinary consumer partial readiness chain runner", () => {
  it("waits on the safe manifest while running the full partial-readiness chain", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1140-waiting-"));
    try {
      const r1132Path = path.join(tmp, "r1132.json");
      await writeFile(r1132Path, `${JSON.stringify(r1132Fixture())}\n`);

      const { output, outputPath } = await runR1140OrdinaryConsumerPartialReadinessChainRunner({
        availabilityManifestPath: "",
        createdAt: "2026-05-16T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        r1132Path,
      });

      expect(path.basename(outputPath)).toBe("r1140-ordinary-consumer-partial-readiness-chain-runner.latest.json");
      expect(output.schemaVersion).toBe(R1140_ORDINARY_CONSUMER_PARTIAL_READINESS_CHAIN_RUNNER_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "ordinary_partial_readiness_chain_waiting_on_safe_manifest",
        eligiblePartialRouteIds: [],
        fullEvidenceGateCleared: false,
        manifestSuppliedToRunner: false,
        missingSourceFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
        nextAction: "fill_safe_availability_manifest_then_run_r1140_partial_chain",
        partialAggregateMetricsSuppliedToRunner: false,
        partialPrivateConfigTemplateArtifact: "r1139-fillable-ordinary-consumer-partial-private-config.json",
        productDisplayAuthorized: false,
        realAggregateStillMissing: true,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1140: false,
      });
      expect(output.partialReadinessChain.stageResults.map((stage) => stage.stageId)).toEqual([
        "r1136_availability_chain",
        "r1137_partial_route_planner",
        "r1138_partial_aggregate_metric_intake",
        "r1139_partial_private_config_handoff",
      ]);
      expect(output.partialReadinessChain.stageResults.at(-1)).toMatchObject({
        artifact: "r1139-ordinary-consumer-partial-private-config-handoff.latest.json",
        conclusion: "ordinary_partial_private_config_handoff_waiting_on_route_plan",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes a partial lab and wearable manifest to the route-specific private mapping handoff", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1140-partial-"));
    try {
      const r1132Path = path.join(tmp, "r1132.json");
      const manifestPath = path.join(tmp, "availability.json");
      await Promise.all([
        writeFile(r1132Path, `${JSON.stringify(r1132Fixture())}\n`),
        writeFile(manifestPath, `${JSON.stringify(partialLabWearableAvailabilityManifest())}\n`),
      ]);

      const { output } = await runR1140OrdinaryConsumerPartialReadinessChainRunner({
        availabilityManifestPath: manifestPath,
        outputDir: path.join(tmp, "out"),
        r1132Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_partial_readiness_chain_ready_for_partial_private_mapping",
        eligiblePartialRouteIds: [
          "lab_glycemia_minimum_route",
          "wearable_activity_minimum_route",
        ],
        manifestSuppliedToRunner: true,
        missingSourceFamilyIds: ["common_bloodwork_core", "vitals_body_context"],
        nextAction: "fill_partial_private_config_for_ready_routes_then_run_r1141_partial_private_metric_runner",
        partialAggregateMetricsSuppliedToRunner: false,
        readyPartialMetricRouteIds: [],
      });
      expect(output.summary.requiredPrivateFieldRefFamilies).toEqual([
        "personJoinKey",
        "dateOrTimeKey",
        "outcomeEvent",
        "labGlycemia",
        "wearableActivity",
      ]);
      expect(output.summary.requiredPrivateTableRefs).toEqual([
        "primaryTableRef",
        "outcomeTableRef",
        "labTableRef",
        "wearableTableRef",
      ]);
      expect(output.partialReadinessChain.stageResults.map((stage) => stage.conclusion)).toEqual([
        "ordinary_availability_chain_blocked_missing_required_availability",
        "ordinary_partial_route_planner_partial_routes_available_runner_extension_needed",
        "ordinary_partial_aggregate_metrics_missing",
        "ordinary_partial_private_config_handoff_ready_for_partial_private_mapping",
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("records supplied partial metrics as research-only without clearing the full evidence gate", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1140-metrics-"));
    try {
      const r1132Path = path.join(tmp, "r1132.json");
      const manifestPath = path.join(tmp, "availability.json");
      const partialMetricsPath = path.join(tmp, "partial-metrics.json");
      await Promise.all([
        writeFile(r1132Path, `${JSON.stringify(r1132Fixture())}\n`),
        writeFile(manifestPath, `${JSON.stringify(partialLabWearableAvailabilityManifest())}\n`),
        writeFile(partialMetricsPath, `${JSON.stringify(partialMetricsFixture())}\n`),
      ]);

      const { output } = await runR1140OrdinaryConsumerPartialReadinessChainRunner({
        availabilityManifestPath: manifestPath,
        outputDir: path.join(tmp, "out"),
        partialAggregateMetricsPath: partialMetricsPath,
        r1132Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_partial_readiness_chain_partial_metrics_recorded_research_only",
        fullEvidenceGateCleared: false,
        nextAction: "use_partial_metrics_for_research_only_collect_full_l1_l2_w1_qc_evidence",
        partialAggregateMetricsSuppliedToRunner: true,
        productDisplayAuthorized: false,
        readyPartialMetricRouteIds: ["wearable_activity_minimum_route"],
        realAggregateStillMissing: true,
        reviewGptRequiredNow: false,
      });
      expect(output.partialReadinessChain.stageResults.at(-1)).toMatchObject({
        conclusion: "ordinary_partial_private_config_handoff_partial_metrics_recorded_research_only",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1140-cli-"));
    try {
      const r1132Path = path.join(tmp, "r1132.json");
      const manifestPath = path.join(tmp, "availability.json");
      await Promise.all([
        mkdir(path.join(tmp, "out")),
        writeFile(r1132Path, `${JSON.stringify(r1132Fixture())}\n`),
        writeFile(manifestPath, `${JSON.stringify(partialLabWearableAvailabilityManifest())}\n`),
      ]);

      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1140-ordinary-consumer-partial-readiness-chain-runner.ts"),
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
        eligiblePartialRouteIds: string[];
        manifestSuppliedToRunner: boolean;
        productDisplayAuthorized: boolean;
        reviewGptRequiredNow: boolean;
      };
      expect(summary).toMatchObject({
        conclusion: "ordinary_partial_readiness_chain_ready_for_partial_private_mapping",
        eligiblePartialRouteIds: [
          "lab_glycemia_minimum_route",
          "wearable_activity_minimum_route",
        ],
        manifestSuppliedToRunner: true,
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("localPaths");
      expect(stdout).not.toContain("rowValues");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

function partialLabWearableAvailabilityManifest(): Record<string, unknown> {
  const available = new Set([
    "join_time_alignment",
    "outcome_linkage",
    "bloodwork_glycemia",
    "wearable_activity_daily",
  ]);
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
      available: available.has(familyId),
      familyId,
    })),
  };
}

function partialMetricsFixture(): Record<string, unknown> {
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
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
    },
    evaluatorId: "ordinary_consumer_partial_route_aggregate_evaluator_v1",
    packetId: "partial-aggregate-metrics-fixture",
    receiptAttestations: {
      aggregateOnly: true,
      endpointFrozenBeforeScoring: true,
      evaluatorFrozenBeforeExecution: true,
      noCoefficientEgress: true,
      noParticipantEgress: true,
      noPredictionEgress: true,
      noRowEgress: true,
      noSmallCellEgress: true,
      sameDenominatorComparisons: true,
    },
    routeResults: [
      {
        candidateResults: [
          {
            aucDelta: 0.01,
            brierDelta: -0.002,
            calibrationStatus: "directional_only",
            candidateId: "W1_activity_steps_minutes",
            candidateKind: "wearable",
            comparatorId: "frozen_recalibrated_r399",
            coverageStatus: "usable",
            evidenceSupport: "underpowered",
            logLossDelta: -0.003,
            missingnessOrCoverageControlStatus: "directional_only",
          },
        ],
        routeId: "wearable_activity_minimum_route",
      },
    ],
    schemaVersion: PARTIAL_AGGREGATE_METRICS_SCHEMA_VERSION,
    submissionContext: {
      evidenceRole: "real_partial_route_evidence",
      ordinaryConsumerSubmission: true,
      outcomeLinked: true,
      partialEvidenceOnly: true,
      targetAgeBand: "roughly_16_50",
    },
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
      readyForPrivateRunner: false,
      sourceFamilies: [
        sourceFamily("join_time_alignment", "stable_join_key_and_date_fields"),
        sourceFamily("outcome_linkage", "outcome_or_followup_table"),
        sourceFamily("bloodwork_glycemia", "bloodwork_table_or_lab_portal_export"),
        sourceFamily("common_bloodwork_core", "bloodwork_table_or_lab_portal_export"),
        sourceFamily("vitals_body_context", "body_or_vitals_table"),
        sourceFamily("wearable_activity_daily", "daily_wearable_activity_export_or_spreadsheet"),
      ],
    },
    packetId: "r1132-ordinary-consumer-submission-readiness",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1132-ordinary-consumer-submission-readiness.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "ordinary_consumer_submission_readiness_ready_for_row_owner_mapping",
      nextAction: "fill_average_submitter_private_config_slots",
      productDisplayAuthorized: false,
      readyForPrivateRunner: false,
      realAggregateStillMissing: true,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1132: false,
    },
  };
}

function sourceFamily(familyId: string, inputKind: string): Record<string, unknown> {
  return {
    familyId,
    inputKind,
    missingSlotCount: 1,
    missingSlotIds: [],
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
    privateConfigValuesStored: false,
    privateFieldRefsStored: false,
    privateTableRefsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    [`rowParsingPerformedBy${stage}`]: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}
