import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  MURPH_AGE_INPUT_BUNDLE_SCHEMA_VERSION,
  MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION,
  MURPH_AGE_RESULT_SCHEMA_VERSION,
  METRIC_POINT_SCHEMA_VERSION,
  assessMurphAgeInputBundle,
  assessMurphAgeSecondaryContextBundles,
  calculateMurphAge,
  calculateMurphAgeFromInputBundle,
  createMurphAgeAbstainedAuthorization,
  createMurphAgeCustomModelAuthorization,
  isMurphAgeInputBundleMetricPointAllowed,
  isMurphAgeModelCardProductAuthorized,
  isMurphAgeModelCardRiskToAgeDisplayAuthorized,
  listMurphAgeModelCardProductPromotionBlockers,
  listMurphAgeInputBundleMetricKeys,
  normalizeMetricValue,
  parseMurphAgeLocalModelCardArtifact,
  resolveMurphAgeModelCardPolicy,
  resolveMetricInputKey,
  summarizeMurphAgeCalculatorPublicOutput,
  toPublicMurphAgeCalculatorReport,
  validateMurphAgeRiskModel,
  validateMurphAgeLocalModelCardArtifactPolicy,
  type MetricPoint,
  type MurphAgeCalculationInput,
  type MurphAgeCalculatorInput,
  type MurphAgeCalculatorMode,
  type MurphAgeCalculatorOutput,
  type MurphAgeContextBundleAssessment,
  type MurphAgeContextBundleFeatureStatus,
  type MurphAgeInputBundleAssessment,
  type MurphAgeInputBundleFeatureStatus,
  type MurphAgeLocalModelCardArtifact,
  type MurphAgePublicCalculatorReport,
  type MurphAgePublicDisplaySummary,
  type MurphAgeModelFeature,
  type MurphAgeProductPromotionBlocker,
  type MurphAgeResult,
  type MurphAgeRiskModel,
  type MurphAgeScoreBearingCardId,
  type MurphAgeWarning,
} from "@murphai/health-metrics";

import {
  listMetricPointsRuntime,
  type QueryMetricPointFilters,
} from "./query-projection.ts";

export interface CalculateMurphAgeForVaultInput extends Omit<MurphAgeCalculationInput, "points"> {
  asOf: string;
  vaultRoot: string;
}

export interface CalculateMurphAgeFromVaultInputBundleInput extends Omit<MurphAgeCalculatorInput, "points"> {
  asOf: string;
  vaultRoot: string;
}

export { MURPH_AGE_MODEL_CARD_ARTIFACT_SCHEMA_VERSION, type MurphAgeLocalModelCardArtifact };

export interface AssessMurphAgeInputReadinessFromVaultInput {
  asOf: string;
  vaultRoot: string;
}

export type MurphAgeInputFeatureReadiness =
  | Omit<MurphAgeContextBundleFeatureStatus, "selectedPointIds">
  | Omit<MurphAgeInputBundleFeatureStatus, "selectedPointIds" | "unit" | "value">;

export type MurphAgeInputReadinessWarning = Pick<MurphAgeWarning, "code" | "featureKey" | "metricKey">;
export type MurphAgeRuntimeInputKey = "chronological-age-years" | "sex";

export interface MurphAgeRuntimeInputReadiness {
  key: MurphAgeRuntimeInputKey;
  label: string;
  required: true;
  source: "runtime-option";
  status: "required";
}

export type MurphAgeInputBundleReadiness = Omit<
  MurphAgeContextBundleAssessment | MurphAgeInputBundleAssessment,
  "featureStatuses" | "selectedPointIds" | "warnings"
> & {
  featureStatuses: MurphAgeInputFeatureReadiness[];
  warnings: MurphAgeInputReadinessWarning[];
};
export type MurphAgeWearableBridgeInputReadiness = MurphAgePublicDisplaySummary["wearableBridge"];
export type MurphAgeInputScoreReadinessStatus =
  | "context-only"
  | "input-incomplete"
  | "product-age-policy-ready"
  | "product-risk-policy-ready"
  | "research-ready-product-blocked";
