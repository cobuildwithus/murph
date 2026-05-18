import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1051_PARTNER_WEARABLE_AGGREGATE_EVALUATOR_SCHEMA_VERSION =
  "murph-age-r1051-partner-wearable-aggregate-evaluator.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1051-partner-wearable-aggregate-evaluator.latest.json";

const ALLOWED_CANDIDATE_IDS = [
  "C0_age_sex",
  "C1_source_clinical_base",
  "C2a_common_labs_only",
  "C2b_vitals_body_only",
  "C2c_common_labs_plus_vitals_body",
  "C2_lab5_or_lab9_bp_body",
  "C3_wearable_activity_sleep_rhr_hrv_only",
  "C3_lab_bp_body_plus_activity_28d",
  "C4_lab_bp_body_plus_activity_sleep_28d",
  "C5_lab_bp_body_plus_activity_sleep_rhr",
  "C6_lab_bp_body_plus_activity_sleep_rhr_hrv_quality_gated",
  "C7_wearable_coverage_quality_only_negative_control",
  "C8_shuffled_wearable_negative_control",
] as const;

const ALLOWED_ENDPOINTS = [
  "all_cause_mortality",
  "major_cardiovascular_event",
  "hospitalization_or_emergency_utilization",
  "incident_cardiometabolic_disease",
  "frailty_disability_or_functional_decline_auxiliary_head",
] as const;
const ALLOWED_DENOMINATOR_COUNT_BANDS = ["100-999", "1000-9999", "10000+"] as const;
const ALLOWED_EVENT_COUNT_BANDS = ["10-99", "100-999", "1000+"] as const;
const ALLOWED_EVIDENCE_CLASSES = [
  "controlled_workbench_aggregate",
  "local_data_holder_aggregate",
  "partner_aggregate_validation",
] as const;
const ALLOWED_GATE_STATUSES = ["missing", "not_reportable", "stable", "unstable"] as const;
const ALLOWED_HORIZONS = ["5y", "10y", "source_supported"] as const;
const ALLOWED_NEGATIVE_CONTROL_STATUSES = ["beaten", "not_applicable", "not_beaten"] as const;
const ALLOWED_ROLES = ["negative_control", "reference_only", "score_bearing_research_candidate"] as const;
const REQUIRED_RECEIPT_CONTEXT_FIELDS = [
  "broadSubgroupSuppressionStatus",
  "confidenceIntervalStatus",
  "featureAvailabilityMissingnessStatus",
  "featureWindowTimingStatus",
  "sourceReleaseGovernanceStatus",
  "wearableCoverageSummaryStatus",
] as const;
const REQUIRED_AGE_SUBBANDS = ["16_17", "18_39", "40_50"] as const;
const REQUIRED_CONSUMER_BLOCK_CANDIDATES = [
  "C2a_common_labs_only",
  "C2b_vitals_body_only",
  "C2c_common_labs_plus_vitals_body",
  "C3_wearable_activity_sleep_rhr_hrv_only",
] as const;
const REQUIRED_WEARABLE_NEGATIVE_CONTROLS = [
  "C7_wearable_coverage_quality_only_negative_control",
  "C8_shuffled_wearable_negative_control",
] as const;
const WEARABLE_INCREMENT_CANDIDATE_IDS = [
  "C3_wearable_activity_sleep_rhr_hrv_only",
  "C3_lab_bp_body_plus_activity_28d",
  "C4_lab_bp_body_plus_activity_sleep_28d",
  "C5_lab_bp_body_plus_activity_sleep_rhr",
  "C6_lab_bp_body_plus_activity_sleep_rhr_hrv_quality_gated",
] as const;
const WEARABLE_INCREMENT_CANDIDATE_ID_SET: ReadonlySet<CandidateId> =
  new Set<CandidateId>(WEARABLE_INCREMENT_CANDIDATE_IDS);

type CandidateId = typeof ALLOWED_CANDIDATE_IDS[number];
type CandidateRole = "negative_control" | "reference_only" | "score_bearing_research_candidate";
type Endpoint = typeof ALLOWED_ENDPOINTS[number];
type GateStatus = "missing" | "not_reportable" | "stable" | "unstable";
type NegativeControlStatus = "beaten" | "not_applicable" | "not_beaten";
type ReceiptContextField = typeof REQUIRED_RECEIPT_CONTEXT_FIELDS[number];
type RequiredAgeSubband = typeof REQUIRED_AGE_SUBBANDS[number];

