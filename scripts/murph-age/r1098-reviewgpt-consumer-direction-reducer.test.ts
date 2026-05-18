import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runR1098ReviewGptConsumerDirectionReducer } from "./r1098-reviewgpt-consumer-direction-reducer.ts";

describe("R1098 ReviewGPT consumer direction reducer", () => {
  it("accepts the high-level ReviewGPT direction when it aligns with the local route and template chain", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1098-"));
    const paths = await writeFixtures(tmp, true);

    const { output } = await runR1098ReviewGptConsumerDirectionReducer({
      createdAt: "2026-05-15T00:00:00.000Z",
      outputDir: path.join(tmp, "out"),
      ...paths,
    });

    expect(output.summary).toMatchObject({
      conclusion: "reviewgpt_direction_aligned_consumer_lab_wearable_route_locked",
      nextLocalAction: "annotate_age_subbands_and_continue_aggregate_receipt_path",
      productDisplayAuthorized: false,
      reviewGptUse: "next_only_for_valid_scientific_delta_or_major_architecture_question",
      rowParsingPerformedByR1098: false,
    });
    expect(output.reducedDecision).toMatchObject({
      ageEvidenceSubbands: ["16_17", "18_39", "40_50"],
      candidateDecision: "keep_common_lab_core_shadow",
      modelShape: "nested_source_aware_horizon_specific_prognosis_models",
      nhanesRole: "public_bridge_not_true_wearable_certification",
      routeDecision: "all_of_us_or_partner_workbench_first_nhanes_bridge_ukb_supporting",
      wearableStatus: "blocked_until_true_consumer_outcome_linked_aggregate_receipt",
    });
  });

  it("blocks when ReviewGPT does not approve the candidate direction", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1098-"));
    const paths = await writeFixtures(tmp, false);

    const { output } = await runR1098ReviewGptConsumerDirectionReducer({
      outputDir: path.join(tmp, "out"),
      ...paths,
    });

    expect(output.summary.conclusion).toBe("reviewgpt_direction_missing_or_misaligned");
    expect(output.reducedDecision.routeDecision).toBe("blocked_missing_reviewgpt_or_local_alignment");
  });

  it("rejects unsafe aggregate inputs", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1098-"));
    const reviewGptPath = path.join(tmp, "unsafe.json");
    await writeJson(reviewGptPath, {
      decision: "approve_direction",
      rowValuesStored: true,
    });

    await expect(runR1098ReviewGptConsumerDirectionReducer({
      outputDir: path.join(tmp, "out"),
      reviewGptPath,
    })).rejects.toThrow("R1098 rejected unsafe reviewGpt input");
  });
});

async function writeFixtures(tmp: string, ready: boolean): Promise<{
  reviewGptPath: string;
  r1096Path: string;
  r1097Path: string;
}> {
  const paths = {
    reviewGptPath: path.join(tmp, "reviewgpt.json"),
    r1096Path: path.join(tmp, "r1096.json"),
    r1097Path: path.join(tmp, "r1097.json"),
  };

  await Promise.all([
    writeJson(paths.reviewGptPath, reviewGptFixture(ready)),
    writeJson(paths.r1096Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1096-consumer-validation-route-priority",
      schemaVersion: "murph-age-r1096-consumer-validation-route-priority.v1",
      summary: {
        conclusion: "consumer_lab_wearable_validation_routes_ranked",
      },
    }),
    writeJson(paths.r1097Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1097-consumer-lab-wearable-aggregate-template",
      schemaVersion: "murph-age-r1097-consumer-lab-wearable-aggregate-template.v1",
      summary: {
        conclusion: "consumer_lab_wearable_template_ready_for_data_holder_fill",
      },
    }),
  ]);

  return paths;
}

function reviewGptFixture(ready: boolean): Record<string, unknown> {
  return {
    age_domain_guard: {
      verdict: ready ? "correct" : "too_loose",
    },
    candidate_shape: {
      keep_common_lab_core_shadow: ready,
    },
    decision: ready ? "approve_direction" : "reject_direction",
    next_validation_priority: [
      {
        rank: 1,
        route: "All of Us / partner Workbench aggregate receipt: Fitbit + EHR labs + physical measurements + outcomes",
      },
    ],
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
