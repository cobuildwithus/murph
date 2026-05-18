import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1179_AVERAGE_SUBMITTER_OBJECTIVE_GAP_AUDIT_COMMAND,
  R1179_AVERAGE_SUBMITTER_OBJECTIVE_GAP_AUDIT_SCHEMA_VERSION,
} from "./r1179-average-submitter-objective-gap-audit.ts";

export const R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_SCHEMA_VERSION =
  "murph-age-r1180-average-submitter-safe-confirmation-response-intake.v1" as const;
export const R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION =
  "murph-age-r1180-average-submitter-safe-confirmation-response.v1" as const;
export const R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1180-average-submitter-safe-confirmation-response-intake.ts" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1180-average-submitter-safe-confirmation-response-intake.latest.json" as const;
const R1179_ARTIFACT = "r1179-average-submitter-objective-gap-audit.latest.json" as const;
const R1179_PACKET_ID = "r1179-average-submitter-objective-gap-audit" as const;
const R1180_PACKET_ID = "r1180-average-submitter-safe-confirmation-response-intake" as const;
const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first" as const;
const TARGET_AGE_BAND = "roughly_16_50" as const;
const ROW_OWNER_SAFE_CONFIRMATION_ASK_ID =
  "confirm_feature_only_lab_wearable_availability_without_private_values" as const;
const MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
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
const SAFE_COMPLETION_CHECKLIST_ITEM_IDS = [
  "confirm_target_age_band_without_identifiers",
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
const ALLOWED_VALUE_KIND_IDS = [
  "booleans_only",
  "fixed_enumerated_ids_only",
] as const;
const RESPONSE_KIND_IDS = [
  "explicit_yes_all_required_assertions_confirmed",
  "not_confirmed_or_unsure",
] as const;
const RESPONSE_BOOLEAN_FIELD_ENTRIES = [
  ["confirmTargetAgeBandRoughly16To50", "confirm_target_age_band_roughly_16_50"],
  ["confirmGlycemiaBloodworkExportAvailable", "confirm_glycemia_bloodwork_export_available"],
  ["confirmDailyWearableActivityExportAvailable", "confirm_daily_wearable_activity_export_available"],
  ["confirmNoPrivateValuesIncluded", "confirm_no_private_values_in_confirmation"],
] as const;
const RESPONSE_BOOLEAN_KEYS = RESPONSE_BOOLEAN_FIELD_ENTRIES.map(([key]) => key);
const REQUIRED_RESPONSE_FIELD_IDS = RESPONSE_BOOLEAN_FIELD_ENTRIES.map(([, fieldId]) => fieldId);
const RESPONSE_ALLOWED_KEYS = [
  "askId",
  "schemaVersion",
  "responseKind",
  ...RESPONSE_BOOLEAN_KEYS,
] as const;
const INVALID_RESPONSE_REASON_IDS = [
  "ask_id_mismatch",
  "non_boolean_required_field",
  "response_not_object",
  "schema_version_mismatch",
  "unexpected_keys",
  "unsupported_response_kind",
] as const;
const R1180_NEXT_ACTION_IDS = [
  "fill_safe_confirmation_response_template",
  "refresh_r1179_safe_confirmation_ask",
  "rerun_safe_confirmation_response_with_valid_json_object",
  "carry_safe_confirmation_to_feature_only_chain",
  "none",
] as const;

type MinimumFeaturePairSourceFamilyId = typeof MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS[number];
type RequiredInputKindId = typeof REQUIRED_INPUT_KIND_IDS[number];
type RequiredAssertionChecklistId = typeof REQUIRED_ASSERTION_CHECKLIST_IDS[number];
type SafeCompletionChecklistItemId = typeof SAFE_COMPLETION_CHECKLIST_ITEM_IDS[number];
type BlockedContentId = typeof BLOCKED_CONTENT_IDS[number];
type AllowedValueKindId = typeof ALLOWED_VALUE_KIND_IDS[number];
type ResponseKindId = typeof RESPONSE_KIND_IDS[number];
type RequiredResponseFieldId = typeof REQUIRED_RESPONSE_FIELD_IDS[number];
type InvalidResponseReasonId = typeof INVALID_RESPONSE_REASON_IDS[number];
type R1180NextActionId = typeof R1180_NEXT_ACTION_IDS[number];
type ResponseStatus = "incomplete" | "invalid" | "missing" | "ready";
type IntakeConclusion =
  | "safe_confirmation_response_intake_ready_feature_only"
  | "safe_confirmation_response_intake_waiting_on_response"
  | "safe_confirmation_response_intake_waiting_on_r1179_ask"
  | "safe_confirmation_response_intake_rejected_response_shape";

interface ArtifactSummary {
  artifact: string;
  packetId: typeof R1179_PACKET_ID | null;
  schemaVersion: typeof R1179_AVERAGE_SUBMITTER_OBJECTIVE_GAP_AUDIT_SCHEMA_VERSION | null;
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

interface ResponseEvaluation {
  invalidResponseReasonIds: InvalidResponseReasonId[];
  missingRequiredResponseFieldIds: RequiredResponseFieldId[];
  responseKind: ResponseKindId | null;
  responseStatus: ResponseStatus;
}

export interface R1180AverageSubmitterSafeConfirmationResponseIntakeOptions {
  createdAt?: string;
  outputDir?: string;
  r1179Path?: string;
  responsePath?: string;
}

export interface R1180AverageSubmitterSafeConfirmationResponseIntakeOutput {
  artifactBoundary: ReturnType<typeof safeBoundary>;
  createdAt: string;
  inputArtifacts: {
    r1179ObjectiveGapAudit: ArtifactSummary;
    safeConfirmationResponse: {
      schemaVersion: typeof R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION | null;
      status: "available" | "missing";
    };
  };
  packetId: typeof R1180_PACKET_ID;
  productDisplayAuthorized: false;
  safeConfirmationResponseIntake: {
    allowedValueKindIds: AllowedValueKindId[];
    askId: typeof ROW_OWNER_SAFE_CONFIRMATION_ASK_ID;
    blockedContentIds: BlockedContentId[];
    conclusion: IntakeConclusion;
    explicitRowOwnerSafeConfirmationProvided: boolean;
    featureOnlySafeConfirmationReady: boolean;
    invalidResponseReasonIds: InvalidResponseReasonId[];
    minimumFeaturePairRequired: MinimumFeaturePairSourceFamilyId[];
    missingRequiredResponseFieldIds: RequiredResponseFieldId[];
    modelEvidencePromotionAllowed: false;
    nextAction: R1180NextActionId;
    nextActionCommand: string | null;
    prioritizedInputKindIds: RequiredInputKindId[];
    productDisplayAuthorized: false;
    requiredAssertionChecklistIds: RequiredAssertionChecklistId[];
    responseKind: ResponseKindId | null;
    responseStatus: ResponseStatus;
    responseTemplate: SafeConfirmationResponseTemplate;
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1180: false;
    rowOwnerConfirmationInferredByR1180: false;
    rowOwnerPrivateValuesStored: false;
    rowOwnerProvidedPrivateValuesStored: false;
    rowOwnerProvidedSafeBooleansStored: false;
    rowParsingPerformedByR1180: false;
    safeCompletionChecklistItemIds: SafeCompletionChecklistItemId[];
    sourcePriority: typeof TARGET_INPUT_PRIORITY;
    targetAgeBand: typeof TARGET_AGE_BAND;
  };
  schemaVersion: typeof R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: Omit<R1180AverageSubmitterSafeConfirmationResponseIntakeOutput["safeConfirmationResponseIntake"], "responseTemplate">;
}

export async function runR1180AverageSubmitterSafeConfirmationResponseIntake(
  options: R1180AverageSubmitterSafeConfirmationResponseIntakeOptions = {},
): Promise<{ output: R1180AverageSubmitterSafeConfirmationResponseIntakeOutput; outputPath: string }> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const r1179Path = options.r1179Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1179_ARTIFACT);
  const [r1179, response] = await Promise.all([
    readJsonIfPresent(r1179Path),
    options.responsePath === undefined ? Promise.resolve(null) : readJsonIfPresent(options.responsePath),
  ]);
  validateAggregateSafe("r1179 objective gap audit", r1179);
  validateAggregateSafe("safe confirmation response", response);

  const r1179Ready = matchesR1179SafeConfirmationAsk(r1179);
  const responseEvaluation = evaluateResponse(response, r1179Ready);
  const featureOnlySafeConfirmationReady = r1179Ready && responseEvaluation.responseStatus === "ready";
  const explicitRowOwnerSafeConfirmationProvided = featureOnlySafeConfirmationReady;
  const intakeState = intakeStateFor(r1179Ready, responseEvaluation.responseStatus);
  const shared = {
    allowedValueKindIds: [...ALLOWED_VALUE_KIND_IDS],
    askId: ROW_OWNER_SAFE_CONFIRMATION_ASK_ID,
    blockedContentIds: [...BLOCKED_CONTENT_IDS],
    conclusion: intakeState.conclusion,
    explicitRowOwnerSafeConfirmationProvided,
    featureOnlySafeConfirmationReady,
    invalidResponseReasonIds: responseEvaluation.invalidResponseReasonIds,
    minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS],
    missingRequiredResponseFieldIds: responseEvaluation.missingRequiredResponseFieldIds,
    modelEvidencePromotionAllowed: false,
    nextAction: intakeState.nextAction,
    nextActionCommand: commandForNextAction(intakeState.nextAction),
    prioritizedInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
    productDisplayAuthorized: false,
    requiredAssertionChecklistIds: [...REQUIRED_ASSERTION_CHECKLIST_IDS],
    responseKind: responseEvaluation.responseKind,
    responseStatus: responseEvaluation.responseStatus,
    reviewGptRequiredNow: false,
    rowLevelDataAcceptedByR1180: false,
    rowOwnerConfirmationInferredByR1180: false,
    rowOwnerPrivateValuesStored: false,
    rowOwnerProvidedPrivateValuesStored: false,
    rowOwnerProvidedSafeBooleansStored: false,
    rowParsingPerformedByR1180: false,
    safeCompletionChecklistItemIds: [...SAFE_COMPLETION_CHECKLIST_ITEM_IDS],
    sourcePriority: TARGET_INPUT_PRIORITY,
    targetAgeBand: TARGET_AGE_BAND,
  } satisfies R1180AverageSubmitterSafeConfirmationResponseIntakeOutput["summary"];
  const createdAt = createdAtFor(options.createdAt);
  const output: R1180AverageSubmitterSafeConfirmationResponseIntakeOutput = {
    artifactBoundary: safeBoundary(),
    createdAt,
    inputArtifacts: {
      r1179ObjectiveGapAudit: summarizeR1179(r1179),
      safeConfirmationResponse: {
        schemaVersion: readStringAt(response, ["schemaVersion"])
          === R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION
          ? R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION
          : null,
        status: response === null ? "missing" : "available",
      },
    },
    packetId: R1180_PACKET_ID,
    productDisplayAuthorized: false,
    safeConfirmationResponseIntake: {
      ...shared,
      responseTemplate: responseTemplate(),
    },
    schemaVersion: R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: shared,
  };

  ensureNoOutputPathInOutput(output, outputDir);
  validateAggregateSafe("r1180 safe confirmation response intake", output);
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function evaluateResponse(value: unknown | null, r1179Ready: boolean): ResponseEvaluation {
  if (!r1179Ready || value === null) {
    return {
      invalidResponseReasonIds: [],
      missingRequiredResponseFieldIds: [...REQUIRED_RESPONSE_FIELD_IDS],
      responseKind: null,
      responseStatus: "missing",
    };
  }
  if (!isPlainRecord(value)) {
    return invalidResponse(["response_not_object"]);
  }
  const unexpectedKeys = Object.keys(value).filter((key) => !stringSetIncludes(RESPONSE_ALLOWED_KEYS, key));
  if (unexpectedKeys.length > 0) {
    return invalidResponse(["unexpected_keys"]);
  }
  const invalidReasons: InvalidResponseReasonId[] = [];
  if (value.schemaVersion !== R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION) {
    invalidReasons.push("schema_version_mismatch");
  }
  if (value.askId !== ROW_OWNER_SAFE_CONFIRMATION_ASK_ID) {
    invalidReasons.push("ask_id_mismatch");
  }
  const responseKind = stringSetIncludes(RESPONSE_KIND_IDS, value.responseKind)
    ? value.responseKind
    : null;
  if (responseKind === null) {
    invalidReasons.push("unsupported_response_kind");
  }
  if (RESPONSE_BOOLEAN_KEYS.some((key) => key in value && typeof value[key] !== "boolean")) {
    invalidReasons.push("non_boolean_required_field");
  }
  const uniqueInvalidReasons = uniqueStrings(invalidReasons);
  if (uniqueInvalidReasons.length > 0) {
    return invalidResponse(uniqueInvalidReasons);
  }
  const missingRequiredResponseFieldIds = missingResponseFieldIds(value);
  if (
    responseKind === "explicit_yes_all_required_assertions_confirmed"
    && missingRequiredResponseFieldIds.length === 0
  ) {
    return {
      invalidResponseReasonIds: [],
      missingRequiredResponseFieldIds: [],
      responseKind,
      responseStatus: "ready",
    };
  }
  return {
    invalidResponseReasonIds: [],
    missingRequiredResponseFieldIds,
    responseKind,
    responseStatus: "incomplete",
  };
}

