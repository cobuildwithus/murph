import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1007_MHAS_PANEL_EXTENSION_AGGREGATE_RECEIPT_SCHEMA_VERSION,
  runR1007MhasPanelExtensionAggregateReceipt,
} from "./r1007-mhas-panel-extension-aggregate-receipt.ts";

describe("R1007 MHAS panel extension aggregate receipt", () => {
  it("creates an aggregate-only receipt from ready private MHAS panel states", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1007-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR1007MhasPanelExtensionAggregateReceipt({
        createdAt: "2026-05-13T07:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1007-mhas-panel-extension-aggregate-receipt.latest.json");
      expect(output.schemaVersion).toBe(R1007_MHAS_PANEL_EXTENSION_AGGREGATE_RECEIPT_SCHEMA_VERSION);
      expect(output.summary).toEqual({
        conclusion: "mhas_panel_extension_existing_private_states_support_runner_reuse",
        nextLocalAction: "send_mhas_panel_extension_aggregate_readout_to_reviewgpt",
        productDisplayAuthorized: false,
        reviewGptNextUse: "aggregate_result_interpretation_only",
        rowParsingPerformedByR1007: false,
      });
      expect(output.runnerReadiness).toMatchObject({
        candidateFeatureFamily: "function_limitation_disability_v1",
        readyForAggregateScienceReadout: true,
        runnerStatus: "ready_to_implement_local_private_runner",
        sourceFamily: "MHAS/Gateway MHAS",
      });
      expect(output.privateStateChecks).toMatchObject({
        allAvailableStatesSafe: true,
        panelStateCountBand: "3_to_5",
        rowParsePrivateOnlyCountBand: "3_to_5",
        unsafePrivateStateCountBand: "0",
      });
      expect(output.panelExtensionEvidence).toMatchObject({
        activityProxyStatus: "observed_aggregate_support",
        endpointSupport: {
          eligibleCountBand: "gte_1000",
          eventCountBand: "gte_1000",
          minimumCellCount: 11,
        },
        splitSupport: {
          calibrationCountBand: "gte_1000",
          calibrationEventCountBand: "gte_1000",
          holdoutCountBand: "gte_1000",
          holdoutEventCountBand: "gte_1000",
        },
      });
      expect(output.panelExtensionEvidence.functionSupport).toEqual({
        adl_limitation_score_0_to_5: "gte_1000",
        function_composite_min_3_components: "gte_1000",
        mobility_limitation_score_0_to_5: "gte_1000",
      });
      expect(output.panelExtensionEvidence.enrichedCovariateSupport).toEqual({
        body_mass_index: "gte_1000",
        body_shape: "gte_1000",
        diabetes_history_proxy: "gte_1000",
        physical_activity_proxy: "not_observed",
        self_rated_health: "gte_1000",
        smoking_status_proxy: "gte_1000",
      });
      expect(output.artifactBoundary).toMatchObject({
        aggregateOnly: true,
        coefficientsStored: false,
        localFileNamesStored: false,
        localPathsStored: false,
        modelParametersStored: false,
        participantIdentifiersStored: false,
        predictionsStored: false,
        productDisplayAuthorized: false,
        rowParsingPerformedByR1007: false,
        rowValuesStored: false,
        sourceBodiesStored: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain(".latest.json");
      expect(persisted).not.toContain(".dta");
      expect(persisted).not.toContain(".zip");
      expect(persisted).not.toContain("field_names_private");
      expect(persisted).not.toContain("fit_params_private_only");
      expect(persisted).not.toContain("calibration_params_private_only");
      expect(persisted).not.toContain("model_artifact_manifest_private");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"rowValues\":");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("holds when a private state boundary reports row value storage", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1007-hold-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { unsafeFunctionState: true });
      const { output } = await runR1007MhasPanelExtensionAggregateReceipt({
        createdAt: "2026-05-13T07:00:00.000Z",
        ...paths,
      });

      expect(output.summary.conclusion).toBe("mhas_panel_extension_existing_private_states_hold");
      expect(output.summary.nextLocalAction).toBe("repair_mhas_private_state_boundaries_or_manifest");
      expect(output.privateStateChecks.allAvailableStatesSafe).toBe(false);
      expect(output.privateStateChecks.unsafePrivateStateCountBand).toBe("1");
      expect(output.runnerReadiness.readyForAggregateScienceReadout).toBe(false);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe public aggregate input egress", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1007-unsafe-public-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      await writeJson(paths.r1006Path, {
        ...r1006Fixture(),
        predictionById: { hidden: 1 },
      });

      await expect(runR1007MhasPanelExtensionAggregateReceipt({
        ...paths,
      })).rejects.toThrow("R1007 input r1006MhasPanelExtensionRunnerManifest failed aggregate boundary validation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1007-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1007-mhas-panel-extension-aggregate-receipt.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_MHAS_ACTIVITY_PROXY_MAPPING_STATE_PATH: paths.activityProxyMappingPath,
          MURPH_AGE_MHAS_ENRICHED_CALIBRATION_HOLDOUT_STATE_PATH: paths.enrichedCalibrationHoldoutPath,
          MURPH_AGE_MHAS_ENRICHED_FEATURE_COVERAGE_STATE_PATH: paths.enrichedFeatureCoveragePath,
          MURPH_AGE_MHAS_FUNCTION_MOBILITY_STATE_PATH: paths.functionMobilityTransportPath,
          MURPH_AGE_MHAS_SOURCE_CALIBRATION_HOLDOUT_STATE_PATH: paths.sourceCalibrationHoldoutPath,
          MURPH_AGE_R1006_MHAS_PANEL_EXTENSION_RUNNER_MANIFEST_PATH: paths.r1006Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        conclusion: "mhas_panel_extension_existing_private_states_support_runner_reuse",
        nextLocalAction: "send_mhas_panel_extension_aggregate_readout_to_reviewgpt",
        packetId: "r1007-mhas-panel-extension-aggregate-receipt",
        productDisplayAuthorized: false,
        readyForAggregateScienceReadout: true,
        rowParsingPerformedByR1007: false,
        schemaVersion: R1007_MHAS_PANEL_EXTENSION_AGGREGATE_RECEIPT_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain(".latest.json");
      expect(stdout).not.toContain("coefficients");
      expect(stdout).not.toContain("predictions");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(
  tmp: string,
  options: { unsafeFunctionState?: boolean } = {},
): Promise<{
  activityProxyMappingPath: string;
  enrichedCalibrationHoldoutPath: string;
  enrichedFeatureCoveragePath: string;
  functionMobilityTransportPath: string;
  outputDir: string;
  r1006Path: string;
  sourceCalibrationHoldoutPath: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const paths = {
    activityProxyMappingPath: path.join(fixtureDir, "activity.json"),
    enrichedCalibrationHoldoutPath: path.join(fixtureDir, "enriched-calibration.json"),
    enrichedFeatureCoveragePath: path.join(fixtureDir, "feature-coverage.json"),
    functionMobilityTransportPath: path.join(fixtureDir, "function.json"),
    outputDir,
    r1006Path: path.join(fixtureDir, "r1006.json"),
    sourceCalibrationHoldoutPath: path.join(fixtureDir, "source-calibration.json"),
  };
  await Promise.all([
    writeJson(paths.activityProxyMappingPath, activityProxyStateFixture()),
    writeJson(paths.enrichedCalibrationHoldoutPath, enrichedCalibrationStateFixture()),
    writeJson(paths.enrichedFeatureCoveragePath, enrichedFeatureCoverageStateFixture()),
    writeJson(paths.functionMobilityTransportPath, functionMobilityStateFixture(options.unsafeFunctionState === true)),
    writeJson(paths.r1006Path, r1006Fixture()),
    writeJson(paths.sourceCalibrationHoldoutPath, sourceCalibrationStateFixture()),
  ]);
  return paths;
}

function r1006Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1006-mhas-panel-extension-runner-manifest",
    runnerManifest: {
      candidate: {
        candidateFeatureFamily: "function_limitation_disability_v1",
      },
      runnerStatus: "ready_to_implement_local_private_runner",
    },
    schemaVersion: "murph-age-r1006-mhas-panel-extension-runner-manifest.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "mhas_panel_extension_runner_manifest_ready",
    },
  };
}

function sourceCalibrationStateFixture(): Record<string, unknown> {
  return {
    private_runtime_only: true,
    row_level_predictions_stored: false,
    row_parse_executed: true,
    row_values_stored: false,
    schema_version: "murph.age.private.mhas-source-calibration-state.v0",
    split_bands: {
      calibration_count_band: "gte_1000",
      calibration_event_count_band: "gte_1000",
      holdout_count_band: "gte_1000",
      holdout_event_count_band: "gte_1000",
    },
    storage_attestation: safeStorageAttestation(),
  };
}

function enrichedCalibrationStateFixture(): Record<string, unknown> {
  return {
    calibration_params_private_only: { hidden: true },
    denominator_bands: {
      eligible_count_band: "gte_1000",
      event_count_band: "gte_1000",
      minimum_cell_count: 11,
    },
    feature_support_bands: {
      body_mass_index: "gte_1000",
      field_name_should_not_export: "gte_1000",
      physical_activity_proxy: "not_observed",
      self_rated_health: "gte_1000",
      smoking_status_proxy: "gte_1000",
    },
    field_names_private: ["hidden"],
    private_runtime_only: true,
    row_level_predictions_stored: false,
    row_parse_executed: true,
    row_values_stored: false,
    schema_version: "murph.age.private.mhas-enriched-calibration-state.v0",
    storage_attestation: safeStorageAttestation(),
  };
}

function enrichedFeatureCoverageStateFixture(): Record<string, unknown> {
  return {
    denominator_bands: {
      eligible_count_band: "gte_1000",
      event_count_band: "gte_1000",
      minimum_cell_count: 11,
    },
    feature_support_bands: {
      body_shape: "gte_1000",
      diabetes_history_proxy: "gte_1000",
      source_column_should_not_export: "gte_1000",
    },
    model_artifact_manifest_private: { hidden: true },
    private_runtime_only: true,
    row_level_predictions_stored: false,
    row_parse_executed: true,
    row_values_stored: false,
    schema_version: "murph.age.private.mhas-feature-coverage-state.v0",
    storage_attestation: safeStorageAttestation(),
  };
}

function activityProxyStateFixture(): Record<string, unknown> {
  return {
    activity_support_bands: {
      activity_proxy_active_response_count_band: "gte_1000",
      activity_proxy_valid_binary_count_band: "gte_1000",
    },
    denominator_bands: {
      eligible_count_band: "gte_1000",
      event_count_band: "gte_1000",
      minimum_cell_count: 11,
    },
    private_runtime_only: true,
    row_level_predictions_stored: false,
    row_parse_executed: true,
    row_values_stored: false,
    schema_version: "murph.age.private.mhas-activity-proxy-state.v0",
    storage_attestation: safeStorageAttestation(),
  };
}

function functionMobilityStateFixture(unsafe: boolean): Record<string, unknown> {
  return {
    denominator_bands: {
      calibration_count_band: "gte_1000",
      calibration_event_count_band: "gte_1000",
      function_available_count_band: "gte_1000",
      holdout_count_band: "gte_1000",
      holdout_event_count_band: "gte_1000",
      minimum_cell_count: 11,
    },
    fit_params_private_only: { hidden: true },
    function_support_bands: {
      adl_limitation_score_0_to_5: "gte_1000",
      function_composite_min_3_components: "gte_1000",
      mobility_limitation_score_0_to_5: "gte_1000",
      variable_name_should_not_export: "gte_1000",
    },
    private_runtime_only: true,
    row_level_predictions_stored: false,
    row_parse_executed: true,
    row_values_stored: unsafe,
    schema_version: "murph.age.private.mhas-function-mobility-state.v0",
    storage_attestation: {
      ...safeStorageAttestation(),
      row_values_stored: unsafe,
    },
  };
}

function safeBoundary(): Record<string, unknown> {
  return {
    aggregateOnly: true,
    codebookProseStored: false,
    coefficientsStored: false,
    localFileNamesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
  };
}

function safeStorageAttestation(): Record<string, boolean> {
  return {
    codebook_prose_stored: false,
    coefficients_stored: false,
    model_params_stored: false,
    predictions_exported: false,
    row_level_predictions_stored: false,
    row_values_stored: false,
    source_bodies_stored: false,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
