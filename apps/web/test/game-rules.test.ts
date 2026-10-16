import { describe, expect, it } from "vitest";

import type { GameEntryKind, GameSchedule } from "@/src/lib/game/contract";
import { areGameDevToolsAllowed, isGameEnabled, isGameEnabledFor, mediaKeyOwner, mediaKeyPrefixFor } from "@/src/lib/game/access";
import {
  decideDevAdvance,
  decideJoin,
  decideNewTerms,
  decidePost,
  decideSettle,
  decideStartNow,
  decideVoid,
  decideWithdraw,
  GameRuleError,
  outcomeFor,
  parseStoredTerms,
  playerFor,
  scorePlayer,
  type RuleState,
  type Schedule,
  type StoredStake,
} from "@/src/lib/game/rules";
import { addDays, dayStartInstant } from "@/src/lib/game/time";

const LEO = "hbm_leo";
const AVA = "hbm_ava";
const NYC = "America/New_York";
const SYD = "Australia/Sydney";
// Friday 2026-10-16, 8pm in New York; Saturday 11am in Sydney.
const JOIN_AT = new Date("2026-10-17T00:00:00Z");
const EVERY_DAY: GameSchedule = { days: [0, 1, 2, 3, 4, 5, 6] };
const WINNER_GETS: StoredStake = { key: "gsk_breakfast", kind: "winner_gets" };
const PER_MISS: StoredStake = { key: "gsk_massage", kind: "per_miss" };

function invited(schedule: GameSchedule = EVERY_DAY, stakes: StoredStake[] = [WINNER_GETS]): RuleState {
  return {
    entries: [],
    game: {
      createdBy: LEO,
      id: "game_rules_1",
      inviteExpiresAt: new Date("2026-10-23T00:00:00Z"),
      lengthDays: 7,
      nextDueAt: null,
      seats: 2,
      status: "invited",
      terms: { v: 1, versions: [{ fromDay: 0, n: 1, schedule, stakes }] },
    },
    players: [{ active: false, agreedTermsVersion: 1, dayOne: null, memberId: LEO, seat: 0, timeZone: NYC }],
  };
}

function live(state: RuleState = invited(), avaTimeZone = SYD, joinAt = JOIN_AT): RuleState {
  const decision = decideJoin(state, { memberId: AVA, now: joinAt, termsVersion: 1, timeZone: avaTimeZone });
  if (decision.kind !== "join") throw new Error("expected a join");
  const players = [
    ...state.players,
    { active: false, agreedTermsVersion: 1, dayOne: null, memberId: AVA, seat: decision.seat, timeZone: avaTimeZone },
  ];
  return {
    ...state,
    game: { ...state.game, nextDueAt: decision.nextDueAt, status: "live" },
    players: players.map((player) => ({ ...player, active: true, dayOne: dayOneOf(decision, player.memberId) })),
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
    hasText: false,
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
        withdrawnAt: null,
      },
    ],
  };
}

function withdraw(state: RuleState, memberId: string, now: Date, entryId = state.entries.at(-1)!.id): RuleState {
  const { withdrawEntryId } = decideWithdraw(state, { entryId, memberId, now });
  return {
    ...state,
    entries: state.entries.map((entry) => (entry.id === withdrawEntryId ? { ...entry, withdrawnAt: now } : entry)),
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
  it("validates the challenge and keeps stake keys only on a rematch", () => {
    let next = 0;
    const newKey = () => `gsk_new_${(next += 1)}`;
    const made = decideNewTerms(
      {
        schedule: { days: [4, 0, 2] },
        stakes: [
          { item: "Breakfast in bed", key: "gsk_breakfast", kind: "winner_gets" },
          { item: "A massage", key: "gsk_forged", kind: "per_miss" },
        ],
        tasks: [{ seat: 1, text: "10 min abs" }, { seat: 0, text: "100 pushups" }],
      },
      { newKey, previousStakeKeys: new Set(["gsk_breakfast"]) },
    );
    expect(made.lengthDays).toBe(7);
    expect(made.terms.versions[0]).toEqual({
      fromDay: 0,
      n: 1,
      schedule: { days: [0, 2, 4] },
      stakes: [{ key: "gsk_breakfast", kind: "winner_gets" }, { key: "gsk_new_1", kind: "per_miss" }],
    });
    expect(made.words.versions[0].tasks).toEqual([{ seat: 0, text: "100 pushups" }, { seat: 1, text: "10 min abs" }]);
    // Words stay out of the plain terms.
    expect(JSON.stringify(made.terms)).not.toContain("Breakfast");
    expect(parseStoredTerms(JSON.parse(JSON.stringify(made.terms)))).toEqual(made.terms);
  });

  it("rejects bad schedules, counts and task lists", () => {
    const base = { stakes: [], tasks: [{ seat: 0, text: "Run" }, { seat: 1, text: "Swim" }] };
    const options = { newKey: () => "gsk_x", previousStakeKeys: new Set<string>() };
    expect(codeOf(() => decideNewTerms({ ...base, schedule: { days: [] } }, options))).toBe("INVALID_REQUEST");
    expect(codeOf(() => decideNewTerms({ ...base, schedule: { count: 8 } }, options))).toBe("INVALID_REQUEST");
    expect(codeOf(() => decideNewTerms({ ...base, schedule: { count: 5 }, tasks: [{ seat: 0, text: "Run" }] }, options)))
      .toBe("INVALID_REQUEST");
    expect(codeOf(() => decideNewTerms({ ...base, lengthDays: 14, schedule: { count: 10 } }, options))).toBe("OK");
  });
});

