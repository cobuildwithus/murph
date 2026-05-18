import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  runR1180AverageSubmitterSafeConfirmationResponseIntake,
} from "./r1180-average-submitter-safe-confirmation-response-intake.ts";
import {
  runR1181AverageSubmitterFeatureOnlyExecutionContract,
} from "./r1181-average-submitter-feature-only-execution-contract.ts";
import {
  runR1182AverageSubmitterSafeResponseHandoff,
} from "./r1182-average-submitter-safe-response-handoff.ts";
import {
  R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND,
  runR1183AverageSubmitterSafeResponseMaterializer,
} from "./r1183-average-submitter-safe-response-materializer.ts";
import {
  R1184_AVERAGE_SUBMITTER_SAFE_RESPONSE_CHAIN_STATUS_COMMAND,
  R1184_AVERAGE_SUBMITTER_SAFE_RESPONSE_CHAIN_STATUS_SCHEMA_VERSION,
  runR1184AverageSubmitterSafeResponseChainStatus,
} from "./r1184-average-submitter-safe-response-chain-status.ts";

export const R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_SCHEMA_VERSION =
  "murph-age-r1185-average-submitter-safe-response-smoke-proof.v1" as const;
export const R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1185-average-submitter-safe-response-smoke-proof.ts" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1185-average-submitter-safe-response-smoke-proof.latest.json" as const;
const R1184_ARTIFACT = "r1184-average-submitter-safe-response-chain-status.latest.json" as const;
const R1184_PACKET_ID = "r1184-average-submitter-safe-response-chain-status" as const;
const R1185_PACKET_ID = "r1185-average-submitter-safe-response-smoke-proof" as const;
const R1180_OUTPUT_FILE_NAME =
  "r1180-average-submitter-safe-confirmation-response-intake.latest.json" as const;
const R1181_OUTPUT_FILE_NAME =
  "r1181-average-submitter-feature-only-execution-contract.latest.json" as const;
