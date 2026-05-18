import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1028_HISTORICAL_NSHAP_FUNCTION_TRANSPORT_PACKET_SCHEMA_VERSION =
  "murph-age-r1028-historical-nshap-function-transport-packet.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_LOOP_RUNS_DIR = path.join(
  "output-packages",
  "research",
  "murph-age",
  "autoresearch",
  "loop",
  "runs",
);
const DEFAULT_R770_DIR = path.join(
  DEFAULT_LOOP_RUNS_DIR,
  "session_murph_age_r770_nshap_function_cognition_external_repeat",
);
const DEFAULT_R773_DIR = path.join(
  DEFAULT_LOOP_RUNS_DIR,
  "session_murph_age_r773_nshap_single_domain_breakdown",
);
const AGGREGATE_PACKET_FILE_NAME = "r1025-function-transport-aggregate-packet.latest.json";
const STATUS_FILE_NAME = "r1028-historical-nshap-function-transport-packet.latest.json";

type ValidationStatus = "failed" | "missing" | "passed" | "unknown";

export interface R1028HistoricalNshapFunctionTransportPacketOptions {
  aggregatePacketOutputPath?: string;
  createdAt?: string;
  outputDir?: string;
  r770ResultPath?: string;
  r770ValidationPath?: string;
  r773ResultPath?: string;
  r773ValidationPath?: string;
  r997ReplayPath?: string;
}

export interface R1028HistoricalNshapFunctionTransportPacketOutput {
  aggregatePacketArtifact: string;
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
    rowParsingPerformedByR1028: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceProseStored: false;
    splitMembershipStored: false;
    variableLabelsStored: false;
    variableNamesStored: false;
  };
  createdAt: string;
  inputEvidence: {
    historicalReplayVerdict: string | null;
    r770AggregateStatus: "available" | "missing";
    r770ValidationStatus: ValidationStatus;
    r773AggregateStatus: "available" | "missing";
    r773ValidationStatus: ValidationStatus;
  };
  packetId: "r1028-historical-nshap-function-transport-packet";
  schemaVersion: typeof R1028_HISTORICAL_NSHAP_FUNCTION_TRANSPORT_PACKET_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: "historical_nshap_function_transport_packet_ready_for_review";
    productDisplayAuthorized: false;
    reviewGptNextUse: "aggregate_result_direction_only";
    rowParsingPerformedByR1028: false;
  };
}

type AggregatePacket = {
  artifactBoundary: Record<string, unknown>;
  benchmark_lock: Record<string, unknown>;
  decision_inputs: Record<string, unknown>;
  denominator_bands: Record<string, string>;
  metric_deltas: Record<string, Record<string, number | null>>;
  packetId: "r1025-function-transport-aggregate-packet";
  packetRole: "historical_nshap_aggregate_replay";
  schemaVersion: "murph-age-r1025-function-transport-aggregate-packet.v0";
  status: "research-local-aggregate-only";
};

