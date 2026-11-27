import { describe, expect, it } from "vitest";
import { addDays } from "../../game/time";
import { prepareHealthCandidates, previewHealthCandidate } from "../card-options";
import { dietCandidates } from "./diet";
import { foodTally } from "./foods";
import { generateHealthWins, selectHealthWins, type MealDay } from "./index";

const today = "2034-04-15";

function days(month: string, count: number, proteinG: number | null, fiberG: number | null = null): MealDay[] {
  return Array.from({ length: count }, (_, i) => ({
    date: `${month}-${String(i + 1).padStart(2, "0")}`, proteinG, fiberG,
  }));
}

function cards(meals: MealDay[], asOf = today) {
  return dietCandidates(meals, asOf).map(({ card }) => card);
}

it("dates Diet wins by the completed month, the month so far and the streak end", () => {
  const meals = [
    ...days("2034-01", 25, 40), ...days("2034-02", 24, 40), ...days("2034-03", 25, 40),
    ...days("2034-04", 12, 100, 30),
  ];
  const selected = selectHealthWins({ member: { today, age: null, sex: null, wearableProvider: null }, meals });
  expect(Object.fromEntries(selected.map(({ card, eventDate }) => [card.id, eventDate]))).toEqual({
    "month_total:protein_g:2034-03": "2034-03-31",
    "best_month:protein_g:2034-04": today,
    "streak:fiber_g:20340412": "2034-04-12",
  });
  expect(dietCandidates(meals, today).find(({ card }) => card.kind === "best_month")?.date).toBe("2034-04-12");
});

describe("month_total", () => {
  it("uses independent nutrient coverage in the immediately preceding month, including the 80% boundary", () => {
    const meals = days("2034-04", 24, 92.75, 27);
    meals[0].fiberG = null;
    const totals = (asOf: string) => cards(meals, asOf).filter(card => card.kind === "month_total");
    expect(totals("2034-05-01")).toHaveLength(1);
    expect(totals("2034-05-31")).toMatchObject([{
      id: "month_total:protein_g:2034-04", title: { number: "2,226", measure: "g protein" }, subtitle: "in April",
      source_note: expect.stringContaining("24 of 30 days"), chart: { type: "tally", nutrient: "protein", total: 2226 },
    }]);
    expect(totals("2034-06-01")).toEqual([]);
    meals[0].fiberG = 27;
    expect(totals("2034-05-01").map(card => card.id)).toContain("month_total:fiber_g:2034-04");
  });

  it("drops every quantity and food from a hidden tally", () => {
    const [tally] = generateHealthWins({
      member: { today, age: null, sex: null, wearableProvider: null },
      meals: days("2034-03", 25, 205.6),
    });
    expect(tally).toMatchObject({ kind: "month_total", theme: "diet", chart: { count: 29, partial: 0.56 } });
    const [candidate] = prepareHealthCandidates("tally-fixture", [tally]);
    const hidden = previewHealthCandidate(candidate, "hide_numbers");
    expect(hidden).toMatchObject({
      title: { number: "", measure: "Diet milestone" }, chart: { type: "hidden" }, source_note: "",
    });
    expect(JSON.stringify(hidden)).not.toMatch(/rotisserie|protein|tally|5,140|5140/u);
  });
});

describe("foodTally", () => {
  it("checks the rounded icon count before selecting the first food in order", () => {
    expect(foodTally("protein", 180 * 9.49)?.item.id).toBe("chicken_breast");
    expect(foodTally("protein", 180 * 9.5)?.item.id).toBe("rotisserie_chicken");
    expect(foodTally("protein", 180 * 50.49)?.count).toBe(50);
    expect(foodTally("protein", 180 * 50.5)?.item.id).toBe("thanksgiving_turkey");
    expect(foodTally("protein", 56.99)).toBeNull();
    expect(foodTally("protein", 40_400)).toBeNull();
    let missing = 0;
    for (let grams = 57; grams < 40_400; grams++) {
      if (!foodTally("protein", grams)) missing++;
    }
    expect(missing).toBe(0);
  });

  it("fills the last icon only to the indicated fraction when rounding up", () => {
    expect(foodTally("protein", 180 * 28.56)).toMatchObject({ count: 29, partial: 0.56 });
    expect(foodTally("protein", 180 * 28.3)).toMatchObject({ count: 28, partial: 1 });
    expect(foodTally("fiber", 1050)).toMatchObject({ item: { id: "bread_loaf", perItem: 41 } });
    expect(foodTally("fiber", 21)).toBeNull();
  });
});

