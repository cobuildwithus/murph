import { expect, it } from "vitest";
import { addDaysToIsoDate } from "@murphai/contracts";
import { healthView, healthMetricView, type HealthMetricInput } from "../src/lib/game/progress/health-view";
import { rankAge } from "../src/lib/game/progress/norms";

const joinedOn = "2026-10-21", today = "2026-11-16";
const profile = { age: 35, sex: "female" as const };
const metric: HealthMetricInput = { id: "restingHeartRate", baseline: 70.51, baselineSource: "Apple Watch", direction: -1,
  daily: Array.from({ length: 14 }, (_, index) => ({ date: addDaysToIsoDate(today, index - 13), value: 69.53,
    source: "Apple Watch", observedAt: `${today}T12:00:00Z` })) };

it("uses raw means for direction and next win, rounding only presentation", () => {
  const result = healthMetricView(metric, joinedOn, today, profile);
  expect(result.headline).toBe("Down 1 bpm");
  expect(result.baseline).toEqual({ value: 70.51, text: "71", unit: "bpm" });
  expect(result.wins).toEqual([]);
  expect(result.next).toBeNull();
  expect(result.daily.filter(([, value]) => value === null)).not.toHaveLength(0);
  expect(result.age?.current.value).toBeCloseTo(69.53);
});

it("renders seconds once and gives sleep no age comparison", () => {
  const result = healthMetricView({ ...metric, id: "sleep", baseline: 28800, direction: 1,
    daily: metric.daily.map(point => ({ ...point, value: 25200 })) }, joinedOn, today, profile);
  expect(result).toMatchObject({ headline: "7h 00m a night", change: "Down 60 min since joining", direction: "worse" });
  expect(result.baseline).toEqual({ value: 28800, text: "8h 00", unit: "seconds" });
  expect(result.age).toBeNull();
  expect(result.next).toBeNull();
});

const sleep = { ...metric, id: "sleep" as const, baseline: 25620, direction: 1 };
const nights = (values: number[], last = today) => values.map((value, index) =>
  ({ ...metric.daily[0], date: addDaysToIsoDate(last, index - values.length + 1), value }));

it("leads sleep with the last 7 nights' average and puts the change since joining under it", () => {
  const result = healthMetricView({ ...sleep, daily: nights([...Array(7).fill(28320), 27720, 28920, 27720, 28920, 28320, 28320, 28320]) },
    joinedOn, today, profile);
  expect(result).toMatchObject({ headline: "7h 52m a night", change: "Up 45 min since joining", direction: "better" });
  expect(healthMetricView({ ...sleep, daily: nights(Array(14).fill(25620)) }, joinedOn, today, profile))
    .toMatchObject({ headline: "7h 07m a night", change: "No change since joining", direction: "flat" });
});

it("shows sleep's hours without a change line before there is a baseline", () => {
  const result = healthMetricView({ ...sleep, baseline: null, daily: nights(Array(14).fill(28320)) }, joinedOn, today, profile);
  expect(result).toMatchObject({ headline: "7h 52m a night", change: null, next: null });
});

it("averages the 7 days to the latest night, where the chart's average line ends", () => {
  // Last night isn't in yet: the line ends yesterday and reaches back to the 8th day ago.
  const daily = nights([21600, ...Array(6).fill(28800)], addDaysToIsoDate(today, -1));
  expect(healthMetricView({ ...sleep, daily }, joinedOn, today, profile).headline).toBe("7h 43m a night");
  const old = healthMetricView({ ...sleep, daily: nights([28800], addDaysToIsoDate(today, -7)) }, joinedOn, today, profile);
  expect(old).toMatchObject({ headline: "Not enough data yet", change: null });
});

it("keeps resting HR and steps headlines as the change, with no line under them", () => {
  expect(healthMetricView(metric, joinedOn, today, profile)).toMatchObject({ headline: "Down 1 bpm", change: null });
  expect(healthMetricView({ ...metric, id: "steps", baseline: 6000, direction: 1,
    daily: metric.daily.map(point => ({ ...point, value: 8000 })) }, joinedOn, today, profile))
    .toMatchObject({ headline: "Up 2,000 a day", change: null });
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
    snapshot: { timeZone: "UTC", savedAt: `${today}T12:00:00Z`, freshness: "fresh", demographics: null, heightCm: null, weightKg: null,
      window: { from: "2025-11-17", through: today }, stepsWindow: { from: "2025-11-17", through: today },
      numbers: { restingHeartRate: null, vo2Max: null, sleep: null, steps: null }, runs: null },
    metrics: [{ ...metric, id, daily: [point(date)] }, { ...metric, id: "sleep", daily: sleepDate ? [point(sleepDate)] : [] }],
  });
  expect(result.metrics.find(item => item.id === "sleep")!.access).toBe(access);
});

it("supplies the drawer with the same sleep comparison used for the change since joining", () => {
  const model = healthMetricView({ ...sleep, baseline: 8 * 3600,
    daily: nights([...Array(7).fill(5 * 3600), ...Array(7).fill(9 * 3600)]) }, joinedOn, today, profile);
  expect(model).toMatchObject({ headline: "9h 00m a night", direction: "worse", change: "Down 60 min since joining",
    comparisonValue: 7 * 3600 });
});
