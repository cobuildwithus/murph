import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  assertR1034Safe,
  R1034_LABS_WEARABLES_AGGREGATE_REDUCER_SCHEMA_VERSION,
  runR1034LabsWearablesAggregateReducer,
  type R1034AggregateReceiptInput,
} from "./r1034-labs-wearables-aggregate-reducer.ts";

describe("R1034 labs/wearables aggregate reducer", () => {
  it("blocks when no aggregate receipt exists", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1034-missing-"));
    try {
      const { output } = await runR1034LabsWearablesAggregateReducer({
        outputDir: path.join(tmp, "out"),
      });

      expect(output.schemaVersion).toBe(R1034_LABS_WEARABLES_AGGREGATE_REDUCER_SCHEMA_VERSION);
      expect(output.summary).toEqual({
        conclusion: "aggregate_receipt_missing",
        productDisplayAuthorized: false,
        reviewGptRequired: false,
        rowParsingPerformedByR1034: false,
      });
      expect(output.inputReceipt).toMatchObject({
        candidateCountBand: "0",
        status: "missing",
      });
      expect(output.reduction.candidateDecisions).toEqual([]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes meaningful aggregate deltas to ReviewGPT without promoting locally", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1034-ready-"));
    try {
      const { output } = await runR1034LabsWearablesAggregateReducer({
        aggregateReceipt: receiptFixture(),
        outputDir: path.join(tmp, "out"),
      });

      expect(output.summary.conclusion).toBe("aggregate_delta_ready_for_reviewgpt");
      expect(output.summary.reviewGptRequired).toBe(true);
      expect(output.inputReceipt).toMatchObject({
        benchmarkCardId: "nhanes_lab_activity_mortality_v1",
        candidateCountBand: "1-9",
        endpoint: "all_cause_mortality",
        eventCountBand: "1000+",
        horizon: "10y_ipcw",
        status: "available",
      });
      expect(output.reduction.candidateDecisions).toEqual([
        {
          calibrationAcceptable: true,
          candidateId: "A4_lab9_bp_body_plus_activity_volume",
          comparatorId: "A3_lab9_bp_body",
          decision: "send_reviewgpt_aggregate_delta",
          negativeControlBeaten: true,
          properScoresImproved: true,
          role: "score_bearing_research_candidate",
          subgroupCalibrationAcceptable: true,
        },
        {
          calibrationAcceptable: true,
          candidateId: "A8_shuffled_activity_negative_control",
          comparatorId: "A3_lab9_bp_body",
          decision: "keep_shadow_or_reference",
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

  it("holds candidates that improve discrimination but fail calibration", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1034-hold-"));
    try {
      const receipt = receiptFixture();
      receipt.candidateMetrics[0] = {
        ...receipt.candidateMetrics[0]!,
        calibrationSlope: 1.24,
        eOverO: 1.12,
      };
      const { output } = await runR1034LabsWearablesAggregateReducer({
        aggregateReceipt: receipt,
        outputDir: path.join(tmp, "out"),
      });

      expect(output.summary.conclusion).toBe("no_meaningful_delta_keep_shadow_or_reference");
      expect(output.summary.reviewGptRequired).toBe(false);
      expect(output.reduction.candidateDecisions[0]).toMatchObject({
        calibrationAcceptable: false,
        decision: "reject_or_hold_candidate",
        properScoresImproved: true,
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe aggregate receipts", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1034-unsafe-"));
    try {
      await expect(runR1034LabsWearablesAggregateReducer({
        aggregateReceipt: {
          ...receiptFixture(),
          artifactBoundary: {
            ...safeBoundary(),
            coefficientsStored: true,
          },
        },
        outputDir: path.join(tmp, "out"),
      })).rejects.toThrow("R1034 input aggregate receipt failed safety validation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed if a reduced packet mutates into product display", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1034-mutated-"));
    try {
      const { output } = await runR1034LabsWearablesAggregateReducer({
        aggregateReceipt: receiptFixture(),
        outputDir: path.join(tmp, "out"),
      });
      const unsafe = {
        ...output,
        summary: {
          ...output.summary,
          productDisplayAuthorized: true,
        },
      };

      expect(() => assertR1034Safe(unsafe as never)).toThrow("R1034 labs/wearables aggregate reducer failed safety validation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1034-cli-"));
    try {
      const receiptPath = path.join(tmp, "receipt.json");
      await writeFile(receiptPath, `${JSON.stringify(receiptFixture())}\n`);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1034-labs-wearables-aggregate-reducer.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1034_AGGREGATE_RECEIPT_PATH: receiptPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        candidateCountBand: "1-9",
        conclusion: "aggregate_delta_ready_for_reviewgpt",
        packetId: "r1034-labs-wearables-aggregate-reducer",
        productDisplayAuthorized: false,
        reviewGptRequired: true,
        rowParsingPerformedByR1034: false,
        schemaVersion: R1034_LABS_WEARABLES_AGGREGATE_REDUCER_SCHEMA_VERSION,
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

function receiptFixture(): R1034AggregateReceiptInput {
  return {
    artifactBoundary: safeBoundary(),
    benchmarkCardId: "nhanes_lab_activity_mortality_v1",
    candidateMetrics: [
      {
        aucDelta: 0.01,
        brierDelta: -0.001,
        calibrationSlope: 0.97,
        candidateId: "A4_lab9_bp_body_plus_activity_volume",
        comparatorId: "A3_lab9_bp_body",
        eOverO: 1.01,
        logLossDelta: -0.003,
        negativeControlStatus: "beaten",
        role: "score_bearing_research_candidate",
        subgroupCalibrationStatus: "stable",
      },
      {
        aucDelta: 0,
        brierDelta: 0.0001,
        calibrationSlope: 1,
        candidateId: "A8_shuffled_activity_negative_control",
        comparatorId: "A3_lab9_bp_body",
        eOverO: 1,
        logLossDelta: 0.0002,
        negativeControlStatus: "not_applicable",
        role: "negative_control",
        subgroupCalibrationStatus: "stable",
      },
    ],
    endpoint: "all_cause_mortality",
    eventCountBand: "1000+",
    horizon: "10y_ipcw",
    packetId: "synthetic-aggregate-receipt",
    schemaVersion: "murph-age-synthetic-aggregate-receipt.v1",
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
