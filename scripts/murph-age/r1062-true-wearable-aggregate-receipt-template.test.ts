import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { runR1059TrueWearableAggregateReceiptIntake } from "./r1059-true-wearable-aggregate-receipt-intake.ts";
import {
  R1062_TRUE_WEARABLE_AGGREGATE_RECEIPT_TEMPLATE_SCHEMA_VERSION,
  runR1062TrueWearableAggregateReceiptTemplate,
} from "./r1062-true-wearable-aggregate-receipt-template.ts";

describe("R1062 true wearable aggregate receipt template", () => {
  it("writes a fillable receipt skeleton that validates but does not create a delta", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1062-"));
    try {
      const { output, outputPath, receiptTemplatePath } = await runR1062TrueWearableAggregateReceiptTemplate({
        createdAt: "2026-05-14T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
      });

      expect(path.basename(outputPath)).toBe("r1062-true-wearable-aggregate-receipt-template.latest.json");
      expect(path.basename(receiptTemplatePath)).toBe("r1062-fillable-aggregate-receipt-template.json");
      expect(output.schemaVersion).toBe(R1062_TRUE_WEARABLE_AGGREGATE_RECEIPT_TEMPLATE_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        candidateMetricCount: 12,
        productDisplayAuthorized: false,
        templateEvaluatorConclusion: "partner_wearable_delta_not_ready",
        templateReadyForDataFill: true,
      });
      expect(output.fillableReceiptTemplate.ageSubbandEvidence).toEqual({
        "16_17": "missing",
        "18_39": "missing",
        "40_50": "missing",
      });
      expect(output.fillableReceiptTemplate.receiptContext).toEqual({
        broadSubgroupSuppressionStatus: "missing",
        confidenceIntervalStatus: "missing",
        featureAvailabilityMissingnessStatus: "missing",
        featureWindowTimingStatus: "missing",
        sourceReleaseGovernanceStatus: "missing",
        wearableCoverageSummaryStatus: "missing",
      });
      expect(output.fillableReceiptTemplate.candidateMetrics.map((metric) => metric.candidateId)).toEqual([
        "C1_source_clinical_base",
        "C2a_common_labs_only",
        "C2b_vitals_body_only",
        "C2c_common_labs_plus_vitals_body",
        "C2_lab5_or_lab9_bp_body",
        "C3_wearable_activity_sleep_rhr_hrv_only",
        "C3_lab_bp_body_plus_activity_28d",
        "C4_lab_bp_body_plus_activity_sleep_28d",
        "C5_lab_bp_body_plus_activity_sleep_rhr",
        "C6_lab_bp_body_plus_activity_sleep_rhr_hrv_quality_gated",
        "C7_wearable_coverage_quality_only_negative_control",
        "C8_shuffled_wearable_negative_control",
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const receipt = JSON.parse(await readFile(receiptTemplatePath, "utf8")) as unknown;
      expect(findForbiddenAggregateEgress(receipt)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("can be fed through R1059 as a valid no-delta receipt", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1062-r1059-"));
    try {
      const { receiptTemplatePath } = await runR1062TrueWearableAggregateReceiptTemplate({
        outputDir: path.join(tmp, "template"),
      });
      const r1057Path = path.join(tmp, "r1057.json");
      await writeFile(r1057Path, `${JSON.stringify(r1057Fixture())}\n`);

      const { output } = await runR1059TrueWearableAggregateReceiptIntake({
        aggregateReceiptPath: receiptTemplatePath,
        outputDir: path.join(tmp, "intake"),
        r1057Path,
      });

      expect(output.intake).toMatchObject({
        aggregateReceiptProvided: true,
        evaluatorConclusion: "partner_wearable_delta_not_ready",
        nextAction: "hold_receipt_no_scientific_delta",
        reviewGptRequired: false,
      });
      expect(output.summary.conclusion).toBe("aggregate_receipt_valid_but_no_delta");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1062-cli-"));
    try {
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1062-true-wearable-aggregate-receipt-template.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        candidateMetricCount: number;
        packetId: string;
        productDisplayAuthorized: boolean;
        templateEvaluatorConclusion: string;
      };
      expect(summary).toMatchObject({
        candidateMetricCount: 12,
        packetId: "r1062-true-wearable-aggregate-receipt-template",
        productDisplayAuthorized: false,
        templateEvaluatorConclusion: "partner_wearable_delta_not_ready",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("SEQN");
      expect(stdout).not.toContain("participant_key");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

function r1057Fixture() {
  return {
    packetId: "r1057-function-activity-pulse-candidate-batch-result",
    schemaVersion: "murph-age-r1057-function-activity-pulse-candidate-batch-result.v1",
    status: "research-local-aggregate-only",
    summary: {
      currentLead: "function_activity_mobility_shadow",
      nextLoopFocus: "true_wearable_or_partner_validation",
    },
  };
}
