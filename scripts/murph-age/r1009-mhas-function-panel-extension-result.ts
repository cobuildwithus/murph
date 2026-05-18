import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1009_MHAS_FUNCTION_PANEL_EXTENSION_RESULT_SCHEMA_VERSION =
  "murph-age-r1009-mhas-function-panel-extension-result.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const DEFAULT_REVIEWGPT_REDUCED_DIR = path.join(
  "output-packages",
  "research",
  "murph-age",
  "autoresearch",
  "reviewgpt",
  "reduced",
);
const DEFAULT_R731_RUN_DIR = path.join(
  "output-packages",
  "research",
  "murph-age",
  "autoresearch",
  "loop",
  "runs",
  "session_murph_age_r731_mhas_function_mobility_transport_diagnostic",
);
const OUTPUT_FILE_NAME = "r1009-mhas-function-panel-extension-result.latest.json";

type ArtifactKey =
  | "r731AggregateReport"
  | "r731Validation"
  | "r1007AggregateReceipt"
  | "r1008ReviewGptReduction";

type MetricKey =
  | "brierDeltaVsIntercept"
  | "cStatisticDeltaVsIntercept"
  | "observedExpectedAbsDistanceDeltaVsIntercept";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface MethodDelta {
  baseLabel: string;
  brierDeltaVsIntercept: number | null;
  cStatisticDeltaVsIntercept: number | null;
  methodLabel: string;
  observedExpectedAbsDistanceDeltaVsIntercept: number | null;
}

interface TopRankedMethod {
  brierScore: number | null;
  methodLabel: string | null;
  rank: number | null;
}

export interface R1009MhasFunctionPanelExtensionResultOptions {
  createdAt?: string;
  outputDir?: string;
  r1007Path?: string;
  r1008Path?: string;
  r731ReportPath?: string;
  r731ValidationPath?: string;
}

export interface R1009MhasFunctionPanelExtensionResultOutput {
  artifactBoundary: {
    aggregateOnly: true;
    codebookProseStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    localFileNamesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    modelPromotionAuthorized: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1009: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceProseStored: false;
    splitMembershipStored: false;
    variableLabelsStored: false;
    variableNamesStored: false;
  };
  consensusContext: {
    decision: string | null;
    firstLoop: string | null;
    functionSidecarStatus: string | null;
    trustedReviewerCount: number | null;
  };
  createdAt: string;
  executionEvidence: {
    aggregateValidationPassed: boolean;
    externalScoringExecutedInPriorLoop: boolean | null;
    modelMutationExecutedInPriorLoop: boolean | null;
    modelPromotionAuthorized: false;
    privateAdditiveFitExecutedInPriorLoop: boolean | null;
    productClaimsCreated: false;
    rowParseExecutedPrivateOnlyInPriorLoop: boolean | null;
  };
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  packetId: "r1009-mhas-function-panel-extension-result";
  panelExtensionResult: {
    baseLabelCount: number;
    functionDeltaByBase: MethodDelta[];
    functionSupportVerdict:
      | "function_panel_extension_supportive_diagnostic_only"
      | "function_panel_extension_hold";
    negativeControlVerdict:
      | "function_beats_shuffled_negative_control"
      | "negative_control_not_beaten_or_missing";
    resultCount: number | null;
    topWeightedBrierMethod: TopRankedMethod;
  };
  productPolicy: {
    displayAuthorized: false;
    promotionAuthorized: false;
    productClaimsAuthorized: false;
  };
  schemaVersion: typeof R1009_MHAS_FUNCTION_PANEL_EXTENSION_RESULT_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "mhas_function_panel_extension_supports_lead_sidecar"
      | "mhas_function_panel_extension_not_confirmed";
    nextLocalAction:
      | "send_mhas_function_panel_result_to_reviewgpt_for_model_direction"
      | "return_to_candidate_family_search";
    productDisplayAuthorized: false;
    reviewGptNextUse: "aggregate_result_interpretation_and_next_model_direction";
    rowParsingPerformedByR1009: false;
  };
}

interface Inputs {
  r1007AggregateReceipt: unknown | null;
  r1008ReviewGptReduction: unknown | null;
  r731AggregateReport: unknown | null;
  r731Validation: unknown | null;
}

