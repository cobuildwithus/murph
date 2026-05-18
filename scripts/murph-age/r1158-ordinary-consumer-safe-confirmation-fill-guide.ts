import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import { R1157_SAFE_CONFIRMATION_CHAIN_RUNNER_COMMAND } from "./r1157-ordinary-consumer-safe-confirmation-chain-runner.ts";

export const R1158_ORDINARY_CONSUMER_SAFE_CONFIRMATION_FILL_GUIDE_SCHEMA_VERSION =
  "murph-age-r1158-ordinary-consumer-safe-confirmation-fill-guide.v1" as const;
export const R1158_SAFE_CONFIRMATION_FILL_GUIDE_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1158-ordinary-consumer-safe-confirmation-fill-guide.ts" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1158-ordinary-consumer-safe-confirmation-fill-guide.latest.json";
const FEATURE_ONLY_TEMPLATE_FILE_NAME =
  "r1150-fillable-feature-only-safe-availability-confirmation.json" as const;
const FEATURE_ONLY_TEMPLATE_SCHEMA_VERSION =
  "murph-age-r1150-ordinary-consumer-safe-availability-confirmation.v1" as const;
const R1154_QUICKSTART_FILE_NAME = "r1154-feature-only-safe-confirmation-quickstart.json" as const;
const R1154_QUICKSTART_SCHEMA_VERSION =
  "murph-age-r1154-feature-only-safe-confirmation-quickstart.v1" as const;
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
const R1156_EXPECTED = {
  artifact: "r1156-ordinary-consumer-safe-confirmation-handoff.latest.json",
  packetId: "r1156-ordinary-consumer-safe-confirmation-handoff",
  schemaVersion: "murph-age-r1156-ordinary-consumer-safe-confirmation-handoff.v1",
} as const;
const R1157_EXPECTED = {
  artifact: "r1157-ordinary-consumer-safe-confirmation-chain-runner.latest.json",
  packetId: "r1157-ordinary-consumer-safe-confirmation-chain-runner",
  schemaVersion: "murph-age-r1157-ordinary-consumer-safe-confirmation-chain-runner.v1",
} as const;

type FeatureOnlySourceFamilyId = typeof FEATURE_ONLY_SOURCE_FAMILY_IDS[number];
type OptionalAddOnFamilyId = typeof OPTIONAL_ADD_ON_FAMILY_IDS[number];
type RequiredAttestationKey = typeof REQUIRED_ATTESTATION_KEYS[number];
type RequiredChecklistId = typeof REQUIRED_CHECKLIST_IDS[number];
type FillGuideConclusion =
  | "ordinary_safe_confirmation_fill_guide_ready_non_evidence"
  | "ordinary_safe_confirmation_fill_guide_waiting_on_chain_runner"
  | "ordinary_safe_confirmation_fill_guide_waiting_on_feature_only_template"
  | "ordinary_safe_confirmation_fill_guide_waiting_on_handoff"
  | "ordinary_safe_confirmation_fill_guide_waiting_on_quickstart";
type FillGuideNextAction =
  | "fill_safe_availability_confirmation_from_template"
  | "refresh_r1150_safe_availability_confirmation_template"
  | "refresh_r1154_safe_availability_action_packet"
  | "refresh_r1156_safe_confirmation_handoff"
  | "refresh_r1157_safe_confirmation_chain_runner";

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

export interface R1158OrdinaryConsumerSafeConfirmationFillGuideOptions {
  createdAt?: string;
  featureOnlyTemplatePath?: string;
  outputDir?: string;
  quickstartPath?: string;
  r1156Path?: string;
  r1157Path?: string;
}

