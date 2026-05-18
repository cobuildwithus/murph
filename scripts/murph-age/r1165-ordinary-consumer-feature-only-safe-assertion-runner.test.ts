import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1165_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_RUNNER_SCHEMA_VERSION,
  R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_SCHEMA_VERSION,
  R1165_SAFE_ASSERTION_RUNNER_COMMAND,
  runR1165OrdinaryConsumerFeatureOnlySafeAssertionRunner,
} from "./r1165-ordinary-consumer-feature-only-safe-assertion-runner.ts";

const CREATED_AT = "2026-05-18T00:00:00.000Z";
const TEMPLATE_NEXT_ACTION = "fill_r1165_row_owner_feature_only_safe_assertion_template";
const INVALID_NEXT_ACTION = "rerun_r1165_with_valid_safe_assertion";
const READY_NEXT_ACTION = "run_r1164_feature_only_research_handoff";
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
const OPTIONAL_ADD_ON_FAMILY_IDS = [
  "common_bloodwork_core",
  "vitals_body_context",
];

describe("R1165 ordinary consumer feature-only safe assertion runner", () => {
  it("writes a safe assertion template and waits when no assertion file is supplied", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1165-waiting-"));
    try {
      const paths = await writeFixtures(tmp);
      const outDir = path.join(tmp, "out");
      const { output, outputPath } = await runR1165OrdinaryConsumerFeatureOnlySafeAssertionRunner({
        createdAt: CREATED_AT,
        featureOnlyTemplatePath: paths.featureOnlyTemplatePath,
        outputDir: outDir,
        r1149Path: paths.r1149Path,
        r1160Path: paths.r1160Path,
      });
      const persisted = JSON.parse(await readFile(outputPath, "utf8")) as unknown;
      const templatePath = path.join(outDir, "r1165-row-owner-feature-only-safe-assertion.template.json");
      const template = JSON.parse(await readFile(templatePath, "utf8")) as Record<string, unknown>;

      expect(path.basename(outputPath)).toBe(
        "r1165-ordinary-consumer-feature-only-safe-assertion-runner.latest.json",
      );
      expect(output.schemaVersion).toBe(
        R1165_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_RUNNER_SCHEMA_VERSION,
      );
      expect(output.summary).toMatchObject({
        assertionAccepted: false,
        assertionProvided: false,
        assertionTemplateArtifact: "r1165-row-owner-feature-only-safe-assertion.template.json",
        childR1163Ran: false,
        conclusion: "ordinary_feature_only_safe_assertion_runner_waiting_on_assertion_file",
        featureOnlyResearchPlanningReady: false,
        modelEvidencePromotionAllowed: false,
        nextAction: TEMPLATE_NEXT_ACTION,
        outcomeLinkedModelEvidenceStillRequired: true,
        productDisplayAuthorized: false,
        requiredAssertionChecklistIds: REQUIRED_ASSERTION_CHECKLIST_IDS,
        requiredInputKindIds: REQUIRED_INPUT_KIND_IDS,
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1165: false,
        rowOwnerAssertionInferredByR1165: false,
        rowOwnerPrivateValuesStored: false,
        rowParsingPerformedByR1165: false,
        targetAgeBand: "roughly_16_50",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
        validationReasonIds: ["assertion_file_missing"],
      });
      expect(output.summary.minimumFeaturePairRequired).toEqual([
        "bloodwork_glycemia",
        "wearable_activity_daily",
      ]);
      expect(output.summary.optionalAddOnFamilyIds).toEqual(OPTIONAL_ADD_ON_FAMILY_IDS);
      expect(output.childArtifacts.r1163.status).toBe("not_run");
      expect(output.inputArtifacts.rowOwnerSafeAssertion).toMatchObject({
        artifact: null,
        schemaVersion: null,
        status: "missing",
      });
      expect(template).toMatchObject({
        privateContentExcluded: false,
        rowOwnerAssertionsConfirmed: false,
        schemaVersion: R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_SCHEMA_VERSION,
        targetAgeBand: "roughly_16_50",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      });
      expect(Object.values(template.attestations as Record<string, unknown>)).toEqual(Array(11).fill(false));
      expect(template.sourceFamilies).toEqual([
        {
          available: false,
          familyId: "bloodwork_glycemia",
          inputKindId: "lab_portal_export_or_spreadsheet",
        },
        {
          available: false,
          familyId: "wearable_activity_daily",
          inputKindId: "phone_watch_or_wearable_activity_export",
        },
        {
          available: false,
          familyId: "common_bloodwork_core",
          inputKindId: "optional_common_bloodwork_or_vitals_context",
        },
        {
          available: false,
          familyId: "vitals_body_context",
          inputKindId: "optional_common_bloodwork_or_vitals_context",
        },
      ]);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(findForbiddenAggregateEgress(persisted)).toEqual([]);
      expect(findForbiddenAggregateEgress(template)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("runs R1163 only after a valid safe row-owner assertion is supplied", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1165-ready-"));
    try {
      const paths = await writeFixtures(tmp);
      const assertionPath = path.join(tmp, "safe-assertion.json");
      const outDir = path.join(tmp, "out");
      await writeJson(assertionPath, validAssertionFixture());

      const { output } = await runR1165OrdinaryConsumerFeatureOnlySafeAssertionRunner({
        assertionPath,
        createdAt: CREATED_AT,
        featureOnlyTemplatePath: paths.featureOnlyTemplatePath,
        outputDir: outDir,
        r1149Path: paths.r1149Path,
        r1160Path: paths.r1160Path,
      });
      const r1163 = JSON.parse(await readFile(
        path.join(outDir, "r1163-feature-only-safe-confirmation-to-research-runner.latest.json"),
        "utf8",
      )) as unknown;

      expect(output.summary).toMatchObject({
        assertionAccepted: true,
        assertionProvided: true,
        childR1163Ran: true,
        conclusion: "ordinary_feature_only_safe_assertion_runner_ready_research_only",
        featureOnlyResearchPlanningReady: true,
        nextAction: READY_NEXT_ACTION,
        productDisplayAuthorized: false,
        rowLevelDataAcceptedByR1165: false,
        rowOwnerAssertionInferredByR1165: false,
        rowOwnerPrivateValuesStored: false,
        validationReasonIds: [],
      });
      expect(output.assertionRunner.commands.safeAssertionRunnerCommand).toBe(R1165_SAFE_ASSERTION_RUNNER_COMMAND);
      expect(output.r1163State).toMatchObject({
        conclusion: "feature_only_safe_confirmation_to_research_runner_ready_research_only",
        featureOnlyChainRan: true,
        featureOnlyResearchPlanningReady: true,
        rowOwnerAssertionStillRequired: false,
        safeConfirmationArtifactWritten: true,
      });
      expect(output.childArtifacts.r1163).toMatchObject({
        artifact: "r1163-feature-only-safe-confirmation-to-research-runner.latest.json",
        packetId: "r1163-feature-only-safe-confirmation-to-research-runner",
        status: "available",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(findForbiddenAggregateEgress(r1163)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects incomplete safe assertions without running R1163", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1165-invalid-"));
    try {
      const paths = await writeFixtures(tmp);
      const assertionPath = path.join(tmp, "safe-assertion.json");
      const outDir = path.join(tmp, "out");
      await writeJson(assertionPath, {
        ...validAssertionFixture(),
        rowOwnerAssertionsConfirmed: false,
        sourceFamilies: [
          {
            available: true,
            familyId: "bloodwork_glycemia",
            inputKindId: "lab_portal_export_or_spreadsheet",
          },
          {
            available: false,
            familyId: "wearable_activity_daily",
            inputKindId: "phone_watch_or_wearable_activity_export",
          },
        ],
      });

      const { output } = await runR1165OrdinaryConsumerFeatureOnlySafeAssertionRunner({
        assertionPath,
        createdAt: CREATED_AT,
        featureOnlyTemplatePath: paths.featureOnlyTemplatePath,
        outputDir: outDir,
        r1149Path: paths.r1149Path,
        r1160Path: paths.r1160Path,
      });

      expect(output.summary).toMatchObject({
        assertionAccepted: false,
        assertionProvided: true,
        childR1163Ran: false,
        conclusion: "ordinary_feature_only_safe_assertion_runner_invalid_assertion",
        featureOnlyResearchPlanningReady: false,
        nextAction: INVALID_NEXT_ACTION,
        validationReasonIds: [
          "row_owner_assertion_not_confirmed",
          "source_family_availability_missing_or_false",
        ],
      });
      expect(output.childArtifacts.r1163.status).toBe("not_run");
      expect(await pathExists(path.join(outDir, "r1163-feature-only-safe-confirmation-to-research-runner.latest.json"))).toBe(false);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe assertion content with a sanitized error", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1165-unsafe-"));
    try {
      const paths = await writeFixtures(tmp);
      const assertionPath = path.join(tmp, "safe-assertion.json");
      await writeJson(assertionPath, {
        ...validAssertionFixture(),
        localPathsStored: true,
      });

      await expect(runR1165OrdinaryConsumerFeatureOnlySafeAssertionRunner({
        assertionPath,
        createdAt: CREATED_AT,
        featureOnlyTemplatePath: paths.featureOnlyTemplatePath,
        outputDir: path.join(tmp, "out"),
        r1149Path: paths.r1149Path,
        r1160Path: paths.r1160Path,
      })).rejects.toThrow("R1165 rejected unsafe rowOwnerSafeAssertion input: 1 finding");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a CLI summary without leaking local paths", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1165-cli-"));
    try {
      const paths = await writeFixtures(tmp);
      const assertionPath = path.join(tmp, "safe-assertion.json");
      await writeJson(assertionPath, validAssertionFixture());
      const stdout = await execFileStdout("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1165-ordinary-consumer-feature-only-safe-assertion-runner.ts"),
      ], {
        MURPH_AGE_R1149_ORDINARY_CONSUMER_SUBMISSION_KIT_PATH: paths.r1149Path,
        MURPH_AGE_R1150_FEATURE_ONLY_SAFE_AVAILABILITY_CONFIRMATION_TEMPLATE_PATH:
          paths.featureOnlyTemplatePath,
        MURPH_AGE_R1160_R1159_FEATURE_ONLY_SAFE_CONFIRMATION_TRANSCRIPTION_PROOF_PATH:
          paths.r1160Path,
        MURPH_AGE_R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_PATH: assertionPath,
        MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
      });
      const parsed = JSON.parse(stdout) as {
        assertionAccepted: boolean;
        conclusion: string;
        featureOnlyResearchPlanningReady: boolean;
        nextAction: string;
        packetId: string;
        schemaVersion: string;
      };

      expect(parsed).toMatchObject({
        assertionAccepted: true,
        conclusion: "ordinary_feature_only_safe_assertion_runner_ready_research_only",
        featureOnlyResearchPlanningReady: true,
        nextAction: READY_NEXT_ACTION,
        packetId: "r1165-ordinary-consumer-feature-only-safe-assertion-runner",
        schemaVersion: R1165_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_RUNNER_SCHEMA_VERSION,
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

function validAssertionFixture(): Record<string, unknown> {
  return {
    attestations: {
      aggregateOnly: true,
      localOnly: true,
      noCoefficientEgress: true,
      noHeaderNameEgress: true,
      noParticipantEgress: true,
      noPredictionEgress: true,
      noPrivatePathEgress: true,
      noPrivateRefValueEgress: true,
      noRowEgress: true,
      noSmallCellEgress: true,
      noSourceTextEgress: true,
    },
    privateContentExcluded: true,
    requiredInputKindIds: REQUIRED_INPUT_KIND_IDS,
    rowOwnerAssertionsConfirmed: true,
    schemaVersion: R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_SCHEMA_VERSION,
    sourceFamilies: [
      {
        available: true,
        familyId: "bloodwork_glycemia",
        inputKindId: "lab_portal_export_or_spreadsheet",
      },
      {
        available: true,
        familyId: "wearable_activity_daily",
        inputKindId: "phone_watch_or_wearable_activity_export",
      },
      {
        available: false,
        familyId: "common_bloodwork_core",
        inputKindId: "optional_common_bloodwork_or_vitals_context",
      },
      {
        available: false,
        familyId: "vitals_body_context",
        inputKindId: "optional_common_bloodwork_or_vitals_context",
      },
    ],
    targetAgeBand: "roughly_16_50",
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
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
