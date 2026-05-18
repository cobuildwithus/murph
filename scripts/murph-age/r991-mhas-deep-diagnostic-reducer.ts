import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R991_MHAS_DEEP_DIAGNOSTIC_REDUCER_SCHEMA_VERSION =
  "murph-age-r991-mhas-deep-diagnostic-reducer.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_R990_REPORT_PATH = path.join(
  "output-packages",
  "research",
  "murph-age",
  "autoresearch",
  "loop",
  "runs",
  "session_murph_age_r990_mhas_anchor_increment_deep_diagnostics",
  "mhas-anchor-increment-deep-diagnostics-r990.json",
);
const DEFAULT_R990_VALIDATION_PATH = path.join(
  "output-packages",
  "research",
  "murph-age",
  "autoresearch",
  "loop",
  "runs",
  "session_murph_age_r990_mhas_anchor_increment_deep_diagnostics",
  "mhas-anchor-increment-deep-diagnostics-validation-r990.json",
);
const OUTPUT_FILE_NAME = "r991-mhas-deep-diagnostic-reducer.latest.json";
const FROZEN_ANCHOR_ID = "r399_compact_age_nonlinear_l2_0p000";

interface MetricRangeSummary {
  max: number;
  median: number;
  min: number;
  p10: number;
  p90: number;
}

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

export interface R991MhasDeepDiagnosticReducerOptions {
  createdAt?: string;
  outputDir?: string;
  r990ReportPath?: string;
  r990ValidationPath?: string;
}

export interface R991MhasDeepDiagnosticReducerOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookProseStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    participantIdentifiersStored: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR991: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
    variableNamesStored: false;
  };
  createdAt: string;
  deepDiagnostic: {
    anchorModelId: typeof FROZEN_ANCHOR_ID | "unknown";
    keyRates: {
      functionBrierBeatsSourceInterceptRate: number;
      functionCBeatsSourceInterceptRate: number;
      functionLogLossBeatsSourceInterceptRate: number;
      residualBrierBeatsSourceInterceptRate: number;
      residualCBeatsSourceInterceptRate: number;
      residualLogLossBeatsSourceInterceptRate: number;
    };
    medianDeltas: {
      functionMinusSourceInterceptBrier: MetricRangeSummary | null;
      functionMinusSourceInterceptC: MetricRangeSummary | null;
      functionMinusSourceInterceptLogLoss: MetricRangeSummary | null;
      residualMinusSourceInterceptBrier: MetricRangeSummary | null;
      residualMinusSourceInterceptC: MetricRangeSummary | null;
      residualMinusSourceInterceptLogLoss: MetricRangeSummary | null;
    };
    repeatCount: number | null;
    shuffleCountPerRepeat: number | null;
    verdict:
      | "function_increment_supportive_with_residualized_signal_diagnostic_only"
      | "function_increment_hold_after_deep_diagnostic";
  };
  decision: {
    action:
      | "preserve_function_disability_as_lead_sidecar_after_deep_diagnostic"
      | "hold_function_disability_after_deep_diagnostic";
    allowedEffect: "research_model_direction_only";
    nextModelQuestion: "fresh_external_function_cognition_generalization";
    rationaleLabels: string[];
  };
  executionEvidence: {
    aggregateValidationPassed: boolean;
    incrementDiagnosticExecuted: boolean | null;
    modelPromotionAuthorized: false;
    modelTrainingExecuted: boolean | null;
    productClaimsCreated: false;
    rowParseExecutedPrivateOnly: boolean | null;
    shuffleControlsExecuted: boolean | null;
  };
  inputArtifacts: {
    r990AggregateReport: ArtifactSummary;
    r990Validation: ArtifactSummary;
  };
  packetId: "r991-mhas-deep-diagnostic-reducer";
  schemaVersion: typeof R991_MHAS_DEEP_DIAGNOSTIC_REDUCER_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    nextLocalAction:
      | "prepare_fresh_nshap_function_cognition_generalization_when_activation_is_confirmed"
      | "return_to_candidate_family_search";
    productDisplayAuthorized: false;
    verdict:
      | "function_disability_survives_age_residualized_deep_diagnostic"
      | "function_disability_deep_diagnostic_not_confirmed";
  };
}

