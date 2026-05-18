import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1149_ORDINARY_CONSUMER_LAB_WEARABLE_SUBMISSION_KIT_SCHEMA_VERSION =
  "murph-age-r1149-ordinary-consumer-lab-wearable-submission-kit.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1149-ordinary-consumer-lab-wearable-submission-kit.latest.json";
const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first" as const;
const TARGET_AGE_BAND = "roughly_16_50" as const;
const RECOMMENDED_RECIPE_ID = "lab_plus_wearable_minimum_manifest" as const;
const EXPECTED_ROUTE_IDS = [
  "lab_glycemia_minimum_route",
  "wearable_activity_minimum_route",
] as const;
const REQUIRED_SOURCE_FAMILY_IDS = [
  "outcome_linkage",
  "join_time_alignment",
  "bloodwork_glycemia",
  "wearable_activity_daily",
] as const;
const OPTIONAL_ADD_ON_FAMILY_IDS = [
  "common_bloodwork_core",
  "vitals_body_context",
] as const;
const ACCEPTED_PRIVATE_TABLE_LAYOUTS = [
  "single_primary_table_fallback",
  "multi_table_or_explicit_refs",
] as const;
const REQUIRED_FIELD_REF_FALLBACKS = [
  "personJoinKey",
  "dateOrTimeKey",
  "outcomeEvent",
  "labGlycemia",
  "wearableActivity",
] as const;
const REQUIRED_TABLE_REF_FALLBACKS = [
  "primaryTableRef",
  "outcomeTableRef",
  "labTableRef",
  "wearableTableRef",
] as const;
const BLOCKED_PRIVATE_CONTENT = [
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
] as const;
const R1148_PRIVATE_CONFIG_INTAKE_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH=<partial-private-config.json> pnpm exec tsx scripts/murph-age/r1148-ordinary-consumer-post-confirmation-private-config-intake.ts" as const;
const R1142_PARTIAL_PRIVATE_CHAIN_RUNNER_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH=<availability-manifest.json> MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH=<partial-private-config.json> pnpm exec tsx scripts/murph-age/r1142-ordinary-consumer-partial-private-chain-runner.ts" as const;
const R1150_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_COMMAND =
  "MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_PATH=<safe-availability-confirmation.json> pnpm exec tsx scripts/murph-age/r1150-ordinary-consumer-safe-availability-confirmation-intake.ts" as const;
const R1151_FEATURE_ONLY_SUBMISSION_MODE_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1151-ordinary-consumer-feature-only-submission-mode.ts" as const;

const INPUTS = {
  r1146: {
    artifact: "r1146-ordinary-consumer-row-owner-route-action-packet.latest.json",
    packetId: "r1146-ordinary-consumer-row-owner-route-action-packet",
    schemaVersion: "murph-age-r1146-ordinary-consumer-row-owner-route-action-packet.v1",
  },
  r1147: {
    artifact: "r1147-ordinary-consumer-post-confirmation-private-config-packet.latest.json",
    packetId: "r1147-ordinary-consumer-post-confirmation-private-config-packet",
    schemaVersion: "murph-age-r1147-ordinary-consumer-post-confirmation-private-config-packet.v1",
  },
  r1148: {
    artifact: "r1148-ordinary-consumer-post-confirmation-private-config-intake.latest.json",
    packetId: "r1148-ordinary-consumer-post-confirmation-private-config-intake",
    schemaVersion: "murph-age-r1148-ordinary-consumer-post-confirmation-private-config-intake.v1",
  },
} as const;

type InputKey = keyof typeof INPUTS;
type ExpectedRouteId = typeof EXPECTED_ROUTE_IDS[number];
type RequiredSourceFamilyId = typeof REQUIRED_SOURCE_FAMILY_IDS[number];
type OptionalAddOnFamilyId = typeof OPTIONAL_ADD_ON_FAMILY_IDS[number];
type SourceFamilyId = RequiredSourceFamilyId | OptionalAddOnFamilyId;
type BlockedPrivateContent = typeof BLOCKED_PRIVATE_CONTENT[number];
type KitConclusion =
  | "ordinary_consumer_lab_wearable_submission_kit_ready_for_research_review"
  | "ordinary_consumer_lab_wearable_submission_kit_ready_to_run_real_route_metrics"
  | "ordinary_consumer_lab_wearable_submission_kit_waiting_on_feature_only_guard_refresh"
  | "ordinary_consumer_lab_wearable_submission_kit_waiting_on_post_confirmation_private_config_intake_refresh"
  | "ordinary_consumer_lab_wearable_submission_kit_waiting_on_private_config"
  | "ordinary_consumer_lab_wearable_submission_kit_waiting_on_private_config_completion"
  | "ordinary_consumer_lab_wearable_submission_kit_waiting_on_private_config_template"
  | "ordinary_consumer_lab_wearable_submission_kit_waiting_on_refresh"
  | "ordinary_consumer_lab_wearable_submission_kit_waiting_on_safe_availability_action_packet_refresh"
  | "ordinary_consumer_lab_wearable_submission_kit_waiting_on_safe_availability_confirmation"
  | "ordinary_consumer_lab_wearable_submission_kit_waiting_on_row_owner_confirmation";
