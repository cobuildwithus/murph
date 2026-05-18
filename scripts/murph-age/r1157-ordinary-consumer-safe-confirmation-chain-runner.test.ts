import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1157_ORDINARY_CONSUMER_SAFE_CONFIRMATION_CHAIN_RUNNER_SCHEMA_VERSION,
  R1157_SAFE_CONFIRMATION_CHAIN_RUNNER_COMMAND,
  runR1157OrdinaryConsumerSafeConfirmationChainRunner,
} from "./r1157-ordinary-consumer-safe-confirmation-chain-runner.ts";

const CONFIRMATION_SCHEMA_VERSION =
  "murph-age-r1150-ordinary-consumer-safe-availability-confirmation.v1";
const FEATURE_ONLY_SOURCE_FAMILY_IDS = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
];
const REQUIRED_SOURCE_FAMILY_IDS = [
  "outcome_linkage",
  "join_time_alignment",
  "bloodwork_glycemia",
  "wearable_activity_daily",
];
const OPTIONAL_ADD_ON_FAMILY_IDS = [
  "common_bloodwork_core",
  "vitals_body_context",
];
const REQUIRED_ATTESTATION_KEYS = [
  "aggregateOnly",
  "localOnly",
  "noCoefficientEgress",
  "noHeaderNameEgress",
  "noParticipantEgress",
  "noPredictionEgress",
  "noPrivatePathEgress",
  "noPrivateRefValueEgress",
  "noRowEgress",
  "noSmallCellEgress",
  "noSourceTextEgress",
];
const BLOCKED_CONFIRMATION_CONTENT = [
  "private_paths",
  "header_names",
  "private_ref_values",
  "source_variable_names",
  "file_names",
  "row_values",
  "participant_identifiers",
  "predictions",
  "coefficients",
  "source_text",
];
const R1151_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1151-ordinary-consumer-feature-only-submission-mode.ts";

