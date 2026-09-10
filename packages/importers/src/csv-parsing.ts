import {
  formatTimeZoneDateTimeParts,
  normalizeStrictIsoTimestamp,
} from "@murphai/contracts";

import { normalizeRequiredString } from "./shared.ts";

const MONTH_NUMBERS = Object.freeze({
  apr: 4,
  april: 4,
  aug: 8,
  august: 8,
  dec: 12,
  december: 12,
  feb: 2,
  february: 2,
  jan: 1,
  january: 1,
  jul: 7,
  july: 7,
  jun: 6,
  june: 6,
  mar: 3,
  march: 3,
  may: 5,
  nov: 11,
  november: 11,
  oct: 10,
  october: 10,
  sep: 9,
  sept: 9,
  september: 9,
} as const satisfies Record<string, number>);

const MONTH_NUMBERS_LOOKUP: Readonly<Record<string, number>> = MONTH_NUMBERS;

interface NaiveTimestampParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

export function normalizeFlexibleTimestamp(value: unknown, timeZone: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const strict = normalizeStrictIsoTimestamp(
    typeof value === "string" ? value.trim() : (value as string | number | Date),
  );

  if (strict) {
    return strict;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return undefined;
  }

  const unixTimestamp = normalizeUnixTimestamp(trimmed);

  if (unixTimestamp) {
    return unixTimestamp;
  }

  const naiveParts = parseNaiveTimestampParts(trimmed);

  if (naiveParts) {
    return naiveTimestampPartsToIso(naiveParts, timeZone);
  }

  if (/(?:z|gmt|utc|[+-]\d{2}:?\d{2})$/iu.test(trimmed)) {
    const parsedMilliseconds = Date.parse(trimmed);

    if (!Number.isNaN(parsedMilliseconds)) {
      return new Date(parsedMilliseconds).toISOString();
    }
  }

  return undefined;
}

function normalizeUnixTimestamp(value: string): string | undefined {
  if (!/^\d{10}(?:\d{3})?$/u.test(value)) {
    return undefined;
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  const milliseconds = value.length === 10 ? numeric * 1000 : numeric;
  return new Date(milliseconds).toISOString();
}

function parseNaiveTimestampParts(value: string): NaiveTimestampParts | undefined {
  const isoLikeMatch =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/u.exec(value);

  if (isoLikeMatch) {
    return finalizeNaiveTimestampParts({
      year: Number(isoLikeMatch[1]),
      month: Number(isoLikeMatch[2]),
      day: Number(isoLikeMatch[3]),
      hour: Number(isoLikeMatch[4]),
      minute: Number(isoLikeMatch[5]),
      second: Number(isoLikeMatch[6] ?? "0"),
      millisecond: Number((isoLikeMatch[7] ?? "").padEnd(3, "0") || "0"),
    });
  }

  const timeFirstMatch =
    /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s+([A-Za-z]{3,9})\s+(\d{1,2})\s+(\d{4})$/u.exec(value);

  if (timeFirstMatch) {
    const month = MONTH_NUMBERS_LOOKUP[timeFirstMatch[4]!.toLowerCase()];

    if (!month) {
      return undefined;
    }

    return finalizeNaiveTimestampParts({
      year: Number(timeFirstMatch[6]),
      month,
      day: Number(timeFirstMatch[5]),
      hour: Number(timeFirstMatch[1]),
      minute: Number(timeFirstMatch[2]),
      second: Number(timeFirstMatch[3] ?? "0"),
      millisecond: 0,
    });
  }

  return undefined;
}

function finalizeNaiveTimestampParts(parts: NaiveTimestampParts): NaiveTimestampParts | undefined {
  const candidate = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      parts.millisecond,
    ),
  );

  if (
    Number.isNaN(candidate.valueOf()) ||
    candidate.getUTCFullYear() !== parts.year ||
    candidate.getUTCMonth() + 1 !== parts.month ||
    candidate.getUTCDate() !== parts.day ||
    candidate.getUTCHours() !== parts.hour ||
    candidate.getUTCMinutes() !== parts.minute ||
    candidate.getUTCSeconds() !== parts.second ||
    candidate.getUTCMilliseconds() !== parts.millisecond
  ) {
    return undefined;
  }

  return parts;
}

function naiveTimestampPartsToIso(parts: NaiveTimestampParts, timeZone: string): string {
  let guessMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
  const targetMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    0,
  );

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const zoned = formatTimeZoneDateTimeParts(guessMs, timeZone);
    const observedMs = Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      zoned.hour,
      zoned.minute,
      zoned.second,
      0,
    );
    const delta = targetMs - observedMs;

    if (delta === 0) {
      return new Date(guessMs).toISOString();
    }

    guessMs += delta;
  }

  return new Date(guessMs).toISOString();
}

export function parseDelimitedRows(text: string, delimiter = ","): string[][] {
  const normalizedDelimiter = normalizeRequiredString(delimiter, "delimiter");

  if (normalizedDelimiter.length !== 1) {
    throw new TypeError("delimiter must be a single character");
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inQuotes) {
      if (character === "\"") {
        if (text[index + 1] === "\"") {
          field += "\"";
          index += 1;
          continue;
        }

        inQuotes = false;
        continue;
      }

      field += character;
      continue;
    }

    if (character === "\"") {
      inQuotes = true;
      continue;
    }

    if (character === normalizedDelimiter) {
      row.push(field);
      field = "";
      continue;
    }

    if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    if (character === "\r") {
      continue;
    }

    field += character;
  }

  if (inQuotes) {
    throw new Error("sample CSV contains an unterminated quoted field");
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
