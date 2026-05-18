import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runR1103ConsumerCandidateFamilyManifest } from "./r1103-consumer-candidate-family-manifest.ts";

describe("R1103 consumer candidate family manifest", () => {
  it("materializes the fixed consumer lab/wearable candidate families from R1101 and R1102", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1103-"));
    const paths = await writeFixtures(tmp, true);

    const { output } = await runR1103ConsumerCandidateFamilyManifest({
      createdAt: "2026-05-15T00:00:00.000Z",
      outputDir: path.join(tmp, "out"),
      ...paths,
    });

    expect(output.summary).toMatchObject({
      conclusion: "consumer_candidate_family_manifest_ready",
      immediateNextCandidate: "L1_tiny_glycemia_only",
      nextAction: "collect_aggregate_receipt_for_l1_l2_w1_first_pass",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1103: false,
    });
    expect(output.candidateFamilies.map((candidate) => candidate.candidateId)).toEqual([
      "L1_tiny_glycemia_only",
      "L2_common_lab_core_shadow",
      "W1_activity_steps_minutes",
      "W2_sleep_duration_regularity",
      "W3_rhr_hrv_recovery",
      "QC_missingness_coverage",
      "I1_integrated_lab_wearable_small_panel",
    ]);
    expect(output.candidateFamilies.find((candidate) =>
      candidate.candidateId === "W1_activity_steps_minutes"
    )?.status).toBe("blocked_until_outcome_linked_aggregate_receipt");
    expect(output.thresholds.generalUnlock).toContain("delta_logLoss");
    expect(output.thresholds.wearableUnlock).toContain("outcome-linked aggregate receipt");
  });

  it("waits when the ReviewGPT direction has not been reduced", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1103-"));
    const paths = await writeFixtures(tmp, false);

    const { output } = await runR1103ConsumerCandidateFamilyManifest({
      outputDir: path.join(tmp, "out"),
      ...paths,
    });

    expect(output.summary.conclusion).toBe("consumer_candidate_family_manifest_waiting_on_direction");
    expect(output.summary.immediateNextCandidate).toBeNull();
  });

  it("rejects unsafe inputs before writing a manifest", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1103-"));
    const paths = await writeFixtures(tmp, true);
    await writeJson(paths.r1101Path, {
      packetId: "r1101-consumer-labs-wearables-loop-executor",
      rowValuesStored: true,
      schemaVersion: "murph-age-r1101-consumer-labs-wearables-loop-executor.v1",
    });

    await expect(runR1103ConsumerCandidateFamilyManifest({
      outputDir: path.join(tmp, "out"),
      ...paths,
    })).rejects.toThrow("R1103 rejected unsafe r1101 input");
  });
});

async function writeFixtures(tmp: string, ready: boolean): Promise<{
  r1101Path: string;
  r1102Path: string;
}> {
  const paths = {
    r1101Path: path.join(tmp, "r1101.json"),
    r1102Path: path.join(tmp, "r1102.json"),
  };
  await Promise.all([
    writeJson(paths.r1101Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1101-consumer-labs-wearables-loop-executor",
      schemaVersion: "murph-age-r1101-consumer-labs-wearables-loop-executor.v1",
      summary: {
        conclusion: "consumer_loop_ready_awaiting_aggregate_receipt",
      },
    }),
    writeJson(paths.r1102Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1102-reviewgpt-consumer-direction-reducer",
      reviewGptJson: {
        next_model_loops: [
          {
            success_threshold: "delta_logLoss <= -0.0020 and delta_Brier <= -0.0005",
          },
          {
            success_threshold: "beat L1 and keep calibration stable",
          },
        ],
        wearable_policy: {
          score_bearing_unlock_condition: "Only after an outcome-linked aggregate receipt clears the wearable threshold.",
        },
      },
      schemaVersion: "murph-age-r1102-reviewgpt-consumer-direction-reducer.v1",
      summary: {
        conclusion: ready
          ? "reviewgpt_consumer_direction_reduced"
          : "reviewgpt_consumer_direction_missing_or_unusable",
      },
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