const R1182_OUTPUT_FILE_NAME = "r1182-average-submitter-safe-response-handoff.latest.json" as const;
const R1183_OUTPUT_FILE_NAME = "r1183-average-submitter-safe-response-materializer.latest.json" as const;
const R1184_OUTPUT_FILE_NAME = "r1184-average-submitter-safe-response-chain-status.latest.json" as const;
const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first" as const;
const TARGET_AGE_BAND = "roughly_16_50" as const;
const MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS = [
  "bloodwork_glycemia",
  "wearable_activity_daily",
] as const;
const PRIORITIZED_INPUT_KIND_IDS = [
  "lab_portal_export_or_spreadsheet",
  "phone_watch_or_wearable_activity_export",
] as const;
const REQUIRED_RESPONSE_FIELD_IDS = [
  "confirm_target_age_band_roughly_16_50",
  "confirm_glycemia_bloodwork_export_available",
  "confirm_daily_wearable_activity_export_available",
  "confirm_no_private_values_in_confirmation",
] as const;
const SAFE_EXECUTION_FEATURE_SLOT_IDS = [
  "glycemia_lab_presence",
  "glycemia_measurement_date_presence",
  "daily_activity_presence",
  "daily_wear_coverage_presence",
] as const;
const R1184_CONCLUSION_IDS = [
  "average_submitter_safe_response_chain_ready_for_feature_only_research_planning",
  "average_submitter_safe_response_chain_waiting_on_r1180_confirmed_response_intake",
  "average_submitter_safe_response_chain_waiting_on_r1180_response",
  "average_submitter_safe_response_chain_waiting_on_r1181_feature_contract",
  "average_submitter_safe_response_chain_waiting_on_r1182_handoff",
  "average_submitter_safe_response_chain_waiting_on_r1183_refresh",
  "average_submitter_safe_response_chain_waiting_on_row_owner_confirmation",
] as const;
const R1184_NEXT_ACTION_IDS = [
  "fill_r1180_safe_confirmation_response_template",
  "refresh_r1181_feature_only_execution_contract",
  "refresh_r1182_safe_response_handoff",
  "refresh_r1183_safe_response_materializer",
  "rerun_r1183_with_row_owner_safe_response_assertion",
  "run_r1180_with_r1183_confirmed_safe_response_artifact",
  "run_r1181_feature_only_execution_contract",
  "use_r1181_feature_only_execution_contract_for_research_planning_only",
] as const;
const STAGE_IDS = [
  "r1183_materializer",
  "r1180_response_intake",
  "r1181_feature_contract",
  "r1182_safe_response_handoff",
  "r1184_chain_status",
] as const;
const R1185_NEXT_ACTION_IDS = [
  "obtain_real_row_owner_safe_confirmation_then_rerun_r1183",
  "refresh_r1184_safe_response_chain_status",
] as const;
const R1184_ROOT_KEYS = [
  "artifactBoundary",
  "chainStatus",
  "createdAt",
  "inputArtifacts",
  "packetId",
  "productDisplayAuthorized",
  "r1180State",
  "r1181State",
  "r1182State",
  "r1183State",
  "responseArtifactState",
  "schemaVersion",
  "status",
  "summary",
] as const;
const R1184_ARTIFACT_BOUNDARY_KEYS = [
  "aggregateOnly",
  "codebookTextStored",
  "coefficientsStored",
  "confirmedResponseLocalPathStored",
  "fileNamesStored",
  "fillableResponseLocalPathStored",
  "headerValuesStored",
  "localPathsStored",
  "modelEvidencePromotedByR1184",
  "modelParametersStored",
  "participantIdentifiersStored",
  "participantIdentifiersWritten",
  "predictionsStored",
  "privateConfigValuesStored",
  "privateDetailsStored",
  "privateFieldRefValuesStored",
  "privateFieldRefsStored",
  "privateTableRefValuesStored",
  "privateTableRefsStored",
  "productClaimsIncluded",
  "productDisplayAuthorized",
  "productPromotionAuthorized",
  "recommendationClaimsIncluded",
  "rowLevelDataAcceptedByR1184",
  "rowOwnerConfirmationInferredByR1184",
  "rowOwnerPrivateValuesStored",
  "rowOwnerSafeResponseValuesStoredInR1184Packet",
  "rowParsingPerformedByR1184",
  "rowValuesStored",
  "safeBooleanValuesStoredInR1184Packet",
  "smallCellsStored",
  "sourceBodiesStored",
  "sourceFileNamesStored",
  "sourceVariableNamesStored",
  "splitMembershipStored",
] as const;
const R1184_CHAIN_STATUS_KEYS = [
  "confirmedResponseArtifact",
  "confirmedResponseArtifactPresent",
  "confirmedResponseArtifactReadyForR1180",
  "conclusion",
  "explicitRowOwnerSafeConfirmationProvided",
  "featureOnlyExecutionContractReady",
  "featureOnlySafeConfirmationReady",
  "fillableResponseArtifact",
  "fillableResponseArtifactPresent",
  "handoffReadyForResearchPlanningOnly",
  "materializerReadyForRowOwnerConfirmation",
  "minimumFeaturePairRequired",
  "modelEvidencePromotionAllowed",
  "nextAction",
  "nextActionCommand",
  "nextActionInputArtifact",
  "nextActionRequiresExplicitRowOwnerAssertion",
  "prioritizedInputKindIds",
  "productDisplayAuthorized",
  "requiredResponseFieldIds",
  "reviewGptRequiredNow",
  "rowLevelDataAcceptedByR1184",
  "rowOwnerConfirmationInferredByR1184",
  "rowOwnerPrivateValuesStored",
  "rowOwnerSafeResponseAssertionStillRequired",
  "rowOwnerSafeResponseValuesStoredInR1184Packet",
  "rowParsingPerformedByR1184",
  "safeExecutionFeatureSlotIds",
  "sourcePriority",
  "staleConfirmedResponseArtifactDetected",
  "targetAgeBand",
] as const;
const R1184_INPUT_ARTIFACT_KEYS = [
  "r1180SafeConfirmationResponseIntake",
  "r1181FeatureOnlyExecutionContract",
  "r1182SafeResponseHandoff",
  "r1183SafeResponseMaterializer",
  "r1183ConfirmedSafeResponse",
  "r1183FillableSafeResponse",
] as const;
const R1184_ARTIFACT_SUMMARY_KEYS = ["artifact", "packetId", "schemaVersion", "status"] as const;
const R1184_SAFE_RESPONSE_ARTIFACT_SUMMARY_KEYS = [
  "artifact",
  "responseKind",
  "schemaVersion",
  "status",
  "validSafeResponseShape",
] as const;
const R1184_RESPONSE_ARTIFACT_STATE_KEYS = [
  "confirmedResponseArtifactPresent",
  "confirmedResponseArtifactReadyForR1180",
  "fillableResponseArtifactPresent",
  "staleConfirmedResponseArtifactDetected",
] as const;
const R1184_R1180_STATE_KEYS = [
  "artifactBoundaryAggregateOnly",
  "artifactBoundaryUnsafeTrueFlagFound",
  "conclusion",
  "explicitRowOwnerSafeConfirmationProvided",
  "featureOnlySafeConfirmationReady",
  "inputArtifactAvailable",
  "minimumPairMatches",
  "modelEvidencePromotionAllowed",
  "nextAction",
  "packetId",
  "prioritizedInputKindsMatch",
  "productDisplayAuthorized",
  "requiredResponseFieldsMatch",
  "responseStatus",
  "reviewGptRequiredNow",
  "rowLevelDataAcceptedByR1180",
  "rowOwnerConfirmationInferredByR1180",
  "rowOwnerPrivateValuesStored",
  "rowOwnerProvidedPrivateValuesStored",
  "rowOwnerProvidedSafeBooleansStored",
  "rowParsingPerformedByR1180",
  "schemaCurrent",
  "sourcePriorityMatches",
  "status",
  "targetAgeBandMatches",
] as const;
const R1184_R1181_STATE_KEYS = [
  "artifactBoundaryAggregateOnly",
  "artifactBoundaryUnsafeTrueFlagFound",
  "conclusion",
  "explicitRowOwnerSafeConfirmationProvided",
  "featureOnlyExecutionContractReady",
  "featureOnlySafeConfirmationReady",
  "inputArtifactAvailable",
  "modelEvidencePromotionAllowed",
  "nextAction",
  "packetId",
  "productDisplayAuthorized",
  "researchPlanningAllowed",
  "reviewGptRequiredNow",
  "rowLevelDataAcceptedByR1181",
  "rowOwnerConfirmationInferredByR1181",
  "rowOwnerPrivateValuesStored",
  "rowParsingPerformedByR1181",
  "safeExecutionFeatureSlotIds",
  "schemaCurrent",
  "sourcePriorityMatches",
  "status",
  "targetAgeBandMatches",
] as const;
const R1184_R1182_STATE_KEYS = [
  "artifactBoundaryAggregateOnly",
  "artifactBoundaryUnsafeTrueFlagFound",
  "conclusion",
  "explicitRowOwnerSafeConfirmationProvided",
  "featureOnlyExecutionContractReady",
  "handoffReadyForResearchPlanningOnly",
  "inputArtifactAvailable",
  "minimumPairMatches",
  "modelEvidencePromotionAllowed",
  "nextAction",
  "packetId",
  "productDisplayAuthorized",
  "requiredResponseFieldsMatch",
  "reviewGptRequiredNow",
  "rowLevelDataAcceptedByR1182",
  "rowOwnerConfirmationInferredByR1182",
  "rowOwnerPrivateValuesStored",
  "rowParsingPerformedByR1182",
  "safeExecutionFeatureSlotIds",
  "schemaCurrent",
  "sourcePriorityMatches",
  "status",
  "targetAgeBandMatches",
] as const;
const R1184_R1183_STATE_KEYS = [
  "artifactBoundaryAggregateOnly",
  "artifactBoundaryUnsafeTrueFlagFound",
  "conclusion",
  "confirmedResponseArtifact",
  "confirmedResponseArtifactWritten",
  "explicitRowOwnerSafeResponseAssertionProvided",
  "fillableResponseArtifact",
  "fillableResponseArtifactWritten",
  "inputArtifactAvailable",
  "materializerReadyForRowOwnerConfirmation",
  "minimumPairMatches",
  "modelEvidencePromotionAllowed",
  "nextAction",
  "packetId",
  "productDisplayAuthorized",
  "requiredResponseFieldsMatch",
  "responseSchemaVersion",
  "reviewGptRequiredNow",
  "rowLevelDataAcceptedByR1183",
  "rowOwnerConfirmationInferredByR1183",
  "rowOwnerPrivateValuesStored",
  "rowOwnerSafeResponseAssertionStillRequired",
  "rowOwnerSafeResponseValuesStoredInR1183Packet",
  "rowParsingPerformedByR1183",
  "schemaCurrent",
  "sourcePriorityMatches",
  "status",
  "targetAgeBandMatches",
] as const;
const R1184_UNEXPECTED_SHAPE_ERROR =
  "R1185 rejected unexpected live r1184 safe response chain status shape." as const;

