import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1139_ORDINARY_CONSUMER_PARTIAL_PRIVATE_CONFIG_HANDOFF_SCHEMA_VERSION =
  "murph-age-r1139-ordinary-consumer-partial-private-config-handoff.v1" as const;

const PARTIAL_PRIVATE_CONFIG_TEMPLATE_SCHEMA_VERSION =
  "murph-age-ordinary-consumer-partial-private-config-template.v1" as const;
const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1139-ordinary-consumer-partial-private-config-handoff.latest.json";
const PARTIAL_PRIVATE_CONFIG_TEMPLATE_FILE_NAME =
  "r1139-fillable-ordinary-consumer-partial-private-config.json";
const R1139_PARTIAL_PRIVATE_CONFIG_HANDOFF_COMMAND =
  "pnpm exec tsx scripts/murph-age/r1139-ordinary-consumer-partial-private-config-handoff.ts" as const;
const R1138_PARTIAL_AGGREGATE_METRIC_INTAKE_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_AGGREGATE_METRICS_PATH=<partial-aggregate-metrics.json> pnpm exec tsx scripts/murph-age/r1138-ordinary-consumer-partial-aggregate-metric-intake.ts" as const;
const R1141_PARTIAL_PRIVATE_METRIC_RUNNER_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH=<partial-private-config.json> pnpm exec tsx scripts/murph-age/r1141-ordinary-consumer-partial-private-metric-runner.ts" as const;

const R1137_EXPECTED = {
  artifact: "r1137-ordinary-consumer-partial-route-planner.latest.json",
  packetId: "r1137-ordinary-consumer-partial-route-planner",
  schemaVersion: "murph-age-r1137-ordinary-consumer-partial-route-planner.v1",
} as const;
const R1138_EXPECTED = {
  artifact: "r1138-ordinary-consumer-partial-aggregate-metric-intake.latest.json",
  packetId: "r1138-ordinary-consumer-partial-aggregate-metric-intake",
  schemaVersion: "murph-age-r1138-ordinary-consumer-partial-aggregate-metric-intake.v1",
} as const;

const PRIMARY_SUBMITTER_INPUT_FAMILY_IDS = [
  "bloodwork_glycemia",
  "common_bloodwork_core",
  "wearable_activity_daily",
  "vitals_body_context",
] as const;
const REQUIRED_LINKAGE_FAMILY_IDS = [
  "outcome_linkage",
  "join_time_alignment",
] as const;
const ACCEPTED_TABLE_LAYOUTS = [
  "single_primary_table_fallback",
  "multi_table_or_explicit_refs",
] as const;
const PARTIAL_ROUTE_DEFINITIONS = [
  {
    firstPassCandidateIds: ["L1_tiny_glycemia_only"],
    ordinarySubmitterPriority: "lab_glycemia_bloodwork_first",
    requiredPrivateFieldRefFamilies: [
      "personJoinKey",
      "dateOrTimeKey",
      "outcomeEvent",
      "labGlycemia",
    ],
    requiredPrivateTableRefs: ["primaryTableRef", "outcomeTableRef", "labTableRef"],
    requiredSourceFamilyIds: ["outcome_linkage", "join_time_alignment", "bloodwork_glycemia"],
    routeId: "lab_glycemia_minimum_route",
    routeKind: "partial_lab_route",
  },
  {
    firstPassCandidateIds: ["L2_common_lab_core_shadow"],
    ordinarySubmitterPriority: "common_bloodwork_with_body_context",
    requiredPrivateFieldRefFamilies: [
      "personJoinKey",
      "dateOrTimeKey",
      "outcomeEvent",
      "labGlycemia",
      "commonLabCore",
      "vitalsBody",
    ],
    requiredPrivateTableRefs: ["primaryTableRef", "outcomeTableRef", "labTableRef"],
    requiredSourceFamilyIds: [
      "outcome_linkage",
      "join_time_alignment",
      "bloodwork_glycemia",
      "common_bloodwork_core",
      "vitals_body_context",
    ],
    routeId: "common_lab_core_with_context_route",
    routeKind: "partial_lab_route",
  },
  {
    firstPassCandidateIds: ["W1_activity_steps_minutes"],
    ordinarySubmitterPriority: "daily_wearable_activity_first",
    requiredPrivateFieldRefFamilies: [
      "personJoinKey",
      "dateOrTimeKey",
      "outcomeEvent",
      "wearableActivity",
    ],
    requiredPrivateTableRefs: ["primaryTableRef", "outcomeTableRef", "wearableTableRef"],
    requiredSourceFamilyIds: ["outcome_linkage", "join_time_alignment", "wearable_activity_daily"],
    routeId: "wearable_activity_minimum_route",
    routeKind: "partial_wearable_route",
  },
] as const;

