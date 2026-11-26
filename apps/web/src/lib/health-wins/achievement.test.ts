import { afterEach, expect, it, vi } from "vitest";
import { readHealthWinIdentities } from "./achievement";
import type { HealthWinAchievement } from "./engine";

const record: HealthWinAchievement = { kind: "personal_record", subject: "steps", period: "2032-12-30" };
const today = "2033-01-01";

function useFixtureKey(version = "v1", value = 17) {
  vi.stubEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", version);
  vi.stubEnv("HOSTED_CONTACT_PRIVACY_KEYS", version + ":" + Buffer.alloc(32, value).toString("base64"));
}

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("uses local calendar days and months across year and leap-day boundaries", () => {
  useFixtureKey();
  const observations = readHealthWinIdentities("fixture-a", [
    record, { ...record, period: "2032-12-29" }, { ...record, period: "2033-01-02" },
    { kind: "sessions", subject: "walk", period: "2033-01" },
    { kind: "best_month", subject: "distance_km", period: "2032-12" },
    { kind: "experiment_result", subject: "garden-break", period: "2031-05-12" },
  ], today);
  expect(observations?.items.map(item => item.fresh)).toEqual([true, false, false, true, false, true]);
  const lab: HealthWinAchievement = { kind: "lab_change", subject: "ldl", period: "2032-02-29" };
  const draws = readHealthWinIdentities("fixture-a", [lab, { ...lab, kind: "lab_percentile", period: "2032-02-28" }], "2032-05-28");
  expect(draws?.items.map(item => item.fresh)).toEqual([true, false]);
});

it("separates link and suppression purposes, members and key versions", () => {
  useFixtureKey();
  const initial = readHealthWinIdentities("fixture-a", [record, record], today)!;
  const [first, repeated] = initial.items;
  expect(first).toEqual(repeated);
  expect(first.winRef).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  expect(first.seenKey).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  expect(first.winRef).not.toBe(first.seenKey);
  const other = readHealthWinIdentities("fixture-b", [record], today)!.items[0];
  expect(first.winRef).not.toBe(other.winRef);
  expect(first.seenKey).not.toBe(other.seenKey);
  useFixtureKey("v2", 19);
  const rotated = readHealthWinIdentities("fixture-a", [record], today)!;
  expect(rotated.version).not.toBe(initial.version);
  expect(rotated.items[0].winRef).not.toBe(first.winRef);
  expect(rotated.items[0].seenKey).not.toBe(first.seenKey);
});

it("returns no observations when a key is unavailable and logs only its error class", () => {
  vi.stubEnv("HOSTED_CONTACT_PRIVACY_KEYS", "");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(readHealthWinIdentities("fixture-a", [record], today)).toBeNull();
  expect(warn).toHaveBeenCalledWith("Health win achievement keys unavailable.", { errorClass: "TypeError" });
});
