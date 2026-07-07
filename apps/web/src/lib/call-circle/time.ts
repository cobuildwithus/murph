import type { HostedCallCircleAvailabilityWindow } from "@murphai/hosted-execution/call-circle";

export interface AbsoluteCallCircleWindow {
  endAt: Date;
  startAt: Date;
}

export interface ZonedCallCircleAvailability {
  timeZone: string;
  windows: readonly HostedCallCircleAvailabilityWindow[];
}

export const CALL_CIRCLE_FINAL_ASK_LEAD_MS = 20 * 60 * 1000;

const DEFAULT_TIME_ZONE = "UTC";
const CALL_CIRCLE_MINIMUM_WINDOW_MS = 15 * 60 * 1000;
const CALL_CIRCLE_MORNING_TO_FINAL_MIN_MS = 10 * 60 * 1000;
const CALL_CIRCLE_WINDOW_SCAN_STEP_MS = 60 * 1000;

interface LocalDateParts {
  day: number;
  hour: number;
  minute: number;
  month: number;
  year: number;
}

export function normalizeCallCircleTimeZone(value: string | null | undefined): string {
  if (!value) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return value;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

export function listUpcomingCallCircleWindows(input: {
  availability: ZonedCallCircleAvailability;
  daysAhead?: number;
  now: Date;
}): AbsoluteCallCircleWindow[] {
  const daysAhead = input.daysAhead ?? 7;
  const timeZone = normalizeCallCircleTimeZone(input.availability.timeZone);
  const base = readLocalDateParts(input.now, timeZone);
  const baseUtcDay = Date.UTC(base.year, base.month - 1, base.day);
  const windows: AbsoluteCallCircleWindow[] = [];

  for (let offset = 0; offset < daysAhead; offset += 1) {
    const localDay = new Date(baseUtcDay + offset * 24 * 60 * 60 * 1000);
    const year = localDay.getUTCFullYear();
    const month = localDay.getUTCMonth() + 1;
    const day = localDay.getUTCDate();
    const dayOfWeek = localDay.getUTCDay();
    for (const window of input.availability.windows) {
      if (window.dayOfWeek !== dayOfWeek) continue;
      const start = localDateTimeToUtc({
        ...readLocalTimeParts(window.startLocalTime),
        day,
        month,
        year,
      }, timeZone);
      const end = localDateTimeToUtc({
        ...readLocalTimeParts(window.endLocalTime),
        day,
        month,
        year,
      }, timeZone);
      if (end <= input.now || start >= end) continue;
      windows.push({ startAt: start > input.now ? start : input.now, endAt: end });
    }
  }

  return windows.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

export function intersectCallCircleWindows(input: {
  first: readonly AbsoluteCallCircleWindow[];
  minimumDurationMs?: number;
  second: readonly AbsoluteCallCircleWindow[];
}): AbsoluteCallCircleWindow | null {
  const minimumDurationMs = input.minimumDurationMs ?? CALL_CIRCLE_MINIMUM_WINDOW_MS;
  for (const first of input.first) {
    for (const second of input.second) {
      const startAt = new Date(Math.max(first.startAt.getTime(), second.startAt.getTime()));
      const endAt = new Date(Math.min(first.endAt.getTime(), second.endAt.getTime()));
      if (endAt.getTime() - startAt.getTime() >= minimumDurationMs) {
        return { startAt, endAt };
      }
    }
  }
  return null;
}

export function findCallCircleFinalAskableWindow(input: {
  memberATimeZone: string;
  memberBTimeZone: string;
  minimumDurationMs?: number;
  now: Date;
  window: AbsoluteCallCircleWindow;
}): AbsoluteCallCircleWindow | null {
  const minimumDurationMs = input.minimumDurationMs ?? CALL_CIRCLE_MINIMUM_WINDOW_MS;
  const latestStartMs = input.window.endAt.getTime() - minimumDurationMs;
  if (!Number.isFinite(latestStartMs)) return null;
  for (
    let startMs = input.window.startAt.getTime();
    startMs <= latestStartMs;
    startMs += CALL_CIRCLE_WINDOW_SCAN_STEP_MS
  ) {
    const startAt = new Date(startMs);
    if (canScheduleCallCircleConfirmationFlow({
      memberATimeZone: input.memberATimeZone,
      memberBTimeZone: input.memberBTimeZone,
      now: input.now,
      windowStartAt: startAt,
    })) {
      return {
        endAt: input.window.endAt,
        startAt,
      };
    }
  }
  return null;
}

export function canScheduleCallCircleConfirmationFlow(input: {
  memberATimeZone: string;
  memberBTimeZone: string;
  now: Date;
  windowStartAt: Date;
}): boolean {
  if (!canScheduleCallCircleFinalAsk(input)) return false;
  if (!Number.isFinite(input.now.getTime())) return false;

  const finalAskAt = readCallCircleFinalAskAt(input.windowStartAt);
  const latestMorningAskAt = new Date(
    finalAskAt.getTime() - CALL_CIRCLE_MORNING_TO_FINAL_MIN_MS,
  );
  if (input.now > latestMorningAskAt) return false;

  return isSameCallCircleLocalDate({
    first: latestMorningAskAt,
    second: input.windowStartAt,
    timeZone: input.memberATimeZone,
  }) && isSameCallCircleLocalDate({
    first: latestMorningAskAt,
    second: input.windowStartAt,
    timeZone: input.memberBTimeZone,
  }) && isWithinCallCircleQuietHours({
    now: latestMorningAskAt,
    timeZone: input.memberATimeZone,
  }) && isWithinCallCircleQuietHours({
    now: latestMorningAskAt,
    timeZone: input.memberBTimeZone,
  });
}

export function canScheduleCallCircleFinalAsk(input: {
  memberATimeZone: string;
  memberBTimeZone: string;
  windowStartAt: Date;
}): boolean {
  if (!Number.isFinite(input.windowStartAt.getTime())) return false;
  const askAt = readCallCircleFinalAskAt(input.windowStartAt);
  return isWithinCallCircleQuietHours({
    now: askAt,
    timeZone: input.memberATimeZone,
  }) && isWithinCallCircleQuietHours({
    now: askAt,
    timeZone: input.memberBTimeZone,
  });
}

function readCallCircleFinalAskAt(windowStartAt: Date): Date {
  return new Date(windowStartAt.getTime() - CALL_CIRCLE_FINAL_ASK_LEAD_MS);
}

export function isWithinCallCircleQuietHours(input: {
  now: Date;
  timeZone: string;
}): boolean {
  const parts = readLocalDateParts(input.now, normalizeCallCircleTimeZone(input.timeZone));
  return parts.hour >= 8 && parts.hour < 21;
}

export function isSameCallCircleLocalDate(input: {
  first: Date;
  second: Date;
  timeZone: string;
}): boolean {
  const timeZone = normalizeCallCircleTimeZone(input.timeZone);
  const first = readLocalDateParts(input.first, timeZone);
  const second = readLocalDateParts(input.second, timeZone);
  return first.year === second.year
    && first.month === second.month
    && first.day === second.day;
}

export function localDateTimeToUtc(
  parts: LocalDateParts,
  timeZone: string,
): Date {
  const targetMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );
  let utcMs = targetMs;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = readLocalDateParts(new Date(utcMs), timeZone);
    const actualMs = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
    );
    const delta = targetMs - actualMs;
    if (delta === 0) break;
    utcMs += delta;
  }
  return new Date(utcMs);
}

function readLocalTimeParts(value: string): Pick<LocalDateParts, "hour" | "minute"> {
  const [hour, minute] = value.split(":").map((part) => Number.parseInt(part, 10));
  return { hour, minute };
}

function readLocalDateParts(date: Date, timeZone: string): LocalDateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  });
  const parts = new Map(
    formatter.formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return {
    day: readDatePart(parts, "day"),
    hour: readDatePart(parts, "hour"),
    minute: readDatePart(parts, "minute"),
    month: readDatePart(parts, "month"),
    year: readDatePart(parts, "year"),
  };
}

function readDatePart(parts: Map<string, string>, name: string): number {
  const value = parts.get(name);
  if (!value) {
    throw new Error(`Missing ${name} from formatted local date.`);
  }
  return Number.parseInt(value, 10);
}
