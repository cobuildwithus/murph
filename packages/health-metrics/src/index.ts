export const METRIC_POINT_SCHEMA_VERSION = "murph.metric-point" as const;
export const METRIC_SELECTION_SCHEMA_VERSION = "murph.metric-selection" as const;

export type MetricConfidence = "none" | "low" | "medium" | "high";
export type MetricGrain = "instant" | "event" | "day" | "week" | "month" | "window";
export type MetricStatistic = "value" | "latest" | "mean" | "median" | "min" | "max" | "sum" | "count";
export type MetricComparator = "<" | "<=" | ">" | ">=";
export type MetricCategory = "activity" | "body" | "custom" | "fitness" | "lab" | "recovery" | "sleep" | "vital";
export type MetricSourceFamily = "derived" | "event" | "sample";
export type MetricSourceKind =
  | "activity-summary"
  | "compat-body-measurement"
  | "compat-observation"
  | "measurement"
  | "metric-sample"
  | "sample-summary"
  | "sleep-summary"
  | "test-result"
  | "wearable-summary"
  | string;

export type MetricSelectionStatus = "insufficient_data" | "no_data" | "ready" | "stale" | "unsupported";
export type MetricSelectionWarningCode =
  | "COMPARATOR_VALUE"
  | "LOW_SAMPLE_COUNT"
  | "METHOD_CHANGED"
  | "MIXED_SOURCES"
  | "SOURCE_STALE"
  | "UNIT_NOT_NORMALIZED";

export type MetricSelectionPolicy =
  | { kind: "latest-valid"; staleAfterDays?: number }
  | { kind: "latest-lab"; preferCollectedAt: true; preferFasting?: boolean; staleAfterDays?: number }
  | { kind: "latest-device-estimate"; staleAfterDays?: number }
  | {
      kind: "qualified-latest";
      requiredQualifiers: Record<string, string | number | boolean>;
      staleAfterDays?: number;
    };

export interface MetricTrendPolicy {
  aggregation: "mean" | "median" | "min" | "max" | "sum";
  comparisonWindowDays?: number;
  latestWindowDays?: number;
  minimumPoints?: number;
}

export interface MetricDefinition {
  aliases: readonly string[];
  biomarkerAliases?: readonly string[];
  biomarkerKey: string | null;
  canonicalUnit: string | null;
  category: MetricCategory;
  displayName: string;
  displayUnit: string | null;
  key: string;
  selectionPolicy: MetricSelectionPolicy;
  trendPolicy?: MetricTrendPolicy;
  valuePrecision: number;
}

export interface MetricPointSource {
  family: MetricSourceFamily;
  kind: MetricSourceKind;
  path: string;
  recordId: string;
  resultIndex: number | null;
}

export interface MetricPointProvenance {
  dataOrigin: unknown | null;
  externalRef: unknown | null;
  labName: string | null;
  provider: string | null;
  rawRefs: string[];
  sourceLabel: string | null;
}

export interface MetricPointContext {
  fastingStatus?: "fasting" | "non_fasting" | "unknown";
  flag?: string;
  measurementMethodKey?: string;
  qualifiers?: Record<string, string | number | boolean>;
  referenceRange?: {
    high?: number;
    low?: number;
    text?: string;
  };
  [key: string]: unknown;
}

export interface MetricPoint {
  biomarkerKey: string | null;
  canonicalUnit: string | null;
  canonicalValue: number | null;
  comparator: MetricComparator | null;
  confidence: MetricConfidence;
  context: MetricPointContext;
  effectiveDate: string;
  grain: MetricGrain;
  id: string;
  metricKey: string;
  observedAt: string;
  provenance: MetricPointProvenance;
  recordedAt: string | null;
  reportedAt: string | null;
  schemaVersion: typeof METRIC_POINT_SCHEMA_VERSION;
  source: MetricPointSource;
  statistic: MetricStatistic;
  textValue: string | null;
  unit: string | null;
  value: number | null;
}

export interface MetricSelectionWarning {
  code: MetricSelectionWarningCode;
  message: string;
}

export interface MetricSelection {
  biomarkerKey: string | null;
  confidence: MetricConfidence;
  effectiveDate: string | null;
  metricKey: string;
  observedAt: string | null;
  point: MetricPoint | null;
  provenance: {
    pointIds: string[];
    recordIds: string[];
    sourceKinds: string[];
  };
  schemaVersion: typeof METRIC_SELECTION_SCHEMA_VERSION;
  sourceLabel: string | null;
  status: MetricSelectionStatus;
  unit: string | null;
  value: number | null;
  valueLabel: string | null;
  warnings: MetricSelectionWarning[];
}

export interface MetricValueNormalization {
  canonicalUnit: string | null;
  canonicalValue: number | null;
  unit: string | null;
  warnings: MetricSelectionWarning[];
}

export interface GoalMetricTarget {
  biomarkerKey?: string;
  comparator: MetricComparator | "between";
  evaluation:
    | { kind: "latest-lab" }
    | { kind: "rolling-window"; statistic: "mean" | "median"; windowDays: number }
    | { kind: "selected-value" };
  highValue?: number;
  kind: "metric";
  metricKey: string;
  note?: string;
  selectionPolicyOverride?: MetricSelectionPolicy;
  startAt?: string;
  targetAt?: string;
  targetId: string;
  unit: string;
  value: number;
}

export interface MetricGoalProgress {
  currentValue: number | null;
  currentValueLabel: string | null;
  deltaToTarget: number | null;
  goalId: string;
  metricKey: string;
  selectedPointIds: string[];
  status: "behind" | "met" | "no_data" | "on_track" | "stale" | "unsupported";
  targetId: string;
  targetValueLabel: string;
  unit: string;
  warnings: MetricSelectionWarning[];
}

