import { dayNumber, formatWinDate, formatWinMonth } from "./shared";

type Point = { date: string; value: number };

export interface ThresholdBars {
  type: "bars";
  unit: "min" | "g";
  threshold: number;
  series: (Point & { passing: boolean })[];
  pills: string[];
}

export function thresholdBars(rows: readonly Point[], threshold: number, unit: ThresholdBars["unit"], pill: string): ThresholdBars {
  return {
    type: "bars", unit, threshold,
    series: rows.map(({ date, value }) => ({ date, value, passing: value >= threshold })),
    pills: [pill],
  };
}

export function streakDateRange(start: string, end: string, today: string): string {
  if (start.slice(0, 7) !== end.slice(0, 7)) {
    return `${formatWinDate(start, today)} to ${formatWinDate(end, today)}`;
  }
  const year = end.slice(0, 4);
  const range = `${formatWinMonth(start, "short")} ${Number(start.slice(8))} to ${Number(end.slice(8))}`;
  return year === today.slice(0, 4) ? range : `${range}, ${year}`;
}

/** Observations arrive once per known calendar day in ascending order. On a tie the later run wins. */
export function longestStreak(rows: readonly Point[], today: string, threshold: number) {
  const asOf = dayNumber(today);
  const window = rows.filter(({ date }) => date <= today && asOf - dayNumber(date) < 90);
  let start = "";
  let length = 0;
  let previous = -Infinity;
  let best = { start: "", end: "", length: 0 };
  for (const { date, value } of window) {
    if (value < threshold) continue;
    const day = dayNumber(date);
    if (day !== previous + 1) {
      start = date;
      length = 0;
    }
    previous = day;
    length++;
    if (length >= best.length) best = { start, end: date, length };
  }
  if (best.length < 5 || asOf - dayNumber(best.end) > 60) return;

  // The window chooses the winner. Earlier consecutive observations complete that run.
  let first = rows.indexOf(window[0]);
  const afterWindow = first + window.length;
  while (first > 0) {
    const prior = rows[first - 1];
    if (prior.value < threshold || dayNumber(prior.date) !== dayNumber(best.start) - 1) break;
    best.start = prior.date;
    best.length++;
    first--;
  }
  return { ...best, chartRows: rows.slice(first, afterWindow) };
}