describe("R1157 ordinary consumer safe confirmation chain runner", () => {
  it("runs the safe chain without a confirmation and preserves the row-owner blocker", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1157-missing-"));
    try {
      const r1149Path = path.join(tmp, "r1149.json");
      await writeJson(r1149Path, r1149Fixture());

      const { output, outputPath } = await runR1157OrdinaryConsumerSafeConfirmationChainRunner({
        createdAt: "2026-05-17T18:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        r1149Path,
      });

      expect(path.basename(outputPath)).toBe(
        "r1157-ordinary-consumer-safe-confirmation-chain-runner.latest.json",
      );
      expect(output.schemaVersion).toBe(
        R1157_ORDINARY_CONSUMER_SAFE_CONFIRMATION_CHAIN_RUNNER_SCHEMA_VERSION,
      );
      expect(output.summary).toMatchObject({
        conclusion: "ordinary_safe_confirmation_chain_waiting_on_safe_confirmation",
        confirmationPathConfigured: false,
        featureOnlyCoverageContextReady: false,
        featureOnlyResearchPlanningReady: false,
        modelEvidencePromotionAllowed: false,
        nextAction: "fill_safe_availability_confirmation_from_template",
        productDisplayAuthorized: false,
        readyForModelEvidence: false,
        readyForRecipeReadinessChain: false,
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1157: false,
        rowParsingPerformedByR1157: false,
        safeAvailabilityActionPacketConclusion: "safe_availability_action_packet_waiting_on_safe_confirmation",
        safeAvailabilityConfirmationConclusion: "safe_availability_confirmation_not_provided",
        safeConfirmationChainRunnerCommand: R1157_SAFE_CONFIRMATION_CHAIN_RUNNER_COMMAND,
        safeConfirmationHandoffConclusion: "ordinary_safe_confirmation_handoff_ready_for_row_owner_fill_non_evidence",
        safeConfirmationStillRequired: true,
        targetAgeBand: "roughly_16_50",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      });
      expect(output.safeConfirmationChainRunner.stageConclusions).toMatchObject({
        r1150: "safe_availability_confirmation_not_provided",
        r1153: "ordinary_feature_only_chain_waiting_on_safe_availability_confirmation",
        r1154: "safe_availability_action_packet_waiting_on_safe_confirmation",
        r1155: "ordinary_safe_confirmation_feature_only_smoke_passed_non_evidence",
        r1156: "ordinary_safe_confirmation_handoff_ready_for_row_owner_fill_non_evidence",
      });
      expect(output.safeConfirmationChainRunner.commands.safeConfirmationChainRunnerCommand)
        .toBe(R1157_SAFE_CONFIRMATION_CHAIN_RUNNER_COMMAND);
      expect(output.safeConfirmationChainRunner.commands.safeConfirmationHandoffCommand)
        .toContain("r1156-ordinary-consumer-safe-confirmation-handoff.ts");
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = JSON.parse(await readFile(outputPath, "utf8")) as unknown;
      expect(findForbiddenAggregateEgress(persisted)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("runs the compact feature-only lab plus wearable confirmation through R1153 and R1156", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1157-feature-only-"));
    try {
      const r1149Path = path.join(tmp, "r1149.json");
      const confirmationPath = path.join(tmp, "safe-confirmation.json");
      await Promise.all([
        writeJson(r1149Path, r1149Fixture()),
        writeJson(confirmationPath, compactFeatureOnlyConfirmationFixture()),
      ]);

      const { output } = await runR1157OrdinaryConsumerSafeConfirmationChainRunner({
        confirmationPath,
        outputDir: path.join(tmp, "out"),
        r1149Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_safe_confirmation_chain_feature_only_ready_non_evidence",
        confirmationPathConfigured: true,
        featureOnlyCoverageContextReady: true,
        featureOnlyResearchPlanningReady: true,
        modelEvidencePromotionAllowed: false,
        nextAction: "use_r1153_feature_only_chain_output_for_research_planning",
        productDisplayAuthorized: false,
        readyForModelEvidence: false,
        readyForRecipeReadinessChain: false,
        reviewGptRequiredNow: false,
        safeAvailabilityActionPacketConclusion: "safe_availability_action_packet_feature_only_context_available",
        safeAvailabilityConfirmationConclusion: "safe_availability_confirmation_feature_only_ready_research_only",
        safeConfirmationHandoffConclusion:
          "ordinary_safe_confirmation_handoff_ready_for_feature_only_or_recipe_next_step_non_evidence",
        safeConfirmationStillRequired: false,
      });
      expect(output.safeConfirmationChainRunner.stageConclusions).toMatchObject({
        r1153: "ordinary_feature_only_chain_ready_research_only",
        r1154: "safe_availability_action_packet_feature_only_context_available",
        r1156: "ordinary_safe_confirmation_handoff_ready_for_feature_only_or_recipe_next_step_non_evidence",
      });
      expect(output.safeConfirmationChainRunner.stageNextActions).toMatchObject({
        r1150: "run_r1153_feature_only_chain_with_safe_availability",
        r1154: "run_r1153_feature_only_chain_with_safe_availability",
        r1156: "run_r1153_feature_only_chain_with_safe_availability",
      });
      expect(output.safeConfirmationChainRunner.featureOnlyResearchPlanningReady).toBe(true);
      expect(output.safeConfirmationChainRunner.readyForModelEvidence).toBe(false);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(output)).not.toContain("safe-confirmation.json");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1157-cli-"));
    try {
      const r1149Path = path.join(tmp, "r1149.json");
      const confirmationPath = path.join(tmp, "safe-confirmation.json");
      await Promise.all([
        writeJson(r1149Path, r1149Fixture()),
        writeJson(confirmationPath, compactFeatureOnlyConfirmationFixture()),
      ]);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1157-ordinary-consumer-safe-confirmation-chain-runner.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1149_ORDINARY_CONSUMER_LAB_WEARABLE_SUBMISSION_KIT_PATH: r1149Path,
          MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_PATH: confirmationPath,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        featureOnlyResearchPlanningReady: boolean;
        nextAction: string;
        readyForModelEvidence: boolean;
        safeConfirmationChainRunnerCommand: string;
      };
      expect(summary).toMatchObject({
        conclusion: "ordinary_safe_confirmation_chain_feature_only_ready_non_evidence",
        featureOnlyResearchPlanningReady: true,
        nextAction: "use_r1153_feature_only_chain_output_for_research_planning",
        readyForModelEvidence: false,
        safeConfirmationChainRunnerCommand: R1157_SAFE_CONFIRMATION_CHAIN_RUNNER_COMMAND,
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
  const featureOnlySubmissionMode = {
    conclusion: "ordinary_feature_only_mode_waiting_on_safe_availability_confirmation",
    featureOnlyCoverageContextAllowed: false,
    modelEvidencePromotionAllowed: false,
    outcomeLinkedEvidenceReady: false,
    privateDetailsStored: false,
    supportedFeatureFamilyIds: [],
  };
  return {
    packetId: "r1149-ordinary-consumer-lab-wearable-submission-kit",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1149-ordinary-consumer-lab-wearable-submission-kit.v1",
    status: "research-local-aggregate-only",
    ordinaryConsumerSubmissionKit: {
      commands: {
        featureOnlySubmissionModeCommand: R1151_COMMAND,
      },
      featureOnlySubmissionMode,
    },
    summary: {
      expectedRouteIds: [
        "lab_glycemia_minimum_route",
        "wearable_activity_minimum_route",
      ],
      featureOnlyModeConclusion: featureOnlySubmissionMode.conclusion,
      featureOnlyModeModelEvidencePromotionAllowed: featureOnlySubmissionMode.modelEvidencePromotionAllowed,
      featureOnlyModeOutcomeLinkedEvidenceReady: featureOnlySubmissionMode.outcomeLinkedEvidenceReady,
      featureOnlyModeSupportedFeatureFamilyIds: featureOnlySubmissionMode.supportedFeatureFamilyIds,
      nextAction: "confirm_lab_plus_wearable_recipe_availability_assertions",
      optionalAddOnFamilyIds: OPTIONAL_ADD_ON_FAMILY_IDS,
      productDisplayAuthorized: false,
      readyForResearchReview: false,
      requiredSourceFamilyIds: REQUIRED_SOURCE_FAMILY_IDS,
      rowOwnerAssertionsConfirmed: false,
      rowParsingPerformedByR1149: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function compactFeatureOnlyConfirmationFixture(): Record<string, unknown> {
  return {
    aggregateReadinessFacts: {
      eventCountBand: "not_confirmed",
      outcomeLinked: false,
      sameDenominator: false,
      targetAgeBand: "roughly_16_50",
      usableRecordCountBand: "not_confirmed",
    },
    attestations: Object.fromEntries(REQUIRED_ATTESTATION_KEYS.map((key) => [key, true])),
    blockedConfirmationContent: BLOCKED_CONFIRMATION_CONTENT,
    featureOnlyCoverageRequiresPreferredPair: true,
    minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
    outcomeLinkageRequiredForFeatureOnlyContext: false,
    recipeId: "lab_plus_wearable_minimum_manifest",
    rowOwnerAssertionsConfirmed: true,
    rowLevelDataAcceptedByR1150: false,
    schemaVersion: CONFIRMATION_SCHEMA_VERSION,
    sourceFamilies: FEATURE_ONLY_SOURCE_FAMILY_IDS.map((familyId) => ({
      available: true,
      familyId,
      requiredForFeatureOnlyPreferredPair: true,
      requiredForRecommendedRecipe: true,
      safeConfirmationMeaning: safeConfirmationMeaningFor(familyId),
    })),
    targetAgeBand: "roughly_16_50",
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
  };
}

function safeConfirmationMeaningFor(familyId: string): string {
  if (familyId === "bloodwork_glycemia") {
    return "The row owner has ordinary glycemia bloodwork fields such as glucose or HbA1c in an export or spreadsheet.";
  }
  return "The row owner has daily activity data from a watch, phone, or wearable export.";
}
