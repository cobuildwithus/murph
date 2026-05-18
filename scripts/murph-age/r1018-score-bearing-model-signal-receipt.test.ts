import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1018_SCORE_BEARING_MODEL_SIGNAL_RECEIPT_SCHEMA_VERSION,
  runR1018ScoreBearingModelSignalReceipt,
} from "./r1018-score-bearing-model-signal-receipt.ts";

describe("R1018 score-bearing model signal receipt", () => {
  it("reduces refreshed score-bearing loops into a proposal-only signal state", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1018-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR1018ScoreBearingModelSignalReceipt({
        createdAt: "2026-05-13T18:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1018-score-bearing-model-signal-receipt.latest.json");
      expect(output.schemaVersion).toBe(R1018_SCORE_BEARING_MODEL_SIGNAL_RECEIPT_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.summary).toEqual({
        conclusion: "function_lead_glycemia_shadow_broad_labs_hold",
        nextLocalAction: "build_fresh_nshap_harness_after_confirmation_else_continue_mhas_function",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1018: false,
      });
      expect(output.modelSignalState).toMatchObject({
        bloodworkBodyPolicy: "shadow_research_not_promotable",
        broadLabPolicy: "deprioritize_until_transport_confirmed",
        functionSidecarStatus: "lead_diagnostic_supported_pending_fresh_nshap",
        nextProposalBatch: "function_lead_with_glycemia_shadow_no_product",
        nshapFreshHarnessState: "blocked_source_confirmation",
        productDisplayAuthorized: false,
        reviewGptNextUse: "meaningful_aggregate_delta_or_model_family_fork_only",
        wearablePolicy: "shadow_only_no_score_bearing_increment",
      });
      expect(output.modelSignalState.midusBestSignal).toMatchObject({
        candidateId: "clinical_core_labs_no_albumin_no_crp",
        signalVerdict: "supportive_internal_only",
      });
      expect(output.modelSignalState.midusBestSignal.metricDeltaVsReference).toEqual({
        aucDelta: 0.005,
        brierDelta: -0.0012,
        logLossDelta: -0.002,
      });
      expect(output.modelSignalState.crelesBestSignal).toMatchObject({
        candidateId: "glycemia_body_no_crp",
        signalVerdict: "supportive_shadow_external_validation_only",
      });
      expect(output.modelSignalState.crelesBestSignal.metricDeltaVsReference).toEqual({
        aucDelta: 0.006,
        brierDelta: -0.0016,
        logLossDelta: -0.0044,
      });
      expect(output.modelSignalState.transportSignal).toEqual({
        metricDeltaVsTargetReference: {
          aucDelta: -0.003,
          brierDelta: 0.0004,
          logLossDelta: 0.0017,
        },
        status: "not_confirmed",
      });
      expect(output.nextActions.map((action) => [action.actionId, action.status, action.owner])).toEqual([
        ["keep_function_disability_as_research_lead", "runnable", "local_codex"],
        ["carry_compact_glycemia_as_shadow_external_validation_candidate", "runnable", "local_codex"],
        ["hold_broad_bloodwork_expansion", "held", "local_codex"],
        ["build_fresh_nshap_function_cognition_harness_after_confirmation", "blocked", "local_codex"],
        ["send_to_reviewgpt_after_new_aggregate_delta", "held", "reviewgpt"],
      ]);
      expect(output.productPolicy).toEqual({
        displayAuthorized: false,
        productClaimsAuthorized: false,
        promotionAuthorized: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain(".latest.json");
      expect(persisted).not.toContain(".dta");
      expect(persisted).not.toContain(".zip");
      expect(persisted).not.toContain(".rar");
      expect(persisted).not.toContain("ICPSR_");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"rowValues\":");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("holds when score-bearing source inputs are missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1018-hold-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const missing = path.join(tmp, "missing.json");
      const { output } = await runR1018ScoreBearingModelSignalReceipt({
        createdAt: "2026-05-13T18:00:00.000Z",
        ...paths,
        midus2Path: missing,
      });

      expect(output.summary.conclusion).toBe("score_bearing_signal_inputs_missing");
      expect(output.summary.nextLocalAction).toBe("recover_score_bearing_signal_inputs");
      expect(output.modelSignalState.midusBestSignal.signalVerdict).toBe("missing");
      expect(output.modelSignalState.nextProposalBatch).toBe("recover_missing_score_bearing_inputs");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe input boundaries", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1018-unsafe-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const unsafePath = path.join(tmp, "unsafe-r1013.json");
      await writeJson(unsafePath, {
        ...r1013Fixture(),
        artifactBoundary: {
          ...safeBoundary(),
          rowValuesStored: true,
        },
      });

      await expect(runR1018ScoreBearingModelSignalReceipt({
        ...paths,
        r1013Path: unsafePath,
      })).rejects.toThrow("R1018 input r1013BiomarkerShadowLayerState failed aggregate boundary validation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1018-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1018-score-bearing-model-signal-receipt.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_CRELES_BENCHMARK_PATH: paths.crelesPath,
          MURPH_AGE_MIDUS2_BENCHMARK_PATH: paths.midus2Path,
          MURPH_AGE_R399_LAYERING_READINESS_PATH: paths.r399Path,
          MURPH_AGE_R600_AGGREGATE_RESULTS_PACKET_PATH: paths.r600Path,
          MURPH_AGE_R987_CRELES_GLYCEMIA_RECEIPT_PATH: paths.r987Path,
          MURPH_AGE_R1012_CROSS_SOURCE_FUNCTION_PATH: paths.r1012Path,
          MURPH_AGE_R1013_BIOMARKER_SHADOW_STATE_PATH: paths.r1013Path,
          MURPH_AGE_R1017_EXPANDED_DATA_EXECUTION_STATE_PATH: paths.r1017Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
          MURPH_AGE_TRANSPORT_BENCHMARK_PATH: paths.transportPath,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        broadLabPolicy: "deprioritize_until_transport_confirmed",
        conclusion: "function_lead_glycemia_shadow_broad_labs_hold",
        crelesBestCandidate: "glycemia_body_no_crp",
        functionSidecarStatus: "lead_diagnostic_supported_pending_fresh_nshap",
        midusBestCandidate: "clinical_core_labs_no_albumin_no_crp",
        nextLocalAction: "build_fresh_nshap_harness_after_confirmation_else_continue_mhas_function",
        nextProposalBatch: "function_lead_with_glycemia_shadow_no_product",
        packetId: "r1018-score-bearing-model-signal-receipt",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1018: false,
        schemaVersion: R1018_SCORE_BEARING_MODEL_SIGNAL_RECEIPT_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
        transportStatus: "not_confirmed",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain(".latest.json");
      expect(stdout).not.toContain("predictions");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(tmp: string): Promise<{
  crelesPath: string;
  midus2Path: string;
  outputDir: string;
  r399Path: string;
  r600Path: string;
  r987Path: string;
  r1012Path: string;
  r1013Path: string;
  r1017Path: string;
  transportPath: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const paths = {
    crelesPath: path.join(fixtureDir, "creles.json"),
    midus2Path: path.join(fixtureDir, "midus2.json"),
    outputDir,
    r399Path: path.join(fixtureDir, "r399.json"),
    r600Path: path.join(fixtureDir, "r600.json"),
    r987Path: path.join(fixtureDir, "r987.json"),
    r1012Path: path.join(fixtureDir, "r1012.json"),
    r1013Path: path.join(fixtureDir, "r1013.json"),
    r1017Path: path.join(fixtureDir, "r1017.json"),
    transportPath: path.join(fixtureDir, "transport.json"),
  };
  await Promise.all([
    writeJson(paths.crelesPath, localBenchmarkFixture({
      age_sex_reference: metrics(0.75, 0.13, 0.412),
      glycemia_body_no_crp: metrics(0.756, 0.1284, 0.4076),
      glycemia_only_no_crp: metrics(0.754, 0.1287, 0.408),
      lab5_lipid_body_no_crp: metrics(0.74, 0.132, 0.42),
    })),
    writeJson(paths.midus2Path, localBenchmarkFixture({
      age_sex_reference: metrics(0.83, 0.0633, 0.2258),
      clinical_core_labs_no_albumin_no_crp: metrics(0.835, 0.0621, 0.2238),
      glycemia_body_no_crp: metrics(0.832, 0.0628, 0.2245),
      glycemia_only_no_crp: metrics(0.831, 0.0629, 0.2248),
      lab5_lipid_body_no_crp: metrics(0.834, 0.0624, 0.224),
    })),
    writeJson(paths.r399Path, r399Fixture()),
    writeJson(paths.r600Path, aggregateFixture("r600-frozen-anchor-residual-increment-aggregate-results")),
    writeJson(paths.r987Path, aggregateFixture("r987-creles-glycemia-receipt-reducer")),
    writeJson(paths.r1012Path, r1012Fixture()),
    writeJson(paths.r1013Path, r1013Fixture()),
    writeJson(paths.r1017Path, r1017Fixture()),
    writeJson(paths.transportPath, transportFixture()),
  ]);
  return paths;
}

function localBenchmarkFixture(models: Record<string, Record<string, unknown>>): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    models: Object.fromEntries(Object.entries(models).map(([id, test]) => [
      id,
      {
        splitMetrics: {
          test,
        },
      },
    ])),
    packetId: "local-benchmark-fixture",
    schemaVersion: "murph-age-local-benchmark-fixture.v1",
    status: "research-local-aggregate-only",
  };
}

function transportFixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "midus2-creles-transport-benchmark",
    schemaVersion: "murph-age-midus2-creles-transport-benchmark.v1",
    status: "research-local-aggregate-only",
    transportModels: {
      creles_age_sex_reference: {
        splitMetrics: {
          test: metrics(0.753, 0.1364, 0.4341),
        },
      },
      midus2_lab5_source_creles_recalibrated: {
        splitMetrics: {
          test: metrics(0.75, 0.1368, 0.4358),
        },
      },
    },
  };
}

function r399Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    gates: {
      biomarkerTransportConfirmed: {
        status: "blocked",
      },
    },
    packetId: "r399-layering-readiness",
    schemaVersion: "murph-age-r399-layering-readiness.v1",
    status: "research-local-aggregate-only",
  };
}

function r1012Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1012-cross-source-function-consistency",
    schemaVersion: "murph-age-r1012-cross-source-function-consistency.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "function_disability_lead_sidecar_supported_pending_fresh_nshap",
    },
  };
}

function r1013Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1013-biomarker-shadow-layer-state",
    schemaVersion: "murph-age-r1013-biomarker-shadow-layer-state.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "biomarker_body_shadow_layer_mapped_not_promotable",
    },
  };
}

function r1017Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    executionState: {
      nshapFreshHarnessState: "blocked_source_confirmation",
    },
    packetId: "r1017-expanded-data-execution-state",
    schemaVersion: "murph-age-r1017-expanded-data-execution-state.v1",
    status: "research-local-aggregate-only",
  };
}

function aggregateFixture(packetId: string): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId,
    schemaVersion: `${packetId}.v1`,
    status: "research-local-aggregate-only",
  };
}

function metrics(auc: number, brier: number, logLoss: number): Record<string, unknown> {
  return {
    auc,
    brier,
    logLoss,
    meanPrediction: 0.2,
    observedRate: 0.2,
  };
}

function safeBoundary(): Record<string, unknown> {
  return {
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
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
