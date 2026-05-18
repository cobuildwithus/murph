import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R991_MHAS_DEEP_DIAGNOSTIC_REDUCER_SCHEMA_VERSION,
  runR991MhasDeepDiagnosticReducer,
} from "./r991-mhas-deep-diagnostic-reducer.ts";

describe("R991 MHAS deep diagnostic reducer", () => {
  it("preserves function/disability after residualized deep diagnostics without row egress", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r991-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR991MhasDeepDiagnosticReducer({
        createdAt: "2026-05-13T00:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r991-mhas-deep-diagnostic-reducer.latest.json");
      expect(output.schemaVersion).toBe(R991_MHAS_DEEP_DIAGNOSTIC_REDUCER_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.artifactBoundary).toMatchObject({
        aggregateOnly: true,
        coefficientsStored: false,
        localPathsStored: false,
        modelParametersStored: false,
        participantIdentifiersStored: false,
        predictionsStored: false,
        productClaimsIncluded: false,
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        rowParsingPerformedByR991: false,
        rowValuesStored: false,
        smallCellsStored: false,
        sourceBodiesStored: false,
        splitMembershipStored: false,
      });
      expect(output.deepDiagnostic).toMatchObject({
        anchorModelId: "r399_compact_age_nonlinear_l2_0p000",
        keyRates: {
          functionBrierBeatsSourceInterceptRate: 1,
          functionCBeatsSourceInterceptRate: 0.9166666666666666,
          functionLogLossBeatsSourceInterceptRate: 1,
          residualBrierBeatsSourceInterceptRate: 1,
          residualCBeatsSourceInterceptRate: 0.9583333333333334,
          residualLogLossBeatsSourceInterceptRate: 1,
        },
        repeatCount: 24,
        shuffleCountPerRepeat: 40,
        verdict: "function_increment_supportive_with_residualized_signal_diagnostic_only",
      });
      expect(output.deepDiagnostic.medianDeltas.residualMinusSourceInterceptC?.median).toBe(0.0004516);
      expect(output.deepDiagnostic.medianDeltas.residualMinusSourceInterceptBrier?.median).toBe(-0.0001778);
      expect(output.decision).toEqual({
        action: "preserve_function_disability_as_lead_sidecar_after_deep_diagnostic",
        allowedEffect: "research_model_direction_only",
        nextModelQuestion: "fresh_external_function_cognition_generalization",
        rationaleLabels: [
          "frozen_anchor_confirmed",
          "source_intercept_comparator_beaten",
          "age_sex_residualized_signal_survives",
          "shuffle_controls_beaten",
          "research_only_no_product_claim",
        ],
      });
      expect(output.executionEvidence).toEqual({
        aggregateValidationPassed: true,
        incrementDiagnosticExecuted: true,
        modelPromotionAuthorized: false,
        modelTrainingExecuted: false,
        productClaimsCreated: false,
        rowParseExecutedPrivateOnly: true,
        shuffleControlsExecuted: true,
      });
      expect(output.summary).toEqual({
        nextLocalAction: "prepare_fresh_nshap_function_cognition_generalization_when_activation_is_confirmed",
        productDisplayAuthorized: false,
        verdict: "function_disability_survives_age_residualized_deep_diagnostic",
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

  it("holds when the residualized signal does not survive", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r991-hold-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const blockedReportPath = path.join(tmp, "blocked-r990.json");
      const baseReport = r990ReportFixture();
      const keyRates = baseReport.key_rates;
      if (!isRecord(keyRates)) throw new Error("R991 test fixture must expose key rates.");
      await writeJson(blockedReportPath, {
        ...baseReport,
        key_rates: {
          ...keyRates,
          residual_c_beats_source_intercept_rate: 0.2,
        },
      });

      const { output } = await runR991MhasDeepDiagnosticReducer({
        ...paths,
        r990ReportPath: blockedReportPath,
      });

      expect(output.decision.action).toBe("hold_function_disability_after_deep_diagnostic");
      expect(output.deepDiagnostic.verdict).toBe("function_increment_hold_after_deep_diagnostic");
      expect(output.summary.verdict).toBe("function_disability_deep_diagnostic_not_confirmed");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed when the R990 storage attestation is unsafe", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r991-unsafe-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const unsafeReportPath = path.join(tmp, "unsafe-r990.json");
      await writeJson(unsafeReportPath, {
        ...r990ReportFixture(),
        storage_attestation: {
          ...safeStorageAttestation(),
          local_paths_exported: true,
        },
      });

      await expect(runR991MhasDeepDiagnosticReducer({
        ...paths,
        r990ReportPath: unsafeReportPath,
      })).rejects.toThrow("r990 storage attestation flag local_paths_exported must be false");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r991-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r991-mhas-deep-diagnostic-reducer.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R990_MHAS_DEEP_DIAGNOSTIC_REPORT_PATH: paths.r990ReportPath,
          MURPH_AGE_R990_MHAS_DEEP_DIAGNOSTIC_VALIDATION_PATH: paths.r990ValidationPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        artifact: "r991-mhas-deep-diagnostic-reducer.latest.json",
        keyRates: {
          functionBrierBeatsSourceInterceptRate: 1,
          functionCBeatsSourceInterceptRate: 0.9166666666666666,
          functionLogLossBeatsSourceInterceptRate: 1,
          residualBrierBeatsSourceInterceptRate: 1,
          residualCBeatsSourceInterceptRate: 0.9583333333333334,
          residualLogLossBeatsSourceInterceptRate: 1,
        },
        packetId: "r991-mhas-deep-diagnostic-reducer",
        productDisplayAuthorized: false,
        schemaVersion: R991_MHAS_DEEP_DIAGNOSTIC_REDUCER_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
        verdict: "function_disability_survives_age_residualized_deep_diagnostic",
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
  r990ReportPath: string;
  r990ValidationPath: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const paths = {
    outputDir,
    r990ReportPath: path.join(fixtureDir, "r990.json"),
    r990ValidationPath: path.join(fixtureDir, "r990-validation.json"),
  };
  await Promise.all([
    writeJson(paths.r990ReportPath, r990ReportFixture()),
    writeJson(paths.r990ValidationPath, r990ValidationFixture()),
  ]);
  return paths;
}

function r990ValidationFixture(): Record<string, unknown> {
  return {
    issue_count: 0,
    issues: [],
    schema_version: "murph.age.r990.mhas_anchor_increment_deep_diagnostics_validation.v0",
    status: "passed",
  };
}

function r990ReportFixture(): Record<string, unknown> {
  return {
    anchor_model_id: "r399_compact_age_nonlinear_l2_0p000",
    delta_summaries: {
      function_minus_source_intercept_brier: metricRange(-0.0008195, -0.0007671, -0.0006316, -0.0004119, -0.0003478),
      function_minus_source_intercept_c: metricRange(-0.0001345, 0.0001913, 0.0008359, 0.001384, 0.0016255),
      function_minus_source_intercept_log_loss: metricRange(-0.0024354, -0.002333, -0.002059, -0.0015551, -0.0015003),
      residual_minus_source_intercept_brier: metricRange(-0.0002576, -0.0002225, -0.0001778, -0.0000587, -0.0000125),
      residual_minus_source_intercept_c: metricRange(-0.0001034, 0.0000844, 0.0004516, 0.0005747, 0.0005969),
      residual_minus_source_intercept_log_loss: metricRange(-0.0007372, -0.0007073, -0.0005483, -0.0002537, -0.0002198),
    },
    key_rates: {
      function_brier_beats_source_intercept_rate: 1,
      function_c_beats_source_intercept_rate: 0.9166666666666666,
      function_log_loss_beats_source_intercept_rate: 1,
      residual_brier_beats_source_intercept_rate: 1,
      residual_c_beats_source_intercept_rate: 0.9583333333333334,
      residual_log_loss_beats_source_intercept_rate: 1,
    },
    repeat_count: 24,
    run_id: "session_murph_age_r990_mhas_anchor_increment_deep_diagnostics",
    schema_version: "murph.age.r990.mhas_anchor_increment_deep_diagnostics.v0",
    shuffle_count_per_repeat: 40,
    status_snapshot: {
      increment_diagnostic_executed: true,
      model_training_executed: false,
      row_parse_executed_private_only: true,
      shuffle_controls_executed: true,
    },
    storage_attestation: safeStorageAttestation(),
    verdict: "function_increment_supportive_with_residualized_signal_diagnostic_only",
  };
}

function safeStorageAttestation(): Record<string, false> {
  return {
    codebook_prose_exported: false,
    coefficients_exported: false,
    local_paths_exported: false,
    participant_identifiers_exported: false,
    product_claims_created: false,
    row_level_predictions_exported: false,
    row_values_exported: false,
    source_field_names_exported: false,
    source_file_names_exported: false,
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
