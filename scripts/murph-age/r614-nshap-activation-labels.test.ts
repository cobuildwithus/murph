import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R614_NSHAP_ACTIVATION_LABELS_SCHEMA_VERSION,
  runR614NshapActivationLabels,
} from "./r614-nshap-activation-labels.ts";

describe("R614 NSHAP activation labels", () => {
  it("records archive presence and activation labels without unlocking row execution", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r614-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      await writeArchivePlaceholders(paths.downloadsDir);

      const { output, outputPath } = await runR614NshapActivationLabels({
        createdAt: "2026-05-13T00:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r614-nshap-activation-labels.latest.json");
      expect(output.schemaVersion).toBe(R614_NSHAP_ACTIVATION_LABELS_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.artifactBoundary).toMatchObject({
        aggregateOnly: true,
        archiveBasenamesStored: false,
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
        variableNameSamplesStored: false,
      });
      expect(output.archiveReadiness).toEqual({
        downloadInventoryStatus: "available",
        downloadsDirectoryChecked: true,
        exactArchiveNamesStored: false,
        expectedArchiveCount: 3,
        expectedArchiveCountBand: "1-9",
        missingArchiveCount: 0,
        observedArchiveCount: 3,
        observedArchiveCountBand: "1-9",
        status: "all_expected_archives_observed",
      });
      expect(output.lockedBenchmarkCard).toEqual({
        aggregateOutputLabelCountBand: "1-9",
        available: true,
        candidateFamilyCountBand: "1-9",
        cardStatus: "metadata_locked_no_execution",
        endpointFamily: "mortality_or_followup",
      });
      expect(output.sourceRightsAndAggregateOutput).toMatchObject({
        aggregateOutputActivationStatus: "blocked_permission_unconfirmed",
        aggregateOutputPermission: "unconfirmed_human_required",
        aggregateOutputsActive: false,
        labelsComplete: false,
        minimumCellSuppressionPolicy: "not_locked",
        rowParsingUnlockedBySourceRights: false,
        termsAllowLocalResearchRows: "unconfirmed_human_required",
      });
      expect(output.sourceRightsAndAggregateOutput.requiredHumanLabels).toEqual([
        "aggregate_output_permission_clear",
        "biomarker_overlap_clear",
        "mortality_or_followup_endpoint_available",
        "terms_allow_local_research_rows",
        "wave_linkage_policy_clear",
      ]);
      expect(output.rowExecutionReadiness).toEqual({
        blockingReasons: [
          "outcome_scoring_requires_separate_execution_gate",
          "source_rights_or_aggregate_output_permission_unconfirmed",
        ],
        nextAction: "complete_source_rights_and_aggregate_output_labels",
        outcomeScoringUnlocked: false,
        rowExecutionUnlocked: false,
        rowParsingUnlocked: false,
        status: "blocked_source_rights_or_output_permission_unconfirmed",
      });
      expect(output.summary).toEqual({
        aggregateOutputsActive: false,
        conclusion: "nshap_activation_labels_block_row_execution",
        outcomeScoringUnlockedCountBand: "0",
        productPromotionAuthorized: false,
        sourceRightsLabelsComplete: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("ICPSR_20541");
      expect(persisted).not.toContain("ICPSR_34921");
      expect(persisted).not.toContain("ICPSR_36873");
      expect(persisted).not.toContain("rawRows");
      expect(persisted).not.toContain("participantIds");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"modelParameters\":");
      expect(persisted).not.toContain("\"rowValues\":");
      expect(persisted).not.toContain("\"smallCells\":");
      expect(persisted).not.toContain("sampleVariableNames");
      expect(persisted).not.toContain("source body");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("stays blocked when expected local archives are absent", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r614-missing-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output } = await runR614NshapActivationLabels({
        createdAt: "2026-05-13T00:00:00.000Z",
        ...paths,
      });

      expect(output.archiveReadiness.status).toBe("missing_expected_archives");
      expect(output.archiveReadiness.missingArchiveCount).toBe(3);
      expect(output.rowExecutionReadiness.status).toBe("blocked_missing_metadata_or_archives");
      expect(output.rowExecutionReadiness.rowExecutionUnlocked).toBe(false);
      expect(output.summary.conclusion).toBe("nshap_activation_labels_missing_metadata");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("marks source labels complete from a local confirmation artifact without unlocking scoring", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r614-confirmed-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      await writeArchivePlaceholders(paths.downloadsDir);
      const sourceConfirmationPath = path.join(tmp, "nshap-confirmation.json");
      await writeJson(sourceConfirmationPath, nshapSourceConfirmationFixture());

      const { output } = await runR614NshapActivationLabels({
        createdAt: "2026-05-13T00:00:00.000Z",
        ...paths,
        sourceConfirmationPath,
      });

      expect(output.sourceRightsAndAggregateOutput).toMatchObject({
        aggregateOutputActivationStatus: "active_for_suppressed_aggregate_outputs",
        aggregateOutputPermission: "confirmed_yes",
        aggregateOutputsActive: true,
        confirmationArtifactStatus: "available",
        labelsComplete: true,
        rowParsingUnlockedBySourceRights: false,
        termsAllowLocalResearchRows: "confirmed_yes",
      });
      expect(output.sourceRightsAndAggregateOutput.requiredHumanLabels).toEqual([]);
      expect(output.rowExecutionReadiness).toEqual({
        blockingReasons: ["outcome_scoring_requires_separate_execution_gate"],
        nextAction: "design_row_execution_harness_without_scoring",
        outcomeScoringUnlocked: false,
        rowExecutionUnlocked: false,
        rowParsingUnlocked: false,
        status: "metadata_ready_activation_labels_complete_no_scoring",
      });
      expect(output.summary).toEqual({
        aggregateOutputsActive: true,
        conclusion: "nshap_activation_labels_ready_for_row_harness_no_scoring",
        outcomeScoringUnlockedCountBand: "0",
        productPromotionAuthorized: false,
        sourceRightsLabelsComplete: true,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed when an input artifact boundary exports unsafe values", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r614-boundary-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      await writeArchivePlaceholders(paths.downloadsDir);
      const unsafeR613Path = path.join(tmp, "unsafe-r613.json");
      await writeJson(unsafeR613Path, {
        ...r613Fixture(),
        artifactBoundary: {
          ...safeBoundary(),
          rowValuesStored: true,
        },
      });

      await expect(runR614NshapActivationLabels({
        ...paths,
        r613Path: unsafeR613Path,
      })).rejects.toThrow("r613MetadataBenchmarkCard boundary has unsafe boundary flag rowValuesStored");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed when the activation queue includes a label outside the R614 allowlist", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r614-labels-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      await writeArchivePlaceholders(paths.downloadsDir);
      const unsafeQueuePath = path.join(tmp, "unsafe-queue.json");
      await writeJson(unsafeQueuePath, {
        ...sourceActivationQueueFixture(),
        queue: [
          {
            activationLabelsNeeded: [
              "terms_allow_local_research_rows",
              "unapproved_queue_label",
            ],
            filesPresent: true,
            laneGroup: "nshap-rounds",
            rowParsingUnlocked: false,
          },
        ],
      });

      await expect(runR614NshapActivationLabels({
        ...paths,
        sourceActivationQueuePath: unsafeQueuePath,
      })).rejects.toThrow("NSHAP activation labels contains a label outside the R614 allowlist.");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r614-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      await writeArchivePlaceholders(paths.downloadsDir);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r614-nshap-activation-labels.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_DOWNLOADS_DIR: paths.downloadsDir,
          MURPH_AGE_NSHAP_ACTIVATION_FEASIBILITY_PATH: paths.nshapActivationFeasibilityPath,
          MURPH_AGE_R613_NSHAP_BENCHMARK_CARD_PATH: paths.r613Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
          MURPH_AGE_SOURCE_ACTIVATION_QUEUE_PATH: paths.sourceActivationQueuePath,
          MURPH_AGE_SOURCE_DOWNLOAD_INVENTORY_PATH: paths.downloadInventoryPath,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        aggregateOutputsActive: false,
        artifact: "r614-nshap-activation-labels.latest.json",
        conclusion: "nshap_activation_labels_block_row_execution",
        outcomeScoringUnlockedCountBand: "0",
        packetId: "r614-nshap-activation-labels",
        rowExecutionUnlocked: false,
        schemaVersion: R614_NSHAP_ACTIVATION_LABELS_SCHEMA_VERSION,
        sourceRightsLabelsComplete: false,
        status: "research-local-aggregate-only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("ICPSR_20541");
      expect(stdout).not.toContain("coefficients");
      expect(stdout).not.toContain("predictions");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(tmp: string): Promise<{
  downloadInventoryPath: string;
  downloadsDir: string;
  nshapActivationFeasibilityPath: string;
  outputDir: string;
  r613Path: string;
  sourceActivationQueuePath: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const downloadsDir = path.join(tmp, "downloads");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const paths = {
    downloadInventoryPath: path.join(fixtureDir, "download-inventory.json"),
    downloadsDir,
    nshapActivationFeasibilityPath: path.join(fixtureDir, "nshap-feasibility.json"),
    outputDir,
    r613Path: path.join(fixtureDir, "r613.json"),
    sourceActivationQueuePath: path.join(fixtureDir, "activation-queue.json"),
  };
  await Promise.all([
    writeJson(paths.downloadInventoryPath, downloadInventoryFixture()),
    writeJson(paths.nshapActivationFeasibilityPath, nshapActivationFeasibilityFixture()),
    writeJson(paths.r613Path, r613Fixture()),
    writeJson(paths.sourceActivationQueuePath, sourceActivationQueueFixture()),
  ]);
  return paths;
}

async function writeArchivePlaceholders(downloadsDir: string): Promise<void> {
  await Promise.all([
    writeFile(path.join(downloadsDir, "ICPSR_20541-V10.zip"), ""),
    writeFile(path.join(downloadsDir, "ICPSR_34921-V5.zip"), ""),
    writeFile(path.join(downloadsDir, "ICPSR_36873-V9.zip"), ""),
  ]);
}

function downloadInventoryFixture() {
  return {
    activationNeededBeforeParsingRows: true,
    lanes: [
      {
        activationStatus: "metadata-only-not-activated",
        files: ["ICPSR_20541-V10.zip"],
        lane: "nshap-round-1",
        presentFileCount: 1,
        roles: ["aging-cohort"],
      },
      {
        activationStatus: "metadata-only-not-activated",
        files: ["ICPSR_34921-V5.zip"],
        lane: "nshap-round-2",
        presentFileCount: 1,
        roles: ["aging-cohort"],
      },
      {
        activationStatus: "metadata-only-not-activated",
        files: ["ICPSR_36873-V9.zip"],
        lane: "nshap-round-3-covid",
        presentFileCount: 1,
        roles: ["aging-cohort"],
      },
    ],
    modelScoringPerformed: false,
    participantIdentifiersStored: false,
    rowParsing: "not-performed",
    rowValuesStored: false,
    schemaVersion: "murph-age-source-download-inventory.v1",
    sourceBodiesStored: false,
    storedPathPolicy: "base-file-names-only",
  };
}

function sourceActivationQueueFixture() {
  return {
    artifactBoundary: {
      codebookTextStored: false,
      modelScoringPerformed: false,
      participantIdentifiersStored: false,
      rowValuesStored: false,
      sourceBodiesStored: false,
    },
    packetId: "source-activation-queue",
    queue: [
      {
        activationLabelsNeeded: [
          "terms_allow_local_research_rows",
          "aggregate_output_permission_clear",
          "mortality_or_followup_endpoint_available",
          "wave_linkage_policy_clear",
          "biomarker_overlap_clear",
        ],
        filesPresent: true,
        laneGroup: "nshap-rounds",
        rowParsingUnlocked: false,
      },
    ],
    schemaVersion: "murph-age-source-activation-queue.v1",
  };
}

function nshapActivationFeasibilityFixture() {
  return {
    boundary: safeBoundary(),
    endpointReadiness: {
      readyForLockedBenchmarkDesign: true,
      rowActivationRequiredBeforeExecution: true,
    },
    packetId: "nshap-activation-feasibility",
    schemaVersion: "murph-age-nshap-activation-feasibility.v1",
  };
}

function r613Fixture() {
  return {
    artifactBoundary: safeBoundary(),
    benchmarkCard: {
      aggregateOutputsAllowed: [
        "eligible_denominator_count_band",
        "coverage_and_missingness_counts",
      ],
      candidateFamilies: [
        {
          candidateFamilyId: "anchor_only_reference",
          role: "reference",
        },
        {
          candidateFamilyId: "anchor_plus_function_sidecar",
          role: "primary_increment",
        },
      ],
      cardStatus: "metadata_locked_no_execution",
      endpointFamily: "mortality_or_followup",
      sourceActivation: {
        aggregateOutputPermission: "unconfirmed_human_required",
        rowParsingUnlocked: false,
        sourceRightsLabelsComplete: false,
        termsAllowLocalResearchRows: "unconfirmed_human_required",
      },
    },
    packetId: "r613-nshap-metadata-benchmark-card",
    schemaVersion: "murph-age-r613-nshap-metadata-benchmark-card.v1",
  };
}

function nshapSourceConfirmationFixture() {
  return {
    schema_version: "murph.age.local.nshap-public-use-confirmation.v0",
    user_confirms_aggregate_export_with_attribution_and_small_cell_suppression_only: true,
    user_confirms_aggregate_output_permission_clear: true,
    user_confirms_biomarker_overlap_clear: true,
    user_confirms_local_ignored_cache_only: true,
    user_confirms_mortality_or_followup_endpoint_available: true,
    user_confirms_no_product_claims_from_nshap_results: true,
    user_confirms_no_reidentification_attempt: true,
    user_confirms_no_rows_or_source_bodies_to_reviewgpt: true,
    user_confirms_no_third_party_transfer: true,
    user_confirms_terms_allow_local_research_rows: true,
    user_confirms_wave_linkage_policy_clear: true,
  };
}

function safeBoundary() {
  return {
    archiveBasenamesStored: false,
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
    splitIdentifiersStored: false,
    splitMembershipStored: false,
    variableLabelsStored: false,
    variableNamesStored: false,
    variableNameSamplesStored: false,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
