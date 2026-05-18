import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R988_MHAS_ANCHOR_FUNCTION_INCREMENT_CHECK_SCHEMA_VERSION,
  runR988MhasAnchorFunctionIncrementCheck,
} from "./r988-mhas-anchor-function-increment-check.ts";

describe("R988 MHAS anchor function increment check", () => {
  it("confirms a small function increment over the calibrated frozen anchor without row egress", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r988-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR988MhasAnchorFunctionIncrementCheck({
        createdAt: "2026-05-13T00:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r988-mhas-anchor-function-increment-check.latest.json");
      expect(output.schemaVersion).toBe(R988_MHAS_ANCHOR_FUNCTION_INCREMENT_CHECK_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.artifactBoundary).toMatchObject({
        aggregateOnly: true,
        codebookProseStored: false,
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
        rowParsingPerformedByR988: false,
        rowValuesStored: false,
        smallCellsStored: false,
        sourceBodiesStored: false,
        splitMembershipStored: false,
      });
      expect(output.anchorIncrement).toMatchObject({
        anchorModelId: "r399_compact_age_nonlinear_l2_0p000",
        comparisonPolicy: {
          baseComparator: "source_intercept_calibrated_frozen_anchor",
          trainingTarget: "mortality_risk_not_chronological_age",
        },
        keyRates: {
          functionBrierBeatsAllShufflesRate: 1,
          functionBrierBeatsInterceptRate: 1,
          functionBrierBeatsRawRate: 1,
          functionCBeatsAllShufflesRate: 0.9,
          functionCBeatsInterceptRate: 0.95,
          functionCBeatsRawRate: 0.95,
        },
        repeatCount: 20,
        shuffleCountPerRepeat: 30,
        verdict: "anchor_function_increment_supported_small_diagnostic_only",
      });
      expect(output.anchorIncrement.medianDeltas.functionMinusSourceInterceptC?.median).toBe(0.0008566);
      expect(output.anchorIncrement.medianDeltas.functionMinusSourceInterceptBrier?.median).toBe(-0.0006535);
      expect(output.decision).toEqual({
        action: "preserve_function_disability_as_anchor_increment_candidate",
        allowedEffect: "research_sidecar_direction_only",
        rationaleLabels: [
          "frozen_nhis_r399_anchor_confirmed",
          "source_intercept_comparator_used",
          "function_increment_beats_calibrated_anchor_and_shuffle_controls",
          "diagnostic_sidecar_only_no_product_claim",
        ],
        reviewGptRole: "high_value_result_interpretation_only",
      });
      expect(output.executionEvidence).toEqual({
        aggregateValidationPassed: true,
        frozenAnchorScoringExecutedInPriorLoop: true,
        modelTrainingExecutedInPriorLoop: false,
        privateSourceCalibrationFitExecutedInPriorLoop: true,
        productClaimsCreated: false,
        rowParseExecutedPrivateOnlyInPriorLoop: true,
      });
      expect(output.summary).toEqual({
        nextLocalAction: "use_as_r986_anchor_increment_receipt_then_continue_external_source_activation",
        productDisplayAuthorized: false,
        rowParsingPerformedByReducer: false,
        verdict: "mhas_function_adds_small_increment_over_frozen_anchor",
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
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("holds when the calibrated-anchor increment is not positive", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r988-hold-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const blockedReportPath = path.join(tmp, "blocked-r744.json");
      const baseReport = r744ReportFixture();
      const deltaSummaries = baseReport.delta_summaries;
      const keyRates = baseReport.key_rates;
      if (!isRecord(deltaSummaries) || !isRecord(keyRates)) {
        throw new Error("R988 test fixture must expose object metric sections.");
      }
      await writeJson(blockedReportPath, {
        ...baseReport,
        delta_summaries: {
          ...deltaSummaries,
          function_minus_intercept_c: metricRange(-0.002, -0.001, -0.0005, -0.0001, 0),
        },
        key_rates: {
          ...keyRates,
          function_c_beats_intercept_rate: 0.2,
        },
      });

      const { output } = await runR988MhasAnchorFunctionIncrementCheck({
        ...paths,
        r744ReportPath: blockedReportPath,
      });

      expect(output.decision.action).toBe("hold_function_disability_anchor_increment_candidate");
      expect(output.anchorIncrement.verdict).toBe("anchor_function_increment_hold");
      expect(output.summary.verdict).toBe("mhas_function_increment_not_confirmed");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed when the source report storage attestation is unsafe", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r988-unsafe-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const unsafeReportPath = path.join(tmp, "unsafe-r744.json");
      await writeJson(unsafeReportPath, {
        ...r744ReportFixture(),
        storage_attestation: {
          ...safeStorageAttestation(),
          row_level_predictions_exported: true,
        },
      });

      await expect(runR988MhasAnchorFunctionIncrementCheck({
        ...paths,
        r744ReportPath: unsafeReportPath,
      })).rejects.toThrow("r744 storage attestation flag row_level_predictions_exported must be false");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r988-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r988-mhas-anchor-function-increment-check.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R744_MHAS_FUNCTION_REPORT_PATH: paths.r744ReportPath,
          MURPH_AGE_R744_MHAS_FUNCTION_VALIDATION_PATH: paths.r744ValidationPath,
          MURPH_AGE_R980_MHAS_FUNCTION_REDUCER_PATH: paths.r980Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        artifact: "r988-mhas-anchor-function-increment-check.latest.json",
        keyRates: {
          functionBrierBeatsAllShufflesRate: 1,
          functionBrierBeatsInterceptRate: 1,
          functionBrierBeatsRawRate: 1,
          functionCBeatsAllShufflesRate: 0.9,
          functionCBeatsInterceptRate: 0.95,
          functionCBeatsRawRate: 0.95,
        },
        packetId: "r988-mhas-anchor-function-increment-check",
        productDisplayAuthorized: false,
        rowParsingPerformedByReducer: false,
        schemaVersion: R988_MHAS_ANCHOR_FUNCTION_INCREMENT_CHECK_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
        verdict: "mhas_function_adds_small_increment_over_frozen_anchor",
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
  outputDir: string;
  r744ReportPath: string;
  r744ValidationPath: string;
  r980Path: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const paths = {
    outputDir,
    r744ReportPath: path.join(fixtureDir, "r744.json"),
    r744ValidationPath: path.join(fixtureDir, "r744-validation.json"),
    r980Path: path.join(fixtureDir, "r980.json"),
  };
  await Promise.all([
    writeJson(paths.r744ReportPath, r744ReportFixture()),
    writeJson(paths.r744ValidationPath, r744ValidationFixture()),
    writeJson(paths.r980Path, r980Fixture()),
  ]);
  return paths;
}

function r744ValidationFixture(): Record<string, unknown> {
  return {
    issue_count: 0,
    issues: [],
    schema_version: "murph.age.r744.mhas_function_cross_source_repeat_validation.v0",
    status: "passed",
  };
}

function r744ReportFixture(): Record<string, unknown> {
  return {
    anchor_model_id: "r399_compact_age_nonlinear_l2_0p000",
    delta_summaries: {
      function_minus_intercept_brier: metricRange(-0.0008195, -0.0007771, -0.0006535, -0.0004511, -0.0003733),
      function_minus_intercept_c: metricRange(-0.000006, 0.0002954, 0.0008566, 0.0014448, 0.0016255),
      function_minus_raw_brier: metricRange(-0.044, -0.043, -0.041631, -0.039, -0.038),
      function_minus_raw_c: metricRange(-0.000006, 0.000295, 0.000856, 0.001445, 0.001625),
      function_minus_shuffle_median_brier: metricRange(-0.000826, -0.000795, -0.000663, -0.000461, -0.000393),
      function_minus_shuffle_median_c: metricRange(0.000052, 0.000327, 0.000906, 0.001465, 0.001697),
    },
    key_rates: {
      function_brier_beats_all_shuffles_rate: 1,
      function_brier_beats_intercept_rate: 1,
      function_brier_beats_raw_rate: 1,
      function_c_beats_all_shuffles_rate: 0.9,
      function_c_beats_intercept_rate: 0.95,
      function_c_beats_raw_rate: 0.95,
    },
    repeat_count: 20,
    run_id: "session_murph_age_r744_mhas_function_cross_source_repeat",
    schema_version: "murph.age.r744.mhas_function_cross_source_repeat.v0",
    shuffle_count_per_repeat: 30,
    status_snapshot: {
      external_transport_scoring_executed: true,
      model_training_executed: false,
      private_source_calibration_fit_executed: true,
      row_parse_executed_private_only: true,
    },
    storage_attestation: safeStorageAttestation(),
    support_classification: "mhas_concordant_supportive_diagnostic_only",
  };
}

function r980Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      codebookProseStored: false,
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
      variableLabelsStored: false,
      variableNamesStored: false,
    },
    packetId: "r980-mhas-function-disability-aggregate-reducer",
    schemaVersion: "murph-age-r980-mhas-function-disability-aggregate-reducer.v1",
  };
}

function safeStorageAttestation(): Record<string, false> {
  return {
    codebook_prose_exported: false,
    coefficients_exported: false,
    participant_identifiers_exported: false,
    product_claims_created: false,
    row_level_predictions_exported: false,
    row_values_exported: false,
    source_field_names_exported: false,
    source_text_exported: false,
  };
}

function metricRange(min: number, p10: number, median: number, p90: number, max: number): Record<string, number> {
  return { max, median, min, p10, p90 };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
