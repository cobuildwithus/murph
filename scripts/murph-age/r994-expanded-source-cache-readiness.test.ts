import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R994_EXPANDED_SOURCE_CACHE_READINESS_SCHEMA_VERSION,
  runR994ExpandedSourceCacheReadiness,
} from "./r994-expanded-source-cache-readiness.ts";

describe("R994 expanded source cache readiness", () => {
  it("reduces expanded sources into aggregate-only readiness buckets without cache path egress", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r994-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR994ExpandedSourceCacheReadiness({
        createdAt: "2026-05-13T00:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r994-expanded-source-cache-readiness.latest.json");
      expect(output.schemaVersion).toBe(R994_EXPANDED_SOURCE_CACHE_READINESS_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.summary).toEqual({
        cacheInspected: true,
        fastestLaneNow: "MHAS/Gateway MHAS",
        productDisplayAuthorized: false,
        scoreBearingCompleteCountBand: "1-4",
        sourcePriorityVerdict: "mhas_no_score_card_first_then_reuse_completed_midsize_score_receipts",
      });
      expect(output.categoryBuckets).toEqual({
        "score-bearing_complete": ["MIDUS core/refresher", "CRELES waves"],
        "ready_for_no-score_source_card": ["MHAS/Gateway MHAS"],
        blocked_on_endpoint: ["HAALSI"],
        blocked_on_activation_or_confirmation: ["NSHAP rounds 1-3"],
        "context-only": ["SAGE South Africa", "NHANES"],
      });
      expect(output.sourceReadiness.map((source) => [source.sourceFamily, source.category])).toEqual([
        ["MIDUS core/refresher", "score-bearing_complete"],
        ["CRELES waves", "score-bearing_complete"],
        ["MHAS/Gateway MHAS", "ready_for_no-score_source_card"],
        ["NSHAP rounds 1-3", "blocked_on_activation_or_confirmation"],
        ["HAALSI", "blocked_on_endpoint"],
        ["SAGE South Africa", "context-only"],
        ["NHANES", "context-only"],
      ]);
      expect(output.sourceReadiness.every((source) => source.cache.cacheRootInspected)).toBe(true);
      expect(output.sourceReadiness.every((source) => source.cache.localFileNamesStored === false)).toBe(true);
      expect(output.sourceReadiness.every((source) => source.cache.localPathsStored === false)).toBe(true);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("cache-entry-a");
      expect(persisted).not.toContain("cache-entry-b");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"rowValues\":");
      expect(persisted).not.toContain("\"sourceBodies\": true");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed when an input artifact declares unsafe egress", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r994-unsafe-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const unsafePath = path.join(tmp, "unsafe-r615.json");
      await writeJson(unsafePath, {
        ...activationMatrixFixture(),
        artifactBoundary: {
          ...safeBoundary(),
          sourceBodiesStored: true,
        },
      });

      await expect(runR994ExpandedSourceCacheReadiness({
        ...paths,
        r615CrossSourceActivationMatrixPath: unsafePath,
      })).rejects.toThrow("r615CrossSourceActivationMatrix boundary has unsafe boundary flag sourceBodiesStored");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r994-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r994-expanded-source-cache-readiness.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
          MURPH_AGE_SOURCE_CACHE_ROOT: paths.sourceCacheRoot,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        artifact: "r994-expanded-source-cache-readiness.latest.json",
        fastestLaneNow: "MHAS/Gateway MHAS",
        packetId: "r994-expanded-source-cache-readiness",
        productDisplayAuthorized: false,
        schemaVersion: R994_EXPANDED_SOURCE_CACHE_READINESS_SCHEMA_VERSION,
        scoreBearingComplete: ["MIDUS core/refresher", "CRELES waves"],
        sourcePriorityVerdict: "mhas_no_score_card_first_then_reuse_completed_midsize_score_receipts",
        status: "research-local-aggregate-only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("cache-entry-a");
      expect(stdout).not.toContain("cache-entry-b");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(tmp: string): Promise<{
  crelesLocalBenchmarkPath: string;
  haalsiSourceFeasibilityPath: string;
  midusCoreBenchmarkPath: string;
  midusRefresherBenchmarkPath: string;
  outputDir: string;
  r612NhanesLayeringMapPath: string;
  r614MhasSourceRightsActivationLabelsPath: string;
  r614NshapActivationLabelsPath: string;
  r615CrossSourceActivationMatrixPath: string;
  r987CrelesGlycemiaReceiptReducerPath: string;
  r992NshapFunctionCognitionScaffoldPath: string;
  sageSourceFeasibilityPath: string;
  sourceCacheRoot: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  const sourceCacheRoot = path.join(tmp, "cache");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await writeCacheFixtures(sourceCacheRoot);

  const paths = {
    crelesLocalBenchmarkPath: path.join(fixtureDir, "creles.json"),
    haalsiSourceFeasibilityPath: path.join(fixtureDir, "haalsi.json"),
    midusCoreBenchmarkPath: path.join(fixtureDir, "midus-core.json"),
    midusRefresherBenchmarkPath: path.join(fixtureDir, "midus-refresher.json"),
    outputDir,
    r612NhanesLayeringMapPath: path.join(fixtureDir, "r612.json"),
    r614MhasSourceRightsActivationLabelsPath: path.join(fixtureDir, "r614-mhas.json"),
    r614NshapActivationLabelsPath: path.join(fixtureDir, "r614-nshap.json"),
    r615CrossSourceActivationMatrixPath: path.join(fixtureDir, "r615.json"),
    r987CrelesGlycemiaReceiptReducerPath: path.join(fixtureDir, "r987.json"),
    r992NshapFunctionCognitionScaffoldPath: path.join(fixtureDir, "r992.json"),
    sageSourceFeasibilityPath: path.join(fixtureDir, "sage.json"),
    sourceCacheRoot,
  };

  await Promise.all([
    writeJson(paths.crelesLocalBenchmarkPath, scoreBearingBenchmarkFixture("creles-local-benchmark")),
    writeJson(paths.haalsiSourceFeasibilityPath, haalsiFixture()),
    writeJson(paths.midusCoreBenchmarkPath, scoreBearingBenchmarkFixture("midus2-local-benchmark")),
    writeJson(paths.midusRefresherBenchmarkPath, midusRefresherFixture()),
    writeJson(paths.r612NhanesLayeringMapPath, nhanesLayeringFixture()),
    writeJson(paths.r614MhasSourceRightsActivationLabelsPath, mhasLabelsFixture()),
    writeJson(paths.r614NshapActivationLabelsPath, nshapLabelsFixture()),
    writeJson(paths.r615CrossSourceActivationMatrixPath, activationMatrixFixture()),
    writeJson(paths.r987CrelesGlycemiaReceiptReducerPath, crelesReceiptFixture()),
    writeJson(paths.r992NshapFunctionCognitionScaffoldPath, {
      artifactBoundary: safeBoundary(),
      packetId: "r992-nshap-function-cognition-scaffold",
      schemaVersion: "murph-age-r992-nshap-function-cognition-scaffold.v1",
      status: "research-local-aggregate-only",
    }),
    writeJson(paths.sageSourceFeasibilityPath, sageFixture()),
  ]);

  return paths;
}

async function writeCacheFixtures(root: string): Promise<void> {
  const sourceDirs = [
    "midus_core_fixture",
    "midus_refresher_fixture",
    "creles_fixture",
    "mhas_gateway_fixture",
    "nshap_fixture",
    "haalsi_fixture",
    "who_sage_fixture",
    "nhefs_fixture",
  ];
  await Promise.all(sourceDirs.map(async (dir) => {
    const nested = path.join(root, dir, "nested");
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(nested, "cache-entry-a"), "x\n");
    await writeFile(path.join(nested, "cache-entry-b"), "x\n");
  }));
}

function activationMatrixFixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r615-cross-source-activation-matrix",
    schemaVersion: "murph-age-r615-cross-source-activation-matrix.v1",
    sourceRows: [
      sourceRow("MHAS", "endpoint_contract_ready_no_scoring", false, "non_us_external_candidate", "green"),
      sourceRow("CRELES", "ready_for_aggregate_benchmark_completed", true, "non_nhanes_transport_diagnostic", "green"),
      sourceRow("MIDUS", "ready_for_aggregate_benchmark_completed", true, "non_nhanes_transport_diagnostic", "green"),
      sourceRow("NSHAP", "rights_blocked", false, "metadata_transport_candidate", "yellow"),
      sourceRow("HAALSI", "outcome_blocked", false, "metadata_transport_candidate", "yellow"),
      sourceRow("SAGE", "metadata_only", false, "context_only_candidate", "yellow"),
      sourceRow("NHANES", "same_family_internal_only", false, "same_family_internal", "not_applicable"),
    ],
    status: "research-local-aggregate-only",
  };
}

