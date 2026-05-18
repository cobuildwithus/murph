import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import type {
  R1104ConsumerAggregateReceiptCandidateResult,
} from "./r1104-consumer-aggregate-receipt-validator.ts";
import {
  historicalShadowSubmissionContext,
  type R1124ConsumerFirstPassAggregateMetricsInput,
} from "./r1124-consumer-first-pass-aggregate-metric-intake.ts";

export const R1126_NHANES_SHADOW_FIRST_PASS_METRIC_ADAPTER_SCHEMA_VERSION =
  "murph-age-r1126-nhanes-shadow-first-pass-metric-adapter.v1" as const;

const FIRST_PASS_METRICS_SCHEMA_VERSION =
  "murph-age-consumer-first-pass-aggregate-metrics.v1" as const;
const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1126-nhanes-shadow-first-pass-metric-adapter.latest.json";
const SHADOW_METRICS_FILE_NAME = "r1126-nhanes-shadow-first-pass-aggregate-metrics.json";

const INPUTS = {
  r1038: {
    artifact: "r1038-r1034-compatible-calibrated-aggregate-receipt.latest.json",
    packetId: "r1038-nhanes-modern-lab-activity-calibrated-receipt",
    schemaVersion: "murph-age-r1038-r1034-compatible-calibrated-aggregate-receipt.v1",
  },
  r1049: {
    artifact: "r1049-nhanes-activity-control-diagnostic.latest.json",
    packetId: "r1049-nhanes-activity-control-diagnostic",
    schemaVersion: "murph-age-r1049-nhanes-activity-control-diagnostic.v1",
  },
  r1113: {
    artifact: "r1113-consumer-source-execution-packet.latest.json",
    packetId: "r1113-consumer-source-execution-packet",
    schemaVersion: "murph-age-r1113-consumer-source-execution-packet.v1",
  },
} as const;

const REQUIRED_FIRST_PASS_CANDIDATES = [
  "L1_tiny_glycemia_only",
  "L2_common_lab_core_shadow",
  "W1_activity_steps_minutes",
  "QC_missingness_coverage",
] as const;

type InputKey = keyof typeof INPUTS;
type FirstPassCandidateId = typeof REQUIRED_FIRST_PASS_CANDIDATES[number];
type CandidateResult = R1104ConsumerAggregateReceiptCandidateResult;

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface R1038Metric {
  aucDelta: number | null;
  brierDelta: number | null;
  calibrationSlope: number | null;
  candidateId: string;
  logLossDelta: number | null;
}

interface SourceMetricMap {
  activityControl: R1038Metric;
  commonLabCore: R1038Metric;
  coverageControl: R1038Metric;
  tinyGlycemia: R1038Metric;
}

export interface R1126NhanesShadowFirstPassMetricAdapterOptions {
  createdAt?: string;
  outputDir?: string;
  r1038Path?: string;
  r1049Path?: string;
  r1113Path?: string;
}

export interface R1126NhanesShadowFirstPassMetricAdapterOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1126: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1126: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  packetId: "r1126-nhanes-shadow-first-pass-metric-adapter";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1126_NHANES_SHADOW_FIRST_PASS_METRIC_ADAPTER_SCHEMA_VERSION;
  shadowAdapter: {
    aggregateMetricsArtifact: typeof SHADOW_METRICS_FILE_NAME | null;
    candidateIds: FirstPassCandidateId[];
    evidenceRole:
      | "historical_nhanes_shadow_not_consumer_16_50_validation"
      | "waiting_on_historical_shadow_inputs";
    r1124FeedPolicy: "manual_shadow_only_do_not_replace_private_or_workbench_receipt";
    reviewGptRequiredNow: false;
    whyNotPromotionDelta: [
      "not_primary_16_50_consumer_denominator",
      "not_true_consumer_wearable_receipt",
      "coverage_marked_sparse_for_score_bearing_shadow_candidates",
      "product_display_not_authorized",
    ];
  };
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "nhanes_shadow_first_pass_metrics_ready_not_primary_consumer_validation"
      | "nhanes_shadow_first_pass_metrics_waiting_on_inputs";
    nextAction:
      | "keep_r1125_private_or_workbench_receipt_as_primary"
      | "refresh_r1038_r1049_r1113_shadow_inputs";
    productDisplayAuthorized: false;
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1126: false;
    topPriority: "consumer_labs_wearables_l1_l2_w1_first_pass";
  };
}

