import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runR1025FunctionTransportResultReducer } from "./r1025-function-transport-result-reducer.ts";
import { runR1026FunctionTransportAggregatePacketValidator } from "./r1026-function-transport-aggregate-packet-validator.ts";
import {
  R1028_HISTORICAL_NSHAP_FUNCTION_TRANSPORT_PACKET_SCHEMA_VERSION,
  runR1028HistoricalNshapFunctionTransportPacket,
} from "./r1028-historical-nshap-function-transport-packet.ts";

describe("R1028 historical NSHAP function transport packet", () => {
  it("translates validated historical aggregate receipts into the strict R1025 packet shape", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1028-ready-"));
    try {
      const paths = await writeHistoricalFixtures(tmp);
      const { aggregatePacket, aggregatePacketOutputPath, output, outputPath } =
        await runR1028HistoricalNshapFunctionTransportPacket({
          aggregatePacketOutputPath: paths.aggregatePacketPath,
          createdAt: "2026-05-14T04:00:00.000Z",
          outputDir: paths.outputDir,
          r770ResultPath: paths.r770ResultPath,
          r770ValidationPath: paths.r770ValidationPath,
          r773ResultPath: paths.r773ResultPath,
          r773ValidationPath: paths.r773ValidationPath,
          r997ReplayPath: paths.r997ReplayPath,
        });

      expect(path.basename(outputPath)).toBe("r1028-historical-nshap-function-transport-packet.latest.json");
      expect(path.basename(aggregatePacketOutputPath)).toBe("r1025-function-transport-aggregate-packet.latest.json");
      expect(output.schemaVersion).toBe(R1028_HISTORICAL_NSHAP_FUNCTION_TRANSPORT_PACKET_SCHEMA_VERSION);
      expect(output.summary).toEqual({
        conclusion: "historical_nshap_function_transport_packet_ready_for_review",
        productDisplayAuthorized: false,
        reviewGptNextUse: "aggregate_result_direction_only",
        rowParsingPerformedByR1028: false,
      });
      expect(aggregatePacket.packetId).toBe("r1025-function-transport-aggregate-packet");
      expect(aggregatePacket.packetRole).toBe("historical_nshap_aggregate_replay");
      expect(aggregatePacket.decision_inputs).toMatchObject({
        aggregate_verdict: "supports_generalization",
        calibration_non_worse: false,
        cognition_dominates_function: false,
        function_beats_missingness_control: false,
        function_beats_shuffled_control: true,
        meaningful_aggregate_delta: true,
        proper_scores_improve: true,
        same_denominator_valid: true,
        suppression_passed: true,
      });

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain(".zip");
      expect(persisted).not.toContain(".dta");
      expect(persisted).not.toContain("ICPSR_");

      const validator = await runR1026FunctionTransportAggregatePacketValidator({
        aggregatePacketPath: aggregatePacketOutputPath,
        outputDir: paths.outputDir,
      });
      expect(validator.output.summary.conclusion).toBe("fresh_function_transport_packet_valid");

      await writeJson(paths.manifestPath, manifestFixture());
      const reducer = await runR1025FunctionTransportResultReducer({
        aggregatePacketPath: aggregatePacketOutputPath,
        manifestPath: paths.manifestPath,
        outputDir: paths.outputDir,
      });
      expect(reducer.output.decision.action).toBe("send_reviewgpt_aggregate_delta");
      expect(reducer.output.decision.reviewGptRequired).toBe(true);
      expect(reducer.output.summary.productDisplayAuthorized).toBe(false);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("refuses packet emission when historical validations are not clean", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1028-blocked-"));
    try {
      const paths = await writeHistoricalFixtures(tmp, { r773ValidationStatus: "failed" });

      await expect(runR1028HistoricalNshapFunctionTransportPacket({
        aggregatePacketOutputPath: paths.aggregatePacketPath,
        outputDir: paths.outputDir,
        r770ResultPath: paths.r770ResultPath,
        r770ValidationPath: paths.r770ValidationPath,
        r773ResultPath: paths.r773ResultPath,
        r773ValidationPath: paths.r773ValidationPath,
        r997ReplayPath: paths.r997ReplayPath,
      })).rejects.toThrow("historical NSHAP aggregate receipts are not ready");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1028-cli-"));
    try {
      const paths = await writeHistoricalFixtures(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1028-historical-nshap-function-transport-packet.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1025_FUNCTION_TRANSPORT_AGGREGATE_PACKET_PATH: paths.aggregatePacketPath,
          MURPH_AGE_R770_NSHAP_RESULT_PATH: paths.r770ResultPath,
          MURPH_AGE_R770_NSHAP_VALIDATION_PATH: paths.r770ValidationPath,
          MURPH_AGE_R773_NSHAP_RESULT_PATH: paths.r773ResultPath,
          MURPH_AGE_R773_NSHAP_VALIDATION_PATH: paths.r773ValidationPath,
          MURPH_AGE_R997_NSHAP_REPLAY_PATH: paths.r997ReplayPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        aggregatePacketArtifact: "r1025-function-transport-aggregate-packet.latest.json",
        conclusion: "historical_nshap_function_transport_packet_ready_for_review",
        packetId: "r1028-historical-nshap-function-transport-packet",
        productDisplayAuthorized: false,
        reviewGptNextUse: "aggregate_result_direction_only",
        rowParsingPerformedByR1028: false,
        schemaVersion: R1028_HISTORICAL_NSHAP_FUNCTION_TRANSPORT_PACKET_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain(".zip");
      expect(stdout).not.toContain("ICPSR_");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeHistoricalFixtures(
  tmp: string,
  options: { r773ValidationStatus?: "failed" | "passed" } = {},
): Promise<{
  aggregatePacketPath: string;
  manifestPath: string;
  outputDir: string;
  r770ResultPath: string;
  r770ValidationPath: string;
  r773ResultPath: string;
  r773ValidationPath: string;
  r997ReplayPath: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const paths = {
    aggregatePacketPath: path.join(outputDir, "r1025-function-transport-aggregate-packet.latest.json"),
    manifestPath: path.join(fixtureDir, "manifest.json"),
    outputDir,
    r770ResultPath: path.join(fixtureDir, "r770.json"),
    r770ValidationPath: path.join(fixtureDir, "r770-validation.json"),
    r773ResultPath: path.join(fixtureDir, "r773.json"),
    r773ValidationPath: path.join(fixtureDir, "r773-validation.json"),
    r997ReplayPath: path.join(fixtureDir, "r997.json"),
  };
  await Promise.all([
    writeJson(paths.r770ResultPath, historicalAggregateFixture("combined")),
    writeJson(paths.r770ValidationPath, validationFixture("passed")),
    writeJson(paths.r773ResultPath, historicalAggregateFixture("single_domain")),
    writeJson(paths.r773ValidationPath, validationFixture(options.r773ValidationStatus ?? "passed")),
    writeJson(paths.r997ReplayPath, {
      packetId: "r997-strict-nshap-function-cognition-replay",
      schemaVersion: "murph-age-r997-strict-nshap-function-cognition-replay.v1",
      status: "research-local-aggregate-only",
      summary: {
        artifactVerdict: "historical_nshap_aggregate_signal_usable_research_direction_only",
      },
    }),
  ]);
  return paths;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function validationFixture(status: "failed" | "passed"): Record<string, unknown> {
  return {
    issue_count: status === "passed" ? 0 : 1,
    issues: status === "passed" ? [] : ["fixture_failure"],
    schema_version: "fixture-validation",
    status,
  };
}

function historicalAggregateFixture(kind: "combined" | "single_domain"): Record<string, unknown> {
  const common = {
    abstention_bands: {
      age_sex_missing_or_out_of_range: "not_observed",
      cognition_missing: "gte_11_lt_100",
      function_missing: "suppressed_1_to_10",
      unknown_endpoint: "gte_11_lt_100",
    },
    denominator_bands: {
      eligible_count_band: "gte_1000",
      event_count_band: "gte_100_lt_1000",
    },
    feature_support_bands: {
      age: "gte_1000",
      cognition_composite: "gte_1000",
      endpoint: "gte_1000",
      function_composite: "gte_1000",
      sex: "gte_1000",
    },
    storage_attestation: {
      codebook_prose_exported: false,
      coefficients_exported: false,
      participant_identifiers_exported: false,
      product_claims_created: false,
      row_level_predictions_exported: false,
      row_values_exported: false,
      source_field_names_exported: false,
      source_text_exported: false,
    },
  };
  if (kind === "combined") {
    return {
      ...common,
      delta_summaries: {
        combined_minus_raw_brier: { median: -0.024 },
        combined_minus_raw_c: { median: 0.042 },
      },
      schema_version: "fixture-combined",
      support_classification: "nshap_two_domain_additive_external_supportive_diagnostic_only",
    };
  }
  return {
    ...common,
    delta_summaries: {
      cognition_minus_intercept_brier: { median: -0.003 },
      cognition_minus_intercept_c: { median: 0.02 },
      function_minus_intercept_brier: { median: -0.006 },
      function_minus_intercept_c: { median: 0.034 },
      function_minus_shuffle_median_brier: { median: -0.006 },
      function_minus_shuffle_median_c: { median: 0.034 },
    },
    schema_version: "fixture-single-domain",
    support_classification: "nshap_both_single_domains_supportive",
  };
}

function manifestFixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      aggregateOnly: true,
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
    },
    packetId: "r1023-function-transport-candidate-manifest",
    schemaVersion: "murph-age-r1023-function-transport-candidate-manifest.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "function_transport_v1_manifest_ready_waiting_on_nshap_activation",
    },
  };
}
