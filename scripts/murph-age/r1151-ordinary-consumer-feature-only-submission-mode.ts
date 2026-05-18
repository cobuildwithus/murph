import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1151_ORDINARY_CONSUMER_FEATURE_ONLY_SUBMISSION_MODE_SCHEMA_VERSION =
  "murph-age-r1151-ordinary-consumer-feature-only-submission-mode.v1" as const;

const FEATURE_ONLY_COVERAGE_CONTEXT_SCHEMA_VERSION =
  "murph-age-r1151-ordinary-consumer-feature-only-coverage-context.v1" as const;
const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1151-ordinary-consumer-feature-only-submission-mode.latest.json";
const FEATURE_ONLY_COVERAGE_CONTEXT_TEMPLATE_FILE_NAME =
  "r1151-fillable-ordinary-consumer-feature-only-coverage-context.json";
const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first" as const;
const TARGET_AGE_BAND = "roughly_16_50" as const;
const PRIMARY_FEATURE_FAMILY_IDS = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
] as const;
const OPTIONAL_FEATURE_FAMILY_IDS = [
  "common_bloodwork_core",
  "vitals_body_context",
] as const;
const EVIDENCE_LINKAGE_FAMILY_IDS = [
  "outcome_linkage",
  "join_time_alignment",
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
const BLOCKED_CONTEXT_CONTENT = [
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
const R1150_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_COMMAND =
  "MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_PATH=<safe-availability-confirmation.json> pnpm exec tsx scripts/murph-age/r1150-ordinary-consumer-safe-availability-confirmation-intake.ts" as const;
const R1144_RECIPE_READINESS_CHAIN_RUNNER_COMMAND =
  "MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_PATH=<r1150-intake.json> MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ID=lab_plus_wearable_minimum_manifest pnpm exec tsx scripts/murph-age/r1144-ordinary-consumer-recipe-readiness-chain-runner.ts" as const;
const R1152_FEATURE_ONLY_COVERAGE_CONTEXT_INTAKE_COMMAND =
  "MURPH_AGE_R1152_ORDINARY_CONSUMER_FEATURE_ONLY_COVERAGE_CONTEXT_PATH=<feature-only-coverage-context.json> pnpm exec tsx scripts/murph-age/r1152-ordinary-consumer-feature-only-coverage-context-intake.ts" as const;

const R1150_EXPECTED = {
  artifact: "r1150-ordinary-consumer-safe-availability-confirmation-intake.latest.json",
  packetId: "r1150-ordinary-consumer-safe-availability-confirmation-intake",
  schemaVersion: "murph-age-r1150-ordinary-consumer-safe-availability-confirmation-intake.v1",
} as const;

type PrimaryFeatureFamilyId = typeof PRIMARY_FEATURE_FAMILY_IDS[number];
type OptionalFeatureFamilyId = typeof OPTIONAL_FEATURE_FAMILY_IDS[number];
type EvidenceLinkageFamilyId = typeof EVIDENCE_LINKAGE_FAMILY_IDS[number];
type FeatureFamilyId = PrimaryFeatureFamilyId | OptionalFeatureFamilyId;
type AttestationKey = typeof REQUIRED_ATTESTATION_KEYS[number];
type BlockedContextContent = typeof BLOCKED_CONTEXT_CONTENT[number];
type OrdinarySubmitterInputKindId =
  | "lab_portal_export_or_spreadsheet"
  | "phone_watch_or_wearable_activity_export"
  | "optional_vitals_or_body_context";
type FeatureOnlyConclusion =
  | "ordinary_feature_only_mode_available_not_model_evidence"
  | "ordinary_feature_only_mode_superseded_by_outcome_linked_evidence"
  | "ordinary_feature_only_mode_unavailable_missing_lab_or_wearable_sources"
  | "ordinary_feature_only_mode_waiting_on_r1150_refresh"
  | "ordinary_feature_only_mode_waiting_on_safe_availability_confirmation";
type FeatureOnlyNextAction =
  | "add_bloodwork_or_wearable_sources_before_feature_only_context"
  | "fill_feature_only_coverage_context_template_for_research_only_intake"
  | "fill_safe_availability_confirmation_from_template"
  | "refresh_r1150_safe_availability_confirmation_intake"
  | "run_r1144_recipe_readiness_chain_with_confirmed_availability";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface FeatureOnlySourceFamily {
  available: false;
  familyId: FeatureFamilyId;
  privateDetailsStored: false;
  researchUse: string;
  safeConfirmationMeaning: string;
}

interface OrdinarySubmitterInputKind {
  inputKindId: OrdinarySubmitterInputKindId;
  mapsToFeatureFamilyIds: FeatureFamilyId[];
  privateDetailsStored: false;
  requiredForFeatureOnlyPreferredPair: boolean;
  safeSubmitterExample: string;
}

export interface R1151OrdinaryConsumerFeatureOnlySubmissionModeOptions {
  createdAt?: string;
  outputDir?: string;
  r1150Path?: string;
}

export interface R1151OrdinaryConsumerFeatureOnlySubmissionModeOutput {
  artifactBoundary: {
    aggregateOnly: true;
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
    rowParsingPerformedByR1151: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  featureOnlySubmissionMode: {
    blockedContextContent: BlockedContextContent[];
    commands: {
      featureOnlyCoverageContextIntakeCommand: typeof R1152_FEATURE_ONLY_COVERAGE_CONTEXT_INTAKE_COMMAND;
      outcomeLinkedRecipeReadinessCommand: typeof R1144_RECIPE_READINESS_CHAIN_RUNNER_COMMAND;
      safeAvailabilityConfirmationIntakeCommand: typeof R1150_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_COMMAND;
    };
    evidenceLinkageFamilyIds: EvidenceLinkageFamilyId[];
    featureOnlyCoverageContextAllowed: boolean;
    featureOnlyCoverageRequiresPreferredPair: true;
    featureOnlyCoverageContextTemplateArtifact: typeof FEATURE_ONLY_COVERAGE_CONTEXT_TEMPLATE_FILE_NAME;
    featureOnlyCoverageContextTemplateSchemaVersion: typeof FEATURE_ONLY_COVERAGE_CONTEXT_SCHEMA_VERSION;
    featureOnlyPreferredPairReady: boolean;
    minimumFeaturePairRequired: PrimaryFeatureFamilyId[];
    modelEvidencePromotionAllowed: false;
    missingAttestationKeys: AttestationKey[];
    missingEvidenceSourceFamilyIds: EvidenceLinkageFamilyId[];
    missingPrimaryFeatureFamilyIds: PrimaryFeatureFamilyId[];
    ordinarySubmitterInputKinds: OrdinarySubmitterInputKind[];
    outcomeLinkageRequiredForFeatureOnlyContext: false;
    outcomeLinkedEvidenceReady: boolean;
    primaryFeatureFamilyIds: PrimaryFeatureFamilyId[];
    privateDetailsStored: false;
    safeAvailabilityFeatureOnlyCoverageContextReady: boolean;
    safeAvailabilityFeatureOnlyReadinessPresent: boolean;
    rowLevelDataAcceptedByR1151: false;
    supportedFeatureFamilyIds: FeatureFamilyId[];
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
    templateWritten: true;
  };
  inputArtifacts: {
    r1150: ArtifactSummary;
  };
  packetId: "r1151-ordinary-consumer-feature-only-submission-mode";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1151_ORDINARY_CONSUMER_FEATURE_ONLY_SUBMISSION_MODE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: FeatureOnlyConclusion;
    featureOnlyCoverageContextAllowed: boolean;
    featureOnlyCoverageRequiresPreferredPair: true;
    featureOnlyCoverageContextTemplateArtifact: typeof FEATURE_ONLY_COVERAGE_CONTEXT_TEMPLATE_FILE_NAME;
    featureOnlyPreferredPairReady: boolean;
    minimumFeaturePairRequired: PrimaryFeatureFamilyId[];
    missingAttestationKeys: AttestationKey[];
    missingEvidenceSourceFamilyIds: EvidenceLinkageFamilyId[];
    missingPrimaryFeatureFamilyIds: PrimaryFeatureFamilyId[];
    modelEvidencePromotionAllowed: false;
    nextAction: FeatureOnlyNextAction;
    outcomeLinkageRequiredForFeatureOnlyContext: false;
    outcomeLinkedEvidenceReady: boolean;
    productDisplayAuthorized: false;
    reviewGptRequiredNow: false;
    safeAvailabilityFeatureOnlyCoverageContextReady: boolean;
    safeAvailabilityFeatureOnlyReadinessPresent: boolean;
    rowLevelDataAcceptedByR1151: false;
    rowParsingPerformedByR1151: false;
    supportedFeatureFamilyIds: FeatureFamilyId[];
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
}

export async function runR1151OrdinaryConsumerFeatureOnlySubmissionMode(
  options: R1151OrdinaryConsumerFeatureOnlySubmissionModeOptions = {},
): Promise<{
  featureOnlyCoverageContextTemplatePath: string;
  output: R1151OrdinaryConsumerFeatureOnlySubmissionModeOutput;
  outputPath: string;
}> {
  const r1150 = await readJsonIfPresent(options.r1150Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1150_EXPECTED.artifact));
  validateInputBoundary("r1150", r1150);
  const r1150Expected = r1150MatchesExpected(r1150);
  const r1150Available = r1150Expected && readStringAt(r1150, ["summary", "confirmationStatus"]) === "available";
  const outcomeLinkedEvidenceReady = r1150Expected
    && readBooleanAt(r1150, ["summary", "readyForRecipeReadinessChain"]) === true;
  const missingRequiredSourceFamilyIds = r1150Expected
    ? readStringArrayAt(r1150, ["summary", "missingRequiredSourceFamilyIds"])
    : [...PRIMARY_FEATURE_FAMILY_IDS, ...EVIDENCE_LINKAGE_FAMILY_IDS];
  const r1150MinimumFeaturePairRequired = readStringArrayAt(r1150, ["summary", "minimumFeaturePairRequired"]);
  const safeAvailabilityFeatureOnlyReadinessPresent = r1150Expected
    && readBooleanAt(r1150, ["summary", "featureOnlyCoverageRequiresPreferredPair"]) === true
    && includesEvery(r1150MinimumFeaturePairRequired, PRIMARY_FEATURE_FAMILY_IDS)
    && Array.isArray(readAt(r1150, ["summary", "missingFeatureOnlySourceFamilyIds"]))
    && readBooleanAt(r1150, ["summary", "featureOnlyCoverageContextReady"]) !== null
    && readBooleanAt(r1150, ["summary", "outcomeLinkageRequiredForFeatureOnlyContext"]) === false
    && readBooleanAt(r1150, ["summary", "rowLevelDataAcceptedByR1150"]) === false;
  const missingAttestationKeys = r1150Expected
    ? typedIntersection(REQUIRED_ATTESTATION_KEYS, readStringArrayAt(r1150, ["summary", "missingAttestationKeys"]))
    : [...REQUIRED_ATTESTATION_KEYS];
  const missingEvidenceSourceFamilyIds = typedIntersection(EVIDENCE_LINKAGE_FAMILY_IDS, missingRequiredSourceFamilyIds);
  const missingPrimaryFeatureFamilyIds = typedIntersection(
    PRIMARY_FEATURE_FAMILY_IDS,
    safeAvailabilityFeatureOnlyReadinessPresent
      ? readStringArrayAt(r1150, ["summary", "missingFeatureOnlySourceFamilyIds"])
      : missingRequiredSourceFamilyIds,
  );
  const supportedFeatureFamilyIds = PRIMARY_FEATURE_FAMILY_IDS.filter((familyId) => {
    return !missingPrimaryFeatureFamilyIds.includes(familyId);
  });
  const featureOnlyPreferredPairReady = supportedFeatureFamilyIds.length === PRIMARY_FEATURE_FAMILY_IDS.length;
  const safeAvailabilityFeatureOnlyCoverageContextReady = safeAvailabilityFeatureOnlyReadinessPresent
    ? readBooleanAt(r1150, ["summary", "featureOnlyCoverageContextReady"]) === true
    : r1150Available && missingAttestationKeys.length === 0 && featureOnlyPreferredPairReady;
  const featureOnlyCoverageContextAllowed = r1150Available
    && missingAttestationKeys.length === 0
    && featureOnlyPreferredPairReady
    && safeAvailabilityFeatureOnlyCoverageContextReady
    && !outcomeLinkedEvidenceReady;
  const conclusion = conclusionFor({
    featureOnlyCoverageContextAllowed,
    missingPrimaryFeatureFamilyIds,
    outcomeLinkedEvidenceReady,
    r1150Available,
    r1150Expected,
  });
  const nextAction = nextActionFor(conclusion);
  const featureOnlyCoverageContextTemplate = createFeatureOnlyCoverageContextTemplate();
  const output: R1151OrdinaryConsumerFeatureOnlySubmissionModeOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    featureOnlySubmissionMode: {
      blockedContextContent: [...BLOCKED_CONTEXT_CONTENT],
      commands: {
        featureOnlyCoverageContextIntakeCommand: R1152_FEATURE_ONLY_COVERAGE_CONTEXT_INTAKE_COMMAND,
        outcomeLinkedRecipeReadinessCommand: R1144_RECIPE_READINESS_CHAIN_RUNNER_COMMAND,
        safeAvailabilityConfirmationIntakeCommand: R1150_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_COMMAND,
      },
      evidenceLinkageFamilyIds: [...EVIDENCE_LINKAGE_FAMILY_IDS],
      featureOnlyCoverageContextAllowed,
      featureOnlyCoverageRequiresPreferredPair: true,
      featureOnlyCoverageContextTemplateArtifact: FEATURE_ONLY_COVERAGE_CONTEXT_TEMPLATE_FILE_NAME,
      featureOnlyCoverageContextTemplateSchemaVersion: FEATURE_ONLY_COVERAGE_CONTEXT_SCHEMA_VERSION,
      featureOnlyPreferredPairReady,
      minimumFeaturePairRequired: [...PRIMARY_FEATURE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      missingAttestationKeys,
      missingEvidenceSourceFamilyIds,
      missingPrimaryFeatureFamilyIds,
      ordinarySubmitterInputKinds: ordinarySubmitterInputKinds(),
      outcomeLinkageRequiredForFeatureOnlyContext: false,
      outcomeLinkedEvidenceReady,
      primaryFeatureFamilyIds: [...PRIMARY_FEATURE_FAMILY_IDS],
      privateDetailsStored: false,
      safeAvailabilityFeatureOnlyCoverageContextReady,
      safeAvailabilityFeatureOnlyReadinessPresent,
      rowLevelDataAcceptedByR1151: false,
      supportedFeatureFamilyIds,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
      templateWritten: true,
    },
    inputArtifacts: {
      r1150: summarizeInput(r1150, R1150_EXPECTED),
    },
    packetId: "r1151-ordinary-consumer-feature-only-submission-mode",
    productDisplayAuthorized: false,
    schemaVersion: R1151_ORDINARY_CONSUMER_FEATURE_ONLY_SUBMISSION_MODE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      featureOnlyCoverageContextAllowed,
      featureOnlyCoverageRequiresPreferredPair: true,
      featureOnlyCoverageContextTemplateArtifact: FEATURE_ONLY_COVERAGE_CONTEXT_TEMPLATE_FILE_NAME,
      featureOnlyPreferredPairReady,
      minimumFeaturePairRequired: [...PRIMARY_FEATURE_FAMILY_IDS],
      missingAttestationKeys,
      missingEvidenceSourceFamilyIds,
      missingPrimaryFeatureFamilyIds,
      modelEvidencePromotionAllowed: false,
      nextAction,
      outcomeLinkageRequiredForFeatureOnlyContext: false,
      outcomeLinkedEvidenceReady,
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      safeAvailabilityFeatureOnlyCoverageContextReady,
      safeAvailabilityFeatureOnlyReadinessPresent,
      rowLevelDataAcceptedByR1151: false,
      rowParsingPerformedByR1151: false,
      supportedFeatureFamilyIds,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  const featureOnlyCoverageContextTemplatePath = path.join(outputDir, FEATURE_ONLY_COVERAGE_CONTEXT_TEMPLATE_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  await writeFile(
    featureOnlyCoverageContextTemplatePath,
    `${JSON.stringify(featureOnlyCoverageContextTemplate, null, 2)}\n`,
  );
  return { featureOnlyCoverageContextTemplatePath, output, outputPath };
}

function conclusionFor(input: {
  featureOnlyCoverageContextAllowed: boolean;
  missingPrimaryFeatureFamilyIds: PrimaryFeatureFamilyId[];
  outcomeLinkedEvidenceReady: boolean;
  r1150Available: boolean;
  r1150Expected: boolean;
}): FeatureOnlyConclusion {
  if (!input.r1150Expected) return "ordinary_feature_only_mode_waiting_on_r1150_refresh";
  if (input.outcomeLinkedEvidenceReady) return "ordinary_feature_only_mode_superseded_by_outcome_linked_evidence";
  if (input.featureOnlyCoverageContextAllowed) return "ordinary_feature_only_mode_available_not_model_evidence";
  if (input.r1150Available && input.missingPrimaryFeatureFamilyIds.length > 0) {
    return "ordinary_feature_only_mode_unavailable_missing_lab_or_wearable_sources";
  }
  return "ordinary_feature_only_mode_waiting_on_safe_availability_confirmation";
}

function nextActionFor(conclusion: FeatureOnlyConclusion): FeatureOnlyNextAction {
  if (conclusion === "ordinary_feature_only_mode_superseded_by_outcome_linked_evidence") {
    return "run_r1144_recipe_readiness_chain_with_confirmed_availability";
  }
  if (conclusion === "ordinary_feature_only_mode_available_not_model_evidence") {
    return "fill_feature_only_coverage_context_template_for_research_only_intake";
  }
  if (conclusion === "ordinary_feature_only_mode_unavailable_missing_lab_or_wearable_sources") {
    return "add_bloodwork_or_wearable_sources_before_feature_only_context";
  }
  if (conclusion === "ordinary_feature_only_mode_waiting_on_r1150_refresh") {
    return "refresh_r1150_safe_availability_confirmation_intake";
  }
  return "fill_safe_availability_confirmation_from_template";
}

function createFeatureOnlyCoverageContextTemplate(): {
  attestations: Record<AttestationKey, false>;
  blockedContextContent: BlockedContextContent[];
  evidenceRole: "feature_only_coverage_context_not_model_evidence";
  featureOnlyCoverageRequiresPreferredPair: true;
  minimumFeaturePairRequired: PrimaryFeatureFamilyId[];
  modelEvidencePromotionAllowed: false;
  ordinarySubmitterInputKinds: OrdinarySubmitterInputKind[];
  outcomeLinkageRequiredForFeatureOnlyContext: false;
  rowLevelDataAcceptedByR1151: false;
  schemaVersion: typeof FEATURE_ONLY_COVERAGE_CONTEXT_SCHEMA_VERSION;
  sourceFamilies: FeatureOnlySourceFamily[];
  targetAgeBand: typeof TARGET_AGE_BAND;
  targetInputPriority: typeof TARGET_INPUT_PRIORITY;
} {
  return {
    attestations: {
      aggregateOnly: false,
      localOnly: false,
      noCoefficientEgress: false,
      noHeaderNameEgress: false,
      noParticipantEgress: false,
      noPredictionEgress: false,
      noPrivatePathEgress: false,
      noPrivateRefValueEgress: false,
      noRowEgress: false,
      noSmallCellEgress: false,
      noSourceTextEgress: false,
    },
    blockedContextContent: [...BLOCKED_CONTEXT_CONTENT],
    evidenceRole: "feature_only_coverage_context_not_model_evidence",
    featureOnlyCoverageRequiresPreferredPair: true,
    minimumFeaturePairRequired: [...PRIMARY_FEATURE_FAMILY_IDS],
    modelEvidencePromotionAllowed: false,
    ordinarySubmitterInputKinds: ordinarySubmitterInputKinds(),
    outcomeLinkageRequiredForFeatureOnlyContext: false,
    rowLevelDataAcceptedByR1151: false,
    schemaVersion: FEATURE_ONLY_COVERAGE_CONTEXT_SCHEMA_VERSION,
    sourceFamilies: [...PRIMARY_FEATURE_FAMILY_IDS, ...OPTIONAL_FEATURE_FAMILY_IDS].map((familyId) => ({
      available: false,
      familyId,
      privateDetailsStored: false,
      researchUse: researchUseFor(familyId),
      safeConfirmationMeaning: safeConfirmationMeaningFor(familyId),
    })),
    targetAgeBand: TARGET_AGE_BAND,
    targetInputPriority: TARGET_INPUT_PRIORITY,
  };
}

function ordinarySubmitterInputKinds(): OrdinarySubmitterInputKind[] {
  return [
    {
      inputKindId: "lab_portal_export_or_spreadsheet",
      mapsToFeatureFamilyIds: ["bloodwork_glycemia", "common_bloodwork_core"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: true,
      safeSubmitterExample: "An ordinary lab portal export or spreadsheet can confirm glycemia labs exist without sharing private labels, headers, or row values.",
    },
    {
      inputKindId: "phone_watch_or_wearable_activity_export",
      mapsToFeatureFamilyIds: ["wearable_activity_daily"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: true,
      safeSubmitterExample: "A phone, watch, or wearable daily activity export can confirm activity coverage without sharing private labels, headers, or row values.",
    },
    {
      inputKindId: "optional_vitals_or_body_context",
      mapsToFeatureFamilyIds: ["vitals_body_context"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: false,
      safeSubmitterExample: "Optional body or vitals context can be declared as available without sharing private labels, headers, or row values.",
    },
  ];
}

function safeConfirmationMeaningFor(familyId: FeatureFamilyId): string {
  if (familyId === "bloodwork_glycemia") {
    return "The row owner has ordinary glycemia bloodwork in a local export or spreadsheet, without sharing headers or row values.";
  }
  if (familyId === "wearable_activity_daily") {
    return "The row owner has daily activity data from a phone, watch, or wearable export, without sharing headers or row values.";
  }
  if (familyId === "common_bloodwork_core") {
    return "The row owner has common bloodwork add-ons beyond glycemia, if available, without sharing headers or row values.";
  }
  return "The row owner has body-context values such as blood pressure, height, weight, or BMI, if available, without sharing headers or row values.";
}

function researchUseFor(familyId: FeatureFamilyId): string {
  if (familyId === "bloodwork_glycemia") return "feature_coverage_context_for_glycemia_lab_routes";
  if (familyId === "wearable_activity_daily") return "feature_coverage_context_for_wearable_activity_routes";
  if (familyId === "common_bloodwork_core") return "optional_feature_coverage_context_for_common_lab_routes";
  return "optional_feature_coverage_context_for_body_context_routes";
}

function summarizeInput(
  value: unknown | null,
  expected: typeof R1150_EXPECTED,
): ArtifactSummary {
  return {
    artifact: expected.artifact,
    packetId: readStringAt(value, ["packetId"]),
    schemaVersion: readStringAt(value, ["schemaVersion"]),
    status: value && r1150MatchesExpected(value) ? "available" : "missing",
  };
}

function validateInputBoundary(name: string, value: unknown | null): void {
  if (!value) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1151 input ${name} failed aggregate-egress validation: ${findings.join("; ")}`);
  }
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    return parsed;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

function r1150MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1150_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1150_EXPECTED.schemaVersion;
}

function typedIntersection<const T extends readonly string[]>(allowed: T, values: readonly string[]): Array<T[number]> {
  return allowed.filter((item): item is T[number] => values.includes(item));
}

function includesEvery(values: readonly string[], required: readonly string[]): boolean {
  return required.every((item) => values.includes(item));
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

function readAt(value: unknown | null, pathParts: readonly string[]): unknown {
  let current: unknown = value;
  for (const part of pathParts) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function safeBoundary(): R1151OrdinaryConsumerFeatureOnlySubmissionModeOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
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
    rowParsingPerformedByR1151: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { output } = await runR1151OrdinaryConsumerFeatureOnlySubmissionMode({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1150Path: process.env.MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    featureOnlyCoverageContextAllowed: output.summary.featureOnlyCoverageContextAllowed,
    featureOnlyCoverageRequiresPreferredPair: output.summary.featureOnlyCoverageRequiresPreferredPair,
    featureOnlyPreferredPairReady: output.summary.featureOnlyPreferredPairReady,
    minimumFeaturePairRequired: output.summary.minimumFeaturePairRequired,
    missingEvidenceSourceFamilyIds: output.summary.missingEvidenceSourceFamilyIds,
    missingPrimaryFeatureFamilyIds: output.summary.missingPrimaryFeatureFamilyIds,
    modelEvidencePromotionAllowed: output.summary.modelEvidencePromotionAllowed,
    nextAction: output.summary.nextAction,
    outcomeLinkageRequiredForFeatureOnlyContext: output.summary.outcomeLinkageRequiredForFeatureOnlyContext,
    outcomeLinkedEvidenceReady: output.summary.outcomeLinkedEvidenceReady,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    safeAvailabilityFeatureOnlyCoverageContextReady: output.summary.safeAvailabilityFeatureOnlyCoverageContextReady,
    safeAvailabilityFeatureOnlyReadinessPresent: output.summary.safeAvailabilityFeatureOnlyReadinessPresent,
    rowLevelDataAcceptedByR1151: output.summary.rowLevelDataAcceptedByR1151,
    supportedFeatureFamilyIds: output.summary.supportedFeatureFamilyIds,
  }, null, 2)}\n`);
}
