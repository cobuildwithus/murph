import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1146_ORDINARY_CONSUMER_ROW_OWNER_ROUTE_ACTION_PACKET_SCHEMA_VERSION =
  "murph-age-r1146-ordinary-consumer-row-owner-route-action-packet.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1146-ordinary-consumer-row-owner-route-action-packet.latest.json";
const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first" as const;
const TARGET_AGE_BAND = "roughly_16_50" as const;
const RECOMMENDED_RECIPE_ID = "lab_plus_wearable_minimum_manifest" as const;
const FALLBACK_RECIPE_IDS = [
  "lab_glycemia_minimum_manifest",
  "wearable_activity_minimum_manifest",
] as const;
const FULL_ROUTE_ADD_ON_FAMILY_IDS = [
  "common_bloodwork_core",
  "vitals_body_context",
] as const;
const RECOMMENDED_ASSERTION_FAMILIES = [
  {
    familyId: "outcome_linkage",
    priority: 1,
    role: "required_outcome_or_followup_linkage",
    safeAssertionMeaning: "An outcome or follow-up source can be linked to the same eligible people as labs and wearable data.",
  },
  {
    familyId: "join_time_alignment",
    priority: 2,
    role: "required_person_and_time_alignment",
    safeAssertionMeaning: "Sources can be joined and aligned by person plus date or time without exposing join values.",
  },
  {
    familyId: "bloodwork_glycemia",
    priority: 3,
    role: "primary_bloodwork_lab_input",
    safeAssertionMeaning: "Ordinary bloodwork includes glycemia-related lab fields in an export or spreadsheet.",
  },
  {
    familyId: "wearable_activity_daily",
    priority: 4,
    role: "primary_wearable_input",
    safeAssertionMeaning: "Daily wearable activity data is available from a watch, phone, or wearable export.",
  },
] as const;
const EXPECTED_PRIVATE_FIELD_REF_FAMILIES_AFTER_CONFIRMATION = [
  "personJoinKey",
  "dateOrTimeKey",
  "outcomeEvent",
  "labGlycemia",
  "wearableActivity",
] as const;
const EXPECTED_PRIVATE_TABLE_REFS_AFTER_CONFIRMATION = [
  "primaryTableRef",
  "outcomeTableRef",
  "labTableRef",
  "wearableTableRef",
] as const;

const INPUTS = {
  r1135: {
    artifact: "r1135-ordinary-consumer-availability-manifest-packet.latest.json",
    packetId: "r1135-ordinary-consumer-availability-manifest-packet",
    schemaVersion: "murph-age-r1135-ordinary-consumer-availability-manifest-packet.v1",
  },
  r1145: {
    artifact: "r1145-ordinary-consumer-current-chain-completion-audit.latest.json",
    packetId: "r1145-ordinary-consumer-current-chain-completion-audit",
    schemaVersion: "murph-age-r1145-ordinary-consumer-current-chain-completion-audit.v1",
  },
} as const;

type InputKey = keyof typeof INPUTS;
type PacketConclusion =
  | "ordinary_row_owner_route_action_packet_ready_for_research_review"
  | "ordinary_row_owner_route_action_packet_waiting_on_feature_only_guard_refresh"
  | "ordinary_row_owner_route_action_packet_waiting_on_post_confirmation_private_config_intake_refresh"
  | "ordinary_row_owner_route_action_packet_waiting_on_private_route_config"
  | "ordinary_row_owner_route_action_packet_waiting_on_real_route_metrics"
  | "ordinary_row_owner_route_action_packet_waiting_on_refresh"
  | "ordinary_row_owner_route_action_packet_waiting_on_safe_availability_action_packet_refresh"
  | "ordinary_row_owner_route_action_packet_waiting_on_safe_availability_confirmation"
  | "ordinary_row_owner_route_action_packet_waiting_on_row_owner_availability_confirmation";
