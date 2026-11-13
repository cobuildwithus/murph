import { recapAssetSchema, songWordTimestampsSchema } from "@murphai/contracts/recap-show";
import * as z from "@murphai/contracts/zod-runtime";

// A new value of the existing error field: this generation is durably finished and must end without sending.
export const GAME_RECAP_GENERATION_RETIRED = "recap_generation_retired";

const ref = z.string().min(1).max(128);
const gameId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/u);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
export const hostedGameScheduleSchema = z.union([
  z.object({ days: z.array(z.number().int().min(0).max(6)).min(1).max(7) }).strict(),
  z.object({ count: z.number().int().min(1).max(365) }).strict(),
]);
export const hostedGameChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("start_now") }).strict(),
  z.object({ kind: z.literal("edit"), schedule: hostedGameScheduleSchema.optional(), lengthDays: z.number().int().min(1).max(365).optional(), startsOn: date.nullable().optional(),
    tasks: z.array(z.object({ seat: z.number().int().min(0).max(1), text: z.string().min(1).max(200) }).strict()).min(2).max(2).optional(),
    stakes: z.array(z.object({ kind: z.enum(["winner_gets", "per_miss", "prize", "dare", "both_get"]), item: z.string().min(1).max(200) }).strict()).min(1).max(3).optional(),
    stakesApplyToWholeGame: z.literal(true).optional(),
  }).strict(),
  z.object({ kind: z.literal("call_off") }).strict(),
]);
export const hostedGameCreateTermsSchema = z.object({
  defaultTask: z.string().min(1).max(200).optional(),
  tasks: z.array(z.object({ memberId: ref, text: z.string().min(1).max(200) }).strict()).min(2).max(10),
  schedule: hostedGameScheduleSchema,
  stakes: z.array(z.object({ kind: z.enum(["prize", "dare"]), item: z.string().min(1).max(200) }).strict()).length(1),
  lengthDays: z.number().int().min(3).max(365).optional(),
  startsOn: date.optional(),
}).strict();
export const hostedGameUpdateSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("set_reminder"), minutes: z.number().int().min(0).max(1439).optional(), gameId: gameId.optional(), on: z.boolean().optional() }).strict()
    .refine(value => value.minutes !== undefined || value.on !== undefined, "Choose a time or on/off setting."),
  z.object({ operation: z.literal("create"), gameId, terms: hostedGameCreateTermsSchema, previousGameId: gameId.optional(), groupWord: z.string().trim().min(1).max(40).optional() }).strict(),
  z.object({ operation: z.literal("edit_terms"), gameId, proposalId: gameId.optional(), expectedTermsVersion: z.number().int().min(1), terms: hostedGameCreateTermsSchema.extend({ defaultTask: z.string().min(1).max(200), tasks: z.array(hostedGameCreateTermsSchema.shape.tasks.element).min(1).max(10) }) }).strict(),
  z.object({ operation: z.enum(["mark_incomplete", "restore_day"]), gameId, date }).strict(),
  // Also counts a closed day with no post, as a post in the speaker's own words; restore_day stays for runtimes that predate it.
  z.object({ operation: z.literal("mark_complete"), gameId, date, text: z.string().min(1).max(140).optional() }).strict(),
  z.object({ operation: z.literal("propose"), gameId, proposalId: gameId, expectedTermsVersion: z.number().int().min(1), change: hostedGameChangeSchema }).strict(),
  z.object({ operation: z.literal("approve"), gameId, proposalId: gameId.optional(), expectedTermsVersion: z.number().int().min(1).optional() }).strict().refine(value => (value.proposalId !== undefined) !== (value.expectedTermsVersion !== undefined), "Approval needs proposalId or expectedTermsVersion."),
  z.object({ operation: z.enum(["decline", "cancel"]), gameId, proposalId: gameId }).strict(),
  z.object({ operation: z.literal("cancel_game"), gameId }).strict(),
]);
export type HostedGameUpdate = z.infer<typeof hostedGameUpdateSchema>;
const acceptedInputOrigin = z.object({ kind: z.literal("accepted_input"), assistantInputId: ref }).strict();
const automationOccurrenceOrigin = z.object({ kind: z.literal("automation_occurrence"), automationId: z.string().min(1).max(191), occurrenceAt: z.isoDateTime({ offset: true }) }).strict();
const gameRecapOrigin = z.object({ kind: z.literal("game_recap"), gameId, eventId: ref }).strict();
export const hostedGamePhotoSchema = z.object({
  operation: z.enum(["offer", "save", "dismiss"]), gameId,
  sourceMessageRef: ref.optional(), attachmentOrdinal: z.number().int().min(1).max(32).optional(),
  replaceEntryId: gameId.optional(),
}).strict();
export type HostedGamePhoto = z.infer<typeof hostedGamePhotoSchema>;
export { gameRecapStorySchema as hostedGameRecapSchema, gameRecapWriterSchema as hostedGameRecapWriterSchema } from "@murphai/contracts/recap-show";
import { gameRecapStorySchema as hostedGameRecapSchema, gameRecapWriterSchema, recapShowStorySchema } from "@murphai/contracts/recap-show";
export type { GameRecapStory as HostedGameRecap } from "@murphai/contracts/recap-show";
export const hostedGameToolRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("my_game_reminders"), origin: acceptedInputOrigin, operation: z.enum(["read", "set"]),
    minutes: z.number().int().min(0).max(1439).optional(), gameId: gameId.optional(), on: z.boolean().optional(),
    everyDay: z.boolean().optional(), text: z.boolean().optional(), push: z.boolean().optional() }).strict(),
  z.object({ action: z.literal("read_game"), origin: z.union([acceptedInputOrigin, gameRecapOrigin, automationOccurrenceOrigin]), includePlayers: z.literal(true).optional(),
    recapRead: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("recover"), failed: z.literal(true).optional() }).strict(),
      z.object({ kind: z.literal("upload"), slot: z.string().regex(/^(scene-[0-6]|song)$/u), mediaType: z.enum(["image/jpeg", "audio/mpeg"]), referenceIds: z.array(z.string().regex(/^[a-f0-9]{64}$/u)).max(16), bytes: z.string().max(2_800_000), wordsTimestamps: songWordTimestampsSchema.optional() }).strict()
        .refine(file => !file.wordsTimestamps || file.slot === "song" && file.mediaType === "audio/mpeg", "Word timings require a song file."),
      z.object({ kind: z.literal("transcript"), after: z.string().regex(/^\d{1,20}$/u).optional() }).strict(),
      z.object({ kind: z.literal("reference"), id: z.string().regex(/^[a-f0-9]{64}$/u) }).strict(),
    ]).optional() }).strict(),
  z.object({ action: z.literal("game_photo"), origin: acceptedInputOrigin, photo: hostedGamePhotoSchema }).strict(),
  z.object({ action: z.literal("update_game"), origin: acceptedInputOrigin, update: hostedGameUpdateSchema }).strict(),
  z.object({ action: z.literal("write_recap"), origin: gameRecapOrigin, recap: z.union([recapShowStorySchema, gameRecapWriterSchema]),
    assets: z.array(recapAssetSchema).max(5).optional(),
    priorChatLines: z.array(z.string().max(160)).max(100).optional() }).strict(),
]);
export type HostedGameToolRequest = z.infer<typeof hostedGameToolRequestSchema>;
const terms = z.object({
  defaultTask: z.string().max(500).optional(),
  n: z.number().int().min(1), fromDay: z.number().int().min(0),
  checkInKind: z.enum(["photo", "heart_rate", "any"]).optional(),
  tasks: z.array(z.object({ seat: z.number().int(), text: z.string().max(500) }).strict()).max(10),
  schedule: hostedGameScheduleSchema,
  stakes: z.array(z.object({ kind: z.enum(["winner_gets", "per_miss", "prize", "dare", "both_get"]), item: z.string().max(500), key: z.string().optional() }).strict()).max(20),
}).strict();
const pending = z.object({
  id: ref, proposedByMemberId: ref, expectedTermsVersion: z.number().int().min(1),
  origin: z.enum(["app", "chat"]).optional(),
  change: z.discriminatedUnion("kind", [hostedGameChangeSchema.options[0], hostedGameChangeSchema.options[1].extend({
    defaultTask: z.string().min(1).max(200).optional(),
    tasks: z.array(z.object({ seat: z.number().int().min(0).max(9), text: z.string().min(1).max(200) }).strict()).min(1).max(10).optional(),
  }), hostedGameChangeSchema.options[2]]), effectiveFromDay: z.number().int().min(0),
  votes: z.array(z.object({ memberId: ref, vote: z.enum(["yes", "no"]) }).strict()).max(10).optional(),
  // A call-off needs every remaining player, up to nine more yeses.
  yesNeeded: z.number().int().min(0).max(9).optional(),
  deliveryStatus: z.enum(["pending", "queued", "sent", "failed", "conversation"]), deliveryRetryable: z.boolean().optional(), startsOn: date.nullable(),
}).strict();
const progress = z.object({
  checkedAt: z.string(), players: z.array(z.object({
    memberId: ref, score: z.number().int().min(0), target: z.number().int().min(0),
    currentDayIndex: z.number().int().nullable(), attemptsRemaining: z.number().int().min(0).max(2),
    currentEntryId: ref.nullable(),
    days: z.array(z.object({ dayIndex: z.number().int(), date, status: z.enum(["posted", "due", "missed", "off", "upcoming", "not_posted"]) }).strict()).max(365),
  }).strict()).max(10),
}).strict();
const result = z.object({
  scores: z.array(z.object({ memberId: ref, seat: z.number().int(), score: z.number().int(), misses: z.number().int(), eligible: z.boolean().optional() }).strict()).max(10),
  tickets: z.array(z.object({ owedByMemberId: z.string().max(128), owedToMemberId: z.string().max(128), owedBySeats: z.array(z.number().int()).max(10).optional(), owedToSeats: z.array(z.number().int()).max(10).optional(), what: z.string().max(500), status: z.enum(["open", "redeemed", "expired"]), count: z.number().int().min(1) }).strict()).max(48),
}).strict();
export const hostedGameChatStateSchema = z.object({
  players: z.array(z.object({ memberId: ref, firstName: z.string().max(200).nullable(), timeZone: z.string().max(100).nullable(), isSender: z.boolean() }).strict()).min(1).max(10).optional(),
  games: z.array(z.object({
  maxPlayers: z.literal(10).optional(),
  pendingInviteeCount: z.number().int().min(0).max(9).optional(),
  id: ref, status: z.enum(["invited", "negotiating", "live", "settled", "void"]), terms,
  startsOn: date.nullable(), lengthDays: z.number().int().min(1).max(365),
  players: z.array(z.object({ memberId: ref, seat: z.number().int(), firstName: z.string().max(200), dayOne: date.nullable(), timeZone: z.string().max(100) }).strict()).max(10),
  pendingChange: pending.nullable(),
  progress: progress.optional(), result: result.nullable().optional(),
  changeControls: z.object({ canStartNow: z.boolean(), canEdit: z.boolean(), canEditSchedule: z.boolean(), canEditStartDate: z.boolean(), canEditTasks: z.boolean().optional(), canEditStakes: z.boolean().optional(), editableFromDay: z.number().int().nullable() }).strict(),
}).strict()).max(10), photoCheckIn: z.object({ introductionAvailable: z.boolean(), hasPendingOffer: z.boolean() }).strict().optional() }).strict();
export type HostedGameChatState = z.infer<typeof hostedGameChatStateSchema>;
export const hostedGameToolResponseSchema = z.object({
  action: z.enum(["read_game", "update_game", "game_photo", "write_recap", "my_game_reminders"]),
  result: z.object({
    status: z.enum(["ok", "unavailable", "rejected"]),
    state: hostedGameChatStateSchema.optional(),
    error: z.string().max(128).optional(),
    dayOutcome: z.object({ date, status: z.enum(["marked_incomplete", "restored", "already_incomplete", "already_complete", "no_artifact", "credited", "words_needed"]) }).strict().optional(),
    photoOutcome: z.enum(["offer", "suppressed", "saved", "dismissed"]).optional(),
    recapGame: z.unknown().optional(),
    recapOutcome: z.string().optional(),
    recap: z.union([recapShowStorySchema, hostedGameRecapSchema]).optional(),
    reaches: z.enum(["push", "text", "none"]).optional(),
    reminders: z.object({ minutes: z.number().int(), push: z.boolean(), text: z.boolean(), canText: z.boolean(),
      games: z.array(z.object({ id: gameId, task: z.string(), schedule: hostedGameScheduleSchema,
        today: z.enum(["posted", "open", "off", "upcoming"]), otherFirstNames: z.array(z.string()),
        on: z.boolean(), everyDay: z.boolean() }).strict()).max(20) }).strict().optional(),
    // Exact server-authored delivery text; recap.chatLine and lore stay bare.
    chatLine: z.string().max(2048).optional(),
    loreGuidance: z.string().optional(),
    loreFingerprint: z.string().optional(),
  }).strict(),
}).strict();
export type HostedGameToolResponse = z.infer<typeof hostedGameToolResponseSchema>;

/** A regeneration keeps the game binding but gets its own turn and delivery key. */
export function parseGameRecapEventId(eventId: string): { gameId: string; regenerationId?: string } | null {
  const match = /^game-recap:([A-Za-z0-9_-]{1,64})(?::([A-Za-z0-9_-]{8,32}))?$/u.exec(eventId);
  return match ? { gameId: match[1], ...(match[2] ? { regenerationId: match[2] } : {}) } : null;
}
