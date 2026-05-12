import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R600_AGGREGATE_RESULTS_PACKET_SCHEMA_VERSION,
  runR600AggregateResultsPacket,
} from "./r600-aggregate-results-packet.ts";

describe("R600 aggregate-results packet", () => {
  it("builds a reviewer-safe packet from MIDUS internal aggregate results", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r600-results-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR600AggregateResultsPacket({
        createdAt: "2026-05-12T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r600-aggregate-results-packet.latest.json");
      expect(output.schemaVersion).toBe(R600_AGGREGATE_RESULTS_PACKET_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.packetId).toBe("r600-frozen-anchor-residual-increment-aggregate-results");
      expect(output.boundary).toMatchObject({
        aggregateOnly: true,
        coefficientsStored: false,
        localPathsStored: false,
        modelParametersStored: false,
        participantIdentifiersStored: false,
        predictionsStored: false,
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        rowValuesStored: false,
        sourceBodiesStored: false,
        splitMembershipStored: false,
      });
      expect(output.upstreamManifest).toMatchObject({
        candidateBatchId: "r600-frozen-anchor-residual-increment-batch",
        candidateBatchStatus: "frozen-research-only",
      });
      expect(output.upstreamManifest.sourceRoles).toContainEqual({
        id: "midus-refresher",
        optimizationAllowed: false,
        role: "internal_replication",
      });
      expect(output.sources.map((source) => [source.sourceId, source.role, source.testSplitStability])).toEqual([
        ["midus2", "internal_development", "adequate-event-band"],
        ["midus-refresher", "internal_replication", "tiny-event-band"],
      ]);
      expect(output.sources[0]?.countBands).toEqual({
        eligibleRows: "1000+",
        eventCount: "50-99",
        testEventCount: "10-49",
        testRows: "100-499",
      });
      expect(output.sources[1]?.countBands).toEqual({
        eligibleRows: "500-999",
        eventCount: "10-49",
        testEventCount: "1-9",
        testRows: "100-499",
      });
      expect(output.sources[0]?.candidateResults[1]?.metricDeltasVsAnchor).toEqual({
        aucDelta: 0.001765,
        brierDelta: -0.000174,
        logLossDelta: -0.000024,
        meanPredictionDelta: -0.001101,
      });
      expect(output.sources[1]?.candidateResults[1]?.signal).toBe("directionally_promising");
      expect(output.summary).toMatchObject({
        bestCurrentCandidate: "r399-plus-compact-bloodwork-body-residual",
        conclusion: "weak_internal_signal_not_promotable",
      });
      expect(output.nextReviewGate.recommendation).toBe("send_aggregate_results_gate");
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
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r600-results-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r600-aggregate-results-packet.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_LAYERING_READINESS_PATH: paths.readinessPath,
          MURPH_AGE_MIDUS2_INCREMENT_PATH: paths.midus2IncrementPath,
          MURPH_AGE_MIDUS_REFRESHER_INCREMENT_PATH: paths.midusRefresherIncrementPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const parsed = JSON.parse(stdout);
      expect(parsed).toEqual({
        artifact: "r600-aggregate-results-packet.latest.json",
        conclusion: "weak_internal_signal_not_promotable",
        packetId: "r600-frozen-anchor-residual-increment-aggregate-results",
        productPromotionAuthorized: false,
        schemaVersion: R600_AGGREGATE_RESULTS_PACKET_SCHEMA_VERSION,
        sourceCount: 2,
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
  midus2IncrementPath: string;
  midusRefresherIncrementPath: string;
  readinessPath: string;
}> {
  await mkdir(tmp, { recursive: true });
  const midus2IncrementPath = path.join(tmp, "midus2.json");
  const midusRefresherIncrementPath = path.join(tmp, "midus-refresher.json");
  const readinessPath = path.join(tmp, "readiness.json");
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
        r399_anchor_recalibrated: metric({ auc: 0.7644117647058823, brier: 0.062712, logLoss: 0.232347, meanPrediction: 0.069938, observedRate: 0.078341 }),
        r399_plus_lab3_increment: metric({ auc: 0.7655882352941177, brier: 0.06272, logLoss: 0.23268, meanPrediction: 0.068985, observedRate: 0.078341 }),
        r399_plus_lab3_bmi_increment: metric({ auc: 0.7661764705882353, brier: 0.062538, logLoss: 0.232323, meanPrediction: 0.068837, observedRate: 0.078341 }),
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
        r399_anchor_recalibrated: metric({ auc: 0.6644736842105263, brier: 0.032621, logLoss: 0.145832, meanPrediction: 0.050353, observedRate: 0.033898 }),
        r399_plus_lab3_increment: metric({ auc: 0.7390350877192983, brier: 0.032261, logLoss: 0.142055, meanPrediction: 0.050367, observedRate: 0.033898 }),
        r399_plus_lab3_bmi_increment: metric({ auc: 0.7521929824561403, brier: 0.032183, logLoss: 0.141327, meanPrediction: 0.050516, observedRate: 0.033898 }),
      },
    })),
    writeJson(readinessPath, {
      nextLoop: {
        candidateBatch: {
          batchId: "r600-frozen-anchor-residual-increment-batch",
          status: "frozen-research-only",
        },
        sourceRoles: [
          { id: "nhis-r399", optimizationAllowed: false, role: "frozen_anchor" },
          { id: "midus2", optimizationAllowed: true, role: "internal_development" },
          { id: "midus-refresher", optimizationAllowed: false, role: "internal_replication" },
          { id: "creles", optimizationAllowed: false, role: "transport_stress" },
          { id: "wearables", optimizationAllowed: false, role: "shadow_context" },
        ],
      },
    }),
  ]);
  return { midus2IncrementPath, midusRefresherIncrementPath, readinessPath };
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

function metric(input: {
  auc: number;
  brier: number;
  logLoss: number;
  meanPrediction: number;
  observedRate: number;
}) {
  return {
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
