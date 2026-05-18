import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R988_MHAS_ANCHOR_FUNCTION_INCREMENT_CHECK_SCHEMA_VERSION =
  "murph-age-r988-mhas-anchor-function-increment-check.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_R744_REPORT_PATH = path.join(
  "output-packages",
  "research",
  "murph-age",
  "autoresearch",
  "loop",
  "runs",
  "session_murph_age_r744_mhas_function_cross_source_repeat",
  "mhas-function-cross-source-repeat-r744.json",
);
const DEFAULT_R744_VALIDATION_PATH = path.join(
  "output-packages",
  "research",
  "murph-age",
  "autoresearch",
  "loop",
  "runs",
  "session_murph_age_r744_mhas_function_cross_source_repeat",
  "mhas-function-cross-source-repeat-validation-r744.json",
);
const OUTPUT_FILE_NAME = "r988-mhas-anchor-function-increment-check.latest.json";
const FROZEN_ANCHOR_ID = "r399_compact_age_nonlinear_l2_0p000";

type ArtifactKey = "r744AggregateReport" | "r744Validation" | "r980MhasFunctionReducer";
type ArtifactStatus = "available" | "missing";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: ArtifactStatus;
}

interface MetricRangeSummary {
  max: number;
  median: number;
  min: number;
  p10: number;
  p90: number;
}

export interface R988MhasAnchorFunctionIncrementCheckOptions {
  createdAt?: string;
  outputDir?: string;
  r744ReportPath?: string;
  r744ValidationPath?: string;
  r980Path?: string;
}

export interface R988MhasAnchorFunctionIncrementCheckOutput {
  anchorIncrement: {
    anchorModelId: typeof FROZEN_ANCHOR_ID | "unknown";
    comparisonPolicy: {
      baseComparator: "source_intercept_calibrated_frozen_anchor";
      extraComparators: [
        "raw_frozen_anchor_without_source_calibration",
        "deterministic_function_shuffle_controls",
      ];
      trainingTarget: "mortality_risk_not_chronological_age";
    };
    keyRates: {
      functionBrierBeatsAllShufflesRate: number;
      functionBrierBeatsInterceptRate: number;
      functionBrierBeatsRawRate: number;
      functionCBeatsAllShufflesRate: number;
      functionCBeatsInterceptRate: number;
      functionCBeatsRawRate: number;
    };
    medianDeltas: {
      functionMinusRawBrier: MetricRangeSummary | null;
      functionMinusRawC: MetricRangeSummary | null;
      functionMinusSourceInterceptBrier: MetricRangeSummary | null;
      functionMinusSourceInterceptC: MetricRangeSummary | null;
      functionMinusShuffleMedianBrier: MetricRangeSummary | null;
      functionMinusShuffleMedianC: MetricRangeSummary | null;
    };
    repeatCount: number | null;
    shuffleCountPerRepeat: number | null;
    verdict:
      | "anchor_function_increment_supported_small_diagnostic_only"
      | "anchor_function_increment_hold";
  };
  artifactBoundary: {
    aggregateOnly: true;
    codebookProseStored: false;
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
    rowParsingPerformedByR988: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    splitMembershipStored: false;
    variableLabelsStored: false;
    variableNamesStored: false;
  };
  createdAt: string;
  decision: {
    action:
      | "preserve_function_disability_as_anchor_increment_candidate"
      | "hold_function_disability_anchor_increment_candidate";
    allowedEffect: "research_sidecar_direction_only";
    rationaleLabels: string[];
    reviewGptRole: "high_value_result_interpretation_only";
  };
  executionEvidence: {
    aggregateValidationPassed: boolean;
    frozenAnchorScoringExecutedInPriorLoop: boolean | null;
    modelTrainingExecutedInPriorLoop: boolean | null;
    privateSourceCalibrationFitExecutedInPriorLoop: boolean | null;
    productClaimsCreated: false;
    rowParseExecutedPrivateOnlyInPriorLoop: boolean | null;
  };
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  packetId: "r988-mhas-anchor-function-increment-check";
  schemaVersion: typeof R988_MHAS_ANCHOR_FUNCTION_INCREMENT_CHECK_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    nextLocalAction:
      | "use_as_r986_anchor_increment_receipt_then_continue_external_source_activation"
      | "return_to_candidate_generation";
    productDisplayAuthorized: false;
    rowParsingPerformedByReducer: false;
    verdict:
      | "mhas_function_adds_small_increment_over_frozen_anchor"
      | "mhas_function_increment_not_confirmed";
  };
}

