import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R987_CRELES_GLYCEMIA_RECEIPT_REDUCER_SCHEMA_VERSION,
  runR987CrelesGlycemiaReceiptReducer,
} from "./r987-creles-glycemia-receipt-reducer.ts";

describe("R987 CRELES glycemia receipt reducer", () => {
  it("keeps CRELES glycemia candidates for future validation and deprioritizes body-only plus non-confirming transport", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r987-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR987CrelesGlycemiaReceiptReducer({
        createdAt: "2026-05-13T00:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r987-creles-glycemia-receipt-reducer.latest.json");
      expect(output.schemaVersion).toBe(R987_CRELES_GLYCEMIA_RECEIPT_REDUCER_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.artifactBoundary).toMatchObject({
        aggregateOnly: true,
        coefficientsStored: false,
        localPathsStored: false,
        modelParametersStored: false,
        participantIdentifiersStored: false,
        predictionsStored: false,
        productClaimsIncluded: false,
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        rowParsingPerformedByR987: false,
        rowValuesStored: false,
        smallCellsStored: false,
        sourceBodiesStored: false,
        splitMembershipStored: false,
      });
      expect(output.summary).toEqual({
        keyArtifactVerdict: "keep_tiny_glycemia_only_and_glycemia_body_for_future_external_validation",
        nextLocalAction: "external_validation_only_no_product_promotion",
        productPromotionAuthorized: false,
        rowParsingPerformedByReducer: false,
      });
      expect(output.receiptReduction.candidateReceipts).toEqual([
        {
          candidateId: "tiny_glycemia_only",
          decision: "keep_for_future_external_validation",
          evidenceLabels: [
            "creles_local_aggregate_deltas_supportive",
            "future_external_validation_only",
            "no_product_promotion",
          ],
          metricDeltasVsReference: {
            aucDelta: 0.007671,
            brierDelta: -0.001356,
            logLossDelta: -0.004207,
          },
          sourceScope: "creles_local_aggregate",
        },
        {
          candidateId: "glycemia_body",
          decision: "keep_for_future_external_validation",
          evidenceLabels: [
            "creles_local_aggregate_deltas_supportive",
            "future_external_validation_only",
            "no_product_promotion",
          ],
          metricDeltasVsReference: {
            aucDelta: 0.005663,
            brierDelta: -0.001585,
            logLossDelta: -0.004381,
          },
          sourceScope: "creles_local_aggregate",
        },
        {
          candidateId: "body_only",
          decision: "deprioritize_or_retire",
          evidenceLabels: [
            "creles_local_aggregate_deltas_not_supportive",
            "body_only_not_confirming",
            "no_product_promotion",
          ],
          metricDeltasVsReference: {
            aucDelta: -0.002243,
            brierDelta: 0.000654,
            logLossDelta: 0.001475,
          },
          sourceScope: "creles_local_aggregate",
        },
        {
          candidateId: "midus_to_creles_transport",
          decision: "deprioritize_or_retire",
          evidenceLabels: [
            "midus_to_creles_transport_not_confirming",
            "transport_stress_only",
            "no_product_promotion",
          ],
          metricDeltasVsReference: {
            aucDelta: -0.002677,
            brierDelta: 0.000441,
            logLossDelta: 0.001686,
          },
          sourceScope: "midus_to_creles_transport_aggregate",
        },
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("participantIds");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"rowValues\":");
      expect(persisted).not.toContain("source body");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("holds candidates when the aggregate receipt is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r987-missing-"));
    try {
      const { output } = await runR987CrelesGlycemiaReceiptReducer({
        outputDir: path.join(tmp, "out"),
        r603Path: path.join(tmp, "missing-r603.json"),
      });

      expect(output.inputArtifacts.r603TransportReadinessPacket.status).toBe("missing");
      expect(output.summary.keyArtifactVerdict).toBe("hold_glycemia_candidates_until_aggregate_support_exists");
      expect(output.receiptReduction.candidateReceipts.every((receipt) =>
        receipt.decision === "missing_aggregate_evidence"
      )).toBe(true);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed when the input aggregate boundary is unsafe", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r987-unsafe-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      await writeJson(paths.r603Path, {
        ...r603Fixture(),
        boundary: {
          ...safeBoundary(),
          predictionsStored: true,
        },
      });

      await expect(runR987CrelesGlycemiaReceiptReducer(paths)).rejects.toThrow(
        "R603 aggregate packet failed aggregate-egress validation",
      );
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r987-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r987-creles-glycemia-receipt-reducer.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R603_TRANSPORT_READINESS_PACKET_PATH: paths.r603Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        artifact: "r987-creles-glycemia-receipt-reducer.latest.json",
        keyArtifactVerdict: "keep_tiny_glycemia_only_and_glycemia_body_for_future_external_validation",
        packetId: "r987-creles-glycemia-receipt-reducer",
        productPromotionAuthorized: false,
        retainedForFutureExternalValidation: 2,
        rowParsingPerformedByReducer: false,
        schemaVersion: R987_CRELES_GLYCEMIA_RECEIPT_REDUCER_SCHEMA_VERSION,
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

async function writeFixtureArtifacts(tmp: string): Promise<{
  outputDir: string;
  r603Path: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const r603Path = path.join(fixtureDir, "r603.json");
  await writeJson(r603Path, r603Fixture());
  return { outputDir, r603Path };
}

function r603Fixture(): Record<string, unknown> {
  return {
    boundary: safeBoundary(),
    packetId: "r603-creles-transport-readiness",
    readiness: {
      conclusion: "transport_signal_not_confirmed",
    },
    schemaVersion: "murph-age-r603-transport-readiness-packet.v1",
    transport: {
      crelesLocal: {
        models: [
          model("age_sex_reference", 0, 0, 0),
          model("body_only_no_crp", -0.002243, 0.000654, 0.001475),
          model("glycemia_only_no_crp", 0.007671, -0.001356, -0.004207),
          model("glycemia_body_no_crp", 0.005663, -0.001585, -0.004381),
        ],
        status: "available",
      },
      midusToCreles: {
        models: [
          model("midus2_lab5_source_creles_recalibrated", -0.002677, 0.000441, 0.001686),
        ],
        status: "available",
      },
    },
  };
}

function model(modelId: string, aucDelta: number, brierDelta: number, logLossDelta: number): Record<string, unknown> {
  return {
    metricDeltasVsReference: {
      aucDelta,
      brierDelta,
      logLossDelta,
    },
    modelId,
  };
}

function safeBoundary(): Record<string, false | true> {
  return {
    aggregateOnly: true,
    calibrationParametersStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    rowValuesStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