type KitNextAction =
  | "complete_local_private_runner_config_slots"
  | "complete_safe_availability_confirmation_template"
  | "confirm_lab_plus_wearable_recipe_availability_assertions"
  | "fill_feature_only_coverage_context_template"
  | "fill_safe_availability_confirmation_from_template"
  | "fill_local_private_runner_config_from_r1147_template"
  | "refresh_r1146_r1147_r1148_before_submission_kit"
  | "refresh_r1148_post_confirmation_private_config_intake"
  | "refresh_r1151_feature_only_submission_mode"
  | "refresh_r1154_safe_availability_action_packet"
  | "review_real_lab_wearable_route_metrics_research_only"
  | "run_r1144_recipe_readiness_chain_with_confirmed_availability"
  | "run_r1150_safe_availability_confirmation_intake"
  | "run_r1153_feature_only_chain_with_safe_availability"
  | "run_r1147_after_row_owner_confirmation_for_template"
  | "run_r1142_for_real_lab_wearable_route_metrics"
  | "rerun_safe_availability_confirmation_with_valid_json_object";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface SourceFamilyChecklistItem {
  familyId: SourceFamilyId;
  priority: number;
  privateDetailsStored: false;
  requiredForRecommendedRecipe: boolean;
  role: string;
  safeInputKind: string;
  safeQuestion: string;
}

export interface R1149OrdinaryConsumerLabWearableSubmissionKitOptions {
  createdAt?: string;
  outputDir?: string;
  r1146Path?: string;
  r1147Path?: string;
  r1148Path?: string;
}

export interface R1149OrdinaryConsumerLabWearableSubmissionKitOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    privateConfigValuesStored: false;
    privateFieldRefValuesStored: false;
    privateFieldRefsStored: false;
    privateTableRefValuesStored: false;
    privateTableRefsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1149: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  ordinaryConsumerSubmissionKit: {
    acceptedPrivateTableLayouts: typeof ACCEPTED_PRIVATE_TABLE_LAYOUTS[number][];
    blockedPrivateContent: BlockedPrivateContent[];
    blockers: string[];
    commands: {
      featureOnlySubmissionModeCommand: typeof R1151_FEATURE_ONLY_SUBMISSION_MODE_COMMAND;
      partialPrivateChainRunnerCommand: string;
      postConfirmationPrivateConfigIntakeCommand: string;
      privateConfigTemplateArtifact: string | null;
      recommendedConfirmedRecipeCommand: string | null;
      safeAvailabilityConfirmationIntakeCommand: typeof R1150_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_COMMAND;
    };
    currentGateState: {
      privateConfigReadyForR1142: boolean | null;
      privateConfigStatus: string | null;
      privateConfigSuppliedToIntake: boolean | null;
      privateConfigTemplateReadyForFill: boolean | null;
      realLabWearableRouteMetricsRecorded: boolean | null;
      rowOwnerAssertionsConfirmed: boolean | null;
    };
    expectedRouteIds: ExpectedRouteId[];
    fallbackRecipeIds: string[];
    featureOnlySubmissionMode: {
      conclusion: string | null;
      featureOnlyCoverageContextAllowed: boolean | null;
      modelEvidencePromotionAllowed: boolean | null;
      outcomeLinkedEvidenceReady: boolean | null;
      privateDetailsStored: false;
      supportedFeatureFamilyIds: string[];
    };
    safeAvailabilityActionPacket: {
      conclusion: string | null;
      featureOnlyCoverageContextReady: boolean | null;
      featureOnlyQuickstartArtifact: string | null;
      featureOnlyQuickstartSafeFieldEditCount: number | null;
      featureOnlyQuickstartSafeFieldEditPaths: string[];
      minimumFeaturePairRequired: string[];
      missingFeatureOnlySourceFamilyIds: string[];
      missingRequiredSourceFamilyIds: string[];
      nextAction: string | null;
      outcomeLinkageRequiredForFeatureOnlyContext: boolean | null;
      privateDetailsStored: false;
      readyForOutcomeLinkedRecipeReadinessChain: boolean | null;
      rowLevelDataAcceptedByR1154: boolean | null;
      safeAvailabilityConfirmationStatus: string | null;
    };
    nextAction: KitNextAction;
    optionalAddOnFamilyIds: OptionalAddOnFamilyId[];
    preferredRecipeId: typeof RECOMMENDED_RECIPE_ID;
    privateConfigSlotChecklist: {
      missingAttestationKeys: string[];
      missingRouteIds: string[];
      missingRunnerFieldRefKeys: string[];
      missingRunnerTableRefKeys: string[];
      requiredPrivateFieldRefFamilies: string[];
      requiredPrivateTableRefs: string[];
      runnerConfigPrivateFieldRefKeys: string[];
      runnerConfigPrivateTableRefKeys: string[];
      runnerConfigRouteRunOrder: string[];
      runnerConfigSchemaVersion: string | null;
    };
    privateDetailsStored: false;
    requiredSourceFamilyIds: RequiredSourceFamilyId[];
    sourceFamilyChecklist: SourceFamilyChecklistItem[];
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
  packetId: "r1149-ordinary-consumer-lab-wearable-submission-kit";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1149_ORDINARY_CONSUMER_LAB_WEARABLE_SUBMISSION_KIT_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: KitConclusion;
    expectedRouteIds: ExpectedRouteId[];
    featureOnlyModeConclusion: string | null;
    featureOnlyModeModelEvidencePromotionAllowed: boolean | null;
    featureOnlyModeOutcomeLinkedEvidenceReady: boolean | null;
    featureOnlyModeSupportedFeatureFamilyIds: string[];
    nextAction: KitNextAction;
    optionalAddOnFamilyIds: OptionalAddOnFamilyId[];
    privateConfigReadyForR1142: boolean | null;
    privateConfigStatus: string | null;
    productDisplayAuthorized: false;
    readyForResearchReview: boolean;
    requiredSourceFamilyIds: RequiredSourceFamilyId[];
    reviewGptRequiredNow: false;
    rowOwnerAssertionsConfirmed: boolean | null;
    rowParsingPerformedByR1149: false;
    safeAvailabilityActionPacketConclusion: string | null;
    safeAvailabilityActionPacketFeatureOnlyCoverageContextReady: boolean | null;
    safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact: string | null;
    safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount: number | null;
    safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths: string[];
    safeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds: string[];
    safeAvailabilityActionPacketMissingRequiredSourceFamilyIds: string[];
    safeAvailabilityActionPacketNextAction: string | null;
    safeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain: boolean | null;
    safeAvailabilityActionPacketRowLevelDataAcceptedByR1154: boolean | null;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
    topBlocker: string | null;
  };
}

