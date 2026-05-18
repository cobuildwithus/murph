import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1111_CONSUMER_AGGREGATE_RECEIPT_RUNBOOK_SCHEMA_VERSION,
  runR1111ConsumerAggregateReceiptRunbook,
} from "./r1111-consumer-aggregate-receipt-runbook.ts";

describe("R1111 consumer aggregate receipt runbook", () => {
  it("packages an executable aggregate-only All of Us/CARDIA receipt runbook", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1111-"));
    try {
      const paths = await writeInputs(tmp, { ready: true });

      const { output, outputPath } = await runR1111ConsumerAggregateReceiptRunbook({
        createdAt: "2026-05-15T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1111-consumer-aggregate-receipt-runbook.latest.json");
      expect(output.schemaVersion).toBe(R1111_CONSUMER_AGGREGATE_RECEIPT_RUNBOOK_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "consumer_aggregate_receipt_runbook_ready",
        nextAction: "run_all_of_us_or_cardia_aggregate_receipt_then_validate_r1104",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1111: false,
      });
      expect(output.handoff.routePriority.map((route) => route.route)).toEqual([
        "all_of_us_workbench_aggregate",
        "cardia_authorized_or_aggregate",
        "partner_aggregate_evaluator",
        "nhanes_activity_shadow",
        "midus_biomarker_mortality_shadow",
        "ukb_integrated_support",
      ]);
      expect(output.handoff.featureFamilyOrder.slice(0, 5)).toEqual([
        "bloodwork_common_labs",
        "vitals_body_composition",
        "wearable_activity",
        "wearable_sleep",
        "wearable_recovery",
      ]);
      expect(output.handoff.consumerTarget).toMatchObject({
        firstPassInputPolicy: "average_consumer_submittable_labs_vitals_wearables_first",
        primaryAgeBand: "roughly_16_50",
        scoreCandidateFamilies: [
          "bloodwork_common_labs",
          "vitals_body_composition",
          "wearable_activity",
          "wearable_sleep",
          "wearable_recovery",
        ],
      });
      expect(output.handoff.consumerTarget.excludedFirstPassSignals).toContain("older_adult_only_function_tests");
      expect(output.handoff.blockedExternalOutput).toContain("rows");
      expect(output.handoff.blockedExternalOutput).toContain("coefficients_or_model_parameters");
      expect(output.handoff.runbookSteps.map((step) => step.stepId)).toEqual([
        "choose_endpoint",
        "freeze_denominator",
        "run_candidates",
        "run_controls",
        "fill_receipt",
        "validate_receipt",
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits when the consumer route order is stale", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1111-stale-"));
    try {
      const paths = await writeInputs(tmp, { ready: true, staleRouteOrder: true });

      const { output } = await runR1111ConsumerAggregateReceiptRunbook({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary.conclusion).toBe("consumer_aggregate_receipt_runbook_waiting_on_upstream");
      expect(output.summary.nextAction).toBe("regenerate_consumer_receipt_prerequisites");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits when an upstream artifact identity does not match", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1111-identity-"));
    try {
      const paths = await writeInputs(tmp, { ready: true });
      await writeJson(paths.r1110Path, {
        artifactBoundary: safeBoundary(),
        packetId: "r1110-consumer-input-spine",
        schemaVersion: "murph-age-r1110-consumer-input-spine.future",
        summary: {
          conclusion: "consumer_lab_wearable_spine_ready",
        },
      });

      const { output } = await runR1111ConsumerAggregateReceiptRunbook({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary.conclusion).toBe("consumer_aggregate_receipt_runbook_waiting_on_upstream");
      expect(output.inputArtifacts.r1110).toMatchObject({
        packetId: "r1110-consumer-input-spine",
        schemaVersion: null,
        status: "available",
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe upstream artifacts with a sanitized error", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1111-unsafe-"));
    try {
      const paths = await writeInputs(tmp, { ready: true });
      await writeJson(paths.r1099Path, {
        artifactBoundary: {
          ...safeBoundary(),
          rowValuesStored: true,
        },
        packetId: "r1099-consumer-lab-wearable-receipt-action-router",
        schemaVersion: "murph-age-r1099-consumer-lab-wearable-receipt-action-router.v1",
      });

      await expect(runR1111ConsumerAggregateReceiptRunbook({
        outputDir: path.join(tmp, "out"),
        ...paths,
      })).rejects.toThrow("R1111 rejected unsafe r1099 input: 1 aggregate-egress violation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1111-cli-"));
    try {
      const paths = await writeInputs(tmp, { ready: true });
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1111-consumer-aggregate-receipt-runbook.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1099_RECEIPT_ROUTER_PATH: paths.r1099Path,
          MURPH_AGE_R1101_CONSUMER_LOOP_EXECUTOR_PATH: paths.r1101Path,
          MURPH_AGE_R1105_CONSUMER_RECEIPT_TEMPLATE_PATH: paths.r1105Path,
          MURPH_AGE_R1109_ALL_OF_US_HANDOFF_PATH: paths.r1109Path,
          MURPH_AGE_R1110_CONSUMER_INPUT_SPINE_PATH: paths.r1110Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        productDisplayAuthorized: boolean;
        routePriority: string[];
      };
      expect(summary).toMatchObject({
        conclusion: "consumer_aggregate_receipt_runbook_ready",
        productDisplayAuthorized: false,
        routePriority: [
          "all_of_us_workbench_aggregate",
          "cardia_authorized_or_aggregate",
          "partner_aggregate_evaluator",
          "nhanes_activity_shadow",
          "midus_biomarker_mortality_shadow",
          "ukb_integrated_support",
        ],
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("participant");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeInputs(tmp: string, options: { ready: boolean; staleRouteOrder?: boolean }): Promise<{
  r1099Path: string;
  r1101Path: string;
  r1105Path: string;
  r1109Path: string;
  r1110Path: string;
}> {
  const paths = {
    r1099Path: path.join(tmp, "r1099.json"),
    r1101Path: path.join(tmp, "r1101.json"),
    r1105Path: path.join(tmp, "r1105.json"),
    r1109Path: path.join(tmp, "r1109.json"),
    r1110Path: path.join(tmp, "r1110.json"),
  };
  const routeTargets = options.staleRouteOrder
    ? ["partner-aggregate-evaluator", "all-of-us-fitbit-labs-ehr"]
    : ["all-of-us-fitbit-labs-ehr", "cardia-authorized-or-aggregate", "partner-aggregate-evaluator"];
  await Promise.all([
    writeJson(paths.r1099Path, {
      artifactBoundary: safeBoundary(),
      nextLoop: { routeTargets },
      packetId: "r1099-consumer-lab-wearable-receipt-action-router",
      schemaVersion: "murph-age-r1099-consumer-lab-wearable-receipt-action-router.v1",
      summary: {
        conclusion: options.ready
          ? "await_consumer_lab_wearable_aggregate_receipt"
          : "repair_consumer_direction_or_template",
      },
    }),
    writeJson(paths.r1101Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1101-consumer-labs-wearables-loop-executor",
      schemaVersion: "murph-age-r1101-consumer-labs-wearables-loop-executor.v1",
      summary: {
        conclusion: options.ready
          ? "consumer_loop_ready_awaiting_aggregate_receipt"
          : "consumer_loop_repair_inputs",
      },
    }),
    writeJson(paths.r1105Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1105-consumer-aggregate-receipt-template",
      receiptTemplateArtifact: "r1105-fillable-consumer-aggregate-receipt-template.json",
      schemaVersion: "murph-age-r1105-consumer-aggregate-receipt-template.v1",
      summary: {
        templateReadyForDataFill: options.ready,
      },
    }),
    writeJson(paths.r1109Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1109-all-of-us-aggregate-handoff",
      schemaVersion: "murph-age-r1109-all-of-us-aggregate-handoff.v1",
      summary: {
        conclusion: options.ready
          ? "all_of_us_aggregate_handoff_ready"
          : "all_of_us_aggregate_handoff_waiting_on_router_or_template",
      },
    }),
    writeJson(paths.r1110Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1110-consumer-input-spine",
      schemaVersion: "murph-age-r1110-consumer-input-spine.v1",
      summary: {
        conclusion: options.ready
          ? "consumer_lab_wearable_spine_ready"
          : "waiting_on_upstream_consumer_artifacts",
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
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
