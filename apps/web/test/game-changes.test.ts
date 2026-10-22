import { describe, expect, it } from "vitest";
import { decideGameChange, firstUnstartedGameDay, gameChangeControls, isGameChangeExpired, parsePendingGameChange } from "@/src/lib/game/changes";
import { parseGameCommand } from "@/src/lib/game/command";
import { scorePlayer, settleDueAt, type RuleState } from "@/src/lib/game/rules";
import { addDays } from "@/src/lib/game/time";
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
  it("expires an approval when its first day has started or its terms changed", () => {
    const s = state(); const p = pending(s, DURING);
    expect(isGameChangeExpired(s, p, DURING)).toBe(false);
    expect(isGameChangeExpired(s, p, new Date("2026-11-05T17:00:00Z"))).toBe(true);
    s.game.terms.versions[0].n = 2;
    expect(isGameChangeExpired(s, p, DURING)).toBe(true);
  });
  it("allows a final-day extension without making new obligations for a day already over", () => {
    const s = state(); const lastDay = new Date("2026-11-09T17:00:00Z");
    expect(gameChangeControls(s, lastDay, null)).toMatchObject({ canEdit: true, canEditSchedule: false, editableFromDay: 7 });
    expect(decideGameChange(s, "player_a", { kind: "edit", lengthDays: 14 }, lastDay).effectiveFromDay).toBe(7);
    expect(() => decideGameChange(s, "player_a", { kind: "edit", schedule: { days: [5,6] } }, lastDay)).toThrow();
    expect(gameChangeControls(s, new Date("2026-11-10T17:00:00Z"), null).canEdit).toBe(false);
  });
  it.each([7, 28])("allows stakes alone on the final day and closing grace of a %s-day game", (lengthDays) => {
    const s = state(); s.game.lengthDays = lengthDays;
    s.players.forEach((player) => { player.dayOne = addDays("2026-11-09", 1 - lengthDays); });
    const lastDay = new Date("2026-11-09T17:00:00Z");
    const due = settleDueAt(s.players, lengthDays), grace = new Date(due.getTime() - 1);
    const change = { kind: "edit" as const, stakes: [{ kind: "per_miss" as const, item: "Tea" }], stakesApplyToWholeGame: true as const };
    expect(gameChangeControls(s, lastDay, null)).toMatchObject({ canEdit: true, canEditStakes: true, canEditTasks: false, canEditSchedule: false, editableFromDay: lengthDays });
    const proposal = { ...pending(), ...decideGameChange(s, "player_a", change, lastDay) };
    expect(proposal.effectiveFromDay).toBe(lengthDays);
    expect(isGameChangeExpired(s, proposal, grace)).toBe(false);
    expect(decideGameChange(s, "player_a", change, grace).effectiveFromDay).toBe(lengthDays);
    expect(() => decideGameChange(s, "player_a", { ...change, tasks: [{seat:0,text:"Read"},{seat:1,text:"Walk"}] }, lastDay)).toThrow("at least one future day");
    expect(() => decideGameChange(s, "player_a", { ...change, schedule: {days:[0]} }, lastDay)).toThrow("at least one future day");
    // Stored pending words are sealed: approval must still distinguish tasks from stakes alone.
    expect(decideGameChange(s, "player_a", {kind:"edit",stakesApplyToWholeGame:true}, grace, {stakes:[{kind:"per_miss",key:"stake_2"}]}).effectiveFromDay).toBe(lengthDays);
    expect(() => decideGameChange(s, "player_a", {kind:"edit",stakesApplyToWholeGame:true}, grace, {tasksChanged:true,stakes:[{kind:"per_miss",key:"stake_2"}]})).toThrow("at least one future day");
    expect(isGameChangeExpired(s, proposal, due)).toBe(true);
    expect(gameChangeControls(s, due, null).canEditStakes).toBe(false);
    expect(() => decideGameChange(s, "player_a", change, due)).toThrow("no longer open");
    s.game.status = "settled";
    expect(gameChangeControls(s, lastDay, null).canEditStakes).toBe(false);
  });
  it("validates app and runtime commands at the same boundary", () => {
    expect(parseGameCommand({ type: "proposeChange", gameId: "game_change", proposalId: "proposal_1", expectedTermsVersion: 1, change: { kind: "edit", lengthDays: 14, actor: "ignored" } })).toMatchObject({ change: { kind: "edit", lengthDays: 14 } });
    expect(() => parseGameCommand({ type: "proposeChange", gameId: "game_change", proposalId: "proposal_1", expectedTermsVersion: 1, change: { kind: "edit" } })).toThrow();
    expect(() => parseGameCommand({ type: "respondChange", gameId: "game_change", proposalId: "proposal_1", decision: "yes" })).toThrow();
    expect(parsePendingGameChange({ v: 1, ...pending() })).toEqual(pending());
  });
  it("requires explicit whole-game scope for stakes after play begins", () => {
    const change = { kind: "edit" as const, stakes: [{ kind: "per_miss" as const, item: "Tea" }] };
    expect(() => decideGameChange(state(), "player_a", change, DURING)).toThrow("including earlier misses");
    expect(decideGameChange(state(), "player_a", { ...change, stakesApplyToWholeGame: true }, DURING).effectiveFromDay).toBe(2);
    expect(decideGameChange(state(), "player_a", { kind: "edit", tasks: [{seat:0,text:"Stretch"},{seat:1,text:"Walk"}] }, DURING).effectiveFromDay).toBe(2);
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
    expect(decideGameChange(s, "player_a", {kind:"edit",startsOn:null}, BEFORE).startsOn).toBe("2026-11-03");
    s.game.status = "negotiating"; s.players.forEach((player) => { player.dayOne = null; });
    expect(decideGameChange(s, "player_a", {kind:"edit",startsOn:null}, BEFORE).startsOn).toBeNull();
  });

});
