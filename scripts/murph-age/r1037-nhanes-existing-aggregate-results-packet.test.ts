import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  assertR1037Safe,
  R1037_NHANES_EXISTING_AGGREGATE_RESULTS_PACKET_SCHEMA_VERSION,
  runR1037NhanesExistingAggregateResultsPacket,
} from "./r1037-nhanes-existing-aggregate-results-packet.ts";

describe("R1037 NHANES existing aggregate results packet", () => {
  it("reduces existing NHANES lab/activity aggregate artifacts into a pathless ReviewGPT packet", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1037-"));
    try {
      const paths = await writeFixtures(tmp);
      const { output, outputPath } = await runR1037NhanesExistingAggregateResultsPacket({
        createdAt: "2026-05-13T23:30:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.schemaVersion).toBe(R1037_NHANES_EXISTING_AGGREGATE_RESULTS_PACKET_SCHEMA_VERSION);
      expect(output.summary).toEqual({
        conclusion: "existing_nhanes_lab_activity_results_ready_for_scientific_review",
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        recommendedGate: "aggregate_results_gate",
        rowValuesStored: false,
      });
      expect(output.existingResults.r849LabFirst.comparisons.lab9_hba1c_vs_bp_body).toMatchObject({
        aucDelta: 0.07867626,
        brierDelta: -0.02038042,
        candidateId: "lab9_hba1c_bp_body_primary",
        comparatorId: "bp_body_reference",
        direction: "improved",
      });
      expect(output.existingResults.r850HipActivity.comparisons.activity_increment_over_lab10_bp_body).toMatchObject({
        brierDelta: -0.00393194,
        logLossDelta: -0.01207557,
      });
      expect(output.existingResults.r850HipActivity.stability).toMatchObject({
        aucCiCrossesZero: true,
        brierCiIncludesNoImprovement: true,
        brierImprovedFraction: 0.954,
        logLossCiIncludesNoImprovement: true,
        logLossImprovedFraction: 0.9375,
        repsBand: "1000+",
      });
      expect(output.existingResults.r850HipActivity.selectedMetrics.find((item) =>
        item.modelId === "lab10_bp_body_activity"
      )).toMatchObject({
        testAuc: 0.84291562,
        weightedExpectedObservedRatio: 0.998607,
      });
      expect(output.gapsBeforePromotion).toContain("calibration_slope_not_exported_in_existing_r849_r850_artifacts");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain(".runtime");
      expect(persisted).not.toContain("output-packages");
      expect(persisted).not.toContain("SEQN");
      expect(persisted).not.toContain("participant_key");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"predictions\":");
      expect(persisted).not.toContain("\"modelParameters\":");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed if the packet mutates into product display", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1037-unsafe-"));
    try {
      const paths = await writeFixtures(tmp);
      const { output } = await runR1037NhanesExistingAggregateResultsPacket({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });
      const unsafe = {
        ...output,
        summary: {
          ...output.summary,
          productDisplayAuthorized: true,
        },
      };

      expect(() => assertR1037Safe(unsafe as never)).toThrow("R1037 NHANES aggregate results packet failed safety validation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1037-cli-"));
    try {
      const paths = await writeFixtures(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1037-nhanes-existing-aggregate-results-packet.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R849_NHANES_LAB_FIRST_PATH: paths.r849Path,
          MURPH_AGE_R850_NHANES_HIP_ACTIVITY_PATH: paths.r850Path,
          MURPH_AGE_R852_ACTIVITY_STABILITY_PATH: paths.r852Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        conclusion: "existing_nhanes_lab_activity_results_ready_for_scientific_review",
        packetId: "r1037-nhanes-existing-aggregate-results-packet",
        productDisplayAuthorized: false,
        recommendedGate: "aggregate_results_gate",
        schemaVersion: R1037_NHANES_EXISTING_AGGREGATE_RESULTS_PACKET_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("coefficients");
      expect(stdout).not.toContain("predictions");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtures(tmp: string): Promise<{ r849Path: string; r850Path: string; r852Path: string }> {
  const r849Path = path.join(tmp, "r849.json");
  const r850Path = path.join(tmp, "r850.json");
  const r852Path = path.join(tmp, "r852.json");
  await Promise.all([
    writeFile(r849Path, `${JSON.stringify(r849Fixture())}\n`),
    writeFile(r850Path, `${JSON.stringify(r850Fixture())}\n`),
    writeFile(r852Path, `${JSON.stringify(r852Fixture())}\n`),
  ]);
  return { r849Path, r850Path, r852Path };
}

function r849Fixture() {
  return {
    comparisons: {
      lab9_hba1c_vs_bp_body: {
        auc_delta: 0.07867626,
        baseline: "bp_body_reference",
        brier_weighted_delta: -0.02038042,
        candidate: "lab9_hba1c_bp_body_primary",
        direction: "improved",
        log_loss_weighted_delta: -0.06251083,
      },
    },
    denominator: {
      age_range: "40-79",
      complete_case_n: { suppressed: false, value: 4787 },
    },
    endpoint: "ten_year_all_cause_mortality_from_mec_baseline",
    evidence_class: "same_family_public_nhanes_lab_research_only",
    metrics: [
      metric("age_sex_reference", 0.75345768, 0.12017257, 0.39340361, 0.16357827, 0.16824886),
      metric("bp_body_reference", 0.74941541, 0.12007503, 0.39357393, 0.16393811, 0.16824886),
      metric("lab9_hba1c_bp_body_primary", 0.82809167, 0.09969461, 0.3310631, 0.16658331, 0.16824886),
    ],
    support_read: {
      interpretation: "Research only.",
      primary_lab9_over_bp_body: "improved",
      promotion_status: "research_only_no_product_promotion",
    },
  };
}

function r850Fixture() {
  return {
    comparisons: {
      activity_increment_over_lab10_bp_body: {
        auc_delta: 0.0091405,
        baseline: "lab10_bp_body_reference",
        brier_weighted_delta: -0.00393194,
        candidate: "lab10_bp_body_activity",
        direction: "improved",
        log_loss_weighted_delta: -0.01207557,
      },
    },
    denominator: {
      age_range: "40-79",
      complete_case_n: { suppressed: false, value: 1897 },
      minimum_valid_activity_days: 4,
    },
    endpoint: "ten_year_all_cause_mortality_from_mec_baseline",
    evidence_class: "same_family_public_nhanes_hip_activity_research_only",
    metrics: [
      metric("lab10_bp_body_reference", 0.83377512, 0.07135428, 0.25428878, 0.09794135, 0.09780513),
      metric("lab10_bp_body_activity", 0.84291562, 0.06742234, 0.24221321, 0.09766888, 0.09780513),
    ],
    support_read: {
      activity_increment_over_lab10_bp_body: "improved",
      interpretation: "Research only.",
      promotion_status: "research_only_no_product_promotion",
    },
  };
}

function r852Fixture() {
  return {
    bootstrap_reps: 2000,
    comparisons: {
      activity_increment_over_lab10_bp_body: {
        bootstrap: {
          auc_delta_ci: { p025: -0.02707151, p50: 0.00897137, p975: 0.04002332 },
          bootstrap_reps: 2000,
          brier_weighted_delta_ci: { p025: -0.00893747, p50: -0.00371296, p975: 0.00044047 },
          fraction_auc_improved: 0.697,
          fraction_brier_improved: 0.954,
          fraction_log_loss_improved: 0.9375,
          log_loss_weighted_delta_ci: { p025: -0.02729434, p50: -0.01189294, p975: 0.00307084 },
        },
      },
    },
  };
}

function metric(
  modelId: string,
  auc: number,
  brier: number,
  logLoss: number,
  meanPredicted: number,
  observedRate: number,
) {
  return {
    event_counts: { test: { suppressed: false, value: 57 } },
    model_id: modelId,
    split_counts: { test: { suppressed: false, value: 414 } },
    test_metrics: {
      auc_unweighted: auc,
      brier_weighted: brier,
      log_loss_weighted: logLoss,
      mean_predicted_weighted: meanPredicted,
      observed_rate_weighted: observedRate,
    },
  };
}
