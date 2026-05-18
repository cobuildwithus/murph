import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1145_ORDINARY_CONSUMER_CURRENT_CHAIN_COMPLETION_AUDIT_SCHEMA_VERSION,
} from "./r1145-ordinary-consumer-current-chain-completion-audit.ts";
import {
  R1174_ORDINARY_CONSUMER_SAFE_NEXT_STEP_PACKET_SCHEMA_VERSION,
  R1174_SAFE_NEXT_STEP_PACKET_COMMAND,
} from "./r1174-ordinary-consumer-safe-next-step-packet.ts";
import {
  R1176_R1172_R1165_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_SCHEMA_VERSION,
  R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
} from "./r1176-r1172-r1165-row-owner-safe-assertion-chain-runner.ts";

export const R1177_ORDINARY_CONSUMER_AVERAGE_SUBMITTER_PRIORITY_PACKET_SCHEMA_VERSION =
  "murph-age-r1177-ordinary-consumer-average-submitter-priority-packet.v1" as const;
export const R1177_AVERAGE_SUBMITTER_PRIORITY_PACKET_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1177-ordinary-consumer-average-submitter-priority-packet.ts" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME =
  "r1177-ordinary-consumer-average-submitter-priority-packet.latest.json" as const;
const R1145_ARTIFACT =
  "r1145-ordinary-consumer-current-chain-completion-audit.latest.json" as const;
const R1174_ARTIFACT =
  "r1174-ordinary-consumer-safe-next-step-packet.latest.json" as const;
const R1176_ARTIFACT =
  "r1176-r1172-r1165-row-owner-safe-assertion-chain-runner.latest.json" as const;
