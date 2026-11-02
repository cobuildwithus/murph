import { readCompanionMeals, readMealPage } from "@/src/lib/device-sync/companion-meals";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const GET = withJsonError(async (request: Request) => {
  const { projection, savedAt } = await readCompanionMeals(request);
  const { cursor, limit } = readMealPage(request.url);
  const remaining = projection.days.filter(day => cursor === null || day.date < cursor);
  const days = remaining.slice(0, limit);
  return jsonOk({
    timeZone: projection.timeZone, savedAt, days,
    nextCursor: remaining.length > limit ? days.at(-1)!.date : null,
  });
});
