import * as z from "@murphai/contracts/zod-runtime";
import { RequestInputError } from "@murphai/hosted-execution/request-input";

import { readJsonObject } from "../http";

export type HealthIdContext = { params: Promise<{ id: string }> };
export type HealthMemberContext = { params: Promise<{ memberId: string }> };

const uuid = z.string().uuid().toLowerCase();
const memberId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const candidateId = z.string().min(1).max(256);
const option = z.string().min(1).max(100);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const card = z.strictObject({ candidateId, option, specRevision: z.union([uuid, digest]).optional() });
const bpm = z.number().min(30).max(230);
const seconds = z.number().int().nonnegative().max(6 * 60 * 60);
const heartRateSummary = z.strictObject({ avgBpm: bpm, lowBpm: bpm, peakBpm: bpm });
const routeTotals = z.strictObject({
  distanceM: z.number().positive().max(100_000),
  climbM: z.number().nonnegative().max(3000),
});
const splitSeconds = z.number().int().positive();
const routeSummary = routeTotals.extend({
  splits: z.array(z.strictObject({ distanceM: z.number().positive(), seconds: splitSeconds })).min(1).max(100),
});
const activitySummary = z.strictObject({
  id: uuid,
  kind: z.enum(["sauna", "cold_plunge", "lift", "other", "run", "walk"]),
  startedAt: z.iso.datetime({ offset: true }),
  elapsedSec: seconds.positive(),
  movingSec: seconds,
  timerSec: seconds.positive().optional(),
  heartRate: heartRateSummary.optional(),
  route: routeSummary.optional(),
});
const activityWithDisplay = activitySummary.extend({
  heartRate: heartRateSummary.extend({ perMinute: z.array(bpm.int().nullable()).max(360) }).optional(),
  route: routeSummary.extend({ paths: z.array(z.string().min(1)).max(8) }).optional(),
});
export const sealedActivitySummary = activitySummary.extend({
  route: routeTotals.extend({ splitSec: z.array(splitSeconds).min(1).max(100) }).optional(),
});

export const previewActivityBody = z.strictObject({ activity: activityWithDisplay });
export const saveActivityBody = z.strictObject({ activity: activitySummary });
const postFields = {
  caption: z.string().max(2000).nullable().optional(),
  setRevision: uuid.optional(),
  cards: z.array(card).max(12)
    .refine(cards => new Set(cards.map(card => card.candidateId)).size === cards.length).optional(),
};

export function validPayoffPost(input: { cards?: readonly { candidateId: string; specRevision?: string }[]; attachmentId?: string }) {
  const payoff = input.cards?.find(card => card.candidateId.startsWith("game:"));
  return !payoff || (input.cards?.length === 1 && Boolean(input.attachmentId) && digest.safeParse(payoff.specRevision).success);
}

export function hasPayoffCardEdit(input: { cards?: readonly { candidateId: string }[]; removeCardIds?: readonly string[] }) {
  return input.cards?.some(card => card.candidateId.startsWith("game:")) || input.removeCardIds?.some(id => id.startsWith("game:"));
}

export const createPostBody = z.strictObject({
  ...postFields, id: uuid, attachmentId: uuid.optional(), activity: activityWithDisplay.optional(),
})
  .refine(validPayoffPost)
  .refine(input => input.cards?.every(card => card.candidateId.startsWith("activity:")
    ? input.activity !== undefined && digest.safeParse(card.specRevision).success
    : card.candidateId.startsWith("game:") || input.setRevision !== undefined) ?? true)
  .refine(input => Boolean(input.caption?.trim() || input.cards?.length || input.attachmentId));
export const patchPostBody = z.strictObject({
  ...postFields, expectedVersion: z.number().int().positive().max(2147483647),
  removeCardIds: z.array(candidateId).min(1).max(12).refine(ids => new Set(ids).size === ids.length).optional(),
})
  .refine(input => !hasPayoffCardEdit(input))
  .refine(input => !input.cards?.length || input.setRevision !== undefined)
  .refine(input => !input.removeCardIds || (input.cards === undefined && input.setRevision === undefined))
  .refine(input => input.caption !== undefined || input.cards !== undefined || input.removeCardIds !== undefined);
export const commentBody = z.strictObject({
  id: uuid,
  body: z.string().trim().min(1).max(2000),
  visibility: z.enum(["everyone", "poster"]).default("everyone"),
});
export const changeWinBody = z.strictObject({ setRevision: uuid, option });
const winsQuery = z.strictObject({ refresh: z.enum(["0", "1"]).optional() });
const pageQuery = z.strictObject({ cursor: z.string().min(1).max(2048).optional() });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new RequestInputError("Invalid health feed request.");
  return result.data;
}

export async function readHealthBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  return parse(schema, await readJsonObject(request, { limitBytes: 32 * 1024 }));
}
export function readHealthCursor(request: Request) {
  return parse(pageQuery, Object.fromEntries(new URL(request.url).searchParams)).cursor;
}
export function readWinsRefresh(request: Request) {
  return parse(winsQuery, Object.fromEntries(new URL(request.url).searchParams)).refresh === "1";
}
export async function healthRowId(context: HealthIdContext) {
  return parse(uuid, (await context.params).id);
}
export async function healthCandidateId(context: HealthIdContext) {
  return parse(candidateId, (await context.params).id);
}
export async function healthMemberId(context: HealthMemberContext) {
  return parse(memberId, (await context.params).memberId);
}
