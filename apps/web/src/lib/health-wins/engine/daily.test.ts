import { describe, expect, it } from "vitest";

import { dailyCandidates } from "./daily";
import { cleanDaily } from "./daily-clean";
import type { DailySample, Metric } from "./types";

const today = "2032-02-23";
const months = ["2031-11", "2031-12", "2032-01", "2032-02"];

function monthOf(metric: Metric, month: string, average: number, days: number, spread = 0): DailySample[] {
  return Array.from({ length: days }, (_, i) => ({
    metric,
    provider: "garmin",
    date: `${month}-${String(i + 1).padStart(2, "0")}`,
    value: average + (i === days - 1 && days % 2 ? 0 : i % 2 ? spread : -spread),
  }));
}

function fourMonths(metric: Metric, averages: number[], spread: number, days = [15, 15, 15, 14]) {
  return months.flatMap((month, index) => monthOf(metric, month, averages[index], days[index], spread));
}

function cards(series: DailySample[]) {
  return dailyCandidates(cleanDaily(series, today), today).map(candidate => candidate.card);
}

describe("trend_change", () => {
  it("uses the median of three full monthly means and reports the measured sleep gain", () => {
    const sleep = fourMonths("sleep_total_min", [405, 427, 443, 458], 15, [24, 16, 15, 14]);
    const trend = cards(sleep).find(card => card.kind === "trend_change");
    expect(trend?.title).toEqual({ number: "+31 min", measure: "sleep" });
    expect(trend?.subtitle).toBe("a night, vs usual");
    expect(trend?.chart).toMatchObject({
      baseline: 427, delta: 31,
      series: [
        { month: "2031-11", days: 24, value: 405 }, { month: "2031-12", days: 16, value: 427 },
        { month: "2032-01", days: 15, value: 443 }, { month: "2032-02", days: 14, value: 458 },
      ],
    });
  });

  it("keeps sleep gains in whole minutes even when the change exceeds an hour", () => {
    const sleep = fourMonths("sleep_total_min", [390, 414, 430, 486.4], 27);
    expect(cards(sleep).find(card => card.kind === "trend_change")).toMatchObject({
      title: { number: "+72 min", measure: "sleep" }, subtitle: "a night, vs usual",
      chart: { pills: ["Usual 6h 54m", "Feb 8h 6m"] },
    });
  });

  it("supplies the native trend pills in display order", () => {
    const asOf = "2034-11-23";
    const months = ["2034-08", "2034-09", "2034-10", "2034-11"];
    const daily = months.flatMap((month, index) =>
      monthOf("sleep_total_min", month, [421, 433, 447, 489][index], 16, 15));
    const trend = dailyCandidates(cleanDaily(daily, asOf), asOf).find(({ card }) => card.kind === "trend_change");
    expect(trend).toMatchObject({
      date: "2034-11-16", eventDate: asOf, card: { chart: { pills: ["Usual 7h 13m", "Nov 8h 9m"] } },
    });
  });

  it("subtracts the displayed whole minutes for the title and preserves measured chart values", () => {
    const sleep = fourMonths("sleep_deep_min", [69, 83.75, 94, 108.25], 8);
    const trend = cards(sleep).find(card => card.kind === "trend_change");
    expect(trend?.title).toEqual({ number: "+24 min", measure: "deep sleep" });
    expect(trend?.chart.pills).toEqual(["Usual 1h 24m", "Feb 1h 48m"]);
    expect(trend?.chart.delta).toBe(24.5);
  });

  it.each([
    ["rhr_bpm", [60, 62.25, 64, 58.75], 3, "−3 bpm", "Usual 62 bpm", "Feb 59 bpm"],
    ["distance_km", [2.1, 2.46, 2.7, 3.54], 0, "+1.08 km", "Usual 2.46 km", "Feb 3.54 km"],
  ] as const)("matches both pills at the displayed precision for %s", (metric, means, spread, title, usual, current) => {
    const trend = cards(fourMonths(metric, [...means], spread)).find(card => card.kind === "trend_change");
    expect(trend?.title.number).toBe(title);
    expect(trend?.chart.pills).toEqual([usual, current]);
  });

  it("rejects an apparent resting-HR win against one unusually high month", () => {
    expect(cards(fourMonths("rhr_bpm", [58, 66, 58.5, 58], 2))
      .some(card => card.kind === "trend_change")).toBe(false);
  });

  it.each([
    ["sleep_total_min", 418, 15, 10, "a night, vs usual"],
    ["rhr_bpm", 64, -2, 2, "on average, vs usual"], ["hrv_ms", 69, 3, 3, "on average, vs usual"],
    ["steps", 6300, 1000, 500, "a day, vs usual"], ["distance_km", 3, 1, 1, "a day, vs usual"],
  ] as const)("requires a full favorable step for %s", (metric, base, step, spread, subtitle) => {
    const trend = (delta: number) => cards(fourMonths(metric, [base, base, base, base + delta], spread))
      .find(card => card.kind === "trend_change");
    expect(trend(step)?.subtitle).toBe(subtitle);
    expect(trend(0.8 * step)).toBeUndefined();
    expect(trend(-step)).toBeUndefined();
  });

  it("requires 15 days in each immediately preceding month and 14 in the current month", () => {
    for (const days of [[15, 14, 15, 14], [15, 0, 15, 14], [15, 15, 15, 13]]) {
      const samples = [...monthOf("steps", "2031-10", 4400, 24),
        ...fourMonths("steps", [5200, 5200, 5200, 7000], 100, days)];
      expect(cards(samples).some(card => card.kind === "trend_change")).toBe(false);
    }
  });

  it("counts an exact decimal step after averaging differently sized months", () => {
    const series = fourMonths("distance_km", [1.01, 1.01, 1.01, 2.01], 0);
    expect(cards(series).find(card => card.kind === "trend_change")?.title.number).toBe("+1.00 km");
  });
});

