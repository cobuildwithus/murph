export const METRIC_POINT_SCHEMA_VERSION = "murph.metric-point.v1" as const;
export const METRIC_SELECTION_SCHEMA_VERSION = "murph.metric-selection.v1" as const;

export type MetricConfidence = "none" | "low" | "medium" | "high";
export type MetricGrain = "instant" | "event" | "day" | "week" | "month" | "window";
export type MetricStatistic = "value" | "latest" | "mean" | "median" | "min" | "max" | "sum" | "count";
export type MetricComparator = "<" | "<=" | ">" | ">=";
export type MetricCategory =
  | "activity"
  | "body"
  | "custom"
  | "fitness"
  | "function"
  | "lab"
  | "recovery"
  | "sleep"
  | "vital";
export type MetricSourceFamily = "derived" | "event" | "sample";
export type MetricSourceKind =
  | "activity-summary"
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
  | {
      kind: "daily-aggregate";
      latestWindowDays?: number;
      minimumPoints?: number;
      staleAfterDays?: number;
      statistic: "mean" | "median" | "min" | "max" | "sum" | "count";
    }
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
  causalSeq?: string;
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

export type MetricSeriesDuplicatePolicy =
  | "keep-all"
  | "latest-observed"
  | "selection-policy";

export type MetricSeriesAggregation =
  | "count"
  | "latest"
  | "mean"
  | "median"
  | "min"
  | "max"
  | "sum";

export interface MetricSeriesPoint {
  biomarkerKey?: string | null;
  comparator?: MetricComparator | null;
  confidence?: MetricConfidence;
  context?: MetricPointContext;
  date: string;
  grain?: MetricGrain;
  id?: string;
  metricKey: string;
  observedAt?: string;
  pointIds?: string[];
  recordIds?: string[];
  sourceFamily?: MetricSourceFamily | null;
  sourceKind?: MetricSourceKind | null;
  sourceKinds?: string[];
  sourceLabel?: string | null;
  statistic?: MetricStatistic;
  unit: string | null;
  value: number | null;
  valueLabel?: string | null;
}

export interface MetricSeries {
  biomarkerKey: string | null;
  metricKey: string;
  provenance: {
    pointIds: string[];
    recordIds: string[];
    sourceKinds: string[];
  };
  rows: MetricSeriesPoint[];
  status: MetricSelectionStatus;
  warnings: MetricSelectionWarning[];
}

export interface ListMetricPointsInput {
  biomarkerKey?: string;
  from?: string;
  grain?: MetricGrain;
  metricKey?: string;
  points: readonly MetricPoint[];
  statistic?: MetricStatistic;
  to?: string;
}

export interface SelectMetricSeriesInput extends ListMetricPointsInput {
  aggregation?: MetricSeriesAggregation;
  duplicatePolicy?: MetricSeriesDuplicatePolicy;
  minimumPoints?: number;
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
  status: MetricGoalProgressStatus;
  targetId: string;
  targetValueLabel: string;
  unit: string;
  warnings: MetricSelectionWarning[];
}

export type MetricGoalProgressStatus =
  | "behind"
  | "met"
  | "no_data"
  | "not_met"
  | "stale"
  | "unsupported";
