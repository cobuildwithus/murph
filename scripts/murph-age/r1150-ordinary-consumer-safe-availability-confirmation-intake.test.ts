import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_SCHEMA_VERSION,
  runR1150OrdinaryConsumerSafeAvailabilityConfirmationIntake,
} from "./r1150-ordinary-consumer-safe-availability-confirmation-intake.ts";

const CONFIRMATION_SCHEMA_VERSION =
  "murph-age-r1150-ordinary-consumer-safe-availability-confirmation.v1";
const REQUIRED_SOURCE_FAMILY_IDS = [
  "outcome_linkage",
  "join_time_alignment",
  "bloodwork_glycemia",
  "wearable_activity_daily",
];
const FEATURE_ONLY_SOURCE_FAMILY_IDS = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
];
const OPTIONAL_ADD_ON_FAMILY_IDS = [
  "common_bloodwork_core",
  "vitals_body_context",
];
const ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS = [
  "confirm_target_age_band_without_identifiers",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
  "confirm_outcome_linkage_and_time_alignment_if_model_evidence",
  "confirm_aggregate_count_bands_if_model_evidence",
];
const ORDINARY_SUBMITTER_COMPLETION_MODE_IDS = [
  "feature_only_lab_wearable_coverage",
  "outcome_linked_lab_wearable_model_evidence",
];
const EXPECTED_ROUTE_IDS = [
  "lab_glycemia_minimum_route",
  "wearable_activity_minimum_route",
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

describe("R1150 ordinary consumer safe availability confirmation intake", () => {
  it("writes a fillable safe confirmation template when no confirmation is supplied", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1150-missing-"));
    try {
      const r1149Path = path.join(tmp, "r1149.json");
      await writeJson(r1149Path, r1149Fixture());

      const { featureOnlyTemplatePath, output, outputPath, templatePath } =
        await runR1150OrdinaryConsumerSafeAvailabilityConfirmationIntake({
          createdAt: "2026-05-17T00:00:00.000Z",
          outputDir: path.join(tmp, "out"),
          r1149Path,
        });

      expect(path.basename(outputPath)).toBe(
        "r1150-ordinary-consumer-safe-availability-confirmation-intake.latest.json",
      );
      expect(path.basename(templatePath)).toBe(
        "r1150-fillable-ordinary-consumer-safe-availability-confirmation.json",
      );
      expect(path.basename(featureOnlyTemplatePath)).toBe(
        "r1150-fillable-feature-only-safe-availability-confirmation.json",
      );
      expect(output.schemaVersion).toBe(
        R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_SCHEMA_VERSION,
      );
      expect(output.summary).toMatchObject({
        conclusion: "safe_availability_confirmation_not_provided",
        confirmationPathConfigured: false,
        confirmationStatus: "missing",
        expectedRouteIds: EXPECTED_ROUTE_IDS,
        featureOnlyCoverageContextReady: false,
        featureOnlyCoverageRequiresPreferredPair: true,
        minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
        missingAggregateReadinessFactIds: [
          "outcomeLinked",
          "sameDenominator",
          "targetAgeBand",
          "usableRecordCountBand",
          "eventCountBand",
        ],
        missingAttestationKeys: REQUIRED_ATTESTATION_KEYS,
        missingFeatureOnlySourceFamilyIds: FEATURE_ONLY_SOURCE_FAMILY_IDS,
        missingRequiredSourceFamilyIds: REQUIRED_SOURCE_FAMILY_IDS,
        nextAction: "fill_safe_availability_confirmation_from_template",
        outcomeLinkageRequiredForFeatureOnlyContext: false,
        ordinarySubmitterCompletionModeIds: ORDINARY_SUBMITTER_COMPLETION_MODE_IDS,
        ordinarySubmitterSafeCompletionChecklistItemIds: ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS,
        productDisplayAuthorized: false,
        r1149SubmitterKitFeatureOnlyGuardPresent: true,
        r1149SubmitterKitReadyForSafeConfirmation: true,
        readyForRecipeReadinessChain: false,
        reviewGptRequiredNow: false,
        rowOwnerAssertionsConfirmed: null,
        rowLevelDataAcceptedByR1150: false,
        rowParsingPerformedByR1150: false,
        targetAgeBand: "roughly_16_50",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
        templateArtifact: "r1150-fillable-ordinary-consumer-safe-availability-confirmation.json",
        featureOnlyTemplateArtifact: "r1150-fillable-feature-only-safe-availability-confirmation.json",
      });
      expect(output.safeAvailabilityConfirmationIntake.requiredSourceFamilyIds).toEqual(
        REQUIRED_SOURCE_FAMILY_IDS,
      );
      expect(output.safeAvailabilityConfirmationIntake.optionalAddOnFamilyIds).toEqual(
        OPTIONAL_ADD_ON_FAMILY_IDS,
      );
      expect(output.safeAvailabilityConfirmationIntake).toMatchObject({
        featureOnlyCoverageContextReady: false,
        featureOnlyCoverageRequiresPreferredPair: true,
        minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
        outcomeLinkageRequiredForFeatureOnlyContext: false,
        rowLevelDataAcceptedByR1150: false,
      });

      const template = JSON.parse(await readFile(templatePath, "utf8")) as Record<string, unknown>;
      expect(template).toMatchObject({
        featureOnlyCoverageRequiresPreferredPair: true,
        minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
        outcomeLinkageRequiredForFeatureOnlyContext: false,
        recipeId: "lab_plus_wearable_minimum_manifest",
        rowOwnerAssertionsConfirmed: false,
        rowLevelDataAcceptedByR1150: false,
        schemaVersion: CONFIRMATION_SCHEMA_VERSION,
        targetAgeBand: "roughly_16_50",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      });
      const sourceFamilies = readArrayAt(template, ["sourceFamilies"]);
      expect(sourceFamilies
        .filter((family) => readBooleanAt(family, ["requiredForFeatureOnlyPreferredPair"]) === true)
        .map((family) => readStringAt(family, ["familyId"]))).toEqual(FEATURE_ONLY_SOURCE_FAMILY_IDS);
      const inputKinds = readArrayAt(template, ["ordinarySubmitterInputKinds"]);
      expect(inputKinds.map((kind) => readStringAt(kind, ["inputKindId"]))).toEqual([
        "lab_portal_export_or_spreadsheet",
        "phone_watch_or_wearable_activity_export",
        "optional_vitals_or_body_context",
      ]);
      expect(inputKinds.filter((kind) =>
        readBooleanAt(kind, ["requiredForFeatureOnlyPreferredPair"]) === true
      )).toHaveLength(2);
      const completionModes = readArrayAt(template, ["ordinarySubmitterCompletionModes"]);
      expect(completionModes.map((mode) => readStringAt(mode, ["modeId"]))).toEqual(
        ORDINARY_SUBMITTER_COMPLETION_MODE_IDS,
      );
      expect(completionModes
        .find((mode) => readStringAt(mode, ["modeId"]) === "feature_only_lab_wearable_coverage"))
        .toMatchObject({
          modelEvidenceCandidate: false,
          nextActionAfterR1150: "run_r1153_feature_only_chain",
          outcomeLinkageRequired: false,
          privateDetailsStored: false,
          rowLevelDataAccepted: false,
        });
      expect(completionModes
        .find((mode) => readStringAt(mode, ["modeId"]) === "outcome_linked_lab_wearable_model_evidence"))
        .toMatchObject({
          modelEvidenceCandidate: true,
          nextActionAfterR1150: "run_r1144_recipe_readiness_chain",
          outcomeLinkageRequired: true,
          privateDetailsStored: false,
          rowLevelDataAccepted: false,
        });
      const completionChecklist = readArrayAt(template, ["ordinarySubmitterSafeCompletionChecklist"]);
      expect(completionChecklist.map((item) => readStringAt(item, ["checkId"]))).toEqual(
        ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS,
      );
      expect(completionChecklist
        .filter((item) => readBooleanAt(item, ["requiredForFeatureOnlyPreferredPair"]) === true)
        .map((item) => readStringAt(item, ["checkId"]))).toEqual([
          "confirm_target_age_band_without_identifiers",
          "confirm_glycemia_bloodwork_export_available",
          "confirm_daily_wearable_activity_export_available",
          "confirm_no_private_values_in_confirmation",
        ]);
      expect(output.safeAvailabilityConfirmationIntake.ordinarySubmitterSafeCompletionChecklist
        .map((item) => item.checkId)).toEqual(ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS);
      expect(output.safeAvailabilityConfirmationIntake.ordinarySubmitterCompletionModes
        .map((mode) => mode.modeId)).toEqual(ORDINARY_SUBMITTER_COMPLETION_MODE_IDS);
      expect(JSON.stringify(template)).not.toContain(tmp);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const featureOnlyTemplate = JSON.parse(await readFile(featureOnlyTemplatePath, "utf8")) as Record<string, unknown>;
      expect(featureOnlyTemplate).toMatchObject({
        featureOnlyCoverageRequiresPreferredPair: true,
        minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
        outcomeLinkageRequiredForFeatureOnlyContext: false,
        recipeId: "lab_plus_wearable_minimum_manifest",
        rowOwnerAssertionsConfirmed: false,
        rowLevelDataAcceptedByR1150: false,
        schemaVersion: CONFIRMATION_SCHEMA_VERSION,
        targetAgeBand: "roughly_16_50",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      });
      expect(featureOnlyTemplate).not.toHaveProperty("ordinarySubmitterCompletionModes");
      expect(featureOnlyTemplate).not.toHaveProperty("ordinarySubmitterInputKinds");
      expect(featureOnlyTemplate).not.toHaveProperty("ordinarySubmitterSafeCompletionChecklist");
      expect(readArrayAt(featureOnlyTemplate, ["sourceFamilies"]).map((family) =>
        readStringAt(family, ["familyId"])
      )).toEqual(FEATURE_ONLY_SOURCE_FAMILY_IDS);
      expect(JSON.stringify(featureOnlyTemplate)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("accepts a safe lab-plus-wearable confirmation for the recipe-readiness chain", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1150-ready-"));
    try {
      const r1149Path = path.join(tmp, "r1149.json");
      const confirmationPath = path.join(tmp, "safe-confirmation.json");
      await Promise.all([
        writeJson(r1149Path, r1149Fixture()),
        writeJson(confirmationPath, confirmationFixture({ includeTemplateGuidance: true })),
      ]);

      const { output } = await runR1150OrdinaryConsumerSafeAvailabilityConfirmationIntake({
        confirmationPath,
        outputDir: path.join(tmp, "out"),
        r1149Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "safe_availability_confirmation_ready_for_recipe_readiness_chain",
        confirmationPathConfigured: true,
        confirmationStatus: "available",
        featureOnlyCoverageContextReady: true,
        featureOnlyCoverageRequiresPreferredPair: true,
        minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
        missingAggregateReadinessFactIds: [],
        missingAttestationKeys: [],
        missingFeatureOnlySourceFamilyIds: [],
        missingRequiredSourceFamilyIds: [],
        nextAction: "run_r1144_recipe_readiness_chain_with_confirmed_availability",
        outcomeLinkageRequiredForFeatureOnlyContext: false,
        ordinarySubmitterCompletionModeIds: ORDINARY_SUBMITTER_COMPLETION_MODE_IDS,
        ordinarySubmitterSafeCompletionChecklistItemIds: ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS,
        r1149SubmitterKitFeatureOnlyGuardPresent: true,
        r1149SubmitterKitReadyForSafeConfirmation: true,
        readyForRecipeReadinessChain: true,
        rowLevelDataAcceptedByR1150: false,
        rowOwnerAssertionsConfirmed: true,
      });
      expect(output.safeAvailabilityConfirmationIntake).toMatchObject({
        aggregateReadinessFactsComplete: true,
        attestationStatus: "complete",
        featureOnlyCoverageContextReady: true,
        featureOnlySourceFamilyStatus: "complete",
        recipeStatus: "complete",
        safeConfirmationReadyForR1143: true,
        sourceFamilyStatus: "complete",
        targetStatus: "complete",
      });
      expect(output.safeAvailabilityConfirmationIntake.commands.recipeReadinessChainRunnerCommand).toContain(
        "r1144-ordinary-consumer-recipe-readiness-chain-runner.ts",
      );
      expect(output.safeAvailabilityConfirmationIntake.commands.featureOnlyChainRunnerCommand).toContain(
        "r1153-ordinary-consumer-feature-only-chain-runner.ts",
      );
      expect(output.safeAvailabilityConfirmationIntake.commands.featureOnlyChainRunnerCommand).toContain(
        "MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_PATH=<safe-availability-confirmation.json>",
      );
      expect(output.safeAvailabilityConfirmationIntake.commands.featureOnlyChainRunnerCommand).not.toContain(
        "MURPH_AGE_R1152_ORDINARY_CONSUMER_FEATURE_ONLY_COVERAGE_CONTEXT_PATH",
      );
      expect(output.safeAvailabilityConfirmationIntake.commands.recipeReadinessChainRunnerCommand).toContain(
        "MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_PATH=<r1150-intake.json>",
      );
      expect(output.safeAvailabilityConfirmationIntake.commands.recipeReadinessChainRunnerCommand).not.toContain(
        "MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ASSERTIONS_CONFIRMED=true",
      );
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(output)).not.toContain("private_person_id");
      expect(JSON.stringify(output)).not.toContain("glucose_private_column");
      expect(JSON.stringify(output)).not.toContain("ordinary-private-route.csv");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("recognizes lab-plus-wearable availability as feature-only context without outcome linkage", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1150-feature-only-"));
    try {
      const r1149Path = path.join(tmp, "r1149.json");
      const confirmationPath = path.join(tmp, "safe-confirmation.json");
      await Promise.all([
        writeJson(r1149Path, r1149Fixture()),
        writeJson(confirmationPath, confirmationFixture({
          eventCountBand: "not_confirmed",
          outcomeLinked: false,
          sameDenominator: false,
          unavailableSourceFamilyIds: ["outcome_linkage", "join_time_alignment"],
        })),
      ]);

      const { output } = await runR1150OrdinaryConsumerSafeAvailabilityConfirmationIntake({
        confirmationPath,
        outputDir: path.join(tmp, "out"),
        r1149Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "safe_availability_confirmation_feature_only_ready_research_only",
        featureOnlyCoverageContextReady: true,
        missingAggregateReadinessFactIds: ["outcomeLinked", "sameDenominator", "eventCountBand"],
        missingAttestationKeys: [],
        missingFeatureOnlySourceFamilyIds: [],
        missingRequiredSourceFamilyIds: ["outcome_linkage", "join_time_alignment"],
        nextAction: "run_r1153_feature_only_chain_with_safe_availability",
        outcomeLinkageRequiredForFeatureOnlyContext: false,
        readyForRecipeReadinessChain: false,
        rowLevelDataAcceptedByR1150: false,
      });
      expect(output.safeAvailabilityConfirmationIntake).toMatchObject({
        aggregateReadinessFactsComplete: false,
        featureOnlyCoverageContextReady: true,
        featureOnlySourceFamilyStatus: "complete",
        safeConfirmationReadyForR1143: false,
        sourceFamilyStatus: "missing_or_false",
      });
      expect(output.safeAvailabilityConfirmationIntake.commands.featureOnlyChainRunnerCommand).toContain(
        "r1153-ordinary-consumer-feature-only-chain-runner.ts",
      );
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("accepts the compact feature-only confirmation shape without outcome linkage", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1150-compact-feature-only-"));
    try {
      const r1149Path = path.join(tmp, "r1149.json");
      const confirmationPath = path.join(tmp, "safe-confirmation.json");
      await Promise.all([
        writeJson(r1149Path, r1149Fixture()),
        writeJson(confirmationPath, compactFeatureOnlyConfirmationFixture()),
      ]);

      const { output } = await runR1150OrdinaryConsumerSafeAvailabilityConfirmationIntake({
        confirmationPath,
        outputDir: path.join(tmp, "out"),
        r1149Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "safe_availability_confirmation_feature_only_ready_research_only",
        confirmationPathConfigured: true,
        confirmationStatus: "available",
        featureOnlyCoverageContextReady: true,
        missingAggregateReadinessFactIds: [
          "outcomeLinked",
          "sameDenominator",
          "usableRecordCountBand",
          "eventCountBand",
        ],
        missingAttestationKeys: [],
        missingFeatureOnlySourceFamilyIds: [],
        missingRequiredSourceFamilyIds: ["outcome_linkage", "join_time_alignment"],
        nextAction: "run_r1153_feature_only_chain_with_safe_availability",
        readyForRecipeReadinessChain: false,
        rowOwnerAssertionsConfirmed: true,
        templateArtifact: "r1150-fillable-ordinary-consumer-safe-availability-confirmation.json",
        featureOnlyTemplateArtifact: "r1150-fillable-feature-only-safe-availability-confirmation.json",
      });
      expect(output.safeAvailabilityConfirmationIntake).toMatchObject({
        aggregateReadinessFactsComplete: false,
        attestationStatus: "complete",
        featureOnlyCoverageContextReady: true,
        featureOnlyFillableTemplateArtifact: "r1150-fillable-feature-only-safe-availability-confirmation.json",
        featureOnlySourceFamilyStatus: "complete",
        sourceFamilyStatus: "missing_or_false",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("keeps incomplete confirmation feedback to safe missing source and attestation keys", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1150-incomplete-"));
    try {
      const r1149Path = path.join(tmp, "r1149.json");
      const confirmationPath = path.join(tmp, "safe-confirmation.json");
      await Promise.all([
        writeJson(r1149Path, r1149Fixture()),
        writeJson(confirmationPath, confirmationFixture({
          eventCountBand: "not_confirmed",
          missingAttestationKeys: ["noPrivatePathEgress"],
          unavailableSourceFamilyIds: ["wearable_activity_daily"],
        })),
      ]);

      const { output } = await runR1150OrdinaryConsumerSafeAvailabilityConfirmationIntake({
        confirmationPath,
        outputDir: path.join(tmp, "out"),
        r1149Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "safe_availability_confirmation_incomplete",
        featureOnlyCoverageContextReady: false,
        missingAggregateReadinessFactIds: ["eventCountBand"],
        missingAttestationKeys: ["noPrivatePathEgress"],
        missingFeatureOnlySourceFamilyIds: ["wearable_activity_daily"],
        missingRequiredSourceFamilyIds: ["wearable_activity_daily"],
        nextAction: "complete_safe_availability_confirmation_template",
        r1149SubmitterKitFeatureOnlyGuardPresent: true,
        r1149SubmitterKitReadyForSafeConfirmation: true,
        readyForRecipeReadinessChain: false,
        rowOwnerAssertionsConfirmed: true,
      });
      expect(output.safeAvailabilityConfirmationIntake).toMatchObject({
        aggregateReadinessFactsComplete: false,
        attestationStatus: "missing_or_false",
        featureOnlySourceFamilyStatus: "missing_or_false",
        sourceFamilyStatus: "missing_or_false",
      });
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects confirmations with unexpected schema keys without echoing private details", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1150-unexpected-keys-"));
    try {
      const r1149Path = path.join(tmp, "r1149.json");
      const confirmationPath = path.join(tmp, "safe-confirmation.json");
      const confirmation = confirmationFixture();
      const sourceFamilies = readArrayAt(confirmation, ["sourceFamilies"]);
      confirmation.sourceFamilies = sourceFamilies.map((family, index) =>
        index === 0 && isRecord(family)
          ? {
            ...family,
            privateHeaderHint: "glucose_private_column",
          }
          : family
      );
      await Promise.all([
        writeJson(r1149Path, r1149Fixture()),
        writeJson(confirmationPath, confirmation),
      ]);

      const { output } = await runR1150OrdinaryConsumerSafeAvailabilityConfirmationIntake({
        confirmationPath,
        outputDir: path.join(tmp, "out"),
        r1149Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "safe_availability_confirmation_invalid",
        confirmationStatus: "unexpected_keys",
        missingAttestationKeys: REQUIRED_ATTESTATION_KEYS,
        missingFeatureOnlySourceFamilyIds: FEATURE_ONLY_SOURCE_FAMILY_IDS,
        missingRequiredSourceFamilyIds: REQUIRED_SOURCE_FAMILY_IDS,
        nextAction: "rerun_safe_availability_confirmation_with_valid_json_object",
        readyForRecipeReadinessChain: false,
      });
      expect(JSON.stringify(output)).not.toContain("privateHeaderHint");
      expect(JSON.stringify(output)).not.toContain("glucose_private_column");
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects private scalar content hidden in allowed guidance fields", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1150-guidance-private-"));
    try {
      const r1149Path = path.join(tmp, "r1149.json");
      const confirmationPath = path.join(tmp, "safe-confirmation.json");
      const confirmation = confirmationFixture({ includeTemplateGuidance: true });
      const sourceFamilies = readArrayAt(confirmation, ["sourceFamilies"]);
      confirmation.sourceFamilies = sourceFamilies.map((family, index) =>
        index === 0 && isRecord(family)
          ? {
            ...family,
            safeConfirmationMeaning: ["", "Users", "private", "glucose_private_column.csv"].join("/"),
          }
          : family
      );
      await Promise.all([
        writeJson(r1149Path, r1149Fixture()),
        writeJson(confirmationPath, confirmation),
      ]);

      const { output } = await runR1150OrdinaryConsumerSafeAvailabilityConfirmationIntake({
        confirmationPath,
        outputDir: path.join(tmp, "out"),
        r1149Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "safe_availability_confirmation_invalid",
        confirmationStatus: "unexpected_keys",
        featureOnlyCoverageContextReady: false,
        missingAttestationKeys: REQUIRED_ATTESTATION_KEYS,
        missingFeatureOnlySourceFamilyIds: FEATURE_ONLY_SOURCE_FAMILY_IDS,
        missingRequiredSourceFamilyIds: REQUIRED_SOURCE_FAMILY_IDS,
        nextAction: "rerun_safe_availability_confirmation_with_valid_json_object",
        readyForRecipeReadinessChain: false,
      });
      expect(output.safeAvailabilityConfirmationIntake.featureOnlyCoverageContextReady).toBe(false);
      expect(JSON.stringify(output)).not.toContain("glucose_private_column");
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits on the R1149 submitter kit before trusting a confirmation", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1150-stale-r1149-"));
    try {
      const r1149Path = path.join(tmp, "r1149.json");
      const confirmationPath = path.join(tmp, "safe-confirmation.json");
      await Promise.all([
        writeJson(r1149Path, {
          packetId: "stale-r1149",
          schemaVersion: "stale-schema",
        }),
        writeJson(confirmationPath, confirmationFixture()),
      ]);

      const { output } = await runR1150OrdinaryConsumerSafeAvailabilityConfirmationIntake({
        confirmationPath,
        outputDir: path.join(tmp, "out"),
        r1149Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "safe_availability_confirmation_waiting_on_r1149_submitter_kit",
        confirmationStatus: "available",
        nextAction: "refresh_r1149_submitter_kit",
        r1149SubmitterKitFeatureOnlyGuardPresent: false,
        r1149SubmitterKitReadyForSafeConfirmation: false,
        readyForRecipeReadinessChain: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits on R1149 refresh when the submitter kit lacks the feature-only guard", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1150-r1149-guard-"));
    try {
      const r1149Path = path.join(tmp, "r1149.json");
      const confirmationPath = path.join(tmp, "safe-confirmation.json");
      await Promise.all([
        writeJson(r1149Path, r1149Fixture({ omitFeatureOnlyGuard: true })),
        writeJson(confirmationPath, confirmationFixture()),
      ]);

      const { output } = await runR1150OrdinaryConsumerSafeAvailabilityConfirmationIntake({
        confirmationPath,
        outputDir: path.join(tmp, "out"),
        r1149Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "safe_availability_confirmation_waiting_on_r1149_submitter_kit",
        confirmationStatus: "available",
        nextAction: "refresh_r1149_submitter_kit",
        r1149SubmitterKitFeatureOnlyGuardPresent: false,
        r1149SubmitterKitReadyForSafeConfirmation: false,
        readyForRecipeReadinessChain: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1150-cli-"));
    try {
      const r1149Path = path.join(tmp, "r1149.json");
      const confirmationPath = path.join(tmp, "safe-confirmation.json");
      await Promise.all([
        writeJson(r1149Path, r1149Fixture()),
        writeJson(confirmationPath, confirmationFixture()),
      ]);

      const stdout = execFileSync(
        "pnpm",
        ["exec", "tsx", "scripts/murph-age/r1150-ordinary-consumer-safe-availability-confirmation-intake.ts"],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            MURPH_AGE_R1149_ORDINARY_CONSUMER_LAB_WEARABLE_SUBMISSION_KIT_PATH: r1149Path,
            MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_PATH: confirmationPath,
            MURPH_AGE_R1150_OUTPUT_DIR: path.join(tmp, "cli-out"),
          },
        },
      );
      const summary = JSON.parse(stdout) as {
        conclusion: string;
        featureOnlyChainRunnerCommand: string;
        missingRequiredSourceFamilyIds: string[];
        ordinarySubmitterCompletionModeIds: string[];
        ordinarySubmitterSafeCompletionChecklistItemIds: string[];
        r1149SubmitterKitFeatureOnlyGuardPresent: boolean;
        r1149SubmitterKitReadyForSafeConfirmation: boolean;
        readyForRecipeReadinessChain: boolean;
      };

      expect(summary).toMatchObject({
        conclusion: "safe_availability_confirmation_ready_for_recipe_readiness_chain",
        featureOnlyChainRunnerCommand:
          "MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_PATH=<safe-availability-confirmation.json> pnpm exec tsx scripts/murph-age/r1153-ordinary-consumer-feature-only-chain-runner.ts",
        featureOnlyCoverageContextReady: true,
        missingFeatureOnlySourceFamilyIds: [],
        missingRequiredSourceFamilyIds: [],
        ordinarySubmitterCompletionModeIds: ORDINARY_SUBMITTER_COMPLETION_MODE_IDS,
        ordinarySubmitterSafeCompletionChecklistItemIds: ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS,
        r1149SubmitterKitFeatureOnlyGuardPresent: true,
        r1149SubmitterKitReadyForSafeConfirmation: true,
        readyForRecipeReadinessChain: true,
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("safe-confirmation.json");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function r1149Fixture(options: { omitFeatureOnlyGuard?: boolean } = {}): Record<string, unknown> {
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
    ...(options.omitFeatureOnlyGuard === true
      ? {}
      : {
        ordinaryConsumerSubmissionKit: {
          commands: {
            featureOnlySubmissionModeCommand: R1151_COMMAND,
          },
          featureOnlySubmissionMode,
        },
      }),
    summary: {
      expectedRouteIds: EXPECTED_ROUTE_IDS,
      ...(options.omitFeatureOnlyGuard === true
        ? {}
        : {
          featureOnlyModeConclusion: featureOnlySubmissionMode.conclusion,
          featureOnlyModeModelEvidencePromotionAllowed: featureOnlySubmissionMode.modelEvidencePromotionAllowed,
          featureOnlyModeOutcomeLinkedEvidenceReady: featureOnlySubmissionMode.outcomeLinkedEvidenceReady,
          featureOnlyModeSupportedFeatureFamilyIds: featureOnlySubmissionMode.supportedFeatureFamilyIds,
        }),
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

function confirmationFixture(options: {
  eventCountBand?: string;
  includeTemplateGuidance?: boolean;
  missingAttestationKeys?: string[];
  outcomeLinked?: boolean;
  sameDenominator?: boolean;
  unavailableSourceFamilyIds?: string[];
} = {}): Record<string, unknown> {
  const missingAttestationKeys = new Set(options.missingAttestationKeys ?? []);
  const unavailableSourceFamilyIds = new Set(options.unavailableSourceFamilyIds ?? []);
  const confirmation: Record<string, unknown> = {
    aggregateReadinessFacts: {
      eventCountBand: options.eventCountBand ?? "10_plus",
      outcomeLinked: options.outcomeLinked ?? true,
      sameDenominator: options.sameDenominator ?? true,
      targetAgeBand: "roughly_16_50",
      usableRecordCountBand: "50_plus",
    },
    attestations: Object.fromEntries(
      REQUIRED_ATTESTATION_KEYS.map((key) => [key, !missingAttestationKeys.has(key)]),
    ),
    recipeId: "lab_plus_wearable_minimum_manifest",
    rowOwnerAssertionsConfirmed: true,
    schemaVersion: CONFIRMATION_SCHEMA_VERSION,
    sourceFamilies: [...REQUIRED_SOURCE_FAMILY_IDS, ...OPTIONAL_ADD_ON_FAMILY_IDS].map((familyId) => ({
      available: !unavailableSourceFamilyIds.has(familyId),
      familyId,
	      ...(options.includeTemplateGuidance === true
	        ? {
	          requiredForFeatureOnlyPreferredPair: FEATURE_ONLY_SOURCE_FAMILY_IDS.includes(familyId),
	          requiredForRecommendedRecipe: REQUIRED_SOURCE_FAMILY_IDS.includes(familyId),
	          safeConfirmationMeaning: safeConfirmationMeaningFor(familyId),
	        }
	        : {}),
	    })),
    targetAgeBand: "roughly_16_50",
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
	  };
	  if (options.includeTemplateGuidance === true) {
	    confirmation.blockedConfirmationContent = BLOCKED_CONFIRMATION_CONTENT;
	    confirmation.featureOnlyCoverageRequiresPreferredPair = true;
	    confirmation.minimumFeaturePairRequired = FEATURE_ONLY_SOURCE_FAMILY_IDS;
	    confirmation.ordinarySubmitterInputKinds = ordinarySubmitterInputKinds();
	    confirmation.ordinarySubmitterCompletionModes = ordinarySubmitterCompletionModes();
	    confirmation.ordinarySubmitterSafeCompletionChecklist = ordinarySubmitterSafeCompletionChecklist();
	    confirmation.outcomeLinkageRequiredForFeatureOnlyContext = false;
	    confirmation.rowLevelDataAcceptedByR1150 = false;
	  }
	  return confirmation;
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
  if (familyId === "outcome_linkage") {
    return "An outcome or follow-up source can be linked to the same eligible people as the lab and wearable data.";
  }
  if (familyId === "join_time_alignment") {
    return "The row owner can align people and dates or times across the sources without exposing the join values.";
  }
  if (familyId === "bloodwork_glycemia") {
    return "The row owner has ordinary glycemia bloodwork fields such as glucose or HbA1c in an export or spreadsheet.";
  }
  if (familyId === "wearable_activity_daily") {
    return "The row owner has daily activity data from a watch, phone, or wearable export.";
  }
  if (familyId === "common_bloodwork_core") {
    return "The row owner has common bloodwork add-ons beyond glycemia, if available.";
  }
  return "The row owner has body-context values such as blood pressure, BMI, height, or weight, if available.";
}

function ordinarySubmitterInputKinds(): Record<string, unknown>[] {
  return [
    {
      inputKindId: "lab_portal_export_or_spreadsheet",
      mapsToSourceFamilyIds: ["bloodwork_glycemia", "common_bloodwork_core"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: true,
      safeSubmitterExample: "A normal lab portal export or spreadsheet can confirm glycemia labs exist without sharing private labels, headers, or row values.",
    },
    {
      inputKindId: "phone_watch_or_wearable_activity_export",
      mapsToSourceFamilyIds: ["wearable_activity_daily"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: true,
      safeSubmitterExample: "A phone, watch, or wearable daily activity export can confirm activity coverage without sharing private labels, headers, or row values.",
    },
    {
      inputKindId: "optional_vitals_or_body_context",
      mapsToSourceFamilyIds: ["vitals_body_context"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: false,
      safeSubmitterExample: "Optional body or vitals context can be declared as available without sharing private labels, headers, or row values.",
    },
  ];
}

function ordinarySubmitterSafeCompletionChecklist(): Record<string, unknown>[] {
  return [
    {
      checkId: "confirm_target_age_band_without_identifiers",
      mapsToSourceFamilyIds: [],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: true,
      requiredForOutcomeLinkedRecipe: true,
      safeCompletionMeaning:
        "Confirm the submission belongs on the roughly 16-50 ordinary submitter path without sharing birth dates, names, account identifiers, or row values.",
    },
    {
      checkId: "confirm_glycemia_bloodwork_export_available",
      mapsToSourceFamilyIds: ["bloodwork_glycemia"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: true,
      requiredForOutcomeLinkedRecipe: true,
      safeCompletionMeaning:
        "Confirm an ordinary lab portal export or spreadsheet can cover glycemia bloodwork availability without sharing lab names, headers, values, files, or paths.",
    },
    {
      checkId: "confirm_daily_wearable_activity_export_available",
      mapsToSourceFamilyIds: ["wearable_activity_daily"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: true,
      requiredForOutcomeLinkedRecipe: true,
      safeCompletionMeaning:
        "Confirm a phone, watch, or wearable export can cover daily activity availability without sharing device account identifiers, headers, values, files, or paths.",
    },
    {
      checkId: "confirm_no_private_values_in_confirmation",
      mapsToSourceFamilyIds: [],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: true,
      requiredForOutcomeLinkedRecipe: true,
      safeCompletionMeaning:
        "Confirm the completed availability JSON contains only booleans, safe IDs, and coarse bands, with no private rows, headers, identifiers, file names, paths, predictions, coefficients, or source text.",
    },
    {
      checkId: "confirm_outcome_linkage_and_time_alignment_if_model_evidence",
      mapsToSourceFamilyIds: ["outcome_linkage", "join_time_alignment"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: false,
      requiredForOutcomeLinkedRecipe: true,
      safeCompletionMeaning:
        "For outcome-linked model evidence, confirm outcomes and time alignment can be joined to the same eligible people without exposing join keys, dates, row values, or headers.",
    },
    {
      checkId: "confirm_aggregate_count_bands_if_model_evidence",
      mapsToSourceFamilyIds: [],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: false,
      requiredForOutcomeLinkedRecipe: true,
      safeCompletionMeaning:
        "For outcome-linked model evidence, confirm only coarse usable-record and event-count bands; do not include raw counts if they would disclose small cells.",
    },
  ];
}

function ordinarySubmitterCompletionModes(): Record<string, unknown>[] {
  return [
    {
      modeId: "feature_only_lab_wearable_coverage",
      modeType: "feature_only_coverage",
      modelEvidenceCandidate: false,
      nextActionAfterR1150: "run_r1153_feature_only_chain",
      outcomeLinkageRequired: false,
      privateDetailsStored: false,
      requiredAggregateReadinessFactIds: ["targetAgeBand"],
      requiredAttestationKeys: [...REQUIRED_ATTESTATION_KEYS],
      requiredChecklistIds: [
        "confirm_target_age_band_without_identifiers",
        "confirm_glycemia_bloodwork_export_available",
        "confirm_daily_wearable_activity_export_available",
        "confirm_no_private_values_in_confirmation",
      ],
      requiredSourceFamilyIds: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      rowLevelDataAccepted: false,
      safeCompletionMeaning:
        "Minimum ordinary submitter path: confirm only the roughly 16-50 scope, glycemia bloodwork availability, daily wearable activity availability, and privacy attestations for research-only coverage planning.",
    },
    {
      modeId: "outcome_linked_lab_wearable_model_evidence",
      modeType: "outcome_linked_model_evidence",
      modelEvidenceCandidate: true,
      nextActionAfterR1150: "run_r1144_recipe_readiness_chain",
      outcomeLinkageRequired: true,
      privateDetailsStored: false,
      requiredAggregateReadinessFactIds: [
        "outcomeLinked",
        "sameDenominator",
        "targetAgeBand",
        "usableRecordCountBand",
        "eventCountBand",
      ],
      requiredAttestationKeys: [...REQUIRED_ATTESTATION_KEYS],
      requiredChecklistIds: ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS,
      requiredSourceFamilyIds: [...REQUIRED_SOURCE_FAMILY_IDS],
      rowLevelDataAccepted: false,
      safeCompletionMeaning:
        "Outcome-linked model-evidence path: confirm lab plus wearable availability, outcome/time alignment, same-denominator readiness, and only coarse count bands before running recipe readiness.",
    },
  ];
}

function readBooleanAt(value: unknown, pathParts: readonly string[]): boolean | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "boolean" ? resolved : null;
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
}

function readArrayAt(value: unknown, pathParts: readonly string[]): unknown[] {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved) ? resolved : [];
}

function readAt(value: unknown, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!isRecord(current)) return null;
    current = current[part];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
