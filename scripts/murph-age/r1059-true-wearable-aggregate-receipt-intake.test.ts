import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1059_TRUE_WEARABLE_AGGREGATE_RECEIPT_INTAKE_SCHEMA_VERSION,
  runR1059TrueWearableAggregateReceiptIntake,
} from "./r1059-true-wearable-aggregate-receipt-intake.ts";

describe("R1059 true wearable aggregate receipt intake", () => {
  it("waits cleanly when no aggregate receipt is provided", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1059-missing-"));
    try {
      const r1057Path = path.join(tmp, "r1057.json");
      await writeFile(r1057Path, `${JSON.stringify(r1057Fixture())}\n`);
      const { output, outputPath } = await runR1059TrueWearableAggregateReceiptIntake({
        createdAt: "2026-05-13T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        r1057Path,
      });

      expect(path.basename(outputPath)).toBe("r1059-true-wearable-aggregate-receipt-intake.latest.json");
      expect(output.schemaVersion).toBe(R1059_TRUE_WEARABLE_AGGREGATE_RECEIPT_INTAKE_SCHEMA_VERSION);
      expect(output.intake).toMatchObject({
        aggregateReceiptProvided: false,
        candidateCountBand: "0",
        evaluatorConclusion: "awaiting_partner_or_workbench_aggregate_receipt",
        nextAction: "await_true_wearable_aggregate_receipt",
        readinessConclusion: "true_wearable_validation_package_ready_awaiting_receipt",
        reviewGptRequired: false,
      });
      expect(output.summary.conclusion).toBe("aggregate_receipt_missing");
      expect(output.productPolicy.displayAuthorized).toBe(false);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes a valid aggregate delta to ReviewGPT", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1059-ready-"));
    try {
      const r1057Path = path.join(tmp, "r1057.json");
      const receiptPath = path.join(tmp, "receipt.json");
      await writeFile(r1057Path, `${JSON.stringify(r1057Fixture())}\n`);
      await writeFile(receiptPath, `${JSON.stringify(aggregateReceiptFixture("ready"))}\n`);

      const { output } = await runR1059TrueWearableAggregateReceiptIntake({
        aggregateReceiptPath: receiptPath,
        outputDir: path.join(tmp, "out"),
        r1057Path,
      });

      expect(output.intake).toMatchObject({
        aggregateReceiptProvided: true,
        candidateCountBand: "1-9",
        evaluatorConclusion: "partner_wearable_delta_ready_for_scientific_review",
        nextAction: "send_aggregate_delta_to_reviewgpt",
        readinessConclusion: "partner_delta_ready_for_reviewgpt_science_review",
        reviewGptRequired: true,
      });
      expect(output.summary.conclusion).toBe("aggregate_receipt_ready_for_reviewgpt");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("holds a valid receipt when no candidate clears the delta gates", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1059-hold-"));
    try {
      const r1057Path = path.join(tmp, "r1057.json");
      const receiptPath = path.join(tmp, "receipt.json");
      await writeFile(r1057Path, `${JSON.stringify(r1057Fixture())}\n`);
      await writeFile(receiptPath, `${JSON.stringify(aggregateReceiptFixture("hold"))}\n`);

      const { output } = await runR1059TrueWearableAggregateReceiptIntake({
        aggregateReceiptPath: receiptPath,
        outputDir: path.join(tmp, "out"),
        r1057Path,
      });

      expect(output.intake).toMatchObject({
        evaluatorConclusion: "partner_wearable_delta_not_ready",
        nextAction: "hold_receipt_no_scientific_delta",
        reviewGptRequired: false,
      });
      expect(output.summary.conclusion).toBe("aggregate_receipt_valid_but_no_delta");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe receipt boundaries", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1059-unsafe-"));
    try {
      const r1057Path = path.join(tmp, "r1057.json");
      const receiptPath = path.join(tmp, "receipt.json");
      await writeFile(r1057Path, `${JSON.stringify(r1057Fixture())}\n`);
      await writeFile(receiptPath, `${JSON.stringify({ ...aggregateReceiptFixture("ready"), rowValues: [] })}\n`);

      await expect(runR1059TrueWearableAggregateReceiptIntake({
        aggregateReceiptPath: receiptPath,
        outputDir: path.join(tmp, "out"),
        r1057Path,
      })).rejects.toThrow(/R1059 input aggregate receipt failed aggregate boundary validation/u);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1059-cli-"));
    try {
      const r1057Path = path.join(tmp, "r1057.json");
      await writeFile(r1057Path, `${JSON.stringify(r1057Fixture())}\n`);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1059-true-wearable-aggregate-receipt-intake.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1057_CANDIDATE_BATCH_RESULT_PATH: r1057Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        aggregateReceiptProvided: false,
        candidateCountBand: "0",
        conclusion: "aggregate_receipt_missing",
        nextAction: "await_true_wearable_aggregate_receipt",
        packetId: "r1059-true-wearable-aggregate-receipt-intake",
        productDisplayAuthorized: false,
        reviewGptRequired: false,
        rowParsingPerformedByR1059: false,
        schemaVersion: R1059_TRUE_WEARABLE_AGGREGATE_RECEIPT_INTAKE_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
      });
      expect(stdout).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

function aggregateReceiptFixture(mode: "hold" | "ready") {
  const ready = mode === "ready";
  return {
    ageSubbandEvidence: {
      "16_17": "not_reportable",
      "18_39": "stable",
      "40_50": "stable",
    },
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
    candidateMetrics: [
      {
        aucDelta: 0.01,
        brierDelta: -0.002,
        calibrationSlope: 1.02,
        candidateId: "C1_source_clinical_base",
        comparatorId: "C0_age_sex",
        deviceProviderCalibrationStatus: "stable",
        eOverO: 1.01,
        logLossDelta: -0.003,
        negativeControlStatus: "not_applicable",
        role: "reference_only",
        subgroupCalibrationStatus: "stable",
      },
      {
        aucDelta: 0.01,
        brierDelta: -0.002,
        calibrationSlope: 1.01,
        candidateId: "C2a_common_labs_only",
        comparatorId: "C1_source_clinical_base",
        deviceProviderCalibrationStatus: "stable",
        eOverO: 0.99,
        logLossDelta: -0.003,
        negativeControlStatus: "not_applicable",
        role: "reference_only",
        subgroupCalibrationStatus: "stable",
      },
      {
        aucDelta: 0.005,
        brierDelta: -0.001,
        calibrationSlope: 1.01,
        candidateId: "C2b_vitals_body_only",
        comparatorId: "C1_source_clinical_base",
        deviceProviderCalibrationStatus: "stable",
        eOverO: 0.99,
        logLossDelta: -0.002,
        negativeControlStatus: "not_applicable",
        role: "reference_only",
        subgroupCalibrationStatus: "stable",
      },
      {
        aucDelta: 0.012,
        brierDelta: -0.003,
        calibrationSlope: 1.01,
        candidateId: "C2c_common_labs_plus_vitals_body",
        comparatorId: "C1_source_clinical_base",
        deviceProviderCalibrationStatus: "stable",
        eOverO: 0.99,
        logLossDelta: -0.004,
        negativeControlStatus: "not_applicable",
        role: "reference_only",
        subgroupCalibrationStatus: "stable",
      },
      {
        aucDelta: 0.001,
        brierDelta: -0.0001,
        calibrationSlope: 1.01,
        candidateId: "C2_lab5_or_lab9_bp_body",
        comparatorId: "C2c_common_labs_plus_vitals_body",
        deviceProviderCalibrationStatus: "stable",
        eOverO: 0.99,
        logLossDelta: -0.0002,
        negativeControlStatus: "not_applicable",
        role: "reference_only",
        subgroupCalibrationStatus: "stable",
      },
      {
        aucDelta: ready ? 0.015 : 0,
        brierDelta: ready ? -0.002 : 0.001,
        calibrationSlope: ready ? 1.01 : 1.3,
        candidateId: "C3_wearable_activity_sleep_rhr_hrv_only",
        comparatorId: "C1_source_clinical_base",
        deviceProviderCalibrationStatus: ready ? "stable" : "unstable",
        eOverO: ready ? 0.99 : 1.2,
        logLossDelta: ready ? -0.003 : 0.001,
        negativeControlStatus: ready ? "beaten" : "not_beaten",
        role: "score_bearing_research_candidate",
        subgroupCalibrationStatus: "stable",
      },
      {
        aucDelta: ready ? 0.02 : 0,
        brierDelta: ready ? -0.003 : 0.001,
        calibrationSlope: ready ? 1.01 : 1.3,
        candidateId: "C3_lab_bp_body_plus_activity_28d",
        comparatorId: "C2_lab5_or_lab9_bp_body",
        deviceProviderCalibrationStatus: "stable",
        eOverO: ready ? 0.99 : 1.2,
        logLossDelta: ready ? -0.004 : 0.001,
        negativeControlStatus: ready ? "beaten" : "not_beaten",
        role: "score_bearing_research_candidate",
        subgroupCalibrationStatus: "stable",
      },
      {
        aucDelta: 0,
        brierDelta: 0.001,
        calibrationSlope: 1.01,
        candidateId: "C7_wearable_coverage_quality_only_negative_control",
        comparatorId: "C2_lab5_or_lab9_bp_body",
        deviceProviderCalibrationStatus: "stable",
        eOverO: 1.01,
        logLossDelta: 0.001,
        negativeControlStatus: "not_applicable",
        role: "negative_control",
        subgroupCalibrationStatus: "stable",
      },
      {
        aucDelta: 0,
        brierDelta: 0.001,
        calibrationSlope: 1.01,
        candidateId: "C8_shuffled_wearable_negative_control",
        comparatorId: "C2_lab5_or_lab9_bp_body",
        deviceProviderCalibrationStatus: "stable",
        eOverO: 1.01,
        logLossDelta: 0.001,
        negativeControlStatus: "not_applicable",
        role: "negative_control",
        subgroupCalibrationStatus: "stable",
      },
    ],
    denominatorCountBand: "1000-9999",
    endpoint: "hospitalization_or_emergency_utilization",
    eventCountBand: "100-999",
    evidenceClass: "local_data_holder_aggregate",
    evaluatorId: "partner_integrated_wearable_lab_evaluator_v1",
    featureSchemaVersion: "murph-age-partner-wearable-feature-schema.v1",
    horizon: "source_supported",
    packetId: "local-holder-aggregate-receipt-001",
    receiptAttestations: {
      aggregateOnly: true,
      deviceProviderCoverageReported: true,
      endpointFrozenBeforeScoring: true,
      evaluatorFrozenBeforeExecution: true,
      noCoefficientEgress: true,
      noParticipantEgress: true,
      noPredictionEgress: true,
      noRowEgress: true,
      noSmallCellEgress: true,
      sameDenominatorComparisons: true,
      validDayNightCoverageReported: true,
    },
    receiptContext: {
      broadSubgroupSuppressionStatus: "stable",
      confidenceIntervalStatus: "stable",
      featureAvailabilityMissingnessStatus: "stable",
      featureWindowTimingStatus: "stable",
      sourceReleaseGovernanceStatus: "stable",
      wearableCoverageSummaryStatus: "stable",
    },
    schemaVersion: "murph-age-partner-wearable-aggregate-receipt.v1",
  };
}

function r1057Fixture() {
  return {
    packetId: "r1057-function-activity-pulse-candidate-batch-result",
    schemaVersion: "murph-age-r1057-function-activity-pulse-candidate-batch-result.v1",
    status: "research-local-aggregate-only",
    summary: {
      currentLead: "function_activity_mobility_shadow",
      nextLoopFocus: "true_wearable_or_partner_validation",
    },
  };
}
