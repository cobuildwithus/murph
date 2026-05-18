import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_COMMAND,
  R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_SCHEMA_VERSION,
  R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION,
} from "./r1180-average-submitter-safe-confirmation-response-intake.ts";
import {
  R1181_AVERAGE_SUBMITTER_FEATURE_ONLY_EXECUTION_CONTRACT_COMMAND,
  R1181_AVERAGE_SUBMITTER_FEATURE_ONLY_EXECUTION_CONTRACT_SCHEMA_VERSION,
} from "./r1181-average-submitter-feature-only-execution-contract.ts";
import {
  R1182_AVERAGE_SUBMITTER_SAFE_RESPONSE_HANDOFF_COMMAND,
  R1182_AVERAGE_SUBMITTER_SAFE_RESPONSE_HANDOFF_SCHEMA_VERSION,
} from "./r1182-average-submitter-safe-response-handoff.ts";
import {
  R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND,
  R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_SCHEMA_VERSION,
} from "./r1183-average-submitter-safe-response-materializer.ts";

export const R1184_AVERAGE_SUBMITTER_SAFE_RESPONSE_CHAIN_STATUS_SCHEMA_VERSION =
  "murph-age-r1184-average-submitter-safe-response-chain-status.v1" as const;
export const R1184_AVERAGE_SUBMITTER_SAFE_RESPONSE_CHAIN_STATUS_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1184-average-submitter-safe-response-chain-status.ts" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1184-average-submitter-safe-response-chain-status.latest.json" as const;
const R1180_ARTIFACT = "r1180-average-submitter-safe-confirmation-response-intake.latest.json" as const;
const R1181_ARTIFACT = "r1181-average-submitter-feature-only-execution-contract.latest.json" as const;
const R1182_ARTIFACT = "r1182-average-submitter-safe-response-handoff.latest.json" as const;
const R1183_ARTIFACT = "r1183-average-submitter-safe-response-materializer.latest.json" as const;
const FILLABLE_RESPONSE_FILE_NAME = "r1183-fillable-average-submitter-safe-confirmation-response.json" as const;
const CONFIRMED_RESPONSE_FILE_NAME = "r1183-confirmed-average-submitter-safe-confirmation-response.json" as const;
const R1180_PACKET_ID = "r1180-average-submitter-safe-confirmation-response-intake" as const;
const R1181_PACKET_ID = "r1181-average-submitter-feature-only-execution-contract" as const;
const R1182_PACKET_ID = "r1182-average-submitter-safe-response-handoff" as const;
const R1183_PACKET_ID = "r1183-average-submitter-safe-response-materializer" as const;
const R1184_PACKET_ID = "r1184-average-submitter-safe-response-chain-status" as const;
const R1184_R1180_CONFIRMED_RESPONSE_INTAKE_COMMAND =
  `MURPH_AGE_R1180_SAFE_CONFIRMATION_RESPONSE_PATH=<${CONFIRMED_RESPONSE_FILE_NAME}> ${R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_COMMAND}` as const;