type PartialRouteId = typeof PARTIAL_ROUTE_DEFINITIONS[number]["routeId"];
type HandoffConclusion =
  | "ordinary_partial_private_config_handoff_blocked_missing_route_inputs"
  | "ordinary_partial_private_config_handoff_full_route_ready_existing_runner_preferred"
  | "ordinary_partial_private_config_handoff_partial_metrics_recorded_research_only"
  | "ordinary_partial_private_config_handoff_ready_for_partial_private_mapping"
  | "ordinary_partial_private_config_handoff_waiting_on_route_plan";
type HandoffNextAction =
  | "collect_wearable_or_lab_sources_then_rerun_r1136_r1137"
  | "fill_partial_private_config_for_ready_routes_then_run_r1141_partial_private_metric_runner"
  | "fill_private_config_mapping_for_full_labs_wearable_route"
  | "fill_safe_availability_manifest_then_run_r1136_r1137_chain"
  | "use_partial_metrics_for_research_only_collect_full_l1_l2_w1_qc_evidence";
type RouteMappingStatus =
  | "full_supported_route_preferred"
  | "metrics_recorded_research_only"
  | "not_ready_from_current_route_plan"
  | "ready_for_private_workspace_mapping"
  | "waiting_on_safe_availability_route_plan";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface PartialRoutePrivateConfigHandoff {
  acceptedTableLayouts: typeof ACCEPTED_TABLE_LAYOUTS[number][];
  firstPassCandidateIds: string[];
  ordinarySubmitterPriority: string;
  productDisplayAuthorized: false;
  requiredPrivateFieldRefFamilies: string[];
  requiredPrivateTableRefs: string[];
  requiredSourceFamilyIds: string[];
  routeId: PartialRouteId;
  routeKind: string;
  routeMappingStatus: RouteMappingStatus;
  valuesStoredInThisArtifact: false;
}

interface R1139PartialPrivateConfigTemplate {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    privateConfigValuesStored: false;
    privateFieldRefsStored: false;
    privateTableRefsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  packetId: "fill-this-ordinary-consumer-partial-private-config";
  routeMappings: PartialRoutePrivateConfigHandoff[];
  safetyAttestations: {
    aggregateOnly: true;
    noCoefficientEgress: true;
    noParticipantEgress: true;
    noPredictionEgress: true;
    noPrivatePathEgress: true;
    noPrivateRefValueEgress: true;
    noRowEgress: true;
    noSmallCellEgress: true;
  };
  schemaVersion: typeof PARTIAL_PRIVATE_CONFIG_TEMPLATE_SCHEMA_VERSION;
  submissionContext: {
    ordinaryConsumerSubmission: true;
    outcomeLinked: true;
    partialEvidenceOnly: true;
    privateWorkspaceOnlyCompletion: true;
    priorityInputFamilyIds: typeof PRIMARY_SUBMITTER_INPUT_FAMILY_IDS[number][];
    targetAgeBand: "roughly_16_50";
  };
}

export interface R1139OrdinaryConsumerPartialPrivateConfigHandoffOptions {
  createdAt?: string;
  outputDir?: string;
  r1137Path?: string;
  r1138Path?: string;
}

