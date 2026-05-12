import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  isMurphAgeModelCardProductAuthorized,
  isMurphAgeModelCardRiskToAgeDisplayAuthorized,
  parseMurphAgeLocalModelCardArtifact,
  resolveMurphAgeModelCardPolicy,
  validateMurphAgeLocalModelCardArtifactPolicy,
} from "@murphai/health-metrics";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  assertAllowedR399LocalModelCardArtifactPath,
  assertAllowedR399ReadinessOutputDir,
  assertR399LocalModelCardMatchesParams,
  DEFAULT_R399_MODEL_CARD_OUTPUT_DIR,
  DEFAULT_R399_PARAMS_PATH,
  FROZEN_R399_FEATURE_KEYS,
  FROZEN_R399_MODEL_ID,
  R399_LOCAL_MODEL_CARD_FILENAME,
  R399_RESEARCH_CARD_ID,
  resolveR399RepoPath,
  validateFrozenR399FeatureKeys,
} from "./r399-local-model-card.ts";

export const R399_LAYERING_READINESS_SCHEMA_VERSION =
  "murph-age-r399-layering-readiness.v1" as const;

const DEFAULT_MODEL_RUNS_DIR = path.join(".runtime", "operations", "research", "murph-age", "model-runs");
const DEFAULT_MIDUS2_OUTPUT_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "midus2-local-benchmark.latest.json");
const DEFAULT_MIDUS_REFRESHER_OUTPUT_PATH = path.join(
  DEFAULT_MODEL_RUNS_DIR,
  "r399-midus-refresher-biomarker-increment.latest.json",
);
const DEFAULT_CRELES_OUTPUT_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "creles-local-benchmark.latest.json");
const DEFAULT_TRANSPORT_OUTPUT_PATH = path.join(DEFAULT_MODEL_RUNS_DIR, "midus2-creles-transport-benchmark.latest.json");
const DEFAULT_R399_MODEL_CARD_PATH = path.join(DEFAULT_R399_MODEL_CARD_OUTPUT_DIR, R399_LOCAL_MODEL_CARD_FILENAME);

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
  "R399 remains research-only; product promotion requires external validation and locked user-input mapping.",
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
  midusRefresherOutputPath?: string;
  outputDir?: string;
  r399ModelCardPath?: string;
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
    localModelCardPresent: boolean;
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
  nextLoop: {
    candidateBatch: {
      batchId: "r600-frozen-anchor-residual-increment-batch";
      candidates: Array<{
        id: string;
        role: "abstain_display" | "proposal" | "reference" | "shadow";
        scoreBearing: boolean;
      }>;
      selectionPolicy: "predeclared-small-batch";
      status: "frozen-research-only";
    };
    reviewGate: {
      nextGate: "aggregate-results";
      requiredBeforeReview: string[];
    };
    sourceRoles: Array<{
      id: string;
      optimizationAllowed: boolean;
      role: "frozen_anchor" | "internal_development" | "internal_replication" | "shadow_context" | "transport_stress";
    }>;
  };
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

interface R399LocalModelCardMetadata {
  featureCount: number | null;
  present: boolean;
}

