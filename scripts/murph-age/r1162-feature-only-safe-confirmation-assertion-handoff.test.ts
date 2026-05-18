import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { R1161_MATERIALIZER_COMMAND } from "./r1161-feature-only-safe-availability-confirmation-materializer.ts";
import {
  R1162_ASSERTION_HANDOFF_COMMAND,
  R1162_FEATURE_ONLY_SAFE_CONFIRMATION_ASSERTION_HANDOFF_SCHEMA_VERSION,
  runR1162FeatureOnlySafeConfirmationAssertionHandoff,
} from "./r1162-feature-only-safe-confirmation-assertion-handoff.ts";

const CREATED_AT = "2026-05-17T00:00:00.000Z";
const NEXT_ACTION = "row_owner_assert_feature_only_lab_wearable_availability_then_run_r1161_materializer";
const MATERIALIZED_NEXT_ACTION =
  "run_r1150_intake_with_r1161_confirmed_feature_only_safe_availability_confirmation";
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
const REQUIRED_SAFE_FIELD_EDIT_PATHS = [
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
];

describe("R1162 feature-only safe confirmation assertion handoff", () => {
  it("creates a pathless row-owner assertion handoff from waiting R1161 state", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1162-ready-"));
    try {
      const r1161Path = path.join(tmp, "r1161.json");
      await writeJson(r1161Path, r1161Fixture());

      const { output, outputPath } = await runR1162FeatureOnlySafeConfirmationAssertionHandoff({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1161Path,
      });
      const persisted = JSON.parse(await readFile(outputPath, "utf8")) as unknown;

      expect(path.basename(outputPath)).toBe("r1162-feature-only-safe-confirmation-assertion-handoff.latest.json");
      expect(output.schemaVersion).toBe(R1162_FEATURE_ONLY_SAFE_CONFIRMATION_ASSERTION_HANDOFF_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "feature_only_safe_confirmation_assertion_handoff_ready_for_row_owner_assertion",
        confirmationValuesStoredByR1162: false,
        explicitRowOwnerConfirmationAssertionProvided: false,
        featureOnlyConfirmationWouldBeReadyForR1150: false,
        handoffCommand: R1162_ASSERTION_HANDOFF_COMMAND,
        handoffReadyForRowOwner: true,
        materializerCommand: R1161_MATERIALIZER_COMMAND,
        materializerConclusion: "feature_only_safe_availability_confirmation_materializer_waiting_on_explicit_row_owner_confirmation",
        materializerNextAction: "rerun_r1161_with_row_owner_feature_only_confirmation_assertion",
        modelEvidencePromotionAllowed: false,
        nextAction: NEXT_ACTION,
        productDisplayAuthorized: false,
        requiredChecklistIds: REQUIRED_CHECKLIST_IDS,
        requiredInputKindIds: REQUIRED_INPUT_KIND_IDS,
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1162: false,
        rowOwnerAssertionInferredByR1162: false,
        rowOwnerAssertionStillRequired: true,
        rowOwnerPrivateValuesStored: false,
        rowParsingPerformedByR1162: false,
        safeConfirmationArtifact: null,
        safeConfirmationArtifactWritten: false,
        targetAgeBand: "roughly_16_50",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      });
      expect(output.summary.minimumFeaturePairRequired).toEqual([
        "bloodwork_glycemia",
        "wearable_activity_daily",
      ]);
      expect(output.summary.optionalAddOnFamilyIds).toEqual([
        "common_bloodwork_core",
        "vitals_body_context",
      ]);
      expect(output.assertionHandoff.requiredSafeFieldEditPaths).toEqual(REQUIRED_SAFE_FIELD_EDIT_PATHS);
      expect(output.assertionHandoff.rowOwnerActionItems.map((item) => item.actionId)).toEqual([
        "confirm_target_age_band_only",
        "confirm_glycemia_bloodwork_export_available",
        "confirm_daily_wearable_activity_export_available",
        "confirm_no_private_values_identifiers_paths_headers_or_rows",
        "run_r1161_materializer_with_explicit_row_owner_assertion",
      ]);
      expect(output.artifactBoundary).toMatchObject({
        aggregateOnly: true,
        confirmationValuesStoredByR1162: false,
        fileNamesStored: false,
        headerValuesStored: false,
        localPathsStored: false,
        rowLevelDataAcceptedByR1162: false,
        rowOwnerAssertionInferredByR1162: false,
        rowOwnerPrivateValuesStored: false,
        rowParsingPerformedByR1162: false,
        sourceFileNamesStored: false,
      });
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(findForbiddenAggregateEgress(persisted)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes to the confirmed R1150 intake step when R1161 already materialized the safe confirmation", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1162-satisfied-"));
    try {
      const r1161Path = path.join(tmp, "r1161.json");
      await writeJson(r1161Path, r1161Fixture({ materialized: true }));

      const { output } = await runR1162FeatureOnlySafeConfirmationAssertionHandoff({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1161Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "feature_only_safe_confirmation_assertion_handoff_satisfied",
        explicitRowOwnerConfirmationAssertionProvided: true,
        featureOnlyConfirmationWouldBeReadyForR1150: true,
        handoffReadyForRowOwner: true,
        materializerNextAction: MATERIALIZED_NEXT_ACTION,
        nextAction: MATERIALIZED_NEXT_ACTION,
        rowOwnerAssertionStillRequired: false,
        safeConfirmationArtifact: "r1161-confirmed-feature-only-safe-availability-confirmation.json",
        safeConfirmationArtifactWritten: true,
      });
      expect(output.materializerState).toMatchObject({
        safeMaterializedFieldCount: REQUIRED_SAFE_FIELD_EDIT_PATHS.length,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("waits for R1161 when the materializer packet is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1162-missing-"));
    try {
      const { output } = await runR1162FeatureOnlySafeConfirmationAssertionHandoff({
        createdAt: CREATED_AT,
        outputDir: path.join(tmp, "out"),
        r1161Path: path.join(tmp, "missing-r1161.json"),
      });

      expect(output.summary).toMatchObject({
        conclusion: "feature_only_safe_confirmation_assertion_handoff_waiting_on_r1161_materializer",
        handoffReadyForRowOwner: false,
        materializerConclusion: null,
        nextAction: "refresh_r1161_safe_confirmation_materializer",
        rowOwnerAssertionStillRequired: true,
        safeConfirmationArtifactWritten: null,
      });
      expect(output.inputArtifacts.r1161).toMatchObject({
        packetId: null,
        schemaVersion: null,
        status: "missing",
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe R1161 input with a sanitized error", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1162-unsafe-"));
    try {
      const r1161Path = path.join(tmp, "r1161.json");
      await writeJson(r1161Path, {
        ...r1161Fixture(),
        artifactBoundary: {
          ...safeR1161Boundary(),
          localPathsStored: true,
        },
      });

      await expect(runR1162FeatureOnlySafeConfirmationAssertionHandoff({
        outputDir: path.join(tmp, "out"),
        r1161Path,
      })).rejects.toThrow("R1162 rejected unsafe r1161 input: 1 aggregate-egress violation");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a CLI summary without leaking local paths", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1162-cli-"));
    try {
      const r1161Path = path.join(tmp, "r1161.json");
      await writeJson(r1161Path, r1161Fixture());
      const stdout = await execFileStdout("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1162-feature-only-safe-confirmation-assertion-handoff.ts"),
      ], {
        MURPH_AGE_R1161_FEATURE_ONLY_SAFE_AVAILABILITY_CONFIRMATION_MATERIALIZER_PATH: r1161Path,
        MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
      });
      const parsed = JSON.parse(stdout) as {
        nextAction: string;
        packetId: string;
        schemaVersion: string;
      };

      expect(parsed).toMatchObject({
        nextAction: NEXT_ACTION,
        packetId: "r1162-feature-only-safe-confirmation-assertion-handoff",
        schemaVersion: R1162_FEATURE_ONLY_SAFE_CONFIRMATION_ASSERTION_HANDOFF_SCHEMA_VERSION,
      });
      expect(stdout).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});

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

function r1161Fixture(options: { materialized?: boolean } = {}): Record<string, unknown> {
  const materialized = options.materialized === true;
  return {
    artifactBoundary: safeR1161Boundary(),
    materializer: {
      materializerCommand: R1161_MATERIALIZER_COMMAND,
    },
    packetId: "r1161-feature-only-safe-availability-confirmation-materializer",
    productDisplayAuthorized: false,
    schemaVersion: "murph-age-r1161-feature-only-safe-availability-confirmation-materializer.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: materialized
        ? "feature_only_safe_availability_confirmation_materialized"
        : "feature_only_safe_availability_confirmation_materializer_waiting_on_explicit_row_owner_confirmation",
      confirmationValuesStoredInR1161Packet: false,
      explicitRowOwnerConfirmationAssertionProvided: materialized,
      featureOnlyConfirmationWouldBeReadyForR1150: materialized,
      featureOnlyTemplateReady: true,
      minimumFeaturePairRequired: [
        "bloodwork_glycemia",
        "wearable_activity_daily",
      ],
      modelEvidencePromotionAllowed: false,
      nextAction: materialized
        ? MATERIALIZED_NEXT_ACTION
        : "rerun_r1161_with_row_owner_feature_only_confirmation_assertion",
      optionalAddOnFamilyIds: [
        "common_bloodwork_core",
        "vitals_body_context",
      ],
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1161: false,
      rowOwnerConfirmationStillRequired: !materialized,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1161: false,
      r1160ProofReadyForRowOwnerConfirmation: true,
      safeConfirmationArtifact: materialized
        ? "r1161-confirmed-feature-only-safe-availability-confirmation.json"
        : null,
      safeConfirmationArtifactWritten: materialized,
      safeMaterializedFieldCount: materialized ? REQUIRED_SAFE_FIELD_EDIT_PATHS.length : 0,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };
}

function safeR1161Boundary(): Record<string, boolean> {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    confirmationArtifactLocalPathStored: false,
    confirmationValuesStoredInR1161Packet: false,
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
    rowLevelDataAcceptedByR1161: false,
    rowOwnerPrivateValuesStored: false,
    rowParsingPerformedByR1161: false,
    rowValuesStored: false,
    safeConfirmationArtifactWrittenOnlyAfterExplicitAssertion: true,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}
