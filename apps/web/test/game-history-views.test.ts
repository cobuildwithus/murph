import { describe, expect, it } from "vitest";

import type { RuleEntry } from "@/src/lib/game/rules";
import type { GameStakeKind } from "@/src/lib/game/contract";
import { GAME_HISTORY_PREVIEW_LIMIT, buildGameHistoryView, buildGameView, type GameViewInput } from "@/src/lib/game/views";

function input(viewerSeat: number, sameTask: boolean, kind: GameStakeKind | null): GameViewInput {
  const tasks = [{ seat: 1, text: sameTask ? "30 lunges" : "15 min walking" }, { seat: 0, text: "30 lunges" }];
  return {
    state: {
      game: {
        id: "history-game", createdBy: "player-0", status: "settled", lengthDays: 7,
        seats: 2, startsOn: null, inviteExpiresAt: null,
        terms: { v: 1, versions: [
          { n: 1, fromDay: 0, schedule: { count: 3 }, stakes: [{ key: "old", kind: "prize" }] },
          { n: 2, fromDay: 0, schedule: { count: 4 }, stakes: kind ? [{ key: "final", kind }] : [] },
          { n: 3, fromDay: 4, schedule: { count: 5 }, stakes: kind ? [{ key: "final", kind }] : [] },
        ] },
      },
      // Deliberately reverse both arrays: orientation must follow seats, not order.
      players: [1, 0].map(seat => ({ seat, memberId: `player-${seat}`, dayOne: "2030-01-01", timeZone: "UTC" })),
      entries: [],
    },
    words: { v: 1, versions: [
      { n: 1, tasks: [{ seat: 0, text: "Old task" }, { seat: 1, text: "Other old task" }], stakes: [{ key: "old", item: "Old prize" }] },
      { n: 2, tasks, stakes: kind ? [{ key: "final", item: "  Lunch of your choice  " }] : [] },
    ] },
    viewerId: `player-${viewerSeat}`, now: new Date("2030-02-01T12:00:00Z"),
    round: 1, previousGameId: null, startedAt: new Date("2030-01-01T00:00:00Z"),
    names: new Map([["player-0", "Challenger"], ["player-1", "Opponent"]]),
    avatarKeys: new Map(), relationships: new Map(), entryWords: new Map(),
    invitee: null, inviteToken: null, inviteExpiresAt: null, recap: null, tickets: [],
    result: { v: 1, termsVersion: 3, scores: [
      { memberId: "player-0", seat: 0, score: 4, misses: 1 },
      { memberId: "player-1", seat: 1, score: 3, misses: 2 },
    ] },
  };
}

describe("game history terms", () => {
  for (const seat of [0, 1]) {
    for (const sameTask of [false, true]) {
      it.each(["prize", "dare", null] as const)(`uses final live-view wording for seat ${seat}, same task ${sameTask}, stake %s`, kind => {
        const fixture = input(seat, sameTask, kind);
        const built = buildGameHistoryView(fixture)!;
        if (!("person" in built)) throw new Error("Expected pair history");
        const history = built.game;
        const live = buildGameView(fixture);
        const expectedTasks = sameTask ? { mine: "30 lunges", theirs: "30 lunges" }
          : seat === 0 ? { mine: "30 lunges", theirs: "15 min walking" }
            : { mine: "15 min walking", theirs: "30 lunges" };
        expect(history.tasks).toEqual(expectedTasks);
        expect(history.tasks.mine).toBe(live.terms.tasks.find(task => task.seat === seat)!.text);
        expect(history.tasks.theirs).toBe(live.terms.tasks.find(task => task.seat !== seat)!.text);
        expect(history.stake).toEqual(kind ? { kind, item: "  Lunch of your choice  " } : null);
        if (kind) expect(history.stake!.item).toBe(live.terms.stakes[0].item);
        expect(history.schedule).toEqual(live.terms.schedule);
      });
    }
  }

  it.each(["winner_gets", "per_miss"] as const)("projects legacy %s without changing its words", kind => {
    const fixture = input(1, false, kind);
    const built = buildGameHistoryView(fixture)!;
    if (!("person" in built)) throw new Error("Expected pair history");
    expect(built.game.stake).toEqual({
      kind: kind === "winner_gets" ? "prize" : "dare", item: "  Lunch of your choice  ",
    });
  });

  it("does not expose terms to a non-player or for an unfinished game", () => {
    const fixture = input(0, false, "prize");
    expect(buildGameHistoryView({ ...fixture, viewerId: "outsider" })).toBeNull();
    fixture.state.game.status = "live";
    expect(buildGameHistoryView(fixture)).toBeNull();
  });
});


