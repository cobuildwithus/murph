import { resolveFloatingIsoTimestampInTimeZone } from "@murphai/contracts";

export type MissedCheckInDay = { date: string; status: "posted" | "missed" | "off" | "incomplete" | "open" };

export const GAME_MISSED_CHECK_IN_MAX_LATENESS_MS = 2 * 60 * 60 * 1000;

export function isMissedCheckInDueNow(input: { dueAt: Date; now: Date }): boolean {
  const lateness = input.now.getTime() - input.dueAt.getTime();
  return lateness >= 0 && lateness <= GAME_MISSED_CHECK_IN_MAX_LATENESS_MS;
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
