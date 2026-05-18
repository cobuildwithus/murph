import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1158_ORDINARY_CONSUMER_SAFE_CONFIRMATION_FILL_GUIDE_SCHEMA_VERSION,
  runR1158OrdinaryConsumerSafeConfirmationFillGuide,
} from "./r1158-ordinary-consumer-safe-confirmation-fill-guide.ts";
import { R1157_SAFE_CONFIRMATION_CHAIN_RUNNER_COMMAND } from "./r1157-ordinary-consumer-safe-confirmation-chain-runner.ts";

const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first";
const FEATURE_ONLY_SOURCE_FAMILY_IDS = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
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
const REQUIRED_FIELD_EDIT_PATHS = [
  "aggregateReadinessFacts.targetAgeBand",
  "sourceFamilies[bloodwork_glycemia].available",
  "sourceFamilies[wearable_activity_daily].available",
  "rowOwnerAssertionsConfirmed",
  ...REQUIRED_ATTESTATION_KEYS.map((key) => `attestations.${key}`),
];
const REQUIRED_CHECKLIST_IDS = [
  "confirm_target_age_band_without_identifiers",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
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
const R1150_INTAKE_COMMAND =
  "MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_PATH=<safe-availability-confirmation.json> pnpm exec tsx scripts/murph-age/r1150-ordinary-consumer-safe-availability-confirmation-intake.ts";
const R1153_CHAIN_COMMAND =
  "MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_PATH=<safe-availability-confirmation.json> pnpm exec tsx scripts/murph-age/r1153-ordinary-consumer-feature-only-chain-runner.ts";

describe("R1158 ordinary consumer safe confirmation fill guide", () => {
  it("emits a pathless average submitter fill guide for labs plus wearable data", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1158-ready-"));
    try {
      const paths = await writeInputs(tmp);

      const { output, outputPath } = await runR1158OrdinaryConsumerSafeConfirmationFillGuide({
        createdAt: "2026-05-17T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1158-ordinary-consumer-safe-confirmation-fill-guide.latest.json");
      expect(output.schemaVersion).toBe(R1158_ORDINARY_CONSUMER_SAFE_CONFIRMATION_FILL_GUIDE_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "ordinary_safe_confirmation_fill_guide_ready_non_evidence",
        exactSafeFieldEditCount: REQUIRED_FIELD_EDIT_PATHS.length,
        featureOnlyTemplateReady: true,
        guideReadyForRowOwnerFill: true,
        handoffReadyForRowOwner: true,
        minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
        modelEvidencePromotionAllowed: false,
        nextAction: "fill_safe_availability_confirmation_from_template",
        optionalAddOnFamilyIds: [
          "common_bloodwork_core",
          "vitals_body_context",
        ],
        productDisplayAuthorized: false,
        quickstartReady: true,
        recommendedCompletionModeId: "feature_only_lab_wearable_coverage",
        requiredChecklistIds: REQUIRED_CHECKLIST_IDS,
        requiredInputKindIds: [
          "lab_portal_export_or_spreadsheet",
          "phone_watch_or_wearable_activity_export",
        ],
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1158: false,
        rowParsingPerformedByR1158: false,
        safeConfirmationChainRunnerReady: true,
        targetAgeBand: "roughly_16_50",
        targetInputPriority: TARGET_INPUT_PRIORITY,
      });
      expect(output.rowOwnerFillGuide).toMatchObject({
        audience: "ordinary_submitter_roughly_16_50_row_owner",
        blockedConfirmationContent: BLOCKED_CONFIRMATION_CONTENT,
        commands: {
          featureOnlyChainRunnerCommand: R1153_CHAIN_COMMAND,
          safeAvailabilityConfirmationIntakeCommand: R1150_INTAKE_COMMAND,
          safeConfirmationChainRunnerCommand: R1157_SAFE_CONFIRMATION_CHAIN_RUNNER_COMMAND,
        },
        guideRole: "fill_guide_only_not_confirmation_not_model_evidence",
        minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
        nextActionAfterFill: "run_r1157_safe_confirmation_chain_runner_with_real_safe_confirmation",
        preferredRecipeId: "lab_plus_wearable_minimum_manifest",
        privateDetailsStored: false,
        readyToUse: true,
        requiredAttestationKeys: REQUIRED_ATTESTATION_KEYS,
        requiredChecklistIds: REQUIRED_CHECKLIST_IDS,
        rowLevelDataAcceptedByR1158: false,
      });
      expect(output.rowOwnerFillGuide.exactSafeFieldEdits.map((edit) => edit.fieldPath)).toEqual(
        REQUIRED_FIELD_EDIT_PATHS,
      );
      expect(output.rowOwnerFillGuide.requiredInputKinds).toHaveLength(2);
      expect(output.rowOwnerFillGuide.optionalAddOnInputKinds).toMatchObject([
        {
          inputKindId: "optional_common_bloodwork_or_vitals_context",
          mapsToSourceFamilyIds: [
            "common_bloodwork_core",
            "vitals_body_context",
          ],
          requiredForFeatureOnlyPreferredPair: false,
        },
      ]);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = JSON.parse(await readFile(outputPath, "utf8")) as unknown;
      expect(findForbiddenAggregateEgress(persisted)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits for the R1154 quickstart when the safe field-edit guide is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1158-missing-quickstart-"));
    try {
      const paths = await writeInputs(tmp);
      await rm(paths.quickstartPath, { force: true });

      const { output } = await runR1158OrdinaryConsumerSafeConfirmationFillGuide({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_safe_confirmation_fill_guide_waiting_on_quickstart",
        exactSafeFieldEditCount: 0,
        guideReadyForRowOwnerFill: false,
        nextAction: "refresh_r1154_safe_availability_action_packet",
        quickstartReady: false,
      });
      expect(output.inputArtifacts.quickstart).toMatchObject({
        schemaVersion: null,
        status: "missing",
      });
      expect(output.rowOwnerFillGuide.exactSafeFieldEdits).toEqual([]);
      expect(output.rowOwnerFillGuide.readyToUse).toBe(false);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe input artifacts with a sanitized error", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1158-unsafe-"));
    try {
      const paths = await writeInputs(tmp);
      await writeJson(paths.r1157Path, {
        ...r1157Fixture(),
        artifactBoundary: {
          ...safeBoundary("R1157"),
          predictionsStored: true,
        },
      });

      await expect(runR1158OrdinaryConsumerSafeConfirmationFillGuide({
        outputDir: path.join(tmp, "out"),
        ...paths,
      })).rejects.toThrow("R1158 rejected unsafe r1157 input: 1 aggregate-egress violation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1158-cli-"));
    try {
      const paths = await writeInputs(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1158-ordinary-consumer-safe-confirmation-fill-guide.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1150_FEATURE_ONLY_SAFE_AVAILABILITY_CONFIRMATION_TEMPLATE_PATH: paths.featureOnlyTemplatePath,
          MURPH_AGE_R1154_FEATURE_ONLY_SAFE_CONFIRMATION_QUICKSTART_PATH: paths.quickstartPath,
          MURPH_AGE_R1156_ORDINARY_CONSUMER_SAFE_CONFIRMATION_HANDOFF_PATH: paths.r1156Path,
          MURPH_AGE_R1157_ORDINARY_CONSUMER_SAFE_CONFIRMATION_CHAIN_RUNNER_PATH: paths.r1157Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        exactSafeFieldEditCount: number;
        guideReadyForRowOwnerFill: boolean;
        minimumFeaturePairRequired: string[];
        nextAction: string;
        productDisplayAuthorized: boolean;
        requiredInputKindIds: string[];
        rowLevelDataAcceptedByR1158: boolean;
        safeConfirmationChainRunnerReady: boolean;
        targetInputPriority: string;
      };
      expect(summary).toMatchObject({
        conclusion: "ordinary_safe_confirmation_fill_guide_ready_non_evidence",
        exactSafeFieldEditCount: REQUIRED_FIELD_EDIT_PATHS.length,
        guideReadyForRowOwnerFill: true,
        minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
        nextAction: "fill_safe_availability_confirmation_from_template",
        productDisplayAuthorized: false,
        requiredInputKindIds: [
          "lab_portal_export_or_spreadsheet",
          "phone_watch_or_wearable_activity_export",
        ],
        rowLevelDataAcceptedByR1158: false,
        safeConfirmationChainRunnerReady: true,
        targetInputPriority: TARGET_INPUT_PRIORITY,
      });
      expect(stdout).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeInputs(tmp: string): Promise<{
  featureOnlyTemplatePath: string;
  quickstartPath: string;
  r1156Path: string;
  r1157Path: string;
}> {
  const paths = {
    featureOnlyTemplatePath: path.join(tmp, "r1150-feature-only-template.json"),
    quickstartPath: path.join(tmp, "r1154-quickstart.json"),
    r1156Path: path.join(tmp, "r1156.json"),
    r1157Path: path.join(tmp, "r1157.json"),
  };
  await Promise.all([
    writeJson(paths.featureOnlyTemplatePath, featureOnlyTemplateFixture()),
    writeJson(paths.quickstartPath, quickstartFixture()),
    writeJson(paths.r1156Path, r1156Fixture()),
    writeJson(paths.r1157Path, r1157Fixture()),
  ]);
  return paths;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function featureOnlyTemplateFixture(): Record<string, unknown> {
  return {
    aggregateReadinessFacts: {
      eventCountBand: "not_confirmed",
      outcomeLinked: false,
      sameDenominator: false,
      targetAgeBand: "roughly_16_50",
      usableRecordCountBand: "not_confirmed",
    },
    attestations: Object.fromEntries(REQUIRED_ATTESTATION_KEYS.map((key) => [key, false])),
    blockedConfirmationContent: BLOCKED_CONFIRMATION_CONTENT,
    featureOnlyCoverageRequiresPreferredPair: true,
    minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
    outcomeLinkageRequiredForFeatureOnlyContext: false,
    recipeId: "lab_plus_wearable_minimum_manifest",
    rowOwnerAssertionsConfirmed: false,
    rowLevelDataAcceptedByR1150: false,
    schemaVersion: "murph-age-r1150-ordinary-consumer-safe-availability-confirmation.v1",
    sourceFamilies: FEATURE_ONLY_SOURCE_FAMILY_IDS.map((familyId) => ({
      available: false,
      familyId,
      requiredForFeatureOnlyPreferredPair: true,
      requiredForRecommendedRecipe: true,
      safeConfirmationMeaning: `Safe ${familyId} confirmation.`,
    })),
    targetAgeBand: "roughly_16_50",
    targetInputPriority: TARGET_INPUT_PRIORITY,
  };
}

function quickstartFixture(): Record<string, unknown> {
  return {
    aggregateReadinessFactIdsToConfirm: ["targetAgeBand"],
    attestationsToConfirm: REQUIRED_ATTESTATION_KEYS,
    blockedConfirmationContent: BLOCKED_CONFIRMATION_CONTENT,
    completionModeId: "feature_only_lab_wearable_coverage",
    featureOnlyChainRunnerCommand: R1153_CHAIN_COMMAND,
    featureOnlyFillableTemplateArtifact: "r1150-fillable-feature-only-safe-availability-confirmation.json",
    fullFillableTemplateArtifact: "r1150-fillable-ordinary-consumer-safe-availability-confirmation.json",
    modelEvidencePromotionAllowed: false,
    nextActionAfterSafeConfirmation: "run_r1153_feature_only_chain",
    outcomeLinkageRequiredForFeatureOnlyContext: false,
    productDisplayAuthorized: false,
    privateDetailsStored: false,
    requiredChecklistItemIds: REQUIRED_CHECKLIST_IDS,
    requiredSourceFamilies: [
      {
        familyId: "bloodwork_glycemia",
        privateDetailsStored: false,
        safeAvailableMeans: "A normal lab portal export or spreadsheet has glycemia bloodwork coverage.",
        safeSourceKind: "lab_portal_export_or_spreadsheet",
        setAvailableToTrueOnlyIf:
          "Confirm glycemia bloodwork exists without copying lab values, headers, files, paths, or account identifiers.",
      },
      {
        familyId: "wearable_activity_daily",
        privateDetailsStored: false,
        safeAvailableMeans: "A phone, watch, or wearable export has daily activity coverage.",
        safeSourceKind: "phone_watch_or_wearable_activity_export",
        setAvailableToTrueOnlyIf:
          "Confirm daily activity exists without copying step counts, minute values, headers, files, paths, or account identifiers.",
      },
    ],
    reviewGptRequiredNow: false,
    rowLevelDataAcceptedByR1154: false,
    rowParsingPerformedByR1154: false,
    safeAvailabilityConfirmationIntakeCommand: R1150_INTAKE_COMMAND,
    safeConfirmationFieldEdits: REQUIRED_FIELD_EDIT_PATHS.map((fieldPath) => ({
      fieldPath,
      privateDetailsStored: false,
      safeEditMeaning: `Safe edit for ${fieldPath}.`,
      setOnlyIf: `Set ${fieldPath} only after private-free local review.`,
      setTo: fieldPath === "aggregateReadinessFacts.targetAgeBand" ? "roughly_16_50" : true,
    })),
    schemaVersion: "murph-age-r1154-feature-only-safe-confirmation-quickstart.v1",
    targetAgeBand: "roughly_16_50",
    targetInputPriority: TARGET_INPUT_PRIORITY,
  };
}

function r1156Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      ...safeBoundary("R1156"),
      rowLevelDataAcceptedByR1156: false,
    },
    packetId: "r1156-ordinary-consumer-safe-confirmation-handoff",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1156-ordinary-consumer-safe-confirmation-handoff.v1",
    status: "research-local-aggregate-only",
    summary: {
      featureOnlyPathMechanicallyProven: true,
      handoffReadyForRowOwner: true,
      modelEvidencePromotionAllowed: false,
      productDisplayAuthorized: false,
      requiredFeatureOnlySourceFamilyIds: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1156: false,
    },
  };
}

function r1157Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      ...safeBoundary("R1157"),
      rowLevelDataAcceptedByR1157: false,
    },
    packetId: "r1157-ordinary-consumer-safe-confirmation-chain-runner",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1157-ordinary-consumer-safe-confirmation-chain-runner.v1",
    status: "research-local-aggregate-only",
    summary: {
      modelEvidencePromotionAllowed: false,
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1157: false,
      safeConfirmationChainRunnerCommand: R1157_SAFE_CONFIRMATION_CHAIN_RUNNER_COMMAND,
    },
  };
}

function safeBoundary(source: string): Record<string, boolean> {
  return {
    aggregateOnly: true,
    availabilityConfirmationPathStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    confirmationValuesStored: false,
    featureValuesStored: false,
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
    [`rowParsingPerformedBy${source}`]: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}