function sourceRow(
  sourceFamily: string,
  activationTier: string,
  modelScoringAlreadyPerformed: boolean,
  evidenceClass: string,
  joinOrWaveLabel: string,
): Record<string, unknown> {
  return {
    activationTier,
    aggregateOutputLabel: sourceFamily === "NSHAP" ? "red" : "green",
    candidateDomainLabels: {
      cognitionOrContext: "yellow",
      functionOrDisability: "green",
      hardOutcome: sourceFamily === "HAALSI" ? "red" : "green",
      labBpBody: "green",
      wearableOrActivity: "yellow",
    },
    evidenceClass,
    joinOrWaveLabel,
    modelScoringAlreadyPerformed,
    sourceFamily,
    sourceRightsLabel: sourceFamily === "NSHAP" ? "red" : "green",
  };
}

function mhasLabelsFixture(): Record<string, unknown> {
  return {
    boundary: safeBoundary(),
    packetId: "r614-mhas-source-rights-activation-labels",
    schemaVersion: "murph-age-r614-mhas-source-rights-activation-labels.v1",
    status: "research-local-aggregate-only",
    summary: {
      endpointJoinContractReady: true,
      sourceRightsLabelsComplete: true,
    },
  };
}

function nshapLabelsFixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    lockedBenchmarkCard: {
      available: true,
    },
    packetId: "r614-nshap-activation-labels",
    schemaVersion: "murph-age-r614-nshap-activation-labels.v1",
    status: "research-local-aggregate-only",
    summary: {
      aggregateOutputsActive: false,
      sourceRightsLabelsComplete: false,
    },
  };
}