const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first" as const;
const TARGET_AGE_BAND = "roughly_16_50" as const;
const ROW_OWNER_SAFE_CONFIRMATION_ASK_ID =
  "confirm_feature_only_lab_wearable_availability_without_private_values" as const;
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
const R1180_CONCLUSION_IDS = [
  "safe_confirmation_response_intake_ready_feature_only",
  "safe_confirmation_response_intake_waiting_on_response",
  "safe_confirmation_response_intake_waiting_on_r1179_ask",
  "safe_confirmation_response_intake_rejected_response_shape",
] as const;
const R1180_NEXT_ACTION_IDS = [
  "fill_safe_confirmation_response_template",
  "refresh_r1179_safe_confirmation_ask",
  "rerun_safe_confirmation_response_with_valid_json_object",
  "carry_safe_confirmation_to_feature_only_chain",
  "none",
] as const;
const R1180_RESPONSE_STATUS_IDS = [
  "incomplete",
  "invalid",
  "missing",
  "ready",
] as const;
const R1181_CONCLUSION_IDS = [
  "average_submitter_feature_only_execution_contract_ready_research_only",
  "average_submitter_feature_only_execution_contract_waiting_on_r1180",
  "average_submitter_feature_only_execution_contract_waiting_on_safe_confirmation",
  "average_submitter_feature_only_execution_contract_rejected_r1180_response_shape",
] as const;
const R1181_NEXT_ACTION_IDS = [
  "fill_r1180_safe_confirmation_response_template",
  "refresh_r1180_safe_confirmation_response_intake",
  "rerun_r1180_with_valid_safe_confirmation_response",
  "use_feature_only_execution_contract_for_research_planning_only",
  "none",
] as const;
const R1182_CONCLUSION_IDS = [
  "average_submitter_safe_response_handoff_ready_for_research_planning_only",
  "average_submitter_safe_response_handoff_waiting_on_row_owner_confirmation",
  "average_submitter_safe_response_handoff_waiting_on_r1181_refresh",
  "average_submitter_safe_response_handoff_rejected_r1180_response_shape",
] as const;
const R1182_NEXT_ACTION_IDS = [
  "fill_r1180_safe_confirmation_response_template",
  "refresh_r1181_feature_only_execution_contract",
  "rerun_r1180_with_valid_safe_confirmation_response",
  "use_r1181_feature_only_execution_contract_for_research_planning_only",
  "none",
] as const;
const R1183_CONCLUSION_IDS = [
  "average_submitter_safe_response_materializer_confirmed_response_written",
  "average_submitter_safe_response_materializer_ready_for_explicit_confirmation",
  "average_submitter_safe_response_materializer_waiting_on_r1182_handoff",
] as const;
const R1183_NEXT_ACTION_IDS = [
  "refresh_r1182_safe_response_handoff",
  "rerun_r1183_with_row_owner_safe_response_assertion",
  "run_r1180_with_confirmed_average_submitter_safe_response",
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

type ArrayValue<T extends readonly string[]> = T[number];
type MinimumFeaturePairSourceFamilyId = ArrayValue<typeof MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS>;
type PrioritizedInputKindId = ArrayValue<typeof PRIORITIZED_INPUT_KIND_IDS>;
type RequiredResponseFieldId = ArrayValue<typeof REQUIRED_RESPONSE_FIELD_IDS>;
type SafeExecutionFeatureSlotId = ArrayValue<typeof SAFE_EXECUTION_FEATURE_SLOT_IDS>;
type R1180Conclusion = ArrayValue<typeof R1180_CONCLUSION_IDS>;
type R1180NextActionId = ArrayValue<typeof R1180_NEXT_ACTION_IDS>;
type R1180ResponseStatus = ArrayValue<typeof R1180_RESPONSE_STATUS_IDS>;
type R1181Conclusion = ArrayValue<typeof R1181_CONCLUSION_IDS>;
type R1181NextActionId = ArrayValue<typeof R1181_NEXT_ACTION_IDS>;
type R1182Conclusion = ArrayValue<typeof R1182_CONCLUSION_IDS>;
type R1182NextActionId = ArrayValue<typeof R1182_NEXT_ACTION_IDS>;
type R1183Conclusion = ArrayValue<typeof R1183_CONCLUSION_IDS>;
type R1183NextActionId = ArrayValue<typeof R1183_NEXT_ACTION_IDS>;
type R1184NextActionId = ArrayValue<typeof R1184_NEXT_ACTION_IDS>;

type ChainConclusion =
  | "average_submitter_safe_response_chain_ready_for_feature_only_research_planning"
  | "average_submitter_safe_response_chain_waiting_on_r1180_confirmed_response_intake"
  | "average_submitter_safe_response_chain_waiting_on_r1180_response"
  | "average_submitter_safe_response_chain_waiting_on_r1181_feature_contract"
  | "average_submitter_safe_response_chain_waiting_on_r1182_handoff"
  | "average_submitter_safe_response_chain_waiting_on_r1183_refresh"
  | "average_submitter_safe_response_chain_waiting_on_row_owner_confirmation";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface SafeResponseArtifactSummary {
  artifact: typeof FILLABLE_RESPONSE_FILE_NAME | typeof CONFIRMED_RESPONSE_FILE_NAME;
  responseKind: "explicit_yes_all_required_assertions_confirmed" | null;
  schemaVersion: typeof R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION | null;
  status: "available" | "missing";
  validSafeResponseShape: boolean;
}

interface R1180State {
  artifactBoundaryAggregateOnly: boolean | null;
  artifactBoundaryUnsafeTrueFlagFound: boolean;
  conclusion: R1180Conclusion | null;
  explicitRowOwnerSafeConfirmationProvided: boolean | null;
  featureOnlySafeConfirmationReady: boolean | null;
  inputArtifactAvailable: boolean;
  minimumPairMatches: boolean;
  modelEvidencePromotionAllowed: boolean | null;
  nextAction: R1180NextActionId | null;
  packetId: typeof R1180_PACKET_ID | null;
  prioritizedInputKindsMatch: boolean;
  productDisplayAuthorized: boolean | null;
  requiredResponseFieldsMatch: boolean;
  responseStatus: R1180ResponseStatus | null;
  reviewGptRequiredNow: boolean | null;
  rowLevelDataAcceptedByR1180: boolean | null;
  rowOwnerConfirmationInferredByR1180: boolean | null;
  rowOwnerPrivateValuesStored: boolean | null;
  rowOwnerProvidedPrivateValuesStored: boolean | null;
  rowOwnerProvidedSafeBooleansStored: boolean | null;
  rowParsingPerformedByR1180: boolean | null;
  schemaCurrent: boolean;
  sourcePriorityMatches: boolean;
  status: "research-local-aggregate-only" | null;
  targetAgeBandMatches: boolean;
}

interface R1181State {
  artifactBoundaryAggregateOnly: boolean | null;
  artifactBoundaryUnsafeTrueFlagFound: boolean;
  conclusion: R1181Conclusion | null;
  explicitRowOwnerSafeConfirmationProvided: boolean | null;
  featureOnlyExecutionContractReady: boolean | null;
  featureOnlySafeConfirmationReady: boolean | null;
  inputArtifactAvailable: boolean;
  modelEvidencePromotionAllowed: boolean | null;
  nextAction: R1181NextActionId | null;
  packetId: typeof R1181_PACKET_ID | null;
  productDisplayAuthorized: boolean | null;
  researchPlanningAllowed: boolean | null;
  reviewGptRequiredNow: boolean | null;
  rowLevelDataAcceptedByR1181: boolean | null;
  rowOwnerConfirmationInferredByR1181: boolean | null;
  rowOwnerPrivateValuesStored: boolean | null;
  rowParsingPerformedByR1181: boolean | null;
  safeExecutionFeatureSlotIds: SafeExecutionFeatureSlotId[] | null;
  schemaCurrent: boolean;
  sourcePriorityMatches: boolean;
  status: "research-local-aggregate-only" | null;
  targetAgeBandMatches: boolean;
}

interface R1182State {
  artifactBoundaryAggregateOnly: boolean | null;
  artifactBoundaryUnsafeTrueFlagFound: boolean;
  conclusion: R1182Conclusion | null;
  explicitRowOwnerSafeConfirmationProvided: boolean | null;
  featureOnlyExecutionContractReady: boolean | null;
  handoffReadyForResearchPlanningOnly: boolean | null;
  inputArtifactAvailable: boolean;
  minimumPairMatches: boolean;
  modelEvidencePromotionAllowed: boolean | null;
  nextAction: R1182NextActionId | null;
  packetId: typeof R1182_PACKET_ID | null;
  productDisplayAuthorized: boolean | null;
  requiredResponseFieldsMatch: boolean;
  reviewGptRequiredNow: boolean | null;
  rowLevelDataAcceptedByR1182: boolean | null;
  rowOwnerConfirmationInferredByR1182: boolean | null;
  rowOwnerPrivateValuesStored: boolean | null;
  rowParsingPerformedByR1182: boolean | null;
  safeExecutionFeatureSlotIds: SafeExecutionFeatureSlotId[] | null;
  schemaCurrent: boolean;
  sourcePriorityMatches: boolean;
  status: "research-local-aggregate-only" | null;
  targetAgeBandMatches: boolean;
}

interface R1183State {
  artifactBoundaryAggregateOnly: boolean | null;
  artifactBoundaryUnsafeTrueFlagFound: boolean;
  conclusion: R1183Conclusion | null;
  confirmedResponseArtifact: typeof CONFIRMED_RESPONSE_FILE_NAME | null;
  confirmedResponseArtifactWritten: boolean | null;
  explicitRowOwnerSafeResponseAssertionProvided: boolean | null;
  fillableResponseArtifact: typeof FILLABLE_RESPONSE_FILE_NAME | null;
  fillableResponseArtifactWritten: boolean | null;
  inputArtifactAvailable: boolean;
  materializerReadyForRowOwnerConfirmation: boolean | null;
  minimumPairMatches: boolean;
  modelEvidencePromotionAllowed: boolean | null;
  nextAction: R1183NextActionId | null;
  packetId: typeof R1183_PACKET_ID | null;
  productDisplayAuthorized: boolean | null;
  requiredResponseFieldsMatch: boolean;
  responseSchemaVersion: typeof R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION | null;
  reviewGptRequiredNow: boolean | null;
  rowLevelDataAcceptedByR1183: boolean | null;
  rowOwnerConfirmationInferredByR1183: boolean | null;
  rowOwnerPrivateValuesStored: boolean | null;
  rowOwnerSafeResponseAssertionStillRequired: boolean | null;
  rowOwnerSafeResponseValuesStoredInR1183Packet: boolean | null;
  rowParsingPerformedByR1183: boolean | null;
  schemaCurrent: boolean;
  sourcePriorityMatches: boolean;
  status: "research-local-aggregate-only" | null;
  targetAgeBandMatches: boolean;
}

export interface R1184AverageSubmitterSafeResponseChainStatusOptions {
  confirmedResponsePath?: string;
  createdAt?: string;
  fillableResponsePath?: string;
  outputDir?: string;
  r1180Path?: string;
  r1181Path?: string;
  r1182Path?: string;
  r1183Path?: string;
}

export interface R1184AverageSubmitterSafeResponseChainStatusOutput {
  artifactBoundary: ReturnType<typeof safeBoundary>;
  chainStatus: R1184ChainStatus;
  createdAt: string;
  inputArtifacts: {
    r1180SafeConfirmationResponseIntake: ArtifactSummary;
    r1181FeatureOnlyExecutionContract: ArtifactSummary;
    r1182SafeResponseHandoff: ArtifactSummary;
    r1183SafeResponseMaterializer: ArtifactSummary;
    r1183ConfirmedSafeResponse: SafeResponseArtifactSummary;
    r1183FillableSafeResponse: SafeResponseArtifactSummary;
  };
  packetId: typeof R1184_PACKET_ID;
  productDisplayAuthorized: false;
  r1180State: R1180State;
  r1181State: R1181State;
  r1182State: R1182State;
  r1183State: R1183State;
  responseArtifactState: {
    confirmedResponseArtifactPresent: boolean;
    confirmedResponseArtifactReadyForR1180: boolean;
    fillableResponseArtifactPresent: boolean;
    staleConfirmedResponseArtifactDetected: boolean;
  };
  schemaVersion: typeof R1184_AVERAGE_SUBMITTER_SAFE_RESPONSE_CHAIN_STATUS_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: R1184ChainStatus;
}

interface R1184ChainStatus {
  confirmedResponseArtifact: typeof CONFIRMED_RESPONSE_FILE_NAME | null;
  confirmedResponseArtifactPresent: boolean;
  confirmedResponseArtifactReadyForR1180: boolean;
  conclusion: ChainConclusion;
  explicitRowOwnerSafeConfirmationProvided: boolean | null;
  featureOnlyExecutionContractReady: boolean | null;
  featureOnlySafeConfirmationReady: boolean | null;
  fillableResponseArtifact: typeof FILLABLE_RESPONSE_FILE_NAME | null;
  fillableResponseArtifactPresent: boolean;
  handoffReadyForResearchPlanningOnly: boolean | null;
  materializerReadyForRowOwnerConfirmation: boolean | null;
  minimumFeaturePairRequired: MinimumFeaturePairSourceFamilyId[];
  modelEvidencePromotionAllowed: false;
  nextAction: R1184NextActionId;
  nextActionCommand: string | null;
  nextActionInputArtifact: typeof CONFIRMED_RESPONSE_FILE_NAME | null;
  nextActionRequiresExplicitRowOwnerAssertion: boolean;
  prioritizedInputKindIds: PrioritizedInputKindId[];
  productDisplayAuthorized: false;
  requiredResponseFieldIds: RequiredResponseFieldId[];
  reviewGptRequiredNow: false;
  rowLevelDataAcceptedByR1184: false;
  rowOwnerConfirmationInferredByR1184: false;
  rowOwnerPrivateValuesStored: false;
  rowOwnerSafeResponseAssertionStillRequired: boolean | null;
  rowOwnerSafeResponseValuesStoredInR1184Packet: false;
  rowParsingPerformedByR1184: false;
  safeExecutionFeatureSlotIds: SafeExecutionFeatureSlotId[] | null;
  sourcePriority: typeof TARGET_INPUT_PRIORITY;
  staleConfirmedResponseArtifactDetected: boolean;
  targetAgeBand: typeof TARGET_AGE_BAND;
}

export async function runR1184AverageSubmitterSafeResponseChainStatus(
  options: R1184AverageSubmitterSafeResponseChainStatusOptions = {},
): Promise<{ output: R1184AverageSubmitterSafeResponseChainStatusOutput; outputPath: string }> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const [
    r1180,
    r1181,
    r1182,
    r1183,
    fillableResponse,
    confirmedResponse,
  ] = await Promise.all([
    readJsonIfPresent(options.r1180Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1180_ARTIFACT)),
    readJsonIfPresent(options.r1181Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1181_ARTIFACT)),
    readJsonIfPresent(options.r1182Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1182_ARTIFACT)),
    readJsonIfPresent(options.r1183Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1183_ARTIFACT)),
    readJsonIfPresent(options.fillableResponsePath ?? path.join(DEFAULT_MODEL_RUNS_DIR, FILLABLE_RESPONSE_FILE_NAME)),
    readJsonIfPresent(options.confirmedResponsePath ?? path.join(DEFAULT_MODEL_RUNS_DIR, CONFIRMED_RESPONSE_FILE_NAME)),
  ]);
  validateAggregateSafe("r1180 safe confirmation response intake", r1180);
  validateAggregateSafe("r1181 feature-only execution contract", r1181);
  validateAggregateSafe("r1182 safe response handoff", r1182);
  validateAggregateSafe("r1183 safe response materializer", r1183);
  validateAggregateSafe("r1183 fillable safe response", fillableResponse);
  validateAggregateSafe("r1183 confirmed safe response", confirmedResponse);

  const r1180State = stateFromR1180(r1180);
  const r1181State = stateFromR1181(r1181);
  const r1182State = stateFromR1182(r1182);
  const r1183State = stateFromR1183(r1183);
  rejectUnsafeInputBoundary({
    r1180State,
    r1181State,
    r1182State,
    r1183State,
  });

  const fillableResponseState = summarizeResponseArtifact({
    artifact: FILLABLE_RESPONSE_FILE_NAME,
    value: fillableResponse,
    expectedConfirmed: false,
  });
  const confirmedResponseState = summarizeResponseArtifact({
    artifact: CONFIRMED_RESPONSE_FILE_NAME,
    value: confirmedResponse,
    expectedConfirmed: true,
  });
  const r1183ConfirmsCurrentConfirmedArtifact = r1183ConfirmedResponseWritten(r1183State)
    && confirmedResponseState.validSafeResponseShape;
  const staleConfirmedResponseArtifactDetected =
    confirmedResponseState.status === "available" && !r1183ConfirmsCurrentConfirmedArtifact;
  const confirmedResponseArtifactReadyForR1180 = r1183ConfirmsCurrentConfirmedArtifact;
  const chainStatus = chainStatusFor({
    confirmedResponseArtifactReadyForR1180,
    confirmedResponseState,
    fillableResponseState,
    r1180State,
    r1181State,
    r1182State,
    r1183State,
    staleConfirmedResponseArtifactDetected,
  });

  const output: R1184AverageSubmitterSafeResponseChainStatusOutput = {
    artifactBoundary: safeBoundary(),
    chainStatus,
    createdAt: createdAtFor(options.createdAt),
    inputArtifacts: {
      r1180SafeConfirmationResponseIntake: summarizeArtifact(
        r1180,
        R1180_ARTIFACT,
        R1180_PACKET_ID,
        R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_SCHEMA_VERSION,
      ),
      r1181FeatureOnlyExecutionContract: summarizeArtifact(
        r1181,
        R1181_ARTIFACT,
        R1181_PACKET_ID,
        R1181_AVERAGE_SUBMITTER_FEATURE_ONLY_EXECUTION_CONTRACT_SCHEMA_VERSION,
      ),
      r1182SafeResponseHandoff: summarizeArtifact(
        r1182,
        R1182_ARTIFACT,
        R1182_PACKET_ID,
        R1182_AVERAGE_SUBMITTER_SAFE_RESPONSE_HANDOFF_SCHEMA_VERSION,
      ),
      r1183SafeResponseMaterializer: summarizeArtifact(
        r1183,
        R1183_ARTIFACT,
        R1183_PACKET_ID,
        R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_SCHEMA_VERSION,
      ),
      r1183ConfirmedSafeResponse: confirmedResponseState,
      r1183FillableSafeResponse: fillableResponseState,
    },
    packetId: R1184_PACKET_ID,
    productDisplayAuthorized: false,
    r1180State,
    r1181State,
    r1182State,
    r1183State,
    responseArtifactState: {
      confirmedResponseArtifactPresent: confirmedResponseState.status === "available",
      confirmedResponseArtifactReadyForR1180,
      fillableResponseArtifactPresent: fillableResponseState.status === "available",
      staleConfirmedResponseArtifactDetected,
    },
    schemaVersion: R1184_AVERAGE_SUBMITTER_SAFE_RESPONSE_CHAIN_STATUS_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: chainStatus,
  };

  ensureNoOutputPathInOutput(output, outputDir);
  validateAggregateSafe("r1184 safe response chain status", output);
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function chainStatusFor(state: {
  confirmedResponseArtifactReadyForR1180: boolean;
  confirmedResponseState: SafeResponseArtifactSummary;
  fillableResponseState: SafeResponseArtifactSummary;
  r1180State: R1180State;
  r1181State: R1181State;
  r1182State: R1182State;
  r1183State: R1183State;
  staleConfirmedResponseArtifactDetected: boolean;
}): R1184ChainStatus {
  const transition = nextTransitionFor(state);
  return {
    confirmedResponseArtifact: state.confirmedResponseState.status === "available"
      ? CONFIRMED_RESPONSE_FILE_NAME
      : null,
    confirmedResponseArtifactPresent: state.confirmedResponseState.status === "available",
    confirmedResponseArtifactReadyForR1180: state.confirmedResponseArtifactReadyForR1180,
    conclusion: transition.conclusion,
    explicitRowOwnerSafeConfirmationProvided: state.r1180State.explicitRowOwnerSafeConfirmationProvided,
    featureOnlyExecutionContractReady: state.r1181State.featureOnlyExecutionContractReady,
    featureOnlySafeConfirmationReady: state.r1180State.featureOnlySafeConfirmationReady,
    fillableResponseArtifact: state.fillableResponseState.status === "available"
      ? FILLABLE_RESPONSE_FILE_NAME
      : null,
    fillableResponseArtifactPresent: state.fillableResponseState.status === "available",
    handoffReadyForResearchPlanningOnly: state.r1182State.handoffReadyForResearchPlanningOnly,
    materializerReadyForRowOwnerConfirmation: state.r1183State.materializerReadyForRowOwnerConfirmation,
    minimumFeaturePairRequired: [...MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS],
    modelEvidencePromotionAllowed: false,
    nextAction: transition.nextAction,
    nextActionCommand: commandForNextAction(transition.nextAction),
    nextActionInputArtifact: transition.nextAction === "run_r1180_with_r1183_confirmed_safe_response_artifact"
      ? CONFIRMED_RESPONSE_FILE_NAME
      : null,
    nextActionRequiresExplicitRowOwnerAssertion:
      transition.nextAction === "rerun_r1183_with_row_owner_safe_response_assertion",
    prioritizedInputKindIds: [...PRIORITIZED_INPUT_KIND_IDS],
    productDisplayAuthorized: false,
    requiredResponseFieldIds: [...REQUIRED_RESPONSE_FIELD_IDS],
    reviewGptRequiredNow: false,
    rowLevelDataAcceptedByR1184: false,
    rowOwnerConfirmationInferredByR1184: false,
    rowOwnerPrivateValuesStored: false,
    rowOwnerSafeResponseAssertionStillRequired: state.r1183State.rowOwnerSafeResponseAssertionStillRequired,
    rowOwnerSafeResponseValuesStoredInR1184Packet: false,
    rowParsingPerformedByR1184: false,
    safeExecutionFeatureSlotIds: r1181ReadyForResearchPlanning(state.r1181State)
      ? state.r1181State.safeExecutionFeatureSlotIds
      : null,
    sourcePriority: TARGET_INPUT_PRIORITY,
    staleConfirmedResponseArtifactDetected: state.staleConfirmedResponseArtifactDetected,
    targetAgeBand: TARGET_AGE_BAND,
  };
}

