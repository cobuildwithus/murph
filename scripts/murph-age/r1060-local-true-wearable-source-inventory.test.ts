import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1060_LOCAL_TRUE_WEARABLE_SOURCE_INVENTORY_SCHEMA_VERSION,
  runR1060LocalTrueWearableSourceInventory,
} from "./r1060-local-true-wearable-source-inventory.ts";

describe("R1060 local true wearable source inventory", () => {
  it("does not misclassify transaction-style activity files as wearable health exports", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1060-"));
    try {
      const scanRoot = path.join(tmp, "downloads");
      await mkdir(scanRoot);
      await writeFile(path.join(scanRoot, "activity.csv"), "Date,Description,Amount\n2026-01-01,Coffee,5\n");
      await writeFile(path.join(scanRoot, "activity-2.csv"), "Date,Description,Amount,Category\n2026-01-01,Train,3,Travel\n");
      const paths = await writeInputs(tmp, "aggregate_receipt_missing");

      const { output, outputPath } = await runR1060LocalTrueWearableSourceInventory({
        createdAt: "2026-05-14T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1060-local-true-wearable-source-inventory.latest.json");
      expect(output.schemaVersion).toBe(R1060_LOCAL_TRUE_WEARABLE_SOURCE_INVENTORY_SCHEMA_VERSION);
      expect(output.scanSummary).toMatchObject({
        aggregateReceiptStatus: "missing",
        localOutcomeLabelLikeCsvCount: 0,
        localWearableHealthLikeCsvCount: 0,
        rootCountBand: "1-9",
        spreadsheetCandidateCount: 0,
        transactionLikeActivityFileCount: 2,
      });
      expect(output.summary).toMatchObject({
        conclusion: "no_local_true_wearable_outcome_source_detected",
        nextLocalAction: "await_or_collect_true_wearable_aggregate_receipt",
        reviewGptRequiredBeforeNextLocalRun: false,
      });
      expect(output.artifactBoundary).toMatchObject({
        fileNamesStored: false,
        localPathsStored: false,
        rowParsingPerformedByR1060: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);

      const roundTripped = JSON.parse(await readFile(outputPath, "utf8"));
      expect(roundTripped).toEqual(output);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("flags possible local wearable files as needing an outcome join", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1060-wearable-"));
    try {
      const scanRoot = path.join(tmp, "exports");
      await mkdir(scanRoot);
      await writeFile(path.join(scanRoot, "daily.csv"), "date,steps,resting_heart_rate,sleep_minutes\n2026-01-01,1000,60,420\n");
      await writeFile(path.join(scanRoot, "sleep.xlsx"), "not parsed by this metadata inventory\n");
      const paths = await writeInputs(tmp, "aggregate_receipt_missing");

      const { output } = await runR1060LocalTrueWearableSourceInventory({
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
        ...paths,
      });

      expect(output.scanSummary.localWearableHealthLikeCsvCount).toBe(1);
      expect(output.scanSummary.spreadsheetCandidateCount).toBe(1);
      expect(output.summary).toMatchObject({
        conclusion: "possible_local_wearable_files_need_outcome_join",
        nextLocalAction: "connect_wearable_files_to_outcome_source_before_r1059",
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("detects pulse and oxygen saturation exports as wearable-adjacent context", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1060-o2-"));
    try {
      const scanRoot = path.join(tmp, "exports");
      await mkdir(scanRoot);
      await writeFile(path.join(scanRoot, "o2ring.csv"), "time,pulse,spo2,oxygen_score\n2026-01-01T00:00:00Z,60,98,1\n");
      const paths = await writeInputs(tmp, "aggregate_receipt_missing");

      const { output } = await runR1060LocalTrueWearableSourceInventory({
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
        ...paths,
      });

      expect(output.scanSummary.localWearableHealthLikeCsvCount).toBe(1);
      expect(output.summary).toMatchObject({
        conclusion: "possible_local_wearable_files_need_outcome_join",
        nextLocalAction: "connect_wearable_files_to_outcome_source_before_r1059",
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes an already-ready receipt delta to ReviewGPT", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1060-ready-"));
    try {
      const paths = await writeInputs(tmp, "aggregate_receipt_ready_for_reviewgpt");

      const { output } = await runR1060LocalTrueWearableSourceInventory({
        outputDir: path.join(tmp, "out"),
        scanRoots: [],
        ...paths,
      });

      expect(output.scanSummary.aggregateReceiptStatus).toBe("ready_for_reviewgpt");
      expect(output.summary).toMatchObject({
        conclusion: "local_true_wearable_receipt_already_ready",
        nextLocalAction: "send_existing_receipt_delta_to_reviewgpt",
        reviewGptRequiredBeforeNextLocalRun: true,
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1060-cli-"));
    try {
      const scanRoot = path.join(tmp, "downloads");
      await mkdir(scanRoot);
      await writeFile(path.join(scanRoot, "activity.csv"), "Date,Description,Amount\n2026-01-01,Coffee,5\n");
      const paths = await writeInputs(tmp, "aggregate_receipt_missing");
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1060-local-true-wearable-source-inventory.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1058_VALIDATION_READINESS_PATH: paths.r1058Path,
          MURPH_AGE_R1059_RECEIPT_INTAKE_PATH: paths.r1059Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
          MURPH_AGE_WEARABLE_SOURCE_SCAN_ROOTS: scanRoot,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        aggregateReceiptStatus: "missing",
        conclusion: "no_local_true_wearable_outcome_source_detected",
        localWearableHealthLikeCsvCount: 0,
        nextLocalAction: "await_or_collect_true_wearable_aggregate_receipt",
        packetId: "r1060-local-true-wearable-source-inventory",
        productDisplayAuthorized: false,
        reviewGptRequiredBeforeNextLocalRun: false,
        rowParsingPerformedByR1060: false,
        schemaVersion: R1060_LOCAL_TRUE_WEARABLE_SOURCE_INVENTORY_SCHEMA_VERSION,
        spreadsheetCandidateCount: 0,
        status: "research-local-aggregate-only",
        transactionLikeActivityFileCount: 1,
      });
      expect(stdout).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeInputs(
  tmp: string,
  r1059Conclusion: "aggregate_receipt_missing" | "aggregate_receipt_ready_for_reviewgpt" | "aggregate_receipt_valid_but_no_delta",
): Promise<{ r1058Path: string; r1059Path: string }> {
  const r1058Path = path.join(tmp, "r1058.json");
  const r1059Path = path.join(tmp, "r1059.json");
  await writeFile(r1058Path, `${JSON.stringify({
    packetId: "r1058-true-wearable-partner-validation-readiness",
    schemaVersion: "murph-age-r1058-true-wearable-partner-validation-readiness.v1",
    status: "research-local-aggregate-only",
    summary: {
      currentLead: "function_activity_mobility_shadow",
      nextLoopFocus: "await_true_wearable_aggregate_receipt",
    },
  })}\n`);
  await writeFile(r1059Path, `${JSON.stringify({
    packetId: "r1059-true-wearable-aggregate-receipt-intake",
    schemaVersion: "murph-age-r1059-true-wearable-aggregate-receipt-intake.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: r1059Conclusion,
    },
  })}\n`);
  return { r1058Path, r1059Path };
}
