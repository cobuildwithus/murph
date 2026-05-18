import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { R1145_ORDINARY_CONSUMER_CURRENT_CHAIN_COMPLETION_AUDIT_SCHEMA_VERSION } from "./r1145-ordinary-consumer-current-chain-completion-audit.ts";
import { R1165_SAFE_ASSERTION_RUNNER_COMMAND } from "./r1165-ordinary-consumer-feature-only-safe-assertion-runner.ts";
import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1172_ORDINARY_CONSUMER_SAFE_ASSERTION_MATERIALIZER_SCHEMA_VERSION,
  R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND,
} from "./r1172-ordinary-consumer-safe-assertion-materializer.ts";
import {
  R1173_ORDINARY_CONSUMER_SAFE_ASSERTION_ANSWER_SHEET_SCHEMA_VERSION,
  R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND,
} from "./r1173-ordinary-consumer-safe-assertion-answer-sheet.ts";
import {
  R1174_ORDINARY_CONSUMER_SAFE_NEXT_STEP_PACKET_SCHEMA_VERSION,
  runR1174OrdinaryConsumerSafeNextStepPacket,
} from "./r1174-ordinary-consumer-safe-next-step-packet.ts";
import {
  R1176_R1172_R1165_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_SCHEMA_VERSION,
  R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
} from "./r1176-r1172-r1165-row-owner-safe-assertion-chain-runner.ts";

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
const EXPECTED_MISSING_REQUIREMENT_IDS = [
  "row_owner_availability_assertions_confirmed",
  "confirmed_recipe_route_requirements_available",
  "private_route_config_supplied",
  "real_lab_wearable_route_metrics_recorded",
];
const BLOCKED_CONTENT = [
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
const ALLOWED_VALUE_KIND_IDS = [
  "booleans_only",
  "fixed_enumerated_ids_only",
];

describe("R1174 ordinary consumer safe next-step packet", () => {
  it("emits the current row-owner-only R1176 live-chain action packet", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1174-ready-"));
    try {
      const paths = await writeInputs(tmp);

      const { output, outputPath } = await runR1174OrdinaryConsumerSafeNextStepPacket({
        createdAt: "2026-05-18T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(path.basename(outputPath)).toBe("r1174-ordinary-consumer-safe-next-step-packet.latest.json");
      expect(output.schemaVersion).toBe(R1174_ORDINARY_CONSUMER_SAFE_NEXT_STEP_PACKET_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        answerSheetReadyForRowOwner: true,
        allowedValueKindIds: ALLOWED_VALUE_KIND_IDS,
        blockedContentIds: BLOCKED_CONTENT,
        conclusion: "ordinary_safe_next_step_packet_ready_for_row_owner_r1176_live_chain_confirmation",
        exactSafeFieldEditCount: SAFE_FIELD_EDIT_PATHS.length,
        explicitRowOwnerAssertionProvided: false,
        materializedSafeAssertionArtifact: null,
        materializedSafeAssertionArtifactStoredAsPath: false,
        materializerReady: true,
        minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
        modelEvidencePromotionAllowed: false,
        nextAction: "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation",
        optionalAddOnFamilyIds: OPTIONAL_ADD_ON_FAMILY_IDS,
        productDisplayAuthorized: false,
        r1176LiveChainCommand: R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
        readyForR1165Runner: false,
        readyForRowOwnerR1172Confirmation: true,
        readyForRowOwnerR1176LiveChainConfirmation: true,
        requiredAssertionChecklistIds: REQUIRED_ASSERTION_CHECKLIST_IDS,
        requiredInputKindIds: REQUIRED_INPUT_KIND_IDS,
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1174: false,
        rowOwnerConfirmationInferredByR1174: false,
        rowOwnerPrivateValuesStored: false,
        rowOwnerProvidedValuesStored: false,
        rowParsingPerformedByR1174: false,
        safeFieldEditPaths: SAFE_FIELD_EDIT_PATHS,
        targetAgeBand: "roughly_16_50",
        targetInputPriority: TARGET_INPUT_PRIORITY,
      });
      expect(output.rowOwnerNextStepPacket).toMatchObject({
        allowedValueKindIds: ALLOWED_VALUE_KIND_IDS,
        audience: "ordinary_submitter_roughly_16_50_row_owner",
        blockedContent: BLOCKED_CONTENT,
        currentMissingRequirementIds: EXPECTED_MISSING_REQUIREMENT_IDS,
        exactSafeFieldEditPaths: SAFE_FIELD_EDIT_PATHS,
        materializedSafeAssertionArtifact: null,
        minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
        modelEvidencePromotionAllowed: false,
        optionalAddOnFamilyIds: OPTIONAL_ADD_ON_FAMILY_IDS,
        packetRole: "current_blocker_packet_only_not_assertion_not_model_evidence",
        readyForR1165Runner: false,
        readyForRowOwnerR1172Confirmation: true,
        readyForRowOwnerR1176LiveChainConfirmation: true,
        requiredAssertionChecklistIds: REQUIRED_ASSERTION_CHECKLIST_IDS,
        requiredAttestationKeys: REQUIRED_ATTESTATION_KEYS,
        r1176LiveChainCommand: R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
        rowLevelDataAcceptedByR1174: false,
        rowOwnerProvidedValuesStored: false,
        targetAgeBand: "roughly_16_50",
        targetInputPriority: TARGET_INPUT_PRIORITY,
      });
      expect(output.rowOwnerNextStepPacket.prioritizedInputKinds).toMatchObject([
        {
          inputKindId: "lab_portal_export_or_spreadsheet",
          mapsToSourceFamilyIds: ["bloodwork_glycemia"],
          role: "minimum_required_feature_pair",
        },
        {
          inputKindId: "phone_watch_or_wearable_activity_export",
          mapsToSourceFamilyIds: ["wearable_activity_daily"],
          role: "minimum_required_feature_pair",
        },
        {
          inputKindId: "optional_common_bloodwork_or_vitals_context",
          mapsToSourceFamilyIds: OPTIONAL_ADD_ON_FAMILY_IDS,
          role: "optional_context_only",
        },
      ]);
      expect(output.rowOwnerNextStepPacket.rowOwnerOnlyActions).toMatchObject([
        {
          actionId: "review_r1173_safe_assertion_answer_sheet",
          command: R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND,
          rowOwnerOnly: true,
          storesPrivateDetailsInPacket: false,
        },
        {
          actionId: "explicitly_run_r1172_materializer_if_all_safe_assertions_are_true",
          command: R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND,
          rowOwnerOnly: true,
          storesPrivateDetailsInPacket: false,
        },
        {
          actionId: "explicitly_run_r1176_live_chain_if_all_safe_assertions_are_true",
          command: R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
          rowOwnerOnly: true,
          storesPrivateDetailsInPacket: false,
        },
        {
          actionId: "run_r1165_with_materialized_safe_assertion",
          command: R1165_SAFE_ASSERTION_RUNNER_COMMAND,
          rowOwnerOnly: true,
          storesPrivateDetailsInPacket: false,
        },
      ]);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = JSON.parse(await readFile(outputPath, "utf8")) as unknown;
      expect(findForbiddenAggregateEgress(persisted)).toEqual([]);
      expect(JSON.stringify(persisted)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits for R1173 when the answer sheet is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1174-missing-r1173-"));
    try {
      const paths = await writeInputs(tmp);
      await rm(paths.r1173Path, { force: true });

      const { output } = await runR1174OrdinaryConsumerSafeNextStepPacket({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        answerSheetReadyForRowOwner: false,
        conclusion: "ordinary_safe_next_step_packet_waiting_on_r1173_answer_sheet",
        materializerReady: true,
        nextAction: "refresh_r1173_safe_assertion_answer_sheet",
        readyForR1165Runner: false,
        readyForRowOwnerR1172Confirmation: false,
      });
      expect(output.inputArtifacts.r1173AnswerSheet).toMatchObject({
        schemaVersion: null,
        status: "missing",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes to R1165 after R1172 has materialized the safe assertion", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1174-materialized-"));
    try {
      const paths = await writeInputs(tmp, { materialized: true, r1176Missing: true });

      const { output } = await runR1174OrdinaryConsumerSafeNextStepPacket({
        outputDir: path.join(tmp, "out"),
        ...paths,
      });

      expect(output.summary).toMatchObject({
        conclusion: "ordinary_safe_next_step_packet_safe_assertion_materialized_non_evidence",
        explicitRowOwnerAssertionProvided: true,
        materializedSafeAssertionArtifact: "r1172-row-owner-feature-only-safe-assertion.json",
        materializedSafeAssertionArtifactStoredAsPath: false,
        nextAction: "run_r1165_with_r1172_row_owner_safe_assertion",
        readyForR1165Runner: true,
        readyForRowOwnerR1172Confirmation: false,
      });
      expect(output.rowOwnerNextStepPacket.readyForR1165Runner).toBe(true);
      expect(output.rowOwnerNextStepPacket.materializedSafeAssertionArtifact).toBe(
        "r1172-row-owner-feature-only-safe-assertion.json",
      );
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1174-cli-"));
    try {
      const paths = await writeInputs(tmp);
      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1174-ordinary-consumer-safe-next-step-packet.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1145_ORDINARY_CONSUMER_CURRENT_CHAIN_COMPLETION_AUDIT_PATH: paths.r1145Path,
          MURPH_AGE_R1172_ORDINARY_CONSUMER_SAFE_ASSERTION_MATERIALIZER_PATH: paths.r1172Path,
          MURPH_AGE_R1173_ORDINARY_CONSUMER_SAFE_ASSERTION_ANSWER_SHEET_PATH: paths.r1173Path,
          MURPH_AGE_R1176_R1172_R1165_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_PATH: paths.r1176Path,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });
      const summary = JSON.parse(stdout) as {
        allowedValueKindIds: string[];
        blockedContentIds: string[];
        conclusion: string;
        exactSafeFieldEditCount: number;
        nextAction: string;
        packetId: string;
        r1176LiveChainCommand: string | null;
        readyForR1165Runner: boolean;
        readyForRowOwnerR1172Confirmation: boolean;
        readyForRowOwnerR1176LiveChainConfirmation: boolean;
        schemaVersion: string;
      };
      expect(summary).toEqual({
        allowedValueKindIds: ALLOWED_VALUE_KIND_IDS,
        blockedContentIds: BLOCKED_CONTENT,
        conclusion: "ordinary_safe_next_step_packet_ready_for_row_owner_r1176_live_chain_confirmation",
        exactSafeFieldEditCount: SAFE_FIELD_EDIT_PATHS.length,
        nextAction: "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation",
        packetId: "r1174-ordinary-consumer-safe-next-step-packet",
        r1176LiveChainCommand: R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
        readyForR1165Runner: false,
        readyForRowOwnerR1172Confirmation: true,
        readyForRowOwnerR1176LiveChainConfirmation: true,
        schemaVersion: R1174_ORDINARY_CONSUMER_SAFE_NEXT_STEP_PACKET_SCHEMA_VERSION,
      });
      expect(stdout).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a sanitized CLI error when a local path appears in the failure", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1174-cli-error-"));
    try {
      const paths = await writeInputs(tmp);
      const blockedOutputDir = path.join(tmp, "blocked-output");
      await writeFile(blockedOutputDir, "not a directory\n");

      const stderr = captureCliFailureStderr("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1174-ordinary-consumer-safe-next-step-packet.ts"),
      ], {
        ...process.env,
        MURPH_AGE_R1145_ORDINARY_CONSUMER_CURRENT_CHAIN_COMPLETION_AUDIT_PATH: paths.r1145Path,
        MURPH_AGE_R1172_ORDINARY_CONSUMER_SAFE_ASSERTION_MATERIALIZER_PATH: paths.r1172Path,
        MURPH_AGE_R1173_ORDINARY_CONSUMER_SAFE_ASSERTION_ANSWER_SHEET_PATH: paths.r1173Path,
        MURPH_AGE_R1176_R1172_R1165_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_PATH: paths.r1176Path,
        MURPH_AGE_RESEARCH_OUTPUT_DIR: blockedOutputDir,
      });

      expect(stderr).toBe("R1174 safe next-step packet failed.\n");
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

async function writeInputs(
  tmp: string,
  options: { materialized?: boolean; r1176Missing?: boolean } = {},
): Promise<{
  r1145Path: string;
  r1172Path: string;
  r1173Path: string;
  r1176Path: string;
}> {
  const paths = {
    r1145Path: path.join(tmp, "r1145.json"),
    r1172Path: path.join(tmp, "r1172.json"),
    r1173Path: path.join(tmp, "r1173.json"),
    r1176Path: path.join(tmp, "r1176.json"),
  };
  await mkdir(tmp, { recursive: true });
  await Promise.all([
    writeFile(paths.r1145Path, `${JSON.stringify(r1145Fixture(), null, 2)}\n`),
    writeFile(paths.r1172Path, `${JSON.stringify(r1172Fixture(options), null, 2)}\n`),
    writeFile(paths.r1173Path, `${JSON.stringify(r1173Fixture(), null, 2)}\n`),
    options.r1176Missing === true
      ? Promise.resolve()
      : writeFile(paths.r1176Path, `${JSON.stringify(r1176Fixture(), null, 2)}\n`),
  ]);
  return paths;
}

function r1145Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      productDisplayAuthorized: false,
    },
    completionAudit: {
      goalAchieved: false,
      missingRequirementIds: EXPECTED_MISSING_REQUIREMENT_IDS,
      nextConcreteAction: "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation",
      readyToMarkComplete: false,
      restatedObjective: "prioritize_ordinary_16_50_wearable_data_and_bloodwork_labs_for_murph_age_model",
    },
    packetId: "r1145-ordinary-consumer-current-chain-completion-audit",
    productDisplayAuthorized: false,
    schemaVersion: R1145_ORDINARY_CONSUMER_CURRENT_CHAIN_COMPLETION_AUDIT_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
  };
}

function r1173Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      answerSheetTemplatePathStored: false,
      assertionValuesStoredByR1173: false,
      modelEvidencePromotedByR1173: false,
      rowLevelDataAcceptedByR1173: false,
      rowOwnerAssertionInferredByR1173: false,
      rowOwnerPrivateValuesStored: false,
      rowOwnerProvidedValuesStored: false,
      rowParsingPerformedByR1173: false,
    },
    packetId: "r1173-ordinary-consumer-safe-assertion-answer-sheet",
    productDisplayAuthorized: false,
    rowOwnerAnswerSheet: {
      allowedValueKindIds: ALLOWED_VALUE_KIND_IDS,
      blockedAssertionContent: BLOCKED_CONTENT,
      commands: {
        safeAssertionAnswerSheetCommand: R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND,
        safeAssertionMaterializerCommand: R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND,
      },
      materializerExplicitConfirmationRequired: true,
      readyForR1172MaterializerConfirmation: true,
    },
    schemaVersion: R1173_ORDINARY_CONSUMER_SAFE_ASSERTION_ANSWER_SHEET_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      allowedValueKindIds: ALLOWED_VALUE_KIND_IDS,
      answerSheetReadyForRowOwner: true,
      blockedAssertionContentIds: BLOCKED_CONTENT,
      exactSafeAnswerCount: SAFE_FIELD_EDIT_PATHS.length,
      materializerReady: true,
      minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: "rerun_r1172_with_row_owner_feature_only_safe_assertion_confirmation",
      productDisplayAuthorized: false,
      requiredInputKindIds: REQUIRED_INPUT_KIND_IDS,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1173: false,
      rowOwnerAssertionInferredByR1173: false,
      rowOwnerPrivateValuesStored: false,
      rowOwnerProvidedValuesStored: false,
      rowParsingPerformedByR1173: false,
      safeFieldEditPaths: SAFE_FIELD_EDIT_PATHS,
    },
  };
}