export async function runR1028HistoricalNshapFunctionTransportPacket(
  options: R1028HistoricalNshapFunctionTransportPacketOptions = {},
): Promise<{
  aggregatePacket: AggregatePacket;
  aggregatePacketOutputPath: string;
  output: R1028HistoricalNshapFunctionTransportPacketOutput;
  outputPath: string;
}> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const inputs = {
    r770Aggregate: await readJsonIfPresent(
      options.r770ResultPath ?? path.join(DEFAULT_R770_DIR, "nshap-function-cognition-external-repeat-r770.json"),
    ),
    r770Validation: await readJsonIfPresent(
      options.r770ValidationPath
        ?? path.join(DEFAULT_R770_DIR, "nshap-function-cognition-external-repeat-validation-r770.json"),
    ),
    r773Aggregate: await readJsonIfPresent(
      options.r773ResultPath ?? path.join(DEFAULT_R773_DIR, "nshap-single-domain-breakdown-r773.json"),
    ),
    r773Validation: await readJsonIfPresent(
      options.r773ValidationPath ?? path.join(DEFAULT_R773_DIR, "nshap-single-domain-breakdown-validation-r773.json"),
    ),
    r997Replay: await readJsonIfPresent(
      options.r997ReplayPath ?? path.join(outputDir, "r997-strict-nshap-function-cognition-replay.latest.json"),
    ),
  };

  const r770ValidationStatus = validationStatus(inputs.r770Validation);
  const r773ValidationStatus = validationStatus(inputs.r773Validation);
  const historicalReplayVerdict = readStringAt(inputs.r997Replay, ["summary", "artifactVerdict"]);
  const replaySupportsDirection = historicalReplayVerdict ===
    "historical_nshap_aggregate_signal_usable_research_direction_only";
  const allInputsReady = inputs.r770Aggregate !== null
    && inputs.r773Aggregate !== null
    && r770ValidationStatus === "passed"
    && r773ValidationStatus === "passed"
    && replaySupportsDirection;
  if (!allInputsReady) {
    throw new Error("R1028 historical NSHAP aggregate receipts are not ready for function-transport packet emission.");
  }

  const aggregatePacket = buildAggregatePacket({
    r770Aggregate: inputs.r770Aggregate,
    r773Aggregate: inputs.r773Aggregate,
  });
  validateAggregateOnlyPacket(aggregatePacket);

  await mkdir(outputDir, { recursive: true });
  const aggregatePacketOutputPath = options.aggregatePacketOutputPath
    ?? path.join(outputDir, AGGREGATE_PACKET_FILE_NAME);
  await writeFile(aggregatePacketOutputPath, `${JSON.stringify(aggregatePacket, null, 2)}\n`);

  const output: R1028HistoricalNshapFunctionTransportPacketOutput = {
    aggregatePacketArtifact: AGGREGATE_PACKET_FILE_NAME,
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
      rowParsingPerformedByR1028: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceProseStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableNamesStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputEvidence: {
      historicalReplayVerdict,
      r770AggregateStatus: inputs.r770Aggregate === null ? "missing" : "available",
      r770ValidationStatus,
      r773AggregateStatus: inputs.r773Aggregate === null ? "missing" : "available",
      r773ValidationStatus,
    },
    packetId: "r1028-historical-nshap-function-transport-packet",
    schemaVersion: R1028_HISTORICAL_NSHAP_FUNCTION_TRANSPORT_PACKET_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: "historical_nshap_function_transport_packet_ready_for_review",
      productDisplayAuthorized: false,
      reviewGptNextUse: "aggregate_result_direction_only",
      rowParsingPerformedByR1028: false,
    },
  };
  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R1028 output failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputPath = path.join(outputDir, STATUS_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { aggregatePacket, aggregatePacketOutputPath, output, outputPath };
}