function nextTransitionFor(state: {
  confirmedResponseArtifactReadyForR1180: boolean;
  confirmedResponseState: SafeResponseArtifactSummary;
  r1180State: R1180State;
  r1181State: R1181State;
  r1182State: R1182State;
  r1183State: R1183State;
  staleConfirmedResponseArtifactDetected: boolean;
}): { conclusion: ChainConclusion; nextAction: R1184NextActionId } {
  if (state.staleConfirmedResponseArtifactDetected) {
    return {
      conclusion: "average_submitter_safe_response_chain_waiting_on_r1183_refresh",
      nextAction: "refresh_r1183_safe_response_materializer",
    };
  }
  if (
    r1180ReadyForFeatureOnly(state.r1180State)
    && r1181ReadyForResearchPlanning(state.r1181State)
    && r1182ReadyForResearchPlanning(state.r1182State)
  ) {
    return {
      conclusion: "average_submitter_safe_response_chain_ready_for_feature_only_research_planning",
      nextAction: "use_r1181_feature_only_execution_contract_for_research_planning_only",
    };
  }
  if (r1180ReadyForFeatureOnly(state.r1180State) && !r1181ReadyForResearchPlanning(state.r1181State)) {
    return {
      conclusion: "average_submitter_safe_response_chain_waiting_on_r1181_feature_contract",
      nextAction: "run_r1181_feature_only_execution_contract",
    };
  }
  if (
    r1183ConfirmedResponseWritten(state.r1183State)
    && state.confirmedResponseArtifactReadyForR1180
    && !r1180ReadyForFeatureOnly(state.r1180State)
  ) {
    return {
      conclusion: "average_submitter_safe_response_chain_waiting_on_r1180_confirmed_response_intake",
      nextAction: "run_r1180_with_r1183_confirmed_safe_response_artifact",
    };
  }
  if (r1183ReadyForExplicitConfirmation(state.r1183State)) {
    return {
      conclusion: "average_submitter_safe_response_chain_waiting_on_row_owner_confirmation",
      nextAction: "rerun_r1183_with_row_owner_safe_response_assertion",
    };
  }
  if (r1182WaitingOnRowOwnerConfirmation(state.r1182State)) {
    return {
      conclusion: "average_submitter_safe_response_chain_waiting_on_r1183_refresh",
      nextAction: "refresh_r1183_safe_response_materializer",
    };
  }
  if (state.r1182State.inputArtifactAvailable || state.r1181State.inputArtifactAvailable) {
    return {
      conclusion: "average_submitter_safe_response_chain_waiting_on_r1182_handoff",
      nextAction: "refresh_r1182_safe_response_handoff",
    };
  }
  if (state.r1180State.inputArtifactAvailable) {
    return {
      conclusion: "average_submitter_safe_response_chain_waiting_on_r1181_feature_contract",
      nextAction: "refresh_r1181_feature_only_execution_contract",
    };
  }
  return {
    conclusion: "average_submitter_safe_response_chain_waiting_on_r1180_response",
    nextAction: "fill_r1180_safe_confirmation_response_template",
  };
}

