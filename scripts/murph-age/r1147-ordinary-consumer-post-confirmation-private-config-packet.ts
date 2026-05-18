import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1147_ORDINARY_CONSUMER_POST_CONFIRMATION_PRIVATE_CONFIG_PACKET_SCHEMA_VERSION =
  "murph-age-r1147-ordinary-consumer-post-confirmation-private-config-packet.v1" as const;

const PRIVATE_CONFIG_TEMPLATE_SCHEMA_VERSION =
  "murph-age-ordinary-consumer-post-confirmation-private-route-config-template.v1" as const;
const PARTIAL_PRIVATE_RUNNER_CONFIG_SCHEMA_VERSION =
  "murph-age-ordinary-consumer-partial-private-runner-config.v1" as const;
const PARTIAL_AGGREGATE_METRICS_SCHEMA_VERSION =
  "murph-age-ordinary-consumer-partial-aggregate-metrics.v1" as const;
const PARTIAL_AGGREGATE_METRICS_EVALUATOR_ID =
  "ordinary_consumer_partial_route_aggregate_evaluator_v1" as const;
const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1147-ordinary-consumer-post-confirmation-private-config-packet.latest.json";
const PRIVATE_CONFIG_TEMPLATE_FILE_NAME =
  "r1147-fillable-ordinary-consumer-lab-wearable-private-route-config.json";
const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first" as const;
const TARGET_AGE_BAND = "roughly_16_50" as const;
const RECOMMENDED_RECIPE_ID = "lab_plus_wearable_minimum_manifest" as const;
const EXPECTED_ROUTE_IDS = [
  "lab_glycemia_minimum_route",
  "wearable_activity_minimum_route",
] as const;
const ACCEPTED_PRIVATE_TABLE_LAYOUTS = [
  "single_primary_table_fallback",
  "multi_table_or_explicit_refs",
] as const;
const RUNNER_TOP_LEVEL_KEYS = [
  "schemaVersion",
  "attestations",
  "aggregateMetricsTarget",
  "routeRunOrder",
  "privateTableRefs",
  "privateFieldRefs",
  "submissionContext",
] as const;
const RUNNER_ATTESTATION_KEYS = [
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
] as const;
const RUNNER_PRIVATE_FIELD_REF_KEYS = [
  "personJoinKey",
  "outcomeEvent",
  "labGlycemia",
  "wearableActivity",
] as const;
const RUNNER_PRIVATE_TABLE_REF_KEYS = [
  "primaryTableRef",
  "outcomeTableRef",
  "labTableRef",
  "wearableTableRef",
] as const;
const R1142_PARTIAL_PRIVATE_CHAIN_RUNNER_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH=<availability-manifest.json> MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH=<partial-private-config.json> pnpm exec tsx scripts/murph-age/r1142-ordinary-consumer-partial-private-chain-runner.ts" as const;

const INPUTS = {
  r1144: {
    artifact: "r1144-ordinary-consumer-recipe-readiness-chain-runner.latest.json",
    packetId: "r1144-ordinary-consumer-recipe-readiness-chain-runner",
    schemaVersion: "murph-age-r1144-ordinary-consumer-recipe-readiness-chain-runner.v1",
  },
  r1146: {
    artifact: "r1146-ordinary-consumer-row-owner-route-action-packet.latest.json",
    packetId: "r1146-ordinary-consumer-row-owner-route-action-packet",
    schemaVersion: "murph-age-r1146-ordinary-consumer-row-owner-route-action-packet.v1",
  },
} as const;