export type MurphAgeInputProductBlockedReason =
  | "CONTEXT_ONLY_NOT_SCORE_BEARING"
  | "INPUT_BUNDLE_INCOMPLETE"
  | MurphAgeProductPromotionBlocker;

export interface MurphAgeInputScoreReadiness {
  bundleId: MurphAgeInputBundleReadiness["bundleId"];
  contextOnly: boolean;
  inputReady: boolean;
  productAgePolicyReady: boolean;
  productBlockedReasons: MurphAgeInputProductBlockedReason[];
  productPromotionBlockers: MurphAgeProductPromotionBlocker[];
  productRiskPolicyReady: boolean;
  recommendedCardId: MurphAgeInputBundleReadiness["recommendedCardId"];
  researchModelCardRequired: boolean;
  researchReadiness: "context-only" | "input-incomplete" | "ready-if-local-model-card-loaded";
  researchUsableIfModelLoaded: boolean;
  scoreBearingInput: boolean;
  status: MurphAgeInputScoreReadinessStatus;
}

export interface MurphAgeInputReadinessForVault {
  bundle: MurphAgeInputBundleReadiness;
  contextBundles: MurphAgeInputBundleReadiness[];
  runtimeInputs: MurphAgeRuntimeInputReadiness[];
  schemaVersion: "murph.age.input-readiness.v4";
  scoreReadiness: MurphAgeInputScoreReadiness;
  wearableBridge: MurphAgeWearableBridgeInputReadiness;
}

export interface MurphAgeLocalModelCardLoadResult {
  models: Partial<Record<MurphAgeScoreBearingCardId, MurphAgeRiskModel>>;
  warnings: MurphAgeWarning[];
}

const MURPH_AGE_MODEL_CARD_RELATIVE_DIR = path.join(".runtime", "operations", "murph-age", "model-cards");
const WEARABLE_COVERAGE_WINDOW_DAYS = 28;
const WEARABLE_COVERAGE_MIN_VALID_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Activity bridge readiness needs activity-day coverage; recovery-only days must not make activity volume ready.
const MURPH_AGE_WEARABLE_VALID_DAY_METRIC_KEYS = new Set([
  "activity-minutes",
  "estimated-vo2-max",
  "steps",
]);
const MURPH_AGE_WEARABLE_VALID_NIGHT_METRIC_KEYS = new Set([
  "deep-sleep-minutes",
  "hrv-rmssd",
  "rem-sleep-minutes",
  "sleep-score",
  "spo2",
  "total-sleep-minutes",
]);
const MURPH_AGE_WEARABLE_SUMMARY_VALID_NIGHT_METRIC_KEYS = new Set([
  "deep-sleep-minutes",
  "rem-sleep-minutes",
  "sleep-score",
  "spo2",
  "total-sleep-minutes",
]);
const MURPH_AGE_RUNTIME_INPUT_READINESS = [
  {
    key: "chronological-age-years",
    label: "Chronological age",
    required: true,
    source: "runtime-option",
    status: "required",
  },
  {
    key: "sex",
    label: "Sex",
    required: true,
    source: "runtime-option",
    status: "required",
  },
] satisfies readonly MurphAgeRuntimeInputReadiness[];

export async function calculateMurphAgeForVault(
  input: CalculateMurphAgeForVaultInput,
): Promise<MurphAgeResult> {
  const asOf = parseFlexibleAsOf(input.asOf);
  if (!asOf) {
    return invalidAsOfResult(input);
  }

  const validation = validateMurphAgeRiskModel(input.model);
  if (validation.status === "invalid") {
    return calculateMurphAge({
      asOf,
      chronologicalAgeYears: input.chronologicalAgeYears,
      model: input.model,
      points: [],
      sex: input.sex,
    });
  }

  const points = await loadMurphAgeMetricPoints({
    asOf,
    model: input.model,
    vaultRoot: input.vaultRoot,
  });

  return calculateMurphAge({
    asOf,
    chronologicalAgeYears: input.chronologicalAgeYears,
    model: input.model,
    points,
    sex: input.sex,
  });
}

