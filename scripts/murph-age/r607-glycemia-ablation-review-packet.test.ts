import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R607_GLYCEMIA_ABLATION_REVIEW_PACKET_SCHEMA_VERSION,
  runR607GlycemiaAblationReviewPacket,
} from "./r607-glycemia-ablation-review-packet.ts";

describe("R607 glycemia ablation review packet", () => {
  it("packages R606 ablation results and source blockers as aggregate-only review input", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r607-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR607GlycemiaAblationReviewPacket({
        createdAt: "2026-05-13T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r607-glycemia-ablation-review-packet.latest.json");
      expect(output.schemaVersion).toBe(R607_GLYCEMIA_ABLATION_REVIEW_PACKET_SCHEMA_VERSION);
      expect(output.status).toBe("research-local-aggregate-only");
      expect(output.boundary).toMatchObject({
        aggregateOnly: true,
        coefficientsStored: false,
        localPathsStored: false,
        modelParametersStored: false,
        participantIdentifiersStored: false,
        predictionsStored: false,
        productClaimsIncluded: false,
        productDisplayAuthorized: false,
        productPromotionAuthorized: false,
        recommendationClaimsIncluded: false,
        rowValuesStored: false,
        smallCellsStored: false,
        sourceBodiesStored: false,
      });
      expect(output.priorReviewGptConsensus).toEqual({
        r604: {
          decisionCounts: { narrow_to_parsimonious_transport_candidate: 4, build_next_external_runner: 1 },
          topDecision: "narrow_to_parsimonious_transport_candidate",
          trustedCount: 5,
        },
        r605: {
          decisionCounts: { run_next_public_source_loop: 3, run_parsimonious_transport_ablation: 2 },
          topDecision: "run_next_public_source_loop",
          trustedCount: 5,
        },
      });
      expect(output.resultInterpretation.crossSourcePattern).toEqual({
        bodyOnly: "not_supported",
        glycemiaBody: "supported_small_signal",
        glycemiaOnly: "supported_small_signal",
      });
      expect(output.resultInterpretation.strongestProperScoreDirection).toBe("source_validation");
      expect(output.resultInterpretation.candidateResults.map((result) => [
        result.sourceId,
        result.candidateId,
        result.properScoreDirection,
      ])).toEqual([
        ["midus2-local", "age_sex_plus_bmi", "worse_than_age_sex"],
        ["midus2-local", "age_sex_plus_glycemia", "better_than_age_sex"],
        ["midus2-local", "age_sex_plus_glycemia_body", "better_than_age_sex"],
        ["creles-local", "age_sex_plus_bmi", "worse_than_age_sex"],
        ["creles-local", "age_sex_plus_glycemia", "better_than_age_sex"],
        ["creles-local", "age_sex_plus_glycemia_body", "better_than_age_sex"],
      ]);
      expect(output.sourceLanes).toEqual([
        {
          laneId: "mhas",
          nextRunnableAction: "complete_mhas_metadata_source_intake",
          productPromotionAuthorized: false,
          resultLabel: "candidate_family_overlap_not_detected",
          status: "research-local-aggregate-only",
        },
        {
          laneId: "haalsi",
          nextRunnableAction: "fill_source_rights_and_activation_labels_before_row_execution",
          productPromotionAuthorized: false,
          resultLabel: "blocked_missing_mortality_or_followup_header_coverage",
          status: "research-local-metadata-only",
        },
        {
          laneId: "nshap",
          nextRunnableAction: "design_locked_metadata_only_benchmark_card",
          productPromotionAuthorized: false,
          resultLabel: "nshap_metadata_ready_for_activation_design",
          status: "research-local-metadata-only",
        },
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("rawRows");
      expect(persisted).not.toContain("participantIds");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("\"coefficients\":");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r607-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r607-glycemia-ablation-review-packet.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_HAALSI_FEASIBILITY_PATH: paths.haalsiPath,
          MURPH_AGE_MHAS_JOIN_PROBE_PATH: paths.mhasPath,
          MURPH_AGE_NSHAP_FEASIBILITY_PATH: paths.nshapPath,
          MURPH_AGE_R604_REDUCTION_PATH: paths.r604Path,
          MURPH_AGE_R605_REDUCTION_PATH: paths.r605Path,
          MURPH_AGE_R606_PACKET_PATH: paths.r606Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        artifact: "r607-glycemia-ablation-review-packet.latest.json",
        candidateFamily: "parsimonious_glycemia_body",
        conclusion: "glycemia_signal_supported_but_small",
        packetId: "r607-glycemia-ablation-review-packet",
        productPromotionAuthorized: false,
        schemaVersion: R607_GLYCEMIA_ABLATION_REVIEW_PACKET_SCHEMA_VERSION,
        status: "research-local-aggregate-only",
        strongestProperScoreDirection: "source_validation",
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
  haalsiPath: string;
  mhasPath: string;
  nshapPath: string;
  r604Path: string;
  r605Path: string;
  r606Path: string;
}> {
  await mkdir(tmp, { recursive: true });
  const paths = {
    haalsiPath: path.join(tmp, "haalsi.json"),
    mhasPath: path.join(tmp, "mhas.json"),
    nshapPath: path.join(tmp, "nshap.json"),
    r604Path: path.join(tmp, "r604.json"),
    r605Path: path.join(tmp, "r605.json"),
    r606Path: path.join(tmp, "r606.json"),
  };
  await Promise.all([
    writeJson(paths.r606Path, r606Fixture()),
    writeJson(paths.r604Path, reductionFixture("narrow_to_parsimonious_transport_candidate", {
      narrow_to_parsimonious_transport_candidate: 4,
      build_next_external_runner: 1,
    })),
    writeJson(paths.r605Path, reductionFixture("run_next_public_source_loop", {
      run_next_public_source_loop: 3,
      run_parsimonious_transport_ablation: 2,
    })),
    writeJson(paths.mhasPath, {
      joinFeasibility: { joinKeyFamilyStatus: "candidate_family_overlap_not_detected" },
      nextRunnableAction: "complete_mhas_metadata_source_intake",
      status: "research-local-aggregate-only",
    }),
    writeJson(paths.haalsiPath, {
      endpointReadiness: { status: "blocked_missing_mortality_or_followup_header_coverage" },
      laneAssessment: { nextAction: "fill_source_rights_and_activation_labels_before_row_execution" },
      status: "research-local-metadata-only",
    }),
    writeJson(paths.nshapPath, {
      noScoreReadiness: {
        conclusion: "nshap_metadata_ready_for_activation_design",
        nextAction: "design_locked_metadata_only_benchmark_card",
      },
      status: "research-local-metadata-only",
    }),
  ]);
  return paths;
}

function reductionFixture(topDecision: string, decisionCounts: Record<string, number>) {
  return {
    consensus: { top_decision: topDecision },
    decision_counts: decisionCounts,
    trusted_count: 5,
  };
}

function r606Fixture() {
  return {
    sources: [
      sourceFixture("midus2-local", [
        candidateFixture("age_sex_reference", "age_sex_reference", 0, 0, null),
        candidateFixture("age_sex_plus_bmi", "body_only_no_crp", 0.000045, 0.000279, -0.001432),
        candidateFixture("age_sex_plus_glycemia", "glycemia_only_no_crp", -0.000125, -0.000319, 0.000573),
        candidateFixture("age_sex_plus_glycemia_body", "glycemia_body_no_crp", -0.000123, -0.000305, 0.000573),
      ]),
      sourceFixture("creles-local", [
        candidateFixture("age_sex_reference", "age_sex_reference", 0, 0, null),
        candidateFixture("age_sex_plus_bmi", "body_only_no_crp", 0.000654, 0.001475, -0.002243),
        candidateFixture("age_sex_plus_glycemia", "glycemia_only_no_crp", -0.001356, -0.004207, 0.007671),
        candidateFixture("age_sex_plus_glycemia_body", "glycemia_body_no_crp", -0.001585, -0.004381, 0.005663),
      ]),
    ],
  };
}

function sourceFixture(sourceId: string, parsimoniousCandidates: unknown[]) {
  return {
    parsimoniousCandidates,
    sourceId,
    status: "available",
  };
}

function candidateFixture(
  candidateId: string,
  modelId: string,
  brierDelta: number,
  logLossDelta: number,
  aucDelta: number | null,
) {
  return {
    candidateId,
    deltasVsAgeSex: { aucDelta, brierDelta, logLossDelta },
    modelId,
    status: "available",
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
