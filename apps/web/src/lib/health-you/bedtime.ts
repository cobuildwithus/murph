import { formatTimeZoneDateTimeParts, normalizeIanaTimeZone, toLocalDayKey } from "@murphai/contracts";
import { isRecord } from "../primitives";
import { day, offset } from "./engine/model";

function localBedtime(row: unknown) {
  if (
    !isRecord(row) ||
    typeof row.date !== "string" ||
    !day(row.date) ||
    typeof row.timeZone !== "string" ||
    !normalizeIanaTimeZone(row.timeZone) ||
    typeof row.startAt !== "string" ||
    typeof row.endAt !== "string" ||
    !(Date.parse(row.startAt) < Date.parse(row.endAt)) ||
    toLocalDayKey(row.endAt, row.timeZone) !== row.date
  )
    return null;
  const { hour, minute } = formatTimeZoneDateTimeParts(row.startAt, row.timeZone);
  return { date: row.date, minute: hour * 60 + minute };
}
function clockDistance(a: number, b: number) {
  const diff = Math.abs(a - b);
  return Math.min(diff, 1440 - diff);
}
/** Compare this week's local bedtimes to a stable baseline from the previous fourteen nights. */
export function bedtimeProgress(timing: unknown, asOf: string) {
  if (!Array.isArray(timing)) return undefined;
  const monday = offset(asOf, -((new Date(asOf).getUTCDay() + 6) % 7));
  const nights = new Map<string, Set<number>>();
  for (const row of timing) {
    const t = localBedtime(row);
    if (!t || t.date < offset(monday, -14) || t.date > asOf) continue;
    const minutes = nights.get(t.date) ?? new Set<number>();
    nights.set(t.date, minutes.add(t.minute));
  }
  const unique = [...nights].flatMap(([date, times]) =>
    times.size === 1 ? [{ date, minute: [...times][0] }] : [],
  );
  const baseline = unique.filter((r) => r.date < monday).map((r) => r.minute);
  if (baseline.length < 7) return undefined;
  const cost = (minute: number) => baseline.reduce((total, v) => total + clockDistance(minute, v), 0);
  const center = [...baseline].sort((a, b) => cost(a) - cost(b) || a - b)[0]!;
  if (baseline.filter((v) => clockDistance(v, center) <= 60).length < Math.max(7, baseline.length / 2))
    return undefined;
  return unique
    .filter((r) => r.date >= monday)
    .map((r) => ({ date: r.date, inTarget: clockDistance(r.minute, center) <= 60 }));
}
