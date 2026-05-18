import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1148_ORDINARY_CONSUMER_POST_CONFIRMATION_PRIVATE_CONFIG_INTAKE_SCHEMA_VERSION =
  "murph-age-r1148-ordinary-consumer-post-confirmation-private-config-intake.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1148-ordinary-consumer-post-confirmation-private-config-intake.latest.json";
const TARGET_INPUT_PRIORITY = "consumer_bloodwork_labs_wearables_16_50_first" as const;
const TARGET_AGE_BAND = "roughly_16_50" as const;
const PARTIAL_PRIVATE_RUNNER_CONFIG_SCHEMA_VERSION =
  "murph-age-ordinary-consumer-partial-private-runner-config.v1" as const;
const PARTIAL_AGGREGATE_METRICS_SCHEMA_VERSION =
  "murph-age-ordinary-consumer-partial-aggregate-metrics.v1" as const;
const PARTIAL_AGGREGATE_METRICS_EVALUATOR_ID =
  "ordinary_consumer_partial_route_aggregate_evaluator_v1" as const;
const R1142_PARTIAL_PRIVATE_CHAIN_RUNNER_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH=<availability-manifest.json> MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH=<partial-private-config.json> pnpm exec tsx scripts/murph-age/r1142-ordinary-consumer-partial-private-chain-runner.ts" as const;
const R1148_PRIVATE_CONFIG_INTAKE_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH=<partial-private-config.json> pnpm exec tsx scripts/murph-age/r1148-ordinary-consumer-post-confirmation-private-config-intake.ts" as const;
const EXPECTED_ROUTE_IDS = [
  "lab_glycemia_minimum_route",
  "wearable_activity_minimum_route",
] as const;
const REQUIRED_ATTESTATION_KEYS = [
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
const REQUIRED_FIELD_REF_KEYS = [
  "personJoinKey",
  "outcomeEvent",
  "labGlycemia",
  "wearableActivity",
] as const;
const REQUIRED_TABLE_REF_KEYS = [
  "primaryTableRef",
  "outcomeTableRef",
  "labTableRef",
  "wearableTableRef",
] as const;
const ACCEPTED_PRIVATE_TABLE_LAYOUTS = [
  "single_primary_table_fallback",
  "multi_table_or_explicit_refs",
] as const;
const R1147_EXPECTED = {
  artifact: "r1147-ordinary-consumer-post-confirmation-private-config-packet.latest.json",
  packetId: "r1147-ordinary-consumer-post-confirmation-private-config-packet",
  schemaVersion: "murph-age-r1147-ordinary-consumer-post-confirmation-private-config-packet.v1",
} as const;

type KnownRouteId = typeof EXPECTED_ROUTE_IDS[number];
type RequiredAttestationKey = typeof REQUIRED_ATTESTATION_KEYS[number];
type RequiredFieldRefKey = typeof REQUIRED_FIELD_REF_KEYS[number];
type RequiredTableRefKey = typeof REQUIRED_TABLE_REF_KEYS[number];
type SlotStatus = "complete" | "missing_or_invalid" | "not_provided";
type AttestationStatus = "complete" | "missing_or_false" | "not_provided";
type PrivateConfigStatus = "available" | "invalid_json_object" | "missing" | "parse_error" | "read_error";
type OrdinaryTableLayout = typeof ACCEPTED_PRIVATE_TABLE_LAYOUTS[number] | "incomplete" | "not_provided";
type SubmissionContextStatus =
  | "complete_non_evidence"
  | "complete_real_evidence"
  | "missing_or_invalid"
  | "not_provided";
type IntakeConclusion =
  | "post_confirmation_private_config_incomplete"
  | "post_confirmation_private_config_not_provided"
  | "post_confirmation_private_config_ready_for_r1142"
  | "post_confirmation_private_config_waiting_on_safe_availability_action_packet_refresh"
  | "post_confirmation_private_config_waiting_on_safe_availability_confirmation"
  | "post_confirmation_private_config_waiting_on_packet"
  | "post_confirmation_private_config_non_evidence_only";
type IntakeNextAction =
  | "complete_post_confirmation_private_runner_config_slots"
  | "fill_feature_only_coverage_context_template"
  | "fill_safe_availability_confirmation_from_template"
  | "provide_post_confirmation_private_runner_config"
  | "refresh_r1147_post_confirmation_private_config_packet"
  | "refresh_r1154_safe_availability_action_packet"
  | "rerun_safe_availability_confirmation_with_valid_json_object"
  | "run_r1144_recipe_readiness_chain_with_confirmed_availability"
  | "run_r1150_safe_availability_confirmation_intake"
  | "run_r1153_feature_only_chain_with_safe_availability"
  | "run_r1142_for_real_lab_wearable_route_metrics"
  | "use_synthetic_config_only_for_smoke_not_evidence";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface PartialPrivateRunnerConfigInput {
  aggregateMetricsTarget?: {
    evaluatorId?: unknown;
    schemaVersion?: unknown;
  };
  attestations?: Partial<Record<RequiredAttestationKey, unknown>>;
  privateFieldRefs?: Partial<Record<RequiredFieldRefKey, unknown>>;
  privateTableRefs?: Partial<Record<RequiredTableRefKey, unknown>>;
  routeRunOrder?: Array<{ routeId?: unknown }>;
  schemaVersion?: unknown;
  submissionContext?: {
    evidenceRole?: unknown;
  };
}

interface PrivateConfigReadResult {
  config: PartialPrivateRunnerConfigInput | null;
  status: PrivateConfigStatus;
}

export interface R1148OrdinaryConsumerPostConfirmationPrivateConfigIntakeOptions {
  configPath?: string;
  createdAt?: string;
  outputDir?: string;
  r1147Path?: string;
}

export interface R1148OrdinaryConsumerPostConfirmationPrivateConfigIntakeOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    configReadErrorStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    privateConfigPathStored: false;
    privateConfigValuesStored: false;
    privateFieldRefValuesStored: false;
    privateFieldRefsStored: false;
    privateTableRefValuesStored: false;
    privateTableRefsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1148: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: {
    r1147: ArtifactSummary;
  };
  packetId: "r1148-ordinary-consumer-post-confirmation-private-config-intake";
  postConfirmationPrivateConfigIntake: {
    aggregateMetricsTargetStatus: SlotStatus;
    attestationStatus: AttestationStatus;
    blockedConfigContent: string[];
    commands: {
      partialPrivateChainRunnerCommand: typeof R1142_PARTIAL_PRIVATE_CHAIN_RUNNER_COMMAND;
      postConfirmationPrivateConfigIntakeCommand: typeof R1148_PRIVATE_CONFIG_INTAKE_COMMAND;
    };
    configPathConfigured: boolean;
    evidenceRoleStatus: SubmissionContextStatus;
    expectedRouteIds: KnownRouteId[];
    missingAttestationKeys: RequiredAttestationKey[];
    missingRouteIds: KnownRouteId[];
    missingRunnerFieldRefKeys: RequiredFieldRefKey[];
    missingRunnerTableRefKeys: RequiredTableRefKey[];
    ordinaryTableLayout: OrdinaryTableLayout;
    packetReadyForConfigIntake: boolean;
    privateConfigStatus: PrivateConfigStatus;
    privateConfigSuppliedToIntake: boolean;
    privateDetailsStored: false;
    r1147Conclusion: string | null;
    r1147NextAction: string | null;
    readyForR1142: boolean;
    requestedRouteIds: KnownRouteId[];
    routeRunOrderStatus: SlotStatus;
    runnerConfigSchemaStatus: SlotStatus;
    runnerFieldRefsStatus: SlotStatus;
    runnerTableRefsStatus: SlotStatus;
    safeAvailabilityActionPacketConclusion: string | null;
    safeAvailabilityActionPacketFeatureOnlyCoverageContextReady: boolean | null;
    safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact: string | null;
    safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount: number | null;
    safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths: string[];
    safeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds: string[];
    safeAvailabilityActionPacketMissingRequiredSourceFamilyIds: string[];
    safeAvailabilityActionPacketNextAction: string | null;
    safeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain: boolean | null;
    safeAvailabilityActionPacketRowLevelDataAcceptedByR1154: boolean | null;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
  productDisplayAuthorized: false;
  schemaVersion: typeof R1148_ORDINARY_CONSUMER_POST_CONFIRMATION_PRIVATE_CONFIG_INTAKE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: IntakeConclusion;
    evidenceRoleStatus: SubmissionContextStatus;
    expectedRouteIds: KnownRouteId[];
    missingAttestationKeys: RequiredAttestationKey[];
    missingRouteIds: KnownRouteId[];
    missingRunnerFieldRefKeys: RequiredFieldRefKey[];
    missingRunnerTableRefKeys: RequiredTableRefKey[];
    nextAction: IntakeNextAction;
    ordinaryTableLayout: OrdinaryTableLayout;
    packetReadyForConfigIntake: boolean;
    privateConfigStatus: PrivateConfigStatus;
    privateConfigSuppliedToIntake: boolean;
    productDisplayAuthorized: false;
    r1147Conclusion: string | null;
    r1147NextAction: string | null;
    readyForR1142: boolean;
    requestedRouteIds: KnownRouteId[];
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1148: false;
    safeAvailabilityActionPacketConclusion: string | null;
    safeAvailabilityActionPacketFeatureOnlyCoverageContextReady: boolean | null;
    safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact: string | null;
    safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount: number | null;
    safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths: string[];
    safeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds: string[];
    safeAvailabilityActionPacketMissingRequiredSourceFamilyIds: string[];
    safeAvailabilityActionPacketNextAction: string | null;
    safeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain: boolean | null;
    safeAvailabilityActionPacketRowLevelDataAcceptedByR1154: boolean | null;
    targetAgeBand: typeof TARGET_AGE_BAND;
    targetInputPriority: typeof TARGET_INPUT_PRIORITY;
  };
}

