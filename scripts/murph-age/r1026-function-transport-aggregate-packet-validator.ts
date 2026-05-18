import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1026_FUNCTION_TRANSPORT_AGGREGATE_PACKET_VALIDATOR_SCHEMA_VERSION =
  "murph-age-r1026-function-transport-aggregate-packet-validator.v1" as const;

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
const OUTPUT_FILE_NAME = "r1026-function-transport-aggregate-packet-validator.latest.json";

const REQUIRED_DECISION_BOOLEAN_KEYS = [
  "abstention_acceptable",
  "calibration_non_worse",
  "cognition_dominates_function",
  "contradicts_prior_function_evidence",
  "function_beats_missingness_control",
  "function_beats_shuffled_control",
  "meaningful_aggregate_delta",
  "proper_scores_improve",
  "same_denominator_valid",
  "suppression_passed",
] as const;
const ALLOWED_VERDICTS = new Set([
  "blocked_by_denominator_or_suppression",
  "directional_only",
  "not_confirmed",
  "supports_generalization",
]);
const REQUIRED_BENCHMARK_LOCK_KEYS = [
  "candidate_families",
  "endpoint_family",
  "evidence_label",
  "minimum_cell_threshold",
  "same_denominator_required",
  "source",
  "split_policy",
  "survey_weight_policy",
  "time_horizon",
] as const;
const REQUIRED_DENOMINATOR_BAND_KEYS = [
  "abstention_count_band",
  "anchor_complete_count_band",
  "event_count_band",
  "function_complete_count_band",
  "non_event_count_band",
  "primary_intersection_count_band",
] as const;
const REQUIRED_COMPARISON_KEYS = [
  "anchor_plus_function_sidecar_vs_frozen_anchor",
  "function_sidecar_vs_missingness_only_reference",
  "function_sidecar_vs_shuffled_function_control",
] as const;
const REQUIRED_DELTA_KEYS = [
  "auc_delta",
  "brier_delta",
  "log_loss_delta",
] as const;

export interface R1026FunctionTransportAggregatePacketValidatorOptions {
  aggregatePacketPath?: string;
  createdAt?: string;
  outputDir?: string;
}

export interface R1026FunctionTransportAggregatePacketValidatorOutput {
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
    rowParsingPerformedByR1026: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceProseStored: false;
    splitMembershipStored: false;
    variableLabelsStored: false;
    variableNamesStored: false;
  };
  createdAt: string;
  packetId: "r1026-function-transport-aggregate-packet-validator";
  packetValidation: {
    aggregatePacketStatus: "available" | "missing";
    checkedSections: string[];
    issueCountBand: "0" | "nonzero";
    issues: string[];
    validationStatus: "missing" | "passed";
  };
  schemaVersion: typeof R1026_FUNCTION_TRANSPORT_AGGREGATE_PACKET_VALIDATOR_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "fresh_function_transport_packet_missing"
      | "fresh_function_transport_packet_valid";
    productDisplayAuthorized: false;
    rowParsingPerformedByR1026: false;
  };
}

