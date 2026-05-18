import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  runR1104ConsumerAggregateReceiptValidator,
  type R1104ConsumerAggregateReceiptInput,
} from "./r1104-consumer-aggregate-receipt-validator.ts";

describe("R1104 consumer aggregate receipt validator", () => {
  it("waits cleanly when no aggregate receipt is present", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1104-"));

    const { output } = await runR1104ConsumerAggregateReceiptValidator({
      createdAt: "2026-05-15T00:00:00.000Z",
      outputDir: path.join(tmp, "out"),
    });

    expect(output.summary).toMatchObject({
      conclusion: "aggregate_receipt_missing",
      productDisplayAuthorized: false,
      reviewGptUse: "only_for_valid_scientific_delta",
      rowParsingPerformedByR1104: false,
    });
    expect(output.reduction.reviewGptRequired).toBe(false);
  });

  it("routes a threshold-clearing lab receipt to ReviewGPT science review", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1104-"));

    const { output } = await runR1104ConsumerAggregateReceiptValidator({
      aggregateReceipt: receiptFixture({
        aucDelta: 0.006,
        brierDelta: -0.0006,
        candidateId: "L1_tiny_glycemia_only",
        candidateKind: "lab",
        logLossDelta: -0.0021,
      }),
      outputDir: path.join(tmp, "out"),
    });

    expect(output.summary.conclusion).toBe("aggregate_receipt_ready_for_reviewgpt");
    expect(output.reduction.candidateDecisions[0]).toMatchObject({
      candidateId: "L1_tiny_glycemia_only",
      decision: "send_reviewgpt_science_delta",
      thresholdReason: "aggregate_threshold_cleared",
    });
  });

  it("holds a safe but under-threshold wearable receipt", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1104-"));

    const { output } = await runR1104ConsumerAggregateReceiptValidator({
      aggregateReceipt: receiptFixture({
        aucDelta: 0.004,
        brierDelta: -0.0006,
        candidateId: "W1_activity_steps_minutes",
        candidateKind: "wearable",
        logLossDelta: -0.0022,
      }),
      outputDir: path.join(tmp, "out"),
    });

    expect(output.summary.conclusion).toBe("aggregate_receipt_valid_but_no_delta");
    expect(output.reduction.candidateDecisions[0]).toMatchObject({
      candidateId: "W1_activity_steps_minutes",
      decision: "hold_or_reject",
      thresholdReason: "aggregate_threshold_not_cleared",
    });
  });

  it("rejects unsafe receipt egress", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1104-"));

    await expect(runR1104ConsumerAggregateReceiptValidator({
      aggregateReceipt: {
        ...receiptFixture({
          aucDelta: 0.006,
          brierDelta: -0.0006,
          candidateId: "L1_tiny_glycemia_only",
          candidateKind: "lab",
          logLossDelta: -0.0021,
        }),
        artifactBoundary: {
          ...safeBoundary(),
          rowValuesStored: true,
        },
      },
      outputDir: path.join(tmp, "out"),
    })).rejects.toThrow("R1104 rejected unsafe aggregate receipt");
  });

  it("validates receipt files from disk without exposing rows", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1104-"));
    const aggregateReceiptPath = path.join(tmp, "receipt.json");
    await writeJson(aggregateReceiptPath, receiptFixture({
      aucDelta: 0.006,
      brierDelta: -0.0006,
      candidateId: "L1_tiny_glycemia_only",
      candidateKind: "lab",
      logLossDelta: -0.0021,
    }));

    const { output } = await runR1104ConsumerAggregateReceiptValidator({
      aggregateReceiptPath,
      outputDir: path.join(tmp, "out"),
    });

    expect(output.inputReceipt.status).toBe("available");
    expect(output.inputReceipt.packetId).toBe("aggregate_receipt_received");
    expect(output.inputReceipt.candidateCountBand).toBe("1-9");
  });

  it("does not echo arbitrary receipt ids or unsafe key paths", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1104-"));
    const aggregateReceiptPath = path.join(tmp, "unsafe-receipt.json");
    await writeJson(aggregateReceiptPath, {
      ...receiptFixture({
        aucDelta: 0.006,
        brierDelta: -0.0006,
        candidateId: "L1_tiny_glycemia_only",
        candidateKind: "lab",
        logLossDelta: -0.0021,
      }),
      packetId: "local-path-or-person-like-receipt-id",
      unsafeContainer: {
        rowValues: true,
      },
    });

    await expect(runR1104ConsumerAggregateReceiptValidator({
      aggregateReceiptPath,
      outputDir: path.join(tmp, "out"),
    })).rejects.toThrow("R1104 rejected unsafe aggregate receipt: 1 aggregate-egress violation");
  });

  it("rejects unsupported candidate ids without echoing the supplied value", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1104-"));
    const aggregateReceiptPath = path.join(tmp, "unsupported-candidate-receipt.json");
    await writeJson(aggregateReceiptPath, {
      ...receiptFixture({
        aucDelta: 0.006,
        brierDelta: -0.0006,
        candidateId: "L1_tiny_glycemia_only",
        candidateKind: "lab",
        logLossDelta: -0.0021,
      }),
      candidateResults: [
        {
          aucDelta: 0.006,
          brierDelta: -0.0006,
          calibrationStatus: "non_worse",
          candidateId: "local-path-or-person-like-candidate-id",
          candidateKind: "lab",
          comparatorId: "frozen_recalibrated_r399",
          coverageStatus: "consumer_viable",
          evidenceSupport: "one_receipt_100_plus_events",
          logLossDelta: -0.0021,
          missingnessOrCoverageControlStatus: "not_applicable",
        },
      ],
    });

    await expect(runR1104ConsumerAggregateReceiptValidator({
      aggregateReceiptPath,
      outputDir: path.join(tmp, "out"),
    })).rejects.toThrow("R1104 aggregate receipt has an unsupported candidateId.");
  });
});

function receiptFixture(input: {
  aucDelta: number;
  brierDelta: number;
  candidateId: "L1_tiny_glycemia_only" | "W1_activity_steps_minutes";
  candidateKind: "lab" | "wearable";
  logLossDelta: number;
}): R1104ConsumerAggregateReceiptInput {
  return {
    artifactBoundary: safeBoundary(),
    candidateResults: [
      {
        aucDelta: input.aucDelta,
        brierDelta: input.brierDelta,
        calibrationStatus: "non_worse",
        candidateId: input.candidateId,
        candidateKind: input.candidateKind,
        comparatorId: "frozen_recalibrated_r399",
        coverageStatus: "consumer_viable",
        evidenceSupport: "one_receipt_100_plus_events",
        logLossDelta: input.logLossDelta,
        missingnessOrCoverageControlStatus: input.candidateKind === "wearable" ? "beaten" : "not_applicable",
      },
    ],
    evaluatorId: "consumer_lab_wearable_aggregate_evaluator_v1",
    packetId: "mock-consumer-aggregate-receipt",
    receiptAttestations: {
      aggregateOnly: true,
      endpointFrozenBeforeScoring: true,
      evaluatorFrozenBeforeExecution: true,
      noCoefficientEgress: true,
      noParticipantEgress: true,
      noPredictionEgress: true,
      noRowEgress: true,
      noSmallCellEgress: true,
      sameDenominatorComparisons: true,
    },
    schemaVersion: "murph-age-consumer-lab-wearable-aggregate-receipt.v1",
  };
}

function safeBoundary(): R1104ConsumerAggregateReceiptInput["artifactBoundary"] {
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

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
