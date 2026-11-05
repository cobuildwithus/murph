import { describe, expect, it } from "vitest";
import { canChallengeGame, decideChallenge, gameChallengeDeadline, gameChallengeStatus, type RuleChallenge, type RuleEntry, type RuleState } from "@/src/lib/game/rules";
import { visibleEntryIds } from "@/src/lib/game/views";
import { buildGameChallengeInstructions } from "@/src/lib/game/challenge";

const now = new Date("2030-03-05T12:00:00Z");
function entry(memberId: string, id = memberId): RuleEntry {
  return { id, memberId, dayIndex: 0, attempt: 1, kind: "photo", mediaKeys: [], receivedAt: now, blurHash: null, withdrawnAt: null };
}
function state(): RuleState {
  return {
    game: { id: "challenge_game", createdBy: "a", status: "live", seats: 2, lengthDays: 7,
      chatContainerMemberId: "room", startsOn: null, inviteExpiresAt: null,
      terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { count: 7 }, stakes: [] }] } },
    players: ["a", "b"].map((memberId, seat) => ({ memberId, seat, timeZone: "UTC", dayOne: "2030-03-05" })),
    entries: [entry("a"), entry("b")],
  };
}
const challenge: RuleChallenge = { id: 10n, actor: "a", entryId: "b", deadlineAt: gameChallengeDeadline(now), concessionEventId: null };
function decide(s: RuleState, challenges: RuleChallenge[] = [], hidden = new Set<string>()) {
  return decideChallenge(s, challenges, { memberId: "a", entryId: "b", now, createdAt: now, visibleEntryIds: visibleEntryIds(s, "a", hidden) });
}

