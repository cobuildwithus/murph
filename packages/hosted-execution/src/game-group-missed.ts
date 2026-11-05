import * as z from "@murphai/contracts/zod-runtime";

// A two-human room can hold ten pair games and ten group games.
export const GAME_MISSED_ROOM_MAX_GAMES = 20;
const identity = z.string().min(1).max(200).regex(/^[^:]+$/u);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const unique = (values: readonly string[]) => new Set(values).size === values.length;

export const gameGroupMissedCheckInPolicySchema = z.object({
  kind: z.literal("game_group_missed_check_in"),
  eventId: z.string(),
  roomId: identity,
  firstMissedDate: date,
  pairFingerprint: z.string().regex(/^[a-f0-9]{32}$/u),
  conversationLaneSeq: z.string().regex(/^(0|[1-9]\d{0,18})$/u),
  batch: z.array(z.object({
    gameId: identity,
    termsVersion: z.number().int().positive(),
    remainingMemberIds: z.array(identity).min(2).max(10).refine(unique),
    misses: z.array(z.object({
      memberId: identity,
      missedDates: z.array(date).min(1).max(365).refine(unique),
    }).strict()).max(10),
  }).strict().refine(game => unique(game.misses.map(miss => miss.memberId))
    && game.misses.every(miss => game.remainingMemberIds.includes(miss.memberId))))
    .min(1).max(GAME_MISSED_ROOM_MAX_GAMES),
}).strict().refine(policy => policy.eventId === `game-missed:${policy.roomId}:group:${policy.firstMissedDate}`
  && unique(policy.batch.map(game => game.gameId))
  && policy.batch.some(game => game.misses.length > 0)
  && policy.batch.every(game => game.misses.every(miss => miss.missedDates[0] === policy.firstMissedDate)));

export type HostedGameGroupMissedCheckInPolicy = z.infer<typeof gameGroupMissedCheckInPolicySchema>;