const ROUTE_DEFINITIONS = [
  {
    firstPassCandidateIds: ["L1_tiny_glycemia_only"],
    primaryInputFamilyIds: ["bloodwork_glycemia"],
    requiredPrivateFieldRefFamilies: [
      "personJoinKey",
      "dateOrTimeKey",
      "outcomeEvent",
      "labGlycemia",
    ],
    requiredPrivateTableRefs: ["primaryTableRef", "outcomeTableRef", "labTableRef"],
    routeId: "lab_glycemia_minimum_route",
    routeKind: "partial_lab_route",
  },
  {
    firstPassCandidateIds: ["W1_activity_steps_minutes"],
    primaryInputFamilyIds: ["wearable_activity_daily"],
    requiredPrivateFieldRefFamilies: [
      "personJoinKey",
      "dateOrTimeKey",
      "outcomeEvent",
      "wearableActivity",
    ],
    requiredPrivateTableRefs: ["primaryTableRef", "outcomeTableRef", "wearableTableRef"],
    routeId: "wearable_activity_minimum_route",
    routeKind: "partial_wearable_route",
  },
] as const;

type InputKey = keyof typeof INPUTS;
type KnownRouteId = typeof EXPECTED_ROUTE_IDS[number];
type RunnerTopLevelKey = typeof RUNNER_TOP_LEVEL_KEYS[number];
type RunnerAttestationKey = typeof RUNNER_ATTESTATION_KEYS[number];
type RunnerPrivateFieldRefKey = typeof RUNNER_PRIVATE_FIELD_REF_KEYS[number];
type RunnerPrivateTableRefKey = typeof RUNNER_PRIVATE_TABLE_REF_KEYS[number];
type PacketConclusion =
  | "ordinary_post_confirmation_private_config_packet_ready_for_research_review"
  | "ordinary_post_confirmation_private_config_packet_waiting_on_private_route_config"
  | "ordinary_post_confirmation_private_config_packet_waiting_on_real_route_metrics"
  | "ordinary_post_confirmation_private_config_packet_waiting_on_refresh"
  | "ordinary_post_confirmation_private_config_packet_waiting_on_safe_availability_action_packet_refresh"
  | "ordinary_post_confirmation_private_config_packet_waiting_on_safe_availability_confirmation"
  | "ordinary_post_confirmation_private_config_packet_waiting_on_row_owner_confirmation";
type PacketNextAction =
  | "complete_safe_availability_confirmation_template"
  | "fill_feature_only_coverage_context_template"
  | "fill_safe_availability_confirmation_from_template"
  | "fill_post_confirmation_private_config_and_run_r1142"
  | "refresh_r1144_r1146_before_private_config_packet"
  | "refresh_r1154_safe_availability_action_packet"
  | "review_real_lab_wearable_route_metrics_research_only"
  | "run_r1144_recipe_readiness_chain_with_confirmed_availability"
  | "run_r1150_safe_availability_confirmation_intake"
  | "run_r1153_feature_only_chain_with_safe_availability"
  | "run_r1142_for_real_lab_wearable_route_metrics"
  | "run_recommended_confirmed_recipe_chain_before_private_config_packet"
  | "rerun_safe_availability_confirmation_with_valid_json_object";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface RoutePrivateConfigSlot {
  firstPassCandidateIds: string[];
  primaryInputFamilyIds: string[];
  productDisplayAuthorized: false;
  requiredPrivateFieldRefFamilies: string[];
  requiredPrivateTableRefs: string[];
  routeId: KnownRouteId;
  routeKind: string;
  valuesStoredInThisArtifact: false;
}

interface RunnerConfigSkeleton {
  aggregateMetricsTarget: {
    evaluatorId: typeof PARTIAL_AGGREGATE_METRICS_EVALUATOR_ID;
    schemaVersion: typeof PARTIAL_AGGREGATE_METRICS_SCHEMA_VERSION;
  };
  attestations: Record<RunnerAttestationKey, true>;
  privateFieldRefs: Record<RunnerPrivateFieldRefKey, "">;
  privateTableRefs: Record<RunnerPrivateTableRefKey, "">;
  routeRunOrder: Array<{ routeId: KnownRouteId }>;
  schemaVersion: typeof PARTIAL_PRIVATE_RUNNER_CONFIG_SCHEMA_VERSION;
  submissionContext: {
    evidenceRole: "real_partial_route_evidence";
  };
}

