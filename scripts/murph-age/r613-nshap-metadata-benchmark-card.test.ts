import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R613_NSHAP_METADATA_BENCHMARK_CARD_SCHEMA_VERSION,
  runR613NshapMetadataBenchmarkCard,
} from "./r613-nshap-metadata-benchmark-card.ts";

describe("R613 NSHAP metadata benchmark card", () => {
  it("locks a metadata-only NSHAP benchmark card without unlocking execution", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r613-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR613NshapMetadataBenchmarkCard({
        createdAt: "2026-05-13T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r613-nshap-metadata-benchmark-card.latest.json");
      expect(output.schemaVersion).toBe(R613_NSHAP_METADATA_BENCHMARK_CARD_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.artifactBoundary).toMatchObject({
        aggregateOnly: true,
        codebookTextStored: false,
        coefficientsStored: false,
        localPathsStored: false,
        modelParametersStored: false,
        outcomeScoringPerformed: false,
        participantIdentifiersStored: false,
        predictionsStored: false,
        productClaimsIncluded: false,
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        rowParsingPerformed: false,
        rowValuesStored: false,
        smallCellsStored: false,
        sourceBodiesStored: false,
        splitMembershipStored: false,
      });
      expect(output.inputArtifacts.nshapActivationFeasibility).toMatchObject({
        artifact: "nshap-activation-feasibility.latest.json",
        packetId: "nshap-activation-feasibility",
        status: "available",
      });
      expect(output.benchmarkCard).toMatchObject({
        cardId: "nshap-metadata-benchmark-card",
        cardStatus: "metadata_locked_no_execution",
        endpointFamily: "mortality_or_followup",
        source: "NSHAP",
        sourceActivation: {
          aggregateOutputPermission: "unconfirmed_human_required",
          rowParsingUnlocked: false,
          sourceRightsLabelsComplete: false,
          termsAllowLocalResearchRows: "unconfirmed_human_required",
        },
        sourceFit: {
          endpointReadyForBenchmarkDesign: true,
          fileCoverageStatus: "present",
          headerCoverageStatus: "present",
          rowActivationRequiredBeforeExecution: true,
        },
      });
      expect(output.benchmarkCard.candidateFamilies.map((candidate) => candidate.candidateFamilyId)).toEqual([
        "anchor_only_reference",
        "anchor_plus_function_sidecar",
        "lab_bp_body_biomarker_increment",
        "glycemia_only_frozen_external_candidate",
        "cognition_shadow_after_function",
      ]);
      expect(output.gateStatus).toEqual({
        lockedBenchmarkCardAvailable: true,
        nextAction: "fill_nshap_source_rights_and_aggregate_output_labels",
        outcomeScoringUnlocked: false,
        rowExecutionUnlocked: false,
      });
      expect(output.summary).toEqual({
        conclusion: "nshap_metadata_benchmark_card_locked_without_execution",
        nhanesLabLayerCarriedAsResearchOnly: true,
        outcomeScoringUnlockedCountBand: "0",
        productPromotionAuthorized: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("rawRows");
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

  it("fails closed when an input artifact boundary exports unsafe values", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r613-boundary-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const unsafeNshap = path.join(tmp, "unsafe-nshap.json");
      await writeJson(unsafeNshap, {
        ...nshapFixture(),
        boundary: {
          ...nshapFixture().boundary,
          rowValuesStored: true,
        },
      });

      await expect(runR613NshapMetadataBenchmarkCard({
        outputDir: path.join(tmp, "out"),
        ...paths,
        nshapActivationFeasibilityPath: unsafeNshap,
      })).rejects.toThrow("nshapActivationFeasibility boundary flag rowValuesStored must be false");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r613-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r613-nshap-metadata-benchmark-card.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_NSHAP_ACTIVATION_FEASIBILITY_PATH: paths.nshapActivationFeasibilityPath,
          MURPH_AGE_R609_SOURCE_ACTIVATION_QUEUE_PATH: paths.r609Path,
          MURPH_AGE_R612_NHANES_LAYERING_MAP_PATH: paths.r612Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        artifact: "r613-nshap-metadata-benchmark-card.latest.json",
        conclusion: "nshap_metadata_benchmark_card_locked_without_execution",
        nextAction: "fill_nshap_source_rights_and_aggregate_output_labels",
        outcomeScoringUnlockedCountBand: "0",
        packetId: "r613-nshap-metadata-benchmark-card",
        productPromotionAuthorized: false,
        schemaVersion: R613_NSHAP_METADATA_BENCHMARK_CARD_SCHEMA_VERSION,
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
  nshapActivationFeasibilityPath: string;
  r609Path: string;
  r612Path: string;
}> {
  await mkdir(tmp, { recursive: true });
  const paths = {
    nshapActivationFeasibilityPath: path.join(tmp, "nshap.json"),
    r609Path: path.join(tmp, "r609.json"),
    r612Path: path.join(tmp, "r612.json"),
  };
  await Promise.all([
    writeJson(paths.nshapActivationFeasibilityPath, nshapFixture()),
    writeJson(paths.r609Path, r609Fixture()),
    writeJson(paths.r612Path, r612Fixture()),
  ]);
  return paths;
}

function nshapFixture() {
  return {
    boundary: safeBoundary(),
    endpointReadiness: {
      readyForLockedBenchmarkDesign: true,
      rowActivationRequiredBeforeExecution: true,
    },
    fileCoverage: {
      status: "present",
    },
    headerCoverage: {
      status: "present",
    },
    packetId: "nshap-activation-feasibility",
    schemaVersion: "murph-age-nshap-activation-feasibility.v1",
  };
}

function r609Fixture() {
  return {
    boundary: safeBoundary(),
    packetId: "r609-source-activation-queue",
    schemaVersion: "murph-age-r609-source-activation-queue.v1",
  };
}

function r612Fixture() {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r612-nhanes-layering-map",
    schemaVersion: "murph-age-r612-nhanes-layering-map.v1",
    summary: {
      modelDefaultAuthorized: false,
      scoreBearingResearchLayer: "lab_bp_body",
    },
  };
}

function safeBoundary() {
  return {
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    modelScoringPerformed: false,
    outcomeScoringPerformed: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    protocolClaimsIncluded: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformed: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitIdentifiersStored: false,
    splitMembershipStored: false,
    variableLabelsStored: false,
    variableNamesStored: false,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
