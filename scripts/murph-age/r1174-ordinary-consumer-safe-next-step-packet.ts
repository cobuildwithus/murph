import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { R1145_ORDINARY_CONSUMER_CURRENT_CHAIN_COMPLETION_AUDIT_SCHEMA_VERSION } from "./r1145-ordinary-consumer-current-chain-completion-audit.ts";
import { R1165_SAFE_ASSERTION_RUNNER_COMMAND } from "./r1165-ordinary-consumer-feature-only-safe-assertion-runner.ts";
import {
  R1172_ORDINARY_CONSUMER_SAFE_ASSERTION_MATERIALIZER_SCHEMA_VERSION,
  R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND,
} from "./r1172-ordinary-consumer-safe-assertion-materializer.ts";
import {
  R1173_ORDINARY_CONSUMER_SAFE_ASSERTION_ANSWER_SHEET_SCHEMA_VERSION,
  R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND,
} from "./r1173-ordinary-consumer-safe-assertion-answer-sheet.ts";
import {
  R1176_R1172_R1165_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_SCHEMA_VERSION,
  R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
} from "./r1176-r1172-r1165-row-owner-safe-assertion-chain-runner.ts";

export const R1174_ORDINARY_CONSUMER_SAFE_NEXT_STEP_PACKET_SCHEMA_VERSION =
  "murph-age-r1174-ordinary-consumer-safe-next-step-packet.v1" as const;
export const R1174_SAFE_NEXT_STEP_PACKET_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1174-ordinary-consumer-safe-next-step-packet.ts" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME =
  "r1174-ordinary-consumer-safe-next-step-packet.latest.json" as const;
const R1145_ARTIFACT =
  "r1145-ordinary-consumer-current-chain-completion-audit.latest.json" as const;
const R1173_ARTIFACT =
  "r1173-ordinary-consumer-safe-assertion-answer-sheet.latest.json" as const;
const R1172_ARTIFACT =
  "r1172-ordinary-consumer-safe-assertion-materializer.latest.json" as const;
const R1176_ARTIFACT =
  "r1176-r1172-r1165-row-owner-safe-assertion-chain-runner.latest.json" as const;
const R1145_PACKET_ID =
  "r1145-ordinary-consumer-current-chain-completion-audit" as const;
const R1173_PACKET_ID =
  "r1173-ordinary-consumer-safe-assertion-answer-sheet" as const;
const R1172_PACKET_ID =
  "r1172-ordinary-consumer-safe-assertion-materializer" as const;
const R1176_PACKET_ID =
  "r1176-r1172-r1165-row-owner-safe-assertion-chain-runner" as const;
