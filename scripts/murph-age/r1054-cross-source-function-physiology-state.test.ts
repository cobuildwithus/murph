import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1054_CROSS_SOURCE_FUNCTION_PHYSIOLOGY_STATE_SCHEMA_VERSION,
  runR1054CrossSourceFunctionPhysiologyState,
} from "./r1054-cross-source-function-physiology-state.ts";

describe("R1054 cross-source function physiology state", () => {
  it("keeps cross-source walking-function evidence shadow when missingness controls compete", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1054-"));
    try {
      const r1044Path = path.join(tmp, "r1044.json");
      const r1052Path = path.join(tmp, "r1052.json");
      await writeFile(r1044Path, `${JSON.stringify(haalsiFixture({ missingnessControl: true }))}\n`);
      await writeFile(r1052Path, `${JSON.stringify(nshapFixture({ missingnessControlSupportCount: 0 }))}\n`);

      const { output, outputPath } = await runR1054CrossSourceFunctionPhysiologyState({
        createdAt: "2026-05-13T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        r1044Path,
        r1052Path,
      });

      expect(path.basename(outputPath)).toBe("r1054-cross-source-function-physiology-state.latest.json");
      expect(output.schemaVersion).toBe(R1054_CROSS_SOURCE_FUNCTION_PHYSIOLOGY_STATE_SCHEMA_VERSION);
      expect(output.decision).toMatchObject({
        conclusion: "function_activity_shadow_signal_control_limited",
        nextAction: "keep_function_activity_shadow_and_seek_true_activity_or_partner_validation",
        productDisplayAuthorized: false,
        reviewGptRequiredBeforeNextLocalRun: false,
      });
      expect(output.summary.currentFunctionActivityLead).toBe("walking_function_shadow");
      expect(output.signals.haalsi?.walkDifficulty.status).toBe("supported");
      expect(output.signals.nshap?.walkingFunctionSupportCount).toBe(2);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);

      const roundTripped = JSON.parse(await readFile(outputPath, "utf8"));
      expect(roundTripped).toEqual(output);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("marks the signal clean enough for science review when controls do not compete", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1054-clean-"));
    try {
      const r1044Path = path.join(tmp, "r1044.json");
      const r1052Path = path.join(tmp, "r1052.json");
      await writeFile(r1044Path, `${JSON.stringify(haalsiFixture({ missingnessControl: false }))}\n`);
      await writeFile(r1052Path, `${JSON.stringify(nshapFixture({ missingnessControlSupportCount: 0 }))}\n`);

      const { output } = await runR1054CrossSourceFunctionPhysiologyState({
        outputDir: path.join(tmp, "out"),
        r1044Path,
        r1052Path,
      });

      expect(output.decision.conclusion).toBe("function_activity_shadow_signal_clean_enough_for_review");
      expect(output.decision.nextAction).toBe("ask_reviewgpt_after_current_science_review_if_function_should_drive_next_public_loop");
      expect(output.decision.productDisplayAuthorized).toBe(false);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed when inputs are missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1054-missing-"));
    try {
      const { output } = await runR1054CrossSourceFunctionPhysiologyState({
        outputDir: path.join(tmp, "out"),
        r1044Path: path.join(tmp, "missing-r1044.json"),
        r1052Path: path.join(tmp, "missing-r1052.json"),
      });

      expect(output.decision.conclusion).toBe("function_activity_shadow_inputs_missing");
      expect(output.decision.nextAction).toBe("rerun_or_repair_function_activity_receipts");
      expect(output.summary.currentFunctionActivityLead).toBe("none");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1054-cli-"));
    try {
      const r1044Path = path.join(tmp, "r1044.json");
      const r1052Path = path.join(tmp, "r1052.json");
      await writeFile(r1044Path, `${JSON.stringify(haalsiFixture({ missingnessControl: true }))}\n`);
      await writeFile(r1052Path, `${JSON.stringify(nshapFixture({ missingnessControlSupportCount: 0 }))}\n`);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1054-cross-source-function-physiology-state.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1044_RECEIPT_PATH: r1044Path,
          MURPH_AGE_R1052_RECEIPT_PATH: r1052Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      expect(JSON.parse(stdout)).toMatchObject({
        artifact: "r1054-cross-source-function-physiology-state.latest.json",
        conclusion: "function_activity_shadow_signal_control_limited",
        currentFunctionActivityLead: "walking_function_shadow",
        packetId: "r1054-cross-source-function-physiology-state",
        productDisplayAuthorized: false,
        status: "research-local-aggregate-only",
      });
      expect(stdout).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

function haalsiFixture(options: { missingnessControl: boolean }) {
  return {
    models: {
      A1_glucose: model("A1_glucose", "beats_age_sex"),
      F1_walk_difficulty_shadow: model("F1_walk_difficulty_shadow", "beats_age_sex"),
      I1_glucose_body_pulse_walk_shadow: model("I1_glucose_body_pulse_walk_shadow", "beats_age_sex"),
      NC6_missingness_quality_only: model(
        "NC6_missingness_quality_only",
        options.missingnessControl ? "beats_age_sex" : "does_not_beat_age_sex",
      ),
      P1_pulse_only: model("P1_pulse_only", "beats_age_sex"),
    },
    packetId: "r1044-haalsi-external-biomarker-loop",
    schemaVersion: "murph-age-r1044-haalsi-external-biomarker-loop.v1",
    status: "research-local-aggregate-only",
  };
}

function nshapFixture(options: { missingnessControlSupportCount: number }) {
  return {
    packetId: "r1052-nshap-physiology-expansion-diagnostic",
    schemaVersion: "murph-age-r1052-nshap-physiology-expansion-diagnostic.v1",
    status: "research-local-aggregate-only",
    supportCounts: {
      integratedSupportCount: 2,
      missingnessControlSupportCount: options.missingnessControlSupportCount,
      pulseSupportCount: 2,
      sourceCount: 2,
      walkingFunctionSupportCount: 2,
    },
  };
}

function model(candidateId: string, verdict: "beats_age_sex" | "does_not_beat_age_sex") {
  return {
    deltasVsAgeSexReference: {
      brierDelta: verdict === "beats_age_sex" ? -0.001 : 0.001,
      logLossDelta: verdict === "beats_age_sex" ? -0.002 : 0.002,
    },
    splitMetrics: {
      test: {
        expectedOverObserved: 0.99,
      },
    },
    candidateId,
    verdict,
  };
}
