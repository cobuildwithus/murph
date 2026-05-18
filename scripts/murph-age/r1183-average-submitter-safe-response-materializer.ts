import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION,
} from "./r1180-average-submitter-safe-confirmation-response-intake.ts";
import {
  R1182_AVERAGE_SUBMITTER_SAFE_RESPONSE_HANDOFF_SCHEMA_VERSION,
} from "./r1182-average-submitter-safe-response-handoff.ts";

export const R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_SCHEMA_VERSION =
  "murph-age-r1183-average-submitter-safe-response-materializer.v1" as const;
export const R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1183-average-submitter-safe-response-materializer.ts" as const;
export const R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_EXPLICIT_CONFIRMATION_COMMAND =
  "MURPH_AGE_R1183_ROW_OWNER_SAFE_RESPONSE_ASSERTIONS_CONFIRMED=true pnpm exec tsx scripts/murph-age/r1183-average-submitter-safe-response-materializer.ts" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1183-average-submitter-safe-response-materializer.latest.json" as const;
const FILLABLE_RESPONSE_FILE_NAME = "r1183-fillable-average-submitter-safe-confirmation-response.json" as const;
const CONFIRMED_RESPONSE_FILE_NAME = "r1183-confirmed-average-submitter-safe-confirmation-response.json" as const;
const R1182_ARTIFACT = "r1182-average-submitter-safe-response-handoff.latest.json" as const;
const R1182_PACKET_ID = "r1182-average-submitter-safe-response-handoff" as const;
const R1183_PACKET_ID = "r1183-average-submitter-safe-response-materializer" as const;
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
const REQUIRED_ASSERTION_CHECKLIST_IDS = [
  "assert_target_age_band_roughly_16_50",
  "assert_glycemia_bloodwork_export_available",
  "assert_daily_wearable_activity_export_available",
  "assert_no_private_values_identifiers_paths_headers_or_rows",
] as const;
const SAFE_COMPLETION_CHECKLIST_ITEM_IDS = [
  "confirm_target_age_band_without_identifiers",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
] as const;
const ALLOWED_VALUE_KIND_IDS = [
  "booleans_only",
  "fixed_enumerated_ids_only",
] as const;
const RESPONSE_TEMPLATE_KEY_ORDER = [
  "askId",
  "confirmDailyWearableActivityExportAvailable",
  "confirmGlycemiaBloodworkExportAvailable",
  "confirmNoPrivateValuesIncluded",
  "confirmTargetAgeBandRoughly16To50",
  "responseKind",
  "schemaVersion",
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
const R1182_CONCLUSION_IDS = [
  "average_submitter_safe_response_handoff_ready_for_research_planning_only",
  "average_submitter_safe_response_handoff_waiting_on_row_owner_confirmation",
  "average_submitter_safe_response_handoff_waiting_on_r1181_refresh",
  "average_submitter_safe_response_handoff_rejected_r1180_response_shape",
] as const;
const R1182_NEXT_ACTION_IDS = [
  "fill_r1180_safe_confirmation_response_template",
  "refresh_r1181_feature_only_execution_contract",
  "rerun_r1180_with_valid_safe_confirmation_response",
  "use_r1181_feature_only_execution_contract_for_research_planning_only",
  "none",
] as const;
const R1183_NEXT_ACTION_IDS = [
  "refresh_r1182_safe_response_handoff",
  "rerun_r1183_with_row_owner_safe_response_assertion",
  "run_r1180_with_confirmed_average_submitter_safe_response",
] as const;

type ArrayValue<T extends readonly string[]> = T[number];
type MinimumFeaturePairSourceFamilyId = ArrayValue<typeof MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS>;
type PrioritizedInputKindId = ArrayValue<typeof PRIORITIZED_INPUT_KIND_IDS>;
type RequiredResponseFieldId = ArrayValue<typeof REQUIRED_RESPONSE_FIELD_IDS>;
type RequiredAssertionChecklistId = ArrayValue<typeof REQUIRED_ASSERTION_CHECKLIST_IDS>;
type SafeCompletionChecklistItemId = ArrayValue<typeof SAFE_COMPLETION_CHECKLIST_ITEM_IDS>;
type AllowedValueKindId = ArrayValue<typeof ALLOWED_VALUE_KIND_IDS>;
type BlockedContentId = ArrayValue<typeof BLOCKED_CONTENT_IDS>;
type R1182Conclusion = ArrayValue<typeof R1182_CONCLUSION_IDS>;
type R1182NextActionId = ArrayValue<typeof R1182_NEXT_ACTION_IDS>;
type R1183NextActionId = ArrayValue<typeof R1183_NEXT_ACTION_IDS>;

type MaterializerConclusion =
  | "average_submitter_safe_response_materializer_confirmed_response_written"
  | "average_submitter_safe_response_materializer_ready_for_explicit_confirmation"
  | "average_submitter_safe_response_materializer_waiting_on_r1182_handoff";

interface ArtifactSummary {
  artifact: typeof R1182_ARTIFACT;
  packetId: typeof R1182_PACKET_ID | null;
  schemaVersion: typeof R1182_AVERAGE_SUBMITTER_SAFE_RESPONSE_HANDOFF_SCHEMA_VERSION | null;
  status: "available" | "missing";
}

interface SafeConfirmationResponse {
  askId: typeof ROW_OWNER_SAFE_CONFIRMATION_ASK_ID;
  confirmDailyWearableActivityExportAvailable: boolean;
  confirmGlycemiaBloodworkExportAvailable: boolean;
  confirmNoPrivateValuesIncluded: boolean;
  confirmTargetAgeBandRoughly16To50: boolean;
  responseKind: "explicit_yes_all_required_assertions_confirmed";
  schemaVersion: typeof R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION;
}

interface R1182State {
  allowedValueKindsMatch: boolean;
  artifactBoundaryAggregateOnly: boolean | null;
  artifactBoundaryUnsafeTrueFlagFound: boolean;
  blockedContentMatches: boolean;
  explicitRowOwnerSafeConfirmationProvided: boolean | null;
  featureOnlyExecutionContractReady: boolean | null;
  handoffConclusion: R1182Conclusion | null;
  handoffNextAction: R1182NextActionId | null;
  handoffReadyForResearchPlanningOnly: boolean | null;
  inputArtifactAvailable: boolean;
  minimumPairMatches: boolean;
  r1182ModelEvidencePromotionAllowed: boolean | null;
  packetId: typeof R1182_PACKET_ID | null;
  prioritizedInputKindsMatch: boolean;
  r1182ProductDisplayAuthorized: boolean | null;
  requiredAssertionChecklistMatches: boolean;
  requiredResponseFieldsMatch: boolean;
  responseTemplateInitialValuesFalse: boolean;
  responseTemplateKeyOrderMatches: boolean;
  responseTemplateSchemaVersion: typeof R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION | null;
  reviewGptRequiredNow: boolean | null;
  rowLevelDataAcceptedByR1182: boolean | null;
  rowOwnerConfirmationInferredByR1182: boolean | null;
  rowOwnerPrivateValuesStored: boolean | null;
  rowParsingPerformedByR1182: boolean | null;
  r1182Available: boolean;
  r1182SchemaCurrent: boolean;
  r1182Status: "research-local-aggregate-only" | null;
  safeCompletionChecklistMatches: boolean;
  sourcePriorityMatches: boolean;
  targetAgeBandMatches: boolean;
}

export interface R1183AverageSubmitterSafeResponseMaterializerOptions {
  createdAt?: string;
  outputDir?: string;
  r1182Path?: string;
  rowOwnerSafeResponseAssertionsConfirmed?: boolean;
}

export interface R1183AverageSubmitterSafeResponseMaterializerOutput {
  artifactBoundary: ReturnType<typeof safeBoundary>;
  createdAt: string;
  inputArtifacts: {
    r1182SafeResponseHandoff: ArtifactSummary;
  };
  materializer: {
    allowedValueKindIds: AllowedValueKindId[];
    blockedContentIds: BlockedContentId[];
    confirmedResponseArtifact: typeof CONFIRMED_RESPONSE_FILE_NAME | null;
    confirmedResponseArtifactWritten: boolean;
    explicitConfirmationCommand: typeof R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_EXPLICIT_CONFIRMATION_COMMAND;
    fillableResponseArtifact: typeof FILLABLE_RESPONSE_FILE_NAME | null;
    fillableResponseArtifactWritten: boolean;
    materializerCommand: typeof R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND;
    minimumFeaturePairRequired: MinimumFeaturePairSourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    nextAction: R1183NextActionId;
    prioritizedInputKindIds: PrioritizedInputKindId[];
    productDisplayAuthorized: false;
    requiredAssertionChecklistIds: RequiredAssertionChecklistId[];
    requiredResponseFieldIds: RequiredResponseFieldId[];
    responseSchemaVersion: typeof R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION;
    responseTemplateKeyOrder: ArrayValue<typeof RESPONSE_TEMPLATE_KEY_ORDER>[];
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1183: false;
    rowOwnerConfirmationInferredByR1183: false;
    rowOwnerPrivateValuesStored: false;
    rowOwnerSafeResponseAssertionProvided: boolean;
    rowOwnerSafeResponseAssertionStillRequired: boolean;
    rowOwnerSafeResponseValuesStoredInR1183Packet: false;
    rowParsingPerformedByR1183: false;
    safeCompletionChecklistItemIds: SafeCompletionChecklistItemId[];
    sourcePriority: typeof TARGET_INPUT_PRIORITY;
    targetAgeBand: typeof TARGET_AGE_BAND;
  };
  packetId: typeof R1183_PACKET_ID;
  productDisplayAuthorized: false;
  r1182State: R1182State;
  schemaVersion: typeof R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    confirmedResponseArtifact: typeof CONFIRMED_RESPONSE_FILE_NAME | null;
    confirmedResponseArtifactWritten: boolean;
    conclusion: MaterializerConclusion;
    explicitRowOwnerSafeResponseAssertionProvided: boolean;
    fillableResponseArtifact: typeof FILLABLE_RESPONSE_FILE_NAME | null;
    fillableResponseArtifactWritten: boolean;
    materializerReadyForRowOwnerConfirmation: boolean;
    minimumFeaturePairRequired: MinimumFeaturePairSourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    nextAction: R1183NextActionId;
    productDisplayAuthorized: false;
    requiredResponseFieldIds: RequiredResponseFieldId[];
    responseSchemaVersion: typeof R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION;
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1183: false;
    rowOwnerConfirmationInferredByR1183: false;
    rowOwnerPrivateValuesStored: false;
    rowOwnerSafeResponseAssertionStillRequired: boolean;
    rowOwnerSafeResponseValuesStoredInR1183Packet: false;
    rowParsingPerformedByR1183: false;
    sourcePriority: typeof TARGET_INPUT_PRIORITY;
    targetAgeBand: typeof TARGET_AGE_BAND;
  };
}

