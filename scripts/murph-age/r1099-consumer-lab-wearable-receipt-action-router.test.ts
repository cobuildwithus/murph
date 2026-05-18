import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runR1099ConsumerLabWearableReceiptActionRouter } from "./r1099-consumer-lab-wearable-receipt-action-router.ts";

describe("R1099 consumer lab/wearable receipt action router", () => {
  it("keeps the loop blocked on a consumer labs/wearables aggregate receipt when no receipt has landed", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1099-"));
    const paths = await writeFixtures(tmp, "missing");

    const { output } = await runR1099ConsumerLabWearableReceiptActionRouter({
      createdAt: "2026-05-15T00:00:00.000Z",
      outputDir: path.join(tmp, "out"),
      ...paths,
    });

    expect(output.summary).toMatchObject({
      conclusion: "await_consumer_lab_wearable_aggregate_receipt",
      nextAction: "await_or_collect_all_of_us_or_partner_workbench_aggregate_receipt",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1099: false,
    });
    expect(output.currentState).toMatchObject({
      aggregateReceiptStatus: "missing",
      consumerInputPriority: "bloodwork_labs_vitals_body_wearables_for_roughly_16_50",
      directionStatus: "aligned",
      templateStatus: "ready",
    });
    expect(output.nextLoop.routeTargets.slice(0, 3)).toEqual([
      "all-of-us-fitbit-labs-ehr",
      "cardia-authorized-or-aggregate",
      "partner-aggregate-evaluator",
    ]);
    expect(output.nextLoop.ageEvidenceSubbands).toEqual(["16_17", "18_39", "40_50"]);
    expect(output.nextLoop.reviewGptUse).toBe("only_after_valid_scientific_delta_or_major_architecture_question");
  });

  it("routes a valid model-improving labs/wearables receipt to ReviewGPT for science interpretation", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1099-"));
    const paths = await writeFixtures(tmp, "ready_for_reviewgpt");

    const { output } = await runR1099ConsumerLabWearableReceiptActionRouter({
      outputDir: path.join(tmp, "out"),
      ...paths,
    });

    expect(output.summary).toMatchObject({
      conclusion: "send_consumer_lab_wearable_delta_to_reviewgpt",
      nextAction: "send_valid_consumer_lab_wearable_delta_to_reviewgpt",
      reviewGptRequiredNow: true,
    });
    expect(output.nextLoop.commands.join(" ")).toContain("aggregate-only consumer labs/wearables delta");
    expect(output.inputArtifacts.r1104.status).toBe("available");
  });

  it("holds a safe receipt that does not produce a model-improving delta", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1099-"));
    const paths = await writeFixtures(tmp, "valid_but_no_delta");

    const { output } = await runR1099ConsumerLabWearableReceiptActionRouter({
      outputDir: path.join(tmp, "out"),
      ...paths,
    });

    expect(output.summary).toMatchObject({
      conclusion: "hold_consumer_lab_wearable_receipt_no_model_change",
      nextAction: "hold_receipt_no_model_change_continue_source_search",
      reviewGptRequiredNow: false,
    });
    expect(output.currentState.aggregateReceiptStatus).toBe("valid_but_no_delta");
  });

  it("continues waiting when a safe receipt lacks consumer-viable score-bearing coverage", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1099-"));
    const paths = await writeFixtures(tmp, "coverage_insufficient");

    const { output } = await runR1099ConsumerLabWearableReceiptActionRouter({
      outputDir: path.join(tmp, "out"),
      ...paths,
    });

    expect(output.summary).toMatchObject({
      conclusion: "await_consumer_lab_wearable_aggregate_receipt",
      nextAction: "await_or_collect_all_of_us_or_partner_workbench_aggregate_receipt",
      reviewGptRequiredNow: false,
    });
    expect(output.currentState.aggregateReceiptStatus).toBe("coverage_insufficient");
    expect(output.nextLoop.decision.why).toContain("consumer-viable coverage");
  });


  it("falls back to the older R1059 wearable receipt state when no R1104 consumer receipt delta has landed", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1099-"));
    const paths = await writeFixtures(tmp, "missing");
    await writeJson(paths.r1059Path, r1059Fixture("ready_for_reviewgpt"));

    const { output } = await runR1099ConsumerLabWearableReceiptActionRouter({
      outputDir: path.join(tmp, "out"),
      ...paths,
    });

    expect(output.summary).toMatchObject({
      conclusion: "send_consumer_lab_wearable_delta_to_reviewgpt",
      nextAction: "send_valid_consumer_lab_wearable_delta_to_reviewgpt",
      reviewGptRequiredNow: true,
    });
    expect(output.currentState.aggregateReceiptStatus).toBe("ready_for_reviewgpt");
  });

  it("repairs the consumer direction/template chain before accepting receipts", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1099-"));
    const paths = await writeFixtures(tmp, "ready_for_reviewgpt", false);

    const { output } = await runR1099ConsumerLabWearableReceiptActionRouter({
      outputDir: path.join(tmp, "out"),
      ...paths,
    });

    expect(output.summary).toMatchObject({
      conclusion: "repair_consumer_direction_or_template",
      nextAction: "repair_consumer_direction_or_template",
      reviewGptRequiredNow: false,
    });
    expect(output.currentState.directionStatus).toBe("missing_or_misaligned");
  });

  it("rejects unsafe aggregate inputs before routing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1099-"));
    const paths = await writeFixtures(tmp, "missing");
    await writeJson(paths.r1097Path, {
      packetId: "r1097-consumer-lab-wearable-aggregate-template",
      rowValuesStored: true,
      schemaVersion: "murph-age-r1097-consumer-lab-wearable-aggregate-template.v1",
    });

    await expect(runR1099ConsumerLabWearableReceiptActionRouter({
      outputDir: path.join(tmp, "out"),
      ...paths,
    })).rejects.toThrow("R1099 rejected unsafe r1097 input");
  });
});

