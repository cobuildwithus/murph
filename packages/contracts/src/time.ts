const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const ISO_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/u;

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
