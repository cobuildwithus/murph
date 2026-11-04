import { normalizeMetricValue, resolveMetricDefinition, selectMetricWindowComparison, type MetricSeriesPoint } from "@murphai/health-metrics";
import type { HostedRuntimeGroupSharedRecord } from "@murphai/hosted-execution/runtime-control";
import type { HostedGroupBoardProjection } from "../hosted-groups/group-store";
import { addDays } from "./time";

export const BOARD_METRICS = ["restingHeartRate", "sleep", "steps", "vo2Max"] as const;
export type BoardMetric = typeof BOARD_METRICS[number];
const POLICY = {
  restingHeartRate: { key: "resting-heart-rate", unit: "bpm", direction: -1, precision: 0 },
  sleep: { key: "total-sleep-minutes", unit: "minutes", direction: 1, precision: 0 },
  steps: { key: "steps", unit: "steps", direction: 1, precision: 0 },
  vo2Max: { key: "estimated-vo2-max", unit: "ml/kg/min", direction: 1, precision: 1 },
} as const;
export interface BoardDayValue { date: string; value: number }
export interface BoardWindowValue { from: string; through: string; value: number; days: number }
export interface BoardComparison {
  baseline: BoardWindowValue; current: BoardWindowValue; delta: number;
  improvement: number; sinceFirstGame: boolean;
}
export type BoardNumber = { state: "not_shared" | "pending" | "hidden" } | {
  state: "available"; unit: string; latest: BoardDayValue; stale: boolean;
  daily: BoardDayValue[]; comparison: BoardComparison | null;
};
export interface BoardPerson {
  memberId: string; me: boolean; member: boolean; inARow: number | null;
  numbers: Record<BoardMetric, BoardNumber>;
}
export interface PairBoard {
  groupId: string; membershipId: string | null; firstGameOn: string;
  window: { from: string; through: string }; myShares: BoardMetric[];
  people: BoardPerson[]; crowns: Record<BoardMetric | "inARow", string | null>;
}

export function boardNumber(metric: BoardMetric, projection: HostedGroupBoardProjection,
  window: PairBoard["window"], firstGameOn: string): BoardNumber {
  if (projection.state === "hidden") return { state: "hidden" };
  if (projection.state === "not_granted") return { state: "not_shared" };
  if (projection.state !== "available") return { state: "pending" };
  const policy = POLICY[metric];
  const intermittent = metric === "vo2Max" ? resolveMetricDefinition(policy.key)?.trendPolicy : undefined;
  const baselineFrom = firstGameOn > window.from ? firstGameOn : window.from;
  const sources = new Map<string, Map<string, MetricSeriesPoint>>();
  for (const record of [...projection.records].sort((a, b) => a.recordKey.localeCompare(b.recordKey))) {
    const point = numericPoint(record, policy.key, window);
    if (!point) continue;
    const source = record.source?.source ?? "";
    const days = sources.get(source) ?? new Map<string, MetricSeriesPoint>();
    days.set(point.date, point);
    sources.set(source, days);
  }
  const candidates = [...sources].map(([source, byDay]) => {
    const points = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
    const latest = points.at(-1)!;
    const currentFrom = addDays(latest.date, -(intermittent?.latestWindowDays ?? 7) + 1);
    // Intermittent VO2 uses its median, 14-day current and up-to-90-day baseline
    // policy, clipped to retained history and strictly before the current window.
    const baselineThrough = intermittent
      ? [addDays(baselineFrom, (intermittent.comparisonWindowDays ?? 90) - 1), addDays(currentFrom, -1)].sort()[0]
      : addDays(baselineFrom, 6);
    const result = selectMetricWindowComparison({ metricKey: policy.key, points,
      baselineWindow: { start: baselineFrom, end: baselineThrough },
      comparisonWindow: { start: currentFrom, end: latest.date },
      minimumPoints: intermittent?.minimumPoints ?? 4, statistic: intermittent?.aggregation ?? "mean" });
    const comparable = Boolean(source) && result.status === "ready" && baselineThrough < currentFrom;
    const dates = points.filter(point => point.date >= baselineFrom && point.date <= baselineThrough
      || point.date >= currentFrom && point.date <= latest.date).length;
    return { source, points, latest, result, comparable, dates, baselineThrough, currentFrom };
  });
  candidates.sort((a, b) => Number(b.comparable) - Number(a.comparable) || b.dates - a.dates
    || b.latest.date.localeCompare(a.latest.date) || a.source.localeCompare(b.source));
  const selected = candidates[0];
  if (!selected) return { state: "pending" };
  const { result } = selected;
  const round = (value: number) => Number(value.toFixed(policy.precision));
  const daily = selected.points.map(point => ({ date: point.date, value: round(point.value!) }));
  const delta = result.delta;
  return { state: "available", unit: policy.unit, daily, latest: daily.at(-1)!,
    stale: selected.latest.date < addDays(window.through, -7),
    comparison: selected.comparable && delta !== null && result.baseline.value !== null && result.comparison.value !== null ? {
      baseline: { from: baselineFrom, through: selected.baselineThrough, value: result.baseline.value, days: result.baseline.daysWithData },
      current: { from: selected.currentFrom, through: selected.latest.date, value: result.comparison.value, days: result.comparison.daysWithData },
      delta, improvement: delta * policy.direction, sinceFirstGame: firstGameOn >= window.from,
    } : null };
}

function numericPoint(record: HostedRuntimeGroupSharedRecord, key: string, window: PairBoard["window"]): MetricSeriesPoint | null {
  const data = record.data;
  if (!("metricKey" in data) || data.metricKey !== key || !("value" in data) || typeof data.value !== "number"
    || !("date" in data) || typeof data.date !== "string" || data.date < window.from || data.date > window.through) return null;
  if (key === "total-sleep-minutes" && "sleepType" in data && data.sleepType === "nap") return null;
  const unit = "unit" in data ? data.unit : null;
  // Shared legacy rows can carry the public display unit; the catalog stores counts.
  const normalized = normalizeMetricValue({ metricKey: key, value: data.value,
    unit: key === "steps" && unit?.toLowerCase() === "steps" ? "count" : unit });
  if (normalized.canonicalValue === null || normalized.canonicalUnit === null) return null;
  return { date: data.date, metricKey: key, unit: normalized.canonicalUnit, value: normalized.canonicalValue };
}

export function boardCrowns(people: readonly BoardPerson[]): PairBoard["crowns"] {
  const winner = (value: (person: BoardPerson) => number | null) => {
    const ranked = people.map(person => ({ memberId: person.memberId, value: value(person) ?? 0 }))
      .filter(person => person.value > 0).sort((a, b) => b.value - a.value);
    return ranked[0] && ranked[0].value !== ranked[1]?.value ? ranked[0].memberId : null;
  };
  const metricWinner = (metric: BoardMetric) => winner(person => {
    const number = person.numbers[metric];
    return number.state === "available" ? number.comparison?.improvement ?? null : null;
  });
  return { restingHeartRate: metricWinner("restingHeartRate"), sleep: metricWinner("sleep"),
    steps: metricWinner("steps"), vo2Max: metricWinner("vo2Max"), inARow: winner(person => person.inARow) };
}
