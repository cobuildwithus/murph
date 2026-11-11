import * as z from "./zod-runtime.ts";

const ref = z.string().min(1).max(128);
export const recapReferenceSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/u),
  kind: z.enum(["profile", "entry", "murph"]),
  memberId: ref.optional(),
  entryId: ref.optional(),
}).strict();
export type RecapReference = z.infer<typeof recapReferenceSchema>;
export const recapTranscriptMessageSchema = z.object({
  id: ref, source: z.enum(["player", "assistant"]),
  playerName: z.string().max(200), text: z.string(),
  at: z.isoDateTime({ offset: true }),
  laneSeq: z.string().regex(/^\d+$/u).optional(),
}).strict();
export type RecapTranscriptMessage = z.infer<typeof recapTranscriptMessageSchema>;
export const recapTranscriptPageSchema = z.object({
  messages: z.array(recapTranscriptMessageSchema).max(200),
  next: z.string().regex(/^\d+$/u).nullable(),
  through: z.string().regex(/^\d+$/u),
  since: z.isoDateTime({ offset: true }), until: z.isoDateTime({ offset: true }),
  retainedSince: z.isoDateTime({ offset: true }),
  incomplete: z.boolean(),
}).strict();
export type RecapTranscriptPage = z.infer<typeof recapTranscriptPageSchema>;

export const recapMaterialSchema = z.object({
  game: z.unknown(),
  players: z.array(z.string().min(1).max(200)).length(2),
  entries: z.array(z.object({
    entryId: ref, kind: z.string(), playerName: z.string(), text: z.string().nullable(), visibleToBoth: z.boolean(),
  }).strict()).max(1460),
  result: z.array(z.object({ memberId: ref, name: z.string(), score: z.number().int() }).strict()).length(2),
  startedAt: z.isoDateTime({ offset: true }), settledAt: z.isoDateTime({ offset: true }),
  references: z.array(recapReferenceSchema).max(1463),
}).strict();
export type RecapMaterial = z.infer<typeof recapMaterialSchema>;
