import { completedEntry, dayIndexAt, eligibleFromDay, indexGameEntries, termsForDay, type RuleState } from "../rules";
import { addDays, weekdayOf } from "../time";
import type { Day, Streak } from "./contract";

export interface StreakGame { state: RuleState; now: Date; settledAt?: Date | null; endedAt?: Date | null }
export interface ObligationDay { date: Day; gameId: string; dayIndex: number; done: boolean; ended: boolean }
export interface StreakDay { date: Day; done: boolean; ended: boolean }

/** A departure ends that day's unfulfilled obligation, retaining a post made before leaving. */
export function gameDays({ state, now, settledAt, endedAt }: StreakGame, memberId: string): ObligationDay[] | null {
  const player = state.players.find(player => player.memberId === memberId);
  if (!player?.dayOne) return null;
  const today = dayIndexAt(player, now)!;
  const left = player.leftAt ? dayIndexAt(player, player.leftAt)! : state.game.lengthDays;
  const end = state.game.status !== "live" && settledAt ? dayIndexAt(player, settledAt)! : state.game.lengthDays;
  const cancelled = endedAt ? dayIndexAt(player, endedAt)! : state.game.lengthDays;
  const last = Math.min(today, left, end, cancelled, state.game.lengthDays - 1);
  const entries = indexGameEntries(state.entries);
  const days: ObligationDay[] = [];
  for (let index = eligibleFromDay(state, player); index <= last; index++) {
    const date = addDays(player.dayOne, index);
    const schedule = termsForDay(state.game.terms, index).schedule;
    if ("days" in schedule && !schedule.days.includes(weekdayOf(date))) continue;
    const done = completedEntry(entries, memberId, index) !== null;
    if ((index === left || index === cancelled) && !done) continue;
    days.push({ date, gameId: state.game.id, dayIndex: index, done, ended: index < today });
  }
  return days;
}

/** One date succeeds only when every game obligation on it succeeds. */
export function obligationDays(games: readonly StreakGame[], memberId: string): StreakDay[] | null {
  const dates = new Map<Day, StreakDay>();
  for (const game of games) {
    const days = gameDays(game, memberId);
    if (days === null) return null;
    for (const day of days) {
      const previous = dates.get(day.date);
      dates.set(day.date, { date: day.date, done: (previous?.done ?? true) && day.done,
        ended: (previous?.ended ?? true) && day.ended });
    }
  }
  return [...dates.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function currentRun(days: readonly StreakDay[]): number {
  let count = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].done) count++;
    else if (days[i].ended) break;
  }
  return count;
}

export function bestRun(days: readonly StreakDay[]): Streak["best"] {
  let best: Streak["best"] = null;
  let count = 0;
  let from = "";
  for (const day of days) {
    if (day.done) {
      if (count === 0) from = day.date;
      count++;
      if (!best || count > best.count) best = { count, from, to: day.date };
    } else if (day.ended) count = 0;
  }
  return best;
}

export function calendarMonths(days: readonly StreakDay[], joinedOn: Day, today: Day): Streak["months"] {
  const dates = new Map(days.map(day => [day.date, day]));
  const months = new Map<string, string>();
  for (let date = `${joinedOn.slice(0, 7)}-01`; date.slice(0, 7) <= today.slice(0, 7); date = addDays(date, 1)) {
    const day = dates.get(date);
    const letter = date > today ? "f" : day?.done ? "d" : date === today ? "t" : day ? "m" : ".";
    const month = date.slice(0, 7);
    months.set(month, (months.get(month) ?? "") + letter);
  }
  return [...months].map(([month, days]) => ({ month, days }));
}

export function pairBoardStreak(games: readonly StreakGame[], memberId: string): number | null {
  const days = obligationDays(games, memberId);
  return days === null ? null : currentRun(days);
}
