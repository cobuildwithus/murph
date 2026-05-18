import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1167_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_FILL_GUIDE_SCHEMA_VERSION,
  R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND,
} from "./r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide.ts";
import {
  R1172_ORDINARY_CONSUMER_SAFE_ASSERTION_MATERIALIZER_SCHEMA_VERSION,
  R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND,
} from "./r1172-ordinary-consumer-safe-assertion-materializer.ts";
import {
  R1173_ORDINARY_CONSUMER_SAFE_ASSERTION_ANSWER_SHEET_SCHEMA_VERSION,
  R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND,
  runR1173OrdinaryConsumerSafeAssertionAnswerSheet,
} from "./r1173-ordinary-consumer-safe-assertion-answer-sheet.ts";

const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first";
const FEATURE_ONLY_SOURCE_FAMILY_IDS = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
];
const OPTIONAL_ADD_ON_FAMILY_IDS = [
  "common_bloodwork_core",
  "vitals_body_context",
];
const REQUIRED_INPUT_KIND_IDS = [
  "lab_portal_export_or_spreadsheet",
  "phone_watch_or_wearable_activity_export",
];
const ALLOWED_VALUE_KIND_IDS = [
  "booleans_only",
  "fixed_enumerated_ids_only",
];
const REQUIRED_ASSERTION_CHECKLIST_IDS = [
  "assert_target_age_band_roughly_16_50",
  "assert_glycemia_bloodwork_export_available",
  "assert_daily_wearable_activity_export_available",
  "assert_no_private_values_identifiers_paths_headers_or_rows",
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
const SAFE_FIELD_EDIT_PATHS = [
  "sourceFamilies[bloodwork_glycemia].available",
  "sourceFamilies[wearable_activity_daily].available",
  "sourceFamilies[common_bloodwork_core].available",
  "sourceFamilies[vitals_body_context].available",
  "rowOwnerAssertionsConfirmed",
  "privateContentExcluded",
  ...REQUIRED_ATTESTATION_KEYS.map((key) => `attestations.${key}`),
];
const BLOCKED_ASSERTION_CONTENT = [
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

describe("R1173 ordinary consumer safe assertion answer sheet", () => {
  it("emits a pathless answer sheet for the R1165/R1172 feature-only safe assertion", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1173-ready-"));
    try {
      const paths = await writeInputs(tmp);

      const { answerSheetTemplatePath, output, outputPath } =
        await runR1173OrdinaryConsumerSafeAssertionAnswerSheet({
          createdAt: "2026-05-18T00:00:00.000Z",
          outputDir: path.join(tmp, "out"),
          ...paths,
        });

      expect(path.basename(outputPath)).toBe("r1173-ordinary-consumer-safe-assertion-answer-sheet.latest.json");
      expect(path.basename(answerSheetTemplatePath)).toBe(
        "r1173-fillable-ordinary-consumer-safe-assertion-answer-sheet.json",
      );
      expect(output.schemaVersion).toBe(R1173_ORDINARY_CONSUMER_SAFE_ASSERTION_ANSWER_SHEET_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        allowedValueKindIds: ALLOWED_VALUE_KIND_IDS,
        answerSheetReadyForRowOwner: true,
        blockedAssertionContentIds: BLOCKED_ASSERTION_CONTENT,
        conclusion: "ordinary_safe_assertion_answer_sheet_ready_non_evidence",
        exactSafeAnswerCount: SAFE_FIELD_EDIT_PATHS.length,
        fillGuideReadyForRowOwnerFill: true,
        materializerExplicitConfirmationRequired: true,
        materializerReady: true,
        minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
        modelEvidencePromotionAllowed: false,
        nextAction: "rerun_r1172_with_row_owner_feature_only_safe_assertion_confirmation",
        optionalAddOnFamilyIds: OPTIONAL_ADD_ON_FAMILY_IDS,
        productDisplayAuthorized: false,
        requiredAssertionChecklistIds: REQUIRED_ASSERTION_CHECKLIST_IDS,
        requiredInputKindIds: REQUIRED_INPUT_KIND_IDS,
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1173: false,
        rowOwnerAssertionInferredByR1173: false,
        rowOwnerPrivateValuesStored: false,
        rowOwnerProvidedValuesStored: false,
        rowParsingPerformedByR1173: false,
        safeFieldEditCount: SAFE_FIELD_EDIT_PATHS.length,
        safeFieldEditPaths: SAFE_FIELD_EDIT_PATHS,
        targetAgeBand: "roughly_16_50",
        targetInputPriority: TARGET_INPUT_PRIORITY,
      });
      expect(output.rowOwnerAnswerSheet).toMatchObject({
        answerSheetRole: "answer_sheet_only_not_assertion_not_model_evidence",
        answerSheetTemplateArtifact: "r1173-fillable-ordinary-consumer-safe-assertion-answer-sheet.json",
        allowedValueKindIds: ALLOWED_VALUE_KIND_IDS,
        audience: "ordinary_submitter_roughly_16_50_row_owner",
        blockedAssertionContent: BLOCKED_ASSERTION_CONTENT,
        commands: {
          safeAssertionAnswerSheetCommand: R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND,
          safeAssertionFillGuideCommand: R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND,
          safeAssertionMaterializerCommand: R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND,
        },
        fixedSafeAssertionValues: {
          targetAgeBand: "roughly_16_50",
          targetInputPriority: TARGET_INPUT_PRIORITY,
        },
        materializerExplicitConfirmationRequired: true,
        minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
        modelEvidencePromotionAllowed: false,
        privateDetailsStored: false,
        readyForR1172MaterializerConfirmation: true,
        requiredAssertionChecklistIds: REQUIRED_ASSERTION_CHECKLIST_IDS,
        requiredAttestationKeys: REQUIRED_ATTESTATION_KEYS,
        rowLevelDataAcceptedByR1173: false,
        rowOwnerProvidedValuesStored: false,
      });
      expect(output.rowOwnerAnswerSheet.exactSafeAnswers.map((answer) => answer.fieldPath)).toEqual(
        SAFE_FIELD_EDIT_PATHS,
      );
      expect(output.rowOwnerAnswerSheet.exactSafeAnswers.map((answer) => answer.safeSetTo)).toEqual(
        Array.from({ length: SAFE_FIELD_EDIT_PATHS.length }, () => true),
      );
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
          mapsToSourceFamilyIds: OPTIONAL_ADD_ON_FAMILY_IDS,
          requiredForFeatureOnlyPreferredPair: false,
        },
      ]);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = JSON.parse(await readFile(outputPath, "utf8")) as unknown;
      const template = JSON.parse(await readFile(answerSheetTemplatePath, "utf8")) as {
        allowedValueKindIds: string[];
        exactSafeAnswers: Array<{ fieldPath: string }>;
        readyForR1172MaterializerConfirmation: boolean;
      };
      expect(findForbiddenAggregateEgress(persisted)).toEqual([]);
      expect(findForbiddenAggregateEgress(template)).toEqual([]);
      expect(template.readyForR1172MaterializerConfirmation).toBe(true);
      expect(template.allowedValueKindIds).toEqual(ALLOWED_VALUE_KIND_IDS);
      expect(template.exactSafeAnswers.map((answer) => answer.fieldPath)).toEqual(SAFE_FIELD_EDIT_PATHS);
      expect(JSON.stringify(template)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits for the R1167 fill guide when the guide is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1173-missing-guide-"));
    try {
      const paths = await writeInputs(tmp);
      await rm(paths.r1167Path, { force: true });

      const { output } = await runR1173OrdinaryConsumerSafeAssertionAnswerSheet({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        answerSheetReadyForRowOwner: false,
        conclusion: "ordinary_safe_assertion_answer_sheet_waiting_on_r1167_fill_guide",
        exactSafeAnswerCount: 0,
        fillGuideReadyForRowOwnerFill: false,
        materializerReady: true,
        nextAction: "refresh_r1167_safe_assertion_fill_guide",
      });
      expect(output.inputArtifacts.r1167FillGuide).toMatchObject({
        schemaVersion: null,
        status: "missing",
      });
      expect(output.rowOwnerAnswerSheet.exactSafeAnswers).toEqual([]);
      expect(output.rowOwnerAnswerSheet.readyForR1172MaterializerConfirmation).toBe(false);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits for the R1172 materializer when the materializer packet is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1173-missing-materializer-"));
    try {
      const paths = await writeInputs(tmp);
      await rm(paths.r1172Path, { force: true });

      const { output } = await runR1173OrdinaryConsumerSafeAssertionAnswerSheet({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        answerSheetReadyForRowOwner: false,
        conclusion: "ordinary_safe_assertion_answer_sheet_waiting_on_r1172_materializer",
        exactSafeAnswerCount: 0,
        fillGuideReadyForRowOwnerFill: true,
        materializerReady: false,
        nextAction: "refresh_r1172_safe_assertion_materializer",
      });
      expect(output.inputArtifacts.r1172Materializer).toMatchObject({
        schemaVersion: null,
        status: "missing",
      });
      expect(output.rowOwnerAnswerSheet.exactSafeAnswers).toEqual([]);
      expect(output.rowOwnerAnswerSheet.readyForR1172MaterializerConfirmation).toBe(false);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1173-cli-"));
    try {
      const paths = await writeInputs(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1173-ordinary-consumer-safe-assertion-answer-sheet.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1167_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_FILL_GUIDE_PATH: paths.r1167Path,
          MURPH_AGE_R1172_ORDINARY_CONSUMER_SAFE_ASSERTION_MATERIALIZER_PATH: paths.r1172Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });
      const summary = JSON.parse(stdout) as {
        allowedValueKindIds: string[];
        answerSheetReadyForRowOwner: boolean;
        blockedAssertionContentIds: string[];
        conclusion: string;
        exactSafeAnswerCount: number;
        fillGuideReadyForRowOwnerFill: boolean;
        materializerExplicitConfirmationRequired: boolean;
        materializerReady: boolean;
        nextAction: string;
        packetId: string;
        schemaVersion: string;
      };
      expect(summary).toEqual({
        allowedValueKindIds: ALLOWED_VALUE_KIND_IDS,
        answerSheetReadyForRowOwner: true,
        answerSheetTemplateArtifact: "r1173-fillable-ordinary-consumer-safe-assertion-answer-sheet.json",
        blockedAssertionContentIds: BLOCKED_ASSERTION_CONTENT,
        conclusion: "ordinary_safe_assertion_answer_sheet_ready_non_evidence",
        exactSafeAnswerCount: SAFE_FIELD_EDIT_PATHS.length,
        fillGuideReadyForRowOwnerFill: true,
        materializerExplicitConfirmationRequired: true,
        materializerReady: true,
        nextAction: "rerun_r1172_with_row_owner_feature_only_safe_assertion_confirmation",
        packetId: "r1173-ordinary-consumer-safe-assertion-answer-sheet",
        schemaVersion: R1173_ORDINARY_CONSUMER_SAFE_ASSERTION_ANSWER_SHEET_SCHEMA_VERSION,
      });
      expect(stdout).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a sanitized CLI error when a local path appears in the failure", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1173-cli-error-"));
    try {
      const paths = await writeInputs(tmp);
      const blockedOutputDir = path.join(tmp, "blocked-output");
      await writeFile(blockedOutputDir, "not a directory\n");

      const stderr = captureCliFailureStderr("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1173-ordinary-consumer-safe-assertion-answer-sheet.ts"),
      ], {
        ...process.env,
        MURPH_AGE_R1167_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_FILL_GUIDE_PATH: paths.r1167Path,
        MURPH_AGE_R1172_ORDINARY_CONSUMER_SAFE_ASSERTION_MATERIALIZER_PATH: paths.r1172Path,
        MURPH_AGE_RESEARCH_OUTPUT_DIR: blockedOutputDir,
      });

      expect(stderr).toBe("R1173 safe assertion answer sheet failed.\n");
      expect(stderr).not.toContain(tmp);
      expect(stderr).not.toContain(process.cwd());
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

function captureCliFailureStderr(
  command: string,
  args: string[],
  env: Record<string, string | undefined>,
): string {
  try {
    execFileSync(command, args, {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error: unknown) {
    const stderr = stderrFromThrownError(error);
    if (stderr !== null) return stderr;
    throw error;
  }
  throw new Error("Expected CLI command to fail.");
}

function stderrFromThrownError(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("stderr" in error)) return null;
  const stderr = (error as { stderr?: unknown }).stderr;
  if (typeof stderr === "string") return stderr;
  if (Buffer.isBuffer(stderr)) return stderr.toString("utf8");
  return null;
}

async function writeInputs(tmp: string): Promise<{
  r1167Path: string;
  r1172Path: string;
}> {
  const paths = {
    r1167Path: path.join(tmp, "r1167.json"),
    r1172Path: path.join(tmp, "r1172.json"),
  };
  await mkdir(tmp, { recursive: true });
  await Promise.all([
    writeFile(paths.r1167Path, `${JSON.stringify(r1167Fixture(), null, 2)}\n`),
    writeFile(paths.r1172Path, `${JSON.stringify(r1172Fixture(), null, 2)}\n`),
  ]);
  return paths;
}

function r1167Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      rowLevelDataAcceptedByR1167: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1167: false,
    },
    packetId: "r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide",
    productDisplayAuthorized: false,
    schemaVersion: R1167_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_FILL_GUIDE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      allowedValueKinds: ALLOWED_VALUE_KIND_IDS,
      conclusion: "ordinary_feature_only_safe_assertion_fill_guide_ready",
      guideReadyForRowOwnerFill: true,
      minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: "fill_r1165_row_owner_feature_only_safe_assertion_template",
      productDisplayAuthorized: false,
      requiredInputKindIds: REQUIRED_INPUT_KIND_IDS,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1167: false,
      rowOwnerAssertionInferredByR1167: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1167: false,
      safeFieldEditCount: SAFE_FIELD_EDIT_PATHS.length,
      safeFieldEditPaths: SAFE_FIELD_EDIT_PATHS,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };
}