export async function calculateMurphAgeFromVaultInputBundle(
  input: CalculateMurphAgeFromVaultInputBundleInput,
): Promise<MurphAgeCalculatorOutput> {
  const asOf = parseStrictUtcAsOf(input.asOf);
  if (!asOf) {
    return invalidCalculatorOutput({
      message: "Murph Age query runtime requires a valid asOf timestamp.",
      mode: normalizeCalculatorMode(input.mode) ?? "product",
    });
  }

  const mode = normalizeCalculatorMode(input.mode);
  if (!mode) {
    return invalidCalculatorOutput({
      message: "Murph Age query runtime requires mode to be product or research.",
      mode: "product",
    });
  }

  const points = await loadMurphAgeInputBundleMetricPoints({
    asOf,
    vaultRoot: input.vaultRoot,
  });
  const localModelCards = mode === "research"
    ? await loadMurphAgeLocalModelCardArtifacts({ vaultRoot: input.vaultRoot })
    : { models: {}, warnings: [] };

  const output = calculateMurphAgeFromInputBundle({
    asOf,
    chronologicalAgeYears: input.chronologicalAgeYears,
    mode,
    models: { ...localModelCards.models, ...input.models },
    points,
    sex: input.sex,
  });
  return withPrependedWarnings(output, localModelCards.warnings);
}

export async function summarizeMurphAgeFromVaultInputBundle(
  input: CalculateMurphAgeFromVaultInputBundleInput,
): Promise<MurphAgePublicDisplaySummary> {
  const output = await calculateMurphAgeFromVaultInputBundle(input);
  return summarizeMurphAgeCalculatorPublicOutput(output);
}

export async function calculateMurphAgePublicReportFromVaultInputBundle(
  input: CalculateMurphAgeFromVaultInputBundleInput,
): Promise<MurphAgePublicCalculatorReport> {
  const output = await calculateMurphAgeFromVaultInputBundle(input);
  return toPublicMurphAgeCalculatorReport(output);
}

export async function assessMurphAgeInputReadinessFromVault(
  input: AssessMurphAgeInputReadinessFromVaultInput,
): Promise<MurphAgeInputReadinessForVault> {
  const asOf = parseStrictUtcAsOf(input.asOf);
  if (!asOf) {
    return {
      bundle: {
        availableFeatureKeys: [],
        bundleId: "insufficient",
        featureStatuses: [],
        missingFeatureKeys: [],
        recommendedCardId: "none",
        schemaVersion: MURPH_AGE_INPUT_BUNDLE_SCHEMA_VERSION,
        selectedMetricKeys: [],
        status: "abstain",
        warnings: [{
          code: "INVALID_INPUT",
        }],
      },
      contextBundles: [],
      runtimeInputs: buildMurphAgeRuntimeInputReadiness(),
      schemaVersion: "murph.age.input-readiness.v4",
      scoreReadiness: buildMurphAgeInputScoreReadiness({
        bundleId: "insufficient",
        recommendedCardId: "none",
        status: "abstain",
      }),
      wearableBridge: buildMurphAgeWearableBridgeReadiness({
        asOf: "1970-01-01T00:00:00.000Z",
        points: [],
      }),
    };
  }

  const points = await loadMurphAgeInputBundleMetricPoints({
    asOf,
    vaultRoot: input.vaultRoot,
  });
  const bundleAssessment = assessMurphAgeInputBundle({
    asOf,
    points,
  });
  const contextAssessments = assessMurphAgeSecondaryContextBundles({
    asOf,
    points,
    primaryBundleId: bundleAssessment.bundleId,
  });

  return {
    bundle: sanitizeMurphAgeInputBundleAssessment(bundleAssessment),
    contextBundles: contextAssessments.map(sanitizeMurphAgeInputBundleAssessment),
    runtimeInputs: buildMurphAgeRuntimeInputReadiness(),
    schemaVersion: "murph.age.input-readiness.v4",
    scoreReadiness: buildMurphAgeInputScoreReadiness(bundleAssessment),
    wearableBridge: buildMurphAgeWearableBridgeReadiness({
      asOf,
      points,
    }),
  };
}

