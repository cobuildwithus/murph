import { formatNumber } from "@/src/lib/browser-vault/display";
import type {
  ExperimentRunProjection,
  ExperimentSignal,
  TrendData,
} from "@/src/types/experiments";

export interface ExperimentRunCardMetric {
  baseline?: string;
  current: string;
  delta?: string;
  label: string;
  sentiment?: ExperimentSignal["sentiment"];
}

export interface ExperimentRunCardSummary {
  completionPercent?: number;
  dateRange?: string;
  day?: number;
  metric?: ExperimentRunCardMetric;
}

export function buildExperimentRunCardSummary(
  run: ExperimentRunProjection,
): ExperimentRunCardSummary {
  const primaryTrend = run.trends.find(hasTrendPoints);
  const primarySignal = (primaryTrend
    ? run.signals.find((signal) => signal.label === primaryTrend.label)
    : undefined) ?? run.signals[0];

  return {
    completionPercent: run.completionPercent,
    dateRange: run.dateRange,
    day: run.day,
    metric: buildMetric(primarySignal, primaryTrend),
  };
}

function buildMetric(
  signal: ExperimentSignal | undefined,
  trend: TrendData | undefined,
): ExperimentRunCardMetric | undefined {
  if (!signal && !trend) {
    return undefined;
  }

  return {
    baseline: signal?.baseline ?? (trend
      ? formatValueWithUnit(trend.baselineAvg, trend.unit)
      : undefined),
    current: signal
      ? formatSignalValue(signal)
      : formatTrendValue(trend),
    delta: signal?.delta || trend?.delta || undefined,
    label: signal?.label ?? trend?.label ?? "Primary signal",
    sentiment: signal?.sentiment,
  };
}

function hasTrendPoints(trend: TrendData): boolean {
  return trend.baseline.length > 0 || trend.active.length > 0;
}

function formatSignalValue(signal: ExperimentSignal): string {
  return signal.unit ? `${signal.value} ${signal.unit}` : signal.value;
}

function formatTrendValue(trend: TrendData | undefined): string {
  if (!trend) return "—";
  return formatValueWithUnit(trend.currentValue, trend.unit);
}

function formatValueWithUnit(value: number, unit: string): string {
  const formatted = formatNumber(value, {
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 1,
  });
  return unit ? `${formatted} ${unit}` : formatted;
}
