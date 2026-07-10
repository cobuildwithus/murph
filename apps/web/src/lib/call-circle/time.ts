import {
  type HostedCallCircleAvailabilityWindow,
  isHostedCallCircleTimeZone,
} from "@murphai/hosted-execution/call-circle";
import {
  formatTimeZoneDateTimeParts,
  parseDailyTime,
} from "@murphai/contracts";

interface AbsoluteCallCircleWindow {
  endAt: Date;
  startAt: Date;
}

interface ZonedCallCircleAvailability {
  timeZone: string;
  windows: readonly HostedCallCircleAvailabilityWindow[];
}

export const CALL_CIRCLE_FINAL_ASK_LEAD_MS = 20 * 60 * 1000;
export const CALL_CIRCLE_MATCH_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
export const CALL_CIRCLE_MINIMUM_WINDOW_MS = 15 * 60 * 1000;

export const CALL_CIRCLE_BRIDGE_WINDOW_MS = CALL_CIRCLE_MINIMUM_WINDOW_MS;
// Leave one ten-minute scheduler tick for the morning ask and the next for the
// final ask. A single-tick gap can miss the morning stage at the exact boundary.
const CALL_CIRCLE_MORNING_TO_FINAL_MIN_MS = 20 * 60 * 1000;
const CALL_CIRCLE_WINDOW_SCAN_STEP_MS = 60 * 1000;
const CALL_CIRCLE_WEEK_MS = CALL_CIRCLE_MATCH_LOOKBACK_MS;
const CALL_CIRCLE_MATCHING_EPOCH_DAY = 1;

interface LocalDateParts {
  day: number;
  hour: number;
  minute: number;
  month: number;
  year: number;
}

export function listUpcomingCallCircleWindows(input: {
  availability: ZonedCallCircleAvailability;
  daysAhead?: number;
  now: Date;
}): AbsoluteCallCircleWindow[] {
  // Include today plus the same local weekday next week. Otherwise a weekly
  // cadence that runs after today's window can skip that weekday forever.
  const daysAhead = input.daysAhead ?? 8;
  const timeZone = input.availability.timeZone;
  if (!isHostedCallCircleTimeZone(timeZone)) return [];
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
      // A local time inside the spring-forward gap does not identify a real
      // instant, so the whole availability window is skipped. During a
      // fall-back fold, localDateTimeToUtc deliberately selects the earlier
      // occurrence for deterministic matching.
      if (!start || !end || end <= input.now || start >= end) continue;
      windows.push({ startAt: start > input.now ? start : input.now, endAt: end });
    }
  }

  return windows.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

export function findCallCircleAskableWindow(input: {
  first: readonly AbsoluteCallCircleWindow[];
  memberATimeZone: string;
  memberBTimeZone: string;
  minimumDurationMs?: number;
  now: Date;
  second: readonly AbsoluteCallCircleWindow[];
}): AbsoluteCallCircleWindow | null {
  const minimumDurationMs = input.minimumDurationMs ?? CALL_CIRCLE_MINIMUM_WINDOW_MS;
  for (const first of input.first) {
    for (const second of input.second) {
      const startAt = new Date(Math.max(first.startAt.getTime(), second.startAt.getTime()));
      const endAt = new Date(Math.min(first.endAt.getTime(), second.endAt.getTime()));
      if (endAt.getTime() - startAt.getTime() < minimumDurationMs) continue;
      const askable = findCallCircleFinalAskableWindow({
        memberATimeZone: input.memberATimeZone,
        memberBTimeZone: input.memberBTimeZone,
        minimumDurationMs,
        now: input.now,
        window: { endAt, startAt },
      });
      if (askable) return askable;
    }
  }
  return null;
}

function findCallCircleFinalAskableWindow(input: {
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
        endAt: new Date(startAt.getTime() + minimumDurationMs),
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
  }) && isWithinCallCircleDaytime({
    now: latestMorningAskAt,
    timeZone: input.memberATimeZone,
  }) && isWithinCallCircleDaytime({
    now: latestMorningAskAt,
    timeZone: input.memberBTimeZone,
  });
}

function canScheduleCallCircleFinalAsk(input: {
  memberATimeZone: string;
  memberBTimeZone: string;
  windowStartAt: Date;
}): boolean {
  if (!Number.isFinite(input.windowStartAt.getTime())) return false;
  const askAt = readCallCircleFinalAskAt(input.windowStartAt);
  return isWithinCallCircleDaytimeForBoth({
    at: askAt,
    memberATimeZone: input.memberATimeZone,
    memberBTimeZone: input.memberBTimeZone,
  }) && isWithinCallCircleDaytimeForBoth({
    at: input.windowStartAt,
    memberATimeZone: input.memberATimeZone,
    memberBTimeZone: input.memberBTimeZone,
  });
}