interface RunnerConfigContract {
  acceptedPrivateTableLayouts: typeof ACCEPTED_PRIVATE_TABLE_LAYOUTS[number][];
  aggregateMetricsTarget: RunnerConfigSkeleton["aggregateMetricsTarget"];
  fillablePrivateFieldRefKeys: RunnerPrivateFieldRefKey[];
  fillablePrivateTableRefKeys: RunnerPrivateTableRefKey[];
  localCompletionRequired: true;
  partialPrivateChainRunnerCommand: typeof R1142_PARTIAL_PRIVATE_CHAIN_RUNNER_COMMAND;
  privateValuesStoredInThisArtifact: false;
  requiredAttestationKeys: RunnerAttestationKey[];
  routeRunOrder: Array<{ routeId: KnownRouteId }>;
  runnerConfigSchemaVersion: typeof PARTIAL_PRIVATE_RUNNER_CONFIG_SCHEMA_VERSION;
  runnerTopLevelKeys: RunnerTopLevelKey[];
}

interface PrivateConfigTemplate {
  artifactBoundary: R1147OrdinaryConsumerPostConfirmationPrivateConfigPacketOutput["artifactBoundary"];
  packetId: "fill-this-ordinary-consumer-post-confirmation-private-route-config";
  runnerConfigContract: RunnerConfigContract;
  runnerConfigSkeleton: RunnerConfigSkeleton;
  routeConfigSlots: RoutePrivateConfigSlot[];
  safetyAttestations: {
    aggregateOnly: true;
    fillInPrivateWorkspaceOnly: true;
    noCoefficientEgress: true;
    noParticipantEgress: true;
    noPredictionEgress: true;
    noPrivatePathEgress: true;
    noPrivateRefValueEgress: true;
    noRowEgress: true;
    noSmallCellEgress: true;
  };
  schemaVersion: typeof PRIVATE_CONFIG_TEMPLATE_SCHEMA_VERSION;
  submissionContext: {
    ordinaryConsumerSubmission: true;
    outcomeLinked: true;
    privateWorkspaceOnlyCompletion: true;
    selectedRecipeId: typeof RECOMMENDED_RECIPE_ID;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
}

export interface R1147OrdinaryConsumerPostConfirmationPrivateConfigPacketOptions {
  createdAt?: string;
  outputDir?: string;
  r1144Path?: string;
  r1146Path?: string;
}

export interface R1147OrdinaryConsumerPostConfirmationPrivateConfigPacketOutput {
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
    rowParsingPerformedByR1147: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  packetId: "r1147-ordinary-consumer-post-confirmation-private-config-packet";
  postConfirmationPrivateConfigPacket: {
    blockers: string[];
    commands: {
      partialPrivateChainRunnerCommand: string | null;
      privateRouteConfigTemplateArtifact: typeof PRIVATE_CONFIG_TEMPLATE_FILE_NAME;
      recommendedConfirmedRecipeCommand: string | null;
    };
    confirmationState: {
      generatedAvailabilityManifestArtifact: string | null;
      generatedManifestWritten: boolean | null;
      routeRequirementsAvailable: boolean;
      rowOwnerAssertionsConfirmed: boolean | null;
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
    expectedRouteIds: KnownRouteId[];
    goalAchieved: boolean;
    nextAction: PacketNextAction;
    privateConfigTemplateReadyForFill: boolean;
    privateDetailsStored: false;
    readyToMarkComplete: boolean;
    routeConfigSlots: RoutePrivateConfigSlot[];
    routeEvidenceState: {
      privateRouteConfigSupplied: boolean | null;
      realLabWearableRouteMetricsRecorded: boolean | null;
      rowOwnerAssertionsConfirmed: boolean | null;
    };
    runnerConfigContract: RunnerConfigContract;
    selectedRecommendedRecipeId: typeof RECOMMENDED_RECIPE_ID;
    templateSchemaVersion: typeof PRIVATE_CONFIG_TEMPLATE_SCHEMA_VERSION;
  };
  productDisplayAuthorized: false;
  schemaVersion: typeof R1147_ORDINARY_CONSUMER_POST_CONFIRMATION_PRIVATE_CONFIG_PACKET_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    blockers: string[];
    conclusion: PacketConclusion;
    expectedRouteIds: KnownRouteId[];
    goalAchieved: boolean;
    nextAction: PacketNextAction;
    privateConfigTemplateArtifact: typeof PRIVATE_CONFIG_TEMPLATE_FILE_NAME;
    privateConfigTemplateReadyForFill: boolean;
    productDisplayAuthorized: false;
    readyToMarkComplete: boolean;
    requiredPrivateFieldRefFamilies: string[];
    requiredPrivateTableRefs: string[];
    reviewGptRequiredNow: false;
    runnerConfigPrivateFieldRefKeys: RunnerPrivateFieldRefKey[];
    runnerConfigPrivateTableRefKeys: RunnerPrivateTableRefKey[];
    runnerConfigRouteRunOrder: KnownRouteId[];
    runnerConfigSchemaVersion: typeof PARTIAL_PRIVATE_RUNNER_CONFIG_SCHEMA_VERSION;
    runnerConfigTopLevelKeys: RunnerTopLevelKey[];
    rowOwnerAssertionsConfirmed: boolean | null;
    rowParsingPerformedByR1147: false;
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

export async function runR1147OrdinaryConsumerPostConfirmationPrivateConfigPacket(
  options: R1147OrdinaryConsumerPostConfirmationPrivateConfigPacketOptions = {},
): Promise<{
  output: R1147OrdinaryConsumerPostConfirmationPrivateConfigPacketOutput;
  outputPath: string;
  privateConfigTemplatePath: string;
}> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);
  const inputsReady = Object.entries(inputs).every(([key, value]) =>
    inputMatchesExpected(key as InputKey, value)
  );
  const rowOwnerAssertionsConfirmed = inputsReady
    ? readBooleanAt(inputs.r1144, ["summary", "rowOwnerAssertionsConfirmed"]) === true
    : null;
  const generatedManifestWritten = inputsReady
    ? readBooleanAt(inputs.r1144, ["summary", "generatedManifestWritten"])
    : null;
  const generatedAvailabilityManifestArtifact = inputsReady
    ? readStringAt(inputs.r1144, ["summary", "generatedAvailabilityManifestArtifact"])
    : null;
  const routeIds = knownRouteIds(readStringArrayAt(inputs.r1144, ["summary", "eligiblePartialRouteIds"]));
  const expectedRouteIds = routeIds.length > 0
    ? routeIds
    : knownRouteIds(readStringArrayAt(
        inputs.r1146,
        ["rowOwnerRouteActionPacket", "recommendedRecipe", "expectedEligiblePartialRouteIds"],
      ));
  const routeConfigSlots = routeSlotsFor(expectedRouteIds.length > 0 ? expectedRouteIds : [...EXPECTED_ROUTE_IDS]);
  const runnerConfigContract = createRunnerConfigContract(routeConfigSlots);
  const routeRequirementsAvailable = rowOwnerAssertionsConfirmed === true
    && generatedManifestWritten === true
    && routeConfigSlots.length > 0;
  const routeEvidenceState = {
    privateRouteConfigSupplied: readBooleanAt(
      inputs.r1146,
      ["rowOwnerRouteActionPacket", "routeEvidenceState", "privateRouteConfigSupplied"],
    ),
    realLabWearableRouteMetricsRecorded: readBooleanAt(
      inputs.r1146,
      ["rowOwnerRouteActionPacket", "routeEvidenceState", "realLabWearableRouteMetricsRecorded"],
    ),
    rowOwnerAssertionsConfirmed,
  };
  const goalAchieved = inputsReady
    && readBooleanAt(inputs.r1146, ["summary", "goalAchieved"]) === true
    && rowOwnerAssertionsConfirmed === true;
  const readyToMarkComplete = inputsReady
    && readBooleanAt(inputs.r1146, ["summary", "readyToMarkComplete"]) === true
    && rowOwnerAssertionsConfirmed === true;
  const blockers = blockersFor({
    inputsReady,
    r1146Blockers: inputsReady ? readStringArrayAt(inputs.r1146, ["summary", "blockers"]) : [],
    routeEvidenceState,
    routeRequirementsAvailable,
  });
  const safeAvailabilityActionPacket = safeAvailabilityActionPacketFor(inputs.r1146);
  const nextAction = nextActionFor({
    blockers,
    goalAchieved,
    inputsReady,
    safeAvailabilityActionPacketNextAction: safeAvailabilityActionPacketNextAction(
      safeAvailabilityActionPacket.nextAction,
    ),
  });
  const conclusion = conclusionFor({ blockers, goalAchieved, inputsReady });
  const output: R1147OrdinaryConsumerPostConfirmationPrivateConfigPacketOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1147-ordinary-consumer-post-confirmation-private-config-packet",
    postConfirmationPrivateConfigPacket: {
      blockers,
      commands: {
        partialPrivateChainRunnerCommand: readStringAt(
          inputs.r1146,
          ["rowOwnerRouteActionPacket", "commands", "partialPrivateChainRunnerCommand"],
        ) ?? R1142_PARTIAL_PRIVATE_CHAIN_RUNNER_COMMAND,
        privateRouteConfigTemplateArtifact: PRIVATE_CONFIG_TEMPLATE_FILE_NAME,
        recommendedConfirmedRecipeCommand: readStringAt(
          inputs.r1146,
          ["rowOwnerRouteActionPacket", "commands", "recommendedConfirmedRecipeCommand"],
        ),
      },
      confirmationState: {
        generatedAvailabilityManifestArtifact,
        generatedManifestWritten,
        routeRequirementsAvailable,
        rowOwnerAssertionsConfirmed,
      },
      safeAvailabilityActionPacket,
      expectedRouteIds,
      goalAchieved,
      nextAction,
      privateConfigTemplateReadyForFill: routeRequirementsAvailable,
      privateDetailsStored: false,
      readyToMarkComplete,
      routeConfigSlots,
      routeEvidenceState,
      runnerConfigContract,
      selectedRecommendedRecipeId: RECOMMENDED_RECIPE_ID,
      templateSchemaVersion: PRIVATE_CONFIG_TEMPLATE_SCHEMA_VERSION,
    },
    productDisplayAuthorized: false,
    schemaVersion: R1147_ORDINARY_CONSUMER_POST_CONFIRMATION_PRIVATE_CONFIG_PACKET_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      blockers,
      conclusion,
      expectedRouteIds,
      goalAchieved,
      nextAction,
      privateConfigTemplateArtifact: PRIVATE_CONFIG_TEMPLATE_FILE_NAME,
      privateConfigTemplateReadyForFill: routeRequirementsAvailable,
      productDisplayAuthorized: false,
      readyToMarkComplete,
      requiredPrivateFieldRefFamilies: uniqueFlatMap(routeConfigSlots, "requiredPrivateFieldRefFamilies"),
      requiredPrivateTableRefs: uniqueFlatMap(routeConfigSlots, "requiredPrivateTableRefs"),
      reviewGptRequiredNow: false,
      runnerConfigPrivateFieldRefKeys: [...RUNNER_PRIVATE_FIELD_REF_KEYS],
      runnerConfigPrivateTableRefKeys: [...RUNNER_PRIVATE_TABLE_REF_KEYS],
      runnerConfigRouteRunOrder: runnerConfigContract.routeRunOrder.map((route) => route.routeId),
      runnerConfigSchemaVersion: PARTIAL_PRIVATE_RUNNER_CONFIG_SCHEMA_VERSION,
      runnerConfigTopLevelKeys: [...RUNNER_TOP_LEVEL_KEYS],
      rowOwnerAssertionsConfirmed,
      rowParsingPerformedByR1147: false,
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
  const template = createPrivateConfigTemplate(routeConfigSlots);
  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findForbiddenAggregateEgress(template),
  ];
  if (findings.length > 0) {
    throw new Error(`R1147 post-confirmation private config packet failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  const privateConfigTemplatePath = path.join(outputDir, PRIVATE_CONFIG_TEMPLATE_FILE_NAME);
  await Promise.all([
    writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`),
    writeFile(privateConfigTemplatePath, `${JSON.stringify(template, null, 2)}\n`),
  ]);
  return { output, outputPath, privateConfigTemplatePath };
}