export async function runR1126NhanesShadowFirstPassMetricAdapter(
  options: R1126NhanesShadowFirstPassMetricAdapterOptions = {},
): Promise<{
  metricsPath: string | null;
  output: R1126NhanesShadowFirstPassMetricAdapterOutput;
  outputPath: string;
}> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);
  const inputsReady = inputsReadyFor(inputs);
  const shadowMetrics = inputsReady ? createShadowMetrics(inputs) : null;
  const output: R1126NhanesShadowFirstPassMetricAdapterOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1126-nhanes-shadow-first-pass-metric-adapter",
    productDisplayAuthorized: false,
    schemaVersion: R1126_NHANES_SHADOW_FIRST_PASS_METRIC_ADAPTER_SCHEMA_VERSION,
    shadowAdapter: {
      aggregateMetricsArtifact: shadowMetrics ? SHADOW_METRICS_FILE_NAME : null,
      candidateIds: [...REQUIRED_FIRST_PASS_CANDIDATES],
      evidenceRole: shadowMetrics
        ? "historical_nhanes_shadow_not_consumer_16_50_validation"
        : "waiting_on_historical_shadow_inputs",
      r1124FeedPolicy: "manual_shadow_only_do_not_replace_private_or_workbench_receipt",
      reviewGptRequiredNow: false,
      whyNotPromotionDelta: [
        "not_primary_16_50_consumer_denominator",
        "not_true_consumer_wearable_receipt",
        "coverage_marked_sparse_for_score_bearing_shadow_candidates",
        "product_display_not_authorized",
      ],
    },
    status: "research-local-aggregate-only",
    summary: {
      conclusion: shadowMetrics
        ? "nhanes_shadow_first_pass_metrics_ready_not_primary_consumer_validation"
        : "nhanes_shadow_first_pass_metrics_waiting_on_inputs",
      nextAction: shadowMetrics
        ? "keep_r1125_private_or_workbench_receipt_as_primary"
        : "refresh_r1038_r1049_r1113_shadow_inputs",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1126: false,
      topPriority: "consumer_labs_wearables_l1_l2_w1_first_pass",
    },
  };

  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...(shadowMetrics ? findForbiddenAggregateEgress(shadowMetrics) : []),
  ];
  if (findings.length > 0) {
    throw new Error(`R1126 NHANES shadow first-pass metric adapter failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  const metricsPath = shadowMetrics ? path.join(outputDir, SHADOW_METRICS_FILE_NAME) : null;
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  if (metricsPath && shadowMetrics) {
    await writeFile(metricsPath, `${JSON.stringify(shadowMetrics, null, 2)}\n`);
  }
  return { metricsPath, output, outputPath };
}

function createShadowMetrics(inputs: Record<InputKey, unknown | null>): R1124ConsumerFirstPassAggregateMetricsInput {
  const source = sourceMetricMap(inputs);
  return {
    artifactBoundary: safeReceiptBoundary(),
    candidateResults: [
      {
        ...candidateFromMetric("L1_tiny_glycemia_only", "lab", source.tinyGlycemia),
        comparatorId: "frozen_recalibrated_r399",
        missingnessOrCoverageControlStatus: "not_applicable",
      },
      {
        ...candidateFromMetric("L2_common_lab_core_shadow", "lab", deltaMetric(source.commonLabCore, source.tinyGlycemia)),
        comparatorId: "l1_tiny_glycemia_only",
        missingnessOrCoverageControlStatus: "not_applicable",
      },
      {
        ...candidateFromMetric("W1_activity_steps_minutes", "wearable", source.activityControl),
        comparatorId: "frozen_recalibrated_r399",
        missingnessOrCoverageControlStatus: "beaten",
      },
      {
        ...candidateFromMetric("QC_missingness_coverage", "negative_control", source.coverageControl),
        calibrationStatus: "not_applicable",
        comparatorId: "frozen_recalibrated_r399",
        coverageStatus: "consumer_viable",
        missingnessOrCoverageControlStatus: "not_applicable",
      },
    ],
    evaluatorId: "consumer_lab_wearable_aggregate_evaluator_v1",
    packetId: "r1126-nhanes-shadow-first-pass-aggregate-metrics",
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
    submissionContext: historicalShadowSubmissionContext(),
  };
}

function sourceMetricMap(inputs: Record<InputKey, unknown | null>): SourceMetricMap {
  const r1038Metrics = readArrayAt(inputs.r1038, ["candidateMetrics"]);
  return {
    activityControl: requireMetric(r1038Metrics, "C6_age_sex_activity_primitives"),
    commonLabCore: requireMetric(r1038Metrics, "C3_lab9_hba1c_bp_body_primary"),
    coverageControl: readCoverageControlMetric(inputs.r1049),
    tinyGlycemia: requireMetric(r1038Metrics, "C2_lab5_glucose_bp_body"),
  };
}

function readCoverageControlMetric(r1049: unknown | null): R1038Metric {
  const control = readRecordAt(r1049, ["negativeControlDiagnostic", "controls", "coverageOnly"]);
  if (!control) throw new Error("R1126 missing NHANES coverage-control aggregate metric.");
  return {
    aucDelta: readFiniteNumber(control.aucDelta),
    brierDelta: readFiniteNumber(control.brierDelta),
    calibrationSlope: null,
    candidateId: "coverage_control",
    logLossDelta: readFiniteNumber(control.logLossDelta),
  };
}

function requireMetric(metrics: readonly unknown[], candidateId: string): R1038Metric {
  const metric = metrics
    .map((item) => readMetric(item))
    .find((item) => item.candidateId === candidateId);
  if (!metric) throw new Error("R1126 missing required NHANES aggregate metric.");
  return metric;
}

function readMetric(value: unknown): R1038Metric {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    aucDelta: readFiniteNumber(record.aucDelta),
    brierDelta: readFiniteNumber(record.brierDelta),
    calibrationSlope: readFiniteNumber(record.calibrationSlope),
    candidateId: typeof record.candidateId === "string" ? record.candidateId : "",
    logLossDelta: readFiniteNumber(record.logLossDelta),
  };
}

function candidateFromMetric(
  candidateId: FirstPassCandidateId,
  candidateKind: CandidateResult["candidateKind"],
  metric: R1038Metric,
): Omit<CandidateResult, "comparatorId" | "missingnessOrCoverageControlStatus"> {
  return {
    aucDelta: metric.aucDelta,
    brierDelta: metric.brierDelta,
    calibrationStatus: metric.calibrationSlope !== null && metric.calibrationSlope >= 0.9 && metric.calibrationSlope <= 1.1
      ? "non_worse"
      : "worse",
    candidateId,
    candidateKind,
    coverageStatus: candidateKind === "negative_control" ? "consumer_viable" : "sparse_or_biased",
    evidenceSupport: "one_receipt_100_plus_events",
    logLossDelta: metric.logLossDelta,
  };
}

function deltaMetric(candidate: R1038Metric, comparator: R1038Metric): R1038Metric {
  return {
    aucDelta: delta(candidate.aucDelta, comparator.aucDelta),
    brierDelta: delta(candidate.brierDelta, comparator.brierDelta),
    calibrationSlope: candidate.calibrationSlope,
    candidateId: `${candidate.candidateId}_minus_${comparator.candidateId}`,
    logLossDelta: delta(candidate.logLossDelta, comparator.logLossDelta),
  };
}

function inputsReadyFor(inputs: Record<InputKey, unknown | null>): boolean {
  return inputMatchesExpected("r1038", inputs.r1038)
    && inputMatchesExpected("r1049", inputs.r1049)
    && inputMatchesExpected("r1113", inputs.r1113)
    && readStringAt(inputs.r1049, ["decision", "conclusion"])
      === "nhanes_activity_signal_control_clean_global_calibration_limited"
    && missingRequiredCandidates(readStringArrayAt(inputs.r1113, ["summary", "firstPassCandidateIds"])).length === 0;
}

async function readInputs(options: R1126NhanesShadowFirstPassMetricAdapterOptions): Promise<Record<InputKey, unknown | null>> {
  return {
    r1038: await readJsonIfPresent(options.r1038Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1038.artifact)),
    r1049: await readJsonIfPresent(options.r1049Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1049.artifact)),
    r1113: await readJsonIfPresent(options.r1113Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1113.artifact)),
  };
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1126 rejected unsafe ${key} input: ${formatFindingCount(findings)}`);
    }
  }
}