export async function runR1148OrdinaryConsumerPostConfirmationPrivateConfigIntake(
  options: R1148OrdinaryConsumerPostConfirmationPrivateConfigIntakeOptions = {},
): Promise<{ output: R1148OrdinaryConsumerPostConfirmationPrivateConfigIntakeOutput; outputPath: string }> {
  const r1147 = await readJsonIfPresent(options.r1147Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1147_EXPECTED.artifact));
  validateInputBoundary("r1147", r1147);
  const r1147Expected = r1147MatchesExpected(r1147);
  const r1147Conclusion = readStringAt(r1147, ["summary", "conclusion"]);
  const r1147NextAction = readStringAt(r1147, ["summary", "nextAction"]);
  const safeAvailabilityActionPacketNextAction = safeAvailabilityNextActionFor(
    readStringAt(r1147, ["summary", "safeAvailabilityActionPacketNextAction"]),
  );
  const packetReadyForConfigIntake = r1147Expected
    && readBooleanAt(r1147, ["summary", "privateConfigTemplateReadyForFill"]) === true;
  const expectedRouteIds = expectedRouteIdsFor(r1147);
  const requiredFieldRefKeys = requiredFieldRefKeysFor(r1147);
  const configuredPath = options.configPath
    ?? process.env.MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH
    ?? process.env.MURPH_AGE_ORDINARY_CONSUMER_POST_CONFIRMATION_PRIVATE_RUNNER_CONFIG_PATH;
  const configPathConfigured = Boolean(configuredPath?.trim());
  const configRead = await readPrivateConfig(configuredPath);
  const config = configRead.config;
  const requestedRouteIds = requestedRouteIdsFor(config);
  const missingRouteIds = expectedRouteIds.filter((routeId) => !requestedRouteIds.includes(routeId));
  const missingRunnerFieldRefKeys = config
    ? missingFieldRefKeysFor(config, requiredFieldRefKeys)
    : [...requiredFieldRefKeys];
  const ordinaryTableLayout = ordinaryTableLayoutFor(config);
  const missingRunnerTableRefKeys = missingTableRefKeysFor(config, ordinaryTableLayout);
  const missingAttestationKeys = config ? missingAttestationKeysFor(config) : [...REQUIRED_ATTESTATION_KEYS];
  const aggregateMetricsTargetStatus = aggregateMetricsTargetStatusFor(config);
  const attestationStatus = config
    ? missingAttestationKeys.length === 0
      ? "complete"
      : "missing_or_false"
    : "not_provided";
  const runnerConfigSchemaStatus = schemaStatusFor(config);
  const routeRunOrderStatus = config
    ? missingRouteIds.length === 0 && requestedRouteIds.length > 0
      ? "complete"
      : "missing_or_invalid"
    : "not_provided";
  const runnerFieldRefsStatus = config
    ? missingRunnerFieldRefKeys.length === 0
      ? "complete"
      : "missing_or_invalid"
    : "not_provided";
  const runnerTableRefsStatus = config
    ? tableLayoutComplete(ordinaryTableLayout)
      ? "complete"
      : "missing_or_invalid"
    : "not_provided";
  const evidenceRoleStatus = evidenceRoleStatusFor(config);
  const readyForR1142 = packetReadyForConfigIntake
    && configRead.status === "available"
    && aggregateMetricsTargetStatus === "complete"
    && attestationStatus === "complete"
    && evidenceRoleStatus === "complete_real_evidence"
    && routeRunOrderStatus === "complete"
    && runnerConfigSchemaStatus === "complete"
    && runnerFieldRefsStatus === "complete"
    && runnerTableRefsStatus === "complete";
  const conclusion = conclusionFor({
    configStatus: configRead.status,
    evidenceRoleStatus,
    packetReadyForConfigIntake,
    r1147Expected,
    readyForR1142,
    safeAvailabilityActionPacketNextAction,
  });
  const nextAction = nextActionFor(conclusion, safeAvailabilityActionPacketNextAction);
  const safeAvailabilityActionPacketConclusion = readStringAt(r1147, [
    "summary",
    "safeAvailabilityActionPacketConclusion",
  ]);
  const safeAvailabilityActionPacketFeatureOnlyCoverageContextReady = readBooleanAt(r1147, [
    "summary",
    "safeAvailabilityActionPacketFeatureOnlyCoverageContextReady",
  ]);
  const safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact = readStringAt(r1147, [
    "summary",
    "safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact",
  ]);
  const safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount = readNumberAt(r1147, [
    "summary",
    "safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount",
  ]);
  const safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths = readStringArrayAt(r1147, [
    "summary",
    "safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths",
  ]);
  const safeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds = readStringArrayAt(r1147, [
    "summary",
    "safeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds",
  ]);
  const safeAvailabilityActionPacketMissingRequiredSourceFamilyIds = readStringArrayAt(r1147, [
    "summary",
    "safeAvailabilityActionPacketMissingRequiredSourceFamilyIds",
  ]);
  const safeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain = readBooleanAt(r1147, [
    "summary",
    "safeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain",
  ]);
  const safeAvailabilityActionPacketRowLevelDataAcceptedByR1154 = readBooleanAt(r1147, [
    "summary",
    "safeAvailabilityActionPacketRowLevelDataAcceptedByR1154",
  ]);

  const output: R1148OrdinaryConsumerPostConfirmationPrivateConfigIntakeOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: {
      r1147: summarizeR1147(r1147),
    },
    packetId: "r1148-ordinary-consumer-post-confirmation-private-config-intake",
    postConfirmationPrivateConfigIntake: {
      aggregateMetricsTargetStatus,
      attestationStatus,
      blockedConfigContent: [
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
      ],
      commands: {
        partialPrivateChainRunnerCommand: R1142_PARTIAL_PRIVATE_CHAIN_RUNNER_COMMAND,
        postConfirmationPrivateConfigIntakeCommand: R1148_PRIVATE_CONFIG_INTAKE_COMMAND,
      },
      configPathConfigured,
      evidenceRoleStatus,
      expectedRouteIds,
      missingAttestationKeys,
      missingRouteIds,
      missingRunnerFieldRefKeys,
      missingRunnerTableRefKeys,
      ordinaryTableLayout,
      packetReadyForConfigIntake,
      privateConfigStatus: configRead.status,
      privateConfigSuppliedToIntake: configRead.status === "available",
      privateDetailsStored: false,
      r1147Conclusion,
      r1147NextAction,
      readyForR1142,
      requestedRouteIds,
      routeRunOrderStatus,
      runnerConfigSchemaStatus,
      runnerFieldRefsStatus,
      runnerTableRefsStatus,
      safeAvailabilityActionPacketConclusion,
      safeAvailabilityActionPacketFeatureOnlyCoverageContextReady,
      safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact,
      safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount,
      safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths,
      safeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds,
      safeAvailabilityActionPacketMissingRequiredSourceFamilyIds,
      safeAvailabilityActionPacketNextAction,
      safeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain,
      safeAvailabilityActionPacketRowLevelDataAcceptedByR1154,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
    productDisplayAuthorized: false,
    schemaVersion: R1148_ORDINARY_CONSUMER_POST_CONFIRMATION_PRIVATE_CONFIG_INTAKE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      evidenceRoleStatus,
      expectedRouteIds,
      missingAttestationKeys,
      missingRouteIds,
      missingRunnerFieldRefKeys,
      missingRunnerTableRefKeys,
      nextAction,
      ordinaryTableLayout,
      packetReadyForConfigIntake,
      privateConfigStatus: configRead.status,
      privateConfigSuppliedToIntake: configRead.status === "available",
      productDisplayAuthorized: false,
      r1147Conclusion,
      r1147NextAction,
      readyForR1142,
      requestedRouteIds,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1148: false,
      safeAvailabilityActionPacketConclusion,
      safeAvailabilityActionPacketFeatureOnlyCoverageContextReady,
      safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact,
      safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount,
      safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths,
      safeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds,
      safeAvailabilityActionPacketMissingRequiredSourceFamilyIds,
      safeAvailabilityActionPacketNextAction,
      safeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain,
      safeAvailabilityActionPacketRowLevelDataAcceptedByR1154,
      targetAgeBand: TARGET_AGE_BAND,
      targetInputPriority: TARGET_INPUT_PRIORITY,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1148 post-confirmation private config intake failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function conclusionFor(input: {
  configStatus: PrivateConfigStatus;
  evidenceRoleStatus: SubmissionContextStatus;
  packetReadyForConfigIntake: boolean;
  r1147Expected: boolean;
  readyForR1142: boolean;
  safeAvailabilityActionPacketNextAction: IntakeNextAction | null;
}): IntakeConclusion {
  if (!input.r1147Expected) return "post_confirmation_private_config_waiting_on_packet";
  if (!input.packetReadyForConfigIntake
    && input.safeAvailabilityActionPacketNextAction === "refresh_r1154_safe_availability_action_packet") {
    return "post_confirmation_private_config_waiting_on_safe_availability_action_packet_refresh";
  }
  if (!input.packetReadyForConfigIntake && input.safeAvailabilityActionPacketNextAction) {
    return "post_confirmation_private_config_waiting_on_safe_availability_confirmation";
  }
  if (!input.packetReadyForConfigIntake) return "post_confirmation_private_config_waiting_on_packet";
  if (input.configStatus !== "available") return "post_confirmation_private_config_not_provided";
  if (input.readyForR1142) return "post_confirmation_private_config_ready_for_r1142";
  if (input.evidenceRoleStatus === "complete_non_evidence") {
    return "post_confirmation_private_config_non_evidence_only";
  }
  return "post_confirmation_private_config_incomplete";
}

function nextActionFor(
  conclusion: IntakeConclusion,
  safeAvailabilityActionPacketNextAction: IntakeNextAction | null,
): IntakeNextAction {
  if (conclusion === "post_confirmation_private_config_ready_for_r1142") {
    return "run_r1142_for_real_lab_wearable_route_metrics";
  }
  if (conclusion === "post_confirmation_private_config_waiting_on_safe_availability_action_packet_refresh") {
    return safeAvailabilityActionPacketNextAction ?? "refresh_r1154_safe_availability_action_packet";
  }
  if (conclusion === "post_confirmation_private_config_waiting_on_safe_availability_confirmation") {
    return safeAvailabilityActionPacketNextAction ?? "fill_safe_availability_confirmation_from_template";
  }
  if (conclusion === "post_confirmation_private_config_waiting_on_packet") {
    return "refresh_r1147_post_confirmation_private_config_packet";
  }
  if (conclusion === "post_confirmation_private_config_not_provided") {
    return "provide_post_confirmation_private_runner_config";
  }
  if (conclusion === "post_confirmation_private_config_non_evidence_only") {
    return "use_synthetic_config_only_for_smoke_not_evidence";
  }
  return "complete_post_confirmation_private_runner_config_slots";
}

function safeAvailabilityNextActionFor(value: string | null): IntakeNextAction | null {
  switch (value) {
    case "fill_feature_only_coverage_context_template":
    case "fill_safe_availability_confirmation_from_template":
    case "refresh_r1154_safe_availability_action_packet":
    case "rerun_safe_availability_confirmation_with_valid_json_object":
    case "run_r1144_recipe_readiness_chain_with_confirmed_availability":
    case "run_r1150_safe_availability_confirmation_intake":
    case "run_r1153_feature_only_chain_with_safe_availability":
      return value;
    default:
      return null;
  }
}

async function readPrivateConfig(filePath?: string): Promise<PrivateConfigReadResult> {
  if (!filePath?.trim()) return { config: null, status: "missing" };
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (!isRecord(parsed)) return { config: null, status: "invalid_json_object" };
    return { config: parsed as PartialPrivateRunnerConfigInput, status: "available" };
  } catch (error) {
    return {
      config: null,
      status: error instanceof SyntaxError ? "parse_error" : "read_error",
    };
  }
}

