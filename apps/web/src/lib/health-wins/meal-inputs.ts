import type { CompanionMealsProjection } from "@murphai/contracts";
import type { MealDay } from "./engine/types";

function addGrams(total: number | null, grams: number | null | undefined): number | null {
  if (total === null || grams == null) return null;
  const sum = total + grams;
  return Number.isFinite(sum) ? sum : null;
}

export function readHealthWinMeals(projection: CompanionMealsProjection | undefined, today: string): MealDay[] {
  const totals = new Map<string, MealDay>();
  for (const { date, meals } of projection?.days ?? []) {
    if (date > today || meals.length === 0) continue;
    const day = totals.get(date) ?? { date, proteinG: 0, fiberG: 0 };
    for (const meal of meals) {
      day.proteinG = addGrams(day.proteinG, meal.proteinGrams);
      day.fiberG = addGrams(day.fiberG, meal.fiberGrams);
    }
    totals.set(date, day);
  }
  return [...totals.values()].sort((a, b) => a.date.localeCompare(b.date));
}
