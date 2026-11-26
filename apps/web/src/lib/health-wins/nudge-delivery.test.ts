import { describe, expect, it } from "vitest";
import { healthWinTextKeys, healthWinTextWindow, parseHealthWinTextKey } from "./nudge-delivery";

const day = "2032-05-08";
const memberId = "test-founder";
const keys = healthWinTextKeys(memberId, day);

describe("health win delivery keys", () => {
  it.each([keys.base, keys.mailbox, `${keys.base}:link`, `${keys.base}:link:fallback`, `${keys.base}:fallback`,
    `${keys.base}:bubble:0`, `${keys.base}:bubble:12:link:fallback`])("resolves %s back to the daily wake", value => {
    expect(parseHealthWinTextKey(value)).toEqual({ memberId, day, ...keys });
  });
  it.each([`${keys.mailbox}:link`, `${keys.base}:other`, `${keys.base}:bubble:-2`, `${keys.base}:link:link`,
    "health-win:v1::2032-05-08", "health-win:v1:test:2032-04-31", "other:v1:test:2032-05-08"])("rejects %s", value => {
    expect(parseHealthWinTextKey(value)).toBeNull();
  });
});

describe("local health win dispatch window", () => {
  it.each([
    ["2032-05-08T16:59:59.999Z", false], ["2032-05-08T17:00:00.000Z", true],
    ["2032-05-08T20:29:59.999Z", true], ["2032-05-08T20:30:00.000Z", false],
  ])("applies the same start and exclusive end at %s", (at, inside) => {
    expect(healthWinTextWindow(new Date(at), "America/Los_Angeles")).toEqual(inside ? {
      day, expiresAt: new Date("2032-05-08T20:30:00.000Z"),
    } : null);
  });
  it("uses the current profile zone, including fractional offsets", () => {
    const at = new Date("2032-01-02T04:15:00Z");
    expect(healthWinTextWindow(at, "Asia/Kathmandu")).toEqual({ day: "2032-01-02", expiresAt: new Date("2032-01-02T07:45:00Z") });
    expect(healthWinTextWindow(at, "UTC")).toBeNull();
    expect(healthWinTextWindow(at, "invalid-zone")).toBeNull();
  });
});
