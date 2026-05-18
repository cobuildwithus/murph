import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1013_BIOMARKER_SHADOW_LAYER_STATE_SCHEMA_VERSION,
  runR1013BiomarkerShadowLayerState,
} from "./r1013-biomarker-shadow-layer-state.ts";

describe("R1013 biomarker shadow layer state", () => {
  it("maps bloodwork/body into a shadow research layer without promotion or row egress", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1013-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR1013BiomarkerShadowLayerState({
        createdAt: "2026-05-13T12:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1013-biomarker-shadow-layer-state.latest.json");
      expect(output.schemaVersion).toBe(R1013_BIOMARKER_SHADOW_LAYER_STATE_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.summary).toEqual({
        conclusion: "biomarker_body_shadow_layer_mapped_not_promotable",
        nextLocalAction: "keep_biomarker_body_shadow_while_nshap_function_falsification_runs",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1013: false,
      });
      expect(output.biomarkerShadowState).toEqual({
        bestInternalCandidate: "r399-plus-compact-bloodwork-body-residual",
        bloodworkBodyStatus: "shadow_research_layer_not_promotable",
        broadLabsPolicy: "hold_or_kill_until_transport_confirmed",
        crelesSignal: "glycemia_shadow_supportive_body_not_confirmed",
        midusSignal: "weak_internal_signal_not_promotable",
        nhanesLayerRole: "lab_bp_body_research_context_only",
        transportStatus: "not_confirmed",
        wearableStatus: "hold_shadow_context_only",
      });
      expect(output.nextActions.map((action) => [action.actionId, action.status])).toEqual([
        ["keep_biomarker_body_as_shadow_layer", "runnable"],
        ["use_nhanes_only_as_same_family_lab_context", "runnable"],
        ["wait_for_fresh_nshap_function_cognition_before_biomarker_expansion", "runnable"],
        ["send_biomarker_transport_to_reviewgpt_only_after_new_aggregate_delta", "held"],
      ]);
      expect(output.productPolicy).toEqual({
        displayAuthorized: false,
        promotionAuthorized: false,
        productClaimsAuthorized: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain(".latest.json");
      expect(persisted).not.toContain(".dta");
      expect(persisted).not.toContain(".zip");
      expect(persisted).not.toContain(".rar");
      expect(persisted).not.toContain("ICPSR_");
      expect(persisted).not.toContain("field_names_private");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"rowValues\":");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("holds when aggregate biomarker context is absent", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1013-hold-"));
    try {
      const outputDir = path.join(tmp, "out");
      await mkdir(outputDir, { recursive: true });
      const missing = path.join(tmp, "missing.json");
      const { output } = await runR1013BiomarkerShadowLayerState({
        createdAt: "2026-05-13T12:00:00.000Z",
        crelesPath: missing,
        midusCorePath: missing,
        midusRefresherPath: missing,
        outputDir,
        r399Path: missing,
        r600Path: missing,
        r612Path: missing,
        r1012Path: missing,
        transportPath: missing,
      });

      expect(output.summary.conclusion).toBe("biomarker_body_shadow_layer_hold_missing_context");
      expect(output.biomarkerShadowState.bloodworkBodyStatus).toBe("hold_missing_aggregate_context");
      expect(output.nextActions[0]).toMatchObject({
        actionId: "keep_biomarker_body_as_shadow_layer",
        status: "held",
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe input boundaries", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1013-unsafe-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const unsafePath = path.join(tmp, "unsafe.json");
      await writeJson(unsafePath, {
        ...r600Fixture(),
        boundary: {
          ...safeBoundary(),
          sourceBodiesStored: true,
        },
      });

      await expect(runR1013BiomarkerShadowLayerState({
        ...paths,
        r600Path: unsafePath,
      })).rejects.toThrow("R1013 input r600AggregateResultsPacket failed aggregate boundary validation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1013-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1013-biomarker-shadow-layer-state.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_CRELES_BENCHMARK_PATH: paths.crelesPath,
          MURPH_AGE_MIDUS_CORE_BENCHMARK_PATH: paths.midusCorePath,
          MURPH_AGE_MIDUS_REFRESHER_BENCHMARK_PATH: paths.midusRefresherPath,
          MURPH_AGE_R399_LAYERING_READINESS_PATH: paths.r399Path,
          MURPH_AGE_R600_AGGREGATE_RESULTS_PACKET_PATH: paths.r600Path,
          MURPH_AGE_R612_NHANES_LAYERING_MAP_PATH: paths.r612Path,
          MURPH_AGE_R1012_CROSS_SOURCE_FUNCTION_PATH: paths.r1012Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
          MURPH_AGE_TRANSPORT_BENCHMARK_PATH: paths.transportPath,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        bloodworkBodyStatus: "shadow_research_layer_not_promotable",
        conclusion: "biomarker_body_shadow_layer_mapped_not_promotable",
        crelesSignal: "glycemia_shadow_supportive_body_not_confirmed",
        midusSignal: "weak_internal_signal_not_promotable",
        nextLocalAction: "keep_biomarker_body_shadow_while_nshap_function_falsification_runs",
        packetId: "r1013-biomarker-shadow-layer-state",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1013: false,
        schemaVersion: R1013_BIOMARKER_SHADOW_LAYER_STATE_SCHEMA_VERSION,
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
  midusCorePath: string;
  midusRefresherPath: string;
  outputDir: string;
  r399Path: string;
  r600Path: string;
  r612Path: string;
  r1012Path: string;
  transportPath: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const paths = {
    crelesPath: path.join(fixtureDir, "creles.json"),
    midusCorePath: path.join(fixtureDir, "midus-core.json"),
    midusRefresherPath: path.join(fixtureDir, "midus-refresher.json"),
    outputDir,
    r399Path: path.join(fixtureDir, "r399.json"),
    r600Path: path.join(fixtureDir, "r600.json"),
    r612Path: path.join(fixtureDir, "r612.json"),
    r1012Path: path.join(fixtureDir, "r1012.json"),
    transportPath: path.join(fixtureDir, "transport.json"),
  };
  await Promise.all([
    writeJson(paths.crelesPath, crelesFixture()),
    writeJson(paths.midusCorePath, minimalArtifactFixture("midus2-local-benchmark")),
    writeJson(paths.midusRefresherPath, minimalArtifactFixture("r399-midus-refresher-biomarker-increment")),
    writeJson(paths.r399Path, r399Fixture()),
    writeJson(paths.r600Path, r600Fixture()),
    writeJson(paths.r612Path, r612Fixture()),
    writeJson(paths.r1012Path, r1012Fixture()),
    writeJson(paths.transportPath, minimalArtifactFixture("midus2-creles-transport-benchmark")),
  ]);
  return paths;
}

function crelesFixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    models: {
      age_sex_reference: {
        metrics: {
          brier: 0.12,
          logLoss: 0.39,
        },
      },
      glycemia_only_no_crp: {
        metrics: {
          brier: 0.11,
          logLoss: 0.37,
        },
      },
    },
    packetId: "creles-local-benchmark",
    schemaVersion: "murph-age-creles-local-benchmark.v1",
    status: "research-local-aggregate-only",
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

function r600Fixture(): Record<string, unknown> {
  return {
    boundary: safeBoundary(),
    packetId: "r600-frozen-anchor-residual-increment-aggregate-results",
    schemaVersion: "murph-age-r600-aggregate-results-packet.v1",
    status: "research-local-aggregate-only",
    summary: {
      bestCurrentCandidate: "r399-plus-compact-bloodwork-body-residual",
      conclusion: "weak_internal_signal_not_promotable",
    },
  };
}

function r612Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r612-nhanes-layering-map",
    schemaVersion: "murph-age-r612-nhanes-layering-map.v1",
    status: "research-local-aggregate-only",
    summary: {
      scoreBearingResearchLayer: "lab_bp_body",
    },
  };
}

function r1012Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1012-cross-source-function-consistency",
    schemaVersion: "murph-age-r1012-cross-source-function-consistency.v1",
    status: "research-local-aggregate-only",
    summary: {
      nextLocalAction: "complete_nshap_source_confirmation_then_run_fresh_function_cognition",
    },
  };
}

function minimalArtifactFixture(packetId: string): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId,
    schemaVersion: `murph-age-${packetId}.v1`,
    status: "research-local-aggregate-only",
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
