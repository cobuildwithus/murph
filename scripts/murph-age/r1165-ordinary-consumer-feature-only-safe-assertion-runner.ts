import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1163_ASSERTION_TO_RESEARCH_RUNNER_COMMAND,
  R1163_FEATURE_ONLY_SAFE_CONFIRMATION_TO_RESEARCH_RUNNER_SCHEMA_VERSION,
  runR1163FeatureOnlySafeConfirmationToResearchRunner,
  type R1163FeatureOnlySafeConfirmationToResearchRunnerOutput,
} from "./r1163-feature-only-safe-confirmation-to-research-runner.ts";
import { R1164_FEATURE_ONLY_RESEARCH_HANDOFF_COMMAND } from "./r1164-ordinary-consumer-feature-only-research-handoff.ts";

export const R1165_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_RUNNER_SCHEMA_VERSION =
  "murph-age-r1165-ordinary-consumer-feature-only-safe-assertion-runner.v1" as const;
export const R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_SCHEMA_VERSION =
  "murph-age-r1165-row-owner-feature-only-safe-assertion.v1" as const;
export const R1165_SAFE_ASSERTION_RUNNER_COMMAND =
  "MURPH_AGE_R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_PATH=<safe-assertion.json> pnpm exec tsx scripts/murph-age/r1165-ordinary-consumer-feature-only-safe-assertion-runner.ts" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME =
  "r1165-ordinary-consumer-feature-only-safe-assertion-runner.latest.json";
const ASSERTION_TEMPLATE_FILE_NAME =
  "r1165-row-owner-feature-only-safe-assertion.template.json" as const;
const R1163_ARTIFACT =
  "r1163-feature-only-safe-confirmation-to-research-runner.latest.json" as const;
const R1163_PACKET_ID = "r1163-feature-only-safe-confirmation-to-research-runner" as const;
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

type FeatureOnlySourceFamilyId = typeof FEATURE_ONLY_SOURCE_FAMILY_IDS[number];
type RequiredInputKindId = typeof REQUIRED_INPUT_KIND_IDS[number];
type RequiredAssertionChecklistId = typeof REQUIRED_ASSERTION_CHECKLIST_IDS[number];
type OptionalAddOnFamilyId = typeof OPTIONAL_ADD_ON_FAMILY_IDS[number];
type RequiredAttestationKey = typeof REQUIRED_ATTESTATION_KEYS[number];
type SafeAssertionSourceFamilyId = FeatureOnlySourceFamilyId | OptionalAddOnFamilyId;
type AssertionValidationReason =
  | "assertion_file_missing"
  | "assertion_shape_invalid_or_contains_extra_fields"
  | "attestations_missing_or_false"
  | "private_content_exclusion_not_confirmed"
  | "required_input_kinds_missing_or_extra"
  | "row_owner_assertion_not_confirmed"
  | "schema_version_mismatch"
  | "source_family_availability_missing_or_false"
  | "target_age_band_mismatch"
  | "target_input_priority_mismatch";
type RunnerConclusion =
  | "ordinary_feature_only_safe_assertion_runner_invalid_assertion"
  | "ordinary_feature_only_safe_assertion_runner_ready_research_only"
  | "ordinary_feature_only_safe_assertion_runner_waiting_on_assertion_file"
  | "ordinary_feature_only_safe_assertion_runner_waiting_on_r1163_chain";
type RunnerNextAction =
  | "fill_r1165_row_owner_feature_only_safe_assertion_template"
  | "rerun_r1165_with_valid_safe_assertion"
  | "run_r1164_feature_only_research_handoff"
  | R1163FeatureOnlySafeConfirmationToResearchRunnerOutput["summary"]["nextAction"];

interface ArtifactSummary {
  artifact: string | null;
  packetId?: string | null;
  schemaVersion: string | null;
  status: "available" | "missing" | "not_run";
}

interface AssertionValidation {
  assertionAccepted: boolean;
  assertionProvided: boolean;
  reasonIds: AssertionValidationReason[];
}