export async function runR991MhasDeepDiagnosticReducer(
  options: R991MhasDeepDiagnosticReducerOptions = {},
): Promise<{ output: R991MhasDeepDiagnosticReducerOutput; outputPath: string }> {
  const r990Report = await readJsonIfPresent(options.r990ReportPath ?? DEFAULT_R990_REPORT_PATH);
  const r990Validation = await readJsonIfPresent(options.r990ValidationPath ?? DEFAULT_R990_VALIDATION_PATH);
  validateInputBoundaries(r990Report);

  const validationPassed = readStringAt(r990Validation, ["status"]) === "passed";
  const anchorId = readStringAt(r990Report, ["anchor_model_id"]);
  const sourceVerdict = readStringAt(r990Report, ["verdict"]);
  const keyRates = {
    functionBrierBeatsSourceInterceptRate:
      readNumberAt(r990Report, ["key_rates", "function_brier_beats_source_intercept_rate"]) ?? 0,
    functionCBeatsSourceInterceptRate:
      readNumberAt(r990Report, ["key_rates", "function_c_beats_source_intercept_rate"]) ?? 0,
    functionLogLossBeatsSourceInterceptRate:
      readNumberAt(r990Report, ["key_rates", "function_log_loss_beats_source_intercept_rate"]) ?? 0,
    residualBrierBeatsSourceInterceptRate:
      readNumberAt(r990Report, ["key_rates", "residual_brier_beats_source_intercept_rate"]) ?? 0,
    residualCBeatsSourceInterceptRate:
      readNumberAt(r990Report, ["key_rates", "residual_c_beats_source_intercept_rate"]) ?? 0,
    residualLogLossBeatsSourceInterceptRate:
      readNumberAt(r990Report, ["key_rates", "residual_log_loss_beats_source_intercept_rate"]) ?? 0,
  };
  const medianDeltas = {
    functionMinusSourceInterceptBrier:
      readMetricRange(r990Report, ["delta_summaries", "function_minus_source_intercept_brier"]),
    functionMinusSourceInterceptC:
      readMetricRange(r990Report, ["delta_summaries", "function_minus_source_intercept_c"]),
    functionMinusSourceInterceptLogLoss:
      readMetricRange(r990Report, ["delta_summaries", "function_minus_source_intercept_log_loss"]),
    residualMinusSourceInterceptBrier:
      readMetricRange(r990Report, ["delta_summaries", "residual_minus_source_intercept_brier"]),
    residualMinusSourceInterceptC:
      readMetricRange(r990Report, ["delta_summaries", "residual_minus_source_intercept_c"]),
    residualMinusSourceInterceptLogLoss:
      readMetricRange(r990Report, ["delta_summaries", "residual_minus_source_intercept_log_loss"]),
  };
  const supportive = validationPassed
    && anchorId === FROZEN_ANCHOR_ID
    && sourceVerdict === "function_increment_supportive_with_residualized_signal_diagnostic_only"
    && keyRates.functionBrierBeatsSourceInterceptRate >= 0.9
    && keyRates.functionLogLossBeatsSourceInterceptRate >= 0.9
    && keyRates.functionCBeatsSourceInterceptRate >= 0.8
    && keyRates.residualBrierBeatsSourceInterceptRate >= 0.9
    && keyRates.residualLogLossBeatsSourceInterceptRate >= 0.9
    && keyRates.residualCBeatsSourceInterceptRate >= 0.8
    && (medianDeltas.residualMinusSourceInterceptBrier?.median ?? 1) < 0
    && (medianDeltas.residualMinusSourceInterceptLogLoss?.median ?? 1) < 0
    && (medianDeltas.residualMinusSourceInterceptC?.median ?? -1) > 0;

  const output: R991MhasDeepDiagnosticReducerOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookProseStored: false,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      participantIdentifiersStored: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR991: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
      variableNamesStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    deepDiagnostic: {
      anchorModelId: anchorId === FROZEN_ANCHOR_ID ? FROZEN_ANCHOR_ID : "unknown",
      keyRates,
      medianDeltas,
      repeatCount: readNumberAt(r990Report, ["repeat_count"]),
      shuffleCountPerRepeat: readNumberAt(r990Report, ["shuffle_count_per_repeat"]),
      verdict: supportive
        ? "function_increment_supportive_with_residualized_signal_diagnostic_only"
        : "function_increment_hold_after_deep_diagnostic",
    },
    decision: {
      action: supportive
        ? "preserve_function_disability_as_lead_sidecar_after_deep_diagnostic"
        : "hold_function_disability_after_deep_diagnostic",
      allowedEffect: "research_model_direction_only",
      nextModelQuestion: "fresh_external_function_cognition_generalization",
      rationaleLabels: supportive
        ? [
          "frozen_anchor_confirmed",
          "source_intercept_comparator_beaten",
          "age_sex_residualized_signal_survives",
          "shuffle_controls_beaten",
          "research_only_no_product_claim",
        ]
        : ["deep_diagnostic_support_not_confirmed"],
    },
    executionEvidence: {
      aggregateValidationPassed: validationPassed,
      incrementDiagnosticExecuted: readBooleanAt(r990Report, ["status_snapshot", "increment_diagnostic_executed"]),
      modelPromotionAuthorized: false,
      modelTrainingExecuted: readBooleanAt(r990Report, ["status_snapshot", "model_training_executed"]),
      productClaimsCreated: false,
      rowParseExecutedPrivateOnly: readBooleanAt(r990Report, ["status_snapshot", "row_parse_executed_private_only"]),
      shuffleControlsExecuted: readBooleanAt(r990Report, ["status_snapshot", "shuffle_controls_executed"]),
    },
    inputArtifacts: {
      r990AggregateReport: summarizeArtifact(
        "mhas-anchor-increment-deep-diagnostics-r990.json",
        "murph.age.r990.mhas_anchor_increment_deep_diagnostics.v0",
        r990Report,
      ),
      r990Validation: summarizeArtifact(
        "mhas-anchor-increment-deep-diagnostics-validation-r990.json",
        "murph.age.r990.mhas_anchor_increment_deep_diagnostics_validation.v0",
        r990Validation,
      ),
    },
    packetId: "r991-mhas-deep-diagnostic-reducer",
    schemaVersion: R991_MHAS_DEEP_DIAGNOSTIC_REDUCER_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      nextLocalAction: supportive
        ? "prepare_fresh_nshap_function_cognition_generalization_when_activation_is_confirmed"
        : "return_to_candidate_family_search",
      productDisplayAuthorized: false,
      verdict: supportive
        ? "function_disability_survives_age_residualized_deep_diagnostic"
        : "function_disability_deep_diagnostic_not_confirmed",
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R991 MHAS deep diagnostic reducer failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function validateInputBoundaries(value: unknown | null): void {
  const report = optionalRecord(value);
  const storage = optionalRecord(report?.storage_attestation);
  if (!storage) return;
  for (const key of [
    "row_values_exported",
    "participant_identifiers_exported",
    "row_level_predictions_exported",
    "coefficients_exported",
    "source_field_names_exported",
    "source_text_exported",
    "local_paths_exported",
    "source_file_names_exported",
    "codebook_prose_exported",
    "product_claims_created",
  ]) {
    if (storage[key] !== false) throw new Error(`r990 storage attestation flag ${key} must be false.`);
  }
}

function summarizeArtifact(
  artifact: string,
  expectedSchemaVersion: string,
  value: unknown | null,
): ArtifactSummary {
  if (!value) return { artifact, packetId: null, schemaVersion: null, status: "missing" };
  const root = requiredRecord(value, artifact);
  const schemaVersion = readString(root.schemaVersion) ?? readString(root.schema_version);
  return {
    artifact,
    packetId: readString(root.packetId) ?? readString(root.run_id) ?? null,
    schemaVersion: schemaVersion === expectedSchemaVersion ? schemaVersion : null,
    status: "available",
  };
}

function readMetricRange(value: unknown, pathParts: readonly string[]): MetricRangeSummary | null {
  const record = optionalRecord(readAtPath(value, pathParts));
  if (!record) return null;
  const result = {
    max: readNumber(record.max),
    median: readNumber(record.median),
    min: readNumber(record.min),
    p10: readNumber(record.p10),
    p90: readNumber(record.p90),
  };
  return Object.values(result).every((item) => item !== null) ? result as MetricRangeSummary : null;
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") return null;
    throw new Error("Failed to read an aggregate R990 MHAS deep diagnostic artifact.");
  }
}