function commandForNextAction(nextAction: R1184NextActionId): string | null {
  if (nextAction === "fill_r1180_safe_confirmation_response_template") {
    return R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_COMMAND;
  }
  if (nextAction === "refresh_r1181_feature_only_execution_contract") {
    return R1181_AVERAGE_SUBMITTER_FEATURE_ONLY_EXECUTION_CONTRACT_COMMAND;
  }
  if (nextAction === "refresh_r1182_safe_response_handoff") {
    return R1182_AVERAGE_SUBMITTER_SAFE_RESPONSE_HANDOFF_COMMAND;
  }
  if (nextAction === "refresh_r1183_safe_response_materializer") {
    return R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND;
  }
  if (nextAction === "rerun_r1183_with_row_owner_safe_response_assertion") {
    return R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_COMMAND;
  }
  if (nextAction === "run_r1180_with_r1183_confirmed_safe_response_artifact") {
    return R1184_R1180_CONFIRMED_RESPONSE_INTAKE_COMMAND;
  }
  if (nextAction === "run_r1181_feature_only_execution_contract") {
    return R1181_AVERAGE_SUBMITTER_FEATURE_ONLY_EXECUTION_CONTRACT_COMMAND;
  }
  if (nextAction === "use_r1181_feature_only_execution_contract_for_research_planning_only") {
    return null;
  }
  return null;
}

function stateFromR1180(value: unknown | null): R1180State {
  return {
    artifactBoundaryAggregateOnly: readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]),
    artifactBoundaryUnsafeTrueFlagFound: hasUnsafeTrueBoundaryFlag(value),
    conclusion: readStringInSetAt(value, ["summary", "conclusion"], R1180_CONCLUSION_IDS),
    explicitRowOwnerSafeConfirmationProvided: readBooleanAt(value, [
      "summary",
      "explicitRowOwnerSafeConfirmationProvided",
    ]),
    featureOnlySafeConfirmationReady: readBooleanAt(value, ["summary", "featureOnlySafeConfirmationReady"]),
    inputArtifactAvailable: value !== null,
    minimumPairMatches: exactStringSet(
      readStringArrayInSetAt(value, ["summary", "minimumFeaturePairRequired"], MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS),
      MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS,
    ),
    modelEvidencePromotionAllowed: readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]),
    nextAction: readStringInSetAt(value, ["summary", "nextAction"], R1180_NEXT_ACTION_IDS),
    packetId: readStringAt(value, ["packetId"]) === R1180_PACKET_ID ? R1180_PACKET_ID : null,
    prioritizedInputKindsMatch: exactStringSet(
      readStringArrayInSetAt(value, ["summary", "prioritizedInputKindIds"], PRIORITIZED_INPUT_KIND_IDS),
      PRIORITIZED_INPUT_KIND_IDS,
    ),
    productDisplayAuthorized: value === null ? false : readBooleanAt(value, ["summary", "productDisplayAuthorized"]),
    requiredResponseFieldsMatch: exactStringSet(
      readStringArrayInSetAt(value, ["summary", "requiredResponseFieldIds"], REQUIRED_RESPONSE_FIELD_IDS),
      REQUIRED_RESPONSE_FIELD_IDS,
    ),
    responseStatus: readStringInSetAt(value, ["summary", "responseStatus"], R1180_RESPONSE_STATUS_IDS),
    reviewGptRequiredNow: readBooleanAt(value, ["summary", "reviewGptRequiredNow"]),
    rowLevelDataAcceptedByR1180: readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1180"]),
    rowOwnerConfirmationInferredByR1180: readBooleanAt(value, ["summary", "rowOwnerConfirmationInferredByR1180"]),
    rowOwnerPrivateValuesStored: readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]),
    rowOwnerProvidedPrivateValuesStored: readBooleanAt(value, [
      "summary",
      "rowOwnerProvidedPrivateValuesStored",
    ]),
    rowOwnerProvidedSafeBooleansStored: readBooleanAt(value, [
      "summary",
      "rowOwnerProvidedSafeBooleansStored",
    ]),
    rowParsingPerformedByR1180: readBooleanAt(value, ["summary", "rowParsingPerformedByR1180"]),
    schemaCurrent: readStringAt(value, ["schemaVersion"])
      === R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_INTAKE_SCHEMA_VERSION,
    sourcePriorityMatches: readStringAt(value, ["summary", "sourcePriority"]) === TARGET_INPUT_PRIORITY,
    status: readStringAt(value, ["status"]) === "research-local-aggregate-only"
      ? "research-local-aggregate-only"
      : null,
    targetAgeBandMatches: readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND,
  };
}

