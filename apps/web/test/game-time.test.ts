import { describe, expect, it } from "vitest";

import {
  addDays,
  dayStartInstant,
  daysBetween,
  gameLocalDate,
  weekdayOf,
} from "@/src/lib/game/time";

describe("weekly game time", () => {
  it("starts each day at 3am local, so 2:59am still belongs to yesterday", () => {
    // 2026-10-17 02:59 and 03:00 in New York (EDT, UTC-4).
    expect(gameLocalDate(new Date("2026-10-17T06:59:00Z"), "America/New_York")).toBe("2026-10-16");
    expect(gameLocalDate(new Date("2026-10-17T07:00:00Z"), "America/New_York")).toBe("2026-10-17");
    expect(dayStartInstant("2026-10-17", "America/New_York").toISOString()).toBe("2026-10-17T07:00:00.000Z");
  });

  it("gives New York and Sydney their own local dates for one instant", () => {
    const instant = new Date("2026-10-17T00:00:00Z");
    expect(gameLocalDate(instant, "America/New_York")).toBe("2026-10-16");
    expect(gameLocalDate(instant, "Australia/Sydney")).toBe("2026-10-17");
    // Sydney is on daylight time (UTC+11) in October: 3am local is 16:00Z the day before.
    expect(dayStartInstant("2026-10-17", "Australia/Sydney").toISOString()).toBe("2026-10-16T16:00:00.000Z");
  });

  it("handles the date line: Auckland and Honolulu are nearly a day apart", () => {
    const instant = new Date("2026-10-16T20:00:00Z");
    expect(gameLocalDate(instant, "Pacific/Auckland")).toBe("2026-10-17");
    expect(gameLocalDate(instant, "Pacific/Honolulu")).toBe("2026-10-16");
    expect(dayStartInstant("2026-10-17", "Pacific/Auckland").toISOString()).toBe("2026-10-16T14:00:00.000Z");
    expect(dayStartInstant("2026-10-17", "Pacific/Honolulu").toISOString()).toBe("2026-10-17T13:00:00.000Z");
  });

  it("keeps 3am boundaries right across DST changes (25- and 23-hour days)", () => {
    const fallBackDay = dayStartInstant("2026-11-01", "America/New_York").getTime()
      - dayStartInstant("2026-10-31", "America/New_York").getTime();
    expect(fallBackDay).toBe(25 * 60 * 60 * 1000);
    expect(dayStartInstant("2026-11-01", "America/New_York").toISOString()).toBe("2026-11-01T08:00:00.000Z");
    const springForwardDay = dayStartInstant("2026-03-08", "America/New_York").getTime()
      - dayStartInstant("2026-03-07", "America/New_York").getTime();
    expect(springForwardDay).toBe(23 * 60 * 60 * 1000);
    // The fall-back night repeats 1am-2am; both passes still belong to Oct 31.
    expect(gameLocalDate(new Date("2026-11-01T06:30:00Z"), "America/New_York")).toBe("2026-10-31");
    expect(gameLocalDate(new Date("2026-11-01T07:30:00Z"), "America/New_York")).toBe("2026-10-31");
  });

  it("does plain date math on local dates", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-10-17", "2026-10-24")).toBe(7);
    expect(weekdayOf("2026-10-19")).toBe(0);
    expect(weekdayOf("2026-10-25")).toBe(6);
  });
});
