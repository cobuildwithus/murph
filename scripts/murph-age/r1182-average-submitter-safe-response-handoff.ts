import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_COMMAND,
  R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION,
} from "./r1180-average-submitter-safe-confirmation-response-intake.ts";
import {
  R1181_AVERAGE_SUBMITTER_FEATURE_ONLY_EXECUTION_CONTRACT_COMMAND,
  R1181_AVERAGE_SUBMITTER_FEATURE_ONLY_EXECUTION_CONTRACT_SCHEMA_VERSION,
} from "./r1181-average-submitter-feature-only-execution-contract.ts";

export const R1182_AVERAGE_SUBMITTER_SAFE_RESPONSE_HANDOFF_SCHEMA_VERSION =
  "murph-age-r1182-average-submitter-safe-response-handoff.v1" as const;
export const R1182_AVERAGE_SUBMITTER_SAFE_RESPONSE_HANDOFF_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1182-average-submitter-safe-response-handoff.ts" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1182-average-submitter-safe-response-handoff.latest.json" as const;
const R1181_ARTIFACT = "r1181-average-submitter-feature-only-execution-contract.latest.json" as const;
const R1181_PACKET_ID = "r1181-average-submitter-feature-only-execution-contract" as const;
const R1182_PACKET_ID = "r1182-average-submitter-safe-response-handoff" as const;
const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first" as const;
const TARGET_AGE_BAND = "roughly_16_50" as const;
const ROW_OWNER_SAFE_CONFIRMATION_ASK_ID =
  "confirm_feature_only_lab_wearable_availability_without_private_values" as const;
const MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
] as const;
const PRIORITIZED_INPUT_KIND_IDS = [
  "lab_portal_export_or_spreadsheet",
  "phone_watch_or_wearable_activity_export",
] as const;
const REQUIRED_RESPONSE_FIELD_IDS = [
  "confirm_target_age_band_roughly_16_50",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
] as const;
const REQUIRED_RESPONSE_TEMPLATE_KEYS = [
  "askId",
  "confirmDailyWearableActivityExportAvailable",
  "confirmGlycemiaBloodworkExportAvailable",
  "confirmNoPrivateValuesIncluded",
  "confirmTargetAgeBandRoughly16To50",
  "responseKind",
  "schemaVersion",
] as const;
const SAFE_COMPLETION_CHECKLIST_ITEM_IDS = [
  "confirm_target_age_band_without_identifiers",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
] as const;
const REQUIRED_ASSERTION_CHECKLIST_IDS = [
  "assert_target_age_band_roughly_16_50",
  "assert_glycemia_bloodwork_export_available",
  "assert_daily_wearable_activity_export_available",
  "assert_no_private_values_identifiers_paths_headers_or_rows",
] as const;
const ALLOWED_VALUE_KIND_IDS = [
  "booleans_only",
  "fixed_enumerated_ids_only",
] as const;
const RESPONSE_KIND_IDS = [
  "explicit_yes_all_required_assertions_confirmed",
  "not_confirmed_or_unsure",
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
const R1181_CONCLUSION_IDS = [
  "average_submitter_feature_only_execution_contract_ready_research_only",
  "average_submitter_feature_only_execution_contract_waiting_on_r1180",
  "average_submitter_feature_only_execution_contract_waiting_on_safe_confirmation",
  "average_submitter_feature_only_execution_contract_rejected_r1180_response_shape",
] as const;
const R1181_NEXT_ACTION_IDS = [
  "fill_r1180_safe_confirmation_response_template",
  "refresh_r1180_safe_confirmation_response_intake",
  "rerun_r1180_with_valid_safe_confirmation_response",
  "use_feature_only_execution_contract_for_research_planning_only",
  "none",
] as const;
const R1180_RESPONSE_STATUS_IDS = [
  "incomplete",
  "invalid",
  "missing",
  "ready",
] as const;
const SAFE_EXECUTION_FEATURE_SLOT_IDS = [
  "glycemia_lab_presence",
  "glycemia_measurement_date_presence",
  "daily_activity_presence",
  "daily_wear_coverage_presence",
] as const;
const R1182_NEXT_ACTION_IDS = [
  "fill_r1180_safe_confirmation_response_template",
  "refresh_r1181_feature_only_execution_contract",
  "rerun_r1180_with_valid_safe_confirmation_response",
  "use_r1181_feature_only_execution_contract_for_research_planning_only",
  "none",
] as const;

type ArrayValue<T extends readonly string[]> = T[number];
type MinimumFeaturePairSourceFamilyId = ArrayValue<typeof MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS>;
type PrioritizedInputKindId = ArrayValue<typeof PRIORITIZED_INPUT_KIND_IDS>;
type RequiredResponseFieldId = ArrayValue<typeof REQUIRED_RESPONSE_FIELD_IDS>;
type SafeCompletionChecklistItemId = ArrayValue<typeof SAFE_COMPLETION_CHECKLIST_ITEM_IDS>;
type RequiredAssertionChecklistId = ArrayValue<typeof REQUIRED_ASSERTION_CHECKLIST_IDS>;
type AllowedValueKindId = ArrayValue<typeof ALLOWED_VALUE_KIND_IDS>;
type ResponseKindId = ArrayValue<typeof RESPONSE_KIND_IDS>;
type BlockedContentId = ArrayValue<typeof BLOCKED_CONTENT_IDS>;
type R1181Conclusion = ArrayValue<typeof R1181_CONCLUSION_IDS>;
type R1181NextActionId = ArrayValue<typeof R1181_NEXT_ACTION_IDS>;
type R1180ResponseStatus = ArrayValue<typeof R1180_RESPONSE_STATUS_IDS>;
type SafeExecutionFeatureSlotId = ArrayValue<typeof SAFE_EXECUTION_FEATURE_SLOT_IDS>;
type R1182NextActionId = ArrayValue<typeof R1182_NEXT_ACTION_IDS>;

type HandoffConclusion =
  | "average_submitter_safe_response_handoff_ready_for_research_planning_only"
  | "average_submitter_safe_response_handoff_waiting_on_row_owner_confirmation"
  | "average_submitter_safe_response_handoff_waiting_on_r1181_refresh"
  | "average_submitter_safe_response_handoff_rejected_r1180_response_shape";

interface ArtifactSummary {
  artifact: string;
  packetId: typeof R1181_PACKET_ID | null;
  schemaVersion: typeof R1181_AVERAGE_SUBMITTER_FEATURE_ONLY_EXECUTION_CONTRACT_SCHEMA_VERSION | null;
  status: "available" | "missing";
}

interface SafeConfirmationResponseTemplate {
  askId: typeof ROW_OWNER_SAFE_CONFIRMATION_ASK_ID;
  confirmDailyWearableActivityExportAvailable: false;
  confirmGlycemiaBloodworkExportAvailable: false;
  confirmNoPrivateValuesIncluded: false;
  confirmTargetAgeBandRoughly16To50: false;
  responseKind: "explicit_yes_all_required_assertions_confirmed";
  schemaVersion: typeof R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION;
}

interface R1181State {
  artifactBoundaryAggregateOnly: boolean | null;
  artifactBoundaryUnsafeTrueFlagFound: boolean;
  contractNextAction: R1181NextActionId | null;
  contractConclusion: R1181Conclusion | null;
  explicitRowOwnerSafeConfirmationProvided: boolean | null;
  featureOnlyExecutionContractReady: boolean | null;
  featureOnlySafeConfirmationReady: boolean | null;
  inputArtifactAvailable: boolean;
  r1181ModelEvidencePromotionAllowed: boolean | null;
  packetId: typeof R1181_PACKET_ID | null;
  r1181ReviewGptRequiredNow: boolean | null;
  r1181ProductDisplayAuthorized: boolean | null;
  r1180ResponseStatus: R1180ResponseStatus | null;
  r1181Available: boolean;
  r1181SchemaCurrent: boolean;
  r1181Status: "research-local-aggregate-only" | null;
  researchPlanningAllowed: boolean | null;
  rowLevelDataAcceptedByR1181: boolean | null;
  rowOwnerConfirmationInferredByR1181: boolean | null;
  r1181RowOwnerPrivateValuesStored: boolean | null;
  rowParsingPerformedByR1181: boolean | null;
  safeExecutionFeatureSlotIds: SafeExecutionFeatureSlotId[] | null;
  sourcePriorityMatches: boolean;
  targetAgeBandMatches: boolean;
}

interface R1182AverageSubmitterSafeResponseHandoffOptions {
  createdAt?: string;
  outputDir?: string;
  r1181Path?: string;
}

export interface R1182AverageSubmitterSafeResponseHandoffOutput {
  artifactBoundary: ReturnType<typeof safeBoundary>;
  createdAt: string;
  inputArtifacts: {
    r1181FeatureOnlyExecutionContract: ArtifactSummary;
  };
  packetId: typeof R1182_PACKET_ID;
  productDisplayAuthorized: false;
  r1181State: R1181State;
  safeResponseHandoff: {
    allowedValueKindIds: AllowedValueKindId[];
    askId: typeof ROW_OWNER_SAFE_CONFIRMATION_ASK_ID;
    blockedContentIds: BlockedContentId[];
    minimumFeaturePairRequired: MinimumFeaturePairSourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    nextAction: R1182NextActionId;
    nextActionCommand: string | null;
    prioritizedInputKindIds: PrioritizedInputKindId[];
    productDisplayAuthorized: false;
    requiredAssertionChecklistIds: RequiredAssertionChecklistId[];
    requiredResponseFieldIds: RequiredResponseFieldId[];
    responseKindIds: ResponseKindId[];
    responseTemplate: SafeConfirmationResponseTemplate;
    responseTemplateKeyOrder: ArrayValue<typeof REQUIRED_RESPONSE_TEMPLATE_KEYS>[];
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1182: false;
    rowOwnerConfirmationInferredByR1182: false;
    rowOwnerPrivateValuesStored: false;
    rowParsingPerformedByR1182: false;
    safeCompletionChecklistItemIds: SafeCompletionChecklistItemId[];
    sourcePriority: typeof TARGET_INPUT_PRIORITY;
    targetAgeBand: typeof TARGET_AGE_BAND;
  };
  schemaVersion: typeof R1182_AVERAGE_SUBMITTER_SAFE_RESPONSE_HANDOFF_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: HandoffConclusion;
    explicitRowOwnerSafeConfirmationProvided: boolean | null;
    featureOnlyExecutionContractReady: boolean;
    handoffReadyForResearchPlanningOnly: boolean;
    minimumFeaturePairRequired: MinimumFeaturePairSourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    nextAction: R1182NextActionId;
    nextActionCommand: string | null;
    productDisplayAuthorized: false;
    requiredResponseFieldIds: RequiredResponseFieldId[];
    responseTemplateSchemaVersion: typeof R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION;
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1182: false;
    rowOwnerConfirmationInferredByR1182: false;
    rowOwnerPrivateValuesStored: false;
    rowParsingPerformedByR1182: false;
    safeExecutionFeatureSlotIds: SafeExecutionFeatureSlotId[] | null;
    sourcePriority: typeof TARGET_INPUT_PRIORITY;
    targetAgeBand: typeof TARGET_AGE_BAND;
  };
}

