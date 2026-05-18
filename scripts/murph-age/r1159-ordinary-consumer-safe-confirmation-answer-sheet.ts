import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1158_ORDINARY_CONSUMER_SAFE_CONFIRMATION_FILL_GUIDE_SCHEMA_VERSION,
  R1158_SAFE_CONFIRMATION_FILL_GUIDE_COMMAND,
} from "./r1158-ordinary-consumer-safe-confirmation-fill-guide.ts";

export const R1159_ORDINARY_CONSUMER_SAFE_CONFIRMATION_ANSWER_SHEET_SCHEMA_VERSION =
  "murph-age-r1159-ordinary-consumer-safe-confirmation-answer-sheet.v1" as const;
export const R1159_SAFE_CONFIRMATION_ANSWER_SHEET_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1159-ordinary-consumer-safe-confirmation-answer-sheet.ts" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1159-ordinary-consumer-safe-confirmation-answer-sheet.latest.json";
const FILLABLE_ANSWER_SHEET_FILE_NAME =
  "r1159-fillable-ordinary-consumer-safe-confirmation-answer-sheet.json" as const;
const FEATURE_ONLY_TEMPLATE_FILE_NAME =
  "r1150-fillable-feature-only-safe-availability-confirmation.json" as const;
const FEATURE_ONLY_TEMPLATE_SCHEMA_VERSION =
  "murph-age-r1150-ordinary-consumer-safe-availability-confirmation.v1" as const;
