import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1070_NSRR_SLEEP_AUTONOMIC_AGGREGATE_RECEIPT_SCHEMA_VERSION =
  "murph-age-r1070-nsrr-sleep-autonomic-aggregate-receipt.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1070-nsrr-sleep-autonomic-aggregate-receipt.latest.json";
const RECEIPT_TEMPLATE_FILE_NAME = "r1070-fillable-nsrr-sleep-autonomic-aggregate-receipt.json";

const ALLOWED_CANDIDATE_IDS = [
  "N0_age_sex",
  "N1_source_clinical_base",
  "N2_sleep_duration_regularity",
  "N3_sleep_breathing_autonomic",
  "N4_sleep_activity_autonomic_combo",
  "N5_coverage_quality_only_negative_control",
  "N6_shuffled_sleep_autonomic_negative_control",
] as const;
const ALLOWED_ENDPOINTS = [
  "all_cause_mortality",
  "frailty_disability_or_functional_decline_auxiliary_head",
  "hospitalization_or_emergency_utilization",
  "incident_cardiometabolic_disease",
  "major_cardiovascular_event",
] as const;
const ALLOWED_GATE_STATUSES = ["missing", "not_reportable", "stable", "unstable"] as const;
const ALLOWED_NEGATIVE_CONTROL_STATUSES = ["beaten", "not_applicable", "not_beaten"] as const;
const ALLOWED_ROLES = ["negative_control", "reference_only", "score_bearing_research_candidate"] as const;
const REQUIRED_NEGATIVE_CONTROLS = [
  "N5_coverage_quality_only_negative_control",
  "N6_shuffled_sleep_autonomic_negative_control",
] as const;
const SCORE_BEARING_CANDIDATE_IDS = [
  "N2_sleep_duration_regularity",
  "N3_sleep_breathing_autonomic",
  "N4_sleep_activity_autonomic_combo",
] as const;
const SCORE_BEARING_CANDIDATE_ID_SET: ReadonlySet<CandidateId> =
  new Set<CandidateId>(SCORE_BEARING_CANDIDATE_IDS);

type CandidateId = typeof ALLOWED_CANDIDATE_IDS[number];
type Endpoint = typeof ALLOWED_ENDPOINTS[number];
type GateStatus = typeof ALLOWED_GATE_STATUSES[number];
type NegativeControlStatus = typeof ALLOWED_NEGATIVE_CONTROL_STATUSES[number];
type Role = typeof ALLOWED_ROLES[number];

interface CandidateMetric {
  aucDelta: number | null;
  brierDelta: number | null;
  calibrationSlope: number | null;
  candidateId: CandidateId;
  comparatorId: CandidateId;
  eOverO: number | null;
  logLossDelta: number | null;
  measurementMethodCalibrationStatus: GateStatus;
  negativeControlStatus: NegativeControlStatus;
  role: Role;
  subgroupCalibrationStatus: GateStatus;
}

export interface R1070NsrrSleepAutonomicAggregateReceiptInput {
  artifactBoundary: {
    aggregateOnly?: boolean;
    codebookTextStored?: boolean;
    coefficientsStored?: boolean;
    localPathsStored?: boolean;
    modelParametersStored?: boolean;
    participantIdentifiersStored?: boolean;
    predictionsStored?: boolean;
    productClaimsIncluded?: boolean;
    productDisplayAuthorized?: boolean;
    productPromotionAuthorized?: boolean;
    rowValuesStored?: boolean;
    smallCellsStored?: boolean;
    sourceBodiesStored?: boolean;
    splitMembershipStored?: boolean;
  };
  candidateMetrics: CandidateMetric[];
  denominatorCountBand: "100-999" | "1000-9999" | "10000+";
  endpoint: Endpoint;
  eventCountBand: "10-99" | "100-999" | "1000+";
  evidenceClass: "local_data_holder_aggregate" | "partner_aggregate_validation";
  evaluatorId: "nsrr_sleep_autonomic_aggregate_evaluator_v1";
  featureSchemaVersion: "murph-age-nsrr-sleep-autonomic-feature-schema.v1";
  horizon: "5y" | "10y" | "source_supported";
  packetId: string;
  receiptAttestations: {
    aggregateOnly: true;
    endpointFrozenBeforeScoring: boolean;
    evaluatorFrozenBeforeExecution: boolean;
    measurementMethodCoverageReported: boolean;
    noCoefficientEgress: true;
    noParticipantEgress: true;
    noPredictionEgress: true;
    noRowEgress: true;
    noSmallCellEgress: true;
    sameDenominatorComparisons: boolean;
    validSleepAutonomicCoverageReported: boolean;
  };
  schemaVersion: "murph-age-nsrr-sleep-autonomic-aggregate-receipt.v1";
}

