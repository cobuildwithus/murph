import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runR1091ConsumerInputLoopState } from "./r1091-consumer-input-loop-state.ts";

describe("R1091 consumer input loop state", () => {
  it("opens the bloodwork control-hardening loop while keeping true wearables blocked", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1091-"));
    const paths = await writeFixtures(tmp);

    const { output } = await runR1091ConsumerInputLoopState({
      createdAt: "2026-05-15T00:00:00.000Z",
      outputDir: path.join(tmp, "out"),
      ...paths,
    });

    expect(output.summary).toMatchObject({
      conclusion: "consumer_input_loop_ready_for_bloodwork_control_hardening_wearables_blocked",
      nextLocalAction: "run_bloodwork_control_hardening_keep_wearable_receipt_open",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1091: false,
    });
    expect(output.consumerInputLoop.bloodwork).toMatchObject({
      status: "mixed_shadow_ready_for_control_hardening",
      queuedFamilies: [
        "glycemia_hba1c_glucose",
        "lipids_triglycerides_cholesterol",
        "blood_pressure_vitals",
        "body_composition",
      ],
    });
    expect(output.consumerInputLoop.wearables).toMatchObject({
      status: "blocked_until_true_wearable_outcome_aggregate",
      blockedFamilies: [
        "activity_steps_minutes",
        "sleep_duration_regularity",
        "resting_hr_recovery",
        "wearable_hrv_quality_gated",
      ],
    });
    expect(output.consumerInputLoop.functionMobilityRole).toBe("supporting_context_not_primary_for_16_50");
  });

  it("stays blocked when the consumer feature registry is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1091-"));

    const { output } = await runR1091ConsumerInputLoopState({
      outputDir: path.join(tmp, "out"),
      r1090Path: path.join(tmp, "missing-r1090.json"),
    });

    expect(output.summary).toMatchObject({
      conclusion: "consumer_input_loop_blocked_missing_registry",
      nextLocalAction: "repair_consumer_feature_registry",
    });
    expect(output.consumerInputLoop.bloodwork.status).toBe("blocked_missing_consumer_registry");
    expect(output.consumerInputLoop.wearables.status).toBe("blocked_missing_consumer_registry");
  });

  it("rejects unsafe aggregate inputs", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1091-"));
    const r1090Path = path.join(tmp, "unsafe.json");
    await writeJson(r1090Path, {
      packetId: "r1090-consumer-feature-registry-state",
      rowValuesStored: true,
      schemaVersion: "murph-age-r1090-consumer-feature-registry-state.v1",
    });

    await expect(runR1091ConsumerInputLoopState({
      outputDir: path.join(tmp, "out"),
      r1090Path,
    })).rejects.toThrow("R1091 rejected unsafe r1090 input");
  });
});

async function writeFixtures(tmp: string): Promise<{
  r1047Path: string;
  r1049Path: string;
  r1050Path: string;
  r1060Path: string;
  r1061Path: string;
  r1089Path: string;
  r1090Path: string;
}> {
  const paths = {
    r1047Path: path.join(tmp, "r1047.json"),
    r1049Path: path.join(tmp, "r1049.json"),
    r1050Path: path.join(tmp, "r1050.json"),
    r1060Path: path.join(tmp, "r1060.json"),
    r1061Path: path.join(tmp, "r1061.json"),
    r1089Path: path.join(tmp, "r1089.json"),
    r1090Path: path.join(tmp, "r1090.json"),
  };

  await Promise.all([
    writeJson(paths.r1047Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1047-biomarker-evidence-state",
      schemaVersion: "murph-age-r1047-biomarker-evidence-state.v1",
      summary: { currentBloodworkLead: "glucose_hba1c_research_candidate" },
    }),
    writeJson(paths.r1049Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1049-nhanes-activity-sensitivity-control",
      schemaVersion: "murph-age-r1049-nhanes-activity-sensitivity-control.v1",
      summary: { conclusion: "activity_signal_control_clean_global_calibration_limited" },
    }),
    writeJson(paths.r1050Path, {
      artifactBoundary: safeBoundary(),
      decision: { conclusion: "pulse_rhr_shadow_signal_mixed_control_limited" },
      packetId: "r1050-wearable-adjacent-physiology-state",
      schemaVersion: "murph-age-r1050-wearable-adjacent-physiology-state.v1",
    }),
    writeJson(paths.r1060Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1060-local-true-wearable-source-inventory",
      schemaVersion: "murph-age-r1060-local-true-wearable-source-inventory.v1",
      summary: { conclusion: "possible_local_wearable_files_need_outcome_join" },
    }),
    writeJson(paths.r1061Path, {
      artifactBoundary: safeBoundary(),
      currentBlocker: { conclusion: "true_wearable_receipt_missing" },
      packetId: "r1061-true-wearable-data-unblocker",
      schemaVersion: "murph-age-r1061-true-wearable-data-unblocker.v1",
    }),
    writeJson(paths.r1089Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1089-labs-wearables-candidate-batch-manifest",
      schemaVersion: "murph-age-r1089-labs-wearables-candidate-batch-manifest.v1",
      summary: { conclusion: "labs_wearables_batch_ready" },
    }),
    writeJson(paths.r1090Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1090-consumer-feature-registry-state",
      schemaVersion: "murph-age-r1090-consumer-feature-registry-state.v1",
      summary: {
        currentExecutableShadowFamilies: [
          "glycemia_hba1c_glucose",
          "lipids_triglycerides_cholesterol",
          "blood_pressure_vitals",
          "body_composition",
        ],
        trueWearableFamiliesBlocked: [
          "activity_steps_minutes",
          "sleep_duration_regularity",
          "resting_hr_recovery",
          "wearable_hrv_quality_gated",
        ],
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
