import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1155_ORDINARY_CONSUMER_SAFE_CONFIRMATION_FEATURE_ONLY_SMOKE_PROOF_SCHEMA_VERSION,
  runR1155OrdinaryConsumerSafeConfirmationFeatureOnlySmokeProof,
} from "./r1155-ordinary-consumer-safe-confirmation-feature-only-smoke-proof.ts";

const FEATURE_ONLY_SOURCE_FAMILY_IDS = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
];

describe("R1155 ordinary consumer safe confirmation feature-only smoke proof", () => {
  it("proves the compact lab-plus-wearable safe confirmation path without model evidence", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1155-ready-"));
    try {
      const r1149Path = path.join(tmp, "r1149.json");
      await writeJson(r1149Path, r1149Fixture());

      const { output, outputPath } =
        await runR1155OrdinaryConsumerSafeConfirmationFeatureOnlySmokeProof({
          createdAt: "2026-05-17T12:00:00.000Z",
          outputDir: path.join(tmp, "out"),
          r1149Path,
        });

      expect(path.basename(outputPath)).toBe(
        "r1155-ordinary-consumer-safe-confirmation-feature-only-smoke-proof.latest.json",
      );
      expect(output.schemaVersion).toBe(
        R1155_ORDINARY_CONSUMER_SAFE_CONFIRMATION_FEATURE_ONLY_SMOKE_PROOF_SCHEMA_VERSION,
      );
      expect(output.summary).toMatchObject({
        conclusion: "ordinary_safe_confirmation_feature_only_smoke_passed_non_evidence",
        featureOnlyChainConclusion: "ordinary_feature_only_chain_ready_research_only",
        featureOnlyCoverageContextReadyForResearchPlanning: true,
        modelEvidencePromotionAllowed: false,
        nextAction: "use_r1150_r1153_path_with_real_safe_availability_confirmation",
        productDisplayAuthorized: false,
        readyForRecipeReadinessChain: false,
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1155: false,
        rowParsingPerformedByR1155: false,
        safeAvailabilityConfirmationConclusion: "safe_availability_confirmation_feature_only_ready_research_only",
        smokeEvidence: false,
        targetAgeBand: "roughly_16_50",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      });
      expect(output.safeConfirmationFeatureOnlySmokeProof).toMatchObject({
        compactConfirmationSourceFamilyIds: FEATURE_ONLY_SOURCE_FAMILY_IDS,
        derivedCoverageContextUsed: true,
        featureOnlyCoverageContextIntakeConclusion: "feature_only_coverage_context_ready_research_only",
        featureOnlyModeConclusion: "ordinary_feature_only_mode_available_not_model_evidence",
        modelEvidencePromotionAllowed: false,
        outcomeLinkedEvidenceIncludedInSmoke: false,
        readyForRecipeReadinessChain: false,
        smokeEvidenceRole: "feature_only_safe_confirmation_smoke_only_not_model_evidence",
        temporaryConfirmationWrittenByR1155: true,
        temporaryConfirmationValuesPersistedInArtifact: false,
      });
      expect(output.inputArtifacts.r1149).toMatchObject({
        packetId: "r1149-ordinary-consumer-lab-wearable-submission-kit",
        schemaVersion: "murph-age-r1149-ordinary-consumer-lab-wearable-submission-kit.v1",
        status: "available",
      });
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(output)).not.toContain("safe-confirmation.json");
      expect(JSON.stringify(output)).not.toContain("glucose_value");
      expect(JSON.stringify(output)).not.toContain("synthetic-person");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = JSON.parse(await readFile(outputPath, "utf8")) as unknown;
      expect(findForbiddenAggregateEgress(persisted)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits on R1149 when the submitter kit guard is stale", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1155-stale-r1149-"));
    try {
      const r1149Path = path.join(tmp, "r1149.json");
      await writeJson(r1149Path, {
        ...r1149Fixture(),
        schemaVersion: "stale",
      });

      const { output } = await runR1155OrdinaryConsumerSafeConfirmationFeatureOnlySmokeProof({
        outputDir: path.join(tmp, "out"),
        r1149Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_safe_confirmation_feature_only_smoke_waiting_on_r1149_submitter_kit",
        featureOnlyCoverageContextReadyForResearchPlanning: false,
        nextAction: "refresh_r1149_submitter_kit",
        smokeEvidence: false,
      });
      expect(output.inputArtifacts.r1149).toMatchObject({
        packetId: "r1149-ordinary-consumer-lab-wearable-submission-kit",
        schemaVersion: null,
        status: "available",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe R1149 input with a sanitized error", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1155-unsafe-"));
    try {
      const r1149Path = path.join(tmp, "r1149.json");
      await writeJson(r1149Path, {
        ...r1149Fixture(),
        artifactBoundary: {
          ...safeBoundary(),
          rowValuesStored: true,
        },
      });

      await expect(runR1155OrdinaryConsumerSafeConfirmationFeatureOnlySmokeProof({
        outputDir: path.join(tmp, "out"),
        r1149Path,
      })).rejects.toThrow("R1155 rejected unsafe r1149 input: 1 aggregate-egress violation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1155-cli-"));
    try {
      const r1149Path = path.join(tmp, "r1149.json");
      await writeJson(r1149Path, r1149Fixture());
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1155-ordinary-consumer-safe-confirmation-feature-only-smoke-proof.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1149_ORDINARY_CONSUMER_LAB_WEARABLE_SUBMISSION_KIT_PATH: r1149Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        featureOnlyCoverageContextReadyForResearchPlanning: boolean;
        modelEvidencePromotionAllowed: boolean;
        nextAction: string;
        packetId: string;
        safeAvailabilityConfirmationConclusion: string;
        smokeEvidence: boolean;
      };
      expect(summary).toMatchObject({
        conclusion: "ordinary_safe_confirmation_feature_only_smoke_passed_non_evidence",
        featureOnlyCoverageContextReadyForResearchPlanning: true,
        modelEvidencePromotionAllowed: false,
        nextAction: "use_r1150_r1153_path_with_real_safe_availability_confirmation",
        packetId: "r1155-ordinary-consumer-safe-confirmation-feature-only-smoke-proof",
        safeAvailabilityConfirmationConclusion: "safe_availability_confirmation_feature_only_ready_research_only",
        smokeEvidence: false,
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("outputPath");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function r1149Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: safeBoundary(),
    ordinaryConsumerSubmissionKit: {
      commands: {
        featureOnlySubmissionModeCommand:
          "pnpm exec tsx scripts/murph-age/r1151-ordinary-consumer-feature-only-submission-mode.ts",
      },
      featureOnlySubmissionMode: {
        conclusion: "ordinary_feature_only_mode_waiting_on_safe_availability_confirmation",
        featureOnlyCoverageContextAllowed: false,
        modelEvidencePromotionAllowed: false,
        outcomeLinkedEvidenceReady: false,
        privateDetailsStored: false,
        supportedFeatureFamilyIds: [],
      },
    },
    packetId: "r1149-ordinary-consumer-lab-wearable-submission-kit",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1149-ordinary-consumer-lab-wearable-submission-kit.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "ordinary_consumer_lab_wearable_submission_kit_waiting_on_safe_availability_confirmation",
      featureOnlyModeConclusion: "ordinary_feature_only_mode_waiting_on_safe_availability_confirmation",
      featureOnlyModeModelEvidencePromotionAllowed: false,
      featureOnlyModeOutcomeLinkedEvidenceReady: false,
      nextAction: "fill_safe_availability_confirmation_from_template",
      productDisplayAuthorized: false,
      readyForResearchReview: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1149: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function safeBoundary(): Record<string, boolean> {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    fileNamesStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    privateConfigValuesStored: false,
    privateFieldRefValuesStored: false,
    privateFieldRefsStored: false,
    privateTableRefValuesStored: false,
    privateTableRefsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowLevelDataAcceptedByR1149: false,
    rowParsingPerformedByR1149: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}