function buildAggregatePacket(input: {
  r770Aggregate: unknown;
  r773Aggregate: unknown;
}): AggregatePacket {
  const sameDenominatorValid = sameBand(input.r770Aggregate, input.r773Aggregate, ["denominator_bands", "eligible_count_band"])
    && sameBand(input.r770Aggregate, input.r773Aggregate, ["denominator_bands", "event_count_band"]);
  const combinedAucDelta = readNumberAt(input.r770Aggregate, [
    "delta_summaries",
    "combined_minus_raw_c",
    "median",
  ]);
  const combinedBrierDelta = readNumberAt(input.r770Aggregate, [
    "delta_summaries",
    "combined_minus_raw_brier",
    "median",
  ]);
  const functionAucDelta = readNumberAt(input.r773Aggregate, [
    "delta_summaries",
    "function_minus_intercept_c",
    "median",
  ]);
  const functionBrierDelta = readNumberAt(input.r773Aggregate, [
    "delta_summaries",
    "function_minus_intercept_brier",
    "median",
  ]);
  const functionShuffleAucDelta = readNumberAt(input.r773Aggregate, [
    "delta_summaries",
    "function_minus_shuffle_median_c",
    "median",
  ]);
  const functionShuffleBrierDelta = readNumberAt(input.r773Aggregate, [
    "delta_summaries",
    "function_minus_shuffle_median_brier",
    "median",
  ]);
  const cognitionAucDelta = readNumberAt(input.r773Aggregate, [
    "delta_summaries",
    "cognition_minus_intercept_c",
    "median",
  ]);
  const cognitionBrierDelta = readNumberAt(input.r773Aggregate, [
    "delta_summaries",
    "cognition_minus_intercept_brier",
    "median",
  ]);

  const functionImprovesProperScore = typeof functionBrierDelta === "number" && functionBrierDelta < 0;
  const combinedImprovesProperScore = typeof combinedBrierDelta === "number" && combinedBrierDelta < 0;
  const functionBeatsShuffle = typeof functionShuffleAucDelta === "number"
    && functionShuffleAucDelta > 0
    && typeof functionShuffleBrierDelta === "number"
    && functionShuffleBrierDelta < 0;
  const meaningfulAggregateDelta = Boolean(
    (typeof combinedAucDelta === "number" && combinedAucDelta >= 0.01 && combinedImprovesProperScore)
      || (typeof functionAucDelta === "number" && functionAucDelta >= 0.01 && functionImprovesProperScore),
  );
  const cognitionDominatesFunction = typeof cognitionAucDelta === "number"
    && typeof functionAucDelta === "number"
    && typeof cognitionBrierDelta === "number"
    && typeof functionBrierDelta === "number"
    && cognitionAucDelta > functionAucDelta
    && cognitionBrierDelta < functionBrierDelta;

  return {
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
      rowParsingPerformedByR1028: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceProseStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableNamesStored: false,
    },
    benchmark_lock: {
      candidate_families: [
        "anchor_same_denominator_reference",
        "function_disability_lead",
        "cognition_shadow_after_function",
      ],
      endpoint_family: "mortality_or_followup",
      evidence_label: "historical_external_aggregate_replay_not_product_validation",
      minimum_cell_threshold: "suppressed_under_10",
      product_display_authorized: false,
      same_denominator_required: true,
      source: "NSHAP",
      split_policy: "historical_private_source_split_replay",
      survey_weight_policy: "source_native_or_unweighted_diagnostic",
      time_horizon: "source_native_followup",
    },
    decision_inputs: {
      abstention_acceptable: abstentionLooksBounded(input.r770Aggregate),
      aggregate_verdict: meaningfulAggregateDelta ? "supports_generalization" : "directional_only",
      calibration_non_worse: false,
      cognition_dominates_function: cognitionDominatesFunction,
      contradicts_prior_function_evidence: false,
      function_beats_missingness_control: false,
      function_beats_shuffled_control: functionBeatsShuffle,
      meaningful_aggregate_delta: meaningfulAggregateDelta,
      proper_scores_improve: functionImprovesProperScore && combinedImprovesProperScore,
      same_denominator_valid: sameDenominatorValid,
      suppression_passed: storageAttestationClean(input.r770Aggregate) && storageAttestationClean(input.r773Aggregate),
    },
    denominator_bands: {
      abstention_count_band: readStringAt(input.r770Aggregate, ["abstention_bands", "unknown_endpoint"])
        ?? "aggregate_not_exported",
      anchor_complete_count_band: readStringAt(input.r770Aggregate, ["feature_support_bands", "age"])
        ?? "aggregate_not_exported",
      event_count_band: readStringAt(input.r770Aggregate, ["denominator_bands", "event_count_band"])
        ?? "aggregate_not_exported",
      function_complete_count_band: readStringAt(input.r770Aggregate, ["feature_support_bands", "function_composite"])
        ?? "aggregate_not_exported",
      non_event_count_band: "inferred_large_from_eligible_minus_events",
      primary_intersection_count_band: readStringAt(input.r770Aggregate, ["denominator_bands", "eligible_count_band"])
        ?? "aggregate_not_exported",
    },
    metric_deltas: {
      anchor_plus_function_sidecar_vs_frozen_anchor: {
        auc_delta: combinedAucDelta,
        brier_delta: combinedBrierDelta,
        log_loss_delta: null,
      },
      function_sidecar_vs_missingness_only_reference: {
        auc_delta: null,
        brier_delta: null,
        log_loss_delta: null,
      },
      function_sidecar_vs_shuffled_function_control: {
        auc_delta: functionShuffleAucDelta,
        brier_delta: functionShuffleBrierDelta,
        log_loss_delta: null,
      },
    },
    packetId: "r1025-function-transport-aggregate-packet",
    packetRole: "historical_nshap_aggregate_replay",
    schemaVersion: "murph-age-r1025-function-transport-aggregate-packet.v0",
    status: "research-local-aggregate-only",
  };
}

