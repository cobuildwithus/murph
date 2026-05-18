import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_SCHEMA_VERSION =
  "murph-age-r1150-ordinary-consumer-safe-availability-confirmation-intake.v1" as const;

const CONFIRMATION_SCHEMA_VERSION =
  "murph-age-r1150-ordinary-consumer-safe-availability-confirmation.v1" as const;
const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME =
  "r1150-ordinary-consumer-safe-availability-confirmation-intake.latest.json";
const FILLABLE_TEMPLATE_FILE_NAME =
  "r1150-fillable-ordinary-consumer-safe-availability-confirmation.json";
const FEATURE_ONLY_FILLABLE_TEMPLATE_FILE_NAME =
  "r1150-fillable-feature-only-safe-availability-confirmation.json";
const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first" as const;
const TARGET_AGE_BAND = "roughly_16_50" as const;
const PREFERRED_RECIPE_ID = "lab_plus_wearable_minimum_manifest" as const;
const EXPECTED_ROUTE_IDS = [
  "lab_glycemia_minimum_route",
  "wearable_activity_minimum_route",
] as const;
const REQUIRED_SOURCE_FAMILY_IDS = [
  "outcome_linkage",
  "join_time_alignment",
  "bloodwork_glycemia",
  "wearable_activity_daily",
] as const;
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
const REQUIRED_AGGREGATE_READINESS_FACT_IDS = [
  "outcomeLinked",
  "sameDenominator",
  "targetAgeBand",
  "usableRecordCountBand",
  "eventCountBand",
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
const ALLOWED_CONFIRMATION_TOP_LEVEL_KEYS = new Set<string>([
  "aggregateReadinessFacts",
  "attestations",
  "blockedConfirmationContent",
  "featureOnlyCoverageRequiresPreferredPair",
  "minimumFeaturePairRequired",
  "ordinarySubmitterCompletionModes",
  "ordinarySubmitterInputKinds",
  "ordinarySubmitterSafeCompletionChecklist",
  "outcomeLinkageRequiredForFeatureOnlyContext",
  "recipeId",
  "rowOwnerAssertionsConfirmed",
  "rowLevelDataAcceptedByR1150",
  "schemaVersion",
  "sourceFamilies",
  "targetAgeBand",
  "targetInputPriority",
]);
const CONFIRMATION_SCALAR_TOP_LEVEL_KEYS = new Set<string>([
  "featureOnlyCoverageRequiresPreferredPair",
  "outcomeLinkageRequiredForFeatureOnlyContext",
  "recipeId",
  "rowOwnerAssertionsConfirmed",
  "rowLevelDataAcceptedByR1150",
  "schemaVersion",
  "targetAgeBand",
  "targetInputPriority",
]);
const CONFIRMATION_SCALAR_ARRAY_TOP_LEVEL_KEYS = new Set<string>([
  "blockedConfirmationContent",
  "minimumFeaturePairRequired",
]);
const ALLOWED_AGGREGATE_READINESS_FACT_KEYS = new Set<string>(REQUIRED_AGGREGATE_READINESS_FACT_IDS);
const ALLOWED_ATTESTATION_KEYS = new Set<string>(REQUIRED_ATTESTATION_KEYS);
const ALLOWED_SOURCE_FAMILY_KEYS = new Set<string>([
  "available",
  "familyId",
  "requiredForFeatureOnlyPreferredPair",
  "requiredForRecommendedRecipe",
  "safeConfirmationMeaning",
]);
const ALLOWED_ORDINARY_SUBMITTER_INPUT_KIND_KEYS = new Set<string>([
  "inputKindId",
  "mapsToSourceFamilyIds",
  "privateDetailsStored",
  "requiredForFeatureOnlyPreferredPair",
  "safeSubmitterExample",
]);
const ALLOWED_ORDINARY_SUBMITTER_CHECKLIST_KEYS = new Set<string>([
  "checkId",
  "mapsToSourceFamilyIds",
  "privateDetailsStored",
  "requiredForFeatureOnlyPreferredPair",
  "requiredForOutcomeLinkedRecipe",
  "safeCompletionMeaning",
]);
const ALLOWED_ORDINARY_SUBMITTER_COMPLETION_MODE_KEYS = new Set<string>([
  "modeId",
  "modeType",
  "modelEvidenceCandidate",
  "nextActionAfterR1150",
  "outcomeLinkageRequired",
  "privateDetailsStored",
  "requiredAggregateReadinessFactIds",
  "requiredAttestationKeys",
  "requiredChecklistIds",
  "requiredSourceFamilyIds",
  "rowLevelDataAccepted",
  "safeCompletionMeaning",
]);
const R1150_INTAKE_COMMAND =
  "MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_PATH=<safe-availability-confirmation.json> pnpm exec tsx scripts/murph-age/r1150-ordinary-consumer-safe-availability-confirmation-intake.ts" as const;
const R1144_RECIPE_READINESS_CHAIN_RUNNER_COMMAND =
  "MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_PATH=<r1150-intake.json> MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ID=lab_plus_wearable_minimum_manifest pnpm exec tsx scripts/murph-age/r1144-ordinary-consumer-recipe-readiness-chain-runner.ts" as const;
const R1153_FEATURE_ONLY_CHAIN_RUNNER_COMMAND =
  "MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_PATH=<safe-availability-confirmation.json> pnpm exec tsx scripts/murph-age/r1153-ordinary-consumer-feature-only-chain-runner.ts" as const;

const R1149_EXPECTED = {
  artifact: "r1149-ordinary-consumer-lab-wearable-submission-kit.latest.json",
  packetId: "r1149-ordinary-consumer-lab-wearable-submission-kit",
  schemaVersion: "murph-age-r1149-ordinary-consumer-lab-wearable-submission-kit.v1",
} as const;

type ConfirmationStatus =
  | "available"
  | "invalid_json_object"
  | "missing"
  | "parse_error"
  | "read_error"
  | "unexpected_keys";
type IntakeConclusion =
  | "safe_availability_confirmation_feature_only_ready_research_only"
  | "safe_availability_confirmation_incomplete"
  | "safe_availability_confirmation_invalid"
  | "safe_availability_confirmation_not_provided"
  | "safe_availability_confirmation_ready_for_recipe_readiness_chain"
  | "safe_availability_confirmation_waiting_on_r1149_submitter_kit";
type IntakeNextAction =
  | "complete_safe_availability_confirmation_template"
  | "fill_safe_availability_confirmation_from_template"
  | "refresh_r1149_submitter_kit"
  | "rerun_safe_availability_confirmation_with_valid_json_object"
  | "run_r1153_feature_only_chain_with_safe_availability"
  | "run_r1144_recipe_readiness_chain_with_confirmed_availability";
type ExpectedRouteId = typeof EXPECTED_ROUTE_IDS[number];
type RequiredSourceFamilyId = typeof REQUIRED_SOURCE_FAMILY_IDS[number];
type FeatureOnlySourceFamilyId = typeof FEATURE_ONLY_SOURCE_FAMILY_IDS[number];
type OptionalAddOnFamilyId = typeof OPTIONAL_ADD_ON_FAMILY_IDS[number];
type SourceFamilyId = RequiredSourceFamilyId | OptionalAddOnFamilyId;
type RequiredAttestationKey = typeof REQUIRED_ATTESTATION_KEYS[number];
type RequiredAggregateReadinessFactId = typeof REQUIRED_AGGREGATE_READINESS_FACT_IDS[number];
type BlockedConfirmationContent = typeof BLOCKED_CONFIRMATION_CONTENT[number];
type OrdinarySubmitterInputKindId =
  | "lab_portal_export_or_spreadsheet"
  | "phone_watch_or_wearable_activity_export"
  | "optional_vitals_or_body_context";
type OrdinarySubmitterSafeCompletionCheckId =
  | "confirm_target_age_band_without_identifiers"
  | "confirm_glycemia_bloodwork_export_available"
  | "confirm_daily_wearable_activity_export_available"
  | "confirm_no_private_values_in_confirmation"
  | "confirm_outcome_linkage_and_time_alignment_if_model_evidence"
  | "confirm_aggregate_count_bands_if_model_evidence";
type OrdinarySubmitterCompletionModeId =
  | "feature_only_lab_wearable_coverage"
  | "outcome_linked_lab_wearable_model_evidence";
type OrdinarySubmitterCompletionModeType =
  | "feature_only_coverage"
  | "outcome_linked_model_evidence";
type OrdinarySubmitterCompletionModeNextAction =
  | "run_r1144_recipe_readiness_chain"
  | "run_r1153_feature_only_chain";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface ConfirmationInput {
  aggregateReadinessFacts?: {
    eventCountBand?: unknown;
    outcomeLinked?: unknown;
    sameDenominator?: unknown;
    targetAgeBand?: unknown;
    usableRecordCountBand?: unknown;
  };
  attestations?: Partial<Record<RequiredAttestationKey, unknown>>;
  recipeId?: unknown;
  rowOwnerAssertionsConfirmed?: unknown;
  schemaVersion?: unknown;
  sourceFamilies?: Array<{
    available?: unknown;
    familyId?: unknown;
  }>;
  targetAgeBand?: unknown;
  targetInputPriority?: unknown;
}

interface ConfirmationReadResult {
  confirmation: ConfirmationInput | null;
  status: ConfirmationStatus;
}

interface ValidationResult {
  aggregateReadinessFactsComplete: boolean;
  attestationStatus: "complete" | "missing_or_false" | "not_provided";
  featureOnlySourceFamilyStatus: "complete" | "missing_or_false" | "not_provided";
  missingAggregateReadinessFactIds: RequiredAggregateReadinessFactId[];
  missingAttestationKeys: RequiredAttestationKey[];
  missingFeatureOnlySourceFamilyIds: FeatureOnlySourceFamilyId[];
  missingRequiredSourceFamilyIds: RequiredSourceFamilyId[];
  recipeStatus: "complete" | "missing_or_mismatch" | "not_provided";
  rowOwnerAssertionsConfirmed: boolean | null;
  sourceFamilyStatus: "complete" | "missing_or_false" | "not_provided";
  targetStatus: "complete" | "missing_or_mismatch" | "not_provided";
}

interface OrdinarySubmitterInputKind {
  inputKindId: OrdinarySubmitterInputKindId;
  mapsToSourceFamilyIds: SourceFamilyId[];
  privateDetailsStored: false;
  requiredForFeatureOnlyPreferredPair: boolean;
  safeSubmitterExample: string;
}

interface OrdinarySubmitterSafeCompletionChecklistItem {
  checkId: OrdinarySubmitterSafeCompletionCheckId;
  mapsToSourceFamilyIds: SourceFamilyId[];
  privateDetailsStored: false;
  requiredForFeatureOnlyPreferredPair: boolean;
  requiredForOutcomeLinkedRecipe: boolean;
  safeCompletionMeaning: string;
}

interface OrdinarySubmitterCompletionMode {
  modeId: OrdinarySubmitterCompletionModeId;
  modeType: OrdinarySubmitterCompletionModeType;
  modelEvidenceCandidate: boolean;
  nextActionAfterR1150: OrdinarySubmitterCompletionModeNextAction;
  outcomeLinkageRequired: boolean;
  privateDetailsStored: false;
  requiredAggregateReadinessFactIds: RequiredAggregateReadinessFactId[];
  requiredAttestationKeys: RequiredAttestationKey[];
  requiredChecklistIds: OrdinarySubmitterSafeCompletionCheckId[];
  requiredSourceFamilyIds: SourceFamilyId[];
  rowLevelDataAccepted: false;
  safeCompletionMeaning: string;
}

export interface R1150OrdinaryConsumerSafeAvailabilityConfirmationIntakeOptions {
  confirmationPath?: string;
  createdAt?: string;
  outputDir?: string;
  r1149Path?: string;
}

export interface R1150OrdinaryConsumerSafeAvailabilityConfirmationIntakeOutput {
  artifactBoundary: {
    aggregateOnly: true;
    availabilityConfirmationPathStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    confirmationReadErrorStored: false;
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
    rowParsingPerformedByR1150: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: {
    r1149: ArtifactSummary;
  };
  packetId: "r1150-ordinary-consumer-safe-availability-confirmation-intake";
  productDisplayAuthorized: false;
  safeAvailabilityConfirmationIntake: {
    aggregateReadinessFactsComplete: boolean;
    attestationStatus: ValidationResult["attestationStatus"];
    blockedConfirmationContent: BlockedConfirmationContent[];
    commands: {
      featureOnlyChainRunnerCommand: typeof R1153_FEATURE_ONLY_CHAIN_RUNNER_COMMAND;
      recipeReadinessChainRunnerCommand: typeof R1144_RECIPE_READINESS_CHAIN_RUNNER_COMMAND;
      safeAvailabilityConfirmationIntakeCommand: typeof R1150_INTAKE_COMMAND;
    };
    confirmationPathConfigured: boolean;
    confirmationStatus: ConfirmationStatus;
    expectedRouteIds: ExpectedRouteId[];
    featureOnlyCoverageContextReady: boolean;
    featureOnlyCoverageRequiresPreferredPair: true;
    featureOnlySourceFamilyStatus: ValidationResult["featureOnlySourceFamilyStatus"];
    fillableTemplateArtifact: typeof FILLABLE_TEMPLATE_FILE_NAME;
    featureOnlyFillableTemplateArtifact: typeof FEATURE_ONLY_FILLABLE_TEMPLATE_FILE_NAME;
    fillableTemplateSchemaVersion: typeof CONFIRMATION_SCHEMA_VERSION;
    minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
    missingAggregateReadinessFactIds: RequiredAggregateReadinessFactId[];
    missingAttestationKeys: RequiredAttestationKey[];
    missingFeatureOnlySourceFamilyIds: FeatureOnlySourceFamilyId[];
    missingRequiredSourceFamilyIds: RequiredSourceFamilyId[];
    optionalAddOnFamilyIds: OptionalAddOnFamilyId[];
    ordinarySubmitterCompletionModes: OrdinarySubmitterCompletionMode[];
    ordinarySubmitterSafeCompletionChecklist: OrdinarySubmitterSafeCompletionChecklistItem[];
    ordinarySubmitterInputKinds: OrdinarySubmitterInputKind[];
    outcomeLinkageRequiredForFeatureOnlyContext: false;
    preferredRecipeId: typeof PREFERRED_RECIPE_ID;
    privateDetailsStored: false;
    r1149SubmitterKitFeatureOnlyGuardPresent: boolean;
    r1149SubmitterKitReadyForSafeConfirmation: boolean;
    recipeStatus: ValidationResult["recipeStatus"];
    requiredSourceFamilyIds: RequiredSourceFamilyId[];
    rowOwnerAssertionsConfirmed: boolean | null;
    rowLevelDataAcceptedByR1150: false;
    safeConfirmationReadyForR1143: boolean;
    sourceFamilyStatus: ValidationResult["sourceFamilyStatus"];
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
    targetStatus: ValidationResult["targetStatus"];
    templateWritten: true;
  };
  schemaVersion: typeof R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: IntakeConclusion;
    confirmationPathConfigured: boolean;
    confirmationStatus: ConfirmationStatus;
    expectedRouteIds: ExpectedRouteId[];
    featureOnlyCoverageContextReady: boolean;
    featureOnlyCoverageRequiresPreferredPair: true;
    minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
    missingAggregateReadinessFactIds: RequiredAggregateReadinessFactId[];
    missingAttestationKeys: RequiredAttestationKey[];
    missingFeatureOnlySourceFamilyIds: FeatureOnlySourceFamilyId[];
    missingRequiredSourceFamilyIds: RequiredSourceFamilyId[];
    nextAction: IntakeNextAction;
    outcomeLinkageRequiredForFeatureOnlyContext: false;
    ordinarySubmitterCompletionModeIds: OrdinarySubmitterCompletionModeId[];
    ordinarySubmitterSafeCompletionChecklistItemIds: OrdinarySubmitterSafeCompletionCheckId[];
    productDisplayAuthorized: false;
    r1149SubmitterKitFeatureOnlyGuardPresent: boolean;
    r1149SubmitterKitReadyForSafeConfirmation: boolean;
    readyForRecipeReadinessChain: boolean;
    reviewGptRequiredNow: false;
    rowOwnerAssertionsConfirmed: boolean | null;
    rowLevelDataAcceptedByR1150: false;
    rowParsingPerformedByR1150: false;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
    templateArtifact: typeof FILLABLE_TEMPLATE_FILE_NAME;
    featureOnlyTemplateArtifact: typeof FEATURE_ONLY_FILLABLE_TEMPLATE_FILE_NAME;
  };
}

export async function runR1150OrdinaryConsumerSafeAvailabilityConfirmationIntake(
  options: R1150OrdinaryConsumerSafeAvailabilityConfirmationIntakeOptions = {},
): Promise<{
  featureOnlyTemplatePath: string;
  output: R1150OrdinaryConsumerSafeAvailabilityConfirmationIntakeOutput;
  outputPath: string;
  templatePath: string;
}> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const r1149 = await readJsonIfPresent(options.r1149Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1149_EXPECTED.artifact));
  validateInputBoundary("r1149", r1149);
  const r1149Expected = matchesExpected(r1149, R1149_EXPECTED);
  const r1149SubmitterKitFeatureOnlyGuardPresent = r1149FeatureOnlyGuardPresent(r1149);
  const r1149SubmitterKitReadyForSafeConfirmation = r1149Expected
    && r1149SubmitterKitFeatureOnlyGuardPresent;
  const confirmationRead = await readConfirmation(options.confirmationPath);
  validateInputBoundary("confirmation", confirmationRead.confirmation);
  const validation = validateConfirmation(confirmationRead.confirmation);
  const ordinarySubmitterChecklist = ordinarySubmitterSafeCompletionChecklist();
  const ordinarySubmitterModes = ordinarySubmitterCompletionModes();
  const readyForRecipeReadinessChain = r1149SubmitterKitReadyForSafeConfirmation
    && confirmationRead.status === "available"
    && validation.rowOwnerAssertionsConfirmed === true
    && validation.recipeStatus === "complete"
    && validation.targetStatus === "complete"
    && validation.sourceFamilyStatus === "complete"
    && validation.attestationStatus === "complete"
    && validation.aggregateReadinessFactsComplete;
  const featureOnlyCoverageContextReady = r1149SubmitterKitReadyForSafeConfirmation
    && confirmationRead.status === "available"
    && validation.rowOwnerAssertionsConfirmed === true
    && validation.recipeStatus === "complete"
    && validation.targetStatus === "complete"
    && validation.featureOnlySourceFamilyStatus === "complete"
    && validation.attestationStatus === "complete";
  const conclusion = conclusionFor({
    confirmationStatus: confirmationRead.status,
    featureOnlyCoverageContextReady,
    r1149SubmitterKitReadyForSafeConfirmation,
    readyForRecipeReadinessChain,
  });
  const output: R1150OrdinaryConsumerSafeAvailabilityConfirmationIntakeOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: {
      r1149: summarizeInput(r1149),
    },
    packetId: "r1150-ordinary-consumer-safe-availability-confirmation-intake",
    productDisplayAuthorized: false,
    safeAvailabilityConfirmationIntake: {
      aggregateReadinessFactsComplete: validation.aggregateReadinessFactsComplete,
      attestationStatus: validation.attestationStatus,
      blockedConfirmationContent: [...BLOCKED_CONFIRMATION_CONTENT],
      commands: {
        featureOnlyChainRunnerCommand: R1153_FEATURE_ONLY_CHAIN_RUNNER_COMMAND,
        recipeReadinessChainRunnerCommand: R1144_RECIPE_READINESS_CHAIN_RUNNER_COMMAND,
        safeAvailabilityConfirmationIntakeCommand: R1150_INTAKE_COMMAND,
      },
      confirmationPathConfigured: options.confirmationPath !== undefined && options.confirmationPath.trim() !== "",
      confirmationStatus: confirmationRead.status,
      expectedRouteIds: [...EXPECTED_ROUTE_IDS],
      featureOnlyCoverageContextReady,
      featureOnlyCoverageRequiresPreferredPair: true,
      featureOnlySourceFamilyStatus: validation.featureOnlySourceFamilyStatus,
      fillableTemplateArtifact: FILLABLE_TEMPLATE_FILE_NAME,
      featureOnlyFillableTemplateArtifact: FEATURE_ONLY_FILLABLE_TEMPLATE_FILE_NAME,
      fillableTemplateSchemaVersion: CONFIRMATION_SCHEMA_VERSION,
      minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      missingAggregateReadinessFactIds: validation.missingAggregateReadinessFactIds,
      missingAttestationKeys: validation.missingAttestationKeys,
      missingFeatureOnlySourceFamilyIds: validation.missingFeatureOnlySourceFamilyIds,
      missingRequiredSourceFamilyIds: validation.missingRequiredSourceFamilyIds,
      optionalAddOnFamilyIds: [...OPTIONAL_ADD_ON_FAMILY_IDS],
      ordinarySubmitterCompletionModes: ordinarySubmitterModes,
      ordinarySubmitterSafeCompletionChecklist: ordinarySubmitterChecklist,
      ordinarySubmitterInputKinds: ordinarySubmitterInputKinds(),
      outcomeLinkageRequiredForFeatureOnlyContext: false,
      preferredRecipeId: PREFERRED_RECIPE_ID,
      privateDetailsStored: false,
      r1149SubmitterKitFeatureOnlyGuardPresent,
      r1149SubmitterKitReadyForSafeConfirmation,
      recipeStatus: validation.recipeStatus,
      requiredSourceFamilyIds: [...REQUIRED_SOURCE_FAMILY_IDS],
      rowOwnerAssertionsConfirmed: validation.rowOwnerAssertionsConfirmed,
      rowLevelDataAcceptedByR1150: false,
      safeConfirmationReadyForR1143: readyForRecipeReadinessChain,
      sourceFamilyStatus: validation.sourceFamilyStatus,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
      targetStatus: validation.targetStatus,
      templateWritten: true,
    },
    schemaVersion: R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      confirmationPathConfigured: options.confirmationPath !== undefined && options.confirmationPath.trim() !== "",
      confirmationStatus: confirmationRead.status,
      expectedRouteIds: [...EXPECTED_ROUTE_IDS],
      featureOnlyCoverageContextReady,
      featureOnlyCoverageRequiresPreferredPair: true,
      minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      missingAggregateReadinessFactIds: validation.missingAggregateReadinessFactIds,
      missingAttestationKeys: validation.missingAttestationKeys,
      missingFeatureOnlySourceFamilyIds: validation.missingFeatureOnlySourceFamilyIds,
      missingRequiredSourceFamilyIds: validation.missingRequiredSourceFamilyIds,
      nextAction: nextActionFor(conclusion),
      outcomeLinkageRequiredForFeatureOnlyContext: false,
      ordinarySubmitterCompletionModeIds: ordinarySubmitterModes.map((mode) => mode.modeId),
      ordinarySubmitterSafeCompletionChecklistItemIds: ordinarySubmitterChecklist.map((item) => item.checkId),
      productDisplayAuthorized: false,
      r1149SubmitterKitFeatureOnlyGuardPresent,
      r1149SubmitterKitReadyForSafeConfirmation,
      readyForRecipeReadinessChain: readyForRecipeReadinessChain,
      reviewGptRequiredNow: false,
      rowOwnerAssertionsConfirmed: validation.rowOwnerAssertionsConfirmed,
      rowLevelDataAcceptedByR1150: false,
      rowParsingPerformedByR1150: false,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
      templateArtifact: FILLABLE_TEMPLATE_FILE_NAME,
      featureOnlyTemplateArtifact: FEATURE_ONLY_FILLABLE_TEMPLATE_FILE_NAME,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1150 safe availability confirmation intake failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  await mkdir(outputDir, { recursive: true });
  const templatePath = path.join(outputDir, FILLABLE_TEMPLATE_FILE_NAME);
  await writeFile(templatePath, `${JSON.stringify(fillableTemplate(), null, 2)}\n`);
  const featureOnlyTemplatePath = path.join(outputDir, FEATURE_ONLY_FILLABLE_TEMPLATE_FILE_NAME);
  await writeFile(featureOnlyTemplatePath, `${JSON.stringify(featureOnlyFillableTemplate(), null, 2)}\n`);
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { featureOnlyTemplatePath, output, outputPath, templatePath };
}