const DEFAULT_STALE_AFTER_DAYS = 90;
const ISO_DAY_MS = 24 * 60 * 60 * 1000;

const METRIC_DEFINITIONS: readonly MetricDefinition[] = [
  metric({
    aliases: ["rhr", "resting_heart_rate", "restingHeartRate", "resting-pulse"],
    biomarkerKey: "biomarker:resting-heart-rate",
    canonicalUnit: "bpm",
    category: "recovery",
    displayName: "Resting heart rate",
    displayUnit: "bpm",
    key: "resting-heart-rate",
    selectionPolicy: { kind: "latest-valid", staleAfterDays: 14 },
    trendPolicy: { aggregation: "median", comparisonWindowDays: 30, latestWindowDays: 7, minimumPoints: 5 },
    valuePrecision: 0,
  }),
  metric({
    aliases: ["hrv", "hrv_rmssd", "rmssd", "heart-rate-variability", "heart_rate_variability"],
    biomarkerKey: "biomarker:hrv-rmssd",
    canonicalUnit: "ms",
    category: "recovery",
    displayName: "HRV",
    displayUnit: "ms",
    key: "hrv-rmssd",
    selectionPolicy: { kind: "latest-valid", staleAfterDays: 14 },
    trendPolicy: { aggregation: "median", comparisonWindowDays: 30, latestWindowDays: 7, minimumPoints: 7 },
    valuePrecision: 0,
  }),
  metric({
    aliases: ["blood-oxygen", "blood_oxygen", "oxygen-saturation", "oxygen_saturation", "spo2", "sp-o2"],
    biomarkerKey: "biomarker:blood-oxygen-spo2",
    canonicalUnit: "percent",
    category: "vital",
    displayName: "Blood oxygen",
    displayUnit: "%",
    key: "spo2",
    selectionPolicy: { kind: "latest-valid", staleAfterDays: 14 },
    trendPolicy: { aggregation: "median", comparisonWindowDays: 30, latestWindowDays: 7, minimumPoints: 5 },
    valuePrecision: 1,
  }),
  metric({
    aliases: ["cardio-fitness", "estimated-vo2max", "estimated_vo2max", "estimated_vo2_max", "vo2-max", "vo2_max", "vo2max"],
    biomarkerKey: "biomarker:estimated-vo2max",
    canonicalUnit: "mL/kg/min",
    category: "fitness",
    displayName: "Estimated VO2 max",
    displayUnit: "mL/kg/min",
    key: "estimated-vo2-max",
    selectionPolicy: { kind: "latest-device-estimate", staleAfterDays: 45 },
    trendPolicy: { aggregation: "median", comparisonWindowDays: 90, latestWindowDays: 14, minimumPoints: 2 },
    valuePrecision: 1,
  }),
  metric({
    aliases: ["deep", "deep_minutes", "deepMinutes", "deep-sleep", "deep_sleep"],
    biomarkerKey: "biomarker:deep-sleep-minutes",
    canonicalUnit: "minutes",
    category: "sleep",
    displayName: "Deep sleep",
    displayUnit: "minutes",
    key: "deep-sleep-minutes",
    selectionPolicy: { kind: "latest-valid", staleAfterDays: 14 },
    trendPolicy: { aggregation: "median", comparisonWindowDays: 30, latestWindowDays: 7, minimumPoints: 5 },
    valuePrecision: 0,
  }),
  metric({
    aliases: ["rem", "rem_minutes", "remMinutes", "rem-sleep", "rem_sleep"],
    biomarkerKey: "biomarker:rem-sleep-minutes",
    canonicalUnit: "minutes",
    category: "sleep",
    displayName: "REM sleep",
    displayUnit: "minutes",
    key: "rem-sleep-minutes",
    selectionPolicy: { kind: "latest-valid", staleAfterDays: 14 },
    trendPolicy: { aggregation: "median", comparisonWindowDays: 30, latestWindowDays: 7, minimumPoints: 5 },
    valuePrecision: 0,
  }),
  metric({
    aliases: ["sleep_duration", "sleep-duration", "total-sleep-time", "total_sleep_time", "totalSleepMinutes", "total_sleep_minutes", "total-minutes", "totalMinutes"],
    biomarkerKey: null,
    canonicalUnit: "minutes",
    category: "sleep",
    displayName: "Total sleep",
    displayUnit: "minutes",
    key: "total-sleep-minutes",
    selectionPolicy: { kind: "latest-valid", staleAfterDays: 14 },
    valuePrecision: 0,
  }),
  metric({
    aliases: ["sleep-quality", "sleep_quality", "sleepScore", "sleep_score"],
    biomarkerKey: null,
    canonicalUnit: "score",
    category: "sleep",
    displayName: "Sleep score",
    displayUnit: "score",
    key: "sleep-score",
    selectionPolicy: { kind: "latest-valid", staleAfterDays: 14 },
    valuePrecision: 0,
  }),
  metric({
    aliases: ["readinessScore", "readiness_score", "recovery-score", "recoveryScore"],
    biomarkerKey: null,
    canonicalUnit: "score",
    category: "recovery",
    displayName: "Readiness score",
    displayUnit: "score",
    key: "readiness-score",
    selectionPolicy: { kind: "latest-valid", staleAfterDays: 14 },
    valuePrecision: 0,
  }),
  metric({
    aliases: ["daily-step-count", "daily_step_count", "step-count", "step_count", "steps"],
    biomarkerKey: null,
    canonicalUnit: "count",
    category: "activity",
    displayName: "Steps",
    displayUnit: "steps",
    key: "steps",
    selectionPolicy: { kind: "latest-valid", staleAfterDays: 14 },
    valuePrecision: 0,
  }),
  metric({
    aliases: ["sessionMinutes", "session_minutes", "activity-minutes"],
    biomarkerKey: null,
    canonicalUnit: "minutes",
    category: "activity",
    displayName: "Activity minutes",
    displayUnit: "minutes",
    key: "activity-minutes",
    selectionPolicy: { kind: "latest-valid", staleAfterDays: 14 },
    valuePrecision: 0,
  }),
  metric({
    aliases: ["weight", "body_weight", "bodyWeight", "bodyweight", "weightKg"],
    biomarkerKey: null,
    canonicalUnit: "kg",
    category: "body",
    displayName: "Body weight",
    displayUnit: "kg",
    key: "body-weight",
    selectionPolicy: { kind: "latest-valid", staleAfterDays: 45 },
    valuePrecision: 1,
  }),
  metric({
    aliases: ["body_fat", "bodyFat", "body_fat_pct", "body-fat-pct", "bodyFatPercentage", "body_fat_percentage"],
    biomarkerKey: null,
    canonicalUnit: "percent",
    category: "body",
    displayName: "Body fat",
    displayUnit: "percent",
    key: "body-fat-percentage",
    selectionPolicy: { kind: "latest-valid", staleAfterDays: 45 },
    valuePrecision: 1,
  }),
  metric({
    aliases: ["blood-glucose", "blood_glucose", "fasting-glucose", "fasting_glucose"],
    biomarkerKey: "biomarker:blood-glucose",
    canonicalUnit: "mg/dL",
    category: "lab",
    displayName: "Glucose",
    displayUnit: "mg/dL",
    key: "glucose",
    selectionPolicy: { kind: "latest-lab", preferCollectedAt: true, preferFasting: true, staleAfterDays: 90 },
    valuePrecision: 0,
  }),
  metric({
    aliases: ["apo-b", "apo_b", "apolipoprotein-b", "apolipoprotein_b", "apolipoprotein b"],
    biomarkerAliases: ["biomarker:apolipoprotein-b"],
    biomarkerKey: "biomarker:apob",
    canonicalUnit: "mg/dL",
    category: "lab",
    displayName: "ApoB",
    displayUnit: "mg/dL",
    key: "apob",
    selectionPolicy: { kind: "latest-lab", preferCollectedAt: true, staleAfterDays: 365 },
    valuePrecision: 0,
  }),
  metric({
    aliases: ["ldl", "ldl_cholesterol", "ldl-cholesterol", "ldlc", "ldl_c"],
    biomarkerKey: "biomarker:ldl-c",
    canonicalUnit: "mg/dL",
    category: "lab",
    displayName: "LDL-C",
    displayUnit: "mg/dL",
    key: "ldl-c",
    selectionPolicy: { kind: "latest-lab", preferCollectedAt: true, staleAfterDays: 365 },
    valuePrecision: 0,
  }),
  metric({
    aliases: ["hdl", "hdl_cholesterol", "hdl-cholesterol", "hdlc", "hdl_c"],
    biomarkerKey: "biomarker:hdl-c",
    canonicalUnit: "mg/dL",
    category: "lab",
    displayName: "HDL-C",
    displayUnit: "mg/dL",
    key: "hdl-c",
    selectionPolicy: { kind: "latest-lab", preferCollectedAt: true, staleAfterDays: 365 },
    valuePrecision: 0,
  }),
  metric({
    aliases: ["tg", "triglyceride"],
    biomarkerKey: "biomarker:triglycerides",
    canonicalUnit: "mg/dL",
    category: "lab",
    displayName: "Triglycerides",
    displayUnit: "mg/dL",
    key: "triglycerides",
    selectionPolicy: { kind: "latest-lab", preferCollectedAt: true, staleAfterDays: 365 },
    valuePrecision: 0,
  }),
  metric({
    aliases: ["a1c", "hba1c", "hemoglobin-a1c", "hemoglobin_a1c"],
    biomarkerKey: "biomarker:hba1c",
    canonicalUnit: "percent",
    category: "lab",
    displayName: "HbA1c",
    displayUnit: "percent",
    key: "hba1c",
    selectionPolicy: { kind: "latest-lab", preferCollectedAt: true, staleAfterDays: 365 },
    valuePrecision: 1,
  }),
  metric({
    aliases: ["alanine-aminotransferase", "alanine_aminotransferase"],
    biomarkerKey: "biomarker:alt",
    canonicalUnit: "U/L",
    category: "lab",
    displayName: "ALT",
    displayUnit: "U/L",
    key: "alt",
    selectionPolicy: { kind: "latest-lab", preferCollectedAt: true, staleAfterDays: 365 },
    valuePrecision: 0,
  }),
  metric({
    aliases: ["aspartate-aminotransferase", "aspartate_aminotransferase"],
    biomarkerKey: "biomarker:ast",
    canonicalUnit: "U/L",
    category: "lab",
    displayName: "AST",
    displayUnit: "U/L",
    key: "ast",
    selectionPolicy: { kind: "latest-lab", preferCollectedAt: true, staleAfterDays: 365 },
    valuePrecision: 0,
  }),
  metric({
    aliases: ["gamma-glutamyl-transferase", "gamma_glutamyl_transferase"],
    biomarkerKey: "biomarker:ggt",
    canonicalUnit: "U/L",
    category: "lab",
    displayName: "GGT",
    displayUnit: "U/L",
    key: "ggt",
    selectionPolicy: { kind: "latest-lab", preferCollectedAt: true, staleAfterDays: 365 },
    valuePrecision: 0,
  }),
  metric({
    aliases: ["crp", "hs_crp", "high-sensitivity-crp", "high_sensitivity_crp", "c-reactive-protein"],
    biomarkerKey: "biomarker:hs-crp",
    canonicalUnit: "mg/L",
    category: "lab",
    displayName: "hs-CRP",
    displayUnit: "mg/L",
    key: "hs-crp",
    selectionPolicy: { kind: "latest-lab", preferCollectedAt: true, staleAfterDays: 365 },
    valuePrecision: 1,
  }),
  metric({
    aliases: [],
    biomarkerKey: "biomarker:ferritin",
    canonicalUnit: "ng/mL",
    category: "lab",
    displayName: "Ferritin",
    displayUnit: "ng/mL",
    key: "ferritin",
    selectionPolicy: { kind: "latest-lab", preferCollectedAt: true, staleAfterDays: 365 },
    valuePrecision: 0,
  }),
];

