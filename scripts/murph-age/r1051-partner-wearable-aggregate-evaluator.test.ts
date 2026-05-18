import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1051_PARTNER_WEARABLE_AGGREGATE_EVALUATOR_SCHEMA_VERSION,
  runR1051PartnerWearableAggregateEvaluator,
  type R1051PartnerWearableAggregateReceiptInput,
} from "./r1051-partner-wearable-aggregate-evaluator.ts";

describe("R1051 partner wearable aggregate evaluator", () => {
  it("emits a frozen aggregate receipt template while awaiting partner data", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1051-template-"));
    try {
      const { output, outputPath } = await runR1051PartnerWearableAggregateEvaluator({
        createdAt: "2026-05-13T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
      });

      expect(path.basename(outputPath)).toBe("r1051-partner-wearable-aggregate-evaluator.latest.json");
      expect(output.schemaVersion).toBe(R1051_PARTNER_WEARABLE_AGGREGATE_EVALUATOR_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.inputReceipt.status).toBe("missing");
      expect(output.reduction).toEqual({
        candidateDecisions: [],
        conclusion: "awaiting_partner_or_workbench_aggregate_receipt",
        reviewGptRequired: false,
      });
      expect(output.template.allowedCandidateIds).toContain("C5_lab_bp_body_plus_activity_sleep_rhr");
      expect(output.template.allowedCandidateIds).toContain("C2a_common_labs_only");
      expect(output.template.requiredAgeSubbands).toEqual(["16_17", "18_39", "40_50"]);
      expect(output.template.requiredConsumerBlockCandidates).toEqual([
        "C2a_common_labs_only",
        "C2b_vitals_body_only",
        "C2c_common_labs_plus_vitals_body",
        "C3_wearable_activity_sleep_rhr_hrv_only",
      ]);
      expect(output.template.requiredNegativeControls).toContain("device_provider_or_source_context_only");
      expect(output.template.requiredReceiptContextFields).toEqual([
        "broadSubgroupSuppressionStatus",
        "confidenceIntervalStatus",
        "featureAvailabilityMissingnessStatus",
        "featureWindowTimingStatus",
        "sourceReleaseGovernanceStatus",
        "wearableCoverageSummaryStatus",
      ]);
      expect(output.artifactBoundary.rowParsingPerformedByR1051).toBe(false);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes a clean integrated wearable aggregate delta to high-level ReviewGPT science review", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1051-ready-"));
    try {
      const { output } = await runR1051PartnerWearableAggregateEvaluator({
        aggregateReceipt: receiptFixture(),
        outputDir: path.join(tmp, "out"),
      });

      expect(output.inputReceipt).toMatchObject({
        candidateCountBand: "1-9",
        endpoint: "major_cardiovascular_event",
        evaluatorId: "partner_integrated_wearable_lab_evaluator_v1",
        eventCountBand: "100-999",
        horizon: "5y",
        status: "available",
      });
      expect(output.reduction.conclusion).toBe("partner_wearable_delta_ready_for_scientific_review");
      expect(output.reduction.reviewGptRequired).toBe(true);
      expect(output.reduction.candidateDecisions).toEqual([
        {
          calibrationAcceptable: true,
          candidateId: "C1_source_clinical_base",
          comparatorId: "C0_age_sex",
          decision: "keep_reference_or_control",
          deviceProviderCalibrationAcceptable: true,
          negativeControlBeaten: true,
          properScoresImproved: true,
          role: "reference_only",
          subgroupCalibrationAcceptable: true,
        },
        {
          calibrationAcceptable: true,
          candidateId: "C2a_common_labs_only",
          comparatorId: "C1_source_clinical_base",
          decision: "keep_reference_or_control",
          deviceProviderCalibrationAcceptable: true,
          negativeControlBeaten: true,
          properScoresImproved: true,
          role: "reference_only",
          subgroupCalibrationAcceptable: true,
        },
        {
          calibrationAcceptable: true,
          candidateId: "C2b_vitals_body_only",
          comparatorId: "C1_source_clinical_base",
          decision: "keep_reference_or_control",
          deviceProviderCalibrationAcceptable: true,
          negativeControlBeaten: true,
          properScoresImproved: true,
          role: "reference_only",
          subgroupCalibrationAcceptable: true,
        },
        {
          calibrationAcceptable: true,
          candidateId: "C2c_common_labs_plus_vitals_body",
          comparatorId: "C1_source_clinical_base",
          decision: "keep_reference_or_control",
          deviceProviderCalibrationAcceptable: true,
          negativeControlBeaten: true,
          properScoresImproved: true,
          role: "reference_only",
          subgroupCalibrationAcceptable: true,
        },
        {
          calibrationAcceptable: true,
          candidateId: "C2_lab5_or_lab9_bp_body",
          comparatorId: "C2c_common_labs_plus_vitals_body",
          decision: "keep_reference_or_control",
          deviceProviderCalibrationAcceptable: true,
          negativeControlBeaten: true,
          properScoresImproved: true,
          role: "reference_only",
          subgroupCalibrationAcceptable: true,
        },
        {
          calibrationAcceptable: true,
          candidateId: "C3_wearable_activity_sleep_rhr_hrv_only",
          comparatorId: "C1_source_clinical_base",
          decision: "send_reviewgpt_scientific_delta",
          deviceProviderCalibrationAcceptable: true,
          negativeControlBeaten: true,
          properScoresImproved: true,
          role: "score_bearing_research_candidate",
          subgroupCalibrationAcceptable: true,
        },
        {
          calibrationAcceptable: true,
          candidateId: "C5_lab_bp_body_plus_activity_sleep_rhr",
          comparatorId: "C2_lab5_or_lab9_bp_body",
          decision: "send_reviewgpt_scientific_delta",
          deviceProviderCalibrationAcceptable: true,
          negativeControlBeaten: true,
          properScoresImproved: true,
          role: "score_bearing_research_candidate",
          subgroupCalibrationAcceptable: true,
        },
        {
          calibrationAcceptable: true,
          candidateId: "C7_wearable_coverage_quality_only_negative_control",
          comparatorId: "C2_lab5_or_lab9_bp_body",
          decision: "keep_reference_or_control",
          deviceProviderCalibrationAcceptable: true,
          negativeControlBeaten: true,
          properScoresImproved: false,
          role: "negative_control",
          subgroupCalibrationAcceptable: true,
        },
        {
          calibrationAcceptable: true,
          candidateId: "C8_shuffled_wearable_negative_control",
          comparatorId: "C2_lab5_or_lab9_bp_body",
          decision: "keep_reference_or_control",
          deviceProviderCalibrationAcceptable: true,
          negativeControlBeaten: true,
          properScoresImproved: false,
          role: "negative_control",
          subgroupCalibrationAcceptable: true,
        },
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("holds a wearable delta when calibration or negative-control gates fail", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1051-hold-"));
    try {
      const receipt = receiptFixture();
      receipt.candidateMetrics = receipt.candidateMetrics.map((metric) =>
        metric.role === "score_bearing_research_candidate"
          ? {
            ...metric,
            deviceProviderCalibrationStatus: "unstable",
            eOverO: 1.14,
            negativeControlStatus: "not_beaten",
          }
          : metric
      );
      const { output } = await runR1051PartnerWearableAggregateEvaluator({
        aggregateReceipt: receipt,
        outputDir: path.join(tmp, "out"),
      });

      expect(output.reduction.conclusion).toBe("partner_wearable_delta_not_ready");
      expect(output.reduction.reviewGptRequired).toBe(false);
      expect(output.reduction.candidateDecisions.find((decision) =>
        decision.candidateId === "C5_lab_bp_body_plus_activity_sleep_rhr"
      )).toMatchObject({
        calibrationAcceptable: false,
        decision: "hold_or_reject",
        deviceProviderCalibrationAcceptable: false,
        negativeControlBeaten: false,
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe partner aggregate receipts", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1051-unsafe-"));
    try {
      await expect(runR1051PartnerWearableAggregateEvaluator({
        aggregateReceipt: {
          ...receiptFixture(),
          artifactBoundary: {
            ...safeBoundary(),
            rowValuesStored: true,
          },
        },
        outputDir: path.join(tmp, "out"),
      })).rejects.toThrow("R1051 input aggregate receipt failed safety validation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects wearable deltas that omit required negative-control rows", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1051-missing-controls-"));
    try {
      const receipt = receiptFixture();
      receipt.candidateMetrics = receipt.candidateMetrics.filter((metric) =>
        metric.candidateId !== "C8_shuffled_wearable_negative_control"
      );
      await expect(runR1051PartnerWearableAggregateEvaluator({
        aggregateReceipt: receipt,
        outputDir: path.join(tmp, "out"),
      })).rejects.toThrow("R1051 aggregate wearable receipts require both coverage-quality and shuffled-wearable negative-control rows.");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects wearable deltas that omit required consumer block rows", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1051-missing-blocks-"));
    try {
      const receipt = receiptFixture();
      receipt.candidateMetrics = receipt.candidateMetrics.filter((metric) =>
        metric.candidateId !== "C2a_common_labs_only"
      );
      await expect(runR1051PartnerWearableAggregateEvaluator({
        aggregateReceipt: receipt,
        outputDir: path.join(tmp, "out"),
      })).rejects.toThrow("R1051 aggregate wearable receipts require lab-only, vitals/body-only, lab+vitals/body, and wearable-only block rows.");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects malformed age subband evidence", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1051-age-subband-"));
    try {
      await expect(runR1051PartnerWearableAggregateEvaluator({
        aggregateReceipt: {
          ...receiptFixture(),
          ageSubbandEvidence: {
            "18_39": "stable",
            "40_50": "stable",
          },
        },
        outputDir: path.join(tmp, "out"),
      })).rejects.toThrow("R1051 aggregate receipt age subband evidence must include 16_17, 18_39, and 40_50 statuses.");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects malformed receipt context", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1051-context-"));
    try {
      await expect(runR1051PartnerWearableAggregateEvaluator({
        aggregateReceipt: {
          ...receiptFixture(),
          receiptContext: {
            sourceReleaseGovernanceStatus: "stable",
          },
        },
        outputDir: path.join(tmp, "out"),
      })).rejects.toThrow("R1051 aggregate receipt context must include source, timing, availability, coverage, confidence interval, and subgroup suppression statuses.");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects receipts that omit advertised device/provider coverage attestation", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1051-device-attestation-"));
    try {
      await expect(runR1051PartnerWearableAggregateEvaluator({
        aggregateReceipt: {
          ...receiptFixture(),
          receiptAttestations: {
            ...receiptFixture().receiptAttestations,
            deviceProviderCoverageReported: false,
          },
        },
        outputDir: path.join(tmp, "out"),
      })).rejects.toThrow("R1051 receipt attestation deviceProviderCoverageReported must be true.");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1051-cli-"));
    try {
      const receiptPath = path.join(tmp, "receipt.json");
      await writeFile(receiptPath, `${JSON.stringify(receiptFixture())}\n`);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1051-partner-wearable-aggregate-evaluator.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1051_PARTNER_RECEIPT_PATH: receiptPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        artifact: "r1051-partner-wearable-aggregate-evaluator.latest.json",
        candidateCountBand: "1-9",
        conclusion: "partner_wearable_delta_ready_for_scientific_review",
        evaluatorId: "partner_integrated_wearable_lab_evaluator_v1",
        packetId: "r1051-partner-wearable-aggregate-evaluator",
        productDisplayAuthorized: false,
        reviewGptRequired: true,
        rowParsingPerformedByR1051: false,
        schemaVersion: R1051_PARTNER_WEARABLE_AGGREGATE_EVALUATOR_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("coefficients");
      expect(stdout).not.toContain("predictions");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

function receiptFixture(): R1051PartnerWearableAggregateReceiptInput {
  return {
    ageSubbandEvidence: {
      "16_17": "not_reportable",
      "18_39": "stable",
      "40_50": "stable",
    },
    artifactBoundary: safeBoundary(),
    candidateMetrics: [
      metric("C1_source_clinical_base", "C0_age_sex", "reference_only", -0.004, -0.01, "not_applicable"),
      metric("C2a_common_labs_only", "C1_source_clinical_base", "reference_only", -0.002, -0.006, "not_applicable"),
      metric("C2b_vitals_body_only", "C1_source_clinical_base", "reference_only", -0.001, -0.004, "not_applicable"),
      metric("C2c_common_labs_plus_vitals_body", "C1_source_clinical_base", "reference_only", -0.003, -0.008, "not_applicable"),
      metric("C2_lab5_or_lab9_bp_body", "C2c_common_labs_plus_vitals_body", "reference_only", -0.0002, -0.001, "not_applicable"),
      metric(
        "C3_wearable_activity_sleep_rhr_hrv_only",
        "C1_source_clinical_base",
        "score_bearing_research_candidate",
        -0.001,
        -0.004,
        "beaten",
      ),
      metric(
        "C5_lab_bp_body_plus_activity_sleep_rhr",
        "C2_lab5_or_lab9_bp_body",
        "score_bearing_research_candidate",
        -0.002,
        -0.006,
        "beaten",
      ),
      metric(
        "C7_wearable_coverage_quality_only_negative_control",
        "C2_lab5_or_lab9_bp_body",
        "negative_control",
        0.0001,
        0.0002,
        "not_applicable",
      ),
      metric(
        "C8_shuffled_wearable_negative_control",
        "C2_lab5_or_lab9_bp_body",
        "negative_control",
        0.0001,
        0.0002,
        "not_applicable",
      ),
    ],
    denominatorCountBand: "1000-9999",
    endpoint: "major_cardiovascular_event",
    eventCountBand: "100-999",
    evidenceClass: "partner_aggregate_validation",
    evaluatorId: "partner_integrated_wearable_lab_evaluator_v1",
    featureSchemaVersion: "murph-age-partner-wearable-feature-schema.v1",
    horizon: "5y",
    packetId: "partner-receipt-v1",
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

function metric(
  candidateId: R1051PartnerWearableAggregateReceiptInput["candidateMetrics"][number]["candidateId"],
  comparatorId: R1051PartnerWearableAggregateReceiptInput["candidateMetrics"][number]["comparatorId"],
  role: R1051PartnerWearableAggregateReceiptInput["candidateMetrics"][number]["role"],
  brierDelta: number,
  logLossDelta: number,
  negativeControlStatus: R1051PartnerWearableAggregateReceiptInput["candidateMetrics"][number]["negativeControlStatus"],
): R1051PartnerWearableAggregateReceiptInput["candidateMetrics"][number] {
  return {
    aucDelta: brierDelta < 0 ? 0.01 : 0,
    brierDelta,
    calibrationSlope: 1.01,
    candidateId,
    comparatorId,
    deviceProviderCalibrationStatus: "stable",
    eOverO: 0.99,
    logLossDelta,
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