function validateConfirmation(confirmation: ConfirmationInput | null): ValidationResult {
  if (!confirmation) {
    return {
      aggregateReadinessFactsComplete: false,
      attestationStatus: "not_provided",
      featureOnlySourceFamilyStatus: "not_provided",
      missingAggregateReadinessFactIds: [...REQUIRED_AGGREGATE_READINESS_FACT_IDS],
      missingAttestationKeys: [...REQUIRED_ATTESTATION_KEYS],
      missingFeatureOnlySourceFamilyIds: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      missingRequiredSourceFamilyIds: [...REQUIRED_SOURCE_FAMILY_IDS],
      recipeStatus: "not_provided",
      rowOwnerAssertionsConfirmed: null,
      sourceFamilyStatus: "not_provided",
      targetStatus: "not_provided",
    };
  }

  const missingRequiredSourceFamilyIds = REQUIRED_SOURCE_FAMILY_IDS.filter((familyId) =>
    sourceFamilyAvailable(confirmation, familyId) !== true
  );
  const missingFeatureOnlySourceFamilyIds = FEATURE_ONLY_SOURCE_FAMILY_IDS.filter((familyId) =>
    sourceFamilyAvailable(confirmation, familyId) !== true
  );
  const missingAttestationKeys = REQUIRED_ATTESTATION_KEYS.filter((key) =>
    readBooleanAt(confirmation, ["attestations", key]) !== true
  );
  const missingAggregateReadinessFactIds = REQUIRED_AGGREGATE_READINESS_FACT_IDS.filter((factId) =>
    aggregateReadinessFactComplete(confirmation, factId) !== true
  );

  return {
    aggregateReadinessFactsComplete: missingAggregateReadinessFactIds.length === 0,
    attestationStatus: missingAttestationKeys.length === 0 ? "complete" : "missing_or_false",
    featureOnlySourceFamilyStatus: missingFeatureOnlySourceFamilyIds.length === 0 ? "complete" : "missing_or_false",
    missingAggregateReadinessFactIds,
    missingAttestationKeys,
    missingFeatureOnlySourceFamilyIds,
    missingRequiredSourceFamilyIds,
    recipeStatus: readStringAt(confirmation, ["recipeId"]) === PREFERRED_RECIPE_ID
      && readStringAt(confirmation, ["schemaVersion"]) === CONFIRMATION_SCHEMA_VERSION
      ? "complete"
      : "missing_or_mismatch",
    rowOwnerAssertionsConfirmed: readBooleanAt(confirmation, ["rowOwnerAssertionsConfirmed"]),
    sourceFamilyStatus: missingRequiredSourceFamilyIds.length === 0 ? "complete" : "missing_or_false",
    targetStatus: readStringAt(confirmation, ["targetAgeBand"]) === TARGET_AGE_BAND
      && readStringAt(confirmation, ["targetInputPriority"]) === TARGET_INPUT_PRIORITY
      ? "complete"
      : "missing_or_mismatch",
  };
}

