import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R399_LAYERING_READINESS_SCHEMA_VERSION =
  "murph-age-r399-layering-readiness.v1" as const;

const DEFAULT_R399_PARAMS_PATH = path.join(
  ".runtime",
  "cache",
  "murph-age",
  "external-sources",
  "nhis-public-lmf",
  "ml-loop",
  "runs",
  "session_murph_age_r399_nhis_compact_ultralow_l2_loop",
  "local-model-params-r399.json",
);
const DEFAULT_MODEL_RUNS_DIR = path.join(".runtime", "operations", "research", "murph-age", "model-runs");
const DEFAULT_MIDUS2_OUTPUT_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "midus2-local-benchmark.latest.json");
const DEFAULT_CRELES_OUTPUT_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "creles-local-benchmark.latest.json");
const DEFAULT_TRANSPORT_OUTPUT_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "midus2-creles-transport-benchmark.latest.json");

const FROZEN_R399_MODEL_ID = "r399_compact_age_nonlinear_l2_0p000";
const R399_RESEARCH_CARD_ID = "r399_nhis_proxy_10y_acm_research";
const FROZEN_R399_FEATURE_KEY_ALLOWLIST = new Set<string>([
  "age_years",
  "sex_female",
  "body_mass_index",
  "self_rated_health",
  "hypertension_history_proxy_yes",
  "diabetes_history_proxy_yes",
  "smoking_status_proxy",
  "physical_activity_proxy",
  "body_mass_index_missing",
  "self_rated_health_missing",
  "hypertension_history_proxy_missing",
  "diabetes_history_proxy_missing",
  "smoking_status_proxy_missing",
  "physical_activity_proxy_missing",
  "age_years_squared",
  "age_x_sex_female",
] as const);
const FROZEN_R399_FEATURE_FAMILIES = [
  "chronological-age",
  "sex",
  "body",
  "self-rated-health",
  "disease-history-proxy",
  "smoking-proxy",
  "activity-proxy",
  "missingness-indicators",
  "age-nonlinearity",
] as const;
const PRODUCT_BLOCKER_REASONS = [
  "R399 is not a committed score-bearing model card in the current calculator.",
  "R399 uses NHIS proxy features; user-input mapping for self-rated health, smoking, diagnoses, and activity proxy is not locked.",
  "The MIDUS-to-CRELES biomarker transport diagnostic has not confirmed a stable additive biomarker increment over the target age/sex reference.",
  "Wearable features remain shadow/context-only and have no score-bearing residual-increment estimate.",
] as const;

type EvidenceVerdict =
  | "missing"
  | "not_applicable"
  | "not_promotable"
  | "promising_internal_only"
  | "transport_confirmed";

type GateStatus = "blocked" | "passed";

export interface R399LayeringReadinessOptions {
  createdAt?: string;
  crelesOutputPath?: string;
  midus2OutputPath?: string;
  outputDir?: string;
  r399ParamsPath?: string;
  transportOutputPath?: string;
}

export interface R399LayeringMetricDelta {
  aucDelta: number | null;
  brierDelta: number | null;
  logLossDelta: number | null;
  modelId: string;
  referenceModelId: string;
}

export interface R399LayeringEvidenceSummary {
  comparison?: R399LayeringMetricDelta;
  evidenceClass: "internal-biomarker" | "same-source-target" | "cross-cohort-transport";
  present: boolean;
  sourceId: string;
  summary: string;
  verdict: EvidenceVerdict;
}

