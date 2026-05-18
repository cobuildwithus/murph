import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1057_FUNCTION_ACTIVITY_PULSE_CANDIDATE_BATCH_RESULT_SCHEMA_VERSION,
  runR1057FunctionActivityPulseCandidateBatchResult,
} from "./r1057-function-activity-pulse-candidate-batch-result.ts";

describe("R1057 function/activity pulse candidate batch result", () => {
  it("selects function/mobility as the current shadow lead from aggregate evidence", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1057-"));
    try {
      const paths = await writeFixtures(tmp, { partnerReady: false });
      const { output, outputPath } = await runR1057FunctionActivityPulseCandidateBatchResult({
        createdAt: "2026-05-13T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1057-function-activity-pulse-candidate-batch-result.latest.json");
      expect(output.schemaVersion).toBe(R1057_FUNCTION_ACTIVITY_PULSE_CANDIDATE_BATCH_RESULT_SCHEMA_VERSION);
      expect(output.batchResult).toMatchObject({
        conclusion: "function_activity_pulse_batch_supports_function_mobility_lead",
        leadCandidate: "F1_walking_function_mobility_shadow",
        nextLocalAction: "prepare_true_wearable_or_partner_validation_loop",
        reviewGptRequiredBeforeNextLocalRun: false,
      });
      expect(output.summary).toMatchObject({
        currentLead: "function_activity_mobility_shadow",
        nextLoopFocus: "true_wearable_or_partner_validation",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1057: false,
      });
      expect(output.batchResult.candidateResults.map((candidate) => [candidate.candidateId, candidate.verdict])).toEqual([
        ["REF0_age_sex_source_baseline", "reference_only"],
        ["F1_walking_function_mobility_shadow", "supported_shadow_control_limited"],
        ["A1_objective_activity_bridge_shadow", "supported_shadow_calibration_limited"],
        ["P1_pulse_rhr_style_shadow", "supported_shadow_control_limited"],
        ["G1_glucose_hba1c_secondary_shadow", "mixed_shadow"],
        ["I1_function_activity_pulse_small_panel_shadow", "held_not_ready"],
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);

      const roundTripped = JSON.parse(await readFile(outputPath, "utf8"));
      expect(roundTripped).toEqual(output);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes a real partner wearable delta to science review before local batch interpretation", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1057-partner-"));
    try {
      const paths = await writeFixtures(tmp, { partnerReady: true });
      const { output } = await runR1057FunctionActivityPulseCandidateBatchResult({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.batchResult).toMatchObject({
        conclusion: "partner_delta_requires_scientific_review_before_batch",
        leadCandidate: null,
        nextLocalAction: "send_partner_delta_to_reviewgpt",
        reviewGptRequiredBeforeNextLocalRun: true,
      });
      expect(output.summary.currentLead).toBe("partner_delta_review");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed when an input violates aggregate-only boundaries", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1057-unsafe-"));
    try {
      const paths = await writeFixtures(tmp, { partnerReady: false });
      await writeFile(paths.r1050Path, `${JSON.stringify({ ...wearablePhysiologyFixture(), rowValues: [] })}\n`);

      await expect(runR1057FunctionActivityPulseCandidateBatchResult({
        outputDir: path.join(tmp, "out"),
        ...paths,
      })).rejects.toThrow(/R1057 input r1050 failed aggregate boundary validation/u);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1057-cli-"));
    try {
      const paths = await writeFixtures(tmp, { partnerReady: false });
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1057-function-activity-pulse-candidate-batch-result.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1009_MHAS_FUNCTION_RESULT_PATH: paths.r1009Path,
          MURPH_AGE_R1047_BIOMARKER_STATE_PATH: paths.r1047Path,
          MURPH_AGE_R1050_WEARABLE_PHYSIOLOGY_STATE_PATH: paths.r1050Path,
          MURPH_AGE_R1051_PARTNER_EVALUATOR_PATH: paths.r1051Path,
          MURPH_AGE_R1054_FUNCTION_PHYSIOLOGY_STATE_PATH: paths.r1054Path,
          MURPH_AGE_R1056_CANDIDATE_BATCH_MANIFEST_PATH: paths.r1056Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        conclusion: "function_activity_pulse_batch_supports_function_mobility_lead",
        currentLead: "function_activity_mobility_shadow",
        leadCandidate: "F1_walking_function_mobility_shadow",
        nextLocalAction: "prepare_true_wearable_or_partner_validation_loop",
        packetId: "r1057-function-activity-pulse-candidate-batch-result",
        productDisplayAuthorized: false,
        reviewGptRequiredBeforeNextLocalRun: false,
        rowParsingPerformedByR1057: false,
        schemaVersion: R1057_FUNCTION_ACTIVITY_PULSE_CANDIDATE_BATCH_RESULT_SCHEMA_VERSION,
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
  r1056Path: string;
}> {
  const paths = {
    r1009Path: path.join(tmp, "r1009.json"),
    r1047Path: path.join(tmp, "r1047.json"),
    r1050Path: path.join(tmp, "r1050.json"),
    r1051Path: path.join(tmp, "r1051.json"),
    r1054Path: path.join(tmp, "r1054.json"),
    r1056Path: path.join(tmp, "r1056.json"),
  };
  await writeFile(paths.r1009Path, `${JSON.stringify(mhasFixture())}\n`);
  await writeFile(paths.r1047Path, `${JSON.stringify(biomarkerFixture())}\n`);
  await writeFile(paths.r1050Path, `${JSON.stringify(wearablePhysiologyFixture())}\n`);
  await writeFile(paths.r1051Path, `${JSON.stringify(partnerFixture(options.partnerReady))}\n`);
  await writeFile(paths.r1054Path, `${JSON.stringify(functionPhysiologyFixture())}\n`);
  await writeFile(paths.r1056Path, `${JSON.stringify(batchManifestFixture(options.partnerReady))}\n`);
  return paths;
}

function batchManifestFixture(partnerReady: boolean) {
  return {
    packetId: "r1056-function-activity-pulse-candidate-batch-manifest",
    schemaVersion: "murph-age-r1056-function-activity-pulse-candidate-batch-manifest.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: partnerReady ? "partner_delta_review_takes_priority" : "function_activity_pulse_batch_ready",
    },
  };
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
      },
    },
    schemaVersion: "murph-age-r1050-wearable-adjacent-physiology-state.v1",
    status: "research-local-aggregate-only",
  };
}