function blockersFor(input: {
  inputsReady: boolean;
  r1146Blockers: readonly string[];
  routeEvidenceState: R1147OrdinaryConsumerPostConfirmationPrivateConfigPacketOutput["postConfirmationPrivateConfigPacket"]["routeEvidenceState"];
  routeRequirementsAvailable: boolean;
}): string[] {
  if (!input.inputsReady) return ["refresh_post_confirmation_private_config_packet_inputs"];
  if (input.r1146Blockers.includes("safe_availability_action_packet_missing_or_unsafe")) {
    return ["safe_availability_action_packet_missing_or_unsafe"];
  }
  if (input.routeEvidenceState.rowOwnerAssertionsConfirmed !== true) {
    return [
      "row_owner_availability_assertions_not_confirmed",
      "private_route_config_not_supplied",
      "real_lab_wearable_route_metrics_missing",
    ];
  }
  if (!input.routeRequirementsAvailable) {
    return [
      "confirmed_route_config_requirements_not_available",
      "private_route_config_not_supplied",
      "real_lab_wearable_route_metrics_missing",
    ];
  }
  if (input.routeEvidenceState.privateRouteConfigSupplied !== true) {
    return [
      "private_route_config_not_supplied",
      "real_lab_wearable_route_metrics_missing",
    ];
  }
  if (input.routeEvidenceState.realLabWearableRouteMetricsRecorded !== true) {
    return ["real_lab_wearable_route_metrics_missing"];
  }
  return [];
}