export async function runR399LayeringReadiness(
  options: R399LayeringReadinessOptions = {},
): Promise<{ output: R399LayeringReadinessOutput; outputPath: string }> {
  const outputDir = resolveR399RepoPath(options.outputDir ?? DEFAULT_MODEL_RUNS_DIR);
  const r399ParamsPath = resolveR399RepoPath(options.r399ParamsPath ?? DEFAULT_R399_PARAMS_PATH);
  const r399ModelCardPath = resolveR399RepoPath(options.r399ModelCardPath ?? DEFAULT_R399_MODEL_CARD_PATH);
  const [r399Metadata, r399ModelCardMetadata, midus2, midusRefresher, creles, transport] = await Promise.all([
    readR399ModelMetadata(r399ParamsPath),
    readR399LocalModelCardMetadata(r399ModelCardPath, r399ParamsPath),
    readOptionalJson(options.midus2OutputPath ?? DEFAULT_MIDUS2_OUTPUT_PATH),
    readOptionalJson(options.midusRefresherOutputPath ?? DEFAULT_MIDUS_REFRESHER_OUTPUT_PATH),
    readOptionalJson(options.crelesOutputPath ?? DEFAULT_CRELES_OUTPUT_PATH),
    readOptionalJson(options.transportOutputPath ?? DEFAULT_TRANSPORT_OUTPUT_PATH),
  ]);

  const r399Policy = resolveMurphAgeModelCardPolicy(R399_RESEARCH_CARD_ID);
  const committedCalculatorCardPresent = isResearchOnlyR399PolicyPresent(r399Policy);
  const calculatorScorePathReady = committedCalculatorCardPresent && r399ModelCardMetadata.present;
  const biomarkerIncrement = [
    summarizeMidus2Increment(midus2),
    summarizeMidusRefresherIncrement(midusRefresher),
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
      reason: calculatorScorePathReady
        ? "Committed R399 research policy and ignored local R399 model-card artifact are present; scoring still requires explicit research mode."
        : committedCalculatorCardPresent
          ? "Committed R399 research policy is present; scoring still requires an ignored local R399 model-card artifact."
          : `No committed ${R399_RESEARCH_CARD_ID} research model-card policy is present.`,
      status: calculatorScorePathReady ? "passed" : "blocked",
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
      localModelCardPresent: r399ModelCardMetadata.present,
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
    nextLoop: buildNextLoopManifest(),
    participantIdentifiersStored: false,
    predictionsStored: false,
    productPromotionAuthorized: false,
    recommendations: buildRecommendations({
      committedCalculatorCardPresent,
      localModelCardPresent: r399ModelCardMetadata.present,
      r399Present: r399Metadata.present,
      transportConfirmed,
    }),
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

function buildNextLoopManifest(): R399LayeringReadinessOutput["nextLoop"] {
  return {
    candidateBatch: {
      batchId: "r600-frozen-anchor-residual-increment-batch",
      candidates: [
        { id: "r399-anchor-research-comparator", role: "reference", scoreBearing: true },
        { id: "r399-plus-compact-bloodwork-residual", role: "proposal", scoreBearing: true },
        { id: "r399-plus-compact-bloodwork-body-residual", role: "proposal", scoreBearing: true },
        { id: "wearable-shadow-qc-only", role: "shadow", scoreBearing: false },
        { id: "age-like-display-abstain", role: "abstain_display", scoreBearing: false },
      ],
      selectionPolicy: "predeclared-small-batch",
      status: "frozen-research-only",
    },
    reviewGate: {
      nextGate: "aggregate-results",
      requiredBeforeReview: [
        "same-denominator aggregate metrics against the frozen R399 anchor",
        "MIDUS 2 development result and MIDUS Refresher internal-replication result without Refresher retuning",
        "calibration, proper-score, missingness, and uncertainty summaries",
        "wearable availability/QC summary kept shadow-only",
        "explicit no-product, no-row, no-prediction, no-coefficient artifact-boundary attestation",
      ],
    },
    sourceRoles: [
      { id: "nhis-r399", optimizationAllowed: false, role: "frozen_anchor" },
      { id: "midus2", optimizationAllowed: true, role: "internal_development" },
      { id: "midus-refresher", optimizationAllowed: false, role: "internal_replication" },
      { id: "creles", optimizationAllowed: false, role: "transport_stress" },
      { id: "wearables", optimizationAllowed: false, role: "shadow_context" },
    ],
  };
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

function summarizeMidusRefresherIncrement(value: unknown): R399LayeringEvidenceSummary {
  const models = optionalRecord(optionalRecord(value)?.models);
  const anchor = aggregateMetricsAt(models?.r399_anchor_recalibrated, ["splitMetrics", "test"]);
  const candidate = aggregateMetricsAt(models?.r399_plus_lab3_bmi_increment, ["splitMetrics", "test"]);
  if (!anchor || !candidate) {
    return missingEvidence(
      "midus-refresher-r399-lab3-internal",
      "internal-biomarker",
      "MIDUS Refresher aggregate R399-plus-lab3 increment output is missing or incomplete.",
    );
  }
  const comparison = metricDelta("r399_plus_lab3_bmi_increment", "r399_anchor_recalibrated", candidate, anchor);
  const promising = isPositiveInternalDelta(comparison);
  return {
    comparison,
    evidenceClass: "internal-biomarker",
    present: true,
    sourceId: "midus-refresher-r399-lab3-internal",
    summary: promising
      ? "MIDUS Refresher lab3 biomarker increment improves aggregate test discrimination or proper scores over the transported R399 anchor, but this is internal evidence only."
      : "MIDUS Refresher lab3 biomarker increment does not clearly improve aggregate test metrics over the transported R399 anchor.",
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
  localModelCardPresent: boolean;
  r399Present: boolean;
  transportConfirmed: boolean;
}): string[] {
  const recommendations = [
    "Keep R399 frozen as the large NHIS outcome-risk anchor; do not tune it on already-inspected diagnostics.",
  ];
  if (input.r399Present && !input.committedCalculatorCardPresent) {
    recommendations.push("Before layering R399 into the calculator, define a research-only R399 model-card/input bundle for NHIS proxy features without committing private coefficients.");
  } else if (input.r399Present && !input.localModelCardPresent) {
    recommendations.push("Export the ignored R399 local model-card artifact before running the calculator against the frozen anchor.");
  } else if (input.r399Present) {
    recommendations.push("Keep the committed R399 card research-only; load private coefficients only through ignored local model-card artifacts in explicit research mode.");
  }
  if (!input.transportConfirmed) {
    recommendations.push("Do not promote the current MIDUS lab5 biomarker increment over R399; use it as a negative/weak transport result and test a narrower or different biomarker increment on another source.");
  }
  recommendations.push("Keep wearable activity/sleep/RHR/HRV as shadow increments until a locked residual-increment benchmark shows stable aggregate lift over the anchor.");
  recommendations.push("Use ReviewGPT for the next high-level model strategy choice, not for another metadata gate: whether to build the R399 research card first or prioritize another external biomarker/wearable increment source.");
  return recommendations;
}

function isResearchOnlyR399PolicyPresent(
  policy: ReturnType<typeof resolveMurphAgeModelCardPolicy>,
): boolean {
  return policy?.cardId === R399_RESEARCH_CARD_ID
    && policy.scoreBearing === true
    && policy.acceptedBundleIds.includes("r399-nhis-proxy-anchor")
    && policy.outcome.modelEndpoint === "10-year all-cause mortality"
    && policy.outcome.horizonYears === 10
    && policy.outcome.riskEndpoint === "all-cause-mortality"
    && isMurphAgeModelCardProductAuthorized(policy) === false
    && isMurphAgeModelCardRiskToAgeDisplayAuthorized(policy) === false;
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

async function readR399LocalModelCardMetadata(
  filePath: string,
  r399ParamsPath: string,
): Promise<R399LocalModelCardMetadata> {
  await assertAllowedR399LocalModelCardArtifactPath(filePath);
  const raw = await readOptionalText(filePath);
  if (raw === null) {
    return { featureCount: null, present: false };
  }
  const value = parseJson(raw, "R399 local model-card artifact");
  const artifact = parseMurphAgeLocalModelCardArtifact(value);
  if (!artifact.value || artifact.warnings.length > 0) {
    throw new Error("R399 local model-card artifact does not match the expected schema.");
  }
  const policyWarnings = validateMurphAgeLocalModelCardArtifactPolicy(artifact.value);
  if (policyWarnings.length > 0) {
    throw new Error("R399 local model-card artifact does not match the committed R399 policy.");
  }
  if (
    artifact.value.cardId !== R399_RESEARCH_CARD_ID
    || artifact.value.model.modelId !== FROZEN_R399_MODEL_ID
    || artifact.value.model.features.length !== FROZEN_R399_FEATURE_KEYS.length
  ) {
    throw new Error("R399 local model-card artifact does not match the frozen R399 anchor.");
  }
  await assertR399LocalModelCardMatchesParams({
    artifact: artifact.value,
    paramsPath: r399ParamsPath,
  });
  return {
    featureCount: artifact.value.model.features.length,
    present: true,
  };
}

async function writeReadinessOutput(
  outputDir: string,
  output: R399LayeringReadinessOutput,
): Promise<string> {
  try {
    await assertAllowedR399ReadinessOutputDir(outputDir);
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
    midusRefresherOutputPath: process.env.MURPH_AGE_MIDUS_REFRESHER_OUTPUT_PATH,
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r399ModelCardPath: process.env.MURPH_AGE_R399_MODEL_CARD_PATH,
    r399ParamsPath: process.env.MURPH_AGE_R399_PARAMS_PATH,
    transportOutputPath: process.env.MURPH_AGE_TRANSPORT_OUTPUT_PATH,
  }).then(({ output: readiness }) => {
    const cliSummary = {
      anchorPresent: readiness.anchor.present,
      biomarkerTransportConfirmed: readiness.gates.biomarkerTransportConfirmed.status === "passed",
      calculatorScorePathReady: readiness.gates.calculatorScorePathReady.status === "passed",
      localModelCardPresent: readiness.anchor.localModelCardPresent,
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
