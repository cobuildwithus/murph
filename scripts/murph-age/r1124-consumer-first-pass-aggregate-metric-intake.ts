import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  runR1104ConsumerAggregateReceiptValidator,
  type R1104ConsumerAggregateReceiptCandidateResult,
  type R1104ConsumerAggregateReceiptInput,
} from "./r1104-consumer-aggregate-receipt-validator.ts";

export const R1124_CONSUMER_FIRST_PASS_AGGREGATE_METRIC_INTAKE_SCHEMA_VERSION =
  "murph-age-r1124-consumer-first-pass-aggregate-metric-intake.v1" as const;

const FIRST_PASS_METRICS_SCHEMA_VERSION =
  "murph-age-consumer-first-pass-aggregate-metrics.v1" as const;
const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1124-consumer-first-pass-aggregate-metric-intake.latest.json";
const RECEIPT_FILE_NAME = "r1124-consumer-first-pass-aggregate-receipt.json";
const AGGREGATE_METRICS_TEMPLATE_FILE_NAME =
  "r1124-fillable-consumer-first-pass-aggregate-metrics.json";

const INPUTS = {
  r1113: {
    artifact: "r1113-consumer-source-execution-packet.latest.json",
    packetId: "r1113-consumer-source-execution-packet",
    schemaVersion: "murph-age-r1113-consumer-source-execution-packet.v1",
  },
  r1121: {
    artifact: "r1121-local-private-consumer-receipt-runner-contract.latest.json",
    packetId: "r1121-local-private-consumer-receipt-runner-contract",
    schemaVersion: "murph-age-r1121-local-private-consumer-receipt-runner-contract.v1",
  },
  r1122: {
    artifact: "r1122-local-private-consumer-receipt-runner-config-intake.latest.json",
    packetId: "r1122-local-private-consumer-receipt-runner-config-intake",
    schemaVersion: "murph-age-r1122-local-private-consumer-receipt-runner-config-intake.v1",
  },
} as const;

const REQUIRED_FIRST_PASS_CANDIDATES = [
  "L1_tiny_glycemia_only",
  "L2_common_lab_core_shadow",
  "W1_activity_steps_minutes",
  "QC_missingness_coverage",
] as const;
const REQUIRED_SUBMISSION_CONTEXT_FAMILIES = [
  "bloodwork_labs",
  "vitals_body_context",
  "wearable_activity",
] as const;

type InputKey = keyof typeof INPUTS;
type FirstPassCandidateId = typeof REQUIRED_FIRST_PASS_CANDIDATES[number];
type CandidateId = R1104ConsumerAggregateReceiptCandidateResult["candidateId"];
type SubmissionEvidenceRole =
  | "historical_shadow_context"
  | "real_first_pass_evidence"
  | "synthetic_pipeline_smoke";
type AggregateMetricsConclusion =
  | "consumer_first_pass_aggregate_metrics_incomplete"
  | "consumer_first_pass_aggregate_metrics_missing"
  | "consumer_first_pass_aggregate_metric_intake_waiting_on_prerequisites"
  | "consumer_first_pass_aggregate_receipt_ready_for_reviewgpt"
  | "consumer_first_pass_aggregate_receipt_smoke_only_not_reviewgpt"
  | "consumer_first_pass_aggregate_receipt_valid_but_no_delta";
type NextAction =
  | "provide_l1_l2_w1_qc_aggregate_metrics_or_fill_private_config"
  | "refresh_r1113_r1121_before_metric_intake"
  | "send_aggregate_only_consumer_first_pass_delta_to_reviewgpt"
  | "complete_first_pass_aggregate_metrics"
  | "record_no_delta_and_continue_consumer_receipt_search"
  | "replace_smoke_metrics_with_real_outcome_linked_aggregate";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