const R1145_PACKET_ID = "r1145-ordinary-consumer-current-chain-completion-audit" as const;
const R1174_PACKET_ID = "r1174-ordinary-consumer-safe-next-step-packet" as const;
const R1176_PACKET_ID = "r1176-r1172-r1165-row-owner-safe-assertion-chain-runner" as const;
const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first" as const;
const TARGET_AGE_BAND = "roughly_16_50" as const;
const MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
] as const;
const REQUIRED_INPUT_KIND_IDS = [
  "lab_portal_export_or_spreadsheet",
  "phone_watch_or_wearable_activity_export",
] as const;
const OPTIONAL_CONTEXT_SOURCE_FAMILY_IDS = [
  "common_bloodwork_core",
  "vitals_body_context",
] as const;
const DEFERRED_UNTIL_MINIMUM_PAIR_CONFIRMED_IDS = [
  "common_bloodwork_core",
  "vitals_body_context",
  "wearable_sleep",
  "wearable_recovery",
  "wearable_hrv",
  "advanced_biomarkers",
] as const;
const FIRST_SUBMITTER_ASK_IDS = [
  "has_glycemia_bloodwork_export",
  "has_daily_wearable_activity_export",
  "can_confirm_without_private_values",
] as const;
const SAFE_COMPLETION_CHECKLIST_ITEM_IDS = [
  "confirm_target_age_band_without_identifiers",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
] as const;
const BLOCKED_CONTENT_IDS = [
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
const ALLOWED_VALUE_KIND_IDS = [
  "booleans_only",
  "fixed_enumerated_ids_only",
] as const;
const MISSING_REQUIREMENT_IDS = [
  "row_owner_availability_assertions_confirmed",
  "confirmed_recipe_route_requirements_available",
  "private_route_config_supplied",
  "real_lab_wearable_route_metrics_recorded",
] as const;
const PRIORITY_STEP_SPECS = [
  {
    requirementId: "row_owner_availability_assertions_confirmed",
    stepId: "confirm_minimum_lab_wearable_pair_available",
  },
  {
    requirementId: "confirmed_recipe_route_requirements_available",
    stepId: "confirm_lab_wearable_recipe_route_requirements",
  },
  {
    requirementId: "private_route_config_supplied",
    stepId: "provide_private_route_config_locally",
  },
  {
    requirementId: "real_lab_wearable_route_metrics_recorded",
    stepId: "run_lab_wearable_route_metrics_locally",
  },
] as const;
const DEFAULT_RECIPE_READINESS_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ID=<recipe-id> MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ASSERTIONS_CONFIRMED=true pnpm exec tsx scripts/murph-age/r1144-ordinary-consumer-recipe-readiness-chain-runner.ts" as const;
const DEFAULT_PRIVATE_CONFIG_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH=<partial-private-config.json> pnpm exec tsx scripts/murph-age/r1148-ordinary-consumer-post-confirmation-private-config-intake.ts" as const;
const DEFAULT_ROUTE_METRICS_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH=<availability-manifest.json> MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH=<partial-private-config.json> pnpm exec tsx scripts/murph-age/r1142-ordinary-consumer-partial-private-chain-runner.ts" as const;

type MinimumFeaturePairSourceFamilyId = typeof MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS[number];
type RequiredInputKindId = typeof REQUIRED_INPUT_KIND_IDS[number];
type OptionalContextSourceFamilyId = typeof OPTIONAL_CONTEXT_SOURCE_FAMILY_IDS[number];
type DeferredUntilMinimumPairConfirmedId =
  typeof DEFERRED_UNTIL_MINIMUM_PAIR_CONFIRMED_IDS[number];
type FirstSubmitterAskId = typeof FIRST_SUBMITTER_ASK_IDS[number];
type SafeCompletionChecklistItemId = typeof SAFE_COMPLETION_CHECKLIST_ITEM_IDS[number];
type BlockedContentId = typeof BLOCKED_CONTENT_IDS[number];
type AllowedValueKindId = typeof ALLOWED_VALUE_KIND_IDS[number];
type MissingRequirementId = typeof MISSING_REQUIREMENT_IDS[number];
type PriorityStepId = typeof PRIORITY_STEP_SPECS[number]["stepId"];
type PriorityStepRequirementId = typeof PRIORITY_STEP_SPECS[number]["requirementId"];
type PriorityStepStatus = "blocked" | "satisfied";
type PriorityConclusion =
  | "ordinary_average_submitter_priority_packet_ready_for_feature_only_research_handoff"
  | "ordinary_average_submitter_priority_packet_waiting_on_completion_audit"
  | "ordinary_average_submitter_priority_packet_waiting_on_live_chain_packet"
  | "ordinary_average_submitter_priority_packet_waiting_on_minimum_pair_confirmation"
  | "ordinary_average_submitter_priority_packet_waiting_on_safe_next_step_packet";
type PriorityNextAction =
  | "refresh_r1145_completion_audit"
  | "refresh_r1174_safe_next_step_packet"
  | "refresh_r1176_row_owner_safe_assertion_chain"
  | "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation"
  | "run_r1164_feature_only_research_handoff";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface FirstSubmitterAsk {
  askId: FirstSubmitterAskId;
  acceptableEvidenceKind: string;
  mapsToSourceFamilyIds: MinimumFeaturePairSourceFamilyId[];
  privateDetailsStored: false;
  requiredForMinimumPair: boolean;
  safeQuestion: string;
}

interface PriorityStep {
  allowedValueKindIds: AllowedValueKindId[];
  blockedContentIds: BlockedContentId[];
  command: string;
  minimumFeaturePairRequired: MinimumFeaturePairSourceFamilyId[];
  optionalContextNotRequired: OptionalContextSourceFamilyId[];
  privateDetailsStored: false;
  requirementId: PriorityStepRequirementId;
  rowLevelDataAccepted: false;
  safeCompletionChecklistItemIds: SafeCompletionChecklistItemId[];
  status: PriorityStepStatus;
  stepId: PriorityStepId;
}

export interface R1177OrdinaryConsumerAverageSubmitterPriorityPacketOptions {
  createdAt?: string;
  outputDir?: string;
  r1145Path?: string;
  r1174Path?: string;
  r1176Path?: string;
}

export interface R1177OrdinaryConsumerAverageSubmitterPriorityPacketOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    fileNamesStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelEvidencePromotedByR1177: false;
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
    rowLevelDataAcceptedByR1177: false;
    rowOwnerConfirmationInferredByR1177: false;
    rowOwnerPrivateValuesStored: false;
    rowOwnerProvidedValuesStored: false;
    rowParsingPerformedByR1177: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  averageSubmitterPriorityPacket: {
    allowedValueKindIds: AllowedValueKindId[];
    audience: "ordinary_submitter_roughly_16_50_row_owner";
    blockedContentIds: BlockedContentId[];
    deferredUntilMinimumPairConfirmedIds: DeferredUntilMinimumPairConfirmedId[];
    firstSubmitterAsks: FirstSubmitterAsk[];
    minimumFeaturePairConfirmed: boolean;
    minimumFeaturePairRequired: MinimumFeaturePairSourceFamilyId[];
    optionalContextNotRequiredForFirstStep: OptionalContextSourceFamilyId[];
    prioritizedInputKindIds: RequiredInputKindId[];
    prioritySteps: PriorityStep[];
    productDisplayAuthorized: false;
    rowLevelDataAcceptedByR1177: false;
    rowOwnerConfirmationInferredByR1177: false;
    rowOwnerOnlyCommand: typeof R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND;
    rowOwnerPrivateValuesStored: false;
    safeCompletionChecklistItemIds: SafeCompletionChecklistItemId[];
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
  createdAt: string;
  inputArtifacts: {
    r1145CompletionAudit: ArtifactSummary;
    r1174SafeNextStepPacket: ArtifactSummary;
    r1176RowOwnerSafeAssertionChain: ArtifactSummary;
  };
  packetId: "r1177-ordinary-consumer-average-submitter-priority-packet";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1177_ORDINARY_CONSUMER_AVERAGE_SUBMITTER_PRIORITY_PACKET_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    allowedValueKindIds: AllowedValueKindId[];
    blockedContentIds: BlockedContentId[];
    conclusion: PriorityConclusion;
    currentMissingRequirementIds: MissingRequirementId[];
    deferredUntilMinimumPairConfirmedIds: DeferredUntilMinimumPairConfirmedId[];
    firstSubmitterAskIds: FirstSubmitterAskId[];
    minimumFeaturePairConfirmed: boolean;
    minimumFeaturePairRequired: MinimumFeaturePairSourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    nextAction: PriorityNextAction;
    optionalContextNotRequiredForFirstStep: OptionalContextSourceFamilyId[];
    prioritizedInputKindIds: RequiredInputKindId[];
    productDisplayAuthorized: false;
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1177: false;
    rowOwnerConfirmationInferredByR1177: false;
    rowOwnerPrivateValuesStored: false;
    rowParsingPerformedByR1177: false;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
    topRequirementId: MissingRequirementId | null;
  };
}

