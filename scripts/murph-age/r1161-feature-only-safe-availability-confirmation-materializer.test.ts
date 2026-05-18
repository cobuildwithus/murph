import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  runR1161FeatureOnlySafeAvailabilityConfirmationMaterializer,
  R1161_FEATURE_ONLY_SAFE_AVAILABILITY_CONFIRMATION_MATERIALIZER_SCHEMA_VERSION,
} from "./r1161-feature-only-safe-availability-confirmation-materializer.ts";

const CREATED_AT = "2026-05-17T00:00:00.000Z";
const WAITING_NEXT_ACTION = "rerun_r1161_with_row_owner_feature_only_confirmation_assertion";
const MATERIALIZED_NEXT_ACTION =
  "run_r1150_intake_with_r1161_confirmed_feature_only_safe_availability_confirmation";

describe("R1161 feature-only safe availability confirmation materializer", () => {
  it("waits for explicit row-owner confirmation and does not write the confirmed R1150 file by default", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1161-waiting-"));
    try {
      const paths = await writeFixtures(tmp);
      const { confirmedConfirmationPath, output, outputPath } =
        await runR1161FeatureOnlySafeAvailabilityConfirmationMaterializer({
          createdAt: CREATED_AT,
          featureOnlyTemplatePath: paths.featureOnlyTemplatePath,
          outputDir: tmp,
          r1160Path: paths.r1160Path,
        });
      const persisted = JSON.parse(await readFile(outputPath, "utf8"));

      expect(path.basename(outputPath)).toBe(
        "r1161-feature-only-safe-availability-confirmation-materializer.latest.json",
      );
      expect(confirmedConfirmationPath).toBeNull();
      expect(await pathExists(path.join(tmp, "r1161-confirmed-feature-only-safe-availability-confirmation.json"))).toBe(false);
      expect(output.schemaVersion).toBe(R1161_FEATURE_ONLY_SAFE_AVAILABILITY_CONFIRMATION_MATERIALIZER_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "feature_only_safe_availability_confirmation_materializer_waiting_on_explicit_row_owner_confirmation",
        confirmationArtifactLocalPathStored: false,
        confirmationValuesStoredInR1161Packet: false,
        explicitRowOwnerConfirmationAssertionProvided: false,
        featureOnlyConfirmationWouldBeReadyForR1150: false,
        featureOnlyTemplateReady: true,
        nextAction: WAITING_NEXT_ACTION,
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1161: false,
        rowOwnerConfirmationStillRequired: true,
        rowOwnerPrivateValuesStored: false,
        rowParsingPerformedByR1161: false,
        r1160ProofReadyForRowOwnerConfirmation: true,
        safeConfirmationArtifact: null,
        safeConfirmationArtifactWritten: false,
        safeMaterializedFieldCount: 0,
        targetAgeBand: "roughly_16_50",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      });
      expect(output.summary.minimumFeaturePairRequired).toEqual([
        "bloodwork_glycemia",
        "wearable_activity_daily",
      ]);
      expect(output.artifactBoundary.safeConfirmationArtifactWrittenOnlyAfterExplicitAssertion).toBe(true);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(findForbiddenAggregateEgress(persisted)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("writes the confirmed feature-only R1150 confirmation only after the explicit assertion is provided", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1161-confirmed-"));
    try {
      const paths = await writeFixtures(tmp);
      const { confirmedConfirmationPath, output } =
        await runR1161FeatureOnlySafeAvailabilityConfirmationMaterializer({
          createdAt: CREATED_AT,
          featureOnlyTemplatePath: paths.featureOnlyTemplatePath,
          outputDir: tmp,
          r1160Path: paths.r1160Path,
          rowOwnerAssertionsConfirmed: true,
        });

      expect(confirmedConfirmationPath).toBe(path.join(
        tmp,
        "r1161-confirmed-feature-only-safe-availability-confirmation.json",
      ));
      const confirmation = JSON.parse(await readFile(confirmedConfirmationPath ?? "", "utf8"));

      expect(output.summary).toMatchObject({
        conclusion: "feature_only_safe_availability_confirmation_materialized",
        confirmationArtifactLocalPathStored: false,
        confirmationValuesStoredInR1161Packet: false,
        explicitRowOwnerConfirmationAssertionProvided: true,
        featureOnlyConfirmationWouldBeReadyForR1150: true,
        nextAction: MATERIALIZED_NEXT_ACTION,
        rowOwnerConfirmationStillRequired: false,
        safeConfirmationArtifact: "r1161-confirmed-feature-only-safe-availability-confirmation.json",
        safeConfirmationArtifactWritten: true,
        safeMaterializedFieldCount: 15,
      });
      expect(confirmation).toMatchObject({
        aggregateReadinessFacts: {
          eventCountBand: "not_confirmed",
          outcomeLinked: false,
          sameDenominator: false,
          targetAgeBand: "roughly_16_50",
          usableRecordCountBand: "not_confirmed",
        },
        rowLevelDataAcceptedByR1150: false,
        rowOwnerAssertionsConfirmed: true,
        schemaVersion: "murph-age-r1150-ordinary-consumer-safe-availability-confirmation.v1",
        targetAgeBand: "roughly_16_50",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      });
      expect(confirmation.sourceFamilies).toEqual([
        expect.objectContaining({ available: true, familyId: "bloodwork_glycemia" }),
        expect.objectContaining({ available: true, familyId: "wearable_activity_daily" }),
      ]);
      expect(Object.values(confirmation.attestations)).toEqual(Array(11).fill(true));
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(findForbiddenAggregateEgress(confirmation)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits for R1160 when the transcription proof is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1161-missing-r1160-"));
    try {
      const paths = await writeFixtures(tmp);
      await rm(paths.r1160Path, { force: true });

      const { output } = await runR1161FeatureOnlySafeAvailabilityConfirmationMaterializer({
        createdAt: CREATED_AT,
        featureOnlyTemplatePath: paths.featureOnlyTemplatePath,
        outputDir: tmp,
        r1160Path: paths.r1160Path,
        rowOwnerAssertionsConfirmed: true,
      });

      expect(output.summary).toMatchObject({
        conclusion: "feature_only_safe_availability_confirmation_materializer_waiting_on_r1160_transcription_proof",
        explicitRowOwnerConfirmationAssertionProvided: true,
        nextAction: "refresh_r1160_transcription_proof",
        r1160ProofReadyForRowOwnerConfirmation: false,
        safeConfirmationArtifactWritten: false,
      });
      expect(output.inputArtifacts.r1160).toMatchObject({
        packetId: null,
        schemaVersion: null,
        status: "missing",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe transcription-proof inputs before materializing confirmation", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1161-unsafe-"));
    try {
      const paths = await writeFixtures(tmp, {
        r1160: {
          mutate: (value) => {
            value.artifactBoundary.localPathsStored = true;
          },
        },
      });

      await expect(runR1161FeatureOnlySafeAvailabilityConfirmationMaterializer({
        createdAt: CREATED_AT,
        featureOnlyTemplatePath: paths.featureOnlyTemplatePath,
        outputDir: tmp,
        r1160Path: paths.r1160Path,
        rowOwnerAssertionsConfirmed: true,
      })).rejects.toThrow(/R1161 rejected unsafe r1160 input/u);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a CLI summary and writes the confirmation only when the assertion env var is true", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1161-cli-"));
    try {
      const paths = await writeFixtures(tmp);
      const outDir = path.join(tmp, "out");
      const stdout = await execFileStdout("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1161-feature-only-safe-availability-confirmation-materializer.ts"),
      ], {
        MURPH_AGE_R1150_FEATURE_ONLY_SAFE_AVAILABILITY_CONFIRMATION_TEMPLATE_PATH:
          paths.featureOnlyTemplatePath,
        MURPH_AGE_R1160_R1159_FEATURE_ONLY_SAFE_CONFIRMATION_TRANSCRIPTION_PROOF_PATH:
          paths.r1160Path,
        MURPH_AGE_R1161_ROW_OWNER_FEATURE_ONLY_CONFIRMATION_ASSERTIONS_CONFIRMED: "true",
        MURPH_AGE_RESEARCH_OUTPUT_DIR: outDir,
      });
      const parsed = JSON.parse(stdout) as {
        nextAction: string;
        packetId: string;
        safeConfirmationArtifactWritten: boolean;
        schemaVersion: string;
      };

      expect(parsed).toMatchObject({
        nextAction: MATERIALIZED_NEXT_ACTION,
        packetId: "r1161-feature-only-safe-availability-confirmation-materializer",
        safeConfirmationArtifactWritten: true,
        schemaVersion: R1161_FEATURE_ONLY_SAFE_AVAILABILITY_CONFIRMATION_MATERIALIZER_SCHEMA_VERSION,
      });
      expect(await pathExists(path.join(outDir, "r1161-confirmed-feature-only-safe-availability-confirmation.json"))).toBe(true);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtures(
  tmp: string,
  options: {
    r1160?: {
      mutate?: (value: ReturnType<typeof r1160Fixture>) => void;
    };
  } = {},
): Promise<{
  featureOnlyTemplatePath: string;
  r1160Path: string;
}> {
  const paths = {
    featureOnlyTemplatePath: path.join(tmp, "r1150-feature-only-template.json"),
    r1160Path: path.join(tmp, "r1160-transcription-proof.json"),
  };
  const r1160 = r1160Fixture();
  options.r1160?.mutate?.(r1160);
  await Promise.all([
    writeJson(paths.featureOnlyTemplatePath, featureOnlyTemplateFixture()),
    writeJson(paths.r1160Path, r1160),
  ]);
  return paths;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
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

function r1160Fixture(): {
  artifactBoundary: Record<string, boolean>;
  packetId: string;
  productDisplayAuthorized: boolean;
  schemaVersion: string;
  status: string;
  summary: Record<string, unknown>;
} {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      answerSheetValuesStored: false,
      availabilityConfirmationPathStored: false,
      codebookTextStored: false,
      coefficientsStored: false,
      confirmationValuesStoredByR1160: false,
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
      rowLevelDataAcceptedByR1160: false,
      rowOwnerProvidedValuesStored: false,
      rowParsingPerformedByR1160: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceFileNamesStored: false,
      sourceVariableNamesStored: false,
      splitMembershipStored: false,
      transcribedConfirmationPersisted: false,
    },
    packetId: "r1160-r1159-feature-only-safe-confirmation-transcription-proof",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1160-r1159-feature-only-safe-confirmation-transcription-proof.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "r1159_feature_only_safe_confirmation_transcription_ready_non_evidence",
      confirmationValuesStoredByR1160: false,
      exactSafeTranscriptionStepCount: 15,
      featureOnlyTemplateReady: true,
      hypotheticalTranscriptionWouldBeFeatureOnlyReady: true,
      minimumFeaturePairRequired: ["bloodwork_glycemia", "wearable_activity_daily"],
      modelEvidencePromotionAllowed: false,
      nextAction: "row_owner_confirm_r1150_feature_only_safe_availability_from_r1160_transcription_proof",
      optionalAddOnFamilyIds: ["common_bloodwork_core", "vitals_body_context"],
      productDisplayAuthorized: false,
      requiredInputKindIds: [
        "lab_portal_export_or_spreadsheet",
        "phone_watch_or_wearable_activity_export",
      ],
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1160: false,
      rowOwnerConfirmationStillRequired: true,
      rowOwnerProvidedValuesStored: false,
      rowParsingPerformedByR1160: false,
      r1159AnswerSheetReadyForRowOwner: true,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      transcriptionProofReadyForRowOwnerConfirmation: true,
    },
  };
}
