import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1161_FEATURE_ONLY_SAFE_AVAILABILITY_CONFIRMATION_MATERIALIZER_SCHEMA_VERSION,
  R1161_MATERIALIZER_COMMAND,
} from "./r1161-feature-only-safe-availability-confirmation-materializer.ts";

export const R1162_FEATURE_ONLY_SAFE_CONFIRMATION_ASSERTION_HANDOFF_SCHEMA_VERSION =
  "murph-age-r1162-feature-only-safe-confirmation-assertion-handoff.v1" as const;
export const R1162_ASSERTION_HANDOFF_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1162-feature-only-safe-confirmation-assertion-handoff.ts" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME =
  "r1162-feature-only-safe-confirmation-assertion-handoff.latest.json";
const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first" as const;
const TARGET_AGE_BAND = "roughly_16_50" as const;
const R1161_EXPECTED = {
  artifact: "r1161-feature-only-safe-availability-confirmation-materializer.latest.json",
  packetId: "r1161-feature-only-safe-availability-confirmation-materializer",
  schemaVersion: R1161_FEATURE_ONLY_SAFE_AVAILABILITY_CONFIRMATION_MATERIALIZER_SCHEMA_VERSION,
} as const;
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
const REQUIRED_CHECKLIST_IDS = [
  "confirm_target_age_band_without_identifiers",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
] as const;
const REQUIRED_SAFE_FIELD_EDIT_PATHS = [
  "aggregateReadinessFacts.targetAgeBand",
  "sourceFamilies[bloodwork_glycemia].available",
  "sourceFamilies[wearable_activity_daily].available",
  "rowOwnerAssertionsConfirmed",
  "attestations.aggregateOnly",
  "attestations.localOnly",
  "attestations.noCoefficientEgress",
  "attestations.noHeaderNameEgress",
  "attestations.noParticipantEgress",
  "attestations.noPredictionEgress",
  "attestations.noPrivatePathEgress",
  "attestations.noPrivateRefValueEgress",
  "attestations.noRowEgress",
  "attestations.noSmallCellEgress",
  "attestations.noSourceTextEgress",
] as const;

type FeatureOnlySourceFamilyId = typeof FEATURE_ONLY_SOURCE_FAMILY_IDS[number];
type OptionalAddOnFamilyId = typeof OPTIONAL_ADD_ON_FAMILY_IDS[number];
type RequiredInputKindId = typeof REQUIRED_INPUT_KIND_IDS[number];
type RequiredChecklistId = typeof REQUIRED_CHECKLIST_IDS[number];
type RequiredSafeFieldEditPath = typeof REQUIRED_SAFE_FIELD_EDIT_PATHS[number];
type AssertionHandoffConclusion =
  | "feature_only_safe_confirmation_assertion_handoff_ready_for_row_owner_assertion"
  | "feature_only_safe_confirmation_assertion_handoff_satisfied"
  | "feature_only_safe_confirmation_assertion_handoff_waiting_on_r1161_materializer";
type AssertionHandoffNextAction =
  | "refresh_r1161_safe_confirmation_materializer"
  | "row_owner_assert_feature_only_lab_wearable_availability_then_run_r1161_materializer"
  | "run_r1150_intake_with_r1161_confirmed_feature_only_safe_availability_confirmation";
type RowOwnerActionId =
  | "confirm_target_age_band_only"
  | "confirm_glycemia_bloodwork_export_available"
  | "confirm_daily_wearable_activity_export_available"
  | "confirm_no_private_values_identifiers_paths_headers_or_rows"
  | "run_r1161_materializer_with_explicit_row_owner_assertion";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface RowOwnerActionItem {
  actionId: RowOwnerActionId;
  mapsToChecklistIds: RequiredChecklistId[];
  mapsToSourceFamilyIds: FeatureOnlySourceFamilyId[];
  privateDetailsStored: false;
  safeMeaning: string;
}

export interface R1162FeatureOnlySafeConfirmationAssertionHandoffOptions {
  createdAt?: string;
  outputDir?: string;
  r1161Path?: string;
}

