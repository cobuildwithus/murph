import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1049_NHANES_ACTIVITY_CONTROL_DIAGNOSTIC_SCHEMA_VERSION =
  "murph-age-r1049-nhanes-activity-control-diagnostic.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_R1038_LOOP_PATH = path.join(
  DEFAULT_MODEL_RUNS_DIR,
  "r1038-nhanes-modern-lab-activity-loop.latest.json",
);
const DEFAULT_R1038_CALIBRATED_RECEIPT_PATH = path.join(
  DEFAULT_MODEL_RUNS_DIR,
  "r1038-nhanes-modern-lab-activity-calibrated-receipt.latest.json",
);
const DEFAULT_R1034_REDUCER_PATH = path.join(
  DEFAULT_MODEL_RUNS_DIR,
  "r1034-labs-wearables-aggregate-reducer.latest.json",
);
const OUTPUT_FILE_NAME = "r1049-nhanes-activity-control-diagnostic.latest.json";

const ALLOWED_PACKET_IDS = {
  r1034: "r1034-labs-wearables-aggregate-reducer",
  r1038Calibrated: "r1038-nhanes-modern-lab-activity-calibrated-receipt",
  r1038Loop: "r1038-nhanes-modern-lab-activity-loop",
} as const;

const ALLOWED_SCHEMA_VERSIONS = {
  r1034: "murph-age-r1034-labs-wearables-aggregate-reducer.v1",
  r1038Calibrated: "murph-age-r1038-nhanes-modern-lab-activity-calibrated-receipt.v1",
  r1038Loop: "murph-age-r1038-nhanes-modern-lab-activity-loop.v1",
} as const;

const C3_LAB_PRIMARY = "C3_lab9_hba1c_bp_body_primary" as const;
const C8_ACTIVITY_PRIMARY = "C8_lab9_hba1c_bp_body_activity_primary" as const;
const ALLOWED_MODEL_IDS = new Set([
  "R0_age_sex_reference",
  "R1_age_sex_bp_body_reference",
  "C1_lab5_hba1c_bp_body",
  "C2_lab5_glucose_bp_body",
  C3_LAB_PRIMARY,
  "C4_lab9_glucose_bp_body_sensitivity",
  "C5_lab10_both_glycemia_bp_body_sensitivity",
  "C6_age_sex_activity_primitives",
  "C7_lab5_hba1c_bp_body_activity",
  C8_ACTIVITY_PRIMARY,
  "N1_coverage_quality_only_negative_control",
  "N2_shuffled_activity_negative_control",
  "N3_cycle_context_only_negative_control",
  "N1_lab9_hba1c_bp_body_coverage_only",
  "N2_lab9_hba1c_bp_body_shuffled_activity",
  "N3_lab9_hba1c_bp_body_cycle_context_only",
]);

type ReceiptStatus = "available" | "missing";
type ProperScoreStatus = "improved" | "not_improved" | "missing";
type NegativeControlStatus = "beaten" | "competed" | "missing";
type CalibrationBlocker =
  | "acceptable"
  | "activity_specific_calibration_failure"
  | "global_e_over_o_underprediction"
  | "missing";

export interface R1049NhanesActivityControlDiagnosticOptions {
  createdAt?: string;
  outputDir?: string;
  r1034ReducerPath?: string;
  r1038CalibratedReceiptPath?: string;
  r1038LoopPath?: string;
}

interface InputArtifactSummary {
  artifact:
    | "r1034-labs-wearables-aggregate-reducer.latest.json"
    | "r1038-nhanes-modern-lab-activity-calibrated-receipt.latest.json"
    | "r1038-nhanes-modern-lab-activity-loop.latest.json";
  packetId: string | null;
  schemaVersion: string | null;
  status: ReceiptStatus;
}

interface DeltaSummary {
  aucDelta: number | null;
  brierDelta: number | null;
  candidateId: string;
  comparatorId: string;
  logLossDelta: number | null;
  properScoreStatus: ProperScoreStatus;
}

interface NegativeControlSummary {
  activityBeatsAllControls: boolean | null;
  brierMarginVsBestControl: number | null;
  controls: Record<"coverageOnly" | "cycleContextOnly" | "shuffledActivity", DeltaSummary | null>;
  logLossMarginVsBestControl: number | null;
  status: NegativeControlStatus;
}

