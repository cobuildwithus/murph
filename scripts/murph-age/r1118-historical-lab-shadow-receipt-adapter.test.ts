import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1118_HISTORICAL_LAB_SHADOW_RECEIPT_ADAPTER_SCHEMA_VERSION,
  runR1118HistoricalLabShadowReceiptAdapter,
} from "./r1118-historical-lab-shadow-receipt-adapter.ts";

describe("R1118 historical lab shadow receipt adapter", () => {
  it("adapts HAALSI glucose evidence into a safe non-promoting shadow receipt", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1118-ready-"));
    try {
      const paths = await writeInputs(tmp, { staleLoop: false });

      const { output, outputPath, receiptPath } = await runR1118HistoricalLabShadowReceiptAdapter({
        createdAt: "2026-05-15T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1118-historical-lab-shadow-receipt-adapter.latest.json");
      expect(path.basename(receiptPath)).toBe("r1118-historical-lab-shadow-consumer-receipt.json");
      expect(output.schemaVersion).toBe(R1118_HISTORICAL_LAB_SHADOW_RECEIPT_ADAPTER_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "historical_lab_shadow_receipt_ready_no_reviewgpt",
        nextAction: "record_shadow_lab_evidence_and_continue_consumer_receipt_search",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1118: false,
        topConsumerCandidateRemains: "L1_tiny_glycemia_only",
      });
      expect(output.shadowReceipt).toMatchObject({
        evidenceRole: "historical_external_biomarker_shadow_not_consumer_16_50_validation",
        r1104Conclusion: "aggregate_receipt_valid_but_no_delta",
        r1104ReviewGptRequired: false,
        receiptArtifact: "r1118-historical-lab-shadow-consumer-receipt.json",
      });
      expect(output.shadowReceipt.candidateResults[0]).toMatchObject({
        aucDelta: 0.0079753,
        brierDelta: -0.00115541,
        candidateId: "L1_tiny_glycemia_only",
        coverageStatus: "sparse_or_biased",
        logLossDelta: -0.00385554,
        r1104ExpectedDecision: "hold_or_reject",
      });
      const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as unknown;
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(findForbiddenAggregateEgress(receipt)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not mark the adapter ready when the consumer loop input is stale", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1118-stale-"));
    try {
      const paths = await writeInputs(tmp, { staleLoop: true });

      const { output } = await runR1118HistoricalLabShadowReceiptAdapter({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "historical_lab_shadow_receipt_waiting_on_inputs",
        nextAction: "refresh_r1044_and_r1117_before_shadow_receipt",
      });
      expect(output.inputArtifacts.r1117).toMatchObject({
        packetId: "r1117-consumer-model-loop-readiness-reducer",
        schemaVersion: null,
      });
      expect(output.shadowReceipt.r1104Conclusion).toBe("aggregate_receipt_valid_but_no_delta");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe upstream benchmark artifacts with a sanitized error", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1118-unsafe-"));
    try {
      const paths = await writeInputs(tmp, { staleLoop: false });
      await writeJson(paths.r1044Path, {
        artifactBoundary: {
          aggregateOnly: true,
          rowValuesStored: true,
        },
        packetId: "r1044-haalsi-external-biomarker-loop",
        schemaVersion: "murph-age-r1044-haalsi-external-biomarker-loop.v1",
      });

      await expect(runR1118HistoricalLabShadowReceiptAdapter({
        outputDir: path.join(tmp, "out"),
        ...paths,
      })).rejects.toThrow("R1118 rejected unsafe r1044 input: 1 aggregate-egress violation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1118-cli-"));
    try {
      const paths = await writeInputs(tmp, { staleLoop: false });
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1118-historical-lab-shadow-receipt-adapter.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1044_HISTORICAL_LAB_SOURCE_PATH: paths.r1044Path,
          MURPH_AGE_R1117_CONSUMER_MODEL_LOOP_PATH: paths.r1117Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        r1104Conclusion: string;
        reviewGptRequiredNow: boolean;
      };
      expect(summary).toMatchObject({
        conclusion: "historical_lab_shadow_receipt_ready_no_reviewgpt",
        r1104Conclusion: "aggregate_receipt_valid_but_no_delta",
        reviewGptRequiredNow: false,
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("participant_id");
      expect(stdout).not.toContain("glucose");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeInputs(tmp: string, options: { staleLoop: boolean }): Promise<{
  r1044Path: string;
  r1117Path: string;
}> {
  const r1044Path = path.join(tmp, "r1044.json");
  const r1117Path = path.join(tmp, "r1117.json");
  await Promise.all([
    writeJson(r1044Path, r1044Fixture()),
    writeJson(r1117Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1117-consumer-model-loop-readiness-reducer",
      schemaVersion: options.staleLoop ? "stale" : "murph-age-r1117-consumer-model-loop-readiness-reducer.v1",
      summary: {
        conclusion: "consumer_model_loop_ready_for_external_or_private_mapping_receipt",
      },
    }),
  ]);
  return { r1044Path, r1117Path };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function r1044Fixture(): unknown {
  return {
    artifactBoundary: safeBoundary(),
    decision: {
      conclusion: "haalsi_glucose_biomarker_signal_supported",
    },
    models: {
      A0_age_sex: {
        splitMetrics: {
          test: {
            auc: 0.74799544,
            brier: 0.15036736,
            logLoss: 0.46681204,
          },
        },
      },
      A1_glucose: {
        splitMetrics: {
          test: {
            auc: 0.75597074,
            brier: 0.14921195,
            logLoss: 0.4629565,
          },
        },
      },
      B1_glucose_lipid_body_no_crp: {
        splitMetrics: {
          test: {
            auc: 0.75173556,
            brier: 0.15060357,
            logLoss: 0.46648421,
          },
        },
      },
      NC6_missingness_quality_only: {
        splitMetrics: {
          test: {
            auc: 0.744,
            brier: 0.1508,
            logLoss: 0.468,
          },
        },
      },
    },
    packetId: "r1044-haalsi-external-biomarker-loop",
    schemaVersion: "murph-age-r1044-haalsi-external-biomarker-loop.v1",
  };
}

function safeBoundary(): unknown {
  return {
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
    recommendationClaimsIncluded: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}
