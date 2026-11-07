import { addDaysToIsoDate, toLocalDayKey } from "@murphai/contracts";

/** Leave each step day out until eight hours after it ends, so late syncs can arrive. */
export function lastSettledStepDay(now: Date, timeZone: string): string {
  return addDaysToIsoDate(toLocalDayKey(new Date(now.getTime() - 8 * 60 * 60 * 1000), timeZone), -1);
}
