import { dailyAchievements, type DailyAchievementCharts } from "./daily-achievements";
import { formatMetricValue, metricInfo, roundMetricValue } from "./metrics";
import { formatNumber, formatWinMonth, mad, mean, median, milesFromKm } from "./shared";
import type { Candidate, DailySample, Metric } from "./types";

interface MonthlyPoint {
  month: string;
  value: number;
  days: number;
}

export type DailyCharts = DailyAchievementCharts & {
  trend_change: {
    type: "trend";
    series: MonthlyPoint[];
    baseline: number;
    delta: number;
    unit: string;
    pills: string[];
  };
  best_month: {
    type: "monthly_bars";
    series: MonthlyPoint[];
    highlight: string;
    unit: string;
  };
  cumulative: {
    type: "map";
    series: { date: string; miles: number }[];
    totalMiles: number;
    days: number;
  };
};

function monthIndex(date: string): number {
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
}

// Summing up to 31 observations can move an exact decimal tie by a few ULPs.
function compareMonthlyValues(value: number, reference: number): number {
  const tolerance = Number.EPSILON * 32 * Math.max(1, Math.abs(value), Math.abs(reference));
  return Math.abs(value - reference) <= tolerance ? 0 : Math.sign(value - reference);
}

function requiredDays(month: string, currentMonth: string): number {
  return month === currentMonth ? 14 : 15;
}

function qualifyingMonths(rows: readonly DailySample[], currentMonth: string): MonthlyPoint[] {
  const currentIndex = monthIndex(currentMonth);
  const byMonth = new Map<string, number[]>();
  for (const row of rows) {
    if (currentIndex - monthIndex(row.date) >= 12) continue;
    const month = row.date.slice(0, 7);
    const values = byMonth.get(month) ?? [];
    values.push(row.value);
    byMonth.set(month, values);
  }
  const months: MonthlyPoint[] = [];
  for (const [month, values] of byMonth) {
    if (values.length >= requiredDays(month, currentMonth)) {
      months.push({ month, days: values.length, value: mean(values) });
    }
  }
  return months;
}

function monthlyCandidates(metric: Metric, rows: readonly DailySample[], today: string): Candidate[] {
  const currentMonth = today.slice(0, 7);
  const months = qualifyingMonths(rows, currentMonth);
  const current = months.at(-1);
  if (current?.month !== currentMonth) return [];

  const { unit, label, filter, direction, trendStep } = metricInfo(metric);
  const date = rows[rows.length - 1].date;
  const prior = months.slice(0, -1);
  const baselineMonths = prior.filter(month => monthIndex(currentMonth) - monthIndex(month.month) <= 3);
  const candidates: Candidate[] = [];
  if (trendStep !== undefined && baselineMonths.length === 3) {
    const values = baselineMonths.map(month => month.value);
    const baseline = median(values);
    const delta = current.value - baseline;
    const effect = delta * direction;
    if (direction * compareMonthlyValues(current.value, baseline + direction * trendStep) >= 0) {
      const displayedDelta = roundMetricValue(metric, current.value) - roundMetricValue(metric, baseline);
      candidates.push({
        date, effect, noise: Math.max(trendStep, mad(values)),
        achievement: { kind: "trend_change", subject: metric, period: currentMonth },
        card: {
          id: `trend_change:${metric}:${currentMonth}`, kind: "trend_change", filter,
          title: { number: formatMetricValue(metric, displayedDelta, "delta"), measure: label },
          subtitle: filter === "Heart" ? "on average, vs usual" : `a ${filter === "Sleep" ? "night" : "day"}, vs usual`,
          source_note: `${current.days} tracked days this month. Usual is the median of the previous three monthly averages.`,
          chart: {
            type: "trend", unit, series: [...baselineMonths, current], baseline, delta,
            pills: [`Usual ${formatMetricValue(metric, baseline)}`, `${formatWinMonth(today, "short")} ${formatMetricValue(metric, current.value)}`],
          },
        },
      });
    }
  }
  if (metric !== "distance_km" && months.length >= 6) {
    const thisYear = months.filter(({ month }) => month.startsWith(today.slice(0, 4)));
    const comparisonMonths = thisYear.length >= 6 ? thisYear : months;
    const period = thisYear.length >= 6 ? "this year" : "in the past 12 months";
    const previous = comparisonMonths.slice(0, -1).map(month => month.value);
    const previousBest = direction === 1 ? Math.max(...previous) : Math.min(...previous);
    const comparison = compareMonthlyValues(current.value, previousBest) * direction;
    const effect = (current.value - median(previous)) * direction;
    if (comparison >= 0 && previous.some(value => compareMonthlyValues(current.value, value) !== 0)) {
      candidates.push({
        date, effect, noise: Math.max(trendStep ?? 1, mad(previous)),
        achievement: { kind: "best_month", subject: metric, period: currentMonth },
        card: {
          id: `best_month:${metric}:${currentMonth}`, kind: "best_month", filter,
          title: { number: formatMetricValue(metric, current.value, "title"), measure: label },
          subtitle: `${formatWinMonth(today)}, ${comparison === 0 ? "tied for " : ""}best month ${period}`,
          source_note: `${current.days} tracked days this month so far. Compared across ${comparisonMonths.length} qualifying monthly averages.`,
          chart: { type: "monthly_bars", unit, series: comparisonMonths, highlight: currentMonth },
        },
      });
    }
  }
  return candidates;
}

