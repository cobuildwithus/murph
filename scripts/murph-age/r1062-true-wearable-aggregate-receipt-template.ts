import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  runR1051PartnerWearableAggregateEvaluator,
  type R1051PartnerWearableAggregateReceiptInput,
} from "./r1051-partner-wearable-aggregate-evaluator.ts";

export const R1062_TRUE_WEARABLE_AGGREGATE_RECEIPT_TEMPLATE_SCHEMA_VERSION =
  "murph-age-r1062-true-wearable-aggregate-receipt-template.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1062-true-wearable-aggregate-receipt-template.latest.json";
const RECEIPT_TEMPLATE_FILE_NAME = "r1062-fillable-aggregate-receipt-template.json";

type CandidateId = R1051PartnerWearableAggregateReceiptInput["candidateMetrics"][number]["candidateId"];
type CandidateRole = R1051PartnerWearableAggregateReceiptInput["candidateMetrics"][number]["role"];
type NegativeControlStatus = R1051PartnerWearableAggregateReceiptInput["candidateMetrics"][number]["negativeControlStatus"];

const CANDIDATE_ROWS: Array<{
  candidateId: CandidateId;
  comparatorId: CandidateId;
  negativeControlStatus: NegativeControlStatus;
  role: CandidateRole;
}> = [
  {
    candidateId: "C1_source_clinical_base",
    comparatorId: "C0_age_sex",
    negativeControlStatus: "not_applicable",
    role: "reference_only",
  },
  {
    candidateId: "C2a_common_labs_only",
    comparatorId: "C1_source_clinical_base",
    negativeControlStatus: "not_applicable",
    role: "reference_only",
  },
  {
    candidateId: "C2b_vitals_body_only",
    comparatorId: "C1_source_clinical_base",
    negativeControlStatus: "not_applicable",
    role: "reference_only",
  },
  {
    candidateId: "C2c_common_labs_plus_vitals_body",
    comparatorId: "C1_source_clinical_base",
    negativeControlStatus: "not_applicable",
    role: "reference_only",
  },
  {
    candidateId: "C2_lab5_or_lab9_bp_body",
    comparatorId: "C2c_common_labs_plus_vitals_body",
    negativeControlStatus: "not_applicable",
    role: "reference_only",
  },
  {
    candidateId: "C3_wearable_activity_sleep_rhr_hrv_only",
    comparatorId: "C1_source_clinical_base",
    negativeControlStatus: "not_beaten",
    role: "score_bearing_research_candidate",
  },
  {
    candidateId: "C3_lab_bp_body_plus_activity_28d",
    comparatorId: "C2_lab5_or_lab9_bp_body",
    negativeControlStatus: "not_beaten",
    role: "score_bearing_research_candidate",
  },
  {
    candidateId: "C4_lab_bp_body_plus_activity_sleep_28d",
    comparatorId: "C2_lab5_or_lab9_bp_body",
    negativeControlStatus: "not_beaten",
    role: "score_bearing_research_candidate",
  },
  {
    candidateId: "C5_lab_bp_body_plus_activity_sleep_rhr",
    comparatorId: "C2_lab5_or_lab9_bp_body",
    negativeControlStatus: "not_beaten",
    role: "score_bearing_research_candidate",
  },
  {
    candidateId: "C6_lab_bp_body_plus_activity_sleep_rhr_hrv_quality_gated",
    comparatorId: "C2_lab5_or_lab9_bp_body",
    negativeControlStatus: "not_beaten",
    role: "score_bearing_research_candidate",
  },
  {
    candidateId: "C7_wearable_coverage_quality_only_negative_control",
    comparatorId: "C2_lab5_or_lab9_bp_body",
    negativeControlStatus: "not_applicable",
    role: "negative_control",
  },
  {
    candidateId: "C8_shuffled_wearable_negative_control",
    comparatorId: "C2_lab5_or_lab9_bp_body",
    negativeControlStatus: "not_applicable",
    role: "negative_control",
  },
];

export interface R1062TrueWearableAggregateReceiptTemplateOptions {
  createdAt?: string;
  outputDir?: string;
}

export interface R1062TrueWearableAggregateReceiptTemplateOutput {
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
    rowParsingPerformedByR1062: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  fillableReceiptTemplate: R1051PartnerWearableAggregateReceiptInput;
  packetId: "r1062-true-wearable-aggregate-receipt-template";
  productDisplayAuthorized: false;
  receiptTemplateArtifact: "r1062-fillable-aggregate-receipt-template.json";
  schemaVersion: typeof R1062_TRUE_WEARABLE_AGGREGATE_RECEIPT_TEMPLATE_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    candidateMetricCount: number;
    nextValidationCommand: "MURPH_AGE_TRUE_WEARABLE_AGGREGATE_RECEIPT_PATH=<receipt.json> pnpm exec tsx scripts/murph-age/r1059-true-wearable-aggregate-receipt-intake.ts";
    productDisplayAuthorized: false;
    reviewGptUse: "only_if_r1059_returns_aggregate_receipt_ready_for_reviewgpt";
    templateEvaluatorConclusion: "partner_wearable_delta_not_ready";
    templateReadyForDataFill: true;
  };
}

