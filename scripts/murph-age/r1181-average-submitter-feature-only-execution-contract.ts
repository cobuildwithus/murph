import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_COMMAND,
  R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_SCHEMA_VERSION,
  R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION,
} from "./r1180-average-submitter-safe-confirmation-response-intake.ts";

export const R1181_AVERAGE_SUBMITTER_FEATURE_ONLY_EXECUTION_CONTRACT_SCHEMA_VERSION =
  "murph-age-r1181-average-submitter-feature-only-execution-contract.v1" as const;
export const R1181_AVERAGE_SUBMITTER_FEATURE_ONLY_EXECUTION_CONTRACT_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1181-average-submitter-feature-only-execution-contract.ts" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1181-average-submitter-feature-only-execution-contract.latest.json" as const;
const R1180_ARTIFACT = "r1180-average-submitter-safe-confirmation-response-intake.latest.json" as const;
const R1180_PACKET_ID = "r1180-average-submitter-safe-confirmation-response-intake" as const;
const R1181_PACKET_ID = "r1181-average-submitter-feature-only-execution-contract" as const;
const R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_COMMAND_FOR_GUIDANCE =
  "pnpm exec tsx scripts/murph-age/r1180-average-submitter-safe-confirmation-response-intake.ts" as const;
const R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1183-average-submitter-safe-response-materializer.ts" as const;
const R1183_FILLABLE_RESPONSE_FILE_NAME =
  "r1183-fillable-average-submitter-safe-confirmation-response.json" as const;
const R1180_SAFE_CONFIRMATION_RESPONSE_PATH_ENV_VAR =
  "MURPH_AGE_R1180_SAFE_CONFIRMATION_RESPONSE_PATH" as const;
const R1180_WITH_FILLABLE_RESPONSE_COMMAND =
  `${R1180_SAFE_CONFIRMATION_RESPONSE_PATH_ENV_VAR}=<${R1183_FILLABLE_RESPONSE_FILE_NAME}> ${R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_COMMAND_FOR_GUIDANCE}` as const;
const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first" as const;
const TARGET_AGE_BAND = "roughly_16_50" as const;
const EXECUTION_ROLE = "feature_only_research_planning_not_model_evidence" as const;
const R1181_UNEXPECTED_R1180_SHAPE_ERROR =
  "R1181 rejected unexpected r1180 safe confirmation response intake shape." as const;
const ROW_OWNER_SAFE_CONFIRMATION_ASK_ID =
  "confirm_feature_only_lab_wearable_availability_without_private_values" as const;
const MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
] as const;
const R1180_ALLOWED_VALUE_KIND_IDS = [
  "booleans_only",
  "fixed_enumerated_ids_only",
] as const;
const R1180_REQUIRED_ASSERTION_CHECKLIST_IDS = [
  "assert_target_age_band_roughly_16_50",
  "assert_glycemia_bloodwork_export_available",
  "assert_daily_wearable_activity_export_available",
  "assert_no_private_values_identifiers_paths_headers_or_rows",
] as const;
const R1180_SAFE_COMPLETION_CHECKLIST_ITEM_IDS = [
  "confirm_target_age_band_without_identifiers",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
] as const;
const R1180_RESPONSE_KIND_IDS = [
  "explicit_yes_all_required_assertions_confirmed",
  "not_confirmed_or_unsure",
] as const;
const R1180_INVALID_RESPONSE_REASON_IDS = [
  "ask_id_mismatch",
  "non_boolean_required_field",
  "response_not_object",
  "schema_version_mismatch",
  "unexpected_keys",
  "unsupported_response_kind",
] as const;
const R1180_RESPONSE_STATUS_IDS = [
  "incomplete",
  "invalid",
  "missing",
  "ready",
] as const;
const R1180_INTAKE_CONCLUSION_IDS = [
  "safe_confirmation_response_intake_ready_feature_only",
  "safe_confirmation_response_intake_waiting_on_response",
  "safe_confirmation_response_intake_waiting_on_r1179_ask",
  "safe_confirmation_response_intake_rejected_response_shape",
] as const;
const R1180_NEXT_ACTION_IDS = [
  "fill_safe_confirmation_response_template",
  "refresh_r1179_safe_confirmation_ask",
  "rerun_safe_confirmation_response_with_valid_json_object",
  "carry_safe_confirmation_to_feature_only_chain",
  "none",
] as const;
const OPTIONAL_CONTEXT_FAMILY_IDS = [
  "common_bloodwork_core",
  "vitals_body_context",
] as const;
const PRIORITIZED_INPUT_KIND_IDS = [
  "lab_portal_export_or_spreadsheet",
  "phone_watch_or_wearable_activity_export",
] as const;
const REQUIRED_R1180_SAFE_RESPONSE_FIELD_IDS = [
  "confirm_target_age_band_roughly_16_50",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
] as const;
const BLOCKED_CONTENT_IDS = [
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
const FEATURE_SLOT_DEFINITIONS = [
  {
    featureFamilyId: "bloodwork_glycemia",
    inputKindId: "lab_portal_export_or_spreadsheet",
    minimumPairRequired: true,
    privateDetailsStored: false,
    role: "minimum_lab_signal",
    safeSlotId: "glycemia_lab_presence",
  },
  {
    featureFamilyId: "bloodwork_glycemia",
    inputKindId: "lab_portal_export_or_spreadsheet",
    minimumPairRequired: true,
    privateDetailsStored: false,
    role: "minimum_lab_time_alignment",
    safeSlotId: "glycemia_measurement_date_presence",
  },
  {
    featureFamilyId: "wearable_activity_daily",
    inputKindId: "phone_watch_or_wearable_activity_export",
    minimumPairRequired: true,
    privateDetailsStored: false,
    role: "minimum_wearable_activity_signal",
    safeSlotId: "daily_activity_presence",
  },
  {
    featureFamilyId: "wearable_activity_daily",
    inputKindId: "phone_watch_or_wearable_activity_export",
    minimumPairRequired: true,
    privateDetailsStored: false,
    role: "minimum_wearable_coverage_quality",
    safeSlotId: "daily_wear_coverage_presence",
  },
] as const;
const R1181_NEXT_ACTION_IDS = [
  "fill_r1180_safe_confirmation_response_template",
  "refresh_r1180_safe_confirmation_response_intake",
  "rerun_r1180_with_valid_safe_confirmation_response",
  "use_feature_only_execution_contract_for_research_planning_only",
  "none",
] as const;
const R1180_OUTPUT_KEYS = [
  "artifactBoundary",
  "createdAt",
  "inputArtifacts",
  "packetId",
  "productDisplayAuthorized",
  "safeConfirmationResponseIntake",
  "schemaVersion",
  "status",
  "summary",
] as const;
const R1180_ARTIFACT_BOUNDARY_KEYS = [
  "aggregateOnly",
  "codebookTextStored",
  "coefficientsStored",
  "fileNamesStored",
  "headerValuesStored",
  "localPathsStored",
  "modelEvidencePromotedByR1180",
  "modelParametersStored",
  "participantIdentifiersStored",
  "participantIdentifiersWritten",
  "predictionsStored",
  "privateConfigValuesStored",
  "privateDetailsStored",
  "privateFieldRefValuesStored",
  "privateFieldRefsStored",
  "privateTableRefValuesStored",
  "privateTableRefsStored",
  "productClaimsIncluded",
  "productDisplayAuthorized",
  "productPromotionAuthorized",
  "recommendationClaimsIncluded",
  "rowLevelDataAcceptedByR1180",
  "rowOwnerConfirmationInferredByR1180",
  "rowOwnerPrivateValuesStored",
  "rowOwnerProvidedPrivateValuesStored",
  "rowOwnerProvidedSafeBooleansStored",
  "rowParsingPerformedByR1180",
  "rowValuesStored",
  "smallCellsStored",
  "sourceBodiesStored",
  "sourceFileNamesStored",
  "sourceVariableNamesStored",
  "splitMembershipStored",
] as const;
const R1180_INPUT_ARTIFACT_KEYS = [
  "r1179ObjectiveGapAudit",
  "safeConfirmationResponse",
] as const;
const R1180_ARTIFACT_SUMMARY_KEYS = [
  "artifact",
  "packetId",
  "schemaVersion",
  "status",
] as const;
const R1180_SAFE_CONFIRMATION_RESPONSE_SUMMARY_KEYS = [
  "schemaVersion",
  "status",
] as const;
const R1180_SHARED_INTAKE_KEYS = [
  "allowedValueKindIds",
  "askId",
  "blockedContentIds",
  "conclusion",
  "explicitRowOwnerSafeConfirmationProvided",
  "featureOnlySafeConfirmationReady",
  "invalidResponseReasonIds",
  "minimumFeaturePairRequired",
  "missingRequiredResponseFieldIds",
  "modelEvidencePromotionAllowed",
  "nextAction",
  "nextActionCommand",
  "prioritizedInputKindIds",
  "productDisplayAuthorized",
  "requiredAssertionChecklistIds",
  "requiredResponseFieldIds",
  "responseKind",
  "responseStatus",
  "reviewGptRequiredNow",
  "rowLevelDataAcceptedByR1180",
  "rowOwnerConfirmationInferredByR1180",
  "rowOwnerPrivateValuesStored",
  "rowOwnerProvidedPrivateValuesStored",
  "rowOwnerProvidedSafeBooleansStored",
  "rowParsingPerformedByR1180",
  "safeCompletionChecklistItemIds",
  "safeResponseTemplateGuidance",
  "sourcePriority",
  "targetAgeBand",
] as const;
const R1180_SAFE_CONFIRMATION_RESPONSE_TEMPLATE_KEYS = [
  "askId",
  "confirmDailyWearableActivityExportAvailable",
  "confirmGlycemiaBloodworkExportAvailable",
  "confirmNoPrivateValuesIncluded",
  "confirmTargetAgeBandRoughly16To50",
  "responseKind",
  "schemaVersion",
] as const;
const R1180_SAFE_RESPONSE_TEMPLATE_GUIDANCE_KEYS = [
  "allowedValueKindIds",
  "blockedContentIds",
  "fillableResponseArtifact",
  "materializeFillableResponseCommand",
  "modelEvidencePromotionAllowed",
  "productDisplayAuthorized",
  "responsePathEnvVar",
  "responseTemplateKeyOrder",
  "rowOwnerOnly",
  "runIntakeWithFilledTemplateCommand",
  "storesPrivateDetailsInPacket",
] as const;
const R1180_SAFE_FALSE_FLAG_KEYS = [
  "modelEvidencePromotionAllowed",
  "productDisplayAuthorized",
  "reviewGptRequiredNow",
  "rowLevelDataAcceptedByR1180",
  "rowOwnerConfirmationInferredByR1180",
  "rowOwnerPrivateValuesStored",
  "rowOwnerProvidedPrivateValuesStored",
  "rowOwnerProvidedSafeBooleansStored",
  "rowParsingPerformedByR1180",
] as const;

type MinimumFeaturePairSourceFamilyId = typeof MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS[number];
type OptionalContextFamilyId = typeof OPTIONAL_CONTEXT_FAMILY_IDS[number];
type PrioritizedInputKindId = typeof PRIORITIZED_INPUT_KIND_IDS[number];
type RequiredR1180SafeResponseFieldId = typeof REQUIRED_R1180_SAFE_RESPONSE_FIELD_IDS[number];
type BlockedContentId = typeof BLOCKED_CONTENT_IDS[number];
type FeatureSlot = typeof FEATURE_SLOT_DEFINITIONS[number];
type R1181NextActionId = typeof R1181_NEXT_ACTION_IDS[number];
type R1180ResponseStatus = "incomplete" | "invalid" | "missing" | "ready" | null;
type ContractConclusion =
  | "average_submitter_feature_only_execution_contract_ready_research_only"
  | "average_submitter_feature_only_execution_contract_waiting_on_r1180"
  | "average_submitter_feature_only_execution_contract_waiting_on_safe_confirmation"
  | "average_submitter_feature_only_execution_contract_rejected_r1180_response_shape";

interface ArtifactSummary {
  artifact: typeof R1180_ARTIFACT;
  packetId: typeof R1180_PACKET_ID | null;
  schemaVersion: typeof R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_SCHEMA_VERSION | null;
  status: "available" | "missing";
}

interface R1180State {
  artifactBoundaryAggregateOnly: boolean | null;
  artifactBoundaryUnsafeTrueFlagFound: boolean;
  explicitRowOwnerSafeConfirmationProvided: boolean | null;
  featureOnlySafeConfirmationReady: boolean | null;
  invalidResponseReasonsEmpty: boolean;
  r1180Conclusion: string | null;
  modelEvidencePromotionAllowed: boolean | null;
  nextAction: string | null;
  nextActionCommand: string | null;
  packetId: typeof R1180_PACKET_ID | null;
  productDisplayAuthorized: boolean | null;
  responseArtifactStatus: "available" | "missing" | null;
  responseKind: string | null;
  responseSchemaVersion: typeof R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION | null;
  responseStatus: R1180ResponseStatus;
  r1180Available: boolean;
  r1180Status: "research-local-aggregate-only" | null;
  rowLevelDataAcceptedByR1180: boolean | null;
  rowOwnerConfirmationInferredByR1180: boolean | null;
  rowOwnerPrivateValuesStored: boolean | null;
  rowOwnerProvidedPrivateValuesStored: boolean | null;
  rowOwnerProvidedSafeBooleansStored: boolean | null;
  rowParsingPerformedByR1180: boolean | null;
  r1180SchemaCurrent: boolean;
  safeMinimumPairMatches: boolean;
  safeResponseFieldsSatisfied: boolean;
  sourcePriorityMatches: boolean;
  targetAgeBandMatches: boolean;
}

export interface R1181AverageSubmitterFeatureOnlyExecutionContractOptions {
  createdAt?: string;
  outputDir?: string;
  r1180Path?: string;
}

export interface R1181AverageSubmitterFeatureOnlyExecutionContractOutput {
  artifactBoundary: ReturnType<typeof safeBoundary>;
  createdAt: string;
  featureOnlyExecutionContract: {
    blockedContentIds: BlockedContentId[];
    contractCommand: typeof R1181_AVERAGE_SUBMITTER_FEATURE_ONLY_EXECUTION_CONTRACT_COMMAND;
    evidenceUse: "research_planning_only_not_model_evidence";
    executionFeatureSlots: FeatureSlot[];
    executionRole: typeof EXECUTION_ROLE;
    featureOnlyExecutionContractReady: boolean;
    minimumFeaturePairRequired: MinimumFeaturePairSourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    optionalContextFamilyIds: OptionalContextFamilyId[];
    outcomeLinkedModelEvidenceStillRequired: true;
    prioritizedInputKindIds: PrioritizedInputKindId[];
    productDisplayAuthorized: false;
    requiredR1180SafeResponseFieldIds: RequiredR1180SafeResponseFieldId[];
    researchPlanningAllowed: boolean;
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1181: false;
    rowOwnerConfirmationInferredByR1181: false;
    rowOwnerPrivateValuesStored: false;
    rowParsingPerformedByR1181: false;
    sourcePriority: typeof TARGET_INPUT_PRIORITY;
    targetAgeBand: typeof TARGET_AGE_BAND;
  };
  inputArtifacts: {
    r1180SafeConfirmationResponseIntake: ArtifactSummary;
  };
  packetId: typeof R1181_PACKET_ID;
  productDisplayAuthorized: false;
  r1180State: R1180State;
  schemaVersion: typeof R1181_AVERAGE_SUBMITTER_FEATURE_ONLY_EXECUTION_CONTRACT_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: ContractConclusion;
    explicitRowOwnerSafeConfirmationProvided: boolean | null;
    featureOnlyExecutionContractReady: boolean;
    featureOnlySafeConfirmationReady: boolean | null;
    minimumFeaturePairRequired: MinimumFeaturePairSourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    nextAction: R1181NextActionId;
    nextActionCommand: string | null;
    optionalContextFamilyIds: OptionalContextFamilyId[];
    prioritizedInputKindIds: PrioritizedInputKindId[];
    productDisplayAuthorized: false;
    researchPlanningAllowed: boolean;
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1181: false;
    rowOwnerConfirmationInferredByR1181: false;
    rowOwnerPrivateValuesStored: false;
    rowParsingPerformedByR1181: false;
    safeExecutionFeatureSlotIds: Array<FeatureSlot["safeSlotId"]>;
    sourcePriority: typeof TARGET_INPUT_PRIORITY;
    targetAgeBand: typeof TARGET_AGE_BAND;
  };
}