export async function runR1183AverageSubmitterSafeResponseMaterializer(
  options: R1183AverageSubmitterSafeResponseMaterializerOptions = {},
): Promise<{
  confirmedResponsePath: string | null;
  fillableResponsePath: string | null;
  output: R1183AverageSubmitterSafeResponseMaterializerOutput;
  outputPath: string;
}> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const r1182 = await readJsonIfPresent(options.r1182Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1182_ARTIFACT));
  validateAggregateSafe("r1182 safe response handoff", r1182);

  const r1182State = stateFromR1182(r1182);
  if (r1182State.artifactBoundaryUnsafeTrueFlagFound) {
    throw new Error("R1183 rejected unsafe r1182 safe response handoff: 1 finding");
  }

  const materializerReadyForRowOwnerConfirmation = r1182ReadyForRowOwnerConfirmation(r1182State);
  const explicitRowOwnerSafeResponseAssertionProvided =
    options.rowOwnerSafeResponseAssertionsConfirmed === true;
  const fillableResponseArtifactWritten = materializerReadyForRowOwnerConfirmation;
  const confirmedResponseArtifactWritten =
    materializerReadyForRowOwnerConfirmation && explicitRowOwnerSafeResponseAssertionProvided;
  const conclusion = conclusionFor({
    confirmedResponseArtifactWritten,
    materializerReadyForRowOwnerConfirmation,
  });
  const nextAction = nextActionFor(conclusion);
  const fillableResponsePath = fillableResponseArtifactWritten
    ? path.join(outputDir, FILLABLE_RESPONSE_FILE_NAME)
    : null;
  const confirmedResponsePath = confirmedResponseArtifactWritten
    ? path.join(outputDir, CONFIRMED_RESPONSE_FILE_NAME)
    : null;

  const output: R1183AverageSubmitterSafeResponseMaterializerOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: createdAtFor(options.createdAt),
    inputArtifacts: {
      r1182SafeResponseHandoff: summarizeR1182(r1182),
    },
    materializer: {
      allowedValueKindIds: [...ALLOWED_VALUE_KIND_IDS],
      blockedContentIds: [...BLOCKED_CONTENT_IDS],
      confirmedResponseArtifact: confirmedResponseArtifactWritten ? CONFIRMED_RESPONSE_FILE_NAME : null,
      confirmedResponseArtifactWritten,
      explicitConfirmationCommand: R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_EXPLICIT_CONFIRMATION_COMMAND,
      fillableResponseArtifact: fillableResponseArtifactWritten ? FILLABLE_RESPONSE_FILE_NAME : null,
      fillableResponseArtifactWritten,
      materializerCommand: R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND,
      minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      nextAction,
      prioritizedInputKindIds: [...PRIORITIZED_INPUT_KIND_IDS],
      productDisplayAuthorized: false,
      requiredAssertionChecklistIds: [...REQUIRED_ASSERTION_CHECKLIST_IDS],
      requiredResponseFieldIds: [...REQUIRED_RESPONSE_FIELD_IDS],
      responseSchemaVersion: R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION,
      responseTemplateKeyOrder: [...RESPONSE_TEMPLATE_KEY_ORDER],
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1183: false,
      rowOwnerConfirmationInferredByR1183: false,
      rowOwnerPrivateValuesStored: false,
      rowOwnerSafeResponseAssertionProvided: explicitRowOwnerSafeResponseAssertionProvided,
      rowOwnerSafeResponseAssertionStillRequired: !confirmedResponseArtifactWritten,
      rowOwnerSafeResponseValuesStoredInR1183Packet: false,
      rowParsingPerformedByR1183: false,
      safeCompletionChecklistItemIds: [...SAFE_COMPLETION_CHECKLIST_ITEM_IDS],
      sourcePriority: TARGET_INPUT_PRIORITY,
      targetAgeBand: TARGET_AGE_BAND,
    },
    packetId: R1183_PACKET_ID,
    productDisplayAuthorized: false,
    r1182State,
    schemaVersion: R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      confirmedResponseArtifact: confirmedResponseArtifactWritten ? CONFIRMED_RESPONSE_FILE_NAME : null,
      confirmedResponseArtifactWritten,
      conclusion,
      explicitRowOwnerSafeResponseAssertionProvided,
      fillableResponseArtifact: fillableResponseArtifactWritten ? FILLABLE_RESPONSE_FILE_NAME : null,
      fillableResponseArtifactWritten,
      materializerReadyForRowOwnerConfirmation,
      minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      nextAction,
      productDisplayAuthorized: false,
      requiredResponseFieldIds: [...REQUIRED_RESPONSE_FIELD_IDS],
      responseSchemaVersion: R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1183: false,
      rowOwnerConfirmationInferredByR1183: false,
      rowOwnerPrivateValuesStored: false,
      rowOwnerSafeResponseAssertionStillRequired: !confirmedResponseArtifactWritten,
      rowOwnerSafeResponseValuesStoredInR1183Packet: false,
      rowParsingPerformedByR1183: false,
      sourcePriority: TARGET_INPUT_PRIORITY,
      targetAgeBand: TARGET_AGE_BAND,
    },
  };

  ensureNoOutputPathInOutput(output, outputDir);
  validateAggregateSafe("r1183 safe response materializer", output);
  await mkdir(outputDir, { recursive: true });
  await removeStaleResponseArtifacts({
    confirmedResponseArtifactWritten,
    fillableResponseArtifactWritten,
    outputDir,
  });
  if (fillableResponsePath !== null) {
    const response = safeConfirmationResponse(false);
    validateAggregateSafe("r1183 fillable safe response", response);
    await writeFile(fillableResponsePath, `${JSON.stringify(response, null, 2)}\n`);
  }
  if (confirmedResponsePath !== null) {
    const response = safeConfirmationResponse(true);
    validateAggregateSafe("r1183 confirmed safe response", response);
    await writeFile(confirmedResponsePath, `${JSON.stringify(response, null, 2)}\n`);
  }
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { confirmedResponsePath, fillableResponsePath, output, outputPath };
}