export interface R1165OrdinaryConsumerFeatureOnlySafeAssertionRunnerOptions {
  assertionPath?: string;
  createdAt?: string;
  featureOnlyTemplatePath?: string;
  outputDir?: string;
  r1149Path?: string;
  r1160Path?: string;
}

export interface R1165OrdinaryConsumerFeatureOnlySafeAssertionRunnerOutput {
  artifactBoundary: {
    aggregateOnly: true;
    assertionFilePathStored: false;
    assertionValuesStoredByR1165: false;
    childOutputPathsStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    fileNamesStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelEvidencePromotedByR1165: false;
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
    rowLevelDataAcceptedByR1165: false;
    rowOwnerAssertionInferredByR1165: false;
    rowOwnerPrivateValuesStored: false;
    rowParsingPerformedByR1165: false;
    rowValuesStored: false;
    safeAssertionTemplateWritten: true;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  assertionRunner: {
    assertionAccepted: boolean;
    assertionProvided: boolean;
    assertionSchemaVersion: typeof R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_SCHEMA_VERSION;
    assertionTemplateArtifact: typeof ASSERTION_TEMPLATE_FILE_NAME;
    childR1163Ran: boolean;
    commands: {
      assertionToResearchRunnerCommand: typeof R1163_ASSERTION_TO_RESEARCH_RUNNER_COMMAND;
      featureOnlyResearchHandoffCommand: typeof R1164_FEATURE_ONLY_RESEARCH_HANDOFF_COMMAND;
      safeAssertionRunnerCommand: typeof R1165_SAFE_ASSERTION_RUNNER_COMMAND;
    };
    minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    optionalAddOnFamilyIds: OptionalAddOnFamilyId[];
    privateDetailsStored: false;
    requiredAssertionChecklistIds: RequiredAssertionChecklistId[];
    requiredInputKindIds: RequiredInputKindId[];
    rowLevelDataAcceptedByR1165: false;
    rowOwnerAssertionInferredByR1165: false;
    rowOwnerPrivateValuesStored: false;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
    validationReasonIds: AssertionValidationReason[];
  };
  childArtifacts: {
    r1163: ArtifactSummary;
  };
  createdAt: string;
  inputArtifacts: {
    rowOwnerSafeAssertion: ArtifactSummary;
  };
  packetId: "r1165-ordinary-consumer-feature-only-safe-assertion-runner";
  productDisplayAuthorized: false;
  r1163State: {
    conclusion: R1163FeatureOnlySafeConfirmationToResearchRunnerOutput["summary"]["conclusion"] | null;
    featureOnlyChainRan: boolean | null;
    featureOnlyResearchPlanningReady: boolean | null;
    nextAction: R1163FeatureOnlySafeConfirmationToResearchRunnerOutput["summary"]["nextAction"] | null;
    rowOwnerAssertionStillRequired: boolean | null;
    safeConfirmationArtifactWritten: boolean | null;
  };
  schemaVersion: typeof R1165_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_RUNNER_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    assertionAccepted: boolean;
    assertionProvided: boolean;
    assertionTemplateArtifact: typeof ASSERTION_TEMPLATE_FILE_NAME;
    childR1163Ran: boolean;
    conclusion: RunnerConclusion;
    featureOnlyResearchPlanningReady: boolean;
    minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    nextAction: RunnerNextAction;
    optionalAddOnFamilyIds: OptionalAddOnFamilyId[];
    outcomeLinkedModelEvidenceStillRequired: true;
    productDisplayAuthorized: false;
    requiredAssertionChecklistIds: RequiredAssertionChecklistId[];
    requiredInputKindIds: RequiredInputKindId[];
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1165: false;
    rowOwnerAssertionInferredByR1165: false;
    rowOwnerPrivateValuesStored: false;
    rowParsingPerformedByR1165: false;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
    validationReasonIds: AssertionValidationReason[];
  };
}

