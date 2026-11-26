import { foodTally, type FoodTally, type Nutrient } from "./foods";
import { cardDateKey, compareMonthlyValues, dayNumber, formatNumber, formatWinDate, formatWinMonth, mad, median, monthIndex } from "./shared";
import { longestStreak, streakDateRange, thresholdBars } from "./streak";
import type { Candidate, MealDay } from "./types";

export type DietCharts = { month_total: FoodTally };

type Point = { date: string; value: number };
type Month = { month: string; days: number; value: number };

function daysInMonth(month: string): number {
  const last = new Date(month + "-01T00:00:00Z");
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  return last.getUTCDate();
}

function qualifyingMonths(rows: readonly Point[], today: string): Month[] {
  const currentMonth = today.slice(0, 7);
  const months = new Map<string, Month>();
  for (const { date, value } of rows) {
    const month = date.slice(0, 7);
    const point = months.get(month) ?? { month, days: 0, value: 0 };
    point.days++;
    point.value += value;
    months.set(month, point);
  }
  return [...months.values()].filter(({ days, month, value }) => {
    const elapsed = month === currentMonth ? Number(today.slice(8)) : daysInMonth(month);
    return Number.isFinite(value) && days * 5 >= elapsed * 4;
  });
}

function monthTotal(nutrient: Nutrient, month: Month): Candidate | undefined {
  const chart = foodTally(nutrient, month.value);
  if (!chart) return;
  const label = formatWinMonth(month.month);
  const days = daysInMonth(month.month);
  const source = chart.item.id === "rotisserie_chicken" || chart.item.id === "thanksgiving_turkey"
    ? "USDA FoodData Central, meat only" : "USDA FoodData Central";
  return {
    date: `${month.month}-${days}`, effect: 1, noise: 1,
    card: {
      id: `month_total:${nutrient}_g:${month.month}`, kind: "month_total", filter: "Diet",
      title: { number: formatNumber(month.value, 0), measure: `g ${nutrient}` },
      subtitle: `in ${label}`,
      source_note: `Logged on ${month.days} of ${days} days in ${label}. A day counts when every meal has ${nutrient}. One ${chart.item.name} ≈ ${formatNumber(chart.item.perItem, 0)} g ${nutrient} (${source}).`,
      chart,
    },
  };
}

function bestMonth(nutrient: Nutrient, current: Month, prior: readonly Month[], today: string, lastKnown: string): Candidate | undefined {
  if (current.value <= 0 || Number(today.slice(8)) < 14 || prior.length < 3) return;
  const thisYear = prior.filter(point => point.month.startsWith(today.slice(0, 4)));
  const useCalendarYear = thisYear.length >= 3;
  const comparison = useCalendarYear ? thisYear : prior;
  const values = comparison.map(point => point.value);
  const rank = compareMonthlyValues(current.value, Math.max(...values));
  if (rank < 0) return;
  const period = useCalendarYear ? "this year" : "in the past 12 months";
  const superlative = rank === 0 ? "tied for most" : "your most";
  return {
    date: lastKnown, effect: current.value - median(values), noise: Math.max(1, mad(values)),
    achievement: { kind: "best_month", subject: `${nutrient}_g`, period: current.month },
    card: {
      id: `best_month:${nutrient}_g:${current.month}`, kind: "best_month", filter: "Diet",
      title: { number: formatNumber(current.value, 0), measure: `g ${nutrient}` },
      subtitle: `${formatWinMonth(today)}, ${superlative} ${period}`,
      source_note: `Logged on ${current.days} of ${Number(today.slice(8))} days this month so far. Compared with ${comparison.length} qualifying monthly totals. A day counts when every meal has ${nutrient}.`,
      chart: { type: "monthly_bars", series: [...comparison, current], unit: "g", highlight: current.month },
    },
  };
}

function fiberStreak(rows: readonly Point[], today: string): Candidate | undefined {
  const threshold = 30;
  const run = longestStreak(rows, today, threshold);
  if (!run) return;
  const { start, end, length } = run;
  const firstChartDay = dayNumber(start) - 9, lastChartDay = dayNumber(end) + 9;
  const series = rows.filter(({ date }) => {
    const day = dayNumber(date);
    return day >= firstChartDay && day <= lastChartDay;
  });
  return {
    date: end, effect: length, noise: 5,
    card: {
      id: `streak:fiber_g:${cardDateKey(end)}`, kind: "streak", filter: "Diet",
      title: { number: `${length} days`, measure: "30 g+ fiber" },
      subtitle: `in a row, ${streakDateRange(start, end, today)}`,
      source_note: `Longest run in the last 90 days, ending ${formatWinDate(end, today)}. A day counts when every meal has fiber.`,
      chart: { ...thresholdBars(series, threshold, "g", "30 g"), highlight: { start, end } },
    },
  };
}

/** The meal adapter supplies a single observation per day, in chronological order. */
export function dietCandidates(meals: readonly MealDay[], today: string): Candidate[] {
  const current = monthIndex(today);
  const recent = meals.filter(row => row.date <= today && current - monthIndex(row.date) <= 12);
  const candidates: Candidate[] = [];
  for (const nutrient of ["protein", "fiber"] as const) {
    const rows = recent.flatMap(({ date, proteinG, fiberG }) => {
      const value = nutrient === "protein" ? proteinG : fiberG;
      return value === null ? [] : [{ date, value }];
    });
    const months = qualifyingMonths(rows, today);
    const lastMonth = months.find(point => monthIndex(point.month) === current - 1);
    const tally = lastMonth && monthTotal(nutrient, lastMonth);
    if (tally) candidates.push(tally);
    const latest = months.at(-1);
    if (latest?.month === today.slice(0, 7)) {
      const best = bestMonth(nutrient, latest, months.slice(0, -1), today, rows[rows.length - 1].date);
      if (best) candidates.push(best);
    }
    if (nutrient === "fiber") {
      const streak = fiberStreak(rows, today);
      if (streak) candidates.push(streak);
    }
  }
  return candidates;
}
