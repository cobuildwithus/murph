import {
  extractIsoDatePrefix as extractIsoDatePrefixShared,
  formatTimeZoneDateTimeParts,
  isStrictIsoDate,
  isStrictIsoDateTime,
  normalizeIanaTimeZone,
  toLocalDayKey as toLocalDayKeyShared,
} from "@murphai/contracts";

import { DEFAULT_TIMEZONE } from "./constants.ts";
import { VaultError } from "./errors.ts";

import type { DateInput } from "./types.ts";

const LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/u;

interface LocalDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

function parseLocalDateTimeParts(value: string): LocalDateTimeParts | null {
  if (isStrictIsoDate(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return {
      year: year!,
      month: month!,
      day: day!,
      hour: 0,
      minute: 0,
      second: 0,
      millisecond: 0,
    };
  }

  const match = LOCAL_DATE_TIME_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = Number((match[7] ?? "").padEnd(3, "0"));
  const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));

  if (
    Number.isNaN(utcDate.valueOf()) ||
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() + 1 !== month ||
    utcDate.getUTCDate() !== day ||
    utcDate.getUTCHours() !== hour ||
    utcDate.getUTCMinutes() !== minute ||
    utcDate.getUTCSeconds() !== second ||
    utcDate.getUTCMilliseconds() !== millisecond
  ) {
    return null;
  }

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    millisecond,
  };
}

function localDateTimeToDate(parts: LocalDateTimeParts, timeZone: string): Date | null {
  const targetUtcMilliseconds = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
  let instantMilliseconds = targetUtcMilliseconds;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = formatTimeZoneDateTimeParts(new Date(instantMilliseconds), timeZone);
    const observedAsUtcMilliseconds = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
      parts.millisecond,
    );
    instantMilliseconds -= observedAsUtcMilliseconds - targetUtcMilliseconds;
  }

  const observed = formatTimeZoneDateTimeParts(new Date(instantMilliseconds), timeZone);
  if (
    observed.year !== parts.year ||
    observed.month !== parts.month ||
    observed.day !== parts.day ||
    observed.hour !== parts.hour ||
    observed.minute !== parts.minute ||
    observed.second !== parts.second
  ) {
    return null;
  }

  return new Date(instantMilliseconds);
}

function normalizeTimestampTimeZone(value: string | undefined, fieldName: string): string {
  if (value === undefined) {
    return "UTC";
  }

  const normalized = normalizeIanaTimeZone(value);
  if (!normalized) {
    throw new VaultError("VAULT_INVALID_TIMEZONE", `Invalid ${fieldName}.`, {
      fieldName,
      value,
    });
  }

  return normalized;
}

export function coerceDate(
  value: DateInput | undefined,
  fieldName = "date",
  timeZone?: string,
): Date {
  if (value === undefined) {
    return new Date();
  }

  if (value instanceof Date) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new VaultError("VAULT_INVALID_DATE", `Invalid ${fieldName}.`, {
        fieldName,
        value: null,
      });
    }

    return date;
  }

  if (typeof value === "number") {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new VaultError("VAULT_INVALID_DATE", `Invalid ${fieldName}.`, {
        fieldName,
        value,
      });
    }

    return date;
  }

  const trimmed = value.trim();
  const localDateTimeParts = parseLocalDateTimeParts(trimmed);
  const date = isStrictIsoDateTime(trimmed)
    ? new Date(trimmed)
    : localDateTimeParts
      ? localDateTimeToDate(
        localDateTimeParts,
        normalizeTimestampTimeZone(timeZone, "timeZone"),
      )
      : null;

  if (!date || Number.isNaN(date.getTime())) {
    throw new VaultError("VAULT_INVALID_DATE", `Invalid ${fieldName}.`, {
      fieldName,
      timeZone: timeZone ?? null,
      value,
    });
  }

  return date;
}

export function toIsoTimestamp(
  value: DateInput | undefined,
  fieldName = "date",
  timeZone?: string,
): string {
  return coerceDate(value, fieldName, timeZone).toISOString();
}

export function toDateOnly(value: DateInput | undefined, fieldName = "date"): string {
  const extracted = typeof value === "string" ? extractIsoDatePrefixShared(value) : null;
  if (extracted) {
    return extracted;
  }

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  return toIsoTimestamp(value, fieldName).slice(0, 10);
}

export function toMonthShard(value: DateInput | undefined, fieldName = "date"): string {
  return toIsoTimestamp(value, fieldName).slice(0, 7);
}

export function normalizeTimeZone(
  value: string | null | undefined,
  fieldName = "timeZone",
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = normalizeIanaTimeZone(value);
  if (!normalized) {
    throw new VaultError("VAULT_INVALID_TIMEZONE", `Invalid ${fieldName}.`, {
      fieldName,
      value,
    });
  }

  return normalized;
}

export function requireTimeZone(
  value: string | null | undefined,
  fieldName = "timeZone",
): string {
  return normalizeTimeZone(value, fieldName) ?? defaultTimeZone();
}

export function defaultTimeZone(): string {
  return DEFAULT_TIMEZONE;
}

export function toLocalDayKey(
  value: DateInput | undefined,
  timeZone: string,
  fieldName = "date",
): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    const extracted = extractIsoDatePrefixShared(value);
    if (extracted) {
      return extracted;
    }
  }

  try {
    return toLocalDayKeyShared(coerceDate(value, fieldName, timeZone), requireTimeZone(timeZone));
  } catch (error) {
    throw new VaultError("VAULT_INVALID_DATE", `Invalid ${fieldName}.`, {
      fieldName,
      timeZone,
      value: value instanceof Date ? value.toISOString() : value ?? null,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export function extractIsoDatePrefix(value: string | null | undefined): string | null {
  return extractIsoDatePrefixShared(value);
}