export async function runR1177OrdinaryConsumerAverageSubmitterPriorityPacket(
  options: R1177OrdinaryConsumerAverageSubmitterPriorityPacketOptions = {},
): Promise<{ output: R1177OrdinaryConsumerAverageSubmitterPriorityPacketOutput; outputPath: string }> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const r1145Path = options.r1145Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1145_ARTIFACT);
  const r1174Path = options.r1174Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1174_ARTIFACT);
  const r1176Path = options.r1176Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1176_ARTIFACT);
  const r1145 = await readJsonIfPresent(r1145Path);
  const r1174 = await readJsonIfPresent(r1174Path);
  const r1176 = await readJsonIfPresent(r1176Path);
  validateAggregateSafe("r1145 completion audit", r1145);
  validateAggregateSafe("r1174 safe next-step packet", r1174);
  validateAggregateSafe("r1176 row-owner chain", r1176);

  const r1145Ready = matchesR1145CompletionAudit(r1145);
  const r1174Ready = matchesR1174SafeNextStepPacket(r1174);
  const r1176Ready = matchesR1176RowOwnerSafeAssertionChain(r1176);
  const minimumFeaturePairConfirmed = r1145Ready
    && r1174Ready
    && matchesR1176ReadyForResearchOnlyHandoff(r1176);
  const currentMissingRequirementIds = r1145Ready
    ? missingRequirementIdsFromR1145(r1145)
    : [...MISSING_REQUIREMENT_IDS];
  const conclusion = conclusionFor({
    minimumFeaturePairConfirmed,
    r1145Ready,
    r1174Ready,
    r1176Ready,
  });
  const nextAction = nextActionFor(conclusion);
  const prioritySteps = buildPrioritySteps({
    currentMissingRequirementIds,
    minimumFeaturePairConfirmed,
  });
  const output: R1177OrdinaryConsumerAverageSubmitterPriorityPacketOutput = {
    artifactBoundary: safeBoundary(),
    averageSubmitterPriorityPacket: {
      allowedValueKindIds: [...ALLOWED_VALUE_KIND_IDS],
      audience: "ordinary_submitter_roughly_16_50_row_owner",
      blockedContentIds: [...BLOCKED_CONTENT_IDS],
      deferredUntilMinimumPairConfirmedIds: [...DEFERRED_UNTIL_MINIMUM_PAIR_CONFIRMED_IDS],
      firstSubmitterAsks: buildFirstSubmitterAsks(),
      minimumFeaturePairConfirmed,
      minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS],
      optionalContextNotRequiredForFirstStep: [...OPTIONAL_CONTEXT_SOURCE_FAMILY_IDS],
      prioritizedInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
      prioritySteps,
      productDisplayAuthorized: false,
      rowLevelDataAcceptedByR1177: false,
      rowOwnerConfirmationInferredByR1177: false,
      rowOwnerOnlyCommand: R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
      rowOwnerPrivateValuesStored: false,
      safeCompletionChecklistItemIds: [...SAFE_COMPLETION_CHECKLIST_ITEM_IDS],
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: {
      r1145CompletionAudit: summarizeArtifact({
        artifact: R1145_ARTIFACT,
        expectedPacketId: R1145_PACKET_ID,
        expectedSchemaVersion: R1145_ORDINARY_CONSUMER_CURRENT_CHAIN_COMPLETION_AUDIT_SCHEMA_VERSION,
        value: r1145,
      }),
      r1174SafeNextStepPacket: summarizeArtifact({
        artifact: R1174_ARTIFACT,
        expectedPacketId: R1174_PACKET_ID,
        expectedSchemaVersion: R1174_ORDINARY_CONSUMER_SAFE_NEXT_STEP_PACKET_SCHEMA_VERSION,
        value: r1174,
      }),
      r1176RowOwnerSafeAssertionChain: summarizeArtifact({
        artifact: R1176_ARTIFACT,
        expectedPacketId: R1176_PACKET_ID,
        expectedSchemaVersion: R1176_R1172_R1165_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_SCHEMA_VERSION,
        value: r1176,
      }),
    },
    packetId: "r1177-ordinary-consumer-average-submitter-priority-packet",
    productDisplayAuthorized: false,
    schemaVersion: R1177_ORDINARY_CONSUMER_AVERAGE_SUBMITTER_PRIORITY_PACKET_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      allowedValueKindIds: [...ALLOWED_VALUE_KIND_IDS],
      blockedContentIds: [...BLOCKED_CONTENT_IDS],
      conclusion,
      currentMissingRequirementIds,
      deferredUntilMinimumPairConfirmedIds: [...DEFERRED_UNTIL_MINIMUM_PAIR_CONFIRMED_IDS],
      firstSubmitterAskIds: [...FIRST_SUBMITTER_ASK_IDS],
      minimumFeaturePairConfirmed,
      minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      nextAction,
      optionalContextNotRequiredForFirstStep: [...OPTIONAL_CONTEXT_SOURCE_FAMILY_IDS],
      prioritizedInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1177: false,
      rowOwnerConfirmationInferredByR1177: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1177: false,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
      topRequirementId: currentMissingRequirementIds[0] ?? null,
    },
  };

  ensureNoOutputPathInOutput(output, outputDir);
  validateAggregateSafe("r1177 average submitter priority packet", output);
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function matchesR1145CompletionAudit(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1145_PACKET_ID
    && readStringAt(value, ["schemaVersion"])
      === R1145_ORDINARY_CONSUMER_CURRENT_CHAIN_COMPLETION_AUDIT_SCHEMA_VERSION
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(value, ["artifactBoundary", "productDisplayAuthorized"]) === false
    && readStringAt(value, ["completionAudit", "restatedObjective"])
      === "prioritize_ordinary_16_50_wearable_data_and_bloodwork_labs_for_murph_age_model"
    && exactStringSet(
      readStringArrayAt(value, ["completionAudit", "prioritizedSubmitterInputFamilyIds"]),
      MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS,
    )
    && readBooleanAt(value, ["productDisplayAuthorized"]) === false;
}