export interface R1124ConsumerFirstPassAggregateMetricsInput {
  artifactBoundary: R1104ConsumerAggregateReceiptInput["artifactBoundary"];
  candidateResults: R1104ConsumerAggregateReceiptCandidateResult[];
  evaluatorId: "consumer_lab_wearable_aggregate_evaluator_v1";
  packetId: string;
  receiptAttestations: R1104ConsumerAggregateReceiptInput["receiptAttestations"];
  schemaVersion: typeof FIRST_PASS_METRICS_SCHEMA_VERSION;
  submissionContext: {
    evidenceRole: SubmissionEvidenceRole;
    ordinaryConsumerSubmission: true;
    outcomeLinked: true;
    priorityInputFamilies: typeof REQUIRED_SUBMISSION_CONTEXT_FAMILIES;
    targetAgeBand: "roughly_16_50";
  };
}

export interface R1124ConsumerFirstPassAggregateMetricIntakeOptions {
  aggregateMetrics?: R1124ConsumerFirstPassAggregateMetricsInput | null;
  aggregateMetricsPath?: string;
  createdAt?: string;
  outputDir?: string;
  r1113Path?: string;
  r1121Path?: string;
  r1122Path?: string;
}

export interface R1124ConsumerFirstPassAggregateMetricIntakeOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1124: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1124: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: Record<InputKey, ArtifactSummary>;
  metricIntake: {
    aggregateMetricsProvided: boolean;
    aggregateMetricsTemplateArtifact: typeof AGGREGATE_METRICS_TEMPLATE_FILE_NAME;
    candidateCountBand: "0" | "1-9" | "10-99";
    firstPassCandidateIds: FirstPassCandidateId[];
    localPrivateConfigConclusion: string | null;
    missingRequiredCandidateIds: FirstPassCandidateId[];
    r1104Conclusion:
      | "aggregate_receipt_missing"
      | "aggregate_receipt_ready_for_reviewgpt"
      | "aggregate_receipt_valid_but_no_delta"
      | null;
    receiptArtifact: typeof RECEIPT_FILE_NAME | null;
    reviewGptRequiredNow: boolean;
    submissionEvidenceRole: SubmissionEvidenceRole | null;
  };
  packetId: "r1124-consumer-first-pass-aggregate-metric-intake";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1124_CONSUMER_FIRST_PASS_AGGREGATE_METRIC_INTAKE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: AggregateMetricsConclusion;
    nextAction: NextAction;
    productDisplayAuthorized: false;
    reviewGptRequiredNow: boolean;
    rowParsingPerformedByR1124: false;
    topPriority: "consumer_labs_wearables_l1_l2_w1_first_pass";
  };
}