function aggregateReadinessFactComplete(
  confirmation: ConfirmationInput,
  factId: RequiredAggregateReadinessFactId,
): boolean {
  if (factId === "outcomeLinked") return readBooleanAt(confirmation, ["aggregateReadinessFacts", factId]) === true;
  if (factId === "sameDenominator") return readBooleanAt(confirmation, ["aggregateReadinessFacts", factId]) === true;
  if (factId === "targetAgeBand") {
    return readStringAt(confirmation, ["aggregateReadinessFacts", factId]) === TARGET_AGE_BAND;
  }
  if (factId === "usableRecordCountBand") {
    return readStringAt(confirmation, ["aggregateReadinessFacts", factId]) === "50_plus";
  }
  return readStringAt(confirmation, ["aggregateReadinessFacts", factId]) === "10_plus";
}

function sourceFamilyAvailable(confirmation: ConfirmationInput, familyId: SourceFamilyId): boolean | null {
  const families = Array.isArray(confirmation.sourceFamilies) ? confirmation.sourceFamilies : [];
  const match = families.find((family) => family.familyId === familyId);
  if (!match) return null;
  return match.available === true;
}

function fillableTemplate(): {
  aggregateReadinessFacts: {
    eventCountBand: "not_confirmed";
    outcomeLinked: false;
    sameDenominator: false;
    targetAgeBand: typeof TARGET_AGE_BAND;
    usableRecordCountBand: "not_confirmed";
  };
  attestations: Record<RequiredAttestationKey, false>;
  blockedConfirmationContent: BlockedConfirmationContent[];
  featureOnlyCoverageRequiresPreferredPair: true;
  minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
  ordinarySubmitterCompletionModes: OrdinarySubmitterCompletionMode[];
  ordinarySubmitterInputKinds: OrdinarySubmitterInputKind[];
  ordinarySubmitterSafeCompletionChecklist: OrdinarySubmitterSafeCompletionChecklistItem[];
  outcomeLinkageRequiredForFeatureOnlyContext: false;
  recipeId: typeof PREFERRED_RECIPE_ID;
  rowOwnerAssertionsConfirmed: false;
  rowLevelDataAcceptedByR1150: false;
  schemaVersion: typeof CONFIRMATION_SCHEMA_VERSION;
  sourceFamilies: Array<{
    available: false;
    familyId: SourceFamilyId;
    requiredForFeatureOnlyPreferredPair: boolean;
    requiredForRecommendedRecipe: boolean;
    safeConfirmationMeaning: string;
  }>;
  targetAgeBand: typeof TARGET_AGE_BAND;
  targetInputPriority: typeof TARGET_INPUT_PRIORITY;
} {
  const attestations = Object.fromEntries(REQUIRED_ATTESTATION_KEYS.map((key) => [key, false])) as Record<
    RequiredAttestationKey,
    false
  >;
  return {
    aggregateReadinessFacts: {
      eventCountBand: "not_confirmed",
      outcomeLinked: false,
      sameDenominator: false,
      targetAgeBand: TARGET_AGE_BAND,
      usableRecordCountBand: "not_confirmed",
    },
    attestations,
    blockedConfirmationContent: [...BLOCKED_CONFIRMATION_CONTENT],
    featureOnlyCoverageRequiresPreferredPair: true,
    minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
    ordinarySubmitterCompletionModes: ordinarySubmitterCompletionModes(),
    ordinarySubmitterInputKinds: ordinarySubmitterInputKinds(),
    ordinarySubmitterSafeCompletionChecklist: ordinarySubmitterSafeCompletionChecklist(),
    outcomeLinkageRequiredForFeatureOnlyContext: false,
    recipeId: PREFERRED_RECIPE_ID,
    rowOwnerAssertionsConfirmed: false,
    rowLevelDataAcceptedByR1150: false,
    schemaVersion: CONFIRMATION_SCHEMA_VERSION,
    sourceFamilies: [...REQUIRED_SOURCE_FAMILY_IDS, ...OPTIONAL_ADD_ON_FAMILY_IDS].map((familyId) => ({
      available: false,
      familyId,
      requiredForFeatureOnlyPreferredPair: featureOnlySourceFamilyIdsSet.has(familyId),
      requiredForRecommendedRecipe: requiredSourceFamilyIdsSet.has(familyId),
      safeConfirmationMeaning: safeConfirmationMeaningFor(familyId),
    })),
    targetAgeBand: TARGET_AGE_BAND,
    targetInputPriority: TARGET_INPUT_PRIORITY,
  };
}

