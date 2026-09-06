import {
  addDaysToIsoDate,
  formatTimeZoneDateTimeParts,
  isValidIanaTimeZone,
  wearableTrendMetricKeyValues,
  type WearableTrendDirection,
  type WearableTrendMetricKey,
} from "@murphai/contracts";
import {
  resolveMetricDefinition,
  selectMetricSeries,
  type MetricPoint,
} from "@murphai/health-metrics";

import { listWearableSleepDailyValues } from "./sleep-pattern.ts";
import type {
  WearableActivityDay,
  WearableRecoveryDay,
  WearableResolvedMetric,
  WearableSleepNight,
} from "./types.ts";

export const WEARABLE_SEVEN_DAY_SNAPSHOT_SCHEMA_VERSION =
  "wearable-seven-day-snapshot.v1" as const;

export const DEFAULT_WEARABLE_SEVEN_DAY_METRIC_KEYS = [
  "steps",
  "total-sleep-minutes",
  "resting-heart-rate",
  "hrv-rmssd",
] as const;

export const WEARABLE_SEVEN_DAY_METRIC_KEYS = wearableTrendMetricKeyValues;

export type WearableSevenDayMetricKey = WearableTrendMetricKey;

export type WearableSevenDayReportingTimeZoneSource =
  | "none"
  | "user_filter"
  | "vault_metadata";

export interface WearableSevenDaySnapshotFilters {
  metricKeys?: readonly WearableSevenDayMetricKey[];
  now?: string;
  timeZone?: string;
  to?: string;
}

export interface WearableSevenDaySnapshotTrend {
  basis: "mean_vs_previous_7_calendar_days";
  delta: number | null;
  direction: WearableTrendDirection;
  priorAverage: number | null;
  priorObservedDayCount: number;
}

export interface WearableSevenDaySnapshotMetric {
  average: number | null;
  metricKey: WearableSevenDayMetricKey;
  observedDayCount: number;
  trend: WearableSevenDaySnapshotTrend;
  unit: string | null;
  values: Array<number | null>;
}

export interface WearableSevenDaySnapshot {
  asOfDate: string;
  asOfInstant: string;
  days: string[];
  from: string;
  metrics: WearableSevenDaySnapshotMetric[];
  reportingTimeZone: string | null;
  reportingTimeZoneSource: WearableSevenDayReportingTimeZoneSource;
  schemaVersion: typeof WEARABLE_SEVEN_DAY_SNAPSHOT_SCHEMA_VERSION;
  to: string;
}

export interface WearableSevenDaySnapshotBundle {
  activityDays: ReadonlyArray<Pick<WearableActivityDay, "date" | "steps">>;
  recoveryDays: ReadonlyArray<Pick<WearableRecoveryDay, "date" | "hrv" | "restingHeartRate">>;
  sleepNights: readonly WearableSleepNight[];
}

export interface WearableSevenDaySnapshotWindow {
  asOfDate: string;
  asOfInstant: string;
  days: string[];
  from: string;
  priorDays: string[];
  priorFrom: string;
  reportingTimeZone: string | null;
  to: string;
}

const MIN_TREND_OBSERVED_DAYS = 3;
const METRIC_KEY_SET = new Set<string>(WEARABLE_SEVEN_DAY_METRIC_KEYS);

