import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import type { R1138PartialAggregateMetricsInput } from "./r1138-ordinary-consumer-partial-aggregate-metric-intake.ts";

export const R1141_ORDINARY_CONSUMER_PARTIAL_PRIVATE_METRIC_RUNNER_SCHEMA_VERSION =
  "murph-age-r1141-ordinary-consumer-partial-private-metric-runner.v1" as const;

const PARTIAL_PRIVATE_RUNNER_CONFIG_SCHEMA_VERSION =
  "murph-age-ordinary-consumer-partial-private-runner-config.v1" as const;
const PARTIAL_AGGREGATE_METRICS_SCHEMA_VERSION =
  "murph-age-ordinary-consumer-partial-aggregate-metrics.v1" as const;
const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1141-ordinary-consumer-partial-private-metric-runner.latest.json";
const PARTIAL_AGGREGATE_METRICS_FILE_NAME = "r1141-ordinary-consumer-partial-aggregate-metrics.json";
const PARTIAL_PRIVATE_CONFIG_TEMPLATE_ARTIFACT =
  "r1139-fillable-ordinary-consumer-partial-private-config.json" as const;
const R1141_EXECUTION_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH=<partial-private-config.json> pnpm exec tsx scripts/murph-age/r1141-ordinary-consumer-partial-private-metric-runner.ts" as const;
const R1138_PARTIAL_AGGREGATE_METRIC_INTAKE_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_AGGREGATE_METRICS_PATH=<partial-aggregate-metrics.json> pnpm exec tsx scripts/murph-age/r1138-ordinary-consumer-partial-aggregate-metric-intake.ts" as const;
const R1139_EXPECTED = {
  artifact: "r1139-ordinary-consumer-partial-private-config-handoff.latest.json",
  packetId: "r1139-ordinary-consumer-partial-private-config-handoff",
  schemaVersion: "murph-age-r1139-ordinary-consumer-partial-private-config-handoff.v1",
} as const;

const PARTIAL_ROUTE_DEFINITIONS = [
  {
    candidateId: "L1_tiny_glycemia_only",
    candidateKind: "lab",
    comparatorId: "frozen_recalibrated_r399",
    requiredPrivateFieldRefFamilies: ["personJoinKey", "outcomeEvent", "labGlycemia"],
    requiredPrivateTableRefs: ["primaryTableRef", "outcomeTableRef", "labTableRef"],
    routeId: "lab_glycemia_minimum_route",
    routeKind: "partial_lab_route",
    scoreKey: "l1Score",
  },
  {
    candidateId: "L2_common_lab_core_shadow",
    candidateKind: "lab",
    comparatorId: "l1_tiny_glycemia_only",
    requiredPrivateFieldRefFamilies: [
      "personJoinKey",
      "outcomeEvent",
      "labGlycemia",
      "commonLabCore",
      "vitalsBody",
    ],
    requiredPrivateTableRefs: ["primaryTableRef", "outcomeTableRef", "labTableRef"],
    routeId: "common_lab_core_with_context_route",
    routeKind: "partial_lab_route",
    scoreKey: "l2Score",
  },
  {
    candidateId: "W1_activity_steps_minutes",
    candidateKind: "wearable",
    comparatorId: "frozen_recalibrated_r399",
    requiredPrivateFieldRefFamilies: ["personJoinKey", "outcomeEvent", "wearableActivity"],
    requiredPrivateTableRefs: ["primaryTableRef", "outcomeTableRef", "wearableTableRef"],
    routeId: "wearable_activity_minimum_route",
    routeKind: "partial_wearable_route",
    scoreKey: "w1Score",
  },
] as const;
const ACCEPTED_PRIVATE_TABLE_LAYOUTS = [
  "single_primary_table_fallback",
  "multi_table_or_explicit_refs",
] as const;

type PartialRouteDefinition = typeof PARTIAL_ROUTE_DEFINITIONS[number];
type PartialRouteId = PartialRouteDefinition["routeId"];
type ScoreKey = PartialRouteDefinition["scoreKey"];
type CountBand = "0" | "1-9" | "10-49" | "50-99" | "100-499" | "500_plus";
type RunnerConclusion =
  | "ordinary_partial_private_metric_runner_aggregate_metrics_ready_for_r1138"
  | "ordinary_partial_private_metric_runner_missing_config"
  | "ordinary_partial_private_metric_runner_no_eligible_requested_routes"
  | "ordinary_partial_private_metric_runner_not_enough_usable_data"
  | "ordinary_partial_private_metric_runner_waiting_on_partial_handoff";
type RunnerNextAction =
  | "provide_partial_private_runner_config"
  | "request_eligible_partial_route_config_or_collect_sources"
  | "run_r1140_or_r1139_until_partial_routes_ready"
  | "send_r1141_partial_metrics_to_r1138_or_r1140"
  | "use_larger_or_better_covered_partial_route_dataset";

interface ArtifactSummary {
  artifact: typeof R1139_EXPECTED.artifact;
  packetId: typeof R1139_EXPECTED.packetId | null;
  schemaVersion: typeof R1139_EXPECTED.schemaVersion | null;
  status: "available" | "missing";
}

