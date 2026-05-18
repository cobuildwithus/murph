import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1135_ORDINARY_CONSUMER_AVAILABILITY_MANIFEST_PACKET_SCHEMA_VERSION =
  "murph-age-r1135-ordinary-consumer-availability-manifest-packet.v1" as const;

const AVAILABILITY_MANIFEST_SCHEMA_VERSION =
  "murph-age-r1133-ordinary-consumer-data-availability-manifest.v1" as const;
const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1135-ordinary-consumer-availability-manifest-packet.latest.json";
const R1135_PACKET_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1135-ordinary-consumer-availability-manifest-packet.ts" as const;
const R1142_PARTIAL_PRIVATE_CHAIN_RUNNER_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH=<availability-manifest.json> MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH=<partial-private-config.json> pnpm exec tsx scripts/murph-age/r1142-ordinary-consumer-partial-private-chain-runner.ts" as const;
const R1143_MANIFEST_RECIPE_MATERIALIZER_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ID=<recipe-id> MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ASSERTIONS_CONFIRMED=true pnpm exec tsx scripts/murph-age/r1143-ordinary-consumer-availability-manifest-recipe-materializer.ts" as const;
const R1144_RECIPE_READINESS_CHAIN_RUNNER_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ID=<recipe-id> MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ASSERTIONS_CONFIRMED=true pnpm exec tsx scripts/murph-age/r1144-ordinary-consumer-recipe-readiness-chain-runner.ts" as const;

const R1076_EXPECTED = {
  artifact: "r1076-current-autoresearch-loop-executor.latest.json",
  packetId: "r1076-current-autoresearch-loop-executor",
  schemaVersion: "murph-age-r1076-current-autoresearch-loop-executor.v1",
} as const;
const R1133_EXPECTED = {
  artifact: "r1133-ordinary-consumer-data-availability-preflight.latest.json",
  packetId: "r1133-ordinary-consumer-data-availability-preflight",
  schemaVersion: "murph-age-r1133-ordinary-consumer-data-availability-preflight.v1",
} as const;
const R1134_EXPECTED = {
  artifact: "r1134-ordinary-consumer-availability-config-bridge.latest.json",
  packetId: "r1134-ordinary-consumer-availability-config-bridge",
  schemaVersion: "murph-age-r1134-ordinary-consumer-availability-config-bridge.v1",
} as const;

const PRIMARY_SUBMITTER_INPUT_FAMILY_IDS = [
  "bloodwork_glycemia",
  "common_bloodwork_core",
  "wearable_activity_daily",
  "vitals_body_context",
] as const;
const REQUIRED_LINKAGE_FAMILY_IDS = [
  "outcome_linkage",
  "join_time_alignment",
] as const;
const ACCEPTED_TABLE_LAYOUTS = [
  "single_primary_table_fallback",
  "multi_table_or_explicit_refs",
] as const;
const ORDINARY_SOURCE_FAMILY_PRIORITY = [
  {
    familyId: "outcome_linkage",
    inputKind: "outcome_or_followup_table",
    priorityGroup: "required_linkage",
    priorityRank: 1,
    safeManifestQuestion: "Declare whether an outcome or follow-up source can be linked to the same people as the labs and wearable data.",
  },
  {
    familyId: "join_time_alignment",
    inputKind: "stable_join_key_and_date_fields",
    priorityGroup: "required_linkage",
    priorityRank: 2,
    safeManifestQuestion: "Declare whether the available sources can be joined and aligned by person plus date or time without exposing the join values.",
  },
  {
    familyId: "bloodwork_glycemia",
    inputKind: "bloodwork_table_or_lab_portal_export",
    priorityGroup: "primary_user_submittable_lab",
    priorityRank: 3,
    safeManifestQuestion: "Declare whether ordinary bloodwork includes glycemia-related lab fields in an export or spreadsheet.",
  },
  {
    familyId: "common_bloodwork_core",
    inputKind: "bloodwork_table_or_lab_portal_export",
    priorityGroup: "primary_user_submittable_lab",
    priorityRank: 4,
    safeManifestQuestion: "Declare whether ordinary bloodwork includes a common lab core beyond glycemia.",
  },
  {
    familyId: "wearable_activity_daily",
    inputKind: "daily_wearable_activity_export_or_spreadsheet",
    priorityGroup: "primary_user_submittable_wearable",
    priorityRank: 5,
    safeManifestQuestion: "Declare whether daily wearable activity data is available from a watch, phone, or wearable export.",
  },
  {
    familyId: "vitals_body_context",
    inputKind: "body_or_vitals_table",
    priorityGroup: "primary_user_submittable_context",
    priorityRank: 6,
    safeManifestQuestion: "Declare whether basic body or vitals context is available alongside the labs and wearable data.",
  },
] as const;
const FORBIDDEN_MANIFEST_CONTENT = [
  "private_paths",
  "header_names",
  "source_variable_names",
  "file_names",
  "row_values",
  "participant_identifiers",
  "predictions",
  "coefficients",
  "source_text",
] as const;
const REQUIRED_SAFE_MANIFEST_ATTESTATIONS = [
  "aggregateOnly",
  "noCoefficientEgress",
  "noHeaderNameEgress",
  "noParticipantEgress",
  "noPredictionEgress",
  "noRowEgress",
  "noSmallCellEgress",
  "noSourceTextEgress",
] as const;
const ROUTE_MANIFEST_RECIPES = [
  {
    expectedEligiblePartialRouteIds: [
      "lab_glycemia_minimum_route",
      "wearable_activity_minimum_route",
    ],
    expectedFullSupportedRouteId: null,
    expectedFullSupportedRouteReady: false,
    recipeId: "lab_plus_wearable_minimum_manifest",
    recipeRouteGroupId: "lab_plus_wearable_minimum_research_route",
    routeKind: "partial_lab_wearable_route",
    routeUse: "preferred first ordinary submitter manifest when glycemia bloodwork and daily wearable activity are both available",
    sourceFamiliesToDeclareAvailable: [
      "outcome_linkage",
      "join_time_alignment",
      "bloodwork_glycemia",
      "wearable_activity_daily",
    ],
  },
  {
    expectedEligiblePartialRouteIds: ["lab_glycemia_minimum_route"],
    expectedFullSupportedRouteId: null,
    expectedFullSupportedRouteReady: false,
    recipeId: "lab_glycemia_minimum_manifest",
    recipeRouteGroupId: "lab_glycemia_minimum_route",
    routeKind: "partial_lab_route",
    routeUse: "minimum bloodwork/lab manifest when wearable activity is not yet available",
    sourceFamiliesToDeclareAvailable: [
      "outcome_linkage",
      "join_time_alignment",
      "bloodwork_glycemia",
    ],
  },
  {
    expectedEligiblePartialRouteIds: ["wearable_activity_minimum_route"],
    expectedFullSupportedRouteId: null,
    expectedFullSupportedRouteReady: false,
    recipeId: "wearable_activity_minimum_manifest",
    recipeRouteGroupId: "wearable_activity_minimum_route",
    routeKind: "partial_wearable_route",
    routeUse: "minimum wearable manifest when bloodwork is not yet available",
    sourceFamiliesToDeclareAvailable: [
      "outcome_linkage",
      "join_time_alignment",
      "wearable_activity_daily",
    ],
  },
  {
    expectedEligiblePartialRouteIds: [
      "lab_glycemia_minimum_route",
      "common_lab_core_with_context_route",
      "wearable_activity_minimum_route",
    ],
    expectedFullSupportedRouteId: "full_labs_wearable_first_pass_route",
    expectedFullSupportedRouteReady: true,
    recipeId: "full_labs_wearable_first_pass_manifest",
    recipeRouteGroupId: "full_labs_wearable_first_pass_route",
    routeKind: "full_supported_route",
    routeUse: "full first-pass manifest for L1/L2/W1/QC evidence gates",
    sourceFamiliesToDeclareAvailable: [
      "outcome_linkage",
      "join_time_alignment",
      "bloodwork_glycemia",
      "common_bloodwork_core",
      "vitals_body_context",
      "wearable_activity_daily",
    ],
  },
] as const;

