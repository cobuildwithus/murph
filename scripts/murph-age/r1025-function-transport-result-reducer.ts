import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1025_FUNCTION_TRANSPORT_RESULT_REDUCER_SCHEMA_VERSION =
  "murph-age-r1025-function-transport-result-reducer.v1" as const;

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
const OUTPUT_FILE_NAME = "r1025-function-transport-result-reducer.latest.json";

type ArtifactStatus = "available" | "missing";
type Decision =
  | "blocked_missing_fresh_aggregate"
  | "discard_to_negative_memory"
  | "keep_research_candidate"
  | "send_reviewgpt_aggregate_delta";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: ArtifactStatus;
}

export interface R1025FunctionTransportResultReducerOptions {
  aggregatePacketPath?: string;
  createdAt?: string;
  manifestPath?: string;
  outputDir?: string;
}

export interface R1025FunctionTransportResultReducerOutput {
  aggregateEvidence: {
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
    verdict: string | null;
  };
  artifactBoundary: {
    aggregateOnly: true;
    codebookProseStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1025: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceProseStored: false;
    splitMembershipStored: false;
    variableLabelsStored: false;
    variableNamesStored: false;
  };
  createdAt: string;
  decision: {
    action: Decision;
    allowedEffect: "candidate_memory_only";
    nextLocalAction:
      | "await_fresh_private_aggregate_packet"
      | "continue_next_locked_source_test"
      | "record_negative_result_and_hold_family"
      | "send_fresh_aggregate_delta_to_reviewgpt";
    productDisplayAuthorized: false;
    rationaleLabels: string[];
    reviewGptRequired: boolean;
  };
  inputArtifacts: {
    aggregatePacket: ArtifactSummary;
    manifest: ArtifactSummary;
  };
  packetId: "r1025-function-transport-result-reducer";
  schemaVersion: typeof R1025_FUNCTION_TRANSPORT_RESULT_REDUCER_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "fresh_function_transport_result_missing"
      | "function_transport_candidate_discarded"
      | "function_transport_candidate_kept_research_only"
      | "function_transport_result_needs_reviewgpt";
    productDisplayAuthorized: false;
    reviewGptNextUse: "fresh_aggregate_delta_or_architecture_fork_only";
    rowParsingPerformedByR1025: false;
  };
}