function buildMurphAgeRuntimeInputReadiness(): MurphAgeRuntimeInputReadiness[] {
  return MURPH_AGE_RUNTIME_INPUT_READINESS.map((input) => ({ ...input }));
}

function buildMurphAgeInputScoreReadiness(
  assessment:
    | MurphAgeContextBundleAssessment
    | MurphAgeInputBundleAssessment
    | Pick<
      MurphAgeContextBundleAssessment | MurphAgeInputBundleAssessment,
      "bundleId" | "recommendedCardId" | "status"
    >,
): MurphAgeInputScoreReadiness {
  const policy = resolveMurphAgeModelCardPolicy(assessment.recommendedCardId);
  const inputReady = assessment.status === "ready" || assessment.status === "context-only";
  const scoreBearingInput = inputReady && Boolean(policy?.scoreBearing);
  const contextOnly = inputReady && !scoreBearingInput;
  const productPromotionBlockers = scoreBearingInput && policy
    ? listMurphAgeModelCardProductPromotionBlockers(policy)
    : [];
  const productRiskPolicyReady = scoreBearingInput && policy
    ? isMurphAgeModelCardProductAuthorized(policy)
    : false;
  const productAgePolicyReady = scoreBearingInput && policy
    ? isMurphAgeModelCardRiskToAgeDisplayAuthorized(policy)
    : false;
  const productBlockedReasons: MurphAgeInputProductBlockedReason[] = [];

  if (!inputReady) {
    productBlockedReasons.push("INPUT_BUNDLE_INCOMPLETE");
  } else if (contextOnly) {
    productBlockedReasons.push("CONTEXT_ONLY_NOT_SCORE_BEARING");
  } else {
    productBlockedReasons.push(...productPromotionBlockers);
  }

  const researchUsableIfModelLoaded = scoreBearingInput;
  const researchReadiness = researchUsableIfModelLoaded
    ? "ready-if-local-model-card-loaded"
    : contextOnly
      ? "context-only"
      : "input-incomplete";
  const status = productAgePolicyReady
    ? "product-age-policy-ready"
    : productRiskPolicyReady
      ? "product-risk-policy-ready"
      : researchUsableIfModelLoaded
        ? "research-ready-product-blocked"
        : contextOnly
          ? "context-only"
          : "input-incomplete";

  return {
    bundleId: assessment.bundleId,
    contextOnly,
    inputReady,
    productAgePolicyReady,
    productBlockedReasons,
    productPromotionBlockers,
    productRiskPolicyReady,
    recommendedCardId: assessment.recommendedCardId,
    researchModelCardRequired: researchUsableIfModelLoaded,
    researchReadiness,
    researchUsableIfModelLoaded,
    scoreBearingInput,
    status,
  };
}

function sanitizeMurphAgeInputBundleAssessment(
  assessment: MurphAgeContextBundleAssessment | MurphAgeInputBundleAssessment,
): MurphAgeInputBundleReadiness {
  return {
    availableFeatureKeys: [...assessment.availableFeatureKeys],
    bundleId: assessment.bundleId,
    featureStatuses: assessment.featureStatuses.map((feature) => ({
      featureKey: feature.featureKey,
      label: feature.label,
      metricKeys: [...feature.metricKeys],
      requiredFor: feature.requiredFor,
      selectedMetricKey: feature.selectedMetricKey,
      status: feature.status,
    })),
    missingFeatureKeys: [...assessment.missingFeatureKeys],
    recommendedCardId: assessment.recommendedCardId,
    schemaVersion: assessment.schemaVersion,
    selectedMetricKeys: [...assessment.selectedMetricKeys],
    status: assessment.status,
    warnings: assessment.warnings.map((warning) => ({
      code: warning.code,
      ...(warning.featureKey ? { featureKey: warning.featureKey } : {}),
      ...(warning.metricKey ? { metricKey: warning.metricKey } : {}),
    })),
  };
}