type PacketConclusion =
  | "ordinary_availability_manifest_packet_blocked_missing_required_availability"
  | "ordinary_availability_manifest_packet_ready_for_private_config_mapping"
  | "ordinary_availability_manifest_packet_ready_for_private_runner"
  | "ordinary_availability_manifest_packet_waiting_on_row_owner_manifest"
  | "ordinary_availability_manifest_packet_waiting_on_refresh";
type PacketNextAction =
  | "collect_outcome_linked_wearable_and_lab_availability_then_rerun_manifest"
  | "fill_private_config_mapping_for_available_wearables_labs"
  | "fill_r1133_safe_availability_manifest_for_wearables_labs_then_rerun_r1133_r1134"
  | "refresh_r1133_r1134_before_manifest_packet"
  | "run_r1125_private_runner_then_r1124_real_metric_intake";
type CountBand = "unknown" | "below_minimum" | "10_plus" | "50_plus" | "100_plus" | "500_plus";
type ChecklistStatus = "complete" | "missing_or_incomplete" | "waiting_on_refresh";
type RecipeMatchStatus =
  | "blocked_missing_source_families"
  | "matched_current_manifest"
  | "waiting_on_manifest_or_safety_attestations";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface SourceFamilyChecklistItem {
  availabilityStatus: string | null;
  familyId: string;
  inputKind: string;
  mappingStatus: string | null;
  priorityGroup: string;
  priorityRank: number;
  privateDetailsStored: false;
  requiredForCandidateIds: string[];
  requiredPrivateFieldRefFamilies: string[];
  requiredPrivateTableRefs: string[];
  safeManifestQuestion: string;
}

interface AggregateReadinessChecklistItem {
  currentStatus: ChecklistStatus;
  fieldId: string;
  minimumCountBand: CountBand | null;
  safeExpectedValue: string;
}

interface SafeManifestAttestationChecklistItem {
  attestationId: typeof REQUIRED_SAFE_MANIFEST_ATTESTATIONS[number];
  currentStatus: ChecklistStatus;
  safeExpectedValue: true;
}

