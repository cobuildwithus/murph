import { gameDays, type GameDaysSource } from "./progress/game-days";
import type { Day } from "./progress/contract";

interface StreakDay { date: Day; done: boolean; ended: boolean }

/** One date succeeds only when every game obligation on it succeeds. */
export function obligationDays(games: readonly GameDaysSource[], memberId: string): StreakDay[] | null {
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

function currentRun(days: readonly StreakDay[]): number {
  let count = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].done) count++;
    else if (days[i].ended) break;
  }
  return count;
}

export function pairBoardStreak(games: readonly GameDaysSource[], memberId: string): number | null {
  const days = obligationDays(games, memberId);
  return days === null ? null : currentRun(days);
}
