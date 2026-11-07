import "server-only";

import { Prisma } from "@prisma/client";
import { formatTimeZoneDateTimeParts, normalizeIanaTimeZone, resolveFloatingIsoTimestampInTimeZone } from "@murphai/contracts";
import { GAME_MISSED_ROOM_MAX_GAMES, GAME_ROOM_FAR_APART_HOURS, gameEveningCheckInPolicySchema, gameZoneSpreadHours, type HostedGameEveningCheckInPolicy } from "@murphai/hosted-execution/runtime-control";
import { buildHostedLinqDeliveryId } from "../hosted-onboarding/linq-delivery-store";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "../hosted-onboarding/linq-observability-identifiers";
import { isHostedOnboardingError } from "../hosted-onboarding/errors";
import { logHostedOnboardingWarning } from "../hosted-onboarding/logging";
import { acquireHostedMailboxCausalAppendLockTx, readHostedMailboxMaxSeqByLane, readHostedMailboxWakeByDedupeKey } from "../hosted-mailbox/store";
import { getPrisma } from "../prisma";
import { isGameOn } from "./access";
import { lockGamePair } from "./blocks";
import { GameChatAudienceError, readGroupGameChatAuthority, requireExactGameChat, sameGamePlayers, type GameChatAudience } from "./chat-membership";
import { readGroupMissedDayRoom } from "./group-missed-day";
import { visitGameMissedCheckInPages } from "./missed-check-in";
import { reminderOpenDay } from "./reminders";
import { currentTerms, eligibleFromDay, isScheduledDay, remainingPlayers, type RuleState } from "./rules";
import { loadGameMissedCheckInGames } from "./service";
import { addDays } from "./time";

type Games = Awaited<ReturnType<typeof loadGameMissedCheckInGames>>;
const WINDOW_MS = 30 * 60_000;

export function gameEveningCheckInHorizons(states: readonly RuleState[], dates?: ReadonlySet<string>): Map<string, Date> {
  const horizons = new Map<string, Date>();
  for (const state of states) {
    if (state.game.status !== "live") continue;
    for (const player of remainingPlayers(state)) {
      if (!player.dayOne || !player.timeZone) continue;
      for (let day = eligibleFromDay(state, player); day < state.game.lengthDays; day += 1) {
        if (!isScheduledDay(state, day)) continue;
        const date = addDays(player.dayOne, day);
        if (dates && !dates.has(date)) continue;
        const due = resolveFloatingIsoTimestampInTimeZone(`${date}T20:00:00`, player.timeZone);
        if (!due) continue;
        const at = new Date(due.timestamp);
        if (!horizons.has(date) || at > horizons.get(date)!) horizons.set(date, at);
      }
    }
  }
  return horizons;
}

export function gameEveningWindow(dueAt: Date, now: Date): boolean {
  return now >= dueAt && now.getTime() < dueAt.getTime() + WINDOW_MS;
}

export const gameEveningEventId = (roomId: string, date: string) => `game-evening:${roomId}:${date}`;

async function readRoom(roomId: string, gameIds?: readonly string[], now = new Date(), worthProving?: (games: Games) => boolean) {
  const prisma = getPrisma();
  const ids = gameIds ?? (await prisma.game.findMany({ where: { status: "live", chatContainerMemberId: roomId },
    select: { id: true }, take: GAME_MISSED_ROOM_MAX_GAMES + 1 })).map(row => row.id);
  if (!ids.length || ids.length > GAME_MISSED_ROOM_MAX_GAMES) return null;
  const room = await readEligibleRoomGames(roomId, ids, worthProving);
  if (!room) return null;
  const { games, audience } = room;
  const memberIds = audience?.memberIds ?? await readPairAudience(roomId);
  if (!memberIds) return null;
  if (audience && (audience.contacts.length !== memberIds.length || audience.resolvedContacts.some(contact => !contact.memberId))) return null;
  if (!games.every(game => hasJoinedAudience(game.row, memberIds))) return null;
  const profiles = await prisma.gameProfile.findMany({ where: { memberId: { in: [...memberIds] } }, select: { memberId: true, timeZone: true } });
  if (profiles.length !== memberIds.length || profiles.some(profile => !normalizeIanaTimeZone(profile.timeZone))) return null;
  const zones = profiles.map(profile => profile.timeZone);
  if (gameZoneSpreadHours(zones, now) >= GAME_ROOM_FAR_APART_HOURS) return null;
  return { games, audience, memberIds, zones };
}

