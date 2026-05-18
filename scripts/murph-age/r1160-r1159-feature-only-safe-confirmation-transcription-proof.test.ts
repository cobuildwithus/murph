import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  runR1160R1159FeatureOnlySafeConfirmationTranscriptionProof,
  R1160_R1159_FEATURE_ONLY_SAFE_CONFIRMATION_TRANSCRIPTION_PROOF_SCHEMA_VERSION,
} from "./r1160-r1159-feature-only-safe-confirmation-transcription-proof.ts";

const CREATED_AT = "2026-05-17T00:00:00.000Z";
const READY_NEXT_ACTION = "row_owner_confirm_r1150_feature_only_safe_availability_from_r1160_transcription_proof";

describe("R1160 R1159 feature-only safe confirmation transcription proof", () => {
  it("proves the R1159 answer sheet mechanically transcribes to R1150 feature-only readiness without persisting confirmation values", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1160-ready-"));
    try {
      const paths = await writeFixtures(tmp);
      const { output, outputPath } = await runR1160R1159FeatureOnlySafeConfirmationTranscriptionProof({
        createdAt: CREATED_AT,
        featureOnlyTemplatePath: paths.featureOnlyTemplatePath,
        outputDir: tmp,
        r1159Path: paths.r1159Path,
      });
      const persisted = JSON.parse(await readFile(outputPath, "utf8"));

      expect(path.basename(outputPath)).toBe(
        "r1160-r1159-feature-only-safe-confirmation-transcription-proof.latest.json",
      );
      expect(output.schemaVersion).toBe(R1160_R1159_FEATURE_ONLY_SAFE_CONFIRMATION_TRANSCRIPTION_PROOF_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "r1159_feature_only_safe_confirmation_transcription_ready_non_evidence",
        confirmationValuesStoredByR1160: false,
        exactSafeTranscriptionStepCount: 15,
        featureOnlyTemplateReady: true,
        hypotheticalTranscriptionWouldBeFeatureOnlyReady: true,
        modelEvidencePromotionAllowed: false,
        nextAction: READY_NEXT_ACTION,
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1160: false,
        rowOwnerConfirmationStillRequired: true,
        rowOwnerProvidedValuesStored: false,
        rowParsingPerformedByR1160: false,
        r1159AnswerSheetReadyForRowOwner: true,
        targetAgeBand: "roughly_16_50",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
        transcriptionProofReadyForRowOwnerConfirmation: true,
      });
      expect(output.summary.minimumFeaturePairRequired).toEqual([
        "bloodwork_glycemia",
        "wearable_activity_daily",
      ]);
      expect(output.summary.requiredInputKindIds).toEqual([
        "lab_portal_export_or_spreadsheet",
        "phone_watch_or_wearable_activity_export",
      ]);
      expect(output.transcriptionProof).toMatchObject({
        proofRole: "mechanical_transcription_proof_only_not_confirmation_not_model_evidence",
        transcribedConfirmationPersisted: false,
      });
      expect(output.transcriptionProof.transcriptionSteps.map((step) => step.fieldPath)).toEqual([
        "aggregateReadinessFacts.targetAgeBand",
        "sourceFamilies[bloodwork_glycemia].available",
        "sourceFamilies[wearable_activity_daily].available",
        "rowOwnerAssertionsConfirmed",
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
      ]);
      expect(output.transcriptionProof.transcriptionSteps.every((step) => step.privateDetailsStored === false)).toBe(true);
      expect(output.artifactBoundary.confirmationValuesStoredByR1160).toBe(false);
      expect(output.artifactBoundary.transcribedConfirmationPersisted).toBe(false);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(findForbiddenAggregateEgress(persisted)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits for the R1159 answer sheet when it is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1160-missing-r1159-"));
    try {
      const paths = await writeFixtures(tmp);
      await rm(paths.r1159Path, { force: true });

      const { output } = await runR1160R1159FeatureOnlySafeConfirmationTranscriptionProof({
        createdAt: CREATED_AT,
        featureOnlyTemplatePath: paths.featureOnlyTemplatePath,
        outputDir: tmp,
        r1159Path: paths.r1159Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "r1159_feature_only_safe_confirmation_transcription_waiting_on_r1159_answer_sheet",
        exactSafeTranscriptionStepCount: 0,
        featureOnlyTemplateReady: true,
        hypotheticalTranscriptionWouldBeFeatureOnlyReady: false,
        nextAction: "refresh_r1159_safe_confirmation_answer_sheet",
        r1159AnswerSheetReadyForRowOwner: false,
        transcriptionProofReadyForRowOwnerConfirmation: false,
      });
      expect(output.inputArtifacts.r1159).toMatchObject({
        packetId: null,
        schemaVersion: null,
        status: "missing",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("marks the proof incomplete when the answer sheet omits a required safe transcription field", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1160-incomplete-"));
    try {
      const paths = await writeFixtures(tmp, {
        r1159: {
          mutate: (value) => {
            value.rowOwnerAnswerSheet.exactSafeAnswers = value.rowOwnerAnswerSheet.exactSafeAnswers.filter(
              (answer) => answer.fieldPath !== "attestations.noSourceTextEgress",
            );
          },
        },
      });

      const { output } = await runR1160R1159FeatureOnlySafeConfirmationTranscriptionProof({
        createdAt: CREATED_AT,
        featureOnlyTemplatePath: paths.featureOnlyTemplatePath,
        outputDir: tmp,
        r1159Path: paths.r1159Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "r1159_feature_only_safe_confirmation_transcription_incomplete",
        exactSafeTranscriptionStepCount: 14,
        featureOnlyTemplateReady: true,
        hypotheticalTranscriptionWouldBeFeatureOnlyReady: false,
        nextAction: "refresh_r1159_safe_confirmation_answer_sheet",
        r1159AnswerSheetReadyForRowOwner: true,
        transcriptionProofReadyForRowOwnerConfirmation: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe answer-sheet inputs before producing proof", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1160-unsafe-"));
    try {
      const paths = await writeFixtures(tmp, {
        r1159: {
          mutate: (value) => {
            value.artifactBoundary.localPathsStored = true;
          },
        },
      });

      await expect(runR1160R1159FeatureOnlySafeConfirmationTranscriptionProof({
        createdAt: CREATED_AT,
        featureOnlyTemplatePath: paths.featureOnlyTemplatePath,
        outputDir: tmp,
        r1159Path: paths.r1159Path,
      })).rejects.toThrow(/R1160 rejected unsafe r1159 input/u);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a CLI summary for the transcription proof", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1160-cli-"));
    try {
      const paths = await writeFixtures(tmp);
      const stdout = await execFileStdout("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1160-r1159-feature-only-safe-confirmation-transcription-proof.ts"),
      ], {
        MURPH_AGE_R1150_FEATURE_ONLY_SAFE_AVAILABILITY_CONFIRMATION_TEMPLATE_PATH:
          paths.featureOnlyTemplatePath,
        MURPH_AGE_R1159_ORDINARY_CONSUMER_SAFE_CONFIRMATION_ANSWER_SHEET_PATH:
          paths.r1159Path,
      });
      const parsed = JSON.parse(stdout) as {
        nextAction: string;
        packetId: string;
        schemaVersion: string;
      };

      expect(parsed).toMatchObject({
        nextAction: READY_NEXT_ACTION,
        packetId: "r1160-r1159-feature-only-safe-confirmation-transcription-proof",
        schemaVersion: R1160_R1159_FEATURE_ONLY_SAFE_CONFIRMATION_TRANSCRIPTION_PROOF_SCHEMA_VERSION,
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtures(
  tmp: string,
  options: {
    r1159?: {
      mutate?: (value: ReturnType<typeof r1159Fixture>) => void;
    };
  } = {},
): Promise<{
  featureOnlyTemplatePath: string;
  r1159Path: string;
}> {
  const paths = {
    featureOnlyTemplatePath: path.join(tmp, "r1150-feature-only-template.json"),
    r1159Path: path.join(tmp, "r1159-answer-sheet.json"),
  };
  const r1159 = r1159Fixture();
  options.r1159?.mutate?.(r1159);
  await Promise.all([
    writeJson(paths.featureOnlyTemplatePath, featureOnlyTemplateFixture()),
    writeJson(paths.r1159Path, r1159),
  ]);
  return paths;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function execFileStdout(
  command: string,
  args: string[],
  env: Record<string, string>,
): Promise<string> {
  return await new Promise((resolve, reject) => {
    execFile(command, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...env,
      },
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}\n${stderr}`));
        return;
      }
      resolve(stdout);
    });
  });
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
    featureOnlyCoverageRequiresPreferredPair: true,
    minimumFeaturePairRequired: ["bloodwork_glycemia", "wearable_activity_daily"],
    outcomeLinkageRequiredForFeatureOnlyContext: false,
    recipeId: "lab_plus_wearable_minimum_manifest",
    rowOwnerAssertionsConfirmed: false,
    rowLevelDataAcceptedByR1150: false,
    schemaVersion: "murph-age-r1150-ordinary-consumer-safe-availability-confirmation.v1",
    sourceFamilies: [
      {
        available: false,
        familyId: "bloodwork_glycemia",
        requiredForFeatureOnlyPreferredPair: true,
        requiredForRecommendedRecipe: true,
        safeConfirmationMeaning: "Glycemia bloodwork exists.",
      },
      {
        available: false,
        familyId: "wearable_activity_daily",
        requiredForFeatureOnlyPreferredPair: true,
        requiredForRecommendedRecipe: true,
        safeConfirmationMeaning: "Daily wearable activity exists.",
      },
    ],
    targetAgeBand: "roughly_16_50",
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
  };
}

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
] as const;

function r1159Fixture(): {
  artifactBoundary: Record<string, boolean>;
  packetId: string;
  productDisplayAuthorized: boolean;
  rowOwnerAnswerSheet: {
    exactSafeAnswers: Array<{
      answerId: string;
      fieldPath: string;
      mapsToSourceFamilyIds: string[];
      privateDetailsStored: boolean;
      safeSetTo: boolean | string;
    }>;
  };
  schemaVersion: string;
  status: string;
  summary: Record<string, unknown>;
} {
  const fieldPaths = [
    "aggregateReadinessFacts.targetAgeBand",
    "sourceFamilies[bloodwork_glycemia].available",
    "sourceFamilies[wearable_activity_daily].available",
    "rowOwnerAssertionsConfirmed",
    ...REQUIRED_ATTESTATION_KEYS.map((key) => `attestations.${key}`),
  ];
  return {
    artifactBoundary: {
      aggregateOnly: true,
      answerSheetTemplatePathStored: false,
      availabilityConfirmationPathStored: false,
      codebookTextStored: false,
      coefficientsStored: false,
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
      rowLevelDataAcceptedByR1159: false,
      rowOwnerProvidedValuesStored: false,
      rowParsingPerformedByR1159: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceFileNamesStored: false,
      sourceVariableNamesStored: false,
      splitMembershipStored: false,
      submittedConfirmationValuesStored: false,
    },
    packetId: "r1159-ordinary-consumer-safe-confirmation-answer-sheet",
    productDisplayAuthorized: false,
    rowOwnerAnswerSheet: {
      exactSafeAnswers: fieldPaths.map((fieldPath) => ({
        answerId: `answer_${fieldPath.replace(/[^A-Za-z0-9]+/gu, "_")}`,
        fieldPath,
        mapsToSourceFamilyIds: fieldPath.includes("bloodwork_glycemia")
          ? ["bloodwork_glycemia"]
          : fieldPath.includes("wearable_activity_daily")
            ? ["wearable_activity_daily"]
            : fieldPath === "rowOwnerAssertionsConfirmed"
              ? ["bloodwork_glycemia", "wearable_activity_daily"]
              : [],
        privateDetailsStored: false,
        safeSetTo: fieldPath === "aggregateReadinessFacts.targetAgeBand" ? "roughly_16_50" : true,
      })),
    },
    schemaVersion: "murph-age-r1159-ordinary-consumer-safe-confirmation-answer-sheet.v1",
    status: "research-local-aggregate-only",
    summary: {
      answerSheetReadyForRowOwner: true,
      conclusion: "ordinary_safe_confirmation_answer_sheet_ready_non_evidence",
      exactSafeAnswerCount: 15,
      minimumFeaturePairRequired: ["bloodwork_glycemia", "wearable_activity_daily"],
      modelEvidencePromotionAllowed: false,
      nextAction: "fill_r1150_feature_only_safe_confirmation_from_r1159_answer_sheet",
      optionalAddOnFamilyIds: ["common_bloodwork_core", "vitals_body_context"],
      productDisplayAuthorized: false,
      requiredChecklistIds: [
        "confirm_target_age_band_without_identifiers",
        "confirm_glycemia_bloodwork_export_available",
        "confirm_daily_wearable_activity_export_available",
        "confirm_no_private_values_in_confirmation",
      ],
      requiredInputKindIds: [
        "lab_portal_export_or_spreadsheet",
        "phone_watch_or_wearable_activity_export",
      ],
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1159: false,
      rowOwnerProvidedValuesStored: false,
      rowParsingPerformedByR1159: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}