function stateFromR1181(value: unknown | null): R1181State {
  return {
    artifactBoundaryAggregateOnly: readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]),
    artifactBoundaryUnsafeTrueFlagFound: hasUnsafeTrueBoundaryFlag(value),
    conclusion: readStringInSetAt(value, ["summary", "conclusion"], R1181_CONCLUSION_IDS),
    explicitRowOwnerSafeConfirmationProvided: readBooleanAt(value, [
      "summary",
      "explicitRowOwnerSafeConfirmationProvided",
    ]),
    featureOnlyExecutionContractReady: readBooleanAt(value, ["summary", "featureOnlyExecutionContractReady"]),
    featureOnlySafeConfirmationReady: readBooleanAt(value, ["summary", "featureOnlySafeConfirmationReady"]),
    inputArtifactAvailable: value !== null,
    modelEvidencePromotionAllowed: readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]),
    nextAction: readStringInSetAt(value, ["summary", "nextAction"], R1181_NEXT_ACTION_IDS),
    packetId: readStringAt(value, ["packetId"]) === R1181_PACKET_ID ? R1181_PACKET_ID : null,
    productDisplayAuthorized: value === null ? false : readBooleanAt(value, ["summary", "productDisplayAuthorized"]),
    researchPlanningAllowed: readBooleanAt(value, ["summary", "researchPlanningAllowed"]),
    reviewGptRequiredNow: readBooleanAt(value, ["summary", "reviewGptRequiredNow"]),
    rowLevelDataAcceptedByR1181: readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1181"]),
    rowOwnerConfirmationInferredByR1181: readBooleanAt(value, ["summary", "rowOwnerConfirmationInferredByR1181"]),
    rowOwnerPrivateValuesStored: readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]),
    rowParsingPerformedByR1181: readBooleanAt(value, ["summary", "rowParsingPerformedByR1181"]),
    safeExecutionFeatureSlotIds: readStringArrayInSetAt(
      value,
      ["summary", "safeExecutionFeatureSlotIds"],
      SAFE_EXECUTION_FEATURE_SLOT_IDS,
    ),
    schemaCurrent: readStringAt(value, ["schemaVersion"])
      === R1181_AVERAGE_SUBMITTER_FEATURE_ONLY_EXECUTION_CONTRACT_SCHEMA_VERSION,
    sourcePriorityMatches: readStringAt(value, ["summary", "sourcePriority"]) === TARGET_INPUT_PRIORITY,
    status: readStringAt(value, ["status"]) === "research-local-aggregate-only"
      ? "research-local-aggregate-only"
      : null,
    targetAgeBandMatches: readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND,
  };
}

function stateFromR1182(value: unknown | null): R1182State {
  return {
    artifactBoundaryAggregateOnly: readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]),
    artifactBoundaryUnsafeTrueFlagFound: hasUnsafeTrueBoundaryFlag(value),
    conclusion: readStringInSetAt(value, ["summary", "conclusion"], R1182_CONCLUSION_IDS),
    explicitRowOwnerSafeConfirmationProvided: readBooleanAt(value, [
      "summary",
      "explicitRowOwnerSafeConfirmationProvided",
    ]),
    featureOnlyExecutionContractReady: readBooleanAt(value, ["summary", "featureOnlyExecutionContractReady"]),
    handoffReadyForResearchPlanningOnly: readBooleanAt(value, ["summary", "handoffReadyForResearchPlanningOnly"]),
    inputArtifactAvailable: value !== null,
    minimumPairMatches: exactStringSet(
      readStringArrayInSetAt(value, ["summary", "minimumFeaturePairRequired"], MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS),
      MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS,
    ),
    modelEvidencePromotionAllowed: readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]),
    nextAction: readStringInSetAt(value, ["summary", "nextAction"], R1182_NEXT_ACTION_IDS),
    packetId: readStringAt(value, ["packetId"]) === R1182_PACKET_ID ? R1182_PACKET_ID : null,
    productDisplayAuthorized: value === null ? false : readBooleanAt(value, ["summary", "productDisplayAuthorized"]),
    requiredResponseFieldsMatch: exactStringSet(
      readStringArrayInSetAt(value, ["summary", "requiredResponseFieldIds"], REQUIRED_RESPONSE_FIELD_IDS),
      REQUIRED_RESPONSE_FIELD_IDS,
    ),
    reviewGptRequiredNow: readBooleanAt(value, ["summary", "reviewGptRequiredNow"]),
    rowLevelDataAcceptedByR1182: readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1182"]),
    rowOwnerConfirmationInferredByR1182: readBooleanAt(value, ["summary", "rowOwnerConfirmationInferredByR1182"]),
    rowOwnerPrivateValuesStored: readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]),
    rowParsingPerformedByR1182: readBooleanAt(value, ["summary", "rowParsingPerformedByR1182"]),
    safeExecutionFeatureSlotIds: readStringArrayInSetAt(
      value,
      ["summary", "safeExecutionFeatureSlotIds"],
      SAFE_EXECUTION_FEATURE_SLOT_IDS,
    ),
    schemaCurrent: readStringAt(value, ["schemaVersion"])
      === R1182_AVERAGE_SUBMITTER_SAFE_RESPONSE_HANDOFF_SCHEMA_VERSION,
    sourcePriorityMatches: readStringAt(value, ["summary", "sourcePriority"]) === TARGET_INPUT_PRIORITY,
    status: readStringAt(value, ["status"]) === "research-local-aggregate-only"
      ? "research-local-aggregate-only"
      : null,
    targetAgeBandMatches: readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND,
  };
}

