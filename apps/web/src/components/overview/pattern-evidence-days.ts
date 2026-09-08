import type { PersonalPatternCell, PersonalPatternReport } from "@murphai/query/browser-overview";

const DAY_MS = 86_400_000;
export type PatternEvidenceWindow = Pick<PersonalPatternReport, "asOfDate" | "windowDays">;

function parseDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(date) && new Date(date).toISOString().slice(0, 10) === value ? date : null;
}

export function patternEvidenceDays(report: PatternEvidenceWindow, cell: PersonalPatternCell) {
  const end = parseDate(report.asOfDate);
  if (end === null || !Number.isInteger(report.windowDays) || report.windowDays < 1 || report.windowDays > 366) return null;
  const start = end - (report.windowDays - 1) * DAY_MS;
  const validDates = (dates: string[] | undefined) => new Set((dates ?? []).filter((value) => {
    const date = parseDate(value);
    return date !== null && date >= start && date <= end;
  }));
  const exposed = validDates(cell.exposedDates);
  const comparison = validDates(cell.comparisonDates);
  if (!exposed.size && !comparison.size) return null;
  const gridStart = start - ((new Date(start).getUTCDay() + 6) % 7) * DAY_MS;
  const length = Math.ceil(((end - gridStart) / DAY_MS + 1) / 7) * 7;
  const days = Array.from({ length }, (_, index) => {
    const time = gridStart + index * DAY_MS;
    const date = new Date(time).toISOString().slice(0, 10);
    return { date, inWindow: time >= start && time <= end, exposed: exposed.has(date), comparison: comparison.has(date) };
  });
  return { days, hasMissingDates: exposed.size < cell.exposedDays || comparison.size < cell.comparisonDays };
}