export async function runR1181AverageSubmitterFeatureOnlyExecutionContract(
  options: R1181AverageSubmitterFeatureOnlyExecutionContractOptions = {},
): Promise<{ output: R1181AverageSubmitterFeatureOnlyExecutionContractOutput; outputPath: string }> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const r1180 = await readJsonIfPresent(options.r1180Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1180_ARTIFACT));
  validateAggregateSafe("r1180 safe confirmation response intake", r1180);
  validateR1180ExpectedArtifactShape(r1180);

  const r1180State = stateFromR1180(r1180);
  const featureOnlyExecutionContractReady = r1180ReadyForContract(r1180State);
  const researchPlanningAllowed = featureOnlyExecutionContractReady;
  const contractState = contractStateFor(r1180State, featureOnlyExecutionContractReady);
  const output: R1181AverageSubmitterFeatureOnlyExecutionContractOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: createdAtFor(options.createdAt),
    featureOnlyExecutionContract: {
      blockedContentIds: [...BLOCKED_CONTENT_IDS],
      contractCommand: R1181_AVERAGE_SUBMITTER_FEATURE_ONLY_EXECUTION_CONTRACT_COMMAND,
      evidenceUse: "research_planning_only_not_model_evidence",
      executionFeatureSlots: FEATURE_SLOT_DEFINITIONS.map((slot) => ({ ...slot })),
      executionRole: EXECUTION_ROLE,
      featureOnlyExecutionContractReady,
      minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      optionalContextFamilyIds: [...OPTIONAL_CONTEXT_FAMILY_IDS],
      outcomeLinkedModelEvidenceStillRequired: true,
      prioritizedInputKindIds: [...PRIORITIZED_INPUT_KIND_IDS],
      productDisplayAuthorized: false,
      requiredR1180SafeResponseFieldIds: [...REQUIRED_R1180_SAFE_RESPONSE_FIELD_IDS],
      researchPlanningAllowed,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1181: false,
      rowOwnerConfirmationInferredByR1181: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1181: false,
      sourcePriority: TARGET_INPUT_PRIORITY,
      targetAgeBand: TARGET_AGE_BAND,
    },
    inputArtifacts: {
      r1180SafeConfirmationResponseIntake: summarizeR1180(r1180),
    },
    packetId: R1181_PACKET_ID,
    productDisplayAuthorized: false,
    r1180State,
    schemaVersion: R1181_AVERAGE_SUBMITTER_FEATURE_ONLY_EXECUTION_CONTRACT_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: contractState.conclusion,
      explicitRowOwnerSafeConfirmationProvided: r1180State.explicitRowOwnerSafeConfirmationProvided,
      featureOnlyExecutionContractReady,
      featureOnlySafeConfirmationReady: r1180State.featureOnlySafeConfirmationReady,
      minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      nextAction: contractState.nextAction,
      nextActionCommand: commandForNextAction(contractState.nextAction),
      optionalContextFamilyIds: [...OPTIONAL_CONTEXT_FAMILY_IDS],
      prioritizedInputKindIds: [...PRIORITIZED_INPUT_KIND_IDS],
      productDisplayAuthorized: false,
      researchPlanningAllowed,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1181: false,
      rowOwnerConfirmationInferredByR1181: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1181: false,
      safeExecutionFeatureSlotIds: FEATURE_SLOT_DEFINITIONS.map((slot) => slot.safeSlotId),
      sourcePriority: TARGET_INPUT_PRIORITY,
      targetAgeBand: TARGET_AGE_BAND,
    },
  };

  validateAggregateSafe("r1181 feature-only execution contract", output);
  ensureNoOutputPathInOutput(output, outputDir);
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function stateFromR1180(value: unknown | null): R1180State {
  const schemaCurrent = readStringAt(value, ["schemaVersion"])
    === R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_SCHEMA_VERSION;
  const responseStatus = readR1180ResponseStatus(value);
  const missingRequiredResponseFieldIds = readStringArrayAt(value, ["summary", "missingRequiredResponseFieldIds"]);
  const invalidResponseReasonIds = readStringArrayAt(value, ["summary", "invalidResponseReasonIds"]);
  return {
    artifactBoundaryAggregateOnly: readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]),
    artifactBoundaryUnsafeTrueFlagFound: hasUnsafeTrueBoundaryFlag(value),
    explicitRowOwnerSafeConfirmationProvided: readBooleanAt(value, [
      "summary",
      "explicitRowOwnerSafeConfirmationProvided",
    ]),
    featureOnlySafeConfirmationReady: readBooleanAt(value, ["summary", "featureOnlySafeConfirmationReady"]),
    invalidResponseReasonsEmpty: invalidResponseReasonIds.length === 0,
    r1180Conclusion: readStringAt(value, ["summary", "conclusion"]),
    modelEvidencePromotionAllowed: readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]),
    nextAction: readStringAt(value, ["summary", "nextAction"]),
    nextActionCommand: readStringAt(value, ["summary", "nextActionCommand"]),
    packetId: readStringAt(value, ["packetId"]) === R1180_PACKET_ID ? R1180_PACKET_ID : null,
    productDisplayAuthorized: readBooleanAt(value, ["summary", "productDisplayAuthorized"]),
    responseArtifactStatus: readR1180ResponseArtifactStatus(value),
    responseKind: readStringAt(value, ["summary", "responseKind"]),
    responseSchemaVersion: readStringAt(value, ["inputArtifacts", "safeConfirmationResponse", "schemaVersion"])
      === R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION
      ? R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION
      : null,
    responseStatus,
    r1180Available: value !== null,
    r1180Status: readStringAt(value, ["status"]) === "research-local-aggregate-only"
      ? "research-local-aggregate-only"
      : null,
    rowLevelDataAcceptedByR1180: readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1180"]),
    rowOwnerConfirmationInferredByR1180: readBooleanAt(value, [
      "summary",
      "rowOwnerConfirmationInferredByR1180",
    ]),
    rowOwnerPrivateValuesStored: readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]),
    rowOwnerProvidedPrivateValuesStored: readBooleanAt(value, [
      "summary",
      "rowOwnerProvidedPrivateValuesStored",
    ]),
    rowOwnerProvidedSafeBooleansStored: readBooleanAt(value, ["summary", "rowOwnerProvidedSafeBooleansStored"]),
    rowParsingPerformedByR1180: readBooleanAt(value, ["summary", "rowParsingPerformedByR1180"]),
    r1180SchemaCurrent: schemaCurrent,
    safeMinimumPairMatches: exactStringSet(
      readStringArrayAt(value, ["summary", "minimumFeaturePairRequired"]),
      MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS,
    ),
    safeResponseFieldsSatisfied: responseStatus === "ready" && missingRequiredResponseFieldIds.length === 0,
    sourcePriorityMatches: readStringAt(value, ["summary", "sourcePriority"]) === TARGET_INPUT_PRIORITY,
    targetAgeBandMatches: readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND,
  };
}

