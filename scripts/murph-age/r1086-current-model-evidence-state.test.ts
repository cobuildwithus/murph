import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1086_CURRENT_MODEL_EVIDENCE_STATE_SCHEMA_VERSION,
  runR1086CurrentModelEvidenceState,
} from "./r1086-current-model-evidence-state.ts";

describe("R1086 current model evidence state", () => {
  it("consolidates converged function evidence into the current lead research sidecar", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1086-lead-"));
    try {
      const paths = await writeInputs(tmp, supportiveInputs());
      const { output, outputPath } = await runR1086CurrentModelEvidenceState({
        createdAt: "2026-05-15T16:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1086-current-model-evidence-state.latest.json");
      expect(output.schemaVersion).toBe(R1086_CURRENT_MODEL_EVIDENCE_STATE_SCHEMA_VERSION);
      expect(output.summary).toEqual({
        conclusion: "function_disability_lead_research_sidecar_ready_for_fresh_source_feasibility",
        functionLeadStatus: "lead_supported_with_missingness_caveat",
        glycemiaStatus: "shadow_mixed_transport",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1086: false,
        trueWearableStatus: "blocked_on_source_ready_data",
      });
      expect(output.evidenceState.functionDisability.supportingSignals).toEqual([
        "function_activity_batch_supports_mobility_lead",
        "cross_source_arbitration_supports_function_disability",
        "mhas_adds_increment_over_frozen_anchor",
        "haalsi_function_beats_missingness_control_with_caveat",
      ]);
      expect(output.nextLoop.immediateLocalAction).toBe("run_downloaded_function_biomarker_source_feasibility");
      expect(output.modelArchitecture.integrationPolicy).toBe("sidecar_increment_then_external_validation_before_age_display");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("\"predictions\":");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"rowValues\":");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes true wearable aggregate deltas to science review", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1086-wearable-"));
    try {
      const inputs = supportiveInputs();
      inputs.r1074 = {
        ...inputs.r1074,
        finalHandoff: {
          nextAction: "send_nsrr_delta_to_reviewgpt",
        },
      };
      const paths = await writeInputs(tmp, inputs);
      const { output } = await runR1086CurrentModelEvidenceState(paths);

      expect(output.summary.conclusion).toBe("true_wearable_delta_ready_for_scientific_review");
      expect(output.summary.trueWearableStatus).toBe("aggregate_delta_ready_for_review");
      expect(output.nextLoop.immediateLocalAction).toBe("send_true_wearable_delta_to_reviewgpt");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("repairs direction when function evidence no longer converges", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1086-repair-"));
    try {
      const inputs = supportiveInputs();
      inputs.r986 = missingArtifact();
      inputs.r988 = missingArtifact();
      inputs.r1084 = missingArtifact();
      const paths = await writeInputs(tmp, inputs);
      const { output } = await runR1086CurrentModelEvidenceState(paths);

      expect(output.summary.conclusion).toBe("direction_chain_needs_repair");
      expect(output.summary.functionLeadStatus).toBe("hold_or_missing");
      expect(output.nextLoop.immediateLocalAction).toBe("repair_or_refresh_direction_chain");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe aggregate inputs", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1086-unsafe-"));
    try {
      const inputs = supportiveInputs();
      inputs.r1057 = {
        ...inputs.r1057,
        predictionsStored: true,
      };
      const paths = await writeInputs(tmp, inputs);

      await expect(runR1086CurrentModelEvidenceState(paths)).rejects.toThrow(
        "R1086 input r1057FunctionActivityPulseBatch failed aggregate-egress validation",
      );
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1086-cli-"));
    try {
      const paths = await writeInputs(tmp, supportiveInputs());
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1086-current-model-evidence-state.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1047_BIOMARKER_EVIDENCE_PATH: paths.r1047Path,
          MURPH_AGE_R1057_FUNCTION_ACTIVITY_BATCH_RESULT_PATH: paths.r1057Path,
          MURPH_AGE_R1074_TRUE_WEARABLE_REFRESH_PATH: paths.r1074Path,
          MURPH_AGE_R1084_HAALSI_FUNCTION_ADJUDICATION_PATH: paths.r1084Path,
          MURPH_AGE_R986_FUNCTION_ARBITRATION_PATH: paths.r986Path,
          MURPH_AGE_R988_MHAS_INCREMENT_PATH: paths.r988Path,
          MURPH_AGE_R994_SOURCE_READINESS_PATH: paths.r994Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        conclusion: "function_disability_lead_research_sidecar_ready_for_fresh_source_feasibility",
        functionLeadStatus: "lead_supported_with_missingness_caveat",
        immediateLocalAction: "run_downloaded_function_biomarker_source_feasibility",
        packetId: "r1086-current-model-evidence-state",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1086: false,
        schemaVersion: R1086_CURRENT_MODEL_EVIDENCE_STATE_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
        trueWearableStatus: "blocked_on_source_ready_data",
      });
      expect(stdout).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

interface InputPaths {
  outputDir: string;
  r1047Path: string;
  r1057Path: string;
  r1074Path: string;
  r1084Path: string;
  r986Path: string;
  r988Path: string;
  r994Path: string;
}

async function writeInputs(tmp: string, inputs: ReturnType<typeof supportiveInputs>): Promise<InputPaths> {
  const fixtures = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtures, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const paths = {
    outputDir,
    r1047Path: path.join(fixtures, "r1047.json"),
    r1057Path: path.join(fixtures, "r1057.json"),
    r1074Path: path.join(fixtures, "r1074.json"),
    r1084Path: path.join(fixtures, "r1084.json"),
    r986Path: path.join(fixtures, "r986.json"),
    r988Path: path.join(fixtures, "r988.json"),
    r994Path: path.join(fixtures, "r994.json"),
  };
  await Promise.all([
    writeFile(paths.r1047Path, `${JSON.stringify(inputs.r1047)}\n`),
    writeFile(paths.r1057Path, `${JSON.stringify(inputs.r1057)}\n`),
    writeFile(paths.r1074Path, `${JSON.stringify(inputs.r1074)}\n`),
    writeFile(paths.r1084Path, `${JSON.stringify(inputs.r1084)}\n`),
    writeFile(paths.r986Path, `${JSON.stringify(inputs.r986)}\n`),
    writeFile(paths.r988Path, `${JSON.stringify(inputs.r988)}\n`),
    writeFile(paths.r994Path, `${JSON.stringify(inputs.r994)}\n`),
  ]);
  return paths;
}

function supportiveInputs(): {
  r1047: Record<string, unknown>;
  r1057: Record<string, unknown>;
  r1074: Record<string, unknown>;
  r1084: Record<string, unknown>;
  r986: Record<string, unknown>;
  r988: Record<string, unknown>;
  r994: Record<string, unknown>;
} {
  return {
    r1047: {
      packetId: "r1047-biomarker-evidence-state",
      schemaVersion: "murph-age-r1047-biomarker-evidence-state.v1",
      summary: {
        currentBloodworkLead: "glucose_hba1c_research_candidate",
      },
    },
    r1057: {
      packetId: "r1057-function-activity-pulse-candidate-batch-result",
      schemaVersion: "murph-age-r1057-function-activity-pulse-candidate-batch-result.v1",
      batchResult: {
        conclusion: "function_activity_pulse_batch_supports_function_mobility_lead",
      },
    },
    r1074: {
      packetId: "r1074-true-wearable-post-download-refresh",
      schemaVersion: "murph-age-r1074-true-wearable-post-download-refresh.v1",
      finalHandoff: {
        nextAction: "download_nsrr_derived_files_or_secure_workbench_access",
      },
    },
    r1084: {
      packetId: "r1084-haalsi-function-missingness-calibration-adjudication",
      schemaVersion: "murph-age-r1084-haalsi-function-missingness-calibration-adjudication.v1",
      summary: {
        conclusion: "haalsi_function_adjudication_supportive_with_missingness_caveat",
      },
    },
    r986: {
      packetId: "r986-cross-source-function-arbitration",
      schemaVersion: "murph-age-r986-cross-source-function-arbitration.v1",
      summary: {
        verdict: "function_disability_portable_diagnostic_sidecar_supported",
      },
    },
    r988: {
      packetId: "r988-mhas-anchor-function-increment-check",
      schemaVersion: "murph-age-r988-mhas-anchor-function-increment-check.v1",
      summary: {
        verdict: "mhas_function_adds_small_increment_over_frozen_anchor",
      },
    },
    r994: {
      packetId: "r994-expanded-source-cache-readiness",
      schemaVersion: "murph-age-r994-expanded-source-cache-readiness.v1",
      summary: {
        fastestLaneNow: "MHAS/Gateway MHAS",
        scoreBearingCompleteCountBand: "1-4",
        sourcePriorityVerdict: "mhas_no_score_card_first_then_reuse_completed_midsize_score_receipts",
      },
    },
  };
}

function missingArtifact(): Record<string, unknown> {
  return {
    packetId: "missing",
    schemaVersion: "missing",
    summary: {},
  };
}
