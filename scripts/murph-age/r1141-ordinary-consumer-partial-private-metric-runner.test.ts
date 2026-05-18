import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { runR1138OrdinaryConsumerPartialAggregateMetricIntake } from "./r1138-ordinary-consumer-partial-aggregate-metric-intake.ts";
import {
  R1141_ORDINARY_CONSUMER_PARTIAL_PRIVATE_METRIC_RUNNER_SCHEMA_VERSION,
  runR1141OrdinaryConsumerPartialPrivateMetricRunner,
} from "./r1141-ordinary-consumer-partial-private-metric-runner.ts";

const PARTIAL_PRIVATE_CONFIG_TEMPLATE_ARTIFACT =
  "r1139-fillable-ordinary-consumer-partial-private-config.json";
const PARTIAL_ROUTE_IDS = [
  "lab_glycemia_minimum_route",
  "common_lab_core_with_context_route",
  "wearable_activity_minimum_route",
];

describe("R1141 ordinary consumer partial private metric runner", () => {
  it("surfaces the partial private config checklist when no config is provided", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1141-missing-config-"));
    try {
      const r1139Path = path.join(tmp, "r1139.json");
      await writeJson(r1139Path, r1139ReadyFixture(["wearable_activity_minimum_route"]));

      const { aggregateMetricsPath, output } = await runR1141OrdinaryConsumerPartialPrivateMetricRunner({
        createdAt: "2026-05-16T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        r1139Path,
      });

      expect(aggregateMetricsPath).toBeNull();
      expect(output.schemaVersion).toBe(R1141_ORDINARY_CONSUMER_PARTIAL_PRIVATE_METRIC_RUNNER_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        aggregateMetricsArtifact: null,
        conclusion: "ordinary_partial_private_metric_runner_missing_config",
        nextAction: "provide_partial_private_runner_config",
        routeMetricsReadyForR1138: false,
      });
      expect(output.partialPrivateExecution).toMatchObject({
        aggregateMetricsArtifact: null,
        configPathConfigured: false,
        eligiblePartialRouteIds: ["wearable_activity_minimum_route"],
        localPrivateDataRead: false,
        partialPrivateConfigTemplateArtifact: PARTIAL_PRIVATE_CONFIG_TEMPLATE_ARTIFACT,
        privateValuesStored: false,
      });
      expect(output.partialPrivateExecution.privateConfigChecklist).toMatchObject({
        aggregateMetricsTargetEvaluatorId: "ordinary_consumer_partial_route_aggregate_evaluator_v1",
        aggregateMetricsTargetSchemaVersion: "murph-age-ordinary-consumer-partial-aggregate-metrics.v1",
        minimumEventCount: "10_plus",
        minimumUsableRecordCount: "50_plus",
        requiredRouteIds: ["wearable_activity_minimum_route"],
        singlePrimaryTableFallbackAccepted: true,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits when the partial handoff has not marked routes ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1141-waiting-"));
    try {
      const paths = await writePrivateRunFixtures(tmp, {
        r1139: r1139WaitingFixture(),
        routeIds: ["lab_glycemia_minimum_route"],
        rowCount: 240,
      });

      const { aggregateMetricsPath, output } = await runR1141OrdinaryConsumerPartialPrivateMetricRunner({
        configPath: paths.configPath,
        outputDir: path.join(tmp, "out"),
        r1139Path: paths.r1139Path,
      });

      expect(aggregateMetricsPath).toBeNull();
      expect(output.summary).toMatchObject({
        conclusion: "ordinary_partial_private_metric_runner_waiting_on_partial_handoff",
        nextAction: "run_r1140_or_r1139_until_partial_routes_ready",
      });
      expect(output.partialPrivateExecution.localPrivateDataRead).toBe(false);
      expect(output.partialPrivateExecution.executedPartialRouteIds).toEqual([]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(output)).not.toContain("src_person_id");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("turns private lab and wearable rows into R1138-compatible partial aggregate metrics", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1141-ready-"));
    try {
      const routeIds = ["lab_glycemia_minimum_route", "wearable_activity_minimum_route"];
      const paths = await writePrivateRunFixtures(tmp, {
        r1139: r1139ReadyFixture(routeIds),
        routeIds,
        rowCount: 240,
      });

      const { aggregateMetricsPath, output, outputPath } = await runR1141OrdinaryConsumerPartialPrivateMetricRunner({
        configPath: paths.configPath,
        createdAt: "2026-05-16T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        r1139Path: paths.r1139Path,
      });

      expect(path.basename(outputPath)).toBe("r1141-ordinary-consumer-partial-private-metric-runner.latest.json");
      expect(path.basename(aggregateMetricsPath ?? "")).toBe("r1141-ordinary-consumer-partial-aggregate-metrics.json");
      expect(output.summary).toMatchObject({
        aggregateMetricsArtifact: "r1141-ordinary-consumer-partial-aggregate-metrics.json",
        conclusion: "ordinary_partial_private_metric_runner_aggregate_metrics_ready_for_r1138",
        executedPartialRouteIds: routeIds,
        nextAction: "send_r1141_partial_metrics_to_r1138_or_r1140",
        routeMetricsReadyForR1138: true,
      });
      expect(output.partialPrivateExecution).toMatchObject({
        aggregateMetricsArtifact: "r1141-ordinary-consumer-partial-aggregate-metrics.json",
        aggregateMetricsRouteCountBand: "1-3",
        configPathConfigured: true,
        eligiblePartialRouteIds: routeIds,
        executedPartialRouteIds: routeIds,
        localPrivateDataRead: true,
        privateValuesStored: false,
        requestedPartialRouteIds: routeIds,
      });
      expect(output.partialPrivateExecution.routeExecutionStatus).toEqual([
        expect.objectContaining({
          routeId: "lab_glycemia_minimum_route",
          status: "aggregate_metrics_ready",
        }),
        expect.objectContaining({
          routeId: "wearable_activity_minimum_route",
          status: "aggregate_metrics_ready",
        }),
      ]);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(output)).not.toContain("src_person_id");
      expect(JSON.stringify(output)).not.toContain("src_glucose");
      expect(JSON.stringify(output)).not.toContain("private-person-");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const aggregateMetrics = JSON.parse(await readFile(aggregateMetricsPath ?? "", "utf8")) as {
        routeResults: Array<{ candidateResults: Array<{ candidateId: string }>; routeId: string }>;
        schemaVersion: string;
      };
      expect(aggregateMetrics.schemaVersion).toBe("murph-age-ordinary-consumer-partial-aggregate-metrics.v1");
      expect(aggregateMetrics.routeResults.map((route) => route.routeId)).toEqual(routeIds);
      expect(aggregateMetrics.routeResults.flatMap((route) =>
        route.candidateResults.map((candidate) => candidate.candidateId)
      )).toEqual(["L1_tiny_glycemia_only", "W1_activity_steps_minutes"]);
      expect(JSON.stringify(aggregateMetrics)).not.toContain("src_");
      expect(JSON.stringify(aggregateMetrics)).not.toContain("private-person-");
      expect(findForbiddenAggregateEgress(aggregateMetrics)).toEqual([]);

      const r1137Path = path.join(tmp, "r1137.json");
      await writeJson(r1137Path, r1137PartialRouteFixture(routeIds));
      const r1138 = await runR1138OrdinaryConsumerPartialAggregateMetricIntake({
        outputDir: path.join(tmp, "out-r1138"),
        partialAggregateMetricsPath: aggregateMetricsPath ?? "",
        r1137Path,
      });
      expect(r1138.output.summary).toMatchObject({
        conclusion: "ordinary_partial_aggregate_metrics_recorded_not_full_evidence",
        readyPartialRouteIds: routeIds,
      });
      expect(findForbiddenAggregateEgress(r1138.output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not emit ready metrics when the private rows are below the evidence floor", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1141-small-"));
    try {
      const paths = await writePrivateRunFixtures(tmp, {
        r1139: r1139ReadyFixture(["lab_glycemia_minimum_route"]),
        routeIds: ["lab_glycemia_minimum_route"],
        rowCount: 24,
      });

      const { aggregateMetricsPath, output } = await runR1141OrdinaryConsumerPartialPrivateMetricRunner({
        configPath: paths.configPath,
        outputDir: path.join(tmp, "out"),
        r1139Path: paths.r1139Path,
      });

      expect(aggregateMetricsPath).toBeNull();
      expect(output.summary).toMatchObject({
        conclusion: "ordinary_partial_private_metric_runner_not_enough_usable_data",
        nextAction: "use_larger_or_better_covered_partial_route_dataset",
        routeMetricsReadyForR1138: false,
      });
      expect(output.partialPrivateExecution.routeExecutionStatus).toEqual([
        expect.objectContaining({
          routeId: "lab_glycemia_minimum_route",
          status: "not_enough_usable_data",
        }),
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(output)).not.toContain("private-person-");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1141-cli-"));
    try {
      const r1139Path = path.join(tmp, "r1139.json");
      await Promise.all([
        mkdir(path.join(tmp, "out")),
        writeJson(r1139Path, r1139ReadyFixture(["lab_glycemia_minimum_route"])),
      ]);

      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1141-ordinary-consumer-partial-private-metric-runner.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1139_ORDINARY_CONSUMER_PARTIAL_PRIVATE_CONFIG_HANDOFF_PATH: r1139Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        eligiblePartialRouteIds: string[];
        nextAction: string;
        productDisplayAuthorized: boolean;
        requestedPartialRouteIds: string[];
      };
      expect(summary).toMatchObject({
        conclusion: "ordinary_partial_private_metric_runner_missing_config",
        eligiblePartialRouteIds: ["lab_glycemia_minimum_route"],
        nextAction: "provide_partial_private_runner_config",
        productDisplayAuthorized: false,
        requestedPartialRouteIds: [],
      });
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
  options: {
    r1139: Record<string, unknown>;
    routeIds: string[];
    rowCount: number;
  },
): Promise<{
  configPath: string;
  r1139Path: string;
}> {
  const r1139Path = path.join(tmp, "r1139.json");
  const outcomePath = path.join(tmp, "outcome.csv");
  const labPath = path.join(tmp, "lab.csv");
  const wearablePath = path.join(tmp, "wearable.csv");
  const configPath = path.join(tmp, "partial-config.json");
  await Promise.all([
    writeJson(r1139Path, options.r1139),
    writeFile(outcomePath, privateOutcomeCsv(options.rowCount)),
    writeFile(labPath, privateLabCsv(options.rowCount)),
    writeFile(wearablePath, privateWearableCsv(options.rowCount)),
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
    routeRunOrder: options.routeIds.map((routeId) => ({ routeId })),
    schemaVersion: "murph-age-ordinary-consumer-partial-private-runner-config.v1",
    submissionContext: {
      evidenceRole: "real_partial_route_evidence",
    },
  });
  return { configPath, r1139Path };
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

function r1139ReadyFixture(eligibleRouteIds: readonly string[]): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1139"),
    packetId: "r1139-ordinary-consumer-partial-private-config-handoff",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1139-ordinary-consumer-partial-private-config-handoff.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "ordinary_partial_private_config_handoff_ready_for_partial_private_mapping",
      eligiblePartialRouteIds: eligibleRouteIds,
      fullEvidenceGateCleared: false,
      fullSupportedRouteReady: false,
      nextAction: "fill_partial_private_config_for_ready_routes_then_run_r1141_partial_private_metric_runner",
      partialPrivateConfigTemplateArtifact: PARTIAL_PRIVATE_CONFIG_TEMPLATE_ARTIFACT,
      productDisplayAuthorized: false,
      readyPartialMetricRouteIds: [],
      realAggregateStillMissing: true,
      requiredPrivateFieldRefFamilies: [
        "personJoinKey",
        "dateOrTimeKey",
        "outcomeEvent",
        "labGlycemia",
        "commonLabCore",
        "vitalsBody",
        "wearableActivity",
      ],
      requiredPrivateTableRefs: [
        "primaryTableRef",
        "outcomeTableRef",
        "labTableRef",
        "wearableTableRef",
      ],
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1139: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1139WaitingFixture(): Record<string, unknown> {
  return {
    ...r1139ReadyFixture([]),
    summary: {
      conclusion: "ordinary_partial_private_config_handoff_waiting_on_route_plan",
      eligiblePartialRouteIds: [],
      nextAction: "fill_safe_availability_manifest_then_run_r1136_r1137_chain",
      partialPrivateConfigTemplateArtifact: PARTIAL_PRIVATE_CONFIG_TEMPLATE_ARTIFACT,
      productDisplayAuthorized: false,
      readyPartialMetricRouteIds: [],
      realAggregateStillMissing: true,
      requiredPrivateFieldRefFamilies: [],
      requiredPrivateTableRefs: [],
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1139: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1137PartialRouteFixture(partialRouteIdsReadyButUnsupported: readonly string[]): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1137"),
    packetId: "r1137-ordinary-consumer-partial-route-planner",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1137-ordinary-consumer-partial-route-planner.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "ordinary_partial_route_planner_partial_routes_available_runner_extension_needed",
      fullSupportedRouteReady: false,
      nextAction: "extend_r1125_r1124_for_partial_lab_wearable_routes_or_collect_missing_full_route",
      partialRouteIdsReadyButUnsupported,
      productDisplayAuthorized: false,
      readyForPrivateConfigMapping: false,
      realAggregateStillMissing: true,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1137: false,
    },
  };
}

function safeBoundary(stage: "R1137" | "R1139"): Record<string, unknown> {
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

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
