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
export const hostedGameToolRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read_game"), origin }).strict(),
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
  deliveryStatus: z.enum(["pending", "queued", "sent", "failed"]), deliveryRetryable: z.boolean().optional(), startsOn: date.nullable(),
}).strict();
export const hostedGameChatStateSchema = z.object({ games: z.array(z.object({
  id: ref, status: z.enum(["invited", "negotiating", "live", "settled", "void"]), terms,
  startsOn: date.nullable(), lengthDays: z.number().int().min(1).max(28),
  players: z.array(z.object({ memberId: ref, seat: z.number().int(), firstName: z.string().max(200), dayOne: date.nullable(), timeZone: z.string().max(100) }).strict()).max(2),
  pendingChange: pending.nullable(),
  changeControls: z.object({ canStartNow: z.boolean(), canEdit: z.boolean(), canEditSchedule: z.boolean(), canEditStartDate: z.boolean(), canEditTasks: z.boolean().optional(), canEditStakes: z.boolean().optional(), editableFromDay: z.number().int().nullable() }).strict(),
}).strict()).max(10) }).strict();
export type HostedGameChatState = z.infer<typeof hostedGameChatStateSchema>;
export const hostedGameToolResponseSchema = z.object({
  action: z.enum(["read_game", "update_game"]),
  result: z.object({
    status: z.enum(["ok", "unavailable", "rejected"]),
    state: hostedGameChatStateSchema.optional(),
    error: z.string().max(128).optional(),
  }).strict(),
}).strict();
export type HostedGameToolResponse = z.infer<typeof hostedGameToolResponseSchema>;