export async function runR1025FunctionTransportResultReducer(
  options: R1025FunctionTransportResultReducerOptions = {},
): Promise<{ output: R1025FunctionTransportResultReducerOutput; outputPath: string }> {
  const manifest = await readJsonIfPresent(
    options.manifestPath ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1023-function-transport-candidate-manifest.latest.json"),
  );
  const aggregatePacket = await readJsonIfPresent(options.aggregatePacketPath ?? DEFAULT_AGGREGATE_PACKET_PATH);
  validateInputBoundary("manifest", manifest);
  validateInputBoundary("aggregatePacket", aggregatePacket);

  const aggregateEvidence = summarizeAggregateEvidence(aggregatePacket);
  const rationaleLabels = buildRationaleLabels(aggregateEvidence, aggregatePacket);
  const decision = decide(aggregateEvidence, aggregatePacket);
  const output: R1025FunctionTransportResultReducerOutput = {
    aggregateEvidence,
    artifactBoundary: {
      aggregateOnly: true,
      codebookProseStored: false,
      codebookTextStored: false,
      coefficientsStored: false,
      localFileNamesStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR1025: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceProseStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableNamesStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    decision: {
      action: decision,
      allowedEffect: "candidate_memory_only",
      nextLocalAction: nextLocalActionFor(decision),
      productDisplayAuthorized: false,
      rationaleLabels,
      reviewGptRequired: decision === "send_reviewgpt_aggregate_delta",
    },
    inputArtifacts: {
      aggregatePacket: summarizeArtifact("aggregatePacket", aggregatePacket),
      manifest: summarizeArtifact("manifest", manifest),
    },
    packetId: "r1025-function-transport-result-reducer",
    schemaVersion: R1025_FUNCTION_TRANSPORT_RESULT_REDUCER_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: conclusionFor(decision),
      productDisplayAuthorized: false,
      reviewGptNextUse: "fresh_aggregate_delta_or_architecture_fork_only",
      rowParsingPerformedByR1025: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1025 function-transport reducer failed aggregate-egress validation: ${findings.join("; ")}`);
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
    throw new Error(`R1025 ${label} failed aggregate boundary validation: ${findings.join("; ")}`);
  }
}

function summarizeAggregateEvidence(
  aggregatePacket: unknown | null,
): R1025FunctionTransportResultReducerOutput["aggregateEvidence"] {
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
      verdict: null,
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
    verdict: readStringAt(aggregatePacket, ["decision_inputs", "aggregate_verdict"]),
  };
}

function decide(
  evidence: R1025FunctionTransportResultReducerOutput["aggregateEvidence"],
  aggregatePacket: unknown | null,
): Decision {
  if (!evidence.freshAggregateAvailable) return "blocked_missing_fresh_aggregate";
  const highLevelFork =
    evidence.meaningfulAggregateDelta === true
    || evidence.cognitionDominatesFunction === true
    || readBooleanAt(aggregatePacket, ["decision_inputs", "contradicts_prior_function_evidence"]) === true;
  if (highLevelFork) return "send_reviewgpt_aggregate_delta";
  const keep =
    evidence.denominatorValid === true
    && evidence.functionProperScoresImprove === true
    && evidence.calibrationNonWorse === true
    && evidence.functionBeatsShuffledControl === true
    && evidence.functionBeatsMissingnessControl === true
    && evidence.abstentionAcceptable === true
    && evidence.suppressionPassed === true;
  return keep ? "keep_research_candidate" : "discard_to_negative_memory";
}

function buildRationaleLabels(
  evidence: R1025FunctionTransportResultReducerOutput["aggregateEvidence"],
  aggregatePacket: unknown | null,
): string[] {
  if (!evidence.freshAggregateAvailable) return ["fresh_aggregate_packet_missing"];
  const labels = [
    evidence.denominatorValid === true ? "same_denominator_valid" : "same_denominator_invalid_or_unknown",
    evidence.functionProperScoresImprove === true ? "proper_scores_improve" : "proper_scores_not_confirmed",
    evidence.calibrationNonWorse === true ? "calibration_non_worse" : "calibration_worse_or_unknown",
    evidence.functionBeatsShuffledControl === true ? "shuffled_control_beaten" : "shuffled_control_not_beaten",
    evidence.functionBeatsMissingnessControl === true
      ? "missingness_control_beaten"
      : "missingness_control_not_beaten",
    evidence.abstentionAcceptable === true ? "abstention_acceptable" : "abstention_not_acceptable_or_unknown",
    evidence.suppressionPassed === true ? "suppression_passed" : "suppression_failed_or_unknown",
  ];
  if (evidence.meaningfulAggregateDelta === true) labels.push("meaningful_aggregate_delta");
  if (evidence.cognitionDominatesFunction === true) labels.push("cognition_dominates_function");
  if (readBooleanAt(aggregatePacket, ["decision_inputs", "contradicts_prior_function_evidence"]) === true) {
    labels.push("contradicts_prior_function_evidence");
  }
  return labels;
}

function nextLocalActionFor(decision: Decision): R1025FunctionTransportResultReducerOutput["decision"]["nextLocalAction"] {
  if (decision === "blocked_missing_fresh_aggregate") return "await_fresh_private_aggregate_packet";
  if (decision === "discard_to_negative_memory") return "record_negative_result_and_hold_family";
  if (decision === "keep_research_candidate") return "continue_next_locked_source_test";
  return "send_fresh_aggregate_delta_to_reviewgpt";
}

function conclusionFor(decision: Decision): R1025FunctionTransportResultReducerOutput["summary"]["conclusion"] {
  if (decision === "blocked_missing_fresh_aggregate") return "fresh_function_transport_result_missing";
  if (decision === "discard_to_negative_memory") return "function_transport_candidate_discarded";
  if (decision === "keep_research_candidate") return "function_transport_candidate_kept_research_only";
  return "function_transport_result_needs_reviewgpt";
}

function summarizeArtifact(artifact: string, value: unknown | null): ArtifactSummary {
  return {
    artifact,
    packetId: readStringAt(value, ["packetId"]),
    schemaVersion: readStringAt(value, ["schemaVersion"]),
    status: value === null ? "missing" : "available",
  };
}

function readBooleanAt(value: unknown, pathParts: string[]): boolean | null {
  let current: unknown = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "boolean" ? current : null;
}

function readStringAt(value: unknown, pathParts: string[]): string | null {
  let current: unknown = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" && current.length > 0 ? current : null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR1025FunctionTransportResultReducer({
    aggregatePacketPath: process.env.MURPH_AGE_R1025_FUNCTION_TRANSPORT_AGGREGATE_PACKET_PATH,
    manifestPath: process.env.MURPH_AGE_R1023_FUNCTION_TRANSPORT_MANIFEST_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  }).then(({ output }) => {
    process.stdout.write(`${JSON.stringify({
      conclusion: output.summary.conclusion,
      decision: output.decision.action,
      nextLocalAction: output.decision.nextLocalAction,
      packetId: output.packetId,
      productDisplayAuthorized: output.summary.productDisplayAuthorized,
      reviewGptRequired: output.decision.reviewGptRequired,
      rowParsingPerformedByR1025: output.summary.rowParsingPerformedByR1025,
      schemaVersion: output.schemaVersion,
      status: output.status,
    }, null, 2)}\n`);
  }).catch((error: unknown) => {
    process.stdout.write(`${JSON.stringify({
      error: error instanceof Error ? error.message : "unknown R1025 failure",
      packetId: "r1025-function-transport-result-reducer",
      productDisplayAuthorized: false,
      rowParsingPerformedByR1025: false,
      status: "blocked",
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
