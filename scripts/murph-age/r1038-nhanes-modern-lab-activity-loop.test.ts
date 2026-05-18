import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  assertR1038Safe,
  R1038_NHANES_MODERN_LAB_ACTIVITY_LOOP_SCHEMA_VERSION,
  runR1038NhanesModernLabActivityLoop,
} from "./r1038-nhanes-modern-lab-activity-loop.ts";

describe("R1038 NHANES modern lab/activity loop", () => {
  it("runs a local aggregate-only loop from a private analytic cache", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1038-"));
    try {
      const cachePath = path.join(tmp, "nhanes.csv.gz");
      await writeSyntheticCache(cachePath);
      const { output, r1034ReceiptPath } = await runR1038NhanesModernLabActivityLoop({
        analyticCachePath: cachePath,
        calibrationIterations: 30,
        createdAt: "2026-05-13T00:00:00.000Z",
        iterations: 40,
        outputDir: path.join(tmp, "out"),
      });

      expect(output.schemaVersion).toBe(R1038_NHANES_MODERN_LAB_ACTIVITY_LOOP_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.productDisplayAuthorized).toBe(false);
      expect(output.summary.productDisplayAuthorized).toBe(false);
      expect(output.summary.rowValuesStored).toBe(false);
      expect(output.candidateRuns.length).toBeGreaterThan(5);
      expect(output.r1034CompatibleReceipt.candidateMetrics.some((metric) =>
        metric.candidateId === "C8_lab9_hba1c_bp_body_activity_primary"
      )).toBe(true);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const receipt = JSON.parse(await readFile(r1034ReceiptPath, "utf8")) as unknown;
      expect(findForbiddenAggregateEgress(receipt)).toEqual([]);
      const serialized = JSON.stringify(output);
      expect(serialized).not.toContain("SEQN");
      expect(serialized).not.toContain("participant_key");
      expect(serialized).not.toContain("person-a");
      expect(serialized).not.toContain(cachePath);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed if product display mutates on", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1038-mutated-"));
    try {
      const cachePath = path.join(tmp, "nhanes.csv.gz");
      await writeSyntheticCache(cachePath);
      const { output } = await runR1038NhanesModernLabActivityLoop({
        analyticCachePath: cachePath,
        calibrationIterations: 10,
        iterations: 20,
        outputDir: path.join(tmp, "out"),
      });

      const unsafe: Record<string, unknown> = {
        ...output,
        productDisplayAuthorized: true,
      };

      expect(() => assertR1038Safe(unsafe as never)).toThrow("R1038 NHANES modern lab/activity loop failed safety validation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1038-cli-"));
    try {
      const cachePath = path.join(tmp, "nhanes.csv.gz");
      await writeSyntheticCache(cachePath);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1038-nhanes-modern-lab-activity-loop.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_NHANES_ANALYTIC_CACHE_PATH: cachePath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });
      const summary = JSON.parse(stdout) as {
        packetId: string;
        productDisplayAuthorized: boolean;
        rowValuesStored: boolean;
        status: string;
      };

      expect(summary.packetId).toBe("r1038-nhanes-modern-lab-activity-loop");
      expect(summary.productDisplayAuthorized).toBe(false);
      expect(summary.rowValuesStored).toBe(false);
      expect(summary.status).toBe("research-local-aggregate-only");
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("SEQN");
      expect(stdout).not.toContain("participant_key");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeSyntheticCache(filePath: string): Promise<void> {
  const header = [
    "SEQN",
    "cycle_id",
    "survey_years",
    "split",
    "sample_weight_combined",
    "primary_10y_event",
    "primary_10y_followup_months",
    "age_years",
    "sex_stratum",
    "systolic_blood_pressure",
    "diastolic_blood_pressure",
    "body_mass_index",
    "waist_circumference",
    "albumin",
    "creatinine",
    "glucose",
    "hba1c",
    "alkaline_phosphatase",
    "white_blood_cell_count",
    "lymphocyte_percent",
    "red_cell_distribution_width",
    "hdl_cholesterol",
    "triglycerides",
    "participant_key",
    "valid_day_count",
    "mean_daily_wear_minutes",
    "mean_daily_total_counts",
    "mean_daily_sedentary_minutes",
    "mean_daily_light_minutes",
    "mean_daily_mvpa_minutes",
    "mean_daily_activity_fragmentation",
    "eligible_activity_product_shape",
  ];
  const rows: string[] = [header.join(",")];
  for (let index = 0; index < 72; index += 1) {
    const split = index < 42 ? "train" : index < 56 ? "calibration" : "test";
    const event = index % 11 === 0 ? 1 : 0;
    const age = 42 + (index % 27);
    rows.push([
      `seq-${index}`,
      index % 2 === 0 ? "2003-2004" : "2005-2006",
      "2003-2006",
      split,
      String(1 + (index % 5) / 10),
      String(event),
      "120",
      String(age),
      index % 2 === 0 ? "male" : "female",
      String(112 + (index % 17)),
      String(68 + (index % 9)),
      String(22 + (index % 14) / 2),
      String(78 + (index % 20)),
      String(3.8 + (index % 8) / 10),
      String(0.7 + (index % 5) / 10),
      String(85 + (index % 30)),
      String(5.1 + (index % 10) / 10),
      String(55 + (index % 35)),
      String(4.5 + (index % 8) / 10),
      String(22 + (index % 18)),
      String(12 + (index % 6) / 10),
      String(42 + (index % 19)),
      String(90 + (index % 80)),
      `person-${index}`,
      String(4 + (index % 4)),
      String(850 + (index % 80)),
      String(180000 + index * 3500),
      String(420 + (index % 90)),
      String(190 + (index % 60)),
      String(18 + (index % 30)),
      String(0.22 + (index % 20) / 100),
      "1",
    ].join(","));
  }
  await writeFile(filePath, gzipSync(`${rows.join("\n")}\n`));
}