async function removeStaleResponseArtifacts(state: {
  confirmedResponseArtifactWritten: boolean;
  fillableResponseArtifactWritten: boolean;
  outputDir: string;
}): Promise<void> {
  if (!state.fillableResponseArtifactWritten) {
    await rm(path.join(state.outputDir, FILLABLE_RESPONSE_FILE_NAME), { force: true });
  }
  if (!state.confirmedResponseArtifactWritten) {
    await rm(path.join(state.outputDir, CONFIRMED_RESPONSE_FILE_NAME), { force: true });
  }
}

function stateFromR1182(value: unknown | null): R1182State {
  return {
    allowedValueKindsMatch: exactStringSet(
      readStringArrayInSetAt(value, ["safeResponseHandoff", "allowedValueKindIds"], ALLOWED_VALUE_KIND_IDS),
      ALLOWED_VALUE_KIND_IDS,
    ),
    artifactBoundaryAggregateOnly: readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]),
    artifactBoundaryUnsafeTrueFlagFound: hasUnsafeTrueBoundaryFlag(value),
    blockedContentMatches: exactStringSet(
      readStringArrayInSetAt(value, ["safeResponseHandoff", "blockedContentIds"], BLOCKED_CONTENT_IDS),
      BLOCKED_CONTENT_IDS,
    ),
    explicitRowOwnerSafeConfirmationProvided: readBooleanAt(value, [
      "summary",
      "explicitRowOwnerSafeConfirmationProvided",
    ]),
    featureOnlyExecutionContractReady: readBooleanAt(value, ["summary", "featureOnlyExecutionContractReady"]),
    handoffConclusion: readStringInSetAt(value, ["summary", "conclusion"], R1182_CONCLUSION_IDS),
    handoffNextAction: readStringInSetAt(value, ["summary", "nextAction"], R1182_NEXT_ACTION_IDS),
    handoffReadyForResearchPlanningOnly: readBooleanAt(value, ["summary", "handoffReadyForResearchPlanningOnly"]),
    inputArtifactAvailable: value !== null,
    minimumPairMatches: exactStringSet(
      readStringArrayInSetAt(
        value,
        ["safeResponseHandoff", "minimumFeaturePairRequired"],
        MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS,
      ),
      MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS,
    ),
    r1182ModelEvidencePromotionAllowed: readBooleanAt(value, [
      "safeResponseHandoff",
      "modelEvidencePromotionAllowed",
    ]),
    packetId: readStringAt(value, ["packetId"]) === R1182_PACKET_ID ? R1182_PACKET_ID : null,
    prioritizedInputKindsMatch: exactStringSet(
      readStringArrayInSetAt(
        value,
        ["safeResponseHandoff", "prioritizedInputKindIds"],
        PRIORITIZED_INPUT_KIND_IDS,
      ),
      PRIORITIZED_INPUT_KIND_IDS,
    ),
    r1182ProductDisplayAuthorized: readBooleanAt(value, ["safeResponseHandoff", "productDisplayAuthorized"]),
    requiredAssertionChecklistMatches: exactStringSet(
      readStringArrayInSetAt(
        value,
        ["safeResponseHandoff", "requiredAssertionChecklistIds"],
        REQUIRED_ASSERTION_CHECKLIST_IDS,
      ),
      REQUIRED_ASSERTION_CHECKLIST_IDS,
    ),
    requiredResponseFieldsMatch: exactStringSet(
      readStringArrayInSetAt(
        value,
        ["safeResponseHandoff", "requiredResponseFieldIds"],
        REQUIRED_RESPONSE_FIELD_IDS,
      ),
      REQUIRED_RESPONSE_FIELD_IDS,
    ),
    responseTemplateInitialValuesFalse: responseTemplateInitialValuesFalse(value),
    responseTemplateKeyOrderMatches: exactStringSet(
      readStringArrayInSetAt(
        value,
        ["safeResponseHandoff", "responseTemplateKeyOrder"],
        RESPONSE_TEMPLATE_KEY_ORDER,
      ),
      RESPONSE_TEMPLATE_KEY_ORDER,
    ),
    responseTemplateSchemaVersion: readStringAt(
      value,
      ["safeResponseHandoff", "responseTemplate", "schemaVersion"],
    ) === R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION
      ? R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION
      : null,
    reviewGptRequiredNow: readBooleanAt(value, ["safeResponseHandoff", "reviewGptRequiredNow"]),
    rowLevelDataAcceptedByR1182: readBooleanAt(value, [
      "safeResponseHandoff",
      "rowLevelDataAcceptedByR1182",
    ]),
    rowOwnerConfirmationInferredByR1182: readBooleanAt(value, [
      "safeResponseHandoff",
      "rowOwnerConfirmationInferredByR1182",
    ]),
    rowOwnerPrivateValuesStored: readBooleanAt(value, ["safeResponseHandoff", "rowOwnerPrivateValuesStored"]),
    rowParsingPerformedByR1182: readBooleanAt(value, ["safeResponseHandoff", "rowParsingPerformedByR1182"]),
    r1182Available: value !== null,
    r1182SchemaCurrent: readStringAt(value, ["schemaVersion"])
      === R1182_AVERAGE_SUBMITTER_SAFE_RESPONSE_HANDOFF_SCHEMA_VERSION,
    r1182Status: readStringAt(value, ["status"]) === "research-local-aggregate-only"
      ? "research-local-aggregate-only"
      : null,
    safeCompletionChecklistMatches: exactStringSet(
      readStringArrayInSetAt(
        value,
        ["safeResponseHandoff", "safeCompletionChecklistItemIds"],
        SAFE_COMPLETION_CHECKLIST_ITEM_IDS,
      ),
      SAFE_COMPLETION_CHECKLIST_ITEM_IDS,
    ),
    sourcePriorityMatches: readStringAt(value, ["safeResponseHandoff", "sourcePriority"]) === TARGET_INPUT_PRIORITY,
    targetAgeBandMatches: readStringAt(value, ["safeResponseHandoff", "targetAgeBand"]) === TARGET_AGE_BAND,
  };
}

