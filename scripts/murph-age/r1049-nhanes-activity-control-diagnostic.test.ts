import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1049_NHANES_ACTIVITY_CONTROL_DIAGNOSTIC_SCHEMA_VERSION,
  runR1049NhanesActivityControlDiagnostic,
} from "./r1049-nhanes-activity-control-diagnostic.ts";

describe("R1049 NHANES activity control diagnostic", () => {
  it("keeps C8 as shadow activity evidence when controls are clean but global calibration is limited", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1049-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR1049NhanesActivityControlDiagnostic({
        createdAt: "2026-05-13T00:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1049-nhanes-activity-control-diagnostic.latest.json");
      expect(output.schemaVersion).toBe(R1049_NHANES_ACTIVITY_CONTROL_DIAGNOSTIC_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.activityIncrement.properScoreStatusAcrossReceipts).toBe("stable_improvement");
      expect(output.negativeControlDiagnostic.status).toBe("beaten");
      expect(output.negativeControlDiagnostic.logLossMarginVsBestControl).toBeCloseTo(-0.01361409, 8);
      expect(output.calibrationDiagnostic.blocker).toBe("global_e_over_o_underprediction");
      expect(output.shadowCarryForward).toEqual({
        activityCandidate: "C8_lab9_hba1c_bp_body_activity_primary",
        clinicalCandidate: "C3_lab9_hba1c_bp_body_primary",
        scoreBearingPromotionAuthorized: false,
      });
      expect(output.decision).toEqual({
        conclusion: "nhanes_activity_signal_control_clean_global_calibration_limited",
        nextAction: "carry_c8_as_shadow_activity_evidence_seek_external_wearable_validation",
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        rationale: "Aggregate NHANES activity improves proper scores and beats controls, but expected/observed underprediction is shared across candidates.",
        reviewGptRequiredBeforeNextLocalRun: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("participantIds");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"rowValues\":");
      expect(persisted).not.toContain("\"sourceText\"");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("holds activity when controls compete with the real activity increment", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1049-controls-"));
    try {
      const baseCalibratedReceipt = calibratedReceiptFixture();
      const baseComparisons = baseCalibratedReceipt.comparisons as Record<string, unknown>;
      const paths = await writeFixtureArtifacts(tmp, {
        calibratedReceiptPatch: {
          comparisons: {
            ...baseComparisons,
            N3_vs_C3: comparison(
              "N3_lab9_hba1c_bp_body_cycle_context_only",
              "C3_lab9_hba1c_bp_body_primary",
              0.001,
              -0.005,
              -0.02,
            ),
          },
          negativeControls: {
            C8BeatsAllThreeOnWeightedProperScores: false,
          },
        },
      });
      const { output } = await runR1049NhanesActivityControlDiagnostic(paths);

      expect(output.negativeControlDiagnostic.status).toBe("competed");
      expect(output.shadowCarryForward.activityCandidate).toBeNull();
      expect(output.decision.conclusion).toBe("nhanes_activity_signal_control_competed");
      expect(output.decision.nextAction).toBe("keep_c3_lab_body_bp_primary_and_continue_external_lab_transport");
      expect(output.decision.reviewGptRequiredBeforeNextLocalRun).toBe(false);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("emits a missing-receipt diagnostic instead of parsing rows", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1049-missing-"));
    try {
      const { output } = await runR1049NhanesActivityControlDiagnostic({
        outputDir: tmp,
        r1034ReducerPath: path.join(tmp, "missing-r1034.json"),
        r1038CalibratedReceiptPath: path.join(tmp, "missing-calibrated.json"),
        r1038LoopPath: path.join(tmp, "missing-loop.json"),
      });

      expect(output.inputArtifacts.r1034Reducer.status).toBe("missing");
      expect(output.inputArtifacts.r1038CalibratedReceipt.status).toBe("missing");
      expect(output.inputArtifacts.r1038Loop.status).toBe("missing");
      expect(output.decision.conclusion).toBe("nhanes_activity_receipt_missing");
      expect(output.artifactBoundary.rowParsingPerformedByR1049).toBe(false);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks unsafe aggregate inputs", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1049-unsafe-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      await writeJson(paths.r1038LoopPath, {
        ...r1038LoopFixture(),
        rowValues: [{ notAllowed: true }],
      });

      await expect(runR1049NhanesActivityControlDiagnostic(paths)).rejects.toThrow(
        "R1049 input R1038 loop failed aggregate boundary validation",
      );
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not echo unsafe packet IDs, schema strings, or candidate keys", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1049-keys-"));
    try {
      const baseCalibratedReceipt = calibratedReceiptFixture();
      const baseComparisons = baseCalibratedReceipt.comparisons as Record<string, unknown>;
      const baseLoop = r1038LoopFixture();
      const baseCompatibleReceipt = baseLoop.r1034CompatibleReceipt as {
        candidateMetrics: unknown[];
      };
      const paths = await writeFixtureArtifacts(tmp, {
        calibratedReceiptPatch: {
          comparisons: {
            ...baseComparisons,
            [`${tmp}/comparison-key`]: comparison(`${tmp}/candidate-key`, "C3_lab9_hba1c_bp_body_primary", 1, -1, -1),
          },
          packetId: `${tmp}/packet`,
          schemaVersion: `${tmp}/schema`,
        },
        loopPatch: {
          packetId: `${tmp}/packet`,
          r1034CompatibleReceipt: {
            ...baseCompatibleReceipt,
            candidateMetrics: [
              ...baseCompatibleReceipt.candidateMetrics,
              {
                aucDelta: 1,
                brierDelta: -1,
                calibrationSlope: 1,
                candidateId: `${tmp}/candidate-key`,
                comparatorId: "C3_lab9_hba1c_bp_body_primary",
                eOverO: 1,
                logLossDelta: -1,
              },
            ],
          },
          schemaVersion: `${tmp}/schema`,
        },
        reducerPatch: {
          packetId: `${tmp}/packet`,
          schemaVersion: `${tmp}/schema`,
        },
      });
      const { output, outputPath } = await runR1049NhanesActivityControlDiagnostic(paths);
      const persisted = await readFile(outputPath, "utf8");

      expect(output.inputArtifacts.r1038Loop.packetId).toBeNull();
      expect(output.inputArtifacts.r1038Loop.schemaVersion).toBeNull();
      expect(output.inputArtifacts.r1038CalibratedReceipt.packetId).toBeNull();
      expect(output.inputArtifacts.r1034Reducer.packetId).toBeNull();
      expect(persisted).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1049-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1049-nhanes-activity-control-diagnostic.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1034_REDUCER_PATH: paths.r1034ReducerPath,
          MURPH_AGE_R1038_CALIBRATED_RECEIPT_PATH: paths.r1038CalibratedReceiptPath,
          MURPH_AGE_R1038_LOOP_PATH: paths.r1038LoopPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        activityStatus: "stable_improvement",
        artifact: "r1049-nhanes-activity-control-diagnostic.latest.json",
        calibrationBlocker: "global_e_over_o_underprediction",
        conclusion: "nhanes_activity_signal_control_clean_global_calibration_limited",
        negativeControlStatus: "beaten",
        nextAction: "carry_c8_as_shadow_activity_evidence_seek_external_wearable_validation",
        packetId: "r1049-nhanes-activity-control-diagnostic",
        productDisplayAuthorized: false,
        reviewGptRequiredBeforeNextLocalRun: false,
        schemaVersion: R1049_NHANES_ACTIVITY_CONTROL_DIAGNOSTIC_SCHEMA_VERSION,
        shadowActivityCandidate: "C8_lab9_hba1c_bp_body_activity_primary",
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

async function writeFixtureArtifacts(
  tmp: string,
  patches: {
    calibratedReceiptPatch?: Record<string, unknown>;
    loopPatch?: Record<string, unknown>;
    reducerPatch?: Record<string, unknown>;
  } = {},
): Promise<{
  outputDir: string;
  r1034ReducerPath: string;
  r1038CalibratedReceiptPath: string;
  r1038LoopPath: string;
}> {
  const outputDir = path.join(tmp, "out");
  await mkdir(outputDir, { recursive: true });
  const paths = {
    outputDir,
    r1034ReducerPath: path.join(tmp, "r1034.json"),
    r1038CalibratedReceiptPath: path.join(tmp, "r1038-calibrated.json"),
    r1038LoopPath: path.join(tmp, "r1038-loop.json"),
  };
  await writeJson(paths.r1038LoopPath, {
    ...r1038LoopFixture(),
    ...patches.loopPatch,
  });
  await writeJson(paths.r1038CalibratedReceiptPath, {
    ...calibratedReceiptFixture(),
    ...patches.calibratedReceiptPatch,
  });
  await writeJson(paths.r1034ReducerPath, {
    ...r1034ReducerFixture(),
    ...patches.reducerPatch,
  });
  return paths;
}

function r1038LoopFixture(): Record<string, unknown> {
  return {
    artifactBoundary: boundaryFixture(),
    packetId: "r1038-nhanes-modern-lab-activity-loop",
    r1034CompatibleReceipt: {
      artifactBoundary: boundaryFixture(),
      candidateMetrics: [
        compatibleMetric("C3_lab9_hba1c_bp_body_primary", "R1_age_sex_bp_body_reference", 0.05, -0.0076, -0.036, 1.01, 0.82),
        compatibleMetric("C8_lab9_hba1c_bp_body_activity_primary", "C3_lab9_hba1c_bp_body_primary", -0.0007, -0.0046, -0.0102, 0.99, 0.84),
        compatibleMetric("N1_coverage_quality_only_negative_control", "C3_lab9_hba1c_bp_body_primary", 0.0001, 0.0001, 0.0002, 1.01, 0.82),
      ],
    },
    schemaVersion: "murph-age-r1038-nhanes-modern-lab-activity-loop.v1",
    status: "research-local-aggregate-only",
  };
}

function calibratedReceiptFixture(): Record<string, unknown> {
  return {
    artifactBoundary: boundaryFixture(),
    candidateMetrics: [
      testMetric("C3_lab9_hba1c_bp_body_primary", 1.03, 0.77051227),
      testMetric("C8_lab9_hba1c_bp_body_activity_primary", 1.01, 0.76950512),
      testMetric("N1_lab9_hba1c_bp_body_coverage_only", 1.01, 0.7701),
      testMetric("N2_lab9_hba1c_bp_body_shuffled_activity", 1.01, 0.7698),
      testMetric("N3_lab9_hba1c_bp_body_cycle_context_only", 1.01, 0.7705),
    ],
    comparisons: {
      C8_vs_C3: comparison(
        "C8_lab9_hba1c_bp_body_activity_primary",
        "C3_lab9_hba1c_bp_body_primary",
        0.00663423,
        -0.00480254,
        -0.01370191,
      ),
      N1_vs_C3: comparison(
        "N1_lab9_hba1c_bp_body_coverage_only",
        "C3_lab9_hba1c_bp_body_primary",
        -0.00054057,
        0.00001553,
        0.00010849,
      ),
      N2_vs_C3: comparison(
        "N2_lab9_hba1c_bp_body_shuffled_activity",
        "C3_lab9_hba1c_bp_body_primary",
        -0.0046194,
        -0.00023285,
        0.00006252,
      ),
      N3_vs_C3: comparison(
        "N3_lab9_hba1c_bp_body_cycle_context_only",
        "C3_lab9_hba1c_bp_body_primary",
        -0.00255541,
        -0.00026356,
        -0.00008782,
      ),
    },
    negativeControls: {
      C8BeatsAllThreeOnWeightedProperScores: true,
    },
    packetId: "r1038-nhanes-modern-lab-activity-calibrated-receipt",
    schemaVersion: "murph-age-r1038-nhanes-modern-lab-activity-calibrated-receipt.v1",
    status: "research-local-aggregate-only",
  };
}

function r1034ReducerFixture(): Record<string, unknown> {
  return {
    artifactBoundary: boundaryFixture(),
    packetId: "r1034-labs-wearables-aggregate-reducer",
    reduction: {
      conclusion: "no_meaningful_delta_keep_shadow_or_reference",
      reviewGptRequired: false,
    },
    schemaVersion: "murph-age-r1034-labs-wearables-aggregate-reducer.v1",
    status: "research-local-aggregate-only",
  };
}

function compatibleMetric(
  candidateId: string,
  comparatorId: string,
  aucDelta: number,
  brierDelta: number,
  logLossDelta: number,
  calibrationSlope: number,
  eOverO: number,
): Record<string, unknown> {
  return {
    aucDelta,
    brierDelta,
    calibrationSlope,
    candidateId,
    comparatorId,
    eOverO,
    logLossDelta,
  };
}

function comparison(
  candidate: string,
  baseline: string,
  aucDelta: number,
  brierWeightedDelta: number,
  logLossWeightedDelta: number,
): Record<string, unknown> {
  return {
    auc_delta: aucDelta,
    baseline,
    brier_weighted_delta: brierWeightedDelta,
    candidate,
    log_loss_weighted_delta: logLossWeightedDelta,
  };
}

function testMetric(modelId: string, calibrationSlope: number, eOverO: number): Record<string, unknown> {
  return {
    model_id: modelId,
    parameters_exported: false,
    predictions_exported: false,
    test_metrics: {
      calibration_slope: calibrationSlope,
      expected_observed_ratio_weighted: eOverO,
    },
  };
}

function boundaryFixture(): Record<string, false | true> {
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
    recommendationClaimsIncluded: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