export async function runR1182AverageSubmitterSafeResponseHandoff(
  options: R1182AverageSubmitterSafeResponseHandoffOptions = {},
): Promise<{ output: R1182AverageSubmitterSafeResponseHandoffOutput; outputPath: string }> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const r1181 = await readJsonIfPresent(options.r1181Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1181_ARTIFACT));
  validateAggregateSafe("r1181 feature-only execution contract", r1181);

  const r1181State = stateFromR1181(r1181);
  if (r1181State.artifactBoundaryUnsafeTrueFlagFound) {
    throw new Error("R1182 rejected unsafe r1181 feature-only execution contract: 1 finding");
  }

  const handoffState = handoffStateFor(r1181State);
  const handoffReadyForResearchPlanningOnly =
    handoffState.conclusion === "average_submitter_safe_response_handoff_ready_for_research_planning_only";
  const featureOnlyExecutionContractReady = handoffReadyForResearchPlanningOnly;
  const nextActionCommand = commandForNextAction(handoffState.nextAction);
  const output: R1182AverageSubmitterSafeResponseHandoffOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: createdAtFor(options.createdAt),
    inputArtifacts: {
      r1181FeatureOnlyExecutionContract: summarizeR1181(r1181),
    },
    packetId: R1182_PACKET_ID,
    productDisplayAuthorized: false,
    r1181State,
    safeResponseHandoff: {
      allowedValueKindIds: [...ALLOWED_VALUE_KIND_IDS],
      askId: ROW_OWNER_SAFE_CONFIRMATION_ASK_ID,
      blockedContentIds: [...BLOCKED_CONTENT_IDS],
      minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      nextAction: handoffState.nextAction,
      nextActionCommand,
      prioritizedInputKindIds: [...PRIORITIZED_INPUT_KIND_IDS],
      productDisplayAuthorized: false,
      requiredAssertionChecklistIds: [...REQUIRED_ASSERTION_CHECKLIST_IDS],
      requiredResponseFieldIds: [...REQUIRED_RESPONSE_FIELD_IDS],
      responseKindIds: [...RESPONSE_KIND_IDS],
      responseTemplate: responseTemplate(),
      responseTemplateKeyOrder: [...REQUIRED_RESPONSE_TEMPLATE_KEYS],
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1182: false,
      rowOwnerConfirmationInferredByR1182: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1182: false,
      safeCompletionChecklistItemIds: [...SAFE_COMPLETION_CHECKLIST_ITEM_IDS],
      sourcePriority: TARGET_INPUT_PRIORITY,
      targetAgeBand: TARGET_AGE_BAND,
    },
    schemaVersion: R1182_AVERAGE_SUBMITTER_SAFE_RESPONSE_HANDOFF_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: handoffState.conclusion,
      explicitRowOwnerSafeConfirmationProvided: r1181State.explicitRowOwnerSafeConfirmationProvided,
      featureOnlyExecutionContractReady,
      handoffReadyForResearchPlanningOnly,
      minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      nextAction: handoffState.nextAction,
      nextActionCommand,
      productDisplayAuthorized: false,
      requiredResponseFieldIds: [...REQUIRED_RESPONSE_FIELD_IDS],
      responseTemplateSchemaVersion: R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1182: false,
      rowOwnerConfirmationInferredByR1182: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1182: false,
      safeExecutionFeatureSlotIds: handoffReadyForResearchPlanningOnly
        ? r1181State.safeExecutionFeatureSlotIds
        : null,
      sourcePriority: TARGET_INPUT_PRIORITY,
      targetAgeBand: TARGET_AGE_BAND,
    },
  };

  ensureNoOutputPathInOutput(output, outputDir);
  validateAggregateSafe("r1182 safe response handoff", output);
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function stateFromR1181(value: unknown | null): R1181State {
  const schemaCurrent = readStringAt(value, ["schemaVersion"])
    === R1181_AVERAGE_SUBMITTER_FEATURE_ONLY_EXECUTION_CONTRACT_SCHEMA_VERSION;
  const contractConclusion = readStringAt(value, ["summary", "conclusion"]);
  const contractNextAction = readStringAt(value, ["summary", "nextAction"]);
  return {
    artifactBoundaryAggregateOnly: readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]),
    artifactBoundaryUnsafeTrueFlagFound: hasUnsafeTrueBoundaryFlag(value),
    contractConclusion: stringSetIncludes(R1181_CONCLUSION_IDS, contractConclusion)
      ? contractConclusion
      : null,
    contractNextAction: stringSetIncludes(R1181_NEXT_ACTION_IDS, contractNextAction)
      ? contractNextAction
      : null,
    explicitRowOwnerSafeConfirmationProvided: readBooleanAt(
      value,
      ["summary", "explicitRowOwnerSafeConfirmationProvided"],
    ),
    featureOnlyExecutionContractReady: readBooleanAt(value, ["summary", "featureOnlyExecutionContractReady"]),
    featureOnlySafeConfirmationReady: readBooleanAt(value, ["summary", "featureOnlySafeConfirmationReady"]),
    inputArtifactAvailable: value !== null,
    packetId: readStringAt(value, ["packetId"]) === R1181_PACKET_ID ? R1181_PACKET_ID : null,
    r1181ModelEvidencePromotionAllowed: readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]),
    r1181ProductDisplayAuthorized: readBooleanAt(value, ["summary", "productDisplayAuthorized"]),
    r1180ResponseStatus: readStringInSetAt(value, ["r1180State", "responseStatus"], R1180_RESPONSE_STATUS_IDS),
    r1181Available: value !== null,
    r1181SchemaCurrent: schemaCurrent,
    r1181Status: readStringAt(value, ["status"]) === "research-local-aggregate-only"
      ? "research-local-aggregate-only"
      : null,
    researchPlanningAllowed: readBooleanAt(value, ["summary", "researchPlanningAllowed"]),
    r1181ReviewGptRequiredNow: readBooleanAt(value, ["summary", "reviewGptRequiredNow"]),
    rowLevelDataAcceptedByR1181: readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1181"]),
    rowOwnerConfirmationInferredByR1181: readBooleanAt(
      value,
      ["summary", "rowOwnerConfirmationInferredByR1181"],
    ),
    r1181RowOwnerPrivateValuesStored: readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]),
    rowParsingPerformedByR1181: readBooleanAt(value, ["summary", "rowParsingPerformedByR1181"]),
    safeExecutionFeatureSlotIds: readStringArrayInSetAt(
      value,
      ["summary", "safeExecutionFeatureSlotIds"],
      SAFE_EXECUTION_FEATURE_SLOT_IDS,
    ),
    sourcePriorityMatches: readStringAt(value, ["summary", "sourcePriority"]) === TARGET_INPUT_PRIORITY,
    targetAgeBandMatches: readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND,
  };
}