export async function runR1149OrdinaryConsumerLabWearableSubmissionKit(
  options: R1149OrdinaryConsumerLabWearableSubmissionKitOptions = {},
): Promise<{ output: R1149OrdinaryConsumerLabWearableSubmissionKitOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);
  const inputsReady = Object.entries(inputs).every(([key, value]) =>
    inputMatchesExpected(key as InputKey, value)
  );
  const rowOwnerAssertionsConfirmed = inputsReady
    ? readBooleanAt(inputs.r1147, ["summary", "rowOwnerAssertionsConfirmed"])
      ?? readBooleanAt(inputs.r1146, ["rowOwnerRouteActionPacket", "routeEvidenceState", "rowOwnerAssertionsConfirmed"])
    : null;
  const privateConfigTemplateReadyForFill = inputsReady
    ? readBooleanAt(inputs.r1147, ["summary", "privateConfigTemplateReadyForFill"])
    : null;
  const privateConfigReadyForR1142 = inputsReady
    ? readBooleanAt(inputs.r1148, ["summary", "readyForR1142"])
    : null;
  const privateConfigStatus = inputsReady
    ? readStringAt(inputs.r1148, ["summary", "privateConfigStatus"])
    : null;
  const privateConfigSuppliedToIntake = inputsReady
    ? readBooleanAt(inputs.r1148, ["summary", "privateConfigSuppliedToIntake"])
    : null;
  const realLabWearableRouteMetricsRecorded = inputsReady
    ? readBooleanAt(inputs.r1146, [
      "rowOwnerRouteActionPacket",
      "routeEvidenceState",
      "realLabWearableRouteMetricsRecorded",
    ])
    : null;
  const readyForResearchReview = inputsReady
    && readBooleanAt(inputs.r1146, ["summary", "readyToMarkComplete"]) === true
    && realLabWearableRouteMetricsRecorded === true;
  const r1146Blockers = inputsReady ? readStringArrayAt(inputs.r1146, ["summary", "blockers"]) : [];
  const featureOnlySubmissionMode = featureOnlySubmissionModeFor(inputs.r1146);
  const safeAvailabilityActionPacket = safeAvailabilityActionPacketFor(inputs.r1146);
  const blockers = blockersFor({
    inputsReady,
    privateConfigReadyForR1142,
    privateConfigSuppliedToIntake,
    privateConfigTemplateReadyForFill,
    r1146Blockers,
    readyForResearchReview,
    realLabWearableRouteMetricsRecorded,
    rowOwnerAssertionsConfirmed,
  });
  const conclusion = conclusionFor({
    blockers,
    inputsReady,
    privateConfigReadyForR1142,
    privateConfigSuppliedToIntake,
    readyForResearchReview,
  });
  const nextAction = nextActionFor(
    conclusion,
    safeAvailabilityActionPacketNextAction(safeAvailabilityActionPacket.nextAction),
  );
  const expectedRouteIds = expectedRouteIdsFor(inputs.r1147);
  const output: R1149OrdinaryConsumerLabWearableSubmissionKitOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    ordinaryConsumerSubmissionKit: {
      acceptedPrivateTableLayouts: [...ACCEPTED_PRIVATE_TABLE_LAYOUTS],
      blockedPrivateContent: [...BLOCKED_PRIVATE_CONTENT],
      blockers,
      commands: {
        featureOnlySubmissionModeCommand: R1151_FEATURE_ONLY_SUBMISSION_MODE_COMMAND,
        partialPrivateChainRunnerCommand: readStringAt(
          inputs.r1148,
          ["postConfirmationPrivateConfigIntake", "commands", "partialPrivateChainRunnerCommand"],
        ) ?? readStringAt(
          inputs.r1147,
          ["postConfirmationPrivateConfigPacket", "commands", "partialPrivateChainRunnerCommand"],
        ) ?? readStringAt(
          inputs.r1146,
          ["rowOwnerRouteActionPacket", "commands", "partialPrivateChainRunnerCommand"],
        ) ?? R1142_PARTIAL_PRIVATE_CHAIN_RUNNER_COMMAND,
        postConfirmationPrivateConfigIntakeCommand: readStringAt(
          inputs.r1148,
          ["postConfirmationPrivateConfigIntake", "commands", "postConfirmationPrivateConfigIntakeCommand"],
        ) ?? R1148_PRIVATE_CONFIG_INTAKE_COMMAND,
        privateConfigTemplateArtifact: readStringAt(
          inputs.r1147,
          ["summary", "privateConfigTemplateArtifact"],
        ),
        recommendedConfirmedRecipeCommand: readStringAt(
          inputs.r1146,
          ["rowOwnerRouteActionPacket", "commands", "recommendedConfirmedRecipeCommand"],
        ),
        safeAvailabilityConfirmationIntakeCommand: R1150_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_COMMAND,
      },
      currentGateState: {
        privateConfigReadyForR1142,
        privateConfigStatus,
        privateConfigSuppliedToIntake,
        privateConfigTemplateReadyForFill,
        realLabWearableRouteMetricsRecorded,
        rowOwnerAssertionsConfirmed,
      },
      expectedRouteIds,
      fallbackRecipeIds: inputsReady
        ? readStringArrayAt(inputs.r1146, ["summary", "fallbackRecipeIds"])
        : [],
      featureOnlySubmissionMode,
      safeAvailabilityActionPacket,
      nextAction,
      optionalAddOnFamilyIds: [...OPTIONAL_ADD_ON_FAMILY_IDS],
      preferredRecipeId: RECOMMENDED_RECIPE_ID,
      privateConfigSlotChecklist: {
        missingAttestationKeys: inputsReady
          ? readStringArrayAt(inputs.r1148, ["summary", "missingAttestationKeys"])
          : [],
        missingRouteIds: inputsReady
          ? readStringArrayAt(inputs.r1148, ["summary", "missingRouteIds"])
          : [],
        missingRunnerFieldRefKeys: inputsReady
          ? readStringArrayAt(inputs.r1148, ["summary", "missingRunnerFieldRefKeys"])
          : [],
        missingRunnerTableRefKeys: inputsReady
          ? readStringArrayAt(inputs.r1148, ["summary", "missingRunnerTableRefKeys"])
          : [],
        requiredPrivateFieldRefFamilies: requiredFieldRefsFor(inputs),
        requiredPrivateTableRefs: requiredTableRefsFor(inputs),
        runnerConfigPrivateFieldRefKeys: readStringArrayAt(
          inputs.r1147,
          ["summary", "runnerConfigPrivateFieldRefKeys"],
        ),
        runnerConfigPrivateTableRefKeys: readStringArrayAt(
          inputs.r1147,
          ["summary", "runnerConfigPrivateTableRefKeys"],
        ),
        runnerConfigRouteRunOrder: readStringArrayAt(inputs.r1147, ["summary", "runnerConfigRouteRunOrder"]),
        runnerConfigSchemaVersion: readStringAt(inputs.r1147, ["summary", "runnerConfigSchemaVersion"]),
      },
      privateDetailsStored: false,
      requiredSourceFamilyIds: [...REQUIRED_SOURCE_FAMILY_IDS],
      sourceFamilyChecklist: sourceFamilyChecklistFor(inputs.r1146),
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
    packetId: "r1149-ordinary-consumer-lab-wearable-submission-kit",
    productDisplayAuthorized: false,
    schemaVersion: R1149_ORDINARY_CONSUMER_LAB_WEARABLE_SUBMISSION_KIT_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      expectedRouteIds,
      featureOnlyModeConclusion: featureOnlySubmissionMode.conclusion,
      featureOnlyModeModelEvidencePromotionAllowed: featureOnlySubmissionMode.modelEvidencePromotionAllowed,
      featureOnlyModeOutcomeLinkedEvidenceReady: featureOnlySubmissionMode.outcomeLinkedEvidenceReady,
      featureOnlyModeSupportedFeatureFamilyIds: featureOnlySubmissionMode.supportedFeatureFamilyIds,
      nextAction,
      optionalAddOnFamilyIds: [...OPTIONAL_ADD_ON_FAMILY_IDS],
      privateConfigReadyForR1142,
      privateConfigStatus,
      productDisplayAuthorized: false,
      readyForResearchReview,
      requiredSourceFamilyIds: [...REQUIRED_SOURCE_FAMILY_IDS],
      reviewGptRequiredNow: false,
      rowOwnerAssertionsConfirmed,
      rowParsingPerformedByR1149: false,
      safeAvailabilityActionPacketConclusion: safeAvailabilityActionPacket.conclusion,
      safeAvailabilityActionPacketFeatureOnlyCoverageContextReady:
        safeAvailabilityActionPacket.featureOnlyCoverageContextReady,
      safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact:
        safeAvailabilityActionPacket.featureOnlyQuickstartArtifact,
      safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount:
        safeAvailabilityActionPacket.featureOnlyQuickstartSafeFieldEditCount,
      safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths:
        safeAvailabilityActionPacket.featureOnlyQuickstartSafeFieldEditPaths,
      safeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds:
        safeAvailabilityActionPacket.missingFeatureOnlySourceFamilyIds,
      safeAvailabilityActionPacketMissingRequiredSourceFamilyIds:
        safeAvailabilityActionPacket.missingRequiredSourceFamilyIds,
      safeAvailabilityActionPacketNextAction: safeAvailabilityActionPacket.nextAction,
      safeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain:
        safeAvailabilityActionPacket.readyForOutcomeLinkedRecipeReadinessChain,
      safeAvailabilityActionPacketRowLevelDataAcceptedByR1154:
        safeAvailabilityActionPacket.rowLevelDataAcceptedByR1154,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
      topBlocker: blockers[0] ?? null,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1149 ordinary consumer lab/wearable submission kit failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(
  options: R1149OrdinaryConsumerLabWearableSubmissionKitOptions,
): Promise<Record<InputKey, unknown | null>> {
  return {
    r1146: await readJsonIfPresent(options.r1146Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1146.artifact)),
    r1147: await readJsonIfPresent(options.r1147Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1147.artifact)),
    r1148: await readJsonIfPresent(options.r1148Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1148.artifact)),
  };
}

