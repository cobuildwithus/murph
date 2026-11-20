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
/** Shared place art being made: a timed loader; readiness comes from a later read. */
const making = z.object({ state: z.literal("making"), startedAt: z.string(), expiresAt: z.string(), typicalSeconds: z.number().int().positive() });
/** A place's poster: ready at path, being made, or null (none yet). */
const art = z.union([z.object({ state: z.literal("ready"), path: z.string() }), making]).nullable();
// aheadText, while a town is ahead: "33 mi away", or "416 mi to go" for the end.
// poster: the place's travel poster. stepsText: Steps only, the steps total on the day you got there.
// at: how far along, in the chart's unit. region: the state or province (US, Canada) or the country; regionCode: "DE", "ON".
const towns = z.array(z.object({ name: z.string(), atText: z.string(), aheadText: z.string().nullable(), x: z.number(), y: z.number(), passedOn: day.nullable(),
  poster: art, stepsText: z.string().nullable(), at: z.number(), region: z.string().nullable(), regionCode: z.string().nullable() }));
const route = z.object({
  name: z.string(), distanceText: z.string(), walkedText: z.string(), totalText: z.string(), progress: z.number(), straightLine: z.boolean(),
  goalPicked: z.boolean(), completed: z.array(z.object({ name: z.string(), finishedOn: day, shareAwardId: z.string() })),
  finishedOn: day.nullable(), shareAwardId: z.string().nullable(),
  /** Authenticated Progress map path, never a provider URL. */
  map: z.string(),
  /** Card coordinates; use drawerTowns when requesting the same map with size=drawer. */
  towns,
  drawerTowns: towns,
  here: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  drawerHere: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  /** The rest at the last 30 days' pace: "10 weeks", "9 days". Null when finished or with no pace yet. */
  etaText: z.string().nullable(),
  /** The day this leg started (null when that can't be known), and the day the rest lands at that pace (null when finished or with no pace yet). */
  startedOn: day.nullable(), etaOn: day.nullable(),
  /** The leg's days so far, after its distance: "in 48 days". Null without a start day. */
  daysText: z.string().nullable(),
  /** "86 mi left"; null when finished. */
  remainingText: z.string().nullable(),
  /** The leg's running total from startedOn, in `unit` ("mi" or "km"), up to `distance`. Null without a start day. */
  chart: z.object({ unit: z.string(), distance: z.number(), points: z.array(point) }).nullable(),
  /** The card and drawer maps' paintings: ready (`map` serves it; names go light), being made, or null (the plain map). */
  mapArt: z.union([z.object({ state: z.literal("ready") }), making]).nullable(),
  drawerMapArt: z.union([z.object({ state: z.literal("ready") }), making]).nullable(),
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
/** Each live game's check-in today and the measure it adds to. Before it's in, `after` is that measure
 * as it will read once it is, so Home can show it the moment a post is in, before Progress reads again. */
const checkIn = z.object({ gameId: z.string(), measureId: z.string(), after: measureSchema.nullable() });
export const progressSchema = z.object({
  joinedOn: day, today: day, incomplete: z.boolean(), measures: z.array(measureSchema),
  medals: z.array(medalSchema), shelf: z.array(z.string()).max(6), moments: z.array(moment), picCount: z.number(),
  checkIns: z.array(checkIn),
});
export type Progress = z.infer<typeof progressSchema>;

const healthMetric = z.object({
  id: z.enum(["restingHeartRate", "steps", "sleep"]), label: z.string(), unit: z.string(),
  access: z.enum(["ok", "off", "missing"]), direction: z.enum(["better", "worse", "flat"]), headline: z.string(),
  /** Under a headline that is the number itself (sleep's "7h 52m a night"): "Up 45 min since joining". */
  change: z.string().nullable(),
  /** Raw current mean in the metric unit used for the change since joining. */
  comparisonValue: z.number().nullable().optional(),
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
  shareAsk: z.boolean(),
  departureNotice: z.string().nullable(),
  /** Exact two-person room recipients, shown before consent. */
  shareAudience: z.array(person),
  /** The game a friend's Challenge button sets up on this measure: its task and kind of week. */
  challenge: z.object({ task: z.string(), category: z.enum(["move", "calm", "strength"]) }).nullable(),
});
export type Friends = z.infer<typeof friendsSchema>;
export const goalsSchema = z.object({
  tiles: z.array(rungSchema), match: rungSchema.nullable(), suggestions: z.array(rungSchema),
  note: z.string().nullable(),
  route: z.object({ from: z.string(), to: z.string(), distanceText: z.string(), detail: z.string(),
    straightLine: z.boolean(), map: z.string(), towns: route.shape.towns,
    /** A place typed with a slip, found as the one Mapbox and Luna agree on: "Lisbn" as "Lisbon". */
    fixed: z.object({ typed: z.string(), showing: z.string() }).nullable() }).nullable(),
  /** Two places typed and one found nowhere, even as a slip: its words, as typed. Absent otherwise. */
  notFound: z.string().optional(),
});
export type Goals = z.infer<typeof goalsSchema>;

const text = z.string().trim().min(1);
const goal = z.union([z.strictObject({ rungId: text }), z.strictObject({ from: text, to: text })]);
export type MeasureGoal = z.infer<typeof goal>;
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
const storyQuery = z.strictObject({ measure: text, town: z.string().regex(/^\d{1,2}$/u).transform(Number) });
export type StoryQuery = z.infer<typeof storyQuery>;
/** GET story: the back of a passed town's postcard, written once per place for everyone. */
export const storySchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ready"), title: z.string(), facts: z.array(z.string()) }),
  z.object({ state: z.literal("making"), typicalSeconds: z.number().int().positive() }),
  z.object({ state: z.literal("failed") }),
]);
export type StoryView = z.infer<typeof storySchema>;
const picUpload = z.object({ id: z.string().uuid(), measureId: text, takenAt: z.iso.datetime({ offset: true }) });
export type PicUploadQuery = z.infer<typeof picUpload>;
const mapSize = z.enum(["card", "drawer"]);
const mapQuery = z.union([
  // v: the picture's version (`routeView`); only the app's cache reads it.
  z.strictObject({ measure: text, size: mapSize, v: text.optional() }),
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
export const parseStoryQuery = (value: unknown): StoryQuery => parse(storyQuery, value);

export type SetMeasureResponse = { ok: true; measure: Measure };
export type SetSharingResponse = { ok: true; sharedWith: (z.infer<typeof person> & { metrics: SetSharingBody["metrics"] })[] };
export type PicUploadResponse = { ok: true; pic: Pic };
export type ProgressWriteResponse = { ok: true }; // DELETE pic, POST seen
// GET pics/:id returns image/jpeg; GET map returns image/png. No JSON envelope.

/** Passed-item drawer. Terminal image failure intentionally presents the medal. */
const shareBox = z.strictObject({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
export const shareViewSchema = z.strictObject({
  awardId: z.string(),
  // name, contextLine, valueText, face and messageText are build 118's card; the postcard reads the rest.
  card: z.strictObject({ name: z.string(), contextLine: z.string(), valueText: z.string(), face: medalFace, messageText: z.string(),
    place: z.string().min(1), line: z.string().min(1).max(32),
    stamp: z.strictObject({ amount: z.string().min(1).max(8), unit: z.string().min(1).max(16), spoken: z.string(), art: z.enum(['peak', 'pin', 'bird', 'moon']) }),
    postmark: z.strictObject({ day: z.string(), year: z.string(), verb: z.string() }) }),
  /** Fractions of the 2:3 picture the prompt keeps plain; the app checks faces against marks. */
  zones: z.strictObject({ words: shareBox, marks: shareBox, wordmark: shareBox, person: z.strictObject({ y: z.number(), h: z.number() }) }),
  presentation: z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('needs_photo') }),
    z.strictObject({ state: z.literal('medal') }),
    z.strictObject({ state: z.literal('available') }),
    /** A quota or another live generation: POST starts nothing before availableAt. */
    z.strictObject({ state: z.literal('later'), availableAt: z.iso.datetime() }),
    // typicalSeconds: how long a picture usually takes, for a timed 0-100 loader.
    z.strictObject({ state: z.literal('generating'), startedAt: z.iso.datetime(), expiresAt: z.iso.datetime(), typicalSeconds: z.number().int().positive() }),
    // attempt names this picture for Change photo; availableAt is when Change photo can next make one.
    z.strictObject({ state: z.literal('photo'), imagePath: z.string(), attempt: z.string(), availableAt: z.iso.datetime().optional() }),
  ]),
});
export type ShareView = z.infer<typeof shareViewSchema>;
/** GET and PUT /api/game/v1/progress/share-consent. */
export type ShareConsentResponse = { decision: 'allowed' | 'denied' };
const shareConsent = z.strictObject({ decision: z.enum(['allow', 'deny']), disclosureVersion: z.literal(1) });
export const parseShareConsent = (value: unknown) => parse(shareConsent, value);
/** POST shares/:id: empty, or Change photo naming the shown attempt. */
const shareStart = z.strictObject({ replaces: z.string().regex(/^[0-9a-z]{1,16}$/u) });
export const parseShareStart = (value: unknown) => parse(shareStart, value);
/** PUT share-photo as JSON; Take one and From Photos send the JPEG itself. GET returns image/jpeg. */
const sharePhoto = z.union([z.strictObject({ from: z.literal('profile') }), z.strictObject({ from: z.literal('post'), entryId: z.string().min(1).max(200) })]);
export const parseSharePhoto = (value: unknown) => parse(sharePhoto, value);
