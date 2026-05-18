import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R979_MHAS_ENDPOINT_JOIN_CONTRACT_SCHEMA_VERSION,
  runR979MhasEndpointJoinContract,
} from "./r979-mhas-endpoint-join-contract.ts";

describe("R979 MHAS endpoint/join contract", () => {
  it("locks the MHAS function-disability endpoint/join contract for the next reducer", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r979-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR979MhasEndpointJoinContract({
        createdAt: "2026-05-13T00:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r979-mhas-endpoint-join-contract.latest.json");
      expect(output.schemaVersion).toBe(R979_MHAS_ENDPOINT_JOIN_CONTRACT_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.artifactBoundary).toMatchObject({
        aggregateOnly: true,
        codebookProseStored: false,
        codebookTextStored: false,
        coefficientsStored: false,
        joinKeyValuesStored: false,
        localFileNamesStored: false,
        localPathsStored: false,
        modelParametersStored: false,
        modelScoringPerformed: false,
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
        variableLabelsStored: false,
        variableNamesStored: false,
      });
      expect(output.inputArtifacts).toMatchObject({
        mhasJoinProbe: {
          packetId: "mhas-harmonized-eol-aggregate-join-probe",
          status: "available",
        },
        r614MhasSourceRightsActivationLabels: {
          packetId: "r614-mhas-source-rights-activation-labels",
          status: "available",
        },
        r978FastLoopPriorityReducer: {
          packetId: "r978-fast-loop-priority-reducer",
          status: "available",
        },
      });
      expect(output.prerequisites).toEqual({
        blockerReasons: [],
        joinProbeReady: true,
        metadataIntakeReady: true,
        priorityQueueReady: true,
        sourceActivationReady: true,
        sourceMatrixReady: true,
        status: "ready",
      });
      expect(output.benchmarkContract).toMatchObject({
        benchmarkCardStatus: "locked_no_execution",
        endpointFamily: "mortality_or_followup",
        evidenceClass: "non_us_external_function_disability_diagnostic",
        exposureLabel: "diagnostic-only",
        minimumCellThreshold: 11,
        productPromotionAuthorized: false,
      });
      expect(output.endpointJoinContract).toEqual({
        endpointStatusPolicy: "mortality_or_eol_status_role_family",
        exactDatePolicy: "local_only_not_exported",
        joinResolutionPolicy: "role_family_contract_only_no_key_names",
        keyValuesExported: false,
        sourceRoleFamilies: [
          "baseline_harmonized_panel",
          "gateway_eol_endpoint",
          "follow_up_status_bridge",
          "raw_wave_follow_up_sections",
        ],
        timeOriginPolicy: "baseline_interview_or_wave_role_family",
        variableNamesExported: false,
      });
      expect(output.featureContract).toEqual({
        blockedFamilies: [
          "activity_or_wearable_proxy",
          "cognition_additive",
          "biomarker_increment",
          "protocol_or_recommendation_features",
          "crp_or_hscrp",
        ],
        candidateFeatureFamily: "function_limitation_disability_v1",
        referenceFeatureFamily: "age_sex_reference",
      });
      expect(output.gates).toMatchObject({
        nextRunnableAction: "build_mhas_function_disability_aggregate_reducer",
        nextReducerRowParsingAuthorized: true,
        outcomeScoringAuthorizedForNextReducer: true,
        productDisplayAuthorized: false,
        scope: "mhas_function_disability_aggregate_reducer_only",
      });
      expect(output.summary).toEqual({
        conclusion: "mhas_endpoint_join_contract_locked_next_reducer_ready",
        nextLoopId: "mhas-function-disability-fast-loop",
        nextReducerRowParsingAuthorized: true,
        productDisplayAuthorized: false,
        rowParsingPerformed: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("participantIds");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"modelParameters\":");
      expect(persisted).not.toContain("\"rowValues\":");
      expect(persisted).not.toContain("\"smallCells\":");
      expect(persisted).not.toContain("source body");
      expect(persisted).not.toContain("H_MHAS");
      expect(persisted).not.toContain("GH_MHAS");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("blocks the next reducer when source activation is not ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r979-blocked-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const blockedR614Path = path.join(tmp, "blocked-r614.json");
      await writeJson(blockedR614Path, {
        ...mhasLabelsFixture(),
        summary: {
          endpointJoinContractReady: false,
          sourceRightsLabelsComplete: false,
        },
      });

      const { output } = await runR979MhasEndpointJoinContract({
        ...paths,
        r614MhasPath: blockedR614Path,
      });

      expect(output.prerequisites.status).toBe("blocked");
      expect(output.prerequisites.sourceActivationReady).toBe(false);
      expect(output.prerequisites.blockerReasons).toContain("mhas_source_activation_not_ready");
      expect(output.benchmarkContract.benchmarkCardStatus).toBe("blocked_missing_prerequisites");
      expect(output.gates).toMatchObject({
        nextRunnableAction: "repair_mhas_endpoint_join_prerequisites",
        nextReducerRowParsingAuthorized: false,
        outcomeScoringAuthorizedForNextReducer: false,
      });
      expect(output.summary).toMatchObject({
        conclusion: "mhas_endpoint_join_contract_blocked",
        nextLoopId: null,
        nextReducerRowParsingAuthorized: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed when an input boundary exports unsafe values", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r979-unsafe-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const unsafeJoinPath = path.join(tmp, "unsafe-join.json");
      await writeJson(unsafeJoinPath, {
        ...mhasJoinProbeFixture(),
        boundary: {
          ...safeBoundary(),
          rowValuesStored: true,
        },
      });

      await expect(runR979MhasEndpointJoinContract({
        ...paths,
        mhasJoinProbePath: unsafeJoinPath,
      })).rejects.toThrow("mhasJoinProbe boundary flag rowValuesStored must be false");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r979-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r979-mhas-endpoint-join-contract.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_MHAS_JOIN_PROBE_PATH: paths.mhasJoinProbePath,
          MURPH_AGE_R611_MHAS_SOURCE_INTAKE_PATH: paths.r611Path,
          MURPH_AGE_R614_MHAS_LABELS_PATH: paths.r614MhasPath,
          MURPH_AGE_R615_ACTIVATION_MATRIX_PATH: paths.r615Path,
          MURPH_AGE_R978_FAST_LOOP_PRIORITY_PATH: paths.r978Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        artifact: "r979-mhas-endpoint-join-contract.latest.json",
        conclusion: "mhas_endpoint_join_contract_locked_next_reducer_ready",
        nextLoopId: "mhas-function-disability-fast-loop",
        nextReducerRowParsingAuthorized: true,
        packetId: "r979-mhas-endpoint-join-contract",
        productDisplayAuthorized: false,
        rowParsingPerformed: false,
        schemaVersion: R979_MHAS_ENDPOINT_JOIN_CONTRACT_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("H_MHAS");
      expect(stdout).not.toContain("GH_MHAS");
      expect(stdout).not.toContain("coefficients");
      expect(stdout).not.toContain("predictions");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(tmp: string): Promise<{
  mhasJoinProbePath: string;
  outputDir: string;
  r611Path: string;
  r614MhasPath: string;
  r615Path: string;
  r978Path: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  const paths = {
    mhasJoinProbePath: path.join(fixtureDir, "join.json"),
    outputDir,
    r611Path: path.join(fixtureDir, "r611.json"),
    r614MhasPath: path.join(fixtureDir, "r614.json"),
    r615Path: path.join(fixtureDir, "r615.json"),
    r978Path: path.join(fixtureDir, "r978.json"),
  };
  await Promise.all([
    writeJson(paths.mhasJoinProbePath, mhasJoinProbeFixture()),
    writeJson(paths.r611Path, r611Fixture()),
    writeJson(paths.r614MhasPath, mhasLabelsFixture()),
    writeJson(paths.r615Path, r615Fixture()),
    writeJson(paths.r978Path, r978Fixture()),
  ]);
  return paths;
}

function mhasJoinProbeFixture(): Record<string, unknown> {
  return {
    boundary: safeBoundary(),
    endpointEolMetadataStatus: {
      status: "endpoint_metadata_ready_for_contract",
    },
    joinFeasibility: {
      readyForLockedJoinContract: true,
    },
    packetId: "mhas-harmonized-eol-aggregate-join-probe",
    schemaVersion: "murph-age-mhas-join-probe.v1",
  };
}

function r611Fixture(): Record<string, unknown> {
  return {
    boundary: safeBoundary(),
    packetId: "r611-mhas-metadata-source-intake",
    schemaVersion: "murph-age-r611-mhas-metadata-source-intake.v1",
    summary: {
      metadataIntakeCompleted: true,
    },
  };
}

function mhasLabelsFixture(): Record<string, unknown> {
  return {
    boundary: safeBoundary(),
    gates: {
      nextGate: "draft_locked_mhas_endpoint_join_contract",
    },
    packetId: "r614-mhas-source-rights-activation-labels",
    schemaVersion: "murph-age-r614-mhas-source-rights-activation-labels.v1",
    summary: {
      endpointJoinContractReady: true,
      sourceRightsLabelsComplete: true,
    },
  };
}

function r615Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      ...safeBoundary(),
      modelScoringPerformedByR615: false,
      outcomeScoringPerformedByR615: false,
      protocolClaimsIncluded: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR615: false,
      splitIdentifiersStored: false,
      variableNameSamplesStored: false,
    },
    packetId: "r615-cross-source-activation-matrix",
    schemaVersion: "murph-age-r615-cross-source-activation-matrix.v1",
    summary: {
      nextPrimaryLocalAction: "draft_locked_mhas_endpoint_join_contract",
    },
  };
}

function r978Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      ...safeBoundary(),
      markdownBodiesStored: false,
      outcomeScoringPerformed: false,
      participantIdentifiersWritten: false,
      recommendationClaimsIncluded: false,
      variableListsStored: false,
      variableNameSamplesStored: false,
    },
    packetId: "r978-fast-loop-priority-reducer",
    schemaVersion: "murph-age-r978-fast-loop-priority-reducer.v1",
    summary: {
      nextDataSource: "MHAS",
      nextLoopId: "mhas-function-disability-fast-loop",
    },
  };
}

function safeBoundary(): Record<string, unknown> {
  return {
    aggregateOnly: true,
    codebookProseStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    joinKeyValuesStored: false,
    localFileNamesStored: false,
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
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