export interface R1051PartnerWearableAggregateEvaluatorOptions {
  aggregateReceipt?: R1051PartnerWearableAggregateReceiptInput | null;
  aggregateReceiptPath?: string;
  createdAt?: string;
  outputDir?: string;
}

export interface R1051PartnerWearableCandidateMetric {
  aucDelta: number | null;
  brierDelta: number | null;
  calibrationSlope: number | null;
  candidateId: CandidateId;
  comparatorId: CandidateId;
  deviceProviderCalibrationStatus: GateStatus;
  eOverO: number | null;
  logLossDelta: number | null;
  negativeControlStatus: NegativeControlStatus;
  role: CandidateRole;
  subgroupCalibrationStatus: GateStatus;
}

export interface R1051PartnerWearableAggregateReceiptInput {
  ageSubbandEvidence?: Partial<Record<RequiredAgeSubband, GateStatus>>;
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
  candidateMetrics: R1051PartnerWearableCandidateMetric[];
  denominatorCountBand: "100-999" | "1000-9999" | "10000+";
  endpoint: Endpoint;
  eventCountBand: "10-99" | "100-999" | "1000+";
  evidenceClass: "controlled_workbench_aggregate" | "local_data_holder_aggregate" | "partner_aggregate_validation";
  evaluatorId: "partner_integrated_wearable_lab_evaluator_v1";
  featureSchemaVersion: "murph-age-partner-wearable-feature-schema.v1";
  horizon: "5y" | "10y" | "source_supported";
  packetId: string;
  receiptAttestations: {
    aggregateOnly: true;
    deviceProviderCoverageReported: boolean;
    endpointFrozenBeforeScoring: boolean;
    evaluatorFrozenBeforeExecution: boolean;
    noCoefficientEgress: true;
    noParticipantEgress: true;
    noPredictionEgress: true;
    noRowEgress: true;
    noSmallCellEgress: true;
    sameDenominatorComparisons: boolean;
    validDayNightCoverageReported: boolean;
  };
  receiptContext?: Partial<Record<ReceiptContextField, GateStatus>>;
  schemaVersion: "murph-age-partner-wearable-aggregate-receipt.v1";
}

interface CandidateDecision {
  calibrationAcceptable: boolean;
  candidateId: CandidateId;
  comparatorId: CandidateId;
  decision: "hold_or_reject" | "keep_reference_or_control" | "send_reviewgpt_scientific_delta";
  deviceProviderCalibrationAcceptable: boolean;
  negativeControlBeaten: boolean;
  properScoresImproved: boolean;
  role: CandidateRole;
  subgroupCalibrationAcceptable: boolean;
}

export interface R1051PartnerWearableAggregateEvaluatorOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1051: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputReceipt: {
    candidateCountBand: "0" | "1-9" | "10-99";
    endpoint: Endpoint | null;
    evaluatorId: "partner_integrated_wearable_lab_evaluator_v1" | null;
    evidenceClass: R1051PartnerWearableAggregateReceiptInput["evidenceClass"] | null;
    eventCountBand: R1051PartnerWearableAggregateReceiptInput["eventCountBand"] | null;
    horizon: R1051PartnerWearableAggregateReceiptInput["horizon"] | null;
    packetId: string | null;
    schemaVersion: R1051PartnerWearableAggregateReceiptInput["schemaVersion"] | null;
    status: "available" | "missing";
  };
  packetId: "r1051-partner-wearable-aggregate-evaluator";
  reduction: {
    candidateDecisions: CandidateDecision[];
    conclusion:
      | "awaiting_partner_or_workbench_aggregate_receipt"
      | "partner_wearable_delta_not_ready"
      | "partner_wearable_delta_ready_for_scientific_review";
    reviewGptRequired: boolean;
  };
  schemaVersion: typeof R1051_PARTNER_WEARABLE_AGGREGATE_EVALUATOR_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  template: {
    allowedCandidateIds: readonly CandidateId[];
    allowedEndpoints: readonly Endpoint[];
    blockedEgress: readonly string[];
    evaluatorId: "partner_integrated_wearable_lab_evaluator_v1";
    requiredAgeSubbands: readonly string[];
    requiredConsumerBlockCandidates: readonly string[];
    requiredNegativeControls: readonly string[];
    requiredReceiptContextFields: readonly string[];
    requiredReceiptAttestations: readonly string[];
  };
}

