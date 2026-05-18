import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1170_ORDINARY_CONSUMER_SAFE_ASSERTION_SMOKE_PROOF_SCHEMA_VERSION,
  runR1170OrdinaryConsumerSafeAssertionSmokeProof,
} from "./r1170-ordinary-consumer-safe-assertion-smoke-proof.ts";

const SAFE_FIELD_EDIT_PATHS = [
  "sourceFamilies[bloodwork_glycemia].available",
  "sourceFamilies[wearable_activity_daily].available",
  "sourceFamilies[common_bloodwork_core].available",
  "sourceFamilies[vitals_body_context].available",
  "rowOwnerAssertionsConfirmed",
  "privateContentExcluded",
  "attestations.aggregateOnly",
  "attestations.localOnly",
  "attestations.noCoefficientEgress",
  "attestations.noHeaderNameEgress",
  "attestations.noParticipantEgress",
  "attestations.noPredictionEgress",
  "attestations.noPrivatePathEgress",
  "attestations.noPrivateRefValueEgress",
  "attestations.noRowEgress",
  "attestations.noSmallCellEgress",
  "attestations.noSourceTextEgress",
] as const;

describe("R1170 ordinary consumer safe assertion smoke proof", () => {
  it("proves the synthetic R1165 assertion acceptance path without becoming model evidence", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1170-ready-"));
    try {
      const outputDir = path.join(tmp, "out");
      const { output, outputPath } = await runR1170OrdinaryConsumerSafeAssertionSmokeProof({
        createdAt: "2026-05-18T12:00:00.000Z",
        outputDir,
      });

      expect(path.basename(outputPath)).toBe(
        "r1170-ordinary-consumer-safe-assertion-smoke-proof.latest.json",
      );
      expect(output.schemaVersion).toBe(
        R1170_ORDINARY_CONSUMER_SAFE_ASSERTION_SMOKE_PROOF_SCHEMA_VERSION,
      );
      expect(output.summary).toMatchObject({
        conclusion: "ordinary_safe_assertion_smoke_passed_non_evidence",
        liveChainGateStillRequired: true,
        modelEvidencePromotionAllowed: false,
        nextAction: "keep_live_chain_waiting_on_real_r1165_row_owner_safe_assertion",
        productDisplayAuthorized: false,
        realEvidenceProduced: false,
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1170: false,
        rowOwnerAssertionStillRequiredForLiveChain: true,
        rowOwnerPrivateValuesStored: false,
        rowParsingPerformedByR1170: false,
        r1163FeatureOnlyResearchPlanningReady: true,
        r1165AssertionAccepted: true,
        r1165ChildR1163Ran: true,
        r1165FeatureOnlyResearchPlanningReady: true,
        safeFieldEditCount: SAFE_FIELD_EDIT_PATHS.length,
        safeFieldEditPaths: [...SAFE_FIELD_EDIT_PATHS],
        smokeEvidence: false,
        smokeProofPassed: true,
        syntheticSmokeProof: true,
        targetAgeBand: "roughly_16_50",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      });
      expect(output.safeAssertionSmokeProof).toMatchObject({
        modelEvidencePromotedByR1170: false,
        realEvidenceProduced: false,
        r1163Conclusion: "feature_only_safe_confirmation_to_research_runner_ready_research_only",
        r1163FeatureOnlyResearchPlanningReady: true,
        r1165AssertionAccepted: true,
        r1165ChildR1163Ran: true,
        r1165Conclusion: "ordinary_feature_only_safe_assertion_runner_ready_research_only",
        r1165FeatureOnlyResearchPlanningReady: true,
        r1165NextAction: "run_r1164_feature_only_research_handoff",
        r1165ValidationReasonCount: 0,
        rowOwnerAssertionStillRequiredForLiveChain: true,
        safeFieldEditCount: SAFE_FIELD_EDIT_PATHS.length,
        safeFieldEditPaths: [...SAFE_FIELD_EDIT_PATHS],
        scratchArtifactsPersisted: false,
        smokeEvidence: false,
        syntheticAssertionUsedForSmoke: true,
        syntheticAssertionValuesPersistedInArtifact: false,
      });
      expect(output.artifactBoundary).toMatchObject({
        assertionFilePathStored: false,
        assertionValuesStoredByR1170: false,
        childOutputPathsStored: false,
        localPathsStored: false,
        scratchArtifactsPersisted: false,
        syntheticAssertionPersistedInArtifact: false,
      });
      expect(await pathExists(path.join(outputDir, "r1165-ordinary-consumer-feature-only-safe-assertion-runner.latest.json"))).toBe(false);
      expect(await pathExists(path.join(outputDir, "r1163-feature-only-safe-confirmation-to-research-runner.latest.json"))).toBe(false);
      expect(await pathExists(path.join(outputDir, "r1165-row-owner-feature-only-safe-assertion.template.json"))).toBe(false);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(output)).not.toContain("safe-assertion.synthetic.json");
      expect(JSON.stringify(output)).not.toContain("\"rowOwnerAssertionsConfirmed\":true");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = JSON.parse(await readFile(outputPath, "utf8")) as unknown;
      expect(findForbiddenAggregateEgress(persisted)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1170-cli-"));
    try {
      const stdout = await execFileStdout("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1170-ordinary-consumer-safe-assertion-smoke-proof.ts"),
      ], {
        MURPH_AGE_R1170_CREATED_AT: "2026-05-18T12:00:00.000Z",
        MURPH_AGE_R1170_OUTPUT_DIR: path.join(tmp, "out"),
      });
      const parsed = JSON.parse(stdout) as {
        conclusion: string;
        liveChainGateStillRequired: boolean;
        modelEvidencePromotionAllowed: boolean;
        nextAction: string;
        packetId: string;
        realEvidenceProduced: boolean;
        r1165AssertionAccepted: boolean;
        r1165ChildR1163Ran: boolean;
        smokeEvidence: boolean;
        smokeProofPassed: boolean;
        syntheticSmokeProof: boolean;
      };

      expect(parsed).toMatchObject({
        conclusion: "ordinary_safe_assertion_smoke_passed_non_evidence",
        liveChainGateStillRequired: true,
        modelEvidencePromotionAllowed: false,
        nextAction: "keep_live_chain_waiting_on_real_r1165_row_owner_safe_assertion",
        packetId: "r1170-ordinary-consumer-safe-assertion-smoke-proof",
        realEvidenceProduced: false,
        r1165AssertionAccepted: true,
        r1165ChildR1163Ran: true,
        smokeEvidence: false,
        smokeProofPassed: true,
        syntheticSmokeProof: true,
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("outputPath");
      expect(await pathExists(
        path.join(tmp, "out", "r1170-ordinary-consumer-safe-assertion-smoke-proof.latest.json"),
      )).toBe(true);
      expect(await pathExists(
        path.join(tmp, "out", "r1165-ordinary-consumer-feature-only-safe-assertion-runner.latest.json"),
      )).toBe(false);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function execFileStdout(
  file: string,
  args: string[],
  env: Record<string, string>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, {
      env: {
        ...process.env,
        ...env,
      },
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Command failed: ${error.message}\n${stderr}`));
        return;
      }
      resolve(stdout);
    });
  });
}
