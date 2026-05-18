import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1058_TRUE_WEARABLE_PARTNER_VALIDATION_READINESS_SCHEMA_VERSION,
  runR1058TrueWearablePartnerValidationReadiness,
} from "./r1058-true-wearable-partner-validation-readiness.ts";

describe("R1058 true wearable partner validation readiness", () => {
  it("packages the true wearable validation handoff while awaiting an aggregate receipt", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1058-"));
    try {
      const paths = await writeFixtures(tmp, { partnerReady: false, r1057Ready: true });
      const { output, outputPath } = await runR1058TrueWearablePartnerValidationReadiness({
        createdAt: "2026-05-13T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1058-true-wearable-partner-validation-readiness.latest.json");
      expect(output.schemaVersion).toBe(R1058_TRUE_WEARABLE_PARTNER_VALIDATION_READINESS_SCHEMA_VERSION);
      expect(output.readiness).toMatchObject({
        blockedBy: ["no_true_wearable_or_workbench_aggregate_receipt_yet"],
        conclusion: "true_wearable_validation_package_ready_awaiting_receipt",
        nextLocalAction: "collect_or_point_r1051_to_aggregate_receipt",
        reviewGptRequiredBeforeNextLocalRun: false,
      });
      expect(output.handoffPackage).toMatchObject({
        evaluatorId: "partner_integrated_wearable_lab_evaluator_v1",
        packageId: "true_wearable_or_workbench_validation_v1",
        selectedShadowLead: "function_activity_mobility_shadow",
      });
      expect(output.handoffPackage.allowedReceiptRoutes).toEqual([
        "local_data_holder_aggregate",
        "controlled_workbench_aggregate",
        "partner_aggregate_validation",
      ]);
      expect(output.handoffPackage.candidateFamilies.map((candidate) => [
        candidate.candidateId,
        candidate.role,
        candidate.status,
      ])).toEqual([
        ["C0_age_sex", "reference", "required"],
        ["C1_source_clinical_base", "reference", "required"],
        ["C2_lab5_or_lab9_bp_body", "reference", "required"],
        ["C3_lab_bp_body_plus_activity_28d", "score_bearing_research_candidate", "required"],
        ["C4_lab_bp_body_plus_activity_sleep_28d", "score_bearing_research_candidate", "required"],
        ["C5_lab_bp_body_plus_activity_sleep_rhr", "score_bearing_research_candidate", "required"],
        ["C6_lab_bp_body_plus_activity_sleep_rhr_hrv_quality_gated", "score_bearing_research_candidate", "held_until_coverage_method_green"],
        ["C7_wearable_coverage_quality_only_negative_control", "negative_control", "required_control"],
        ["C8_shuffled_wearable_negative_control", "negative_control", "required_control"],
      ]);
      expect(output.productPolicy.displayAuthorized).toBe(false);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);

      const roundTripped = JSON.parse(await readFile(outputPath, "utf8"));
      expect(roundTripped).toEqual(output);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes a ready aggregate delta to ReviewGPT science review", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1058-ready-"));
    try {
      const paths = await writeFixtures(tmp, { partnerReady: true, r1057Ready: true });
      const { output } = await runR1058TrueWearablePartnerValidationReadiness({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.readiness).toMatchObject({
        blockedBy: [],
        conclusion: "partner_delta_ready_for_reviewgpt_science_review",
        nextLocalAction: "send_partner_delta_to_reviewgpt_for_science_review",
        reviewGptRequiredBeforeNextLocalRun: true,
      });
      expect(output.summary.currentLead).toBe("partner_delta_review");
      expect(output.summary.nextLoopFocus).toBe("review_partner_delta");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed when current lead state is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1058-missing-"));
    try {
      const paths = await writeFixtures(tmp, { partnerReady: false, r1057Ready: false });
      const { output } = await runR1058TrueWearablePartnerValidationReadiness({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.readiness).toMatchObject({
        blockedBy: ["r1057_current_lead_missing_or_not_true_wearable_focused"],
        conclusion: "true_wearable_validation_readiness_inputs_missing",
        nextLocalAction: "repair_r1057_or_r1051_state",
      });
      expect(output.handoffPackage.selectedShadowLead).toBe("none");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe aggregate inputs", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1058-unsafe-"));
    try {
      const paths = await writeFixtures(tmp, { partnerReady: false, r1057Ready: true });
      await writeFile(paths.r1057Path, `${JSON.stringify({ ...r1057Fixture(true), rowValues: [] })}\n`);

      await expect(runR1058TrueWearablePartnerValidationReadiness({
        outputDir: path.join(tmp, "out"),
        ...paths,
      })).rejects.toThrow(/R1058 input r1057 failed aggregate boundary validation/u);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1058-cli-"));
    try {
      const paths = await writeFixtures(tmp, { partnerReady: false, r1057Ready: true });
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1058-true-wearable-partner-validation-readiness.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1051_PARTNER_EVALUATOR_PATH: paths.r1051Path,
          MURPH_AGE_R1057_CANDIDATE_BATCH_RESULT_PATH: paths.r1057Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        conclusion: "true_wearable_validation_package_ready_awaiting_receipt",
        currentLead: "function_activity_mobility_shadow",
        evaluatorId: "partner_integrated_wearable_lab_evaluator_v1",
        nextLocalAction: "collect_or_point_r1051_to_aggregate_receipt",
        packetId: "r1058-true-wearable-partner-validation-readiness",
        productDisplayAuthorized: false,
        reviewGptRequiredBeforeNextLocalRun: false,
        rowParsingPerformedByR1058: false,
        schemaVersion: R1058_TRUE_WEARABLE_PARTNER_VALIDATION_READINESS_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
      });
      expect(stdout).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtures(
  tmp: string,
  options: { partnerReady: boolean; r1057Ready: boolean },
): Promise<{ r1051Path: string; r1057Path: string }> {
  const paths = {
    r1051Path: path.join(tmp, "r1051.json"),
    r1057Path: path.join(tmp, "r1057.json"),
  };
  await writeFile(paths.r1051Path, `${JSON.stringify(r1051Fixture(options.partnerReady))}\n`);
  await writeFile(paths.r1057Path, `${JSON.stringify(r1057Fixture(options.r1057Ready))}\n`);
  return paths;
}

function r1051Fixture(partnerReady: boolean) {
  return {
    packetId: "r1051-partner-wearable-aggregate-evaluator",
    reduction: {
      conclusion: partnerReady
        ? "partner_wearable_delta_ready_for_scientific_review"
        : "awaiting_partner_or_workbench_aggregate_receipt",
    },
    schemaVersion: "murph-age-r1051-partner-wearable-aggregate-evaluator.v1",
    status: "research-local-aggregate-only",
  };
}

function r1057Fixture(ready: boolean) {
  return {
    packetId: "r1057-function-activity-pulse-candidate-batch-result",
    schemaVersion: "murph-age-r1057-function-activity-pulse-candidate-batch-result.v1",
    status: "research-local-aggregate-only",
    summary: ready
      ? {
          currentLead: "function_activity_mobility_shadow",
          nextLoopFocus: "true_wearable_or_partner_validation",
        }
      : {
          currentLead: "none",
          nextLoopFocus: "repair_inputs",
        },
  };
}
