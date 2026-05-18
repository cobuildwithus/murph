import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1069_NSRR_DERIVED_ROLE_ACTIVATION_SCHEMA_VERSION,
  runR1069NsrrDerivedRoleActivation,
} from "./r1069-nsrr-derived-role-activation.ts";

describe("R1069 NSRR derived role activation", () => {
  it("asks for derived NSRR role families when no files are detected", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1069-empty-"));
    try {
      const r1068Path = await writeR1068(tmp);
      const { output, outputPath } = await runR1069NsrrDerivedRoleActivation({
        createdAt: "2026-05-14T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        r1068Path,
        scanRoots: [],
      });

      expect(path.basename(outputPath)).toBe("r1069-nsrr-derived-role-activation.latest.json");
      expect(output.schemaVersion).toBe(R1069_NSRR_DERIVED_ROLE_ACTIVATION_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "nsrr_derived_download_needed",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1069: false,
      });
      expect(output.rowExecutionReadiness).toMatchObject({
        nextAction: "download_nsrr_derived_covariate_sleep_outcome_files",
        outcomeScoringUnlocked: false,
        rowParsingUnlocked: false,
        status: "blocked_missing_derived_role_families",
      });
      expect(output.downloadRequest.targetCohorts[0]).toMatchObject({
        cohortId: "mesa_sleep",
        priority: 1,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("marks derived role families ready without unlocking row parsing or scoring", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1069-ready-"));
    try {
      const r1068Path = await writeR1068(tmp);
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      await Promise.all([
        writeFile(path.join(scanRoot, "mesa-sleep-baseline-covariates.csv"), ""),
        writeFile(path.join(scanRoot, "mesa-sleep-derived-actigraphy-summary.csv"), ""),
        writeFile(path.join(scanRoot, "mesa-sleep-outcomes-followup.csv"), ""),
        writeFile(path.join(scanRoot, "mesa-sleep-data-dictionary.pdf"), ""),
      ]);

      const { output } = await runR1069NsrrDerivedRoleActivation({
        outputDir: path.join(tmp, "out"),
        r1068Path,
        scanRoots: [scanRoot],
      });

      expect(output.summary.conclusion).toBe("nsrr_derived_role_families_ready_for_receipt_scaffold");
      expect(output.roleFamilyScan.roleFamilies.baseline_covariates).toMatchObject({
        fileCountBand: "1-9",
        status: "detected",
      });
      expect(output.roleFamilyScan.roleFamilies.derived_sleep_activity_or_autonomic.status).toBe("detected");
      expect(output.roleFamilyScan.roleFamilies.outcome_or_followup.status).toBe("detected");
      expect(output.rowExecutionReadiness).toMatchObject({
        nextAction: "prepare_nsrr_aggregate_receipt_scaffold",
        outcomeScoringUnlocked: false,
        rowParsingUnlocked: false,
        status: "metadata_role_families_ready_no_scoring",
      });
      expect(JSON.stringify(output)).not.toContain(scanRoot);
      expect(JSON.stringify(output)).not.toContain("mesa-sleep-baseline-covariates");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not treat raw signal files alone as useful near-term activation", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1069-raw-"));
    try {
      const r1068Path = await writeR1068(tmp);
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      await writeFile(path.join(scanRoot, "mesa-sleep-raw-signal.edf"), "");

      const { output } = await runR1069NsrrDerivedRoleActivation({
        outputDir: path.join(tmp, "out"),
        r1068Path,
        scanRoots: [scanRoot],
      });

      expect(output.summary.conclusion).toBe("nsrr_raw_signal_only_not_useful_yet");
      expect(output.roleFamilyScan.roleFamilies.raw_signal_only.status).toBe("detected");
      expect(output.rowExecutionReadiness).toMatchObject({
        nextAction: "hold_raw_signal_files_until_derived_tables_exist",
        status: "blocked_raw_signal_only",
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1069-cli-"));
    try {
      const r1068Path = await writeR1068(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1069-nsrr-derived-role-activation.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1068_TRUE_WEARABLE_SOURCE_ACTIVATION_PATH: r1068Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        outcomeScoringUnlocked: boolean;
        packetId: string;
        productDisplayAuthorized: boolean;
        rowParsingUnlocked: boolean;
      };
      expect(summary).toMatchObject({
        conclusion: "nsrr_derived_download_needed",
        outcomeScoringUnlocked: false,
        packetId: "r1069-nsrr-derived-role-activation",
        productDisplayAuthorized: false,
        rowParsingUnlocked: false,
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("localPaths");
      expect(stdout).not.toContain("rowValues");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeR1068(tmp: string): Promise<string> {
  const filePath = path.join(tmp, "r1068.json");
  await writeFile(filePath, `${JSON.stringify({
    artifactBoundary: {
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
    },
    packetId: "r1068-true-wearable-source-activation-matrix",
    schemaVersion: "murph-age-r1068-true-wearable-source-activation-matrix.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "true_wearable_sources_need_data_or_receipt",
      productDisplayAuthorized: false,
      rowParsingPerformedByR1068: false,
    },
  })}\n`);
  return filePath;
}
