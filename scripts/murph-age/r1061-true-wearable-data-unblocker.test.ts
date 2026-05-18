import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1061_TRUE_WEARABLE_DATA_UNBLOCKER_SCHEMA_VERSION,
  runR1061TrueWearableDataUnblocker,
} from "./r1061-true-wearable-data-unblocker.ts";

describe("R1061 true wearable data unblocker", () => {
  it("states that true wearable aggregate data is the blocker after the NHANES bridge is refreshed", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1061-"));
    try {
      const paths = await writeInputs(tmp, "aggregate_receipt_missing");
      const { output, outputPath } = await runR1061TrueWearableDataUnblocker({
        createdAt: "2026-05-14T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1061-true-wearable-data-unblocker.latest.json");
      expect(output.schemaVersion).toBe(R1061_TRUE_WEARABLE_DATA_UNBLOCKER_SCHEMA_VERSION);
      expect(output.currentBlocker).toMatchObject({
        conclusion: "true_wearable_receipt_missing",
        localDownloadsNeed: "no_more_public_activity_downloads_needed_for_current_bridge",
        nextLocalAction: "await_or_collect_true_wearable_aggregate_receipt",
        reviewGptRequiredBeforeNextLocalRun: false,
      });
      expect(output.summary).toMatchObject({
        bestUserDataAsk: "controlled_workbench_or_local_data_holder_aggregate_receipt",
        publicActivityBridgeStatus: "wrist_shadow_inconclusive_keep_shadow",
        productDisplayAuthorized: false,
        trueWearableReceiptStatus: "missing",
      });
      expect(output.dataAcquisitionPriority[0]).toMatchObject({
        route: "controlled_workbench_aggregate",
        sourceId: "all_of_us_fitbit_labs_ehr_workbench",
      });
      expect(output.minimumReceiptShape.requiredCandidateIds).toContain("C5_lab_bp_body_plus_activity_sleep_rhr");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = JSON.parse(await readFile(outputPath, "utf8")) as unknown;
      expect(findForbiddenAggregateEgress(persisted)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes a ready true wearable receipt to ReviewGPT without asking for more local downloads", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1061-ready-"));
    try {
      const paths = await writeInputs(tmp, "aggregate_receipt_ready_for_reviewgpt");
      const { output } = await runR1061TrueWearableDataUnblocker({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.currentBlocker).toMatchObject({
        conclusion: "true_wearable_receipt_ready_for_reviewgpt",
        nextLocalAction: "send_existing_true_wearable_delta_to_reviewgpt",
        reviewGptRequiredBeforeNextLocalRun: true,
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1061-cli-"));
    try {
      const paths = await writeInputs(tmp, "aggregate_receipt_missing");
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1061-true-wearable-data-unblocker.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1038_NHANES_ACTIVITY_PATH: paths.r1038Path,
          MURPH_AGE_R1058_TRUE_WEARABLE_READINESS_PATH: paths.r1058Path,
          MURPH_AGE_R1059_TRUE_WEARABLE_RECEIPT_INTAKE_PATH: paths.r1059Path,
          MURPH_AGE_R1060_LOCAL_SOURCE_INVENTORY_PATH: paths.r1060Path,
          MURPH_AGE_R1067_WRIST_FINAL_STRESS_PATH: paths.r1067Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        packetId: string;
        productDisplayAuthorized: boolean;
        trueWearableReceiptStatus: string;
      };
      expect(summary).toMatchObject({
        conclusion: "true_wearable_receipt_missing",
        packetId: "r1061-true-wearable-data-unblocker",
        productDisplayAuthorized: false,
        publicActivityBridgeStatus: "wrist_shadow_inconclusive_keep_shadow",
        trueWearableReceiptStatus: "missing",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("rowValues");
      expect(stdout).not.toContain("localPaths");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeInputs(
  tmp: string,
  r1059Conclusion: "aggregate_receipt_missing" | "aggregate_receipt_ready_for_reviewgpt",
): Promise<{ r1038Path: string; r1058Path: string; r1059Path: string; r1060Path: string; r1067Path: string }> {
  const r1038Path = path.join(tmp, "r1038.json");
  const r1058Path = path.join(tmp, "r1058.json");
  const r1059Path = path.join(tmp, "r1059.json");
  const r1060Path = path.join(tmp, "r1060.json");
  const r1067Path = path.join(tmp, "r1067.json");
  await Promise.all([
    writeJson(r1038Path, {
      artifactBoundary: aggregateBoundary(),
      packetId: "r1038-nhanes-modern-lab-activity-loop",
      schemaVersion: "murph-age-r1038-nhanes-modern-lab-activity-loop.v1",
      summary: {
        conclusion: "activity_signal_shadow_hold_for_calibration_or_external_validation",
        productDisplayAuthorized: false,
        rowValuesStored: false,
      },
    }),
    writeJson(r1058Path, {
      artifactBoundary: aggregateBoundary(),
      handoffPackage: {
        candidateFamilies: [
          { candidateId: "C0_age_sex" },
          { candidateId: "C1_source_clinical_base" },
          { candidateId: "C2_lab5_or_lab9_bp_body" },
          { candidateId: "C3_lab_bp_body_plus_activity_28d" },
          { candidateId: "C4_lab_bp_body_plus_activity_sleep_28d" },
          { candidateId: "C5_lab_bp_body_plus_activity_sleep_rhr" },
          { candidateId: "C6_lab_bp_body_plus_activity_sleep_rhr_hrv_quality_gated" },
          { candidateId: "C7_wearable_coverage_quality_only_negative_control" },
          { candidateId: "C8_shuffled_wearable_negative_control" },
        ],
      },
      packetId: "r1058-true-wearable-partner-validation-readiness",
      schemaVersion: "murph-age-r1058-true-wearable-partner-validation-readiness.v1",
    }),
    writeJson(r1059Path, {
      artifactBoundary: aggregateBoundary(),
      packetId: "r1059-true-wearable-aggregate-receipt-intake",
      schemaVersion: "murph-age-r1059-true-wearable-aggregate-receipt-intake.v1",
      summary: {
        conclusion: r1059Conclusion,
        productDisplayAuthorized: false,
      },
    }),
    writeJson(r1060Path, {
      artifactBoundary: aggregateBoundary(),
      packetId: "r1060-local-true-wearable-source-inventory",
      schemaVersion: "murph-age-r1060-local-true-wearable-source-inventory.v1",
      summary: {
        conclusion: "no_local_true_wearable_outcome_source_detected",
        productDisplayAuthorized: false,
      },
    }),
    writeJson(r1067Path, {
      artifactBoundary: aggregateBoundary(),
      packetId: "r1067-nhanes-wrist-final-stress-test",
      schemaVersion: "murph-age-r1067-nhanes-wrist-final-stress-test.v1",
      summary: {
        conclusion: "activity_wear_signal_unstable_keep_shadow",
        productDisplayAuthorized: false,
        rowValuesStored: false,
        usableAsConsumerWearableValidation: false,
      },
    }),
  ]);
  return { r1038Path, r1058Path, r1059Path, r1060Path, r1067Path };
}

function aggregateBoundary(): Record<string, boolean> {
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
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