export async function runR1124ConsumerFirstPassAggregateMetricIntake(
  options: R1124ConsumerFirstPassAggregateMetricIntakeOptions = {},
): Promise<{
  aggregateMetricsTemplatePath: string;
  output: R1124ConsumerFirstPassAggregateMetricIntakeOutput;
  outputPath: string;
  receiptPath: string | null;
}> {
  const inputs = await readInputs(options);
  validateInputBoundaries(inputs);
  const aggregateMetrics = options.aggregateMetrics ?? await readAggregateMetrics(options.aggregateMetricsPath);
  if (aggregateMetrics) validateAggregateMetrics(aggregateMetrics);

  const prerequisitesReady = prerequisitesReadyFor(inputs);
  const firstPassCandidateIds = firstPassCandidateIdsFor(inputs);
  const missingRequiredCandidateIds = aggregateMetrics
    ? missingRequiredCandidates(aggregateMetrics.candidateResults)
    : [...firstPassCandidateIds];
  const metricsComplete = aggregateMetrics !== null && missingRequiredCandidateIds.length === 0;
  const receipt = metricsComplete && aggregateMetrics
    ? createReceipt(aggregateMetrics)
    : null;
  const validation = receipt
    ? await runR1104ConsumerAggregateReceiptValidator({
      aggregateReceipt: receipt,
      createdAt: options.createdAt,
      outputDir: options.outputDir ?? DEFAULT_MODEL_RUNS_DIR,
    })
    : null;
  const conclusion = conclusionFor({
    evidenceRole: aggregateMetrics?.submissionContext?.evidenceRole ?? null,
    metricsComplete,
    metricsProvided: aggregateMetrics !== null,
    prerequisitesReady,
    r1104Conclusion: validation?.output.summary.conclusion ?? null,
  });
  const reviewGptRequiredNow = conclusion === "consumer_first_pass_aggregate_receipt_ready_for_reviewgpt";
  const aggregateMetricsTemplate = createAggregateMetricsTemplate(firstPassCandidateIds);
  const output: R1124ConsumerFirstPassAggregateMetricIntakeOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: summarizeInputs(inputs),
    metricIntake: {
      aggregateMetricsProvided: aggregateMetrics !== null,
      aggregateMetricsTemplateArtifact: AGGREGATE_METRICS_TEMPLATE_FILE_NAME,
      candidateCountBand: countBand(aggregateMetrics?.candidateResults.length ?? 0),
      firstPassCandidateIds,
      localPrivateConfigConclusion: readStringAt(inputs.r1122, ["summary", "conclusion"]),
      missingRequiredCandidateIds,
      r1104Conclusion: validation?.output.summary.conclusion ?? null,
      receiptArtifact: receipt ? RECEIPT_FILE_NAME : null,
      reviewGptRequiredNow,
      submissionEvidenceRole: aggregateMetrics?.submissionContext?.evidenceRole ?? null,
    },
    packetId: "r1124-consumer-first-pass-aggregate-metric-intake",
    productDisplayAuthorized: false,
    schemaVersion: R1124_CONSUMER_FIRST_PASS_AGGREGATE_METRIC_INTAKE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      nextAction: nextActionFor(conclusion),
      productDisplayAuthorized: false,
      reviewGptRequiredNow,
      rowParsingPerformedByR1124: false,
      topPriority: "consumer_labs_wearables_l1_l2_w1_first_pass",
    },
  };

  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findForbiddenAggregateEgress(aggregateMetricsTemplate),
    ...(receipt ? findForbiddenAggregateEgress(receipt) : []),
  ];
  if (findings.length > 0) {
    throw new Error(`R1124 consumer first-pass aggregate metric intake failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  const aggregateMetricsTemplatePath = path.join(outputDir, AGGREGATE_METRICS_TEMPLATE_FILE_NAME);
  const receiptPath = receipt ? path.join(outputDir, RECEIPT_FILE_NAME) : null;
  await Promise.all([
    writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`),
    writeFile(aggregateMetricsTemplatePath, `${JSON.stringify(aggregateMetricsTemplate, null, 2)}\n`),
  ]);
  if (receiptPath && receipt) {
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  }
  return { aggregateMetricsTemplatePath, output, outputPath, receiptPath };
}

function prerequisitesReadyFor(inputs: Record<InputKey, unknown | null>): boolean {
  return inputMatchesExpected("r1113", inputs.r1113)
    && inputMatchesExpected("r1121", inputs.r1121)
    && readStringAt(inputs.r1113, ["summary", "conclusion"]) === "consumer_source_execution_packet_ready"
    && (
      readStringAt(inputs.r1121, ["summary", "conclusion"]) === "local_private_consumer_receipt_runner_contract_ready_awaiting_mapping"
      || readStringAt(inputs.r1121, ["summary", "conclusion"]) === "local_private_consumer_receipt_runner_contract_ready_for_execution"
    )
    && missingRequiredCandidatesFromStrings(readStringArrayAt(inputs.r1113, ["summary", "firstPassCandidateIds"])).length === 0
    && missingRequiredCandidatesFromStrings(readStringArrayAt(inputs.r1121, ["summary", "firstPassCandidateIds"])).length === 0;
}

function firstPassCandidateIdsFor(inputs: Record<InputKey, unknown | null>): FirstPassCandidateId[] {
  const fromSourcePacket = readStringArrayAt(inputs.r1113, ["summary", "firstPassCandidateIds"])
    .filter(isFirstPassCandidateId);
  return fromSourcePacket.length === REQUIRED_FIRST_PASS_CANDIDATES.length
    && missingRequiredCandidatesFromStrings(fromSourcePacket).length === 0
    ? fromSourcePacket
    : [...REQUIRED_FIRST_PASS_CANDIDATES];
}

