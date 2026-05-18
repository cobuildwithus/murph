import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1165_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_RUNNER_SCHEMA_VERSION,
  R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_SCHEMA_VERSION,
  R1165_SAFE_ASSERTION_RUNNER_COMMAND,
} from "./r1165-ordinary-consumer-feature-only-safe-assertion-runner.ts";
import {
  R1167_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_FILL_GUIDE_SCHEMA_VERSION,
  R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND,
} from "./r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide.ts";

export const R1172_ORDINARY_CONSUMER_SAFE_ASSERTION_MATERIALIZER_SCHEMA_VERSION =
  "murph-age-r1172-ordinary-consumer-safe-assertion-materializer.v1" as const;
export const R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND =
  "MURPH_AGE_R1172_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTIONS_CONFIRMED=true pnpm exec tsx scripts/murph-age/r1172-ordinary-consumer-safe-assertion-materializer.ts" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME =
  "r1172-ordinary-consumer-safe-assertion-materializer.latest.json";
const MATERIALIZED_ASSERTION_FILE_NAME =
  "r1172-row-owner-feature-only-safe-assertion.json" as const;
const R1165_RUNNER_FILE_NAME =
  "r1165-ordinary-consumer-feature-only-safe-assertion-runner.latest.json" as const;
const R1165_TEMPLATE_FILE_NAME =
  "r1165-row-owner-feature-only-safe-assertion.template.json" as const;
const R1167_FILL_GUIDE_FILE_NAME =
  "r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide.latest.json" as const;
const R1165_PACKET_ID =
  "r1165-ordinary-consumer-feature-only-safe-assertion-runner" as const;
