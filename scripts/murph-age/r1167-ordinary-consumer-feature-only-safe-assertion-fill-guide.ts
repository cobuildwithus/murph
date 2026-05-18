import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1165_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_RUNNER_SCHEMA_VERSION,
  R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_SCHEMA_VERSION,
  R1165_SAFE_ASSERTION_RUNNER_COMMAND,
} from "./r1165-ordinary-consumer-feature-only-safe-assertion-runner.ts";

export const R1167_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_FILL_GUIDE_SCHEMA_VERSION =
  "murph-age-r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide.v1" as const;
export const R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide.ts" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME =
  "r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide.latest.json";
const R1165_RUNNER_FILE_NAME =
  "r1165-ordinary-consumer-feature-only-safe-assertion-runner.latest.json" as const;
const R1165_TEMPLATE_FILE_NAME =
  "r1165-row-owner-feature-only-safe-assertion.template.json" as const;
const R1165_PACKET_ID = "r1165-ordinary-consumer-feature-only-safe-assertion-runner" as const;
const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first" as const;
const TARGET_AGE_BAND = "roughly_16_50" as const;
const FEATURE_ONLY_SOURCE_FAMILY_IDS = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
] as const;
const REQUIRED_INPUT_KIND_IDS = [
  "lab_portal_export_or_spreadsheet",
  "phone_watch_or_wearable_activity_export",
] as const;
const OPTIONAL_ADD_ON_FAMILY_IDS = [
  "common_bloodwork_core",
  "vitals_body_context",
] as const;
const OPTIONAL_ADD_ON_INPUT_KIND_ID = "optional_common_bloodwork_or_vitals_context" as const;
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
const BLOCKED_PRIVATE_CONTENT_IDS = [
  "private_paths",
  "header_names",
  "file_names",
  "row_values",
  "participant_identifiers",
  "private_ref_values",
  "source_variable_names",
  "predictions",
  "coefficients",
  "source_text",
  "small_cells",
] as const;

type FeatureOnlySourceFamilyId = typeof FEATURE_ONLY_SOURCE_FAMILY_IDS[number];
type RequiredInputKindId = typeof REQUIRED_INPUT_KIND_IDS[number];
type OptionalAddOnFamilyId = typeof OPTIONAL_ADD_ON_FAMILY_IDS[number];
type SafeAssertionSourceFamilyId = FeatureOnlySourceFamilyId | OptionalAddOnFamilyId;
type RequiredAssertionChecklistId = typeof REQUIRED_ASSERTION_CHECKLIST_IDS[number];
type RequiredAttestationKey = typeof REQUIRED_ATTESTATION_KEYS[number];
type SafeFieldEditPath = typeof SAFE_FIELD_EDIT_PATHS[number];
type BlockedPrivateContentId = typeof BLOCKED_PRIVATE_CONTENT_IDS[number];
type FillGuideConclusion =
  | "ordinary_feature_only_safe_assertion_fill_guide_ready"
  | "ordinary_feature_only_safe_assertion_fill_guide_waiting_on_r1165_runner"
  | "ordinary_feature_only_safe_assertion_fill_guide_waiting_on_r1165_template";
type FillGuideNextAction =
  | "fill_r1165_row_owner_feature_only_safe_assertion_template"
  | "refresh_r1165_safe_assertion_runner";

