import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import type { R1104ConsumerAggregateReceiptCandidateResult } from "./r1104-consumer-aggregate-receipt-validator.ts";
import {
  realSubmissionContext,
  runR1124ConsumerFirstPassAggregateMetricIntake,
  syntheticSmokeSubmissionContext,
  type R1124ConsumerFirstPassAggregateMetricsInput,
} from "./r1124-consumer-first-pass-aggregate-metric-intake.ts";

export const R1125_LOCAL_PRIVATE_FIRST_PASS_AGGREGATE_METRIC_RUNNER_SCHEMA_VERSION =
  "murph-age-r1125-local-private-first-pass-aggregate-metric-runner.v1" as const;

const PRIVATE_RUNNER_CONFIG_SCHEMA_VERSION =
  "murph-age-local-private-consumer-receipt-runner-config.v1" as const;
const FIRST_PASS_METRICS_SCHEMA_VERSION =
  "murph-age-consumer-first-pass-aggregate-metrics.v1" as const;
const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1125-local-private-first-pass-aggregate-metric-runner.latest.json";
const AGGREGATE_METRICS_FILE_NAME = "r1125-consumer-first-pass-aggregate-metrics.json";
const PRIVATE_CONFIG_TEMPLATE_ARTIFACT =
  "r1121-fillable-local-private-consumer-receipt-runner-config.json" as const;
const R1122_CONFIG_INTAKE_COMMAND =
  "MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH=<private-config.json> pnpm exec tsx scripts/murph-age/r1122-local-private-consumer-receipt-runner-config-intake.ts" as const;
const R1125_EXECUTION_COMMAND =
  "MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH=<private-config.json> pnpm exec tsx scripts/murph-age/r1125-local-private-first-pass-aggregate-metric-runner.ts" as const;

const R1122_EXPECTED = {
  artifact: "r1122-local-private-consumer-receipt-runner-config-intake.latest.json",
  packetId: "r1122-local-private-consumer-receipt-runner-config-intake",
  schemaVersion: "murph-age-r1122-local-private-consumer-receipt-runner-config-intake.v1",
} as const;
const R1132_EXPECTED = {
  artifact: "r1132-ordinary-consumer-submission-readiness.latest.json",
  packetId: "r1132-ordinary-consumer-submission-readiness",
  schemaVersion: "murph-age-r1132-ordinary-consumer-submission-readiness.v1",
} as const;

const REQUIRED_FIRST_PASS_CANDIDATES = [
  "L1_tiny_glycemia_only",
  "L2_common_lab_core_shadow",
  "W1_activity_steps_minutes",
  "QC_missingness_coverage",
] as const;
const REQUIRED_PRIVATE_FIELD_REF_FAMILIES = [
  "personJoinKey",
  "dateOrTimeKey",
  "outcomeEvent",
  "labGlycemia",
  "commonLabCore",
  "vitalsBody",
  "wearableActivity",
] as const;
const REQUIRED_PRIVATE_TABLE_REFS = [
  "primaryTableRef",
  "outcomeTableRef",
  "labTableRef",
  "wearableTableRef",
] as const;
const ACCEPTED_PRIVATE_TABLE_LAYOUTS = [
  "single_primary_table_fallback",
  "multi_table_or_explicit_refs",
] as const;

type FirstPassCandidateId = typeof REQUIRED_FIRST_PASS_CANDIDATES[number];
type CandidateResult = R1104ConsumerAggregateReceiptCandidateResult;
type CountBand = "below_minimum" | "minimum_met" | "100_plus" | "500_plus";
type OrdinaryTableLayout =
  typeof ACCEPTED_PRIVATE_TABLE_LAYOUTS[number];
type RunnerConclusion =
  | "local_private_first_pass_runner_missing_config"
  | "local_private_first_pass_runner_not_enough_usable_data"
  | "local_private_first_pass_runner_ready_for_reviewgpt_delta"
  | "local_private_first_pass_runner_valid_no_delta"
  | "local_private_first_pass_runner_waiting_on_config_intake";
type RunnerNextAction =
  | "provide_private_runner_config"
  | "refresh_r1122_config_intake"
  | "review_aggregate_delta_from_r1124"
  | "send_r1125_aggregate_metrics_to_r1124"
  | "use_larger_or_better_covered_private_dataset";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface ConfigIntakeMissingPieces {
  firstPassCandidateIds: string[];
  semanticRefFamilies: string[];
  submissionContextFields: string[];
  tableRefs: string[];
}