function featureOnlyFillableTemplate(): {
  aggregateReadinessFacts: {
    eventCountBand: "not_confirmed";
    outcomeLinked: false;
    sameDenominator: false;
    targetAgeBand: typeof TARGET_AGE_BAND;
    usableRecordCountBand: "not_confirmed";
  };
  attestations: Record<RequiredAttestationKey, false>;
  blockedConfirmationContent: BlockedConfirmationContent[];
  featureOnlyCoverageRequiresPreferredPair: true;
  minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
  outcomeLinkageRequiredForFeatureOnlyContext: false;
  recipeId: typeof PREFERRED_RECIPE_ID;
  rowOwnerAssertionsConfirmed: false;
  rowLevelDataAcceptedByR1150: false;
  schemaVersion: typeof CONFIRMATION_SCHEMA_VERSION;
  sourceFamilies: Array<{
    available: false;
    familyId: FeatureOnlySourceFamilyId;
    requiredForFeatureOnlyPreferredPair: true;
    requiredForRecommendedRecipe: true;
    safeConfirmationMeaning: string;
  }>;
  targetAgeBand: typeof TARGET_AGE_BAND;
  targetInputPriority: typeof TARGET_INPUT_PRIORITY;
} {
  const attestations = Object.fromEntries(REQUIRED_ATTESTATION_KEYS.map((key) => [key, false])) as Record<
    RequiredAttestationKey,
    false
  >;
  return {
    aggregateReadinessFacts: {
      eventCountBand: "not_confirmed",
      outcomeLinked: false,
      sameDenominator: false,
      targetAgeBand: TARGET_AGE_BAND,
      usableRecordCountBand: "not_confirmed",
    },
    attestations,
    blockedConfirmationContent: [...BLOCKED_CONFIRMATION_CONTENT],
    featureOnlyCoverageRequiresPreferredPair: true,
    minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
    outcomeLinkageRequiredForFeatureOnlyContext: false,
    recipeId: PREFERRED_RECIPE_ID,
    rowOwnerAssertionsConfirmed: false,
    rowLevelDataAcceptedByR1150: false,
    schemaVersion: CONFIRMATION_SCHEMA_VERSION,
    sourceFamilies: FEATURE_ONLY_SOURCE_FAMILY_IDS.map((familyId) => ({
      available: false,
      familyId,
      requiredForFeatureOnlyPreferredPair: true,
      requiredForRecommendedRecipe: true,
      safeConfirmationMeaning: safeConfirmationMeaningFor(familyId),
    })),
    targetAgeBand: TARGET_AGE_BAND,
    targetInputPriority: TARGET_INPUT_PRIORITY,
  };
}