function blockersFor(input: {
  inputsReady: boolean;
  privateConfigReadyForR1142: boolean | null;
  privateConfigSuppliedToIntake: boolean | null;
  privateConfigTemplateReadyForFill: boolean | null;
  r1146Blockers: readonly string[];
  readyForResearchReview: boolean;
  realLabWearableRouteMetricsRecorded: boolean | null;
  rowOwnerAssertionsConfirmed: boolean | null;
}): string[] {
  if (!input.inputsReady) return ["refresh_submission_kit_inputs"];
  if (input.r1146Blockers.includes("feature_only_submission_model_evidence_guard_missing_or_unsafe")) {
    return ["feature_only_submission_model_evidence_guard_missing_or_unsafe"];
  }
  if (input.r1146Blockers.includes("safe_availability_action_packet_missing_or_unsafe")) {
    return ["safe_availability_action_packet_missing_or_unsafe"];
  }
  if (input.r1146Blockers.includes("post_confirmation_private_config_intake_safe_action_guard_missing_or_stale")) {
    return ["post_confirmation_private_config_intake_safe_action_guard_missing_or_stale"];
  }
  if (input.readyForResearchReview) return [];
  if (input.rowOwnerAssertionsConfirmed !== true) {
    return [
      "row_owner_availability_assertions_not_confirmed",
      "private_route_config_not_supplied",
      "real_lab_wearable_route_metrics_missing",
    ];
  }
  if (input.privateConfigTemplateReadyForFill !== true) {
    return [
      "private_config_template_not_ready",
      "private_route_config_not_supplied",
      "real_lab_wearable_route_metrics_missing",
    ];
  }
  if (input.privateConfigReadyForR1142 !== true) {
    return [
      input.privateConfigSuppliedToIntake === true
        ? "private_route_config_incomplete"
        : "private_route_config_not_supplied",
      "real_lab_wearable_route_metrics_missing",
    ];
  }
  if (input.realLabWearableRouteMetricsRecorded !== true) {
    return ["real_lab_wearable_route_metrics_missing"];
  }
  return [];
}