function r1182ReadyForRowOwnerConfirmation(state: R1182State): boolean {
  return state.r1182Available
    && state.r1182SchemaCurrent
    && state.packetId === R1182_PACKET_ID
    && state.r1182Status === "research-local-aggregate-only"
    && state.artifactBoundaryAggregateOnly === true
    && !state.artifactBoundaryUnsafeTrueFlagFound
    && state.handoffConclusion === "average_submitter_safe_response_handoff_waiting_on_row_owner_confirmation"
    && state.handoffNextAction === "fill_r1180_safe_confirmation_response_template"
    && state.handoffReadyForResearchPlanningOnly === false
    && state.explicitRowOwnerSafeConfirmationProvided === false
    && state.featureOnlyExecutionContractReady === false
    && state.allowedValueKindsMatch
    && state.blockedContentMatches
    && state.minimumPairMatches
    && state.r1182ModelEvidencePromotionAllowed === false
    && state.prioritizedInputKindsMatch
    && state.r1182ProductDisplayAuthorized === false
    && state.requiredAssertionChecklistMatches
    && state.requiredResponseFieldsMatch
    && state.responseTemplateInitialValuesFalse
    && state.responseTemplateKeyOrderMatches
    && state.responseTemplateSchemaVersion === R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION
    && state.reviewGptRequiredNow === false
    && state.rowLevelDataAcceptedByR1182 === false
    && state.rowOwnerConfirmationInferredByR1182 === false
    && state.rowOwnerPrivateValuesStored === false
    && state.rowParsingPerformedByR1182 === false
    && state.safeCompletionChecklistMatches
    && state.sourcePriorityMatches
    && state.targetAgeBandMatches;
}