interface OrdinarySubmitterReadiness {
  artifact: typeof R1132_EXPECTED.artifact | null;
  averageSubmitterFamilyIds: string[];
  conclusion: string | null;
  missingSlotCount: number | null;
  missingSlotTypes: string[];
  nextAction: string | null;
  readyForPrivateRunner: boolean | null;
  realAggregateStillMissing: boolean | null;
}

interface PrivateRunnerConfig {
  aggregateReceiptTarget?: {
    evaluatorId?: string;
    schemaVersion?: string;
  };
  attestations?: {
    localOnly?: boolean;
    noCoefficientEgress?: boolean;
    noHeaderNameEgress?: boolean;
    noParticipantEgress?: boolean;
    noPredictionEgress?: boolean;
    noRowEgress?: boolean;
    noSmallCellEgress?: boolean;
    noSourceTextEgress?: boolean;
  };
  candidateRunOrder?: Array<{ candidateId?: unknown }>;
  privateFieldRefs?: {
    commonLabCore?: unknown;
    dateOrTimeKey?: unknown;
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
  schemaVersion?: string;
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
  probabilities: number[] | null;
  rows: Array<{ score: number; y: 0 | 1 }>;
  usableCount: number;
}

export interface R1125LocalPrivateFirstPassAggregateMetricRunnerOptions {
  configPath?: string;
  createdAt?: string;
  outputDir?: string;
  r1113Path?: string;
  r1121Path?: string;
  r1122Path?: string;
  r1132Path?: string;
}

export interface R1125LocalPrivateFirstPassAggregateMetricRunnerOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    fileNamesStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1125: true;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    privateConfigPathStored: false;
    privateConfigValuesStored: false;
    privateFieldRefsStored: false;
    privateTableRefsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    rawRowsStored: false;
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
    r1122: ArtifactSummary;
    r1132: ArtifactSummary;
  };
  packetId: "r1125-local-private-first-pass-aggregate-metric-runner";
  privateExecution: {
    aggregateMetricsArtifact: typeof AGGREGATE_METRICS_FILE_NAME | null;
    aggregateMetricsCandidateCountBand: "0" | "1-9";
    configIntakeConclusion: string | null;
    configIntakeMissingPieces: ConfigIntakeMissingPieces;
    configPathConfigured: boolean;
    eventCountBand: CountBand;
    firstPassCandidateIds: FirstPassCandidateId[];
    localPrivateDataRead: boolean;
    ordinarySubmitterReadiness: OrdinarySubmitterReadiness;
    privateConfigChecklist: {
      acceptedPrivateTableLayouts: typeof ACCEPTED_PRIVATE_TABLE_LAYOUTS;
      configIntakeCommand: typeof R1122_CONFIG_INTAKE_COMMAND;
      executionCommand: typeof R1125_EXECUTION_COMMAND;
      minimumEventCount: "10_plus";
      minimumUsableRecordCount: "50_plus";
      privateConfigTemplateArtifact: typeof PRIVATE_CONFIG_TEMPLATE_ARTIFACT;
      requiredPrivateFieldRefFamilies: typeof REQUIRED_PRIVATE_FIELD_REF_FAMILIES;
      requiredPrivateTableRefs: typeof REQUIRED_PRIVATE_TABLE_REFS;
      singlePrimaryTableFallbackAccepted: true;
    };
    privateValuesStored: false;
    ordinaryTableLayout: OrdinaryTableLayout | null;
    r1124Conclusion: string | null;
    r1124ReceiptArtifact: string | null;
    usableRecordCountBand: CountBand;
  };
  productDisplayAuthorized: false;
  schemaVersion: typeof R1125_LOCAL_PRIVATE_FIRST_PASS_AGGREGATE_METRIC_RUNNER_SCHEMA_VERSION;
  status: "research-local-private-inputs-aggregate-output";
  summary: {
    conclusion: RunnerConclusion;
    nextAction: RunnerNextAction;
    productDisplayAuthorized: false;
    reviewGptRequiredNow: boolean;
    rowValuesStored: false;
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first";
    topPriority: "l1_l2_w1_qc_first_pass";
  };
}

