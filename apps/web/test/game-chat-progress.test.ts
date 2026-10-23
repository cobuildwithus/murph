import { describe, expect, it } from "vitest";
import { gameChatProgress } from "../src/lib/game/chat-progress";
import type { RuleState } from "../src/lib/game/rules";
function state(): RuleState {
  return { game: { id: "synthetic_game", createdBy: "player_a", inviteExpiresAt: null, lengthDays: 7, seats: 2, startsOn: null, status: "live",
    terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { days: [0,1,2,3,4] }, stakes: [] }] } },
    players: ["player_a", "player_b"].map((memberId, seat) => ({ memberId, seat, dayOne: "2030-03-04", timeZone: "UTC" })), entries: [] };
}
describe("shared game progress", () => {
  it("distinguishes a missed past day, due current day, upcoming dates and off days", () => {
    const progress = gameChatProgress(state(), new Date("2030-03-05T12:00:00Z"));
    expect(progress.players[0].days.map((day) => day.status)).toEqual(["missed", "due", "upcoming", "upcoming", "upcoming", "off", "off"]);
    expect(progress.players[0]).toMatchObject({ score: 0, target: 5, currentDayIndex: 1, attemptsRemaining: 2 });
  });
  it("does not call a grace-window blank day missed", () => {
    expect(gameChatProgress(state(), new Date("2030-03-05T03:30:00Z")).players[0].days[0].status).toBe("due");
  });
  it("uses each player's time zone", () => {
    const input = state(); input.players[1].timeZone = "America/Los_Angeles";
    const players = gameChatProgress(input, new Date("2030-03-05T07:00:00Z")).players;
    expect(players.map((player) => player.currentDayIndex)).toEqual([1,0]);
  });
  it("counts live posts only and exposes no image, caption, or excuse", () => {
    const input = state();
    input.entries = [
      { id: "entry_original", memberId: "player_a", dayIndex: 1, kind: "photo", attempt: 1, withdrawnAt: new Date(), mediaKeys: ["private-photo"] },
      { id: "entry_retake", memberId: "player_a", dayIndex: 1, kind: "photo", attempt: 2, withdrawnAt: null, mediaKeys: ["private-retake"] },
      { id: "entry_excuse", memberId: "player_b", dayIndex: 0, kind: "excuse", attempt: 0, withdrawnAt: null, mediaKeys: [] },
    ];
    const result = gameChatProgress(input, new Date("2030-03-05T12:00:00Z"));
    expect(result.players[0]).toMatchObject({ score: 1, currentEntryId: "entry_retake", attemptsRemaining: 0 });
    expect(JSON.stringify(result)).not.toMatch(/private|excuse|media|withdrawn/iu);
    expect(result.players[1].days[0].status).toBe("missed");
  });
  it("uses historical terms for earlier dates and the updated schedule only from its effective day", () => {
    const input = state();
    input.game.terms.versions.push({ n: 2, fromDay: 2, schedule: { days: [5,6] }, stakes: [] });
    input.entries = [0,2].map((dayIndex) => ({ id: `entry_${dayIndex}`, memberId: "player_a", dayIndex, kind: "photo", attempt: 1, withdrawnAt: null, mediaKeys: [] }));
    const result = gameChatProgress(input, new Date("2030-03-06T12:00:00Z"));
    expect(result.players[0]).toMatchObject({ score: 1, target: 4 });
    expect(result.players[1].days.map((day) => day.status)).toEqual(["missed", "missed", "off", "off", "off", "upcoming", "upcoming"]);
  });
  it("does not label individual any-days blanks misses and caps credit at target", () => {
    const input = state(); input.game.terms.versions[0].schedule = { count: 2 };
    input.entries = [0,1,2].map((dayIndex) => ({ id: `entry_${dayIndex}`, memberId: "player_a", dayIndex, kind: "photo", attempt: 1, withdrawnAt: null, mediaKeys: [] }));
    input.game.status = "settled";
    const result = gameChatProgress(input, new Date("2030-03-12T12:00:00Z"));
    expect(result.players[0]).toMatchObject({ score: 2, target: 2, currentDayIndex: null, attemptsRemaining: 0 });
    expect(result.players[1].days.every((day) => day.status === "not_posted")).toBe(true);
  });
});


it("windows long-game history at 14 days while retaining whole-game totals", () => {
  const input = state(); input.game.lengthDays = 365;
  input.game.terms.versions[0].schedule = { count: 300 };
  input.entries = Array.from({length:20},(_,dayIndex) => ({ id:`entry_${dayIndex}`,memberId:"player_a",dayIndex,kind:"photo",attempt:1,withdrawnAt:null,mediaKeys:[] }));
  const live = gameChatProgress(input,new Date("2030-04-04T12:00:00Z")).players[0];
  expect(live.days).toHaveLength(14);
  expect(live.days[0].dayIndex).toBe(18);
  expect(live.days.at(-1)?.dayIndex).toBe(31);
  expect(live).toMatchObject({score:20,target:300});
  input.game.status = "settled";
  const recap = gameChatProgress(input,new Date("2031-04-04T12:00:00Z")).players[0];
  expect(recap.days).toHaveLength(14);
  expect(recap.days.at(-1)?.dayIndex).toBe(364);
  expect(recap).toMatchObject({score:20,target:300});
  input.game.terms.versions[0].schedule = {days:[0,1,2,3,4,5,6]};
  expect(gameChatProgress(input,new Date("2031-04-04T12:00:00Z")).players[0].target).toBe(365);
});