function nextActionFor(input: {
  blockers: readonly string[];
  goalAchieved: boolean;
  inputsReady: boolean;
  safeAvailabilityActionPacketNextAction: PacketNextAction | null;
}): PacketNextAction {
  if (!input.inputsReady) return "refresh_r1144_r1146_before_private_config_packet";
  if (input.goalAchieved) return "review_real_lab_wearable_route_metrics_research_only";
  if (input.blockers.includes("safe_availability_action_packet_missing_or_unsafe")) {
    return "refresh_r1154_safe_availability_action_packet";
  }
  if (input.blockers.includes("row_owner_availability_assertions_not_confirmed")) {
    return input.safeAvailabilityActionPacketNextAction ?? "fill_safe_availability_confirmation_from_template";
  }
  if (input.blockers.includes("private_route_config_not_supplied")) {
    return "fill_post_confirmation_private_config_and_run_r1142";
  }
  return "run_r1142_for_real_lab_wearable_route_metrics";
}

function conclusionFor(input: {
  blockers: readonly string[];
  goalAchieved: boolean;
  inputsReady: boolean;
}): PacketConclusion {
  if (!input.inputsReady) return "ordinary_post_confirmation_private_config_packet_waiting_on_refresh";
  if (input.goalAchieved) return "ordinary_post_confirmation_private_config_packet_ready_for_research_review";
  if (input.blockers.includes("safe_availability_action_packet_missing_or_unsafe")) {
    return "ordinary_post_confirmation_private_config_packet_waiting_on_safe_availability_action_packet_refresh";
  }
  if (input.blockers.includes("row_owner_availability_assertions_not_confirmed")) {
    return "ordinary_post_confirmation_private_config_packet_waiting_on_safe_availability_confirmation";
  }
  if (input.blockers.includes("private_route_config_not_supplied")) {
    return "ordinary_post_confirmation_private_config_packet_waiting_on_private_route_config";
  }
  return "ordinary_post_confirmation_private_config_packet_waiting_on_real_route_metrics";
}

