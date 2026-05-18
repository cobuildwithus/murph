import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { R1159_ORDINARY_CONSUMER_SAFE_CONFIRMATION_ANSWER_SHEET_SCHEMA_VERSION } from "./r1159-ordinary-consumer-safe-confirmation-answer-sheet.ts";

export const R1160_R1159_FEATURE_ONLY_SAFE_CONFIRMATION_TRANSCRIPTION_PROOF_SCHEMA_VERSION =
  "murph-age-r1160-r1159-feature-only-safe-confirmation-transcription-proof.v1" as const;
export const R1160_TRANSCRIPTION_PROOF_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1160-r1159-feature-only-safe-confirmation-transcription-proof.ts" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME =
  "r1160-r1159-feature-only-safe-confirmation-transcription-proof.latest.json";
const FEATURE_ONLY_TEMPLATE_FILE_NAME =
  "r1150-fillable-feature-only-safe-availability-confirmation.json" as const;
const FEATURE_ONLY_TEMPLATE_SCHEMA_VERSION =
  "murph-age-r1150-ordinary-consumer-safe-availability-confirmation.v1" as const;
const R1159_EXPECTED = {
  artifact: "r1159-ordinary-consumer-safe-confirmation-answer-sheet.latest.json",
  packetId: "r1159-ordinary-consumer-safe-confirmation-answer-sheet",
  schemaVersion: R1159_ORDINARY_CONSUMER_SAFE_CONFIRMATION_ANSWER_SHEET_SCHEMA_VERSION,
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
const REQUIRED_TRANSCRIPTION_FIELD_PATHS = [
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

type FeatureOnlySourceFamilyId = typeof FEATURE_ONLY_SOURCE_FAMILY_IDS[number];
type OptionalAddOnFamilyId = typeof OPTIONAL_ADD_ON_FAMILY_IDS[number];
type RequiredChecklistId = typeof REQUIRED_CHECKLIST_IDS[number];
type RequiredAttestationKey = typeof REQUIRED_ATTESTATION_KEYS[number];
type TranscriptionConclusion =
  | "r1159_feature_only_safe_confirmation_transcription_incomplete"
  | "r1159_feature_only_safe_confirmation_transcription_ready_non_evidence"
  | "r1159_feature_only_safe_confirmation_transcription_waiting_on_feature_only_template"
  | "r1159_feature_only_safe_confirmation_transcription_waiting_on_r1159_answer_sheet";
type TranscriptionNextAction =
  | "refresh_r1150_safe_availability_confirmation_template"
  | "refresh_r1159_safe_confirmation_answer_sheet"
  | "row_owner_confirm_r1150_feature_only_safe_availability_from_r1160_transcription_proof";

interface ArtifactSummary {
  artifact: string;
  packetId?: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface SafeAnswer {
  answerId: string | null;
  fieldPath: string | null;
  mapsToSourceFamilyIds: string[];
  privateDetailsStored: boolean | null;
  safeSetTo: boolean | string | null;
}

interface SafeTranscriptionStep {
  answerId: string | null;
  fieldPath: string;
  mapsToSourceFamilyIds: FeatureOnlySourceFamilyId[];
  privateDetailsStored: false;
}

export interface R1160R1159FeatureOnlySafeConfirmationTranscriptionProofOptions {
  createdAt?: string;
  featureOnlyTemplatePath?: string;
  outputDir?: string;
  r1159Path?: string;
}

export interface R1160R1159FeatureOnlySafeConfirmationTranscriptionProofOutput {
  artifactBoundary: {
    aggregateOnly: true;
    answerSheetValuesStored: false;
    availabilityConfirmationPathStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    confirmationValuesStoredByR1160: false;
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
    rowLevelDataAcceptedByR1160: false;
    rowOwnerProvidedValuesStored: false;
    rowParsingPerformedByR1160: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
    transcribedConfirmationPersisted: false;
  };
  createdAt: string;
  inputArtifacts: {
    featureOnlyTemplate: ArtifactSummary;
    r1159: ArtifactSummary;
  };
  packetId: "r1160-r1159-feature-only-safe-confirmation-transcription-proof";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1160_R1159_FEATURE_ONLY_SAFE_CONFIRMATION_TRANSCRIPTION_PROOF_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  transcriptionProof: {
    exactSafeTranscriptionStepCount: number;
    featureOnlyTemplateReady: boolean;
    hypotheticalTranscriptionWouldBeFeatureOnlyReady: boolean;
    minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    optionalAddOnFamilyIds: OptionalAddOnFamilyId[];
    privateDetailsStored: false;
    proofRole: "mechanical_transcription_proof_only_not_confirmation_not_model_evidence";
    requiredChecklistIds: RequiredChecklistId[];
    requiredInputKindIds: Array<"lab_portal_export_or_spreadsheet" | "phone_watch_or_wearable_activity_export">;
    rowLevelDataAcceptedByR1160: false;
    rowOwnerConfirmationStillRequired: true;
    rowOwnerProvidedValuesStored: false;
    r1150FeatureOnlyTemplateArtifact: typeof FEATURE_ONLY_TEMPLATE_FILE_NAME;
    r1159AnswerSheetReadyForRowOwner: boolean;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
    transcribedConfirmationPersisted: false;
    transcriptionSteps: SafeTranscriptionStep[];
  };
  summary: {
    conclusion: TranscriptionConclusion;
    confirmationValuesStoredByR1160: false;
    exactSafeTranscriptionStepCount: number;
    featureOnlyTemplateReady: boolean;
    hypotheticalTranscriptionWouldBeFeatureOnlyReady: boolean;
    minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    nextAction: TranscriptionNextAction;
    optionalAddOnFamilyIds: OptionalAddOnFamilyId[];
    productDisplayAuthorized: false;
    requiredChecklistIds: RequiredChecklistId[];
    requiredInputKindIds: Array<"lab_portal_export_or_spreadsheet" | "phone_watch_or_wearable_activity_export">;
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1160: false;
    rowOwnerConfirmationStillRequired: true;
    rowOwnerProvidedValuesStored: false;
    rowParsingPerformedByR1160: false;
    r1159AnswerSheetReadyForRowOwner: boolean;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
    transcriptionProofReadyForRowOwnerConfirmation: boolean;
  };
}

export async function runR1160R1159FeatureOnlySafeConfirmationTranscriptionProof(
  options: R1160R1159FeatureOnlySafeConfirmationTranscriptionProofOptions = {},
): Promise<{
  output: R1160R1159FeatureOnlySafeConfirmationTranscriptionProofOutput;
  outputPath: string;
}> {
  const inputs = await readInputs(options);
  validateInputs(inputs);
  const r1159Ready = r1159AnswerSheetReady(inputs.r1159);
  const featureOnlyReady = featureOnlyTemplateReady(inputs.featureOnlyTemplate);
  const steps = r1159Ready ? safeTranscriptionSteps(inputs.r1159) : [];
  const hypotheticalTranscriptionWouldBeFeatureOnlyReady = r1159Ready
    && featureOnlyReady
    && transcriptionFieldSetReady(steps)
    && hypotheticalFeatureOnlyConfirmationReady(inputs.featureOnlyTemplate, inputs.r1159);
  const conclusion = conclusionFor({
    featureOnlyTemplateReady: featureOnlyReady,
    hypotheticalTranscriptionWouldBeFeatureOnlyReady,
    r1159AnswerSheetReadyForRowOwner: r1159Ready,
  });
  const output: R1160R1159FeatureOnlySafeConfirmationTranscriptionProofOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1160-r1159-feature-only-safe-confirmation-transcription-proof",
    productDisplayAuthorized: false,
    schemaVersion: R1160_R1159_FEATURE_ONLY_SAFE_CONFIRMATION_TRANSCRIPTION_PROOF_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    transcriptionProof: {
      exactSafeTranscriptionStepCount: steps.length,
      featureOnlyTemplateReady: featureOnlyReady,
      hypotheticalTranscriptionWouldBeFeatureOnlyReady,
      minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      optionalAddOnFamilyIds: [...OPTIONAL_ADD_ON_FAMILY_IDS],
      privateDetailsStored: false as const,
      proofRole: "mechanical_transcription_proof_only_not_confirmation_not_model_evidence",
      requiredChecklistIds: [...REQUIRED_CHECKLIST_IDS],
      requiredInputKindIds: ["lab_portal_export_or_spreadsheet", "phone_watch_or_wearable_activity_export"],
      rowLevelDataAcceptedByR1160: false,
      rowOwnerConfirmationStillRequired: true,
      rowOwnerProvidedValuesStored: false,
      r1150FeatureOnlyTemplateArtifact: FEATURE_ONLY_TEMPLATE_FILE_NAME,
      r1159AnswerSheetReadyForRowOwner: r1159Ready,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
      transcribedConfirmationPersisted: false,
      transcriptionSteps: steps,
    },
    summary: {
      conclusion,
      confirmationValuesStoredByR1160: false,
      exactSafeTranscriptionStepCount: steps.length,
      featureOnlyTemplateReady: featureOnlyReady,
      hypotheticalTranscriptionWouldBeFeatureOnlyReady,
      minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      nextAction: nextActionFor(conclusion),
      optionalAddOnFamilyIds: [...OPTIONAL_ADD_ON_FAMILY_IDS],
      productDisplayAuthorized: false,
      requiredChecklistIds: [...REQUIRED_CHECKLIST_IDS],
      requiredInputKindIds: ["lab_portal_export_or_spreadsheet", "phone_watch_or_wearable_activity_export"],
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1160: false,
      rowOwnerConfirmationStillRequired: true,
      rowOwnerProvidedValuesStored: false,
      rowParsingPerformedByR1160: false,
      r1159AnswerSheetReadyForRowOwner: r1159Ready,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
      transcriptionProofReadyForRowOwnerConfirmation:
        conclusion === "r1159_feature_only_safe_confirmation_transcription_ready_non_evidence",
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1160 transcription proof failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function conclusionFor(input: {
  featureOnlyTemplateReady: boolean;
  hypotheticalTranscriptionWouldBeFeatureOnlyReady: boolean;
  r1159AnswerSheetReadyForRowOwner: boolean;
}): TranscriptionConclusion {
  if (!input.r1159AnswerSheetReadyForRowOwner) {
    return "r1159_feature_only_safe_confirmation_transcription_waiting_on_r1159_answer_sheet";
  }
  if (!input.featureOnlyTemplateReady) {
    return "r1159_feature_only_safe_confirmation_transcription_waiting_on_feature_only_template";
  }
  if (!input.hypotheticalTranscriptionWouldBeFeatureOnlyReady) {
    return "r1159_feature_only_safe_confirmation_transcription_incomplete";
  }
  return "r1159_feature_only_safe_confirmation_transcription_ready_non_evidence";
}

function nextActionFor(conclusion: TranscriptionConclusion): TranscriptionNextAction {
  if (conclusion === "r1159_feature_only_safe_confirmation_transcription_waiting_on_r1159_answer_sheet"
    || conclusion === "r1159_feature_only_safe_confirmation_transcription_incomplete") {
    return "refresh_r1159_safe_confirmation_answer_sheet";
  }
  if (conclusion === "r1159_feature_only_safe_confirmation_transcription_waiting_on_feature_only_template") {
    return "refresh_r1150_safe_availability_confirmation_template";
  }
  return "row_owner_confirm_r1150_feature_only_safe_availability_from_r1160_transcription_proof";
}

async function readInputs(options: R1160R1159FeatureOnlySafeConfirmationTranscriptionProofOptions): Promise<{
  featureOnlyTemplate: unknown | null;
  r1159: unknown | null;
}> {
  return {
    featureOnlyTemplate: await readJsonIfPresent(
      options.featureOnlyTemplatePath ?? path.join(DEFAULT_MODEL_RUNS_DIR, FEATURE_ONLY_TEMPLATE_FILE_NAME),
    ),
    r1159: await readJsonIfPresent(
      options.r1159Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1159_EXPECTED.artifact),
    ),
  };
}

function validateInputs(inputs: Record<string, unknown | null>): void {
  for (const [label, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1160 rejected unsafe ${label} input: ${formatFindingCount(findings)}`);
    }
  }
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

function summarizeInputs(inputs: {
  featureOnlyTemplate: unknown | null;
  r1159: unknown | null;
}): R1160R1159FeatureOnlySafeConfirmationTranscriptionProofOutput["inputArtifacts"] {
  return {
    featureOnlyTemplate: {
      artifact: FEATURE_ONLY_TEMPLATE_FILE_NAME,
      schemaVersion: readStringAt(inputs.featureOnlyTemplate, ["schemaVersion"]) === FEATURE_ONLY_TEMPLATE_SCHEMA_VERSION
        ? FEATURE_ONLY_TEMPLATE_SCHEMA_VERSION
        : null,
      status: inputs.featureOnlyTemplate ? "available" : "missing",
    },
    r1159: {
      artifact: R1159_EXPECTED.artifact,
      packetId: readStringAt(inputs.r1159, ["packetId"]) === R1159_EXPECTED.packetId
        ? R1159_EXPECTED.packetId
        : null,
      schemaVersion: readStringAt(inputs.r1159, ["schemaVersion"]) === R1159_EXPECTED.schemaVersion
        ? R1159_EXPECTED.schemaVersion
        : null,
      status: inputs.r1159 ? "available" : "missing",
    },
  };
}

function r1159AnswerSheetReady(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1159_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1159_EXPECTED.schemaVersion
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(value, ["artifactBoundary", "rowLevelDataAcceptedByR1159"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerProvidedValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "submittedConfirmationValuesStored"]) === false
    && readStringAt(value, ["summary", "conclusion"]) === "ordinary_safe_confirmation_answer_sheet_ready_non_evidence"
    && readBooleanAt(value, ["summary", "answerSheetReadyForRowOwner"]) === true
    && readStringAt(value, ["summary", "nextAction"]) === "fill_r1150_feature_only_safe_confirmation_from_r1159_answer_sheet"
    && readNumberAt(value, ["summary", "exactSafeAnswerCount"]) === REQUIRED_TRANSCRIPTION_FIELD_PATHS.length
    && readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1159"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerProvidedValuesStored"]) === false
    && readBooleanAt(value, ["summary", "rowParsingPerformedByR1159"]) === false
    && readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(value, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && exactStringSet(readStringArrayAt(value, ["summary", "minimumFeaturePairRequired"]), FEATURE_ONLY_SOURCE_FAMILY_IDS)
    && exactStringSet(readStringArrayAt(value, ["summary", "optionalAddOnFamilyIds"]), OPTIONAL_ADD_ON_FAMILY_IDS)
    && exactStringSet(readStringArrayAt(value, ["summary", "requiredChecklistIds"]), REQUIRED_CHECKLIST_IDS)
    && exactStringSet(
      readStringArrayAt(value, ["summary", "requiredInputKindIds"]),
      ["lab_portal_export_or_spreadsheet", "phone_watch_or_wearable_activity_export"],
    );
}

function featureOnlyTemplateReady(value: unknown | null): boolean {
  return readStringAt(value, ["schemaVersion"]) === FEATURE_ONLY_TEMPLATE_SCHEMA_VERSION
    && readStringAt(value, ["targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(value, ["targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && readStringAt(value, ["recipeId"]) === PREFERRED_RECIPE_ID
    && readBooleanAt(value, ["featureOnlyCoverageRequiresPreferredPair"]) === true
    && readBooleanAt(value, ["outcomeLinkageRequiredForFeatureOnlyContext"]) === false
    && readBooleanAt(value, ["rowLevelDataAcceptedByR1150"]) === false
    && exactStringSet(readStringArrayAt(value, ["minimumFeaturePairRequired"]), FEATURE_ONLY_SOURCE_FAMILY_IDS)
    && exactStringSet(sourceFamilyIds(value), FEATURE_ONLY_SOURCE_FAMILY_IDS);
}

function safeTranscriptionSteps(value: unknown | null): SafeTranscriptionStep[] {
  return safeAnswers(value)
    .filter((answer) =>
      typeof answer.fieldPath === "string"
      && REQUIRED_TRANSCRIPTION_FIELD_PATHS.includes(answer.fieldPath)
      && answer.privateDetailsStored === false
    )
    .map((answer): SafeTranscriptionStep => ({
      answerId: answer.answerId,
      fieldPath: answer.fieldPath ?? "",
      mapsToSourceFamilyIds: answer.mapsToSourceFamilyIds
        .filter((familyId): familyId is FeatureOnlySourceFamilyId =>
          FEATURE_ONLY_SOURCE_FAMILY_IDS.includes(familyId as FeatureOnlySourceFamilyId)
        ),
      privateDetailsStored: false,
    }))
    .filter((step) => step.fieldPath.length > 0);
}

function safeAnswers(value: unknown | null): SafeAnswer[] {
  return readRecordArrayAt(value, ["rowOwnerAnswerSheet", "exactSafeAnswers"])
    .map((answer) => ({
      answerId: readStringAt(answer, ["answerId"]),
      fieldPath: readStringAt(answer, ["fieldPath"]),
      mapsToSourceFamilyIds: readStringArrayAt(answer, ["mapsToSourceFamilyIds"]),
      privateDetailsStored: readBooleanAt(answer, ["privateDetailsStored"]),
      safeSetTo: readBooleanAt(answer, ["safeSetTo"]) ?? readStringAt(answer, ["safeSetTo"]),
    }));
}

function transcriptionFieldSetReady(steps: SafeTranscriptionStep[]): boolean {
  return exactStringSet(steps.map((step) => step.fieldPath), REQUIRED_TRANSCRIPTION_FIELD_PATHS);
}

function hypotheticalFeatureOnlyConfirmationReady(
  template: unknown | null,
  r1159: unknown | null,
): boolean {
  const transcribed = transcribeFeatureOnlyConfirmation(template, safeAnswers(r1159));
  if (!transcribed) return false;
  return readStringAt(transcribed, ["schemaVersion"]) === FEATURE_ONLY_TEMPLATE_SCHEMA_VERSION
    && readStringAt(transcribed, ["targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(transcribed, ["targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && readStringAt(transcribed, ["recipeId"]) === PREFERRED_RECIPE_ID
    && readBooleanAt(transcribed, ["featureOnlyCoverageRequiresPreferredPair"]) === true
    && readBooleanAt(transcribed, ["outcomeLinkageRequiredForFeatureOnlyContext"]) === false
    && readBooleanAt(transcribed, ["rowLevelDataAcceptedByR1150"]) === false
    && readBooleanAt(transcribed, ["rowOwnerAssertionsConfirmed"]) === true
    && REQUIRED_ATTESTATION_KEYS.every((key) => readBooleanAt(transcribed, ["attestations", key]) === true)
    && FEATURE_ONLY_SOURCE_FAMILY_IDS.every((familyId) => sourceFamilyAvailable(transcribed, familyId) === true)
    && exactStringSet(readStringArrayAt(transcribed, ["minimumFeaturePairRequired"]), FEATURE_ONLY_SOURCE_FAMILY_IDS);
}

function transcribeFeatureOnlyConfirmation(
  template: unknown | null,
  answers: SafeAnswer[],
): Record<string, unknown> | null {
  const cloned = cloneRecord(template);
  if (!cloned) return null;
  for (const answer of answers) {
    if (!answer.fieldPath || answer.privateDetailsStored !== false) continue;
    applySafeAnswer(cloned, answer.fieldPath, answer.safeSetTo);
  }
  return cloned;
}

function applySafeAnswer(target: Record<string, unknown>, fieldPath: string, value: boolean | string | null): void {
  if (fieldPath === "aggregateReadinessFacts.targetAgeBand") {
    const facts = ensureRecord(target, "aggregateReadinessFacts");
    facts.targetAgeBand = value;
    return;
  }
  if (fieldPath === "rowOwnerAssertionsConfirmed") {
    target.rowOwnerAssertionsConfirmed = value;
    return;
  }
  if (fieldPath.startsWith("attestations.")) {
    const key = fieldPath.replace("attestations.", "");
    const attestations = ensureRecord(target, "attestations");
    attestations[key] = value;
    return;
  }
  const sourceFamilyMatch = fieldPath.match(/^sourceFamilies\[([^\]]+)\]\.available$/u);
  if (sourceFamilyMatch) {
    setSourceFamilyAvailable(target, sourceFamilyMatch[1], value);
  }
}

function ensureRecord(target: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = asRecord(target[key]);
  if (existing) return existing;
  const next: Record<string, unknown> = {};
  target[key] = next;
  return next;
}

function setSourceFamilyAvailable(
  target: Record<string, unknown>,
  familyId: string,
  value: boolean | string | null,
): void {
  if (!Array.isArray(target.sourceFamilies)) return;
  for (const item of target.sourceFamilies) {
    const record = asRecord(item);
    if (record?.familyId === familyId) {
      record.available = value;
      return;
    }
  }
}

function sourceFamilyAvailable(value: unknown, familyId: FeatureOnlySourceFamilyId): boolean | null {
  for (const item of readRecordArrayAt(value, ["sourceFamilies"])) {
    if (readStringAt(item, ["familyId"]) === familyId) {
      return readBooleanAt(item, ["available"]);
    }
  }
  return null;
}

function sourceFamilyIds(value: unknown | null): string[] {
  return readRecordArrayAt(value, ["sourceFamilies"])
    .map((item) => readStringAt(item, ["familyId"]))
    .filter((familyId): familyId is string => familyId !== null);
}

function cloneRecord(value: unknown | null): Record<string, unknown> | null {
  if (!asRecord(value)) return null;
  const cloned = JSON.parse(JSON.stringify(value));
  return asRecord(cloned);
}

function safeBoundary(): R1160R1159FeatureOnlySafeConfirmationTranscriptionProofOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    answerSheetValuesStored: false,
    availabilityConfirmationPathStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    confirmationValuesStoredByR1160: false,
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
    rowLevelDataAcceptedByR1160: false,
    rowOwnerProvidedValuesStored: false,
    rowParsingPerformedByR1160: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
    transcribedConfirmationPersisted: false,
  };
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const result = readAt(value, pathParts);
  return typeof result === "string" ? result : null;
}

function readStringArrayAt(value: unknown, pathParts: readonly string[]): string[] {
  const result = readAt(value, pathParts);
  return Array.isArray(result) ? result.filter((item): item is string => typeof item === "string") : [];
}

function readBooleanAt(value: unknown, pathParts: readonly string[]): boolean | null {
  const result = readAt(value, pathParts);
  return typeof result === "boolean" ? result : null;
}

function readNumberAt(value: unknown, pathParts: readonly string[]): number | null {
  const result = readAt(value, pathParts);
  return typeof result === "number" && Number.isFinite(result) ? result : null;
}

function readRecordArrayAt(value: unknown, pathParts: readonly string[]): Array<Record<string, unknown>> {
  const result = readAt(value, pathParts);
  return Array.isArray(result)
    ? result.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => item !== null)
    : [];
}

function readAt(value: unknown, pathParts: readonly string[]): unknown {
  let current: unknown = value;
  for (const part of pathParts) {
    const record = asRecord(current);
    if (!record || !(part in record)) return undefined;
    current = record[part];
  }
  return current;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactStringSet(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && expected.every((item) => actual.includes(item));
}

function isMissingFileError(error: unknown): boolean {
  return asRecord(error)?.code === "ENOENT";
}

function formatFindingCount(findings: string[]): string {
  return `${findings.length} finding${findings.length === 1 ? "" : "s"}`;
}

async function main(): Promise<void> {
  const runResult = await runR1160R1159FeatureOnlySafeConfirmationTranscriptionProof({
    featureOnlyTemplatePath: process.env.MURPH_AGE_R1150_FEATURE_ONLY_SAFE_AVAILABILITY_CONFIRMATION_TEMPLATE_PATH,
    r1159Path: process.env.MURPH_AGE_R1159_ORDINARY_CONSUMER_SAFE_CONFIRMATION_ANSWER_SHEET_PATH,
  });
  const packet = runResult.output;
  const safeCliSummary = {
    ...packet.summary,
    packetId: packet.packetId,
    productDisplayAuthorized: packet.productDisplayAuthorized,
    rowParsingPerformedByR1160: packet.summary.rowParsingPerformedByR1160,
    schemaVersion: packet.schemaVersion,
    status: packet.status,
  };
  console.log(JSON.stringify(safeCliSummary, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1160 transcription proof failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
