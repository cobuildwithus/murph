import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1165_SAFE_ASSERTION_RUNNER_COMMAND,
  runR1165OrdinaryConsumerFeatureOnlySafeAssertionRunner,
  type R1165OrdinaryConsumerFeatureOnlySafeAssertionRunnerOutput,
} from "./r1165-ordinary-consumer-feature-only-safe-assertion-runner.ts";
import {
  R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND,
  runR1172OrdinaryConsumerSafeAssertionMaterializer,
  type R1172OrdinaryConsumerSafeAssertionMaterializerOutput,
} from "./r1172-ordinary-consumer-safe-assertion-materializer.ts";

export const R1176_R1172_R1165_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_SCHEMA_VERSION =
  "murph-age-r1176-r1172-r1165-row-owner-safe-assertion-chain-runner.v1" as const;
export const R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND =
  "MURPH_AGE_R1176_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTIONS_CONFIRMED=true pnpm exec tsx scripts/murph-age/r1176-r1172-r1165-row-owner-safe-assertion-chain-runner.ts" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME =
  "r1176-r1172-r1165-row-owner-safe-assertion-chain-runner.latest.json" as const;
const R1172_ARTIFACT =
  "r1172-ordinary-consumer-safe-assertion-materializer.latest.json" as const;
const R1165_ARTIFACT =
  "r1165-ordinary-consumer-feature-only-safe-assertion-runner.latest.json" as const;
const MATERIALIZED_ASSERTION_ARTIFACT =
  "r1172-row-owner-feature-only-safe-assertion.json" as const;
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
const ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECKLIST_ITEM_IDS = [
  "confirm_target_age_band_without_identifiers",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
] as const;
const ORDINARY_SUBMITTER_COMPLETION_MODE_ID = "feature_only_lab_wearable_coverage" as const;
const ROW_OWNER_HANDOFF_REASON_ID =
  "confirm_feature_only_lab_wearable_availability_before_r1176_live_chain" as const;
