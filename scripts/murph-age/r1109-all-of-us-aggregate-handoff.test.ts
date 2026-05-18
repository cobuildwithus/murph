import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1109_ALL_OF_US_AGGREGATE_HANDOFF_SCHEMA_VERSION,
  runR1109AllOfUsAggregateHandoff,
} from "./r1109-all-of-us-aggregate-handoff.ts";

describe("R1109 All of Us aggregate handoff", () => {
  it("packages the All of Us route into an aggregate-only runnable handoff", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1109-"));
    try {
      const paths = await writeInputs(tmp, { ready: true });

      const { output, outputPath } = await runR1109AllOfUsAggregateHandoff({
        createdAt: "2026-05-15T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1109-all-of-us-aggregate-handoff.latest.json");
      expect(output.schemaVersion).toBe(R1109_ALL_OF_US_AGGREGATE_HANDOFF_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "all_of_us_aggregate_handoff_ready",
        nextAction: "run_or_request_all_of_us_aggregate_receipt",
        productDisplayAuthorized: false,
        reviewGptRequiredBeforeReceipt: false,
        rowParsingPerformedByR1109: false,
      });
      expect(output.sourceHandoff).toMatchObject({
        primarySourceRoute: "all_of_us_workbench_aggregate",
        requiredAggregateReceiptSchema: "murph-age-consumer-lab-wearable-aggregate-receipt.v1",
        requiredEvaluatorId: "consumer_lab_wearable_aggregate_evaluator_v1",
        requiredReceiptTemplateArtifact: "r1105-fillable-consumer-aggregate-receipt-template.json",
        runEnvironment: "source_workbench_or_equivalent_row_owning_environment",
      });
      expect(output.sourceHandoff.endpointFamilies.map((endpoint) => endpoint.endpointFamilyId)).toEqual([
        "E1_incident_cardiometabolic_disease",
        "E2_risk_factor_progression",
        "E3_hospitalization_or_acute_event",
        "E4_all_cause_mortality_secondary",
      ]);
      expect(output.sourceHandoff.candidateRunOrder.map((candidate) => candidate.candidateId)).toEqual([
        "L1_tiny_glycemia_only",
        "L2_common_lab_core_shadow",
        "QC_missingness_coverage",
        "W1_activity_steps_minutes",
        "W2_sleep_duration_regularity",
        "W3_rhr_hrv_recovery",
        "I1_integrated_lab_wearable_small_panel",
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits when the template or router is not ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1109-wait-"));
    try {
      const paths = await writeInputs(tmp, { ready: false });

      const { output } = await runR1109AllOfUsAggregateHandoff({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary.conclusion).toBe("all_of_us_aggregate_handoff_waiting_on_router_or_template");
      expect(output.summary.nextAction).toBe("regenerate_r1105_r1108_before_handoff");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe upstream artifacts", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1109-unsafe-"));
    try {
      const paths = await writeInputs(tmp, { ready: true });
      await writeJson(paths.r1108Path, {
        artifactBoundary: {
          ...safeBoundary(),
          rowValuesStored: true,
        },
        packetId: "r1108-consumer-source-endpoint-router",
        schemaVersion: "murph-age-r1108-consumer-source-endpoint-router.v1",
      });

      await expect(runR1109AllOfUsAggregateHandoff({
        outputDir: path.join(tmp, "out"),
        ...paths,
      })).rejects.toThrow("R1109 rejected unsafe r1108 input");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1109-cli-"));
    try {
      const paths = await writeInputs(tmp, { ready: true });
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1109-all-of-us-aggregate-handoff.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1105_CONSUMER_AGGREGATE_TEMPLATE_PATH: paths.r1105Path,
          MURPH_AGE_R1108_CONSUMER_SOURCE_ROUTER_PATH: paths.r1108Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        packetId: string;
        primarySourceRoute: string;
        productDisplayAuthorized: boolean;
      };
      expect(summary).toMatchObject({
        conclusion: "all_of_us_aggregate_handoff_ready",
        packetId: "r1109-all-of-us-aggregate-handoff",
        primarySourceRoute: "all_of_us_workbench_aggregate",
        productDisplayAuthorized: false,
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("participant");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeInputs(tmp: string, input: { ready: boolean }): Promise<{ r1105Path: string; r1108Path: string }> {
  const paths = {
    r1105Path: path.join(tmp, "r1105.json"),
    r1108Path: path.join(tmp, "r1108.json"),
  };
  await Promise.all([
    writeJson(paths.r1105Path, {
      artifactBoundary: safeBoundary(),
      fillableReceiptTemplate: {
        evaluatorId: "consumer_lab_wearable_aggregate_evaluator_v1",
        schemaVersion: "murph-age-consumer-lab-wearable-aggregate-receipt.v1",
      },
      packetId: "r1105-consumer-aggregate-receipt-template",
      receiptTemplateArtifact: "r1105-fillable-consumer-aggregate-receipt-template.json",
      schemaVersion: "murph-age-r1105-consumer-aggregate-receipt-template.v1",
      summary: {
        templateReadyForDataFill: input.ready,
      },
    }),
    writeJson(paths.r1108Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1108-consumer-source-endpoint-router",
      schemaVersion: "murph-age-r1108-consumer-source-endpoint-router.v1",
      sourceRoutes: [
        {
          routeKey: input.ready ? "all_of_us_workbench_aggregate" : "midus_creles_existing_shadow",
        },
      ],
      summary: {
        conclusion: input.ready
          ? "route_all_of_us_or_cardia_aggregate_first"
          : "repair_consumer_source_inputs_before_routing",
      },
    }),
  ]);
  return paths;
}

function safeBoundary(): Record<string, unknown> {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    participantIdentifiersStored: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
