import { describe, expect, it } from "vitest";

import { gameChatProgress } from "@/src/lib/game/chat-progress";
import type { GameEntryKind, GameSchedule } from "@/src/lib/game/contract";
import { areGameDevToolsAllowed, gameOnSql, gameOnWhere, isGameEnabled, isGameEnabledFor, isGameOn, mediaKeyOwner, mediaKeyPrefixFor } from "@/src/lib/game/access";
import {
  decideCancelInvite,
  decideDayCompletion,
  playerStreak,
  decideDevAdvance,
  decideJoin,
  decideNegotiationStart,
  decideNewTerms,
  decidePost,
  decideSettle,
  decideStartNow,
  decideWithdraw,
  dayIndexAt,
  GameRuleError,
  isGameDue,
  isScheduledDay,
  outcomeFor,
  parseStoredTerms,
  playerFor,
  scorePlayer,
  type RuleState,
  type Schedule,
  type StoredStake,
} from "@/src/lib/game/rules";
import { addDays, dayStartInstant, weekdayOf } from "@/src/lib/game/time";

const LEO = "hbm_leo";
const AVA = "hbm_ava";
const NYC = "America/New_York";
const SYD = "Australia/Sydney";
// Friday 2026-10-16, 8am in New York; 11pm the same Friday in Sydney. Both
// are on Friday's game day, so Day 1 is Saturday the 17th for both.
const JOIN_AT = new Date("2026-10-16T12:00:00Z");
// Friday 8pm in New York is already Saturday 11am in Sydney.
const LATE_JOIN_AT = new Date("2026-10-17T00:00:00Z");
const EVERY_DAY: GameSchedule = { days: [0, 1, 2, 3, 4, 5, 6] };
const WINNER_GETS: StoredStake = { key: "gsk_breakfast", kind: "winner_gets" };
const PER_MISS: StoredStake = { key: "gsk_massage", kind: "per_miss" };
const STAKE_INPUT = { item: "Breakfast in bed", kind: "prize" as const };

function invited(schedule: GameSchedule = EVERY_DAY, stakes: StoredStake[] = [WINNER_GETS], startsOn: string | null = null): RuleState {
  return {
    entries: [],
    game: {
      createdBy: LEO,
      id: "game_rules_1",
      inviteExpiresAt: new Date("2026-10-23T00:00:00Z"),
      lengthDays: 7,
      seats: 2,
      startsOn,
      status: "invited",
      terms: { v: 1, versions: [{ fromDay: 0, n: 1, schedule, stakes }] },
    },
    players: [{ dayOne: null, memberId: LEO, seat: 0, timeZone: NYC }],
  };
}

function live(state: RuleState = invited(), avaTimeZone = SYD, joinAt = JOIN_AT): RuleState {
  const decision = decideJoin(state, { memberId: AVA, now: joinAt, termsVersion: 1, timeZone: avaTimeZone });
  if (decision.kind !== "join") throw new Error("expected a join");
  const players = [
    ...state.players,
    { dayOne: null, memberId: AVA, seat: decision.seat, timeZone: avaTimeZone },
  ];
  return {
    ...state,
    game: { ...state.game, status: "live" },
    players: players.map((player) => ({ ...player, dayOne: dayOneOf(decision, player.memberId) })),
  };
}

function dayOneOf(schedule: Schedule, memberId: string): string {
  return schedule.players.find((player) => player.memberId === memberId)!.dayOne;
}

/** The instant `hour` o'clock local on a player's game day (hours past 24 run into the next date). */
function at(state: RuleState, memberId: string, dayIndex: number, hour: number, minute = 0): Date {
  const player = playerFor(state, memberId)!;
  const start = dayStartInstant(addDays(player.dayOne!, dayIndex), player.timeZone);
  return new Date(start.getTime() + ((hour - 3) * 60 + minute) * 60 * 1000);
}

let entrySeq = 0;
function post(
  state: RuleState,
  memberId: string,
  now: Date,
  options: { kind?: GameEntryKind; captureAgeMs?: number } = {},
): RuleState {
  const kind = options.kind ?? "photo";
  const decision = decidePost(state, {
    captureAgeMs: options.captureAgeMs ?? null,
    kind,
    mediaKeyPrefix: mediaKeyPrefixFor(memberId),
    mediaKeys: [`${mediaKeyPrefixFor(memberId)}shot-${entrySeq}.jpg`],
    memberId,
    now,
  });
  entrySeq += 1;
  return {
    ...state,
    entries: [
      ...state.entries.map((entry) => (entry.id === decision.withdrawEntryId ? { ...entry, withdrawnAt: now } : entry)),
      {
        attempt: decision.attempt,
        dayIndex: decision.dayIndex,
        id: `entry_${entrySeq}`,
        kind,
        mediaKeys: [],
        memberId,
        receivedAt: new Date("2030-03-05T12:00:00Z"), blurHash: null, withdrawnAt: null,
      },
    ],
  };
}

function withdraw(state: RuleState, memberId: string, now: Date, entryId = state.entries.at(-1)!.id): RuleState {
  const { withdraw: change } = decideWithdraw(state, { entryId, memberId, now });
  return {
    ...state,
    entries: state.entries.map((entry) => (entry.id === change?.entryId ? { ...entry, withdrawnAt: now } : entry)),
  };
}

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof GameRuleError) return error.error.code;
    throw error;
  }
  return "OK";
}