function buildMurphAgeWearableBridgeReadiness(input: {
  asOf: string;
  points: readonly MetricPoint[];
}): MurphAgeWearableBridgeInputReadiness {
  const output = calculateMurphAgeFromInputBundle({
    asOf: input.asOf,
    chronologicalAgeYears: 50,
    mode: "product",
    models: {},
    points: input.points,
    sex: "female",
  });
  return summarizeMurphAgeCalculatorPublicOutput(output).wearableBridge;
}

export function metricPointFiltersForMurphAgeModel(
  model: MurphAgeRiskModel,
  asOf: string,
): QueryMetricPointFilters[] {
  const to = isoDayFromDateTime(asOf);
  const filtersByKey = new Map<string, QueryMetricPointFilters>();

  for (const feature of model.features) {
    if (feature.kind !== "metric") continue;
    const filter: QueryMetricPointFilters = {
      limit: null,
      metricKey: resolveMetricInputKey(feature.metricKey),
    };
    if (feature.biomarkerKey) {
      filter.biomarkerKey = feature.biomarkerKey;
    }
    if (to) {
      filter.to = to;
    }
    filtersByKey.set(metricFilterKey(filter), filter);
  }

  return [...filtersByKey.values()];
}

export function metricPointFiltersForMurphAgeInputBundle(asOf: string): QueryMetricPointFilters[] {
  const to = isoDayFromDateTime(asOf);
  return [...new Set(listMurphAgeInputBundleMetricKeys().map(resolveMetricInputKey))].map((metricKey) => {
    const filter: QueryMetricPointFilters = {
      limit: null,
      metricKey,
    };
    if (to) {
      filter.to = to;
    }
    return filter;
  });
}

export function defaultMurphAgeModelCardArtifactRoot(vaultRoot: string): string {
  return path.join(vaultRoot, MURPH_AGE_MODEL_CARD_RELATIVE_DIR);
}

export async function loadMurphAgeLocalModelCardArtifacts(input: {
  vaultRoot: string;
}): Promise<MurphAgeLocalModelCardLoadResult> {
  const root = defaultMurphAgeModelCardArtifactRoot(input.vaultRoot);
  let entries: Array<{ isFile(): boolean; name: string }>;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isNotFoundError(error)) {
      return { models: {}, warnings: [] };
    }
    return {
      models: {},
      warnings: [localModelCardWarning(
        "A local Murph Age model-card artifact directory could not be read.",
      )],
    };
  }

  const models: Partial<Record<MurphAgeScoreBearingCardId, MurphAgeRiskModel>> = {};
  const warnings: MurphAgeWarning[] = [];
  const jsonEntries = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of jsonEntries) {
    const artifact = await readLocalModelCardArtifact(path.join(root, entry.name));
    warnings.push(...artifact.warnings);
    if (!artifact.value) continue;
    if (models[artifact.value.cardId]) {
      warnings.push(localModelCardWarning(
        "Duplicate local Murph Age model-card artifacts were found for the same card id.",
      ));
      continue;
    }
    models[artifact.value.cardId] = artifact.value.model;
  }

  return { models, warnings };
}

async function readLocalModelCardArtifact(filePath: string): Promise<{
  value: MurphAgeLocalModelCardArtifact | null;
  warnings: MurphAgeWarning[];
}> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return {
      value: null,
      warnings: [localModelCardWarning("A local Murph Age model-card artifact could not be read.")],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      value: null,
      warnings: [localModelCardWarning("A local Murph Age model-card artifact is not valid JSON.")],
    };
  }

  const artifact = parseMurphAgeLocalModelCardArtifact(parsed);
  if (!artifact.value) return artifact;

  const warnings = validateMurphAgeLocalModelCardArtifactPolicy(artifact.value);
  if (warnings.length > 0) {
    return { value: null, warnings };
  }
  return { value: artifact.value, warnings: [] };
}

function localModelCardWarning(message: string): MurphAgeWarning {
  return {
    code: "INVALID_INPUT",
    message,
  };
}

function withPrependedWarnings(
  output: MurphAgeCalculatorOutput,
  warnings: readonly MurphAgeWarning[],
): MurphAgeCalculatorOutput {
  if (warnings.length === 0) return output;
  return {
    ...output,
    warnings: [...warnings, ...output.warnings],
  };
}