interface CandidateDecision {
  calibrationAcceptable: boolean;
  candidateId: CandidateId;
  comparatorId: CandidateId;
  decision: "hold_or_reject" | "keep_reference_or_control" | "send_reviewgpt_scientific_delta";
  measurementMethodCalibrationAcceptable: boolean;
  negativeControlBeaten: boolean;
  properScoresImproved: boolean;
  role: Role;
  subgroupCalibrationAcceptable: boolean;
}

export interface R1070NsrrSleepAutonomicAggregateReceiptOptions {
  aggregateReceipt?: R1070NsrrSleepAutonomicAggregateReceiptInput | null;
  aggregateReceiptPath?: string;
  createdAt?: string;
  outputDir?: string;
}

export interface R1070NsrrSleepAutonomicAggregateReceiptOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1070: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1070: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  fillableReceiptTemplate: R1070NsrrSleepAutonomicAggregateReceiptInput;
  inputReceipt: {
    candidateCountBand: "0" | "1-9" | "10-99";
    endpoint: Endpoint | null;
    evaluatorId: "nsrr_sleep_autonomic_aggregate_evaluator_v1" | null;
    eventCountBand: R1070NsrrSleepAutonomicAggregateReceiptInput["eventCountBand"] | null;
    horizon: R1070NsrrSleepAutonomicAggregateReceiptInput["horizon"] | null;
    packetId: string | null;
    schemaVersion: R1070NsrrSleepAutonomicAggregateReceiptInput["schemaVersion"] | null;
    status: "available" | "missing";
  };
  packetId: "r1070-nsrr-sleep-autonomic-aggregate-receipt";
  productDisplayAuthorized: false;
  receiptTemplateArtifact: "r1070-fillable-nsrr-sleep-autonomic-aggregate-receipt.json";
  reduction: {
    candidateDecisions: CandidateDecision[];
    conclusion:
      | "awaiting_nsrr_sleep_autonomic_aggregate_receipt"
      | "nsrr_sleep_autonomic_delta_not_ready"
      | "nsrr_sleep_autonomic_delta_ready_for_scientific_review";
    reviewGptRequired: boolean;
  };
  schemaVersion: typeof R1070_NSRR_SLEEP_AUTONOMIC_AGGREGATE_RECEIPT_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    nextAction:
      | "await_nsrr_aggregate_receipt"
      | "hold_nsrr_delta_no_scientific_review"
      | "send_nsrr_sleep_autonomic_delta_to_reviewgpt";
    productDisplayAuthorized: false;
    reviewGptUse: "only_if_real_nsrr_aggregate_delta_clears_gates";
    rowParsingPerformedByR1070: false;
    templateReadyForDataFill: true;
  };
}