interface RouteManifestRecipe {
  availabilityManifestSchemaVersion: typeof AVAILABILITY_MANIFEST_SCHEMA_VERSION;
  countBandFloors: {
    eventCountBand: "10_plus";
    usableRecordCountBand: "50_plus";
  };
  expectedEligiblePartialRouteIds: string[];
  expectedFullSupportedRouteId: string | null;
  expectedFullSupportedRouteReady: boolean;
  fullEvidenceGateClearedByRecipe: false;
  primarySubmitterInputFamilyIds: string[];
  productDisplayAuthorized: false;
  recipeId: string;
  recipeOnlyNoClaimOfAvailability: true;
  recipeRouteGroupId: string;
  requiredLinkageFamilyIds: typeof REQUIRED_LINKAGE_FAMILY_IDS[number][];
  routeKind: string;
  routeUse: string;
  runsWithR1142PartialPrivateChain: true;
  selectedTableLayoutOptions: typeof ACCEPTED_TABLE_LAYOUTS[number][];
  sourceFamiliesToDeclareAvailable: string[];
  sourceFamiliesToDeclareUnavailable: string[];
  targetAgeBand: "roughly_16_50";
}

interface RouteManifestRecipeMatch {
  currentStatus: RecipeMatchStatus;
  expectedEligiblePartialRouteIds: string[];
  expectedFullSupportedRouteReady: boolean;
  missingSourceFamilyIds: string[];
  productDisplayAuthorized: false;
  recipeId: string;
  recipeRouteGroupId: string;
}

export interface R1135OrdinaryConsumerAvailabilityManifestPacketOptions {
  createdAt?: string;
  outputDir?: string;
  r1076Path?: string;
  r1133Path?: string;
  r1134Path?: string;
}

export interface R1135OrdinaryConsumerAvailabilityManifestPacketOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1135: false;
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
    rowParsingPerformedByR1135: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  availabilityManifestPacket: {
    acceptedTableLayouts: string[];
    aggregateReadinessChecklist: AggregateReadinessChecklistItem[];
    availabilityManifestSchemaVersion: typeof AVAILABILITY_MANIFEST_SCHEMA_VERSION;
    blockers: string[];
    candidateRunOrderIds: string[];
    commands: {
      availabilityConfigBridgeCommand: string | null;
      availabilityManifestPacketCommand: typeof R1135_PACKET_COMMAND;
      availabilityManifestRecipeMaterializerCommand: typeof R1143_MANIFEST_RECIPE_MATERIALIZER_COMMAND;
      availabilityPreflightCommand: string | null;
      configIntakeCommand: string | null;
      currentLoopCommand: string;
      metricIntakeCommand: string | null;
      privateRunnerCommand: string | null;
      recipeReadinessChainRunnerCommand: typeof R1144_RECIPE_READINESS_CHAIN_RUNNER_COMMAND;
    };
    countBandDefinitions: Array<{
      countBand: CountBand;
      meetsEventFloor: boolean;
      meetsUsableRecordFloor: boolean;
      safeMeaning: string;
    }>;
    fillableManifestArtifact: string | null;
    forbiddenManifestContent: typeof FORBIDDEN_MANIFEST_CONTENT[number][];
    currentManifestRecipeMatches: RouteManifestRecipeMatch[];
    manifestRecipeMaterializerCommand: typeof R1143_MANIFEST_RECIPE_MATERIALIZER_COMMAND;
    partialPrivateChainRunnerCommand: typeof R1142_PARTIAL_PRIVATE_CHAIN_RUNNER_COMMAND;
    partialRouteManifestRecipes: RouteManifestRecipe[];
    preferredManifestRecipeIds: string[];
    primarySubmitterInputFamilyIds: typeof PRIMARY_SUBMITTER_INPUT_FAMILY_IDS[number][];
    privateDetailsStored: false;
    safeManifestAttestationChecklist: SafeManifestAttestationChecklistItem[];
    safeManifestAttestationsComplete: boolean;
    requiredLinkageFamilyIds: typeof REQUIRED_LINKAGE_FAMILY_IDS[number][];
    recipeReadinessChainRunnerCommand: typeof R1144_RECIPE_READINESS_CHAIN_RUNNER_COMMAND;
    safeCompletionOrder: string[];
    selectedTableLayout: string | null;
    sourceFamilyChecklist: SourceFamilyChecklistItem[];
  };
  createdAt: string;
  inputArtifacts: {
    r1076: ArtifactSummary;
    r1133: ArtifactSummary;
    r1134: ArtifactSummary;
  };
  packetId: "r1135-ordinary-consumer-availability-manifest-packet";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1135_ORDINARY_CONSUMER_AVAILABILITY_MANIFEST_PACKET_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: PacketConclusion;
    currentLoopNextAction: string | null;
    matchedManifestRecipeIds: string[];
    manifestRecipeMaterializerCommand: typeof R1143_MANIFEST_RECIPE_MATERIALIZER_COMMAND;
    missingSourceFamilyIds: string[];
    nextAction: PacketNextAction;
    partialPrivateChainRunnerCommand: typeof R1142_PARTIAL_PRIVATE_CHAIN_RUNNER_COMMAND;
    partialRouteManifestRecipeIds: string[];
    preferredManifestRecipeIds: string[];
    primarySubmitterInputFamilyIds: typeof PRIMARY_SUBMITTER_INPUT_FAMILY_IDS[number][];
    productDisplayAuthorized: false;
    readyForPrivateConfigMapping: boolean;
    readyForPrivateRunner: boolean;
    realAggregateStillMissing: boolean;
    requiredLinkageFamilyIds: typeof REQUIRED_LINKAGE_FAMILY_IDS[number][];
    recipeReadinessChainRunnerCommand: typeof R1144_RECIPE_READINESS_CHAIN_RUNNER_COMMAND;
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1135: false;
    safeManifestAttestationsComplete: boolean;
    targetAgeBand: "roughly_16_50";
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first";
  };
}