describe("game history previews", () => {
  const entry = (id: string, dayIndex: number, seat: number, received: number, kind: RuleEntry["kind"] = "words"): RuleEntry => ({
    id, dayIndex, memberId: `player-${seat}`, receivedAt: new Date(received), kind,
    attempt: 1, withdrawnAt: null, blurHash: null,
    mediaKeys: kind === "photo" ? [`game/player-${seat}/${id}.jpg`] : [],
  });

  it("prefers photos and fills with earliest other posts, returning day, seat, receipt and id order", () => {
    const fixture = input(0, false, null);
    const ordered = [
      entry("a", 0, 0, 100), entry("b", 0, 0, 100, "photo"),
      entry("c", 0, 0, 200), entry("d", 0, 1, 0, "photo"),
      entry("e", 1, 0, 0), entry("f", 1, 1, 0, "photo"),
      entry("g", 2, 0, 0), entry("h", 2, 1, 0, "photo"),
    ];
    fixture.state.entries = [
      ...[...ordered].reverse(),
      { ...entry("withdrawn", 0, 0, 0, "photo"), withdrawnAt: new Date(1) },
      entry("reported", 0, 1, 0, "photo"),
      { ...entry("hidden", 0, 1, 0), attempt: 0, kind: "excuse" },
    ];
    fixture.hiddenEntryIds = new Set(["reported"]);
    fixture.entryWords = new Map([["a", { text: "Finished my walk." }]]);
    const previews = buildGameHistoryView(fixture)!.game.previews;
    expect(previews.map(preview => preview.entryId)).toEqual(["a", "b", "c", "d", "f", "h"]);
    expect(previews).toHaveLength(GAME_HISTORY_PREVIEW_LIMIT);
    expect(previews[0]).toEqual({ entryId: "a", kind: "words", mediaUrls: [], text: "Finished my walk.", data: null, mine: true });
    expect(previews[1]).toMatchObject({ kind: "photo", mediaUrls: ["/api/game/v1/media/game%2Fplayer-0%2Fb.jpg"] });
  });

  it("returns six photos from seven photo days mixed with words", () => {
    const fixture = input(0, false, null);
    fixture.state.entries = Array.from({ length: 7 }, (_, day) => [
      entry(`words-${day}`, day, 0, 0), entry(`photo-${day}`, day, 1, 0, "photo"),
    ]).flat().reverse();
    const previews = buildGameHistoryView(fixture)!.game.previews;
    expect(previews.map(preview => preview.entryId)).toEqual([
      "photo-0", "photo-1", "photo-2", "photo-3", "photo-4", "photo-5",
    ]);
    expect(previews.every(preview => preview.kind === "photo")).toBe(true);
  });

  it.each(["photo", "words"] as const)("keeps the first six posts in day order for an all-%s game", kind => {
    const fixture = input(0, false, null);
    fixture.state.entries = Array.from({ length: 7 }, (_, day) => entry(`day-${day}`, day, day % 2, 0, kind)).reverse();
    expect(buildGameHistoryView(fixture)!.game.previews.map(preview => preview.entryId)).toEqual([
      "day-0", "day-1", "day-2", "day-3", "day-4", "day-5",
    ]);
  });

  it("preserves eligible non-photo kinds, including the viewer's own excuse", () => {
    const fixture = input(0, false, null);
    const kinds = ["excuse", "words", "reps", "heart_rate", "route", "words", "reps"] as const;
    fixture.state.entries = kinds.map((kind, day) => ({
      ...entry(`day-${day}`, day, 0, 0, kind), attempt: kind === "excuse" ? 0 : 1,
    })).reverse();
    expect(buildGameHistoryView(fixture)!.game.previews.map(preview => preview.kind)).toEqual(kinds.slice(0, GAME_HISTORY_PREVIEW_LIMIT));
  });

  it("returns fewer than six previews when fewer posts are visible", () => {
    const fixture = input(0, false, null);
    fixture.state.entries = [entry("photo", 1, 1, 0, "photo"), entry("words", 0, 0, 0)];
    expect(buildGameHistoryView(fixture)!.game.previews.map(preview => preview.entryId)).toEqual(["words", "photo"]);
  });
});