function validateAggregateMetrics(metrics: R1124ConsumerFirstPassAggregateMetricsInput): void {
  const findings = findForbiddenAggregateEgress(metrics);
  if (findings.length > 0) {
    throw new Error(`R1124 rejected unsafe aggregate metrics: ${formatFindingCount(findings)}`);
  }
  if (metrics.schemaVersion !== FIRST_PASS_METRICS_SCHEMA_VERSION) {
    throw new Error("R1124 aggregate metrics have an unsupported schemaVersion.");
  }
  if (metrics.evaluatorId !== "consumer_lab_wearable_aggregate_evaluator_v1") {
    throw new Error("R1124 aggregate metrics have an unsupported evaluatorId.");
  }
  const attestations = metrics.receiptAttestations;
  const attestationOk = attestations?.aggregateOnly === true
    && attestations.endpointFrozenBeforeScoring === true
    && attestations.evaluatorFrozenBeforeExecution === true
    && attestations.noCoefficientEgress === true
    && attestations.noParticipantEgress === true
    && attestations.noPredictionEgress === true
    && attestations.noRowEgress === true
    && attestations.noSmallCellEgress === true
    && attestations.sameDenominatorComparisons === true;
  if (!attestationOk) {
    throw new Error("R1124 aggregate metrics are missing required aggregate-only attestations.");
  }
  validateSubmissionContext(metrics.submissionContext);
  for (const candidate of metrics.candidateResults) {
    if (!isFirstPassCandidateId(candidate.candidateId)) {
      throw new Error("R1124 aggregate metrics include a candidate outside the L1/L2/W1/QC first pass.");
    }
  }
}

function validateSubmissionContext(
  context: R1124ConsumerFirstPassAggregateMetricsInput["submissionContext"] | undefined,
): void {
  const contextOk = (
    context !== undefined
    && isSubmissionEvidenceRole(context.evidenceRole)
    && context.ordinaryConsumerSubmission === true
    && context.outcomeLinked === true
    && context.targetAgeBand === "roughly_16_50"
    && requiredContextFamiliesPresent(context.priorityInputFamilies)
  );
  if (!contextOk) {
    throw new Error("R1124 aggregate metrics are missing required ordinary consumer submission context.");
  }
}

