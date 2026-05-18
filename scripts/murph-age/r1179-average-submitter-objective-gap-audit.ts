import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1178_AVERAGE_SUBMITTER_CURRENT_LOOP_SURFACING_COMMAND,
  R1178_AVERAGE_SUBMITTER_CURRENT_LOOP_SURFACING_SCHEMA_VERSION,
} from "./r1178-average-submitter-current-loop-surfacing.ts";

export const R1179_AVERAGE_SUBMITTER_OBJECTIVE_GAP_AUDIT_SCHEMA_VERSION =
  "murph-age-r1179-average-submitter-objective-gap-audit.v1" as const;
export const R1179_AVERAGE_SUBMITTER_OBJECTIVE_GAP_AUDIT_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1179-average-submitter-objective-gap-audit.ts" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1179-average-submitter-objective-gap-audit.latest.json" as const;
const R1178_ARTIFACT = "r1178-average-submitter-current-loop-surfacing.latest.json" as const;
const R1145_ARTIFACT = "r1145-ordinary-consumer-current-chain-completion-audit.latest.json" as const;
const R1173_ARTIFACT = "r1173-ordinary-consumer-safe-assertion-answer-sheet.latest.json" as const;
const R1174_ARTIFACT = "r1174-ordinary-consumer-safe-next-step-packet.latest.json" as const;
const R1176_ARTIFACT = "r1176-r1172-r1165-row-owner-safe-assertion-chain-runner.latest.json" as const;
const R1178_PACKET_ID = "r1178-average-submitter-current-loop-surfacing" as const;
const R1145_PACKET_ID = "r1145-ordinary-consumer-current-chain-completion-audit" as const;
const R1145_SCHEMA_VERSION = "murph-age-r1145-ordinary-consumer-current-chain-completion-audit.v1" as const;
const R1173_PACKET_ID = "r1173-ordinary-consumer-safe-assertion-answer-sheet" as const;
const R1173_SCHEMA_VERSION = "murph-age-r1173-ordinary-consumer-safe-assertion-answer-sheet.v1" as const;
const R1174_PACKET_ID = "r1174-ordinary-consumer-safe-next-step-packet" as const;
const R1174_SCHEMA_VERSION = "murph-age-r1174-ordinary-consumer-safe-next-step-packet.v1" as const;
const R1176_PACKET_ID = "r1176-r1172-r1165-row-owner-safe-assertion-chain-runner" as const;
const R1176_SCHEMA_VERSION =
  "murph-age-r1176-r1172-r1165-row-owner-safe-assertion-chain-runner.v1" as const;
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
const SAFE_COMPLETION_CHECKLIST_ITEM_IDS = [
  "confirm_target_age_band_without_identifiers",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
] as const;
const REQUIRED_ASSERTION_CHECKLIST_IDS = [
  "assert_target_age_band_roughly_16_50",
  "assert_glycemia_bloodwork_export_available",
  "assert_daily_wearable_activity_export_available",
  "assert_no_private_values_identifiers_paths_headers_or_rows",
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
const OBJECTIVE_REQUIREMENT_IDS = [
  "ordinary_16_50_priority_selected",
  "minimum_lab_wearable_pair_visible",
  "row_owner_action_route_visible",
  "safe_current_loop_command_visible",
  "safe_assertion_answer_sheet_available",
  "safe_next_step_packet_available",
  "r1176_live_chain_available",
  "row_owner_safe_assertion_confirmed",
  "feature_only_research_handoff_ready",
  "real_lab_wearable_route_metrics_recorded",
  "product_display_blocked_until_validation",
] as const;
const R1179_NEXT_ACTION_IDS = [
  "refresh_r1178_current_loop_surfacing",
  "refresh_r1145_completion_audit",
  "refresh_r1173_safe_assertion_answer_sheet",
  "refresh_r1174_safe_next_step_packet",
  "refresh_r1176_row_owner_safe_assertion_chain",
  "review_r1173_safe_assertion_answer_sheet_then_rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation",
  "run_r1164_feature_only_research_handoff_after_minimum_pair_confirmed",
  "collect_real_lab_wearable_route_metrics",
  "keep_product_display_blocked",
  "none",
] as const;
const R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND =
  "MURPH_AGE_R1176_ROW_OWNER_FEATURE_ONLY_SAFE_ASSERTIONS_CONFIRMED=true pnpm exec tsx scripts/murph-age/r1176-r1172-r1165-row-owner-safe-assertion-chain-runner.ts" as const;
const R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1173-ordinary-consumer-safe-assertion-answer-sheet.ts" as const;
const R1174_SAFE_NEXT_STEP_PACKET_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1174-ordinary-consumer-safe-next-step-packet.ts" as const;
const R1145_COMPLETION_AUDIT_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1145-ordinary-consumer-current-chain-completion-audit.ts" as const;
const R1164_FEATURE_ONLY_RESEARCH_HANDOFF_COMMAND =
  "MURPH_AGE_R1163_FEATURE_ONLY_SAFE_CONFIRMATION_TO_RESEARCH_RUNNER_PATH=<r1163-runner.json> pnpm exec tsx scripts/murph-age/r1164-ordinary-consumer-feature-only-research-handoff.ts" as const;

type MinimumFeaturePairSourceFamilyId = typeof MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS[number];
type RequiredInputKindId = typeof REQUIRED_INPUT_KIND_IDS[number];
type SafeCompletionChecklistItemId = typeof SAFE_COMPLETION_CHECKLIST_ITEM_IDS[number];
type RequiredAssertionChecklistId = typeof REQUIRED_ASSERTION_CHECKLIST_IDS[number];
type BlockedContentId = typeof BLOCKED_CONTENT_IDS[number];
type AllowedValueKindId = typeof ALLOWED_VALUE_KIND_IDS[number];
type ObjectiveRequirementId = typeof OBJECTIVE_REQUIREMENT_IDS[number];
type ObjectiveRequirementStatus = "blocked" | "satisfied";
type R1179NextActionId = typeof R1179_NEXT_ACTION_IDS[number];
type InputArtifactKey =
  | "r1145CompletionAudit"
  | "r1173SafeAssertionAnswerSheet"
  | "r1174SafeNextStepPacket"
  | "r1176RowOwnerSafeAssertionChain"
  | "r1178AverageSubmitterCurrentLoopSurfacing";
type EvidenceArtifactId =
  | typeof R1145_PACKET_ID
  | typeof R1173_PACKET_ID
  | typeof R1174_PACKET_ID
  | typeof R1176_PACKET_ID
  | typeof R1178_PACKET_ID;
type GapAuditConclusion =
  | "average_submitter_objective_gap_audit_blocked_on_feature_only_handoff"
  | "average_submitter_objective_gap_audit_blocked_on_product_safety"
  | "average_submitter_objective_gap_audit_blocked_on_real_route_metrics"
  | "average_submitter_objective_gap_audit_blocked_on_row_owner_safe_assertion"
  | "average_submitter_objective_gap_audit_waiting_on_current_packets"
  | "average_submitter_objective_gap_audit_ready_to_mark_complete";

interface ArtifactSummary {
  artifact: string;
  packetId: EvidenceArtifactId | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface ObjectiveRequirementStatusEntry {
  evidenceArtifactIds: EvidenceArtifactId[];
  nextAction: R1179NextActionId;
  privateDetailsStored: false;
  requirementId: ObjectiveRequirementId;
  status: ObjectiveRequirementStatus;
}

export interface R1179AverageSubmitterObjectiveGapAuditOptions {
  createdAt?: string;
  outputDir?: string;
  r1145Path?: string;
  r1173Path?: string;
  r1174Path?: string;
  r1176Path?: string;
  r1178Path?: string;
}

export interface R1179AverageSubmitterObjectiveGapAuditOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    fileNamesStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelEvidencePromotedByR1179: false;
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
    rowLevelDataAcceptedByR1179: false;
    rowOwnerConfirmationInferredByR1179: false;
    rowOwnerPrivateValuesStored: false;
    rowOwnerProvidedValuesStored: false;
    rowParsingPerformedByR1179: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: Record<InputArtifactKey, ArtifactSummary>;
  objectiveGapAudit: {
    allowedValueKindIds: AllowedValueKindId[];
    blockedContentIds: BlockedContentId[];
    blockedRequirementIds: ObjectiveRequirementId[];
    conclusion: GapAuditConclusion;
    currentEvidenceArtifactIds: EvidenceArtifactId[];
    firstBlockedRequirementId: ObjectiveRequirementId | null;
    goalAchieved: boolean;
    minimumFeaturePairRequired: MinimumFeaturePairSourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    nextAction: R1179NextActionId;
    nextActionCommand: string | null;
    prioritizedInputKindIds: RequiredInputKindId[];
    productDisplayAuthorized: false;
    readyToMarkComplete: boolean;
    requiredAssertionChecklistIds: RequiredAssertionChecklistId[];
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1179: false;
    rowOwnerActionRouteStatus: string | null;
    rowOwnerConfirmationInferredByR1179: false;
    rowOwnerPrivateValuesStored: false;
    rowParsingPerformedByR1179: false;
    safeCurrentLoopCommandVisible: boolean;
    safeCompletionChecklistItemIds: SafeCompletionChecklistItemId[];
    sourcePriority: typeof TARGET_INPUT_PRIORITY;
    targetAgeBand: typeof TARGET_AGE_BAND;
    requirementStatuses: ObjectiveRequirementStatusEntry[];
  };
  packetId: "r1179-average-submitter-objective-gap-audit";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1179_AVERAGE_SUBMITTER_OBJECTIVE_GAP_AUDIT_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    blockedRequirementIds: ObjectiveRequirementId[];
    conclusion: GapAuditConclusion;
    currentEvidenceArtifactIds: EvidenceArtifactId[];
    firstBlockedRequirementId: ObjectiveRequirementId | null;
    goalAchieved: boolean;
    minimumFeaturePairRequired: MinimumFeaturePairSourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    nextAction: R1179NextActionId;
    nextActionCommand: string | null;
    prioritizedInputKindIds: RequiredInputKindId[];
    productDisplayAuthorized: false;
    readyToMarkComplete: boolean;
    requiredAssertionChecklistIds: RequiredAssertionChecklistId[];
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1179: false;
    rowOwnerActionRouteStatus: string | null;
    rowOwnerConfirmationInferredByR1179: false;
    rowOwnerPrivateValuesStored: false;
    rowParsingPerformedByR1179: false;
    safeCurrentLoopCommandVisible: boolean;
    safeCompletionChecklistItemIds: SafeCompletionChecklistItemId[];
    sourcePriority: typeof TARGET_INPUT_PRIORITY;
    targetAgeBand: typeof TARGET_AGE_BAND;
  };
}