describe("weekly game: joining", () => {
  it("starts Day 1 on each player's next local day and pairs them by day number", () => {
    const decision = decideJoin(invited(), { memberId: AVA, now: JOIN_AT, termsVersion: 1, timeZone: SYD });
    expect(decision).toMatchObject({ kind: "join", seat: 1, startedAt: JOIN_AT });
    if (decision.kind !== "join") return;
    // New York is still on Friday; Sydney is already on Saturday.
    expect(decision.players).toEqual([
      { dayOne: "2026-10-17", memberId: LEO, timeZone: NYC },
      { dayOne: "2026-10-18", memberId: AVA, timeZone: SYD },
    ]);
    // Settles an hour after the later player's last day ends (Sydney, 3am Oct 25 local).
    expect(decision.nextDueAt.toISOString()).toBe("2026-10-24T17:00:00.000Z");
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
    const stale = invited();
    stale.game.terms.versions.push({ ...stale.game.terms.versions[0], n: 2 });
    expect(codeOf(() => decideJoin(stale, { memberId: AVA, now: JOIN_AT, termsVersion: 2, timeZone: SYD })))
      .toBe("TERMS_CHANGED");
    const declined: RuleState = { ...invited(), game: { ...invited().game, status: "void" } };
    expect(codeOf(() => decideJoin(declined, { memberId: AVA, now: JOIN_AT, termsVersion: 1, timeZone: SYD })))
      .toBe("INVITE_EXPIRED");
  });

  it("freezes each player's time zone at go-live, from the state it's given", () => {
    const moved = invited();
    moved.players[0].timeZone = "Europe/London";
    const decision = decideJoin(moved, { memberId: AVA, now: JOIN_AT, termsVersion: 1, timeZone: SYD });
    if (decision.kind !== "join") throw new Error("expected a join");
    // Midnight UTC is 1am Saturday in London: still Friday's game day, so Day 1 is Saturday.
    expect(decision.players[0]).toEqual({ dayOne: "2026-10-17", memberId: LEO, timeZone: "Europe/London" });
  });

  it("lets the invitee decline and the challenger cancel, only before anyone joins", () => {
    expect(codeOf(() => decideVoid(invited(), { memberId: AVA, reason: "declined" }))).toBe("OK");
    expect(codeOf(() => decideVoid(invited(), { memberId: LEO, reason: "declined" }))).toBe("INVALID_REQUEST");
    expect(codeOf(() => decideVoid(invited(), { memberId: LEO, reason: "cancelled" }))).toBe("OK");
    expect(codeOf(() => decideVoid(invited(), { memberId: AVA, reason: "cancelled" }))).toBe("NOT_A_PLAYER");
    // A live game plays out.
    expect(codeOf(() => decideVoid(live(), { memberId: LEO, reason: "cancelled" }))).toBe("GAME_NOT_LIVE");
    expect(codeOf(() => decideVoid(live(), { memberId: "hbm_kat", reason: "declined" }))).toBe("GAME_NOT_LIVE");
  });
});

