import * as z from "@murphai/contracts/zod-runtime";
import { RequestInputError } from "@murphai/hosted-execution/request-input";

/** /api/game/v1/progress. Dates are member-local; amounts are server formatted. */
const day = z.iso.date();
export type Day = string;
const amount = z.object({ value: z.number(), text: z.string(), unit: z.string() });
export type Amount = z.infer<typeof amount>;
const point = z.tuple([day, z.number()]);
const person = z.object({ memberId: z.string(), firstName: z.string(), avatarUrl: z.string().nullable() });
const shortText = z.string().min(1).max(40).regex(/^[^\d\r\n\u2014]+$/u);

export const rungSchema = z.object({
  id: z.string(), name: z.string(), short: z.string().min(1).max(40).regex(/^[^\r\n\u2014]+$/u), tagline: shortText,
  shareAwardId: z.string().nullable(), drawing: z.string().nullable(), at: z.number(), atText: z.string(),
  blurb: z.string(), where: z.string().nullable(), on: day.nullable(), toGo: z.string().nullable(),
});
export type Rung = z.infer<typeof rungSchema>;
const ladder = z.object({ kind: z.enum(["height", "time"]), passed: z.array(rungSchema), next: rungSchema.nullable(), goalPicked: z.boolean() });
export type Ladder = z.infer<typeof ladder>;
const towns = z.array(z.object({ name: z.string(), atText: z.string(), x: z.number(), y: z.number(), passedOn: day.nullable() }));
const route = z.object({
  name: z.string(), distanceText: z.string(), walkedText: z.string(), progress: z.number(), straightLine: z.boolean(),
  goalPicked: z.boolean(), completed: z.array(z.object({ name: z.string(), finishedOn: day, shareAwardId: z.string() })),
  finishedOn: day.nullable(), shareAwardId: z.string().nullable(),
  /** Authenticated Progress map path, never a provider URL. */
  map: z.string(),
  /** Card coordinates; use drawerTowns when requesting the same map with size=drawer. */
  towns,
  drawerTowns: towns,
  here: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  drawerHere: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
});
export type Route = z.infer<typeof route>;
const pic = z.object({ id: z.string(), takenOn: day, at: z.number() });
export type Pic = z.infer<typeof pic>;
export const measureSchema = z.object({
  id: z.string(), label: z.string(), noun: z.string(), icon: z.string(),
  format: z.enum(["count", "duration", "distance", "days"]), source: z.enum(["games", "wearable"]),
  pending: z.boolean(), gameOn: z.boolean(), needsPerDay: z.boolean(),
  total: amount, today: amount.nullable(), points: z.array(point),
  projection: z.object({ value: z.number(), label: z.string(), on: day.nullable() }).nullable(),
  ladder: ladder.nullable(), route: route.nullable(), pics: z.array(pic),
});
export type Measure = z.infer<typeof measureSchema>;
const medalFace = z.union([
  z.object({ number: z.string() }), z.object({ drawing: z.string() }),
  z.object({ delta: z.object({ icon: z.string(), text: z.string() }) }),
  z.object({ member: person }),
  z.object({ generic: z.literal(true) }),
]);
export type MedalFace = z.infer<typeof medalFace>;
export const medalSchema = z.object({
  id: z.string(), kind: z.string(), gold: z.boolean(), face: medalFace,
  title: z.string(), detail: z.string(), earnedOn: day,
  open: z.object({ page: z.enum(["totals", "health", "friends"]), measureId: z.string().nullable() }),
});
export type Medal = z.infer<typeof medalSchema>;
const moment = z.object({
  id: z.string(), kind: z.enum(["goal", "route", "medal", "held", "bigDay"]), medalIds: z.array(z.string()),
  measureId: z.string().nullable(), nextGoal: rungSchema.nullable(),
  title: z.string(), line: z.string().nullable(),
});
export type Moment = z.infer<typeof moment>;
export const progressSchema = z.object({
  joinedOn: day, today: day, incomplete: z.boolean(), measures: z.array(measureSchema),
  medals: z.array(medalSchema), shelf: z.array(z.string()).max(6), moments: z.array(moment), picCount: z.number(),
});
export type Progress = z.infer<typeof progressSchema>;

const healthMetric = z.object({
  id: z.enum(["restingHeartRate", "steps", "sleep", "vo2Max"]), label: z.string(), unit: z.string(),
  access: z.enum(["ok", "off", "missing"]), direction: z.enum(["better", "worse", "flat"]), headline: z.string(),
  daily: z.array(z.tuple([day, z.number().nullable()])), baseline: amount.nullable(),
  wins: z.array(z.object({ medalId: z.string(), on: day, text: z.string(), face: medalFace, title: z.string(), detail: z.string() })),
  next: z.object({ title: z.string(), detail: z.string(), face: medalFace }).nullable(),
  age: z.object({ percentile: z.number(), text: z.string(), current: amount, typical: amount.nullable(),
    previous: z.object({ percentile: z.number(), amount, on: day }) }).nullable(),
});
export type HealthMetric = z.infer<typeof healthMetric>;
const rec = z.object({ id: z.string(), metric: z.string(), title: z.string(), detail: z.string(), task: z.string(), category: z.string(),
  icon: z.enum(["sleep", "phone", "walk", "stairs", "run", "heart", "water", "sun"]) });
export type Rec = z.infer<typeof rec>;
export const healthSchema = z.object({
  joinedOn: day, today: day,
  state: z.enum(["ok", "notConnected", "connectedToday", "noWearable", "stale"]), savedAt: z.iso.datetime().nullable(),
  winCount: z.number(), metrics: z.array(healthMetric), recs: z.array(rec), sums: z.array(measureSchema),
});
export type Health = z.infer<typeof healthSchema>;