export async function runR1179AverageSubmitterObjectiveGapAudit(
  options: R1179AverageSubmitterObjectiveGapAuditOptions = {},
): Promise<{ output: R1179AverageSubmitterObjectiveGapAuditOutput; outputPath: string }> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const r1178Path = options.r1178Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1178_ARTIFACT);
  const r1145Path = options.r1145Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1145_ARTIFACT);
  const r1173Path = options.r1173Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1173_ARTIFACT);
  const r1174Path = options.r1174Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1174_ARTIFACT);
  const r1176Path = options.r1176Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1176_ARTIFACT);
  const [r1178, r1145, r1173, r1174, r1176] = await Promise.all([
    readJsonIfPresent(r1178Path),
    readJsonIfPresent(r1145Path),
    readJsonIfPresent(r1173Path),
    readJsonIfPresent(r1174Path),
    readJsonIfPresent(r1176Path),
  ]);
  validateAggregateSafe("r1178 current-loop surfacing", r1178);
  validateAggregateSafe("r1145 completion audit", r1145);
  validateAggregateSafe("r1173 safe assertion answer sheet", r1173);
  validateAggregateSafe("r1174 safe next-step packet", r1174);
  validateAggregateSafe("r1176 row-owner safe assertion chain", r1176);

  const evidence = {
    r1145: matchesR1145CompletionAudit(r1145),
    r1173: matchesR1173SafeAssertionAnswerSheet(r1173),
    r1174: matchesR1174SafeNextStepPacket(r1174),
    r1176: matchesR1176RowOwnerSafeAssertionChain(r1176),
    r1178: matchesR1178AverageSubmitterCurrentLoopSurfacing(r1178),
  };
  const rowOwnerActionRouteStatus = evidence.r1178
    ? readStringAt(r1178, ["summary", "rowOwnerActionRoute", "rowOwnerActionRouteStatus"])
    : null;
  const prioritySelected = evidence.r1178
    && readStringAt(r1178, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(r1178, ["summary", "sourcePriority"]) === TARGET_INPUT_PRIORITY;
  const minimumPairVisible = prioritySelected
    && readBooleanAt(r1178, ["summary", "priorityVisibleInCurrentLoop"]) === true
    && exactStringSet(
      readStringArrayAt(r1178, ["summary", "minimumFeaturePairRequired"]),
      MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS,
    )
    && exactStringSet(
      readStringArrayAt(r1178, ["summary", "prioritizedInputKindIds"]),
      REQUIRED_INPUT_KIND_IDS,
    );
  const rowOwnerActionRouteVisible = minimumPairVisible
    && rowOwnerActionRouteStatus !== null
    && rowOwnerActionRouteStatus !== "waiting_on_current_loop_or_priority_packet"
    && exactStringSet(
      readStringArrayAt(r1178, ["summary", "rowOwnerActionRoute", "requiredAssertionChecklistIds"]),
      REQUIRED_ASSERTION_CHECKLIST_IDS,
    );
  const safeCurrentLoopCommandVisible = evidence.r1178
    && routeAppropriateR1178CurrentLoopCommandVisible(r1178, rowOwnerActionRouteStatus);
  const r1176ChainReady = evidence.r1176
    && readBooleanAt(r1176, ["summary", "chainReady"]) === true
    && readBooleanAt(r1176, ["summary", "explicitRowOwnerAssertionProvided"]) === true
    && readBooleanAt(r1176, ["summary", "featureOnlyResearchPlanningReady"]) === true;
  const rowOwnerSafeAssertionConfirmed = evidence.r1178
    && r1176ChainReady
    && readBooleanAt(r1178, ["summary", "minimumFeaturePairConfirmed"]) === true;
  const featureOnlyResearchHandoffReady = rowOwnerSafeAssertionConfirmed
    && rowOwnerActionRouteStatus === "feature_only_research_handoff_ready";
  const realLabWearableRouteMetricsRecorded = evidence.r1145
    && readBooleanAt(r1145, ["completionAudit", "routeEvidenceState", "realLabWearableRouteMetricsRecorded"]) === true
    && !readStringArrayAt(r1145, ["summary", "completionUnblockerBlockedRequirementIds"])
      .includes("real_lab_wearable_route_metrics_recorded");
  const productDisplayBlockedUntilValidation = !anyProductDisplayAuthorized([
    r1178,
    r1145,
    r1173,
    r1174,
    r1176,
  ]);
  const requirementStatuses = buildRequirementStatuses({
    evidence,
    featureOnlyResearchHandoffReady,
    minimumPairVisible,
    prioritySelected,
    productDisplayBlockedUntilValidation,
    r1176ChainAvailable: evidence.r1176,
    realLabWearableRouteMetricsRecorded,
    rowOwnerActionRouteVisible,
    rowOwnerSafeAssertionConfirmed,
    safeCurrentLoopCommandVisible,
  });
  const blockedRequirementIds = requirementStatuses
    .filter((entry) => entry.status === "blocked")
    .map((entry) => entry.requirementId);
  const firstBlockedRequirement = requirementStatuses.find((entry) => entry.status === "blocked") ?? null;
  const firstBlockedRequirementId = firstBlockedRequirement?.requirementId ?? null;
  const nextAction = firstBlockedRequirement?.nextAction ?? "none";
  const conclusion = conclusionFor({
    firstBlockedRequirementId,
    featureOnlyResearchHandoffReady,
    goalAchieved: blockedRequirementIds.length === 0,
    productDisplayBlockedUntilValidation,
    realLabWearableRouteMetricsRecorded,
    rowOwnerSafeAssertionConfirmed,
  });
  const currentEvidenceArtifactIds = evidenceArtifactIds(evidence);
  const goalAchieved = blockedRequirementIds.length === 0
    && productDisplayBlockedUntilValidation
    && realLabWearableRouteMetricsRecorded;
  const readyToMarkComplete = goalAchieved;
  const createdAt = createdAtFor(options.createdAt);
  const summary: R1179AverageSubmitterObjectiveGapAuditOutput["summary"] = {
    blockedRequirementIds,
    conclusion,
    currentEvidenceArtifactIds,
    firstBlockedRequirementId,
    goalAchieved,
    minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS],
    modelEvidencePromotionAllowed: false,
    nextAction,
    nextActionCommand: commandForNextAction(nextAction),
    prioritizedInputKindIds: [...REQUIRED_INPUT_KIND_IDS],
    productDisplayAuthorized: false,
    readyToMarkComplete,
    requiredAssertionChecklistIds: [...REQUIRED_ASSERTION_CHECKLIST_IDS],
    reviewGptRequiredNow: false,
    rowLevelDataAcceptedByR1179: false,
    rowOwnerActionRouteStatus,
    rowOwnerConfirmationInferredByR1179: false,
    rowOwnerPrivateValuesStored: false,
    rowParsingPerformedByR1179: false,
    safeCurrentLoopCommandVisible,
    safeCompletionChecklistItemIds: [...SAFE_COMPLETION_CHECKLIST_ITEM_IDS],
    sourcePriority: TARGET_INPUT_PRIORITY,
    targetAgeBand: TARGET_AGE_BAND,
  };
  const output: R1179AverageSubmitterObjectiveGapAuditOutput = {
    artifactBoundary: safeBoundary(),
    createdAt,
    inputArtifacts: {
      r1145CompletionAudit: summarizeArtifact({
        artifact: R1145_ARTIFACT,
        expectedPacketId: R1145_PACKET_ID,
        expectedSchemaVersion: R1145_SCHEMA_VERSION,
        value: r1145,
      }),
      r1173SafeAssertionAnswerSheet: summarizeArtifact({
        artifact: R1173_ARTIFACT,
        expectedPacketId: R1173_PACKET_ID,
        expectedSchemaVersion: R1173_SCHEMA_VERSION,
        value: r1173,
      }),
      r1174SafeNextStepPacket: summarizeArtifact({
        artifact: R1174_ARTIFACT,
        expectedPacketId: R1174_PACKET_ID,
        expectedSchemaVersion: R1174_SCHEMA_VERSION,
        value: r1174,
      }),
      r1176RowOwnerSafeAssertionChain: summarizeArtifact({
        artifact: R1176_ARTIFACT,
        expectedPacketId: R1176_PACKET_ID,
        expectedSchemaVersion: R1176_SCHEMA_VERSION,
        value: r1176,
      }),
      r1178AverageSubmitterCurrentLoopSurfacing: summarizeArtifact({
        artifact: R1178_ARTIFACT,
        expectedPacketId: R1178_PACKET_ID,
        expectedSchemaVersion: R1178_AVERAGE_SUBMITTER_CURRENT_LOOP_SURFACING_SCHEMA_VERSION,
        value: r1178,
      }),
    },
    objectiveGapAudit: {
      allowedValueKindIds: [...ALLOWED_VALUE_KIND_IDS],
      blockedContentIds: [...BLOCKED_CONTENT_IDS],
      blockedRequirementIds: summary.blockedRequirementIds,
      conclusion: summary.conclusion,
      currentEvidenceArtifactIds: summary.currentEvidenceArtifactIds,
      firstBlockedRequirementId: summary.firstBlockedRequirementId,
      goalAchieved,
      minimumFeaturePairRequired: summary.minimumFeaturePairRequired,
      modelEvidencePromotionAllowed: false,
      nextAction,
      nextActionCommand: summary.nextActionCommand,
      prioritizedInputKindIds: summary.prioritizedInputKindIds,
      productDisplayAuthorized: false,
      readyToMarkComplete,
      requiredAssertionChecklistIds: summary.requiredAssertionChecklistIds,
      requirementStatuses,
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1179: false,
      rowOwnerActionRouteStatus,
      rowOwnerConfirmationInferredByR1179: false,
      rowOwnerPrivateValuesStored: false,
      rowParsingPerformedByR1179: false,
      safeCurrentLoopCommandVisible,
      safeCompletionChecklistItemIds: summary.safeCompletionChecklistItemIds,
      sourcePriority: TARGET_INPUT_PRIORITY,
      targetAgeBand: TARGET_AGE_BAND,
    },
    packetId: "r1179-average-submitter-objective-gap-audit",
    productDisplayAuthorized: false,
    schemaVersion: R1179_AVERAGE_SUBMITTER_OBJECTIVE_GAP_AUDIT_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary,
  };

  ensureNoOutputPathInOutput(output, outputDir);
  validateAggregateSafe("r1179 average submitter objective gap audit", output);
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function buildRequirementStatuses(params: {
  evidence: Record<"r1145" | "r1173" | "r1174" | "r1176" | "r1178", boolean>;
  featureOnlyResearchHandoffReady: boolean;
  minimumPairVisible: boolean;
  prioritySelected: boolean;
  productDisplayBlockedUntilValidation: boolean;
  r1176ChainAvailable: boolean;
  realLabWearableRouteMetricsRecorded: boolean;
  rowOwnerActionRouteVisible: boolean;
  rowOwnerSafeAssertionConfirmed: boolean;
  safeCurrentLoopCommandVisible: boolean;
}): ObjectiveRequirementStatusEntry[] {
  return [
    statusEntry({
      evidenceArtifactIds: params.evidence.r1178 ? [R1178_PACKET_ID] : [],
      nextAction: "refresh_r1178_current_loop_surfacing",
      requirementId: "ordinary_16_50_priority_selected",
      satisfied: params.prioritySelected,
    }),
    statusEntry({
      evidenceArtifactIds: params.evidence.r1178 ? [R1178_PACKET_ID] : [],
      nextAction: "refresh_r1178_current_loop_surfacing",
      requirementId: "minimum_lab_wearable_pair_visible",
      satisfied: params.minimumPairVisible,
    }),
    statusEntry({
      evidenceArtifactIds: params.evidence.r1178 ? [R1178_PACKET_ID] : [],
      nextAction: "refresh_r1178_current_loop_surfacing",
      requirementId: "row_owner_action_route_visible",
      satisfied: params.rowOwnerActionRouteVisible,
    }),
    statusEntry({
      evidenceArtifactIds: params.evidence.r1178 ? [R1178_PACKET_ID] : [],
      nextAction: "refresh_r1178_current_loop_surfacing",
      requirementId: "safe_current_loop_command_visible",
      satisfied: params.safeCurrentLoopCommandVisible,
    }),
    statusEntry({
      evidenceArtifactIds: params.evidence.r1173 ? [R1173_PACKET_ID] : [],
      nextAction: "refresh_r1173_safe_assertion_answer_sheet",
      requirementId: "safe_assertion_answer_sheet_available",
      satisfied: params.evidence.r1173,
    }),
    statusEntry({
      evidenceArtifactIds: params.evidence.r1174 ? [R1174_PACKET_ID] : [],
      nextAction: "refresh_r1174_safe_next_step_packet",
      requirementId: "safe_next_step_packet_available",
      satisfied: params.evidence.r1174,
    }),
    statusEntry({
      evidenceArtifactIds: params.evidence.r1176 ? [R1176_PACKET_ID] : [],
      nextAction: "refresh_r1176_row_owner_safe_assertion_chain",
      requirementId: "r1176_live_chain_available",
      satisfied: params.r1176ChainAvailable,
    }),
    statusEntry({
      evidenceArtifactIds: evidenceIdsForReady([
        [params.evidence.r1178, R1178_PACKET_ID],
        [params.evidence.r1176, R1176_PACKET_ID],
      ]),
      nextAction:
        "review_r1173_safe_assertion_answer_sheet_then_rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation",
      requirementId: "row_owner_safe_assertion_confirmed",
      satisfied: params.rowOwnerSafeAssertionConfirmed,
    }),
    statusEntry({
      evidenceArtifactIds: evidenceIdsForReady([
        [params.evidence.r1178, R1178_PACKET_ID],
        [params.evidence.r1176, R1176_PACKET_ID],
      ]),
      nextAction: "run_r1164_feature_only_research_handoff_after_minimum_pair_confirmed",
      requirementId: "feature_only_research_handoff_ready",
      satisfied: params.featureOnlyResearchHandoffReady,
    }),
    statusEntry({
      evidenceArtifactIds: params.evidence.r1145 ? [R1145_PACKET_ID] : [],
      nextAction: params.evidence.r1145 ? "collect_real_lab_wearable_route_metrics" : "refresh_r1145_completion_audit",
      requirementId: "real_lab_wearable_route_metrics_recorded",
      satisfied: params.realLabWearableRouteMetricsRecorded,
    }),
    statusEntry({
      evidenceArtifactIds: evidenceArtifactIds(params.evidence),
      nextAction: "keep_product_display_blocked",
      requirementId: "product_display_blocked_until_validation",
      satisfied: params.productDisplayBlockedUntilValidation,
    }),
  ];
}

