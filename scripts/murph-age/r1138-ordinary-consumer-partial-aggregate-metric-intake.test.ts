import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1138_ORDINARY_CONSUMER_PARTIAL_AGGREGATE_METRIC_INTAKE_SCHEMA_VERSION,
  runR1138OrdinaryConsumerPartialAggregateMetricIntake,
  type R1138PartialAggregateMetricsInput,
} from "./r1138-ordinary-consumer-partial-aggregate-metric-intake.ts";

describe("R1138 ordinary consumer partial aggregate metric intake", () => {
  it("emits a fillable partial aggregate metrics template from the route planner", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1138-missing-"));
    try {
      const r1137Path = path.join(tmp, "r1137.json");
      await writeFile(r1137Path, `${JSON.stringify(r1137Fixture([
        "lab_glycemia_minimum_route",
        "wearable_activity_minimum_route",
      ]))}\n`);

      const { output, partialAggregateMetricsTemplatePath } =
        await runR1138OrdinaryConsumerPartialAggregateMetricIntake({
          createdAt: "2026-05-16T00:00:00.000Z",
          outputDir: path.join(tmp, "out"),
          r1137Path,
        });
      const template = JSON.parse(await readFile(partialAggregateMetricsTemplatePath, "utf8")) as {
        routeResults: Array<{ routeId: string }>;
        schemaVersion: string;
        submissionContext: { partialEvidenceOnly: boolean };
      };

      expect(path.basename(partialAggregateMetricsTemplatePath)).toBe(
        "r1138-fillable-ordinary-consumer-partial-aggregate-metrics.json",
      );
      expect(template.schemaVersion).toBe("murph-age-ordinary-consumer-partial-aggregate-metrics.v1");
      expect(template.submissionContext.partialEvidenceOnly).toBe(true);
      expect(template.routeResults.map((route) => route.routeId)).toEqual([
        "lab_glycemia_minimum_route",
        "wearable_activity_minimum_route",
      ]);
      expect(output.schemaVersion).toBe(R1138_ORDINARY_CONSUMER_PARTIAL_AGGREGATE_METRIC_INTAKE_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "ordinary_partial_aggregate_metrics_missing",
        nextAction: "fill_partial_aggregate_metrics_template_after_route_plan",
        productDisplayAuthorized: false,
        readyPartialRouteIds: [],
        realAggregateStillMissing: true,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1138: false,
      });
      expect(output.partialMetricIntake).toMatchObject({
        aggregateMetricsProvided: false,
        fullEvidenceGateCleared: false,
        partialRouteIdsReadyButUnsupported: [
          "lab_glycemia_minimum_route",
          "wearable_activity_minimum_route",
        ],
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(findForbiddenAggregateEgress(template)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(template)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("records complete partial route metrics without clearing the full evidence gate", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1138-recorded-"));
    try {
      const r1137Path = path.join(tmp, "r1137.json");
      await writeFile(r1137Path, `${JSON.stringify(r1137Fixture(["lab_glycemia_minimum_route"]))}\n`);

      const { output } = await runR1138OrdinaryConsumerPartialAggregateMetricIntake({
        outputDir: path.join(tmp, "out"),
        partialAggregateMetrics: partialMetricsFixture("lab_glycemia_minimum_route", ["L1_tiny_glycemia_only"]),
        r1137Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_partial_aggregate_metrics_recorded_not_full_evidence",
        nextAction: "use_partial_metrics_for_research_only_collect_full_l1_l2_w1_qc_evidence",
        productDisplayAuthorized: false,
        readyPartialRouteIds: ["lab_glycemia_minimum_route"],
        realAggregateStillMissing: true,
        reviewGptRequiredNow: false,
      });
      expect(output.partialMetricIntake).toMatchObject({
        aggregateMetricsProvided: true,
        fullEvidenceGateCleared: false,
        routeMetricStatus: [
          {
            missingCandidateIds: [],
            routeId: "lab_glycemia_minimum_route",
            status: "complete",
          },
        ],
        submissionEvidenceRole: "real_partial_route_evidence",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("keeps incomplete partial route metrics out of research-ready status", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1138-incomplete-"));
    try {
      const r1137Path = path.join(tmp, "r1137.json");
      await writeFile(r1137Path, `${JSON.stringify(r1137Fixture(["wearable_activity_minimum_route"]))}\n`);

      const { output } = await runR1138OrdinaryConsumerPartialAggregateMetricIntake({
        outputDir: path.join(tmp, "out"),
        partialAggregateMetrics: partialMetricsFixture("wearable_activity_minimum_route", []),
        r1137Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_partial_aggregate_metrics_incomplete",
        nextAction: "provide_complete_partial_route_aggregate_metrics",
        readyPartialRouteIds: [],
        reviewGptRequiredNow: false,
      });
      expect(output.partialMetricIntake.routeMetricStatus).toEqual([
        {
          missingCandidateIds: ["W1_activity_steps_minutes"],
          routeId: "wearable_activity_minimum_route",
          status: "incomplete",
        },
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1138-cli-"));
    try {
      const r1137Path = path.join(tmp, "r1137.json");
      const metricsPath = path.join(tmp, "partial-metrics.json");
      await Promise.all([
        mkdir(path.join(tmp, "out")),
        writeFile(r1137Path, `${JSON.stringify(r1137Fixture(["wearable_activity_minimum_route"]))}\n`),
        writeFile(metricsPath, `${JSON.stringify(partialMetricsFixture(
          "wearable_activity_minimum_route",
          ["W1_activity_steps_minutes"],
        ))}\n`),
      ]);

      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1138-ordinary-consumer-partial-aggregate-metric-intake.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_AGGREGATE_METRICS_PATH: metricsPath,
          MURPH_AGE_R1137_ORDINARY_CONSUMER_PARTIAL_ROUTE_PLANNER_PATH: r1137Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        productDisplayAuthorized: boolean;
        readyPartialRouteIds: string[];
        reviewGptRequiredNow: boolean;
      };
      expect(summary).toMatchObject({
        conclusion: "ordinary_partial_aggregate_metrics_recorded_not_full_evidence",
        productDisplayAuthorized: false,
        readyPartialRouteIds: ["wearable_activity_minimum_route"],
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

function r1137Fixture(partialRouteIdsReadyButUnsupported: string[]): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary("R1137"),
    packetId: "r1137-ordinary-consumer-partial-route-planner",
    partialRoutePlanner: {
      partialRouteIdsReadyButUnsupported,
      privateDetailsStored: false,
    },
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1137-ordinary-consumer-partial-route-planner.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: partialRouteIdsReadyButUnsupported.length > 0
        ? "ordinary_partial_route_planner_partial_routes_available_runner_extension_needed"
        : "ordinary_partial_route_planner_waiting_on_safe_manifest",
      partialRouteIdsReadyButUnsupported,
      productDisplayAuthorized: false,
      readyForPrivateConfigMapping: false,
      realAggregateStillMissing: true,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1137: false,
    },
  };
}

function partialMetricsFixture(routeId: string, candidateIds: string[]): R1138PartialAggregateMetricsInput {
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
        candidateResults: candidateIds.map((candidateId) => ({
          aucDelta: 0.01,
          brierDelta: -0.002,
          calibrationStatus: "directional_only",
          candidateId,
          candidateKind: candidateId === "W1_activity_steps_minutes" ? "wearable" : "lab",
          comparatorId: "frozen_recalibrated_r399",
          coverageStatus: "usable",
          evidenceSupport: "underpowered",
          logLossDelta: -0.003,
          missingnessOrCoverageControlStatus: "directional_only",
        })),
        routeId,
      },
    ],
    schemaVersion: "murph-age-ordinary-consumer-partial-aggregate-metrics.v1",
    submissionContext: {
      evidenceRole: "real_partial_route_evidence",
      ordinaryConsumerSubmission: true,
      outcomeLinked: true,
      partialEvidenceOnly: true,
      targetAgeBand: "roughly_16_50",
    },
  };
}

function safeBoundary(stage: "R1137") {
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
