import { checkInRoute, readCombine } from "@/src/lib/health-you/check-ins/service";

export const GET = checkInRoute(readCombine);