describe("weekly game: posting", () => {
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

  it("lets an excuse sit beside a post without using it up", () => {
    let state = live();
    state = post(state, LEO, at(state, LEO, 0, 8), { kind: "excuse" });
    state = post(state, LEO, at(state, LEO, 0, 9));
    expect(state.entries.map((entry) => entry.attempt)).toEqual([0, 1]);
    expect(codeOf(() => post(state, LEO, at(state, LEO, 0, 10), { kind: "excuse" }))).toBe("RETAKE_USED");
  });

  it("needs media for photo kinds and only your own uploads", () => {
    const state = live();
    const base = { captureAgeMs: null, hasText: false, memberId: LEO, now: at(state, LEO, 0, 9) };
    expect(codeOf(() => decidePost(state, { ...base, kind: "photo", mediaKeyPrefix: mediaKeyPrefixFor(LEO), mediaKeys: [] })))
      .toBe("MEDIA_MISSING");
    expect(codeOf(() => decidePost(state, {
      ...base,
      kind: "photo",
      mediaKeyPrefix: mediaKeyPrefixFor(LEO),
      mediaKeys: [`${mediaKeyPrefixFor(AVA)}x.jpg`],
    }))).toBe("MEDIA_MISSING");
    expect(codeOf(() => post(live(), "hbm_kat", at(state, LEO, 0, 9)))).toBe("NOT_A_PLAYER");
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
    // Thirty seconds of clock slack is allowed; more is not.
    expect(post(state, LEO, thirtyAfter, { captureAgeMs: (30 * 60 - 25) * 1000 }).entries[0].dayIndex).toBe(1);
    expect(post(state, LEO, thirtyAfter, { captureAgeMs: (30 * 60 - 35) * 1000 }).entries[0].dayIndex).toBe(2);
    // No capture age, or past the hour: today.
    expect(post(state, LEO, thirtyAfter).entries[0].dayIndex).toBe(2);
    const late = new Date(boundary.getTime() + 61 * 60 * 1000);
    expect(post(state, LEO, late, { captureAgeMs: 62 * 60 * 1000 }).entries[0].dayIndex).toBe(2);
    // Yesterday already has a live post: today.
    const already = post(state, LEO, at(state, LEO, 1, 9));
    expect(post(already, LEO, thirtyAfter, { captureAgeMs: 31 * 60 * 1000 }).entries.at(-1)!.dayIndex).toBe(2);
    // After the last day: grace still lands on day 6, otherwise closed.
    const end = at(state, LEO, 7, 3);
    const afterEnd = new Date(end.getTime() + 30 * 60 * 1000);
    expect(post(state, LEO, afterEnd, { captureAgeMs: 31 * 60 * 1000 }).entries[0].dayIndex).toBe(6);
    expect(codeOf(() => post(state, LEO, afterEnd, { captureAgeMs: 10 * 60 * 1000 }))).toBe("DAY_CLOSED");
  });

  it("gives grace only to a scheduled day that ended without a post", () => {
    // Mon/Wed/Fri. Leo's Day 0 is Saturday and Day 1 Sunday (off); Day 2 is Monday.
    const state = live(invited({ days: [0, 2, 4] }));
    const mondayBoundary = at(state, LEO, 2, 3);
    const afterSunday = new Date(mondayBoundary.getTime() + 10 * 60 * 1000);
    expect(post(state, LEO, afterSunday, { captureAgeMs: 15 * 60 * 1000 }).entries[0].dayIndex).toBe(2);
    const tuesdayBoundary = at(state, LEO, 3, 3);
    const afterMonday = new Date(tuesdayBoundary.getTime() + 10 * 60 * 1000);
    expect(post(state, LEO, afterMonday, { captureAgeMs: 15 * 60 * 1000 }).entries[0].dayIndex).toBe(2);
  });

  it("works across the date line (Auckland vs Honolulu)", () => {
    const aucklandInvite = invited();
    aucklandInvite.players[0].timeZone = "Pacific/Auckland";
    // Saturday 9am in Auckland is Friday 10am in Honolulu.
    const state = live(aucklandInvite, "Pacific/Honolulu", new Date("2026-10-16T20:00:00Z"));
    expect(state.players.map((player) => player.dayOne)).toEqual(["2026-10-18", "2026-10-17"]);
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
    // Ava's Day 0 is Sunday in Sydney; she posts Mon and Wed only.
    state = post(state, AVA, at(state, AVA, 1, 9));
    state = post(state, AVA, at(state, AVA, 3, 9));
    expect(scorePlayer(state, playerFor(state, AVA)!)).toMatchObject({ misses: 1, score: 2 });
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
  it("moves Day 1 so today moves forward, and starts today only before anyone has", () => {
    const state = live();
    const started = decideStartNow(state, JOIN_AT);
    expect(dayOneOf(started, LEO)).toBe("2026-10-16");
    expect(dayOneOf(started, AVA)).toBe("2026-10-17");
    const begun = { ...state, players: state.players.map((player) => ({ ...player, dayOne: dayOneOf(started, player.memberId) })) };
    expect(codeOf(() => decideStartNow(begun, JOIN_AT))).toBe("INVALID_REQUEST");

    const advanced = decideDevAdvance(state, 2);
    expect(dayOneOf(advanced, LEO)).toBe("2026-10-15");
    expect(advanced.nextDueAt.getTime()).toBe(state.game.nextDueAt!.getTime() - 2 * 24 * 60 * 60 * 1000);
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
    // Invite links have no member, so only the global switch applies to them.
    expect(isGameEnabled(allowlisted)).toBe(true);
    expect(isGameEnabled({ MURPH_GAME_ENABLED: "false", NODE_ENV: "development" })).toBe(false);
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