function matchesR1174SafeNextStepPacket(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1174_PACKET_ID
    && readStringAt(value, ["schemaVersion"])
      === R1174_ORDINARY_CONSUMER_SAFE_NEXT_STEP_PACKET_SCHEMA_VERSION
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1174"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerConfirmationInferredByR1174"]) === false
    && readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false
    && exactStringSet(
      readStringArrayAt(value, ["summary", "minimumFeaturePairRequired"]),
      MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS,
    )
    && exactStringSet(readStringArrayAt(value, ["summary", "requiredInputKindIds"]), REQUIRED_INPUT_KIND_IDS);
}

function matchesR1176RowOwnerSafeAssertionChain(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1176_PACKET_ID
    && readStringAt(value, ["schemaVersion"])
      === R1176_R1172_R1165_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_SCHEMA_VERSION
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true
    && readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1176"]) === false
    && readBooleanAt(value, ["summary", "rowParsingPerformedByR1176"]) === false
    && readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false
    && exactStringSet(
      readStringArrayAt(value, ["summary", "minimumFeaturePairRequired"]),
      MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS,
    )
    && exactStringSet(readStringArrayAt(value, ["summary", "requiredInputKindIds"]), REQUIRED_INPUT_KIND_IDS);
}

function matchesR1176ReadyForResearchOnlyHandoff(value: unknown | null): boolean {
  return matchesR1176RowOwnerSafeAssertionChain(value)
    && readStringAt(value, ["summary", "conclusion"]) === "row_owner_safe_assertion_chain_ready_research_only"
    && readBooleanAt(value, ["summary", "chainReady"]) === true
    && readBooleanAt(value, ["summary", "explicitRowOwnerAssertionProvided"]) === true
    && readBooleanAt(value, ["summary", "featureOnlyResearchPlanningReady"]) === true
    && readBooleanAt(value, ["summary", "realEvidenceProduced"]) === false
    && readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readStringAt(value, ["summary", "nextAction"]) === "run_r1164_feature_only_research_handoff";
}