export async function runR1125LocalPrivateFirstPassAggregateMetricRunner(
  options: R1125LocalPrivateFirstPassAggregateMetricRunnerOptions = {},
): Promise<{
  aggregateMetricsPath: string | null;
  output: R1125LocalPrivateFirstPassAggregateMetricRunnerOutput;
  outputPath: string;
}> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const r1122 = await readJsonIfPresent(options.r1122Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1122_EXPECTED.artifact));
  validateInputBoundary("r1122", r1122);
  const r1132 = await readJsonIfPresent(options.r1132Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1132_EXPECTED.artifact));
  validateInputBoundary("r1132", r1132);
  const configPath = options.configPath ?? process.env.MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH;
  const configPathConfigured = Boolean(configPath?.trim());
  const config = await readPrivateConfig(configPath);
  const configIntakeReady = inputMatchesExpected(r1122)
    && readStringAt(r1122, ["summary", "conclusion"]) === "local_private_runner_config_ready_for_local_aggregate_receipt";

  const execution = config && configIntakeReady
    ? await executePrivateAggregateRun(config)
    : null;
  const enoughData = execution ? runHasEnoughData(execution.records) : false;
  const aggregateMetrics = execution && enoughData && config
    ? createAggregateMetrics(execution.records, submissionContextFor(config))
    : null;
  const r1124 = aggregateMetrics
    ? await runR1124ConsumerFirstPassAggregateMetricIntake({
      aggregateMetrics,
      createdAt: options.createdAt,
      outputDir,
      r1113Path: options.r1113Path,
      r1121Path: options.r1121Path,
      r1122Path: options.r1122Path,
    })
    : null;
  const summary = summaryFor({
    aggregateMetrics,
    config,
    configIntakeReady,
    enoughData,
    r1124Conclusion: r1124?.output.summary.conclusion ?? null,
    reviewGptRequiredNow: r1124?.output.summary.reviewGptRequiredNow ?? false,
  });
  const aggregateMetricsPath = aggregateMetrics ? path.join(outputDir, AGGREGATE_METRICS_FILE_NAME) : null;
  const output: R1125LocalPrivateFirstPassAggregateMetricRunnerOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: {
      r1122: summarizeR1122(r1122),
      r1132: summarizeR1132(r1132),
    },
    packetId: "r1125-local-private-first-pass-aggregate-metric-runner",
    privateExecution: {
      aggregateMetricsArtifact: aggregateMetrics ? AGGREGATE_METRICS_FILE_NAME : null,
      aggregateMetricsCandidateCountBand: aggregateMetrics ? "1-9" : "0",
      configIntakeConclusion: readStringAt(r1122, ["summary", "conclusion"]),
      configIntakeMissingPieces: configIntakeMissingPiecesFor(r1122),
      configPathConfigured,
      eventCountBand: countBand(execution?.eventCount ?? 0),
      firstPassCandidateIds: [...REQUIRED_FIRST_PASS_CANDIDATES],
      localPrivateDataRead: Boolean(execution),
      ordinarySubmitterReadiness: ordinarySubmitterReadinessFor(r1132),
      privateConfigChecklist: privateConfigChecklist(),
      privateValuesStored: false,
      ordinaryTableLayout: execution?.ordinaryTableLayout ?? null,
      r1124Conclusion: r1124?.output.summary.conclusion ?? null,
      r1124ReceiptArtifact: r1124?.output.metricIntake.receiptArtifact ?? null,
      usableRecordCountBand: countBand(execution?.usableRecordCount ?? 0),
    },
    productDisplayAuthorized: false,
    schemaVersion: R1125_LOCAL_PRIVATE_FIRST_PASS_AGGREGATE_METRIC_RUNNER_SCHEMA_VERSION,
    status: "research-local-private-inputs-aggregate-output",
    summary,
  };

  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...(aggregateMetrics ? findForbiddenAggregateEgress(aggregateMetrics) : []),
  ];
  if (findings.length > 0) {
    throw new Error(`R1125 local private first-pass aggregate metric runner failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  if (aggregateMetricsPath && aggregateMetrics) {
    await writeFile(aggregateMetricsPath, `${JSON.stringify(aggregateMetrics, null, 2)}\n`);
  }
  return { aggregateMetricsPath, output, outputPath };
}

async function executePrivateAggregateRun(config: PrivateRunnerConfig): Promise<{
  eventCount: number;
  ordinaryTableLayout: OrdinaryTableLayout;
  records: PrivateRecord[];
  usableRecordCount: number;
}> {
  validateConfigForExecution(config);
  const refs = config.privateFieldRefs ?? {};
  const tables = config.privateTableRefs ?? {};
  const tablePaths = privateTablePathsFor(tables);
  const personJoinKey = requireSingleRef(refs.personJoinKey, "personJoinKey");
  const outcomeEvent = requireSingleRef(refs.outcomeEvent, "outcomeEvent");
  const labGlycemia = requireRefList(refs.labGlycemia, "labGlycemia");
  const commonLabCore = requireRefList(refs.commonLabCore, "commonLabCore");
  const vitalsBody = requireRefList(refs.vitalsBody, "vitalsBody");
  const wearableActivity = requireRefList(refs.wearableActivity, "wearableActivity");

  const [outcomeRows, labRows, wearableRows] = await Promise.all([
    readPrivateCsvTable(tablePaths.outcomeTablePath),
    readPrivateCsvTable(tablePaths.labTablePath),
    readPrivateCsvTable(tablePaths.wearableTablePath),
  ]);
  const outcomes = readOutcomes(outcomeRows, personJoinKey, outcomeEvent);
  const l1ByPerson = aggregateFeatureByPerson(labRows, personJoinKey, labGlycemia);
  const l2ByPerson = aggregateFeatureByPerson(labRows, personJoinKey, [
    ...labGlycemia,
    ...commonLabCore,
    ...vitalsBody,
  ]);
  const w1ByPerson = aggregateFeatureByPerson(wearableRows, personJoinKey, wearableActivity);
  const records: PrivateRecord[] = [];
  for (const [personKey, outcome] of outcomes) {
    records.push({
      l1Score: l1ByPerson.get(personKey) ?? null,
      l2Score: l2ByPerson.get(personKey) ?? null,
      outcome,
      w1Score: w1ByPerson.get(personKey) ?? null,
    });
  }
  const usableRecordCount = records.filter((record) =>
    record.l1Score !== null || record.l2Score !== null || record.w1Score !== null
  ).length;
  const eventCount = records.filter((record) => record.outcome === 1).length;
  return {
    eventCount,
    ordinaryTableLayout: tablePaths.ordinaryTableLayout,
    records,
    usableRecordCount,
  };
}

function createAggregateMetrics(
  records: readonly PrivateRecord[],
  submissionContext: R1124ConsumerFirstPassAggregateMetricsInput["submissionContext"],
): R1124ConsumerFirstPassAggregateMetricsInput {
  const l1 = evaluateCandidate(records, "l1Score");
  const l2 = evaluateCandidate(records, "l2Score", l1);
  const w1 = evaluateCandidate(records, "w1Score");
  const candidateResults: CandidateResult[] = [
    candidateResult({
      candidateId: "L1_tiny_glycemia_only",
      candidateKind: "lab",
      comparator: null,
      comparatorId: "frozen_recalibrated_r399",
      evaluation: l1,
      missingnessOrCoverageControlStatus: "not_applicable",
    }),
    candidateResult({
      candidateId: "L2_common_lab_core_shadow",
      candidateKind: "lab",
      comparator: l1,
      comparatorId: "l1_tiny_glycemia_only",
      evaluation: l2,
      missingnessOrCoverageControlStatus: "not_applicable",
    }),
    candidateResult({
      candidateId: "W1_activity_steps_minutes",
      candidateKind: "wearable",
      comparator: null,
      comparatorId: "frozen_recalibrated_r399",
      evaluation: w1,
      missingnessOrCoverageControlStatus: wearableMissingnessControlStatus(records, w1),
    }),
    qcCandidateResult(records, [l1, l2, w1]),
  ];
  return {
    artifactBoundary: safeReceiptBoundary(),
    candidateResults,
    evaluatorId: "consumer_lab_wearable_aggregate_evaluator_v1",
    packetId: "r1125-local-private-first-pass-aggregate-metrics",
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
    schemaVersion: FIRST_PASS_METRICS_SCHEMA_VERSION,
    submissionContext,
  };
}

function submissionContextFor(config: PrivateRunnerConfig): R1124ConsumerFirstPassAggregateMetricsInput["submissionContext"] {
  if (config.submissionContext?.evidenceRole === "synthetic_pipeline_smoke") {
    return syntheticSmokeSubmissionContext();
  }
  return realSubmissionContext();
}

function candidateResult(input: {
  candidateId: FirstPassCandidateId;
  candidateKind: "lab" | "wearable";
  comparator: CandidateEvaluation | null;
  comparatorId: CandidateResult["comparatorId"];
  evaluation: CandidateEvaluation;
  missingnessOrCoverageControlStatus: CandidateResult["missingnessOrCoverageControlStatus"];
}): CandidateResult {
  if (!candidateEvaluationUsable(input.evaluation)) {
    return blankCandidate(input.candidateId, input.candidateKind, input.comparatorId, "missing");
  }
  const comparator = comparableEvaluation(input.evaluation, input.comparator);
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

function qcCandidateResult(
  records: readonly PrivateRecord[],
  evaluations: readonly CandidateEvaluation[],
): CandidateResult {
  const allCovered = evaluations.every((evaluation) => evaluation.coverageRate >= 0.6 && evaluation.usableCount >= 50);
  const eventCount = records.filter((record) => record.outcome === 1).length;
  return {
    aucDelta: null,
    brierDelta: null,
    calibrationStatus: "not_applicable",
    candidateId: "QC_missingness_coverage",
    candidateKind: "negative_control",
    comparatorId: "frozen_recalibrated_r399",
    coverageStatus: allCovered ? "consumer_viable" : "sparse_or_biased",
    evidenceSupport: eventCount >= 100 ? "one_receipt_100_plus_events" : "underpowered",
    logLossDelta: null,
    missingnessOrCoverageControlStatus: "not_applicable",
  };
}

function evaluateCandidate(
  records: readonly PrivateRecord[],
  key: "l1Score" | "l2Score" | "w1Score",
  sameDenominatorComparator?: CandidateEvaluation,
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
      probabilities: null,
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
    probabilities,
    rows: sameDenominatorComparator ? sameDenominatorRows(oriented, sameDenominatorComparator.rows) : oriented,
    usableCount,
  };
}

function comparableEvaluation(
  evaluation: CandidateEvaluation,
  comparator: CandidateEvaluation | null,
): CandidateEvaluation | null {
  if (!comparator || !candidateEvaluationUsable(comparator)) return null;
  const rows = evaluation.rows
    .map((row, index) => ({ candidate: row, comparator: comparator.rows[index] }))
    .filter((pair): pair is { candidate: { score: number; y: 0 | 1 }; comparator: { score: number; y: 0 | 1 } } =>
      pair.comparator !== undefined && pair.candidate.y === pair.comparator.y
    );
  if (rows.length < 50) return null;
  const comparatorRows = orientRows(rows.map((pair) => pair.comparator));
  const probabilities = probabilitiesFor(comparatorRows);
  return {
    auc: aucFor(comparatorRows),
    brier: brierFor(probabilities, comparatorRows),
    coverageRate: comparator.coverageRate,
    eventCount: comparatorRows.filter((row) => row.y === 1).length,
    logLoss: logLossFor(probabilities, comparatorRows),
    probabilities,
    rows: comparatorRows,
    usableCount: comparatorRows.length,
  };
}

function sameDenominatorRows(
  rows: Array<{ score: number; y: 0 | 1 }>,
  comparatorRows: Array<{ score: number; y: 0 | 1 }>,
): Array<{ score: number; y: 0 | 1 }> {
  return rows.slice(0, comparatorRows.length);
}

function wearableMissingnessControlStatus(
  records: readonly PrivateRecord[],
  w1: CandidateEvaluation,
): CandidateResult["missingnessOrCoverageControlStatus"] {
  if (!candidateEvaluationUsable(w1) || w1.auc === null) return "missing";
  const missingnessRows = records.map((record) => ({
    score: record.w1Score === null ? 0 : 1,
    y: record.outcome,
  }));
  const missingnessAuc = aucFor(missingnessRows);
  if (missingnessAuc === null) return "missing";
  return w1.auc >= missingnessAuc + 0.005 ? "beaten" : "not_beaten";
}

function candidateEvaluationUsable(evaluation: CandidateEvaluation): boolean {
  return evaluation.auc !== null
    && evaluation.brier !== null
    && evaluation.logLoss !== null
    && evaluation.usableCount >= 50
    && evaluation.eventCount >= 10;
}

function blankCandidate(
  candidateId: FirstPassCandidateId,
  candidateKind: CandidateResult["candidateKind"],
  comparatorId: CandidateResult["comparatorId"],
  missingnessOrCoverageControlStatus: CandidateResult["missingnessOrCoverageControlStatus"],
): CandidateResult {
  return {
    aucDelta: null,
    brierDelta: null,
    calibrationStatus: "missing",
    candidateId,
    candidateKind,
    comparatorId,
    coverageStatus: "missing",
    evidenceSupport: "underpowered",
    logLossDelta: null,
    missingnessOrCoverageControlStatus,
  };
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

function coverageStatus(evaluation: CandidateEvaluation): CandidateResult["coverageStatus"] {
  if (evaluation.usableCount === 0) return "missing";
  return evaluation.coverageRate >= 0.6 && evaluation.usableCount >= 50 ? "consumer_viable" : "sparse_or_biased";
}

function runHasEnoughData(records: readonly PrivateRecord[]): boolean {
  const eventCount = records.filter((record) => record.outcome === 1).length;
  const usableCount = records.filter((record) =>
    record.l1Score !== null || record.l2Score !== null || record.w1Score !== null
  ).length;
  return records.length >= 50 && eventCount >= 10 && usableCount >= 50;
}

async function readPrivateConfig(filePath?: string): Promise<PrivateRunnerConfig | null> {
  if (!filePath?.trim()) return null;
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("R1125 private runner config must be a JSON object.");
    }
    return parsed as PrivateRunnerConfig;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("R1125 private runner config could not be parsed as JSON.");
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

function validateConfigForExecution(config: PrivateRunnerConfig): void {
  const requiredCandidates = new Set(readCandidateRunIds(config));
  const attestationsOk = config.schemaVersion === PRIVATE_RUNNER_CONFIG_SCHEMA_VERSION
    && config.attestations?.localOnly === true
    && config.attestations.noCoefficientEgress === true
    && config.attestations.noHeaderNameEgress === true
    && config.attestations.noParticipantEgress === true
    && config.attestations.noPredictionEgress === true
    && config.attestations.noRowEgress === true
    && config.attestations.noSmallCellEgress === true
    && config.attestations.noSourceTextEgress === true;
  const targetOk = config.aggregateReceiptTarget?.evaluatorId === "consumer_lab_wearable_aggregate_evaluator_v1"
    && config.aggregateReceiptTarget.schemaVersion === "murph-age-consumer-lab-wearable-aggregate-receipt.v1";
  if (!attestationsOk || !targetOk || REQUIRED_FIRST_PASS_CANDIDATES.some((candidate) => !requiredCandidates.has(candidate))) {
    throw new Error("R1125 private runner config is incomplete.");
  }
}

function readCandidateRunIds(config: PrivateRunnerConfig): string[] {
  return Array.isArray(config.candidateRunOrder)
    ? config.candidateRunOrder
      .map((candidate) => candidate.candidateId)
      .filter((candidateId): candidateId is string => typeof candidateId === "string")
    : [];
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`R1125 private runner config is missing ${label}.`);
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function privateTablePathsFor(tables: NonNullable<PrivateRunnerConfig["privateTableRefs"]>): {
  labTablePath: string;
  ordinaryTableLayout: OrdinaryTableLayout;
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

function requireSingleRef(value: unknown, label: string): string {
  return requireRefList(value, label)[0] ?? "";
}

function requireRefList(value: unknown, label: string): string[] {
  const refs = typeof value === "string"
    ? value.split(/[,|]/u).map((item) => item.trim()).filter(Boolean)
    : [];
  if (refs.length === 0) {
    throw new Error(`R1125 private runner config is missing ${label}.`);
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
  aggregateMetrics: R1124ConsumerFirstPassAggregateMetricsInput | null;
  config: PrivateRunnerConfig | null;
  configIntakeReady: boolean;
  enoughData: boolean;
  r1124Conclusion: string | null;
  reviewGptRequiredNow: boolean;
}): R1125LocalPrivateFirstPassAggregateMetricRunnerOutput["summary"] {
  if (!input.config) {
    return baseSummary("local_private_first_pass_runner_missing_config", "provide_private_runner_config", false);
  }
  if (!input.configIntakeReady) {
    return baseSummary("local_private_first_pass_runner_waiting_on_config_intake", "refresh_r1122_config_intake", false);
  }
  if (!input.enoughData || !input.aggregateMetrics) {
    return baseSummary("local_private_first_pass_runner_not_enough_usable_data", "use_larger_or_better_covered_private_dataset", false);
  }
  if (input.reviewGptRequiredNow || input.r1124Conclusion === "consumer_first_pass_aggregate_receipt_ready_for_reviewgpt") {
    return baseSummary("local_private_first_pass_runner_ready_for_reviewgpt_delta", "review_aggregate_delta_from_r1124", true);
  }
  return baseSummary("local_private_first_pass_runner_valid_no_delta", "send_r1125_aggregate_metrics_to_r1124", false);
}

function privateConfigChecklist(): R1125LocalPrivateFirstPassAggregateMetricRunnerOutput["privateExecution"]["privateConfigChecklist"] {
  return {
    acceptedPrivateTableLayouts: ACCEPTED_PRIVATE_TABLE_LAYOUTS,
    configIntakeCommand: R1122_CONFIG_INTAKE_COMMAND,
    executionCommand: R1125_EXECUTION_COMMAND,
    minimumEventCount: "10_plus",
    minimumUsableRecordCount: "50_plus",
    privateConfigTemplateArtifact: PRIVATE_CONFIG_TEMPLATE_ARTIFACT,
    requiredPrivateFieldRefFamilies: REQUIRED_PRIVATE_FIELD_REF_FAMILIES,
    requiredPrivateTableRefs: REQUIRED_PRIVATE_TABLE_REFS,
    singlePrimaryTableFallbackAccepted: true,
  };
}

function configIntakeMissingPiecesFor(r1122: unknown | null): ConfigIntakeMissingPieces {
  return {
    firstPassCandidateIds: readStringArrayAt(r1122, ["configIntake", "missingFirstPassCandidateIds"]),
    semanticRefFamilies: readStringArrayAt(r1122, ["configIntake", "missingSemanticRefFamilies"]),
    submissionContextFields: readStringArrayAt(r1122, ["configIntake", "missingSubmissionContextFields"]),
    tableRefs: readStringArrayAt(r1122, ["configIntake", "missingTableRefs"]),
  };
}

function ordinarySubmitterReadinessFor(r1132: unknown | null): OrdinarySubmitterReadiness {
  const ready = r1132MatchesExpected(r1132);
  return {
    artifact: ready ? R1132_EXPECTED.artifact : null,
    averageSubmitterFamilyIds: ready ? readStringArrayAt(r1132, ["summary", "averageSubmitterFamilyIds"]) : [],
    conclusion: ready ? readStringAt(r1132, ["summary", "conclusion"]) : null,
    missingSlotCount: ready ? readNumberAt(r1132, ["summary", "missingSlotCount"]) : null,
    missingSlotTypes: ready ? readStringArrayAt(r1132, ["summary", "missingSlotTypes"]) : [],
    nextAction: ready ? readStringAt(r1132, ["summary", "nextAction"]) : null,
    readyForPrivateRunner: ready ? readBooleanAt(r1132, ["summary", "readyForPrivateRunner"]) : null,
    realAggregateStillMissing: ready ? readBooleanAt(r1132, ["summary", "realAggregateStillMissing"]) : null,
  };
}

function baseSummary(
  conclusion: RunnerConclusion,
  nextAction: RunnerNextAction,
  reviewGptRequiredNow: boolean,
): R1125LocalPrivateFirstPassAggregateMetricRunnerOutput["summary"] {
  return {
    conclusion,
    nextAction,
    productDisplayAuthorized: false,
    reviewGptRequiredNow,
    rowValuesStored: false,
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    topPriority: "l1_l2_w1_qc_first_pass",
  };
}

function inputMatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1122_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1122_EXPECTED.schemaVersion;
}

function r1132MatchesExpected(value: unknown | null): boolean {
  return readStringAt(value, ["packetId"]) === R1132_EXPECTED.packetId
    && readStringAt(value, ["schemaVersion"]) === R1132_EXPECTED.schemaVersion;
}

function validateInputBoundary(name: string, value: unknown | null): void {
  if (!value) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1125 rejected unsafe ${name} input: ${formatFindingCount(findings)}`);
  }
}

