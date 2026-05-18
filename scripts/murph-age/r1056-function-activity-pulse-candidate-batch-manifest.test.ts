import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1056_FUNCTION_ACTIVITY_PULSE_CANDIDATE_BATCH_MANIFEST_SCHEMA_VERSION,
  runR1056FunctionActivityPulseCandidateBatchManifest,
} from "./r1056-function-activity-pulse-candidate-batch-manifest.ts";

describe("R1056 function/activity pulse candidate batch manifest", () => {
  it("creates a runnable local batch from the R1055 function/activity direction", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1056-"));
    try {
      const r1055Path = path.join(tmp, "r1055.json");
      await writeFile(r1055Path, `${JSON.stringify(r1055Fixture("function_activity_lead_partner_wearable_blocked"))}\n`);

      const { output, outputPath } = await runR1056FunctionActivityPulseCandidateBatchManifest({
        createdAt: "2026-05-13T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        r1055Path,
      });

      expect(path.basename(outputPath)).toBe("r1056-function-activity-pulse-candidate-batch-manifest.latest.json");
      expect(output.schemaVersion).toBe(R1056_FUNCTION_ACTIVITY_PULSE_CANDIDATE_BATCH_MANIFEST_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "function_activity_pulse_batch_ready",
        nextLocalAction: "run_function_activity_pulse_candidate_batch",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1056: false,
      });
      expect(output.batch).toMatchObject({
        batchId: "function_activity_pulse_candidate_batch_v1",
        candidateLimit: 6,
        localRunPurpose: "next_autoresearch_candidate_batch",
      });
      expect(output.batch.candidateFamilies.map((candidate) => [
        candidate.candidateId,
        candidate.role,
        candidate.status,
      ])).toEqual([
        ["REF0_age_sex_source_baseline", "reference", "ready_reference"],
        ["F1_walking_function_mobility_shadow", "lead_diagnostic", "queued_for_next_local_loop"],
        ["A1_objective_activity_bridge_shadow", "wearable_adjacent_shadow", "queued_for_next_local_loop"],
        ["P1_pulse_rhr_style_shadow", "wearable_adjacent_shadow", "queued_for_next_local_loop"],
        ["G1_glucose_hba1c_secondary_shadow", "bloodwork_shadow", "queued_for_next_local_loop"],
        ["I1_function_activity_pulse_small_panel_shadow", "integrated_shadow", "held_until_components_pass"],
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);

      const roundTripped = JSON.parse(await readFile(outputPath, "utf8"));
      expect(roundTripped).toEqual(output);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("holds the local batch when a partner wearable delta needs science review first", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1056-partner-"));
    try {
      const r1055Path = path.join(tmp, "r1055.json");
      await writeFile(r1055Path, `${JSON.stringify(r1055Fixture("partner_integrated_wearable_delta_ready_for_review"))}\n`);

      const { output } = await runR1056FunctionActivityPulseCandidateBatchManifest({
        outputDir: path.join(tmp, "out"),
        r1055Path,
      });

      expect(output.summary.conclusion).toBe("partner_delta_review_takes_priority");
      expect(output.summary.nextLocalAction).toBe("send_partner_delta_to_reviewgpt_before_local_batch");
      expect(output.batch.candidateFamilies[1]?.status).toBe("held_until_components_pass");
      expect(output.batch.candidateFamilies[5]?.status).toBe("held_until_components_pass");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed when the R1055 input violates aggregate boundaries", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1056-unsafe-"));
    try {
      const r1055Path = path.join(tmp, "r1055.json");
      await writeFile(r1055Path, `${JSON.stringify({ ...r1055Fixture("function_activity_lead_partner_wearable_blocked"), predictions: [] })}\n`);

      await expect(runR1056FunctionActivityPulseCandidateBatchManifest({
        outputDir: path.join(tmp, "out"),
        r1055Path,
      })).rejects.toThrow(/R1056 input r1055 failed aggregate boundary validation/u);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1056-cli-"));
    try {
      const r1055Path = path.join(tmp, "r1055.json");
      await writeFile(r1055Path, `${JSON.stringify(r1055Fixture("function_activity_lead_partner_wearable_blocked"))}\n`);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1056-function-activity-pulse-candidate-batch-manifest.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1055_INTEGRATED_DIRECTION_STATE_PATH: r1055Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        batchId: "function_activity_pulse_candidate_batch_v1",
        candidateCount: 6,
        conclusion: "function_activity_pulse_batch_ready",
        nextLocalAction: "run_function_activity_pulse_candidate_batch",
        packetId: "r1056-function-activity-pulse-candidate-batch-manifest",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1056: false,
        schemaVersion: R1056_FUNCTION_ACTIVITY_PULSE_CANDIDATE_BATCH_MANIFEST_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
      });
      expect(stdout).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

function r1055Fixture(conclusion: string) {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
    },
    nextAutoresearchDecision: { conclusion },
    packetId: "r1055-integrated-model-direction-state",
    schemaVersion: "murph-age-r1055-integrated-model-direction-state.v1",
    status: "research-local-aggregate-only",
  };
}