function conclusionFor(input: {
  blockers: readonly string[];
  inputsReady: boolean;
  privateConfigReadyForR1142: boolean | null;
  privateConfigSuppliedToIntake: boolean | null;
  readyForResearchReview: boolean;
}): KitConclusion {
  if (!input.inputsReady) return "ordinary_consumer_lab_wearable_submission_kit_waiting_on_refresh";
  if (input.blockers.includes("feature_only_submission_model_evidence_guard_missing_or_unsafe")) {
    return "ordinary_consumer_lab_wearable_submission_kit_waiting_on_feature_only_guard_refresh";
  }
  if (input.blockers.includes("safe_availability_action_packet_missing_or_unsafe")) {
    return "ordinary_consumer_lab_wearable_submission_kit_waiting_on_safe_availability_action_packet_refresh";
  }
  if (input.blockers.includes("post_confirmation_private_config_intake_safe_action_guard_missing_or_stale")) {
    return "ordinary_consumer_lab_wearable_submission_kit_waiting_on_post_confirmation_private_config_intake_refresh";
  }
  if (input.readyForResearchReview) return "ordinary_consumer_lab_wearable_submission_kit_ready_for_research_review";
  if (input.blockers.includes("row_owner_availability_assertions_not_confirmed")) {
    return "ordinary_consumer_lab_wearable_submission_kit_waiting_on_safe_availability_confirmation";
  }
  if (input.blockers.includes("private_config_template_not_ready")) {
    return "ordinary_consumer_lab_wearable_submission_kit_waiting_on_private_config_template";
  }
  if (input.privateConfigReadyForR1142 === true) {
    return "ordinary_consumer_lab_wearable_submission_kit_ready_to_run_real_route_metrics";
  }
  if (input.privateConfigSuppliedToIntake === true) {
    return "ordinary_consumer_lab_wearable_submission_kit_waiting_on_private_config_completion";
  }
  return "ordinary_consumer_lab_wearable_submission_kit_waiting_on_private_config";
}

function nextActionFor(
  conclusion: KitConclusion,
  safeAvailabilityActionPacketNextAction: KitNextAction | null,
): KitNextAction {
  if (conclusion === "ordinary_consumer_lab_wearable_submission_kit_waiting_on_refresh") {
    return "refresh_r1146_r1147_r1148_before_submission_kit";
  }
  if (conclusion === "ordinary_consumer_lab_wearable_submission_kit_waiting_on_feature_only_guard_refresh") {
    return "refresh_r1151_feature_only_submission_mode";
  }
  if (conclusion === "ordinary_consumer_lab_wearable_submission_kit_waiting_on_safe_availability_action_packet_refresh") {
    return "refresh_r1154_safe_availability_action_packet";
  }
  if (conclusion === "ordinary_consumer_lab_wearable_submission_kit_waiting_on_post_confirmation_private_config_intake_refresh") {
    return "refresh_r1148_post_confirmation_private_config_intake";
  }
  if (conclusion === "ordinary_consumer_lab_wearable_submission_kit_ready_for_research_review") {
    return "review_real_lab_wearable_route_metrics_research_only";
  }
  if (conclusion === "ordinary_consumer_lab_wearable_submission_kit_waiting_on_safe_availability_confirmation") {
    return safeAvailabilityActionPacketNextAction ?? "fill_safe_availability_confirmation_from_template";
  }
  if (conclusion === "ordinary_consumer_lab_wearable_submission_kit_waiting_on_private_config_template") {
    return "run_r1147_after_row_owner_confirmation_for_template";
  }
  if (conclusion === "ordinary_consumer_lab_wearable_submission_kit_waiting_on_private_config_completion") {
    return "complete_local_private_runner_config_slots";
  }
  if (conclusion === "ordinary_consumer_lab_wearable_submission_kit_ready_to_run_real_route_metrics") {
    return "run_r1142_for_real_lab_wearable_route_metrics";
  }
  return "fill_local_private_runner_config_from_r1147_template";
}