export interface R399LayeringReadinessOutput {
  anchor: {
    coefficientCountStored: false;
    committedCalculatorCardPresent: boolean;
    featureFamilies: string[];
    featureCount: number | null;
    modelId: typeof FROZEN_R399_MODEL_ID;
    modelParametersStored: false;
    present: boolean;
    privateRuntimeParamsRequired: true;
    referencePopulation: "NHIS 1997-2009 linked mortality";
  };
  blockedReasons: string[];
  codebookTextStored: false;
  coefficientsStored: false;
  createdAt: string;
  evidence: {
    biomarkerIncrement: R399LayeringEvidenceSummary[];
    wearableIncrement: R399LayeringEvidenceSummary;
  };
  gates: Record<
    | "biomarkerTransportConfirmed"
    | "calculatorScorePathReady"
    | "productPromotionReady"
    | "r399AnchorPresent"
    | "wearableIncrementValidated",
    { reason: string; status: GateStatus }
  >;
  localPathsStored: false;
  modelParametersStored: false;
  participantIdentifiersStored: false;
  predictionsStored: false;
  productPromotionAuthorized: false;
  recommendations: string[];
  rowValuesStored: false;
  schemaVersion: typeof R399_LAYERING_READINESS_SCHEMA_VERSION;
  sourceBodiesStored: false;
  splitMembershipStored: false;
  status: "research-local-aggregate-only";
}

interface AggregateMetrics {
  auc: number | null;
  brier: number;
  logLoss: number;
}

interface R399ModelMetadata {
  featureKeys: string[];
  present: boolean;
}

export async function runR399LayeringReadiness(
  options: R399LayeringReadinessOptions = {},
): Promise<{ output: R399LayeringReadinessOutput; outputPath: string }> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const [r399Metadata, midus2, creles, transport] = await Promise.all([
    readR399ModelMetadata(options.r399ParamsPath ?? DEFAULT_R399_PARAMS_PATH),
    readOptionalJson(options.midus2OutputPath ?? DEFAULT_MIDUS2_OUTPUT_PATH),
    readOptionalJson(options.crelesOutputPath ?? DEFAULT_CRELES_OUTPUT_PATH),
    readOptionalJson(options.transportOutputPath ?? DEFAULT_TRANSPORT_OUTPUT_PATH),
  ]);

  const committedCalculatorCardPresent = false;
  const biomarkerIncrement = [
    summarizeMidus2Increment(midus2),
    summarizeCrelesIncrement(creles),
    summarizeMidus2ToCrelesTransport(transport),
  ];
  const transportConfirmed = biomarkerIncrement.some((evidence) =>
    evidence.verdict === "transport_confirmed"
  );
  const wearableIncrement: R399LayeringEvidenceSummary = {
    evidenceClass: "same-source-target",
    present: false,
    sourceId: "wearable-shadow-increment",
    summary: "Wearables are currently collected as context/shadow-readiness only; no score-bearing residual increment has been validated.",
    verdict: "missing",
  };

  const gates: R399LayeringReadinessOutput["gates"] = {
    r399AnchorPresent: {
      reason: r399Metadata.present
        ? "Frozen R399 private-runtime parameter artifact is available locally."
        : "Frozen R399 private-runtime parameter artifact is missing.",
      status: r399Metadata.present ? "passed" : "blocked",
    },
    calculatorScorePathReady: {
      reason: committedCalculatorCardPresent
        ? "A committed R399 research model-card policy is present."
        : `No committed ${R399_RESEARCH_CARD_ID} model-card policy is present; current calculator policies cover lab5/lab9 research cards and context-only wearable/function cards.`,
      status: committedCalculatorCardPresent ? "passed" : "blocked",
    },
    biomarkerTransportConfirmed: {
      reason: transportConfirmed
        ? "At least one biomarker increment has cleared the cross-cohort transport threshold."
        : "Current MIDUS/CRELES biomarker evidence is internal or transport-not-confirmed.",
      status: transportConfirmed ? "passed" : "blocked",
    },
    wearableIncrementValidated: {
      reason: "Wearable metrics remain shadow/context-only and are not score-bearing.",
      status: "blocked",
    },
    productPromotionReady: {
      reason: "Murph Age remains research-only until anchor score path, biomarker transport, wearable increment, and product translation gates pass together.",
      status: "blocked",
    },
  };

  const blockedReasons = [
    ...PRODUCT_BLOCKER_REASONS,
    ...Object.entries(gates)
      .filter(([, gate]) => gate.status === "blocked")
      .map(([gateId, gate]) => `${gateId}: ${gate.reason}`),
  ];

  const output: R399LayeringReadinessOutput = {
    anchor: {
      coefficientCountStored: false,
      committedCalculatorCardPresent,
      featureFamilies: r399Metadata.present ? [...FROZEN_R399_FEATURE_FAMILIES] : [],
      featureCount: r399Metadata.present ? r399Metadata.featureKeys.length : null,
      modelId: FROZEN_R399_MODEL_ID,
      modelParametersStored: false,
      present: r399Metadata.present,
      privateRuntimeParamsRequired: true,
      referencePopulation: "NHIS 1997-2009 linked mortality",
    },
    blockedReasons,
    codebookTextStored: false,
    coefficientsStored: false,
    createdAt: options.createdAt ?? new Date().toISOString(),
    evidence: {
      biomarkerIncrement,
      wearableIncrement,
    },
    gates,
    localPathsStored: false,
    modelParametersStored: false,
    participantIdentifiersStored: false,
    predictionsStored: false,
    productPromotionAuthorized: false,
    recommendations: buildRecommendations({ committedCalculatorCardPresent, r399Present: r399Metadata.present, transportConfirmed }),
    rowValuesStored: false,
    schemaVersion: R399_LAYERING_READINESS_SCHEMA_VERSION,
    sourceBodiesStored: false,
    splitMembershipStored: false,
    status: "research-local-aggregate-only",
  };

  const egressFindings = findForbiddenAggregateEgress(output);
  if (egressFindings.length > 0) {
    throw new Error(`R399 layering readiness output failed aggregate-egress validation: ${egressFindings.join("; ")}`);
  }

  const outputPath = await writeReadinessOutput(outputDir, output);
  return { output, outputPath };
}

