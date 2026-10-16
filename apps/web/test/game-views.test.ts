import { describe, expect, it } from "vitest";

import { decideJoin, type RuleEntry, type RuleState, type TermWords } from "@/src/lib/game/rules";
import { addDays, dayStartInstant } from "@/src/lib/game/time";
import { buildGameView, visibleEntryIds, type GameViewInput } from "@/src/lib/game/views";

const LEO = "hbm_leo";
const AVA = "hbm_ava";
const JOIN_AT = new Date("2026-10-17T00:00:00Z");
const WORDS: TermWords = {
  v: 1,
  versions: [{
    n: 1,
    stakes: [{ item: "Breakfast in bed", key: "gsk_breakfast" }],
    tasks: [{ seat: 0, text: "100 pushups" }, { seat: 1, text: "10 min abs" }],
  }],
};

function liveState(): RuleState {
  const invited: RuleState = {
    entries: [],
    game: {
      createdBy: LEO,
      id: "game_views_1",
      inviteExpiresAt: null,
      lengthDays: 7,
      seats: 2,
      startsOn: null,
      status: "invited",
      terms: {
        v: 1,
        versions: [{ fromDay: 0, n: 1, schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [{ key: "gsk_breakfast", kind: "winner_gets" }] }],
      },
    },
    players: [{ active: false, dayOne: null, memberId: LEO, seat: 0, timeZone: "America/New_York" }],
  };
  const join = decideJoin(invited, { memberId: AVA, now: JOIN_AT, termsVersion: 1, timeZone: "Australia/Sydney" });
  if (join.kind !== "join") throw new Error("expected a join");
  return {
    ...invited,
    game: { ...invited.game, status: "live" },
    players: [
      ...invited.players,
      { active: true, dayOne: null, memberId: AVA, seat: 1, timeZone: "Australia/Sydney" },
    ].map((player) => ({
      ...player,
      active: true,
      dayOne: join.players.find((scheduled) => scheduled.memberId === player.memberId)!.dayOne,
    })),
  };
}

function entry(memberId: string, dayIndex: number, attempt: number, overrides: Partial<RuleEntry> = {}): RuleEntry {
  return {
    attempt,
    dayIndex,
    id: `${memberId}-d${dayIndex}-a${attempt}`,
    kind: attempt === 0 ? "excuse" : "photo",
    mediaKeys: [`game/${memberId}/d${dayIndex}-a${attempt}.jpg`],
    memberId,
    withdrawnAt: null,
    ...overrides,
  };
}

function view(state: RuleState, viewerId: string, now: Date, overrides: Partial<GameViewInput> = {}) {
  return buildGameView({
    avatarKeys: new Map(),
    entryWords: new Map(state.entries.map((item) => [item.id, { text: `caption ${item.id}` }])),
    invitee: null,
    inviteExpiresAt: null,
    inviteToken: null,
    names: new Map([[LEO, "Leo"], [AVA, "Ava"]]),
    now,
    result: null,
    round: 1,
    startedAt: JOIN_AT,
    state,
    tickets: [],
    viewerId,
    words: WORDS,
    ...overrides,
  });
}

function noonOnDay(state: RuleState, memberId: string, dayIndex: number): Date {
  const player = state.players.find((candidate) => candidate.memberId === memberId)!;
  return new Date(dayStartInstant(addDays(player.dayOne!, dayIndex), player.timeZone).getTime() + 9 * 60 * 60 * 1000);
}