export interface R1162FeatureOnlySafeConfirmationAssertionHandoffOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    confirmationArtifactLocalPathStored: false;
    confirmationValuesStoredByR1162: false;
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
    rowLevelDataAcceptedByR1162: false;
    rowOwnerAssertionInferredByR1162: false;
    rowOwnerPrivateValuesStored: false;
    rowParsingPerformedByR1162: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  assertionHandoff: {
    handoffCommand: typeof R1162_ASSERTION_HANDOFF_COMMAND;
    handoffReadyForRowOwner: boolean;
    materializerCommand: typeof R1161_MATERIALIZER_COMMAND;
    minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    nextActionAfterAssertion: AssertionHandoffNextAction;
    optionalAddOnFamilyIds: OptionalAddOnFamilyId[];
    requiredChecklistIds: RequiredChecklistId[];
    requiredInputKindIds: RequiredInputKindId[];
    requiredSafeFieldEditPaths: RequiredSafeFieldEditPath[];
    rowLevelDataAcceptedByR1162: false;
    rowOwnerActionItems: RowOwnerActionItem[];
    rowOwnerAssertionStillRequired: boolean;
    rowOwnerPrivateValuesStored: false;
    safeConfirmationArtifact: string | null;
    safeConfirmationArtifactWritten: boolean | null;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
  createdAt: string;
  inputArtifacts: {
    r1161: ArtifactSummary;
  };
  materializerState: {
    artifact: typeof R1161_EXPECTED.artifact | null;
    conclusion: string | null;
    explicitRowOwnerConfirmationAssertionProvided: boolean | null;
    featureOnlyConfirmationWouldBeReadyForR1150: boolean | null;
    featureOnlyTemplateReady: boolean | null;
    nextAction: string | null;
    r1160ProofReadyForRowOwnerConfirmation: boolean | null;
    rowOwnerConfirmationStillRequired: boolean | null;
    safeConfirmationArtifact: string | null;
    safeConfirmationArtifactWritten: boolean | null;
    safeMaterializedFieldCount: number | null;
  };
  packetId: "r1162-feature-only-safe-confirmation-assertion-handoff";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1162_FEATURE_ONLY_SAFE_CONFIRMATION_ASSERTION_HANDOFF_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: AssertionHandoffConclusion;
    confirmationValuesStoredByR1162: false;
    explicitRowOwnerConfirmationAssertionProvided: boolean | null;
    featureOnlyConfirmationWouldBeReadyForR1150: boolean | null;
    handoffCommand: typeof R1162_ASSERTION_HANDOFF_COMMAND;
    handoffReadyForRowOwner: boolean;
    materializerCommand: typeof R1161_MATERIALIZER_COMMAND;
    materializerConclusion: string | null;
    materializerNextAction: string | null;
    minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    nextAction: AssertionHandoffNextAction;
    optionalAddOnFamilyIds: OptionalAddOnFamilyId[];
    productDisplayAuthorized: false;
    requiredChecklistIds: RequiredChecklistId[];
    requiredInputKindIds: RequiredInputKindId[];
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1162: false;
    rowOwnerAssertionInferredByR1162: false;
    rowOwnerAssertionStillRequired: boolean;
    rowOwnerPrivateValuesStored: false;
    rowParsingPerformedByR1162: false;
    safeConfirmationArtifact: string | null;
    safeConfirmationArtifactWritten: boolean | null;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
}

