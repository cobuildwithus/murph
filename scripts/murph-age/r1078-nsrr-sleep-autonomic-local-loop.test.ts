import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { runR1070NsrrSleepAutonomicAggregateReceipt } from "./r1070-nsrr-sleep-autonomic-aggregate-receipt.ts";
import {
  R1078_NSRR_SLEEP_AUTONOMIC_LOCAL_LOOP_SCHEMA_VERSION,
  runR1078NsrrSleepAutonomicLocalLoop,
} from "./r1078-nsrr-sleep-autonomic-local-loop.ts";

describe("R1078 NSRR sleep/autonomic local loop", () => {
  it("trains local aggregate candidates and emits a valid R1070 receipt without row egress", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1078-loop-"));
    try {
      const cachePath = path.join(tmp, "cache.csv.gz");
      await writeSyntheticAnalyticCache(cachePath, 480);

      const { output, outputPath, r1070ReceiptPath } = await runR1078NsrrSleepAutonomicLocalLoop({
        analyticCachePath: cachePath,
        calibrationIterations: 120,
        createdAt: "2026-05-14T00:00:00.000Z",
        iterations: 180,
        outputDir: path.join(tmp, "out"),
      });

      expect(path.basename(outputPath)).toBe("r1078-nsrr-sleep-autonomic-local-loop.latest.json");
      expect(path.basename(r1070ReceiptPath)).toBe("r1078-r1070-compatible-aggregate-receipt.latest.json");
      expect(output.schemaVersion).toBe(R1078_NSRR_SLEEP_AUTONOMIC_LOCAL_LOOP_SCHEMA_VERSION);
      expect(output.productDisplayAuthorized).toBe(false);
      expect(output.artifactBoundary).toMatchObject({
        aggregateOnly: true,
        coefficientsStored: false,
        localPathsStored: false,
        modelParametersStored: false,
        participantIdentifiersStored: false,
        predictionsStored: false,
        rowValuesStored: false,
        sourceBodiesStored: false,
      });
      expect(output.r1070CompatibleReceipt).toMatchObject({
        evaluatorId: "nsrr_sleep_autonomic_aggregate_evaluator_v1",
        featureSchemaVersion: "murph-age-nsrr-sleep-autonomic-feature-schema.v1",
        schemaVersion: "murph-age-nsrr-sleep-autonomic-aggregate-receipt.v1",
      });
      expect(output.r1070CompatibleReceipt.candidateMetrics.map((metric) => metric.candidateId)).toEqual([
        "N1_source_clinical_base",
        "N2_sleep_duration_regularity",
        "N3_sleep_breathing_autonomic",
        "N4_sleep_activity_autonomic_combo",
        "N5_coverage_quality_only_negative_control",
        "N6_shuffled_sleep_autonomic_negative_control",
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const encoded = JSON.stringify(output);
      expect(encoded).not.toContain(tmp);
      expect(encoded).not.toContain("analysis_weight");
      expect(encoded).not.toContain("primary_event");
      expect(encoded).not.toContain("source_column");

      const receipt = JSON.parse(await readFile(r1070ReceiptPath, "utf8"));
      const validated = await runR1070NsrrSleepAutonomicAggregateReceipt({
        aggregateReceipt: receipt,
        outputDir: path.join(tmp, "validated"),
      });
      expect(validated.output.inputReceipt.status).toBe("available");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed when the aggregate denominator is too small", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1078-small-"));
    try {
      const cachePath = path.join(tmp, "cache.csv.gz");
      await writeSyntheticAnalyticCache(cachePath, 40);

      await expect(runR1078NsrrSleepAutonomicLocalLoop({
        analyticCachePath: cachePath,
        outputDir: path.join(tmp, "out"),
      })).rejects.toThrow("at least 100 eligible rows and 10 events");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed before receipt emission when the test denominator is below the R1070 band", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1078-test-band-"));
    try {
      const cachePath = path.join(tmp, "cache.csv.gz");
      await writeSyntheticAnalyticCache(cachePath, 360);

      await expect(runR1078NsrrSleepAutonomicLocalLoop({
        analyticCachePath: cachePath,
        outputDir: path.join(tmp, "out"),
      })).rejects.toThrow("at least 100 test rows");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1078-cli-"));
    try {
      const cachePath = path.join(tmp, "cache.csv.gz");
      await writeSyntheticAnalyticCache(cachePath, 480);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1078-nsrr-sleep-autonomic-local-loop.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_NSRR_SLEEP_AUTONOMIC_ANALYTIC_CACHE_PATH: cachePath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        packetId: string;
        productDisplayAuthorized: boolean;
        receiptArtifact: string;
        rowValuesStored: boolean;
      };
      expect(summary).toMatchObject({
        packetId: "r1078-nsrr-sleep-autonomic-local-loop",
        productDisplayAuthorized: false,
        receiptArtifact: "r1078-r1070-compatible-aggregate-receipt.latest.json",
        rowValuesStored: false,
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("analysis_weight");
      expect(stdout).not.toContain("primary_event");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeSyntheticAnalyticCache(filePath: string, rowCount: number): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const header = [
    "split",
    "primary_event",
    "age_years",
    "sex_stratum",
    "analysis_weight",
    "eligible_endpoint",
    "body_mass_index",
    "systolic_blood_pressure",
    "diastolic_blood_pressure",
    "clinical_context_score",
    "sleep_duration_hours",
    "sleep_efficiency",
    "sleep_midpoint_variability",
    "sleep_regularity_index",
    "apnea_hypopnea_index",
    "mean_spo2",
    "min_spo2",
    "resting_heart_rate",
    "heart_rate_variability",
    "mean_daily_activity",
    "sedentary_minutes",
    "active_minutes",
    "sleep_wake_transition_count",
    "valid_night_count",
    "recording_minutes",
    "wear_time_minutes",
  ];
  const rows = [header.join(",")];
  for (let index = 0; index < rowCount; index += 1) {
    const split = index < rowCount * 0.5 ? "train" : index < rowCount * 0.75 ? "calibration" : "test";
    const age = 42 + (index % 34);
    const male = index % 2;
    const latent = ((index * 17) % 100) / 100;
    const adverse = latent > 0.58 ? 1 : 0;
    const physiologicSignal = adverse + 0.015 * (age - 55) + 0.12 * male;
    const event = physiologicSignal + (((index * 37) % 100) / 100 - 0.45) > 0.55 ? 1 : 0;
    rows.push([
      split,
      String(event),
      age.toFixed(1),
      male === 1 ? "male" : "female",
      "1",
      "1",
      (24 + 4 * adverse + (index % 5) * 0.2).toFixed(2),
      (116 + 8 * adverse + (index % 7)).toFixed(2),
      (72 + 3 * adverse + (index % 4)).toFixed(2),
      (0.2 * adverse + (index % 3) * 0.05).toFixed(3),
      (7.4 - 1.2 * adverse + (index % 4) * 0.05).toFixed(2),
      (0.91 - 0.12 * adverse + (index % 5) * 0.005).toFixed(3),
      (0.2 + 1.4 * adverse + (index % 5) * 0.02).toFixed(3),
      (0.82 - 0.22 * adverse + (index % 4) * 0.01).toFixed(3),
      (5 + 22 * adverse + (index % 8)).toFixed(2),
      (96 - 2 * adverse - (index % 3) * 0.1).toFixed(2),
      (90 - 5 * adverse - (index % 4) * 0.2).toFixed(2),
      (58 + 9 * adverse + (index % 5)).toFixed(2),
      (45 - 14 * adverse - (index % 6)).toFixed(2),
      (4200 - 1600 * adverse + (index % 9) * 10).toFixed(2),
      (470 + 90 * adverse + (index % 7)).toFixed(2),
      (42 - 18 * adverse + (index % 5)).toFixed(2),
      (8 + 5 * adverse + (index % 6)).toFixed(2),
      (5 + (index % 3)).toFixed(0),
      (430 + (index % 8) * 2).toFixed(2),
      (410 + (index % 9) * 2).toFixed(2),
    ].join(","));
  }
  await writeFile(filePath, gzipSync(`${rows.join("\n")}\n`));
}