export async function runR1165OrdinaryConsumerFeatureOnlySafeAssertionRunner(
  options: R1165OrdinaryConsumerFeatureOnlySafeAssertionRunnerOptions = {},
): Promise<{ output: R1165OrdinaryConsumerFeatureOnlySafeAssertionRunnerOutput; outputPath: string }> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const rowOwnerSafeAssertion = options.assertionPath
    ? await readJsonIfPresent(options.assertionPath)
    : null;
  validateInputBoundary("rowOwnerSafeAssertion", rowOwnerSafeAssertion);

  const assertionValidation = validateAssertion(rowOwnerSafeAssertion);
  const r1163Result = assertionValidation.assertionAccepted
    ? await runR1163FeatureOnlySafeConfirmationToResearchRunner({
      createdAt: options.createdAt,
      featureOnlyTemplatePath: options.featureOnlyTemplatePath,
      outputDir,
      r1149Path: options.r1149Path,
      r1160Path: options.r1160Path,
      rowOwnerAssertionsConfirmed: true,
    })
    : null;
  if (r1163Result !== null) validateChildOutput("r1163", r1163Result.output);

  const featureOnlyResearchPlanningReady =
    r1163Result?.output.summary.featureOnlyResearchPlanningReady === true;
  const conclusion = conclusionFor({ assertionValidation, featureOnlyResearchPlanningReady, r1163Result });
  const nextAction = nextActionFor({ conclusion, r1163: r1163Result?.output ?? null });
  const output: R1165OrdinaryConsumerFeatureOnlySafeAssertionRunnerOutput = {
    artifactBoundary: safeBoundary(),
    assertionRunner: {
      assertionAccepted: assertionValidation.assertionAccepted,
      assertionProvided: assertionValidation.assertionProvided,
      assertionSchemaVersion: R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_SCHEMA_VERSION,
      assertionTemplateArtifact: ASSERTION_TEMPLATE_FILE_NAME,
      childR1163Ran: r1163Result !== null,
      commands: {
        assertionToResearchRunnerCommand: R1163_ASSERTION_TO_RESEARCH_RUNNER_COMMAND,
        featureOnlyResearchHandoffCommand: R1164_FEATURE_ONLY_RESEARCH_HANDOFF_COMMAND,
        safeAssertionRunnerCommand: R1165_SAFE_ASSERTION_RUNNER_COMMAND,
      },
      minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      optionalAddOnFamilyIds: [...OPTIONAL_ADD_ON_FAMILY_IDS],
      privateDetailsStored: false,
      requiredAssertionChecklistIds: [...REQUIRED_ASSERTION_CHECKLIST_IDS],
      requiredInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
      rowLevelDataAcceptedByR1165: false,
      rowOwnerAssertionInferredByR1165: false,
      rowOwnerPrivateValuesStored: false,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
      validationReasonIds: assertionValidation.reasonIds,
    },
    childArtifacts: {
      r1163: summarizeR1163(r1163Result?.output ?? null),
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: {
      rowOwnerSafeAssertion: summarizeAssertion(rowOwnerSafeAssertion, assertionValidation.assertionProvided),
    },
    packetId: "r1165-ordinary-consumer-feature-only-safe-assertion-runner",
    productDisplayAuthorized: false,
    r1163State: {
      conclusion: r1163Result?.output.summary.conclusion ?? null,
      featureOnlyChainRan: r1163Result?.output.summary.featureOnlyChainRan ?? null,
      featureOnlyResearchPlanningReady: r1163Result?.output.summary.featureOnlyResearchPlanningReady ?? null,
      nextAction: r1163Result?.output.summary.nextAction ?? null,
      rowOwnerAssertionStillRequired: r1163Result?.output.summary.rowOwnerAssertionStillRequired ?? null,
      safeConfirmationArtifactWritten: r1163Result?.output.summary.safeConfirmationArtifactWritten ?? null,
    },
    schemaVersion: R1165_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_RUNNER_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      assertionAccepted: assertionValidation.assertionAccepted,
      assertionProvided: assertionValidation.assertionProvided,
      assertionTemplateArtifact: ASSERTION_TEMPLATE_FILE_NAME,
      childR1163Ran: r1163Result !== null,
      conclusion,
      featureOnlyResearchPlanningReady,
      minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      nextAction,
      optionalAddOnFamilyIds: [...OPTIONAL_ADD_ON_FAMILY_IDS],
      outcomeLinkedModelEvidenceStillRequired: true,
      productDisplayAuthorized: false,
      requiredAssertionChecklistIds: [...REQUIRED_ASSERTION_CHECKLIST_IDS],
      requiredInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1165: false,
      rowOwnerAssertionInferredByR1165: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1165: false,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
      validationReasonIds: assertionValidation.reasonIds,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1165 safe assertion runner output failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  await mkdir(outputDir, { recursive: true });
  const assertionTemplate = buildAssertionTemplate();
  const assertionTemplateFindings = findForbiddenAggregateEgress(assertionTemplate);
  if (assertionTemplateFindings.length > 0) {
    throw new Error(
      `R1165 safe assertion template failed aggregate-egress validation: ${formatFindingCount(assertionTemplateFindings)}`,
    );
  }
  await writeFile(path.join(outputDir, ASSERTION_TEMPLATE_FILE_NAME), `${JSON.stringify(assertionTemplate, null, 2)}\n`);
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
    throw new Error(`R1165 rejected unsafe ${label} input: ${formatFindingCount(findings)}`);
  }
}