export function resolveWearableSevenDaySnapshotWindow(
  filters: Omit<WearableSevenDaySnapshotFilters, "metricKeys"> = {},
): WearableSevenDaySnapshotWindow {
  const now = filters.now === undefined ? new Date() : new Date(filters.now);
  if (!Number.isFinite(now.getTime())) {
    throw new RangeError(`Invalid wearable seven-day as-of instant: ${String(filters.now)}`);
  }
  if (filters.timeZone !== undefined && !isValidIanaTimeZone(filters.timeZone)) {
    throw new RangeError(`Invalid IANA reporting time zone: ${filters.timeZone}`);
  }

  const reportingTimeZone = filters.timeZone ?? null;
  const asOfDate = reportingTimeZone
    ? formatTimeZoneDateTimeParts(now, reportingTimeZone).dayKey
    : now.toISOString().slice(0, 10);
  // A cumulative day is only comparable once its local calendar day ends.
  const lastCompletedDate = addDaysToIsoDate(asOfDate, -1);
  const requestedTo = filters.to ?? lastCompletedDate;
  assertIsoDate(requestedTo, "wearable seven-day end date");
  const to = requestedTo > lastCompletedDate ? lastCompletedDate : requestedTo;
  const from = addDaysToIsoDate(to, -6);
  const priorFrom = addDaysToIsoDate(from, -7);

  return {
    asOfDate,
    asOfInstant: now.toISOString(),
    days: isoDateRange(from, 7),
    from,
    priorDays: isoDateRange(priorFrom, 7),
    priorFrom,
    reportingTimeZone,
    to,
  };
}

export function buildWearableSevenDaySnapshot(input: {
  bundle: WearableSevenDaySnapshotBundle;
  filters?: WearableSevenDaySnapshotFilters;
  metricPoints?: readonly MetricPoint[];
  reportingTimeZoneSource?: WearableSevenDayReportingTimeZoneSource;
}): WearableSevenDaySnapshot {
  const filters = input.filters ?? {};
  const window = resolveWearableSevenDaySnapshotWindow(filters);
  const metricKeys = normalizeMetricKeys(filters.metricKeys);
  const valueMaps = new Map<WearableSevenDayMetricKey, Map<string, number>>();

  if (metricKeys.includes("steps")) {
    valueMaps.set(
      "steps",
      resolvedMetricValues(input.bundle.activityDays, (day) => day.steps),
    );
  }
  if (metricKeys.includes("resting-heart-rate")) {
    valueMaps.set(
      "resting-heart-rate",
      resolvedMetricValues(
        input.bundle.recoveryDays,
        (day) => day.restingHeartRate,
        { directOnly: true },
      ),
    );
  }
  if (metricKeys.includes("hrv-rmssd")) {
    valueMaps.set(
      "hrv-rmssd",
      resolvedMetricValues(input.bundle.recoveryDays, (day) => day.hrv),
    );
  }
  if (metricKeys.includes("hrv-sdnn")) {
    valueMaps.set(
      "hrv-sdnn",
      metricPointValues(input.metricPoints ?? [], "hrv-sdnn", window),
    );
  }
  if (metricKeys.includes("total-sleep-minutes")) {
    const sleepValues = listWearableSleepDailyValues(input.bundle.sleepNights, {
      from: window.priorFrom,
      now: window.asOfInstant,
      timeZone: window.reportingTimeZone ?? "UTC",
      to: window.to,
    });
    valueMaps.set(
      "total-sleep-minutes",
      new Map(sleepValues.flatMap((entry) => {
        const value = finiteValue(entry.totalSleepMinutes);
        return value === null ? [] : [[entry.date, value] as const];
      })),
    );
  }

  return {
    asOfDate: window.asOfDate,
    asOfInstant: window.asOfInstant,
    days: window.days,
    from: window.from,
    metrics: metricKeys.map((metricKey) => buildMetricRow(
      metricKey,
      valueMaps.get(metricKey) ?? new Map(),
      window,
    )),
    reportingTimeZone: window.reportingTimeZone,
    reportingTimeZoneSource: input.reportingTimeZoneSource
      ?? (window.reportingTimeZone ? "user_filter" : "none"),
    schemaVersion: WEARABLE_SEVEN_DAY_SNAPSHOT_SCHEMA_VERSION,
    to: window.to,
  };
}