type ArrayValue<T extends readonly string[]> = T[number];
type MinimumFeaturePairSourceFamilyId = ArrayValue<typeof MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS>;
type PrioritizedInputKindId = ArrayValue<typeof PRIORITIZED_INPUT_KIND_IDS>;
type RequiredResponseFieldId = ArrayValue<typeof REQUIRED_RESPONSE_FIELD_IDS>;
type SafeExecutionFeatureSlotId = ArrayValue<typeof SAFE_EXECUTION_FEATURE_SLOT_IDS>;
type R1184Conclusion = ArrayValue<typeof R1184_CONCLUSION_IDS>;
type R1184NextActionId = ArrayValue<typeof R1184_NEXT_ACTION_IDS>;
type StageId = ArrayValue<typeof STAGE_IDS>;
type R1185NextActionId = ArrayValue<typeof R1185_NEXT_ACTION_IDS>;
type R1185Conclusion =
  | "average_submitter_safe_response_smoke_passed_non_evidence"
  | "average_submitter_safe_response_smoke_waiting_on_live_r1184_row_owner_blocker";

interface LiveR1184State {
  artifactBoundaryAggregateOnly: boolean | null;
  artifactBoundaryUnsafeTrueFlagFound: boolean;
  confirmedResponseArtifactReadyForR1180: boolean | null;
  conclusion: R1184Conclusion | null;
  fillableResponseArtifactPresent: boolean | null;
  inputArtifactAvailable: boolean;
  modelEvidencePromotionAllowed: boolean | null;
  nextAction: R1184NextActionId | null;
  nextActionCommand: typeof R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND | null;
  nextActionRequiresExplicitRowOwnerAssertion: boolean | null;
  packetId: typeof R1184_PACKET_ID | null;
  productDisplayAuthorized: boolean | null;
  reviewGptRequiredNow: boolean | null;
  rowLevelDataAcceptedByR1184: boolean | null;
  rowOwnerConfirmationInferredByR1184: boolean | null;
  rowOwnerPrivateValuesStored: boolean | null;
  rowOwnerSafeResponseValuesStoredInR1184Packet: boolean | null;
  rowParsingPerformedByR1184: boolean | null;
  schemaCurrent: boolean;
  sourcePriorityMatches: boolean;
  status: "research-local-aggregate-only" | null;
  targetAgeBandMatches: boolean;
}

interface StageConclusion {
  artifact: string;
  conclusion: string | null;
  readyForNextStage: boolean;
  stageId: StageId;
  syntheticNonEvidence: true;
}

export interface R1185AverageSubmitterSafeResponseSmokeProofOptions {
  createdAt?: string;
  liveR1184Path?: string;
  outputDir?: string;
  r1179Path?: string;
  r1182Path?: string;
  scratchRootDir?: string;
}

export interface R1185AverageSubmitterSafeResponseSmokeProofOutput {
  artifactBoundary: ReturnType<typeof safeBoundary>;
  createdAt: string;
  liveR1184State: LiveR1184State;
  packetId: typeof R1185_PACKET_ID;
  productDisplayAuthorized: false;
  schemaVersion: typeof R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_SCHEMA_VERSION;
  smokeProof: {
    evidenceClass: "synthetic_non_evidence_smoke_proof";
    liveArtifactsMutatedByR1185: false;
    liveRowOwnerConfirmationProvided: false;
    minimumFeaturePairRequired: MinimumFeaturePairSourceFamilyId[];
    modelEvidencePromotionAllowed: false;
    nextRealAction: R1185NextActionId;
    nextRealActionCommand: string;
    nextRealActionRequiresExplicitRowOwnerAssertion: boolean;
    prioritizedInputKindIds: PrioritizedInputKindId[];
    productDisplayAuthorized: false;
    requiredResponseFieldIds: RequiredResponseFieldId[];
    reviewGptRequiredNow: false;
    rowLevelDataAcceptedByR1185: false;
    rowOwnerConfirmationInferredByR1185: false;
    rowOwnerPrivateValuesStored: false;
    rowOwnerSafeResponseValuesStoredInR1185Packet: false;
    rowParsingPerformedByR1185: false;
    safeExecutionFeatureSlotIds: SafeExecutionFeatureSlotId[] | null;
    sourcePriority: typeof TARGET_INPUT_PRIORITY;
    stageConclusions: StageConclusion[];
    syntheticPathAdvancedToFeatureOnlyResearchPlanning: boolean;
    syntheticSafeConfirmationUsed: boolean;
    syntheticSmokeRan: boolean;
    targetAgeBand: typeof TARGET_AGE_BAND;
  };
  status: "research-local-aggregate-only";
  summary: {
    conclusion: R1185Conclusion;
    liveR1184Conclusion: R1184Conclusion | null;
    liveR1184ReadyForSyntheticSmoke: boolean;
    nextRealAction: R1185NextActionId;
    nextRealActionCommand: string;
    nextRealActionRequiresExplicitRowOwnerAssertion: boolean;
    productDisplayAuthorized: false;
    syntheticPathAdvancedToFeatureOnlyResearchPlanning: boolean;
    syntheticSmokeRan: boolean;
  };
}