export async function runR1026FunctionTransportAggregatePacketValidator(
  options: R1026FunctionTransportAggregatePacketValidatorOptions = {},
): Promise<{ output: R1026FunctionTransportAggregatePacketValidatorOutput; outputPath: string }> {
  const aggregatePacket = await readJsonIfPresent(options.aggregatePacketPath ?? DEFAULT_AGGREGATE_PACKET_PATH);
  const issues = aggregatePacket === null ? [] : validateAggregatePacket(aggregatePacket);
  if (issues.length > 0) {
    throw new Error(`R1026 function-transport aggregate packet failed validation: ${issues.join("; ")}`);
  }

  const output: R1026FunctionTransportAggregatePacketValidatorOutput = {
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
      rowParsingPerformedByR1026: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceProseStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableNamesStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    packetId: "r1026-function-transport-aggregate-packet-validator",
    packetValidation: {
      aggregatePacketStatus: aggregatePacket === null ? "missing" : "available",
      checkedSections: aggregatePacket === null
        ? []
        : [
          "artifact_boundary",
          "benchmark_lock",
          "decision_inputs",
          "denominator_bands",
          "metric_deltas",
          "no_forbidden_values",
        ],
      issueCountBand: "0",
      issues: [],
      validationStatus: aggregatePacket === null ? "missing" : "passed",
    },
    schemaVersion: R1026_FUNCTION_TRANSPORT_AGGREGATE_PACKET_VALIDATOR_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: aggregatePacket === null
        ? "fresh_function_transport_packet_missing"
        : "fresh_function_transport_packet_valid",
      productDisplayAuthorized: false,
      rowParsingPerformedByR1026: false,
    },
  };

  const outputFindings = findForbiddenAggregateEgress(output);
  if (outputFindings.length > 0) {
    throw new Error(`R1026 validator output failed aggregate-egress validation: ${outputFindings.join("; ")}`);
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

function validateAggregatePacket(value: unknown): string[] {
  const root = optionalRecord(value);
  if (!root) return ["aggregate_packet_must_be_object"];

  return [
    ...findForbiddenAggregateEgress(root),
    ...findForbiddenValueEgress(root),
    ...validatePacketIdentity(root),
    ...validateArtifactBoundary(root.artifactBoundary),
    ...validateBenchmarkLock(root.benchmark_lock),
    ...validateDecisionInputs(root.decision_inputs),
    ...validateDenominatorBands(root.denominator_bands),
    ...validateMetricDeltas(root.metric_deltas),
  ];
}

function validatePacketIdentity(root: Record<string, unknown>): string[] {
  const issues: string[] = [];
  if (root.packetId !== "r1025-function-transport-aggregate-packet") {
    issues.push("packet_id_must_match_function_transport_aggregate_packet");
  }
  if (typeof root.schemaVersion !== "string" || !root.schemaVersion.startsWith("murph-age-r1025-function-transport-aggregate-packet.")) {
    issues.push("schema_version_must_match_r1025_aggregate_packet_family");
  }
  if (root.status !== "research-local-aggregate-only") {
    issues.push("status_must_be_research_local_aggregate_only");
  }
  return issues;
}

function validateArtifactBoundary(value: unknown): string[] {
  const boundary = optionalRecord(value);
  if (!boundary) return ["artifact_boundary_missing"];
  const requiredFalseKeys = [
    "codebookTextStored",
    "coefficientsStored",
    "localPathsStored",
    "modelParametersStored",
    "participantIdentifiersStored",
    "participantIdentifiersWritten",
    "predictionsStored",
    "productClaimsIncluded",
    "productDisplayAuthorized",
    "productPromotionAuthorized",
    "rowValuesStored",
    "smallCellsStored",
    "sourceBodiesStored",
    "splitMembershipStored",
  ] as const;
  const issues = boundary.aggregateOnly === true ? [] : ["artifact_boundary_aggregate_only_must_be_true"];
  for (const key of requiredFalseKeys) {
    if (boundary[key] !== false) issues.push(`artifact_boundary_${key}_must_be_false`);
  }
  return issues;
}

function validateBenchmarkLock(value: unknown): string[] {
  const lock = optionalRecord(value);
  if (!lock) return ["benchmark_lock_missing"];
  const issues: string[] = [];
  for (const key of REQUIRED_BENCHMARK_LOCK_KEYS) {
    if (!(key in lock)) issues.push(`benchmark_lock_missing_${key}`);
  }
  if (lock.same_denominator_required !== true) issues.push("benchmark_lock_same_denominator_required_must_be_true");
  if (lock.product_display_authorized !== false) issues.push("benchmark_lock_product_display_authorized_must_be_false");
  if (!Array.isArray(lock.candidate_families) || lock.candidate_families.length === 0) {
    issues.push("benchmark_lock_candidate_families_must_be_nonempty_array");
  }
  return issues;
}

function validateDecisionInputs(value: unknown): string[] {
  const inputs = optionalRecord(value);
  if (!inputs) return ["decision_inputs_missing"];
  const issues: string[] = [];
  for (const key of REQUIRED_DECISION_BOOLEAN_KEYS) {
    if (typeof inputs[key] !== "boolean") issues.push(`decision_inputs_${key}_must_be_boolean`);
  }
  if (typeof inputs.aggregate_verdict !== "string" || !ALLOWED_VERDICTS.has(inputs.aggregate_verdict)) {
    issues.push("decision_inputs_aggregate_verdict_not_allowed");
  }
  return issues;
}

function validateDenominatorBands(value: unknown): string[] {
  const bands = optionalRecord(value);
  if (!bands) return ["denominator_bands_missing"];
  const issues: string[] = [];
  for (const key of REQUIRED_DENOMINATOR_BAND_KEYS) {
    if (typeof bands[key] !== "string" || bands[key].length === 0) {
      issues.push(`denominator_bands_${key}_must_be_band_label`);
    }
  }
  return issues;
}

function validateMetricDeltas(value: unknown): string[] {
  const deltas = optionalRecord(value);
  if (!deltas) return ["metric_deltas_missing"];
  const issues: string[] = [];
  for (const comparisonKey of REQUIRED_COMPARISON_KEYS) {
    const comparison = optionalRecord(deltas[comparisonKey]);
    if (!comparison) {
      issues.push(`metric_deltas_missing_${comparisonKey}`);
      continue;
    }
    for (const deltaKey of REQUIRED_DELTA_KEYS) {
      const delta = comparison[deltaKey];
      if (typeof delta !== "number" && delta !== null) {
        issues.push(`metric_deltas_${comparisonKey}_${deltaKey}_must_be_number_or_null`);
      }
    }
  }
  return issues;
}

function findForbiddenValueEgress(value: unknown): string[] {
  const findings: string[] = [];
  const forbiddenPatterns = [
    { label: "local_home_path", pattern: /\/Users\//i },
    { label: "source_archive_name", pattern: /ICPSR_|\.dta\b|\.zip\b|\.rar\b/i },
    { label: "authorization_secret", pattern: /Bearer |Authorization:|PRIVATE KEY|SECRET/i },
  ];

  function visit(node: unknown, pathParts: string[]): void {
    if (typeof node === "string") {
      for (const { label, pattern } of forbiddenPatterns) {
        if (pattern.test(node)) findings.push(`forbidden value ${pathParts.join(".")} ${label}`);
      }
      return;
    }
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, [...pathParts, String(index)]));
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      visit(child, [...pathParts, key]);
    }
  }

  visit(value, []);
  return findings;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR1026FunctionTransportAggregatePacketValidator({
    aggregatePacketPath: process.env.MURPH_AGE_R1025_FUNCTION_TRANSPORT_AGGREGATE_PACKET_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
  }).then(({ output }) => {
    process.stdout.write(`${JSON.stringify({
      conclusion: output.summary.conclusion,
      packetId: output.packetId,
      productDisplayAuthorized: output.summary.productDisplayAuthorized,
      rowParsingPerformedByR1026: output.summary.rowParsingPerformedByR1026,
      schemaVersion: output.schemaVersion,
      status: output.status,
      validationStatus: output.packetValidation.validationStatus,
    }, null, 2)}\n`);
  }).catch((error: unknown) => {
    process.stdout.write(`${JSON.stringify({
      error: error instanceof Error ? error.message : "unknown R1026 failure",
      packetId: "r1026-function-transport-aggregate-packet-validator",
      productDisplayAuthorized: false,
      rowParsingPerformedByR1026: false,
      status: "blocked",
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
