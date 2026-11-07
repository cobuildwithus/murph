import { describe, expect, it } from "vitest";
import { gameEveningCheckInHorizons, gameEveningWindow } from "@/src/lib/game/evening-check-in";
import { GAME_ROOM_FAR_APART_HOURS, gameZoneSpreadHours } from "@murphai/hosted-execution/runtime-control";
import type { RuleState } from "@/src/lib/game/rules";

function state(zones: readonly string[], date = "2030-03-04"): RuleState {
  return { game: { id: "game", status: "live", createdBy: "one", seats: 10, lengthDays: 7,
    inviteExpiresAt: null, startsOn: null,
    terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [] }] } },
    players: zones.map((timeZone, seat) => ({ memberId: `member-${seat}`, seat, dayOne: date, timeZone })), entries: [] };
}

describe("game evening horizon", () => {
  it("waits for Chicago at 8pm even when Chicago already posted", () => {
    const room = state(["America/New_York", "America/Chicago"]);
    const due = () => gameEveningCheckInHorizons([room]).get("2030-03-04")?.toISOString();
    expect(due()).toBe("2030-03-05T02:00:00.000Z");
    room.entries.push({ id: "post", memberId: "member-1", dayIndex: 0, attempt: 1, kind: "words", mediaKeys: [],
      incomplete: false, blurHash: null, withdrawnAt: null, receivedAt: new Date("2030-03-05T01:00:00Z") });
    expect(due()).toBe("2030-03-05T02:00:00.000Z");
  });
  it("treats exactly three hours as far apart and follows daylight saving", () => {
    const winter = new Date("2030-01-04T23:00:00Z");
    expect(gameZoneSpreadHours(["America/New_York", "America/Los_Angeles"], winter)).toBe(GAME_ROOM_FAR_APART_HOURS);
    const before = state(["America/New_York"], "2030-03-09");
    const after = state(["America/New_York"], "2030-03-10");
    expect(gameEveningCheckInHorizons([before]).get("2030-03-09")?.toISOString()).toBe("2030-03-10T01:00:00.000Z");
    expect(gameEveningCheckInHorizons([after]).get("2030-03-10")?.toISOString()).toBe("2030-03-11T00:00:00.000Z");
  });
  it("includes any-days games, which only name someone when today is needed", () => {
    const room = state(["America/New_York"]);
    room.game.terms = { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { count: 3 }, stakes: [] }] };
    expect(gameEveningCheckInHorizons([room]).get("2030-03-04")?.toISOString()).toBe("2030-03-05T01:00:00.000Z");
  });
  it("allows only the thirty-minute window", () => {
    const dueAt = new Date("2030-03-05T02:00:00.000Z");
    expect(gameEveningWindow(dueAt, new Date(dueAt.getTime() - 1))).toBe(false);
    expect(gameEveningWindow(dueAt, dueAt)).toBe(true);
    expect(gameEveningWindow(dueAt, new Date(dueAt.getTime() + 1_800_000))).toBe(false);
  });
});