export async function runR1070NsrrSleepAutonomicAggregateReceipt(
  options: R1070NsrrSleepAutonomicAggregateReceiptOptions = {},
): Promise<{ output: R1070NsrrSleepAutonomicAggregateReceiptOutput; outputPath: string; receiptTemplatePath: string }> {
  const fillableReceiptTemplate = createFillableReceiptTemplate();
  const receipt = options.aggregateReceipt ?? await readReceiptFromPath(options.aggregateReceiptPath);
  if (receipt) validateReceipt(receipt);
  const candidateDecisions = receipt ? receipt.candidateMetrics.map(decideCandidate) : [];
  const reviewGptRequired = candidateDecisions.some((decision) =>
    decision.decision === "send_reviewgpt_scientific_delta"
  );
  const conclusion = !receipt
    ? "awaiting_nsrr_sleep_autonomic_aggregate_receipt"
    : reviewGptRequired
      ? "nsrr_sleep_autonomic_delta_ready_for_scientific_review"
      : "nsrr_sleep_autonomic_delta_not_ready";
  const output: R1070NsrrSleepAutonomicAggregateReceiptOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    fillableReceiptTemplate,
    inputReceipt: receipt ? {
      candidateCountBand: countBand(receipt.candidateMetrics.length),
      endpoint: receipt.endpoint,
      evaluatorId: receipt.evaluatorId,
      eventCountBand: receipt.eventCountBand,
      horizon: receipt.horizon,
      packetId: safePacketId(receipt.packetId),
      schemaVersion: receipt.schemaVersion,
      status: "available",
    } : {
      candidateCountBand: "0",
      endpoint: null,
      evaluatorId: null,
      eventCountBand: null,
      horizon: null,
      packetId: null,
      schemaVersion: null,
      status: "missing",
    },
    packetId: "r1070-nsrr-sleep-autonomic-aggregate-receipt",
    productDisplayAuthorized: false,
    receiptTemplateArtifact: RECEIPT_TEMPLATE_FILE_NAME,
    reduction: {
      candidateDecisions,
      conclusion,
      reviewGptRequired,
    },
    schemaVersion: R1070_NSRR_SLEEP_AUTONOMIC_AGGREGATE_RECEIPT_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      nextAction: conclusion === "nsrr_sleep_autonomic_delta_ready_for_scientific_review"
        ? "send_nsrr_sleep_autonomic_delta_to_reviewgpt"
        : conclusion === "nsrr_sleep_autonomic_delta_not_ready"
          ? "hold_nsrr_delta_no_scientific_review"
          : "await_nsrr_aggregate_receipt",
      productDisplayAuthorized: false,
      reviewGptUse: "only_if_real_nsrr_aggregate_delta_clears_gates",
      rowParsingPerformedByR1070: false,
      templateReadyForDataFill: true,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1070 NSRR sleep/autonomic aggregate receipt failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  const receiptTemplatePath = path.join(outputDir, RECEIPT_TEMPLATE_FILE_NAME);
  await Promise.all([
    writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`),
    writeFile(receiptTemplatePath, `${JSON.stringify(fillableReceiptTemplate, null, 2)}\n`),
  ]);
  return { output, outputPath, receiptTemplatePath };
}

function createFillableReceiptTemplate(): R1070NsrrSleepAutonomicAggregateReceiptInput {
  return {
    artifactBoundary: safeBoundary(),
    candidateMetrics: [
      metricTemplate("N1_source_clinical_base", "N0_age_sex", "reference_only", "not_applicable"),
      metricTemplate("N2_sleep_duration_regularity", "N1_source_clinical_base", "score_bearing_research_candidate", "not_beaten"),
      metricTemplate("N3_sleep_breathing_autonomic", "N1_source_clinical_base", "score_bearing_research_candidate", "not_beaten"),
      metricTemplate("N4_sleep_activity_autonomic_combo", "N1_source_clinical_base", "score_bearing_research_candidate", "not_beaten"),
      metricTemplate("N5_coverage_quality_only_negative_control", "N1_source_clinical_base", "negative_control", "not_applicable"),
      metricTemplate("N6_shuffled_sleep_autonomic_negative_control", "N1_source_clinical_base", "negative_control", "not_applicable"),
    ],
    denominatorCountBand: "1000-9999",
    endpoint: "major_cardiovascular_event",
    eventCountBand: "100-999",
    evidenceClass: "local_data_holder_aggregate",
    evaluatorId: "nsrr_sleep_autonomic_aggregate_evaluator_v1",
    featureSchemaVersion: "murph-age-nsrr-sleep-autonomic-feature-schema.v1",
    horizon: "source_supported",
    packetId: "fill-this-nsrr-aggregate-receipt",
    receiptAttestations: {
      aggregateOnly: true,
      endpointFrozenBeforeScoring: true,
      evaluatorFrozenBeforeExecution: true,
      measurementMethodCoverageReported: true,
      noCoefficientEgress: true,
      noParticipantEgress: true,
      noPredictionEgress: true,
      noRowEgress: true,
      noSmallCellEgress: true,
      sameDenominatorComparisons: true,
      validSleepAutonomicCoverageReported: true,
    },
    schemaVersion: "murph-age-nsrr-sleep-autonomic-aggregate-receipt.v1",
  };
}

function metricTemplate(
  candidateId: CandidateId,
  comparatorId: CandidateId,
  role: Role,
  negativeControlStatus: NegativeControlStatus,
): CandidateMetric {
  return {
    aucDelta: null,
    brierDelta: null,
    calibrationSlope: null,
    candidateId,
    comparatorId,
    eOverO: null,
    logLossDelta: null,
    measurementMethodCalibrationStatus: "missing",
    negativeControlStatus,
    role,
    subgroupCalibrationStatus: "missing",
  };
}

function validateReceipt(receipt: R1070NsrrSleepAutonomicAggregateReceiptInput): void {
  const findings = findForbiddenAggregateEgress(receipt);
  if (findings.length > 0) {
    throw new Error(`R1070 input aggregate receipt failed safety validation: ${findings.join("; ")}`);
  }
  if (receipt.evaluatorId !== "nsrr_sleep_autonomic_aggregate_evaluator_v1") {
    throw new Error("R1070 aggregate receipt requires the NSRR sleep/autonomic evaluator id.");
  }
  if (receipt.schemaVersion !== "murph-age-nsrr-sleep-autonomic-aggregate-receipt.v1") {
    throw new Error("R1070 aggregate receipt has an unsupported schema version.");
  }
  if (!ALLOWED_ENDPOINTS.includes(receipt.endpoint)) {
    throw new Error("R1070 aggregate receipt has an unsupported endpoint.");
  }
  if (!["100-999", "1000-9999", "10000+"].includes(receipt.denominatorCountBand)) {
    throw new Error("R1070 aggregate receipt has an unsupported denominator count band.");
  }
  if (!["10-99", "100-999", "1000+"].includes(receipt.eventCountBand)) {
    throw new Error("R1070 aggregate receipt has an unsupported event count band.");
  }
  if (!["local_data_holder_aggregate", "partner_aggregate_validation"].includes(receipt.evidenceClass)) {
    throw new Error("R1070 aggregate receipt has an unsupported evidence class.");
  }
  if (receipt.featureSchemaVersion !== "murph-age-nsrr-sleep-autonomic-feature-schema.v1") {
    throw new Error("R1070 aggregate receipt has an unsupported feature schema version.");
  }
  if (!["5y", "10y", "source_supported"].includes(receipt.horizon)) {
    throw new Error("R1070 aggregate receipt has an unsupported horizon.");
  }
  if (!Array.isArray(receipt.candidateMetrics) || receipt.candidateMetrics.length === 0) {
    throw new Error("R1070 aggregate receipt requires candidateMetrics.");
  }
  validateAttestations(receipt.receiptAttestations);
  for (const metric of receipt.candidateMetrics) validateMetric(metric);
  validateCandidateSet(receipt.candidateMetrics);
}

function validateAttestations(attestations: R1070NsrrSleepAutonomicAggregateReceiptInput["receiptAttestations"]): void {
  const requiredTrue = [
    "aggregateOnly",
    "endpointFrozenBeforeScoring",
    "evaluatorFrozenBeforeExecution",
    "measurementMethodCoverageReported",
    "noCoefficientEgress",
    "noParticipantEgress",
    "noPredictionEgress",
    "noRowEgress",
    "noSmallCellEgress",
    "sameDenominatorComparisons",
    "validSleepAutonomicCoverageReported",
  ] as const;
  for (const key of requiredTrue) {
    if (!attestations || attestations[key] !== true) {
      throw new Error(`R1070 receipt attestation ${key} must be true.`);
    }
  }
}

function validateMetric(metric: CandidateMetric): void {
  if (!ALLOWED_CANDIDATE_IDS.includes(metric.candidateId) || !ALLOWED_CANDIDATE_IDS.includes(metric.comparatorId)) {
    throw new Error("R1070 aggregate receipt has unsupported candidate identifiers.");
  }
  if (metric.candidateId === metric.comparatorId) {
    throw new Error("R1070 aggregate receipt candidate cannot compare against itself.");
  }
  if (!ALLOWED_ROLES.includes(metric.role)) {
    throw new Error("R1070 aggregate receipt has an unsupported candidate role.");
  }
  if (!ALLOWED_NEGATIVE_CONTROL_STATUSES.includes(metric.negativeControlStatus)) {
    throw new Error("R1070 aggregate receipt has an unsupported negative-control status.");
  }
  if (!ALLOWED_GATE_STATUSES.includes(metric.subgroupCalibrationStatus)) {
    throw new Error("R1070 aggregate receipt has an unsupported subgroup calibration status.");
  }
  if (!ALLOWED_GATE_STATUSES.includes(metric.measurementMethodCalibrationStatus)) {
    throw new Error("R1070 aggregate receipt has an unsupported measurement-method calibration status.");
  }
  validateOptionalFiniteMetric("aucDelta", metric.aucDelta);
  validateOptionalFiniteMetric("brierDelta", metric.brierDelta);
  validateOptionalFiniteMetric("calibrationSlope", metric.calibrationSlope);
  validateOptionalFiniteMetric("eOverO", metric.eOverO);
  validateOptionalFiniteMetric("logLossDelta", metric.logLossDelta);
}

function validateCandidateSet(metrics: CandidateMetric[]): void {
  const candidateIds = new Set(metrics.map((metric) => metric.candidateId));
  for (const metric of metrics) {
    if (metric.comparatorId !== "N0_age_sex" && !candidateIds.has(metric.comparatorId)) {
      throw new Error("R1070 aggregate receipt comparators must be present in candidateMetrics.");
    }
  }
  const hasScoreBearing = metrics.some((metric) =>
    metric.role === "score_bearing_research_candidate" && SCORE_BEARING_CANDIDATE_ID_SET.has(metric.candidateId)
  );
  if (!hasScoreBearing) return;
  for (const controlId of REQUIRED_NEGATIVE_CONTROLS) {
    const control = metrics.find((metric) => metric.candidateId === controlId);
    if (!control || control.role !== "negative_control") {
      throw new Error("R1070 NSRR receipts require coverage-quality and shuffled sleep/autonomic negative-control rows.");
    }
  }
}

function validateOptionalFiniteMetric(fieldName: string, value: number | null): void {
  if (value === null) return;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`R1070 aggregate receipt metric ${fieldName} must be a finite number or null.`);
  }
}

function decideCandidate(metric: CandidateMetric): CandidateDecision {
  const properScoresImproved = (metric.brierDelta !== null && metric.brierDelta < 0)
    && (metric.logLossDelta !== null && metric.logLossDelta < 0);
  const calibrationAcceptable = metric.calibrationSlope !== null
    && metric.calibrationSlope >= 0.9
    && metric.calibrationSlope <= 1.1
    && metric.eOverO !== null
    && metric.eOverO >= 0.95
    && metric.eOverO <= 1.05;
  const subgroupCalibrationAcceptable = metric.subgroupCalibrationStatus === "stable"
    || metric.subgroupCalibrationStatus === "not_reportable";
  const measurementMethodCalibrationAcceptable = metric.measurementMethodCalibrationStatus === "stable"
    || metric.measurementMethodCalibrationStatus === "not_reportable";
  const negativeControlBeaten = metric.negativeControlStatus === "beaten"
    || metric.negativeControlStatus === "not_applicable";
  const decision = metric.role !== "score_bearing_research_candidate"
    ? "keep_reference_or_control"
    : SCORE_BEARING_CANDIDATE_ID_SET.has(metric.candidateId)
        && properScoresImproved
        && calibrationAcceptable
        && subgroupCalibrationAcceptable
        && measurementMethodCalibrationAcceptable
        && negativeControlBeaten
      ? "send_reviewgpt_scientific_delta"
      : "hold_or_reject";
  return {
    calibrationAcceptable,
    candidateId: metric.candidateId,
    comparatorId: metric.comparatorId,
    decision,
    measurementMethodCalibrationAcceptable,
    negativeControlBeaten,
    properScoresImproved,
    role: metric.role,
    subgroupCalibrationAcceptable,
  };
}

async function readReceiptFromPath(
  aggregateReceiptPath: string | undefined,
): Promise<R1070NsrrSleepAutonomicAggregateReceiptInput | null> {
  if (!aggregateReceiptPath) return null;
  const parsed = JSON.parse(await readFile(aggregateReceiptPath, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("R1070 aggregate receipt must be an object.");
  }
  const receipt = parsed as R1070NsrrSleepAutonomicAggregateReceiptInput;
  validateReceipt(receipt);
  return receipt;
}

function safeBoundary() {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1070: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1070: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
  } as const;
}

function countBand(count: number): "0" | "1-9" | "10-99" {
  if (count === 0) return "0";
  if (count < 10) return "1-9";
  return "10-99";
}

function safePacketId(packetId: string): string | null {
  return packetId === "r1078-nsrr-sleep-autonomic-local-loop" ? packetId : null;
}

async function main(): Promise<void> {
  const { output } = await runR1070NsrrSleepAutonomicAggregateReceipt({
    aggregateReceiptPath: process.env.MURPH_AGE_NSRR_AGGREGATE_RECEIPT_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  });
  process.stdout.write(`${JSON.stringify({
    candidateCountBand: output.inputReceipt.candidateCountBand,
    conclusion: output.reduction.conclusion,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    receiptTemplateArtifact: output.receiptTemplateArtifact,
    reviewGptRequired: output.reduction.reviewGptRequired,
    rowParsingPerformedByR1070: output.artifactBoundary.rowParsingPerformedByR1070,
    schemaVersion: output.schemaVersion,
    status: output.status,
    templateReadyForDataFill: output.summary.templateReadyForDataFill,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1070 NSRR sleep/autonomic aggregate receipt failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