const DEFINITIONS_BY_KEY = new Map(METRIC_DEFINITIONS.map((definition) => [definition.key, definition]));
const DEFINITIONS_BY_ALIAS = new Map<string, MetricDefinition>();
const PRIMARY_METRIC_BY_BIOMARKER = new Map<string, MetricDefinition>();

for (const definition of METRIC_DEFINITIONS) {
  for (const alias of [definition.key, ...definition.aliases]) {
    DEFINITIONS_BY_ALIAS.set(normalizeMetricKey(alias), definition);
  }
  if (definition.biomarkerKey && !PRIMARY_METRIC_BY_BIOMARKER.has(definition.biomarkerKey)) {
    PRIMARY_METRIC_BY_BIOMARKER.set(definition.biomarkerKey, definition);
  }
  for (const biomarkerAlias of definition.biomarkerAliases ?? []) {
    if (!PRIMARY_METRIC_BY_BIOMARKER.has(biomarkerAlias)) {
      PRIMARY_METRIC_BY_BIOMARKER.set(biomarkerAlias, definition);
    }
  }
}

function metric(definition: MetricDefinition): MetricDefinition {
  return definition;
}

export function listMetricDefinitions(): MetricDefinition[] {
  return METRIC_DEFINITIONS.slice();
}

export function normalizeMetricKey(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .toLowerCase()
    .replace(/[_\s/]+/gu, "-")
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

export function resolveMetricDefinition(value: string): MetricDefinition | null {
  const key = normalizeMetricKey(value);
  return DEFINITIONS_BY_KEY.get(key) ?? DEFINITIONS_BY_ALIAS.get(key) ?? null;
}

export function resolveMetricDefinitionForBiomarker(biomarkerKey: string): MetricDefinition | null {
  return PRIMARY_METRIC_BY_BIOMARKER.get(biomarkerKey) ?? null;
}

export function createCustomMetricDefinition(metricKey: string, unit: string | null = null): MetricDefinition {
  const normalizedKey = normalizeMetricKey(metricKey);
  return metric({
    aliases: [],
    biomarkerKey: null,
    canonicalUnit: null,
    category: "custom",
    displayName: humanizeMetricKey(normalizedKey),
    displayUnit: unit,
    key: normalizedKey,
    selectionPolicy: { kind: "latest-valid", staleAfterDays: DEFAULT_STALE_AFTER_DAYS },
    valuePrecision: guessValuePrecision(unit),
  });
}

export function normalizeMetricValue(input: {
  metricKey: string;
  unit: string | null;
  value: number | null;
}): MetricValueNormalization {
  const definition = resolveMetricDefinition(input.metricKey) ?? createCustomMetricDefinition(input.metricKey, input.unit);
  const unit = normalizeUnit(input.unit);

  if (input.value === null || !Number.isFinite(input.value)) {
    return { canonicalUnit: null, canonicalValue: null, unit, warnings: [] };
  }

  switch (definition.key) {
    case "body-weight":
      return normalizeWeight(input.value, unit);
    case "body-fat-percentage":
    case "hba1c":
      return normalizePercent(input.value, unit, definition.displayName);
    case "glucose":
      return normalizeMassConcentration(input.value, unit, "mg/dL", 18.0182, definition.displayName);
    case "ldl-c":
    case "hdl-c":
      return normalizeMassConcentration(input.value, unit, "mg/dL", 38.67, definition.displayName);
    case "triglycerides":
      return normalizeMassConcentration(input.value, unit, "mg/dL", 88.57, definition.displayName);
    case "apob":
      return normalizeApoB(input.value, unit);
    case "hs-crp":
      return normalizeExactUnit(input.value, unit, "mg/L", definition.displayName);
    case "ferritin":
      return normalizeExactUnit(input.value, unit, "ng/mL", definition.displayName);
    case "alt":
    case "ast":
    case "ggt":
      return normalizeExactUnit(input.value, unit, "U/L", definition.displayName);
    default: {
      const canonicalUnit = definition.canonicalUnit && (!unit || unitsEquivalent(unit, definition.canonicalUnit))
        ? definition.canonicalUnit
        : null;
      return {
        canonicalUnit,
        canonicalValue: canonicalUnit ? input.value : null,
        unit: unit ?? definition.displayUnit,
        warnings: canonicalUnit || !definition.canonicalUnit
          ? []
          : [unitWarning(definition.displayName, unit, definition.canonicalUnit)],
      };
    }
  }
}

export function selectMetricValue(input: {
  metricKey?: string;
  biomarkerKey?: string;
  now?: string;
  points: readonly MetricPoint[];
  policyOverride?: MetricSelectionPolicy;
}): MetricSelection {
  const definitionFromBiomarker = input.biomarkerKey ? resolveMetricDefinitionForBiomarker(input.biomarkerKey) : null;
  const metricKey = input.metricKey ? normalizeMetricKey(input.metricKey) : definitionFromBiomarker?.key ?? null;
  const biomarkerKeys = input.biomarkerKey
    ? biomarkerSelectionKeys(input.biomarkerKey, definitionFromBiomarker)
    : null;
  const points = input.points.filter((point) => {
    if (metricKey && point.metricKey !== metricKey) return false;
    if (biomarkerKeys && (!point.biomarkerKey || !biomarkerKeys.includes(point.biomarkerKey))) return false;
    return true;
  });
  const resolvedMetricKey = metricKey ?? points[0]?.metricKey ?? "unknown";
  const definition = resolveMetricDefinition(resolvedMetricKey) ?? createCustomMetricDefinition(resolvedMetricKey);

  if (points.length === 0) {
    return emptySelection(definition, input.biomarkerKey ?? definition.biomarkerKey ?? null, "no_data");
  }

  const selected = selectPointByPolicy(points, input.policyOverride ?? definition.selectionPolicy);
  if (!selected) {
    return emptySelection(definition, input.biomarkerKey ?? definition.biomarkerKey ?? null, "no_data");
  }

  const warnings = collectSelectionWarnings({ definition, now: input.now, points, selected });
  const value = selected.canonicalValue ?? selected.value;
  const unit = selected.canonicalUnit ?? selected.unit ?? definition.displayUnit;

  return {
    biomarkerKey: selected.biomarkerKey,
    confidence: selected.confidence,
    effectiveDate: selected.effectiveDate,
    metricKey: selected.metricKey,
    observedAt: selected.observedAt,
    point: selected,
    provenance: {
      pointIds: [selected.id],
      recordIds: [selected.source.recordId],
      sourceKinds: uniqueStrings(points.map((point) => point.source.kind)),
    },
    schemaVersion: METRIC_SELECTION_SCHEMA_VERSION,
    sourceLabel: selected.provenance.sourceLabel,
    status: warnings.some((warning) => warning.code === "SOURCE_STALE") ? "stale" : "ready",
    unit,
    value,
    valueLabel: formatMetricDisplayValue(selected, definition),
    warnings,
  };
}

export function buildMetricSeries(input: {
  biomarkerKey?: string;
  from?: string;
  metricKey?: string;
  points: readonly MetricPoint[];
  to?: string;
}): MetricPoint[] {
  const definitionFromBiomarker = input.biomarkerKey ? resolveMetricDefinitionForBiomarker(input.biomarkerKey) : null;
  const metricKey = input.metricKey ? normalizeMetricKey(input.metricKey) : definitionFromBiomarker?.key ?? null;
  const biomarkerKeys = input.biomarkerKey
    ? biomarkerSelectionKeys(input.biomarkerKey, definitionFromBiomarker)
    : null;
  return input.points
    .filter((point) => !metricKey || point.metricKey === metricKey)
    .filter((point) => !biomarkerKeys || (point.biomarkerKey !== null && biomarkerKeys.includes(point.biomarkerKey)))
    .filter((point) => !input.from || point.effectiveDate >= input.from)
    .filter((point) => !input.to || point.effectiveDate <= input.to)
    .sort(compareMetricPointsAsc);
}

function biomarkerSelectionKeys(
  biomarkerKey: string,
  definition: MetricDefinition | null,
): string[] {
  return uniqueStrings([
    biomarkerKey,
    ...(definition?.biomarkerKey ? [definition.biomarkerKey] : []),
  ]);
}

export function selectMetricGoalProgress(input: {
  goalId: string;
  now?: string;
  points: readonly MetricPoint[];
  target: GoalMetricTarget;
}): MetricGoalProgress {
  const metricKey = normalizeMetricKey(input.target.metricKey);
  const definition = resolveMetricDefinition(metricKey) ?? createCustomMetricDefinition(metricKey, input.target.unit);
  const targetValueLabel = formatTargetValue(input.target, definition);
  const current = selectGoalMetricTargetValue({
    definition,
    metricKey,
    now: input.now,
    points: input.points,
    target: input.target,
  });

  if (current.value === null) {
    return {
      currentValue: null,
      currentValueLabel: null,
      deltaToTarget: null,
      goalId: input.goalId,
      metricKey,
      selectedPointIds: [],
      status: current.status,
      targetId: input.target.targetId,
      targetValueLabel,
      unit: input.target.unit,
      warnings: current.warnings,
    };
  }

  const met = targetMet(current.value, input.target);
  const deltaToTarget = deltaForTarget(current.value, input.target);
  return {
    currentValue: current.value,
    currentValueLabel: current.valueLabel,
    deltaToTarget,
    goalId: input.goalId,
    metricKey,
    selectedPointIds: current.selectedPointIds,
    status: current.status === "stale" ? "stale" : met ? "met" : "behind",
    targetId: input.target.targetId,
    targetValueLabel,
    unit: current.unit ?? input.target.unit,
    warnings: current.warnings,
  };
}

interface GoalMetricTargetValueSelection {
  selectedPointIds: string[];
  status: MetricGoalProgress["status"];
  unit: string | null;
  value: number | null;
  valueLabel: string | null;
  warnings: MetricSelectionWarning[];
}

function selectGoalMetricTargetValue(input: {
  definition: MetricDefinition;
  metricKey: string;
  now?: string;
  points: readonly MetricPoint[];
  target: GoalMetricTarget;
}): GoalMetricTargetValueSelection {
  switch (input.target.evaluation.kind) {
    case "rolling-window":
      return selectRollingWindowGoalMetricValue(input);
    case "latest-lab":
      return metricSelectionToGoalTargetValue(selectMetricValue({
        biomarkerKey: input.target.biomarkerKey,
        metricKey: input.metricKey,
        now: input.now,
        points: input.points,
        policyOverride: { kind: "latest-lab", preferCollectedAt: true, staleAfterDays: input.definition.selectionPolicy.staleAfterDays },
      }));
    case "selected-value":
      return metricSelectionToGoalTargetValue(selectMetricValue({
        biomarkerKey: input.target.biomarkerKey,
        metricKey: input.metricKey,
        now: input.now,
        points: input.points,
        policyOverride: input.target.selectionPolicyOverride,
      }));
  }
}

function metricSelectionToGoalTargetValue(selection: MetricSelection): GoalMetricTargetValueSelection {
  if (!selection.point || selection.value === null) {
    return {
      selectedPointIds: [],
      status: selection.status === "unsupported" ? "unsupported" : "no_data",
      unit: selection.unit,
      value: null,
      valueLabel: null,
      warnings: selection.warnings,
    };
  }

  return {
    selectedPointIds: selection.provenance.pointIds,
    status: selection.status === "stale" ? "stale" : "behind",
    unit: selection.unit,
    value: selection.value,
    valueLabel: selection.valueLabel,
    warnings: selection.warnings,
  };
}

function selectRollingWindowGoalMetricValue(input: {
  definition: MetricDefinition;
  metricKey: string;
  now?: string;
  points: readonly MetricPoint[];
  target: GoalMetricTarget;
}): GoalMetricTargetValueSelection {
  const evaluation = input.target.evaluation;
  if (evaluation.kind !== "rolling-window") {
    return metricSelectionToGoalTargetValue(selectMetricValue({
      biomarkerKey: input.target.biomarkerKey,
      metricKey: input.metricKey,
      now: input.now,
      points: input.points,
      policyOverride: input.target.selectionPolicyOverride,
    }));
  }

  const candidates = buildMetricSeries({
    biomarkerKey: input.target.biomarkerKey,
    metricKey: input.metricKey,
    points: input.points,
  }).filter((point) => {
    const value = point.canonicalValue ?? point.value;
    if (value === null || !Number.isFinite(value)) return false;
    if (input.target.startAt && point.effectiveDate < input.target.startAt) return false;
    if (input.target.targetAt && point.effectiveDate > input.target.targetAt) return false;
    return true;
  });

  const anchorDate = input.now ? toIsoDate(input.now) : candidates.at(-1)?.effectiveDate ?? null;
  if (!anchorDate) {
    return { selectedPointIds: [], status: "no_data", unit: input.target.unit, value: null, valueLabel: null, warnings: [] };
  }

  const windowStart = subtractIsoDays(anchorDate, Math.max(0, evaluation.windowDays - 1));
  const windowPoints = candidates.filter((point) => point.effectiveDate >= windowStart && point.effectiveDate <= anchorDate);
  if (windowPoints.length === 0) {
    return { selectedPointIds: [], status: "no_data", unit: input.target.unit, value: null, valueLabel: null, warnings: [] };
  }

  const latestPoint = windowPoints.at(-1)!;
  const unit = latestPoint.canonicalUnit ?? latestPoint.unit ?? input.target.unit;
  const value = aggregateGoalMetricValues(windowPoints, evaluation.statistic);
  const warnings = collectRollingGoalWarnings({
    definition: input.definition,
    evaluation,
    latestPoint,
    now: input.now,
    points: windowPoints,
  });

  return {
    selectedPointIds: windowPoints.map((point) => point.id),
    status: warnings.some((warning) => warning.code === "SOURCE_STALE") ? "stale" : "behind",
    unit,
    value,
    valueLabel: formatGoalMetricValue(value, input.definition),
    warnings,
  };
}

function collectRollingGoalWarnings(input: {
  definition: MetricDefinition;
  evaluation: { kind: "rolling-window"; statistic: "mean" | "median"; windowDays: number };
  latestPoint: MetricPoint;
  now?: string;
  points: readonly MetricPoint[];
}): MetricSelectionWarning[] {
  const warnings: MetricSelectionWarning[] = [];
  const staleAfterDays = staleAfterDaysForPolicy(input.definition.selectionPolicy);
  if (input.now && staleAfterDays !== null && isOlderThanDays(input.latestPoint.observedAt, input.now, staleAfterDays)) {
    warnings.push({
      code: "SOURCE_STALE",
      message: `${input.definition.displayName} has not synced in the last ${staleAfterDays} days.`,
    });
  }
  if (input.points.length < input.evaluation.windowDays) {
    warnings.push({
      code: "LOW_SAMPLE_COUNT",
      message: `${input.definition.displayName} rolling goal used ${input.points.length} value${input.points.length === 1 ? "" : "s"} across a ${input.evaluation.windowDays}-day window.`,
    });
  }
  if (uniqueStrings(input.points.map((point) => point.source.kind)).length > 1) {
    warnings.push({
      code: "MIXED_SOURCES",
      message: `${input.definition.displayName} rolling goal used values from multiple source types.`,
    });
  }
  return dedupeWarnings(warnings);
}

function aggregateGoalMetricValues(points: readonly MetricPoint[], statistic: "mean" | "median"): number {
  const values = points
    .map((point) => point.canonicalValue ?? point.value)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) return 0;
  if (statistic === "mean") {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  const sorted = values.slice().sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[midpoint - 1] ?? 0) + (sorted[midpoint] ?? 0)) / 2
    : sorted[midpoint] ?? 0;
}

