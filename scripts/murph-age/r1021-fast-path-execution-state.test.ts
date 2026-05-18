import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1021_FAST_PATH_EXECUTION_STATE_SCHEMA_VERSION,
  runR1021FastPathExecutionState,
} from "./r1021-fast-path-execution-state.ts";

describe("R1021 fast-path execution state", () => {
  it("persists MHAS refreshed plus NSHAP activation-next state", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1021-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR1021FastPathExecutionState({
        createdAt: "2026-05-13T22:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1021-fast-path-execution-state.latest.json");
      expect(output.schemaVersion).toBe(R1021_FAST_PATH_EXECUTION_STATE_SCHEMA_VERSION);
      expect(output.summary).toEqual({
        conclusion: "mhas_refreshed_nshap_activation_next",
        nextLocalAction: "build_bounded_nshap_harness_after_activation_else_keep_mhas_receipts_fresh",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1021: false,
      });
      expect(output.executionState).toMatchObject({
        broadLabsPolicy: "hold",
        compactGlycemiaPolicy: "shadow_only",
        functionDisabilityPolicy: "lead_diagnostic_research",
        mhasFastPathState: "refreshed_supportive_research_only",
        nextExecutableLocalLoop: "mhas_function_receipts_refreshed_waiting_on_nshap_activation",
        nshapState: "metadata_ready_activation_labels_block_rows",
        reviewGptOperatingMode: "big_science_architecture_only",
        wearablePolicy: "hold_shadow_only",
      });
      expect(output.reviewGptConsensus).toEqual({
        r1014Decision: "mhas_plus_nshap_parallel",
        r1014TrustedCount: 5,
        r1016Decision: "run_mhas_and_nshap_function_batch",
        r1016FirstLoop: "mhas_no_score_function_generalization",
        r1016TrustedCount: 5,
        r1019Decision: "keep_function_lead_glycemia_shadow",
        r1019NextLoop: "fresh_function_falsification_with_glycemia_shadow",
        r1019TrustedCount: 3,
      });
      expect(output.nextActions.map((action) => [action.actionId, action.status, action.owner])).toEqual([
        ["keep_mhas_function_receipts_fresh", "completed", "local_codex"],
        ["complete_nshap_activation_labels", "blocked", "human_user"],
        ["build_bounded_nshap_function_cognition_harness_after_activation", "blocked", "local_codex"],
        ["carry_compact_glycemia_shadow", "runnable", "local_codex"],
        ["hold_broad_labs_and_wearables", "held", "local_codex"],
        ["send_reviewgpt_only_after_fresh_aggregate_delta", "held", "reviewgpt"],
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain(".latest.json");
      expect(persisted).not.toContain(".dta");
      expect(persisted).not.toContain(".zip");
      expect(persisted).not.toContain(".rar");
      expect(persisted).not.toContain("ICPSR_");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"rowValues\":");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("unblocks the bounded NSHAP harness action when activation labels are complete", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1021-nshap-ready-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { nshapReady: true });
      const { output } = await runR1021FastPathExecutionState({
        createdAt: "2026-05-13T22:00:00.000Z",
        ...paths,
      });

      expect(output.executionState.nshapState).toBe("activation_labels_complete_harness_design_ready_no_scoring");
      expect(output.executionState.nextExecutableLocalLoop).toBe("bounded_nshap_function_cognition_after_activation");
      expect(output.nextActions[1]).toMatchObject({ status: "completed", blockedBy: [] });
      expect(output.nextActions[2]).toMatchObject({ status: "runnable", blockedBy: [] });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("holds when the ReviewGPT fast-path consensus is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1021-missing-consensus-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { r1019TrustedCount: 1 });
      const { output } = await runR1021FastPathExecutionState({
        createdAt: "2026-05-13T22:00:00.000Z",
        ...paths,
      });

      expect(output.summary.conclusion).toBe("fast_path_inputs_missing_or_not_supportive");
      expect(output.summary.nextLocalAction).toBe("recover_fast_path_inputs");
      expect(output.executionState.nextExecutableLocalLoop).toBe("recover_missing_fast_path_inputs");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe input boundaries", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1021-unsafe-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const unsafePath = path.join(tmp, "unsafe-r1018.json");
      await writeJson(unsafePath, {
        ...r1018Fixture(),
        artifactBoundary: {
          ...safeBoundary(),
          predictionsStored: true,
        },
      });

      await expect(runR1021FastPathExecutionState({
        ...paths,
        r1018Path: unsafePath,
      })).rejects.toThrow("R1021 input r1018ScoreBearingSignal failed aggregate boundary validation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1021-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1021-fast-path-execution-state.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        conclusion: "mhas_refreshed_nshap_activation_next",
        mhasFastPathState: "refreshed_supportive_research_only",
        nextExecutableLocalLoop: "mhas_function_receipts_refreshed_waiting_on_nshap_activation",
        nextLocalAction: "build_bounded_nshap_harness_after_activation_else_keep_mhas_receipts_fresh",
        nshapState: "metadata_ready_activation_labels_block_rows",
        packetId: "r1021-fast-path-execution-state",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1021: false,
        schemaVersion: R1021_FAST_PATH_EXECUTION_STATE_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain(".latest.json");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(
  tmp: string,
  options: { nshapReady?: boolean; r1019TrustedCount?: number } = {},
): Promise<{
  nshapActivationFeasibilityPath: string;
  outputDir: string;
  r614MhasPath: string;
  r614NshapPath: string;
  r979Path: string;
  r980Path: string;
  r991Path: string;
  r1014ReductionPath: string;
  r1016ReductionPath: string;
  r1018Path: string;
  r1019ReductionPath: string;
  r1020Path: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const paths = {
    nshapActivationFeasibilityPath: path.join(fixtureDir, "nshap-feasibility.json"),
    outputDir,
    r614MhasPath: path.join(fixtureDir, "r614-mhas.json"),
    r614NshapPath: path.join(fixtureDir, "r614-nshap.json"),
    r979Path: path.join(fixtureDir, "r979.json"),
    r980Path: path.join(fixtureDir, "r980.json"),
    r991Path: path.join(fixtureDir, "r991.json"),
    r1014ReductionPath: path.join(fixtureDir, "r1014.json"),
    r1016ReductionPath: path.join(fixtureDir, "r1016.json"),
    r1018Path: path.join(fixtureDir, "r1018.json"),
    r1019ReductionPath: path.join(fixtureDir, "r1019.json"),
    r1020Path: path.join(fixtureDir, "r1020.json"),
  };
  await Promise.all([
    writeJson(paths.nshapActivationFeasibilityPath, nshapActivationFeasibilityFixture()),
    writeJson(paths.r614MhasPath, r614MhasFixture()),
    writeJson(paths.r614NshapPath, r614NshapFixture(options.nshapReady === true)),
    writeJson(paths.r979Path, r979Fixture()),
    writeJson(paths.r980Path, r980Fixture()),
    writeJson(paths.r991Path, r991Fixture()),
    writeJson(paths.r1014ReductionPath, r1014Fixture()),
    writeJson(paths.r1016ReductionPath, r1016Fixture()),
    writeJson(paths.r1018Path, r1018Fixture()),
    writeJson(paths.r1019ReductionPath, r1019Fixture(options.r1019TrustedCount ?? 3)),
    writeJson(paths.r1020Path, r1020Fixture()),
  ]);
  return paths;
}

function nshapActivationFeasibilityFixture(): Record<string, unknown> {
  return {
    noScoreReadiness: { conclusion: "nshap_metadata_ready_for_activation_design" },
    packetId: "nshap-activation-feasibility",
    schemaVersion: "murph-age-nshap-activation-feasibility.v1",
    status: "research-local-metadata-only",
  };
}

function r614MhasFixture(): Record<string, unknown> {
  return {
    boundary: safeBoundary(),
    packetId: "r614-mhas-source-rights-activation-labels",
    schemaVersion: "murph-age-r614-mhas-source-rights-activation-labels.v1",
    status: "research-local-aggregate-only",
    summary: { conclusion: "mhas_activation_labels_and_contract_metadata_ready_no_execution" },
  };
}

function r614NshapFixture(ready: boolean): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r614-nshap-activation-labels",
    schemaVersion: "murph-age-r614-nshap-activation-labels.v1",
    status: "research-local-aggregate-only",
    summary: {
      aggregateOutputsActive: ready,
      sourceRightsLabelsComplete: ready,
    },
  };
}

function r979Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r979-mhas-endpoint-join-contract",
    schemaVersion: "murph-age-r979-mhas-endpoint-join-contract.v1",
    status: "research-local-aggregate-only",
    summary: { conclusion: "mhas_endpoint_join_contract_locked_next_reducer_ready" },
  };
}

function r980Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r980-mhas-function-disability-aggregate-reducer",
    schemaVersion: "murph-age-r980-mhas-function-disability-aggregate-reducer.v1",
    status: "research-local-aggregate-only",
    summary: { conclusion: "mhas_function_disability_supportive_diagnostic_only" },
  };
}

function r991Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r991-mhas-deep-diagnostic-reducer",
    schemaVersion: "murph-age-r991-mhas-deep-diagnostic-reducer.v1",
    status: "research-local-aggregate-only",
    summary: { verdict: "function_disability_survives_age_residualized_deep_diagnostic" },
  };
}