const SAFE_FIELD_EDIT_PATHS = [
  "sourceFamilies[bloodwork_glycemia].available",
  "sourceFamilies[wearable_activity_daily].available",
  "sourceFamilies[common_bloodwork_core].available",
  "sourceFamilies[vitals_body_context].available",
  "rowOwnerAssertionsConfirmed",
  "privateContentExcluded",
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
type SafeAssertionAllowedValueKindId = typeof SAFE_ASSERTION_ALLOWED_VALUE_KIND_IDS[number];
type SafeAssertionBlockedContentId = typeof SAFE_ASSERTION_BLOCKED_CONTENT_IDS[number];
type OrdinarySubmitterSafeCompletionChecklistItemId =
  typeof ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECKLIST_ITEM_IDS[number];
type SafeFieldEditPath = typeof SAFE_FIELD_EDIT_PATHS[number];
type ChainConclusion =
  | "row_owner_safe_assertion_chain_ready_research_only"
  | "row_owner_safe_assertion_chain_waiting_on_explicit_confirmation"
  | "row_owner_safe_assertion_chain_waiting_on_r1165_research_runner"
  | "row_owner_safe_assertion_chain_waiting_on_r1172_prerequisite";
type ChainNextAction =
  | "inspect_r1176_row_owner_safe_assertion_chain_outputs"
  | "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation"
  | R1165OrdinaryConsumerFeatureOnlySafeAssertionRunnerOutput["summary"]["nextAction"]
  | R1172OrdinaryConsumerSafeAssertionMaterializerOutput["summary"]["nextAction"];

interface ChildArtifactSummary {
  artifact: string | null;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "not_run";
}

export interface R1176R1172R1165RowOwnerSafeAssertionChainRunnerOptions {
  createdAt?: string;
  featureOnlyTemplatePath?: string;
  outputDir?: string;
  r1149Path?: string;
  r1160Path?: string;
  r1165Path?: string;
  r1165TemplatePath?: string;
  r1167Path?: string;
  rowOwnerAssertionsConfirmed?: boolean;
}

export interface R1176R1172R1165RowOwnerSafeAssertionChainRunnerOutput {
  artifactBoundary: {
    aggregateOnly: true;
    assertionFilePathStored: false;
    assertionValuesStoredByR1176: false;
    childOutputPathsStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    fileNamesStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    materializedAssertionPathStored: false;
    modelEvidencePromotedByR1176: false;
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
    rowLevelDataAcceptedByR1176: false;
    rowOwnerAssertionInferredByR1176: false;
    rowOwnerPrivateValuesStored: false;
    rowParsingPerformedByR1176: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  chainRun: {
    allowedValueKindIds: SafeAssertionAllowedValueKindId[];
    blockedContentIds: SafeAssertionBlockedContentId[];
    chainRunnerCommand: typeof R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND;
    explicitRowOwnerAssertionProvided: boolean;
    featureOnlyResearchPlanningReady: boolean;
    materializedAssertionArtifact: typeof MATERIALIZED_ASSERTION_ARTIFACT | null;
    materializedAssertionPathStored: false;
    minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    optionalAddOnFamilyIds: OptionalAddOnFamilyId[];
    ordinarySubmitterCompletionModeId: typeof ORDINARY_SUBMITTER_COMPLETION_MODE_ID;
    ordinarySubmitterSafeCompletionChecklistItemIds: OrdinarySubmitterSafeCompletionChecklistItemId[];
    outcomeLinkedModelEvidenceStillRequired: true;
    productDisplayAuthorized: false;
    realEvidenceProduced: false;
    requiredInputKindIds: RequiredInputKindId[];
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1176: false;
    rowOwnerAssertionStillRequiredForLiveChain: boolean;
    rowOwnerPrivateValuesStored: false;
    r1163Conclusion: R1165OrdinaryConsumerFeatureOnlySafeAssertionRunnerOutput["r1163State"]["conclusion"] | null;
    r1163FeatureOnlyResearchPlanningReady: boolean | null;
    r1165AssertionAccepted: boolean | null;
    r1165ChildR1163Ran: boolean | null;
    r1165Conclusion: R1165OrdinaryConsumerFeatureOnlySafeAssertionRunnerOutput["summary"]["conclusion"] | null;
    r1165FeatureOnlyResearchPlanningReady: boolean | null;
    r1165NextAction: R1165OrdinaryConsumerFeatureOnlySafeAssertionRunnerOutput["summary"]["nextAction"] | null;
    r1165RunnerCommand: typeof R1165_SAFE_ASSERTION_RUNNER_COMMAND;
    r1172Conclusion: R1172OrdinaryConsumerSafeAssertionMaterializerOutput["summary"]["conclusion"] | null;
    r1172MaterializerCommand: typeof R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND;
    r1172NextAction: R1172OrdinaryConsumerSafeAssertionMaterializerOutput["summary"]["nextAction"] | null;
    r1172SafeAssertionArtifactWritten: boolean | null;
    r1172WouldBeAcceptedByR1165: boolean | null;
    rowOwnerHandoffReasonId: typeof ROW_OWNER_HANDOFF_REASON_ID;
    safeFieldEditCount: number;
    safeFieldEditPaths: SafeFieldEditPath[];
  };
  childArtifacts: {
    r1165: ChildArtifactSummary;
    r1172: ChildArtifactSummary;
  };
  createdAt: string;
  packetId: "r1176-r1172-r1165-row-owner-safe-assertion-chain-runner";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1176_R1172_R1165_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    allowedValueKindIds: SafeAssertionAllowedValueKindId[];
    blockedContentIds: SafeAssertionBlockedContentId[];
    chainReady: boolean;
    conclusion: ChainConclusion;
    explicitRowOwnerAssertionProvided: boolean;
    featureOnlyResearchPlanningReady: boolean;
    materializedAssertionArtifact: typeof MATERIALIZED_ASSERTION_ARTIFACT | null;
    materializedAssertionPathStored: false;
    minimumFeaturePairRequired: FeatureOnlySourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    nextAction: ChainNextAction;
    optionalAddOnFamilyIds: OptionalAddOnFamilyId[];
    ordinarySubmitterCompletionModeId: typeof ORDINARY_SUBMITTER_COMPLETION_MODE_ID;
    ordinarySubmitterSafeCompletionChecklistItemIds: OrdinarySubmitterSafeCompletionChecklistItemId[];
    outcomeLinkedModelEvidenceStillRequired: true;
    productDisplayAuthorized: false;
    realEvidenceProduced: false;
    requiredInputKindIds: RequiredInputKindId[];
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1176: false;
    rowOwnerAssertionStillRequiredForLiveChain: boolean;
    rowOwnerPrivateValuesStored: false;
    rowParsingPerformedByR1176: false;
    r1163FeatureOnlyResearchPlanningReady: boolean | null;
    r1165AssertionAccepted: boolean | null;
    r1165ChildR1163Ran: boolean | null;
    r1165FeatureOnlyResearchPlanningReady: boolean | null;
    r1172MaterializedAssertionWritten: boolean | null;
    r1172WouldBeAcceptedByR1165: boolean | null;
    rowOwnerHandoffReasonId: typeof ROW_OWNER_HANDOFF_REASON_ID;
    safeFieldEditCount: number;
    safeFieldEditPaths: SafeFieldEditPath[];
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
}

export async function runR1176R1172R1165RowOwnerSafeAssertionChainRunner(
  options: R1176R1172R1165RowOwnerSafeAssertionChainRunnerOptions = {},
): Promise<{ output: R1176R1172R1165RowOwnerSafeAssertionChainRunnerOutput; outputPath: string }> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const explicitRowOwnerAssertionProvided = options.rowOwnerAssertionsConfirmed === true;
  const r1172 = explicitRowOwnerAssertionProvided
    ? await runR1172OrdinaryConsumerSafeAssertionMaterializer({
      createdAt: options.createdAt,
      outputDir,
      r1165Path: options.r1165Path,
      r1165TemplatePath: options.r1165TemplatePath,
      r1167Path: options.r1167Path,
      rowOwnerAssertionsConfirmed: true,
    })
    : null;
  if (r1172 !== null) validateAggregateSafe("r1172 chain output", r1172.output);

  const r1165 = r1172?.materializedAssertionPath === null || r1172 === null
    ? null
    : await runR1165OrdinaryConsumerFeatureOnlySafeAssertionRunner({
      assertionPath: r1172.materializedAssertionPath,
      createdAt: options.createdAt,
      featureOnlyTemplatePath: options.featureOnlyTemplatePath,
      outputDir,
      r1149Path: options.r1149Path,
      r1160Path: options.r1160Path,
    });
  if (r1165 !== null) validateAggregateSafe("r1165 chain output", r1165.output);

  const chainReady = liveChainReady({ r1165: r1165?.output ?? null, r1172: r1172?.output ?? null });
  const conclusion = conclusionFor({
    chainReady,
    explicitRowOwnerAssertionProvided,
    r1165: r1165?.output ?? null,
    r1172: r1172?.output ?? null,
  });
  const nextAction = nextActionFor({
    conclusion,
    r1165: r1165?.output ?? null,
    r1172: r1172?.output ?? null,
  });
  const rowOwnerAssertionStillRequiredForLiveChain = !explicitRowOwnerAssertionProvided;
  const output: R1176R1172R1165RowOwnerSafeAssertionChainRunnerOutput = {
    artifactBoundary: safeBoundary(),
    chainRun: {
      allowedValueKindIds: [...SAFE_ASSERTION_ALLOWED_VALUE_KIND_IDS],
      blockedContentIds: [...SAFE_ASSERTION_BLOCKED_CONTENT_IDS],
      chainRunnerCommand: R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
      explicitRowOwnerAssertionProvided,
      featureOnlyResearchPlanningReady: chainReady,
      materializedAssertionArtifact: r1172?.output.summary.materializedAssertionArtifact ?? null,
      materializedAssertionPathStored: false,
      minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      optionalAddOnFamilyIds: [...OPTIONAL_ADD_ON_FAMILY_IDS],
      ordinarySubmitterCompletionModeId: ORDINARY_SUBMITTER_COMPLETION_MODE_ID,
      ordinarySubmitterSafeCompletionChecklistItemIds: [
        ...ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECKLIST_ITEM_IDS,
      ],
      outcomeLinkedModelEvidenceStillRequired: true,
      productDisplayAuthorized: false,
      realEvidenceProduced: false,
      requiredInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1176: false,
      rowOwnerAssertionStillRequiredForLiveChain,
      rowOwnerPrivateValuesStored: false,
      r1163Conclusion: r1165?.output.r1163State.conclusion ?? null,
      r1163FeatureOnlyResearchPlanningReady:
        r1165?.output.r1163State.featureOnlyResearchPlanningReady ?? null,
      r1165AssertionAccepted: r1165?.output.summary.assertionAccepted ?? null,
      r1165ChildR1163Ran: r1165?.output.summary.childR1163Ran ?? null,
      r1165Conclusion: r1165?.output.summary.conclusion ?? null,
      r1165FeatureOnlyResearchPlanningReady:
        r1165?.output.summary.featureOnlyResearchPlanningReady ?? null,
      r1165NextAction: r1165?.output.summary.nextAction ?? null,
      r1165RunnerCommand: R1165_SAFE_ASSERTION_RUNNER_COMMAND,
      r1172Conclusion: r1172?.output.summary.conclusion ?? null,
      r1172MaterializerCommand: R1172_SAFE_ASSERTION_MATERIALIZER_COMMAND,
      r1172NextAction: r1172?.output.summary.nextAction ?? null,
      r1172SafeAssertionArtifactWritten: r1172?.output.summary.safeAssertionArtifactWritten ?? null,
      r1172WouldBeAcceptedByR1165:
        r1172?.output.summary.materializedAssertionWouldBeAcceptedByR1165 ?? null,
      rowOwnerHandoffReasonId: ROW_OWNER_HANDOFF_REASON_ID,
      safeFieldEditCount: SAFE_FIELD_EDIT_PATHS.length,
      safeFieldEditPaths: [...SAFE_FIELD_EDIT_PATHS],
    },
    childArtifacts: {
      r1165: summarizeR1165(r1165?.output ?? null),
      r1172: summarizeR1172(r1172?.output ?? null),
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    packetId: "r1176-r1172-r1165-row-owner-safe-assertion-chain-runner",
    productDisplayAuthorized: false,
    schemaVersion: R1176_R1172_R1165_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      allowedValueKindIds: [...SAFE_ASSERTION_ALLOWED_VALUE_KIND_IDS],
      blockedContentIds: [...SAFE_ASSERTION_BLOCKED_CONTENT_IDS],
      chainReady,
      conclusion,
      explicitRowOwnerAssertionProvided,
      featureOnlyResearchPlanningReady: chainReady,
      materializedAssertionArtifact: r1172?.output.summary.materializedAssertionArtifact ?? null,
      materializedAssertionPathStored: false,
      minimumFeaturePairRequired: [...FEATURE_ONLY_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      nextAction,
      optionalAddOnFamilyIds: [...OPTIONAL_ADD_ON_FAMILY_IDS],
      ordinarySubmitterCompletionModeId: ORDINARY_SUBMITTER_COMPLETION_MODE_ID,
      ordinarySubmitterSafeCompletionChecklistItemIds: [
        ...ORDINARY_SUBMITTER_SAFE_COMPLETION_CHECKLIST_ITEM_IDS,
      ],
      outcomeLinkedModelEvidenceStillRequired: true,
      productDisplayAuthorized: false,
      realEvidenceProduced: false,
      requiredInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1176: false,
      rowOwnerAssertionStillRequiredForLiveChain,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1176: false,
      r1163FeatureOnlyResearchPlanningReady:
        r1165?.output.r1163State.featureOnlyResearchPlanningReady ?? null,
      r1165AssertionAccepted: r1165?.output.summary.assertionAccepted ?? null,
      r1165ChildR1163Ran: r1165?.output.summary.childR1163Ran ?? null,
      r1165FeatureOnlyResearchPlanningReady:
        r1165?.output.summary.featureOnlyResearchPlanningReady ?? null,
      r1172MaterializedAssertionWritten: r1172?.output.summary.safeAssertionArtifactWritten ?? null,
      r1172WouldBeAcceptedByR1165:
        r1172?.output.summary.materializedAssertionWouldBeAcceptedByR1165 ?? null,
      rowOwnerHandoffReasonId: ROW_OWNER_HANDOFF_REASON_ID,
      safeFieldEditCount: SAFE_FIELD_EDIT_PATHS.length,
      safeFieldEditPaths: [...SAFE_FIELD_EDIT_PATHS],
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };

  ensureNoOutputPathInOutput(output, outputDir);
  validateAggregateSafe("r1176 row-owner chain output", output);
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeJson(outputPath, output);
  return { output, outputPath };
}

function liveChainReady(input: {
  r1165: R1165OrdinaryConsumerFeatureOnlySafeAssertionRunnerOutput | null;
  r1172: R1172OrdinaryConsumerSafeAssertionMaterializerOutput | null;
}): boolean {
  return input.r1172?.summary.conclusion === "ordinary_consumer_safe_assertion_materialized"
    && input.r1172.summary.explicitRowOwnerAssertionProvided === true
    && input.r1172.summary.safeAssertionArtifactWritten === true
    && input.r1172.summary.materializedAssertionWouldBeAcceptedByR1165 === true
    && input.r1165?.summary.assertionAccepted === true
    && input.r1165.summary.childR1163Ran === true
    && input.r1165.summary.conclusion === "ordinary_feature_only_safe_assertion_runner_ready_research_only"
    && input.r1165.summary.featureOnlyResearchPlanningReady === true
    && input.r1165.summary.validationReasonIds.length === 0
    && input.r1165.r1163State.conclusion === "feature_only_safe_confirmation_to_research_runner_ready_research_only"
    && input.r1165.r1163State.featureOnlyResearchPlanningReady === true;
}

function conclusionFor(input: {
  chainReady: boolean;
  explicitRowOwnerAssertionProvided: boolean;
  r1165: R1165OrdinaryConsumerFeatureOnlySafeAssertionRunnerOutput | null;
  r1172: R1172OrdinaryConsumerSafeAssertionMaterializerOutput | null;
}): ChainConclusion {
  if (!input.explicitRowOwnerAssertionProvided) {
    return "row_owner_safe_assertion_chain_waiting_on_explicit_confirmation";
  }
  if (input.r1172?.summary.safeAssertionArtifactWritten !== true) {
    return "row_owner_safe_assertion_chain_waiting_on_r1172_prerequisite";
  }
  if (!input.chainReady || input.r1165 === null) {
    return "row_owner_safe_assertion_chain_waiting_on_r1165_research_runner";
  }
  return "row_owner_safe_assertion_chain_ready_research_only";
}

function nextActionFor(input: {
  conclusion: ChainConclusion;
  r1165: R1165OrdinaryConsumerFeatureOnlySafeAssertionRunnerOutput | null;
  r1172: R1172OrdinaryConsumerSafeAssertionMaterializerOutput | null;
}): ChainNextAction {
  if (input.conclusion === "row_owner_safe_assertion_chain_waiting_on_explicit_confirmation") {
    return "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation";
  }
  if (input.conclusion === "row_owner_safe_assertion_chain_waiting_on_r1172_prerequisite") {
    return input.r1172?.summary.nextAction ?? "inspect_r1176_row_owner_safe_assertion_chain_outputs";
  }
  if (input.conclusion === "row_owner_safe_assertion_chain_waiting_on_r1165_research_runner") {
    return input.r1165?.summary.nextAction ?? "inspect_r1176_row_owner_safe_assertion_chain_outputs";
  }
  return input.r1165?.summary.nextAction ?? "run_r1164_feature_only_research_handoff";
}

function summarizeR1172(
  output: R1172OrdinaryConsumerSafeAssertionMaterializerOutput | null,
): ChildArtifactSummary {
  return {
    artifact: output === null ? null : R1172_ARTIFACT,
    packetId: output?.packetId ?? null,
    schemaVersion: output?.schemaVersion ?? null,
    status: output === null ? "not_run" : "available",
  };
}

function summarizeR1165(
  output: R1165OrdinaryConsumerFeatureOnlySafeAssertionRunnerOutput | null,
): ChildArtifactSummary {
  return {
    artifact: output === null ? null : R1165_ARTIFACT,
    packetId: output?.packetId ?? null,
    schemaVersion: output?.schemaVersion ?? null,
    status: output === null ? "not_run" : "available",
  };
}

function safeBoundary(): R1176R1172R1165RowOwnerSafeAssertionChainRunnerOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    assertionFilePathStored: false,
    assertionValuesStoredByR1176: false,
    childOutputPathsStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    fileNamesStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    materializedAssertionPathStored: false,
    modelEvidencePromotedByR1176: false,
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
    rowLevelDataAcceptedByR1176: false,
    rowOwnerAssertionInferredByR1176: false,
    rowOwnerPrivateValuesStored: false,
    rowParsingPerformedByR1176: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

function validateAggregateSafe(label: string, value: unknown): void {
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1176 rejected unsafe ${label}: ${formatFindingCount(findings)}`);
  }
}

function ensureNoOutputPathInOutput(
  output: R1176R1172R1165RowOwnerSafeAssertionChainRunnerOutput,
  outputDir: string,
): void {
  if (JSON.stringify(output).includes(outputDir)) {
    throw new Error("R1176 rejected chain output with output path leakage.");
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function cliSummary(output: R1176R1172R1165RowOwnerSafeAssertionChainRunnerOutput): Record<string, unknown> {
  return {
    allowedValueKindIds: output.summary.allowedValueKindIds,
    blockedContentIds: output.summary.blockedContentIds,
    chainReady: output.summary.chainReady,
    conclusion: output.summary.conclusion,
    explicitRowOwnerAssertionProvided: output.summary.explicitRowOwnerAssertionProvided,
    featureOnlyResearchPlanningReady: output.summary.featureOnlyResearchPlanningReady,
    materializedAssertionArtifact: output.summary.materializedAssertionArtifact,
    materializedAssertionPathStored: output.summary.materializedAssertionPathStored,
    modelEvidencePromotionAllowed: output.summary.modelEvidencePromotionAllowed,
    nextAction: output.summary.nextAction,
    optionalAddOnFamilyIds: output.summary.optionalAddOnFamilyIds,
    ordinarySubmitterCompletionModeId: output.summary.ordinarySubmitterCompletionModeId,
    ordinarySubmitterSafeCompletionChecklistItemIds:
      output.summary.ordinarySubmitterSafeCompletionChecklistItemIds,
    outcomeLinkedModelEvidenceStillRequired: output.summary.outcomeLinkedModelEvidenceStillRequired,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    realEvidenceProduced: output.summary.realEvidenceProduced,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowLevelDataAcceptedByR1176: output.summary.rowLevelDataAcceptedByR1176,
    rowOwnerAssertionStillRequiredForLiveChain: output.summary.rowOwnerAssertionStillRequiredForLiveChain,
    rowOwnerPrivateValuesStored: output.summary.rowOwnerPrivateValuesStored,
    r1163FeatureOnlyResearchPlanningReady: output.summary.r1163FeatureOnlyResearchPlanningReady,
    r1165AssertionAccepted: output.summary.r1165AssertionAccepted,
    r1165ChildR1163Ran: output.summary.r1165ChildR1163Ran,
    r1165FeatureOnlyResearchPlanningReady: output.summary.r1165FeatureOnlyResearchPlanningReady,
    r1172MaterializedAssertionWritten: output.summary.r1172MaterializedAssertionWritten,
    r1172WouldBeAcceptedByR1165: output.summary.r1172WouldBeAcceptedByR1165,
    rowOwnerHandoffReasonId: output.summary.rowOwnerHandoffReasonId,
    safeFieldEditCount: output.summary.safeFieldEditCount,
    schemaVersion: output.schemaVersion,
    status: output.status,
    targetAgeBand: output.summary.targetAgeBand,
    targetInputPriority: output.summary.targetInputPriority,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1176R1172R1165RowOwnerSafeAssertionChainRunner({
    createdAt: process.env.MURPH_AGE_R1176_CREATED_AT,
    featureOnlyTemplatePath: process.env.MURPH_AGE_R1150_FEATURE_ONLY_SAFE_AVAILABILITY_CONFIRMATION_TEMPLATE_PATH,
    outputDir: process.env.MURPH_AGE_R1176_OUTPUT_DIR ?? process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1149Path: process.env.MURPH_AGE_R1149_ORDINARY_CONSUMER_LAB_WEARABLE_SUBMISSION_KIT_PATH,
    r1160Path: process.env.MURPH_AGE_R1160_R1159_FEATURE_ONLY_SAFE_CONFIRMATION_TRANSCRIPTION_PROOF_PATH,
    r1165Path: process.env.MURPH_AGE_R1165_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_RUNNER_PATH,
    r1165TemplatePath: process.env.MURPH_AGE_R1165_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTION_TEMPLATE_PATH,
    r1167Path: process.env.MURPH_AGE_R1167_ORDINARY_CONSUMER_FEATURE_ONLY_SAFE_ASSERTION_FILL_GUIDE_PATH,
    rowOwnerAssertionsConfirmed:
      process.env.MURPH_AGE_R1176_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTIONS_CONFIRMED === "true",
  });
  process.stdout.write(`${JSON.stringify(cliSummary(output), null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1176 row-owner safe assertion chain failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}

function formatFindingCount(findings: readonly unknown[]): string {
  return `${findings.length} finding${findings.length === 1 ? "" : "s"}`;
}