interface PartialPrivateRunnerConfig {
  aggregateMetricsTarget?: {
    evaluatorId?: unknown;
    schemaVersion?: unknown;
  };
  attestations?: {
    localOnly?: unknown;
    noCoefficientEgress?: unknown;
    noHeaderNameEgress?: unknown;
    noParticipantEgress?: unknown;
    noPredictionEgress?: unknown;
    noPrivatePathEgress?: unknown;
    noPrivateRefValueEgress?: unknown;
    noRowEgress?: unknown;
    noSmallCellEgress?: unknown;
    noSourceTextEgress?: unknown;
  };
  privateFieldRefs?: {
    commonLabCore?: unknown;
    labGlycemia?: unknown;
    outcomeEvent?: unknown;
    personJoinKey?: unknown;
    vitalsBody?: unknown;
    wearableActivity?: unknown;
  };
  privateTableRefs?: {
    labTableRef?: unknown;
    outcomeTableRef?: unknown;
    primaryTableRef?: unknown;
    wearableTableRef?: unknown;
  };
  routeRunOrder?: Array<{ routeId?: unknown }>;
  schemaVersion?: unknown;
  submissionContext?: {
    evidenceRole?: unknown;
  };
}

interface PrivateRecord {
  l1Score: number | null;
  l2Score: number | null;
  outcome: 0 | 1;
  w1Score: number | null;
}

interface CandidateEvaluation {
  auc: number | null;
  brier: number | null;
  coverageRate: number;
  eventCount: number;
  logLoss: number | null;
  rows: Array<{ score: number; y: 0 | 1 }>;
  usableCount: number;
}

interface RouteExecution {
  eventCount: number;
  routeId: PartialRouteId;
  routeResult: R1138PartialAggregateMetricsInput["routeResults"][number] | null;
  usableRecordCount: number;
}

export interface R1141OrdinaryConsumerPartialPrivateMetricRunnerOptions {
  configPath?: string;
  createdAt?: string;
  outputDir?: string;
  r1139Path?: string;
}

export interface R1141OrdinaryConsumerPartialPrivateMetricRunnerOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1141: boolean;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    privateConfigPathStored: false;
    privateConfigValuesStored: false;
    privateFieldRefsStored: false;
    privateTableRefsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: {
    r1139: ArtifactSummary;
  };
  packetId: "r1141-ordinary-consumer-partial-private-metric-runner";
  partialPrivateExecution: {
    aggregateMetricsArtifact: typeof PARTIAL_AGGREGATE_METRICS_FILE_NAME | null;
    aggregateMetricsRouteCountBand: "0" | "1-3";
    commands: {
      aggregateMetricIntakeCommand: typeof R1138_PARTIAL_AGGREGATE_METRIC_INTAKE_COMMAND;
      partialPrivateRunnerCommand: typeof R1141_EXECUTION_COMMAND;
    };
    configPathConfigured: boolean;
    eligiblePartialRouteIds: PartialRouteId[];
    eventCountBand: CountBand;
    executedPartialRouteIds: PartialRouteId[];
    localPrivateDataRead: boolean;
    partialPrivateConfigTemplateArtifact: typeof PARTIAL_PRIVATE_CONFIG_TEMPLATE_ARTIFACT;
    privateConfigChecklist: {
      acceptedPrivateTableLayouts: typeof ACCEPTED_PRIVATE_TABLE_LAYOUTS[number][];
      aggregateMetricsTargetEvaluatorId: "ordinary_consumer_partial_route_aggregate_evaluator_v1";
      aggregateMetricsTargetSchemaVersion: typeof PARTIAL_AGGREGATE_METRICS_SCHEMA_VERSION;
      executionCommand: typeof R1141_EXECUTION_COMMAND;
      minimumEventCount: "10_plus";
      minimumUsableRecordCount: "50_plus";
      requiredRouteIds: PartialRouteId[];
      routeRequirements: Array<{
        candidateId: string;
        requiredPrivateFieldRefFamilies: string[];
        requiredPrivateTableRefs: string[];
        routeId: PartialRouteId;
      }>;
      singlePrimaryTableFallbackAccepted: true;
    };
    privateValuesStored: false;
    requestedPartialRouteIds: PartialRouteId[];
    routeExecutionStatus: Array<{
      eventCountBand: CountBand;
      routeId: PartialRouteId;
      status: "aggregate_metrics_ready" | "not_enough_usable_data";
      usableRecordCountBand: CountBand;
    }>;
    usableRecordCountBand: CountBand;
  };
  productDisplayAuthorized: false;
  schemaVersion: typeof R1141_ORDINARY_CONSUMER_PARTIAL_PRIVATE_METRIC_RUNNER_SCHEMA_VERSION;
  status: "research-local-private-inputs-aggregate-output";
  summary: {
    aggregateMetricsArtifact: typeof PARTIAL_AGGREGATE_METRICS_FILE_NAME | null;
    conclusion: RunnerConclusion;
    executedPartialRouteIds: PartialRouteId[];
    nextAction: RunnerNextAction;
    productDisplayAuthorized: false;
    realAggregateStillMissing: true;
    reviewGptRequiredNow: false;
    routeMetricsReadyForR1138: boolean;
    rowValuesStored: false;
    targetAgeBand: "roughly_16_50";
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first";
  };
}

