import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1072_TRUE_WEARABLE_VALIDATION_HANDOFF_BUNDLE_SCHEMA_VERSION,
  runR1072TrueWearableValidationHandoffBundle,
} from "./r1072-true-wearable-validation-handoff-bundle.ts";

describe("R1072 true wearable validation handoff bundle", () => {
  it("packages the current data blocker without enabling ReviewGPT or product display", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1072-data-"));
    try {
      const paths = await writeInputs(tmp, {
        nsrrCohortReadinessStatus: "blocked_download_or_outcome_missing",
        nsrrReadinessStatus: "blocked_download_nsrr_derived_files",
        nsrrReceiptStatus: "awaiting_nsrr_sleep_autonomic_aggregate_receipt",
        partnerReceiptConclusion: "aggregate_receipt_missing",
      });
      const { output, outputPath } = await runR1072TrueWearableValidationHandoffBundle({
        createdAt: "2026-05-14T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1072-true-wearable-validation-handoff-bundle.latest.json");
      expect(output.schemaVersion).toBe(R1072_TRUE_WEARABLE_VALIDATION_HANDOFF_BUNDLE_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "true_wearable_validation_blocked_on_data",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1072: false,
      });
      expect(output.nextAction).toMatchObject({
        actionId: "download_nsrr_derived_files_or_secure_workbench_access",
        reviewGptRequiredNow: false,
      });
      expect(output.handoffPackages.partnerIntegratedWearableLabAggregate).toMatchObject({
        evaluatorId: "partner_integrated_wearable_lab_evaluator_v1",
        receiptTemplateArtifact: "r1062-fillable-aggregate-receipt-template.json",
        templateReadyForDataFill: true,
      });
      expect(output.handoffPackages.nsrrSleepAutonomicAggregate).toMatchObject({
        evaluatorId: "nsrr_sleep_autonomic_aggregate_evaluator_v1",
        preferredReadyCohort: null,
        receiptTemplateArtifact: "r1070-fillable-nsrr-sleep-autonomic-aggregate-receipt.json",
        sourceReadinessStatus: "blocked_download_or_outcome_missing",
        templateReadyForDataFill: true,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = JSON.parse(await readFile(outputPath, "utf8")) as unknown;
      expect(findForbiddenAggregateEgress(persisted)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("asks for an NSRR receipt when role families are ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1072-receipt-"));
    try {
      const paths = await writeInputs(tmp, {
        nsrrCohortReadinessStatus: "blocked_download_or_outcome_missing",
        nsrrReadinessStatus: "blocked_fill_nsrr_aggregate_receipt",
        nsrrReceiptStatus: "awaiting_nsrr_sleep_autonomic_aggregate_receipt",
        partnerReceiptConclusion: "aggregate_receipt_missing",
      });
      const { output } = await runR1072TrueWearableValidationHandoffBundle({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary.conclusion).toBe("true_wearable_validation_blocked_on_receipt");
      expect(output.nextAction).toMatchObject({
        actionId: "fill_nsrr_aggregate_receipt",
        reviewGptRequiredNow: false,
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("uses the cohort-level NSRR preflight to request receipt fill when a cohort is ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1072-r1073-ready-"));
    try {
      const paths = await writeInputs(tmp, {
        nsrrCohortReadinessStatus: "ready_for_local_materializer_or_aggregate_receipt",
        nsrrReadinessStatus: "blocked_download_nsrr_derived_files",
        nsrrReceiptStatus: "awaiting_nsrr_sleep_autonomic_aggregate_receipt",
        partnerReceiptConclusion: "aggregate_receipt_missing",
      });
      const { output } = await runR1072TrueWearableValidationHandoffBundle({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary.conclusion).toBe("true_wearable_validation_blocked_on_receipt");
      expect(output.handoffPackages.nsrrSleepAutonomicAggregate).toMatchObject({
        preferredReadyCohort: "shhs",
        sourceReadinessStatus: "ready_for_local_materializer_or_aggregate_receipt",
      });
      expect(output.nextAction).toMatchObject({
        actionId: "fill_nsrr_aggregate_receipt",
        reviewGptRequiredNow: false,
      });
      expect(output.nextAction.dataAsk).toContain("shhs");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prioritizes partner/workbench deltas that are ready for ReviewGPT", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1072-partner-ready-"));
    try {
      const paths = await writeInputs(tmp, {
        nsrrCohortReadinessStatus: "blocked_download_or_outcome_missing",
        nsrrReadinessStatus: "blocked_download_nsrr_derived_files",
        nsrrReceiptStatus: "awaiting_nsrr_sleep_autonomic_aggregate_receipt",
        partnerReceiptConclusion: "aggregate_receipt_ready_for_reviewgpt",
      });
      const { output } = await runR1072TrueWearableValidationHandoffBundle({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary.conclusion).toBe("true_wearable_delta_ready_for_reviewgpt");
      expect(output.nextAction).toMatchObject({
        actionId: "send_true_wearable_delta_to_reviewgpt",
        reviewGptRequiredNow: true,
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes ready NSRR aggregate deltas to ReviewGPT", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1072-nsrr-ready-"));
    try {
      const paths = await writeInputs(tmp, {
        nsrrCohortReadinessStatus: "blocked_download_or_outcome_missing",
        nsrrReadinessStatus: "nsrr_delta_ready_for_reviewgpt",
        nsrrReceiptStatus: "nsrr_sleep_autonomic_delta_ready_for_scientific_review",
        partnerReceiptConclusion: "aggregate_receipt_missing",
      });
      const { output } = await runR1072TrueWearableValidationHandoffBundle({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary.conclusion).toBe("true_wearable_delta_ready_for_reviewgpt");
      expect(output.nextAction).toMatchObject({
        actionId: "send_nsrr_delta_to_reviewgpt",
        reviewGptRequiredNow: true,
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1072-cli-"));
    try {
      const paths = await writeInputs(tmp, {
        nsrrCohortReadinessStatus: "blocked_download_or_outcome_missing",
        nsrrReadinessStatus: "blocked_download_nsrr_derived_files",
        nsrrReceiptStatus: "awaiting_nsrr_sleep_autonomic_aggregate_receipt",
        partnerReceiptConclusion: "aggregate_receipt_missing",
      });
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1072-true-wearable-validation-handoff-bundle.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1059_TRUE_WEARABLE_RECEIPT_INTAKE_PATH: paths.r1059Path,
          MURPH_AGE_R1061_TRUE_WEARABLE_DATA_UNBLOCKER_PATH: paths.r1061Path,
          MURPH_AGE_R1062_TRUE_WEARABLE_RECEIPT_TEMPLATE_PATH: paths.r1062Path,
          MURPH_AGE_R1068_TRUE_WEARABLE_SOURCE_ACTIVATION_PATH: paths.r1068Path,
          MURPH_AGE_R1069_NSRR_DERIVED_ROLE_ACTIVATION_PATH: paths.r1069Path,
          MURPH_AGE_R1070_NSRR_AGGREGATE_RECEIPT_PATH: paths.r1070Path,
          MURPH_AGE_R1071_NSRR_READINESS_REDUCER_PATH: paths.r1071Path,
          MURPH_AGE_R1073_NSRR_COHORT_READINESS_PATH: paths.r1073Path,
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
        conclusion: "true_wearable_validation_blocked_on_data",
        packetId: "r1072-true-wearable-validation-handoff-bundle",
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
  options: {
    nsrrReadinessStatus:
      | "blocked_download_nsrr_derived_files"
      | "blocked_fill_nsrr_aggregate_receipt"
      | "nsrr_delta_ready_for_reviewgpt";
    nsrrCohortReadinessStatus:
      | "blocked_download_or_outcome_missing"
      | "ready_for_local_materializer_or_aggregate_receipt";
    nsrrReceiptStatus:
      | "awaiting_nsrr_sleep_autonomic_aggregate_receipt"
      | "nsrr_sleep_autonomic_delta_ready_for_scientific_review";
    partnerReceiptConclusion: "aggregate_receipt_missing" | "aggregate_receipt_ready_for_reviewgpt";
  },
): Promise<{
  r1059Path: string;
  r1061Path: string;
  r1062Path: string;
  r1068Path: string;
  r1069Path: string;
  r1070Path: string;
  r1071Path: string;
  r1073Path: string;
}> {
  const paths = {
    r1059Path: path.join(tmp, "r1059.json"),
    r1061Path: path.join(tmp, "r1061.json"),
    r1062Path: path.join(tmp, "r1062.json"),
    r1068Path: path.join(tmp, "r1068.json"),
    r1069Path: path.join(tmp, "r1069.json"),
    r1070Path: path.join(tmp, "r1070.json"),
    r1071Path: path.join(tmp, "r1071.json"),
    r1073Path: path.join(tmp, "r1073.json"),
  };
  await Promise.all([
    writeFile(paths.r1059Path, `${JSON.stringify(r1059Fixture(options.partnerReceiptConclusion))}\n`),
    writeFile(paths.r1061Path, `${JSON.stringify(r1061Fixture())}\n`),
    writeFile(paths.r1062Path, `${JSON.stringify(r1062Fixture())}\n`),
    writeFile(paths.r1068Path, `${JSON.stringify(r1068Fixture())}\n`),
    writeFile(paths.r1069Path, `${JSON.stringify(r1069Fixture())}\n`),
    writeFile(paths.r1070Path, `${JSON.stringify(r1070Fixture(options.nsrrReceiptStatus))}\n`),
    writeFile(paths.r1071Path, `${JSON.stringify(r1071Fixture(options.nsrrReadinessStatus, options.nsrrReceiptStatus))}\n`),
    writeFile(paths.r1073Path, `${JSON.stringify(r1073Fixture(options.nsrrCohortReadinessStatus))}\n`),
  ]);
  return paths;
}

function r1073Fixture(
  readinessStatus: "blocked_download_or_outcome_missing" | "ready_for_local_materializer_or_aggregate_receipt",
) {
  return {
    artifactBoundary: {
      ...safeBoundary(),
      archiveEntryNamesStored: false,
    },
    globalReadiness: {
      preferredReadyCohort: readinessStatus === "ready_for_local_materializer_or_aggregate_receipt" ? "shhs" : null,
      reviewGptRequiredNow: false,
      status: readinessStatus,
    },
    packetId: "r1073-nsrr-derived-cohort-readiness-intake",
    schemaVersion: "murph-age-r1073-nsrr-derived-cohort-readiness-intake.v1",
    status: "research-local-aggregate-only",
    summary: {
      productDisplayAuthorized: false,
      rowParsingPerformedByR1073: false,
    },
  };
}

function r1059Fixture(conclusion: "aggregate_receipt_missing" | "aggregate_receipt_ready_for_reviewgpt") {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1059-true-wearable-aggregate-receipt-intake",
    schemaVersion: "murph-age-r1059-true-wearable-aggregate-receipt-intake.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      productDisplayAuthorized: false,
    },
  };
}

function r1061Fixture() {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1061-true-wearable-data-unblocker",
    schemaVersion: "murph-age-r1061-true-wearable-data-unblocker.v1",
    status: "research-local-aggregate-only",
    summary: {
      productDisplayAuthorized: false,
      publicActivityBridgeStatus: "wrist_shadow_inconclusive_keep_shadow",
    },
  };
}

function r1062Fixture() {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1062-true-wearable-aggregate-receipt-template",
    receiptTemplateArtifact: "r1062-fillable-aggregate-receipt-template.json",
    schemaVersion: "murph-age-r1062-true-wearable-aggregate-receipt-template.v1",
    status: "research-local-aggregate-only",
    summary: {
      productDisplayAuthorized: false,
      templateReadyForDataFill: true,
    },
  };
}

function r1068Fixture() {
  return {
    artifactBoundary: safeBoundary(),
    nextBatch: {
      nextUserDataAsk: "download_nsrr_derived_sleep_cohort_files_or_secure_allofus_workbench_access",
    },
    packetId: "r1068-true-wearable-source-activation-matrix",
    schemaVersion: "murph-age-r1068-true-wearable-source-activation-matrix.v1",
    status: "research-local-aggregate-only",
  };
}

function r1069Fixture() {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1069-nsrr-derived-role-activation",
    rowExecutionReadiness: {
      status: "blocked_missing_derived_role_families",
    },
    schemaVersion: "murph-age-r1069-nsrr-derived-role-activation.v1",
    status: "research-local-aggregate-only",
  };
}

function r1070Fixture(
  receiptStatus:
    | "awaiting_nsrr_sleep_autonomic_aggregate_receipt"
    | "nsrr_sleep_autonomic_delta_ready_for_scientific_review",
) {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1070-nsrr-sleep-autonomic-aggregate-receipt",
    receiptTemplateArtifact: "r1070-fillable-nsrr-sleep-autonomic-aggregate-receipt.json",
    reduction: {
      conclusion: receiptStatus,
    },
    schemaVersion: "murph-age-r1070-nsrr-sleep-autonomic-aggregate-receipt.v1",
    status: "research-local-aggregate-only",
    summary: {
      productDisplayAuthorized: false,
      templateReadyForDataFill: true,
    },
  };
}

function r1071Fixture(
  nsrrReadinessStatus:
    | "blocked_download_nsrr_derived_files"
    | "blocked_fill_nsrr_aggregate_receipt"
    | "nsrr_delta_ready_for_reviewgpt",
  receiptStatus:
    | "awaiting_nsrr_sleep_autonomic_aggregate_receipt"
    | "nsrr_sleep_autonomic_delta_ready_for_scientific_review",
) {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1071-nsrr-validation-readiness-reducer",
    readiness: {
      status: nsrrReadinessStatus,
    },
    schemaVersion: "murph-age-r1071-nsrr-validation-readiness-reducer.v1",
    status: "research-local-aggregate-only",
    validationPackage: {
      receiptStatus,
      receiptTemplateArtifact: "r1070-fillable-nsrr-sleep-autonomic-aggregate-receipt.json",
      templateReadyForDataFill: true,
    },
  };
}

function safeBoundary(): Record<string, boolean> {
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