export interface R1139OrdinaryConsumerPartialPrivateConfigHandoffOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1139: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    privateConfigValuesStored: false;
    privateFieldRefsStored: false;
    privateTableRefsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1139: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: {
    r1137: ArtifactSummary;
    r1138: ArtifactSummary;
  };
  packetId: "r1139-ordinary-consumer-partial-private-config-handoff";
  partialPrivateConfigHandoff: {
    blockers: string[];
    commands: {
      partialAggregateMetricIntakeCommand: typeof R1138_PARTIAL_AGGREGATE_METRIC_INTAKE_COMMAND;
      partialPrivateMetricRunnerCommand: typeof R1141_PARTIAL_PRIVATE_METRIC_RUNNER_COMMAND;
      partialPrivateConfigHandoffCommand: typeof R1139_PARTIAL_PRIVATE_CONFIG_HANDOFF_COMMAND;
    };
    currentEvidenceGate: "full_l1_l2_w1_qc_required_for_real_evidence_gate";
    eligiblePartialRouteIds: PartialRouteId[];
    fullEvidenceGateCleared: false;
    fullSupportedRouteReady: boolean;
    partialPrivateConfigTemplateArtifact: typeof PARTIAL_PRIVATE_CONFIG_TEMPLATE_FILE_NAME;
    partialPrivateConfigTemplateSchemaVersion: typeof PARTIAL_PRIVATE_CONFIG_TEMPLATE_SCHEMA_VERSION;
    partialRunnerImplementationRequired: boolean;
    primarySubmitterInputFamilyIds: typeof PRIMARY_SUBMITTER_INPUT_FAMILY_IDS[number][];
    privateDetailsStored: false;
    readyPartialMetricRouteIds: string[];
    requiredLinkageFamilyIds: typeof REQUIRED_LINKAGE_FAMILY_IDS[number][];
    requiredPrivateFieldRefFamilies: string[];
    requiredPrivateTableRefs: string[];
    routeHandoffs: PartialRoutePrivateConfigHandoff[];
  };
  productDisplayAuthorized: false;
  schemaVersion: typeof R1139_ORDINARY_CONSUMER_PARTIAL_PRIVATE_CONFIG_HANDOFF_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: HandoffConclusion;
    eligiblePartialRouteIds: PartialRouteId[];
    fullEvidenceGateCleared: false;
    fullSupportedRouteReady: boolean;
    nextAction: HandoffNextAction;
    partialPrivateConfigTemplateArtifact: typeof PARTIAL_PRIVATE_CONFIG_TEMPLATE_FILE_NAME;
    productDisplayAuthorized: false;
    readyPartialMetricRouteIds: string[];
    realAggregateStillMissing: true;
    requiredPrivateFieldRefFamilies: string[];
    requiredPrivateTableRefs: string[];
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1139: false;
    targetAgeBand: "roughly_16_50";
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first";
  };
}