function haalsiFixture(): Record<string, unknown> {
  return {
    boundary: safeBoundary(),
    endpointReadiness: {
      status: "blocked_missing_mortality_or_followup_header_coverage",
    },
    packetId: "haalsi-source-feasibility",
    schemaVersion: "murph-age-haalsi-source-feasibility.v1",
    status: "research-local-metadata-only",
  };
}

function sageFixture(): Record<string, unknown> {
  return {
    boundary: safeBoundary(),
    laneAssessment: {
      classification: "source_fit_context_lane",
    },
    packetId: "sage-source-feasibility",
    schemaVersion: "murph-age-sage-source-feasibility.v1",
    status: "research-local-metadata-only",
  };
}

function nhanesLayeringFixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r612-nhanes-layering-map",
    schemaVersion: "murph-age-r612-nhanes-layering-map.v1",
    status: "research-local-aggregate-only",
    summary: {
      scoreBearingResearchLayer: "lab_bp_body",
    },
  };
}

function scoreBearingBenchmarkFixture(packetId: string): Record<string, unknown> {
  return {
    codebookTextStored: false,
    modelScoringPerformed: true,
    packetId,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    rowValuesStored: false,
    schemaVersion: "test-schema",
    sourceBodiesStored: false,
    status: "research-local-aggregate-only",
  };
}

function midusRefresherFixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    incrementEvaluationCard: {
      outputBoundary: safeBoundary(),
    },
    packetId: "r399-midus-refresher-biomarker-increment",
    schemaVersion: "murph-age-r399-midus-refresher-biomarker-increment.v1",
    status: "research-local-aggregate-only",
  };
}

function crelesReceiptFixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r987-creles-glycemia-receipt-reducer",
    receiptReduction: {
      crelesEvidenceStatus: "available",
    },
    schemaVersion: "murph-age-r987-creles-glycemia-receipt-reducer.v1",
    status: "research-local-aggregate-only",
  };
}

function safeBoundary(): Record<string, unknown> {
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
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
