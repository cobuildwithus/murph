import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runR1102ReviewGptConsumerDirectionReducer } from "./r1102-reviewgpt-consumer-direction-reducer.ts";

describe("R1102 ReviewGPT consumer direction reducer", () => {
  it("extracts the R1100 JSON decision from a prose response", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1102-"));
    const reviewGptRawPath = path.join(tmp, "r1100.md");
    await writeText(reviewGptRawPath, [
      "Part B -- R1100_CONSUMER_LABS_WEARABLES_DIRECTION_JSON",
      "JSON",
      JSON.stringify(reviewGptFixture(), null, 2),
    ].join("\n"));

    const { output } = await runR1102ReviewGptConsumerDirectionReducer({
      createdAt: "2026-05-15T00:00:00.000Z",
      outputDir: path.join(tmp, "out"),
      reviewGptRawPath,
    });

    expect(output.summary).toMatchObject({
      conclusion: "reviewgpt_consumer_direction_reduced",
      nextLocalAction: "materialize_candidate_family_manifest_and_receipt_validator",
      productDisplayAuthorized: false,
      reviewGptUse: "only_after_real_aggregate_delta_or_major_science_fork",
      rowParsingPerformedByR1102: false,
    });
    expect(output.reducedDecision).toMatchObject({
      confidence: 0.84,
      immediateLabCandidate: "tiny_glycemia_only",
      integratedPanelPolicy: "held_until_components_pass",
      nextLoopIds: [
        "R1101_EXTERNAL_AGGREGATE_L1_AND_W1_FIRST_PASS",
        "R1102_EXTERNAL_COMMON_LAB_CORE_SHADOW",
      ],
      wearableStatus: "blocked_until_outcome_linked_aggregate_receipt",
    });
  });

  it("marks missing or malformed ReviewGPT output as unusable", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1102-"));
    const reviewGptRawPath = path.join(tmp, "bad.md");
    await writeText(reviewGptRawPath, "The");

    const { output } = await runR1102ReviewGptConsumerDirectionReducer({
      outputDir: path.join(tmp, "out"),
      reviewGptRawPath,
    });

    expect(output.summary.conclusion).toBe("reviewgpt_consumer_direction_missing_or_unusable");
    expect(output.reducedDecision.nextLoopIds).toEqual([]);
  });

  it("rejects unsafe extracted decisions", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1102-"));
    const reviewGptRawPath = path.join(tmp, "unsafe.md");
    await writeText(reviewGptRawPath, JSON.stringify({
      ...reviewGptFixture(),
      rowValuesStored: true,
    }));

    await expect(runR1102ReviewGptConsumerDirectionReducer({
      outputDir: path.join(tmp, "out"),
      reviewGptRawPath,
    })).rejects.toThrow("R1102 rejected unsafe ReviewGPT input");
  });
});

function reviewGptFixture(): Record<string, unknown> {
  return {
    schema_version: "murph-age-r1100-consumer-labs-wearables-direction.v1",
    decision: "Keep tiny_glycemia_only first, common_lab_core_shadow second, and true wearables blocked until outcome-linked aggregate receipt.",
    confidence: 0.84,
    next_model_loops: [
      {
        loop_id: "R1101_EXTERNAL_AGGREGATE_L1_AND_W1_FIRST_PASS",
        priority: 1,
      },
      {
        loop_id: "R1102_EXTERNAL_COMMON_LAB_CORE_SHADOW",
        priority: 2,
      },
    ],
    wearable_policy: {
      score_bearing_unlock_condition: "Only after outcome-linked aggregate receipt clears wearable success threshold.",
    },
    codex_next_actions_without_reviewgpt: [
      "Patch registry states.",
      "Implement aggregate receipt validator.",
    ],
    reviewgpt_next_use: "Only after a real aggregate receipt returns a threshold-clearing result.",
  };
}

async function writeText(filePath: string, value: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${value}\n`);
}