describe("best_month", () => {
  const full = ["2031-03", "2031-06", "2031-08", "2031-10", "2032-01"];
  const prior = full.flatMap(month => monthOf("steps", month, 7200, 15));
  const current = monthOf("steps", "2032-02", 7900, 14);

  it("compares six qualifying months within twelve calendar months and labels partial coverage", () => {
    const card = cards([...prior, ...current, ...monthOf("steps", "2031-02", 12000, 15),
      ...monthOf("steps", "2031-12", 11000, 14)]).find(card => card.kind === "best_month");
    expect(card?.subtitle).toBe("February so far, best month in the past 12 months");
    expect(card?.source_note).toContain("so far");
    expect(card?.chart.series.map(month => month.month)).toEqual([...full, "2032-02"]);
    expect(card?.chart.highlight).toBe("2032-02");
  });

  it("skips sparse histories and months that fall short of a prior qualifying best", () => {
    for (const samples of [
      [...prior.slice(15), ...current],
      [...prior, ...current.slice(1)],
      [...prior, ...current, ...monthOf("steps", "2031-12", 7901, 15)],
    ]) {
      expect(cards(samples).some(card => card.kind === "best_month")).toBe(false);
    }
  });

  it("ranks lower resting-HR means first and labels a tie", () => {
    const means = [65, 64, 62, 64, 65];
    const samples = full.flatMap((month, index) => monthOf("rhr_bpm", month, means[index], 15, 2));
    const card = cards([...samples, ...monthOf("rhr_bpm", "2032-02", 62, 14, 2)])
      .find(card => card.kind === "best_month");
    expect(card?.subtitle).toBe("February so far, tied for best month in the past 12 months");
  });

  it("keeps rounding differences from turning flat monthly means into a best", () => {
    const series = [...full, "2032-02"].flatMap(month => monthOf("sleep_efficiency", month, 93.4, month === "2032-02" ? 14 : 15));
    expect(cards(series).some(card => card.kind === "best_month")).toBe(false);
  });

  it.each([
    ["sleep_total_min", 400, 445.8, 18, "7h 26m", "sleep"],
    ["sleep_deep_min", 98, 136.7, 15, "2h 17m", "deep sleep"],
    ["sleep_deep_min", 30, 41.9, 6, "42 min", "deep sleep"],
    ["sleep_score", 82, 88.7, 4, "89", "sleep score"],
    ["rhr_bpm", 62, 56.8, 3, "57 bpm", "RHR"],
    ["steps", 6200, 8567.8, 100, "8,568", "steps"],
  ] as const)("formats the monthly %s headline while preserving the measured mean", (metric, base, value, spread, number, measure) => {
    const daily = [...full.flatMap(month => monthOf(metric, month, base, 16, spread)), ...monthOf(metric, "2032-02", value, 14, spread)];
    const best = cards(daily).find(card => card.kind === "best_month");
    expect(best?.title).toEqual({ number, measure });
    expect(best?.chart.series.at(-1)?.value).toBeCloseTo(value);
  });

  it("compares six qualifying months this year when labeling a calendar-year best", () => {
    const asOf = "2034-06-20";
    const daily = [
      ...monthOf("sleep_score", "2033-12", 89, 18, 3),
      ...["01", "02", "03", "04", "05", "06"].flatMap((month, index) =>
        monthOf("sleep_score", `2034-${month}`, 79 + index, 18, 3)),
    ];
    const best = dailyCandidates(cleanDaily(daily, asOf), asOf).find(({ card }) => card.kind === "best_month");
    expect(best).toMatchObject({ date: "2034-06-18", eventDate: asOf });
    expect(best?.card).toMatchObject({
      title: { number: "84", measure: "sleep score" },
      subtitle: "June so far, best month this year",
    });
  });

  it("compares every recorded monthly distance total this year, including the current partial month", () => {
    const asOf = "2034-09-19";
    const miles = (month: string, dailyMiles: number, days: number) =>
      monthOf("distance_km", month, dailyMiles * 1.609344, days);
    const daily = [
      ...miles("2033-12", 9, 20), ...miles("2034-01", 2.5, 19),
      ...miles("2034-02", 3, 16), ...miles("2034-03", 2, 17), ...miles("2034-04", 1, 15),
      ...miles("2034-05", 4.25, 15), ...miles("2034-07", 2.5, 25),
    ];
    const best = (currentDays: number, history = daily) => dailyCandidates(
      cleanDaily([...history, ...miles("2034-09", 6.75, currentDays)], asOf), asOf,
    ).find(({ card }) => card.kind === "best_month");
    const historical = best(5);
    expect(historical).toMatchObject({ date: "2034-05-15", eventDate: "2034-05-31" });
    expect(historical?.card).toMatchObject({
      title: { number: "64", measure: "miles on foot" }, subtitle: "in May, most this year",
      chart: { unit: "miles", highlight: "2034-05", series: [
        { month: "2034-01", value: 47.5 }, { month: "2034-02", value: 48 },
        { month: "2034-03", value: 34 }, { month: "2034-04", value: 15 }, { month: "2034-05", value: 63.75 },
        { month: "2034-07", value: 62.5 }, { month: "2034-09", value: 33.75 },
      ] },
    });
    expect(best(10)).toBeUndefined();
    const current = best(14);
    expect(current).toMatchObject({ date: "2034-09-14", eventDate: asOf });
    expect(current?.card).toMatchObject({
      title: { number: "95", measure: "miles on foot" }, subtitle: "in September so far, most this year",
    });
    expect(best(1, miles("2034-05", 8, 1))).toBeUndefined();
    expect(best(5, daily.filter(row => !row.date.startsWith("2034-04")))).toBeUndefined();
  });
});

it("cumulative distance includes big days and labels walking and running together", () => {
  const daily = [0.5, 1, 1.5, 1, 0.5, 1, 21].map((value, i): DailySample => ({
    metric: "distance_km", provider: "apple-health-kit", date: `2032-01-0${i + 1}`, value,
  }));
  const card = cards([...daily, { ...daily[0], date: "2031-12-31", value: 8 },
    { ...daily[6], provider: "garmin", value: 19 }]).find(card => card.kind === "cumulative");
  expect(card?.title).toEqual({ number: "16", measure: "miles on foot" });
  expect(card?.subtitle).toBe("walking and running, this year");
  expect(card?.chart.days).toBe(7);
  expect(card?.chart.totalMiles).toBeCloseTo(26.5 / 1.609344);
});