function createReceipt(metrics: R1124ConsumerFirstPassAggregateMetricsInput): R1104ConsumerAggregateReceiptInput {
  return {
    artifactBoundary: safeReceiptBoundary(),
    candidateResults: orderFirstPassCandidates(metrics.candidateResults),
    evaluatorId: "consumer_lab_wearable_aggregate_evaluator_v1",
    packetId: "consumer-first-pass-aggregate-receipt",
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

function createAggregateMetricsTemplate(
  firstPassCandidateIds: readonly FirstPassCandidateId[],
): R1124ConsumerFirstPassAggregateMetricsInput {
  return {
    artifactBoundary: safeReceiptBoundary(),
    candidateResults: firstPassCandidateIds.map(candidateTemplate),
    evaluatorId: "consumer_lab_wearable_aggregate_evaluator_v1",
    packetId: "fill-this-consumer-first-pass-aggregate-metrics",
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
    submissionContext: realSubmissionContext(),
  };
}

function candidateTemplate(candidateId: FirstPassCandidateId): R1104ConsumerAggregateReceiptCandidateResult {
  if (candidateId === "L1_tiny_glycemia_only") {
    return blankCandidate({
      candidateId,
      candidateKind: "lab",
      comparatorId: "frozen_recalibrated_r399",
      missingnessOrCoverageControlStatus: "not_applicable",
    });
  }
  if (candidateId === "L2_common_lab_core_shadow") {
    return blankCandidate({
      candidateId,
      candidateKind: "lab",
      comparatorId: "l1_tiny_glycemia_only",
      missingnessOrCoverageControlStatus: "not_applicable",
    });
  }
  if (candidateId === "W1_activity_steps_minutes") {
    return blankCandidate({
      candidateId,
      candidateKind: "wearable",
      comparatorId: "frozen_recalibrated_r399",
      missingnessOrCoverageControlStatus: "missing",
    });
  }
  return blankCandidate({
    candidateId,
    candidateKind: "negative_control",
    comparatorId: "frozen_recalibrated_r399",
    missingnessOrCoverageControlStatus: "not_applicable",
  });
}

function blankCandidate(input: Pick<
  R1104ConsumerAggregateReceiptCandidateResult,
  "candidateId" | "candidateKind" | "comparatorId" | "missingnessOrCoverageControlStatus"
>): R1104ConsumerAggregateReceiptCandidateResult {
  return {
    aucDelta: null,
    brierDelta: null,
    calibrationStatus: "missing",
    candidateId: input.candidateId,
    candidateKind: input.candidateKind,
    comparatorId: input.comparatorId,
    coverageStatus: "missing",
    evidenceSupport: "underpowered",
    logLossDelta: null,
    missingnessOrCoverageControlStatus: input.missingnessOrCoverageControlStatus,
  };
}

function orderFirstPassCandidates(
  candidates: readonly R1104ConsumerAggregateReceiptCandidateResult[],
): R1104ConsumerAggregateReceiptCandidateResult[] {
  return REQUIRED_FIRST_PASS_CANDIDATES
    .map((candidateId) => candidates.find((candidate) => candidate.candidateId === candidateId))
    .filter((candidate): candidate is R1104ConsumerAggregateReceiptCandidateResult => candidate !== undefined);
}

function missingRequiredCandidates(
  candidates: readonly R1104ConsumerAggregateReceiptCandidateResult[],
): FirstPassCandidateId[] {
  const present = new Set(candidates.map((candidate) => candidate.candidateId));
  return REQUIRED_FIRST_PASS_CANDIDATES.filter((candidateId) => !present.has(candidateId));
}

function missingRequiredCandidatesFromStrings(candidateIds: readonly string[]): FirstPassCandidateId[] {
  const present = new Set(candidateIds);
  return REQUIRED_FIRST_PASS_CANDIDATES.filter((candidateId) => !present.has(candidateId));
}

function conclusionFor(input: {
  evidenceRole: SubmissionEvidenceRole | null;
  metricsComplete: boolean;
  metricsProvided: boolean;
  prerequisitesReady: boolean;
  r1104Conclusion: R1124ConsumerFirstPassAggregateMetricIntakeOutput["metricIntake"]["r1104Conclusion"];
}): AggregateMetricsConclusion {
  if (!input.prerequisitesReady) return "consumer_first_pass_aggregate_metric_intake_waiting_on_prerequisites";
  if (!input.metricsProvided) return "consumer_first_pass_aggregate_metrics_missing";
  if (!input.metricsComplete) return "consumer_first_pass_aggregate_metrics_incomplete";
  if (
    input.r1104Conclusion === "aggregate_receipt_ready_for_reviewgpt"
    && input.evidenceRole === "real_first_pass_evidence"
  ) {
    return "consumer_first_pass_aggregate_receipt_ready_for_reviewgpt";
  }
  if (
    input.r1104Conclusion === "aggregate_receipt_ready_for_reviewgpt"
    && input.evidenceRole === "synthetic_pipeline_smoke"
  ) {
    return "consumer_first_pass_aggregate_receipt_smoke_only_not_reviewgpt";
  }
  return "consumer_first_pass_aggregate_receipt_valid_but_no_delta";
}

function nextActionFor(conclusion: AggregateMetricsConclusion): NextAction {
  if (conclusion === "consumer_first_pass_aggregate_metric_intake_waiting_on_prerequisites") {
    return "refresh_r1113_r1121_before_metric_intake";
  }
  if (conclusion === "consumer_first_pass_aggregate_metrics_missing") {
    return "provide_l1_l2_w1_qc_aggregate_metrics_or_fill_private_config";
  }
  if (conclusion === "consumer_first_pass_aggregate_metrics_incomplete") {
    return "complete_first_pass_aggregate_metrics";
  }
  if (conclusion === "consumer_first_pass_aggregate_receipt_ready_for_reviewgpt") {
    return "send_aggregate_only_consumer_first_pass_delta_to_reviewgpt";
  }
  if (conclusion === "consumer_first_pass_aggregate_receipt_smoke_only_not_reviewgpt") {
    return "replace_smoke_metrics_with_real_outcome_linked_aggregate";
  }
  return "record_no_delta_and_continue_consumer_receipt_search";
}

export function realSubmissionContext(): R1124ConsumerFirstPassAggregateMetricsInput["submissionContext"] {
  return {
    evidenceRole: "real_first_pass_evidence",
    ordinaryConsumerSubmission: true,
    outcomeLinked: true,
    priorityInputFamilies: [...REQUIRED_SUBMISSION_CONTEXT_FAMILIES],
    targetAgeBand: "roughly_16_50",
  };
}

export function syntheticSmokeSubmissionContext(): R1124ConsumerFirstPassAggregateMetricsInput["submissionContext"] {
  return {
    ...realSubmissionContext(),
    evidenceRole: "synthetic_pipeline_smoke",
  };
}

export function historicalShadowSubmissionContext(): R1124ConsumerFirstPassAggregateMetricsInput["submissionContext"] {
  return {
    ...realSubmissionContext(),
    evidenceRole: "historical_shadow_context",
  };
}

function isSubmissionEvidenceRole(value: string): value is SubmissionEvidenceRole {
  return value === "historical_shadow_context"
    || value === "real_first_pass_evidence"
    || value === "synthetic_pipeline_smoke";
}

function requiredContextFamiliesPresent(families: readonly string[]): boolean {
  const present = new Set(families);
  return REQUIRED_SUBMISSION_CONTEXT_FAMILIES.every((family) => present.has(family));
}

async function readInputs(options: R1124ConsumerFirstPassAggregateMetricIntakeOptions): Promise<Record<InputKey, unknown | null>> {
  return {
    r1113: await readJsonIfPresent(options.r1113Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1113.artifact)),
    r1121: await readJsonIfPresent(options.r1121Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1121.artifact)),
    r1122: await readJsonIfPresent(options.r1122Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, INPUTS.r1122.artifact)),
  };
}