function r1014Fixture(): Record<string, unknown> {
  return {
    consensus: { decision: "mhas_plus_nshap_parallel" },
    counts: { trusted: 5 },
    schema_version: "murph-age-r1014-new-data-acceleration-direction-reduction.v1",
    status: "complete",
  };
}

function r1016Fixture(): Record<string, unknown> {
  return {
    consensus: {
      decision: "run_mhas_and_nshap_function_batch",
      first_loop: "mhas_no_score_function_generalization",
    },
    counts: { trusted: 5 },
    schema_version: "murph-age-r1016-expanded-data-execution-batch-reduction.v1",
    status: "complete",
  };
}

function r1018Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1018-score-bearing-model-signal-receipt",
    schemaVersion: "murph-age-r1018-score-bearing-model-signal-receipt.v1",
    status: "research-local-aggregate-only",
    summary: { conclusion: "function_lead_glycemia_shadow_broad_labs_hold" },
  };
}

function r1019Fixture(trustedCount: number): Record<string, unknown> {
  return {
    consensus: {
      decision: "keep_function_lead_glycemia_shadow",
      next_loop: "fresh_function_falsification_with_glycemia_shadow",
    },
    counts: { trusted: trustedCount },
    schema_version: "murph-age-r1019-score-bearing-model-direction-reduction.v1",
    status: trustedCount === 3 ? "complete" : "pending",
  };
}

function r1020Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1020-reviewgpt-model-direction-state",
    schemaVersion: "murph-age-r1020-reviewgpt-model-direction-state.v1",
    status: "research-local-aggregate-only",
    summary: { conclusion: "reviewgpt_confirms_function_lead_glycemia_shadow" },
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