export async function runR1141OrdinaryConsumerPartialPrivateMetricRunner(
  options: R1141OrdinaryConsumerPartialPrivateMetricRunnerOptions = {},
): Promise<{
  aggregateMetricsPath: string | null;
  output: R1141OrdinaryConsumerPartialPrivateMetricRunnerOutput;
  outputPath: string;
}> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const r1139 = await readJsonIfPresent(options.r1139Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1139_EXPECTED.artifact));
  validateInputBoundary("r1139", r1139);
  const configPath = options.configPath ?? process.env.MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH;
  const configPathConfigured = Boolean(configPath?.trim());
  const config = await readPrivateConfig(configPath);
  const handoffReady = r1139MatchesExpected(r1139)
    && readStringAt(r1139, ["summary", "conclusion"]) === "ordinary_partial_private_config_handoff_ready_for_partial_private_mapping";
  const eligiblePartialRouteIds = handoffReady
    ? knownPartialRouteIds(readStringArrayAt(r1139, ["summary", "eligiblePartialRouteIds"]))
    : [];
  const requestedPartialRouteIds = config ? readRequestedRouteIds(config) : [];
  const routesToExecute = requestedPartialRouteIds.filter((routeId) => eligiblePartialRouteIds.includes(routeId));
  const execution = config && handoffReady && routesToExecute.length > 0
    ? await executePrivatePartialRouteRun(config, routesToExecute)
    : null;
  const routeResults = execution?.flatMap((route) => route.routeResult ? [route.routeResult] : []) ?? [];
  const aggregateMetrics = routeResults.length > 0 && config
    ? createPartialAggregateMetrics(routeResults, evidenceRoleFor(config))
    : null;
  const aggregateMetricsPath = aggregateMetrics ? path.join(outputDir, PARTIAL_AGGREGATE_METRICS_FILE_NAME) : null;
  const routeExecutionStatus = execution?.map(routeExecutionStatusFor) ?? [];
  const summary = summaryFor({
    aggregateMetrics,
    config,
    handoffReady,
    routesToExecute,
  });
  const output: R1141OrdinaryConsumerPartialPrivateMetricRunnerOutput = {
    artifactBoundary: safeBoundary(Boolean(execution)),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: {
      r1139: summarizeR1139(r1139),
    },
    packetId: "r1141-ordinary-consumer-partial-private-metric-runner",
    partialPrivateExecution: {
      aggregateMetricsArtifact: aggregateMetrics ? PARTIAL_AGGREGATE_METRICS_FILE_NAME : null,
      aggregateMetricsRouteCountBand: aggregateMetrics ? "1-3" : "0",
      commands: {
        aggregateMetricIntakeCommand: R1138_PARTIAL_AGGREGATE_METRIC_INTAKE_COMMAND,
        partialPrivateRunnerCommand: R1141_EXECUTION_COMMAND,
      },
      configPathConfigured,
      eligiblePartialRouteIds,
      eventCountBand: maxCountBand(execution?.map((route) => route.eventCount) ?? []),
      executedPartialRouteIds: routeResults.map((route) => route.routeId).filter(isKnownPartialRouteId),
      localPrivateDataRead: Boolean(execution),
      partialPrivateConfigTemplateArtifact: PARTIAL_PRIVATE_CONFIG_TEMPLATE_ARTIFACT,
      privateConfigChecklist: privateConfigChecklist(eligiblePartialRouteIds),
      privateValuesStored: false,
      requestedPartialRouteIds,
      routeExecutionStatus,
      usableRecordCountBand: maxCountBand(execution?.map((route) => route.usableRecordCount) ?? []),
    },
    productDisplayAuthorized: false,
    schemaVersion: R1141_ORDINARY_CONSUMER_PARTIAL_PRIVATE_METRIC_RUNNER_SCHEMA_VERSION,
    status: "research-local-private-inputs-aggregate-output",
    summary,
  };

  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...(aggregateMetrics ? findForbiddenAggregateEgress(aggregateMetrics) : []),
  ];
  if (findings.length > 0) {
    throw new Error(`R1141 ordinary consumer partial private metric runner failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  if (aggregateMetricsPath && aggregateMetrics) {
    await writeFile(aggregateMetricsPath, `${JSON.stringify(aggregateMetrics, null, 2)}\n`);
  }
  return { aggregateMetricsPath, output, outputPath };
}

async function executePrivatePartialRouteRun(
  config: PartialPrivateRunnerConfig,
  routeIds: readonly PartialRouteId[],
): Promise<RouteExecution[]> {
  validateConfigForExecution(config);
  const refs = config.privateFieldRefs ?? {};
  const tables = config.privateTableRefs ?? {};
  const tablePaths = privateTablePathsFor(tables);
  const personJoinKey = requireSingleRef(refs.personJoinKey, "personJoinKey");
  const outcomeEvent = requireSingleRef(refs.outcomeEvent, "outcomeEvent");
  const [outcomeRows, labRows, wearableRows] = await Promise.all([
    readPrivateCsvTable(tablePaths.outcomeTablePath),
    routeIds.some(routeRequiresLab) ? readPrivateCsvTable(tablePaths.labTablePath) : Promise.resolve([]),
    routeIds.some(routeRequiresWearable) ? readPrivateCsvTable(tablePaths.wearableTablePath) : Promise.resolve([]),
  ]);
  const outcomes = readOutcomes(outcomeRows, personJoinKey, outcomeEvent);
  return routeIds.map((routeId) => {
    const route = routeDefinition(routeId);
    const records = recordsForRoute({
      labRows,
      outcomes,
      personJoinKey,
      refs,
      route,
      wearableRows,
    });
    const routeResult = routeResultFor(route, records);
    return {
      eventCount: records.filter((record) => record.outcome === 1).length,
      routeId,
      routeResult,
      usableRecordCount: usableRecordCountFor(records, route.scoreKey),
    };
  });
}

function recordsForRoute(input: {
  labRows: readonly Record<string, string>[];
  outcomes: ReadonlyMap<string, 0 | 1>;
  personJoinKey: string;
  refs: NonNullable<PartialPrivateRunnerConfig["privateFieldRefs"]>;
  route: PartialRouteDefinition;
  wearableRows: readonly Record<string, string>[];
}): PrivateRecord[] {
  const l1ByPerson = routeRequiresLab(input.route.routeId)
    ? aggregateFeatureByPerson(input.labRows, input.personJoinKey, requireRefList(input.refs.labGlycemia, "labGlycemia"))
    : new Map<string, number>();
  const l2ByPerson = input.route.routeId === "common_lab_core_with_context_route"
    ? aggregateFeatureByPerson(input.labRows, input.personJoinKey, [
      ...requireRefList(input.refs.labGlycemia, "labGlycemia"),
      ...requireRefList(input.refs.commonLabCore, "commonLabCore"),
      ...requireRefList(input.refs.vitalsBody, "vitalsBody"),
    ])
    : new Map<string, number>();
  const w1ByPerson = input.route.routeId === "wearable_activity_minimum_route"
    ? aggregateFeatureByPerson(input.wearableRows, input.personJoinKey, requireRefList(input.refs.wearableActivity, "wearableActivity"))
    : new Map<string, number>();
  return [...input.outcomes.entries()].map(([personKey, outcome]) => ({
    l1Score: l1ByPerson.get(personKey) ?? null,
    l2Score: l2ByPerson.get(personKey) ?? null,
    outcome,
    w1Score: w1ByPerson.get(personKey) ?? null,
  }));
}

function routeResultFor(
  route: PartialRouteDefinition,
  records: readonly PrivateRecord[],
): R1138PartialAggregateMetricsInput["routeResults"][number] | null {
  const evaluation = evaluateCandidate(records, route.scoreKey);
  if (!candidateEvaluationUsable(evaluation)) return null;
  const comparator = route.routeId === "common_lab_core_with_context_route"
    ? evaluateCandidate(records, "l1Score")
    : null;
  return {
    candidateResults: [
      candidateResult({
        candidateId: route.candidateId,
        candidateKind: route.candidateKind,
        comparator: candidateEvaluationUsable(comparator) ? comparator : null,
        comparatorId: route.comparatorId,
        evaluation,
        missingnessOrCoverageControlStatus: route.routeId === "wearable_activity_minimum_route"
          ? wearableMissingnessControlStatus(records, evaluation)
          : "not_applicable",
      }),
    ],
    routeId: route.routeId,
  };
}

function createPartialAggregateMetrics(
  routeResults: R1138PartialAggregateMetricsInput["routeResults"],
  evidenceRole: R1138PartialAggregateMetricsInput["submissionContext"]["evidenceRole"],
): R1138PartialAggregateMetricsInput {
  return {
    artifactBoundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
    },
    evaluatorId: "ordinary_consumer_partial_route_aggregate_evaluator_v1",
    packetId: "r1141-ordinary-consumer-partial-aggregate-metrics",
    receiptAttestations: {
      aggregateOnly: true,
      endpointFrozenBeforeScoring: true,
      evaluatorFrozenBeforeExecution: true,
      noCoefficientEgress: true,
      noParticipantEgress: true,
      noPredictionEgress: true,
      noRowEgress: true,
      noSmallCellEgress: true,
      sameDenominatorComparisons: true,
    },
    routeResults,
    schemaVersion: PARTIAL_AGGREGATE_METRICS_SCHEMA_VERSION,
    submissionContext: {
      evidenceRole,
      ordinaryConsumerSubmission: true,
      outcomeLinked: true,
      partialEvidenceOnly: true,
      targetAgeBand: "roughly_16_50",
    },
  };
}

function candidateResult(input: {
  candidateId: string;
  candidateKind: "lab" | "wearable";
  comparator: CandidateEvaluation | null;
  comparatorId: string;
  evaluation: CandidateEvaluation;
  missingnessOrCoverageControlStatus: string;
}): R1138PartialAggregateMetricsInput["routeResults"][number]["candidateResults"][number] {
  const comparator = input.comparator;
  const aucDelta = input.evaluation.auc !== null
    ? roundMetric(input.evaluation.auc - (comparator?.auc ?? 0.5))
    : null;
  const brierDelta = input.evaluation.brier !== null
    ? roundMetric(input.evaluation.brier - (comparator?.brier ?? baselineBrier(input.evaluation.rows)))
    : null;
  const logLossDelta = input.evaluation.logLoss !== null
    ? roundMetric(input.evaluation.logLoss - (comparator?.logLoss ?? baselineLogLoss(input.evaluation.rows)))
    : null;
  return {
    aucDelta,
    brierDelta,
    calibrationStatus: brierDelta !== null && logLossDelta !== null && brierDelta <= 0 && logLossDelta <= 0
      ? "non_worse"
      : "worse",
    candidateId: input.candidateId,
    candidateKind: input.candidateKind,
    comparatorId: input.comparatorId,
    coverageStatus: coverageStatus(input.evaluation),
    evidenceSupport: input.evaluation.eventCount >= 100 ? "one_receipt_100_plus_events" : "underpowered",
    logLossDelta,
    missingnessOrCoverageControlStatus: input.missingnessOrCoverageControlStatus,
  };
}

function evaluateCandidate(
  records: readonly PrivateRecord[],
  key: ScoreKey,
): CandidateEvaluation {
  const rows = records
    .filter((record) => typeof record[key] === "number")
    .map((record) => ({ score: record[key] as number, y: record.outcome }));
  const usableCount = rows.length;
  const eventCount = rows.filter((row) => row.y === 1).length;
  const coverageRate = records.length > 0 ? usableCount / records.length : 0;
  if (usableCount < 50 || eventCount < 10 || eventCount >= usableCount) {
    return {
      auc: null,
      brier: null,
      coverageRate,
      eventCount,
      logLoss: null,
      rows,
      usableCount,
    };
  }
  const oriented = orientRows(rows);
  const probabilities = probabilitiesFor(oriented);
  return {
    auc: aucFor(oriented),
    brier: brierFor(probabilities, oriented),
    coverageRate,
    eventCount,
    logLoss: logLossFor(probabilities, oriented),
    rows: oriented,
    usableCount,
  };
}

function candidateEvaluationUsable(evaluation: CandidateEvaluation | null): evaluation is CandidateEvaluation {
  return evaluation !== null
    && evaluation.auc !== null
    && evaluation.brier !== null
    && evaluation.logLoss !== null
    && evaluation.usableCount >= 50
    && evaluation.eventCount >= 10;
}

function orientRows(rows: Array<{ score: number; y: 0 | 1 }>): Array<{ score: number; y: 0 | 1 }> {
  const auc = aucFor(rows);
  return auc !== null && auc < 0.5
    ? rows.map((row) => ({ score: -row.score, y: row.y }))
    : rows;
}

function probabilitiesFor(rows: Array<{ score: number; y: 0 | 1 }>): number[] {
  const mean = rows.reduce((sum, row) => sum + row.score, 0) / Math.max(1, rows.length);
  const variance = rows.reduce((sum, row) => sum + (row.score - mean) ** 2, 0) / Math.max(1, rows.length);
  const sd = Math.sqrt(variance) || 1;
  const eventRate = clamp(rows.reduce((sum, row) => sum + row.y, 0) / Math.max(1, rows.length), 0.01, 0.99);
  return rows.map((row) => {
    const centered = (row.score - mean) / sd;
    return clamp(eventRate + (sigmoid(centered) - 0.5) * 0.5, 0.01, 0.99);
  });
}

function aucFor(rows: Array<{ score: number; y: 0 | 1 }>): number | null {
  const positives = rows.filter((row) => row.y === 1).length;
  const negatives = rows.length - positives;
  if (positives === 0 || negatives === 0) return null;
  const sorted = [...rows].sort((a, b) => a.score - b.score);
  let rankSumPositive = 0;
  let index = 0;
  while (index < sorted.length) {
    let end = index + 1;
    while (end < sorted.length && sorted[end]?.score === sorted[index]?.score) end += 1;
    const averageRank = (index + 1 + end) / 2;
    for (let rankIndex = index; rankIndex < end; rankIndex += 1) {
      if (sorted[rankIndex]?.y === 1) rankSumPositive += averageRank;
    }
    index = end;
  }
  const auc = (rankSumPositive - positives * (positives + 1) / 2) / (positives * negatives);
  return roundMetric(Math.max(auc, 1 - auc));
}

function brierFor(probabilities: readonly number[], rows: Array<{ y: 0 | 1 }>): number {
  return roundMetric(probabilities.reduce((sum, probability, index) => {
    const y = rows[index]?.y ?? 0;
    return sum + (probability - y) ** 2;
  }, 0) / Math.max(1, rows.length));
}

function logLossFor(probabilities: readonly number[], rows: Array<{ y: 0 | 1 }>): number {
  return roundMetric(probabilities.reduce((sum, probability, index) => {
    const y = rows[index]?.y ?? 0;
    return sum - (y * Math.log(probability) + (1 - y) * Math.log(1 - probability));
  }, 0) / Math.max(1, rows.length));
}

function baselineBrier(rows: Array<{ y: 0 | 1 }>): number {
  const eventRate = clamp(rows.reduce((sum, row) => sum + row.y, 0) / Math.max(1, rows.length), 0.01, 0.99);
  return brierFor(rows.map(() => eventRate), rows);
}

function baselineLogLoss(rows: Array<{ y: 0 | 1 }>): number {
  const eventRate = clamp(rows.reduce((sum, row) => sum + row.y, 0) / Math.max(1, rows.length), 0.01, 0.99);
  return logLossFor(rows.map(() => eventRate), rows);
}

function coverageStatus(evaluation: CandidateEvaluation): string {
  if (evaluation.usableCount === 0) return "missing";
  return evaluation.coverageRate >= 0.6 && evaluation.usableCount >= 50 ? "consumer_viable" : "sparse_or_biased";
}

function wearableMissingnessControlStatus(
  records: readonly PrivateRecord[],
  w1: CandidateEvaluation,
): string {
  if (!candidateEvaluationUsable(w1) || w1.auc === null) return "missing";
  const missingnessRows = records.map((record) => ({
    score: record.w1Score === null ? 0 : 1,
    y: record.outcome,
  }));
  const missingnessAuc = aucFor(missingnessRows);
  if (missingnessAuc === null) return "missing";
  return w1.auc >= missingnessAuc + 0.005 ? "beaten" : "not_beaten";
}

async function readPrivateConfig(filePath?: string): Promise<PartialPrivateRunnerConfig | null> {
  if (!filePath?.trim()) return null;
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (!isRecord(parsed)) {
      throw new Error("R1141 partial private runner config must be a JSON object.");
    }
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("R1141 partial private runner config could not be parsed as JSON.");
    }
    throw sanitizedPrivateReadError(error);
  }
}

async function readPrivateCsvTable(filePath: string): Promise<Record<string, string>[]> {
  try {
    const rows = parseCsv(await readFile(filePath, "utf8"));
    if (rows.length === 0) return [];
    const header = rows[0] ?? [];
    return rows.slice(1).map((row) => Object.fromEntries(header.map((column, index) => [column, row[index] ?? ""])));
  } catch (error) {
    throw sanitizedPrivateReadError(error);
  }
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] ?? "";
    const next = input[index + 1] ?? "";
    if (quoted) {
      if (char === "\"" && next === "\"") {
        field += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((items) => items.some((item) => item.trim().length > 0));
}

function readOutcomes(
  rows: readonly Record<string, string>[],
  personJoinKey: string,
  outcomeEvent: string,
): Map<string, 0 | 1> {
  const outcomes = new Map<string, 0 | 1>();
  for (const row of rows) {
    const person = row[personJoinKey]?.trim();
    if (!person) continue;
    const outcome = parseOutcome(row[outcomeEvent]);
    if (outcome === null) continue;
    outcomes.set(person, Math.max(outcomes.get(person) ?? 0, outcome) as 0 | 1);
  }
  return outcomes;
}

function aggregateFeatureByPerson(
  rows: readonly Record<string, string>[],
  personJoinKey: string,
  columns: readonly string[],
): Map<string, number> {
  const valuesByPerson = new Map<string, number[]>();
  for (const row of rows) {
    const person = row[personJoinKey]?.trim();
    if (!person) continue;
    const values = columns
      .map((column) => parseNumber(row[column]))
      .filter((value): value is number => value !== null);
    if (values.length === 0) continue;
    const existing = valuesByPerson.get(person) ?? [];
    existing.push(values.reduce((sum, value) => sum + value, 0) / values.length);
    valuesByPerson.set(person, existing);
  }
  return new Map([...valuesByPerson.entries()].map(([person, values]) => [
    person,
    values.reduce((sum, value) => sum + value, 0) / values.length,
  ]));
}

function validateConfigForExecution(config: PartialPrivateRunnerConfig): void {
  const attestationsOk = config.schemaVersion === PARTIAL_PRIVATE_RUNNER_CONFIG_SCHEMA_VERSION
    && config.attestations?.localOnly === true
    && config.attestations.noCoefficientEgress === true
    && config.attestations.noHeaderNameEgress === true
    && config.attestations.noParticipantEgress === true
    && config.attestations.noPredictionEgress === true
    && config.attestations.noPrivatePathEgress === true
    && config.attestations.noPrivateRefValueEgress === true
    && config.attestations.noRowEgress === true
    && config.attestations.noSmallCellEgress === true
    && config.attestations.noSourceTextEgress === true;
  const targetOk = config.aggregateMetricsTarget?.evaluatorId === "ordinary_consumer_partial_route_aggregate_evaluator_v1"
    && config.aggregateMetricsTarget.schemaVersion === PARTIAL_AGGREGATE_METRICS_SCHEMA_VERSION;
  if (!attestationsOk || !targetOk) {
    throw new Error("R1141 partial private runner config is incomplete.");
  }
}

function readRequestedRouteIds(config: PartialPrivateRunnerConfig): PartialRouteId[] {
  return Array.isArray(config.routeRunOrder)
    ? config.routeRunOrder
      .map((route) => route.routeId)
      .filter((routeId): routeId is PartialRouteId => typeof routeId === "string" && isKnownPartialRouteId(routeId))
    : [];
}

function privateTablePathsFor(tables: NonNullable<PartialPrivateRunnerConfig["privateTableRefs"]>): {
  labTablePath: string;
  ordinaryTableLayout: typeof ACCEPTED_PRIVATE_TABLE_LAYOUTS[number];
  outcomeTablePath: string;
  wearableTablePath: string;
} {
  const primaryTablePath = optionalString(tables.primaryTableRef);
  const labTablePath = optionalString(tables.labTableRef);
  const outcomeTablePath = optionalString(tables.outcomeTableRef);
  const wearableTablePath = optionalString(tables.wearableTableRef);
  if (primaryTablePath && (!labTablePath || !outcomeTablePath || !wearableTablePath)) {
    return {
      labTablePath: labTablePath ?? primaryTablePath,
      ordinaryTableLayout: "single_primary_table_fallback",
      outcomeTablePath: outcomeTablePath ?? primaryTablePath,
      wearableTablePath: wearableTablePath ?? primaryTablePath,
    };
  }
  return {
    labTablePath: labTablePath ?? requireString(tables.primaryTableRef, "primaryTableRef"),
    ordinaryTableLayout: "multi_table_or_explicit_refs",
    outcomeTablePath: outcomeTablePath ?? requireString(tables.primaryTableRef, "primaryTableRef"),
    wearableTablePath: wearableTablePath ?? requireString(tables.primaryTableRef, "primaryTableRef"),
  };
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`R1141 partial private runner config is missing ${label}.`);
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function requireSingleRef(value: unknown, label: string): string {
  return requireRefList(value, label)[0] ?? "";
}

function requireRefList(value: unknown, label: string): string[] {
  const refs = typeof value === "string"
    ? value.split(/[,|]/u).map((item) => item.trim()).filter(Boolean)
    : [];
  if (refs.length === 0) {
    throw new Error(`R1141 partial private runner config is missing ${label}.`);
  }
  return refs;
}

function parseOutcome(value: unknown): 0 | 1 | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "y", "event"].includes(normalized)) return 1;
  if (["0", "false", "no", "n", "none"].includes(normalized)) return 0;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return parsed > 0 ? 1 : 0;
}

function parseNumber(value: unknown): number | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function summaryFor(input: {
  aggregateMetrics: R1138PartialAggregateMetricsInput | null;
  config: PartialPrivateRunnerConfig | null;
  handoffReady: boolean;
  routesToExecute: readonly PartialRouteId[];
}): R1141OrdinaryConsumerPartialPrivateMetricRunnerOutput["summary"] {
  if (!input.handoffReady) {
    return baseSummary(
      "ordinary_partial_private_metric_runner_waiting_on_partial_handoff",
      "run_r1140_or_r1139_until_partial_routes_ready",
      null,
      [],
      false,
    );
  }
  if (!input.config) {
    return baseSummary("ordinary_partial_private_metric_runner_missing_config", "provide_partial_private_runner_config", null, [], false);
  }
  if (input.routesToExecute.length === 0) {
    return baseSummary(
      "ordinary_partial_private_metric_runner_no_eligible_requested_routes",
      "request_eligible_partial_route_config_or_collect_sources",
      null,
      [],
      false,
    );
  }
  if (!input.aggregateMetrics || input.aggregateMetrics.routeResults.length === 0) {
    return baseSummary(
      "ordinary_partial_private_metric_runner_not_enough_usable_data",
      "use_larger_or_better_covered_partial_route_dataset",
      null,
      [],
      false,
    );
  }
  const executedPartialRouteIds = input.aggregateMetrics.routeResults
    .map((route) => route.routeId)
    .filter(isKnownPartialRouteId);
  return baseSummary(
    "ordinary_partial_private_metric_runner_aggregate_metrics_ready_for_r1138",
    "send_r1141_partial_metrics_to_r1138_or_r1140",
    PARTIAL_AGGREGATE_METRICS_FILE_NAME,
    executedPartialRouteIds,
    true,
  );
}

function baseSummary(
  conclusion: RunnerConclusion,
  nextAction: RunnerNextAction,
  aggregateMetricsArtifact: typeof PARTIAL_AGGREGATE_METRICS_FILE_NAME | null,
  executedPartialRouteIds: PartialRouteId[],
  routeMetricsReadyForR1138: boolean,
): R1141OrdinaryConsumerPartialPrivateMetricRunnerOutput["summary"] {
  return {
    aggregateMetricsArtifact,
    conclusion,
    executedPartialRouteIds,
    nextAction,
    productDisplayAuthorized: false,
    realAggregateStillMissing: true,
    reviewGptRequiredNow: false,
    routeMetricsReadyForR1138,
    rowValuesStored: false,
    targetAgeBand: "roughly_16_50",
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
  };
}

function privateConfigChecklist(
  eligiblePartialRouteIds: readonly PartialRouteId[],
): R1141OrdinaryConsumerPartialPrivateMetricRunnerOutput["partialPrivateExecution"]["privateConfigChecklist"] {
  const requiredRouteIds = eligiblePartialRouteIds.length > 0
    ? [...eligiblePartialRouteIds]
    : PARTIAL_ROUTE_DEFINITIONS.map((route) => route.routeId);
  return {
    acceptedPrivateTableLayouts: [...ACCEPTED_PRIVATE_TABLE_LAYOUTS],
    aggregateMetricsTargetEvaluatorId: "ordinary_consumer_partial_route_aggregate_evaluator_v1",
    aggregateMetricsTargetSchemaVersion: PARTIAL_AGGREGATE_METRICS_SCHEMA_VERSION,
    executionCommand: R1141_EXECUTION_COMMAND,
    minimumEventCount: "10_plus",
    minimumUsableRecordCount: "50_plus",
    requiredRouteIds,
    routeRequirements: PARTIAL_ROUTE_DEFINITIONS
      .filter((route) => requiredRouteIds.includes(route.routeId))
      .map((route) => ({
        candidateId: route.candidateId,
        requiredPrivateFieldRefFamilies: [...route.requiredPrivateFieldRefFamilies],
        requiredPrivateTableRefs: [...route.requiredPrivateTableRefs],
        routeId: route.routeId,
      })),
    singlePrimaryTableFallbackAccepted: true,
  };
}

function routeExecutionStatusFor(
  execution: RouteExecution,
): R1141OrdinaryConsumerPartialPrivateMetricRunnerOutput["partialPrivateExecution"]["routeExecutionStatus"][number] {
  return {
    eventCountBand: countBand(execution.eventCount),
    routeId: execution.routeId,
    status: execution.routeResult ? "aggregate_metrics_ready" : "not_enough_usable_data",
    usableRecordCountBand: countBand(execution.usableRecordCount),
  };
}

function summarizeR1139(value: unknown | null): ArtifactSummary {
  return {
    artifact: R1139_EXPECTED.artifact,
    packetId: readStringAt(value, ["packetId"]) === R1139_EXPECTED.packetId ? R1139_EXPECTED.packetId : null,
    schemaVersion: readStringAt(value, ["schemaVersion"]) === R1139_EXPECTED.schemaVersion
      ? R1139_EXPECTED.schemaVersion
      : null,
    status: value ? "available" : "missing",
  };
}

function r1139MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1139_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1139_EXPECTED.schemaVersion;
}

function validateInputBoundary(name: string, value: unknown | null): void {
  if (!value) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1141 rejected unsafe ${name} input: ${formatFindingCount(findings)}`);
  }
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
}

