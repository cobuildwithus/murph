import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  runR1153OrdinaryConsumerFeatureOnlyChainRunner,
  type R1153OrdinaryConsumerFeatureOnlyChainRunnerOutput,
} from "./r1153-ordinary-consumer-feature-only-chain-runner.ts";
import {
  R1161_MATERIALIZER_COMMAND,
  runR1161FeatureOnlySafeAvailabilityConfirmationMaterializer,
  type R1161FeatureOnlySafeAvailabilityConfirmationMaterializerOutput,
} from "./r1161-feature-only-safe-availability-confirmation-materializer.ts";

export const R1163_FEATURE_ONLY_SAFE_CONFIRMATION_TO_RESEARCH_RUNNER_SCHEMA_VERSION =
  "murph-age-r1163-feature-only-safe-confirmation-to-research-runner.v1" as const;
export const R1163_ASSERTION_TO_RESEARCH_RUNNER_COMMAND =
  "MURPH_AGE_R1161_ROW_OWNER_FEATURE_ONLY_CONFIRMATION_ASSERTIONS_CONFIRMED=true pnpm exec tsx scripts/murph-age/r1163-feature-only-safe-confirmation-to-research-runner.ts" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME =
  "r1163-feature-only-safe-confirmation-to-research-runner.latest.json";
const R1161_ARTIFACT =
  "r1161-feature-only-safe-availability-confirmation-materializer.latest.json" as const;