export async function runR1185AverageSubmitterSafeResponseSmokeProof(
  options: R1185AverageSubmitterSafeResponseSmokeProofOptions = {},
): Promise<{ output: R1185AverageSubmitterSafeResponseSmokeProofOutput; outputPath: string }> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const liveR1184 = await readJsonIfPresent(options.liveR1184Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1184_ARTIFACT));
  validateAggregateSafe("r1184 safe response chain status", liveR1184);
  validateLiveR1184ExpectedShape(liveR1184);
  const liveR1184State = stateFromLiveR1184(liveR1184);
  rejectUnsafeLiveR1184State(liveR1184State);

  const createdAt = createdAtFor(options.createdAt);
  const liveR1184ReadyForSyntheticSmoke = liveR1184ReadyForSmoke(liveR1184State);
  const output = liveR1184ReadyForSyntheticSmoke
    ? await runSyntheticSmoke({ createdAt, liveR1184State, options })
    : waitingOutput({ createdAt, liveR1184State });

  ensureNoOutputPathInOutput(output, outputDir);
  validateAggregateSafe("r1185 safe response smoke proof", output);
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function runSyntheticSmoke(state: {
  createdAt: string;
  liveR1184State: LiveR1184State;
  options: R1185AverageSubmitterSafeResponseSmokeProofOptions;
}): Promise<R1185AverageSubmitterSafeResponseSmokeProofOutput> {
  const scratchRootDir = state.options.scratchRootDir ?? os.tmpdir();
  await mkdir(scratchRootDir, { recursive: true });
  const scratchDir = await mkdtemp(path.join(scratchRootDir, "murph-age-r1185-"));
  try {
    const r1183 = await runR1183AverageSubmitterSafeResponseMaterializer({
      createdAt: state.createdAt,
      outputDir: scratchDir,
      r1182Path: state.options.r1182Path,
      rowOwnerSafeResponseAssertionsConfirmed: true,
    });
    if (r1183.confirmedResponsePath === null || r1183.fillableResponsePath === null) {
      throw new Error("R1185 synthetic smoke could not produce confirmed safe response.");
    }

    const r1180 = await runR1180AverageSubmitterSafeConfirmationResponseIntake({
      createdAt: state.createdAt,
      outputDir: scratchDir,
      r1179Path: state.options.r1179Path,
      responsePath: r1183.confirmedResponsePath,
    });
    const r1181 = await runR1181AverageSubmitterFeatureOnlyExecutionContract({
      createdAt: state.createdAt,
      outputDir: scratchDir,
      r1180Path: r1180.outputPath,
    });
    const r1182 = await runR1182AverageSubmitterSafeResponseHandoff({
      createdAt: state.createdAt,
      outputDir: scratchDir,
      r1181Path: r1181.outputPath,
    });
    const r1184 = await runR1184AverageSubmitterSafeResponseChainStatus({
      confirmedResponsePath: r1183.confirmedResponsePath,
      createdAt: state.createdAt,
      fillableResponsePath: r1183.fillableResponsePath,
      outputDir: scratchDir,
      r1180Path: r1180.outputPath,
      r1181Path: r1181.outputPath,
      r1182Path: r1182.outputPath,
      r1183Path: r1183.outputPath,
    });

    const stageConclusions = stageConclusionsFor({
      r1180Conclusion: r1180.output.summary.conclusion,
      r1181Conclusion: r1181.output.summary.conclusion,
      r1182Conclusion: r1182.output.summary.conclusion,
      r1183Conclusion: r1183.output.summary.conclusion,
      r1184Conclusion: r1184.output.summary.conclusion,
    });
    const syntheticPathAdvancedToFeatureOnlyResearchPlanning =
      stageConclusions.every((stage) => stage.readyForNextStage)
      && r1184.output.summary.conclusion
        === "average_submitter_safe_response_chain_ready_for_feature_only_research_planning";
    const output = outputFor({
      conclusion: syntheticPathAdvancedToFeatureOnlyResearchPlanning
        ? "average_submitter_safe_response_smoke_passed_non_evidence"
        : "average_submitter_safe_response_smoke_waiting_on_live_r1184_row_owner_blocker",
      createdAt: state.createdAt,
      liveR1184State: state.liveR1184State,
      nextRealAction: "obtain_real_row_owner_safe_confirmation_then_rerun_r1183",
      nextRealActionCommand: R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND,
      nextRealActionRequiresExplicitRowOwnerAssertion: true,
      safeExecutionFeatureSlotIds: syntheticPathAdvancedToFeatureOnlyResearchPlanning
        ? [...SAFE_EXECUTION_FEATURE_SLOT_IDS]
        : null,
      stageConclusions,
      syntheticPathAdvancedToFeatureOnlyResearchPlanning,
      syntheticSafeConfirmationUsed: true,
      syntheticSmokeRan: true,
    });
    ensureNoOutputPathInOutput(output, scratchDir);
    return output;
  } finally {
    await rm(scratchDir, { force: true, recursive: true });
  }
}