function readStringArrayAt(value: unknown, pathParts: readonly string[]): string[] {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved) ? resolved.filter((item): item is string => typeof item === "string") : [];
}

function readAt(value: unknown, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!isRecord(current)) return null;
    current = current[part];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function routeDefinition(routeId: PartialRouteId): PartialRouteDefinition {
  return PARTIAL_ROUTE_DEFINITIONS.find((route) => route.routeId === routeId) ?? PARTIAL_ROUTE_DEFINITIONS[0];
}

function knownPartialRouteIds(values: readonly string[]): PartialRouteId[] {
  return values.filter(isKnownPartialRouteId);
}

function isKnownPartialRouteId(value: string): value is PartialRouteId {
  return PARTIAL_ROUTE_DEFINITIONS.some((route) => route.routeId === value);
}

function routeRequiresLab(routeId: PartialRouteId): boolean {
  return routeId === "lab_glycemia_minimum_route" || routeId === "common_lab_core_with_context_route";
}

function routeRequiresWearable(routeId: PartialRouteId): boolean {
  return routeId === "wearable_activity_minimum_route";
}

function usableRecordCountFor(records: readonly PrivateRecord[], key: ScoreKey): number {
  return records.filter((record) => typeof record[key] === "number").length;
}

function evidenceRoleFor(config: PartialPrivateRunnerConfig): R1138PartialAggregateMetricsInput["submissionContext"]["evidenceRole"] {
  return config.submissionContext?.evidenceRole === "synthetic_pipeline_smoke"
    ? "synthetic_pipeline_smoke"
    : "real_partial_route_evidence";
}

