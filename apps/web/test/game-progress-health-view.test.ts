import { expect, it } from "vitest";
import { addDaysToIsoDate } from "@murphai/contracts";
import { healthView, healthMetricView, savedHealthView, type HealthMetricInput } from "../src/lib/game/progress/health-view";
import { healthMedalFace, healthSteps } from "../src/lib/game/progress/health";
import { rankAge } from "../src/lib/game/progress/norms";

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
  expect(result.next).toEqual({ title: "Next win", detail: "70 bpm", face: { delta: { icon: "heart", text: "↓1" } } });
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
  expect(result.next).toEqual({ title: "Next", detail: "Back to 70 bpm", face: { delta: { icon: "heart", text: "↓2" } } });
});

it("renders seconds once and gives sleep no age comparison", () => {
  const result = healthMetricView({ ...metric, id: "sleep", baseline: 28800, step: 900, direction: 1,
    daily: metric.daily.map(point => ({ ...point, value: 25200 })) }, joinedOn, today, profile);
  expect(result.headline).toBe("Down 60 min");
  expect(result.baseline).toEqual({ value: 28800, text: "8h 00", unit: "seconds" });
  expect(result.age).toBeNull();
  expect(result.next).toMatchObject({ detail: "Back to 8h 15", face: { delta: { icon: "sleep", text: "+15m" } } });
});

it.each([
  ["restingHeartRate", 74, 71, 1, -1, "↓1"],
  ["steps", 6000, 8000, 1000, 1, "+1,000"],
  ["sleep", 24600, 26400, 900, 1, "+15m"],
] as const)("shares the %s face between the next medal and the earned award", (id, baseline, value, step, direction, text) => {
  const daily = metric.daily.map(point => ({ ...point, value }));
  const next = healthMetricView({ ...metric, id, baseline, daily, step, direction }, joinedOn, today, profile).next!;
  const candidate = healthSteps({ metric: id, joinedOn, baseline, means: daily, profile, step, direction })[0];
  expect(next.face).toEqual(candidate.data.face);
  expect(next.face).toMatchObject({ delta: { text } });
});

it.each([[1400, "+1,400"], [2000, "+2,000"], [12000, "+12k"]])("formats a %s Steps face through D20", (amount, text) => {
  expect(healthMedalFace("steps", amount)).toEqual({ delta: { icon: "steps", text } });
});

it.each([
  ["restingHeartRate", 74, 72, 1, -1, "Down 2 bpm", "71 bpm"],
  ["steps", 6000, 8000, 1000, 1, "Up 2,000 a day", "9,000 a day"],
  ["sleep", 24600, 26400, 900, 1, "Up 30 min", "7h 35"],
] as const)("builds saved %s tiles and targets through the normal presenter", (id, baseline, value, step, direction, headline, detail) => {
  const daily = metric.daily.map(point => ({ ...point, value }));
  const wins = healthSteps({ metric: id, joinedOn, baseline, means: daily, profile, step, direction })
    .map((award, index) => ({ ...award, id: `saved-${index}`, createdAt: new Date(`${today}T12:00:00Z`), seenAt: null }));
  const input = { id, baseline, daily, step, direction, wins };
  const normal = healthMetricView(input, joinedOn, today, profile);
  const saved = savedHealthView(joinedOn, today, [{ ...input, daily: [] }]).metrics[0];
  expect(saved).toMatchObject({ headline, wins: normal.wins, next: { ...normal.next, detail } });
  expect(savedHealthView(joinedOn, today, [{ ...input, daily: [], wins: [] }]).metrics[0].headline).toBeNull();
  expect(savedHealthView(joinedOn, today, [{ ...input, daily: [], baseline: null }]).metrics[0].next).toBeNull();
});

it.each(["restingHeartRate", "steps"] as const)("uses the same age/sex table's median for %s", id => {
  const result = healthMetricView({ ...metric, id }, joinedOn, today, profile);
  const rank = rankAge(id, result.age!.current.value, profile, "Apple Watch")!;
  expect(result.age!.typical!.value).toBe(rank.cuts.find(cut => cut.percentile === 50)!.value);
  expect(healthMetricView({ ...metric, id }, joinedOn, today, { ...profile, age: null }).age).toBeNull();
  expect(healthMetricView({ ...metric, id }, joinedOn, today, { ...profile, sex: null }).age).toBeNull();
});

it("keeps missing health empty rather than a zero trend", () => {
  const result = healthMetricView({ ...metric, daily: [], baseline: null }, joinedOn, today, profile);
  expect(result).toMatchObject({ access: "missing", headline: "Not enough data yet", baseline: null, next: null, age: null });
  expect(result.daily.every(([, value]) => value === null)).toBe(true);
  // The whole replica year, so a chart's span before joining has its history.
  expect(result.daily).toHaveLength(365);
  expect(result.daily[0][0]).toBe(addDaysToIsoDate(today, -364));
});

it("does not call an old complete window the current fourteen-day mean", () => {
  const result = healthMetricView({ ...metric, daily: metric.daily.map(point => ({ ...point, date: addDaysToIsoDate(point.date, -20) })) },
    joinedOn, today, profile);
  expect(result.headline).toBe("Not enough data yet");
  expect(result.age).toBeNull();
});


it.each([
  ["phone only", "steps", "2026-11-16", null, "missing"],
  ["recent heart rate", "restingHeartRate", "2026-11-16", null, "off"],
  ["old wearable", "restingHeartRate", "2026-11-09", null, "missing"],
  ["future wearable", "restingHeartRate", "2026-11-17", null, "missing"],
  ["sleep at the boundary", "restingHeartRate", "2026-11-16", "2026-11-10", "ok"],
  ["sleep outside the boundary", "restingHeartRate", "2026-11-16", "2026-11-09", "off"],
  ["old sleep on a stale wearable", "restingHeartRate", "2026-11-09", "2026-11-09", "ok"],
] as const)("derives sleep access from seven dates: %s", (_name, id, date, sleepDate, access) => {
  const point = (date: string) => ({ ...metric.daily[0], date });
  const result = healthView({ joinedOn, today, profile, sums: [],
    snapshot: { timeZone: "UTC", savedAt: `${today}T12:00:00Z`, freshness: "fresh", demographics: null, heightCm: null,
      window: { from: "2025-11-17", through: today }, stepsWindow: { from: "2025-11-17", through: today },
      numbers: { restingHeartRate: null, vo2Max: null, sleep: null, steps: null } },
    metrics: [{ ...metric, id, daily: [point(date)] }, { ...metric, id: "sleep", daily: sleepDate ? [point(sleepDate)] : [] }],
  });
  expect(result.metrics.find(item => item.id === "sleep")!.access).toBe(access);
});