function handoffStateFor(state: R1181State): { conclusion: HandoffConclusion; nextAction: R1182NextActionId } {
  if (!r1181IdentityCurrent(state)) {
    return {
      conclusion: "average_submitter_safe_response_handoff_waiting_on_r1181_refresh",
      nextAction: "refresh_r1181_feature_only_execution_contract",
    };
  }
  if (state.contractConclusion === "average_submitter_feature_only_execution_contract_rejected_r1180_response_shape") {
    return {
      conclusion: "average_submitter_safe_response_handoff_rejected_r1180_response_shape",
      nextAction: "rerun_r1180_with_valid_safe_confirmation_response",
    };
  }
  if (r1181ReadyForResearchPlanning(state)) {
    return {
      conclusion: "average_submitter_safe_response_handoff_ready_for_research_planning_only",
      nextAction: "use_r1181_feature_only_execution_contract_for_research_planning_only",
    };
  }
  if (state.contractConclusion === "average_submitter_feature_only_execution_contract_waiting_on_safe_confirmation") {
    return {
      conclusion: "average_submitter_safe_response_handoff_waiting_on_row_owner_confirmation",
      nextAction: "fill_r1180_safe_confirmation_response_template",
    };
  }
  return {
    conclusion: "average_submitter_safe_response_handoff_waiting_on_r1181_refresh",
    nextAction: "refresh_r1181_feature_only_execution_contract",
  };
}