function validateChildOutput(label: string, value: unknown): void {
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1165 rejected unsafe ${label} output: ${formatFindingCount(findings)}`);
  }
}

function validateAssertion(value: unknown | null): AssertionValidation {
  if (!value) {
    return { assertionAccepted: false, assertionProvided: false, reasonIds: ["assertion_file_missing"] };
  }
  const reasons: AssertionValidationReason[] = [];
  if (!safeAssertionShape(value)) reasons.push("assertion_shape_invalid_or_contains_extra_fields");
  if (readStringAt(value, ["schemaVersion"]) !== R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_SCHEMA_VERSION) {
    reasons.push("schema_version_mismatch");
  }
  if (readStringAt(value, ["targetAgeBand"]) !== TARGET_AGE_BAND) reasons.push("target_age_band_mismatch");
  if (readStringAt(value, ["targetInputPriority"]) !== TARGET_INPUT_PRIORITY) {
    reasons.push("target_input_priority_mismatch");
  }
  if (readBooleanAt(value, ["rowOwnerAssertionsConfirmed"]) !== true) {
    reasons.push("row_owner_assertion_not_confirmed");
  }
  if (readBooleanAt(value, ["privateContentExcluded"]) !== true) {
    reasons.push("private_content_exclusion_not_confirmed");
  }
  if (!exactStringSet(readStringArrayAt(value, ["requiredInputKindIds"]), REQUIRED_INPUT_KIND_IDS)) {
    reasons.push("required_input_kinds_missing_or_extra");
  }
  if (!FEATURE_ONLY_SOURCE_FAMILY_IDS.every((familyId) => sourceFamilyAvailable(value, familyId) === true)) {
    reasons.push("source_family_availability_missing_or_false");
  }
  if (!REQUIRED_ATTESTATION_KEYS.every((key) => readBooleanAt(value, ["attestations", key]) === true)) {
    reasons.push("attestations_missing_or_false");
  }
  return {
    assertionAccepted: reasons.length === 0,
    assertionProvided: true,
    reasonIds: uniqueStrings(reasons),
  };
}

function safeAssertionShape(value: unknown): boolean {
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
  return sourceFamilies.length >= FEATURE_ONLY_SOURCE_FAMILY_IDS.length
    && sourceFamilies.length <= FEATURE_ONLY_SOURCE_FAMILY_IDS.length + OPTIONAL_ADD_ON_FAMILY_IDS.length
    && sourceFamilies.every((family) => onlyKeys(family, ["available", "familyId", "inputKindId"]))
    && FEATURE_ONLY_SOURCE_FAMILY_IDS.every((familyId) => familyIds.includes(familyId))
    && familyIds.every(isSafeAssertionSourceFamilyId)
    && new Set(familyIds).size === familyIds.length;
}

function isSafeAssertionSourceFamilyId(value: string | null): value is SafeAssertionSourceFamilyId {
  return value === "bloodwork_glycemia"
    || value === "wearable_activity_daily"
    || value === "common_bloodwork_core"
    || value === "vitals_body_context";
}

function buildAssertionTemplate(): Record<string, unknown> {
  return {
    attestations: Object.fromEntries(REQUIRED_ATTESTATION_KEYS.map((key) => [key, false])),
    privateContentExcluded: false,
    requiredInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
    rowOwnerAssertionsConfirmed: false,
    schemaVersion: R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_SCHEMA_VERSION,
    sourceFamilies: [
      {
        available: false,
        familyId: "bloodwork_glycemia",
        inputKindId: "lab_portal_export_or_spreadsheet",
      },
      {
        available: false,
        familyId: "wearable_activity_daily",
        inputKindId: "phone_watch_or_wearable_activity_export",
      },
      {
        available: false,
        familyId: "common_bloodwork_core",
        inputKindId: "optional_common_bloodwork_or_vitals_context",
      },
      {
        available: false,
        familyId: "vitals_body_context",
        inputKindId: "optional_common_bloodwork_or_vitals_context",
      },
    ],
    targetAgeBand: TARGET_AGE_BAND,
    targetInputPriority: TARGET_INPUT_PRIORITY,
  };
}

function summarizeAssertion(value: unknown | null, assertionProvided: boolean): ArtifactSummary {
  return {
    artifact: assertionProvided ? "row-owner-safe-assertion-input" : null,
    schemaVersion: readStringAt(value, ["schemaVersion"]) === R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_SCHEMA_VERSION
      ? R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_SCHEMA_VERSION
      : null,
    status: assertionProvided ? "available" : "missing",
  };
}

function summarizeR1163(value: R1163FeatureOnlySafeConfirmationToResearchRunnerOutput | null): ArtifactSummary {
  if (!matchesR1163(value)) {
    return {
      artifact: null,
      packetId: null,
      schemaVersion: null,
      status: "not_run",
    };
  }
  return {
    artifact: R1163_ARTIFACT,
    packetId: R1163_PACKET_ID,
    schemaVersion: R1163_FEATURE_ONLY_SAFE_CONFIRMATION_TO_RESEARCH_RUNNER_SCHEMA_VERSION,
    status: "available",
  };
}

function matchesR1163(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1163_PACKET_ID
    && readStringAt(value, ["schemaVersion"]) === R1163_FEATURE_ONLY_SAFE_CONFIRMATION_TO_RESEARCH_RUNNER_SCHEMA_VERSION;
}

function conclusionFor(input: {
  assertionValidation: AssertionValidation;
  featureOnlyResearchPlanningReady: boolean;
  r1163Result: { output: R1163FeatureOnlySafeConfirmationToResearchRunnerOutput } | null;
}): RunnerConclusion {
  if (!input.assertionValidation.assertionProvided) {
    return "ordinary_feature_only_safe_assertion_runner_waiting_on_assertion_file";
  }
  if (!input.assertionValidation.assertionAccepted) {
    return "ordinary_feature_only_safe_assertion_runner_invalid_assertion";
  }
  if (input.featureOnlyResearchPlanningReady) {
    return "ordinary_feature_only_safe_assertion_runner_ready_research_only";
  }
  return "ordinary_feature_only_safe_assertion_runner_waiting_on_r1163_chain";
}

function nextActionFor(input: {
  conclusion: RunnerConclusion;
  r1163: R1163FeatureOnlySafeConfirmationToResearchRunnerOutput | null;
}): RunnerNextAction {
  if (input.conclusion === "ordinary_feature_only_safe_assertion_runner_waiting_on_assertion_file") {
    return "fill_r1165_row_owner_feature_only_safe_assertion_template";
  }
  if (input.conclusion === "ordinary_feature_only_safe_assertion_runner_invalid_assertion") {
    return "rerun_r1165_with_valid_safe_assertion";
  }
  if (input.conclusion === "ordinary_feature_only_safe_assertion_runner_ready_research_only") {
    return "run_r1164_feature_only_research_handoff";
  }
  return input.r1163?.summary.nextAction ?? "row_owner_assert_feature_only_lab_wearable_availability_then_run_r1163_runner";
}

function sourceFamilyAvailable(value: unknown, familyId: SafeAssertionSourceFamilyId): boolean | null {
  const match = readRecordArrayAt(value, ["sourceFamilies"]).find((family) =>
    readStringAt(family, ["familyId"]) === familyId
  );
  return match ? readBooleanAt(match, ["available"]) : null;
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

function onlyKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function exactStringSet(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && expected.every((item) => actual.includes(item));
}

function uniqueStrings<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function safeBoundary(): R1165OrdinaryConsumerFeatureOnlySafeAssertionRunnerOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    assertionFilePathStored: false,
    assertionValuesStoredByR1165: false,
    childOutputPathsStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    fileNamesStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelEvidencePromotedByR1165: false,
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
    rowLevelDataAcceptedByR1165: false,
    rowOwnerAssertionInferredByR1165: false,
    rowOwnerPrivateValuesStored: false,
    rowParsingPerformedByR1165: false,
    rowValuesStored: false,
    safeAssertionTemplateWritten: true,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

function cliSummary(output: R1165OrdinaryConsumerFeatureOnlySafeAssertionRunnerOutput): Record<string, unknown> {
  return {
    assertionAccepted: output.summary.assertionAccepted,
    assertionProvided: output.summary.assertionProvided,
    assertionTemplateArtifact: output.summary.assertionTemplateArtifact,
    childR1163Ran: output.summary.childR1163Ran,
    conclusion: output.summary.conclusion,
    featureOnlyResearchPlanningReady: output.summary.featureOnlyResearchPlanningReady,
    minimumFeaturePairRequired: output.summary.minimumFeaturePairRequired,
    modelEvidencePromotionAllowed: output.summary.modelEvidencePromotionAllowed,
    nextAction: output.summary.nextAction,
    outcomeLinkedModelEvidenceStillRequired: output.summary.outcomeLinkedModelEvidenceStillRequired,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    requiredAssertionChecklistIds: output.summary.requiredAssertionChecklistIds,
    requiredInputKindIds: output.summary.requiredInputKindIds,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowLevelDataAcceptedByR1165: output.summary.rowLevelDataAcceptedByR1165,
    rowOwnerAssertionInferredByR1165: output.summary.rowOwnerAssertionInferredByR1165,
    rowOwnerPrivateValuesStored: output.summary.rowOwnerPrivateValuesStored,
    rowParsingPerformedByR1165: output.summary.rowParsingPerformedByR1165,
    schemaVersion: output.schemaVersion,
    status: output.status,
    targetAgeBand: output.summary.targetAgeBand,
    targetInputPriority: output.summary.targetInputPriority,
    validationReasonIds: output.summary.validationReasonIds,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1165OrdinaryConsumerFeatureOnlySafeAssertionRunner({
    assertionPath: process.env.MURPH_AGE_R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_PATH,
    featureOnlyTemplatePath: process.env.MURPH_AGE_R1150_FEATURE_ONLY_SAFE_AVAILABILITY_CONFIRMATION_TEMPLATE_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1149Path: process.env.MURPH_AGE_R1149_ORDINARY_CONSUMER_SUBMISSION_KIT_PATH,
    r1160Path: process.env.MURPH_AGE_R1160_R1159_FEATURE_ONLY_SAFE_CONFIRMATION_TRANSCRIPTION_PROOF_PATH,
  });
  process.stdout.write(`${JSON.stringify(cliSummary(output), null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1165 safe assertion runner failed.")}\n`);
    process.exitCode = 1;
  });
}

function isMissingFileError(error: unknown): boolean {
  return asRecord(error)?.code === "ENOENT";
}

function formatFindingCount(findings: string[]): string {
  return `${findings.length} finding${findings.length === 1 ? "" : "s"}`;
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
