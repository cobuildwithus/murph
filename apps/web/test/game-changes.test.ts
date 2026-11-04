import { describe, expect, it } from "vitest";
import { gameChangeMajority, normalizeGroupGameChange, gameChangeCancellationNeedsNotice, decideApprovedGameChange, decideGameChange, firstUnstartedGameDay, gameChangeControls, isGameChangeExpired, parsePendingGameChange, pendingGameChangeView } from "@/src/lib/game/changes";
import { parseGameCommand } from "@/src/lib/game/command";
import { decideNewTerms, scorePlayer, type RuleState, type TermWords } from "@/src/lib/game/rules";
import { dayStartInstant } from "@/src/lib/game/time";
import type { GamePendingChange, GameTermsInput } from "@/src/lib/game/contract";

const BEFORE = new Date("2026-11-02T17:00:00Z");
const DURING = new Date("2026-11-04T17:00:00Z");
function state(): RuleState {
  return { game: { id: "game_changes", status: "live", createdBy: "player_a", seats: 2, lengthDays: 7, startsOn: null, inviteExpiresAt: null,
    terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { days: [0,1,2,3,4] }, stakes: [] }] } },
  players: ["player_a", "player_b"].map((memberId, seat) => ({ memberId, seat, dayOne: "2026-11-03", timeZone: "America/New_York" })), entries: [] };
}
function pending(s = state(), now = BEFORE): Omit<GamePendingChange, "votes"> {
  return { id: "proposal_a", proposedByMemberId: "player_a", expectedTermsVersion: 1, deliveryStatus: "pending",
    ...decideGameChange(s, "player_a", { kind: "edit", schedule: { days: [5,6] } }, now) };
}
describe("weekly game mutually agreed changes", () => {
  it("keeps decline silent and cancellation notices limited to announced app requests", () => {
    const proposal = {...pending(),origin:"app" as const,deliveryStatus:"sent" as const};
    expect(gameChangeCancellationNeedsNotice(proposal,"cancel")).toBe(true);
    expect(gameChangeCancellationNeedsNotice(proposal,"decline")).toBe(false);
    expect(gameChangeCancellationNeedsNotice({...proposal,origin:"chat"},"cancel")).toBe(false);
    expect(gameChangeCancellationNeedsNotice({...proposal,deliveryStatus:"pending"},"cancel")).toBe(false);
  });
  it("exposes pre-start controls and fixes start-now to a shared calendar date", () => {
    expect(gameChangeControls(state(), BEFORE, null)).toEqual({ canStartNow: true, canEdit: true, canEditSchedule: true, canEditStartDate: true, canEditTasks: true, canEditStakes: true, editableFromDay: 0 });
    expect(decideGameChange(state(), "player_a", { kind: "start_now" }, BEFORE).startsOn).toBe("2026-11-02");
    expect(gameChangeControls(state(), BEFORE, pending()).canEdit).toBe(false);
  });
  it("applies weekdays only from a future unstarted day and preserves a past missed weekday", () => {
    const s = state(); const decision = decideGameChange(s, "player_b", { kind: "edit", schedule: { days: [5,6] } }, DURING);
    expect(decision.effectiveFromDay).toBe(2);
    s.game.terms.versions.push({ n: 2, fromDay: 2, schedule: { days: [5,6] }, stakes: [] });
    const score = scorePlayer(s, s.players[0]);
    expect(score.misses).toBe(4); // Tue/Wed under old terms, Sat/Sun under new.
  });
  it("uses the furthest-ahead player when choosing the first editable day", () => {
    const s = state(); s.players[1].timeZone = "Pacific/Auckland";
    expect(firstUnstartedGameDay(s, new Date("2026-11-04T20:00:00Z"))).toBe(3);
  });
  it("rejects historical starts, shrinking away started days and count-mode reinterpretation", () => {
    const s = state();
    expect(() => decideGameChange(s, "player_a", { kind: "start_now" }, DURING)).toThrow();
    expect(() => decideGameChange(s, "player_a", { kind: "edit", startsOn: "2026-11-03" }, DURING)).toThrow("from today");
    expect(() => decideGameChange(s, "player_a", { kind: "edit", lengthDays: 2 }, DURING)).toThrow();
    expect(() => decideGameChange(s, "player_a", { kind: "edit", schedule: { count: 2 } }, DURING)).toThrow();
    s.game.terms.versions[0].schedule = { count: 4 };
    expect(gameChangeControls(s, DURING, null).canEditSchedule).toBe(false);
    expect(() => decideGameChange(s, "player_a", { kind: "edit", schedule: { days: [5,6] } }, DURING)).toThrow();
    expect(decideGameChange(s, "player_a", { kind: "edit", lengthDays: 10 }, DURING).change).toEqual({ kind: "edit", lengthDays: 10 });
  });
  it.each([BEFORE, DURING])("keeps an any-days target valid when changing duration at %s", (now) => {
    const s = state();
    s.game.terms.versions[0].schedule = { count: 4 };
    expect(() => decideGameChange(s, "player_a", { kind: "edit", lengthDays: 3 }, now)).toThrow("Count must be 1 to 3.");
    for (const lengthDays of [4, 14]) {
      expect(decideGameChange(s, "player_a", { kind: "edit", lengthDays }, now).change).toEqual({ kind: "edit", lengthDays });
    }
    expect(s.game.terms.versions[0].schedule).toEqual({ count: 4 });
  });
  it("allows an explicitly lowered any-days target only before play starts", () => {
    const s = state();
    s.game.terms.versions[0].schedule = { count: 4 };
    const change = { kind: "edit" as const, lengthDays: 3, schedule: { count: 3 } };
    expect(decideGameChange(s, "player_a", change, BEFORE).change).toEqual(change);
    expect(() => decideGameChange(s, "player_a", change, DURING)).toThrow("keep an any-days target unchanged");
  });
  it("keeps an approval across day boundaries but clears it when terms change", () => {
    const s = state(); const p = pending(s, DURING);
    expect(isGameChangeExpired(s, p, DURING)).toBe(false);
    const acceptedAt = new Date("2026-11-05T17:00:00Z");
    expect(isGameChangeExpired(s, p, acceptedAt)).toBe(false);
    expect(decideApprovedGameChange(s, "player_b", p, acceptedAt).effectiveFromDay).toBe(3);
    expect(p.effectiveFromDay).toBe(2);
    s.game.terms.versions[0].n = 2;
    expect(isGameChangeExpired(s, p, DURING)).toBe(true);
  });
  it("expires passed dates and short lengths at read time, the moment approval would refuse them", () => {
    const s = state();
    const date = { ...pending(), ...decideGameChange(s, "player_a", { kind: "edit", startsOn: "2026-11-04" }, BEFORE) };
    const short = { ...pending(), ...decideGameChange(s, "player_a", { kind: "edit", lengthDays: 3 }, BEFORE) };
    const later = new Date("2026-11-06T17:00:00Z");
    for (const proposal of [date, short]) expect(isGameChangeExpired(s, proposal, BEFORE)).toBe(false);
    for (const proposal of [date, short]) expect(isGameChangeExpired(s, proposal, later)).toBe(true);
    expect(() => decideApprovedGameChange(s, "player_b", date, later)).toThrow("proposed start date has passed");
    expect(() => decideApprovedGameChange(s, "player_b", short, later)).toThrow("day already started");
    s.game.status = "settled";
    expect(isGameChangeExpired(s, short, later)).toBe(true);
    s.game.status = "void";
    expect(isGameChangeExpired(s, short, later)).toBe(true);
  });
  it("recomputes an explicitly reset default date at acceptance", () => {
    const s = state();
    s.players.forEach((player) => { player.dayOne = "2026-11-10"; });
    const proposal = { ...pending(), ...decideGameChange(s, "player_a", { kind: "edit", startsOn: null }, BEFORE) };
    expect(proposal.startsOn).toBe("2026-11-02");
    expect(decideApprovedGameChange(s, "player_b", proposal, DURING).startsOn).toBe("2026-11-04");
  });
  it("honors a proposed date that is today when neither player has begun", () => {
    const s = state();
    s.players.forEach((player) => { player.dayOne = "2026-11-10"; });
    const proposal = { ...pending(), ...decideGameChange(s, "player_a", { kind: "edit", startsOn: "2026-11-04" }, BEFORE) };
    expect(decideApprovedGameChange(s, "player_b", proposal, DURING).effectiveFromDay).toBe(0);
  });
  it("moves a begun Day 1 until someone checks in, rebuilding the calendar from Day 1", () => {
    const s = state();
    expect(gameChangeControls(s, DURING, null)).toMatchObject({ canStartNow: false, canEditStartDate: true, editableFromDay: 2 });
    const today = decideGameChange(s, "player_b", { kind: "edit", startsOn: "2026-11-04" }, DURING);
    expect(today).toMatchObject({ effectiveFromDay: 0, startsOn: "2026-11-04" });
    const proposal = { ...pending(), ...decideGameChange(s, "player_a", { kind: "edit", startsOn: "2026-11-05", schedule: { days: [3,4] } }, DURING) };
    expect(proposal).toMatchObject({ effectiveFromDay: 0, startsOn: "2026-11-05" });
    expect(pendingGameChangeView(s, proposal, DURING)?.effectiveFromDay).toBe(0);
    const agreedAt = new Date("2026-11-05T17:00:00Z");
    expect(decideApprovedGameChange(s, "player_b", proposal, agreedAt)).toMatchObject({ effectiveFromDay: 0, startsOn: "2026-11-05" });
    s.entries.push({ id: "entry_1", memberId: "player_b", dayIndex: 1, attempt: 1, kind: "words", mediaKeys: [], receivedAt: DURING, blurHash: null, withdrawnAt: null });
    expect(gameChangeControls(s, DURING, null).canEditStartDate).toBe(false);
    expect(() => decideGameChange(s, "player_a", { kind: "edit", startsOn: "2026-11-05" }, DURING)).toThrow("locks once someone checks in");
    expect(() => decideApprovedGameChange(s, "player_b", proposal, agreedAt)).toThrow("locks once someone checks in");
    expect(isGameChangeExpired(s, proposal, agreedAt)).toBe(true);
  });
  it("allows a final-day extension without making new obligations for a day already over", () => {
    const s = state(); const lastDay = new Date("2026-11-09T17:00:00Z");
    expect(gameChangeControls(s, lastDay, null)).toMatchObject({ canEdit: true, canEditSchedule: false, editableFromDay: 7 });
    expect(decideGameChange(s, "player_a", { kind: "edit", lengthDays: 14 }, lastDay).effectiveFromDay).toBe(7);
    expect(() => decideGameChange(s, "player_a", { kind: "edit", schedule: { days: [5,6] } }, lastDay)).toThrow();
    expect(gameChangeControls(s, new Date("2026-11-10T17:00:00Z"), null).canEdit).toBe(false);
  });
  it("opens tasks until Day 1 begins and the prize or dare until the game is due, including sealed approval", () => {
    const s = state(); s.game.terms.versions[0].stakes = [{ kind: "prize", key: "stake_1" }];
    const prize = { kind: "edit" as const, stakes: [{ kind: "prize" as const, item: "A smoothie" }] };
    const tasks = { kind: "edit" as const, tasks: [{ seat: 0, text: "Read" }, { seat: 1, text: "Walk" }] };
    // Live before Day 1: both open, from day 0.
    expect(gameChangeControls(s, BEFORE, null)).toMatchObject({ canEditTasks: true, canEditStakes: true });
    expect(decideGameChange(s, "player_a", tasks, BEFORE).effectiveFromDay).toBe(0);
    expect(decideGameChange(s, "player_a", prize, BEFORE)).toEqual({ change: prize, effectiveFromDay: 0, startsOn: null });
    // Mid-game: tasks locked, the prize still open with the other player's yes.
    expect(gameChangeControls(s, DURING, null)).toMatchObject({ canEditTasks: false, canEditStakes: true });
    expect(() => decideGameChange(s, "player_a", tasks, DURING)).toThrow("Tasks lock");
    expect(() => decideGameChange(s, "player_a", {kind:"edit"}, DURING, {tasksChanged:true})).toThrow("Tasks lock");
    expect(decideGameChange(s, "player_a", prize, DURING).effectiveFromDay).toBe(2);
    const sealed = { ...pending(s, DURING), change: { kind: "edit" as const }, stakes: [{ kind: "dare" as const, key: "stake_2" }] };
    expect(decideApprovedGameChange(s, "player_b", sealed, DURING).effectiveFromDay).toBe(2);
    expect(isGameChangeExpired(s, sealed, DURING)).toBe(false);
    expect(() => decideGameChange(s, "player_a", {kind:"edit",stakes:[{kind:"winner_gets",item:"Lunch"}]}, DURING)).toThrow();
    // Last day, every day begun: a prize alone still changes; anything else needs a future day.
    const lastDay = new Date("2026-11-09T17:00:00Z");
    expect(decideGameChange(s, "player_b", prize, lastDay).effectiveFromDay).toBe(7);
    expect(isGameChangeExpired(s, sealed, lastDay)).toBe(false);
    expect(() => decideGameChange(s, "player_b", { ...prize, schedule: { days: [5,6] } }, lastDay)).toThrow();
    // Once the game is due, nothing changes and a waiting prize expires.
    const due = new Date("2026-11-10T17:00:00Z");
    expect(gameChangeControls(s, due, null)).toMatchObject({ canEdit: false, canEditStakes: false });
    expect(() => decideGameChange(s, "player_b", prize, due)).toThrow("no longer open for changes");
    expect(isGameChangeExpired(s, sealed, due)).toBe(true);
    s.game.status = "negotiating"; s.players.forEach((player) => { player.dayOne = null; });
    expect(gameChangeControls(s, DURING, null)).toMatchObject({ canEditTasks: true, canEditStakes: true });
    expect(decideGameChange(s, "player_a", {kind:"edit",stakes:[{kind:"dare",item:"Sing"}]}, DURING).effectiveFromDay).toBe(0);
  });
  it("validates app and runtime commands at the same boundary", () => {
    expect(parseGameCommand({ type: "proposeChange", gameId: "game_change", proposalId: "proposal_1", expectedTermsVersion: 1, change: { kind: "edit", lengthDays: 14, actor: "ignored" } })).toMatchObject({ change: { kind: "edit", lengthDays: 14 } });
    expect(() => parseGameCommand({ type: "proposeChange", gameId: "game_change", proposalId: "proposal_1", expectedTermsVersion: 1, change: { kind: "edit" } })).toThrow();
    expect(() => parseGameCommand({ type: "respondChange", gameId: "game_change", proposalId: "proposal_1", decision: "yes" })).toThrow();
    expect(parsePendingGameChange({ v: 1, ...pending() })).toEqual(pending());
  });
  it("keeps negotiation unstarted across days until agreement and validates complete tasks", () => {
    const s = state(); s.game.status = "negotiating"; s.players.forEach((player) => { player.dayOne = null; });
    const proposal = pending(s, BEFORE);
    expect(firstUnstartedGameDay(s, DURING)).toBe(0);
    expect(isGameChangeExpired(s, proposal, DURING)).toBe(false);
    expect(() => parseGameCommand({type:"proposeChange",gameId:"game_changes",proposalId:"proposal_1",expectedTermsVersion:1,change:{kind:"edit",tasks:[{seat:0,text:"Read"}]}})).toThrow("each player");
    s.game.inviteExpiresAt = DURING;
    expect(isGameChangeExpired(s, proposal, DURING)).toBe(true);
  });
  it("distinguishes reset-to-default start from preserving the selected date", () => {
    const s = state();
    expect(decideGameChange(s, "player_a", {kind:"edit",startsOn:null}, BEFORE).startsOn).toBe("2026-11-02");
    s.game.status = "negotiating"; s.players.forEach((player) => { player.dayOne = null; });
    expect(decideGameChange(s, "player_a", {kind:"edit",startsOn:null}, BEFORE).startsOn).toBeNull();
  });

  describe("self-play round 1 regressions", () => {
    function twoZones(lengthDays: number, dayOne: string, zones: [string, string], schedule: { days: (0|1|2|3|4|5|6)[] } = { days: [0,1,2,3,4,5,6] }): RuleState {
      const s = state();
      s.game.lengthDays = lengthDays;
      s.game.terms.versions[0].schedule = schedule;
      s.players.forEach((player, seat) => { player.dayOne = dayOne; player.timeZone = zones[seat]; });
      return s;
    }
    const BASE = { id: "proposal_r1", proposedByMemberId: "player_a", expectedTermsVersion: 1, deliveryStatus: "pending" as const };
    const noon = (date: string, zone: string) => new Date(dayStartInstant(date, zone).getTime() + 9 * 3_600_000);

    it("refuses a mid-game change that leaves no scheduled day in the rest of the game, from either seat", () => {
      // 4-day Sat-Tue game on day 1 (Sunday): Fridays-only leaves days 2-3 (Mon, Tue) off.
      const s = twoZones(4, "2026-11-07", ["America/New_York", "America/New_York"]);
      const sunday = noon("2026-11-08", "America/New_York");
      for (const actor of ["player_a", "player_b"]) {
        expect(() => decideGameChange(s, actor, { kind: "edit", schedule: { days: [4] } }, sunday)).toThrow("at least one scheduled day");
        expect(decideGameChange(s, actor, { kind: "edit", schedule: { days: [1] } }, sunday).effectiveFromDay).toBe(2);
        // Extending into a Friday is fine; shortening onto only off days is not.
        expect(decideGameChange(s, actor, { kind: "edit", schedule: { days: [4] }, lengthDays: 7 }, sunday).effectiveFromDay).toBe(2);
      }
      const offTail = twoZones(7, "2026-11-07", ["America/New_York", "America/New_York"], { days: [5] });
      expect(() => decideGameChange(offTail, "player_a", { kind: "edit", lengthDays: 4 }, sunday)).toThrow("at least one scheduled day");
      // Before play, the same edit is allowed: Day 1 moves onto the schedule when it lands.
      expect(decideGameChange(s, "player_a", { kind: "edit", schedule: { days: [4] } }, noon("2026-11-06", "America/New_York")).effectiveFromDay).toBe(0);
    });

    it("snaps a proposed start date onto the schedule and turns off a start-now that would not move Day 1", () => {
      const s = twoZones(7, "2026-11-11", ["America/New_York", "America/New_York"], { days: [2] });
      const saturday = noon("2026-11-07", "America/New_York");
      expect(decideGameChange(s, "player_a", { kind: "edit", startsOn: "2026-11-14" }, saturday).startsOn).toBe("2026-11-18");
      // Start now on Saturday would still start on Wednesday the 11th: nothing to start.
      expect(gameChangeControls(s, saturday, null).canStartNow).toBe(false);
      s.players.forEach((player) => { player.dayOne = "2026-11-18"; });
      expect(gameChangeControls(s, saturday, null).canStartNow).toBe(true);
      expect(decideGameChange(s, "player_a", { kind: "start_now" }, saturday).startsOn).toBe("2026-11-11");
    });

    it.each([
      ["same zone", ["Asia/Kolkata", "Asia/Kolkata"]],
      ["Auckland ahead of Honolulu", ["Pacific/Auckland", "Pacific/Honolulu"]],
      ["Honolulu behind Auckland", ["Pacific/Honolulu", "Pacific/Auckland"]],
    ] as const)("turns editing off once either player's last day is over (%s)", (_label, zones) => {
      const s = twoZones(3, "2026-11-07", [...zones]);
      const ends = s.players.map((player) => dayStartInstant("2026-11-10", player.timeZone).getTime());
      const lastDay = new Date(Math.min(...ends) - 60_000);
      const firstDone = new Date(Math.min(...ends) + 60_000);
      expect(gameChangeControls(s, lastDay, null)).toMatchObject({ canEdit: true, editableFromDay: 3 });
      expect(gameChangeControls(s, firstDone, null)).toEqual({ canStartNow: false, canEdit: false, canEditSchedule: false, canEditStartDate: false, canEditTasks: false, canEditStakes: false, editableFromDay: null });
      for (const actor of ["player_a", "player_b"]) {
        expect(() => decideGameChange(s, actor, { kind: "edit", lengthDays: 5 }, firstDone)).toThrow("no longer open for changes");
      }
      // A proposal still waiting when the first player finishes expires with it.
      const extension = { ...BASE, ...decideGameChange(s, "player_a", { kind: "edit", lengthDays: 5 }, lastDay) };
      expect(isGameChangeExpired(s, extension, lastDay)).toBe(false);
      expect(isGameChangeExpired(s, extension, firstDone)).toBe(true);
    });

    it.each(["player_a", "player_b"])("expires a waiting change the moment it can't apply, so it never blocks editing (proposed by %s)", (proposer) => {
      // Live 10-day game on New York's day 3 (Auckland's day 4); a 6-day length waits until day 6.
      const s = twoZones(10, "2026-11-07", ["America/New_York", "Pacific/Auckland"]);
      const day3 = noon("2026-11-10", "America/New_York");
      const proposal = { ...BASE, proposedByMemberId: proposer, ...decideGameChange(s, proposer, { kind: "edit", lengthDays: 6 }, day3) };
      expect(isGameChangeExpired(s, proposal, day3)).toBe(false);
      expect(gameChangeControls(s, day3, proposal).canEdit).toBe(false);
      const day6 = noon("2026-11-13", "America/New_York");
      expect(isGameChangeExpired(s, proposal, day6)).toBe(true);
      // Once cleared, either player can edit again.
      expect(gameChangeControls(s, day6, null).canEdit).toBe(true);
      // A start-now proposal expires once Day 1 has begun for anyone.
      const unstarted = twoZones(7, "2026-11-12", ["America/New_York", "Pacific/Auckland"]);
      const tuesday = noon("2026-11-10", "America/New_York");
      const startNow = { ...BASE, proposedByMemberId: proposer, ...decideGameChange(unstarted, proposer, { kind: "start_now" }, tuesday) };
      expect(isGameChangeExpired(unstarted, startNow, tuesday)).toBe(false);
      expect(isGameChangeExpired(unstarted, startNow, noon("2026-11-12", "Pacific/Auckland"))).toBe(true);
    });
  });
});