function r1180ReadyForContract(state: R1180State): boolean {
  return state.r1180SchemaCurrent
    && state.packetId === R1180_PACKET_ID
    && state.r1180Status === "research-local-aggregate-only"
    && state.artifactBoundaryAggregateOnly === true
    && !state.artifactBoundaryUnsafeTrueFlagFound
    && state.r1180Conclusion === "safe_confirmation_response_intake_ready_feature_only"
    && state.featureOnlySafeConfirmationReady === true
    && state.explicitRowOwnerSafeConfirmationProvided === true
    && state.invalidResponseReasonsEmpty
    && state.nextAction === "carry_safe_confirmation_to_feature_only_chain"
    && state.nextActionCommand === R1181_AVERAGE_SUBMITTER_FEATURE_ONLY_EXECUTION_CONTRACT_COMMAND
    && state.responseArtifactStatus === "available"
    && state.responseStatus === "ready"
    && state.responseKind === "explicit_yes_all_required_assertions_confirmed"
    && state.responseSchemaVersion === R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION
    && state.modelEvidencePromotionAllowed === false
    && state.productDisplayAuthorized === false
    && state.rowLevelDataAcceptedByR1180 === false
    && state.rowOwnerConfirmationInferredByR1180 === false
    && state.rowOwnerPrivateValuesStored === false
    && state.rowOwnerProvidedPrivateValuesStored === false
    && state.rowOwnerProvidedSafeBooleansStored === false
    && state.rowParsingPerformedByR1180 === false
    && state.safeMinimumPairMatches
    && state.safeResponseFieldsSatisfied
    && state.sourcePriorityMatches
    && state.targetAgeBandMatches;
}

