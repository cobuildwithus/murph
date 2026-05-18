import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { runR1078NsrrSleepAutonomicLocalLoop } from "./r1078-nsrr-sleep-autonomic-local-loop.ts";
import {
  R1079_NSRR_SLEEP_AUTONOMIC_STANDARDIZER_SCHEMA_VERSION,
  runR1079NsrrSleepAutonomicStandardizer,
} from "./r1079-nsrr-sleep-autonomic-standardizer.ts";

describe("R1079 NSRR sleep/autonomic standardizer", () => {
  it("materializes a private column map into an R1078-compatible local cache without aggregate egress", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1079-run-"));
    const analyticCachePath = runtimeCachePath(tmp, "standardized.csv.gz");
    try {
      const sourcePath = path.join(tmp, "private-source.csv");
      const manifestPath = path.join(tmp, "private-manifest.json");
      await writePrivateSource(sourcePath, 480);
      await writeManifest(manifestPath, sourcePath, analyticCachePath);

      const { output, outputPath } = await runR1079NsrrSleepAutonomicStandardizer({
        createdAt: "2026-05-14T00:00:00.000Z",
        manifestPath,
        outputDir: path.join(tmp, "out"),
      });

      expect(path.basename(outputPath)).toBe("r1079-nsrr-sleep-autonomic-standardizer.latest.json");
      expect(output.schemaVersion).toBe(R1079_NSRR_SLEEP_AUTONOMIC_STANDARDIZER_SCHEMA_VERSION);
      expect(output.endpoint).toBe("all_cause_mortality");
      expect(output.horizon).toBe("10y");
      expect(output.summary).toMatchObject({
        analyticCacheMaterialized: true,
        productDisplayAuthorized: false,
        readyForR1078: true,
        reviewGptRequiredNow: false,
        rowValuesInExternalArtifact: false,
      });
      expect(output.nextStep).toMatchObject({
        conclusion: "nsrr_standard_cache_ready_for_r1078",
        nextLocalAction: "run_r1078_nsrr_sleep_autonomic_local_loop",
      });
      expect(output.artifactBoundary).toMatchObject({
        aggregateOnlyExternalOutput: true,
        localPathsStored: false,
        privateColumnMapRead: true,
        rowValuesStored: false,
        sourceSpecificColumnNamesStored: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const serialized = JSON.stringify(output);
      expect(serialized).not.toContain(tmp);
      expect(serialized).not.toContain("private-source.csv");
      expect(serialized).not.toContain("src_age");
      expect(serialized).not.toContain("src_event");
      expect(serialized).not.toContain("src_sleep_duration");
      expect(serialized).not.toContain("primary_event");
      expect(serialized).not.toContain("sleep_duration_hours");

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("src_age");
      expect(persisted).not.toContain("primary_event");

      const cacheCsv = gunzipSync(await readFile(analyticCachePath)).toString("utf8");
      expect(cacheCsv).toContain("primary_event");
      expect(cacheCsv).toContain("sleep_duration_hours");
      expect(cacheCsv).not.toContain("src_age");

      const r1078 = await runR1078NsrrSleepAutonomicLocalLoop({
        analyticCachePath,
        calibrationIterations: 120,
        createdAt: "2026-05-14T00:00:00.000Z",
        iterations: 180,
        outputDir: path.join(tmp, "r1078"),
      });
      expect(r1078.output.packetId).toBe("r1078-nsrr-sleep-autonomic-local-loop");
      expect(r1078.output.productDisplayAuthorized).toBe(false);
      expect(findForbiddenAggregateEgress(r1078.output)).toEqual([]);
    } finally {
      await rm(analyticCachePath, { force: true });
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed when the manifest is missing required generic mappings", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1079-bad-map-"));
    try {
      const sourcePath = path.join(tmp, "private-source.csv");
      const manifestPath = path.join(tmp, "private-manifest.json");
      await writePrivateSource(sourcePath, 120);
      await writeFile(manifestPath, `${JSON.stringify({
        columnMap: {
          age_years: "src_age",
          sex_stratum: "src_sex",
        },
        endpoint: "all_cause_mortality",
        horizon: "10y",
        schemaVersion: R1079_NSRR_SLEEP_AUTONOMIC_STANDARDIZER_SCHEMA_VERSION,
        sourceTablePath: sourcePath,
        splitPolicy: { type: "row_index_modulo" },
      })}\n`);

      await expect(runR1079NsrrSleepAutonomicStandardizer({
        manifestPath,
        outputDir: path.join(tmp, "out"),
      })).rejects.toThrow("missing a required generic mapping");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("reports sparse materialization without sending paths or source columns", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1079-sparse-"));
    const analyticCachePath = runtimeCachePath(tmp, "sparse.csv.gz");
    try {
      const sourcePath = path.join(tmp, "private-source.csv");
      const manifestPath = path.join(tmp, "private-manifest.json");
      await writePrivateSource(sourcePath, 40);
      await writeManifest(manifestPath, sourcePath, analyticCachePath);

      const { output } = await runR1079NsrrSleepAutonomicStandardizer({
        manifestPath,
        outputDir: path.join(tmp, "out"),
      });

      expect(output.summary.readyForR1078).toBe(false);
      expect(output.nextStep).toMatchObject({
        conclusion: "nsrr_standard_cache_materialized_but_sparse",
        nextLocalAction: "inspect_private_cache_coverage_before_scoring",
      });
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(output)).not.toContain("src_event");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(analyticCachePath, { force: true });
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1079-cli-"));
    const analyticCachePath = runtimeCachePath(tmp, "cli.csv.gz");
    try {
      const sourcePath = path.join(tmp, "private-source.csv");
      const manifestPath = path.join(tmp, "private-manifest.json");
      await writePrivateSource(sourcePath, 480);
      await writeManifest(manifestPath, sourcePath, analyticCachePath);

      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1079-nsrr-sleep-autonomic-standardizer.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_NSRR_STANDARDIZER_MANIFEST_PATH: manifestPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        analyticCacheMaterialized: boolean;
        packetId: string;
        readyForR1078: boolean;
        rowValuesInExternalArtifact: boolean;
      };
      expect(summary).toMatchObject({
        analyticCacheMaterialized: true,
        packetId: "r1079-nsrr-sleep-autonomic-standardizer",
        readyForR1078: true,
        rowValuesInExternalArtifact: false,
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("src_age");
      expect(stdout).not.toContain("primary_event");
    } finally {
      await rm(analyticCachePath, { force: true });
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects row-cache output paths outside the ignored runtime cache", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1079-unsafe-path-"));
    try {
      const sourcePath = path.join(tmp, "private-source.csv");
      const manifestPath = path.join(tmp, "private-manifest.json");
      await writePrivateSource(sourcePath, 120);
      await writeManifest(manifestPath, sourcePath, path.join(tmp, "unsafe.csv.gz"));

      await expect(runR1079NsrrSleepAutonomicStandardizer({
        manifestPath,
        outputDir: path.join(tmp, "out"),
      })).rejects.toThrow("ignored NSRR runtime cache root");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeManifest(manifestPath: string, sourcePath: string, analyticCachePath: string): Promise<void> {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify({
    columnMap: {
      age_years: "src_age",
      analysis_weight: { constant: 1 },
      apnea_hypopnea_index: "src_ahi",
      body_mass_index: "src_bmi",
      clinical_context_score: "src_clinical_context",
      diastolic_blood_pressure: "src_dbp",
      eligible_endpoint: { constant: 1 },
      heart_rate_variability: "src_hrv",
      mean_daily_activity: "src_activity",
      mean_spo2: "src_mean_spo2",
      min_spo2: "src_min_spo2",
      primary_event: "src_event",
      recording_minutes: "src_recording_minutes",
      resting_heart_rate: "src_rhr",
      sedentary_minutes: "src_sedentary",
      sex_stratum: "src_sex",
      sleep_duration_hours: "src_sleep_duration",
      sleep_efficiency: "src_sleep_efficiency",
      sleep_midpoint_variability: "src_midpoint_variability",
      sleep_regularity_index: "src_sleep_regularity",
      sleep_wake_transition_count: "src_transitions",
      split: "src_split",
      systolic_blood_pressure: "src_sbp",
      valid_night_count: "src_valid_nights",
      wear_time_minutes: "src_wear_time",
    },
    endpoint: "all_cause_mortality",
    horizon: "10y",
    outputAnalyticCachePath: analyticCachePath,
    schemaVersion: R1079_NSRR_SLEEP_AUTONOMIC_STANDARDIZER_SCHEMA_VERSION,
    sourceTablePath: sourcePath,
  })}\n`);
}

function runtimeCachePath(tmp: string, fileName: string): string {
  return path.join(
    process.cwd(),
    ".runtime",
    "cache",
    "murph-age",
    "nsrr-sleep-autonomic",
    "derived",
    "analytic",
    `${path.basename(tmp)}-${fileName}`,
  );
}

async function writePrivateSource(sourcePath: string, rowCount: number): Promise<void> {
  await mkdir(path.dirname(sourcePath), { recursive: true });
  const header = [
    "src_local_id",
    "src_split",
    "src_event",
    "src_age",
    "src_sex",
    "src_bmi",
    "src_sbp",
    "src_dbp",
    "src_clinical_context",
    "src_sleep_duration",
    "src_sleep_efficiency",
    "src_midpoint_variability",
    "src_sleep_regularity",
    "src_ahi",
    "src_mean_spo2",
    "src_min_spo2",
    "src_rhr",
    "src_hrv",
    "src_activity",
    "src_sedentary",
    "src_active_minutes",
    "src_transitions",
    "src_valid_nights",
    "src_recording_minutes",
    "src_wear_time",
  ];
  const rows = [header.join(",")];
  for (let index = 0; index < rowCount; index += 1) {
    const split = index < rowCount * 0.5 ? "train" : index < rowCount * 0.75 ? "calibration" : "test";
    const age = 42 + (index % 34);
    const male = index % 2;
    const adverse = ((index * 17) % 100) / 100 > 0.58 ? 1 : 0;
    const event = adverse + 0.015 * (age - 55) + 0.12 * male + (((index * 37) % 100) / 100 - 0.45) > 0.55
      ? 1
      : 0;
    rows.push([
      `local-${index}`,
      split,
      String(event),
      age.toFixed(1),
      male === 1 ? "M" : "F",
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
  await writeFile(sourcePath, `${rows.join("\n")}\n`);
}