interface ArtifactSummary {
  artifact: string;
  packetId?: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface SafeFieldEdit {
  fieldPath: SafeFieldEditPath;
  privateDetailsStored: false;
  setOnlyIf: string;
  setTo: boolean;
}

interface SubmitterInputKind {
  inputKindId: RequiredInputKindId | typeof OPTIONAL_ADD_ON_INPUT_KIND_ID;
  mapsToSourceFamilyIds: Array<FeatureOnlySourceFamilyId | OptionalAddOnFamilyId>;
  privateDetailsStored: false;
  requiredForFeatureOnlyPreferredPair: boolean;
  safeAvailabilityQuestion: string;
}

export interface R1167OrdinaryConsumerFeatureOnlySafeAssertionFillGuideOptions {
  createdAt?: string;
  outputDir?: string;
  r1165Path?: string;
  r1165TemplatePath?: string;
}

export interface R1167OrdinaryConsumerFeatureOnlySafeAssertionFillGuideOutput {
  artifactBoundary: {
    aggregateOnly: true;
    assertionValuesStoredByR1167: false;
    codebookTextStored: false;
    coefficientsStored: false;
    fileNamesStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelEvidencePromotedByR1167: false;
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
    rowLevelDataAcceptedByR1167: false;
    rowOwnerAssertionInferredByR1167: false;
    rowOwnerPrivateValuesStored: false;
    rowParsingPerformedByR1167: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  fillGuide: {
    allowedValueKinds: ["booleans_only", "fixed_enumerated_ids_only"];
    blockedPrivateContentIds: BlockedPrivateContentId[];
    commands: {
      fillGuideCommand: typeof R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND;
      safeAssertionRunnerCommand: typeof R1165_SAFE_ASSERTION_RUNNER_COMMAND;
    };
    minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
    optionalAddOnFamilyIds: OptionalAddOnFamilyId[];
    privateDetailsStored: false;
    requiredAssertionChecklistIds: RequiredAssertionChecklistId[];
    requiredAttestationKeys: RequiredAttestationKey[];
    requiredInputKindIds: RequiredInputKindId[];
    safeFieldEditPaths: SafeFieldEditPath[];
    safeFieldEdits: SafeFieldEdit[];
    submitterInputKinds: SubmitterInputKind[];
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
  inputArtifacts: {
    r1165Runner: ArtifactSummary;
    r1165Template: ArtifactSummary;
  };
  packetId: "r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1167_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_FILL_GUIDE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    allowedValueKinds: ["booleans_only", "fixed_enumerated_ids_only"];
    blockedPrivateContentIds: BlockedPrivateContentId[];
    conclusion: FillGuideConclusion;
    guideReadyForRowOwnerFill: boolean;
    minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    nextAction: FillGuideNextAction;
    optionalAddOnFamilyIds: OptionalAddOnFamilyId[];
    productDisplayAuthorized: false;
    requiredAssertionChecklistIds: RequiredAssertionChecklistId[];
    requiredInputKindIds: RequiredInputKindId[];
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1167: false;
    rowOwnerAssertionInferredByR1167: false;
    rowOwnerPrivateValuesStored: false;
    rowParsingPerformedByR1167: false;
    safeFieldEditCount: number;
    safeFieldEditPaths: SafeFieldEditPath[];
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
}

export async function runR1167OrdinaryConsumerFeatureOnlySafeAssertionFillGuide(
  options: R1167OrdinaryConsumerFeatureOnlySafeAssertionFillGuideOptions = {},
): Promise<{ output: R1167OrdinaryConsumerFeatureOnlySafeAssertionFillGuideOutput; outputPath: string }> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const r1165Path = options.r1165Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1165_RUNNER_FILE_NAME);
  const templatePath = options.r1165TemplatePath ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1165_TEMPLATE_FILE_NAME);
  const r1165 = await readJsonIfPresent(r1165Path);
  const template = await readJsonIfPresent(templatePath);
  validateInputBoundary("r1165Runner", r1165);
  validateInputBoundary("r1165Template", template);

  const r1165Ready = matchesR1165Runner(r1165);
  const templateReady = matchesR1165Template(template);
  const conclusion = conclusionFor({ r1165Ready, templateReady });
  const guideReadyForRowOwnerFill = conclusion === "ordinary_feature_only_safe_assertion_fill_guide_ready";
  const nextAction = guideReadyForRowOwnerFill
    ? "fill_r1165_row_owner_feature_only_safe_assertion_template"
    : "refresh_r1165_safe_assertion_runner";