function contractStateFor(
  state: R1180State,
  ready: boolean,
): { conclusion: ContractConclusion; nextAction: R1181NextActionId } {
  if (ready) {
    return {
      conclusion: "average_submitter_feature_only_execution_contract_ready_research_only",
      nextAction: "use_feature_only_execution_contract_for_research_planning_only",
    };
  }
  if (!state.r1180Available || !state.r1180SchemaCurrent || !state.safeMinimumPairMatches) {
    return {
      conclusion: "average_submitter_feature_only_execution_contract_waiting_on_r1180",
      nextAction: "refresh_r1180_safe_confirmation_response_intake",
    };
  }
  if (
    state.packetId !== R1180_PACKET_ID
    || state.r1180Status !== "research-local-aggregate-only"
    || state.artifactBoundaryAggregateOnly !== true
    || state.artifactBoundaryUnsafeTrueFlagFound
    || !state.sourcePriorityMatches
    || !state.targetAgeBandMatches
  ) {
    return {
      conclusion: "average_submitter_feature_only_execution_contract_waiting_on_r1180",
      nextAction: "refresh_r1180_safe_confirmation_response_intake",
    };
  }
  if (state.responseStatus === "invalid") {
    return {
      conclusion: "average_submitter_feature_only_execution_contract_rejected_r1180_response_shape",
      nextAction: "rerun_r1180_with_valid_safe_confirmation_response",
    };
  }
  return {
    conclusion: "average_submitter_feature_only_execution_contract_waiting_on_safe_confirmation",
    nextAction: "fill_r1180_safe_confirmation_response_template",
  };
}

