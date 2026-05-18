import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R980_MHAS_FUNCTION_DISABILITY_AGGREGATE_REDUCER_SCHEMA_VERSION =
  "murph-age-r980-mhas-function-disability-aggregate-reducer.v1" as const;

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
const OUTPUT_FILE_NAME = "r980-mhas-function-disability-aggregate-reducer.latest.json";

type ArtifactKey = "r979MhasEndpointJoinContract" | "r744AggregateReport" | "r744Validation";
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

export interface R980MhasFunctionDisabilityAggregateReducerOptions {
  createdAt?: string;
  outputDir?: string;
  r744ReportPath?: string;
  r744ValidationPath?: string;
  r979Path?: string;
}

export interface R980MhasFunctionDisabilityAggregateReducerOutput {
  aggregateResult: {
    denominatorBands: Record<string, string>;
    featureSupportBands: Record<string, string>;
    keyRates: {
      functionBrierBeatsAllShufflesRate: number;
      functionBrierBeatsInterceptRate: number;
      functionBrierBeatsRawRate: number;
      functionBrierBeatsShuffleMedianRate: number;
      functionCBeatsAllShufflesRate: number;
      functionCBeatsInterceptRate: number;
      functionCBeatsRawRate: number;
      functionCBeatsShuffleMedianRate: number;
    };
    medianDeltas: {
      functionMinusRawBrier: MetricRangeSummary | null;
      functionMinusRawC: MetricRangeSummary | null;
      functionMinusShuffleMedianBrier: MetricRangeSummary | null;
      functionMinusShuffleMedianC: MetricRangeSummary | null;
    };
    repeatCount: number | null;
    shuffleCountPerRepeat: number | null;
    supportClassification: string | null;
  };
  artifactBoundary: {
    aggregateOnly: true;
    codebookProseStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    modelScoringPerformed: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    rowParsingPerformed: false;
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
      | "preserve_function_disability_candidate_family"
      | "hold_function_disability_candidate_family";
    allowedEffect: "candidate_domain_direction_only";
    productPromotionAuthorized: false;
    rationaleLabels: string[];
    reviewGptNextUse: "aggregate_delta_interpretation_only";
  };
  executionReceipt: {
    aggregateReportValidationPassed: boolean;
    modelPromotionAuthorized: false;
    modelTrainingExecuted: boolean | null;
    productClaimsCreated: false;
    privateSourceCalibrationExecuted: boolean | null;
    rowParseExecutedPrivateOnly: boolean | null;
  };
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  packetId: "r980-mhas-function-disability-aggregate-reducer";
  schemaVersion: typeof R980_MHAS_FUNCTION_DISABILITY_AGGREGATE_REDUCER_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: "mhas_function_disability_supportive_diagnostic_only" | "mhas_function_disability_hold_diagnostic_only";
    nextLocalAction: "send_aggregate_delta_to_reviewgpt_or_continue_ns_hap_sidecar";
    productDisplayAuthorized: false;
    rowParsingPerformedByReducer: false;
  };
}

