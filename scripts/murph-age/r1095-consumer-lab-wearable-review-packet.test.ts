import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runR1095ConsumerLabWearableReviewPacket } from "./r1095-consumer-lab-wearable-review-packet.ts";

describe("R1095 consumer lab/wearable review packet", () => {
  it("builds a high-value ReviewGPT packet from current aggregate state", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1095-"));
    const paths = await writeFixtures(tmp, true);

    const { output } = await runR1095ConsumerLabWearableReviewPacket({
      createdAt: "2026-05-15T00:00:00.000Z",
      outputDir: path.join(tmp, "out"),
      ...paths,
    });

    expect(output.summary).toMatchObject({
      conclusion: "review_packet_ready_for_high_value_reviewgpt",
      nextLocalAction: "send_to_reviewgpt_for_science_direction_critique",
      productDisplayAuthorized: false,
      rowParsingPerformedByR1095: false,
    });
    expect(output.currentDecision).toMatchObject({
      candidateId: "common_lab_core_shadow",
      candidateStatus: "research_shadow_only",
      productDisplayAuthorized: false,
      targetAgeBand: "roughly_16_50",
    });
    expect(output.evidenceSnapshot.blockedWearableFamilies).toEqual([
      "activity_steps_minutes",
      "sleep_duration_regularity",
    ]);
    expect(output.reviewerAsk.questions.map((question) => question.questionId)).toEqual([
      "candidate_shape",
      "external_validation_priority",
      "wearable_unblocker",
      "age_domain_guard",
      "simplicity_risk",
    ]);
  });

  it("blocks packet readiness when the candidate decision is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1095-"));
    const paths = await writeFixtures(tmp, false);

    const { output } = await runR1095ConsumerLabWearableReviewPacket({
      outputDir: path.join(tmp, "out"),
      ...paths,
    });

    expect(output.summary).toMatchObject({
      conclusion: "review_packet_blocked_missing_current_decision",
      nextLocalAction: "repair_consumer_lab_wearable_state",
    });
    expect(output.currentDecision.candidateId).toBe("none");
  });

  it("rejects unsafe aggregate inputs", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1095-"));
    const r1091Path = path.join(tmp, "unsafe.json");
    await writeJson(r1091Path, {
      packetId: "r1091-consumer-input-loop-state",
      rowValuesStored: true,
      schemaVersion: "murph-age-r1091-consumer-input-loop-state.v1",
    });

    await expect(runR1095ConsumerLabWearableReviewPacket({
      outputDir: path.join(tmp, "out"),
      r1091Path,
    })).rejects.toThrow("R1095 rejected unsafe r1091 input");
  });
});

async function writeFixtures(tmp: string, ready: boolean): Promise<{
  r1091Path: string;
  r1092Path: string;
  r1093Path: string;
  r1094Path: string;
}> {
  const paths = {
    r1091Path: path.join(tmp, "r1091.json"),
    r1092Path: path.join(tmp, "r1092.json"),
    r1093Path: path.join(tmp, "r1093.json"),
    r1094Path: path.join(tmp, "r1094.json"),
  };

  await Promise.all([
    writeJson(paths.r1091Path, {
      artifactBoundary: safeBoundary(),
      consumerInputLoop: {
        wearables: {
          blockedFamilies: ["activity_steps_minutes", "sleep_duration_regularity"],
        },
      },
      packetId: "r1091-consumer-input-loop-state",
      schemaVersion: "murph-age-r1091-consumer-input-loop-state.v1",
      summary: {
        conclusion: "consumer_input_loop_ready_for_bloodwork_control_hardening_wearables_blocked",
      },
    }),
    writeJson(paths.r1092Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1092-consumer-bloodwork-control-hardening",
      schemaVersion: "murph-age-r1092-consumer-bloodwork-control-hardening.v1",
      summary: {
        conclusion: "bloodwork_shadow_loop_control_limited_keep_glycemia_lead",
      },
    }),
    writeJson(paths.r1093Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1093-consumer-lab-shadow-candidate-selector",
      schemaVersion: "murph-age-r1093-consumer-lab-shadow-candidate-selector.v1",
      selection: {
        candidateId: ready ? "common_lab_core_shadow" : "hold_no_lab_shadow_candidate",
        promotionBlockedBy: ["external_replication_is_mixed"],
      },
      summary: {
        conclusion: ready
          ? "common_lab_shadow_candidate_selected_not_promoted"
          : "lab_shadow_candidate_blocked_missing_or_unclean",
      },
    }),
    writeJson(paths.r1094Path, {
      applicability: {
        validationGap: ready
          ? "candidate_sources_not_direct_young_adult_consumer_validation"
          : "candidate_not_selected",
      },
      artifactBoundary: safeBoundary(),
      packetId: "r1094-consumer-age-domain-applicability-guard",
      schemaVersion: "murph-age-r1094-consumer-age-domain-applicability-guard.v1",
    }),
  ]);

  return paths;
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
