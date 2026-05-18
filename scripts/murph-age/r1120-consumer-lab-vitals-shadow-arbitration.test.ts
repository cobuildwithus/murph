import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1120_CONSUMER_LAB_VITALS_SHADOW_ARBITRATION_SCHEMA_VERSION,
  runR1120ConsumerLabVitalsShadowArbitration,
} from "./r1120-consumer-lab-vitals-shadow-arbitration.ts";

describe("R1120 consumer lab/vitals shadow arbitration", () => {
  it("arbitrates L1 first when L1 transports better than broader lab/vitals panels", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1120-ready-"));
    try {
      const paths = await writeInputs(tmp, { staleMemory: false });

      const { output, outputPath } = await runR1120ConsumerLabVitalsShadowArbitration({
        createdAt: "2026-05-15T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1120-consumer-lab-vitals-shadow-arbitration.latest.json");
      expect(output.schemaVersion).toBe(R1120_CONSUMER_LAB_VITALS_SHADOW_ARBITRATION_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "consumer_lab_vitals_shadow_arbitration_l1_first",
        nextAction: "run_consumer_compatible_l1_receipt_with_l2_secondary_or_fill_private_mapping",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1120: false,
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
        topCandidate: "L1_tiny_glycemia_only",
      });
      expect(output.arbitration.candidateDecision).toEqual({
        l1TinyGlycemia: "run_first_in_consumer_compatible_receipt",
        l2CommonLabVitals: "include_as_secondary_comparator_not_lead",
        wearableFamilies: "blocked_until_outcome_linked_wearable_receipt",
      });
      expect(output.arbitration.consumerPriority).toEqual({
        ageRangeFocus: "16_to_50",
        averageUserInputScope: [
          "common_bloodwork_labs",
          "basic_body_vitals",
          "wearable_activity",
          "wearable_sleep",
          "wearable_recovery",
        ],
        firstExecutableFamily: "common_bloodwork_labs",
        wearableExecutionPolicy: "outcome_linked_receipt_required_before_scoring",
      });
      expect(output.arbitration.supportCounts).toEqual({
        l1ProperScoreImproveSources: 3,
        l1UsableSources: 3,
        l2ProperScoreImproveOverL1Sources: 1,
        l2UsableSources: 3,
      });
      expect(output.arbitration.sourceSummaries.map((source) => source.sourceKey)).toEqual(["midus2", "creles", "haalsi"]);
      expect(output.arbitration.sourceSummaries[1]?.l2CommonLabVitalsVsL1.properScoreDirection).toBe("mixed_or_worse");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits when shadow memory is stale", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1120-stale-"));
    try {
      const paths = await writeInputs(tmp, { staleMemory: true });

      const { output } = await runR1120ConsumerLabVitalsShadowArbitration({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "consumer_lab_vitals_shadow_arbitration_waiting_on_inputs",
        nextAction: "refresh_midus_creles_haalsi_r1119_before_arbitration",
      });
      expect(output.inputArtifacts.r1119).toMatchObject({
        packetId: "r1119-consumer-shadow-evidence-memory",
        schemaVersion: null,
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe upstream artifacts with a sanitized error", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1120-unsafe-"));
    try {
      const paths = await writeInputs(tmp, { staleMemory: false });
      await writeJson(paths.midus2Path, {
        artifactBoundary: {
          aggregateOnly: true,
          rowValuesStored: true,
        },
        schemaVersion: "murph-age-midus2-local-benchmark.v1",
      });

      await expect(runR1120ConsumerLabVitalsShadowArbitration({
        outputDir: path.join(tmp, "out"),
        ...paths,
      })).rejects.toThrow("R1120 rejected unsafe midus2 input: 1 aggregate-egress violation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1120-cli-"));
    try {
      const paths = await writeInputs(tmp, { staleMemory: false });
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1120-consumer-lab-vitals-shadow-arbitration.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_CRELES_LOCAL_BENCHMARK_PATH: paths.crelesPath,
          MURPH_AGE_MIDUS2_LOCAL_BENCHMARK_PATH: paths.midus2Path,
          MURPH_AGE_R1044_HAALSI_BIOMARKER_PATH: paths.haalsiPath,
          MURPH_AGE_R1119_SHADOW_MEMORY_PATH: paths.r1119Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        l1ProperScoreImproveSources: number;
        l2ProperScoreImproveOverL1Sources: number;
        topCandidate: string;
      };
      expect(summary).toMatchObject({
        conclusion: "consumer_lab_vitals_shadow_arbitration_l1_first",
        l1ProperScoreImproveSources: 3,
        l2ProperScoreImproveOverL1Sources: 1,
        nextAction: "run_consumer_compatible_l1_receipt_with_l2_secondary_or_fill_private_mapping",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
        topCandidate: "L1_tiny_glycemia_only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("participant_id");
      expect(stdout).not.toContain("W1C_");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeInputs(tmp: string, options: { staleMemory: boolean }): Promise<{
  crelesPath: string;
  haalsiPath: string;
  midus2Path: string;
  r1119Path: string;
}> {
  const crelesPath = path.join(tmp, "creles.json");
  const haalsiPath = path.join(tmp, "haalsi.json");
  const midus2Path = path.join(tmp, "midus2.json");
  const r1119Path = path.join(tmp, "r1119.json");
  await Promise.all([
    writeJson(midus2Path, benchmarkFixture({
      l1: { auc: 0.83132875, brier: 0.06320764, events: 18, logLoss: 0.22553133, n: 212 },
      l1Id: "glycemia_only_no_crp",
      l2: { auc: 0.83533791, brier: 0.0631218, events: 18, logLoss: 0.22499615, n: 212 },
      l2Id: "clinical_core_labs_no_albumin_no_crp",
      reference: { auc: 0.83075601, brier: 0.06333251, events: 18, logLoss: 0.22584984, n: 212 },
      referenceId: "age_sex_reference",
      schemaVersion: "murph-age-midus2-local-benchmark.v1",
    })),
    writeJson(crelesPath, benchmarkFixture({
      l1: { auc: 0.76474649, brier: 0.12832495, events: 83, logLoss: 0.40865343, n: 467 },
      l1Id: "glycemia_only_no_crp",
      l2: { auc: 0.7498745, brier: 0.13068402, events: 83, logLoss: 0.41756282, n: 467 },
      l2Id: "bp_lipid_body_no_crp",
      reference: { auc: 0.75707518, brier: 0.12968098, events: 83, logLoss: 0.41285976, n: 467 },
      referenceId: "age_sex_reference",
      schemaVersion: "murph-age-creles-local-benchmark.v1",
    })),
    writeJson(haalsiPath, {
      ...benchmarkFixture({
        l1: { auc: 0.75597074, brier: 0.14921195, events: 229, logLoss: 0.4629565, n: 992 },
        l1Id: "A1_glucose",
        l2: { auc: 0.75173556, brier: 0.15060357, events: 229, logLoss: 0.46648421, n: 992 },
        l2Id: "B1_glucose_lipid_body_no_crp",
        reference: { auc: 0.74799544, brier: 0.15036736, events: 229, logLoss: 0.46681204, n: 992 },
        referenceId: "A0_age_sex",
        schemaVersion: "murph-age-r1044-haalsi-external-biomarker-loop.v1",
      }),
      packetId: "r1044-haalsi-external-biomarker-loop",
    }),
    writeJson(r1119Path, {
      artifactBoundary: safeBoundary(),
      packetId: "r1119-consumer-shadow-evidence-memory",
      schemaVersion: options.staleMemory ? "stale" : "murph-age-r1119-consumer-shadow-evidence-memory.v1",
      summary: {
        conclusion: "shadow_lab_evidence_recorded_continue_consumer_receipt_search",
      },
    }),
  ]);
  return { crelesPath, haalsiPath, midus2Path, r1119Path };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function benchmarkFixture(input: {
  l1: TestMetric;
  l1Id: string;
  l2: TestMetric;
  l2Id: string;
  reference: TestMetric;
  referenceId: string;
  schemaVersion: string;
}): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    models: {
      [input.referenceId]: {
        splitMetrics: {
          test: input.reference,
        },
      },
      [input.l1Id]: {
        splitMetrics: {
          test: input.l1,
        },
      },
      [input.l2Id]: {
        splitMetrics: {
          test: input.l2,
        },
      },
    },
    schemaVersion: input.schemaVersion,
  };
}

interface TestMetric {
  auc: number;
  brier: number;
  events: number;
  logLoss: number;
  n: number;
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