export async function runR980MhasFunctionDisabilityAggregateReducer(
  options: R980MhasFunctionDisabilityAggregateReducerOptions = {},
): Promise<{ output: R980MhasFunctionDisabilityAggregateReducerOutput; outputPath: string }> {
  const inputs = {
    r744AggregateReport: await readJsonIfPresent(options.r744ReportPath ?? DEFAULT_R744_REPORT_PATH),
    r744Validation: await readJsonIfPresent(options.r744ValidationPath ?? DEFAULT_R744_VALIDATION_PATH),
    r979MhasEndpointJoinContract: await readJsonIfPresent(
      options.r979Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r979-mhas-endpoint-join-contract.latest.json"),
    ),
  };
  validateInputBoundaries(inputs);

  const inputArtifacts = summarizeInputs(inputs);
  const contractReady = readBooleanAt(inputs.r979MhasEndpointJoinContract, ["summary", "nextReducerRowParsingAuthorized"]) === true;
  const validationPassed = readStringAt(inputs.r744Validation, ["status"]) === "passed";
  const supportClassification = readStringAt(inputs.r744AggregateReport, ["support_classification"]);
  const supportive = contractReady
    && validationPassed
    && supportClassification === "mhas_concordant_supportive_diagnostic_only";

  const output: R980MhasFunctionDisabilityAggregateReducerOutput = {
    aggregateResult: {
      denominatorBands: readStringRecord(inputs.r744AggregateReport, ["denominator_bands"]),
      featureSupportBands: readStringRecord(inputs.r744AggregateReport, ["feature_support_bands"]),
      keyRates: {
        functionBrierBeatsAllShufflesRate:
          readNumberAt(inputs.r744AggregateReport, ["key_rates", "function_brier_beats_all_shuffles_rate"]) ?? 0,
        functionBrierBeatsInterceptRate:
          readNumberAt(inputs.r744AggregateReport, ["key_rates", "function_brier_beats_intercept_rate"]) ?? 0,
        functionBrierBeatsRawRate: readNumberAt(inputs.r744AggregateReport, ["key_rates", "function_brier_beats_raw_rate"]) ?? 0,
        functionBrierBeatsShuffleMedianRate:
          readNumberAt(inputs.r744AggregateReport, ["key_rates", "function_brier_beats_shuffle_median_rate"]) ?? 0,
        functionCBeatsAllShufflesRate:
          readNumberAt(inputs.r744AggregateReport, ["key_rates", "function_c_beats_all_shuffles_rate"]) ?? 0,
        functionCBeatsInterceptRate:
          readNumberAt(inputs.r744AggregateReport, ["key_rates", "function_c_beats_intercept_rate"]) ?? 0,
        functionCBeatsRawRate: readNumberAt(inputs.r744AggregateReport, ["key_rates", "function_c_beats_raw_rate"]) ?? 0,
        functionCBeatsShuffleMedianRate:
          readNumberAt(inputs.r744AggregateReport, ["key_rates", "function_c_beats_shuffle_median_rate"]) ?? 0,
      },
      medianDeltas: {
        functionMinusRawBrier: readMetricRange(inputs.r744AggregateReport, ["delta_summaries", "function_minus_raw_brier"]),
        functionMinusRawC: readMetricRange(inputs.r744AggregateReport, ["delta_summaries", "function_minus_raw_c"]),
        functionMinusShuffleMedianBrier:
          readMetricRange(inputs.r744AggregateReport, ["delta_summaries", "function_minus_shuffle_median_brier"]),
        functionMinusShuffleMedianC:
          readMetricRange(inputs.r744AggregateReport, ["delta_summaries", "function_minus_shuffle_median_c"]),
      },
      repeatCount: readNumberAt(inputs.r744AggregateReport, ["repeat_count"]),
      shuffleCountPerRepeat: readNumberAt(inputs.r744AggregateReport, ["shuffle_count_per_repeat"]),
      supportClassification,
    },
    artifactBoundary: {
      aggregateOnly: true,
      codebookProseStored: false,
      codebookTextStored: false,
      coefficientsStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      modelScoringPerformed: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      rowParsingPerformed: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableNamesStored: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    decision: {
      action: supportive
        ? "preserve_function_disability_candidate_family"
        : "hold_function_disability_candidate_family",
      allowedEffect: "candidate_domain_direction_only",
      productPromotionAuthorized: false,
      rationaleLabels: rationaleLabels({ contractReady, supportClassification, supportive, validationPassed }),
      reviewGptNextUse: "aggregate_delta_interpretation_only",
    },
    executionReceipt: {
      aggregateReportValidationPassed: validationPassed,
      modelPromotionAuthorized: false,
      modelTrainingExecuted: readBooleanAt(inputs.r744AggregateReport, ["status_snapshot", "model_training_executed"]),
      productClaimsCreated: false,
      privateSourceCalibrationExecuted:
        readBooleanAt(inputs.r744AggregateReport, ["status_snapshot", "private_source_calibration_fit_executed"]),
      rowParseExecutedPrivateOnly:
        readBooleanAt(inputs.r744AggregateReport, ["status_snapshot", "row_parse_executed_private_only"]),
    },
    inputArtifacts,
    packetId: "r980-mhas-function-disability-aggregate-reducer",
    schemaVersion: R980_MHAS_FUNCTION_DISABILITY_AGGREGATE_REDUCER_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: supportive
        ? "mhas_function_disability_supportive_diagnostic_only"
        : "mhas_function_disability_hold_diagnostic_only",
      nextLocalAction: "send_aggregate_delta_to_reviewgpt_or_continue_ns_hap_sidecar",
      productDisplayAuthorized: false,
      rowParsingPerformedByReducer: false,
    },
  };

  const findings = findForbiddenAggregateEgress(output);
  if (findings.length > 0) {
    throw new Error(`R980 MHAS function/disability reducer failed aggregate-egress validation: ${findings.join("; ")}`);
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
    r979MhasEndpointJoinContract: summarizeArtifact(
      "r979-mhas-endpoint-join-contract.latest.json",
      R979_SCHEMA_VALUE,
      inputs.r979MhasEndpointJoinContract,
    ),
  };
}

