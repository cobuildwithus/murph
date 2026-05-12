import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R610_NEXT_EXECUTABLE_LOOP_SCAFFOLD_SCHEMA_VERSION,
  runR610NextExecutableLoopScaffold,
} from "./r610-next-executable-loop-scaffold.ts";

describe("R610 next executable loop scaffold", () => {
  it("builds a post-R609 aggregate-only metadata loop manifest without unlocking scoring", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r610-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR610NextExecutableLoopScaffold({
        createdAt: "2026-05-13T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r610-next-executable-loop-scaffold.latest.json");
      expect(output.schemaVersion).toBe(R610_NEXT_EXECUTABLE_LOOP_SCAFFOLD_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.boundary).toMatchObject({
        aggregateOnly: true,
        codebookProseStored: false,
        codebookTextStored: false,
        coefficientsStored: false,
        localPathsStored: false,
        modelParametersStored: false,
        outcomeScoringPerformed: false,
        participantIdentifiersStored: false,
        predictionsStored: false,
        productClaimsIncluded: false,
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        protocolClaimsIncluded: false,
        recommendationClaimsIncluded: false,
        rowValuesStored: false,
        smallCellsStored: false,
        sourceBodiesStored: false,
        splitIdentifiersStored: false,
        splitMembershipStored: false,
      });
      expect(output.inputArtifacts.r603TransportReadiness).toMatchObject({
        artifact: "r603-transport-readiness-packet.latest.json",
        packetId: "r603-creles-transport-readiness",
        status: "available",
      });
      expect(output.frozenCandidate).toEqual({
        candidateId: "age_sex_plus_glycemia",
        minimumNextEvidenceClass: "true_external_validation_or_partner_aggregate_validation",
        status: "candidate_family_frozen_for_future_validation",
      });
      expect(output.executableLocalLoops).toEqual([
        {
          blockedActions: [
            "row_parsing_until_source_activation",
            "outcome_scoring_until_locked_benchmark",
          ],
          evidenceArtifacts: [
            "mhas-source-feasibility.latest.json",
            "mhas-join-probe.latest.json",
          ],
          laneId: "mhas-harmonized-eol",
          localAction: "draft_locked_mhas_join_and_endpoint_contract",
          loopId: "activate-mhas-harmonized-eol",
          outcomeScoringUnlocked: false,
          reviewGptHighLevelSourceStrategyOnly: true,
          source: "r609-source-activation-queue",
        },
        {
          blockedActions: [
            "row_execution_until_source_activation",
            "outcome_scoring_until_locked_benchmark",
          ],
          evidenceArtifacts: ["nshap-activation-feasibility.latest.json"],
          laneId: "nshap",
          localAction: "design_locked_metadata_only_benchmark_card",
          loopId: "activate-nshap",
          outcomeScoringUnlocked: false,
          reviewGptHighLevelSourceStrategyOnly: true,
          source: "r609-source-activation-queue",
        },
      ]);
      expect(output.blockedLoops.map((loop) => loop.loopId)).toEqual([
        "outcome-scoring",
        "product-display",
        "same-family-transport-claim",
      ]);
      expect(output.summary).toEqual({
        conclusion: "metadata_loop_ready_no_scoring_unlocked",
        executableLoopCountBand: "1-9",
        nextActionForParent: "run_metadata_only_loop:mhas-harmonized-eol:draft_locked_mhas_join_and_endpoint_contract",
        outcomeScoringUnlockedCountBand: "0",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("rawRows");
      expect(persisted).not.toContain("participantIds");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("\"coefficients\":");
      expect(persisted).not.toContain("\"rowValues\":");
      expect(persisted).not.toContain("\"smallCells\":");
      expect(persisted).not.toContain("source body");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed when refreshed aggregate artifacts are missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r610-missing-"));
    try {
      const { output } = await runR610NextExecutableLoopScaffold({
        outputDir: path.join(tmp, "out"),
        r603Path: path.join(tmp, "missing-r603.json"),
        r606Path: path.join(tmp, "missing-r606.json"),
        r607Path: path.join(tmp, "missing-r607.json"),
        r608Path: path.join(tmp, "missing-r608.json"),
        r609Path: path.join(tmp, "missing-r609.json"),
      });

      expect(output.status).toBe("blocked-missing-required-artifacts");
      expect(Object.values(output.inputArtifacts).every((artifact) => artifact.status === "missing")).toBe(true);
      expect(output.executableLocalLoops).toEqual([]);
      expect(output.summary).toEqual({
        conclusion: "missing_required_aggregate_artifacts",
        executableLoopCountBand: "0",
        nextActionForParent: "refresh_r603_r606_r607_r608_r609_aggregate_packets",
        outcomeScoringUnlockedCountBand: "0",
      });
      expect(output.blockedLoops[0]).toMatchObject({
        loopId: "post-r609-loop-scaffold",
        outcomeScoringUnlocked: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r610-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r610-next-executable-loop-scaffold.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R603_PACKET_PATH: paths.r603Path,
          MURPH_AGE_R606_PACKET_PATH: paths.r606Path,
          MURPH_AGE_R607_PACKET_PATH: paths.r607Path,
          MURPH_AGE_R608_MANIFEST_PATH: paths.r608Path,
          MURPH_AGE_R609_PACKET_PATH: paths.r609Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        artifact: "r610-next-executable-loop-scaffold.latest.json",
        conclusion: "metadata_loop_ready_no_scoring_unlocked",
        executableLoopCountBand: "1-9",
        outcomeScoringUnlockedCountBand: "0",
        packetId: "r610-next-executable-loop-scaffold",
        schemaVersion: R610_NEXT_EXECUTABLE_LOOP_SCAFFOLD_SCHEMA_VERSION,
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
  r603Path: string;
  r606Path: string;
  r607Path: string;
  r608Path: string;
  r609Path: string;
}> {
  await mkdir(tmp, { recursive: true });
  const paths = {
    r603Path: path.join(tmp, "r603.json"),
    r606Path: path.join(tmp, "r606.json"),
    r607Path: path.join(tmp, "r607.json"),
    r608Path: path.join(tmp, "r608.json"),
    r609Path: path.join(tmp, "r609.json"),
  };
  await Promise.all([
    writeJson(paths.r603Path, {
      packetId: "r603-creles-transport-readiness",
      readiness: {
        conclusion: "transport_signal_not_confirmed",
      },
      schemaVersion: "murph-age-r603-transport-readiness-packet.v1",
    }),
    writeJson(paths.r606Path, {
      packetId: "r606-parsimonious-glycemia-ablation",
      schemaVersion: "murph-age-r606-parsimonious-glycemia-ablation.v1",
      status: "research-local-aggregate-only",
    }),
    writeJson(paths.r607Path, {
      packetId: "r607-glycemia-ablation-review-packet",
      schemaVersion: "murph-age-r607-glycemia-ablation-review-packet.v1",
      status: "research-local-aggregate-only",
    }),
    writeJson(paths.r608Path, {
      frozenCandidateId: "age_sex_plus_glycemia",
      manifestId: "r608-freeze-glycemia-candidate",
      schemaVersion: "murph-age-r608-freeze-glycemia-candidate.v1",
      sourceValidationNeed: {
        minimumNextEvidenceClass: "true_external_validation_or_partner_aggregate_validation",
      },
      status: "candidate_family_frozen_for_future_validation",
    }),
    writeJson(paths.r609Path, {
      candidateLanes: [
        {
          allowedNextLocalAction: "draft_locked_mhas_join_and_endpoint_contract",
          blockedActions: [
            "row_parsing_until_source_activation",
            "outcome_scoring_until_locked_benchmark",
          ],
          evidenceArtifacts: [
            "mhas-source-feasibility.latest.json",
            "mhas-join-probe.latest.json",
          ],
          laneId: "mhas-harmonized-eol",
          outcomeScoringUnlocked: false,
          reviewGptHighLevelSourceStrategyOnly: true,
        },
        {
          allowedNextLocalAction: "design_locked_metadata_only_benchmark_card",
          blockedActions: [
            "row_execution_until_source_activation",
            "outcome_scoring_until_locked_benchmark",
          ],
          evidenceArtifacts: ["nshap-activation-feasibility.latest.json"],
          laneId: "nshap",
          outcomeScoringUnlocked: false,
          reviewGptHighLevelSourceStrategyOnly: true,
        },
        {
          allowedNextLocalAction: "fill_source_rights_and_activation_labels_before_execution",
          blockedActions: ["outcome_scoring_until_locked_benchmark"],
          evidenceArtifacts: [],
          laneId: "missing-evidence",
          outcomeScoringUnlocked: false,
          reviewGptHighLevelSourceStrategyOnly: false,
        },
      ],
      packetId: "r609-source-activation-queue",
      schemaVersion: "murph-age-r609-source-activation-queue.v1",
      status: "research-local-aggregate-only",
    }),
  ]);
  return paths;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
