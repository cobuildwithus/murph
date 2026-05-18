import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1011_MHAS_FUNCTION_DOMAIN_ATTRIBUTION_SCHEMA_VERSION =
  "murph-age-r1011-mhas-function-domain-attribution.v1" as const;

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
const OUTPUT_FILE_NAME = "r1011-mhas-function-domain-attribution.latest.json";

type ArtifactKey = "r731AggregateReport" | "r1009PanelResult" | "r1010ReviewGptReduction";

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface WeightedMetricSet {
  brier: number | null;
  cStatistic: number | null;
  logLoss: number | null;
  observedExpectedRatio: number | null;
}

interface DomainAttributionRow {
  baseLabel: string;
  functionMinusIntercept: {
    brier: number | null;
    cStatistic: number | null;
    logLoss: number | null;
    observedExpectedAbsDistance: number | null;
  };
  functionMinusShuffle: {
    brier: number | null;
    cStatistic: number | null;
    logLoss: number | null;
  };
  functionWeightedMetrics: WeightedMetricSet;
  verdict:
    | "function_domain_supportive_on_same_denominator"
    | "function_domain_not_confirmed_on_same_denominator";
}

export interface R1011MhasFunctionDomainAttributionOptions {
  createdAt?: string;
  outputDir?: string;
  r1009Path?: string;
  r1010Path?: string;
  r731ReportPath?: string;
}

export interface R1011MhasFunctionDomainAttributionOutput {
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
    rowParsingPerformedByR1011: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceProseStored: false;
    splitMembershipStored: false;
    variableLabelsStored: false;
    variableNamesStored: false;
  };
  consensusContext: {
    r1010Decision: string | null;
    r1010FirstLoop: string | null;
    r1010TrustedReviewerCount: number | null;
  };
  createdAt: string;
  domainAttribution: {
    attributionUse: "research_explanation_only_not_user_facing";
    domainFamily: "function_mobility";
    rows: DomainAttributionRow[];
    supportiveBaseCount: number;
    verdict:
      | "function_mobility_domain_supports_research_sidecar"
      | "function_mobility_domain_attribution_hold";
  };
  inputArtifacts: Record<ArtifactKey, ArtifactSummary>;
  packetId: "r1011-mhas-function-domain-attribution";
  productPolicy: {
    displayAuthorized: false;
    promotionAuthorized: false;
    productClaimsAuthorized: false;
  };
  schemaVersion: typeof R1011_MHAS_FUNCTION_DOMAIN_ATTRIBUTION_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion:
      | "mhas_function_domain_attribution_supportive"
      | "mhas_function_domain_attribution_not_confirmed";
    nextLocalAction:
      | "use_as_mhas_domain_attribution_receipt_then_unlock_nshap_if_user_confirms_source_labels"
      | "return_to_candidate_family_search";
    productDisplayAuthorized: false;
    rowParsingPerformedByR1011: false;
  };
}

interface Inputs {
  r1009PanelResult: unknown | null;
  r1010ReviewGptReduction: unknown | null;
  r731AggregateReport: unknown | null;
}