function conclusionFor(state: {
  confirmedResponseArtifactWritten: boolean;
  materializerReadyForRowOwnerConfirmation: boolean;
}): MaterializerConclusion {
  if (!state.materializerReadyForRowOwnerConfirmation) {
    return "average_submitter_safe_response_materializer_waiting_on_r1182_handoff";
  }
  if (state.confirmedResponseArtifactWritten) {
    return "average_submitter_safe_response_materializer_confirmed_response_written";
  }
  return "average_submitter_safe_response_materializer_ready_for_explicit_confirmation";
}

function nextActionFor(conclusion: MaterializerConclusion): R1183NextActionId {
  if (conclusion === "average_submitter_safe_response_materializer_waiting_on_r1182_handoff") {
    return "refresh_r1182_safe_response_handoff";
  }
  if (conclusion === "average_submitter_safe_response_materializer_confirmed_response_written") {
    return "run_r1180_with_confirmed_average_submitter_safe_response";
  }
  return "rerun_r1183_with_row_owner_safe_response_assertion";
}

function safeConfirmationResponse(confirmed: boolean): SafeConfirmationResponse {
  return {
    askId: ROW_OWNER_SAFE_CONFIRMATION_ASK_ID,
    confirmDailyWearableActivityExportAvailable: confirmed,
    confirmGlycemiaBloodworkExportAvailable: confirmed,
    confirmNoPrivateValuesIncluded: confirmed,
    confirmTargetAgeBandRoughly16To50: confirmed,
    responseKind: "explicit_yes_all_required_assertions_confirmed",
    schemaVersion: R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION,
  };
}