function validateAggregateOnlyPacket(packet: AggregatePacket): void {
  const findings = findForbiddenAggregateEgress(packet);
  if (findings.length > 0) {
    throw new Error(`R1028 aggregate packet failed aggregate-egress validation: ${findings.join("; ")}`);
  }
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function validationStatus(value: unknown | null): ValidationStatus {
  const status = readStringAt(value, ["status"]);
  if (status === "passed" || status === "failed") return status;
  return value === null ? "missing" : "unknown";
}

function sameBand(left: unknown, right: unknown, pathParts: string[]): boolean {
  const leftValue = readStringAt(left, pathParts);
  const rightValue = readStringAt(right, pathParts);
  return leftValue !== null && leftValue === rightValue;
}

function abstentionLooksBounded(value: unknown): boolean {
  const functionMissing = readStringAt(value, ["abstention_bands", "function_missing"]);
  const ageSexMissing = readStringAt(value, ["abstention_bands", "age_sex_missing_or_out_of_range"]);
  return functionMissing !== null
    && functionMissing !== "gte_100"
    && ageSexMissing === "not_observed";
}

function storageAttestationClean(value: unknown): boolean {
  const keys = [
    "row_values_exported",
    "participant_identifiers_exported",
    "row_level_predictions_exported",
    "coefficients_exported",
    "source_field_names_exported",
    "source_text_exported",
    "codebook_prose_exported",
    "product_claims_created",
  ];
  return keys.every((key) => readBooleanAt(value, ["storage_attestation", key]) === false);
}

function readStringAt(value: unknown, pathParts: string[]): string | null {
  let current: unknown = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" && current.length > 0 ? current : null;
}

function readNumberAt(value: unknown, pathParts: string[]): number | null {
  let current: unknown = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "number" && Number.isFinite(current) ? current : null;
}

function readBooleanAt(value: unknown, pathParts: string[]): boolean | null {
  let current: unknown = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "boolean" ? current : null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR1028HistoricalNshapFunctionTransportPacket({
    aggregatePacketOutputPath: process.env.MURPH_AGE_R1025_FUNCTION_TRANSPORT_AGGREGATE_PACKET_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r770ResultPath: process.env.MURPH_AGE_R770_NSHAP_RESULT_PATH,
    r770ValidationPath: process.env.MURPH_AGE_R770_NSHAP_VALIDATION_PATH,
    r773ResultPath: process.env.MURPH_AGE_R773_NSHAP_RESULT_PATH,
    r773ValidationPath: process.env.MURPH_AGE_R773_NSHAP_VALIDATION_PATH,
    r997ReplayPath: process.env.MURPH_AGE_R997_NSHAP_REPLAY_PATH,
  }).then(({ output }) => {
    process.stdout.write(`${JSON.stringify({
      aggregatePacketArtifact: output.aggregatePacketArtifact,
      conclusion: output.summary.conclusion,
      packetId: output.packetId,
      productDisplayAuthorized: output.summary.productDisplayAuthorized,
      reviewGptNextUse: output.summary.reviewGptNextUse,
      rowParsingPerformedByR1028: output.summary.rowParsingPerformedByR1028,
      schemaVersion: output.schemaVersion,
      status: output.status,
    }, null, 2)}\n`);
  }).catch((error: unknown) => {
    process.stdout.write(`${JSON.stringify({
      error: error instanceof Error ? error.message : "unknown R1028 failure",
      packetId: "r1028-historical-nshap-function-transport-packet",
      productDisplayAuthorized: false,
      rowParsingPerformedByR1028: false,
      status: "blocked",
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
