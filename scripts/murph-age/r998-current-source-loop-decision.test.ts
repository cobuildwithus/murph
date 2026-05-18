import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R998_CURRENT_SOURCE_LOOP_DECISION_SCHEMA_VERSION,
  runR998CurrentSourceLoopDecision,
} from "./r998-current-source-loop-decision.ts";

describe("R998 current source loop decision", () => {
  it("selects the score-bearing local loops after strict NSHAP replay is present", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r998-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { includeR997: true });
      const { output, outputPath } = await runR998CurrentSourceLoopDecision({
        createdAt: "2026-05-13T00:00:00.000Z",
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r998-current-source-loop-decision.latest.json");
      expect(output.schemaVersion).toBe(R998_CURRENT_SOURCE_LOOP_DECISION_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.summary).toEqual({
        currentLeadModelFamily: "frozen_nhis_r399_anchor_plus_function_disability_diagnostic_sidecar",
        nextLoop: "run_interpret_score_bearing_midus_creles_mhas_and_prepare_source_cards",
        productDisplayAuthorized: false,
        reviewGptRole: "big_science_decisions_only",
        strictNshapReplayStatus: "available",
      });
      expect(output.currentLeadModelFamily).toEqual({
        anchor: "frozen_nhis_r399_anchor",
        authorization: "research_only",
        sidecar: "function_disability_diagnostic",
        status: "current_lead",
      });
      expect(output.nextRealLocalLoop).toMatchObject({
        blockedBy: [],
        loopId: "run_interpret_score_bearing_midus_creles_mhas_and_prepare_source_cards",
        reviewGptRequiredForLocalChecklist: false,
      });
      expect(output.dataPriority.first).toEqual(["NSHAP", "MHAS", "MIDUS", "CRELES"]);
      expect(output.dataPriority.contextIfPresent).toEqual(["HAALSI", "SAGE", "SEBAS", "LSOA", "CLHLS"]);
      expect(output.reviewGptRole).toMatchObject({
        localChecklistApproval: false,
        role: "high_value_direction_and_result_review_only",
      });
      expect(output.productPolicy).toEqual({
        displayAuthorized: false,
        promotionAuthorized: false,
        productClaimsAuthorized: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("cache-entry-a");
      expect(persisted).not.toContain("participantIds");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"rowValues\":");
      expect(persisted).not.toContain("\"sourceBodies\": true");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("falls back to finishing strict NSHAP replay when r997 is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r998-missing-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { includeR997: false });
      const { output } = await runR998CurrentSourceLoopDecision({
        ...paths,
      });

      expect(output.summary).toMatchObject({
        nextLoop: "finish_strict_nshap_replay",
        strictNshapReplayStatus: "missing",
      });
      expect(output.inputArtifacts.r997StrictNshapReplay.status).toBe("missing");
      expect(output.nextRealLocalLoop).toEqual({
        loopId: "finish_strict_nshap_replay",
        actions: [
          "complete_or_recover_strict_nshap_replay_receipt",
          "then_interpret_score_bearing_midus_creles_mhas_aggregate_loops",
          "then_prepare_source_card_plan_for_nshap_mhas_haalsi_sage_when_applicable",
        ],
        blockedBy: ["strict_nshap_replay_receipt_missing"],
        reviewGptRequiredForLocalChecklist: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("keeps the CLI summary and output boundary pathless", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r998-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { includeR997: true });
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r998-current-source-loop-decision.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R826_POSTURE_BOARD_PATH: paths.r826Path,
          MURPH_AGE_R953_REALITY_CHECK_PATH: paths.r953Path,
          MURPH_AGE_R986_FUNCTION_ARBITRATION_PATH: paths.r986Path,
          MURPH_AGE_R987_GLYCEMIA_RECEIPT_PATH: paths.r987Path,
          MURPH_AGE_R994_SOURCE_CACHE_READINESS_PATH: paths.r994Path,
          MURPH_AGE_R995_SIDECAR_ARBITRATION_PATH: paths.r995Path,
          MURPH_AGE_R996_REDUCED_SUMMARY_PATH: paths.r996Path,
          MURPH_AGE_R997_STRICT_NSHAP_REPLAY_PATH: paths.r997Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: paths.outputDir,
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        currentLeadModelFamily: "frozen_nhis_r399_anchor_plus_function_disability_diagnostic_sidecar",
        nextLoop: "run_interpret_score_bearing_midus_creles_mhas_and_prepare_source_cards",
        packetId: "r998-current-source-loop-decision",
        productDisplayAuthorized: false,
        reviewGptRole: "big_science_decisions_only",
        schemaVersion: R998_CURRENT_SOURCE_LOOP_DECISION_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
        strictNshapReplayStatus: "available",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("cache-entry-a");
      expect(stdout).not.toContain("coefficients");
      expect(stdout).not.toContain("predictions");

      const persisted = await readFile(path.join(paths.outputDir, "r998-current-source-loop-decision.latest.json"), "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("cache-entry-a");
      expect(findForbiddenAggregateEgress(JSON.parse(persisted))).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe aggregate input egress", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r998-unsafe-"));
    try {
      const paths = await writeFixtureArtifacts(tmp, { includeR997: true });
      await writeJson(paths.r994Path, {
        ...aggregateFixture("r994-expanded-source-cache-readiness"),
        coefficients: [1, 2, 3],
      });

      await expect(runR998CurrentSourceLoopDecision({
        ...paths,
      })).rejects.toThrow("R998 input r994ExpandedSourceCacheReadiness failed aggregate boundary validation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtureArtifacts(
  tmp: string,
  options: { includeR997: boolean },
): Promise<{
  outputDir: string;
  r826Path: string;
  r953Path: string;
  r986Path: string;
  r987Path: string;
  r994Path: string;
  r995Path: string;
  r996Path: string;
  r997Path: string;
}> {
  const fixtureDir = path.join(tmp, "fixtures");
  const outputDir = path.join(tmp, "out");
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const paths = {
    outputDir,
    r826Path: path.join(fixtureDir, "r826.json"),
    r953Path: path.join(fixtureDir, "r953.json"),
    r986Path: path.join(fixtureDir, "r986.json"),
    r987Path: path.join(fixtureDir, "r987.json"),
    r994Path: path.join(fixtureDir, "r994.json"),
    r995Path: path.join(fixtureDir, "r995.json"),
    r996Path: path.join(fixtureDir, "r996.json"),
    r997Path: path.join(fixtureDir, "r997.json"),
  };

  await Promise.all([
    writeJson(paths.r826Path, aggregateFixture("r826-posture-board")),
    writeJson(paths.r953Path, aggregateFixture("r953-reality-check")),
    writeJson(paths.r986Path, aggregateFixture("r986-cross-source-function-arbitration")),
    writeJson(paths.r987Path, aggregateFixture("r987-creles-glycemia-receipt-reducer")),
    writeJson(paths.r994Path, aggregateFixture("r994-expanded-source-cache-readiness")),
    writeJson(paths.r995Path, aggregateFixture("r995-sidecar-evidence-arbitration")),
    writeJson(paths.r996Path, aggregateFixture("r996-reduced-summary")),
  ]);
  if (options.includeR997) {
    await writeJson(paths.r997Path, aggregateFixture("r997-strict-nshap-replay"));
  }
  return paths;
}

function aggregateFixture(packetId: string): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    packetId,
    schemaVersion: `test-${packetId}`,
    status: "research-local-aggregate-only",
    summary: {
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
    },
  };
}

function safeBoundary(): Record<string, unknown> {
  return {
    aggregateOnly: true,
    codebookProseStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    localFileNamesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    participantIdentifiersStored: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceProseStored: false,
    splitMembershipStored: false,
    variableLabelsStored: false,
    variableListsStored: false,
    variableNamesStored: false,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