export async function runR1009MhasFunctionPanelExtensionResult(
  options: R1009MhasFunctionPanelExtensionResultOptions = {},
): Promise<{ output: R1009MhasFunctionPanelExtensionResultOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputs(inputs);

  const validationPassed = readStringAt(inputs.r731Validation, ["status"]) === "passed";
  const consensusDecision = readStringAt(inputs.r1008ReviewGptReduction, ["consensus", "decision"]);
  const readoutReady =
    readStringAt(inputs.r1007AggregateReceipt, ["summary", "conclusion"])
      === "mhas_panel_extension_existing_private_states_support_runner_reuse";
  const functionDeltas = readFunctionDeltas(inputs.r731AggregateReport);
  const shuffledDeltas = readShuffledDeltas(inputs.r731AggregateReport);
  const topWeightedBrierMethod = readTopWeightedBrierMethod(inputs.r731AggregateReport);
  const allFunctionDeltasSupport = functionDeltas.length > 0
    && functionDeltas.every((delta) =>
      (delta.brierDeltaVsIntercept ?? 1) < 0
      && (delta.cStatisticDeltaVsIntercept ?? -1) > 0
    );
  const negativeControlBeaten = functionDeltas.length > 0
    && shuffledDeltas.length > 0
    && functionDeltas.every((delta) => {
      const matchingShuffle = shuffledDeltas.find((candidate) => candidate.baseLabel === delta.baseLabel);
      return Boolean(matchingShuffle)
        && (delta.brierDeltaVsIntercept ?? 1) < (matchingShuffle?.brierDeltaVsIntercept ?? -1)
        && (delta.cStatisticDeltaVsIntercept ?? -1) > (matchingShuffle?.cStatisticDeltaVsIntercept ?? 1);
    });
  const topMethodIsFunction = topWeightedBrierMethod.methodLabel === "function_mobility_additive_diagnostic";
  const supportive = validationPassed
    && readoutReady
    && consensusDecision === "run_mhas_function_panel_extension"
    && allFunctionDeltasSupport
    && negativeControlBeaten
    && topMethodIsFunction;

  const output: R1009MhasFunctionPanelExtensionResultOutput = {
    artifactBoundary: {
      aggregateOnly: true,
      codebookProseStored: false,
      codebookTextStored: false,
      coefficientsStored: false,
      localFileNamesStored: false,
      localPathsStored: false,
      modelParametersStored: false,
      modelPromotionAuthorized: false,
      participantIdentifiersStored: false,
      participantIdentifiersWritten: false,
      predictionsStored: false,
      productClaimsIncluded: false,
      productDisplayAuthorized: false,
      productPromotionAuthorized: false,
      recommendationClaimsIncluded: false,
      rowParsingPerformedByR1009: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceProseStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableNamesStored: false,
    },
    consensusContext: {
      decision: consensusDecision,
      firstLoop: readStringAt(inputs.r1008ReviewGptReduction, ["consensus", "first_loop"]),
      functionSidecarStatus: readStringAt(inputs.r1008ReviewGptReduction, ["consensus", "function_sidecar_status"]),
      trustedReviewerCount: readNumberAt(inputs.r1008ReviewGptReduction, ["counts", "trusted"]),
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    executionEvidence: {
      aggregateValidationPassed: validationPassed,
      externalScoringExecutedInPriorLoop: readBooleanAt(inputs.r731AggregateReport, ["status_snapshot", "external_scoring_executed"]),
      modelMutationExecutedInPriorLoop: readBooleanAt(inputs.r731AggregateReport, ["status_snapshot", "model_mutation_executed"]),
      modelPromotionAuthorized: false,
      privateAdditiveFitExecutedInPriorLoop: readBooleanAt(inputs.r731AggregateReport, ["status_snapshot", "private_additive_fit_executed"]),
      productClaimsCreated: false,
      rowParseExecutedPrivateOnlyInPriorLoop:
        readBooleanAt(inputs.r731AggregateReport, ["status_snapshot", "source_row_parse_executed_private_only"]),
    },
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1009-mhas-function-panel-extension-result",
    panelExtensionResult: {
      baseLabelCount: new Set(functionDeltas.map((delta) => delta.baseLabel)).size,
      functionDeltaByBase: functionDeltas,
      functionSupportVerdict: supportive
        ? "function_panel_extension_supportive_diagnostic_only"
        : "function_panel_extension_hold",
      negativeControlVerdict: negativeControlBeaten
        ? "function_beats_shuffled_negative_control"
        : "negative_control_not_beaten_or_missing",
      resultCount: readNumberAt(inputs.r731AggregateReport, ["result_count"]),
      topWeightedBrierMethod,
    },
    productPolicy: {
      displayAuthorized: false,
      promotionAuthorized: false,
      productClaimsAuthorized: false,
    },
    schemaVersion: R1009_MHAS_FUNCTION_PANEL_EXTENSION_RESULT_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: supportive
        ? "mhas_function_panel_extension_supports_lead_sidecar"
        : "mhas_function_panel_extension_not_confirmed",
      nextLocalAction: supportive
        ? "send_mhas_function_panel_result_to_reviewgpt_for_model_direction"
        : "return_to_candidate_family_search",
      productDisplayAuthorized: false,
      reviewGptNextUse: "aggregate_result_interpretation_and_next_model_direction",
      rowParsingPerformedByR1009: false,
    },
  };

  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findForbiddenR1009Output(output),
  ];
  if (findings.length > 0) {
    throw new Error(`R1009 MHAS function panel extension result failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(options: R1009MhasFunctionPanelExtensionResultOptions): Promise<Inputs> {
  return {
    r1007AggregateReceipt: await readJsonIfPresent(
      options.r1007Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1007-mhas-panel-extension-aggregate-receipt.latest.json"),
    ),
    r1008ReviewGptReduction: await readJsonIfPresent(
      options.r1008Path ?? path.join(DEFAULT_REVIEWGPT_REDUCED_DIR, "r1008-mhas-panel-readout-direction-summary.json"),
    ),
    r731AggregateReport: await readJsonIfPresent(
      options.r731ReportPath ?? path.join(DEFAULT_R731_RUN_DIR, "mhas-function-mobility-transport-diagnostic-r731.json"),
    ),
    r731Validation: await readJsonIfPresent(
      options.r731ValidationPath ?? path.join(DEFAULT_R731_RUN_DIR, "mhas-function-mobility-transport-diagnostic-validation-r731.json"),
    ),
  };
}

function validateInputs(inputs: Inputs): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1009 input ${key} failed aggregate boundary validation: ${findings.join("; ")}`);
    }
  }

  const storage = optionalRecord(optionalRecord(inputs.r731AggregateReport)?.storage_attestation);
  if (storage) {
    for (const key of [
      "source_bodies_stored",
      "codebook_prose_stored",
      "terms_text_stored",
      "file_names_stored",
      "absolute_paths_stored",
      "source_field_names_stored",
      "credentials_stored",
      "row_values_stored",
      "row_level_predictions_stored",
      "predictions_exported",
      "identifiers_stored",
      "split_memberships_stored",
      "fit_params_exported",
      "model_artifact_values_stored",
      "small_cells_stored",
      "model_refit_executed",
      "model_mutation_executed",
      "model_promotion_authorized",
      "product_claims_created",
      "clinical_claims_created",
      "recommendation_claims_created",
      "protocol_claims_created",
    ]) {
      if (storage[key] !== false) throw new Error(`R731 storage attestation flag ${key} must be false.`);
    }
  }
}