function formatGoalMetricValue(value: number, definition: MetricDefinition): string {
  return Number(value.toFixed(definition.valuePrecision)).toString();
}

function toIsoDate(value: string): string {
  return value.includes("T") ? value.slice(0, 10) : value;
}

function subtractIsoDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) return date;
  parsed.setUTCDate(parsed.getUTCDate() - days);
  return parsed.toISOString().slice(0, 10);
}

export function formatMetricDisplayValue(point: MetricPoint, definition: MetricDefinition | null = null): string {
  const resolved = definition ?? resolveMetricDefinition(point.metricKey) ?? createCustomMetricDefinition(point.metricKey, point.unit);
  if (point.textValue && point.value === null && point.canonicalValue === null) {
    return point.textValue;
  }
  const value = point.canonicalValue ?? point.value;
  if (value === null) {
    return point.textValue ?? "—";
  }
  return `${point.comparator ?? ""}${Number(value.toFixed(resolved.valuePrecision)).toString()}`;
}

function selectPointByPolicy(points: readonly MetricPoint[], policy: MetricSelectionPolicy): MetricPoint | null {
  switch (policy.kind) {
    case "latest-lab": {
      const labPoints = points.filter((point) => point.source.kind === "test-result");
      const candidates = labPoints.length > 0 ? labPoints : points;
      return candidates.slice().sort((left, right) => compareMetricPointsForSelection(left, right, { preferFasting: policy.preferFasting })).at(0) ?? null;
    }
    case "qualified-latest": {
      return points
        .filter((point) => qualifiersMatch(point.context.qualifiers, policy.requiredQualifiers))
        .slice()
        .sort(compareMetricPointsForSelection)
        .at(0) ?? null;
    }
    case "latest-device-estimate":
    case "latest-valid":
      return points.slice().sort(compareMetricPointsForSelection).at(0) ?? null;
  }
}

