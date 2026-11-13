/**
 * Game days run 3am to 3am in each player's own time zone, frozen when the
 * game goes live. Local dates are plain `YYYY-MM-DD` strings; instants are
 * `Date`s from the database clock. Pure functions over the shared time helpers.
 */

import {
  addDaysToIsoDate,
  formatTimeZoneDateTimeParts,
  resolveFloatingIsoTimestampInTimeZone,
} from "@murphai/contracts";

import type { Weekday } from "./contract";

const DAY_START_HOUR = 3;
export const GAME_SAME_DAY_CUTOFF_HOUR = 15;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MONDAY_FIRST: readonly Weekday[] = [6, 0, 1, 2, 3, 4, 5];
/** A post captured just before 3am may still count for the day that ended. */
export const GAME_GRACE_MS = 60 * 60 * 1000;
/** Clock slack allowed between capture and the 3am boundary. */
export const GAME_CAPTURE_SLACK_MS = 30 * 1000;

export const addDays = addDaysToIsoDate;

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Monday = 0 … Sunday = 6. */
export function weekdayOf(date: string): Weekday {
  return MONDAY_FIRST[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

/** The game day an instant falls in: before 3am still belongs to yesterday. */
export function gameLocalDate(instant: Date, timeZone: string): string {
  const local = formatTimeZoneDateTimeParts(instant, timeZone);
  return local.hour < DAY_START_HOUR ? addDays(local.dayKey, -1) : local.dayKey;
}

/**
 * A player's earliest default Day 1 when a game goes live: today only from 3am
 * to 3pm local, otherwise their next game date. After midnight but before 3am
 * that is the calendar date that has just begun, so late-night starts open at
 * 3am rather than handing anyone a short leftover day.
 */
export function acceptanceStartDate(instant: Date, timeZone: string): string {
  const { hour } = formatTimeZoneDateTimeParts(instant, timeZone);
  const today = gameLocalDate(instant, timeZone);
  return hour >= DAY_START_HOUR && hour < GAME_SAME_DAY_CUTOFF_HOUR ? today : addDays(today, 1);
}

/**
 * The instant a game day starts: 3am local on `date`. When a clock change
 * repeats or skips 3am, the day starts at the first instant `gameLocalDate`
 * places in it (the first 3am, or the jump past it), so boundaries and day
 * assignment always agree.
 */
export function dayStartInstant(date: string, timeZone: string): Date {
  const resolved = resolveFloatingIsoTimestampInTimeZone(`${date}T03:00:00`, timeZone);
  if (resolved) return new Date(resolved.timestamp);
  // Every zone's 3am on `date` falls within 15 hours of 3am UTC.
  let before = Date.parse(`${date}T03:00:00Z`) - 15 * HOUR_MS;
  let after = before + 30 * HOUR_MS;
  while (after - before > 1) {
    const middle = Math.floor((before + after) / 2);
    if (gameLocalDate(new Date(middle), timeZone) >= date) after = middle;
    else before = middle;
  }
  return new Date(after);
}

/** Receipt time, not capture time or the game's scheduled date. Offset disambiguates DST folds. */
export function recapPostedAt(instant: Date, timeZone: string): { local: string; timeZone: string; instant: string } {
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "longOffset" }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
  const offset = value("timeZoneName").replace("GMT", "").replace("−", "-") || "+00:00";
  return { local: `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}:${value("second")}${offset}`, timeZone, instant: instant.toISOString() };
}

export function morningAfter(now: Date, zone: string): Date | null {
  try {
    const local = formatTimeZoneDateTimeParts(now, zone);
    const minutes = local.hour * 60 + local.minute;
    if (minutes >= 9 * 60 && minutes < 21 * 60) return now;
    const day = minutes >= 21 * 60 ? new Date(`${local.dayKey}T00:00:00Z`) : null;
    if (day) day.setUTCDate(day.getUTCDate() + 1);
    const date = day?.toISOString().slice(0, 10) ?? local.dayKey;
    const resolved = resolveFloatingIsoTimestampInTimeZone(`${date}T09:00:00`, zone);
    return resolved ? new Date(resolved.timestamp) : null;
  } catch { return null; }
}
