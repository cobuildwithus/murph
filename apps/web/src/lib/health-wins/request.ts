import * as z from "@murphai/contracts/zod-runtime";
import { RequestInputError } from "@murphai/hosted-execution/request-input";

import { readJsonObject } from "../http";

export type HealthIdContext = { params: Promise<{ id: string }> };
export type HealthMemberContext = { params: Promise<{ memberId: string }> };

const uuid = z.string().uuid().toLowerCase();
const memberId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const candidateId = z.string().min(1).max(256);
const option = z.string().min(1).max(100);
const card = z.strictObject({ candidateId, option });
const postFields = {
  caption: z.string().max(2000).nullable().optional(),
  setRevision: uuid.optional(),
  cards: z.array(card).max(12)
    .refine(cards => new Set(cards.map(card => card.candidateId)).size === cards.length).optional(),
};

function hasCardRevision(input: { cards?: { candidateId: string }[]; setRevision?: string }) {
  return !input.cards?.length || input.setRevision !== undefined;
}

export const createPostBody = z.strictObject({ ...postFields, id: uuid, attachmentId: uuid.optional() })
  .refine(hasCardRevision)
  .refine(input => Boolean(input.caption?.trim() || input.cards?.length || input.attachmentId));
export const patchPostBody = z.strictObject({
  ...postFields, expectedVersion: z.number().int().positive().max(2147483647),
}).refine(hasCardRevision).refine(input => input.caption !== undefined || input.cards !== undefined);
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