function collectSelectionWarnings(input: {
  definition: MetricDefinition;
  now?: string;
  points: readonly MetricPoint[];
  selected: MetricPoint;
}): MetricSelectionWarning[] {
  const warnings: MetricSelectionWarning[] = [];
  const staleAfterDays = staleAfterDaysForPolicy(input.definition.selectionPolicy);

  if (input.now && staleAfterDays !== null && isOlderThanDays(input.selected.observedAt, input.now, staleAfterDays)) {
    warnings.push({
      code: "SOURCE_STALE",
      message: `${input.definition.displayName} has not synced in the last ${staleAfterDays} days.`,
    });
  }

  if (uniqueStrings(input.points.map((point) => point.source.kind)).length > 1) {
    warnings.push({
      code: "MIXED_SOURCES",
      message: `${input.definition.displayName} has values from multiple source types; Murph selected the highest-priority value for this metric policy.`,
    });
  }

  if (input.selected.comparator) {
    warnings.push({
      code: "COMPARATOR_VALUE",
      message: `${input.definition.displayName} was reported with a comparator (${input.selected.comparator}); exact trend math should treat it cautiously.`,
    });
  }

  const normalization = normalizeMetricValue({
    metricKey: input.selected.metricKey,
    unit: input.selected.unit,
    value: input.selected.value,
  });
  warnings.push(...normalization.warnings);

  return dedupeWarnings(warnings);
}

