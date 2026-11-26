import { describe, expect, it } from "vitest";

import { generateHealthWins } from "./index";
import { chooseSeeYours, seeYoursCard } from "./see-yours";
import type { DailySample, HealthWinRank, HealthWinsInput, LabDraw, Metric } from "./types";

const member: HealthWinsInput["member"] = { today: "2038-08-16", age: 46, sex: "female", wearableProvider: "garmin" };
const latest: LabDraw = {
  analyte: "insulin", unit: "µIU/mL", value: 8.7, fasting: true,
  referenceRange: { low: 3, high: 19 }, date: member.today,
};

function labRank(betterShare: number): HealthWinRank {
  return () => ({
    betterShare, lowerIsBetter: true, source: "Synthetic fasting sample", group: "Women 40 to 49",
    cuts: [{ percentile: 25, value: 7 }, { percentile: 50, value: 11 }],
  });
}

function month(metric: Metric, monthNumber: number, value: number, days = 16): DailySample[] {
  return Array.from({ length: days }, (_, index) => ({
    metric, value, provider: "garmin",
    date: `2038-${String(monthNumber).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`,
  }));
}

describe("See yours detection", () => {
  it("accepts a rank below the suggestion threshold and leads with the value below the median", () => {
    const input = { member, labs: [latest], rank: labRank(69) };
    expect(generateHealthWins(input).map(card => card.kind)).toEqual(["lab_range"]);
    expect(chooseSeeYours(input, "insulin", "lab_change", true)).toEqual({
      card: seeYoursCard(input, "insulin", "percentile"),
    });
    expect(seeYoursCard(input, "insulin", "percentile")).toMatchObject({
      kind: "percentile", measure: "insulin", title: { number: "Top 31%" }, chart: { topPercent: 31 },
    });
    expect(seeYoursCard({ ...input, rank: labRank(38) }, "insulin", "percentile")).toMatchObject({
      title: { number: "8.7 µIU/mL", measure: "insulin" }, chart: { topPercent: 62, value: 8.7 },
    });
  });

  it("prefers the friend's range when the same draw also ranks and falls back to range when it cannot rank", () => {
    const input = { member, labs: [latest], rank: labRank(83) };
    const [suggestion] = generateHealthWins(input);
    expect(generateHealthWins(input)).toHaveLength(1);
    expect(suggestion.kind).toBe("percentile");
    expect(seeYoursCard(input, "insulin", "percentile")).toEqual(suggestion);
    const range = seeYoursCard(input, "insulin", "lab_range");
    expect(range).toMatchObject({ kind: "lab_range", measure: "insulin", theme: "labs", share: { caption_tips: [] } });
    expect(chooseSeeYours(input, "insulin", "lab_range", true)).toEqual({ card: range });
    expect(chooseSeeYours({ ...input, rank: () => null }, "insulin", "percentile", true)).toEqual({ card: range });
  });

  it.each([0, -1300])("admits a trend with a daily step change of %i while keeping the coverage rules", delta => {
    const daily = [...[5, 6, 7].flatMap(number => month("steps", number, 5800)), ...month("steps", 8, 5800 + delta, 14)];
    const input = { member, daily, rank: () => null };
    expect(generateHealthWins(input).some(card => card.kind === "trend_change")).toBe(false);
    const trend = seeYoursCard(input, "steps", "trend_change");
    expect(trend).toMatchObject({ kind: "trend_change", measure: "steps", chart: { baseline: 5800, delta } });
    expect(chooseSeeYours(input, "steps", "percentile", true)).toEqual({ card: trend });
    for (const incomplete of [daily.slice(0, -1), daily.filter(row => !row.date.startsWith("2038-06"))]) {
      expect(chooseSeeYours({ ...input, daily: incomplete }, "steps", "trend_change", true))
        .toEqual({ reason: "not_enough_data" });
    }
  });

  it("can fall back to a trend for floors, which has no suggestion threshold", () => {
    const daily = [5, 6, 7, 8].flatMap(number => month("floors", number, 7));
    const input = { member, daily };
    expect(generateHealthWins(input)).toEqual([]);
    const card = seeYoursCard(input, "floors", "trend_change");
    expect(card).toMatchObject({ kind: "trend_change", measure: "floors", chart: { delta: 0 } });
    expect(chooseSeeYours(input, "floors", "best_month", true)).toEqual({ card });
  });

  it("preserves every unchanged wearable achievement including monthly distance totals", () => {
    const distance = [3, 4, 5, 6, 7, 8].flatMap(number => month("distance_km", number, number === 8 ? 5 : 2));
    const inputs: HealthWinsInput[] = [
      { member, daily: month("sleep_total_min", 8, 495) },
      { member, daily: distance },
    ];
    const compared = new Set<string>();
    for (const input of inputs) {
      for (const card of generateHealthWins(input)) {
        if (!card.measure) continue;
        expect(seeYoursCard(input, card.measure, card.kind)).toEqual(card);
        expect(chooseSeeYours(input, card.measure, card.kind, true)).toEqual({ card });
        compared.add(card.kind);
      }
    }
    expect([...compared].sort()).toEqual(["best_month", "personal_record", "streak", "threshold_count", "trend_change"]);
    expect(seeYoursCard(inputs[1], "distance_km", "cumulative")).toBeNull();
  });

  it("preserves lab-change admission, including compatible prior units and independent dates", () => {
    const labs = [
      { ...latest, value: 16, date: "2038-03-08" },
      { ...latest, value: 14, date: "2038-06-04" }, latest,
    ];
    const input = { member, labs, rank: () => null };
    const [change] = generateHealthWins(input);
    expect(change).toMatchObject({ kind: "lab_change", measure: "insulin" });
    expect(chooseSeeYours(input, "insulin", "lab_change", true)).toEqual({ card: change });
    expect(seeYoursCard(input, "insulin", "lab_change")).toEqual(change);
    expect(generateHealthWins(input).some(card => card.kind === "lab_range")).toBe(false);
    expect(seeYoursCard(input, "insulin", "lab_range")).toMatchObject({ kind: "lab_range" });
    const incompatible = [{ ...labs[0], unit: "pmol/L" }, labs[1], latest];
    expect(seeYoursCard({ ...input, labs: incompatible }, "insulin", "lab_change")).toBeNull();
    expect(chooseSeeYours({ ...input, labs: [...labs, { ...latest, value: 9.1 }] }, "insulin", "lab_change", true))
      .toEqual({ reason: "not_enough_data" });
  });

  it("distinguishes missing observations from observed but ineligible data", () => {
    expect(chooseSeeYours({ member }, "ldl", "lab_change", false)).toEqual({ reason: "no_labs" });
    expect(chooseSeeYours({ member }, "hrv_ms", "trend_change", false)).toEqual({ reason: "no_wearable" });
    expect(chooseSeeYours({ member }, "ldl", "lab_change", true)).toEqual({ reason: "not_enough_data" });
    expect(chooseSeeYours({ member }, "hrv_ms", "trend_change", true)).toEqual({ reason: "not_enough_data" });
  });

  it.each<Partial<LabDraw>>([{ flag: "high" }, { value: 20 }])("withholds every kind for an ineligible latest draw", overrides => {
    const labs = [{ ...latest, date: "2038-05-12" }, { ...latest, ...overrides }];
    const input = { member, labs, rank: labRank(95) };
    expect(chooseSeeYours(input, "insulin", "percentile", true)).toEqual({ reason: "not_enough_data" });
    expect(seeYoursCard(input, "insulin", "lab_range")).toBeNull();
  });

  it("withholds an out-of-range draw when the applicable interval comes from a reviewed serum comparator", () => {
    const draw: LabDraw = { analyte: "ldl", unit: "mg/dL", value: 128, date: member.today, specimen: "serum" };
    const input = { member, labs: [draw], rank: labRank(31) };
    expect(chooseSeeYours(input, "ldl", "percentile", true)).toEqual({ reason: "not_enough_data" });
    expect(seeYoursCard(input, "ldl", "percentile")).toBeNull();
  });

  it.each([
    ["garmin", "oura_sleeping_hr"], ["oura", "oura_sleeping_hr"], ["Apple Watch", "apple_resting_hr"],
  ])("carries the comparison method for %s resting heart rate", (provider, referenceKey) => {
    const daily = month("rhr_bpm", 8, 55).map(row => ({ ...row, provider }));
    const input = { member: { ...member, wearableProvider: provider }, daily };
    const card = seeYoursCard(input, "rhr_bpm", "percentile");
    expect(card).toMatchObject({ kind: "percentile", measure: "rhr_bpm", chart: { unit: "bpm", referenceKey } });
    expect(generateHealthWins(input).find(suggestion => suggestion.kind === "percentile")).toEqual(card);
  });
});