  const output: R1167OrdinaryConsumerFeatureOnlySafeAssertionFillGuideOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    fillGuide: {
      allowedValueKinds: ["booleans_only", "fixed_enumerated_ids_only"],
      blockedPrivateContentIds: [...BLOCKED_PRIVATE_CONTENT_IDS],
      commands: {
        fillGuideCommand: R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND,
        safeAssertionRunnerCommand: R1165_SAFE_ASSERTION_RUNNER_COMMAND,
      },
      minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      optionalAddOnFamilyIds: [...OPTIONAL_ADD_ON_FAMILY_IDS],
      privateDetailsStored: false,
      requiredAssertionChecklistIds: [...REQUIRED_ASSERTION_CHECKLIST_IDS],
      requiredAttestationKeys: [...REQUIRED_ATTESTATION_KEYS],
      requiredInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
      safeFieldEditPaths: [...SAFE_FIELD_EDIT_PATHS],
      safeFieldEdits: buildSafeFieldEdits(),
      submitterInputKinds: buildSubmitterInputKinds(),
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
    inputArtifacts: {
      r1165Runner: summarizeR1165Runner(r1165Ready),
      r1165Template: summarizeR1165Template(templateReady),
    },
    packetId: "r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide",
    productDisplayAuthorized: false,
    schemaVersion: R1167_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_FILL_GUIDE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      allowedValueKinds: ["booleans_only", "fixed_enumerated_ids_only"],
      blockedPrivateContentIds: [...BLOCKED_PRIVATE_CONTENT_IDS],
      conclusion,
      guideReadyForRowOwnerFill,
      minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      nextAction,
      optionalAddOnFamilyIds: [...OPTIONAL_ADD_ON_FAMILY_IDS],
      productDisplayAuthorized: false,
      requiredAssertionChecklistIds: [...REQUIRED_ASSERTION_CHECKLIST_IDS],
      requiredInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1167: false,
      rowOwnerAssertionInferredByR1167: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1167: false,
      safeFieldEditCount: SAFE_FIELD_EDIT_PATHS.length,
      safeFieldEditPaths: [...SAFE_FIELD_EDIT_PATHS],
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1167 safe assertion fill guide failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error: unknown) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

function validateInputBoundary(label: string, value: unknown | null): void {
  if (!value) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1167 rejected unsafe ${label} input: ${formatFindingCount(findings)}`);
  }
}

function conclusionFor(input: { r1165Ready: boolean; templateReady: boolean }): FillGuideConclusion {
  if (!input.r1165Ready) return "ordinary_feature_only_safe_assertion_fill_guide_waiting_on_r1165_runner";
  if (!input.templateReady) return "ordinary_feature_only_safe_assertion_fill_guide_waiting_on_r1165_template";
  return "ordinary_feature_only_safe_assertion_fill_guide_ready";
}

function matchesR1165Runner(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1165_PACKET_ID
    && readStringAt(value, ["schemaVersion"]) === R1165_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_RUNNER_SCHEMA_VERSION
    && readStringAt(value, ["summary", "assertionTemplateArtifact"]) === R1165_TEMPLATE_FILE_NAME
    && readStringAt(value, ["assertionRunner", "commands", "safeAssertionRunnerCommand"])
      === R1165_SAFE_ASSERTION_RUNNER_COMMAND
    && exactStringSet(readStringArrayAt(value, ["summary", "requiredInputKindIds"]), REQUIRED_INPUT_KIND_IDS)
    && exactStringSet(
      readStringArrayAt(value, ["summary", "requiredAssertionChecklistIds"]),
      REQUIRED_ASSERTION_CHECKLIST_IDS,
    )
    && readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1165"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerAssertionInferredByR1165"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["summary", "rowParsingPerformedByR1165"]) === false;
}

function matchesR1165Template(value: unknown | null): boolean {
  return safeAssertionTemplateShape(value)
    && readStringAt(value, ["schemaVersion"]) === R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_SCHEMA_VERSION
    && readStringAt(value, ["targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(value, ["targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && exactStringSet(readStringArrayAt(value, ["requiredInputKindIds"]), REQUIRED_INPUT_KIND_IDS)
    && FEATURE_ONLY_SOURCE_FAMILY_IDS.every((familyId) => sourceFamilyTemplatePresent(value, familyId))
    && OPTIONAL_ADD_ON_FAMILY_IDS.every((familyId) => sourceFamilyTemplatePresent(value, familyId))
    && REQUIRED_ATTESTATION_KEYS.every((key) => readBooleanAt(value, ["attestations", key]) === false)
    && readBooleanAt(value, ["privateContentExcluded"]) === false
    && readBooleanAt(value, ["rowOwnerAssertionsConfirmed"]) === false;
}

function safeAssertionTemplateShape(value: unknown | null): boolean {
  const record = asRecord(value);
  if (!record) return false;
  if (!onlyKeys(record, [
    "attestations",
    "privateContentExcluded",
    "requiredInputKindIds",
    "rowOwnerAssertionsConfirmed",
    "schemaVersion",
    "sourceFamilies",
    "targetAgeBand",
    "targetInputPriority",
  ])) {
    return false;
  }
  const attestations = asRecord(record.attestations);
  if (!attestations || !onlyKeys(attestations, REQUIRED_ATTESTATION_KEYS)) return false;
  const sourceFamilies = readRecordArrayAt(record, ["sourceFamilies"]);
  const familyIds = sourceFamilies.map((family) => readStringAt(family, ["familyId"]));
  return sourceFamilies.length === FEATURE_ONLY_SOURCE_FAMILY_IDS.length + OPTIONAL_ADD_ON_FAMILY_IDS.length
    && sourceFamilies.every((family) => onlyKeys(family, ["available", "familyId", "inputKindId"]))
    && familyIds.every(isSafeAssertionSourceFamilyId)
    && new Set(familyIds).size === familyIds.length;
}

function sourceFamilyTemplatePresent(value: unknown, familyId: SafeAssertionSourceFamilyId): boolean {
  const inputKindId = inputKindIdForSourceFamily(familyId);
  return readRecordArrayAt(value, ["sourceFamilies"]).some((family) =>
    readStringAt(family, ["familyId"]) === familyId
    && readStringAt(family, ["inputKindId"]) === inputKindId
    && readBooleanAt(family, ["available"]) === false
  );
}

function inputKindIdForSourceFamily(familyId: SafeAssertionSourceFamilyId): RequiredInputKindId | typeof OPTIONAL_ADD_ON_INPUT_KIND_ID {
  if (familyId === "bloodwork_glycemia") return "lab_portal_export_or_spreadsheet";
  if (familyId === "wearable_activity_daily") return "phone_watch_or_wearable_activity_export";
  return OPTIONAL_ADD_ON_INPUT_KIND_ID;
}

function isSafeAssertionSourceFamilyId(value: string | null): value is SafeAssertionSourceFamilyId {
  return value === "bloodwork_glycemia"
    || value === "wearable_activity_daily"
    || value === "common_bloodwork_core"
    || value === "vitals_body_context";
}

function buildSafeFieldEdits(): SafeFieldEdit[] {
  return [
    {
      fieldPath: "sourceFamilies[bloodwork_glycemia].available",
      privateDetailsStored: false,
      setOnlyIf: "the row owner has a local lab portal export or spreadsheet with glycemia bloodwork available",
      setTo: true,
    },
    {
      fieldPath: "sourceFamilies[wearable_activity_daily].available",
      privateDetailsStored: false,
      setOnlyIf: "the row owner has a local phone, watch, or wearable daily activity export available",
      setTo: true,
    },
    {
      fieldPath: "sourceFamilies[common_bloodwork_core].available",
      privateDetailsStored: false,
      setOnlyIf: "the row owner already has local common bloodwork context available",
      setTo: true,
    },
    {
      fieldPath: "sourceFamilies[vitals_body_context].available",
      privateDetailsStored: false,
      setOnlyIf: "the row owner already has local vitals or body context available",
      setTo: true,
    },
    {
      fieldPath: "rowOwnerAssertionsConfirmed",
      privateDetailsStored: false,
      setOnlyIf: "the row owner can truthfully confirm all required feature-only assertions",
      setTo: true,
    },
    {
      fieldPath: "privateContentExcluded",
      privateDetailsStored: false,
      setOnlyIf: "the assertion file contains only the template booleans and fixed IDs",
      setTo: true,
    },
    ...REQUIRED_ATTESTATION_KEYS.map((key): SafeFieldEdit => ({
      fieldPath: `attestations.${key}`,
      privateDetailsStored: false,
      setOnlyIf: "the assertion file excludes the private content category named by this attestation",
      setTo: true,
    })),
  ];
}

function buildSubmitterInputKinds(): SubmitterInputKind[] {
  return [
    {
      inputKindId: "lab_portal_export_or_spreadsheet",
      mapsToSourceFamilyIds: ["bloodwork_glycemia"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: true,
      safeAvailabilityQuestion: "Can the row owner access a local glycemia bloodwork export without entering values here?",
    },
    {
      inputKindId: "phone_watch_or_wearable_activity_export",
      mapsToSourceFamilyIds: ["wearable_activity_daily"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: true,
      safeAvailabilityQuestion: "Can the row owner access a local daily activity export without entering values here?",
    },
    {
      inputKindId: OPTIONAL_ADD_ON_INPUT_KIND_ID,
      mapsToSourceFamilyIds: ["common_bloodwork_core", "vitals_body_context"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: false,
      safeAvailabilityQuestion:
        "Optional source-family slots for common bloodwork and vitals/body context can stay false unless the row owner already has those local exports.",
    },
  ];
}

function summarizeR1165Runner(ready: boolean): ArtifactSummary {
  return {
    artifact: R1165_RUNNER_FILE_NAME,
    packetId: ready ? R1165_PACKET_ID : null,
    schemaVersion: ready ? R1165_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_RUNNER_SCHEMA_VERSION : null,
    status: ready ? "available" : "missing",
  };
}

function summarizeR1165Template(ready: boolean): ArtifactSummary {
  return {
    artifact: R1165_TEMPLATE_FILE_NAME,
    schemaVersion: ready ? R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_SCHEMA_VERSION : null,
    status: ready ? "available" : "missing",
  };
}

function safeBoundary(): R1167OrdinaryConsumerFeatureOnlySafeAssertionFillGuideOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    assertionValuesStoredByR1167: false,
    codebookTextStored: false,
    coefficientsStored: false,
    fileNamesStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelEvidencePromotedByR1167: false,
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
    rowLevelDataAcceptedByR1167: false,
    rowOwnerAssertionInferredByR1167: false,
    rowOwnerPrivateValuesStored: false,
    rowParsingPerformedByR1167: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

function readStringAt(value: unknown, pathParts: string[]): string | null {
  const valueAtPath = readAt(value, pathParts);
  return typeof valueAtPath === "string" ? valueAtPath : null;
}

function readBooleanAt(value: unknown, pathParts: string[]): boolean | null {
  const valueAtPath = readAt(value, pathParts);
  return typeof valueAtPath === "boolean" ? valueAtPath : null;
}

function readStringArrayAt(value: unknown, pathParts: string[]): string[] {
  const valueAtPath = readAt(value, pathParts);
  return Array.isArray(valueAtPath)
    ? valueAtPath.filter((item): item is string => typeof item === "string")
    : [];
}

function readRecordArrayAt(value: unknown, pathParts: string[]): Array<Record<string, unknown>> {
  const valueAtPath = readAt(value, pathParts);
  return Array.isArray(valueAtPath)
    ? valueAtPath.flatMap((item) => {
      const record = asRecord(item);
      return record ? [record] : [];
    })
    : [];
}

function readAt(value: unknown, pathParts: string[]): unknown {
  let current: unknown = value;
  for (const part of pathParts) {
    const record = asRecord(current);
    if (!record) return null;
    current = record[part];
  }
  return current;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function onlyKeys(record: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const expected = new Set(expectedKeys);
  return Object.keys(record).every((key) => expected.has(key))
    && expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(record, key));
}

function exactStringSet(actual: string[], expectedValues: readonly string[]): boolean {
  if (actual.length !== expectedValues.length) return false;
  const expected = new Set(expectedValues);
  return actual.every((item) => expected.has(item));
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}

function formatFindingCount(findings: unknown[]): string {
  return `${findings.length} ${findings.length === 1 ? "finding" : "findings"}`;
}

function cliSummary(output: R1167OrdinaryConsumerFeatureOnlySafeAssertionFillGuideOutput): Record<string, unknown> {
  return {
    allowedValueKinds: output.summary.allowedValueKinds,
    blockedPrivateContentIds: output.summary.blockedPrivateContentIds,
    conclusion: output.summary.conclusion,
    guideReadyForRowOwnerFill: output.summary.guideReadyForRowOwnerFill,
    minimumFeaturePairRequired: output.summary.minimumFeaturePairRequired,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    requiredInputKindIds: output.summary.requiredInputKindIds,
    rowLevelDataAcceptedByR1167: output.summary.rowLevelDataAcceptedByR1167,
    rowOwnerAssertionInferredByR1167: output.summary.rowOwnerAssertionInferredByR1167,
    rowOwnerPrivateValuesStored: output.summary.rowOwnerPrivateValuesStored,
    rowParsingPerformedByR1167: output.summary.rowParsingPerformedByR1167,
    safeFieldEditCount: output.summary.safeFieldEditCount,
    schemaVersion: output.schemaVersion,
    targetAgeBand: output.summary.targetAgeBand,
    targetInputPriority: output.summary.targetInputPriority,
  };
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR1167OrdinaryConsumerFeatureOnlySafeAssertionFillGuide({
    outputDir: process.env.MURPH_AGE_R1167_OUTPUT_DIR,
    r1165Path: process.env.MURPH_AGE_R1165_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_RUNNER_PATH,
    r1165TemplatePath: process.env.MURPH_AGE_R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_TEMPLATE_PATH,
  }).then(({ output }) => {
    process.stdout.write(`${JSON.stringify(cliSummary(output), null, 2)}\n`);
  }).catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1167 safe assertion fill guide failed.")}\n`);
    process.exitCode = 1;
  });
}
