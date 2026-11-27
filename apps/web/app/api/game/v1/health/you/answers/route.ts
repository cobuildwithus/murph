import { checkInRoute, saveAnswer } from "@/src/lib/health-you/check-ins/service";

export const POST = checkInRoute(saveAnswer);
