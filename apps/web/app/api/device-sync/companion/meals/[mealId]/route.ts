import { readCompanionMeals, requireProjectedMeal, queueCompanionMealRemoval } from "@/src/lib/device-sync/companion-meals";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

type Context = { params: Promise<{ mealId: string }> };

export const GET = withJsonError(async (request: Request, context: Context) => {
  const { mealId } = await context.params;
  const { projection, savedAt } = await readCompanionMeals(request);
  return jsonOk({ timeZone: projection.timeZone, savedAt, meal: requireProjectedMeal(projection, mealId) });
});

export const DELETE = withJsonError(async (request: Request, context: Context) => {
  const { mealId } = await context.params;
  return jsonOk(await queueCompanionMealRemoval(request, mealId), 202);
});