function stateFromR1183(value: unknown | null): R1183State {
  return {
    artifactBoundaryAggregateOnly: readBooleanAt(value, ["artifactBoundary", "aggregateOnly"]),
    artifactBoundaryUnsafeTrueFlagFound: hasUnsafeTrueBoundaryFlag(value),
    conclusion: readStringInSetAt(value, ["summary", "conclusion"], R1183_CONCLUSION_IDS),
    confirmedResponseArtifact: readStringAt(value, ["summary", "confirmedResponseArtifact"]) === CONFIRMED_RESPONSE_FILE_NAME
      ? CONFIRMED_RESPONSE_FILE_NAME
      : null,
    confirmedResponseArtifactWritten: readBooleanAt(value, ["summary", "confirmedResponseArtifactWritten"]),
    explicitRowOwnerSafeResponseAssertionProvided: readBooleanAt(value, [
      "summary",
      "explicitRowOwnerSafeResponseAssertionProvided",
    ]),
    fillableResponseArtifact: readStringAt(value, ["summary", "fillableResponseArtifact"]) === FILLABLE_RESPONSE_FILE_NAME
      ? FILLABLE_RESPONSE_FILE_NAME
      : null,
    fillableResponseArtifactWritten: readBooleanAt(value, ["summary", "fillableResponseArtifactWritten"]),
    inputArtifactAvailable: value !== null,
    materializerReadyForRowOwnerConfirmation: readBooleanAt(value, [
      "summary",
      "materializerReadyForRowOwnerConfirmation",
    ]),
    minimumPairMatches: exactStringSet(
      readStringArrayInSetAt(value, ["summary", "minimumFeaturePairRequired"], MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS),
      MINIMUM_FEATURE_PAIR_SOURCE_FAMILY_IDS,
    ),
    modelEvidencePromotionAllowed: readBooleanAt(value, ["summary", "modelEvidencePromotionAllowed"]),
    nextAction: readStringInSetAt(value, ["summary", "nextAction"], R1183_NEXT_ACTION_IDS),
    packetId: readStringAt(value, ["packetId"]) === R1183_PACKET_ID ? R1183_PACKET_ID : null,
    productDisplayAuthorized: value === null ? false : readBooleanAt(value, ["summary", "productDisplayAuthorized"]),
    requiredResponseFieldsMatch: exactStringSet(
      readStringArrayInSetAt(value, ["summary", "requiredResponseFieldIds"], REQUIRED_RESPONSE_FIELD_IDS),
      REQUIRED_RESPONSE_FIELD_IDS,
    ),
    responseSchemaVersion: readStringAt(value, ["summary", "responseSchemaVersion"])
      === R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION
      ? R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION
      : null,
    reviewGptRequiredNow: readBooleanAt(value, ["summary", "reviewGptRequiredNow"]),
    rowLevelDataAcceptedByR1183: readBooleanAt(value, ["summary", "rowLevelDataAcceptedByR1183"]),
    rowOwnerConfirmationInferredByR1183: readBooleanAt(value, ["summary", "rowOwnerConfirmationInferredByR1183"]),
    rowOwnerPrivateValuesStored: readBooleanAt(value, ["summary", "rowOwnerPrivateValuesStored"]),
    rowOwnerSafeResponseAssertionStillRequired: readBooleanAt(value, [
      "summary",
      "rowOwnerSafeResponseAssertionStillRequired",
    ]),
    rowOwnerSafeResponseValuesStoredInR1183Packet: readBooleanAt(value, [
      "summary",
      "rowOwnerSafeResponseValuesStoredInR1183Packet",
    ]),
    rowParsingPerformedByR1183: readBooleanAt(value, ["summary", "rowParsingPerformedByR1183"]),
    schemaCurrent: readStringAt(value, ["schemaVersion"])
      === R1183_AVERAGE_SUBMITTER_SAFE_RESPONSE_MATERIALIZER_SCHEMA_VERSION,
    sourcePriorityMatches: readStringAt(value, ["summary", "sourcePriority"]) === TARGET_INPUT_PRIORITY,
    status: readStringAt(value, ["status"]) === "research-local-aggregate-only"
      ? "research-local-aggregate-only"
      : null,
    targetAgeBandMatches: readStringAt(value, ["summary", "targetAgeBand"]) === TARGET_AGE_BAND,
  };
}

function r1180ReadyForFeatureOnly(state: R1180State): boolean {
  return state.inputArtifactAvailable
    && state.schemaCurrent
    && state.packetId === R1180_PACKET_ID
    && state.status === "research-local-aggregate-only"
    && state.artifactBoundaryAggregateOnly === true
    && !state.artifactBoundaryUnsafeTrueFlagFound
    && state.conclusion === "safe_confirmation_response_intake_ready_feature_only"
    && state.nextAction === "carry_safe_confirmation_to_feature_only_chain"
    && state.responseStatus === "ready"
    && state.explicitRowOwnerSafeConfirmationProvided === true
    && state.featureOnlySafeConfirmationReady === true
    && state.minimumPairMatches
    && state.modelEvidencePromotionAllowed === false
    && state.prioritizedInputKindsMatch
    && state.productDisplayAuthorized === false
    && state.requiredResponseFieldsMatch
    && state.reviewGptRequiredNow === false
    && state.rowLevelDataAcceptedByR1180 === false
    && state.rowOwnerConfirmationInferredByR1180 === false
    && state.rowOwnerPrivateValuesStored === false
    && state.rowOwnerProvidedPrivateValuesStored === false
    && state.rowOwnerProvidedSafeBooleansStored === false
    && state.rowParsingPerformedByR1180 === false
    && state.sourcePriorityMatches
    && state.targetAgeBandMatches;
}

function r1181ReadyForResearchPlanning(state: R1181State): boolean {
  return state.inputArtifactAvailable
    && state.schemaCurrent
    && state.packetId === R1181_PACKET_ID
    && state.status === "research-local-aggregate-only"
    && state.artifactBoundaryAggregateOnly === true
    && !state.artifactBoundaryUnsafeTrueFlagFound
    && state.conclusion === "average_submitter_feature_only_execution_contract_ready_research_only"
    && state.nextAction === "use_feature_only_execution_contract_for_research_planning_only"
    && state.explicitRowOwnerSafeConfirmationProvided === true
    && state.featureOnlyExecutionContractReady === true
    && state.featureOnlySafeConfirmationReady === true
    && state.modelEvidencePromotionAllowed === false
    && state.productDisplayAuthorized === false
    && state.researchPlanningAllowed === true
    && state.reviewGptRequiredNow === false
    && state.rowLevelDataAcceptedByR1181 === false
    && state.rowOwnerConfirmationInferredByR1181 === false
    && state.rowOwnerPrivateValuesStored === false
    && state.rowParsingPerformedByR1181 === false
    && exactStringSet(state.safeExecutionFeatureSlotIds, SAFE_EXECUTION_FEATURE_SLOT_IDS)
    && state.sourcePriorityMatches
    && state.targetAgeBandMatches;
}

function r1182ReadyForResearchPlanning(state: R1182State): boolean {
  return state.inputArtifactAvailable
    && state.schemaCurrent
    && state.packetId === R1182_PACKET_ID
    && state.status === "research-local-aggregate-only"
    && state.artifactBoundaryAggregateOnly === true
    && !state.artifactBoundaryUnsafeTrueFlagFound
    && state.conclusion === "average_submitter_safe_response_handoff_ready_for_research_planning_only"
    && state.nextAction === "use_r1181_feature_only_execution_contract_for_research_planning_only"
    && state.explicitRowOwnerSafeConfirmationProvided === true
    && state.featureOnlyExecutionContractReady === true
    && state.handoffReadyForResearchPlanningOnly === true
    && state.minimumPairMatches
    && state.modelEvidencePromotionAllowed === false
    && state.productDisplayAuthorized === false
    && state.requiredResponseFieldsMatch
    && state.reviewGptRequiredNow === false
    && state.rowLevelDataAcceptedByR1182 === false
    && state.rowOwnerConfirmationInferredByR1182 === false
    && state.rowOwnerPrivateValuesStored === false
    && state.rowParsingPerformedByR1182 === false
    && exactStringSet(state.safeExecutionFeatureSlotIds, SAFE_EXECUTION_FEATURE_SLOT_IDS)
    && state.sourcePriorityMatches
    && state.targetAgeBandMatches;
}

function r1182WaitingOnRowOwnerConfirmation(state: R1182State): boolean {
  return state.inputArtifactAvailable
    && state.schemaCurrent
    && state.packetId === R1182_PACKET_ID
    && state.status === "research-local-aggregate-only"
    && state.artifactBoundaryAggregateOnly === true
    && !state.artifactBoundaryUnsafeTrueFlagFound
    && state.conclusion === "average_submitter_safe_response_handoff_waiting_on_row_owner_confirmation"
    && state.nextAction === "fill_r1180_safe_confirmation_response_template"
    && state.explicitRowOwnerSafeConfirmationProvided === false
    && state.featureOnlyExecutionContractReady === false
    && state.handoffReadyForResearchPlanningOnly === false
    && state.minimumPairMatches
    && state.modelEvidencePromotionAllowed === false
    && state.productDisplayAuthorized === false
    && state.requiredResponseFieldsMatch
    && state.reviewGptRequiredNow === false
    && state.rowLevelDataAcceptedByR1182 === false
    && state.rowOwnerConfirmationInferredByR1182 === false
    && state.rowOwnerPrivateValuesStored === false
    && state.rowParsingPerformedByR1182 === false
    && state.sourcePriorityMatches
    && state.targetAgeBandMatches;
}