function aggregateMetricsTargetStatusFor(config: PartialPrivateRunnerConfigInput | null): SlotStatus {
  if (!config) return "not_provided";
  return config.aggregateMetricsTarget?.evaluatorId === PARTIAL_AGGREGATE_METRICS_EVALUATOR_ID
      && config.aggregateMetricsTarget.schemaVersion === PARTIAL_AGGREGATE_METRICS_SCHEMA_VERSION
    ? "complete"
    : "missing_or_invalid";
}

function schemaStatusFor(config: PartialPrivateRunnerConfigInput | null): SlotStatus {
  if (!config) return "not_provided";
  return config.schemaVersion === PARTIAL_PRIVATE_RUNNER_CONFIG_SCHEMA_VERSION
    ? "complete"
    : "missing_or_invalid";
}

function evidenceRoleStatusFor(config: PartialPrivateRunnerConfigInput | null): SubmissionContextStatus {
  if (!config) return "not_provided";
  const evidenceRole = config.submissionContext?.evidenceRole;
  if (evidenceRole === "real_partial_route_evidence") return "complete_real_evidence";
  if (evidenceRole === "synthetic_pipeline_smoke") return "complete_non_evidence";
  return "missing_or_invalid";
}

function missingAttestationKeysFor(config: PartialPrivateRunnerConfigInput): RequiredAttestationKey[] {
  const attestations = config.attestations ?? {};
  return REQUIRED_ATTESTATION_KEYS.filter((key) => attestations[key] !== true);
}