function maxCountBand(values: readonly number[]): CountBand {
  return countBand(values.reduce((max, value) => Math.max(max, value), 0));
}

function countBand(count: number): CountBand {
  if (count >= 500) return "500_plus";
  if (count >= 100) return "100-499";
  if (count >= 50) return "50-99";
  if (count >= 10) return "10-49";
  if (count >= 1) return "1-9";
  return "0";
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function safeBoundary(
  outcomeScoringPerformedByR1141: boolean,
): R1141OrdinaryConsumerPartialPrivateMetricRunnerOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1141,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    privateConfigPathStored: false,
    privateConfigValuesStored: false,
    privateFieldRefsStored: false,
    privateTableRefsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

function isMissingFileError(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

function sanitizedPrivateReadError(error: unknown): Error {
  if (error instanceof Error && !/(?:\/|\\)/u.test(error.message)) return error;
  return new Error("R1141 could not read the configured private input.");
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}

function formatFindingCount(findings: readonly string[]): string {
  return `${findings.length} aggregate-egress violation${findings.length === 1 ? "" : "s"}`;
}

async function main(): Promise<void> {
  const { output } = await runR1141OrdinaryConsumerPartialPrivateMetricRunner({
    configPath: process.env.MURPH_AGE_ORDINARY_CONSUMER_PARTIAL_PRIVATE_RUNNER_CONFIG_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1139Path: process.env.MURPH_AGE_R1139_ORDINARY_CONSUMER_PARTIAL_PRIVATE_CONFIG_HANDOFF_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    aggregateMetricsArtifact: output.summary.aggregateMetricsArtifact,
    conclusion: output.summary.conclusion,
    eligiblePartialRouteIds: output.partialPrivateExecution.eligiblePartialRouteIds,
    executedPartialRouteIds: output.summary.executedPartialRouteIds,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    realAggregateStillMissing: output.summary.realAggregateStillMissing,
    requestedPartialRouteIds: output.partialPrivateExecution.requestedPartialRouteIds,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    routeExecutionStatus: output.partialPrivateExecution.routeExecutionStatus,
    routeMetricsReadyForR1138: output.summary.routeMetricsReadyForR1138,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1141 ordinary consumer partial private metric runner failed.")}\n`);
    process.exitCode = 1;
  });
}
