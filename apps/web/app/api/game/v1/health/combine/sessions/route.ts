import { checkInRoute, saveCombine } from "@/src/lib/health-you/check-ins/service";

export const POST = checkInRoute(saveCombine);