type PacketNextAction =
  | "complete_safe_availability_confirmation_template"
  | "confirm_recommended_lab_plus_wearable_recipe_availability_assertions"
  | "fill_feature_only_coverage_context_template"
  | "fill_safe_availability_confirmation_from_template"
  | "fill_private_route_config_for_recommended_lab_wearable_routes"
  | "refresh_r1135_r1145_before_row_owner_action_packet"
  | "refresh_r1148_post_confirmation_private_config_intake"
  | "refresh_r1151_feature_only_submission_mode"
  | "refresh_r1154_safe_availability_action_packet"
  | "review_real_lab_wearable_route_metrics_research_only"
  | "run_r1144_recipe_readiness_chain_with_confirmed_availability"
  | "run_r1150_safe_availability_confirmation_intake"
  | "run_r1153_feature_only_chain_with_safe_availability"
  | "run_r1142_for_real_lab_wearable_route_metrics"
  | "rerun_safe_availability_confirmation_with_valid_json_object";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface AvailabilityAssertionChecklistItem {
  familyId: typeof RECOMMENDED_ASSERTION_FAMILIES[number]["familyId"];
  priority: number;
  privateDetailsStored: false;
  requiredForRecommendedRecipe: true;
  role: string;
  safeAssertionMeaning: string;
}

interface RouteRecipeSummary {
  countBandFloors: {
    eventCountBand: string | null;
    usableRecordCountBand: string | null;
  };
  expectedEligiblePartialRouteIds: string[];
  expectedFullSupportedRouteReady: boolean | null;
  primarySubmitterInputFamilyIds: string[];
  productDisplayAuthorized: false;
  recipeId: string;
  recipeRouteGroupId: string | null;
  routeKind: string | null;
  routeUse: string | null;
  sourceFamiliesToDeclareAvailable: string[];
  sourceFamiliesToDeclareUnavailable: string[];
  targetAgeBand: typeof TARGET_AGE_BAND;
}

export interface R1146OrdinaryConsumerRowOwnerRouteActionPacketOptions {
  createdAt?: string;
  outputDir?: string;
  r1135Path?: string;
  r1145Path?: string;
}