export async function runR1139OrdinaryConsumerPartialPrivateConfigHandoff(
  options: R1139OrdinaryConsumerPartialPrivateConfigHandoffOptions = {},
): Promise<{
  output: R1139OrdinaryConsumerPartialPrivateConfigHandoffOutput;
  outputPath: string;
  partialPrivateConfigTemplatePath: string;
}> {
  const r1137 = await readJsonIfPresent(options.r1137Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1137_EXPECTED.artifact));
  const r1138 = await readJsonIfPresent(options.r1138Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1138_EXPECTED.artifact));
  validateInputBoundary("r1137", r1137);
  validateInputBoundary("r1138", r1138);

  const r1137Ready = matchesExpected(r1137, R1137_EXPECTED);
  const r1138Ready = matchesExpected(r1138, R1138_EXPECTED);
  const routePlannerConclusion = r1137Ready ? readStringAt(r1137, ["summary", "conclusion"]) : null;
  const routePlanReady = r1137Ready
    && routePlannerConclusion !== "ordinary_partial_route_planner_waiting_on_safe_manifest"
    && routePlannerConclusion !== "ordinary_partial_route_planner_waiting_on_refresh";
  const fullSupportedRouteReady = r1137Ready
    ? readBooleanAt(r1137, ["summary", "fullSupportedRouteReady"]) === true
    : false;
  const eligiblePartialRouteIds = routePlanReady
    ? knownPartialRouteIds(readStringArrayAt(r1137, ["summary", "partialRouteIdsReadyButUnsupported"]))
    : [];
  const readyPartialMetricRouteIds = r1138Ready
    ? readStringArrayAt(r1138, ["summary", "readyPartialRouteIds"]).filter(isKnownPartialRouteId)
    : [];
  const conclusion = conclusionFor({
    eligiblePartialRouteIds,
    fullSupportedRouteReady,
    readyPartialMetricRouteIds,
    routePlanReady,
  });
  const routeHandoffs = routeHandoffsFor({
    eligiblePartialRouteIds,
    fullSupportedRouteReady,
    readyPartialMetricRouteIds,
    routePlanReady,
  });
  const requiredPrivateFieldRefFamilies = uniqueFlatMap(routeHandoffs, "requiredPrivateFieldRefFamilies");
  const requiredPrivateTableRefs = uniqueFlatMap(routeHandoffs, "requiredPrivateTableRefs");
  const template = createPartialPrivateConfigTemplate(routeHandoffs);
  const output: R1139OrdinaryConsumerPartialPrivateConfigHandoffOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: {
      r1137: summarizeInput(R1137_EXPECTED, r1137),
      r1138: summarizeInput(R1138_EXPECTED, r1138),
    },
    packetId: "r1139-ordinary-consumer-partial-private-config-handoff",
    partialPrivateConfigHandoff: {
      blockers: blockersFor(conclusion),
      commands: {
        partialAggregateMetricIntakeCommand: R1138_PARTIAL_AGGREGATE_METRIC_INTAKE_COMMAND,
        partialPrivateMetricRunnerCommand: R1141_PARTIAL_PRIVATE_METRIC_RUNNER_COMMAND,
        partialPrivateConfigHandoffCommand: R1139_PARTIAL_PRIVATE_CONFIG_HANDOFF_COMMAND,
      },
      currentEvidenceGate: "full_l1_l2_w1_qc_required_for_real_evidence_gate",
      eligiblePartialRouteIds,
      fullEvidenceGateCleared: false,
      fullSupportedRouteReady,
      partialPrivateConfigTemplateArtifact: PARTIAL_PRIVATE_CONFIG_TEMPLATE_FILE_NAME,
      partialPrivateConfigTemplateSchemaVersion: PARTIAL_PRIVATE_CONFIG_TEMPLATE_SCHEMA_VERSION,
      partialRunnerImplementationRequired: false,
      primarySubmitterInputFamilyIds: [...PRIMARY_SUBMITTER_INPUT_FAMILY_IDS],
      privateDetailsStored: false,
      readyPartialMetricRouteIds,
      requiredLinkageFamilyIds: [...REQUIRED_LINKAGE_FAMILY_IDS],
      requiredPrivateFieldRefFamilies,
      requiredPrivateTableRefs,
      routeHandoffs,
    },
    productDisplayAuthorized: false,
    schemaVersion: R1139_ORDINARY_CONSUMER_PARTIAL_PRIVATE_CONFIG_HANDOFF_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      eligiblePartialRouteIds,
      fullEvidenceGateCleared: false,
      fullSupportedRouteReady,
      nextAction: nextActionFor(conclusion),
      partialPrivateConfigTemplateArtifact: PARTIAL_PRIVATE_CONFIG_TEMPLATE_FILE_NAME,
      productDisplayAuthorized: false,
      readyPartialMetricRouteIds,
      realAggregateStillMissing: true,
      requiredPrivateFieldRefFamilies,
      requiredPrivateTableRefs,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1139: false,
      targetAgeBand: "roughly_16_50",
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };

  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findForbiddenAggregateEgress(template),
  ];
  if (findings.length > 0) {
    throw new Error(`R1139 ordinary consumer partial private config handoff failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  const partialPrivateConfigTemplatePath = path.join(outputDir, PARTIAL_PRIVATE_CONFIG_TEMPLATE_FILE_NAME);
  await Promise.all([
    writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`),
    writeFile(partialPrivateConfigTemplatePath, `${JSON.stringify(template, null, 2)}\n`),
  ]);
  return { output, outputPath, partialPrivateConfigTemplatePath };
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function validateInputBoundary(name: string, value: unknown | null): void {
  if (!value) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1139 ${name} failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }
}

function conclusionFor(input: {
  eligiblePartialRouteIds: readonly PartialRouteId[];
  fullSupportedRouteReady: boolean;
  readyPartialMetricRouteIds: readonly string[];
  routePlanReady: boolean;
}): HandoffConclusion {
  if (!input.routePlanReady) return "ordinary_partial_private_config_handoff_waiting_on_route_plan";
  if (input.fullSupportedRouteReady) {
    return "ordinary_partial_private_config_handoff_full_route_ready_existing_runner_preferred";
  }
  if (input.readyPartialMetricRouteIds.length > 0) {
    return "ordinary_partial_private_config_handoff_partial_metrics_recorded_research_only";
  }
  if (input.eligiblePartialRouteIds.length > 0) {
    return "ordinary_partial_private_config_handoff_ready_for_partial_private_mapping";
  }
  return "ordinary_partial_private_config_handoff_blocked_missing_route_inputs";
}