export async function runR1062TrueWearableAggregateReceiptTemplate(
  options: R1062TrueWearableAggregateReceiptTemplateOptions = {},
): Promise<{ output: R1062TrueWearableAggregateReceiptTemplateOutput; outputPath: string; receiptTemplatePath: string }> {
  const fillableReceiptTemplate = createFillableReceiptTemplate();
  const templateEvaluatorConclusion = await validateTemplateWithR1051(fillableReceiptTemplate);
  const output: R1062TrueWearableAggregateReceiptTemplateOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    fillableReceiptTemplate,
    packetId: "r1062-true-wearable-aggregate-receipt-template",
    productDisplayAuthorized: false,
    receiptTemplateArtifact: RECEIPT_TEMPLATE_FILE_NAME,
    schemaVersion: R1062_TRUE_WEARABLE_AGGREGATE_RECEIPT_TEMPLATE_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      candidateMetricCount: fillableReceiptTemplate.candidateMetrics.length,
      nextValidationCommand:
        "MURPH_AGE_TRUE_WEARABLE_AGGREGATE_RECEIPT_PATH=<receipt.json> pnpm exec tsx scripts/murph-age/r1059-true-wearable-aggregate-receipt-intake.ts",
      productDisplayAuthorized: false,
      reviewGptUse: "only_if_r1059_returns_aggregate_receipt_ready_for_reviewgpt",
      templateEvaluatorConclusion,
      templateReadyForDataFill: true,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1062 true wearable aggregate receipt template failed aggregate-egress validation: ${findings.join("; ")}`);
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

function createFillableReceiptTemplate(): R1051PartnerWearableAggregateReceiptInput {
  return {
    ageSubbandEvidence: {
      "16_17": "missing",
      "18_39": "missing",
      "40_50": "missing",
    },
    artifactBoundary: safeBoundary(),
    candidateMetrics: CANDIDATE_ROWS.map((candidate) => ({
      aucDelta: null,
      brierDelta: null,
      calibrationSlope: null,
      candidateId: candidate.candidateId,
      comparatorId: candidate.comparatorId,
      deviceProviderCalibrationStatus: "missing",
      eOverO: null,
      logLossDelta: null,
      negativeControlStatus: candidate.negativeControlStatus,
      role: candidate.role,
      subgroupCalibrationStatus: "missing",
    })),
    denominatorCountBand: "1000-9999",
    endpoint: "hospitalization_or_emergency_utilization",
    eventCountBand: "100-999",
    evidenceClass: "local_data_holder_aggregate",
    evaluatorId: "partner_integrated_wearable_lab_evaluator_v1",
    featureSchemaVersion: "murph-age-partner-wearable-feature-schema.v1",
    horizon: "source_supported",
    packetId: "fill-this-aggregate-receipt",
    receiptAttestations: {
      aggregateOnly: true,
      deviceProviderCoverageReported: true,
      endpointFrozenBeforeScoring: true,
      evaluatorFrozenBeforeExecution: true,
      noCoefficientEgress: true,
      noParticipantEgress: true,
      noPredictionEgress: true,
      noRowEgress: true,
      noSmallCellEgress: true,
      sameDenominatorComparisons: true,
      validDayNightCoverageReported: true,
    },
    receiptContext: {
      broadSubgroupSuppressionStatus: "missing",
      confidenceIntervalStatus: "missing",
      featureAvailabilityMissingnessStatus: "missing",
      featureWindowTimingStatus: "missing",
      sourceReleaseGovernanceStatus: "missing",
      wearableCoverageSummaryStatus: "missing",
    },
    schemaVersion: "murph-age-partner-wearable-aggregate-receipt.v1",
  };
}

async function validateTemplateWithR1051(
  receipt: R1051PartnerWearableAggregateReceiptInput,
): Promise<R1062TrueWearableAggregateReceiptTemplateOutput["summary"]["templateEvaluatorConclusion"]> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "murph-age-r1062-r1051-"));
  try {
    const { output } = await runR1051PartnerWearableAggregateEvaluator({
      aggregateReceipt: receipt,
      outputDir: tmp,
    });
    if (output.reduction.conclusion !== "partner_wearable_delta_not_ready") {
      throw new Error("R1062 template receipt should validate but not create a scientific delta before metrics are filled.");
    }
    return output.reduction.conclusion;
  } finally {
    await rm(tmp, { force: true, recursive: true });
  }
}

function safeBoundary() {
  return {
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
    rowParsingPerformedByR1062: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
  } as const;
}

async function main(): Promise<void> {
  const { output } = await runR1062TrueWearableAggregateReceiptTemplate({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  });
  process.stdout.write(`${JSON.stringify({
    candidateMetricCount: output.summary.candidateMetricCount,
    nextValidationCommand: output.summary.nextValidationCommand,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    receiptTemplateArtifact: output.receiptTemplateArtifact,
    schemaVersion: output.schemaVersion,
    status: output.status,
    templateEvaluatorConclusion: output.summary.templateEvaluatorConclusion,
    templateReadyForDataFill: output.summary.templateReadyForDataFill,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1062 true wearable aggregate receipt template failed."}\n`);
    process.exitCode = 1;
  });
}
