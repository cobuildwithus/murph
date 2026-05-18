import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1071_NSRR_VALIDATION_READINESS_REDUCER_SCHEMA_VERSION,
  runR1071NsrrValidationReadinessReducer,
} from "./r1071-nsrr-validation-readiness-reducer.ts";

describe("R1071 NSRR validation readiness reducer", () => {
  it("keeps NSRR blocked on derived role-family downloads when files are missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1071-missing-"));
    try {
      const paths = await writeInputs(tmp, "blocked_missing_derived_role_families", "awaiting_nsrr_sleep_autonomic_aggregate_receipt");
      const { output, outputPath } = await runR1071NsrrValidationReadinessReducer({
        createdAt: "2026-05-14T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1071-nsrr-validation-readiness-reducer.latest.json");
      expect(output.schemaVersion).toBe(R1071_NSRR_VALIDATION_READINESS_REDUCER_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "nsrr_download_or_receipt_missing",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1071: false,
      });
      expect(output.readiness).toMatchObject({
        nextAction: "download_nsrr_derived_covariate_sleep_outcome_files",
        reviewGptRequiredNow: false,
        status: "blocked_download_nsrr_derived_files",
      });
      expect(output.sourceEvidence.roleFamilyStatus).toBe("blocked_missing_derived_role_families");
      expect(output.validationPackage.receiptStatus).toBe("awaiting_nsrr_sleep_autonomic_aggregate_receipt");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = JSON.parse(await readFile(outputPath, "utf8")) as unknown;
      expect(findForbiddenAggregateEgress(persisted)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("asks to fill the receipt when NSRR role families are ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1071-fill-"));
    try {
      const paths = await writeInputs(tmp, "metadata_role_families_ready_no_scoring", "awaiting_nsrr_sleep_autonomic_aggregate_receipt");
      const { output } = await runR1071NsrrValidationReadinessReducer({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.readiness).toMatchObject({
        blockingReasons: ["nsrr_aggregate_receipt_missing"],
        nextAction: "fill_nsrr_aggregate_receipt_template",
        reviewGptRequiredNow: false,
        status: "blocked_fill_nsrr_aggregate_receipt",
      });
      expect(output.summary.conclusion).toBe("nsrr_download_or_receipt_missing");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes a ready NSRR aggregate delta to ReviewGPT", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1071-ready-"));
    try {
      const paths = await writeInputs(
        tmp,
        "metadata_role_families_ready_no_scoring",
        "nsrr_sleep_autonomic_delta_ready_for_scientific_review",
      );
      const { output } = await runR1071NsrrValidationReadinessReducer({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.readiness).toMatchObject({
        blockingReasons: [],
        nextAction: "send_nsrr_sleep_autonomic_delta_to_reviewgpt",
        reviewGptRequiredNow: true,
        status: "nsrr_delta_ready_for_reviewgpt",
      });
      expect(output.summary.conclusion).toBe("nsrr_delta_ready_for_reviewgpt");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("holds a valid no-delta receipt locally without ReviewGPT", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1071-hold-"));
    try {
      const paths = await writeInputs(
        tmp,
        "metadata_role_families_ready_no_scoring",
        "nsrr_sleep_autonomic_delta_not_ready",
      );
      const { output } = await runR1071NsrrValidationReadinessReducer({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.readiness).toMatchObject({
        blockingReasons: ["aggregate_delta_failed_r1070_scientific_gates"],
        nextAction: "hold_nsrr_delta_no_scientific_review",
        reviewGptRequiredNow: false,
        status: "nsrr_delta_hold_no_review",
      });
      expect(output.summary.conclusion).toBe("nsrr_receipt_valid_but_no_delta");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1071-cli-"));
    try {
      const paths = await writeInputs(tmp, "blocked_missing_derived_role_families", "awaiting_nsrr_sleep_autonomic_aggregate_receipt");
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1071-nsrr-validation-readiness-reducer.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1069_NSRR_DERIVED_ROLE_ACTIVATION_PATH: paths.r1069Path,
          MURPH_AGE_R1070_NSRR_AGGREGATE_RECEIPT_PATH: paths.r1070Path,
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
        conclusion: "nsrr_download_or_receipt_missing",
        packetId: "r1071-nsrr-validation-readiness-reducer",
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

async function writeInputs(
  tmp: string,
  roleStatus: "blocked_missing_derived_role_families" | "blocked_raw_signal_only" | "metadata_role_families_ready_no_scoring",
  receiptStatus:
    | "awaiting_nsrr_sleep_autonomic_aggregate_receipt"
    | "nsrr_sleep_autonomic_delta_not_ready"
    | "nsrr_sleep_autonomic_delta_ready_for_scientific_review",
): Promise<{ r1069Path: string; r1070Path: string }> {
  const r1069Path = path.join(tmp, "r1069.json");
  const r1070Path = path.join(tmp, "r1070.json");
  await Promise.all([
    writeFile(r1069Path, `${JSON.stringify(r1069Fixture(roleStatus))}\n`),
    writeFile(r1070Path, `${JSON.stringify(r1070Fixture(receiptStatus))}\n`),
  ]);
  return { r1069Path, r1070Path };
}

function r1069Fixture(status: "blocked_missing_derived_role_families" | "blocked_raw_signal_only" | "metadata_role_families_ready_no_scoring") {
  const detected = status === "metadata_role_families_ready_no_scoring";
  return {
    artifactBoundary: safeBoundary("R1069"),
    packetId: "r1069-nsrr-derived-role-activation",
    roleFamilyScan: {
      roleFamilies: {
        baseline_covariates: { status: detected ? "detected" : "missing" },
        derived_sleep_activity_or_autonomic: { status: detected ? "detected" : "missing" },
        documentation_or_metadata: { status: detected ? "detected" : "missing" },
        outcome_or_followup: { status: detected ? "detected" : "missing" },
        raw_signal_only: { status: status === "blocked_raw_signal_only" ? "detected" : "missing" },
      },
    },
    rowExecutionReadiness: {
      status,
    },
    schemaVersion: "murph-age-r1069-nsrr-derived-role-activation.v1",
    status: "research-local-aggregate-only",
  };
}

function r1070Fixture(
  conclusion:
    | "awaiting_nsrr_sleep_autonomic_aggregate_receipt"
    | "nsrr_sleep_autonomic_delta_not_ready"
    | "nsrr_sleep_autonomic_delta_ready_for_scientific_review",
) {
  return {
    artifactBoundary: safeBoundary("R1070"),
    packetId: "r1070-nsrr-sleep-autonomic-aggregate-receipt",
    receiptTemplateArtifact: "r1070-fillable-nsrr-sleep-autonomic-aggregate-receipt.json",
    reduction: {
      conclusion,
    },
    schemaVersion: "murph-age-r1070-nsrr-sleep-autonomic-aggregate-receipt.v1",
    status: "research-local-aggregate-only",
    summary: {
      templateReadyForDataFill: true,
    },
  };
}

function safeBoundary(_label: "R1069" | "R1070"): Record<string, boolean> {
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
