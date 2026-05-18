import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1083_FUNCTION_MISSINGNESS_CALIBRATION_ADJUDICATION_SCHEMA_VERSION =
  "murph-age-r1083-function-missingness-calibration-adjudication.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_AGGREGATE_PACKET_PATH = path.join(
  DEFAULT_MODEL_RUNS_DIR,
  "r1025-function-transport-aggregate-packet.latest.json",
);
const DEFAULT_REDUCER_PATH = path.join(
  DEFAULT_MODEL_RUNS_DIR,
  "r1025-function-transport-result-reducer.latest.json",
);
const OUTPUT_FILE_NAME = "r1083-function-missingness-calibration-adjudication.latest.json";

type AdjudicationDecision =
  | "blocked_missing_or_invalid_aggregate"
  | "hold_or_demote_function_sidecar"
  | "keep_lead_and_seek_fresh_source"
  | "run_function_missingness_calibration_adjudication";
type ComparisonId =
  | "frozen_anchor_only"
  | "anchor_plus_function_missingness_only_control"
  | "anchor_plus_shuffled_function_control"
  | "anchor_plus_function_content_sidecar"
  | "anchor_plus_function_content_missingness_adjudicated"
  | "anchor_plus_function_plus_cognition_shadow"
  | "compact_labs_glycemia_shadow_optional";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface MetricDeltaSummary {
  aucDelta: number | null;
  brierDelta: number | null;
  logLossDelta: number | null;
}

export interface R1083FunctionMissingnessCalibrationAdjudicationOptions {
  aggregatePacketPath?: string;
  createdAt?: string;
  outputDir?: string;
  reducerPath?: string;
}

export interface R1083FunctionMissingnessCalibrationAdjudicationOutput {
  adjudicationEvidence: {
    abstentionAcceptable: boolean | null;
    calibrationNonWorse: boolean | null;
    cognitionDominatesFunction: boolean | null;
    denominatorValid: boolean | null;
    freshAggregateAvailable: boolean;
    functionBeatsMissingnessControl: boolean | null;
    functionBeatsShuffledControl: boolean | null;
    functionProperScoresImprove: boolean | null;
    meaningfulAggregateDelta: boolean | null;
    suppressionPassed: boolean | null;
  };
  artifactBoundary: {
    aggregateOnly: true;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1083: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1083: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  decision: {
    action: AdjudicationDecision;
    allowedEffect: "research_candidate_memory_only";
    blockerLabels: string[];
    nextLocalAction:
      | "await_valid_function_transport_aggregate"
      | "hold_function_family_and_redirect_next_source"
      | "run_ordered_function_missingness_calibration_loop"
      | "seek_fresh_function_source_or_true_wearable_validation";
    productDisplayAuthorized: false;
    reviewGptRequiredNow: false;
  };
  inputArtifacts: {
    aggregatePacket: ArtifactSummary;
    r1025Reducer: ArtifactSummary;
  };
  metricDeltas: {
    functionVsAnchor: MetricDeltaSummary;
    functionVsMissingnessControl: MetricDeltaSummary;
    functionVsShuffledControl: MetricDeltaSummary;
  };
  nextLoop: {
    comparisonOrder: ComparisonId[];
    loopQuestion: "does_function_content_add_calibrated_outcome_signal_beyond_missingness_process_structure";
    mustPassLabels: string[];
    reviewGptRole: "review_interesting_science_deltas_only";
  };
  packetId: "r1083-function-missingness-calibration-adjudication";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1083_FUNCTION_MISSINGNESS_CALIBRATION_ADJUDICATION_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "function_adjudication_blocked_missing_aggregate"
      | "function_content_adjudication_needed"
      | "function_lead_kept_research_only"
      | "function_sidecar_held_or_demoted";
    productDisplayAuthorized: false;
    rowParsingPerformedByR1083: false;
  };
}

