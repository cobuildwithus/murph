import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1074_TRUE_WEARABLE_POST_DOWNLOAD_REFRESH_SCHEMA_VERSION,
  runR1074TrueWearablePostDownloadRefresh,
} from "./r1074-true-wearable-post-download-refresh.ts";

describe("R1074 true wearable post-download refresh", () => {
  it("refreshes the chain and remains blocked on data when no NSRR cohort is ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1074-empty-"));
    try {
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      const fixturePaths = await writeFixtures(tmp);
      const { output, outputPath } = await runR1074TrueWearablePostDownloadRefresh({
        createdAt: "2026-05-14T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
        ...fixturePaths,
      });

      expect(path.basename(outputPath)).toBe("r1074-true-wearable-post-download-refresh.latest.json");
      expect(output.schemaVersion).toBe(R1074_TRUE_WEARABLE_POST_DOWNLOAD_REFRESH_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "post_download_refresh_blocked_on_data",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1074: false,
      });
      expect(output.finalHandoff).toMatchObject({
        nextAction: "download_nsrr_derived_files_or_secure_workbench_access",
        reviewGptRequiredNow: false,
      });
      expect(output.refreshSteps.map((step) => step.packetId)).toEqual([
        "r1068-true-wearable-source-activation-matrix",
        "r1069-nsrr-derived-role-activation",
        "r1073-nsrr-derived-cohort-readiness-intake",
        "r1070-nsrr-sleep-autonomic-aggregate-receipt",
        "r1071-nsrr-validation-readiness-reducer",
        "r1072-true-wearable-validation-handoff-bundle",
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("switches to receipt fill when a derived NSRR cohort is ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1074-ready-"));
    try {
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      await writeZip(scanRoot, "nsrr-shhs-derived.zip", {
        "shhs/datasets/shhs1-dataset-0.21.0.csv": "",
        "shhs/datasets/shhs-cvd-events-dataset-0.21.0.csv": "",
        "shhs/datasets/shhs-data-dictionary-0.21.0-variables.csv": "",
      });
      const fixturePaths = await writeFixtures(tmp);

      const { output } = await runR1074TrueWearablePostDownloadRefresh({
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
        ...fixturePaths,
      });

      expect(output.summary.conclusion).toBe("post_download_refresh_blocked_on_receipt");
      expect(output.finalHandoff).toMatchObject({
        nextAction: "fill_nsrr_aggregate_receipt",
        reviewGptRequiredNow: false,
      });
      expect(output.finalHandoff.dataAsk).toContain("shhs");
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(output)).not.toContain("shhs1-dataset");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1074-cli-"));
    try {
      const scanRoot = path.join(tmp, "scan");
      await mkdir(scanRoot);
      const fixturePaths = await writeFixtures(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1074-true-wearable-post-download-refresh.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_NSRR_SCAN_ROOTS: scanRoot,
          MURPH_AGE_R1059_TRUE_WEARABLE_RECEIPT_INTAKE_PATH: fixturePaths.r1059Path,
          MURPH_AGE_R1061_TRUE_WEARABLE_DATA_UNBLOCKER_PATH: fixturePaths.r1061Path,
          MURPH_AGE_R1062_TRUE_WEARABLE_RECEIPT_TEMPLATE_PATH: fixturePaths.r1062Path,
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
        conclusion: "post_download_refresh_blocked_on_data",
        packetId: "r1074-true-wearable-post-download-refresh",
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

async function writeFixtures(tmp: string): Promise<{ r1059Path: string; r1061Path: string; r1062Path: string }> {
  const r1059Path = path.join(tmp, "r1059.json");
  const r1061Path = path.join(tmp, "r1061.json");
  const r1062Path = path.join(tmp, "r1062.json");
  await Promise.all([
    writeFile(r1059Path, `${JSON.stringify({
      artifactBoundary: safeBoundary(),
      packetId: "r1059-true-wearable-aggregate-receipt-intake",
      schemaVersion: "murph-age-r1059-true-wearable-aggregate-receipt-intake.v1",
      status: "research-local-aggregate-only",
      summary: {
        conclusion: "aggregate_receipt_missing",
        productDisplayAuthorized: false,
      },
    })}\n`),
    writeFile(r1061Path, `${JSON.stringify({
      artifactBoundary: safeBoundary(),
      packetId: "r1061-true-wearable-data-unblocker",
      schemaVersion: "murph-age-r1061-true-wearable-data-unblocker.v1",
      status: "research-local-aggregate-only",
      summary: {
        productDisplayAuthorized: false,
        publicActivityBridgeStatus: "wrist_shadow_inconclusive_keep_shadow",
      },
    })}\n`),
    writeFile(r1062Path, `${JSON.stringify({
      artifactBoundary: safeBoundary(),
      packetId: "r1062-true-wearable-aggregate-receipt-template",
      receiptTemplateArtifact: "r1062-fillable-aggregate-receipt-template.json",
      schemaVersion: "murph-age-r1062-true-wearable-aggregate-receipt-template.v1",
      status: "research-local-aggregate-only",
      summary: {
        productDisplayAuthorized: false,
        templateReadyForDataFill: true,
      },
    })}\n`),
  ]);
  return { r1059Path, r1061Path, r1062Path };
}

async function writeZip(root: string, zipName: string, entries: Record<string, string>): Promise<void> {
  const staging = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1074-zip-"));
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

function safeBoundary() {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
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