function requestedRouteIdsFor(config: PartialPrivateRunnerConfigInput | null): KnownRouteId[] {
  if (!Array.isArray(config?.routeRunOrder)) return [];
  return config.routeRunOrder
    .map((route) => route.routeId)
    .filter(isKnownRouteId);
}

function missingFieldRefKeysFor(
  config: PartialPrivateRunnerConfigInput,
  requiredFieldRefKeys: readonly RequiredFieldRefKey[],
): RequiredFieldRefKey[] {
  const refs = config.privateFieldRefs ?? {};
  return requiredFieldRefKeys.filter((key) => !nonEmptyString(refs[key]));
}

function ordinaryTableLayoutFor(config: PartialPrivateRunnerConfigInput | null): OrdinaryTableLayout {
  if (!config) return "not_provided";
  const refs = config.privateTableRefs ?? {};
  const explicitComplete = nonEmptyString(refs.outcomeTableRef)
    && nonEmptyString(refs.labTableRef)
    && nonEmptyString(refs.wearableTableRef);
  if (explicitComplete) return "multi_table_or_explicit_refs";
  if (nonEmptyString(refs.primaryTableRef)) return "single_primary_table_fallback";
  return "incomplete";
}

function missingTableRefKeysFor(
  config: PartialPrivateRunnerConfigInput | null,
  layout: OrdinaryTableLayout,
): RequiredTableRefKey[] {
  if (!config) return [...REQUIRED_TABLE_REF_KEYS];
  if (tableLayoutComplete(layout)) return [];
  const refs = config.privateTableRefs ?? {};
  const explicitKeys: RequiredTableRefKey[] = ["outcomeTableRef", "labTableRef", "wearableTableRef"];
  if (explicitKeys.some((key) => nonEmptyString(refs[key]))) {
    return explicitKeys.filter((key) => !nonEmptyString(refs[key]));
  }
  return [...REQUIRED_TABLE_REF_KEYS];
}