function r1181IdentityCurrent(state: R1181State): boolean {
  return state.r1181Available
    && state.r1181SchemaCurrent
    && state.packetId === R1181_PACKET_ID
    && state.r1181Status === "research-local-aggregate-only"
    && state.artifactBoundaryAggregateOnly === true
    && !state.artifactBoundaryUnsafeTrueFlagFound
    && state.r1181ModelEvidencePromotionAllowed === false
    && state.r1181ProductDisplayAuthorized === false
    && state.r1180ResponseStatus !== null
    && state.r1181ReviewGptRequiredNow === false
    && state.rowLevelDataAcceptedByR1181 === false
    && state.rowOwnerConfirmationInferredByR1181 === false
    && state.r1181RowOwnerPrivateValuesStored === false
    && state.rowParsingPerformedByR1181 === false
    && exactStringSet(state.safeExecutionFeatureSlotIds, SAFE_EXECUTION_FEATURE_SLOT_IDS)
    && state.sourcePriorityMatches
    && state.targetAgeBandMatches;
}

function r1181ReadyForResearchPlanning(state: R1181State): boolean {
  return r1181IdentityCurrent(state)
    && state.contractConclusion === "average_submitter_feature_only_execution_contract_ready_research_only"
    && state.contractNextAction === "use_feature_only_execution_contract_for_research_planning_only"
    && state.explicitRowOwnerSafeConfirmationProvided === true
    && state.featureOnlyExecutionContractReady === true
    && state.featureOnlySafeConfirmationReady === true
    && state.r1180ResponseStatus === "ready"
    && state.researchPlanningAllowed === true
    && state.safeExecutionFeatureSlotIds !== null
    && state.safeExecutionFeatureSlotIds.length > 0;
}

