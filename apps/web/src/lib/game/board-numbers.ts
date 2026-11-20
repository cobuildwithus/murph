import { normalizeMetricValue, resolveMetricDefinition, selectMetricWindowComparison, type MetricSeriesPoint } from "@murphai/health-metrics";
import type { HostedRuntimeGroupSharedRecord } from "@murphai/hosted-execution/runtime-control";
import { HOSTED_VAULT_SHARE_BOARD_HISTORY_DAYS, HOSTED_VAULT_SHARE_DEFAULT_HISTORY_DAYS, type HostedVaultShareAgeGroup } from "@murphai/hosted-execution/vault-share";
import type { HostedGroupBoardProjection } from "../hosted-groups/group-store";
import { addDays } from "./time";

export const BOARD_METRICS = ["restingHeartRate", "sleep", "steps", "vo2Max"] as const;
export type BoardMetric = typeof BOARD_METRICS[number];
const PRE_GAME_BASELINE_DAYS = 60;
// Shared records name a public source, not the sourceType #4606 reads, so steps
// class sources by name. Health stores merge every app and can count a device
// twice; manual and Murph rows aren't worn either.
const NOT_WORN_STEP_SOURCES: ReadonlySet<string> = new Set(["apple-health", "apple-health-kit", "google-fit",
  "google-health", "health-connect", "samsung-health", "manual", "murph"]);
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
export type BoardNumber = { state: "not_shared" } | { state: "pending"; reason?: "no_readings" } | {
  state: "available"; unit: string; source?: string; latest: BoardDayValue; stale: boolean;
  daily: BoardDayValue[]; comparison: BoardComparison | null;
};
export interface BoardPerson {
  memberId: string; me: boolean; member: boolean; inARow: number | null;
  demographics?: HostedVaultShareAgeGroup;
  numbers: Record<BoardMetric, BoardNumber>;
}
export interface PairBoard {
  groupId: string; membershipId: string | null; sharingRevision?: string; firstGameOn: string;
  window: { from: string; through: string }; myShares: BoardMetric[];
  people: BoardPerson[]; crowns: Record<BoardMetric | "inARow", string | null>;
}

export function boardNumber(metric: BoardMetric, projection: HostedGroupBoardProjection,
  window: PairBoard["window"], firstGameOn: string): BoardNumber {
  const number = rawBoardNumber(metric, projection, window, firstGameOn);
  if (number.state !== "available") return number;
  const round = (value: number) => Number(value.toFixed(POLICY[metric].precision));
  return { ...number, daily: number.daily.map(point => ({ ...point, value: round(point.value) })),
    latest: { ...number.latest, value: round(number.latest.value) } };
}

/** The same selected, grant-authorized series before the board's display rounding. */
function rawBoardNumber(metric: BoardMetric, projection: HostedGroupBoardProjection,
  window: PairBoard["window"], firstGameOn: string): BoardNumber {
  if (projection.state === "not_granted") return { state: "not_shared" };
  if (projection.state === "missing") return { state: "pending", reason: "no_readings" };
  if (projection.state !== "available") return { state: "pending" };
  const policy = POLICY[metric];
  const intermittent = metric === "vo2Max" ? resolveMetricDefinition(policy.key)?.trendPolicy : undefined;
  const minimumPoints = intermittent?.minimumPoints ?? 4;
  const freshThrough = addDays(window.through, -(metric === "vo2Max"
    ? resolveMetricDefinition(policy.key)!.selectionPolicy.staleAfterDays!
    : 7));
  // Only the baseline reads past `window`; `daily` and `latest` never do.
  const retained = { ...window, from: addDays(window.from, HOSTED_VAULT_SHARE_DEFAULT_HISTORY_DAYS - HOSTED_VAULT_SHARE_BOARD_HISTORY_DAYS) };
  const preGame = { from: laterDate(addDays(firstGameOn, -PRE_GAME_BASELINE_DAYS), retained.from), through: addDays(firstGameOn, -1) };
  const sources = new Map<string, Map<string, MetricSeriesPoint>>();
  for (const record of [...projection.records].sort((a, b) => a.recordKey.localeCompare(b.recordKey))) {
    const point = numericPoint(record, policy.key, retained);
    if (!point) continue;
    const source = record.source?.source ?? "";
    const days = sources.get(source) ?? new Map<string, MetricSeriesPoint>();
    days.set(point.date, point);
    sources.set(source, days);
  }
  const candidates = [...sources].flatMap(([source, byDay]) => {
    const points = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
    const latest = points.at(-1)!;
    if (latest.date < window.from) return [];
    // Retain dated historical comparisons, but use the actual board week for a live daily metric.
    const currentThrough = intermittent || latest.date < freshThrough ? latest.date : window.through;
    const currentFrom = laterDate(addDays(currentThrough, -(intermittent?.latestWindowDays ?? 7) + 1), firstGameOn);
    // The days before Day 1, with VO2's median and two-reading minimum, unless
    // there are too few (a device connected on game day). Then the first week
    // from the first real reading, where intermittent VO2 keeps its up-to-90-day
    // baseline before the current window.
    const usesPreGame = points.filter(point => point.date >= preGame.from && point.date <= preGame.through).length >= minimumPoints;
    const firstWeekFrom = points.find(point => point.date >= firstGameOn)?.date ?? firstGameOn;
    const baselineFrom = usesPreGame ? preGame.from : firstWeekFrom;
    const baselineThrough = usesPreGame ? preGame.through : intermittent
      ? [addDays(firstWeekFrom, (intermittent.comparisonWindowDays ?? 90) - 1), addDays(currentFrom, -1)].sort()[0]
      : addDays(firstWeekFrom, 6);
    const result = selectMetricWindowComparison({ metricKey: policy.key, points,
      baselineWindow: { start: baselineFrom, end: baselineThrough },
      comparisonWindow: { start: currentFrom, end: currentThrough },
      minimumPoints, statistic: intermittent?.aggregation ?? "mean" });
    const comparable = Boolean(source) && result.status === "ready" && baselineThrough < currentFrom;
    const dates = points.filter(point => point.date >= baselineFrom && point.date <= baselineThrough
      || point.date >= currentFrom && point.date <= latest.date).length;
    // Worn this week, not merely owned: a spare device's older history must not outrank the one on the wrist.
    const worn = metric === "steps" && Boolean(source) && !NOT_WORN_STEP_SOURCES.has(source)
      && points.filter(point => point.date >= addDays(window.through, -6)).length >= minimumPoints;
    return [{ source, points, latest, result, comparable, dates, worn, fresh: latest.date >= freshThrough, baselineFrom, baselineThrough, currentFrom, currentThrough,
      sinceFirstGame: usesPreGame || baselineFrom === firstGameOn }];
  });
  candidates.sort((a, b) => Number(b.fresh) - Number(a.fresh) || Number(b.worn) - Number(a.worn) || Number(b.comparable) - Number(a.comparable) || b.dates - a.dates
    || b.latest.date.localeCompare(a.latest.date) || a.source.localeCompare(b.source));
  const selected = candidates[0];
  if (!selected) return { state: "pending", reason: "no_readings" };
  const { result } = selected;
  const daily = selected.points.filter(point => point.date >= window.from)
    .map(point => ({ date: point.date, value: point.value! }));
  const delta = result.delta;
  return { state: "available", unit: policy.unit, ...sourceField(selected.source), daily, latest: daily.at(-1)!,
    stale: !selected.fresh,
    comparison: selected.comparable && delta !== null && result.baseline.value !== null && result.comparison.value !== null ? {
      baseline: { from: selected.baselineFrom, through: selected.baselineThrough, value: result.baseline.value, days: result.baseline.daysWithData },
      current: { from: selected.currentFrom, through: selected.currentThrough, value: result.comparison.value, days: result.comparison.daysWithData },
      delta, improvement: delta * policy.direction, sinceFirstGame: selected.sinceFirstGame,
    } : null };
}