export async function runR1135OrdinaryConsumerAvailabilityManifestPacket(
  options: R1135OrdinaryConsumerAvailabilityManifestPacketOptions = {},
): Promise<{ output: R1135OrdinaryConsumerAvailabilityManifestPacketOutput; outputPath: string }> {
  const r1076 = await readJsonIfPresent(options.r1076Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1076_EXPECTED.artifact));
  const r1133 = await readJsonIfPresent(options.r1133Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1133_EXPECTED.artifact));
  const r1134 = await readJsonIfPresent(options.r1134Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1134_EXPECTED.artifact));
  validateInputBoundary("r1076", r1076);
  validateInputBoundary("r1133", r1133);
  validateInputBoundary("r1134", r1134);

  const r1076Expected = matchesExpected(r1076, R1076_EXPECTED);
  const r1133Expected = matchesExpected(r1133, R1133_EXPECTED);
  const r1134Expected = matchesExpected(r1134, R1134_EXPECTED);
  const readyForPrivateConfigMapping = r1134Expected
    && readBooleanAt(r1134, ["summary", "readyForPrivateConfigMapping"]) === true;
  const readyForPrivateRunner = r1134Expected
    && readBooleanAt(r1134, ["summary", "readyForPrivateRunner"]) === true;
  const conclusion = conclusionFor({
    mappingPlanStatus: r1134Expected ? readStringAt(r1134, ["summary", "mappingPlanStatus"]) : null,
    manifestStatus: r1133Expected ? readStringAt(r1133, ["summary", "manifestStatus"]) : null,
    r1133Expected,
    r1134Expected,
    readyForPrivateConfigMapping,
    readyForPrivateRunner,
  });
  const nextAction = nextActionFor(conclusion);
  const missingSourceFamilyIds = r1134Expected
    ? readStringArrayAt(r1134, ["summary", "missingSourceFamilyIds"])
    : readStringArrayAt(r1133, ["summary", "missingSourceFamilyIds"]);
  const currentManifestRecipeMatches = currentManifestRecipeMatchesFor({
    r1133,
    r1133Expected,
  });
  const matchedManifestRecipeIds = currentManifestRecipeMatches
    .filter((match) => match.currentStatus === "matched_current_manifest")
    .map((match) => match.recipeId);

  const output: R1135OrdinaryConsumerAvailabilityManifestPacketOutput = {
    artifactBoundary: safeBoundary(),
    availabilityManifestPacket: {
      acceptedTableLayouts: readStringArrayAt(r1133, ["ordinaryDataAvailabilityPreflight", "acceptedTableLayouts"]),
      aggregateReadinessChecklist: aggregateReadinessChecklistFor({ r1133, r1133Expected }),
      availabilityManifestSchemaVersion: AVAILABILITY_MANIFEST_SCHEMA_VERSION,
      blockers: blockersFor({ r1133, r1134, r1133Expected, r1134Expected }),
      candidateRunOrderIds: readStringArrayAt(r1134, [
        "availabilityConfigBridge",
        "mappingPlan",
        "candidateRunOrderIds",
      ]),
      commands: {
        availabilityConfigBridgeCommand: readStringAt(r1134, [
          "availabilityConfigBridge",
          "commands",
          "availabilityConfigBridgeCommand",
        ]),
        availabilityManifestPacketCommand: R1135_PACKET_COMMAND,
        availabilityManifestRecipeMaterializerCommand: R1143_MANIFEST_RECIPE_MATERIALIZER_COMMAND,
        availabilityPreflightCommand: readStringAt(r1133, [
          "ordinaryDataAvailabilityPreflight",
          "commands",
          "availabilityPreflightCommand",
        ]),
        configIntakeCommand: readStringAt(r1134, [
          "availabilityConfigBridge",
          "commands",
          "configIntakeCommand",
        ]),
        currentLoopCommand: "pnpm exec tsx scripts/murph-age/r1076-current-autoresearch-loop-executor.ts",
        metricIntakeCommand: readStringAt(r1134, [
          "availabilityConfigBridge",
          "commands",
          "metricIntakeCommand",
        ]),
        privateRunnerCommand: readStringAt(r1134, [
          "availabilityConfigBridge",
          "commands",
          "privateRunnerCommand",
        ]),
        recipeReadinessChainRunnerCommand: R1144_RECIPE_READINESS_CHAIN_RUNNER_COMMAND,
      },
      countBandDefinitions: countBandDefinitions(),
      currentManifestRecipeMatches,
      fillableManifestArtifact: readStringAt(r1133, [
        "ordinaryDataAvailabilityPreflight",
        "fillableManifestArtifact",
      ]),
      forbiddenManifestContent: [...FORBIDDEN_MANIFEST_CONTENT],
      manifestRecipeMaterializerCommand: R1143_MANIFEST_RECIPE_MATERIALIZER_COMMAND,
      partialPrivateChainRunnerCommand: R1142_PARTIAL_PRIVATE_CHAIN_RUNNER_COMMAND,
      partialRouteManifestRecipes: routeManifestRecipes(),
      preferredManifestRecipeIds: preferredManifestRecipeIds(),
      primarySubmitterInputFamilyIds: [...PRIMARY_SUBMITTER_INPUT_FAMILY_IDS],
      privateDetailsStored: false,
      safeManifestAttestationChecklist: safeManifestAttestationChecklistFor(r1133),
      safeManifestAttestationsComplete: readBooleanAt(r1133, ["summary", "safeManifestAttestationsComplete"]) === true,
      requiredLinkageFamilyIds: [...REQUIRED_LINKAGE_FAMILY_IDS],
      recipeReadinessChainRunnerCommand: R1144_RECIPE_READINESS_CHAIN_RUNNER_COMMAND,
      safeCompletionOrder: safeCompletionOrderFor(conclusion),
      selectedTableLayout: readStringAt(r1134, ["summary", "selectedTableLayout"]),
      sourceFamilyChecklist: sourceFamilyChecklistFor({ r1133, r1134 }),
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: {
      r1076: summarizeInput(R1076_EXPECTED, r1076),
      r1133: summarizeInput(R1133_EXPECTED, r1133),
      r1134: summarizeInput(R1134_EXPECTED, r1134),
    },
    packetId: "r1135-ordinary-consumer-availability-manifest-packet",
    productDisplayAuthorized: false,
    schemaVersion: R1135_ORDINARY_CONSUMER_AVAILABILITY_MANIFEST_PACKET_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      currentLoopNextAction: r1076Expected ? readStringAt(r1076, ["summary", "nextAction"]) : null,
      matchedManifestRecipeIds,
      manifestRecipeMaterializerCommand: R1143_MANIFEST_RECIPE_MATERIALIZER_COMMAND,
      missingSourceFamilyIds,
      nextAction,
      partialPrivateChainRunnerCommand: R1142_PARTIAL_PRIVATE_CHAIN_RUNNER_COMMAND,
      partialRouteManifestRecipeIds: routeManifestRecipes().map((recipe) => recipe.recipeId),
      preferredManifestRecipeIds: preferredManifestRecipeIds(),
      primarySubmitterInputFamilyIds: [...PRIMARY_SUBMITTER_INPUT_FAMILY_IDS],
      productDisplayAuthorized: false,
      readyForPrivateConfigMapping,
      readyForPrivateRunner,
      realAggregateStillMissing: !readyForPrivateRunner,
      requiredLinkageFamilyIds: [...REQUIRED_LINKAGE_FAMILY_IDS],
      recipeReadinessChainRunnerCommand: R1144_RECIPE_READINESS_CHAIN_RUNNER_COMMAND,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1135: false,
      safeManifestAttestationsComplete: readBooleanAt(r1133, ["summary", "safeManifestAttestationsComplete"]) === true,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1135 ordinary consumer availability manifest packet failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function validateInputBoundary(name: string, value: unknown | null): void {
  if (!value) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1135 ${name} failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }
}

function conclusionFor(input: {
  mappingPlanStatus: string | null;
  manifestStatus: string | null;
  r1133Expected: boolean;
  r1134Expected: boolean;
  readyForPrivateConfigMapping: boolean;
  readyForPrivateRunner: boolean;
}): PacketConclusion {
  if (!input.r1133Expected || !input.r1134Expected) {
    return "ordinary_availability_manifest_packet_waiting_on_refresh";
  }
  if (input.readyForPrivateRunner) {
    return "ordinary_availability_manifest_packet_ready_for_private_runner";
  }
  if (input.readyForPrivateConfigMapping || input.mappingPlanStatus === "ready_for_private_config_mapping") {
    return "ordinary_availability_manifest_packet_ready_for_private_config_mapping";
  }
  if (input.manifestStatus !== "provided") {
    return "ordinary_availability_manifest_packet_waiting_on_row_owner_manifest";
  }
  return "ordinary_availability_manifest_packet_blocked_missing_required_availability";
}

function nextActionFor(conclusion: PacketConclusion): PacketNextAction {
  if (conclusion === "ordinary_availability_manifest_packet_waiting_on_refresh") {
    return "refresh_r1133_r1134_before_manifest_packet";
  }
  if (conclusion === "ordinary_availability_manifest_packet_waiting_on_row_owner_manifest") {
    return "fill_r1133_safe_availability_manifest_for_wearables_labs_then_rerun_r1133_r1134";
  }
  if (conclusion === "ordinary_availability_manifest_packet_blocked_missing_required_availability") {
    return "collect_outcome_linked_wearable_and_lab_availability_then_rerun_manifest";
  }
  if (conclusion === "ordinary_availability_manifest_packet_ready_for_private_runner") {
    return "run_r1125_private_runner_then_r1124_real_metric_intake";
  }
  return "fill_private_config_mapping_for_available_wearables_labs";
}

function blockersFor(input: {
  r1133: unknown | null;
  r1134: unknown | null;
  r1133Expected: boolean;
  r1134Expected: boolean;
}): string[] {
  const blockers = new Set<string>();
  if (!input.r1133Expected) blockers.add("r1133_availability_preflight_missing_or_stale");
  if (!input.r1134Expected) blockers.add("r1134_availability_config_bridge_missing_or_stale");
  for (const blocker of readStringArrayAt(input.r1133, ["ordinaryDataAvailabilityPreflight", "blockers"])) {
    blockers.add(blocker);
  }
  for (const blocker of readStringArrayAt(input.r1134, ["availabilityConfigBridge", "blockers"])) {
    blockers.add(blocker);
  }
  return [...blockers];
}

function sourceFamilyChecklistFor(input: {
  r1133: unknown | null;
  r1134: unknown | null;
}): SourceFamilyChecklistItem[] {
  const availabilityFamilies = readObjectArrayAt(input.r1133, [
    "ordinaryDataAvailabilityPreflight",
    "sourceFamilies",
  ]);
  const mappingFamilies = readObjectArrayAt(input.r1134, [
    "availabilityConfigBridge",
    "mappingPlan",
    "sourceFamilyMappings",
  ]);
  return ORDINARY_SOURCE_FAMILY_PRIORITY.map((priority) => {
    const availabilityFamily = availabilityFamilies.find(
      (family) => readStringAt(family, ["familyId"]) === priority.familyId,
    ) ?? null;
    const mappingFamily = mappingFamilies.find(
      (family) => readStringAt(family, ["familyId"]) === priority.familyId,
    ) ?? null;
    return {
      availabilityStatus: readStringAt(availabilityFamily, ["status"])
        ?? readStringAt(mappingFamily, ["availabilityStatus"]),
      familyId: priority.familyId,
      inputKind: readStringAt(availabilityFamily, ["inputKind"])
        ?? readStringAt(mappingFamily, ["inputKind"])
        ?? priority.inputKind,
      mappingStatus: readStringAt(mappingFamily, ["mappingStatus"]),
      priorityGroup: priority.priorityGroup,
      priorityRank: priority.priorityRank,
      privateDetailsStored: false,
      requiredForCandidateIds: readStringArrayAt(mappingFamily, ["requiredForCandidateIds"]),
      requiredPrivateFieldRefFamilies: readStringArrayAt(mappingFamily, ["requiredPrivateFieldRefFamilies"]),
      requiredPrivateTableRefs: readStringArrayAt(mappingFamily, ["requiredPrivateTableRefs"]),
      safeManifestQuestion: priority.safeManifestQuestion,
    };
  });
}

function routeManifestRecipes(): RouteManifestRecipe[] {
  return ROUTE_MANIFEST_RECIPES.map((recipe): RouteManifestRecipe => {
    const available = new Set<string>(recipe.sourceFamiliesToDeclareAvailable);
    return {
      availabilityManifestSchemaVersion: AVAILABILITY_MANIFEST_SCHEMA_VERSION,
      countBandFloors: {
        eventCountBand: "10_plus",
        usableRecordCountBand: "50_plus",
      },
      expectedEligiblePartialRouteIds: [...recipe.expectedEligiblePartialRouteIds],
      expectedFullSupportedRouteId: recipe.expectedFullSupportedRouteId,
      expectedFullSupportedRouteReady: recipe.expectedFullSupportedRouteReady,
      fullEvidenceGateClearedByRecipe: false,
      primarySubmitterInputFamilyIds: PRIMARY_SUBMITTER_INPUT_FAMILY_IDS.filter((familyId) => available.has(familyId)),
      productDisplayAuthorized: false,
      recipeId: recipe.recipeId,
      recipeOnlyNoClaimOfAvailability: true,
      recipeRouteGroupId: recipe.recipeRouteGroupId,
      requiredLinkageFamilyIds: [...REQUIRED_LINKAGE_FAMILY_IDS],
      routeKind: recipe.routeKind,
      routeUse: recipe.routeUse,
      runsWithR1142PartialPrivateChain: true,
      selectedTableLayoutOptions: [...ACCEPTED_TABLE_LAYOUTS],
      sourceFamiliesToDeclareAvailable: [...recipe.sourceFamiliesToDeclareAvailable],
      sourceFamiliesToDeclareUnavailable: ORDINARY_SOURCE_FAMILY_PRIORITY
        .map((family) => family.familyId)
        .filter((familyId) => !available.has(familyId)),
      targetAgeBand: "roughly_16_50",
    };
  });
}

function currentManifestRecipeMatchesFor(input: {
  r1133: unknown | null;
  r1133Expected: boolean;
}): RouteManifestRecipeMatch[] {
  const availableSourceFamilyIds = new Set(
    readObjectArrayAt(input.r1133, ["ordinaryDataAvailabilityPreflight", "sourceFamilies"])
      .filter((family) => readStringAt(family, ["status"]) === "declared_available")
      .map((family) => readStringAt(family, ["familyId"]))
      .filter((familyId): familyId is string => Boolean(familyId)),
  );
  const canMatch = input.r1133Expected
    && readStringAt(input.r1133, ["summary", "manifestStatus"]) === "provided"
    && readBooleanAt(input.r1133, ["summary", "safeManifestAttestationsComplete"]) === true;
  return ROUTE_MANIFEST_RECIPES.map((recipe): RouteManifestRecipeMatch => {
    const missingSourceFamilyIds = recipe.sourceFamiliesToDeclareAvailable.filter(
      (familyId) => !availableSourceFamilyIds.has(familyId),
    );
    return {
      currentStatus: !canMatch
        ? "waiting_on_manifest_or_safety_attestations"
        : missingSourceFamilyIds.length === 0
          ? "matched_current_manifest"
          : "blocked_missing_source_families",
      expectedEligiblePartialRouteIds: [...recipe.expectedEligiblePartialRouteIds],
      expectedFullSupportedRouteReady: recipe.expectedFullSupportedRouteReady,
      missingSourceFamilyIds,
      productDisplayAuthorized: false,
      recipeId: recipe.recipeId,
      recipeRouteGroupId: recipe.recipeRouteGroupId,
    };
  });
}

function preferredManifestRecipeIds(): string[] {
  return ROUTE_MANIFEST_RECIPES.map((recipe) => recipe.recipeId);
}

function aggregateReadinessChecklistFor(input: {
  r1133: unknown | null;
  r1133Expected: boolean;
}): AggregateReadinessChecklistItem[] {
  const readinessPath = ["ordinaryDataAvailabilityPreflight", "aggregateReadinessFacts"] as const;
  const waitingStatus: ChecklistStatus = input.r1133Expected ? "missing_or_incomplete" : "waiting_on_refresh";
  const eventCountBand = readCountBandAt(input.r1133, [...readinessPath, "eventCountBand"]);
  const usableRecordCountBand = readCountBandAt(input.r1133, [...readinessPath, "usableRecordCountBand"]);
  return [
    {
      currentStatus: readStringAt(input.r1133, [...readinessPath, "targetAgeBand"]) === "roughly_16_50"
        ? "complete"
        : waitingStatus,
      fieldId: "targetAgeBand",
      minimumCountBand: null,
      safeExpectedValue: "roughly_16_50",
    },
    {
      currentStatus: readBooleanAt(input.r1133, [...readinessPath, "outcomeLinked"]) === true
        ? "complete"
        : waitingStatus,
      fieldId: "outcomeLinked",
      minimumCountBand: null,
      safeExpectedValue: "true when outcomes/follow-up can be linked to the same denominator",
    },
    {
      currentStatus: readBooleanAt(input.r1133, [...readinessPath, "sameDenominator"]) === true
        ? "complete"
        : waitingStatus,
      fieldId: "sameDenominator",
      minimumCountBand: null,
      safeExpectedValue: "true when labs, wearables, vitals, and outcomes refer to the same eligible people",
    },
    {
      currentStatus: countBandMeets(eventCountBand, "10_plus") ? "complete" : waitingStatus,
      fieldId: "eventCountBand",
      minimumCountBand: "10_plus",
      safeExpectedValue: "10_plus or larger, never an exact small count",
    },
    {
      currentStatus: countBandMeets(usableRecordCountBand, "50_plus") ? "complete" : waitingStatus,
      fieldId: "usableRecordCountBand",
      minimumCountBand: "50_plus",
      safeExpectedValue: "50_plus or larger, never an exact small count",
    },
    {
      currentStatus: readStringAt(input.r1133, ["ordinaryDataAvailabilityPreflight", "selectedTableLayout"])
        ? "complete"
        : waitingStatus,
      fieldId: "selectedTableLayout",
      minimumCountBand: null,
      safeExpectedValue: "single_primary_table_fallback or multi_table_or_explicit_refs",
    },
  ];
}

function safeManifestAttestationChecklistFor(r1133: unknown | null): SafeManifestAttestationChecklistItem[] {
  const checklist = readObjectArrayAt(r1133, [
    "ordinaryDataAvailabilityPreflight",
    "safeManifestAttestations",
    "checklist",
  ]);
  return REQUIRED_SAFE_MANIFEST_ATTESTATIONS.map((attestationId) => {
    const item = checklist.find((candidate) => readStringAt(candidate, ["attestationId"]) === attestationId) ?? null;
    return {
      attestationId,
      currentStatus: readStringAt(item, ["currentStatus"]) === "complete" ? "complete" : "missing_or_incomplete",
      safeExpectedValue: true,
    };
  });
}

function countBandDefinitions(): R1135OrdinaryConsumerAvailabilityManifestPacketOutput["availabilityManifestPacket"]["countBandDefinitions"] {
  return [
    {
      countBand: "unknown",
      meetsEventFloor: false,
      meetsUsableRecordFloor: false,
      safeMeaning: "availability has not been safely declared yet",
    },
    {
      countBand: "below_minimum",
      meetsEventFloor: false,
      meetsUsableRecordFloor: false,
      safeMeaning: "aggregate evidence is below the required first-pass floor",
    },
    {
      countBand: "10_plus",
      meetsEventFloor: true,
      meetsUsableRecordFloor: false,
      safeMeaning: "event count meets the minimum event floor",
    },
    {
      countBand: "50_plus",
      meetsEventFloor: true,
      meetsUsableRecordFloor: true,
      safeMeaning: "usable record count meets the minimum first-pass floor",
    },
    {
      countBand: "100_plus",
      meetsEventFloor: true,
      meetsUsableRecordFloor: true,
      safeMeaning: "usable record count is comfortably above the minimum first-pass floor",
    },
    {
      countBand: "500_plus",
      meetsEventFloor: true,
      meetsUsableRecordFloor: true,
      safeMeaning: "usable record count is large for the first-pass ordinary submitter route",
    },
  ];
}

function safeCompletionOrderFor(conclusion: PacketConclusion): string[] {
  if (conclusion === "ordinary_availability_manifest_packet_waiting_on_refresh") {
    return [
      "refresh_r1133_availability_preflight",
      "refresh_r1134_availability_config_bridge",
      "rerun_r1135_manifest_packet",
    ];
  }
  if (conclusion === "ordinary_availability_manifest_packet_ready_for_private_runner") {
    return [
      "run_r1125_private_runner",
      "run_r1124_real_metric_intake",
      "rerun_r1076_current_loop",
    ];
  }
  if (conclusion === "ordinary_availability_manifest_packet_ready_for_private_config_mapping") {
    return [
      "fill_private_config_mapping_for_declared_available_sources",
      "run_r1122_config_intake",
      "run_r1125_private_runner",
      "run_r1124_real_metric_intake",
    ];
  }
  return [
    "fill_safe_r1133_availability_manifest_boolean_source_families",
    "declare_target_age_band_as_roughly_16_50",
    "declare_outcome_linked_same_denominator_status",
    "choose_accepted_table_layout",
    "declare_event_and_usable_record_count_bands",
    "rerun_r1133_then_r1134_then_r1135",
  ];
}

function readCountBandAt(value: unknown | null, pathParts: readonly string[]): CountBand {
  const countBand = readStringAt(value, pathParts);
  return isCountBand(countBand) ? countBand : "unknown";
}

function countBandMeets(value: CountBand, minimum: "10_plus" | "50_plus"): boolean {
  const rank: Record<CountBand, number> = {
    unknown: 0,
    below_minimum: 0,
    "10_plus": 1,
    "50_plus": 2,
    "100_plus": 3,
    "500_plus": 4,
  };
  return rank[value] >= rank[minimum];
}

function isCountBand(value: string | null): value is CountBand {
  return value === "unknown"
    || value === "below_minimum"
    || value === "10_plus"
    || value === "50_plus"
    || value === "100_plus"
    || value === "500_plus";
}

function summarizeInput(
  expected: typeof R1076_EXPECTED | typeof R1133_EXPECTED | typeof R1134_EXPECTED,
  input: unknown | null,
): ArtifactSummary {
  const packetId = readStringAt(input, ["packetId"]);
  const schemaVersion = readStringAt(input, ["schemaVersion"]);
  return {
    artifact: expected.artifact,
    packetId: packetId === expected.packetId ? expected.packetId : null,
    schemaVersion: schemaVersion === expected.schemaVersion ? expected.schemaVersion : null,
    status: input ? "available" : "missing",
  };
}

function matchesExpected(
  input: unknown | null,
  expected: typeof R1076_EXPECTED | typeof R1133_EXPECTED | typeof R1134_EXPECTED,
): boolean {
  return readStringAt(input, ["packetId"]) === expected.packetId
    && readStringAt(input, ["schemaVersion"]) === expected.schemaVersion;
}

function readBooleanAt(value: unknown | null, pathParts: readonly string[]): boolean | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "boolean" ? resolved : null;
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
    ? resolved.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
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

function safeBoundary(): R1135OrdinaryConsumerAvailabilityManifestPacketOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1135: false,
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
    rowParsingPerformedByR1135: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1135OrdinaryConsumerAvailabilityManifestPacket({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1076Path: process.env.MURPH_AGE_R1076_CURRENT_AUTORESEARCH_LOOP_EXECUTOR_PATH,
    r1133Path: process.env.MURPH_AGE_R1133_ORDINARY_CONSUMER_DATA_AVAILABILITY_PREFLIGHT_PATH,
    r1134Path: process.env.MURPH_AGE_R1134_ORDINARY_CONSUMER_AVAILABILITY_CONFIG_BRIDGE_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    currentLoopNextAction: output.summary.currentLoopNextAction,
    currentManifestRecipeMatches: output.availabilityManifestPacket.currentManifestRecipeMatches,
    matchedManifestRecipeIds: output.summary.matchedManifestRecipeIds,
    manifestRecipeMaterializerCommand: output.summary.manifestRecipeMaterializerCommand,
    missingSourceFamilyIds: output.summary.missingSourceFamilyIds,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    partialPrivateChainRunnerCommand: output.summary.partialPrivateChainRunnerCommand,
    partialRouteManifestRecipeIds: output.summary.partialRouteManifestRecipeIds,
    preferredManifestRecipeIds: output.summary.preferredManifestRecipeIds,
    primarySubmitterInputFamilyIds: output.summary.primarySubmitterInputFamilyIds,
    productDisplayAuthorized: output.productDisplayAuthorized,
    readyForPrivateConfigMapping: output.summary.readyForPrivateConfigMapping,
    readyForPrivateRunner: output.summary.readyForPrivateRunner,
    requiredLinkageFamilyIds: output.summary.requiredLinkageFamilyIds,
    recipeReadinessChainRunnerCommand: output.summary.recipeReadinessChainRunnerCommand,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowParsingPerformedByR1135: output.summary.rowParsingPerformedByR1135,
    safeManifestAttestationsComplete: output.summary.safeManifestAttestationsComplete,
    schemaVersion: output.schemaVersion,
    safeManifestAttestationChecklist: output.availabilityManifestPacket.safeManifestAttestationChecklist,
    sourceFamilyChecklist: output.availabilityManifestPacket.sourceFamilyChecklist.map((family) => ({
      familyId: family.familyId,
      priorityGroup: family.priorityGroup,
      priorityRank: family.priorityRank,
      availabilityStatus: family.availabilityStatus,
      mappingStatus: family.mappingStatus,
    })),
    status: output.status,
  }, null, 2)}\n`);
}

function formatFindingCount(findings: readonly string[]): string {
  return `${findings.length} aggregate-egress violation${findings.length === 1 ? "" : "s"}`;
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1135 ordinary consumer availability manifest packet failed.")}\n`);
    process.exitCode = 1;
  });
}