function r1172Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      assertionFileWrittenOnlyAfterExplicitAssertion: true,
      assertionValuesStoredInR1172Packet: false,
      rowLevelDataAcceptedByR1172: false,
      rowOwnerAssertionInferredByR1172: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1172: false,
    },
    materializer: {
      allowedValueKindIds: ALLOWED_VALUE_KIND_IDS,
      materializerCommand: R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND,
      rowLevelDataAcceptedByR1172: false,
      rowOwnerPrivateValuesStored: false,
    },
    packetId: "r1172-ordinary-consumer-safe-assertion-materializer",
    productDisplayAuthorized: false,
    schemaVersion: R1172_ORDINARY_CONSUMER_SAFE_ASSERTION_MATERIALIZER_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      allowedValueKindIds: ALLOWED_VALUE_KIND_IDS,
      blockedContentIds: BLOCKED_ASSERTION_CONTENT,
      conclusion: "ordinary_consumer_safe_assertion_materializer_waiting_on_explicit_row_owner_assertion",
      minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: "rerun_r1172_with_row_owner_feature_only_safe_assertion_confirmation",
      productDisplayAuthorized: false,
      requiredInputKindIds: REQUIRED_INPUT_KIND_IDS,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1172: false,
      rowOwnerAssertionInferredByR1172: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1172: false,
      safeFieldEditPaths: SAFE_FIELD_EDIT_PATHS,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };
}
