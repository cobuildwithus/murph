import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R986_CROSS_SOURCE_FUNCTION_ARBITRATION_SCHEMA_VERSION,
  runR986CrossSourceFunctionArbitration,
} from "./r986-cross-source-function-arbitration.ts";

describe("R986 cross-source function arbitration", () => {
  it("keeps function/disability as the lead diagnostic sidecar from aggregate evidence", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r986-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR986CrossSourceFunctionArbitration({
        createdAt: "2026-05-13T00:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r986-cross-source-function-arbitration.latest.json");
      expect(output.schemaVersion).toBe(R986_CROSS_SOURCE_FUNCTION_ARBITRATION_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.summary).toEqual({
        currentLeadFamily: "function_disability",
        nextLocalLoop: "mhas_anchor_increment_check",
        productDisplayAuthorized: false,
        reviewGptNextUse: "r986_model_direction_chorus",
        verdict: "function_disability_portable_diagnostic_sidecar_supported",
      });
      expect(output.arbitration.functionDisabilityVerdict).toBe("portable_diagnostic_sidecar_supported");
      expect(output.arbitration.sourceSupportSummary).toMatchObject({
        negativeFunctionBrierDeltaCount: 5,
        positiveFunctionCDeltaCount: 5,
        sourceCount: 5,
        supportiveSourceCount: 5,
        weakerSourceLabels: ["MIDUS_CORE_M2", "MIDUS_REFRESHER"],
      });
      expect(output.modelDirection.domainOrdering[0]).toEqual({
        domain: "function_disability",
        status: "lead_diagnostic_sidecar_candidate",
      });
      expect(output.nextLoops.map((loop) => loop.loopId)).toEqual([
        "mhas_anchor_increment_check",
        "nshap_activation_then_function_cognition",
        "r986_reviewgpt_model_direction_chorus",
        "compact_glycemia_body_future_validation",
      ]);
      expect(output.reviewGptPacket.readyForChorus).toBe(true);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("participantIds");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"rowValues\":");
      expect(persisted).not.toContain("\"sourceBodies\": true");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("holds the family when cross-source support is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r986-hold-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      await Promise.all([
        writeJson(paths.crelesFunctionPath, blockedFunctionFixture("creles_hold")),
        writeJson(paths.midusCoreFunctionPath, blockedFunctionFixture("midus_core_hold")),
        writeJson(paths.midusRefresherFunctionPath, blockedFunctionFixture("midus_refresher_hold")),
      ]);

      const { output } = await runR986CrossSourceFunctionArbitration({
        ...paths,
      });

      expect(output.arbitration.functionDisabilityVerdict).toBe("hold_pending_cross_source_support");
      expect(output.summary.verdict).toBe("function_disability_hold_pending_support");
      expect(output.arbitration.sourceSupportSummary.supportiveSourceCount).toBe(2);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r986-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r986-cross-source-function-arbitration.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R740_CRELES_FUNCTION_PATH: paths.crelesFunctionPath,
          MURPH_AGE_R746_MIDUS_CORE_FUNCTION_PATH: paths.midusCoreFunctionPath,
          MURPH_AGE_R738_MIDUS_REFRESHER_FUNCTION_PATH: paths.midusRefresherFunctionPath,
          MURPH_AGE_R770_NSHAP_COMBINED_PATH: paths.nshapCombinedPath,
          MURPH_AGE_R773_NSHAP_SINGLE_DOMAIN_PATH: paths.nshapSingleDomainPath,
          MURPH_AGE_R747_FUNCTION_FAMILY_PATH: paths.r747FunctionFamilyPath,
          MURPH_AGE_R980_MHAS_FUNCTION_PATH: paths.r980Path,
          MURPH_AGE_R983_CANDIDATE_STATE_PATH: paths.r983Path,
          MURPH_AGE_R984_REDUCTION_PATH: paths.r984ReductionPath,
          MURPH_AGE_R985_REDUCTION_PATH: paths.r985ReductionPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        artifact: "r986-cross-source-function-arbitration.latest.json",
        currentLeadFamily: "function_disability",
        nextLocalLoop: "mhas_anchor_increment_check",
        packetId: "r986-cross-source-function-arbitration",
        productDisplayAuthorized: false,
        schemaVersion: R986_CROSS_SOURCE_FUNCTION_ARBITRATION_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
        supportiveSourceCount: 5,
        verdict: "function_disability_portable_diagnostic_sidecar_supported",
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
  crelesFunctionPath: string;
  midusCoreFunctionPath: string;
  midusRefresherFunctionPath: string;
  nshapCombinedPath: string;
  nshapSingleDomainPath: string;
  outputDir: string;
  r747FunctionFamilyPath: string;
  r980Path: string;
  r983Path: string;
  r984ReductionPath: string;
  r985ReductionPath: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const paths = {
    crelesFunctionPath: path.join(fixtureDir, "r740-creles.json"),
    midusCoreFunctionPath: path.join(fixtureDir, "r746-midus-core.json"),
    midusRefresherFunctionPath: path.join(fixtureDir, "r738-midus-refresher.json"),
    nshapCombinedPath: path.join(fixtureDir, "r770-nshap-combined.json"),
    nshapSingleDomainPath: path.join(fixtureDir, "r773-nshap-single.json"),
    outputDir,
    r747FunctionFamilyPath: path.join(fixtureDir, "r747.json"),
    r980Path: path.join(fixtureDir, "r980.json"),
    r983Path: path.join(fixtureDir, "r983.json"),
    r984ReductionPath: path.join(fixtureDir, "r984.json"),
    r985ReductionPath: path.join(fixtureDir, "r985.json"),
  };
  await Promise.all([
    writeJson(paths.crelesFunctionPath, functionFixture("creles_concordant_supportive_diagnostic_only", 1, 1, 0.0399, -0.1489)),
    writeJson(
      paths.midusCoreFunctionPath,
      functionFixture("midus_core_m2_concordant_supportive_diagnostic_only", 0.85, 1, 0.0025, -0.0267),
    ),
    writeJson(
      paths.midusRefresherFunctionPath,
      functionFixture("midus_concordant_supportive_diagnostic_only", 0.75, 0.7, 0.0051, -0.0082),
    ),
    writeJson(paths.nshapCombinedPath, {
      schema_version: "test-r770",
      storage_attestation: safeStorageAttestation(),
      support_classification: "nshap_two_domain_additive_external_supportive_diagnostic_only",
    }),
    writeJson(paths.nshapSingleDomainPath, nshapSingleDomainFixture()),
    writeJson(paths.r747FunctionFamilyPath, {
      schema_version: "test-r747",
      status: "five_source_concordant_candidate_domain_ready_for_family_definition_and_comparison",
    }),
    writeJson(paths.r980Path, mhasFunctionFixture()),
    writeJson(paths.r983Path, {
      packetId: "r983-current-candidate-family-state",
      schemaVersion: "test-r983",
      candidateFamilies: {
        cognition: {
          status: "diagnostic_only_pending_nshap",
        },
      },
      summary: {
        currentLeadFamily: "function_disability",
      },
    }),
    writeJson(paths.r984ReductionPath, {
      schema_version: "test-r984",
      consensus: {
        first_loop: "mhas_function_disability",
      },
    }),
    writeJson(paths.r985ReductionPath, {
      schema_version: "test-r985",
      consensus: {
        top_run_now_loop: "cross_source_function_arbitration",
      },
    }),
  ]);
  return paths;
}

function mhasFunctionFixture(): Record<string, unknown> {
  return {
    packetId: "r980-mhas-function-disability-aggregate-reducer",
    schemaVersion: "test-r980",
    aggregateResult: {
      keyRates: {
        functionBrierBeatsAllShufflesRate: 1,
        functionBrierBeatsRawRate: 1,
        functionBrierBeatsShuffleMedianRate: 1,
        functionCBeatsAllShufflesRate: 0.9,
        functionCBeatsRawRate: 0.95,
        functionCBeatsShuffleMedianRate: 1,
      },
      medianDeltas: {
        functionMinusRawBrier: metric(-0.0416),
        functionMinusRawC: metric(0.00086),
        functionMinusShuffleMedianBrier: metric(-0.00066),
        functionMinusShuffleMedianC: metric(0.00091),
      },
      supportClassification: "mhas_concordant_supportive_diagnostic_only",
    },
  };
}

function nshapSingleDomainFixture(): Record<string, unknown> {
  return {
    delta_summaries: {
      function_minus_intercept_brier: metric(-0.00596),
      function_minus_intercept_c: metric(0.0337),
      function_minus_shuffle_median_brier: metric(-0.00604),
      function_minus_shuffle_median_c: metric(0.0344),
    },
    key_rates: {
      function_brier_beats_all_shuffles_rate: 1,
      function_brier_beats_intercept_rate: 1,
      function_brier_beats_shuffle_median_rate: 1,
      function_c_beats_all_shuffles_rate: 1,
      function_c_beats_intercept_rate: 1,
      function_c_beats_shuffle_median_rate: 1,
    },
    schema_version: "test-r773",
    storage_attestation: safeStorageAttestation(),
    support_classification: "nshap_both_single_domains_supportive",
  };
}

function functionFixture(
  supportClassification: string,
  cAllShuffles: number,
  brierAllShuffles: number,
  cMedian: number,
  brierMedian: number,
): Record<string, unknown> {
  return {
    delta_summaries: {
      function_minus_raw_brier: metric(brierMedian),
      function_minus_raw_c: metric(cMedian),
      function_minus_shuffle_median_brier: metric(-0.001),
      function_minus_shuffle_median_c: metric(0.001),
    },
    key_rates: {
      function_brier_beats_all_shuffles_rate: brierAllShuffles,
      function_brier_beats_raw_rate: 1,
      function_brier_beats_shuffle_median_rate: 1,
      function_c_beats_all_shuffles_rate: cAllShuffles,
      function_c_beats_raw_rate: 0.95,
      function_c_beats_shuffle_median_rate: 1,
    },
    schema_version: "test-function",
    storage_attestation: safeStorageAttestation(),
    support_classification: supportClassification,
  };
}

function blockedFunctionFixture(supportClassification: string): Record<string, unknown> {
  return {
    ...functionFixture(supportClassification, 0.1, 0.1, -0.01, 0.01),
    support_classification: supportClassification,
  };
}

function metric(median: number): Record<string, number> {
  return {
    max: median,
    median,
    min: median,
    p10: median,
    p90: median,
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

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