function nextActionFor(conclusion: HandoffConclusion): HandoffNextAction {
  if (conclusion === "ordinary_partial_private_config_handoff_waiting_on_route_plan") {
    return "fill_safe_availability_manifest_then_run_r1136_r1137_chain";
  }
  if (conclusion === "ordinary_partial_private_config_handoff_ready_for_partial_private_mapping") {
    return "fill_partial_private_config_for_ready_routes_then_run_r1141_partial_private_metric_runner";
  }
  if (conclusion === "ordinary_partial_private_config_handoff_partial_metrics_recorded_research_only") {
    return "use_partial_metrics_for_research_only_collect_full_l1_l2_w1_qc_evidence";
  }
  if (conclusion === "ordinary_partial_private_config_handoff_full_route_ready_existing_runner_preferred") {
    return "fill_private_config_mapping_for_full_labs_wearable_route";
  }
  return "collect_wearable_or_lab_sources_then_rerun_r1136_r1137";
}

function blockersFor(conclusion: HandoffConclusion): string[] {
  if (conclusion === "ordinary_partial_private_config_handoff_waiting_on_route_plan") {
    return ["safe_availability_route_plan_missing_or_waiting"];
  }
  if (conclusion === "ordinary_partial_private_config_handoff_ready_for_partial_private_mapping") {
    return [
      "partial_private_runner_config_and_local_metrics_missing",
      "full_l1_l2_w1_qc_evidence_gate_still_required",
    ];
  }
  if (conclusion === "ordinary_partial_private_config_handoff_partial_metrics_recorded_research_only") {
    return ["full_l1_l2_w1_qc_evidence_gate_still_required"];
  }
  if (conclusion === "ordinary_partial_private_config_handoff_full_route_ready_existing_runner_preferred") {
    return ["full_supported_route_private_config_mapping_preferred_over_partial_extension"];
  }
  return ["wearable_or_lab_route_sources_not_available_for_partial_mapping"];
}

function routeHandoffsFor(input: {
  eligiblePartialRouteIds: readonly PartialRouteId[];
  fullSupportedRouteReady: boolean;
  readyPartialMetricRouteIds: readonly string[];
  routePlanReady: boolean;
}): PartialRoutePrivateConfigHandoff[] {
  const includeRouteIds = input.eligiblePartialRouteIds.length > 0
    ? new Set(input.eligiblePartialRouteIds)
    : input.readyPartialMetricRouteIds.length > 0
      ? new Set(input.readyPartialMetricRouteIds.filter(isKnownPartialRouteId))
      : new Set(PARTIAL_ROUTE_DEFINITIONS.map((route) => route.routeId));
  const eligible = new Set(input.eligiblePartialRouteIds);
  const metricReady = new Set(input.readyPartialMetricRouteIds);
  return PARTIAL_ROUTE_DEFINITIONS
    .filter((route) => includeRouteIds.has(route.routeId))
    .map((route) => ({
      acceptedTableLayouts: [...ACCEPTED_TABLE_LAYOUTS],
      firstPassCandidateIds: [...route.firstPassCandidateIds],
      ordinarySubmitterPriority: route.ordinarySubmitterPriority,
      productDisplayAuthorized: false,
      requiredPrivateFieldRefFamilies: [...route.requiredPrivateFieldRefFamilies],
      requiredPrivateTableRefs: [...route.requiredPrivateTableRefs],
      requiredSourceFamilyIds: [...route.requiredSourceFamilyIds],
      routeId: route.routeId,
      routeKind: route.routeKind,
      routeMappingStatus: routeMappingStatusFor({
        eligible: eligible.has(route.routeId),
        fullSupportedRouteReady: input.fullSupportedRouteReady,
        metricReady: metricReady.has(route.routeId),
        routePlanReady: input.routePlanReady,
      }),
      valuesStoredInThisArtifact: false,
    }));
}

function routeMappingStatusFor(input: {
  eligible: boolean;
  fullSupportedRouteReady: boolean;
  metricReady: boolean;
  routePlanReady: boolean;
}): RouteMappingStatus {
  if (!input.routePlanReady) return "waiting_on_safe_availability_route_plan";
  if (input.fullSupportedRouteReady) return "full_supported_route_preferred";
  if (input.metricReady) return "metrics_recorded_research_only";
  if (input.eligible) return "ready_for_private_workspace_mapping";
  return "not_ready_from_current_route_plan";
}