function tableLayoutComplete(layout: OrdinaryTableLayout): boolean {
  return layout === "multi_table_or_explicit_refs" || layout === "single_primary_table_fallback";
}

function expectedRouteIdsFor(r1147: unknown | null): KnownRouteId[] {
  const fromRunner = readStringArrayAt(r1147, ["summary", "runnerConfigRouteRunOrder"]).filter(isKnownRouteId);
  if (fromRunner.length > 0) return dedupeKnownRouteIds(fromRunner);
  const fromSummary = readStringArrayAt(r1147, ["summary", "expectedRouteIds"]).filter(isKnownRouteId);
  return fromSummary.length > 0 ? dedupeKnownRouteIds(fromSummary) : [...EXPECTED_ROUTE_IDS];
}

function requiredFieldRefKeysFor(r1147: unknown | null): RequiredFieldRefKey[] {
  const fromRunner = readStringArrayAt(r1147, ["summary", "runnerConfigPrivateFieldRefKeys"])
    .filter(isRequiredFieldRefKey);
  return fromRunner.length > 0 ? dedupeRequiredFieldRefKeys(fromRunner) : [...REQUIRED_FIELD_REF_KEYS];
}

function dedupeKnownRouteIds(routeIds: readonly KnownRouteId[]): KnownRouteId[] {
  return Array.from(new Set(routeIds));
}

