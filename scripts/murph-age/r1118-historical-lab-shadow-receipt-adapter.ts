import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  runR1104ConsumerAggregateReceiptValidator,
  type R1104ConsumerAggregateReceiptInput,
} from "./r1104-consumer-aggregate-receipt-validator.ts";

export const R1118_HISTORICAL_LAB_SHADOW_RECEIPT_ADAPTER_SCHEMA_VERSION =
  "murph-age-r1118-historical-lab-shadow-receipt-adapter.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1118-historical-lab-shadow-receipt-adapter.latest.json";
const RECEIPT_FILE_NAME = "r1118-historical-lab-shadow-consumer-receipt.json";

const INPUTS = {
  r1044: {
    artifact: "r1044-haalsi-external-biomarker-loop.latest.json",
    packetId: "r1044-haalsi-external-biomarker-loop",
    schemaVersion: "murph-age-r1044-haalsi-external-biomarker-loop.v1",
  },
  r1117: {
    artifact: "r1117-consumer-model-loop-readiness-reducer.latest.json",
    packetId: "r1117-consumer-model-loop-readiness-reducer",
    schemaVersion: "murph-age-r1117-consumer-model-loop-readiness-reducer.v1",
  },
} as const;

type InputKey = keyof typeof INPUTS;

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface MetricSummary {
  auc: number | null;
  brier: number;
  calibrationIntercept?: number | null;
  calibrationSlope?: number | null;
  logLoss: number;
}

interface CandidateResultSummary {
  aucDelta: number | null;
  brierDelta: number | null;
  candidateId: "L1_tiny_glycemia_only" | "L2_common_lab_core_shadow" | "QC_missingness_coverage";
  comparatorId: "frozen_recalibrated_r399" | "l1_tiny_glycemia_only";
  coverageStatus: "sparse_or_biased";
  evidenceSupport: "one_receipt_100_plus_events";
  logLossDelta: number | null;
  r1104ExpectedDecision: "hold_or_reject" | "keep_reference_or_control";
}

export interface R1118HistoricalLabShadowReceiptAdapterOptions {
  createdAt?: string;
  outputDir?: string;
  r1044Path?: string;
  r1117Path?: string;
}

export interface R1118HistoricalLabShadowReceiptAdapterOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1118: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1118: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  packetId: "r1118-historical-lab-shadow-receipt-adapter";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1118_HISTORICAL_LAB_SHADOW_RECEIPT_ADAPTER_SCHEMA_VERSION;
  shadowReceipt: {
    candidateResults: CandidateResultSummary[];
    evidenceRole: "historical_external_biomarker_shadow_not_consumer_16_50_validation";
    r1104Conclusion: "aggregate_receipt_valid_but_no_delta";
    r1104ReviewGptRequired: false;
    receiptArtifact: typeof RECEIPT_FILE_NAME;
    receiptSchemaVersion: "murph-age-consumer-lab-wearable-aggregate-receipt.v1";
    whyNotPromotionDelta: [
      "not_consumer_16_50_denominator",
      "not_true_wearable_evidence",
      "not_product_display_authorized",
    ];
  };
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "historical_lab_shadow_receipt_ready_no_reviewgpt"
      | "historical_lab_shadow_receipt_waiting_on_inputs";
    nextAction:
      | "record_shadow_lab_evidence_and_continue_consumer_receipt_search"
      | "refresh_r1044_and_r1117_before_shadow_receipt";
    productDisplayAuthorized: false;
    reviewGptRequiredNow: false;
    rowParsingPerformedByR1118: false;
    topConsumerCandidateRemains: "L1_tiny_glycemia_only";
  };
}

