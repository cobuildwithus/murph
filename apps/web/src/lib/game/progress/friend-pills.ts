import type { Friends } from "./contract";
import { friendMeasure, type FriendGameSeries } from "./friend-games";
import { isEveryoneMeasure } from "./friends";
import { gameNotFound } from "../http/errors";

export function friendExerciseIds(games: FriendGameSeries, memberId: string, ids: string[]): string[] {
  const mine = new Set((games.amounts.get(memberId) ?? []).map(day => day.measureId));
  const shared = new Set(ids.filter(id => id !== memberId).flatMap(id => (games.amounts.get(id) ?? []).map(day => day.measureId)));
  return [...mine].filter(id => ids.length === 1 || shared.has(id) || games.pending.length > 0);
}

/** Pending classifications must not remove the member's known exercise pills. */
export function friendPills(games: FriendGameSeries, memberId: string, ids: string[], selected: string, requireSelected = true): Friends["pills"] {
  const mine = new Set((games.amounts.get(memberId) ?? []).map(day => day.measureId));
  if (requireSelected && !["steps", "sleep"].includes(selected) && !mine.has(selected) && !games.pending.length) throw gameNotFound();
  const exercises = games.windowed ? [...mine] : friendExerciseIds(games, memberId, ids);
  if (!requireSelected && !exercises.includes(selected)) exercises.push(selected);
  return [...exercises.map(id => games.measures.get(id) ?? friendMeasure(id)),
    { id: "steps", label: "Steps", icon: "steps" }, { id: "sleep", label: "Sleep", icon: "sleep" }]
    .map(({ id, label, icon }) => ({ id, label, icon, everyone: isEveryoneMeasure(id) }));
}

