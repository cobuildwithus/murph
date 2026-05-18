import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1037_NHANES_EXISTING_AGGREGATE_RESULTS_PACKET_SCHEMA_VERSION =
  "murph-age-r1037-nhanes-existing-aggregate-results-packet.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME = "r1037-nhanes-existing-aggregate-results-packet.latest.json";

const DEFAULT_R849_PATH = path.join(
  "output-packages",
  "research",
  "murph-age",
  "autoresearch",
  "loop",
  "runs",
  "session_murph_age_r849_nhanes_lab_first_product_shaped_loop",
  "nhanes-lab-first-product-shaped-loop-r849.json",
);
const DEFAULT_R850_PATH = path.join(
  "output-packages",
  "research",
  "murph-age",
  "autoresearch",
  "loop",
  "runs",
  "session_murph_age_r850_nhanes_2003_2006_hip_activity_loop",
  "nhanes-2003-2006-hip-activity-loop-r850.json",
);
const DEFAULT_R852_PATH = path.join(
  "output-packages",
  "research",
  "murph-age",
  "autoresearch",
  "loop",
  "runs",
  "session_murph_age_r852_r850_activity_stability",
  "r850-activity-stability-r852.json",
);

interface CountSummary {
  suppressed: boolean;
  value: number | null;
}

interface ComparisonSummary {
  aucDelta: number | null;
  brierDelta: number | null;
  candidateId: string | null;
  comparatorId: string | null;
  direction: string | null;
  logLossDelta: number | null;
}

interface ModelMetricSummary {
  modelId: string;
  observedRateWeighted: number | null;
  testAuc: number | null;
  testBrierWeighted: number | null;
  testEvents: CountSummary | null;
  testLogLossWeighted: number | null;
  testMeanPredictedWeighted: number | null;
  testN: CountSummary | null;
  weightedExpectedObservedRatio: number | null;
}

interface StabilitySummary {
  aucCiCrossesZero: boolean | null;
  brierCiIncludesNoImprovement: boolean | null;
  brierImprovedFraction: number | null;
  brierWeightedDeltaCi: Record<"p025" | "p50" | "p975", number | null>;
  logLossCiIncludesNoImprovement: boolean | null;
  logLossImprovedFraction: number | null;
  logLossWeightedDeltaCi: Record<"p025" | "p50" | "p975", number | null>;
  repsBand: string;
}

export interface R1037NhanesExistingAggregateResultsPacketOptions {
  createdAt?: string;
  outputDir?: string;
  r849Path?: string;
  r850Path?: string;
  r852Path?: string;
}

export interface R1037NhanesExistingAggregateResultsPacketOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  existingResults: {
    r849LabFirst: {
      comparisons: Record<string, ComparisonSummary>;
      denominator: { ageRange: string | null; completeCaseN: CountSummary | null };
      endpoint: string | null;
      evidenceClass: string | null;
      selectedMetrics: ModelMetricSummary[];
      supportRead: Record<string, string>;
    };
    r850HipActivity: {
      comparisons: Record<string, ComparisonSummary>;
      denominator: {
        ageRange: string | null;
        completeCaseN: CountSummary | null;
        minimumValidActivityDays: number | null;
      };
      endpoint: string | null;
      evidenceClass: string | null;
      selectedMetrics: ModelMetricSummary[];
      stability: StabilitySummary;
      supportRead: Record<string, string>;
    };
  };
  gapsBeforePromotion: string[];
  packetId: "r1037-nhanes-existing-aggregate-results-packet";
  reviewGptQuestions: string[];
  schemaVersion: typeof R1037_NHANES_EXISTING_AGGREGATE_RESULTS_PACKET_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: "existing_nhanes_lab_activity_results_ready_for_scientific_review";
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendedGate: "aggregate_results_gate";
    rowValuesStored: false;
  };
}

