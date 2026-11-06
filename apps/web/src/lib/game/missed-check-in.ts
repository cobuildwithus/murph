import { eligibleFromDay, remainingPlayers, termsForDay, isScheduledDay, liveEntry, type RuleState } from "./rules";
import { addDays, dayStartInstant, GAME_GRACE_MS } from "./time";
import { resolveFloatingIsoTimestampInTimeZone } from "@murphai/contracts";

export type MissedCheckInDay = { date: string; status: "posted" | "missed" | "off" | "incomplete" | "open" };

export const GAME_MISSED_CHECK_IN_MAX_LATENESS_MS = 2 * 60 * 60 * 1000;

export function isMissedCheckInDueNow(input: { dueAt: Date; now: Date }): boolean {
  const lateness = input.now.getTime() - input.dueAt.getTime();
  return lateness >= 0 && lateness <= GAME_MISSED_CHECK_IN_MAX_LATENESS_MS;
}

/** A reserved check-in retries until this bound. Reservation is itself within it of the due time. */
export function isMissedCheckInExpired(input: { reservedAt: Date; now: Date }): boolean {
  return input.now.getTime() - input.reservedAt.getTime() > GAME_MISSED_CHECK_IN_MAX_LATENESS_MS;
}

export async function visitGameMissedCheckInPages(input: {
  readPage(cursor: string, limit: number): Promise<readonly string[]>;
  visit(ids: readonly string[]): Promise<void>;
  pageSize?: number;
}): Promise<void> {
  const pageSize = input.pageSize ?? 100;
  let cursor = "";
  for (;;) {
    const ids = await input.readPage(cursor, pageSize);
    if (ids.length === 0) return;
    await input.visit(ids);
    cursor = ids[ids.length - 1]!;
    if (ids.length < pageSize) return;
  }
}

export function canScheduleMissedDayCheckIn(input: { boundRoomId: string | null; gameStatus: string; schedule: { days: readonly number[] } | { count: number } }): boolean {
  return input.boundRoomId !== null && input.gameStatus === "live" && "days" in input.schedule;
}

export function firstDatesOfMissRuns(days: readonly MissedCheckInDay[]): Array<{ firstMissedDate: string; missedDates: string[] }> {
  const runs: Array<{ firstMissedDate: string; missedDates: string[] }> = [];
  let current: { firstMissedDate: string; missedDates: string[] } | null = null;
  for (const day of days) {
    if (day.status === "off") continue;
    if (day.status !== "missed") { current = null; continue; }
    if (current) current.missedDates.push(day.date);
    else { current = { firstMissedDate: day.date, missedDates: [day.date] }; runs.push(current); }
  }
  return runs;
}

export function missedCheckInDueAt(firstMissedDate: string, timeZone: string): Date | null {
  const next = new Date(`${firstMissedDate}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const date = next.toISOString().slice(0, 10);
  const resolved = resolveFloatingIsoTimestampInTimeZone(`${date}T09:00:00`, timeZone);
  return resolved ? new Date(resolved.timestamp) : null;
}

/** Canonical misses exclude incomplete artifacts and any-days capacity. */
export function gameMissedCheckInRuns(state: RuleState, now: Date) {
  if (state.game.status !== "live") return [];
  return remainingPlayers(state).flatMap((player) => {
    if (!player.dayOne) return [];
    const days: MissedCheckInDay[] = Array.from({ length: state.game.lengthDays }, (_, dayIndex) => {
      const date = addDays(player.dayOne!, dayIndex);
      if (dayIndex < eligibleFromDay(state, player) || !("days" in termsForDay(state.game.terms, dayIndex).schedule) || !isScheduledDay(state, dayIndex)) return { date, status: "off" };
      const entry = liveEntry(state.entries, player.memberId, dayIndex);
      if (entry) return { date, status: entry.incomplete ? "incomplete" : "posted" };
      const closed = now.getTime() >= dayStartInstant(addDays(date, 1), player.timeZone).getTime() + GAME_GRACE_MS;
      return { date, status: closed ? "missed" : "open" };
    });
    return firstDatesOfMissRuns(days).map((run) => ({ ...run, memberId: player.memberId, dueAt: missedCheckInDueAt(run.firstMissedDate, player.timeZone) }));
  });
}

/** Stable room horizon includes scheduled players who will ultimately post. */
export function gameMissedCheckInHorizons(states: readonly RuleState[], dates?: ReadonlySet<string>): Map<string, Date> {
  const horizons = new Map<string, Date>();
  for (const state of states) {
    if (state.game.status !== "live") continue;
    for (const player of remainingPlayers(state)) {
      if (!player.dayOne) continue;
      for (let day = eligibleFromDay(state, player); day < state.game.lengthDays; day += 1) {
        if (!("days" in termsForDay(state.game.terms, day).schedule) || !isScheduledDay(state, day)) continue;
        const date = addDays(player.dayOne, day);
        if (dates && !dates.has(date)) continue;
        const due = missedCheckInDueAt(date, player.timeZone);
        if (due && (!horizons.has(date) || due > horizons.get(date)!)) horizons.set(date, due);
      }
    }
  }
  return horizons;
}
