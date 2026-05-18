import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1009_MHAS_FUNCTION_PANEL_EXTENSION_RESULT_SCHEMA_VERSION,
  runR1009MhasFunctionPanelExtensionResult,
} from "./r1009-mhas-function-panel-extension-result.ts";

describe("R1009 MHAS function panel extension result", () => {
  it("reduces the R731 function panel diagnostic into an aggregate-only supportive result", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1009-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR1009MhasFunctionPanelExtensionResult({
        createdAt: "2026-05-13T09:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1009-mhas-function-panel-extension-result.latest.json");
      expect(output.schemaVersion).toBe(R1009_MHAS_FUNCTION_PANEL_EXTENSION_RESULT_SCHEMA_VERSION);
      expect(output.summary).toEqual({
        conclusion: "mhas_function_panel_extension_supports_lead_sidecar",
        nextLocalAction: "send_mhas_function_panel_result_to_reviewgpt_for_model_direction",
        productDisplayAuthorized: false,
        reviewGptNextUse: "aggregate_result_interpretation_and_next_model_direction",
        rowParsingPerformedByR1009: false,
      });
      expect(output.consensusContext).toEqual({
        decision: "run_mhas_function_panel_extension",
        firstLoop: "mhas_function_panel_delta",
        functionSidecarStatus: "lead_diagnostic",
        trustedReviewerCount: 5,
      });
      expect(output.panelExtensionResult).toMatchObject({
        baseLabelCount: 2,
        functionSupportVerdict: "function_panel_extension_supportive_diagnostic_only",
        negativeControlVerdict: "function_beats_shuffled_negative_control",
        resultCount: 8,
        topWeightedBrierMethod: {
          brierScore: 0.14317578992686214,
          methodLabel: "function_mobility_additive_diagnostic",
          rank: 1,
        },
      });
      expect(output.panelExtensionResult.functionDeltaByBase).toEqual([
        {
          baseLabel: "activity_candidate",
          brierDeltaVsIntercept: -0.0007700511688751577,
          cStatisticDeltaVsIntercept: 0.0022625305317865996,
          methodLabel: "function_mobility_additive_diagnostic",
          observedExpectedAbsDistanceDeltaVsIntercept: -0.0033718772595436874,
        },
        {
          baseLabel: "current_adapter_activity_missing",
          brierDeltaVsIntercept: -0.001093545775294552,
          cStatisticDeltaVsIntercept: 0.003046964925510931,
          methodLabel: "function_mobility_additive_diagnostic",
          observedExpectedAbsDistanceDeltaVsIntercept: -0.004777886224869743,
        },
      ]);
      expect(output.executionEvidence).toMatchObject({
        aggregateValidationPassed: true,
        externalScoringExecutedInPriorLoop: true,
        modelMutationExecutedInPriorLoop: false,
        modelPromotionAuthorized: false,
        privateAdditiveFitExecutedInPriorLoop: true,
        productClaimsCreated: false,
        rowParseExecutedPrivateOnlyInPriorLoop: true,
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
        rowParsingPerformedByR1009: false,
        rowValuesStored: false,
        sourceBodiesStored: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain(".latest.json");
      expect(persisted).not.toContain(".dta");
      expect(persisted).not.toContain(".zip");
      expect(persisted).not.toContain(".rar");
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

  it("holds when aggregate validation did not pass", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1009-hold-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { validationPassed: false });
      const { output } = await runR1009MhasFunctionPanelExtensionResult({
        createdAt: "2026-05-13T09:00:00.000Z",
        ...paths,
      });

      expect(output.summary.conclusion).toBe("mhas_function_panel_extension_not_confirmed");
      expect(output.panelExtensionResult.functionSupportVerdict).toBe("function_panel_extension_hold");
      expect(output.summary.nextLocalAction).toBe("return_to_candidate_family_search");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe storage attestations from the aggregate report", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1009-unsafe-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { unsafeStorage: true });

      await expect(runR1009MhasFunctionPanelExtensionResult({
        ...paths,
      })).rejects.toThrow("R731 storage attestation flag row_values_stored must be false.");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1009-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1009-mhas-function-panel-extension-result.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1007_MHAS_PANEL_AGGREGATE_RECEIPT_PATH: paths.r1007Path,
          MURPH_AGE_R1008_MHAS_PANEL_REVIEWGPT_REDUCTION_PATH: paths.r1008Path,
          MURPH_AGE_R731_MHAS_FUNCTION_PANEL_REPORT_PATH: paths.r731ReportPath,
          MURPH_AGE_R731_MHAS_FUNCTION_PANEL_VALIDATION_PATH: paths.r731ValidationPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        conclusion: "mhas_function_panel_extension_supports_lead_sidecar",
        functionSupportVerdict: "function_panel_extension_supportive_diagnostic_only",
        negativeControlVerdict: "function_beats_shuffled_negative_control",
        nextLocalAction: "send_mhas_function_panel_result_to_reviewgpt_for_model_direction",
        packetId: "r1009-mhas-function-panel-extension-result",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1009: false,
        schemaVersion: R1009_MHAS_FUNCTION_PANEL_EXTENSION_RESULT_SCHEMA_VERSION,
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
  options: { unsafeStorage?: boolean; validationPassed?: boolean } = {},
): Promise<{
  outputDir: string;
  r1007Path: string;
  r1008Path: string;
  r731ReportPath: string;
  r731ValidationPath: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const paths = {
    outputDir,
    r1007Path: path.join(fixtureDir, "r1007.json"),
    r1008Path: path.join(fixtureDir, "r1008.json"),
    r731ReportPath: path.join(fixtureDir, "r731-report.json"),
    r731ValidationPath: path.join(fixtureDir, "r731-validation.json"),
  };
  await Promise.all([
    writeJson(paths.r1007Path, r1007Fixture()),
    writeJson(paths.r1008Path, r1008Fixture()),
    writeJson(paths.r731ReportPath, r731ReportFixture(options.unsafeStorage === true)),
    writeJson(paths.r731ValidationPath, r731ValidationFixture(options.validationPassed !== false)),
  ]);
  return paths;
}

function r1007Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1007-mhas-panel-extension-aggregate-receipt",
    schemaVersion: "murph-age-r1007-mhas-panel-extension-aggregate-receipt.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "mhas_panel_extension_existing_private_states_support_runner_reuse",
    },
  };
}

function r1008Fixture(): Record<string, unknown> {
  return {
    counts: { trusted: 5 },
    consensus: {
      decision: "run_mhas_function_panel_extension",
      first_loop: "mhas_function_panel_delta",
      function_sidecar_status: "lead_diagnostic",
    },
    schema_version: "murph-age-r1008-mhas-panel-readout-direction-reduction.v1",
  };
}

function r731ValidationFixture(passed: boolean): Record<string, unknown> {
  return {
    schema_version: "murph.age.r731.mhas_function_mobility_transport_diagnostic_validation.v0",
    status: passed ? "passed" : "failed",
  };
}

function r731ReportFixture(unsafeStorage: boolean): Record<string, unknown> {
  return {
    result_count: 8,
    run_id: "session_murph_age_r731_mhas_function_mobility_transport_diagnostic",
    schema_version: "murph.age.autoresearch.mhas-function-mobility-transport-diagnostic.r731.v0",
    status: "completed_aggregate_only_function_mobility_transport_diagnostic_research_not_promoted",
    status_snapshot: {
      external_scoring_executed: true,
      model_mutation_executed: false,
      model_promotion_authorized: false,
      private_additive_fit_executed: true,
      product_claims_created: false,
      source_row_parse_executed_private_only: true,
    },
    rankings: {
      by_weighted_holdout_brier: [
        {
          brier_score: 0.14317578992686214,
          method_id: "function_mobility_additive_diagnostic",
          rank: 1,
        },
      ],
      method_deltas_vs_intercept: [
        {
          base_id: "activity_candidate",
          brier_delta_vs_intercept: -0.0007700511688751577,
          c_statistic_delta_vs_intercept: 0.0022625305317865996,
          method_id: "function_mobility_additive_diagnostic",
          observed_expected_abs_distance_delta_vs_intercept: -0.0033718772595436874,
        },
        {
          base_id: "activity_candidate",
          brier_delta_vs_intercept: 0.000046981878181057146,
          c_statistic_delta_vs_intercept: -0.0008244040463829538,
          method_id: "shuffled_function_negative_control",
          observed_expected_abs_distance_delta_vs_intercept: -0.0003695561139693826,
        },
        {
          base_id: "current_adapter_activity_missing",
          brier_delta_vs_intercept: -0.001093545775294552,
          c_statistic_delta_vs_intercept: 0.003046964925510931,
          method_id: "function_mobility_additive_diagnostic",
          observed_expected_abs_distance_delta_vs_intercept: -0.004777886224869743,
        },
        {
          base_id: "current_adapter_activity_missing",
          brier_delta_vs_intercept: 0.00005190019421072445,
          c_statistic_delta_vs_intercept: -0.0006977107201914245,
          method_id: "shuffled_function_negative_control",
          observed_expected_abs_distance_delta_vs_intercept: -0.00037840294414914766,
        },
      ],
    },
    storage_attestation: {
      absolute_paths_stored: false,
      clinical_claims_created: false,
      codebook_prose_stored: false,
      credentials_stored: false,
      file_names_stored: false,
      fit_params_exported: false,
      identifiers_stored: false,
      model_artifact_values_stored: false,
      model_mutation_executed: false,
      model_promotion_authorized: false,
      model_refit_executed: false,
      predictions_exported: false,
      product_claims_created: false,
      protocol_claims_created: false,
      recommendation_claims_created: false,
      row_level_predictions_stored: false,
      row_values_stored: unsafeStorage,
      small_cells_stored: false,
      source_bodies_stored: false,
      source_field_names_stored: false,
      split_memberships_stored: false,
      terms_text_stored: false,
    },
  };
}

function safeBoundary(): Record<string, unknown> {
  return {
    aggregateOnly: true,
    codebookProseStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    localFileNamesStored: false,
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
