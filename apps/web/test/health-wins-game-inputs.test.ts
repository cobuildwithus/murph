import { describe, expect, it, vi } from "vitest";
import { readGameSeriesFacts } from "../src/lib/game/progress/series";
import { ProgressReadTiming } from "../src/lib/game/progress/read-timing";
import type { StoredAward } from "../src/lib/game/progress/awards";
import { weekdayOf } from "../src/lib/game/time";
import { gameWinInputs } from "../src/lib/health-wins/game-inputs";
import { generateHealthWins } from "../src/lib/health-wins/engine";
import { game, memberId, post, task } from "./support/progress-games";

const db = vi.hoisted(() => ({ game: { findMany: vi.fn() }, gameEntry: { findMany: vi.fn() } }));
vi.mock("../src/lib/prisma", () => ({ getPrisma: () => db }));

describe("game inputs for health wins", () => {
  const today = "2026-11-05";
  const bodyweight = () => game("synthetic-routine", task("Pushup practice", { quantity: 85, unit: "reps", name: "pushups" }));

  it("counts typed check-ins once, keeps only earned landmarks and requires every scheduled game for streaks", () => {
    const source = bodyweight();
    for (const day of [0, 1, 2, 3, 4]) post(source, day, "photo", null);
    source.state.entries[2].withdrawnAt = source.now;
    post(source, 2, "reps", { exercise: "pushups", count: 12, reps: [] });
    source.state.entries.at(-1)!.attempt = 2;
    const other = game("synthetic-practice", task("Balance practice", null));
    other.state.game.terms.versions[0].schedule = { days: [weekdayOf("2026-11-04")] };
    const result = gameWinInputs(memberId, today, { facts: [source, other], states: new Map(), awards: [] }, null);
    expect(result.games).toHaveLength(1);
    expect(result.games[0]).toMatchObject({ exercise: "pushups", total: 352, unit: "reps" });
    expect(result.gameStreak).toEqual({ start: "2026-11-01", end: "2026-11-03", days: 3, missedOn: "2026-11-04" });
    expect(result.games[0].landmarksPassed.length).toBeGreaterThan(0);
    expect(result.games[0].landmarksPassed.every(item => item.height <= 352)).toBe(true);
    expect(result.games[0].next?.toGo).toBe(Math.ceil(result.games[0].next!.height - 352));
  });

  it("counts alternating games in one streak, including unclassified tasks, and breaks on a missed game-only date", () => {
    const source = bodyweight();
    source.state.game.terms.versions[0].schedule = { days: ["2026-11-01", "2026-11-03"].map(weekdayOf) };
    post(source, 0, "photo", null);
    post(source, 2, "photo", null);
    const other = game("synthetic-pause", task("Balance practice", null));
    other.state.game.terms.versions[0].schedule = { days: ["2026-11-02", "2026-11-04"].map(weekdayOf) };
    post(other, 1, "photo", null);
    const snapshot = { facts: [source, other], states: new Map(), awards: [] };
    const original = gameWinInputs(memberId, today, snapshot, null);
    expect(original.gameStreak).toEqual({ days: 3, start: "2026-11-01", end: "2026-11-03", missedOn: "2026-11-04" });
    const unclassified = gameWinInputs(memberId, today, { ...snapshot, facts: [other] }, null);
    expect(unclassified.games).toEqual([]);
    expect(unclassified.gameStreak).toEqual({ days: 1, start: "2026-11-02", end: "2026-11-02", missedOn: "2026-11-04" });
    expect(generateHealthWins({ member: { today, age: null, sex: null, wearableProvider: null },
      games: unclassified.games, gameStreak: unclassified.gameStreak })).toMatchObject([
      { kind: "game_streak", chart: { days: 1, missedOn: "2026-11-04" } },
    ]);

    other.state.entries[0].incomplete = true;
    const corrected = gameWinInputs(memberId, today, snapshot, null);
    expect(corrected.gameStreak).toEqual({ days: 1, start: "2026-11-03", end: "2026-11-03", missedOn: "2026-11-04" });
    expect(corrected.sourceRevision).not.toBe(original.sourceRevision);
  });

  it("keeps accepted run dates, merges overlapping game and vault runs by daily maximum and excludes vault days from game streaks", () => {
    const source = game("synthetic-route", task("Run", { quantity: null, name: "run", unit: "days" }));
    post(source, 1, "route", { activity: "run", distanceM: 3600, durationSec: 1300 });
    const snapshot = { facts: [source], states: new Map([["run.meters", { runsFrom: "2026-11-02",
      vaultRuns: { savedAt: "2026-11-05T00:00:00Z", days: [["2026-11-03", 9000] as [string, number]] } }]]), awards: [] };
    const runs = { days: [{ date: "2026-11-01", km: 15 }, { date: "2026-11-02", km: 3 }, { date: "2026-11-03", km: 2.5 }] };
    const result = gameWinInputs(memberId, today, snapshot, runs);
    expect(result.games[0]).toMatchObject({ exercise: "run", total: 6100 });
    expect(result.gameStreak).toMatchObject({ days: 1, start: "2026-11-02", end: "2026-11-02" });
    expect(gameWinInputs(memberId, today, snapshot, { days: [] }).games[0].total).toBe(3600);
    expect(gameWinInputs(memberId, today, { ...snapshot, facts: [] }, runs).games).toEqual([]);
  });

  it("changes the member-bound revision after a correction, changed per-day measure, and award insertion", () => {
    const source = game("synthetic-count", task("Burpee practice", { quantity: null, name: "burpees", unit: "days" }));
    post(source, 0, "photo", null);
    const states = new Map<string, { perDay: number }>();
    const awards: StoredAward[] = [];
    const read = () => gameWinInputs(memberId, today, { facts: [source], states, awards }, null).sourceRevision;
    const original = read();
    expect(read()).toBe(original);
    states.set("h123456789012.days", { perDay: 27 });
    const specified = read();
    expect(specified).not.toBe(original);
    awards.push({ id: "synthetic-award", kind: "days", key: "synthetic-key", on: today, createdAt: source.now,
      seenAt: null, measureId: "burpees.reps", subjectMemberId: null, data: {} });
    const earned = read();
    expect(earned).not.toBe(specified);
    source.state.entries[0].incomplete = true;
    expect(read()).not.toBe(earned);
    expect(earned).not.toContain("burpees");
  });

  it("refuses partial history before reading entries or decrypting any fields", async () => {
    db.game.findMany.mockResolvedValue([{}, {}]);
    await expect(readGameSeriesFacts(memberId, new Date(), new ProgressReadTiming(), [],
      { games: 1, entries: 30, awards: 10, measures: 10 })).rejects.toThrow("game budget");
    expect(db.game.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2 }));
    expect(db.gameEntry.findMany).not.toHaveBeenCalled();
  });
});
