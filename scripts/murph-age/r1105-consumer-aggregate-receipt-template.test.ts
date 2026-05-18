import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { runR1104ConsumerAggregateReceiptValidator } from "./r1104-consumer-aggregate-receipt-validator.ts";
import {
  R1105_CONSUMER_AGGREGATE_RECEIPT_TEMPLATE_SCHEMA_VERSION,
  runR1105ConsumerAggregateReceiptTemplate,
} from "./r1105-consumer-aggregate-receipt-template.ts";

describe("R1105 consumer aggregate receipt template", () => {
  it("writes a fillable R1104-compatible aggregate receipt skeleton", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1105-"));
    try {
      const { output, outputPath, receiptTemplatePath } = await runR1105ConsumerAggregateReceiptTemplate({
        createdAt: "2026-05-15T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
      });

      expect(path.basename(outputPath)).toBe("r1105-consumer-aggregate-receipt-template.latest.json");
      expect(path.basename(receiptTemplatePath)).toBe("r1105-fillable-consumer-aggregate-receipt-template.json");
      expect(output.schemaVersion).toBe(R1105_CONSUMER_AGGREGATE_RECEIPT_TEMPLATE_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        candidateResultCount: 7,
        productDisplayAuthorized: false,
        templateReadyForDataFill: true,
        templateValidatorConclusion: "consumer_aggregate_receipt_no_science_delta",
      });
      expect(output.fillableReceiptTemplate.candidateResults.map((result) => result.candidateId)).toEqual([
        "L1_tiny_glycemia_only",
        "L2_common_lab_core_shadow",
        "W1_activity_steps_minutes",
        "W2_sleep_duration_regularity",
        "W3_rhr_hrv_recovery",
        "QC_missingness_coverage",
        "I1_integrated_lab_wearable_small_panel",
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const receipt = JSON.parse(await readFile(receiptTemplatePath, "utf8")) as unknown;
      expect(findForbiddenAggregateEgress(receipt)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("can be fed through R1104 as a valid no-delta receipt before metrics are filled", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1105-r1104-"));
    try {
      const { receiptTemplatePath } = await runR1105ConsumerAggregateReceiptTemplate({
        outputDir: path.join(tmp, "template"),
      });

      const { output } = await runR1104ConsumerAggregateReceiptValidator({
        aggregateReceiptPath: receiptTemplatePath,
        outputDir: path.join(tmp, "validator"),
      });

      expect(output.summary.conclusion).toBe("aggregate_receipt_valid_but_no_delta");
      expect(output.reduction.reviewGptRequired).toBe(false);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1105-cli-"));
    try {
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1105-consumer-aggregate-receipt-template.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        candidateResultCount: number;
        packetId: string;
        productDisplayAuthorized: boolean;
        templateReadyForDataFill: boolean;
      };
      expect(summary).toMatchObject({
        candidateResultCount: 7,
        packetId: "r1105-consumer-aggregate-receipt-template",
        productDisplayAuthorized: false,
        templateReadyForDataFill: true,
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("participant");
      expect(stdout).not.toContain("SEQN");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});