/** Read-only saved presentation in a live-read 503's error.details.health. */
export const savedHealthSchema = healthSchema.pick({ joinedOn: true, today: true, winCount: true }).extend({
  metrics: z.array(healthMetric.pick({ id: true, label: true, unit: true, baseline: true, wins: true, next: true })
    .extend({ headline: z.string().nullable() })),
});
export type SavedHealth = z.infer<typeof savedHealthSchema>;

const friend = person.extend({ me: z.boolean(), invited: z.boolean(), joinedOn: day.nullable() });
const friendRow = z.discriminatedUnion("private", [
  friend.extend({ private: z.literal(true), rank: z.null(), total: z.null() }),
  friend.extend({ private: z.literal(false), rank: z.number().nullable(), total: amount.nullable() }),
]);
export const friendsSchema = z.object({
  incomplete: z.boolean(),
  pills: z.array(z.object({ id: z.string(), label: z.string(), icon: z.string() })), pill: z.string(), range: z.enum(["week", "month", "all"]),
  rows: z.array(friendRow),
  /** Every ranked person; private people have no line or gap. */
  chart: z.array(z.object({ memberId: z.string(), points: z.array(point) })),
  next: z.object({ memberId: z.string(), text: z.string() }).nullable(), shareAsk: z.boolean(),
  departureNotice: z.string().nullable(),
  /** Exact two-person room recipients, shown before consent. */
  shareAudience: z.array(person),
});
export type Friends = z.infer<typeof friendsSchema>;
export const goalsSchema = z.object({
  tiles: z.array(rungSchema), match: rungSchema.nullable(), suggestions: z.array(rungSchema),
  note: z.string().nullable(),
  route: z.object({ from: z.string(), to: z.string(), distanceText: z.string(), detail: z.string(),
    straightLine: z.boolean(), map: z.string(), towns: route.shape.towns }).nullable(),
});
export type Goals = z.infer<typeof goalsSchema>;

const text = z.string().trim().min(1);
const goal = z.union([z.strictObject({ rungId: text }), z.strictObject({ from: text, to: text })]);
const setMeasure = z.union([z.strictObject({ goal }), z.strictObject({ perDay: z.number().int().min(1).max(10_000) })]);
export type SetMeasureBody = z.infer<typeof setMeasure>;
const sharing = z.strictObject({ metrics: z.array(z.enum(["steps", "sleep"])).min(1).max(2)
  .refine(values => new Set(values).size === values.length), share: z.boolean(),
  audience: z.array(text).max(5000).refine(values => new Set(values).size === values.length) });
export type SetSharingBody = z.infer<typeof sharing>;
const seen = z.strictObject({ momentIds: z.array(text) });
export type SeenBody = z.infer<typeof seen>;
const friendsQuery = z.object({ measure: text, range: z.enum(["week", "month", "all"]).default("month"), with: text.optional() });
export type FriendsQuery = z.infer<typeof friendsQuery>;
const goalsQuery = z.object({ measure: text, q: text.optional(), find: z.literal("1").optional() })
  .refine(query => query.find === undefined || query.q !== undefined);
export type GoalsQuery = z.infer<typeof goalsQuery>;
const picUpload = z.object({ id: z.string().uuid(), measureId: text, takenAt: z.iso.datetime({ offset: true }) });
export type PicUploadQuery = z.infer<typeof picUpload>;
const mapSize = z.enum(["card", "drawer"]);
const mapQuery = z.union([
  z.strictObject({ measure: text, size: mapSize }),
  z.strictObject({ from: text, to: text, size: mapSize }),
]);
export type MapQuery = z.infer<typeof mapQuery>;

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new RequestInputError("Invalid Progress request.");
  return result.data;
}
/** Call once at the route boundary, after reading the size-limited body/query. */
export const parseSetMeasureBody = (value: unknown): SetMeasureBody => parse(setMeasure, value);
export const parseSetSharingBody = (value: unknown): SetSharingBody => parse(sharing, value);
export const parseSeenBody = (value: unknown): SeenBody => parse(seen, value);
export const parseFriendsQuery = (value: unknown): FriendsQuery => parse(friendsQuery, value);
export const parseGoalsQuery = (value: unknown): GoalsQuery => parse(goalsQuery, value);
export const parsePicUploadQuery = (value: unknown): PicUploadQuery => parse(picUpload, value);
export const parseMapQuery = (value: unknown): MapQuery => parse(mapQuery, value);

export type SetMeasureResponse = { ok: true; measure: Measure };
export type SetSharingResponse = { ok: true; sharedWith: (z.infer<typeof person> & { metrics: SetSharingBody["metrics"] })[] };
export type PicUploadResponse = { ok: true; pic: Pic };
export type ProgressWriteResponse = { ok: true }; // DELETE pic, POST seen
// GET pics/:id returns image/jpeg; GET map returns image/png. No JSON envelope.

/** Passed-item drawer. Terminal image failure intentionally presents the medal. */
export const shareViewSchema = z.strictObject({
  awardId: z.string(),
  card: z.strictObject({ name: z.string(), contextLine: z.string(), valueText: z.string(), face: medalFace, messageText: z.string() }),
  presentation: z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('needs_photo') }),
    z.strictObject({ state: z.literal('medal') }),
    z.strictObject({ state: z.literal('available') }),
    z.strictObject({ state: z.literal('generating'), startedAt: z.iso.datetime(), expiresAt: z.iso.datetime() }),
    z.strictObject({ state: z.literal('photo'), imagePath: z.string() }),
  ]),
});
export type ShareView = z.infer<typeof shareViewSchema>;
const shareConsent = z.strictObject({ decision: z.enum(['allow', 'deny']), disclosureVersion: z.literal(1) });
export const parseShareConsent = (value: unknown) => parse(shareConsent, value);
