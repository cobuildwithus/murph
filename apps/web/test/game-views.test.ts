import { describe, expect, it } from "vitest";

import type { GameSchedule } from "@/src/lib/game/contract";
import { decideJoin, type RuleEntry, type RuleState, type TermWords } from "@/src/lib/game/rules";
import { addDays, dayStartInstant } from "@/src/lib/game/time";
import { buildGameView, ticketView, visibleEntryIds, type GameViewInput } from "@/src/lib/game/views";

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

function liveState(schedule: GameSchedule = { days: [0, 1, 2, 3, 4, 5, 6] }, joinAt = JOIN_AT): RuleState {
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
        versions: [{ fromDay: 0, n: 1, schedule, stakes: [{ key: "gsk_breakfast", kind: "winner_gets" }] }],
      },
    },
    players: [{ dayOne: null, memberId: LEO, seat: 0, timeZone: "America/New_York" }],
  };
  const join = decideJoin(invited, { memberId: AVA, now: joinAt, termsVersion: 1, timeZone: "Australia/Sydney" });
  if (join.kind !== "join") throw new Error("expected a join");
  return {
    ...invited,
    game: { ...invited.game, status: "live" },
    players: [
      ...invited.players,
      { dayOne: null, memberId: AVA, seat: 1, timeZone: "Australia/Sydney" },
    ].map((player) => ({
      ...player,
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
    relationships: new Map(),
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

/** `hour` o'clock local on a player's game day (defaults to noon). */
function noonOnDay(state: RuleState, memberId: string, dayIndex: number, hour = 12): Date {
  const player = state.players.find((candidate) => candidate.memberId === memberId)!;
  return new Date(dayStartInstant(addDays(player.dayOne!, dayIndex), player.timeZone).getTime() + (hour - 3) * 60 * 60 * 1000);
}

describe("weekly game views: tickets", () => {
  it("hides the graph until posting and returns the whole image after unlock", () => {
    const state = liveState();
    state.entries.push(entry(AVA, 0, 1, { kind: "heart_rate" }));
    const now = noonOnDay(state, LEO, 0);
    expect(view(state, LEO, now).days[0]?.others[0]).toMatchObject({ status: "locked", entry: null });
    expect(view(state, AVA, now).days[0]?.mine).toMatchObject({ kind: "heart_rate" });
    state.entries.push(entry(LEO, 0, 1));
    expect(view(state, LEO, now).days[0]?.others[0]).toMatchObject({
      status: "posted", entry: { kind: "heart_rate", mediaUrls: expect.arrayContaining([expect.stringContaining(".jpg")]) },
    });
  });

  it("separates canonical profile photos from viewer-private overrides for shared exports", () => {
    const state = liveState();
    const profile = "game/hbm_ava/profile.jpg";
    const privatePhoto = "game/hbm_leo/contact.jpg";
    const input = { profileAvatarKeys: new Map([[AVA, profile]]) };
    const plain = view(state, LEO, JOIN_AT, input).players[1];
    expect(plain.avatarUrl).toBe(plain.profileAvatarUrl);
    expect(plain.profileAvatarUrl).toContain(encodeURIComponent(profile));
    const overridden = view(state, LEO, JOIN_AT, { ...input, avatarKeys: new Map([[AVA, privatePhoto]]) }).players[1];
    expect(overridden.avatarUrl).toContain(encodeURIComponent(privatePhoto));
    expect(overridden.profileAvatarUrl).toBe(plain.profileAvatarUrl);
    const removed = view(state, LEO, JOIN_AT, { avatarKeys: new Map([[AVA, privatePhoto]]) }).players[1];
    expect(removed.profileAvatarUrl).toBeNull();
    expect(removed.avatarUrl).toBe(overridden.avatarUrl);
  });

  it("expires an open ticket just after its 14-day use-by time, and never a redeemed one", () => {
    const row = {
      createdAt: new Date("2026-10-24T17:00:00Z"),
      gameId: "game_views_1",
      id: "gtk_1",
      owedBy: AVA,
      owedTo: LEO,
      redeemedAt: null,
      stakeKey: "gsk_breakfast",
      status: "open" as const,
    };
    const useBy = new Date("2026-11-07T17:00:00Z");
    expect(ticketView(row, WORDS, LEO, useBy)).toMatchObject({
      status: "open",
      useBy: useBy.toISOString(),
      what: "Breakfast in bed",
      youHold: true,
    });
    expect(ticketView(row, WORDS, LEO, new Date(useBy.getTime() + 1)).status).toBe("expired");
    const redeemed = { ...row, redeemedAt: new Date("2026-10-25T09:00:00Z"), status: "redeemed" as const };
    expect(ticketView(redeemed, WORDS, AVA, new Date("2027-01-01T00:00:00Z")).status).toBe("redeemed");
  });
});

describe("weekly game views: post to unlock", () => {
  it("shows the same days off to both players and pairs their posts by index across time zones", () => {
    // Leo (New York) and Ava (Sydney) both start Saturday the 17th; weekdays only.
    const base = liveState({ days: [0, 1, 2, 3, 4] }, new Date("2026-10-16T00:00:00Z"));
    const state = { ...base, entries: [entry(LEO, 0, 1), entry(AVA, 0, 1)] };
    const leoView = view(state, LEO, noonOnDay(state, LEO, 0));
    const avaView = view(state, AVA, noonOnDay(state, AVA, 0));
    expect(leoView.days.map((day) => day.localDate)).toEqual(avaView.days.map((day) => day.localDate));
    expect(leoView.days.map((day) => day.off)).toEqual([false, true, true, false, false, false, false]);
    expect(avaView.days.map((day) => day.off)).toEqual(leoView.days.map((day) => day.off));
    expect(leoView.days[0].others[0].status).toBe("posted");
    expect(avaView.days[0].others[0].status).toBe("posted");
    expect(avaView.days[1].others[0].status).toBe("off");
  });

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
    // 6am in New York: Sydney is still on the same day, so it isn't missed yet.
    const leoView = view(state, LEO, noonOnDay(state, LEO, 0, 6));
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
    const leoNow = noonOnDay(state, LEO, 1, 9);
    const leoView = view(state, LEO, leoNow);
    // At 9am on Day 1 in New York it's midnight in Sydney: Ava's Day 1 isn't over yet.
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
    const leoView = view(invited, LEO, JOIN_AT, { invitee: { memberId: null, name: "Ava", photoKey: null, relationship: null }, inviteToken: "tok_123" });
    expect(leoView.players.map((player) => [player.memberId, player.firstName])).toEqual([[LEO, "Leo"], [null, "Ava"]]);
    expect(leoView.inviteToken).toBe("tok_123");
    expect(leoView.days).toEqual([]);
    expect(leoView.startsOn).toBeNull();
    const picked: RuleState = { ...invited, game: { ...invited.game, startsOn: "2026-10-19" } };
    expect(view(picked, LEO, JOIN_AT, { invitee: { memberId: null, name: "Ava", photoKey: null, relationship: null } }).startsOn).toBe("2026-10-19");
  });

  it("shows the viewer's own typed relationship for others, never for themselves", () => {
    const relationships = new Map([[AVA, "my partner"], [LEO, "should never show"]]);
    expect(view(liveState(), LEO, JOIN_AT, { relationships }).players.map((player) => player.relationship)).toEqual([null, "my partner"]);
    expect(view(liveState(), AVA, JOIN_AT).players.map((player) => player.relationship)).toEqual([null, null]);
  });
});


it("derives streaks from scheduled live posts, ignoring off days and unposted today", () => {
  const state = liveState({days:[0,1,2,3,4]});
  state.players.forEach((player) => {player.dayOne="2026-10-19";});
  state.game.lengthDays = 14;
  state.entries = [0,1,2,3,4].map((day) => entry(LEO,day,1));
  expect(view(state,LEO,noonOnDay(state,LEO,7)).players[0].streak).toBe(5);
  expect(view(state,AVA,noonOnDay(state,LEO,7)).players[0].streak).toBe(5);
  expect(view(state,LEO,noonOnDay(state,LEO,8)).players[0].streak).toBe(0);
  state.entries.push(entry(LEO,7,1),entry(LEO,8,0));
  expect(view(state,LEO,noonOnDay(state,LEO,8)).players[0].streak).toBe(6);
  state.entries[4].withdrawnAt = new Date();
  expect(view(state,LEO,noonOnDay(state,LEO,8)).players[0].streak).toBe(1);
});

it.each(["prize","dare","winner_gets","per_miss"] as const)("returns ticket kind %s from its canonical stake key", (kind) => {
  const state=liveState();state.game.terms.versions[0].stakes[0].kind=kind;
  const row={id:"ticket_kind",gameId:state.game.id,stakeKey:"gsk_breakfast",owedBy:AVA,owedTo:LEO,status:"open" as const,createdAt:JOIN_AT,redeemedAt:null};
  expect(ticketView(row,WORDS,LEO,JOIN_AT,state.game.terms)).toMatchObject({kind,youHold:true});
});
