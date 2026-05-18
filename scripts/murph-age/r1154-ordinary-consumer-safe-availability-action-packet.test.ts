import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1154_ORDINARY_CONSUMER_SAFE_AVAILABILITY_ACTION_PACKET_SCHEMA_VERSION,
  runR1154OrdinaryConsumerSafeAvailabilityActionPacket,
} from "./r1154-ordinary-consumer-safe-availability-action-packet.ts";

const REQUIRED_SOURCE_FAMILY_IDS = [
  "outcome_linkage",
  "join_time_alignment",
  "bloodwork_glycemia",
  "wearable_activity_daily",
];
const FEATURE_ONLY_SOURCE_FAMILY_IDS = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
];
const FEATURE_ONLY_QUICKSTART_ARTIFACT = "r1154-feature-only-safe-confirmation-quickstart.json";
const FEATURE_ONLY_FILLABLE_TEMPLATE_ARTIFACT =
  "r1150-fillable-feature-only-safe-availability-confirmation.json";
const FULL_FILLABLE_TEMPLATE_ARTIFACT =
  "r1150-fillable-ordinary-consumer-safe-availability-confirmation.json";
const OPTIONAL_ADD_ON_FAMILY_IDS = [
  "common_bloodwork_core",
  "vitals_body_context",
];
const ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS = [
  "confirm_target_age_band_without_identifiers",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
  "confirm_outcome_linkage_and_time_alignment_if_model_evidence",
  "confirm_aggregate_count_bands_if_model_evidence",
];
const FEATURE_ONLY_SAFE_COMPLETION_CHECK_IDS = [
  "confirm_target_age_band_without_identifiers",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
];
const ORDINARY_SUBMITTER_COMPLETION_MODE_IDS = [
  "feature_only_lab_wearable_coverage",
  "outcome_linked_lab_wearable_model_evidence",
];
const EXPECTED_ROUTE_IDS = [
  "lab_glycemia_minimum_route",
  "wearable_activity_minimum_route",
];
const REQUIRED_AGGREGATE_READINESS_FACT_IDS = [
  "outcomeLinked",
  "sameDenominator",
  "targetAgeBand",
  "usableRecordCountBand",
  "eventCountBand",
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
const FEATURE_ONLY_SAFE_CONFIRMATION_FIELD_PATHS = [
  "aggregateReadinessFacts.targetAgeBand",
  "sourceFamilies[bloodwork_glycemia].available",
  "sourceFamilies[wearable_activity_daily].available",
  "rowOwnerAssertionsConfirmed",
  ...REQUIRED_ATTESTATION_KEYS.map((key) => `attestations.${key}`),
];

describe("R1154 ordinary consumer safe availability action packet", () => {
  it("waits on the R1150 intake artifact when it is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1154-missing-r1150-"));
    try {
      const { output, outputPath, quickstartPath } = await runR1154OrdinaryConsumerSafeAvailabilityActionPacket({
        createdAt: "2026-05-17T04:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        r1150Path: path.join(tmp, "missing-r1150.json"),
      });

      expect(path.basename(outputPath)).toBe("r1154-ordinary-consumer-safe-availability-action-packet.latest.json");
      expect(path.basename(quickstartPath)).toBe(FEATURE_ONLY_QUICKSTART_ARTIFACT);
      expect(output.schemaVersion).toBe(
        R1154_ORDINARY_CONSUMER_SAFE_AVAILABILITY_ACTION_PACKET_SCHEMA_VERSION,
      );
      expect(output.summary).toMatchObject({
        conclusion: "safe_availability_action_packet_waiting_on_r1150_intake",
        expectedRouteIds: EXPECTED_ROUTE_IDS,
        featureOnlyCoverageContextReady: false,
        featureOnlyFillableTemplateArtifact: null,
        featureOnlyQuickstartArtifact: FEATURE_ONLY_QUICKSTART_ARTIFACT,
        featureOnlyQuickstartSafeFieldEditCount: FEATURE_ONLY_SAFE_CONFIRMATION_FIELD_PATHS.length,
        featureOnlyQuickstartSafeFieldEditPaths: FEATURE_ONLY_SAFE_CONFIRMATION_FIELD_PATHS,
        fillableTemplateArtifact: null,
        minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
        missingAggregateReadinessFactIds: REQUIRED_AGGREGATE_READINESS_FACT_IDS,
        missingAttestationKeys: REQUIRED_ATTESTATION_KEYS,
        missingFeatureOnlySourceFamilyIds: FEATURE_ONLY_SOURCE_FAMILY_IDS,
        missingRequiredSourceFamilyIds: REQUIRED_SOURCE_FAMILY_IDS,
        nextAction: "run_r1150_safe_availability_confirmation_intake",
        outcomeLinkageRequiredForFeatureOnlyContext: false,
        ordinarySubmitterCompletionModeIds: ORDINARY_SUBMITTER_COMPLETION_MODE_IDS,
        ordinarySubmitterSafeCompletionChecklistItemIds: ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS,
        preferredRecipeId: "lab_plus_wearable_minimum_manifest",
        productDisplayAuthorized: false,
        r1150Expected: false,
        readyForOutcomeLinkedRecipeReadinessChain: false,
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1154: false,
        rowOwnerAssertionsConfirmed: null,
        rowOwnerWorkType: "refresh_safe_availability_prerequisites",
        rowParsingPerformedByR1154: false,
        safeAvailabilityConfirmationStatus: null,
        targetAgeBand: "roughly_16_50",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      });
      expect(output.inputArtifacts.r1150).toMatchObject({
        packetId: null,
        schemaVersion: null,
        status: "missing",
      });
      expect(output.safeAvailabilityActionPacket.featureOnlyQuickstartArtifact).toBe(FEATURE_ONLY_QUICKSTART_ARTIFACT);
      expect(output.safeAvailabilityActionPacket.featureOnlyQuickstartSafeFieldEditCount)
        .toBe(FEATURE_ONLY_SAFE_CONFIRMATION_FIELD_PATHS.length);
      expect(output.safeAvailabilityActionPacket.featureOnlyQuickstartSafeFieldEditPaths)
        .toEqual(FEATURE_ONLY_SAFE_CONFIRMATION_FIELD_PATHS);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("turns a missing safe confirmation into a lab-plus-wearable row-owner checklist", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1154-waiting-"));
    try {
      const r1150Path = path.join(tmp, "r1150.json");
      await writeJson(r1150Path, r1150Fixture());

      const { output, outputPath, quickstartPath } = await runR1154OrdinaryConsumerSafeAvailabilityActionPacket({
        createdAt: "2026-05-17T04:05:00.000Z",
        outputDir: path.join(tmp, "out"),
        r1150Path,
      });

      expect(path.basename(outputPath)).toBe("r1154-ordinary-consumer-safe-availability-action-packet.latest.json");
      expect(path.basename(quickstartPath)).toBe(FEATURE_ONLY_QUICKSTART_ARTIFACT);
      expect(output.summary).toMatchObject({
        conclusion: "safe_availability_action_packet_waiting_on_safe_confirmation",
        featureOnlyCoverageContextReady: false,
        featureOnlyFillableTemplateArtifact: FEATURE_ONLY_FILLABLE_TEMPLATE_ARTIFACT,
        featureOnlyQuickstartArtifact: FEATURE_ONLY_QUICKSTART_ARTIFACT,
        featureOnlyQuickstartSafeFieldEditCount: FEATURE_ONLY_SAFE_CONFIRMATION_FIELD_PATHS.length,
        featureOnlyQuickstartSafeFieldEditPaths: FEATURE_ONLY_SAFE_CONFIRMATION_FIELD_PATHS,
        fillableTemplateArtifact: FULL_FILLABLE_TEMPLATE_ARTIFACT,
        missingFeatureOnlySourceFamilyIds: FEATURE_ONLY_SOURCE_FAMILY_IDS,
        missingRequiredSourceFamilyIds: REQUIRED_SOURCE_FAMILY_IDS,
        nextAction: "fill_safe_availability_confirmation_from_template",
        outcomeLinkageRequiredForFeatureOnlyContext: false,
        ordinarySubmitterCompletionModeIds: ORDINARY_SUBMITTER_COMPLETION_MODE_IDS,
        ordinarySubmitterSafeCompletionChecklistItemIds: ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS,
        r1150Conclusion: "safe_availability_confirmation_not_provided",
        r1150Expected: true,
        r1150SafeArtifactBoundaryPresent: true,
        readyForOutcomeLinkedRecipeReadinessChain: false,
        rowOwnerWorkType: "fill_safe_availability_confirmation",
        safeAvailabilityConfirmationStatus: "missing",
      });
      expect(output.safeAvailabilityActionPacket.ordinarySubmitterInputKinds.map((kind) => kind.inputKindId)).toEqual([
        "lab_portal_export_or_spreadsheet",
        "phone_watch_or_wearable_activity_export",
        "optional_vitals_or_body_context",
      ]);
      expect(output.safeAvailabilityActionPacket.ordinarySubmitterInputKinds
        .filter((kind) => kind.requiredForFeatureOnlyPreferredPair)
        .map((kind) => kind.inputKindId)).toEqual([
          "lab_portal_export_or_spreadsheet",
          "phone_watch_or_wearable_activity_export",
        ]);
      expect(output.safeAvailabilityActionPacket.ordinarySubmitterCompletionModes
        .map((mode) => mode.modeId)).toEqual(ORDINARY_SUBMITTER_COMPLETION_MODE_IDS);
      expect(output.safeAvailabilityActionPacket.ordinarySubmitterCompletionModes
        .find((mode) => mode.modeId === "feature_only_lab_wearable_coverage"))
        .toMatchObject({
          modelEvidenceCandidate: false,
          nextActionAfterR1150: "run_r1153_feature_only_chain",
          outcomeLinkageRequired: false,
          privateDetailsStored: false,
          rowLevelDataAccepted: false,
        });
      expect(output.safeAvailabilityActionPacket.ordinarySubmitterCompletionModes
        .find((mode) => mode.modeId === "outcome_linked_lab_wearable_model_evidence"))
        .toMatchObject({
          modelEvidenceCandidate: true,
          nextActionAfterR1150: "run_r1144_recipe_readiness_chain",
          outcomeLinkageRequired: true,
          privateDetailsStored: false,
          rowLevelDataAccepted: false,
        });
      expect(output.safeAvailabilityActionPacket.ordinarySubmitterSafeCompletionChecklist
        .map((item) => item.checkId)).toEqual(ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS);
      expect(output.safeAvailabilityActionPacket.ordinarySubmitterSafeCompletionChecklist
        .filter((item) => item.requiredForFeatureOnlyPreferredPair)
        .map((item) => item.checkId)).toEqual([
          "confirm_target_age_band_without_identifiers",
          "confirm_glycemia_bloodwork_export_available",
          "confirm_daily_wearable_activity_export_available",
          "confirm_no_private_values_in_confirmation",
        ]);
      expect(output.safeAvailabilityActionPacket.sourceFamilyChecklist.map((item) => item.familyId)).toEqual([
        ...REQUIRED_SOURCE_FAMILY_IDS,
        ...OPTIONAL_ADD_ON_FAMILY_IDS,
      ]);
      expect(output.safeAvailabilityActionPacket.sourceFamilyChecklist
        .filter((item) => item.requiredForFeatureOnlyPreferredPair)
        .map((item) => item.familyId)).toEqual(FEATURE_ONLY_SOURCE_FAMILY_IDS);
      expect(output.safeAvailabilityActionPacket.aggregateReadinessFactChecklist
        .filter((item) => item.requiredForFeatureOnlyContext)
        .map((item) => item.factId)).toEqual(["targetAgeBand"]);
      expect(output.safeAvailabilityActionPacket.attestationChecklist).toHaveLength(
        REQUIRED_ATTESTATION_KEYS.length,
      );
      expect(output.safeAvailabilityActionPacket.commands.safeAvailabilityConfirmationIntakeCommand).toContain(
        "r1150-ordinary-consumer-safe-availability-confirmation-intake.ts",
      );
      expect(output.safeAvailabilityActionPacket.commands.featureOnlyChainRunnerCommand).toContain(
        "r1153-ordinary-consumer-feature-only-chain-runner.ts",
      );
      expect(output.safeAvailabilityActionPacket.commands.outcomeLinkedRecipeReadinessCommand).toContain(
        "r1144-ordinary-consumer-recipe-readiness-chain-runner.ts",
      );
      expect(output.safeAvailabilityActionPacket.featureOnlyQuickstartArtifact).toBe(FEATURE_ONLY_QUICKSTART_ARTIFACT);
      expect(output.safeAvailabilityActionPacket.featureOnlyQuickstartSafeFieldEditPaths)
        .toEqual(FEATURE_ONLY_SAFE_CONFIRMATION_FIELD_PATHS);
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(JSON.stringify(output)).not.toContain("private_person_id");
      expect(JSON.stringify(output)).not.toContain("glucose_private_column");
      expect(JSON.stringify(output)).not.toContain("ordinary-private-route.csv");
      expect(findForbiddenAggregateEgress(output)).toEqual([]);

      const persisted = JSON.parse(await readFile(outputPath, "utf8")) as unknown;
      expect(findForbiddenAggregateEgress(persisted)).toEqual([]);
      const quickstart = JSON.parse(await readFile(quickstartPath, "utf8")) as Record<string, unknown>;
      expect(quickstart).toMatchObject({
        aggregateReadinessFactIdsToConfirm: ["targetAgeBand"],
        attestationsToConfirm: REQUIRED_ATTESTATION_KEYS,
        completionModeId: "feature_only_lab_wearable_coverage",
        featureOnlyFillableTemplateArtifact: FEATURE_ONLY_FILLABLE_TEMPLATE_ARTIFACT,
        fullFillableTemplateArtifact: FULL_FILLABLE_TEMPLATE_ARTIFACT,
        modelEvidencePromotionAllowed: false,
        nextActionAfterSafeConfirmation: "run_r1153_feature_only_chain_with_safe_availability",
        outcomeLinkageRequiredForFeatureOnlyContext: false,
        productDisplayAuthorized: false,
        privateDetailsStored: false,
        requiredChecklistItemIds: FEATURE_ONLY_SAFE_COMPLETION_CHECK_IDS,
        reviewGptRequiredNow: false,
        rowLevelDataAcceptedByR1154: false,
        rowParsingPerformedByR1154: false,
        schemaVersion: "murph-age-r1154-feature-only-safe-confirmation-quickstart.v1",
        targetAgeBand: "roughly_16_50",
        targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      });
      expect((quickstart.requiredSourceFamilies as Array<{ familyId: string }>).map((family) => family.familyId)).toEqual(
        FEATURE_ONLY_SOURCE_FAMILY_IDS,
      );
      const safeFieldEdits = quickstart.safeConfirmationFieldEdits as Array<{
        fieldPath: string;
        privateDetailsStored: boolean;
        setOnlyIf: string;
        setTo: boolean | string;
      }>;
      expect(safeFieldEdits.map((edit) => edit.fieldPath)).toEqual(FEATURE_ONLY_SAFE_CONFIRMATION_FIELD_PATHS);
      expect(safeFieldEdits.every((edit) => edit.privateDetailsStored === false)).toBe(true);
      expect(safeFieldEdits.find((edit) => edit.fieldPath === "aggregateReadinessFacts.targetAgeBand")).toMatchObject({
        setTo: "roughly_16_50",
      });
      expect(safeFieldEdits.find((edit) => edit.fieldPath === "sourceFamilies[bloodwork_glycemia].available"))
        .toMatchObject({
          setTo: true,
        });
      expect(safeFieldEdits.find((edit) => edit.fieldPath === "sourceFamilies[wearable_activity_daily].available"))
        .toMatchObject({
          setTo: true,
        });
      expect(safeFieldEdits.find((edit) => edit.fieldPath === "attestations.noHeaderNameEgress")?.setOnlyIf)
        .toContain("No private column headers");
      expect(quickstart.blockedConfirmationContent).toEqual([
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
      ]);
      expect(JSON.stringify(quickstart)).not.toContain(tmp);
      expect(JSON.stringify(quickstart)).not.toContain("private_person_id");
      expect(JSON.stringify(quickstart)).not.toContain("glucose_private_column");
      expect(JSON.stringify(quickstart)).not.toContain("ordinary-private-route.csv");
      expect(findForbiddenAggregateEgress(quickstart)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes unexpected safe-confirmation schema keys back to a valid JSON rerun", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1154-unexpected-r1150-"));
    try {
      const r1150Path = path.join(tmp, "r1150.json");
      await writeJson(r1150Path, r1150Fixture({ unexpectedKeys: true }));

      const { output } = await runR1154OrdinaryConsumerSafeAvailabilityActionPacket({
        outputDir: path.join(tmp, "out"),
        r1150Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "safe_availability_action_packet_waiting_on_valid_safe_confirmation",
        missingAttestationKeys: REQUIRED_ATTESTATION_KEYS,
        missingFeatureOnlySourceFamilyIds: FEATURE_ONLY_SOURCE_FAMILY_IDS,
        missingRequiredSourceFamilyIds: REQUIRED_SOURCE_FAMILY_IDS,
        nextAction: "rerun_safe_availability_confirmation_with_valid_json_object",
        r1150Conclusion: "safe_availability_confirmation_invalid",
        rowOwnerWorkType: "fill_safe_availability_confirmation",
        safeAvailabilityConfirmationStatus: "unexpected_keys",
      });
      expect(JSON.stringify(output)).not.toContain("privateHeaderHint");
      expect(JSON.stringify(output)).not.toContain("glucose_private_column");
      expect(JSON.stringify(output)).not.toContain(tmp);
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes feature-only lab-plus-wearable availability to the research-only context action", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1154-feature-only-"));
    try {
      const r1150Path = path.join(tmp, "r1150.json");
      await writeJson(r1150Path, r1150Fixture({ featureOnly: true }));

      const { output } = await runR1154OrdinaryConsumerSafeAvailabilityActionPacket({
        outputDir: path.join(tmp, "out"),
        r1150Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "safe_availability_action_packet_feature_only_context_available",
        featureOnlyCoverageContextReady: true,
        featureOnlyFillableTemplateArtifact: FEATURE_ONLY_FILLABLE_TEMPLATE_ARTIFACT,
        featureOnlyQuickstartArtifact: FEATURE_ONLY_QUICKSTART_ARTIFACT,
        featureOnlyQuickstartSafeFieldEditCount: FEATURE_ONLY_SAFE_CONFIRMATION_FIELD_PATHS.length,
        featureOnlyQuickstartSafeFieldEditPaths: FEATURE_ONLY_SAFE_CONFIRMATION_FIELD_PATHS,
        missingAggregateReadinessFactIds: ["outcomeLinked", "sameDenominator", "eventCountBand"],
        missingAttestationKeys: [],
        missingFeatureOnlySourceFamilyIds: [],
        missingRequiredSourceFamilyIds: ["outcome_linkage", "join_time_alignment"],
        nextAction: "run_r1153_feature_only_chain_with_safe_availability",
        outcomeLinkageRequiredForFeatureOnlyContext: false,
        ordinarySubmitterCompletionModeIds: ORDINARY_SUBMITTER_COMPLETION_MODE_IDS,
        ordinarySubmitterSafeCompletionChecklistItemIds: ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS,
        readyForOutcomeLinkedRecipeReadinessChain: false,
        rowOwnerWorkType: "run_feature_only_chain",
      });
      expect(output.safeAvailabilityActionPacket.readyForOutcomeLinkedRecipeReadinessChain).toBe(false);
      expect(output.safeAvailabilityActionPacket.featureOnlyCoverageContextReady).toBe(true);
      expect(output.safeAvailabilityActionPacket.commands.featureOnlyChainRunnerCommand).not.toContain(
        "MURPH_AGE_R1152_ORDINARY_CONSUMER_FEATURE_ONLY_COVERAGE_CONTEXT_PATH",
      );
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("routes complete outcome-linked availability to the recipe-readiness chain", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1154-ready-"));
    try {
      const r1150Path = path.join(tmp, "r1150.json");
      await writeJson(r1150Path, r1150Fixture({ ready: true }));

      const { output } = await runR1154OrdinaryConsumerSafeAvailabilityActionPacket({
        outputDir: path.join(tmp, "out"),
        r1150Path,
      });

      expect(output.summary).toMatchObject({
        conclusion: "safe_availability_action_packet_ready_for_outcome_linked_recipe_readiness",
        featureOnlyCoverageContextReady: true,
        featureOnlyFillableTemplateArtifact: FEATURE_ONLY_FILLABLE_TEMPLATE_ARTIFACT,
        featureOnlyQuickstartArtifact: FEATURE_ONLY_QUICKSTART_ARTIFACT,
        featureOnlyQuickstartSafeFieldEditCount: FEATURE_ONLY_SAFE_CONFIRMATION_FIELD_PATHS.length,
        featureOnlyQuickstartSafeFieldEditPaths: FEATURE_ONLY_SAFE_CONFIRMATION_FIELD_PATHS,
        missingAggregateReadinessFactIds: [],
        missingAttestationKeys: [],
        missingFeatureOnlySourceFamilyIds: [],
        missingRequiredSourceFamilyIds: [],
        nextAction: "run_r1144_recipe_readiness_chain_with_confirmed_availability",
        ordinarySubmitterCompletionModeIds: ORDINARY_SUBMITTER_COMPLETION_MODE_IDS,
        ordinarySubmitterSafeCompletionChecklistItemIds: ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS,
        readyForOutcomeLinkedRecipeReadinessChain: true,
        rowOwnerAssertionsConfirmed: true,
        rowOwnerWorkType: "run_outcome_linked_recipe_readiness",
      });
      expect(output.safeAvailabilityActionPacket.commands.outcomeLinkedRecipeReadinessCommand).toContain(
        "MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_PATH=<r1150-intake.json>",
      );
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
      expect(JSON.stringify(output)).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("rejects unsafe R1150 artifacts with a pathless error", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1154-unsafe-"));
    try {
      const r1150Path = path.join(tmp, "r1150.json");
      await writeJson(r1150Path, {
        ...r1150Fixture(),
        artifactBoundary: {
          ...safeBoundary(),
          rowValuesStored: true,
        },
      });

      await expect(runR1154OrdinaryConsumerSafeAvailabilityActionPacket({
        outputDir: path.join(tmp, "out"),
        r1150Path,
      })).rejects.toThrow("R1154 rejected unsafe r1150 input: 2 findings");

      let stderr = "";
      try {
        execFileSync("pnpm", [
          "exec",
          "tsx",
          path.join(process.cwd(), "scripts/murph-age/r1154-ordinary-consumer-safe-availability-action-packet.ts"),
        ], {
          encoding: "utf8",
          env: {
            ...process.env,
            MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_PATH: r1150Path,
            MURPH_AGE_R1154_OUTPUT_DIR: path.join(tmp, "out"),
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        if (error && typeof error === "object" && "stderr" in error) {
          stderr = String(error.stderr);
        }
      }
      expect(stderr).toContain("R1154 rejected unsafe r1150 input: 2 findings");
      expect(stderr).not.toContain(tmp);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1154-cli-"));
    try {
      const r1150Path = path.join(tmp, "r1150.json");
      await writeJson(r1150Path, r1150Fixture({ featureOnly: true }));

      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1154-ordinary-consumer-safe-availability-action-packet.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_PATH: r1150Path,
          MURPH_AGE_R1154_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        featureOnlyCoverageContextReady: boolean;
        featureOnlyQuickstartArtifact: string;
        featureOnlyQuickstartSafeFieldEditCount: number;
        featureOnlyQuickstartSafeFieldEditPaths: string[];
        missingFeatureOnlySourceFamilyIds: string[];
        missingRequiredSourceFamilyIds: string[];
        nextAction: string;
        ordinarySubmitterCompletionModeIds: string[];
        ordinarySubmitterSafeCompletionChecklistItemIds: string[];
        readyForOutcomeLinkedRecipeReadinessChain: boolean;
        rowLevelDataAcceptedByR1154: boolean;
        rowParsingPerformedByR1154: boolean;
        safeAvailabilityConfirmationStatus: string | null;
      };
      expect(summary).toMatchObject({
        conclusion: "safe_availability_action_packet_feature_only_context_available",
        featureOnlyCoverageContextReady: true,
        featureOnlyQuickstartArtifact: FEATURE_ONLY_QUICKSTART_ARTIFACT,
        featureOnlyQuickstartSafeFieldEditCount: FEATURE_ONLY_SAFE_CONFIRMATION_FIELD_PATHS.length,
        featureOnlyQuickstartSafeFieldEditPaths: FEATURE_ONLY_SAFE_CONFIRMATION_FIELD_PATHS,
        missingFeatureOnlySourceFamilyIds: [],
        missingRequiredSourceFamilyIds: ["outcome_linkage", "join_time_alignment"],
        nextAction: "run_r1153_feature_only_chain_with_safe_availability",
        ordinarySubmitterCompletionModeIds: ORDINARY_SUBMITTER_COMPLETION_MODE_IDS,
        ordinarySubmitterSafeCompletionChecklistItemIds: ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECK_IDS,
        readyForOutcomeLinkedRecipeReadinessChain: false,
        rowLevelDataAcceptedByR1154: false,
        rowParsingPerformedByR1154: false,
        safeAvailabilityConfirmationStatus: "available",
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

function r1150Fixture(
  options: { featureOnly?: boolean; ready?: boolean; unexpectedKeys?: boolean } = {},
): Record<string, unknown> {
  const missingAggregateReadinessFactIds = options.ready
    ? []
    : options.featureOnly
      ? ["outcomeLinked", "sameDenominator", "eventCountBand"]
      : REQUIRED_AGGREGATE_READINESS_FACT_IDS;
  const missingAttestationKeys = options.ready || options.featureOnly
    ? []
    : REQUIRED_ATTESTATION_KEYS;
  const missingFeatureOnlySourceFamilyIds = options.ready || options.featureOnly
    ? []
    : FEATURE_ONLY_SOURCE_FAMILY_IDS;
  const missingRequiredSourceFamilyIds = options.ready
    ? []
    : options.featureOnly
      ? ["outcome_linkage", "join_time_alignment"]
      : REQUIRED_SOURCE_FAMILY_IDS;
  return {
    artifactBoundary: safeBoundary(),
    packetId: "r1150-ordinary-consumer-safe-availability-confirmation-intake",
    productDisplayAuthorized: false,
    safeAvailabilityConfirmationIntake: {
      featureOnlyCoverageContextReady: options.ready === true || options.featureOnly === true,
      featureOnlyFillableTemplateArtifact: FEATURE_ONLY_FILLABLE_TEMPLATE_ARTIFACT,
      privateDetailsStored: false,
      rowLevelDataAcceptedByR1150: false,
    },
    schemaVersion: "murph-age-r1150-ordinary-consumer-safe-availability-confirmation-intake.v1",
    status: "research-local-aggregate-only",
    summary: {
      conclusion: options.ready
        ? "safe_availability_confirmation_ready_for_recipe_readiness_chain"
        : options.unexpectedKeys
          ? "safe_availability_confirmation_invalid"
          : options.featureOnly
            ? "safe_availability_confirmation_feature_only_ready_research_only"
            : "safe_availability_confirmation_not_provided",
      confirmationStatus: options.unexpectedKeys
        ? "unexpected_keys"
        : options.ready || options.featureOnly
          ? "available"
          : "missing",
      featureOnlyCoverageContextReady: options.ready === true || options.featureOnly === true,
      featureOnlyCoverageRequiresPreferredPair: true,
      featureOnlyTemplateArtifact: FEATURE_ONLY_FILLABLE_TEMPLATE_ARTIFACT,
      minimumFeaturePairRequired: FEATURE_ONLY_SOURCE_FAMILY_IDS,
      missingAggregateReadinessFactIds,
      missingAttestationKeys,
      missingFeatureOnlySourceFamilyIds,
      missingRequiredSourceFamilyIds,
      nextAction: options.ready
        ? "run_r1144_recipe_readiness_chain_with_confirmed_availability"
        : options.unexpectedKeys
          ? "rerun_safe_availability_confirmation_with_valid_json_object"
          : options.featureOnly
            ? "complete_safe_availability_confirmation_template"
            : "fill_safe_availability_confirmation_from_template",
      outcomeLinkageRequiredForFeatureOnlyContext: false,
      productDisplayAuthorized: false,
      r1149SubmitterKitFeatureOnlyGuardPresent: true,
      r1149SubmitterKitReadyForSafeConfirmation: true,
      readyForRecipeReadinessChain: options.ready === true,
      reviewGptRequiredNow: false,
      rowOwnerAssertionsConfirmed: options.ready || options.featureOnly ? true : null,
      rowLevelDataAcceptedByR1150: false,
      rowParsingPerformedByR1150: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
      templateArtifact: FULL_FILLABLE_TEMPLATE_ARTIFACT,
    },
  };
}

function safeBoundary(): Record<string, boolean> {
  return {
    aggregateOnly: true,
    availabilityConfirmationPathStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    confirmationReadErrorStored: false,
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
    rowParsingPerformedByR1150: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}