function commandForNextAction(nextAction: R1181NextActionId): string | null {
  if (
    nextAction === "fill_r1180_safe_confirmation_response_template"
    || nextAction === "refresh_r1180_safe_confirmation_response_intake"
    || nextAction === "rerun_r1180_with_valid_safe_confirmation_response"
  ) {
    return R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_COMMAND;
  }
  return null;
}

function summarizeR1180(value: unknown | null): ArtifactSummary {
  return {
    artifact: R1180_ARTIFACT,
    packetId: readStringAt(value, ["packetId"]) === R1180_PACKET_ID ? R1180_PACKET_ID : null,
    schemaVersion: readStringAt(value, ["schemaVersion"])
      === R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_SCHEMA_VERSION
      ? R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_SCHEMA_VERSION
      : null,
    status: value === null ? "missing" : "available",
  };
}

function validateR1180ExpectedArtifactShape(value: unknown | null): void {
  if (value === null) return;
  const root = requirePlainRecordForR1180Shape(value);
  assertExactKeys(root, R1180_OUTPUT_KEYS);
  assertString(root.createdAt);
  assertString(root.packetId);
  assertBoolean(root.productDisplayAuthorized);
  assertString(root.schemaVersion);
  assertString(root.status);

  const artifactBoundary = requirePlainRecordForR1180Shape(root.artifactBoundary);
  assertExactKeys(artifactBoundary, R1180_ARTIFACT_BOUNDARY_KEYS);
  Object.values(artifactBoundary).forEach(assertBoolean);

  const inputArtifacts = requirePlainRecordForR1180Shape(root.inputArtifacts);
  assertExactKeys(inputArtifacts, R1180_INPUT_ARTIFACT_KEYS);
  const r1179ObjectiveGapAudit = requirePlainRecordForR1180Shape(inputArtifacts.r1179ObjectiveGapAudit);
  assertExactKeys(r1179ObjectiveGapAudit, R1180_ARTIFACT_SUMMARY_KEYS);
  assertString(r1179ObjectiveGapAudit.artifact);
  assertStringOrNull(r1179ObjectiveGapAudit.packetId);
  assertStringOrNull(r1179ObjectiveGapAudit.schemaVersion);
  assertString(r1179ObjectiveGapAudit.status);
  const safeConfirmationResponse = requirePlainRecordForR1180Shape(inputArtifacts.safeConfirmationResponse);
  assertExactKeys(safeConfirmationResponse, R1180_SAFE_CONFIRMATION_RESPONSE_SUMMARY_KEYS);
  assertStringOrNull(safeConfirmationResponse.schemaVersion);
  assertString(safeConfirmationResponse.status);

  const intake = requirePlainRecordForR1180Shape(root.safeConfirmationResponseIntake);
  assertExactKeys(intake, [...R1180_SHARED_INTAKE_KEYS, "responseTemplate"]);
  validateR1180SharedIntakeShape(intake);
  validateR1180ResponseTemplateShape(requirePlainRecordForR1180Shape(intake.responseTemplate));

  const summary = requirePlainRecordForR1180Shape(root.summary);
  assertExactKeys(summary, R1180_SHARED_INTAKE_KEYS);
  validateR1180SharedIntakeShape(summary);
  assertSharedIntakeMirrorsSummary(intake, summary);
}

function validateR1180SharedIntakeShape(section: Record<string, unknown>): void {
  assertExactStringArray(section.allowedValueKindIds, R1180_ALLOWED_VALUE_KIND_IDS);
  assertExactString(section.askId, ROW_OWNER_SAFE_CONFIRMATION_ASK_ID);
  assertExactStringArray(section.blockedContentIds, BLOCKED_CONTENT_IDS);
  assertStringInSet(section.conclusion, R1180_INTAKE_CONCLUSION_IDS);
  assertBoolean(section.explicitRowOwnerSafeConfirmationProvided);
  assertBoolean(section.featureOnlySafeConfirmationReady);
  assertStringArraySubset(section.invalidResponseReasonIds, R1180_INVALID_RESPONSE_REASON_IDS);
  assertExactStringArray(section.minimumFeaturePairRequired, MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS);
  assertStringArraySubset(section.missingRequiredResponseFieldIds, REQUIRED_R1180_SAFE_RESPONSE_FIELD_IDS);
  R1180_SAFE_FALSE_FLAG_KEYS.forEach((key) => assertFalse(section[key]));
  assertStringInSet(section.nextAction, R1180_NEXT_ACTION_IDS);
  assertStringOrNull(section.nextActionCommand);
  assertExactStringArray(section.prioritizedInputKindIds, PRIORITIZED_INPUT_KIND_IDS);
  assertExactStringArray(section.requiredAssertionChecklistIds, R1180_REQUIRED_ASSERTION_CHECKLIST_IDS);
  assertExactStringArray(section.requiredResponseFieldIds, REQUIRED_R1180_SAFE_RESPONSE_FIELD_IDS);
  assertStringInSetOrNull(section.responseKind, R1180_RESPONSE_KIND_IDS);
  assertStringInSet(section.responseStatus, R1180_RESPONSE_STATUS_IDS);
  assertExactStringArray(section.safeCompletionChecklistItemIds, R1180_SAFE_COMPLETION_CHECKLIST_ITEM_IDS);
  validateR1180SafeResponseTemplateGuidanceShape(
    requirePlainRecordForR1180Shape(section.safeResponseTemplateGuidance),
  );
  assertString(section.sourcePriority);
  assertString(section.targetAgeBand);
}