export async function runR988MhasAnchorFunctionIncrementCheck(
  options: R988MhasAnchorFunctionIncrementCheckOptions = {},
): Promise<{ output: R988MhasAnchorFunctionIncrementCheckOutput; outputPath: string }> {
  const inputs = {
    r744AggregateReport: await readJsonIfPresent(options.r744ReportPath ?? DEFAULT_R744_REPORT_PATH),
    r744Validation: await readJsonIfPresent(options.r744ValidationPath ?? DEFAULT_R744_VALIDATION_PATH),
    r980MhasFunctionReducer: await readJsonIfPresent(
      options.r980Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r980-mhas-function-disability-aggregate-reducer.latest.json"),
    ),
  };
  validateInputBoundaries(inputs);

  const validationPassed = readStringAt(inputs.r744Validation, ["status"]) === "passed";
  const supportClassification = readStringAt(inputs.r744AggregateReport, ["support_classification"]);
  const anchorId = readStringAt(inputs.r744AggregateReport, ["anchor_model_id"]);
  const keyRates = {
    functionBrierBeatsAllShufflesRate:
      readNumberAt(inputs.r744AggregateReport, ["key_rates", "function_brier_beats_all_shuffles_rate"]) ?? 0,
    functionBrierBeatsInterceptRate:
      readNumberAt(inputs.r744AggregateReport, ["key_rates", "function_brier_beats_intercept_rate"]) ?? 0,
    functionBrierBeatsRawRate:
      readNumberAt(inputs.r744AggregateReport, ["key_rates", "function_brier_beats_raw_rate"]) ?? 0,
    functionCBeatsAllShufflesRate:
      readNumberAt(inputs.r744AggregateReport, ["key_rates", "function_c_beats_all_shuffles_rate"]) ?? 0,
    functionCBeatsInterceptRate:
      readNumberAt(inputs.r744AggregateReport, ["key_rates", "function_c_beats_intercept_rate"]) ?? 0,
    functionCBeatsRawRate:
      readNumberAt(inputs.r744AggregateReport, ["key_rates", "function_c_beats_raw_rate"]) ?? 0,
  };
  const medianDeltas = {
    functionMinusRawBrier: readMetricRange(inputs.r744AggregateReport, ["delta_summaries", "function_minus_raw_brier"]),
    functionMinusRawC: readMetricRange(inputs.r744AggregateReport, ["delta_summaries", "function_minus_raw_c"]),
    functionMinusSourceInterceptBrier:
      readMetricRange(inputs.r744AggregateReport, ["delta_summaries", "function_minus_intercept_brier"]),
    functionMinusSourceInterceptC:
      readMetricRange(inputs.r744AggregateReport, ["delta_summaries", "function_minus_intercept_c"]),
    functionMinusShuffleMedianBrier:
      readMetricRange(inputs.r744AggregateReport, ["delta_summaries", "function_minus_shuffle_median_brier"]),
    functionMinusShuffleMedianC:
      readMetricRange(inputs.r744AggregateReport, ["delta_summaries", "function_minus_shuffle_median_c"]),
  };
  const incrementSupported = validationPassed
    && anchorId === FROZEN_ANCHOR_ID
    && supportClassification === "mhas_concordant_supportive_diagnostic_only"
    && keyRates.functionBrierBeatsInterceptRate >= 0.9
    && keyRates.functionCBeatsInterceptRate >= 0.9
    && keyRates.functionBrierBeatsAllShufflesRate >= 0.9
    && keyRates.functionCBeatsAllShufflesRate >= 0.8
    && (medianDeltas.functionMinusSourceInterceptBrier?.median ?? 1) < 0
    && (medianDeltas.functionMinusSourceInterceptC?.median ?? -1) > 0;

  const output: R988MhasAnchorFunctionIncrementCheckOutput = {
    anchorIncrement: {
      anchorModelId: anchorId === FROZEN_ANCHOR_ID ? FROZEN_ANCHOR_ID : "unknown",
      comparisonPolicy: {
        baseComparator: "source_intercept_calibrated_frozen_anchor",
        extraComparators: [
          "raw_frozen_anchor_without_source_calibration",
          "deterministic_function_shuffle_controls",
        ],
        trainingTarget: "mortality_risk_not_chronological_age",
      },
      keyRates,
      medianDeltas,
      repeatCount: readNumberAt(inputs.r744AggregateReport, ["repeat_count"]),
      shuffleCountPerRepeat: readNumberAt(inputs.r744AggregateReport, ["shuffle_count_per_repeat"]),
      verdict: incrementSupported
        ? "anchor_function_increment_supported_small_diagnostic_only"
        : "anchor_function_increment_hold",
    },
    artifactBoundary: {
      aggregateOnly: true,
      codebookProseStored: false,
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
      rowParsingPerformedByR988: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableNamesStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    decision: {
      action: incrementSupported
        ? "preserve_function_disability_as_anchor_increment_candidate"
        : "hold_function_disability_anchor_increment_candidate",
      allowedEffect: "research_sidecar_direction_only",
      rationaleLabels: rationaleLabels({
        anchorReady: anchorId === FROZEN_ANCHOR_ID,
        incrementSupported,
        supportClassification,
        validationPassed,
      }),
      reviewGptRole: "high_value_result_interpretation_only",
    },
    executionEvidence: {
      aggregateValidationPassed: validationPassed,
      frozenAnchorScoringExecutedInPriorLoop:
        readBooleanAt(inputs.r744AggregateReport, ["status_snapshot", "external_transport_scoring_executed"]),
      modelTrainingExecutedInPriorLoop:
        readBooleanAt(inputs.r744AggregateReport, ["status_snapshot", "model_training_executed"]),
      privateSourceCalibrationFitExecutedInPriorLoop:
        readBooleanAt(inputs.r744AggregateReport, ["status_snapshot", "private_source_calibration_fit_executed"]),
      productClaimsCreated: false,
      rowParseExecutedPrivateOnlyInPriorLoop:
        readBooleanAt(inputs.r744AggregateReport, ["status_snapshot", "row_parse_executed_private_only"]),
    },
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r988-mhas-anchor-function-increment-check",
    schemaVersion: R988_MHAS_ANCHOR_FUNCTION_INCREMENT_CHECK_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      nextLocalAction: incrementSupported
        ? "use_as_r986_anchor_increment_receipt_then_continue_external_source_activation"
        : "return_to_candidate_generation",
      productDisplayAuthorized: false,
      rowParsingPerformedByReducer: false,
      verdict: incrementSupported
        ? "mhas_function_adds_small_increment_over_frozen_anchor"
        : "mhas_function_increment_not_confirmed",
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R988 MHAS anchor function increment check failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

function summarizeInputs(inputs: Record<ArtifactKey, unknown | null>): Record<ArtifactKey, ArtifactSummary> {
  return {
    r744AggregateReport: summarizeArtifact(
      "mhas-function-cross-source-repeat-r744.json",
      "murph.age.r744.mhas_function_cross_source_repeat.v0",
      inputs.r744AggregateReport,
    ),
    r744Validation: summarizeArtifact(
      "mhas-function-cross-source-repeat-validation-r744.json",
      "murph.age.r744.mhas_function_cross_source_repeat_validation.v0",
      inputs.r744Validation,
    ),
    r980MhasFunctionReducer: summarizeArtifact(
      "r980-mhas-function-disability-aggregate-reducer.latest.json",
      "murph-age-r980-mhas-function-disability-aggregate-reducer.v1",
      inputs.r980MhasFunctionReducer,
    ),
  };
}

function summarizeArtifact(artifact: string, expectedSchemaVersion: string, value: unknown | null): ArtifactSummary {
  if (!value) return { artifact, packetId: null, schemaVersion: null, status: "missing" };
  const root = requiredRecord(value, artifact);
  const schemaVersion = readOptionalString(root.schemaVersion) ?? readOptionalString(root.schema_version);
  return {
    artifact,
    packetId: readOptionalString(root.packetId) ?? readOptionalString(root.run_id) ?? null,
    schemaVersion: schemaVersion === expectedSchemaVersion ? schemaVersion : null,
    status: "available",
  };
}

function validateInputBoundaries(inputs: Record<ArtifactKey, unknown | null>): void {
  const report = optionalRecord(inputs.r744AggregateReport);
  const storage = optionalRecord(report?.storage_attestation);
  if (storage) {
    for (const key of [
      "row_values_exported",
      "participant_identifiers_exported",
      "row_level_predictions_exported",
      "coefficients_exported",
      "source_field_names_exported",
      "source_text_exported",
      "codebook_prose_exported",
      "product_claims_created",
    ]) {
      if (storage[key] !== false) throw new Error(`r744 storage attestation flag ${key} must be false.`);
    }
  }
  const reducerBoundary = optionalRecord(readAtPath(inputs.r980MhasFunctionReducer, ["artifactBoundary"]));
  if (reducerBoundary) {
    for (const key of [
      "codebookProseStored",
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
      "variableLabelsStored",
      "variableNamesStored",
    ]) {
      if (reducerBoundary[key] !== undefined && reducerBoundary[key] !== false) {
        throw new Error(`r980 artifact boundary flag ${key} must be false.`);
      }
    }
  }
}

function rationaleLabels(input: {
  anchorReady: boolean;
  incrementSupported: boolean;
  supportClassification: string | null;
  validationPassed: boolean;
}): string[] {
  if (input.incrementSupported) {
    return [
      "frozen_nhis_r399_anchor_confirmed",
      "source_intercept_comparator_used",
      "function_increment_beats_calibrated_anchor_and_shuffle_controls",
      "diagnostic_sidecar_only_no_product_claim",
    ];
  }
  return [
    input.anchorReady ? null : "frozen_anchor_not_confirmed",
    input.validationPassed ? null : "aggregate_validation_not_passed",
    input.supportClassification ?? "support_classification_missing",
  ].filter((label): label is string => Boolean(label));
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
    throw new Error("Failed to read an aggregate MHAS anchor increment input artifact.");
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
  return readOptionalString(readAtPath(value, pathParts));
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

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && safeMetadataLabel(value) ? value : null;
}

function safeMetadataLabel(value: string): boolean {
  return value.length <= 128 && !/[\r\n\t/\\]/u.test(value);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR988MhasAnchorFunctionIncrementCheck({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r744ReportPath: process.env.MURPH_AGE_R744_MHAS_FUNCTION_REPORT_PATH,
    r744ValidationPath: process.env.MURPH_AGE_R744_MHAS_FUNCTION_VALIDATION_PATH,
    r980Path: process.env.MURPH_AGE_R980_MHAS_FUNCTION_REDUCER_PATH,
  }).then(({ output, outputPath }) => {
    const summary = {
      artifact: path.basename(outputPath),
      keyRates: output.anchorIncrement.keyRates,
      packetId: output.packetId,
      productDisplayAuthorized: output.summary.productDisplayAuthorized,
      rowParsingPerformedByReducer: output.summary.rowParsingPerformedByReducer,
      schemaVersion: output.schemaVersion,
      status: output.status,
      verdict: output.summary.verdict,
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "R988 MHAS anchor function increment check failed.");
    process.exitCode = 1;
  });
}