export interface R1158OrdinaryConsumerSafeConfirmationFillGuideOutput {
  artifactBoundary: {
    aggregateOnly: true;
    availabilityConfirmationPathStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    confirmationValuesStored: false;
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
    rowLevelDataAcceptedByR1158: false;
    rowParsingPerformedByR1158: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: {
    featureOnlyTemplate: ArtifactSummary;
    quickstart: ArtifactSummary;
    r1156: ArtifactSummary;
    r1157: ArtifactSummary;
  };
  packetId: "r1158-ordinary-consumer-safe-confirmation-fill-guide";
  productDisplayAuthorized: false;
  rowOwnerFillGuide: {
    audience: "ordinary_submitter_roughly_16_50_row_owner";
    blockedConfirmationContent: string[];
    commands: {
      featureOnlyChainRunnerCommand: string | null;
      safeAvailabilityConfirmationIntakeCommand: string | null;
      safeConfirmationChainRunnerCommand: typeof R1157_SAFE_CONFIRMATION_CHAIN_RUNNER_COMMAND;
    };
    exactSafeFieldEdits: SafeFieldEdit[];
    guideRole: "fill_guide_only_not_confirmation_not_model_evidence";
    minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    nextActionAfterFill: "run_r1157_safe_confirmation_chain_runner_with_real_safe_confirmation";
    optionalAddOnInputKinds: SubmitterInputKind[];
    preferredRecipeId: typeof PREFERRED_RECIPE_ID;
    privateDetailsStored: false;
    readyToUse: boolean;
    recommendedCompletionModeId: "feature_only_lab_wearable_coverage";
    requiredAttestationKeys: RequiredAttestationKey[];
    requiredChecklistIds: RequiredChecklistId[];
    requiredInputKinds: SubmitterInputKind[];
    rowLevelDataAcceptedByR1158: false;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
  schemaVersion: typeof R1158_ORDINARY_CONSUMER_SAFE_CONFIRMATION_FILL_GUIDE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    blockedConfirmationContentIds: string[];
    conclusion: FillGuideConclusion;
    exactSafeFieldEditCount: number;
    featureOnlyTemplateReady: boolean;
    guideReadyForRowOwnerFill: boolean;
    handoffReadyForRowOwner: boolean;
    minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    nextAction: FillGuideNextAction;
    optionalAddOnFamilyIds: OptionalAddOnFamilyId[];
    productDisplayAuthorized: false;
    quickstartReady: boolean;
    recommendedCompletionModeId: "feature_only_lab_wearable_coverage";
    requiredChecklistIds: RequiredChecklistId[];
    requiredInputKindIds: SubmitterInputKind["inputKindId"][];
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1158: false;
    rowParsingPerformedByR1158: false;
    safeConfirmationChainRunnerReady: boolean;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
}

export async function runR1158OrdinaryConsumerSafeConfirmationFillGuide(
  options: R1158OrdinaryConsumerSafeConfirmationFillGuideOptions = {},
): Promise<{ output: R1158OrdinaryConsumerSafeConfirmationFillGuideOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputs(inputs);
  const readiness = {
    featureOnlyTemplateReady: featureOnlyTemplateReady(inputs.featureOnlyTemplate),
    handoffReadyForRowOwner: handoffReadyForRowOwner(inputs.r1156),
    quickstartReady: quickstartReady(inputs.quickstart),
    safeConfirmationChainRunnerReady: safeConfirmationChainRunnerReady(inputs.r1157),
  };
  const conclusion = conclusionFor(readiness);
  const guideReadyForRowOwnerFill = conclusion === "ordinary_safe_confirmation_fill_guide_ready_non_evidence";
  const exactSafeFieldEdits = readiness.quickstartReady ? safeFieldEdits(inputs.quickstart) : [];
  const output: R1158OrdinaryConsumerSafeConfirmationFillGuideOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1158-ordinary-consumer-safe-confirmation-fill-guide",
    productDisplayAuthorized: false,
    rowOwnerFillGuide: {
      audience: "ordinary_submitter_roughly_16_50_row_owner",
      blockedConfirmationContent: blockedConfirmationContent(inputs.quickstart),
      commands: {
        featureOnlyChainRunnerCommand: readStringAt(inputs.quickstart, ["featureOnlyChainRunnerCommand"]),
        safeAvailabilityConfirmationIntakeCommand:
          readStringAt(inputs.quickstart, ["safeAvailabilityConfirmationIntakeCommand"]),
        safeConfirmationChainRunnerCommand: R1157_SAFE_CONFIRMATION_CHAIN_RUNNER_COMMAND,
      },
      exactSafeFieldEdits,
      guideRole: "fill_guide_only_not_confirmation_not_model_evidence",
      minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      nextActionAfterFill: "run_r1157_safe_confirmation_chain_runner_with_real_safe_confirmation",
      optionalAddOnInputKinds: optionalAddOnInputKinds(),
      preferredRecipeId: PREFERRED_RECIPE_ID,
      privateDetailsStored: false,
      readyToUse: guideReadyForRowOwnerFill,
      recommendedCompletionModeId: "feature_only_lab_wearable_coverage",
      requiredAttestationKeys: [...REQUIRED_ATTESTATION_KEYS],
      requiredChecklistIds: [...REQUIRED_CHECKLIST_IDS],
      requiredInputKinds: requiredInputKinds(inputs.quickstart),
      rowLevelDataAcceptedByR1158: false,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
    schemaVersion: R1158_ORDINARY_CONSUMER_SAFE_CONFIRMATION_FILL_GUIDE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      blockedConfirmationContentIds: blockedConfirmationContent(inputs.quickstart),
      conclusion,
      exactSafeFieldEditCount: exactSafeFieldEdits.length,
      ...readiness,
      guideReadyForRowOwnerFill,
      minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      nextAction: nextActionFor(conclusion),
      optionalAddOnFamilyIds: [...OPTIONAL_ADD_ON_FAMILY_IDS],
      productDisplayAuthorized: false,
      recommendedCompletionModeId: "feature_only_lab_wearable_coverage",
      requiredChecklistIds: [...REQUIRED_CHECKLIST_IDS],
      requiredInputKindIds: requiredInputKinds(inputs.quickstart).map((item) => item.inputKindId),
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1158: false,
      rowParsingPerformedByR1158: false,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1158 safe confirmation fill guide failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function conclusionFor(input: {
  featureOnlyTemplateReady: boolean;
  handoffReadyForRowOwner: boolean;
  quickstartReady: boolean;
  safeConfirmationChainRunnerReady: boolean;
}): FillGuideConclusion {
  if (!input.featureOnlyTemplateReady) {
    return "ordinary_safe_confirmation_fill_guide_waiting_on_feature_only_template";
  }
  if (!input.quickstartReady) return "ordinary_safe_confirmation_fill_guide_waiting_on_quickstart";
  if (!input.handoffReadyForRowOwner) return "ordinary_safe_confirmation_fill_guide_waiting_on_handoff";
  if (!input.safeConfirmationChainRunnerReady) {
    return "ordinary_safe_confirmation_fill_guide_waiting_on_chain_runner";
  }
  return "ordinary_safe_confirmation_fill_guide_ready_non_evidence";
}

function nextActionFor(conclusion: FillGuideConclusion): FillGuideNextAction {
  if (conclusion === "ordinary_safe_confirmation_fill_guide_waiting_on_feature_only_template") {
    return "refresh_r1150_safe_availability_confirmation_template";
  }
  if (conclusion === "ordinary_safe_confirmation_fill_guide_waiting_on_quickstart") {
    return "refresh_r1154_safe_availability_action_packet";
  }
  if (conclusion === "ordinary_safe_confirmation_fill_guide_waiting_on_handoff") {
    return "refresh_r1156_safe_confirmation_handoff";
  }
  if (conclusion === "ordinary_safe_confirmation_fill_guide_waiting_on_chain_runner") {
    return "refresh_r1157_safe_confirmation_chain_runner";
  }
  return "fill_safe_availability_confirmation_from_template";
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

function quickstartReady(value: unknown | null): boolean {
  return readStringAt(value, ["schemaVersion"]) === R1154_QUICKSTART_SCHEMA_VERSION
    && readStringAt(value, ["targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(value, ["targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && readStringAt(value, ["completionModeId"]) === "feature_only_lab_wearable_coverage"
    && readBooleanAt(value, ["modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["outcomeLinkageRequiredForFeatureOnlyContext"]) === false
    && readBooleanAt(value, ["privateDetailsStored"]) === false
    && readBooleanAt(value, ["productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["reviewGptRequiredNow"]) === false
    && readBooleanAt(value, ["rowLevelDataAcceptedByR1154"]) === false
    && readBooleanAt(value, ["rowParsingPerformedByR1154"]) === false
    && exactStringSet(sourceFamilyIds(value, ["requiredSourceFamilies"]), FEATURE_ONLY_SOURCE_FAMILY_IDS)
    && exactStringSet(readStringArrayAt(value, ["requiredChecklistItemIds"]), REQUIRED_CHECKLIST_IDS)
    && exactStringSet(readStringArrayAt(value, ["attestationsToConfirm"]), REQUIRED_ATTESTATION_KEYS)
    && exactStringSet(safeFieldEdits(value).map((edit) => edit.fieldPath), REQUIRED_FIELD_EDIT_PATHS)
    && safeFieldEdits(value).every((edit) => edit.privateDetailsStored === false)
    && readStringAt(value, ["safeAvailabilityConfirmationIntakeCommand"]) !== null
    && readStringAt(value, ["featureOnlyChainRunnerCommand"]) !== null;
}

function handoffReadyForRowOwner(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1156_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1156_EXPECTED.schemaVersion
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(value, ["artifactBoundary", "rowLevelDataAcceptedByR1156"]) === false
    && readBooleanAt(value, ["summary", "featureOnlyPathMechanicallyProven"]) === true
    && readBooleanAt(value, ["summary", "handoffReadyForRowOwner"]) === true
    && readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1156"]) === false
    && exactStringSet(
      readStringArrayAt(value, ["summary", "requiredFeatureOnlySourceFamilyIds"]),
      FEATURE_ONLY_SOURCE_FAMILY_IDS,
    );
}

function safeConfirmationChainRunnerReady(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1157_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1157_EXPECTED.schemaVersion
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(value, ["artifactBoundary", "rowLevelDataAcceptedByR1157"]) === false
    && readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1157"]) === false
    && readStringAt(value, ["summary", "safeConfirmationChainRunnerCommand"])
      === R1157_SAFE_CONFIRMATION_CHAIN_RUNNER_COMMAND;
}

async function readInputs(options: R1158OrdinaryConsumerSafeConfirmationFillGuideOptions): Promise<{
  featureOnlyTemplate: unknown | null;
  quickstart: unknown | null;
  r1156: unknown | null;
  r1157: unknown | null;
}> {
  return {
    featureOnlyTemplate: await readJsonIfPresent(
      options.featureOnlyTemplatePath ?? path.join(DEFAULT_MODEL_RUNS_DIR, FEATURE_ONLY_TEMPLATE_FILE_NAME),
    ),
    quickstart: await readJsonIfPresent(
      options.quickstartPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1154_QUICKSTART_FILE_NAME),
    ),
    r1156: await readJsonIfPresent(
      options.r1156Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1156_EXPECTED.artifact),
    ),
    r1157: await readJsonIfPresent(
      options.r1157Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1157_EXPECTED.artifact),
    ),
  };
}

function validateInputs(inputs: Record<string, unknown | null>): void {
  for (const [label, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1158 rejected unsafe ${label} input: ${formatFindingCount(findings)}`);
    }
  }
}

function summarizeInputs(inputs: {
  featureOnlyTemplate: unknown | null;
  quickstart: unknown | null;
  r1156: unknown | null;
  r1157: unknown | null;
}): R1158OrdinaryConsumerSafeConfirmationFillGuideOutput["inputArtifacts"] {
  return {
    featureOnlyTemplate: {
      artifact: FEATURE_ONLY_TEMPLATE_FILE_NAME,
      schemaVersion: readStringAt(inputs.featureOnlyTemplate, ["schemaVersion"]) === FEATURE_ONLY_TEMPLATE_SCHEMA_VERSION
        ? FEATURE_ONLY_TEMPLATE_SCHEMA_VERSION
        : null,
      status: inputs.featureOnlyTemplate ? "available" : "missing",
    },
    quickstart: {
      artifact: R1154_QUICKSTART_FILE_NAME,
      schemaVersion: readStringAt(inputs.quickstart, ["schemaVersion"]) === R1154_QUICKSTART_SCHEMA_VERSION
        ? R1154_QUICKSTART_SCHEMA_VERSION
        : null,
      status: inputs.quickstart ? "available" : "missing",
    },
    r1156: summarizePacketInput(inputs.r1156, R1156_EXPECTED),
    r1157: summarizePacketInput(inputs.r1157, R1157_EXPECTED),
  };
}

function summarizePacketInput(
  value: unknown | null,
  expected: typeof R1156_EXPECTED | typeof R1157_EXPECTED,
): ArtifactSummary {
  return {
    artifact: expected.artifact,
    packetId: readStringAt(value, ["packetId"]) === expected.packetId ? expected.packetId : null,
    schemaVersion: readStringAt(value, ["schemaVersion"]) === expected.schemaVersion ? expected.schemaVersion : null,
    status: value ? "available" : "missing",
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

function safeFieldEdits(value: unknown | null): SafeFieldEdit[] {
  return readRecordArrayAt(value, ["safeConfirmationFieldEdits"])
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

function requiredInputKinds(value: unknown | null): SubmitterInputKind[] {
  const sourceFamilies = readRecordArrayAt(value, ["requiredSourceFamilies"]);
  const mapped = sourceFamilies.map((item): SubmitterInputKind | null => {
    const familyId = readStringAt(item, ["familyId"]);
    const safeSourceKind = readStringAt(item, ["safeSourceKind"]);
    if (familyId === "bloodwork_glycemia" && safeSourceKind === "lab_portal_export_or_spreadsheet") {
      return {
        inputKindId: "lab_portal_export_or_spreadsheet",
        mapsToSourceFamilyIds: ["bloodwork_glycemia"],
        privateDetailsStored: false,
        requiredForFeatureOnlyPreferredPair: true,
        safeSubmitterExample:
          readStringAt(item, ["safeAvailableMeans"])
            ?? "A normal lab portal export or spreadsheet has glycemia bloodwork coverage.",
      };
    }
    if (familyId === "wearable_activity_daily" && safeSourceKind === "phone_watch_or_wearable_activity_export") {
      return {
        inputKindId: "phone_watch_or_wearable_activity_export",
        mapsToSourceFamilyIds: ["wearable_activity_daily"],
        privateDetailsStored: false,
        requiredForFeatureOnlyPreferredPair: true,
        safeSubmitterExample:
          readStringAt(item, ["safeAvailableMeans"])
            ?? "A phone, watch, or wearable export has daily activity coverage.",
      };
    }
    return null;
  }).filter((item): item is SubmitterInputKind => item !== null);
  return mapped.length === FEATURE_ONLY_SOURCE_FAMILY_IDS.length ? mapped : fallbackRequiredInputKinds();
}

function fallbackRequiredInputKinds(): SubmitterInputKind[] {
  return [
    {
      inputKindId: "lab_portal_export_or_spreadsheet",
      mapsToSourceFamilyIds: ["bloodwork_glycemia"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: true,
      safeSubmitterExample: "A normal lab portal export or spreadsheet has glycemia bloodwork coverage.",
    },
    {
      inputKindId: "phone_watch_or_wearable_activity_export",
      mapsToSourceFamilyIds: ["wearable_activity_daily"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: true,
      safeSubmitterExample: "A phone, watch, or wearable export has daily activity coverage.",
    },
  ];
}

function optionalAddOnInputKinds(): SubmitterInputKind[] {
  return [
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

function blockedConfirmationContent(value: unknown | null): string[] {
  const blocked = readStringArrayAt(value, ["blockedConfirmationContent"]);
  return blocked.length > 0 ? blocked : [...BLOCKED_CONFIRMATION_CONTENT];
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

function safeBoundary(): R1158OrdinaryConsumerSafeConfirmationFillGuideOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    availabilityConfirmationPathStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    confirmationValuesStored: false,
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
    rowLevelDataAcceptedByR1158: false,
    rowParsingPerformedByR1158: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1158OrdinaryConsumerSafeConfirmationFillGuide({
    featureOnlyTemplatePath: process.env.MURPH_AGE_R1150_FEATURE_ONLY_SAFE_AVAILABILITY_CONFIRMATION_TEMPLATE_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    quickstartPath: process.env.MURPH_AGE_R1154_FEATURE_ONLY_SAFE_CONFIRMATION_QUICKSTART_PATH,
    r1156Path: process.env.MURPH_AGE_R1156_ORDINARY_CONSUMER_SAFE_CONFIRMATION_HANDOFF_PATH,
    r1157Path: process.env.MURPH_AGE_R1157_ORDINARY_CONSUMER_SAFE_CONFIRMATION_CHAIN_RUNNER_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    blockedConfirmationContentIds: output.summary.blockedConfirmationContentIds,
    conclusion: output.summary.conclusion,
    exactSafeFieldEditCount: output.summary.exactSafeFieldEditCount,
    featureOnlyTemplateReady: output.summary.featureOnlyTemplateReady,
    guideReadyForRowOwnerFill: output.summary.guideReadyForRowOwnerFill,
    handoffReadyForRowOwner: output.summary.handoffReadyForRowOwner,
    minimumFeaturePairRequired: output.summary.minimumFeaturePairRequired,
    modelEvidencePromotionAllowed: output.summary.modelEvidencePromotionAllowed,
    nextAction: output.summary.nextAction,
    optionalAddOnFamilyIds: output.summary.optionalAddOnFamilyIds,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    quickstartReady: output.summary.quickstartReady,
    recommendedCompletionModeId: output.summary.recommendedCompletionModeId,
    requiredChecklistIds: output.summary.requiredChecklistIds,
    requiredInputKindIds: output.summary.requiredInputKindIds,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowLevelDataAcceptedByR1158: output.summary.rowLevelDataAcceptedByR1158,
    rowParsingPerformedByR1158: output.summary.rowParsingPerformedByR1158,
    safeConfirmationChainRunnerReady: output.summary.safeConfirmationChainRunnerReady,
    schemaVersion: output.schemaVersion,
    status: output.status,
    targetAgeBand: output.summary.targetAgeBand,
    targetInputPriority: output.summary.targetInputPriority,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1158 safe confirmation fill guide failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
