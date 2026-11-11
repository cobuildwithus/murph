import { describe, expect, it } from "vitest";
import { recapPostedAt, gameLocalDate } from "@/src/lib/game/time";
import { isPairRecapShowEnabled } from "@/src/lib/game/access";

describe("pair show policy", () => {
  it("keeps all producers off by default and groups excluded regardless of roster size", () => {
    expect(isPairRecapShowEnabled(2, {})).toBe(false);
    expect(isPairRecapShowEnabled(2, { MURPH_GAME_RECAP_SHOW_ENABLED: "true" })).toBe(true);
    expect(isPairRecapShowEnabled(10, { MURPH_GAME_RECAP_SHOW_ENABLED: "true" })).toBe(false);
  });
});
describe("receipt times in frozen player zones", () => {
  it.each([
    ["2026-11-01T05:30:00Z", "America/New_York", "2026-11-01T01:30:00-04:00", "2026-10-31"],
    ["2026-11-01T06:30:00Z", "America/New_York", "2026-11-01T01:30:00-05:00", "2026-10-31"],
    ["2026-03-08T07:00:00Z", "America/New_York", "2026-03-08T03:00:00-04:00", "2026-03-08"],
    ["2026-11-10T00:00:00Z", "UTC", "2026-11-10T00:00:00+00:00", "2026-11-09"],
    ["2026-11-10T03:00:00Z", "UTC", "2026-11-10T03:00:00+00:00", "2026-11-10"],
    ["2026-11-10T00:00:00Z", "Asia/Tokyo", "2026-11-10T09:00:00+09:00", "2026-11-10"],
  ])("disambiguates %s in %s", (stamp, zone, local, date) => {
    expect(recapPostedAt(new Date(stamp), zone)).toEqual({ local, timeZone: zone, instant: new Date(stamp).toISOString() });
    expect(gameLocalDate(new Date(stamp), zone)).toBe(date);
  });
});
