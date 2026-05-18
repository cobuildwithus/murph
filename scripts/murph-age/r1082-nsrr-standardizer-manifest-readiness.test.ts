import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { R1079_NSRR_SLEEP_AUTONOMIC_STANDARDIZER_SCHEMA_VERSION } from "./r1079-nsrr-sleep-autonomic-standardizer.ts";
import {
  R1082_NSRR_STANDARDIZER_MANIFEST_READINESS_SCHEMA_VERSION,
  runR1082NsrrStandardizerManifestReadiness,
} from "./r1082-nsrr-standardizer-manifest-readiness.ts";

describe("R1082 NSRR standardizer manifest readiness", () => {
  it("marks a filled private manifest ready without source-column egress", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1082-ready-"));
    try {
      const sourcePath = path.join(tmp, "private-source.csv");
      const manifestPath = path.join(tmp, "private-manifest.json");
      await writePrivateSource(sourcePath);
      await writeManifest(manifestPath, sourcePath, runtimeCachePath(tmp, "ready.csv.gz"));

      const { output, outputPath } = await runR1082NsrrStandardizerManifestReadiness({
        createdAt: "2026-05-15T00:00:00.000Z",
        manifestPath,
        outputDir: path.join(tmp, "out"),
      });

      expect(path.basename(outputPath)).toBe("r1082-nsrr-standardizer-manifest-readiness.latest.json");
      expect(output.schemaVersion).toBe(R1082_NSRR_STANDARDIZER_MANIFEST_READINESS_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        productDisplayAuthorized: false,
        readyForR1079: true,
        reviewGptRequiredNow: false,
        rowValuesRead: false,
        sourceSpecificColumnNamesInExternalArtifact: false,
      });
      expect(output.nextStep).toMatchObject({
        conclusion: "nsrr_private_manifest_ready_for_r1079",
        nextLocalAction: "run_r1079_nsrr_sleep_autonomic_standardizer",
      });
      expect(output.manifestReadiness).toMatchObject({
        analyticCacheTargetAllowed: true,
        blockingReasonCodes: [],
        declaredEndpointSupported: true,
        declaredHorizonSupported: true,
        manifestSchemaSupported: true,
        sourceTableAccessible: true,
        splitPolicyDeclared: true,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const serialized = JSON.stringify(output);
      expect(serialized).not.toContain(tmp);
      expect(serialized).not.toContain("private-source.csv");
      expect(serialized).not.toContain("src_age");
      expect(serialized).not.toContain("src_event");

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("src_sleep_duration");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("reports an unfilled draft as not ready without leaking headers", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1082-draft-"));
    try {
      const sourcePath = path.join(tmp, "private-source.csv");
      const manifestPath = path.join(tmp, "draft-manifest.json");
      await writePrivateSource(sourcePath);
      await writeFile(manifestPath, `${JSON.stringify({
        availableSourceColumns: ["src_event", "src_age", "src_sex"],
        columnMap: {},
        endpoint: "fill_one_of_allowed_endpoint_values",
        horizon: "fill_one_of_allowed_horizon_values",
        outputAnalyticCachePath: runtimeCachePath(tmp, "draft.csv.gz"),
        schemaVersion: R1079_NSRR_SLEEP_AUTONOMIC_STANDARDIZER_SCHEMA_VERSION,
        sourceTablePath: sourcePath,
        splitPolicy: { type: "row_index_modulo" },
      })}\n`);

      const { output } = await runR1082NsrrStandardizerManifestReadiness({
        manifestPath,
        outputDir: path.join(tmp, "out"),
      });

      expect(output.summary.readyForR1079).toBe(false);
      expect(output.nextStep).toMatchObject({
        conclusion: "nsrr_private_manifest_needs_local_fill_or_repair",
        nextLocalAction: "fill_private_manifest_column_map_endpoint_horizon_then_rerun_r1082",
      });
      expect(output.manifestReadiness.blockingReasonCodes).toEqual([
        "endpoint_missing_or_unsupported",
        "horizon_missing_or_unsupported",
        "required_generic_mappings_incomplete",
      ]);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(output)).not.toContain("src_age");
      expect(JSON.stringify(output)).not.toContain("private-source.csv");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("flags unreadable source tables and unsafe cache targets without exposing paths", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1082-blocked-"));
    try {
      const missingSourcePath = path.join(tmp, "missing-source.csv");
      const unsafeCachePath = path.join(tmp, "unsafe.csv.gz");
      const manifestPath = path.join(tmp, "private-manifest.json");
      await writeManifest(manifestPath, missingSourcePath, unsafeCachePath);

      const { output } = await runR1082NsrrStandardizerManifestReadiness({
        manifestPath,
        outputDir: path.join(tmp, "out"),
      });

      expect(output.summary.readyForR1079).toBe(false);
      expect(output.manifestReadiness.blockingReasonCodes).toContain("source_table_unreadable");
      expect(output.manifestReadiness.blockingReasonCodes)
        .toContain("analytic_cache_target_outside_allowed_root");
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(output)).not.toContain("missing-source.csv");
      expect(JSON.stringify(output)).not.toContain("unsafe.csv.gz");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1082-cli-"));
    try {
      const sourcePath = path.join(tmp, "private-source.csv");
      const manifestPath = path.join(tmp, "private-manifest.json");
      await writePrivateSource(sourcePath);
      await writeManifest(manifestPath, sourcePath, runtimeCachePath(tmp, "cli.csv.gz"));
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1082-nsrr-standardizer-manifest-readiness.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_NSRR_STANDARDIZER_MANIFEST_PATH: manifestPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        packetId: string;
        readyForR1079: boolean;
        rowValuesRead: boolean;
        sourceSpecificColumnNamesInExternalArtifact: boolean;
      };
      expect(summary).toMatchObject({
        packetId: "r1082-nsrr-standardizer-manifest-readiness",
        readyForR1079: true,
        rowValuesRead: false,
        sourceSpecificColumnNamesInExternalArtifact: false,
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("src_age");
      expect(stdout).not.toContain("private-source.csv");
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

async function writePrivateSource(sourcePath: string): Promise<void> {
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, [
    [
      "src_local_id",
      "src_split",
      "src_event",
      "src_age",
      "src_sex",
      "src_sleep_duration",
      "src_ahi",
      "src_rhr",
      "src_activity",
    ].join(","),
    [
      "local-1",
      "train",
      "1",
      "72",
      "M",
      "6.5",
      "18",
      "64",
      "2100",
    ].join(","),
  ].join("\n") + "\n");
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
