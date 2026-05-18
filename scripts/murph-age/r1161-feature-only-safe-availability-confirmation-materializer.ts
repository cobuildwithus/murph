import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1160_R1159_FEATURE_ONLY_SAFE_CONFIRMATION_TRANSCRIPTION_PROOF_SCHEMA_VERSION,
  R1160_TRANSCRIPTION_PROOF_COMMAND,
} from "./r1160-r1159-feature-only-safe-confirmation-transcription-proof.ts";

export const R1161_FEATURE_ONLY_SAFE_AVAILABILITY_CONFIRMATION_MATERIALIZER_SCHEMA_VERSION =
  "murph-age-r1161-feature-only-safe-availability-confirmation-materializer.v1" as const;
export const R1161_MATERIALIZER_COMMAND =
  "MURPH_AGE_R1161_ROW_OWNER_FEATURE_ONLY_CONFIRMATION_ASSERTIONS_CONFIRMED=true pnpm exec tsx scripts/murph-age/r1161-feature-only-safe-availability-confirmation-materializer.ts" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME =
  "r1161-feature-only-safe-availability-confirmation-materializer.latest.json";
const CONFIRMED_CONFIRMATION_FILE_NAME =
  "r1161-confirmed-feature-only-safe-availability-confirmation.json" as const;
const FEATURE_ONLY_TEMPLATE_FILE_NAME =
  "r1150-fillable-feature-only-safe-availability-confirmation.json" as const;
const FEATURE_ONLY_TEMPLATE_SCHEMA_VERSION =
  "murph-age-r1150-ordinary-consumer-safe-availability-confirmation.v1" as const;
