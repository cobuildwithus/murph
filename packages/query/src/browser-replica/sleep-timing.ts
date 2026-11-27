import { normalizeIanaTimeZone, toLocalDayKey } from "@murphai/contracts";
import { groupSleepWindowsByDate } from "../wearables/candidates.ts";
import { resolveSleepWindowSelection } from "../wearables/selection.ts";
import type { WearableSleepWindowCandidate } from "../wearables/types.ts";

export function projectSleepTiming(windows: readonly WearableSleepWindowCandidate[], from: string, through: string, vaultZone: unknown) {
  const eligible = windows.flatMap(window => {
    const zone = normalizeIanaTimeZone(window.timeZone ?? (typeof vaultZone === "string" ? vaultZone : null));
    if (!zone || window.nap || window.sleepType === "short_sleep" || window.sleepState === "tentative"
      || !window.startAt || !window.endAt || !(Date.parse(window.startAt) < Date.parse(window.endAt))) return [];
    const date = toLocalDayKey(window.endAt, zone);
    return date >= from && date <= through ? [{ ...window, date, timeZone: zone }] : [];
  });
  return [...groupSleepWindowsByDate(eligible)].flatMap(([date, nights]) => {
    const { selection } = resolveSleepWindowSelection(nights);
    return selection?.startAt && selection.endAt && selection.timeZone
      ? [{ date, startAt: selection.startAt, endAt: selection.endAt, timeZone: selection.timeZone }] : [];
  }).sort((a, b) => a.date.localeCompare(b.date));
}