function emptySelection(
  definition: MetricDefinition,
  biomarkerKey: string | null,
  status: MetricSelectionStatus,
): MetricSelection {
  return {
    biomarkerKey,
    confidence: "none",
    effectiveDate: null,
    metricKey: definition.key,
    observedAt: null,
    point: null,
    provenance: { pointIds: [], recordIds: [], sourceKinds: [] },
    schemaVersion: METRIC_SELECTION_SCHEMA_VERSION,
    sourceLabel: null,
    status,
    unit: definition.displayUnit,
    value: null,
    valueLabel: null,
    warnings: [],
  };
}

function compareMetricPointsForSelection(
  left: MetricPoint,
  right: MetricPoint,
  options: { preferFasting?: boolean } = {},
): number {
  if (options.preferFasting) {
    const fastingDelta = fastingRank(right) - fastingRank(left);
    if (fastingDelta !== 0) return fastingDelta;
  }

  if (left.effectiveDate !== right.effectiveDate) return right.effectiveDate.localeCompare(left.effectiveDate);

  const priorityDelta = sourcePriority(left) - sourcePriority(right);
  if (priorityDelta !== 0) return priorityDelta;

  if (left.observedAt !== right.observedAt) return right.observedAt.localeCompare(left.observedAt);
  return left.id.localeCompare(right.id);
}