const R1160_EXPECTED = {
  artifact: "r1160-r1159-feature-only-safe-confirmation-transcription-proof.latest.json",
  packetId: "r1160-r1159-feature-only-safe-confirmation-transcription-proof",
  schemaVersion: R1160_R1159_FEATURE_ONLY_SAFE_CONFIRMATION_TRANSCRIPTION_PROOF_SCHEMA_VERSION,
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
const REQUIRED_CONFIRMATION_FIELD_PATHS = [
  "aggregateReadinessFacts.targetAgeBand",
  "sourceFamilies[bloodwork_glycemia].available",
  "sourceFamilies[wearable_activity_daily].available",
  "rowOwnerAssertionsConfirmed",
  ...REQUIRED_ATTESTATION_KEYS.map((key) => `attestations.${key}`),
] as const;

type FeatureOnlySourceFamilyId = typeof FEATURE_ONLY_SOURCE_FAMILY_IDS[number];
type OptionalAddOnFamilyId = typeof OPTIONAL_ADD_ON_FAMILY_IDS[number];
type RequiredAttestationKey = typeof REQUIRED_ATTESTATION_KEYS[number];
type MaterializerConclusion =
  | "feature_only_safe_availability_confirmation_materialized"
  | "feature_only_safe_availability_confirmation_materializer_waiting_on_explicit_row_owner_confirmation"
  | "feature_only_safe_availability_confirmation_materializer_waiting_on_feature_only_template"
  | "feature_only_safe_availability_confirmation_materializer_waiting_on_r1160_transcription_proof";
type MaterializerNextAction =
  | "refresh_r1150_safe_availability_confirmation_template"
  | "refresh_r1160_transcription_proof"
  | "rerun_r1161_with_row_owner_feature_only_confirmation_assertion"
  | "run_r1150_intake_with_r1161_confirmed_feature_only_safe_availability_confirmation";

interface ArtifactSummary {
  artifact: string;
  packetId?: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface ReadInputsResult {
  featureOnlyTemplate: unknown | null;
  r1160: unknown | null;
}

export interface R1161FeatureOnlySafeAvailabilityConfirmationMaterializerOptions {
  createdAt?: string;
  featureOnlyTemplatePath?: string;
  outputDir?: string;
  r1160Path?: string;
  rowOwnerAssertionsConfirmed?: boolean;
}

export interface R1161FeatureOnlySafeAvailabilityConfirmationMaterializerOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    confirmationArtifactLocalPathStored: false;
    confirmationValuesStoredInR1161Packet: false;
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
    rowLevelDataAcceptedByR1161: false;
    rowOwnerPrivateValuesStored: false;
    rowParsingPerformedByR1161: false;
    rowValuesStored: false;
    safeConfirmationArtifactWrittenOnlyAfterExplicitAssertion: true;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: {
    featureOnlyTemplate: ArtifactSummary;
    r1160: ArtifactSummary;
  };
  materializer: {
    confirmedConfirmationArtifact: typeof CONFIRMED_CONFIRMATION_FILE_NAME | null;
    explicitRowOwnerConfirmationAssertionProvided: boolean;
    featureOnlyConfirmationWouldBeReadyForR1150: boolean;
    featureOnlyTemplateReady: boolean;
    materializerCommand: typeof R1161_MATERIALIZER_COMMAND;
    minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    optionalAddOnFamilyIds: OptionalAddOnFamilyId[];
    privateDetailsStored: false;
    r1150FeatureOnlyTemplateArtifact: typeof FEATURE_ONLY_TEMPLATE_FILE_NAME;
    r1160ProofReadyForRowOwnerConfirmation: boolean;
    r1160TranscriptionProofCommand: typeof R1160_TRANSCRIPTION_PROOF_COMMAND;
    rowLevelDataAcceptedByR1161: false;
    rowOwnerConfirmationStillRequired: boolean;
    rowOwnerPrivateValuesStored: false;
    safeConfirmationArtifactWritten: boolean;
    safeMaterializedFieldCount: number;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
  packetId: "r1161-feature-only-safe-availability-confirmation-materializer";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1161_FEATURE_ONLY_SAFE_AVAILABILITY_CONFIRMATION_MATERIALIZER_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: MaterializerConclusion;
    confirmationArtifactLocalPathStored: false;
    confirmationValuesStoredInR1161Packet: false;
    explicitRowOwnerConfirmationAssertionProvided: boolean;
    featureOnlyConfirmationWouldBeReadyForR1150: boolean;
    featureOnlyTemplateReady: boolean;
    minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    nextAction: MaterializerNextAction;
    optionalAddOnFamilyIds: OptionalAddOnFamilyId[];
    productDisplayAuthorized: false;
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1161: false;
    rowOwnerConfirmationStillRequired: boolean;
    rowOwnerPrivateValuesStored: false;
    rowParsingPerformedByR1161: false;
    r1160ProofReadyForRowOwnerConfirmation: boolean;
    safeConfirmationArtifact: typeof CONFIRMED_CONFIRMATION_FILE_NAME | null;
    safeConfirmationArtifactWritten: boolean;
    safeMaterializedFieldCount: number;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
}

export async function runR1161FeatureOnlySafeAvailabilityConfirmationMaterializer(
  options: R1161FeatureOnlySafeAvailabilityConfirmationMaterializerOptions = {},
): Promise<{
  confirmedConfirmationPath: string | null;
  output: R1161FeatureOnlySafeAvailabilityConfirmationMaterializerOutput;
  outputPath: string;
}> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const inputs = await readInputs(options);
  validateInputs(inputs);

  const r1160Ready = r1160ProofReady(inputs.r1160);
  const templateReady = featureOnlyTemplateReady(inputs.featureOnlyTemplate);
  const explicitRowOwnerConfirmationAssertionProvided = options.rowOwnerAssertionsConfirmed === true;
  const safeConfirmationArtifactWritten =
    r1160Ready && templateReady && explicitRowOwnerConfirmationAssertionProvided;
  const featureOnlyConfirmationWouldBeReadyForR1150 =
    safeConfirmationArtifactWritten && materializedConfirmationReady(materializeConfirmation(inputs.featureOnlyTemplate));
  const conclusion = conclusionFor({
    explicitRowOwnerConfirmationAssertionProvided,
    featureOnlyTemplateReady: templateReady,
    r1160ProofReady: r1160Ready,
    safeConfirmationArtifactWritten,
  });
  const confirmedConfirmationPath = safeConfirmationArtifactWritten
    ? path.join(outputDir, CONFIRMED_CONFIRMATION_FILE_NAME)
    : null;
  const output: R1161FeatureOnlySafeAvailabilityConfirmationMaterializerOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    materializer: {
      confirmedConfirmationArtifact: safeConfirmationArtifactWritten ? CONFIRMED_CONFIRMATION_FILE_NAME : null,
      explicitRowOwnerConfirmationAssertionProvided,
      featureOnlyConfirmationWouldBeReadyForR1150,
      featureOnlyTemplateReady: templateReady,
      materializerCommand: R1161_MATERIALIZER_COMMAND,
      minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      optionalAddOnFamilyIds: [...OPTIONAL_ADD_ON_FAMILY_IDS],
      privateDetailsStored: false,
      r1150FeatureOnlyTemplateArtifact: FEATURE_ONLY_TEMPLATE_FILE_NAME,
      r1160ProofReadyForRowOwnerConfirmation: r1160Ready,
      r1160TranscriptionProofCommand: R1160_TRANSCRIPTION_PROOF_COMMAND,
      rowLevelDataAcceptedByR1161: false,
      rowOwnerConfirmationStillRequired: !safeConfirmationArtifactWritten,
      rowOwnerPrivateValuesStored: false,
      safeConfirmationArtifactWritten,
      safeMaterializedFieldCount: safeConfirmationArtifactWritten ? REQUIRED_CONFIRMATION_FIELD_PATHS.length : 0,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
    packetId: "r1161-feature-only-safe-availability-confirmation-materializer",
    productDisplayAuthorized: false,
    schemaVersion: R1161_FEATURE_ONLY_SAFE_AVAILABILITY_CONFIRMATION_MATERIALIZER_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      confirmationArtifactLocalPathStored: false,
      confirmationValuesStoredInR1161Packet: false,
      explicitRowOwnerConfirmationAssertionProvided,
      featureOnlyConfirmationWouldBeReadyForR1150,
      featureOnlyTemplateReady: templateReady,
      minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      nextAction: nextActionFor(conclusion),
      optionalAddOnFamilyIds: [...OPTIONAL_ADD_ON_FAMILY_IDS],
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1161: false,
      rowOwnerConfirmationStillRequired: !safeConfirmationArtifactWritten,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1161: false,
      r1160ProofReadyForRowOwnerConfirmation: r1160Ready,
      safeConfirmationArtifact: safeConfirmationArtifactWritten ? CONFIRMED_CONFIRMATION_FILE_NAME : null,
      safeConfirmationArtifactWritten,
      safeMaterializedFieldCount: safeConfirmationArtifactWritten ? REQUIRED_CONFIRMATION_FIELD_PATHS.length : 0,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1161 materializer output failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  await mkdir(outputDir, { recursive: true });
  if (confirmedConfirmationPath) {
    const confirmation = materializeConfirmation(inputs.featureOnlyTemplate);
    const confirmationFindings = findForbiddenAggregateEgress(confirmation);
    if (confirmationFindings.length > 0) {
      throw new Error(
        `R1161 confirmed feature-only confirmation failed aggregate-egress validation: ${formatFindingCount(confirmationFindings)}`,
      );
    }
    await writeFile(confirmedConfirmationPath, `${JSON.stringify(confirmation, null, 2)}\n`);
  }
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { confirmedConfirmationPath, output, outputPath };
}

async function readInputs(
  options: R1161FeatureOnlySafeAvailabilityConfirmationMaterializerOptions,
): Promise<ReadInputsResult> {
  const featureOnlyTemplatePath = options.featureOnlyTemplatePath
    ?? path.join(DEFAULT_MODEL_RUNS_DIR, FEATURE_ONLY_TEMPLATE_FILE_NAME);
  const r1160Path = options.r1160Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1160_EXPECTED.artifact);
  return {
    featureOnlyTemplate: await readJsonIfPresent(featureOnlyTemplatePath),
    r1160: await readJsonIfPresent(r1160Path),
  };
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error: unknown) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

function validateInputs(inputs: ReadInputsResult): void {
  for (const [label, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1161 rejected unsafe ${label} input: ${formatFindingCount(findings)}`);
    }
  }
}

function summarizeInputs(inputs: ReadInputsResult): R1161FeatureOnlySafeAvailabilityConfirmationMaterializerOutput["inputArtifacts"] {
  return {
    featureOnlyTemplate: {
      artifact: FEATURE_ONLY_TEMPLATE_FILE_NAME,
      schemaVersion: readStringAt(inputs.featureOnlyTemplate, ["schemaVersion"]) === FEATURE_ONLY_TEMPLATE_SCHEMA_VERSION
        ? FEATURE_ONLY_TEMPLATE_SCHEMA_VERSION
        : null,
      status: inputs.featureOnlyTemplate ? "available" : "missing",
    },
    r1160: {
      artifact: R1160_EXPECTED.artifact,
      packetId: readStringAt(inputs.r1160, ["packetId"]) === R1160_EXPECTED.packetId
        ? R1160_EXPECTED.packetId
        : null,
      schemaVersion: readStringAt(inputs.r1160, ["schemaVersion"]) === R1160_EXPECTED.schemaVersion
        ? R1160_EXPECTED.schemaVersion
        : null,
      status: inputs.r1160 ? "available" : "missing",
    },
  };
}

function r1160ProofReady(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1160_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1160_EXPECTED.schemaVersion
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(value, ["artifactBoundary", "confirmationValuesStoredByR1160"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowLevelDataAcceptedByR1160"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerProvidedValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "transcribedConfirmationPersisted"]) === false
    && readStringAt(value, ["summary", "conclusion"]) === "r1159_feature_only_safe_confirmation_transcription_ready_non_evidence"
    && readBooleanAt(value, ["summary", "hypotheticalTranscriptionWouldBeFeatureOnlyReady"]) === true
    && readBooleanAt(value, ["summary", "transcriptionProofReadyForRowOwnerConfirmation"]) === true
    && readBooleanAt(value, ["summary", "rowOwnerConfirmationStillRequired"]) === true
    && readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["summary", "reviewGptRequiredNow"]) === false
    && readNumberAt(value, ["summary", "exactSafeTranscriptionStepCount"]) === REQUIRED_CONFIRMATION_FIELD_PATHS.length
    && readStringAt(value, ["summary", "nextAction"]) === "row_owner_confirm_r1150_feature_only_safe_availability_from_r1160_transcription_proof"
    && readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(value, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && exactStringSet(readStringArrayAt(value, ["summary", "minimumFeaturePairRequired"]), FEATURE_ONLY_SOURCE_FAMILY_IDS);
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

function materializeConfirmation(template: unknown | null): Record<string, unknown> {
  const confirmation = deepClone(asRecord(template) ?? {});
  setNested(confirmation, ["aggregateReadinessFacts", "targetAgeBand"], TARGET_AGE_BAND);
  setNested(confirmation, ["rowOwnerAssertionsConfirmed"], true);
  for (const key of REQUIRED_ATTESTATION_KEYS) {
    setNested(confirmation, ["attestations", key], true);
  }
  for (const familyId of FEATURE_ONLY_SOURCE_FAMILY_IDS) {
    setSourceFamilyAvailable(confirmation, familyId, true);
  }
  return confirmation;
}

function materializedConfirmationReady(value: unknown): boolean {
  return featureOnlyTemplateReady(value)
    && readStringAt(value, ["aggregateReadinessFacts", "targetAgeBand"]) === TARGET_AGE_BAND
    && readBooleanAt(value, ["rowOwnerAssertionsConfirmed"]) === true
    && FEATURE_ONLY_SOURCE_FAMILY_IDS.every((familyId) => sourceFamilyAvailable(value, familyId) === true)
    && REQUIRED_ATTESTATION_KEYS.every((key) => readBooleanAt(value, ["attestations", key]) === true);
}

function conclusionFor(input: {
  explicitRowOwnerConfirmationAssertionProvided: boolean;
  featureOnlyTemplateReady: boolean;
  r1160ProofReady: boolean;
  safeConfirmationArtifactWritten: boolean;
}): MaterializerConclusion {
  if (!input.r1160ProofReady) {
    return "feature_only_safe_availability_confirmation_materializer_waiting_on_r1160_transcription_proof";
  }
  if (!input.featureOnlyTemplateReady) {
    return "feature_only_safe_availability_confirmation_materializer_waiting_on_feature_only_template";
  }
  if (!input.explicitRowOwnerConfirmationAssertionProvided) {
    return "feature_only_safe_availability_confirmation_materializer_waiting_on_explicit_row_owner_confirmation";
  }
  if (input.safeConfirmationArtifactWritten) {
    return "feature_only_safe_availability_confirmation_materialized";
  }
  return "feature_only_safe_availability_confirmation_materializer_waiting_on_explicit_row_owner_confirmation";
}

function nextActionFor(conclusion: MaterializerConclusion): MaterializerNextAction {
  if (conclusion === "feature_only_safe_availability_confirmation_materializer_waiting_on_r1160_transcription_proof") {
    return "refresh_r1160_transcription_proof";
  }
  if (conclusion === "feature_only_safe_availability_confirmation_materializer_waiting_on_feature_only_template") {
    return "refresh_r1150_safe_availability_confirmation_template";
  }
  if (conclusion === "feature_only_safe_availability_confirmation_materialized") {
    return "run_r1150_intake_with_r1161_confirmed_feature_only_safe_availability_confirmation";
  }
  return "rerun_r1161_with_row_owner_feature_only_confirmation_assertion";
}

function safeBoundary(): R1161FeatureOnlySafeAvailabilityConfirmationMaterializerOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    confirmationArtifactLocalPathStored: false,
    confirmationValuesStoredInR1161Packet: false,
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
    rowLevelDataAcceptedByR1161: false,
    rowOwnerPrivateValuesStored: false,
    rowParsingPerformedByR1161: false,
    rowValuesStored: false,
    safeConfirmationArtifactWrittenOnlyAfterExplicitAssertion: true,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

function sourceFamilyIds(value: unknown): string[] {
  return readRecordArrayAt(value, ["sourceFamilies"])
    .map((family) => readStringAt(family, ["familyId"]))
    .filter((familyId): familyId is string => typeof familyId === "string");
}

function sourceFamilyAvailable(value: unknown, familyId: FeatureOnlySourceFamilyId): boolean | null {
  const match = readRecordArrayAt(value, ["sourceFamilies"]).find((family) =>
    readStringAt(family, ["familyId"]) === familyId
  );
  return match ? readBooleanAt(match, ["available"]) : null;
}

function setSourceFamilyAvailable(
  value: Record<string, unknown>,
  familyId: FeatureOnlySourceFamilyId,
  available: boolean,
): void {
  const families = Array.isArray(value.sourceFamilies) ? value.sourceFamilies : [];
  for (const family of families) {
    const record = asRecord(family);
    if (record && record.familyId === familyId) {
      record.available = available;
      return;
    }
  }
}

function readStringAt(value: unknown, pathParts: string[]): string | null {
  const valueAtPath = readAt(value, pathParts);
  return typeof valueAtPath === "string" ? valueAtPath : null;
}

function readBooleanAt(value: unknown, pathParts: string[]): boolean | null {
  const valueAtPath = readAt(value, pathParts);
  return typeof valueAtPath === "boolean" ? valueAtPath : null;
}

function readNumberAt(value: unknown, pathParts: string[]): number | null {
  const valueAtPath = readAt(value, pathParts);
  return typeof valueAtPath === "number" && Number.isFinite(valueAtPath) ? valueAtPath : null;
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

function setNested(value: Record<string, unknown>, pathParts: string[], nextValue: unknown): void {
  let current: Record<string, unknown> = value;
  for (const [index, part] of pathParts.entries()) {
    if (index === pathParts.length - 1) {
      current[part] = nextValue;
      return;
    }
    const child = asRecord(current[part]);
    if (child) {
      current = child;
      continue;
    }
    const next: Record<string, unknown> = {};
    current[part] = next;
    current = next;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function deepClone(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value));
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

function readConfirmationAssertionFromEnv(value: string | undefined): boolean {
  return value === "true";
}

async function main(): Promise<void> {
  const runResult = await runR1161FeatureOnlySafeAvailabilityConfirmationMaterializer({
    featureOnlyTemplatePath: process.env.MURPH_AGE_R1150_FEATURE_ONLY_SAFE_AVAILABILITY_CONFIRMATION_TEMPLATE_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1160Path: process.env.MURPH_AGE_R1160_R1159_FEATURE_ONLY_SAFE_CONFIRMATION_TRANSCRIPTION_PROOF_PATH,
    rowOwnerAssertionsConfirmed: readConfirmationAssertionFromEnv(
      process.env.MURPH_AGE_R1161_ROW_OWNER_FEATURE_ONLY_CONFIRMATION_ASSERTIONS_CONFIRMED,
    ),
  });
  const packet = runResult.output;
  const safeCliSummary = {
    ...packet.summary,
    packetId: packet.packetId,
    productDisplayAuthorized: packet.productDisplayAuthorized,
    schemaVersion: packet.schemaVersion,
    status: packet.status,
  };
  console.log(JSON.stringify(safeCliSummary, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1161 feature-only safe availability materializer failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
