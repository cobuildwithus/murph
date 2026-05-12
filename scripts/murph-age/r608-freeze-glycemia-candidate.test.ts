import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R608_FREEZE_GLYCEMIA_CANDIDATE_SCHEMA_VERSION,
  runR608FreezeGlycemiaCandidate,
} from "./r608-freeze-glycemia-candidate.ts";

describe("R608 freeze glycemia candidate manifest", () => {
  it("freezes the ReviewGPT-approved glycemia-only family as an aggregate-only manifest", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r608-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const { output, outputPath } = await runR608FreezeGlycemiaCandidate({
        createdAt: "2026-05-13T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r608-freeze-glycemia-candidate.latest.json");
      expect(output.schemaVersion).toBe(R608_FREEZE_GLYCEMIA_CANDIDATE_SCHEMA_VERSION);
      expect(output.status).toBe("candidate_family_frozen_for_future_validation");
      expect(output.frozenCandidateId).toBe("age_sex_plus_glycemia");
      expect(output.candidateFamily).toEqual({
        excludedDomainsForThisFreeze: ["body_size", "lipids", "inflammation", "blood_pressure", "medications", "wearables"],
        familyId: "tiny_glycemia_only",
        frozenFromDecision: "freeze_glycemia_only_candidate",
        includedDomains: ["demographics", "glycemia"],
        label: "age_sex_plus_glycemia",
      });
      expect(output.evidenceInputs).toEqual([
        {
          artifact: "r606-parsimonious-glycemia-ablation.latest.json",
          inputId: "r606_aggregate_ablation",
          relevantConclusion: "partial_aggregate_packet_ready",
          schemaVersion: "murph-age-r606-parsimonious-glycemia-ablation.v1",
          status: "research-local-aggregate-only",
        },
        {
          artifact: "r607-glycemia-ablation-review-packet.latest.json",
          inputId: "r607_review_packet",
          relevantConclusion: "freeze_tiny_glycemia_candidate_and_seek_external_outcome_lane",
          schemaVersion: "murph-age-r607-glycemia-ablation-review-packet.v1",
          status: "research-local-aggregate-only",
        },
      ]);
      expect(output.consensusInputs).toEqual([
        {
          artifact: "r607-glycemia-ablation-review-summary.json",
          completedReviewCount: 3,
          decisionCounts: { freeze_glycemia_only_candidate: 3 },
          status: "trusted_majority",
          topDecision: "freeze_glycemia_only_candidate",
          trustedReviewCount: 3,
        },
      ]);
      expect(output.allowedNextUse.scope).toBe("future_external_or_source_validation_only");
      expect(output.blockedUses).toContain("product_display");
      expect(output.blockedUses).toContain("protocol_or_recommendation_claims");
      expect(output.sourceValidationNeed.conclusion).toBe("external_source_validation_required_before_any_product_or_scoring_use");
      expect(output.storageAttestation).toMatchObject({
        aggregateOnly: true,
        coefficientsStored: false,
        localPathsStored: false,
        modelParametersStored: false,
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
        sourceTextStored: false,
        splitMembershipStored: false,
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
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("fails closed when a required aggregate artifact is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r608-missing-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      await expect(runR608FreezeGlycemiaCandidate({
        outputDir: path.join(tmp, "out"),
        ...paths,
        r607ReviewGptPath: path.join(tmp, "missing-review-summary.json"),
      })).rejects.toThrow("Missing required aggregate artifact: r607 ReviewGPT reduction.");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r608-cli-"));
    try {
      const paths = await writeFixtureArtifacts(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r608-freeze-glycemia-candidate.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R606_PACKET_PATH: paths.r606Path,
          MURPH_AGE_R607_PACKET_PATH: paths.r607PacketPath,
          MURPH_AGE_R607_REVIEWGPT_PATH: paths.r607ReviewGptPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        artifact: "r608-freeze-glycemia-candidate.latest.json",
        consensusStatus: "trusted_majority",
        frozenCandidateId: "age_sex_plus_glycemia",
        manifestId: "r608-freeze-glycemia-candidate",
        productPromotionAuthorized: false,
        schemaVersion: R608_FREEZE_GLYCEMIA_CANDIDATE_SCHEMA_VERSION,
        status: "candidate_family_frozen_for_future_validation",
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
  r606Path: string;
  r607PacketPath: string;
  r607ReviewGptPath: string;
}> {
  await mkdir(tmp, { recursive: true });
  const paths = {
    r606Path: path.join(tmp, "r606.json"),
    r607PacketPath: path.join(tmp, "r607-packet.json"),
    r607ReviewGptPath: path.join(tmp, "r607-reviewgpt.json"),
  };
  await Promise.all([
    writeJson(paths.r606Path, {
      schemaVersion: "murph-age-r606-parsimonious-glycemia-ablation.v1",
      status: "research-local-aggregate-only",
      summary: { conclusion: "partial_aggregate_packet_ready" },
    }),
    writeJson(paths.r607PacketPath, {
      resultInterpretation: {
        candidateResults: [
          {
            candidateId: "age_sex_plus_glycemia",
            properScoreDirection: "better_than_age_sex",
            sourceId: "midus2-local",
          },
          {
            candidateId: "age_sex_plus_glycemia",
            properScoreDirection: "better_than_age_sex",
            sourceId: "creles-local",
          },
          {
            candidateId: "age_sex_plus_bmi",
            properScoreDirection: "worse_than_age_sex",
            sourceId: "creles-local",
          },
        ],
      },
      schemaVersion: "murph-age-r607-glycemia-ablation-review-packet.v1",
      status: "research-local-aggregate-only",
      summary: {
        nextLocalAction: "freeze_tiny_glycemia_candidate_and_seek_external_outcome_lane",
        productPromotionAuthorized: false,
      },
    }),
    writeJson(paths.r607ReviewGptPath, {
      consensus: {
        completed_count: 3,
        top_count: 3,
        top_decision: "freeze_glycemia_only_candidate",
      },
      decision_counts: { freeze_glycemia_only_candidate: 3 },
      trusted_count: 3,
    }),
  ]);
  return paths;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
