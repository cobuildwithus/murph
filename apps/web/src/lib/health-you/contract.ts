import * as z from "@murphai/contracts/zod-runtime";

const date = z.iso.date(),
  n = z.number(),
  s = z.string(),
  maybe = <T extends z.ZodType>(v: T) => v.nullish();
const person = z.object({ memberId: s, firstName: s, avatarUrl: maybe(s) });
const mark = z.enum(["done", "missed", "todo", "none"]);
const target = z.object({
  text: s,
  track: maybe(z.object({ min: n, max: n, you: n, zoneLow: maybe(n), zoneHigh: maybe(n) })),
});
const factor = z.object({
  key: s,
  label: s,
  icon: s,
  group: z.enum(["sleep", "activity", "fitness", "blood", "body", "habits", "food"]),
  value: s,
  unit: maybe(s),
  target: maybe(target),
  inTarget: maybe(z.boolean()),
  years: n,
  yearsText: s,
  whatItIs: s.optional(),
  whatLowersIt: s.optional(),
  rank: maybe(z.object({ percentile: n, label: s, cohort: s })),
  grade: maybe(z.enum(["A", "B", "C"])),
  detail: z.enum(["sleep", "fitness", "blood", "marker", "combine", "food", "bloodPressure", "none"]),
  markerKey: maybe(s),
  state: z.enum(["counted", "stale"]).optional(),
});
const notCounted = z.object({
  key: s,
  label: s,
  icon: s,
  action: z.enum(["combine", "foodWeek", "addBloodPressure", "connectWearable", "bloodWork", "answer"]),
  primary: z.boolean(),
});
const question = z.object({ key: s, text: s, inputKind: z.enum(["date", "number"]).optional(), options: z.array(z.object({ value: s, label: s })) });
const weekRow = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("challenge"),
    gameId: s,
    title: s,
    partner: maybe(person),
    streak: maybe(n),
    days: z.array(mark).length(7),
  }),
  z.object({
    kind: z.literal("target"),
    factor: s,
    title: s,
    icon: z.enum(["lifts", "active", "bedtime", "steps", "sleep", "heart", "other"]),
    value: n,
    goal: n,
    text: s,
    progress: n.min(0).max(1),
    days: maybe(z.array(mark).length(7)),
  }),
  z.object({ kind: z.literal("workingOn"), factor: s, title: s, icon: s, text: s, change: maybe(s) }),
]);
const age = z.object({ value: n, real: n, gap: n, low: n, high: n });
const stale = z.object({ since: s, text: s });
export const youViewSchema = z.object({
  version: s,
  asOf: date,
  state: z.enum(["ready", "building", "paused", "unavailable"]),
  profile: person,
  stale: maybe(stale),
  building: maybe(z.object({ have: n, need: n, text: s })),
  paused: maybe(z.object({ text: s })),
  age: maybe(age),
  week: maybe(
    z.object({ daysAged: n, saved: n, partial: z.boolean(), basis: maybe(z.enum(["observed", "referenceOnly"])) }),
  ),
  thisWeek: z.array(weekRow),
  factors: z.array(factor),
  notCounted: z.array(notCounted),
  questions: z.array(question),
});
const point = z.object({ date, value: n });
const ageDetail = age.extend({
  history: z.array(z.object({ date, age: n, real: n })),
  historyLabel: s,
  weeks: z.array(z.object({ weekStart: date, daysAged: n, basis: maybe(z.enum(["observed", "referenceOnly"])) })),
  events: z.array(
    z.object({
      date,
      kind: z.enum(["bloodWork", "combine", "foodWeek", "bloodPressure", "evidenceChange"]),
      label: s,
      evidenceChangeYears: n.optional(),
    }),
  ),
});
const change = z.object({ key: s, label: s, icon: s, days: n });
const weekDetail = z.object({
  daysAged: n,
  saved: n,
  days: z.array(z.object({ date, label: s, aged: n })),
  helped: z.array(change),
  cost: z.array(change),
});
const section = z.object({
  title: s,
  hero: z.object({ value: s, unit: maybe(s), years: n }),
  chart: maybe(z.object({ kind: z.enum(["trend", "bars"]), points: z.array(point), unit: s })),
  factors: z.array(factor),
  notCounted: z.array(notCounted),
  tiles: z.array(z.object({ label: s, value: s })),
  question: maybe(question),
});
const markerSummary = z.object({ key: s, label: s, value: n, unit: s, flag: z.enum(["high", "low"]).nullable() });
const blood = z.object({
  latest: maybe(date),
  years: n,
  factors: z.array(factor),
  notCounted: z.array(notCounted),
  unchanged: z.array(markerSummary),
  worthALook: z.array(markerSummary),
  all: z.object({
    inRange: n,
    total: n,
    systems: z.array(z.object({ name: s, markers: z.array(markerSummary) })),
  }),
});
const marker = z.object({
  key: s,
  label: s,
  value: n,
  unit: s,
  years: maybe(n),
  target: maybe(target),
  history: z.array(point),
  whatItIs: s,
  whatLowersIt: s.optional(),
});
export const bundleSchema = z.object({
  you: youViewSchema,
  age: ageDetail.nullable(),
  week: weekDetail.nullable(),
  sleep: section,
  fitness: section,
  blood,
  markers: z.record(s, marker),
});
export type Bundle = z.infer<typeof bundleSchema>;
export type YouView = z.infer<typeof youViewSchema>;
export type Factor = z.infer<typeof factor>;
export type ThisWeekRow = z.infer<typeof weekRow>;
export type Person = z.infer<typeof person>;