function sourceFamilyChecklistFor(r1146: unknown | null): SourceFamilyChecklistItem[] {
  const fromPacket = readObjectArrayAt(r1146, [
    "rowOwnerRouteActionPacket",
    "availabilityAssertionChecklist",
  ]);
  const byFamily = new Map(
    fromPacket.map((item) => [
      readStringAt(item, ["familyId"]),
      item,
    ]),
  );
  const required = REQUIRED_SOURCE_FAMILY_IDS.map((familyId, index) => {
    const packetItem = byFamily.get(familyId);
    return sourceFamilyChecklistItem({
      familyId,
      priority: readNumberAt(packetItem, ["priority"]) ?? index + 1,
      requiredForRecommendedRecipe: true,
      role: readStringAt(packetItem, ["role"]) ?? defaultSourceRoleFor(familyId),
      safeQuestion: readStringAt(packetItem, ["safeAssertionMeaning"]) ?? defaultSafeQuestionFor(familyId),
    });
  });
  const optional = OPTIONAL_ADD_ON_FAMILY_IDS.map((familyId, index) =>
    sourceFamilyChecklistItem({
      familyId,
      priority: REQUIRED_SOURCE_FAMILY_IDS.length + index + 1,
      requiredForRecommendedRecipe: false,
      role: defaultSourceRoleFor(familyId),
      safeQuestion: defaultSafeQuestionFor(familyId),
    })
  );
  return [...required, ...optional];
}

function sourceFamilyChecklistItem(input: {
  familyId: SourceFamilyId;
  priority: number;
  requiredForRecommendedRecipe: boolean;
  role: string;
  safeQuestion: string;
}): SourceFamilyChecklistItem {
  return {
    familyId: input.familyId,
    priority: input.priority,
    privateDetailsStored: false,
    requiredForRecommendedRecipe: input.requiredForRecommendedRecipe,
    role: input.role,
    safeInputKind: safeInputKindFor(input.familyId),
    safeQuestion: input.safeQuestion,
  };
}

function safeInputKindFor(familyId: SourceFamilyId): string {
  if (familyId === "outcome_linkage") return "outcome_or_followup_source_linkable_to_same_people";
  if (familyId === "join_time_alignment") return "stable_person_and_date_or_time_alignment";
  if (familyId === "bloodwork_glycemia") return "glycemia_fields_from_ordinary_bloodwork_or_lab_portal_export";
  if (familyId === "wearable_activity_daily") return "daily_activity_rows_from_watch_phone_or_wearable_export";
  if (familyId === "common_bloodwork_core") return "additional_common_bloodwork_fields_if_available";
  return "basic_body_or_vitals_context_if_available";
}

function defaultSourceRoleFor(familyId: SourceFamilyId): string {
  if (familyId === "outcome_linkage") return "required_outcome_or_followup_linkage";
  if (familyId === "join_time_alignment") return "required_person_and_time_alignment";
  if (familyId === "bloodwork_glycemia") return "primary_bloodwork_lab_input";
  if (familyId === "wearable_activity_daily") return "primary_wearable_input";
  if (familyId === "common_bloodwork_core") return "optional_bloodwork_add_on";
  return "optional_body_or_vitals_context";
}

function defaultSafeQuestionFor(familyId: SourceFamilyId): string {
  if (familyId === "outcome_linkage") {
    return "Can an outcome or follow-up source be linked to the same eligible people as labs and wearable data?";
  }
  if (familyId === "join_time_alignment") {
    return "Can the available sources be joined and aligned by person plus date or time without exposing join values?";
  }
  if (familyId === "bloodwork_glycemia") {
    return "Does ordinary bloodwork include glycemia-related lab fields in an export or spreadsheet?";
  }
  if (familyId === "wearable_activity_daily") {
    return "Is daily wearable activity data available from a watch, phone, or wearable export?";
  }
  if (familyId === "common_bloodwork_core") {
    return "Is a broader common bloodwork core available beyond glycemia?";
  }
  return "Is basic body or vitals context available alongside labs and wearable data?";
}

function expectedRouteIdsFor(r1147: unknown | null): ExpectedRouteId[] {
  const fromR1147 = readStringArrayAt(r1147, ["summary", "runnerConfigRouteRunOrder"])
    .filter(isExpectedRouteId);
  if (fromR1147.length > 0) return Array.from(new Set(fromR1147));
  return [...EXPECTED_ROUTE_IDS];
}

function requiredFieldRefsFor(inputs: Record<InputKey, unknown | null>): string[] {
  const fromR1147 = readStringArrayAt(inputs.r1147, ["summary", "requiredPrivateFieldRefFamilies"]);
  if (fromR1147.length > 0) return fromR1147;
  const fromR1146 = readStringArrayAt(inputs.r1146, [
    "rowOwnerRouteActionPacket",
    "expectedPrivateConfigAfterConfirmation",
    "fieldRefFamilies",
  ]);
  return fromR1146.length > 0 ? fromR1146 : [...REQUIRED_FIELD_REF_FALLBACKS];
}

