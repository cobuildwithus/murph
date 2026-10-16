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
const DAY_MS = 24 * 60 * 60 * 1000;
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

/** The instant a game day starts: 3am local on `date`. */
export function dayStartInstant(date: string, timeZone: string): Date {
  const resolved = resolveFloatingIsoTimestampInTimeZone(`${date}T03:00:00`, timeZone);
  if (!resolved) throw new RangeError(`No 3am on ${date} in ${timeZone}.`);
  return new Date(resolved.timestamp);
}