const R1158_EXPECTED = {
  artifact: "r1158-ordinary-consumer-safe-confirmation-fill-guide.latest.json",
  packetId: "r1158-ordinary-consumer-safe-confirmation-fill-guide",
  schemaVersion: R1158_ORDINARY_CONSUMER_SAFE_CONFIRMATION_FILL_GUIDE_SCHEMA_VERSION,
} as const;
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
const REQUIRED_FIELD_EDIT_PATHS = [
  "aggregateReadinessFacts.targetAgeBand",
  "sourceFamilies[bloodwork_glycemia].available",
  "sourceFamilies[wearable_activity_daily].available",
  "rowOwnerAssertionsConfirmed",
  ...REQUIRED_ATTESTATION_KEYS.map((key) => `attestations.${key}`),
] as const;
const REQUIRED_CHECKLIST_IDS = [
  "confirm_target_age_band_without_identifiers",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
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

type FeatureOnlySourceFamilyId = typeof FEATURE_ONLY_SOURCE_FAMILY_IDS[number];
type OptionalAddOnFamilyId = typeof OPTIONAL_ADD_ON_FAMILY_IDS[number];
type RequiredAttestationKey = typeof REQUIRED_ATTESTATION_KEYS[number];
type RequiredChecklistId = typeof REQUIRED_CHECKLIST_IDS[number];
type SafeAnswerConclusion =
  | "ordinary_safe_confirmation_answer_sheet_ready_non_evidence"
  | "ordinary_safe_confirmation_answer_sheet_waiting_on_feature_only_template"
  | "ordinary_safe_confirmation_answer_sheet_waiting_on_fill_guide";
type SafeAnswerNextAction =
  | "fill_r1150_feature_only_safe_confirmation_from_r1159_answer_sheet"
  | "refresh_r1150_safe_availability_confirmation_template"
  | "refresh_r1158_safe_confirmation_fill_guide";

interface ArtifactSummary {
  artifact: string;
  packetId?: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface SafeFieldEdit {
  fieldPath: string;
  privateDetailsStored: false;
  safeEditMeaning: string | null;
  setOnlyIf: string | null;
  setTo: boolean | string | null;
}

interface SafeAnswer {
  answerId: string;
  fieldPath: string;
  mapsToSourceFamilyIds: FeatureOnlySourceFamilyId[];
  privateDetailsStored: false;
  safePrompt: string;
  safeSetTo: boolean | string | null;
  setOnlyIf: string | null;
}

interface SubmitterInputKind {
  inputKindId:
    | "lab_portal_export_or_spreadsheet"
    | "optional_common_bloodwork_or_vitals_context"
    | "phone_watch_or_wearable_activity_export";
  mapsToSourceFamilyIds: Array<FeatureOnlySourceFamilyId | OptionalAddOnFamilyId>;
  privateDetailsStored: false;
  requiredForFeatureOnlyPreferredPair: boolean;
  safeSubmitterExample: string;
}

export interface R1159OrdinaryConsumerSafeConfirmationAnswerSheetOptions {
  createdAt?: string;
  featureOnlyTemplatePath?: string;
  outputDir?: string;
  r1158Path?: string;
}

export interface R1159OrdinaryConsumerSafeConfirmationAnswerSheetOutput {
  artifactBoundary: {
    aggregateOnly: true;
    answerSheetTemplatePathStored: false;
    availabilityConfirmationPathStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
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
    rowLevelDataAcceptedByR1159: false;
    rowOwnerProvidedValuesStored: false;
    rowParsingPerformedByR1159: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
    submittedConfirmationValuesStored: false;
  };
  createdAt: string;
  inputArtifacts: {
    featureOnlyTemplate: ArtifactSummary;
    r1158: ArtifactSummary;
  };
  packetId: "r1159-ordinary-consumer-safe-confirmation-answer-sheet";
  productDisplayAuthorized: false;
  rowOwnerAnswerSheet: {
    answerSheetRole: "answer_sheet_only_not_confirmation_not_model_evidence";
    answerSheetTemplateArtifact: typeof FILLABLE_ANSWER_SHEET_FILE_NAME;
    audience: "ordinary_submitter_roughly_16_50_row_owner";
    blockedConfirmationContent: string[];
    commands: {
      featureOnlyChainRunnerCommand: string | null;
      safeAvailabilityConfirmationIntakeCommand: string | null;
      safeConfirmationFillGuideCommand: typeof R1158_SAFE_CONFIRMATION_FILL_GUIDE_COMMAND;
    };
    exactSafeAnswers: SafeAnswer[];
    minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    optionalAddOnInputKinds: SubmitterInputKind[];
    preferredRecipeId: typeof PREFERRED_RECIPE_ID;
    privateDetailsStored: false;
    readyForR1150FeatureOnlyTranscription: boolean;
    recommendedCompletionModeId: "feature_only_lab_wearable_coverage";
    requiredAttestationKeys: RequiredAttestationKey[];
    requiredChecklistIds: RequiredChecklistId[];
    requiredInputKinds: SubmitterInputKind[];
    rowLevelDataAcceptedByR1159: false;
    rowOwnerProvidedValuesStored: false;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
    transcribesToFeatureOnlyTemplateArtifact: typeof FEATURE_ONLY_TEMPLATE_FILE_NAME;
  };
  schemaVersion: typeof R1159_ORDINARY_CONSUMER_SAFE_CONFIRMATION_ANSWER_SHEET_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    answerSheetReadyForRowOwner: boolean;
    blockedConfirmationContentIds: string[];
    conclusion: SafeAnswerConclusion;
    exactSafeAnswerCount: number;
    featureOnlyTemplateReady: boolean;
    fillGuideReadyForRowOwnerFill: boolean;
    minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    nextAction: SafeAnswerNextAction;
    optionalAddOnFamilyIds: OptionalAddOnFamilyId[];
    productDisplayAuthorized: false;
    recommendedCompletionModeId: "feature_only_lab_wearable_coverage";
    requiredChecklistIds: RequiredChecklistId[];
    requiredInputKindIds: SubmitterInputKind["inputKindId"][];
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1159: false;
    rowOwnerProvidedValuesStored: false;
    rowParsingPerformedByR1159: false;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
}

export async function runR1159OrdinaryConsumerSafeConfirmationAnswerSheet(
  options: R1159OrdinaryConsumerSafeConfirmationAnswerSheetOptions = {},
): Promise<{
  answerSheetTemplatePath: string;
  output: R1159OrdinaryConsumerSafeConfirmationAnswerSheetOutput;
  outputPath: string;
}> {
  const inputs = await readInputs(options);
  validateInputs(inputs);
  const readiness = {
    featureOnlyTemplateReady: featureOnlyTemplateReady(inputs.featureOnlyTemplate),
    fillGuideReadyForRowOwnerFill: fillGuideReadyForRowOwnerFill(inputs.r1158),
  };
  const conclusion = conclusionFor(readiness);
  const answerSheetReadyForRowOwner =
    conclusion === "ordinary_safe_confirmation_answer_sheet_ready_non_evidence";
  const exactSafeAnswers = answerSheetReadyForRowOwner ? safeAnswers(inputs.r1158) : [];
  const blockedContent = blockedConfirmationContent(inputs.r1158);
  const requiredInputKinds = answerSheetReadyForRowOwner ? requiredInputKindsFromGuide(inputs.r1158) : fallbackRequiredInputKinds();
  const output: R1159OrdinaryConsumerSafeConfirmationAnswerSheetOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1159-ordinary-consumer-safe-confirmation-answer-sheet",
    productDisplayAuthorized: false,
    rowOwnerAnswerSheet: {
      answerSheetRole: "answer_sheet_only_not_confirmation_not_model_evidence",
      answerSheetTemplateArtifact: FILLABLE_ANSWER_SHEET_FILE_NAME,
      audience: "ordinary_submitter_roughly_16_50_row_owner",
      blockedConfirmationContent: blockedContent,
      commands: {
        featureOnlyChainRunnerCommand:
          readStringAt(inputs.r1158, ["rowOwnerFillGuide", "commands", "featureOnlyChainRunnerCommand"]),
        safeAvailabilityConfirmationIntakeCommand:
          readStringAt(inputs.r1158, ["rowOwnerFillGuide", "commands", "safeAvailabilityConfirmationIntakeCommand"]),
        safeConfirmationFillGuideCommand: R1158_SAFE_CONFIRMATION_FILL_GUIDE_COMMAND,
      },
      exactSafeAnswers,
      minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      optionalAddOnInputKinds: optionalAddOnInputKindsFromGuide(inputs.r1158),
      preferredRecipeId: PREFERRED_RECIPE_ID,
      privateDetailsStored: false,
      readyForR1150FeatureOnlyTranscription: answerSheetReadyForRowOwner,
      recommendedCompletionModeId: "feature_only_lab_wearable_coverage",
      requiredAttestationKeys: [...REQUIRED_ATTESTATION_KEYS],
      requiredChecklistIds: [...REQUIRED_CHECKLIST_IDS],
      requiredInputKinds,
      rowLevelDataAcceptedByR1159: false,
      rowOwnerProvidedValuesStored: false,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
      transcribesToFeatureOnlyTemplateArtifact: FEATURE_ONLY_TEMPLATE_FILE_NAME,
    },
    schemaVersion: R1159_ORDINARY_CONSUMER_SAFE_CONFIRMATION_ANSWER_SHEET_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      answerSheetReadyForRowOwner,
      blockedConfirmationContentIds: blockedContent,
      conclusion,
      exactSafeAnswerCount: exactSafeAnswers.length,
      ...readiness,
      minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      nextAction: nextActionFor(conclusion),
      optionalAddOnFamilyIds: [...OPTIONAL_ADD_ON_FAMILY_IDS],
      productDisplayAuthorized: false,
      recommendedCompletionModeId: "feature_only_lab_wearable_coverage",
      requiredChecklistIds: [...REQUIRED_CHECKLIST_IDS],
      requiredInputKindIds: requiredInputKinds.filter((item) => item.requiredForFeatureOnlyPreferredPair)
        .map((item) => item.inputKindId),
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1159: false,
      rowOwnerProvidedValuesStored: false,
      rowParsingPerformedByR1159: false,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1159 safe confirmation answer sheet failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const answerSheetTemplatePath = path.join(outputDir, FILLABLE_ANSWER_SHEET_FILE_NAME);
  await writeFile(answerSheetTemplatePath, `${JSON.stringify(fillableAnswerSheetTemplate(output), null, 2)}\n`);
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { answerSheetTemplatePath, output, outputPath };
}

function conclusionFor(input: {
  featureOnlyTemplateReady: boolean;
  fillGuideReadyForRowOwnerFill: boolean;
}): SafeAnswerConclusion {
  if (!input.featureOnlyTemplateReady) {
    return "ordinary_safe_confirmation_answer_sheet_waiting_on_feature_only_template";
  }
  if (!input.fillGuideReadyForRowOwnerFill) {
    return "ordinary_safe_confirmation_answer_sheet_waiting_on_fill_guide";
  }
  return "ordinary_safe_confirmation_answer_sheet_ready_non_evidence";
}

function nextActionFor(conclusion: SafeAnswerConclusion): SafeAnswerNextAction {
  if (conclusion === "ordinary_safe_confirmation_answer_sheet_waiting_on_feature_only_template") {
    return "refresh_r1150_safe_availability_confirmation_template";
  }
  if (conclusion === "ordinary_safe_confirmation_answer_sheet_waiting_on_fill_guide") {
    return "refresh_r1158_safe_confirmation_fill_guide";
  }
  return "fill_r1150_feature_only_safe_confirmation_from_r1159_answer_sheet";
}

function featureOnlyTemplateReady(value: unknown | null): boolean {
  return readStringAt(value, ["schemaVersion"]) === FEATURE_ONLY_TEMPLATE_SCHEMA_VERSION
    && readStringAt(value, ["targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(value, ["targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && readStringAt(value, ["recipeId"]) === PREFERRED_RECIPE_ID
    && readBooleanAt(value, ["featureOnlyCoverageRequiresPreferredPair"]) === true
    && readBooleanAt(value, ["outcomeLinkageRequiredForFeatureOnlyContext"]) === false
    && readBooleanAt(value, ["rowLevelDataAcceptedByR1150"]) === false
    && exactStringSet(
      readStringArrayAt(value, ["minimumFeaturePairRequired"]),
      FEATURE_ONLY_SOURCE_FAMILY_IDS,
    )
    && exactStringSet(sourceFamilyIds(value, ["sourceFamilies"]), FEATURE_ONLY_SOURCE_FAMILY_IDS);
}

function fillGuideReadyForRowOwnerFill(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1158_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1158_EXPECTED.schemaVersion
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(value, ["artifactBoundary", "rowLevelDataAcceptedByR1158"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowParsingPerformedByR1158"]) === false
    && readStringAt(value, ["summary", "conclusion"]) === "ordinary_safe_confirmation_fill_guide_ready_non_evidence"
    && readBooleanAt(value, ["summary", "guideReadyForRowOwnerFill"]) === true
    && readNumberAt(value, ["summary", "exactSafeFieldEditCount"]) === REQUIRED_FIELD_EDIT_PATHS.length
    && readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readStringAt(value, ["summary", "nextAction"]) === "fill_safe_availability_confirmation_from_template"
    && readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1158"]) === false
    && readBooleanAt(value, ["summary", "rowParsingPerformedByR1158"]) === false
    && exactStringSet(readStringArrayAt(value, ["summary", "minimumFeaturePairRequired"]), FEATURE_ONLY_SOURCE_FAMILY_IDS)
    && exactStringSet(readStringArrayAt(value, ["summary", "requiredChecklistIds"]), REQUIRED_CHECKLIST_IDS)
    && exactStringSet(readStringArrayAt(value, ["summary", "optionalAddOnFamilyIds"]), OPTIONAL_ADD_ON_FAMILY_IDS)
    && exactStringSet(safeFieldEdits(value).map((edit) => edit.fieldPath), REQUIRED_FIELD_EDIT_PATHS)
    && safeFieldEdits(value).every((edit) => edit.privateDetailsStored === false);
}

async function readInputs(options: R1159OrdinaryConsumerSafeConfirmationAnswerSheetOptions): Promise<{
  featureOnlyTemplate: unknown | null;
  r1158: unknown | null;
}> {
  return {
    featureOnlyTemplate: await readJsonIfPresent(
      options.featureOnlyTemplatePath ?? path.join(DEFAULT_MODEL_RUNS_DIR, FEATURE_ONLY_TEMPLATE_FILE_NAME),
    ),
    r1158: await readJsonIfPresent(
      options.r1158Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1158_EXPECTED.artifact),
    ),
  };
}

function validateInputs(inputs: Record<string, unknown | null>): void {
  for (const [label, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1159 rejected unsafe ${label} input: ${formatFindingCount(findings)}`);
    }
  }
}

function summarizeInputs(inputs: {
  featureOnlyTemplate: unknown | null;
  r1158: unknown | null;
}): R1159OrdinaryConsumerSafeConfirmationAnswerSheetOutput["inputArtifacts"] {
  return {
    featureOnlyTemplate: {
      artifact: FEATURE_ONLY_TEMPLATE_FILE_NAME,
      schemaVersion: readStringAt(inputs.featureOnlyTemplate, ["schemaVersion"]) === FEATURE_ONLY_TEMPLATE_SCHEMA_VERSION
        ? FEATURE_ONLY_TEMPLATE_SCHEMA_VERSION
        : null,
      status: inputs.featureOnlyTemplate ? "available" : "missing",
    },
    r1158: {
      artifact: R1158_EXPECTED.artifact,
      packetId: readStringAt(inputs.r1158, ["packetId"]) === R1158_EXPECTED.packetId
        ? R1158_EXPECTED.packetId
        : null,
      schemaVersion: readStringAt(inputs.r1158, ["schemaVersion"]) === R1158_EXPECTED.schemaVersion
        ? R1158_EXPECTED.schemaVersion
        : null,
      status: inputs.r1158 ? "available" : "missing",
    },
  };
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

function safeAnswers(value: unknown | null): SafeAnswer[] {
  const editsByPath = new Map(safeFieldEdits(value).map((edit) => [edit.fieldPath, edit]));
  return REQUIRED_FIELD_EDIT_PATHS.map((fieldPath) => {
    const edit = editsByPath.get(fieldPath);
    return {
      answerId: answerIdFor(fieldPath),
      fieldPath,
      mapsToSourceFamilyIds: sourceFamiliesForFieldPath(fieldPath),
      privateDetailsStored: false as false,
      safePrompt: safePromptFor(fieldPath),
      safeSetTo: edit?.setTo ?? defaultSafeSetTo(fieldPath),
      setOnlyIf: edit?.setOnlyIf ?? null,
    };
  });
}

function safeFieldEdits(value: unknown | null): SafeFieldEdit[] {
  return readRecordArrayAt(value, ["rowOwnerFillGuide", "exactSafeFieldEdits"])
    .filter((item) => readBooleanAt(item, ["privateDetailsStored"]) === false)
    .map((item) => ({
      fieldPath: readStringAt(item, ["fieldPath"]) ?? "",
      privateDetailsStored: false as false,
      safeEditMeaning: readStringAt(item, ["safeEditMeaning"]),
      setOnlyIf: readStringAt(item, ["setOnlyIf"]),
      setTo: readBooleanAt(item, ["setTo"]) ?? readStringAt(item, ["setTo"]),
    }))
    .filter((item) => item.fieldPath.length > 0);
}

function answerIdFor(fieldPath: string): string {
  if (fieldPath === "aggregateReadinessFacts.targetAgeBand") return "answer_target_age_band";
  if (fieldPath === "sourceFamilies[bloodwork_glycemia].available") {
    return "answer_glycemia_bloodwork_export_available";
  }
  if (fieldPath === "sourceFamilies[wearable_activity_daily].available") {
    return "answer_daily_wearable_activity_export_available";
  }
  if (fieldPath === "rowOwnerAssertionsConfirmed") return "answer_row_owner_assertions_confirmed";
  if (fieldPath.startsWith("attestations.")) {
    return `answer_${fieldPath.replace("attestations.", "attestation_")}`;
  }
  return `answer_${fieldPath.replace(/[^A-Za-z0-9]+/gu, "_")}`;
}

function sourceFamiliesForFieldPath(fieldPath: string): FeatureOnlySourceFamilyId[] {
  if (fieldPath === "sourceFamilies[bloodwork_glycemia].available") return ["bloodwork_glycemia"];
  if (fieldPath === "sourceFamilies[wearable_activity_daily].available") return ["wearable_activity_daily"];
  if (fieldPath === "rowOwnerAssertionsConfirmed") return [...FEATURE_ONLY_SOURCE_FAMILY_IDS];
  return [];
}

function safePromptFor(fieldPath: string): string {
  if (fieldPath === "aggregateReadinessFacts.targetAgeBand") {
    return "Confirm this row-owner submission is only for the roughly 16-50 target band; do not add a birthdate or exact age.";
  }
  if (fieldPath === "sourceFamilies[bloodwork_glycemia].available") {
    return "Confirm a lab portal export or spreadsheet has glycemia bloodwork coverage; do not add lab values, headers, filenames, paths, or account details.";
  }
  if (fieldPath === "sourceFamilies[wearable_activity_daily].available") {
    return "Confirm a phone, watch, or wearable export has daily activity coverage; do not add step counts, minute values, headers, filenames, paths, or account details.";
  }
  if (fieldPath === "rowOwnerAssertionsConfirmed") {
    return "Confirm the safe availability answers were reviewed locally by the row owner and contain no private details.";
  }
  if (fieldPath.startsWith("attestations.")) {
    return `Confirm ${fieldPath} is true for this safe availability answer sheet.`;
  }
  return "Confirm this safe field without adding private row details.";
}

function defaultSafeSetTo(fieldPath: string): boolean | string {
  return fieldPath === "aggregateReadinessFacts.targetAgeBand" ? TARGET_AGE_BAND : true;
}

function requiredInputKindsFromGuide(value: unknown | null): SubmitterInputKind[] {
  const kinds = readRecordArrayAt(value, ["rowOwnerFillGuide", "requiredInputKinds"])
    .map((item): SubmitterInputKind | null => {
      const inputKindId = readStringAt(item, ["inputKindId"]);
      if (inputKindId !== "lab_portal_export_or_spreadsheet"
        && inputKindId !== "phone_watch_or_wearable_activity_export") {
        return null;
      }
      const sourceFamilies = readStringArrayAt(item, ["mapsToSourceFamilyIds"])
        .filter((familyId): familyId is FeatureOnlySourceFamilyId =>
          FEATURE_ONLY_SOURCE_FAMILY_IDS.includes(familyId as FeatureOnlySourceFamilyId)
        );
      if (sourceFamilies.length === 0) return null;
      return {
        inputKindId,
        mapsToSourceFamilyIds: sourceFamilies,
        privateDetailsStored: false,
        requiredForFeatureOnlyPreferredPair: readBooleanAt(item, ["requiredForFeatureOnlyPreferredPair"]) === true,
        safeSubmitterExample:
          readStringAt(item, ["safeSubmitterExample"])
            ?? safeSubmitterExampleFor(inputKindId),
      };
    })
    .filter((item): item is SubmitterInputKind => item !== null);
  return kinds.length === FEATURE_ONLY_SOURCE_FAMILY_IDS.length ? kinds : fallbackRequiredInputKinds();
}

function fallbackRequiredInputKinds(): SubmitterInputKind[] {
  return [
    {
      inputKindId: "lab_portal_export_or_spreadsheet",
      mapsToSourceFamilyIds: ["bloodwork_glycemia"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: true,
      safeSubmitterExample: safeSubmitterExampleFor("lab_portal_export_or_spreadsheet"),
    },
    {
      inputKindId: "phone_watch_or_wearable_activity_export",
      mapsToSourceFamilyIds: ["wearable_activity_daily"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: true,
      safeSubmitterExample: safeSubmitterExampleFor("phone_watch_or_wearable_activity_export"),
    },
  ];
}

function optionalAddOnInputKindsFromGuide(value: unknown | null): SubmitterInputKind[] {
  const kinds = readRecordArrayAt(value, ["rowOwnerFillGuide", "optionalAddOnInputKinds"])
    .map((item): SubmitterInputKind | null => {
      if (readStringAt(item, ["inputKindId"]) !== "optional_common_bloodwork_or_vitals_context") return null;
      return {
        inputKindId: "optional_common_bloodwork_or_vitals_context",
        mapsToSourceFamilyIds: [...OPTIONAL_ADD_ON_FAMILY_IDS],
        privateDetailsStored: false,
        requiredForFeatureOnlyPreferredPair: false,
        safeSubmitterExample:
          readStringAt(item, ["safeSubmitterExample"])
            ?? "Common bloodwork, vitals, or body-context add-ons can be declared later without blocking the minimum labs plus wearable path.",
      };
    })
    .filter((item): item is SubmitterInputKind => item !== null);
  return kinds.length > 0 ? kinds : [
    {
      inputKindId: "optional_common_bloodwork_or_vitals_context",
      mapsToSourceFamilyIds: [...OPTIONAL_ADD_ON_FAMILY_IDS],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: false,
      safeSubmitterExample:
        "Common bloodwork, vitals, or body-context add-ons can be declared later without blocking the minimum labs plus wearable path.",
    },
  ];
}

function safeSubmitterExampleFor(inputKindId: SubmitterInputKind["inputKindId"]): string {
  if (inputKindId === "lab_portal_export_or_spreadsheet") {
    return "A normal lab portal export or spreadsheet has glycemia bloodwork coverage.";
  }
  if (inputKindId === "phone_watch_or_wearable_activity_export") {
    return "A phone, watch, or wearable export has daily activity coverage.";
  }
  return "Common bloodwork, vitals, or body-context add-ons can be declared later.";
}

function blockedConfirmationContent(value: unknown | null): string[] {
  const blocked = readStringArrayAt(value, ["rowOwnerFillGuide", "blockedConfirmationContent"]);
  return blocked.length > 0 ? blocked : [...BLOCKED_CONFIRMATION_CONTENT];
}

function fillableAnswerSheetTemplate(
  output: R1159OrdinaryConsumerSafeConfirmationAnswerSheetOutput,
): {
  answerSheetRole: R1159OrdinaryConsumerSafeConfirmationAnswerSheetOutput["rowOwnerAnswerSheet"]["answerSheetRole"];
  blockedConfirmationContent: string[];
  exactSafeAnswers: SafeAnswer[];
  privateDetailsStored: false;
  readyForR1150FeatureOnlyTranscription: boolean;
  recommendedCompletionModeId: "feature_only_lab_wearable_coverage";
  rowLevelDataAcceptedByR1159: false;
  rowOwnerProvidedValuesStored: false;
  targetAgeBand: typeof TARGET_AGE_BAND;
  targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  transcribesToFeatureOnlyTemplateArtifact: typeof FEATURE_ONLY_TEMPLATE_FILE_NAME;
} {
  return {
    answerSheetRole: output.rowOwnerAnswerSheet.answerSheetRole,
    blockedConfirmationContent: output.rowOwnerAnswerSheet.blockedConfirmationContent,
    exactSafeAnswers: output.rowOwnerAnswerSheet.exactSafeAnswers,
    privateDetailsStored: false,
    readyForR1150FeatureOnlyTranscription: output.rowOwnerAnswerSheet.readyForR1150FeatureOnlyTranscription,
    recommendedCompletionModeId: "feature_only_lab_wearable_coverage",
    rowLevelDataAcceptedByR1159: false,
    rowOwnerProvidedValuesStored: false,
    targetAgeBand: TARGET_AGE_BAND,
    targetInputPriority: TARGET_INPUT_PRIORITY,
    transcribesToFeatureOnlyTemplateArtifact: FEATURE_ONLY_TEMPLATE_FILE_NAME,
  };
}

function sourceFamilyIds(value: unknown | null, pathParts: readonly string[]): string[] {
  return readRecordArrayAt(value, pathParts)
    .map((item) => readStringAt(item, ["familyId"]))
    .filter((item): item is string => item !== null);
}

function readBooleanAt(value: unknown | null, pathParts: readonly string[]): boolean | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "boolean" ? resolved : null;
}

function readNumberAt(value: unknown | null, pathParts: readonly string[]): number | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "number" ? resolved : null;
}

function readStringAt(value: unknown | null, pathParts: readonly string[]): string | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
}

function readStringArrayAt(value: unknown | null, pathParts: readonly string[]): string[] {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved) ? resolved.filter((item): item is string => typeof item === "string") : [];
}

function readRecordArrayAt(value: unknown | null, pathParts: readonly string[]): Array<Record<string, unknown>> {
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

function exactStringSet(values: readonly string[], expectedValues: readonly string[]): boolean {
  return values.length === expectedValues.length
    && expectedValues.every((value) => values.includes(value));
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

function safeBoundary(): R1159OrdinaryConsumerSafeConfirmationAnswerSheetOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    answerSheetTemplatePathStored: false,
    availabilityConfirmationPathStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
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
    rowLevelDataAcceptedByR1159: false,
    rowOwnerProvidedValuesStored: false,
    rowParsingPerformedByR1159: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
    submittedConfirmationValuesStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1159OrdinaryConsumerSafeConfirmationAnswerSheet({
    featureOnlyTemplatePath: process.env.MURPH_AGE_R1150_FEATURE_ONLY_SAFE_AVAILABILITY_CONFIRMATION_TEMPLATE_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1158Path: process.env.MURPH_AGE_R1158_ORDINARY_CONSUMER_SAFE_CONFIRMATION_FILL_GUIDE_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    answerSheetReadyForRowOwner: output.summary.answerSheetReadyForRowOwner,
    blockedConfirmationContentIds: output.summary.blockedConfirmationContentIds,
    conclusion: output.summary.conclusion,
    exactSafeAnswerCount: output.summary.exactSafeAnswerCount,
    featureOnlyTemplateReady: output.summary.featureOnlyTemplateReady,
    fillGuideReadyForRowOwnerFill: output.summary.fillGuideReadyForRowOwnerFill,
    minimumFeaturePairRequired: output.summary.minimumFeaturePairRequired,
    modelEvidencePromotionAllowed: output.summary.modelEvidencePromotionAllowed,
    nextAction: output.summary.nextAction,
    optionalAddOnFamilyIds: output.summary.optionalAddOnFamilyIds,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    recommendedCompletionModeId: output.summary.recommendedCompletionModeId,
    requiredChecklistIds: output.summary.requiredChecklistIds,
    requiredInputKindIds: output.summary.requiredInputKindIds,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowLevelDataAcceptedByR1159: output.summary.rowLevelDataAcceptedByR1159,
    rowOwnerProvidedValuesStored: output.summary.rowOwnerProvidedValuesStored,
    rowParsingPerformedByR1159: output.summary.rowParsingPerformedByR1159,
    schemaVersion: output.schemaVersion,
    status: output.status,
    targetAgeBand: output.summary.targetAgeBand,
    targetInputPriority: output.summary.targetInputPriority,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1159 safe confirmation answer sheet failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