/** A private check-in is only eligible when the room's own check-in cannot cover this game. */
export async function roomCoversEveningGame(roomId: string | null, gameId: string, now: Date): Promise<boolean> {
  if (!roomId || process.env.MURPH_GAME_EVENING_CHECK_IN_ENABLED !== "true") return false;
  const room = await readRoom(roomId, undefined, now).catch(skipUnprovableRoom);
  return Boolean(room?.games.some(game => game.row.id === gameId));
}

async function readPairAudience(roomId: string): Promise<readonly string[] | null> {
  try { return await requireExactGameChat(roomId); }
  catch (error) {
    if (error instanceof Error && ["Game chat requires 2 to 10 available players.", "Game chat requires verified players.",
      "The game's chat participants have changed.", "Game chat route is unavailable."].includes(error.message)) return null;
    throw error;
  }
}

async function readEligibleRoomGames(roomId: string, ids: readonly string[], worthProving?: (games: Games) => boolean): Promise<{ games: Games; audience: GameChatAudience | undefined } | null> {
  const prisma = getPrisma();
  const games = await loadGameMissedCheckInGames(prisma, ids);
  if (worthProving && !worthProving(games)) return null;
  const group = games.some(game => game.row.maxPlayers === 10);
  const groupRoom = group ? await readGroupMissedDayRoom(roomId, ids) : null;
  if (group && !groupRoom) return null;
  const eligible = groupRoom?.games ?? games.filter(game => game.row.status === "live" && game.row.chatContainerMemberId === roomId && isGameOn(game.row));
  if (!eligible.length) return null;
  return { games: eligible, audience: groupRoom?.audience };
}

function hasJoinedAudience(row: Games[number]["row"], memberIds: readonly string[]): boolean {
  return row.maxPlayers === 10
    ? memberIds.every(id => row.players.some(player => player.memberId === id && !player.leftAt && player.joinedAt))
    : sameGamePlayers(row.players.map(player => player.memberId), memberIds) && row.players.every(player => !player.leftAt);
}

function addressedBatch(games: Games, date: string, now: Date): HostedGameEveningCheckInPolicy["batch"] {
  return games.flatMap(({ row, state }) => {
    const byDay = new Map<number, string[]>();
    for (const player of remainingPlayers(state)) {
      const seat = row.players.find(seat => seat.memberId === player.memberId);
      const dayIndex = reminderOpenDay(state, player, now, seat?.reminderEveryDay);
      if (dayIndex === null || row.players.find(seat => seat.memberId === player.memberId)?.reminderOff
        || addDays(player.dayOne!, dayIndex) !== date) continue;
      byDay.set(dayIndex, [...byDay.get(dayIndex) ?? [], player.memberId]);
    }
    return [...byDay].map(([dayIndex, memberIds]) => ({ gameId: row.id, termsVersion: currentTerms(state.game.terms).n,
      memberIds: memberIds.sort(), dayIndex }));
  }).sort((a, b) => a.gameId.localeCompare(b.gameId) || a.dayIndex - b.dayIndex);
}

function candidateDates(zones: readonly string[], now: Date): Set<string> {
  return new Set(zones.flatMap(zone => normalizeIanaTimeZone(zone) ? [formatTimeZoneDateTimeParts(now, zone).dayKey] : []));
}

function hasDueCandidate(games: Games, now: Date): boolean {
  return games.some(game => {
    const zones = remainingPlayers(game.state).flatMap(player => player.timeZone ? [player.timeZone] : []);
    if (!zones.length) return false;
    const horizons = gameEveningCheckInHorizons([game.state], candidateDates(zones, now));
    return [...horizons.values()].some(dueAt => gameEveningWindow(dueAt, now));
  });
}

function skipUnprovableRoom(error: unknown): null {
  const reason = error instanceof GameChatAudienceError ? error.reason
    : isHostedOnboardingError(error) && ["HOSTED_MEMBER_IDENTITY_LOOKUP_AMBIGUOUS", "HOSTED_MEMBER_VERIFIED_EMAIL_LOOKUP_AMBIGUOUS"].includes(error.code) ? "identity_ambiguous" : null;
  if (!reason) throw error;
  logHostedOnboardingWarning("game.evening.room-skipped", { reason });
  return null;
}