function missingRequirementIdsFromR1145(value: unknown | null): MissingRequirementId[] {
  const allowed = new Set<string>(MISSING_REQUIREMENT_IDS);
  return readStringArrayAt(value, ["completionAudit", "missingRequirementIds"])
    .filter((item): item is MissingRequirementId => allowed.has(item));
}

function conclusionFor(input: {
  minimumFeaturePairConfirmed: boolean;
  r1145Ready: boolean;
  r1174Ready: boolean;
  r1176Ready: boolean;
}): PriorityConclusion {
  if (!input.r1145Ready) {
    return "ordinary_average_submitter_priority_packet_waiting_on_completion_audit";
  }
  if (!input.r1174Ready) {
    return "ordinary_average_submitter_priority_packet_waiting_on_safe_next_step_packet";
  }
  if (!input.r1176Ready) {
    return "ordinary_average_submitter_priority_packet_waiting_on_live_chain_packet";
  }
  if (input.minimumFeaturePairConfirmed) {
    return "ordinary_average_submitter_priority_packet_ready_for_feature_only_research_handoff";
  }
  return "ordinary_average_submitter_priority_packet_waiting_on_minimum_pair_confirmation";
}

function nextActionFor(conclusion: PriorityConclusion): PriorityNextAction {
  if (conclusion === "ordinary_average_submitter_priority_packet_waiting_on_completion_audit") {
    return "refresh_r1145_completion_audit";
  }
  if (conclusion === "ordinary_average_submitter_priority_packet_waiting_on_safe_next_step_packet") {
    return "refresh_r1174_safe_next_step_packet";
  }
  if (conclusion === "ordinary_average_submitter_priority_packet_waiting_on_live_chain_packet") {
    return "refresh_r1176_row_owner_safe_assertion_chain";
  }
  if (conclusion === "ordinary_average_submitter_priority_packet_ready_for_feature_only_research_handoff") {
    return "run_r1164_feature_only_research_handoff";
  }
  return "rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation";
}