const R1167_PACKET_ID =
  "r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide" as const;
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
const SAFE_ASSERTION_ALLOWED_VALUE_KIND_IDS = [
  "booleans_only",
  "fixed_enumerated_ids_only",
] as const;
const SAFE_ASSERTION_BLOCKED_CONTENT_IDS = [
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
const SAFE_FIELD_EDIT_PATHS = [
  "sourceFamilies[bloodwork_glycemia].available",
  "sourceFamilies[wearable_activity_daily].available",
  "sourceFamilies[common_bloodwork_core].available",
  "sourceFamilies[vitals_body_context].available",
  "rowOwnerAssertionsConfirmed",
  "privateContentExcluded",
  ...REQUIRED_ATTESTATION_KEYS.map((key) => `attestations.${key}`),
] as const;

type FeatureOnlySourceFamilyId = typeof FEATURE_ONLY_SOURCE_FAMILY_IDS[number];
type RequiredInputKindId = typeof REQUIRED_INPUT_KIND_IDS[number];
type SafeAssertionAllowedValueKindId = typeof SAFE_ASSERTION_ALLOWED_VALUE_KIND_IDS[number];
type SafeAssertionBlockedContentId = typeof SAFE_ASSERTION_BLOCKED_CONTENT_IDS[number];
type SafeFieldEditPath = typeof SAFE_FIELD_EDIT_PATHS[number];
type MaterializerConclusion =
  | "ordinary_consumer_safe_assertion_materialized"
  | "ordinary_consumer_safe_assertion_materializer_waiting_on_explicit_row_owner_assertion"
  | "ordinary_consumer_safe_assertion_materializer_waiting_on_r1165_runner"
  | "ordinary_consumer_safe_assertion_materializer_waiting_on_r1165_template"
  | "ordinary_consumer_safe_assertion_materializer_waiting_on_r1167_fill_guide";
type MaterializerNextAction =
  | "refresh_r1165_safe_assertion_runner"
  | "refresh_r1165_safe_assertion_template"
  | "refresh_r1167_safe_assertion_fill_guide"
  | "rerun_r1172_with_row_owner_feature_only_safe_assertion_confirmation"
  | "run_r1165_with_r1172_row_owner_safe_assertion";

interface ArtifactSummary {
  artifact: string | null;
  packetId?: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface Inputs {
  r1165Runner: unknown | null;
  r1165Template: unknown | null;
  r1167FillGuide: unknown | null;
}

export interface R1172OrdinaryConsumerSafeAssertionMaterializerOptions {
  createdAt?: string;
  outputDir?: string;
  r1165Path?: string;
  r1165TemplatePath?: string;
  r1167Path?: string;
  rowOwnerAssertionsConfirmed?: boolean;
}

export interface R1172OrdinaryConsumerSafeAssertionMaterializerOutput {
  artifactBoundary: {
    aggregateOnly: true;
    assertionArtifactLocalPathStored: false;
    assertionFileWrittenOnlyAfterExplicitAssertion: true;
    assertionValuesStoredInR1172Packet: false;
    childOutputPathsStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    fileNamesStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelEvidencePromotedByR1172: false;
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
    rowLevelDataAcceptedByR1172: false;
    rowOwnerAssertionInferredByR1172: false;
    rowOwnerPrivateValuesStored: false;
    rowParsingPerformedByR1172: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: {
    r1165Runner: ArtifactSummary;
    r1165Template: ArtifactSummary;
    r1167FillGuide: ArtifactSummary;
  };
  materializer: {
    allowedValueKindIds: SafeAssertionAllowedValueKindId[];
    blockedContentIds: SafeAssertionBlockedContentId[];
    explicitRowOwnerAssertionProvided: boolean;
    materializedAssertionArtifact: typeof MATERIALIZED_ASSERTION_FILE_NAME | null;
    materializedAssertionWouldBeAcceptedByR1165: boolean;
    materializerCommand: typeof R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND;
    minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    privateDetailsStored: false;
    r1165RunnerCommand: typeof R1165_SAFE_ASSERTION_RUNNER_COMMAND;
    r1165RunnerReadyForAssertion: boolean;
    r1165TemplateReady: boolean;
    r1167FillGuideCommand: typeof R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND;
    r1167FillGuideReady: boolean;
    requiredInputKindIds: RequiredInputKindId[];
    rowLevelDataAcceptedByR1172: false;
    rowOwnerAssertionStillRequired: boolean;
    rowOwnerPrivateValuesStored: false;
    safeAssertionArtifactWritten: boolean;
    safeFieldEditCount: number;
    safeFieldEditPaths: SafeFieldEditPath[];
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
  packetId: "r1172-ordinary-consumer-safe-assertion-materializer";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1172_ORDINARY_CONSUMER_SAFE_ASSERTION_MATERIALIZER_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    allowedValueKindIds: SafeAssertionAllowedValueKindId[];
    blockedContentIds: SafeAssertionBlockedContentId[];
    conclusion: MaterializerConclusion;
    explicitRowOwnerAssertionProvided: boolean;
    materializedAssertionArtifact: typeof MATERIALIZED_ASSERTION_FILE_NAME | null;
    materializedAssertionWouldBeAcceptedByR1165: boolean;
    minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    nextAction: MaterializerNextAction;
    productDisplayAuthorized: false;
    requiredInputKindIds: RequiredInputKindId[];
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1172: false;
    rowOwnerAssertionInferredByR1172: false;
    rowOwnerAssertionStillRequired: boolean;
    rowOwnerPrivateValuesStored: false;
    rowParsingPerformedByR1172: false;
    r1165RunnerReadyForAssertion: boolean;
    r1165TemplateReady: boolean;
    r1167FillGuideReady: boolean;
    safeAssertionArtifactLocalPathStored: false;
    safeAssertionArtifactWritten: boolean;
    safeFieldEditCount: number;
    safeFieldEditPaths: SafeFieldEditPath[];
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
}

export async function runR1172OrdinaryConsumerSafeAssertionMaterializer(
  options: R1172OrdinaryConsumerSafeAssertionMaterializerOptions = {},
): Promise<{
  materializedAssertionPath: string | null;
  output: R1172OrdinaryConsumerSafeAssertionMaterializerOutput;
  outputPath: string;
}> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const inputs = await readInputs(options);
  validateInputs(inputs);

  const r1165RunnerReady = matchesR1165Runner(inputs.r1165Runner);
  const r1165TemplateReady = matchesR1165Template(inputs.r1165Template);
  const r1167FillGuideReady = matchesR1167FillGuide(inputs.r1167FillGuide);
  const explicitRowOwnerAssertionProvided = options.rowOwnerAssertionsConfirmed === true;
  const safeAssertionArtifactWritten =
    r1165RunnerReady && r1165TemplateReady && r1167FillGuideReady && explicitRowOwnerAssertionProvided;
  const materializedAssertion = materializeAssertion();
  const materializedAssertionWouldBeAcceptedByR1165 =
    safeAssertionArtifactWritten && materializedAssertionReady(materializedAssertion);
  const conclusion = conclusionFor({
    explicitRowOwnerAssertionProvided,
    r1165RunnerReady,
    r1165TemplateReady,
    r1167FillGuideReady,
    safeAssertionArtifactWritten,
  });
  const output: R1172OrdinaryConsumerSafeAssertionMaterializerOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs({
      r1165RunnerReady,
      r1165TemplateReady,
      r1167FillGuideReady,
    }),
    materializer: {
      allowedValueKindIds: [...SAFE_ASSERTION_ALLOWED_VALUE_KIND_IDS],
      blockedContentIds: [...SAFE_ASSERTION_BLOCKED_CONTENT_IDS],
      explicitRowOwnerAssertionProvided,
      materializedAssertionArtifact: safeAssertionArtifactWritten ? MATERIALIZED_ASSERTION_FILE_NAME : null,
      materializedAssertionWouldBeAcceptedByR1165,
      materializerCommand: R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND,
      minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      privateDetailsStored: false,
      r1165RunnerCommand: R1165_SAFE_ASSERTION_RUNNER_COMMAND,
      r1165RunnerReadyForAssertion: r1165RunnerReady,
      r1165TemplateReady,
      r1167FillGuideCommand: R1167_SAFE_ASSERTION_FILL_GUIDE_COMMAND,
      r1167FillGuideReady,
      requiredInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
      rowLevelDataAcceptedByR1172: false,
      rowOwnerAssertionStillRequired: !safeAssertionArtifactWritten,
      rowOwnerPrivateValuesStored: false,
      safeAssertionArtifactWritten,
      safeFieldEditCount: safeAssertionArtifactWritten ? SAFE_FIELD_EDIT_PATHS.length : 0,
      safeFieldEditPaths: [...SAFE_FIELD_EDIT_PATHS],
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
    packetId: "r1172-ordinary-consumer-safe-assertion-materializer",
    productDisplayAuthorized: false,
    schemaVersion: R1172_ORDINARY_CONSUMER_SAFE_ASSERTION_MATERIALIZER_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      allowedValueKindIds: [...SAFE_ASSERTION_ALLOWED_VALUE_KIND_IDS],
      blockedContentIds: [...SAFE_ASSERTION_BLOCKED_CONTENT_IDS],
      conclusion,
      explicitRowOwnerAssertionProvided,
      materializedAssertionArtifact: safeAssertionArtifactWritten ? MATERIALIZED_ASSERTION_FILE_NAME : null,
      materializedAssertionWouldBeAcceptedByR1165,
      minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      nextAction: nextActionFor(conclusion),
      productDisplayAuthorized: false,
      requiredInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1172: false,
      rowOwnerAssertionInferredByR1172: false,
      rowOwnerAssertionStillRequired: !safeAssertionArtifactWritten,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1172: false,
      r1165RunnerReadyForAssertion: r1165RunnerReady,
      r1165TemplateReady,
      r1167FillGuideReady,
      safeAssertionArtifactLocalPathStored: false,
      safeAssertionArtifactWritten,
      safeFieldEditCount: safeAssertionArtifactWritten ? SAFE_FIELD_EDIT_PATHS.length : 0,
      safeFieldEditPaths: [...SAFE_FIELD_EDIT_PATHS],
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };

  const outputFindings = findForbiddenAggregateEgress(output);
  if (outputFindings.length > 0) {
    throw new Error(`R1172 safe assertion materializer output failed aggregate-egress validation: ${formatFindingCount(outputFindings)}`);
  }

  await mkdir(outputDir, { recursive: true });
  const materializedAssertionPath = safeAssertionArtifactWritten
    ? path.join(outputDir, MATERIALIZED_ASSERTION_FILE_NAME)
    : null;
  if (materializedAssertionPath) {
    const assertionFindings = findForbiddenAggregateEgress(materializedAssertion);
    if (assertionFindings.length > 0) {
      throw new Error(
        `R1172 materialized safe assertion failed aggregate-egress validation: ${formatFindingCount(assertionFindings)}`,
      );
    }
    await writeFile(materializedAssertionPath, `${JSON.stringify(materializedAssertion, null, 2)}\n`);
  }
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { materializedAssertionPath, output, outputPath };
}

async function readInputs(options: R1172OrdinaryConsumerSafeAssertionMaterializerOptions): Promise<Inputs> {
  const r1165Path = options.r1165Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1165_RUNNER_FILE_NAME);
  const r1165TemplatePath = options.r1165TemplatePath ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1165_TEMPLATE_FILE_NAME);
  const r1167Path = options.r1167Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1167_FILL_GUIDE_FILE_NAME);
  return {
    r1165Runner: await readJsonIfPresent(r1165Path),
    r1165Template: await readJsonIfPresent(r1165TemplatePath),
    r1167FillGuide: await readJsonIfPresent(r1167Path),
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

function validateInputs(inputs: Inputs): void {
  for (const [label, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1172 rejected unsafe ${label} input: ${formatFindingCount(findings)}`);
    }
  }
}

function matchesR1165Runner(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1165_PACKET_ID
    && readStringAt(value, ["schemaVersion"]) === R1165_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_RUNNER_SCHEMA_VERSION
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readStringAt(value, ["summary", "conclusion"])
      === "ordinary_feature_only_safe_assertion_runner_waiting_on_assertion_file"
    && readStringAt(value, ["summary", "nextAction"]) === "fill_r1165_row_owner_feature_only_safe_assertion_template"
    && readBooleanAt(value, ["summary", "assertionAccepted"]) === false
    && readBooleanAt(value, ["summary", "assertionProvided"]) === false
    && readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1165"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["summary", "rowParsingPerformedByR1165"]) === false
    && readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(value, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && exactStringSet(readStringArrayAt(value, ["summary", "requiredInputKindIds"]), REQUIRED_INPUT_KIND_IDS)
    && exactStringSet(readStringArrayAt(value, ["summary", "minimumFeaturePairRequired"]), FEATURE_ONLY_SOURCE_FAMILY_IDS);
}

function matchesR1165Template(value: unknown | null): boolean {
  return readStringAt(value, ["schemaVersion"]) === R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_SCHEMA_VERSION
    && readStringAt(value, ["targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(value, ["targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && readBooleanAt(value, ["rowOwnerAssertionsConfirmed"]) === false
    && readBooleanAt(value, ["privateContentExcluded"]) === false
    && exactStringSet(readStringArrayAt(value, ["requiredInputKindIds"]), REQUIRED_INPUT_KIND_IDS)
    && FEATURE_ONLY_SOURCE_FAMILY_IDS.every((familyId) => sourceFamilyAvailable(value, familyId) === false)
    && REQUIRED_ATTESTATION_KEYS.every((key) => readBooleanAt(value, ["attestations", key]) === false);
}

function matchesR1167FillGuide(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1167_PACKET_ID
    && readStringAt(value, ["schemaVersion"]) === R1167_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_FILL_GUIDE_SCHEMA_VERSION
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readStringAt(value, ["summary", "conclusion"]) === "ordinary_feature_only_safe_assertion_fill_guide_ready"
    && readBooleanAt(value, ["summary", "guideReadyForRowOwnerFill"]) === true
    && readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1167"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["summary", "rowParsingPerformedByR1167"]) === false
    && readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(value, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && readNumberAt(value, ["summary", "safeFieldEditCount"]) === SAFE_FIELD_EDIT_PATHS.length
    && exactStringSet(readStringArrayAt(value, ["summary", "allowedValueKinds"]), SAFE_ASSERTION_ALLOWED_VALUE_KIND_IDS)
    && exactStringSet(readStringArrayAt(value, ["summary", "requiredInputKindIds"]), REQUIRED_INPUT_KIND_IDS)
    && exactStringSet(readStringArrayAt(value, ["summary", "minimumFeaturePairRequired"]), FEATURE_ONLY_SOURCE_FAMILY_IDS)
    && exactStringSet(readStringArrayAt(value, ["summary", "safeFieldEditPaths"]), SAFE_FIELD_EDIT_PATHS);
}

function materializedAssertionReady(value: unknown): boolean {
  return readStringAt(value, ["schemaVersion"]) === R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_SCHEMA_VERSION
    && readStringAt(value, ["targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(value, ["targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && readBooleanAt(value, ["rowOwnerAssertionsConfirmed"]) === true
    && readBooleanAt(value, ["privateContentExcluded"]) === true
    && exactStringSet(readStringArrayAt(value, ["requiredInputKindIds"]), REQUIRED_INPUT_KIND_IDS)
    && FEATURE_ONLY_SOURCE_FAMILY_IDS.every((familyId) => sourceFamilyAvailable(value, familyId) === true)
    && REQUIRED_ATTESTATION_KEYS.every((key) => readBooleanAt(value, ["attestations", key]) === true);
}

function materializeAssertion(): Record<string, unknown> {
  return {
    attestations: Object.fromEntries(REQUIRED_ATTESTATION_KEYS.map((key) => [key, true])),
    privateContentExcluded: true,
    requiredInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
    rowOwnerAssertionsConfirmed: true,
    schemaVersion: R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_SCHEMA_VERSION,
    sourceFamilies: [
      {
        available: true,
        familyId: "bloodwork_glycemia",
        inputKindId: "lab_portal_export_or_spreadsheet",
      },
      {
        available: true,
        familyId: "wearable_activity_daily",
        inputKindId: "phone_watch_or_wearable_activity_export",
      },
    ],
    targetAgeBand: TARGET_AGE_BAND,
    targetInputPriority: TARGET_INPUT_PRIORITY,
  };
}

function conclusionFor(input: {
  explicitRowOwnerAssertionProvided: boolean;
  r1165RunnerReady: boolean;
  r1165TemplateReady: boolean;
  r1167FillGuideReady: boolean;
  safeAssertionArtifactWritten: boolean;
}): MaterializerConclusion {
  if (!input.r1165RunnerReady) return "ordinary_consumer_safe_assertion_materializer_waiting_on_r1165_runner";
  if (!input.r1165TemplateReady) return "ordinary_consumer_safe_assertion_materializer_waiting_on_r1165_template";
  if (!input.r1167FillGuideReady) return "ordinary_consumer_safe_assertion_materializer_waiting_on_r1167_fill_guide";
  if (!input.explicitRowOwnerAssertionProvided) {
    return "ordinary_consumer_safe_assertion_materializer_waiting_on_explicit_row_owner_assertion";
  }
  return input.safeAssertionArtifactWritten
    ? "ordinary_consumer_safe_assertion_materialized"
    : "ordinary_consumer_safe_assertion_materializer_waiting_on_explicit_row_owner_assertion";
}

function nextActionFor(conclusion: MaterializerConclusion): MaterializerNextAction {
  if (conclusion === "ordinary_consumer_safe_assertion_materializer_waiting_on_r1165_runner") {
    return "refresh_r1165_safe_assertion_runner";
  }
  if (conclusion === "ordinary_consumer_safe_assertion_materializer_waiting_on_r1165_template") {
    return "refresh_r1165_safe_assertion_template";
  }
  if (conclusion === "ordinary_consumer_safe_assertion_materializer_waiting_on_r1167_fill_guide") {
    return "refresh_r1167_safe_assertion_fill_guide";
  }
  if (conclusion === "ordinary_consumer_safe_assertion_materialized") {
    return "run_r1165_with_r1172_row_owner_safe_assertion";
  }
  return "rerun_r1172_with_row_owner_feature_only_safe_assertion_confirmation";
}

function summarizeInputs(input: {
  r1165RunnerReady: boolean;
  r1165TemplateReady: boolean;
  r1167FillGuideReady: boolean;
}): R1172OrdinaryConsumerSafeAssertionMaterializerOutput["inputArtifacts"] {
  return {
    r1165Runner: {
      artifact: input.r1165RunnerReady ? R1165_RUNNER_FILE_NAME : null,
      packetId: input.r1165RunnerReady ? R1165_PACKET_ID : null,
      schemaVersion: input.r1165RunnerReady
        ? R1165_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_RUNNER_SCHEMA_VERSION
        : null,
      status: input.r1165RunnerReady ? "available" : "missing",
    },
    r1165Template: {
      artifact: input.r1165TemplateReady ? R1165_TEMPLATE_FILE_NAME : null,
      schemaVersion: input.r1165TemplateReady ? R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_SCHEMA_VERSION : null,
      status: input.r1165TemplateReady ? "available" : "missing",
    },
    r1167FillGuide: {
      artifact: input.r1167FillGuideReady ? R1167_FILL_GUIDE_FILE_NAME : null,
      packetId: input.r1167FillGuideReady ? R1167_PACKET_ID : null,
      schemaVersion: input.r1167FillGuideReady
        ? R1167_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_FILL_GUIDE_SCHEMA_VERSION
        : null,
      status: input.r1167FillGuideReady ? "available" : "missing",
    },
  };
}

function sourceFamilyAvailable(value: unknown, familyId: FeatureOnlySourceFamilyId): boolean | null {
  const match = readRecordArrayAt(value, ["sourceFamilies"]).find((family) =>
    readStringAt(family, ["familyId"]) === familyId
  );
  return match ? readBooleanAt(match, ["available"]) : null;
}

function readStringAt(value: unknown, pathParts: string[]): string | null {
  const valueAtPath = readAt(value, pathParts);
  return typeof valueAtPath === "string" ? valueAtPath : null;
}

function readNumberAt(value: unknown, pathParts: string[]): number | null {
  const valueAtPath = readAt(value, pathParts);
  return typeof valueAtPath === "number" ? valueAtPath : null;
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

function exactStringSet(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && expected.every((item) => actual.includes(item));
}

function safeBoundary(): R1172OrdinaryConsumerSafeAssertionMaterializerOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    assertionArtifactLocalPathStored: false,
    assertionFileWrittenOnlyAfterExplicitAssertion: true,
    assertionValuesStoredInR1172Packet: false,
    childOutputPathsStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    fileNamesStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelEvidencePromotedByR1172: false,
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
    rowLevelDataAcceptedByR1172: false,
    rowOwnerAssertionInferredByR1172: false,
    rowOwnerPrivateValuesStored: false,
    rowParsingPerformedByR1172: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

function cliSummary(output: R1172OrdinaryConsumerSafeAssertionMaterializerOutput): Record<string, unknown> {
  return {
    allowedValueKindIds: output.summary.allowedValueKindIds,
    blockedContentIds: output.summary.blockedContentIds,
    conclusion: output.summary.conclusion,
    explicitRowOwnerAssertionProvided: output.summary.explicitRowOwnerAssertionProvided,
    materializedAssertionArtifact: output.summary.materializedAssertionArtifact,
    materializedAssertionWouldBeAcceptedByR1165: output.summary.materializedAssertionWouldBeAcceptedByR1165,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    r1165RunnerCommand: output.materializer.r1165RunnerCommand,
    rowOwnerAssertionStillRequired: output.summary.rowOwnerAssertionStillRequired,
    safeAssertionArtifactWritten: output.summary.safeAssertionArtifactWritten,
    schemaVersion: output.schemaVersion,
  };
}

function formatFindingCount(findings: readonly unknown[]): string {
  return `${findings.length} finding${findings.length === 1 ? "" : "s"}`;
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function main(): Promise<void> {
  const { output } = await runR1172OrdinaryConsumerSafeAssertionMaterializer({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1165Path: process.env.MURPH_AGE_R1165_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_RUNNER_PATH,
    r1165TemplatePath: process.env.MURPH_AGE_R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_TEMPLATE_PATH,
    r1167Path: process.env.MURPH_AGE_R1167_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_FILL_GUIDE_PATH,
    rowOwnerAssertionsConfirmed:
      process.env.MURPH_AGE_R1172_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTIONS_CONFIRMED === "true",
  });
  process.stdout.write(`${JSON.stringify(cliSummary(output), null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1172 safe assertion materializer failed.")}\n`);
    process.exitCode = 1;
  });
}