function waitingOutput(state: {
  createdAt: string;
  liveR1184State: LiveR1184State;
}): R1185AverageSubmitterSafeResponseSmokeProofOutput {
  return outputFor({
    conclusion: "average_submitter_safe_response_smoke_waiting_on_live_r1184_row_owner_blocker",
    createdAt: state.createdAt,
    liveR1184State: state.liveR1184State,
    nextRealAction: "refresh_r1184_safe_response_chain_status",
    nextRealActionCommand: R1184_AVERAGE_SUBMITTER_SAFE_RESPONSE_CHAIN_STATUS_COMMAND,
    nextRealActionRequiresExplicitRowOwnerAssertion: false,
    safeExecutionFeatureSlotIds: null,
    stageConclusions: [],
    syntheticPathAdvancedToFeatureOnlyResearchPlanning: false,
    syntheticSafeConfirmationUsed: false,
    syntheticSmokeRan: false,
  });
}

function outputFor(state: {
  conclusion: R1185Conclusion;
  createdAt: string;
  liveR1184State: LiveR1184State;
  nextRealAction: R1185NextActionId;
  nextRealActionCommand: string;
  nextRealActionRequiresExplicitRowOwnerAssertion: boolean;
  safeExecutionFeatureSlotIds: SafeExecutionFeatureSlotId[] | null;
  stageConclusions: StageConclusion[];
  syntheticPathAdvancedToFeatureOnlyResearchPlanning: boolean;
  syntheticSafeConfirmationUsed: boolean;
  syntheticSmokeRan: boolean;
}): R1185AverageSubmitterSafeResponseSmokeProofOutput {
  return {
    artifactBoundary: safeBoundary(),
    createdAt: state.createdAt,
    liveR1184State: state.liveR1184State,
    packetId: R1185_PACKET_ID,
    productDisplayAuthorized: false,
    schemaVersion: R1185_AVERAGE_SUBMITTER_SAFE_RESPONSE_SMOKE_PROOF_SCHEMA_VERSION,
    smokeProof: {
      evidenceClass: "synthetic_non_evidence_smoke_proof",
      liveArtifactsMutatedByR1185: false,
      liveRowOwnerConfirmationProvided: false,
      minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS],
      modelEvidencePromotionAllowed: false,
      nextRealAction: state.nextRealAction,
      nextRealActionCommand: state.nextRealActionCommand,
      nextRealActionRequiresExplicitRowOwnerAssertion: state.nextRealActionRequiresExplicitRowOwnerAssertion,
      prioritizedInputKindIds: [...PRIORITIZED_INPUT_KIND_IDS],
      productDisplayAuthorized: false,
      requiredResponseFieldIds: [...REQUIRED_RESPONSE_FIELD_IDS],
      reviewGptRequiredNow: false,
      rowLevelDataAcceptedByR1185: false,
      rowOwnerConfirmationInferredByR1185: false,
      rowOwnerPrivateValuesStored: false,
      rowOwnerSafeResponseValuesStoredInR1185Packet: false,
      rowParsingPerformedByR1185: false,
      safeExecutionFeatureSlotIds: state.safeExecutionFeatureSlotIds,
      sourcePriority: TARGET_INPUT_PRIORITY,
      stageConclusions: state.stageConclusions,
      syntheticPathAdvancedToFeatureOnlyResearchPlanning:
        state.syntheticPathAdvancedToFeatureOnlyResearchPlanning,
      syntheticSafeConfirmationUsed: state.syntheticSafeConfirmationUsed,
      syntheticSmokeRan: state.syntheticSmokeRan,
      targetAgeBand: TARGET_AGE_BAND,
    },
    status: "research-local-aggregate-only",
    summary: {
      conclusion: state.conclusion,
      liveR1184Conclusion: state.liveR1184State.conclusion,
      liveR1184ReadyForSyntheticSmoke: liveR1184ReadyForSmoke(state.liveR1184State),
      nextRealAction: state.nextRealAction,
      nextRealActionCommand: state.nextRealActionCommand,
      nextRealActionRequiresExplicitRowOwnerAssertion: state.nextRealActionRequiresExplicitRowOwnerAssertion,
      productDisplayAuthorized: false,
      syntheticPathAdvancedToFeatureOnlyResearchPlanning:
        state.syntheticPathAdvancedToFeatureOnlyResearchPlanning,
      syntheticSmokeRan: state.syntheticSmokeRan,
    },
  };
}

function stageConclusionsFor(state: {
  r1180Conclusion: string;
  r1181Conclusion: string;
  r1182Conclusion: string;
  r1183Conclusion: string;
  r1184Conclusion: string;
}): StageConclusion[] {
  return [
    {
      artifact: R1183_OUTPUT_FILE_NAME,
      conclusion: state.r1183Conclusion,
      readyForNextStage: state.r1183Conclusion
        === "average_submitter_safe_response_materializer_confirmed_response_written",
      stageId: "r1183_materializer",
      syntheticNonEvidence: true,
    },
    {
      artifact: R1180_OUTPUT_FILE_NAME,
      conclusion: state.r1180Conclusion,
      readyForNextStage: state.r1180Conclusion === "safe_confirmation_response_intake_ready_feature_only",
      stageId: "r1180_response_intake",
      syntheticNonEvidence: true,
    },
    {
      artifact: R1181_OUTPUT_FILE_NAME,
      conclusion: state.r1181Conclusion,
      readyForNextStage: state.r1181Conclusion
        === "average_submitter_feature_only_execution_contract_ready_research_only",
      stageId: "r1181_feature_contract",
      syntheticNonEvidence: true,
    },
    {
      artifact: R1182_OUTPUT_FILE_NAME,
      conclusion: state.r1182Conclusion,
      readyForNextStage: state.r1182Conclusion
        === "average_submitter_safe_response_handoff_ready_for_research_planning_only",
      stageId: "r1182_safe_response_handoff",
      syntheticNonEvidence: true,
    },
    {
      artifact: R1184_OUTPUT_FILE_NAME,
      conclusion: state.r1184Conclusion,
      readyForNextStage: state.r1184Conclusion
        === "average_submitter_safe_response_chain_ready_for_feature_only_research_planning",
      stageId: "r1184_chain_status",
      syntheticNonEvidence: true,
    },
  ];
}

