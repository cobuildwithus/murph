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
    expect(result.gameStreak).toMatchObject({ start: "2026-11-01", end: "2026-11-03", days: 3, missedOn: "2026-11-04" });
    const streak = generateHealthWins({ member: { today, age: null, sex: null, wearableProvider: null },
      games: result.games, gameStreak: result.gameStreak }).find(card => card.kind === "game_streak");
    expect(streak?.chart.calendar?.map(day => [day.date, day.state])).toEqual([
      ["2026-10-26", "no_game"], ["2026-10-27", "no_game"], ["2026-10-28", "no_game"], ["2026-10-29", "no_game"],
      ["2026-10-30", "no_game"], ["2026-10-31", "no_game"], ["2026-11-01", "posted"],
      ["2026-11-02", "posted"], ["2026-11-03", "posted"], ["2026-11-04", "missed"], ["2026-11-05", "posted"],
      ["2026-11-06", "no_game"], ["2026-11-07", "no_game"], ["2026-11-08", "no_game"],
    ]);
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
    expect(original.gameStreak).toMatchObject({ days: 3, start: "2026-11-01", end: "2026-11-03", missedOn: "2026-11-04" });
    const unclassified = gameWinInputs(memberId, today, { ...snapshot, facts: [other] }, null);
    expect(unclassified.games).toEqual([]);
    expect(unclassified.gameStreak).toMatchObject({ days: 1, start: "2026-11-02", end: "2026-11-02", missedOn: "2026-11-04" });
    expect(generateHealthWins({ member: { today, age: null, sex: null, wearableProvider: null },
      games: unclassified.games, gameStreak: unclassified.gameStreak })).toMatchObject([
      { kind: "game_streak", chart: { days: 1, missedOn: "2026-11-04", calendar: [
        { date: "2026-11-02", state: "posted" }, { date: "2026-11-03", state: "no_game" }, { date: "2026-11-04", state: "missed" },
        { date: "2026-11-05", state: "no_game" }, { date: "2026-11-06", state: "no_game" }, { date: "2026-11-07", state: "no_game" },
        { date: "2026-11-08", state: "no_game" },
      ] } },
    ]);

    other.state.entries[0].incomplete = true;
    const corrected = gameWinInputs(memberId, today, snapshot, null);
    expect(corrected.gameStreak).toMatchObject({ days: 1, start: "2026-11-03", end: "2026-11-03", missedOn: "2026-11-04" });
    expect(corrected.sourceRevision).not.toBe(original.sourceRevision);
  });

  it("revises the streak when a post outside the best run changes a dot, and leaves the open day unmarked", () => {
    const source = game("synthetic-cadence", task("Movement practice", null));
    source.now = new Date("2026-11-07T12:00:00Z");
    for (const day of [0, 1, 2, 5]) post(source, day, "photo", null);
    const read = () => gameWinInputs(memberId, "2026-11-07", { facts: [source], states: new Map(), awards: [] }, null);
    const original = read();
    source.state.entries.at(-1)!.incomplete = true;
    const corrected = read();
    for (const result of [original, corrected]) {
      expect(result.games).toEqual([]);
      expect(result.gameStreak).toMatchObject({ days: 3, start: "2026-11-01", end: "2026-11-03", missedOn: "2026-11-04" });
      expect(result.gameStreak?.calendar).not.toContainEqual({ date: "2026-11-07", state: "missed" });
    }
    expect(original.gameStreak?.calendar).toContainEqual({ date: "2026-11-06", state: "posted" });
    expect(corrected.gameStreak?.calendar).toContainEqual({ date: "2026-11-06", state: "missed" });
    expect(corrected.sourceRevision).not.toBe(original.sourceRevision);
  });

  it("keeps accepted run dates, merges overlapping game and vault runs by daily maximum and excludes vault days from game streaks", () => {
    const source = game("synthetic-route", task("Run", { quantity: null, name: "run", unit: "days" }));
    post(source, 1, "route", { activity: "run", distanceM: 3600, durationSec: 1300 });
    const snapshot = { facts: [source], states: new Map([["run.meters", { runsFrom: "2026-11-02",
      vaultRuns: { savedAt: "2026-11-05T00:00:00Z", days: [["2026-11-03", 9000] as [string, number]] } }]]), awards: [] };
    const runs = { days: [{ date: "2026-11-01", km: 15 }, { date: "2026-11-02", km: 3 }, { date: "2026-11-03", km: 2.5 }] };
    const result = gameWinInputs(memberId, today, snapshot, runs);
    // Progress counts meters; the card speaks miles, like the engine's other distance cards.
    expect(result.games[0]).toMatchObject({ exercise: "run", unit: "miles", total: 6100 / 1609.344 });
    expect(generateHealthWins({ member: { today, age: null, sex: null, wearableProvider: null }, games: result.games })
      .find(card => card.kind === "game_climb")?.title).toEqual({ number: "4 miles", measure: "running" });
    expect(result.gameStreak).toMatchObject({ days: 1, start: "2026-11-02", end: "2026-11-02" });
    expect(gameWinInputs(memberId, today, snapshot, { days: [] }).games[0].total).toBe(3600 / 1609.344);
    expect(gameWinInputs(memberId, today, { ...snapshot, facts: [] }, runs).games).toEqual([]);
  });

  it("shows heights and remaining reps for pull-ups and keeps timed exercise totals free of height landmarks", () => {
    const pulls = game("synthetic-pull", task("Pull-up practice", { quantity: 41, unit: "reps", name: "pullups" }));
    const stretch = game("synthetic-stretch", task("Yoga practice", { quantity: 15, unit: "minutes", name: "yoga" }));
    for (const source of [pulls, stretch]) post(source, 0, "photo", null);
    const { games, gameStreak } = gameWinInputs(memberId, today, { facts: [pulls, stretch], states: new Map(), awards: [] }, null);
    const cards = generateHealthWins({ member: { today, age: null, sex: null, wearableProvider: null }, games, gameStreak });
    expect(cards.find(card => card.id === "game_climb:pullups")?.chart).toMatchObject({
      total: 41, unit: "reps", landmarksPassed: [{ id: "hollywood-sign", name: "Hollywood Sign", height: 45, heightUnit: "ft" }],
      next: { id: "christ-the-redeemer", name: "Christ the Redeemer", height: 125, heightUnit: "ft", toGo: 22 },
    });
    expect(cards.find(card => card.id === "game_climb:yoga")?.chart).toMatchObject({
      total: 900, unit: "seconds", landmarksPassed: [], next: null,
    });
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
