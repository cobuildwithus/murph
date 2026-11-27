import { formatDuration, formatHealthWinDistance, formatNumber, roundHealthWinDistance } from "./shared";
import type { Filter, Metric } from "./types";

interface MetricInfo {
  label: string;
  unit: string;
  filter: Filter;
  direction: 1 | -1;
  trendStep?: number;
  record?: true;
  physiological?: true;
  min: number;
  max: number;
  priority: readonly string[];
}

const sleepDevices = ["whoop", "oura", "garmin", "apple watch", "apple"];
const activitySources = ["apple", "apple watch", "google", "garmin"];

const metrics: Record<Metric, MetricInfo> = {
  sleep_total_min: {
    label: "sleep", unit: "min", filter: "Sleep", direction: 1, trendStep: 15,
    min: 180, max: 840, physiological: true, priority: sleepDevices,
  },
  sleep_deep_min: {
    label: "deep sleep", unit: "min", filter: "Sleep", direction: 1, trendStep: 15, record: true,
    min: 0, max: 300, physiological: true, priority: sleepDevices,
  },
  sleep_score: {
    label: "sleep score", unit: "points", filter: "Sleep", direction: 1,
    min: 0, max: 100, physiological: true, priority: sleepDevices,
  },
  sleep_efficiency: {
    label: "sleep efficiency", unit: "%", filter: "Sleep", direction: 1,
    min: 0, max: 100, physiological: true, priority: sleepDevices,
  },
  rhr_bpm: {
    label: "RHR", unit: "bpm", filter: "Heart", direction: -1, trendStep: 2, record: true,
    min: 30, max: 120, physiological: true, priority: sleepDevices,
  },
  hrv_ms: {
    label: "heart rate variability", unit: "ms", filter: "Heart", direction: 1, trendStep: 3, record: true,
    min: 5, max: 250, physiological: true, priority: sleepDevices,
  },
  steps: {
    label: "steps", unit: "steps", filter: "Fitness", direction: 1, trendStep: 1000, record: true,
    min: 0, max: 60_000, priority: ["whoop", "garmin", "google", "apple", "apple watch"],
  },
  distance_km: {
    label: "on foot", unit: "km", filter: "Fitness", direction: 1, trendStep: 1, record: true,
    min: 0, max: 60, priority: activitySources,
  },
  floors: {
    label: "floors", unit: "floors", filter: "Fitness", direction: 1,
    min: 0, max: 400, priority: activitySources,
  },
  vo2max: {
    label: "VO2 max", unit: "mL/kg/min", filter: "Fitness", direction: 1,
    min: Number.MIN_VALUE, max: Infinity, priority: ["garmin", "apple watch", "apple"],
  },
};

export const metricNames: readonly Metric[] = (Object.keys(metrics) as Metric[]).sort();

export function metricInfo(metric: Metric): MetricInfo {
  return metrics[metric];
}

export function roundMetricValue(metric: Metric, value: number): number {
  const { unit } = metricInfo(metric);
  if (unit === "km") return roundHealthWinDistance(value);
  const scale = unit === "%" ? 10 : 1;
  return Math.round(value * scale) / scale;
}

export function formatMetricValue(metric: Metric, value: number, style: "full" | "title" | "delta" = "full"): string {
  const { label, unit } = metricInfo(metric);
  if (unit === "min" && style !== "delta") return formatDuration(value);
  const sign = style === "delta" ? (value < 0 ? "−" : "+") : "";
  if (unit === "km") return `${sign}${formatHealthWinDistance(Math.abs(value))} km`;
  const number = sign + formatNumber(roundMetricValue(metric, Math.abs(value)));
  if (style !== "full" && (unit === label || metric === "sleep_score")) return number;
  return unit === "%" ? `${number}%` : `${number} ${unit}`;
}

export function isMetric(value: string): value is Metric {
  return Object.hasOwn(metrics, value);
}