function liveR1184ReadyForSmoke(state: LiveR1184State): boolean {
  return state.inputArtifactAvailable
    && state.schemaCurrent
    && state.packetId === R1184_PACKET_ID
    && state.status === "research-local-aggregate-only"
    && state.artifactBoundaryAggregateOnly === true
    && !state.artifactBoundaryUnsafeTrueFlagFound
    && state.conclusion === "average_submitter_safe_response_chain_waiting_on_row_owner_confirmation"
    && state.nextAction === "rerun_r1183_with_row_owner_safe_response_assertion"
    && state.nextActionCommand === R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND
    && state.nextActionRequiresExplicitRowOwnerAssertion === true
    && state.fillableResponseArtifactPresent === true
    && state.confirmedResponseArtifactReadyForR1180 === false
    && state.modelEvidencePromotionAllowed === false
    && state.productDisplayAuthorized === false
    && state.reviewGptRequiredNow === false
    && state.rowLevelDataAcceptedByR1184 === false
    && state.rowOwnerConfirmationInferredByR1184 === false
    && state.rowOwnerPrivateValuesStored === false
    && state.rowOwnerSafeResponseValuesStoredInR1184Packet === false
    && state.rowParsingPerformedByR1184 === false
    && state.sourcePriorityMatches
    && state.targetAgeBandMatches;
}

function stateFromLiveR1184(value: unknown | null): LiveR1184State {
  return {
    artifactBoundaryAggregateOnly: readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]),
    artifactBoundaryUnsafeTrueFlagFound: hasUnsafeTrueBoundaryFlag(value),
    confirmedResponseArtifactReadyForR1180: readBooleanAt(value, [
      "summary",
      "confirmedResponseArtifactReadyForR1180",
    ]),
    conclusion: readStringInSetAt(value, ["summary", "conclusion"], R1184_CONCLUSION_IDS),
    fillableResponseArtifactPresent: readBooleanAt(value, ["summary", "fillableResponseArtifactPresent"]),
    inputArtifactAvailable: value !== null,
    modelEvidencePromotionAllowed: readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]),
    nextAction: readStringInSetAt(value, ["summary", "nextAction"], R1184_NEXT_ACTION_IDS),
    nextActionCommand: readStringAt(value, ["summary", "nextActionCommand"])
        === R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND
      ? R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND
      : null,
    nextActionRequiresExplicitRowOwnerAssertion: readBooleanAt(value, [
      "summary",
      "nextActionRequiresExplicitRowOwnerAssertion",
    ]),
    packetId: readStringAt(value, ["packetId"]) === R1184_PACKET_ID ? R1184_PACKET_ID : null,
    productDisplayAuthorized: value === null ? false : readBooleanAt(value, ["summary", "productDisplayAuthorized"]),
    reviewGptRequiredNow: readBooleanAt(value, ["summary", "reviewGptRequiredNow"]),
    rowLevelDataAcceptedByR1184: readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1184"]),
    rowOwnerConfirmationInferredByR1184: readBooleanAt(value, [
      "summary",
      "rowOwnerConfirmationInferredByR1184",
    ]),
    rowOwnerPrivateValuesStored: readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]),
    rowOwnerSafeResponseValuesStoredInR1184Packet: readBooleanAt(value, [
      "summary",
      "rowOwnerSafeResponseValuesStoredInR1184Packet",
    ]),
    rowParsingPerformedByR1184: readBooleanAt(value, ["summary", "rowParsingPerformedByR1184"]),
    schemaCurrent: readStringAt(value, ["schemaVersion"])
      === R1184_AVERAGE_SUBMITTER_SAFE_RESPONSE_CHAIN_STATUS_SCHEMA_VERSION,
    sourcePriorityMatches: readStringAt(value, ["summary", "sourcePriority"]) === TARGET_INPUT_PRIORITY,
    status: readStringAt(value, ["status"]) === "research-local-aggregate-only"
      ? "research-local-aggregate-only"
      : null,
    targetAgeBandMatches: readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND,
  };
}

function rejectUnsafeLiveR1184State(state: LiveR1184State): void {
  if (state.artifactBoundaryUnsafeTrueFlagFound) {
    throw new Error("R1185 rejected unsafe live r1184 safe response chain status: 1 finding");
  }
  const unsafeGateFindings = countTrueBooleans([
    state.modelEvidencePromotionAllowed,
    state.productDisplayAuthorized,
    state.reviewGptRequiredNow,
    state.rowLevelDataAcceptedByR1184,
    state.rowOwnerConfirmationInferredByR1184,
    state.rowOwnerPrivateValuesStored,
    state.rowOwnerSafeResponseValuesStoredInR1184Packet,
    state.rowParsingPerformedByR1184,
  ]);
  if (unsafeGateFindings > 0) {
    throw new Error(`R1185 rejected unsafe live r1184 safe response chain status: ${unsafeGateFindings} ${unsafeGateFindings === 1 ? "finding" : "findings"}`);
  }
}

function countTrueBooleans(values: readonly (boolean | null)[]): number {
  return values.filter((value) => value === true).length;
}

