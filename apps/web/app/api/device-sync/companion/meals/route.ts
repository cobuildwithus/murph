import { readCompanionMeals, readMealPage, presentCompanionMeals } from "@/src/lib/device-sync/companion-meals";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const GET = withJsonError(async (request: Request) => {
  const state = await readCompanionMeals(request);
  const { projection, savedAt } = state;
  const { cursor, limit } = readMealPage(request.url);
  const remaining = projection.days.filter(day => cursor === null || day.date < cursor);
  const selected = remaining.slice(0, limit);
  const meals = await presentCompanionMeals(state, selected.flatMap(day => day.meals));
  const byId = new Map(meals.map(meal => [meal.id, meal]));
  const days = selected.map(day => ({ ...day, meals: day.meals.map(meal => byId.get(meal.id)!) }));
  return jsonOk({
    timeZone: projection.timeZone, savedAt, days,
    nextCursor: remaining.length > limit ? days.at(-1)!.date : null,
  });
});