const R979_SCHEMA_VALUE = "murph-age-r979-mhas-endpoint-join-contract.v1";

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

function rationaleLabels(input: {
  contractReady: boolean;
  supportClassification: string | null;
  supportive: boolean;
  validationPassed: boolean;
}): string[] {
  if (input.supportive) {
    return [
      "mhas_contract_ready",
      "aggregate_validation_passed",
      "function_disability_concordant_support",
      "diagnostic_only_no_product_claim",
    ];
  }
  return [
    input.contractReady ? null : "mhas_contract_not_ready",
    input.validationPassed ? null : "aggregate_validation_not_passed",
    input.supportClassification ?? "support_classification_missing",
  ].filter((label): label is string => Boolean(label));
}

function validateInputBoundaries(inputs: Record<ArtifactKey, unknown | null>): void {
  const contract = optionalRecord(inputs.r979MhasEndpointJoinContract);
  if (contract?.artifactBoundary) assertBoundaryFlags(contract.artifactBoundary, "r979 artifact boundary");
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
}

function assertBoundaryFlags(value: unknown, label: string): void {
  const boundary = requiredRecord(value, label);
  for (const key of [
    "codebookProseStored",
    "codebookTextStored",
    "coefficientsStored",
    "localPathsStored",
    "modelParametersStored",
    "modelScoringPerformed",
    "participantIdentifiersStored",
    "participantIdentifiersWritten",
    "predictionsStored",
    "productClaimsIncluded",
    "productDisplayAuthorized",
    "productPromotionAuthorized",
    "rowParsingPerformed",
    "rowValuesStored",
    "smallCellsStored",
    "sourceBodiesStored",
    "splitMembershipStored",
    "variableLabelsStored",
    "variableNamesStored",
  ]) {
    if (boundary[key] !== undefined && boundary[key] !== false) {
      throw new Error(`${label} flag ${key} must be false.`);
    }
  }
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

function readStringRecord(value: unknown, pathParts: readonly string[]): Record<string, string> {
  const record = optionalRecord(readAtPath(value, pathParts));
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, string] =>
      typeof entry[1] === "string" && safeMetadataLabel(entry[0]) && safeMetadataLabel(entry[1])
    ),
  );
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") return null;
    throw new Error("Failed to read an aggregate MHAS function/disability input artifact.");
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
  const valueAtPath = readAtPath(value, pathParts);
  return readOptionalString(valueAtPath);
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
  runR980MhasFunctionDisabilityAggregateReducer({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r744ReportPath: process.env.MURPH_AGE_R744_MHAS_FUNCTION_REPORT_PATH,
    r744ValidationPath: process.env.MURPH_AGE_R744_MHAS_FUNCTION_VALIDATION_PATH,
    r979Path: process.env.MURPH_AGE_R979_MHAS_CONTRACT_PATH,
  }).then(({ output, outputPath }) => {
    const summary = {
      artifact: path.basename(outputPath),
      conclusion: output.summary.conclusion,
      keyRates: output.aggregateResult.keyRates,
      packetId: output.packetId,
      productDisplayAuthorized: output.summary.productDisplayAuthorized,
      rowParsingPerformedByReducer: output.summary.rowParsingPerformedByReducer,
      schemaVersion: output.schemaVersion,
      status: output.status,
      supportClassification: output.aggregateResult.supportClassification,
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "R980 MHAS function/disability aggregate reducer failed.");
    process.exitCode = 1;
  });
}