function createPartialPrivateConfigTemplate(
  routeMappings: readonly PartialRoutePrivateConfigHandoff[],
): R1139PartialPrivateConfigTemplate {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      headerValuesStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      privateConfigValuesStored: false,
      privateFieldRefsStored: false,
      privateTableRefsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceFileNamesStored: false,
      sourceVariableNamesStored: false,
      splitMembershipStored: false,
    },
    packetId: "fill-this-ordinary-consumer-partial-private-config",
    routeMappings: routeMappings.map((route) => ({ ...route })),
    safetyAttestations: {
      aggregateOnly: true,
      noCoefficientEgress: true,
      noParticipantEgress: true,
      noPredictionEgress: true,
      noPrivatePathEgress: true,
      noPrivateRefValueEgress: true,
      noRowEgress: true,
      noSmallCellEgress: true,
    },
    schemaVersion: PARTIAL_PRIVATE_CONFIG_TEMPLATE_SCHEMA_VERSION,
    submissionContext: {
      ordinaryConsumerSubmission: true,
      outcomeLinked: true,
      partialEvidenceOnly: true,
      privateWorkspaceOnlyCompletion: true,
      priorityInputFamilyIds: [...PRIMARY_SUBMITTER_INPUT_FAMILY_IDS],
      targetAgeBand: "roughly_16_50",
    },
  };
}

function summarizeInput(expected: typeof R1137_EXPECTED | typeof R1138_EXPECTED, input: unknown | null): ArtifactSummary {
  const packetId = readStringAt(input, ["packetId"]);
  const schemaVersion = readStringAt(input, ["schemaVersion"]);
  return {
    artifact: expected.artifact,
    packetId: packetId === expected.packetId ? expected.packetId : null,
    schemaVersion: schemaVersion === expected.schemaVersion ? expected.schemaVersion : null,
    status: input ? "available" : "missing",
  };
}

function matchesExpected(input: unknown | null, expected: typeof R1137_EXPECTED | typeof R1138_EXPECTED): boolean {
  return readStringAt(input, ["packetId"]) === expected.packetId
    && readStringAt(input, ["schemaVersion"]) === expected.schemaVersion;
}

function knownPartialRouteIds(values: readonly string[]): PartialRouteId[] {
  return values.filter(isKnownPartialRouteId);
}

function isKnownPartialRouteId(value: string): value is PartialRouteId {
  return PARTIAL_ROUTE_DEFINITIONS.some((route) => route.routeId === value);
}

function uniqueFlatMap(
  routeHandoffs: readonly PartialRoutePrivateConfigHandoff[],
  key: "requiredPrivateFieldRefFamilies" | "requiredPrivateTableRefs",
): string[] {
  return Array.from(new Set(routeHandoffs.flatMap((route) => route[key])));
}

function readBooleanAt(value: unknown | null, pathParts: readonly string[]): boolean | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "boolean" ? resolved : null;
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

function safeBoundary(): R1139OrdinaryConsumerPartialPrivateConfigHandoffOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1139: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    privateConfigValuesStored: false,
    privateFieldRefsStored: false,
    privateTableRefsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1139: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1139OrdinaryConsumerPartialPrivateConfigHandoff({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1137Path: process.env.MURPH_AGE_R1137_ORDINARY_CONSUMER_PARTIAL_ROUTE_PLANNER_PATH,
    r1138Path: process.env.MURPH_AGE_R1138_ORDINARY_CONSUMER_PARTIAL_AGGREGATE_METRIC_INTAKE_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    eligiblePartialRouteIds: output.summary.eligiblePartialRouteIds,
    fullEvidenceGateCleared: output.summary.fullEvidenceGateCleared,
    fullSupportedRouteReady: output.summary.fullSupportedRouteReady,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    partialPrivateConfigTemplateArtifact: output.summary.partialPrivateConfigTemplateArtifact,
    productDisplayAuthorized: output.productDisplayAuthorized,
    readyPartialMetricRouteIds: output.summary.readyPartialMetricRouteIds,
    realAggregateStillMissing: output.summary.realAggregateStillMissing,
    requiredPrivateFieldRefFamilies: output.summary.requiredPrivateFieldRefFamilies,
    requiredPrivateTableRefs: output.summary.requiredPrivateTableRefs,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowParsingPerformedByR1139: output.summary.rowParsingPerformedByR1139,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

function formatFindingCount(findings: readonly string[]): string {
  return `${findings.length} aggregate-egress violation${findings.length === 1 ? "" : "s"}`;
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1139 ordinary consumer partial private config handoff failed.")}\n`);
    process.exitCode = 1;
  });
}
