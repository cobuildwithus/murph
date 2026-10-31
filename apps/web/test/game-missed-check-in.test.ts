import { describe, expect, it } from "vitest";
import { canScheduleMissedDayCheckIn, firstDatesOfMissRuns, isMissedCheckInDueNow, missedCheckInDueAt, visitGameMissedCheckInPages, type MissedCheckInDay } from "@/src/lib/game/missed-check-in";

describe("game missed-day check-ins", () => {
  it("folds consecutive misses and breaks runs on off, incomplete, posted and open days", () => {
    const days: MissedCheckInDay[] = [
      { date: "2030-03-01", status: "missed" }, { date: "2030-03-02", status: "missed" },
      { date: "2030-03-03", status: "off" }, { date: "2030-03-04", status: "missed" },
      { date: "2030-03-05", status: "incomplete" }, { date: "2030-03-06", status: "missed" },
      { date: "2030-03-07", status: "posted" }, { date: "2030-03-08", status: "open" },
    ];
    expect(firstDatesOfMissRuns(days)).toEqual([
      { firstMissedDate: "2030-03-01", missedDates: ["2030-03-01", "2030-03-02", "2030-03-04"] },
      { firstMissedDate: "2030-03-06", missedDates: ["2030-03-06"] },
    ]);
  });
  it("schedules 9 AM in the frozen player time zone", () => {
    expect(missedCheckInDueAt("2030-03-04", "America/New_York")?.toISOString()).toBe("2030-03-05T14:00:00.000Z");
  });
  it("requires a live bound room and a scheduled-weekday game", () => {
    expect(canScheduleMissedDayCheckIn({ boundRoomId: "room", gameStatus: "live", schedule: { days: [0, 1, 2] } })).toBe(true);
    expect(canScheduleMissedDayCheckIn({ boundRoomId: null, gameStatus: "live", schedule: { days: [0, 1, 2] } })).toBe(false);
    expect(canScheduleMissedDayCheckIn({ boundRoomId: "room", gameStatus: "settled", schedule: { days: [0, 1, 2] } })).toBe(false);
    expect(canScheduleMissedDayCheckIn({ boundRoomId: "room", gameStatus: "live", schedule: { count: 3 } })).toBe(false);
  });
  it("admits only the two-hour delivery window and never backfills stale misses", () => {
    const dueAt = new Date("2030-03-05T14:00:00.000Z");
    expect(isMissedCheckInDueNow({ dueAt, now: new Date("2030-03-05T13:59:59.999Z") })).toBe(false);
    expect(isMissedCheckInDueNow({ dueAt, now: new Date("2030-03-05T16:00:00.000Z") })).toBe(true);
    expect(isMissedCheckInDueNow({ dueAt, now: new Date("2030-03-05T16:00:00.001Z") })).toBe(false);
  });
  it("visits every keyset page so games after the first 100 cannot starve", async () => {
    const source = Array.from({ length: 205 }, (_, index) => `game-${String(index).padStart(3, "0")}`);
    const visited: string[] = [];
    await visitGameMissedCheckInPages({
      readPage: async (cursor, limit) => source.filter((id) => id > cursor).slice(0, limit),
      visit: async (ids) => { visited.push(...ids); },
    });
    expect(visited).toEqual(source);
  });
});