function summarizeInputs(inputs: Inputs): Record<ArtifactKey, ArtifactSummary> {
  return {
    r1007AggregateReceipt: summarizeArtifact("r1007AggregateReceipt", inputs.r1007AggregateReceipt),
    r1008ReviewGptReduction: summarizeArtifact("r1008ReviewGptReduction", inputs.r1008ReviewGptReduction),
    r731AggregateReport: summarizeArtifact("r731AggregateReport", inputs.r731AggregateReport),
    r731Validation: summarizeArtifact("r731Validation", inputs.r731Validation),
  };
}

function summarizeArtifact(artifact: string, value: unknown | null): ArtifactSummary {
  const root = optionalRecord(value);
  return {
    artifact,
    packetId: readStringAt(root, ["packetId"]) ?? readStringAt(root, ["run_id"]) ?? null,
    schemaVersion: readStringAt(root, ["schemaVersion"]) ?? readStringAt(root, ["schema_version"]) ?? null,
    status: root ? "available" : "missing",
  };
}

function readFunctionDeltas(value: unknown | null): MethodDelta[] {
  return readMethodDeltas(value, "function_mobility_additive_diagnostic");
}

function readShuffledDeltas(value: unknown | null): MethodDelta[] {
  return readMethodDeltas(value, "shuffled_function_negative_control");
}

