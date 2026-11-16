import { expect, it } from "vitest";
import { addDaysToIsoDate } from "@murphai/contracts";
import { healthMetricView, type HealthMetricInput } from "../src/lib/game/progress/health-view";

const joinedOn = "2026-10-21", today = "2026-11-16";
const profile = { age: 35, sex: "female" as const };
const metric: HealthMetricInput = { id: "restingHeartRate", baseline: 70.51, step: 1, direction: -1, wins: [],
  daily: Array.from({ length: 14 }, (_, index) => ({ date: addDaysToIsoDate(today, index - 13), value: 69.53,
    source: "Apple Watch", observedAt: `${today}T12:00:00Z` })) };

it("uses raw means for direction and next win, rounding only presentation", () => {
  const result = healthMetricView(metric, joinedOn, today, profile);
  expect(result.headline).toBe("Down 1 bpm");
  expect(result.baseline).toEqual({ value: 70.51, text: "71", unit: "bpm" });
  expect(result.wins).toEqual([]);
  expect(result.next).toEqual({ title: "Next win", detail: "70 bpm" });
  expect(result.daily.filter(([, value]) => value === null)).not.toHaveLength(0);
  expect(result.age?.current.value).toBeCloseTo(69.53);
});

it("a worse reading preserves the earned win and points to the next unearned level", () => {
  const result = healthMetricView({ ...metric, baseline: 72,
    daily: metric.daily.map(point => ({ ...point, value: 75 })),
    wins: [{ id: "medal-heart-1", key: "health:restingHeartRate:1", kind: "health", measureId: "restingHeartRate",
      subjectMemberId: null, on: "2026-11-01", createdAt: new Date("2026-11-01T12:00:00Z"), seenAt: null,
      data: { level: 1, amount: 1, title: "Resting HR down 1 bpm" } }] }, joinedOn, today, profile);
  expect(result.direction).toBe("worse");
  expect(result.wins[0]).toMatchObject({ medalId: "medal-heart-1", on: "2026-11-01", title: "Down 1" });
  expect(result.next).toEqual({ title: "Next", detail: "Back to 70 bpm" });
});

it("renders seconds once and gives sleep no age comparison", () => {
  const result = healthMetricView({ ...metric, id: "sleep", baseline: 28800, step: 900, direction: 1,
    daily: metric.daily.map(point => ({ ...point, value: 25200 })) }, joinedOn, today, profile);
  expect(result.headline).toBe("Down 60 min");
  expect(result.baseline).toEqual({ value: 28800, text: "8h 00", unit: "seconds" });
  expect(result.age).toBeNull();
});

it("keeps missing health empty rather than a zero trend", () => {
  const result = healthMetricView({ ...metric, daily: [], baseline: null }, joinedOn, today, profile);
  expect(result).toMatchObject({ access: "missing", headline: "Not enough data yet", baseline: null, next: null, age: null });
  expect(result.daily.every(([, value]) => value === null)).toBe(true);
});

it("does not call an old complete window the current fourteen-day mean", () => {
  const result = healthMetricView({ ...metric, daily: metric.daily.map(point => ({ ...point, date: addDaysToIsoDate(point.date, -20) })) },
    joinedOn, today, profile);
  expect(result.headline).toBe("Not enough data yet");
  expect(result.age).toBeNull();
});
