import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R611_MHAS_METADATA_SOURCE_INTAKE_SCHEMA_VERSION,
  runR611MhasMetadataSourceIntake,
} from "./r611-mhas-metadata-source-intake.ts";

describe("R611 MHAS metadata source intake", () => {
  it("completes the R610 MHAS metadata-only source-intake loop without unlocking rows or scoring", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r611-mhas-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR611MhasMetadataSourceIntake({
        createdAt: "2026-05-13T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r611-mhas-metadata-source-intake.latest.json");
      expect(output.schemaVersion).toBe(R611_MHAS_METADATA_SOURCE_INTAKE_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.boundary).toMatchObject({
        aggregateOnly: true,
        codebookProseStored: false,
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
        splitMembershipStored: false,
        variableLabelsStored: false,
        variableNamesStored: false,
      });
      expect(output.completedLoop).toMatchObject({
        evidenceArtifactsAvailable: [
          "mhas-join-probe.latest.json",
          "mhas-source-feasibility.latest.json",
        ],
        evidenceArtifactsMissing: [],
        laneId: "mhas-harmonized-eol",
        r609LaneStatus: "metadata_ready",
        requestedLocalAction: "complete_mhas_metadata_source_intake",
        r610NextActionMatched: true,
      });
      expect(output.sourceCoverage).toMatchObject({
        eolDatasetPresent: true,
        eolInventoryLanePresent: true,
        harmonizedDatasetPresent: true,
        harmonizedInventoryLanePresent: true,
        requiredDatasetsPresent: true,
      });
      expect(output.sourceCoverage.broadFeatureFamilyStatuses).toContainEqual({
        family: "mortality_or_eol",
        status: "available",
      });
      expect(output.sourceRightsAndActivation).toEqual({
        activationLabelsComplete: false,
        aggregateOutputPermission: "unconfirmed_human_required",
        rowParsingUnlocked: false,
        sourceActivationStatus: "metadata-only-not-activated",
        termsAllowLocalResearchRows: "unconfirmed_human_required",
      });
      expect(output.joinAndEndpointMetadata).toEqual({
        eolEndpointMetadataStatus: "endpoint_metadata_ready_for_contract",
        joinBlockerReasons: ["missing_join_key_family_overlap"],
        joinKeyFamilyStatus: "candidate_family_overlap_not_detected",
        matchingFamilyCountBand: "0",
        mortalityOrEolSignal: "present",
        readyForLockedJoinContract: false,
      });
      expect(output.gates).toMatchObject({
        nextGate: "complete_join_key_family_metadata",
        outcomeScoringUnlocked: false,
      });
      expect(output.summary).toEqual({
        conclusion: "mhas_metadata_source_intake_completed_join_labels_needed",
        metadataIntakeCompleted: true,
        outcomeScoringUnlockedCountBand: "0",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("sampleVariableNames");
      expect(persisted).not.toContain("participantIds");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"rowValues\":");
      expect(persisted).not.toContain("\"smallCells\":");
      expect(persisted).not.toContain("source body");
      expect(persisted).not.toContain("27159");
      expect(persisted).not.toContain("7418");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed when required aggregate metadata artifacts are missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r611-mhas-missing-"));
    try {
      const { output } = await runR611MhasMetadataSourceIntake({
        mhasJoinProbePath: path.join(tmp, "missing-mhas-join.json"),
        mhasSourceFeasibilityPath: path.join(tmp, "missing-mhas-source.json"),
        outputDir: path.join(tmp, "out"),
        r609Path: path.join(tmp, "missing-r609.json"),
        r610Path: path.join(tmp, "missing-r610.json"),
      });

      expect(output.status).toBe("blocked-missing-required-artifacts");
      expect(Object.values(output.inputArtifacts).every((artifact) => artifact.status === "missing")).toBe(true);
      expect(output.completedLoop.evidenceArtifactsMissing).toEqual([
        "mhas-join-probe.latest.json",
        "mhas-source-feasibility.latest.json",
      ]);
      expect(output.gates.nextGate).toBe("refresh_mhas_metadata_artifacts");
      expect(output.summary).toEqual({
        conclusion: "missing_required_metadata_artifacts",
        metadataIntakeCompleted: false,
        outcomeScoringUnlockedCountBand: "0",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r611-mhas-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r611-mhas-metadata-source-intake.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_MHAS_JOIN_PROBE_PATH: paths.mhasJoinProbePath,
          MURPH_AGE_MHAS_SOURCE_FEASIBILITY_PATH: paths.mhasSourceFeasibilityPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
          MURPH_AGE_R609_PACKET_PATH: paths.r609Path,
          MURPH_AGE_R610_PACKET_PATH: paths.r610Path,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        artifact: "r611-mhas-metadata-source-intake.latest.json",
        conclusion: "mhas_metadata_source_intake_completed_join_labels_needed",
        metadataIntakeCompleted: true,
        nextGate: "complete_join_key_family_metadata",
        outcomeScoringUnlockedCountBand: "0",
        packetId: "r611-mhas-metadata-source-intake",
        rowParsingPerformed: false,
        schemaVersion: R611_MHAS_METADATA_SOURCE_INTAKE_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("coefficients");
      expect(stdout).not.toContain("predictions");
      expect(stdout).not.toContain("rowValues");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(tmp: string): Promise<{
  mhasJoinProbePath: string;
  mhasSourceFeasibilityPath: string;
  r609Path: string;
  r610Path: string;
}> {
  await mkdir(tmp, { recursive: true });
  const paths = {
    mhasJoinProbePath: path.join(tmp, "mhas-join-probe.json"),
    mhasSourceFeasibilityPath: path.join(tmp, "mhas-source-feasibility.json"),
    r609Path: path.join(tmp, "r609.json"),
    r610Path: path.join(tmp, "r610.json"),
  };
  await Promise.all([
    writeJson(paths.mhasJoinProbePath, mhasJoinProbeFixture()),
    writeJson(paths.mhasSourceFeasibilityPath, mhasSourceFeasibilityFixture()),
    writeJson(paths.r609Path, r609Fixture()),
    writeJson(paths.r610Path, r610Fixture()),
  ]);
  return paths;
}

function mhasSourceFeasibilityFixture() {
  return {
    boundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelScoringPerformed: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      rowParsingPerformed: false,
      rowValuesStored: false,
      sourceBodiesStored: false,
      variableLabelsStored: false,
    },
    coverage: {
      broadFeatureFamilies: {
        biomarker_or_lab: { status: "available" },
        mortality_or_eol: { status: "available" },
        sleep_or_recovery: { status: "absent" },
      },
      datasets: [
        { dataset: "mhas_eol" },
        { dataset: "mhas_harmonized" },
      ],
      requiredDatasetsPresent: true,
    },
    downloadInventory: {
      lanes: [
        {
          activationStatus: "metadata-only-not-activated",
          lane: "mhas-end-of-life",
          present: true,
        },
        {
          activationStatus: "metadata-only-not-activated",
          lane: "mhas-harmonized",
          present: true,
        },
      ],
    },
    packetId: "mhas-harmonized-eol-source-feasibility",
    schemaVersion: "murph-age-mhas-source-feasibility.v1",
    status: "research-local-metadata-only",
  };
}

function mhasJoinProbeFixture() {
  return {
    boundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      joinKeyValuesStored: false,
      localFileNamesStored: false,
      localPathsStored: false,
      modelParamsStored: false,
      modelScoringPerformed: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      rowParsingPerformed: false,
      rowValuesStored: false,
      sourceBodiesStored: false,
      variableNamesStored: false,
    },
    endpointEolMetadataStatus: {
      mortalityOrEolSignal: "present",
      status: "endpoint_metadata_ready_for_contract",
    },
    joinFeasibility: {
      blockerReasons: ["missing_join_key_family_overlap"],
      joinKeyFamilyStatus: "candidate_family_overlap_not_detected",
      matchingFamilyCountBand: "0",
      readyForLockedJoinContract: false,
    },
    packetId: "mhas-harmonized-eol-aggregate-join-probe",
    schemaVersion: "murph-age-mhas-join-probe.v1",
    status: "research-local-aggregate-only",
  };
}

function r609Fixture() {
  return {
    boundary: {
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
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitIdentifiersStored: false,
    },
    candidateLanes: [
      {
        allowedNextLocalAction: "complete_mhas_metadata_source_intake",
        blockedActions: [
          "lane-specific source-rights labels",
          "locked benchmark card before row parsing",
          "model_mutation_until_execution_gate",
          "outcome_scoring_until_locked_benchmark",
          "row_parsing_until_source_activation",
          "terms and endpoint-join labels before scoring",
        ],
        currentStatus: "metadata_ready",
        evidenceArtifacts: [
          "mhas-join-probe.latest.json",
          "mhas-source-feasibility.latest.json",
        ],
        laneId: "mhas-harmonized-eol",
        outcomeScoringUnlocked: false,
      },
    ],
    packetId: "r609-source-activation-queue",
    schemaVersion: "murph-age-r609-source-activation-queue.v1",
  };
}

function r610Fixture() {
  return {
    boundary: {
      aggregateOnly: true,
      codebookProseStored: false,
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
      protocolClaimsIncluded: false,
      recommendationClaimsIncluded: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitIdentifiersStored: false,
      splitMembershipStored: false,
    },
    executableLocalLoops: [
      {
        blockedActions: [
          "lane-specific source-rights labels",
          "locked benchmark card before row parsing",
          "model_mutation_until_execution_gate",
          "outcome_scoring_until_locked_benchmark",
          "row_parsing_until_source_activation",
          "terms and endpoint-join labels before scoring",
        ],
        evidenceArtifacts: [
          "mhas-join-probe.latest.json",
          "mhas-source-feasibility.latest.json",
        ],
        laneId: "mhas-harmonized-eol",
        localAction: "complete_mhas_metadata_source_intake",
        outcomeScoringUnlocked: false,
      },
    ],
    packetId: "r610-next-executable-loop-scaffold",
    schemaVersion: "murph-age-r610-next-executable-loop-scaffold.v1",
    summary: {
      nextActionForParent: "run_metadata_only_loop:mhas-harmonized-eol:complete_mhas_metadata_source_intake",
    },
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
