import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1015_NEW_DATA_ACCELERATION_STATE_SCHEMA_VERSION,
  runR1015NewDataAccelerationState,
} from "./r1015-new-data-acceleration-state.ts";

describe("R1015 new data acceleration state", () => {
  it("turns the expanded source state into a concrete aggregate-only next batch", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1015-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR1015NewDataAccelerationState({
        createdAt: "2026-05-13T13:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1015-new-data-acceleration-state.latest.json");
      expect(output.schemaVersion).toBe(R1015_NEW_DATA_ACCELERATION_STATE_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.summary).toEqual({
        conclusion: "new_data_acceleration_ready_but_nshap_source_confirmation_blocks_fresh_rows",
        nextLocalAction: "run_mhas_now_while_completing_nshap_confirmation",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1015: false,
      });
      expect(output.newDataAcceleration).toEqual({
        biomarkerShadowReady: true,
        fastestCachedLane: "MHAS/Gateway MHAS",
        functionLeadSupported: true,
        reviewGptDirectionConsensus: "mhas_plus_nshap_parallel",
        reviewGptDirectionChorusSent: true,
        reviewGptMhasExecuteNowConsensus: true,
        reviewGptNshapActivateNextConsensus: true,
        reviewGptTrustedReviewerCount: 5,
        scoreBearingSourceCountBand: "1-4",
        sourceCoverageBuckets: {
          blocked_on_activation_or_confirmation: ["NSHAP rounds 1-3"],
          "context-only": ["SAGE South Africa", "NHANES"],
          ready_for_no_score_source_card: ["MHAS/Gateway MHAS"],
          "score-bearing_complete": ["MIDUS core/refresher", "CRELES waves"],
        },
      });
      expect(output.nextBatch.map((action) => [action.actionId, action.status, action.owner])).toEqual([
        ["complete_nshap_source_confirmation", "blocked", "human_user"],
        ["run_mhas_no_score_generalization_card_now", "runnable", "local_codex"],
        ["prepare_nshap_no_score_row_harness_after_confirmation", "blocked", "local_codex"],
        ["reuse_mhas_mh_source_evidence_without_retune", "runnable", "local_codex"],
        ["reuse_midus_creles_as_shadow_context", "runnable", "local_codex"],
        ["run_haalsi_sage_endpoint_feasibility_only", "held", "local_codex"],
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

  it("marks the NSHAP harness preparation runnable once source labels are confirmed", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1015-confirmed-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { nshapSourceLabelsComplete: true });
      const { output } = await runR1015NewDataAccelerationState({
        createdAt: "2026-05-13T13:00:00.000Z",
        ...paths,
      });

      expect(output.nextBatch[0]).toMatchObject({
        actionId: "complete_nshap_source_confirmation",
        blockedBy: [],
        status: "runnable",
      });
      expect(output.nextBatch[2]).toMatchObject({
        actionId: "prepare_nshap_no_score_row_harness_after_confirmation",
        blockedBy: [],
        status: "runnable",
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("holds when the expanded source map is absent", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1015-hold-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const missing = path.join(tmp, "missing.json");
      const { output } = await runR1015NewDataAccelerationState({
        createdAt: "2026-05-13T13:00:00.000Z",
        ...paths,
        r994Path: missing,
      });

      expect(output.summary.conclusion).toBe("new_data_acceleration_hold_missing_source_map");
      expect(output.summary.nextLocalAction).toBe("recover_source_acceleration_inputs");
      expect(output.newDataAcceleration.fastestCachedLane).toBeNull();
      expect(output.newDataAcceleration.sourceCoverageBuckets).toEqual({});
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe input boundaries", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1015-unsafe-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const unsafePath = path.join(tmp, "unsafe-r1013.json");
      await writeJson(unsafePath, {
        ...r1013Fixture(),
        artifactBoundary: {
          ...safeBoundary(),
          sourceBodiesStored: true,
        },
      });

      await expect(runR1015NewDataAccelerationState({
        ...paths,
        r1013Path: unsafePath,
      })).rejects.toThrow("R1015 input r1013BiomarkerShadowLayerState failed aggregate boundary validation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1015-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1015-new-data-acceleration-state.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R614_NSHAP_ACTIVATION_LABELS_PATH: paths.r614NshapPath,
          MURPH_AGE_R994_SOURCE_CACHE_READINESS_PATH: paths.r994Path,
          MURPH_AGE_R1012_CROSS_SOURCE_FUNCTION_PATH: paths.r1012Path,
          MURPH_AGE_R1013_BIOMARKER_SHADOW_STATE_PATH: paths.r1013Path,
          MURPH_AGE_R1014_REVIEWGPT_REDUCTION_PATH: paths.r1014ReductionPath,
          MURPH_AGE_R1014_REVIEWGPT_SEND_SUMMARY_PATH: paths.r1014SendSummaryPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        conclusion: "new_data_acceleration_ready_but_nshap_source_confirmation_blocks_fresh_rows",
        fastestCachedLane: "MHAS/Gateway MHAS",
        functionLeadSupported: true,
        nextLocalAction: "run_mhas_now_while_completing_nshap_confirmation",
        nshapActionStatus: "blocked",
        packetId: "r1015-new-data-acceleration-state",
        productDisplayAuthorized: false,
        reviewGptDirectionConsensus: "mhas_plus_nshap_parallel",
        reviewGptDirectionChorusSent: true,
        reviewGptTrustedReviewerCount: 5,
        rowParsingPerformedByR1015: false,
        schemaVersion: R1015_NEW_DATA_ACCELERATION_STATE_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain(".latest.json");
      expect(stdout).not.toContain("predictions");
      expect(stdout).not.toContain("ICPSR_");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(
  tmp: string,
  options: { nshapSourceLabelsComplete?: boolean } = {},
): Promise<{
  outputDir: string;
  r614NshapPath: string;
  r994Path: string;
  r1012Path: string;
  r1013Path: string;
  r1014ReductionPath: string;
  r1014SendSummaryPath: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const paths = {
    outputDir,
    r614NshapPath: path.join(fixtureDir, "r614-nshap.json"),
    r994Path: path.join(fixtureDir, "r994.json"),
    r1012Path: path.join(fixtureDir, "r1012.json"),
    r1013Path: path.join(fixtureDir, "r1013.json"),
    r1014ReductionPath: path.join(fixtureDir, "r1014-reduction.json"),
    r1014SendSummaryPath: path.join(fixtureDir, "r1014-send-summary.json"),
  };

  await Promise.all([
    writeJson(paths.r614NshapPath, r614NshapFixture(options.nshapSourceLabelsComplete === true)),
    writeJson(paths.r994Path, r994Fixture()),
    writeJson(paths.r1012Path, r1012Fixture()),
    writeJson(paths.r1013Path, r1013Fixture()),
    writeJson(paths.r1014ReductionPath, r1014ReductionFixture()),
    writeJson(paths.r1014SendSummaryPath, r1014SendSummaryFixture()),
  ]);

  return paths;
}

function r614NshapFixture(sourceLabelsComplete: boolean): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r614-nshap-activation-labels",
    schemaVersion: "murph-age-r614-nshap-activation-labels.v1",
    status: "research-local-aggregate-only",
    summary: {
      aggregateOutputsActive: sourceLabelsComplete,
      sourceRightsLabelsComplete: sourceLabelsComplete,
    },
  };
}

function r994Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    categoryBuckets: {
      blocked_on_activation_or_confirmation: ["NSHAP rounds 1-3"],
      "context-only": ["SAGE South Africa", "NHANES"],
      ready_for_no_score_source_card: ["MHAS/Gateway MHAS"],
      "score-bearing_complete": ["MIDUS core/refresher", "CRELES waves"],
    },
    packetId: "r994-expanded-source-cache-readiness",
    schemaVersion: "murph-age-r994-expanded-source-cache-readiness.v1",
    status: "research-local-aggregate-only",
    summary: {
      fastestLaneNow: "MHAS/Gateway MHAS",
      scoreBearingCompleteCountBand: "1-4",
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

function r1014SendSummaryFixture(): Record<string, unknown> {
  return {
    extended_pro_missing_count: 0,
    packet_id: "r1014-new-data-acceleration-direction-send",
    schema_version: "murph-age-reviewgpt-send-summary.v1",
    sent_count: 5,
  };
}

function r1014ReductionFixture(): Record<string, unknown> {
  return {
    aggregateCounts: {
      sourceFamilyCounts: {
        "MHAS/Gateway MHAS:execute_now": 5,
        "NSHAP:activate_next": 5,
      },
    },
    consensus: {
      decision: "mhas_plus_nshap_parallel",
    },
    counts: {
      trusted: 5,
    },
    outputMarker: "R1014_NEW_DATA_ACCELERATION_DIRECTION_JSON",
    queueCount: 5,
    requiredModel: "GPT-5.5 Extended Pro",
    schema_version: "murph-age-r1014-new-data-acceleration-direction-reduction.v1",
    status: "complete",
    storageAttestation: {
      participantIdsStored: false,
      predictionsOrCoefficientsStored: false,
      productClaimsAuthorized: false,
      rowValuesStored: false,
      sourceBodiesStored: false,
    },
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