function r1183ReadyForExplicitConfirmation(state: R1183State): boolean {
  return state.inputArtifactAvailable
    && state.schemaCurrent
    && state.packetId === R1183_PACKET_ID
    && state.status === "research-local-aggregate-only"
    && state.artifactBoundaryAggregateOnly === true
    && !state.artifactBoundaryUnsafeTrueFlagFound
    && state.conclusion === "average_submitter_safe_response_materializer_ready_for_explicit_confirmation"
    && state.nextAction === "rerun_r1183_with_row_owner_safe_response_assertion"
    && state.confirmedResponseArtifact === null
    && state.confirmedResponseArtifactWritten === false
    && state.explicitRowOwnerSafeResponseAssertionProvided === false
    && state.fillableResponseArtifact === FILLABLE_RESPONSE_FILE_NAME
    && state.fillableResponseArtifactWritten === true
    && state.materializerReadyForRowOwnerConfirmation === true
    && state.minimumPairMatches
    && state.modelEvidencePromotionAllowed === false
    && state.productDisplayAuthorized === false
    && state.requiredResponseFieldsMatch
    && state.responseSchemaVersion === R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION
    && state.reviewGptRequiredNow === false
    && state.rowLevelDataAcceptedByR1183 === false
    && state.rowOwnerConfirmationInferredByR1183 === false
    && state.rowOwnerPrivateValuesStored === false
    && state.rowOwnerSafeResponseAssertionStillRequired === true
    && state.rowOwnerSafeResponseValuesStoredInR1183Packet === false
    && state.rowParsingPerformedByR1183 === false
    && state.sourcePriorityMatches
    && state.targetAgeBandMatches;
}

function r1183ConfirmedResponseWritten(state: R1183State): boolean {
  return state.inputArtifactAvailable
    && state.schemaCurrent
    && state.packetId === R1183_PACKET_ID
    && state.status === "research-local-aggregate-only"
    && state.artifactBoundaryAggregateOnly === true
    && !state.artifactBoundaryUnsafeTrueFlagFound
    && state.conclusion === "average_submitter_safe_response_materializer_confirmed_response_written"
    && state.nextAction === "run_r1180_with_confirmed_average_submitter_safe_response"
    && state.confirmedResponseArtifact === CONFIRMED_RESPONSE_FILE_NAME
    && state.confirmedResponseArtifactWritten === true
    && state.explicitRowOwnerSafeResponseAssertionProvided === true
    && state.fillableResponseArtifact === FILLABLE_RESPONSE_FILE_NAME
    && state.fillableResponseArtifactWritten === true
    && state.materializerReadyForRowOwnerConfirmation === true
    && state.minimumPairMatches
    && state.modelEvidencePromotionAllowed === false
    && state.productDisplayAuthorized === false
    && state.requiredResponseFieldsMatch
    && state.responseSchemaVersion === R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION
    && state.reviewGptRequiredNow === false
    && state.rowLevelDataAcceptedByR1183 === false
    && state.rowOwnerConfirmationInferredByR1183 === false
    && state.rowOwnerPrivateValuesStored === false
    && state.rowOwnerSafeResponseAssertionStillRequired === false
    && state.rowOwnerSafeResponseValuesStoredInR1183Packet === false
    && state.rowParsingPerformedByR1183 === false
    && state.sourcePriorityMatches
    && state.targetAgeBandMatches;
}

function summarizeResponseArtifact(state: {
  artifact: typeof FILLABLE_RESPONSE_FILE_NAME | typeof CONFIRMED_RESPONSE_FILE_NAME;
  expectedConfirmed: boolean;
  value: unknown | null;
}): SafeResponseArtifactSummary {
  const responseKind = readStringAt(state.value, ["responseKind"])
    === "explicit_yes_all_required_assertions_confirmed"
    ? "explicit_yes_all_required_assertions_confirmed"
    : null;
  const schemaVersion = readStringAt(state.value, ["schemaVersion"])
    === R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION
    ? R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION
    : null;
  return {
    artifact: state.artifact,
    responseKind,
    schemaVersion,
    status: state.value === null ? "missing" : "available",
    validSafeResponseShape: safeResponseArtifactMatches(state.value, state.expectedConfirmed),
  };
}

function safeResponseArtifactMatches(value: unknown | null, expectedConfirmed: boolean): boolean {
  return isPlainRecord(value)
    && exactKeySet(Object.keys(value), [
      "askId",
      "confirmDailyWearableActivityExportAvailable",
      "confirmGlycemiaBloodworkExportAvailable",
      "confirmNoPrivateValuesIncluded",
      "confirmTargetAgeBandRoughly16To50",
      "responseKind",
      "schemaVersion",
    ])
    && readStringAt(value, ["askId"]) === ROW_OWNER_SAFE_CONFIRMATION_ASK_ID
    && readStringAt(value, ["schemaVersion"]) === R1180_AVERAGE_SUBMITTER_SAFE_CONFIRMATION_RESPONSE_SCHEMA_VERSION
    && readStringAt(value, ["responseKind"]) === "explicit_yes_all_required_assertions_confirmed"
    && readBooleanAt(value, ["confirmDailyWearableActivityExportAvailable"]) === expectedConfirmed
    && readBooleanAt(value, ["confirmGlycemiaBloodworkExportAvailable"]) === expectedConfirmed
    && readBooleanAt(value, ["confirmNoPrivateValuesIncluded"]) === expectedConfirmed
    && readBooleanAt(value, ["confirmTargetAgeBandRoughly16To50"]) === expectedConfirmed;
}

function summarizeArtifact(
  value: unknown | null,
  artifact: string,
  packetId: string,
  schemaVersion: string,
): ArtifactSummary {
  return {
    artifact,
    packetId: readStringAt(value, ["packetId"]) === packetId ? packetId : null,
    schemaVersion: readStringAt(value, ["schemaVersion"]) === schemaVersion ? schemaVersion : null,
    status: value === null ? "missing" : "available",
  };
}

function rejectUnsafeInputBoundary(state: {
  r1180State: R1180State;
  r1181State: R1181State;
  r1182State: R1182State;
  r1183State: R1183State;
}): void {
  if (state.r1180State.artifactBoundaryUnsafeTrueFlagFound) {
    throw new Error("R1184 rejected unsafe r1180 safe confirmation response intake: 1 finding");
  }
  const r1180UnsafeGateFindings = countUnsafeR1180PrivacyGates(state.r1180State);
  if (r1180UnsafeGateFindings > 0) {
    throw new Error(`R1184 rejected unsafe r1180 safe confirmation response intake: ${r1180UnsafeGateFindings} ${r1180UnsafeGateFindings === 1 ? "finding" : "findings"}`);
  }
  if (state.r1181State.artifactBoundaryUnsafeTrueFlagFound) {
    throw new Error("R1184 rejected unsafe r1181 feature-only execution contract: 1 finding");
  }
  const r1181UnsafeGateFindings = countUnsafeR1181PrivacyGates(state.r1181State);
  if (r1181UnsafeGateFindings > 0) {
    throw new Error(`R1184 rejected unsafe r1181 feature-only execution contract: ${r1181UnsafeGateFindings} ${r1181UnsafeGateFindings === 1 ? "finding" : "findings"}`);
  }
  if (state.r1182State.artifactBoundaryUnsafeTrueFlagFound) {
    throw new Error("R1184 rejected unsafe r1182 safe response handoff: 1 finding");
  }
  const r1182UnsafeGateFindings = countUnsafeR1182PrivacyGates(state.r1182State);
  if (r1182UnsafeGateFindings > 0) {
    throw new Error(`R1184 rejected unsafe r1182 safe response handoff: ${r1182UnsafeGateFindings} ${r1182UnsafeGateFindings === 1 ? "finding" : "findings"}`);
  }
  if (state.r1183State.artifactBoundaryUnsafeTrueFlagFound) {
    throw new Error("R1184 rejected unsafe r1183 safe response materializer: 1 finding");
  }
  const r1183UnsafeGateFindings = countUnsafeR1183PrivacyGates(state.r1183State);
  if (r1183UnsafeGateFindings > 0) {
    throw new Error(`R1184 rejected unsafe r1183 safe response materializer: ${r1183UnsafeGateFindings} ${r1183UnsafeGateFindings === 1 ? "finding" : "findings"}`);
  }
}