describe("weekly game: terms", () => {
  it("defaults old stored terms to photos and rejects unknown requirements", () => {
    const stored = invited().game.terms;
    expect(parseStoredTerms(stored).versions[0].checkInKind).toBe("photo");
    expect(codeOf(() => post(live(), LEO, at(live(), LEO, 0, 9), { kind: "heart_rate" }))).toBe("INVALID_REQUEST");
    expect(() => parseStoredTerms({ ...stored, versions: [{ ...stored.versions[0], checkInKind: "video" }] })).toThrow();
  });

  it("validates the challenge and gives every stake a fresh key", () => {
    let next = 0;
    const newKey = () => `gsk_new_${(next += 1)}`;
    const made = decideNewTerms(
      {
        schedule: { days: [4, 0, 2] },
        stakes: [
          { item: "Breakfast in bed", key: "gsk_breakfast", kind: "prize" },
        ],
        tasks: [{ seat: 1, text: "10 min abs" }, { seat: 0, text: "100 pushups" }],
      },
      { newKey, today: "2026-10-16" },
    );
    expect(made.lengthDays).toBe(7);
    expect(made.terms.versions[0]).toEqual({
      checkInKind: "any",
      fromDay: 0,
      n: 1,
      schedule: { days: [0, 2, 4] },
      stakes: [{ key: "gsk_new_1", kind: "prize" }],
    });
    expect(made.words.versions[0].tasks).toEqual([{ seat: 0, text: "100 pushups" }, { seat: 1, text: "10 min abs" }]);
    // Words stay out of the plain terms.
    expect(JSON.stringify(made.terms)).not.toContain("Breakfast");
    expect(parseStoredTerms(JSON.parse(JSON.stringify(made.terms)))).toEqual(made.terms);
  });

  it("rejects bad schedules, counts and task lists", () => {
    const base = { stakes: [STAKE_INPUT], tasks: [{ seat: 0, text: "Run" }, { seat: 1, text: "Swim" }] };
    const options = { newKey: () => "gsk_x", today: "2026-10-16" };
    expect(codeOf(() => decideNewTerms({ ...base, schedule: { days: [] } }, options))).toBe("INVALID_REQUEST");
    expect(codeOf(() => decideNewTerms({ ...base, schedule: { count: 8 } }, options))).toBe("INVALID_REQUEST");
    expect(codeOf(() => decideNewTerms({ ...base, schedule: { count: 5 }, tasks: [{ seat: 0, text: "Run" }] }, options)))
      .toBe("INVALID_REQUEST");
    expect(codeOf(() => decideNewTerms({ ...base, lengthDays: 14, schedule: { count: 10 } }, options))).toBe("OK");
    // New games have exactly one prize or dare.
    expect(codeOf(() => decideNewTerms({ ...base, schedule: EVERY_DAY, stakes: [] }, options))).toBe("INVALID_REQUEST");
    expect(codeOf(() => decideNewTerms({ ...base, schedule: EVERY_DAY, stakes: Array(4).fill(STAKE_INPUT) }, options)))
      .toBe("INVALID_REQUEST");
    expect(codeOf(() => decideNewTerms({ ...base, schedule: EVERY_DAY, stakes: Array(3).fill(STAKE_INPUT) }, options))).toBe("INVALID_REQUEST");
  });

  it("takes a picked start date from tomorrow to 60 days out in the challenger's zone", () => {
    const base = { schedule: EVERY_DAY, stakes: [STAKE_INPUT], tasks: [{ seat: 0, text: "Run" }, { seat: 1, text: "Swim" }] };
    const options = { newKey: () => "gsk_x", today: "2026-10-16" };
    expect(decideNewTerms({ ...base, startsOn: "2026-10-19" }, options).startsOn).toBe("2026-10-19");
    expect(decideNewTerms(base, options).startsOn).toBeNull();
    expect(codeOf(() => decideNewTerms({ ...base, startsOn: "2026-10-17" }, options))).toBe("OK");
    expect(codeOf(() => decideNewTerms({ ...base, startsOn: "2026-10-16" }, options))).toBe("INVALID_REQUEST");
    expect(codeOf(() => decideNewTerms({ ...base, startsOn: "2026-12-15" }, options))).toBe("OK");
    expect(codeOf(() => decideNewTerms({ ...base, startsOn: "2026-12-16" }, options))).toBe("INVALID_REQUEST");
  });
});

describe("weekly game: joining", () => {
  it("uses the accepter cutoff and the other player’s current game date", () => {
    const decision = decideJoin(invited(), { memberId: AVA, now: LATE_JOIN_AT, termsVersion: 1, timeZone: SYD });
    expect(decision).toMatchObject({ kind: "join", seat: 1, startedAt: LATE_JOIN_AT });
    if (decision.kind !== "join") return;
    // Sydney accepts on Saturday morning: both start Saturday.
    expect(decision.players).toEqual([
      { dayOne: "2026-10-17", memberId: LEO, timeZone: NYC },
      { dayOne: "2026-10-17", memberId: AVA, timeZone: SYD },
    ]);
    // Due an hour after the last player's last day ends (New York, 3am Oct 24 local).
    const state = live(invited(), SYD, LATE_JOIN_AT);
    expect(isGameDue(state, new Date("2026-10-24T07:59:59Z"))).toBe(false);
    expect(isGameDue(state, new Date("2026-10-24T08:00:00Z"))).toBe(true);
  });

  it("puts every day number on the same date and weekday for both players, whatever hour they accept", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const now = new Date(Date.UTC(2026, 9, 16, hour, 15));
      const state = live(invited({ days: [0, 1, 2, 3, 4] }, [WINNER_GETS], "2026-10-17"), SYD, now);
      const [leo, ava] = state.players;
      expect(ava.dayOne, `accepted ${now.toISOString()}`).toBe(leo.dayOne);
      for (let day = 0; day < 7; day += 1) {
        expect(weekdayOf(addDays(ava.dayOne!, day))).toBe(weekdayOf(addDays(leo.dayOne!, day)));
      }
    }
  });

  it("still settles a game whose last day ends on a clock change that repeats 3am", () => {
    // Athens repeats 3am on 2026-10-25, the end of Ava's week; New York ends later and decides.
    const state = live(invited(EVERY_DAY, [WINNER_GETS], "2026-10-18"), "Europe/Athens", new Date("2026-10-17T10:00:00Z"));
    expect(isGameDue(state, new Date("2026-10-25T07:59:59Z"))).toBe(false);
    expect(isGameDue(state, new Date("2026-10-25T08:00:00Z"))).toBe(true);
    expect(decideSettle(state).result.scores).toHaveLength(2);
  });

  it("is single-use, expires, and holds everyone to the latest terms", () => {
    const state = live();
    expect(codeOf(() => decideJoin(state, { memberId: "hbm_kat", now: JOIN_AT, termsVersion: 1, timeZone: NYC })))
      .toBe("INVITE_USED");
    expect(decideJoin(state, { memberId: AVA, now: JOIN_AT, termsVersion: 1, timeZone: SYD })).toEqual({ kind: "already-joined" });
    expect(codeOf(() => decideJoin(invited(), {
      memberId: AVA,
      now: new Date("2026-10-23T00:00:01Z"),
      termsVersion: 1,
      timeZone: SYD,
    }))).toBe("INVITE_EXPIRED");
    expect(codeOf(() => decideJoin(invited(), { memberId: AVA, now: JOIN_AT, termsVersion: 2, timeZone: SYD })))
      .toBe("TERMS_CHANGED");
    const declined: RuleState = { ...invited(), game: { ...invited().game, status: "void" } };
    expect(codeOf(() => decideJoin(declined, { memberId: AVA, now: JOIN_AT, termsVersion: 1, timeZone: SYD })))
      .toBe("INVITE_EXPIRED");
  });

  it("starts on the picked date when it's later than the day after accept, the same date for everyone", () => {
    // New York's default Day 1 is Saturday the 17th, Sydney's Sunday the 18th; Monday the 19th wins for both.
    const picked = decideJoin(invited(EVERY_DAY, [WINNER_GETS], "2026-10-19"), { memberId: AVA, now: JOIN_AT, termsVersion: 1, timeZone: SYD });
    if (picked.kind !== "join") throw new Error("expected a join");
    expect(picked.players.map((player) => player.dayOne)).toEqual(["2026-10-19", "2026-10-19"]);
    // A date between the two defaults: New York waits for it, Sydney is already there.
    const between = decideJoin(invited(EVERY_DAY, [WINNER_GETS], "2026-10-18"), { memberId: AVA, now: JOIN_AT, termsVersion: 1, timeZone: SYD });
    if (between.kind !== "join") throw new Error("expected a join");
    expect(between.players.map((player) => player.dayOne)).toEqual(["2026-10-18", "2026-10-18"]);
    // Picked days pair by day index like any other game.
    const state = live(invited(EVERY_DAY, [WINNER_GETS], "2026-10-19"));
    expect(post(state, LEO, at(state, LEO, 0, 9)).entries[0].dayIndex).toBe(0);
    expect(codeOf(() => post(state, LEO, at(state, LEO, -1, 9)))).toBe("DAY_CLOSED");
  });

  it("lets the default win when the invite is accepted after the picked date", () => {
    // Accepted Sunday evening in New York (Monday morning in Sydney), two days after the picked Saturday.
    const decision = decideJoin(invited(EVERY_DAY, [WINNER_GETS], "2026-10-17"), {
      memberId: AVA,
      now: new Date("2026-10-19T00:00:00Z"),
      termsVersion: 1,
      timeZone: SYD,
    });
    if (decision.kind !== "join") throw new Error("expected a join");
    // Sydney accepts on Monday morning, so that is Day 1 for both.
    expect(decision.players.map((player) => player.dayOne)).toEqual(["2026-10-19", "2026-10-19"]);
  });

  it("freezes each player's time zone at go-live, from the state it's given", () => {
    const moved = invited();
    moved.players[0].timeZone = "Europe/London";
    const decision = decideJoin(moved, { memberId: AVA, now: JOIN_AT, termsVersion: 1, timeZone: SYD });
    if (decision.kind !== "join") throw new Error("expected a join");
    // Midnight UTC is 1am Saturday in London: still Friday's game day, so Day 1 is Saturday.
    expect(decision.players[0]).toEqual({ dayOne: "2026-10-17", memberId: LEO, timeZone: "Europe/London" });
  });

  it("calls an invite due at its expiry", () => {
    expect(isGameDue(invited(), new Date("2026-10-22T23:59:59Z"))).toBe(false);
    expect(isGameDue(invited(), new Date("2026-10-23T00:00:00Z"))).toBe(true);
  });
});