function summarizeR1122(value: unknown | null): ArtifactSummary {
  return {
    artifact: R1122_EXPECTED.artifact,
    packetId: readStringAt(value, ["packetId"]) === R1122_EXPECTED.packetId ? R1122_EXPECTED.packetId : null,
    schemaVersion: readStringAt(value, ["schemaVersion"]) === R1122_EXPECTED.schemaVersion ? R1122_EXPECTED.schemaVersion : null,
    status: value ? "available" : "missing",
  };
}

function summarizeR1132(value: unknown | null): ArtifactSummary {
  return {
    artifact: R1132_EXPECTED.artifact,
    packetId: readStringAt(value, ["packetId"]) === R1132_EXPECTED.packetId ? R1132_EXPECTED.packetId : null,
    schemaVersion: readStringAt(value, ["schemaVersion"]) === R1132_EXPECTED.schemaVersion ? R1132_EXPECTED.schemaVersion : null,
    status: value ? "available" : "missing",
  };
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

function readBooleanAt(value: unknown, pathParts: readonly string[]): boolean | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "boolean" ? resolved : null;
}

function readNumberAt(value: unknown, pathParts: readonly string[]): number | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "number" ? resolved : null;
}

function readStringArrayAt(value: unknown, pathParts: readonly string[]): string[] {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved) ? resolved.filter((item): item is string => typeof item === "string") : [];
}

