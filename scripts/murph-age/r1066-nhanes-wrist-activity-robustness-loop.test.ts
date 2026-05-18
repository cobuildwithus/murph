import { gzipSync } from "node:zlib";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1066_NHANES_WRIST_ACTIVITY_ROBUSTNESS_LOOP_SCHEMA_VERSION,
  runR1066NhanesWristActivityRobustnessLoop,
} from "./r1066-nhanes-wrist-activity-robustness-loop.ts";

describe("R1066 NHANES wrist activity robustness loop", () => {
  it("runs aggregate-only model comparisons from the private wrist cache", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1066-"));
    try {
      const cachePath = path.join(tmp, "analytic.csv.gz");
      await writeFile(cachePath, gzipSync(Buffer.from(syntheticPrivateCacheCsv(), "utf8")));
      const { output, outputPath, r1034ReceiptPath } = await runR1066NhanesWristActivityRobustnessLoop({
        analyticCachePath: cachePath,
        calibrationIterations: 25,
        bootstrapIterations: 5,
        createdAt: "2026-05-14T00:00:00.000Z",
        iterations: 35,
        outputDir: path.join(tmp, "out"),
      });

      expect(output.schemaVersion).toBe(R1066_NHANES_WRIST_ACTIVITY_ROBUSTNESS_LOOP_SCHEMA_VERSION);
      expect(output.benchmarkCardId).toBe("nhanes_wrist_lab_activity_mortality_5y_v1");
      expect(output.endpoint).toBe("5y_all_cause_mortality");
      expect(output.horizon).toBe("5y");
      expect(output.summary.productDisplayAuthorized).toBe(false);
      expect(output.summary.rowValuesStored).toBe(false);
      expect(output.summary.usableAsConsumerWearableValidation).toBe(false);
      expect(output.summary.primaryActivityVsLab9).not.toBeNull();
      expect(output.summary.robustness.uncertainty.bootstrapIterations).toBe(5);
      expect(output.candidateRuns.length).toBe(14);
      expect(output.r1034CompatibleReceipt.candidateMetrics.length).toBe(13);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const serialized = await readFile(outputPath, "utf8");
      const receipt = await readFile(r1034ReceiptPath, "utf8");
      expect(serialized).not.toContain("participant_key");
      expect(serialized).not.toContain("SEQN");
      expect(serialized).not.toContain("sample_weight_combined");
      expect(receipt).not.toContain("participant_key");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

function syntheticPrivateCacheCsv(): string {
  const header = [
    "participant_key",
    "cycle_id",
    "split",
    "sample_weight_combined",
    "primary_5y_event",
    "primary_5y_followup_months",
    "eligible_5y_endpoint",
    "age_years",
    "sex_stratum",
    "systolic_blood_pressure",
    "diastolic_blood_pressure",
    "body_mass_index",
    "waist_circumference",
    "albumin",
    "creatinine",
    "hba1c",
    "alkaline_phosphatase",
    "white_blood_cell_count",
    "lymphocyte_percent",
    "red_cell_distribution_width",
    "hdl_cholesterol",
    "triglycerides",
    "valid_day_count",
    "mean_daily_valid_minutes",
    "mean_daily_total_activity",
    "mean_daily_wake_wear_minutes",
    "mean_daily_sleep_wear_minutes",
    "mean_daily_nonwear_minutes",
    "activity_source_shape",
  ];
  const rows = Array.from({ length: 60 }, (_, index) => {
    const split = index % 10 < 6 ? "train" : index % 10 < 8 ? "calibration" : "test";
    const event = index % 6 === 0 ? 1 : 0;
    const age = 45 + (index % 30);
    const activity = event ? 220 + index : 420 + index;
    return [
      `private-${index}`,
      index % 2 === 0 ? "2011-2012" : "2013-2014",
      split,
      1,
      event,
      event ? 36 : 72,
      1,
      age,
      index % 2 === 0 ? "male" : "female",
      118 + (index % 12),
      72 + (index % 9),
      24 + (index % 8) * 0.4,
      84 + (index % 12),
      4.2,
      0.8 + (index % 4) * 0.1,
      5.2 + (index % 5) * 0.1,
      65 + (index % 20),
      5.5 + (index % 4) * 0.3,
      28 + (index % 8),
      12.5 + (index % 5) * 0.2,
      50 + (index % 10),
      95 + (index % 20),
      7,
      1300,
      activity,
      820,
      480,
      60,
      "wrist_2011_2014_mims_daily_summary_v0",
    ].join(",");
  });
  return `${[header.join(","), ...rows].join("\n")}\n`;
}