function statusEntry(params: {
  evidenceArtifactIds: EvidenceArtifactId[];
  nextAction: R1179NextActionId;
  requirementId: ObjectiveRequirementId;
  satisfied: boolean;
}): ObjectiveRequirementStatusEntry {
  return {
    evidenceArtifactIds: params.evidenceArtifactIds,
    nextAction: params.satisfied ? "none" : params.nextAction,
    privateDetailsStored: false,
    requirementId: params.requirementId,
    status: params.satisfied ? "satisfied" : "blocked",
  };
}

function matchesR1178AverageSubmitterCurrentLoopSurfacing(value: unknown | null): boolean {
  return matchesArtifact(value, R1178_PACKET_ID, R1178_AVERAGE_SUBMITTER_CURRENT_LOOP_SURFACING_SCHEMA_VERSION)
    && readStringAt(value, ["summary", "sourcePriority"]) === TARGET_INPUT_PRIORITY
    && readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && exactStringSet(readStringArrayAt(value, ["summary", "minimumFeaturePairRequired"]), MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS)
    && exactStringSet(readStringArrayAt(value, ["summary", "prioritizedInputKindIds"]), REQUIRED_INPUT_KIND_IDS)
    && exactStringSet(
      readStringArrayAt(value, ["summary", "safeCompletionChecklistItemIds"]),
      SAFE_COMPLETION_CHECKLIST_ITEM_IDS,
    )
    && exactStringSet(
      readStringArrayAt(value, ["summary", "rowOwnerActionRoute", "requiredAssertionChecklistIds"]),
      REQUIRED_ASSERTION_CHECKLIST_IDS,
    )
    && exactStringSet(
      readStringArrayAt(value, ["summary", "rowOwnerActionRoute", "requiredInputKindIds"]),
      REQUIRED_INPUT_KIND_IDS,
    )
    && readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1178"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerConfirmationInferredByR1178"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["summary", "rowParsingPerformedByR1178"]) === false
    && allowedRowOwnerRouteStatus(readStringAt(value, ["summary", "rowOwnerActionRoute", "rowOwnerActionRouteStatus"]));
}

