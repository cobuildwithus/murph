import type { CompanionMeal, CompanionMealDay } from "@murphai/contracts";
import { expect, it } from "vitest";
import { generateHealthWins } from "../src/lib/health-wins/engine";
import { readHealthWinMeals } from "../src/lib/health-wins/meal-inputs";

function meal(proteinGrams: number | null, fiberGrams?: number | null): CompanionMeal {
  return { proteinGrams, ...(fiberGrams !== undefined && { fiberGrams }),
    id: "meal_fixture", eatenAt: "2026-05-10T12:00:00Z", name: null, calories: null,
    carbsGrams: null, fatGrams: null, uploadId: null };
}

function day(date: string, meals: CompanionMeal[]): CompanionMealDay {
  return { date, meals, mealCount: meals.length, proteinGrams: 97, calories: null,
    calorieMealCount: 0, carbsGrams: null, fatGrams: null };
}

it("keeps full sums per nutrient when every meal reports it, including zero", () => {
  const days = [
    day("2026-05-11", [meal(12.5, 9.75), meal(12.75, 20)]),
    day("2026-05-10", [meal(14), meal(8.25, 5)]),
    day("2026-05-09", [meal(null, 0)]),
    day("2026-05-08", [meal(3, Infinity), meal(NaN, 0)]),
    day("2026-05-12", [meal(20, 12)]),
    day("2026-05-07", []),
    day("2026-05-10", [meal(1.5, 4)]),
  ];
  expect(readHealthWinMeals({ schemaVersion: 1, timeZone: "UTC", days }, "2026-05-11")).toEqual([
    { date: "2026-05-08", proteinG: null, fiberG: null },
    { date: "2026-05-09", proteinG: null, fiberG: 0 },
    { date: "2026-05-10", proteinG: 23.75, fiberG: null },
    { date: "2026-05-11", proteinG: 25.25, fiberG: 29.75 },
  ]);
});

it("accepts a replica without a meal projection", () => {
  expect(readHealthWinMeals(undefined, "2026-05-11")).toEqual([]);
});

it("finds a fiber streak across a newest-first replica", () => {
  const today = "2026-05-15";
  const days = Array.from({ length: 6 }, (_, i) => day(`2026-05-${15 - i}`, [
    meal(8, 18.25), meal(13, i === 5 ? 11.5 : 12.25),
  ]));
  const cards = generateHealthWins({
    member: { today, age: null, sex: null, wearableProvider: null },
    meals: readHealthWinMeals({ schemaVersion: 1, timeZone: "UTC", days }, today),
  });
  expect(cards).toContainEqual(expect.objectContaining({
    id: "streak:fiber_g:20260515", title: { number: "5 days", measure: "30 g+ fiber" },
  }));
});
