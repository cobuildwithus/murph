import * as z from "./zod-runtime.ts";
import { isoDateString } from "./schema-primitives.ts";

const minutes = z.number().int().min(0).max(1440);
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);

export const sleepSummaryCardRequestSchema = z.object({ date: isoDateString() }).strict();

// Declaration order is the cross-platform wire order. Parsing restores it even
// when a caller constructs an object in a different order.
export const sleepSummaryResponseCardV1Schema = z.object({
  kind: z.literal("sleep_summary"),
  version: z.literal(1),
  localDate: isoDateString(),
  bedtime: clock.nullable(),
  wakeTime: clock.nullable(),
  totalSleepMinutes: z.number().int().min(1).max(1440),
  score: z.number().int().min(0).max(100).nullable(),
  stages: z.object({
    deepMinutes: minutes,
    remMinutes: minutes,
    lightMinutes: minutes,
  }).strict().refine((value) => {
    const sum = value.deepMinutes + value.remMinutes + value.lightMinutes;
    return sum >= 1 && sum <= 1440;
  }, "Stage minutes must sum to 1 through 1440.").nullable(),
  awakeMinutes: z.number().int().min(1).max(1440).nullable(),
  efficiencyPercent: z.number().int().min(1).max(100).nullable(),
  hrv: z.object({
    milliseconds: z.number().int().min(1).max(1000),
    method: z.enum(["rmssd", "sdnn"]),
  }).strict().nullable(),
  restingHeartRate: z.number().int().min(20).max(250).nullable(),
  wakeUps: z.number().int().min(0).max(100).nullable(),
}).strict().refine((value) => (value.bedtime === null) === (value.wakeTime === null),
  "Bedtime and wake time must both be present or both be null.");

export type SleepSummaryResponseCardV1 = z.infer<typeof sleepSummaryResponseCardV1Schema>;

export const sleepSummaryAppCardEnvelopeV8Schema = z.object({
  schemaVersion: z.literal(8),
  card: sleepSummaryResponseCardV1Schema,
}).strict();

export function buildSleepSummaryAppCardEnvelopeV8(card: SleepSummaryResponseCardV1) {
  return sleepSummaryAppCardEnvelopeV8Schema.parse({ schemaVersion: 8, card });
}

export function parseSleepSummaryAppCardEnvelopeV8(value: unknown): SleepSummaryResponseCardV1 | null {
  const parsed = sleepSummaryAppCardEnvelopeV8Schema.safeParse(value);
  return parsed.success ? parsed.data.card : null;
}

export function formatSleepCardDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours === 0 ? `${remainder}m` : remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

/** Stage times in the card's bar read like a clock, "4h36" and "1h05", to save room. Under an hour keeps its unit: "28m". */
export function formatSleepCardStageDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours === 0 ? `${remainder}m` : remainder === 0 ? `${hours}h` : `${hours}h${String(remainder).padStart(2, "0")}`;
}

export function formatSleepCardClock(clock: string): string {
  const [hour, minute] = clock.split(":");
  const hours = Number(hour);
  return `${hours % 12 || 12}:${minute} ${hours < 12 ? "AM" : "PM"}`;
}

export function formatSleepCardDate(localDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  }).format(new Date(`${localDate}T12:00:00Z`));
}

export function sleepSummaryCardValueRows(card: SleepSummaryResponseCardV1): Array<[string, string]> {
  const rows: Array<[string, string]> = [["Asleep", formatSleepCardDuration(card.totalSleepMinutes)]];
  if (card.bedtime !== null && card.wakeTime !== null) rows.push(["Sleep window", `${formatSleepCardClock(card.bedtime)} to ${formatSleepCardClock(card.wakeTime)}`]);
  if (card.score !== null) rows.push(["Score", String(card.score)]);
  if (card.stages !== null) {
    rows.push(["Deep", formatSleepCardDuration(card.stages.deepMinutes)], ["REM", formatSleepCardDuration(card.stages.remMinutes)], ["Light", formatSleepCardDuration(card.stages.lightMinutes)]);
    rows.push(["Restorative (deep + REM)", formatSleepCardDuration(card.stages.deepMinutes + card.stages.remMinutes)]);
  }
  if (card.awakeMinutes !== null) rows.push(["Awake", formatSleepCardDuration(card.awakeMinutes)]);
  if (card.wakeUps !== null) rows.push(["Wake-ups", String(card.wakeUps)]);
  if (card.efficiencyPercent !== null) rows.push(["Sleep efficiency", `${card.efficiencyPercent}%`]);
  if (card.hrv !== null) rows.push(["HRV", `${card.hrv.milliseconds} ms`]);
  if (card.restingHeartRate !== null) rows.push(["Resting HR", `${card.restingHeartRate} bpm`]);
  return rows;
}