function requiredTableRefsFor(inputs: Record<InputKey, unknown | null>): string[] {
  const fromR1147 = readStringArrayAt(inputs.r1147, ["summary", "requiredPrivateTableRefs"]);
  if (fromR1147.length > 0) return fromR1147;
  const fromR1146 = readStringArrayAt(inputs.r1146, [
    "rowOwnerRouteActionPacket",
    "expectedPrivateConfigAfterConfirmation",
    "tableRefs",
  ]);
  return fromR1146.length > 0 ? fromR1146 : [...REQUIRED_TABLE_REF_FALLBACKS];
}

function featureOnlySubmissionModeFor(
  r1146: unknown | null,
): R1149OrdinaryConsumerLabWearableSubmissionKitOutput["ordinaryConsumerSubmissionKit"]["featureOnlySubmissionMode"] {
  return {
    conclusion: readStringAt(r1146, ["rowOwnerRouteActionPacket", "featureOnlySubmissionMode", "conclusion"]),
    featureOnlyCoverageContextAllowed: readBooleanAt(
      r1146,
      ["rowOwnerRouteActionPacket", "featureOnlySubmissionMode", "featureOnlyCoverageContextAllowed"],
    ),
    modelEvidencePromotionAllowed: readBooleanAt(
      r1146,
      ["rowOwnerRouteActionPacket", "featureOnlySubmissionMode", "modelEvidencePromotionAllowed"],
    ),
    outcomeLinkedEvidenceReady: readBooleanAt(
      r1146,
      ["rowOwnerRouteActionPacket", "featureOnlySubmissionMode", "outcomeLinkedEvidenceReady"],
    ),
    privateDetailsStored: false,
    supportedFeatureFamilyIds: readStringArrayAt(
      r1146,
      ["rowOwnerRouteActionPacket", "featureOnlySubmissionMode", "supportedFeatureFamilyIds"],
    ),
  };
}

function safeAvailabilityActionPacketFor(
  r1146: unknown | null,
): R1149OrdinaryConsumerLabWearableSubmissionKitOutput["ordinaryConsumerSubmissionKit"]["safeAvailabilityActionPacket"] {
  return {
    conclusion: readStringAt(r1146, ["rowOwnerRouteActionPacket", "safeAvailabilityActionPacket", "conclusion"]),
    featureOnlyCoverageContextReady: readBooleanAt(
      r1146,
      ["rowOwnerRouteActionPacket", "safeAvailabilityActionPacket", "featureOnlyCoverageContextReady"],
    ),
    featureOnlyQuickstartArtifact: readStringAt(
      r1146,
      ["rowOwnerRouteActionPacket", "safeAvailabilityActionPacket", "featureOnlyQuickstartArtifact"],
    ),
    featureOnlyQuickstartSafeFieldEditCount: readNumberAt(
      r1146,
      ["rowOwnerRouteActionPacket", "safeAvailabilityActionPacket", "featureOnlyQuickstartSafeFieldEditCount"],
    ),
    featureOnlyQuickstartSafeFieldEditPaths: readStringArrayAt(
      r1146,
      ["rowOwnerRouteActionPacket", "safeAvailabilityActionPacket", "featureOnlyQuickstartSafeFieldEditPaths"],
    ),
    minimumFeaturePairRequired: readStringArrayAt(
      r1146,
      ["rowOwnerRouteActionPacket", "safeAvailabilityActionPacket", "minimumFeaturePairRequired"],
    ),
    missingFeatureOnlySourceFamilyIds: readStringArrayAt(
      r1146,
      ["rowOwnerRouteActionPacket", "safeAvailabilityActionPacket", "missingFeatureOnlySourceFamilyIds"],
    ),
    missingRequiredSourceFamilyIds: readStringArrayAt(
      r1146,
      ["rowOwnerRouteActionPacket", "safeAvailabilityActionPacket", "missingRequiredSourceFamilyIds"],
    ),
    nextAction: readStringAt(r1146, ["rowOwnerRouteActionPacket", "safeAvailabilityActionPacket", "nextAction"]),
    outcomeLinkageRequiredForFeatureOnlyContext: readBooleanAt(
      r1146,
      ["rowOwnerRouteActionPacket", "safeAvailabilityActionPacket", "outcomeLinkageRequiredForFeatureOnlyContext"],
    ),
    privateDetailsStored: false,
    readyForOutcomeLinkedRecipeReadinessChain: readBooleanAt(
      r1146,
      ["rowOwnerRouteActionPacket", "safeAvailabilityActionPacket", "readyForOutcomeLinkedRecipeReadinessChain"],
    ),
    rowLevelDataAcceptedByR1154: readBooleanAt(
      r1146,
      ["rowOwnerRouteActionPacket", "safeAvailabilityActionPacket", "rowLevelDataAcceptedByR1154"],
    ),
    safeAvailabilityConfirmationStatus: readStringAt(
      r1146,
      ["rowOwnerRouteActionPacket", "safeAvailabilityActionPacket", "safeAvailabilityConfirmationStatus"],
    ),
  };
}