function routeSlotsFor(routeIds: readonly KnownRouteId[]): RoutePrivateConfigSlot[] {
  const selected = new Set(routeIds);
  return ROUTE_DEFINITIONS
    .filter((route) => selected.has(route.routeId))
    .map((route) => ({
      firstPassCandidateIds: [...route.firstPassCandidateIds],
      primaryInputFamilyIds: [...route.primaryInputFamilyIds],
      productDisplayAuthorized: false,
      requiredPrivateFieldRefFamilies: [...route.requiredPrivateFieldRefFamilies],
      requiredPrivateTableRefs: [...route.requiredPrivateTableRefs],
      routeId: route.routeId,
      routeKind: route.routeKind,
      valuesStoredInThisArtifact: false,
    }));
}

function createPrivateConfigTemplate(routeConfigSlots: readonly RoutePrivateConfigSlot[]): PrivateConfigTemplate {
  const runnerConfigContract = createRunnerConfigContract(routeConfigSlots);
  return {
    artifactBoundary: safeBoundary(),
    packetId: "fill-this-ordinary-consumer-post-confirmation-private-route-config",
    runnerConfigContract,
    runnerConfigSkeleton: createRunnerConfigSkeleton(runnerConfigContract.routeRunOrder.map((route) => route.routeId)),
    routeConfigSlots: routeConfigSlots.map((slot) => ({ ...slot })),
    safetyAttestations: {
      aggregateOnly: true,
      fillInPrivateWorkspaceOnly: true,
      noCoefficientEgress: true,
      noParticipantEgress: true,
      noPredictionEgress: true,
      noPrivatePathEgress: true,
      noPrivateRefValueEgress: true,
      noRowEgress: true,
      noSmallCellEgress: true,
    },
    schemaVersion: PRIVATE_CONFIG_TEMPLATE_SCHEMA_VERSION,
    submissionContext: {
      ordinaryConsumerSubmission: true,
      outcomeLinked: true,
      privateWorkspaceOnlyCompletion: true,
      selectedRecipeId: RECOMMENDED_RECIPE_ID,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };
}

function createRunnerConfigContract(routeConfigSlots: readonly RoutePrivateConfigSlot[]): RunnerConfigContract {
  const routeIds = routeConfigSlots
    .map((slot) => slot.routeId)
    .filter((routeId): routeId is KnownRouteId => EXPECTED_ROUTE_IDS.some((expected) => expected === routeId));
  return {
    acceptedPrivateTableLayouts: [...ACCEPTED_PRIVATE_TABLE_LAYOUTS],
    aggregateMetricsTarget: {
      evaluatorId: PARTIAL_AGGREGATE_METRICS_EVALUATOR_ID,
      schemaVersion: PARTIAL_AGGREGATE_METRICS_SCHEMA_VERSION,
    },
    fillablePrivateFieldRefKeys: [...RUNNER_PRIVATE_FIELD_REF_KEYS],
    fillablePrivateTableRefKeys: [...RUNNER_PRIVATE_TABLE_REF_KEYS],
    localCompletionRequired: true,
    partialPrivateChainRunnerCommand: R1142_PARTIAL_PRIVATE_CHAIN_RUNNER_COMMAND,
    privateValuesStoredInThisArtifact: false,
    requiredAttestationKeys: [...RUNNER_ATTESTATION_KEYS],
    routeRunOrder: (routeIds.length > 0 ? routeIds : [...EXPECTED_ROUTE_IDS]).map((routeId) => ({ routeId })),
    runnerConfigSchemaVersion: PARTIAL_PRIVATE_RUNNER_CONFIG_SCHEMA_VERSION,
    runnerTopLevelKeys: [...RUNNER_TOP_LEVEL_KEYS],
  };
}

function createRunnerConfigSkeleton(routeIds: readonly KnownRouteId[]): RunnerConfigSkeleton {
  return {
    aggregateMetricsTarget: {
      evaluatorId: PARTIAL_AGGREGATE_METRICS_EVALUATOR_ID,
      schemaVersion: PARTIAL_AGGREGATE_METRICS_SCHEMA_VERSION,
    },
    attestations: Object.fromEntries(
      RUNNER_ATTESTATION_KEYS.map((key) => [key, true]),
    ) as Record<RunnerAttestationKey, true>,
    privateFieldRefs: Object.fromEntries(
      RUNNER_PRIVATE_FIELD_REF_KEYS.map((key) => [key, ""]),
    ) as Record<RunnerPrivateFieldRefKey, "">,
    privateTableRefs: Object.fromEntries(
      RUNNER_PRIVATE_TABLE_REF_KEYS.map((key) => [key, ""]),
    ) as Record<RunnerPrivateTableRefKey, "">,
    routeRunOrder: routeIds.map((routeId) => ({ routeId })),
    schemaVersion: PARTIAL_PRIVATE_RUNNER_CONFIG_SCHEMA_VERSION,
    submissionContext: {
      evidenceRole: "real_partial_route_evidence",
    },
  };
}

function knownRouteIds(values: readonly string[]): KnownRouteId[] {
  return values.filter((value): value is KnownRouteId =>
    EXPECTED_ROUTE_IDS.some((routeId) => routeId === value)
  );
}

function safeAvailabilityActionPacketFor(
  r1146: unknown | null,
): R1147OrdinaryConsumerPostConfirmationPrivateConfigPacketOutput["postConfirmationPrivateConfigPacket"]["safeAvailabilityActionPacket"] {
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

function uniqueFlatMap(
  routeConfigSlots: readonly RoutePrivateConfigSlot[],
  key: "requiredPrivateFieldRefFamilies" | "requiredPrivateTableRefs",
): string[] {
  return Array.from(new Set(routeConfigSlots.flatMap((slot) => slot[key])));
}

async function readInputs(
  options: R1147OrdinaryConsumerPostConfirmationPrivateConfigPacketOptions,
): Promise<Record<InputKey, unknown | null>> {
  return {
    r1144: await readJsonIfPresent(options.r1144Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1144.artifact)),
    r1146: await readJsonIfPresent(options.r1146Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1146.artifact)),
  };
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1147 rejected unsafe ${key} input: ${formatFindingCount(findings)}`);
    }
  }
}

function summarizeInputs(inputs: Record<InputKey, unknown | null>): Record<InputKey, ArtifactSummary> {
  return {
    r1144: summarizeInput("r1144", inputs.r1144),
    r1146: summarizeInput("r1146", inputs.r1146),
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

function safeBoundary(): R1147OrdinaryConsumerPostConfirmationPrivateConfigPacketOutput["artifactBoundary"] {
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
    rowParsingPerformedByR1147: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1147OrdinaryConsumerPostConfirmationPrivateConfigPacket({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1144Path: process.env.MURPH_AGE_R1144_ORDINARY_CONSUMER_RECIPE_READINESS_CHAIN_RUNNER_PATH,
    r1146Path: process.env.MURPH_AGE_R1146_ORDINARY_CONSUMER_ROW_OWNER_ROUTE_ACTION_PACKET_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    blockers: output.summary.blockers,
    conclusion: output.summary.conclusion,
    expectedRouteIds: output.summary.expectedRouteIds,
    goalAchieved: output.summary.goalAchieved,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    privateConfigTemplateArtifact: output.summary.privateConfigTemplateArtifact,
    privateConfigTemplateReadyForFill: output.summary.privateConfigTemplateReadyForFill,
    productDisplayAuthorized: output.productDisplayAuthorized,
    readyToMarkComplete: output.summary.readyToMarkComplete,
    requiredPrivateFieldRefFamilies: output.summary.requiredPrivateFieldRefFamilies,
    requiredPrivateTableRefs: output.summary.requiredPrivateTableRefs,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    runnerConfigPrivateFieldRefKeys: output.summary.runnerConfigPrivateFieldRefKeys,
    runnerConfigPrivateTableRefKeys: output.summary.runnerConfigPrivateTableRefKeys,
    runnerConfigRouteRunOrder: output.summary.runnerConfigRouteRunOrder,
    runnerConfigSchemaVersion: output.summary.runnerConfigSchemaVersion,
    runnerConfigTopLevelKeys: output.summary.runnerConfigTopLevelKeys,
    rowOwnerAssertionsConfirmed: output.summary.rowOwnerAssertionsConfirmed,
    rowParsingPerformedByR1147: output.summary.rowParsingPerformedByR1147,
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
    process.stderr.write(`${safeCliErrorMessage(error, "R1147 post-confirmation private config packet failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
