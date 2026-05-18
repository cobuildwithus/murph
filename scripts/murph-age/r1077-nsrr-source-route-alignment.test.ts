import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1077_NSRR_SOURCE_ROUTE_ALIGNMENT_SCHEMA_VERSION,
  runR1077NsrrSourceRouteAlignment,
} from "./r1077-nsrr-source-route-alignment.ts";

describe("R1077 NSRR source-route alignment", () => {
  it("keeps preferred NSRR routes aligned while downloads are still missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1077-blocked-"));
    try {
      const r1073Path = path.join(tmp, "r1073.json");
      await writeFile(r1073Path, `${JSON.stringify(r1073Fixture(null))}\n`);

      const { output, outputPath } = await runR1077NsrrSourceRouteAlignment({
        createdAt: "2026-05-14T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        r1073Path,
      });

      expect(path.basename(outputPath)).toBe("r1077-nsrr-source-route-alignment.latest.json");
      expect(output.schemaVersion).toBe(R1077_NSRR_SOURCE_ROUTE_ALIGNMENT_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "nsrr_preferred_routes_aligned_blocked_on_downloads",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1077: false,
      });
      expect(output.cohortRouteAlignment.find((row) => row.cohortId === "mesa_sleep")).toMatchObject({
        routeFound: true,
        routeId: "nsrr-mesa-sleep-autonomic",
        routeProductAuthorized: false,
      });
      expect(output.cohortRouteAlignment.find((row) => row.cohortId === "shhs")).toMatchObject({
        routeFound: true,
        routeId: "nsrr-shhs-sleep-heart-health",
      });
      expect(output.cohortRouteAlignment.find((row) => row.cohortId === "hchs_sol")).toMatchObject({
        routeFound: true,
        routeId: "nsrr-hchs-sol-sleep-actigraphy",
      });
      expect(output.cohortRouteAlignment.find((row) => row.cohortId === "mros_sleep")).toMatchObject({
        routeFound: true,
        routeId: "nsrr-mros-sleep-aging",
      });
      expect(output.cohortRouteAlignment.find((row) => row.cohortId === "sof_sleep")).toMatchObject({
        routeFound: true,
        routeId: "nsrr-sof-sleep-aging",
      });
      expect(output.nextStep.commands).toContain("pnpm exec tsx scripts/murph-age/r1076-current-autoresearch-loop-executor.ts");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);

      const persisted = JSON.parse(await readFile(outputPath, "utf8")) as unknown;
      expect(findForbiddenAggregateEgress(persisted)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes a ready SHHS cohort to the NSRR aggregate receipt path", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1077-ready-"));
    try {
      const r1073Path = path.join(tmp, "r1073.json");
      await writeFile(r1073Path, `${JSON.stringify(r1073Fixture("shhs"))}\n`);

      const { output } = await runR1077NsrrSourceRouteAlignment({
        outputDir: path.join(tmp, "out"),
        r1073Path,
      });

      expect(output.summary.conclusion).toBe("nsrr_ready_route_aligned_fill_receipt");
      expect(output.nextStep).toMatchObject({
        preferredReadyCohort: "shhs",
        preferredReadyRouteId: "nsrr-shhs-sleep-heart-health",
        reviewGptRequiredNow: false,
      });
      expect(output.cohortRouteAlignment.find((row) => row.cohortId === "shhs")).toMatchObject({
        nextAction: "fill_nsrr_aggregate_receipt",
        routeFound: true,
        routeProductAuthorized: false,
      });
      expect(output.nextStep.commands[0]).toContain("MURPH_AGE_NSRR_AGGREGATE_RECEIPT_PATH");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed when a future ready cohort lacks a durable route", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1077-missing-route-"));
    try {
      const r1073Path = path.join(tmp, "r1073.json");
      await writeFile(r1073Path, `${JSON.stringify(r1073Fixture("future_sleep"))}\n`);

      const { output } = await runR1077NsrrSourceRouteAlignment({
        outputDir: path.join(tmp, "out"),
        r1073Path,
      });

      expect(output.summary.conclusion).toBe("nsrr_ready_route_missing_registry");
      expect(output.nextStep).toMatchObject({
        preferredReadyCohort: "future_sleep",
        preferredReadyRouteId: null,
        reviewGptRequiredNow: false,
      });
      expect(output.nextStep.commands[0]).toContain("register missing NSRR source route");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1077-cli-"));
    try {
      const r1073Path = path.join(tmp, "r1073.json");
      await writeFile(r1073Path, `${JSON.stringify(r1073Fixture(null))}\n`);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1077-nsrr-source-route-alignment.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1073_NSRR_COHORT_READINESS_PATH: r1073Path,
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
        conclusion: "nsrr_preferred_routes_aligned_blocked_on_downloads",
        packetId: "r1077-nsrr-source-route-alignment",
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

function r1073Fixture(preferredReadyCohort: string | null) {
  const cohortIds = ["mesa_sleep", "shhs", "hchs_sol", "mros_sleep", "sof_sleep"];
  return {
    artifactBoundary: {
      aggregateOnly: true,
      archiveEntryNamesStored: false,
      codebookTextStored: false,
      coefficientsStored: false,
      localFileNamesStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      outcomeScoringPerformedByR1073: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR1073: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
    },
    cohortReadiness: cohortIds.map((cohortId, index) => ({
      blockingReasons: cohortId === preferredReadyCohort ? [] : ["outcome_or_followup_role_family_missing"],
      cohortId,
      directRowParsingUnlocked: false,
      nextAction: cohortId === preferredReadyCohort
        ? "prepare_local_materializer_or_fill_aggregate_receipt"
        : "download_derived_covariate_sleep_outcome_tables",
      outcomeScoringUnlocked: false,
      priority: index + 1,
      readinessStatus: cohortId === preferredReadyCohort
        ? "ready_for_local_materializer_or_aggregate_receipt"
        : "blocked_missing_outcome_or_followup",
      roleFamilies: {
        baseline_covariates: { fileLikeEntryCountBand: "1-9", status: "detected" },
        derived_sleep_activity_or_autonomic: { fileLikeEntryCountBand: "1-9", status: "detected" },
        documentation_or_metadata: { fileLikeEntryCountBand: "1-9", status: "detected" },
        outcome_or_followup: {
          fileLikeEntryCountBand: cohortId === preferredReadyCohort ? "1-9" : "0",
          status: cohortId === preferredReadyCohort ? "detected" : "missing",
        },
        raw_signal_only: { fileLikeEntryCountBand: "0", status: "missing" },
      },
    })),
    downloadRequest: {
      priorityOrder: cohortIds,
    },
    globalReadiness: {
      preferredReadyCohort,
      reviewGptRequiredNow: false,
      status: preferredReadyCohort
        ? "ready_for_local_materializer_or_aggregate_receipt"
        : "blocked_download_or_outcome_missing",
    },
    packetId: "r1073-nsrr-derived-cohort-readiness-intake",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1073-nsrr-derived-cohort-readiness-intake.v1",
    status: "research-local-aggregate-only",
    summary: {
      productDisplayAuthorized: false,
      rowParsingPerformedByR1073: false,
    },
  };
}