function dedupeRequiredFieldRefKeys(keys: readonly RequiredFieldRefKey[]): RequiredFieldRefKey[] {
  return Array.from(new Set(keys));
}

function isKnownRouteId(value: unknown): value is KnownRouteId {
  return typeof value === "string" && EXPECTED_ROUTE_IDS.some((routeId) => routeId === value);
}

function isRequiredFieldRefKey(value: string): value is RequiredFieldRefKey {
  return REQUIRED_FIELD_REF_KEYS.some((key) => key === value);
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function validateInputBoundary(name: string, value: unknown | null): void {
  if (!value) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1148 rejected unsafe ${name} input: ${formatFindingCount(findings)}`);
  }
}

function summarizeR1147(value: unknown | null): ArtifactSummary {
  return {
    artifact: R1147_EXPECTED.artifact,
    packetId: readStringAt(value, ["packetId"]) === R1147_EXPECTED.packetId ? R1147_EXPECTED.packetId : null,
    schemaVersion: readStringAt(value, ["schemaVersion"]) === R1147_EXPECTED.schemaVersion
      ? R1147_EXPECTED.schemaVersion
      : null,
    status: value ? "available" : "missing",
  };
}

function r1147MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1147_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1147_EXPECTED.schemaVersion;
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

function readBooleanAt(value: unknown | null, pathParts: readonly string[]): boolean | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "boolean" ? resolved : null;
}

function readNumberAt(value: unknown | null, pathParts: readonly string[]): number | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "number" && Number.isFinite(resolved) ? resolved : null;
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
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function isRecord(value: unknown): value is PartialPrivateRunnerConfigInput {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function formatFindingCount(findings: readonly string[]): string {
  return `${findings.length} aggregate-egress violation${findings.length === 1 ? "" : "s"}`;
}

function safeBoundary(): R1148OrdinaryConsumerPostConfirmationPrivateConfigIntakeOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    configReadErrorStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    privateConfigPathStored: false,
    privateConfigValuesStored: false,
    privateFieldRefValuesStored: false,
    privateFieldRefsStored: false,
    privateTableRefValuesStored: false,
    privateTableRefsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1148: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1148OrdinaryConsumerPostConfirmationPrivateConfigIntake({
    configPath: process.env.MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH
      ?? process.env.MURPH_AGE_ORDINARY_CONSUMER_POST_CONFIRMATION_PRIVATE_RUNNER_CONFIG_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1147Path: process.env.MURPH_AGE_R1147_ORDINARY_CONSUMER_POST_CONFIRMATION_PRIVATE_CONFIG_PACKET_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    evidenceRoleStatus: output.summary.evidenceRoleStatus,
    expectedRouteIds: output.summary.expectedRouteIds,
    missingAttestationKeys: output.summary.missingAttestationKeys,
    missingRouteIds: output.summary.missingRouteIds,
    missingRunnerFieldRefKeys: output.summary.missingRunnerFieldRefKeys,
    missingRunnerTableRefKeys: output.summary.missingRunnerTableRefKeys,
    nextAction: output.summary.nextAction,
    ordinaryTableLayout: output.summary.ordinaryTableLayout,
    packetId: output.packetId,
    packetReadyForConfigIntake: output.summary.packetReadyForConfigIntake,
    privateConfigStatus: output.summary.privateConfigStatus,
    privateConfigSuppliedToIntake: output.summary.privateConfigSuppliedToIntake,
    productDisplayAuthorized: output.productDisplayAuthorized,
    r1147Conclusion: output.summary.r1147Conclusion,
    r1147NextAction: output.summary.r1147NextAction,
    readyForR1142: output.summary.readyForR1142,
    requestedRouteIds: output.summary.requestedRouteIds,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowParsingPerformedByR1148: output.summary.rowParsingPerformedByR1148,
    safeAvailabilityActionPacketConclusion: output.summary.safeAvailabilityActionPacketConclusion,
    safeAvailabilityActionPacketFeatureOnlyCoverageContextReady:
      output.summary.safeAvailabilityActionPacketFeatureOnlyCoverageContextReady,
    safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact:
      output.summary.safeAvailabilityActionPacketFeatureOnlyQuickstartArtifact,
    safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount:
      output.summary.safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditCount,
    safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths:
      output.summary.safeAvailabilityActionPacketFeatureOnlyQuickstartSafeFieldEditPaths,
    safeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds:
      output.summary.safeAvailabilityActionPacketMissingFeatureOnlySourceFamilyIds,
    safeAvailabilityActionPacketMissingRequiredSourceFamilyIds:
      output.summary.safeAvailabilityActionPacketMissingRequiredSourceFamilyIds,
    safeAvailabilityActionPacketNextAction: output.summary.safeAvailabilityActionPacketNextAction,
    safeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain:
      output.summary.safeAvailabilityActionPacketReadyForOutcomeLinkedRecipeReadinessChain,
    safeAvailabilityActionPacketRowLevelDataAcceptedByR1154:
      output.summary.safeAvailabilityActionPacketRowLevelDataAcceptedByR1154,
    schemaVersion: output.schemaVersion,
    status: output.status,
    targetAgeBand: output.summary.targetAgeBand,
    targetInputPriority: output.summary.targetInputPriority,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1148 post-confirmation private config intake failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