function buildMetricRow(
  metricKey: WearableSevenDayMetricKey,
  valuesByDate: ReadonlyMap<string, number>,
  window: WearableSevenDaySnapshotWindow,
): WearableSevenDaySnapshotMetric {
  const definition = resolveMetricDefinition(metricKey);
  if (!definition) {
    throw new Error(`Missing metric definition for wearable seven-day metric: ${metricKey}`);
  }
  const values = window.days.map((date) => valuesByDate.get(date) ?? null);
  const priorValues = window.priorDays.map((date) => valuesByDate.get(date) ?? null);
  const currentAverage = average(values);
  const priorAverage = average(priorValues);
  const observedDayCount = countValues(values);
  const priorObservedDayCount = countValues(priorValues);
  const delta = currentAverage !== null && priorAverage !== null
    ? round(currentAverage - priorAverage, 4)
    : null;
  const direction = observedDayCount < MIN_TREND_OBSERVED_DAYS
    || priorObservedDayCount < MIN_TREND_OBSERVED_DAYS
    || currentAverage === null
    || priorAverage === null
    ? "not_enough_data"
    : compareRoundedValues(currentAverage, priorAverage, definition.valuePrecision);

  return {
    average: currentAverage,
    metricKey,
    observedDayCount,
    trend: {
      basis: "mean_vs_previous_7_calendar_days",
      delta,
      direction,
      priorAverage,
      priorObservedDayCount,
    },
    unit: definition.displayUnit,
    values,
  };
}

function resolvedMetricValues<TDay extends { date: string }>(
  days: readonly TDay[],
  selectMetric: (day: TDay) => WearableResolvedMetric,
  options: { directOnly?: boolean } = {},
): Map<string, number> {
  const values = new Map<string, number>();
  for (const day of days) {
    const metric = selectMetric(day);
    if (options.directOnly && metric.selection.fallbackFromMetric !== null) {
      continue;
    }
    const value = finiteValue(metric.selection.value);
    if (value !== null) {
      values.set(day.date, value);
    }
  }
  return values;
}

function metricPointValues(
  points: readonly MetricPoint[],
  metricKey: "hrv-sdnn",
  window: WearableSevenDaySnapshotWindow,
): Map<string, number> {
  const series = selectMetricSeries({
    duplicatePolicy: "selection-policy",
    from: window.priorFrom,
    metricKey,
    points,
    to: window.to,
  });
  return new Map(series.rows.flatMap((row) => {
    const value = finiteValue(row.value);
    return value === null ? [] : [[row.date, value] as const];
  }));
}

function normalizeMetricKeys(
  metricKeys: readonly WearableSevenDayMetricKey[] | undefined,
): WearableSevenDayMetricKey[] {
  const requested = metricKeys ?? DEFAULT_WEARABLE_SEVEN_DAY_METRIC_KEYS;
  const normalized: WearableSevenDayMetricKey[] = [];
  for (const metricKey of requested) {
    if (!METRIC_KEY_SET.has(metricKey)) {
      throw new RangeError(`Unsupported wearable seven-day metric: ${String(metricKey)}`);
    }
    if (!normalized.includes(metricKey)) {
      normalized.push(metricKey);
    }
  }
  return normalized;
}

function isoDateRange(from: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => addDaysToIsoDate(from, index));
}

function assertIsoDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new RangeError(`Invalid ${label}: ${value}`);
  }
  addDaysToIsoDate(value, 0);
}

function finiteValue(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function countValues(values: readonly (number | null)[]): number {
  return values.filter((value): value is number => value !== null).length;
}

function average(values: readonly (number | null)[]): number | null {
  const observed = values.filter((value): value is number => value !== null);
  return observed.length === 0
    ? null
    : round(observed.reduce((sum, value) => sum + value, 0) / observed.length, 4);
}

function compareRoundedValues(
  current: number,
  prior: number,
  precision: number,
): Extract<WearableTrendDirection, "higher" | "lower" | "steady"> {
  const currentRounded = round(current, precision);
  const priorRounded = round(prior, precision);
  return currentRounded === priorRounded
    ? "steady"
    : currentRounded > priorRounded
      ? "higher"
      : "lower";
}

function round(value: number, precision: number): number {
  return Number(value.toFixed(precision));
}
