import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R995_SIDECAR_EVIDENCE_ARBITRATION_SCHEMA_VERSION,
  runR995SidecarEvidenceArbitration,
} from "./r995-sidecar-evidence-arbitration.ts";

describe("R995 sidecar evidence arbitration", () => {
  it("selects function/disability for the next cached NSHAP falsification loop", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r995-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR995SidecarEvidenceArbitration({
        createdAt: "2026-05-13T00:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r995-sidecar-evidence-arbitration.latest.json");
      expect(output.schemaVersion).toBe(R995_SIDECAR_EVIDENCE_ARBITRATION_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.summary).toEqual({
        nextCandidateFamily: "function_disability",
        nextLoop: "cached_nshap_function_cognition_falsification",
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        recommendation: "run_cached_nshap_function_cognition_falsification_for_function_disability",
      });
      expect(output.evidenceState).toEqual({
        crelesMidusBenchmarkEvidence: "available",
        mhasAnchorIncrement: "supportive",
        mhasDeepDiagnostic: "supportive",
        nshapFunctionCognition: "supportive_available",
        r983LeadFamily: "function_disability",
        r986Verdict: "function_supported",
        r987GlycemiaBody: "keep_future_validation",
      });
      expect(output.arbitration.nextFamily).toMatchObject({
        candidateFamily: "function_disability",
        decision: "optimize_or_falsify_next",
        priority: "p0_now",
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
      });
      expect(output.arbitration.minimalNextLoop).toMatchObject({
        loopId: "cached_nshap_function_cognition_falsification",
        runnableNow: true,
        scope: "aggregate_only_cached_sidecar_loop",
      });
      expect(output.arbitration.heldFamilies.map((family) => family.candidateFamily)).toEqual([
        "glycemia_body",
        "nshap_cognition",
        "nhanes_lab_bp_body",
        "wearables_sleep_activity",
      ]);
      expect(output.artifactBoundary).toMatchObject({
        aggregateOnly: true,
        modelPromotionAuthorized: false,
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        rowParsingPerformedByR995: false,
      });
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

  it("falls back to the MHAS diagnostic when the deep diagnostic is not supportive", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r995-hold-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      await writeJson(paths.r991Path, {
        ...r991Fixture(),
        summary: {
          productDisplayAuthorized: false,
          verdict: "function_disability_deep_diagnostic_not_confirmed",
        },
      });

      const { output } = await runR995SidecarEvidenceArbitration({
        ...paths,
      });

      expect(output.summary).toMatchObject({
        nextCandidateFamily: "candidate_state_recovery",
        nextLoop: "mhas_deep_diagnostic_before_external_falsification",
        recommendation: "finish_mhas_anchor_diagnostics_before_external_falsification",
      });
      expect(output.arbitration.minimalNextLoop.runnableNow).toBe(false);
      expect(output.arbitration.nextFamily.candidateFamily).toBe("candidate_state_recovery");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r995-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r995-sidecar-evidence-arbitration.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_CRELES_LOCAL_BENCHMARK_PATH: paths.crelesLocalBenchmarkPath,
          MURPH_AGE_MIDUS2_CRELES_TRANSPORT_BENCHMARK_PATH: paths.midus2CrelesTransportBenchmarkPath,
          MURPH_AGE_MIDUS2_LOCAL_BENCHMARK_PATH: paths.midus2LocalBenchmarkPath,
          MURPH_AGE_R770_NSHAP_COMBINED_PATH: paths.nshapCombinedPath,
          MURPH_AGE_R773_NSHAP_SINGLE_DOMAIN_PATH: paths.nshapSingleDomainPath,
          MURPH_AGE_R983_CANDIDATE_STATE_PATH: paths.r983Path,
          MURPH_AGE_R986_FUNCTION_ARBITRATION_PATH: paths.r986Path,
          MURPH_AGE_R987_GLYCEMIA_RECEIPT_PATH: paths.r987Path,
          MURPH_AGE_R988_MHAS_INCREMENT_PATH: paths.r988Path,
          MURPH_AGE_R991_MHAS_DEEP_DIAGNOSTIC_PATH: paths.r991Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        artifact: "r995-sidecar-evidence-arbitration.latest.json",
        nextCandidateFamily: "function_disability",
        nextLoop: "cached_nshap_function_cognition_falsification",
        packetId: "r995-sidecar-evidence-arbitration",
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        recommendation: "run_cached_nshap_function_cognition_falsification_for_function_disability",
        schemaVersion: R995_SIDECAR_EVIDENCE_ARBITRATION_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
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
  crelesLocalBenchmarkPath: string;
  midus2CrelesTransportBenchmarkPath: string;
  midus2LocalBenchmarkPath: string;
  nshapCombinedPath: string;
  nshapSingleDomainPath: string;
  outputDir: string;
  r983Path: string;
  r986Path: string;
  r987Path: string;
  r988Path: string;
  r991Path: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const paths = {
    crelesLocalBenchmarkPath: path.join(fixtureDir, "creles-local.json"),
    midus2CrelesTransportBenchmarkPath: path.join(fixtureDir, "midus2-creles.json"),
    midus2LocalBenchmarkPath: path.join(fixtureDir, "midus2-local.json"),
    nshapCombinedPath: path.join(fixtureDir, "r770.json"),
    nshapSingleDomainPath: path.join(fixtureDir, "r773.json"),
    outputDir,
    r983Path: path.join(fixtureDir, "r983.json"),
    r986Path: path.join(fixtureDir, "r986.json"),
    r987Path: path.join(fixtureDir, "r987.json"),
    r988Path: path.join(fixtureDir, "r988.json"),
    r991Path: path.join(fixtureDir, "r991.json"),
  };
  await Promise.all([
    writeJson(paths.crelesLocalBenchmarkPath, benchmarkFixture("creles-local-benchmark")),
    writeJson(paths.midus2CrelesTransportBenchmarkPath, benchmarkFixture("midus2-creles-transport-benchmark")),
    writeJson(paths.midus2LocalBenchmarkPath, benchmarkFixture("midus2-local-benchmark")),
    writeJson(paths.nshapCombinedPath, {
      run_id: "session_murph_age_r770_nshap_function_cognition_external_repeat",
      schema_version: "murph.age.r770.nshap_function_cognition_external_repeat.v0",
      storage_attestation: safeStorageAttestation(),
      support_classification: "nshap_two_domain_additive_external_supportive_diagnostic_only",
    }),
    writeJson(paths.nshapSingleDomainPath, {
      run_id: "session_murph_age_r773_nshap_single_domain_breakdown",
      schema_version: "murph.age.r773.nshap_single_domain_breakdown.v0",
      storage_attestation: safeStorageAttestation(),
      support_classification: "nshap_both_single_domains_supportive",
    }),
    writeJson(paths.r983Path, r983Fixture()),
    writeJson(paths.r986Path, r986Fixture()),
    writeJson(paths.r987Path, r987Fixture()),
    writeJson(paths.r988Path, r988Fixture()),
    writeJson(paths.r991Path, r991Fixture()),
  ]);
  return paths;
}

function benchmarkFixture(benchmarkId: string): Record<string, unknown> {
  return {
    benchmarkId,
    codebookTextStored: false,
    coefficientsStored: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    rowValuesStored: false,
    schemaVersion: "test-benchmark",
    sourceBodiesStored: false,
    splitMembershipStored: false,
    status: "research-local-aggregate-only",
  };
}

function r983Fixture(): Record<string, unknown> {
  return {
    packetId: "r983-current-candidate-family-state",
    schemaVersion: "test-r983",
    status: "research-local-aggregate-only",
    summary: {
      currentLeadFamily: "function_disability",
      productDisplayAuthorized: false,
    },
  };
}

function r986Fixture(): Record<string, unknown> {
  return {
    packetId: "r986-cross-source-function-arbitration",
    schemaVersion: "test-r986",
    status: "research-local-aggregate-only",
    summary: {
      currentLeadFamily: "function_disability",
      productDisplayAuthorized: false,
      verdict: "function_disability_portable_diagnostic_sidecar_supported",
    },
  };
}

function r987Fixture(): Record<string, unknown> {
  return {
    packetId: "r987-creles-glycemia-receipt-reducer",
    schemaVersion: "test-r987",
    status: "research-local-aggregate-only",
    summary: {
      keyArtifactVerdict: "keep_tiny_glycemia_only_and_glycemia_body_for_future_external_validation",
      productPromotionAuthorized: false,
      rowParsingPerformedByReducer: false,
    },
  };
}

function r988Fixture(): Record<string, unknown> {
  return {
    packetId: "r988-mhas-anchor-function-increment-check",
    schemaVersion: "test-r988",
    status: "research-local-aggregate-only",
    summary: {
      productDisplayAuthorized: false,
      rowParsingPerformedByReducer: false,
      verdict: "mhas_function_adds_small_increment_over_frozen_anchor",
    },
  };
}

function r991Fixture(): Record<string, unknown> {
  return {
    packetId: "r991-mhas-deep-diagnostic-reducer",
    schemaVersion: "test-r991",
    status: "research-local-aggregate-only",
    summary: {
      productDisplayAuthorized: false,
      verdict: "function_disability_survives_age_residualized_deep_diagnostic",
    },
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