const requiredSourceFamilyIdsSet = new Set<string>(REQUIRED_SOURCE_FAMILY_IDS);
const featureOnlySourceFamilyIdsSet = new Set<string>(FEATURE_ONLY_SOURCE_FAMILY_IDS);

function ordinarySubmitterInputKinds(): OrdinarySubmitterInputKind[] {
  return [
    {
      inputKindId: "lab_portal_export_or_spreadsheet",
      mapsToSourceFamilyIds: ["bloodwork_glycemia", "common_bloodwork_core"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: true,
      safeSubmitterExample: "A normal lab portal export or spreadsheet can confirm glycemia labs exist without sharing private labels, headers, or row values.",
    },
    {
      inputKindId: "phone_watch_or_wearable_activity_export",
      mapsToSourceFamilyIds: ["wearable_activity_daily"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: true,
      safeSubmitterExample: "A phone, watch, or wearable daily activity export can confirm activity coverage without sharing private labels, headers, or row values.",
    },
    {
      inputKindId: "optional_vitals_or_body_context",
      mapsToSourceFamilyIds: ["vitals_body_context"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: false,
      safeSubmitterExample: "Optional body or vitals context can be declared as available without sharing private labels, headers, or row values.",
    },
  ];
}

function ordinarySubmitterSafeCompletionChecklist(): OrdinarySubmitterSafeCompletionChecklistItem[] {
  return [
    {
      checkId: "confirm_target_age_band_without_identifiers",
      mapsToSourceFamilyIds: [],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: true,
      requiredForOutcomeLinkedRecipe: true,
      safeCompletionMeaning:
        "Confirm the submission belongs on the roughly 16-50 ordinary submitter path without sharing birth dates, names, account identifiers, or row values.",
    },
    {
      checkId: "confirm_glycemia_bloodwork_export_available",
      mapsToSourceFamilyIds: ["bloodwork_glycemia"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: true,
      requiredForOutcomeLinkedRecipe: true,
      safeCompletionMeaning:
        "Confirm an ordinary lab portal export or spreadsheet can cover glycemia bloodwork availability without sharing lab names, headers, values, files, or paths.",
    },
    {
      checkId: "confirm_daily_wearable_activity_export_available",
      mapsToSourceFamilyIds: ["wearable_activity_daily"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: true,
      requiredForOutcomeLinkedRecipe: true,
      safeCompletionMeaning:
        "Confirm a phone, watch, or wearable export can cover daily activity availability without sharing device account identifiers, headers, values, files, or paths.",
    },
    {
      checkId: "confirm_no_private_values_in_confirmation",
      mapsToSourceFamilyIds: [],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: true,
      requiredForOutcomeLinkedRecipe: true,
      safeCompletionMeaning:
        "Confirm the completed availability JSON contains only booleans, safe IDs, and coarse bands, with no private rows, headers, identifiers, file names, paths, predictions, coefficients, or source text.",
    },
    {
      checkId: "confirm_outcome_linkage_and_time_alignment_if_model_evidence",
      mapsToSourceFamilyIds: ["outcome_linkage", "join_time_alignment"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: false,
      requiredForOutcomeLinkedRecipe: true,
      safeCompletionMeaning:
        "For outcome-linked model evidence, confirm outcomes and time alignment can be joined to the same eligible people without exposing join keys, dates, row values, or headers.",
    },
    {
      checkId: "confirm_aggregate_count_bands_if_model_evidence",
      mapsToSourceFamilyIds: [],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: false,
      requiredForOutcomeLinkedRecipe: true,
      safeCompletionMeaning:
        "For outcome-linked model evidence, confirm only coarse usable-record and event-count bands; do not include raw counts if they would disclose small cells.",
    },
  ];
}

function ordinarySubmitterCompletionModes(): OrdinarySubmitterCompletionMode[] {
  return [
    {
      modeId: "feature_only_lab_wearable_coverage",
      modeType: "feature_only_coverage",
      modelEvidenceCandidate: false,
      nextActionAfterR1150: "run_r1153_feature_only_chain",
      outcomeLinkageRequired: false,
      privateDetailsStored: false,
      requiredAggregateReadinessFactIds: ["targetAgeBand"],
      requiredAttestationKeys: [...REQUIRED_ATTESTATION_KEYS],
      requiredChecklistIds: [
        "confirm_target_age_band_without_identifiers",
        "confirm_glycemia_bloodwork_export_available",
        "confirm_daily_wearable_activity_export_available",
        "confirm_no_private_values_in_confirmation",
      ],
      requiredSourceFamilyIds: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      rowLevelDataAccepted: false,
      safeCompletionMeaning:
        "Minimum ordinary submitter path: confirm only the roughly 16-50 scope, glycemia bloodwork availability, daily wearable activity availability, and privacy attestations for research-only coverage planning.",
    },
    {
      modeId: "outcome_linked_lab_wearable_model_evidence",
      modeType: "outcome_linked_model_evidence",
      modelEvidenceCandidate: true,
      nextActionAfterR1150: "run_r1144_recipe_readiness_chain",
      outcomeLinkageRequired: true,
      privateDetailsStored: false,
      requiredAggregateReadinessFactIds: [...REQUIRED_AGGREGATE_READINESS_FACT_IDS],
      requiredAttestationKeys: [...REQUIRED_ATTESTATION_KEYS],
      requiredChecklistIds: ordinarySubmitterSafeCompletionChecklist().map((item) => item.checkId),
      requiredSourceFamilyIds: [...REQUIRED_SOURCE_FAMILY_IDS],
      rowLevelDataAccepted: false,
      safeCompletionMeaning:
        "Outcome-linked model-evidence path: confirm lab plus wearable availability, outcome/time alignment, same-denominator readiness, and only coarse count bands before running recipe readiness.",
    },
  ];
}

function safeConfirmationMeaningFor(familyId: SourceFamilyId): string {
  if (familyId === "outcome_linkage") {
    return "An outcome or follow-up source can be linked to the same eligible people as the lab and wearable data.";
  }
  if (familyId === "join_time_alignment") {
    return "The row owner can align people and dates or times across the sources without exposing the join values.";
  }
  if (familyId === "bloodwork_glycemia") {
    return "The row owner has ordinary glycemia bloodwork fields such as glucose or HbA1c in an export or spreadsheet.";
  }
  if (familyId === "wearable_activity_daily") {
    return "The row owner has daily activity data from a watch, phone, or wearable export.";
  }
  if (familyId === "common_bloodwork_core") {
    return "The row owner has common bloodwork add-ons beyond glycemia, if available.";
  }
  return "The row owner has body-context values such as blood pressure, BMI, height, or weight, if available.";
}

function conclusionFor(input: {
  confirmationStatus: ConfirmationStatus;
  featureOnlyCoverageContextReady: boolean;
  r1149SubmitterKitReadyForSafeConfirmation: boolean;
  readyForRecipeReadinessChain: boolean;
}): IntakeConclusion {
  if (!input.r1149SubmitterKitReadyForSafeConfirmation) {
    return "safe_availability_confirmation_waiting_on_r1149_submitter_kit";
  }
  if (input.confirmationStatus === "missing") return "safe_availability_confirmation_not_provided";
  if (input.confirmationStatus !== "available") return "safe_availability_confirmation_invalid";
  if (input.readyForRecipeReadinessChain) {
    return "safe_availability_confirmation_ready_for_recipe_readiness_chain";
  }
  if (input.featureOnlyCoverageContextReady) {
    return "safe_availability_confirmation_feature_only_ready_research_only";
  }
  return "safe_availability_confirmation_incomplete";
}

function nextActionFor(conclusion: IntakeConclusion): IntakeNextAction {
  if (conclusion === "safe_availability_confirmation_waiting_on_r1149_submitter_kit") {
    return "refresh_r1149_submitter_kit";
  }
  if (conclusion === "safe_availability_confirmation_not_provided") {
    return "fill_safe_availability_confirmation_from_template";
  }
  if (conclusion === "safe_availability_confirmation_invalid") {
    return "rerun_safe_availability_confirmation_with_valid_json_object";
  }
  if (conclusion === "safe_availability_confirmation_ready_for_recipe_readiness_chain") {
    return "run_r1144_recipe_readiness_chain_with_confirmed_availability";
  }
  if (conclusion === "safe_availability_confirmation_feature_only_ready_research_only") {
    return "run_r1153_feature_only_chain_with_safe_availability";
  }
  return "complete_safe_availability_confirmation_template";
}

async function readConfirmation(confirmationPath: string | undefined): Promise<ConfirmationReadResult> {
  if (!confirmationPath || confirmationPath.trim() === "") {
    return { confirmation: null, status: "missing" };
  }
  let raw: string;
  try {
    raw = await readFile(confirmationPath, "utf8");
  } catch {
    return { confirmation: null, status: "read_error" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { confirmation: null, status: "parse_error" };
  }
  if (!isRecord(parsed)) return { confirmation: null, status: "invalid_json_object" };
  if (!confirmationHasOnlyAllowedKeys(parsed)
    || !confirmationTemplateStaticFieldsAreUnchanged(parsed)
    || confirmationHasBlockedPrivateScalarContent(parsed)) {
    return { confirmation: null, status: "unexpected_keys" };
  }
  return { confirmation: parsed as ConfirmationInput, status: "available" };
}

function confirmationHasOnlyAllowedKeys(confirmation: Record<string, unknown>): boolean {
  return recordOnlyHasKeys(confirmation, ALLOWED_CONFIRMATION_TOP_LEVEL_KEYS)
    && scalarValuesOnlyAtKeys(confirmation, CONFIRMATION_SCALAR_TOP_LEVEL_KEYS)
    && scalarArrayValuesOnlyAtKeys(confirmation, CONFIRMATION_SCALAR_ARRAY_TOP_LEVEL_KEYS)
    && recordValuesOnlyHaveKeys(confirmation.aggregateReadinessFacts, ALLOWED_AGGREGATE_READINESS_FACT_KEYS)
    && recordValuesOnlyHaveKeys(confirmation.attestations, ALLOWED_ATTESTATION_KEYS)
    && arrayItemsOnlyHaveKeys(confirmation.sourceFamilies, ALLOWED_SOURCE_FAMILY_KEYS, new Set())
    && arrayItemsOnlyHaveKeys(
      confirmation.ordinarySubmitterInputKinds,
      ALLOWED_ORDINARY_SUBMITTER_INPUT_KIND_KEYS,
      new Set(["mapsToSourceFamilyIds"]),
    )
    && arrayItemsOnlyHaveKeys(
      confirmation.ordinarySubmitterSafeCompletionChecklist,
      ALLOWED_ORDINARY_SUBMITTER_CHECKLIST_KEYS,
      new Set(["mapsToSourceFamilyIds"]),
    )
    && arrayItemsOnlyHaveKeys(
      confirmation.ordinarySubmitterCompletionModes,
      ALLOWED_ORDINARY_SUBMITTER_COMPLETION_MODE_KEYS,
      new Set([
        "requiredAggregateReadinessFactIds",
        "requiredAttestationKeys",
        "requiredChecklistIds",
        "requiredSourceFamilyIds",
      ]),
    );
}

function confirmationTemplateStaticFieldsAreUnchanged(confirmation: Record<string, unknown>): boolean {
  const template = fillableTemplate();
  return exactTemplateArrayIfPresent(confirmation.blockedConfirmationContent, template.blockedConfirmationContent)
    && exactTemplateArrayIfPresent(confirmation.minimumFeaturePairRequired, template.minimumFeaturePairRequired)
    && exactTemplateArrayIfPresent(confirmation.ordinarySubmitterInputKinds, template.ordinarySubmitterInputKinds)
    && exactTemplateArrayIfPresent(
      confirmation.ordinarySubmitterSafeCompletionChecklist,
      template.ordinarySubmitterSafeCompletionChecklist,
    )
    && exactTemplateArrayIfPresent(
      confirmation.ordinarySubmitterCompletionModes,
      template.ordinarySubmitterCompletionModes,
    )
    && sourceFamilyStaticFieldsMatchTemplate(confirmation.sourceFamilies, template.sourceFamilies);
}

function exactTemplateArrayIfPresent(value: unknown, expected: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (!Array.isArray(value)) return false;
  return JSON.stringify(value) === JSON.stringify(expected);
}

function sourceFamilyStaticFieldsMatchTemplate(
  value: unknown,
  templateSourceFamilies: ReturnType<typeof fillableTemplate>["sourceFamilies"],
): boolean {
  if (value === undefined || value === null) return true;
  if (!Array.isArray(value)) return false;
  const templateByFamilyId = new Map(templateSourceFamilies.map((item) => [item.familyId, item]));
  const staticKeys = [
    "requiredForFeatureOnlyPreferredPair",
    "requiredForRecommendedRecipe",
    "safeConfirmationMeaning",
  ] as const;
  return value.every((item) => {
    if (!isRecord(item)) return false;
    const familyId = readStringAt(item, ["familyId"]);
    if (!familyId) return false;
    const templateItem = templateByFamilyId.get(familyId as SourceFamilyId);
    if (!templateItem) return false;
    return staticKeys.every((key) => item[key] === undefined || item[key] === templateItem[key]);
  });
}

function confirmationHasBlockedPrivateScalarContent(value: unknown): boolean {
  if (typeof value === "string") return scalarTextLooksPrivate(value);
  if (Array.isArray(value)) return value.some((item) => confirmationHasBlockedPrivateScalarContent(item));
  if (isRecord(value)) return Object.values(value).some((item) => confirmationHasBlockedPrivateScalarContent(item));
  return false;
}

function scalarTextLooksPrivate(value: string): boolean {
  const normalized = value.replace(/\\/g, "/");
  const blockedFragments = [
    ["", "Users", ""].join("/"),
    ["", "home", ""].join("/"),
    ["Authorization", ":"].join(""),
    ["Bearer", ""].join(" "),
    ["private", "Header", "Hint"].join(""),
    ["glucose", "private", "column"].join("_"),
  ];
  const lower = value.toLowerCase();
  const blockedLowerFragments = [
    ["s", "k", "-"].join(""),
    ["g", "h", "p", "_"].join(""),
    ["p", "a", "t", "_"].join(""),
    ["x", "o", "x", "b", "-"].join(""),
    ["x", "o", "x", "a", "-"].join(""),
    ["x", "o", "x", "p", "-"].join(""),
    ["x", "o", "x", "r", "-"].join(""),
    ["x", "o", "x", "s", "-"].join(""),
  ];
  return blockedFragments.some((fragment) => normalized.includes(fragment))
    || blockedLowerFragments.some((fragment) => lower.includes(fragment))
    || /\b[A-Za-z]:[\\/]/.test(value);
}

function recordValuesOnlyHaveKeys(value: unknown, allowedKeys: ReadonlySet<string>): boolean {
  if (value === undefined || value === null) return true;
  if (!isRecord(value)) return !Array.isArray(value);
  return recordOnlyHasKeys(value, allowedKeys)
    && Object.values(value).every((entry) => !isRecord(entry) && !Array.isArray(entry));
}

function arrayItemsOnlyHaveKeys(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  scalarArrayKeys: ReadonlySet<string>,
): boolean {
  if (value === undefined || value === null) return true;
  if (!Array.isArray(value)) return !isRecord(value);
  return value.every((item) => {
    if (!isRecord(item)) return false;
    if (!recordOnlyHasKeys(item, allowedKeys)) return false;
    return Object.entries(item).every(([key, entry]) => {
      if (scalarArrayKeys.has(key)) {
        return Array.isArray(entry) && entry.every((arrayItem) => !isRecord(arrayItem) && !Array.isArray(arrayItem));
      }
      return !isRecord(entry) && !Array.isArray(entry);
    });
  });
}

function scalarValuesOnlyAtKeys(value: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
  for (const key of keys) {
    const entry = value[key];
    if (entry !== undefined && (isRecord(entry) || Array.isArray(entry))) return false;
  }
  return true;
}

function scalarArrayValuesOnlyAtKeys(value: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
  for (const key of keys) {
    const entry = value[key];
    if (entry === undefined) continue;
    if (!Array.isArray(entry)) return false;
    if (entry.some((item) => isRecord(item) || Array.isArray(item))) return false;
  }
  return true;
}

function recordOnlyHasKeys(value: Record<string, unknown>, allowedKeys: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function matchesExpected(
  value: unknown | null,
  expected: { packetId: string; schemaVersion: string },
): boolean {
  return readStringAt(value, ["packetId"]) === expected.packetId
    && readStringAt(value, ["schemaVersion"]) === expected.schemaVersion;
}

function r1149FeatureOnlyGuardPresent(value: unknown | null): boolean {
  return matchesExpected(value, R1149_EXPECTED)
    && readBooleanAt(value, ["summary", "featureOnlyModeModelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["summary", "featureOnlyModeOutcomeLinkedEvidenceReady"]) !== null
    && readStringAt(value, ["summary", "featureOnlyModeConclusion"]) !== null
    && readBooleanAt(value, [
      "ordinaryConsumerSubmissionKit",
      "featureOnlySubmissionMode",
      "modelEvidencePromotionAllowed",
    ]) === false
    && readBooleanAt(value, [
      "ordinaryConsumerSubmissionKit",
      "featureOnlySubmissionMode",
      "featureOnlyCoverageContextAllowed",
    ]) !== null
    && readBooleanAt(value, [
      "ordinaryConsumerSubmissionKit",
      "featureOnlySubmissionMode",
      "outcomeLinkedEvidenceReady",
    ]) !== null
    && readBooleanAt(value, [
      "ordinaryConsumerSubmissionKit",
      "featureOnlySubmissionMode",
      "privateDetailsStored",
    ]) === false
    && readStringAt(value, [
      "ordinaryConsumerSubmissionKit",
      "commands",
      "featureOnlySubmissionModeCommand",
    ]) !== null;
}

function summarizeInput(value: unknown | null): ArtifactSummary {
  return {
    artifact: R1149_EXPECTED.artifact,
    packetId: readStringAt(value, ["packetId"]),
    schemaVersion: readStringAt(value, ["schemaVersion"]),
    status: value ? "available" : "missing",
  };
}

function validateInputBoundary(label: string, value: unknown | null): void {
  if (!value) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1150 ${label} failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }
}

function safeBoundary(): R1150OrdinaryConsumerSafeAvailabilityConfirmationIntakeOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    availabilityConfirmationPathStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    confirmationReadErrorStored: false,
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
    rowParsingPerformedByR1150: false,
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

function readAt(value: unknown, pathParts: readonly string[]): unknown {
  let cursor = value;
  for (const part of pathParts) {
    if (!isRecord(cursor)) return null;
    cursor = cursor[part];
  }
  return cursor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatFindingCount(findings: unknown[]): string {
  return `${findings.length} finding${findings.length === 1 ? "" : "s"}`;
}

function cliSummary(output: R1150OrdinaryConsumerSafeAvailabilityConfirmationIntakeOutput): Record<string, unknown> {
  return {
    confirmationStatus: output.summary.confirmationStatus,
    conclusion: output.summary.conclusion,
    featureOnlyCoverageContextReady: output.summary.featureOnlyCoverageContextReady,
    featureOnlyCoverageRequiresPreferredPair: output.summary.featureOnlyCoverageRequiresPreferredPair,
    featureOnlyChainRunnerCommand:
      output.safeAvailabilityConfirmationIntake.commands.featureOnlyChainRunnerCommand,
    minimumFeaturePairRequired: output.summary.minimumFeaturePairRequired,
    missingAggregateReadinessFactIds: output.summary.missingAggregateReadinessFactIds,
    missingAttestationKeys: output.summary.missingAttestationKeys,
    missingFeatureOnlySourceFamilyIds: output.summary.missingFeatureOnlySourceFamilyIds,
    missingRequiredSourceFamilyIds: output.summary.missingRequiredSourceFamilyIds,
    nextAction: output.summary.nextAction,
    outcomeLinkageRequiredForFeatureOnlyContext: output.summary.outcomeLinkageRequiredForFeatureOnlyContext,
    ordinarySubmitterCompletionModeIds:
      output.summary.ordinarySubmitterCompletionModeIds,
    ordinarySubmitterSafeCompletionChecklistItemIds:
      output.summary.ordinarySubmitterSafeCompletionChecklistItemIds,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    r1149SubmitterKitFeatureOnlyGuardPresent: output.summary.r1149SubmitterKitFeatureOnlyGuardPresent,
    r1149SubmitterKitReadyForSafeConfirmation: output.summary.r1149SubmitterKitReadyForSafeConfirmation,
    readyForRecipeReadinessChain: output.summary.readyForRecipeReadinessChain,
    rowOwnerAssertionsConfirmed: output.summary.rowOwnerAssertionsConfirmed,
    rowLevelDataAcceptedByR1150: output.summary.rowLevelDataAcceptedByR1150,
    rowParsingPerformedByR1150: output.summary.rowParsingPerformedByR1150,
    schemaVersion: output.schemaVersion,
    status: output.status,
    templateArtifact: output.summary.templateArtifact,
    featureOnlyTemplateArtifact: output.summary.featureOnlyTemplateArtifact,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1150OrdinaryConsumerSafeAvailabilityConfirmationIntake({
    confirmationPath: process.env.MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_PATH,
    outputDir: process.env.MURPH_AGE_R1150_OUTPUT_DIR,
    r1149Path: process.env.MURPH_AGE_R1149_ORDINARY_CONSUMER_LAB_WEARABLE_SUBMISSION_KIT_PATH,
  });
  process.stdout.write(`${JSON.stringify(cliSummary(output), null, 2)}\n`);
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1150 safe availability confirmation intake failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
