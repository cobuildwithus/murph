import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1052_NSHAP_PHYSIOLOGY_EXPANSION_DIAGNOSTIC_SCHEMA_VERSION,
  runR1052NshapPhysiologyExpansionDiagnostic,
} from "./r1052-nshap-physiology-expansion-diagnostic.ts";

describe("R1052 NSHAP physiology expansion diagnostic", () => {
  it("reduces expanded NSHAP physiology candidates into aggregate model-direction evidence", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1052-"));
    try {
      const receiptPath = path.join(tmp, "r1046.json");
      await writeFile(receiptPath, `${JSON.stringify(expandedR1046Fixture())}\n`);

      const { output, outputPath } = await runR1052NshapPhysiologyExpansionDiagnostic({
        createdAt: "2026-05-13T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        r1046Path: receiptPath,
      });

      expect(path.basename(outputPath)).toBe("r1052-nshap-physiology-expansion-diagnostic.latest.json");
      expect(output.schemaVersion).toBe(R1052_NSHAP_PHYSIOLOGY_EXPANSION_DIAGNOSTIC_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.decision).toMatchObject({
        conclusion: "nshap_physiology_shadow_signal_control_limited",
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        reviewGptRequiredBeforeNextLocalRun: false,
      });
      expect(output.supportCounts).toMatchObject({
        controlCompetingSourceCount: 1,
        integratedSupportCount: 2,
        missingnessControlSupportCount: 0,
        pulseSupportCount: 2,
        sleepSupportCount: 1,
        sourceCount: 2,
        walkingFunctionSupportCount: 2,
      });
      expect(output.signals?.nshap_w2_to_w3.noiseControl.verdict).toBe("beats_age_sex");
      expect(output.artifactBoundary.rowParsingPerformedByR1052).toBe(false);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);

      const roundTripped = JSON.parse(await readFile(outputPath, "utf8"));
      expect(roundTripped).toEqual(output);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("emits a closed missing-input state without unlocking ReviewGPT or product display", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1052-missing-"));
    try {
      const { output } = await runR1052NshapPhysiologyExpansionDiagnostic({
        outputDir: path.join(tmp, "out"),
        r1046Path: path.join(tmp, "missing.json"),
      });

      expect(output.decision.conclusion).toBe("nshap_physiology_expansion_missing");
      expect(output.decision.nextAction).toBe("rerun_or_repair_expanded_nshap_receipt");
      expect(output.decision.reviewGptRequiredBeforeNextLocalRun).toBe(false);
      expect(output.decision.productDisplayAuthorized).toBe(false);
      expect(output.signals).toBeNull();
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe input receipts", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1052-unsafe-"));
    try {
      const receiptPath = path.join(tmp, "unsafe.json");
      await writeFile(receiptPath, `${JSON.stringify({
        ...expandedR1046Fixture(),
        rowValues: [{ value: 1 }],
      })}\n`);

      await expect(runR1052NshapPhysiologyExpansionDiagnostic({
        outputDir: path.join(tmp, "out"),
        r1046Path: receiptPath,
      })).rejects.toThrow("R1052 input R1046 receipt failed aggregate boundary validation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1052-cli-"));
    try {
      const receiptPath = path.join(tmp, "r1046.json");
      await writeFile(receiptPath, `${JSON.stringify(expandedR1046Fixture())}\n`);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1052-nshap-physiology-expansion-diagnostic.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1046_RECEIPT_PATH: receiptPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      expect(JSON.parse(stdout)).toMatchObject({
        artifact: "r1052-nshap-physiology-expansion-diagnostic.latest.json",
        conclusion: "nshap_physiology_shadow_signal_control_limited",
        packetId: "r1052-nshap-physiology-expansion-diagnostic",
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

function expandedR1046Fixture() {
  return {
    packetId: "r1046-nshap-hba1c-replication-loop",
    schemaVersion: "murph-age-r1046-nshap-hba1c-replication-loop.v1",
    sources: {
      nshap_w1_to_w3: {
        models: {
          F1_walking_function_shadow: model("beats_age_sex", -0.007, -0.02),
          I1_hba1c_body_pulse_sleep_function: model("beats_age_sex", -0.008, -0.022),
          NC2_body_only_without_hba1c: model("does_not_beat_age_sex", 0.001, 0.001),
          NC4_missingness_quality_only: model("does_not_beat_age_sex", 0.002, 0.003),
          NC5_noise_feature: model("does_not_beat_age_sex", 0.001, 0.001),
          P1_pulse_only: model("beats_age_sex", -0.001, -0.004),
          S1_sleep_problem_shadow: model("beats_age_sex", -0.001, -0.002),
        },
      },
      nshap_w2_to_w3: {
        models: {
          F1_walking_function_shadow: model("beats_age_sex", -0.003, -0.01),
          I1_hba1c_body_pulse_sleep_function: model("beats_age_sex", -0.006, -0.02),
          NC2_body_only_without_hba1c: model("beats_age_sex", -0.001, -0.002),
          NC4_missingness_quality_only: model("does_not_beat_age_sex", 0.001, 0.003),
          NC5_noise_feature: model("beats_age_sex", -0.0001, -0.0001),
          P1_pulse_only: model("beats_age_sex", -0.001, -0.005),
          S1_sleep_problem_shadow: model("does_not_beat_age_sex", 0.001, 0.001),
        },
      },
    },
    status: "research-local-aggregate-only",
  };
}

function model(verdict: "beats_age_sex" | "does_not_beat_age_sex", brierDelta: number, logLossDelta: number) {
  return {
    deltasVsAgeSexReference: { brierDelta, logLossDelta },
    splitMetrics: {
      test: {
        expectedOverObserved: 0.98,
      },
    },
    verdict,
  };
}