export async function runR1051PartnerWearableAggregateEvaluator(
  options: R1051PartnerWearableAggregateEvaluatorOptions = {},
): Promise<{ output: R1051PartnerWearableAggregateEvaluatorOutput; outputPath: string }> {
  const receipt = options.aggregateReceipt ?? await readReceiptFromPath(options.aggregateReceiptPath);
  if (receipt) validateReceipt(receipt);
  const candidateDecisions = receipt ? receipt.candidateMetrics.map(decideCandidate) : [];
  const reviewGptRequired = candidateDecisions.some((decision) =>
    decision.decision === "send_reviewgpt_scientific_delta"
  );
  const conclusion = !receipt
    ? "awaiting_partner_or_workbench_aggregate_receipt"
    : reviewGptRequired
      ? "partner_wearable_delta_ready_for_scientific_review"
      : "partner_wearable_delta_not_ready";

  const output: R1051PartnerWearableAggregateEvaluatorOutput = {
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
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR1051: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputReceipt: receipt ? {
      candidateCountBand: countBand(receipt.candidateMetrics.length),
      endpoint: receipt.endpoint,
      evaluatorId: receipt.evaluatorId,
      evidenceClass: receipt.evidenceClass,
      eventCountBand: receipt.eventCountBand,
      horizon: receipt.horizon,
      packetId: safePacketId(receipt.packetId),
      schemaVersion: receipt.schemaVersion,
      status: "available",
    } : {
      candidateCountBand: "0",
      endpoint: null,
      evaluatorId: null,
      evidenceClass: null,
      eventCountBand: null,
      horizon: null,
      packetId: null,
      schemaVersion: null,
      status: "missing",
    },
    packetId: "r1051-partner-wearable-aggregate-evaluator",
    reduction: {
      candidateDecisions,
      conclusion,
      reviewGptRequired,
    },
    schemaVersion: R1051_PARTNER_WEARABLE_AGGREGATE_EVALUATOR_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    template: {
      allowedCandidateIds: ALLOWED_CANDIDATE_IDS,
      allowedEndpoints: ALLOWED_ENDPOINTS,
      blockedEgress: [
        "rows",
        "participant_identifiers",
        "split_memberships",
        "predictions",
        "fitted_model_coefficients",
        "model_parameters",
        "source_bodies",
        "codebook_text",
        "small_cells",
        "product_claims",
      ],
      evaluatorId: "partner_integrated_wearable_lab_evaluator_v1",
      requiredAgeSubbands: [...REQUIRED_AGE_SUBBANDS],
      requiredConsumerBlockCandidates: [...REQUIRED_CONSUMER_BLOCK_CANDIDATES],
      requiredNegativeControls: [
        "wearable_coverage_quality_only",
        "shuffled_wearable_features",
        "device_provider_or_source_context_only",
      ],
      requiredReceiptContextFields: [...REQUIRED_RECEIPT_CONTEXT_FIELDS],
      requiredReceiptAttestations: [
        "evaluatorFrozenBeforeExecution",
        "endpointFrozenBeforeScoring",
        "sameDenominatorComparisons",
        "validDayNightCoverageReported",
        "deviceProviderCoverageReported",
        "noRowEgress",
        "noParticipantEgress",
        "noPredictionEgress",
        "noCoefficientEgress",
        "noSmallCellEgress",
      ],
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1051 partner wearable aggregate evaluator failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function validateReceipt(receipt: R1051PartnerWearableAggregateReceiptInput): void {
  const findings = findForbiddenAggregateEgress(receipt);
  if (findings.length > 0) {
    throw new Error(`R1051 input aggregate receipt failed safety validation: ${findings.join("; ")}`);
  }
  if (receipt.evaluatorId !== "partner_integrated_wearable_lab_evaluator_v1") {
    throw new Error("R1051 aggregate receipt requires the partner integrated wearable evaluator id.");
  }
  if (receipt.schemaVersion !== "murph-age-partner-wearable-aggregate-receipt.v1") {
    throw new Error("R1051 aggregate receipt has an unsupported schema version.");
  }
  if (!ALLOWED_ENDPOINTS.includes(receipt.endpoint)) {
    throw new Error("R1051 aggregate receipt has an unsupported endpoint.");
  }
  if (!ALLOWED_DENOMINATOR_COUNT_BANDS.includes(receipt.denominatorCountBand)) {
    throw new Error("R1051 aggregate receipt has an unsupported denominator count band.");
  }
  if (!ALLOWED_EVENT_COUNT_BANDS.includes(receipt.eventCountBand)) {
    throw new Error("R1051 aggregate receipt has an unsupported event count band.");
  }
  if (!ALLOWED_EVIDENCE_CLASSES.includes(receipt.evidenceClass)) {
    throw new Error("R1051 aggregate receipt has an unsupported evidence class.");
  }
  if (receipt.featureSchemaVersion !== "murph-age-partner-wearable-feature-schema.v1") {
    throw new Error("R1051 aggregate receipt has an unsupported feature schema version.");
  }
  if (!ALLOWED_HORIZONS.includes(receipt.horizon)) {
    throw new Error("R1051 aggregate receipt has an unsupported horizon.");
  }
  if (!Array.isArray(receipt.candidateMetrics) || receipt.candidateMetrics.length === 0) {
    throw new Error("R1051 aggregate receipt requires candidateMetrics.");
  }
  validateAttestations(receipt.receiptAttestations);
  for (const metric of receipt.candidateMetrics) validateMetric(metric);
  validateCandidateSet(receipt.candidateMetrics);
  validateAgeSubbandEvidence(receipt.ageSubbandEvidence);
  validateReceiptContext(receipt.receiptContext);
}

function validateAttestations(attestations: R1051PartnerWearableAggregateReceiptInput["receiptAttestations"]): void {
  if (!attestations || attestations.aggregateOnly !== true) throw new Error("R1051 receipt must attest aggregateOnly.");
  const requiredTrue = [
    "deviceProviderCoverageReported",
    "endpointFrozenBeforeScoring",
    "evaluatorFrozenBeforeExecution",
    "noCoefficientEgress",
    "noParticipantEgress",
    "noPredictionEgress",
    "noRowEgress",
    "noSmallCellEgress",
    "sameDenominatorComparisons",
    "validDayNightCoverageReported",
  ] as const;
  for (const key of requiredTrue) {
    if (attestations[key] !== true) throw new Error(`R1051 receipt attestation ${key} must be true.`);
  }
}

function validateMetric(metric: R1051PartnerWearableCandidateMetric): void {
  if (!ALLOWED_CANDIDATE_IDS.includes(metric.candidateId) || !ALLOWED_CANDIDATE_IDS.includes(metric.comparatorId)) {
    throw new Error("R1051 aggregate receipt has unsupported candidate identifiers.");
  }
  if (metric.candidateId === metric.comparatorId) {
    throw new Error("R1051 aggregate receipt candidate cannot compare against itself.");
  }
  if (!ALLOWED_ROLES.includes(metric.role)) {
    throw new Error("R1051 aggregate receipt has an unsupported candidate role.");
  }
  if (!ALLOWED_NEGATIVE_CONTROL_STATUSES.includes(metric.negativeControlStatus)) {
    throw new Error("R1051 aggregate receipt has an unsupported negative-control status.");
  }
  if (!ALLOWED_GATE_STATUSES.includes(metric.subgroupCalibrationStatus)) {
    throw new Error("R1051 aggregate receipt has an unsupported subgroup calibration status.");
  }
  if (!ALLOWED_GATE_STATUSES.includes(metric.deviceProviderCalibrationStatus)) {
    throw new Error("R1051 aggregate receipt has an unsupported device/provider calibration status.");
  }
  validateOptionalFiniteMetric("aucDelta", metric.aucDelta);
  validateOptionalFiniteMetric("brierDelta", metric.brierDelta);
  validateOptionalFiniteMetric("calibrationSlope", metric.calibrationSlope);
  validateOptionalFiniteMetric("eOverO", metric.eOverO);
  validateOptionalFiniteMetric("logLossDelta", metric.logLossDelta);
}

function validateOptionalFiniteMetric(fieldName: string, value: number | null): void {
  if (value === null) return;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`R1051 aggregate receipt metric ${fieldName} must be a finite number or null.`);
  }
}

function validateCandidateSet(metrics: R1051PartnerWearableCandidateMetric[]): void {
  const candidateIds = new Set(metrics.map((metric) => metric.candidateId));
  for (const metric of metrics) {
    if (metric.comparatorId !== "C0_age_sex" && !candidateIds.has(metric.comparatorId)) {
      throw new Error("R1051 aggregate receipt comparators must be present in candidateMetrics.");
    }
  }

  const hasWearableScoreCandidate = metrics.some((metric) =>
    metric.role === "score_bearing_research_candidate" && isWearableIncrement(metric.candidateId)
  );
  if (!hasWearableScoreCandidate) return;

  for (const candidateId of REQUIRED_CONSUMER_BLOCK_CANDIDATES) {
    if (!candidateIds.has(candidateId)) {
      throw new Error("R1051 aggregate wearable receipts require lab-only, vitals/body-only, lab+vitals/body, and wearable-only block rows.");
    }
  }
  for (const controlId of REQUIRED_WEARABLE_NEGATIVE_CONTROLS) {
    const control = metrics.find((metric) => metric.candidateId === controlId);
    if (!control || control.role !== "negative_control") {
      throw new Error("R1051 aggregate wearable receipts require both coverage-quality and shuffled-wearable negative-control rows.");
    }
  }
}

function validateAgeSubbandEvidence(
  ageSubbandEvidence: R1051PartnerWearableAggregateReceiptInput["ageSubbandEvidence"],
): void {
  if (!ageSubbandEvidence) return;
  for (const subband of REQUIRED_AGE_SUBBANDS) {
    const status = ageSubbandEvidence[subband];
    if (!status || !ALLOWED_GATE_STATUSES.includes(status)) {
      throw new Error("R1051 aggregate receipt age subband evidence must include 16_17, 18_39, and 40_50 statuses.");
    }
  }
}

function validateReceiptContext(
  receiptContext: R1051PartnerWearableAggregateReceiptInput["receiptContext"],
): void {
  if (!receiptContext) return;
  for (const field of REQUIRED_RECEIPT_CONTEXT_FIELDS) {
    const status = receiptContext[field];
    if (!status || !ALLOWED_GATE_STATUSES.includes(status)) {
      throw new Error("R1051 aggregate receipt context must include source, timing, availability, coverage, confidence interval, and subgroup suppression statuses.");
    }
  }
}

function isWearableIncrement(candidateId: CandidateId): boolean {
  return WEARABLE_INCREMENT_CANDIDATE_ID_SET.has(candidateId);
}

function decideCandidate(metric: R1051PartnerWearableCandidateMetric): CandidateDecision {
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
  const deviceProviderCalibrationAcceptable = metric.deviceProviderCalibrationStatus === "stable"
    || metric.deviceProviderCalibrationStatus === "not_reportable";
  const negativeControlBeaten = metric.negativeControlStatus === "beaten"
    || metric.negativeControlStatus === "not_applicable";
  const decision = metric.role !== "score_bearing_research_candidate"
    ? "keep_reference_or_control"
    : isWearableIncrement(metric.candidateId)
        && properScoresImproved
        && calibrationAcceptable
        && subgroupCalibrationAcceptable
        && deviceProviderCalibrationAcceptable
        && negativeControlBeaten
      ? "send_reviewgpt_scientific_delta"
      : "hold_or_reject";
  return {
    calibrationAcceptable,
    candidateId: metric.candidateId,
    comparatorId: metric.comparatorId,
    decision,
    deviceProviderCalibrationAcceptable,
    negativeControlBeaten,
    properScoresImproved,
    role: metric.role,
    subgroupCalibrationAcceptable,
  };
}

async function readReceiptFromPath(
  aggregateReceiptPath: string | undefined,
): Promise<R1051PartnerWearableAggregateReceiptInput | null> {
  if (!aggregateReceiptPath) return null;
  const parsed = JSON.parse(await readFile(aggregateReceiptPath, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("R1051 aggregate receipt must be an object.");
  }
  const receipt = parsed as R1051PartnerWearableAggregateReceiptInput;
  validateReceipt(receipt);
  return receipt;
}

function countBand(count: number): "0" | "1-9" | "10-99" {
  if (count === 0) return "0";
  if (count < 10) return "1-9";
  return "10-99";
}

function safePacketId(packetId: string): string | null {
  return /^[a-z0-9][a-z0-9._-]{0,120}$/u.test(packetId) ? packetId : null;
}

async function main(): Promise<void> {
  const { output } = await runR1051PartnerWearableAggregateEvaluator({
    aggregateReceiptPath: process.env.MURPH_AGE_R1051_PARTNER_RECEIPT_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  });
  process.stdout.write(`${JSON.stringify({
    artifact: OUTPUT_FILE_NAME,
    candidateCountBand: output.inputReceipt.candidateCountBand,
    conclusion: output.reduction.conclusion,
    evaluatorId: output.template.evaluatorId,
    packetId: output.packetId,
    productDisplayAuthorized: output.artifactBoundary.productDisplayAuthorized,
    reviewGptRequired: output.reduction.reviewGptRequired,
    rowParsingPerformedByR1051: output.artifactBoundary.rowParsingPerformedByR1051,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1051 partner wearable aggregate evaluator failed."}\n`);
    process.exitCode = 1;
  });
}