describe("weekly game: posting", () => {
  it.each(["photo", "heart_rate", "words", "route", "reps"] as const)("allows %s in new any-kind games and keeps legacy requirements", (kind) => {
    const state = live();
    const now = at(state, LEO, 0, 12);
    const input = { memberId: LEO, now, kind, hasData: true, captureAgeMs: null, mediaKeyPrefix: mediaKeyPrefixFor(LEO),
      mediaKeys: kind === "words" ? [] : [`${mediaKeyPrefixFor(LEO)}artifact.jpg`] };
    state.game.terms.versions[0].checkInKind = "any";
    expect(decidePost(state, input).attempt).toBe(1);
    state.game.terms.versions[0].checkInKind = "photo";
    expect(codeOf(() => decidePost(state, input))).toBe(kind === "photo" ? "OK" : "INVALID_REQUEST");
    state.game.terms.versions[0].checkInKind = "heart_rate";
    expect(codeOf(() => decidePost(state, input))).toBe(kind === "heart_rate" ? "OK" : "INVALID_REQUEST");
  });
  it("requires a summary for new heart-rate posts while retaining image-only legacy posts", () => {
    const state = live();
    const input = { memberId: LEO, now: at(state, LEO, 0, 12), kind: "heart_rate" as const,
      captureAgeMs: null, mediaKeyPrefix: mediaKeyPrefixFor(LEO), mediaKeys: [`${mediaKeyPrefixFor(LEO)}graph.jpg`] };
    state.game.terms.versions[0].checkInKind = "any";
    expect(codeOf(() => decidePost(state, input))).toBe("INVALID_REQUEST");
    expect(decidePost(state, { ...input, hasData: true }).attempt).toBe(1);
    state.game.terms.versions[0].checkInKind = "heart_rate";
    expect(decidePost(state, input).attempt).toBe(1);
  });
  it("allows one retake per day, counting withdrawn posts", () => {
    let state = live();
    const morning = at(state, LEO, 0, 9);
    state = post(state, LEO, morning);
    state = post(state, LEO, morning);
    expect(state.entries.map((entry) => [entry.attempt, entry.withdrawnAt !== null])).toEqual([[1, true], [2, false]]);
    expect(codeOf(() => post(state, LEO, morning))).toBe("RETAKE_USED");

    let withdrawn = post(live(), AVA, at(live(), AVA, 0, 9));
    withdrawn = withdraw(withdrawn, AVA, at(withdrawn, AVA, 0, 10));
    withdrawn = post(withdrawn, AVA, at(withdrawn, AVA, 0, 11));
    const noon = at(withdrawn, AVA, 0, 12);
    // Taking back the same post twice is a retry, not an error.
    expect(codeOf(() => withdraw(withdraw(withdrawn, AVA, noon), AVA, noon))).toBe("OK");
    expect(codeOf(() => post(withdraw(withdrawn, AVA, noon), AVA, at(withdrawn, AVA, 0, 13)))).toBe("RETAKE_USED");
  });

  it("withdraws only your own post for your current day", () => {
    let state = post(live(), LEO, at(live(), LEO, 0, 9));
    const leoPost = state.entries[0].id;
    expect(codeOf(() => withdraw(state, AVA, at(state, AVA, 0, 10), leoPost))).toBe("GAME_NOT_FOUND");
    expect(codeOf(() => withdraw(state, LEO, at(state, LEO, 0, 10), "entry_missing"))).toBe("GAME_NOT_FOUND");
    expect(codeOf(() => withdraw(state, LEO, at(state, LEO, 1, 10), leoPost))).toBe("DAY_CLOSED");
    state = withdraw(state, LEO, at(state, LEO, 0, 10), leoPost);
    expect(state.entries[0].withdrawnAt).not.toBeNull();
  });

  it("puts an excuse on the most recent missed scheduled day, never today", () => {
    // Mon/Wed/Fri accepted Friday: Day 1 is the first scheduled day, Monday the 19th, so indices 0, 2 and 4 count.
    let state = live(invited({ days: [0, 2, 4] }));
    expect(codeOf(() => post(state, LEO, at(state, LEO, 0, 9), { kind: "excuse" }))).toBe("DAY_CLOSED");
    state = post(state, LEO, at(state, LEO, 2, 9));
    // On Friday: Wednesday has a photo, so the excuse lands on Monday (index 0), skipping days off.
    state = post(state, LEO, at(state, LEO, 4, 9), { kind: "excuse" });
    expect(state.entries.at(-1)).toMatchObject({ attempt: 0, dayIndex: 0, kind: "excuse" });
    // It neither scores nor unlocks, and doesn't use up the day's photos.
    expect(scorePlayer(state, playerFor(state, LEO)!)).toMatchObject({ misses: 2, score: 1 });
    state = post(state, LEO, at(state, LEO, 4, 10));
    expect(state.entries.at(-1)).toMatchObject({ attempt: 1, dayIndex: 4 });
    // Nothing missed and unexcused remains.
    expect(codeOf(() => post(state, LEO, at(state, LEO, 4, 11), { kind: "excuse" }))).toBe("DAY_CLOSED");
  });

  it.each(["photo", "heart_rate"] as const)("needs owned media for %s check-ins", (kind) => {
    const state = live();
    const base = { captureAgeMs: null, hasText: false, memberId: LEO, now: at(state, LEO, 0, 9) };
    expect(codeOf(() => decidePost(state, { ...base, kind, mediaKeyPrefix: mediaKeyPrefixFor(LEO), mediaKeys: [] })))
      .toBe("MEDIA_MISSING");
    expect(codeOf(() => decidePost(state, {
      ...base,
      kind,
      mediaKeyPrefix: mediaKeyPrefixFor(LEO),
      mediaKeys: [`${mediaKeyPrefixFor(AVA)}x.jpg`],
    }))).toBe("MEDIA_MISSING");
    expect(codeOf(() => post(live(), "hbm_kat", at(state, LEO, 0, 9)))).toBe("NOT_A_PLAYER");
  });

  it("enforces the agreed graph requirement while retaining scoring and retakes", () => {
    let state = live();
    state.game.terms.versions[0].checkInKind = "heart_rate";
    state = post(state, LEO, at(state, LEO, 0, 9), { kind: "heart_rate" });
    expect(scorePlayer(state, playerFor(state, LEO)!)).toMatchObject({ score: 1 });
    expect(state.entries[0]).toMatchObject({ attempt: 1, kind: "heart_rate" });
    expect(codeOf(() => post(state, LEO, at(state, LEO, 0, 10), { kind: "photo" }))).toBe("INVALID_REQUEST");
    state = post(state, LEO, at(state, LEO, 0, 10), { kind: "heart_rate" });
    expect(scorePlayer(state, playerFor(state, LEO)!)).toMatchObject({ score: 1 });
    expect(codeOf(() => post(state, LEO, at(state, LEO, 0, 11), { kind: "heart_rate" }))).toBe("RETAKE_USED");
  });

  it("closes before Day 1 and after the last day, at each player's own 3am", () => {
    const state = live();
    expect(codeOf(() => post(state, LEO, at(state, LEO, -1, 12)))).toBe("DAY_CLOSED");
    // 2:59am local is still the previous game day.
    const lateNight = post(state, LEO, at(state, LEO, 1, 2, 59));
    expect(lateNight.entries[0].dayIndex).toBe(0);
    expect(post(state, AVA, at(state, AVA, 6, 23)).entries[0].dayIndex).toBe(6);
    expect(codeOf(() => post(state, AVA, at(state, AVA, 7, 9)))).toBe("DAY_CLOSED");
  });

  it("counts a post captured before 3am for the day that ended, within the hour (honor rule)", () => {
    const state = live();
    const boundary = at(state, LEO, 2, 3);
    const thirtyAfter = new Date(boundary.getTime() + 30 * 60 * 1000);
    // Captured 1 minute before the boundary, sent 30 minutes after it.
    expect(post(state, LEO, thirtyAfter, { captureAgeMs: 31 * 60 * 1000 }).entries[0].dayIndex).toBe(1);
    expect(decidePost(state, {
      captureAgeMs: 31 * 60 * 1000,
      kind: "photo",
      mediaKeyPrefix: mediaKeyPrefixFor(LEO),
      mediaKeys: [`${mediaKeyPrefixFor(LEO)}late.jpg`],
      memberId: LEO,
      now: thirtyAfter,
    })).toMatchObject({ dayIndex: 1, graceUsed: true });
    // Thirty seconds of clock slack is allowed; more is not.
    expect(post(state, LEO, thirtyAfter, { captureAgeMs: (30 * 60 - 25) * 1000 }).entries[0].dayIndex).toBe(1);
    expect(post(state, LEO, thirtyAfter, { captureAgeMs: (30 * 60 - 35) * 1000 }).entries[0].dayIndex).toBe(2);
    // No capture age: today.
    expect(post(state, LEO, thirtyAfter).entries[0].dayIndex).toBe(2);
    // Yesterday's shot past the hour, or once yesterday already has a live post, counts for no day.
    const late = new Date(boundary.getTime() + 61 * 60 * 1000);
    expect(codeOf(() => post(state, LEO, late, { captureAgeMs: 62 * 60 * 1000 }))).toBe("DAY_CLOSED");
    const already = post(state, LEO, at(state, LEO, 1, 9));
    expect(codeOf(() => post(already, LEO, thirtyAfter, { captureAgeMs: 31 * 60 * 1000 }))).toBe("DAY_CLOSED");
    // After the last day: grace still lands on day 6, otherwise closed.
    const end = at(state, LEO, 7, 3);
    const afterEnd = new Date(end.getTime() + 30 * 60 * 1000);
    expect(post(state, LEO, afterEnd, { captureAgeMs: 31 * 60 * 1000 }).entries[0].dayIndex).toBe(6);
    expect(codeOf(() => post(state, LEO, afterEnd, { captureAgeMs: 10 * 60 * 1000 }))).toBe("DAY_CLOSED");
  });

  it("never counts a shot the phone kept from an earlier day", () => {
    const state = live();
    // Captured Day 0 at 9am (Monday, say), sent two days later: refused, not counted for Day 2.
    const sentLater = at(state, LEO, 2, 9);
    expect(codeOf(() => post(state, LEO, sentLater, { captureAgeMs: 2 * 24 * 60 * 60 * 1000 }))).toBe("DAY_CLOSED");
    // Captured today and sent a few seconds later: today.
    expect(post(state, LEO, sentLater, { captureAgeMs: 5000 }).entries[0].dayIndex).toBe(2);
    // Captured just after today's 3am, inside the 30 seconds of slack before it: still today.
    const justAfter = new Date(at(state, LEO, 2, 3).getTime() + 2 * 60 * 60 * 1000);
    expect(post(state, LEO, justAfter, { captureAgeMs: 2 * 60 * 60 * 1000 + 20 * 1000 }).entries[0].dayIndex).toBe(2);
  });

  it("gives grace only to a scheduled day that ended without a post", () => {
    // Mon/Wed/Fri. Leo's Day 0 is Saturday and Day 1 Sunday (off); Day 2 is Monday.
    const state = live(invited({ days: [0, 2, 4] }));
    const mondayBoundary = at(state, LEO, 2, 3);
    const afterSunday = new Date(mondayBoundary.getTime() + 10 * 60 * 1000);
    // Sunday was a day off, so a shot from before 3am gets no grace, and isn't Monday's either.
    expect(codeOf(() => post(state, LEO, afterSunday, { captureAgeMs: 15 * 60 * 1000 }))).toBe("DAY_CLOSED");
    expect(post(state, LEO, afterSunday, { captureAgeMs: 5 * 60 * 1000 }).entries[0].dayIndex).toBe(2);
    const tuesdayBoundary = at(state, LEO, 3, 3);
    const afterMonday = new Date(tuesdayBoundary.getTime() + 10 * 60 * 1000);
    expect(post(state, LEO, afterMonday, { captureAgeMs: 15 * 60 * 1000 }).entries[0].dayIndex).toBe(2);
  });

  it("works across the date line (Auckland vs Honolulu)", () => {
    const aucklandInvite = invited();
    aucklandInvite.players[0].timeZone = "Pacific/Auckland";
    // Saturday 9am in Auckland is Friday 10am in Honolulu.
    const state = live(aucklandInvite, "Pacific/Honolulu", new Date("2026-10-16T20:00:00Z"));
    // Auckland is already on Saturday the 17th, the shared Day 1.
    expect(state.players.map((player) => player.dayOne)).toEqual(["2026-10-17", "2026-10-17"]);
    // Late on each player's own Day 0 still counts for Day 0.
    expect(post(state, LEO, at(state, LEO, 0, 23)).entries[0].dayIndex).toBe(0);
    expect(post(state, AVA, at(state, AVA, 0, 23)).entries[0].dayIndex).toBe(0);
  });
});

