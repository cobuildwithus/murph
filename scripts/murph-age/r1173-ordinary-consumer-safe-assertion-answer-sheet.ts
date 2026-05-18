import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1167_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_FILL_GUIDE_SCHEMA_VERSION,
  R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND,
} from "./r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide.ts";
import {
  R1172_ORDINARY_CONSUMER_SAFE_ASSERTION_MATERIALIZER_SCHEMA_VERSION,
  R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND,
} from "./r1172-ordinary-consumer-safe-assertion-materializer.ts";

export const R1173_ORDINARY_CONSUMER_SAFE_ASSERTION_ANSWER_SHEET_SCHEMA_VERSION =
  "murph-age-r1173-ordinary-consumer-safe-assertion-answer-sheet.v1" as const;
export const R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1173-ordinary-consumer-safe-assertion-answer-sheet.ts" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME =
  "r1173-ordinary-consumer-safe-assertion-answer-sheet.latest.json";
const FILLABLE_ANSWER_SHEET_FILE_NAME =
  "r1173-fillable-ordinary-consumer-safe-assertion-answer-sheet.json" as const;
const R1167_ARTIFACT =
  "r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide.latest.json" as const;
const R1172_ARTIFACT =
  "r1172-ordinary-consumer-safe-assertion-materializer.latest.json" as const;
const R1167_PACKET_ID =
  "r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide" as const;