/** The latest three sends, not the latest three dates: a paused evening sends nothing, and that mustn't end the pause. */
async function paused(roomId: string, horizons: Map<string, Date>, date: string, tx: Prisma.TransactionClient): Promise<boolean> {
  const keys = [...horizons.keys()].filter(day => day < date).map(day => createHostedLinqDeliveryIdempotencyLookupKey(gameEveningEventId(roomId, day))!);
  const accepted = await tx.hostedLinqDelivery.findMany({ where: { idempotencyKey: { in: keys }, acceptedAt: { not: null } },
    orderBy: { acceptedAt: "desc" }, take: 3, select: { acceptedAt: true } });
  if (accepted.length < 3) return false;
  const inbound = await tx.hostedMailboxItem.findFirst({ where: { userId: roomId, kind: "conversation.message", lane: "conversation", occurredAt: { gte: accepted[2]!.acceptedAt! } }, select: { id: true } });
  return !inbound;
}

export async function reserveGameEveningCheckIn(roomId: string, gameIds: readonly string[], now: Date): Promise<number> {
  if (process.env.MURPH_GAME_EVENING_CHECK_IN_ENABLED !== "true") return 0;
  const room = await readRoom(roomId, gameIds, now, games => hasDueCandidate(games, now)).catch(skipUnprovableRoom);
  if (!room) return 0;
  const horizons = gameEveningCheckInHorizons(room.games.map(game => game.state), candidateDates(room.zones, now));
  let reserved = 0;
  for (const [date, dueAt] of horizons) {
    if (!gameEveningWindow(dueAt, now)) continue;
    const batch = addressedBatch(room.games, date, now);
    if (!batch.length) continue;
    const eventId = gameEveningEventId(roomId, date);
    const key = createHostedLinqDeliveryIdempotencyLookupKey(eventId)!;
    const policy = gameEveningCheckInPolicySchema.parse({ kind: "game_evening_check_in", eventId, roomId, date,
      expiresAt: new Date(dueAt.getTime() + WINDOW_MS).toISOString(), conversationLaneSeq: "0", batch });
    const created = await getPrisma().$transaction(async tx => {
      if (room.memberIds.length === 2) await lockGamePair(tx, room.memberIds[0]!, room.memberIds[1]!);
      if (!await isEveningBatchCurrentTx(policy, room.memberIds, room.audience, tx, now, false)
        || await paused(roomId, gameEveningCheckInHorizons(room.games.map(game => game.state)), date, tx)) return false;
      const result = await tx.hostedLinqDelivery.createMany({ data: [{ id: buildHostedLinqDeliveryId(key), idempotencyKey: key,
        source: "game_lifecycle", sourceRef: `${roomId}:${date}`, template: "game_evening", status: "awaiting_generation",
        targetKind: "thread", payloadOwnerMemberId: roomId, attemptedAt: dueAt, retryAfterAt: dueAt, createdAt: dueAt }], skipDuplicates: true });
      return result.count === 1;
    });
    if (created) reserved += 1;
  }
  return reserved;
}

