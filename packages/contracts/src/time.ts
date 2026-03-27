const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const ISO_DATE_PREFIX_PATTERN = /^(\d{4}-\d{2}-\d{2})(?:$|T)/u;
const ISO_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/u;
const DAILY_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/u;

const TIME_ZONE_PARTS_CACHE = new Map<string, Intl.DateTimeFormat>();

export interface TimeZoneDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  dayOfWeek: number;
  dayKey: string;
}

export function isStrictIsoDate(value: string): boolean {
  const parsed = parseIsoDate(value);

  if (!parsed) {
    return false;
  }

  return hasMatchingUtcDate(parsed.year, parsed.month, parsed.day);
}

export function isStrictIsoDateTime(value: string): boolean {
  const parsed = parseIsoDateTime(value);

  if (!parsed) {
    return false;
  }

  const offsetMinutes = parsed.offsetMinutes;
  const utcMilliseconds =
    Date.UTC(
      parsed.year,
      parsed.month - 1,
      parsed.day,
      parsed.hour,
      parsed.minute,
      parsed.second,
      parsed.millisecond,
    ) -
    offsetMinutes * 60_000;
  const date = new Date(utcMilliseconds);

  if (Number.isNaN(date.valueOf())) {
    return false;
  }

  const offsetDate = new Date(date.getTime() + offsetMinutes * 60_000);

  return (
    offsetDate.getUTCFullYear() === parsed.year &&
    offsetDate.getUTCMonth() + 1 === parsed.month &&
    offsetDate.getUTCDate() === parsed.day &&
    offsetDate.getUTCHours() === parsed.hour &&
    offsetDate.getUTCMinutes() === parsed.minute &&
    offsetDate.getUTCSeconds() === parsed.second &&
    offsetDate.getUTCMilliseconds() === parsed.millisecond
  );
}

export function normalizeStrictIsoTimestamp(
  value: string | number | Date,
): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.valueOf()) ? null : value.toISOString();
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }

    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? null : date.toISOString();
  }

  if (typeof value !== "string") {
    return null;
  }

  if (isStrictIsoDate(value)) {
    return `${value}T00:00:00.000Z`;
  }

  if (!isStrictIsoDateTime(value)) {
    return null;
  }

  return new Date(value).toISOString();
}

export function extractIsoDatePrefix(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = ISO_DATE_PREFIX_PATTERN.exec(value.trim());
  return match?.[1] ?? null;
}

export function normalizeIanaTimeZone(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    const resolved = new Intl.DateTimeFormat("en-US", {
      timeZone: trimmed,
    }).resolvedOptions().timeZone;

    return resolved || trimmed;
  } catch {
    return null;
  }
}

export function isValidIanaTimeZone(value: string | null | undefined): boolean {
  return normalizeIanaTimeZone(value) !== null;
}

export function resolveSystemTimeZone(fallback = "UTC"): string {
  return (
    normalizeIanaTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ??
    normalizeIanaTimeZone(fallback) ??
    "UTC"
  );
}

export function parseDailyTime(
  value: string | null | undefined,
): { hour: number; minute: number } | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = DAILY_TIME_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }

  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  };
}

export function addDaysToIsoDate(value: string, days: number): string {
  const parsed = parseIsoDate(value);
  if (!parsed) {
    throw new RangeError(`Invalid ISO date: ${value}`);
  }

  const shifted = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
  return `${shifted.getUTCFullYear()}-${padTwo(shifted.getUTCMonth() + 1)}-${padTwo(shifted.getUTCDate())}`;
}

export function formatTimeZoneDateTimeParts(
  value: string | number | Date,
  timeZone: string,
): TimeZoneDateTimeParts {
  const normalizedTimeZone = normalizeIanaTimeZone(timeZone);
  if (!normalizedTimeZone) {
    throw new RangeError(`Invalid IANA time zone: ${String(timeZone)}`);
  }

  const normalizedTimestamp = normalizeStrictIsoTimestamp(value);
  if (!normalizedTimestamp) {
    throw new RangeError(`Invalid ISO date-time: ${String(value)}`);
  }

  const formatter =
    TIME_ZONE_PARTS_CACHE.get(normalizedTimeZone) ??
    createTimeZonePartsFormatter(normalizedTimeZone);
  TIME_ZONE_PARTS_CACHE.set(normalizedTimeZone, formatter);

  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(normalizedTimestamp))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value] as const),
  );

  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    !Number.isInteger(second)
  ) {
    throw new RangeError(`Failed to format time-zone parts for ${normalizedTimeZone}.`);
  }

  const dayKey = `${year}-${padTwo(month)}-${padTwo(day)}`;

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    dayOfWeek: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    dayKey,
  };
}

export function toLocalDayKey(
  value: string | number | Date,
  timeZone: string,
): string {
  if (typeof value === "string" && isStrictIsoDate(value)) {
    return value;
  }

  return formatTimeZoneDateTimeParts(value, timeZone).dayKey;
}

function parseIsoDate(
  value: string,
): { year: number; month: number; day: number } | null {
  const match = ISO_DATE_PATTERN.exec(value);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  return { year, month, day };
}

function parseIsoDateTime(
  value: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  offsetMinutes: number;
} | null {
  const match = ISO_DATE_TIME_PATTERN.exec(value);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fractional = match[8] ?? "";
  const timezone = match[9];
  const offsetSign = match[10] === "-" ? -1 : 1;
  const offsetHours = match[11] ? Number(match[11]) : 0;
  const offsetMinutesPart = match[12] ? Number(match[12]) : 0;

  if (
    !Number.isInteger(year) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59 ||
    offsetHours < 0 ||
    offsetHours > 23 ||
    offsetMinutesPart < 0 ||
    offsetMinutesPart > 59
  ) {
    return null;
  }

  const millisecond = Number(fractional.padEnd(3, "0"));
  const offsetMinutes =
    timezone === "Z"
      ? 0
      : offsetSign * (offsetHours * 60 + offsetMinutesPart);

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    millisecond,
    offsetMinutes,
  };
}

function hasMatchingUtcDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    !Number.isNaN(date.valueOf()) &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
}

function createTimeZonePartsFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US-u-ca-gregory", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

function padTwo(value: number): string {
  return String(value).padStart(2, "0");
}