export async function runR1011MhasFunctionDomainAttribution(
  options: R1011MhasFunctionDomainAttributionOptions = {},
): Promise<{ output: R1011MhasFunctionDomainAttributionOutput; outputPath: string }> {
  const inputs = await readInputs(options);
  validateInputs(inputs);

  const rows = buildDomainRows(inputs.r731AggregateReport);
  const supportiveBaseCount = rows.filter((row) => row.verdict === "function_domain_supportive_on_same_denominator").length;
  const supportive = rows.length > 0
    && supportiveBaseCount === rows.length
    && readStringAt(inputs.r1009PanelResult, ["summary", "conclusion"]) === "mhas_function_panel_extension_supports_lead_sidecar";

  const output: R1011MhasFunctionDomainAttributionOutput = {
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
      rowParsingPerformedByR1011: false,
      rowValuesStored: false,
      smallCellsStored: false,
      sourceBodiesStored: false,
      sourceProseStored: false,
      splitMembershipStored: false,
      variableLabelsStored: false,
      variableNamesStored: false,
    },
    consensusContext: {
      r1010Decision: readStringAt(inputs.r1010ReviewGptReduction, ["consensus", "decision"]),
      r1010FirstLoop: readStringAt(inputs.r1010ReviewGptReduction, ["consensus", "first_loop"]),
      r1010TrustedReviewerCount: readNumberAt(inputs.r1010ReviewGptReduction, ["counts", "trusted"]),
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    domainAttribution: {
      attributionUse: "research_explanation_only_not_user_facing",
      domainFamily: "function_mobility",
      rows,
      supportiveBaseCount,
      verdict: supportive
        ? "function_mobility_domain_supports_research_sidecar"
        : "function_mobility_domain_attribution_hold",
    },
    inputArtifacts: summarizeInputs(inputs),
    packetId: "r1011-mhas-function-domain-attribution",
    productPolicy: {
      displayAuthorized: false,
      promotionAuthorized: false,
      productClaimsAuthorized: false,
    },
    schemaVersion: R1011_MHAS_FUNCTION_DOMAIN_ATTRIBUTION_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion: supportive
        ? "mhas_function_domain_attribution_supportive"
        : "mhas_function_domain_attribution_not_confirmed",
      nextLocalAction: supportive
        ? "use_as_mhas_domain_attribution_receipt_then_unlock_nshap_if_user_confirms_source_labels"
        : "return_to_candidate_family_search",
      productDisplayAuthorized: false,
      rowParsingPerformedByR1011: false,
    },
  };

  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...findForbiddenR1011Output(output),
  ];
  if (findings.length > 0) {
    throw new Error(`R1011 MHAS function domain attribution failed aggregate-egress validation: ${findings.join("; ")}`);
  }

  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  return { output, outputPath };
}

async function readInputs(options: R1011MhasFunctionDomainAttributionOptions): Promise<Inputs> {
  return {
    r1009PanelResult: await readJsonIfPresent(
      options.r1009Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, "r1009-mhas-function-panel-extension-result.latest.json"),
    ),
    r1010ReviewGptReduction: await readJsonIfPresent(
      options.r1010Path ?? path.join(DEFAULT_REVIEWGPT_REDUCED_DIR, "r1010-mhas-function-panel-result-direction-summary.json"),
    ),
    r731AggregateReport: await readJsonIfPresent(
      options.r731ReportPath ?? path.join(DEFAULT_R731_RUN_DIR, "mhas-function-mobility-transport-diagnostic-r731.json"),
    ),
  };
}

function validateInputs(inputs: Inputs): void {
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) continue;
    const findings = findForbiddenAggregateEgress(value);
    if (findings.length > 0) {
      throw new Error(`R1011 input ${key} failed aggregate boundary validation: ${findings.join("; ")}`);
    }
  }
}