/** Five-minute room cadence leaves repeated chances inside the thirty-minute window. */
export async function reserveDueGameEveningCheckIns(now = new Date(), options: { signal?: AbortSignal; deadlineMs?: number } = {}): Promise<number> {
  if (process.env.MURPH_GAME_EVENING_CHECK_IN_ENABLED !== "true") return 0;
  const prisma = getPrisma();
  const shard = Math.floor(now.getTime() / 60_000) % 5;
  const deadline = Math.min(options.deadlineMs ?? Infinity, Date.now() + 20_000);
  let reserved = 0;
  await visitGameMissedCheckInPages({ pageSize: 100,
    readPage: async (cursor, limit) => {
      if (options.signal?.aborted || Date.now() >= deadline) return [];
      return (await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT DISTINCT chat_container_member_id AS id FROM game
        WHERE status = 'live' AND chat_container_member_id IS NOT NULL
          AND mod(abs(hashtext(chat_container_member_id)::bigint), 5) = ${shard}
          AND chat_container_member_id > ${cursor}
        ORDER BY id LIMIT ${limit}`).map(row => row.id);
    },
    visit: async rooms => {
      for (const roomId of rooms) {
        if (options.signal?.aborted || Date.now() >= deadline) return;
        const ids = (await prisma.game.findMany({ where: { status: "live", chatContainerMemberId: roomId },
          select: { id: true }, take: GAME_MISSED_ROOM_MAX_GAMES + 1 })).map(row => row.id);
        if (ids.length <= GAME_MISSED_ROOM_MAX_GAMES) reserved += await reserveGameEveningCheckIn(roomId, ids, now);
      }
    },
  });
  return reserved;
}

export async function prepareGameEveningCheckIn(roomId: string, date: string, now: Date) {
  const room = await readRoom(roomId, undefined, now);
  if (!room) return null;
  const dueAt = gameEveningCheckInHorizons(room.games.map(game => game.state), new Set([date])).get(date);
  if (!dueAt || !gameEveningWindow(dueAt, now)) return null;
  const batch = addressedBatch(room.games, date, now);
  if (!batch.length) return null;
  const [watermark] = await readHostedMailboxMaxSeqByLane({ userId: roomId, lanes: ["conversation"] });
  const policy = gameEveningCheckInPolicySchema.parse({ kind: "game_evening_check_in", roomId, date,
    eventId: gameEveningEventId(roomId, date), expiresAt: new Date(dueAt.getTime() + WINDOW_MS).toISOString(),
    conversationLaneSeq: watermark.maxSeq, batch });
  return { ...room, policy };
}

export async function isEveningBatchCurrentTx(policy: HostedGameEveningCheckInPolicy, memberIds: readonly string[],
  audience: GameChatAudience | undefined, tx: Prisma.TransactionClient, now: Date, checkConversation = true): Promise<boolean> {
  if (now >= new Date(policy.expiresAt)) return false;
  const ids = [...new Set(policy.batch.map(game => game.gameId))].sort();
  await tx.$queryRaw`SELECT id FROM game WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
  const games = await loadGameMissedCheckInGames(tx, ids);
  if (games.length !== ids.length || games.some(game => game.row.status !== "live" || game.row.chatContainerMemberId !== policy.roomId || !isGameOn(game.row))) return false;
  if (!await roomAudienceCurrentTx(games, policy.roomId, memberIds, audience, tx)) return false;
  const profiles = await tx.gameProfile.findMany({ where: { memberId: { in: [...memberIds] } }, select: { timeZone: true } });
  if (profiles.length !== memberIds.length || profiles.some(profile => !normalizeIanaTimeZone(profile.timeZone))
    || gameZoneSpreadHours(profiles.map(profile => profile.timeZone), now) >= GAME_ROOM_FAR_APART_HOURS) return false;
  // Only the addressed games are loaded here, so the room's horizon can't be rebuilt; the frozen expiry above stands.
  if (JSON.stringify(addressedBatch(games, policy.date, now)) !== JSON.stringify(policy.batch)) return false;
  if (!checkConversation) return true;
  await acquireHostedMailboxCausalAppendLockTx({ tx, userId: policy.roomId });
  const [watermark] = await readHostedMailboxMaxSeqByLane({ prisma: tx, userId: policy.roomId, lanes: ["conversation"] });
  return watermark.maxSeq === policy.conversationLaneSeq;
}

async function roomAudienceCurrentTx(games: Games, roomId: string, memberIds: readonly string[], audience: GameChatAudience | undefined,
  tx: Prisma.TransactionClient): Promise<boolean> {
  for (const { row } of games) {
    if (!hasJoinedAudience(row, memberIds)) return false;
    if (row.maxPlayers === 10 && (!audience || audience.contacts.length !== memberIds.length
      || !await readGroupGameChatAuthority(row, roomId, audience, tx))) return false;
  }
  return true;
}

export async function readGameEveningDeliveryAuthority(eventId: string, roomId: string, target?: string | null) {
  const wake = await readHostedMailboxWakeByDedupeKey({ dedupeKey: eventId, userId: roomId });
  if (wake?.kind !== "assistant.notification.requested") return null;
  const policy = wake.notification.responsePolicy;
  if (!policy || policy.kind !== "game_evening_check_in" || policy.eventId !== eventId || policy.roomId !== roomId
    || wake.eventId !== eventId || wake.userId !== roomId) return null;
  const parsed = gameEveningCheckInPolicySchema.parse(policy);
  const room = await readRoom(roomId);
  if (!room || target != null && room.audience && room.audience.threadId !== target) return null;
  return { policy: parsed, audience: room.audience, memberIds: room.memberIds };
}
