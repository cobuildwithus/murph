import { checkInRoute, saveBloodPressure } from "@/src/lib/health-you/check-ins/service";

export const POST = checkInRoute(saveBloodPressure);
