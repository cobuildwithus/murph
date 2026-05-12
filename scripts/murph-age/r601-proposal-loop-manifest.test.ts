import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R601_PROPOSAL_LOOP_MANIFEST_SCHEMA_VERSION,
  runR601ProposalLoopManifest,
} from "./r601-proposal-loop-manifest.ts";

describe("R601 proposal loop manifest", () => {
  it("builds a proposal-only next-loop manifest from the R600 aggregate packet", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r601-manifest-"));
    try {
      const packetPath = await writePacketFixture(tmp);
      const { output, outputPath } = await runR601ProposalLoopManifest({
        createdAt: "2026-05-12T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        packetPath,
      });

      expect(path.basename(outputPath)).toBe("r601-proposal-loop-manifest.latest.json");
      expect(output.schemaVersion).toBe(R601_PROPOSAL_LOOP_MANIFEST_SCHEMA_VERSION);
      expect(output.status).toBe("research-proposal-only");
      expect(output.aggregateBoundary.productDisplayAuthorized).toBe(false);
      expect(output.aggregateBoundary.productPromotionAuthorized).toBe(false);
      expect(output.negativeResultMemory).toEqual({
        conclusion: "weak_internal_signal_not_promotable",
        retainAsEvidence: true,
        retuneSameInternalSources: false,
      });
      expect(output.candidates.map((candidate) => candidate.candidateId)).toEqual([
        "partner-aggregate-frozen-evaluator-handoff",
        "public-external-source-activation-readiness",
        "residual-increment-negative-result-memory",
        "reviewer-direction-packet",
      ]);
      expect(output.candidates.find((candidate) => candidate.candidateId === "residual-increment-negative-result-memory")?.requiresReviewGptBeforeExecution).toBe(false);
      expect(output.nextStep).toEqual({
        codexLocalAction: "prepare-approved-runner-only-after-r601-results",
        reviewGptAction: "harvest_r601_aggregate_results_next_loop_chorus",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = await readFile(outputPath, "utf8");
      expect(persisted).not.toContain(tmp);
      expect(persisted).not.toContain("rawRows");
      expect(persisted).not.toContain("predictionById");
      expect(persisted).not.toContain("coefficients\":");
      expect(persisted).not.toContain("selectedPointIds");
      expect(persisted).not.toContain("\"events\":");
      expect(persisted).not.toContain("\"n\":");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints only a pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r601-manifest-cli-"));
    try {
      const packetPath = await writePacketFixture(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r601-proposal-loop-manifest.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R600_PACKET_PATH: packetPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      expect(JSON.parse(stdout)).toEqual({
        artifact: "r601-proposal-loop-manifest.latest.json",
        candidateCount: 4,
        manifestId: "r601-post-r600-proposal-loop",
        productPromotionAuthorized: false,
        schemaVersion: R601_PROPOSAL_LOOP_MANIFEST_SCHEMA_VERSION,
        status: "research-proposal-only",
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("coefficients");
      expect(stdout).not.toContain("predictions");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writePacketFixture(tmp: string): Promise<string> {
  await mkdir(tmp, { recursive: true });
  const packetPath = path.join(tmp, "r600-packet.json");
  await writeFile(packetPath, `${JSON.stringify({
    boundary: {
      aggregateOnly: true,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      participantIdentifiersStored: false,
      predictionsStored: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      rowValuesStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
    },
    packetId: "r600-frozen-anchor-residual-increment-aggregate-results",
    schemaVersion: "murph-age-r600-aggregate-results-packet.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "weak_internal_signal_not_promotable",
    },
  }, null, 2)}\n`);
  return packetPath;
}