async function loadMurphAgeMetricPoints(input: {
  asOf: string;
  model: MurphAgeRiskModel;
  vaultRoot: string;
}): Promise<MetricPoint[]> {
  const filters = metricPointFiltersForMurphAgeModel(input.model, input.asOf);
  return loadMetricPointsForFilters({ asOf: input.asOf, filters, vaultRoot: input.vaultRoot });
}

async function loadMurphAgeInputBundleMetricPoints(input: {
  asOf: string;
  vaultRoot: string;
}): Promise<MetricPoint[]> {
  const filters = metricPointFiltersForMurphAgeInputBundle(input.asOf);
  const points = await loadMetricPointsForFilters({ asOf: input.asOf, filters, vaultRoot: input.vaultRoot });
  const allowedPoints = points.filter(isMurphAgeInputBundleMetricPointAllowed);
  return appendMurphAgeWearableCoveragePoints({
    asOf: input.asOf,
    points: allowedPoints,
  });
}

async function loadMetricPointsForFilters(input: {
  asOf: string;
  filters: readonly QueryMetricPointFilters[];
  vaultRoot: string;
}): Promise<MetricPoint[]> {
  const pointLists = await Promise.all(
    input.filters.map((filter) => listMetricPointsRuntime(input.vaultRoot, filter)),
  );
  const pointsById = new Map<string, MetricPoint>();
  for (const point of pointLists.flat()) {
    if (compareMetricPointToAsOf(point, input.asOf) > 0) continue;
    pointsById.set(point.id, point);
  }
  return [...pointsById.values()];
}

function appendMurphAgeWearableCoveragePoints(input: {
  asOf: string;
  points: readonly MetricPoint[];
}): MetricPoint[] {
  const coveragePoints = deriveMurphAgeWearableCoveragePoints(input);
  if (coveragePoints.length === 0) {
    return [...input.points];
  }

  const byId = new Map<string, MetricPoint>();
  for (const point of input.points) {
    byId.set(point.id, point);
  }
  for (const point of coveragePoints) {
    byId.set(point.id, point);
  }
  return [...byId.values()];
}

function deriveMurphAgeWearableCoveragePoints(input: {
  asOf: string;
  points: readonly MetricPoint[];
}): MetricPoint[] {
  const asOfDay = isoDayFromDateTime(input.asOf);
  if (!asOfDay) {
    return [];
  }

  const validDayDates = uniqueStrings(
    input.points
      .filter(isMurphAgeWearableValidDayPoint)
      .map((point) => point.effectiveDate),
  );
  const validNightDates = uniqueStrings(
    input.points
      .filter(isMurphAgeWearableValidNightPoint)
      .map((point) => point.effectiveDate),
  );
  const validDayCount = countDatesInTrailingWindow(validDayDates, asOfDay, WEARABLE_COVERAGE_WINDOW_DAYS);
  const validNightCount = countDatesInTrailingWindow(validNightDates, asOfDay, WEARABLE_COVERAGE_WINDOW_DAYS);
  const dayCoverageReady = validDayCount >= WEARABLE_COVERAGE_MIN_VALID_DAYS;
  const nightCoverageReady = validNightCount >= WEARABLE_COVERAGE_MIN_VALID_DAYS;
  const points: MetricPoint[] = [];

  if (dayCoverageReady) {
    points.push(createWearableCoverageMetricPoint({
      asOfDay,
      metricKey: "wearable-valid-day-count-28d",
      unit: "count",
      value: validDayCount,
    }));
  }

  if (nightCoverageReady) {
    points.push(createWearableCoverageMetricPoint({
      asOfDay,
      metricKey: "wearable-valid-night-count-28d",
      unit: "count",
      value: validNightCount,
    }));
  }

  if (dayCoverageReady && nightCoverageReady) {
    points.push(createWearableCoverageMetricPoint({
      asOfDay,
      metricKey: "wearable-coverage-index",
      unit: "score",
      value: roundCoverageIndex(
        (Math.min(validDayCount, WEARABLE_COVERAGE_WINDOW_DAYS) +
          Math.min(validNightCount, WEARABLE_COVERAGE_WINDOW_DAYS)) /
          (WEARABLE_COVERAGE_WINDOW_DAYS * 2),
      ),
    }));
  }

  return points;
}

