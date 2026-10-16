/**
 * Game days run 3am to 3am in each player's own time zone, frozen when they
 * join. Local dates are plain `YYYY-MM-DD` strings; instants are `Date`s from
 * the database clock. Pure functions only.
 */

import type { Weekday } from "./contract";

const DAY_START_HOUR = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A post captured just before 3am may still count for the day that ended. */
export const GAME_GRACE_MS = 60 * 60 * 1000;
/** Clock slack allowed between capture and the 3am boundary. */
export const GAME_CAPTURE_SLACK_MS = 2 * 60 * 1000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "2-digit",
      second: "2-digit",
      timeZone,
      year: "numeric",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || timeZone.length > 64) return false;
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The wall clock in `timeZone` at `instant`, read back as if it were UTC. */
function wallClockMs(instant: Date, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function toDateString(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 10);
}

function parseDate(date: string): number {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new RangeError(`Invalid local date: ${date}`);
  return ms;
}

export function addDays(date: string, days: number): string {
  return toDateString(parseDate(date) + days * DAY_MS);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseDate(to) - parseDate(from)) / DAY_MS);
}

/** Monday = 0 … Sunday = 6. */
export function weekdayOf(date: string): Weekday {
  return ((new Date(parseDate(date)).getUTCDay() + 6) % 7) as Weekday;
}

/** The game day an instant falls in: before 3am still belongs to yesterday. */
export function gameLocalDate(instant: Date, timeZone: string): string {
  const wall = wallClockMs(instant, timeZone);
  const date = toDateString(wall);
  return new Date(wall).getUTCHours() < DAY_START_HOUR ? addDays(date, -1) : date;
}

/** The instant a game day starts: 3am local on `date`. */
export function dayStartInstant(date: string, timeZone: string): Date {
  const target = parseDate(date) + DAY_START_HOUR * 60 * 60 * 1000;
  // Two passes settle the offset, including on DST change days.
  let guess = target - (wallClockMs(new Date(target), timeZone) - target);
  guess = target - (wallClockMs(new Date(guess), timeZone) - guess);
  return new Date(guess);
}