describe("weekly game: schedules and scoring", () => {
  it("scores only scheduled days in a set-days game", () => {
    // Mon/Wed/Fri. Leo's Day 0 is Saturday 2026-10-17.
    let state = live(invited({ days: [0, 2, 4] }));
    for (const day of [0, 2, 4, 6]) state = post(state, LEO, at(state, LEO, day, 9)); // Sat, Mon, Wed, Fri
    const leo = scorePlayer(state, playerFor(state, LEO)!);
    expect(leo).toMatchObject({ misses: 0, score: 3 });
    // Ava plays the same indices (Leo's Mon and Wed) from Sydney and misses Friday.
    state = post(state, AVA, at(state, AVA, 2, 9));
    state = post(state, AVA, at(state, AVA, 4, 9));
    expect(scorePlayer(state, playerFor(state, AVA)!)).toMatchObject({ misses: 1, score: 2 });
  });

  it("plays weekdays on the same dates for both players across time zones", () => {
    // Thursday 8pm in New York is Friday 11am in Sydney: the picked Saturday the 17th
    // moves to the first scheduled day, Monday the 19th, for both.
    let state = live(invited({ days: [0, 1, 2, 3, 4] }, [WINNER_GETS], "2026-10-17"), SYD, new Date("2026-10-16T00:00:00Z"));
    expect(state.players.map((player) => player.dayOne)).toEqual(["2026-10-19", "2026-10-19"]);
    // Monday to Friday, then the weekend, for both of them.
    expect(Array.from({ length: 7 }, (_, day) => isScheduledDay(state, day))).toEqual([true, true, true, true, true, false, false]);
    for (const day of [0, 3]) {
      state = post(state, LEO, at(state, LEO, day, 9));
      state = post(state, AVA, at(state, AVA, day, 9));
    }
    expect(scorePlayer(state, playerFor(state, LEO)!)).toMatchObject({ misses: 3, score: 2 });
    expect(scorePlayer(state, playerFor(state, AVA)!)).toMatchObject({ misses: 3, score: 2 });
  });

  it("keeps a weekdays game on weekdays for an invitee behind the challenger", () => {
    // Sydney challenges New York; accepted Friday 8:15pm in New York (Saturday in Sydney).
    const sydneyInvite = invited({ days: [0, 1, 2, 3, 4] });
    sydneyInvite.players[0].timeZone = SYD;
    sydneyInvite.game.startsOn = "2026-10-18";
    const state = live(sydneyInvite, NYC, new Date("2026-10-17T00:15:00Z"));
    // The picked Sunday the 18th is off, so Day 1 is Monday the 19th for both: Monday to Friday, then the weekend.
    expect(state.players.map((player) => player.dayOne)).toEqual(["2026-10-19", "2026-10-19"]);
    expect(Array.from({ length: 7 }, (_, day) => isScheduledDay(state, day))).toEqual([true, true, true, true, true, false, false]);
    expect(weekdayOf(state.players[1].dayOne!)).toBe(0);
  });

  it("owes nothing for a perfect game, matching its perfect outcome", () => {
    // Eight days of Mon/Wed/Fri: both post every scheduled day, and Leo also posts on days off.
    const eightDays = invited({ days: [0, 2, 4] }, [WINNER_GETS, PER_MISS]);
    eightDays.game.lengthDays = 8;
    let state = live(eightDays);
    for (let day = 0; day < 8; day += 1) {
      state = post(state, LEO, at(state, LEO, day, 9));
      if (isScheduledDay(state, day)) state = post(state, AVA, at(state, AVA, day, 9));
    }
    const settled = decideSettle(state);
    expect(settled.result.scores.map((score) => score.misses)).toEqual([0, 0]);
    expect(settled.tickets).toEqual([]);
    expect(outcomeFor(settled.result, LEO)).toBe("perfect");
    expect(outcomeFor(settled.result, AVA)).toBe("perfect");
  });

  it("caps count-mode scores and counts misses as the shortfall", () => {
    let state = live(invited({ count: 3 }, [PER_MISS]));
    for (const day of [0, 1, 2, 3]) state = post(state, LEO, at(state, LEO, day, 9));
    state = post(state, AVA, at(state, AVA, 0, 9));
    expect(scorePlayer(state, playerFor(state, LEO)!)).toMatchObject({ misses: 0, score: 3 });
    expect(scorePlayer(state, playerFor(state, AVA)!)).toMatchObject({ misses: 2, score: 1 });
    const settled = decideSettle(state);
    expect(settled.tickets).toEqual([
      { owedBy: AVA, owedTo: LEO, stakeKey: PER_MISS.key },
      { owedBy: AVA, owedTo: LEO, stakeKey: PER_MISS.key },
    ]);
  });

  it("settles winner_gets to the winner, nothing on a tie, and calls a clean sweep perfect", () => {
    let state = live(invited(EVERY_DAY, [WINNER_GETS, PER_MISS]));
    for (let day = 0; day < 7; day += 1) state = post(state, LEO, at(state, LEO, day, 9));
    for (let day = 0; day < 5; day += 1) state = post(state, AVA, at(state, AVA, day, 9));
    const win = decideSettle(state);
    expect(win.result.scores.map((score) => [score.seat, score.score, score.misses])).toEqual([[0, 7, 0], [1, 5, 2]]);
    expect(win.tickets.filter((ticket) => ticket.stakeKey === WINNER_GETS.key)).toEqual([
      { owedBy: AVA, owedTo: LEO, stakeKey: WINNER_GETS.key },
    ]);
    expect(win.tickets.filter((ticket) => ticket.stakeKey === PER_MISS.key)).toHaveLength(2);
    expect(outcomeFor(win.result, LEO)).toBe("won");
    expect(outcomeFor(win.result, AVA)).toBe("lost");

    for (let day = 5; day < 7; day += 1) state = post(state, AVA, at(state, AVA, day, 9));
    const perfect = decideSettle(state);
    expect(perfect.tickets).toEqual([]);
    expect(outcomeFor(perfect.result, AVA)).toBe("perfect");

    const tie = live();
    const tied = decideSettle(post(post(tie, LEO, at(tie, LEO, 0, 9)), AVA, at(tie, AVA, 0, 9)));
    expect(tied.tickets).toEqual([]);
    expect(outcomeFor(tied.result, LEO)).toBe("tie");
  });
});