const R1153_ARTIFACT =
  "r1153-ordinary-consumer-feature-only-chain-runner.latest.json" as const;
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
const REQUIRED_CHECKLIST_IDS = [
  "confirm_target_age_band_without_identifiers",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
] as const;
const BLOCKED_PRIVATE_CONTENT = [
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
const ROW_OWNER_ASSERTION_ITEM_IDS = [
  "assert_target_age_band_roughly_16_50",
  "assert_glycemia_bloodwork_export_available",
  "assert_daily_wearable_activity_export_available",
  "assert_assertion_contains_no_private_values",
] as const;

type FeatureOnlySourceFamilyId = typeof FEATURE_ONLY_SOURCE_FAMILY_IDS[number];
type OptionalAddOnFamilyId = typeof OPTIONAL_ADD_ON_FAMILY_IDS[number];
type RequiredInputKindId = typeof REQUIRED_INPUT_KIND_IDS[number];
type RequiredChecklistId = typeof REQUIRED_CHECKLIST_IDS[number];
type BlockedPrivateContent = typeof BLOCKED_PRIVATE_CONTENT[number];
type RowOwnerAssertionItemId = typeof ROW_OWNER_ASSERTION_ITEM_IDS[number];
type RunnerConclusion =
  | "feature_only_safe_confirmation_to_research_runner_ready_research_only"
  | "feature_only_safe_confirmation_to_research_runner_waiting_on_feature_only_chain"
  | "feature_only_safe_confirmation_to_research_runner_waiting_on_prerequisite"
  | "feature_only_safe_confirmation_to_research_runner_waiting_on_row_owner_assertion";
type RunnerNextAction =
  | "row_owner_assert_feature_only_lab_wearable_availability_then_run_r1163_runner"
  | R1161FeatureOnlySafeAvailabilityConfirmationMaterializerOutput["summary"]["nextAction"]
  | R1153OrdinaryConsumerFeatureOnlyChainRunnerOutput["summary"]["nextAction"];

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface RowOwnerAssertionContractItem {
  assertionItemId: RowOwnerAssertionItemId;
  mapsToChecklistIds: RequiredChecklistId[];
  mapsToSourceFamilyIds: FeatureOnlySourceFamilyId[];
  privateDetailsStored: false;
  safeAssertion: string;
  safeInputKindIds: RequiredInputKindId[];
}

interface RowOwnerAssertionContract {
  assertionItems: RowOwnerAssertionContractItem[];
  assertionItemIds: RowOwnerAssertionItemId[];
  assertionReadyForAverageSubmitter: true;
  blockedPrivateContent: BlockedPrivateContent[];
  commandAfterAssertion: typeof R1163_ASSERTION_TO_RESEARCH_RUNNER_COMMAND;
  minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
  modelEvidencePromotionAllowed: false;
  optionalAddOnFamilyIds: OptionalAddOnFamilyId[];
  privateDetailsStored: false;
  requiredChecklistIds: RequiredChecklistId[];
  requiredInputKindIds: RequiredInputKindId[];
  rowLevelDataAcceptedByR1163: false;
  rowOwnerPrivateValuesStored: false;
  safeAssertionMeaning: string;
  targetAgeBand: typeof TARGET_AGE_BAND;
  targetInputPriority: typeof TARGET_INPUT_PRIORITY;
}

export interface R1163FeatureOnlySafeConfirmationToResearchRunnerOptions {
  createdAt?: string;
  featureOnlyTemplatePath?: string;
  outputDir?: string;
  r1149Path?: string;
  r1160Path?: string;
  rowOwnerAssertionsConfirmed?: boolean;
}

export interface R1163FeatureOnlySafeConfirmationToResearchRunnerOutput {
  artifactBoundary: {
    aggregateOnly: true;
    childOutputPathsStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    confirmationArtifactLocalPathStored: false;
    confirmationValuesStoredByR1163: false;
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
    rowLevelDataAcceptedByR1163: false;
    rowOwnerAssertionInferredByR1163: false;
    rowOwnerPrivateValuesStored: false;
    rowParsingPerformedByR1163: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  childArtifacts: {
    r1153: ArtifactSummary;
    r1161: ArtifactSummary;
  };
  createdAt: string;
  featureOnlyChainState: {
    conclusion: R1153OrdinaryConsumerFeatureOnlyChainRunnerOutput["summary"]["conclusion"] | null;
    coverageContextReadyForResearchPlanning: boolean | null;
    derivedCoverageContextArtifact: string | null;
    derivedCoverageContextUsed: boolean | null;
    featureOnlyCoverageContextAllowed: boolean | null;
    modelEvidencePromotionAllowed: false;
    nextAction: R1153OrdinaryConsumerFeatureOnlyChainRunnerOutput["summary"]["nextAction"] | null;
    productDisplayAuthorized: false;
    rowLevelDataAcceptedByR1153: false;
    rowParsingPerformedByR1153: false;
  };
  materializerState: {
    conclusion: R1161FeatureOnlySafeAvailabilityConfirmationMaterializerOutput["summary"]["conclusion"];
    explicitRowOwnerConfirmationAssertionProvided: boolean;
    featureOnlyConfirmationWouldBeReadyForR1150: boolean;
    nextAction: R1161FeatureOnlySafeAvailabilityConfirmationMaterializerOutput["summary"]["nextAction"];
    rowOwnerConfirmationStillRequired: boolean;
    safeConfirmationArtifact: string | null;
    safeConfirmationArtifactWritten: boolean;
    safeMaterializedFieldCount: number;
  };
  packetId: "r1163-feature-only-safe-confirmation-to-research-runner";
  productDisplayAuthorized: false;
  runner: {
    confirmedSafeConfirmationArtifact: string | null;
    explicitRowOwnerConfirmationAssertionProvided: boolean;
    featureOnlyChainRan: boolean;
    featureOnlyResearchPlanningReady: boolean;
    materializerCommand: typeof R1161_MATERIALIZER_COMMAND;
    minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    nextActionAfterRunner: RunnerNextAction;
    optionalAddOnFamilyIds: OptionalAddOnFamilyId[];
    requiredChecklistIds: RequiredChecklistId[];
    requiredInputKindIds: RequiredInputKindId[];
    rowLevelDataAcceptedByR1163: false;
    rowOwnerAssertionInferredByR1163: false;
    rowOwnerAssertionStillRequired: boolean;
    rowOwnerPrivateValuesStored: false;
    runnerCommand: typeof R1163_ASSERTION_TO_RESEARCH_RUNNER_COMMAND;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
  rowOwnerAssertionContract: RowOwnerAssertionContract;
  schemaVersion: typeof R1163_FEATURE_ONLY_SAFE_CONFIRMATION_TO_RESEARCH_RUNNER_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: RunnerConclusion;
    confirmedSafeConfirmationArtifact: string | null;
    explicitRowOwnerConfirmationAssertionProvided: boolean;
    featureOnlyChainConclusion: R1153OrdinaryConsumerFeatureOnlyChainRunnerOutput["summary"]["conclusion"] | null;
    featureOnlyChainRan: boolean;
    featureOnlyResearchPlanningReady: boolean;
    materializerConclusion: R1161FeatureOnlySafeAvailabilityConfirmationMaterializerOutput["summary"]["conclusion"];
    materializerNextAction: R1161FeatureOnlySafeAvailabilityConfirmationMaterializerOutput["summary"]["nextAction"];
    minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    nextAction: RunnerNextAction;
    optionalAddOnFamilyIds: OptionalAddOnFamilyId[];
    productDisplayAuthorized: false;
    requiredChecklistIds: RequiredChecklistId[];
    requiredInputKindIds: RequiredInputKindId[];
    reviewGptRequiredNow: false;
    rowOwnerAssertionContractItemIds: RowOwnerAssertionItemId[];
    rowOwnerAssertionContractReady: true;
    rowOwnerAssertionCommand: typeof R1163_ASSERTION_TO_RESEARCH_RUNNER_COMMAND;
    rowLevelDataAcceptedByR1163: false;
    rowOwnerAssertionInferredByR1163: false;
    rowOwnerAssertionStillRequired: boolean;
    rowOwnerPrivateValuesStored: false;
    rowParsingPerformedByR1163: false;
    safeConfirmationArtifactWritten: boolean;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
}

export async function runR1163FeatureOnlySafeConfirmationToResearchRunner(
  options: R1163FeatureOnlySafeConfirmationToResearchRunnerOptions = {},
): Promise<{ output: R1163FeatureOnlySafeConfirmationToResearchRunnerOutput; outputPath: string }> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const r1161Result = await runR1161FeatureOnlySafeAvailabilityConfirmationMaterializer({
    createdAt: options.createdAt,
    featureOnlyTemplatePath: options.featureOnlyTemplatePath,
    outputDir,
    r1160Path: options.r1160Path,
    rowOwnerAssertionsConfirmed: options.rowOwnerAssertionsConfirmed,
  });
  validateChildOutput("r1161", r1161Result.output);

  const r1153Result = r1161Result.confirmedConfirmationPath === null
    ? null
    : await runR1153OrdinaryConsumerFeatureOnlyChainRunner({
      confirmationPath: r1161Result.confirmedConfirmationPath,
      createdAt: options.createdAt,
      outputDir,
      r1149Path: options.r1149Path,
    });
  if (r1153Result !== null) {
    validateChildOutput("r1153", r1153Result.output);
  }

  const featureOnlyResearchPlanningReady =
    r1153Result?.output.summary.coverageContextReadyForResearchPlanning === true;
  const conclusion = conclusionFor({
    featureOnlyChainRan: r1153Result !== null,
    featureOnlyResearchPlanningReady,
    materializerConclusion: r1161Result.output.summary.conclusion,
  });
  const nextAction = nextActionFor({
    conclusion,
    r1153: r1153Result?.output ?? null,
    r1161: r1161Result.output,
  });
  const output: R1163FeatureOnlySafeConfirmationToResearchRunnerOutput = {
    artifactBoundary: safeBoundary(),
    childArtifacts: {
      r1153: summarizeR1153(r1153Result?.output ?? null),
      r1161: summarizeR1161(r1161Result.output),
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    featureOnlyChainState: {
      conclusion: r1153Result?.output.summary.conclusion ?? null,
      coverageContextReadyForResearchPlanning:
        r1153Result?.output.summary.coverageContextReadyForResearchPlanning ?? null,
      derivedCoverageContextArtifact: r1153Result?.output.summary.derivedCoverageContextArtifact ?? null,
      derivedCoverageContextUsed: r1153Result?.output.summary.derivedCoverageContextUsed ?? null,
      featureOnlyCoverageContextAllowed: r1153Result?.output.summary.featureOnlyCoverageContextAllowed ?? null,
      modelEvidencePromotionAllowed: false,
      nextAction: r1153Result?.output.summary.nextAction ?? null,
      productDisplayAuthorized: false,
      rowLevelDataAcceptedByR1153: false,
      rowParsingPerformedByR1153: false,
    },
    materializerState: {
      conclusion: r1161Result.output.summary.conclusion,
      explicitRowOwnerConfirmationAssertionProvided:
        r1161Result.output.summary.explicitRowOwnerConfirmationAssertionProvided,
      featureOnlyConfirmationWouldBeReadyForR1150:
        r1161Result.output.summary.featureOnlyConfirmationWouldBeReadyForR1150,
      nextAction: r1161Result.output.summary.nextAction,
      rowOwnerConfirmationStillRequired: r1161Result.output.summary.rowOwnerConfirmationStillRequired,
      safeConfirmationArtifact: r1161Result.output.summary.safeConfirmationArtifact,
      safeConfirmationArtifactWritten: r1161Result.output.summary.safeConfirmationArtifactWritten,
      safeMaterializedFieldCount: r1161Result.output.summary.safeMaterializedFieldCount,
    },
    packetId: "r1163-feature-only-safe-confirmation-to-research-runner",
    productDisplayAuthorized: false,
    runner: {
      confirmedSafeConfirmationArtifact: r1161Result.output.summary.safeConfirmationArtifact,
      explicitRowOwnerConfirmationAssertionProvided:
        r1161Result.output.summary.explicitRowOwnerConfirmationAssertionProvided,
      featureOnlyChainRan: r1153Result !== null,
      featureOnlyResearchPlanningReady,
      materializerCommand: R1161_MATERIALIZER_COMMAND,
      minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      nextActionAfterRunner: nextAction,
      optionalAddOnFamilyIds: [...OPTIONAL_ADD_ON_FAMILY_IDS],
      requiredChecklistIds: [...REQUIRED_CHECKLIST_IDS],
      requiredInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
      rowLevelDataAcceptedByR1163: false,
      rowOwnerAssertionInferredByR1163: false,
      rowOwnerAssertionStillRequired: r1161Result.output.summary.rowOwnerConfirmationStillRequired,
      rowOwnerPrivateValuesStored: false,
      runnerCommand: R1163_ASSERTION_TO_RESEARCH_RUNNER_COMMAND,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
    rowOwnerAssertionContract: rowOwnerAssertionContract(),
    schemaVersion: R1163_FEATURE_ONLY_SAFE_CONFIRMATION_TO_RESEARCH_RUNNER_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      confirmedSafeConfirmationArtifact: r1161Result.output.summary.safeConfirmationArtifact,
      explicitRowOwnerConfirmationAssertionProvided:
        r1161Result.output.summary.explicitRowOwnerConfirmationAssertionProvided,
      featureOnlyChainConclusion: r1153Result?.output.summary.conclusion ?? null,
      featureOnlyChainRan: r1153Result !== null,
      featureOnlyResearchPlanningReady,
      materializerConclusion: r1161Result.output.summary.conclusion,
      materializerNextAction: r1161Result.output.summary.nextAction,
      minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      nextAction,
      optionalAddOnFamilyIds: [...OPTIONAL_ADD_ON_FAMILY_IDS],
      productDisplayAuthorized: false,
      requiredChecklistIds: [...REQUIRED_CHECKLIST_IDS],
      requiredInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
      reviewGptRequiredNow: false,
      rowOwnerAssertionCommand: R1163_ASSERTION_TO_RESEARCH_RUNNER_COMMAND,
      rowOwnerAssertionContractItemIds: [...ROW_OWNER_ASSERTION_ITEM_IDS],
      rowOwnerAssertionContractReady: true,
      rowLevelDataAcceptedByR1163: false,
      rowOwnerAssertionInferredByR1163: false,
      rowOwnerAssertionStillRequired: r1161Result.output.summary.rowOwnerConfirmationStillRequired,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1163: false,
      safeConfirmationArtifactWritten: r1161Result.output.summary.safeConfirmationArtifactWritten,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };

  validateChildOutput("r1163", output);
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function conclusionFor(input: {
  featureOnlyChainRan: boolean;
  featureOnlyResearchPlanningReady: boolean;
  materializerConclusion: R1161FeatureOnlySafeAvailabilityConfirmationMaterializerOutput["summary"]["conclusion"];
}): RunnerConclusion {
  if (input.featureOnlyResearchPlanningReady) {
    return "feature_only_safe_confirmation_to_research_runner_ready_research_only";
  }
  if (input.featureOnlyChainRan) {
    return "feature_only_safe_confirmation_to_research_runner_waiting_on_feature_only_chain";
  }
  if (
    input.materializerConclusion
      === "feature_only_safe_availability_confirmation_materializer_waiting_on_explicit_row_owner_confirmation"
  ) {
    return "feature_only_safe_confirmation_to_research_runner_waiting_on_row_owner_assertion";
  }
  return "feature_only_safe_confirmation_to_research_runner_waiting_on_prerequisite";
}

function nextActionFor(input: {
  conclusion: RunnerConclusion;
  r1153: R1153OrdinaryConsumerFeatureOnlyChainRunnerOutput | null;
  r1161: R1161FeatureOnlySafeAvailabilityConfirmationMaterializerOutput;
}): RunnerNextAction {
  if (input.conclusion === "feature_only_safe_confirmation_to_research_runner_waiting_on_row_owner_assertion") {
    return "row_owner_assert_feature_only_lab_wearable_availability_then_run_r1163_runner";
  }
  if (input.r1153 !== null) {
    return input.r1153.summary.nextAction;
  }
  return input.r1161.summary.nextAction;
}

function rowOwnerAssertionContract(): RowOwnerAssertionContract {
  return {
    assertionItems: [
      {
        assertionItemId: "assert_target_age_band_roughly_16_50",
        mapsToChecklistIds: ["confirm_target_age_band_without_identifiers"],
        mapsToSourceFamilyIds: [],
        privateDetailsStored: false,
        safeAssertion: "The intended ordinary submitter is roughly in the 16-50 age band, without naming or identifying them.",
        safeInputKindIds: [],
      },
      {
        assertionItemId: "assert_glycemia_bloodwork_export_available",
        mapsToChecklistIds: ["confirm_glycemia_bloodwork_export_available"],
        mapsToSourceFamilyIds: ["bloodwork_glycemia"],
        privateDetailsStored: false,
        safeAssertion: "A glycemia-related bloodwork/lab export or spreadsheet is available.",
        safeInputKindIds: ["lab_portal_export_or_spreadsheet"],
      },
      {
        assertionItemId: "assert_daily_wearable_activity_export_available",
        mapsToChecklistIds: ["confirm_daily_wearable_activity_export_available"],
        mapsToSourceFamilyIds: ["wearable_activity_daily"],
        privateDetailsStored: false,
        safeAssertion: "A phone, watch, or wearable daily activity export is available.",
        safeInputKindIds: ["phone_watch_or_wearable_activity_export"],
      },
      {
        assertionItemId: "assert_assertion_contains_no_private_values",
        mapsToChecklistIds: ["confirm_no_private_values_in_confirmation"],
        mapsToSourceFamilyIds: [],
        privateDetailsStored: false,
        safeAssertion: "The assertion contains no private values, filenames, paths, headers, identifiers, row contents, predictions, coefficients, or source text.",
        safeInputKindIds: [],
      },
    ],
    assertionItemIds: [...ROW_OWNER_ASSERTION_ITEM_IDS],
    assertionReadyForAverageSubmitter: true,
    blockedPrivateContent: [...BLOCKED_PRIVATE_CONTENT],
    commandAfterAssertion: R1163_ASSERTION_TO_RESEARCH_RUNNER_COMMAND,
    minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
    modelEvidencePromotionAllowed: false,
    optionalAddOnFamilyIds: [...OPTIONAL_ADD_ON_FAMILY_IDS],
    privateDetailsStored: false,
    requiredChecklistIds: [...REQUIRED_CHECKLIST_IDS],
    requiredInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
    rowLevelDataAcceptedByR1163: false,
    rowOwnerPrivateValuesStored: false,
    safeAssertionMeaning:
      "Confirm only that the ordinary 16-50 lab-plus-wearable source families are available; do not submit private files or values to this artifact.",
    targetAgeBand: TARGET_AGE_BAND,
    targetInputPriority: TARGET_INPUT_PRIORITY,
  };
}

function summarizeR1161(
  output: R1161FeatureOnlySafeAvailabilityConfirmationMaterializerOutput,
): ArtifactSummary {
  return {
    artifact: R1161_ARTIFACT,
    packetId: output.packetId,
    schemaVersion: output.schemaVersion,
    status: "available",
  };
}

function summarizeR1153(
  output: R1153OrdinaryConsumerFeatureOnlyChainRunnerOutput | null,
): ArtifactSummary {
  return {
    artifact: R1153_ARTIFACT,
    packetId: output?.packetId ?? null,
    schemaVersion: output?.schemaVersion ?? null,
    status: output === null ? "missing" : "available",
  };
}

function safeBoundary(): R1163FeatureOnlySafeConfirmationToResearchRunnerOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    childOutputPathsStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    confirmationArtifactLocalPathStored: false,
    confirmationValuesStoredByR1163: false,
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
    rowLevelDataAcceptedByR1163: false,
    rowOwnerAssertionInferredByR1163: false,
    rowOwnerPrivateValuesStored: false,
    rowParsingPerformedByR1163: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

function validateChildOutput(label: string, value: unknown): void {
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1163 rejected unsafe ${label} output: ${formatFindingCount(findings)}`);
  }
}

function formatFindingCount(findings: readonly string[]): string {
  return `${findings.length} finding${findings.length === 1 ? "" : "s"}`;
}

function readConfirmationAssertionFromEnv(value: string | undefined): boolean {
  return value === "true";
}

function cliSummary(output: R1163FeatureOnlySafeConfirmationToResearchRunnerOutput): Record<string, unknown> {
  return {
    conclusion: output.summary.conclusion,
    confirmedSafeConfirmationArtifact: output.summary.confirmedSafeConfirmationArtifact,
    explicitRowOwnerConfirmationAssertionProvided: output.summary.explicitRowOwnerConfirmationAssertionProvided,
    featureOnlyChainConclusion: output.summary.featureOnlyChainConclusion,
    featureOnlyChainRan: output.summary.featureOnlyChainRan,
    featureOnlyResearchPlanningReady: output.summary.featureOnlyResearchPlanningReady,
    materializerConclusion: output.summary.materializerConclusion,
    materializerNextAction: output.summary.materializerNextAction,
    minimumFeaturePairRequired: output.summary.minimumFeaturePairRequired,
    modelEvidencePromotionAllowed: output.summary.modelEvidencePromotionAllowed,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    requiredChecklistIds: output.summary.requiredChecklistIds,
    requiredInputKindIds: output.summary.requiredInputKindIds,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowOwnerAssertionCommand: output.summary.rowOwnerAssertionCommand,
    rowOwnerAssertionContractItemIds: output.summary.rowOwnerAssertionContractItemIds,
    rowOwnerAssertionContractReady: output.summary.rowOwnerAssertionContractReady,
    rowLevelDataAcceptedByR1163: output.summary.rowLevelDataAcceptedByR1163,
    rowOwnerAssertionInferredByR1163: output.summary.rowOwnerAssertionInferredByR1163,
    rowOwnerAssertionStillRequired: output.summary.rowOwnerAssertionStillRequired,
    rowOwnerPrivateValuesStored: output.summary.rowOwnerPrivateValuesStored,
    rowParsingPerformedByR1163: output.summary.rowParsingPerformedByR1163,
    safeConfirmationArtifactWritten: output.summary.safeConfirmationArtifactWritten,
    schemaVersion: output.schemaVersion,
    status: output.status,
    targetAgeBand: output.summary.targetAgeBand,
    targetInputPriority: output.summary.targetInputPriority,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1163FeatureOnlySafeConfirmationToResearchRunner({
    featureOnlyTemplatePath: process.env.MURPH_AGE_R1150_FEATURE_ONLY_SAFE_AVAILABILITY_CONFIRMATION_TEMPLATE_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1149Path: process.env.MURPH_AGE_R1149_ORDINARY_CONSUMER_LAB_WEARABLE_SUBMISSION_KIT_PATH,
    r1160Path: process.env.MURPH_AGE_R1160_R1159_FEATURE_ONLY_SAFE_CONFIRMATION_TRANSCRIPTION_PROOF_PATH,
    rowOwnerAssertionsConfirmed: readConfirmationAssertionFromEnv(
      process.env.MURPH_AGE_R1161_ROW_OWNER_FEATURE_ONLY_CONFIRMATION_ASSERTIONS_CONFIRMED,
    ),
  });
  process.stdout.write(`${JSON.stringify(cliSummary(output), null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1163 safe confirmation runner failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