interface CalibrationProfile {
  allEOverOBelowAcceptable: boolean | null;
  eOverOMax: number | null;
  eOverOMin: number | null;
  metricCount: number;
  slopeAcceptableCount: number;
}

export interface R1049NhanesActivityControlDiagnosticOutput {
  activityIncrement: {
    calibratedComparison: DeltaSummary | null;
    embeddedReducerMetric: DeltaSummary | null;
    properScoreStatusAcrossReceipts: "stable_improvement" | "mixed_or_missing" | "not_improved";
  };
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1049: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1049: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  calibrationDiagnostic: {
    blocker: CalibrationBlocker;
    calibratedReceipt: CalibrationProfile;
    embeddedReducerReceipt: CalibrationProfile;
    interpretation: string;
  };
  createdAt: string;
  decision: {
    conclusion:
      | "nhanes_activity_receipt_missing"
      | "nhanes_activity_signal_control_clean_calibration_acceptable"
      | "nhanes_activity_signal_control_clean_global_calibration_limited"
      | "nhanes_activity_signal_control_competed"
      | "nhanes_activity_signal_not_supported";
    nextAction:
      | "carry_c8_as_shadow_activity_evidence_seek_external_wearable_validation"
      | "keep_c3_lab_body_bp_primary_and_continue_external_lab_transport"
      | "prepare_high_level_reviewgpt_packet_after_new_external_or_partner_result"
      | "rerun_or_repair_nhanes_activity_receipt";
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    rationale: string;
    reviewGptRequiredBeforeNextLocalRun: false;
  };
  inputArtifacts: {
    r1034Reducer: InputArtifactSummary;
    r1038CalibratedReceipt: InputArtifactSummary;
    r1038Loop: InputArtifactSummary;
  };
  negativeControlDiagnostic: NegativeControlSummary;
  packetId: "r1049-nhanes-activity-control-diagnostic";
  schemaVersion: typeof R1049_NHANES_ACTIVITY_CONTROL_DIAGNOSTIC_SCHEMA_VERSION;
  shadowCarryForward: {
    clinicalCandidate: typeof C3_LAB_PRIMARY;
    activityCandidate: typeof C8_ACTIVITY_PRIMARY | null;
    scoreBearingPromotionAuthorized: false;
  };
  status: "research-local-aggregate-only";
}

