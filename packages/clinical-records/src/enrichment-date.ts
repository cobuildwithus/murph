import { isStrictIsoDate, isWritableIsoDateTime, toLocalDayKey } from "@murphai/contracts";
import type { ClinicalDocumentExtractionOutput } from "./enrichment.ts";

export function clinicalExtractionDateIsSupported(
  record: ClinicalDocumentExtractionOutput["records"][number],
  clinicalOccurredAt: string | undefined,
  timeZone: string,
): boolean {
  return record.dateBasis === "source" ? Boolean(clinicalOccurredAt)
    : record.dateBasis === "document" && clinicalDateEvidenceMatches(record.payload.occurredAt, record.dateEvidence, timeZone);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
const DAY = "\\d{1,2}(?:st|nd|rd|th)?";
const DATE_TOKEN = new RegExp(
  "\\b(?:" +
  "\\d{4}-\\d{2}-\\d{2}(?:[Tt]\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:[Zz]|[+-]\\d{2}:?\\d{2}))?" +
  "|" + MONTH + "\\s+" + DAY + ",?\\s+\\d{4}" +
  "|" + DAY + "[\\s-]+" + MONTH + "[\\s-]+\\d{4}" +
  "|\\d{4}/\\d{1,2}/\\d{1,2}|\\d{1,2}[/-]\\d{1,2}[/-]\\d{4}" +
  ")\\b", "giu",
);

function calendarDay(year: number, month: number, day: number): string[] {
  const value = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isStrictIsoDate(value) ? [value] : [];
}

function evidenceDays(token: string, timeZone: string): string[] {
  if (/^\d{4}-\d{2}-\d{2}[Tt]/u.test(token)) {
    const timestamp = token.replace(/([Tt]\d{2}:\d{2})([Zz]|[+-])/u, "$1:00$2")
      .replace(/([+-]\d{2})(\d{2})$/u, "$1:$2");
    return isWritableIsoDateTime(timestamp) ? [toLocalDayKey(timestamp, timeZone)] : [];
  }
  const numbers = token.match(/\d+/gu)?.map(Number) ?? [];
  const month = MONTHS.indexOf(token.match(/[a-z]{3,}/iu)?.[0]?.slice(0, 3).toLowerCase() ?? "") + 1;
  if (month) return calendarDay(numbers[1]!, month, numbers[0]!);
  if (/^\d{4}[-/]/u.test(token)) return calendarDay(numbers[0]!, numbers[1]!, numbers[2]!);
  // A numeric date alone does not establish locale. Check consistency with
  // either full-date ordering without choosing or rewriting the event date.
  return [
    ...calendarDay(numbers[2]!, numbers[0]!, numbers[1]!),
    ...calendarDay(numbers[2]!, numbers[1]!, numbers[0]!),
  ];
}

/** Check the quoted calendar date, not just the presence of an evidence string. */
export function clinicalDateEvidenceMatches(
  occurredAt: string,
  evidence: string | undefined,
  timeZone: string,
): boolean {
  if (!evidence || !isWritableIsoDateTime(occurredAt)) return false;
  const days = new Set([occurredAt.slice(0, 10), toLocalDayKey(occurredAt, timeZone)]);
  const tokens = [...evidence.matchAll(DATE_TOKEN)];
  // One supporting excerpt must not mix unrelated event or retrieval dates.
  return tokens.length > 0 && tokens.every(([token]) =>
    evidenceDays(token, timeZone).some((day) => days.has(day)));
}