function buildPrioritySteps(input: {
  currentMissingRequirementIds: MissingRequirementId[];
  minimumFeaturePairConfirmed: boolean;
}): PriorityStep[] {
  const missing = new Set<MissingRequirementId>(input.currentMissingRequirementIds);
  const commands = {
    confirm_minimum_lab_wearable_pair_available: R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND,
    confirm_lab_wearable_recipe_route_requirements: DEFAULT_RECIPE_READINESS_COMMAND,
    provide_private_route_config_locally: DEFAULT_PRIVATE_CONFIG_COMMAND,
    run_lab_wearable_route_metrics_locally: DEFAULT_ROUTE_METRICS_COMMAND,
  } satisfies Record<PriorityStepId, string>;
  return PRIORITY_STEP_SPECS.map(({ requirementId, stepId }): PriorityStep => {
    const status = stepId === "confirm_minimum_lab_wearable_pair_available"
      ? input.minimumFeaturePairConfirmed ? "satisfied" : "blocked"
      : missing.has(requirementId) ? "blocked" : "satisfied";
    return {
      allowedValueKindIds: [...ALLOWED_VALUE_KIND_IDS],
      blockedContentIds: [...BLOCKED_CONTENT_IDS],
      command: commands[stepId],
      minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS],
      optionalContextNotRequired: [...OPTIONAL_CONTEXT_SOURCE_FAMILY_IDS],
      privateDetailsStored: false,
      requirementId,
      rowLevelDataAccepted: false,
      safeCompletionChecklistItemIds: [...SAFE_COMPLETION_CHECKLIST_ITEM_IDS],
      status,
      stepId,
    };
  });
}

function buildFirstSubmitterAsks(): FirstSubmitterAsk[] {
  return [
    {
      acceptableEvidenceKind: "lab_portal_export_or_spreadsheet",
      askId: "has_glycemia_bloodwork_export",
      mapsToSourceFamilyIds: ["bloodwork_glycemia"],
      privateDetailsStored: false,
      requiredForMinimumPair: true,
      safeQuestion: "Can the row owner provide glycemia bloodwork coverage from a lab portal export or spreadsheet without sharing private values here?",
    },
    {
      acceptableEvidenceKind: "phone_watch_or_wearable_activity_export",
      askId: "has_daily_wearable_activity_export",
      mapsToSourceFamilyIds: ["wearable_activity_daily"],
      privateDetailsStored: false,
      requiredForMinimumPair: true,
      safeQuestion: "Can the row owner provide daily activity coverage from a phone, watch, or wearable export without sharing private values here?",
    },
    {
      acceptableEvidenceKind: "safe_assertion_only",
      askId: "can_confirm_without_private_values",
      mapsToSourceFamilyIds: [...MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS],
      privateDetailsStored: false,
      requiredForMinimumPair: true,
      safeQuestion: "Can the row owner make the minimum-pair assertion using only booleans and fixed IDs, with no paths, headers, rows, values, identifiers, predictions, coefficients, source text, or small cells?",
    },
  ];
}

function summarizeArtifact(input: {
  artifact: string;
  expectedPacketId: string;
  expectedSchemaVersion: string;
  value: unknown | null;
}): ArtifactSummary {
  const packetId = readStringAt(input.value, ["packetId"]) === input.expectedPacketId
    ? input.expectedPacketId
    : null;
  const schemaVersion = readStringAt(input.value, ["schemaVersion"]) === input.expectedSchemaVersion
    ? input.expectedSchemaVersion
    : null;
  return {
    artifact: input.artifact,
    packetId,
    schemaVersion,
    status: input.value === null ? "missing" : "available",
  };
}

function safeBoundary(): R1177OrdinaryConsumerAverageSubmitterPriorityPacketOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    fileNamesStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelEvidencePromotedByR1177: false,
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
    rowLevelDataAcceptedByR1177: false,
    rowOwnerConfirmationInferredByR1177: false,
    rowOwnerPrivateValuesStored: false,
    rowOwnerProvidedValuesStored: false,
    rowParsingPerformedByR1177: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
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