function routeAppropriateR1178CurrentLoopCommandVisible(
  value: unknown | null,
  rowOwnerActionRouteStatus: string | null,
): boolean {
  const summaryCommand = readStringAt(value, ["summary", "currentLoopCommand"]);
  const surfacingCommand = readStringAt(value, ["currentLoopSurfacing", "currentLoopCommand"]);
  if (summaryCommand === null || surfacingCommand !== summaryCommand) return false;
  if (summaryCommand === R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND) return false;
  if (rowOwnerActionRouteStatus === "waiting_on_row_owner_feature_only_assertion") {
    return summaryCommand === R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND;
  }
  if (rowOwnerActionRouteStatus === "feature_only_research_handoff_ready") {
    return summaryCommand === R1164_FEATURE_ONLY_RESEARCH_HANDOFF_COMMAND;
  }
  return rowOwnerActionRouteStatus === "waiting_on_current_loop_or_priority_packet";
}

function matchesR1145CompletionAudit(value: unknown | null): boolean {
  return matchesArtifact(value, R1145_PACKET_ID, R1145_SCHEMA_VERSION)
    && readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(value, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && readStringAt(value, ["completionAudit", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(value, ["completionAudit", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && exactStringSet(
      readStringArrayAt(value, ["completionAudit", "prioritizedSubmitterInputFamilyIds"]),
      MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS,
    )
    && readBooleanAt(value, ["completionAudit", "routeEvidenceState", "realLabWearableRouteMetricsRecorded"])
      !== null
    && readBooleanAt(value, ["completionAudit", "routeEvidenceState", "privateDetailsStored"]) === false
    && readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(value, ["summary", "rowParsingPerformedByR1145"]) === false
    && readBooleanAt(value, ["summary", "readyToMarkComplete"]) !== null
    && readBooleanAt(value, ["summary", "goalAchieved"]) !== null
    && isUniqueStringSubset(
      readStringArrayAt(value, ["summary", "completionUnblockerBlockedRequirementIds"]),
      [
        "row_owner_availability_assertions_confirmed",
        "confirmed_recipe_route_requirements_available",
        "private_route_config_supplied",
        "real_lab_wearable_route_metrics_recorded",
      ],
    );
}

function matchesR1173SafeAssertionAnswerSheet(value: unknown | null): boolean {
  return matchesArtifact(value, R1173_PACKET_ID, R1173_SCHEMA_VERSION)
    && readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(value, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && exactStringSet(readStringArrayAt(value, ["summary", "minimumFeaturePairRequired"]), MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS)
    && exactStringSet(readStringArrayAt(value, ["summary", "requiredInputKindIds"]), REQUIRED_INPUT_KIND_IDS)
    && exactStringSet(readStringArrayAt(value, ["summary", "requiredAssertionChecklistIds"]), REQUIRED_ASSERTION_CHECKLIST_IDS)
    && readBooleanAt(value, ["summary", "answerSheetReadyForRowOwner"]) === true
    && readBooleanAt(value, ["summary", "materializerExplicitConfirmationRequired"]) === true
    && readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1173"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerAssertionInferredByR1173"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerProvidedValuesStored"]) === false
    && readBooleanAt(value, ["summary", "rowParsingPerformedByR1173"]) === false;
}

function matchesR1174SafeNextStepPacket(value: unknown | null): boolean {
  return matchesArtifact(value, R1174_PACKET_ID, R1174_SCHEMA_VERSION)
    && readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(value, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && exactStringSet(readStringArrayAt(value, ["summary", "minimumFeaturePairRequired"]), MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS)
    && exactStringSet(readStringArrayAt(value, ["summary", "requiredInputKindIds"]), REQUIRED_INPUT_KIND_IDS)
    && exactStringSet(readStringArrayAt(value, ["summary", "requiredAssertionChecklistIds"]), REQUIRED_ASSERTION_CHECKLIST_IDS)
    && readStringAt(value, ["summary", "r1176LiveChainCommand"]) === R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_COMMAND
    && readBooleanAt(value, ["summary", "answerSheetReadyForRowOwner"]) === true
    && readBooleanAt(value, ["summary", "explicitRowOwnerAssertionProvided"]) === false
    && readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["summary", "readyForRowOwnerR1176LiveChainConfirmation"]) === true
    && readBooleanAt(value, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1174"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerConfirmationInferredByR1174"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerProvidedValuesStored"]) === false
    && readBooleanAt(value, ["summary", "rowParsingPerformedByR1174"]) === false;
}

function matchesR1176RowOwnerSafeAssertionChain(value: unknown | null): boolean {
  return matchesArtifact(value, R1176_PACKET_ID, R1176_SCHEMA_VERSION)
    && readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND
    && readStringAt(value, ["summary", "targetInputPriority"]) === TARGET_INPUT_PRIORITY
    && exactStringSet(readStringArrayAt(value, ["summary", "minimumFeaturePairRequired"]), MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS)
    && exactStringSet(readStringArrayAt(value, ["summary", "requiredInputKindIds"]), REQUIRED_INPUT_KIND_IDS)
    && exactStringSet(
      readStringArrayAt(value, ["summary", "ordinarySubmitterSafeCompletionChecklistItemIds"]),
      SAFE_COMPLETION_CHECKLIST_ITEM_IDS,
    )
    && readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]) === false
    && readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === false
    && readBooleanAt(value, ["summary", "reviewGptRequiredNow"]) === false
    && readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1176"]) === false
    && readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]) === false
    && readBooleanAt(value, ["summary", "rowParsingPerformedByR1176"]) === false;
}

function matchesArtifact(value: unknown | null, packetId: string, schemaVersion: string): boolean {
  return readStringAt(value, ["packetId"]) === packetId
    && readStringAt(value, ["schemaVersion"]) === schemaVersion
    && readStringAt(value, ["status"]) === "research-local-aggregate-only"
    && readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]) === true
    && !hasUnsafeTrueBoundaryFlag(value)
    && readBooleanAt(value, ["artifactBoundary", "productDisplayAuthorized"]) === false;
}

function allowedRowOwnerRouteStatus(value: string | null): boolean {
  return value === "feature_only_research_handoff_ready"
    || value === "waiting_on_current_loop_or_priority_packet"
    || value === "waiting_on_row_owner_feature_only_assertion";
}

function conclusionFor(params: {
  firstBlockedRequirementId: ObjectiveRequirementId | null;
  featureOnlyResearchHandoffReady: boolean;
  goalAchieved: boolean;
  productDisplayBlockedUntilValidation: boolean;
  realLabWearableRouteMetricsRecorded: boolean;
  rowOwnerSafeAssertionConfirmed: boolean;
}): GapAuditConclusion {
  if (params.goalAchieved) {
    return "average_submitter_objective_gap_audit_ready_to_mark_complete";
  }
  if (!params.productDisplayBlockedUntilValidation) {
    return "average_submitter_objective_gap_audit_blocked_on_product_safety";
  }
  if (params.firstBlockedRequirementId === null || !params.realLabWearableRouteMetricsRecorded) {
    if (params.featureOnlyResearchHandoffReady) {
      return "average_submitter_objective_gap_audit_blocked_on_real_route_metrics";
    }
  }
  if (!params.rowOwnerSafeAssertionConfirmed && isRowOwnerAssertionBlocker(params.firstBlockedRequirementId)) {
    return "average_submitter_objective_gap_audit_blocked_on_row_owner_safe_assertion";
  }
  if (!params.featureOnlyResearchHandoffReady && params.firstBlockedRequirementId === "feature_only_research_handoff_ready") {
    return "average_submitter_objective_gap_audit_blocked_on_feature_only_handoff";
  }
  return "average_submitter_objective_gap_audit_waiting_on_current_packets";
}

function isRowOwnerAssertionBlocker(value: ObjectiveRequirementId | null): boolean {
  return value === "row_owner_safe_assertion_confirmed"
    || value === "safe_assertion_answer_sheet_available"
    || value === "safe_next_step_packet_available"
    || value === "r1176_live_chain_available";
}

function commandForNextAction(nextAction: R1179NextActionId): string | null {
  if (nextAction === "refresh_r1178_current_loop_surfacing") {
    return R1178_AVERAGE_SUBMITTER_CURRENT_LOOP_SURFACING_COMMAND;
  }
  if (nextAction === "refresh_r1145_completion_audit") {
    return R1145_COMPLETION_AUDIT_COMMAND;
  }
  if (nextAction === "refresh_r1173_safe_assertion_answer_sheet") {
    return R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND;
  }
  if (nextAction === "refresh_r1174_safe_next_step_packet") {
    return R1174_SAFE_NEXT_STEP_PACKET_COMMAND;
  }
  if (nextAction === "refresh_r1176_row_owner_safe_assertion_chain") {
    return null;
  }
  if (
    nextAction
      === "review_r1173_safe_assertion_answer_sheet_then_rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation"
  ) {
    return R1173_SAFE_ASSERTION_ANSWER_SHEET_COMMAND;
  }
  if (nextAction === "run_r1164_feature_only_research_handoff_after_minimum_pair_confirmed") {
    return R1164_FEATURE_ONLY_RESEARCH_HANDOFF_COMMAND;
  }
  return null;
}

function evidenceArtifactIds(
  evidence: Record<"r1145" | "r1173" | "r1174" | "r1176" | "r1178", boolean>,
): EvidenceArtifactId[] {
  return evidenceIdsForReady([
    [evidence.r1178, R1178_PACKET_ID],
    [evidence.r1145, R1145_PACKET_ID],
    [evidence.r1173, R1173_PACKET_ID],
    [evidence.r1174, R1174_PACKET_ID],
    [evidence.r1176, R1176_PACKET_ID],
  ]);
}

function evidenceIdsForReady(entries: Array<[boolean, EvidenceArtifactId]>): EvidenceArtifactId[] {
  return entries.flatMap(([ready, artifactId]) => ready ? [artifactId] : []);
}

function summarizeArtifact(params: {
  artifact: string;
  expectedPacketId: EvidenceArtifactId;
  expectedSchemaVersion: string;
  value: unknown | null;
}): ArtifactSummary {
  return {
    artifact: params.artifact,
    packetId: readStringAt(params.value, ["packetId"]) === params.expectedPacketId
      ? params.expectedPacketId
      : null,
    schemaVersion: readStringAt(params.value, ["schemaVersion"]) === params.expectedSchemaVersion
      ? params.expectedSchemaVersion
      : null,
    status: params.value === null ? "missing" : "available",
  };
}

function hasUnsafeTrueBoundaryFlag(value: unknown | null): boolean {
  const artifactBoundary = recordAt(value, "artifactBoundary");
  return Object.entries(artifactBoundary).some(([key, boundaryValue]) => key !== "aggregateOnly" && boundaryValue === true);
}

function anyProductDisplayAuthorized(values: Array<unknown | null>): boolean {
  return values.some((value) =>
    readBooleanAt(value, ["artifactBoundary", "productDisplayAuthorized"]) === true
    || readBooleanAt(value, ["summary", "productDisplayAuthorized"]) === true
    || readBooleanAt(value, ["productDisplayAuthorized"]) === true
  );
}

function safeBoundary(): R1179AverageSubmitterObjectiveGapAuditOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    fileNamesStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelEvidencePromotedByR1179: false,
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
    rowLevelDataAcceptedByR1179: false,
    rowOwnerConfirmationInferredByR1179: false,
    rowOwnerPrivateValuesStored: false,
    rowOwnerProvidedValuesStored: false,
    rowParsingPerformedByR1179: false,
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
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    if (error instanceof SyntaxError) {
      throw new Error("R1179 input JSON parse failed.");
    }
    throw error;
  }
}

