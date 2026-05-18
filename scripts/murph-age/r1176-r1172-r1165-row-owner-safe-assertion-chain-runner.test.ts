import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { runR1165OrdinaryConsumerFeatureOnlySafeAssertionRunner } from "./r1165-ordinary-consumer-feature-only-safe-assertion-runner.ts";
import { runR1167OrdinaryConsumerFeatureOnlySafeAssertionFillGuide } from "./r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide.ts";
import {
  R1176_R1172_R1165_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_SCHEMA_VERSION,
  runR1176R1172R1165RowOwnerSafeAssertionChainRunner,
} from "./r1176-r1172-r1165-row-owner-safe-assertion-chain-runner.ts";

const CREATED_AT = "2026-05-18T14:20:00.000Z";
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
const R1160_SAFE_TRANSCRIPTION_STEP_COUNT = 15;
const REQUIRED_INPUT_KIND_IDS = [
  "lab_portal_export_or_spreadsheet",
  "phone_watch_or_wearable_activity_export",
];
const OPTIONAL_ADD_ON_FAMILY_IDS = [
  "common_bloodwork_core",
  "vitals_body_context",
];
const SAFE_ASSERTION_ALLOWED_VALUE_KIND_IDS = [
  "booleans_only",
  "fixed_enumerated_ids_only",
];
const SAFE_ASSERTION_BLOCKED_CONTENT_IDS = [
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
const ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECKLIST_ITEM_IDS = [
  "confirm_target_age_band_without_identifiers",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
];
const ORDINARY_SUBMITTER_COMPLETION_MODE_ID = "feature_only_lab_wearable_coverage";
const ROW_OWNER_HANDOFF_REASON_ID =
  "confirm_feature_only_lab_wearable_availability_before_r1176_live_chain";

describe("R1176 row-owner gated R1172 to R1165 safe assertion chain", () => {
  it("waits safely by default without running child materializers", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1176-wait-"));
    try {
      const paths = await writeReadyInputs(tmp);
      const outputDir = path.join(tmp, "out");
      const { output, outputPath } = await runR1176R1172R1165RowOwnerSafeAssertionChainRunner({
        createdAt: CREATED_AT,
        featureOnlyTemplatePath: paths.featureOnlyTemplatePath,
        outputDir,
        r1149Path: paths.r1149Path,
        r1160Path: paths.r1160Path,
        r1165Path: paths.r1165Path,
        r1165TemplatePath: paths.r1165TemplatePath,
        r1167Path: paths.r1167Path,
      });

      expect(path.basename(outputPath)).toBe(
        "r1176-r1172-r1165-row-owner-safe-assertion-chain-runner.latest.json",
      );
      expect(output.schemaVersion).toBe(
        R1176_R1172_R1165_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_SCHEMA_VERSION,
      );
      expect(output.summary).toMatchObject({
        allowedValueKindIds: SAFE_ASSERTION_ALLOWED_VALUE_KIND_IDS,
        blockedContentIds: SAFE_ASSERTION_BLOCKED_CONTENT_IDS,
        chainReady: false,
        conclusion: "row_owner_safe_assertion_chain_waiting_on_explicit_confirmation",
        explicitRowOwnerAssertionProvided: false,
        featureOnlyResearchPlanningReady: false,
        materializedAssertionArtifact: null,
        materializedAssertionPathStored: false,
        modelEvidencePromotionAllowed: false,
        nextAction: "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation",
        optionalAddOnFamilyIds: OPTIONAL_ADD_ON_FAMILY_IDS,
        ordinarySubmitterCompletionModeId: ORDINARY_SUBMITTER_COMPLETION_MODE_ID,
        ordinarySubmitterSafeCompletionChecklistItemIds: [
          ...ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECKLIST_ITEM_IDS,
        ],
        outcomeLinkedModelEvidenceStillRequired: true,
        productDisplayAuthorized: false,
        realEvidenceProduced: false,
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1176: false,
        rowOwnerAssertionStillRequiredForLiveChain: true,
        rowOwnerPrivateValuesStored: false,
        rowParsingPerformedByR1176: false,
        r1163FeatureOnlyResearchPlanningReady: null,
        r1165AssertionAccepted: null,
        r1165ChildR1163Ran: null,
        r1165FeatureOnlyResearchPlanningReady: null,
        r1172MaterializedAssertionWritten: null,
        r1172WouldBeAcceptedByR1165: null,
        rowOwnerHandoffReasonId: ROW_OWNER_HANDOFF_REASON_ID,
        safeFieldEditCount: SAFE_FIELD_EDIT_PATHS.length,
        safeFieldEditPaths: [...SAFE_FIELD_EDIT_PATHS],
        targetAgeBand: "roughly_16_50",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      });
      expect(output.summary.requiredInputKindIds).toEqual(REQUIRED_INPUT_KIND_IDS);
      expect(output.chainRun).toMatchObject({
        allowedValueKindIds: SAFE_ASSERTION_ALLOWED_VALUE_KIND_IDS,
        blockedContentIds: SAFE_ASSERTION_BLOCKED_CONTENT_IDS,
        optionalAddOnFamilyIds: OPTIONAL_ADD_ON_FAMILY_IDS,
        ordinarySubmitterSafeCompletionChecklistItemIds:
          ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECKLIST_ITEM_IDS,
        requiredInputKindIds: REQUIRED_INPUT_KIND_IDS,
      });
      expect(output.childArtifacts.r1172).toMatchObject({
        artifact: null,
        packetId: null,
        status: "not_run",
      });
      expect(output.childArtifacts.r1165).toMatchObject({
        artifact: null,
        packetId: null,
        status: "not_run",
      });
      expect(await pathExists(path.join(outputDir, "r1172-ordinary-consumer-safe-assertion-materializer.latest.json"))).toBe(false);
      expect(await pathExists(path.join(outputDir, "r1165-ordinary-consumer-feature-only-safe-assertion-runner.latest.json"))).toBe(false);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("runs R1172 then R1165 after explicit row-owner confirmation without promoting model evidence", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1176-ready-"));
    try {
      const paths = await writeReadyInputs(tmp);
      const outputDir = path.join(tmp, "out");
      const { output, outputPath } = await runR1176R1172R1165RowOwnerSafeAssertionChainRunner({
        createdAt: CREATED_AT,
        featureOnlyTemplatePath: paths.featureOnlyTemplatePath,
        outputDir,
        r1149Path: paths.r1149Path,
        r1160Path: paths.r1160Path,
        r1165Path: paths.r1165Path,
        r1165TemplatePath: paths.r1165TemplatePath,
        r1167Path: paths.r1167Path,
        rowOwnerAssertionsConfirmed: true,
      });

      expect(output.summary).toMatchObject({
        allowedValueKindIds: SAFE_ASSERTION_ALLOWED_VALUE_KIND_IDS,
        blockedContentIds: SAFE_ASSERTION_BLOCKED_CONTENT_IDS,
        chainReady: true,
        conclusion: "row_owner_safe_assertion_chain_ready_research_only",
        explicitRowOwnerAssertionProvided: true,
        featureOnlyResearchPlanningReady: true,
        materializedAssertionArtifact: "r1172-row-owner-feature-only-safe-assertion.json",
        materializedAssertionPathStored: false,
        modelEvidencePromotionAllowed: false,
        nextAction: "run_r1164_feature_only_research_handoff",
        optionalAddOnFamilyIds: OPTIONAL_ADD_ON_FAMILY_IDS,
        ordinarySubmitterCompletionModeId: ORDINARY_SUBMITTER_COMPLETION_MODE_ID,
        ordinarySubmitterSafeCompletionChecklistItemIds: [
          ...ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECKLIST_ITEM_IDS,
        ],
        outcomeLinkedModelEvidenceStillRequired: true,
        productDisplayAuthorized: false,
        realEvidenceProduced: false,
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1176: false,
        rowOwnerAssertionStillRequiredForLiveChain: false,
        rowOwnerPrivateValuesStored: false,
        rowParsingPerformedByR1176: false,
        r1163FeatureOnlyResearchPlanningReady: true,
        r1165AssertionAccepted: true,
        r1165ChildR1163Ran: true,
        r1165FeatureOnlyResearchPlanningReady: true,
        r1172MaterializedAssertionWritten: true,
        r1172WouldBeAcceptedByR1165: true,
        rowOwnerHandoffReasonId: ROW_OWNER_HANDOFF_REASON_ID,
        safeFieldEditCount: SAFE_FIELD_EDIT_PATHS.length,
        safeFieldEditPaths: [...SAFE_FIELD_EDIT_PATHS],
      });
      expect(output.chainRun).toMatchObject({
        allowedValueKindIds: SAFE_ASSERTION_ALLOWED_VALUE_KIND_IDS,
        blockedContentIds: SAFE_ASSERTION_BLOCKED_CONTENT_IDS,
        explicitRowOwnerAssertionProvided: true,
        optionalAddOnFamilyIds: OPTIONAL_ADD_ON_FAMILY_IDS,
        r1163Conclusion: "feature_only_safe_confirmation_to_research_runner_ready_research_only",
        r1163FeatureOnlyResearchPlanningReady: true,
        r1165AssertionAccepted: true,
        r1165ChildR1163Ran: true,
        r1165Conclusion: "ordinary_feature_only_safe_assertion_runner_ready_research_only",
        r1165FeatureOnlyResearchPlanningReady: true,
        r1165NextAction: "run_r1164_feature_only_research_handoff",
        r1172Conclusion: "ordinary_consumer_safe_assertion_materialized",
        r1172NextAction: "run_r1165_with_r1172_row_owner_safe_assertion",
        r1172SafeAssertionArtifactWritten: true,
        r1172WouldBeAcceptedByR1165: true,
        rowOwnerHandoffReasonId: ROW_OWNER_HANDOFF_REASON_ID,
      });
      expect(output.childArtifacts.r1172).toMatchObject({
        artifact: "r1172-ordinary-consumer-safe-assertion-materializer.latest.json",
        packetId: "r1172-ordinary-consumer-safe-assertion-materializer",
        status: "available",
      });
      expect(output.childArtifacts.r1165).toMatchObject({
        artifact: "r1165-ordinary-consumer-feature-only-safe-assertion-runner.latest.json",
        packetId: "r1165-ordinary-consumer-feature-only-safe-assertion-runner",
        status: "available",
      });
      expect(output.artifactBoundary).toMatchObject({
        assertionFilePathStored: false,
        assertionValuesStoredByR1176: false,
        childOutputPathsStored: false,
        localPathsStored: false,
        materializedAssertionPathStored: false,
      });
      expect(await pathExists(path.join(outputDir, "r1172-row-owner-feature-only-safe-assertion.json"))).toBe(true);
      expect(await pathExists(path.join(outputDir, "r1172-ordinary-consumer-safe-assertion-materializer.latest.json"))).toBe(true);
      expect(await pathExists(path.join(outputDir, "r1165-ordinary-consumer-feature-only-safe-assertion-runner.latest.json"))).toBe(true);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = JSON.parse(await readFile(outputPath, "utf8")) as unknown;
      expect(findForbiddenAggregateEgress(persisted)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("surfaces R1172 prerequisite blockers when explicit confirmation cannot materialize", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1176-missing-guide-"));
    try {
      const paths = await writeReadyInputs(tmp);
      await rm(paths.r1167Path, { force: true });
      const { output } = await runR1176R1172R1165RowOwnerSafeAssertionChainRunner({
        createdAt: CREATED_AT,
        featureOnlyTemplatePath: paths.featureOnlyTemplatePath,
        outputDir: path.join(tmp, "out"),
        r1149Path: paths.r1149Path,
        r1160Path: paths.r1160Path,
        r1165Path: paths.r1165Path,
        r1165TemplatePath: paths.r1165TemplatePath,
        r1167Path: paths.r1167Path,
        rowOwnerAssertionsConfirmed: true,
      });

      expect(output.summary).toMatchObject({
        allowedValueKindIds: SAFE_ASSERTION_ALLOWED_VALUE_KIND_IDS,
        blockedContentIds: SAFE_ASSERTION_BLOCKED_CONTENT_IDS,
        chainReady: false,
        conclusion: "row_owner_safe_assertion_chain_waiting_on_r1172_prerequisite",
        explicitRowOwnerAssertionProvided: true,
        materializedAssertionArtifact: null,
        nextAction: "refresh_r1167_safe_assertion_fill_guide",
        rowOwnerAssertionStillRequiredForLiveChain: false,
        r1165AssertionAccepted: null,
        r1165ChildR1163Ran: null,
        r1172MaterializedAssertionWritten: false,
        r1172WouldBeAcceptedByR1165: false,
      });
      expect(output.chainRun).toMatchObject({
        r1172Conclusion: "ordinary_consumer_safe_assertion_materializer_waiting_on_r1167_fill_guide",
        r1172NextAction: "refresh_r1167_safe_assertion_fill_guide",
      });
      expect(output.childArtifacts.r1165).toMatchObject({
        artifact: null,
        packetId: null,
        status: "not_run",
      });
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary for the confirmed live gate", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1176-cli-"));
    try {
      const paths = await writeReadyInputs(tmp);
      const stdout = await execFileStdout("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1176-r1172-r1165-row-owner-safe-assertion-chain-runner.ts"),
      ], {
        MURPH_AGE_R1149_ORDINARY_CONSUMER_LAB_WEARABLE_SUBMISSION_KIT_PATH: paths.r1149Path,
        MURPH_AGE_R1150_FEATURE_ONLY_SAFE_AVAILABILITY_CONFIRMATION_TEMPLATE_PATH:
          paths.featureOnlyTemplatePath,
        MURPH_AGE_R1160_R1159_FEATURE_ONLY_SAFE_CONFIRMATION_TRANSCRIPTION_PROOF_PATH: paths.r1160Path,
        MURPH_AGE_R1165_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_RUNNER_PATH: paths.r1165Path,
        MURPH_AGE_R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_TEMPLATE_PATH: paths.r1165TemplatePath,
        MURPH_AGE_R1167_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_FILL_GUIDE_PATH: paths.r1167Path,
        MURPH_AGE_R1176_CREATED_AT: CREATED_AT,
        MURPH_AGE_R1176_OUTPUT_DIR: path.join(tmp, "out"),
        MURPH_AGE_R1176_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTIONS_CONFIRMED: "true",
      });
      const parsed = JSON.parse(stdout) as {
        allowedValueKindIds: string[];
        blockedContentIds: string[];
        chainReady: boolean;
        conclusion: string;
        explicitRowOwnerAssertionProvided: boolean;
        nextAction: string;
        optionalAddOnFamilyIds: string[];
        ordinarySubmitterCompletionModeId: string;
        ordinarySubmitterSafeCompletionChecklistItemIds: string[];
        packetId: string;
        realEvidenceProduced: boolean;
        rowOwnerHandoffReasonId: string;
        r1165AssertionAccepted: boolean;
        r1172MaterializedAssertionWritten: boolean;
      };

      expect(parsed).toMatchObject({
        allowedValueKindIds: SAFE_ASSERTION_ALLOWED_VALUE_KIND_IDS,
        blockedContentIds: SAFE_ASSERTION_BLOCKED_CONTENT_IDS,
        chainReady: true,
        conclusion: "row_owner_safe_assertion_chain_ready_research_only",
        explicitRowOwnerAssertionProvided: true,
        nextAction: "run_r1164_feature_only_research_handoff",
        optionalAddOnFamilyIds: OPTIONAL_ADD_ON_FAMILY_IDS,
        ordinarySubmitterCompletionModeId: ORDINARY_SUBMITTER_COMPLETION_MODE_ID,
        ordinarySubmitterSafeCompletionChecklistItemIds: ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECKLIST_ITEM_IDS,
        packetId: "r1176-r1172-r1165-row-owner-safe-assertion-chain-runner",
        realEvidenceProduced: false,
        rowOwnerHandoffReasonId: ROW_OWNER_HANDOFF_REASON_ID,
        r1165AssertionAccepted: true,
        r1172MaterializedAssertionWritten: true,
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("outputPath");
      expect(await pathExists(
        path.join(tmp, "out", "r1176-r1172-r1165-row-owner-safe-assertion-chain-runner.latest.json"),
      )).toBe(true);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a sanitized CLI error when a local path appears in the failure", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1176-cli-error-"));
    try {
      const paths = await writeReadyInputs(tmp);
      const blockedOutputDir = path.join(tmp, "blocked-output");
      await writeFile(blockedOutputDir, "not a directory\n");

      const stderr = await execFileFailureStderr("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1176-r1172-r1165-row-owner-safe-assertion-chain-runner.ts"),
      ], {
        MURPH_AGE_R1149_ORDINARY_CONSUMER_LAB_WEARABLE_SUBMISSION_KIT_PATH: paths.r1149Path,
        MURPH_AGE_R1150_FEATURE_ONLY_SAFE_AVAILABILITY_CONFIRMATION_TEMPLATE_PATH:
          paths.featureOnlyTemplatePath,
        MURPH_AGE_R1160_R1159_FEATURE_ONLY_SAFE_CONFIRMATION_TRANSCRIPTION_PROOF_PATH: paths.r1160Path,
        MURPH_AGE_R1165_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_RUNNER_PATH: paths.r1165Path,
        MURPH_AGE_R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_TEMPLATE_PATH: paths.r1165TemplatePath,
        MURPH_AGE_R1167_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_FILL_GUIDE_PATH: paths.r1167Path,
        MURPH_AGE_R1176_CREATED_AT: CREATED_AT,
        MURPH_AGE_R1176_OUTPUT_DIR: blockedOutputDir,
        MURPH_AGE_R1176_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTIONS_CONFIRMED: "true",
      });

      expect(stderr).toBe("R1176 row-owner safe assertion chain failed.\n");
      expect(stderr).not.toContain(tmp);
      expect(stderr).not.toContain(process.cwd());
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeReadyInputs(tmp: string): Promise<{
  featureOnlyTemplatePath: string;
  r1149Path: string;
  r1160Path: string;
  r1165Path: string;
  r1165TemplatePath: string;
  r1167Path: string;
}> {
  const inputDir = path.join(tmp, "inputs");
  const outDir = path.join(tmp, "ready");
  await mkdir(inputDir, { recursive: true });
  const featureOnlyTemplatePath = path.join(inputDir, "feature-only-template.json");
  const r1149Path = path.join(inputDir, "r1149.json");
  const r1160Path = path.join(inputDir, "r1160.json");
  await writeJson(featureOnlyTemplatePath, featureOnlyTemplateFixture());
  await writeJson(r1149Path, r1149Fixture());
  await writeJson(r1160Path, r1160Fixture());
  const r1165 = await runR1165OrdinaryConsumerFeatureOnlySafeAssertionRunner({
    createdAt: CREATED_AT,
    featureOnlyTemplatePath,
    outputDir: outDir,
    r1149Path,
    r1160Path,
  });
  const r1165TemplatePath = path.join(outDir, "r1165-row-owner-feature-only-safe-assertion.template.json");
  const r1167 = await runR1167OrdinaryConsumerFeatureOnlySafeAssertionFillGuide({
    createdAt: CREATED_AT,
    outputDir: outDir,
    r1165Path: r1165.outputPath,
    r1165TemplatePath,
  });
  return {
    featureOnlyTemplatePath,
    r1149Path,
    r1160Path,
    r1165Path: r1165.outputPath,
    r1165TemplatePath,
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
      exactSafeTranscriptionStepCount: R1160_SAFE_TRANSCRIPTION_STEP_COUNT,
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
