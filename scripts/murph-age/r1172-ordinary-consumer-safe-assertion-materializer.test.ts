import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { runR1165OrdinaryConsumerFeatureOnlySafeAssertionRunner } from "./r1165-ordinary-consumer-feature-only-safe-assertion-runner.ts";
import { runR1167OrdinaryConsumerFeatureOnlySafeAssertionFillGuide } from "./r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide.ts";
import {
  R1172_ORDINARY_CONSUMER_SAFE_ASSERTION_MATERIALIZER_SCHEMA_VERSION,
  runR1172OrdinaryConsumerSafeAssertionMaterializer,
} from "./r1172-ordinary-consumer-safe-assertion-materializer.ts";

const CREATED_AT = "2026-05-18T00:00:00.000Z";
const WAITING_NEXT_ACTION = "rerun_r1172_with_row_owner_feature_only_safe_assertion_confirmation";
const MATERIALIZED_NEXT_ACTION = "run_r1165_with_r1172_row_owner_safe_assertion";
const REQUIRED_INPUT_KIND_IDS = [
  "lab_portal_export_or_spreadsheet",
  "phone_watch_or_wearable_activity_export",
];
const ALLOWED_VALUE_KIND_IDS = [
  "booleans_only",
  "fixed_enumerated_ids_only",
];
const BLOCKED_CONTENT_IDS = [
  "private_paths",
  "header_names",
  "file_names",
  "row_values",
  "participant_identifiers",
  "private_ref_values",
  "source_variable_names",
  "predictions",
  "coefficients",
  "model_parameters",
  "source_text",
  "small_cells",
];
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