function buildDomainRows(report: unknown | null): DomainAttributionRow[] {
  const resultRows = readArrayAt(report, ["holdout_results"]).map(optionalRecord).filter(Boolean) as Record<string, unknown>[];
  const deltas = readArrayAt(report, ["rankings", "method_deltas_vs_intercept"])
    .map(optionalRecord)
    .filter(Boolean) as Record<string, unknown>[];
  const baseLabels = Array.from(new Set(
    resultRows
      .map((row) => sanitizeLabel(readStringAt(row, ["base_id"])))
      .filter(Boolean),
  ));
  return baseLabels.map((baseLabel) => {
    const functionRow = findMethodRow(resultRows, baseLabel, "function_mobility_additive_diagnostic");
    const interceptRow = findMethodRow(resultRows, baseLabel, "source_intercept_only_same_denominator");
    const shuffleRow = findMethodRow(resultRows, baseLabel, "shuffled_function_negative_control");
    const functionDelta = findMethodRow(deltas, baseLabel, "function_mobility_additive_diagnostic");
    const functionMetrics = readWeightedMetrics(functionRow);
    const interceptMetrics = readWeightedMetrics(interceptRow);
    const shuffleMetrics = readWeightedMetrics(shuffleRow);
    const functionMinusIntercept = {
      brier: diff(functionMetrics.brier, interceptMetrics.brier),
      cStatistic: diff(functionMetrics.cStatistic, interceptMetrics.cStatistic),
      logLoss: diff(functionMetrics.logLoss, interceptMetrics.logLoss),
      observedExpectedAbsDistance:
        readNumberAt(functionDelta, ["observed_expected_abs_distance_delta_vs_intercept"]),
    };
    const functionMinusShuffle = {
      brier: diff(functionMetrics.brier, shuffleMetrics.brier),
      cStatistic: diff(functionMetrics.cStatistic, shuffleMetrics.cStatistic),
      logLoss: diff(functionMetrics.logLoss, shuffleMetrics.logLoss),
    };
    const supportive =
      (functionMinusIntercept.brier ?? 1) < 0
      && (functionMinusIntercept.logLoss ?? 1) < 0
      && (functionMinusIntercept.cStatistic ?? -1) > 0
      && (functionMinusShuffle.brier ?? 1) < 0
      && (functionMinusShuffle.logLoss ?? 1) < 0
      && (functionMinusShuffle.cStatistic ?? -1) > 0;
    return {
      baseLabel,
      functionMinusIntercept,
      functionMinusShuffle,
      functionWeightedMetrics: functionMetrics,
      verdict: supportive
        ? "function_domain_supportive_on_same_denominator"
        : "function_domain_not_confirmed_on_same_denominator",
    };
  });
}

function readWeightedMetrics(row: Record<string, unknown> | null): WeightedMetricSet {
  return {
    brier: readNumberAt(row, ["weighted_holdout_metrics", "brier_score"]),
    cStatistic: readNumberAt(row, ["weighted_holdout_metrics", "c_statistic"]),
    logLoss: readNumberAt(row, ["weighted_holdout_metrics", "log_loss"]),
    observedExpectedRatio: readNumberAt(row, ["weighted_holdout_metrics", "observed_expected_ratio"]),
  };
}

function findMethodRow(rows: Record<string, unknown>[], baseLabel: string, methodLabel: string): Record<string, unknown> | null {
  return rows.find((row) =>
    sanitizeLabel(readStringAt(row, ["base_id"])) === baseLabel
    && sanitizeLabel(readStringAt(row, ["method_id"])) === methodLabel
  ) ?? null;
}

function diff(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : left - right;
}

function summarizeInputs(inputs: Inputs): Record<ArtifactKey, ArtifactSummary> {
  return {
    r1009PanelResult: summarizeArtifact("r1009PanelResult", inputs.r1009PanelResult),
    r1010ReviewGptReduction: summarizeArtifact("r1010ReviewGptReduction", inputs.r1010ReviewGptReduction),
    r731AggregateReport: summarizeArtifact("r731AggregateReport", inputs.r731AggregateReport),
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

function findForbiddenR1011Output(output: R1011MhasFunctionDomainAttributionOutput): string[] {
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
  const { output } = await runR1011MhasFunctionDomainAttribution({
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1009Path: process.env.MURPH_AGE_R1009_MHAS_FUNCTION_PANEL_RESULT_PATH,
    r1010Path: process.env.MURPH_AGE_R1010_MHAS_FUNCTION_PANEL_REVIEWGPT_REDUCTION_PATH,
    r731ReportPath: process.env.MURPH_AGE_R731_MHAS_FUNCTION_PANEL_REPORT_PATH,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    domainFamily: output.domainAttribution.domainFamily,
    nextLocalAction: output.summary.nextLocalAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.summary.productDisplayAuthorized,
    rowParsingPerformedByR1011: output.summary.rowParsingPerformedByR1011,
    schemaVersion: output.schemaVersion,
    status: output.status,
    supportiveBaseCount: output.domainAttribution.supportiveBaseCount,
    verdict: output.domainAttribution.verdict,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "R1011 MHAS function domain attribution failed."}\n`);
    process.exit(1);
  });
}
