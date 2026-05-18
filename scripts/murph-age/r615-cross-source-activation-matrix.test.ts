import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R615_CROSS_SOURCE_ACTIVATION_MATRIX_SCHEMA_VERSION,
  runR615CrossSourceActivationMatrix,
} from "./r615-cross-source-activation-matrix.ts";

describe("R615 cross-source activation matrix", () => {
  it("builds a compact aggregate-only matrix across the newly landed source families", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r615-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR615CrossSourceActivationMatrix({
        createdAt: "2026-05-13T00:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r615-cross-source-activation-matrix.latest.json");
      expect(output.schemaVersion).toBe(R615_CROSS_SOURCE_ACTIVATION_MATRIX_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.artifactBoundary).toMatchObject({
        aggregateOnly: true,
        codebookTextStored: false,
        coefficientsStored: false,
        localPathsStored: false,
        modelParametersStored: false,
        modelScoringPerformedByR615: false,
        outcomeScoringPerformedByR615: false,
        participantIdentifiersStored: false,
        predictionsStored: false,
        productClaimsIncluded: false,
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        rowParsingPerformedByR615: false,
        rowValuesStored: false,
        smallCellsStored: false,
        sourceBodiesStored: false,
        splitMembershipStored: false,
        variableNameSamplesStored: false,
      });
      expect(output.sourceRows.map((row) => [row.sourceFamily, row.activationTier])).toEqual([
        ["MHAS", "endpoint_contract_ready_no_scoring"],
        ["CRELES", "ready_for_aggregate_benchmark_completed"],
        ["MIDUS", "ready_for_aggregate_benchmark_completed"],
        ["NSHAP", "rights_blocked"],
        ["HAALSI", "outcome_blocked"],
        ["SAGE", "metadata_only"],
        ["NHANES", "same_family_internal_only"],
      ]);
      expect(output.nextBatch.map((action) => action.actionId)).toEqual([
        "draft_locked_mhas_endpoint_join_contract",
        "reduce_creles_glycemia_transport_receipt",
        "complete_nshap_source_rights_and_aggregate_output_labels",
        "refresh_cross_source_matrix_after_next_receipts",
      ]);
      expect(output.reviewGptOperatingRule.reviewGptOnlyFor).toContain("aggregate result interpretation");
      expect(output.summary).toEqual({
        conclusion: "cross_source_activation_matrix_ready",
        immediateExecutableAggregateBenchmarkCountBand: "1-4",
        modelPromotionAuthorized: false,
        nextPrimaryLocalAction: "draft_locked_mhas_endpoint_join_contract",
        productDisplayAuthorized: false,
        scoreBearingSourceCountBand: "1-4",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("H_MHAS");
      expect(persisted).not.toContain("SouthAfricaINDData");
      expect(persisted).not.toContain("q0406");
      expect(persisted).not.toContain("sampleVariableNames");
      expect(persisted).not.toContain("participantIds");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"modelParameters\":");
      expect(persisted).not.toContain("\"rowValues\":");
      expect(persisted).not.toContain("\"smallCells\":");
      expect(persisted).not.toContain("source body");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed when a source artifact boundary is unsafe", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r615-unsafe-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const unsafeMhasPath = path.join(tmp, "unsafe-mhas.json");
      await writeJson(unsafeMhasPath, {
        ...mhasLabelsFixture(),
        boundary: {
          ...safeBoundary(),
          rowValuesStored: true,
        },
      });

      await expect(runR615CrossSourceActivationMatrix({
        ...paths,
        r614MhasSourceRightsActivationLabelsPath: unsafeMhasPath,
      })).rejects.toThrow("r614MhasSourceRightsActivationLabels boundary has unsafe boundary flag rowValuesStored");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r615-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r615-cross-source-activation-matrix.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_CRELES_LOCAL_BENCHMARK_PATH: paths.crelesLocalBenchmarkPath,
          MURPH_AGE_HAALSI_SOURCE_FEASIBILITY_PATH: paths.haalsiSourceFeasibilityPath,
          MURPH_AGE_MIDUS2_LOCAL_BENCHMARK_PATH: paths.midus2LocalBenchmarkPath,
          MURPH_AGE_R612_NHANES_LAYERING_MAP_PATH: paths.r612NhanesLayeringMapPath,
          MURPH_AGE_R614_MHAS_LABELS_PATH: paths.r614MhasSourceRightsActivationLabelsPath,
          MURPH_AGE_R614_NSHAP_LABELS_PATH: paths.r614NshapActivationLabelsPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
          MURPH_AGE_SAGE_HEADER_PREFLIGHT_PATH: paths.sageSouthAfricaHeaderPreflightPath,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        artifact: "r615-cross-source-activation-matrix.latest.json",
        conclusion: "cross_source_activation_matrix_ready",
        immediateExecutableAggregateBenchmarkCountBand: "1-4",
        nextPrimaryLocalAction: "draft_locked_mhas_endpoint_join_contract",
        packetId: "r615-cross-source-activation-matrix",
        productDisplayAuthorized: false,
        schemaVersion: R615_CROSS_SOURCE_ACTIVATION_MATRIX_SCHEMA_VERSION,
        scoreBearingSourceCountBand: "1-4",
        status: "research-local-aggregate-only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("q0406");
      expect(stdout).not.toContain("coefficients");
      expect(stdout).not.toContain("predictions");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(tmp: string): Promise<{
  crelesLocalBenchmarkPath: string;
  haalsiSourceFeasibilityPath: string;
  midus2LocalBenchmarkPath: string;
  outputDir: string;
  r612NhanesLayeringMapPath: string;
  r614MhasSourceRightsActivationLabelsPath: string;
  r614NshapActivationLabelsPath: string;
  sageSouthAfricaHeaderPreflightPath: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  const paths = {
    crelesLocalBenchmarkPath: path.join(fixtureDir, "creles.json"),
    haalsiSourceFeasibilityPath: path.join(fixtureDir, "haalsi.json"),
    midus2LocalBenchmarkPath: path.join(fixtureDir, "midus2.json"),
    outputDir,
    r612NhanesLayeringMapPath: path.join(fixtureDir, "nhanes.json"),
    r614MhasSourceRightsActivationLabelsPath: path.join(fixtureDir, "mhas.json"),
    r614NshapActivationLabelsPath: path.join(fixtureDir, "nshap.json"),
    sageSouthAfricaHeaderPreflightPath: path.join(fixtureDir, "sage.json"),
  };

  await writeJson(paths.crelesLocalBenchmarkPath, scoredFixture("murph-age-creles-local-benchmark.v1"));
  await writeJson(paths.haalsiSourceFeasibilityPath, haalsiFixture());
  await writeJson(paths.midus2LocalBenchmarkPath, scoredFixture("murph-age-midus2-local-benchmark.v1"));
  await writeJson(paths.r612NhanesLayeringMapPath, nhanesFixture());
  await writeJson(paths.r614MhasSourceRightsActivationLabelsPath, mhasLabelsFixture());
  await writeJson(paths.r614NshapActivationLabelsPath, nshapLabelsFixture());
  await writeJson(paths.sageSouthAfricaHeaderPreflightPath, sageFixture());

  return paths;
}

function mhasLabelsFixture(): Record<string, unknown> {
  return {
    boundary: safeBoundary(),
    gates: {
      nextGate: "draft_locked_mhas_endpoint_join_contract",
    },
    localFamilyEvidence: {
      status: "complete",
    },
    packetId: "r614-mhas-source-rights-activation-labels",
    schemaVersion: "murph-age-r614-mhas-source-rights-activation-labels.v1",
    sourceRightsActivationLabels: {
      activationLabelsComplete: true,
    },
    status: "research-local-aggregate-only",
    summary: {
      endpointJoinContractReady: true,
      sourceRightsLabelsComplete: true,
    },
  };
}

function nshapLabelsFixture(): Record<string, unknown> {
  return {
    archiveReadiness: {
      status: "all_expected_archives_observed",
    },
    artifactBoundary: safeBoundary(),
    packetId: "r614-nshap-activation-labels",
    rowExecutionReadiness: {
      status: "blocked_source_rights_or_output_permission_unconfirmed",
    },
    schemaVersion: "murph-age-r614-nshap-activation-labels.v1",
    sourceRightsAndAggregateOutput: {
      aggregateOutputsActive: false,
      labelsComplete: false,
    },
    status: "research-local-aggregate-only",
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
    preflightConclusion: "metadata-only-source-candidate; needs terms/endpoint review before modeling",
    schemaVersion: "murph-age-source-header-preflight.v1",
    source: "WHO SAGE South Africa Wave 1 local download",
  };
}

function nhanesFixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r612-nhanes-layering-map",
    schemaVersion: "murph-age-r612-nhanes-layering-map.v1",
    status: "research-local-aggregate-only",
    summary: {
      objectiveActivityLayer: "shadow_only",
      scoreBearingResearchLayer: "lab_bp_body",
    },
  };
}

function scoredFixture(schemaVersion: string): Record<string, unknown> {
  return {
    benchmarkId: "aggregate-benchmark-fixture",
    modelScoringPerformed: true,
    packetId: "aggregate-benchmark-fixture",
    schemaVersion,
    status: "research-local-aggregate-only",
  };
}

function safeBoundary(): Record<string, unknown> {
  return {
    aggregateOnly: true,
    codebookProseStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformed: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    rowParsingPerformed: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
    variableLabelsStored: false,
    variableNamesStored: false,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
