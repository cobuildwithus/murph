import * as z from "@murphai/contracts/zod-runtime";

const ref = z.string().min(1).max(128);
const gameId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/u);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
export const hostedGameScheduleSchema = z.union([
  z.object({ days: z.array(z.number().int().min(0).max(6)).min(1).max(7) }).strict(),
  z.object({ count: z.number().int().min(1).max(28) }).strict(),
]);
export const hostedGameChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("start_now") }).strict(),
  z.object({ kind: z.literal("edit"), schedule: hostedGameScheduleSchema.optional(), lengthDays: z.number().int().min(1).max(28).optional(), startsOn: date.nullable().optional(),
    tasks: z.array(z.object({ seat: z.number().int().min(0).max(1), text: z.string().min(1).max(200) }).strict()).length(2).optional(),
    stakes: z.array(z.object({ kind: z.enum(["winner_gets", "per_miss"]), item: z.string().min(1).max(200) }).strict()).min(1).max(3).optional(),
    stakesApplyToWholeGame: z.literal(true).optional(),
  }).strict(),
]);
export const hostedGameUpdateSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("propose"), gameId, proposalId: gameId, expectedTermsVersion: z.number().int().min(1), change: hostedGameChangeSchema }).strict(),
  z.object({ operation: z.enum(["approve", "decline", "cancel"]), gameId, proposalId: gameId }).strict(),
]);
export type HostedGameUpdate = z.infer<typeof hostedGameUpdateSchema>;
const origin = z.object({ kind: z.literal("accepted_input"), assistantInputId: ref }).strict();
export const hostedGamePhotoSchema = z.object({
  operation: z.enum(["offer", "save", "dismiss"]), gameId,
  sourceMessageRef: ref.optional(), attachmentOrdinal: z.number().int().min(1).max(32).optional(),
  replaceEntryId: gameId.optional(),
}).strict();
export type HostedGamePhoto = z.infer<typeof hostedGamePhotoSchema>;
export const hostedGameToolRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read_game"), origin }).strict(),
  z.object({ action: z.literal("game_photo"), origin, photo: hostedGamePhotoSchema }).strict(),
  z.object({ action: z.literal("update_game"), origin, update: hostedGameUpdateSchema }).strict(),
]);
export type HostedGameToolRequest = z.infer<typeof hostedGameToolRequestSchema>;
const terms = z.object({
  n: z.number().int().min(1), fromDay: z.number().int().min(0),
  checkInKind: z.enum(["photo", "heart_rate"]).optional(),
  tasks: z.array(z.object({ seat: z.number().int(), text: z.string().max(500) }).strict()).max(2),
  schedule: hostedGameScheduleSchema,
  stakes: z.array(z.object({ kind: z.enum(["winner_gets", "per_miss"]), item: z.string().max(500), key: z.string().optional() }).strict()).max(20),
}).strict();
const pending = z.object({
  id: ref, proposedByMemberId: ref, expectedTermsVersion: z.number().int().min(1),
  change: hostedGameChangeSchema, effectiveFromDay: z.number().int().min(0),
  deliveryStatus: z.enum(["pending", "queued", "sent", "failed", "conversation"]), deliveryRetryable: z.boolean().optional(), startsOn: date.nullable(),
}).strict();
const progress = z.object({
  checkedAt: z.string(), players: z.array(z.object({
    memberId: ref, score: z.number().int().min(0), target: z.number().int().min(0),
    currentDayIndex: z.number().int().nullable(), attemptsRemaining: z.number().int().min(0).max(2),
    currentEntryId: ref.nullable(),
    days: z.array(z.object({ dayIndex: z.number().int(), date, status: z.enum(["posted", "due", "missed", "off", "upcoming", "not_posted"]) }).strict()).max(28),
  }).strict()).max(2),
}).strict();
const result = z.object({
  scores: z.array(z.object({ memberId: ref, seat: z.number().int(), score: z.number().int(), misses: z.number().int() }).strict()).max(2),
  tickets: z.array(z.object({ owedByMemberId: ref, owedToMemberId: ref, what: z.string().max(500), status: z.enum(["open", "redeemed", "expired"]), count: z.number().int().min(1) }).strict()).max(48),
}).strict();
export const hostedGameChatStateSchema = z.object({ games: z.array(z.object({
  id: ref, status: z.enum(["invited", "negotiating", "live", "settled", "void"]), terms,
  startsOn: date.nullable(), lengthDays: z.number().int().min(1).max(28),
  players: z.array(z.object({ memberId: ref, seat: z.number().int(), firstName: z.string().max(200), dayOne: date.nullable(), timeZone: z.string().max(100) }).strict()).max(2),
  pendingChange: pending.nullable(),
  progress: progress.optional(), result: result.nullable().optional(),
  changeControls: z.object({ canStartNow: z.boolean(), canEdit: z.boolean(), canEditSchedule: z.boolean(), canEditStartDate: z.boolean(), canEditTasks: z.boolean().optional(), canEditStakes: z.boolean().optional(), editableFromDay: z.number().int().nullable() }).strict(),
}).strict()).max(10), photoCheckIn: z.object({ introductionAvailable: z.boolean(), hasPendingOffer: z.boolean() }).strict().optional() }).strict();
export type HostedGameChatState = z.infer<typeof hostedGameChatStateSchema>;
export const hostedGameToolResponseSchema = z.object({
  action: z.enum(["read_game", "update_game", "game_photo"]),
  result: z.object({
    status: z.enum(["ok", "unavailable", "rejected"]),
    state: hostedGameChatStateSchema.optional(),
    error: z.string().max(128).optional(),
    photoOutcome: z.enum(["offer", "suppressed", "saved", "dismissed"]).optional(),
  }).strict(),
}).strict();
export type HostedGameToolResponse = z.infer<typeof hostedGameToolResponseSchema>;
