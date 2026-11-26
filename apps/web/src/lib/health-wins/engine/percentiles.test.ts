import { describe, expect, it, vi } from "vitest";
import { generateHealthWins } from "./index";
import type { DailySample, HealthWinRank, HealthWinsInput, Metric } from "./types";

const member: HealthWinsInput["member"] = { today: "2033-04-18", age: 44, sex: "female", wearableProvider: "whoop" };
function series(metric: Metric, value: number, provider = "whoop"): DailySample[] {
  return Array.from({ length: 14 }, (_, i) => ({ metric, value, provider, date: `2033-04-${String(i + 5).padStart(2, "0")}` }));
}
const comparison = {
  group: "Women 40 to 49", source: "Synthetic comparison cohort",
  cuts: [{ percentile: 50, value: 26 }, { percentile: 90, value: 49 }], lowerIsBetter: false,
};
function cards(daily: DailySample[], rank: HealthWinRank) {
  return generateHealthWins({ member, daily, rank }).filter(card => card.kind === "percentile");
}

describe("wearable percentiles", () => {
  it("keeps arrows out of chart labels and source notes supplied by a ranker", () => {
    const [card] = cards(series("vo2max", 43), () => ({ ...comparison, betterShare: 79,
      group: "Age band ➜ adults", source: "Cohort --> validation sample" }));
    expect(card.chart.group).toBe("Age band adults");
    expect(card.subtitle).toContain(card.chart.group);
    expect(card.source_note).toContain("Cohort validation sample");
  });

  it.each([
    ["vo2max", 46.2], ["rhr_bpm", 55.7], ["steps", 8890.6],
  ] as const)("29. describes the cohort in the subtitle and keeps the precise %s value in the chart", (metric, value) => {
    const [card] = cards(series(metric, value), () => ({ ...comparison, betterShare: 82 }));
    expect(card.subtitle).toBe("for women in their 40s");
    expect(card.chart.value).toBeCloseTo(value);
  });

  it.each([
    ["Men 18 to 19", "for men 18 to 19"], ["Women 70 and over", "for women 70 and over"],
  ])("keeps the full extent of the %s cohort", (group, subtitle) => {
    const [card] = cards(series("steps", 6400), () => ({ ...comparison, group, betterShare: 81 }));
    expect(card.subtitle).toBe(subtitle);
  });

  it("12. audit 7 offers the top 30% before rounding and labels the exact whole percentage", () => {
    const daily = series("vo2max", 40);
    function at(betterShare: number) {
      return cards(daily, () => ({ ...comparison, betterShare }));
    }
    expect(at(69.99)).toEqual([]);
    for (const [share, topPercent] of [[70, 30], [74, 26], [74.2, 26], [99, 1], [100, 1]]) {
      expect(at(share)).toMatchObject([{
        title: { number: `Top ${topPercent}%`, measure: "VO2 max" },
        chart: { topPercent, value: 40, group: comparison.group, cuts: comparison.cuts },
        source_note: expect.stringContaining(comparison.source),
      }]);
    }
    expect(cards(daily, () => null)).toEqual([]);
  });

  it("12. audit 8 passes the contributing RHR window and member's wearable to the ranker", () => {
    const days = series("rhr_bpm", 52, "garmin");
    days[13] = { ...days[13], provider: "oura" };
    const rank = vi.fn<HealthWinRank>(() => ({ ...comparison, betterShare: 73, lowerIsBetter: true }));
    expect(cards([{ ...days[0], date: "2033-04-04" }, ...days], rank)).toMatchObject([{
      title: { number: "Top 27%" }, chart: { lowerIsBetter: true },
    }]);
    expect(rank).toHaveBeenCalledExactlyOnceWith("restingHeartRate", 52, { member, unit: "bpm", daily: days });
  });

  it("12. sends a covered mean for daily steps and the latest individual VO2 estimate", () => {
    const rank = vi.fn<HealthWinRank>(() => null);
    const days = series("steps", 3000).slice(4);
    days[9] = { ...days[9], value: 4000 };
    cards(days.slice(1), rank);
    expect(rank).not.toHaveBeenCalled();
    cards(days, rank);
    expect(rank).toHaveBeenCalledExactlyOnceWith("steps", 3100, { member, unit: "steps", daily: days });

    rank.mockClear();
    const daily = [{ ...series("vo2max", 33)[0], date: "2033-02-08" }, ...series("vo2max", 42).slice(-1)];
    cards([...daily, ...series("hrv_ms", 155)], rank);
    expect(rank).toHaveBeenCalledExactlyOnceWith("vo2Max", 42, { member, unit: "mL/kg/min", daily: daily.slice(-1) });
  });
});