function sourceField(source: string): { source?: string } {
  return source ? { source } : {};
}

function laterDate(a: string, b: string): string { return a > b ? a : b; }

function numericPoint(record: HostedRuntimeGroupSharedRecord, key: string, window: PairBoard["window"]): MetricSeriesPoint | null {
  const data = record.data;
  if (!("metricKey" in data) || data.metricKey !== key || !("value" in data) || typeof data.value !== "number"
    || !("date" in data) || typeof data.date !== "string" || data.date < window.from || data.date > window.through) return null;
  if (key === "total-sleep-minutes" && "sleepType" in data && data.sleepType === "nap") return null;
  // A worn device can hold 0 for days it reported no steps at all; 0 is not a reading.
  if (key === "steps" && data.value === 0) return null;
  const unit = "unit" in data ? data.unit : null;
  // Shared legacy rows can carry the public display unit; the catalog stores counts.
  const normalized = normalizeMetricValue({ metricKey: key, value: data.value,
    unit: key === "steps" && unit?.toLowerCase() === "steps" ? "count" : unit });
  if (normalized.canonicalValue === null || normalized.canonicalUnit === null) return null;
  return { date: data.date, metricKey: key, unit: normalized.canonicalUnit, value: normalized.canonicalValue };
}

/** A total can span devices. Keep one grant-authorized value on each observed date. */
export function sharedHealthDays(metric: "steps" | "sleep", projection: HostedGroupBoardProjection,
  window: PairBoard["window"]): BoardDayValue[] | null {
  if (projection.state !== "available") return null;
  const byDate = new Map<string, BoardDayValue>();
  const worn = (record: HostedRuntimeGroupSharedRecord) => metric === "steps" && !!record.source?.source
    && !NOT_WORN_STEP_SOURCES.has(record.source.source);
  const records = [...projection.records].sort((a, b) => Number(worn(a)) - Number(worn(b))
    || a.occurredAt.localeCompare(b.occurredAt) || a.recordKey.localeCompare(b.recordKey));
  for (const record of records) {
    const point = numericPoint(record, POLICY[metric].key, window);
    if (point && point.value !== null) byDate.set(point.date, { date: point.date, value: point.value });
  }
  return byDate.size ? [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)) : null;
}

export function boardCrowns(people: readonly BoardPerson[]): PairBoard["crowns"] {
  const winner = (value: (person: BoardPerson) => number | null) => {
    const ranked = people.map(person => ({ memberId: person.memberId, value: value(person) ?? 0 }))
      .filter(person => person.value > 0).sort((a, b) => b.value - a.value);
    return ranked[0] && ranked[0].value !== ranked[1]?.value ? ranked[0].memberId : null;
  };
  // A crown needs a change its row can show: the app hides one that rounds to zero.
  const metricWinner = (metric: BoardMetric) => {
    if (!people.every(person => {
      const number = person.numbers[metric];
      return number.state === "available" && !number.stale && number.comparison !== null;
    })) return null;
    return winner(person => {
      const number = person.numbers[metric];
      const improvement = number.state === "available" ? number.comparison?.improvement ?? 0 : 0;
      return improvement * 10 ** POLICY[metric].precision > 0.5 ? improvement : null;
    });
  };
  return { restingHeartRate: metricWinner("restingHeartRate"), sleep: metricWinner("sleep"),
    steps: metricWinner("steps"), vo2Max: metricWinner("vo2Max"), inARow: winner(person => person.inARow) };
}