function commandForNextAction(nextAction: R1182NextActionId): string | null {
  if (
    nextAction === "fill_r1180_safe_confirmation_response_template"
    || nextAction === "rerun_r1180_with_valid_safe_confirmation_response"
  ) {
    return R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_COMMAND;
  }
  if (nextAction === "refresh_r1181_feature_only_execution_contract") {
    return R1181_AVERAGE_SUBMITTER_FEATURE_ONLY_EXECUTION_CONTRACT_COMMAND;
  }
  return null;
}

function responseTemplate(): SafeConfirmationResponseTemplate {
  return {
    askId: ROW_OWNER_SAFE_CONFIRMATION_ASK_ID,
    confirmDailyWearableActivityExportAvailable: false,
    confirmGlycemiaBloodworkExportAvailable: false,
    confirmNoPrivateValuesIncluded: false,
    confirmTargetAgeBandRoughly16To50: false,
    responseKind: "explicit_yes_all_required_assertions_confirmed",
    schemaVersion: R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION,
  };
}

function summarizeR1181(value: unknown | null): ArtifactSummary {
  return {
    artifact: R1181_ARTIFACT,
    packetId: readStringAt(value, ["packetId"]) === R1181_PACKET_ID ? R1181_PACKET_ID : null,
    schemaVersion: readStringAt(value, ["schemaVersion"])
      === R1181_AVERAGE_SUBMITTER_FEATURE_ONLY_EXECUTION_CONTRACT_SCHEMA_VERSION
      ? R1181_AVERAGE_SUBMITTER_FEATURE_ONLY_EXECUTION_CONTRACT_SCHEMA_VERSION
      : null,
    status: value === null ? "missing" : "available",
  };
}

function safeBoundary() {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    fileNamesStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelEvidencePromotedByR1182: false,
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
    rowLevelDataAcceptedByR1182: false,
    rowOwnerConfirmationInferredByR1182: false,
    rowOwnerPrivateValuesStored: false,
    rowOwnerProvidedPrivateValuesStored: false,
    rowOwnerProvidedSafeBooleansStored: false,
    rowParsingPerformedByR1182: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceTableNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    const text = await readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return null;
    }
    if (error instanceof SyntaxError) {
      throw new Error("R1182 input JSON parse failed.");
    }
    throw error;
  }
}

function validateAggregateSafe(label: string, value: unknown): void {
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(
      `R1182 rejected unsafe ${label}: ${findings.length} ${findings.length === 1 ? "finding" : "findings"}`,
    );
  }
}

