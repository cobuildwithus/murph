import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1159_ORDINARY_CONSUMER_SAFE_CONFIRMATION_ANSWER_SHEET_SCHEMA_VERSION,
  runR1159OrdinaryConsumerSafeConfirmationAnswerSheet,
} from "./r1159-ordinary-consumer-safe-confirmation-answer-sheet.ts";
import { R1158_SAFE_CONFIRMATION_FILL_GUIDE_COMMAND } from "./r1158-ordinary-consumer-safe-confirmation-fill-guide.ts";

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

describe("R1159 ordinary consumer safe confirmation answer sheet", () => {
  it("emits a pathless answer sheet for ordinary labs plus wearable data", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1159-ready-"));
    try {
      const paths = await writeInputs(tmp);

      const { answerSheetTemplatePath, output, outputPath } =
        await runR1159OrdinaryConsumerSafeConfirmationAnswerSheet({
          createdAt: "2026-05-17T00:00:00.000Z",
          outputDir: path.join(tmp, "out"),
          ...paths,
        });

      expect(path.basename(outputPath)).toBe("r1159-ordinary-consumer-safe-confirmation-answer-sheet.latest.json");
      expect(path.basename(answerSheetTemplatePath)).toBe(
        "r1159-fillable-ordinary-consumer-safe-confirmation-answer-sheet.json",
      );
      expect(output.schemaVersion).toBe(R1159_ORDINARY_CONSUMER_SAFE_CONFIRMATION_ANSWER_SHEET_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        answerSheetReadyForRowOwner: true,
        conclusion: "ordinary_safe_confirmation_answer_sheet_ready_non_evidence",
        exactSafeAnswerCount: REQUIRED_FIELD_EDIT_PATHS.length,
        featureOnlyTemplateReady: true,
        fillGuideReadyForRowOwnerFill: true,
        minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
        modelEvidencePromotionAllowed: false,
        nextAction: "fill_r1150_feature_only_safe_confirmation_from_r1159_answer_sheet",
        optionalAddOnFamilyIds: [
          "common_bloodwork_core",
          "vitals_body_context",
        ],
        productDisplayAuthorized: false,
        recommendedCompletionModeId: "feature_only_lab_wearable_coverage",
        requiredChecklistIds: REQUIRED_CHECKLIST_IDS,
        requiredInputKindIds: [
          "lab_portal_export_or_spreadsheet",
          "phone_watch_or_wearable_activity_export",
        ],
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1159: false,
        rowOwnerProvidedValuesStored: false,
        rowParsingPerformedByR1159: false,
        targetAgeBand: "roughly_16_50",
        targetInputPriority: TARGET_INPUT_PRIORITY,
      });
      expect(output.rowOwnerAnswerSheet).toMatchObject({
        answerSheetRole: "answer_sheet_only_not_confirmation_not_model_evidence",
        audience: "ordinary_submitter_roughly_16_50_row_owner",
        blockedConfirmationContent: BLOCKED_CONFIRMATION_CONTENT,
        commands: {
          featureOnlyChainRunnerCommand: R1153_CHAIN_COMMAND,
          safeAvailabilityConfirmationIntakeCommand: R1150_INTAKE_COMMAND,
          safeConfirmationFillGuideCommand: R1158_SAFE_CONFIRMATION_FILL_GUIDE_COMMAND,
        },
        minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
        modelEvidencePromotionAllowed: false,
        preferredRecipeId: "lab_plus_wearable_minimum_manifest",
        privateDetailsStored: false,
        readyForR1150FeatureOnlyTranscription: true,
        recommendedCompletionModeId: "feature_only_lab_wearable_coverage",
        requiredAttestationKeys: REQUIRED_ATTESTATION_KEYS,
        requiredChecklistIds: REQUIRED_CHECKLIST_IDS,
        rowLevelDataAcceptedByR1159: false,
        rowOwnerProvidedValuesStored: false,
        transcribesToFeatureOnlyTemplateArtifact: "r1150-fillable-feature-only-safe-availability-confirmation.json",
      });
      expect(output.rowOwnerAnswerSheet.exactSafeAnswers.map((answer) => answer.fieldPath)).toEqual(
        REQUIRED_FIELD_EDIT_PATHS,
      );
      expect(output.rowOwnerAnswerSheet.exactSafeAnswers.map((answer) => answer.safeSetTo)).toEqual([
        "roughly_16_50",
        ...Array.from({ length: REQUIRED_FIELD_EDIT_PATHS.length - 1 }, () => true),
      ]);
      expect(output.rowOwnerAnswerSheet.requiredInputKinds).toMatchObject([
        {
          inputKindId: "lab_portal_export_or_spreadsheet",
          mapsToSourceFamilyIds: ["bloodwork_glycemia"],
          requiredForFeatureOnlyPreferredPair: true,
        },
        {
          inputKindId: "phone_watch_or_wearable_activity_export",
          mapsToSourceFamilyIds: ["wearable_activity_daily"],
          requiredForFeatureOnlyPreferredPair: true,
        },
      ]);
      expect(output.rowOwnerAnswerSheet.optionalAddOnInputKinds).toMatchObject([
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
      const template = JSON.parse(await readFile(answerSheetTemplatePath, "utf8")) as {
        exactSafeAnswers: Array<{ fieldPath: string }>;
        readyForR1150FeatureOnlyTranscription: boolean;
      };
      expect(findForbiddenAggregateEgress(persisted)).toEqual([]);
      expect(findForbiddenAggregateEgress(template)).toEqual([]);
      expect(template.readyForR1150FeatureOnlyTranscription).toBe(true);
      expect(template.exactSafeAnswers.map((answer) => answer.fieldPath)).toEqual(REQUIRED_FIELD_EDIT_PATHS);
      expect(JSON.stringify(template)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits for the R1158 fill guide when the guide is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1159-missing-guide-"));
    try {
      const paths = await writeInputs(tmp);
      await rm(paths.r1158Path, { force: true });

      const { output } = await runR1159OrdinaryConsumerSafeConfirmationAnswerSheet({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        answerSheetReadyForRowOwner: false,
        conclusion: "ordinary_safe_confirmation_answer_sheet_waiting_on_fill_guide",
        exactSafeAnswerCount: 0,
        featureOnlyTemplateReady: true,
        fillGuideReadyForRowOwnerFill: false,
        nextAction: "refresh_r1158_safe_confirmation_fill_guide",
      });
      expect(output.inputArtifacts.r1158).toMatchObject({
        schemaVersion: null,
        status: "missing",
      });
      expect(output.rowOwnerAnswerSheet.exactSafeAnswers).toEqual([]);
      expect(output.rowOwnerAnswerSheet.readyForR1150FeatureOnlyTranscription).toBe(false);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits for the feature-only template when the R1150 template is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1159-missing-template-"));
    try {
      const paths = await writeInputs(tmp);
      await rm(paths.featureOnlyTemplatePath, { force: true });

      const { output } = await runR1159OrdinaryConsumerSafeConfirmationAnswerSheet({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        answerSheetReadyForRowOwner: false,
        conclusion: "ordinary_safe_confirmation_answer_sheet_waiting_on_feature_only_template",
        exactSafeAnswerCount: 0,
        featureOnlyTemplateReady: false,
        fillGuideReadyForRowOwnerFill: true,
        nextAction: "refresh_r1150_safe_availability_confirmation_template",
      });
      expect(output.inputArtifacts.featureOnlyTemplate).toMatchObject({
        schemaVersion: null,
        status: "missing",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe input artifacts with a sanitized error", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1159-unsafe-"));
    try {
      const paths = await writeInputs(tmp);
      await writeJson(paths.r1158Path, {
        ...r1158Fixture(),
        artifactBoundary: {
          ...safeBoundary("R1158"),
          predictionsStored: true,
          rowLevelDataAcceptedByR1158: false,
          rowParsingPerformedByR1158: false,
        },
      });

      await expect(runR1159OrdinaryConsumerSafeConfirmationAnswerSheet({
        outputDir: path.join(tmp, "out"),
        ...paths,
      })).rejects.toThrow("R1159 rejected unsafe r1158 input: 1 aggregate-egress violation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1159-cli-"));
    try {
      const paths = await writeInputs(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1159-ordinary-consumer-safe-confirmation-answer-sheet.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1150_FEATURE_ONLY_SAFE_AVAILABILITY_CONFIRMATION_TEMPLATE_PATH:
            paths.featureOnlyTemplatePath,
          MURPH_AGE_R1158_ORDINARY_CONSUMER_SAFE_CONFIRMATION_FILL_GUIDE_PATH: paths.r1158Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        answerSheetReadyForRowOwner: boolean;
        conclusion: string;
        exactSafeAnswerCount: number;
        minimumFeaturePairRequired: string[];
        nextAction: string;
        productDisplayAuthorized: boolean;
        requiredInputKindIds: string[];
        rowLevelDataAcceptedByR1159: boolean;
        rowOwnerProvidedValuesStored: boolean;
        targetInputPriority: string;
      };
      expect(summary).toMatchObject({
        answerSheetReadyForRowOwner: true,
        conclusion: "ordinary_safe_confirmation_answer_sheet_ready_non_evidence",
        exactSafeAnswerCount: REQUIRED_FIELD_EDIT_PATHS.length,
        minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
        nextAction: "fill_r1150_feature_only_safe_confirmation_from_r1159_answer_sheet",
        productDisplayAuthorized: false,
        requiredInputKindIds: [
          "lab_portal_export_or_spreadsheet",
          "phone_watch_or_wearable_activity_export",
        ],
        rowLevelDataAcceptedByR1159: false,
        rowOwnerProvidedValuesStored: false,
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
  r1158Path: string;
}> {
  const paths = {
    featureOnlyTemplatePath: path.join(tmp, "r1150-feature-only-template.json"),
    r1158Path: path.join(tmp, "r1158.json"),
  };
  await Promise.all([
    writeJson(paths.featureOnlyTemplatePath, featureOnlyTemplateFixture()),
    writeJson(paths.r1158Path, r1158Fixture()),
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

function r1158Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      ...safeBoundary("R1158"),
      rowLevelDataAcceptedByR1158: false,
      rowParsingPerformedByR1158: false,
    },
    packetId: "r1158-ordinary-consumer-safe-confirmation-fill-guide",
    productDisplayAuthorized: false,
    rowOwnerFillGuide: {
      audience: "ordinary_submitter_roughly_16_50_row_owner",
      blockedConfirmationContent: BLOCKED_CONFIRMATION_CONTENT,
      commands: {
        featureOnlyChainRunnerCommand: R1153_CHAIN_COMMAND,
        safeAvailabilityConfirmationIntakeCommand: R1150_INTAKE_COMMAND,
        safeConfirmationChainRunnerCommand:
          "pnpm exec tsx scripts/murph-age/r1157-ordinary-consumer-safe-confirmation-chain-runner.ts",
      },
      exactSafeFieldEdits: REQUIRED_FIELD_EDIT_PATHS.map((fieldPath) => ({
        fieldPath,
        privateDetailsStored: false,
        safeEditMeaning: `Safe edit for ${fieldPath}.`,
        setOnlyIf: `Set ${fieldPath} only after private-free local review.`,
        setTo: fieldPath === "aggregateReadinessFacts.targetAgeBand" ? "roughly_16_50" : true,
      })),
      guideRole: "fill_guide_only_not_confirmation_not_model_evidence",
      minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      optionalAddOnInputKinds: [
        {
          inputKindId: "optional_common_bloodwork_or_vitals_context",
          mapsToSourceFamilyIds: [
            "common_bloodwork_core",
            "vitals_body_context",
          ],
          privateDetailsStored: false,
          requiredForFeatureOnlyPreferredPair: false,
          safeSubmitterExample:
            "Common bloodwork, vitals, or body-context add-ons can be declared later without blocking the minimum labs plus wearable path.",
        },
      ],
      preferredRecipeId: "lab_plus_wearable_minimum_manifest",
      privateDetailsStored: false,
      readyToUse: true,
      recommendedCompletionModeId: "feature_only_lab_wearable_coverage",
      requiredAttestationKeys: REQUIRED_ATTESTATION_KEYS,
      requiredChecklistIds: REQUIRED_CHECKLIST_IDS,
      requiredInputKinds: [
        {
          inputKindId: "lab_portal_export_or_spreadsheet",
          mapsToSourceFamilyIds: ["bloodwork_glycemia"],
          privateDetailsStored: false,
          requiredForFeatureOnlyPreferredPair: true,
          safeSubmitterExample: "A normal lab portal export or spreadsheet has glycemia bloodwork coverage.",
        },
        {
          inputKindId: "phone_watch_or_wearable_activity_export",
          mapsToSourceFamilyIds: ["wearable_activity_daily"],
          privateDetailsStored: false,
          requiredForFeatureOnlyPreferredPair: true,
          safeSubmitterExample: "A phone, watch, or wearable export has daily activity coverage.",
        },
      ],
      rowLevelDataAcceptedByR1158: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
    schemaVersion: "murph-age-r1158-ordinary-consumer-safe-confirmation-fill-guide.v1",
    status: "research-local-aggregate-only",
    summary: {
      blockedConfirmationContentIds: BLOCKED_CONFIRMATION_CONTENT,
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
