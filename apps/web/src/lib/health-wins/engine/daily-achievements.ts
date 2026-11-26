import { formatMetricValue, metricInfo } from "./metrics";
import { cardDateKey, dayNumber, formatNumber, formatWinDate, formatWinMonth, mad, median, milesFromKm } from "./shared";
import type { Candidate, DailySample, Metric } from "./types";

type Point = { date: string; value: number };
type SleepBars = {
  type: "bars";
  unit: "min";
  threshold: number;
  series: (Point & { passing: boolean })[];
  pills: string[];
};

export type DailyAchievementCharts = {
  threshold_count: SleepBars;
  streak: SleepBars & { highlight: { start: string; end: string } };
  personal_record: { type: "record"; unit: string; series: Point[]; highlight: Point & { label: string }; pills: string[] };
};

const SLEEP_TARGET_MINUTES = 8 * 60;

function sleepBars(rows: readonly DailySample[]): SleepBars {
  return {
    type: "bars",
    unit: "min",
    threshold: SLEEP_TARGET_MINUTES,
    series: rows.map(({ date, value }) => ({ date, value, passing: value >= SLEEP_TARGET_MINUTES })),
    pills: ["8 hours"],
  };
}

function sleepCount(rows: readonly DailySample[], today: string): Candidate | undefined {
  const month = today.slice(0, 7);
  const nights = rows.filter(({ date }) => date.startsWith(month));
  const hits = nights.filter(({ value }) => value >= SLEEP_TARGET_MINUTES).length;
  if (nights.length < 10 || hits / nights.length < 0.6) return;
  return {
    date: nights[nights.length - 1].date,
    effect: hits,
    noise: nights.length,
    card: {
      id: `threshold_count:sleep_total_min:${month}`,
      kind: "threshold_count",
      filter: "Sleep",
      title: { number: `${hits} of ${nights.length} nights`, measure: "8+ hours" },
      subtitle: `in ${formatWinMonth(today)} so far`,
      source_note: `Based on ${nights.length} tracked nights.`,
      chart: sleepBars(nights),
    },
  };
}

function streakDateRange(start: string, end: string, today: string): string {
  if (start.slice(0, 7) !== end.slice(0, 7)) {
    return `${formatWinDate(start, today)} to ${formatWinDate(end, today)}`;
  }
  const year = end.slice(0, 4);
  const range = `${formatWinMonth(start, "short")} ${Number(start.slice(8))} to ${Number(end.slice(8))}`;
  return year === today.slice(0, 4) ? range : `${range}, ${year}`;
}

function sleepStreak(rows: readonly DailySample[], today: string): Candidate | undefined {
  const todayNumber = dayNumber(today);
  const nights = rows.filter(({ date }) => todayNumber - dayNumber(date) < 90);
  let startIndex = 0;
  let lastPassingDay = -Infinity;
  let bestLength = 0;
  let bestEnd = 0;
  for (const [index, night] of nights.entries()) {
    if (night.value < SLEEP_TARGET_MINUTES) continue;
    const day = dayNumber(night.date);
    if (day !== lastPassingDay + 1) startIndex = index;
    lastPassingDay = day;
    const length = index - startIndex + 1;
    if (length >= bestLength) {
      bestLength = length;
      bestEnd = index;
    }
  }
  if (bestLength < 5) return;
  const end = nights[bestEnd].date;
  if (todayNumber - dayNumber(end) > 60) return;
  const start = nights[bestEnd - bestLength + 1].date;
  return {
    date: end,
    effect: bestLength,
    noise: 5,
    card: {
      id: `streak:sleep_total_min:${cardDateKey(end)}`,
      kind: "streak",
      filter: "Sleep",
      title: { number: `${bestLength} nights`, measure: "8+ hours" },
      subtitle: `in a row, ${streakDateRange(start, end, today)}`,
      source_note: `Longest recorded run in the last 90 days, ending ${formatWinDate(end, today)}.`,
      chart: { ...sleepBars(nights), highlight: { start, end } },
    },
  };
}

function personalRecord(metric: Metric, rows: readonly DailySample[], today: string): Candidate | undefined {
  const { label, unit, filter, direction, trendStep, record } = metricInfo(metric);
  if (!record) return;
  const anniversary = String(Number(today.slice(0, 4)) - 1).padStart(4, "0") + today.slice(4);
  const distance = metric === "distance_km";
  const calendarYear = rows.filter(({ date }) => date.startsWith(today.slice(0, 4)));
  const withinCalendarYear = distance || calendarYear.length >= 2;
  const year = withinCalendarYear ? calendarYear : rows.filter(({ date }) => date > anniversary);
  if (year.length < 2) return;
  const best = year.reduce((a, b) => b.value * direction >= a.value * direction ? b : a);
  if ((!distance && dayNumber(today) - dayNumber(best.date) > 60) || year.every(({ value }) => value === best.value)) return;
  const values = year.map(({ value }) => value);
  const chartValue = (value: number) => distance ? milesFromKm(value) : value;
  const dateLabel = formatWinDate(best.date, today);
  const rank = direction < 0 ? "lowest" : metric === "hrv_ms" ? "highest" : "most";
  const period = withinCalendarYear ? "this year" : "in the past 12 months";
  const tied = year.some(row => row !== best && row.value === best.value);
  return {
    date: best.date,
    effect: Math.abs(best.value - median(values)),
    noise: Math.max(trendStep ?? 1, mad(values)),
    card: {
      id: `personal_record:${metric}:${cardDateKey(best.date)}`,
      kind: "personal_record",
      filter,
      title: distance
        ? { number: formatNumber(milesFromKm(best.value), 0), measure: "miles on foot" }
        : { number: formatMetricValue(metric, best.value, "title"), measure: label },
      subtitle: `on ${dateLabel}, ${tied ? "tied for " : ""}${rank} ${period}`,
      source_note: `Recorded on ${dateLabel}. Based on ${year.length} tracked days.`,
      chart: {
        type: "record", unit: distance ? "miles" : unit,
        series: year.map(({ date, value }) => ({ date, value: chartValue(value) })),
        highlight: { date: best.date, value: chartValue(best.value), label: dateLabel }, pills: [dateLabel],
      },
    },
  };
}

/** Samples are selected, cleaned and ordered by date before detection. */
export function dailyAchievements(metric: Metric, rows: readonly DailySample[], today: string): Candidate[] {
  const candidates = metric === "sleep_total_min"
    ? [sleepCount(rows, today), sleepStreak(rows, today)]
    : [personalRecord(metric, rows, today)];
  return candidates.filter((candidate): candidate is Candidate => candidate !== undefined);
}
