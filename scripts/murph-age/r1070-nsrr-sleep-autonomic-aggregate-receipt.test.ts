import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1070_NSRR_SLEEP_AUTONOMIC_AGGREGATE_RECEIPT_SCHEMA_VERSION,
  runR1070NsrrSleepAutonomicAggregateReceipt,
  type R1070NsrrSleepAutonomicAggregateReceiptInput,
} from "./r1070-nsrr-sleep-autonomic-aggregate-receipt.ts";

describe("R1070 NSRR sleep/autonomic aggregate receipt", () => {
  it("writes a fillable NSRR receipt template while awaiting aggregate evidence", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1070-template-"));
    try {
      const { output, outputPath, receiptTemplatePath } = await runR1070NsrrSleepAutonomicAggregateReceipt({
        createdAt: "2026-05-14T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
      });

      expect(path.basename(outputPath)).toBe("r1070-nsrr-sleep-autonomic-aggregate-receipt.latest.json");
      expect(path.basename(receiptTemplatePath)).toBe("r1070-fillable-nsrr-sleep-autonomic-aggregate-receipt.json");
      expect(output.schemaVersion).toBe(R1070_NSRR_SLEEP_AUTONOMIC_AGGREGATE_RECEIPT_SCHEMA_VERSION);
      expect(output.reduction).toMatchObject({
        candidateDecisions: [],
        conclusion: "awaiting_nsrr_sleep_autonomic_aggregate_receipt",
        reviewGptRequired: false,
      });
      expect(output.summary).toMatchObject({
        nextAction: "await_nsrr_aggregate_receipt",
        productDisplayAuthorized: false,
        templateReadyForDataFill: true,
      });
      expect(output.fillableReceiptTemplate.candidateMetrics.map((metric) => metric.candidateId)).toEqual([
        "N1_source_clinical_base",
        "N2_sleep_duration_regularity",
        "N3_sleep_breathing_autonomic",
        "N4_sleep_activity_autonomic_combo",
        "N5_coverage_quality_only_negative_control",
        "N6_shuffled_sleep_autonomic_negative_control",
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const receipt = JSON.parse(await readFile(receiptTemplatePath, "utf8")) as unknown;
      expect(findForbiddenAggregateEgress(receipt)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes a clean NSRR sleep/autonomic aggregate delta to ReviewGPT", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1070-ready-"));
    try {
      const { output } = await runR1070NsrrSleepAutonomicAggregateReceipt({
        aggregateReceipt: receiptFixture("ready"),
        outputDir: path.join(tmp, "out"),
      });

      expect(output.inputReceipt).toMatchObject({
        candidateCountBand: "1-9",
        endpoint: "major_cardiovascular_event",
        eventCountBand: "100-999",
        horizon: "source_supported",
        packetId: null,
        status: "available",
      });
      expect(output.reduction.conclusion).toBe("nsrr_sleep_autonomic_delta_ready_for_scientific_review");
      expect(output.reduction.reviewGptRequired).toBe(true);
      expect(output.summary.nextAction).toBe("send_nsrr_sleep_autonomic_delta_to_reviewgpt");
      expect(output.reduction.candidateDecisions.find((decision) =>
        decision.candidateId === "N4_sleep_activity_autonomic_combo"
      )).toMatchObject({
        decision: "send_reviewgpt_scientific_delta",
        measurementMethodCalibrationAcceptable: true,
        negativeControlBeaten: true,
        properScoresImproved: true,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("holds a receipt when sleep/autonomic candidates fail calibration or controls", async () => {
      const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1070-hold-"));
    try {
      const receipt = receiptFixture("ready");
      receipt.candidateMetrics = receipt.candidateMetrics.map((metric) =>
        metric.role === "score_bearing_research_candidate"
          ? {
            ...metric,
            eOverO: 1.18,
            measurementMethodCalibrationStatus: "unstable",
            negativeControlStatus: "not_beaten",
          }
          : metric
      );
      const { output } = await runR1070NsrrSleepAutonomicAggregateReceipt({
        aggregateReceipt: receipt,
        outputDir: path.join(tmp, "out"),
      });

      expect(output.reduction.conclusion).toBe("nsrr_sleep_autonomic_delta_not_ready");
      expect(output.reduction.reviewGptRequired).toBe(false);
      expect(output.summary.nextAction).toBe("hold_nsrr_delta_no_scientific_review");
      expect(output.reduction.candidateDecisions[3]).toMatchObject({
        calibrationAcceptable: false,
        decision: "hold_or_reject",
        measurementMethodCalibrationAcceptable: false,
        negativeControlBeaten: false,
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe receipts and missing negative controls", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1070-reject-"));
    try {
      await expect(runR1070NsrrSleepAutonomicAggregateReceipt({
        aggregateReceipt: {
          ...receiptFixture("ready"),
          artifactBoundary: {
            ...safeBoundary(),
            rowValuesStored: true,
          },
        },
        outputDir: path.join(tmp, "unsafe"),
      })).rejects.toThrow("R1070 input aggregate receipt failed safety validation");

      const missingControl = receiptFixture("ready");
      missingControl.candidateMetrics = missingControl.candidateMetrics.filter((metric) =>
        metric.candidateId !== "N6_shuffled_sleep_autonomic_negative_control"
      );
      await expect(runR1070NsrrSleepAutonomicAggregateReceipt({
        aggregateReceipt: missingControl,
        outputDir: path.join(tmp, "missing-control"),
      })).rejects.toThrow("R1070 NSRR receipts require coverage-quality and shuffled sleep/autonomic negative-control rows.");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1070-cli-"));
    try {
      const receiptPath = path.join(tmp, "receipt.json");
      await writeFile(receiptPath, `${JSON.stringify(receiptFixture("ready"))}\n`);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1070-nsrr-sleep-autonomic-aggregate-receipt.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_NSRR_AGGREGATE_RECEIPT_PATH: receiptPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        packetId: string;
        productDisplayAuthorized: boolean;
        reviewGptRequired: boolean;
      };
      expect(summary).toMatchObject({
        conclusion: "nsrr_sleep_autonomic_delta_ready_for_scientific_review",
        packetId: "r1070-nsrr-sleep-autonomic-aggregate-receipt",
        productDisplayAuthorized: false,
        reviewGptRequired: true,
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("localPaths");
      expect(stdout).not.toContain("rowValues");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("redacts local receipt paths on CLI failures", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1070-cli-error-"));
    try {
      const missingPath = path.join(tmp, "missing-receipt.json");
      const result = spawnSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1070-nsrr-sleep-autonomic-aggregate-receipt.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_NSRR_AGGREGATE_RECEIPT_PATH: missingPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("R1070 NSRR sleep/autonomic aggregate receipt failed.");
      expect(result.stderr).not.toContain(tmp);
      expect(result.stderr).not.toContain("missing-receipt");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

function receiptFixture(mode: "hold" | "ready"): R1070NsrrSleepAutonomicAggregateReceiptInput {
  const ready = mode === "ready";
  return {
    artifactBoundary: safeBoundary(),
    candidateMetrics: [
      metric("N1_source_clinical_base", "N0_age_sex", "reference_only", -0.003, -0.006, "not_applicable"),
      metric("N2_sleep_duration_regularity", "N1_source_clinical_base", "score_bearing_research_candidate", ready ? -0.001 : 0.001, ready ? -0.002 : 0.001, ready ? "beaten" : "not_beaten"),
      metric("N3_sleep_breathing_autonomic", "N1_source_clinical_base", "score_bearing_research_candidate", ready ? -0.001 : 0.001, ready ? -0.002 : 0.001, ready ? "beaten" : "not_beaten"),
      metric("N4_sleep_activity_autonomic_combo", "N1_source_clinical_base", "score_bearing_research_candidate", ready ? -0.002 : 0.001, ready ? -0.004 : 0.001, ready ? "beaten" : "not_beaten"),
      metric("N5_coverage_quality_only_negative_control", "N1_source_clinical_base", "negative_control", 0.001, 0.001, "not_applicable"),
      metric("N6_shuffled_sleep_autonomic_negative_control", "N1_source_clinical_base", "negative_control", 0.001, 0.001, "not_applicable"),
    ],
    denominatorCountBand: "1000-9999",
    endpoint: "major_cardiovascular_event",
    eventCountBand: "100-999",
    evidenceClass: "local_data_holder_aggregate",
    evaluatorId: "nsrr_sleep_autonomic_aggregate_evaluator_v1",
    featureSchemaVersion: "murph-age-nsrr-sleep-autonomic-feature-schema.v1",
    horizon: "source_supported",
    packetId: "nsrr-aggregate-receipt-001",
    receiptAttestations: {
      aggregateOnly: true,
      endpointFrozenBeforeScoring: true,
      evaluatorFrozenBeforeExecution: true,
      measurementMethodCoverageReported: true,
      noCoefficientEgress: true,
      noParticipantEgress: true,
      noPredictionEgress: true,
      noRowEgress: true,
      noSmallCellEgress: true,
      sameDenominatorComparisons: true,
      validSleepAutonomicCoverageReported: true,
    },
    schemaVersion: "murph-age-nsrr-sleep-autonomic-aggregate-receipt.v1",
  };
}

function metric(
  candidateId: R1070NsrrSleepAutonomicAggregateReceiptInput["candidateMetrics"][number]["candidateId"],
  comparatorId: R1070NsrrSleepAutonomicAggregateReceiptInput["candidateMetrics"][number]["comparatorId"],
  role: R1070NsrrSleepAutonomicAggregateReceiptInput["candidateMetrics"][number]["role"],
  brierDelta: number,
  logLossDelta: number,
  negativeControlStatus: R1070NsrrSleepAutonomicAggregateReceiptInput["candidateMetrics"][number]["negativeControlStatus"],
): R1070NsrrSleepAutonomicAggregateReceiptInput["candidateMetrics"][number] {
  return {
    aucDelta: brierDelta < 0 ? 0.01 : 0,
    brierDelta,
    calibrationSlope: 1.01,
    candidateId,
    comparatorId,
    eOverO: 0.99,
    logLossDelta,
    measurementMethodCalibrationStatus: "stable",
    negativeControlStatus,
    role,
    subgroupCalibrationStatus: "stable",
  };
}

function safeBoundary() {
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
