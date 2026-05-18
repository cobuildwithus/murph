import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1154_ORDINARY_CONSUMER_SAFE_AVAILABILITY_ACTION_PACKET_SCHEMA_VERSION =
  "murph-age-r1154-ordinary-consumer-safe-availability-action-packet.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1154-ordinary-consumer-safe-availability-action-packet.latest.json";
const FEATURE_ONLY_QUICKSTART_FILE_NAME =
  "r1154-feature-only-safe-confirmation-quickstart.json" as const;
const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first" as const;
const TARGET_AGE_BAND = "roughly_16_50" as const;
const PREFERRED_RECIPE_ID = "lab_plus_wearable_minimum_manifest" as const;
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
const FEATURE_ONLY_SOURCE_FAMILY_IDS = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
] as const;
const OPTIONAL_ADD_ON_FAMILY_IDS = [
  "common_bloodwork_core",
  "vitals_body_context",
] as const;
const REQUIRED_AGGREGATE_READINESS_FACT_IDS = [
  "outcomeLinked",
  "sameDenominator",
  "targetAgeBand",
  "usableRecordCountBand",
  "eventCountBand",
] as const;
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
] as const;
const BLOCKED_CONFIRMATION_CONTENT = [
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
const R1150_EXPECTED = {
  artifact: "r1150-ordinary-consumer-safe-availability-confirmation-intake.latest.json",
  packetId: "r1150-ordinary-consumer-safe-availability-confirmation-intake",
  schemaVersion: "murph-age-r1150-ordinary-consumer-safe-availability-confirmation-intake.v1",
} as const;
const R1150_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_COMMAND =
  "MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_PATH=<safe-availability-confirmation.json> pnpm exec tsx scripts/murph-age/r1150-ordinary-consumer-safe-availability-confirmation-intake.ts" as const;
const R1154_SAFE_AVAILABILITY_ACTION_PACKET_COMMAND =
  "MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_PATH=<r1150-intake.json> pnpm exec tsx scripts/murph-age/r1154-ordinary-consumer-safe-availability-action-packet.ts" as const;
const R1153_FEATURE_ONLY_CHAIN_RUNNER_COMMAND =
  "MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_PATH=<safe-availability-confirmation.json> pnpm exec tsx scripts/murph-age/r1153-ordinary-consumer-feature-only-chain-runner.ts" as const;
const R1144_OUTCOME_LINKED_RECIPE_READINESS_COMMAND =
  "MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_PATH=<r1150-intake.json> MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ID=lab_plus_wearable_minimum_manifest pnpm exec tsx scripts/murph-age/r1144-ordinary-consumer-recipe-readiness-chain-runner.ts" as const;
const REQUIRED_R1150_FALSE_BOUNDARY_FLAGS = [
  "availabilityConfirmationPathStored",
  "codebookTextStored",
  "coefficientsStored",
  "confirmationReadErrorStored",
  "fileNamesStored",
  "headerValuesStored",
  "localPathsStored",
  "modelParametersStored",
  "participantIdentifiersStored",
  "participantIdentifiersWritten",
  "predictionsStored",
  "privateConfigValuesStored",
  "privateFieldRefValuesStored",
  "privateFieldRefsStored",
  "privateTableRefValuesStored",
  "privateTableRefsStored",
  "productClaimsIncluded",
  "productDisplayAuthorized",
  "productPromotionAuthorized",
  "recommendationClaimsIncluded",
  "rowParsingPerformedByR1150",
  "rowValuesStored",
  "smallCellsStored",
  "sourceBodiesStored",
  "sourceFileNamesStored",
  "sourceVariableNamesStored",
  "splitMembershipStored",
] as const;
const requiredSourceFamilyIds = new Set<string>(REQUIRED_SOURCE_FAMILY_IDS);
const featureOnlySourceFamilyIds = new Set<string>(FEATURE_ONLY_SOURCE_FAMILY_IDS);

type SourceFamilyId = typeof REQUIRED_SOURCE_FAMILY_IDS[number] | typeof OPTIONAL_ADD_ON_FAMILY_IDS[number];
type FeatureOnlySourceFamilyId = typeof FEATURE_ONLY_SOURCE_FAMILY_IDS[number];
type RequiredAggregateReadinessFactId = typeof REQUIRED_AGGREGATE_READINESS_FACT_IDS[number];
type RequiredAttestationKey = typeof REQUIRED_ATTESTATION_KEYS[number];
type BlockedConfirmationContent = typeof BLOCKED_CONFIRMATION_CONTENT[number];
type OrdinarySubmitterSafeCompletionCheckId =
  | "confirm_target_age_band_without_identifiers"
  | "confirm_glycemia_bloodwork_export_available"
  | "confirm_daily_wearable_activity_export_available"
  | "confirm_no_private_values_in_confirmation"
  | "confirm_outcome_linkage_and_time_alignment_if_model_evidence"
  | "confirm_aggregate_count_bands_if_model_evidence";
type OrdinarySubmitterCompletionModeId =
  | "feature_only_lab_wearable_coverage"
  | "outcome_linked_lab_wearable_model_evidence";
type OrdinarySubmitterCompletionModeType =
  | "feature_only_coverage"
  | "outcome_linked_model_evidence";
type OrdinarySubmitterCompletionModeNextAction =
  | "run_r1144_recipe_readiness_chain"
  | "run_r1153_feature_only_chain";
type PacketConclusion =
  | "safe_availability_action_packet_feature_only_context_available"
  | "safe_availability_action_packet_ready_for_outcome_linked_recipe_readiness"
  | "safe_availability_action_packet_waiting_on_completion"
  | "safe_availability_action_packet_waiting_on_r1149_submitter_kit"
  | "safe_availability_action_packet_waiting_on_r1150_intake"
  | "safe_availability_action_packet_waiting_on_safe_confirmation"
  | "safe_availability_action_packet_waiting_on_valid_safe_confirmation";
type PacketNextAction =
  | "complete_safe_availability_confirmation_template"
  | "fill_feature_only_coverage_context_template"
  | "fill_safe_availability_confirmation_from_template"
  | "refresh_r1149_submitter_kit"
  | "run_r1144_recipe_readiness_chain_with_confirmed_availability"
  | "run_r1153_feature_only_chain_with_safe_availability"
  | "run_r1150_safe_availability_confirmation_intake"
  | "rerun_safe_availability_confirmation_with_valid_json_object";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface OrdinarySubmitterInputKind {
  inputKindId:
    | "lab_portal_export_or_spreadsheet"
    | "optional_vitals_or_body_context"
    | "phone_watch_or_wearable_activity_export";
  mapsToSourceFamilyIds: SourceFamilyId[];
  privateDetailsStored: false;
  requiredForFeatureOnlyPreferredPair: boolean;
  safeSubmitterExample: string;
}

interface OrdinarySubmitterSafeCompletionChecklistItem {
  checkId: OrdinarySubmitterSafeCompletionCheckId;
  mapsToSourceFamilyIds: SourceFamilyId[];
  privateDetailsStored: false;
  requiredForFeatureOnlyPreferredPair: boolean;
  requiredForOutcomeLinkedRecipe: boolean;
  safeCompletionMeaning: string;
}

interface OrdinarySubmitterCompletionMode {
  modeId: OrdinarySubmitterCompletionModeId;
  modeType: OrdinarySubmitterCompletionModeType;
  modelEvidenceCandidate: boolean;
  nextActionAfterR1150: OrdinarySubmitterCompletionModeNextAction;
  outcomeLinkageRequired: boolean;
  privateDetailsStored: false;
  requiredAggregateReadinessFactIds: RequiredAggregateReadinessFactId[];
  requiredAttestationKeys: RequiredAttestationKey[];
  requiredChecklistIds: OrdinarySubmitterSafeCompletionCheckId[];
  requiredSourceFamilyIds: SourceFamilyId[];
  rowLevelDataAccepted: false;
  safeCompletionMeaning: string;
}

interface SourceFamilyChecklistItem {
  familyId: SourceFamilyId;
  missingFromR1150: boolean;
  privateDetailsStored: false;
  requiredForFeatureOnlyPreferredPair: boolean;
  requiredForOutcomeLinkedRecipe: boolean;
  safeConfirmationMeaning: string;
}

interface AggregateReadinessFactChecklistItem {
  factId: RequiredAggregateReadinessFactId;
  missingFromR1150: boolean;
  privateDetailsStored: false;
  requiredForFeatureOnlyContext: boolean;
  requiredForOutcomeLinkedRecipe: true;
  safeConfirmationMeaning: string;
}

interface AttestationChecklistItem {
  attestationKey: RequiredAttestationKey;
  missingFromR1150: boolean;
  privateDetailsStored: false;
  requiredForFeatureOnlyContext: true;
  requiredForOutcomeLinkedRecipe: true;
}

interface FeatureOnlyQuickstartSourceFamily {
  familyId: FeatureOnlySourceFamilyId;
  privateDetailsStored: false;
  safeAvailableMeans: string;
  safeSourceKind:
    | "lab_portal_export_or_spreadsheet"
    | "phone_watch_or_wearable_activity_export";
  setAvailableToTrueOnlyIf: string;
}

interface FeatureOnlyQuickstartFieldEdit {
  fieldPath: string;
  privateDetailsStored: false;
  safeEditMeaning: string;
  setOnlyIf: string;
  setTo: boolean | typeof TARGET_AGE_BAND;
}

interface R1154FeatureOnlySafeConfirmationQuickstart {
  aggregateReadinessFactIdsToConfirm: ["targetAgeBand"];
  attestationsToConfirm: RequiredAttestationKey[];
  blockedConfirmationContent: BlockedConfirmationContent[];
  completionModeId: "feature_only_lab_wearable_coverage";
  featureOnlyChainRunnerCommand: typeof R1153_FEATURE_ONLY_CHAIN_RUNNER_COMMAND;
  featureOnlyFillableTemplateArtifact: string | null;
  fullFillableTemplateArtifact: string | null;
  modelEvidencePromotionAllowed: false;
  nextActionAfterSafeConfirmation: "run_r1153_feature_only_chain_with_safe_availability";
  outcomeLinkageRequiredForFeatureOnlyContext: false;
  productDisplayAuthorized: false;
  privateDetailsStored: false;
  requiredChecklistItemIds: OrdinarySubmitterSafeCompletionCheckId[];
  requiredSourceFamilies: FeatureOnlyQuickstartSourceFamily[];
  reviewGptRequiredNow: false;
  rowLevelDataAcceptedByR1154: false;
  rowParsingPerformedByR1154: false;
  safeAvailabilityConfirmationIntakeCommand: typeof R1150_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_COMMAND;
  safeConfirmationFieldEdits: FeatureOnlyQuickstartFieldEdit[];
  schemaVersion: "murph-age-r1154-feature-only-safe-confirmation-quickstart.v1";
  targetAgeBand: typeof TARGET_AGE_BAND;
  targetInputPriority: typeof TARGET_INPUT_PRIORITY;
}

export interface R1154OrdinaryConsumerSafeAvailabilityActionPacketOptions {
  createdAt?: string;
  outputDir?: string;
  r1150Path?: string;
}

export interface R1154OrdinaryConsumerSafeAvailabilityActionPacketOutput {
  artifactBoundary: {
    aggregateOnly: true;
    availabilityConfirmationPathStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    fileNamesStored: false;
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
    rowLevelDataAcceptedByR1154: false;
    rowParsingPerformedByR1154: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: {
    r1150: ArtifactSummary;
  };
  packetId: "r1154-ordinary-consumer-safe-availability-action-packet";
  productDisplayAuthorized: false;
  safeAvailabilityActionPacket: {
    aggregateReadinessFactChecklist: AggregateReadinessFactChecklistItem[];
    attestationChecklist: AttestationChecklistItem[];
    blockedConfirmationContent: BlockedConfirmationContent[];
    commands: {
      featureOnlyChainRunnerCommand: typeof R1153_FEATURE_ONLY_CHAIN_RUNNER_COMMAND;
      outcomeLinkedRecipeReadinessCommand: typeof R1144_OUTCOME_LINKED_RECIPE_READINESS_COMMAND;
      safeAvailabilityActionPacketCommand: typeof R1154_SAFE_AVAILABILITY_ACTION_PACKET_COMMAND;
      safeAvailabilityConfirmationIntakeCommand: typeof R1150_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_COMMAND;
    };
    expectedRouteIds: typeof EXPECTED_ROUTE_IDS[number][];
    featureOnlyCoverageContextReady: boolean;
    featureOnlyFillableTemplateArtifact: string | null;
    featureOnlyQuickstartArtifact: typeof FEATURE_ONLY_QUICKSTART_FILE_NAME;
    featureOnlyQuickstartSafeFieldEditCount: number;
    featureOnlyQuickstartSafeFieldEditPaths: string[];
    fillableTemplateArtifact: string | null;
    minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
    missingAggregateReadinessFactIds: RequiredAggregateReadinessFactId[];
    missingAttestationKeys: RequiredAttestationKey[];
    missingFeatureOnlySourceFamilyIds: FeatureOnlySourceFamilyId[];
    missingRequiredSourceFamilyIds: typeof REQUIRED_SOURCE_FAMILY_IDS[number][];
    ordinarySubmitterCompletionModes: OrdinarySubmitterCompletionMode[];
    ordinarySubmitterSafeCompletionChecklist: OrdinarySubmitterSafeCompletionChecklistItem[];
    ordinarySubmitterInputKinds: OrdinarySubmitterInputKind[];
    outcomeLinkageRequiredForFeatureOnlyContext: false;
    preferredRecipeId: typeof PREFERRED_RECIPE_ID;
    privateDetailsStored: false;
    readyForOutcomeLinkedRecipeReadinessChain: boolean;
    rowLevelDataAcceptedByR1154: false;
    rowOwnerAssertionsConfirmed: boolean | null;
    rowOwnerWorkType:
      | "complete_safe_availability_confirmation"
      | "fill_safe_availability_confirmation"
      | "refresh_safe_availability_prerequisites"
      | "run_feature_only_chain"
      | "run_outcome_linked_recipe_readiness"
      | "supply_feature_only_coverage_context";
    sourceFamilyChecklist: SourceFamilyChecklistItem[];
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
  schemaVersion: typeof R1154_ORDINARY_CONSUMER_SAFE_AVAILABILITY_ACTION_PACKET_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: PacketConclusion;
    expectedRouteIds: typeof EXPECTED_ROUTE_IDS[number][];
    featureOnlyCoverageContextReady: boolean;
    featureOnlyFillableTemplateArtifact: string | null;
    featureOnlyQuickstartArtifact: typeof FEATURE_ONLY_QUICKSTART_FILE_NAME;
    featureOnlyQuickstartSafeFieldEditCount: number;
    featureOnlyQuickstartSafeFieldEditPaths: string[];
    fillableTemplateArtifact: string | null;
    minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
    missingAggregateReadinessFactIds: RequiredAggregateReadinessFactId[];
    missingAttestationKeys: RequiredAttestationKey[];
    missingFeatureOnlySourceFamilyIds: FeatureOnlySourceFamilyId[];
    missingRequiredSourceFamilyIds: typeof REQUIRED_SOURCE_FAMILY_IDS[number][];
    nextAction: PacketNextAction;
    outcomeLinkageRequiredForFeatureOnlyContext: false;
    ordinarySubmitterCompletionModeIds: OrdinarySubmitterCompletionModeId[];
    ordinarySubmitterSafeCompletionChecklistItemIds: OrdinarySubmitterSafeCompletionCheckId[];
    preferredRecipeId: typeof PREFERRED_RECIPE_ID;
    productDisplayAuthorized: false;
    r1150Conclusion: string | null;
    r1150Expected: boolean;
    r1150SafeArtifactBoundaryPresent: boolean;
    readyForOutcomeLinkedRecipeReadinessChain: boolean;
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1154: false;
    rowOwnerAssertionsConfirmed: boolean | null;
    rowOwnerWorkType: R1154OrdinaryConsumerSafeAvailabilityActionPacketOutput["safeAvailabilityActionPacket"]["rowOwnerWorkType"];
    rowParsingPerformedByR1154: false;
    safeAvailabilityConfirmationStatus: string | null;
    safeAvailabilityConfirmationTemplateArtifact: string | null;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
}

export async function runR1154OrdinaryConsumerSafeAvailabilityActionPacket(
  options: R1154OrdinaryConsumerSafeAvailabilityActionPacketOptions = {},
): Promise<{
  output: R1154OrdinaryConsumerSafeAvailabilityActionPacketOutput;
  outputPath: string;
  quickstartPath: string;
}> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const r1150 = await readJsonIfPresent(options.r1150Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1150_EXPECTED.artifact));
  validateR1150InputBoundary(r1150);
  const r1150Expected = r1150MatchesExpected(r1150);
  const facts = summaryFactsFrom(r1150, r1150Expected);
  const ordinarySubmitterChecklist = ordinarySubmitterSafeCompletionChecklist();
  const ordinarySubmitterModes = ordinarySubmitterCompletionModes();
  const featureOnlyQuickstartFieldEdits = featureOnlySafeConfirmationFieldEdits();
  const featureOnlyQuickstartSafeFieldEditPaths =
    featureOnlyQuickstartFieldEdits.map((edit) => edit.fieldPath);
  const output: R1154OrdinaryConsumerSafeAvailabilityActionPacketOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: {
      r1150: summarizeInput(r1150),
    },
    packetId: "r1154-ordinary-consumer-safe-availability-action-packet",
    productDisplayAuthorized: false,
    safeAvailabilityActionPacket: {
      aggregateReadinessFactChecklist: aggregateReadinessFactChecklist(facts.missingAggregateReadinessFactIds),
      attestationChecklist: attestationChecklist(facts.missingAttestationKeys),
      blockedConfirmationContent: [...BLOCKED_CONFIRMATION_CONTENT],
      commands: {
        featureOnlyChainRunnerCommand: R1153_FEATURE_ONLY_CHAIN_RUNNER_COMMAND,
        outcomeLinkedRecipeReadinessCommand: R1144_OUTCOME_LINKED_RECIPE_READINESS_COMMAND,
        safeAvailabilityActionPacketCommand: R1154_SAFE_AVAILABILITY_ACTION_PACKET_COMMAND,
        safeAvailabilityConfirmationIntakeCommand: R1150_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_COMMAND,
      },
      expectedRouteIds: [...EXPECTED_ROUTE_IDS],
      featureOnlyCoverageContextReady: facts.featureOnlyCoverageContextReady,
      featureOnlyFillableTemplateArtifact: facts.featureOnlyTemplateArtifact,
      featureOnlyQuickstartArtifact: FEATURE_ONLY_QUICKSTART_FILE_NAME,
      featureOnlyQuickstartSafeFieldEditCount: featureOnlyQuickstartSafeFieldEditPaths.length,
      featureOnlyQuickstartSafeFieldEditPaths,
      fillableTemplateArtifact: facts.templateArtifact,
      minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      missingAggregateReadinessFactIds: facts.missingAggregateReadinessFactIds,
      missingAttestationKeys: facts.missingAttestationKeys,
      missingFeatureOnlySourceFamilyIds: facts.missingFeatureOnlySourceFamilyIds,
      missingRequiredSourceFamilyIds: facts.missingRequiredSourceFamilyIds,
      ordinarySubmitterCompletionModes: ordinarySubmitterModes,
      ordinarySubmitterSafeCompletionChecklist: ordinarySubmitterChecklist,
      ordinarySubmitterInputKinds: ordinarySubmitterInputKinds(),
      outcomeLinkageRequiredForFeatureOnlyContext: false,
      preferredRecipeId: PREFERRED_RECIPE_ID,
      privateDetailsStored: false,
      readyForOutcomeLinkedRecipeReadinessChain: facts.readyForRecipeReadinessChain,
      rowLevelDataAcceptedByR1154: false,
      rowOwnerAssertionsConfirmed: facts.rowOwnerAssertionsConfirmed,
      rowOwnerWorkType: facts.rowOwnerWorkType,
      sourceFamilyChecklist: sourceFamilyChecklist(facts.missingRequiredSourceFamilyIds),
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
    schemaVersion: R1154_ORDINARY_CONSUMER_SAFE_AVAILABILITY_ACTION_PACKET_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: facts.conclusion,
      expectedRouteIds: [...EXPECTED_ROUTE_IDS],
      featureOnlyCoverageContextReady: facts.featureOnlyCoverageContextReady,
      featureOnlyFillableTemplateArtifact: facts.featureOnlyTemplateArtifact,
      featureOnlyQuickstartArtifact: FEATURE_ONLY_QUICKSTART_FILE_NAME,
      featureOnlyQuickstartSafeFieldEditCount: featureOnlyQuickstartSafeFieldEditPaths.length,
      featureOnlyQuickstartSafeFieldEditPaths,
      fillableTemplateArtifact: facts.templateArtifact,
      minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      missingAggregateReadinessFactIds: facts.missingAggregateReadinessFactIds,
      missingAttestationKeys: facts.missingAttestationKeys,
      missingFeatureOnlySourceFamilyIds: facts.missingFeatureOnlySourceFamilyIds,
      missingRequiredSourceFamilyIds: facts.missingRequiredSourceFamilyIds,
      nextAction: facts.nextAction,
      outcomeLinkageRequiredForFeatureOnlyContext: false,
      ordinarySubmitterCompletionModeIds: ordinarySubmitterModes.map((mode) => mode.modeId),
      ordinarySubmitterSafeCompletionChecklistItemIds: ordinarySubmitterChecklist.map((item) => item.checkId),
      preferredRecipeId: PREFERRED_RECIPE_ID,
      productDisplayAuthorized: false,
      r1150Conclusion: facts.r1150Conclusion,
      r1150Expected,
      r1150SafeArtifactBoundaryPresent: r1150SafeArtifactBoundaryPresent(r1150),
      readyForOutcomeLinkedRecipeReadinessChain: facts.readyForRecipeReadinessChain,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1154: false,
      rowOwnerAssertionsConfirmed: facts.rowOwnerAssertionsConfirmed,
      rowOwnerWorkType: facts.rowOwnerWorkType,
      rowParsingPerformedByR1154: false,
      safeAvailabilityConfirmationStatus: facts.confirmationStatus,
      safeAvailabilityConfirmationTemplateArtifact: facts.templateArtifact,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1154 safe availability action packet failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const quickstart = featureOnlyQuickstartFor(facts, ordinarySubmitterChecklist, featureOnlyQuickstartFieldEdits);
  const quickstartFindings = findForbiddenAggregateEgress(quickstart);
  if (quickstartFindings.length > 0) {
    throw new Error(`R1154 feature-only quickstart failed aggregate-egress validation: ${formatFindingCount(quickstartFindings)}`);
  }

  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  const quickstartPath = path.join(outputDir, FEATURE_ONLY_QUICKSTART_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  await writeFile(quickstartPath, `${JSON.stringify(quickstart, null, 2)}\n`);
  return { output, outputPath, quickstartPath };
}

function summaryFactsFrom(
  r1150: unknown | null,
  r1150Expected: boolean,
): {
  conclusion: PacketConclusion;
  confirmationStatus: string | null;
  featureOnlyCoverageContextReady: boolean;
  missingAggregateReadinessFactIds: RequiredAggregateReadinessFactId[];
  missingAttestationKeys: RequiredAttestationKey[];
  missingFeatureOnlySourceFamilyIds: FeatureOnlySourceFamilyId[];
  missingRequiredSourceFamilyIds: typeof REQUIRED_SOURCE_FAMILY_IDS[number][];
  nextAction: PacketNextAction;
  r1150Conclusion: string | null;
  readyForRecipeReadinessChain: boolean;
  rowOwnerAssertionsConfirmed: boolean | null;
  rowOwnerWorkType: R1154OrdinaryConsumerSafeAvailabilityActionPacketOutput["safeAvailabilityActionPacket"]["rowOwnerWorkType"];
  featureOnlyTemplateArtifact: string | null;
  templateArtifact: string | null;
} {
  if (!r1150Expected) {
    return {
      conclusion: "safe_availability_action_packet_waiting_on_r1150_intake",
      confirmationStatus: null,
      featureOnlyCoverageContextReady: false,
      missingAggregateReadinessFactIds: [...REQUIRED_AGGREGATE_READINESS_FACT_IDS],
      missingAttestationKeys: [...REQUIRED_ATTESTATION_KEYS],
      missingFeatureOnlySourceFamilyIds: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      missingRequiredSourceFamilyIds: [...REQUIRED_SOURCE_FAMILY_IDS],
      nextAction: "run_r1150_safe_availability_confirmation_intake",
      r1150Conclusion: readStringAt(r1150, ["summary", "conclusion"]),
      readyForRecipeReadinessChain: false,
      rowOwnerAssertionsConfirmed: null,
      rowOwnerWorkType: "refresh_safe_availability_prerequisites",
      featureOnlyTemplateArtifact: null,
      templateArtifact: null,
    };
  }

  const r1150Conclusion = readStringAt(r1150, ["summary", "conclusion"]);
  const confirmationStatus = readStringAt(r1150, ["summary", "confirmationStatus"]);
  const featureOnlyCoverageContextReady =
    readBooleanAt(r1150, ["summary", "featureOnlyCoverageContextReady"]) === true;
  const readyForRecipeReadinessChain =
    readBooleanAt(r1150, ["summary", "readyForRecipeReadinessChain"]) === true;
  const rowOwnerAssertionsConfirmed = readBooleanAt(r1150, ["summary", "rowOwnerAssertionsConfirmed"]);
  const missingAggregateReadinessFactIds = typedSubset(
    readStringArrayAt(r1150, ["summary", "missingAggregateReadinessFactIds"]),
    REQUIRED_AGGREGATE_READINESS_FACT_IDS,
  );
  const missingAttestationKeys = typedSubset(
    readStringArrayAt(r1150, ["summary", "missingAttestationKeys"]),
    REQUIRED_ATTESTATION_KEYS,
  );
  const missingFeatureOnlySourceFamilyIds = typedSubset(
    readStringArrayAt(r1150, ["summary", "missingFeatureOnlySourceFamilyIds"]),
    FEATURE_ONLY_SOURCE_FAMILY_IDS,
  );
  const missingRequiredSourceFamilyIds = typedSubset(
    readStringArrayAt(r1150, ["summary", "missingRequiredSourceFamilyIds"]),
    REQUIRED_SOURCE_FAMILY_IDS,
  );
  const templateArtifact = readStringAt(r1150, ["summary", "templateArtifact"]);
  const featureOnlyTemplateArtifact = readStringAt(r1150, ["summary", "featureOnlyTemplateArtifact"]);

  if (r1150Conclusion === "safe_availability_confirmation_waiting_on_r1149_submitter_kit") {
    return {
      conclusion: "safe_availability_action_packet_waiting_on_r1149_submitter_kit",
      confirmationStatus,
      featureOnlyCoverageContextReady,
      missingAggregateReadinessFactIds,
      missingAttestationKeys,
      missingFeatureOnlySourceFamilyIds,
      missingRequiredSourceFamilyIds,
      nextAction: "refresh_r1149_submitter_kit",
      r1150Conclusion,
      readyForRecipeReadinessChain,
      rowOwnerAssertionsConfirmed,
      rowOwnerWorkType: "refresh_safe_availability_prerequisites",
      featureOnlyTemplateArtifact,
      templateArtifact,
    };
  }
  if (readyForRecipeReadinessChain) {
    return {
      conclusion: "safe_availability_action_packet_ready_for_outcome_linked_recipe_readiness",
      confirmationStatus,
      featureOnlyCoverageContextReady,
      missingAggregateReadinessFactIds,
      missingAttestationKeys,
      missingFeatureOnlySourceFamilyIds,
      missingRequiredSourceFamilyIds,
      nextAction: "run_r1144_recipe_readiness_chain_with_confirmed_availability",
      r1150Conclusion,
      readyForRecipeReadinessChain,
      rowOwnerAssertionsConfirmed,
      rowOwnerWorkType: "run_outcome_linked_recipe_readiness",
      featureOnlyTemplateArtifact,
      templateArtifact,
    };
  }
  if (featureOnlyCoverageContextReady) {
    return {
      conclusion: "safe_availability_action_packet_feature_only_context_available",
      confirmationStatus,
      featureOnlyCoverageContextReady,
      missingAggregateReadinessFactIds,
      missingAttestationKeys,
      missingFeatureOnlySourceFamilyIds,
      missingRequiredSourceFamilyIds,
      nextAction: "run_r1153_feature_only_chain_with_safe_availability",
      r1150Conclusion,
      readyForRecipeReadinessChain,
      rowOwnerAssertionsConfirmed,
      rowOwnerWorkType: "run_feature_only_chain",
      featureOnlyTemplateArtifact,
      templateArtifact,
    };
  }
  if (confirmationStatus === "missing") {
    return {
      conclusion: "safe_availability_action_packet_waiting_on_safe_confirmation",
      confirmationStatus,
      featureOnlyCoverageContextReady,
      missingAggregateReadinessFactIds,
      missingAttestationKeys,
      missingFeatureOnlySourceFamilyIds,
      missingRequiredSourceFamilyIds,
      nextAction: "fill_safe_availability_confirmation_from_template",
      r1150Conclusion,
      readyForRecipeReadinessChain,
      rowOwnerAssertionsConfirmed,
      rowOwnerWorkType: "fill_safe_availability_confirmation",
      featureOnlyTemplateArtifact,
      templateArtifact,
    };
  }
  if (r1150Conclusion === "safe_availability_confirmation_invalid") {
    return {
      conclusion: "safe_availability_action_packet_waiting_on_valid_safe_confirmation",
      confirmationStatus,
      featureOnlyCoverageContextReady,
      missingAggregateReadinessFactIds,
      missingAttestationKeys,
      missingFeatureOnlySourceFamilyIds,
      missingRequiredSourceFamilyIds,
      nextAction: "rerun_safe_availability_confirmation_with_valid_json_object",
      r1150Conclusion,
      readyForRecipeReadinessChain,
      rowOwnerAssertionsConfirmed,
      rowOwnerWorkType: "fill_safe_availability_confirmation",
      featureOnlyTemplateArtifact,
      templateArtifact,
    };
  }
  return {
    conclusion: "safe_availability_action_packet_waiting_on_completion",
    confirmationStatus,
    featureOnlyCoverageContextReady,
    missingAggregateReadinessFactIds,
    missingAttestationKeys,
    missingFeatureOnlySourceFamilyIds,
    missingRequiredSourceFamilyIds,
    nextAction: "complete_safe_availability_confirmation_template",
    r1150Conclusion,
    readyForRecipeReadinessChain,
    rowOwnerAssertionsConfirmed,
    rowOwnerWorkType: "complete_safe_availability_confirmation",
    featureOnlyTemplateArtifact,
    templateArtifact,
  };
}

function featureOnlyQuickstartFor(
  facts: ReturnType<typeof summaryFactsFrom>,
  ordinarySubmitterChecklist: readonly OrdinarySubmitterSafeCompletionChecklistItem[],
  featureOnlyQuickstartFieldEdits: readonly FeatureOnlyQuickstartFieldEdit[],
): R1154FeatureOnlySafeConfirmationQuickstart {
  return {
    aggregateReadinessFactIdsToConfirm: ["targetAgeBand"],
    attestationsToConfirm: [...REQUIRED_ATTESTATION_KEYS],
    blockedConfirmationContent: [...BLOCKED_CONFIRMATION_CONTENT],
    completionModeId: "feature_only_lab_wearable_coverage",
    featureOnlyChainRunnerCommand: R1153_FEATURE_ONLY_CHAIN_RUNNER_COMMAND,
    featureOnlyFillableTemplateArtifact: facts.featureOnlyTemplateArtifact,
    fullFillableTemplateArtifact: facts.templateArtifact,
    modelEvidencePromotionAllowed: false,
    nextActionAfterSafeConfirmation: "run_r1153_feature_only_chain_with_safe_availability",
    outcomeLinkageRequiredForFeatureOnlyContext: false,
    productDisplayAuthorized: false,
    privateDetailsStored: false,
    requiredChecklistItemIds: ordinarySubmitterChecklist
      .filter((item) => item.requiredForFeatureOnlyPreferredPair)
      .map((item) => item.checkId),
    requiredSourceFamilies: FEATURE_ONLY_SOURCE_FAMILY_IDS.map(featureOnlyQuickstartSourceFamily),
    reviewGptRequiredNow: false,
    rowLevelDataAcceptedByR1154: false,
    rowParsingPerformedByR1154: false,
    safeAvailabilityConfirmationIntakeCommand: R1150_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_COMMAND,
    safeConfirmationFieldEdits: featureOnlyQuickstartFieldEdits.map((edit) => ({ ...edit })),
    schemaVersion: "murph-age-r1154-feature-only-safe-confirmation-quickstart.v1",
    targetAgeBand: TARGET_AGE_BAND,
    targetInputPriority: TARGET_INPUT_PRIORITY,
  };
}

function featureOnlySafeConfirmationFieldEdits(): FeatureOnlyQuickstartFieldEdit[] {
  return [
    {
      fieldPath: "aggregateReadinessFacts.targetAgeBand",
      privateDetailsStored: false,
      safeEditMeaning: "Keep the confirmation scoped to the ordinary roughly 16-50 submitter path.",
      setOnlyIf:
        "The row owner can confirm the submitted data belongs on the roughly 16-50 path without copying birth dates, ages, names, account identifiers, or row values.",
      setTo: TARGET_AGE_BAND,
    },
    {
      fieldPath: "sourceFamilies[bloodwork_glycemia].available",
      privateDetailsStored: false,
      safeEditMeaning: "Declare that glycemia bloodwork coverage exists for feature-only planning.",
      setOnlyIf:
        "A lab portal export or spreadsheet has glycemia bloodwork coverage, and the confirmation does not include lab values, private headers, source variable names, file names, file paths, or account identifiers.",
      setTo: true,
    },
    {
      fieldPath: "sourceFamilies[wearable_activity_daily].available",
      privateDetailsStored: false,
      safeEditMeaning: "Declare that daily activity coverage exists for feature-only planning.",
      setOnlyIf:
        "A phone, watch, or wearable export has daily activity coverage, and the confirmation does not include step counts, minute values, private headers, device account identifiers, file names, file paths, or source variable names.",
      setTo: true,
    },
    {
      fieldPath: "rowOwnerAssertionsConfirmed",
      privateDetailsStored: false,
      safeEditMeaning: "Confirm that the safe feature-only availability assertions are complete.",
      setOnlyIf:
        "The target age band, glycemia bloodwork availability, daily wearable activity availability, and every privacy attestation below have been reviewed without adding private content.",
      setTo: true,
    },
    ...REQUIRED_ATTESTATION_KEYS.map((attestationKey): FeatureOnlyQuickstartFieldEdit => ({
      fieldPath: `attestations.${attestationKey}`,
      privateDetailsStored: false,
      safeEditMeaning: `Confirm ${attestationKey} for the feature-only safe availability JSON.`,
      setOnlyIf: attestationSetOnlyIf(attestationKey),
      setTo: true,
    })),
  ];
}

function attestationSetOnlyIf(attestationKey: RequiredAttestationKey): string {
  switch (attestationKey) {
    case "aggregateOnly":
      return "The confirmation stores only booleans, safe IDs, and the coarse target age band; it contains no rows, values, raw counts, predictions, coefficients, or source text.";
    case "localOnly":
      return "Any source inspection happened locally, and only this safe confirmation JSON is passed to the research chain.";
    case "noCoefficientEgress":
      return "No model coefficients or learned parameters were copied into the confirmation.";
    case "noHeaderNameEgress":
      return "No private column headers, lab portal labels, wearable export labels, or source variable names were copied into the confirmation.";
    case "noParticipantEgress":
      return "No names, account identifiers, device identifiers, join keys, dates, or participant IDs were copied into the confirmation.";
    case "noPredictionEgress":
      return "No predictions, scores, residuals, or per-person outputs were copied into the confirmation.";
    case "noPrivatePathEgress":
      return "No local file paths, cloud paths, account paths, or source locations were copied into the confirmation.";
    case "noPrivateRefValueEgress":
      return "No private semantic reference values, join values, date values, or mapping values were copied into the confirmation.";
    case "noRowEgress":
      return "No source rows, row snippets, row counts tied to small cells, or per-person values were copied into the confirmation.";
    case "noSmallCellEgress":
      return "No small-cell counts or small-group details were copied into the confirmation.";
    case "noSourceTextEgress":
      return "No raw source text, report text, note text, or exported file contents were copied into the confirmation.";
  }
}

function featureOnlyQuickstartSourceFamily(
  familyId: FeatureOnlySourceFamilyId,
): FeatureOnlyQuickstartSourceFamily {
  if (familyId === "bloodwork_glycemia") {
    return {
      familyId,
      privateDetailsStored: false,
      safeAvailableMeans:
        "A normal lab portal export or spreadsheet has glycemia bloodwork coverage.",
      safeSourceKind: "lab_portal_export_or_spreadsheet",
      setAvailableToTrueOnlyIf:
        "The row owner can confirm glycemia bloodwork exists without copying lab values, private headers, file names, file paths, account identifiers, or source variable names into the confirmation.",
    };
  }
  return {
    familyId,
    privateDetailsStored: false,
    safeAvailableMeans:
      "A phone, watch, or wearable export has daily activity coverage.",
    safeSourceKind: "phone_watch_or_wearable_activity_export",
    setAvailableToTrueOnlyIf:
      "The row owner can confirm daily activity data exists without copying step counts, minute values, private headers, device account identifiers, file names, file paths, or source variable names into the confirmation.",
  };
}

function ordinarySubmitterInputKinds(): OrdinarySubmitterInputKind[] {
  return [
    {
      inputKindId: "lab_portal_export_or_spreadsheet",
      mapsToSourceFamilyIds: ["bloodwork_glycemia", "common_bloodwork_core"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: true,
      safeSubmitterExample: "A normal lab portal export or spreadsheet can confirm glycemia bloodwork exists without sharing private labels, headers, or row values.",
    },
    {
      inputKindId: "phone_watch_or_wearable_activity_export",
      mapsToSourceFamilyIds: ["wearable_activity_daily"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: true,
      safeSubmitterExample: "A phone, watch, or wearable daily activity export can confirm activity coverage without sharing private labels, headers, or row values.",
    },
    {
      inputKindId: "optional_vitals_or_body_context",
      mapsToSourceFamilyIds: ["vitals_body_context"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: false,
      safeSubmitterExample: "Optional body or vitals context can be declared available without sharing private labels, headers, or row values.",
    },
  ];
}

function ordinarySubmitterSafeCompletionChecklist(): OrdinarySubmitterSafeCompletionChecklistItem[] {
  return [
    {
      checkId: "confirm_target_age_band_without_identifiers",
      mapsToSourceFamilyIds: [],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: true,
      requiredForOutcomeLinkedRecipe: true,
      safeCompletionMeaning:
        "Confirm the submission belongs on the roughly 16-50 ordinary submitter path without sharing birth dates, names, account identifiers, or row values.",
    },
    {
      checkId: "confirm_glycemia_bloodwork_export_available",
      mapsToSourceFamilyIds: ["bloodwork_glycemia"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: true,
      requiredForOutcomeLinkedRecipe: true,
      safeCompletionMeaning:
        "Confirm an ordinary lab portal export or spreadsheet can cover glycemia bloodwork availability without sharing lab names, headers, values, files, or paths.",
    },
    {
      checkId: "confirm_daily_wearable_activity_export_available",
      mapsToSourceFamilyIds: ["wearable_activity_daily"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: true,
      requiredForOutcomeLinkedRecipe: true,
      safeCompletionMeaning:
        "Confirm a phone, watch, or wearable export can cover daily activity availability without sharing device account identifiers, headers, values, files, or paths.",
    },
    {
      checkId: "confirm_no_private_values_in_confirmation",
      mapsToSourceFamilyIds: [],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: true,
      requiredForOutcomeLinkedRecipe: true,
      safeCompletionMeaning:
        "Confirm the completed availability JSON contains only booleans, safe IDs, and coarse bands, with no private rows, headers, identifiers, file names, paths, predictions, coefficients, or source text.",
    },
    {
      checkId: "confirm_outcome_linkage_and_time_alignment_if_model_evidence",
      mapsToSourceFamilyIds: ["outcome_linkage", "join_time_alignment"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: false,
      requiredForOutcomeLinkedRecipe: true,
      safeCompletionMeaning:
        "For outcome-linked model evidence, confirm outcomes and time alignment can be joined to the same eligible people without exposing join keys, dates, row values, or headers.",
    },
    {
      checkId: "confirm_aggregate_count_bands_if_model_evidence",
      mapsToSourceFamilyIds: [],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: false,
      requiredForOutcomeLinkedRecipe: true,
      safeCompletionMeaning:
        "For outcome-linked model evidence, confirm only coarse usable-record and event-count bands; do not include raw counts if they would disclose small cells.",
    },
  ];
}

function ordinarySubmitterCompletionModes(): OrdinarySubmitterCompletionMode[] {
  return [
    {
      modeId: "feature_only_lab_wearable_coverage",
      modeType: "feature_only_coverage",
      modelEvidenceCandidate: false,
      nextActionAfterR1150: "run_r1153_feature_only_chain",
      outcomeLinkageRequired: false,
      privateDetailsStored: false,
      requiredAggregateReadinessFactIds: ["targetAgeBand"],
      requiredAttestationKeys: [...REQUIRED_ATTESTATION_KEYS],
      requiredChecklistIds: [
        "confirm_target_age_band_without_identifiers",
        "confirm_glycemia_bloodwork_export_available",
        "confirm_daily_wearable_activity_export_available",
        "confirm_no_private_values_in_confirmation",
      ],
      requiredSourceFamilyIds: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      rowLevelDataAccepted: false,
      safeCompletionMeaning:
        "Minimum ordinary submitter path: confirm only the roughly 16-50 scope, glycemia bloodwork availability, daily wearable activity availability, and privacy attestations for research-only coverage planning.",
    },
    {
      modeId: "outcome_linked_lab_wearable_model_evidence",
      modeType: "outcome_linked_model_evidence",
      modelEvidenceCandidate: true,
      nextActionAfterR1150: "run_r1144_recipe_readiness_chain",
      outcomeLinkageRequired: true,
      privateDetailsStored: false,
      requiredAggregateReadinessFactIds: [...REQUIRED_AGGREGATE_READINESS_FACT_IDS],
      requiredAttestationKeys: [...REQUIRED_ATTESTATION_KEYS],
      requiredChecklistIds: ordinarySubmitterSafeCompletionChecklist().map((item) => item.checkId),
      requiredSourceFamilyIds: [...REQUIRED_SOURCE_FAMILY_IDS],
      rowLevelDataAccepted: false,
      safeCompletionMeaning:
        "Outcome-linked model-evidence path: confirm lab plus wearable availability, outcome/time alignment, same-denominator readiness, and only coarse count bands before running recipe readiness.",
    },
  ];
}

function sourceFamilyChecklist(
  missingRequiredSourceFamilyIds: readonly string[],
): SourceFamilyChecklistItem[] {
  return [...REQUIRED_SOURCE_FAMILY_IDS, ...OPTIONAL_ADD_ON_FAMILY_IDS].map((familyId) => ({
    familyId,
    missingFromR1150: missingRequiredSourceFamilyIds.includes(familyId),
    privateDetailsStored: false,
    requiredForFeatureOnlyPreferredPair: featureOnlySourceFamilyIds.has(familyId),
    requiredForOutcomeLinkedRecipe: requiredSourceFamilyIds.has(familyId),
    safeConfirmationMeaning: safeConfirmationMeaningFor(familyId),
  }));
}

function aggregateReadinessFactChecklist(
  missingAggregateReadinessFactIds: readonly string[],
): AggregateReadinessFactChecklistItem[] {
  return REQUIRED_AGGREGATE_READINESS_FACT_IDS.map((factId) => ({
    factId,
    missingFromR1150: missingAggregateReadinessFactIds.includes(factId),
    privateDetailsStored: false,
    requiredForFeatureOnlyContext: factId === "targetAgeBand",
    requiredForOutcomeLinkedRecipe: true,
    safeConfirmationMeaning: aggregateReadinessMeaningFor(factId),
  }));
}

function attestationChecklist(missingAttestationKeys: readonly string[]): AttestationChecklistItem[] {
  return REQUIRED_ATTESTATION_KEYS.map((attestationKey) => ({
    attestationKey,
    missingFromR1150: missingAttestationKeys.includes(attestationKey),
    privateDetailsStored: false,
    requiredForFeatureOnlyContext: true,
    requiredForOutcomeLinkedRecipe: true,
  }));
}

function safeConfirmationMeaningFor(familyId: SourceFamilyId): string {
  if (familyId === "outcome_linkage") {
    return "An outcome or follow-up source can be linked to the same eligible people as labs and wearable data.";
  }
  if (familyId === "join_time_alignment") {
    return "The row owner can align people and dates or times across labs, wearable data, and outcomes without exposing join values.";
  }
  if (familyId === "bloodwork_glycemia") {
    return "Ordinary glycemia bloodwork is present in a lab portal export or spreadsheet.";
  }
  if (familyId === "wearable_activity_daily") {
    return "Daily activity data is present in a phone, watch, or wearable export.";
  }
  if (familyId === "common_bloodwork_core") {
    return "Common bloodwork add-ons beyond glycemia are present if the row owner wants fuller context.";
  }
  return "Vitals or body-context add-ons are present if the row owner wants fuller context.";
}

function aggregateReadinessMeaningFor(factId: RequiredAggregateReadinessFactId): string {
  if (factId === "outcomeLinked") return "Outcome linkage is confirmed for the same eligible people.";
  if (factId === "sameDenominator") return "Labs, wearable data, and outcomes can be counted on the same eligible denominator.";
  if (factId === "targetAgeBand") return "The confirmation is scoped to the ordinary roughly 16-50 submitter path.";
  if (factId === "usableRecordCountBand") return "The row owner can safely confirm the usable-record count band.";
  return "The row owner can safely confirm the outcome-event count band.";
}

function summarizeInput(value: unknown | null): ArtifactSummary {
  return {
    artifact: R1150_EXPECTED.artifact,
    packetId: readStringAt(value, ["packetId"]),
    schemaVersion: readStringAt(value, ["schemaVersion"]),
    status: value ? "available" : "missing",
  };
}

function validateR1150InputBoundary(value: unknown | null): void {
  if (!value) return;
  const findings = [
    ...findForbiddenAggregateEgress(value),
    ...r1150BoundaryFindings(value),
  ];
  if (findings.length > 0) {
    throw new Error(`R1154 rejected unsafe r1150 input: ${formatFindingCount(findings)}`);
  }
}

function r1150MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1150_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1150_EXPECTED.schemaVersion
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(value, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1150"]) === false
    && readBooleanAt(value, ["summary", "rowParsingPerformedByR1150"]) === false
    && r1150SafeArtifactBoundaryPresent(value);
}

function r1150SafeArtifactBoundaryPresent(value: unknown | null): boolean {
  return readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true
    && REQUIRED_R1150_FALSE_BOUNDARY_FLAGS.every((flag) =>
      readBooleanAt(value, ["artifactBoundary", flag]) === false
    );
}

function r1150BoundaryFindings(value: unknown): string[] {
  const findings: string[] = [];
  if (readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) !== true) {
    findings.push("r1150 artifactBoundary.aggregateOnly must be true");
  }
  for (const flag of REQUIRED_R1150_FALSE_BOUNDARY_FLAGS) {
    if (readBooleanAt(value, ["artifactBoundary", flag]) !== false) {
      findings.push(`r1150 artifactBoundary.${flag} must be false`);
    }
  }
  return findings;
}

function typedSubset<const T extends readonly string[]>(values: readonly string[], allowed: T): Array<T[number]> {
  return allowed.filter((value): value is T[number] => values.includes(value));
}

function readStringArrayAt(value: unknown, pathParts: readonly string[]): string[] {
  const valueAtPath = readAt(value, pathParts);
  return Array.isArray(valueAtPath)
    ? valueAtPath.filter((item): item is string => typeof item === "string")
    : [];
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function safeBoundary(): R1154OrdinaryConsumerSafeAvailabilityActionPacketOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    availabilityConfirmationPathStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
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
    rowLevelDataAcceptedByR1154: false,
    rowParsingPerformedByR1154: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const valueAtPath = readAt(value, pathParts);
  return typeof valueAtPath === "string" ? valueAtPath : null;
}

function readBooleanAt(value: unknown, pathParts: readonly string[]): boolean | null {
  const valueAtPath = readAt(value, pathParts);
  return typeof valueAtPath === "boolean" ? valueAtPath : null;
}

function readAt(value: unknown, pathParts: readonly string[]): unknown {
  let cursor = value;
  for (const part of pathParts) {
    if (!isRecord(cursor)) return null;
    cursor = cursor[part];
  }
  return cursor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatFindingCount(findings: readonly unknown[]): string {
  return `${findings.length} finding${findings.length === 1 ? "" : "s"}`;
}

function cliSummary(output: R1154OrdinaryConsumerSafeAvailabilityActionPacketOutput): Record<string, unknown> {
  return {
    conclusion: output.summary.conclusion,
    featureOnlyCoverageContextReady: output.summary.featureOnlyCoverageContextReady,
    featureOnlyFillableTemplateArtifact: output.summary.featureOnlyFillableTemplateArtifact,
    featureOnlyQuickstartArtifact: output.summary.featureOnlyQuickstartArtifact,
    featureOnlyQuickstartSafeFieldEditCount: output.summary.featureOnlyQuickstartSafeFieldEditCount,
    featureOnlyQuickstartSafeFieldEditPaths: output.summary.featureOnlyQuickstartSafeFieldEditPaths,
    fillableTemplateArtifact: output.summary.fillableTemplateArtifact,
    minimumFeaturePairRequired: output.summary.minimumFeaturePairRequired,
    missingAggregateReadinessFactIds: output.summary.missingAggregateReadinessFactIds,
    missingAttestationKeys: output.summary.missingAttestationKeys,
    missingFeatureOnlySourceFamilyIds: output.summary.missingFeatureOnlySourceFamilyIds,
    missingRequiredSourceFamilyIds: output.summary.missingRequiredSourceFamilyIds,
    nextAction: output.summary.nextAction,
    outcomeLinkageRequiredForFeatureOnlyContext: output.summary.outcomeLinkageRequiredForFeatureOnlyContext,
    ordinarySubmitterCompletionModeIds:
      output.summary.ordinarySubmitterCompletionModeIds,
    ordinarySubmitterSafeCompletionChecklistItemIds:
      output.summary.ordinarySubmitterSafeCompletionChecklistItemIds,
    packetId: output.packetId,
    preferredRecipeId: output.summary.preferredRecipeId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    r1150Conclusion: output.summary.r1150Conclusion,
    r1150Expected: output.summary.r1150Expected,
    readyForOutcomeLinkedRecipeReadinessChain: output.summary.readyForOutcomeLinkedRecipeReadinessChain,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowLevelDataAcceptedByR1154: output.summary.rowLevelDataAcceptedByR1154,
    rowOwnerAssertionsConfirmed: output.summary.rowOwnerAssertionsConfirmed,
    rowOwnerWorkType: output.summary.rowOwnerWorkType,
    rowParsingPerformedByR1154: output.summary.rowParsingPerformedByR1154,
    safeAvailabilityConfirmationStatus: output.summary.safeAvailabilityConfirmationStatus,
    schemaVersion: output.schemaVersion,
    status: output.status,
    targetAgeBand: output.summary.targetAgeBand,
    targetInputPriority: output.summary.targetInputPriority,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1154OrdinaryConsumerSafeAvailabilityActionPacket({
    outputDir: process.env.MURPH_AGE_R1154_OUTPUT_DIR,
    r1150Path: process.env.MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_PATH,
  });
  process.stdout.write(`${JSON.stringify(cliSummary(output), null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1154 safe availability action packet failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