export interface R1146OrdinaryConsumerRowOwnerRouteActionPacketOutput {
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
    privateFieldRefsStored: false;
    privateTableRefsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1146: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  packetId: "r1146-ordinary-consumer-row-owner-route-action-packet";
  productDisplayAuthorized: false;
  rowOwnerRouteActionPacket: {
    availabilityAssertionChecklist: AvailabilityAssertionChecklistItem[];
    blockers: string[];
    commands: {
      partialPrivateChainRunnerCommand: string | null;
      recipeReadinessChainRunnerCommand: string | null;
      recommendedConfirmedRecipeCommand: string | null;
    };
    expectedPrivateConfigAfterConfirmation: {
      fieldRefFamilies: string[];
      tableRefs: string[];
    };
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
    fullRouteAddOnFamilyIds: string[];
    goalAchieved: boolean;
    nextAction: PacketNextAction;
    privateDetailsStored: false;
    recommendedRecipe: RouteRecipeSummary | null;
    readyToMarkComplete: boolean;
    routeEvidenceState: {
      privateRouteConfigReadyForR1142: boolean | null;
      privateRouteConfigSupplied: boolean | null;
      privateRouteConfigSuppliedToIntake: boolean | null;
      privateRouteConfigStatus: string | null;
      realLabWearableRouteMetricsRecorded: boolean | null;
      rowOwnerAssertionsConfirmed: boolean | null;
    };
    routeRecipeFallbacks: RouteRecipeSummary[];
    selectedRecommendedRecipeId: typeof RECOMMENDED_RECIPE_ID;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
  schemaVersion: typeof R1146_ORDINARY_CONSUMER_ROW_OWNER_ROUTE_ACTION_PACKET_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    blockers: string[];
    conclusion: PacketConclusion;
    fallbackRecipeIds: string[];
    featureOnlyModeConclusion: string | null;
    featureOnlyModeModelEvidencePromotionAllowed: boolean | null;
    featureOnlyModeOutcomeLinkedEvidenceReady: boolean | null;
    featureOnlyModeSupportedFeatureFamilyIds: string[];
    goalAchieved: boolean;
    nextAction: PacketNextAction;
    privateRouteConfigReadyForR1142: boolean | null;
    privateRouteConfigStatus: string | null;
    privateRouteConfigSuppliedToIntake: boolean | null;
    productDisplayAuthorized: false;
    readyToMarkComplete: boolean;
    recommendedConfirmedRecipeCommandAvailable: boolean;
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1146: false;
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
    selectedRecommendedRecipeId: typeof RECOMMENDED_RECIPE_ID;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
}

export async function runR1146OrdinaryConsumerRowOwnerRouteActionPacket(
  options: R1146OrdinaryConsumerRowOwnerRouteActionPacketOptions = {},
): Promise<{ output: R1146OrdinaryConsumerRowOwnerRouteActionPacketOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);
  const requiredInputsReady = Object.entries(inputs).every(([key, value]) =>
    inputMatchesExpected(key as InputKey, value)
  );
  const blockers = requiredInputsReady
    ? readStringArrayAt(inputs.r1145, ["completionAudit", "blockers"])
    : ["refresh_current_chain_action_packet_inputs"];
  const goalAchieved = requiredInputsReady && readBooleanAt(inputs.r1145, ["summary", "goalAchieved"]) === true;
  const readyToMarkComplete = requiredInputsReady
    && readBooleanAt(inputs.r1145, ["summary", "readyToMarkComplete"]) === true;
  const recipeReadinessChainRunnerCommand = readStringAt(
    inputs.r1145,
    ["completionAudit", "commands", "recipeReadinessChainRunnerCommand"],
  ) ?? readStringAt(inputs.r1135, ["summary", "recipeReadinessChainRunnerCommand"]);
  const recommendedConfirmedRecipeCommand = commandForRecipe(
    recipeReadinessChainRunnerCommand,
    RECOMMENDED_RECIPE_ID,
  );
  const featureOnlySubmissionMode = featureOnlySubmissionModeFor(inputs.r1145);
  const safeAvailabilityActionPacket = safeAvailabilityActionPacketFor(inputs.r1145);
  const nextAction = nextActionFor({
    blockers,
    goalAchieved,
    ready: requiredInputsReady,
    safeAvailabilityActionPacketNextAction: safeAvailabilityActionPacketNextAction(
      safeAvailabilityActionPacket.nextAction,
    ),
  });
  const output: R1146OrdinaryConsumerRowOwnerRouteActionPacketOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1146-ordinary-consumer-row-owner-route-action-packet",
    productDisplayAuthorized: false,
    rowOwnerRouteActionPacket: {
      availabilityAssertionChecklist: availabilityAssertionChecklist(),
      blockers,
      commands: {
        partialPrivateChainRunnerCommand: readStringAt(
          inputs.r1145,
          ["completionAudit", "commands", "partialPrivateChainRunnerCommand"],
        ) ?? readStringAt(inputs.r1135, ["summary", "partialPrivateChainRunnerCommand"]),
        recipeReadinessChainRunnerCommand,
        recommendedConfirmedRecipeCommand,
      },
      expectedPrivateConfigAfterConfirmation: {
        fieldRefFamilies: [...EXPECTED_PRIVATE_FIELD_REF_FAMILIES_AFTER_CONFIRMATION],
        tableRefs: [...EXPECTED_PRIVATE_TABLE_REFS_AFTER_CONFIRMATION],
      },
      fallbackRecipeIds: [...FALLBACK_RECIPE_IDS],
      featureOnlySubmissionMode,
      safeAvailabilityActionPacket,
      fullRouteAddOnFamilyIds: [...FULL_ROUTE_ADD_ON_FAMILY_IDS],
      goalAchieved,
      nextAction,
      privateDetailsStored: false,
      recommendedRecipe: summarizeRecipe(inputs.r1135, RECOMMENDED_RECIPE_ID),
      readyToMarkComplete,
      routeEvidenceState: {
        privateRouteConfigReadyForR1142: readBooleanAt(
          inputs.r1145,
          ["completionAudit", "routeEvidenceState", "privateRouteConfigReadyForR1142"],
        ),
        privateRouteConfigSupplied: readBooleanAt(
          inputs.r1145,
          ["completionAudit", "routeEvidenceState", "privateRouteConfigSupplied"],
        ),
        privateRouteConfigSuppliedToIntake: readBooleanAt(
          inputs.r1145,
          ["completionAudit", "routeEvidenceState", "privateRouteConfigSuppliedToIntake"],
        ),
        privateRouteConfigStatus: readStringAt(
          inputs.r1145,
          ["completionAudit", "routeEvidenceState", "privateRouteConfigStatus"],
        ),
        realLabWearableRouteMetricsRecorded: readBooleanAt(
          inputs.r1145,
          ["completionAudit", "routeEvidenceState", "realLabWearableRouteMetricsRecorded"],
        ),
        rowOwnerAssertionsConfirmed: readBooleanAt(
          inputs.r1145,
          ["completionAudit", "routeEvidenceState", "rowOwnerAssertionsConfirmed"],
        ),
      },
      routeRecipeFallbacks: FALLBACK_RECIPE_IDS
        .map((recipeId) => summarizeRecipe(inputs.r1135, recipeId))
        .filter((recipe): recipe is RouteRecipeSummary => recipe !== null),
      selectedRecommendedRecipeId: RECOMMENDED_RECIPE_ID,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
    schemaVersion: R1146_ORDINARY_CONSUMER_ROW_OWNER_ROUTE_ACTION_PACKET_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      blockers,
      conclusion: conclusionFor({ blockers, goalAchieved, ready: requiredInputsReady }),
      fallbackRecipeIds: [...FALLBACK_RECIPE_IDS],
      featureOnlyModeConclusion: featureOnlySubmissionMode.conclusion,
      featureOnlyModeModelEvidencePromotionAllowed: featureOnlySubmissionMode.modelEvidencePromotionAllowed,
      featureOnlyModeOutcomeLinkedEvidenceReady: featureOnlySubmissionMode.outcomeLinkedEvidenceReady,
      featureOnlyModeSupportedFeatureFamilyIds: featureOnlySubmissionMode.supportedFeatureFamilyIds,
      goalAchieved,
      nextAction,
      privateRouteConfigReadyForR1142: readBooleanAt(
        inputs.r1145,
        ["completionAudit", "routeEvidenceState", "privateRouteConfigReadyForR1142"],
      ),
      privateRouteConfigStatus: readStringAt(
        inputs.r1145,
        ["completionAudit", "routeEvidenceState", "privateRouteConfigStatus"],
      ),
      privateRouteConfigSuppliedToIntake: readBooleanAt(
        inputs.r1145,
        ["completionAudit", "routeEvidenceState", "privateRouteConfigSuppliedToIntake"],
      ),
      productDisplayAuthorized: false,
      readyToMarkComplete,
      recommendedConfirmedRecipeCommandAvailable: recommendedConfirmedRecipeCommand !== null,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1146: false,
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
      selectedRecommendedRecipeId: RECOMMENDED_RECIPE_ID,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1146 row-owner route action packet failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function nextActionFor(input: {
  blockers: readonly string[];
  goalAchieved: boolean;
  ready: boolean;
  safeAvailabilityActionPacketNextAction: PacketNextAction | null;
}): PacketNextAction {
  if (!input.ready) return "refresh_r1135_r1145_before_row_owner_action_packet";
  if (input.goalAchieved) return "review_real_lab_wearable_route_metrics_research_only";
  if (input.blockers.includes("feature_only_submission_model_evidence_guard_missing_or_unsafe")) {
    return "refresh_r1151_feature_only_submission_mode";
  }
  if (input.blockers.includes("safe_availability_action_packet_missing_or_unsafe")) {
    return "refresh_r1154_safe_availability_action_packet";
  }
  if (input.blockers.includes("post_confirmation_private_config_intake_safe_action_guard_missing_or_stale")) {
    return "refresh_r1148_post_confirmation_private_config_intake";
  }
  if (input.blockers.includes("row_owner_availability_assertions_not_confirmed")) {
    return input.safeAvailabilityActionPacketNextAction
      ?? "confirm_recommended_lab_plus_wearable_recipe_availability_assertions";
  }
  if (
    input.blockers.includes("private_route_config_not_supplied")
    || input.blockers.includes("private_route_config_incomplete")
  ) {
    return "fill_private_route_config_for_recommended_lab_wearable_routes";
  }
  return "run_r1142_for_real_lab_wearable_route_metrics";
}

function conclusionFor(input: {
  blockers: readonly string[];
  goalAchieved: boolean;
  ready: boolean;
}): PacketConclusion {
  if (!input.ready) return "ordinary_row_owner_route_action_packet_waiting_on_refresh";
  if (input.goalAchieved) return "ordinary_row_owner_route_action_packet_ready_for_research_review";
  if (input.blockers.includes("feature_only_submission_model_evidence_guard_missing_or_unsafe")) {
    return "ordinary_row_owner_route_action_packet_waiting_on_feature_only_guard_refresh";
  }
  if (input.blockers.includes("safe_availability_action_packet_missing_or_unsafe")) {
    return "ordinary_row_owner_route_action_packet_waiting_on_safe_availability_action_packet_refresh";
  }
  if (input.blockers.includes("post_confirmation_private_config_intake_safe_action_guard_missing_or_stale")) {
    return "ordinary_row_owner_route_action_packet_waiting_on_post_confirmation_private_config_intake_refresh";
  }
  if (input.blockers.includes("row_owner_availability_assertions_not_confirmed")) {
    return "ordinary_row_owner_route_action_packet_waiting_on_safe_availability_confirmation";
  }
  if (
    input.blockers.includes("private_route_config_not_supplied")
    || input.blockers.includes("private_route_config_incomplete")
  ) {
    return "ordinary_row_owner_route_action_packet_waiting_on_private_route_config";
  }
  return "ordinary_row_owner_route_action_packet_waiting_on_real_route_metrics";
}

function availabilityAssertionChecklist(): AvailabilityAssertionChecklistItem[] {
  return RECOMMENDED_ASSERTION_FAMILIES.map((item): AvailabilityAssertionChecklistItem => ({
    familyId: item.familyId,
    priority: item.priority,
    privateDetailsStored: false,
    requiredForRecommendedRecipe: true,
    role: item.role,
    safeAssertionMeaning: item.safeAssertionMeaning,
  }));
}

function summarizeRecipe(r1135: unknown | null, recipeId: string): RouteRecipeSummary | null {
  const recipe = readObjectArrayAt(r1135, [
    "availabilityManifestPacket",
    "partialRouteManifestRecipes",
  ]).find((candidate) => readStringAt(candidate, ["recipeId"]) === recipeId);
  if (!recipe) return null;
  return {
    countBandFloors: {
      eventCountBand: readStringAt(recipe, ["countBandFloors", "eventCountBand"]),
      usableRecordCountBand: readStringAt(recipe, ["countBandFloors", "usableRecordCountBand"]),
    },
    expectedEligiblePartialRouteIds: readStringArrayAt(recipe, ["expectedEligiblePartialRouteIds"]),
    expectedFullSupportedRouteReady: readBooleanAt(recipe, ["expectedFullSupportedRouteReady"]),
    primarySubmitterInputFamilyIds: readStringArrayAt(recipe, ["primarySubmitterInputFamilyIds"]),
    productDisplayAuthorized: false,
    recipeId,
    recipeRouteGroupId: readStringAt(recipe, ["recipeRouteGroupId"]),
    routeKind: readStringAt(recipe, ["routeKind"]),
    routeUse: readStringAt(recipe, ["routeUse"]),
    sourceFamiliesToDeclareAvailable: readStringArrayAt(recipe, ["sourceFamiliesToDeclareAvailable"]),
    sourceFamiliesToDeclareUnavailable: readStringArrayAt(recipe, ["sourceFamiliesToDeclareUnavailable"]),
    targetAgeBand: TARGET_AGE_BAND,
  };
}

function featureOnlySubmissionModeFor(
  r1145: unknown | null,
): R1146OrdinaryConsumerRowOwnerRouteActionPacketOutput["rowOwnerRouteActionPacket"]["featureOnlySubmissionMode"] {
  return {
    conclusion: readStringAt(r1145, ["completionAudit", "featureOnlySubmissionMode", "conclusion"]),
    featureOnlyCoverageContextAllowed: readBooleanAt(
      r1145,
      ["completionAudit", "featureOnlySubmissionMode", "featureOnlyCoverageContextAllowed"],
    ),
    modelEvidencePromotionAllowed: readBooleanAt(
      r1145,
      ["completionAudit", "featureOnlySubmissionMode", "modelEvidencePromotionAllowed"],
    ),
    outcomeLinkedEvidenceReady: readBooleanAt(
      r1145,
      ["completionAudit", "featureOnlySubmissionMode", "outcomeLinkedEvidenceReady"],
    ),
    privateDetailsStored: false,
    supportedFeatureFamilyIds: readStringArrayAt(
      r1145,
      ["completionAudit", "featureOnlySubmissionMode", "supportedFeatureFamilyIds"],
    ),
  };
}

function safeAvailabilityActionPacketFor(
  r1145: unknown | null,
): R1146OrdinaryConsumerRowOwnerRouteActionPacketOutput["rowOwnerRouteActionPacket"]["safeAvailabilityActionPacket"] {
  return {
    conclusion: readStringAt(r1145, ["completionAudit", "safeAvailabilityActionPacket", "conclusion"]),
    featureOnlyCoverageContextReady: readBooleanAt(
      r1145,
      ["completionAudit", "safeAvailabilityActionPacket", "featureOnlyCoverageContextReady"],
    ),
    featureOnlyQuickstartArtifact: readStringAt(
      r1145,
      ["completionAudit", "safeAvailabilityActionPacket", "featureOnlyQuickstartArtifact"],
    ),
    featureOnlyQuickstartSafeFieldEditCount: readNumberAt(
      r1145,
      ["completionAudit", "safeAvailabilityActionPacket", "featureOnlyQuickstartSafeFieldEditCount"],
    ),
    featureOnlyQuickstartSafeFieldEditPaths: readStringArrayAt(
      r1145,
      ["completionAudit", "safeAvailabilityActionPacket", "featureOnlyQuickstartSafeFieldEditPaths"],
    ),
    minimumFeaturePairRequired: readStringArrayAt(
      r1145,
      ["completionAudit", "safeAvailabilityActionPacket", "minimumFeaturePairRequired"],
    ),
    missingFeatureOnlySourceFamilyIds: readStringArrayAt(
      r1145,
      ["completionAudit", "safeAvailabilityActionPacket", "missingFeatureOnlySourceFamilyIds"],
    ),
    missingRequiredSourceFamilyIds: readStringArrayAt(
      r1145,
      ["completionAudit", "safeAvailabilityActionPacket", "missingRequiredSourceFamilyIds"],
    ),
    nextAction: readStringAt(r1145, ["completionAudit", "safeAvailabilityActionPacket", "nextAction"]),
    outcomeLinkageRequiredForFeatureOnlyContext: readBooleanAt(
      r1145,
      ["completionAudit", "safeAvailabilityActionPacket", "outcomeLinkageRequiredForFeatureOnlyContext"],
    ),
    privateDetailsStored: false,
    readyForOutcomeLinkedRecipeReadinessChain: readBooleanAt(
      r1145,
      ["completionAudit", "safeAvailabilityActionPacket", "readyForOutcomeLinkedRecipeReadinessChain"],
    ),
    rowLevelDataAcceptedByR1154: readBooleanAt(
      r1145,
      ["completionAudit", "safeAvailabilityActionPacket", "rowLevelDataAcceptedByR1154"],
    ),
    safeAvailabilityConfirmationStatus: readStringAt(
      r1145,
      ["completionAudit", "safeAvailabilityActionPacket", "safeAvailabilityConfirmationStatus"],
    ),
  };
}

function safeAvailabilityActionPacketNextAction(nextAction: string | null): PacketNextAction | null {
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

function commandForRecipe(command: string | null, recipeId: string): string | null {
  return command ? command.replace("<recipe-id>", recipeId) : null;
}

async function readInputs(
  options: R1146OrdinaryConsumerRowOwnerRouteActionPacketOptions,
): Promise<Record<InputKey, unknown | null>> {
  return {
    r1135: await readJsonIfPresent(options.r1135Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1135.artifact)),
    r1145: await readJsonIfPresent(options.r1145Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1145.artifact)),
  };
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1146 rejected unsafe ${key} input: ${formatFindingCount(findings)}`);
    }
  }
}

function summarizeInputs(inputs: Record<InputKey, unknown | null>): Record<InputKey, ArtifactSummary> {
  return {
    r1135: summarizeInput("r1135", inputs.r1135),
    r1145: summarizeInput("r1145", inputs.r1145),
  };
}

function summarizeInput(key: InputKey, input: unknown | null): ArtifactSummary {
  const expected = INPUTS[key];
  const packetId = readStringAt(input, ["packetId"]);
  const schemaVersion = readStringAt(input, ["schemaVersion"]);
  return {
    artifact: expected.artifact,
    packetId: packetId === expected.packetId ? expected.packetId : null,
    schemaVersion: schemaVersion === expected.schemaVersion ? expected.schemaVersion : null,
    status: input ? "available" : "missing",
  };
}

function inputMatchesExpected(key: InputKey, input: unknown | null): boolean {
  const expected = INPUTS[key];
  return readStringAt(input, ["packetId"]) === expected.packetId
    && readStringAt(input, ["schemaVersion"]) === expected.schemaVersion;
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
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
  return Array.isArray(resolved) ? resolved.filter((item): item is string => typeof item === "string") : [];
}

function readObjectArrayAt(value: unknown | null, pathParts: readonly string[]): Array<Record<string, unknown>> {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved)
    ? resolved.filter((item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && !Array.isArray(item)
    )
    : [];
}

function readAt(value: unknown | null, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function formatFindingCount(findings: readonly string[]): string {
  return `${findings.length} aggregate-egress violation${findings.length === 1 ? "" : "s"}`;
}

function safeBoundary(): R1146OrdinaryConsumerRowOwnerRouteActionPacketOutput["artifactBoundary"] {
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
    privateFieldRefsStored: false,
    privateTableRefsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1146: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1146OrdinaryConsumerRowOwnerRouteActionPacket({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1135Path: process.env.MURPH_AGE_R1135_ORDINARY_CONSUMER_AVAILABILITY_MANIFEST_PACKET_PATH,
    r1145Path: process.env.MURPH_AGE_R1145_ORDINARY_CONSUMER_CURRENT_CHAIN_COMPLETION_AUDIT_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    blockers: output.summary.blockers,
    conclusion: output.summary.conclusion,
    fallbackRecipeIds: output.summary.fallbackRecipeIds,
    featureOnlyModeConclusion: output.summary.featureOnlyModeConclusion,
    featureOnlyModeModelEvidencePromotionAllowed: output.summary.featureOnlyModeModelEvidencePromotionAllowed,
    featureOnlyModeOutcomeLinkedEvidenceReady: output.summary.featureOnlyModeOutcomeLinkedEvidenceReady,
    featureOnlyModeSupportedFeatureFamilyIds: output.summary.featureOnlyModeSupportedFeatureFamilyIds,
    goalAchieved: output.summary.goalAchieved,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    privateRouteConfigReadyForR1142: output.summary.privateRouteConfigReadyForR1142,
    privateRouteConfigStatus: output.summary.privateRouteConfigStatus,
    privateRouteConfigSuppliedToIntake: output.summary.privateRouteConfigSuppliedToIntake,
    productDisplayAuthorized: output.productDisplayAuthorized,
    readyToMarkComplete: output.summary.readyToMarkComplete,
    recommendedConfirmedRecipeCommandAvailable: output.summary.recommendedConfirmedRecipeCommandAvailable,
    rowParsingPerformedByR1146: output.summary.rowParsingPerformedByR1146,
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
    schemaVersion: output.schemaVersion,
    selectedRecommendedRecipeId: output.summary.selectedRecommendedRecipeId,
    status: output.status,
    targetAgeBand: output.summary.targetAgeBand,
    targetInputPriority: output.summary.targetInputPriority,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1146 row-owner route action packet failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