function r1172Fixture(options: { materialized?: boolean } = {}): Record<string, unknown> {
  const materialized = options.materialized === true;
  return {
    artifactBoundary: {
      aggregateOnly: true,
      assertionFileWrittenOnlyAfterExplicitAssertion: true,
      assertionValuesStoredInR1172Packet: false,
      modelEvidencePromotedByR1172: false,
      rowLevelDataAcceptedByR1172: false,
      rowOwnerAssertionInferredByR1172: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1172: false,
    },
    materializer: {
      allowedValueKindIds: ALLOWED_VALUE_KIND_IDS,
      blockedContentIds: BLOCKED_CONTENT,
      explicitRowOwnerAssertionProvided: materialized,
      materializedAssertionArtifact: materialized ? "r1172-row-owner-feature-only-safe-assertion.json" : null,
      materializedAssertionWouldBeAcceptedByR1165: materialized,
      materializerCommand: R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND,
      r1165RunnerCommand: R1165_SAFE_ASSERTION_RUNNER_COMMAND,
      r1165RunnerReadyForAssertion: true,
      r1165TemplateReady: true,
      r1167FillGuideReady: true,
      rowLevelDataAcceptedByR1172: false,
      rowOwnerPrivateValuesStored: false,
      safeAssertionArtifactWritten: materialized,
    },
    packetId: "r1172-ordinary-consumer-safe-assertion-materializer",
    productDisplayAuthorized: false,
    schemaVersion: R1172_ORDINARY_CONSUMER_SAFE_ASSERTION_MATERIALIZER_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      allowedValueKindIds: ALLOWED_VALUE_KIND_IDS,
      blockedContentIds: BLOCKED_CONTENT,
      explicitRowOwnerAssertionProvided: materialized,
      materializedAssertionArtifact: materialized ? "r1172-row-owner-feature-only-safe-assertion.json" : null,
      minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: materialized
        ? "run_r1165_with_r1172_row_owner_safe_assertion"
        : "rerun_r1172_with_row_owner_feature_only_safe_assertion_confirmation",
      productDisplayAuthorized: false,
      requiredInputKindIds: REQUIRED_INPUT_KIND_IDS,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1172: false,
      rowOwnerAssertionInferredByR1172: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1172: false,
      safeAssertionArtifactWritten: materialized,
      safeFieldEditPaths: SAFE_FIELD_EDIT_PATHS,
    },
  };
}

