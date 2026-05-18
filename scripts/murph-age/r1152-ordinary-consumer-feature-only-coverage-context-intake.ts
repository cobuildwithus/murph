import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1152_ORDINARY_CONSUMER_FEATURE_ONLY_COVERAGE_CONTEXT_INTAKE_SCHEMA_VERSION =
  "murph-age-r1152-ordinary-consumer-feature-only-coverage-context-intake.v1" as const;

const FEATURE_ONLY_COVERAGE_CONTEXT_SCHEMA_VERSION =
  "murph-age-r1151-ordinary-consumer-feature-only-coverage-context.v1" as const;
const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME =
  "r1152-ordinary-consumer-feature-only-coverage-context-intake.latest.json";
const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first" as const;
const TARGET_AGE_BAND = "roughly_16_50" as const;
const EVIDENCE_ROLE = "feature_only_coverage_context_not_model_evidence" as const;
const PRIMARY_FEATURE_FAMILY_IDS = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
] as const;
const OPTIONAL_FEATURE_FAMILY_IDS = [
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
const R1152_CONTEXT_INTAKE_COMMAND =
  "MURPH_AGE_R1152_ORDINARY_CONSUMER_FEATURE_ONLY_COVERAGE_CONTEXT_PATH=<feature-only-coverage-context.json> pnpm exec tsx scripts/murph-age/r1152-ordinary-consumer-feature-only-coverage-context-intake.ts" as const;
const R1151_EXPECTED = {
  artifact: "r1151-ordinary-consumer-feature-only-submission-mode.latest.json",
  packetId: "r1151-ordinary-consumer-feature-only-submission-mode",
  schemaVersion: "murph-age-r1151-ordinary-consumer-feature-only-submission-mode.v1",
} as const;

type PrimaryFeatureFamilyId = typeof PRIMARY_FEATURE_FAMILY_IDS[number];
type OptionalFeatureFamilyId = typeof OPTIONAL_FEATURE_FAMILY_IDS[number];
type FeatureFamilyId = PrimaryFeatureFamilyId | OptionalFeatureFamilyId;
type AttestationKey = typeof REQUIRED_ATTESTATION_KEYS[number];
type BlockedContextContent = typeof BLOCKED_CONTEXT_CONTENT[number];
type ContextStatus = "available" | "invalid_json_object" | "missing" | "parse_error" | "read_error";
type IntakeConclusion =
  | "feature_only_coverage_context_incomplete"
  | "feature_only_coverage_context_invalid"
  | "feature_only_coverage_context_not_provided"
  | "feature_only_coverage_context_ready_research_only"
  | "feature_only_coverage_context_waiting_on_r1151_ready";
type IntakeNextAction =
  | "complete_feature_only_coverage_context_template"
  | "fill_feature_only_coverage_context_template"
  | "refresh_r1151_feature_only_submission_mode"
  | "use_feature_only_coverage_context_for_research_planning_only";
type OrdinarySubmitterInputKindId =
  | "lab_portal_export_or_spreadsheet"
  | "phone_watch_or_wearable_activity_export"
  | "optional_vitals_or_body_context";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface ContextInput {
  attestations?: Partial<Record<AttestationKey, unknown>>;
  evidenceRole?: unknown;
  featureOnlyCoverageRequiresPreferredPair?: unknown;
  minimumFeaturePairRequired?: unknown;
  modelEvidencePromotionAllowed?: unknown;
  ordinarySubmitterInputKinds?: unknown;
  outcomeLinkageRequiredForFeatureOnlyContext?: unknown;
  rowLevelDataAcceptedByR1151?: unknown;
  schemaVersion?: unknown;
  sourceFamilies?: Array<{
    available?: unknown;
    familyId?: unknown;
  }>;
  targetAgeBand?: unknown;
  targetInputPriority?: unknown;
}

interface ContextReadResult {
  context: ContextInput | null;
  status: ContextStatus;
}

interface ValidationResult {
  attestationStatus: "complete" | "missing_or_false" | "not_provided";
  guardStatus: "complete" | "missing_or_mismatch" | "not_provided";
  missingAttestationKeys: AttestationKey[];
  missingPrimaryFeatureFamilyIds: PrimaryFeatureFamilyId[];
  schemaStatus: "complete" | "missing_or_mismatch" | "not_provided";
  sourceFamilyStatus: "complete" | "missing_or_false" | "not_provided";
  supportedFeatureFamilyIds: FeatureFamilyId[];
  targetStatus: "complete" | "missing_or_mismatch" | "not_provided";
}

interface OrdinarySubmitterInputKind {
  inputKindId: OrdinarySubmitterInputKindId;
  mapsToFeatureFamilyIds: FeatureFamilyId[];
  privateDetailsStored: false;
  requiredForFeatureOnlyPreferredPair: boolean;
  safeSubmitterExample: string;
}

export interface R1152OrdinaryConsumerFeatureOnlyCoverageContextIntakeOptions {
  contextPath?: string;
  createdAt?: string;
  outputDir?: string;
  r1151Path?: string;
}

export interface R1152OrdinaryConsumerFeatureOnlyCoverageContextIntakeOutput {
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
    rowParsingPerformedByR1152: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  featureOnlyCoverageContextIntake: {
    attestationStatus: ValidationResult["attestationStatus"];
    blockedContextContent: BlockedContextContent[];
    commands: {
      featureOnlyCoverageContextIntakeCommand: typeof R1152_CONTEXT_INTAKE_COMMAND;
    };
    contextPathConfigured: boolean;
    contextStatus: ContextStatus;
    coverageContextReadyForResearchPlanning: boolean;
    evidenceRole: typeof EVIDENCE_ROLE;
    featureOnlyCoverageRequiresPreferredPair: true;
    guardStatus: ValidationResult["guardStatus"];
    minimumFeaturePairRequired: PrimaryFeatureFamilyId[];
    missingAttestationKeys: AttestationKey[];
    missingPrimaryFeatureFamilyIds: PrimaryFeatureFamilyId[];
    modelEvidencePromotionAllowed: false;
    ordinarySubmitterInputKinds: OrdinarySubmitterInputKind[];
    outcomeLinkageRequiredForFeatureOnlyContext: false;
    primaryFeatureFamilyIds: PrimaryFeatureFamilyId[];
    privateDetailsStored: false;
    r1151FeatureOnlyCoverageContextAllowed: boolean;
    r1151FeatureOnlyModeReadyForIntake: boolean;
    rowLevelDataAcceptedByR1152: false;
    schemaStatus: ValidationResult["schemaStatus"];
    sourceFamilyStatus: ValidationResult["sourceFamilyStatus"];
    supportedFeatureFamilyIds: FeatureFamilyId[];
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
    targetStatus: ValidationResult["targetStatus"];
  };
  inputArtifacts: {
    r1151: ArtifactSummary;
  };
  packetId: "r1152-ordinary-consumer-feature-only-coverage-context-intake";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1152_ORDINARY_CONSUMER_FEATURE_ONLY_COVERAGE_CONTEXT_INTAKE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: IntakeConclusion;
    contextPathConfigured: boolean;
    contextStatus: ContextStatus;
    coverageContextReadyForResearchPlanning: boolean;
    featureOnlyCoverageRequiresPreferredPair: true;
    minimumFeaturePairRequired: PrimaryFeatureFamilyId[];
    missingAttestationKeys: AttestationKey[];
    missingPrimaryFeatureFamilyIds: PrimaryFeatureFamilyId[];
    modelEvidencePromotionAllowed: false;
    nextAction: IntakeNextAction;
    outcomeLinkageRequiredForFeatureOnlyContext: false;
    productDisplayAuthorized: false;
    r1151FeatureOnlyCoverageContextAllowed: boolean;
    r1151FeatureOnlyModeReadyForIntake: boolean;
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1152: false;
    rowParsingPerformedByR1152: false;
    supportedFeatureFamilyIds: FeatureFamilyId[];
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
}

export async function runR1152OrdinaryConsumerFeatureOnlyCoverageContextIntake(
  options: R1152OrdinaryConsumerFeatureOnlyCoverageContextIntakeOptions = {},
): Promise<{ output: R1152OrdinaryConsumerFeatureOnlyCoverageContextIntakeOutput; outputPath: string }> {
  const r1151 = await readJsonIfPresent(options.r1151Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1151_EXPECTED.artifact));
  validateInputBoundary("r1151", r1151);
  const r1151Expected = matchesExpected(r1151, R1151_EXPECTED);
  const r1151FeatureOnlyCoverageContextAllowed = r1151Expected
    && readBooleanAt(r1151, ["summary", "featureOnlyCoverageContextAllowed"]) === true;
  const r1151FeatureOnlyModeReadyForIntake = r1151FeatureOnlyCoverageContextAllowed
    && readBooleanAt(r1151, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(r1151, ["summary", "outcomeLinkageRequiredForFeatureOnlyContext"]) === false
    && readBooleanAt(r1151, ["summary", "rowLevelDataAcceptedByR1151"]) === false
    && readBooleanAt(r1151, ["summary", "safeAvailabilityFeatureOnlyCoverageContextReady"]) === true;
  const contextRead = await readContext(options.contextPath);
  validateInputBoundary("context", contextRead.context);
  const validation = validateContext(contextRead.context);
  const coverageContextReadyForResearchPlanning = r1151FeatureOnlyModeReadyForIntake
    && contextRead.status === "available"
    && validation.schemaStatus === "complete"
    && validation.targetStatus === "complete"
    && validation.guardStatus === "complete"
    && validation.sourceFamilyStatus === "complete"
    && validation.attestationStatus === "complete";
  const conclusion = conclusionFor({
    contextStatus: contextRead.status,
    coverageContextReadyForResearchPlanning,
    r1151FeatureOnlyModeReadyForIntake,
    validation,
  });
  const output: R1152OrdinaryConsumerFeatureOnlyCoverageContextIntakeOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    featureOnlyCoverageContextIntake: {
      attestationStatus: validation.attestationStatus,
      blockedContextContent: [...BLOCKED_CONTEXT_CONTENT],
      commands: {
        featureOnlyCoverageContextIntakeCommand: R1152_CONTEXT_INTAKE_COMMAND,
      },
      contextPathConfigured: options.contextPath !== undefined && options.contextPath.trim() !== "",
      contextStatus: contextRead.status,
      coverageContextReadyForResearchPlanning,
      evidenceRole: EVIDENCE_ROLE,
      featureOnlyCoverageRequiresPreferredPair: true,
      guardStatus: validation.guardStatus,
      minimumFeaturePairRequired: [...PRIMARY_FEATURE_FAMILY_IDS],
      missingAttestationKeys: validation.missingAttestationKeys,
      missingPrimaryFeatureFamilyIds: validation.missingPrimaryFeatureFamilyIds,
      modelEvidencePromotionAllowed: false,
      ordinarySubmitterInputKinds: ordinarySubmitterInputKinds(),
      outcomeLinkageRequiredForFeatureOnlyContext: false,
      primaryFeatureFamilyIds: [...PRIMARY_FEATURE_FAMILY_IDS],
      privateDetailsStored: false,
      r1151FeatureOnlyCoverageContextAllowed,
      r1151FeatureOnlyModeReadyForIntake,
      rowLevelDataAcceptedByR1152: false,
      schemaStatus: validation.schemaStatus,
      sourceFamilyStatus: validation.sourceFamilyStatus,
      supportedFeatureFamilyIds: validation.supportedFeatureFamilyIds,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
      targetStatus: validation.targetStatus,
    },
    inputArtifacts: {
      r1151: summarizeInput(r1151),
    },
    packetId: "r1152-ordinary-consumer-feature-only-coverage-context-intake",
    productDisplayAuthorized: false,
    schemaVersion: R1152_ORDINARY_CONSUMER_FEATURE_ONLY_COVERAGE_CONTEXT_INTAKE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      contextPathConfigured: options.contextPath !== undefined && options.contextPath.trim() !== "",
      contextStatus: contextRead.status,
      coverageContextReadyForResearchPlanning,
      featureOnlyCoverageRequiresPreferredPair: true,
      minimumFeaturePairRequired: [...PRIMARY_FEATURE_FAMILY_IDS],
      missingAttestationKeys: validation.missingAttestationKeys,
      missingPrimaryFeatureFamilyIds: validation.missingPrimaryFeatureFamilyIds,
      modelEvidencePromotionAllowed: false,
      nextAction: nextActionFor(conclusion),
      outcomeLinkageRequiredForFeatureOnlyContext: false,
      productDisplayAuthorized: false,
      r1151FeatureOnlyCoverageContextAllowed,
      r1151FeatureOnlyModeReadyForIntake,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1152: false,
      rowParsingPerformedByR1152: false,
      supportedFeatureFamilyIds: validation.supportedFeatureFamilyIds,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1152 feature-only coverage context intake failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function validateContext(context: ContextInput | null): ValidationResult {
  if (!context) {
    return {
      attestationStatus: "not_provided",
      guardStatus: "not_provided",
      missingAttestationKeys: [...REQUIRED_ATTESTATION_KEYS],
      missingPrimaryFeatureFamilyIds: [...PRIMARY_FEATURE_FAMILY_IDS],
      schemaStatus: "not_provided",
      sourceFamilyStatus: "not_provided",
      supportedFeatureFamilyIds: [],
      targetStatus: "not_provided",
    };
  }

  const missingAttestationKeys = REQUIRED_ATTESTATION_KEYS.filter((key) =>
    readBooleanAt(context, ["attestations", key]) !== true
  );
  const missingPrimaryFeatureFamilyIds = PRIMARY_FEATURE_FAMILY_IDS.filter((familyId) =>
    sourceFamilyAvailable(context, familyId) !== true
  );
  const supportedFeatureFamilyIds = [...PRIMARY_FEATURE_FAMILY_IDS, ...OPTIONAL_FEATURE_FAMILY_IDS].filter(
    (familyId) => sourceFamilyAvailable(context, familyId) === true,
  );
  return {
    attestationStatus: missingAttestationKeys.length === 0 ? "complete" : "missing_or_false",
    guardStatus: guardStatusFor(context),
    missingAttestationKeys,
    missingPrimaryFeatureFamilyIds,
    schemaStatus: readStringAt(context, ["schemaVersion"]) === FEATURE_ONLY_COVERAGE_CONTEXT_SCHEMA_VERSION
      ? "complete"
      : "missing_or_mismatch",
    sourceFamilyStatus: missingPrimaryFeatureFamilyIds.length === 0 ? "complete" : "missing_or_false",
    supportedFeatureFamilyIds,
    targetStatus: readStringAt(context, ["targetAgeBand"]) === TARGET_AGE_BAND
      && readStringAt(context, ["targetInputPriority"]) === TARGET_INPUT_PRIORITY
      ? "complete"
      : "missing_or_mismatch",
  };
}

function guardStatusFor(context: ContextInput): ValidationResult["guardStatus"] {
  const minimumFeaturePairRequired = readStringArrayAt(context, ["minimumFeaturePairRequired"]);
  if (
    readStringAt(context, ["evidenceRole"]) === EVIDENCE_ROLE
    && readBooleanAt(context, ["featureOnlyCoverageRequiresPreferredPair"]) === true
    && includesEvery(minimumFeaturePairRequired, PRIMARY_FEATURE_FAMILY_IDS)
    && readBooleanAt(context, ["modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(context, ["outcomeLinkageRequiredForFeatureOnlyContext"]) === false
    && readBooleanAt(context, ["rowLevelDataAcceptedByR1151"]) === false
  ) {
    return "complete";
  }
  return "missing_or_mismatch";
}

function sourceFamilyAvailable(context: ContextInput, familyId: FeatureFamilyId): boolean | null {
  const families = Array.isArray(context.sourceFamilies) ? context.sourceFamilies : [];
  const match = families.find((family) => family.familyId === familyId);
  if (!match) return null;
  return match.available === true;
}

function conclusionFor(input: {
  contextStatus: ContextStatus;
  coverageContextReadyForResearchPlanning: boolean;
  r1151FeatureOnlyModeReadyForIntake: boolean;
  validation: ValidationResult;
}): IntakeConclusion {
  if (!input.r1151FeatureOnlyModeReadyForIntake) {
    return "feature_only_coverage_context_waiting_on_r1151_ready";
  }
  if (input.contextStatus === "missing") return "feature_only_coverage_context_not_provided";
  if (input.contextStatus !== "available") return "feature_only_coverage_context_invalid";
  if (input.coverageContextReadyForResearchPlanning) return "feature_only_coverage_context_ready_research_only";
  if (
    input.validation.schemaStatus !== "complete"
    || input.validation.guardStatus !== "complete"
    || input.validation.targetStatus !== "complete"
  ) {
    return "feature_only_coverage_context_invalid";
  }
  return "feature_only_coverage_context_incomplete";
}

function nextActionFor(conclusion: IntakeConclusion): IntakeNextAction {
  if (conclusion === "feature_only_coverage_context_ready_research_only") {
    return "use_feature_only_coverage_context_for_research_planning_only";
  }
  if (conclusion === "feature_only_coverage_context_waiting_on_r1151_ready") {
    return "refresh_r1151_feature_only_submission_mode";
  }
  if (conclusion === "feature_only_coverage_context_not_provided") {
    return "fill_feature_only_coverage_context_template";
  }
  return "complete_feature_only_coverage_context_template";
}

function ordinarySubmitterInputKinds(): OrdinarySubmitterInputKind[] {
  return [
    {
      inputKindId: "lab_portal_export_or_spreadsheet",
      mapsToFeatureFamilyIds: ["bloodwork_glycemia", "common_bloodwork_core"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: true,
      safeSubmitterExample: "A normal lab portal export or spreadsheet confirms glycemia-lab coverage without sharing private labels, headers, or row values.",
    },
    {
      inputKindId: "phone_watch_or_wearable_activity_export",
      mapsToFeatureFamilyIds: ["wearable_activity_daily"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: true,
      safeSubmitterExample: "A phone, watch, or wearable export confirms daily activity coverage without sharing private labels, headers, or row values.",
    },
    {
      inputKindId: "optional_vitals_or_body_context",
      mapsToFeatureFamilyIds: ["vitals_body_context"],
      privateDetailsStored: false,
      requiredForFeatureOnlyPreferredPair: false,
      safeSubmitterExample: "Optional body or vitals context can be confirmed without sharing private labels, headers, or row values.",
    },
  ];
}

async function readContext(contextPath: string | undefined): Promise<ContextReadResult> {
  if (!contextPath || contextPath.trim() === "") return { context: null, status: "missing" };
  let raw: string;
  try {
    raw = await readFile(contextPath, "utf8");
  } catch {
    return { context: null, status: "read_error" };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { context: null, status: "invalid_json_object" };
    return { context: parsed, status: "available" };
  } catch {
    return { context: null, status: "parse_error" };
  }
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function summarizeInput(value: unknown): ArtifactSummary {
  if (!isRecord(value)) {
    return {
      artifact: R1151_EXPECTED.artifact,
      packetId: null,
      schemaVersion: null,
      status: "missing",
    };
  }
  return {
    artifact: R1151_EXPECTED.artifact,
    packetId: readStringAt(value, ["packetId"]),
    schemaVersion: readStringAt(value, ["schemaVersion"]),
    status: "available",
  };
}

function matchesExpected(value: unknown, expected: typeof R1151_EXPECTED): boolean {
  return readStringAt(value, ["packetId"]) === expected.packetId
    && readStringAt(value, ["schemaVersion"]) === expected.schemaVersion;
}

function validateInputBoundary(name: string, value: unknown): void {
  if (value === null) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1152 input ${name} failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }
}

function formatFindingCount(findings: readonly string[]): string {
  return `${findings.length} finding${findings.length === 1 ? "" : "s"}`;
}

function includesEvery(values: readonly string[], requiredValues: readonly string[]): boolean {
  const valueSet = new Set(values);
  return requiredValues.every((value) => valueSet.has(value));
}

function readBooleanAt(value: unknown, pathParts: readonly string[]): boolean | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "boolean" ? resolved : null;
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
}

function readStringArrayAt(value: unknown, pathParts: readonly string[]): string[] {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved) ? resolved.filter((item): item is string => typeof item === "string") : [];
}

function readAt(value: unknown, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeBoundary(): R1152OrdinaryConsumerFeatureOnlyCoverageContextIntakeOutput["artifactBoundary"] {
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
    rowParsingPerformedByR1152: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

function cliSummary(output: R1152OrdinaryConsumerFeatureOnlyCoverageContextIntakeOutput): Record<string, unknown> {
  return {
    conclusion: output.summary.conclusion,
    contextPathConfigured: output.summary.contextPathConfigured,
    contextStatus: output.summary.contextStatus,
    coverageContextReadyForResearchPlanning: output.summary.coverageContextReadyForResearchPlanning,
    featureOnlyCoverageRequiresPreferredPair: output.summary.featureOnlyCoverageRequiresPreferredPair,
    minimumFeaturePairRequired: output.summary.minimumFeaturePairRequired,
    missingAttestationKeys: output.summary.missingAttestationKeys,
    missingPrimaryFeatureFamilyIds: output.summary.missingPrimaryFeatureFamilyIds,
    modelEvidencePromotionAllowed: output.summary.modelEvidencePromotionAllowed,
    nextAction: output.summary.nextAction,
    outcomeLinkageRequiredForFeatureOnlyContext: output.summary.outcomeLinkageRequiredForFeatureOnlyContext,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    r1151FeatureOnlyCoverageContextAllowed: output.summary.r1151FeatureOnlyCoverageContextAllowed,
    r1151FeatureOnlyModeReadyForIntake: output.summary.r1151FeatureOnlyModeReadyForIntake,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowLevelDataAcceptedByR1152: output.summary.rowLevelDataAcceptedByR1152,
    rowParsingPerformedByR1152: output.summary.rowParsingPerformedByR1152,
    supportedFeatureFamilyIds: output.summary.supportedFeatureFamilyIds,
    targetAgeBand: output.summary.targetAgeBand,
    targetInputPriority: output.summary.targetInputPriority,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1152OrdinaryConsumerFeatureOnlyCoverageContextIntake({
    contextPath: process.env.MURPH_AGE_R1152_ORDINARY_CONSUMER_FEATURE_ONLY_COVERAGE_CONTEXT_PATH,
    outputDir: process.env.MURPH_AGE_R1152_OUTPUT_DIR,
    r1151Path: process.env.MURPH_AGE_R1151_ORDINARY_CONSUMER_FEATURE_ONLY_SUBMISSION_MODE_PATH,
  });
  process.stdout.write(`${JSON.stringify(cliSummary(output), null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1152 feature-only coverage context intake failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