describe("R1172 ordinary consumer safe assertion materializer", () => {
  it("waits for explicit row-owner confirmation and writes no assertion file by default", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1172-waiting-"));
    try {
      const paths = await writeReadyInputs(tmp);
      const { materializedAssertionPath, output, outputPath } =
        await runR1172OrdinaryConsumerSafeAssertionMaterializer({
          createdAt: CREATED_AT,
          outputDir: tmp,
          r1165Path: paths.r1165Path,
          r1165TemplatePath: paths.r1165TemplatePath,
          r1167Path: paths.r1167Path,
        });
      const persisted = JSON.parse(await readFile(outputPath, "utf8")) as unknown;

      expect(path.basename(outputPath)).toBe(
        "r1172-ordinary-consumer-safe-assertion-materializer.latest.json",
      );
      expect(materializedAssertionPath).toBeNull();
      expect(await pathExists(path.join(tmp, "r1172-row-owner-feature-only-safe-assertion.json"))).toBe(false);
      expect(output.schemaVersion).toBe(R1172_ORDINARY_CONSUMER_SAFE_ASSERTION_MATERIALIZER_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        allowedValueKindIds: ALLOWED_VALUE_KIND_IDS,
        blockedContentIds: BLOCKED_CONTENT_IDS,
        conclusion: "ordinary_consumer_safe_assertion_materializer_waiting_on_explicit_row_owner_assertion",
        explicitRowOwnerAssertionProvided: false,
        materializedAssertionArtifact: null,
        materializedAssertionWouldBeAcceptedByR1165: false,
        modelEvidencePromotionAllowed: false,
        nextAction: WAITING_NEXT_ACTION,
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1172: false,
        rowOwnerAssertionInferredByR1172: false,
        rowOwnerAssertionStillRequired: true,
        rowOwnerPrivateValuesStored: false,
        rowParsingPerformedByR1172: false,
        r1165RunnerReadyForAssertion: true,
        r1165TemplateReady: true,
        r1167FillGuideReady: true,
        safeAssertionArtifactLocalPathStored: false,
        safeAssertionArtifactWritten: false,
        safeFieldEditCount: 0,
        targetAgeBand: "roughly_16_50",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      });
      expect(output.summary.requiredInputKindIds).toEqual(REQUIRED_INPUT_KIND_IDS);
      expect(output.summary.safeFieldEditPaths).toEqual(SAFE_FIELD_EDIT_PATHS);
      expect(output.materializer.allowedValueKindIds).toEqual(ALLOWED_VALUE_KIND_IDS);
      expect(output.materializer.blockedContentIds).toEqual(BLOCKED_CONTENT_IDS);
      expect(output.artifactBoundary.assertionFileWrittenOnlyAfterExplicitAssertion).toBe(true);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(findForbiddenAggregateEgress(persisted)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("writes the R1165 safe assertion file only after explicit row-owner confirmation", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1172-confirmed-"));
    try {
      const paths = await writeReadyInputs(tmp);
      const { materializedAssertionPath, output } =
        await runR1172OrdinaryConsumerSafeAssertionMaterializer({
          createdAt: CREATED_AT,
          outputDir: tmp,
          r1165Path: paths.r1165Path,
          r1165TemplatePath: paths.r1165TemplatePath,
          r1167Path: paths.r1167Path,
          rowOwnerAssertionsConfirmed: true,
        });

      expect(materializedAssertionPath).toBe(path.join(tmp, "r1172-row-owner-feature-only-safe-assertion.json"));
      const assertion = JSON.parse(await readFile(materializedAssertionPath ?? "", "utf8")) as Record<string, unknown>;

      expect(output.summary).toMatchObject({
        allowedValueKindIds: ALLOWED_VALUE_KIND_IDS,
        blockedContentIds: BLOCKED_CONTENT_IDS,
        conclusion: "ordinary_consumer_safe_assertion_materialized",
        explicitRowOwnerAssertionProvided: true,
        materializedAssertionArtifact: "r1172-row-owner-feature-only-safe-assertion.json",
        materializedAssertionWouldBeAcceptedByR1165: true,
        nextAction: MATERIALIZED_NEXT_ACTION,
        rowOwnerAssertionStillRequired: false,
        safeAssertionArtifactWritten: true,
        safeFieldEditCount: SAFE_FIELD_EDIT_PATHS.length,
      });
      expect(assertion).toMatchObject({
        privateContentExcluded: true,
        requiredInputKindIds: REQUIRED_INPUT_KIND_IDS,
        rowOwnerAssertionsConfirmed: true,
        schemaVersion: "murph-age-r1165-row-owner-feature-only-safe-assertion.v1",
        targetAgeBand: "roughly_16_50",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      });
      expect(assertion.sourceFamilies).toEqual([
        expect.objectContaining({ available: true, familyId: "bloodwork_glycemia" }),
        expect.objectContaining({ available: true, familyId: "wearable_activity_daily" }),
      ]);
      expect(Object.values(assertion.attestations as Record<string, unknown>)).toEqual(Array(11).fill(true));
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(findForbiddenAggregateEgress(assertion)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits when the R1167 fill guide is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1172-missing-guide-"));
    try {
      const paths = await writeReadyInputs(tmp);
      await rm(paths.r1167Path, { force: true });

      const { materializedAssertionPath, output } =
        await runR1172OrdinaryConsumerSafeAssertionMaterializer({
          createdAt: CREATED_AT,
          outputDir: tmp,
          r1165Path: paths.r1165Path,
          r1165TemplatePath: paths.r1165TemplatePath,
          r1167Path: paths.r1167Path,
          rowOwnerAssertionsConfirmed: true,
        });

      expect(materializedAssertionPath).toBeNull();
      expect(output.summary).toMatchObject({
        conclusion: "ordinary_consumer_safe_assertion_materializer_waiting_on_r1167_fill_guide",
        explicitRowOwnerAssertionProvided: true,
        nextAction: "refresh_r1167_safe_assertion_fill_guide",
        r1167FillGuideReady: false,
        safeAssertionArtifactWritten: false,
      });
      expect(output.inputArtifacts.r1167FillGuide).toMatchObject({
        artifact: null,
        packetId: null,
        schemaVersion: null,
        status: "missing",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe inputs before materializing the assertion", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1172-unsafe-"));
    try {
      const paths = await writeReadyInputs(tmp);
      const unsafeGuide = JSON.parse(await readFile(paths.r1167Path, "utf8")) as {
        artifactBoundary: { localPathsStored: boolean };
      };
      unsafeGuide.artifactBoundary.localPathsStored = true;
      await writeJson(paths.r1167Path, unsafeGuide);

      await expect(runR1172OrdinaryConsumerSafeAssertionMaterializer({
        createdAt: CREATED_AT,
        outputDir: tmp,
        r1165Path: paths.r1165Path,
        r1165TemplatePath: paths.r1165TemplatePath,
        r1167Path: paths.r1167Path,
        rowOwnerAssertionsConfirmed: true,
      })).rejects.toThrow("R1172 rejected unsafe r1167FillGuide input: 1 finding");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a CLI summary and writes the assertion only when the explicit assertion env var is true", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1172-cli-"));
    try {
      const paths = await writeReadyInputs(tmp);
      const outDir = path.join(tmp, "out");
      const stdout = await execFileStdout("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1172-ordinary-consumer-safe-assertion-materializer.ts"),
      ], {
        MURPH_AGE_R1165_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_RUNNER_PATH: paths.r1165Path,
        MURPH_AGE_R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_TEMPLATE_PATH: paths.r1165TemplatePath,
        MURPH_AGE_R1167_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_FILL_GUIDE_PATH: paths.r1167Path,
        MURPH_AGE_R1172_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTIONS_CONFIRMED: "true",
        MURPH_AGE_RESEARCH_OUTPUT_DIR: outDir,
      });
      const parsed = JSON.parse(stdout) as {
        allowedValueKindIds: string[];
        blockedContentIds: string[];
        nextAction: string;
        packetId: string;
        safeAssertionArtifactWritten: boolean;
        schemaVersion: string;
      };

      expect(parsed).toMatchObject({
        allowedValueKindIds: ALLOWED_VALUE_KIND_IDS,
        blockedContentIds: BLOCKED_CONTENT_IDS,
        nextAction: MATERIALIZED_NEXT_ACTION,
        packetId: "r1172-ordinary-consumer-safe-assertion-materializer",
        safeAssertionArtifactWritten: true,
        schemaVersion: R1172_ORDINARY_CONSUMER_SAFE_ASSERTION_MATERIALIZER_SCHEMA_VERSION,
      });
      expect(await pathExists(path.join(outDir, "r1172-row-owner-feature-only-safe-assertion.json"))).toBe(true);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a sanitized CLI error when a local path appears in the failure", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1172-cli-error-"));
    try {
      const paths = await writeReadyInputs(tmp);
      const blockedOutputDir = path.join(tmp, "blocked-output");
      await writeFile(blockedOutputDir, "not a directory\n");

      const stderr = await execFileFailureStderr("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1172-ordinary-consumer-safe-assertion-materializer.ts"),
      ], {
        MURPH_AGE_R1165_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_RUNNER_PATH: paths.r1165Path,
        MURPH_AGE_R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_TEMPLATE_PATH: paths.r1165TemplatePath,
        MURPH_AGE_R1167_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_FILL_GUIDE_PATH: paths.r1167Path,
        MURPH_AGE_R1172_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTIONS_CONFIRMED: "true",
        MURPH_AGE_RESEARCH_OUTPUT_DIR: blockedOutputDir,
      });

      expect(stderr).toBe("R1172 safe assertion materializer failed.\n");
      expect(stderr).not.toContain(tmp);
      expect(stderr).not.toContain(process.cwd());
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeReadyInputs(tmp: string): Promise<{
  r1165Path: string;
  r1165TemplatePath: string;
  r1167Path: string;
}> {
  const inputDir = path.join(tmp, "inputs");
  const outDir = path.join(tmp, "out");
  await mkdir(inputDir, { recursive: true });
  await writeJson(path.join(inputDir, "r1149.json"), r1149Fixture());
  await writeJson(path.join(inputDir, "r1160.json"), r1160Fixture());
  const r1165 = await runR1165OrdinaryConsumerFeatureOnlySafeAssertionRunner({
    createdAt: CREATED_AT,
    featureOnlyTemplatePath: path.join(inputDir, "feature-only-template.json"),
    outputDir: outDir,
    r1149Path: path.join(inputDir, "r1149.json"),
    r1160Path: path.join(inputDir, "r1160.json"),
  });
  await writeJson(path.join(inputDir, "feature-only-template.json"), featureOnlyTemplateFixture());
  const r1167 = await runR1167OrdinaryConsumerFeatureOnlySafeAssertionFillGuide({
    createdAt: CREATED_AT,
    outputDir: outDir,
    r1165Path: path.join(outDir, "r1165-ordinary-consumer-feature-only-safe-assertion-runner.latest.json"),
    r1165TemplatePath: path.join(outDir, "r1165-row-owner-feature-only-safe-assertion.template.json"),
  });
  return {
    r1165Path: r1165.outputPath,
    r1165TemplatePath: path.join(outDir, "r1165-row-owner-feature-only-safe-assertion.template.json"),
    r1167Path: r1167.outputPath,
  };
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
    featureOnlyCoverageRequiresPreferredPair: true,
    minimumFeaturePairRequired: [
      "bloodwork_glycemia",
      "wearable_activity_daily",
    ],
    outcomeLinkageRequiredForFeatureOnlyContext: false,
    recipeId: "lab_plus_wearable_minimum_manifest",
    rowLevelDataAcceptedByR1150: false,
    rowOwnerAssertionsConfirmed: false,
    schemaVersion: "murph-age-r1150-ordinary-consumer-safe-availability-confirmation.v1",
    sourceFamilies: [
      {
        available: false,
        familyId: "bloodwork_glycemia",
      },
      {
        available: false,
        familyId: "wearable_activity_daily",
      },
    ],
    targetAgeBand: "roughly_16_50",
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
  };
}

function r1149Fixture(): Record<string, unknown> {
  return {
    ordinaryConsumerSubmissionKit: {
      commands: {
        featureOnlySubmissionModeCommand:
          "pnpm exec tsx scripts/murph-age/r1151-ordinary-consumer-feature-only-submission-mode.ts",
      },
      featureOnlySubmissionMode: {
        featureOnlyCoverageContextAllowed: true,
        modelEvidencePromotionAllowed: false,
        outcomeLinkedEvidenceReady: false,
        privateDetailsStored: false,
      },
    },
    packetId: "r1149-ordinary-consumer-lab-wearable-submission-kit",
    schemaVersion: "murph-age-r1149-ordinary-consumer-lab-wearable-submission-kit.v1",
    status: "research-local-aggregate-only",
    summary: {
      featureOnlyModeConclusion: "ordinary_consumer_feature_only_submission_mode_ready_research_only",
      featureOnlyModeModelEvidencePromotionAllowed: false,
      featureOnlyModeOutcomeLinkedEvidenceReady: false,
    },
  };
}

function r1160Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      confirmationValuesStoredByR1160: false,
      rowLevelDataAcceptedByR1160: false,
      rowOwnerProvidedValuesStored: false,
      transcribedConfirmationPersisted: false,
    },
    packetId: "r1160-r1159-feature-only-safe-confirmation-transcription-proof",
    schemaVersion: "murph-age-r1160-r1159-feature-only-safe-confirmation-transcription-proof.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "r1159_feature_only_safe_confirmation_transcription_ready_non_evidence",
      exactSafeTranscriptionStepCount: 15,
      hypotheticalTranscriptionWouldBeFeatureOnlyReady: true,
      minimumFeaturePairRequired: [
        "bloodwork_glycemia",
        "wearable_activity_daily",
      ],
      modelEvidencePromotionAllowed: false,
      nextAction: "row_owner_confirm_r1150_feature_only_safe_availability_from_r1160_transcription_proof",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowOwnerConfirmationStillRequired: true,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      transcriptionProofReadyForRowOwnerConfirmation: true,
    },
  };
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

function execFileFailureStderr(
  file: string,
  args: string[],
  env: Record<string, string>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, {
      encoding: "utf8",
      env: {
        ...process.env,
        ...env,
      },
    }, (error, _stdout, stderr) => {
      if (error) {
        resolve(stderr);
        return;
      }
      reject(new Error("Expected CLI command to fail."));
    });
  });
}
