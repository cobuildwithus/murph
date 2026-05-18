import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1055_INTEGRATED_MODEL_DIRECTION_STATE_SCHEMA_VERSION,
  runR1055IntegratedModelDirectionState,
} from "./r1055-integrated-model-direction-state.ts";

describe("R1055 integrated model direction state", () => {
  it("ranks function/activity first when MHAS supports and partner receipt is still missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1055-"));
    try {
      const paths = await writeFixtures(tmp, { partnerReady: false });
      const { output, outputPath } = await runR1055IntegratedModelDirectionState({
        createdAt: "2026-05-13T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1055-integrated-model-direction-state.latest.json");
      expect(output.schemaVersion).toBe(R1055_INTEGRATED_MODEL_DIRECTION_STATE_SCHEMA_VERSION);
      expect(output.candidatePriority[0]).toMatchObject({
        candidateId: "function_activity_mobility_panel",
        nextUse: "batch_manifest_for_next_local_autoresearch_loop",
        rank: 1,
        status: "active_next_loop_candidate",
      });
      expect(output.componentEvidence.functionActivity.status).toBe("lead_shadow_control_limited");
      expect(output.componentEvidence.partnerWearable.status).toBe("awaiting_partner_or_workbench_receipt");
      expect(output.nextAutoresearchDecision).toMatchObject({
        conclusion: "function_activity_lead_partner_wearable_blocked",
        nextLocalAction: "build_function_activity_pulse_candidate_batch_manifest",
        reviewGptRequiredBeforeNextLocalRun: false,
      });
      expect(output.summary).toMatchObject({
        currentBloodworkLead: "glucose_hba1c_research_candidate",
        currentFunctionActivityLead: "walking_function_and_mobility_shadow",
        currentWearableAdjacentLead: "objective_activity_plus_pulse_shadow",
        nextLoopFocus: "function_activity_pulse_candidate_batch",
      });
      expect(output.productPolicy).toEqual({
        displayAuthorized: false,
        promotionAuthorized: false,
        productClaimsAuthorized: false,
        recommendationClaimsAuthorized: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);

      const roundTripped = JSON.parse(await readFile(outputPath, "utf8"));
      expect(roundTripped).toEqual(output);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes partner/workbench wearable deltas to ReviewGPT scientific interpretation", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1055-partner-"));
    try {
      const paths = await writeFixtures(tmp, { partnerReady: true });
      const { output } = await runR1055IntegratedModelDirectionState({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.componentEvidence.partnerWearable.status).toBe("ready_for_scientific_review");
      expect(output.candidatePriority[0]).toMatchObject({
        candidateId: "objective_activity_pulse_rhr_bridge",
        nextUse: "send_partner_delta_to_reviewgpt",
        status: "review_ready_partner_candidate",
      });
      expect(output.nextAutoresearchDecision).toMatchObject({
        conclusion: "partner_integrated_wearable_delta_ready_for_review",
        nextLocalAction: "send_partner_aggregate_delta_to_reviewgpt_for_science_review",
        reviewGptRequiredBeforeNextLocalRun: true,
      });
      expect(output.summary.nextLoopFocus).toBe("partner_wearable_delta_review");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed when an input violates aggregate-only boundaries", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1055-boundary-"));
    try {
      const paths = await writeFixtures(tmp, { partnerReady: false });
      await writeFile(paths.r1047Path, `${JSON.stringify({ ...biomarkerFixture(), rowValues: [] })}\n`);

      await expect(runR1055IntegratedModelDirectionState({
        outputDir: path.join(tmp, "out"),
        ...paths,
      })).rejects.toThrow(/R1055 input r1047 failed aggregate boundary validation/u);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1055-cli-"));
    try {
      const paths = await writeFixtures(tmp, { partnerReady: false });
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1055-integrated-model-direction-state.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1009_MHAS_FUNCTION_RESULT_PATH: paths.r1009Path,
          MURPH_AGE_R1047_BIOMARKER_STATE_PATH: paths.r1047Path,
          MURPH_AGE_R1050_WEARABLE_PHYSIOLOGY_STATE_PATH: paths.r1050Path,
          MURPH_AGE_R1051_PARTNER_EVALUATOR_PATH: paths.r1051Path,
          MURPH_AGE_R1054_FUNCTION_PHYSIOLOGY_STATE_PATH: paths.r1054Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      expect(JSON.parse(stdout)).toMatchObject({
        artifact: "r1055-integrated-model-direction-state.latest.json",
        conclusion: "function_activity_lead_partner_wearable_blocked",
        firstCandidate: "function_activity_mobility_panel",
        nextLocalAction: "build_function_activity_pulse_candidate_batch_manifest",
        packetId: "r1055-integrated-model-direction-state",
        productDisplayAuthorized: false,
        reviewGptRequiredBeforeNextLocalRun: false,
        status: "research-local-aggregate-only",
      });
      expect(stdout).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtures(tmp: string, options: { partnerReady: boolean }): Promise<{
  r1009Path: string;
  r1047Path: string;
  r1050Path: string;
  r1051Path: string;
  r1054Path: string;
}> {
  const paths = {
    r1009Path: path.join(tmp, "r1009.json"),
    r1047Path: path.join(tmp, "r1047.json"),
    r1050Path: path.join(tmp, "r1050.json"),
    r1051Path: path.join(tmp, "r1051.json"),
    r1054Path: path.join(tmp, "r1054.json"),
  };
  await writeFile(paths.r1009Path, `${JSON.stringify(mhasFixture())}\n`);
  await writeFile(paths.r1047Path, `${JSON.stringify(biomarkerFixture())}\n`);
  await writeFile(paths.r1050Path, `${JSON.stringify(wearablePhysiologyFixture())}\n`);
  await writeFile(paths.r1051Path, `${JSON.stringify(partnerFixture(options.partnerReady))}\n`);
  await writeFile(paths.r1054Path, `${JSON.stringify(functionPhysiologyFixture())}\n`);
  return paths;
}

function biomarkerFixture() {
  return {
    candidateFamilies: {
      bloodwork: {
        glucoseHba1c: {
          status: "active_research_candidate_mixed_external_support",
          supportCounts: {
            cleanSupport: 2,
            mixedSupport: 1,
            negativeOrMissing: 2,
          },
        },
      },
    },
    packetId: "r1047-biomarker-evidence-state",
    schemaVersion: "murph-age-r1047-biomarker-evidence-state.v1",
    status: "research-local-aggregate-only",
    summary: {
      currentBloodworkLead: "glucose_hba1c_research_candidate",
    },
  };
}

function functionPhysiologyFixture() {
  return {
    decision: {
      conclusion: "function_activity_shadow_signal_control_limited",
    },
    packetId: "r1054-cross-source-function-physiology-state",
    schemaVersion: "murph-age-r1054-cross-source-function-physiology-state.v1",
    status: "research-local-aggregate-only",
    summary: {
      currentFunctionActivityLead: "walking_function_shadow",
    },
  };
}

function mhasFixture() {
  return {
    packetId: "r1009-mhas-function-panel-extension-result",
    panelExtensionResult: {
      negativeControlVerdict: "function_beats_shuffled_negative_control",
    },
    schemaVersion: "murph-age-r1009-mhas-function-panel-extension-result.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "mhas_function_panel_extension_supports_lead_sidecar",
    },
  };
}

function partnerFixture(ready: boolean) {
  return {
    packetId: "r1051-partner-wearable-aggregate-evaluator",
    reduction: {
      conclusion: ready
        ? "partner_wearable_delta_ready_for_scientific_review"
        : "awaiting_partner_or_workbench_aggregate_receipt",
      reviewGptRequired: ready,
    },
    schemaVersion: "murph-age-r1051-partner-wearable-aggregate-evaluator.v1",
    status: "research-local-aggregate-only",
  };
}

function wearablePhysiologyFixture() {
  return {
    decision: {
      conclusion: "pulse_rhr_shadow_signal_mixed_control_limited",
    },
    objectiveActivityContext: {
      status: "shadow_supported_calibration_limited",
    },
    packetId: "r1050-wearable-adjacent-physiology-state",
    pulsePhysiology: {
      supportCounts: {
        cleanSupport: 2,
        controlLimited: 1,
        negativeOrMissing: 0,
      },
    },
    schemaVersion: "murph-age-r1050-wearable-adjacent-physiology-state.v1",
    status: "research-local-aggregate-only",
  };
}