describe("weekly game: dev time travel and start now", () => {
  it("starts today (over any picked date) only before anyone has", () => {
    const state = live(invited(EVERY_DAY, [WINNER_GETS], "2026-10-25"));
    const started = decideStartNow(state, JOIN_AT);
    expect(started.players.map((player) => player.dayOne)).toEqual(["2026-10-16", "2026-10-16"]);
    const begun = { ...state, players: state.players.map((player) => ({ ...player, dayOne: dayOneOf(started, player.memberId) })) };
    expect(codeOf(() => decideStartNow(begun, JOIN_AT))).toBe("INVALID_REQUEST");
  });

  it("starts now on the latest local today across the date line, so nobody's Day 1 is already over", () => {
    // Friday 8pm in New York is Saturday in Sydney: both start Saturday, New York's tomorrow.
    const state = live(invited(EVERY_DAY, [WINNER_GETS], "2026-10-25"));
    const started = decideStartNow(state, LATE_JOIN_AT);
    expect(started.players.map((player) => player.dayOne)).toEqual(["2026-10-17", "2026-10-17"]);
  });

  it("advances a live game's clock by whole days, 1 to 365, without touching its history", () => {
    const state = live(invited({ days: [0, 1, 2, 3, 4] }, [WINNER_GETS], "2026-10-17"), SYD, new Date("2026-10-16T00:00:00Z"));
    expect(decideDevAdvance(state, 1)).toEqual({ addMs: 24 * 60 * 60 * 1000 });
    expect(codeOf(() => decideDevAdvance(state, 365))).toBe("OK");
    expect(codeOf(() => decideDevAdvance(state, 0))).toBe("INVALID_REQUEST");
    expect(codeOf(() => decideDevAdvance(state, 366))).toBe("INVALID_REQUEST");
    expect(codeOf(() => decideDevAdvance(invited(), 1))).toBe("GAME_NOT_LIVE");
    // A Friday post stays on Friday's index; one day later "today" is Saturday, a day off.
    const friday = post(state, LEO, at(state, LEO, 4, 9));
    const saturday = new Date(at(state, LEO, 4, 9).getTime() + decideDevAdvance(state, 1).addMs);
    expect(friday.entries[0].dayIndex).toBe(4);
    expect(dayIndexAt(playerFor(friday, LEO)!, saturday)).toBe(5);
    expect(isScheduledDay(friday, 5)).toBe(false);
  });
});