function r1176Fixture(): Record<string, unknown> {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      assertionValuesStoredByR1176: false,
      modelEvidencePromotedByR1176: false,
      rowLevelDataAcceptedByR1176: false,
      rowOwnerAssertionInferredByR1176: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1176: false,
    },
    chainRun: {
      chainRunnerCommand: R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
      modelEvidencePromotionAllowed: false,
      productDisplayAuthorized: false,
      realEvidenceProduced: false,
      rowLevelDataAcceptedByR1176: false,
      rowOwnerPrivateValuesStored: false,
    },
    packetId: "r1176-r1172-r1165-row-owner-safe-assertion-chain-runner",
    productDisplayAuthorized: false,
    schemaVersion: R1176_R1172_R1165_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      chainReady: false,
      conclusion: "row_owner_safe_assertion_chain_waiting_on_explicit_confirmation",
      explicitRowOwnerAssertionProvided: false,
      featureOnlyResearchPlanningReady: false,
      minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      modelEvidencePromotionAllowed: false,
      nextAction: "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation",
      outcomeLinkedModelEvidenceStillRequired: true,
      productDisplayAuthorized: false,
      realEvidenceProduced: false,
      requiredInputKindIds: REQUIRED_INPUT_KIND_IDS,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1176: false,
      rowOwnerAssertionStillRequiredForLiveChain: true,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1176: false,
      safeFieldEditPaths: SAFE_FIELD_EDIT_PATHS,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };
}