function summarizeMidus2Increment(value: unknown): R399LayeringEvidenceSummary {
  const models = optionalRecord(optionalRecord(value)?.models);
  const reference = aggregateMetricsAt(models?.age_sex_reference, ["splitMetrics", "test"]);
  const candidate = aggregateMetricsAt(models?.lab5_lipid_body_no_crp, ["splitMetrics", "test"]);
  if (!reference || !candidate) {
    return missingEvidence("midus2-lab5-internal", "internal-biomarker", "MIDUS 2 aggregate lab5/internal benchmark output is missing or incomplete.");
  }
  const comparison = metricDelta("lab5_lipid_body_no_crp", "age_sex_reference", candidate, reference);
  const promising = isPositiveInternalDelta(comparison);
  return {
    comparison,
    evidenceClass: "internal-biomarker",
    present: true,
    sourceId: "midus2-lab5-internal",
    summary: promising
      ? "MIDUS 2 lab5 biomarker candidate improves aggregate test discrimination or proper scores over the MIDUS age/sex reference, but this is internal evidence only."
      : "MIDUS 2 lab5 biomarker candidate does not clearly improve aggregate test metrics over the MIDUS age/sex reference.",
    verdict: promising ? "promising_internal_only" : "not_promotable",
  };
}

function summarizeCrelesIncrement(value: unknown): R399LayeringEvidenceSummary {
  const models = optionalRecord(optionalRecord(value)?.models);
  const reference = aggregateMetricsAt(models?.age_sex_reference, ["splitMetrics", "test"]);
  const candidate = aggregateMetricsAt(models?.lab5_lipid_body_no_crp, ["splitMetrics", "test"]);
  if (!reference || !candidate) {
    return missingEvidence("creles-lab5-local", "same-source-target", "CRELES aggregate lab5/local benchmark output is missing or incomplete.");
  }
  const comparison = metricDelta("lab5_lipid_body_no_crp", "age_sex_reference", candidate, reference);
  const promising = isPositiveInternalDelta(comparison);
  return {
    comparison,
    evidenceClass: "same-source-target",
    present: true,
    sourceId: "creles-lab5-local",
    summary: promising
      ? "CRELES local lab5 biomarker candidate improves aggregate test discrimination or proper scores over the CRELES age/sex reference, but this does not prove MIDUS-to-CRELES transport."
      : "CRELES local lab5 biomarker candidate does not clearly improve aggregate test metrics over the CRELES age/sex reference.",
    verdict: promising ? "promising_internal_only" : "not_promotable",
  };
}

