import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1068_TRUE_WEARABLE_SOURCE_ACTIVATION_MATRIX_SCHEMA_VERSION,
  runR1068TrueWearableSourceActivationMatrix,
} from "./r1068-true-wearable-source-activation-matrix.ts";

describe("R1068 true wearable source activation matrix", () => {
  it("keeps the lane on true wearable data when no receipt or source files exist", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1068-empty-"));
    try {
      const paths = await writeInputs(tmp, "aggregate_receipt_missing");
      const { output, outputPath } = await runR1068TrueWearableSourceActivationMatrix({
        createdAt: "2026-05-14T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        r1059Path: paths.r1059Path,
        r1061Path: paths.r1061Path,
        scanRoots: [],
      });

      expect(path.basename(outputPath)).toBe("r1068-true-wearable-source-activation-matrix.latest.json");
      expect(output.schemaVersion).toBe(R1068_TRUE_WEARABLE_SOURCE_ACTIVATION_MATRIX_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "true_wearable_sources_need_data_or_receipt",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1068: false,
      });
      expect(output.nextBatch).toMatchObject({
        immediateAction: "await_or_collect_true_wearable_aggregate_receipt",
        nextUserDataAsk: "download_nsrr_derived_sleep_cohort_files_or_secure_allofus_workbench_access",
        reviewGptRequiredNow: false,
      });
      expect(output.sourceRows.find((row) => row.sourceId === "all_of_us_fitbit_labs_ehr_workbench")).toMatchObject({
        activationStatus: "blocked_need_access_or_confirmation",
        reviewGptRole: "none_local_scaffold",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("detects local NSRR-style derived files without storing names or paths", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1068-nsrr-"));
    try {
      const paths = await writeInputs(tmp, "aggregate_receipt_missing");
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      await Promise.all([
        writeFile(path.join(scanRoot, "mesa-sleep-derived-outcome-dataset.csv"), ""),
        writeFile(path.join(scanRoot, "mesa-sleep-raw-signal.edf"), ""),
      ]);

      const { output } = await runR1068TrueWearableSourceActivationMatrix({
        outputDir: path.join(tmp, "out"),
        r1059Path: paths.r1059Path,
        r1061Path: paths.r1061Path,
        scanRoots: [scanRoot],
      });

      expect(output.summary.conclusion).toBe("true_wearable_sources_need_nsrr_activation");
      expect(output.localScan).toMatchObject({
        nsrrDerivedCandidateFileCountBand: "1-9",
        nsrrRawSignalLikeFileCountBand: "1-9",
        rootCountBand: "1-9",
        scanned: true,
      });
      expect(output.nextBatch).toMatchObject({
        immediateAction: "prepare_nsrr_derived_file_activation",
        nextUserDataAsk: "point_codex_to_nsrr_derived_files_or_fill_aggregate_receipt",
        reviewGptRequiredNow: false,
      });
      expect(output.sourceRows.find((row) => row.sourceId === "nsrr_sleep_autonomic_outcome_cohorts")).toMatchObject({
        activationStatus: "derived_files_detected_need_endpoint_receipt",
        nextAction: "fill_or_collect_aggregate_receipt",
      });
      expect(JSON.stringify(output)).not.toContain(scanRoot);
      expect(JSON.stringify(output)).not.toContain("mesa-sleep-derived-outcome-dataset");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes a ready aggregate receipt to ReviewGPT instead of asking for more downloads", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1068-ready-"));
    try {
      const paths = await writeInputs(tmp, "aggregate_receipt_ready_for_reviewgpt");
      const { output } = await runR1068TrueWearableSourceActivationMatrix({
        outputDir: path.join(tmp, "out"),
        r1059Path: paths.r1059Path,
        r1061Path: paths.r1061Path,
      });

      expect(output.summary.conclusion).toBe("true_wearable_receipt_ready_for_reviewgpt");
      expect(output.nextBatch).toMatchObject({
        immediateAction: "send_existing_true_wearable_delta_to_reviewgpt",
        nextUserDataAsk: "no_more_user_downloads_receipt_ready_for_reviewgpt",
        reviewGptRequiredNow: true,
      });
      expect(output.sourceRows.every((row) =>
        row.sourceId === "personal_wearable_exports_schema_only"
          ? row.reviewGptRole === "none_local_scaffold"
          : row.reviewGptRole === "review_real_aggregate_delta"
      )).toBe(true);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1068-cli-"));
    try {
      const paths = await writeInputs(tmp, "aggregate_receipt_missing");
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1068-true-wearable-source-activation-matrix.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1059_TRUE_WEARABLE_RECEIPT_INTAKE_PATH: paths.r1059Path,
          MURPH_AGE_R1061_TRUE_WEARABLE_DATA_UNBLOCKER_PATH: paths.r1061Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        packetId: string;
        productDisplayAuthorized: boolean;
        reviewGptRequiredNow: boolean;
      };
      expect(summary).toMatchObject({
        conclusion: "true_wearable_sources_need_data_or_receipt",
        packetId: "r1068-true-wearable-source-activation-matrix",
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

async function writeInputs(
  tmp: string,
  r1059Conclusion: "aggregate_receipt_missing" | "aggregate_receipt_ready_for_reviewgpt",
): Promise<{ r1059Path: string; r1061Path: string }> {
  const r1059Path = path.join(tmp, "r1059.json");
  const r1061Path = path.join(tmp, "r1061.json");
  await writeFile(r1059Path, `${JSON.stringify({
    artifactBoundary: safeBoundary(),
    packetId: "r1059-true-wearable-aggregate-receipt-intake",
    schemaVersion: "murph-age-r1059-true-wearable-aggregate-receipt-intake.v1",
    summary: {
      conclusion: r1059Conclusion,
      productDisplayAuthorized: false,
    },
  })}\n`);
  await writeFile(r1061Path, `${JSON.stringify({
    artifactBoundary: safeBoundary(),
    packetId: "r1061-true-wearable-data-unblocker",
    schemaVersion: "murph-age-r1061-true-wearable-data-unblocker.v1",
    summary: {
      productDisplayAuthorized: false,
      publicActivityBridgeStatus: "wrist_shadow_inconclusive_keep_shadow",
      trueWearableReceiptStatus: r1059Conclusion === "aggregate_receipt_ready_for_reviewgpt" ? "ready_for_reviewgpt" : "missing",
    },
  })}\n`);
  return { r1059Path, r1061Path };
}

function safeBoundary(): Record<string, boolean> {
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
