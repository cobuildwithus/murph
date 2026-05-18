import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1156_SAFE_CONFIRMATION_HANDOFF_COMMAND,
  R1156_ORDINARY_CONSUMER_SAFE_CONFIRMATION_HANDOFF_SCHEMA_VERSION,
  runR1156OrdinaryConsumerSafeConfirmationHandoff,
} from "./r1156-ordinary-consumer-safe-confirmation-handoff.ts";

const FEATURE_ONLY_SOURCE_FAMILY_IDS = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
];
const REQUIRED_SAFE_COMPLETION_CHECK_IDS = [
  "confirm_target_age_band_without_identifiers",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
  "confirm_outcome_linkage_and_time_alignment_if_model_evidence",
  "confirm_aggregate_count_bands_if_model_evidence",
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
const FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS = [
  "aggregateReadinessFacts.targetAgeBand",
  "sourceFamilies[bloodwork_glycemia].available",
  "sourceFamilies[wearable_activity_daily].available",
  "rowOwnerAssertionsConfirmed",
  ...REQUIRED_ATTESTATION_KEYS.map((key) => `attestations.${key}`),
];
const R1150_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_COMMAND =
  "MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_PATH=<safe-availability-confirmation.json> pnpm exec tsx scripts/murph-age/r1150-ordinary-consumer-safe-availability-confirmation-intake.ts";
const R1153_FEATURE_ONLY_CHAIN_RUNNER_COMMAND =
  "MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_PATH=<safe-availability-confirmation.json> pnpm exec tsx scripts/murph-age/r1153-ordinary-consumer-feature-only-chain-runner.ts";
const R1144_OUTCOME_LINKED_RECIPE_READINESS_COMMAND =
  "MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_PATH=<r1150-intake.json> MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ID=lab_plus_wearable_minimum_manifest pnpm exec tsx scripts/murph-age/r1144-ordinary-consumer-recipe-readiness-chain-runner.ts";

describe("R1156 ordinary consumer safe confirmation handoff", () => {
  it("creates a pathless row-owner handoff for ordinary lab plus wearable safe confirmation", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1156-ready-"));
    try {
      const r1150Path = path.join(tmp, "r1150.json");
      const r1154Path = path.join(tmp, "r1154.json");
      const r1155Path = path.join(tmp, "r1155.json");
      await Promise.all([
        writeJson(r1150Path, r1150Fixture()),
        writeJson(r1154Path, r1154Fixture()),
        writeJson(r1155Path, r1155Fixture()),
      ]);

      const { output, outputPath } = await runR1156OrdinaryConsumerSafeConfirmationHandoff({
        createdAt: "2026-05-17T15:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        r1150Path,
        r1154Path,
        r1155Path,
      });

      expect(path.basename(outputPath)).toBe(
        "r1156-ordinary-consumer-safe-confirmation-handoff.latest.json",
      );
      expect(output.schemaVersion).toBe(
        R1156_ORDINARY_CONSUMER_SAFE_CONFIRMATION_HANDOFF_SCHEMA_VERSION,
      );
      expect(output.summary).toMatchObject({
        conclusion: "ordinary_safe_confirmation_handoff_ready_for_row_owner_fill_non_evidence",
        featureOnlyPathMechanicallyProven: true,
        featureOnlyQuickstartArtifact: "r1154-feature-only-safe-confirmation-quickstart.json",
        featureOnlyQuickstartSafeFieldEditPaths: FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS,
        handoffReadyForRowOwner: true,
        modelEvidencePromotionAllowed: false,
        nextAction: "fill_safe_availability_confirmation_from_template",
        optionalAddOnFamilyIds: ["common_bloodwork_core", "vitals_body_context"],
        productDisplayAuthorized: false,
        readyForModelEvidence: false,
        readyForRecipeReadinessChain: false,
        requiredAttestationKeys: REQUIRED_ATTESTATION_KEYS,
        requiredFeatureOnlySourceFamilyIds: FEATURE_ONLY_SOURCE_FAMILY_IDS,
        requiredSafeCompletionCheckIds: REQUIRED_SAFE_COMPLETION_CHECK_IDS,
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1156: false,
        rowOwnerWorkType: "fill_safe_availability_confirmation",
        rowParsingPerformedByR1156: false,
        safeAvailabilityActionPacketConclusion: "safe_availability_action_packet_waiting_on_safe_confirmation",
        safeAvailabilityActionPacketNextAction: "fill_safe_availability_confirmation_from_template",
        safeConfirmationHandoffCommand: R1156_SAFE_CONFIRMATION_HANDOFF_COMMAND,
        safeConfirmationFeatureOnlySmokeProofConclusion:
          "ordinary_safe_confirmation_feature_only_smoke_passed_non_evidence",
        safeConfirmationStillRequired: true,
        smokeEvidence: false,
        targetAgeBand: "roughly_16_50",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      });
      expect(output.safeConfirmationHandoff).toMatchObject({
        blockedConfirmationContent: [
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
        ],
        featureOnlyFillableTemplateArtifact: "r1150-fillable-feature-only-safe-availability-confirmation.json",
        fullFillableTemplateArtifact: "r1150-fillable-ordinary-consumer-safe-availability-confirmation.json",
        handoffReadyForRowOwner: true,
        outcomeLinkageRequiredForFeatureOnlyContext: false,
        preferredRecipeId: "lab_plus_wearable_minimum_manifest",
        safeAvailabilityConfirmationIntakeCommand: R1150_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_COMMAND,
        safeAvailabilityFeatureOnlyChainRunnerCommand: R1153_FEATURE_ONLY_CHAIN_RUNNER_COMMAND,
        safeAvailabilityOutcomeLinkedRecipeReadinessCommand: R1144_OUTCOME_LINKED_RECIPE_READINESS_COMMAND,
      });
      expect(output.safeConfirmationHandoff.commands).toEqual({
        safeAvailabilityConfirmationIntakeCommand: R1150_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_COMMAND,
        safeAvailabilityFeatureOnlyChainRunnerCommand: R1153_FEATURE_ONLY_CHAIN_RUNNER_COMMAND,
        safeAvailabilityOutcomeLinkedRecipeReadinessCommand: R1144_OUTCOME_LINKED_RECIPE_READINESS_COMMAND,
        safeConfirmationHandoffCommand: R1156_SAFE_CONFIRMATION_HANDOFF_COMMAND,
      });
      expect(R1156_SAFE_CONFIRMATION_HANDOFF_COMMAND).toContain(
        "r1156-ordinary-consumer-safe-confirmation-handoff.ts",
      );
      expect(R1156_SAFE_CONFIRMATION_HANDOFF_COMMAND).not.toContain(tmp);
      expect(output.safeConfirmationHandoff.rowOwnerActionItems.map((item) => item.actionId)).toEqual([
        "confirm_target_age_band_only",
        "confirm_ordinary_glycemia_bloodwork_export_available",
        "confirm_phone_watch_or_wearable_activity_export_available",
        "confirm_no_private_values_or_identifiers_are_entered",
        "optional_confirm_outcome_linkage_for_model_evidence",
        "optional_confirm_usable_count_bands_for_model_evidence",
      ]);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = JSON.parse(await readFile(outputPath, "utf8")) as unknown;
      expect(findForbiddenAggregateEgress(persisted)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes to the feature-only smoke proof when that non-evidence guard is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1156-missing-smoke-"));
    try {
      const r1150Path = path.join(tmp, "r1150.json");
      const r1154Path = path.join(tmp, "r1154.json");
      const r1155Path = path.join(tmp, "r1155.json");
      await Promise.all([
        writeJson(r1150Path, r1150Fixture()),
        writeJson(r1154Path, r1154Fixture()),
      ]);

      const { output } = await runR1156OrdinaryConsumerSafeConfirmationHandoff({
        outputDir: path.join(tmp, "out"),
        r1150Path,
        r1154Path,
        r1155Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_safe_confirmation_handoff_waiting_on_feature_only_smoke_proof",
        featureOnlyPathMechanicallyProven: false,
        handoffReadyForRowOwner: false,
        nextAction: "refresh_r1155_safe_confirmation_feature_only_smoke_proof",
        rowOwnerWorkType: "refresh_safe_confirmation_handoff_inputs",
        safeConfirmationFeatureOnlySmokeProofConclusion: null,
        safeConfirmationStillRequired: true,
      });
      expect(output.inputArtifacts.r1155).toMatchObject({
        packetId: null,
        schemaVersion: null,
        status: "missing",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("keeps a confirmed safe availability state as non-evidence and routes to the next safe chain step", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1156-next-step-"));
    try {
      const r1150Path = path.join(tmp, "r1150.json");
      const r1154Path = path.join(tmp, "r1154.json");
      const r1155Path = path.join(tmp, "r1155.json");
      await Promise.all([
        writeJson(r1150Path, r1150Fixture({ ready: true })),
        writeJson(r1154Path, r1154Fixture({ ready: true })),
        writeJson(r1155Path, r1155Fixture()),
      ]);

      const { output } = await runR1156OrdinaryConsumerSafeConfirmationHandoff({
        outputDir: path.join(tmp, "out"),
        r1150Path,
        r1154Path,
        r1155Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_safe_confirmation_handoff_ready_for_feature_only_or_recipe_next_step_non_evidence",
        handoffReadyForRowOwner: true,
        modelEvidencePromotionAllowed: false,
        nextAction: "run_r1144_recipe_readiness_chain_with_confirmed_availability",
        readyForModelEvidence: false,
        readyForRecipeReadinessChain: true,
        rowOwnerWorkType: "run_feature_only_or_recipe_next_step",
        safeConfirmationStillRequired: false,
        smokeEvidence: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe inputs with a sanitized error", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1156-unsafe-"));
    try {
      const r1150Path = path.join(tmp, "r1150.json");
      const r1154Path = path.join(tmp, "r1154.json");
      const r1155Path = path.join(tmp, "r1155.json");
      await Promise.all([
        writeJson(r1150Path, r1150Fixture()),
        writeJson(r1154Path, {
          ...r1154Fixture(),
          artifactBoundary: {
            ...safeBoundary("R1154"),
            rowValuesStored: true,
          },
        }),
        writeJson(r1155Path, r1155Fixture()),
      ]);

      await expect(runR1156OrdinaryConsumerSafeConfirmationHandoff({
        outputDir: path.join(tmp, "out"),
        r1150Path,
        r1154Path,
        r1155Path,
      })).rejects.toThrow("R1156 rejected unsafe r1154 input: 1 aggregate-egress violation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1156-cli-"));
    try {
      const r1150Path = path.join(tmp, "r1150.json");
      const r1154Path = path.join(tmp, "r1154.json");
      const r1155Path = path.join(tmp, "r1155.json");
      await Promise.all([
        writeJson(r1150Path, r1150Fixture()),
        writeJson(r1154Path, r1154Fixture()),
        writeJson(r1155Path, r1155Fixture()),
      ]);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1156-ordinary-consumer-safe-confirmation-handoff.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_PATH: r1150Path,
          MURPH_AGE_R1154_ORDINARY_CONSUMER_SAFE_AVAILABILITY_ACTION_PACKET_PATH: r1154Path,
          MURPH_AGE_R1155_ORDINARY_CONSUMER_SAFE_CONFIRMATION_FEATURE_ONLY_SMOKE_PROOF_PATH: r1155Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        featureOnlyPathMechanicallyProven: boolean;
        handoffReadyForRowOwner: boolean;
        nextAction: string;
        rowLevelDataAcceptedByR1156: boolean;
        safeConfirmationHandoffCommand: string;
        smokeEvidence: boolean;
      };
      expect(summary).toMatchObject({
        conclusion: "ordinary_safe_confirmation_handoff_ready_for_row_owner_fill_non_evidence",
        featureOnlyPathMechanicallyProven: true,
        handoffReadyForRowOwner: true,
        nextAction: "fill_safe_availability_confirmation_from_template",
        rowLevelDataAcceptedByR1156: false,
        safeConfirmationHandoffCommand: R1156_SAFE_CONFIRMATION_HANDOFF_COMMAND,
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

function r1150Fixture(options: { ready?: boolean } = {}): Record<string, unknown> {
  const ready = options.ready === true;
  return {
    artifactBoundary: {
      ...safeBoundary("R1150"),
      availabilityConfirmationPathStored: false,
      fileNamesStored: false,
      headerValuesStored: false,
      privateConfigValuesStored: false,
      privateFieldRefValuesStored: false,
      privateFieldRefsStored: false,
      privateTableRefValuesStored: false,
      privateTableRefsStored: false,
      rowLevelDataAcceptedByR1150: false,
      rowParsingPerformedByR1150: false,
      sourceFileNamesStored: false,
      sourceVariableNamesStored: false,
    },
    packetId: "r1150-ordinary-consumer-safe-availability-confirmation-intake",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1150-ordinary-consumer-safe-availability-confirmation-intake.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: ready
        ? "safe_availability_confirmation_ready_for_recipe_readiness_chain"
        : "safe_availability_confirmation_not_provided",
      featureOnlyCoverageContextReady: ready,
      nextAction: ready
        ? "run_r1144_recipe_readiness_chain_with_confirmed_availability"
        : "fill_safe_availability_confirmation_from_template",
      productDisplayAuthorized: false,
      readyForRecipeReadinessChain: ready,
      rowLevelDataAcceptedByR1150: false,
      rowOwnerAssertionsConfirmed: ready ? true : null,
      rowParsingPerformedByR1150: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1154Fixture(options: { ready?: boolean } = {}): Record<string, unknown> {
  const ready = options.ready === true;
  return {
    artifactBoundary: {
      ...safeBoundary("R1154"),
      availabilityConfirmationPathStored: false,
      fileNamesStored: false,
      headerValuesStored: false,
      privateConfigValuesStored: false,
      privateFieldRefValuesStored: false,
      privateFieldRefsStored: false,
      privateTableRefValuesStored: false,
      privateTableRefsStored: false,
      rowLevelDataAcceptedByR1154: false,
      rowParsingPerformedByR1154: false,
      sourceFileNamesStored: false,
      sourceVariableNamesStored: false,
    },
    packetId: "r1154-ordinary-consumer-safe-availability-action-packet",
    productDisplayAuthorized: false,
    safeAvailabilityActionPacket: {
      commands: {
        featureOnlyChainRunnerCommand: R1153_FEATURE_ONLY_CHAIN_RUNNER_COMMAND,
        outcomeLinkedRecipeReadinessCommand: R1144_OUTCOME_LINKED_RECIPE_READINESS_COMMAND,
        safeAvailabilityConfirmationIntakeCommand: R1150_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_COMMAND,
      },
    },
    schemaVersion: "murph-age-r1154-ordinary-consumer-safe-availability-action-packet.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: ready
        ? "safe_availability_action_packet_ready_for_outcome_linked_recipe_readiness"
        : "safe_availability_action_packet_waiting_on_safe_confirmation",
      featureOnlyCoverageContextReady: ready,
      featureOnlyFillableTemplateArtifact: "r1150-fillable-feature-only-safe-availability-confirmation.json",
      featureOnlyQuickstartArtifact: "r1154-feature-only-safe-confirmation-quickstart.json",
      featureOnlyQuickstartSafeFieldEditCount: FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS.length,
      featureOnlyQuickstartSafeFieldEditPaths: FEATURE_ONLY_SAFE_FIELD_EDIT_PATHS,
      fillableTemplateArtifact: "r1150-fillable-ordinary-consumer-safe-availability-confirmation.json",
      minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      missingAttestationKeys: ready ? [] : REQUIRED_ATTESTATION_KEYS,
      missingFeatureOnlySourceFamilyIds: ready ? [] : FEATURE_ONLY_SOURCE_FAMILY_IDS,
      nextAction: ready
        ? "run_r1144_recipe_readiness_chain_with_confirmed_availability"
        : "fill_safe_availability_confirmation_from_template",
      productDisplayAuthorized: false,
      readyForOutcomeLinkedRecipeReadinessChain: ready,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1154: false,
      rowOwnerAssertionsConfirmed: ready ? true : null,
      rowOwnerWorkType: ready
        ? "run_outcome_linked_recipe_readiness"
        : "fill_safe_availability_confirmation",
      rowParsingPerformedByR1154: false,
      safeAvailabilityConfirmationTemplateArtifact:
        "r1150-fillable-ordinary-consumer-safe-availability-confirmation.json",
      safeAvailabilityConfirmationStatus: ready ? "available" : "missing",
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function r1155Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      ...safeBoundary("R1155"),
      confirmationPathStored: false,
      confirmationValuesStored: false,
      contextPathStored: false,
      featureValuesStored: false,
      fileNamesStored: false,
      privateFieldRefValuesStored: false,
      privateTableRefValuesStored: false,
      rowLevelDataAcceptedByR1155: false,
      rowParsingPerformedByR1155: false,
      temporaryConfirmationPersisted: false,
    },
    packetId: "r1155-ordinary-consumer-safe-confirmation-feature-only-smoke-proof",
    productDisplayAuthorized: false,
    safeConfirmationFeatureOnlySmokeProof: {
      modelEvidencePromotionAllowed: false,
      outcomeLinkedEvidenceIncludedInSmoke: false,
      productDisplayAuthorized: false,
      temporaryConfirmationValuesPersistedInArtifact: false,
    },
    schemaVersion: "murph-age-r1155-ordinary-consumer-safe-confirmation-feature-only-smoke-proof.v1",
    status: "research-local-aggregate-only",
    summary: {
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
    },
  };
}

function safeBoundary(stage: "R1150" | "R1154" | "R1155"): Record<string, boolean> {
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
    recommendationClaimsIncluded: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
    [`rowParsingPerformedBy${stage}`]: false,
  };
}