function summarizeMidus2ToCrelesTransport(value: unknown): R399LayeringEvidenceSummary {
  const models = optionalRecord(optionalRecord(value)?.transportModels);
  const reference = aggregateMetricsAt(models?.creles_age_sex_reference, ["splitMetrics", "test"]);
  const recalibrated = aggregateMetricsAt(models?.midus2_lab5_source_creles_recalibrated, ["splitMetrics", "test"]);
  if (!reference || !recalibrated) {
    return missingEvidence("midus2-lab5-to-creles-transport", "cross-cohort-transport", "MIDUS-to-CRELES aggregate transport output is missing or incomplete.");
  }
  const comparison = metricDelta(
    "midus2_lab5_source_creles_recalibrated",
    "creles_age_sex_reference",
    recalibrated,
    reference,
  );
  const confirmed = comparison.aucDelta !== null
    && comparison.aucDelta >= 0.01
    && comparison.brierDelta !== null
    && comparison.brierDelta <= 0
    && comparison.logLossDelta !== null
    && comparison.logLossDelta <= 0;
  return {
    comparison,
    evidenceClass: "cross-cohort-transport",
    present: true,
    sourceId: "midus2-lab5-to-creles-transport",
    summary: confirmed
      ? "MIDUS lab5 source model recalibrated on CRELES clears the conservative transport threshold against the CRELES age/sex reference."
      : "MIDUS lab5 source model recalibrated on CRELES does not clear the conservative transport threshold against the CRELES age/sex reference.",
    verdict: confirmed ? "transport_confirmed" : "not_promotable",
  };
}

function buildRecommendations(input: {
  committedCalculatorCardPresent: boolean;
  r399Present: boolean;
  transportConfirmed: boolean;
}): string[] {
  const recommendations = [
    "Keep R399 frozen as the large NHIS outcome-risk anchor; do not tune it on already-inspected diagnostics.",
  ];
  if (input.r399Present && !input.committedCalculatorCardPresent) {
    recommendations.push("Before layering R399 into the calculator, define a research-only R399 model-card/input bundle for NHIS proxy features without committing private coefficients.");
  }
  if (!input.transportConfirmed) {
    recommendations.push("Do not promote the current MIDUS lab5 biomarker increment over R399; use it as a negative/weak transport result and test a narrower or different biomarker increment on another source.");
  }
  recommendations.push("Keep wearable activity/sleep/RHR/HRV as shadow increments until a locked residual-increment benchmark shows stable aggregate lift over the anchor.");
  recommendations.push("Use ReviewGPT for the next high-level model strategy choice, not for another metadata gate: whether to build the R399 research card first or prioritize another external biomarker/wearable increment source.");
  return recommendations;
}

async function readR399ModelMetadata(filePath: string): Promise<R399ModelMetadata> {
  const raw = await readOptionalText(filePath);
  if (raw === null) {
    return { featureKeys: [], present: false };
  }
  const value = parseJson(raw, "R399 local parameter artifact");
  const root = requiredRecord(value, "R399 local parameter artifact");
  if (root.row_values_in_this_artifact !== false || root.predictions_in_this_artifact !== false) {
    throw new Error("R399 local parameter artifact must attest that row values and predictions are absent.");
  }
  const models = requiredRecord(root.models, "R399 models");
  const selected = requiredRecord(models[FROZEN_R399_MODEL_ID], "frozen R399 model");
  const features = requiredStringArray(selected.features, "frozen R399 feature keys");
  validateFrozenR399FeatureKeys(features);
  return {
    featureKeys: features,
    present: true,
  };
}

async function writeReadinessOutput(
  outputDir: string,
  output: R399LayeringReadinessOutput,
): Promise<string> {
  try {
    await mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, "r399-layering-readiness.latest.json");
    await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
    return outputPath;
  } catch {
    throw new Error("Failed to write R399 layering readiness artifact.");
  }
}

