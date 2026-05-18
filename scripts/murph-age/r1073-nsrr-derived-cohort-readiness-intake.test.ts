import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1073_NSRR_DERIVED_COHORT_READINESS_INTAKE_SCHEMA_VERSION,
  runR1073NsrrDerivedCohortReadinessIntake,
} from "./r1073-nsrr-derived-cohort-readiness-intake.ts";

describe("R1073 NSRR derived cohort readiness intake", () => {
  it("keeps NSRR blocked when no derived cohort files are detected", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1073-empty-"));
    try {
      const { output, outputPath } = await runR1073NsrrDerivedCohortReadinessIntake({
        createdAt: "2026-05-14T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        scanRoots: [],
      });

      expect(path.basename(outputPath)).toBe("r1073-nsrr-derived-cohort-readiness-intake.latest.json");
      expect(output.schemaVersion).toBe(R1073_NSRR_DERIVED_COHORT_READINESS_INTAKE_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "nsrr_download_or_outcome_still_missing",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1073: false,
      });
      expect(output.globalReadiness).toMatchObject({
        nextAction: "download_nsrr_derived_covariate_sleep_outcome_files",
        preferredReadyCohort: null,
        reviewGptRequiredNow: false,
        status: "blocked_download_or_outcome_missing",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("detects a ready SHHS derived archive without storing archive entries", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1073-shhs-"));
    try {
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      await writeZip(scanRoot, "nsrr-shhs-derived.zip", {
        "shhs/datasets/shhs1-dataset-0.21.0.csv": "",
        "shhs/datasets/shhs-cvd-events-dataset-0.21.0.csv": "",
        "shhs/datasets/shhs-data-dictionary-0.21.0-variables.csv": "",
      });

      const { output } = await runR1073NsrrDerivedCohortReadinessIntake({
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
      });

      expect(output.summary.conclusion).toBe("nsrr_cohort_ready_for_local_receipt");
      expect(output.globalReadiness).toMatchObject({
        nextAction: "prepare_nsrr_local_materializer_or_fill_aggregate_receipt",
        preferredReadyCohort: "shhs",
        status: "ready_for_local_materializer_or_aggregate_receipt",
      });
      const shhs = output.cohortReadiness.find((row) => row.cohortId === "shhs");
      expect(shhs).toMatchObject({
        readinessStatus: "ready_for_local_materializer_or_aggregate_receipt",
      });
      expect(shhs?.roleFamilies.baseline_covariates.status).toBe("detected");
      expect(shhs?.roleFamilies.derived_sleep_activity_or_autonomic.status).toBe("detected");
      expect(shhs?.roleFamilies.outcome_or_followup.status).toBe("detected");
      expect(output.scanSummary.zipArchiveCountBand).toBe("1-9");

      const encoded = JSON.stringify(output);
      expect(encoded).not.toContain(tmp);
      expect(encoded).not.toContain("shhs1-dataset");
      expect(encoded).not.toContain("shhs-cvd-events");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not let unrelated download noise consume the NSRR scan budget", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1073-noisy-"));
    try {
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      await Promise.all(Array.from({ length: 25 }, (_, index) =>
        writeFile(path.join(scanRoot, `unrelated-download-${index}.txt`), "")
      ));
      await writeZip(scanRoot, "shhs-derived-late.zip", {
        "shhs/datasets/shhs1-dataset-0.21.0.csv": "",
        "shhs/datasets/shhs-cvd-events-dataset-0.21.0.csv": "",
        "shhs/datasets/shhs-data-dictionary-0.21.0-variables.csv": "",
      });

      const { output } = await runR1073NsrrDerivedCohortReadinessIntake({
        maxFileLikeEntries: 4,
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
      });

      expect(output.summary.conclusion).toBe("nsrr_cohort_ready_for_local_receipt");
      expect(output.globalReadiness.preferredReadyCohort).toBe("shhs");
      expect(output.scanSummary.scanLimitHit).toBe(false);
      expect(output.scanSummary.fileLikeEntryScanCountBand).toBe("1-9");
      expect(JSON.stringify(output)).not.toContain("unrelated-download");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not let repeated raw-signal detections consume the readiness budget", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1073-raw-noise-"));
    try {
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      await Promise.all(Array.from({ length: 20 }, (_, index) =>
        writeFile(path.join(scanRoot, `mros-sleep-raw-signal-${index}.edf`), "")
      ));
      await writeZip(scanRoot, "shhs-derived-after-raw-noise.zip", {
        "shhs/datasets/shhs1-dataset-0.21.0.csv": "",
        "shhs/datasets/shhs-cvd-events-dataset-0.21.0.csv": "",
        "shhs/datasets/shhs-data-dictionary-0.21.0-variables.csv": "",
      });

      const { output } = await runR1073NsrrDerivedCohortReadinessIntake({
        maxFileLikeEntries: 5,
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
      });

      expect(output.summary.conclusion).toBe("nsrr_cohort_ready_for_local_receipt");
      expect(output.globalReadiness.preferredReadyCohort).toBe("shhs");
      expect(output.scanSummary.scanLimitHit).toBe(false);
      expect(JSON.stringify(output)).not.toContain("mros-sleep-raw-signal");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("keeps MESA blocked when sleep datasets exist but outcome follow-up is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1073-mesa-"));
    try {
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      await Promise.all([
        writeFile(path.join(scanRoot, "mesa-sleep-dataset-0.8.0.csv"), ""),
        writeFile(path.join(scanRoot, "mesa-data-dictionary-0.8.0-variables.csv"), ""),
      ]);

      const { output } = await runR1073NsrrDerivedCohortReadinessIntake({
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
      });

      const mesa = output.cohortReadiness.find((row) => row.cohortId === "mesa_sleep");
      expect(mesa).toMatchObject({
        readinessStatus: "blocked_missing_outcome_or_followup",
      });
      expect(mesa?.blockingReasons).toContain("outcome_or_followup_role_family_missing");
      expect(output.globalReadiness.status).toBe("blocked_download_or_outcome_missing");
      expect(JSON.stringify(output)).not.toContain("mesa-sleep-dataset");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("detects a ready HCHS/SOL derived archive without treating it as product-ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1073-hchs-"));
    try {
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      await writeZip(scanRoot, "nsrr-hchs-derived.zip", {
        "hchs/datasets/hchs-sol-baseline-dataset-0.7.0.csv": "",
        "hchs/actigraphy/hchs-sol-sueno-actigraphy-summary-0.7.0.csv": "",
        "hchs/datasets/hchs-sol-followup-events-dataset-0.7.0.csv": "",
        "hchs/datasets/hchs-data-dictionary-0.7.0-variables.csv": "",
      });

      const { output } = await runR1073NsrrDerivedCohortReadinessIntake({
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
      });

      const hchs = output.cohortReadiness.find((row) => row.cohortId === "hchs_sol");
      expect(hchs).toMatchObject({
        directRowParsingUnlocked: false,
        outcomeScoringUnlocked: false,
        readinessStatus: "ready_for_local_materializer_or_aggregate_receipt",
      });
      expect(hchs?.roleFamilies.baseline_covariates.status).toBe("detected");
      expect(hchs?.roleFamilies.derived_sleep_activity_or_autonomic.status).toBe("detected");
      expect(hchs?.roleFamilies.outcome_or_followup.status).toBe("detected");
      expect(output.globalReadiness.preferredReadyCohort).toBe("hchs_sol");
      expect(output.productDisplayAuthorized).toBe(false);

      const encoded = JSON.stringify(output);
      expect(encoded).not.toContain(tmp);
      expect(encoded).not.toContain("hchs-sol-baseline");
      expect(encoded).not.toContain("hchs-sol-followup");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not treat raw signal files alone as local execution readiness", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1073-raw-"));
    try {
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      await writeFile(path.join(scanRoot, "mesa-sleep-raw-signal.edf"), "");

      const { output } = await runR1073NsrrDerivedCohortReadinessIntake({
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
      });

      const mesa = output.cohortReadiness.find((row) => row.cohortId === "mesa_sleep");
      expect(mesa).toMatchObject({
        nextAction: "hold_raw_signal_files_until_derived_tables_exist",
        readinessStatus: "blocked_raw_signal_only",
      });
      expect(output.globalReadiness.status).toBe("blocked_download_or_outcome_missing");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1073-cli-"));
    try {
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1073-nsrr-derived-cohort-readiness-intake.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_NSRR_SCAN_ROOTS: scanRoot,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        packetId: string;
        preferredReadyCohort: string | null;
        productDisplayAuthorized: boolean;
        reviewGptRequiredNow: boolean;
      };
      expect(summary).toMatchObject({
        conclusion: "nsrr_download_or_outcome_still_missing",
        packetId: "r1073-nsrr-derived-cohort-readiness-intake",
        preferredReadyCohort: null,
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

async function writeZip(root: string, zipName: string, entries: Record<string, string>): Promise<void> {
  const staging = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1073-zip-"));
  try {
    await Promise.all(Object.entries(entries).map(async ([entryPath, content]) => {
      const fullPath = path.join(staging, entryPath);
      await mkdir(path.dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content);
    }));
    execFileSync("zip", ["-qr", path.join(root, zipName), "."], { cwd: staging });
    expect(await readFile(path.join(root, zipName))).toBeTruthy();
  } finally {
    await rm(staging, { force: true, recursive: true });
  }
}
