import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1020_REVIEWGPT_MODEL_DIRECTION_STATE_SCHEMA_VERSION,
  runR1020ReviewGptModelDirectionState,
} from "./r1020-reviewgpt-model-direction-state.ts";

describe("R1020 ReviewGPT model direction state", () => {
  it("persists the R1019 model-direction consensus as a local next-loop state", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1020-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR1020ReviewGptModelDirectionState({
        createdAt: "2026-05-13T19:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1020-reviewgpt-model-direction-state.latest.json");
      expect(output.schemaVersion).toBe(R1020_REVIEWGPT_MODEL_DIRECTION_STATE_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.summary).toEqual({
        conclusion: "reviewgpt_confirms_function_lead_glycemia_shadow",
        nextLocalAction: "build_fresh_nshap_harness_after_confirmation_else_continue_mhas_function",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1020: false,
      });
      expect(output.reviewGptConsensus).toEqual({
        decision: "keep_function_lead_glycemia_shadow",
        familyPolicyCounts: {
          "broad_labs:hold": 3,
          "cognition_shadow:shadow": 3,
          "compact_glycemia:shadow": 3,
          "function_disability:lead": 3,
          "wearables_activity_sleep:hold": 3,
        },
        nextLoop: "fresh_function_falsification_with_glycemia_shadow",
        sourcePolicyCounts: {
          "CRELES:parallel_shadow": 3,
          "MHAS/Gateway MHAS:parallel_shadow": 3,
          "NHANES/NHIS:context_only": 3,
          "NSHAP:lead_next": 3,
        },
        trustedReviewerCount: 3,
      });
      expect(output.nextActions.map((action) => [action.actionId, action.status, action.owner])).toEqual([
        ["complete_nshap_source_confirmation", "blocked", "human_user"],
        ["build_fresh_nshap_function_cognition_harness_after_confirmation", "blocked", "local_codex"],
        ["continue_mhas_function_fallback_if_nshap_blocked", "runnable", "local_codex"],
        ["carry_compact_glycemia_shadow_only", "runnable", "local_codex"],
        ["hold_broad_labs_and_wearables", "held", "local_codex"],
        ["send_reviewgpt_only_after_fresh_aggregate_delta", "held", "reviewgpt"],
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

  it("holds when the R1019 reducer is pending", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1020-pending-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { trustedReviewerCount: 1 });
      const { output } = await runR1020ReviewGptModelDirectionState({
        createdAt: "2026-05-13T19:00:00.000Z",
        ...paths,
      });

      expect(output.summary.conclusion).toBe("reviewgpt_model_direction_pending_or_missing");
      expect(output.summary.nextLocalAction).toBe("wait_for_r1019_reduction_or_recover_inputs");
      expect(output.reviewGptConsensus.trustedReviewerCount).toBe(1);
      expect(output.nextActions[3]).toMatchObject({
        actionId: "carry_compact_glycemia_shadow_only",
        status: "held",
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("marks the NSHAP harness runnable once the upstream state is ready", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1020-ready-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { nshapReady: true });
      const { output } = await runR1020ReviewGptModelDirectionState({
        createdAt: "2026-05-13T19:00:00.000Z",
        ...paths,
      });

      expect(output.nextActions[0]).toMatchObject({
        actionId: "complete_nshap_source_confirmation",
        blockedBy: [],
        status: "runnable",
      });
      expect(output.nextActions[1]).toMatchObject({
        actionId: "build_fresh_nshap_function_cognition_harness_after_confirmation",
        blockedBy: [],
        status: "runnable",
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe input boundaries", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1020-unsafe-"));
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

      await expect(runR1020ReviewGptModelDirectionState({
        ...paths,
        r1018Path: unsafePath,
      })).rejects.toThrow("R1020 input r1018ScoreBearingModelSignalReceipt failed aggregate boundary validation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1020-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1020-reviewgpt-model-direction-state.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1018_SCORE_BEARING_SIGNAL_PATH: paths.r1018Path,
          MURPH_AGE_R1019_REVIEWGPT_REDUCTION_PATH: paths.r1019ReductionPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        conclusion: "reviewgpt_confirms_function_lead_glycemia_shadow",
        decision: "keep_function_lead_glycemia_shadow",
        nextLocalAction: "build_fresh_nshap_harness_after_confirmation_else_continue_mhas_function",
        nextLoop: "fresh_function_falsification_with_glycemia_shadow",
        packetId: "r1020-reviewgpt-model-direction-state",
        productDisplayAuthorized: false,
        rowParsingPerformedByR1020: false,
        schemaVersion: R1020_REVIEWGPT_MODEL_DIRECTION_STATE_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
        trustedReviewerCount: 3,
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain(".latest.json");
      expect(stdout).not.toContain("predictions");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(
  tmp: string,
  options: { nshapReady?: boolean; trustedReviewerCount?: number } = {},
): Promise<{
  outputDir: string;
  r1018Path: string;
  r1019ReductionPath: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const paths = {
    outputDir,
    r1018Path: path.join(fixtureDir, "r1018.json"),
    r1019ReductionPath: path.join(fixtureDir, "r1019.json"),
  };
  await Promise.all([
    writeJson(paths.r1018Path, r1018Fixture(options.nshapReady === true)),
    writeJson(paths.r1019ReductionPath, r1019Fixture(options.trustedReviewerCount ?? 3)),
  ]);
  return paths;
}

function r1018Fixture(nshapReady = false): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    modelSignalState: {
      functionSidecarStatus: "lead_diagnostic_supported_pending_fresh_nshap",
      nextProposalBatch: "function_lead_with_glycemia_shadow_no_product",
      nshapFreshHarnessState: nshapReady
        ? "ready_after_confirmation_no_scoring"
        : "blocked_source_confirmation",
    },
    packetId: "r1018-score-bearing-model-signal-receipt",
    schemaVersion: "murph-age-r1018-score-bearing-model-signal-receipt.v1",
    status: "research-local-aggregate-only",
  };
}

function r1019Fixture(trustedReviewerCount: number): Record<string, unknown> {
  return {
    aggregateCounts: {
      decisionCounts: {
        keep_function_lead_glycemia_shadow: trustedReviewerCount,
      },
      familyPolicyCounts: {
        "broad_labs:hold": trustedReviewerCount,
        "cognition_shadow:shadow": trustedReviewerCount,
        "compact_glycemia:shadow": trustedReviewerCount,
        "function_disability:lead": trustedReviewerCount,
        "wearables_activity_sleep:hold": trustedReviewerCount,
      },
      sourcePolicyCounts: {
        "CRELES:parallel_shadow": trustedReviewerCount,
        "MHAS/Gateway MHAS:parallel_shadow": trustedReviewerCount,
        "NHANES/NHIS:context_only": trustedReviewerCount,
        "NSHAP:lead_next": trustedReviewerCount,
      },
    },
    consensus: {
      decision: "keep_function_lead_glycemia_shadow",
      next_loop: "fresh_function_falsification_with_glycemia_shadow",
    },
    counts: {
      pending: 3 - trustedReviewerCount,
      quarantine: 0,
      trusted: trustedReviewerCount,
    },
    outputMarker: "R1019_SCORE_BEARING_MODEL_DIRECTION_JSON",
    queueCount: 3,
    requiredModel: "GPT-5.5 Extended Pro",
    schema_version: "murph-age-r1019-score-bearing-model-direction-reduction.v1",
    status: trustedReviewerCount === 3 ? "complete" : "pending",
    storageAttestation: {
      localPathsOrFileNamesIncluded: false,
      participantIdentifiersIncluded: false,
      predictionsOrCoefficientsIncluded: false,
      productClaimsAuthorized: false,
      rowValuesIncluded: false,
      sourceBodiesOrCodebookProseIncluded: false,
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