function responseTemplateInitialValuesFalse(value: unknown | null): boolean {
  return readStringAt(value, ["safeResponseHandoff", "responseTemplate", "askId"])
    === ROW_OWNER_SAFE_CONFIRMATION_ASK_ID
    && readBooleanAt(value, [
      "safeResponseHandoff",
      "responseTemplate",
      "confirmDailyWearableActivityExportAvailable",
    ]) === false
    && readBooleanAt(value, [
      "safeResponseHandoff",
      "responseTemplate",
      "confirmGlycemiaBloodworkExportAvailable",
    ]) === false
    && readBooleanAt(value, ["safeResponseHandoff", "responseTemplate", "confirmNoPrivateValuesIncluded"])
      === false
    && readBooleanAt(value, [
      "safeResponseHandoff",
      "responseTemplate",
      "confirmTargetAgeBandRoughly16To50",
    ]) === false
    && readStringAt(value, ["safeResponseHandoff", "responseTemplate", "responseKind"])
      === "explicit_yes_all_required_assertions_confirmed";
}

function summarizeR1182(value: unknown | null): ArtifactSummary {
  return {
    artifact: R1182_ARTIFACT,
    packetId: readStringAt(value, ["packetId"]) === R1182_PACKET_ID ? R1182_PACKET_ID : null,
    schemaVersion: readStringAt(value, ["schemaVersion"])
      === R1182_AVERAGE_SUBMITTER_SAFE_RESPONSE_HANDOFF_SCHEMA_VERSION
      ? R1182_AVERAGE_SUBMITTER_SAFE_RESPONSE_HANDOFF_SCHEMA_VERSION
      : null,
    status: value === null ? "missing" : "available",
  };
}

