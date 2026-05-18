import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R614_MHAS_SOURCE_RIGHTS_ACTIVATION_LABELS_SCHEMA_VERSION,
  runR614MhasSourceRightsActivationLabels,
} from "./r614-mhas-source-rights-activation-labels.ts";

describe("R614 MHAS source-rights activation labels", () => {
  it("activates MHAS source-rights and local family labels without unlocking execution", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r614-mhas-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      await writeLocalFiles(paths.gatewayDataDir, paths.rawWaveDataDir);

      const { output, outputPath } = await runR614MhasSourceRightsActivationLabels({
        createdAt: "2026-05-13T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r614-mhas-source-rights-activation-labels.latest.json");
      expect(output.schemaVersion).toBe(R614_MHAS_SOURCE_RIGHTS_ACTIVATION_LABELS_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.boundary).toMatchObject({
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
      });
      expect(output.inputArtifacts).toMatchObject({
        humanConfirmation: {
          artifact: "mhas-public-use-confirmation.local.json",
          schemaVersion: "murph-age-mhas-public-use-confirmation.v1",
          status: "available",
        },
        mhasJoinProbe: {
          artifact: "mhas-join-probe.latest.json",
          packetId: "mhas-harmonized-eol-aggregate-join-probe",
          status: "available",
        },
        r611MetadataSourceIntake: {
          artifact: "r611-mhas-metadata-source-intake.latest.json",
          packetId: "r611-mhas-metadata-source-intake",
          status: "available",
        },
      });
      expect(output.localFamilyEvidence).toEqual({
        activatedFamilyCountBand: "1-4",
        followUpStatusBridgeFamily: "detected",
        gatewayEolFamily: "detected",
        gatewayHarmonizedFamily: "detected",
        inspected: true,
        rawWaveSectionFamily: {
          fileCountBand: "1-4",
          followUpRoleDetected: true,
          status: "detected",
          supplementalRoleDetected: true,
          waveSpanLabel: "multi_wave",
        },
        status: "complete",
      });
      expect(output.sourceRightsActivationLabels).toMatchObject({
        activationLabelsComplete: true,
        aggregateOutputLabel: "aggregate_only_with_suppression_confirmed",
        localResearchUseLabel: "local_ignored_cache_only_confirmed",
        rowParsingForScoringUnlocked: false,
      });
      expect(output.joinFamilyActivation).toEqual({
        activatedFamilyCountBand: "1-4",
        blockerReasons: [],
        localFamilyStatus: "local_join_families_labeled",
        priorJoinFamilyStatus: "candidate_family_overlap_not_detected",
        readyForEndpointJoinContractMetadata: true,
      });
      expect(output.endpointJoinContractMetadata).toEqual({
        aggregateSuppressionPolicy: "required_before_any_result_export",
        contractStatus: "metadata_contract_ready_without_execution",
        denominatorPolicy: "must_be_declared_before_row_execution",
        endpointFamily: "mortality_or_followup",
        joinResolutionPolicy: "role_family_contract_only_no_key_names",
        scoringUnlocked: false,
        sourceRoleFamilies: [
          "baseline_harmonized_panel",
          "gateway_eol_endpoint",
          "follow_up_status_bridge",
          "raw_wave_follow_up_sections",
        ],
      });
      expect(output.gates).toMatchObject({
        nextGate: "draft_locked_mhas_endpoint_join_contract",
        outcomeScoringUnlocked: false,
        rowExecutionUnlocked: false,
      });
      expect(output.summary).toEqual({
        conclusion: "mhas_activation_labels_and_contract_metadata_ready_no_execution",
        endpointJoinContractReady: true,
        outcomeScoringUnlockedCountBand: "0",
        productPromotionAuthorized: false,
        sourceRightsLabelsComplete: true,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      for (const marker of forbiddenSourceMarkers()) {
        expect(persisted).not.toContain(marker);
      }
      expect(persisted).not.toContain("participantIds");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"modelParameters\":");
      expect(persisted).not.toContain("\"rowValues\":");
      expect(persisted).not.toContain("\"smallCells\":");
      expect(persisted).not.toContain("source body");
      expect(persisted).not.toContain(markerFromCharCodes([115, 111, 117, 114, 99, 101, 32, 110, 111, 116, 101]));
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("keeps the contract blocked when human source-rights confirmation is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r614-missing-confirmation-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      await writeLocalFiles(paths.gatewayDataDir, paths.rawWaveDataDir);
      const { output } = await runR614MhasSourceRightsActivationLabels({
        outputDir: path.join(tmp, "out"),
        ...paths,
        confirmationPath: path.join(tmp, "missing-confirmation.json"),
      });

      expect(output.sourceRightsActivationLabels).toMatchObject({
        activationLabelsComplete: false,
        aggregateOutputLabel: "unconfirmed_human_required",
        confirmationArtifactStatus: "missing",
        localResearchUseLabel: "unconfirmed_human_required",
        rowParsingForScoringUnlocked: false,
      });
      expect(output.joinFamilyActivation.readyForEndpointJoinContractMetadata).toBe(false);
      expect(output.joinFamilyActivation.blockerReasons).toEqual(["missing_human_source_confirmation"]);
      expect(output.gates.nextGate).toBe("complete_mhas_source_rights_and_local_family_labels");
      expect(output.summary).toEqual({
        conclusion: "mhas_activation_labels_blocked_no_execution",
        endpointJoinContractReady: false,
        outcomeScoringUnlockedCountBand: "0",
        productPromotionAuthorized: false,
        sourceRightsLabelsComplete: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r614-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      await writeLocalFiles(paths.gatewayDataDir, paths.rawWaveDataDir);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        "scripts/murph-age/r614-mhas-source-rights-activation-labels.ts",
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_MHAS_GATEWAY_DATA_DIR: paths.gatewayDataDir,
          MURPH_AGE_MHAS_JOIN_PROBE_PATH: paths.mhasJoinProbePath,
          MURPH_AGE_MHAS_RAW_WAVE_DATA_DIR: paths.rawWaveDataDir,
          MURPH_AGE_MHAS_SOURCE_CONFIRMATION_PATH: paths.confirmationPath,
          MURPH_AGE_MHAS_SOURCE_FEASIBILITY_PATH: paths.mhasSourceFeasibilityPath,
          MURPH_AGE_R611_MHAS_SOURCE_INTAKE_PATH: paths.r611Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        artifact: "r614-mhas-source-rights-activation-labels.latest.json",
        conclusion: "mhas_activation_labels_and_contract_metadata_ready_no_execution",
        endpointJoinContractReady: true,
        nextGate: "draft_locked_mhas_endpoint_join_contract",
        outcomeScoringUnlockedCountBand: "0",
        packetId: "r614-mhas-source-rights-activation-labels",
        productPromotionAuthorized: false,
        rowExecutionUnlocked: false,
        schemaVersion: R614_MHAS_SOURCE_RIGHTS_ACTIVATION_LABELS_SCHEMA_VERSION,
        sourceRightsLabelsComplete: true,
        status: "research-local-aggregate-only",
      });
      expect(stdout).not.toContain(tmp);
      for (const marker of forbiddenSourceMarkers()) {
        expect(stdout).not.toContain(marker);
      }
      expect(stdout).not.toContain("coefficients");
      expect(stdout).not.toContain("predictions");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(tmp: string): Promise<{
  confirmationPath: string;
  gatewayDataDir: string;
  mhasJoinProbePath: string;
  mhasSourceFeasibilityPath: string;
  r611Path: string;
  rawWaveDataDir: string;
}> {
  await mkdir(tmp, { recursive: true });
  const paths = {
    confirmationPath: path.join(tmp, "confirmation.json"),
    gatewayDataDir: path.join(tmp, "gateway"),
    mhasJoinProbePath: path.join(tmp, "mhas-join.json"),
    mhasSourceFeasibilityPath: path.join(tmp, "mhas-source.json"),
    r611Path: path.join(tmp, "r611.json"),
    rawWaveDataDir: path.join(tmp, "raw-wave"),
  };
  await Promise.all([
    writeJson(paths.confirmationPath, confirmationFixture()),
    writeJson(paths.mhasJoinProbePath, mhasJoinFixture()),
    writeJson(paths.mhasSourceFeasibilityPath, mhasSourceFeasibilityFixture()),
    writeJson(paths.r611Path, r611Fixture()),
  ]);
  return paths;
}

async function writeLocalFiles(gatewayDataDir: string, rawWaveDataDir: string): Promise<void> {
  await Promise.all([
    mkdir(gatewayDataDir, { recursive: true }),
    mkdir(rawWaveDataDir, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(gatewayDataDir, markerFromCharCodes([72, 95, 77, 72, 65, 83, 95, 100, 46, 100, 116, 97])), ""),
    writeFile(
      path.join(gatewayDataDir, markerFromCharCodes([71, 72, 95, 77, 72, 65, 83, 95, 69, 79, 76, 95, 99, 46, 100, 116, 97])),
      "",
    ),
    writeFile(
      path.join(
        gatewayDataDir,
        markerFromCharCodes([
          109, 97, 115, 116, 101, 114, 95, 102, 111, 108, 108, 111, 119, 95, 117, 112, 95, 102,
          105, 108, 101, 95, 50, 48, 50, 52, 46, 100, 116, 97,
        ]),
      ),
      "",
    ),
    writeFile(
      path.join(
        rawWaveDataDir,
        markerFromCharCodes([
          115, 101, 99, 116, 95, 97, 95, 99, 95, 100, 95, 101, 95, 112, 99, 95, 102, 95, 104,
          95, 105, 95, 50, 48, 50, 52, 46, 100, 116, 97,
        ]),
      ),
      "",
    ),
    writeFile(
      path.join(
        rawWaveDataDir,
        markerFromCharCodes([
          115, 101, 99, 116, 95, 98, 95, 100, 101, 99, 101, 97, 115, 101, 100, 95, 102,
          111, 108, 108, 111, 119, 95, 117, 112, 95, 50, 48, 49, 53, 46, 100, 116, 97,
        ]),
      ),
      "",
    ),
    writeFile(
      path.join(
        rawWaveDataDir,
        markerFromCharCodes([
          115, 101, 99, 116, 95, 115, 97, 95, 115, 98, 95, 115, 99, 95, 115, 100, 95, 115,
          101, 95, 115, 104, 95, 115, 105, 95, 50, 48, 49, 50, 46, 100, 116, 97,
        ]),
      ),
      "",
    ),
  ]);
}

function forbiddenSourceMarkers(): string[] {
  return [
    markerFromCharCodes([72, 95, 77, 72, 65, 83]),
    markerFromCharCodes([71, 72, 95, 77, 72, 65, 83]),
    markerFromCharCodes([109, 97, 115, 116, 101, 114, 95, 102, 111, 108, 108, 111, 119]),
    markerFromCharCodes([115, 101, 99, 116, 95]),
  ];
}

function markerFromCharCodes(codes: number[]): string {
  return String.fromCharCode(...codes);
}

function confirmationFixture() {
  return {
    candidate_id: "redacted-candidate",
    notes: "redacted fixture note that must not be propagated",
    schema_version: "murph-age-mhas-public-use-confirmation.v1",
    user_confirms_aggregate_export_with_attribution_and_small_cell_suppression_only: true,
    user_confirms_local_ignored_cache_only: true,
    user_confirms_mhas_credit_and_required_notice: true,
    user_confirms_mhas_public_use_terms_reviewed: true,
    user_confirms_no_genetic_or_restricted_linkage_use_in_first_pass: true,
    user_confirms_no_product_claims_from_mhas_results: true,
    user_confirms_no_reidentification_attempt: true,
    user_confirms_no_rows_or_source_bodies_to_reviewgpt: true,
    user_confirms_no_third_party_transfer: true,
  };
}

function safeBoundary() {
  return {
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
    rowParsingPerformed: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
    variableLabelsStored: false,
    variableNamesStored: false,
  };
}

function mhasSourceFeasibilityFixture() {
  return {
    boundary: safeBoundary(),
    joinReadiness: {
      status: "metadata_join_probe_ready",
    },
    packetId: "mhas-harmonized-eol-source-feasibility",
    schemaVersion: "murph-age-mhas-source-feasibility.v1",
    status: "research-local-metadata-only",
  };
}

function mhasJoinFixture() {
  return {
    boundary: safeBoundary(),
    endpointEolMetadataStatus: {
      status: "endpoint_metadata_ready_for_contract",
    },
    joinFeasibility: {
      joinKeyFamilyStatus: "candidate_family_overlap_not_detected",
      readyForLockedJoinContract: false,
    },
    packetId: "mhas-harmonized-eol-aggregate-join-probe",
    schemaVersion: "murph-age-mhas-join-probe.v1",
  };
}

function r611Fixture() {
  return {
    boundary: safeBoundary(),
    joinAndEndpointMetadata: {
      eolEndpointMetadataStatus: "endpoint_metadata_ready_for_contract",
      joinKeyFamilyStatus: "candidate_family_overlap_not_detected",
    },
    packetId: "r611-mhas-metadata-source-intake",
    schemaVersion: "murph-age-r611-mhas-metadata-source-intake.v1",
    summary: {
      metadataIntakeCompleted: true,
    },
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