function compareMetricPointsAsc(left: MetricPoint, right: MetricPoint): number {
  if (left.effectiveDate !== right.effectiveDate) return left.effectiveDate.localeCompare(right.effectiveDate);
  if (left.observedAt !== right.observedAt) return left.observedAt.localeCompare(right.observedAt);
  return left.id.localeCompare(right.id);
}

function sourcePriority(point: MetricPoint): number {
  switch (point.source.kind) {
    case "test-result": return 0;
    case "measurement": return 1;
    case "compat-body-measurement":
    case "compat-observation": return 2;
    case "wearable-summary": return 3;
    case "activity-summary": return 4;
    case "sleep-summary": return 5;
    case "sample-summary": return 6;
    default: return 7;
  }
}

function fastingRank(point: MetricPoint): number {
  return point.context.fastingStatus === "fasting" ? 1 : 0;
}

function staleAfterDaysForPolicy(policy: MetricSelectionPolicy): number | null {
  return "staleAfterDays" in policy && policy.staleAfterDays !== undefined ? policy.staleAfterDays : null;
}

function isOlderThanDays(dateOrDateTime: string, nowDateTime: string, days: number): boolean {
  const observed = new Date(dateOrDateTime.includes("T") ? dateOrDateTime : `${dateOrDateTime}T00:00:00.000Z`);
  const now = new Date(nowDateTime.includes("T") ? nowDateTime : `${nowDateTime}T00:00:00.000Z`);
  if (!Number.isFinite(observed.getTime()) || !Number.isFinite(now.getTime())) return false;
  return now.getTime() - observed.getTime() > days * ISO_DAY_MS;
}