function isMurphAgeWearableValidDayPoint(point: MetricPoint): boolean {
  return (point.source.kind === "activity-summary" || point.source.kind === "wearable-summary") &&
    MURPH_AGE_WEARABLE_VALID_DAY_METRIC_KEYS.has(point.metricKey);
}

function isMurphAgeWearableValidNightPoint(point: MetricPoint): boolean {
  if (point.source.kind === "sleep-summary") {
    return MURPH_AGE_WEARABLE_VALID_NIGHT_METRIC_KEYS.has(point.metricKey);
  }
  return point.source.kind === "wearable-summary" &&
    MURPH_AGE_WEARABLE_SUMMARY_VALID_NIGHT_METRIC_KEYS.has(point.metricKey);
}

function createWearableCoverageMetricPoint(input: {
  asOfDay: string;
  metricKey: string;
  unit: string;
  value: number;
}): MetricPoint {
  const observedAt = `${input.asOfDay}T00:00:00.000Z`;
  const normalized = normalizeMetricValue({
    metricKey: input.metricKey,
    unit: input.unit,
    value: input.value,
  });
  const id = `metric-point:murph-age-wearable-coverage:${input.metricKey}:${input.asOfDay}`;

  return {
    biomarkerKey: null,
    canonicalUnit: normalized.canonicalUnit,
    canonicalValue: normalized.canonicalValue,
    comparator: null,
    confidence: "medium",
    context: {
      measurementWindowDays: WEARABLE_COVERAGE_WINDOW_DAYS,
      syntheticRecordId: id,
    },
    effectiveDate: input.asOfDay,
    grain: "day",
    id,
    metricKey: input.metricKey,
    observedAt,
    provenance: {
      dataOrigin: null,
      externalRef: null,
      labName: null,
      provider: null,
      rawRefs: [],
      sourceLabel: "Wearable coverage summary",
    },
    recordedAt: null,
    reportedAt: null,
    schemaVersion: METRIC_POINT_SCHEMA_VERSION,
    source: {
      family: "derived",
      kind: "wearable-summary",
      path: "",
      recordId: id,
      resultIndex: null,
    },
    statistic: "value",
    textValue: null,
    unit: input.unit,
    value: input.value,
  };
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}

function countDatesInTrailingWindow(
  dates: readonly string[],
  latestDate: string,
  windowDays: number,
): number {
  const latestTime = dayKeyTime(latestDate);
  if (latestTime === null) {
    return 0;
  }

  return uniqueStrings(dates).filter((date) => {
    const time = dayKeyTime(date);
    if (time === null) {
      return false;
    }

    const diffDays = Math.floor((latestTime - time) / MS_PER_DAY);
    return diffDays >= 0 && diffDays < windowDays;
  }).length;
}

function dayKeyTime(date: string): number | null {
  const time = Date.parse(`${date.slice(0, 10)}T00:00:00.000Z`);
  return Number.isFinite(time) ? time : null;
}

