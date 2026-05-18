import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runR1088ConsumerInputPriorityState } from "./r1088-consumer-input-priority-state.ts";

describe("R1088 consumer input priority state", () => {
  it("prioritizes user-submittable bloodwork and wearables over function-only followup", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1088-"));
    const paths = await writeFixtures(tmp);

    const { output } = await runR1088ConsumerInputPriorityState({
      createdAt: "2026-05-15T00:00:00.000Z",
      outputDir: path.join(tmp, "out"),
      ...paths,
    });

    expect(output.summary).toMatchObject({
      conclusion: "prioritize_labs_and_wearables_for_user_submittable_model",
      nextAutoresearchLoop: "bloodwork_plus_wearable_priority_loop",
      productDisplayAuthorized: false,
      rowParsingPerformedByR1088: false,
    });
    expect(output.priority.map((item) => [item.familyId, item.priority])).toEqual([
      ["bloodwork_common_labs", "p0_now"],
      ["consumer_wearables_activity_sleep_recovery", "p0_now"],
      ["function_disability_supporting_sidecar", "p2_supporting"],
    ]);
    expect(output.priority[2]).toMatchObject({
      readinessStatus: "supportive_but_not_primary_for_16_50",
      userSubmitFit: "medium",
    });
  });

  it("rejects unsafe aggregate inputs", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1088-"));
    const r1047Path = path.join(tmp, "unsafe.json");
    await writeJson(r1047Path, {
      artifactBoundary: { aggregateOnly: true },
      packetId: "r1047-biomarker-evidence-state",
      rowValuesStored: true,
      schemaVersion: "murph-age-r1047-biomarker-evidence-state.v1",
    });

    await expect(runR1088ConsumerInputPriorityState({
      outputDir: path.join(tmp, "out"),
      r1047Path,
    })).rejects.toThrow("R1088 rejected unsafe r1047 input");
  });
});

async function writeFixtures(tmp: string): Promise<{
  r1047Path: string;
  r1050Path: string;
  r1051Path: string;
  r1074Path: string;
  r1086Path: string;
  r1087Path: string;
}> {
  const paths = {
    r1047Path: path.join(tmp, "r1047.json"),
    r1050Path: path.join(tmp, "r1050.json"),
    r1051Path: path.join(tmp, "r1051.json"),
    r1074Path: path.join(tmp, "r1074.json"),
    r1086Path: path.join(tmp, "r1086.json"),
    r1087Path: path.join(tmp, "r1087.json"),
  };
  await Promise.all([
    writeJson(paths.r1047Path, {
      artifactBoundary: safeBoundary(),
      candidateFamilies: {
        bloodwork: {
          glucoseHba1c: { status: "active_research_candidate_mixed_external_support" },
        },
      },
      packetId: "r1047-biomarker-evidence-state",
      schemaVersion: "murph-age-r1047-biomarker-evidence-state.v1",
      summary: { currentBloodworkLead: "glucose_hba1c_research_candidate" },
    }),
    writeJson(paths.r1050Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1050-wearable-adjacent-physiology-state",
      schemaVersion: "murph-age-r1050-wearable-adjacent-physiology-state.v1",
      summary: { currentWearableAdjacentLead: "objective_activity_plus_pulse_shadow" },
    }),
    writeJson(paths.r1051Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1051-partner-wearable-aggregate-evaluator",
      reduction: { conclusion: "awaiting_partner_or_workbench_aggregate_receipt" },
      schemaVersion: "murph-age-r1051-partner-wearable-aggregate-evaluator.v1",
    }),
    writeJson(paths.r1074Path, {
      artifactBoundary: safeBoundary(),
      finalHandoff: { nextAction: "download_nsrr_derived_files_or_secure_workbench_access" },
      packetId: "r1074-true-wearable-post-download-refresh",
      schemaVersion: "murph-age-r1074-true-wearable-post-download-refresh.v1",
    }),
    writeJson(paths.r1086Path, {
      artifactBoundary: safeBoundary(),
      functionDisability: { status: "lead_supported_with_missingness_caveat" },
      packetId: "r1086-current-model-evidence-state",
      schemaVersion: "murph-age-r1086-current-model-evidence-state.v1",
    }),
    writeJson(paths.r1087Path, {
      artifactBoundary: safeBoundary(),
      downloadedSourceFeasibility: {
        sourceRows: [
          { family: "MIDUS core/refresher", sourceReadyStatus: "ready_for_score_receipt_reuse" },
        ],
      },
      packetId: "r1087-downloaded-aging-source-feasibility",
      schemaVersion: "murph-age-r1087-downloaded-aging-source-feasibility.v1",
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