export async function runR1037NhanesExistingAggregateResultsPacket(
  options: R1037NhanesExistingAggregateResultsPacketOptions = {},
): Promise<{ output: R1037NhanesExistingAggregateResultsPacketOutput; outputPath: string }> {
  const [r849, r850, r852] = await Promise.all([
    readJson(options.r849Path ?? DEFAULT_R849_PATH),
    readJson(options.r850Path ?? DEFAULT_R850_PATH),
    readJson(options.r852Path ?? DEFAULT_R852_PATH),
  ]);

  const output: R1037NhanesExistingAggregateResultsPacketOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      localFileNamesStored: false,
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
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    existingResults: {
      r849LabFirst: {
        comparisons: comparisonSummaries(readRecordAt(r849, ["comparisons"])),
        denominator: {
          ageRange: readStringAt(r849, ["denominator", "age_range"]),
          completeCaseN: readCountAt(r849, ["denominator", "complete_case_n"]),
        },
        endpoint: readStringAt(r849, ["endpoint"]),
        evidenceClass: readStringAt(r849, ["evidence_class"]),
        selectedMetrics: selectedMetrics(r849, [
          "age_sex_reference",
          "bp_body_reference",
          "lab9_hba1c_bp_body_primary",
          "lab9_glucose_bp_body_sensitivity",
          "lab10_both_glycemia_bp_body_sensitivity",
        ]),
        supportRead: stringRecordAt(r849, ["support_read"]),
      },
      r850HipActivity: {
        comparisons: comparisonSummaries(readRecordAt(r850, ["comparisons"])),
        denominator: {
          ageRange: readStringAt(r850, ["denominator", "age_range"]),
          completeCaseN: readCountAt(r850, ["denominator", "complete_case_n"]),
          minimumValidActivityDays: readNumberAt(r850, ["denominator", "minimum_valid_activity_days"]),
        },
        endpoint: readStringAt(r850, ["endpoint"]),
        evidenceClass: readStringAt(r850, ["evidence_class"]),
        selectedMetrics: selectedMetrics(r850, [
          "age_sex_reference",
          "age_sex_activity",
          "lab10_bp_body_reference",
          "lab10_bp_body_activity",
        ]),
        stability: stabilitySummary(r852),
        supportRead: stringRecordAt(r850, ["support_read"]),
      },
    },
    gapsBeforePromotion: [
      "calibration_slope_not_exported_in_existing_r849_r850_artifacts",
      "modern_negative_controls_not_complete_in_existing_r849_r850_artifacts",
      "nhanes_objective_activity_is_not_consumer_wearable_validation",
      "same_family_nhanes_evidence_is_not_product_promotion_evidence",
    ],
    packetId: "r1037-nhanes-existing-aggregate-results-packet",
    reviewGptQuestions: [
      "Should Codex rerun NHANES lab/activity with the modern receipt fields before moving to external lab transport?",
      "Should lab9/lab10 remain the research candidate, or should the next transport loop shrink to lab5 or a minimal portable lab set?",
      "What exact negative controls and calibration diagnostics must be added before another aggregate-result packet?",
      "Which next non-NHANES source path should be prioritized after this result: external lab transport or partner/workbench wearable-lab evaluator?",
    ],
    schemaVersion: R1037_NHANES_EXISTING_AGGREGATE_RESULTS_PACKET_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "existing_nhanes_lab_activity_results_ready_for_scientific_review",
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendedGate: "aggregate_results_gate",
      rowValuesStored: false,
    },
  };

  assertR1037Safe(output);
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

export function assertR1037Safe(output: R1037NhanesExistingAggregateResultsPacketOutput): void {
  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findR1037SpecificFindings(output),
  ];
  if (findings.length > 0) {
    throw new Error(`R1037 NHANES aggregate results packet failed safety validation: ${findings.join("; ")}`);
  }
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

function selectedMetrics(root: unknown, modelIds: string[]): ModelMetricSummary[] {
  const metrics = readArrayAt(root, ["metrics"]);
  return modelIds.flatMap((modelId) => {
    const metric = metrics.map(optionalRecord).find((item) => item?.model_id === modelId);
    return metric ? [modelMetricSummary(metric, modelId)] : [];
  });
}

function modelMetricSummary(metric: Record<string, unknown>, modelId: string): ModelMetricSummary {
  const test = optionalRecord(metric.test_metrics);
  const meanPredicted = readNumberAt(test, ["mean_predicted_weighted"])
    ?? readNumberAt(test, ["mean_predicted"]);
  const observedRate = readNumberAt(test, ["observed_rate_weighted"])
    ?? readNumberAt(test, ["observed_rate"]);
  return {
    modelId,
    observedRateWeighted: observedRate,
    testAuc: readNumberAt(test, ["auc_unweighted"]) ?? readNumberAt(test, ["auc"]),
    testBrierWeighted: readNumberAt(test, ["brier_weighted"]) ?? readNumberAt(test, ["brier"]),
    testEvents: readCountAt(metric, ["event_counts", "test"]),
    testLogLossWeighted: readNumberAt(test, ["log_loss_weighted"]) ?? readNumberAt(test, ["log_loss"]),
    testMeanPredictedWeighted: meanPredicted,
    testN: readCountAt(metric, ["split_counts", "test"]),
    weightedExpectedObservedRatio: observedRate && meanPredicted !== null
      ? round(meanPredicted / observedRate)
      : null,
  };
}

function comparisonSummaries(record: Record<string, unknown>): Record<string, ComparisonSummary> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => {
    const item = optionalRecord(value);
    return [key, {
      aucDelta: readNumberAt(item, ["auc_delta"]),
      brierDelta: readNumberAt(item, ["brier_weighted_delta"])
        ?? readNumberAt(item, ["brier_delta"])
        ?? readNumberAt(item, ["brier_unweighted_delta"]),
      candidateId: readStringAt(item, ["candidate"]),
      comparatorId: readStringAt(item, ["baseline"]),
      direction: readStringAt(item, ["direction"]),
      logLossDelta: readNumberAt(item, ["log_loss_weighted_delta"])
        ?? readNumberAt(item, ["log_loss_delta"])
        ?? readNumberAt(item, ["log_loss_unweighted_delta"]),
    }];
  }));
}