function safeBoundary() {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    confirmedResponseLocalPathStored: false,
    fileNamesStored: false,
    fillableResponseLocalPathStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelEvidencePromotedByR1183: false,
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
    rowLevelDataAcceptedByR1183: false,
    rowOwnerConfirmationInferredByR1183: false,
    rowOwnerPrivateValuesStored: false,
    rowOwnerSafeResponseValuesStoredInR1183Packet: false,
    rowParsingPerformedByR1183: false,
    rowValuesStored: false,
    safeBooleanValuesStoredInR1183Packet: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  } as const;
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    return parsed;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return null;
    }
    if (error instanceof SyntaxError) {
      throw new Error("R1183 input JSON parse failed.");
    }
    throw error;
  }
}

function validateAggregateSafe(label: string, value: unknown | null): void {
  if (value === null) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1183 rejected unsafe ${label}: ${findings.length} ${findings.length === 1 ? "finding" : "findings"}`);
  }
}

function ensureNoOutputPathInOutput(value: unknown, outputDir: string): void {
  const serialized = JSON.stringify(value);
  if (serialized.includes(outputDir) || serialized.includes(OUTPUT_FILE_NAME)) {
    throw new Error("R1183 output included an output path.");
  }
}

function createdAtFor(value: string | undefined): string {
  const createdAt = value ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new Error("R1183 rejected invalid createdAt timestamp.");
  }
  return createdAt;
}

function hasUnsafeTrueBoundaryFlag(value: unknown): boolean {
  const boundary = readRecordAt(value, ["artifactBoundary"]);
  if (boundary === null) return false;
  return Object.entries(boundary).some(([key, child]) => key !== "aggregateOnly" && child === true);
}

function readRecordAt(value: unknown, pathParts: readonly string[]): Record<string, unknown> | null {
  const found = readAt(value, pathParts);
  return isPlainRecord(found) ? found : null;
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const found = readAt(value, pathParts);
  return typeof found === "string" ? found : null;
}

function readBooleanAt(value: unknown, pathParts: readonly string[]): boolean | null {
  const found = readAt(value, pathParts);
  return typeof found === "boolean" ? found : null;
}

function readStringArrayAt(value: unknown, pathParts: readonly string[]): string[] | null {
  const found = readAt(value, pathParts);
  return Array.isArray(found) && found.every((item) => typeof item === "string") ? [...found] : null;
}

function readStringInSetAt<T extends readonly string[]>(
  value: unknown,
  pathParts: readonly string[],
  values: T,
): T[number] | null {
  const found = readStringAt(value, pathParts);
  return stringSetIncludes(values, found) ? found : null;
}

function readStringArrayInSetAt<T extends readonly string[]>(
  value: unknown,
  pathParts: readonly string[],
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

function readAt(value: unknown, pathParts: readonly string[]): unknown {
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
  return error.message === "R1183 input JSON parse failed."
    || error.message === "R1183 output included an output path."
    || error.message === "R1183 rejected invalid createdAt timestamp."
    || /^R1183 rejected unsafe (?:r1182 safe response handoff|r1183 safe response materializer|r1183 fillable safe response|r1183 confirmed safe response): \d+ findings?$/u
      .test(error.message);
}

async function main(): Promise<void> {
  try {
    const { output } = await runR1183AverageSubmitterSafeResponseMaterializer({
      createdAt: process.env.MURPH_AGE_R1183_CREATED_AT,
      outputDir: process.env.MURPH_AGE_R1183_OUTPUT_DIR,
      r1182Path: process.env.MURPH_AGE_R1182_SAFE_RESPONSE_HANDOFF_PATH,
      rowOwnerSafeResponseAssertionsConfirmed:
        process.env.MURPH_AGE_R1183_ROW_OWNER_SAFE_RESPONSE_ASSERTIONS_CONFIRMED === "true",
    });
    process.stdout.write(`${JSON.stringify({
      confirmedResponseArtifact: output.summary.confirmedResponseArtifact,
      confirmedResponseArtifactWritten: output.summary.confirmedResponseArtifactWritten,
      conclusion: output.summary.conclusion,
      explicitRowOwnerSafeResponseAssertionProvided:
        output.summary.explicitRowOwnerSafeResponseAssertionProvided,
      fillableResponseArtifact: output.summary.fillableResponseArtifact,
      fillableResponseArtifactWritten: output.summary.fillableResponseArtifactWritten,
      nextAction: output.summary.nextAction,
      packetId: output.packetId,
      responseSchemaVersion: output.summary.responseSchemaVersion,
      r1182Conclusion: output.r1182State.handoffConclusion,
      schemaVersion: output.schemaVersion,
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${safeCliErrorMessage(error, "R1183 safe response materializer failed.")}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