function readNumberAt(value: unknown, pathParts: readonly string[]): number | null {
  return readNumber(readAtPath(value, pathParts));
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBooleanAt(value: unknown, pathParts: readonly string[]): boolean | null {
  const valueAtPath = readAtPath(value, pathParts);
  return typeof valueAtPath === "boolean" ? valueAtPath : null;
}

function readStringAt(value: unknown, pathParts: readonly string[]): string | null {
  return readString(readAtPath(value, pathParts));
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && !/[\r\n\t/\\]/u.test(value)
    ? value
    : null;
}

function readAtPath(value: unknown, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    const record = optionalRecord(current);
    if (!record) return null;
    current = record[part];
  }
  return current;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  const record = optionalRecord(value);
  if (!record) throw new Error(`${label} must be an object.`);
  return record;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR991MhasDeepDiagnosticReducer({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r990ReportPath: process.env.MURPH_AGE_R990_MHAS_DEEP_DIAGNOSTIC_REPORT_PATH,
    r990ValidationPath: process.env.MURPH_AGE_R990_MHAS_DEEP_DIAGNOSTIC_VALIDATION_PATH,
  }).then(({ output, outputPath }) => {
    process.stdout.write(`${JSON.stringify({
      artifact: path.basename(outputPath),
      keyRates: output.deepDiagnostic.keyRates,
      packetId: output.packetId,
      productDisplayAuthorized: output.summary.productDisplayAuthorized,
      schemaVersion: output.schemaVersion,
      status: output.status,
      verdict: output.summary.verdict,
    }, null, 2)}\n`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "R991 MHAS deep diagnostic reducer failed.");
    process.exitCode = 1;
  });
}
