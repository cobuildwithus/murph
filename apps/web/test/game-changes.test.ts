import { describe, expect, it } from "vitest";
import { gameChangeCancellationNeedsNotice, decideApprovedGameChange, decideGameChange, firstUnstartedGameDay, gameChangeControls, isGameChangeExpired, parsePendingGameChange } from "@/src/lib/game/changes";
import { parseGameCommand } from "@/src/lib/game/command";
import { scorePlayer, type RuleState } from "@/src/lib/game/rules";
import type { GamePendingChange } from "@/src/lib/game/contract";

const BEFORE = new Date("2026-11-02T17:00:00Z");
const DURING = new Date("2026-11-04T17:00:00Z");
function state(): RuleState {
  return { game: { id: "game_changes", status: "live", createdBy: "player_a", seats: 2, lengthDays: 7, startsOn: null, inviteExpiresAt: null,
    terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { days: [0,1,2,3,4] }, stakes: [] }] } },
  players: ["player_a", "player_b"].map((memberId, seat) => ({ memberId, seat, dayOne: "2026-11-03", timeZone: "America/New_York" })), entries: [] };
}
function pending(s = state(), now = BEFORE): GamePendingChange {
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
    expect(gameChangeControls(state(), BEFORE, null)).toEqual({ canStartNow: true, canEdit: true, canEditSchedule: true, canEditStartDate: true, canEditTasks: false, canEditStakes: false, editableFromDay: 0 });
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
    expect(() => decideGameChange(s, "player_a", { kind: "edit", startsOn: "2026-11-10" }, DURING)).toThrow();
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
  it("retains passed dates and short lengths until approval refuses them", () => {
    const s = state();
    const date = { ...pending(), ...decideGameChange(s, "player_a", { kind: "edit", startsOn: "2026-11-04" }, BEFORE) };
    const short = { ...pending(), ...decideGameChange(s, "player_a", { kind: "edit", lengthDays: 3 }, BEFORE) };
    const later = new Date("2026-11-06T17:00:00Z");
    for (const proposal of [date, short]) expect(isGameChangeExpired(s, proposal, later)).toBe(false);
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
  it("allows a final-day extension without making new obligations for a day already over", () => {
    const s = state(); const lastDay = new Date("2026-11-09T17:00:00Z");
    expect(gameChangeControls(s, lastDay, null)).toMatchObject({ canEdit: true, canEditSchedule: false, editableFromDay: 7 });
    expect(decideGameChange(s, "player_a", { kind: "edit", lengthDays: 14 }, lastDay).effectiveFromDay).toBe(7);
    expect(() => decideGameChange(s, "player_a", { kind: "edit", schedule: { days: [5,6] } }, lastDay)).toThrow();
    expect(gameChangeControls(s, new Date("2026-11-10T17:00:00Z"), null).canEdit).toBe(false);
  });
  it.each([BEFORE, DURING])("locks task and stake changes at kickoff, including sealed approval at %s", (now) => {
    const s = state();
    expect(gameChangeControls(s, now, null)).toMatchObject({ canEditTasks: false, canEditStakes: false });
    expect(() => decideGameChange(s, "player_a", {kind:"edit",stakes:[{kind:"dare",item:"Sing"}],stakesApplyToWholeGame:true}, now)).toThrow("Stakes lock");
    expect(() => decideGameChange(s, "player_a", {kind:"edit",tasks:[{seat:0,text:"Read"},{seat:1,text:"Walk"}]}, now)).toThrow("Tasks lock");
    expect(() => decideGameChange(s, "player_a", {kind:"edit"}, now, {stakes:[{kind:"prize",key:"stake_2"}]})).toThrow("Stakes lock");
    expect(() => decideGameChange(s, "player_a", {kind:"edit"}, now, {tasksChanged:true})).toThrow("Tasks lock");
    s.game.status = "negotiating"; s.players.forEach((player) => { player.dayOne = null; });
    expect(gameChangeControls(s, now, null)).toMatchObject({ canEditTasks: true, canEditStakes: true });
    expect(decideGameChange(s, "player_a", {kind:"edit",stakes:[{kind:"dare",item:"Sing"}]}, now).effectiveFromDay).toBe(0);
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

});
