import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R980_MHAS_FUNCTION_DISABILITY_AGGREGATE_REDUCER_SCHEMA_VERSION,
  runR980MhasFunctionDisabilityAggregateReducer,
} from "./r980-mhas-function-disability-aggregate-reducer.ts";

describe("R980 MHAS function/disability aggregate reducer", () => {
  it("reduces the MHAS function/disability aggregate result without row egress", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r980-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR980MhasFunctionDisabilityAggregateReducer({
        createdAt: "2026-05-13T00:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r980-mhas-function-disability-aggregate-reducer.latest.json");
      expect(output.schemaVersion).toBe(R980_MHAS_FUNCTION_DISABILITY_AGGREGATE_REDUCER_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.artifactBoundary).toMatchObject({
        aggregateOnly: true,
        codebookProseStored: false,
        codebookTextStored: false,
        coefficientsStored: false,
        localPathsStored: false,
        modelParametersStored: false,
        modelScoringPerformed: false,
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
      expect(output.executionReceipt).toEqual({
        aggregateReportValidationPassed: true,
        modelPromotionAuthorized: false,
        modelTrainingExecuted: false,
        privateSourceCalibrationExecuted: true,
        productClaimsCreated: false,
        rowParseExecutedPrivateOnly: true,
      });
      expect(output.aggregateResult).toMatchObject({
        denominatorBands: {
          eligible_count_band: "gte_1000",
          event_count_band: "gte_1000",
        },
        keyRates: {
          functionBrierBeatsAllShufflesRate: 1,
          functionBrierBeatsInterceptRate: 1,
          functionBrierBeatsRawRate: 1,
          functionBrierBeatsShuffleMedianRate: 1,
          functionCBeatsAllShufflesRate: 0.9,
          functionCBeatsInterceptRate: 0.95,
          functionCBeatsRawRate: 0.95,
          functionCBeatsShuffleMedianRate: 1,
        },
        repeatCount: 20,
        shuffleCountPerRepeat: 30,
        supportClassification: "mhas_concordant_supportive_diagnostic_only",
      });
      expect(output.aggregateResult.medianDeltas.functionMinusRawC?.median).toBe(0.000856);
      expect(output.aggregateResult.medianDeltas.functionMinusRawBrier?.median).toBe(-0.041631);
      expect(output.decision).toEqual({
        action: "preserve_function_disability_candidate_family",
        allowedEffect: "candidate_domain_direction_only",
        productPromotionAuthorized: false,
        rationaleLabels: [
          "mhas_contract_ready",
          "aggregate_validation_passed",
          "function_disability_concordant_support",
          "diagnostic_only_no_product_claim",
        ],
        reviewGptNextUse: "aggregate_delta_interpretation_only",
      });
      expect(output.summary).toEqual({
        conclusion: "mhas_function_disability_supportive_diagnostic_only",
        nextLocalAction: "send_aggregate_delta_to_reviewgpt_or_continue_ns_hap_sidecar",
        productDisplayAuthorized: false,
        rowParsingPerformedByReducer: false,
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
      expect(persisted).not.toContain("field_names");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("holds the family when the endpoint/join contract is not ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r980-hold-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const blockedContractPath = path.join(tmp, "blocked-contract.json");
      await writeJson(blockedContractPath, {
        ...r979ContractFixture(),
        summary: {
          nextReducerRowParsingAuthorized: false,
        },
      });

      const { output } = await runR980MhasFunctionDisabilityAggregateReducer({
        ...paths,
        r979Path: blockedContractPath,
      });

      expect(output.decision.action).toBe("hold_function_disability_candidate_family");
      expect(output.decision.rationaleLabels).toContain("mhas_contract_not_ready");
      expect(output.summary.conclusion).toBe("mhas_function_disability_hold_diagnostic_only");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed when the aggregate report storage attestation is unsafe", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r980-unsafe-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const unsafeReportPath = path.join(tmp, "unsafe-r744.json");
      await writeJson(unsafeReportPath, {
        ...r744ReportFixture(),
        storage_attestation: {
          ...safeStorageAttestation(),
          row_values_exported: true,
        },
      });

      await expect(runR980MhasFunctionDisabilityAggregateReducer({
        ...paths,
        r744ReportPath: unsafeReportPath,
      })).rejects.toThrow("r744 storage attestation flag row_values_exported must be false");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r980-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r980-mhas-function-disability-aggregate-reducer.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R744_MHAS_FUNCTION_REPORT_PATH: paths.r744ReportPath,
          MURPH_AGE_R744_MHAS_FUNCTION_VALIDATION_PATH: paths.r744ValidationPath,
          MURPH_AGE_R979_MHAS_CONTRACT_PATH: paths.r979Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        artifact: "r980-mhas-function-disability-aggregate-reducer.latest.json",
        conclusion: "mhas_function_disability_supportive_diagnostic_only",
        keyRates: {
          functionBrierBeatsAllShufflesRate: 1,
          functionBrierBeatsInterceptRate: 1,
          functionBrierBeatsRawRate: 1,
          functionBrierBeatsShuffleMedianRate: 1,
          functionCBeatsAllShufflesRate: 0.9,
          functionCBeatsInterceptRate: 0.95,
          functionCBeatsRawRate: 0.95,
          functionCBeatsShuffleMedianRate: 1,
        },
        packetId: "r980-mhas-function-disability-aggregate-reducer",
        productDisplayAuthorized: false,
        rowParsingPerformedByReducer: false,
        schemaVersion: R980_MHAS_FUNCTION_DISABILITY_AGGREGATE_REDUCER_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
        supportClassification: "mhas_concordant_supportive_diagnostic_only",
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
  r979Path: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const paths = {
    outputDir,
    r744ReportPath: path.join(fixtureDir, "r744.json"),
    r744ValidationPath: path.join(fixtureDir, "r744-validation.json"),
    r979Path: path.join(fixtureDir, "r979.json"),
  };
  await Promise.all([
    writeJson(paths.r744ReportPath, r744ReportFixture()),
    writeJson(paths.r744ValidationPath, r744ValidationFixture()),
    writeJson(paths.r979Path, r979ContractFixture()),
  ]);
  return paths;
}

function r979ContractFixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r979-mhas-endpoint-join-contract",
    schemaVersion: "murph-age-r979-mhas-endpoint-join-contract.v1",
    summary: {
      nextReducerRowParsingAuthorized: true,
    },
  };
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
    delta_summaries: {
      function_minus_raw_brier: metricRange(-0.044, -0.043, -0.041631, -0.039, -0.038),
      function_minus_raw_c: metricRange(-0.000006, 0.000295, 0.000856, 0.001445, 0.001625),
      function_minus_shuffle_median_brier: metricRange(-0.000826, -0.000795, -0.000663, -0.000461, -0.000393),
      function_minus_shuffle_median_c: metricRange(0.000052, 0.000327, 0.000906, 0.001465, 0.001697),
    },
    denominator_bands: {
      eligible_count_band: "gte_1000",
      event_count_band: "gte_1000",
    },
    feature_support_bands: {
      age: "gte_1000",
      endpoint: "gte_1000",
      function_composite: "gte_1000",
      sex: "gte_1000",
    },
    key_rates: {
      function_brier_beats_all_shuffles_rate: 1,
      function_brier_beats_intercept_rate: 1,
      function_brier_beats_raw_rate: 1,
      function_brier_beats_shuffle_median_rate: 1,
      function_c_beats_all_shuffles_rate: 0.9,
      function_c_beats_intercept_rate: 0.95,
      function_c_beats_raw_rate: 0.95,
      function_c_beats_shuffle_median_rate: 1,
    },
    repeat_count: 20,
    run_id: "session_murph_age_r744_mhas_function_cross_source_repeat",
    schema_version: "murph.age.r744.mhas_function_cross_source_repeat.v0",
    shuffle_count_per_repeat: 30,
    status_snapshot: {
      model_promotion_authorized: false,
      model_training_executed: false,
      private_source_calibration_fit_executed: true,
      product_claims_created: false,
      row_parse_executed_private_only: true,
    },
    storage_attestation: safeStorageAttestation(),
    support_classification: "mhas_concordant_supportive_diagnostic_only",
  };
}

function safeStorageAttestation(): Record<string, boolean> {
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

function safeBoundary(): Record<string, unknown> {
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

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