export async function runR1162FeatureOnlySafeConfirmationAssertionHandoff(
  options: R1162FeatureOnlySafeConfirmationAssertionHandoffOptions = {},
): Promise<{ output: R1162FeatureOnlySafeConfirmationAssertionHandoffOutput; outputPath: string }> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const r1161 = await readJsonIfPresent(
    options.r1161Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1161_EXPECTED.artifact),
  );
  validateInputBoundary("r1161", r1161);

  const r1161Ready = r1161MaterializerReady(r1161);
  const safeConfirmationArtifactWritten = r1161Ready
    ? readBooleanAt(r1161, ["summary", "safeConfirmationArtifactWritten"])
    : null;
  const rowOwnerAssertionStillRequired = r1161Ready
    ? readBooleanAt(r1161, ["summary", "rowOwnerConfirmationStillRequired"]) === true
    : true;
  const conclusion = conclusionFor({ r1161Ready, safeConfirmationArtifactWritten });
  const nextAction = nextActionFor(conclusion);
  const output: R1162FeatureOnlySafeConfirmationAssertionHandoffOutput = {
    artifactBoundary: safeBoundary(),
    assertionHandoff: {
      handoffCommand: R1162_ASSERTION_HANDOFF_COMMAND,
      handoffReadyForRowOwner: conclusion !== "feature_only_safe_confirmation_assertion_handoff_waiting_on_r1161_materializer",
      materializerCommand: R1161_MATERIALIZER_COMMAND,
      minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      nextActionAfterAssertion: nextAction,
      optionalAddOnFamilyIds: [...OPTIONAL_ADD_ON_FAMILY_IDS],
      requiredChecklistIds: [...REQUIRED_CHECKLIST_IDS],
      requiredInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
      requiredSafeFieldEditPaths: [...REQUIRED_SAFE_FIELD_EDIT_PATHS],
      rowLevelDataAcceptedByR1162: false,
      rowOwnerActionItems: rowOwnerActionItems(),
      rowOwnerAssertionStillRequired,
      rowOwnerPrivateValuesStored: false,
      safeConfirmationArtifact: r1161Ready ? readStringAt(r1161, ["summary", "safeConfirmationArtifact"]) : null,
      safeConfirmationArtifactWritten,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: {
      r1161: summarizeInput(r1161),
    },
    materializerState: {
      artifact: r1161Ready ? R1161_EXPECTED.artifact : null,
      conclusion: r1161Ready ? readStringAt(r1161, ["summary", "conclusion"]) : null,
      explicitRowOwnerConfirmationAssertionProvided: r1161Ready
        ? readBooleanAt(r1161, ["summary", "explicitRowOwnerConfirmationAssertionProvided"])
        : null,
      featureOnlyConfirmationWouldBeReadyForR1150: r1161Ready
        ? readBooleanAt(r1161, ["summary", "featureOnlyConfirmationWouldBeReadyForR1150"])
        : null,
      featureOnlyTemplateReady: r1161Ready ? readBooleanAt(r1161, ["summary", "featureOnlyTemplateReady"]) : null,
      nextAction: r1161Ready ? readStringAt(r1161, ["summary", "nextAction"]) : null,
      r1160ProofReadyForRowOwnerConfirmation: r1161Ready
        ? readBooleanAt(r1161, ["summary", "r1160ProofReadyForRowOwnerConfirmation"])
        : null,
      rowOwnerConfirmationStillRequired: r1161Ready
        ? readBooleanAt(r1161, ["summary", "rowOwnerConfirmationStillRequired"])
        : null,
      safeConfirmationArtifact: r1161Ready ? readStringAt(r1161, ["summary", "safeConfirmationArtifact"]) : null,
      safeConfirmationArtifactWritten,
      safeMaterializedFieldCount: r1161Ready ? readNumberAt(r1161, ["summary", "safeMaterializedFieldCount"]) : null,
    },
    packetId: "r1162-feature-only-safe-confirmation-assertion-handoff",
    productDisplayAuthorized: false,
    schemaVersion: R1162_FEATURE_ONLY_SAFE_CONFIRMATION_ASSERTION_HANDOFF_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      confirmationValuesStoredByR1162: false,
      explicitRowOwnerConfirmationAssertionProvided: r1161Ready
        ? readBooleanAt(r1161, ["summary", "explicitRowOwnerConfirmationAssertionProvided"])
        : null,
      featureOnlyConfirmationWouldBeReadyForR1150: r1161Ready
        ? readBooleanAt(r1161, ["summary", "featureOnlyConfirmationWouldBeReadyForR1150"])
        : null,
      handoffCommand: R1162_ASSERTION_HANDOFF_COMMAND,
      handoffReadyForRowOwner:
        conclusion !== "feature_only_safe_confirmation_assertion_handoff_waiting_on_r1161_materializer",
      materializerCommand: R1161_MATERIALIZER_COMMAND,
      materializerConclusion: r1161Ready ? readStringAt(r1161, ["summary", "conclusion"]) : null,
      materializerNextAction: r1161Ready ? readStringAt(r1161, ["summary", "nextAction"]) : null,
      minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      nextAction,
      optionalAddOnFamilyIds: [...OPTIONAL_ADD_ON_FAMILY_IDS],
      productDisplayAuthorized: false,
      requiredChecklistIds: [...REQUIRED_CHECKLIST_IDS],
      requiredInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1162: false,
      rowOwnerAssertionInferredByR1162: false,
      rowOwnerAssertionStillRequired,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1162: false,
      safeConfirmationArtifact: r1161Ready ? readStringAt(r1161, ["summary", "safeConfirmationArtifact"]) : null,
      safeConfirmationArtifactWritten,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1162 assertion handoff output failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error: unknown) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

function validateInputBoundary(label: string, value: unknown | null): void {
  if (!value) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1162 rejected unsafe ${label} input: ${formatFindingCount(findings)}`);
  }
}

function summarizeInput(value: unknown | null): ArtifactSummary {
  const packetId = readStringAt(value, ["packetId"]);
  const schemaVersion = readStringAt(value, ["schemaVersion"]);
  return {
    artifact: R1161_EXPECTED.artifact,
    packetId: packetId === R1161_EXPECTED.packetId ? R1161_EXPECTED.packetId : null,
    schemaVersion: schemaVersion === R1161_EXPECTED.schemaVersion ? R1161_EXPECTED.schemaVersion : null,
    status: value ? "available" : "missing",
  };
}

function r1161MaterializerReady(value: unknown | null): boolean {
  const conclusion = readStringAt(value, ["summary", "conclusion"]);
  const nextAction = readStringAt(value, ["summary", "nextAction"]);
  const artifactWritten = readBooleanAt(value, ["summary", "safeConfirmationArtifactWritten"]);
  return readStringAt(value, ["packetId"]) === R1161_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1161_EXPECTED.schemaVersion
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(value, ["artifactBoundary", "confirmationArtifactLocalPathStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "confirmationValuesStoredInR1161Packet"]) === false
    && readBooleanAt(value, ["artifactBoundary", "fileNamesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "headerValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "localPathsStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "privateConfigValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "privateFieldRefValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "privateFieldRefsStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "privateTableRefValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "privateTableRefsStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowLevelDataAcceptedByR1161"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "rowParsingPerformedByR1161"]) === false
    && readBooleanAt(value, ["artifactBoundary", "safeConfirmationArtifactWrittenOnlyAfterExplicitAssertion"]) === true
    && readBooleanAt(value, ["artifactBoundary", "sourceFileNamesStored"]) === false
    && readBooleanAt(value, ["artifactBoundary", "sourceVariableNamesStored"]) === false
    && readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(value, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && (
      conclusion === "feature_only_safe_availability_confirmation_materializer_waiting_on_explicit_row_owner_confirmation"
      || conclusion === "feature_only_safe_availability_confirmation_materialized"
    )
    && (
      nextAction === "rerun_r1161_with_row_owner_feature_only_confirmation_assertion"
      || nextAction === "run_r1150_intake_with_r1161_confirmed_feature_only_safe_availability_confirmation"
    )
    && readBooleanAt(value, ["summary", "r1160ProofReadyForRowOwnerConfirmation"]) === true
    && readBooleanAt(value, ["summary", "featureOnlyTemplateReady"]) === true
    && readNumberAt(value, ["summary", "safeMaterializedFieldCount"])
      === (artifactWritten === true ? REQUIRED_SAFE_FIELD_EDIT_PATHS.length : 0)
    && exactStringSet(readStringArrayAt(value, ["summary", "minimumFeaturePairRequired"]), FEATURE_ONLY_SOURCE_FAMILY_IDS)
    && exactStringSet(readStringArrayAt(value, ["summary", "optionalAddOnFamilyIds"]), OPTIONAL_ADD_ON_FAMILY_IDS)
    && readBooleanAt(value, ["summary", "confirmationValuesStoredInR1161Packet"]) === false
    && readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1161"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["summary", "rowParsingPerformedByR1161"]) === false
    && readBooleanAt(value, ["productDisplayAuthorized"]) === false;
}

function conclusionFor(input: {
  r1161Ready: boolean;
  safeConfirmationArtifactWritten: boolean | null;
}): AssertionHandoffConclusion {
  if (!input.r1161Ready) {
    return "feature_only_safe_confirmation_assertion_handoff_waiting_on_r1161_materializer";
  }
  if (input.safeConfirmationArtifactWritten === true) {
    return "feature_only_safe_confirmation_assertion_handoff_satisfied";
  }
  return "feature_only_safe_confirmation_assertion_handoff_ready_for_row_owner_assertion";
}

function nextActionFor(conclusion: AssertionHandoffConclusion): AssertionHandoffNextAction {
  if (conclusion === "feature_only_safe_confirmation_assertion_handoff_waiting_on_r1161_materializer") {
    return "refresh_r1161_safe_confirmation_materializer";
  }
  if (conclusion === "feature_only_safe_confirmation_assertion_handoff_satisfied") {
    return "run_r1150_intake_with_r1161_confirmed_feature_only_safe_availability_confirmation";
  }
  return "row_owner_assert_feature_only_lab_wearable_availability_then_run_r1161_materializer";
}

function rowOwnerActionItems(): RowOwnerActionItem[] {
  return [
    {
      actionId: "confirm_target_age_band_only",
      mapsToChecklistIds: ["confirm_target_age_band_without_identifiers"],
      mapsToSourceFamilyIds: [],
      privateDetailsStored: false,
      safeMeaning: "Only the rough 16-50 target age band is asserted.",
    },
    {
      actionId: "confirm_glycemia_bloodwork_export_available",
      mapsToChecklistIds: ["confirm_glycemia_bloodwork_export_available"],
      mapsToSourceFamilyIds: ["bloodwork_glycemia"],
      privateDetailsStored: false,
      safeMeaning: "A lab portal export or spreadsheet can supply glycemia bloodwork coverage.",
    },
    {
      actionId: "confirm_daily_wearable_activity_export_available",
      mapsToChecklistIds: ["confirm_daily_wearable_activity_export_available"],
      mapsToSourceFamilyIds: ["wearable_activity_daily"],
      privateDetailsStored: false,
      safeMeaning: "A phone, watch, or wearable export can supply daily activity coverage.",
    },
    {
      actionId: "confirm_no_private_values_identifiers_paths_headers_or_rows",
      mapsToChecklistIds: ["confirm_no_private_values_in_confirmation"],
      mapsToSourceFamilyIds: [],
      privateDetailsStored: false,
      safeMeaning: "The assertion excludes identifiers, file paths, filenames, headers, refs, and row values.",
    },
    {
      actionId: "run_r1161_materializer_with_explicit_row_owner_assertion",
      mapsToChecklistIds: [...REQUIRED_CHECKLIST_IDS],
      mapsToSourceFamilyIds: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      privateDetailsStored: false,
      safeMeaning: "Run the gated materializer only after the row owner makes the safe feature-only assertion.",
    },
  ];
}

function safeBoundary(): R1162FeatureOnlySafeConfirmationAssertionHandoffOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    confirmationArtifactLocalPathStored: false,
    confirmationValuesStoredByR1162: false,
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
    rowLevelDataAcceptedByR1162: false,
    rowOwnerAssertionInferredByR1162: false,
    rowOwnerPrivateValuesStored: false,
    rowParsingPerformedByR1162: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const valueAtPath = readAt(value, pathParts);
  return typeof valueAtPath === "string" ? valueAtPath : null;
}

function readBooleanAt(value: unknown, pathParts: readonly string[]): boolean | null {
  const valueAtPath = readAt(value, pathParts);
  return typeof valueAtPath === "boolean" ? valueAtPath : null;
}

function readNumberAt(value: unknown, pathParts: readonly string[]): number | null {
  const valueAtPath = readAt(value, pathParts);
  return typeof valueAtPath === "number" && Number.isFinite(valueAtPath) ? valueAtPath : null;
}

function readStringArrayAt(value: unknown, pathParts: readonly string[]): string[] {
  const valueAtPath = readAt(value, pathParts);
  return Array.isArray(valueAtPath)
    ? valueAtPath.filter((item): item is string => typeof item === "string")
    : [];
}

function readAt(value: unknown, pathParts: readonly string[]): unknown {
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

function exactStringSet(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && expected.every((item) => actual.includes(item));
}

function isMissingFileError(error: unknown): boolean {
  return asRecord(error)?.code === "ENOENT";
}

function formatFindingCount(findings: string[]): string {
  return `${findings.length} aggregate-egress violation${findings.length === 1 ? "" : "s"}`;
}

async function main(): Promise<void> {
  const runResult = await runR1162FeatureOnlySafeConfirmationAssertionHandoff({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1161Path: process.env.MURPH_AGE_R1161_FEATURE_ONLY_SAFE_AVAILABILITY_CONFIRMATION_MATERIALIZER_PATH,
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
    process.stderr.write(`${safeCliErrorMessage(error, "R1162 feature-only safe confirmation assertion handoff failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