export async function runR1049NhanesActivityControlDiagnostic(
  options: R1049NhanesActivityControlDiagnosticOptions = {},
): Promise<{ output: R1049NhanesActivityControlDiagnosticOutput; outputPath: string }> {
  const r1038Loop = await readJsonIfPresent(options.r1038LoopPath ?? DEFAULT_R1038_LOOP_PATH);
  const r1038CalibratedReceipt = await readJsonIfPresent(
    options.r1038CalibratedReceiptPath ?? DEFAULT_R1038_CALIBRATED_RECEIPT_PATH,
  );
  const r1034Reducer = await readJsonIfPresent(options.r1034ReducerPath ?? DEFAULT_R1034_REDUCER_PATH);

  validateInputIfPresent("R1038 loop", r1038Loop);
  validateInputIfPresent("R1038 calibrated receipt", r1038CalibratedReceipt);
  validateInputIfPresent("R1034 reducer", r1034Reducer);

  const embeddedActivityMetric = readEmbeddedActivityMetric(r1038Loop);
  const calibratedActivityMetric = readCalibratedActivityComparison(r1038CalibratedReceipt);
  const negativeControlDiagnostic = summarizeNegativeControls(r1038CalibratedReceipt, calibratedActivityMetric);
  const embeddedCalibration = summarizeEmbeddedCalibration(r1038Loop);
  const calibratedCalibration = summarizeCalibratedReceiptCalibration(r1038CalibratedReceipt);
  const calibrationBlocker = decideCalibrationBlocker(
    embeddedActivityMetric,
    calibratedActivityMetric,
    embeddedCalibration,
    calibratedCalibration,
  );
  const activityStatus = properScoreStatusAcrossReceipts(embeddedActivityMetric, calibratedActivityMetric);
  const decision = summarizeDecision(activityStatus, negativeControlDiagnostic.status, calibrationBlocker);

  const output: R1049NhanesActivityControlDiagnosticOutput = {
    activityIncrement: {
      calibratedComparison: calibratedActivityMetric,
      embeddedReducerMetric: embeddedActivityMetric,
      properScoreStatusAcrossReceipts: activityStatus,
    },
    artifactBoundary: {
      aggregateOnly: true,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      outcomeScoringPerformedByR1049: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR1049: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
    },
    calibrationDiagnostic: {
      blocker: calibrationBlocker,
      calibratedReceipt: calibratedCalibration,
      embeddedReducerReceipt: embeddedCalibration,
      interpretation: interpretationForCalibration(calibrationBlocker),
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    decision,
    inputArtifacts: {
      r1034Reducer: summarizeInputArtifact(
        r1034Reducer,
        "r1034-labs-wearables-aggregate-reducer.latest.json",
        ALLOWED_PACKET_IDS.r1034,
        ALLOWED_SCHEMA_VERSIONS.r1034,
      ),
      r1038CalibratedReceipt: summarizeInputArtifact(
        r1038CalibratedReceipt,
        "r1038-nhanes-modern-lab-activity-calibrated-receipt.latest.json",
        ALLOWED_PACKET_IDS.r1038Calibrated,
        ALLOWED_SCHEMA_VERSIONS.r1038Calibrated,
      ),
      r1038Loop: summarizeInputArtifact(
        r1038Loop,
        "r1038-nhanes-modern-lab-activity-loop.latest.json",
        ALLOWED_PACKET_IDS.r1038Loop,
        ALLOWED_SCHEMA_VERSIONS.r1038Loop,
      ),
    },
    negativeControlDiagnostic,
    packetId: "r1049-nhanes-activity-control-diagnostic",
    schemaVersion: R1049_NHANES_ACTIVITY_CONTROL_DIAGNOSTIC_SCHEMA_VERSION,
    shadowCarryForward: {
      clinicalCandidate: C3_LAB_PRIMARY,
      activityCandidate: decision.conclusion === "nhanes_activity_signal_not_supported"
          || decision.conclusion === "nhanes_activity_receipt_missing"
          || decision.conclusion === "nhanes_activity_signal_control_competed"
        ? null
        : C8_ACTIVITY_PRIMARY,
      scoreBearingPromotionAuthorized: false,
    },
    status: "research-local-aggregate-only",
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1049 NHANES activity control diagnostic failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function validateInputIfPresent(label: string, value: unknown | null): void {
  if (value === null) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1049 input ${label} failed aggregate boundary validation: ${findings.join("; ")}`);
  }
}

function summarizeInputArtifact(
  value: unknown | null,
  artifact: InputArtifactSummary["artifact"],
  allowedPacketId: string,
  allowedSchemaVersion: string,
): InputArtifactSummary {
  if (value === null) {
    return {
      artifact,
      packetId: null,
      schemaVersion: null,
      status: "missing",
    };
  }
  const packetId = readStringAt(value, ["packetId"]);
  const schemaVersion = readStringAt(value, ["schemaVersion"]);
  return {
    artifact,
    packetId: packetId === allowedPacketId ? packetId : null,
    schemaVersion: schemaVersion === allowedSchemaVersion ? schemaVersion : null,
    status: "available",
  };
}

function readEmbeddedActivityMetric(value: unknown | null): DeltaSummary | null {
  const metrics = readArrayAt(value, ["r1034CompatibleReceipt", "candidateMetrics"]);
  const metric = metrics.find((row) => readStringAt(row, ["candidateId"]) === C8_ACTIVITY_PRIMARY);
  if (!metric || readStringAt(metric, ["comparatorId"]) !== C3_LAB_PRIMARY) return null;
  return summarizeDelta(metric, C8_ACTIVITY_PRIMARY, C3_LAB_PRIMARY, {
    auc: ["aucDelta"],
    brier: ["brierDelta"],
    logLoss: ["logLossDelta"],
  });
}

function readCalibratedActivityComparison(value: unknown | null): DeltaSummary | null {
  return summarizeAllowedComparison(
    readRecordAt(value, ["comparisons", "C8_vs_C3"]),
    C8_ACTIVITY_PRIMARY,
    C3_LAB_PRIMARY,
  );
}

function summarizeAllowedComparison(
  value: unknown,
  candidateId: string,
  comparatorId: string,
): DeltaSummary | null {
  if (readStringAt(value, ["candidate"]) !== candidateId || readStringAt(value, ["baseline"]) !== comparatorId) {
    return null;
  }
  return summarizeDelta(value, candidateId, comparatorId, {
    auc: ["auc_delta"],
    brier: ["brier_weighted_delta"],
    logLoss: ["log_loss_weighted_delta"],
  });
}

function summarizeDelta(
  value: unknown,
  candidateId: string,
  comparatorId: string,
  keys: { auc: string[]; brier: string[]; logLoss: string[] },
): DeltaSummary {
  const brierDelta = roundMetric(readNumberAt(value, keys.brier));
  const logLossDelta = roundMetric(readNumberAt(value, keys.logLoss));
  return {
    aucDelta: roundMetric(readNumberAt(value, keys.auc)),
    brierDelta,
    candidateId,
    comparatorId,
    logLossDelta,
    properScoreStatus: properScoresImproved(brierDelta, logLossDelta) ? "improved" : "not_improved",
  };
}

function summarizeNegativeControls(
  value: unknown | null,
  activity: DeltaSummary | null,
): NegativeControlSummary {
  const controls = {
    coverageOnly: summarizeAllowedComparison(
      readRecordAt(value, ["comparisons", "N1_vs_C3"]),
      "N1_lab9_hba1c_bp_body_coverage_only",
      C3_LAB_PRIMARY,
    ),
    cycleContextOnly: summarizeAllowedComparison(
      readRecordAt(value, ["comparisons", "N3_vs_C3"]),
      "N3_lab9_hba1c_bp_body_cycle_context_only",
      C3_LAB_PRIMARY,
    ),
    shuffledActivity: summarizeAllowedComparison(
      readRecordAt(value, ["comparisons", "N2_vs_C3"]),
      "N2_lab9_hba1c_bp_body_shuffled_activity",
      C3_LAB_PRIMARY,
    ),
  };
  const presentControls = Object.values(controls).filter((control): control is DeltaSummary => control !== null);
  const activityBeatsAllControlsFlag = readAt(value, ["negativeControls", "C8BeatsAllThreeOnWeightedProperScores"]);
  if (!activity || presentControls.length === 0) {
    return {
      activityBeatsAllControls: typeof activityBeatsAllControlsFlag === "boolean" ? activityBeatsAllControlsFlag : null,
      brierMarginVsBestControl: null,
      controls,
      logLossMarginVsBestControl: null,
      status: "missing",
    };
  }

  const bestControlLogLoss = bestImprovement(presentControls.map((control) => control.logLossDelta));
  const bestControlBrier = bestImprovement(presentControls.map((control) => control.brierDelta));
  const logLossMargin = margin(activity.logLossDelta, bestControlLogLoss);
  const brierMargin = margin(activity.brierDelta, bestControlBrier);
  const beatsByMargins = logLossMargin !== null && brierMargin !== null && logLossMargin < 0 && brierMargin < 0;
  const beatsFlag = typeof activityBeatsAllControlsFlag === "boolean" ? activityBeatsAllControlsFlag : null;
  const status: NegativeControlStatus = beatsFlag === false || !beatsByMargins ? "competed" : "beaten";
  return {
    activityBeatsAllControls: beatsFlag ?? beatsByMargins,
    brierMarginVsBestControl: roundMetric(brierMargin),
    controls,
    logLossMarginVsBestControl: roundMetric(logLossMargin),
    status,
  };
}

function summarizeEmbeddedCalibration(value: unknown | null): CalibrationProfile {
  const metrics = readArrayAt(value, ["r1034CompatibleReceipt", "candidateMetrics"]);
  return summarizeCalibrationMetrics(metrics, {
    eOverO: ["eOverO"],
    modelId: ["candidateId"],
    slope: ["calibrationSlope"],
  });
}

function summarizeCalibratedReceiptCalibration(value: unknown | null): CalibrationProfile {
  const metrics = readArrayAt(value, ["candidateMetrics"]);
  return summarizeCalibrationMetrics(metrics, {
    eOverO: ["test_metrics", "expected_observed_ratio_weighted"],
    modelId: ["model_id"],
    slope: ["test_metrics", "calibration_slope"],
  });
}

function summarizeCalibrationMetrics(
  values: unknown[],
  keys: { eOverO: string[]; modelId: string[]; slope: string[] },
): CalibrationProfile {
  const pairs = values
    .map((value) => ({
      eOverO: readNumberAt(value, keys.eOverO),
      modelId: readStringAt(value, keys.modelId),
      slope: readNumberAt(value, keys.slope),
    }))
    .filter((row) => row.modelId !== null && ALLOWED_MODEL_IDS.has(row.modelId) && row.eOverO !== null);
  const eOverOValues = pairs.map((row) => row.eOverO).filter((value): value is number => value !== null);
  const slopeAcceptableCount = pairs.filter((row) => (
    row.slope !== null && row.slope >= 0.9 && row.slope <= 1.1
  )).length;
  return {
    allEOverOBelowAcceptable: eOverOValues.length > 0 ? eOverOValues.every((value) => value < 0.95) : null,
    eOverOMax: roundMetric(eOverOValues.length > 0 ? Math.max(...eOverOValues) : null),
    eOverOMin: roundMetric(eOverOValues.length > 0 ? Math.min(...eOverOValues) : null),
    metricCount: eOverOValues.length,
    slopeAcceptableCount,
  };
}

function decideCalibrationBlocker(
  embeddedActivity: DeltaSummary | null,
  calibratedActivity: DeltaSummary | null,
  embedded: CalibrationProfile,
  calibrated: CalibrationProfile,
): CalibrationBlocker {
  if (!embeddedActivity && !calibratedActivity) return "missing";
  const anyGlobalUnderprediction = embedded.allEOverOBelowAcceptable === true || calibrated.allEOverOBelowAcceptable === true;
  if (anyGlobalUnderprediction) return "global_e_over_o_underprediction";
  if (embedded.allEOverOBelowAcceptable === false || calibrated.allEOverOBelowAcceptable === false) {
    return "acceptable";
  }
  return "activity_specific_calibration_failure";
}

function properScoreStatusAcrossReceipts(
  embeddedActivity: DeltaSummary | null,
  calibratedActivity: DeltaSummary | null,
): R1049NhanesActivityControlDiagnosticOutput["activityIncrement"]["properScoreStatusAcrossReceipts"] {
  const statuses = [embeddedActivity?.properScoreStatus, calibratedActivity?.properScoreStatus].filter(Boolean);
  if (statuses.length === 0) return "mixed_or_missing";
  if (statuses.every((status) => status === "improved")) return "stable_improvement";
  if (statuses.every((status) => status === "not_improved")) return "not_improved";
  return "mixed_or_missing";
}

function summarizeDecision(
  activityStatus: R1049NhanesActivityControlDiagnosticOutput["activityIncrement"]["properScoreStatusAcrossReceipts"],
  controlStatus: NegativeControlStatus,
  calibrationBlocker: CalibrationBlocker,
): R1049NhanesActivityControlDiagnosticOutput["decision"] {
  if (calibrationBlocker === "missing" || activityStatus === "mixed_or_missing") {
    return {
      conclusion: "nhanes_activity_receipt_missing",
      nextAction: "rerun_or_repair_nhanes_activity_receipt",
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      rationale: "Required aggregate NHANES activity receipts are missing or incomplete.",
      reviewGptRequiredBeforeNextLocalRun: false,
    };
  }
  if (activityStatus === "not_improved") {
    return {
      conclusion: "nhanes_activity_signal_not_supported",
      nextAction: "keep_c3_lab_body_bp_primary_and_continue_external_lab_transport",
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      rationale: "Aggregate NHANES activity does not consistently improve proper scores over the lab/body/BP candidate.",
      reviewGptRequiredBeforeNextLocalRun: false,
    };
  }
  if (controlStatus !== "beaten") {
    return {
      conclusion: "nhanes_activity_signal_control_competed",
      nextAction: "keep_c3_lab_body_bp_primary_and_continue_external_lab_transport",
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      rationale: "Aggregate NHANES activity improvement is not cleanly separated from activity coverage, shuffle, or cycle controls.",
      reviewGptRequiredBeforeNextLocalRun: false,
    };
  }
  if (calibrationBlocker === "acceptable") {
    return {
      conclusion: "nhanes_activity_signal_control_clean_calibration_acceptable",
      nextAction: "prepare_high_level_reviewgpt_packet_after_new_external_or_partner_result",
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      rationale: "Aggregate NHANES activity improves proper scores, beats controls, and does not show a calibration blocker.",
      reviewGptRequiredBeforeNextLocalRun: false,
    };
  }
  return {
    conclusion: "nhanes_activity_signal_control_clean_global_calibration_limited",
    nextAction: "carry_c8_as_shadow_activity_evidence_seek_external_wearable_validation",
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    rationale: "Aggregate NHANES activity improves proper scores and beats controls, but expected/observed underprediction is shared across candidates.",
    reviewGptRequiredBeforeNextLocalRun: false,
  };
}

function interpretationForCalibration(blocker: CalibrationBlocker): string {
  if (blocker === "acceptable") return "No aggregate calibration blocker was detected by R1049.";
  if (blocker === "global_e_over_o_underprediction") {
    return "The hold appears to be global expected/observed underprediction shared across candidates, not an activity-specific failure.";
  }
  if (blocker === "activity_specific_calibration_failure") {
    return "The hold may be activity-specific calibration failure, but aggregate evidence is incomplete.";
  }
  return "Calibration blocker could not be assessed from available aggregate receipts.";
}

function properScoresImproved(brierDelta: number | null, logLossDelta: number | null): boolean {
  return brierDelta !== null && brierDelta < 0 && logLossDelta !== null && logLossDelta < 0;
}

function bestImprovement(values: Array<number | null>): number | null {
  const numeric = values.filter((value): value is number => value !== null);
  return numeric.length > 0 ? Math.min(...numeric) : null;
}

function margin(activityDelta: number | null, bestControlDelta: number | null): number | null {
  if (activityDelta === null || bestControlDelta === null) return null;
  return activityDelta - bestControlDelta;
}

function roundMetric(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(8)) : null;
}

function readArrayAt(value: unknown | null, keys: string[]): unknown[] {
  const found = readAt(value, keys);
  return Array.isArray(found) ? found : [];
}

function readRecordAt(value: unknown | null, keys: string[]): Record<string, unknown> {
  const found = readAt(value, keys);
  return found && typeof found === "object" && !Array.isArray(found) ? found as Record<string, unknown> : {};
}

function readNumberAt(value: unknown | null, keys: string[]): number | null {
  const found = readAt(value, keys);
  return typeof found === "number" && Number.isFinite(found) ? found : null;
}

function readStringAt(value: unknown | null, keys: string[]): string | null {
  const found = readAt(value, keys);
  return typeof found === "string" && found.length > 0 ? found : null;
}

function readAt(value: unknown | null, keys: string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

async function main(): Promise<void> {
  const { output } = await runR1049NhanesActivityControlDiagnostic({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1034ReducerPath: process.env.MURPH_AGE_R1034_REDUCER_PATH,
    r1038CalibratedReceiptPath: process.env.MURPH_AGE_R1038_CALIBRATED_RECEIPT_PATH,
    r1038LoopPath: process.env.MURPH_AGE_R1038_LOOP_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    artifact: OUTPUT_FILE_NAME,
    activityStatus: output.activityIncrement.properScoreStatusAcrossReceipts,
    calibrationBlocker: output.calibrationDiagnostic.blocker,
    conclusion: output.decision.conclusion,
    negativeControlStatus: output.negativeControlDiagnostic.status,
    nextAction: output.decision.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.decision.productDisplayAuthorized,
    reviewGptRequiredBeforeNextLocalRun: output.decision.reviewGptRequiredBeforeNextLocalRun,
    schemaVersion: output.schemaVersion,
    shadowActivityCandidate: output.shadowCarryForward.activityCandidate,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {
    process.stderr.write("R1049 NHANES activity control diagnostic failed.\n");
    process.exitCode = 1;
  });
}