describe("group change rules", () => {
  function group(count = 4): RuleState {
    const s = state(); s.game.seats = 10;
    s.players = Array.from({ length: count }, (_, seat) => ({ ...s.players[0], memberId: `member_${seat}`, seat }));
    return s;
  }

  it.each([2, 3, 4, 10])("requires a strict majority of %i remaining players", count => {
    const s = group(count);
    for (let yes = 1; yes <= count; yes++) {
      for (let no = 0; no <= count - yes; no++) {
        const votes: Record<string, "yes" | "no"> = Object.fromEntries(s.players.slice(0, yes + no).map((p, i) => [p.memberId, i < yes ? "yes" : "no"]));
        expect(gameChangeMajority(s, votes)).toEqual({ approved: yes > count / 2, declined: count - no <= count / 2,
          yesNeeded: Math.max(0, Math.floor(count / 2) + 1 - yes) });
      }
    }
  });

  it("ignores unjoined and departed votes, and parses final votes from pending JSON", () => {
    const s = group(4); s.players[3].leftAt = BEFORE;
    const votes = { member_0: "yes" as const, member_1: "yes" as const, member_3: "no" as const, unjoined: "no" as const };
    expect(gameChangeMajority(s, votes)).toEqual({ approved: true, declined: false, yesNeeded: 0 });
    expect(parsePendingGameChange({ v: 1, ...pending(), votes })?.votes).toEqual(votes);
    expect(() => parsePendingGameChange({ v: 1, ...pending(), votes: { member_0: "maybe" } })).toThrow("malformed");
  });

  it("uses pair locks and due cutoffs for groups, with no Start now", () => {
    const s = group();
    for (const now of [BEFORE, DURING, new Date("2026-11-09T08:00:00Z"), new Date("2026-11-10T08:00:00Z")]) {
      const pair = { ...s, game: { ...s.game, seats: 2 }, players: s.players.slice(0, 2) };
      expect(gameChangeControls(s, now, null)).toEqual({ ...gameChangeControls(pair, now, null), canStartNow: false });
    }
    expect(() => decideGameChange(s, "member_0", { kind: "start_now" }, BEFORE)).toThrow();
    expect(gameChangeControls(s, BEFORE, pending()).canEdit).toBe(false);
    expect(decideGameChange(s, "member_1", { kind: "edit", startsOn: "2026-11-06" }, DURING)).toMatchObject({ effectiveFromDay: 0 });
    expect(() => decideGameChange(s, "member_1", { kind: "edit", tasks: [] }, DURING)).toThrow("Tasks lock");
    expect(decideGameChange(s, "member_1", { kind: "edit", lengthDays: 10, schedule: { days: [0, 1, 2, 3, 4, 5, 6] } }, DURING).effectiveFromDay).toBe(2);
    s.game.terms.versions[0].schedule = { count: 4 };
    expect(() => decideGameChange(s, "member_1", { kind: "edit", schedule: { count: 5 } }, DURING)).toThrow("any-days target unchanged");
    s.entries.push({ id: "entry_first", memberId: "member_0", dayIndex: 0, kind: "words", attempt: 1, mediaKeys: [], receivedAt: DURING, blurHash: null, withdrawnAt: null });
    expect(gameChangeControls(s, DURING, null).canEditStartDate).toBe(false);
    expect(() => decideGameChange(s, "member_1", { kind: "edit", startsOn: "2026-11-06" }, DURING)).toThrow("start date locks");
  });

  it("normalizes full terms into only the changed fields and rejects semantic no-ops", () => {
    const s = group(2);
    const words: TermWords = { v: 1, groupWord: "Crew", versions: [{ n: 1, defaultTask: "Walk", tasks: [{ seat: 4, text: "Private task" }], stakes: [{ key: "prize", item: "Lunch" }] }] };
    s.game.terms.versions[0].stakes = [{ key: "prize", kind: "prize" }];
    const input: GameTermsInput = { lengthDays: 7, schedule: { days: [4, 3, 2, 1, 0] }, defaultTask: "Walk", tasks: words.versions[0].tasks, stakes: [{ kind: "prize" as const, item: "Lunch" }] };
    const prepare = (overrides: Partial<typeof input>) => decideNewTerms({ ...input, ...overrides }, { newKey: () => "new_prize", today: "2026-11-02", maxPlayers: 10, inviteeSeats: [0, 1, 4], allowToday: true });
    expect(() => normalizeGroupGameChange(s, words, prepare({}))).toThrow("Nothing changed.");
    expect(() => normalizeGroupGameChange(s, words, prepare({ tasks: [...input.tasks, { seat: 0, text: "Walk" }] }))).toThrow("Nothing changed.");
    expect(normalizeGroupGameChange(s, words, prepare({ lengthDays: 10 }))).toEqual({ kind: "edit", lengthDays: 10 });
    expect(normalizeGroupGameChange(s, words, prepare({ stakes: [{ kind: "prize", item: "Dinner" }] }))).toEqual({ kind: "edit", stakes: [{ kind: "prize", item: "Dinner" }] });
    expect(normalizeGroupGameChange(s, words, prepare({ defaultTask: "Run" }))).toEqual({ kind: "edit", defaultTask: "Run", tasks: input.tasks });
    expect(normalizeGroupGameChange(s, words, prepare({ tasks: [...input.tasks, { seat: 0, text: "Read" }] }))).toMatchObject({ kind: "edit", defaultTask: "Walk", tasks: [{ seat: 0, text: "Read" }, { seat: 4, text: "Private task" }] });
    expect(words.groupWord).toBe("Crew");
  });

  it("validates optional group proposal IDs like pair proposal IDs", () => {
    const command = { type: "editTerms", gameId: "game_group", expectedTermsVersion: 1,
      terms: { defaultTask: "Walk", tasks: [], schedule: { count: 3 }, stakes: [{ kind: "prize", item: "Lunch" }] } };
    expect(parseGameCommand({ ...command, proposalId: "proposal_group" })).toMatchObject({ proposalId: "proposal_group" });
    expect(() => parseGameCommand({ ...command, proposalId: "short" })).toThrow();
  });
});
