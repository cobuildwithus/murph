import { describe, expect, it } from "vitest";

import type { GameStakeKind } from "@/src/lib/game/contract";
import { buildGameHistoryView, buildGameView, type GameViewInput } from "@/src/lib/game/views";

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
        const history = buildGameHistoryView(fixture)!.game;
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
    expect(buildGameHistoryView(fixture)!.game.stake).toEqual({
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