function countUnsafeR1180PrivacyGates(state: R1180State): number {
  return countTrueBooleans([
    state.modelEvidencePromotionAllowed,
    state.productDisplayAuthorized,
    state.reviewGptRequiredNow,
    state.rowLevelDataAcceptedByR1180,
    state.rowOwnerConfirmationInferredByR1180,
    state.rowOwnerPrivateValuesStored,
    state.rowOwnerProvidedPrivateValuesStored,
    state.rowOwnerProvidedSafeBooleansStored,
    state.rowParsingPerformedByR1180,
  ]);
}

function countUnsafeR1181PrivacyGates(state: R1181State): number {
  return countTrueBooleans([
    state.modelEvidencePromotionAllowed,
    state.productDisplayAuthorized,
    state.reviewGptRequiredNow,
    state.rowLevelDataAcceptedByR1181,
    state.rowOwnerConfirmationInferredByR1181,
    state.rowOwnerPrivateValuesStored,
    state.rowParsingPerformedByR1181,
  ]);
}

function countUnsafeR1182PrivacyGates(state: R1182State): number {
  return countTrueBooleans([
    state.modelEvidencePromotionAllowed,
    state.productDisplayAuthorized,
    state.reviewGptRequiredNow,
    state.rowLevelDataAcceptedByR1182,
    state.rowOwnerConfirmationInferredByR1182,
    state.rowOwnerPrivateValuesStored,
    state.rowParsingPerformedByR1182,
  ]);
}

function countUnsafeR1183PrivacyGates(state: R1183State): number {
  return countTrueBooleans([
    state.modelEvidencePromotionAllowed,
    state.productDisplayAuthorized,
    state.reviewGptRequiredNow,
    state.rowLevelDataAcceptedByR1183,
    state.rowOwnerConfirmationInferredByR1183,
    state.rowOwnerPrivateValuesStored,
    state.rowOwnerSafeResponseValuesStoredInR1183Packet,
    state.rowParsingPerformedByR1183,
  ]);
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
    localPathsStored: false,
    modelEvidencePromotedByR1184: false,
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
    rowLevelDataAcceptedByR1184: false,
    rowOwnerConfirmationInferredByR1184: false,
    rowOwnerPrivateValuesStored: false,
    rowOwnerSafeResponseValuesStoredInR1184Packet: false,
    rowParsingPerformedByR1184: false,
    rowValuesStored: false,
    safeBooleanValuesStoredInR1184Packet: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
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
      throw new Error("R1184 input JSON parse failed.");
    }
    throw error;
  }
}

function validateAggregateSafe(label: string, value: unknown | null): void {
  if (value === null) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1184 rejected unsafe ${label}: ${findings.length} ${findings.length === 1 ? "finding" : "findings"}`);
  }
}

function ensureNoOutputPathInOutput(value: unknown, outputDir: string): void {
  const serialized = JSON.stringify(value);
  if (serialized.includes(outputDir) || serialized.includes(OUTPUT_FILE_NAME)) {
    throw new Error("R1184 output included an output path.");
  }
}

function createdAtFor(value: string | undefined): string {
  const createdAt = value ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new Error("R1184 rejected invalid createdAt timestamp.");
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

function readStringArrayAt(value: unknown, pathParts: readonly string[]): string[] | null {
  const found = readAt(value, pathParts);
  return Array.isArray(found) && found.every((item) => typeof item === "string") ? [...found] : null;
}

function readStringInSetAt<T extends readonly string[]>(
  value: unknown,
  pathParts: readonly string[],
  values: T,
): T[number] | null {
  const found = readStringAt(value, pathParts);
  return stringSetIncludes(values, found) ? found : null;
}

function readStringArrayInSetAt<T extends readonly string[]>(
  value: unknown,
  pathParts: readonly string[],
  values: T,
): T[number][] | null {
  const found = readStringArrayAt(value, pathParts);
  if (found === null) return null;
  const safeValues: T[number][] = [];
  for (const item of found) {
    if (!stringSetIncludes(values, item)) return null;
    safeValues.push(item);
  }
  return safeValues;
}

function exactStringSet(values: readonly string[] | null, expected: readonly string[]): boolean {
  return values !== null
    && values.length === expected.length
    && values.every((value) => expected.includes(value))
    && expected.every((value) => values.includes(value));
}

function exactKeySet(values: readonly string[], expected: readonly string[]): boolean {
  return values.length === expected.length
    && values.every((value) => expected.includes(value))
    && expected.every((value) => values.includes(value));
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
  return error.message === "R1184 input JSON parse failed."
    || error.message === "R1184 output included an output path."
    || error.message === "R1184 rejected invalid createdAt timestamp."
    || /^R1184 rejected unsafe (?:r1180 safe confirmation response intake|r1181 feature-only execution contract|r1182 safe response handoff|r1183 safe response materializer|r1183 fillable safe response|r1183 confirmed safe response|r1184 safe response chain status): \d+ findings?$/u
      .test(error.message);
}

async function main(): Promise<void> {
  try {
    const { output } = await runR1184AverageSubmitterSafeResponseChainStatus({
      confirmedResponsePath: process.env.MURPH_AGE_R1183_CONFIRMED_SAFE_RESPONSE_PATH,
      createdAt: process.env.MURPH_AGE_R1184_CREATED_AT,
      fillableResponsePath: process.env.MURPH_AGE_R1183_FILLABLE_SAFE_RESPONSE_PATH,
      outputDir: process.env.MURPH_AGE_R1184_OUTPUT_DIR,
      r1180Path: process.env.MURPH_AGE_R1180_SAFE_CONFIRMATION_RESPONSE_INTAKE_PATH,
      r1181Path: process.env.MURPH_AGE_R1181_FEATURE_ONLY_EXECUTION_CONTRACT_PATH,
      r1182Path: process.env.MURPH_AGE_R1182_SAFE_RESPONSE_HANDOFF_PATH,
      r1183Path: process.env.MURPH_AGE_R1183_SAFE_RESPONSE_MATERIALIZER_PATH,
    });
    process.stdout.write(`${JSON.stringify({
      conclusion: output.summary.conclusion,
      confirmedResponseArtifactPresent: output.summary.confirmedResponseArtifactPresent,
      confirmedResponseArtifactReadyForR1180: output.summary.confirmedResponseArtifactReadyForR1180,
      fillableResponseArtifactPresent: output.summary.fillableResponseArtifactPresent,
      nextAction: output.summary.nextAction,
      nextActionCommand: output.summary.nextActionCommand,
      nextActionInputArtifact: output.summary.nextActionInputArtifact,
      nextActionRequiresExplicitRowOwnerAssertion: output.summary.nextActionRequiresExplicitRowOwnerAssertion,
      packetId: output.packetId,
      r1180Conclusion: output.r1180State.conclusion,
      r1183Conclusion: output.r1183State.conclusion,
      schemaVersion: output.schemaVersion,
      staleConfirmedResponseArtifactDetected: output.summary.staleConfirmedResponseArtifactDetected,
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${safeCliErrorMessage(error, "R1184 safe response chain status failed.")}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