function invalidResponse(invalidResponseReasonIds: InvalidResponseReasonId[]): ResponseEvaluation {
  return {
    invalidResponseReasonIds,
    missingRequiredResponseFieldIds: [...REQUIRED_RESPONSE_FIELD_IDS],
    responseKind: null,
    responseStatus: "invalid",
  };
}

function missingResponseFieldIds(value: Record<string, unknown>): RequiredResponseFieldId[] {
  return RESPONSE_BOOLEAN_FIELD_ENTRIES.flatMap(([key, fieldId]) => value[key] === true ? [] : [fieldId]);
}

function matchesR1179SafeConfirmationAsk(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1179_PACKET_ID
    && readStringAt(value, ["schemaVersion"]) === R1179_AVERAGE_SUBMITTER_OBJECTIVE_GAP_AUDIT_SCHEMA_VERSION
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true
    && !hasUnsafeTrueBoundaryFlag(value)
    && readStringAt(value, ["summary", "rowOwnerSafeConfirmationAsk", "askId"])
      === ROW_OWNER_SAFE_CONFIRMATION_ASK_ID
    && readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(value, ["summary", "sourcePriority"]) === TARGET_INPUT_PRIORITY
    && exactStringSet(
      readStringArrayAt(value, ["summary", "rowOwnerSafeConfirmationAsk", "minimumFeaturePairRequired"]),
      MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS,
    )
    && exactStringSet(
      readStringArrayAt(value, ["summary", "rowOwnerSafeConfirmationAsk", "prioritizedInputKindIds"]),
      REQUIRED_INPUT_KIND_IDS,
    )
    && exactStringSet(
      readStringArrayAt(value, ["summary", "rowOwnerSafeConfirmationAsk", "requiredAssertionChecklistIds"]),
      REQUIRED_ASSERTION_CHECKLIST_IDS,
    )
    && readBooleanAt(value, ["summary", "rowOwnerSafeConfirmationAsk", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerSafeConfirmationAsk", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerSafeConfirmationAsk", "rowLevelDataAcceptedByR1179"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerSafeConfirmationAsk", "rowOwnerConfirmationInferredByR1179"])
      === false
    && readBooleanAt(value, ["summary", "rowOwnerSafeConfirmationAsk", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerSafeConfirmationAsk", "rowParsingPerformedByR1179"]) === false;
}

function intakeStateFor(
  r1179Ready: boolean,
  responseStatus: ResponseStatus,
): { conclusion: IntakeConclusion; nextAction: R1180NextActionId } {
  if (!r1179Ready) {
    return {
      conclusion: "safe_confirmation_response_intake_waiting_on_r1179_ask",
      nextAction: "refresh_r1179_safe_confirmation_ask",
    };
  }
  if (responseStatus === "ready") {
    return {
      conclusion: "safe_confirmation_response_intake_ready_feature_only",
      nextAction: "carry_safe_confirmation_to_feature_only_chain",
    };
  }
  if (responseStatus === "invalid") {
    return {
      conclusion: "safe_confirmation_response_intake_rejected_response_shape",
      nextAction: "rerun_safe_confirmation_response_with_valid_json_object",
    };
  }
  return {
    conclusion: "safe_confirmation_response_intake_waiting_on_response",
    nextAction: "fill_safe_confirmation_response_template",
  };
}

function commandForNextAction(nextAction: R1180NextActionId): string | null {
  if (nextAction === "refresh_r1179_safe_confirmation_ask") {
    return R1179_AVERAGE_SUBMITTER_OBJECTIVE_GAP_AUDIT_COMMAND;
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

function summarizeR1179(value: unknown | null): ArtifactSummary {
  return {
    artifact: R1179_ARTIFACT,
    packetId: readStringAt(value, ["packetId"]) === R1179_PACKET_ID ? R1179_PACKET_ID : null,
    schemaVersion: readStringAt(value, ["schemaVersion"])
      === R1179_AVERAGE_SUBMITTER_OBJECTIVE_GAP_AUDIT_SCHEMA_VERSION
      ? R1179_AVERAGE_SUBMITTER_OBJECTIVE_GAP_AUDIT_SCHEMA_VERSION
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
    modelEvidencePromotedByR1180: false,
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
    rowLevelDataAcceptedByR1180: false,
    rowOwnerConfirmationInferredByR1180: false,
    rowOwnerPrivateValuesStored: false,
    rowOwnerProvidedPrivateValuesStored: false,
    rowOwnerProvidedSafeBooleansStored: false,
    rowParsingPerformedByR1180: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  } as const;
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    if (error instanceof SyntaxError) {
      throw new Error("R1180 input JSON parse failed.");
    }
    throw error;
  }
}

function validateAggregateSafe(label: string, value: unknown | null): void {
  if (value === null) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1180 rejected unsafe ${label}: ${findings.length} ${findings.length === 1 ? "finding" : "findings"}`);
  }
}

function ensureNoOutputPathInOutput(output: unknown, outputDir: string): void {
  if (outputDir.length > 0 && JSON.stringify(output).includes(outputDir)) {
    throw new Error("R1180 output included an output path.");
  }
}

function createdAtFor(createdAt: string | undefined): string {
  if (createdAt === undefined) return new Date().toISOString();
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new Error("R1180 rejected invalid createdAt timestamp.");
  }
  return createdAt;
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

function stringSetIncludes<const T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && values.some((item) => item === value);
}

function uniqueStrings<T extends string>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function main(): Promise<void> {
  try {
    const { output } = await runR1180AverageSubmitterSafeConfirmationResponseIntake({
      createdAt: process.env.MURPH_AGE_R1180_CREATED_AT,
      outputDir: process.env.MURPH_AGE_R1180_OUTPUT_DIR,
      r1179Path: process.env.MURPH_AGE_R1179_OBJECTIVE_GAP_AUDIT_PATH,
      responsePath: process.env.MURPH_AGE_R1180_SAFE_CONFIRMATION_RESPONSE_PATH,
    });
    process.stdout.write(`${JSON.stringify({
      askId: output.summary.askId,
      conclusion: output.summary.conclusion,
      explicitRowOwnerSafeConfirmationProvided: output.summary.explicitRowOwnerSafeConfirmationProvided,
      featureOnlySafeConfirmationReady: output.summary.featureOnlySafeConfirmationReady,
      invalidResponseReasonIds: output.summary.invalidResponseReasonIds,
      missingRequiredResponseFieldIds: output.summary.missingRequiredResponseFieldIds,
      nextAction: output.summary.nextAction,
      packetId: output.packetId,
      productDisplayAuthorized: output.summary.productDisplayAuthorized,
      responseStatus: output.summary.responseStatus,
      topMissingResponseFieldId: output.summary.missingRequiredResponseFieldIds[0] ?? null,
    })}\n`);
  } catch (error) {
    process.stderr.write(`${safeCliErrorMessage(error, "R1180 safe confirmation response intake failed.")}\n`);
    process.exitCode = 1;
  }
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  if (
    error.message === "R1180 input JSON parse failed."
    || error.message === "R1180 output included an output path."
    || error.message === "R1180 rejected invalid createdAt timestamp."
    || /^R1180 rejected unsafe (?:r1179 objective gap audit|safe confirmation response|r1180 safe confirmation response intake): \d+ findings?$/u
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