export async function runR1083FunctionMissingnessCalibrationAdjudication(
  options: R1083FunctionMissingnessCalibrationAdjudicationOptions = {},
): Promise<{ output: R1083FunctionMissingnessCalibrationAdjudicationOutput; outputPath: string }> {
  const aggregatePacket = await readJsonIfPresent(options.aggregatePacketPath ?? DEFAULT_AGGREGATE_PACKET_PATH);
  const reducer = await readJsonIfPresent(options.reducerPath ?? DEFAULT_REDUCER_PATH);
  validateInputBoundary("aggregatePacket", aggregatePacket);
  validateInputBoundary("r1025Reducer", reducer);

  const adjudicationEvidence = summarizeEvidence(aggregatePacket);
  const decision = decide(adjudicationEvidence);
  const output: R1083FunctionMissingnessCalibrationAdjudicationOutput = {
    adjudicationEvidence,
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    decision: {
      action: decision,
      allowedEffect: "research_candidate_memory_only",
      blockerLabels: blockerLabelsFor(adjudicationEvidence),
      nextLocalAction: nextLocalActionFor(decision),
      productDisplayAuthorized: false,
      reviewGptRequiredNow: false,
    },
    inputArtifacts: {
      aggregatePacket: summarizeArtifact("aggregatePacket", aggregatePacket),
      r1025Reducer: summarizeArtifact("r1025Reducer", reducer),
    },
    metricDeltas: summarizeMetricDeltas(aggregatePacket),
    nextLoop: {
      comparisonOrder: [
        "frozen_anchor_only",
        "anchor_plus_function_missingness_only_control",
        "anchor_plus_shuffled_function_control",
        "anchor_plus_function_content_sidecar",
        "anchor_plus_function_content_missingness_adjudicated",
        "anchor_plus_function_plus_cognition_shadow",
        "compact_labs_glycemia_shadow_optional",
      ],
      loopQuestion: "does_function_content_add_calibrated_outcome_signal_beyond_missingness_process_structure",
      mustPassLabels: [
        "function_beats_anchor_on_auc_and_proper_score",
        "function_beats_shuffled_control",
        "function_beats_missingness_control",
        "calibration_non_worse",
        "same_denominator_and_function_complete_survival",
        "abstention_band_not_dominant",
        "cognition_does_not_dominate_function",
        "aggregate_boundary_clean",
      ],
      reviewGptRole: "review_interesting_science_deltas_only",
    },
    packetId: "r1083-function-missingness-calibration-adjudication",
    productDisplayAuthorized: false,
    schemaVersion: R1083_FUNCTION_MISSINGNESS_CALIBRATION_ADJUDICATION_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: conclusionFor(decision),
      productDisplayAuthorized: false,
      rowParsingPerformedByR1083: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1083 function adjudication output failed aggregate-egress validation: ${findings.join("; ")}`);
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

function validateInputBoundary(label: string, value: unknown | null): void {
  if (value === null) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1083 ${label} failed aggregate boundary validation: ${findings.join("; ")}`);
  }
}

function summarizeEvidence(
  aggregatePacket: unknown | null,
): R1083FunctionMissingnessCalibrationAdjudicationOutput["adjudicationEvidence"] {
  if (aggregatePacket === null) {
    return {
      abstentionAcceptable: null,
      calibrationNonWorse: null,
      cognitionDominatesFunction: null,
      denominatorValid: null,
      freshAggregateAvailable: false,
      functionBeatsMissingnessControl: null,
      functionBeatsShuffledControl: null,
      functionProperScoresImprove: null,
      meaningfulAggregateDelta: null,
      suppressionPassed: null,
    };
  }
  return {
    abstentionAcceptable: readBooleanAt(aggregatePacket, ["decision_inputs", "abstention_acceptable"]),
    calibrationNonWorse: readBooleanAt(aggregatePacket, ["decision_inputs", "calibration_non_worse"]),
    cognitionDominatesFunction: readBooleanAt(aggregatePacket, ["decision_inputs", "cognition_dominates_function"]),
    denominatorValid: readBooleanAt(aggregatePacket, ["decision_inputs", "same_denominator_valid"]),
    freshAggregateAvailable: true,
    functionBeatsMissingnessControl: readBooleanAt(aggregatePacket, [
      "decision_inputs",
      "function_beats_missingness_control",
    ]),
    functionBeatsShuffledControl: readBooleanAt(aggregatePacket, [
      "decision_inputs",
      "function_beats_shuffled_control",
    ]),
    functionProperScoresImprove: readBooleanAt(aggregatePacket, ["decision_inputs", "proper_scores_improve"]),
    meaningfulAggregateDelta: readBooleanAt(aggregatePacket, ["decision_inputs", "meaningful_aggregate_delta"]),
    suppressionPassed: readBooleanAt(aggregatePacket, ["decision_inputs", "suppression_passed"]),
  };
}

function decide(
  evidence: R1083FunctionMissingnessCalibrationAdjudicationOutput["adjudicationEvidence"],
): AdjudicationDecision {
  if (!evidence.freshAggregateAvailable) return "blocked_missing_or_invalid_aggregate";
  const coreSupport =
    evidence.denominatorValid === true
    && evidence.suppressionPassed === true
    && evidence.functionProperScoresImprove === true
    && evidence.functionBeatsShuffledControl === true
    && evidence.meaningfulAggregateDelta === true
    && evidence.cognitionDominatesFunction !== true;
  if (!coreSupport) return "hold_or_demote_function_sidecar";
  if (evidence.calibrationNonWorse === true && evidence.functionBeatsMissingnessControl === true && evidence.abstentionAcceptable === true) {
    return "keep_lead_and_seek_fresh_source";
  }
  return "run_function_missingness_calibration_adjudication";
}

