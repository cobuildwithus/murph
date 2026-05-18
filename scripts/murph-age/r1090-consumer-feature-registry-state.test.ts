import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runR1090ConsumerFeatureRegistryState } from "./r1090-consumer-feature-registry-state.ts";

describe("R1090 consumer feature registry state", () => {
  it("creates a user-submittable labs and wearables registry with true wearable families blocked", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1090-"));
    const paths = await writeFixtures(tmp);

    const { output } = await runR1090ConsumerFeatureRegistryState({
      createdAt: "2026-05-15T00:00:00.000Z",
      outputDir: path.join(tmp, "out"),
      ...paths,
    });

    expect(output.summary).toMatchObject({
      featureRegistryEntryCount: 10,
      nextLocalAction: "use_registry_to_drive_labs_wearables_shadow_batch",
      productDisplayAuthorized: false,
      rowParsingPerformedByR1090: false,
    });
    expect(output.summary.currentExecutableShadowFamilies).toEqual([
      "glycemia_hba1c_glucose",
      "lipids_triglycerides_cholesterol",
      "blood_pressure_vitals",
      "body_composition",
    ]);
    expect(output.summary.trueWearableFamiliesBlocked).toEqual([
      "activity_steps_minutes",
      "sleep_duration_regularity",
      "resting_hr_recovery",
      "wearable_hrv_quality_gated",
    ]);
    expect(output.featureRegistry.entries.find((entry) =>
      entry.featureFamilyId === "function_mobility_context"
    )).toMatchObject({
      evidenceStatus: "supporting_context_only",
      executableStatus: "supporting_not_primary",
      modelUse: "supporting_context_not_primary",
    });
  });

  it("rejects unsafe aggregate inputs", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1090-"));
    const r1047Path = path.join(tmp, "unsafe.json");
    await writeJson(r1047Path, {
      packetId: "r1047-biomarker-evidence-state",
      rowValuesStored: true,
      schemaVersion: "murph-age-r1047-biomarker-evidence-state.v1",
    });

    await expect(runR1090ConsumerFeatureRegistryState({
      outputDir: path.join(tmp, "out"),
      r1047Path,
    })).rejects.toThrow("R1090 rejected unsafe r1047 input");
  });
});

async function writeFixtures(tmp: string): Promise<{
  r1047Path: string;
  r1050Path: string;
  r1051Path: string;
  r1060Path: string;
  r1088Path: string;
  r1089Path: string;
}> {
  const paths = {
    r1047Path: path.join(tmp, "r1047.json"),
    r1050Path: path.join(tmp, "r1050.json"),
    r1051Path: path.join(tmp, "r1051.json"),
    r1060Path: path.join(tmp, "r1060.json"),
    r1088Path: path.join(tmp, "r1088.json"),
    r1089Path: path.join(tmp, "r1089.json"),
  };
  await Promise.all([
    writeJson(paths.r1047Path, {
      artifactBoundary: safeBoundary(),
      candidateFamilies: {
        bloodwork: { glucoseHba1c: { status: "active_research_candidate_mixed_external_support" } },
      },
      packetId: "r1047-biomarker-evidence-state",
      schemaVersion: "murph-age-r1047-biomarker-evidence-state.v1",
    }),
    writeJson(paths.r1050Path, {
      artifactBoundary: safeBoundary(),
      decision: { conclusion: "pulse_rhr_shadow_signal_mixed_control_limited" },
      packetId: "r1050-wearable-adjacent-physiology-state",
      schemaVersion: "murph-age-r1050-wearable-adjacent-physiology-state.v1",
    }),
    writeJson(paths.r1051Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1051-partner-wearable-aggregate-evaluator",
      reduction: { conclusion: "awaiting_partner_or_workbench_aggregate_receipt" },
      schemaVersion: "murph-age-r1051-partner-wearable-aggregate-evaluator.v1",
    }),
    writeJson(paths.r1060Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1060-local-true-wearable-source-inventory",
      schemaVersion: "murph-age-r1060-local-true-wearable-source-inventory.v1",
      summary: { conclusion: "possible_local_wearable_files_need_outcome_join" },
    }),
    writeJson(paths.r1088Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1088-consumer-input-priority-state",
      schemaVersion: "murph-age-r1088-consumer-input-priority-state.v1",
      summary: { nextAutoresearchLoop: "bloodwork_plus_wearable_priority_loop" },
    }),
    writeJson(paths.r1089Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1089-labs-wearables-candidate-batch-manifest",
      schemaVersion: "murph-age-r1089-labs-wearables-candidate-batch-manifest.v1",
      summary: { conclusion: "labs_wearables_batch_ready" },
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
