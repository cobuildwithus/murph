import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R606_PARSIMONIOUS_GLYCEMIA_ABLATION_SCHEMA_VERSION,
  runR606ParsimoniousGlycemiaAblation,
} from "./r606-parsimonious-glycemia-ablation.ts";

describe("R606 parsimonious glycemia ablation packet", () => {
  it("summarizes supported aggregate-only glycemia/body ablations and flags missing BMI/glycemia-only cuts", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r606-ablation-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR606ParsimoniousGlycemiaAblation({
        createdAt: "2026-05-13T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r606-parsimonious-glycemia-ablation.latest.json");
      expect(output.schemaVersion).toBe(R606_PARSIMONIOUS_GLYCEMIA_ABLATION_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.boundary).toMatchObject({
        aggregateOnly: true,
        codebookProseStored: false,
        codebookTextStored: false,
        coefficientsStored: false,
        localPathsStored: false,
        modelParametersStored: false,
        participantIdentifiersStored: false,
        predictionsStored: false,
        productClaimsIncluded: false,
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        rowValuesStored: false,
        smallCellsStored: false,
        sourceBodiesStored: false,
        splitMembershipStored: false,
      });
      expect(output.summary).toEqual({
        availableSourceCountBand: "1-9",
        conclusion: "partial_aggregate_packet_ready",
        smallestSupportedCombination: "age_sex_plus_glycemia_body",
        unsupportedCandidateIds: ["age_sex_plus_bmi", "age_sex_plus_glycemia"],
      });
      expect(output.sources.map((source) => source.status)).toEqual(["available", "available"]);
      const midus = output.sources[0];
      expect(midus.status).toBe("available");
      if (midus.status !== "available") throw new Error("expected MIDUS fixture to be available");
      expect(midus.countBands).toEqual({
        eligibleRows: "100-499",
        eventCount: "10-49",
        testEventCount: "1-9",
        testRows: "50-99",
      });
      expect(midus.parsimoniousCandidates.map((candidate) => [candidate.candidateId, candidate.status])).toEqual([
        ["age_sex_reference", "available"],
        ["age_sex_plus_bmi", "unsupported"],
        ["age_sex_plus_glycemia", "unsupported"],
        ["age_sex_plus_glycemia_body", "available"],
      ]);
      const combo = midus.parsimoniousCandidates.find((candidate) => candidate.candidateId === "age_sex_plus_glycemia_body");
      expect(combo).toMatchObject({
        candidateRole: "proposal",
        deltasVsAgeSex: {
          aucDelta: 0.02,
          brierDelta: -0.002,
          logLossDelta: -0.01,
        },
        featureKeys: ["age", "male", "bmi", "hba1c"],
        metrics: {
          auc: 0.72,
          brier: 0.078,
          logLoss: 0.27,
          meanPrediction: 0.2,
          observedRate: 0.18,
        },
        modelId: "glycemia_body_no_crp",
        status: "available",
      });
      expect(output.recommendations.narrowestNextCodePath).toContain("age/sex + BMI");
      expect(output.recommendations.narrowestNextCodePath).toContain("age/sex + glycemia");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("rawRows");
      expect(persisted).not.toContain("participantIds");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"rowCount\":");
      expect(persisted).not.toContain("\"smallCell\"");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r606-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r606-parsimonious-glycemia-ablation.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_CRELES_OUTPUT_PATH: paths.crelesLocalPath,
          MURPH_AGE_MIDUS2_OUTPUT_PATH: paths.midus2LocalPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const parsed = JSON.parse(stdout);
      expect(parsed).toEqual({
        artifact: "r606-parsimonious-glycemia-ablation.latest.json",
        availableSourceCountBand: "1-9",
        conclusion: "partial_aggregate_packet_ready",
        packetId: "r606-parsimonious-glycemia-ablation",
        productPromotionAuthorized: false,
        schemaVersion: R606_PARSIMONIOUS_GLYCEMIA_ABLATION_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
        unsupportedCandidateIds: ["age_sex_plus_bmi", "age_sex_plus_glycemia"],
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("coefficients");
      expect(stdout).not.toContain("predictions");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("creates an explicit blocked packet when aggregate artifacts are absent", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r606-missing-"));
    try {
      const { output } = await runR606ParsimoniousGlycemiaAblation({
        crelesLocalPath: path.join(tmp, "missing-creles.json"),
        midus2LocalPath: path.join(tmp, "missing-midus.json"),
        outputDir: path.join(tmp, "out"),
      });

      expect(output.status).toBe("blocked-insufficient-aggregate-detail");
      expect(output.summary).toEqual({
        availableSourceCountBand: "0",
        conclusion: "no_supported_artifacts",
        smallestSupportedCombination: null,
        unsupportedCandidateIds: [],
      });
      expect(output.sources).toEqual([
        {
          artifact: "midus2-local-benchmark.latest.json",
          reason: "missing_artifact",
          sourceId: "midus2-local",
          status: "missing",
        },
        {
          artifact: "creles-local-benchmark.latest.json",
          reason: "missing_artifact",
          sourceId: "creles-local",
          status: "missing",
        },
      ]);
      expect(output.recommendations.narrowestNextCodePath).toContain("existing MIDUS and CRELES local benchmark runners");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(tmp: string): Promise<{
  crelesLocalPath: string;
  midus2LocalPath: string;
}> {
  await mkdir(tmp, { recursive: true });
  const midus2LocalPath = path.join(tmp, "midus2-local.json");
  const crelesLocalPath = path.join(tmp, "creles-local.json");
  await Promise.all([
    writeJson(midus2LocalPath, localBenchmarkFixture({
      benchmarkId: "midus2-biomarker-10y-complete-window-local-0",
      endpoint: "10-year all-cause mortality, MIDUS 2 complete-window baseline years",
      featureKeys: ["age", "male", "bmi", "hba1c"],
      schemaVersion: "murph-age-midus2-local-benchmark.v1",
    })),
    writeJson(crelesLocalPath, localBenchmarkFixture({
      benchmarkId: "creles-wave1-wave3-mortality-status-local-0",
      endpoint: "death by CRELES wave 3 among participants with known wave-3 status",
      featureKeys: ["age", "male", "bmi", "hba1c", "glucose"],
      schemaVersion: "murph-age-creles-local-benchmark.v1",
    })),
  ]);
  return { crelesLocalPath, midus2LocalPath };
}

function localBenchmarkFixture(input: {
  benchmarkId: string;
  endpoint: string;
  featureKeys: string[];
  schemaVersion: string;
}) {
  return {
    benchmarkId: input.benchmarkId,
    codebookTextStored: false,
    coefficientsStored: false,
    dataShape: {
      eligibleRows: 180,
      events: 24,
      splitCounts: {
        calibration: { events: 9, n: 60 },
        test: { events: 8, n: 60 },
        train: { events: 7, n: 60 },
      },
    },
    endpoint: input.endpoint,
    models: {
      age_sex_reference: modelFixture({
        candidateRole: "reference",
        featureKeys: ["age", "male"],
        metrics: {
          auc: 0.7,
          brier: 0.08,
          logLoss: 0.28,
          meanPrediction: 0.19,
          observedRate: 0.18,
        },
      }),
      glycemia_body_no_crp: modelFixture({
        candidateRole: "proposal",
        featureKeys: input.featureKeys,
        metrics: {
          auc: 0.72,
          brier: 0.078,
          logLoss: 0.27,
          meanPrediction: 0.2,
          observedRate: 0.18,
        },
      }),
    },
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    rowValuesStored: false,
    schemaVersion: input.schemaVersion,
    sourceBodiesStored: false,
    splitMembershipStored: false,
    status: "research-local-aggregate-only",
  };
}

function modelFixture(input: {
  candidateRole: string;
  featureKeys: string[];
  metrics: {
    auc: number;
    brier: number;
    logLoss: number;
    meanPrediction: number;
    observedRate: number;
  };
}) {
  return {
    candidateRole: input.candidateRole,
    coefficientsStored: false,
    featureKeys: input.featureKeys,
    predictionsStored: false,
    splitMetrics: {
      calibration: { ...input.metrics },
      test: { ...input.metrics },
      train: { ...input.metrics },
    },
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