function distanceThisYear(rows: readonly DailySample[], today: string): Candidate[] {
  const year = today.slice(0, 4);
  const series = rows.filter(row => row.date.startsWith(year))
    .map(row => ({ date: row.date, miles: milesFromKm(row.value) }));
  const totalMiles = series.reduce((sum, row) => sum + row.miles, 0);
  if (totalMiles <= 0) return [];
  const candidates: Candidate[] = [{
    date: series[series.length - 1].date, effect: 0, noise: 1,
    card: {
      id: `cumulative:distance_km:${year}`, kind: "cumulative", filter: "Fitness",
      title: { number: formatNumber(totalMiles, 0), measure: "miles on foot" },
      subtitle: "walking and running, this year",
      source_note: `Daily distance across ${series.length} tracked days, using one provider per day.`,
      chart: { type: "map", totalMiles, days: series.length, series },
    },
  }];
  const months = new Map<string, MonthlyPoint>();
  for (const { date, miles } of series) {
    const month = date.slice(0, 7);
    const point = months.get(month) ?? { month, value: 0, days: 0 };
    point.value += miles;
    point.days++;
    months.set(month, point);
  }
  const totals = [...months.values()];
  const currentMonth = today.slice(0, 7);
  const qualifying = totals.filter(point => point.days >= requiredDays(point.month, currentMonth));
  if (qualifying.length < 6) return candidates;
  const best = qualifying.reduce((a, b) => compareMonthlyValues(b.value, a.value) >= 0 ? b : a);
  const others = totals.filter(point => point !== best).map(point => point.value);
  const comparison = compareMonthlyValues(best.value, Math.max(...others));
  if (comparison >= 0 && others.some(value => compareMonthlyValues(best.value, value) > 0)) {
    candidates.push({
      metric: "distance_km",
      achievement: { kind: "best_month", subject: "distance_km", period: best.month },
      date: series.filter(point => point.date.startsWith(best.month)).at(-1)!.date,
      effect: best.value - median(others), noise: Math.max(1, mad(others)),
      card: {
        id: `best_month:distance_km:${best.month}`, kind: "best_month", filter: "Fitness",
        title: { number: formatNumber(best.value, 0), measure: "miles on foot" },
        subtitle: `in ${formatWinMonth(best.month)}, ${comparison === 0 ? "tied for " : ""}most this year`,
        source_note: `Walking and running distance across ${best.days} tracked days. Compared with every recorded monthly total this year.`,
        chart: { type: "monthly_bars", unit: "miles", series: totals, highlight: best.month },
      },
    });
  }
  return candidates;
}

/** Rows are the date-ordered, one-provider-per-day observations from cleanDaily. */
export function dailyCandidates(rows: readonly DailySample[], today: string): Candidate[] {
  const byMetric = new Map<Metric, DailySample[]>();
  for (const row of rows) {
    const series = byMetric.get(row.metric) ?? [];
    series.push(row);
    byMetric.set(row.metric, series);
  }
  const candidates: Candidate[] = [];
  for (const [metric, series] of byMetric) {
    const achievements = [...monthlyCandidates(metric, series, today), ...dailyAchievements(metric, series, today)];
    candidates.push(...achievements.map(candidate => ({ ...candidate, metric })));
    if (metric === "distance_km") candidates.push(...distanceThisYear(series, today));
  }
  return candidates;
}