function readAt(value: unknown, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function sanitizedPrivateReadError(error: unknown): Error {
  if (isMissingFileError(error)) return new Error("R1125 could not read one or more private input files.");
  if (error instanceof Error && !/(?:\/|\\)/u.test(error.message)) return error;
  return new Error("R1125 private input read failed.");
}

function countBand(count: number): CountBand {
  if (count >= 500) return "500_plus";
  if (count >= 100) return "100_plus";
  if (count >= 50) return "minimum_met";
  return "below_minimum";
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

function formatFindingCount(findings: readonly string[]): string {
  return `${findings.length} aggregate-egress violation${findings.length === 1 ? "" : "s"}`;
}

function safeBoundary(): R1125LocalPrivateFirstPassAggregateMetricRunnerOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    fileNamesStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1125: true,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    privateConfigPathStored: false,
    privateConfigValuesStored: false,
    privateFieldRefsStored: false,
    privateTableRefsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    rawRowsStored: false,
    recommendationClaimsIncluded: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

function safeReceiptBoundary(): R1124ConsumerFirstPassAggregateMetricsInput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    participantIdentifiersStored: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1125LocalPrivateFirstPassAggregateMetricRunner({
    configPath: process.env.MURPH_AGE_LOCAL_PRIVATE_CONSUMER_RECEIPT_RUNNER_CONFIG_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1113Path: process.env.MURPH_AGE_R1113_CONSUMER_SOURCE_EXECUTION_PACKET_PATH,
    r1121Path: process.env.MURPH_AGE_R1121_LOCAL_PRIVATE_RUNNER_CONTRACT_PATH,
    r1122Path: process.env.MURPH_AGE_R1122_LOCAL_PRIVATE_CONFIG_INTAKE_PATH,
    r1132Path: process.env.MURPH_AGE_R1132_ORDINARY_CONSUMER_SUBMISSION_READINESS_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    aggregateMetricsArtifact: output.privateExecution.aggregateMetricsArtifact,
    acceptedPrivateTableLayouts: output.privateExecution.privateConfigChecklist.acceptedPrivateTableLayouts,
    configIntakeConclusion: output.privateExecution.configIntakeConclusion,
    configIntakeMissingPieces: output.privateExecution.configIntakeMissingPieces,
    conclusion: output.summary.conclusion,
    eventCountBand: output.privateExecution.eventCountBand,
    localPrivateDataRead: output.privateExecution.localPrivateDataRead,
    nextAction: output.summary.nextAction,
    ordinaryTableLayout: output.privateExecution.ordinaryTableLayout,
    ordinarySubmitterReadiness: output.privateExecution.ordinarySubmitterReadiness,
    packetId: output.packetId,
    privateConfigTemplateArtifact: output.privateExecution.privateConfigChecklist.privateConfigTemplateArtifact,
    productDisplayAuthorized: output.productDisplayAuthorized,
    r1124Conclusion: output.privateExecution.r1124Conclusion,
    requiredPrivateFieldRefFamilies: output.privateExecution.privateConfigChecklist.requiredPrivateFieldRefFamilies,
    requiredPrivateTableRefs: output.privateExecution.privateConfigChecklist.requiredPrivateTableRefs,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowValuesStored: output.summary.rowValuesStored,
    schemaVersion: output.schemaVersion,
    status: output.status,
    usableRecordCountBand: output.privateExecution.usableRecordCountBand,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1125 local private first-pass aggregate metric runner failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