describe("Diet best_month", () => {
  const jan = days("2034-01", 25, 48), feb = days("2034-02", 23, 40);
  const mar = days("2034-03", 25, 44), april = days("2034-04", 12, 100);
  const best = (meals: MealDay[], asOf = today) => cards(meals, asOf).find(card => card.kind === "best_month");

  it("requires 14 elapsed days, 80% coverage and three qualifying completed months", () => {
    for (const history of [[], jan, [...jan, ...feb], [...jan, ...feb, ...mar.slice(0, 24)]]) {
      expect(best([...history, ...april])).toBeUndefined();
    }
    const prior = [...jan, ...feb, ...mar];
    expect(best([...prior, ...april], "2034-04-13")).toBeUndefined();
    expect(best([...prior, ...april], "2034-04-14")).toBeDefined();
    expect(best([...prior, ...april.slice(0, 11)])).toBeUndefined();
    expect(best([...prior, ...april])).toMatchObject({
      id: "best_month:protein_g:2034-04", subtitle: "April so far, tied for most this year",
      title: { number: "1,200", measure: "g protein" },
      chart: { unit: "g", highlight: "2034-04", series: [
        { value: 1200 }, { value: 920 }, { value: 1100 }, { value: 1200, days: 12 },
      ] },
    });
  });

  it("uses the prior twelve completed months only when fewer than three qualified this year", () => {
    const previousYear = days("2033-10", 25, 160);
    const huge = days("2033-03", 25, 200);
    const current = days("2034-04", 12, 108);
    expect(best([...previousYear, ...feb, ...mar, ...current])).toBeUndefined();
    expect(best([...previousYear, ...jan, ...feb, ...mar, ...current])?.subtitle).toBe("April so far, most this year");
    expect(best([...huge, ...days("2033-04", 25, 30), ...feb, ...mar, ...current])?.subtitle)
      .toBe("April so far, most in the past 12 months");
  });

  it("orders and labels ties before rounding, including sums of fractional grams", () => {
    const flat = ["01", "02", "03"].flatMap(month => days(`2034-${month}`, 25, 48));
    expect(best([...flat, ...april])?.subtitle).toBe("April so far, tied for most this year");
    expect(best([...flat, ...april].map(row => ({ ...row, proteinG: 0 })))).toBeUndefined();
    const prior = [...days("2034-01", 25, 47.999), ...feb, ...mar];
    expect(best([...prior, ...days("2034-04", 12, 99.999)])).toMatchObject({
      title: { number: "1,200" }, subtitle: "April so far, most this year",
    });
    expect(best([...prior, ...days("2034-04", 12, 99.997)])).toBeUndefined();
  });
});

describe("fiber streak", () => {
  it("counts all known consecutive days even before the monthly comparison history", () => {
    const meals = Array.from({ length: 406 }, (_, index) => ({
      date: addDays(today, index - 405), fiberG: 34, proteinG: null,
    }));
    meals[2].fiberG = 27;
    const streak = cards(meals).find(card => card.kind === "streak");
    expect(streak).toMatchObject({
      title: { number: "403 days" }, chart: { highlight: { start: meals[3].date, end: today } },
    });
  });

  it("uses the full precision daily threshold and breaks on an unknown nutrient day", () => {
    const streak = (meals: MealDay[]) => cards(meals).find(card => card.kind === "streak");
    for (const value of [29.49, 29.5, 29.99]) {
      expect(streak(days("2034-04", 5, 31, value))).toBeUndefined();
    }
    const interrupted = days("2034-04", 9, 31, 30);
    interrupted[4].fiberG = null;
    expect(streak(interrupted)).toBeUndefined();
    expect(streak(days("2034-04", 5, null, 30))).toMatchObject({
      id: "streak:fiber_g:20340405", title: { number: "5 days", measure: "30 g+ fiber" },
      subtitle: "in a row, Apr 1 to 5", chart: { threshold: 30, unit: "g", pills: ["30 g"] },
    });
  });

  it("surrounds the latest longest qualifying run with nine known-or-missing calendar days on each side", () => {
    const month = days("2034-03", 31, null, 25);
    for (const row of month.slice(11, 17)) row.fiberG = 31.25;
    month[6].fiberG = null;
    const streak = cards(month).find(card => card.kind === "streak");
    expect(streak?.chart.highlight).toEqual({ start: "2034-03-12", end: "2034-03-17" });
    expect(streak?.chart.series[0]).toEqual({ date: "2034-03-03", value: 25, passing: false });
    expect(streak?.chart.series.at(-1)?.date).toBe("2034-03-26");
    expect(streak?.chart.series.filter(point => point.passing)).toHaveLength(6);
    expect(streak?.chart.series.some(point => point.date === "2034-03-07")).toBe(false);
    const asOf = cards(month, "2034-03-16").find(card => card.kind === "streak");
    expect(asOf?.chart.series.at(-1)?.date).toBe("2034-03-16");
    expect(cards(month, "2034-05-17").some(card => card.kind === "streak")).toBe(false);
  });
});