function validateAggregateSafe(label: string, value: unknown | null): void {
  if (value === null) {
    return;
  }
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1179 rejected unsafe ${label}: ${formatFindingCount(findings)}`);
  }
}

function formatFindingCount(findings: unknown[]): string {
  return `${findings.length} ${findings.length === 1 ? "finding" : "findings"}`;
}

function ensureNoOutputPathInOutput(output: unknown, outputDir: string): void {
  if (outputDir.length > 0 && JSON.stringify(output).includes(outputDir)) {
    throw new Error("R1179 output included an output path.");
  }
}

function createdAtFor(createdAt: string | undefined): string {
  if (createdAt === undefined) {
    return new Date().toISOString();
  }
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new Error("R1179 rejected invalid createdAt timestamp.");
  }
  return createdAt;
}

function recordAt(value: unknown, key: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const next = (value as Record<string, unknown>)[key];
  if (typeof next !== "object" || next === null || Array.isArray(next)) {
    return {};
  }
  return next as Record<string, unknown>;
}

function readValueAt(value: unknown, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const found = readValueAt(value, pathParts);
  return typeof found === "string" ? found : null;
}

function readBooleanAt(value: unknown, pathParts: readonly string[]): boolean | null {
  const found = readValueAt(value, pathParts);
  return typeof found === "boolean" ? found : null;
}

function readStringArrayAt(value: unknown, pathParts: readonly string[]): string[] {
  const found = readValueAt(value, pathParts);
  return Array.isArray(found) && found.every((item): item is string => typeof item === "string")
    ? found
    : [];
}

function exactStringSet(actual: string[], expected: readonly string[]): boolean {
  return actual.length === expected.length
    && new Set(actual).size === actual.length
    && expected.every((item) => actual.includes(item));
}

function isUniqueStringSubset(actual: string[], expected: readonly string[]): boolean {
  return new Set(actual).size === actual.length
    && actual.every((item) => expected.includes(item));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function main(): Promise<void> {
  try {
    const { output } = await runR1179AverageSubmitterObjectiveGapAudit({
      createdAt: process.env.MURPH_AGE_R1179_CREATED_AT,
      outputDir: process.env.MURPH_AGE_R1179_OUTPUT_DIR,
      r1145Path: process.env.MURPH_AGE_R1145_COMPLETION_AUDIT_PATH,
      r1173Path: process.env.MURPH_AGE_R1173_SAFE_ASSERTION_ANSWER_SHEET_PATH,
      r1174Path: process.env.MURPH_AGE_R1174_SAFE_NEXT_STEP_PACKET_PATH,
      r1176Path: process.env.MURPH_AGE_R1176_ROW_OWNER_SAFE_ASSERTION_CHAIN_RUNNER_PATH,
      r1178Path: process.env.MURPH_AGE_R1178_AVERAGE_SUBMITTER_CURRENT_LOOP_SURFACING_PATH,
    });
    process.stdout.write(`${JSON.stringify({
      blockedRequirementIds: output.summary.blockedRequirementIds,
      conclusion: output.summary.conclusion,
      goalAchieved: output.summary.goalAchieved,
      minimumFeaturePairRequired: output.summary.minimumFeaturePairRequired,
      nextAction: output.summary.nextAction,
      packetId: output.packetId,
      prioritizedInputKindIds: output.summary.prioritizedInputKindIds,
      productDisplayAuthorized: output.summary.productDisplayAuthorized,
      readyToMarkComplete: output.summary.readyToMarkComplete,
      rowOwnerActionRouteStatus: output.summary.rowOwnerActionRouteStatus,
      safeCurrentLoopCommandVisible: output.summary.safeCurrentLoopCommandVisible,
      topBlockedRequirementId: output.summary.firstBlockedRequirementId,
    })}\n`);
  } catch (error) {
    process.stderr.write(`${safeCliErrorMessage(error, "R1179 average submitter objective gap audit failed.")}\n`);
    process.exitCode = 1;
  }
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }
  if (
    error.message === "R1179 input JSON parse failed."
    || error.message === "R1179 output included an output path."
    || error.message === "R1179 rejected invalid createdAt timestamp."
    || /^R1179 rejected unsafe (?:r1178 current-loop surfacing|r1145 completion audit|r1173 safe assertion answer sheet|r1174 safe next-step packet|r1176 row-owner safe assertion chain|r1179 average submitter objective gap audit): \d+ findings?$/u
      .test(error.message)
  ) {
    return error.message;
  }
  return fallback;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  void main();
}