function stabilitySummary(root: unknown): StabilitySummary {
  const comparison = readRecordAt(root, ["comparisons", "activity_increment_over_lab10_bp_body", "bootstrap"]);
  const brierCi = ciRecord(comparison, "brier_weighted_delta_ci");
  const logLossCi = ciRecord(comparison, "log_loss_weighted_delta_ci");
  const aucCi = ciRecord(comparison, "auc_delta_ci");
  return {
    aucCiCrossesZero: crossesZero(aucCi),
    brierCiIncludesNoImprovement: ciIncludesNoImprovement(brierCi),
    brierImprovedFraction: readNumberAt(comparison, ["fraction_brier_improved"]),
    brierWeightedDeltaCi: brierCi,
    logLossCiIncludesNoImprovement: ciIncludesNoImprovement(logLossCi),
    logLossImprovedFraction: readNumberAt(comparison, ["fraction_log_loss_improved"]),
    logLossWeightedDeltaCi: logLossCi,
    repsBand: countBand(readNumberAt(comparison, ["bootstrap_reps"]) ?? readNumberAt(root, ["bootstrap_reps"]) ?? 0),
  };
}

function ciRecord(root: Record<string, unknown>, key: string): Record<"p025" | "p50" | "p975", number | null> {
  const record = optionalRecord(root[key]);
  return {
    p025: readNumberAt(record, ["p025"]),
    p50: readNumberAt(record, ["p50"]),
    p975: readNumberAt(record, ["p975"]),
  };
}

function crossesZero(ci: Record<"p025" | "p50" | "p975", number | null>): boolean | null {
  if (ci.p025 === null || ci.p975 === null) return null;
  return ci.p025 <= 0 && ci.p975 >= 0;
}

function ciIncludesNoImprovement(ci: Record<"p025" | "p50" | "p975", number | null>): boolean | null {
  if (ci.p025 === null || ci.p975 === null) return null;
  return ci.p975 >= 0;
}

function stringRecordAt(root: unknown, keys: string[]): Record<string, string> {
  const record = readRecordAt(root, keys);
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function readRecordAt(root: unknown, keys: string[]): Record<string, unknown> {
  const value = readAt(root, keys);
  return optionalRecord(value) ?? {};
}

function readArrayAt(root: unknown, keys: string[]): unknown[] {
  const value = readAt(root, keys);
  return Array.isArray(value) ? value : [];
}

function readStringAt(root: unknown, keys: string[]): string | null {
  const value = readAt(root, keys);
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumberAt(root: unknown, keys: string[]): number | null {
  const value = readAt(root, keys);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readCountAt(root: unknown, keys: string[]): CountSummary | null {
  const value = readAt(root, keys);
  const record = optionalRecord(value);
  if (!record) return null;
  const suppressed = typeof record.suppressed === "boolean" ? record.suppressed : false;
  const countValue = typeof record.value === "number" && Number.isFinite(record.value) ? record.value : null;
  return { suppressed, value: countValue };
}

function readAt(root: unknown, keys: string[]): unknown {
  let current = root;
  for (const key of keys) {
    const record = optionalRecord(current);
    if (!record) return null;
    current = record[key];
  }
  return current;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function countBand(count: number): string {
  if (count <= 0) return "0";
  if (count < 10) return "1-9";
  if (count < 100) return "10-99";
  if (count < 1000) return "100-999";
  return "1000+";
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

function findR1037SpecificFindings(output: R1037NhanesExistingAggregateResultsPacketOutput): string[] {
  const findings: string[] = [];
  if (output.summary.productDisplayAuthorized !== false) {
    findings.push("summary.productDisplayAuthorized must remain false");
  }
  if (output.summary.productPromotionAuthorized !== false) {
    findings.push("summary.productPromotionAuthorized must remain false");
  }
  if (output.summary.rowValuesStored !== false) {
    findings.push("summary.rowValuesStored must remain false");
  }
  if (output.existingResults.r850HipActivity.stability.brierImprovedFraction === null) {
    findings.push("R1037 requires R852 activity stability bootstrap support");
  }
  return findings;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR1037NhanesExistingAggregateResultsPacket({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r849Path: process.env.MURPH_AGE_R849_NHANES_LAB_FIRST_PATH,
    r850Path: process.env.MURPH_AGE_R850_NHANES_HIP_ACTIVITY_PATH,
    r852Path: process.env.MURPH_AGE_R852_ACTIVITY_STABILITY_PATH,
  }).then(({ output }) => {
    process.stdout.write(`${JSON.stringify({
      conclusion: output.summary.conclusion,
      packetId: output.packetId,
      productDisplayAuthorized: output.summary.productDisplayAuthorized,
      recommendedGate: output.summary.recommendedGate,
      schemaVersion: output.schemaVersion,
      status: output.status,
    }, null, 2)}\n`);
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
