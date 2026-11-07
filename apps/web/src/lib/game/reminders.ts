import { formatTimeZoneDateTimeParts } from "@murphai/contracts";
import { attemptsUsed, currentTerms, dayIndexAt, eligibleFromDay, entriesForDay, GAME_POSTS_PER_DAY, isScheduledDay,
  needsPostToday, scorePlayer, type RulePlayer, type RuleState } from "./rules";
import { addDays } from "./time";

export function gameReminderReach(input: { push: boolean; text: boolean; canText: boolean }, selectedOn: boolean, hasPushRoute: boolean): "push" | "text" | "none" {
  if (!selectedOn) return "none";
  if (input.text && input.canText) return "text";
  return input.push && hasPushRoute ? "push" : "none";
}

/** Posting eligibility first; count games add urgency without requiring a perfect game. */
export function reminderOpenDay(state: RuleState, player: RulePlayer, now: Date, everyDay = false): number | null {
  if (player.leftAt || !needsPostToday(state, player.memberId, now)) return null;
  const day = dayIndexAt(player, now)!;
  if (day < eligibleFromDay(state, player) || entriesForDay(state.entries, player.memberId, day).some(entry => entry.attempt === 0)
    || attemptsUsed(state.entries, player.memberId, day) >= GAME_POSTS_PER_DAY) return null;
  if (!everyDay && "count" in currentTerms(state.game.terms).schedule) {
    const shortfall = scorePlayer(state, player).misses;
    let opportunities = 0;
    for (let next = day; next < state.game.lengthDays; next += 1) if (isScheduledDay(state, next)) opportunities += 1;
    if (shortfall <= 0 || opportunities > shortfall) return null;
  }
  return day;
}

/** Wall-clock window, including a reminder just before midnight. Invalid zones skip one member. */
export function gameReminderWindow(now: Date, timeZone: string, minutes: number): { day: string; expiresAt: Date } | null {
  try {
    const local = formatTimeZoneDateTimeParts(now, timeZone);
    const elapsed = (local.hour * 60 + local.minute - minutes + 1440) % 1440;
    if (elapsed >= 30) return null;
    const day = local.hour * 60 + local.minute < minutes ? addDays(local.dayKey, -1) : local.dayKey;
    return { day, expiresAt: new Date(now.getTime() + (30 - elapsed) * 60_000 - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds()) };
  } catch { return null; }
}