type ReceiptState = "coverage_insufficient" | "missing" | "ready_for_reviewgpt" | "valid_but_no_delta";

async function writeFixtures(
  tmp: string,
  receiptState: ReceiptState,
  aligned = true,
): Promise<{
  r1059Path: string;
  r1097Path: string;
  r1098Path: string;
  r1104Path: string;
}> {
  const paths = {
    r1059Path: path.join(tmp, "r1059.json"),
    r1097Path: path.join(tmp, "r1097.json"),
    r1098Path: path.join(tmp, "r1098.json"),
    r1104Path: path.join(tmp, "r1104.json"),
  };

  await Promise.all([
    writeJson(paths.r1059Path, r1059Fixture("missing")),
    writeJson(paths.r1097Path, r1097Fixture(aligned)),
    writeJson(paths.r1098Path, r1098Fixture(aligned)),
    writeJson(paths.r1104Path, r1104Fixture(receiptState)),
  ]);

  return paths;
}

function r1059Fixture(receiptState: ReceiptState): Record<string, unknown> {
  const conclusion = receiptState === "ready_for_reviewgpt"
    ? "aggregate_receipt_ready_for_reviewgpt"
    : receiptState === "valid_but_no_delta"
      ? "aggregate_receipt_valid_but_no_delta"
      : "aggregate_receipt_missing";
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1059-true-wearable-aggregate-receipt-intake",
    schemaVersion: "murph-age-r1059-true-wearable-aggregate-receipt-intake.v1",
    summary: {
      conclusion,
      productDisplayAuthorized: false,
      rowParsingPerformedByR1059: false,
    },
  };
}

function r1104Fixture(receiptState: ReceiptState): Record<string, unknown> {
  const conclusion = receiptState === "ready_for_reviewgpt"
    ? "aggregate_receipt_ready_for_reviewgpt"
    : receiptState === "valid_but_no_delta" || receiptState === "coverage_insufficient"
      ? "aggregate_receipt_valid_but_no_delta"
      : "aggregate_receipt_missing";
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1104-consumer-aggregate-receipt-validator",
    schemaVersion: "murph-age-r1104-consumer-aggregate-receipt-validator.v1",
    summary: {
      conclusion,
      productDisplayAuthorized: false,
      rowParsingPerformedByR1104: false,
    },
    ...(receiptState === "coverage_insufficient"
      ? {
        reduction: {
          candidateDecisions: [
            {
              candidateId: "L1_tiny_glycemia_only",
              coverageAcceptable: false,
            },
            {
              candidateId: "L2_common_lab_core_shadow",
              coverageAcceptable: false,
            },
            {
              candidateId: "QC_missingness_coverage",
              coverageAcceptable: true,
            },
          ],
        },
      }
      : {}),
  };
}

function r1097Fixture(aligned: boolean): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1097-consumer-lab-wearable-aggregate-template",
    schemaVersion: "murph-age-r1097-consumer-lab-wearable-aggregate-template.v1",
    summary: {
      conclusion: aligned
        ? "consumer_lab_wearable_template_ready_for_data_holder_fill"
        : "consumer_lab_wearable_template_blocked_missing_route_or_candidate",
      productDisplayAuthorized: false,
      rowParsingPerformedByR1097: false,
      templateReadyForDataFill: aligned,
    },
    templateBundle: {
      targetRoutes: [
        "all-of-us-fitbit-labs-ehr",
        "partner-aggregate-evaluator",
        "midus-biomarker-mortality",
        "nhanes-activity-shadow-lmf",
        "uk-biobank-integrated",
      ],
    },
  };
}

function r1098Fixture(aligned: boolean): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1098-reviewgpt-consumer-direction-reducer",
    reducedDecision: {
      ageEvidenceSubbands: ["16_17", "18_39", "40_50"],
      candidateDecision: "keep_common_lab_core_shadow",
      wearableStatus: "blocked_until_true_consumer_outcome_linked_aggregate_receipt",
    },
    schemaVersion: "murph-age-r1098-reviewgpt-consumer-direction-reducer.v1",
    summary: {
      conclusion: aligned
        ? "reviewgpt_direction_aligned_consumer_lab_wearable_route_locked"
        : "reviewgpt_direction_missing_or_misaligned",
      productDisplayAuthorized: false,
      rowParsingPerformedByR1098: false,
    },
  };
}

function safeBoundary(): Record<string, unknown> {
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