function validateInputBoundaries(inputs: Record<InputKey, unknown | null>): void {
  for (const [key, value] of Object.entries(inputs) as Array<[InputKey, unknown | null]>) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1124 rejected unsafe ${key} input: ${formatFindingCount(findings)}`);
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

async function readAggregateMetrics(filePath?: string): Promise<R1124ConsumerFirstPassAggregateMetricsInput | null> {
  if (!filePath?.trim()) return null;
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("R1124 aggregate metrics must be a JSON object.");
  }
  return parsed as R1124ConsumerFirstPassAggregateMetricsInput;
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

function isFirstPassCandidateId(value: string): value is FirstPassCandidateId {
  return value === "L1_tiny_glycemia_only"
    || value === "L2_common_lab_core_shadow"
    || value === "W1_activity_steps_minutes"
    || value === "QC_missingness_coverage";
}

function countBand(count: number): "0" | "1-9" | "10-99" {
  if (count <= 0) return "0";
  if (count < 10) return "1-9";
  return "10-99";
}

function formatFindingCount(findings: readonly string[]): string {
  return `${findings.length} aggregate-egress violation${findings.length === 1 ? "" : "s"}`;
}

function safeBoundary(): R1124ConsumerFirstPassAggregateMetricIntakeOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1124: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1124: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
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

async function main(): Promise<void> {
  const { output } = await runR1124ConsumerFirstPassAggregateMetricIntake({
    aggregateMetricsPath: process.env.MURPH_AGE_CONSUMER_FIRST_PASS_AGGREGATE_METRICS_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1113Path: process.env.MURPH_AGE_R1113_CONSUMER_SOURCE_EXECUTION_PACKET_PATH,
    r1121Path: process.env.MURPH_AGE_R1121_LOCAL_PRIVATE_RUNNER_CONTRACT_PATH,
    r1122Path: process.env.MURPH_AGE_R1122_LOCAL_PRIVATE_CONFIG_INTAKE_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    aggregateMetricsProvided: output.metricIntake.aggregateMetricsProvided,
    aggregateMetricsTemplateArtifact: output.metricIntake.aggregateMetricsTemplateArtifact,
    candidateCountBand: output.metricIntake.candidateCountBand,
    conclusion: output.summary.conclusion,
    missingRequiredCandidateIds: output.metricIntake.missingRequiredCandidateIds,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    receiptArtifact: output.metricIntake.receiptArtifact,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowParsingPerformedByR1124: output.summary.rowParsingPerformedByR1124,
    schemaVersion: output.schemaVersion,
    status: output.status,
    submissionEvidenceRole: output.metricIntake.submissionEvidenceRole,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1124 consumer first-pass aggregate metric intake failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
