import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1017_EXPANDED_DATA_EXECUTION_STATE_SCHEMA_VERSION,
  runR1017ExpandedDataExecutionState,
} from "./r1017-expanded-data-execution-state.ts";

describe("R1017 expanded data execution state", () => {
  it("records the R1016 consensus and blocks fresh NSHAP until confirmation", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1017-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR1017ExpandedDataExecutionState({
        createdAt: "2026-05-13T16:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1017-expanded-data-execution-state.latest.json");
      expect(output.schemaVersion).toBe(R1017_EXPANDED_DATA_EXECUTION_STATE_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.summary).toEqual({
        conclusion: "mhas_function_batch_done_nshap_confirmation_blocks_fresh_falsification",
        nextLocalAction: "prepare_nshap_harness_only_after_source_confirmation",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1017: false,
      });
      expect(output.executionState).toEqual({
        biomarkerTransportConfirmed: false,
        functionLeadSupported: true,
        latestReviewGptDecision: "run_mhas_and_nshap_function_batch",
        latestReviewGptFirstLoop: "mhas_no_score_function_generalization",
        latestReviewGptTrustedCount: 5,
        mhasFunctionBatchState: "complete_supportive_research_only",
        nhanesRole: "feature_contracts_same_family_sanity_only",
        nshapAggregateOutputsActive: false,
        nshapFreshHarnessState: "blocked_source_confirmation",
        nshapSourceRightsLabelsComplete: false,
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        wearableIncrementValidated: false,
      });
      expect(output.nextBatch.map((action) => [action.actionId, action.status, action.owner])).toEqual([
        ["complete_nshap_source_confirmation", "blocked", "human_user"],
        ["prepare_nshap_fresh_function_cognition_harness_after_confirmation", "blocked", "local_codex"],
        ["keep_mhas_function_sidecar_as_current_research_lead", "runnable", "local_codex"],
        ["reuse_nhanes_midus_creles_shadow_context_without_retune", "runnable", "local_codex"],
        ["use_reviewgpt_only_after_meaningful_aggregate_delta", "runnable", "reviewgpt"],
      ]);
      expect(output.nextBatch[0]?.blockedBy).toEqual([
        "source_rights_labels_incomplete",
        "aggregate_output_permission_inactive",
        "terms_endpoint_wave_linkage_or_biomarker_overlap_unconfirmed",
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

  it("marks the fresh NSHAP harness runnable once confirmation labels are active", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1017-confirmed-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { nshapSourceLabelsComplete: true });
      const { output } = await runR1017ExpandedDataExecutionState({
        createdAt: "2026-05-13T16:00:00.000Z",
        ...paths,
      });

      expect(output.executionState.nshapFreshHarnessState).toBe("ready_after_confirmation_no_scoring");
      expect(output.executionState.nshapSourceRightsLabelsComplete).toBe(true);
      expect(output.executionState.nshapAggregateOutputsActive).toBe(true);
      expect(output.nextBatch[0]).toMatchObject({
        actionId: "complete_nshap_source_confirmation",
        blockedBy: [],
        status: "runnable",
      });
      expect(output.nextBatch[1]).toMatchObject({
        actionId: "prepare_nshap_fresh_function_cognition_harness_after_confirmation",
        blockedBy: [],
        status: "runnable",
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("holds when the R1016 chorus or MHAS evidence is incomplete", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1017-hold-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, {
        reviewGptTrustedCount: 4,
      });
      const { output } = await runR1017ExpandedDataExecutionState({
        createdAt: "2026-05-13T16:00:00.000Z",
        ...paths,
      });

      expect(output.summary.conclusion).toBe("execution_state_incomplete_recover_inputs");
      expect(output.summary.nextLocalAction).toBe("recover_execution_state_inputs");
      expect(output.executionState.mhasFunctionBatchState).toBe("incomplete_or_not_supportive");
      expect(output.nextBatch[2]).toMatchObject({
        actionId: "keep_mhas_function_sidecar_as_current_research_lead",
        blockedBy: ["mhas_function_support_or_reviewgpt_consensus_missing"],
        status: "blocked",
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe input boundaries", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1017-unsafe-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const unsafePath = path.join(tmp, "unsafe-r1015.json");
      await writeJson(unsafePath, {
        ...r1015Fixture(),
        artifactBoundary: {
          ...safeBoundary(),
          sourceBodiesStored: true,
        },
      });

      await expect(runR1017ExpandedDataExecutionState({
        ...paths,
        r1015Path: unsafePath,
      })).rejects.toThrow("R1017 input r1015NewDataAccelerationState failed aggregate boundary validation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1017-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1017-expanded-data-execution-state.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R399_LAYERING_READINESS_PATH: paths.r399Path,
          MURPH_AGE_R614_NSHAP_ACTIVATION_LABELS_PATH: paths.r614NshapPath,
          MURPH_AGE_R1005_MHAS_SOURCE_CARD_PATH: paths.r1005Path,
          MURPH_AGE_R1009_MHAS_FUNCTION_RESULT_PATH: paths.r1009Path,
          MURPH_AGE_R1012_CROSS_SOURCE_FUNCTION_PATH: paths.r1012Path,
          MURPH_AGE_R1015_NEW_DATA_ACCELERATION_STATE_PATH: paths.r1015Path,
          MURPH_AGE_R1016_REVIEWGPT_REDUCTION_PATH: paths.r1016ReductionPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        conclusion: "mhas_function_batch_done_nshap_confirmation_blocks_fresh_falsification",
        functionLeadSupported: true,
        latestReviewGptDecision: "run_mhas_and_nshap_function_batch",
        latestReviewGptTrustedCount: 5,
        mhasFunctionBatchState: "complete_supportive_research_only",
        nextLocalAction: "prepare_nshap_harness_only_after_source_confirmation",
        nshapFreshHarnessState: "blocked_source_confirmation",
        packetId: "r1017-expanded-data-execution-state",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1017: false,
        schemaVersion: R1017_EXPANDED_DATA_EXECUTION_STATE_SCHEMA_VERSION,
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
  options: {
    nshapSourceLabelsComplete?: boolean;
    reviewGptTrustedCount?: number;
  } = {},
): Promise<{
  outputDir: string;
  r399Path: string;
  r614NshapPath: string;
  r1005Path: string;
  r1009Path: string;
  r1012Path: string;
  r1015Path: string;
  r1016ReductionPath: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const paths = {
    outputDir,
    r399Path: path.join(fixtureDir, "r399.json"),
    r614NshapPath: path.join(fixtureDir, "r614-nshap.json"),
    r1005Path: path.join(fixtureDir, "r1005.json"),
    r1009Path: path.join(fixtureDir, "r1009.json"),
    r1012Path: path.join(fixtureDir, "r1012.json"),
    r1015Path: path.join(fixtureDir, "r1015.json"),
    r1016ReductionPath: path.join(fixtureDir, "r1016-reduction.json"),
  };

  await Promise.all([
    writeJson(paths.r399Path, r399Fixture()),
    writeJson(paths.r614NshapPath, r614NshapFixture(options.nshapSourceLabelsComplete === true)),
    writeJson(paths.r1005Path, r1005Fixture()),
    writeJson(paths.r1009Path, r1009Fixture()),
    writeJson(paths.r1012Path, r1012Fixture()),
    writeJson(paths.r1015Path, r1015Fixture()),
    writeJson(paths.r1016ReductionPath, r1016ReductionFixture(options.reviewGptTrustedCount ?? 5)),
  ]);

  return paths;
}

function r399Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    gates: {
      biomarkerTransportConfirmed: {
        status: "blocked",
      },
      wearableIncrementValidated: {
        status: "blocked",
      },
    },
    packetId: "r399-layering-readiness",
    schemaVersion: "murph-age-r399-layering-readiness.v1",
    status: "research-local-aggregate-only",
  };
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

function r1005Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1005-mhas-panel-source-card",
    schemaVersion: "murph-age-r1005-mhas-panel-source-card.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "mhas_panel_source_card_ready_research_only",
    },
  };
}

function r1009Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1009-mhas-function-panel-extension-result",
    schemaVersion: "murph-age-r1009-mhas-function-panel-extension-result.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "mhas_function_panel_extension_supports_lead_sidecar",
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

function r1015Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1015-new-data-acceleration-state",
    schemaVersion: "murph-age-r1015-new-data-acceleration-state.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "new_data_acceleration_ready_but_nshap_source_confirmation_blocks_fresh_rows",
    },
  };
}

function r1016ReductionFixture(trustedCount: number): Record<string, unknown> {
  return {
    aggregateCounts: {
      firstLoopCounts: {
        mhas_no_score_function_generalization: trustedCount,
      },
    },
    consensus: {
      decision: "run_mhas_and_nshap_function_batch",
      first_loop: "mhas_no_score_function_generalization",
    },
    counts: {
      trusted: trustedCount,
    },
    outputMarker: "R1016_EXPANDED_DATA_EXECUTION_BATCH_JSON",
    queueCount: 5,
    requiredModel: "GPT-5.5 Extended Pro",
    schema_version: "murph-age-r1016-expanded-data-execution-batch-reduction.v1",
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