function safeAvailabilityActionPacketNextAction(nextAction: string | null): KitNextAction | null {
  switch (nextAction) {
    case "complete_safe_availability_confirmation_template":
    case "fill_feature_only_coverage_context_template":
    case "fill_safe_availability_confirmation_from_template":
    case "refresh_r1154_safe_availability_action_packet":
    case "run_r1144_recipe_readiness_chain_with_confirmed_availability":
    case "run_r1150_safe_availability_confirmation_intake":
    case "run_r1153_feature_only_chain_with_safe_availability":
    case "rerun_safe_availability_confirmation_with_valid_json_object":
      return nextAction;
    default:
      return null;
  }
}

function summarizeInputs(inputs: Record<InputKey, unknown | null>): Record<InputKey, ArtifactSummary> {
  return {
    r1146: summarizeInput("r1146", inputs.r1146),
    r1147: summarizeInput("r1147", inputs.r1147),
    r1148: summarizeInput("r1148", inputs.r1148),
  };
}

function summarizeInput(key: InputKey, value: unknown | null): ArtifactSummary {
  const expected = INPUTS[key];
  return {
    artifact: expected.artifact,
    packetId: readStringAt(value, ["packetId"]) === expected.packetId ? expected.packetId : null,
    schemaVersion: readStringAt(value, ["schemaVersion"]) === expected.schemaVersion
      ? expected.schemaVersion
      : null,
    status: value ? "available" : "missing",
  };
}

function inputMatchesExpected(key: InputKey, value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === INPUTS[key].packetId
    && readStringAt(value, ["schemaVersion"]) === INPUTS[key].schemaVersion;
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1149 rejected unsafe ${key} input: ${formatFindingCount(findings)}`);
    }
  }
}

function safeBoundary(): R1149OrdinaryConsumerLabWearableSubmissionKitOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
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
    rowParsingPerformedByR1149: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

function readAt(value: unknown | null, pathParts: readonly string[]): unknown {
  let cursor: unknown = value;
  for (const part of pathParts) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function readBooleanAt(value: unknown | null, pathParts: readonly string[]): boolean | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "boolean" ? resolved : null;
}

function readNumberAt(value: unknown | null, pathParts: readonly string[]): number | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "number" && Number.isFinite(resolved) ? resolved : null;
}

function readStringAt(value: unknown | null, pathParts: readonly string[]): string | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
}

function readStringArrayAt(value: unknown | null, pathParts: readonly string[]): string[] {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved)
    ? resolved.filter((item): item is string => typeof item === "string")
    : [];
}

function readObjectArrayAt(value: unknown | null, pathParts: readonly string[]): Record<string, unknown>[] {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved) ? resolved.filter(isRecord) : [];
}

function isExpectedRouteId(value: string): value is ExpectedRouteId {
  return EXPECTED_ROUTE_IDS.some((routeId) => routeId === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function formatFindingCount(findings: readonly unknown[]): string {
  return `${findings.length} finding${findings.length === 1 ? "" : "s"}`;
}

async function main(): Promise<void> {
  const { output } = await runR1149OrdinaryConsumerLabWearableSubmissionKit({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1146Path: process.env.MURPH_AGE_R1146_ORDINARY_CONSUMER_ROW_OWNER_ROUTE_ACTION_PACKET_PATH,
    r1147Path: process.env.MURPH_AGE_R1147_ORDINARY_CONSUMER_POST_CONFIRMATION_PRIVATE_CONFIG_PACKET_PATH,
    r1148Path: process.env.MURPH_AGE_R1148_ORDINARY_CONSUMER_POST_CONFIRMATION_PRIVATE_CONFIG_INTAKE_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    featureOnlyModeConclusion: output.summary.featureOnlyModeConclusion,
    featureOnlyModeModelEvidencePromotionAllowed: output.summary.featureOnlyModeModelEvidencePromotionAllowed,
    featureOnlyModeOutcomeLinkedEvidenceReady: output.summary.featureOnlyModeOutcomeLinkedEvidenceReady,
    featureOnlyModeSupportedFeatureFamilyIds: output.summary.featureOnlyModeSupportedFeatureFamilyIds,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    privateConfigReadyForR1142: output.summary.privateConfigReadyForR1142,
    privateConfigStatus: output.summary.privateConfigStatus,
    readyForResearchReview: output.summary.readyForResearchReview,
    requiredSourceFamilyIds: output.summary.requiredSourceFamilyIds,
    rowOwnerAssertionsConfirmed: output.summary.rowOwnerAssertionsConfirmed,
    safeAvailabilityActionPacketConclusion: output.summary.safeAvailabilityActionPacketConclusion,
    safeAvailabilityActionPacketFeatureOnlyCoverageContextReady:
      output.summary.safeAvailabilityActionPacketFeatureOnlyCoverageContextReady,
    safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact:
      output.summary.safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact,
    safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount:
      output.summary.safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount,
    safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths:
      output.summary.safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths,
    safeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds:
      output.summary.safeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds,
    safeAvailabilityActionPacketMissingRequiredSourceFamilyIds:
      output.summary.safeAvailabilityActionPacketMissingRequiredSourceFamilyIds,
    safeAvailabilityActionPacketNextAction: output.summary.safeAvailabilityActionPacketNextAction,
    safeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain:
      output.summary.safeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain,
    safeAvailabilityActionPacketRowLevelDataAcceptedByR1154:
      output.summary.safeAvailabilityActionPacketRowLevelDataAcceptedByR1154,
    topBlocker: output.summary.topBlocker,
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1149 ordinary consumer lab/wearable submission kit failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
