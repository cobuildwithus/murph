import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1156_ORDINARY_CONSUMER_SAFE_CONFIRMATION_HANDOFF_SCHEMA_VERSION =
  "murph-age-r1156-ordinary-consumer-safe-confirmation-handoff.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1156-ordinary-consumer-safe-confirmation-handoff.latest.json";
const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first" as const;
const TARGET_AGE_BAND = "roughly_16_50" as const;
const PREFERRED_RECIPE_ID = "lab_plus_wearable_minimum_manifest" as const;
const FEATURE_ONLY_SOURCE_FAMILY_IDS = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
] as const;
const OPTIONAL_ADD_ON_FAMILY_IDS = [
  "common_bloodwork_core",
  "vitals_body_context",
] as const;
const REQUIRED_SAFE_COMPLETION_CHECK_IDS = [
  "confirm_target_age_band_without_identifiers",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
  "confirm_outcome_linkage_and_time_alignment_if_model_evidence",
  "confirm_aggregate_count_bands_if_model_evidence",
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
const R1154_EXPECTED = {
  artifact: "r1154-ordinary-consumer-safe-availability-action-packet.latest.json",
  packetId: "r1154-ordinary-consumer-safe-availability-action-packet",
  schemaVersion: "murph-age-r1154-ordinary-consumer-safe-availability-action-packet.v1",
} as const;
const R1155_EXPECTED = {
  artifact: "r1155-ordinary-consumer-safe-confirmation-feature-only-smoke-proof.latest.json",
  packetId: "r1155-ordinary-consumer-safe-confirmation-feature-only-smoke-proof",
  schemaVersion: "murph-age-r1155-ordinary-consumer-safe-confirmation-feature-only-smoke-proof.v1",
} as const;
export const R1156_SAFE_CONFIRMATION_HANDOFF_COMMAND =
  "MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_PATH=<r1150-intake.json> MURPH_AGE_R1154_ORDINARY_CONSUMER_SAFE_AVAILABILITY_ACTION_PACKET_PATH=<r1154-action-packet.json> MURPH_AGE_R1155_ORDINARY_CONSUMER_SAFE_CONFIRMATION_FEATURE_ONLY_SMOKE_PROOF_PATH=<r1155-smoke-proof.json> pnpm exec tsx scripts/murph-age/r1156-ordinary-consumer-safe-confirmation-handoff.ts" as const;

type FeatureOnlySourceFamilyId = typeof FEATURE_ONLY_SOURCE_FAMILY_IDS[number];
type OptionalAddOnFamilyId = typeof OPTIONAL_ADD_ON_FAMILY_IDS[number];
type RequiredSafeCompletionCheckId = typeof REQUIRED_SAFE_COMPLETION_CHECK_IDS[number];
type RequiredAttestationKey = typeof REQUIRED_ATTESTATION_KEYS[number];
type BlockedConfirmationContent = typeof BLOCKED_CONFIRMATION_CONTENT[number];
type HandoffConclusion =
  | "ordinary_safe_confirmation_handoff_ready_for_feature_only_or_recipe_next_step_non_evidence"
  | "ordinary_safe_confirmation_handoff_ready_for_row_owner_fill_non_evidence"
  | "ordinary_safe_confirmation_handoff_waiting_on_action_packet"
  | "ordinary_safe_confirmation_handoff_waiting_on_feature_only_smoke_proof";
type HandoffNextAction =
  | "fill_safe_availability_confirmation_from_template"
  | "refresh_r1154_safe_availability_action_packet"
  | "refresh_r1155_safe_confirmation_feature_only_smoke_proof"
  | "run_r1144_recipe_readiness_chain_with_confirmed_availability"
  | "run_r1153_feature_only_chain_with_safe_availability";
type RowOwnerHandoffActionId =
  | "confirm_no_private_values_or_identifiers_are_entered"
  | "confirm_ordinary_glycemia_bloodwork_export_available"
  | "confirm_phone_watch_or_wearable_activity_export_available"
  | "confirm_target_age_band_only"
  | "optional_confirm_outcome_linkage_for_model_evidence"
  | "optional_confirm_usable_count_bands_for_model_evidence";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface RowOwnerHandoffAction {
  actionId: RowOwnerHandoffActionId;
  mapsToChecklistIds: RequiredSafeCompletionCheckId[];
  mapsToSourceFamilyIds: Array<FeatureOnlySourceFamilyId | "join_time_alignment" | "outcome_linkage">;
  modelEvidenceCandidateOnly: boolean;
  privateDetailsStored: false;
  safeMeaning: string;
}

export interface R1156OrdinaryConsumerSafeConfirmationHandoffOptions {
  createdAt?: string;
  outputDir?: string;
  r1150Path?: string;
  r1154Path?: string;
  r1155Path?: string;
}

export interface R1156OrdinaryConsumerSafeConfirmationHandoffOutput {
  artifactBoundary: {
    aggregateOnly: true;
    availabilityConfirmationPathStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    confirmationValuesStored: false;
    featureValuesStored: false;
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
    rowLevelDataAcceptedByR1156: false;
    rowParsingPerformedByR1156: false;
    rowValuesStored: false;
    smallCellsStored: false;
    smokeEvidenceStoredAsModelEvidence: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: {
    r1150: ArtifactSummary;
    r1154: ArtifactSummary;
    r1155: ArtifactSummary;
  };
  packetId: "r1156-ordinary-consumer-safe-confirmation-handoff";
  productDisplayAuthorized: false;
  safeConfirmationHandoff: {
    blockedConfirmationContent: BlockedConfirmationContent[];
    commands: {
      safeAvailabilityConfirmationIntakeCommand: string | null;
      safeAvailabilityFeatureOnlyChainRunnerCommand: string | null;
      safeAvailabilityOutcomeLinkedRecipeReadinessCommand: string | null;
      safeConfirmationHandoffCommand: typeof R1156_SAFE_CONFIRMATION_HANDOFF_COMMAND;
    };
    featureOnlyFillableTemplateArtifact: string | null;
    featureOnlyPathMechanicallyProven: boolean;
    featureOnlyQuickstartArtifact: string | null;
    featureOnlyQuickstartSafeFieldEditPaths: string[];
    fullFillableTemplateArtifact: string | null;
    handoffReadyForRowOwner: boolean;
    modelEvidencePromotionAllowed: false;
    nextActionAfterSafeConfirmation: HandoffNextAction;
    optionalAddOnFamilyIds: OptionalAddOnFamilyId[];
    outcomeLinkageRequiredForFeatureOnlyContext: false;
    preferredRecipeId: typeof PREFERRED_RECIPE_ID;
    privateDetailsStored: false;
    readyForModelEvidence: false;
    readyForRecipeReadinessChain: boolean | null;
    requiredAttestationKeys: RequiredAttestationKey[];
    requiredFeatureOnlySourceFamilyIds: FeatureOnlySourceFamilyId[];
    requiredSafeCompletionCheckIds: RequiredSafeCompletionCheckId[];
    rowLevelDataAcceptedByR1156: false;
    rowOwnerActionItems: RowOwnerHandoffAction[];
    rowOwnerWorkType:
      | "fill_safe_availability_confirmation"
      | "refresh_safe_confirmation_handoff_inputs"
      | "run_feature_only_or_recipe_next_step";
    safeAvailabilityActionPacketNextAction: string | null;
    safeAvailabilityConfirmationIntakeCommand: string | null;
    safeAvailabilityFeatureOnlyChainRunnerCommand: string | null;
    safeAvailabilityOutcomeLinkedRecipeReadinessCommand: string | null;
    safeConfirmationStillRequired: boolean;
    smokeEvidence: false;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
  schemaVersion: typeof R1156_ORDINARY_CONSUMER_SAFE_CONFIRMATION_HANDOFF_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: HandoffConclusion;
    featureOnlyFillableTemplateArtifact: string | null;
    featureOnlyPathMechanicallyProven: boolean;
    featureOnlyQuickstartArtifact: string | null;
    featureOnlyQuickstartSafeFieldEditPaths: string[];
    handoffReadyForRowOwner: boolean;
    modelEvidencePromotionAllowed: false;
    nextAction: HandoffNextAction;
    optionalAddOnFamilyIds: OptionalAddOnFamilyId[];
    productDisplayAuthorized: false;
    readyForModelEvidence: false;
    readyForRecipeReadinessChain: boolean | null;
    requiredAttestationKeys: RequiredAttestationKey[];
    requiredFeatureOnlySourceFamilyIds: FeatureOnlySourceFamilyId[];
    requiredSafeCompletionCheckIds: RequiredSafeCompletionCheckId[];
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1156: false;
    rowOwnerWorkType:
      | "fill_safe_availability_confirmation"
      | "refresh_safe_confirmation_handoff_inputs"
      | "run_feature_only_or_recipe_next_step";
    rowParsingPerformedByR1156: false;
    safeAvailabilityActionPacketConclusion: string | null;
    safeAvailabilityActionPacketNextAction: string | null;
    safeConfirmationHandoffCommand: typeof R1156_SAFE_CONFIRMATION_HANDOFF_COMMAND;
    safeConfirmationFeatureOnlySmokeProofConclusion: string | null;
    safeConfirmationStillRequired: boolean;
    smokeEvidence: false;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
}

export async function runR1156OrdinaryConsumerSafeConfirmationHandoff(
  options: R1156OrdinaryConsumerSafeConfirmationHandoffOptions = {},
): Promise<{ output: R1156OrdinaryConsumerSafeConfirmationHandoffOutput; outputPath: string }> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const r1150 = await readJsonIfPresent(options.r1150Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1150_EXPECTED.artifact));
  const r1154 = await readJsonIfPresent(options.r1154Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1154_EXPECTED.artifact));
  const r1155 = await readJsonIfPresent(options.r1155Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1155_EXPECTED.artifact));
  validateInputBoundary("r1150", r1150);
  validateInputBoundary("r1154", r1154);
  validateInputBoundary("r1155", r1155);

  const r1154Expected = inputMatchesExpected(r1154, R1154_EXPECTED);
  const featureOnlyPathMechanicallyProven = safeConfirmationFeatureOnlySmokeProofPresent(r1155);
  const safeAvailabilityActionPacketNextAction = r1154Expected
    ? readStringAt(r1154, ["summary", "nextAction"])
    : null;
  const safeConfirmationStillRequired = r1154Expected
    ? readBooleanAt(r1154, ["summary", "featureOnlyCoverageContextReady"]) !== true
    : true;
  const conclusion = conclusionFor({
    featureOnlyPathMechanicallyProven,
    r1154Expected,
    safeConfirmationStillRequired,
  });
  const nextAction = nextActionFor({ conclusion, safeAvailabilityActionPacketNextAction });
  const rowOwnerWorkType = rowOwnerWorkTypeFor(conclusion);
  const featureOnlyQuickstartSafeFieldEditPaths = r1154Expected
    ? readStringArrayAt(r1154, ["summary", "featureOnlyQuickstartSafeFieldEditPaths"])
    : [];
  const featureOnlyQuickstartArtifact = r1154Expected
    ? readStringAt(r1154, ["summary", "featureOnlyQuickstartArtifact"])
    : null;
  const fullFillableTemplateArtifact = r1154Expected
    ? readStringAt(r1154, ["summary", "fillableTemplateArtifact"])
      ?? readStringAt(r1154, ["summary", "safeAvailabilityConfirmationTemplateArtifact"])
    : null;
  const featureOnlyFillableTemplateArtifact = r1154Expected
    ? readStringAt(r1154, ["summary", "featureOnlyFillableTemplateArtifact"])
    : null;
  const readyForRecipeReadinessChain = r1154Expected
    ? readBooleanAt(r1154, ["summary", "readyForOutcomeLinkedRecipeReadinessChain"])
    : null;
  const safeAvailabilityConfirmationIntakeCommand = r1154Expected
    ? readStringAt(r1154, ["safeAvailabilityActionPacket", "commands", "safeAvailabilityConfirmationIntakeCommand"])
    : null;
  const safeAvailabilityFeatureOnlyChainRunnerCommand = r1154Expected
    ? readStringAt(r1154, ["safeAvailabilityActionPacket", "commands", "featureOnlyChainRunnerCommand"])
    : null;
  const safeAvailabilityOutcomeLinkedRecipeReadinessCommand = r1154Expected
    ? readStringAt(r1154, ["safeAvailabilityActionPacket", "commands", "outcomeLinkedRecipeReadinessCommand"])
    : null;
  const output: R1156OrdinaryConsumerSafeConfirmationHandoffOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: {
      r1150: summarizeInput(r1150, R1150_EXPECTED),
      r1154: summarizeInput(r1154, R1154_EXPECTED),
      r1155: summarizeInput(r1155, R1155_EXPECTED),
    },
    packetId: "r1156-ordinary-consumer-safe-confirmation-handoff",
    productDisplayAuthorized: false,
    safeConfirmationHandoff: {
      blockedConfirmationContent: [...BLOCKED_CONFIRMATION_CONTENT],
      commands: {
        safeAvailabilityConfirmationIntakeCommand,
        safeAvailabilityFeatureOnlyChainRunnerCommand,
        safeAvailabilityOutcomeLinkedRecipeReadinessCommand,
        safeConfirmationHandoffCommand: R1156_SAFE_CONFIRMATION_HANDOFF_COMMAND,
      },
      featureOnlyFillableTemplateArtifact,
      featureOnlyPathMechanicallyProven,
      featureOnlyQuickstartArtifact,
      featureOnlyQuickstartSafeFieldEditPaths,
      fullFillableTemplateArtifact,
      handoffReadyForRowOwner: r1154Expected && featureOnlyPathMechanicallyProven,
      modelEvidencePromotionAllowed: false,
      nextActionAfterSafeConfirmation: nextAction,
      optionalAddOnFamilyIds: [...OPTIONAL_ADD_ON_FAMILY_IDS],
      outcomeLinkageRequiredForFeatureOnlyContext: false,
      preferredRecipeId: PREFERRED_RECIPE_ID,
      privateDetailsStored: false,
      readyForModelEvidence: false,
      readyForRecipeReadinessChain,
      requiredAttestationKeys: [...REQUIRED_ATTESTATION_KEYS],
      requiredFeatureOnlySourceFamilyIds: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      requiredSafeCompletionCheckIds: [...REQUIRED_SAFE_COMPLETION_CHECK_IDS],
      rowLevelDataAcceptedByR1156: false,
      rowOwnerActionItems: rowOwnerActionItems(),
      rowOwnerWorkType,
      safeAvailabilityActionPacketNextAction,
      safeAvailabilityConfirmationIntakeCommand,
      safeAvailabilityFeatureOnlyChainRunnerCommand,
      safeAvailabilityOutcomeLinkedRecipeReadinessCommand,
      safeConfirmationStillRequired,
      smokeEvidence: false,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
    schemaVersion: R1156_ORDINARY_CONSUMER_SAFE_CONFIRMATION_HANDOFF_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      featureOnlyFillableTemplateArtifact,
      featureOnlyPathMechanicallyProven,
      featureOnlyQuickstartArtifact,
      featureOnlyQuickstartSafeFieldEditPaths,
      handoffReadyForRowOwner: r1154Expected && featureOnlyPathMechanicallyProven,
      modelEvidencePromotionAllowed: false,
      nextAction,
      optionalAddOnFamilyIds: [...OPTIONAL_ADD_ON_FAMILY_IDS],
      productDisplayAuthorized: false,
      readyForModelEvidence: false,
      readyForRecipeReadinessChain,
      requiredAttestationKeys: [...REQUIRED_ATTESTATION_KEYS],
      requiredFeatureOnlySourceFamilyIds: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      requiredSafeCompletionCheckIds: [...REQUIRED_SAFE_COMPLETION_CHECK_IDS],
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1156: false,
      rowOwnerWorkType,
      rowParsingPerformedByR1156: false,
      safeAvailabilityActionPacketConclusion: r1154Expected
        ? readStringAt(r1154, ["summary", "conclusion"])
        : null,
      safeAvailabilityActionPacketNextAction,
      safeConfirmationHandoffCommand: R1156_SAFE_CONFIRMATION_HANDOFF_COMMAND,
      safeConfirmationFeatureOnlySmokeProofConclusion: inputMatchesExpected(r1155, R1155_EXPECTED)
        ? readStringAt(r1155, ["summary", "conclusion"])
        : null,
      safeConfirmationStillRequired,
      smokeEvidence: false,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1156 safe confirmation handoff failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function conclusionFor(input: {
  featureOnlyPathMechanicallyProven: boolean;
  r1154Expected: boolean;
  safeConfirmationStillRequired: boolean;
}): HandoffConclusion {
  if (!input.r1154Expected) return "ordinary_safe_confirmation_handoff_waiting_on_action_packet";
  if (!input.featureOnlyPathMechanicallyProven) {
    return "ordinary_safe_confirmation_handoff_waiting_on_feature_only_smoke_proof";
  }
  if (!input.safeConfirmationStillRequired) {
    return "ordinary_safe_confirmation_handoff_ready_for_feature_only_or_recipe_next_step_non_evidence";
  }
  return "ordinary_safe_confirmation_handoff_ready_for_row_owner_fill_non_evidence";
}

function nextActionFor(input: {
  conclusion: HandoffConclusion;
  safeAvailabilityActionPacketNextAction: string | null;
}): HandoffNextAction {
  if (input.conclusion === "ordinary_safe_confirmation_handoff_waiting_on_action_packet") {
    return "refresh_r1154_safe_availability_action_packet";
  }
  if (input.conclusion === "ordinary_safe_confirmation_handoff_waiting_on_feature_only_smoke_proof") {
    return "refresh_r1155_safe_confirmation_feature_only_smoke_proof";
  }
  if (input.safeAvailabilityActionPacketNextAction === "run_r1144_recipe_readiness_chain_with_confirmed_availability") {
    return "run_r1144_recipe_readiness_chain_with_confirmed_availability";
  }
  if (input.safeAvailabilityActionPacketNextAction === "run_r1153_feature_only_chain_with_safe_availability") {
    return "run_r1153_feature_only_chain_with_safe_availability";
  }
  return "fill_safe_availability_confirmation_from_template";
}

function rowOwnerWorkTypeFor(
  conclusion: HandoffConclusion,
): R1156OrdinaryConsumerSafeConfirmationHandoffOutput["safeConfirmationHandoff"]["rowOwnerWorkType"] {
  if (
    conclusion === "ordinary_safe_confirmation_handoff_waiting_on_action_packet"
    || conclusion === "ordinary_safe_confirmation_handoff_waiting_on_feature_only_smoke_proof"
  ) {
    return "refresh_safe_confirmation_handoff_inputs";
  }
  if (conclusion === "ordinary_safe_confirmation_handoff_ready_for_feature_only_or_recipe_next_step_non_evidence") {
    return "run_feature_only_or_recipe_next_step";
  }
  return "fill_safe_availability_confirmation";
}

function rowOwnerActionItems(): RowOwnerHandoffAction[] {
  return [
    {
      actionId: "confirm_target_age_band_only",
      mapsToChecklistIds: ["confirm_target_age_band_without_identifiers"],
      mapsToSourceFamilyIds: [],
      modelEvidenceCandidateOnly: false,
      privateDetailsStored: false,
      safeMeaning: "Confirm only that the submission is for the rough 16-50 target band.",
    },
    {
      actionId: "confirm_ordinary_glycemia_bloodwork_export_available",
      mapsToChecklistIds: ["confirm_glycemia_bloodwork_export_available"],
      mapsToSourceFamilyIds: ["bloodwork_glycemia"],
      modelEvidenceCandidateOnly: false,
      privateDetailsStored: false,
      safeMeaning: "Confirm an ordinary lab portal export or spreadsheet can cover glycemia bloodwork such as glucose or HbA1c.",
    },
    {
      actionId: "confirm_phone_watch_or_wearable_activity_export_available",
      mapsToChecklistIds: ["confirm_daily_wearable_activity_export_available"],
      mapsToSourceFamilyIds: ["wearable_activity_daily"],
      modelEvidenceCandidateOnly: false,
      privateDetailsStored: false,
      safeMeaning: "Confirm a phone, watch, or wearable export can cover daily activity such as steps or active minutes.",
    },
    {
      actionId: "confirm_no_private_values_or_identifiers_are_entered",
      mapsToChecklistIds: ["confirm_no_private_values_in_confirmation"],
      mapsToSourceFamilyIds: [],
      modelEvidenceCandidateOnly: false,
      privateDetailsStored: false,
      safeMeaning: "Confirm the handoff contains no rows, headers, values, paths, filenames, source variable names, or participant identifiers.",
    },
    {
      actionId: "optional_confirm_outcome_linkage_for_model_evidence",
      mapsToChecklistIds: ["confirm_outcome_linkage_and_time_alignment_if_model_evidence"],
      mapsToSourceFamilyIds: ["outcome_linkage", "join_time_alignment"],
      modelEvidenceCandidateOnly: true,
      privateDetailsStored: false,
      safeMeaning: "Only for model-evidence readiness, confirm outcome linkage and time alignment exist without naming private fields or values.",
    },
    {
      actionId: "optional_confirm_usable_count_bands_for_model_evidence",
      mapsToChecklistIds: ["confirm_aggregate_count_bands_if_model_evidence"],
      mapsToSourceFamilyIds: ["outcome_linkage"],
      modelEvidenceCandidateOnly: true,
      privateDetailsStored: false,
      safeMeaning: "Only for model-evidence readiness, confirm coarse usable-record and event-count bands without small cells.",
    },
  ];
}

function safeConfirmationFeatureOnlySmokeProofPresent(r1155: unknown | null): boolean {
  return inputMatchesExpected(r1155, R1155_EXPECTED)
    && readStringAt(r1155, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(r1155, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(r1155, ["artifactBoundary", "confirmationPathStored"]) === false
    && readBooleanAt(r1155, ["artifactBoundary", "confirmationValuesStored"]) === false
    && readBooleanAt(r1155, ["artifactBoundary", "contextPathStored"]) === false
    && readBooleanAt(r1155, ["artifactBoundary", "featureValuesStored"]) === false
    && readBooleanAt(r1155, ["artifactBoundary", "fileNamesStored"]) === false
    && readBooleanAt(r1155, ["artifactBoundary", "localPathsStored"]) === false
    && readBooleanAt(r1155, ["artifactBoundary", "rowLevelDataAcceptedByR1155"]) === false
    && readBooleanAt(r1155, ["artifactBoundary", "rowParsingPerformedByR1155"]) === false
    && readBooleanAt(r1155, ["artifactBoundary", "temporaryConfirmationPersisted"]) === false
    && readStringAt(r1155, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(r1155, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && readStringAt(r1155, ["summary", "conclusion"]) === "ordinary_safe_confirmation_feature_only_smoke_passed_non_evidence"
    && readStringAt(r1155, ["summary", "featureOnlyChainConclusion"]) === "ordinary_feature_only_chain_ready_research_only"
    && readStringAt(r1155, ["summary", "safeAvailabilityConfirmationConclusion"])
      === "safe_availability_confirmation_feature_only_ready_research_only"
    && readBooleanAt(r1155, ["summary", "featureOnlyCoverageContextReadyForResearchPlanning"]) === true
    && readBooleanAt(r1155, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(r1155, ["summary", "readyForRecipeReadinessChain"]) === false
    && readBooleanAt(r1155, ["summary", "rowLevelDataAcceptedByR1155"]) === false
    && readBooleanAt(r1155, ["summary", "rowParsingPerformedByR1155"]) === false
    && readBooleanAt(r1155, ["summary", "smokeEvidence"]) === false
    && readBooleanAt(r1155, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(r1155, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(r1155, ["productDisplayAuthorized"]) === false
    && readBooleanAt(
      r1155,
      ["safeConfirmationFeatureOnlySmokeProof", "temporaryConfirmationValuesPersistedInArtifact"],
    ) === false
    && readBooleanAt(
      r1155,
      ["safeConfirmationFeatureOnlySmokeProof", "outcomeLinkedEvidenceIncludedInSmoke"],
    ) === false;
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

function validateInputBoundary(label: string, value: unknown | null): void {
  if (!value) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1156 rejected unsafe ${label} input: ${formatFindingCount(findings)}`);
  }
}

function summarizeInput(
  value: unknown | null,
  expected: typeof R1150_EXPECTED | typeof R1154_EXPECTED | typeof R1155_EXPECTED,
): ArtifactSummary {
  return {
    artifact: expected.artifact,
    packetId: readStringAt(value, ["packetId"]) === expected.packetId ? expected.packetId : null,
    schemaVersion: readStringAt(value, ["schemaVersion"]) === expected.schemaVersion
      ? expected.schemaVersion
      : null,
    status: value ? "available" : "missing",
  };
}

function inputMatchesExpected(
  value: unknown | null,
  expected: typeof R1150_EXPECTED | typeof R1154_EXPECTED | typeof R1155_EXPECTED,
): boolean {
  return readStringAt(value, ["packetId"]) === expected.packetId
    && readStringAt(value, ["schemaVersion"]) === expected.schemaVersion;
}

function readStringAt(value: unknown | null, pathParts: readonly string[]): string | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
}

function readBooleanAt(value: unknown | null, pathParts: readonly string[]): boolean | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "boolean" ? resolved : null;
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

function safeBoundary(): R1156OrdinaryConsumerSafeConfirmationHandoffOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    availabilityConfirmationPathStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    confirmationValuesStored: false,
    featureValuesStored: false,
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
    rowLevelDataAcceptedByR1156: false,
    rowParsingPerformedByR1156: false,
    rowValuesStored: false,
    smallCellsStored: false,
    smokeEvidenceStoredAsModelEvidence: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1156OrdinaryConsumerSafeConfirmationHandoff({
    createdAt: process.env.MURPH_AGE_RESEARCH_CREATED_AT,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1150Path: process.env.MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_PATH,
    r1154Path: process.env.MURPH_AGE_R1154_ORDINARY_CONSUMER_SAFE_AVAILABILITY_ACTION_PACKET_PATH,
    r1155Path: process.env.MURPH_AGE_R1155_ORDINARY_CONSUMER_SAFE_CONFIRMATION_FEATURE_ONLY_SMOKE_PROOF_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    featureOnlyPathMechanicallyProven: output.summary.featureOnlyPathMechanicallyProven,
    handoffReadyForRowOwner: output.summary.handoffReadyForRowOwner,
    modelEvidencePromotionAllowed: output.summary.modelEvidencePromotionAllowed,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    readyForModelEvidence: output.summary.readyForModelEvidence,
    readyForRecipeReadinessChain: output.summary.readyForRecipeReadinessChain,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowLevelDataAcceptedByR1156: output.summary.rowLevelDataAcceptedByR1156,
    rowParsingPerformedByR1156: output.summary.rowParsingPerformedByR1156,
    safeConfirmationHandoffCommand: output.summary.safeConfirmationHandoffCommand,
    safeConfirmationStillRequired: output.summary.safeConfirmationStillRequired,
    schemaVersion: output.schemaVersion,
    smokeEvidence: output.summary.smokeEvidence,
    status: output.status,
    targetAgeBand: output.summary.targetAgeBand,
    targetInputPriority: output.summary.targetInputPriority,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1156 safe confirmation handoff failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
