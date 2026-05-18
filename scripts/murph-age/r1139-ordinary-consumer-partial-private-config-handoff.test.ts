import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1139_ORDINARY_CONSUMER_PARTIAL_PRIVATE_CONFIG_HANDOFF_SCHEMA_VERSION,
  runR1139OrdinaryConsumerPartialPrivateConfigHandoff,
} from "./r1139-ordinary-consumer-partial-private-config-handoff.ts";

describe("R1139 ordinary consumer partial private config handoff", () => {
  it("waits on the safe route plan while emitting a pathless partial config template", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1139-waiting-"));
    try {
      const r1137Path = path.join(tmp, "r1137.json");
      const r1138Path = path.join(tmp, "r1138.json");
      await Promise.all([
        writeFile(r1137Path, `${JSON.stringify(r1137Fixture({
          conclusion: "ordinary_partial_route_planner_waiting_on_safe_manifest",
          partialRouteIdsReadyButUnsupported: [],
        }))}\n`),
        writeFile(r1138Path, `${JSON.stringify(r1138Fixture({
          conclusion: "ordinary_partial_aggregate_metric_intake_waiting_on_route_plan",
          readyPartialRouteIds: [],
        }))}\n`),
      ]);

      const { output, partialPrivateConfigTemplatePath } =
        await runR1139OrdinaryConsumerPartialPrivateConfigHandoff({
          createdAt: "2026-05-16T00:00:00.000Z",
          outputDir: path.join(tmp, "out"),
          r1137Path,
          r1138Path,
        });
      const template = JSON.parse(await readFile(partialPrivateConfigTemplatePath, "utf8")) as {
        routeMappings: Array<{ routeId: string; routeMappingStatus: string }>;
        schemaVersion: string;
      };

      expect(path.basename(partialPrivateConfigTemplatePath)).toBe(
        "r1139-fillable-ordinary-consumer-partial-private-config.json",
      );
      expect(template.schemaVersion).toBe("murph-age-ordinary-consumer-partial-private-config-template.v1");
      expect(template.routeMappings.map((route) => route.routeId)).toEqual([
        "lab_glycemia_minimum_route",
        "common_lab_core_with_context_route",
        "wearable_activity_minimum_route",
      ]);
      expect(new Set(template.routeMappings.map((route) => route.routeMappingStatus))).toEqual(new Set([
        "waiting_on_safe_availability_route_plan",
      ]));
      expect(output.schemaVersion).toBe(R1139_ORDINARY_CONSUMER_PARTIAL_PRIVATE_CONFIG_HANDOFF_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "ordinary_partial_private_config_handoff_waiting_on_route_plan",
        eligiblePartialRouteIds: [],
        fullEvidenceGateCleared: false,
        nextAction: "fill_safe_availability_manifest_then_run_r1136_r1137_chain",
        productDisplayAuthorized: false,
        realAggregateStillMissing: true,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1139: false,
      });
      expect(output.partialPrivateConfigHandoff).toMatchObject({
        fullEvidenceGateCleared: false,
        partialPrivateConfigTemplateArtifact: "r1139-fillable-ordinary-consumer-partial-private-config.json",
        partialRunnerImplementationRequired: false,
        privateDetailsStored: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(findForbiddenAggregateEgress(template)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(template)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("creates a route-specific mapping handoff for ready lab and wearable partial routes", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1139-ready-"));
    try {
      const r1137Path = path.join(tmp, "r1137.json");
      const r1138Path = path.join(tmp, "r1138.json");
      await Promise.all([
        writeFile(r1137Path, `${JSON.stringify(r1137Fixture({
          conclusion: "ordinary_partial_route_planner_partial_routes_available_runner_extension_needed",
          partialRouteIdsReadyButUnsupported: [
            "lab_glycemia_minimum_route",
            "wearable_activity_minimum_route",
          ],
        }))}\n`),
        writeFile(r1138Path, `${JSON.stringify(r1138Fixture({
          conclusion: "ordinary_partial_aggregate_metrics_missing",
          readyPartialRouteIds: [],
        }))}\n`),
      ]);

      const { output, partialPrivateConfigTemplatePath } =
        await runR1139OrdinaryConsumerPartialPrivateConfigHandoff({
          outputDir: path.join(tmp, "out"),
          r1137Path,
          r1138Path,
        });
      const template = JSON.parse(await readFile(partialPrivateConfigTemplatePath, "utf8")) as {
        routeMappings: Array<{
          requiredPrivateFieldRefFamilies: string[];
          requiredPrivateTableRefs: string[];
          routeId: string;
          routeMappingStatus: string;
          valuesStoredInThisArtifact: boolean;
        }>;
      };

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_partial_private_config_handoff_ready_for_partial_private_mapping",
        eligiblePartialRouteIds: [
          "lab_glycemia_minimum_route",
          "wearable_activity_minimum_route",
        ],
        nextAction: "fill_partial_private_config_for_ready_routes_then_run_r1141_partial_private_metric_runner",
        readyPartialMetricRouteIds: [],
      });
      expect(output.partialPrivateConfigHandoff.commands.partialPrivateMetricRunnerCommand).toContain(
        "r1141-ordinary-consumer-partial-private-metric-runner.ts",
      );
      expect(output.partialPrivateConfigHandoff.partialRunnerImplementationRequired).toBe(false);
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
      expect(template.routeMappings.map((route) => route.routeId)).toEqual([
        "lab_glycemia_minimum_route",
        "wearable_activity_minimum_route",
      ]);
      expect(template.routeMappings.every((route) => route.routeMappingStatus === "ready_for_private_workspace_mapping"))
        .toBe(true);
      expect(template.routeMappings.every((route) => route.valuesStoredInThisArtifact === false)).toBe(true);
      expect(template.routeMappings[0]?.requiredPrivateFieldRefFamilies).toEqual([
        "personJoinKey",
        "dateOrTimeKey",
        "outcomeEvent",
        "labGlycemia",
      ]);
      expect(template.routeMappings[1]?.requiredPrivateTableRefs).toContain("wearableTableRef");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(findForbiddenAggregateEgress(template)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(template)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("keeps completed partial metrics research-only and does not clear the full evidence gate", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1139-recorded-"));
    try {
      const r1137Path = path.join(tmp, "r1137.json");
      const r1138Path = path.join(tmp, "r1138.json");
      await Promise.all([
        writeFile(r1137Path, `${JSON.stringify(r1137Fixture({
          conclusion: "ordinary_partial_route_planner_partial_routes_available_runner_extension_needed",
          partialRouteIdsReadyButUnsupported: ["wearable_activity_minimum_route"],
        }))}\n`),
        writeFile(r1138Path, `${JSON.stringify(r1138Fixture({
          conclusion: "ordinary_partial_aggregate_metrics_recorded_not_full_evidence",
          readyPartialRouteIds: ["wearable_activity_minimum_route"],
        }))}\n`),
      ]);

      const { output } = await runR1139OrdinaryConsumerPartialPrivateConfigHandoff({
        outputDir: path.join(tmp, "out"),
        r1137Path,
        r1138Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_partial_private_config_handoff_partial_metrics_recorded_research_only",
        fullEvidenceGateCleared: false,
        nextAction: "use_partial_metrics_for_research_only_collect_full_l1_l2_w1_qc_evidence",
        productDisplayAuthorized: false,
        readyPartialMetricRouteIds: ["wearable_activity_minimum_route"],
        realAggregateStillMissing: true,
        reviewGptRequiredNow: false,
      });
      expect(output.partialPrivateConfigHandoff.routeHandoffs).toEqual([
        expect.objectContaining({
          routeId: "wearable_activity_minimum_route",
          routeMappingStatus: "metrics_recorded_research_only",
          valuesStoredInThisArtifact: false,
        }),
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1139-cli-"));
    try {
      const r1137Path = path.join(tmp, "r1137.json");
      const r1138Path = path.join(tmp, "r1138.json");
      await Promise.all([
        mkdir(path.join(tmp, "out")),
        writeFile(r1137Path, `${JSON.stringify(r1137Fixture({
          conclusion: "ordinary_partial_route_planner_partial_routes_available_runner_extension_needed",
          partialRouteIdsReadyButUnsupported: ["common_lab_core_with_context_route"],
        }))}\n`),
        writeFile(r1138Path, `${JSON.stringify(r1138Fixture({
          conclusion: "ordinary_partial_aggregate_metrics_missing",
          readyPartialRouteIds: [],
        }))}\n`),
      ]);

      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1139-ordinary-consumer-partial-private-config-handoff.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1137_ORDINARY_CONSUMER_PARTIAL_ROUTE_PLANNER_PATH: r1137Path,
          MURPH_AGE_R1138_ORDINARY_CONSUMER_PARTIAL_AGGREGATE_METRIC_INTAKE_PATH: r1138Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        eligiblePartialRouteIds: string[];
        productDisplayAuthorized: boolean;
        requiredPrivateFieldRefFamilies: string[];
        reviewGptRequiredNow: boolean;
      };
      expect(summary).toMatchObject({
        conclusion: "ordinary_partial_private_config_handoff_ready_for_partial_private_mapping",
        eligiblePartialRouteIds: ["common_lab_core_with_context_route"],
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
      });
      expect(summary.requiredPrivateFieldRefFamilies).toContain("commonLabCore");
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("localPaths");
      expect(stdout).not.toContain("rowValues");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

function r1137Fixture(input: {
  conclusion: string;
  partialRouteIdsReadyButUnsupported: string[];
  fullSupportedRouteReady?: boolean;
}): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1137"),
    packetId: "r1137-ordinary-consumer-partial-route-planner",
    partialRoutePlanner: {
      fullSupportedRouteReady: input.fullSupportedRouteReady ?? false,
      partialRouteIdsReadyButUnsupported: input.partialRouteIdsReadyButUnsupported,
      privateDetailsStored: false,
    },
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1137-ordinary-consumer-partial-route-planner.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: input.conclusion,
      fullSupportedRouteReady: input.fullSupportedRouteReady ?? false,
      partialRouteIdsReadyButUnsupported: input.partialRouteIdsReadyButUnsupported,
      productDisplayAuthorized: false,
      readyForPrivateConfigMapping: input.fullSupportedRouteReady ?? false,
      realAggregateStillMissing: true,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1137: false,
    },
  };
}

function r1138Fixture(input: {
  conclusion: string;
  readyPartialRouteIds: string[];
}): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1138"),
    packetId: "r1138-ordinary-consumer-partial-aggregate-metric-intake",
    partialMetricIntake: {
      fullEvidenceGateCleared: false,
      privateDetailsStored: false,
      readyPartialRouteIds: input.readyPartialRouteIds,
    },
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1138-ordinary-consumer-partial-aggregate-metric-intake.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: input.conclusion,
      nextAction: input.conclusion === "ordinary_partial_aggregate_metrics_recorded_not_full_evidence"
        ? "use_partial_metrics_for_research_only_collect_full_l1_l2_w1_qc_evidence"
        : "fill_partial_aggregate_metrics_template_after_route_plan",
      productDisplayAuthorized: false,
      readyPartialRouteIds: input.readyPartialRouteIds,
      realAggregateStillMissing: true,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1138: false,
    },
  };
}

function safeBoundary(stage: "R1137" | "R1138") {
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