function validateR1180ResponseTemplateShape(template: Record<string, unknown>): void {
  assertExactKeys(template, R1180_SAFE_CONFIRMATION_RESPONSE_TEMPLATE_KEYS);
  assertExactString(template.askId, ROW_OWNER_SAFE_CONFIRMATION_ASK_ID);
  assertFalse(template.confirmDailyWearableActivityExportAvailable);
  assertFalse(template.confirmGlycemiaBloodworkExportAvailable);
  assertFalse(template.confirmNoPrivateValuesIncluded);
  assertFalse(template.confirmTargetAgeBandRoughly16To50);
  assertExactString(template.responseKind, "explicit_yes_all_required_assertions_confirmed");
  assertExactString(template.schemaVersion, R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION);
}

function validateR1180SafeResponseTemplateGuidanceShape(guidance: Record<string, unknown>): void {
  assertExactKeys(guidance, R1180_SAFE_RESPONSE_TEMPLATE_GUIDANCE_KEYS);
  assertExactStringArray(guidance.allowedValueKindIds, R1180_ALLOWED_VALUE_KIND_IDS);
  assertExactStringArray(guidance.blockedContentIds, BLOCKED_CONTENT_IDS);
  assertExactString(guidance.fillableResponseArtifact, R1183_FILLABLE_RESPONSE_FILE_NAME);
  assertExactString(
    guidance.materializeFillableResponseCommand,
    R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND,
  );
  assertFalse(guidance.modelEvidencePromotionAllowed);
  assertFalse(guidance.productDisplayAuthorized);
  assertExactString(guidance.responsePathEnvVar, R1180_SAFE_CONFIRMATION_RESPONSE_PATH_ENV_VAR);
  assertExactStringArray(guidance.responseTemplateKeyOrder, R1180_SAFE_CONFIRMATION_RESPONSE_TEMPLATE_KEYS);
  assertTrue(guidance.rowOwnerOnly);
  assertExactString(guidance.runIntakeWithFilledTemplateCommand, R1180_WITH_FILLABLE_RESPONSE_COMMAND);
  assertFalse(guidance.storesPrivateDetailsInPacket);
}

function assertSharedIntakeMirrorsSummary(
  intake: Record<string, unknown>,
  summary: Record<string, unknown>,
): void {
  for (const key of R1180_SHARED_INTAKE_KEYS) {
    if (JSON.stringify(intake[key]) !== JSON.stringify(summary[key])) {
      rejectUnexpectedR1180Shape();
    }
  }
}

function safeBoundary() {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    featureValuesStored: false,
    fileNamesStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelEvidencePromotedByR1181: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1181: false,
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
    rowLevelDataAcceptedByR1181: false,
    rowOwnerConfirmationInferredByR1181: false,
    rowOwnerPrivateValuesStored: false,
    rowParsingPerformedByR1181: false,
    rowValuesStored: false,
    safeBooleanValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  } as const;
}

function hasUnsafeTrueBoundaryFlag(value: unknown | null): boolean {
  const artifactBoundary = recordAt(value, "artifactBoundary");
  return Object.entries(artifactBoundary).some(([key, boundaryValue]) => key !== "aggregateOnly" && boundaryValue === true);
}

function recordAt(value: unknown, key: string): Record<string, unknown> {
  if (!isPlainRecord(value)) return {};
  const next = value[key];
  return isPlainRecord(next) ? next : {};
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    if (error instanceof SyntaxError) {
      throw new Error("R1181 input JSON parse failed.");
    }
    throw error;
  }
}