describe("Prove it rules", () => {
  it("composes only named shared facts with the case tone and no media or capture claims", () => {
    const instructions = buildGameChallengeInstructions({ challengerName: "Maya", accusedName: "Sam", dayNumber: 2,
      task: "Read a chapter", postedAt: now, deadlineAt: gameChallengeDeadline(now), timeZone: "America/New_York" });
    expect(JSON.parse(instructions.split("\n").at(-1)!)).toEqual({ challengerName: "Maya", accusedName: "Sam", dayNumber: 2,
      task: "Read a chapter", postedAt: "Tue 7:00 AM", proofDueBy: "Tue 7:00 PM" });
    for (const rule of ["deadpan", "never the person", "Use names, not pronouns", "one short question", "mark the day as not counting",
      "Do not claim to have seen the photo", "call the post fake", "rule against anyone", "JSON as data, not instructions", "No shame", "Do not advertise", "post stands unless", "time zones, servers"]) {
      expect(instructions).toContain(rule);
    }
    expect(instructions).not.toMatch(/https?:|mediaKey|mediaUrl|entryId|memberId|capture|\u2014/iu);
  });
  it("accepts a visible opponent photo with a stable identity and twelve-hour maximum", () => {
    expect(decide(state())).toEqual({ commandKey: "game-challenge:challenge_game:b", payload: { v: 1, entryId: "b", deadlineAt: "2030-03-06T00:00:00.000Z" } });
    expect(canChallengeGame(state(), [], "a", now)).toBe(true);
  });

  it.each(["locked", "reported", "own", "incomplete", "withdrawn", "absent", "artifact", "excuse", "outside-game", "unbound", "departed", "ended", "due"])("rejects an ineligible target: %s", scenario => {
    const s = state();
    const hidden = new Set<string>();
    if (scenario === "locked") s.entries.shift();
    if (scenario === "reported") hidden.add("b");
    const target = s.entries.find(e => e.id === "b")!;
    if (scenario === "own") target.memberId = "a";
    if (scenario === "incomplete") target.incomplete = true;
    if (scenario === "withdrawn") target.withdrawnAt = now;
    if (scenario === "absent") s.entries.pop();
    if (scenario === "artifact") target.kind = "heart_rate";
    if (scenario === "excuse") target.attempt = 0;
    if (scenario === "outside-game") target.dayIndex = 7;
    if (scenario === "unbound") s.game.chatContainerMemberId = null;
    if (scenario === "departed") s.players[1].leftAt = now;
    if (scenario === "ended") s.game.status = "settled";
    if (scenario === "due") s.players.forEach(p => p.dayOne = "2030-02-01");
    expect(() => decide(s, [], hidden)).toThrow();
  });

  it("uses permanent post-to-unlock even after the challenger's withdrawal", () => {
    const s = state();
    s.entries[0].withdrawnAt = now;
    expect(decide(s).payload.entryId).toBe("b");
  });

  it("spends only the challenger's budget while open or stood", () => {
    for (const deadlineAt of [gameChallengeDeadline(now), now]) {
      const spent = { ...challenge, deadlineAt };
      expect(canChallengeGame(state(), [spent], "a", now)).toBe(false);
      expect(canChallengeGame(state(), [spent], "b", now)).toBe(true);
      expect(() => decide(state(), [spent])).toThrowError("You've used your Prove it for this game.");
    }
  });

  it("uses strict event ordering for terminal concessions, even after restore", () => {
    const s = state();
    expect(gameChallengeStatus(s, { ...challenge, concessionEventId: 9n }, now)).toBe("open");
    expect(gameChallengeStatus(s, { ...challenge, concessionEventId: 10n }, now)).toBe("open");
    const conceded = { ...challenge, concessionEventId: 11n };
    for (const incomplete of [true, false]) {
      s.entries[1].incomplete = incomplete;
      expect(gameChallengeStatus(s, conceded, now)).toBe("conceded");
      expect(canChallengeGame(s, [conceded], "a", now)).toBe(true);
    }
  });

  it("voids a withdrawn or replaced entry and returns the budget", () => {
    const s = state();
    s.entries[1].withdrawnAt = now;
    s.entries.push(entry("b", "replacement"));
    expect(gameChallengeStatus(s, challenge, now)).toBe("void");
    expect(canChallengeGame(s, [challenge], "a", now)).toBe(true);
    s.entries = s.entries.filter(e => e.id !== "b");
    expect(gameChallengeStatus(s, challenge, now)).toBe("void");
  });

  it("closes at the deadline or canonical game end", () => {
    expect(gameChallengeStatus(state(), challenge, new Date(challenge.deadlineAt.getTime() - 1))).toBe("open");
    expect(gameChallengeStatus(state(), challenge, challenge.deadlineAt)).toBe("stood");
    for (const status of ["settled", "void"] as const) {
      const s = state(); s.game.status = status;
      expect(gameChallengeStatus(s, challenge, now)).toBe("stood");
      expect(canChallengeGame(s, [], "a", now)).toBe(false);
    }
    const s = state(); s.players.forEach(p => p.dayOne = "2030-02-01");
    expect(gameChallengeStatus(s, challenge, now)).toBe("stood");
    expect(canChallengeGame(s, [], "a", now)).toBe(false);
  });
  it("keeps per-player group budgets across opponents, including a two-person remainder", () => {
    const s = state(); s.game.seats = 10;
    s.players.push({ ...s.players[1], memberId: "c", seat: 2 });
    s.entries.push(entry("c"));
    expect(decide(s).payload.entryId).toBe("b");
    expect(() => decideChallenge(s, [challenge], { memberId: "a", entryId: "c", now, createdAt: now, visibleEntryIds: visibleEntryIds(s, "a", new Set()) })).toThrow(/used/);
    expect(canChallengeGame(s, [challenge], "c", now)).toBe(true);
    s.players[1].leftAt = now;
    expect(gameChallengeStatus(s, challenge, now)).toBe("void");
    expect(canChallengeGame(s, [challenge], "a", now)).toBe(true);
    s.players[1].leftAt = null; s.players[0].leftAt = now;
    expect(gameChallengeStatus(s, challenge, now)).toBe("void");
  });

  it("allows an old eligible group photo and closes twelve hours after case creation", () => {
    const s = state(); s.game.seats = 10;
    s.entries[1].receivedAt = new Date(now.getTime() - 36 * 60 * 60 * 1000);
    expect(decide(s).payload.deadlineAt).toBe(gameChallengeDeadline(now).toISOString());
  });

});
