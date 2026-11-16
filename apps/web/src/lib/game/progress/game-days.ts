import { completedEntry, dayIndexAt, eligibleFromDay, indexGameEntries, termsForDay, type RuleState } from "../rules";
import { addDays, weekdayOf } from "../time";
import type { Day } from "./contract";

export interface GameDaysSource { state: RuleState; now: Date; settledAt?: Date | null; endedAt?: Date | null }
export interface GameDay { date: Day; dayIndex: number; done: boolean; ended: boolean }

/** A departure ends that day's unfulfilled obligation, retaining a post made before leaving. */
export function gameDays({ state, now, settledAt, endedAt }: GameDaysSource, memberId: string): GameDay[] | null {
  const player = state.players.find(player => player.memberId === memberId);
  if (!player?.dayOne) return null;
  const today = dayIndexAt(player, now)!;
  const left = player.leftAt ? dayIndexAt(player, player.leftAt)! : state.game.lengthDays;
  const end = state.game.status !== "live" && settledAt ? dayIndexAt(player, settledAt)! : state.game.lengthDays;
  const cancelled = endedAt ? dayIndexAt(player, endedAt)! : state.game.lengthDays;
  const last = Math.min(today, left, end, cancelled, state.game.lengthDays - 1);
  const entries = indexGameEntries(state.entries);
  const days: GameDay[] = [];
  for (let index = eligibleFromDay(state, player); index <= last; index++) {
    const date = addDays(player.dayOne, index);
    const schedule = termsForDay(state.game.terms, index).schedule;
    if ("days" in schedule && !schedule.days.includes(weekdayOf(date))) continue;
    const done = completedEntry(entries, memberId, index) !== null;
    if ((index === left || index === cancelled) && !done) continue;
    days.push({ date, dayIndex: index, done, ended: index < today });
  }
  return days;
}