const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first" as const;
const TARGET_AGE_BAND = "roughly_16_50" as const;
const FEATURE_ONLY_SOURCE_FAMILY_IDS = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
] as const;
const OPTIONAL_ADD_ON_FAMILY_IDS = [
  "common_bloodwork_core",
  "vitals_body_context",
] as const;
const REQUIRED_INPUT_KIND_IDS = [
  "lab_portal_export_or_spreadsheet",
  "phone_watch_or_wearable_activity_export",
] as const;
const REQUIRED_ASSERTION_CHECKLIST_IDS = [
  "assert_target_age_band_roughly_16_50",
  "assert_glycemia_bloodwork_export_available",
  "assert_daily_wearable_activity_export_available",
  "assert_no_private_values_identifiers_paths_headers_or_rows",
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
const SAFE_FIELD_EDIT_PATHS = [
  "sourceFamilies[bloodwork_glycemia].available",
  "sourceFamilies[wearable_activity_daily].available",
  "sourceFamilies[common_bloodwork_core].available",
  "sourceFamilies[vitals_body_context].available",
  "rowOwnerAssertionsConfirmed",
  "privateContentExcluded",
  ...REQUIRED_ATTESTATION_KEYS.map((key) => `attestations.${key}`),
] as const;
const EXPECTED_MISSING_REQUIREMENT_IDS = [
  "row_owner_availability_assertions_confirmed",
  "confirmed_recipe_route_requirements_available",
  "private_route_config_supplied",
  "real_lab_wearable_route_metrics_recorded",
] as const;
const BLOCKED_CONTENT = [
  "private_paths",
  "header_names",
  "file_names",
  "row_values",
  "participant_identifiers",
  "private_ref_values",
  "source_variable_names",
  "predictions",
  "coefficients",
  "model_parameters",
  "source_text",
  "small_cells",
] as const;
const ALLOWED_VALUE_KIND_IDS = [
  "booleans_only",
  "fixed_enumerated_ids_only",
] as const;

type FeatureOnlySourceFamilyId = typeof FEATURE_ONLY_SOURCE_FAMILY_IDS[number];
type OptionalAddOnFamilyId = typeof OPTIONAL_ADD_ON_FAMILY_IDS[number];
type RequiredInputKindId = typeof REQUIRED_INPUT_KIND_IDS[number];
type RequiredAssertionChecklistId = typeof REQUIRED_ASSERTION_CHECKLIST_IDS[number];
type RequiredAttestationKey = typeof REQUIRED_ATTESTATION_KEYS[number];
type SafeFieldEditPath = typeof SAFE_FIELD_EDIT_PATHS[number];
type ExpectedMissingRequirementId = typeof EXPECTED_MISSING_REQUIREMENT_IDS[number];
type BlockedContentId = typeof BLOCKED_CONTENT[number];
type AllowedValueKindId = typeof ALLOWED_VALUE_KIND_IDS[number];
type SafeNextStepConclusion =
  | "ordinary_safe_next_step_packet_ready_for_row_owner_r1172_confirmation"
  | "ordinary_safe_next_step_packet_ready_for_row_owner_r1176_live_chain_confirmation"
  | "ordinary_safe_next_step_packet_safe_assertion_materialized_non_evidence"
  | "ordinary_safe_next_step_packet_waiting_on_r1145_completion_audit"
  | "ordinary_safe_next_step_packet_waiting_on_r1172_materializer"
  | "ordinary_safe_next_step_packet_waiting_on_r1173_answer_sheet";
type SafeNextStepAction =
  | "refresh_r1145_completion_audit"
  | "refresh_r1172_safe_assertion_materializer"
  | "refresh_r1173_safe_assertion_answer_sheet"
  | "rerun_r1172_with_row_owner_feature_only_safe_assertion_confirmation"
  | "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation"
  | "run_r1165_with_r1172_row_owner_safe_assertion";

interface ArtifactSummary {
  artifact: string;
  packetId?: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface PrioritizedInputKind {
  inputKindId:
    | RequiredInputKindId
    | "optional_common_bloodwork_or_vitals_context";
  mapsToSourceFamilyIds: Array<FeatureOnlySourceFamilyId | OptionalAddOnFamilyId>;
  privateDetailsStored: false;
  role: "minimum_required_feature_pair" | "optional_context_only";
  safeSubmitterExample: string;
}

interface RowOwnerOnlyAction {
  actionId:
    | "review_r1173_safe_assertion_answer_sheet"
    | "explicitly_run_r1172_materializer_if_all_safe_assertions_are_true"
    | "explicitly_run_r1176_live_chain_if_all_safe_assertions_are_true"
    | "run_r1165_with_materialized_safe_assertion";
  command: string;
  rowOwnerOnly: true;
  storesPrivateDetailsInPacket: false;
}

export interface R1174OrdinaryConsumerSafeNextStepPacketOptions {
  createdAt?: string;
  outputDir?: string;
  r1145Path?: string;
  r1172Path?: string;
  r1173Path?: string;
  r1176Path?: string;
}

export interface R1174OrdinaryConsumerSafeNextStepPacketOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    fileNamesStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelEvidencePromotedByR1174: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    privateConfigValuesStored: false;
    privateDetailsStored: false;
    privateFieldRefValuesStored: false;
    privateFieldRefsStored: false;
    privateTableRefValuesStored: false;
    privateTableRefsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowLevelDataAcceptedByR1174: false;
    rowOwnerConfirmationInferredByR1174: false;
    rowOwnerPrivateValuesStored: false;
    rowOwnerProvidedValuesStored: false;
    rowParsingPerformedByR1174: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: {
    r1145CompletionAudit: ArtifactSummary;
    r1172Materializer: ArtifactSummary;
    r1173AnswerSheet: ArtifactSummary;
    r1176LiveChain: ArtifactSummary;
  };
  packetId: "r1174-ordinary-consumer-safe-next-step-packet";
  productDisplayAuthorized: false;
  rowOwnerNextStepPacket: {
    allowedValueKindIds: AllowedValueKindId[];
    audience: "ordinary_submitter_roughly_16_50_row_owner";
    blockedContent: BlockedContentId[];
    currentMissingRequirementIds: ExpectedMissingRequirementId[];
    exactSafeFieldEditPaths: SafeFieldEditPath[];
    materializedSafeAssertionArtifact: "r1172-row-owner-feature-only-safe-assertion.json" | null;
    minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    optionalAddOnFamilyIds: OptionalAddOnFamilyId[];
    packetRole: "current_blocker_packet_only_not_assertion_not_model_evidence";
    prioritizedInputKinds: PrioritizedInputKind[];
    readyForR1165Runner: boolean;
    readyForRowOwnerR1172Confirmation: boolean;
    readyForRowOwnerR1176LiveChainConfirmation: boolean;
    requiredAssertionChecklistIds: RequiredAssertionChecklistId[];
    requiredAttestationKeys: RequiredAttestationKey[];
    r1176LiveChainCommand: typeof R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND | null;
    rowLevelDataAcceptedByR1174: false;
    rowOwnerOnlyActions: RowOwnerOnlyAction[];
    rowOwnerProvidedValuesStored: false;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
  schemaVersion: typeof R1174_ORDINARY_CONSUMER_SAFE_NEXT_STEP_PACKET_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    answerSheetReadyForRowOwner: boolean;
    allowedValueKindIds: AllowedValueKindId[];
    blockedContentIds: BlockedContentId[];
    conclusion: SafeNextStepConclusion;
    exactSafeFieldEditCount: number;
    explicitRowOwnerAssertionProvided: boolean;
    materializedSafeAssertionArtifact: "r1172-row-owner-feature-only-safe-assertion.json" | null;
    materializedSafeAssertionArtifactStoredAsPath: false;
    materializerReady: boolean;
    minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    nextAction: SafeNextStepAction;
    optionalAddOnFamilyIds: OptionalAddOnFamilyId[];
    productDisplayAuthorized: false;
    r1176LiveChainCommand: typeof R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND | null;
    readyForR1165Runner: boolean;
    readyForRowOwnerR1172Confirmation: boolean;
    readyForRowOwnerR1176LiveChainConfirmation: boolean;
    requiredAssertionChecklistIds: RequiredAssertionChecklistId[];
    requiredInputKindIds: RequiredInputKindId[];
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1174: false;
    rowOwnerConfirmationInferredByR1174: false;
    rowOwnerPrivateValuesStored: false;
    rowOwnerProvidedValuesStored: false;
    rowParsingPerformedByR1174: false;
    safeFieldEditPaths: SafeFieldEditPath[];
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
}

export async function runR1174OrdinaryConsumerSafeNextStepPacket(
  options: R1174OrdinaryConsumerSafeNextStepPacketOptions = {},
): Promise<{
  output: R1174OrdinaryConsumerSafeNextStepPacketOutput;
  outputPath: string;
}> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const r1145Path = options.r1145Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1145_ARTIFACT);
  const r1172Path = options.r1172Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1172_ARTIFACT);
  const r1173Path = options.r1173Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1173_ARTIFACT);
  const r1176Path = options.r1176Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1176_ARTIFACT);
  const r1145 = await readJsonIfPresent(r1145Path);
  const r1172 = await readJsonIfPresent(r1172Path);
  const r1173 = await readJsonIfPresent(r1173Path);
  const r1176 = await readJsonIfPresent(r1176Path);
  validateInputBoundary("r1145CompletionAudit", r1145);
  validateInputBoundary("r1172Materializer", r1172);
  validateInputBoundary("r1173AnswerSheet", r1173);
  validateInputBoundary("r1176LiveChain", r1176);

  const completionAuditReady = matchesR1145CompletionAudit(r1145);
  const answerSheetReady = matchesR1173AnswerSheet(r1173);
  const materializerReady = matchesR1172Materializer(r1172);
  const liveChainReadyForRowOwnerR1176Confirmation = matchesR1176LiveChainWaitingOnExplicitConfirmation(r1176);
  const explicitRowOwnerAssertionProvided =
    materializerReady && readBooleanAt(r1172, ["summary", "explicitRowOwnerAssertionProvided"]) === true;
  const safeAssertionArtifactWritten =
    materializerReady && readBooleanAt(r1172, ["summary", "safeAssertionArtifactWritten"]) === true;
  const materializedSafeAssertionArtifact = safeAssertionArtifactWritten
    ? readMaterializedAssertionArtifact(r1172)
    : null;
  const readyForRowOwnerR1172Confirmation =
    completionAuditReady && answerSheetReady && materializerReady && !safeAssertionArtifactWritten;
  const readyForR1165Runner =
    materializerReady && safeAssertionArtifactWritten && materializedSafeAssertionArtifact !== null;
  const readyForRowOwnerR1176LiveChainConfirmation =
    completionAuditReady
    && answerSheetReady
    && materializerReady
    && !safeAssertionArtifactWritten
    && liveChainReadyForRowOwnerR1176Confirmation;
  const conclusion = conclusionFor({
    answerSheetReady,
    completionAuditReady,
    materializerReady,
    readyForR1165Runner,
    readyForRowOwnerR1176LiveChainConfirmation,
  });
  const nextAction = nextActionFor({
    answerSheetReady,
    completionAuditReady,
    materializerReady,
    readyForR1165Runner,
    readyForRowOwnerR1176LiveChainConfirmation,
  });
  const currentMissingRequirementIds = currentMissingRequirements(r1145);

  const output: R1174OrdinaryConsumerSafeNextStepPacketOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: {
      r1145CompletionAudit: summarizeArtifact(r1145, R1145_ARTIFACT),
      r1172Materializer: summarizeArtifact(r1172, R1172_ARTIFACT),
      r1173AnswerSheet: summarizeArtifact(r1173, R1173_ARTIFACT),
      r1176LiveChain: summarizeArtifact(r1176, R1176_ARTIFACT),
    },
    packetId: "r1174-ordinary-consumer-safe-next-step-packet",
    productDisplayAuthorized: false,
    rowOwnerNextStepPacket: {
      allowedValueKindIds: [...ALLOWED_VALUE_KIND_IDS],
      audience: "ordinary_submitter_roughly_16_50_row_owner",
      blockedContent: [...BLOCKED_CONTENT],
      currentMissingRequirementIds,
      exactSafeFieldEditPaths: [...SAFE_FIELD_EDIT_PATHS],
      materializedSafeAssertionArtifact,
      minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      optionalAddOnFamilyIds: [...OPTIONAL_ADD_ON_FAMILY_IDS],
      packetRole: "current_blocker_packet_only_not_assertion_not_model_evidence",
      prioritizedInputKinds: prioritizedInputKinds(),
      readyForR1165Runner,
      readyForRowOwnerR1172Confirmation,
      readyForRowOwnerR1176LiveChainConfirmation,
      requiredAssertionChecklistIds: [...REQUIRED_ASSERTION_CHECKLIST_IDS],
      requiredAttestationKeys: [...REQUIRED_ATTESTATION_KEYS],
      r1176LiveChainCommand: readyForRowOwnerR1176LiveChainConfirmation
        ? R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND
        : null,
      rowLevelDataAcceptedByR1174: false,
      rowOwnerOnlyActions: rowOwnerOnlyActions(),
      rowOwnerProvidedValuesStored: false,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
    schemaVersion: R1174_ORDINARY_CONSUMER_SAFE_NEXT_STEP_PACKET_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      answerSheetReadyForRowOwner: answerSheetReady,
      allowedValueKindIds: [...ALLOWED_VALUE_KIND_IDS],
      blockedContentIds: [...BLOCKED_CONTENT],
      conclusion,
      exactSafeFieldEditCount: SAFE_FIELD_EDIT_PATHS.length,
      explicitRowOwnerAssertionProvided,
      materializedSafeAssertionArtifact,
      materializedSafeAssertionArtifactStoredAsPath: false,
      materializerReady,
      minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      nextAction,
      optionalAddOnFamilyIds: [...OPTIONAL_ADD_ON_FAMILY_IDS],
      productDisplayAuthorized: false,
      r1176LiveChainCommand: readyForRowOwnerR1176LiveChainConfirmation
        ? R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND
        : null,
      readyForR1165Runner,
      readyForRowOwnerR1172Confirmation,
      readyForRowOwnerR1176LiveChainConfirmation,
      requiredAssertionChecklistIds: [...REQUIRED_ASSERTION_CHECKLIST_IDS],
      requiredInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1174: false,
      rowOwnerConfirmationInferredByR1174: false,
      rowOwnerPrivateValuesStored: false,
      rowOwnerProvidedValuesStored: false,
      rowParsingPerformedByR1174: false,
      safeFieldEditPaths: [...SAFE_FIELD_EDIT_PATHS],
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };

  const forbidden = findForbiddenAggregateEgress(output);
  if (forbidden.length > 0) {
    throw new Error(`R1174 output failed aggregate boundary: ${forbidden.join(",")}`);
  }
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function matchesR1145CompletionAudit(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1145_PACKET_ID
    && readStringAt(value, ["schemaVersion"])
      === R1145_ORDINARY_CONSUMER_CURRENT_CHAIN_COMPLETION_AUDIT_SCHEMA_VERSION
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(value, ["artifactBoundary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["completionAudit", "goalAchieved"]) === false
    && readBooleanAt(value, ["completionAudit", "readyToMarkComplete"]) === false
    && readStringAt(value, ["completionAudit", "restatedObjective"])
      === "prioritize_ordinary_16_50_wearable_data_and_bloodwork_labs_for_murph_age_model"
    && (
      readStringAt(value, ["completionAudit", "nextConcreteAction"])
        === "rerun_r1172_with_row_owner_feature_only_safe_assertion_confirmation"
      || readStringAt(value, ["completionAudit", "nextConcreteAction"])
        === "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation"
    )
    && arraysEqual(readStringArrayAt(value, ["completionAudit", "missingRequirementIds"]), EXPECTED_MISSING_REQUIREMENT_IDS)
    && readBooleanAt(value, ["productDisplayAuthorized"]) === false;
}

function matchesR1173AnswerSheet(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1173_PACKET_ID
    && readStringAt(value, ["schemaVersion"])
      === R1173_ORDINARY_CONSUMER_SAFE_ASSERTION_ANSWER_SHEET_SCHEMA_VERSION
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(value, ["artifactBoundary", "answerSheetTemplatePathStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "assertionValuesStoredByR1173"]) === false
    && readBooleanAt(value, ["artifactBoundary", "modelEvidencePromotedByR1173"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowLevelDataAcceptedByR1173"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerAssertionInferredByR1173"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerProvidedValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowParsingPerformedByR1173"]) === false
    && readStringAt(value, ["rowOwnerAnswerSheet", "commands", "safeAssertionAnswerSheetCommand"])
      === R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND
    && readStringAt(value, ["rowOwnerAnswerSheet", "commands", "safeAssertionMaterializerCommand"])
      === R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND
    && arraysEqual(readStringArrayAt(value, ["rowOwnerAnswerSheet", "allowedValueKindIds"]), ALLOWED_VALUE_KIND_IDS)
    && arraysEqual(readStringArrayAt(value, ["rowOwnerAnswerSheet", "blockedAssertionContent"]), BLOCKED_CONTENT)
    && readBooleanAt(value, ["rowOwnerAnswerSheet", "materializerExplicitConfirmationRequired"]) === true
    && readBooleanAt(value, ["rowOwnerAnswerSheet", "readyForR1172MaterializerConfirmation"]) === true
    && arraysEqual(readStringArrayAt(value, ["summary", "allowedValueKindIds"]), ALLOWED_VALUE_KIND_IDS)
    && arraysEqual(readStringArrayAt(value, ["summary", "blockedAssertionContentIds"]), BLOCKED_CONTENT)
    && readBooleanAt(value, ["summary", "answerSheetReadyForRowOwner"]) === true
    && readBooleanAt(value, ["summary", "materializerReady"]) === true
    && readStringAt(value, ["summary", "nextAction"])
      === "rerun_r1172_with_row_owner_feature_only_safe_assertion_confirmation"
    && readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1173"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerAssertionInferredByR1173"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerProvidedValuesStored"]) === false
    && readBooleanAt(value, ["summary", "rowParsingPerformedByR1173"]) === false
    && arraysEqual(readStringArrayAt(value, ["summary", "minimumFeaturePairRequired"]), FEATURE_ONLY_SOURCE_FAMILY_IDS)
    && arraysEqual(readStringArrayAt(value, ["summary", "requiredInputKindIds"]), REQUIRED_INPUT_KIND_IDS)
    && arraysEqual(readStringArrayAt(value, ["summary", "safeFieldEditPaths"]), SAFE_FIELD_EDIT_PATHS)
    && readNumberAt(value, ["summary", "exactSafeAnswerCount"]) === SAFE_FIELD_EDIT_PATHS.length;
}

function matchesR1172Materializer(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1172_PACKET_ID
    && readStringAt(value, ["schemaVersion"])
      === R1172_ORDINARY_CONSUMER_SAFE_ASSERTION_MATERIALIZER_SCHEMA_VERSION
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(value, ["artifactBoundary", "assertionFileWrittenOnlyAfterExplicitAssertion"]) === true
    && readBooleanAt(value, ["artifactBoundary", "assertionValuesStoredInR1172Packet"]) === false
    && readBooleanAt(value, ["artifactBoundary", "modelEvidencePromotedByR1172"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowLevelDataAcceptedByR1172"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerAssertionInferredByR1172"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowParsingPerformedByR1172"]) === false
    && readStringAt(value, ["materializer", "materializerCommand"]) === R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND
    && readStringAt(value, ["materializer", "r1165RunnerCommand"]) === R1165_SAFE_ASSERTION_RUNNER_COMMAND
    && arraysEqual(readStringArrayAt(value, ["materializer", "allowedValueKindIds"]), ALLOWED_VALUE_KIND_IDS)
    && arraysEqual(readStringArrayAt(value, ["materializer", "blockedContentIds"]), BLOCKED_CONTENT)
    && readBooleanAt(value, ["materializer", "r1165RunnerReadyForAssertion"]) === true
    && readBooleanAt(value, ["materializer", "r1165TemplateReady"]) === true
    && readBooleanAt(value, ["materializer", "r1167FillGuideReady"]) === true
    && arraysEqual(readStringArrayAt(value, ["summary", "allowedValueKindIds"]), ALLOWED_VALUE_KIND_IDS)
    && arraysEqual(readStringArrayAt(value, ["summary", "blockedContentIds"]), BLOCKED_CONTENT)
    && readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1172"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerAssertionInferredByR1172"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["summary", "rowParsingPerformedByR1172"]) === false
    && arraysEqual(readStringArrayAt(value, ["summary", "minimumFeaturePairRequired"]), FEATURE_ONLY_SOURCE_FAMILY_IDS)
    && arraysEqual(readStringArrayAt(value, ["summary", "requiredInputKindIds"]), REQUIRED_INPUT_KIND_IDS)
    && arraysEqual(readStringArrayAt(value, ["summary", "safeFieldEditPaths"]), SAFE_FIELD_EDIT_PATHS);
}

function matchesR1176LiveChainWaitingOnExplicitConfirmation(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1176_PACKET_ID
    && readStringAt(value, ["schemaVersion"])
      === R1176_R1172_R1165_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_SCHEMA_VERSION
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(value, ["artifactBoundary", "assertionValuesStoredByR1176"]) === false
    && readBooleanAt(value, ["artifactBoundary", "modelEvidencePromotedByR1176"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowLevelDataAcceptedByR1176"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerAssertionInferredByR1176"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowParsingPerformedByR1176"]) === false
    && readStringAt(value, ["chainRun", "chainRunnerCommand"])
      === R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND
    && readBooleanAt(value, ["chainRun", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["chainRun", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["chainRun", "realEvidenceProduced"]) === false
    && readBooleanAt(value, ["chainRun", "rowLevelDataAcceptedByR1176"]) === false
    && readBooleanAt(value, ["chainRun", "rowOwnerPrivateValuesStored"]) === false
    && readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(value, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && readStringAt(value, ["summary", "conclusion"])
      === "row_owner_safe_assertion_chain_waiting_on_explicit_confirmation"
    && readStringAt(value, ["summary", "nextAction"])
      === "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation"
    && readBooleanAt(value, ["summary", "chainReady"]) === false
    && readBooleanAt(value, ["summary", "explicitRowOwnerAssertionProvided"]) === false
    && readBooleanAt(value, ["summary", "featureOnlyResearchPlanningReady"]) === false
    && readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["summary", "outcomeLinkedModelEvidenceStillRequired"]) === true
    && readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["summary", "realEvidenceProduced"]) === false
    && readBooleanAt(value, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1176"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerAssertionStillRequiredForLiveChain"]) === true
    && readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["summary", "rowParsingPerformedByR1176"]) === false
    && arraysEqual(readStringArrayAt(value, ["summary", "minimumFeaturePairRequired"]), FEATURE_ONLY_SOURCE_FAMILY_IDS)
    && arraysEqual(readStringArrayAt(value, ["summary", "requiredInputKindIds"]), REQUIRED_INPUT_KIND_IDS)
    && arraysEqual(readStringArrayAt(value, ["summary", "safeFieldEditPaths"]), SAFE_FIELD_EDIT_PATHS);
}

function conclusionFor(input: {
  answerSheetReady: boolean;
  completionAuditReady: boolean;
  materializerReady: boolean;
  readyForR1165Runner: boolean;
  readyForRowOwnerR1176LiveChainConfirmation: boolean;
}): SafeNextStepConclusion {
  if (!input.completionAuditReady) return "ordinary_safe_next_step_packet_waiting_on_r1145_completion_audit";
  if (!input.answerSheetReady) return "ordinary_safe_next_step_packet_waiting_on_r1173_answer_sheet";
  if (!input.materializerReady) return "ordinary_safe_next_step_packet_waiting_on_r1172_materializer";
  if (input.readyForR1165Runner) return "ordinary_safe_next_step_packet_safe_assertion_materialized_non_evidence";
  if (input.readyForRowOwnerR1176LiveChainConfirmation) {
    return "ordinary_safe_next_step_packet_ready_for_row_owner_r1176_live_chain_confirmation";
  }
  return "ordinary_safe_next_step_packet_ready_for_row_owner_r1172_confirmation";
}

function nextActionFor(input: {
  answerSheetReady: boolean;
  completionAuditReady: boolean;
  materializerReady: boolean;
  readyForR1165Runner: boolean;
  readyForRowOwnerR1176LiveChainConfirmation: boolean;
}): SafeNextStepAction {
  if (!input.completionAuditReady) return "refresh_r1145_completion_audit";
  if (!input.answerSheetReady) return "refresh_r1173_safe_assertion_answer_sheet";
  if (!input.materializerReady) return "refresh_r1172_safe_assertion_materializer";
  if (input.readyForR1165Runner) return "run_r1165_with_r1172_row_owner_safe_assertion";
  if (input.readyForRowOwnerR1176LiveChainConfirmation) {
    return "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation";
  }
  return "rerun_r1172_with_row_owner_feature_only_safe_assertion_confirmation";
}

function currentMissingRequirements(value: unknown | null): ExpectedMissingRequirementId[] {
  const ids = readStringArrayAt(value, ["completionAudit", "missingRequirementIds"]);
  const allowed = new Set<string>(EXPECTED_MISSING_REQUIREMENT_IDS);
  const kept = ids.filter((id): id is ExpectedMissingRequirementId => allowed.has(id));
  return kept.length > 0 ? kept : [...EXPECTED_MISSING_REQUIREMENT_IDS];
}

function readMaterializedAssertionArtifact(value: unknown | null):
  | "r1172-row-owner-feature-only-safe-assertion.json"
  | null {
  const artifact = readStringAt(value, ["summary", "materializedAssertionArtifact"])
    ?? readStringAt(value, ["materializer", "materializedAssertionArtifact"]);
  return artifact === "r1172-row-owner-feature-only-safe-assertion.json" ? artifact : null;
}

function prioritizedInputKinds(): PrioritizedInputKind[] {
  return [
    {
      inputKindId: "lab_portal_export_or_spreadsheet",
      mapsToSourceFamilyIds: ["bloodwork_glycemia"],
      privateDetailsStored: false,
      role: "minimum_required_feature_pair",
      safeSubmitterExample: "A normal lab portal export or spreadsheet with glycemia bloodwork coverage, kept in the row owner's local workspace.",
    },
    {
      inputKindId: "phone_watch_or_wearable_activity_export",
      mapsToSourceFamilyIds: ["wearable_activity_daily"],
      privateDetailsStored: false,
      role: "minimum_required_feature_pair",
      safeSubmitterExample: "A phone, watch, or wearable daily activity export, kept in the row owner's local workspace.",
    },
    {
      inputKindId: "optional_common_bloodwork_or_vitals_context",
      mapsToSourceFamilyIds: [
        "common_bloodwork_core",
        "vitals_body_context",
      ],
      privateDetailsStored: false,
      role: "optional_context_only",
      safeSubmitterExample: "Optional common bloodwork or basic vitals/body context if already available locally.",
    },
  ];
}

function rowOwnerOnlyActions(): RowOwnerOnlyAction[] {
  return [
    {
      actionId: "review_r1173_safe_assertion_answer_sheet",
      command: R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND,
      rowOwnerOnly: true,
      storesPrivateDetailsInPacket: false,
    },
    {
      actionId: "explicitly_run_r1172_materializer_if_all_safe_assertions_are_true",
      command: R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND,
      rowOwnerOnly: true,
      storesPrivateDetailsInPacket: false,
    },
    {
      actionId: "explicitly_run_r1176_live_chain_if_all_safe_assertions_are_true",
      command: R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
      rowOwnerOnly: true,
      storesPrivateDetailsInPacket: false,
    },
    {
      actionId: "run_r1165_with_materialized_safe_assertion",
      command: R1165_SAFE_ASSERTION_RUNNER_COMMAND,
      rowOwnerOnly: true,
      storesPrivateDetailsInPacket: false,
    },
  ];
}

function summarizeArtifact(value: unknown | null, artifact: string): ArtifactSummary {
  if (!isRecord(value)) {
    return {
      artifact,
      schemaVersion: null,
      status: "missing",
    };
  }
  return {
    artifact,
    packetId: readStringAt(value, ["packetId"]),
    schemaVersion: readStringAt(value, ["schemaVersion"]),
    status: "available",
  };
}

function safeBoundary(): R1174OrdinaryConsumerSafeNextStepPacketOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    fileNamesStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelEvidencePromotedByR1174: false,
    modelParametersStored: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    privateConfigValuesStored: false,
    privateDetailsStored: false,
    privateFieldRefValuesStored: false,
    privateFieldRefsStored: false,
    privateTableRefValuesStored: false,
    privateTableRefsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowLevelDataAcceptedByR1174: false,
    rowOwnerConfirmationInferredByR1174: false,
    rowOwnerPrivateValuesStored: false,
    rowOwnerProvidedValuesStored: false,
    rowParsingPerformedByR1174: false,
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
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function validateInputBoundary(label: string, value: unknown | null): void {
  if (value === null) return;
  const forbidden = findForbiddenAggregateEgress(value);
  if (forbidden.length > 0) {
    throw new Error(`${label} failed aggregate boundary: ${forbidden.join(",")}`);
  }
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const valueAtPath = readAtPath(value, pathParts);
  return typeof valueAtPath === "string" ? valueAtPath : null;
}

function readBooleanAt(value: unknown, pathParts: readonly string[]): boolean | null {
  const valueAtPath = readAtPath(value, pathParts);
  return typeof valueAtPath === "boolean" ? valueAtPath : null;
}

function readNumberAt(value: unknown, pathParts: readonly string[]): number | null {
  const valueAtPath = readAtPath(value, pathParts);
  return typeof valueAtPath === "number" && Number.isFinite(valueAtPath) ? valueAtPath : null;
}

function readStringArrayAt(value: unknown, pathParts: readonly string[]): string[] {
  const valueAtPath = readAtPath(value, pathParts);
  return Array.isArray(valueAtPath) && valueAtPath.every((item) => typeof item === "string")
    ? valueAtPath
    : [];
}

function readAtPath(value: unknown, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!isRecord(current)) return null;
    current = current[part];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arraysEqual(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

async function main(): Promise<void> {
  const { output } = await runR1174OrdinaryConsumerSafeNextStepPacket({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1145Path: process.env.MURPH_AGE_R1145_ORDINARY_CONSUMER_CURRENT_CHAIN_COMPLETION_AUDIT_PATH,
    r1172Path: process.env.MURPH_AGE_R1172_ORDINARY_CONSUMER_SAFE_ASSERTION_MATERIALIZER_PATH,
    r1173Path: process.env.MURPH_AGE_R1173_ORDINARY_CONSUMER_SAFE_ASSERTION_ANSWER_SHEET_PATH,
    r1176Path: process.env.MURPH_AGE_R1176_R1172_R1165_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_PATH,
  });
  const summary = {
    allowedValueKindIds: output.summary.allowedValueKindIds,
    blockedContentIds: output.summary.blockedContentIds,
    conclusion: output.summary.conclusion,
    exactSafeFieldEditCount: output.summary.exactSafeFieldEditCount,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    r1176LiveChainCommand: output.summary.r1176LiveChainCommand,
    readyForR1165Runner: output.summary.readyForR1165Runner,
    readyForRowOwnerR1172Confirmation: output.summary.readyForRowOwnerR1172Confirmation,
    readyForRowOwnerR1176LiveChainConfirmation: output.summary.readyForRowOwnerR1176LiveChainConfirmation,
    schemaVersion: output.schemaVersion,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1174 safe next-step packet failed.")}\n`);
    process.exitCode = 1;
  });
}