function isWithinCallCircleDaytimeForBoth(input: {
  at: Date;
  memberATimeZone: string;
  memberBTimeZone: string;
}): boolean {
  return isWithinCallCircleDaytime({
    now: input.at,
    timeZone: input.memberATimeZone,
  }) && isWithinCallCircleDaytime({
    now: input.at,
    timeZone: input.memberBTimeZone,
  });
}

export function readCallCircleBridgeWindowStartCutoff(now: Date): Date {
  return new Date(now.getTime() - CALL_CIRCLE_BRIDGE_WINDOW_MS);
}

/**
 * Returns the next Monday 00:00 UTC cadence boundary, always strictly after
 * `now`. Matching may run immediately for newly eligible participants, but
 * every considered participant advances to this shared weekly boundary.
 */
export function readNextCallCircleMatchingAt(now: Date): Date {
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Call Circle matching cadence requires a valid date.");
  }
  const startOfDay = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const daysUntilEpoch = (
    CALL_CIRCLE_MATCHING_EPOCH_DAY - now.getUTCDay() + 7
  ) % 7;
  let nextAtMs = startOfDay + daysUntilEpoch * 24 * 60 * 60 * 1000;
  if (nextAtMs <= now.getTime()) nextAtMs += CALL_CIRCLE_WEEK_MS;
  return new Date(nextAtMs);
}

function readCallCircleBridgeDeadlineAt(input: {
  windowEndAt: Date;
  windowStartAt: Date;
}): Date {
  return new Date(Math.min(
    input.windowEndAt.getTime(),
    input.windowStartAt.getTime() + CALL_CIRCLE_BRIDGE_WINDOW_MS,
  ));
}

export function isWithinCallCircleBridgeWindow(input: {
  now: Date;
  windowEndAt: Date;
  windowStartAt: Date;
}): boolean {
  return input.now >= input.windowStartAt
    && input.now < readCallCircleBridgeDeadlineAt(input);
}

export function hasCallCircleBridgeWindowElapsed(input: {
  now: Date;
  windowEndAt: Date;
  windowStartAt: Date;
}): boolean {
  return input.now >= readCallCircleBridgeDeadlineAt(input);
}

export function readCallCircleFinalAskAt(windowStartAt: Date): Date {
  return new Date(windowStartAt.getTime() - CALL_CIRCLE_FINAL_ASK_LEAD_MS);
}

export function isWithinCallCircleDaytime(input: {
  now: Date;
  timeZone: string;
}): boolean {
  if (!isHostedCallCircleTimeZone(input.timeZone)) return false;
  const parts = readLocalDateParts(input.now, input.timeZone);
  return parts.hour >= 8 && parts.hour < 21;
}

export function isSameCallCircleLocalDate(input: {
  first: Date;
  second: Date;
  timeZone: string;
}): boolean {
  const timeZone = input.timeZone;
  if (!isHostedCallCircleTimeZone(timeZone)) return false;
  const first = readLocalDateParts(input.first, timeZone);
  const second = readLocalDateParts(input.second, timeZone);
  return first.year === second.year
    && first.month === second.month
    && first.day === second.day;
}

export function localDateTimeToUtc(
  parts: LocalDateParts,
  timeZone: string,
): Date | null {
  const targetMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );
  const offsets = new Set<number>();
  for (const sampleDeltaMs of [-48, -24, 0, 24, 48].map((hours) =>
    hours * 60 * 60 * 1000
  )) {
    offsets.add(readTimeZoneOffsetMs(new Date(targetMs + sampleDeltaMs), timeZone));
  }

  const candidates = [...offsets]
    .map((offsetMs) => new Date(targetMs - offsetMs))
    .filter((candidate) => localDatePartsEqual(
      readLocalDateParts(candidate, timeZone),
      parts,
    ))
    .sort((first, second) => first.getTime() - second.getTime());

  // No candidate means this wall-clock minute is inside a DST gap. Multiple
  // candidates mean a fold; consistently choosing the earlier instant keeps
  // matching deterministic across runtimes and retries.
  return candidates[0] ?? null;
}

function readTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const local = readLocalDateParts(date, timeZone);
  const localAsUtcMs = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
  );
  const instantAtMinuteMs = Math.floor(date.getTime() / 60_000) * 60_000;
  return localAsUtcMs - instantAtMinuteMs;
}

function localDatePartsEqual(
  first: LocalDateParts,
  second: LocalDateParts,
): boolean {
  return first.year === second.year
    && first.month === second.month
    && first.day === second.day
    && first.hour === second.hour
    && first.minute === second.minute;
}

function readLocalTimeParts(value: string): Pick<LocalDateParts, "hour" | "minute"> {
  const parsed = parseDailyTime(value);
  if (!parsed) {
    throw new RangeError(`Invalid Call Circle local time: ${value}`);
  }
  return parsed;
}

function readLocalDateParts(date: Date, timeZone: string): LocalDateParts {
  const parts = formatTimeZoneDateTimeParts(date, timeZone);
  return {
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    month: parts.month,
    year: parts.year,
  };
}