function validateAggregateSafe(label: string, value: unknown): void {
  if (value === null) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1177 rejected unsafe ${label}: ${formatFindingCount(findings)}`);
  }
}

function ensureNoOutputPathInOutput(
  output: R1177OrdinaryConsumerAverageSubmitterPriorityPacketOutput,
  outputDir: string,
): void {
  if (JSON.stringify(output).includes(outputDir)) {
    throw new Error("R1177 rejected priority packet with output path leakage.");
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

function readStringArrayAt(value: unknown, pathParts: string[]): string[] {
  const valueAtPath = readAt(value, pathParts);
  if (!Array.isArray(valueAtPath)) return [];
  return valueAtPath.every((item): item is string => typeof item === "string")
    ? valueAtPath
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

function exactStringSet(actual: string[], expectedValues: readonly string[]): boolean {
  const actualSet = new Set(actual);
  if (actual.length !== expectedValues.length || actualSet.size !== expectedValues.length) return false;
  const expected = new Set(expectedValues);
  return expectedValues.every((item) => actualSet.has(item)) && actual.every((item) => expected.has(item));
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}

function cliSummary(output: R1177OrdinaryConsumerAverageSubmitterPriorityPacketOutput): Record<string, unknown> {
  return {
    conclusion: output.summary.conclusion,
    currentMissingRequirementIds: output.summary.currentMissingRequirementIds,
    deferredUntilMinimumPairConfirmedIds: output.summary.deferredUntilMinimumPairConfirmedIds,
    firstSubmitterAskIds: output.summary.firstSubmitterAskIds,
    minimumFeaturePairConfirmed: output.summary.minimumFeaturePairConfirmed,
    minimumFeaturePairRequired: output.summary.minimumFeaturePairRequired,
    nextAction: output.summary.nextAction,
    optionalContextNotRequiredForFirstStep: output.summary.optionalContextNotRequiredForFirstStep,
    packetId: output.packetId,
    prioritizedInputKindIds: output.summary.prioritizedInputKindIds,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    rowLevelDataAcceptedByR1177: output.summary.rowLevelDataAcceptedByR1177,
    rowOwnerConfirmationInferredByR1177: output.summary.rowOwnerConfirmationInferredByR1177,
    rowOwnerPrivateValuesStored: output.summary.rowOwnerPrivateValuesStored,
    rowParsingPerformedByR1177: output.summary.rowParsingPerformedByR1177,
    schemaVersion: output.schemaVersion,
    targetAgeBand: output.summary.targetAgeBand,
    targetInputPriority: output.summary.targetInputPriority,
    topRequirementId: output.summary.topRequirementId,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1177OrdinaryConsumerAverageSubmitterPriorityPacket({
    createdAt: process.env.MURPH_AGE_R1177_CREATED_AT,
    outputDir: process.env.MURPH_AGE_R1177_OUTPUT_DIR ?? process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1145Path: process.env.MURPH_AGE_R1145_ORDINARY_CONSUMER_CURRENT_CHAIN_COMPLETION_AUDIT_PATH,
    r1174Path: process.env.MURPH_AGE_R1174_ORDINARY_CONSUMER_SAFE_NEXT_STEP_PACKET_PATH,
    r1176Path: process.env.MURPH_AGE_R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_PATH,
  });
  process.stdout.write(`${JSON.stringify(cliSummary(output), null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1177 average-submitter priority packet failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  if (/[\r\n]|(?:\/|\\)/u.test(error.message)) return fallback;
  return isAllowlistedR1177ErrorMessage(error.message) ? error.message : fallback;
}

function formatFindingCount(findings: readonly unknown[]): string {
  return `${findings.length} finding${findings.length === 1 ? "" : "s"}`;
}

function isAllowlistedR1177ErrorMessage(message: string): boolean {
  return [
    /^R1177 rejected priority packet with output path leakage\.$/u,
    /^R1177 rejected unsafe (?:r1145 completion audit|r1174 safe next-step packet|r1176 row-owner chain|r1177 average submitter priority packet): \d+ findings?$/u,
  ].some((pattern) => pattern.test(message));
}