function ensureNoOutputPathInOutput(value: unknown, outputDir: string): void {
  const serialized = JSON.stringify(value);
  if (serialized.includes(outputDir) || serialized.includes(OUTPUT_FILE_NAME)) {
    throw new Error("R1182 output included an output path.");
  }
}

function createdAtFor(value: string | undefined): string {
  const createdAt = value ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new Error("R1182 rejected invalid createdAt timestamp.");
  }
  return createdAt;
}

function hasUnsafeTrueBoundaryFlag(value: unknown): boolean {
  const boundary = readRecordAt(value, ["artifactBoundary"]);
  if (boundary === null) return false;
  return Object.entries(boundary).some(([key, child]) => key !== "aggregateOnly" && child === true);
}

function readRecordAt(value: unknown, pathParts: string[]): Record<string, unknown> | null {
  const found = readAt(value, pathParts);
  return isPlainRecord(found) ? found : null;
}

function readStringAt(value: unknown, pathParts: string[]): string | null {
  const found = readAt(value, pathParts);
  return typeof found === "string" ? found : null;
}

function readBooleanAt(value: unknown, pathParts: string[]): boolean | null {
  const found = readAt(value, pathParts);
  return typeof found === "boolean" ? found : null;
}

function readStringArrayAt(value: unknown, pathParts: string[]): string[] | null {
  const found = readAt(value, pathParts);
  return Array.isArray(found) && found.every((item) => typeof item === "string") ? [...found] : null;
}

function readStringInSetAt<T extends readonly string[]>(
  value: unknown,
  pathParts: string[],
  values: T,
): T[number] | null {
  const found = readStringAt(value, pathParts);
  return stringSetIncludes(values, found) ? found : null;
}

function readStringArrayInSetAt<T extends readonly string[]>(
  value: unknown,
  pathParts: string[],
  values: T,
): T[number][] | null {
  const found = readStringArrayAt(value, pathParts);
  if (found === null) return null;
  const safeValues: T[number][] = [];
  for (const item of found) {
    if (!stringSetIncludes(values, item)) return null;
    safeValues.push(item);
  }
  return safeValues;
}

function exactStringSet(values: readonly string[] | null, expected: readonly string[]): boolean {
  return values !== null
    && values.length === expected.length
    && values.every((value) => expected.includes(value))
    && expected.every((value) => values.includes(value));
}

function readAt(value: unknown, pathParts: string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!isPlainRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringSetIncludes<T extends readonly string[]>(values: T, value: string | null): value is T[number] {
  return value !== null && values.some((candidate) => candidate === value);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return isPlainRecord(error) && error.code === code;
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  if (isExpectedSafeError(error)) return error.message;
  return fallback;
}

function isExpectedSafeError(error: Error): boolean {
  return error.message === "R1182 input JSON parse failed."
    || error.message === "R1182 output included an output path."
    || error.message === "R1182 rejected invalid createdAt timestamp."
    || /^R1182 rejected unsafe (?:r1181 feature-only execution contract|r1182 safe response handoff): \d+ findings?$/u
      .test(error.message);
}

async function main(): Promise<void> {
  try {
    const { output } = await runR1182AverageSubmitterSafeResponseHandoff({
      createdAt: process.env.MURPH_AGE_R1182_CREATED_AT,
      outputDir: process.env.MURPH_AGE_R1182_OUTPUT_DIR,
      r1181Path: process.env.MURPH_AGE_R1181_FEATURE_ONLY_EXECUTION_CONTRACT_PATH,
    });
    process.stdout.write(`${JSON.stringify({
      conclusion: output.summary.conclusion,
      nextAction: output.summary.nextAction,
      nextActionCommand: output.summary.nextActionCommand,
      packetId: output.packetId,
      r1181Conclusion: output.r1181State.contractConclusion,
      r1181ResponseStatus: output.r1181State.r1180ResponseStatus,
      schemaVersion: output.schemaVersion,
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${safeCliErrorMessage(error, "R1182 safe response handoff failed.")}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
