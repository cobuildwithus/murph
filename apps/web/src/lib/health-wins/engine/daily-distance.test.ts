import { expect, it } from "vitest";

import { dailyDistanceAlternative } from "./daily-distance";
import { generateHealthWins, type CardKind, type DailySample } from "./index";

const member = { today: "2038-06-19", age: null, sex: null, wearableProvider: null };

it("converts on-foot headlines and measured chart values from the detected history", () => {
  const daily = ["01", "02", "03", "04", "05", "06"].flatMap(month =>
    Array.from({ length: 16 }, (_, index): DailySample => ({
      metric: "distance_km", provider: "apple", date: `2038-${month}-${String(index + 1).padStart(2, "0")}`,
      value: month === "06" ? 4.5 : 2,
    })),
  );
  const cards = generateHealthWins({ member, daily });
  function views(kind: CardKind) {
    const card = cards.find(candidate => candidate.kind === kind)!;
    return [card, dailyDistanceAlternative(card)!.card];
  }
  const [milesTotal, kmTotal] = views("cumulative");
  expect(milesTotal.title).toEqual({ number: "144", measure: "miles on foot" });
  expect(kmTotal.title).toEqual({ number: "232", measure: "km on foot" });
  expect(kmTotal.chart).toEqual(milesTotal.chart);

  const [milesMonth, kmMonth] = views("best_month");
  expect(milesMonth.title).toEqual({ number: "45", measure: "miles on foot" });
  expect(kmMonth).toMatchObject({ title: { number: "72", measure: "km on foot" }, chart: {
    unit: "km", highlight: "2038-06", series: [32, 32, 32, 32, 32, 72].map(n => ({ value: expect.closeTo(n) })),
  } });
  const [milesRecord, kmRecord] = views("personal_record");
  expect(milesRecord.title).toEqual({ number: "3", measure: "miles on foot" });
  expect(kmRecord).toMatchObject({ title: { number: "5", measure: "km on foot" }, chart: {
    unit: "km", highlight: { value: expect.closeTo(4.5) }, series: daily.map(row => ({ value: expect.closeTo(row.value) })),
  } });

  const [kmTrend, milesTrend] = views("trend_change");
  expect(kmTrend).toMatchObject({ title: { number: "+2.50 km" }, chart: { pills: ["Usual 2.00 km", "Jun 4.50 km"] } });
  expect(milesTrend).toMatchObject({ title: { number: "+1.56 mi" }, chart: {
    pills: ["Usual 1.24 mi", "Jun 2.80 mi"], baseline: expect.closeTo(2 / 1.609344), delta: expect.closeTo(2.5 / 1.609344),
  } });
});

it("converts both experiment means and preserves their windows", () => {
  const [metric] = generateHealthWins({ member, experiments: [{
    slug: "stair-break", title: "Stair break", metric: "distance_km",
    baseline: { start: "2038-05-06", end: "2038-05-12" }, intervention: { start: "2038-05-13", end: "2038-05-19" },
    baselineMean: 3.5, interventionMean: 6.25, adherence: { done: 6, target: 7 }, expectedDirection: "increase",
  }] });
  expect(metric.chart).toMatchObject({ unit: "km", series: [{ mean: 3.5 }, { mean: 6.25 }] });
  expect(dailyDistanceAlternative(metric)).toMatchObject({ units: "miles", card: {
    title: metric.title, chart: { unit: "mi", series: [
      { label: "Before", start: "2038-05-06", mean: expect.closeTo(3.5 / 1.609344) },
      { label: "During", start: "2038-05-13", mean: expect.closeTo(6.25 / 1.609344) },
    ] },
  } });
});
