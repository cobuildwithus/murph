import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { runR1135OrdinaryConsumerAvailabilityManifestPacket } from "./r1135-ordinary-consumer-availability-manifest-packet.ts";
import {
  R1142_ORDINARY_CONSUMER_PARTIAL_PRIVATE_CHAIN_RUNNER_SCHEMA_VERSION,
  runR1142OrdinaryConsumerPartialPrivateChainRunner,
} from "./r1142-ordinary-consumer-partial-private-chain-runner.ts";

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

describe("R1142 ordinary consumer partial private chain runner", () => {
  it("waits on the safe availability manifest without exposing paths", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1142-waiting-"));
    try {
      const r1132Path = path.join(tmp, "r1132.json");
      await writeJson(r1132Path, r1132Fixture());

      const { output, outputPath } = await runR1142OrdinaryConsumerPartialPrivateChainRunner({
        availabilityManifestPath: "",
        createdAt: "2026-05-16T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        r1132Path,
      });

      expect(path.basename(outputPath)).toBe("r1142-ordinary-consumer-partial-private-chain-runner.latest.json");
      expect(output.schemaVersion).toBe(R1142_ORDINARY_CONSUMER_PARTIAL_PRIVATE_CHAIN_RUNNER_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        aggregateMetricsArtifact: null,
        conclusion: "ordinary_partial_private_chain_waiting_on_safe_manifest",
        eligiblePartialRouteIds: [],
        executedPartialRouteIds: [],
        finalReadyPartialMetricRouteIds: [],
        fullEvidenceGateCleared: false,
        nextAction: "fill_safe_availability_manifest_then_run_r1142_partial_private_chain",
        productDisplayAuthorized: false,
        realAggregateStillMissing: true,
        reviewGptRequiredNow: false,
        routeMetricsReadyForR1138: false,
      });
      expect(output.partialPrivateChain.stageResults.map((stage) => stage.stageId)).toEqual([
        "r1140_route_plan",
        "r1141_partial_private_metric_runner",
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes a safe partial manifest to the R1141 config handoff when no private config is supplied", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1142-missing-config-"));
    try {
      const r1132Path = path.join(tmp, "r1132.json");
      const manifestPath = path.join(tmp, "availability.json");
      await Promise.all([
        writeJson(r1132Path, r1132Fixture()),
        writeJson(manifestPath, partialLabWearableAvailabilityManifest()),
      ]);

      const { output } = await runR1142OrdinaryConsumerPartialPrivateChainRunner({
        availabilityManifestPath: manifestPath,
        outputDir: path.join(tmp, "out"),
        r1132Path,
      });

      expect(output.summary).toMatchObject({
        aggregateMetricsArtifact: null,
        conclusion: "ordinary_partial_private_chain_waiting_on_partial_private_config",
        eligiblePartialRouteIds: [
          "lab_glycemia_minimum_route",
          "wearable_activity_minimum_route",
        ],
        executedPartialRouteIds: [],
        nextAction: "provide_partial_private_runner_config",
        routeMetricsReadyForR1138: false,
      });
      expect(output.partialPrivateChain.stageResults.map((stage) => stage.conclusion)).toEqual([
        "ordinary_partial_readiness_chain_ready_for_partial_private_mapping",
        "ordinary_partial_private_metric_runner_missing_config",
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("keeps the preferred R1135 manifest recipe aligned with the R1142 partial route handoff", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1142-r1135-recipe-"));
    try {
      const r1132Path = path.join(tmp, "r1132.json");
      const manifestPath = path.join(tmp, "availability.json");
      await writeJson(r1132Path, r1132Fixture());

      const packet = await runR1135OrdinaryConsumerAvailabilityManifestPacket({
        outputDir: path.join(tmp, "packet-out"),
        r1076Path: path.join(tmp, "missing-r1076.json"),
        r1133Path: path.join(tmp, "missing-r1133.json"),
        r1134Path: path.join(tmp, "missing-r1134.json"),
      });
      const recipe = packet.output.availabilityManifestPacket.partialRouteManifestRecipes.find(
        (candidate) => candidate.recipeId === "lab_plus_wearable_minimum_manifest",
      );
      expect(recipe).toBeDefined();
      if (!recipe) throw new Error("Expected the preferred lab plus wearable manifest recipe.");
      await writeJson(manifestPath, availabilityManifestFromRecipe(recipe));

      const { output } = await runR1142OrdinaryConsumerPartialPrivateChainRunner({
        availabilityManifestPath: manifestPath,
        outputDir: path.join(tmp, "out"),
        r1132Path,
      });

      expect(output.summary).toMatchObject({
        aggregateMetricsArtifact: null,
        conclusion: "ordinary_partial_private_chain_waiting_on_partial_private_config",
        eligiblePartialRouteIds: recipe.expectedEligiblePartialRouteIds,
        executedPartialRouteIds: [],
        fullEvidenceGateCleared: false,
        fullSupportedRouteReady: recipe.expectedFullSupportedRouteReady,
        nextAction: "provide_partial_private_runner_config",
        productDisplayAuthorized: false,
        routeMetricsReadyForR1138: false,
      });
      expect(recipe.expectedEligiblePartialRouteIds).toEqual([
        "lab_glycemia_minimum_route",
        "wearable_activity_minimum_route",
      ]);
      expect(output.partialPrivateChain.stageResults.map((stage) => stage.conclusion)).toEqual([
        "ordinary_partial_readiness_chain_ready_for_partial_private_mapping",
        "ordinary_partial_private_metric_runner_missing_config",
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("runs safe manifest plus private config through partial metrics and records them research-only", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1142-ready-"));
    try {
      const r1132Path = path.join(tmp, "r1132.json");
      const manifestPath = path.join(tmp, "availability.json");
      const configPath = await writePrivateRunFixtures(tmp, [
        "lab_glycemia_minimum_route",
        "wearable_activity_minimum_route",
      ], 240);
      await Promise.all([
        writeJson(r1132Path, r1132Fixture()),
        writeJson(manifestPath, partialLabWearableAvailabilityManifest()),
      ]);

      const { output } = await runR1142OrdinaryConsumerPartialPrivateChainRunner({
        availabilityManifestPath: manifestPath,
        outputDir: path.join(tmp, "out"),
        partialPrivateRunnerConfigPath: configPath,
        r1132Path,
      });

      expect(output.summary).toMatchObject({
        aggregateMetricsArtifact: "r1141-ordinary-consumer-partial-aggregate-metrics.json",
        conclusion: "ordinary_partial_private_chain_partial_metrics_recorded_research_only",
        eligiblePartialRouteIds: [
          "lab_glycemia_minimum_route",
          "wearable_activity_minimum_route",
        ],
        executedPartialRouteIds: [
          "lab_glycemia_minimum_route",
          "wearable_activity_minimum_route",
        ],
        finalReadyPartialMetricRouteIds: [
          "lab_glycemia_minimum_route",
          "wearable_activity_minimum_route",
        ],
        fullEvidenceGateCleared: false,
        nextAction: "use_partial_metrics_for_research_only_collect_full_l1_l2_w1_qc_evidence",
        productDisplayAuthorized: false,
        routeMetricsReadyForR1138: true,
      });
      expect(output.partialPrivateChain.stageResults.map((stage) => stage.conclusion)).toEqual([
        "ordinary_partial_readiness_chain_ready_for_partial_private_mapping",
        "ordinary_partial_private_metric_runner_aggregate_metrics_ready_for_r1138",
        "ordinary_partial_readiness_chain_partial_metrics_recorded_research_only",
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(output)).not.toContain("src_person_id");
      expect(JSON.stringify(output)).not.toContain("private-person-");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1142-cli-"));
    try {
      const r1132Path = path.join(tmp, "r1132.json");
      await Promise.all([
        mkdir(path.join(tmp, "out")),
        writeJson(r1132Path, r1132Fixture()),
      ]);

      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1142-ordinary-consumer-partial-private-chain-runner.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1132_ORDINARY_CONSUMER_SUBMISSION_READINESS_PATH: r1132Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        nextAction: string;
        productDisplayAuthorized: boolean;
        stageResults: Array<{ stageId: string }>;
      };
      expect(summary).toMatchObject({
        conclusion: "ordinary_partial_private_chain_waiting_on_safe_manifest",
        nextAction: "fill_safe_availability_manifest_then_run_r1142_partial_private_chain",
        productDisplayAuthorized: false,
      });
      expect(summary.stageResults.map((stage) => stage.stageId)).toEqual([
        "r1140_route_plan",
        "r1141_partial_private_metric_runner",
      ]);
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("localPaths");
      expect(stdout).not.toContain("rowValues");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writePrivateRunFixtures(
  tmp: string,
  routeIds: readonly string[],
  rowCount: number,
): Promise<string> {
  const outcomePath = path.join(tmp, "outcome.csv");
  const labPath = path.join(tmp, "lab.csv");
  const wearablePath = path.join(tmp, "wearable.csv");
  const configPath = path.join(tmp, "partial-config.json");
  await Promise.all([
    writeFile(outcomePath, privateOutcomeCsv(rowCount)),
    writeFile(labPath, privateLabCsv(rowCount)),
    writeFile(wearablePath, privateWearableCsv(rowCount)),
  ]);
  await writeJson(configPath, {
    aggregateMetricsTarget: {
      evaluatorId: "ordinary_consumer_partial_route_aggregate_evaluator_v1",
      schemaVersion: "murph-age-ordinary-consumer-partial-aggregate-metrics.v1",
    },
    attestations: {
      localOnly: true,
      noCoefficientEgress: true,
      noHeaderNameEgress: true,
      noParticipantEgress: true,
      noPredictionEgress: true,
      noPrivatePathEgress: true,
      noPrivateRefValueEgress: true,
      noRowEgress: true,
      noSmallCellEgress: true,
      noSourceTextEgress: true,
    },
    privateFieldRefs: {
      commonLabCore: "src_cholesterol,src_albumin",
      labGlycemia: "src_glucose",
      outcomeEvent: "src_outcome",
      personJoinKey: "src_person_id",
      vitalsBody: "src_bmi",
      wearableActivity: "src_steps",
    },
    privateTableRefs: {
      labTableRef: labPath,
      outcomeTableRef: outcomePath,
      wearableTableRef: wearablePath,
    },
    routeRunOrder: routeIds.map((routeId) => ({ routeId })),
    schemaVersion: "murph-age-ordinary-consumer-partial-private-runner-config.v1",
    submissionContext: {
      evidenceRole: "real_partial_route_evidence",
    },
  });
  return configPath;
}

function privateOutcomeCsv(rowCount: number): string {
  const rows = [["src_person_id", "src_outcome"].join(",")];
  for (let index = 0; index < rowCount; index += 1) {
    rows.push([`private-person-${index}`, eventFor(index)].join(","));
  }
  return `${rows.join("\n")}\n`;
}

function privateLabCsv(rowCount: number): string {
  const rows = [["src_person_id", "src_glucose", "src_cholesterol", "src_albumin", "src_bmi"].join(",")];
  for (let index = 0; index < rowCount; index += 1) {
    const event = eventFor(index);
    rows.push([
      `private-person-${index}`,
      (88 + event * 36 + (index % 7)).toFixed(2),
      (172 + event * 28 + (index % 9)).toFixed(2),
      (4.3 - event * 0.5 - (index % 5) * 0.01).toFixed(2),
      (23 + event * 5 + (index % 6) * 0.2).toFixed(2),
    ].join(","));
  }
  return `${rows.join("\n")}\n`;
}

function privateWearableCsv(rowCount: number): string {
  const rows = [["src_person_id", "src_steps"].join(",")];
  for (let index = 0; index < rowCount; index += 1) {
    const event = eventFor(index);
    rows.push([
      `private-person-${index}`,
      (8800 - event * 3100 - (index % 11) * 22).toFixed(2),
    ].join(","));
  }
  return `${rows.join("\n")}\n`;
}

function eventFor(index: number): 0 | 1 {
  return index % 5 === 0 || index % 11 === 0 ? 1 : 0;
}

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

function availabilityManifestFromRecipe(recipe: {
  sourceFamiliesToDeclareAvailable: readonly string[];
}): Record<string, unknown> {
  const available = new Set(recipe.sourceFamiliesToDeclareAvailable);
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

function r1132Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1132"),
    ordinaryConsumerReadiness: {
      averageSubmitterFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
      missingSlotCount: 20,
      realAggregateStillMissing: true,
      readyForPrivateRunner: false,
      sourceFamilies: ORDINARY_SOURCE_FAMILY_IDS.map((familyId) => ({
        familyId,
        missingSlotCount: 1,
        missingSlotIds: [],
        status: "needs_private_config",
      })),
    },
    packetId: "r1132-ordinary-consumer-submission-readiness",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1132-ordinary-consumer-submission-readiness.v1",
    status: "research-local-aggregate-only",
    summary: {
      averageSubmitterFamilyIds: ORDINARY_SOURCE_FAMILY_IDS,
      conclusion: "ordinary_consumer_submission_readiness_ready_for_row_owner_mapping",
      missingSlotCount: 20,
      missingSlotTypes: [
        "first_pass_candidate",
        "semantic_ref_family",
        "submission_context_field",
        "table_ref",
      ],
      nextAction: "fill_average_submitter_private_config_slots",
      productDisplayAuthorized: false,
      readyForPrivateRunner: false,
      realAggregateStillMissing: true,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1132: false,
    },
  };
}

function safeBoundary(stage: "R1132"): Record<string, unknown> {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
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

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