export async function runR1118HistoricalLabShadowReceiptAdapter(
  options: R1118HistoricalLabShadowReceiptAdapterOptions = {},
): Promise<{ output: R1118HistoricalLabShadowReceiptAdapterOutput; outputPath: string; receiptPath: string }> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);

  const inputsReady = inputMatchesExpected("r1044", inputs.r1044)
    && inputMatchesExpected("r1117", inputs.r1117)
    && readStringAt(inputs.r1044, ["decision", "conclusion"]) === "haalsi_glucose_biomarker_signal_supported"
    && readStringAt(inputs.r1117, ["summary", "conclusion"]) === "consumer_model_loop_ready_for_external_or_private_mapping_receipt";
  const receipt = createShadowReceipt(inputs.r1044);
  const validation = await runR1104ConsumerAggregateReceiptValidator({
    aggregateReceipt: receipt,
    outputDir: options.outputDir ?? DEFAULT_MODEL_RUNS_DIR,
  });
  if (validation.output.summary.conclusion !== "aggregate_receipt_valid_but_no_delta") {
    throw new Error("R1118 historical shadow receipt must not route to ReviewGPT or product promotion.");
  }

  const output: R1118HistoricalLabShadowReceiptAdapterOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1118-historical-lab-shadow-receipt-adapter",
    productDisplayAuthorized: false,
    schemaVersion: R1118_HISTORICAL_LAB_SHADOW_RECEIPT_ADAPTER_SCHEMA_VERSION,
    shadowReceipt: {
      candidateResults: summarizeReceiptCandidates(receipt, validation.output.reduction.candidateDecisions),
      evidenceRole: "historical_external_biomarker_shadow_not_consumer_16_50_validation",
      r1104Conclusion: validation.output.summary.conclusion,
      r1104ReviewGptRequired: false,
      receiptArtifact: RECEIPT_FILE_NAME,
      receiptSchemaVersion: receipt.schemaVersion,
      whyNotPromotionDelta: [
        "not_consumer_16_50_denominator",
        "not_true_wearable_evidence",
        "not_product_display_authorized",
      ],
    },
    status: "research-local-aggregate-only",
    summary: {
      conclusion: inputsReady
        ? "historical_lab_shadow_receipt_ready_no_reviewgpt"
        : "historical_lab_shadow_receipt_waiting_on_inputs",
      nextAction: inputsReady
        ? "record_shadow_lab_evidence_and_continue_consumer_receipt_search"
        : "refresh_r1044_and_r1117_before_shadow_receipt",
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
      rowParsingPerformedByR1118: false,
      topConsumerCandidateRemains: "L1_tiny_glycemia_only",
    },
  };

  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findForbiddenAggregateEgress(receipt),
  ];
  if (findings.length > 0) {
    throw new Error(`R1118 historical lab shadow receipt adapter failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  const receiptPath = path.join(outputDir, RECEIPT_FILE_NAME);
  await Promise.all([
    writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`),
    writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`),
  ]);
  return { output, outputPath, receiptPath };
}

function createShadowReceipt(r1044: unknown | null): R1104ConsumerAggregateReceiptInput {
  const reference = readMetricAt(r1044, ["models", "A0_age_sex", "splitMetrics", "test"]);
  const glucose = readMetricAt(r1044, ["models", "A1_glucose", "splitMetrics", "test"]);
  const commonLab = readMetricAt(r1044, ["models", "B1_glucose_lipid_body_no_crp", "splitMetrics", "test"]);
  const missingnessControl = readMetricAt(r1044, ["models", "NC6_missingness_quality_only", "splitMetrics", "test"]);
  return {
    artifactBoundary: safeReceiptBoundary(),
    candidateResults: [
      {
        aucDelta: delta(glucose.auc, reference.auc),
        brierDelta: delta(glucose.brier, reference.brier),
        calibrationStatus: "non_worse",
        candidateId: "L1_tiny_glycemia_only",
        candidateKind: "lab",
        comparatorId: "frozen_recalibrated_r399",
        coverageStatus: "sparse_or_biased",
        evidenceSupport: "one_receipt_100_plus_events",
        logLossDelta: delta(glucose.logLoss, reference.logLoss),
        missingnessOrCoverageControlStatus: "not_applicable",
      },
      {
        aucDelta: delta(commonLab.auc, glucose.auc),
        brierDelta: delta(commonLab.brier, glucose.brier),
        calibrationStatus: "non_worse",
        candidateId: "L2_common_lab_core_shadow",
        candidateKind: "lab",
        comparatorId: "l1_tiny_glycemia_only",
        coverageStatus: "sparse_or_biased",
        evidenceSupport: "one_receipt_100_plus_events",
        logLossDelta: delta(commonLab.logLoss, glucose.logLoss),
        missingnessOrCoverageControlStatus: "not_applicable",
      },
      {
        aucDelta: delta(missingnessControl.auc, reference.auc),
        brierDelta: delta(missingnessControl.brier, reference.brier),
        calibrationStatus: "not_applicable",
        candidateId: "QC_missingness_coverage",
        candidateKind: "negative_control",
        comparatorId: "frozen_recalibrated_r399",
        coverageStatus: "consumer_viable",
        evidenceSupport: "one_receipt_100_plus_events",
        logLossDelta: delta(missingnessControl.logLoss, reference.logLoss),
        missingnessOrCoverageControlStatus: "not_applicable",
      },
    ],
    evaluatorId: "consumer_lab_wearable_aggregate_evaluator_v1",
    packetId: "historical-lab-shadow-receipt",
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
    schemaVersion: "murph-age-consumer-lab-wearable-aggregate-receipt.v1",
  };
}

function summarizeReceiptCandidates(
  receipt: R1104ConsumerAggregateReceiptInput,
  decisions: Array<{ candidateId: string; comparatorId: string; decision: string }>,
): CandidateResultSummary[] {
  return receipt.candidateResults.map((candidate) => {
    const decision = decisions.find((item) => item.candidateId === candidate.candidateId);
    return {
      aucDelta: candidate.aucDelta,
      brierDelta: candidate.brierDelta,
      candidateId: candidate.candidateId as CandidateResultSummary["candidateId"],
      comparatorId: candidate.comparatorId as CandidateResultSummary["comparatorId"],
      coverageStatus: "sparse_or_biased",
      evidenceSupport: "one_receipt_100_plus_events",
      logLossDelta: candidate.logLossDelta,
      r1104ExpectedDecision: decision?.decision === "keep_reference_or_control"
        ? "keep_reference_or_control"
        : "hold_or_reject",
    };
  });
}

function readMetricAt(value: unknown, pathParts: readonly string[]): MetricSummary {
  const raw = readAt(value, pathParts);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("R1118 missing required aggregate metric summary.");
  }
  const record = raw as Record<string, unknown>;
  const metric = {
    auc: typeof record.auc === "number" && Number.isFinite(record.auc) ? record.auc : null,
    brier: finiteNumber(record.brier),
    calibrationIntercept: typeof record.calibrationIntercept === "number" ? record.calibrationIntercept : null,
    calibrationSlope: typeof record.calibrationSlope === "number" ? record.calibrationSlope : null,
    logLoss: finiteNumber(record.logLoss),
  };
  if (metric.brier === null || metric.logLoss === null) {
    throw new Error("R1118 required aggregate metric summary is incomplete.");
  }
  return metric as MetricSummary;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function delta(candidate: number | null, comparator: number | null): number | null {
  if (candidate === null || comparator === null) return null;
  return round(candidate - comparator);
}

function round(value: number): number {
  return Math.round(value * 100_000_000) / 100_000_000;
}

async function readInputs(options: R1118HistoricalLabShadowReceiptAdapterOptions): Promise<Record<InputKey, unknown | null>> {
  return {
    r1044: await readJsonIfPresent(options.r1044Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1044.artifact)),
    r1117: await readJsonIfPresent(options.r1117Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1117.artifact)),
  };
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1118 rejected unsafe ${key} input: ${formatFindingCount(findings)}`);
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

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
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

function formatFindingCount(findings: readonly string[]): string {
  return `${findings.length} aggregate-egress violation${findings.length === 1 ? "" : "s"}`;
}

function safeReceiptBoundary(): R1104ConsumerAggregateReceiptInput["artifactBoundary"] {
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

function safeBoundary(): R1118HistoricalLabShadowReceiptAdapterOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1118: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1118: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

async function main(): Promise<void> {
  const { output } = await runR1118HistoricalLabShadowReceiptAdapter({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1044Path: process.env.MURPH_AGE_R1044_HISTORICAL_LAB_SOURCE_PATH,
    r1117Path: process.env.MURPH_AGE_R1117_CONSUMER_MODEL_LOOP_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    r1104Conclusion: output.shadowReceipt.r1104Conclusion,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowParsingPerformedByR1118: output.summary.rowParsingPerformedByR1118,
    schemaVersion: output.schemaVersion,
    status: output.status,
    topConsumerCandidateRemains: output.summary.topConsumerCandidateRemains,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1118 historical lab shadow receipt adapter failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