describe("weekly game views: post to unlock", () => {
  it("hides another player's post, words and media until you post that day", () => {
    const state = { ...liveState(), entries: [entry(LEO, 0, 1)] };
    const avaNow = noonOnDay(state, AVA, 0);
    const avaView = view(state, AVA, avaNow);
    expect(avaView.days[0].others).toEqual([{ entry: null, seat: 0, status: "locked" }]);
    expect(JSON.stringify(avaView)).not.toContain("caption");
    expect(JSON.stringify(avaView)).not.toContain("game/hbm_leo/");
    expect(visibleEntryIds(state, AVA).size).toBe(0);

    const both = { ...state, entries: [...state.entries, entry(AVA, 0, 1)] };
    const unlocked = view(both, AVA, avaNow).days[0].others[0];
    expect(unlocked.status).toBe("posted");
    expect(unlocked.entry).toMatchObject({
      mediaUrls: ["/api/game/v1/media/game%2Fhbm_leo%2Fd0-a1.jpg"],
      text: `caption ${LEO}-d0-a1`,
    });
  });

  it("keeps a day unlocked after you withdraw, but never shows withdrawn posts to others", () => {
    const state = {
      ...liveState(),
      entries: [entry(LEO, 0, 1), entry(AVA, 0, 1, { withdrawnAt: JOIN_AT })],
    };
    const avaView = view(state, AVA, noonOnDay(state, AVA, 0));
    expect(avaView.days[0].others[0].status).toBe("posted");
    expect(avaView.days[0].mine).toBeNull();
    const leoView = view(state, LEO, noonOnDay(state, LEO, 0));
    expect(leoView.days[0].others[0]).toEqual({ entry: null, seat: 1, status: "none" });
  });

  it("never unlocks on an excuse, and never shows an excuse to anyone else, even after settle", () => {
    const state = { ...liveState(), entries: [entry(LEO, 0, 1), entry(AVA, 0, 0)] };
    expect(view(state, AVA, noonOnDay(state, AVA, 0)).days[0].others[0].status).toBe("locked");
    expect(view(state, AVA, noonOnDay(state, AVA, 0)).days[0].mine?.kind).toBe("excuse");
    const settled: RuleState = { ...state, game: { ...state.game, status: "settled" } };
    const leoView = view(settled, LEO, noonOnDay(state, LEO, 8));
    expect(leoView.days[0].others[0]).toEqual({ entry: null, seat: 1, status: "missed" });
    expect(visibleEntryIds(settled, LEO).has(`${AVA}-d0-a0`)).toBe(false);
    // After settle every live post is visible to the players.
    expect(view(settled, AVA, noonOnDay(state, AVA, 8)).days[0].others[0].status).toBe("posted");
  });

  it("marks missed days only once that player's day is over, and shows scores and retakes", () => {
    const state = { ...liveState(), entries: [entry(LEO, 0, 1), entry(LEO, 1, 1)] };
    const leoNow = noonOnDay(state, LEO, 1);
    const leoView = view(state, LEO, leoNow);
    // At noon on Leo's Day 1 (New York), Ava (Sydney) is just past 3am on her Day 1.
    expect(leoView.days[0].others[0].status).toBe("missed");
    expect(leoView.days[1].others[0].status).toBe("none");
    expect(leoView.players.map((player) => [player.firstName, player.dayIndex, player.score, player.isMe]))
      .toEqual([["Leo", 1, 2, true], ["Ava", 1, 0, false]]);
    expect(leoView.retakeAvailable).toBe(true);
    expect(leoView.terms).toMatchObject({
      stakes: [{ item: "Breakfast in bed", key: "gsk_breakfast", kind: "winner_gets" }],
      tasks: [{ seat: 0, text: "100 pushups" }, { seat: 1, text: "10 min abs" }],
    });
    const retaken = { ...state, entries: [...state.entries, entry(LEO, 1, 2)] };
    retaken.entries[1] = { ...retaken.entries[1], withdrawnAt: leoNow };
    expect(view(retaken, LEO, leoNow).retakeAvailable).toBe(false);
  });

  it("shows the invitee placeholder and invite token only to the challenger while invited", () => {
    const base = liveState();
    const invited: RuleState = { ...base, game: { ...base.game, status: "invited" }, players: [{ ...base.players[0], dayOne: null }] };
    const leoView = view(invited, LEO, JOIN_AT, { invitee: { name: "Ava", photoKey: null }, inviteToken: "tok_123" });
    expect(leoView.players.map((player) => [player.memberId, player.firstName])).toEqual([[LEO, "Leo"], [null, "Ava"]]);
    expect(leoView.inviteToken).toBe("tok_123");
    expect(leoView.days).toEqual([]);
    expect(leoView.startsOn).toBeNull();
    const picked: RuleState = { ...invited, game: { ...invited.game, startsOn: "2026-10-19" } };
    expect(view(picked, LEO, JOIN_AT, { invitee: { name: "Ava", photoKey: null } }).startsOn).toBe("2026-10-19");
  });
});
