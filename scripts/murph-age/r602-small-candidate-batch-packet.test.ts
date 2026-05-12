import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R602_SMALL_CANDIDATE_BATCH_PACKET_SCHEMA_VERSION,
  runR602SmallCandidateBatchPacket,
} from "./r602-small-candidate-batch-packet.ts";

describe("R602 small-candidate batch packet", () => {
  it("builds an aggregate-only reviewer packet for the small residual candidate batch", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r602-small-batch-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR602SmallCandidateBatchPacket({
        createdAt: "2026-05-12T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r602-small-candidate-batch-packet.latest.json");
      expect(output.schemaVersion).toBe(R602_SMALL_CANDIDATE_BATCH_PACKET_SCHEMA_VERSION);
      expect(output.packetId).toBe("r602-small-candidate-residual-batch");
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.boundary).toMatchObject({
        aggregateOnly: true,
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
      });
      expect(output.sources.map((source) => [source.sourceId, source.role, source.testSplitStability])).toEqual([
        ["midus2", "internal_development", "adequate-event-band"],
        ["midus-refresher", "internal_replication", "tiny-event-band"],
      ]);
      expect(output.sources[0]?.candidateResults.map((candidate) => candidate.candidateId)).toEqual([
        "body-only-residual",
        "bloodwork-only-residual",
        "bloodwork-plus-body-residual",
      ]);
      expect(output.sources[0]?.candidateResults[0]).toMatchObject({
        candidateId: "body-only-residual",
        featureCoverageBands: {
          "r399-logit": "1000+",
          bmi: "1000+",
        },
        featureKeys: ["r399-logit", "bmi"],
        localModelId: "r399_plus_bmi_increment",
      });
      expect(output.sources[0]?.candidateResults[2]?.metricDeltasVsAnchor).toEqual({
        aucDelta: 0.001764,
        brierDelta: -0.000174,
        logLossDelta: -0.000024,
        meanPredictionDelta: -0.001101,
      });
      expect(output.summary).toMatchObject({
        conclusion: "small_candidate_batch_requires_review",
        strongestInternalCandidate: "bloodwork-plus-body-residual",
      });
      expect(output.nextReviewGate.recommendation).toBe("send_r602_aggregate_results_direction_chorus");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("rawRows");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("coefficients\":");
      expect(persisted).not.toContain("selectedPointIds");
      expect(persisted).not.toContain("\"events\":");
      expect(persisted).not.toContain("\"n\":");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless aggregate CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r602-small-batch-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r602-small-candidate-batch-packet.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_MIDUS2_INCREMENT_PATH: paths.midus2IncrementPath,
          MURPH_AGE_MIDUS_REFRESHER_INCREMENT_PATH: paths.midusRefresherIncrementPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const parsed = JSON.parse(stdout);
      expect(parsed).toEqual({
        artifact: "r602-small-candidate-batch-packet.latest.json",
        packetId: "r602-small-candidate-residual-batch",
        productPromotionAuthorized: false,
        schemaVersion: R602_SMALL_CANDIDATE_BATCH_PACKET_SCHEMA_VERSION,
        sourceCount: 2,
        status: "research-local-aggregate-only",
        strongestInternalCandidate: "bloodwork-plus-body-residual",
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
  midus2IncrementPath: string;
  midusRefresherIncrementPath: string;
}> {
  await mkdir(tmp, { recursive: true });
  const midus2IncrementPath = path.join(tmp, "midus2.json");
  const midusRefresherIncrementPath = path.join(tmp, "midus-refresher.json");
  await Promise.all([
    writeJson(midus2IncrementPath, incrementOutput({
      benchmarkId: "r399-midus2-biomarker-increment-local-0",
      eligibleRows: 1054,
      endpoint: "10-year all-cause mortality, MIDUS 2 complete-window baseline years",
      eventCount: 82,
      schemaVersion: "murph-age-r399-midus2-biomarker-increment.v1",
      testEvents: 17,
      testRows: 217,
      metrics: {
        r399_anchor_recalibrated: model({
          auc: 0.7644117647058823,
          brier: 0.062712,
          featureKeys: ["r399-logit"],
          logLoss: 0.232347,
          meanPrediction: 0.069938,
          observedRate: 0.078341,
        }),
        r399_plus_bmi_increment: model({
          auc: 0.7647058823529411,
          brier: 0.062601,
          featureKeys: ["r399-logit", "bmi"],
          logLoss: 0.232200,
          meanPrediction: 0.069300,
          observedRate: 0.078341,
        }),
        r399_plus_lab3_increment: model({
          auc: 0.7655882352941177,
          brier: 0.062720,
          featureKeys: ["r399-logit", "hba1c", "log-triglycerides", "hdl-c"],
          logLoss: 0.232680,
          meanPrediction: 0.068985,
          observedRate: 0.078341,
        }),
        r399_plus_lab3_bmi_increment: model({
          auc: 0.7661764705882353,
          brier: 0.062538,
          featureKeys: ["r399-logit", "bmi", "hba1c", "log-triglycerides", "hdl-c"],
          logLoss: 0.232323,
          meanPrediction: 0.068837,
          observedRate: 0.078341,
        }),
      },
    })),
    writeJson(midusRefresherIncrementPath, incrementOutput({
      benchmarkId: "r399-midus-refresher-biomarker-increment-local-0",
      eligibleRows: 596,
      endpoint: "10-year all-cause mortality, MIDUS Refresher complete-window baseline years",
      eventCount: 24,
      schemaVersion: "murph-age-r399-midus-refresher-biomarker-increment.v1",
      testEvents: 4,
      testRows: 118,
      metrics: {
        r399_anchor_recalibrated: model({
          auc: 0.6644736842105263,
          brier: 0.032621,
          featureKeys: ["r399-logit"],
          logLoss: 0.145832,
          meanPrediction: 0.050353,
          observedRate: 0.033898,
        }),
        r399_plus_bmi_increment: model({
          auc: 0.6951754385964912,
          brier: 0.032492,
          featureKeys: ["r399-logit", "bmi"],
          logLoss: 0.143984,
          meanPrediction: 0.050365,
          observedRate: 0.033898,
        }),
        r399_plus_lab3_increment: model({
          auc: 0.7390350877192983,
          brier: 0.032261,
          featureKeys: ["r399-logit", "hba1c", "log-triglycerides", "hdl-c"],
          logLoss: 0.142055,
          meanPrediction: 0.050367,
          observedRate: 0.033898,
        }),
        r399_plus_lab3_bmi_increment: model({
          auc: 0.7521929824561403,
          brier: 0.032183,
          featureKeys: ["r399-logit", "bmi", "hba1c", "log-triglycerides", "hdl-c"],
          logLoss: 0.141327,
          meanPrediction: 0.050516,
          observedRate: 0.033898,
        }),
      },
    })),
  ]);
  return { midus2IncrementPath, midusRefresherIncrementPath };
}

function incrementOutput(input: {
  benchmarkId: string;
  eligibleRows: number;
  endpoint: string;
  eventCount: number;
  metrics: Record<string, unknown>;
  schemaVersion: string;
  testEvents: number;
  testRows: number;
}) {
  return {
    benchmarkId: input.benchmarkId,
    dataShape: {
      eligibleRows: input.eligibleRows,
      events: input.eventCount,
      splitCounts: {
        test: {
          events: input.testEvents,
          n: input.testRows,
        },
      },
    },
    endpoint: input.endpoint,
    models: input.metrics,
    schemaVersion: input.schemaVersion,
    status: "research-local-aggregate-only",
  };
}

function model(input: {
  auc: number;
  brier: number;
  featureKeys: string[];
  logLoss: number;
  meanPrediction: number;
  observedRate: number;
}) {
  return {
    featureKeys: input.featureKeys,
    featureObservedCounts: Object.fromEntries(input.featureKeys.map((key) => [key, 1054])),
    hypothesis: "Fixture hypothesis.",
    hypothesisSource: "train/calibration diagnostic",
    splitMetrics: {
      test: {
        auc: input.auc,
        brier: input.brier,
        logLoss: input.logLoss,
        meanPrediction: input.meanPrediction,
        observedRate: input.observedRate,
      },
    },
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