function validateAggregateSafe(label: string, value: unknown | null): void {
  if (value === null) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1181 rejected unsafe ${label}: ${findings.length} ${findings.length === 1 ? "finding" : "findings"}`);
  }
}

function ensureNoOutputPathInOutput(output: unknown, outputDir: string): void {
  if (outputDir.length > 0 && JSON.stringify(output).includes(outputDir)) {
    throw new Error("R1181 output included an output path.");
  }
}

function createdAtFor(createdAt: string | undefined): string {
  if (createdAt === undefined) return new Date().toISOString();
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new Error("R1181 rejected invalid createdAt timestamp.");
  }
  return createdAt;
}

function readR1180ResponseStatus(value: unknown | null): R1180ResponseStatus {
  const found = readStringAt(value, ["summary", "responseStatus"]);
  return found === "incomplete" || found === "invalid" || found === "missing" || found === "ready"
    ? found
    : null;
}

function readR1180ResponseArtifactStatus(value: unknown | null): "available" | "missing" | null {
  const found = readStringAt(value, ["inputArtifacts", "safeConfirmationResponse", "status"]);
  return found === "available" || found === "missing" ? found : null;
}

function requirePlainRecordForR1180Shape(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    rejectUnexpectedR1180Shape();
  }
  return value;
}

function assertExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): void {
  const expected = new Set(expectedKeys);
  const actualKeys = Object.keys(value);
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key) => !expected.has(key))) {
    rejectUnexpectedR1180Shape();
  }
}

function assertString(value: unknown): void {
  if (typeof value !== "string") {
    rejectUnexpectedR1180Shape();
  }
}

function assertExactString(value: unknown, expectedValue: string): void {
  if (value !== expectedValue) {
    rejectUnexpectedR1180Shape();
  }
}

function assertStringOrNull(value: unknown): void {
  if (value !== null && typeof value !== "string") {
    rejectUnexpectedR1180Shape();
  }
}

function assertBoolean(value: unknown): void {
  if (typeof value !== "boolean") {
    rejectUnexpectedR1180Shape();
  }
}

function assertFalse(value: unknown): void {
  if (value !== false) {
    rejectUnexpectedR1180Shape();
  }
}

function assertTrue(value: unknown): void {
  if (value !== true) {
    rejectUnexpectedR1180Shape();
  }
}

function assertExactStringArray(value: unknown, expectedValues: readonly string[]): void {
  if (!Array.isArray(value) || value.length !== expectedValues.length) {
    rejectUnexpectedR1180Shape();
  }
  if (value.some((item, index) => item !== expectedValues[index])) {
    rejectUnexpectedR1180Shape();
  }
}

function assertStringArraySubset(value: unknown, allowedValues: readonly string[]): void {
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === "string")) {
    rejectUnexpectedR1180Shape();
  }
  const allowed = new Set<string>(allowedValues);
  const actual = new Set(value);
  if (actual.size !== value.length || value.some((item) => !allowed.has(item))) {
    rejectUnexpectedR1180Shape();
  }
}

function assertStringInSet(value: unknown, allowedValues: readonly string[]): void {
  if (typeof value !== "string" || !allowedValues.includes(value)) {
    rejectUnexpectedR1180Shape();
  }
}

function assertStringInSetOrNull(value: unknown, allowedValues: readonly string[]): void {
  if (value !== null) {
    assertStringInSet(value, allowedValues);
  }
}

function rejectUnexpectedR1180Shape(): never {
  throw new Error(R1181_UNEXPECTED_R1180_SHAPE_ERROR);
}

function readValueAt(value: unknown, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!isPlainRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const found = readValueAt(value, pathParts);
  return typeof found === "string" ? found : null;
}

function readBooleanAt(value: unknown, pathParts: readonly string[]): boolean | null {
  const found = readValueAt(value, pathParts);
  return typeof found === "boolean" ? found : null;
}

function readStringArrayAt(value: unknown, pathParts: readonly string[]): string[] {
  const found = readValueAt(value, pathParts);
  return Array.isArray(found) && found.every((item): item is string => typeof item === "string")
    ? found
    : [];
}

function exactStringSet(actual: string[], expected: readonly string[]): boolean {
  return actual.length === expected.length
    && new Set(actual).size === actual.length
    && expected.every((item) => actual.includes(item));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function main(): Promise<void> {
  try {
    const { output } = await runR1181AverageSubmitterFeatureOnlyExecutionContract({
      createdAt: process.env.MURPH_AGE_R1181_CREATED_AT,
      outputDir: process.env.MURPH_AGE_R1181_OUTPUT_DIR,
      r1180Path: process.env.MURPH_AGE_R1180_SAFE_CONFIRMATION_RESPONSE_INTAKE_PATH,
    });
    process.stdout.write(`${JSON.stringify({
      conclusion: output.summary.conclusion,
      featureOnlyExecutionContractReady: output.summary.featureOnlyExecutionContractReady,
      nextAction: output.summary.nextAction,
      packetId: output.packetId,
      productDisplayAuthorized: output.summary.productDisplayAuthorized,
      researchPlanningAllowed: output.summary.researchPlanningAllowed,
      r1180ResponseStatus: output.r1180State.responseStatus,
      topSafeExecutionFeatureSlotId: output.summary.safeExecutionFeatureSlotIds[0] ?? null,
    })}\n`);
  } catch (error) {
    process.stderr.write(`${safeCliErrorMessage(error, "R1181 feature-only execution contract failed.")}\n`);
    process.exitCode = 1;
  }
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  if (
    error.message === "R1181 input JSON parse failed."
    || error.message === "R1181 output included an output path."
    || error.message === "R1181 rejected invalid createdAt timestamp."
    || error.message === R1181_UNEXPECTED_R1180_SHAPE_ERROR
    || /^R1181 rejected unsafe (?:r1180 safe confirmation response intake|r1181 feature-only execution contract): \d+ findings?$/u
      .test(error.message)
  ) {
    return error.message;
  }
  return fallback;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  void main();
}