function roundCoverageIndex(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function invalidAsOfResult(input: CalculateMurphAgeForVaultInput): MurphAgeResult {
  const warning: MurphAgeWarning = {
    code: "INVALID_INPUT",
    message: "Murph Age query runtime requires a valid asOf timestamp.",
  };
  return {
    ageDeltaYears: null,
    authorization: createMurphAgeCustomModelAuthorization(input.model),
    biologicalAgeYears: null,
    chronologicalAgeYears: input.chronologicalAgeYears,
    featureAttributions: [],
    intervalYears: null,
    modelId: input.model.modelId,
    modelVersion: input.model.modelVersion ?? null,
    moduleAttributions: [],
    risk: null,
    schemaVersion: MURPH_AGE_RESULT_SCHEMA_VERSION,
    status: "abstain",
    warnings: [warning],
  };
}

function invalidCalculatorOutput(input: {
  message: string;
  mode: MurphAgeCalculatorMode;
}): MurphAgeCalculatorOutput {
  const warning: MurphAgeWarning = {
    code: "INVALID_INPUT",
    message: input.message,
  };
  return {
    authorization: createMurphAgeAbstainedAuthorization(),
    bundleAssessment: {
      availableFeatureKeys: [],
      bundleId: "insufficient",
      featureStatuses: [],
      missingFeatureKeys: [],
      recommendedCardId: "none",
      schemaVersion: MURPH_AGE_INPUT_BUNDLE_SCHEMA_VERSION,
      selectedMetricKeys: [],
      selectedPointIds: [],
      status: "abstain",
      warnings: [warning],
    },
    cardPolicy: null,
    contextAssessments: [],
    mode: input.mode,
    result: null,
    schemaVersion: MURPH_AGE_RESULT_SCHEMA_VERSION,
    status: "abstain",
    warnings: [warning],
    wearableShadowIncrementAssessments: [],
  };
}

function metricFilterKey(filter: QueryMetricPointFilters): string {
  return JSON.stringify([
    filter.metricKey ?? null,
    filter.biomarkerKey ?? null,
    filter.from ?? null,
    filter.to ?? null,
  ]);
}

function isoDayFromDateTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(day)) return undefined;
  return parseStrictUtcAsOf(`${day}T00:00:00.000Z`) ? day : undefined;
}

function parseStrictUtcAsOf(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/u.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, millisecond = "0"] = match;
  const timestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(millisecond.padEnd(3, "0")),
  );
  if (!Number.isFinite(timestamp)) return null;
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() + 1 !== Number(month)
    || parsed.getUTCDate() !== Number(day)
    || parsed.getUTCHours() !== Number(hour)
    || parsed.getUTCMinutes() !== Number(minute)
    || parsed.getUTCSeconds() !== Number(second)
  ) {
    return null;
  }
  return parsed.toISOString();
}

function parseFlexibleAsOf(value: string): string | null {
  const parsed = parseFlexibleIsoDateTime(value) ?? parseIsoDay(value);
  if (!parsed) return null;
  return parsed.toISOString();
}

function parseIsoDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day));
  if (!Number.isFinite(timestamp)) return null;
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() + 1 !== Number(month)
    || parsed.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  return parsed;
}

function parseFlexibleIsoDateTime(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, millisecond = "0", zone] = match;
  const localTimestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(millisecond.padEnd(3, "0")),
  );
  if (!Number.isFinite(localTimestamp)) return null;
  const offsetMinutes = zone === "Z" ? 0 : parseTimezoneOffsetMinutes(zone);
  if (offsetMinutes === null) return null;
  const localParsed = new Date(localTimestamp);
  if (
    localParsed.getUTCFullYear() !== Number(year)
    || localParsed.getUTCMonth() + 1 !== Number(month)
    || localParsed.getUTCDate() !== Number(day)
    || localParsed.getUTCHours() !== Number(hour)
    || localParsed.getUTCMinutes() !== Number(minute)
    || localParsed.getUTCSeconds() !== Number(second)
  ) {
    return null;
  }
  return new Date(localTimestamp - offsetMinutes * 60_000);
}

function parseTimezoneOffsetMinutes(value: string): number | null {
  const match = /^([+-])(\d{2}):(\d{2})$/u.exec(value);
  if (!match) return null;
  const [, sign, hours, minutes] = match;
  const hourValue = Number(hours);
  const minuteValue = Number(minutes);
  if (hourValue > 23 || minuteValue > 59) return null;
  const absolute = hourValue * 60 + minuteValue;
  return sign === "+" ? absolute : -absolute;
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && typeof error.code === "string"
    && error.code === "ENOENT";
}

function compareMetricPointToAsOf(point: MetricPoint, asOf: string): number {
  const observedAtMs = Date.parse(point.observedAt);
  const asOfMs = Date.parse(asOf);
  if (Number.isNaN(observedAtMs) || Number.isNaN(asOfMs)) return 0;
  return observedAtMs - asOfMs;
}

function normalizeCalculatorMode(value: unknown): MurphAgeCalculatorMode | null {
  if (value === undefined) return "product";
  return value === "product" || value === "research" ? value : null;
}