function readMethodDeltas(value: unknown | null, methodId: string): MethodDelta[] {
  const rows = readArrayAt(value, ["rankings", "method_deltas_vs_intercept"]);
  return rows
    .map((row) => optionalRecord(row))
    .filter((row): row is Record<string, unknown> =>
      row !== null && readStringAt(row, ["method_id"]) === methodId
    )
    .map((row) => ({
      baseLabel: sanitizeLabel(readStringAt(row, ["base_id"])),
      brierDeltaVsIntercept: readNumberAt(row, ["brier_delta_vs_intercept"]),
      cStatisticDeltaVsIntercept: readNumberAt(row, ["c_statistic_delta_vs_intercept"]),
      methodLabel: sanitizeLabel(readStringAt(row, ["method_id"])),
      observedExpectedAbsDistanceDeltaVsIntercept:
        readNumberAt(row, ["observed_expected_abs_distance_delta_vs_intercept"]),
    }))
    .filter((row) => row.baseLabel.length > 0 && row.methodLabel.length > 0);
}

function readTopWeightedBrierMethod(value: unknown | null): TopRankedMethod {
  const rows = readArrayAt(value, ["rankings", "by_weighted_holdout_brier"]);
  const top = rows
    .map((row) => optionalRecord(row))
    .find((row): row is Record<string, unknown> => row !== null && readNumberAt(row, ["rank"]) === 1);
  return {
    brierScore: readNumberAt(top, ["brier_score"]),
    methodLabel: sanitizeLabel(readStringAt(top, ["method_id"])) || null,
    rank: readNumberAt(top, ["rank"]),
  };
}

function sanitizeLabel(value: string | null): string {
  if (!value) return "";
  const normalized = value.trim();
  if (!/^[a-z][a-z0-9_]{2,80}$/u.test(normalized)) return "";
  if (/(?:path|file|source_text|field|variable|column|row|id_value|prediction|coefficient|param)/iu.test(normalized)) {
    return "";
  }
  return normalized;
}

function readArrayAt(value: unknown | null, keys: string[]): unknown[] {
  const current = readAt(value, keys);
  return Array.isArray(current) ? current : [];
}

function readBooleanAt(value: unknown | null, keys: string[]): boolean | null {
  const current = readAt(value, keys);
  return typeof current === "boolean" ? current : null;
}

function readNumberAt(value: unknown | null, keys: string[]): number | null {
  const current = readAt(value, keys);
  return typeof current === "number" && Number.isFinite(current) ? current : null;
}

function readStringAt(value: unknown | null, keys: string[]): string | null {
  const current = readAt(value, keys);
  return typeof current === "string" && current.length > 0 ? current : null;
}

function readAt(value: unknown | null, keys: string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    const record = optionalRecord(current);
    if (!record) return null;
    current = record[key];
  }
  return current;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function findForbiddenR1009Output(output: R1009MhasFunctionPanelExtensionResultOutput): string[] {
  const encoded = JSON.stringify(output);
  const findings: string[] = [];
  if (/[A-Za-z]:[\\/]|(?:^|")\/(?:Users|home|tmp|var)\//u.test(encoded)) {
    findings.push("output contains path-like local text");
  }
  if (/Downloads|external-sources|cache-entry|\.dta|\.zip|\.rar|sect_|latest\.json/u.test(encoded)) {
    findings.push("output contains local file-name or cache text");
  }
  if (/field_names_private|fit_params_private_only|calibration_params_private_only|model_artifact_manifest_private/u.test(encoded)) {
    findings.push("output contains private-state implementation fields");
  }
  return findings;
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const { output } = await runR1009MhasFunctionPanelExtensionResult({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1007Path: process.env.MURPH_AGE_R1007_MHAS_PANEL_AGGREGATE_RECEIPT_PATH,
    r1008Path: process.env.MURPH_AGE_R1008_MHAS_PANEL_REVIEWGPT_REDUCTION_PATH,
    r731ReportPath: process.env.MURPH_AGE_R731_MHAS_FUNCTION_PANEL_REPORT_PATH,
    r731ValidationPath: process.env.MURPH_AGE_R731_MHAS_FUNCTION_PANEL_VALIDATION_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    functionSupportVerdict: output.panelExtensionResult.functionSupportVerdict,
    negativeControlVerdict: output.panelExtensionResult.negativeControlVerdict,
    nextLocalAction: output.summary.nextLocalAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    rowParsingPerformedByR1009: output.summary.rowParsingPerformedByR1009,
    schemaVersion: output.schemaVersion,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1009 MHAS function panel extension result failed."}\n`);
    process.exit(1);
  });
}