function summarizeInputs(inputs: Record<InputKey, unknown | null>): Record<InputKey, ArtifactSummary> {
  return Object.fromEntries(
    (Object.entries(INPUTS) as Array<[InputKey, typeof INPUTS[InputKey]]>).map(([key, expected]) => {
      const input = inputs[key];
      const packetId = readStringAt(input, ["packetId"]);
      const schemaVersion = readStringAt(input, ["schemaVersion"]);
      return [key, {
        artifact: expected.artifact,
        packetId: packetId === expected.packetId ? expected.packetId : null,
        schemaVersion: schemaVersion === expected.schemaVersion ? expected.schemaVersion : null,
        status: input ? "available" : "missing",
      }];
    }),
  ) as Record<InputKey, ArtifactSummary>;
}

function inputMatchesExpected(key: InputKey, input: unknown | null): boolean {
  const expected = INPUTS[key];
  return readStringAt(input, ["packetId"]) === expected.packetId
    && readStringAt(input, ["schemaVersion"]) === expected.schemaVersion;
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

function missingRequiredCandidates(candidateIds: readonly string[]): FirstPassCandidateId[] {
  const present = new Set(candidateIds);
  return REQUIRED_FIRST_PASS_CANDIDATES.filter((candidateId) => !present.has(candidateId));
}

function readRecordAt(value: unknown, pathParts: readonly string[]): Record<string, unknown> | null {
  const resolved = readAt(value, pathParts);
  return resolved && typeof resolved === "object" && !Array.isArray(resolved)
    ? resolved as Record<string, unknown>
    : null;
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
}

function readStringArrayAt(value: unknown, pathParts: readonly string[]): string[] {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved) ? resolved.filter((item): item is string => typeof item === "string") : [];
}

function readArrayAt(value: unknown, pathParts: readonly string[]): unknown[] {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved) ? resolved : [];
}

function readAt(value: unknown, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function delta(candidate: number | null, comparator: number | null): number | null {
  if (candidate === null || comparator === null) return null;
  return Math.round((candidate - comparator) * 100_000_000) / 100_000_000;
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

function safeBoundary(): R1126NhanesShadowFirstPassMetricAdapterOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1126: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1126: false,
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
  const { output } = await runR1126NhanesShadowFirstPassMetricAdapter({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1038Path: process.env.MURPH_AGE_R1038_CALIBRATED_AGGREGATE_RECEIPT_PATH,
    r1049Path: process.env.MURPH_AGE_R1049_ACTIVITY_CONTROL_DIAGNOSTIC_PATH,
    r1113Path: process.env.MURPH_AGE_R1113_CONSUMER_SOURCE_EXECUTION_PACKET_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    aggregateMetricsArtifact: output.shadowAdapter.aggregateMetricsArtifact,
    conclusion: output.summary.conclusion,
    evidenceRole: output.shadowAdapter.evidenceRole,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowParsingPerformedByR1126: output.summary.rowParsingPerformedByR1126,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1126 NHANES shadow first-pass metric adapter failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