function normalizeWeight(value: number, unit: string | null): MetricValueNormalization {
  if (!unit || unitsEquivalent(unit, "kg")) return { canonicalUnit: "kg", canonicalValue: value, unit: unit ?? "kg", warnings: [] };
  if (unit === "lb" || unit === "lbs" || unit === "pound" || unit === "pounds") {
    return { canonicalUnit: "kg", canonicalValue: Number((value * 0.45359237).toFixed(4)), unit, warnings: [] };
  }
  return { canonicalUnit: null, canonicalValue: null, unit, warnings: [unitWarning("Body weight", unit, "kg")] };
}

function normalizePercent(value: number, unit: string | null, label: string): MetricValueNormalization {
  if (!unit || unitsEquivalent(unit, "percent")) return { canonicalUnit: "percent", canonicalValue: value, unit: unit ?? "percent", warnings: [] };
  return { canonicalUnit: null, canonicalValue: null, unit, warnings: [unitWarning(label, unit, "percent")] };
}

function normalizeMassConcentration(
  value: number,
  unit: string | null,
  canonicalUnit: "mg/dL",
  mmolFactor: number,
  label: string,
): MetricValueNormalization {
  if (!unit || unitsEquivalent(unit, canonicalUnit)) return { canonicalUnit, canonicalValue: value, unit: unit ?? canonicalUnit, warnings: [] };
  if (unit === "mmol/l") {
    return { canonicalUnit, canonicalValue: Number((value * mmolFactor).toFixed(4)), unit, warnings: [] };
  }
  return { canonicalUnit: null, canonicalValue: null, unit, warnings: [unitWarning(label, unit, canonicalUnit)] };
}

function normalizeApoB(value: number, unit: string | null): MetricValueNormalization {
  if (!unit || unitsEquivalent(unit, "mg/dL")) return { canonicalUnit: "mg/dL", canonicalValue: value, unit: unit ?? "mg/dL", warnings: [] };
  if (unit === "g/L") {
    return { canonicalUnit: "mg/dL", canonicalValue: Number((value * 100).toFixed(4)), unit, warnings: [] };
  }
  return { canonicalUnit: null, canonicalValue: null, unit, warnings: [unitWarning("ApoB", unit, "mg/dL")] };
}

function normalizeExactUnit(value: number, unit: string | null, canonicalUnit: string, label: string): MetricValueNormalization {
  if (!unit || unitsEquivalent(unit, canonicalUnit)) return { canonicalUnit, canonicalValue: value, unit: unit ?? canonicalUnit, warnings: [] };
  return { canonicalUnit: null, canonicalValue: null, unit, warnings: [unitWarning(label, unit, canonicalUnit)] };
}

function normalizeUnit(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  switch (lower) {
    case "%":
    case "pct":
    case "percentage": return "percent";
    case "mg_dl":
    case "mg/dl": return "mg/dL";
    case "g_l":
    case "g/l": return "g/L";
    case "mg_l":
    case "mg/l": return "mg/L";
    case "ng_ml":
    case "ng/ml": return "ng/mL";
    case "u/l":
    case "iu/l": return "U/L";
    default: return lower;
  }
}

function unitsEquivalent(left: string, right: string): boolean {
  return normalizeUnit(left) === normalizeUnit(right);
}

function unitWarning(label: string, actual: string | null, expected: string): MetricSelectionWarning {
  return {
    code: "UNIT_NOT_NORMALIZED",
    message: `${label} was reported in ${actual ?? "an unknown unit"}; Murph did not convert it to ${expected}.`,
  };
}

function dedupeWarnings(warnings: readonly MetricSelectionWarning[]): MetricSelectionWarning[] {
  const seen = new Set<string>();
  const output: MetricSelectionWarning[] = [];
  for (const warning of warnings) {
    const key = `${warning.code}:${warning.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      output.push(warning);
    }
  }
  return output;
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}

function qualifiersMatch(
  actual: Record<string, string | number | boolean> | undefined,
  required: Record<string, string | number | boolean>,
): boolean {
  if (!actual) return Object.keys(required).length === 0;
  return Object.entries(required).every(([key, value]) => actual[key] === value);
}

function formatTargetValue(target: GoalMetricTarget, definition: MetricDefinition): string {
  const precision = definition.valuePrecision;
  if (target.comparator === "between") {
    return `${Number(target.value.toFixed(precision)).toString()}-${Number((target.highValue ?? target.value).toFixed(precision)).toString()} ${target.unit}`;
  }
  return `${target.comparator}${Number(target.value.toFixed(precision)).toString()} ${target.unit}`;
}

function targetMet(value: number, target: GoalMetricTarget): boolean {
  switch (target.comparator) {
    case "<": return value < target.value;
    case "<=": return value <= target.value;
    case ">": return value > target.value;
    case ">=": return value >= target.value;
    case "between": return value >= target.value && value <= (target.highValue ?? target.value);
  }
}

function deltaForTarget(value: number, target: GoalMetricTarget): number {
  switch (target.comparator) {
    case "<":
    case "<=": return value - target.value;
    case ">":
    case ">=": return target.value - value;
    case "between": {
      const high = target.highValue ?? target.value;
      if (value < target.value) return target.value - value;
      if (value > high) return value - high;
      return 0;
    }
  }
}

function humanizeMetricKey(value: string): string {
  return value
    .split(/[-_\s]+/u)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function guessValuePrecision(unit: string | null): number {
  const normalized = unit ? normalizeUnit(unit) : null;
  return normalized === "percent" || normalized === "kg" ? 1 : 0;
}