async function readOptionalJson(filePath: string): Promise<unknown | null> {
  const raw = await readOptionalText(filePath);
  return raw === null ? null : parseJson(raw, "aggregate research output");
}

async function readOptionalText(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) return null;
    throw new Error("Failed to read a Murph Age research artifact.");
  }
}

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function missingEvidence(
  sourceId: string,
  evidenceClass: R399LayeringEvidenceSummary["evidenceClass"],
  summary: string,
): R399LayeringEvidenceSummary {
  return {
    evidenceClass,
    present: false,
    sourceId,
    summary,
    verdict: "missing",
  };
}

function metricDelta(
  modelId: string,
  referenceModelId: string,
  candidate: AggregateMetrics,
  reference: AggregateMetrics,
): R399LayeringMetricDelta {
  return {
    aucDelta: candidate.auc === null || reference.auc === null ? null : roundMetric(candidate.auc - reference.auc),
    brierDelta: roundMetric(candidate.brier - reference.brier),
    logLossDelta: roundMetric(candidate.logLoss - reference.logLoss),
    modelId,
    referenceModelId,
  };
}

function isPositiveInternalDelta(delta: R399LayeringMetricDelta): boolean {
  return (delta.aucDelta !== null && delta.aucDelta > 0)
    || (delta.brierDelta !== null && delta.brierDelta < 0)
    || (delta.logLossDelta !== null && delta.logLossDelta < 0);
}

function aggregateMetricsAt(root: unknown, pathParts: readonly string[]): AggregateMetrics | null {
  let current = root;
  for (const part of pathParts) {
    current = optionalRecord(current)?.[part];
  }
  const record = optionalRecord(current);
  if (!record) return null;
  const auc = record.auc === null ? null : finiteNumber(record.auc);
  const brier = finiteNumber(record.brier);
  const logLoss = finiteNumber(record.logLoss);
  if (brier === null || logLoss === null) return null;
  return { auc, brier, logLoss };
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  const record = optionalRecord(value);
  if (!record) throw new Error(`${label} must be an object.`);
  return record;
}

function requiredStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(`${label} must be a string array.`);
  }
  return [...value];
}

function validateFrozenR399FeatureKeys(features: readonly string[]): void {
  const allowedCount = FROZEN_R399_FEATURE_KEY_ALLOWLIST.size;
  if (
    features.length !== allowedCount
    || new Set(features).size !== allowedCount
    || features.some((feature) => !FROZEN_R399_FEATURE_KEY_ALLOWLIST.has(feature))
  ) {
    throw new Error("Frozen R399 feature set does not match the expected allowlist.");
  }
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundMetric(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof Error
    && "code" in error
    && (error as Error & { code?: string }).code === code;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runR399LayeringReadiness({
    crelesOutputPath: process.env.MURPH_AGE_CRELES_OUTPUT_PATH,
    midus2OutputPath: process.env.MURPH_AGE_MIDUS2_OUTPUT_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r399ParamsPath: process.env.MURPH_AGE_R399_PARAMS_PATH,
    transportOutputPath: process.env.MURPH_AGE_TRANSPORT_OUTPUT_PATH,
  }).then(({ output: readiness }) => {
    const cliSummary = {
      anchorPresent: readiness.anchor.present,
      biomarkerTransportConfirmed: readiness.gates.biomarkerTransportConfirmed.status === "passed",
      productPromotionAuthorized: readiness.productPromotionAuthorized,
      r399CardPresent: readiness.anchor.committedCalculatorCardPresent,
      schemaVersion: readiness.schemaVersion,
      status: readiness.status,
      wearableIncrementValidated: readiness.gates.wearableIncrementValidated.status === "passed",
    };
    console.log(JSON.stringify(cliSummary, null, 2));
  }).catch((error) => {
    const message = error instanceof Error ? error.message : "R399 layering readiness failed.";
    console.error(message);
    process.exitCode = 1;
  });
}
