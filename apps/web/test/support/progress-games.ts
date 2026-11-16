import type { GameEntryData, GameEntryKind } from "../../src/lib/game/contract";
import type { ProgressGame, ProgressTask } from "../../src/lib/game/progress/series";
import type { InferredMeasure } from "../../src/lib/game/progress/infer";
import { addDays } from "../../src/lib/game/time";

export const memberId = "member-ava";
export function task(text: string, inferred: InferredMeasure | null): ProgressTask {
  return { text, kind: "any", lookup: "synthetic-task-123456789012", inferred };
}
export function game(id: string, taskInput: ProgressTask): ProgressGame {
  return { now: new Date("2026-11-05T12:00:00Z"), settledAt: null, tasks: new Map([[1, taskInput]]), payloads: new Map(),
    state: { game: { id, createdBy: memberId, seats: 2, status: "live", lengthDays: 7, startsOn: "2026-11-01", inviteExpiresAt: null,
      terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [] }] } },
    players: [{ memberId, seat: 0, dayOne: "2026-11-01", timeZone: "UTC", joinedAt: new Date("2026-11-01T12:00:00Z"), leftAt: null }], entries: [] } };
}
export function post(game: ProgressGame, dayIndex: number, kind: GameEntryKind, data: GameEntryData | null): void {
  const id = `${game.state.game.id}:${dayIndex}:${game.state.entries.length}`;
  game.state.entries.push({ id, memberId, dayIndex, attempt: kind === "excuse" ? 0 : 1, kind, mediaKeys: [], blurHash: null,
    incomplete: null, receivedAt: new Date(`${addDays(game.state.players[0].dayOne!, dayIndex)}T12:00:00Z`), withdrawnAt: null });
  if (data) game.payloads.set(id, data);
}