describe("weekly game: access", () => {
  it("ships dark: on outside production, off in production unless enabled, allowlist narrows", () => {
    expect(isGameEnabledFor(LEO, { NODE_ENV: "development" })).toBe(true);
    expect(isGameEnabledFor(LEO, { NODE_ENV: "production" })).toBe(false);
    expect(isGameEnabledFor(LEO, { MURPH_GAME_ENABLED: "true", NODE_ENV: "production" })).toBe(true);
    expect(isGameEnabledFor(LEO, { MURPH_GAME_ENABLED: "false", NODE_ENV: "development" })).toBe(false);
    const allowlisted = { MURPH_GAME_ENABLED: "true", MURPH_GAME_MEMBER_ALLOWLIST: `${AVA}, hbm_other`, NODE_ENV: "production" };
    expect(isGameEnabledFor(AVA, allowlisted)).toBe(true);
    expect(isGameEnabledFor(LEO, allowlisted)).toBe(false);
    expect(isGameEnabled(allowlisted)).toBe(true);
    expect(isGameEnabled({ MURPH_GAME_ENABLED: "false", NODE_ENV: "development" })).toBe(false);
  });

  describe("invite-only: a game is on when one of its people is listed", () => {
    const SAM = "hbm_sam";
    const listedAva = { MURPH_GAME_ENABLED: "true", MURPH_GAME_MEMBER_ALLOWLIST: AVA, NODE_ENV: "production" };
    const seats = (...memberIds: string[]) => memberIds.map((memberId) => ({ memberId }));

    it("turns on a listed creator's game, invite and all, for the unlisted invitee", () => {
      expect(isGameOn({ players: seats(AVA) }, listedAva)).toBe(true);
      expect(isGameOn({ players: seats(AVA, LEO) }, listedAva)).toBe(true);
      expect(isGameOn({ players: seats(LEO, AVA) }, listedAva)).toBe(true);
    });

    it("keeps a game between two unlisted members off", () => {
      expect(isGameOn({ players: seats(LEO, SAM) }, listedAva)).toBe(false);
      expect(isGameOn({ players: seats(LEO), inviteeMemberId: SAM }, listedAva)).toBe(false);
      expect(isGameOn({ players: [] }, listedAva)).toBe(false);
    });

    it("refuses an unlisted member's fresh game, which has no one else in it", () => {
      expect(isGameOn({ players: seats(LEO), inviteeMemberId: null }, listedAva)).toBe(false);
      expect(isGameOn({ players: seats(LEO) }, listedAva)).toBe(false);
    });

    it("lets an unlisted member rematch the listed player, who is that invite's addressee", () => {
      expect(isGameOn({ players: seats(LEO), inviteeMemberId: AVA }, listedAva)).toBe(true);
    });

    it("is off for everyone when the global switch is off, and on for every game with an empty list", () => {
      const off = { MURPH_GAME_ENABLED: "false", MURPH_GAME_MEMBER_ALLOWLIST: AVA, NODE_ENV: "production" };
      expect(isGameOn({ players: seats(AVA, LEO) }, off)).toBe(false);
      expect(isGameOn({ players: seats(AVA), inviteeMemberId: AVA }, off)).toBe(false);
      expect(gameOnWhere(off)).toEqual({ id: { in: [] } });
      expect(gameOnSql("game", off).sql).toBe("FALSE");
      const everyone = { MURPH_GAME_ENABLED: "true", NODE_ENV: "production" };
      expect(isGameOn({ players: seats(LEO, SAM) }, everyone)).toBe(true);
      expect(gameOnWhere(everyone)).toEqual({});
      expect(gameOnSql("game", everyone).sql).toBe("TRUE");
    });

    it("states the same rule for database reads: a listed player or a listed addressee", () => {
      expect(gameOnWhere(listedAva)).toEqual({ OR: [
        { players: { some: { memberId: { in: [AVA] } } } },
        { inviteeMemberId: { in: [AVA] } },
      ] });
      const sql = gameOnSql("game", listedAva);
      expect(sql.sql.replace(/\s+/gu, " ")).toBe("(game.invitee_member_id IN (?) OR EXISTS (SELECT 1 FROM game_player listed WHERE listed.game_id = game.id AND listed.member_id IN (?)))");
      expect(sql.values).toEqual([AVA, AVA]);
    });
  });

  it("allows time travel everywhere except real production", () => {
    expect(areGameDevToolsAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(areGameDevToolsAllowed({ NODE_ENV: "production", VERCEL_ENV: "preview" })).toBe(true);
    expect(areGameDevToolsAllowed({ NODE_ENV: "production", VERCEL_ENV: "production" })).toBe(false);
    expect(areGameDevToolsAllowed({ NODE_ENV: "production" })).toBe(false);
  });

  it("scopes media keys to their uploader", () => {
    expect(mediaKeyPrefixFor(LEO)).toBe("game/hbm_leo/");
    expect(mediaKeyOwner("game/hbm_leo/a.jpg")).toBe(LEO);
    expect(mediaKeyOwner("meal/hbm_leo/a.jpg")).toBeNull();
  });
});


describe("v1 rule boundaries", () => {
  it.each([
    ["2026-10-16T06:59:59Z", "2026-10-16"], // 02:59, next game date
    ["2026-10-16T07:00:00Z", "2026-10-16"], // 03:00
    ["2026-10-16T23:59:59Z", "2026-10-16"], // 19:59
    ["2026-10-17T00:00:00Z", "2026-10-17"], // 20:00
    ["2026-10-17T04:30:00Z", "2026-10-17"], // 00:30, next game date
  ])("uses the accepting actor's cutoff at %s", (instant, expected) => {
    const now = new Date(instant);
    const join = decideJoin(invited(), {memberId:AVA,now,termsVersion:1,timeZone:NYC});
    expect(join).toMatchObject({players:[{dayOne:expected},{dayOne:expected}]});
    const negotiating = live(invited(), NYC);
    negotiating.game.status = "negotiating";
    negotiating.players.forEach((player) => {player.dayOne = null;});
    expect(decideNegotiationStart(negotiating, LEO, now, null).players.map((player) => player.dayOne)).toEqual([expected,expected]);
  });
  it("uses the approver rather than proposer when their cutoff differs", () => {
    const state = live(); state.game.status = "negotiating";
    state.players.forEach((player) => { player.dayOne = null; });
    // Sydney is 23:00 and New York is 08:00 on the same game date.
    expect(decideNegotiationStart(state, LEO, JOIN_AT, null).players[0].dayOne).toBe("2026-10-16");
    expect(decideNegotiationStart(state, AVA, JOIN_AT, null).players[0].dayOne).toBe("2026-10-17");
  });
  it.each([3, 7, 75, 365])("accepts %s days and refuses out-of-range new lengths and stakes", (lengthDays) => {
    const terms = {lengthDays,schedule:EVERY_DAY,stakes:[STAKE_INPUT],tasks:[{seat:0,text:"Read"},{seat:1,text:"Walk"}]};
    const options = {newKey:()=>"stake_new",today:"2026-10-16"};
    expect(decideNewTerms(terms,options).lengthDays).toBe(lengthDays);
    for (const invalid of [1,2,366,3.5]) expect(() => decideNewTerms({...terms,lengthDays:invalid},options)).toThrow();
    for (const kind of ["winner_gets", "per_miss"] as const) expect(() => decideNewTerms({...terms,stakes:[{...STAKE_INPUT,kind}]},options)).toThrow("one prize or dare");
  });
  it.each(["prize", "dare"] as const)("settles %s once from loser to winner and creates nothing on ties or perfect games", (kind) => {
    let state = live(invited(EVERY_DAY,[{key:"stake_v1",kind}]));
    expect(decideSettle(state).tickets).toEqual([]);
    state = post(state, LEO, at(state,LEO,0,9));
    expect(decideSettle(state).tickets).toEqual([{owedBy:AVA,owedTo:LEO,stakeKey:"stake_v1"}]);
    state = post(state, AVA, at(state,AVA,0,9));
    expect(decideSettle(state).tickets).toEqual([]);
    state.game.terms.versions[0].schedule = {count:1};
    expect(decideSettle(state).tickets).toEqual([]);
  });
});

describe("invite cancellation", () => {
  it("permits only seated players before kickoff and treats void as a no-op", () => {
    const state = invited();
    expect(decideCancelInvite(state, LEO)).toBe("cancel");
    expect(() => decideCancelInvite(state, AVA)).toThrowError(expect.objectContaining({ error: expect.objectContaining({ code: "NOT_A_PLAYER" }) }));
    const seated = live();
    seated.game.status = "negotiating";
    expect(decideCancelInvite(seated, AVA)).toBe("cancel");
    for (const status of ["live", "settled"] as const) {
      seated.game.status = status;
      expect(() => decideCancelInvite(seated, LEO)).toThrowError(expect.objectContaining({ error: expect.objectContaining({ code: "INVITE_USED" }) }));
    }
    seated.game.status = "void";
    expect(decideCancelInvite(seated, AVA)).toBe("already-void");
    expect(() => decideCancelInvite(seated, "outsider")).toThrowError(expect.objectContaining({ error: expect.objectContaining({ code: "NOT_A_PLAYER" }) }));
  });
});


describe("self-reported incomplete days", () => {
  it.each([{ days: [0, 1, 2, 3, 4, 5, 6] } as GameSchedule, { count: 3 } as GameSchedule])("excludes marked days from score, streak and settlement", (schedule) => {
    let state = live(invited(schedule), NYC);
    for (const day of [0, 1, 2]) {
      state = post(state, LEO, at(state, LEO, day, 12));
      state = post(state, AVA, at(state, AVA, day, 12));
    }
    const player = playerFor(state, LEO)!;
    expect(playerStreak(state, player, at(state, LEO, 3, 12))).toBe(3);
    const marked = state.entries.find((entry) => entry.memberId === LEO && entry.dayIndex === 1)!;
    marked.incomplete = true;
    expect(scorePlayer(state, player).score).toBe(2);
    const progress = gameChatProgress(state, at(state, LEO, 3, 12)).players.find((p) => p.memberId === LEO)!;
    expect(progress.score).toBe(2);
    expect(progress.days.find((day) => day.dayIndex === 1)?.status).toBe("count" in schedule ? "not_posted" : "missed");
    expect(playerStreak(state, player, at(state, LEO, 3, 12))).toBe(1);
    expect(decideSettle(state).tickets).toEqual([{ owedBy: LEO, owedTo: AVA, stakeKey: WINNER_GETS.key }]);
    marked.incomplete = false;
    expect(scorePlayer(state, player).score).toBe(3);
    expect(playerStreak(state, player, at(state, LEO, 3, 12))).toBe(3);
    expect(decideSettle(state).tickets).toEqual([]);
  });

  it("uses the actor's 3 AM boundary and refuses dates beyond it", () => {
    const state = live(invited(), NYC);
    const player = playerFor(state, LEO)!;
    const input = { memberId: LEO, date: addDays(player.dayOne!, 1), incomplete: true, now: at(state, LEO, 1, 2) };
    expect(() => decideDayCompletion(state, input)).toThrow("already started");
    expect(decideDayCompletion(state, { ...input, now: at(state, LEO, 1, 3) }).outcome.status).toBe("no_artifact");
  });
});

describe("weekly game: self-play round 1 regressions", () => {
  // Monday 2026-10-12 through Sunday 2026-10-18, accepted at 10am in the accepter's zone.
  const WEEK = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"];
  const PAIRS: [string, string][] = [[NYC, NYC], ["Pacific/Auckland", "Pacific/Honolulu"], ["Pacific/Honolulu", "Pacific/Auckland"]];
  function acceptedAt(date: string, timeZone: string): Date {
    return new Date(dayStartInstant(date, timeZone).getTime() + 7 * 60 * 60 * 1000);
  }
  function game(schedule: GameSchedule, lengthDays: number, challengerZone: string, startsOn: string | null = null): RuleState {
    const state = invited(schedule, [WINNER_GETS], startsOn);
    state.game.lengthDays = lengthDays;
    state.players[0].timeZone = challengerZone;
    return state;
  }

  it("starts Day 1 on the first scheduled day on or after acceptance, for every weekday, schedule and side of the date line", () => {
    for (const [challengerZone, accepterZone] of PAIRS) {
      for (const date of WEEK) {
        for (const weekday of [0, 1, 2, 3, 4, 5, 6] as const) {
          const now = acceptedAt(date, accepterZone);
          const label = `${challengerZone} vs ${accepterZone}, accepted ${date}, schedule [${weekday}]`;
          const unsnapped = live(game(EVERY_DAY, 3, challengerZone), accepterZone, now).players[0].dayOne!;
          const state = live(game({ days: [weekday] }, 3, challengerZone), accepterZone, now);
          const [first, second] = state.players;
          expect(first.dayOne, label).toBe(second.dayOne);
          expect(weekdayOf(first.dayOne!), label).toBe(weekday);
          const wait = Date.parse(`${first.dayOne}T00:00:00Z`) - Date.parse(`${unsnapped}T00:00:00Z`);
          expect(wait, label).toBeGreaterThanOrEqual(0);
          expect(wait, label).toBeLessThan(7 * 86_400_000);
          // Length still counts calendar days from that Day 1, and Day 1 itself is playable.
          expect(isScheduledDay(state, 0), label).toBe(true);
          expect(Array.from({ length: 3 }, (_, day) => isScheduledDay(state, day)).filter(Boolean), label).toHaveLength(1);
          // Both seats get a post on Day 1 in their own zone.
          for (const memberId of [LEO, AVA]) {
            expect(post(state, memberId, at(state, memberId, 0, 9)).entries[0].dayIndex, `${label} ${memberId}`).toBe(0);
          }
        }
      }
    }
  });

  it("never leaves the self-play repro without a scheduled day: a Wednesdays-only 3-day game accepted Saturday", () => {
    const state = live(game({ days: [2] }, 3, NYC), NYC, acceptedAt("2026-10-17", NYC));
    expect(state.players.map((player) => player.dayOne)).toEqual(["2026-10-21", "2026-10-21"]);
    expect([0, 1, 2].map((day) => isScheduledDay(state, day))).toEqual([true, false, false]);
    // Mon/Tue/Wed for 3 days, accepted Thursday: Day 1 is the next Monday, not Thu-Sat.
    const weekdays = live(game({ days: [0, 1, 2] }, 3, NYC), NYC, acceptedAt("2026-10-15", NYC));
    expect(weekdays.players[0].dayOne).toBe("2026-10-19");
    expect([0, 1, 2].map((day) => isScheduledDay(weekdays, day))).toEqual([true, true, true]);
  });

  it("moves a picked, negotiated or start-now Day 1 onto the schedule too", () => {
    // A picked Saturday for a Mon/Wed game becomes Monday.
    const picked = live(game({ days: [0, 2] }, 3, NYC, "2026-10-17"), NYC, acceptedAt("2026-10-14", NYC));
    expect(picked.players[0].dayOne).toBe("2026-10-19");
    // Negotiated agreement starting on a Saturday does the same, whoever approves.
    const negotiating: RuleState = { ...picked, game: { ...picked.game, status: "negotiating" }, players: picked.players.map((player) => ({ ...player, dayOne: null })) };
    for (const actor of [LEO, AVA]) {
      expect(decideNegotiationStart(negotiating, actor, acceptedAt("2026-10-16", NYC), "2026-10-17").players.map((player) => player.dayOne)).toEqual(["2026-10-19", "2026-10-19"]);
      expect(decideNegotiationStart(negotiating, actor, acceptedAt("2026-10-17", NYC), null).players[0].dayOne).toBe("2026-10-19");
    }
    // Start now on a Saturday starts on the next scheduled day.
    const later = live(game({ days: [0, 2] }, 3, NYC, "2026-10-28"), NYC, acceptedAt("2026-10-17", NYC));
    expect(decideStartNow(later, acceptedAt("2026-10-17", NYC)).players[0].dayOne).toBe("2026-10-19");
  });

  it("rejects an empty schedule at create", () => {
    const base = { schedule: EVERY_DAY, stakes: [STAKE_INPUT], tasks: [{ seat: 0, text: "Run" }, { seat: 1, text: "Swim" }] };
    const options = { newKey: () => "gsk_x", today: "2026-10-16" };
    expect(codeOf(() => decideNewTerms({ ...base, schedule: { days: [] } }, options))).toBe("INVALID_REQUEST");
    expect(codeOf(() => decideNewTerms({ ...base, schedule: { count: 0 } }, options))).toBe("INVALID_REQUEST");
    expect(codeOf(() => decideNewTerms({ ...base, lengthDays: 3, schedule: { days: [4] } }, options))).toBe("OK");
  });

  it("lets only a rematch's addressee take its seat", () => {
    const rematch = invited();
    rematch.game.inviteeMemberId = AVA;
    expect(codeOf(() => decideJoin(rematch, { memberId: "hbm_liam", now: JOIN_AT, termsVersion: 1, timeZone: NYC }))).toBe("NOT_A_PLAYER");
    expect(decideJoin(rematch, { memberId: AVA, now: JOIN_AT, termsVersion: 1, timeZone: SYD })).toMatchObject({ kind: "join", seat: 1 });
    // The challenger re-opening their own rematch is a no-op, not a refusal.
    expect(decideJoin(rematch, { memberId: LEO, now: JOIN_AT, termsVersion: 1, timeZone: NYC })).toEqual({ kind: "already-joined" });
  });

  it("settles on the deadline once neither last day can take a late post, an hour later only while one can", () => {
    for (const [leoZone, avaZone] of PAIRS) {
      const state = live(game(EVERY_DAY, 3, leoZone), avaZone, acceptedAt("2026-10-14", avaZone));
      const ends = state.players.map((player) => dayStartInstant(addDays(player.dayOne!, 3), player.timeZone).getTime());
      const deadline = Math.max(...ends);
      const lastToEnd = state.players[ends.indexOf(deadline)].memberId;
      // Nobody posted the last day: grace keeps it open an hour.
      expect(isGameDue(state, new Date(deadline + 59 * 60 * 1000))).toBe(false);
      expect(isGameDue(state, new Date(deadline + 60 * 60 * 1000))).toBe(true);
      // Both posted their last day: due at the deadline itself.
      let posted = state;
      for (const memberId of [LEO, AVA]) posted = post(posted, memberId, at(posted, memberId, 2, 9));
      expect(isGameDue(posted, new Date(deadline - 1))).toBe(false);
      expect(isGameDue(posted, new Date(deadline))).toBe(true);
      // Only the player who finishes first left their last day open: their grace hour may already be over.
      const firstToEnd = lastToEnd === LEO ? AVA : LEO;
      const onlyLast = post(state, lastToEnd, at(state, lastToEnd, 2, 9));
      const firstGrace = Math.min(...ends) + 60 * 60 * 1000;
      expect(isGameDue(onlyLast, new Date(Math.max(deadline, firstGrace)))).toBe(true);
      expect(isGameDue(onlyLast, new Date(Math.max(deadline, firstGrace) - 1))).toBe(false);
      expect(firstToEnd).not.toBe(lastToEnd);
    }
  });
});