function blockerLabelsFor(
  evidence: R1083FunctionMissingnessCalibrationAdjudicationOutput["adjudicationEvidence"],
): string[] {
  if (!evidence.freshAggregateAvailable) return ["fresh_function_aggregate_missing"];
  const labels: string[] = [];
  if (evidence.denominatorValid !== true) labels.push("same_denominator_not_valid");
  if (evidence.suppressionPassed !== true) labels.push("suppression_not_passed");
  if (evidence.functionProperScoresImprove !== true) labels.push("proper_scores_not_confirmed");
  if (evidence.functionBeatsShuffledControl !== true) labels.push("shuffled_control_not_beaten");
  if (evidence.meaningfulAggregateDelta !== true) labels.push("meaningful_delta_not_confirmed");
  if (evidence.cognitionDominatesFunction === true) labels.push("cognition_dominates_function");
  if (evidence.calibrationNonWorse !== true) labels.push("calibration_worse_or_unknown");
  if (evidence.functionBeatsMissingnessControl !== true) labels.push("missingness_control_not_beaten");
  if (evidence.abstentionAcceptable !== true) labels.push("abstention_not_acceptable_or_unknown");
  return labels;
}

function nextLocalActionFor(
  decision: AdjudicationDecision,
): R1083FunctionMissingnessCalibrationAdjudicationOutput["decision"]["nextLocalAction"] {
  if (decision === "blocked_missing_or_invalid_aggregate") return "await_valid_function_transport_aggregate";
  if (decision === "hold_or_demote_function_sidecar") return "hold_function_family_and_redirect_next_source";
  if (decision === "keep_lead_and_seek_fresh_source") return "seek_fresh_function_source_or_true_wearable_validation";
  return "run_ordered_function_missingness_calibration_loop";
}

function conclusionFor(
  decision: AdjudicationDecision,
): R1083FunctionMissingnessCalibrationAdjudicationOutput["summary"]["conclusion"] {
  if (decision === "blocked_missing_or_invalid_aggregate") return "function_adjudication_blocked_missing_aggregate";
  if (decision === "hold_or_demote_function_sidecar") return "function_sidecar_held_or_demoted";
  if (decision === "keep_lead_and_seek_fresh_source") return "function_lead_kept_research_only";
  return "function_content_adjudication_needed";
}

function summarizeMetricDeltas(
  aggregatePacket: unknown | null,
): R1083FunctionMissingnessCalibrationAdjudicationOutput["metricDeltas"] {
  return {
    functionVsAnchor: readDelta(aggregatePacket, "anchor_plus_function_sidecar_vs_frozen_anchor"),
    functionVsMissingnessControl: readDelta(aggregatePacket, "function_sidecar_vs_missingness_only_reference"),
    functionVsShuffledControl: readDelta(aggregatePacket, "function_sidecar_vs_shuffled_function_control"),
  };
}

function readDelta(value: unknown | null, comparisonId: string): MetricDeltaSummary {
  return {
    aucDelta: readNumberAt(value, ["metric_deltas", comparisonId, "auc_delta"]),
    brierDelta: readNumberAt(value, ["metric_deltas", comparisonId, "brier_delta"]),
    logLossDelta: readNumberAt(value, ["metric_deltas", comparisonId, "log_loss_delta"]),
  };
}

function summarizeArtifact(artifact: string, value: unknown | null): ArtifactSummary {
  return {
    artifact,
    packetId: readStringAt(value, ["packetId"]),
    schemaVersion: readStringAt(value, ["schemaVersion"]),
    status: value === null ? "missing" : "available",
  };
}

function safeBoundary(): R1083FunctionMissingnessCalibrationAdjudicationOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    codebookTextStored: false,
    coefficientsStored: false,
    localFileNamesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1083: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1083: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    splitMembershipStored: false,
  };
}

function readBooleanAt(value: unknown | null, pathParts: readonly string[]): boolean | null {
  const current = readAt(value, pathParts);
  return typeof current === "boolean" ? current : null;
}

function readNumberAt(value: unknown | null, pathParts: readonly string[]): number | null {
  const current = readAt(value, pathParts);
  return typeof current === "number" && Number.isFinite(current) ? current : null;
}

function readStringAt(value: unknown | null, pathParts: readonly string[]): string | null {
  const current = readAt(value, pathParts);
  return typeof current === "string" && current.length > 0 ? current : null;
}

function readAt(value: unknown | null, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR1083FunctionMissingnessCalibrationAdjudication({
    aggregatePacketPath: process.env.MURPH_AGE_R1025_FUNCTION_TRANSPORT_AGGREGATE_PACKET_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    reducerPath: process.env.MURPH_AGE_R1025_FUNCTION_TRANSPORT_REDUCER_PATH,
  }).then(({ output }) => {
    process.stdout.write(`${JSON.stringify({
      conclusion: output.summary.conclusion,
      decision: output.decision.action,
      nextLocalAction: output.decision.nextLocalAction,
      packetId: output.packetId,
      productDisplayAuthorized: output.productDisplayAuthorized,
      reviewGptRequiredNow: output.decision.reviewGptRequiredNow,
      rowParsingPerformedByR1083: output.summary.rowParsingPerformedByR1083,
      schemaVersion: output.schemaVersion,
      status: output.status,
    }, null, 2)}\n`);
  }).catch((error: unknown) => {
    const message = error instanceof Error && !/(?:\/|\\)/u.test(error.message)
      ? error.message
      : "R1083 function adjudication failed.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