const R1172_PACKET_ID =
  "r1172-ordinary-consumer-safe-assertion-materializer" as const;
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
const BLOCKED_ASSERTION_CONTENT = [
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
type BlockedAssertionContentId = typeof BLOCKED_ASSERTION_CONTENT[number];
type AllowedValueKindId = typeof ALLOWED_VALUE_KIND_IDS[number];
type AnswerSheetConclusion =
  | "ordinary_safe_assertion_answer_sheet_ready_non_evidence"
  | "ordinary_safe_assertion_answer_sheet_waiting_on_r1167_fill_guide"
  | "ordinary_safe_assertion_answer_sheet_waiting_on_r1172_materializer";
type AnswerSheetNextAction =
  | "refresh_r1167_safe_assertion_fill_guide"
  | "refresh_r1172_safe_assertion_materializer"
  | "rerun_r1172_with_row_owner_feature_only_safe_assertion_confirmation";

interface ArtifactSummary {
  artifact: string;
  packetId?: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface SafeAssertionAnswer {
  answerId: string;
  fieldPath: SafeFieldEditPath;
  mapsToSourceFamilyIds: Array<FeatureOnlySourceFamilyId | OptionalAddOnFamilyId>;
  privateDetailsStored: false;
  safePrompt: string;
  safeSetTo: true;
  setOnlyIf: string;
}

interface SubmitterInputKind {
  inputKindId:
    | RequiredInputKindId
    | "optional_common_bloodwork_or_vitals_context";
  mapsToSourceFamilyIds: Array<FeatureOnlySourceFamilyId | OptionalAddOnFamilyId>;
  privateDetailsStored: false;
  requiredForFeatureOnlyPreferredPair: boolean;
  safeSubmitterExample: string;
}

export interface R1173OrdinaryConsumerSafeAssertionAnswerSheetOptions {
  createdAt?: string;
  outputDir?: string;
  r1167Path?: string;
  r1172Path?: string;
}

export interface R1173OrdinaryConsumerSafeAssertionAnswerSheetOutput {
  artifactBoundary: {
    aggregateOnly: true;
    answerSheetTemplatePathStored: false;
    assertionValuesStoredByR1173: false;
    codebookTextStored: false;
    coefficientsStored: false;
    fileNamesStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelEvidencePromotedByR1173: false;
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
    rowLevelDataAcceptedByR1173: false;
    rowOwnerAssertionInferredByR1173: false;
    rowOwnerPrivateValuesStored: false;
    rowOwnerProvidedValuesStored: false;
    rowParsingPerformedByR1173: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: {
    r1167FillGuide: ArtifactSummary;
    r1172Materializer: ArtifactSummary;
  };
  packetId: "r1173-ordinary-consumer-safe-assertion-answer-sheet";
  productDisplayAuthorized: false;
  rowOwnerAnswerSheet: {
    answerSheetRole: "answer_sheet_only_not_assertion_not_model_evidence";
    answerSheetTemplateArtifact: typeof FILLABLE_ANSWER_SHEET_FILE_NAME;
    allowedValueKindIds: AllowedValueKindId[];
    audience: "ordinary_submitter_roughly_16_50_row_owner";
    blockedAssertionContent: BlockedAssertionContentId[];
    commands: {
      safeAssertionAnswerSheetCommand: typeof R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND;
      safeAssertionFillGuideCommand: typeof R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND;
      safeAssertionMaterializerCommand: typeof R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND;
    };
    exactSafeAnswers: SafeAssertionAnswer[];
    fixedSafeAssertionValues: {
      targetAgeBand: typeof TARGET_AGE_BAND;
      targetInputPriority: typeof TARGET_INPUT_PRIORITY;
    };
    materializerExplicitConfirmationRequired: true;
    minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    optionalAddOnInputKinds: SubmitterInputKind[];
    privateDetailsStored: false;
    readyForR1172MaterializerConfirmation: boolean;
    requiredAssertionChecklistIds: RequiredAssertionChecklistId[];
    requiredAttestationKeys: RequiredAttestationKey[];
    requiredInputKinds: SubmitterInputKind[];
    rowLevelDataAcceptedByR1173: false;
    rowOwnerProvidedValuesStored: false;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
  schemaVersion: typeof R1173_ORDINARY_CONSUMER_SAFE_ASSERTION_ANSWER_SHEET_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    allowedValueKindIds: AllowedValueKindId[];
    answerSheetReadyForRowOwner: boolean;
    blockedAssertionContentIds: BlockedAssertionContentId[];
    conclusion: AnswerSheetConclusion;
    exactSafeAnswerCount: number;
    fillGuideReadyForRowOwnerFill: boolean;
    materializerExplicitConfirmationRequired: true;
    materializerReady: boolean;
    minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    nextAction: AnswerSheetNextAction;
    optionalAddOnFamilyIds: OptionalAddOnFamilyId[];
    productDisplayAuthorized: false;
    requiredAssertionChecklistIds: RequiredAssertionChecklistId[];
    requiredInputKindIds: RequiredInputKindId[];
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1173: false;
    rowOwnerAssertionInferredByR1173: false;
    rowOwnerPrivateValuesStored: false;
    rowOwnerProvidedValuesStored: false;
    rowParsingPerformedByR1173: false;
    safeFieldEditCount: number;
    safeFieldEditPaths: SafeFieldEditPath[];
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
}

export async function runR1173OrdinaryConsumerSafeAssertionAnswerSheet(
  options: R1173OrdinaryConsumerSafeAssertionAnswerSheetOptions = {},
): Promise<{
  answerSheetTemplatePath: string;
  output: R1173OrdinaryConsumerSafeAssertionAnswerSheetOutput;
  outputPath: string;
}> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const r1167Path = options.r1167Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1167_ARTIFACT);
  const r1172Path = options.r1172Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1172_ARTIFACT);
  const r1167 = await readJsonIfPresent(r1167Path);
  const r1172 = await readJsonIfPresent(r1172Path);
  validateInputBoundary("r1167FillGuide", r1167);
  validateInputBoundary("r1172Materializer", r1172);

  const fillGuideReady = matchesR1167FillGuide(r1167);
  const materializerReady = matchesR1172Materializer(r1172);
  const answerSheetReadyForRowOwner = fillGuideReady && materializerReady;
  const conclusion = conclusionFor({ fillGuideReady, materializerReady });
  const exactSafeAnswers = answerSheetReadyForRowOwner ? safeAnswers() : [];
  const answerSheet = answerSheetFor({
    answerSheetReadyForRowOwner,
    exactSafeAnswers,
  });
  const output: R1173OrdinaryConsumerSafeAssertionAnswerSheetOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: {
      r1167FillGuide: summarizeArtifact(r1167, R1167_ARTIFACT),
      r1172Materializer: summarizeArtifact(r1172, R1172_ARTIFACT),
    },
    packetId: "r1173-ordinary-consumer-safe-assertion-answer-sheet",
    productDisplayAuthorized: false,
    rowOwnerAnswerSheet: answerSheet,
    schemaVersion: R1173_ORDINARY_CONSUMER_SAFE_ASSERTION_ANSWER_SHEET_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      allowedValueKindIds: [...ALLOWED_VALUE_KIND_IDS],
      answerSheetReadyForRowOwner,
      blockedAssertionContentIds: [...BLOCKED_ASSERTION_CONTENT],
      conclusion,
      exactSafeAnswerCount: exactSafeAnswers.length,
      fillGuideReadyForRowOwnerFill: fillGuideReady,
      materializerExplicitConfirmationRequired: true,
      materializerReady,
      minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      nextAction: nextActionFor({ fillGuideReady, materializerReady }),
      optionalAddOnFamilyIds: [...OPTIONAL_ADD_ON_FAMILY_IDS],
      productDisplayAuthorized: false,
      requiredAssertionChecklistIds: [...REQUIRED_ASSERTION_CHECKLIST_IDS],
      requiredInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1173: false,
      rowOwnerAssertionInferredByR1173: false,
      rowOwnerPrivateValuesStored: false,
      rowOwnerProvidedValuesStored: false,
      rowParsingPerformedByR1173: false,
      safeFieldEditCount: exactSafeAnswers.length,
      safeFieldEditPaths: answerSheetReadyForRowOwner ? [...SAFE_FIELD_EDIT_PATHS] : [],
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };

  const forbidden = findForbiddenAggregateEgress(output);
  if (forbidden.length > 0) {
    throw new Error(`R1173 output failed aggregate boundary: ${forbidden.join(",")}`);
  }
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  const answerSheetTemplatePath = path.join(outputDir, FILLABLE_ANSWER_SHEET_FILE_NAME);
  await Promise.all([
    writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`),
    writeFile(answerSheetTemplatePath, `${JSON.stringify(answerSheet, null, 2)}\n`),
  ]);
  return { answerSheetTemplatePath, output, outputPath };
}

function answerSheetFor(input: {
  answerSheetReadyForRowOwner: boolean;
  exactSafeAnswers: SafeAssertionAnswer[];
}): R1173OrdinaryConsumerSafeAssertionAnswerSheetOutput["rowOwnerAnswerSheet"] {
  return {
    answerSheetRole: "answer_sheet_only_not_assertion_not_model_evidence",
    answerSheetTemplateArtifact: FILLABLE_ANSWER_SHEET_FILE_NAME,
    allowedValueKindIds: [...ALLOWED_VALUE_KIND_IDS],
    audience: "ordinary_submitter_roughly_16_50_row_owner",
    blockedAssertionContent: [...BLOCKED_ASSERTION_CONTENT],
    commands: {
      safeAssertionAnswerSheetCommand: R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND,
      safeAssertionFillGuideCommand: R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND,
      safeAssertionMaterializerCommand: R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND,
    },
    exactSafeAnswers: input.exactSafeAnswers,
    fixedSafeAssertionValues: {
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
    materializerExplicitConfirmationRequired: true,
    minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
    modelEvidencePromotionAllowed: false,
    optionalAddOnInputKinds: optionalInputKinds(),
    privateDetailsStored: false,
    readyForR1172MaterializerConfirmation: input.answerSheetReadyForRowOwner,
    requiredAssertionChecklistIds: [...REQUIRED_ASSERTION_CHECKLIST_IDS],
    requiredAttestationKeys: [...REQUIRED_ATTESTATION_KEYS],
    requiredInputKinds: requiredInputKinds(),
    rowLevelDataAcceptedByR1173: false,
    rowOwnerProvidedValuesStored: false,
    targetAgeBand: TARGET_AGE_BAND,
    targetInputPriority: TARGET_INPUT_PRIORITY,
  };
}

function safeAnswers(): SafeAssertionAnswer[] {
  return SAFE_FIELD_EDIT_PATHS.map((fieldPath) => ({
    answerId: answerIdFor(fieldPath),
    fieldPath,
    mapsToSourceFamilyIds: sourceFamiliesFor(fieldPath),
    privateDetailsStored: false,
    safePrompt: safePromptFor(fieldPath),
    safeSetTo: true,
    setOnlyIf: setOnlyIfFor(fieldPath),
  }));
}

function answerIdFor(fieldPath: SafeFieldEditPath): string {
  return fieldPath
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function sourceFamiliesFor(fieldPath: SafeFieldEditPath): Array<FeatureOnlySourceFamilyId | OptionalAddOnFamilyId> {
  if (fieldPath.includes("bloodwork_glycemia")) return ["bloodwork_glycemia"];
  if (fieldPath.includes("wearable_activity_daily")) return ["wearable_activity_daily"];
  if (fieldPath.includes("common_bloodwork_core")) return ["common_bloodwork_core"];
  if (fieldPath.includes("vitals_body_context")) return ["vitals_body_context"];
  return [...FEATURE_ONLY_SOURCE_FAMILY_IDS];
}

function safePromptFor(fieldPath: SafeFieldEditPath): string {
  if (fieldPath === "sourceFamilies[bloodwork_glycemia].available") {
    return "Confirm you can provide a lab portal export or spreadsheet that includes glycemia bloodwork coverage, without giving Murph file names, headers, paths, rows, or values in this answer sheet.";
  }
  if (fieldPath === "sourceFamilies[wearable_activity_daily].available") {
    return "Confirm you can provide a phone, watch, or wearable activity export with daily activity coverage, without giving Murph file names, headers, paths, rows, or values in this answer sheet.";
  }
  if (fieldPath === "sourceFamilies[common_bloodwork_core].available") {
    return "Optionally confirm you can provide common bloodwork context, without giving Murph file names, headers, paths, rows, or values in this answer sheet.";
  }
  if (fieldPath === "sourceFamilies[vitals_body_context].available") {
    return "Optionally confirm you can provide basic vitals or body context, without giving Murph file names, headers, paths, rows, or values in this answer sheet.";
  }
  if (fieldPath === "rowOwnerAssertionsConfirmed") {
    return "Confirm the row owner is making these feature-only availability assertions explicitly.";
  }
  if (fieldPath === "privateContentExcluded") {
    return "Confirm this assertion excludes private paths, headers, filenames, row values, identifiers, source text, predictions, coefficients, and small cells.";
  }
  return `Confirm ${fieldPath} is true for the feature-only safe assertion.`;
}

function setOnlyIfFor(fieldPath: SafeFieldEditPath): string {
  if (fieldPath === "sourceFamilies[bloodwork_glycemia].available") {
    return "Only if a lab portal export or spreadsheet for glycemia bloodwork is available to the row owner.";
  }
  if (fieldPath === "sourceFamilies[wearable_activity_daily].available") {
    return "Only if a phone, watch, or wearable activity export is available to the row owner.";
  }
  if (fieldPath === "sourceFamilies[common_bloodwork_core].available") {
    return "Only if optional common bloodwork context is already available to the row owner.";
  }
  if (fieldPath === "sourceFamilies[vitals_body_context].available") {
    return "Only if optional vitals or body context is already available to the row owner.";
  }
  if (fieldPath === "rowOwnerAssertionsConfirmed") {
    return "Only after the row owner has explicitly reviewed and confirmed the safe assertion.";
  }
  if (fieldPath === "privateContentExcluded") {
    return "Only if this answer sheet and the materialized assertion contain no private data values or identifiers.";
  }
  return "Only if the row owner confirms this aggregate-only privacy attestation is true.";
}

function requiredInputKinds(): SubmitterInputKind[] {
  return [
    {
      inputKindId: "lab_portal_export_or_spreadsheet",
      mapsToSourceFamilyIds: ["bloodwork_glycemia"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: true,
      safeSubmitterExample: "A normal lab portal CSV/PDF-derived spreadsheet or manually prepared spreadsheet with glycemia bloodwork coverage, handled only in the row owner's local workspace.",
    },
    {
      inputKindId: "phone_watch_or_wearable_activity_export",
      mapsToSourceFamilyIds: ["wearable_activity_daily"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: true,
      safeSubmitterExample: "A phone, watch, or wearable daily activity export, handled only in the row owner's local workspace.",
    },
  ];
}

function optionalInputKinds(): SubmitterInputKind[] {
  return [
    {
      inputKindId: "optional_common_bloodwork_or_vitals_context",
      mapsToSourceFamilyIds: [
        "common_bloodwork_core",
        "vitals_body_context",
      ],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: false,
      safeSubmitterExample: "Optional common bloodwork or basic vitals/body context if the row owner already has it locally.",
    },
  ];
}

function conclusionFor(input: {
  fillGuideReady: boolean;
  materializerReady: boolean;
}): AnswerSheetConclusion {
  if (!input.fillGuideReady) return "ordinary_safe_assertion_answer_sheet_waiting_on_r1167_fill_guide";
  if (!input.materializerReady) return "ordinary_safe_assertion_answer_sheet_waiting_on_r1172_materializer";
  return "ordinary_safe_assertion_answer_sheet_ready_non_evidence";
}

function nextActionFor(input: {
  fillGuideReady: boolean;
  materializerReady: boolean;
}): AnswerSheetNextAction {
  if (!input.fillGuideReady) return "refresh_r1167_safe_assertion_fill_guide";
  if (!input.materializerReady) return "refresh_r1172_safe_assertion_materializer";
  return "rerun_r1172_with_row_owner_feature_only_safe_assertion_confirmation";
}

function matchesR1167FillGuide(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1167_PACKET_ID
    && readStringAt(value, ["schemaVersion"])
      === R1167_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_FILL_GUIDE_SCHEMA_VERSION
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(value, ["artifactBoundary", "rowLevelDataAcceptedByR1167"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowParsingPerformedByR1167"]) === false
    && readBooleanAt(value, ["summary", "guideReadyForRowOwnerFill"]) === true
    && readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1167"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["summary", "rowParsingPerformedByR1167"]) === false
    && arraysEqual(readStringArrayAt(value, ["summary", "allowedValueKinds"]), ALLOWED_VALUE_KIND_IDS)
    && arraysEqual(readStringArrayAt(value, ["summary", "minimumFeaturePairRequired"]), FEATURE_ONLY_SOURCE_FAMILY_IDS)
    && arraysEqual(readStringArrayAt(value, ["summary", "requiredInputKindIds"]), REQUIRED_INPUT_KIND_IDS)
    && arraysEqual(readStringArrayAt(value, ["summary", "safeFieldEditPaths"]), SAFE_FIELD_EDIT_PATHS)
    && readNumberAt(value, ["summary", "safeFieldEditCount"]) === SAFE_FIELD_EDIT_PATHS.length
    && readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["summary", "reviewGptRequiredNow"]) === false;
}

function matchesR1172Materializer(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1172_PACKET_ID
    && readStringAt(value, ["schemaVersion"])
      === R1172_ORDINARY_CONSUMER_SAFE_ASSERTION_MATERIALIZER_SCHEMA_VERSION
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(value, ["artifactBoundary", "assertionFileWrittenOnlyAfterExplicitAssertion"]) === true
    && readBooleanAt(value, ["artifactBoundary", "assertionValuesStoredInR1172Packet"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowLevelDataAcceptedByR1172"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerAssertionInferredByR1172"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowParsingPerformedByR1172"]) === false
    && readStringAt(value, ["materializer", "materializerCommand"]) === R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND
    && arraysEqual(readStringArrayAt(value, ["materializer", "allowedValueKindIds"]), ALLOWED_VALUE_KIND_IDS)
    && arraysEqual(readStringArrayAt(value, ["summary", "allowedValueKindIds"]), ALLOWED_VALUE_KIND_IDS)
    && arraysEqual(readStringArrayAt(value, ["summary", "blockedContentIds"]), BLOCKED_ASSERTION_CONTENT)
    && readBooleanAt(value, ["materializer", "rowLevelDataAcceptedByR1172"]) === false
    && readBooleanAt(value, ["materializer", "rowOwnerPrivateValuesStored"]) === false
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

function validateInputBoundary(label: string, value: unknown | null): void {
  if (value === null) return;
  const forbidden = findForbiddenAggregateEgress(value);
  if (forbidden.length > 0) {
    throw new Error(`${label} failed aggregate boundary: ${forbidden.join(",")}`);
  }
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function safeBoundary(): R1173OrdinaryConsumerSafeAssertionAnswerSheetOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    answerSheetTemplatePathStored: false,
    assertionValuesStoredByR1173: false,
    codebookTextStored: false,
    coefficientsStored: false,
    fileNamesStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelEvidencePromotedByR1173: false,
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
    rowLevelDataAcceptedByR1173: false,
    rowOwnerAssertionInferredByR1173: false,
    rowOwnerPrivateValuesStored: false,
    rowOwnerProvidedValuesStored: false,
    rowParsingPerformedByR1173: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readAt(value: unknown, pathSegments: string[]): unknown {
  let cursor = value;
  for (const segment of pathSegments) {
    if (!isRecord(cursor)) return null;
    cursor = cursor[segment];
  }
  return cursor;
}

function readStringAt(value: unknown, pathSegments: string[]): string | null {
  const result = readAt(value, pathSegments);
  return typeof result === "string" ? result : null;
}

function readBooleanAt(value: unknown, pathSegments: string[]): boolean | null {
  const result = readAt(value, pathSegments);
  return typeof result === "boolean" ? result : null;
}

function readNumberAt(value: unknown, pathSegments: string[]): number | null {
  const result = readAt(value, pathSegments);
  return typeof result === "number" ? result : null;
}

function readStringArrayAt(value: unknown, pathSegments: string[]): string[] {
  const result = readAt(value, pathSegments);
  return Array.isArray(result) && result.every((item) => typeof item === "string")
    ? result
    : [];
}

function arraysEqual(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

async function main(): Promise<void> {
  const { output } = await runR1173OrdinaryConsumerSafeAssertionAnswerSheet({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1167Path: process.env.MURPH_AGE_R1167_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_FILL_GUIDE_PATH,
    r1172Path: process.env.MURPH_AGE_R1172_ORDINARY_CONSUMER_SAFE_ASSERTION_MATERIALIZER_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    allowedValueKindIds: output.summary.allowedValueKindIds,
    answerSheetReadyForRowOwner: output.summary.answerSheetReadyForRowOwner,
    answerSheetTemplateArtifact: output.rowOwnerAnswerSheet.answerSheetTemplateArtifact,
    blockedAssertionContentIds: output.summary.blockedAssertionContentIds,
    conclusion: output.summary.conclusion,
    exactSafeAnswerCount: output.summary.exactSafeAnswerCount,
    fillGuideReadyForRowOwnerFill: output.summary.fillGuideReadyForRowOwnerFill,
    materializerExplicitConfirmationRequired: output.summary.materializerExplicitConfirmationRequired,
    materializerReady: output.summary.materializerReady,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    schemaVersion: output.schemaVersion,
  }, null, 2)}\n`);
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1173 safe assertion answer sheet failed.")}\n`);
    process.exitCode = 1;
  });
}
