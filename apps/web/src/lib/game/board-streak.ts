import { completedEntry, dayIndexAt, eligibleFromDay, indexGameEntries, isScheduledDay, type RuleState } from "./rules";
import { addDays } from "./time";

/** Current run across all obligations on each date, using each frozen game clock. */
export function pairBoardStreak(states: readonly { state: RuleState; now: Date }[], memberId: string): number | null {
  const dates = new Map<string, { complete: boolean; ended: boolean }>();
  for (const { state, now } of states) {
    const player = state.players.find(player => player.memberId === memberId);
    if (!player?.dayOne || !player.timeZone) return null;
    const today = dayIndexAt(player, now)!;
    const entries = indexGameEntries(state.entries);
    for (let day = eligibleFromDay(state, player); day < state.game.lengthDays && day <= today; day++) {
      if (!isScheduledDay(state, day)) continue;
      const date = addDays(player.dayOne, day);
      const previous = dates.get(date);
      dates.set(date, { complete: (previous?.complete ?? true) && completedEntry(entries, memberId, day) !== null,
        ended: (previous?.ended ?? true) && day < today });
    }
  }
  let streak = 0;
  for (const [, day] of [...dates].sort(([a], [b]) => b.localeCompare(a))) {
    if (day.complete) streak++;
    else if (day.ended) break;
  }
  return streak;
}
