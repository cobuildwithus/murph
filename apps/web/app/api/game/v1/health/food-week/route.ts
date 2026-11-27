import { checkInRoute, readFoodWeek, saveFoodWeek } from "@/src/lib/health-you/check-ins/service";

export const GET = checkInRoute(readFoodWeek);
export const POST = checkInRoute(saveFoodWeek);
