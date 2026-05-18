import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1112_CONSUMER_DATA_PRIORITY_ROUTER_SCHEMA_VERSION,
  runR1112ConsumerDataPriorityRouter,
} from "./r1112-consumer-data-priority-router.ts";

describe("R1112 consumer data priority router", () => {
  it("keeps All of Us/CARDIA aggregate receipt as the first score-bearing lab/wearable action", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1112-"));
    try {
      const paths = await writeInputs(tmp, {
        aggregateReceiptReady: false,
        localWearableCount: 1,
        runbookReady: true,
        spreadsheetCandidateCount: 0,
      });

      const { output, outputPath } = await runR1112ConsumerDataPriorityRouter({
        createdAt: "2026-05-15T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1112-consumer-data-priority-router.latest.json");
      expect(output.schemaVersion).toBe(R1112_CONSUMER_DATA_PRIORITY_ROUTER_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "consumer_lab_wearable_loop_blocked_on_outcome_linked_aggregate_receipt",
        localWearableFileSignal: "present_without_outcome_join",
        nextAction: "run_all_of_us_or_cardia_aggregate_receipt_first",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1112: false,
      });
      expect(output.dataPriority.consumerTarget).toMatchObject({
        firstPassInputPolicy: "average_consumer_submittable_labs_vitals_wearables_first",
        primaryAgeBand: "roughly_16_50",
      });
      expect(output.dataPriority.routes.map((route) => route.routeId)).toEqual([
        "all_of_us_or_cardia_aggregate",
        "local_wearable_file_join",
        "downloaded_aging_sources",
        "nhanes_or_historical_shadow",
      ]);
      expect(output.dataPriority.routes[0]).toMatchObject({
        role: "score_bearing_first",
        status: "ready_to_request_or_run",
      });
      expect(output.dataPriority.routes[1]).toMatchObject({
        role: "needs_outcome_join",
        status: "available_but_not_score_bearing",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes to science review only after an aggregate receipt is already ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1112-receipt-"));
    try {
      const paths = await writeInputs(tmp, {
        aggregateReceiptReady: true,
        localWearableCount: 0,
        runbookReady: true,
        spreadsheetCandidateCount: 0,
      });

      const { output } = await runR1112ConsumerDataPriorityRouter({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "consumer_aggregate_receipt_ready_for_science_review",
        localWearableFileSignal: "receipt_ready",
        nextAction: "validate_existing_aggregate_receipt_then_review_science_delta",
        reviewGptRequiredNow: true,
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits when the consumer runbook identity is stale", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1112-stale-"));
    try {
      const paths = await writeInputs(tmp, {
        aggregateReceiptReady: false,
        localWearableCount: 1,
        runbookReady: true,
        spreadsheetCandidateCount: 0,
      });
      await writeJson(paths.r1111Path, {
        artifactBoundary: safeBoundary(),
        packetId: "r1111-consumer-aggregate-receipt-runbook",
        schemaVersion: "murph-age-r1111-consumer-aggregate-receipt-runbook.future",
        summary: {
          conclusion: "consumer_aggregate_receipt_runbook_ready",
        },
      });

      const { output } = await runR1112ConsumerDataPriorityRouter({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary.conclusion).toBe("consumer_data_priority_waiting_on_runbook_or_inventory");
      expect(output.inputArtifacts.r1111).toMatchObject({
        packetId: "r1111-consumer-aggregate-receipt-runbook",
        schemaVersion: null,
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe upstream artifacts with a sanitized error", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1112-unsafe-"));
    try {
      const paths = await writeInputs(tmp, {
        aggregateReceiptReady: false,
        localWearableCount: 1,
        runbookReady: true,
        spreadsheetCandidateCount: 0,
      });
      await writeJson(paths.r1060Path, {
        artifactBoundary: {
          ...safeBoundary(),
          rowValuesStored: true,
        },
        packetId: "r1060-local-true-wearable-source-inventory",
        schemaVersion: "murph-age-r1060-local-true-wearable-source-inventory.v1",
      });

      await expect(runR1112ConsumerDataPriorityRouter({
        outputDir: path.join(tmp, "out"),
        ...paths,
      })).rejects.toThrow("R1112 rejected unsafe r1060 input: 1 aggregate-egress violation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("counts wearable spreadsheet candidates as local files needing an outcome join", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1112-spreadsheet-"));
    try {
      const paths = await writeInputs(tmp, {
        aggregateReceiptReady: false,
        localWearableCount: 0,
        runbookReady: true,
        spreadsheetCandidateCount: 2,
      });

      const { output } = await runR1112ConsumerDataPriorityRouter({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary.localWearableFileSignal).toBe("present_without_outcome_join");
      expect(output.dataPriority.routes[1]).toMatchObject({
        routeId: "local_wearable_file_join",
        status: "available_but_not_score_bearing",
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not request ReviewGPT when a receipt exists but prerequisites are stale", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1112-stale-receipt-"));
    try {
      const paths = await writeInputs(tmp, {
        aggregateReceiptReady: true,
        localWearableCount: 0,
        runbookReady: true,
        spreadsheetCandidateCount: 0,
      });
      await writeJson(paths.r1111Path, {
        artifactBoundary: safeBoundary(),
        packetId: "r1111-consumer-aggregate-receipt-runbook",
        schemaVersion: "murph-age-r1111-consumer-aggregate-receipt-runbook.future",
        summary: {
          conclusion: "consumer_aggregate_receipt_runbook_ready",
        },
      });

      const { output } = await runR1112ConsumerDataPriorityRouter({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "consumer_data_priority_waiting_on_runbook_or_inventory",
        nextAction: "regenerate_r1060_r1087_r1111_before_data_priority",
        reviewGptRequiredNow: false,
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("filters unsupported upstream consumer score-family strings", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1112-family-filter-"));
    try {
      const paths = await writeInputs(tmp, {
        aggregateReceiptReady: false,
        localWearableCount: 1,
        runbookReady: true,
        spreadsheetCandidateCount: 0,
      });
      await writeJson(paths.r1111Path, {
        artifactBoundary: safeBoundary(),
        handoff: {
          consumerTarget: {
            scoreCandidateFamilies: [
              "bloodwork_common_labs",
              "not_a_supported_family",
              "wearable_sleep",
            ],
          },
        },
        packetId: "r1111-consumer-aggregate-receipt-runbook",
        schemaVersion: "murph-age-r1111-consumer-aggregate-receipt-runbook.v1",
        summary: {
          conclusion: "consumer_aggregate_receipt_runbook_ready",
        },
      });

      const { output } = await runR1112ConsumerDataPriorityRouter({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.dataPriority.consumerTarget.scoreCandidateFamilies).toEqual([
        "bloodwork_common_labs",
        "wearable_sleep",
      ]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1112-cli-"));
    try {
      const paths = await writeInputs(tmp, {
        aggregateReceiptReady: false,
        localWearableCount: 1,
        runbookReady: true,
        spreadsheetCandidateCount: 0,
      });
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1112-consumer-data-priority-router.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1060_WEARABLE_INVENTORY_PATH: paths.r1060Path,
          MURPH_AGE_R1087_DOWNLOADED_SOURCE_FEASIBILITY_PATH: paths.r1087Path,
          MURPH_AGE_R1111_CONSUMER_RUNBOOK_PATH: paths.r1111Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        nextAction: string;
        productDisplayAuthorized: boolean;
      };
      expect(summary).toMatchObject({
        conclusion: "consumer_lab_wearable_loop_blocked_on_outcome_linked_aggregate_receipt",
        nextAction: "run_all_of_us_or_cardia_aggregate_receipt_first",
        productDisplayAuthorized: false,
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("participant");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeInputs(tmp: string, options: {
  aggregateReceiptReady: boolean;
  localWearableCount: number;
  runbookReady: boolean;
  spreadsheetCandidateCount: number;
}): Promise<{
  r1060Path: string;
  r1087Path: string;
  r1111Path: string;
}> {
  const paths = {
    r1060Path: path.join(tmp, "r1060.json"),
    r1087Path: path.join(tmp, "r1087.json"),
    r1111Path: path.join(tmp, "r1111.json"),
  };
  await Promise.all([
    writeJson(paths.r1060Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1060-local-true-wearable-source-inventory",
      scanSummary: {
        aggregateReceiptStatus: options.aggregateReceiptReady ? "ready_for_reviewgpt" : "missing",
        localWearableHealthLikeCsvCount: options.localWearableCount,
        spreadsheetCandidateCount: options.spreadsheetCandidateCount,
      },
      schemaVersion: "murph-age-r1060-local-true-wearable-source-inventory.v1",
    }),
    writeJson(paths.r1087Path, {
      artifactBoundary: safeBoundary(),
      downloadedSourceFeasibility: {
        sourceRows: [
          {
            sourceReadyStatus: "ready_for_existing_aggregate_loop",
          },
        ],
      },
      packetId: "r1087-downloaded-aging-source-feasibility",
      schemaVersion: "murph-age-r1087-downloaded-aging-source-feasibility.v1",
    }),
    writeJson(paths.r1111Path, {
      artifactBoundary: safeBoundary(),
      handoff: {
        consumerTarget: {
          scoreCandidateFamilies: [
            "bloodwork_common_labs",
            "vitals_body_composition",
            "wearable_activity",
            "wearable_sleep",
            "wearable_recovery",
          ],
        },
      },
      packetId: "r1111-consumer-aggregate-receipt-runbook",
      schemaVersion: "murph-age-r1111-consumer-aggregate-receipt-runbook.v1",
      summary: {
        conclusion: options.runbookReady
          ? "consumer_aggregate_receipt_runbook_ready"
          : "consumer_aggregate_receipt_runbook_waiting_on_upstream",
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
    splitMembershipStored: false,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