function safeBoundary() {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    confirmedResponseLocalPathStored: false,
    fileNamesStored: false,
    fillableResponseLocalPathStored: false,
    headerValuesStored: false,
    liveArtifactsMutatedByR1185: false,
    localPathsStored: false,
    modelEvidencePromotedByR1185: false,
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
    rowLevelDataAcceptedByR1185: false,
    rowOwnerConfirmationInferredByR1185: false,
    rowOwnerPrivateValuesStored: false,
    rowOwnerSafeResponseValuesStoredInR1185Packet: false,
    rowParsingPerformedByR1185: false,
    rowValuesStored: false,
    safeBooleanValuesStoredInR1185Packet: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
    syntheticFixtureRowsStored: false,
  } as const;
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    return parsed;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return null;
    }
    if (error instanceof SyntaxError) {
      throw new Error("R1185 input JSON parse failed.");
    }
    throw error;
  }
}

function validateAggregateSafe(label: string, value: unknown | null): void {
  if (value === null) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1185 rejected unsafe ${label}: ${findings.length} ${findings.length === 1 ? "finding" : "findings"}`);
  }
}

function validateLiveR1184ExpectedShape(value: unknown | null): void {
  if (value === null) return;
  const root = requirePlainR1184Record(value);
  assertExactKeys(root, R1184_ROOT_KEYS);
  assertFlatSafeValues({
    createdAt: root.createdAt,
    packetId: root.packetId,
    productDisplayAuthorized: root.productDisplayAuthorized,
    schemaVersion: root.schemaVersion,
    status: root.status,
  });

  validateR1184BooleanMap(root.artifactBoundary, R1184_ARTIFACT_BOUNDARY_KEYS);
  const summary = validateR1184ChainStatusSection(root.summary);
  const chainStatus = validateR1184ChainStatusSection(root.chainStatus);
  assertRecordsEquivalent(summary, chainStatus, R1184_CHAIN_STATUS_KEYS);
  validateR1184InputArtifacts(root.inputArtifacts);
  validateR1184StateSection(root.r1180State, R1184_R1180_STATE_KEYS);
  validateR1184StateSection(root.r1181State, R1184_R1181_STATE_KEYS, "safeExecutionFeatureSlotIds");
  validateR1184StateSection(root.r1182State, R1184_R1182_STATE_KEYS, "safeExecutionFeatureSlotIds");
  validateR1184StateSection(root.r1183State, R1184_R1183_STATE_KEYS);
  validateR1184BooleanMap(root.responseArtifactState, R1184_RESPONSE_ARTIFACT_STATE_KEYS);
}

function validateR1184ChainStatusSection(value: unknown): Record<string, unknown> {
  const record = requirePlainR1184Record(value);
  assertExactKeys(record, R1184_CHAIN_STATUS_KEYS);
  assertFlatSafeValues(record);
  assertExactStringArrayValue(record.minimumFeaturePairRequired, MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS);
  assertExactStringArrayValue(record.prioritizedInputKindIds, PRIORITIZED_INPUT_KIND_IDS);
  assertExactStringArrayValue(record.requiredResponseFieldIds, REQUIRED_RESPONSE_FIELD_IDS);
  assertOptionalExactStringArrayValue(record.safeExecutionFeatureSlotIds, SAFE_EXECUTION_FEATURE_SLOT_IDS);
  return record;
}

function validateR1184InputArtifacts(value: unknown): void {
  const record = requirePlainR1184Record(value);
  assertExactKeys(record, R1184_INPUT_ARTIFACT_KEYS);
  validateR1184ArtifactSummary(record.r1180SafeConfirmationResponseIntake, R1184_ARTIFACT_SUMMARY_KEYS);
  validateR1184ArtifactSummary(record.r1181FeatureOnlyExecutionContract, R1184_ARTIFACT_SUMMARY_KEYS);
  validateR1184ArtifactSummary(record.r1182SafeResponseHandoff, R1184_ARTIFACT_SUMMARY_KEYS);
  validateR1184ArtifactSummary(record.r1183SafeResponseMaterializer, R1184_ARTIFACT_SUMMARY_KEYS);
  validateR1184ArtifactSummary(record.r1183ConfirmedSafeResponse, R1184_SAFE_RESPONSE_ARTIFACT_SUMMARY_KEYS);
  validateR1184ArtifactSummary(record.r1183FillableSafeResponse, R1184_SAFE_RESPONSE_ARTIFACT_SUMMARY_KEYS);
}

function validateR1184ArtifactSummary(value: unknown, expectedKeys: readonly string[]): void {
  const record = requirePlainR1184Record(value);
  assertExactKeys(record, expectedKeys);
  assertFlatSafeValues(record);
}

function validateR1184StateSection(
  value: unknown,
  expectedKeys: readonly string[],
  exactSafeExecutionFeatureSlotsKey?: string,
): void {
  const record = requirePlainR1184Record(value);
  assertExactKeys(record, expectedKeys);
  assertFlatSafeValues(record);
  if (exactSafeExecutionFeatureSlotsKey !== undefined) {
    assertOptionalExactStringArrayValue(record[exactSafeExecutionFeatureSlotsKey], SAFE_EXECUTION_FEATURE_SLOT_IDS);
  }
}

function validateR1184BooleanMap(value: unknown, expectedKeys: readonly string[]): void {
  const record = requirePlainR1184Record(value);
  assertExactKeys(record, expectedKeys);
  for (const child of Object.values(record)) {
    if (typeof child !== "boolean") {
      rejectUnexpectedLiveR1184Shape();
    }
  }
}

function assertExactKeys(record: Record<string, unknown>, expectedKeys: readonly string[]): void {
  const actualKeys = Object.keys(record);
  if (actualKeys.length !== expectedKeys.length) {
    rejectUnexpectedLiveR1184Shape();
  }
  for (const expectedKey of expectedKeys) {
    if (!Object.prototype.hasOwnProperty.call(record, expectedKey)) {
      rejectUnexpectedLiveR1184Shape();
    }
  }
}

function assertFlatSafeValues(record: Record<string, unknown>): void {
  for (const child of Object.values(record)) {
    if (child === null || typeof child === "boolean" || typeof child === "string") {
      continue;
    }
    if (Array.isArray(child) && child.every((item) => typeof item === "string")) {
      continue;
    }
    rejectUnexpectedLiveR1184Shape();
  }
}

function assertRecordsEquivalent(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  expectedKeys: readonly string[],
): void {
  for (const key of expectedKeys) {
    if (!safeFlatValuesEqual(left[key], right[key])) {
      rejectUnexpectedLiveR1184Shape();
    }
  }
}

function safeFlatValuesEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((item, index) => item === right[index]);
  }
  return left === right;
}

function assertExactStringArrayValue(value: unknown, expectedValues: readonly string[]): void {
  if (!Array.isArray(value) || value.length !== expectedValues.length) {
    rejectUnexpectedLiveR1184Shape();
  }
  for (const [index, expectedValue] of expectedValues.entries()) {
    if (value[index] !== expectedValue) {
      rejectUnexpectedLiveR1184Shape();
    }
  }
}

function assertOptionalExactStringArrayValue(value: unknown, expectedValues: readonly string[]): void {
  if (value === null) return;
  assertExactStringArrayValue(value, expectedValues);
}

function requirePlainR1184Record(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    rejectUnexpectedLiveR1184Shape();
  }
  return value;
}

function rejectUnexpectedLiveR1184Shape(): never {
  throw new Error(R1184_UNEXPECTED_SHAPE_ERROR);
}

function ensureNoOutputPathInOutput(value: unknown, ...blockedFragments: string[]): void {
  const serialized = JSON.stringify(value);
  if (serialized.includes(OUTPUT_FILE_NAME) || blockedFragments.some((fragment) => serialized.includes(fragment))) {
    throw new Error("R1185 output included an output path.");
  }
}

function createdAtFor(value: string | undefined): string {
  const createdAt = value ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new Error("R1185 rejected invalid createdAt timestamp.");
  }
  return createdAt;
}

function hasUnsafeTrueBoundaryFlag(value: unknown): boolean {
  const boundary = readRecordAt(value, ["artifactBoundary"]);
  if (boundary === null) return false;
  return Object.entries(boundary).some(([key, child]) => key !== "aggregateOnly" && child === true);
}

function readRecordAt(value: unknown, pathParts: readonly string[]): Record<string, unknown> | null {
  const found = readAt(value, pathParts);
  return isPlainRecord(found) ? found : null;
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const found = readAt(value, pathParts);
  return typeof found === "string" ? found : null;
}

function readBooleanAt(value: unknown, pathParts: readonly string[]): boolean | null {
  const found = readAt(value, pathParts);
  return typeof found === "boolean" ? found : null;
}

function readStringInSetAt<T extends readonly string[]>(
  value: unknown,
  pathParts: readonly string[],
  values: T,
): T[number] | null {
  const found = readStringAt(value, pathParts);
  return stringSetIncludes(values, found) ? found : null;
}

function readAt(value: unknown, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!isPlainRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringSetIncludes<T extends readonly string[]>(values: T, value: string | null): value is T[number] {
  return value !== null && values.some((candidate) => candidate === value);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return isPlainRecord(error) && error.code === code;
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  if (isExpectedSafeError(error)) return error.message;
  return fallback;
}

function isExpectedSafeError(error: Error): boolean {
  return error.message === "R1185 input JSON parse failed."
    || error.message === "R1185 output included an output path."
    || error.message === R1184_UNEXPECTED_SHAPE_ERROR
    || error.message === "R1185 rejected invalid createdAt timestamp."
    || error.message === "R1185 synthetic smoke could not produce confirmed safe response."
    || /^R1185 rejected unsafe (?:r1184 safe response chain status|live r1184 safe response chain status|r1185 safe response smoke proof): \d+ findings?$/u
      .test(error.message);
}

async function main(): Promise<void> {
  try {
    const { output } = await runR1185AverageSubmitterSafeResponseSmokeProof({
      createdAt: process.env.MURPH_AGE_R1185_CREATED_AT,
      liveR1184Path: process.env.MURPH_AGE_R1185_LIVE_R1184_PATH,
      outputDir: process.env.MURPH_AGE_R1185_OUTPUT_DIR,
      r1179Path: process.env.MURPH_AGE_R1185_R1179_OBJECTIVE_GAP_AUDIT_PATH,
      r1182Path: process.env.MURPH_AGE_R1185_R1182_SAFE_RESPONSE_HANDOFF_PATH,
      scratchRootDir: process.env.MURPH_AGE_R1185_SCRATCH_ROOT_DIR,
    });
    process.stdout.write(`${JSON.stringify({
      conclusion: output.summary.conclusion,
      liveR1184Conclusion: output.summary.liveR1184Conclusion,
      liveR1184ReadyForSyntheticSmoke: output.summary.liveR1184ReadyForSyntheticSmoke,
      nextRealAction: output.summary.nextRealAction,
      nextRealActionCommand: output.summary.nextRealActionCommand,
      nextRealActionRequiresExplicitRowOwnerAssertion:
        output.summary.nextRealActionRequiresExplicitRowOwnerAssertion,
      packetId: output.packetId,
      schemaVersion: output.schemaVersion,
      syntheticPathAdvancedToFeatureOnlyResearchPlanning:
        output.summary.syntheticPathAdvancedToFeatureOnlyResearchPlanning,
      syntheticSmokeRan: output.summary.syntheticSmokeRan,
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${safeCliErrorMessage(error, "R1185 safe response smoke proof failed.")}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
