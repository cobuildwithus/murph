import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1163_ASSERTION_TO_RESEARCH_RUNNER_COMMAND,
  R1163_FEATURE_ONLY_SAFE_CONFIRMATION_TO_RESEARCH_RUNNER_SCHEMA_VERSION,
  runR1163FeatureOnlySafeConfirmationToResearchRunner,
} from "./r1163-feature-only-safe-confirmation-to-research-runner.ts";

const CREATED_AT = "2026-05-17T00:00:00.000Z";
const WAITING_NEXT_ACTION =
  "row_owner_assert_feature_only_lab_wearable_availability_then_run_r1163_runner";
const READY_NEXT_ACTION = "use_feature_only_coverage_context_for_research_planning_only";
const REQUIRED_INPUT_KIND_IDS = [
  "lab_portal_export_or_spreadsheet",
  "phone_watch_or_wearable_activity_export",
];
const REQUIRED_CHECKLIST_IDS = [
  "confirm_target_age_band_without_identifiers",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
];
const ROW_OWNER_ASSERTION_ITEM_IDS = [
  "assert_target_age_band_roughly_16_50",
  "assert_glycemia_bloodwork_export_available",
  "assert_daily_wearable_activity_export_available",
  "assert_assertion_contains_no_private_values",
];

describe("R1163 feature-only safe confirmation to research runner", () => {
  it("waits for explicit row-owner assertion without running the feature-only chain", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1163-waiting-"));
    try {
      const paths = await writeFixtures(tmp);

      const { output, outputPath } = await runR1163FeatureOnlySafeConfirmationToResearchRunner({
        createdAt: CREATED_AT,
        featureOnlyTemplatePath: paths.featureOnlyTemplatePath,
        outputDir: path.join(tmp, "out"),
        r1149Path: paths.r1149Path,
        r1160Path: paths.r1160Path,
      });
      const persisted = JSON.parse(await readFile(outputPath, "utf8")) as unknown;

      expect(path.basename(outputPath)).toBe(
        "r1163-feature-only-safe-confirmation-to-research-runner.latest.json",
      );
      expect(output.schemaVersion).toBe(R1163_FEATURE_ONLY_SAFE_CONFIRMATION_TO_RESEARCH_RUNNER_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "feature_only_safe_confirmation_to_research_runner_waiting_on_row_owner_assertion",
        confirmedSafeConfirmationArtifact: null,
        explicitRowOwnerConfirmationAssertionProvided: false,
        featureOnlyChainConclusion: null,
        featureOnlyChainRan: false,
        featureOnlyResearchPlanningReady: false,
        materializerConclusion: "feature_only_safe_availability_confirmation_materializer_waiting_on_explicit_row_owner_confirmation",
        materializerNextAction: "rerun_r1161_with_row_owner_feature_only_confirmation_assertion",
        modelEvidencePromotionAllowed: false,
        nextAction: WAITING_NEXT_ACTION,
        productDisplayAuthorized: false,
        requiredChecklistIds: REQUIRED_CHECKLIST_IDS,
        requiredInputKindIds: REQUIRED_INPUT_KIND_IDS,
        reviewGptRequiredNow: false,
        rowOwnerAssertionCommand: R1163_ASSERTION_TO_RESEARCH_RUNNER_COMMAND,
        rowOwnerAssertionContractItemIds: ROW_OWNER_ASSERTION_ITEM_IDS,
        rowOwnerAssertionContractReady: true,
        rowLevelDataAcceptedByR1163: false,
        rowOwnerAssertionInferredByR1163: false,
        rowOwnerAssertionStillRequired: true,
        rowOwnerPrivateValuesStored: false,
        rowParsingPerformedByR1163: false,
        safeConfirmationArtifactWritten: false,
        targetAgeBand: "roughly_16_50",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      });
      expect(output.childArtifacts.r1153).toMatchObject({
        packetId: null,
        schemaVersion: null,
        status: "missing",
      });
      expect(output.runner.runnerCommand).toBe(R1163_ASSERTION_TO_RESEARCH_RUNNER_COMMAND);
      expect(output.runner.minimumFeaturePairRequired).toEqual([
        "bloodwork_glycemia",
        "wearable_activity_daily",
      ]);
      expect(output.runner.optionalAddOnFamilyIds).toEqual([
        "common_bloodwork_core",
        "vitals_body_context",
      ]);
      expect(output.rowOwnerAssertionContract).toMatchObject({
        assertionItemIds: ROW_OWNER_ASSERTION_ITEM_IDS,
        assertionReadyForAverageSubmitter: true,
        commandAfterAssertion: R1163_ASSERTION_TO_RESEARCH_RUNNER_COMMAND,
        minimumFeaturePairRequired: [
          "bloodwork_glycemia",
          "wearable_activity_daily",
        ],
        modelEvidencePromotionAllowed: false,
        privateDetailsStored: false,
        requiredChecklistIds: REQUIRED_CHECKLIST_IDS,
        requiredInputKindIds: REQUIRED_INPUT_KIND_IDS,
        rowLevelDataAcceptedByR1163: false,
        rowOwnerPrivateValuesStored: false,
        targetAgeBand: "roughly_16_50",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      });
      expect(output.rowOwnerAssertionContract.assertionItems).toEqual([
        expect.objectContaining({
          assertionItemId: "assert_target_age_band_roughly_16_50",
          mapsToChecklistIds: ["confirm_target_age_band_without_identifiers"],
          mapsToSourceFamilyIds: [],
          privateDetailsStored: false,
          safeInputKindIds: [],
        }),
        expect.objectContaining({
          assertionItemId: "assert_glycemia_bloodwork_export_available",
          mapsToChecklistIds: ["confirm_glycemia_bloodwork_export_available"],
          mapsToSourceFamilyIds: ["bloodwork_glycemia"],
          privateDetailsStored: false,
          safeInputKindIds: ["lab_portal_export_or_spreadsheet"],
        }),
        expect.objectContaining({
          assertionItemId: "assert_daily_wearable_activity_export_available",
          mapsToChecklistIds: ["confirm_daily_wearable_activity_export_available"],
          mapsToSourceFamilyIds: ["wearable_activity_daily"],
          privateDetailsStored: false,
          safeInputKindIds: ["phone_watch_or_wearable_activity_export"],
        }),
        expect.objectContaining({
          assertionItemId: "assert_assertion_contains_no_private_values",
          mapsToChecklistIds: ["confirm_no_private_values_in_confirmation"],
          mapsToSourceFamilyIds: [],
          privateDetailsStored: false,
          safeInputKindIds: [],
        }),
      ]);
      expect(output.artifactBoundary).toMatchObject({
        aggregateOnly: true,
        childOutputPathsStored: false,
        confirmationArtifactLocalPathStored: false,
        confirmationValuesStoredByR1163: false,
        localPathsStored: false,
        rowLevelDataAcceptedByR1163: false,
        rowOwnerAssertionInferredByR1163: false,
        rowOwnerPrivateValuesStored: false,
      });
      expect(await pathExists(path.join(tmp, "out", "r1161-confirmed-feature-only-safe-availability-confirmation.json"))).toBe(false);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(findForbiddenAggregateEgress(persisted)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("materializes the safe confirmation and runs R1153 after explicit assertion", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1163-ready-"));
    try {
      const paths = await writeFixtures(tmp);
      const outDir = path.join(tmp, "out");

      const { output } = await runR1163FeatureOnlySafeConfirmationToResearchRunner({
        createdAt: CREATED_AT,
        featureOnlyTemplatePath: paths.featureOnlyTemplatePath,
        outputDir: outDir,
        r1149Path: paths.r1149Path,
        r1160Path: paths.r1160Path,
        rowOwnerAssertionsConfirmed: true,
      });
      const confirmationPath = path.join(outDir, "r1161-confirmed-feature-only-safe-availability-confirmation.json");
      const r1153Path = path.join(outDir, "r1153-ordinary-consumer-feature-only-chain-runner.latest.json");
      const confirmation = JSON.parse(await readFile(confirmationPath, "utf8")) as unknown;
      const r1153 = JSON.parse(await readFile(r1153Path, "utf8")) as unknown;

      expect(output.summary).toMatchObject({
        conclusion: "feature_only_safe_confirmation_to_research_runner_ready_research_only",
        confirmedSafeConfirmationArtifact: "r1161-confirmed-feature-only-safe-availability-confirmation.json",
        explicitRowOwnerConfirmationAssertionProvided: true,
        featureOnlyChainConclusion: "ordinary_feature_only_chain_ready_research_only",
        featureOnlyChainRan: true,
        featureOnlyResearchPlanningReady: true,
        materializerConclusion: "feature_only_safe_availability_confirmation_materialized",
        materializerNextAction: "run_r1150_intake_with_r1161_confirmed_feature_only_safe_availability_confirmation",
        nextAction: READY_NEXT_ACTION,
        rowOwnerAssertionContractReady: true,
        rowOwnerAssertionStillRequired: false,
        safeConfirmationArtifactWritten: true,
      });
      expect(output.featureOnlyChainState).toMatchObject({
        conclusion: "ordinary_feature_only_chain_ready_research_only",
        coverageContextReadyForResearchPlanning: true,
        derivedCoverageContextArtifact: "r1153-derived-feature-only-coverage-context-from-safe-availability.json",
        derivedCoverageContextUsed: true,
        featureOnlyCoverageContextAllowed: true,
        modelEvidencePromotionAllowed: false,
        nextAction: READY_NEXT_ACTION,
        productDisplayAuthorized: false,
        rowLevelDataAcceptedByR1153: false,
        rowParsingPerformedByR1153: false,
      });
      expect(output.materializerState).toMatchObject({
        explicitRowOwnerConfirmationAssertionProvided: true,
        safeMaterializedFieldCount: 15,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(findForbiddenAggregateEgress(confirmation)).toEqual([]);
      expect(findForbiddenAggregateEgress(r1153)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits on R1161 prerequisites before running the feature-only chain", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1163-missing-r1160-"));
    try {
      const paths = await writeFixtures(tmp);
      await rm(paths.r1160Path, { force: true });

      const { output } = await runR1163FeatureOnlySafeConfirmationToResearchRunner({
        createdAt: CREATED_AT,
        featureOnlyTemplatePath: paths.featureOnlyTemplatePath,
        outputDir: path.join(tmp, "out"),
        r1149Path: paths.r1149Path,
        r1160Path: paths.r1160Path,
        rowOwnerAssertionsConfirmed: true,
      });

      expect(output.summary).toMatchObject({
        conclusion: "feature_only_safe_confirmation_to_research_runner_waiting_on_prerequisite",
        explicitRowOwnerConfirmationAssertionProvided: true,
        featureOnlyChainRan: false,
        materializerConclusion: "feature_only_safe_availability_confirmation_materializer_waiting_on_r1160_transcription_proof",
        nextAction: "refresh_r1160_transcription_proof",
        rowOwnerAssertionContractReady: true,
        rowOwnerAssertionStillRequired: true,
        safeConfirmationArtifactWritten: false,
      });
      expect(output.childArtifacts.r1153.status).toBe("missing");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a CLI summary without leaking local paths", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1163-cli-"));
    try {
      const paths = await writeFixtures(tmp);
      const stdout = await execFileStdout("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1163-feature-only-safe-confirmation-to-research-runner.ts"),
      ], {
        MURPH_AGE_R1149_ORDINARY_CONSUMER_LAB_WEARABLE_SUBMISSION_KIT_PATH: paths.r1149Path,
        MURPH_AGE_R1150_FEATURE_ONLY_SAFE_AVAILABILITY_CONFIRMATION_TEMPLATE_PATH:
          paths.featureOnlyTemplatePath,
        MURPH_AGE_R1160_R1159_FEATURE_ONLY_SAFE_CONFIRMATION_TRANSCRIPTION_PROOF_PATH:
          paths.r1160Path,
        MURPH_AGE_R1161_ROW_OWNER_FEATURE_ONLY_CONFIRMATION_ASSERTIONS_CONFIRMED: "true",
        MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
      });
      const parsed = JSON.parse(stdout) as {
        conclusion: string;
        featureOnlyResearchPlanningReady: boolean;
        nextAction: string;
        packetId: string;
        rowOwnerAssertionCommand: string;
        rowOwnerAssertionContractItemIds: string[];
        rowOwnerAssertionContractReady: boolean;
        schemaVersion: string;
      };

      expect(parsed).toMatchObject({
        conclusion: "feature_only_safe_confirmation_to_research_runner_ready_research_only",
        featureOnlyResearchPlanningReady: true,
        nextAction: READY_NEXT_ACTION,
        packetId: "r1163-feature-only-safe-confirmation-to-research-runner",
        rowOwnerAssertionCommand: R1163_ASSERTION_TO_RESEARCH_RUNNER_COMMAND,
        rowOwnerAssertionContractItemIds: ROW_OWNER_ASSERTION_ITEM_IDS,
        rowOwnerAssertionContractReady: true,
        schemaVersion: R1163_FEATURE_ONLY_SAFE_CONFIRMATION_TO_RESEARCH_RUNNER_SCHEMA_VERSION,
      });
      expect(stdout).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

async function writeFixtures(tmp: string): Promise<{
  featureOnlyTemplatePath: string;
  r1149Path: string;
  r1160Path: string;
}> {
  const featureOnlyTemplatePath = path.join(tmp, "feature-only-template.json");
  const r1149Path = path.join(tmp, "r1149.json");
  const r1160Path = path.join(tmp, "r1160.json");
  await writeJson(featureOnlyTemplatePath, featureOnlyTemplateFixture());
  await writeJson(r1149Path, r1149Fixture());
  await writeJson(r1160Path, r1160Fixture());
  return { featureOnlyTemplatePath, r1149Path, r1160Path };
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
